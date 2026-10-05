-- Przeklasyfikuj historię (source = 'csv') po zmianie reguł, szablonów albo
-- normalizacji nazw sklepów. Idempotentne. Zmienia tylko kind/kategorię/szablon,
-- nie dotyka kwot ani wpisów z Apple Pay, paragonów i ręcznych.
-- Status zostaje 'confirmed': historia jest informacyjna i nie zaśmieca
-- kolejki "do sprawdzenia".
update transactions t
set kind = c.kind, category_id = c.category_id, template_id = c.template_id,
    confidence = c.confidence, status = 'confirmed'
from (
  select tx.id, cls.*
  from transactions tx
  cross join lateral fn_classify(tx.merchant_raw, tx.amount, tx.occurred_at, null) cls
  where tx.source = 'csv'
    and tx.occurred_at < date_trunc('month', fn_today())
) c
where c.id = t.id;
