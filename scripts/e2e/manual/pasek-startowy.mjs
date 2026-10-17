// Pasek „Parawan nie uruchomił się” w konkretnej przeglądarce: stary snapshot Chromium albo Edge
// i Chrome z systemu. Pasek pokazuje się przez opóźnienie animacji CSS (4 s), a --screenshot
// w stary-chromium.mjs robi zrzut na czasie wirtualnym, w którym animacje stoją, więc pasek się na
// nim nie pojawi. Tu przeglądarką steruje Playwright (1.61 radzi sobie z Chromium od 90 wzwyż,
// sprawdzone na 90, 109 i 111) i czekamy zwykłym zegarem.
// Użycie: node scripts/e2e/manual/pasek-startowy.mjs <chrome.exe | msedge | chrome> [url] [zrzut.png]
//   [--ograniczony-ruch]
// Domyślny url to apps/web/dist/index.html?demo. Wypisuje wersję przeglądarki, stan paska od razu
// i po 4,5 s, wyjątki na stronie i błędy konsoli. Gdy aplikacja wystartowała, main.ts usuwa pasek
// z dokumentu; gdy nie (Chromium 90: SyntaxError w module), pasek ma być widoczny dopiero po 4 s.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = process.argv.slice(2);
const reduce = args.includes('--ograniczony-ruch');
const [bin, urlArg, png] = args.filter((a) => !a.startsWith('--'));
// pusty adres ("") też znaczy domyślny, żeby dało się podać sam zrzut
const url = urlArg || `${pathToFileURL(path.join(ROOT, 'apps/web/dist/index.html')).href}?demo`;
if (!bin) {
  console.error('Użycie: node pasek-startowy.mjs <chrome.exe | msedge | chrome> [url] [zrzut.png] [--ograniczony-ruch]');
  process.exit(1);
}

const browser = await chromium.launch(
  bin === 'msedge' || bin === 'chrome' ? { channel: bin } : { executablePath: bin },
);
try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: reduce ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`wyjątek: ${e.message}`));
  page.on('console', (m) => {
    // ostrzeżenie pdf.js o „fake workerze” to typ warning, więc tu go nie ma
    if (m.type() === 'error') errors.push(`konsola: ${m.text()}`);
  });
  await page.goto(url);
  const started = Date.now();
  const bar = page.locator('#boot-fail');
  const early = (await bar.count()) > 0 && (await bar.isVisible());
  await page.waitForTimeout(Math.max(0, 4_500 - (Date.now() - started)));
  const present = (await bar.count()) > 0;
  const late = present && (await bar.isVisible());
  let verdict;
  if (early) verdict = 'BŁĄD: pasek widoczny od razu, bez opóźnienia';
  else if (!present) verdict = 'start w porządku: main.ts usunął pasek';
  else if (late) verdict = 'Parawan nie ruszył: pasek widoczny po 4,5 s';
  else verdict = 'BŁĄD: pasek został w dokumencie, ale po 4,5 s nadal go nie widać';
  console.log(`przeglądarka: ${browser.version()}${reduce ? ' (ograniczony ruch)' : ''}`);
  console.log(`adres: ${url}`);
  console.log(verdict);
  console.log(`błędy: ${errors.join(' | ') || 'brak'}`);
  if (png) {
    await page.screenshot({ path: path.resolve(png) });
    console.log(`zrzut: ${path.resolve(png)}`);
  }
} finally {
  await browser.close();
}
