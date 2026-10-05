// POST /ingest/applepay — sekcja 3.2 specu. Główny kanał (Tomek płaci zawsze
// telefonem, potwierdzone 2026-09-15). Wywoływane przez automatyzację
// Skrótów "Transakcja" natychmiast po płatności ("Run immediately").
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { fxToPln } from "../_shared/fx.ts";

interface ApplePayPayload {
  merchant: string;
  amount: number;      // dodatnie z Wallet; wydatek = ujemne w naszym modelu
  currency: string;
  card?: string;
  occurred_at?: string;
  device_id?: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "ingest");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const payload = (await req.json().catch(() => null)) as ApplePayPayload | null;

  // Zapisz surowy payload PRZED jakimkolwiek przetwarzaniem — zasada z
  // zasada: błąd parsera nie może zgubić danych.
  const { data: logRow } = await supabase
    .from("ingest_log").insert({ source: "applepay", payload: payload ?? {} }).select("id").single();

  if (!payload || typeof payload.amount !== "number" || !payload.currency) {
    await supabase.from("ingest_log").update({ result: "error", error: "invalid payload" }).eq("id", logRow?.id);
    return json({ error: "invalid payload: merchant, amount, currency required" }, 400);
  }

  const occurredAt = payload.occurred_at ?? new Date().toISOString();
  const amountExpense = -Math.abs(payload.amount); // Apple Pay = zawsze wydatek w tym kanale
  const { pln, rate } = await fxToPln(amountExpense, payload.currency);

  const { data: mainAccount } = await supabase
    .from("accounts").select("id").eq("budget_role", "main").limit(1).maybeSingle();

  const { data: classified } = await supabase.rpc("fn_classify", {
    p_merchant: payload.merchant,
    p_amount: pln,
    p_occurred: occurredAt,
    p_iban: null,
  });
  const cls = classified?.[0] ?? { kind: "variable", category_id: null, template_id: null, confidence: 0.3, needs_tag: true };

  // dedup: czy to samo (kwota+data+sklep) już istnieje z innego źródła?
  const { data: dupId } = await supabase.rpc("fn_find_dedup_candidate", {
    p_account: mainAccount?.id ?? null,
    p_amount: pln,
    p_occurred: occurredAt,
    p_merchant: payload.merchant,
    p_source: "applepay", // dwa identyczne tapnięcia to dwa zakupy, nie duplikat
  });

  if (dupId) {
    await supabase.from("ingest_log").update({ result: "ok", transaction_id: dupId }).eq("id", logRow?.id);
    const { data: widget } = await supabase.from("widget_state").select("*").eq("id", 1).single();
    return json({ transaction_id: dupId, merged: true, ...widget });
  }

  const { data: tx, error } = await supabase.from("transactions").insert({
    occurred_at: occurredAt,
    amount: pln,
    amount_original: amountExpense,
    currency: payload.currency,
    fx_rate: rate,
    account_id: mainAccount?.id ?? null,
    merchant_raw: payload.merchant,
    category_id: cls.category_id,
    kind: cls.kind,
    template_id: cls.template_id,
    payment_method: "applepay",
    source: "applepay",
    status: cls.needs_tag ? "needs_review" : "confirmed",
    confidence: cls.confidence,
    raw_payload: payload,
  }).select("id").single();

  if (error) {
    await supabase.from("ingest_log").update({ result: "error", error: error.message }).eq("id", logRow?.id);
    return json({ error: error.message }, 500);
  }

  await supabase.from("ingest_log").update({ result: "ok", transaction_id: tx.id }).eq("id", logRow?.id);

  const { data: widget } = await supabase
    .from("widget_state")
    .select("sts_remaining, sts_daily, days_left, pace_ratio, color")
    .eq("id", 1).single();

  // Lista kategorii do menu w Skrócie, gdy needs_tag=true
  const { data: cats } = await supabase
    .from("categories").select("name").eq("group_name", "variable").order("sort_order");

  return json({
    transaction_id: tx.id,
    kind: cls.kind,
    needs_tag: cls.needs_tag,
    categories: cls.needs_tag ? (cats ?? []).map((c) => c.name) : undefined,
    sts_remaining: widget?.sts_remaining,
    sts_daily: widget?.sts_daily,
    pace_ratio: widget?.pace_ratio,
    color: widget?.color,
    days_note: `${widget?.days_left ?? "?"} dni do końca miesiąca`,
  });
});
