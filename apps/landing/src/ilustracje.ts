/**
 * Ilustracje strony („Sosna o poranku”) jako SVG składane przy buildzie (wtyczka parawanTresc
 * w vite.config.ts). Płaskie płaszczyzny, raster offsetowy na słońcu, ziarno papieru. Czyste
 * funkcje z ziarnem losowania: ten sam build daje ten sam obraz. Moduł nie wchodzi do paczki JS
 * strony (main.ts go nie importuje), więc obrazy są w HTML od razu, także bez JavaScriptu.
 *
 * Paleta: sosna #0B3D2E/#1C5A45/#2E6B55, bursztyn #B9791F/#E0A84A/#7E5012, niebo #DCE3DD→#F4E8D3,
 * słońce #F0CB97 z rastrem, mgła #F1EEE6, cypel #B3C3B9, bór #9EB3A7, morze #8AA396/#A8BBB0,
 * wydma #D9CDB0/#E5D9BF, plaża #ECE4D2. Perspektywa powietrzna: im dalej, tym jaśniej i chłodniej.
 */

type Pkt = [number, number];
type Los = () => number;

let DOKL = 10;
const f = (n: number): number => Math.round(n * DOKL) / DOKL;

// sąsiednie wielokąty w tym samym kolorze łączy w jedną ścieżkę (mniej bajtów, ten sam obraz)
const scal = (svg: string): string =>
  svg.replace(/(?:<polygon points="[^"]+" fill="#[0-9A-F]{6}"\/>)+/g, (blok) => {
    let wy = '';
    let kol: string | null = null;
    let d = '';
    for (const [, pk, c] of blok.matchAll(/<polygon points="([^"]+)" fill="(#[0-9A-F]{6})"\/>/g)) {
      if (c !== kol) {
        if (kol) wy += `<path d="${d}" fill="${kol}"/>`;
        kol = c;
        d = '';
      }
      d += `M${pk}Z`;
    }
    return `${wy}<path d="${d}" fill="${kol}"/>`;
  });

const los = (seed: number): Los => {
  let z = seed;
  return () => {
    z = (z * 16807) % 2147483647;
    return z / 2147483647;
  };
};

// Kępa igieł: spłaszczona, poszarpana płaszczyzna. Górna krawędź z drobnymi zębami (igły), dolna
// płaska i ząbkowana, całość ścięta przez wiatr w stronę lądu (wierzch przesunięty w prawo).
function kepaPkt(cx: number, cy: number, w: number, h: number, R: Los, n: number, wiatr: number): Pkt[] {
  const p: Pkt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const gora = Math.sin(a) < 0;
    const k = i % 2 ? 1 : (gora ? 0.74 : 0.86) + R() * 0.12;
    let x = cx + ((Math.cos(a) * w) / 2) * k;
    const y = cy + Math.sin(a) * (gora ? h * 0.62 : h * 0.36) * k;
    x += (cy - y) * wiatr;
    p.push([x, y]);
  }
  return p;
}

const poly = (p: Pkt[], kol: string): string =>
  `<polygon points="${p.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" fill="${kol}"/>`;

function kepa(cx: number, cy: number, w: number, h: number, R: Los, kol: string, jas: string | null, n = 26, wiatr = 0.35): string {
  // główna płaszczyzna + boczny płat, żeby obrys nie był symetryczną soczewką
  const st = R() > 0.4 ? 1 : -1;
  const p = kepaPkt(cx, cy, w, h, R, n, wiatr);
  const q = kepaPkt(cx + st * w * 0.32, cy - h * 0.2, w * 0.55, h * 0.8, R, Math.max(10, n - 8), wiatr);
  let o = poly(p, kol) + poly(q, kol);
  // jaśniejsza płaszczyzna od strony słońca (w lewo), węższa
  if (jas) o += poly(p.map(([x, y]): Pkt => [cx + (x - cx) * 0.78 - w * 0.07, cy + (y - cy) * 0.62 - h * 0.2]), jas);
  return o;
}

