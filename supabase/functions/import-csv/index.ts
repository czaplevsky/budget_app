// POST /import/csv — sekcja 3.6, 4.3 specu (ścieżka E: rekonsyliacja
// bieżąca, raz w miesiącu, ręczny upload w dashboardzie). Historia
// jednorazowa (X 2025 - VI 2026) idzie przez scripts/import_historical_csv.py,
// nie przez ten endpoint (bulk 751 wierszy w Edge Function ryzykuje timeout).
//
// Zakres tej wersji (celowo ograniczony, żeby dowieźć działający kod zamiast
// niedokończonej pełnej rekonsyliacji): wykrywa transakcje z CSV, których
// nie ma jeszcze w rejestrze (missing_in_app) i wstawia je + loguje diff do
// przejrzenia w dashboardzie; wykrywa różnice kwot dla już dopasowanych
// (amount_diff, np. przewalutowanie). NIE wykrywa jeszcze "missing_in_bank"
// (transakcja w appce, której bank nie potwierdza) — TODO dla kolejnej
// iteracji, oznaczone w kodzie.
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { parseSantanderCsv, parsePekaoCsv } from "../_shared/csv_parsers.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "import");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const { csv, bank, account_id } = body as { csv?: string; bank?: string; account_id?: string };

  if (!csv || !bank || !account_id) {
    return json({ error: "csv, bank (santander|pekao), account_id required" }, 400);
  }

  const rows = bank === "santander" ? parseSantanderCsv(csv) : bank === "pekao" ? parsePekaoCsv(csv) : null;
  if (!rows) return json({ error: "bank must be 'santander' or 'pekao'" }, 400);

  let inserted = 0;
  let merged = 0;
  // id wstawione lub dopasowane w tym imporcie: drugi identyczny wiersz
  // (np. dwa bilety 6,50 tego samego dnia) nie może się do nich dokleić
  const consumed: string[] = [];
  const diffs: { kind: string; note: string }[] = [];

  for (const row of rows) {
    const occurredAt = `${row.occurred_at}T12:00:00Z`;

    const { data: dupId } = await supabase.rpc("fn_find_dedup_candidate", {
      p_account: account_id,
      p_amount: row.amount,
      p_occurred: occurredAt,
      p_merchant: row.merchant,
      p_skip: consumed,
    });

    if (dupId) {
      consumed.push(dupId as string);
      const { data: existing } = await supabase
        .from("transactions").select("amount, source").eq("id", dupId).single();

      if (existing && Math.abs(existing.amount - row.amount) > 0.02) {
        await supabase.from("transactions").update({
          amount: row.amount, amount_original: row.amount, source: "csv", source_ref: row.source_ref,
        }).eq("id", dupId);
        await supabase.from("reconciliation_diffs").insert({
          kind: "amount_diff", transaction_id: dupId,
          import_row: { csv_amount: row.amount, app_amount: existing.amount, merchant: row.merchant },
        });
        diffs.push({ kind: "amount_diff", note: `${row.merchant}: ${existing.amount} -> ${row.amount}` });
      }
      // bank jest źródłem prawdy o księgowaniu; sklep z paragonu/zrzutu zostaje
      await supabase.from("transactions").update({
        booked_at: row.occurred_at,
        source_ref: row.source_ref,
        bank_descriptor: row.merchant,
      }).eq("id", dupId);
      merged++;
      continue;
    }

    const { data: classified } = await supabase.rpc("fn_classify", {
      p_merchant: row.merchant, p_amount: row.amount, p_occurred: occurredAt, p_iban: null,
    });
    const cls = classified?.[0] ?? { kind: "variable", category_id: null, confidence: 0.3, needs_tag: true };

    const { data: tx } = await supabase.from("transactions").insert({
      occurred_at: occurredAt,
      amount: row.amount,
      amount_original: row.amount,
      currency: row.currency,
      account_id,
      merchant_raw: row.merchant,
      category_id: cls.category_id,
      kind: cls.kind,
      template_id: cls.template_id,
      source: "csv",
      source_ref: row.source_ref,
      status: cls.needs_tag ? "needs_review" : "confirmed",
      confidence: cls.confidence,
    }).select("id").single();

    if (tx) {
      consumed.push(tx.id as string);
      await supabase.from("reconciliation_diffs").insert({
        kind: "missing_in_app", transaction_id: tx.id,
        import_row: { merchant: row.merchant, amount: row.amount, occurred_at: row.occurred_at },
      });
      inserted++;
    }
  }

  // TODO (kolejna iteracja): missing_in_bank — porównać zbiór transakcji
  // w appce z ostatnich 45 dni dla tego account_id z zaimportowanymi
  // wierszami CSV, oznaczyć te bez odpowiednika jako reconciliation_diffs
  // kind='missing_in_bank' (możliwy duplikat ręcznego wpisu albo płatność,
  // która się nie doszła).

  return json({ parsed: rows.length, inserted, merged, diffs_sample: diffs.slice(0, 10) });
});
