// Parsery formatów CSV z sekcji 3.6 i załącznika B specu.
// Współdzielone przez import-csv (rekonsyliacja bieżąca, ścieżka E).
// Historia jednorazowa idzie przez scripts/import_historical_csv.py
// (Python, poza Edge Function — szybszy bulk insert bez limitu czasu
// wykonania funkcji).

export interface ParsedRow {
  occurred_at: string; // ISO date
  amount: number;
  currency: string;
  merchant: string;
  source_ref: string | null;
}

const CARD_DESC_RE = /P[ŁL]ATNO[ŚS][ĆC]\s+KART[ĄA]\s+[\d.]+\s+PLN\s+(.+)$/i;

function parseSantanderAmount(raw: string): number {
  return parseFloat(raw.replace(/\s/g, "").replace(",", "."));
}

function toIso(dmy: string, sep: string): string {
  const [d, m, y] = dmy.split(sep);
  return `${y}-${m}-${d}`;
}

// bardzo prosty CSV split — pola w wyciągach Tomka nie zawierają przecinków
// wewnątrz cudzysłowów w kolumnach, które nas interesują (opis bywa w
// cudzysłowie tylko dla kwot). Dla większej odporności można podmienić na
// bibliotekę, ale na ten wolumin (raz w miesiącu, jedno konto) to wystarcza.
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === delim && !inQuotes) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// kontrahent niesie nazwę płatnika (Netia, Orange, Wspólnota, DEKPOL), opis tylko tytuł
function joinParts(first: string, second: string): string {
  const a = (first ?? "").trim();
  const b = (second ?? "").trim();
  if (!a) return b;
  if (!b || a.toLowerCase().includes(b.toLowerCase())) return a;
  if (b.toLowerCase().includes(a.toLowerCase())) return b;
  return `${a} | ${b}`;
}

export function parseSantanderCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ParsedRow[] = [];
  // wiersz 0 = metadane konta, pomiń
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line, ",");
    if (f.length < 6 || !f[1]) continue;
    let iso: string;
    try { iso = toIso(f[1], "-"); } catch { continue; }
    const opis = (f[2] ?? "").trim();
    const kontrahent = (f[3] ?? "").trim();
    let amount: number;
    try { amount = parseSantanderAmount(f[5]); } catch { continue; }
    const cardMatch = opis.match(CARD_DESC_RE);
    const merchant = cardMatch ? cardMatch[1].trim() : joinParts(kontrahent, opis);
    rows.push({
      occurred_at: iso,
      amount,
      currency: "PLN",
      merchant: merchant || kontrahent || "?",
      source_ref: f[7]?.trim() || null,
    });
  }
  return rows;
}

export function parsePekaoCsv(text: string): ParsedRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: ParsedRow[] = [];
  for (const line of lines.slice(1)) { // wiersz 0 = nagłówek
    const f = splitCsvLine(line, ";");
    if (f.length < 8 || !f[0]) continue;
    let iso: string;
    try { iso = toIso(f[0], "."); } catch { continue; }
    const nadawca = (f[2] ?? "").trim();
    const tytul = (f[6] ?? "").trim();
    let amount: number;
    try { amount = parseFloat((f[7] ?? "").replace(/\s/g, "").replace(",", ".")); } catch { continue; }
    if (Number.isNaN(amount)) continue;
    rows.push({
      occurred_at: iso,
      amount,
      currency: (f[8] || "PLN").trim(),
      merchant: joinParts(nadawca, tytul) || "?",
      source_ref: f[9]?.trim() || null,
    });
  }
  return rows;
}
