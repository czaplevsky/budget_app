import { supabaseAdmin } from "./supabase.ts";

// Sekcja 4.7 specu: klucz w Skrótach ma ograniczony scope (ingest/widget),
// osobny klucz dla dashboardu z szerszym dostępem. Klucz nigdy w plaintext
// w bazie — porównujemy sha256.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type AuthResult = { ok: true; scopes: string[] } | { ok: false; status: number; error: string };

export async function checkAuth(req: Request, requiredScope: string): Promise<AuthResult> {
  const key = req.headers.get("x-api-key");
  if (!key) return { ok: false, status: 401, error: "missing X-Api-Key" };

  const hash = await sha256Hex(key);
  const supabase = supabaseAdmin();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, scopes, active")
    .eq("key_hash", hash)
    .maybeSingle();

  if (error || !data || !data.active) {
    return { ok: false, status: 401, error: "invalid api key" };
  }
  if (!data.scopes.includes(requiredScope) && !data.scopes.includes("*")) {
    return { ok: false, status: 403, error: `key missing scope '${requiredScope}'` };
  }

  await supabase.from("api_keys").update({ last_used: new Date().toISOString() }).eq("id", data.id);
  return { ok: true, scopes: data.scopes };
}