// Sosna zwyczajna: pień wygięty od wiatru, dołem ciemny, górą rdzawy; gałęzie głównie na zawietrzną,
// na nich asymetryczne kępy igieł. Przepis: [t na pniu, strona, długość, wznios, szer. kępy, wys. kępy].
const PRZEPISY: number[][][] = [
  [
    [0.58, -1, 0.2, 0.05, 0.3, 0.1],
    [0.66, 1, 0.3, 0.1, 0.4, 0.13],
    [0.76, 1, 0.2, 0.06, 0.34, 0.11],
    [0.84, -1, 0.14, 0.08, 0.3, 0.1],
    [0.93, 1, 0.2, 0.06, 0.44, 0.14],
    [1, 1, 0.06, 0.02, 0.32, 0.11],
  ],
  [
    [0.62, 1, 0.26, 0.04, 0.36, 0.12],
    [0.7, -1, 0.16, 0.08, 0.28, 0.1],
    [0.8, 1, 0.3, 0.12, 0.44, 0.14],
    [0.9, -1, 0.08, 0.06, 0.3, 0.11],
    [1, 1, 0.12, 0.03, 0.5, 0.15],
  ],
];

interface KolSosny {
  igly?: string;
  jas?: string | null;
  dol?: string;
  gora?: string;
  galaz?: string;
}

function sosna(x: number, y: number, h: number, s: number, wyg: number, nr: number, seed: number, kol: KolSosny = {}): string {
  const { igly = '#0B3D2E', jas = '#2E6B55', dol = '#072A20', gora = '#B9791F', galaz = '#7E5012' } = kol;
  const R = los(seed);
  const tx = x + wyg;
  const ty = y - h;
  const kx = x - wyg * 0.35;
  const ky = y - h * 0.55;
  const pkt = (t: number): Pkt => [
    (1 - t) ** 2 * x + 2 * (1 - t) * t * kx + t * t * tx,
    (1 - t) ** 2 * y + 2 * (1 - t) * t * ky + t * t * ty,
  ];
  const pien = (t0: number, t1: number, kolor: string): string => {
    const L: Pkt[] = [];
    const P: Pkt[] = [];
    for (let i = 0; i <= 8; i++) {
      const t = t0 + ((t1 - t0) * i) / 8;
      const [px, py] = pkt(t);
      const gr = (3.6 - 2.4 * t) * s;
      L.push([px - gr, py]);
      P.unshift([px + gr, py]);
    }
    return poly(L.concat(P), kolor);
  };
  let o = pien(0, 1, dol) + pien(0.46, 1, gora);
  let galezie = '';
  let korona = '';
  for (const [t, st, dl, wz, cw, ch] of PRZEPISY[nr]) {
    const [px, py] = pkt(t);
    const ex = px + st * dl * h * (st > 0 ? 1 : 0.8);
    const ey = py - wz * h;
    galezie += `M${f(px)} ${f(py)} Q ${f((px + ex) / 2)} ${f(py - wz * h * 0.2)} ${f(ex)} ${f(ey)} `;
    korona += kepa(ex + st * cw * h * 0.12, ey - ch * h * 0.1, cw * h, ch * h * 1.3, R, igly, jas);
  }
  o += `<path d="${galezie}" stroke="${galaz}" stroke-width="${f(2.2 * s)}" stroke-linecap="round" fill="none"/>`;
  return o + scal(korona);
}

// Bór: nieregularna, zębata linia koron na różnych wysokościach, gołe pnie pod spodem.
function bor(
  x0: number,
  x1: number,
  podst: number,
  gora: (x: number) => number,
  rozrzut: number,
  seed: number,
  kolKor: string,
  kolPien: string,
  grPien: number,
  skala = 1,
  n = 18,
): string {
  const R = los(seed);
  let pnie = '';
  let kor = '';
  for (let x = x0; x < x1; ) {
    const top = gora(x) - R() * rozrzut;
    const lean = (R() - 0.3) * 6 * skala;
    const gl = (34 + R() * 22) * skala;
    pnie += `M${f(x)} ${podst} L${f(x + lean)} ${f(top + 6 * skala)} `;
    const k = 2 + Math.floor(R() * 2.4);
    for (let j = 0; j < k; j++) {
      const w = (26 + R() * 26) * skala;
      const hh = w * (0.32 + R() * 0.1);
      kor += kepa(x + lean + (R() - 0.3) * 16 * skala, top + (j / k) * gl * 0.7 + R() * 5 * skala, w, hh, R, kolKor, null, n, 0.3);
    }
    x += (14 + R() * 16) * skala;
  }
  return `<path d="${pnie}" stroke="${kolPien}" stroke-width="${grPien}" fill="none"/>${scal(kor)}`;
}

