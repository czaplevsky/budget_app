// POST /ingest/receipt — sekcja 3.5 specu. Jeden endpoint dla trzech rzeczy:
//  1) zdjęcie paragonu (gotówka, sklep stacjonarny),
//  2) zrzut ekranu zakupu/płatności z operatorów typu PayPro, PayU, Przelewy24,
//     tpay, PayPo, Autopay oraz ze sklepów internetowych,
//  3) wklejony tekst maila z potwierdzeniem zamówienia (pole `text`).
//
// Najważniejsza logika: w banku taki zakup widać jako "PAYPRO S.A." i kwotę,
// bez sklepu. Dokument dostarcza sklep, więc:
//  - jeśli wpis z banku/Apple Pay już jest (kwota co do grosza, okno 5 dni),
//    WZBOGACAMY go (sklep, kategoria, pozycje), nie tworzymy drugiego wydatku;
//  - jeśli jeszcze go nie ma (BLIK i pay-by-link nie wchodzą przez Apple Pay),
//    tworzymy wpis ze źródłem 'receipt'; późniejszy import CSV scali się z nim
//    (fn_find_dedup_candidate traktuje operatora płatności jak wildcard);
//  - to samo zamówienie zrzucone drugi raz = duplikat, nie nowy wydatek;
//  - BNPL (PayPo): wydatek liczy się w dniu zakupu, a późniejszy przelew do
//    operatora jest rozliczeniem (migracja 0005), nie drugim wydatkiem.
import { handleOptions, json } from "../_shared/cors.ts";
import { checkAuth } from "../_shared/auth.ts";
import { supabaseAdmin } from "../_shared/supabase.ts";
import { extractDocument, type DocumentDraft } from "../_shared/claude.ts";
import { fxToPln } from "../_shared/fx.ts";

interface ImagePayload {
  image_base64: string;
  media_type?: string;
}

interface Payload {
  images?: ImagePayload[]; // do 4 obrazów jednego zakupu
  image_base64?: string; // wsteczna zgodność: jeden obraz
  media_type?: string;
  text?: string; // wklejony mail / tekst potwierdzenia
  hint?: "receipt" | "screenshot";
  transaction_id?: string; // wymuś dołączenie do konkretnego wpisu (z dashboardu)
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGES = 4;
const MAX_BASE64_CHARS = 7_000_000; // ok. 5 MB binarnie, limit obrazu po stronie API
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function zl(n: number): string {
  return `${n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
}

// Kategoria z podpowiedzi modelu: pozycja o największej kwocie, która ma podpowiedź.
function pickCategoryGuess(draft: DocumentDraft): string | null {
  const withGuess = draft.items.filter((i) => i.category_guess);
  if (withGuess.length === 0) return null;
  withGuess.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return withGuess[0].category_guess;
}

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const auth = await checkAuth(req, "ingest");
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const supabase = supabaseAdmin();
  const payload = (await req.json().catch(() => null)) as Payload | null;

  const images: ImagePayload[] = payload?.images ??
    (payload?.image_base64 ? [{ image_base64: payload.image_base64, media_type: payload.media_type }] : []);

  // Do logu idzie opis żądania, nie same obrazy (są w storage).
  const { data: logRow } = await supabase.from("ingest_log").insert({
    source: "receipt",
    payload: {
      images: images.length,
      has_text: !!payload?.text,
      hint: payload?.hint ?? null,
      transaction_id: payload?.transaction_id ?? null,
    },
  }).select("id").single();
  const logId = logRow?.id;

  const fail = async (status: number, error: string, extra: Record<string, unknown> = {}) => {
    await supabase.from("ingest_log").update({ result: "error", error }).eq("id", logId);
    return json({ error, ...extra }, status);
  };

  if (!payload || (images.length === 0 && !payload.text)) {
    return fail(400, "images[] albo text wymagane");
  }
  if (images.length > MAX_IMAGES) return fail(400, `maksymalnie ${MAX_IMAGES} obrazy na zakup`);
  if (payload.transaction_id && !UUID_RE.test(payload.transaction_id)) {
    return fail(400, "transaction_id musi być UUID");
  }

  const prepared: { base64: string; mediaType: string }[] = [];
  for (const im of images) {
    const mediaType = (im.media_type ?? "image/jpeg").toLowerCase();
    if (!ALLOWED_TYPES.has(mediaType)) {
      return fail(400, `format ${mediaType} nieobsługiwany, w Skrócie skonwertuj obraz do JPEG`);
    }
    if (!im.image_base64 || im.image_base64.length > MAX_BASE64_CHARS) {
      return fail(413, "obraz pusty albo za duży, w Skrócie zmniejsz do ok. 1600 px");
    }
    prepared.push({ base64: im.image_base64, mediaType });
  }

  // Zdjęcia do prywatnego bucketu (dostęp tylko przez service_role).
  const day = new Date().toISOString().slice(0, 10);
  const receiptPaths: string[] = [];
  for (const im of prepared) {
    const ext = im.mediaType.split("/")[1] ?? "jpg";
    const path = `${day}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from("receipts")
      .upload(path, base64ToBytes(im.base64), { contentType: im.mediaType });
    if (uploadErr) return fail(500, `upload: ${uploadErr.message}`);
    receiptPaths.push(`receipts/${path}`);
  }

