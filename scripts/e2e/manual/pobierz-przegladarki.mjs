// Pobiera stare przeglądarki do ręcznych sprawdzeń zgodności (A02, B03, lista przed wydaniem)
// do .cache/przegladarki/ w katalogu repo (wpis w .gitignore, binarek nigdy nie zatwierdzamy).
// Wersje jak w badaniu IT urzędów z 17.10.2026: Chromium 90 (próg, poniżej którego Parawan nie
// rusza), 109 (ostatni Chrome i Edge dla Windows 7/8.1, próg build.target), 111 i 125 (granice
// obsługi pdf.js), Firefox ESR 115 (Windows 7/8.1) i 140 oraz geckodriver do sterowania nimi.
// Każde archiwum ma przypiętą sumę SHA-256: zła suma oznacza podmieniony albo uszkodzony plik,
// więc archiwum jest usuwane, a skrypt kończy się błędem. Archiwa są dla Windows x64, bo na nim
// pracuje urzędnik; rozpakowanie działa tylko na Windows (Firefox to instalator .exe).
//
// Użycie: node scripts/e2e/manual/pobierz-przegladarki.mjs [--katalog <ścieżka>] [--tylko id,id]
//         [--bez-rozpakowania]
// Ponowne uruchomienie pomija archiwa, które już są i mają dobrą sumę.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SNAP = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots/Win_x64';
const FF = 'https://archive.mozilla.org/pub/firefox/releases';

// Sumy policzone 17.10.2026 na pobranych archiwach; dla Firefoksa zgodne z SHA256SUMS Mozilli.
const ITEMS = [
  {
    id: 'chromium-857947',
    name: 'Chromium 90.0.4430.0',
    url: `${SNAP}/857947/chrome-win.zip`,
    file: 'chrome-win.zip',
    size: 173365795,
    sha256: '98b5e292358a48ba1e520015fac7a855d1f6241554b20494c3e4913affb4e948',
    unpack: 'zip',
    bin: 'chrome-win/chrome.exe',
  },
  {
    id: 'chromium-1070054',
    name: 'Chromium 109.0.5414.0',
    url: `${SNAP}/1070054/chrome-win.zip`,
    file: 'chrome-win.zip',
    size: 201714520,
    sha256: '21796533e57b51ed8c6d20918a8735b2c0c794522255a1e34183e2d48ed9e19d',
    unpack: 'zip',
    bin: 'chrome-win/chrome.exe',
  },
  {
    id: 'chromium-1097610',
    name: 'Chromium 111.0.5563.0',
    url: `${SNAP}/1097610/chrome-win.zip`,
    file: 'chrome-win.zip',
    size: 207482024,
    sha256: 'ed5ef6a472cc90cfa83c2702e729c557ecf201510a17f0ac28c0ba053ee9a653',
    unpack: 'zip',
    bin: 'chrome-win/chrome.exe',
  },
  {
    id: 'chromium-1287751',
    name: 'Chromium 125.0.6422.0',
    url: `${SNAP}/1287751/chrome-win.zip`,
    file: 'chrome-win.zip',
    size: 260211822,
    sha256: 'c383046ea018996753323208c8f87a9f8102ce426d4b2121894f3925a571a239',
    unpack: 'zip',
    bin: 'chrome-win/chrome.exe',
  },
  {
    id: 'firefox-115.43.0esr',
    name: 'Firefox ESR 115.43.0 (pl, win64)',
    url: `${FF}/115.43.0esr/win64/pl/Firefox%20Setup%20115.43.0esr.exe`,
    file: 'setup.exe',
    size: 60407384,
    sha256: 'a972c578bbcde492d6a8baeaa99fe00558e85c6834bd5366e0edbe3070795416',
    unpack: 'firefox',
    bin: 'app/core/firefox.exe',
  },
  {
    id: 'firefox-140.17.0esr',
    name: 'Firefox ESR 140.17.0 (pl, win64)',
    url: `${FF}/140.17.0esr/win64/pl/Firefox%20Setup%20140.17.0esr.exe`,
    file: 'setup.exe',
    size: 74349648,
    sha256: 'e837a5d65932dfd8f0b0e207804421d04445258cf6b36c17a021312f75aedd5b',
    unpack: 'firefox',
    bin: 'app/core/firefox.exe',
  },
  {
    id: 'geckodriver',
    name: 'geckodriver 0.36.0 (win64)',
    url: 'https://github.com/mozilla/geckodriver/releases/download/v0.36.0/geckodriver-v0.36.0-win64.zip',
    file: 'gd.zip',
    size: 1845646,
    sha256: '4c23d54681d431b42575a66c3c89202a40add3ef45e64b94acac620a89774ad2',
    unpack: 'zip',
    bin: 'geckodriver.exe',
  },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const DIR = path.resolve(arg('--katalog') ?? path.join(ROOT, '.cache', 'przegladarki'));
const only = arg('--tylko')?.split(',');
const unpack = !process.argv.includes('--bez-rozpakowania') && process.platform === 'win32';
const items = only ? ITEMS.filter((it) => only.includes(it.id)) : ITEMS;
if (only && items.length !== only.length) {
  console.error(`Nieznany identyfikator w --tylko. Dostępne: ${ITEMS.map((it) => it.id).join(', ')}`);
  process.exit(1);
}

async function sha256(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

const mb = (n) => `${(n / 1048576).toFixed(0)} MB`;

async function download(it, dest) {
  const res = await fetch(it.url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} dla ${it.url}`);
  const part = `${dest}.part`;
  const h = createHash('sha256');
  let got = 0;
  let shown = 0;
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => {
    h.update(chunk);
    got += chunk.length;
    if (got - shown > it.size / 5) {
      shown = got;
      process.stdout.write(`  ${it.id}: ${mb(got)} z ${mb(it.size)}\n`);
    }
  });
  await pipeline(body, createWriteStream(part));
  const sum = h.digest('hex');
  if (sum !== it.sha256) {
    rmSync(part, { force: true });
    throw new Error(`${it.id}: zła suma SHA-256 (${sum}, oczekiwano ${it.sha256}), plik usunięty`);
  }
  renameSync(part, dest);
}

function extract(it, dir, archive) {
  if (it.unpack === 'zip') {
    // tar z Windows 10 i nowszych (bsdtar) rozpakowuje ZIP bez dodatkowych programów. Ścieżka
    // wprost, bo w Git Bash pierwszy w PATH jest GNU tar, który „C:” bierze za nazwę serwera.
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    const r = spawnSync(existsSync(tar) ? tar : 'tar', ['-xf', archive, '-C', dir], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${it.id}: rozpakowanie nieudane (tar, kod ${r.status})`);
  } else {
    // Pełny instalator Firefoksa to archiwum 7-Zip: /ExtractDir rozpakowuje bez instalacji,
    // bez praw administratora i bez wpisów w systemie.
    const r = spawnSync(archive, [`/ExtractDir=${path.join(dir, 'app')}`], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`${it.id}: rozpakowanie nieudane (kod ${r.status})`);
  }
}

