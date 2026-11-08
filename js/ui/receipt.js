// Paragon / zrzut ekranu -> propozycja wpisu (OpenAI, klucz tylko na tym urządzeniu).
// Klucz i model leżą w localStorage, NIE w IndexedDB, więc nigdy nie trafiają do kopii ani CSV.

import { basketsForMonth } from '../calc.js';
import { monthOf } from '../format.js';
import { recordUsage } from '../usage.js';

const LS_KEY = 'koszyki.ai';
const API = 'https://api.openai.com/v1';
// kolejność preferencji: tani model z obsługą zdjęć i structured outputs
export const PREFERRED = ['gpt-4.1-mini', 'gpt-4o-mini', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];
const MAX_SIDE = 1600;

export function getAi() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return { key: typeof v.key === 'string' ? v.key : '', model: typeof v.model === 'string' ? v.model : '' };
  } catch (err) {
    return { key: '', model: '' };
  }
}

export function setAi(patch) {
  const v = Object.assign(getAi(), patch);
  try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch (err) { /* prywatny tryb */ }
  return v;
}

export function clearAi() {
  try { localStorage.removeItem(LS_KEY); } catch (err) { /* ignoruj */ }
}

export function maskKey(k) {
  return k ? '…' + k.slice(-4) : '';
}

class AiError extends Error {
  constructor(msg, code) { super(msg); this.code = code; }
}

async function apiFetch(path, key, body) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: Object.assign({ Authorization: 'Bearer ' + key }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new AiError('Brak połączenia z OpenAI. Sprawdź internet.', 'net');
  }
  let data = null;
  try { data = await res.json(); } catch (err) { /* puste */ }
  if (!res.ok) {
    const e = (data && data.error) || {};
    if (res.status === 401) throw new AiError('Klucz OpenAI nie działa (401). Wklej go jeszcze raz w Ustawieniach.', 'auth');
    if (res.status === 429) {
      throw new AiError(e.code === 'insufficient_quota' ? 'Skończyły się środki na koncie OpenAI.' : 'OpenAI: za dużo zapytań, spróbuj za chwilę.', 'quota');
    }
    if (e.code === 'model_not_found' || res.status === 404) throw new AiError('Model niedostępny.', 'model');
    throw new AiError('OpenAI: ' + (e.message || 'błąd ' + res.status), 'api');
  }
  return data;
}

// Sprawdza klucz i wybiera model: wskazany (wanted), jeśli jest dostępny, inaczej pierwszy z listy preferencji.
export async function checkKey(key, wanted) {
  const data = await apiFetch('/models', key);
  const ids = new Set(((data && data.data) || []).map((m) => m.id));
  const model = (wanted && PREFERRED.indexOf(wanted) >= 0 && ids.has(wanted)) ? wanted : PREFERRED.find((m) => ids.has(m));
  if (!model) throw new AiError('Klucz działa, ale nie widzę żadnego modelu ze zdjęciami (' + PREFERRED.join(', ') + ').', 'model');
  return model;
}

