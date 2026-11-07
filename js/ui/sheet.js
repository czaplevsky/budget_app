// Arkusz dodawania / edycji wpisu z własną klawiaturą kwoty.
import { saveEntry, deleteEntry, restoreEntry, setSetting } from '../db.js';
import { fmtMoney, fmtDateShort, keypadPress, amountInputToGrosze, addDays, monthOf } from '../format.js';
import { basketsForMonth } from '../calc.js';
import { esc, ICON, SOURCES, SRC_SHORT, dm, groszeToKeypad, isPlan } from './util.js';
import { findOcc, maybeAskNext } from './occ.js';
import { showToast } from './toast.js';
import { readReceipt } from './receipt.js';

function $(id) { return document.getElementById(id); }

export function openSheet(ctx, init) {
  init = init || {};
  const lastSrc = ctx.data.settings && ctx.data.settings.lastSource;
  const f = {
    id: null,
    amt: '',
    basket: init.basket || null,
    date: ctx.today,
    source: SOURCES.indexOf(lastSrc) >= 0 ? lastSrc : 'konto',
    note: '',
    refund: false,
    occId: null,
    daysOpen: false,
    busy: false,
    original: null,
  };
  if (init.entry) {
    const e = init.entry;
    f.id = e.id;
    f.amt = groszeToKeypad(e.amount);
    f.basket = e.basket;
    f.date = e.date;
    f.source = e.source;
    f.note = e.note || '';
    f.refund = !!e.isRefund;
    f.occId = e.occId || null;
    f.original = Object.assign({}, e);
  } else if (init.occ) {
    const o = init.occ;
    f.amt = groszeToKeypad(o.amount);
    f.basket = o.basket;
    f.source = o.source;
    f.note = o.name;
    f.occId = o.occId;
    f.date = o.date <= ctx.today ? o.date : ctx.today;
  }
  ctx.ui.sheet = f;
  renderSheet(ctx);
  $('scrim').classList.add('on');
  $('sheet').classList.add('on');
}

export function closeSheet(ctx) {
  ctx.ui.sheet = null;
  $('scrim').classList.remove('on');
  $('sheet').classList.remove('on');
  const a = document.activeElement;
  if (a && a.blur) a.blur();
}

function dateLabel(ctx, ymd) {
  if (ymd === ctx.today) return 'Dziś';
  if (ymd === addDays(ctx.today, -1)) return 'Wczoraj';
  return fmtDateShort(ymd);
}

function amtText(f) {
  return (f.refund && f.amt !== '' ? '+' : '') + esc(f.amt === '' ? '0' : f.amt);
}

function saveLabel(ctx, f) {
  const g = amountInputToGrosze(f.amt);
  const b = ctx.data.baskets.find((x) => x.id === f.basket);
  if (g > 0 && b) return f.id ? 'Zapisz zmiany' : 'Zapisz · ' + esc(b.name);
  return b ? 'Wpisz kwotę' : 'Wybierz koszyk';
}

function canSave(ctx, f) {
  return amountInputToGrosze(f.amt) > 0 && !!ctx.data.baskets.find((x) => x.id === f.basket);
}