// Parawan w perspektywie: n paneli zygzakiem, dwa desenie płótna.
function parawan(x0: number, y0: number, krok: number, h: number, n: number, uskok: number, desen: string, desen2: string, cien: string, kij: string, gr: number): string {
  let pan = '';
  let kije = '';
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + i * krok);
  const ys = xs.map((_, i) => y0 + (i % 2) * uskok);
  const sz = `<polygon points="${xs[0] + h * 0.5},${ys[0] + h} ${xs[n] + h * 0.9},${ys[n] + h + 18} ${xs[n] + 4},${ys[n] + h} ${xs[0] + 4},${ys[0] + h}" fill="${cien}"/>`;
  for (let i = 0; i < n; i++) {
    const p = `${xs[i]},${ys[i]} ${xs[i + 1]},${ys[i + 1]} ${xs[i + 1]},${ys[i + 1] + h} ${xs[i]},${ys[i] + h}`;
    pan += `<polygon points="${p}" fill="url(#${i % 2 ? desen2 : desen})"/>`;
  }
  pan += `<polyline points="${xs.map((x, i) => `${x},${ys[i]}`).join(' ')}" fill="none" stroke="${kij}" stroke-width="${f(gr * 0.55)}" stroke-linejoin="round"/>`;
  xs.forEach((x, i) => {
    kije += `<line x1="${x}" y1="${ys[i] - gr * 1.6}" x2="${x}" y2="${ys[i] + h + gr * 1.8}" stroke="${kij}" stroke-width="${gr}" stroke-linecap="round"/>`;
  });
  return sz + pan + kije;
}

// Raster na tarczy słońca: rzędy kropek, średnica rośnie ku dołowi tarczy.
function raster(id: string, cx: number, cy: number, r: number, { krok = 10, dmax = 7, kolor = '#D99A52', od = 0.2 } = {}): string {
  let s = `<clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath><g clip-path="url(#${id})" stroke="${kolor}" stroke-linecap="round" stroke-dasharray="0 ${krok}">`;
  let i = 0;
  for (let y = cy - r + krok / 2; y < cy + r; y += krok * 0.866, i++) {
    const t = (y - (cy - r)) / (2 * r);
    if (t < od) continue;
    const d = dmax * ((t - od) / (1 - od)) ** 1.25;
    if (d < 0.7) continue;
    s += `<line x1="${cx - r - krok}" x2="${cx + r + krok}" y1="${f(y)}" y2="${f(y)}" stroke-width="${f(d)}" stroke-dashoffset="${i % 2 ? krok / 2 : 0}"/>`;
  }
  return `${s}</g>`;
}

function odbicie(cx: number, y0: number, y1: number, w0: number, { krok = 10, dmax = 5.5, kolor = '#E2B47A' } = {}): string {
  let s = `<g class="odbicie" stroke="${kolor}" stroke-linecap="round" stroke-dasharray="0 ${krok}">`;
  let i = 0;
  for (let y = y0 + krok / 2; y < y1; y += krok * 0.866, i++) {
    const t = (y - y0) / (y1 - y0);
    const w = w0 * (1 - t * 0.75);
    const d = dmax * (1 - t * 0.75);
    s += `<line x1="${f(cx - w)}" x2="${f(cx + w)}" y1="${f(y)}" y2="${f(y)}" stroke-width="${f(d)}" stroke-dashoffset="${i % 2 ? krok / 2 : 0}"/>`;
  }
  return `${s}</g>`;
}