  let draft: DocumentDraft;
  try {
    draft = await extractDocument({ images: prepared, text: payload.text, hint: payload.hint });
  } catch (e) {
    return fail(502, `OCR nie powiódł się: ${e}`, { receipt_paths: receiptPaths });
  }

  if (draft.total === null) {
    await supabase.from("ingest_log").update({ result: "unparsed" }).eq("id", logId);
    return json({
      unparsed: true,
      message: "Nie odczytałem kwoty. Wpisz wydatek ręcznie albo zrób wyraźniejszy zrzut.",
      draft,
      receipt_paths: receiptPaths,
    }, 422);
  }

  const { pln } = await fxToPln(draft.total, draft.currency);
  const amountSigned = draft.is_refund ? pln : -pln;
  const occurredAt = draft.date ? `${draft.date}T10:00:00Z` : new Date().toISOString();

  // Kategorie jednym zapytaniem: do rozwiązania nazw i do menu w Skrócie.
  const { data: cats } = await supabase
    .from("categories").select("id, name, group_name, sort_order").eq("active", true).order("sort_order");
  const catByName = new Map((cats ?? []).map((c) => [c.name, c.id as string]));
  const catById = new Map((cats ?? []).map((c) => [c.id as string, c.name as string]));

  // Klasyfikacja po PRAWDZIWYM sklepie z dokumentu, nie po operatorze z banku.
  const { data: clsRows } = await supabase.rpc("fn_classify", {
    p_merchant: draft.merchant ?? "",
    p_amount: amountSigned,
    p_occurred: occurredAt,
    p_iban: null,
  });
  const cls = clsRows?.[0] as
    | { kind: string; category_id: string | null; template_id: string | null; confidence: number }
    | undefined;

  let categoryId: string | null = cls?.category_id ?? null;
  if (!categoryId) {
    const guess = pickCategoryGuess(draft);
    categoryId = guess ? (catByName.get(guess) ?? null) : null;
  }
  const confident = !!categoryId && !!draft.merchant && draft.confidence >= 0.8;

  // Dopasowanie do istniejącego wpisu.
  let match: { id: string; type: string } | null = null;
  if (payload.transaction_id) {
    match = { id: payload.transaction_id, type: "forced" };
  } else {
    const { data: m } = await supabase.rpc("fn_find_receipt_match", {
      p_amount: amountSigned,
      p_occurred: occurredAt,
      p_merchant: draft.merchant ?? draft.intermediary ?? "",
    });
    if (m?.[0]) match = { id: m[0].match_id as string, type: m[0].match_type as string };
  }

  const shop = draft.merchant ?? draft.intermediary ?? "nieznany sklep";
  let transactionId: string;
  let action: "matched_bank_row" | "created" | "duplicate";
  let note: string;
  let mismatch: { bank: number; document: number } | null = null;

