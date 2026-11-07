# BUDGET realtime app — Faza 0/1 (fundament + ręczny MVP)

Aplikacja budżetowa, która w ciągu dnia pokazuje jedną liczbę: ile można dziś
wydać. Wydatki wchodzą z Apple Pay, ze zrzutów i paragonów (OCR), z ręcznego
wpisu i z CSV z banku. Mapa systemu: `docs/wizualizacja.html`.

**Dane osobiste nie są w repo.** Prawdziwy seed, historia z wyciągów i mapa
kont są lokalne i w `.gitignore`: `supabase/seed/seed.sql`,
`supabase/seed/historical_import_generated.sql`, `scripts/accounts.local.json`.
W repo leżą wzory: `seed.example.sql` i `accounts.example.json`.

## Co tu jest

```
app/
  supabase/
    migrations/       — schemat, funkcje, triggery, storage, dokumenty i BNPL (0001-0005)
    seed/              — dane startowe (konta, kategorie, szablony, reguły)
                         + historical_import_generated.sql (751 transakcji
                         X 2025 - VI 2026, już wygenerowane z realnych CSV)
    functions/         — Edge Functions (Deno), po jednej na endpoint z specu
  scripts/
    import_historical_csv.py   — generator historical_import_generated.sql
                                  (uruchom ponownie po dostarczeniu nowszych
                                  wyciągów, sekcja 0c specu)
    generate_api_key.py        — tworzy klucz API + SQL insert
    reclassify_history.sql     — ponowna klasyfikacja historii po zmianie reguł
  shortcuts/           — instrukcje Skrótów krok po kroku (nie da się
                         wyeksportować binarnego .shortcut bez iOS):
                         ApplePay (automat), Wydatek (ręcznie),
                         Zrzut (paragon, zrzut zakupu, mail)
  widget/
    BudgetWidget.js     — widget Scriptable (ekran główny + blokady)
```

## Wdrożenie (Faza 0)

1. **Załóż projekt Supabase** (supabase.com, darmowy plan wystarcza).
2. **Zainstaluj Supabase CLI** i zaloguj: `supabase login`.
3. **Połącz projekt**: `supabase link --project-ref <twój-ref>` w katalogu `app/`.
4. **Migracje**: `supabase db push` (albo wklej pliki z `supabase/migrations/`
   ręcznie w kolejności 0001→0005 w SQL Editor na supabase.com).
5. **Seed**: skopiuj `supabase/seed/seed.example.sql` do `seed.sql`, wpisz własne
   konta, raty i kwoty, wklej w SQL Editor i odpal (raz).
6. **Historia**: skopiuj `scripts/accounts.example.json` do `accounts.local.json`
   (ostatnie 4 cyfry IBAN i nazwa konta jak w seedzie), potem
   `py -3 scripts/import_historical_csv.py <folder_z_CSV> supabase/seed/historical_import_generated.sql`
   i wklej wygenerowany plik w SQL Editor. Importer rozumie eksporty Santander
   (bez nagłówka, wiersz 0 = metadane konta) i Pekao (średnik, z nagłówkiem).