// Mewy: dwa łuki, skrzydła lekko uniesione. Daleko, więc w szarości mgły.
function mewy(): string {
  const ptaki: [number, number, number][] = [
    [318, 268, 1],
    [352, 252, 0.8],
    [905, 214, 1.1],
    [946, 236, 0.75],
    [1012, 196, 0.6],
  ];
  const d = ptaki
    .map(([x, y, s]) => `M${x - 13 * s} ${y + 2 * s} q${7 * s} ${-9 * s} ${13 * s} ${-2 * s} q${6 * s} ${-7 * s} ${13 * s} ${2 * s}`)
    .join(' ');
  return `<path class="mewy" d="${d}" fill="none" stroke="#5E7064" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const ALT_POCZTOWKI =
  'Pocztówka: poranek nad morzem. Blade słońce tuż nad wodą przecina wstęga mgły. Na wydmie stoją dwie sosny, ' +
  'w oddali bór i latarnia, a na plaży parawany w zielono-kremowe pasy. Napis: „Pozdrowienia znad danych”.';

export function pocztowka(): string {
  const W = 1200;
  const H = 800;
  const HOR = 470;
  const cx = 560;
  const cy = 452;
  const r = 128;
  let defs = '<linearGradient id="nb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCE3DD"/><stop offset=".62" stop-color="#EDE8DC"/><stop offset="1" stop-color="#F4E8D3"/></linearGradient>';
  defs += '<radialGradient id="po"><stop offset="0" stop-color="#F3D29E" stop-opacity=".95"/><stop offset="1" stop-color="#F4E8D3" stop-opacity="0"/></radialGradient>';
  defs += '<pattern id="rm" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(15)"><circle cx="4" cy="4" r="1.2" fill="#6F8C7E"/></pattern>';
  defs += '<pattern id="pw-s" width="40" height="10" patternUnits="userSpaceOnUse"><rect width="20" height="10" fill="#0B3D2E"/><rect x="20" width="20" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="pw-s2" width="28" height="10" patternUnits="userSpaceOnUse"><rect width="14" height="10" fill="#0B3D2E"/><rect x="14" width="14" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="pw-b" width="14" height="10" patternUnits="userSpaceOnUse"><rect width="7" height="10" fill="#B9791F"/><rect x="7" width="7" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="pw-b2" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="10" fill="#B9791F"/><rect x="5" width="5" height="10" fill="#FAF7EF"/></pattern>';
  defs += `<clipPath id="nad"><rect width="${W}" height="${HOR}"/></clipPath>`;
  defs += '<filter id="ziarno-p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="4" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .2 0 0 0 0 .22 0 0 0 0 .18 0 0 0 -1.2 .6"/></filter>';

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ALT_POCZTOWKI}"><defs>${defs}</defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#nb)"/>`;
  s += `<circle class="poswiata" cx="${cx}" cy="${cy}" r="300" fill="url(#po)"/>`;
  s += `<g clip-path="url(#nad)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#EDB86A"/>${raster('tz', cx, cy, r, { kolor: '#C47A2C' })}</g>`;
  // wstęgi mgły przecinają tarczę; dryfują powoli (style.css, .mgla-w), bez ruchu przy reduced-motion
  s += '<g class="mgla-w mgla-w1"><path fill="#F4F1EA" opacity=".74" d="M196 420 L520 412 L700 400 L1040 396 L1040 416 L760 420 L560 432 L196 440Z"/></g>';
  s += '<g class="mgla-w mgla-w2"><path fill="#F4F1EA" opacity=".62" d="M332 354 L600 350 L876 340 L876 352 L640 358 L332 366Z"/></g>';
  s += mewy();
  // daleki cypel z latarnią: jasny i chłodny, zatopiony w mgle
  s += `<path d="M0 ${HOR + 2} L0 446 C 60 440 120 444 170 438 C 230 432 280 446 330 456 C 352 462 372 466 384 ${HOR + 2}Z" fill="#B3C3B9"/>`;
  s += '<g><polygon points="196,440 214,440 211,390 199,390" fill="#F7F3EA"/><polygon points="196,440 214,440 213.4,428 196.6,428" fill="#C9A08A"/><polygon points="198,412 212,412 211.6,402 198.4,402" fill="#C9A08A"/><rect x="196" y="384" width="18" height="6" fill="#93A89C"/><rect class="latarnia" x="199" y="374" width="12" height="10" fill="#F0CB97"/><path d="M197 375 Q205 362 213 375Z" fill="#93A89C"/></g>';
  // morze: przy horyzoncie jaśniejsze, raster gęstnieje ku brzegowi
  s += `<rect y="${HOR}" width="${W}" height="140" fill="#8AA396"/>`;
  s += `<rect y="${HOR}" width="${W}" height="22" fill="#A8BBB0"/>`;
  s += `<rect y="${HOR + 50}" width="${W}" height="90" fill="url(#rm)" opacity=".6"/>`;
  s += odbicie(cx, HOR + 2, 596, 120);
  s += '<g class="mgla-w mgla-w3"><path fill="#F1EEE6" opacity=".7" d="M-40 494 L360 492 L640 496 L800 500 L800 508 L460 512 L-40 516Z"/></g>';
  // bór za wydmą: daleki plan, jasny, spłaszczony mgłą
  const wydma = (x: number): number => 470 - (x - 800) * 0.12;
  s += bor(808, 1215, 540, (x) => wydma(x) - 84 - Math.sin(x / 47) * 10, 22, 7, '#9EB3A7', '#A9B9AE', 2, 1, 14);
  s += '<path fill="#F1EEE6" opacity=".72" d="M780 446 L960 432 L1200 424 L1200 450 L960 458 L780 468Z"/>';
  s += '<path d="M640 610 C 720 560 800 476 920 450 C 1020 432 1110 436 1200 428 L1200 680 L640 680Z" fill="#D9CDB0"/>';
  // dwie sosny na wydmie: bliższy plan, pełna zieleń, rdzawe pnie w porannym świetle
  s += sosna(1064, 458, 286, 1.35, 24, 1, 5, { igly: '#2E6B55', jas: '#4F8670', dol: '#3B5A4D', gora: '#B9791F', galaz: '#8A5A1E' });
  s += sosna(872, 482, 236, 1.2, 26, 0, 3, { igly: '#0B3D2E', jas: '#2E6B55', dol: '#1C3A30', gora: '#B9791F', galaz: '#7E5012' });
  s += '<path d="M700 600 C 790 540 860 496 960 482 C 1060 468 1130 476 1200 472 L1200 700 L700 700Z" fill="#E5D9BF"/>';
  const trawy: Pkt[] = [
    [866, 512],
    [890, 506],
    [1020, 486],
    [1044, 484],
    [1150, 482],
  ];
  s += `<g stroke="#4F7E68" stroke-width="2.4" stroke-linecap="round" fill="none">${trawy.map(([x, y]) => `<path d="M${x} ${y} q-4 -14 -10 -26 M${x + 3} ${y} q1 -16 4 -32 M${x + 6} ${y} q6 -12 14 -22"/>`).join('')}</g>`;
  // plaża i linia piany
  s += `<path d="M0 604 C 200 594 420 612 640 604 S 1000 590 1200 606 L1200 ${H} L0 ${H}Z" fill="#ECE4D2"/>`;
  s += '<path class="piana" d="M0 604 C 200 594 420 612 640 604 S 1000 590 1200 606 L1200 612 C 1000 597 820 612 640 610 S 200 600 0 611Z" fill="#FBF8F1"/>';
  // ślady stóp na piasku od parawanu ku wodzie
  s += `<g fill="#D8CDB5">${[
    [520, 700],
    [548, 690],
    [574, 676],
    [604, 668],
    [630, 655],
    [662, 648],
  ]
    .map(([x, y], i) => `<ellipse cx="${x}" cy="${y + (i % 2 ? 6 : 0)}" rx="7" ry="3.2" transform="rotate(-18 ${x} ${y})"/>`)
    .join('')}</g>`;
  s += parawan(770, 618, 34, 46, 4, 9, 'pw-b', 'pw-b2', '#D8CDB5', '#0B3D2E', 4);
  s += parawan(70, 612, 104, 128, 4, 30, 'pw-s', 'pw-s2', '#D8CDB5', '#0B3D2E', 9);
  s += '<g class="napis"><text x="68" y="120" font-family="\'Source Serif 4\', Georgia, serif" font-style="italic" font-size="60" fill="#7E5012">Pozdrowienia</text>';
  s += '<text x="62" y="228" font-family="\'Source Serif 4\', Georgia, serif" font-weight="600" font-size="112" letter-spacing="-2.5" fill="#0B3D2E">znad danych</text></g>';
  s += `<rect width="${W}" height="${H}" filter="url(#ziarno-p)" opacity=".38"/>`;
  return `${s}</svg>`;
}

