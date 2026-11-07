// Testy format.js i calc.js. Tylko liczby syntetyczne. Uruchamiane z tests.html.
import * as F from './format.js';
import * as C from './calc.js';

const N = ' '; // twarda spacja
const M = '−'; // minus

let total = 0;
let passed = 0;
const list = document.getElementById('results');

function record(ok, label, detail) {
  total++;
  if (ok) passed++;
  const li = document.createElement('li');
  li.className = ok ? 'pass' : 'fail';
  const b = document.createElement('b');
  b.textContent = ok ? 'PASS' : 'FAIL';
  li.appendChild(b);
  li.appendChild(document.createTextNode(' ' + label + (ok ? '' : ' | ' + detail)));
  list.appendChild(li);
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  record(a === e, label, 'dostalem ' + a + ', oczekiwano ' + e);
}

function group(name, fn) {
  const h = document.createElement('h3');
  h.textContent = name;
  list.appendChild(h);
  try {
    fn();
  } catch (err) {
    record(false, name + ': wyjatek', String(err && err.stack ? err.stack : err));
  }
}

// ---------- pomocnicy do danych ----------
const TODAY = '2026-11-07'; // sobota, listopad ma 30 dni
let seq = 0;
const bk = (id, kind, limit, extra) => ({ id, name: id, kind, limit, order: ++seq, updatedAt: '1970-01-01T00:00:00.000Z', ...extra });
const en = (basket, date, amount, extra) => {
  seq++;
  return {
    id: 'e' + seq, date, amount, isRefund: false, basket, source: 'konto', note: '', origin: 'manual',
    deleted: false, createdAt: '2026-11-01T10:00:' + String(seq % 60).padStart(2, '0') + '.' + String(Math.floor(seq / 60)).padStart(3, '0') + 'Z',
    updatedAt: '2026-11-01T10:00:00.000Z', ...extra,
  };
};
const data = (over) => ({ baskets: [], entries: [], schedules: [], occStates: [], settings: {}, ...over });
const sch = (id, basket, amount, rule, extra) => ({ id, basket, name: id, amount, source: 'konto', rule, active: true, updatedAt: '2026-11-01T00:00:00.000Z', ...extra });
const getB = (ms, id) => ms.baskets.find((b) => b.id === id);

// ================= format.js =================
group('fmtMoney', () => {
  eq(F.fmtMoney(123456), '1' + N + '234,56' + N + 'zł', 'fmtMoney(123456)');
  eq(F.fmtMoney(0), '0,00' + N + 'zł', 'zero');
  eq(F.fmtMoney(5), '0,05' + N + 'zł', 'grosze z zerem wiodacym');
  eq(F.fmtMoney(100000000), '1' + N + '000' + N + '000,00' + N + 'zł', 'miliony');
  eq(F.fmtMoney(99999), '999,99' + N + 'zł', 'bez separatora tysiecy ponizej 1000');
  eq(F.fmtMoney(-15000, { sign: true }), M + '150,00' + N + 'zł', 'sign minus');
  eq(F.fmtMoney(15000, { sign: true }), '+150,00' + N + 'zł', 'sign plus');
  eq(F.fmtMoney(0, { sign: true }), '0,00' + N + 'zł', 'sign przy zerze bez znaku');
  eq(F.fmtMoney(-15000), M + '150,00' + N + 'zł', 'ujemna bez sign dalej z minusem');
  eq(F.fmtMoney(123456, { noUnit: true }), '1' + N + '234,56', 'noUnit');
  eq(F.fmtMoney(9349, { round: true }), '93' + N + 'zł', 'round w dol');
  eq(F.fmtMoney(9350, { round: true }), '94' + N + 'zł', 'round polowa w gore');
  eq(F.fmtMoney(-9350, { round: true, sign: true }), M + '94' + N + 'zł', 'round + sign ujemna');
  eq(F.fmtMoney(-20, { round: true }), '0' + N + 'zł', 'ujemna zaokraglona do zera bez minusa');
  eq(F.fmtMoney(123456, { round: true, noUnit: true }), '1' + N + '235', 'round + noUnit');
  eq(F.fmtMoney(123400, { round: 'auto' }), '1' + N + '234' + N + 'zł', 'round auto: okragla bez groszy');
  eq(F.fmtMoney(123450, { round: 'auto' }), '1' + N + '234,50' + N + 'zł', 'round auto: nieokragla z groszami');
});

group('parseAmount', () => {
  eq(F.parseAmount('24,99'), 2499, 'przecinek');
  eq(F.parseAmount('24.99'), 2499, 'kropka');
  eq(F.parseAmount('1 234,5'), 123450, 'spacja tysiecy, jedna cyfra groszy');
  eq(F.parseAmount('1' + N + '234,5'), 123450, 'twarda spacja');
  eq(F.parseAmount('12'), 1200, 'liczba calkowita');
  eq(F.parseAmount('0,05'), 5, '0,05');
  eq(F.parseAmount(',5'), 50, ',5');
  eq(F.parseAmount('24,'), 2400, 'przecinek na koncu');
  eq(F.parseAmount('1.234,56'), 123456, 'kropka tysiecy + przecinek');
  eq(F.parseAmount('1,234.56'), 123456, 'przecinek tysiecy + kropka');
  eq(F.parseAmount('0'), 0, 'zero');
  eq(F.parseAmount(''), null, 'pusty');
  eq(F.parseAmount('abc'), null, 'tekst');
  eq(F.parseAmount('1,2,3'), null, 'dwa przecinki');
  eq(F.parseAmount('24,999'), null, 'trzy cyfry groszy');
  eq(F.parseAmount('-5'), null, 'ujemna');
  eq(F.parseAmount(null), null, 'null');
  eq(F.parseAmount(undefined), null, 'undefined');
});

