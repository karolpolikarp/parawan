import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// Content-Security-Policy strony, bliźniacza do polityki aplikacji (apps/web/vite.config.ts,
// tam pełne uzasadnienie). Jedyna różnica to img-src 'self': <link rel="apple-touch-icon">
// wskazuje plik PNG obok strony (public/), a nie data:. Dyrektywa frame-ancestors w meta jest
// ignorowana, więc jej tu nie ma.
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ');

// Tylko przy buildzie (w źródłowym index.html meta zablokowałaby `vite dev`), tuż po
// <meta charset>, z dosłownymi apostrofami: szczegóły jak w apps/web/vite.config.ts.
const cspMeta: Plugin = {
  name: 'parawan-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const charset = /<meta charset="UTF-8"\s*\/?>/i;
    if (!charset.test(html)) throw new Error('parawan-csp: w index.html brak <meta charset>, nie ma gdzie wstawić CSP');
    return html.replace(charset, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

// Najstarsze przeglądarki, dla których build obniża składnię JS i CSS, jak w aplikacji
// (apps/web/vite.config.ts, tam pełne uzasadnienie). 109 to ostatnie Chrome i Edge dla Windows 7,
// 8.1 i Server 2012 R2, 115 to ostatni Firefox ESR dla Windows 7 i 8.1: strona z demo ma działać
// tam, gdzie działa Parawan.html. Podniesienie wymaga zmiany DLA-IOD-I-IT.txt i testu na
// Chromium 109.
const BUILD_TARGET = ['chrome109', 'edge109', 'firefox115', 'safari16.4'];

// Landing „Parawan" — JEDEN samowystarczalny index.html (JS+CSS+fonty+SVG inline).
// Świadomie ta sama filozofia co narzędzie (apps/web): strona nie robi ŻADNYCH żądań
// do serwerów firm trzecich — to weryfikowalna obietnica (DevTools → Network: 0 żądań),
// a plik działa też z file:// po podwójnym kliknięciu.
export default defineConfig({
  plugins: [viteSingleFile(), cspMeta],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  build: {
    target: BUILD_TARGET,
    cssTarget: BUILD_TARGET,
    // Fonty marki (Archivo ~35 kB/podzbiór, IBM Plex Mono ~15 kB/waga) muszą trafić inline.
    assetsInlineLimit: 262144,
  },
  resolve: {
    alias: {
      // Live demo importuje silnik redakcji PROSTO ze źródeł rdzenia — bez pre-buildu
      // packages/core (jak apps/web). Vite wtapia go do jednego pliku.
      anonimizator: fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
});
