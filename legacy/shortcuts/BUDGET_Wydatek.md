# Skrót: BUDGET_Wydatek (ręczny quick-add)

Spec sekcja 3.4. Uruchamiane ręcznie: Siri, przycisk akcji, Back Tap,
widget na ekranie blokady, Apple Watch. Cel: < 6 s od odblokowania telefonu
do zapisanej transakcji.

## Akcje

1. **Poproś o dane wejściowe** (Ask for Input) — typ: Liczba
   - Podpowiedź: "Ile?"
2. **Wybierz z listy** (Choose from List) — kategorie:
   ```
   Spożywcze
   Jedzenie poza domem
   Zakupy/odzież/dom
   Zdrowie - apteka
   Zdrowie - usługi medyczne
   Sport/rekreacja
   Transport
   Gotówka (bankomat)
   Drogeria/chemia
   Inne
   ```
   (ta sama lista co `categories` z `group_name = 'variable'` w bazie —
   jeśli zmieni się w bazie, zaktualizować tu ręcznie, MVP nie synchronizuje
   automatycznie)
3. (opcjonalnie) **Poproś o dane wejściowe** — typ: Tekst, podpowiedź
   "Notatka (opcjonalnie)", pole można zostawić puste.
4. **Pobierz zawartość adresu URL**:
   - `POST https://<projekt>.supabase.co/functions/v1/transactions`
   - Nagłówek: `X-Api-Key` = klucz ze scope `transactions`
   - Body:
     ```json
     {
       "amount": -[Podana liczba],
       "category": [Wybrana kategoria],
       "note": [Podana notatka]
     }
     ```
     (minus przed kwotą: quick-add jest zawsze wydatkiem; zwroty idą przez
     osobny mechanizm `refund`, nie przez ten Skrót w MVP)
5. **Pokaż powiadomienie**:
   - Tytuł: "Zapisano"
   - Treść: `zostało [sts_remaining] zł · [sts_daily] zł/dzień`

## Miejsca uruchomienia (skonfigurować po zbudowaniu Skrótu)

- **Widget na ekranie blokady**: Ustawienia → Ekran blokady → Dostosuj →
  dodaj widget Skrótów → wybierz "BUDGET_Wydatek".
- **Przycisk akcji** (iPhone 15 Pro i nowsze): Ustawienia → Przycisk akcji →
  Skrót → "BUDGET_Wydatek".
- **Back Tap**: Ustawienia → Dostępność → Dotknięcie z tyłu → Podwójne
  stuknięcie → "BUDGET_Wydatek".
- **Siri**: "Hej Siri, Wydatek" (nazwa Skrótu = fraza wywołania domyślnie).
- **Apple Watch**: aplikacja Skróty na zegarku, dodaj do siatki.

## Paragony, zrzuty zakupów, maile

Osobny Skrót: `BUDGET_Zrzut.md`. Ten tutaj zostaje do ręcznego wpisu, a
`BUDGET_Zrzut` uruchamia go awaryjnie, gdy OCR nie odczyta kwoty.