group('amountInputToGrosze', () => {
  eq(F.amountInputToGrosze('24,9'), 2490, "'24,9'");
  eq(F.amountInputToGrosze(''), 0, 'pusty');
  eq(F.amountInputToGrosze('24,'), 2400, "'24,'");
  eq(F.amountInputToGrosze('5'), 500, "'5'");
  eq(F.amountInputToGrosze('0,07'), 7, "'0,07'");
  eq(F.amountInputToGrosze(','), 0, 'sam przecinek');
  eq(F.amountInputToGrosze('1234567,99'), 123456799, 'maksimum');
});

group('keypadPress', () => {
  eq(F.keypadPress('24,99', '9'), '24,99', 'max 2 cyfry po przecinku');
  eq(F.keypadPress('24,9', '9'), '24,99', 'druga cyfra groszy');
  eq(F.keypadPress('', ','), '0,', 'przecinek na pustym -> 0,');
  eq(F.keypadPress('1,', ','), '1,', 'drugi przecinek ignorowany');
  eq(F.keypadPress('12', ','), '12,', 'przecinek po cyfrach');
  eq(F.keypadPress('12', 'back'), '1', 'back');
  eq(F.keypadPress('', 'back'), '', 'back na pustym');
  eq(F.keypadPress('24,', 'back'), '24', 'back zdejmuje przecinek');
  eq(F.keypadPress('24,9', 'back'), '24,', 'back zdejmuje cyfre groszy');
  eq(F.keypadPress('1234567', '8'), '1234567', 'max 7 cyfr przed przecinkiem');
  eq(F.keypadPress('123456', '7'), '1234567', 'siodma cyfra przechodzi');
  eq(F.keypadPress('1234567', ','), '1234567,', 'przecinek przy 7 cyfrach');
  eq(F.keypadPress('1234567,', '5'), '1234567,5', 'grosze przy 7 cyfrach');
  eq(F.keypadPress('0', '5'), '5', 'brak zera wiodacego');
  eq(F.keypadPress('0', '0'), '0', 'zero + zero');
  eq(F.keypadPress('', '7'), '7', 'pierwsza cyfra');
  eq(F.keypadPress('0,', '5'), '0,5', '0,5');
  eq(F.keypadPress('3', 'x'), '3', 'nieznany klawisz ignorowany');
});

group('daty', () => {
  eq(F.addDays('2026-11-30', 1), '2026-12-01', 'addDays koniec miesiaca');
  eq(F.addDays('2026-03-01', -1), '2026-02-28', 'addDays luty (nieprzestepny)');
  eq(F.addDays('2028-02-28', 1), '2028-02-29', 'addDays luty przestepny');
  eq(F.addDays('2026-12-31', 1), '2027-01-01', 'addDays nowy rok');
  eq(F.addDays('2026-11-07', 48), '2026-12-25', 'addDays +48');
  eq(F.addDays('2026-11-07', 0), '2026-11-07', 'addDays 0');
  eq(F.daysInMonth('2026-02'), 28, 'luty 2026');
  eq(F.daysInMonth('2028-02'), 29, 'luty 2028');
  eq(F.daysInMonth('2026-11'), 30, 'listopad');
  eq(F.daysInMonth('2026-12'), 31, 'grudzien');
  eq(F.monthOf('2026-11-07'), '2026-11', 'monthOf');
  eq(F.shiftMonth('2026-12', 1), '2027-01', 'shiftMonth grudzien -> styczen');
  eq(F.shiftMonth('2026-01', -1), '2025-12', 'shiftMonth styczen -> grudzien');
  eq(F.shiftMonth('2026-11', 0), '2026-11', 'shiftMonth 0');
  eq(F.shiftMonth('2026-11', 14), '2028-01', 'shiftMonth +14');
  eq(F.shiftMonth('2026-11', -11), '2025-12', 'shiftMonth -11');
  eq(F.shiftMonth('2026-01', -12), '2025-01', 'shiftMonth -12');
  eq(F.fmtDateShort('2026-11-07'), '7 lis', 'fmtDateShort');
  eq(F.fmtDateShort('2026-01-15'), '15 sty', 'fmtDateShort styczen');
  eq(F.fmtDateShort('2026-10-01'), '1 paź', 'fmtDateShort pazdziernik');
  eq(F.fmtDayHeader('2026-11-07'), 'sobota, 7 listopada', 'fmtDayHeader sobota');
  eq(F.fmtDayHeader('2026-11-08'), 'niedziela, 8 listopada', 'fmtDayHeader niedziela');
  eq(F.fmtDayHeader('2026-11-09'), 'poniedziałek, 9 listopada', 'fmtDayHeader poniedzialek');
  eq(F.monthName('2026-11'), 'Listopad', 'monthName');
  eq(F.monthName('2026-05'), 'Maj', 'monthName maj');
  eq(F.monthNameGen('2026-11'), 'listopada', 'monthNameGen');
  eq(F.monthNameGen('2026-03'), 'marca', 'monthNameGen marzec');
  eq(F.monthLabel('2026-11'), 'Listopad 2026', 'monthLabel');
  eq(/^\d{4}-\d{2}-\d{2}$/.test(F.todayYmd()), true, 'todayYmd format');
  eq(F.dayOfWeek('2026-11-07'), 6, 'dayOfWeek sobota');
  eq(F.dayOfWeek('2026-11-08'), 0, 'dayOfWeek niedziela');
});

