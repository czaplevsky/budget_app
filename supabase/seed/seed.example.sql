-- BUDGET realtime app: seed WZOROWY.
-- Skopiuj do supabase/seed/seed.sql (ten plik jest w .gitignore), wpisz własne
-- konta, raty i kwoty i odpal PO migracjach, tylko RAZ (tabele kont, szablonów
-- i reguł nie mają unikalnych kluczy, drugie uruchomienie zdubluje wiersze).
-- Kwoty i wzorce poniżej są przykładowe.

-- ---------------------------------------------------------------------------
-- accounts: iban_masked to tylko ostatnie 4 cyfry, wystarczy do rozpoznania
-- ---------------------------------------------------------------------------
insert into accounts (name, bank, type, iban_masked, currency, is_own, budget_role, opening_balance, opening_date) values
  ('Konto główne',          'other', 'checking',    '... 0001', 'PLN', true, 'main',    0, current_date),
  ('Karta kredytowa',       'other', 'credit_card', '... 0002', 'PLN', true, 'ignore',  0, current_date),
  ('Konto oszczędnościowe', 'other', 'savings',     '... 0003', 'PLN', true, 'savings', 0, current_date),
  ('Gotówka',               'cash',  'cash',        null,       'PLN', true, 'ignore',  0, current_date);

-- ---------------------------------------------------------------------------
-- categories (sekcja 1.6, limity miękkie z sekcji 2.7)
-- ---------------------------------------------------------------------------
insert into categories (name, group_name, soft_limit, sort_order) values
  ('Spożywcze',                  'variable', 450, 10),
  ('Jedzenie poza domem',        'variable', 350, 20),
  ('Zakupy/odzież/dom',          'variable', 250, 30),
  ('Inne',                       'variable', 250, 40),
  ('Płatność online (pośrednik)','variable', null, 45),
  ('Zdrowie - apteka',           'variable', 100, 50),
  ('Zdrowie - usługi medyczne',  'variable', 100, 55),
  ('Sport/rekreacja',            'variable', 150, 60),
  ('Transport',                  'variable', 150, 70),
  ('Gotówka (bankomat)',         'variable', 50,  80),
  ('Podróże',                    'variable', null, 85),
  ('Opłaty miejskie/mandaty',    'variable', 40,  90),
  ('Dom/ogród',                  'variable', null, 95),
  ('Drogeria/chemia',            'variable', 50,  100),
  ('Opłaty bankowe',             'variable', 20,  110),
  ('Usługi (pralnia itp.)',      'variable', null, 115),
  ('Mieszkanie - rata hipoteki', 'fixed', null, 200),
  ('Mieszkanie - czynsz/wspólnota','fixed', null, 205),
  ('Kredyt gotówkowy (nadpłata hipoteki)', 'fixed', null, 207),
  ('Rower/sprzęt + raty',        'fixed', null, 210),
  ('Media (internet/energia)',   'fixed', null, 215),
  ('Telefon',                    'fixed', null, 220),
  ('Subskrypcje',                'fixed', null, 225),
  ('Sport/rekreacja - abonament','fixed', null, 226),
  ('Ubezpieczenia',              'sinking', null, 300),
  ('Czynsz strumień 2 (Autopay)','sinking', null, 305),
  ('Oszczędności/cele',          'savings', null, 400),
  ('Przychód - wynagrodzenie',   'income', null, 500),
  ('Przychód - inne (windfall)', 'income', null, 505),
  ('Transfer wewnętrzny',        'transfer', null, 600),
  ('Spłata karty (uznanie)',     'transfer', null, 605),
  ('Nieprzypisane',              'variable', null, 999)
on conflict (name) do nothing;


