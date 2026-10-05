// Kurs NBP (tabela A) do przeliczenia walut obcych na PLN (sekcja 2.6 specu).
// Przy imporcie CSV kwota z banku i tak nadpisuje to przeliczenie (bank zna
// realny kurs z przewalutowania) — to jest tylko do natychmiastowego
// oszacowania przy Apple Pay / paragonie.
export async function fxToPln(amount: number, currency: string): Promise<{ pln: number; rate: number | null }> {
  if (currency === "PLN") return { pln: amount, rate: 1 };
  try {
    const res = await fetch(`https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/?format=json`);
    if (!res.ok) throw new Error(`NBP ${res.status}`);
    const data = await res.json();
    const rate = data.rates?.[0]?.mid as number | undefined;
    if (!rate) throw new Error("no rate in NBP response");
    return { pln: Math.round(amount * rate * 100) / 100, rate };
  } catch (_e) {
    // Brak kursu = nie zgadujemy: zwracamy kwotę oryginalną jako PLN z
    // rate=null, transakcja i tak trafi do needs_review (sekcja 2.3).
    return { pln: amount, rate: null };
  }
}