// ================= calc.js =================
group('signed i podstawowe sumy', () => {
  eq(C.signed({ amount: 500, isRefund: false }), 500, 'signed zakup');
  eq(C.signed({ amount: 500, isRefund: true }), -500, 'signed zwrot');

  // wymagany przypadek: dwa koszyki daily
  const d = data({
    baskets: [bk('a', 'daily', 80000), bk('b', 'daily', 40000)],
    entries: [en('a', '2026-11-03', 10000)],
  });
  const ms = C.monthState('2026-11', d, TODAY);
  eq(ms.totals.daily.limit, 120000, 'daily.limit');
  eq(ms.totals.daily.spent, 10000, 'daily.spent');
  eq(ms.totals.daily.remaining, 110000, 'daily.remaining');
  eq(ms.daysLeft, 24, 'daysLeft');
  eq(ms.dayOfMonth, 7, 'dayOfMonth');
  eq(ms.daysInMonth, 30, 'daysInMonth');
  eq(ms.totals.perDay, 4583, 'perDay = floor(110000/24)');
  eq(ms.isCurrent, true, 'isCurrent');
  eq(ms.isPast, false, 'isPast');
  eq(ms.ym, '2026-11', 'ym');
  eq(ms.today, TODAY, 'today');
  eq(ms.totals.limitAll, 120000, 'limitAll');
  eq(ms.totals.spentAll, 10000, 'spentAll');
  eq(ms.totals.wakacje, null, 'wakacje null bez ustawien');
});

group('zwroty', () => {
  const d = data({
    baskets: [bk('a', 'daily', 50000)],
    entries: [en('a', '2026-11-02', 8000), en('a', '2026-11-03', 5000, { isRefund: true })],
  });
  const ms = C.monthState('2026-11', d, TODAY);
  eq(getB(ms, 'a').spent, 3000, 'zakup 80,00 + zwrot 50,00 = 30,00');
  eq(getB(ms, 'a').remaining, 47000, 'remaining po zwrocie');

  const d2 = data({ baskets: [bk('a', 'daily', 50000)], entries: [en('a', '2026-11-03', 5000, { isRefund: true })] });
  const b2 = getB(C.monthState('2026-11', d2, TODAY), 'a');
  eq(b2.spent, -5000, 'sam zwrot daje spent ujemne');
  eq(b2.remaining, 55000, 'remaining powyzej limitu');
  eq(b2.status, 'ok', 'status ok przy ujemnym spent');
});

group('deleted ignorowane', () => {
  const dead = en('a', '2026-11-03', 9999, { deleted: true });
  const d = data({
    baskets: [bk('a', 'daily', 50000)],
    entries: [en('a', '2026-11-03', 1000), dead, en('a', '2020-05-05', 100, { deleted: true })],
  });
  const ms = C.monthState('2026-11', d, TODAY);
  eq(getB(ms, 'a').spent, 1000, 'spent bez deleted');
  eq(getB(ms, 'a').entries.length, 1, 'entries bez deleted');
  eq(ms.totals.bySource.konto, 1000, 'bySource bez deleted');
  eq(C.historyGroups(d.entries, '2026-11', null).length, 1, 'historyGroups bez deleted');
  eq(C.monthsWithData(d.entries, TODAY), ['2026-11'], 'monthsWithData bez deleted');
});