// Znaczek 96×120: blade słońce z rastrem, wstęga mgły, morze, wydma i wydmuchrzyca. Czytelny przy 50 px.
export function znaczek(): string {
  let p = '';
  for (let i = 0; i <= 8; i++) p += `<circle cx="${i * 12}" cy="0" r="4.2"/><circle cx="${i * 12}" cy="120" r="4.2"/>`;
  for (let i = 1; i <= 9; i++) p += `<circle cx="0" cy="${i * 12}" r="4.2"/><circle cx="96" cy="${i * 12}" r="4.2"/>`;
  return (
    `<rect width="96" height="120" fill="#0B3D2E"/><g fill="#FAF8F2">${p}</g>` +
    '<rect x="9" y="9" width="78" height="102" fill="#E8EAE3"/>' +
    `<clipPath id="zn-k"><rect x="9" y="9" width="78" height="66"/></clipPath><g clip-path="url(#zn-k)"><circle cx="40" cy="72" r="22" fill="#F0CB97"/>${raster('zn-t', 40, 72, 22, { krok: 5, dmax: 3.4, od: 0.3 })}</g>` +
    '<path fill="#F7F5EE" d="M9 61 C 30 58 50 60 87 56 L87 61 C 60 64 34 64 9 66Z"/>' +
    '<rect x="9" y="75" width="78" height="10" fill="#8AA396"/><rect x="9" y="75" width="78" height="3" fill="#A8BBB0"/>' +
    '<path d="M9 111 L9 98 C 30 92 50 80 87 76 L87 111Z" fill="#D9CDB0"/>' +
    '<path d="M9 111 L9 104 C 34 100 60 94 87 92 L87 111Z" fill="#ECE4D2"/>' +
    '<g stroke="#0B3D2E" stroke-width="1.8" stroke-linecap="round" fill="none"><path d="M66 90 q-3 -10 -8 -18 M68 90 q0 -12 2 -22 M70 90 q4 -9 10 -15 M64 90 q-6 -6 -12 -8"/></g>' +
    '<text x="15" y="29" font-family="\'Source Serif 4\', Georgia, serif" font-weight="600" font-size="15" fill="#0B3D2E">0 zł</text>' +
    // stempel pocztowy: dwa okręgi i fale, nachodzi na róg znaczka
    '<g class="stempel" fill="none" stroke="#7E5012" stroke-width="1.4" opacity=".55"><circle cx="78" cy="98" r="15"/><circle cx="78" cy="98" r="11"/><path d="M40 96 q6 -4 12 0 t12 0 M42 103 q6 -4 12 0 t12 0"/></g>'
  );
}

