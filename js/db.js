// db.js: IndexedDB (baza "koszyki" v1), kopia zapasowa, import, eksport CSV, udostępnianie plików.
// Kwoty w groszach (int), daty 'YYYY-MM-DD', znaczniki czasu ISO. Szczegóły: CONTRACT.md.

const DB_NAME = 'koszyki';
const DB_VERSION = 1;
const STORE_NAMES = ['baskets', 'entries', 'schedules', 'occStates', 'settings'];

const SOURCES = ['konto', 'kredyt', 'revolut', 'gotowka'];
const SOURCE_LABELS = {
  konto: 'Konto / BLIK',
  kredyt: 'Karta kredytowa',
  revolut: 'Revolut',
  gotowka: 'Gotówka',
};
const ORIGINS = ['manual', 'schedule', 'import'];
const ORIGIN_LABELS = {
  manual: 'ręcznie',
  schedule: 'płatność planowana',
  import: 'import',
};

const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

const DEFAULT_BASKETS = [
  { id: 'stale', name: 'Stałe', kind: 'fixed', order: 1 },
  { id: 'catering', name: 'Catering', kind: 'planned', order: 2 },
  { id: 'spozywcze', name: 'Spożywcze', kind: 'daily', order: 3 },
  { id: 'miasto', name: 'Jedzenie na mieście', kind: 'daily', order: 4 },
  { id: 'ciuchy', name: 'Ciuchy / zakupy / dom', kind: 'daily', order: 5 },
  { id: 'sport', name: 'Wspinanie / sport', kind: 'daily', order: 6 },
  { id: 'transport', name: 'Transport', kind: 'daily', order: 7 },
  { id: 'reszta', name: 'Reszta', kind: 'daily', order: 8 },
  { id: 'wyjazdy', name: 'Wyjazdy (z celu Wakacje)', kind: 'outside', order: 9 },
].map((b) => ({ ...b, limit: 0, updatedAt: EPOCH_ISO }));

// ---------------------------------------------------------------------------
// Pomocniki IndexedDB
// ---------------------------------------------------------------------------

/** Zamienia żądanie IDB na obietnicę. */
function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Błąd operacji na bazie danych.'));
  });
}