group('occurrencesForMonth: monthly', () => {
  const s31 = sch('s31', 'x', 1000, { type: 'monthly', day: 31, anchor: '2026-01' });
  const o = C.occurrencesForMonth([s31], '2026-11');
  eq(o.length, 1, 'dzien 31 wystepuje w listopadzie');
  eq(o[0].date, '2026-11-30', 'dzien 31 -> 30 w listopadzie');
  eq(o[0].occId, 's31@2026-11', 'occId monthly');
  eq(o[0].scheduleId, 's31', 'scheduleId');
  eq(o[0].basket, 'x', 'basket w wystapieniu');
  eq(o[0].amount, 1000, 'kwota w wystapieniu');
  eq(o[0].source, 'konto', 'zrodlo w wystapieniu');
  eq(o[0].nextAfterDays, null, 'brak nextAfterDays -> null');
  eq(C.occurrencesForMonth([s31], '2026-02')[0].date, '2026-02-28', 'luty nieprzestepny');
  eq(C.occurrencesForMonth([s31], '2028-02')[0].date, '2028-02-29', 'luty przestepny');
  eq(C.occurrencesForMonth([s31], '2026-12')[0].date, '2026-12-31', 'grudzien dzien 31');
  eq(C.occurrencesForMonth([sch('s15', 'x', 1, { type: 'monthly', day: 15, anchor: '2026-01' })], '2026-11')[0].date, '2026-11-15', 'dzien 15');

  const ev2 = sch('ev2', 'x', 1000, { type: 'monthly', day: 10, every: 2, anchor: '2026-10' });
  eq(C.occurrencesForMonth([ev2], '2026-12').length, 1, 'every 2: jest w grudniu');
  eq(C.occurrencesForMonth([ev2], '2026-11').length, 0, 'every 2: nie ma w listopadzie');
  eq(C.occurrencesForMonth([ev2], '2026-10').length, 1, 'every 2: jest w miesiacu anchor');
  eq(C.occurrencesForMonth([ev2], '2027-02').length, 1, 'every 2: przez granice roku');
  eq(C.occurrencesForMonth([ev2], '2026-09').length, 0, 'przed anchor nie ma');

  const ev3 = sch('ev3', 'x', 1000, { type: 'monthly', day: 5, every: 3, anchor: '2026-11' });
  eq(C.occurrencesForMonth([ev3], '2027-02').length, 1, 'every 3: luty');
  eq(C.occurrencesForMonth([ev3], '2027-01').length, 0, 'every 3: styczen nie');
  const ev12 = sch('ev12', 'x', 1000, { type: 'monthly', day: 5, every: 12, anchor: '2025-12' });
  eq(C.occurrencesForMonth([ev12], '2026-12').length, 1, 'every 12: rok pozniej');
  eq(C.occurrencesForMonth([ev12], '2026-06').length, 0, 'every 12: pol roku nie');

  const unt = sch('unt', 'x', 1000, { type: 'monthly', day: 5, anchor: '2026-01', until: '2026-12' });
  eq(C.occurrencesForMonth([unt], '2026-12').length, 1, 'until: ostatni miesiac wlacznie');
  eq(C.occurrencesForMonth([unt], '2027-01').length, 0, 'until: po terminie nie ma');

  const off = sch('off', 'x', 1000, { type: 'monthly', day: 5, anchor: '2026-01' }, { active: false });
  eq(C.occurrencesForMonth([off], '2026-11').length, 0, 'nieaktywna pomijana');
});

group('occurrencesForMonth: once i sortowanie', () => {
  const once = sch('on', 'x', 30000, { type: 'once', date: '2026-11-22' }, { nextAfterDays: 48 });
  const o = C.occurrencesForMonth([once], '2026-11');
  eq(o.length, 1, 'once w swoim miesiacu');
  eq(o[0].occId, 'on@once', 'occId once');
  eq(o[0].date, '2026-11-22', 'data once');
  eq(o[0].nextAfterDays, 48, 'nextAfterDays przenoszone');
  eq(C.occurrencesForMonth([once], '2026-12').length, 0, 'once poza miesiacem');
  eq(C.occurrencesForMonth([once], '2026-10').length, 0, 'once przed miesiacem');

  const a = sch('a', 'x', 1, { type: 'monthly', day: 20, anchor: '2026-01' });
  const b = sch('b', 'x', 1, { type: 'once', date: '2026-11-05' });
  eq(C.occurrencesForMonth([a, b], '2026-11').map((x) => x.scheduleId), ['b', 'a'], 'sortowanie po dacie');
  eq(C.occurrencesForMonth(null, '2026-11'), [], 'null -> pusta lista');
});

group('koszyk planned: limit z wystapien', () => {
  const once = sch('on', 'p', 30000, { type: 'once', date: '2026-11-22' });
  const d = data({ baskets: [bk('p', 'planned', 99900)], schedules: [once] });
  const ms = C.monthState('2026-11', d, TODAY);
  const b = getB(ms, 'p');
  eq(b.limit, 30000, 'limit = suma wystapien (basket.limit ignorowany)');
  eq(b.planned, 30000, 'planned');
  eq(b.spent, 0, 'spent 0');
  eq(b.remaining, 30000, 'remaining');
  eq(b.pace, null, 'pace null poza daily');
  eq(b.status, 'ok', 'status ok gdy planned = limit');
  eq(b.occurrences[0].state, 'pending', 'pending przed data');
  eq(b.occurrences[0].entryId, null, 'entryId null bez potwierdzenia');
  eq(ms.totals.toPay, 30000, 'toPay');
  eq(ms.totals.due.length, 0, 'due puste');
  eq(getB(C.monthState('2026-12', d, TODAY), 'p').limit, 0, 'limit w grudniu 0');
  eq(getB(C.monthState('2026-12', d, TODAY), 'p').status, 'ok', 'status ok przy limicie 0 i braku wydatkow');

  // dzien platnosci = today -> due
  const ms2 = C.monthState('2026-11', d, '2026-11-22');
  eq(getB(ms2, 'p').occurrences[0].state, 'due', 'due w dniu platnosci');
  eq(ms2.totals.due.length, 1, 'totals.due ma 1');
  eq(ms2.totals.due[0].occId, 'on@once', 'totals.due occId');
  eq(ms2.totals.toPay, 30000, 'toPay obejmuje due');
  eq(C.monthState('2026-11', d, '2026-11-21').totals.due.length, 0, 'dzien wczesniej jeszcze pending');
});

