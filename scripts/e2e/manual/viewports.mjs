// Zrzuty pierwszego ekranu Parawana w Edge przy typowych urzędowych ekranach i pomiar, gdzie
// leżą pole źródła, wynik i „Kopiuj”. Pokazuje, czy urzędnik widzi pole do wklejenia bez
// przewijania. Pomiar #input przejmie automatyczny test układu (A06: scripts/e2e/uklad.test.mjs).
// Użycie: node scripts/e2e/manual/viewports.mjs [plik.html] [katalog-zrzutów]
// Domyślnie apps/web/dist/index.html i bieżący katalog. Bez Edge (np. Linux) użyje Chromium.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const [file = path.join(ROOT, 'apps/web/dist/index.html'), outDir = '.'] = process.argv.slice(2);
const url = `${pathToFileURL(path.resolve(file)).href}?demo`;
mkdirSync(outDir, { recursive: true });

// Obszar strony = ekran minus pasek zadań Windows (40–48 px) i interfejs Edge (ok. 71–80 px).
const cases = [
  { name: '1366x768', w: 1366, h: 650, zoom: 1, note: 'laptop 1366x768, 100%' },
  { name: '1280x720', w: 1280, h: 600, zoom: 1, note: 'monitor 1280x720 albo FHD przy 150%' },
  { name: '1536x864', w: 1536, h: 745, zoom: 1, note: 'FHD przy skalowaniu 125% (domyślne na laptopach)' },
  { name: '1920x1080', w: 1920, h: 960, zoom: 1, note: 'FHD 100% (zalecenie EZD RP)' },
  { name: '1366x768-zoom125', w: 1093, h: 520, zoom: 1.25, note: '1366x768 i powiększenie 125% w przeglądarce' },
];

let browser;
let channel = 'msedge';
try {
  browser = await chromium.launch({ channel, headless: true });
} catch {
  channel = 'chromium';
  browser = await chromium.launch();
}
console.log(`przeglądarka: ${channel} ${browser.version()}`);
const results = [];
for (const c of cases) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: c.zoom,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        left: Math.round(b.left),
        width: Math.round(b.width),
        height: Math.round(b.height),
      };
    };
    return {
      vw: innerWidth,
      vh: innerHeight,
      docH: document.documentElement.scrollHeight,
      hscroll: document.documentElement.scrollWidth > innerWidth,
      input: r('#input'),
      output: r('#output'),
      copy: r('#copy'),
      edytor: r('#edytor'),
    };
  });
  await page.screenshot({ path: path.join(outDir, `${channel}-${c.name}.png`) });
  results.push({ ...c, ...m, errors });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