-- ---------------------------------------------------------------------------
-- recurring_templates: koszty stałe, rezerwy, oszczędzanie, wypłata.
-- match_pattern to regex na znormalizowanej nazwie (wielkie litery, bez ogonków).
-- ---------------------------------------------------------------------------
insert into recurring_templates (name, kind, category_id, amount_expected, amount_tolerance, cadence, day_of_month, month_of_year, match_pattern, active_from, active_to, notes)
values
  ('Kredyt hipoteczny', 'fixed', (select id from categories where name='Mieszkanie - rata hipoteki'),
    2000.00, 60, 'monthly', 15, null, 'SPLATA KREDYTU', '2026-01-01', null, null),
  ('Czynsz', 'fixed', (select id from categories where name='Mieszkanie - czynsz/wspólnota'),
    500.00, 20, 'monthly', 5, null, 'WSPOLNOTA|CZYNSZ', '2026-01-01', null, null),
  ('Internet', 'fixed', (select id from categories where name='Media (internet/energia)'),
    55.00, 0, 'monthly', 22, null, 'NETIA|INTERNET', '2026-01-01', null, null),
  ('Telefon', 'fixed', (select id from categories where name='Telefon'),
    29.00, 0, 'monthly', 11, null, 'ORANGE|PLAY|PLUS', '2026-01-01', null, null),
  ('Subskrypcja', 'fixed', (select id from categories where name='Subskrypcje'),
    15.00, 1, 'monthly', 10, null, 'APPLE\.COM/BILL', '2026-01-01', null, 'obciążenie kartą'),
  ('Ubezpieczenie', 'sinking', (select id from categories where name='Ubezpieczenia'),
    700.00, 50, 'yearly', 15, 3, 'PZU|ERGO', '2026-01-01', null, 'roczne'),
  ('Oszczędzanie (auto-wpłata)', 'savings', (select id from categories where name='Oszczędności/cele'),
    500.00, 0, 'monthly', 11, null, 'OSZCZEDZANIE|WPLATA AUTOMATYCZNA', '2026-01-01', null, null),
  ('Wynagrodzenie', 'income', (select id from categories where name='Przychód - wynagrodzenie'),
    7000.00, 300, 'monthly', 5, null, 'WYPLATA|WYNAGRODZENIE', '2026-01-01', null,
    'nadwyżka ponad tolerancję trafia do windfalli (trigger tx_windfall)');

-- ---------------------------------------------------------------------------
-- merchant_rules — słownik (sekcja 5.3, załącznik A specu)
-- priority: niższa liczba = trafia pierwsza. Zakresy: 10-19 spożywcze,
-- 20-29 jedzenie poza domem, 30-39 transport, 40-49 sport, 50-59 zdrowie,
-- 60-69 zakupy, 70-79 pośrednicy/needs_review, 80-89 transfery, 90-99 inne.
-- ---------------------------------------------------------------------------
insert into merchant_rules (pattern, category_id, kind, priority) values
  ('ALDI|LIDL|BIEDRONKA|JMP|ZABKA|SPAR|EUROSPAR|AUCHAN|POLOMARKET|ALKO OUTLET', (select id from categories where name='Spożywcze'), 'variable', 10),
  ('KEBAB|MCDONALDS|PREGO|MURALL|MASNA|PIEKARNIA|CYNAMONKA|MONO KITCHEN|THALI|PYSZNE\.PL|GYOZILLA|CURRY LEAVES', (select id from categories where name='Jedzenie poza domem'), 'variable', 20),
  ('ORLEN|^BP-|^MOL |SHELL|BOLT\.EU|UBER|UBR\*|JAKDOJADE|GTC.*AUTOSTRADA|PUNKT POBORU OPLAT|APCOA', (select id from categories where name='Transport'), 'variable', 30),
  ('PROBLEM BOULDER|CRACKPARK|KREGIELNIA|BLM\*KREGIELNIA', (select id from categories where name='Sport/rekreacja'), 'variable', 40),
  ('APTEKA|FARMACJA|GEMINI', (select id from categories where name='Zdrowie - apteka'), 'variable', 50),
  ('DENTAURUS|BALTICARE|COSMEDICA|MEDFILE', (select id from categories where name='Zdrowie - usługi medyczne'), 'variable', 51),
  ('ZALANDO|RESERVED|LPP |ALIEXPRESS|LIMANGO|DECATHLON|^ACTION |ERLI\.PL', (select id from categories where name='Zakupy/odzież/dom'), 'variable', 60),
  ('ROSSMANN', (select id from categories where name='Drogeria/chemia'), 'variable', 61),
  ('PAYPRO|TPAY\.COM|PAYU |AUTOPAY(?!.*EKSN)', (select id from categories where name='Płatność online (pośrednik)'), 'variable', 70),
  ('SPLATA KARTY KREDYTOWEJ|SPLATA NALEZNOSCI', null, 'transfer', 80),
  ('REVOLUT', null, 'transfer', 81),
  ('WYPLATA Z CELU', null, 'transfer', 82),
  ('POBRANE ODSETKI OD SALDA|OPLATA ZA PRZEWALUTOWANIE|OPLATA ZA ALERTY24', (select id from categories where name='Opłaty bankowe'), 'variable', 90),
  ('BANKOMAT|WYPLATA BLIK BANKOMAT', (select id from categories where name='Gotówka (bankomat)'), 'variable', 91),
  ('ZWROT Z PODATKU PIT|FUNDACJA DKMS|NAGRODA W PROMOCJI', (select id from categories where name='Przychód - inne (windfall)'), 'windfall', 95)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Otwórz okres bieżący (wrzesień 2026) i następny, żeby widget_state
-- istniał od razu po seedzie.
-- ---------------------------------------------------------------------------
select fn_open_period(fn_today());