group('potwierdzenie i pominiecie', () => {
  const once = sch('on', 'p', 30000, { type: 'once', date: '2026-11-22' });
  const base = data({ baskets: [bk('p', 'planned', 0)], schedules: [once] });
  const T = '2026-11-22';

  const conf = en('p', '2026-11-22', 30000, { occId: 'on@once', origin: 'schedule' });
  const ms = C.monthState('2026-11', { ...base, entries: [conf] }, T);
  const b = getB(ms, 'p');
  eq(b.occurrences[0].state, 'confirmed', 'stan confirmed');
  eq(b.occurrences[0].entryId, conf.id, 'entryId potwierdzenia');
  eq(b.planned, 0, 'planned spada po potwierdzeniu');
  eq(b.spent, 30000, 'spent rosnie');
  eq(b.limit, 30000, 'limit zostaje (potwierdzone liczy sie do limitu)');
  eq(b.remaining, 0, 'remaining 0');
  eq(b.status, 'ok', 'status ok po zaplaceniu dokladnie limitu');
  eq(ms.totals.toPay, 0, 'toPay 0');
  eq(ms.totals.due.length, 0, 'due puste po potwierdzeniu');

  const over = en('p', '2026-11-22', 31000, { occId: 'on@once', origin: 'schedule' });
  const overB = getB(C.monthState('2026-11', { ...base, entries: [over] }, T), 'p');
  eq(overB.limit, 31000, 'potwierdzone inna kwota -> limit = kwota zaplacona');
  eq(overB.status, 'ok', 'wyzsza kwota niz plan po potwierdzeniu -> ok, nie bad');

  const gone = en('p', '2026-11-22', 30000, { occId: 'on@once', deleted: true });
  const bGone = getB(C.monthState('2026-11', { ...base, entries: [gone] }, T), 'p');
  eq(bGone.occurrences[0].state, 'due', 'usuniete potwierdzenie -> znowu due');
  eq(bGone.planned, 30000, 'planned wraca po usunieciu');

  const skip = [{ occId: 'on@once', state: 'skipped', updatedAt: 'x' }];
  const msS = C.monthState('2026-11', { ...base, occStates: skip }, T);
  const bS = getB(msS, 'p');
  eq(bS.occurrences[0].state, 'skipped', 'stan skipped');
  eq(bS.limit, 0, 'skipped znika z limitu planned');
  eq(bS.planned, 0, 'skipped nie jest zaplanowane');
  eq(msS.totals.toPay, 0, 'skipped nie w toPay');
  eq(msS.totals.due.length, 0, 'skipped nie w due');
  eq(bS.status, 'ok', 'status ok po pominieciu');

  const msC = C.monthState('2026-11', { ...base, entries: [conf], occStates: skip }, T);
  eq(getB(msC, 'p').occurrences[0].state, 'confirmed', 'confirmed ma pierwszenstwo przed skipped');

  const early = en('p', '2026-11-07', 30000, { occId: 'on@once', origin: 'schedule' });
  const bE = getB(C.monthState('2026-11', { ...base, entries: [early] }, TODAY), 'p');
  eq(bE.occurrences[0].state, 'confirmed', 'wczesniejsze potwierdzenie pending -> confirmed');
  eq(bE.planned, 0, 'wczesniejsze potwierdzenie: planned 0');
});

group('koszyk fixed i statusy', () => {
  const rule = { type: 'monthly', day: 15, anchor: '2026-01' };
  const mk = (limit, spent) =>
    data({
      baskets: [bk('f', 'fixed', limit)],
      schedules: [sch('m', 'f', 20000, rule)],
      entries: spent ? [en('f', '2026-11-02', spent)] : [],
    });
  const st = (limit, spent) => getB(C.monthState('2026-11', mk(limit, spent), TODAY), 'f').status;
  eq(st(50000, 0), 'ok', 'fixed: limit > planned -> ok');
  eq(st(20000, 0), 'ok', 'fixed: planned = limit -> ok (granica)');
  eq(st(19999, 0), 'warn', 'fixed: planned = limit + 1 -> warn');
  eq(st(15000, 0), 'warn', 'fixed: planned > limit -> warn');
  eq(st(15000, 16000), 'bad', 'fixed: spent > limit -> bad (pierwszenstwo)');
  eq(st(30000, 10000), 'ok', 'fixed: spent + planned = limit -> ok');
  eq(st(30000, 10001), 'warn', 'fixed: spent + planned = limit + 1 -> warn');
  eq(st(30000, 30000), 'warn', 'fixed: spent = limit, planned > 0 -> warn (nie bad)');
  eq(st(30000, 30001), 'bad', 'fixed: spent = limit + 1 -> bad');
  const b = getB(C.monthState('2026-11', mk(30000, 10000), TODAY), 'f');
  eq(b.limit, 30000, 'fixed: limit = basket.limit');
  eq(b.planned, 20000, 'fixed: planned z harmonogramu');
  eq(b.remaining, 20000, 'fixed: remaining');
  eq(b.pace, null, 'fixed: brak pace');
  eq(b.occurrences[0].date, '2026-11-15', 'fixed: data wystapienia');

  const lim0 = data({ baskets: [bk('f', 'fixed', 0)] });
  eq(getB(C.monthState('2026-11', lim0, TODAY), 'f').status, 'ok', 'fixed: limit 0 i brak wydatkow -> ok');
  const lim0s = data({ baskets: [bk('f', 'fixed', 0)], entries: [en('f', '2026-11-02', 1)] });
  eq(getB(C.monthState('2026-11', lim0s, TODAY), 'f').status, 'bad', 'fixed: limit 0 i wydatek -> bad');
});

