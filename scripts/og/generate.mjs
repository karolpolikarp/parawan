/**
 * Generator obrazów społecznościowych landingu (uruchamiany RĘCZNIE, nie w buildzie):
 *   - apps/landing/public/og.png              (1200×630 — og:image / twitter:image)
 *   - apps/landing/public/apple-touch-icon.png (180×180 — ikona na ekranie iOS)
 *
 * Renderuje kartę HTML w headless Chromium (playwright-core). Fonty marki wtapiane
 * base64 z apps/landing/src/fonts (lokalne woff2 — zgodnie z zasadą marki: zero CDN).
 * Znak marki = kopia parawanMark() z apps/landing/src/icons.ts (stałe barwy).
 * og.png to pocztówka „Sosna o poranku” (DESIGN.md): przód z pocztowka() i znaczek z znaczek()
 * z apps/landing/src/ilustracje.ts, na odwrocie h1 czytane z apps/landing/index.html.
 * Po zmianie h1 albo pocztówki uruchom generator ponownie. Wymaga Node 22.18+ (import .ts).
 *
 * Użycie:  node scripts/og/generate.mjs
 */
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fontsDir = path.join(root, 'apps', 'landing', 'src', 'fonts');
const outDir = path.join(root, 'apps', 'landing', 'public');

async function fontFace(file, family, weight, style = 'normal') {
  const b64 = (await readFile(path.join(fontsDir, file))).toString('base64');
  return `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
}

/* Znak marki „Parawan" — kopia parawanMark() z apps/landing/src/icons.ts. */
function parawanMark(primary = '#0B3D2E', light = '#859E97') {
  const pole = (x, y1) =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y1 + 176}" stroke="${primary}" stroke-width="14" stroke-linecap="round"/>`;
  return (
    '<svg viewBox="14 48 292 235" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style="display:block;overflow:visible">' +
    `<polygon points="30,74 95,112 95,270 30,232" fill="${primary}"/>` +
    `<polygon points="95,112 160,74 160,232 95,270" fill="${light}"/>` +
    `<polygon points="160,74 225,112 225,270 160,232" fill="${primary}"/>` +
    `<polygon points="225,112 290,74 290,232 225,270" fill="${light}"/>` +
    `<path d="M30 74 L95 112 L160 74 L225 112 L290 74" fill="none" stroke="${primary}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` +
    pole(30, 56) + pole(95, 94) + pole(160, 56) + pole(225, 94) + pole(290, 56) +
    '</svg>'
  );
}

const fonts = [
  await fontFace('archivo-latin.woff2', 'Archivo', '100 900'),
  await fontFace('archivo-latinext.woff2', 'Archivo', '100 900'),
  await fontFace('plexmono-600-latin.woff2', 'IBM Plex Mono', '600'),
  await fontFace('plexmono-600-latinext.woff2', 'IBM Plex Mono', '600'),
  await fontFace('sourceserif4-latin.woff2', 'Source Serif 4', '400 600'),
  await fontFace('sourceserif4-latinext.woff2', 'Source Serif 4', '400 600'),
  await fontFace('sourceserif4-italic-latin.woff2', 'Source Serif 4', '400', 'italic'),
  await fontFace('sourceserif4-italic-latinext.woff2', 'Source Serif 4', '400', 'italic'),
].join('\n');

// Hasło karty = h1 strony (apps/landing/index.html), czytane przy każdym uruchomieniu.
const indexHtml = await readFile(path.join(root, 'apps', 'landing', 'index.html'), 'utf8');
const haslo = indexHtml.match(/<h1>([^<]+)<\/h1>/)?.[1];
if (!haslo) throw new Error('Brak <h1> w apps/landing/index.html');

// Przód pocztówki i znaczek „0 zł” z tych samych funkcji co strona (Node 24 czyta .ts bez kompilacji).
const { pocztowka, znaczek } = await import(pathToFileURL(path.join(root, 'apps', 'landing', 'src', 'ilustracje.ts')).href);
// kadr przodu: wielki parawan, słońce i dwie sosny na wydmie; prawy skraj (sam bór) odpada
const przod = pocztowka()
  .replace(/^<svg viewBox="0 0 1200 800"[^>]*>/, '<svg viewBox="40 0 1160 800" width="100%" height="100%" preserveAspectRatio="xMinYMid slice" aria-hidden="true">');