7. **Sekrety**: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-...`
   (potrzebne do `ingest-receipt`: paragony, zrzuty zakupów, maile). Opcjonalnie
   `OCR_MODEL` (domyślnie `claude-opus-5`; tańszy wariant np. `claude-sonnet-5`).
8. **Deploy funkcji**: `supabase functions deploy widget transactions
   ingest-applepay ingest-sms ingest-receipt period windfall import-csv
   review balances` (dziesięć funkcji, wszystkie w `supabase/functions/`).
9. **Klucze API**: `py -3 scripts/generate_api_key.py "Skrót ApplePay" ingest`
   dla każdego kanału. Dostępne scope'y (jeden na Edge Function):
   `ingest` (applepay/sms/receipt), `transactions`, `widget`, `period`,
   `windfall`, `review`, `balances`, `import`. Minimalny zestaw kluczy:
   - Skróty (ApplePay + Wydatek + Zrzut): `ingest,transactions`
   - Scriptable (widget): `widget`
   - Dashboard (gdy powstanie, Faza 3): wszystkie razem
     (`ingest,transactions,widget,period,windfall,review,balances,import`)
   Wklej wygenerowany SQL insert w SQL Editor.

## Jeśli wgrałeś już wcześniejszą wersję (migracje 0001-0004)

Pliki 0002 i 0003 zostały poprawione w miejscu (błędy, patrz niżej), a 0005 jest
nowy. Wszystkie są idempotentne:

1. Odpal ponownie `0002_functions.sql`, `0003_triggers_cron.sql`, potem
   `0005_documents_intermediaries.sql`.
2. Jeśli historia była wgrana starą wersją importera (merchant brany z opisu
   zamiast z kontrahenta, więc raty, czynsz i wypłata nie dopasowały się do
   szablonów), usuń ją i wgraj nową:
   `delete from transactions where source = 'csv';` a potem
   `historical_import_generated.sql` (wpisy z Apple Pay, ręczne i z paragonów
   zostają).
3. Po zmianie reguł lub szablonów: `scripts/reclassify_history.sql`.

Co było źle w wersji z 15.09 (znalezione przy przeglądzie, kod nie był wcześniej
uruchamiany): dedup używał `abs()` na interwale, którego Postgres nie ma;
normalizacja nie zdejmowała polskich ogonków, więc reguły i szablony z seeda nie
trafiały; trigger linii okresu łamał klucz obcy przy każdym wpisie stałego
kosztu; importer brał opis zamiast kontrahenta i miał błędny wzorzec opisu
płatności kartą; dwa identyczne wiersze (dwa bilety 6,50 tego samego dnia)
scalały się w jeden; rollover nigdy nie zamykał okresu; wpływy nieznane
księgowały się jako ujemny wydatek.

## Weryfikacja (kryteria akceptacji ze specu, sekcja 7.1)

```sql
-- po seedzie + imporcie historii:
select sts_month, sts_remaining, sts_daily, days_left, color from widget_state;
-- powinno pokazać bieżący miesiąc, sts_month ~2175 (do korekty po Fazie 0c)

select count(*) from transactions where source = 'csv';  -- 751

select count(*) from transactions where status = 'needs_review';
-- historia jest wymuszona na 'confirmed' (patrz import_historical_csv.py
-- krok 3), więc to powinno być 0 zaraz po imporcie — needs_review pojawi
-- się dopiero z NOWYCH transakcji (Faza 2)
```

Test `GET /widget`:
```bash
curl -H "X-Api-Key: <klucz ze scope widget>" \
  https://<projekt>.supabase.co/functions/v1/widget
```

## Kolejność faz (spec sekcja 7)

- **0b** (30 min Tomka, telefon): test automatyzacji Skrótów "Transakcja"
  (`shortcuts/BUDGET_ApplePay.md`) + widget Scriptable na ekranie blokady.
- **1**: `shortcuts/BUDGET_Wydatek.md` — ręczny MVP, żyć z tym tydzień.
- **2**: automaty (`ingest-applepay` już gotowy w kodzie, podłączyć Skrót).
- **3**: rollover cron (już w migracji 0003, wymaga dopięcia pg_net do
  wywołania powiadomień — patrz komentarz w `0003_triggers_cron.sql`),
  paragon OCR (`ingest-receipt` już gotowy), dashboard web.
- **0c**: po nowym wyciągu i zmianie rat — przegenerować
  `historical_import_generated.sql` z nowym zakresem dat, skorygować
  `recurring_templates` (koniec raty roweru, realna kwota czynszu
  strumień 2) bezpośrednio w SQL Editor.

## Czego tu jeszcze nie ma

**Kod nie był uruchomiony.** Nie ma w tej sesji Postgresa ani Deno, więc
migracje, seed i Edge Functions przeszły tylko przegląd ręczny i statyczną
kontrolę (nawiasy, zgodność parametrów RPC z sygnaturami SQL). Pierwsze
uruchomienie na Supabase to prawdziwy test: błędy składni wyjdą w SQL Editor
przy migracji, wklej treść błędu.

Kasowanie zdjęć paragonów po 90 dniach (spec 4.7) nie jest zaimplementowane.
Bucket jest prywatny, ale pliki zostają, dopóki ich ktoś nie usunie. Nie kasuj
ich przez `delete from storage.objects` (zostają osierocone pliki), tylko przez
API storage albo panel.

Dashboard web (sekcja 4.5 specu) — Edge Functions (`period`, `review`,
`windfall`, `balances`) są gotowe jako API, ale front-end (HTML dziedziczący
design z `Budget-Dashboard_v3.html`) nie jest jeszcze napisany. Ścieżka SMS
(`ingest-sms`) jest zaimplementowana, ale nieaktywna — Tomek ma Alerty24
wyłączone (potwierdzone 2026-09-15), włączyć dopiero jeśli rekonsyliacja
pokaże dziury w BLIK-ach.