group('tempo i status daily', () => {
  const mk = (limit, spent, extra) =>
    data({ baskets: [bk('d', 'daily', limit)], entries: spent ? [en('d', '2026-11-02', spent)] : [], ...extra });
  const get = (limit, spent, ym, today) => getB(C.monthState(ym || '2026-11', mk(limit, spent), today || TODAY), 'd');
  eq(get(30000, 0).pace, 7000, 'limit 300,00, dzien 7/30 -> pace 70,00');
  eq(get(30000, 7000).status, 'ok', 'spent = pace -> ok');
  eq(get(30000, 7001).status, 'warn', 'spent = pace + 1 -> warn');
  eq(get(30000, 30000).status, 'warn', 'spent = limit -> warn (nie bad)');
  eq(get(30000, 30001).status, 'bad', 'spent = limit + 1 -> bad');
  eq(get(10000, 0).pace, 2333, 'zaokraglenie w dol (2333,33)');
  eq(get(10001, 0).pace, 2334, 'zaokraglenie w gore (2333,57)');
  eq(get(30000, 0, '2026-11', '2026-11-01').pace, 1000, 'pierwszy dzien miesiaca');
  eq(get(30000, 0, '2026-11', '2026-11-30').pace, 30000, 'ostatni dzien miesiaca');
  eq(get(0, 0).status, 'ok', 'limit 0 i wydane 0 -> ok');
  eq(get(0, 1).status, 'bad', 'limit 0 i wydane 1 -> bad');
  eq(get(10000, 0).remaining, 10000, 'remaining bez wydatkow');
  eq(get(10000, 20000).remaining, -10000, 'remaining ujemne');
});

group('dni, przeszly i przyszly miesiac', () => {
  const d = data({
    baskets: [bk('d', 'daily', 31000)],
    entries: [en('d', '2026-10-10', 5000), en('d', '2026-12-10', 2000)],
  });
  const past = C.monthState('2026-10', d, TODAY);
  eq(past.isPast, true, 'przeszly: isPast');
  eq(past.isCurrent, false, 'przeszly: isCurrent');
  eq(past.daysLeft, 0, 'przeszly: daysLeft 0');
  eq(past.dayOfMonth, 31, 'przeszly: dayOfMonth = dni miesiaca');
  eq(past.totals.perDay, null, 'przeszly: perDay null');
  eq(getB(past, 'd').pace, 31000, 'przeszly: pace = limit');
  eq(getB(past, 'd').spent, 5000, 'przeszly: spent tylko z pazdziernika');
  eq(getB(past, 'd').status, 'ok', 'przeszly: ok gdy w limicie');
  eq(C.monthState('2026-10', data({ baskets: [bk('d', 'daily', 1000)], entries: [en('d', '2026-10-10', 1500)] }), TODAY).baskets[0].status, 'bad', 'przeszly: bad gdy ponad limit');

  const fut = C.monthState('2026-12', d, TODAY);
  eq(fut.isPast, false, 'przyszly: isPast');
  eq(fut.isCurrent, false, 'przyszly: isCurrent');
  eq(fut.daysLeft, 31, 'przyszly: daysLeft = dni miesiaca');
  eq(fut.dayOfMonth, 0, 'przyszly: dayOfMonth 0');
  eq(getB(fut, 'd').pace, 0, 'przyszly: pace 0');
  eq(getB(fut, 'd').spent, 2000, 'przyszly: spent z grudnia');
  eq(getB(fut, 'd').status, 'warn', 'przyszly: wydane > pace 0 -> warn');
  eq(fut.totals.perDay, Math.floor(29000 / 31), 'przyszly: perDay');

  eq(C.monthState('2026-11', d, '2026-11-30').daysLeft, 1, 'ostatni dzien: daysLeft 1');
  eq(C.monthState('2026-11', d, '2026-11-01').daysLeft, 30, 'pierwszy dzien: daysLeft 30');
  eq(C.monthState('2028-02', d, '2028-02-29').daysLeft, 1, 'luty przestepny ostatni dzien');
  eq(C.monthState('2028-02', d, '2028-02-29').daysInMonth, 29, 'luty przestepny daysInMonth');
  eq(C.monthState('2027-01', d, '2026-12-31').daysLeft, 31, 'styczen jest przyszly z perspektywy 31 grudnia');
  eq(C.monthState('2026-12', d, '2026-12-31').isCurrent, true, 'grudzien 31: isCurrent');
});

group('perDay: floor i wartosci ujemne', () => {
  const d = data({ baskets: [bk('d', 'daily', 10000)], entries: [en('d', '2026-11-02', 20000)] });
  const ms = C.monthState('2026-11', d, TODAY);
  eq(ms.totals.daily.remaining, -10000, 'przekroczenie zmniejsza calosc');
  eq(ms.totals.perDay, -417, 'perDay ujemne = floor(-10000/24)');

  const two = data({ baskets: [bk('a', 'daily', 10000), bk('b', 'daily', 10000)], entries: [en('a', '2026-11-02', 15000)] });
  eq(C.monthState('2026-11', two, TODAY).totals.daily.remaining, 5000, 'przekroczenie w jednym koszyku zmniejsza do wydania');
});