export function renderSheet(ctx) {
  const f = ctx.ui.sheet;
  if (!f) return;
  const sorted = ctx.data.baskets.slice().sort((a, b) => a.order - b.order);
  // koszyki widoczne w miesiącu wybranej daty + zawsze aktualnie wybrany (edycja starego wpisu)
  const visible = basketsForMonth(sorted, monthOf(f.date));
  const baskets = sorted.filter((b) => visible.indexOf(b) >= 0 || b.id === f.basket);
  const msb = ctx.ms.baskets.find((b) => b.id === f.basket);
  let h = '<div class="grab"></div><div class="sh-top"><button type="button" data-act="sheet-close">Anuluj</button>' +
    '<h2>' + (f.id ? 'Edytuj wpis' : 'Nowy wydatek') + '</h2>' +
    (f.id ? '<button type="button" class="dl" data-act="sheet-delete">Usuń</button>'
      : '<label class="scan' + (f.scanning ? ' busy' : '') + '">' + ICON.cam + (f.scanning ? 'Czytam…' : 'Paragon') +
        (f.scanning ? '' : '<input type="file" accept="image/*" data-change="sheet-receipt" aria-label="Zdjęcie paragonu lub zrzut ekranu">') + '</label>') + '</div>';
  h += '<div class="amt num' + (f.amt === '' ? ' zero' : '') + (f.refund ? ' refund' : '') + (f.scanning ? ' scanning' : '') + '" id="amt">' +
    (f.scanning ? 'czytam paragon…' : amtText(f) + '<small>zł</small>') + '</div>';
  h += '<div class="bgrid">' + baskets.map((b) =>
    '<button type="button" class="bk' + (b.kind === 'outside' ? ' out2' : '') + (f.basket === b.id ? ' on' : '') + '" data-act="sheet-basket" data-id="' + esc(b.id) + '">' + esc(b.name) + '</button>'
  ).join('') + '</div>';

  // płatności planowane dla koszyka fixed/planned
  if (!f.id && msb && isPlan(msb)) {
    const occs = (msb.occurrences || []).filter((o) => o.state === 'due' || o.state === 'pending');
    if (occs.length) {
      h += '<div class="occs on">' + occs.map((o) =>
        '<button type="button" class="chip' + (f.occId === o.occId ? ' on' : '') + ' num" data-act="sheet-occ" data-occ="' + esc(o.occId) + '">' +
        esc(o.name) + ' · ' + dm(o.date) + ' · ' + fmtMoney(o.amount) + '</button>'
      ).join('') + '</div>';
    }
  }

  h += '<div class="opts"><button type="button" class="dchip" data-act="sheet-datechip">' + ICON.cal + esc(dateLabel(ctx, f.date)) + '</button>' +
    '<button type="button" class="tog' + (f.refund ? ' on' : '') + '" data-act="sheet-refund">To zwrot<i></i></button></div>';
  const other = f.date !== ctx.today && f.date !== addDays(ctx.today, -1);
  h += '<div class="days' + (f.daysOpen ? ' on' : '') + '">' +
    '<button type="button" class="chip' + (f.date === ctx.today ? ' on' : '') + '" data-act="sheet-day" data-d="0">Dziś</button>' +
    '<button type="button" class="chip' + (f.date === addDays(ctx.today, -1) ? ' on' : '') + '" data-act="sheet-day" data-d="1">Wczoraj</button>' +
    '<label class="chip datepick' + (other ? ' on' : '') + '">' + (other ? esc(fmtDateShort(f.date)) : 'Inna data') +
    '<input type="date" value="' + esc(f.date) + '" data-change="sheet-date" aria-label="Wybierz datę"></label></div>';
  h += '<div class="seg src2">' + SOURCES.map((s) =>
    '<button type="button" data-act="sheet-src" data-s="' + s + '" class="' + (f.source === s ? 'on' : '') + '">' + esc(SRC_SHORT[s]) + '</button>'
  ).join('') + '</div>';
  h += '<input class="desc" id="note" data-input="sheet-note" placeholder="Opis / sklep (opcjonalnie)" maxlength="120" value="' + esc(f.note) + '" autocomplete="off" enterkeyhint="done">';
  h += '<div class="keys">' + ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', 'back'].map((k) =>
    '<button type="button" class="key num" data-act="sheet-key" data-k="' + k + '"' + (k === 'back' ? ' aria-label="Usuń cyfrę"' : '') + '>' + (k === 'back' ? ICON.bs : k) + '</button>'
  ).join('') + '</div>';
  h += '<button type="button" class="primary" id="save" data-act="sheet-save"' + (canSave(ctx, f) ? '' : ' disabled') + '>' + saveLabel(ctx, f) + '</button>';
  $('sheet').innerHTML = h;
}

function updateAmt(ctx) {
  const f = ctx.ui.sheet;
  if (!f) return;
  const a = $('amt');
  a.className = 'amt num' + (f.amt === '' ? ' zero' : '') + (f.refund ? ' refund' : '');
  a.innerHTML = amtText(f) + '<small>zł</small>';
  const s = $('save');
  s.disabled = !canSave(ctx, f);
  s.innerHTML = saveLabel(ctx, f);
}

