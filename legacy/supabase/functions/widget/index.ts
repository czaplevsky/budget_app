// GET /widget — sekcja 4.3 specu. Konsumowane przez Scriptable (widget/BudgetWidget.js).
// Cel: < 100 ms, jeden SELECT, zero logiki (przeliczenie robi trigger po
// stronie bazy, patrz migracja 0002 fn_recompute_widget_state).
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "widget");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("widget_state")
    .select(
      "sts_month, sts_remaining, sts_daily, days_left, spent_mtd, pace_ratio, color, next_fixed, needs_review_count, savings_withdrawn_mtd, windfall_unallocated, bnpl_open, updated_at",
    )
    .eq("id", 1)
    .single();

  if (error) return json({ error: error.message }, 500);

  return json(data);
});
