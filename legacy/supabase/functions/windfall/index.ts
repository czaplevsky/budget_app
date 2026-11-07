// POST /windfall/:id/allocate — sekcja 2.2, 2.6, 0.2 pkt 8 specu.
// Jednorazowe wpływy (zwroty, premie, nadwyżka wypłaty) lądują tu do ręcznej decyzji.
// Zasada "najpierw oszczędzamy" (potwierdzona 2026-09-15): domyślna
// propozycja w powiadomieniu to Poduszka, nie STS — ale to Tomek decyduje.
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "windfall");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("windfall");
  const segments = idx >= 0 ? parts.slice(idx + 1) : [];

  if (segments.length !== 2 || segments[1] !== "allocate") return json({ error: "not found" }, 404);
  const windfallId = segments[0];

  const body = await req.json().catch(() => ({}));
  const { to, amount } = body as { to?: string; amount?: number };
  if (!to || !["sts", "pillow", "goal", "mortgage"].includes(to)) {
    return json({ error: "to must be one of: sts, pillow, goal, mortgage" }, 400);
  }

  const { data: wf, error: wfErr } = await supabase
    .from("windfalls").select("*").eq("id", windfallId).single();
  if (wfErr || !wf) return json({ error: "windfall not found" }, 404);

  const allocAmount = amount ?? wf.amount;

  const { error } = await supabase.from("windfalls").update({
    allocated_to: to,
    allocated_amount: allocAmount,
    allocated_at: new Date().toISOString(),
  }).eq("id", windfallId);
  if (error) return json({ error: error.message }, 500);

  // "sts" = jedyna opcja, która realnie podnosi STS_remaining bieżącego
  // okresu (przez podniesienie sts_month o kwotę windfalla). Pozostałe
  // (pillow/goal/mortgage) to decyzje alokacyjne poza STS — do wykonania
  // ręcznym przelewem przez Tomka, tu tylko rejestrujemy decyzję.
  if (to === "sts") {
    const { data: tx } = await supabase.from("transactions").select("period_id").eq("id", wf.transaction_id).single();
    if (tx?.period_id) {
      const { data: periodRow } = await supabase
        .from("budget_periods").select("sts_month").eq("id", tx.period_id).single();
      if (periodRow) {
        await supabase.from("budget_periods")
          .update({ sts_month: periodRow.sts_month + allocAmount })
          .eq("id", tx.period_id);
        await supabase.rpc("fn_recompute_widget_state", { p_period_id: tx.period_id });
      }
    }
  }

  const { data: widget } = await supabase.from("widget_state").select("*").eq("id", 1).single();
  return json({ ok: true, allocated_to: to, allocated_amount: allocAmount, widget });
});
