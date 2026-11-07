# Skrót: BUDGET_ApplePay (automatyzacja, kanał główny)

Spec sekcja 3.2. Wywołanie: automatyczne, po każdej płatności Apple Pay.
Nie da się wyeksportować gotowego `.shortcut` bez urządzenia Apple w tej
sesji — instrukcja krok po kroku do zbudowania w aplikacji Skróty (iOS).

## 1. Utwórz automatyzację

Aplikacja **Skróty** → zakładka **Automatyzacja** → **+** → **Utwórz
automatyzację osobistą** → **Transakcja**.

- **Konto**: dowolne (albo tylko te karty, których Tomek faktycznie używa
  w Apple Pay).
- **Kwota**: zostaw puste (każda kwota).
- Zaznacz **"Uruchom natychmiast"** (Run Immediately) w ustawieniach
  automatyzacji — inaczej iOS pyta o potwierdzenie przy każdej płatności,
  co zabija cel ("real-time bez tarcia").

## 2. Akcje w automatyzacji

1. **Pobierz zawartość adresu URL** (Get Contents of URL)
   - URL: `https://<TWÓJ-PROJEKT>.supabase.co/functions/v1/ingest-applepay`
   - Metoda: `POST`
   - Nagłówki: `X-Api-Key` = (klucz API ze scope `ingest`, wpisany na stałe
     w Skrócie — patrz uwaga bezpieczeństwa niżej)
   - Treść żądania (JSON):
     ```json
     {
       "merchant": [Merchant transakcji],
       "amount": [Kwota transakcji],
       "currency": [Waluta transakcji],
       "card": [Nazwa karty],
       "occurred_at": [Data transakcji w formacie ISO 8601]
     }
     ```
     (Pola w nawiasach kwadratowych to zmienne wstawiane przez Skróty z
     wyjścia triggera "Transakcja" — dostępne w menu "Wybierz zmienną".
     Datę sformatuj przez akcję **Formatuj datę** → ISO 8601 przed
     wstawieniem do JSON, jeśli Skróty nie dają tego formatu bezpośrednio.)

2. **Pobierz wartość słownika** (Get Dictionary Value) z odpowiedzi:
   klucz `needs_tag`.

3. **Jeśli** `needs_tag` = prawda:
   - **Pobierz wartość słownika** klucz `categories` (lista).
   - **Wybierz z listy** (Choose from List) — pokaż użytkownikowi jako
     menu, **bez** "Poczekaj, aż wybierze" jeśli chcesz zero-tarcia
     (w praktyce Skróty i tak czekają na wybór menu; jeśli to za dużo
     tarcia, pomiń ten krok — transakcja zostaje `needs_review`
     i trafia do kolejki w dashboardzie).
   - **Pobierz zawartość adresu URL**:
     `POST https://<projekt>.supabase.co/functions/v1/transactions/[transaction_id]/tag`
     body: `{"category": [wybrana kategoria], "learn_rule": true}`
   - **W przeciwnym razie**: nic (transakcja i tak zapisana).

4. **Pokaż powiadomienie** (Show Notification):
   - Tytuł: `-[amount] [merchant]` (sformatuj kwotę do 2 miejsc)
   - Treść: `zostało [sts_remaining] zł · [sts_daily] zł/dzień`
   - (pola z odpowiedzi kroku 1: `sts_remaining`, `sts_daily`)

## Uwaga bezpieczeństwa

Klucz API wpisany na stałe w Skrócie jest widoczny dla każdego z dostępem
do odblokowanego telefonu. Klucz do tego Skrótu ma **wyłącznie** scope
`ingest` (patrz `supabase/migrations/0001_schema.sql` tabela `api_keys`)
— nie pozwala czytać historii ani nic usuwać. To świadomy kompromis opisany
w spec sekcja 4.7.

## Test (Faza 0b specu)

1. Zapłać telefonem za coś małego.
2. Sprawdź, czy przyszło powiadomienie "-X zł [sklep] · zostało...".
3. Jeśli nie: sprawdź w Supabase tabelę `ingest_log` — payload powinien
   tam być zapisany nawet jeśli dalsze przetwarzanie się wysypało (zasada
   "zapisz przed raportowaniem błędu").
