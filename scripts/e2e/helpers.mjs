// Wspólne narzędzia testów E2E na GOTOWYM pliku. Testy otwierają apps/web/dist/index.html
// (i landing) przez file://, tak jak urzędnik po dwukrotnym kliknięciu, i po każdym teście
// sprawdzają obietnicę „tekst nie opuszcza przeglądarki”: zero żądań poza samym dokumentem,
// zero prób połączenia WebRTC, zero naruszeń CSP, żadnego <meta http-equiv="refresh">, zero
// wyjątków i błędów w konsoli, a w pamięci przeglądarki, adresie i tytule karty żadnych danych
// z wczytanych pism. Testy vitest w apps/web sprawdzają moduły osobno; tu sprawdzamy plik po
// buildzie (inline, CSP z wtyczki, fake worker pdf.js).
//
// Uruchomienie: npm run e2e (po buildzie web i landingu). Każdy kolejny pakiet aplikacji dopisuje
// swoje scenariusze do scripts/e2e/*.test.mjs i korzysta z withApp().
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { chromium, firefox } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * Gotowe pliki. PARAWAN_WEB_HTML i PARAWAN_LANDING_HTML wskazują ich kopię w innym miejscu:
 * job edge-windows w zgodnosc.yml otwiera je z katalogu ze spacją i polskimi literami, jak
 * plik zapisany przez urzędnika w „Narzędzia urzędu” (adres file:// z %20 i %C4%99).
 */
export const WEB_HTML = process.env.PARAWAN_WEB_HTML || path.join(ROOT, 'apps', 'web', 'dist', 'index.html');
export const LANDING_HTML =
  process.env.PARAWAN_LANDING_HTML || path.join(ROOT, 'apps', 'landing', 'dist', 'index.html');
export const FIXTURES = path.join(ROOT, 'apps', 'web', 'src', 'fixtures', 'urzad');

/**
 * Numer PESEL z przykładu w aplikacji (EXAMPLE_TEXT w apps/web/src/example.ts). Zmiana przykładu =
 * zmiana tutaj; demoReady() sprawdza, że ten numer naprawdę stoi w polu źródła, więc rozjazd
 * wywraca testy (a content.test.ts porównuje tę linię z przykładem).
 */
export const EXAMPLE_PESEL = '85071412358';

/**
 * Nazwisko osoby z przykładu, w tej samej formie co w EXAMPLE_TEXT. demoReady() sprawdza je tak
 * jak EXAMPLE_PESEL: test „bez treści pisma w localStorage” szuka go w zapisanych wartościach,
 * a po zmianie przykładu szukałby nazwiska, którego w piśmie już nie ma.
 */
export const EXAMPLE_NAME = 'Wierzbicki';

/**
 * Pozostałe dane osobowe z przykładu, których nie może być na wydruku (wydruk.test.mjs): adres
 * e-mail i początek numeru konta. Numer stoi tu ze spacjami, tak jak w przykładzie, bo
 * demoReady() szuka go w polu źródła dosłownie, tak jak EXAMPLE_PESEL. Wydruk porównuje go bez
 * białych znaków (squash w wydruk.test.mjs), bo tekst wyciągnięty z PDF bywa inaczej rozstawiony,
 * a assertClean() też pomija spacje i łączniki.
 */
export const EXAMPLE_EMAIL = 't.wierzbicki@example.com';
export const EXAMPLE_IBAN_START = 'PL43 1090 1014';

/** Nazwisko urzędnika z bloku podpisu przykładu („Z up. Wójta / Joanna Malec”). */
export const EXAMPLE_OFFICIAL = 'Malec';

/**
 * Numer PESEL wpisany na stałe w pliki pismo.* z FIXTURES (buduje je
 * scripts/e2e/manual/zbuduj-pisma.mjs). To osobny fakt niż EXAMPLE_PESEL: zmiana przykładu
 * w aplikacji nie zmienia gotowego pismo.pdf.
 */
export const PISMO_PESEL = '44051401359';

/** Moduł aplikacji z jedyną listą kluczy localStorage (ALLOWED_KEYS). */
export const STORAGE_TS = path.join(ROOT, 'apps', 'web', 'src', 'storage.ts');

/** Klucze z `export const ALLOWED_KEYS = [...]` w storage.ts, czytane z tekstu pliku. */
export function readStorageKeys(src = readFileSync(STORAGE_TS, 'utf8')) {
  const list = src.match(/^export const ALLOWED_KEYS = \[([^\]]*)\]/m)?.[1];
  const keys = [...(list ?? '').matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (!keys.length) throw new Error(`brak listy ALLOWED_KEYS w ${STORAGE_TS}`);
  return keys;
}

/**
 * Klucze, które aplikacja może zapisać w localStorage: lista ALLOWED_KEYS z
 * apps/web/src/storage.ts (storageGet i storageSet przyjmują tylko te). Każdy nowy klucz to nowa
 * informacja zostawiana na komputerze urzędnika, więc trafia tam świadomie, a assertClean()
 * odrzuca każdy inny.
 */
export const ALLOWED_STORAGE_KEYS = readStorageKeys();

/**
 * Fikcyjne dane osobowe z pism, które wczytują scenariusze E2E: przykład z aplikacji, pisma
 * pismo.* z FIXTURES i pisma budowane w testach (DOCX, CSV, tekst przed drukiem). assertClean()
 * szuka ich po każdym teście w localStorage, sessionStorage, IndexedDB, Cache Storage,
 * ciasteczkach, adresie, tytule karty, window.name i history.state, bez wielkości liter, spacji
 * i łączników. Nazwiska jako rdzeń, żeby trafić każdą odmianę. Nowe dane osobowe w scenariuszu
 * dopisz tutaj.
 * @type {[string, string][]}
 */
export const FICTIONAL_PII = [
  ['PESEL z przykładu', EXAMPLE_PESEL],
  ['PESEL z pism pismo.*', PISMO_PESEL],
  ['nazwisko z przykładu', 'Wierzbick'],
  ['nazwisko z pism pismo.*', 'Kowalsk'],
  ['adres e-mail z przykładu', EXAMPLE_EMAIL],
  ['numer konta z przykładu', EXAMPLE_IBAN_START],
  ['telefon z przykładu', '600 700 800'],
  ['nazwisko urzędnika z przykładu', EXAMPLE_OFFICIAL],
  ['nazwisko prowadzącego z pism pismo.*', 'Bąkiewicz'],
  ['PESEL z pism DOCX i CSV w testach', '85071412358'],
  ['nazwisko z pism DOCX i CSV w testach', 'Wierzbick'],
  ['PESEL ze stopki DOCX w testach', '02270803628'],
  ['nazwisko ze stopki DOCX w testach', 'Stopkowsk'],
  ['nazwisko z nagłówka i komentarza DOCX w testach', 'Nowak'],
  ['nazwisko z testu druku', 'Wiśniewsk'],
  ['nazwisko z rejestru CSV w testach', 'Zielińsk'],
];

/** Górna granica rozmiaru pliku aplikacji w bajtach (dziś ok. 2,09 MB; zapas na kolejne pakiety). */
export const MAX_WEB_BYTES = 2_300_000;

/**
 * Ścieżka do innej binarki Chromium (np. snapshot 109 z pobierz-przegladarki.mjs). Testy
 * starego silnika (B03) bez niej są pomijane: skip: LEGACY_SKIP.
 */
export const LEGACY_CHROMIUM = process.env.PARAWAN_CHROMIUM || '';
export const LEGACY_SKIP = LEGACY_CHROMIUM ? false : 'brak PARAWAN_CHROMIUM (ścieżki do starego Chromium)';

/** Zrzuty z nieudanych testów (w CI wysyłane jako artefakt). */
export const SHOTS_DIR = process.env.PARAWAN_E2E_ZRZUTY || path.join(ROOT, 'test-results', 'e2e');

// Jedyny dopuszczony komunikat konsoli: pdf.js w pliku single-file celowo działa na „fake
// workerze” w głównym wątku (pdf.ts) i ostrzega o tym przy każdym PDF.
const BENIGN_CONSOLE = [/fake worker/i];

// Scenariusz testu trwa poniżej sekundy, a kod może próbować wysłać dane później: z timera,
// requestIdleCallback, po debounce, przy „sprawdzaniu nowszej wersji”. assertClean() przewija więc
// zegar strony: minutę krok po kroku (łańcuchy timerów, debounce, interwały), potem skok o dobę,
// w którym każdy timer zaplanowany na później odpala raz, jak po powrocie do komputera po
// przerwie, i znów minutę na to, co z tego wynikło. Dopiero potem czeka QUIET_MS bez nowych
// zdarzeń, bo zdarzenia sieci, CSP i wyjątków docierają do testu z opóźnieniem.
const SETTLE_MS = 60_000;
const JUMP_MS = 24 * 60 * 60_000;
const QUIET_MS = 300;
const QUIET_MAX_MS = 5_000;

/**
 * Przeglądarka testów: domyślnie Chromium z Playwright. PARAWAN_PRZEGLADARKA=msedge bierze Edge
 * zainstalowany w systemie (job edge-windows w zgodnosc.yml), =firefox Firefoksa z Playwright
 * (łatany Gecko, nie ESR 115, który zostaje na liście ręcznej).
 */
export const BROWSER = process.env.PARAWAN_PRZEGLADARKA || 'chromium';
if (!['chromium', 'msedge', 'firefox'].includes(BROWSER)) {
  throw new Error(`PARAWAN_PRZEGLADARKA=${BROWSER}: dozwolone chromium, msedge, firefox`);
}

/** Przeglądarka z BROWSER albo, z legacy: true, binarka Chromium z PARAWAN_CHROMIUM. */
export function launch({ legacy = false } = {}) {
  if (legacy) {
    if (!LEGACY_CHROMIUM) throw new Error('Brak PARAWAN_CHROMIUM');
    return chromium.launch({ executablePath: LEGACY_CHROMIUM });
  }
  if (BROWSER === 'firefox') return firefox.launch();
  return chromium.launch(BROWSER === 'msedge' ? { channel: 'msedge' } : {});
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
export const wPara = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** Część WordprocessingML (nagłówek, komentarze) z deklaracją przestrzeni nazw. */
export const wPart = (root, body) =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} xmlns:w="${W_NS}">${body}</w:${root}>`);

/**
 * Minimalny DOCX jak z edytora: akapity w word/document.xml (fflate, jak w docx.test.ts),
 * a w `extra` dodatkowe części (nagłówek, komentarze) i surowy XML treści w `bodyXml`.
 */
export function makeDocx(paragraphs, { extra = {}, bodyXml = '' } = {}) {
  const body = paragraphs.map(wPara).join('') + bodyXml;
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(xml),
    ...extra,
  });
}

/** Rozmiar pliku w bajtach. */
export function fileSize(file) {
  return statSync(file).size;
}

/**
 * Otwiera plik przez file:// w nowym, czystym kontekście (pusty localStorage) i zaczyna
 * nasłuch żądań, WebSocketów, naruszeń CSP, znaczników meta refresh, wyjątków i błędów konsoli.
 * Zegar strony to zegar Playwright: czas płynie normalnie, ale assertClean() może go przewinąć.
 * @param {import('playwright').Browser} browser
 * @param {string} [query] np. '?demo'
 * `address` podaje plik pod adresem http(s) przez page.route, bez prawdziwej sieci (kopia na stronie
 * produktu, intranet urzędu). `prepare` dostaje kontekst, zanim ruszy nasłuch i otworzy się plik:
 * np. obca strona z dysku, która zapisuje coś w localStorage wspólnym dla plików file://.
 * @param {{ file?: string, address?: string, viewport?: { width: number, height: number },
 *   reducedMotion?: 'reduce' | 'no-preference', javaScriptEnabled?: boolean,
 *   prepare?: (context: import('playwright').BrowserContext) => Promise<void> }} [opts]
 */
export async function openApp(browser, query = '', opts = {}) {
  const file = opts.file ?? WEB_HTML;
  const url = (opts.address ?? pathToFileURL(file).href) + query;
  // Bez JavaScriptu (zasada GPO blokująca skrypty w plikach z dysku) nie ma timerów strony do
  // przewijania, a zegar Playwright i nasłuch CSP i meta refresh to skrypty na stronie, więc
  // zostaje sama kontrola żądań. Wystarcza: bez skryptu tylko HTML i CSS mogą sięgnąć po zasób.
  const javaScriptEnabled = opts.javaScriptEnabled ?? true;
  const context = await browser.newContext({
    acceptDownloads: true,
    javaScriptEnabled,
    locale: 'pl-PL',
    reducedMotion: opts.reducedMotion ?? 'reduce',
    viewport: opts.viewport ?? { width: 1366, height: 768 },
  });
  if (opts.prepare) await opts.prepare(context);
  /** @type {import('playwright').Request[]} */
  const requests = [];
  const pending = new Set();
  /** @type {string[]} */
  const webSockets = [];
  const violations = [];
  /** @type {string[]} treść atrybutu content każdego <meta http-equiv="refresh"> */
  const refreshes = [];
  const pageErrors = [];
  const consoleErrors = [];
  /** @type {{ api: string, stack: string }[]} każda próba utworzenia połączenia WebRTC */
  const rtc = [];
  const allowed = (u) => {
    if (/^(data|blob|about):/.test(u)) return true;
    // Sam dokument, dokładnie ten adres. Każdy inny file: (obrazek obok pliku, druga strona)
    // znaczy, że plik przestał być samowystarczalny albo coś czyta dysk.
    return u.split('#')[0] === url;
  };
  context.on('request', (r) => {
    if (allowed(r.url())) return;
    requests.push(r);
    pending.add(r);
  });
  context.on('requestfinished', (r) => pending.delete(r));
  context.on('requestfailed', (r) => pending.delete(r));
  // Żądanie zatrzymane przez CSP (np. obrazek z adresem w sieci) Chromium też zgłasza jako
  // żądanie, choć nie wychodzi ono z przeglądarki. Nie liczymy go do wycieków, bo i tak zostawia
  // naruszenie CSP, które wywraca test. Każde inne żądanie, także przerwane przez route niżej,
  // jest błędem.
  const leaked = () => [
    ...requests
      // Chromium podaje wtedy errorText „csp”, starsze wersje „net::ERR_BLOCKED_BY_CSP”.
      .filter((r) => !/^csp$|ERR_BLOCKED_BY_CSP/.test(r.failure()?.errorText ?? ''))
      .map((r) => `${r.method()} ${r.url()} (${r.failure()?.errorText ?? 'wysłane'})`),
    ...webSockets.map((u) => `WebSocket ${u} (próba połączenia)`),
  ];
  // Gdyby CSP zawiodła, żądanie i tak nie wyjdzie z maszyny testowej: zostanie zapisane
  // przez słuchacza wyżej (test padnie), a tu przerwane.
  await context.route(/^https?:|^ftp:/, (route) => route.abort('blockedbyclient'));
  // Sam dokument pod adresem http(s): treść pliku z dysku, bez wyjścia do sieci. Route
  // zarejestrowany później ma pierwszeństwo, więc każdy inny adres dalej jest przerywany.
  if (opts.address) {
    const body = readFileSync(file);
    await context.route(
      (u) => u.href.split('#')[0] === url,
      (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body }),
    );
  }
  // WebSocket nie przechodzi przez route ani zdarzenie request, więc ma osobną pułapkę.
  // Playwright podmienia wtedy konstruktor WebSocket na stronie: połączenie nie powstaje, zanim
  // dotrze do CSP, dlatego liczy się każda próba, także taka, którą CSP by zatrzymała. Aplikacja
  // nie ma powodu otwierać WebSocketu, więc sama próba jest błędem.
  await context.routeWebSocket(/.*/, (ws) => {
    webSockets.push(ws.url());
    ws.close();
  });
  // opts.clockTime: zegar strony od podanej chwili (np. plik starszy niż pół roku, file-age.ts)
  if (javaScriptEnabled) await context.clock.install(opts.clockTime ? { time: opts.clockTime } : undefined);
  await context.exposeFunction('__parawanCsp', (v) => violations.push(v));
  await context.exposeFunction('__parawanRefresh', (v) => refreshes.push(v));
  await context.exposeFunction('__parawanRtc', (v) => rtc.push(v));
  // WebRTC to droga, której CSP nie zamyka: connect-src nie obejmuje połączeń ICE (UDP)
  // ani kanałów danych, a Playwright nie pokazuje ich jako żądań. Numer PESEL wysłany kanałem
  // danych przeszedłby więc bramkę na zielono. Pułapka podmienia konstruktory przed pierwszym
  // skryptem strony: każda próba trafia na listę (assertClean() wymaga pustej), a połączenie nie
  // powstaje, bo konstruktor rzuca wyjątek. Playwright wykonuje ten skrypt w każdej ramce
  // i w każdym nowym oknie, także w pustej ramce about:blank, zanim strona po nią sięgnie
  // (sprawdzone na Chromium 149 i 109), więc konstruktor z ramki też jest pułapką. Pilnuje tego
  // test bramki w smoke.test.mjs, a tekst samego pliku sprawdza dodatkowo zakazane-api.mjs.
  await context.addInitScript(() => {
    // Funkcja zgłoszenia zapamiętana przed skryptami strony, żeby nie dało się jej podmienić.
    const report = window.__parawanRtc;
    const seen = (api) => {
      const stack = String(new Error().stack ?? '')
        .split('\n')
        .slice(3, 6)
        .map((s) => s.trim())
        .join(' | ');
      report({ api, stack });
      return new DOMException(`${api}: WebRTC zablokowane przez bramkę E2E`, 'NotAllowedError');
    };
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
      const Orig = window[name];
      if (typeof Orig !== 'function') continue;
      const Trap = function () {
        throw seen(`new ${name}`);
      };
      Trap.prototype = Orig.prototype;
      // RTCPeerConnection.prototype.constructor prowadziłby do prawdziwego konstruktora
      Object.defineProperty(Orig.prototype, 'constructor', {
        value: Trap,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, name, { value: Trap, writable: true, configurable: true });
    }
    const proto = window.RTCPeerConnection?.prototype;
    if (typeof proto?.createDataChannel === 'function') {
      proto.createDataChannel = function () {
        throw seen('RTCPeerConnection.createDataChannel');
      };
    }
  });
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__parawanCsp({
        directive: e.effectiveDirective || e.violatedDirective,
        blocked: e.blockedURI,
        source: `${e.sourceFile}:${e.lineNumber}`,
      });
    });
    // <meta http-equiv="refresh" content="N;url=…"> przenosi kartę pod dowolny adres, a w
    // adresie mogą jechać dane. CSP nie ma dyrektywy, która by to zatrzymała, a licznik
    // przeglądarki biegnie w czasie rzeczywistym, więc przewijany zegar strony go nie odpala:
    // przy N dłuższym niż scenariusz nawigacja nie zdąży się wydarzyć w teście. Dlatego liczy
    // się sam znacznik, zapisany w chwili wstawienia (także statyczny z parsera, wstawiony
    // i od razu usunięty albo z atrybutem dopisanym później). Aplikacja i landing nie mają
    // powodu go używać.
    const isRefresh = (el) =>
      el.localName === 'meta' && /^\s*refresh\s*$/i.test(el.getAttribute('http-equiv') ?? '');
    const report = (el) => window.__parawanRefresh(el.getAttribute('content') ?? '');
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          if (isRefresh(r.target)) report(r.target);
          continue;
        }
        for (const n of r.addedNodes) {
          if (n.nodeType !== Node.ELEMENT_NODE) continue;
          if (isRefresh(n)) report(n);
          for (const m of n.querySelectorAll('meta')) if (isRefresh(m)) report(m);
        }
      }
    }).observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['http-equiv', 'content'],
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !BENIGN_CONSOLE.some((re) => re.test(m.text()))) {
      consoleErrors.push(m.text());
    }
  });
  await page.goto(url);

  /** Wyjmuje z listy pasujące elementy i zwraca je, reszta zostaje. */
  const take = (list, pick) => {
    const taken = list.filter(pick);
    const rest = list.filter((x) => !pick(x));
    list.splice(0, list.length, ...rest);
    return taken;
  };
  const eventCount = () =>
    requests.length +
    webSockets.length +
    violations.length +
    refreshes.length +
    rtc.length +
    pageErrors.length +
    consoleErrors.length;
  /** Przewija zegar strony (patrz SETTLE_MS i JUMP_MS wyżej). */
  const settle = async () => {
    if (!javaScriptEnabled) return;
    const steps = [
      () => page.clock.runFor(SETTLE_MS),
      () => page.clock.fastForward(JUMP_MS),
      () => page.clock.runFor(SETTLE_MS),
    ];
    for (const step of steps) {
      // Wyjątek z timera odpalonego przy przewijaniu Playwright zwraca z runFor albo fastForward
      // (tylko pierwszy z kroku), a nie jako pageerror, więc trafia na listę wyjątków tutaj, a
      // kolejne kroki i tak się wykonają. Ten sam wyjątek w zwykłym biegu zegara Playwright
      // wypisuje przez console.error, czyli łapie go lista błędów konsoli.
      await step().catch((e) =>
        pageErrors.push(`timer strony: ${String(e?.message ?? e).split('\n')[0]}`),
      );
    }
  };
  /** Czeka, aż przez QUIET_MS nie przyjdzie nic nowego i każde zgłoszone żądanie się zakończy. */
  const quiet = async () => {
    let last = eventCount();
    let quietSince = Date.now();
    for (const end = Date.now() + QUIET_MAX_MS; Date.now() < end; ) {
      await page.waitForTimeout(50);
      const now = eventCount();
      if (now !== last) {
        last = now;
        quietSince = Date.now();
      } else if (!pending.size && Date.now() - quietSince >= QUIET_MS) {
        return;
      }
    }
  };

  return {
    page,
    context,
    url,
    requests,
    violations,
    refreshes,
    pageErrors,
    consoleErrors,
    /** Tekst wyniku (#output) w aplikacji. */
    output: () => page.locator('#output').innerText(),
    /** Czeka, aż wynik zawiera napis (wynik odświeża się z opóźnieniem po wpisaniu). */
    waitForOutput: (needle, timeout = 10_000) =>
      page.waitForFunction(
        (n) => (document.getElementById('output')?.textContent ?? '').includes(n),
        needle,
        { timeout },
      ),
    /**
     * Czeka na wynik przykładu z ?demo i sprawdza, że w polu źródła stoją EXAMPLE_PESEL,
     * EXAMPLE_NAME, EXAMPLE_EMAIL, EXAMPLE_IBAN_START i EXAMPLE_OFFICIAL.
     */
    async demoReady() {
      await this.waitForOutput('[PESEL]');
      const input = await page.locator('#input').inputValue();
      // Bez tego asercje „numeru (nazwiska) nie ma w wyniku” przeszłyby zawsze po zmianie przykładu.
      for (const [name, value] of [
        ['EXAMPLE_PESEL', EXAMPLE_PESEL],
        ['EXAMPLE_NAME', EXAMPLE_NAME],
        ['EXAMPLE_EMAIL', EXAMPLE_EMAIL],
        ['EXAMPLE_IBAN_START', EXAMPLE_IBAN_START],
        ['EXAMPLE_OFFICIAL', EXAMPLE_OFFICIAL],
      ]) {
        assert.ok(
          input.includes(value),
          `w przykładzie (#input) nie ma ${name} „${value}”; zmieniony przykład? popraw helpers.mjs`,
        );
      }
    },
    /**
     * Żądania i próby połączeń spoza pliku, których nie zatrzymała CSP (pusta lista = brak
     * wycieku). Zdarzenia sieci przychodzą po wyniku page.evaluate, więc najpierw okno ciszy.
     */
    async leakedRequests() {
      await quiet();
      return leaked();
    },
    /**
     * Zabiera zebrane naruszenia CSP (dla testów, które wywołują je celowo). Z filtrem zabiera
     * tylko pasujące, więc nieoczekiwane naruszenie zostaje dla assertClean().
     * @param {(v: { directive: string, blocked: string, source: string }) => boolean} [pick]
     */
    takeViolations: (pick = () => true) => take(violations, pick),
    /**
     * Zabiera zebrane błędy konsoli (dla testów, które wywołują je celowo), z filtrem jak wyżej.
     * @param {RegExp} [re]
     */
    takeConsoleErrors: (re) => take(consoleErrors, (m) => !re || re.test(m)),
    /** Próby utworzenia połączenia WebRTC zapisane przez pułapkę (pusta lista = nie było). */
    rtc,
    /** Wszystko, co strona zostawia w pamięci przeglądarki i w karcie (patrz pageTraces). */
    storageTraces: () => page.evaluate(pageTraces),
    /**
     * Problemy ze śladów: dane z FICTIONAL_PII gdziekolwiek i klucze localStorage spoza
     * ALLOWED_STORAGE_KEYS (pusta lista = w porządku).
     */
    async storageProblems() {
      return tracesProblems(await this.storageTraces());
    },
    /**
     * Asercja po teście: nic nie wyszło z pliku i nic się nie wysypało, także w dobie po
     * scenariuszu (przewinięty zegar strony).
     */
    async assertClean() {
      // Ślady sprawdzane dwa razy: zaraz po scenariuszu i po przewinięciu zegara o dobę, bo
      // zapis odłożony na później albo skasowany przez timer widać tylko w jednej z tych chwil.
      // Bez JavaScriptu strona nie ma czym ich zostawić.
      const tracesNow = javaScriptEnabled ? await this.storageProblems() : [];
      await settle();
      const tracesLater = javaScriptEnabled ? await this.storageProblems() : [];
      const out = await this.leakedRequests();
      assert.deepEqual(out, [], `żądania spoza pliku:\n${out.join('\n')}`);
      assert.deepEqual(
        rtc,
        [],
        `próby połączenia WebRTC (CSP ich nie zatrzymuje, dane wyszłyby po UDP):\n${rtc
          .map((r) => `${r.api} (${r.stack})`)
          .join('\n')}`,
      );
      const traces = [...new Set([...tracesNow, ...tracesLater])];
      assert.deepEqual(
        traces,
        [],
        `dane z pism albo nieznane klucze w pamięci przeglądarki, adresie lub tytule karty:\n${traces.join('\n')}`,
      );
      assert.deepEqual(violations, [], `naruszenia CSP:\n${JSON.stringify(violations, null, 1)}`);
      assert.deepEqual(
        refreshes,
        [],
        `<meta http-equiv="refresh"> w dokumencie (nawigacja karty po czasie, której CSP nie zatrzyma):\n${refreshes.join('\n')}`,
      );
      assert.deepEqual(pageErrors, [], `wyjątki na stronie:\n${pageErrors.join('\n')}`);
      assert.deepEqual(consoleErrors, [], `błędy w konsoli:\n${consoleErrors.join('\n')}`);
    },
    close: () => context.close(),
  };
}