export const actions = {
  'open-sheet'(el, ctx) {
    openSheet(ctx, { basket: ctx.ui.basket && ctx.ui.tab === 'home' ? ctx.ui.basket : null });
  },
  'edit-entry'(el, ctx) {
    const e = ctx.data.entries.find((x) => x.id === el.dataset.id);
    if (e) openSheet(ctx, { entry: e });
  },
  'sheet-close'(el, ctx) { if (ctx.ui.sheet) closeSheet(ctx); },
  'sheet-basket'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f) return;
    if (f.basket !== el.dataset.id) f.occId = f.id ? f.occId : null;
    f.basket = el.dataset.id;
    renderSheet(ctx);
  },
  'sheet-key'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f || f.scanning) return;
    f.amt = keypadPress(f.amt, el.dataset.k);
    updateAmt(ctx);
  },
  'sheet-src'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f) return;
    f.source = el.dataset.s;
    renderSheet(ctx);
  },
  'sheet-refund'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f) return;
    f.refund = !f.refund;
    renderSheet(ctx);
  },
  'sheet-datechip'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f) return;
    f.daysOpen = !f.daysOpen;
    renderSheet(ctx);
  },
  'sheet-day'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f) return;
    f.date = addDays(ctx.today, -(+el.dataset.d));
    f.daysOpen = false;
    renderSheet(ctx);
  },
  'sheet-occ'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f) return;
    const id = el.dataset.occ;
    if (f.occId === id) {
      f.occId = null;
    } else {
      const o = findOcc(ctx, id);
      if (!o) return;
      f.occId = id;
      f.amt = groszeToKeypad(o.amount);
      f.source = o.source;
      f.note = o.name;
      f.refund = false;
      f.date = o.date <= ctx.today ? o.date : ctx.today;
    }
    renderSheet(ctx);
  },
  async 'sheet-save'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f || f.busy) return;
    const g = amountInputToGrosze(f.amt);
    const basket = ctx.data.baskets.find((x) => x.id === f.basket);
    if (!(g > 0) || !basket) return;
    f.busy = true;
    try {
      const base = f.original;
      const entry = Object.assign({}, base || {}, {
        date: f.date,
        amount: g,
        isRefund: !!f.refund,
        basket: f.basket,
        source: f.source,
        note: f.note.trim(),
        origin: base ? base.origin : (f.occId ? 'schedule' : 'manual'),
        deleted: false,
      });
      if (f.occId) entry.occId = f.occId; else delete entry.occId;
      const occ = !base && f.occId ? findOcc(ctx, f.occId) : null;
      const saved = await saveEntry(entry);
      await setSetting('lastSource', f.source);
      if (occ) maybeAskNext(ctx, occ, saved.date || f.date);
      closeSheet(ctx);
      await ctx.reload();
      if (base) {
        showToast('Zapisano zmiany · ' + basket.name, async () => {
          await saveEntry(base);
          await ctx.reload();
        });
      } else {
        showToast('Zapisano · ' + basket.name + ' ' + fmtMoney(f.refund ? g : -g, { sign: true }), async () => {
          await deleteEntry(saved.id);
          ctx.ui.next = null;
          await ctx.reload();
        });
      }
    } catch (err) {
      showToast('Nie udało się zapisać');
    } finally {
      f.busy = false;
    }
  },
  async 'sheet-delete'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f || !f.id) return;
    const e = f.original;
    const id = f.id;
    closeSheet(ctx);
    await deleteEntry(id);
    await ctx.reload();
    const bn = (ctx.data.baskets.find((x) => x.id === e.basket) || {}).name || '';
    showToast('Usunięto · ' + (e.note || bn) + ' ' + fmtMoney(e.amount), async () => {
      await restoreEntry(id);
      await ctx.reload();
    });
  },
};

export const changes = {
  async 'sheet-receipt'(el, ctx) {
    const f = ctx.ui.sheet;
    const file = el.files && el.files[0];
    if (!f || !file || f.scanning) return;
    f.scanning = true;
    renderSheet(ctx);
    try {
      const r = await readReceipt(file, ctx);
      if (ctx.ui.sheet !== f) return; // arkusz zamknięty w trakcie
      if (r.grosze) f.amt = groszeToKeypad(r.grosze);
      if (r.date) f.date = r.date;
      if (r.merchant) f.note = r.merchant;
      if (r.basket) { f.basket = r.basket; f.occId = null; }
      f.refund = r.refund;
      const miss = [];
      if (!r.grosze) miss.push('kwoty');
      if (!r.basket) miss.push('koszyka');
      showToast(miss.length ? 'Nie odczytałem ' + miss.join(' ani ') + ', uzupełnij' : (r.confidence === 'high' ? 'Odczytane, sprawdź i zapisz' : 'Odczytane, ale sprawdź dokładnie'));
    } catch (err) {
      showToast(err && err.message ? err.message : 'Nie udało się odczytać zdjęcia');
    } finally {
      f.scanning = false;
      if (ctx.ui.sheet === f) renderSheet(ctx);
    }
  },
  'sheet-date'(el, ctx) {
    const f = ctx.ui.sheet;
    if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
    f.date = el.value;
    f.daysOpen = false;
    renderSheet(ctx);
  },
};

export const inputs = {
  'sheet-note'(el, ctx) { if (ctx.ui.sheet) ctx.ui.sheet.note = el.value; },
};
