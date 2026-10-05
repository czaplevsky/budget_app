# Skrót: BUDGET_Zrzut (paragon, zrzut zakupu, tekst maila)

Spec sekcja 3.5. Jeden Skrót na wszystko, co wchodzi spoza Apple Pay:
paragon ze zdjęcia, zrzut ekranu "Dziękujemy za zamówienie" ze sklepu albo
bramki płatności (PayPro, PayU, Przelewy24, tpay, Autopay, PayPo), tekst maila
z potwierdzeniem. Endpoint: `POST /functions/v1/ingest-receipt`.

## Po co to w ogóle

W banku zakup przez bramkę wygląda jak `PAYPRO S.A. -149,00`, bez sklepu. BLIK
i pay-by-link nie przechodzą przez Apple Pay, więc automat ich nie widzi. Zrzut
daje sklep, kwotę, datę i pozycje, a backend robi z tego jedną z trzech rzeczy:

| Sytuacja | Co robi backend |
|---|---|
| Wpis z banku już jest (kwota co do grosza, okno 5 dni) | uzupełnia go sklepem i kategorią, nie dodaje drugiego wydatku |
| Wpisu jeszcze nie ma | tworzy wpis; późniejszy import CSV scala się z nim |
| To samo zamówienie zrzucone drugi raz | duplikat, nic nie dodaje |

PayPo i inne "zapłać później": wydatek liczy się w dniu zakupu, a późniejszy
przelew do PayPo jest rozliczeniem, nie drugim wydatkiem. Widget pokazuje
osobno, ile zostało do spłaty.

## Budowa Skrótu

Ustawienia Skrótu: **Pokaż w arkuszu udostępniania**, przyjmuje **Obrazy** i
**Tekst**.

1. **Jeśli** Dane wejściowe Skrótu **nie mają wartości** (start z przycisku
   akcji lub ekranu głównego):
   - **Zrób zdjęcie** → ustaw zmienną `Zdjecia`, zmienną `hint` = `receipt`.
   **W przeciwnym razie**:
   - ustaw `Zdjecia` = Dane wejściowe Skrótu, `hint` = `screenshot`.
2. **Pobierz elementy z listy** (zakres 1-4): API bierze maksymalnie 4 obrazy
   jednego zakupu (np. dwa ekrany tego samego zamówienia).
3. **Powtórz dla każdego** elementu z `Zdjecia`:
   - **Zmień rozmiar obrazu** → szerokość `1600`
   - **Konwertuj obraz** → format **JPEG**, jakość średnia (iPhone robi HEIC,
     API go nie przyjmie)
   - **Zakoduj** → **Base64**, podział na wiersze: **Brak**
   - **Słownik**: `image_base64` = zakodowany tekst, `media_type` = `image/jpeg`
   - **Dodaj do zmiennej** `Pliki`
4. **Pobierz zawartość adresu URL**:
   - `POST https://<projekt>.supabase.co/functions/v1/ingest-receipt`
   - Nagłówek `X-Api-Key` = klucz ze scope `ingest`
   - Treść JSON: `images` = `Pliki` (tablica), `hint` = `hint`.
     Jeśli wejście było tekstem (mail), dodaj pole `text` = tekst i pomiń obrazy.
5. **Pobierz wartość słownika** `unparsed`. **Jeśli** prawda:
   - **Pokaż alert**: wartość `message` ("Nie odczytałem kwoty..."), potem
     **Uruchom Skrót** `BUDGET_Wydatek`. Koniec.
6. **Pobierz wartość słownika** `needs_tag`. **Jeśli** prawda:
   - **Wybierz z listy** = `categories`
   - **Pobierz zawartość adresu URL**:
     `POST .../functions/v1/transactions/<transaction_id>/tag`,
     body `{"category": <wybrana>}`
7. **Pokaż powiadomienie**:
   - tytuł: `summary` (np. "Zalando · 1 191,65 zł · Zakupy/odzież/dom")
   - treść: `note`, a pod spodem `zostało <sts_remaining> zł · <sts_daily> zł/dzień`;
     jeśli `bnpl_open` > 0 dopisz `do spłaty PayPo: <bnpl_open> zł`

## Jak robić zrzut, żeby wyszło

- Rób go na stronie **potwierdzenia zamówienia** albo na ekranie bramki
  płatności, gdzie widać sklep, kwotę "do zapłaty" i operatora. Nie na
  koszyku (kwota się jeszcze zmienia) i nie na stronie banku.
- Zamówienie na dwa ekrany: zaznacz oba zrzuty w Zdjęciach i udostępnij razem.
- Mail z potwierdzeniem: udostępnij zaznaczony tekst do Skrótu, pole `text`.
- Po zapłacie zrzut możesz zrobić od razu albo po kilku dniach: backend dopasuje
  go do wpisu z banku w oknie 5 dni od daty zamówienia.

## Uruchamianie

- **Arkusz udostępniania** ze zrzutu, Zdjęć lub Maila: najczęstsza droga.
- **Potrójne stuknięcie z tyłu** (Dotknięcie z tyłu) albo **przycisk akcji**:
  start bez wejścia, czyli aparat na paragon.

## Prywatność

Zdjęcia trafiają do prywatnego bucketu Supabase, do modelu idzie sam obraz.
Prompt każe nie zwracać adresu, telefonu, numerów kart ani nazwisk. Automatyczne
kasowanie zdjęć po 90 dniach (spec 4.7) **nie jest jeszcze zaimplementowane**,
patrz `README.md`.

## Test (Faza 0b)

1. Zrób zrzut dowolnego potwierdzenia zamówienia, udostępnij do Skrótu.
2. Powinno przyjść powiadomienie ze sklepem i kwotą. Jeśli wpis z banku już
   był, w odpowiedzi `note` mówi "dopasowano do wpisu z banku".
3. Zrzuć to samo drugi raz: `note` ma powiedzieć, że to zamówienie już jest.
4. Błąd: sprawdź tabelę `ingest_log` (opis żądania zapisuje się przed OCR).
