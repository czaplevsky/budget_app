// Ekran "Koszyki": hero, do zapłaty, do potwierdzenia, kafelki, Wyjazdy, baner kopii.
import { fmtMoney, monthName } from '../format.js';
import { esc, ICON, plural, dm, pct, statusCls, isPlan, ringHtml, SRC_SHORT } from './util.js';
import { backupNow } from './backup.js';

const WEEK_MS = 7 * 24 * 3600 * 1000;

function needsBackup(data) {
  if (!data.entries || data.entries.length === 0) return false;
  const last = data.settings && data.settings.lastBackupAt;
  if (!last) return true;
  const t = Date.parse(last);
  if (isNaN(t)) return true;
  return Date.now() - t > WEEK_MS;
}

function tileHtml(b, ms) {
  const lim = b.limit || 0;
  const cls = statusCls(b);
  let nt;
  if (b.kind === 'fixed') {
    nt = 'zapłacone ' + fmtMoney(b.spent) + '<br>zaplanowane ' + fmtMoney(b.planned || 0);
  } else if (b.kind === 'planned') {
    const pend = (b.occurrences || []).filter((o) => o.state === 'due' || o.state === 'pending');
    if (pend.length) {
      nt = (b.hint ? esc(b.hint) + '<br>' : '') + 'zaplanowane ' + fmtMoney(b.planned || 0, { round: 'auto' }) +
        (pend.length === 1 ? ', ok. ' + dm(pend[0].date) : '');
    } else if (lim === 0) {
      nt = 'brak płatności w tym miesiącu';
    } else {
      nt = (b.hint ? esc(b.hint) : 'wszystko zapłacone');
    }
  } else if (b.weekend) {
    nt = 'ten weekend: ' + fmtMoney(b.weekend.spent, { round: true, noUnit: true }) +
      (b.weekend.limit ? ' / ' + fmtMoney(b.weekend.limit, { round: true, noUnit: true }) : '') + ' zł';
  } else if (lim === 0) {
    nt = 'limit nie ustawiony';
  } else {
    nt = 'do dziś ok. ' + fmtMoney(b.pace || 0, { round: true });
  }
  const left = b.remaining == null ? 0 : b.remaining;
  return '<button type="button" class="tile ' + cls + ' num" data-act="open-basket" data-id="' + esc(b.id) + '">' +
    ringHtml(b) +
    '<div class="nm">' + esc(b.name) + '</div>' +
    '<div class="am">' + fmtMoney(b.spent, { noUnit: true }) + ' <span>/ ' + fmtMoney(lim, { noUnit: true, round: 'auto' }) + ' zł</span></div>' +
    '<div class="nt">' + nt + '</div>' +
    '<div class="rest">zostało <b>' + fmtMoney(left) + '</b></div></button>';
}

function dueHtml(ms, data) {
  const due = ms.totals.due || [];
  if (!due.length) return '';
  const names = {};
  data.baskets.forEach((b) => { names[b.id] = b.name; });
  let h = '<div class="sec first">Do potwierdzenia</div><div class="card list" style="margin-bottom:24px">';
  due.forEach((o) => {
    h += '<div class="due num"><div class="d1"><span class="nm">' + esc(o.name) + '</span><span class="am">' + fmtMoney(o.amount) + '</span></div>' +
      '<div class="d2"><b>' + dm(o.date) + '</b> · ' + esc(names[o.basket] || '') + ' · ' + esc(SRC_SHORT[o.source] || o.source) + '</div>' +
      '<div class="dact">' +
      '<button type="button" class="btn pri" data-act="confirm-occ" data-occ="' + esc(o.occId) + '">' + ICON.check + 'Zapłacone</button>' +
      '<button type="button" class="btn sec2" data-act="other-occ" data-occ="' + esc(o.occId) + '">Inna kwota</button>' +
      '<button type="button" class="btn sec2" data-act="skip-occ" data-occ="' + esc(o.occId) + '">Pomiń</button>' +
      '</div></div>';
  });
  return h + '</div>';
}

