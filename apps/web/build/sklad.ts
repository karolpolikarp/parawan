// Skład gotowego pliku: z czego składa się Parawan.html i ile bajtów wnosi każdy moduł po
// minifikacji. Wynik trafia do apps/web/dist/sklad.json, a reguły na nim sprawdza
// scripts/e2e/sklad.test.mjs (bez duplikatów modułów, tylko dozwolone pakiety, pdf.js nie większy
// niż jego własny zminifikowany build). Sumy bajtów pliku tu się nie pilnuje: rozrost kodu
// wykonywanego łapie pomiar czasu startu (scripts/perf), a twardy sufit test poczty w smoke.test.mjs.
//
// Bajty liczymy z mapy źródeł: build ma sourcemap: 'hidden' (vite.config.ts), wtyczka działa
// przed viteSingleFile (enforce: 'pre'), czyta mapę każdego fragmentu JS i usuwa plik .map
// z paczki, zanim cokolwiek trafi na dysk. Mapa „hidden” nie dopisuje do kodu komentarza
// sourceMappingURL, więc index.html jest bajt w bajt taki sam jak bez mapy (powtarzalność wydania
// w release.yml), a do dist ani do wydania nie trafia żaden .map.
//
// Moduł nie trafia do aplikacji: używa go tylko vite.config.ts (Node), więc może importować node:.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Jeden segment pola mappings (Base64 VLQ, specyfikacja Source Map v3) jako liczby. */
function vlq(segment: string): number[] {
  const out: number[] = [];
  let value = 0;
  let shift = 0;
  for (const ch of segment) {
    const digit = B64.indexOf(ch);
    if (digit < 0) throw new Error(`parawan-sklad: zły znak „${ch}” w mapie źródeł`);
    value += (digit & 31) << shift;
    if (digit & 32) {
      shift += 5;
    } else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
}

/** Klucz dla kodu bez mapowania (łączniki bundla, kod pomocniczy Rolldown). */
export const BEZ_MAPY = '(bez mapy)';

/**
 * Bajty UTF-8 kodu przypisane do źródeł z mapy. Kolumny w mapie liczą się w jednostkach UTF-16,
 * więc długość wycinka liczy Buffer.byteLength, a nie różnica kolumn (polskie litery w słownikach
 * mają po dwa bajty).
 */
export function bajtyZMapy(code: string, mappings: string, sources: string[]): Map<string, number> {
  const per = new Map<string, number>();
  const add = (k: string, n: number) => per.set(k, (per.get(k) ?? 0) + n);
  const lines = code.split('\n');
  const mapLines = mappings.split(';');
  let src = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const segs = mapLines[li] ? mapLines[li].split(',').filter(Boolean).map(vlq) : [];
    // Znak nowego wiersza doliczamy do ostatniego segmentu wiersza.
    const nl = li + 1 < lines.length ? 1 : 0;
    if (!segs.length) {
      add(BEZ_MAPY, Buffer.byteLength(line) + nl);
      continue;
    }
    let col = 0;
    const pts: [number, number][] = [];
    for (const s of segs) {
      col += s[0];
      if (s.length > 1) {
        src += s[1];
        pts.push([col, src]);
      } else {
        pts.push([col, -1]);
      }
    }
    add(BEZ_MAPY, Buffer.byteLength(line.slice(0, pts[0][0])));
    pts.forEach(([c, s], i) => {
      const end = i + 1 < pts.length ? pts[i + 1][0] : line.length;
      const n = Buffer.byteLength(line.slice(c, end)) + (i + 1 === pts.length ? nl : 0);
      add(s < 0 ? BEZ_MAPY : sources[s], n);
    });
  }
  return per;
}

/** Ścieżka względem katalogu repozytorium, z ukośnikami. Moduły wirtualne bez zmian (bez \0). */
function wzgledna(root: string, id: string): string {
  const clean = id.replace(/^\0/, '');
  if (!path.isAbsolute(clean)) return clean.split('\\').join('/');
  return path.relative(root, clean).split('\\').join('/');
}

