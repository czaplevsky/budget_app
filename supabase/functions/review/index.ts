// GET /review — sekcja 4.5 specu. Lista "Do sprawdzenia" w dashboardzie:
// needs_review + nierozwiązane różnice rekonsyliacji + windfalle. Cel: pusta
// lista w 2 minuty w niedzielę.
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "review");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();

  const [needsReview, diffs, windfalls] = await Promise.all([
    supabase
      .from("transactions")
      .select("id, occurred_at, amount, merchant_raw, kind, source, confidence")
      .eq("status", "needs_review")
      .order("occurred_at", { ascending: false }),
    supabase
      .from("reconciliation_diffs")
      .select("id, kind, transaction_id, import_row, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: false }),
    supabase
      .from("windfalls")
      .select("id, amount, created_at, transactions(merchant_raw, occurred_at)")
      .is("allocated_to", null)
      .order("created_at", { ascending: false }),
  ]);

  return json({
    needs_review: needsReview.data ?? [],
    reconciliation_diffs: diffs.data ?? [],
    windfalls_unallocated: windfalls.data ?? [],
    total: (needsReview.data?.length ?? 0) + (diffs.data?.length ?? 0) + (windfalls.data?.length ?? 0),
  });
});