export function renderHome(ctx) {
  const { ms, data } = ctx;
  const t = ms.totals;
  const d = t.daily;
  let h = '<h1 class="large">' + esc(monthName(ms.ym)) + '</h1>';

  if (needsBackup(data)) {
    const last = data.settings && data.settings.lastBackupAt;
    h += '<button type="button" class="banner" data-act="backup-now">' + ICON.save +
      '<span>Zrób kopię<small>' + (last ? 'ostatnia ponad tydzień temu, stuknij żeby zapisać' : 'jeszcze nie było kopii, stuknij żeby zapisać') + '</small></span></button>';
  }

  // hero
  h += '<div class="hero num"><div class="eyebrow">Do wydania</div>' +
    '<div class="big' + (d.remaining < 0 ? ' neg' : '') + '">' + fmtMoney(d.remaining) + '</div>' +
    '<div class="sub">z ' + fmtMoney(d.limit, { round: 'auto' }) + ' w koszykach na co dzień · ' + ms.daysLeft + ' ' + plural(ms.daysLeft) + '</div>' +
    '<div class="meter"><i style="width:' + pct(d.spent, d.limit) + '%"></i></div>' +
    '<div class="sub" style="margin:-4px 0 16px">wydane ' + fmtMoney(d.spent) + '</div>' +
    '<div class="daily"><span>Na dziś ok.</span><b>' + (t.perDay == null ? '–' : fmtMoney(t.perDay, { round: true }) + '/dzień') + '</b></div></div>';

  // do zapłaty
  const parts = [];
  ms.baskets.forEach((b) => {
    if (isPlan(b) && (b.planned || 0) > 0) {
      const pend = (b.occurrences || []).filter((o) => o.state === 'due' || o.state === 'pending');
      parts.push(esc(b.name) + ' ' + fmtMoney(b.planned, { round: 'auto' }) + (pend.length === 1 ? ' (' + dm(pend[0].date) + ')' : ''));
    }
  });
  h += '<div class="pay num"><div class="pl1"><span>Do zapłaty do końca miesiąca</span><b>' + fmtMoney(t.toPay) + '</b></div>' +
    '<div class="pl2">' + (parts.length ? parts.join(' · ') : 'nic nie czeka na zapłatę') + '</div>' +
    '<div class="pl2">Limity miesiąca razem ' + fmtMoney(t.limitAll, { round: 'auto' }) + ' · wydane w nich ' + fmtMoney(t.spentAll) + '</div></div>';

  h += dueHtml(ms, data);

  // kafelki
  h += '<div class="sec first">Koszyki</div><div class="tiles">' +
    ms.baskets.filter((b) => b.kind !== 'outside').map((b) => tileHtml(b, ms)).join('') + '</div>';

  // wyjazdy
  ms.baskets.filter((b) => b.kind === 'outside').forEach((b) => {
    const w = t.wakacje;
    h += '<button type="button" class="out num" data-act="open-basket" data-id="' + esc(b.id) + '">' +
      '<div class="nm">' + esc(b.name) + '</div>' +
      '<div class="m"><span>wydane <b>' + fmtMoney(b.spent) + '</b></span>' +
      '<span>saldo celu <b>' + (w ? fmtMoney(w.balance) : 'nie ustawiono') + '</b></span></div>' +
      '<div class="nt">Poza limitami: nie liczy się do ' + fmtMoney(t.limitAll, { round: 'auto' }) + '.</div></button>';
  });

  return h;
}

export const actions = {
  'open-basket'(el, ctx) {
    ctx.ui.basket = el.dataset.id;
    ctx.render();
    const d = document.getElementById('detail');
    if (d) d.scrollTop = 0;
  },
  async 'backup-now'(el, ctx) { await backupNow(ctx); },
};
