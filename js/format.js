// format.js: formatowanie i parsowanie kwot oraz dat (kontrakt, sekcja 5).
// Kwoty: liczby calkowite w groszach. Daty: 'YYYY-MM-DD' / 'YYYY-MM', arytmetyka przez Date.UTC (bez stref).

const NBSP = ' ';
const MINUS = '−';

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

function parseYmd(ymd) {
  return [Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), Number(ymd.slice(8, 10))];
}

// ---------- kwoty ----------

export function fmtMoney(grosze, opts = {}) {
  let abs = Math.abs(Math.round(grosze));
  const neg = grosze < 0;
  // round: 'auto' = bez groszy tylko gdy kwota jest okrągła (limity), true = zawsze zaokrąglij (tempo, na dziś)
  const doRound = opts.round === 'auto' ? abs % 100 === 0 : !!opts.round;
  if (doRound) abs = Math.round(abs / 100) * 100;
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  let s = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  if (!doRound) s += ',' + pad2(frac);
  let prefix = '';
  if (abs > 0) {
    if (neg) prefix = MINUS;
    else if (opts.sign) prefix = '+';
  }
  return prefix + s + (opts.noUnit ? '' : NBSP + 'zł');
}

// '24,99' | '24.99' | '1 234,5' -> grosze; blad -> null
export function parseAmount(str) {
  if (typeof str !== 'string') return null;
  let s = str.replace(/[\s  ]/g, '').replace(/zł$/i, '');
  if (s === '') return null;
  const lc = s.lastIndexOf(',');
  const ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    // oba znaki: ostatni jest dziesietnym, drugi to separator tysiecy
    if (lc > ld) s = s.replace(/\./g, '');
    else s = s.replace(/,/g, '');
  }
  s = s.replace(',', '.');
  let m = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  let whole;
  let frac;
  if (m) {
    whole = m[1];
    frac = m[2] || '';
  } else {
    m = /^\.(\d{1,2})$/.exec(s);
    if (!m) return null;
    whole = '0';
    frac = m[1];
  }
  const g = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return Number.isSafeInteger(g) ? g : null;
}

// stan klawiatury ('24,9') -> grosze; '' -> 0
export function amountInputToGrosze(digitsState) {
  const g = parseAmount(String(digitsState || '').replace(/^,/, '0,'));
  return g === null ? 0 : g;
}

// key: '0'-'9' | ',' | 'back'
export function keypadPress(state, key) {
  state = state || '';
  if (key === 'back') return state.slice(0, -1);
  const ci = state.indexOf(',');
  if (key === ',') {
    if (ci >= 0) return state;
    return state === '' ? '0,' : state + ',';
  }
  if (!/^[0-9]$/.test(key)) return state;
  if (ci >= 0) {
    if (state.length - ci - 1 >= 2) return state; // max 2 cyfry po przecinku
    return state + key;
  }
  if (state === '0') return key; // bez zer wiodacych
  if (state.length >= 7) return state; // max 7 cyfr przed przecinkiem
  return state + key;
}

// ---------- daty ----------

export function dayOfWeek(ymd) { // 0 = niedziela
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(ymd, n) {
  const [y, m, d] = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysInMonth(ym) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthOf(ymd) {
  return ymd.slice(0, 7);
}

export function shiftMonth(ym, n) {
  const y = Number(ym.slice(0, 4));
  const m = Number(ym.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return ny + '-' + pad2(nm);
}

export function fmtDateShort(ymd) {
  const [, m, d] = parseYmd(ymd);
  return d + ' ' + MONTHS_SHORT[m - 1];
}

export function fmtDayHeader(ymd) {
  const [, m, d] = parseYmd(ymd);
  return WEEKDAYS[dayOfWeek(ymd)] + ', ' + d + ' ' + MONTHS_GEN[m - 1];
}

export function monthName(ym) {
  return MONTHS[Number(ym.slice(5, 7)) - 1];
}

export function monthNameGen(ym) {
  return MONTHS_GEN[Number(ym.slice(5, 7)) - 1];
}

export function monthLabel(ym) {
  return monthName(ym) + ' ' + ym.slice(0, 4);
}

// jedyne miejsce z new Date(): lokalna data telefonu
export function todayYmd() {
  const t = new Date();
  return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
}