// Symbole lasu: dalszy rząd koron (łuki) i kafel bliższego boru 480 px. Kolor przez fill/color na <use>.
export function lasSymbole(): string {
  DOKL = 1;
  const R = los(5);
  let y = 40;
  let d = 'M0 104 L0 40';
  for (let x = 0; x < 1440; x += 16) {
    const y2 = Math.round(36 + Math.sin(x / 170) * 6 + R() * 8);
    d += ` Q${x + 8} ${Math.min(y, y2) - 7 - Math.round(R() * 5)} ${x + 16} ${y2}`;
    y = y2;
  }
  let s = `<symbol id="bor-dal" viewBox="0 0 1440 104"><path d="${d} L1440 104Z"/></symbol>`;
  const kafel = bor(-12, 492, 104, (x) => 52 + Math.sin(x / 76) * 6, 16, 11, '#1C5A45', '#1C5A45', 2, 0.7, 10)
    .replace(/ fill="#1C5A45"/g, '')
    .replace(/stroke="#1C5A45"/g, 'stroke="currentColor"');
  s += `<symbol id="bor-bl" viewBox="0 0 480 104" overflow="visible">${kafel}</symbol>`;
  const so = sosna(40, 102, 78, 0.42, 12, 0, 13, { igly: '#1C5A45', jas: null, dol: '#1C5A45', gora: '#1C5A45', galaz: '#1C5A45' })
    .replace(/ fill="#1C5A45"/g, '')
    .replace(/stroke="#1C5A45"/g, 'stroke="currentColor"');
  s += `<symbol id="sosna-s" viewBox="0 0 80 104" overflow="visible">${so}</symbol>`;
  DOKL = 10;
  return s;
}

