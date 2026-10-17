// Otwiera plik w starym Chromium (snapshoty 90, 109, 111, 125 z pobierz-przegladarki.mjs) bez
// Playwright: chrome --headless --dump-dom zwraca DOM po wykonaniu skryptów, a z niego bierzemy
// blok sondy #__probe (kopie z mkprobe2.mjs). Nie zależy od zgodności Playwright ze starym
// protokołem DevTools, więc działa na każdym snapshocie. Opcjonalnie zrzut tym samym silnikiem.
// Użycie: node scripts/e2e/manual/stary-chromium.mjs <chrome.exe> <url> [zrzut.png]
// Przykład: node scripts/e2e/manual/stary-chromium.mjs
//   .cache/przegladarki/chromium-1070054/chrome-win/chrome.exe
//   "file:///C:/Users/ja/anonimizator/.cache/sonda/Parawan-probe.html?pdftest"
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const [bin, url, png] = process.argv.slice(2);
if (!bin || !url) {
  console.error('Użycie: node stary-chromium.mjs <chrome.exe> <url> [zrzut.png]');
  process.exit(1);
}
// Osobny profil: stary snapshot nie może dotknąć profilu zwykłej przeglądarki.
const profile = mkdtempSync(path.join(tmpdir(), 'parawan-chromium-'));
const base = [
  '--headless',
  '--disable-gpu',
  '--no-first-run',
  `--user-data-dir=${profile}`,
  '--window-size=1366,768',
  // Sonda pisze wynik po 4 s (pliki: 4 s na każdy), a --dump-dom czeka na budżet czasu wirtualnego.
  `--virtual-time-budget=${process.env.WAIT || 25000}`,
];
try {
  const dom = spawnSync(bin, [...base, '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (dom.error) throw dom.error;
  const m = /<pre id="__probe"[^>]*>([\s\S]*?)<\/pre>/.exec(dom.stdout);
  const decodeHtml = (s) =>
    s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  console.log(m ? decodeHtml(m[1]) : '(brak sondy w DOM; czy to kopia z mkprobe2.mjs?)');
  if (dom.status !== 0) console.log(`kod wyjścia: ${dom.status}\n${dom.stderr.slice(-800)}`);
  if (png) {
    const shot = spawnSync(bin, [...base, `--screenshot=${path.resolve(png)}`, url], { encoding: 'utf8' });
    console.log(shot.status === 0 ? `zrzut: ${path.resolve(png)}` : `zrzut nieudany: ${shot.stderr.slice(-400)}`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true });
}
