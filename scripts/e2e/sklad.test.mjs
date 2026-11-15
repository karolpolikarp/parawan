// Strażnik składu gotowego pliku. Bez sumy bajtów i bez budżetów na składniki: każda taka liczba
// byłaby tak samo wymyślona jak dawny limit 2,6 MB. Zostają reguły o jasnym znaczeniu:
//  1. ten sam moduł nie wchodzi do pliku dwa razy (na Windows słownik nazwisk trafiał do pliku
//     dwukrotnie, patrz normalizePath w apps/web/vite.config.ts), rdzeń tylko ze źródeł, a z pdf.js
//     dokładnie dwa moduły wersji legacy;
//  2. z node_modules tylko pakiety z listy (nowa zależność w pliku wymaga dopisania jej tutaj,
//     jak nowa zależność w projekcie wymaga zgody autora);
//  3. pdf.js nie większy niż jego własny zminifikowany build tej samej wersji (liczba od dostawcy);
//  4. każdy duży URI data: to jeden z fontów z apps/web/src/fonts, każdy dokładnie raz.
// Reguły 1–3 czytają apps/web/dist/sklad.json z wtyczki apps/web/build/sklad.ts, reguła 4 sam plik.
// Przeglądarka niepotrzebna.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT, WEB_HTML } from './helpers.mjs';

const SKLAD_JSON = path.join(ROOT, 'apps', 'web', 'dist', 'sklad.json');
const FONTS_DIR = path.join(ROOT, 'apps', 'web', 'src', 'fonts');

/** Pakiety z node_modules, które mogą być w pliku aplikacji (apps/web/package.json, dependencies). */
export const ALLOWED_PACKAGES = ['pdfjs-dist', 'fflate'];

/** Jedyne moduły pdf.js w pliku: wersja legacy dla Chrome i Edge 109 i Firefoksa ESR 115. */
export const PDFJS_MODULES = ['legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs'];

/**
 * Od tylu znaków URI data: uznajemy za osadzony zasób. To nie budżet, tylko dolna granica:
 * największy znany URI spoza fontów to ikona strony (1 921 znaków), a literały data: wewnątrz pdf.js
 * mają poniżej 40 znaków (pomiar 2026-11-15 na v0.47.0). Fonty mają od 17,8 KB w base64.
 */
export const EMBEDDED_MIN_CHARS = 4096;

const normId = (id) => id.split('\\').join('/').toLowerCase();

/** Pakiet z node_modules (ostatni segment instalacji) albo null. */
function packageOf(id) {
  const all = [...id.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)];
  return all.length ? all[all.length - 1][1] : null;
}

/** Reguły 1 i 2 na liście modułów z sklad.json. */
export function moduleProblems(moduly) {
  const problems = [];
  const seen = new Map();
  for (const { id } of moduly) {
    const k = normId(id);
    if (seen.has(k)) problems.push(`moduł dwa razy: ${seen.get(k)} i ${id}`);
    else seen.set(k, id);
  }
  // Ten sam pakiet z dwóch miejsc instalacji (node_modules/x i node_modules/y/node_modules/x).
  const installs = new Map();
  for (const { id } of moduly) {
    const pkg = packageOf(id);
    if (!pkg) continue;
    const at = id.slice(0, id.lastIndexOf(`node_modules/${pkg}`));
    if (!installs.has(pkg)) installs.set(pkg, new Set());
    installs.get(pkg).add(at);
  }
  for (const [pkg, at] of installs) {
    if (at.size > 1)
      problems.push(`pakiet ${pkg} z ${at.size} miejsc instalacji: ${[...at].join(', ')}`);
    if (!ALLOWED_PACKAGES.includes(pkg)) {
      problems.push(`pakiet ${pkg} spoza listy ALLOWED_PACKAGES (scripts/e2e/sklad.test.mjs)`);
    }
  }
  for (const { id } of moduly) {
    if (/anonimizator\/|packages\/core\//.test(id) && !id.startsWith('packages/core/src/')) {
      problems.push(`rdzeń spoza packages/core/src: ${id}`);
    }
  }
  const pdfjs = moduly
    .map((m) => m.id)
    .filter((id) => packageOf(id) === 'pdfjs-dist')
    .map((id) => id.slice(id.lastIndexOf('pdfjs-dist/') + 'pdfjs-dist/'.length))
    .sort();
  if (JSON.stringify(pdfjs) !== JSON.stringify([...PDFJS_MODULES].sort())) {
    problems.push(
      `moduły pdf.js: ${pdfjs.join(', ') || 'brak'}, oczekiwane ${PDFJS_MODULES.join(', ')}`,
    );
  }
  return problems;
}

