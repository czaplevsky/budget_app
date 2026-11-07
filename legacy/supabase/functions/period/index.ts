// GET /period/current       — pełne podsumowanie okresu (dashboard, sekcja 4.5)
// POST /period/:id/close    — ręczne zamknięcie przed cronem (sekcja 2.5, 4.3)
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const auth = await checkAuth(req, "period");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("period");
  const segments = idx >= 0 ? parts.slice(idx + 1) : [];

  if (req.method === "GET" && (segments.length === 0 || segments[0] === "current")) {
    const { data: period, error } = await supabase
      .from("budget_periods").select("*").eq("status", "open")
      .order("period_start", { ascending: false }).limit(1).maybeSingle();
    if (error || !period) return json({ error: error?.message ?? "no open period" }, 404);

    const { data: lines } = await supabase
      .from("period_lines")
      .select("id, kind, category_id, amount_planned, amount_actual, due_date, status, categories(name)")
      .eq("period_id", period.id).order("due_date");

    const { data: widget } = await supabase.from("widget_state").select("*").eq("id", 1).single();

    return json({ period, lines, widget });
  }

  if (req.method === "POST" && segments.length === 2 && segments[1] === "close") {
    const periodId = segments[0];
    const body = await req.json().catch(() => ({}));
    const action = (body as { leftover_action?: string }).leftover_action ?? "to_pillow";

    const { error } = await supabase.rpc("fn_close_period", { p_period_id: periodId, p_action: action });
    if (error) return json({ error: error.message }, 500);

    const { data: closed } = await supabase.from("budget_periods").select("*").eq("id", periodId).single();
    return json({ ok: true, period: closed });
  }

  return json({ error: "not found" }, 404);
});
