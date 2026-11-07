-- BUDGET realtime app — schema
-- Schemat tabel; opis architektury w docs/wizualizacja.html
-- Postgres 15+ (Supabase). Idempotent: safe to re-run.

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";  -- merchant fuzzy match (dedup, sekcja 3.7)
create extension if not exists "pg_cron";  -- rollover / status cron (sekcja 4.3, 5.2)

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
create table if not exists accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  bank            text not null check (bank in ('santander','pekao','revolut','freedom24','wallet','cash','other')),
  type            text not null check (type in ('checking','savings','goal','credit_card','loan','investment','crypto','ewallet','cash')),
  iban_masked     text,
  currency        char(3) not null default 'PLN',
  is_own          boolean not null default true,
  budget_role     text not null default 'ignore' check (budget_role in ('main','savings','ignore')),
  opening_balance numeric(12,2) not null default 0,
  opening_date    date,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  group_name  text not null check (group_name in ('variable','fixed','sinking','savings','income','transfer')),
  soft_limit  numeric(10,2),
  sort_order  int not null default 100,
  active      boolean not null default true
);

-- ---------------------------------------------------------------------------
-- recurring_templates — źródło linii okresu (sekcja 1.3-1.5, 5.3)
-- ---------------------------------------------------------------------------
create table if not exists recurring_templates (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  kind               text not null check (kind in ('fixed','sinking','savings','income')),
  category_id        uuid references categories(id),
  account_id         uuid references accounts(id),
  amount_expected    numeric(10,2) not null,
  amount_tolerance   numeric(10,2) not null default 0,
  cadence            text not null check (cadence in ('monthly','yearly','once')),
  day_of_month       int check (day_of_month between 1 and 31),
  month_of_year      int check (month_of_year between 1 and 12),
  match_pattern      text not null,       -- regex na merchant_norm / opis / IBAN
  active_from        date not null default current_date,
  active_to          date,
  notes              text,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- budget_periods — jeden miesiąc kalendarzowy (sekcja 2.5)
-- ---------------------------------------------------------------------------
create table if not exists budget_periods (
  id               uuid primary key default gen_random_uuid(),
  period_start     date not null unique,
  period_end       date not null,
  status           text not null default 'open' check (status in ('open','closing','closed')),
  income_planned   numeric(10,2) not null default 0,
  fixed_planned    numeric(10,2) not null default 0,
  sinking_planned  numeric(10,2) not null default 0,
  savings_planned  numeric(10,2) not null default 0,
  carryover_in     numeric(10,2) not null default 0,
  sts_month        numeric(10,2) not null default 0,
  income_actual    numeric(10,2) not null default 0,
  variable_actual  numeric(10,2) not null default 0,
  fixed_variance   numeric(10,2) not null default 0,
  leftover         numeric(10,2),
  leftover_action  text check (leftover_action in ('to_pillow','carry','ignore')),
  closed_at        timestamptz,
  snapshot         jsonb,
  created_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- period_lines — instancje szablonów w danym okresie
-- ---------------------------------------------------------------------------
create table if not exists period_lines (
  id               uuid primary key default gen_random_uuid(),
  period_id        uuid not null references budget_periods(id) on delete cascade,
  template_id      uuid references recurring_templates(id),
  kind             text not null check (kind in ('fixed','sinking','savings','income')),
  category_id      uuid references categories(id),
  amount_planned   numeric(10,2) not null,
  amount_actual    numeric(10,2),
  due_date         date,
  status           text not null default 'planned' check (status in ('planned','paid','overdue','skipped')),
  transaction_id   uuid,  -- fk added after transactions table exists
  created_at       timestamptz not null default now()
);
create index if not exists idx_period_lines_period on period_lines(period_id);

-- ---------------------------------------------------------------------------
-- transactions — rejestr wszystkich zdarzeń pieniężnych (sekcja 2.3)
-- ---------------------------------------------------------------------------
create table if not exists transactions (
  id               uuid primary key default gen_random_uuid(),
  occurred_at      timestamptz not null,
  booked_at        date,
  amount           numeric(12,2) not null,       -- PLN, ujemne = wydatek
  amount_original  numeric(12,2) not null,
  currency         char(3) not null default 'PLN',
  fx_rate          numeric(10,6),
  account_id       uuid references accounts(id),
  merchant_raw     text,
  merchant_norm    text,
  category_id      uuid references categories(id),
  kind             text not null default 'variable'
                     check (kind in ('fixed','sinking','savings','savings_withdrawal','transfer','income','windfall','variable','refund','ignored')),
  source           text not null check (source in ('applepay','sms','receipt','manual','csv','openbanking')),
  source_ref       text,
  dedup_hash       text,
  status           text not null default 'confirmed' check (status in ('pending','confirmed','needs_review','ignored')),
  confidence       numeric(3,2),
  period_id        uuid references budget_periods(id),
  period_line_id   uuid references period_lines(id),
  merged_into      uuid references transactions(id),
  parent_id        uuid references transactions(id),
  receipt_path     text,
  note             text,
  raw_payload      jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_tx_period_kind_status on transactions(period_id, kind, status);
create index if not exists idx_tx_dedup on transactions(dedup_hash);
create index if not exists idx_tx_occurred on transactions(occurred_at);
create index if not exists idx_tx_merchant_trgm on transactions using gin (merchant_norm gin_trgm_ops);

alter table period_lines
  add constraint fk_period_lines_transaction
  foreign key (transaction_id) references transactions(id);

-- ---------------------------------------------------------------------------
-- merchant_rules — słownik sklep -> kategoria/kind (sekcja 5.3, załącznik A)
-- ---------------------------------------------------------------------------
create table if not exists merchant_rules (
  id            uuid primary key default gen_random_uuid(),
  pattern       text not null,           -- ILIKE/regex na merchant_norm
  category_id   uuid references categories(id),
  kind          text not null check (kind in ('fixed','sinking','savings','transfer','income','windfall','variable')),
  template_id   uuid references recurring_templates(id),
  priority      int not null default 100,
  learned       boolean not null default false,
  hits          int not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists idx_merchant_rules_priority on merchant_rules(priority);

-- ---------------------------------------------------------------------------
-- sms_patterns — parsery SMS per bank (ścieżka B, opcjonalna — sekcja 3.3)
-- ---------------------------------------------------------------------------
create table if not exists sms_patterns (
  id          uuid primary key default gen_random_uuid(),
  bank        text not null,
  regex       text not null,
  field_map   jsonb not null,   -- {"amount": 1, "merchant": 2, "balance": 3}
  active      boolean not null default true,
  version     int not null default 1
);

-- ---------------------------------------------------------------------------
-- sinking_funds (rezerwy nieregularne — ubezpieczenia, czynsz strumień 2)
-- ---------------------------------------------------------------------------
create table if not exists sinking_funds (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  template_id    uuid references recurring_templates(id),
  balance        numeric(10,2) not null default 0,
  target_yearly  numeric(10,2)
);
create table if not exists sinking_fund_movements (
  id              uuid primary key default gen_random_uuid(),
  fund_id         uuid not null references sinking_funds(id) on delete cascade,
  period_id       uuid references budget_periods(id),
  amount          numeric(10,2) not null,
  type            text not null check (type in ('accrual','spend')),
  transaction_id  uuid references transactions(id),
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- goals (np. konto wakacyjne, bez targetu i terminu)
-- ---------------------------------------------------------------------------
create table if not exists goals (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  target     numeric(10,2),
  current    numeric(10,2) not null default 0,
  monthly    numeric(10,2) not null default 0,
  account_id uuid references accounts(id),
  deadline   date,
  status     text not null default 'active' check (status in ('active','paused','closed'))
);

-- ---------------------------------------------------------------------------
-- windfalls — przychody poza planem (sekcja 2.2, 2.6, 0.2 pkt 8)
-- ---------------------------------------------------------------------------
create table if not exists windfalls (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references transactions(id),
  amount          numeric(10,2) not null,
  allocated_to    text check (allocated_to in ('sts','pillow','goal','mortgage')),
  allocated_goal_id uuid references goals(id),
  allocated_amount  numeric(10,2),
  allocated_at    timestamptz,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- balances_snapshots — saldo kont (ręczne / SMS / CSV / open banking)
-- ---------------------------------------------------------------------------
create table if not exists balances_snapshots (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references accounts(id),
  as_of       timestamptz not null default now(),
  balance     numeric(12,2) not null,
  source      text not null check (source in ('manual','sms','csv','openbanking'))
);
create index if not exists idx_balances_account_asof on balances_snapshots(account_id, as_of desc);

-- ---------------------------------------------------------------------------
-- widget_state — jeden wiersz, przeliczany triggerem (sekcja 4.3, 4.4)
-- ---------------------------------------------------------------------------
create table if not exists widget_state (
  id                   int primary key default 1 check (id = 1),
  period_id            uuid references budget_periods(id),
  sts_month            numeric(10,2) not null default 0,
  sts_remaining        numeric(10,2) not null default 0,
  sts_daily            numeric(10,2) not null default 0,
  days_left            int not null default 0,
  spent_mtd            numeric(10,2) not null default 0,
  pace_ratio           numeric(6,3),
  color                text not null default 'green' check (color in ('green','yellow','red','red_full')),
  next_fixed           jsonb,
  needs_review_count   int not null default 0,
  savings_withdrawn_mtd numeric(10,2) not null default 0,
  windfall_unallocated  numeric(10,2) not null default 0,
  updated_at           timestamptz not null default now()
);
insert into widget_state (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- reconciliation_diffs — CSV/open banking vs rejestr (sekcja 5.2 fn_reconcile)
-- ---------------------------------------------------------------------------
create table if not exists reconciliation_diffs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('missing_in_app','missing_in_bank','amount_diff')),
  transaction_id uuid references transactions(id),
  import_row  jsonb not null,
  resolved    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ingest_log — surowy payload PRZED przetworzeniem (nigdy nie gubić danych)
-- ---------------------------------------------------------------------------
create table if not exists ingest_log (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,
  received_at    timestamptz not null default now(),
  payload        jsonb not null,
  result         text,     -- ok | unparsed | error
  error          text,
  transaction_id uuid references transactions(id)
);

-- ---------------------------------------------------------------------------
-- api_keys — klucze per urządzenie/kanał, scope ograniczony (sekcja 4.7)
-- ---------------------------------------------------------------------------
create table if not exists api_keys (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  key_hash    text not null unique,   -- sha256(klucz), nigdy plaintext
  scopes      text[] not null default '{}',
  last_used   timestamptz,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS: wszystko zamknięte, dostęp wyłącznie przez Edge Functions
-- z kluczem serwisowym (service_role bypassuje RLS). anon key nieużywany.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in select unnest(array[
    'accounts','categories','recurring_templates','budget_periods','period_lines',
    'transactions','merchant_rules','sms_patterns','sinking_funds','sinking_fund_movements',
    'goals','windfalls','balances_snapshots','widget_state','reconciliation_diffs',
    'ingest_log','api_keys'
  ])
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
