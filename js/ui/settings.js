// Ustawienia: limity, weekend Miasta, saldo Wakacje, kopia, wczytanie, CSV, status przechowywania.
import { saveBasket, setSetting } from '../db.js';
import { fmtMoney, parseAmount } from '../format.js';
import { esc, ICON, fmtStamp, nowIso } from './util.js';
import { backupNow, csvNow, importText, importFile } from './backup.js';
import { showToast } from './toast.js';
import { getAi, setAi, clearAi, maskKey, checkKey } from './receipt.js';
import { renderPlanSections } from './plans.js';

export const APP_VERSION = 'F2 · 2026-11';

function inputVal(g) { return g == null ? '' : fmtMoney(g, { noUnit: true }); }

function parseField(raw) {
  const s = String(raw).trim();
  if (s === '') return 0;
  const g = parseAmount(s);
  return g == null || g < 0 ? null : g;
}

export function importMsgHtml(ctx) {
  const m = ctx.ui.importMsg;
  if (!m) return '';
  return '<div class="res ' + (m.ok ? 'okr' : 'err') + '" role="status">' + esc(m.text) + '</div>';
}

export function renderSettings(ctx) {
  const { data, ui } = ctx;
  const s = data.settings || {};
  const baskets = data.baskets.slice().sort((a, b) => a.order - b.order);
  let h = '<h1 class="large">Ustawienia</h1>';

  h += '<div class="sec first">Limity miesięczne</div><div class="card list">';
  baskets.forEach((b) => {
    if (b.kind === 'extra' || b.deleted) return;
    if (b.kind === 'daily' || b.kind === 'fixed') {
      h += '<div class="srow"><span class="nm">' + esc(b.name) + (b.kind === 'fixed' ? '<small>płatności stałe razem</small>' : '') + '</span>' +
        '<span class="inp"><input type="text" inputmode="decimal" autocomplete="off" class="num" data-change="limit" data-id="' + esc(b.id) + '" value="' + inputVal(b.limit || 0) + '" aria-label="Limit: ' + esc(b.name) + '">zł</span></div>';
      if (b.id === 'miasto') {
        h += '<div class="srow"><span class="nm">Limit weekendu (sob+nd)<small>' + esc(b.name) + '</small></span>' +
          '<span class="inp"><input type="text" inputmode="decimal" autocomplete="off" class="num" data-change="weekend" data-id="' + esc(b.id) + '" value="' + (b.weekendLimit ? inputVal(b.weekendLimit) : '') + '" placeholder="0,00" aria-label="Limit weekendu">zł</span></div>';
      }
    } else if (b.kind === 'planned') {
      h += '<div class="srow"><span class="nm">' + esc(b.name) + '<small>wynika z płatności planowanych</small></span><span class="val">automat</span></div>';
    } else {
      h += '<div class="srow"><span class="nm">' + esc(b.name) + '<small>poza limitami, z celu Wakacje</small></span><span class="val">bez limitu</span></div>';
    }
  });
  h += '</div>';

  h += renderPlanSections(ctx);

  h += '<div class="sec">Cel Wakacje</div><div class="card list">' +
    '<div class="srow"><span class="nm">Saldo<small>stan celu w dniu poniżej</small></span><span class="inp"><input type="text" inputmode="decimal" autocomplete="off" class="num" data-change="wak-balance" value="' + inputVal(s.wakacjeBalance) + '" placeholder="0,00" aria-label="Saldo Wakacje">zł</span></div>' +
    '<div class="srow"><span class="nm">Na dzień<small>wpisy Wyjazdów po tej dacie obniżają saldo</small></span><span class="inp"><input type="date" data-change="wak-date" value="' + esc(s.wakacjeAsOf || '') + '" aria-label="Data salda"></span></div></div>';

  h += '<div class="sec">Kopia zapasowa</div><div class="card list">';
  h += '<div class="sbtn"><button type="button" class="btn pri block" data-act="backup-now">' + ICON.save + 'Zapisz kopię</button>' +
    '<div class="sub">Ostatnia kopia: ' + (s.lastBackupAt ? esc(fmtStamp(s.lastBackupAt)) : 'nigdy') + '. Zapisz do Plików / iCloud.</div></div>';
  h += '<div class="sbtn"><label class="btn sec2 block filebtn">Wczytaj kopię z pliku<input type="file" accept=".json,application/json" data-change="file-import"></label></div>';
  h += '<div class="sbtn"><textarea class="paste" id="pasteBox" data-input="paste" placeholder="Wklej tu treść kopii (JSON)" spellcheck="false" autocapitalize="off" autocomplete="off">' + esc(ui.pasteText || '') + '</textarea>' +
    '<button type="button" class="btn sec2 block" data-act="import-paste">Wczytaj z wklejonego tekstu</button>' + importMsgHtml(ctx) +
    '<div class="sub">Wczytanie scala dane: nowsze wpisy wygrywają, nic nie jest kasowane.</div></div>';
  h += '</div>';

  h += '<div class="sec">Eksport</div><div class="card list"><div class="sbtn"><button type="button" class="btn sec2 block" data-act="csv">' + ICON.down + 'Eksportuj CSV</button></div></div>';

  const ai = getAi();
  const st = ui.aiStatus;
  h += '<div class="sec">Paragony (OpenAI)</div><div class="card list">';
  if (!ai.key) {
    h += '<div class="srow"><span class="nm">Klucz API<small>wklej klucz sk-… z platform.openai.com</small></span>' +
      '<span class="inp"><input type="password" autocomplete="off" autocapitalize="off" spellcheck="false" data-change="ai-key" placeholder="sk-…" aria-label="Klucz OpenAI" style="width:140px;text-align:left"></span></div>';
  } else {
    h += '<div class="srow"><span class="nm">Klucz API<small>' + esc(maskKey(ai.key)) + (ai.model ? ' · model ' + esc(ai.model) : '') + '</small></span>' +
      '<span class="val ' + (st && st.ok === true ? 'good' : st && st.ok === false ? 'warnc' : '') + '">' +
      (st ? esc(st.short) : 'zapisany') + '</span></div>';
    if (st && st.ok === false) h += '<div class="sbtn"><div class="res err" role="status">' + esc(st.text) + '</div></div>';
    h += '<div class="sbtn"><button type="button" class="btn sec2 block" data-act="ai-check">Sprawdź klucz</button>' +
      '<button type="button" class="btn sec2 block" data-act="ai-clear" style="margin-top:8px">Usuń klucz</button></div>';
  }
  h += '<div class="sbtn"><div class="sub">Klucz zostaje tylko na tym telefonie, nie trafia do kopii ani CSV. Zdjęcie idzie do OpenAI, appka go nie zapisuje.</div></div></div>';

  const p = ui.persisted;
  h += '<div class="sec">Aplikacja</div><div class="card list">' +
    '<div class="srow"><span class="nm">Trwałe przechowywanie<small>chroni dane przed czyszczeniem przez system</small></span><span class="val ' + (p === true ? 'good' : p === false ? 'warnc' : '') + '">' +
    (p === true ? 'włączone' : p === false ? 'nie przyznane' : 'sprawdzam…') + '</span></div>' +
    '<div class="srow"><span class="nm">Wersja</span><span class="val num">' + APP_VERSION + '</span></div></div>';
  return h;
}