group('weekend', () => {
  eq(C.weekendRange('2026-11-07'), { from: '2026-11-07', to: '2026-11-08' }, 'sobota');
  eq(C.weekendRange('2026-11-08'), { from: '2026-11-07', to: '2026-11-08' }, 'niedziela');
  eq(C.weekendRange('2026-11-09'), { from: '2026-11-14', to: '2026-11-15' }, 'poniedzialek -> nastepny weekend');
  eq(C.weekendRange('2026-11-04'), { from: '2026-11-07', to: '2026-11-08' }, 'sroda');
  eq(C.weekendRange('2026-11-06'), { from: '2026-11-07', to: '2026-11-08' }, 'piatek');
  eq(C.weekendRange('2026-10-30'), { from: '2026-10-31', to: '2026-11-01' }, 'weekend przez granice miesiaca');
  eq(C.weekendRange('2026-12-30'), { from: '2027-01-02', to: '2027-01-03' }, 'weekend przez granice roku');

  const d = data({
    baskets: [bk('m', 'daily', 20000, { weekendLimit: 6000 }), bk('n', 'daily', 5000)],
    entries: [
      en('m', '2026-11-07', 2000),
      en('m', '2026-11-08', 1500),
      en('m', '2026-11-08', 500, { isRefund: true }),
      en('m', '2026-11-08', 7777, { deleted: true }),
      en('m', '2026-11-06', 9999),
      en('m', '2026-11-14', 4444),
      en('n', '2026-11-07', 300),
    ],
  });
  const w = getB(C.monthState('2026-11', d, TODAY), 'm').weekend;
  eq(w, { from: '2026-11-07', to: '2026-11-08', spent: 3000, limit: 6000 }, 'weekend w sobote (z zwrotem, bez deleted)');
  eq(getB(C.monthState('2026-11', d, '2026-11-04'), 'm').weekend.from, '2026-11-07', 'weekend ze srody: from');
  eq(getB(C.monthState('2026-11', d, '2026-11-04'), 'm').weekend.to, '2026-11-08', 'weekend ze srody: to');
  eq(getB(C.monthState('2026-11', d, '2026-11-04'), 'm').weekend.spent, 3000, 'weekend ze srody: spent');
  eq(getB(C.monthState('2026-11', d, '2026-11-08'), 'm').weekend.spent, 3000, 'weekend w niedziele: ten sam');
  const wm = getB(C.monthState('2026-11', d, '2026-11-09'), 'm').weekend;
  eq(wm, { from: '2026-11-14', to: '2026-11-15', spent: 4444, limit: 6000 }, 'weekend w poniedzialek: nastepny');
  eq(getB(C.monthState('2026-11', d, TODAY), 'n').weekend, undefined, 'brak weekendu bez weekendLimit');
});

group('outside, wakacje, bySource', () => {
  const d = data({
    baskets: [bk('d', 'daily', 10000), bk('wyjazdy', 'outside', 777)],
    entries: [
      en('d', '2026-11-02', 1000, { source: 'konto' }),
      en('d', '2026-11-03', 2000, { source: 'kredyt' }),
      en('d', '2026-11-03', 300, { source: 'revolut' }),
      en('d', '2026-11-04', 400, { source: 'gotowka' }),
      en('d', '2026-11-05', 100, { source: 'kredyt', isRefund: true }),
      en('wyjazdy', '2026-11-01', 10000),
      en('wyjazdy', '2026-11-05', 20000, { source: 'revolut' }),
      en('wyjazdy', '2026-11-06', 5000, { isRefund: true }),
      en('wyjazdy', '2026-12-02', 1000),
      en('wyjazdy', '2026-11-08', 9999, { deleted: true }),
      en('d', '2026-10-30', 8888, { source: 'konto' }),
    ],
    settings: { wakacjeBalance: 500000, wakacjeAsOf: '2026-11-01' },
  });
  const ms = C.monthState('2026-11', d, TODAY);
  const o = getB(ms, 'wyjazdy');
  eq(o.limit, null, 'outside: limit null');
  eq(o.remaining, null, 'outside: remaining null');
  eq(o.pace, null, 'outside: pace null');
  eq(o.status, 'none', 'outside: status none');
  eq(o.spent, 10000 + 20000 - 5000, 'outside: spent liczone');
  eq(ms.totals.outsideSpent, 25000, 'outsideSpent');
  eq(ms.totals.limitAll, 10000, 'limitAll bez outside');
  eq(ms.totals.spentAll, 1000 + 2000 + 300 + 400 - 100, 'spentAll bez outside');
  eq(ms.totals.daily.spent, 3600, 'daily.spent');
  eq(ms.totals.bySource, { konto: 1000 + 10000 - 5000, kredyt: 1900, revolut: 300 + 20000, gotowka: 400 }, 'bySource (z outside, zwrotem, bez innych miesiecy)');
  // data == asOf nie odejmuje; pozniejsze (takze z grudnia) odejmuje; zwrot dodaje
  eq(ms.totals.wakacje, { balance: 500000 - 20000 + 5000 - 1000, asOf: '2026-11-01' }, 'wakacje: saldo po dacie asOf');
  eq(C.monthState('2026-10', d, TODAY).totals.wakacje.balance, 484000, 'wakacje niezalezne od ogladanego miesiaca');
  eq(C.monthState('2026-11', data({ baskets: d.baskets, settings: { wakacjeBalance: 7000 } }), TODAY).totals.wakacje, { balance: 7000, asOf: null }, 'wakacje bez daty: bez odejmowania');
  eq(C.monthState('2026-11', data({ baskets: d.baskets, entries: d.entries, settings: { wakacjeAsOf: '2026-11-01' } }), TODAY).totals.wakacje, null, 'wakacje null bez salda');
});

