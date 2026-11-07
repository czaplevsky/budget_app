// Szczegóły koszyka (panel wsuwany z prawej).
import { fmtMoney, monthName } from '../format.js';
import { esc, ICON, statusCls, isPlan, barHtml, entryRow, dm, SRC_SHORT } from './util.js';

function verdict(b) {
  const cls = statusCls(b);
  const m = (g) => fmtMoney(g);
  let msg;
  if (b.kind === 'daily' || b.kind === 'extra') {
    if ((b.limit || 0) === 0) {
      msg = b.spent > 0 ? 'Limit nie jest ustawiony, a są już wydatki: ' + m(b.spent) + '.' : 'Limit nie jest ustawiony (Ustawienia).';
    } else if (b.status === 'bad') {
      msg = 'Limit przekroczony o ' + m(b.spent - b.limit) + '.';
    } else if (b.status === 'warn' && b.kind === 'extra') {
      msg = 'Wykorzystane ponad 80% limitu: ' + m(b.spent) + ' z ' + m(b.limit) + '.';
    } else if (b.status === 'warn') {
      msg = 'Powyżej tempa o ' + m(b.spent - b.pace) + '. Jeszcze w limicie.';
    } else if (b.kind === 'extra') {
      msg = 'W limicie: wydane ' + m(b.spent) + ' z ' + m(b.limit) + '.';
    } else {
      msg = 'W tempie: wydane ' + m(b.spent) + ' przy normie do dziś ' + m(b.pace || 0) + '.';
    }
    if (b.weekend) {
      msg += ' Ten weekend: ' + fmtMoney(b.weekend.spent, { round: true, noUnit: true }) +
        (b.weekend.limit ? ' / ' + fmtMoney(b.weekend.limit, { round: true, noUnit: true }) : '') + ' zł.';
    }
  } else {
    const pl = b.planned || 0;
    if ((b.limit || 0) === 0 && b.spent === 0 && pl === 0) {
      msg = b.kind === 'planned' ? 'Brak płatności w tym miesiącu.' : 'Limit nie jest ustawiony (Ustawienia).';
    } else {
      msg = 'Zapłacone ' + m(b.spent) + ' + zaplanowane ' + m(pl) + ' = ' + m(b.spent + pl) + ' z limitu ' + fmtMoney(b.limit || 0, { round: 'auto' }) + '.';
    }
  }
  return '<div class="verdict ' + cls + '">' + msg + '</div>';
}

function rangeText(b) {
  if (!b.from || !b.until) return 'dodatkowy';
  const nm = (ym) => monthName(ym).toLowerCase();
  return b.from === b.until ? nm(b.from) + ' ' + b.from.slice(0, 4) : nm(b.from) + ' ' + b.from.slice(0, 4) + ' – ' + nm(b.until) + ' ' + b.until.slice(0, 4);
}

function occRow(o) {
  let state, cls = '';
  let btns = '';
  if (o.state === 'confirmed') state = '<span class="src good">zapłacone</span>';
  else if (o.state === 'skipped') { state = '<span class="src">pominięte</span>'; cls = ' skipped'; }
  else if (o.state === 'due') state = '<span class="src warnc">do potwierdzenia</span>';
  else state = '<span class="src">jeszcze nie zapłacone</span>';
  if (o.state === 'due' || o.state === 'pending') {
    btns = '<div class="oact"><button type="button" class="btn pri" data-act="confirm-occ" data-occ="' + esc(o.occId) + '">' + ICON.check + 'Zapłacone</button>' +
      '<button type="button" class="btn sec2" data-act="skip-occ" data-occ="' + esc(o.occId) + '">Pomiń</button></div>';
  } else if (o.state === 'skipped') {
    btns = '<div class="oact"><button type="button" class="btn sec2" data-act="unskip-occ" data-occ="' + esc(o.occId) + '">Przywróć</button></div>';
  }
  return '<div class="entry planned' + cls + '"><div class="e1"><span class="ds">' + esc(o.name) + '</span><span class="a num">' + fmtMoney(o.amount) + '</span></div>' +
    '<div class="e2 num"><span>' + dm(o.date) + '</span>' + state + '<span class="ebk">' + esc(SRC_SHORT[o.source] || '') + '</span></div>' + btns + '</div>';
}

