-- BUDGET realtime app — funkcje
-- Spec sekcja 5.2. Wszystko idempotentne (create or replace).

-- ---------------------------------------------------------------------------
-- fn_normalize_merchant: upper, usuwa numery sklepów/miasta/spółki/szumy
-- (wzorce z sekcji 3.7 i analizy słownika w załączniku A specu)
-- ---------------------------------------------------------------------------
create or replace function fn_today() returns date language sql stable as $$
  select (now() at time zone 'Europe/Warsaw')::date
$$;

create or replace function fn_normalize_merchant(raw text)
returns text language plpgsql immutable as $$
declare s text;
begin
  if raw is null then return null; end if;
  -- wielkie litery + zdjęcie polskich ogonków (wzorce w seedzie są bez ogonków)
  s := translate(upper(raw), 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż', 'ACELNOSZZACELNOSZZ');
  s := regexp_replace(s, '\s+', ' ', 'g');
  -- numery sklepów / kart / referencje
  s := regexp_replace(s, '\bK\.\d+\b', '', 'g');
  s := regexp_replace(s, '\*+\d{4,}\*?', '', 'g');
  s := regexp_replace(s, '\bNR\.?\s*\d+\b', '', 'gi');
  s := regexp_replace(s, '\b\d{4,}\b', '', 'g');
  -- forma prawna
  s := regexp_replace(s, '\bSP\.?\s*Z\s*O\.?O\.?\b', '', 'gi');
  s := regexp_replace(s, '\bS\.?A\.?\b', '', 'g');
  -- miasta częste w wyciągach Tomka
  s := regexp_replace(s, '\b(GDANSK|GDYNIA|SOPOT|WARSZAWA|WROCLAW|POZNAN|KRAKOW|PRZEJAZDOWO|SOBIESZEWO)\b', '', 'g');
  s := trim(regexp_replace(s, '\s+', ' ', 'g'));
  return left(s, 80);   -- 80, nie 40: wzorce szablonów szukają też w kontrahencie za opisem
end $$;

-- Operatorzy płatności: w wyciągu widać ich, nie sklep (sekcja 3.5 specu).
-- Używane jako "wildcard" przy dopasowaniu zrzutu/paragonu do wpisu z banku.
create or replace function fn_is_intermediary(s text) returns boolean
language sql immutable as $$
  select coalesce(upper(s) ~ '(PAYPRO|PAYPO|TPAY|PAYU|PRZELEWY ?24|\mP24\M|BLUE ?MEDIA|IMOJE|DOTPAY|PAYNOW|KLARNA|PAYPAL|STRIPE|ADYEN|SUMUP|ZALANDO PAYMENTS|AUTOPAY)', false)
$$;

-- ---------------------------------------------------------------------------
-- fn_dedup_hash
-- ---------------------------------------------------------------------------
create or replace function fn_dedup_hash(p_account uuid, p_amount numeric, p_date date, p_merchant text)
returns text language sql immutable as $$
  select encode(sha256(convert_to(
    coalesce(p_account::text,'') || '|' || round(p_amount,2)::text || '|' ||
    p_date::text || '|' || coalesce(fn_normalize_merchant(p_merchant),''), 'UTF8')), 'hex')
$$;

-- ---------------------------------------------------------------------------
-- fn_find_dedup_candidate: sekcja 3.7 — 4 reguły dopasowania
-- source_priority: bank/csv(4) > sms(3) > applepay(2) > manual(1) > receipt(0)
-- ---------------------------------------------------------------------------
create or replace function fn_source_priority(src text) returns int language sql immutable as $$
  select case src
    when 'csv' then 4 when 'openbanking' then 4
    when 'sms' then 3
    when 'applepay' then 2
    when 'manual' then 1
    when 'receipt' then 0
    else 0 end
$$;

-- Stara sygnatura (4 argumenty) wypada: nowa ma domyślne argumenty i dwie
-- sygnatury naraz robią PostgREST niejednoznacznym przy wywołaniu RPC.
drop function if exists fn_find_dedup_candidate(uuid, numeric, timestamptz, text);

-- p_source: transakcja z TEGO źródła nie liczy się jako duplikat (dwa
--           identyczne tapnięcia Apple Pay to dwa zakupy, nie jeden).
--           Dedup działa między źródłami (applepay <-> csv <-> paragon).
-- p_skip:   id już dopasowane/wstawione w bieżącym imporcie CSV (dwa
--           identyczne wiersze w jednym wyciągu to dwie transakcje).
-- Operator płatności (PayPro, PayU...) po którejkolwiek stronie: sklep się
-- nie zgadza z natury, więc liczy się tylko kwota (co do grosza) i okno 5 dni.
create or replace function fn_find_dedup_candidate(
  p_account uuid, p_amount numeric, p_occurred timestamptz, p_merchant text,
  p_source text default null, p_skip uuid[] default '{}'
) returns uuid language plpgsql stable as $$
declare
  candidate_id uuid;
  norm text := fn_normalize_merchant(p_merchant);
  incoming_gateway boolean := fn_is_intermediary(norm);
begin
  select t.id into candidate_id
  from transactions t
  where t.merged_into is null
    and t.status <> 'ignored'
    and (p_account is null or t.account_id is null or t.account_id = p_account)
    and (p_source is null or t.source <> p_source)
    and not (t.id = any(p_skip))
    and abs(extract(epoch from (t.occurred_at - p_occurred))) <=
        (case when incoming_gateway or fn_is_intermediary(t.merchant_norm) then 5 else 3 end) * 86400
    and abs(t.amount - p_amount) <=
        (case when incoming_gateway or fn_is_intermediary(t.merchant_norm) then 0.01
              else greatest(0.01, abs(p_amount) * 0.03) end)
    and (norm is null or t.merchant_norm is null
         or similarity(t.merchant_norm, norm) >= 0.35
         or incoming_gateway or fn_is_intermediary(t.merchant_norm))
  order by abs(extract(epoch from (t.occurred_at - p_occurred))) asc
  limit 1;
  return candidate_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_classify: kind + category + template + confidence
-- Kolejność (sekcja 5.2): (1) własny IBAN -> transfer/savings,
-- (2) recurring_templates w oknie dat+tolerancji, (3) merchant_rules wg
-- priority, (4) default variable/needs_review (model dopina asynchronicznie
-- przez Edge Function, nie tutaj).
-- ---------------------------------------------------------------------------
create or replace function fn_classify(
  p_merchant text, p_amount numeric, p_occurred timestamptz, p_iban text default null
) returns table(kind text, category_id uuid, template_id uuid, confidence numeric, needs_tag boolean)
language plpgsql stable as $$
declare
  norm text := fn_normalize_merchant(p_merchant);
  own_acc accounts%rowtype;
  tpl recurring_templates%rowtype;
  mrule merchant_rules%rowtype;
  local_ts timestamp := p_occurred at time zone 'Europe/Warsaw';
  occ_date date := local_ts::date;
  dom int := extract(day from local_ts)::int;
  amount_ok boolean;
begin
  -- (1) własny rachunek po IBAN (opcjonalne; kanały bez IBAN go nie podają)
  if p_iban is not null then
    select * into own_acc from accounts
      where iban_masked is not null and p_iban like '%' || right(regexp_replace(iban_masked,'\s',''),4)
      limit 1;
    if found then
      return query select
        (case when own_acc.budget_role = 'savings' then 'savings' else 'transfer' end)::text,
        null::uuid, null::uuid, 0.95::numeric, false;
      return;
    end if;
  end if;

  -- (2) recurring_templates: wzorzec + okno dat + tolerancja kwoty
  for tpl in
    select * from recurring_templates
    where active_from <= occ_date and (active_to is null or active_to >= occ_date)
      and (norm is not null and norm ~* match_pattern)
    order by cadence desc
  loop
    if tpl.cadence = 'yearly' and tpl.month_of_year is not null
       and extract(month from local_ts) <> tpl.month_of_year then
      continue;
    end if;
    -- wypłata: dopasowanie po wzorcu zawsze (nadwyżkę łapie trigger windfall)
    amount_ok := tpl.kind = 'income'
                 or abs(abs(p_amount) - tpl.amount_expected) <= greatest(tpl.amount_tolerance, 0.01);
    if not amount_ok then
      -- to ten sam płatnik, ale kwota inna niż zwykle: zapisz, ale pokaż do sprawdzenia
      return query select tpl.kind, tpl.category_id, tpl.id, 0.60::numeric, true;
      return;
    end if;
    if tpl.day_of_month is not null and abs(dom - tpl.day_of_month) > 5 then
      return query select tpl.kind, tpl.category_id, tpl.id, 0.70::numeric, false;
      return;
    end if;
    return query select tpl.kind, tpl.category_id, tpl.id, 0.95::numeric, false;
    return;
  end loop;

  -- (3) merchant_rules wg priority (najniższa liczba = najwyższy priorytet)
  select * into mrule from merchant_rules
    where norm ~* pattern order by priority asc limit 1;
  if found then
    return query select mrule.kind, mrule.category_id, mrule.template_id, 0.85::numeric, false;
    return;
  end if;

  -- (4) nieznane: wydatek = variable do oznaczenia; wpływ < 300 zł = zwrot
  --     (zrzutki od znajomych), wpływ >= 300 zł = windfall do decyzji
  return query select
    (case when p_amount < 0 then 'variable'
          when p_amount < 300 then 'refund'
          else 'windfall' end)::text,
    null::uuid, null::uuid, 0.30::numeric, true;
end $$;

-- ---------------------------------------------------------------------------
-- fn_open_period(p_month date) — idempotentna (sekcja 2.5, 5.2)
-- p_month: dowolny dzień w docelowym miesiącu
-- ---------------------------------------------------------------------------
create or replace function fn_open_period(p_month date)
returns uuid language plpgsql as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date - 1;
  v_period_id uuid;
  v_carry numeric := 0;
begin
  select id into v_period_id from budget_periods where period_start = v_start;
  if found then
    return v_period_id;   -- istniejący okres: nie regenerujemy przy każdej transakcji
  end if;

  -- przeniesienie z poprzedniego okresu: dług zawsze, nadwyżka tylko gdy
  -- Tomek wybrał 'carry'; 'ignore' zeruje (tak zamykamy historię)
  select case when leftover_action = 'ignore' then 0
              when leftover_action = 'carry' then coalesce(leftover, 0)
              when coalesce(leftover, 0) < 0 then leftover
              else 0 end
    into v_carry
    from budget_periods where period_start = (v_start - interval '1 month')::date;

  insert into budget_periods (period_start, period_end, status, carryover_in)
    values (v_start, v_end, 'open', coalesce(v_carry, 0))
    returning id into v_period_id;

  perform fn_regenerate_period(v_period_id);
  return v_period_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_regenerate_period(period_id) — (re)tworzy period_lines z aktywnych
-- szablonów, przelicza planowane sumy i sts_month. Nie rusza już
-- dopasowanych transakcji (upsert po template_id).
-- ---------------------------------------------------------------------------
-- dedup guard dla insertów period_lines w regenerate (jeden szablon = jedna
-- planowana linia na okres, chyba że template_id null)
create unique index if not exists uq_period_lines_period_template
  on period_lines(period_id, template_id) where template_id is not null;

create or replace function fn_regenerate_period(p_period_id uuid)
returns void language plpgsql as $$
declare
  p budget_periods%rowtype;
  tpl recurring_templates%rowtype;
  v_due date;
begin
  select * into p from budget_periods where id = p_period_id;
  if not found then raise exception 'period % not found', p_period_id; end if;

  for tpl in
    select * from recurring_templates
    where active_from <= p.period_end and (active_to is null or active_to >= p.period_start)
      and (cadence = 'monthly'
           or (cadence = 'yearly' and month_of_year = extract(month from p.period_start))
           or (cadence = 'once' and active_from between p.period_start and p.period_end))
  loop
    v_due := case when tpl.day_of_month is not null
                  then least(p.period_start + (tpl.day_of_month - 1), p.period_end)
                  else p.period_end end;

    -- upsert po (okres, szablon): zmiana szablonu przelicza linie jeszcze
    -- niezapłacone, zapłaconych nie rusza (sekcja 2.6 specu)
    insert into period_lines (period_id, template_id, kind, category_id, amount_planned, due_date, status)
      values (p_period_id, tpl.id, tpl.kind, tpl.category_id, tpl.amount_expected, v_due, 'planned')
    on conflict (period_id, template_id) where template_id is not null
    do update set kind = excluded.kind, category_id = excluded.category_id,
                  amount_planned = excluded.amount_planned, due_date = excluded.due_date
      where period_lines.status in ('planned', 'overdue');
  end loop;

  update budget_periods bp set
    income_planned  = coalesce((select sum(amount_planned) from period_lines where period_id = p_period_id and kind = 'income'), 0),
    fixed_planned   = coalesce((select sum(amount_planned) from period_lines where period_id = p_period_id and kind = 'fixed'), 0),
    sinking_planned = coalesce((select sum(amount_planned) from period_lines where period_id = p_period_id and kind = 'sinking'), 0),
    savings_planned = coalesce((select sum(amount_planned) from period_lines where period_id = p_period_id and kind = 'savings'), 0)
  where bp.id = p_period_id;

  update budget_periods set
    sts_month = income_planned - fixed_planned - sinking_planned - savings_planned + carryover_in
  where id = p_period_id;

  perform fn_recompute_widget_state(p_period_id);
end $$;


-- ---------------------------------------------------------------------------
-- fn_close_period(period_id, leftover_action)
-- ---------------------------------------------------------------------------
create or replace function fn_close_period(p_period_id uuid, p_action text default 'to_pillow')
returns void language plpgsql as $$
declare
  p budget_periods%rowtype;
  v_variable_actual numeric;
  v_leftover numeric;
begin
  select * into p from budget_periods where id = p_period_id;
  if not found then raise exception 'period % not found', p_period_id; end if;

  select coalesce(sum(-amount), 0) into v_variable_actual
    from transactions
    where period_id = p_period_id and kind = 'variable' and status not in ('ignored');
  -- refundy obniżają wydane
  v_variable_actual := v_variable_actual - coalesce((
    select sum(amount) from transactions
    where period_id = p_period_id and kind = 'refund' and status not in ('ignored')), 0);

  v_leftover := p.sts_month - v_variable_actual;

  update budget_periods set
    status = 'closed',
    variable_actual = v_variable_actual,
    leftover = v_leftover,
    leftover_action = p_action,
    closed_at = now(),
    snapshot = jsonb_build_object(
      'sts_month', p.sts_month, 'variable_actual', v_variable_actual, 'leftover', v_leftover
    )
  where id = p_period_id;
end $$;

-- ---------------------------------------------------------------------------
-- fn_recompute_widget_state(period_id) — sekcja 2.2, 4.4
-- ---------------------------------------------------------------------------
create or replace function fn_recompute_widget_state(p_period_id uuid)
returns void language plpgsql as $$
declare
  p budget_periods%rowtype;
  v_spent numeric;
  v_refunds numeric;
  v_remaining numeric;
  v_days_in_month int;
  v_days_elapsed int;
  v_days_left int;
  v_daily numeric;
  v_pace numeric;
  v_color text;
  v_next jsonb;
  v_review_count int;
  v_withdrawn numeric;
  v_windfall numeric;
begin
  select * into p from budget_periods where id = p_period_id;
  if not found or p.status <> 'open' then return; end if;
  -- widget pokazuje tylko najnowszy otwarty okres; historia przy imporcie
  -- nie ma przeliczać widgetu ani spowalniać wstawiania
  if p.period_start <> (select max(period_start) from budget_periods where status = 'open') then
    return;
  end if;

  select coalesce(sum(-amount),0) into v_spent
    from transactions where period_id = p_period_id and kind = 'variable' and status <> 'ignored';
  select coalesce(sum(amount),0) into v_refunds
    from transactions where period_id = p_period_id and kind = 'refund' and status <> 'ignored';
  v_spent := v_spent - v_refunds;

  v_remaining := p.sts_month - v_spent;

  v_days_in_month := (p.period_end - p.period_start + 1);
  v_days_elapsed := least(v_days_in_month, greatest(1, (fn_today() - p.period_start + 1)));
  v_days_left := greatest(1, v_days_in_month - v_days_elapsed + 1);
  v_daily := greatest(0, v_remaining) / v_days_left;

  if p.sts_month > 0 then
    v_pace := (v_spent / p.sts_month) / (v_days_elapsed::numeric / v_days_in_month);
  else
    v_pace := null;
  end if;

  v_color := case
    when v_remaining < 0 then 'red_full'
    when v_pace is null then 'green'
    when v_pace > 1.10 then 'red'
    when v_pace >= 0.85 then 'yellow'
    else 'green'
  end;

  select jsonb_build_object('name', rt.name, 'amount', pl.amount_planned, 'due', pl.due_date)
    into v_next
    from period_lines pl join recurring_templates rt on rt.id = pl.template_id
    where pl.period_id = p_period_id and pl.status = 'planned' and pl.due_date >= fn_today()
    order by pl.due_date asc limit 1;

  select count(*) into v_review_count from transactions
    where period_id = p_period_id and status = 'needs_review';

  select coalesce(sum(-amount),0) into v_withdrawn from transactions
    where period_id = p_period_id and kind = 'savings_withdrawal' and status <> 'ignored';

  select coalesce(sum(w.amount),0) into v_windfall from windfalls w
    join transactions t on t.id = w.transaction_id
    where t.period_id = p_period_id and w.allocated_to is null;

  update widget_state set
    period_id = p_period_id,
    sts_month = p.sts_month,
    sts_remaining = v_remaining,
    sts_daily = round(v_daily, 2),
    days_left = v_days_left,
    spent_mtd = v_spent,
    pace_ratio = round(v_pace, 3),
    color = v_color,
    next_fixed = v_next,
    needs_review_count = v_review_count,
    savings_withdrawn_mtd = v_withdrawn,
    windfall_unallocated = v_windfall,
    updated_at = now()
  where id = 1;
end $$;