/** Reguła 3: bajty modułu pdf.js w pliku wobec pliku .min.mjs obok niego w node_modules. */
export function pdfjsSizeProblems(moduly, root = ROOT) {
  const problems = [];
  for (const { id, bajty } of moduly) {
    if (packageOf(id) !== 'pdfjs-dist' || !id.endsWith('.mjs')) continue;
    const min = path.join(root, id.replace(/\.mjs$/, '.min.mjs'));
    if (!existsSync(min)) {
      problems.push(`brak ${min}: nie ma z czym porównać ${id}`);
      continue;
    }
    const limit = statSync(min).size;
    if (bajty > limit) {
      problems.push(
        `${id}: ${bajty} B w pliku, więcej niż ${path.basename(min)} tej wersji (${limit} B)`,
      );
    }
  }
  return problems;
}

/** Znak zamykający URI otwarty danym znakiem (cudzysłów, apostrof, backtick, nawias url()). */
const CLOSER = { '"': '"', "'": "'", '`': '`', '(': ')' };

/**
 * Duże URI data: w tekście pliku: [typ MIME, treść po przecinku]. Długość liczymy do znaku, który
 * zamyka kontekst otwarty tuż przed „data:” (cudzysłów, apostrof, backtick albo nawias url()),
 * a nie do pierwszego znaku specjalnego: SVG wklejony przez Vite jako
 * "data:image/svg+xml,%3csvg%20xmlns='http://…'" ma w treści apostrofy. Bez rozpoznanego kontekstu
 * URI kończy się na pierwszym znaku spoza URI (cudzysłów, apostrof, nawias, <, >, backtick, odstęp).
 */
