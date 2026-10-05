#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Import historii CSV (Santander x5 + Pekao) do SQL gotowego do wgrania w
Supabase (SQL editor lub `psql`/`supabase db execute`).

Formaty plików: Santander (bez nagłówka, wiersz 0 = metadane konta) i Pekao
(średnik, z nagłówkiem). Opis w docs/wizualizacja.html i README.

Użycie:
    py -3 import_historical_csv.py <folder_z_CSV> <plik_wyjsciowy.sql>

Przykład (dane tego projektu):
    py -3 import_historical_csv.py \
        "../../SOURCES/wyciągi/2025-10 do 2026-06" \
        "../supabase/seed/historical_import_generated.sql"

Co robi:
1. Parsuje 5 plików Santander (IBAN z wiersza metadanych -> mapowanie na
   konto po ostatnich 4 cyfrach) + 1 plik Pekao (semicolon, z nagłówkiem).
2. Normalizuje merchant_raw (dla kart Santander wyciąga nazwę sklepu z opisu
   "DOP. MC ... PŁATNOŚĆ KARTĄ X.XX PLN NAZWA").
3. Generuje SQL: otwarcie okresów historycznych (fn_open_period), bulk
   INSERT transactions (source='csv'), klasyfikacja przez fn_classify
   (cross join lateral), wymuszenie status='confirmed' dla historii (nie
   zaśmiecamy kolejki "do sprawdzenia" dashboardu danymi sprzed startu
   appki — decyzja per spec sekcja 5.3: "okresy historyczne ...
   informacyjne"), zamknięcie okresów historycznych.
4. NIE łączy się z bazą samodzielnie — pisze plik .sql do ręcznego/CI
   uruchomienia, zgodnie z konwencją projektu (migracje/seed jako pliki,
   sekrety nigdy w repo/skrypcie).
"""
import csv
import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path

def load_account_map():
    """Ostatnie 4 cyfry IBAN -> nazwa konta jak w seed.sql.
    Własne konta trzymaj w scripts/accounts.local.json (poza repo, w .gitignore),
    wzór jest w accounts.example.json."""
    base = Path(__file__).parent
    for name in ("accounts.local.json", "accounts.example.json"):
        f = base / name
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8"))
    raise SystemExit("Brak scripts/accounts.local.json i accounts.example.json")


ACCOUNT_BY_IBAN_SUFFIX = load_account_map()

CARD_DESC_RE = re.compile(
    r"P[ŁL]ATNO[ŚS][ĆC]\s+KART[ĄA]\s+[\d.]+\s+PLN\s+(.+)$", re.IGNORECASE
)


def sql_escape(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"


def parse_santander_amount(raw):
    return float(raw.replace(" ", "").replace(",", "."))


def join_parts(first, second):
    """kontrahent | tytuł; bez powtórek, gdy jedno zawiera się w drugim."""
    first, second = (first or "").strip(), (second or "").strip()
    if not first:
        return second
    if not second or second.lower() in first.lower():
        return first
    if first.lower() in second.lower():
        return second
    return f"{first} | {second}"


def clean_card_merchant(opis):
    m = CARD_DESC_RE.search(opis)
    if m:
        return m.group(1).strip()
    return opis.strip()


def parse_santander_file(path: Path):
    rows = list(csv.reader(io.open(path, encoding="utf-8-sig")))
    if not rows:
        return None, []
    meta = rows[0]
    iban_field = meta[2] if len(meta) > 2 else ""
    digits = re.sub(r"\D", "", iban_field)
    suffix = digits[-4:] if digits else None
    account = ACCOUNT_BY_IBAN_SUFFIX.get(suffix)
    if not account:
        print(f"  UWAGA: nie rozpoznano konta dla {path.name} (IBAN suffix={suffix})", file=sys.stderr)
        return None, []

    out = []
    for r in rows[1:]:
        if len(r) < 6 or not r[1]:
            continue
        try:
            occurred = datetime.strptime(r[1], "%d-%m-%Y").date()
        except ValueError:
            continue
        opis = (r[2] or "").strip()
        kontrahent = (r[3] or "").strip()
        try:
            amount = parse_santander_amount(r[5])
        except (ValueError, IndexError):
            continue

        if CARD_DESC_RE.search(opis):
            merchant = clean_card_merchant(opis)
        else:
            merchant = join_parts(kontrahent, opis)
        source_ref = r[7].strip() if len(r) > 7 and r[7] else None

        out.append({
            "account": account,
            "occurred_at": occurred.isoformat(),
            "amount": amount,
            "currency": "PLN",
            "merchant": merchant or kontrahent or "?",
            "source_ref": source_ref,
        })
    return account, out


def parse_pekao_file(path: Path):
    rows = list(csv.reader(io.open(path, encoding="utf-8-sig"), delimiter=";"))
    if not rows:
        return []
    out = []
    for r in rows[1:]:
        if len(r) < 8 or not r[0]:
            continue
        try:
            occurred = datetime.strptime(r[0], "%d.%m.%Y").date()
        except ValueError:
            continue
        nadawca = (r[2] or "").strip()
        tytul = (r[6] or "").strip()
        try:
            amount = float(r[7].replace(" ", "").replace(",", "."))
        except (ValueError, IndexError):
            continue
        currency = (r[8] or "PLN").strip() or "PLN"
        source_ref = r[9].strip() if len(r) > 9 and r[9] else None

        out.append({
            "account": "Pekao bieżące",
            "occurred_at": occurred.isoformat(),
            "amount": amount,
            "currency": currency,
            "merchant": join_parts(nadawca, tytul) or "?",
            "source_ref": source_ref,
        })
    return out


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src_dir = Path(sys.argv[1])
    out_path = Path(sys.argv[2])

    all_tx = []
    for f in sorted(src_dir.glob("*.csv")):
        if f.name.startswith("Lista_operacji"):
            tx = parse_pekao_file(f)
            print(f"{f.name}: {len(tx)} wierszy (Pekao)")
            all_tx.extend(tx)
        elif f.name.startswith("historia_"):
            _, tx = parse_santander_file(f)
            print(f"{f.name}: {len(tx)} wierszy")
            all_tx.extend(tx)
        else:
            print(f"  pomijam nierozpoznany plik: {f.name}", file=sys.stderr)

    if not all_tx:
        print("Brak transakcji do zaimportowania.", file=sys.stderr)
        sys.exit(1)

    months = sorted({t["occurred_at"][:7] for t in all_tx})
    print(f"\nRazem: {len(all_tx)} transakcji, miesiące: {months[0]} .. {months[-1]}")

    lines = []
    lines.append("-- WYGENEROWANE PRZEZ scripts/import_historical_csv.py — nie edytować ręcznie.")
    lines.append(f"-- Źródło: {src_dir}")
    lines.append(f"-- {len(all_tx)} transakcji, {len(months)} miesięcy ({months[0]}..{months[-1]})")
    lines.append("-- Uruchomić PO migracjach i PO seed.sql (potrzebuje accounts + merchant_rules + templates).")
    lines.append("")
    lines.append("-- 1) otwórz okresy historyczne, żeby transactions.period_id mógł się rozwiązać")
    for m in months:
        lines.append(f"select fn_open_period('{m}-01'::date);")
    lines.append("")

    lines.append("-- 2) bulk insert (batch po 200 wierszy, żeby nie przekroczyć limitu jednego statementu)")
    BATCH = 200
    for i in range(0, len(all_tx), BATCH):
        batch = all_tx[i : i + BATCH]
        lines.append("insert into transactions")
        lines.append("  (occurred_at, amount, amount_original, currency, account_id, merchant_raw, kind, source, source_ref, status)")
        lines.append("select v.occurred_at, v.amount, v.amount, v.currency, a.id, v.merchant, 'variable', 'csv', v.source_ref, 'confirmed'")
        lines.append("from (values")
        value_rows = []
        for t in batch:
            value_rows.append(
                f"  ({sql_escape(t['occurred_at'])}::timestamptz, {t['amount']}, {sql_escape(t['currency'])}, "
                f"{sql_escape(t['account'])}, {sql_escape(t['merchant'])}, {sql_escape(t['source_ref'])})"
            )
        lines.append(",\n".join(value_rows))
        lines.append(") as v(occurred_at, amount, currency, account_name, merchant, source_ref)")
        lines.append("join accounts a on a.name = v.account_name")
        lines.append("on conflict do nothing;")
        lines.append("")

    lines.append("-- 3) klasyfikacja wg merchant_rules/recurring_templates (fn_classify, migracja 0002)")
    lines.append("update transactions t")
    lines.append("set kind = c.kind, category_id = c.category_id, template_id = c.template_id, confidence = c.confidence,")
    lines.append("    status = 'confirmed'  -- historia = informacyjna, nie zaśmiecamy kolejki 'do sprawdzenia'")
    lines.append("from (")
    lines.append("  select tx.id, cls.*")
    lines.append("  from transactions tx")
    lines.append("  cross join lateral fn_classify(tx.merchant_raw, tx.amount, tx.occurred_at, null) cls")
    lines.append("  where tx.source = 'csv'")
    lines.append(") c")
    lines.append("where c.id = t.id;")
    lines.append("")

    lines.append("-- 4) zamknij okresy historyczne (wszystko przed bieżącym miesiącem)")
    lines.append("select fn_close_period(id, 'ignore') from budget_periods")
    lines.append("  where period_start < date_trunc('month', fn_today())::date and status = 'open';")
    lines.append("")
    lines.append("-- 5) przelicz widget_state dla bieżącego (jedynego wciąż otwartego) okresu")
    lines.append("select fn_recompute_widget_state(id) from budget_periods where status = 'open';")

    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\nZapisano: {out_path} ({out_path.stat().st_size} bajtów)")


if __name__ == "__main__":
    main()
