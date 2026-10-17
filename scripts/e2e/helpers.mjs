// Wspólne narzędzia testów E2E na GOTOWYM pliku. Testy otwierają apps/web/dist/index.html
// (i landing) przez file://, tak jak urzędnik po dwukrotnym kliknięciu, i po każdym teście
// sprawdzają obietnicę „tekst nie opuszcza przeglądarki”: zero żądań poza samym dokumentem,
// zero naruszeń CSP, żadnego <meta http-equiv="refresh">, zero wyjątków i błędów w konsoli.
// Testy vitest w apps/web sprawdzają moduły osobno; tu sprawdzamy plik po buildzie (inline,
// CSP z wtyczki, fake worker pdf.js).
//
// Uruchomienie: npm run e2e (po buildzie web i landingu). Każdy kolejny pakiet aplikacji dopisuje
// swoje scenariusze do scripts/e2e/*.test.mjs i korzysta z withApp().
import assert from 'node:assert/strict';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WEB_HTML = path.join(ROOT, 'apps', 'web', 'dist', 'index.html');
export const LANDING_HTML = path.join(ROOT, 'apps', 'landing', 'dist', 'index.html');
export const FIXTURES = path.join(ROOT, 'apps', 'web', 'src', 'fixtures', 'urzad');

/**
 * Numer PESEL z przykładu w aplikacji (EXAMPLE_TEXT w main.ts). Zmiana przykładu (A06) = zmiana
 * tutaj; demoReady() sprawdza, że ten numer naprawdę stoi w polu źródła, więc rozjazd wywraca testy.
 */
export const EXAMPLE_PESEL = '44051401359';

/**
 * Nazwisko osoby z przykładu, w tej samej formie co w EXAMPLE_TEXT. demoReady() sprawdza je tak
 * jak EXAMPLE_PESEL: test „bez treści pisma w localStorage” szuka go w zapisanych wartościach,
 * a po zmianie przykładu szukałby nazwiska, którego w piśmie już nie ma.
 */
export const EXAMPLE_NAME = 'Kowalska';

/**
 * Numer PESEL wpisany na stałe w pliki pismo.* z FIXTURES (buduje je
 * scripts/e2e/manual/zbuduj-pisma.mjs). Dziś równy EXAMPLE_PESEL, ale to osobny fakt: zmiana
 * przykładu w aplikacji nie zmienia gotowego pismo.pdf.
 */
export const PISMO_PESEL = '44051401359';

/**
 * Klucze, które aplikacja może zapisać w localStorage (dziś storageSet w main.ts). Każdy nowy
 * klucz to nowa informacja zostawiana na komputerze urzędnika, więc musi trafić tu świadomie.
 * Po A04 lista będzie czytana z apps/web/src/storage.ts.
 */
export const ALLOWED_STORAGE_KEYS = ['mask-disabled', 'pseudonyms', 'motion'];

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

/** Chromium z Playwright albo, z legacy: true, binarka z PARAWAN_CHROMIUM. */
export function launch({ legacy = false } = {}) {
  if (legacy && !LEGACY_CHROMIUM) throw new Error('Brak PARAWAN_CHROMIUM');
  return chromium.launch(legacy ? { executablePath: LEGACY_CHROMIUM } : {});
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
 * @param {{ file?: string, viewport?: { width: number, height: number },
 *   reducedMotion?: 'reduce' | 'no-preference' }} [opts]
 */
export async function openApp(browser, query = '', opts = {}) {
  const file = opts.file ?? WEB_HTML;
  const url = pathToFileURL(file).href + query;
  const context = await browser.newContext({
    acceptDownloads: true,
    locale: 'pl-PL',
    reducedMotion: opts.reducedMotion ?? 'reduce',
    viewport: opts.viewport ?? { width: 1366, height: 768 },
  });
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
  // WebSocket nie przechodzi przez route ani zdarzenie request, więc ma osobną pułapkę.
  // Playwright podmienia wtedy konstruktor WebSocket na stronie: połączenie nie powstaje, zanim
  // dotrze do CSP, dlatego liczy się każda próba, także taka, którą CSP by zatrzymała. Aplikacja
  // nie ma powodu otwierać WebSocketu, więc sama próba jest błędem.
  await context.routeWebSocket(/.*/, (ws) => {
    webSockets.push(ws.url());
    ws.close();
  });
  await context.clock.install();
  await context.exposeFunction('__parawanCsp', (v) => violations.push(v));
  await context.exposeFunction('__parawanRefresh', (v) => refreshes.push(v));
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
    pageErrors.length +
    consoleErrors.length;
  /** Przewija zegar strony (patrz SETTLE_MS i JUMP_MS wyżej). */
  const settle = async () => {
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
     * Czeka na wynik przykładu z ?demo i sprawdza, że w polu źródła stoją EXAMPLE_PESEL
     * i EXAMPLE_NAME.
     */
    async demoReady() {
      await this.waitForOutput('[PESEL]');
      const input = await page.locator('#input').inputValue();
      // Bez tego asercje „numeru (nazwiska) nie ma w wyniku” przeszłyby zawsze po zmianie przykładu.
      for (const [name, value] of [
        ['EXAMPLE_PESEL', EXAMPLE_PESEL],
        ['EXAMPLE_NAME', EXAMPLE_NAME],
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
    /**
     * Asercja po teście: nic nie wyszło z pliku i nic się nie wysypało, także w dobie po
     * scenariuszu (przewinięty zegar strony).
     */
    async assertClean() {
      await settle();
      const out = await this.leakedRequests();
      assert.deepEqual(out, [], `żądania spoza pliku:\n${out.join('\n')}`);
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
