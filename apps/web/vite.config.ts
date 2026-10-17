import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
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

export default defineConfig({
  // JEDEN samowystarczalny index.html (JS+CSS inline). Kluczowe dla użycia z dysku:
  // Chromium blokuje <script type="module"> i <link crossorigin> na file:// (CORS,
  // origin null), więc rozbite assety NIE działają po podwójnym kliknięciu.
  plugins: [viteSingleFile(), cspMeta],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  build: {
    // WSZYSTKIE assety MUSZĄ być inline (data:) — osobny plik assetu złamałby file://
    // (Chromium blokuje pobocze przy origin null). Limit obejmuje też fonty marki
    // (Archivo ~35 kB/podzbiór, IBM Plex Mono ~15 kB/waga) — stąd zapas 256 kB.
    assetsInlineLimit: 262144,
  },
  resolve: {
    alias: {
      // Importujemy rdzeń bezpośrednio ze źródeł TS — dev/build nie wymaga
      // wcześniejszego `npm run build` w packages/core.
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
