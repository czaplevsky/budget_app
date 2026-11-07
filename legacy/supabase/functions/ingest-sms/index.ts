// POST /ingest/sms — sekcja 3.3 specu. OPCJONALNA ścieżka: Tomek ma
// Alerty24 SMS wyłączone (potwierdzone 2026-09-15). Kod zostaje gotowy na
// wypadek, gdyby rekonsyliacja CSV pokazała, że BLIK-i/przelewy giną i
// warto włączyć SMS-y (koszt ~20 zł/mies).
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

interface SmsPayload {
  sender: string;
  text: string;
  received_at?: string;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "ingest");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const payload = (await req.json().catch(() => null)) as SmsPayload | null;

  const { data: logRow } = await supabase
    .from("ingest_log").insert({ source: "sms", payload: payload ?? {} }).select("id").single();

  if (!payload?.text || !payload?.sender) {
    await supabase.from("ingest_log").update({ result: "error", error: "invalid payload" }).eq("id", logRow?.id);
    return json({ error: "sender and text required" }, 400);
  }

  const { data: patterns } = await supabase
    .from("sms_patterns").select("*").eq("active", true).ilike("bank", `%${payload.sender}%`);

  let matched: { amount: number; merchant?: string; balance?: number } | null = null;

  for (const p of patterns ?? []) {
    try {
      const re = new RegExp(p.regex, "i");
      const m = payload.text.match(re);
      if (!m) continue;
      const fields = p.field_map as Record<string, number>;
      const rawAmount = fields.amount ? m[fields.amount] : undefined;
      if (!rawAmount) continue;
      matched = {
        amount: parseFloat(rawAmount.replace(/\s/g, "").replace(",", ".")),
        merchant: fields.merchant ? m[fields.merchant] : undefined,
        balance: fields.balance ? parseFloat(m[fields.balance].replace(/\s/g, "").replace(",", ".")) : undefined,
      };
      break;
    } catch (_e) {
      continue;
    }
  }

  if (!matched) {
    await supabase.from("ingest_log").update({ result: "unparsed" }).eq("id", logRow?.id);
    return json({ unparsed: true, message: "brak dopasowania w sms_patterns, sprawdź ingest_log" });
  }

  const occurredAt = payload.received_at ?? new Date().toISOString();

  const { data: mainAccount } = await supabase
    .from("accounts").select("id").eq("budget_role", "main").limit(1).maybeSingle();

  if (matched.balance !== undefined && mainAccount?.id) {
    await supabase.from("balances_snapshots").insert({
      account_id: mainAccount.id, balance: matched.balance, source: "sms",
    });
  }

  const { data: classified } = await supabase.rpc("fn_classify", {
    p_merchant: matched.merchant ?? payload.text,
    p_amount: matched.amount,
    p_occurred: occurredAt,
    p_iban: null,
  });
  const cls = classified?.[0] ?? { kind: "variable", category_id: null, template_id: null, confidence: 0.3, needs_tag: true };

  const { data: dupId } = await supabase.rpc("fn_find_dedup_candidate", {
    p_account: mainAccount?.id ?? null,
    p_amount: matched.amount,
    p_occurred: occurredAt,
    p_merchant: matched.merchant ?? "",
    p_source: "sms",
  });

  if (dupId) {
    await supabase.from("ingest_log").update({ result: "ok", transaction_id: dupId }).eq("id", logRow?.id);
    const { data: widget } = await supabase.from("widget_state").select("*").eq("id", 1).single();
    return json({ transaction_id: dupId, merged: true, ...widget });
  }

  const { data: tx, error } = await supabase.from("transactions").insert({
    occurred_at: occurredAt,
    amount: matched.amount,
    amount_original: matched.amount,
    currency: "PLN",
    account_id: mainAccount?.id ?? null,
    merchant_raw: matched.merchant ?? payload.text,
    category_id: cls.category_id,
    kind: cls.kind,
    template_id: cls.template_id,
    source: "sms",
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
    .from("widget_state").select("sts_remaining, sts_daily, color").eq("id", 1).single();

  return json({ transaction_id: tx.id, kind: cls.kind, ...widget });
});