export function renderDetail(ctx) {
  const id = ctx.ui.basket;
  if (!id) return null;
  const b = ctx.ms.baskets.find((x) => x.id === id);
  if (!b) return null;
  const t = ctx.ms.totals;
  let h = '<button type="button" class="back" data-act="close-basket">' + ICON.back + 'Koszyki</button>';
  h += '<h1 class="large" style="margin:0 0 4px">' + esc(b.name) + '</h1>';
  h += '<div class="eyebrow" style="margin-bottom:16px;font-weight:500">' + esc(b.hint || ' ') + '</div>';

  if (b.kind === 'outside') {
    const w = t.wakacje;
    h += '<div class="dh neu num"><div class="eyebrow">Saldo celu Wakacje</div>' +
      '<div class="rest" style="color:var(--ink)">' + (w ? fmtMoney(w.balance) : '–') + '</div>' +
      '<div class="scale"><span>wydane w miesiącu ' + fmtMoney(b.spent) + '</span><span>poza limitami miesiąca</span></div>' +
      '<div class="verdict neu">Ten koszyk nie liczy się do limitów miesiąca. Wydatki obciążają tylko saldo celu.' +
      (w ? '' : ' Ustaw saldo w Ustawieniach.') + '</div></div>';
  } else {
    const plan = isPlan(b);
    const cls = statusCls(b);
    h += '<div class="dh ' + cls + ' num"><div class="eyebrow">Zostało</div>' +
      '<div class="rest" style="color:' + (plan && cls === 'neu' ? 'var(--ink)' : 'var(--c)') + '">' + fmtMoney(b.remaining) + '</div>' +
      barHtml(b) +
      '<div class="scale"><span>0</span><span>limit ' + fmtMoney(b.limit || 0, { round: 'auto' }) + '</span></div>' +
      '<div class="stats"><div>Limit<b>' + fmtMoney(b.limit || 0, { round: 'auto' }) + '</b></div><div>Wydane<b>' + fmtMoney(b.spent) + '</b></div>' +
      (b.kind === 'extra'
        ? '<div>Zakres<b style="font-size:14px;white-space:normal">' + esc(rangeText((ctx.data.baskets || []).find((x) => x.id === b.id) || b)) + '</b></div></div>'
        : '<div>' + (plan ? 'Zaplanowane' : 'Tempo na dziś') + '<b>' + fmtMoney(plan ? (b.planned || 0) : (b.pace || 0)) + '</b></div></div>') +
      verdict(b) + '</div>';
  }

  const es = b.entries || [];
  h += '<div class="sec">Wpisy (' + es.length + ')</div>';
  if (es.length) h += '<div class="card list">' + es.map((e) => entryRow(e, b.name, false)).join('') + '</div>';
  else h += '<div class="card empty">Brak wpisów w tym koszyku.<br>Dodaj pierwszy przyciskiem +.</div>';

  const occs = b.occurrences || [];
  if (isPlan(b) || occs.length) {
    const open = occs.filter((o) => o.state === 'due' || o.state === 'pending');
    h += '<div class="sec">Płatności planowane (' + occs.length + ')</div>';
    if (occs.length) h += '<div class="card list">' + occs.map(occRow).join('') + '</div>';
    else h += '<div class="card empty">Brak płatności planowanych w tym miesiącu.</div>';
    if (open.length) h += '<div class="note-s">Zapłacone wcześniej? Stuknij ✓ przy płatności.</div>';
  }
  return h;
}

export const actions = {
  'close-basket'(el, ctx) {
    ctx.ui.basket = null;
    ctx.render();
  },
};
