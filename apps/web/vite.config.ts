import { defineConfig, normalizePath, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Content-Security-Policy gotowego pliku. Obietnicę „tekst nie opuszcza przeglądarki” pilnuje
// wtedy sama przeglądarka, a nie tylko nasz kod: connect-src 'none' blokuje fetch, XHR,
// WebSocket i sendBeacon, a default-src 'none' każdy zasób spoza pliku. Przyszła zależność
// z żądaniem sieciowym albo font z URL-em w CSS skończą się błędem w konsoli, nie cichym
// wyciekiem. Wszystko, czego aplikacja potrzebuje, jest w środku: skrypt i style inline,
// fonty i ikony jako data:. pdf.js działa na „fake workerze” w głównym wątku (pdf.ts), więc
// worker-src nie jest potrzebny. Bliźniacza polityka landingu: apps/landing/vite.config.ts.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

// Meta z polityką wstrzykujemy TYLKO przy buildzie. W źródłowym index.html zablokowałaby
// `vite dev` (moduły z serwera, HMR przez WebSocket). Stawiamy ją tuż po <meta charset>,
// czyli przed inline'owym skryptem, z dosłownymi apostrofami (tagi z transformIndexHtml
// Vite koduje jako &#39;), żeby dział IT przeczytał ją w źródle wprost, a strażnik w CI
// (ci.yml) znalazł ją zwykłym grepem.
const cspMeta: Plugin = {
  name: 'parawan-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const charset = /<meta charset="UTF-8"\s*\/?>/i;
    if (!charset.test(html)) throw new Error('parawan-csp: w index.html brak <meta charset>, nie ma gdzie wstawić CSP');
    return html.replace(charset, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

// Data pliku w nagłówku („wersja 0.46.25 · 17.10.2026”) i podstawa notki o wieku pliku
// (src/file-age.ts). Data ostatniego commita, nie bieżący czas: dwa buildy z tego samego commita
// muszą mieć tę samą sumę SHA-256 (strażnik powtarzalności w release.yml), a pliki wydania
// dostają tę samą datę w {{DATA}} (scripts/release/render-docs.mjs). Bez gita (np. build
// z archiwum) data z SOURCE_DATE_EPOCH, a bez niej 'dev', przy którym nagłówek nie ma daty.
function buildDate(): string {
  try {
    const d = execFileSync('git', ['log', '-1', '--format=%cs'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  } catch {
    // brak gita albo katalog spoza repozytorium: niżej SOURCE_DATE_EPOCH
  }
  const epoch = Number(process.env.SOURCE_DATE_EPOCH);
  if (process.env.SOURCE_DATE_EPOCH && Number.isFinite(epoch)) return new Date(epoch * 1000).toISOString().slice(0, 10);
  return 'dev';
}

// Najstarsze przeglądarki, dla których build obniża składnię JS i CSS. 109 to ostatnie Chrome
// i Edge dla Windows 7, 8.1 i Server 2012 R2, 115 to ostatni Firefox ESR dla Windows 7 i 8.1.
// Przypięte, bo domyślny cel Vite rośnie z wersją (Vite 8: chrome111, firefox114) i po cichu
// wyłączyłby te komputery. Podniesienie wymaga zmiany DLA-IOD-I-IT.txt i testu na Chromium 109
// (scripts/e2e/manual/README.md). Build obniża tylko składnię, a nie API: nowsze API i CSS
// zatrzymuje strażnik w src/content.test.ts. Ta sama lista: apps/landing/vite.config.ts.
const BUILD_TARGET = ['chrome109', 'edge109', 'firefox115', 'safari16.4'];

export default defineConfig({
  // JEDEN samowystarczalny index.html (JS+CSS inline). Kluczowe dla użycia z dysku:
  // Chromium blokuje <script type="module"> i <link crossorigin> na file:// (CORS,
  // origin null), więc rozbite assety NIE działają po podwójnym kliknięciu.
  plugins: [viteSingleFile(), cspMeta],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
    __BUILD_DATE__: JSON.stringify(buildDate()),
  },
  build: {
    target: BUILD_TARGET,
    cssTarget: BUILD_TARGET,
    // WSZYSTKIE assety MUSZĄ być inline (data:) — osobny plik assetu złamałby file://
    // (Chromium blokuje pobocze przy origin null). Limit obejmuje też fonty marki
    // (Archivo ~35 kB/podzbiór, IBM Plex Mono ~15 kB/waga) — stąd zapas 256 kB.
    assetsInlineLimit: 262144,
  },
  resolve: {
    // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
    // wcześniejszego `npm run build` w packages/core. Aliasy z dokładnym dopasowaniem: klucz
    // „anonimizator” w formie obiektu działa jak prefiks i przechwyciłby „anonimizator/surnames”
    // (ścieżka …/index.ts/surnames). Słownik nazwisk (normalizeSurnameKey dla ręcznej korekty,
    // corrections.ts) to ten sam moduł, który i tak wchodzi do pliku razem z rdzeniem. normalizePath:
    // na Windows ścieżka z ukośnikami wstecznymi byłaby dla Vite innym modułem niż import
    // „./surnames” z index.ts i słownik trafiłby do pliku dwa razy.
    alias: [
      {
        find: /^anonimizator\/surnames$/,
        replacement: normalizePath(fileURLToPath(new URL('../../packages/core/src/surnames.ts', import.meta.url))),
      },
      {
        find: /^anonimizator$/,
        replacement: normalizePath(fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))),
      },
    ],
  },
});