/**
 * Ślady strony w przeglądarce i w karcie (funkcja wykonywana na stronie): klucze i wartości
 * localStorage i sessionStorage, nazwy i zawartość baz IndexedDB, nazwy i adresy w Cache
 * Storage, ciasteczka, adres, tytuł karty, window.name i history.state. Pamięć witryny leży na
 * dysku, a adres, tytuł, nazwa okna i stan historii trafiają do historii i plików sesji
 * przeglądarki, więc dane z pisma nie mogą być w żadnym z tych miejsc. Błąd odczytu też trafia
 * do raportu.
 * @returns {Promise<{ localKeys: string[], items: [string, string][] }>}
 */
async function pageTraces() {
  /** @type {[string, string][]} */
  const items = [];
  const add = (where, value) => items.push([where, String(value)]);
  const json = (v) => {
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  };
  const req = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  const localKeys = [];
  for (const [name, get] of [
    ['localStorage', () => localStorage],
    ['sessionStorage', () => sessionStorage],
  ]) {
    try {
      const s = get();
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i) ?? '';
        if (name === 'localStorage') localKeys.push(k);
        add(`${name}, klucz`, k);
        add(`${name}[${k}]`, s.getItem(k));
      }
    } catch (e) {
      add(`${name}, błąd odczytu`, e);
    }
  }
  try {
    if (typeof indexedDB?.databases === 'function') {
      for (const { name } of await indexedDB.databases()) {
        add('IndexedDB, nazwa bazy', name);
        const db = await req(indexedDB.open(name));
        try {
          for (const store of db.objectStoreNames) {
            const os = db.transaction(store, 'readonly').objectStore(store);
            add(`IndexedDB ${name}/${store}, klucze`, json(await req(os.getAllKeys())));
            add(`IndexedDB ${name}/${store}, wartości`, json(await req(os.getAll())));
          }
        } finally {
          db.close();
        }
      }
    }
  } catch (e) {
    add('IndexedDB, błąd odczytu', e);
  }
  try {
    if (globalThis.caches) {
      for (const name of await caches.keys()) {
        add('Cache Storage, nazwa', name);
        for (const r of await (await caches.open(name)).keys()) add(`Cache Storage ${name}`, r.url);
      }
    }
  } catch (e) {
    // dla file:// Cache Storage bywa niedostępne (SecurityError); wtedy nikt tam nic nie zapisał
    if (e?.name !== 'SecurityError') add('Cache Storage, błąd odczytu', e);
  }
  add('document.cookie', document.cookie);
  add('adres karty', location.href);
  add('tytuł karty', document.title);
  add('window.name', window.name);
  add('history.state', json(history.state));
  return { localKeys, items };
}