async function runAiCheck(ctx) {
  const ai = getAi();
  if (!ai.key) return;
  ctx.ui.aiStatus = { ok: null, short: 'sprawdzam…' };
  ctx.render();
  try {
    const model = await checkKey(ai.key);
    setAi({ model });
    ctx.ui.aiStatus = { ok: true, short: 'działa' };
  } catch (err) {
    ctx.ui.aiStatus = { ok: false, short: 'błąd', text: err && err.message ? err.message : 'Nie udało się sprawdzić klucza.' };
  }
  ctx.render();
}

export const actions = {
  async 'ai-check'(el, ctx) { await runAiCheck(ctx); },
  'ai-clear'(el, ctx) {
    clearAi();
    ctx.ui.aiStatus = null;
    ctx.render();
    showToast('Klucz usunięty z telefonu');
  },
  async 'backup-now'(el, ctx) { await backupNow(ctx); },
  async csv(el, ctx) { await csvNow(ctx); },
  async 'import-paste'(el, ctx) {
    const box = document.getElementById('pasteBox');
    await importText(ctx, box ? box.value : ctx.ui.pasteText);
  },
};

export const changes = {
  async 'ai-key'(el, ctx) {
    const k = String(el.value || '').replace(/\s+/g, '');
    if (!k) return;
    setAi({ key: k, model: '' });
    el.value = '';
    await runAiCheck(ctx);
  },
  async limit(el, ctx) {
    const b = ctx.data.baskets.find((x) => x.id === el.dataset.id);
    if (!b) return;
    const g = parseField(el.value);
    if (g == null) {
      el.value = inputVal(b.limit || 0);
      showToast('Nieprawidłowa kwota');
      return;
    }
    await saveBasket(Object.assign({}, b, { limit: g, updatedAt: nowIso() }));
    await ctx.reload({ keepSettings: true });
    el.value = inputVal(g);
  },
  async weekend(el, ctx) {
    const b = ctx.data.baskets.find((x) => x.id === el.dataset.id);
    if (!b) return;
    const g = parseField(el.value);
    if (g == null) {
      el.value = b.weekendLimit ? inputVal(b.weekendLimit) : '';
      showToast('Nieprawidłowa kwota');
      return;
    }
    await saveBasket(Object.assign({}, b, { weekendLimit: g, updatedAt: nowIso() }));
    await ctx.reload({ keepSettings: true });
    el.value = g ? inputVal(g) : '';
  },
  async 'wak-balance'(el, ctx) {
    const g = parseField(el.value);
    if (g == null) {
      el.value = inputVal(ctx.data.settings.wakacjeBalance);
      showToast('Nieprawidłowa kwota');
      return;
    }
    await setSetting('wakacjeBalance', g);
    if (!ctx.data.settings.wakacjeAsOf) {
      await setSetting('wakacjeAsOf', ctx.today);
      const d = document.querySelector('[data-change="wak-date"]');
      if (d) d.value = ctx.today;
    }
    await ctx.reload({ keepSettings: true });
    el.value = inputVal(g);
  },
  async 'wak-date'(el, ctx) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(el.value)) return;
    await setSetting('wakacjeAsOf', el.value);
    await ctx.reload({ keepSettings: true });
  },
  async 'file-import'(el, ctx) {
    const f = el.files && el.files[0];
    if (!f) return;
    await importFile(ctx, f);
    try { el.value = ''; } catch (err) { /* ignoruj */ }
  },
};

export const inputs = {
  paste(el, ctx) { ctx.ui.pasteText = el.value; },
};
