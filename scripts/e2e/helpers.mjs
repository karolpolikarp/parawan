// Wspólne narzędzia testów E2E na GOTOWYM pliku. Testy otwierają apps/web/dist/index.html
// (i landing) przez file://, tak jak urzędnik po dwukrotnym kliknięciu, i po każdym teście
// sprawdzają obietnicę „tekst nie opuszcza przeglądarki”: zero żądań poza samym dokumentem,
// zero naruszeń CSP, zero wyjątków i błędów w konsoli. Testy vitest w apps/web sprawdzają
// moduły osobno; tu sprawdzamy plik po buildzie (inline, CSP z wtyczki, fake worker pdf.js).
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

/** Numer PESEL z przykładu w aplikacji (EXAMPLE_TEXT w main.ts). Zmiana przykładu (A06) = zmiana tutaj. */
export const EXAMPLE_PESEL = '44051401359';

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
 * nasłuch żądań, naruszeń CSP, wyjątków i błędów konsoli.
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
  const violations = [];
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
  const leaked = () =>
    requests
      // Chromium podaje wtedy errorText „csp”, starsze wersje „net::ERR_BLOCKED_BY_CSP”.
      .filter((r) => !/^csp$|ERR_BLOCKED_BY_CSP/.test(r.failure()?.errorText ?? ''))
      .map((r) => `${r.method()} ${r.url()} (${r.failure()?.errorText ?? 'wysłane'})`);
  // Gdyby CSP zawiodła, żądanie i tak nie wyjdzie z maszyny testowej: zostanie zapisane
  // przez słuchacza wyżej (test padnie), a tu przerwane.
  await context.route(/^https?:|^wss?:|^ftp:/, (route) => route.abort('blockedbyclient'));
  await context.exposeFunction('__parawanCsp', (v) => violations.push(v));
  await context.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__parawanCsp({
        directive: e.effectiveDirective || e.violatedDirective,
        blocked: e.blockedURI,
        source: `${e.sourceFile}:${e.lineNumber}`,
      });
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

  return {
    page,
    context,
    url,
    requests,
    violations,
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
    /** Żądania spoza pliku, które nie zostały zatrzymane przez CSP (pusta lista = brak wycieku). */
    async leakedRequests() {
      // Zdarzenia sieci przychodzą po wyniku page.evaluate; czekamy, aż każde zgłoszone żądanie
      // się zakończy, żeby wiedzieć, czy zatrzymała je CSP.
      for (let i = 0; i < 40 && pending.size; i++) await page.waitForTimeout(50);
      return leaked();
    },
    /** Zabiera zebrane naruszenia CSP (dla testów, które wywołują je celowo). */
    takeViolations: () => violations.splice(0),
    /** Zabiera zebrane błędy konsoli (dla testów, które wywołują je celowo). */
    takeConsoleErrors: () => consoleErrors.splice(0),
    /** Asercja po teście: nic nie wyszło z pliku i nic się nie wysypało. */
    async assertClean() {
      const out = await this.leakedRequests();
      assert.deepEqual(out, [], `żądania spoza pliku:\n${out.join('\n')}`);
      assert.deepEqual(violations, [], `naruszenia CSP:\n${JSON.stringify(violations, null, 1)}`);
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
