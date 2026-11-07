# Koszyki

Osobisty budżet w koszykach z miesięcznymi limitami. Web app na iPhone (Safari → Udostępnij → Do ekranu początkowego).

- Appka: https://czaplevsky.github.io/budget_app/
- Testy matematyki: https://czaplevsky.github.io/budget_app/tests.html
- Dane zostają w telefonie (IndexedDB). Kopia: Ustawienia → Zapisz kopię.
- W repo nie ma żadnych danych osobistych. Limity, płatności stałe i wpisy wchodzą z pliku kopii.

Stack: HTML, CSS, JavaScript (moduły ES), bez frameworka i bez builda. Service worker: network-first, działa offline.

`legacy/` to wcześniejsza wersja z Supabase, Edge Functions, widgetem Scriptable i Skrótami (październik 2026). Nieużywana, zostaje jako źródło pomysłów do fazy z chmurą.
