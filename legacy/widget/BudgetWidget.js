// BudgetWidget.js — sekcja 4.4 specu.
// Scriptable (iOS/iPadOS), darmowa aplikacja: https://scriptable.app
//
// Instalacja:
// 1. Otwórz Scriptable, utwórz nowy skrypt, wklej tę treść, nazwij "BudgetWidget".
// 2. Przy pierwszym uruchomieniu (Play w edytorze) skrypt zapyta o URL API
//    i klucz — zapisze je w Keychain (bezpiecznie, nie w kodzie).
// 3. Dodaj widget Scriptable na ekran główny LUB ekran blokady:
//    - Small / Medium (ekran główny): przytrzymaj pulpit -> "+" -> Scriptable
//      -> wybierz rozmiar -> w ustawieniach widgetu: Script = "BudgetWidget",
//      "When Interacting" = "Run Script".
//    - Ekran blokady: przytrzymaj ekran blokady -> Dostosuj -> dodaj widget
//      Scriptable (accessoryCircular lub accessoryRectangular).
// 4. Tap na widget uruchamia Skrót BUDGET_Wydatek (ręczny wpis) — patrz
//    shortcuts/BUDGET_Wydatek.md.
//
// Realne ograniczenie: iOS odświeża widgety Scriptable w swoim tempie
// (zwykle 5-30 min), NIE natychmiast po transakcji. "Na bieżąco" daje
// powiadomienie wysyłane przez Edge Function po każdym ingest (sekcja 4.6),
// widget tylko dogania w tle. Nie obiecuj Tomkowi czegoś, czego iOS
// technicznie nie robi.

const KEYCHAIN_URL_KEY = "budget_api_url";
const KEYCHAIN_KEY_KEY = "budget_api_key";
const CACHE_PATH = FileManager.local().joinPath(
  FileManager.local().documentsDirectory(),
  "budget_widget_cache.json"
);

async function getConfig() {
  let apiUrl = Keychain.contains(KEYCHAIN_URL_KEY) ? Keychain.get(KEYCHAIN_URL_KEY) : null;
  let apiKey = Keychain.contains(KEYCHAIN_KEY_KEY) ? Keychain.get(KEYCHAIN_KEY_KEY) : null;

  if (!apiUrl || !apiKey) {
    const alert = new Alert();
    alert.title = "Konfiguracja BUDGET";
    alert.message = "Podaj URL Edge Function /widget i klucz API (scope: widget).";
    alert.addTextField("https://xxx.supabase.co/functions/v1/widget", apiUrl || "");
    alert.addTextField("klucz API", apiKey || "");
    alert.addAction("Zapisz");
    await alert.present();
    apiUrl = alert.textFieldValue(0);
    apiKey = alert.textFieldValue(1);
    Keychain.set(KEYCHAIN_URL_KEY, apiUrl);
    Keychain.set(KEYCHAIN_KEY_KEY, apiKey);
  }
  return { apiUrl, apiKey };
}

async function fetchWidgetState() {
  const { apiUrl, apiKey } = await getConfig();
  const req = new Request(apiUrl);
  req.headers = { "X-Api-Key": apiKey };
  req.timeoutInterval = 5;
  try {
    const data = await req.loadJSON();
    FileManager.local().writeString(CACHE_PATH, JSON.stringify({ data, fetched_at: Date.now() }));
    return { data, stale: false };
  } catch (e) {
    if (FileManager.local().fileExists(CACHE_PATH)) {
      const cached = JSON.parse(FileManager.local().readString(CACHE_PATH));
      return { data: cached.data, stale: true, fetchedAt: cached.fetched_at };
    }
    throw e;
  }
}

function colorFor(name) {
  switch (name) {
    case "green": return new Color("#2e7d32");
    case "yellow": return new Color("#b8860b");
    case "red": return new Color("#c62828");
    case "red_full": return new Color("#8e0000");
    default: return Color.gray();
  }
}

function fmtZl(n) {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n).toLocaleString("pl-PL")} zł`;
}

function staleSuffix(stale, fetchedAt) {
  if (!stale) return "";
  const mins = Math.round((Date.now() - fetchedAt) / 60000);
  return ` · sprzed ${mins < 60 ? mins + " min" : Math.round(mins / 60) + " h"}`;
}

async function buildWidget() {
  const widget = new ListWidget();
  const size = config.widgetFamily; // small | medium | accessoryCircular | accessoryRectangular

  let result;
  try {
    result = await fetchWidgetState();
  } catch (e) {
    widget.addText("Błąd połączenia");
    widget.addText(String(e)).font = Font.systemFont(10);
    return widget;
  }
  const d = result.data;
  const bg = colorFor(d.color);

  if (size === "accessoryCircular") {
    const pct = d.sts_month > 0 ? Math.min(100, Math.round((d.spent_mtd / d.sts_month) * 100)) : 0;
    const gauge = widget.addText(`${Math.round(d.sts_daily)}`);
    gauge.font = Font.boldSystemFont(20);
    widget.addText(`${pct}%`).font = Font.systemFont(10);
    return widget;
  }

  if (size === "accessoryRectangular") {
    const line1 = widget.addText(`${fmtZl(d.sts_daily)}/dzień`);
    line1.font = Font.boldSystemFont(14);
    widget.addText(`${fmtZl(d.sts_remaining)}${staleSuffix(result.stale, result.fetchedAt)}`).font = Font.systemFont(10);
    return widget;
  }

  // small / medium (ekran główny)
  widget.backgroundColor = bg.alpha ? bg : bg;
  widget.setPadding(14, 14, 14, 14);

  const stack = widget.addStack();
  stack.layoutHorizontally();

  const left = stack.addStack();
  left.layoutVertically();
  left.addText("DZISIAJ").font = Font.systemFont(11);
  const big = left.addText(fmtZl(d.sts_daily));
  big.font = Font.boldSystemFont(34);
  big.textColor = Color.white();
  left.addText(
    `${fmtZl(d.sts_remaining)} · ${d.days_left} dni${staleSuffix(result.stale, result.fetchedAt)}`
  ).font = Font.systemFont(12);

  if (d.needs_review_count > 0) {
    left.addSpacer(4);
    left.addText(`do sprawdzenia: ${d.needs_review_count}`).font = Font.systemFont(10);
  }

  if (size === "medium") {
    stack.addSpacer();
    const right = stack.addStack();
    right.layoutVertically();
    if (d.next_fixed) {
      right.addText(`następne:`).font = Font.systemFont(10);
      right.addText(`${d.next_fixed.name}`).font = Font.systemFont(11);
      right.addText(`${fmtZl(d.next_fixed.amount)} (${d.next_fixed.due?.slice(8, 10)}.)`).font = Font.systemFont(11);
    }
    if (d.bnpl_open > 0) {
      right.addSpacer(4);
      right.addText(`PayPo do spłaty:`).font = Font.systemFont(10);
      right.addText(fmtZl(d.bnpl_open)).font = Font.systemFont(11);
    }
  }

  widget.url = "shortcuts://run-shortcut?name=BUDGET_Wydatek";
  return widget;
}

const widget = await buildWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
