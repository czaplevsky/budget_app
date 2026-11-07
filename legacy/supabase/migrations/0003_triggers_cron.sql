-- BUDGET realtime app — triggery + pg_cron
-- Spec sekcja 4.3, 5.2, 2.5. Idempotentne (create or replace / drop trigger if exists).

-- ---------------------------------------------------------------------------
-- BEFORE INSERT/UPDATE na transactions: merchant_norm, dedup_hash, period_id.
-- Okres liczony wg czasu warszawskiego (transakcja 00:30 pierwszego dnia
-- miesiąca ma trafić do nowego miesiąca, a w UTC byłby jeszcze stary).
-- ---------------------------------------------------------------------------
create or replace function trg_tx_before_write() returns trigger language plpgsql as $$
begin
  new.merchant_norm := fn_normalize_merchant(new.merchant_raw);
  if new.dedup_hash is null then
    new.dedup_hash := fn_dedup_hash(new.account_id, new.amount,
                        (new.occurred_at at time zone 'Europe/Warsaw')::date, new.merchant_raw);
  end if;
  if new.period_id is null then
    new.period_id := fn_open_period((new.occurred_at at time zone 'Europe/Warsaw')::date);
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists tx_before_write on transactions;
create trigger tx_before_write
  before insert or update on transactions
  for each row execute function trg_tx_before_write();

-- ---------------------------------------------------------------------------
-- AFTER: przelicz widget_state (przy DELETE NEW nie istnieje)
-- ---------------------------------------------------------------------------
create or replace function trg_tx_after_write() returns trigger language plpgsql as $$
declare v_period uuid;
begin
  v_period := case when tg_op = 'DELETE' then old.period_id else new.period_id end;
  if v_period is not null then
    perform fn_recompute_widget_state(v_period);
  end if;
  return null;
end $$;

drop trigger if exists tx_after_write on transactions;
create trigger tx_after_write
  after insert or update or delete on transactions
  for each row execute function trg_tx_after_write();

-- ---------------------------------------------------------------------------
-- BEFORE INSERT: transakcja z szablonu stałego/rezerwy/oszczędzania oznacza
-- linię okresu jako paid i liczy różnicę kwoty (fixed_variance).
-- Dopasowanie WYŁĄCZNIE po template_id z fn_classify (nie po kategorii:
-- trzy linie "Oszczędności/cele" albo dwie "Subskrypcje" dałyby złą linię).
-- Wymaga FK period_lines.transaction_id jako DEFERRABLE INITIALLY DEFERRED
-- (migracja 0005): w BEFORE INSERT wiersz transakcji jeszcze nie istnieje.
-- Nazwa triggera sortuje się po tx_before_write, więc period_id jest już ustawiony.
-- ---------------------------------------------------------------------------
create or replace function trg_tx_link_period_line() returns trigger language plpgsql as $$
declare
  v_line period_lines%rowtype;
begin
  if new.kind not in ('fixed','sinking','savings')
     or new.period_line_id is not null
     or new.template_id is null then
    return new;
  end if;

  select * into v_line from period_lines
    where period_id = new.period_id and template_id = new.template_id
      and status in ('planned','overdue')
    order by due_date asc limit 1;

  if found then
    update period_lines
      set status = 'paid', amount_actual = abs(new.amount), transaction_id = new.id
      where id = v_line.id;
    update budget_periods
      set fixed_variance = fixed_variance + (abs(new.amount) - v_line.amount_planned)
      where id = new.period_id;
    new.period_line_id := v_line.id;
  end if;
  return new;
end $$;

drop trigger if exists tx_link_period_line on transactions;
create trigger tx_link_period_line
  before insert on transactions
  for each row execute function trg_tx_link_period_line();

-- ---------------------------------------------------------------------------
-- AFTER INSERT: windfall = wpływ klasy windfall albo wypłata ponad szablon
-- (sekcja 2.3, 2.6). Historia wstawiana jako 'variable' i klasyfikowana
-- UPDATE-em nie tworzy windfalli (świadomie: historia jest informacyjna).
-- ---------------------------------------------------------------------------
create or replace function trg_tx_windfall() returns trigger language plpgsql as $$
declare
  v_tpl recurring_templates%rowtype;
begin
  if new.kind = 'windfall' and new.amount > 0 then
    insert into windfalls (transaction_id, amount) values (new.id, new.amount);
  elsif new.kind = 'income' then
    select * into v_tpl from recurring_templates
      where kind = 'income'
        and active_from <= (new.occurred_at at time zone 'Europe/Warsaw')::date
        and (active_to is null or active_to >= (new.occurred_at at time zone 'Europe/Warsaw')::date)
      order by amount_expected desc limit 1;
    if found and new.amount > (v_tpl.amount_expected + v_tpl.amount_tolerance) then
      insert into windfalls (transaction_id, amount) values (new.id, new.amount - v_tpl.amount_expected);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists tx_windfall on transactions;
create trigger tx_windfall
  after insert on transactions
  for each row execute function trg_tx_windfall();

-- ---------------------------------------------------------------------------
-- Rollover: zamyka okresy, które się skończyły, i otwiera bieżący.
-- Idempotentny, więc job może chodzić co godzinę (pg_cron liczy w UTC, a
-- "dzień" ma być warszawski, więc zamiast jednego strzału o 00:05 sprawdzamy
-- co godzinę, czy jest co zamknąć). Nadwyżka domyślnie 'carry'; decyzję
-- "przelej na Poduszkę" Tomek podejmuje w dashboardzie (period/:id/close).
-- ---------------------------------------------------------------------------
create or replace function fn_rollover() returns void language plpgsql as $$
declare r record;
begin
  for r in select id from budget_periods where status = 'open' and period_end < fn_today() loop
    perform fn_close_period(r.id, 'carry');
  end loop;
  perform fn_open_period(fn_today());
  perform fn_recompute_widget_state(
    (select id from budget_periods where status = 'open' order by period_start desc limit 1));
end $$;

create extension if not exists pg_net;

-- cron.schedule z tą samą nazwą nadpisuje poprzednią definicję joba
select cron.schedule('budget_rollover', '5 * * * *', $$select fn_rollover()$$);

-- Powiadomienia (status dzienny, guardy) idą z Edge Function przez pg_net:
-- wymaga URL projektu i klucza jako sekrety, dopinane w Fazie 3.