export function embeddedDataUris(html, minChars = EMBEDDED_MIN_CHARS) {
  const out = [];
  // Tylko z prawdziwym typem MIME: „data:” bez niego to w kodzie zwykle nazwa pola ({data:e}).
  const re = /data:((?:image|font|application|text|audio|video)\/[a-z0-9.+-]+)[^,"'()<>`\s]*,/gi;
  for (const m of html.matchAll(re)) {
    const start = m.index;
    const bodyStart = start + m[0].length;
    const closer = CLOSER[html[start - 1]];
    let end = bodyStart;
    if (closer) {
      while (end < html.length && html[end] !== closer && html[end] !== '\n') end++;
    } else {
      while (end < html.length && !/[\s"'()<>`]/.test(html[end])) end++;
    }
    if (end - start >= minChars) out.push([m[1].toLowerCase(), html.slice(bodyStart, end)]);
  }
  return out;
}

/** Reguła 4: każdy duży URI to font z katalogu fontów, każdy font dokładnie raz. */
export function dataUriProblems(html, fonts) {
  const problems = [];
  const left = new Map(fonts.map(([name, b64]) => [b64, { name, n: 0 }]));
  for (const [mime, body] of embeddedDataUris(html)) {
    const font = left.get(body);
    if (mime !== 'font/woff2' || !font) {
      problems.push(`osadzony zasób spoza apps/web/src/fonts: data:${mime}, ${body.length} znaków`);
      continue;
    }
    font.n++;
  }
  for (const { name, n } of left.values()) {
    if (n !== 1) problems.push(`font ${name} osadzony ${n} razy, oczekiwany dokładnie raz`);
  }
  return problems;
}

function fontsFromDisk() {
  return readdirSync(FONTS_DIR)
    .filter((f) => f.endsWith('.woff2'))
    .map((f) => [f, readFileSync(path.join(FONTS_DIR, f)).toString('base64')]);
}

// Kopia pliku z PARAWAN_WEB_HTML (job edge-windows) nie ma obok siebie sklad.json z tego samego
// buildu, więc reguły 1–3 zostają dla zwykłego przebiegu; reguła 4 czyta sam plik i działa zawsze.
const MANIFEST_SKIP = process.env.PARAWAN_WEB_HTML
  ? 'PARAWAN_WEB_HTML: kopia pliku bez sklad.json z tego samego buildu'
  : false;

function manifest() {
  assert.ok(
    existsSync(SKLAD_JSON),
    `brak ${SKLAD_JSON}: zbuduj aplikację (npm run build -w anonimizator-web)`,
  );
  const m = JSON.parse(readFileSync(SKLAD_JSON, 'utf8'));
  const sum = createHash('sha256').update(readFileSync(WEB_HTML)).digest('hex');
  assert.equal(m.sha256, sum, 'sklad.json pochodzi z innego buildu niż apps/web/dist/index.html');
  return m;
}

test('skład: bez duplikatów modułów, rdzeń ze źródeł, pdf.js legacy, tylko dozwolone pakiety', {
  skip: MANIFEST_SKIP,
}, () => {
  const { moduly, zrodlaSpozaModulow } = manifest();
  assert.ok(moduly.length > 20, `sklad.json ma tylko ${moduly.length} modułów`);
  assert.deepEqual(zrodlaSpozaModulow, [], 'kod w mapie źródeł spoza listy modułów paczki');
  const problems = moduleProblems(moduly);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('skład: pdf.js nie większy niż jego własny zminifikowany build', {
  skip: MANIFEST_SKIP,
}, () => {
  const problems = pdfjsSizeProblems(manifest().moduly);
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('skład: każdy duży URI data: to font z apps/web/src/fonts, każdy dokładnie raz', () => {
  const fonts = fontsFromDisk();
  assert.ok(fonts.length > 0, `brak fontów w ${FONTS_DIR}`);
  const problems = dataUriProblems(readFileSync(WEB_HTML, 'utf8'), fonts);
  assert.deepEqual(problems, [], problems.join('\n'));
});

// Testy samego strażnika: każda reguła musi zadziałać na przykładzie, który ma złapać.
const OK = [
  { id: 'apps/web/src/main.ts', bajty: 1 },
  { id: 'packages/core/src/index.ts', bajty: 1 },
  { id: 'node_modules/fflate/esm/browser.js', bajty: 1 },
  { id: 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', bajty: 1 },
  { id: 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', bajty: 1 },
];

test('strażnik składu: poprawny skład przechodzi, każde naruszenie reguł 1 i 2 zostaje wykryte', () => {
  assert.deepEqual(moduleProblems(OK), []);
  const bad = {
    'ten sam moduł inną pisownią': [...OK, { id: 'Packages/Core/src/index.ts', bajty: 1 }],
    'pakiet z dwóch miejsc instalacji': [
      ...OK,
      { id: 'node_modules/x/node_modules/fflate/esm/browser.js', bajty: 1 },
    ],
    'pakiet spoza listy': [...OK, { id: 'node_modules/lodash/lodash.js', bajty: 1 }],
    'rdzeń z dist': [...OK, { id: 'packages/core/dist/index.js', bajty: 1 }],
    'rdzeń z node_modules': [...OK, { id: 'node_modules/anonimizator/dist/index.js', bajty: 1 }],
    'pdf.js w wersji nowoczesnej': [
      ...OK,
      { id: 'node_modules/pdfjs-dist/build/pdf.mjs', bajty: 1 },
    ],
    'brak workera pdf.js': OK.filter((m) => !m.id.endsWith('pdf.worker.mjs')),
  };
  for (const [name, moduly] of Object.entries(bad)) {
    assert.notDeepEqual(moduleProblems(moduly), [], `przepuszczone: ${name}`);
  }
});

test('strażnik składu: pdf.js większy niż .min.mjs i obcy duży data: zostają wykryte', () => {
  const big = [{ id: 'node_modules/pdfjs-dist/legacy/build/pdf.mjs', bajty: 1e9 }];
  assert.notDeepEqual(pdfjsSizeProblems(big), []);
  const font = Buffer.alloc(5000, 7).toString('base64');
  const fonts = [['a.woff2', font]];
  const one = `<style>@font-face{src:url(data:font/woff2;base64,${font})}</style>`;
  assert.deepEqual(dataUriProblems(one, fonts), []);
  assert.notDeepEqual(dataUriProblems(one + one, fonts), [], 'przepuszczony font dwa razy');
  assert.notDeepEqual(dataUriProblems('<p></p>', fonts), [], 'przepuszczony brak fontu');
  const png = `<img src="data:image/png;base64,${font}">`;
  assert.notDeepEqual(dataUriProblems(one + png, fonts), [], 'przepuszczony duży obrazek');
  // SVG w postaci, w jakiej wkleja go Vite: procentowe kodowanie z apostrofami w treści.
  const svg = `"data:image/svg+xml,%3csvg%20xmlns='http://www.w3.org/2000/svg'%3e${"%3cpath%20d='M0%200h1'/%3e".repeat(200)}%3c/svg%3e"`;
  assert.ok(svg.length > EMBEDDED_MIN_CHARS);
  assert.deepEqual(
    embeddedDataUris(`a=${svg};`).map(([mime, body]) => [mime, body.length]),
    [['image/svg+xml', svg.length - 2 - 'data:image/svg+xml,'.length]],
  );
  assert.notDeepEqual(dataUriProblems(one + `<script>a=${svg}</script>`, fonts), [], 'przepuszczony duży SVG');
  assert.notDeepEqual(dataUriProblems(one + `<i style="background:url(${svg.slice(1, -1)})"></i>`, fonts), [], 'przepuszczony SVG w url()');
  // Pole „data” w zminifikowanym kodzie to nie URI.
  assert.deepEqual(embeddedDataUris(`{data:e,${'x'.repeat(5000)}}`), []);
});