/** Bez wielkości liter, białych znaków i łączników: „PL61 1090” i „pl611090” to ten sam numer. */
const flat = (s) => s.toLowerCase().replace(/[\s -]+/g, '');

/** Napis i jego postać zdekodowana z adresu (%C4%85, „+” jako spacja), bez wielkości liter i spacji. */
function variants(value) {
  const out = [value];
  for (const v of [value, value.replace(/\+/g, ' ')]) {
    try {
      out.push(decodeURIComponent(v));
    } catch {
      /* zły zapis %, zostaje surowy napis */
    }
  }
  return out.map(flat);
}

/**
 * Problemy ze śladów z pageTraces: klucze localStorage spoza ALLOWED_STORAGE_KEYS i dane
 * z FICTIONAL_PII gdziekolwiek (pusta lista = w porządku).
 * @param {{ localKeys: string[], items: [string, string][] }} traces
 */
export function tracesProblems({ localKeys, items }) {
  const problems = [];
  for (const k of localKeys) {
    if (!ALLOWED_STORAGE_KEYS.includes(k)) {
      problems.push(`localStorage: klucz „${k}” spoza ALLOWED_KEYS (apps/web/src/storage.ts)`);
    }
  }
  for (const [where, value] of items) {
    const hay = variants(value);
    for (const [what, needle] of FICTIONAL_PII) {
      if (hay.some((h) => h.includes(flat(needle)))) {
        problems.push(`${where}: ${what} „${needle}” w „${value.slice(0, 200)}”`);
      }
    }
  }
  return problems;
}

