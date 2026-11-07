// Koszyki: punkt wejścia. loadAll() -> monthState() -> render. Stan UI w zwykłym obiekcie.
import { openDb, loadAll, requestPersist, isPersisted } from './db.js';
import { monthState, monthsWithData } from './calc.js';
import { todayYmd, monthOf } from './format.js';
import { initToast, showToast } from './ui/toast.js';
import * as home from './ui/home.js';
import * as basket from './ui/basket.js';
import * as sheet from './ui/sheet.js';
import * as occ from './ui/occ.js';
import * as history from './ui/history.js';
import * as month from './ui/month.js';
import * as settings from './ui/settings.js';
import * as welcome from './ui/welcome.js';

const ui = {
  tab: 'home',        // home | hist | month | set
  month: null,        // wybrany miesiąc w zakładce Miesiąc (null = bieżący)
  histMonth: null,    // miesiąc w Historii (null = bieżący)
  histFilter: 'all',  // filtr koszyka w Historii
  basket: null,       // otwarty koszyk (szczegóły)
  sheet: null,        // stan arkusza dodawania/edycji
  next: null,         // propozycja następnej płatności
  importMsg: null,    // wynik wczytania kopii
  pasteText: '',
  welcomePaste: false,
  welcomeText: '',
  persisted: null,
};

const ctx = {
  ui,
  data: null,
  ms: null,
  msMonth: null,
  today: null,
  reload,
  render,
  openSheet: (init) => sheet.openSheet(ctx, init),
};

const VIEWS = { home: 'v-home', hist: 'v-hist', month: 'v-month', set: 'v-set' };

function $(id) { return document.getElementById(id); }

function setHtml(id, html) {
  const el = $(id);
  if (el._html !== html) {
    // pozycje poziomo przewijanych pasków chipów przeżywają przerysowanie
    const keep = [...el.querySelectorAll('.chips')].map((c) => c.scrollLeft);
    el.innerHTML = html;
    el._html = html;
    el.querySelectorAll('.chips').forEach((c, i) => { if (keep[i]) c.scrollLeft = keep[i]; });
  }
}

let chain = Promise.resolve();
function reload(opts) {
  chain = chain.catch(() => {}).then(() => doReload(opts));
  return chain;
}

async function doReload(opts) {
  ctx.data = await loadAll();
  ctx.today = todayYmd();
  const cur = monthOf(ctx.today);
  ctx.ms = monthState(cur, ctx.data, ctx.today);
  // wybrany miesiąc zniknął z listy (usunięty ostatni wpis) → wracamy do bieżącego, żeby nie utknąć
  const avail = monthsWithData(ctx.data.entries, ctx.today);
  if (ui.month && !avail.includes(ui.month)) ui.month = null;
  if (ui.histMonth && !avail.includes(ui.histMonth)) ui.histMonth = null;
  const ym = ui.month || cur;
  ctx.msMonth = ym === cur ? ctx.ms : monthState(ym, ctx.data, ctx.today);
  render(opts);
}

function render(opts) {
  opts = opts || {};
  if (!ctx.data) return;
  const showWelcome = welcome.shouldShowWelcome(ctx.data);
  $('welcome').classList.toggle('on', showWelcome);
  if (showWelcome) setHtml('welcome', welcome.renderWelcome(ctx));

  setHtml('v-home', home.renderHome(ctx));
  setHtml('v-hist', history.renderHistory(ctx));
  setHtml('v-month', month.renderMonth(ctx));
  if (!opts.keepSettings) setHtml('v-set', settings.renderSettings(ctx));

  const det = basket.renderDetail(ctx);
  if (det != null) setHtml('detail', det);
  $('detail').classList.toggle('on', ui.basket != null && det != null);

  Object.keys(VIEWS).forEach((k) => $(VIEWS[k]).classList.toggle('on', k === ui.tab));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  occ.renderDialog(ctx);
}

const actions = Object.assign({}, home.actions, basket.actions, sheet.actions, occ.actions, history.actions, month.actions, settings.actions, welcome.actions, {
  tab(el) {
    const t = el.dataset.tab;
    if (t === ui.tab && ui.basket == null) {
      const v = $(VIEWS[t]);
      if (v) v.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    ui.tab = t;
    ui.basket = null;
    render();
  },
});
const changes = Object.assign({}, sheet.changes, occ.changes, settings.changes);
const inputs = Object.assign({}, sheet.inputs, settings.inputs, welcome.inputs);

function fail(err) {
  console.error(err);
  showToast('Coś poszło nie tak. Spróbuj jeszcze raz.');
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest ? ev.target.closest('[data-act]') : null;
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  try { await fn(el, ctx, ev); } catch (err) { fail(err); }
});

document.addEventListener('change', async (ev) => {
  const el = ev.target.closest ? ev.target.closest('[data-change]') : null;
  if (!el) return;
  const fn = changes[el.dataset.change];
  if (!fn) return;
  try { await fn(el, ctx, ev); } catch (err) { fail(err); }
});

document.addEventListener('input', (ev) => {
  const el = ev.target.closest ? ev.target.closest('[data-input]') : null;
  if (!el) return;
  const fn = inputs[el.dataset.input];
  if (fn) fn(el, ctx, ev);
});

// requestPersist() raz, po pierwszej interakcji użytkownika
document.addEventListener('pointerdown', () => {
  requestPersist().then((p) => {
    ui.persisted = !!p;
    if (ctx.data) render();
  }).catch(() => {});
}, { once: true, capture: true });

// Po powrocie do appki odśwież (np. zmiana dnia)
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !ctx.data || ui.sheet) return;
  reload({ keepSettings: ui.tab === 'set' }).catch(() => {});
});

function registerSW() {
  try {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      });
    }
  } catch (err) { /* offline nie jest krytyczny */ }
}

async function boot() {
  initToast();
  registerSW();
  try {
    await openDb();
    try { ui.persisted = await isPersisted(); } catch (err) { ui.persisted = null; }
    await reload();
  } catch (err) {
    console.error(err);
    $('v-home').innerHTML = '<div class="fatal"><b>Nie można otworzyć bazy danych</b><br>' +
      'Koszyki zapisują dane w tej przeglądarce (IndexedDB). Sprawdź, czy nie jest włączony tryb prywatny, i odśwież stronę.</div>';
  }
}

boot();
