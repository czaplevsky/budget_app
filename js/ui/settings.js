// Ustawienia: limity, weekend Miasta, saldo Wakacje, kopia, wczytanie, CSV, status przechowywania.
import { saveBasket, setSetting } from '../db.js';
import { fmtMoney, parseAmount } from '../format.js';
import { esc, ICON, fmtStamp, nowIso } from './util.js';
import { backupNow, csvNow, importText, importFile } from './backup.js';
import { showToast } from './toast.js';
import { getAi, setAi, clearAi, maskKey, checkKey, PREFERRED } from './receipt.js';
import { getLog, clearUsage, summarize, fmtUsd, fmtPln, USD_PLN } from '../usage.js';
import { monthOf } from '../format.js';
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
    h += '<div class="srow"><span class="nm">Model<small>do odczytu zdjęć; zmień, żeby porównać koszty</small></span>' +
      '<span class="inp"><select data-change="ai-model" aria-label="Model OpenAI">' +
      (ai.model && PREFERRED.indexOf(ai.model) < 0 ? '<option value="' + esc(ai.model) + '" selected>' + esc(ai.model) + '</option>' : '') +
      PREFERRED.map((m) => '<option value="' + esc(m) + '"' + (m === ai.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('') +
      '</select></span></div>';
    h += '<div class="sbtn"><button type="button" class="btn sec2 block" data-act="ai-check">Sprawdź klucz</button>' +
      '<button type="button" class="btn sec2 block" data-act="ai-clear" style="margin-top:8px">Usuń klucz</button></div>';
  }
  h += '<div class="sbtn"><div class="sub">Klucz zostaje tylko na tym telefonie, nie trafia do kopii ani CSV. Zdjęcie idzie do OpenAI, appka go nie zapisuje.</div></div></div>';

  h += renderAiCosts(ctx);

  const p = ui.persisted;
  h += '<div class="sec">Aplikacja</div><div class="card list">' +
    '<div class="srow"><span class="nm">Trwałe przechowywanie<small>chroni dane przed czyszczeniem przez system</small></span><span class="val ' + (p === true ? 'good' : p === false ? 'warnc' : '') + '">' +
    (p === true ? 'włączone' : p === false ? 'nie przyznane' : 'sprawdzam…') + '</span></div>' +
    '<div class="srow"><span class="nm">Wersja</span><span class="val num">' + APP_VERSION + '</span></div></div>';
  return h;
}

// '1 odczyt', '2 odczyty', '5 odczytów', '12 odczytów', '22 odczyty'
function odcz(n) {
  const m10 = n % 10, m100 = n % 100;
  return n + ' ' + (n === 1 ? 'odczyt' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? 'odczyty' : 'odczytów');
}

function nTokens(n) { return n >= 10000 ? Math.round(n / 1000) + ' tys.' : String(n); }

// Sekcja kosztów OpenAI: ten miesiąc, średnia na paragon, od początku, podział na modele.
function renderAiCosts(ctx) {
  const log = getLog();
  if (!log.length) {
    return '<div class="sec">Koszty OpenAI</div><div class="card list"><div class="sbtn"><div class="sub" style="margin-top:0">' +
      'Licznik zacznie liczyć od pierwszego odczytanego paragonu.</div></div></div>';
  }
  const ym = monthOf(ctx.today);
  const mon = summarize(log, ym);
  const all = summarize(log);
  const money = (s) => s.unpriced === s.scans ? 'brak ceny' : fmtUsd(s.usd) + ' · ' + fmtPln(s.pln);
  let h = '<div class="sec">Koszty OpenAI</div><div class="card list">';
  h += '<div class="srow"><span class="nm">Ten miesiąc<small>' + odcz(mon.scans) + '</small></span><span class="val num">' + esc(money(mon)) + '</span></div>';
  h += '<div class="srow"><span class="nm">Średnio na paragon<small>z całego dziennika</small></span><span class="val num">' +
    (all.avgUsd == null ? '—' : esc(fmtUsd(all.avgUsd) + ' · ' + fmtPln(all.avgUsd * USD_PLN))) + '</span></div>';
  h += '<div class="srow"><span class="nm">Od początku<small>' + odcz(all.scans) + ' · ' + nTokens(all.tokensIn) + ' tok. wej. · ' + nTokens(all.tokensOut) + ' wyj.</small></span><span class="val num">' + esc(money(all)) + '</span></div>';
  Object.keys(all.byModel).sort().forEach((m) => {
    const b = all.byModel[m];
    h += '<div class="srow"><span class="nm">' + esc(m) + '<small>' + odcz(b.scans) + '</small></span><span class="val num">' +
      (b.usd > 0 ? esc(fmtUsd(b.usd / b.scans) + ' / szt.') : 'brak ceny') + '</span></div>';
  });
  h += '<div class="sbtn"><button type="button" class="btn sec2 block" data-act="ai-usage-clear">Wyzeruj licznik</button>' +
    '<div class="sub">Koszt liczony z tokenów, które zwraca OpenAI, po cenach z cennika (kurs ' + String(USD_PLN).replace('.', ',') + ' zł/$). To podgląd, nie rachunek: prawdziwe saldo jest na platform.openai.com/usage.</div></div></div>';
  return h;
}

async function runAiCheck(ctx) {
  const ai = getAi();
  if (!ai.key) return;
  ctx.ui.aiStatus = { ok: null, short: 'sprawdzam…' };
  ctx.render();
  try {
    const model = await checkKey(ai.key, ai.model);
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
  'ai-usage-clear'(el, ctx) {
    clearUsage();
    ctx.render();
    showToast('Licznik kosztów wyzerowany');
  },
  async 'backup-now'(el, ctx) { await backupNow(ctx); },
  async csv(el, ctx) { await csvNow(ctx); },
  async 'import-paste'(el, ctx) {
    const box = document.getElementById('pasteBox');
    await importText(ctx, box ? box.value : ctx.ui.pasteText);
  },
};

export const changes = {
  'ai-model'(el, ctx) {
    if (!el.value) return;
    setAi({ model: el.value });
    ctx.ui.aiStatus = null;
    showToast('Model: ' + el.value);
    ctx.render();
  },
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
