-- Bucket na zdjęcia paragonów (sekcja 3.5, 4.7 specu). Prywatny — dostęp
-- wyłącznie przez Edge Function z kluczem service_role (podpisane URL-e
-- 1h przy odczycie, do zaimplementowania w dashboardzie fazy 3).
insert into storage.buckets (id, name, public)
  values ('receipts', 'receipts', false)
  on conflict (id) do nothing;

-- Brak polityk RLS dla anon/authenticated celowo — bucket czytany/pisany
-- tylko przez service_role (Edge Functions), które omija RLS.
