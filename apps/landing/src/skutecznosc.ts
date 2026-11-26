/**
 * Rzędy parawanów w sekcji „Skuteczność” (#skutecznosc): jeden pasek na każdy fragment zbioru
 * z docs/BENCHMARK.md. Liczby czyta ten sam wzorzec co apps/web/src/landing.test.ts, więc nowy
 * pomiar zmienia obraz przy następnym buildzie. Moduł bez DOM, woła go vite.config.ts.
 */
import { plural } from './wynik';

export interface Benchmark {
  /** fragmenty, które miały zniknąć, i te, które zniknęły */
  mustMask: number;
  hit: number;
  /** fragmenty, które miały zostać, i te, które zostały */
  mustKeep: number;
  kept: number;
}

export function liczbyBenchmarku(md: string): Benchmark {
  const row = md.match(/\| T0\+T1 core \| [\d.]+% \((\d+)\/(\d+)\) \| [\d.]+% \((\d+)\/(\d+)\) \|/);
  if (!row) throw new Error('parawan-tresc: w docs/BENCHMARK.md brak wiersza „T0+T1 core”');
  const [hit, mustMask, kept, mustKeep] = row.slice(1).map(Number);
  return { hit, mustMask, kept, mustKeep };
}

const f1 = (n: number): number => Math.round(n * 10) / 10;

function los(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

interface Wymiar {
  w?: number;
  h?: number;
  odst?: number;
  zw?: number;
  kw?: number;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Rzędy pasków: każdy rząd to jeden prostokąt z deseniem w dwóch odcieniach, osobno kreskowane
 * paski błędów i kije parawanu na końcach. Błąd ma kreskowanie z obwódką, nigdy sam kolor.
 */
export function rzedy(n: number, zle: number, seed: number, tryb: 'A' | 'B', opis: string, naRzad: number, klasa: string, wym: Wymiar = {}): string {
  const { w = 4, h = 24, odst = 16, kw = 4 } = wym;
  const zw = wym.zw ?? w;
  const R = los(seed);
  const wyb = new Set<number>();
  while (wyb.size < zle) wyb.add(Math.floor(R() * n));
  const ile = Math.ceil(n / naRzad);
  const id = `ds-${tryb}${naRzad}`;
  const [c1, c2] = tryb === 'A' ? ['p-a', 'p-a2'] : ['p-b', 'p-b2'];
  let s = `<defs><pattern id="${id}" width="${2 * w}" height="${h}" patternUnits="userSpaceOnUse" x="4"><rect class="${c1}" width="${w}" height="${h}"/><rect class="${c2}" x="${w}" width="${w}" height="${h}"/></pattern><pattern id="${id}z" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#FAF8F2"/><rect width="1.6" height="4" fill="#0B3D2E"/></pattern></defs>`;
  for (let r = 0; r < ile; r++) {
    const y = r * (h + odst);
    const k0 = r * naRzad;
    const kn = Math.min(naRzad, n - k0);
    // rząd w osobnej grupie: przy wejściu w kadr rzędy rozstawiają się po kolei (style.css, .rz)
    s += `<g class="rzad" style="--r:${r}"><rect fill="url(#${id})" x="4" y="${y}" width="${kn * w}" height="${h}"/>`;
    for (let k = 0; k < kn; k++) {
      if (wyb.has(k0 + k)) {
        s += `<rect class="p-zly" fill="url(#${id}z)" x="${f1(4 + k * w + w / 2 - zw / 2 - 1.5)}" y="${y - 6}" width="${zw + 3}" height="${h + 12}"/>`;
      }
    }
    s += `<rect class="kij" x="${4 - kw}" y="${y - 7}" width="${kw}" height="${h + 11}" rx="${kw / 2}"/><rect class="kij" x="${4 + kn * w}" y="${y - 7}" width="${kw}" height="${h + 11}" rx="${kw / 2}"/></g>`;
  }
  const W = 4 + kw + naRzad * w;
  const H = ile * (h + odst) - odst + 8;
  return `<svg class="rzedy ${klasa}" viewBox="${-1 - (kw - 4)} -8 ${W + 2 + (kw - 4)} ${H + 6}" role="img" aria-label="${esc(opis)}">${s}</svg>`;
}

/** Opisy obrazów dla czytnika ekranu (liczby z pomiaru, z odmianą po liczebniku). */
export function opisyRzedow(b: Benchmark): { a: string; b: string } {
  const przeszlo = b.mustMask - b.hit;
  const nadmiar = b.mustKeep - b.kept;
  const jasne = (n: number): string => `${n} ${plural(n, 'jasny kreskowany', 'jasne kreskowane', 'jasnych kreskowanych')}`;
  return {
    a:
      `Rzędy parawanów z ${b.mustMask} pasków: ${b.hit} ${plural(b.hit, 'zielony', 'zielone', 'zielonych')}, czyli zasłoniętych, ` +
      `i ${jasne(przeszlo)}, czyli przepuszczonych.`,
    b:
      `Rzędy z ${b.mustKeep} pasków: ${b.kept} ${plural(b.kept, 'szarozielony', 'szarozielone', 'szarozielonych')}, czyli pozostawionych, ` +
      `i ${jasne(nadmiar)}, ${plural(nadmiar, 'zasłonięty', 'zasłonięte', 'zasłoniętych')} bez potrzeby.`,
  };
}

/** Podmienia `<!--IL:RZEDY-A-->` i `<!--IL:RZEDY-B-->` na rzędy policzone z docs/BENCHMARK.md. */
export function wstawSkutecznosc(html: string, benchmarkMd: string): string {
  const b = liczbyBenchmarku(benchmarkMd);
  const o = opisyRzedow(b);
  // szeroki ekran: rzędy po 172 paski; telefon: węższe rzędy, w B jeden długi rząd cienkich pasków
  const wA =
    rzedy(b.mustMask, b.mustMask - b.hit, 7, 'A', o.a, 172, 'rz-szer') +
    rzedy(b.mustMask, b.mustMask - b.hit, 7, 'A', o.a, 100, 'rz-waski', { w: 4, h: 22, odst: 10 });
  const wB =
    rzedy(b.mustKeep, b.mustKeep - b.kept, 11, 'B', o.b, 172, 'rz-szer') +
    rzedy(b.mustKeep, b.mustKeep - b.kept, 11, 'B', o.b, 400, 'rz-waski', { w: 1, h: 30, odst: 8, zw: 6, kw: 6 });
  let out = html;
  for (const [marker, svg] of [
    ['<!--IL:RZEDY-A-->', wA],
    ['<!--IL:RZEDY-B-->', wB],
  ] as const) {
    const n = out.split(marker).length - 1;
    if (n !== 1) throw new Error(`parawan-tresc: znacznik ${marker} występuje ${n} razy zamiast raz`);
    out = out.replace(marker, () => svg);
  }
  return out;
}