const kafle = (y: number, h: number): string =>
  [0, 960, 480]
    .map((x, i) =>
      i < 2
        ? `<use href="#bor-bl" x="${x}" y="${y}" width="480" height="${h}"/>`
        : `<use href="#bor-bl" transform="translate(960 ${y}) scale(-1 1)" width="480" height="${h}"/>`,
    )
    .join('');

/** Stopka: bór o poranku; dalszy rząd jasny we mgle, bliższy w zieleni sosny, dwie wyższe sosny. */
export function las(): string {
  let s = '<use href="#bor-dal" width="1440" height="104" fill="#B9C7BD"/>';
  s += '<path d="M0 60 L1440 56 L1440 80 L0 80Z" fill="#E6E8E2" opacity=".72"/>';
  s += `<g fill="#1C5A45" color="#1C5A45">${kafle(0, 104)}<use href="#sosna-s" x="260" width="80" height="104"/><use href="#sosna-s" transform="translate(1050 0) scale(-1.08 1.04)" width="80" height="104"/></g>`;
  s += '<path d="M0 120 L0 98 C 300 90 560 104 820 96 S 1240 88 1440 98 L1440 120Z" fill="#0B3D2E"/>';
  return s;
}

/** Przerywnik w mgle: daleki bór z tych samych symboli; dół = tło sekcji Skuteczność. */
export function przerywnik(): string {
  let s = '<use href="#bor-dal" y="10" width="1440" height="104" fill="#C9D3CB"/>';
  s += '<path d="M0 62 L1440 54 L1440 70 L0 76Z" fill="#F1EEE6" opacity=".7"/>';
  s += `<g fill="#AFC0B5" color="#AFC0B5">${kafle(40, 104)}</g>`;
  s += '<path d="M0 98 L1440 92 L1440 104 L0 110Z" fill="#E9ECE6" opacity=".8"/>';
  s += '<path d="M0 110 L1440 104 L1440 150 L0 150Z" fill="#DDE3DC"/>';
  return s;
}

/** Znaczniki `<!--IL:NAZWA-->` w index.html, każdy dokładnie raz. */
const ILUSTRACJE: Record<string, () => string> = {
  POCZTOWKA: pocztowka,
  ZNACZEK: znaczek,
  'LAS-SYMBOLE': lasSymbole,
  LAS: las,
  PRZERYWNIK: przerywnik,
};

export function wstawIlustracje(html: string): string {
  let out = html;
  for (const [k, fn] of Object.entries(ILUSTRACJE)) {
    const marker = `<!--IL:${k}-->`;
    const n = out.split(marker).length - 1;
    if (n !== 1) throw new Error(`parawan-tresc: znacznik ${marker} występuje ${n} razy zamiast raz`);
    out = out.replace(marker, () => fn());
  }
  return out;
}
