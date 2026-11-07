// calc.js: czysta matematyka budzetu (kontrakt, sekcje 4-5). Bez DOM, IndexedDB i new Date().
// Kwoty: grosze (int). Daty: 'YYYY-MM-DD'. `today` przychodzi z zewnatrz.
import { monthOf, daysInMonth, addDays, dayOfWeek } from './format.js';

const pad2 = (n) => (n < 10 ? '0' + n : String(n));

export function signed(entry) {
  return entry.isRefund ? -entry.amount : entry.amount;
}

function monthsDiff(a, b) { // liczba miesiecy od a do b ('YYYY-MM')
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

export function occurrencesForMonth(schedules, ym) {
  const out = [];
  for (const s of schedules || []) {
    if (!s || !s.active || !s.rule) continue;
    const r = s.rule;
    let date = null;
    let occId = null;
    if (r.type === 'monthly') {
      if (!r.anchor || r.anchor > ym) continue;
      if (r.until && ym > r.until) continue;
      const every = r.every >= 1 ? Math.floor(r.every) : 1;
      if (monthsDiff(r.anchor, ym) % every !== 0) continue;
      const day = Math.min(Math.max(Math.floor(r.day) || 1, 1), daysInMonth(ym));
      date = ym + '-' + pad2(day);
      occId = s.id + '@' + ym;
    } else if (r.type === 'once') {
      if (!r.date || monthOf(r.date) !== ym) continue;
      date = r.date;
      occId = s.id + '@once';
    } else {
      continue;
    }
    out.push({
      occId,
      scheduleId: s.id,
      basket: s.basket,
      name: s.name,
      amount: s.amount,
      source: s.source,
      date,
      nextAfterDays: s.nextAfterDays ?? null,
    });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.occId < b.occId ? -1 : a.occId > b.occId ? 1 : 0));
  return out;
}

// weekend = sobota + niedziela tygodnia, w ktorym jest today (pon-pt: nadchodzacy; sob/nd: biezacy)
export function weekendRange(today) {
  const dow = dayOfWeek(today);
  let from;
  if (dow === 6) from = today;
  else if (dow === 0) from = addDays(today, -1);
  else from = addDays(today, 6 - dow);
  return { from, to: addDays(from, 1) };
}

function cmpEntriesDesc(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.createdAt || '';
  const cb = b.createdAt || '';
  if (ca !== cb) return ca < cb ? 1 : -1;
  return 0;
}

// koszyki widoczne w miesiacu ym (kontrakt 11.2): bez deleted; 'extra' tylko w zakresie from..until
export function basketsForMonth(baskets, ym) {
  return (baskets || []).filter((b) => {
    if (!b || b.deleted) return false;
    if (b.kind === 'extra') return !!b.from && !!b.until && b.from <= ym && ym <= b.until;
    return true;
  });
}

function basketStatus(kind, spent, limit, pace, planned) {
  if (kind === 'outside') return 'none';
  if (kind === 'extra') {
    if (spent > limit) return 'bad';
    if (limit > 0 && spent >= 0.8 * limit) return 'warn';
    return 'ok';
  }
  if (kind === 'daily') {
    if (spent > limit) return 'bad';
    if (spent > pace) return 'warn';
    return 'ok';
  }
  if (spent > limit) return 'bad';
  if (spent + planned > limit) return 'warn';
  return 'ok';
}

