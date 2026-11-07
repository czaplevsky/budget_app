// Historia: wpisy miesiąca po dniach, filtr koszyków.
import { fmtMoney, fmtDayHeader, monthLabel, monthOf } from '../format.js';
import { historyGroups, monthsWithData } from '../calc.js';
import { esc, ICON, cap, entryRow } from './util.js';

export function renderHistory(ctx) {
  const { data, ui, today } = ctx;
  const cur = monthOf(today);
  const ym = ui.histMonth || cur;
  const months = monthsWithData(data.entries, today);
  const i = months.indexOf(ym);
  const older = i >= 0 ? months[i + 1] : null;
  const newer = i > 0 ? months[i - 1] : null;
  const names = {};
  data.baskets.forEach((b) => { names[b.id] = b.name; });
  const baskets = data.baskets.slice().sort((a, b) => a.order - b.order);

  let h = '<h1 class="large">Historia</h1>';
  h += '<div class="msw"><button type="button" data-act="hist-month" data-ym="' + (older || '') + '"' + (older ? '' : ' disabled') + ' aria-label="Starszy miesiąc">' + ICON.back + '</button>' +
    '<b>' + esc(monthLabel(ym)) + '</b>' +
    '<button type="button" data-act="hist-month" data-ym="' + (newer || '') + '"' + (newer ? '' : ' disabled') + ' aria-label="Nowszy miesiąc">' + ICON.fwd + '</button></div>';
  h += '<div class="chips"><button type="button" class="chip' + (ui.histFilter === 'all' ? ' on' : '') + '" data-act="hist-filter" data-f="all">Wszystkie</button>' +
    baskets.map((b) => '<button type="button" class="chip' + (ui.histFilter === b.id ? ' on' : '') + '" data-act="hist-filter" data-f="' + esc(b.id) + '">' + esc(b.name) + '</button>').join('') + '</div>';

  const groups = historyGroups(data.entries, ym, ui.histFilter === 'all' ? null : ui.histFilter);
  if (!groups.length) {
    h += '<div class="card empty"><b>Brak wpisów</b><br>' + (ui.histFilter === 'all' ? 'W tym miesiącu nic jeszcze nie ma.' : 'Dla tego filtra nic nie ma.') + '</div>';
  }
  groups.forEach((g) => {
    h += '<div class="day num"><b>' + esc(cap(fmtDayHeader(g.date))) + (g.date === today ? ' · dziś' : '') + '</b>' +
      '<span>suma dnia <em>' + fmtMoney(g.total) + '</em></span></div>' +
      '<div class="card list">' + g.entries.map((e) => entryRow(e, names[e.basket], true)).join('') + '</div>';
  });
  return h;
}

export const actions = {
  'hist-filter'(el, ctx) {
    ctx.ui.histFilter = el.dataset.f;
    ctx.render();
  },
  'hist-month'(el, ctx) {
    if (!el.dataset.ym) return;
    ctx.ui.histMonth = el.dataset.ym;
    ctx.render();
  },
};