/**
 * Otwiera plik, wykonuje fn(app), a potem zawsze sprawdza assertClean(). Przy błędzie robi
 * zrzut całej strony do SHOTS_DIR (w CI trafia do artefaktu).
 * @param {import('playwright').Browser} browser
 * @param {import('node:test').TestContext} t
 * @param {string} query
 * @param {(app: Awaited<ReturnType<typeof openApp>>) => Promise<void>} fn
 * @param {Parameters<typeof openApp>[2]} [opts]
 */
export async function withApp(browser, t, query, fn, opts) {
  const app = await openApp(browser, query, opts);
  try {
    await fn(app);
    await app.assertClean();
  } catch (e) {
    mkdirSync(SHOTS_DIR, { recursive: true });
    const name = t.name
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);
    await app.page
      .screenshot({ path: path.join(SHOTS_DIR, `${name}.png`), fullPage: true })
      .catch(() => {});
    throw e;
  } finally {
    await app.close();
  }
}

/**
 * Po wczytaniu DOCX albo PDF aplikacja sama przechodzi do „Porównania” (oryginał przekreślony
 * obok znacznika). Tekst do skopiowania i pobrania to widok „Wynik”, więc sprawdzamy go tam.
 * Znacznik [PESEL] musi stać także w tym widoku: testy sprawdzają potem tylko, że numeru w nim
 * nie ma, a taki warunek spełnia też pusty albo niewyrenderowany wynik.
 */
export async function resultText(app) {
  await app.page.getByRole('button', { name: 'Wynik', exact: true }).click();
  await app.page.waitForFunction(
    () => document.getElementById('view-result')?.getAttribute('aria-pressed') === 'true',
  );
  const out = await app.output();
  assert.ok(out.includes('[PESEL]'), `widok „Wynik” bez znacznika [PESEL]:\n„${out}”`);
  return out;
}