// Zmniejsza zdjęcie do JPEG (dłuższy bok MAX_SIDE), zwraca data URL.
export async function imageToDataUrl(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new AiError('Nie umiem otworzyć tego pliku jako zdjęcia.', 'img'));
      i.src = url;
    });
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const s = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * s));
    c.height = Math.max(1, Math.round(h * s));
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function schema(basketIds) {
  return {
    name: 'wydatek',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['amount', 'date', 'merchant', 'basket', 'is_refund', 'confidence'],
      properties: {
        amount: { type: ['number', 'null'], description: 'Kwota faktycznie zapłacona w PLN (suma do zapłaty po rabatach), np. 24.99' },
        date: { type: ['string', 'null'], description: 'Data zakupu YYYY-MM-DD albo null' },
        merchant: { type: ['string', 'null'], description: 'Krótka nazwa sklepu / usługi, np. Biedronka, Allegro, Orlen' },
        basket: { type: 'string', enum: basketIds.concat(['']), description: 'id koszyka albo pusty, gdy nie wiadomo' },
        is_refund: { type: 'boolean', description: 'true tylko gdy to zwrot pieniędzy' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
    },
  };
}

function prompt(baskets, today) {
  const list = baskets.map((b) => '- ' + b.id + ': ' + b.name + (b.hint ? ' (' + b.hint + ')' : '')).join('\n');
  return 'Na zdjęciu jest polski paragon albo zrzut ekranu z zakupu/płatności (sklep internetowy, PayPro, PayPo, BLIK, aplikacja banku). ' +
    'Odczytaj jeden wydatek: kwotę faktycznie zapłaconą (SUMA / DO ZAPŁATY / Razem, po rabatach; nie PTU, nie reszta, nie gotówka wydana), ' +
    'datę zakupu i krótką nazwę sklepu. Dzisiaj jest ' + today + '. Jeśli roku nie widać, przyjmij taki, żeby data nie była w przyszłości. ' +
    'Dobierz koszyk z listy:\n' + list + '\nGdy czegoś nie da się odczytać, daj null (koszyk: pusty napis). Nie zgaduj kwoty.';
}

// Zwraca { grosze, date, merchant, basket, refund, confidence }.
export async function readReceipt(file, ctx) {
  let ai = getAi();
  if (!ai.key) throw new AiError('Najpierw wklej klucz OpenAI w Ustawieniach (sekcja Paragony).', 'nokey');
  const baskets = basketsForMonth(ctx.data.baskets.slice().sort((a, b) => a.order - b.order), monthOf(ctx.today));
  const dataUrl = await imageToDataUrl(file);
  const body = (model) => ({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt(baskets, ctx.today) },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ],
    }],
    response_format: { type: 'json_schema', json_schema: schema(baskets.map((b) => b.id)) },
  });
  let data;
  try {
    data = await apiFetch('/chat/completions', ai.key, body(ai.model || PREFERRED[0]));
  } catch (err) {
    if (err.code !== 'model') throw err;
    // zapisany model zniknął: wybierz dostępny i spróbuj raz jeszcze
    ai = setAi({ model: await checkKey(ai.key) });
    data = await apiFetch('/chat/completions', ai.key, body(ai.model));
  }
  // zużycie liczymy zanim sprawdzimy treść: nieudany odczyt też kosztuje tokeny
  recordUsage(data, ctx.today, ai.model || PREFERRED[0]);
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  if (!msg || msg.refusal || !msg.content) throw new AiError('Nie udało się odczytać zdjęcia.', 'parse');
  let r;
  try { r = JSON.parse(msg.content); } catch (err) { throw new AiError('Nie udało się odczytać zdjęcia.', 'parse'); }
  return normalize(r, ctx);
}

export function normalize(r, ctx) {
  const out = { grosze: null, date: null, merchant: '', basket: null, refund: false, confidence: 'low' };
  if (typeof r.amount === 'number' && isFinite(r.amount) && Math.abs(r.amount) > 0 && Math.abs(r.amount) < 1e6) {
    out.grosze = Math.round(Math.abs(r.amount) * 100);
  }
  if (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date <= ctx.today) {
    const d = new Date(r.date + 'T12:00:00Z');
    const t = new Date(ctx.today + 'T12:00:00Z');
    if (!isNaN(d) && (t - d) / 864e5 <= 366) out.date = r.date;
  }
  if (typeof r.merchant === 'string') out.merchant = r.merchant.trim().slice(0, 120);
  if (typeof r.basket === 'string' && basketsForMonth(ctx.data.baskets, monthOf(out.date || ctx.today)).some((b) => b.id === r.basket)) out.basket = r.basket;
  out.refund = r.is_refund === true;
  if (['high', 'medium', 'low'].indexOf(r.confidence) >= 0) out.confidence = r.confidence;
  return out;
}
