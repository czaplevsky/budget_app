import { createClient } from "jsr:@supabase/supabase-js@2";

// Service-role klient: jedyny sposób dostępu do bazy z Edge Functions.
// RLS jest włączone na wszystkich tabelach (migracja 0001) — anon key
// nie przejdzie, i tak nie jest nigdzie używany. Sekrety są w env
// projektu Supabase (Settings -> Edge Functions -> Secrets), nie w repo.
export function supabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
