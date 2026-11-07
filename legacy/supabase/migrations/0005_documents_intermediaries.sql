-- BUDGET realtime app — dokumenty (paragony, zrzuty), operatorzy płatności, BNPL
-- Spec sekcja 3.5. Idempotentne, można odpalić na bazie po 0001-0004.

-- ---------------------------------------------------------------------------
-- Nowe kolumny
-- ---------------------------------------------------------------------------
alter table transactions
  add column if not exists payment_method text
    check (payment_method in ('card','applepay','blik','transfer','bnpl','cash','unknown')),
  add column if not exists bnpl_due date,                          -- termin spłaty (PayPo itp.)
  add column if not exists bnpl_settled_by uuid references transactions(id),
  add column if not exists bank_descriptor text,                   -- co widać w banku, np. 'PAYPRO S.A.'
  add column if not exists template_id uuid references recurring_templates(id);

create index if not exists idx_tx_bnpl_open
  on transactions(bnpl_due) where payment_method = 'bnpl' and bnpl_settled_by is null;

alter table widget_state
  add column if not exists bnpl_open numeric(10,2) not null default 0;

-- ---------------------------------------------------------------------------
-- FK period_lines.transaction_id musi być odroczony: trigger BEFORE INSERT na
-- transactions (0003) wpisuje id transakcji, której wiersza jeszcze nie ma.
-- ---------------------------------------------------------------------------
alter table period_lines drop constraint if exists fk_period_lines_transaction;
alter table period_lines
  add constraint fk_period_lines_transaction
  foreign key (transaction_id) references transactions(id)
  deferrable initially deferred;

-- ---------------------------------------------------------------------------
-- fn_find_receipt_match: do którego wpisu pasuje paragon / zrzut zamówienia?
--  1) 'duplicate_receipt': ten sam zakup zrzucony drugi raz
--  2) 'bank_row': wpis z banku / Apple Pay, który tylko nie wie, co kupiono
--     (operator płatności po stronie banku = sklep nie musi się zgadzać)
-- Zwraca 0 lub 1 wiersz.
-- ---------------------------------------------------------------------------
create or replace function fn_find_receipt_match(p_amount numeric, p_occurred timestamptz, p_merchant text)
returns table(match_id uuid, match_type text)
language plpgsql stable as $$
declare
  norm text := fn_normalize_merchant(p_merchant);
  cid uuid;
begin
  select t.id into cid
  from transactions t
  where t.source = 'receipt' and t.merged_into is null and t.status <> 'ignored'
    and abs(t.amount - p_amount) <= 0.01
    and abs(extract(epoch from (t.occurred_at - p_occurred))) <= 2 * 86400
    and (norm is null or t.merchant_norm is null or similarity(t.merchant_norm, norm) >= 0.5)
  order by abs(extract(epoch from (t.occurred_at - p_occurred))) asc
  limit 1;
  if cid is not null then
    return query select cid, 'duplicate_receipt'::text;
    return;
  end if;

  select t.id into cid
  from transactions t
  where t.source <> 'receipt' and t.merged_into is null and t.status <> 'ignored'
    and t.receipt_path is null
    and t.kind in ('variable', 'refund')
    and abs(t.amount - p_amount) <= 0.01
    and abs(extract(epoch from (t.occurred_at - p_occurred))) <= 5 * 86400
    and (fn_is_intermediary(t.merchant_norm) or fn_is_intermediary(t.merchant_raw)
         or t.merchant_norm is null or similarity(t.merchant_norm, norm) >= 0.35)
  order by (case when fn_is_intermediary(t.merchant_norm) then 0 else 1 end),
           abs(extract(epoch from (t.occurred_at - p_occurred))) asc
  limit 1;
  if cid is not null then
    return query select cid, 'bank_row'::text;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- BNPL (PayPo, Klarna): wydatek liczy się w dniu zakupu (zrzut), późniejszy
-- przelew do operatora to NIE drugi wydatek, tylko rozliczenie. Przelew
-- rozlicza najstarsze otwarte zakupy BNPL po kolei (FIFO) i tylko tak długo,
-- jak kwota starcza na cały zakup; reszta (np. odsetki) zostaje bez efektu.
-- ---------------------------------------------------------------------------
create or replace function fn_refresh_bnpl_open() returns void language sql as $$
  update widget_state set bnpl_open = coalesce((
    select sum(-t.amount) from transactions t
    where t.payment_method = 'bnpl' and t.bnpl_settled_by is null and t.status <> 'ignored'), 0)
  where id = 1
$$;

create or replace function fn_settle_bnpl(p_amount numeric, p_settled_by uuid) returns void
language plpgsql as $$
declare
  remaining numeric := abs(p_amount);
  r record;
begin
  for r in
    select t.id, abs(t.amount) as amt from transactions t
    where t.payment_method = 'bnpl' and t.bnpl_settled_by is null and t.status <> 'ignored'
    order by t.bnpl_due asc nulls last, t.occurred_at asc
  loop
    exit when remaining + 0.005 < r.amt;
    update transactions set bnpl_settled_by = p_settled_by where id = r.id;
    remaining := remaining - r.amt;
  end loop;
end $$;

create or replace function trg_tx_bnpl() returns trigger language plpgsql as $$
declare v_settlement boolean;
begin
  v_settlement := tg_op = 'INSERT' and new.kind = 'transfer' and new.amount < 0
                  and new.merchant_norm ~* 'PAYPO|KLARNA';
  if v_settlement then
    perform fn_settle_bnpl(new.amount, new.id);
  end if;
  if v_settlement or new.payment_method = 'bnpl'
     or (tg_op = 'UPDATE' and old.payment_method is distinct from new.payment_method) then
    perform fn_refresh_bnpl_open();
  end if;
  return null;
end $$;

drop trigger if exists tx_bnpl on transactions;
create trigger tx_bnpl
  after insert or update on transactions
  for each row execute function trg_tx_bnpl();

-- kategoria + reguła: przelew do PayPo/Klarna to rozliczenie, nie wydatek
insert into categories (name, group_name, sort_order)
  select 'Spłata BNPL (PayPo)', 'transfer', 610
  where not exists (select 1 from categories where name = 'Spłata BNPL (PayPo)');

insert into merchant_rules (pattern, category_id, kind, priority)
  select 'PAYPO|KLARNA', (select id from categories where name = 'Spłata BNPL (PayPo)'), 'transfer', 69
  where not exists (select 1 from merchant_rules where pattern = 'PAYPO|KLARNA');