/** Grupa modułu w podsumowaniu (tylko do odczytu przez człowieka, bez progów). */
export function grupa(id: string): string {
  if (id === BEZ_MAPY) return 'łączniki bundla bez mapowania';
  if (id.includes('node_modules/pdfjs-dist/') && id.endsWith('pdf.worker.mjs')) return 'pdf.js worker';
  if (id.includes('node_modules/pdfjs-dist/')) return 'pdf.js główny';
  if (/^packages\/core\/src\/(dict\/|surnames\.ts$)/.test(id)) return 'rdzeń: słowniki';
  if (id.startsWith('packages/core/')) return 'rdzeń: reguły';
  if (id.startsWith('apps/web/')) return 'aplikacja';
  const pkg = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (pkg) return pkg[1];
  return 'inne';
}

type Chunk = {
  type: 'chunk';
  fileName: string;
  code: string;
  map: { mappings: string; sources: string[]; sourceRoot?: string } | null;
  modules: Record<string, unknown>;
};
type Asset = { type: 'asset'; fileName: string };

/**
 * Wtyczka Vite: pierwsza w kolejce generateBundle (enforce 'pre', przed viteSingleFile, który
 * wkleja fragmenty JS do index.html i usuwa je z paczki).
 * @param repoRoot katalog repozytorium, względem którego zapisujemy ścieżki modułów
 */
export function sklad(repoRoot: string): Plugin {
  let outDir = '';
  /** Moduły paczki w kolejności Rolldown; ten sam moduł pod dwiema ścieżkami zostaje dwa razy. */
  let ids: string[] = [];
  let zrodla = new Map<string, number>();
  let bajtyJs = 0;
  return {
    name: 'parawan-sklad',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_opts, bundle) {
      ids = [];
      zrodla = new Map();
      bajtyJs = 0;
      const files = bundle as unknown as Record<string, Chunk | Asset>;
      for (const [name, f] of Object.entries(files)) {
        if (f.type !== 'chunk') continue;
        if (!f.map) throw new Error(`parawan-sklad: ${name} bez mapy źródeł (build.sourcemap: 'hidden' w vite.config.ts)`);
        bajtyJs += Buffer.byteLength(f.code);
        const dir = path.dirname(path.join(outDir, f.fileName));
        const sources = f.map.sources.map((s) =>
          wzgledna(repoRoot, path.resolve(dir, f.map?.sourceRoot ?? '', s)),
        );
        for (const id of Object.keys(f.modules)) ids.push(wzgledna(repoRoot, id));
        for (const [src, n] of bajtyZMapy(f.code, f.map.mappings, sources)) {
          zrodla.set(src, (zrodla.get(src) ?? 0) + n);
        }
      }
      // Mapy źródeł służą tylko do tego pomiaru: nie trafiają na dysk ani do wydania.
      for (const name of Object.keys(files)) if (name.endsWith('.map')) delete files[name];
    },
    writeBundle() {
      const html = readFileSync(path.join(outDir, 'index.html'));
      // Bajty modułu z mapy; moduł bez kodu w paczce (np. sam CSS) ma 0. Dwa wpisy tego samego
      // modułu (różna pisownia ścieżki) dostają te same bajty: regułę duplikatów sprawdza test.
      const klucz = (id: string) => id.toLowerCase();
      const poKluczu = new Map([...zrodla].map(([k, n]) => [klucz(k), n]));
      const lista = ids.map((id) => ({ id, bajty: poKluczu.get(klucz(id)) ?? 0 }));
      const bezMapy = zrodla.get(BEZ_MAPY) ?? 0;
      const grupy: Record<string, number> = {};
      for (const { id, bajty } of new Map(lista.map((m) => [klucz(m.id), m])).values()) {
        grupy[grupa(id)] = (grupy[grupa(id)] ?? 0) + bajty;
      }
      grupy[grupa(BEZ_MAPY)] = bezMapy;
      // Poza skryptem: HTML, CSS i fonty w data: (bez podziału, przybliżenie po różnicy).
      grupy['HTML, CSS i fonty (poza skryptem)'] = html.length - bajtyJs;
      // Źródła z mapy, których nie ma na liście modułów, byłyby kodem nie do przypisania.
      const znane = new Set(lista.map((m) => klucz(m.id)));
      const obce = [...zrodla.keys()].filter((k) => k !== BEZ_MAPY && !znane.has(klucz(k)));
      writeFileSync(
        path.join(outDir, 'sklad.json'),
        `${JSON.stringify(
          {
            sha256: createHash('sha256').update(html).digest('hex'),
            bajty: html.length,
            bajtyJs,
            bezMapy,
            grupy,
            zrodlaSpozaModulow: obce,
            moduly: lista,
          },
          null,
          1,
        )}\n`,
      );
    },
  };
}
