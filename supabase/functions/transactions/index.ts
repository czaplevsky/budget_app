// POST /transactions            — ręczny wpis (Skrót BUDGET_Wydatek, sekcja 3.4)
// POST /transactions/:id/tag    — potwierdzenie kategorii, uczy merchant_rules
// POST /transactions/:id/merge  — dedup ręczny (sekcja 3.7)
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";

function widgetSnapshot(supabase: ReturnType<typeof supabaseAdmin>) {
  return supabase
    .from("widget_state")
    .select("sts_remaining, sts_daily, days_left, color")
    .eq("id", 1)
    .single();
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "transactions");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const url = new URL(req.url);
  // funkcja "transactions" widzi wszystko po prefiksie /transactions
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("transactions");
  const segments = idx >= 0 ? parts.slice(idx + 1) : [];

  const supabase = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  // --- POST /transactions/:id/tag ---
  if (segments.length === 2 && segments[1] === "tag") {
    const id = segments[0];
    const { category, kind, note, learn_rule } = body as {
      category?: string; kind?: string; note?: string; learn_rule?: boolean;
    };
    if (!category) return json({ error: "category required" }, 400);

    const { data: cat, error: catErr } = await supabase
      .from("categories").select("id").eq("name", category).maybeSingle();
    if (catErr || !cat) return json({ error: "unknown category" }, 400);

    const update: Record<string, unknown> = {
      category_id: cat.id,
      status: "confirmed",
    };
    if (kind) update.kind = kind;
    if (note) update.note = note;

    const { data: tx, error: txErr } = await supabase
      .from("transactions").update(update).eq("id", id).select("merchant_norm, kind").single();
    if (txErr || !tx) return json({ error: txErr?.message ?? "transaction not found" }, 404);

    if (learn_rule && tx.merchant_norm) {
      await supabase.from("merchant_rules").insert({
        pattern: tx.merchant_norm,
        category_id: cat.id,
        kind: tx.kind,
        learned: true,
        priority: 5, // reguły uczone mają pierwszeństwo przed ogólnym słownikiem
      });
    }

    const { data: widget } = await widgetSnapshot(supabase);
    return json({ ok: true, ...widget });
  }

  // --- POST /transactions/:id/merge ---
  if (segments.length === 2 && segments[1] === "merge") {
    const id = segments[0];
    const { into_id } = body as { into_id?: string };
    if (!into_id) return json({ error: "into_id required" }, 400);

    const { error } = await supabase
      .from("transactions").update({ merged_into: into_id, status: "ignored" }).eq("id", id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // --- POST /transactions (manual create) ---
  if (segments.length === 0) {
    const { amount, category, note, occurred_at, kind } = body as {
      amount?: number; category?: string; note?: string; occurred_at?: string; kind?: string;
    };
    if (typeof amount !== "number") return json({ error: "amount (number) required" }, 400);

    let category_id: string | null = null;
    if (category) {
      const { data: cat } = await supabase.from("categories").select("id").eq("name", category).maybeSingle();
      category_id = cat?.id ?? null;
    }

    const { data: main } = await supabase.from("accounts").select("id").eq("budget_role", "main").limit(1).maybeSingle();

    const { data: tx, error } = await supabase.from("transactions").insert({
      occurred_at: occurred_at ?? new Date().toISOString(),
      amount,
      amount_original: amount,
      currency: "PLN",
      account_id: main?.id ?? null,
      merchant_raw: note ?? "ręczny wpis",
      category_id,
      kind: kind ?? (amount < 0 ? "variable" : "windfall"),
      source: "manual",
      status: "confirmed",
      note,
    }).select("id").single();

    if (error) return json({ error: error.message }, 500);

    const { data: widget } = await widgetSnapshot(supabase);
    return json({ transaction_id: tx.id, ...widget });
  }

  return json({ error: "not found" }, 404);
});
