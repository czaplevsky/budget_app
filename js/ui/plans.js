// Ustawienia: płatności stałe i planowane + koszyki dodatkowe (listy i okno edycji #editor).
import { saveSchedule, saveBasket } from '../db.js';
import { fmtMoney, parseAmount, monthName, monthOf } from '../format.js';
import { esc, SOURCES, SRC_SHORT, dm, nowIso } from './util.js';
import { showToast } from './toast.js';

function $(id) { return document.getElementById(id); }

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const REP_BASE = [['1', 'Co miesiąc'], ['2', 'Co 2 mies.'], ['3', 'Co 3 mies.'], ['12', 'Co rok'], ['once', 'Jednorazowo']];
const RE_YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const RE_YMD = /^\d{4}-\d{2}-\d{2}$/;

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : 's' + Date.now() + Math.random().toString(16).slice(2);
}

function moneyText(g) { return fmtMoney(g, { noUnit: true }); }

function isPlanBasket(b) { return !b.deleted && (b.kind === 'fixed' || b.kind === 'planned'); }

function sortedBaskets(ctx) { return ctx.data.baskets.slice().sort((a, b) => a.order - b.order); }

// ---------- listy w Ustawieniach ----------

function schedDesc(s) {
  const r = s.rule || {};
  const src = SRC_SHORT[s.source] || s.source;
  if (r.type === 'once') return 'jednorazowo ' + dm(r.date) + ' · ' + src;
  const n = r.every || 1;
  return (n === 1 ? 'co miesiąc' : 'co ' + n + ' mies.') + ', ' + r.day + '. · ' + src;
}

function rangeText(b) {
  if (!b.from || !b.until) return 'dodatkowy';
  const [fy, fm] = [b.from.slice(0, 4), +b.from.slice(5, 7)];
  const [uy, um] = [b.until.slice(0, 4), +b.until.slice(5, 7)];
  if (b.from === b.until) return monthName(b.from).toLowerCase() + ' ' + fy;
  return ROMAN[fm - 1] + ' ' + fy + ' – ' + ROMAN[um - 1] + ' ' + uy;
}

