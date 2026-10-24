import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspSkrot } from '../web/src/csp-skrot';
import { stronaLogu } from './src/log-strona';
import { wstawWydanie, wydanieZEnv } from './src/wydanie';

// Content-Security-Policy strony, bliźniacza do polityki aplikacji (apps/web/vite.config.ts,
// tam pełne uzasadnienie). Jedyna różnica to img-src 'self': <link rel="apple-touch-icon">
// wskazuje plik PNG obok strony (public/), a nie data:. Dyrektywa frame-ancestors w meta jest
// ignorowana, więc jej tu nie ma. „script-src 'unsafe-inline'” podmienia przy buildzie wtyczka
// cspSkrot (wspólna z aplikacją) na SHA-256 skryptu strony. Domena idzie przez proxy Cloudflare,
// więc skrypt wstrzyknięty w linii po drodze przeglądarka też odrzuci.
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

// Suma SHA-256 i wersja najnowszego wydania w metryczce #pobierz i w punkcie 5 „Jak sprawdzić”.
// Podaje je deploy-landing.yml (PARAWAN_SHA256, PARAWAN_VERSION) po sprawdzeniu SHA256SUMS.txt;
// lokalnie strona odsyła do strony wydania. Szczegóły w src/wydanie.ts.
const wydanieMeta: Plugin = {
  name: 'parawan-wydanie',
  apply: 'build',
  transformIndexHtml(html) {
    return wstawWydanie(html, wydanieZEnv(process.env));
  },
};

// Podstrona /log/ (dist/log/index.html): dziennik zmian z CHANGELOG.md i plan z ROADMAP.md,
// złożone w src/log-strona.ts. Bez skryptu, więc w CSP script-src 'none' zamiast skrótu. Style
// i fonty (data:) bierze z gotowego index.html, kiedy jest już na dysku (writeBundle, po
// viteSingleFile i cspSkrot), żeby obie strony miały te same bajty fontów. Brak ROADMAP.md nie
// psuje builda: zakładka „Plan” mówi wtedy, że planu jeszcze nie ma.
const KORZEN = fileURLToPath(new URL('../..', import.meta.url));
const CSP_LOG = CSP.replace("script-src 'unsafe-inline'", "script-src 'none'");
const logStrona: Plugin = {
  name: 'parawan-log',
  apply: 'build',
  writeBundle(opts, bundle) {
    const index = bundle['index.html'];
    if (!index || index.type !== 'asset') throw new Error('parawan-log: w paczce nie ma index.html');
    const html = typeof index.source === 'string' ? index.source : new TextDecoder().decode(index.source);
    const style = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    const ikona = html.match(/<link rel="icon"[^>]*>/)?.[0];
    if (!style || !ikona) throw new Error('parawan-log: w index.html brak <style> albo <link rel="icon">');
    const czytaj = (plik: string): string | null => {
      const p = path.join(KORZEN, plik);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
    const changelog = czytaj('CHANGELOG.md');
    if (!changelog) throw new Error('parawan-log: brak CHANGELOG.md w katalogu repozytorium');
    const strona = stronaLogu({
      changelog,
      roadmap: czytaj('ROADMAP.md'),
      style,
      styleLogu: readFileSync(new URL('./src/log.css', import.meta.url), 'utf8'),
      csp: CSP_LOG,
      ikona,
    });
    const dir = path.join(opts.dir ?? path.join(KORZEN, 'apps/landing/dist'), 'log');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'index.html'), strona);
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
  // cspSkrot na końcu: liczy skrót skryptu już wklejonego przez viteSingleFile. logStrona pisze
  // swój plik w writeBundle, czyli i tak po cspSkrot (generateBundle), z gotowego index.html.
  plugins: [viteSingleFile(), cspMeta, wydanieMeta, logStrona, cspSkrot()],
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