mkdirSync(DIR, { recursive: true });
console.log(`Katalog: ${DIR}`);
let failed = 0;
for (const it of items) {
  const dir = path.join(DIR, it.id);
  const archive = path.join(dir, it.file);
  mkdirSync(dir, { recursive: true });
  try {
    if (existsSync(archive) && statSync(archive).size === it.size && (await sha256(archive)) === it.sha256) {
      console.log(`${it.name}: archiwum już jest, suma zgodna`);
    } else {
      console.log(`${it.name}: pobieram ${mb(it.size)}`);
      await download(it, archive);
      console.log(`${it.name}: suma SHA-256 zgodna`);
    }
    const bin = path.join(dir, it.bin);
    if (unpack && !existsSync(bin)) extract(it, dir, archive);
    if (unpack) console.log(`  ${existsSync(bin) ? bin : `brak ${bin} po rozpakowaniu`}`);
  } catch (e) {
    failed++;
    console.error(`BŁĄD: ${e.message}`);
  }
}

if (!unpack && process.platform !== 'win32') {
  console.log('Archiwa są dla Windows x64: na tym systemie tylko pobrane i sprawdzone, bez rozpakowania.');
}
if (unpack && items.some((it) => it.id === 'chromium-1070054')) {
  const c109 = path.join(DIR, 'chromium-1070054', 'chrome-win', 'chrome.exe');
  console.log(`\nTest dymny na Chromium 109 (Playwright): PARAWAN_CHROMIUM="${c109}" npm run e2e`);
}
process.exit(failed ? 1 : 0);
