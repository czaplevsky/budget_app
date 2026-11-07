// Płatności planowane: potwierdzanie, pomijanie, okno "Następna płatność".
import { saveEntry, deleteEntry, setOccState, saveSchedule } from '../db.js';
import { fmtMoney, addDays } from '../format.js';
import { esc, dm, nowIso } from './util.js';
import { showToast } from './toast.js';

export function findOcc(ctx, occId) {
  for (const b of ctx.ms.baskets) {
    for (const o of b.occurrences || []) if (o.occId === occId) return o;
  }
  return null;
}

// Po potwierdzeniu 'once' z nextAfterDays: zapamiętaj propozycję (okno pokaże render).
export function maybeAskNext(ctx, occ, paidDate) {
  if (!occ || !occ.nextAfterDays) return;
  const sched = (ctx.data.schedules || []).find((s) => s.id === occ.scheduleId);
  if (!sched || !sched.rule || sched.rule.type !== 'once') return;
  ctx.ui.next = {
    basket: occ.basket,
    name: occ.name,
    amount: occ.amount,
    source: occ.source,
    nextAfterDays: occ.nextAfterDays,
    date: addDays(paidDate, occ.nextAfterDays),
    title: occ.basket === 'catering' ? 'Następna płatność cateringu?' : 'Następna płatność: ' + occ.name + '?',
  };
}

export async function confirmOccurrence(ctx, occ) {
  const date = occ.date <= ctx.today ? occ.date : ctx.today;
  const saved = await saveEntry({
    date,
    amount: occ.amount,
    isRefund: false,
    basket: occ.basket,
    source: occ.source,
    note: occ.name,
    origin: 'schedule',
    occId: occ.occId,
    deleted: false,
  });
  maybeAskNext(ctx, occ, saved.date || date);
  await ctx.reload();
  showToast('Zapłacone · ' + occ.name + ' ' + fmtMoney(-occ.amount, { sign: true }), async () => {
    await deleteEntry(saved.id);
    ctx.ui.next = null;
    await ctx.reload();
  });
}

export function renderDialog(ctx) {
  const el = document.getElementById('dialog');
  const sc = document.getElementById('dscrim');
  const n = ctx.ui.next;
  if (!n) {
    el.classList.remove('on');
    sc.classList.remove('on');
    delete el.dataset.key;
    return;
  }
  // nie przerysowuj, gdy okno już otwarte (zachowaj pole daty)
  if (!el.classList.contains('on') || el.dataset.key !== n.basket + '|' + n.name + '|' + n.nextAfterDays) {
    el.innerHTML =
      '<div class="grab"></div><h2>' + esc(n.title) + '</h2>' +
      '<p>Zaplanować kolejną płatność <b>' + esc(n.name) + '</b> na <b class="num">' + fmtMoney(n.amount) +
      '</b> za ' + n.nextAfterDays + ' dni?</p>' +
      '<div class="srow" style="padding:0 0 12px;border:0"><span class="nm">Data płatności</span>' +
      '<span class="inp"><input type="date" id="nextDate" data-change="next-date" value="' + esc(n.date) + '"></span></div>' +
      '<button type="button" class="btn pri block" data-act="next-save">Zapisz</button>' +
      '<button type="button" class="btn sec2 block" data-act="next-cancel">Nie teraz</button>';
    el.dataset.key = n.basket + '|' + n.name + '|' + n.nextAfterDays;
  }
  el.classList.add('on');
  sc.classList.add('on');
}

export const actions = {
  async 'confirm-occ'(el, ctx) {
    const occ = findOcc(ctx, el.dataset.occ);
    if (occ) await confirmOccurrence(ctx, occ);
  },
  async 'skip-occ'(el, ctx) {
    const occ = findOcc(ctx, el.dataset.occ);
    if (!occ) return;
    await setOccState(occ.occId, 'skipped');
    await ctx.reload();
    showToast('Pominięto · ' + occ.name, async () => {
      await setOccState(occ.occId, null);
      await ctx.reload();
    });
  },
  async 'unskip-occ'(el, ctx) {
    await setOccState(el.dataset.occ, null);
    await ctx.reload();
  },
  'other-occ'(el, ctx) {
    const occ = findOcc(ctx, el.dataset.occ);
    if (occ) ctx.openSheet({ occ });
  },
  async 'next-save'(el, ctx) {
    const n = ctx.ui.next;
    if (!n) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(n.date) ? n.date : addDays(ctx.today, n.nextAfterDays);
    await saveSchedule({
      id: (crypto.randomUUID ? crypto.randomUUID() : 's' + Date.now() + Math.random().toString(16).slice(2)),
      basket: n.basket,
      name: n.name,
      amount: n.amount,
      source: n.source,
      rule: { type: 'once', date },
      nextAfterDays: n.nextAfterDays,
      active: true,
      updatedAt: nowIso(),
    });
    ctx.ui.next = null;
    await ctx.reload();
    showToast('Zaplanowano · ' + n.name + ' · ' + dm(date));
  },
  'next-cancel'(el, ctx) {
    ctx.ui.next = null;
    ctx.render();
  },
};

export const changes = {
  'next-date'(el, ctx) {
    if (ctx.ui.next && /^\d{4}-\d{2}-\d{2}$/.test(el.value)) ctx.ui.next.date = el.value;
  },
};