group('toPay i due: wiele koszykow', () => {
  const d = data({
    baskets: [bk('f', 'fixed', 50000), bk('p', 'planned', 0), bk('d', 'daily', 1000)],
    schedules: [
      sch('rent', 'f', 20000, { type: 'monthly', day: 15, anchor: '2026-01' }),
      sch('cat', 'p', 30000, { type: 'once', date: '2026-11-10' }),
      sch('dd', 'd', 999, { type: 'monthly', day: 12, anchor: '2026-01' }),
    ],
  });
  const ms = C.monthState('2026-11', d, '2026-11-15');
  eq(ms.totals.toPay, 50000, 'toPay = fixed + planned (bez daily)');
  eq(ms.totals.due.map((o) => o.scheduleId), ['cat', 'dd', 'rent'], 'due ze wszystkich koszykow, po dacie');
  eq(C.monthState('2026-11', d, '2026-11-14').totals.due.map((o) => o.scheduleId), ['cat', 'dd'], 'dzien przed: rent jeszcze pending');
  eq(getB(ms, 'd').planned, 999, 'daily ma planned, ale nie wchodzi do toPay');
  eq(ms.totals.limitAll, 50000 + 30000 + 1000, 'limitAll uwzglednia limit planned');
});

group('sortowanie i niezmiennosc', () => {
  const b1 = bk('x', 'daily', 100);
  const b2 = bk('y', 'daily', 100);
  b1.order = 9;
  b2.order = 2;
  const e1 = en('x', '2026-11-02', 100, { createdAt: '2026-11-02T08:00:00.000Z' });
  const e2 = en('x', '2026-11-02', 200, { createdAt: '2026-11-02T09:00:00.000Z' });
  const e3 = en('x', '2026-11-05', 300, { createdAt: '2026-11-05T07:00:00.000Z' });
  const d = data({ baskets: [b1, b2], entries: [e1, e2, e3] });
  const snap = JSON.stringify(d);
  const ms = C.monthState('2026-11', d, TODAY);
  eq(ms.baskets.map((b) => b.id), ['y', 'x'], 'koszyki po order');
  eq(getB(ms, 'x').entries.map((e) => e.id), [e3.id, e2.id, e1.id], 'wpisy: data malejaco, potem createdAt malejaco');
  eq(JSON.stringify(d), snap, 'dane wejsciowe niezmienione');
});

group('historyGroups', () => {
  const e1 = en('a', '2026-11-02', 1000, { createdAt: '2026-11-02T08:00:00.000Z' });
  const e2 = en('a', '2026-11-02', 300, { isRefund: true, createdAt: '2026-11-02T09:00:00.000Z' });
  const e3 = en('b', '2026-11-05', 700);
  const e4 = en('a', '2026-10-31', 999);
  const e5 = en('a', '2026-11-03', 5555, { deleted: true });
  const all = [e1, e2, e3, e4, e5];
  const g = C.historyGroups(all, '2026-11', null);
  eq(g.map((x) => x.date), ['2026-11-05', '2026-11-02'], 'dni malejaco, bez innych miesiecy i deleted');
  eq(g.map((x) => x.total), [700, 700], 'sumy dnia (ze zwrotem)');
  eq(g[1].entries.map((e) => e.id), [e2.id, e1.id], 'wpisy w dniu: createdAt malejaco');
  const ga = C.historyGroups(all, '2026-11', 'a');
  eq(ga.length, 1, 'filtr koszyka');
  eq(ga[0].total, 700, 'suma dnia dla koszyka');
  eq(C.historyGroups(all, '2026-12', null), [], 'pusty miesiac');
  eq(C.historyGroups([], '2026-11', null), [], 'brak wpisow');
  eq(C.historyGroups(all, '2026-10', null)[0].date, '2026-10-31', 'inny miesiac');
});

group('monthsWithData', () => {
  const es = [en('a', '2026-09-10', 1), en('a', '2026-11-02', 1), en('a', '2026-11-03', 1), en('a', '2026-10-05', 1, { deleted: true })];
  eq(C.monthsWithData(es, '2026-11-07'), ['2026-11', '2026-09'], 'malejaco, bez miesiecy tylko z deleted');
  eq(C.monthsWithData(es, '2027-01-05'), ['2027-01', '2026-11', '2026-09'], 'zawsze zawiera miesiac today');
  eq(C.monthsWithData([], '2026-11-07'), ['2026-11'], 'puste wpisy -> tylko biezacy');
  eq(C.monthsWithData(es, '2026-08-01'), ['2026-11', '2026-09', '2026-08'], 'today przed danymi');
  eq(C.monthsWithData(es, '2025-12-31'), ['2026-11', '2026-09', '2025-12'], 'sortowanie przez granice roku');
});

// ---------- podsumowanie ----------
const summary = document.getElementById('summary');
summary.textContent = passed + '/' + total + ' PASS';
summary.className = passed === total ? 'ok' : 'bad';
window.__testResult = { passed, total };