/** Obietnica zakończenia transakcji (complete → resolve, error/abort → reject). */
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Błąd transakcji bazy danych.'));
    tx.onabort = () => reject(tx.error || new Error('Transakcja bazy danych została przerwana.'));
  });
}

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Ta przeglądarka nie obsługuje lokalnej bazy danych (IndexedDB).'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const tx = request.transaction;
      if (!db.objectStoreNames.contains('baskets')) {
        const baskets = db.createObjectStore('baskets', { keyPath: 'id' });
        for (const b of DEFAULT_BASKETS) baskets.put(b);
      }
      if (!db.objectStoreNames.contains('entries')) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('date', 'date', { unique: false });
      } else {
        const entries = tx.objectStore('entries');
        if (!entries.indexNames.contains('date')) entries.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains('schedules')) {
        db.createObjectStore('schedules', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('occStates')) {
        db.createObjectStore('occStates', { keyPath: 'occId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Inna karta podniosła wersję bazy albo przeglądarka zamyka połączenie: zwolnij cache.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('Nie udało się otworzyć bazy danych.'));
    request.onblocked = () => reject(new Error('Baza danych jest zablokowana przez inną kartę aplikacji. Zamknij ją i spróbuj ponownie.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Pomocniki ogólne
// ---------------------------------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Lokalna data telefonu jako 'YYYY-MM-DD'. */
function localYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isValidYmd(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function timeOf(iso) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
}

// ---------------------------------------------------------------------------
// Odczyt
// ---------------------------------------------------------------------------

async function readEverything() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAMES, 'readonly');
  const done = txDone(tx);
  const [baskets, entries, schedules, occStates, settingRows] = await Promise.all(
    STORE_NAMES.map((name) => req(tx.objectStore(name).getAll()))
  );
  await done;
  return { baskets, entries, schedules, occStates, settingRows };
}

function settingsToObject(rows) {
  const out = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export async function loadAll() {
  const { baskets, entries, schedules, occStates, settingRows } = await readEverything();
  baskets.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return {
    baskets,
    entries: entries.filter((e) => !e.deleted),
    schedules,
    occStates,
    settings: settingsToObject(settingRows),
  };
}

// ---------------------------------------------------------------------------
// Zapis wpisów
// ---------------------------------------------------------------------------

function validateEntryShape(e) {
  if (!Number.isInteger(e.amount) || e.amount <= 0) {
    throw new Error('Kwota musi być większa od zera.');
  }
  if (typeof e.basket !== 'string' || !e.basket) {
    throw new Error('Wybierz koszyk.');
  }
  if (!SOURCES.includes(e.source)) {
    throw new Error('Wybierz źródło płatności.');
  }
  if (!isValidYmd(e.date)) {
    throw new Error('Data jest niepoprawna.');
  }
  if (!ORIGINS.includes(e.origin)) {
    throw new Error('Nieznane pochodzenie wpisu.');
  }
}

export async function saveEntry(partial) {
  if (!isPlainObject(partial)) throw new Error('Brak danych wpisu.');
  const db = await openDb();
  const tx = db.transaction(['entries', 'baskets'], 'readwrite');
  const done = txDone(tx);
  done.catch(() => {}); // błąd i tak wyjdzie z await poniżej albo z throw
  const entries = tx.objectStore('entries');
  const baskets = tx.objectStore('baskets');

  const existing = partial.id ? await req(entries.get(partial.id)) : undefined;
  const now = nowIso();

  const merged = {
    isRefund: false,
    note: '',
    origin: 'manual',
    deleted: false,
    ...(existing || {}),
    ...partial,
  };
  merged.id = existing ? existing.id : (partial.id || crypto.randomUUID());
  merged.createdAt = existing ? existing.createdAt : (partial.createdAt || now);
  merged.updatedAt = now;
  merged.isRefund = Boolean(merged.isRefund);
  merged.deleted = Boolean(merged.deleted);
  merged.note = typeof merged.note === 'string' ? merged.note.trim() : '';
  if (merged.occId === undefined || merged.occId === null || merged.occId === '') delete merged.occId;

  validateEntryShape(merged);

  const basket = await req(baskets.get(merged.basket));
  if (!basket) throw new Error('Taki koszyk nie istnieje.');

  entries.put(merged);
  await done;
  return merged;
}

async function setDeleted(id, deleted) {
  const db = await openDb();
  const tx = db.transaction('entries', 'readwrite');
  const done = txDone(tx);
  done.catch(() => {});
  const store = tx.objectStore('entries');
  const existing = await req(store.get(id));
  if (!existing) throw new Error('Nie znaleziono wpisu.');
  const updated = { ...existing, deleted, updatedAt: nowIso() };
  store.put(updated);
  await done;
  return updated;
}

export async function deleteEntry(id) {
  return setDeleted(id, true);
}

export async function restoreEntry(id) {
  return setDeleted(id, false);
}

// ---------------------------------------------------------------------------
// Koszyki, płatności planowane, stany wystąpień, ustawienia
// ---------------------------------------------------------------------------

export async function saveBasket(b) {
  if (!isPlainObject(b) || typeof b.id !== 'string' || !b.id) {
    throw new Error('Koszyk musi mieć identyfikator.');
  }
  if (b.limit !== undefined && (!Number.isInteger(b.limit) || b.limit < 0)) {
    throw new Error('Limit koszyka musi być liczbą całkowitą (w groszach), nie mniejszą od zera.');
  }
  if (b.weekendLimit !== undefined && b.weekendLimit !== null
      && (!Number.isInteger(b.weekendLimit) || b.weekendLimit < 0)) {
    throw new Error('Limit weekendu musi być liczbą całkowitą (w groszach), nie mniejszą od zera.');
  }
  const db = await openDb();
  const tx = db.transaction('baskets', 'readwrite');
  const done = txDone(tx);
  done.catch(() => {});
  const store = tx.objectStore('baskets');
  const existing = await req(store.get(b.id));
  const record = { ...(existing || {}), ...b, updatedAt: nowIso() };
  if (record.weekendLimit === undefined || record.weekendLimit === null) delete record.weekendLimit;
  store.put(record);
  await done;
  return record;
}

export async function saveSchedule(s) {
  if (!isPlainObject(s)) throw new Error('Brak danych płatności planowanej.');
  const record = { ...s, updatedAt: nowIso() };
  if (!record.id) record.id = crypto.randomUUID();
  if (!Number.isInteger(record.amount) || record.amount <= 0) {
    throw new Error('Kwota płatności musi być większa od zera.');
  }
  if (!isPlainObject(record.rule)) throw new Error('Brak reguły płatności planowanej.');
  if (record.active === undefined) record.active = true;
  const db = await openDb();
  const tx = db.transaction('schedules', 'readwrite');
  const done = txDone(tx);
  tx.objectStore('schedules').put(record);
  await done;
  return record;
}

export async function setOccState(occId, state) {
  if (typeof occId !== 'string' || !occId) throw new Error('Brak identyfikatora wystąpienia płatności.');
  const db = await openDb();
  const tx = db.transaction('occStates', 'readwrite');
  const done = txDone(tx);
  const store = tx.objectStore('occStates');
  if (state === null || state === undefined) {
    store.delete(occId);
  } else {
    if (state !== 'skipped') throw new Error('Nieznany stan wystąpienia płatności.');
    store.put({ occId, state, updatedAt: nowIso() });
  }
  await done;
}

export async function setSetting(key, value) {
  if (typeof key !== 'string' || !key) throw new Error('Brak klucza ustawienia.');
  const db = await openDb();
  const tx = db.transaction('settings', 'readwrite');
  const done = txDone(tx);
  tx.objectStore('settings').put({ key, value });
  await done;
}

// ---------------------------------------------------------------------------
// Kopia zapasowa
// ---------------------------------------------------------------------------

export async function exportBackup() {
  const { baskets, entries, schedules, occStates, settingRows } = await readEverything();
  baskets.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const payload = {
    app: 'koszyki',
    schema: 1,
    exportedAt: nowIso(),
    baskets,
    schedules,
    occStates,
    entries, // łącznie z deleted
    settings: settingsToObject(settingRows),
  };
  return {
    filename: `koszyki-kopia-${localYmd()}.json`,
    text: JSON.stringify(payload, null, 2),
  };
}

function requireArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`Kopia jest uszkodzona: pole „${label}” powinno być listą.`);
  return value;
}

function requireRecords(list, label, keyName) {
  for (const r of list) {
    if (!isPlainObject(r) || typeof r[keyName] !== 'string' || !r[keyName]) {
      throw new Error(`Kopia jest uszkodzona: rekord w „${label}” nie ma pola „${keyName}”.`);
    }
  }
}

export async function importBackup(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    throw new Error('To nie wygląda na plik kopii: nie da się odczytać JSON.');
  }
  if (!isPlainObject(data) || data.app !== 'koszyki') {
    throw new Error('To nie jest kopia aplikacji Koszyki.');
  }
  if (data.schema !== 1) {
    throw new Error('Ta kopia ma nieobsługiwaną wersję formatu.');
  }

  const incoming = {
    baskets: requireArray(data.baskets, 'baskets'),
    entries: requireArray(data.entries, 'entries'),
    schedules: requireArray(data.schedules, 'schedules'),
    occStates: requireArray(data.occStates, 'occStates'),
  };
  requireRecords(incoming.baskets, 'baskets', 'id');
  requireRecords(incoming.entries, 'entries', 'id');
  requireRecords(incoming.schedules, 'schedules', 'id');
  requireRecords(incoming.occStates, 'occStates', 'occId');
  let incomingSettings = {};
  if (data.settings !== undefined && data.settings !== null) {
    if (!isPlainObject(data.settings)) throw new Error('Kopia jest uszkodzona: pole „settings” ma zły format.');
    incomingSettings = data.settings;
  }

  const keyNames = { baskets: 'id', entries: 'id', schedules: 'id', occStates: 'occId' };
  const counts = { added: 0, updated: 0, unchanged: 0 };

  const db = await openDb();
  const tx = db.transaction(STORE_NAMES, 'readwrite');
  const done = txDone(tx);
  done.catch(() => {});

  try {
    for (const name of ['baskets', 'entries', 'schedules', 'occStates']) {
      const store = tx.objectStore(name);
      const list = incoming[name];
      const keyName = keyNames[name];
      // Wszystkie get-y naraz; put-y dopiero po ich zakończeniu, nadal w tej samej transakcji.
      const existing = await Promise.all(list.map((r) => req(store.get(r[keyName]))));
      list.forEach((rec, i) => {
        const cur = existing[i];
        if (!cur) {
          store.put(rec);
          counts.added += 1;
        } else if (timeOf(rec.updatedAt) > timeOf(cur.updatedAt)) {
          store.put(rec);
          counts.updated += 1;
        } else {
          counts.unchanged += 1;
        }
      });
    }
    const settingsStore = tx.objectStore('settings');
    for (const [key, value] of Object.entries(incomingSettings)) {
      if (key === 'lastBackupAt') continue;
      settingsStore.put({ key, value });
    }
  } catch (err) {
    try { tx.abort(); } catch { /* transakcja mogła już się zakończyć */ }
    throw err;
  }

  await done;
  return counts;
}

// ---------------------------------------------------------------------------
// Eksport CSV
// ---------------------------------------------------------------------------

function csvField(value) {
  const s = String(value ?? '');
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvAmount(grosze, isRefund) {
  const abs = Math.abs(grosze);
  const body = `${Math.floor(abs / 100)},${pad2(abs % 100)}`;
  return isRefund ? `-${body}` : body;
}

export async function exportCsv() {
  const { baskets, entries } = await readEverything();
  const names = new Map(baskets.map((b) => [b.id, b.name]));
  const rows = entries
    .filter((e) => !e.deleted)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const ca = a.createdAt || '';
      const cb = b.createdAt || '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return 0;
    });

  const lines = [['data', 'miesiac', 'koszyk', 'kwota', 'zwrot', 'zrodlo', 'opis', 'pochodzenie'].join(';')];
  for (const e of rows) {
    lines.push([
      e.date,
      String(e.date).slice(0, 7),
      csvField(names.get(e.basket) ?? e.basket),
      csvAmount(e.amount, e.isRefund),
      e.isRefund ? 'tak' : 'nie',
      csvField(SOURCE_LABELS[e.source] ?? e.source),
      csvField(e.note),
      csvField(ORIGIN_LABELS[e.origin] ?? e.origin),
    ].join(';'));
  }
  return {
    filename: `koszyki-${localYmd()}.csv`,
    text: '﻿' + lines.join('\r\n') + '\r\n',
  };
}

// ---------------------------------------------------------------------------
// Udostępnianie plików
// ---------------------------------------------------------------------------

function downloadViaLink(filename, mime, text) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function shareFile(filename, mime, text) {
  const file = new File([text], filename, { type: mime });
  let canShare = false;
  try {
    canShare = Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    canShare = false;
  }
  if (canShare) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // inny błąd udostępniania (np. NotAllowedError): zapisz jako plik
    }
  }
  downloadViaLink(filename, mime, text);
  return 'downloaded';
}

// ---------------------------------------------------------------------------
// Trwałe przechowywanie
// ---------------------------------------------------------------------------

export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return false;
    return Boolean(await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function isPersisted() {
  try {
    if (!navigator.storage?.persisted) return false;
    return Boolean(await navigator.storage.persisted());
  } catch {
    return false;
  }
}