// Znaki kategorii, te same co na znacznikach strony (--kg w apps/landing/src/style.css).
const ZNAK = {
  ident: '<path fill="none" stroke="currentColor" stroke-width="1.6" d="M4.4 1 3.4 11M8.6 1l-1 10M1 4.2h10.4M.6 7.8H11"/>',
  person: '<circle cx="6" cy="3.4" r="2.6" fill="currentColor"/><path fill="currentColor" d="M.9 11.8c0-3.2 2.2-4.9 5.1-4.9s5.1 1.7 5.1 4.9z"/>',
  contact: '<path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" d="M1.6 1.6h8.8c.5 0 .8.3.8.8v5.4c0 .5-.3.8-.8.8H5.4L2.6 11V8.6h-1c-.5 0-.8-.3-.8-.8V2.4c0-.5.3-.8.8-.8z"/>',
  fin: '<rect x=".9" y="2.6" width="10.2" height="6.8" rx=".6" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="6" cy="6" r="1.7" fill="currentColor"/>',
  place: '<path fill="currentColor" fill-rule="evenodd" d="M6 .6l5.6 5H10v6H2v-6H.4zM4.9 7.6v4h2.2v-4z"/>',
};
// Paleta „u” z DESIGN.md: tekst, tło, pasek, obwódka.
const KAT = {
  person: ['#6B2D62', '#F3E5EF', '#4F2148', '#DECED9'],
  contact: ['#0B5C5E', '#DDEEEC', '#2F7F7C', '#C5D8D6'],
  ident: ['#7A4A06', '#F3ECDD', '#B9791F', '#DDD5C4'],
  fin: ['#2E4E1B', '#E6EDD9', '#34531F', '#CFD7C0'],
  place: ['#2C5689', '#E1EAF5', '#5F82B5', '#C9D4E0'],
};
// znacznik jak na stronie: zakładka z kartoteki, pasek z lewej, znak kategorii przed nazwą
const chip = (label, kat) => {
  const [t, b, s, l] = KAT[kat];
  return `<span class="lab" style="color:${t};background:${b};box-shadow:inset 5px 0 0 ${s},inset 0 0 0 1.5px ${l}"><svg viewBox="0 0 12 12" aria-hidden="true">${ZNAK[kat]}</svg>${label}</span>`;
};

const ogHtml = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><style>
${fonts}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1200px;height:630px;overflow:hidden;font-family:'Archivo',sans-serif;color:#0B3D2E;background:#DDE3DC;position:relative}
/* pocztówka lekko przekrzywiona na mgle, jak położona na stole */
.kartka{position:absolute;left:34px;top:30px;width:1132px;height:570px;background:#FAF8F2;display:flex;padding:14px;gap:0;
  box-shadow:0 1px 0 #C9D1C8,0 14px 30px -18px rgba(11,61,46,.45);transform:rotate(-.6deg)}
.przod{flex:none;width:676px;height:542px;overflow:hidden;background:#DCE3DD}
.odwrot{position:relative;flex:1;padding:20px 24px 16px 32px;display:flex;flex-direction:column}
.odwrot::before{content:'';position:absolute;left:0;top:26px;bottom:26px;border-left:1.5px solid #D6CDB8}
.marka{display:flex;align-items:center;gap:14px}
.marka .mk{width:52px;height:42px}
.marka b{font-family:'Source Serif 4',Georgia,serif;font-size:34px;font-weight:600;letter-spacing:-.01em}
.znaczek{position:absolute;right:26px;top:20px;width:76px;height:95px;transform:rotate(3deg)}
h1{font-family:'Source Serif 4',Georgia,serif;font-size:40px;font-weight:600;letter-spacing:-.018em;line-height:1.1;margin-top:30px;text-wrap:balance}
.chips{display:flex;flex-wrap:wrap;gap:8px 8px;margin-top:auto}
.lab{display:inline-flex;align-items:center;gap:8px;font-family:'IBM Plex Mono';font-weight:600;font-size:17px;line-height:1;padding:8px 11px 8px 13px;border-radius:2px 5px 5px 2px;white-space:nowrap}
.lab svg{width:16px;height:16px;flex:none}
.adres{margin-top:24px;display:flex;flex-direction:column;gap:10px}
.adres span{display:block;border-bottom:1.5px solid #D6CDB8;padding-bottom:6px;font-family:'IBM Plex Mono';font-weight:600;font-size:16px;color:#4A5A4F}
.adres span b{color:#0B3D2E;font-weight:600}
</style></head><body>
<div class="kartka">
  <div class="przod">${przod}</div>
  <div class="odwrot">
    <div class="marka"><span class="mk">${parawanMark()}</span><b>Parawan</b></div>
    <svg class="znaczek" viewBox="0 0 96 120" aria-hidden="true">${znaczek()}</svg>
    <h1>${haslo}</h1>
    <div class="chips">
      ${chip('PESEL', 'ident')}
      ${chip('IMIĘ I NAZWISKO', 'person')}
      ${chip('NR-KONTA', 'fin')}
      ${chip('ADRES', 'place')}
      ${chip('TELEFON', 'contact')}
    </div>
    <div class="adres"><span><b>parawan.karolwilczynski.com</b></span><span>jeden plik HTML, działa bez internetu</span></div>
  </div>
</div>
</body></html>`;

const iconHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0}
body{width:180px;height:180px;overflow:hidden;background:#F1EEE6;display:grid;place-items:center}
.mk{width:132px;height:118px}
</style></head><body><span class="mk">${parawanMark()}</span></body></html>`;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Brak pobranego Chromium w cache — użyj systemowego Chrome/Edge.
    try {
      return await chromium.launch({ channel: 'chrome' });
    } catch {
      return await chromium.launch({ channel: 'msedge' });
    }
  }
}

await mkdir(outDir, { recursive: true });
const browser = await launch();
try {
  const og = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await og.setContent(ogHtml, { waitUntil: 'networkidle' });
  await og.evaluate(() => document.fonts.ready);
  await writeFile(path.join(outDir, 'og.png'), await og.screenshot({ type: 'png' }));

  const icon = await browser.newPage({ viewport: { width: 180, height: 180 }, deviceScaleFactor: 1 });
  await icon.setContent(iconHtml, { waitUntil: 'networkidle' });
  await writeFile(path.join(outDir, 'apple-touch-icon.png'), await icon.screenshot({ type: 'png' }));
} finally {
  await browser.close();
}
console.log('Zapisano: apps/landing/public/og.png (1200×630) i apple-touch-icon.png (180×180)');