export function renderPlanSections(ctx) {
  const { data } = ctx;
  const order = {};
  data.baskets.forEach((b) => { order[b.id] = b.order; });
  const scheds = (data.schedules || []).filter((s) => s.active).slice().sort((a, b) => {
    const oa = order[a.basket] == null ? 999 : order[a.basket];
    const ob = order[b.basket] == null ? 999 : order[b.basket];
    if (oa !== ob) return oa - ob;
    const ta = a.rule && a.rule.type === 'once' ? 1 : 0;
    const tb = b.rule && b.rule.type === 'once' ? 1 : 0;
    if (ta !== tb) return ta - tb;
    const ka = ta ? a.rule.date : String((a.rule && a.rule.day) || 0).padStart(2, '0');
    const kb = tb ? b.rule.date : String((b.rule && b.rule.day) || 0).padStart(2, '0');
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  let h = '<div class="sec">Płatności stałe i planowane</div><div class="card list">';
  if (!scheds.length) h += '<div class="srow"><span class="nm"><small>Brak płatności. Dodaj pierwszą poniżej.</small></span></div>';
  scheds.forEach((s) => {
    h += '<button type="button" class="srow srowb" data-act="plan-edit" data-id="' + esc(s.id) + '">' +
      '<span class="nm">' + esc(s.name) + '<small>' + esc(schedDesc(s)) + '</small></span>' +
      '<span class="val num">' + fmtMoney(s.amount) + '</span></button>';
  });
  h += '<div class="sbtn"><button type="button" class="btn sec2 block" data-act="plan-add">Dodaj płatność</button></div></div>';

  const extras = data.baskets.filter((b) => b.kind === 'extra' && !b.deleted).sort((a, b) => (a.from || '') < (b.from || '') ? -1 : (a.from || '') > (b.from || '') ? 1 : a.order - b.order);
  h += '<div class="sec">Koszyki dodatkowe</div><div class="card list">';
  extras.forEach((b) => {
    h += '<button type="button" class="srow srowb" data-act="xb-edit" data-id="' + esc(b.id) + '">' +
      '<span class="nm">' + esc(b.name) + '<small>' + esc(rangeText(b)) + '</small></span>' +
      '<span class="val num">' + fmtMoney(b.limit || 0) + '</span></button>';
  });
  h += '<div class="sbtn"><button type="button" class="btn sec2 block" data-act="xb-add">Dodaj koszyk dodatkowy</button></div></div>';
  h += '<div class="note-s">Liczy się do Do wydania w swoich miesiącach. Limit 0 = każdy wydatek na czerwono.</div>';
  return h;
}

// ---------- okno edycji ----------

function openEditor() {
  $('editor').classList.add('on');
  $('escrim').classList.add('on');
}

export function closeEditor(ctx) {
  ctx.ui.edit = null;
  $('editor').classList.remove('on');
  $('escrim').classList.remove('on');
  const a = document.activeElement;
  if (a && a.blur) a.blur();
}

function setErr(msg) {
  const e = $('eerr');
  if (!e) return;
  e.textContent = msg || '';
  e.style.display = msg ? '' : 'none';
  if (msg) e.scrollIntoView({ block: 'nearest' });
}

function field(label, inner) {
  return '<div class="flab">' + label + '</div>' + inner;
}

function renderSchedEditor(ctx) {
  const ed = ctx.ui.edit;
  const baskets = sortedBaskets(ctx).filter((b) => isPlanBasket(b) || b.id === ed.basket);
  let h = '<div class="grab"></div><h2>' + (ed.id ? 'Edytuj płatność' : 'Nowa płatność') + '</h2>';
  h += field('Nazwa', '<input class="desc" type="text" data-input="edit-name" value="' + esc(ed.name) + '" maxlength="80" autocomplete="off" autocapitalize="sentences" placeholder="np. Hipoteka" aria-label="Nazwa płatności">');
  h += field('Kwota (zł)', '<input class="desc num" type="text" inputmode="decimal" data-input="edit-amt" value="' + esc(ed.amt) + '" autocomplete="off" placeholder="0,00" aria-label="Kwota">');
  h += field('Koszyk', '<div class="seg">' + baskets.map((b) =>
    '<button type="button" data-act="edit-basket" data-id="' + esc(b.id) + '" class="' + (ed.basket === b.id ? 'on' : '') + '">' + esc(b.name) + '</button>').join('') + '</div>');
  h += field('Źródło', '<div class="seg src2" style="margin-bottom:0">' + SOURCES.map((s) =>
    '<button type="button" data-act="edit-src" data-s="' + s + '" class="' + (ed.source === s ? 'on' : '') + '">' + esc(SRC_SHORT[s]) + '</button>').join('') + '</div>');
  const reps = REP_BASE.slice();
  if (ed.rep !== 'once' && !reps.some((r) => r[0] === ed.rep)) reps.splice(reps.length - 1, 0, [ed.rep, 'Co ' + ed.rep + ' mies.']);
  h += field('Powtarzanie', '<div class="chipwrap">' + reps.map((r) =>
    '<button type="button" class="chip' + (ed.rep === r[0] ? ' on' : '') + '" data-act="edit-rep" data-r="' + esc(r[0]) + '">' + esc(r[1]) + '</button>').join('') + '</div>');
  if (ed.rep === 'once') {
    h += field('Data', '<input class="desc" type="date" data-change="edit-date" value="' + esc(ed.date) + '" aria-label="Data płatności">');
  } else {
    h += field('Dzień miesiąca (1–31)', '<input class="desc num" type="text" inputmode="numeric" maxlength="2" data-input="edit-day" value="' + esc(ed.day) + '" autocomplete="off" aria-label="Dzień miesiąca">');
    h += field('Pierwszy miesiąc', '<input class="desc" type="month" data-change="edit-anchor" value="' + esc(ed.anchor) + '" aria-label="Pierwszy miesiąc">');
  }
  h += '<div class="res err" id="eerr" role="alert" style="display:none"></div>';
  h += '<div class="eact"><button type="button" class="btn pri block" data-act="plan-save">Zapisz</button>' +
    (ed.id ? '<button type="button" class="btn del block" data-act="plan-delete">Usuń</button>' : '') +
    '<button type="button" class="btn sec2 block" data-act="edit-close">Anuluj</button></div>';
  $('editor').innerHTML = h;
  $('editor').scrollTop = 0;
}

function renderBasketEditor(ctx) {
  const ed = ctx.ui.edit;
  let h = '<div class="grab"></div><h2>' + (ed.id ? 'Edytuj koszyk dodatkowy' : 'Nowy koszyk dodatkowy') + '</h2>';
  h += field('Nazwa', '<input class="desc" type="text" data-input="edit-name" value="' + esc(ed.name) + '" maxlength="60" autocomplete="off" autocapitalize="sentences" placeholder="np. Święta" aria-label="Nazwa koszyka">');
  h += field('Limit (zł, może być 0)', '<input class="desc num" type="text" inputmode="decimal" data-input="edit-limit" value="' + esc(ed.limit) + '" autocomplete="off" placeholder="0,00" aria-label="Limit">');
  h += field('Od miesiąca', '<input class="desc" type="month" data-change="edit-from" value="' + esc(ed.from) + '" aria-label="Od miesiąca">');
  h += field('Do miesiąca', '<input class="desc" type="month" data-change="edit-until" value="' + esc(ed.until) + '" aria-label="Do miesiąca">');
  h += '<div class="res err" id="eerr" role="alert" style="display:none"></div>';
  h += '<div class="eact"><button type="button" class="btn pri block" data-act="xb-save">Zapisz</button>' +
    (ed.id ? '<button type="button" class="btn del block" data-act="xb-delete">Usuń</button>' : '') +
    '<button type="button" class="btn sec2 block" data-act="edit-close">Anuluj</button></div>';
  $('editor').innerHTML = h;
  $('editor').scrollTop = 0;
}

function rerender(ctx) {
  const ed = ctx.ui.edit;
  if (!ed) return;
  if (ed.type === 'sched') renderSchedEditor(ctx); else renderBasketEditor(ctx);
}

function openSched(ctx, s) {
  const lastSrc = ctx.data.settings && ctx.data.settings.lastSource;
  const first = sortedBaskets(ctx).find(isPlanBasket);
  const ed = {
    type: 'sched',
    id: null,
    orig: null,
    name: '',
    amt: '',
    basket: first ? first.id : null,
    source: SOURCES.indexOf(lastSrc) >= 0 ? lastSrc : 'konto',
    rep: '1',
    day: '',
    anchor: monthOf(ctx.today),
    date: ctx.today,
  };
  if (s) {
    const r = s.rule || {};
    ed.id = s.id;
    ed.orig = s;
    ed.name = s.name || '';
    ed.amt = moneyText(s.amount || 0);
    ed.basket = s.basket;
    ed.source = s.source;
    if (r.type === 'once') {
      ed.rep = 'once';
      ed.date = r.date || ctx.today;
    } else {
      ed.rep = String(r.every || 1);
      ed.day = String(r.day || '');
      ed.anchor = r.anchor || monthOf(ctx.today);
    }
  }
  ctx.ui.edit = ed;
  renderSchedEditor(ctx);
  openEditor();
}

function openBasket(ctx, b) {
  const cur = monthOf(ctx.today);
  const ed = { type: 'basket', id: null, orig: null, name: '', limit: '', from: cur, until: cur };
  if (b) {
    ed.id = b.id;
    ed.orig = b;
    ed.name = b.name || '';
    ed.limit = moneyText(b.limit || 0);
    ed.from = b.from || cur;
    ed.until = b.until || cur;
  }
  ctx.ui.edit = ed;
  renderBasketEditor(ctx);
  openEditor();
}

// ---------- akcje ----------

async function saveSched(ctx) {
  const ed = ctx.ui.edit;
  if (!ed || ed.type !== 'sched' || ed.busy) return;
  const name = ed.name.trim();
  if (!name) return setErr('Wpisz nazwę płatności.');
  const amount = parseAmount(String(ed.amt).trim());
  if (amount == null || !(amount > 0)) return setErr('Kwota musi być większa od zera.');
  if (!ed.basket || !ctx.data.baskets.some((b) => b.id === ed.basket)) return setErr('Wybierz koszyk.');
  let rule;
  if (ed.rep === 'once') {
    if (!RE_YMD.test(ed.date || '')) return setErr('Wybierz datę płatności.');
    rule = { type: 'once', date: ed.date };
  } else {
    const day = /^\d{1,2}$/.test(String(ed.day).trim()) ? parseInt(ed.day, 10) : NaN;
    if (!(day >= 1 && day <= 31)) return setErr('Dzień miesiąca musi być od 1 do 31.');
    if (!RE_YM.test(ed.anchor || '')) return setErr('Wybierz pierwszy miesiąc.');
    const every = parseInt(ed.rep, 10) || 1;
    rule = { type: 'monthly', day, anchor: ed.anchor };
    if (every > 1) rule.every = every;
    const oldRule = ed.orig && ed.orig.rule;
    if (oldRule && oldRule.type === 'monthly' && oldRule.until) rule.until = oldRule.until;
  }
  ed.busy = true;
  try {
    const rec = Object.assign({}, ed.orig || {}, {
      id: ed.id || newId(),
      basket: ed.basket,
      name,
      amount,
      source: ed.source,
      rule,
      active: true,
      updatedAt: nowIso(),
    });
    if (rule.type !== 'once') delete rec.nextAfterDays;
    await saveSchedule(rec);
    closeEditor(ctx);
    await ctx.reload();
    showToast('Zapisano · ' + name);
  } catch (err) {
    ed.busy = false;
    setErr('Nie udało się zapisać. Spróbuj jeszcze raz.');
    console.error(err);
  }
}

async function deleteSched(ctx) {
  const ed = ctx.ui.edit;
  if (!ed || ed.type !== 'sched' || !ed.orig || ed.busy) return;
  const orig = ed.orig;
  ed.busy = true;
  try {
    await saveSchedule(Object.assign({}, orig, { active: false, updatedAt: nowIso() }));
    closeEditor(ctx);
    await ctx.reload();
    showToast('Usunięto · ' + orig.name, async () => {
      await saveSchedule(Object.assign({}, orig, { active: true, updatedAt: nowIso() }));
      await ctx.reload();
    });
  } catch (err) {
    ed.busy = false;
    setErr('Nie udało się usunąć. Spróbuj jeszcze raz.');
    console.error(err);
  }
}

async function saveXb(ctx) {
  const ed = ctx.ui.edit;
  if (!ed || ed.type !== 'basket' || ed.busy) return;
  const name = ed.name.trim();
  if (!name) return setErr('Wpisz nazwę koszyka.');
  const raw = String(ed.limit).trim();
  const limit = raw === '' ? 0 : parseAmount(raw);
  if (limit == null || limit < 0) return setErr('Nieprawidłowy limit.');
  if (!RE_YM.test(ed.from || '') || !RE_YM.test(ed.until || '')) return setErr('Wybierz miesiące od i do.');
  if (ed.until < ed.from) return setErr('Miesiąc „do” nie może być wcześniejszy niż „od”.');
  ed.busy = true;
  try {
    let rec;
    if (ed.orig) {
      rec = Object.assign({}, ed.orig, { name, limit, from: ed.from, until: ed.until, updatedAt: nowIso() });
    } else {
      const extras = ctx.data.baskets.filter((b) => b.kind === 'extra');
      const order = extras.reduce((m, b) => Math.max(m, b.order || 0), 100) + 1;
      rec = {
        id: 'x-' + newId().replace(/-/g, '').slice(0, 8),
        name,
        kind: 'extra',
        limit,
        from: ed.from,
        until: ed.until,
        order,
        updatedAt: nowIso(),
      };
    }
    await saveBasket(rec);
    closeEditor(ctx);
    await ctx.reload();
    showToast('Zapisano · ' + name);
  } catch (err) {
    ed.busy = false;
    setErr('Nie udało się zapisać. Spróbuj jeszcze raz.');
    console.error(err);
  }
}

async function deleteXb(ctx) {
  const ed = ctx.ui.edit;
  if (!ed || ed.type !== 'basket' || !ed.orig || ed.busy) return;
  const orig = ed.orig;
  // ctx.data.entries to wpisy nieusunięte
  if ((ctx.data.entries || []).some((e) => e.basket === orig.id)) {
    const msg = 'Koszyk ma wpisy, zmień zakres zamiast usuwać';
    setErr(msg + '.');
    showToast(msg);
    return;
  }
  ed.busy = true;
  try {
    await saveBasket(Object.assign({}, orig, { deleted: true, updatedAt: nowIso() }));
    closeEditor(ctx);
    await ctx.reload();
    showToast('Usunięto · ' + orig.name, async () => {
      await saveBasket(Object.assign({}, orig, { deleted: false, updatedAt: nowIso() }));
      await ctx.reload();
    });
  } catch (err) {
    ed.busy = false;
    setErr('Nie udało się usunąć. Spróbuj jeszcze raz.');
    console.error(err);
  }
}

export const actions = {
  'plan-add'(el, ctx) { openSched(ctx, null); },
  'plan-edit'(el, ctx) {
    const s = (ctx.data.schedules || []).find((x) => x.id === el.dataset.id);
    if (s) openSched(ctx, s);
  },
  'plan-save'(el, ctx) { return saveSched(ctx); },
  'plan-delete'(el, ctx) { return deleteSched(ctx); },
  'xb-add'(el, ctx) { openBasket(ctx, null); },
  'xb-edit'(el, ctx) {
    const b = ctx.data.baskets.find((x) => x.id === el.dataset.id);
    if (b) openBasket(ctx, b);
  },
  'xb-save'(el, ctx) { return saveXb(ctx); },
  'xb-delete'(el, ctx) { return deleteXb(ctx); },
  'edit-close'(el, ctx) { if (ctx.ui.edit) closeEditor(ctx); },
  'edit-basket'(el, ctx) {
    if (!ctx.ui.edit) return;
    ctx.ui.edit.basket = el.dataset.id;
    rerender(ctx);
  },
  'edit-src'(el, ctx) {
    if (!ctx.ui.edit) return;
    ctx.ui.edit.source = el.dataset.s;
    rerender(ctx);
  },
  'edit-rep'(el, ctx) {
    if (!ctx.ui.edit) return;
    ctx.ui.edit.rep = el.dataset.r;
    rerender(ctx);
  },
};

export const changes = {
  'edit-date'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.date = el.value; },
  'edit-anchor'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.anchor = el.value; },
  'edit-from'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.from = el.value; },
  'edit-until'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.until = el.value; },
};

export const inputs = {
  'edit-name'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.name = el.value; },
  'edit-amt'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.amt = el.value; },
  'edit-day'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.day = el.value; },
  'edit-limit'(el, ctx) { if (ctx.ui.edit) ctx.ui.edit.limit = el.value; },
};
