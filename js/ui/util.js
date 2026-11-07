// Wspólne drobiazgi UI: escapowanie, ikony, pierścienie/paski, wiersz wpisu.
import { fmtMoney, fmtDateShort } from '../format.js';

export const SOURCES = ['konto', 'kredyt', 'revolut', 'gotowka'];
export const SRC_LABEL = { konto: 'Konto / BLIK', kredyt: 'Karta kredytowa', revolut: 'Revolut', gotowka: 'Gotówka' };
export const SRC_SHORT = { konto: 'Konto', kredyt: 'Kredytowa', revolut: 'Revolut', gotowka: 'Gotówka' };

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function nowIso() { return new Date().toISOString(); }

export function pct(a, b) {
  if (!b || b <= 0) return a > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, (a / b) * 100));
}

export function plural(n) { return n === 1 ? 'dzień' : 'dni'; }

// '2026-11-15' -> '15.11'
export function dm(ymd) {
  if (!ymd) return '';
  return String(+ymd.slice(8, 10)) + '.' + ymd.slice(5, 7);
}

export function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// grosze -> stan klawiatury ('24,9', '24', '0,05')
export function groszeToKeypad(g) {
  const n = Math.max(0, Math.round(g || 0));
  const whole = Math.floor(n / 100);
  const frac = n % 100;
  if (frac === 0) return String(whole);
  if (frac < 10) return whole + ',0' + frac;
  if (frac % 10 === 0) return whole + ',' + (frac / 10);
  return whole + ',' + frac;
}

// ISO -> '7.11 14:05' (czas lokalny)
export function fmtStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return d.getDate() + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

export const ICON = {
  bank: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18"/></svg>',
  card: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/></svg>',
  revolut: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3-3M20 15H7l3 3"/></svg>',
  cash: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
  cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>',
  cam: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  bs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12zM12 9l6 6M18 9l-6 6"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  basket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16l-1.4 11.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8zM8 7a4 4 0 0 1 8 0"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
};

export function srcIcon(source) {
  return source === 'kredyt' ? ICON.card : source === 'revolut' ? ICON.revolut : source === 'gotowka' ? ICON.cash : ICON.bank;
}

export function srcChip(source) {
  return '<span class="src">' + srcIcon(source) + esc(SRC_SHORT[source] || source) + '</span>';
}

// Klasa statusu koszyka (ok/warn/bad/neu). Dla fixed/planned "ok" = neutralny (akcent).
export function statusCls(b) {
  if (b.kind === 'outside') return 'neu';
  if (b.kind === 'daily') return b.status === 'bad' ? 'bad' : b.status === 'warn' ? 'warn' : 'ok';
  return b.status === 'bad' ? 'bad' : b.status === 'warn' ? 'warn' : 'neu';
}

export function isPlan(b) { return b.kind === 'fixed' || b.kind === 'planned'; }

export function barHtml(b) {
  const cls = statusCls(b);
  const lim = b.limit || 0;
  if (isPlan(b)) {
    const paid = pct(b.spent, lim);
    const pl = pct(b.spent + (b.planned || 0), lim);
    return '<div class="bar ' + cls + '"><i class="pl" style="width:' + pl + '%"></i><i style="width:' + paid + '%"></i></div>';
  }
  const tick = lim > 0 && b.pace != null ? Math.max(0, Math.min(100, (b.pace / lim) * 100)) : 0;
  return '<div class="bar ' + cls + '"><i style="width:' + pct(b.spent, lim) + '%"></i>' +
    (lim > 0 && b.pace ? '<span class="tick" style="left:' + tick + '%"></span>' : '') + '</div>';
}

export function ringHtml(b) {
  const R = 29;
  const C = 2 * Math.PI * R;
  const lim = b.limit || 0;
  const cls = statusCls(b);
  const plan = isPlan(b);
  const paid = (pct(b.spent, lim) / 100) * C;
  const pl = plan ? (pct(b.spent + (b.planned || 0), lim) / 100) * C : 0;
  let h = '<div class="rg ' + cls + '"><svg viewBox="0 0 72 72" aria-hidden="true"><g transform="rotate(-90 36 36)">' +
    '<circle class="ring-bg" cx="36" cy="36" r="' + R + '" fill="none" stroke-width="8"/>';
  if (plan) h += '<circle class="ring-pl" cx="36" cy="36" r="' + R + '" fill="none" stroke-width="8" stroke-dasharray="' + pl + ' ' + C + '"/>';
  h += '<circle class="ring-fg" cx="36" cy="36" r="' + R + '" fill="none" stroke-width="8" stroke-linecap="butt" stroke-dasharray="' + paid + ' ' + C + '"/></g>';
  if (!plan && lim > 0 && b.pace) {
    const a = (b.pace / lim) * 360;
    h += '<line class="ring-tk" x1="36" y1="' + (36 - R - 7) + '" x2="36" y2="' + (36 - R + 7) + '" stroke-width="2.5" stroke-linecap="round" transform="rotate(' + a + ' 36 36)"/>';
  }
  h += '</svg><b class="num">' + Math.round(pct(b.spent, lim)) + '%</b></div>';
  return h;
}

// Wiersz wpisu (przycisk -> edycja). showBasket: pokaż nazwę koszyka w drugiej linii.
export function entryRow(e, basketName, showBasket) {
  const title = e.note ? esc(e.note) : esc(basketName || '');
  const amt = e.isRefund ? '+' + fmtMoney(e.amount) : fmtMoney(e.amount);
  return '<button type="button" class="entry" data-act="edit-entry" data-id="' + esc(e.id) + '">' +
    '<span class="e1"><span class="ds">' + title + (e.isRefund ? ' <span class="src good">zwrot</span>' : '') + '</span>' +
    '<span class="a num' + (e.isRefund ? ' neg' : '') + '">' + amt + '</span></span>' +
    '<span class="e2 num" style="display:flex"><span>' + esc(shortDate(e.date)) + '</span>' + srcChip(e.source) +
    (showBasket && e.note ? '<span class="ebk">' + esc(basketName || '') + '</span>' : '') + '</span></button>';
}

function shortDate(ymd) { return fmtDateShort(ymd); }