  if (match?.type === "duplicate_receipt") {
    transactionId = match.id;
    action = "duplicate";
    note = "to zamówienie już jest zapisane, nic nie dodałem";
  } else if (match) {
    const { data: ex, error: exErr } = await supabase
      .from("transactions")
      .select("id, amount, merchant_raw, category_id, raw_payload")
      .eq("id", match.id).maybeSingle();
    if (exErr || !ex) return fail(404, "nie znaleziono wpisu do dopasowania", { receipt_paths: receiptPaths });

    if (Math.abs(ex.amount - amountSigned) > 0.02) {
      mismatch = { bank: ex.amount, document: amountSigned };
    }

    const update: Record<string, unknown> = {
      payment_method: draft.payment_method,
      raw_payload: { ...(ex.raw_payload ?? {}), document: draft, receipt_paths: receiptPaths },
    };
    if (receiptPaths.length > 0) update.receipt_path = receiptPaths[0];
    if (draft.merchant) {
      update.merchant_raw = draft.merchant;
      if (ex.merchant_raw && ex.merchant_raw !== draft.merchant) update.bank_descriptor = ex.merchant_raw;
    }
    if (categoryId && !ex.category_id) update.category_id = categoryId;
    if (draft.bnpl_due) update.bnpl_due = draft.bnpl_due;
    if (confident && !mismatch) update.status = "confirmed";

    const { error: upErr } = await supabase.from("transactions").update(update).eq("id", ex.id);
    if (upErr) return fail(500, upErr.message, { receipt_paths: receiptPaths });

    transactionId = ex.id;
    action = "matched_bank_row";
    note = mismatch
      ? "dopasowano do wpisu z banku, ale kwoty się różnią (zostaje kwota z banku)"
      : "dopasowano do wpisu z banku, sklep i kategoria uzupełnione";
  } else {
    let accountId: string | null = null;
    if (draft.payment_method === "cash") {
      const { data: a } = await supabase.from("accounts").select("id").eq("type", "cash").limit(1).maybeSingle();
      accountId = a?.id ?? null;
    } else if (draft.payment_method !== "bnpl") {
      const { data: a } = await supabase.from("accounts").select("id").eq("budget_role", "main").limit(1).maybeSingle();
      accountId = a?.id ?? null;
    }

    const kind = draft.is_refund
      ? "refund"
      : (cls && ["fixed", "sinking"].includes(cls.kind) ? cls.kind : "variable");

    const { data: tx, error } = await supabase.from("transactions").insert({
      occurred_at: occurredAt,
      amount: amountSigned,
      amount_original: draft.is_refund ? draft.total : -draft.total,
      currency: draft.currency,
      account_id: accountId,
      merchant_raw: shop,
      category_id: categoryId,
      kind,
      template_id: cls?.template_id ?? null,
      source: "receipt",
      status: confident ? "confirmed" : "needs_review",
      confidence: draft.confidence,
      payment_method: draft.payment_method,
      bnpl_due: draft.bnpl_due,
      receipt_path: receiptPaths[0] ?? null,
      raw_payload: { document: draft, receipt_paths: receiptPaths },
    }).select("id").single();
    if (error) return fail(500, error.message, { receipt_paths: receiptPaths });

    transactionId = tx.id;
    action = "created";
    note = draft.payment_method === "bnpl"
      ? `płatność odroczona${draft.bnpl_due ? ` do ${draft.bnpl_due}` : ""}, liczona jako wydatek dziś`
      : "nowy wpis, bank dopisze się przy najbliższym imporcie";
  }

  await supabase.from("ingest_log").update({ result: "ok", transaction_id: transactionId }).eq("id", logId);

  const { data: widget } = await supabase
    .from("widget_state")
    .select("sts_remaining, sts_daily, days_left, color, bnpl_open")
    .eq("id", 1).single();

  const needsTag = action !== "duplicate" && !confident;
  const categoryName = categoryId ? (catById.get(categoryId) ?? null) : null;

  return json({
    transaction_id: transactionId,
    action,
    note,
    summary: `${shop} · ${zl(draft.total)}${categoryName ? ` · ${categoryName}` : ""}`,
    needs_tag: needsTag,
    categories: needsTag
      ? (cats ?? []).filter((c) => c.group_name === "variable").map((c) => c.name)
      : undefined,
    amount_mismatch: mismatch,
    draft: {
      merchant: draft.merchant,
      intermediary: draft.intermediary,
      total: draft.total,
      date: draft.date,
      payment_method: draft.payment_method,
      is_refund: draft.is_refund,
      confidence: draft.confidence,
    },
    sts_remaining: widget?.sts_remaining,
    sts_daily: widget?.sts_daily,
    color: widget?.color,
    bnpl_open: widget?.bnpl_open,
  });
});
