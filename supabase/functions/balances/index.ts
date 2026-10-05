// POST /balances — sekcja 4.3 specu. Ręczne saldo konta (lub z SMS-a, choć
// ta ścieżka jest w ingest-sms) — do guarda płynności w dashboardzie.
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "balances");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const { account_id, balance, as_of } = body as { account_id?: string; balance?: number; as_of?: string };

  if (!account_id || typeof balance !== "number") {
    return json({ error: "account_id and balance (number) required" }, 400);
  }

  const { error } = await supabase.from("balances_snapshots").insert({
    account_id,
    balance,
    as_of: as_of ?? new Date().toISOString(),
    source: "manual",
  });
  if (error) return json({ error: error.message }, 500);

  return json({ ok: true });
});