export function monthState(ym, data, today) {
  const basketsIn = data.baskets || [];
  const entries = (data.entries || []).filter((e) => !e.deleted);
  const schedules = data.schedules || [];
  const occStates = data.occStates || [];
  const settings = data.settings || {};

  const todayYm = monthOf(today);
  const isCurrent = ym === todayYm;
  const isPast = ym < todayYm;
  const dim = daysInMonth(ym);
  const dayOfMonth = isCurrent ? Number(today.slice(8, 10)) : isPast ? dim : 0;
  const daysLeft = isCurrent ? dim - dayOfMonth + 1 : isPast ? 0 : dim;

  const entryByOcc = new Map();
  for (const e of entries) {
    if (e.occId && !entryByOcc.has(e.occId)) entryByOcc.set(e.occId, e);
  }
  const skipped = new Set();
  for (const s of occStates) if (s && s.state === 'skipped') skipped.add(s.occId);

  const occs = occurrencesForMonth(schedules, ym).map((o) => {
    const ent = entryByOcc.get(o.occId);
    const state = ent ? 'confirmed' : skipped.has(o.occId) ? 'skipped' : o.date <= today ? 'due' : 'pending';
    return { ...o, state, entryId: ent ? ent.id : null, paidAmount: ent ? signed(ent) : null };
  });

  const monthEntries = entries.filter((e) => monthOf(e.date) === ym);
  const weekend = weekendRange(today);

  // extra / deleted: tylko gdy widoczny w miesiacu albo ma w nim wpisy (wydatki nie znikaja z sum)
  const visibleIds = new Set(basketsForMonth(basketsIn, ym).map((b) => b.id));
  const entryBasketIds = new Set(monthEntries.map((e) => e.basket));
  const baskets = basketsIn
    .filter((b) => (b.kind !== 'extra' && !b.deleted) || visibleIds.has(b.id) || entryBasketIds.has(b.id))
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((b) => {
      const bEntries = monthEntries.filter((e) => e.basket === b.id).sort(cmpEntriesDesc);
      const spent = bEntries.reduce((s, e) => s + signed(e), 0);
      const bOccs = occs.filter((o) => o.basket === b.id);
      const planned = bOccs.reduce((s, o) => (o.state === 'due' || o.state === 'pending' ? s + o.amount : s), 0);

      let limit;
      if (b.kind === 'outside') limit = null;
      // potwierdzone wystąpienie liczy się kwotą faktycznie zapłaconą (catering droższy o 3 zł nie robi czerwonego koszyka)
      else if (b.kind === 'planned') limit = bOccs.reduce((s, o) => (o.state === 'skipped' ? s : s + (o.state === 'confirmed' ? o.paidAmount : o.amount)), 0);
      // extra poza swoim zakresem (albo usunięty) ma limit 0: wydatki się liczą, kwota z budżetu już nie
      else if (b.kind === 'extra' && !visibleIds.has(b.id)) limit = 0;
      else limit = b.limit || 0;

      const remaining = limit === null ? null : limit - spent;
      const pace = b.kind === 'daily' ? Math.round((limit * dayOfMonth) / dim) : null;
      const status = basketStatus(b.kind, spent, limit, pace, planned);

      const out = {
        id: b.id,
        name: b.name,
        kind: b.kind,
        order: b.order,
        hint: b.hint,
        limit,
        spent,
        planned,
        remaining,
        pace,
        status,
        entries: bEntries,
        occurrences: bOccs,
      };
      if (typeof b.weekendLimit === 'number' && b.weekendLimit > 0) {
        const wSpent = entries
          .filter((e) => e.basket === b.id && (e.date === weekend.from || e.date === weekend.to))
          .reduce((s, e) => s + signed(e), 0);
        out.weekend = { from: weekend.from, to: weekend.to, spent: wSpent, limit: b.weekendLimit };
      }
      return out;
    });

  // sumy
  let limitAll = 0;
  let spentAll = 0;
  let outsideSpent = 0;
  const daily = { limit: 0, spent: 0, remaining: 0 };
  const extra = { limit: 0, spent: 0 };
  let toPay = 0;
  for (const b of baskets) {
    if (b.kind === 'outside') {
      outsideSpent += b.spent;
      continue;
    }
    limitAll += b.limit;
    spentAll += b.spent;
    if (b.kind === 'extra') {
      extra.limit += b.limit;
      extra.spent += b.spent;
    }
    if (b.kind === 'daily' || b.kind === 'extra') {
      daily.limit += b.limit;
      daily.spent += b.spent;
    } else {
      toPay += b.planned;
    }
  }
  daily.remaining = daily.limit - daily.spent;
  const perDay = daysLeft === 0 ? null : Math.floor(daily.remaining / daysLeft);

  const due = [];
  for (const b of baskets) for (const o of b.occurrences) if (o.state === 'due') due.push(o);
  due.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.occId < b.occId ? -1 : a.occId > b.occId ? 1 : 0));

  const bySource = { konto: 0, kredyt: 0, revolut: 0, gotowka: 0 };
  for (const e of monthEntries) bySource[e.source] = (bySource[e.source] || 0) + signed(e);

  let wakacje = null;
  if (typeof settings.wakacjeBalance === 'number') {
    const asOf = settings.wakacjeAsOf || null;
    let after = 0;
    if (asOf) {
      for (const e of entries) if (e.basket === 'wyjazdy' && e.date > asOf) after += signed(e);
    }
    wakacje = { balance: settings.wakacjeBalance - after, asOf };
  }

  return {
    ym,
    today,
    dayOfMonth,
    daysInMonth: dim,
    daysLeft,
    isCurrent,
    isPast,
    baskets,
    totals: { limitAll, spentAll, daily, perDay, toPay, due, bySource, outsideSpent, wakacje, extra },
  };
}

export function historyGroups(entries, ym, basketId) {
  const list = (entries || [])
    .filter((e) => !e.deleted && monthOf(e.date) === ym && (basketId == null || e.basket === basketId))
    .sort(cmpEntriesDesc);
  const groups = [];
  for (const e of list) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== e.date) {
      g = { date: e.date, total: 0, entries: [] };
      groups.push(g);
    }
    g.total += signed(e);
    g.entries.push(e);
  }
  return groups;
}

export function monthsWithData(entries, today) {
  const set = new Set([monthOf(today)]);
  for (const e of entries || []) if (!e.deleted) set.add(monthOf(e.date));
  return Array.from(set).sort().reverse();
}
