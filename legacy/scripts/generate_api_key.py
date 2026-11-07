#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Generuje klucz API dla BUDGET (sekcja 4.7 specu: jeden klucz na urządzenie/
kanał, ograniczony scope). Wypisuje klucz w plaintext RAZ (wklej do Skrótu /
Scriptable Keychain / dashboardu) i gotowy INSERT do tabeli api_keys
(przechowuje tylko hash — zgodnie z supabase/functions/_shared/auth.ts).

Użycie:
    py -3 generate_api_key.py "Skrót ApplePay" ingest
    py -3 generate_api_key.py "Widget Scriptable" widget
    py -3 generate_api_key.py "Dashboard" transactions,period,review,windfall,balances,ingest,widget
"""
import hashlib
import secrets
import sys


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    label, scopes_raw = sys.argv[1], sys.argv[2]
    scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()]

    key = secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    scopes_sql = "{" + ",".join(scopes) + "}"

    print(f"\nKLUCZ (zapisz teraz, nie da się odczytać ponownie z bazy):\n  {key}\n")
    print("SQL do wklejenia w Supabase SQL editor:")
    print(
        f"insert into api_keys (label, key_hash, scopes) values "
        f"('{label}', '{key_hash}', '{scopes_sql}');"
    )


if __name__ == "__main__":
    main()
