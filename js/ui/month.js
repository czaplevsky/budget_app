// Miesiąc: tabela koszyk/limit/wydane/różnica, słupki, tabela "Wg źródła".
import { fmtMoney, monthLabel, monthOf } from '../format.js';
import { monthsWithData } from '../calc.js';
import { esc, ICON, SOURCES, SRC_LABEL } from './util.js';
import { csvNow } from './backup.js';

const N = { noUnit: true };

function diffCell(g) {
  if (g === 0) return '<td class="num pos">0,00</td>';
  return '<td class="num ' + (g < 0 ? 'neg' : 'pos') + '">' + fmtMoney(g, { sign: true, noUnit: true }) + '</td>';
}

export function renderMonth(ctx) {
  const { data, ui, today } = ctx;
  const ms = ctx.msMonth;
  const ym = ms.ym;
  const months = monthsWithData(data.entries, today);
  const i = months.indexOf(ym);
  const older = i >= 0 ? months[i + 1] : null;
  const newer = i > 0 ? months[i - 1] : null;
  const t = ms.totals;

  let h = '<h1 class="large">Miesiąc</h1>';
  h += '<div class="msw"><button type="button" data-act="month-go" data-ym="' + (older || '') + '"' + (older ? '' : ' disabled') + ' aria-label="Starszy miesiąc">' + ICON.back + '</button>' +
    '<b>' + esc(monthLabel(ym)) + '</b>' +
    '<button type="button" data-act="month-go" data-ym="' + (newer || '') + '"' + (newer ? '' : ' disabled') + ' aria-label="Nowszy miesiąc">' + ICON.fwd + '</button></div>';

  const inLimits = ms.baskets.filter((b) => b.kind !== 'outside');
  const outside = ms.baskets.filter((b) => b.kind === 'outside');

  let rows = '';
  inLimits.forEach((b) => {
    rows += '<tr><td>' + esc(b.name) + '</td><td class="num">' + fmtMoney(b.limit || 0, { noUnit: true, round: 'auto' }) + '</td><td class="num">' +
      fmtMoney(b.spent, N) + '</td>' + diffCell(b.remaining == null ? 0 : b.remaining) + '</tr>';
  });
  rows += '<tr class="tot"><td>Razem</td><td class="num">' + fmtMoney(t.limitAll, { noUnit: true, round: 'auto' }) + '</td><td class="num">' +
    fmtMoney(t.spentAll, N) + '</td>' + diffCell(t.limitAll - t.spentAll) + '</tr>';
  outside.forEach((b) => {
    rows += '<tr class="off"><td>' + esc(b.name) + ' (poza limitami)</td><td class="num">–</td><td class="num">' + fmtMoney(t.outsideSpent, N) + '</td><td class="num">–</td></tr>';
  });
  h += '<div class="card num" style="padding:0 0 8px;overflow:hidden"><table class="tbl"><thead><tr><th>Koszyk</th><th>Limit</th><th>Wydane</th><th>Różnica</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

  // słupki limit vs wydane
  let mx = 1;
  inLimits.forEach((b) => { mx = Math.max(mx, b.limit || 0, b.spent || 0); });
  h += '<div class="sec">Limit a wydane</div><div class="card ch num"><div class="legend">' +
    '<span><i style="background:var(--line-strong)"></i>Limit</span><span><i style="background:var(--accent)"></i>Wydane</span><span><i style="background:var(--bad)"></i>Ponad limit</span></div>';
  inLimits.forEach((b) => {
    const lim = b.limit || 0;
    const s = Math.max(0, b.spent || 0);
    h += '<div class="cr"><div class="cn">' + esc(b.name) + '</div>' +
      '<div class="cb"><div class="t"><i style="width:' + (lim / mx) * 100 + '%;background:var(--line-strong)"></i></div><span class="v">limit ' + fmtMoney(lim, { noUnit: true, round: 'auto' }) + '</span></div>' +
      '<div class="cb"><div class="t"><i style="width:' + (s / mx) * 100 + '%;background:' + (s > lim ? 'var(--bad)' : 'var(--accent)') + '"></i></div>' +
      '<span class="v" style="color:var(--ink);font-weight:600">wydane ' + fmtMoney(s, N) + '</span></div></div>';
  });
  h += '</div>';

  // wg źródła
  let total = 0;
  let srows = '';
  SOURCES.forEach((s) => {
    const v = (t.bySource && t.bySource[s]) || 0;
    total += v;
    if (s === 'kredyt') {
      srows += '<tr class="cc"><td>' + esc(SRC_LABEL[s]) + '<small>plan: nie dokładać</small></td><td class="num">' + fmtMoney(v) + '</td></tr>';
    } else {
      srows += '<tr><td>' + esc(SRC_LABEL[s]) + '</td><td class="num">' + fmtMoney(v) + '</td></tr>';
    }
  });
  srows += '<tr class="tot"><td>Razem</td><td class="num">' + fmtMoney(total) + '</td></tr>';
  h += '<div class="sec">Wg źródła</div><div class="card num" style="padding:0 0 8px;overflow:hidden"><table class="tbl"><thead><tr><th>Źródło</th><th>Wydane</th></tr></thead><tbody>' + srows + '</tbody></table></div>';
  h += '<div class="note-s">Liczone łącznie z Wyjazdami. Karta kredytowa jest wyróżniona, bo plan mówi, żeby na nią nie dokładać.</div>';

  h += '<button type="button" class="primary" data-act="csv">' + ICON.down + 'Eksportuj CSV</button>';
  return h;
}

export const actions = {
  'month-go'(el, ctx) {
    if (!el.dataset.ym) return;
    ctx.ui.month = el.dataset.ym;
    ctx.reload();
  },
  async csv(el, ctx) { await csvNow(ctx); },
};
