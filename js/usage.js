// Licznik kosztów OpenAI: zapisuje tokeny z każdego odczytu paragonu, koszt liczy przy wyświetlaniu.
// Dziennik leży w localStorage (jak klucz): zostaje na tym telefonie, nie wchodzi do kopii ani CSV.
// Czysty moduł bez DOM: testowany w tests.html.

const LS_USAGE = 'koszyki.aiusage';
const MAX_ENTRIES = 1000;

// Przelicznik orientacyjny USD -> PLN (do podglądu kosztu, nie do księgowania).
export const USD_PLN = 3.7;

// Ceny w USD za 1 mln tokenów (wejście / wyjście). Źródło: cenniki OpenAI, stan 2026-11.
// Przy zmianie cennika popraw tutaj: koszt jest liczony z tokenów przy wyświetlaniu, więc stare wpisy się przeliczą.
export const PRICES = {
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
  'gpt-4.1-mini': { in: 0.40, out: 1.60 },
  'gpt-5-mini': { in: 0.25, out: 2.00 },
  'gpt-4.1': { in: 2.00, out: 8.00 },
  'gpt-4o': { in: 2.50, out: 10.00 },
};

// 'gpt-4.1-mini-2025-04-14' -> cena 'gpt-4.1-mini' (najdłuższy pasujący prefiks, żeby 'gpt-4o-mini' nie wpadło w 'gpt-4o').
export function priceFor(model) {
  const m = String(model || '');
  const keys = Object.keys(PRICES).filter((k) => m === k || m.indexOf(k + '-') === 0);
  if (!keys.length) return null;
  keys.sort((a, b) => b.length - a.length);
  return PRICES[keys[0]];
}

// Koszt jednego wpisu w USD albo null, gdy nie znamy ceny modelu.
export function costUsd(e) {
  const p = priceFor(e && e.m);
  if (!p) return null;
  return ((e.pi || 0) * p.in + (e.po || 0) * p.out) / 1e6;
}

export function getLog() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_USAGE) || '[]');
    return Array.isArray(v) ? v : [];
  } catch (err) {
    return [];
  }
}

function saveLog(list) {
  try { localStorage.setItem(LS_USAGE, JSON.stringify(list.slice(-MAX_ENTRIES))); } catch (err) { /* prywatny tryb */ }
}

// Wywołaj z odpowiedzią /chat/completions. d = data lokalna (YYYY-MM-DD), model awaryjnie z ustawień.
// Zwraca zapisany wpis albo null, gdy odpowiedź nie niesie zużycia.
export function recordUsage(data, today, fallbackModel) {
  const u = data && data.usage;
  if (!u || typeof u.prompt_tokens !== 'number') return null;
  const e = {
    d: today,
    m: (data && data.model) || fallbackModel || '',
    pi: u.prompt_tokens || 0,
    po: u.completion_tokens || 0,
  };
  const list = getLog();
  list.push(e);
  saveLog(list);
  return e;
}

export function clearUsage() {
  try { localStorage.removeItem(LS_USAGE); } catch (err) { /* ignoruj */ }
}

// Podsumowanie wpisów (opcjonalnie tylko z miesiąca ym = 'YYYY-MM').
// -> { scans, tokensIn, tokensOut, usd, pln, unpriced /* wpisy bez znanej ceny */, avgUsd, byModel: {model: {scans, usd}} }
export function summarize(list, ym) {
  const rows = ym ? list.filter((e) => typeof e.d === 'string' && e.d.slice(0, 7) === ym) : list;
  const s = { scans: rows.length, tokensIn: 0, tokensOut: 0, usd: 0, pln: 0, unpriced: 0, avgUsd: null, byModel: {} };
  rows.forEach((e) => {
    s.tokensIn += e.pi || 0;
    s.tokensOut += e.po || 0;
    const c = costUsd(e);
    const key = e.m || '?';
    const bm = s.byModel[key] || (s.byModel[key] = { scans: 0, usd: 0 });
    bm.scans += 1;
    if (c == null) s.unpriced += 1; else { s.usd += c; bm.usd += c; }
  });
  s.pln = s.usd * USD_PLN;
  const priced = s.scans - s.unpriced;
  s.avgUsd = priced > 0 ? s.usd / priced : null;
  return s;
}

// '$0,0012' / '0,45 zł'. USD z 4 miejscami, bo jeden paragon to ułamki centa.
export function fmtUsd(v) {
  return '$' + (v || 0).toFixed(4).replace('.', ',');
}
export function fmtPln(v) {
  return (v || 0).toFixed(2).replace('.', ',') + ' zł';
}
