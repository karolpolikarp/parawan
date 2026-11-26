/**
 * Ilustracje strony („Sosna o poranku”) jako SVG składane przy buildzie (wtyczka parawanTresc
 * w vite.config.ts). Płaskie płaszczyzny, raster offsetowy na słońcu, ziarno papieru. Czyste
 * funkcje z ziarnem losowania: ten sam build daje ten sam obraz. Moduł nie wchodzi do paczki JS
 * strony (main.ts go nie importuje), więc obrazy są w HTML od razu, także bez JavaScriptu.
 *
 * Paleta: sosna #0B3D2E/#1C5A45/#2E6B55, rdza pni #7E5012, niebo w pasach #DCE3DD/#E6E6DC/#F1EADA,
 * słońce #EDB86A z rastrem (bursztyn tylko na słońcu, DESIGN.md), mgła #F1EEE6, cypel #B3C3B9,
 * bór #9EB3A7, morze #8AA396/#A8BBB0,
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

function kepa(cx: number, cy: number, w: number, h: number, R: Los, kol: string, jas: string | null, n = 14, wiatr = 0.35): string {
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
  const { igly = '#0B3D2E', jas = '#2E6B55', dol = '#072A20', gora = '#7E5012', galaz = '#7E5012' } = kol;
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

// Parawan w perspektywie: n paneli zygzakiem, dwa desenie płótna. Z `kl` każdy panel dostaje
// klasę `pp` i numer `--i` (pocztówka: panele rozkładają się po kolei od lewego kija, style.css).
function parawan(x0: number, y0: number, krok: number, h: number, n: number, uskok: number, desen: string, desen2: string, cien: string, kij: string, gr: number, kl = ''): string {
  let pan = '';
  let kije = '';
  const xs = Array.from({ length: n + 1 }, (_, i) => x0 + i * krok);
  const ys = xs.map((_, i) => y0 + (i % 2) * uskok);
  const sz = `<polygon points="${xs[0] + h * 0.5},${ys[0] + h} ${xs[n] + h * 0.9},${ys[n] + h + 18} ${xs[n] + 4},${ys[n] + h} ${xs[0] + 4},${ys[0] + h}" fill="${cien}"/>`;
  for (let i = 0; i < n; i++) {
    const p = `${xs[i]},${ys[i]} ${xs[i + 1]},${ys[i + 1]} ${xs[i + 1]},${ys[i + 1] + h} ${xs[i]},${ys[i] + h}`;
    pan += `<polygon${kl ? ` class="pp" style="--i:${i}"` : ''} points="${p}" fill="url(#${i % 2 ? desen2 : desen})"/>`;
  }
  pan += `<polyline points="${xs.map((x, i) => `${x},${ys[i]}`).join(' ')}" fill="none" stroke="${kij}" stroke-width="${f(gr * 0.55)}" stroke-linejoin="round"/>`;
  xs.forEach((x, i) => {
    kije += `<line x1="${x}" y1="${ys[i] - gr * 1.6}" x2="${x}" y2="${ys[i] + h + gr * 1.8}" stroke="${kij}" stroke-width="${gr}" stroke-linecap="round"/>`;
  });
  return kl ? `<g class="${kl}">${sz}${pan}${kije}</g>` : sz + pan + kije;
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
function mewy(ptaki: [number, number, number][], kl = 'mewy', kolor = '#5E7064', gr = 2.6): string {
  const d = ptaki
    .map(([x, y, s]) => `M${f(x - 13 * s)} ${f(y + 2 * s)} q${f(7 * s)} ${f(-9 * s)} ${f(13 * s)} ${f(-2 * s)} q${f(6 * s)} ${f(-7 * s)} ${f(13 * s)} ${f(2 * s)}`)
    .join(' ');
  return `<path class="${kl}" d="${d}" fill="none" stroke="${kolor}" stroke-width="${gr}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// Sylwetka boru jednym obrysem: zęby koron na różnych wysokościach, bez pni (daleki plan).
function sylweta(x0: number, x1: number, podst: number, gora: (x: number) => number, seed: number, krok: [number, number], zab: number): string {
  const R = los(seed);
  let d = `M${x0} ${podst} L${x0} ${f(gora(x0) + 4)}`;
  for (let x = x0; x < x1; ) {
    const w = krok[0] + R() * (krok[1] - krok[0]);
    d += ` L${f(x + w * 0.5)} ${f(gora(x + w / 2) - R() * zab)} L${f(x + w)} ${f(gora(x + w) + 2 + R() * 5)}`;
    x += w;
  }
  return `${d} L${x1} ${podst}Z`;
}

const ALT_POCZTOWKI =
  'Pocztówka: poranek nad morzem. Blade słońce tuż nad wodą przecina wstęga mgły. Na pierwszym planie stoi ' +
  'parawan w zielono-kremowe pasy: zza niego widać tylko słomkowy kapelusz i stopy, obok leży ręcznik. ' +
  'Dalej dwie sosny na wydmie, bór i latarnia. Napis: „Pozdrowienia znad danych”.';

/**
 * Pocztówka jak druk z lat 60.: kilka płaskich farb bez przejść, niebo w pasach ze schodkową
 * krawędzią, raster słońca przesunięty o włos względem tarczy (paser). Bohater to parawan na
 * pierwszym planie: wszystko widać, oprócz człowieka za nim. Żadnych liter poza hasłem.
 */
export function pocztowka(): string {
  const W = 1200;
  const H = 800;
  const HOR = 470;
  const cx = 560;
  const cy = 452;
  const r = 128;
  let defs = '<pattern id="rm" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(15)"><circle cx="4" cy="4" r="1.2" fill="#6F8C7E"/></pattern>';
  defs += '<pattern id="pw-s" width="40" height="10" patternUnits="userSpaceOnUse"><rect width="20" height="10" fill="#0B3D2E"/><rect x="20" width="20" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="pw-s2" width="32" height="10" patternUnits="userSpaceOnUse"><rect width="16" height="10" fill="#0B3D2E"/><rect x="16" width="16" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="pw-m" width="14" height="10" patternUnits="userSpaceOnUse"><rect width="7" height="10" fill="#2E6B55"/><rect x="7" width="7" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="pw-m2" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="10" fill="#2E6B55"/><rect x="5" width="5" height="10" fill="#FAF7EF"/></pattern>';
  defs += '<pattern id="rc" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(-62)"><rect width="22" height="22" fill="#FAF7EF"/><rect width="9" height="22" fill="#2E6B55"/></pattern>';
  defs += `<clipPath id="nad"><rect width="${W}" height="${HOR}"/></clipPath>`;
  defs += '<filter id="ziarno-p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" seed="4" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 .2 0 0 0 0 .22 0 0 0 0 .18 0 0 0 -1.2 .6"/></filter>';

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${ALT_POCZTOWKI}"><defs>${defs}</defs>`;
  // niebo: trzy płaskie farby, krawędzie schodkami jak przy złym pasowaniu arkuszy
  s += `<rect width="${W}" height="${H}" fill="#DCE3DD"/>`;
  s += `<path fill="#E6E6DC" d="M0 ${HOR} L0 262 L310 262 L310 252 L760 252 L760 244 L${W} 244 L${W} ${HOR}Z"/>`;
  s += `<path fill="#F1EADA" d="M0 ${HOR} L0 372 L240 372 L240 364 L690 364 L690 356 L${W} 356 L${W} ${HOR}Z"/>`;
  // słońce: tarcza i raster z przesunięciem pasera (+2, −1)
  s += `<g clip-path="url(#nad)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#EDB86A"/>${raster('tz', cx + 2, cy - 1, r, { kolor: '#C47A2C' })}</g>`;
  // wstęgi mgły: pełna farba, krawędź w dwóch uskokach
  s += '<g class="mgla-w mgla-w1"><path fill="#F4F1EA" d="M196 416 L520 416 L520 410 L1040 410 L1040 424 L760 424 L760 430 L196 430Z"/></g>';
  s += '<g class="mgla-w mgla-w2"><path fill="#F4F1EA" d="M332 350 L600 350 L600 345 L876 345 L876 354 L640 354 L640 359 L332 359Z"/></g>';
  s += mewy([
    [318, 278, 1],
    [352, 262, 0.8],
    [742, 214, 1.1],
    [782, 236, 0.75],
    [700, 196, 0.6],
  ]);
  // daleki cypel z latarnią: jasny i chłodny, zatopiony w mgle
  s += `<path d="M0 ${HOR + 2} L0 446 C 60 440 120 444 170 438 C 230 432 280 446 330 456 C 352 462 372 466 384 ${HOR + 2}Z" fill="#B3C3B9"/>`;
  s += '<g><polygon points="196,440 214,440 211,390 199,390" fill="#F7F3EA"/><polygon points="196,440 214,440 213.4,428 196.6,428" fill="#C9A08A"/><polygon points="198,412 212,412 211.6,402 198.4,402" fill="#C9A08A"/><rect x="196" y="384" width="18" height="6" fill="#93A89C"/><rect class="latarnia" x="199" y="374" width="12" height="10" fill="#F0CB97"/><path d="M197 375 Q205 362 213 375Z" fill="#93A89C"/></g>';
  // morze: przy horyzoncie jaśniejsze, raster gęstnieje ku brzegowi
  s += `<rect y="${HOR}" width="${W}" height="140" fill="#8AA396"/>`;
  s += `<rect y="${HOR}" width="${W}" height="22" fill="#A8BBB0"/>`;
  s += `<rect y="${HOR + 50}" width="${W}" height="90" fill="url(#rm)" opacity=".6"/>`;
  s += odbicie(cx, HOR + 2, 596, 120);
  s += '<g class="mgla-w mgla-w3"><path fill="#F1EEE6" d="M-40 496 L360 496 L360 492 L800 492 L800 504 L460 504 L460 510 L-40 510Z"/></g>';
  // bór za wydmą: jedna ząbkowana sylwetka, jasna jak w mgle
  const wydma = (x: number): number => 470 - (x - 800) * 0.12;
  // bór schodzi do morza po lewej, bez pionowej krawędzi
  s += `<path fill="#9EB3A7" d="${sylweta(760, 1200, 540, (x) => wydma(x) - 70 - Math.sin(x / 47) * 8 + Math.max(0, 860 - x) * 0.7, 7, [12, 22], 14)}"/>`;
  s += '<path fill="#F1EEE6" d="M780 452 L960 452 L960 444 L1200 444 L1200 462 L960 462 L960 470 L780 470Z"/>';
  s += '<path d="M640 610 C 720 560 800 476 920 450 C 1020 432 1110 436 1200 428 L1200 680 L640 680Z" fill="#D9CDB0"/>';
  // dwie sosny na wydmie: dalsza mniejsza w jaśniejszej zieleni, bliższa wychodzi za kadr
  s += sosna(862, 486, 232, 1.15, 22, 0, 3, { igly: '#2E6B55', jas: '#4F8670', dol: '#3B5A4D', gora: '#7E5012', galaz: '#5E4423' });
  s += sosna(1078, 470, 452, 1.9, 34, 1, 5, { igly: '#0B3D2E', jas: '#2E6B55', dol: '#1C3A30', gora: '#7E5012', galaz: '#1C3A30' });
  s += '<path d="M700 600 C 790 540 860 496 960 482 C 1060 468 1130 476 1200 472 L1200 700 L700 700Z" fill="#E5D9BF"/>';
  const trawy: Pkt[] = [
    [866, 512],
    [890, 506],
    [1000, 490],
    [1150, 482],
  ];
  s += `<g stroke="#4F7E68" stroke-width="2.4" stroke-linecap="round" fill="none">${trawy.map(([x, y]) => `<path d="M${x} ${y} q-4 -14 -10 -26 M${x + 3} ${y} q1 -16 4 -32 M${x + 6} ${y} q6 -12 14 -22"/>`).join('')}</g>`;
  // plaża i linia piany
  s += `<path d="M0 604 C 200 594 420 612 640 604 S 1000 590 1200 606 L1200 ${H} L0 ${H}Z" fill="#ECE4D2"/>`;
  s += '<path class="piana" d="M0 604 C 200 594 420 612 640 604 S 1000 590 1200 606 L1200 612 C 1000 597 820 612 640 610 S 200 600 0 611Z" fill="#FBF8F1"/>';
  // ślady stóp od ręcznika ku wodzie
  s += `<g fill="#D8CDB5">${[
    [640, 724],
    [664, 710],
    [684, 694],
    [710, 682],
    [730, 666],
    [756, 654],
  ]
    .map(([x, y], i) => `<ellipse cx="${x}" cy="${y + (i % 2 ? 6 : 0)}" rx="7" ry="3.2" transform="rotate(-24 ${x} ${y})"/>`)
    .join('')}</g>`;
  s += parawan(800, 626, 34, 46, 4, 9, 'pw-m', 'pw-m2', '#D8CDB5', '#0B3D2E', 4);
  // ręcznik w pasy, w perspektywie
  s += '<polygon points="470,748 610,722 700,760 556,800" fill="#D8CDB5" transform="translate(6 6)"/>';
  s += '<polygon points="470,748 610,722 700,760 556,800" fill="url(#rc)"/>';
  // gość za parawanem: kapelusz nad płótnem i stopy pod nim (style.css: chowa się po rozłożeniu)
  s += '<g class="kapelusz" stroke="#7E5012" stroke-width="2.2" stroke-linejoin="round"><ellipse cx="334" cy="484" rx="64" ry="12" fill="#E8D3A0"/><path d="M304 482 Q304 446 334 443 Q364 446 364 482Z" fill="#E8D3A0"/><path d="M305 470 Q334 464 363 470 L364 480 Q334 474 304 480Z" fill="#0B3D2E" stroke="none"/></g>';
  s += '<g class="stopy" stroke="#A98F5A" stroke-width="1.6"><ellipse cx="318" cy="754" rx="17" ry="7" fill="#F3D9BC"/><ellipse cx="358" cy="760" rx="17" ry="7" fill="#F3D9BC"/></g>';
  s += parawan(36, 478, 124, 250, 4, 34, 'pw-s', 'pw-s2', '#D8CDB5', '#072A20', 10, 'pw-gl');
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

// Dalszy bór (stopka i przerywnik): ostre trójkątne wierzchołki, kolor przez fill na <use>.
export function lasSymbole(): string {
  DOKL = 1;
  const d = sylweta(0, 1440, 104, (x) => 50 + Math.sin(x / 170) * 6, 5, [10, 20], 22);
  DOKL = 10;
  return `<symbol id="bor-dal" viewBox="0 0 1440 104" preserveAspectRatio="none"><path d="${d}"/></symbol>`;
}

// Bliższy bór jedną ciągłą sylwetką: płaskie, poszarpane korony sosen na jednym pasie, pod nimi
// prześwit, w którym co szóste drzewo pokazuje pień.
function borBliski(seed: number, gora: number, dol: number, ziemia: number): string {
  const R = los(seed);
  let gr = `M0 ${dol}`;
  let dl = '';
  let pnie = '';
  let n = 0;
  for (let x = 0; x < 1440; n++) {
    const w = 34 + R() * 30;
    const t = gora + R() * 14;
    gr += ` L${f(x + w * 0.12)} ${f(t + 6)} L${f(x + w * 0.3)} ${f(t)} L${f(x + w * 0.5)} ${f(t + 3)} L${f(x + w * 0.72)} ${f(t - 2)} L${f(x + w * 0.9)} ${f(t + 5)} L${f(x + w)} ${f(t + 9)}`;
    dl = ` L${f(x + w)} ${f(dol + R() * 4)} L${f(x + w * 0.5)} ${f(dol - 3 + R() * 6)}${dl}`;
    if (n % 6 === 2) pnie += `M${f(x + w * 0.5 - 1.5)} ${dol - 4}h3l1 ${ziemia - dol + 4}h-5Z`;
    x += w;
  }
  return `<path d="${gr} L1440 ${dol}${dl}Z${pnie}"/>`;
}

/**
 * Stopka: zmierzch, który domyka poranek z pocztówki. Za borem zachodzi słońce z tym samym
 * rastrem co na pocztówce (bursztyn tylko na słońcu), bliski bór jedną sylwetką, dwie sosny.
 */
export function las(): string {
  DOKL = 1;
  let s = `<g>${raster('zs', 1118, 64, 46, { krok: 8, dmax: 5, kolor: '#C47A2C', od: 0.1 }).replace('<g ', '<circle cx="1118" cy="64" r="46" fill="#E0A84A"/><g ')}</g>`;
  s += '<use href="#bor-dal" width="1440" height="104" fill="#B9C7BD"/>';
  s += `<g fill="#1C5A45">${borBliski(11, 58, 86, 104)}</g>`;
  const ciemne = { igly: '#1C5A45', jas: null, dol: '#1C5A45', gora: '#1C5A45', galaz: '#1C5A45' };
  s += sosna(256, 104, 98, 0.5, 12, 0, 13, ciemne) + sosna(1300, 104, 86, 0.46, 10, 1, 17, ciemne);
  s += '<path d="M0 120 L0 98 C 300 90 560 104 820 96 S 1240 88 1440 98 L1440 120Z" fill="#0B3D2E"/>';
  DOKL = 10;
  return s;
}

/**
 * Przerywnik przed „Skutecznością”: wydma z płotkiem, dwa małe parawany i mewa. Pas wody z tym
 * samym rastrem co morze na pocztówce, dół w kolorze tła następnej sekcji.
 */
export function przerywnik(): string {
  DOKL = 1;
  let s = '<defs><pattern id="pr-rm" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(15)"><circle cx="4" cy="4" r="1.2" fill="#6F8C7E"/></pattern>';
  s += '<pattern id="pr-a" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="10" fill="#0B3D2E"/><rect x="5" width="5" height="10" fill="#FAF7EF"/></pattern>';
  s += '<pattern id="pr-b" width="8" height="10" patternUnits="userSpaceOnUse"><rect width="4" height="10" fill="#0B3D2E"/><rect x="4" width="4" height="10" fill="#FAF7EF"/></pattern></defs>';
  s += '<use href="#bor-dal" y="26" width="1440" height="80" fill="#9EB3A7"/>';
  s += '<rect y="92" width="1440" height="26" fill="#A8BBB0"/><rect y="98" width="1440" height="20" fill="url(#pr-rm)" opacity=".7"/>';
  s += '<path d="M0 150 L0 116 C 260 110 560 108 820 96 C 1020 84 1200 70 1440 72 L1440 150Z" fill="#D9CDB0"/>';
  // płotek przeciwwydmowy: krótkie kołki wzdłuż zbocza
  let plot = '';
  for (let x = 860; x < 1420; x += 15) {
    // wzdłuż grzbietu wydmy (96 przy x = 820, 70 przy prawym brzegu)
    const y = 96 - 26 * Math.sin(((x - 820) / 620) * (Math.PI / 2)) + Math.sin(x / 37) * 1.2;
    plot += `M${x} ${f(y + 3)}l2 -16`;
  }
  s += `<path d="${plot}" stroke="#6F8676" stroke-width="2.4" stroke-linecap="round" fill="none"/>`;
  s += parawan(330, 106, 20, 22, 4, 5, 'pr-a', 'pr-b', '#C8BC9E', '#0B3D2E', 2.4);
  s += parawan(452, 102, 16, 18, 3, 4, 'pr-b', 'pr-a', '#C8BC9E', '#0B3D2E', 2);
  s += mewy([[1060, 34, 1.1]], 'mewa', '#56655B', 2.4);
  s += '<path d="M0 150 L0 132 C 300 126 700 138 1000 130 S 1300 126 1440 132 L1440 150Z" fill="#DDE3DC"/>';
  DOKL = 10;
  return s;
}

/**
 * Kabiny plażowe nad tabelą „Typy danych”: jedna na kategorię, w barwie paska kategorii, na
 * drzwiach znak kategorii, pod spodem nazwa. Kolor nigdy nie jest jedynym sygnałem (znak i nazwa).
 * Dekoracja (aria-hidden): tabela tuż pod nią podaje te same kategorie słowami.
 */
const KABINY: [string, string][] = [
  ['ident', 'Identyfikatory'],
  ['fin', 'Finanse'],
  ['contact', 'Kontakt'],
  ['place', 'Adres'],
  ['person', 'Osoby'],
];

export function kabiny(): string {
  const kab = KABINY.map(
    ([k, n], i) =>
      `<li class="kab c-${k}" style="--i:${i}"><span class="kab-r"><svg viewBox="0 0 64 84" focusable="false"><path class="kab-dach" d="M1 24 L32 5 L63 24Z"/><path class="kab-flaga" d="M32 5V-2l9 3-9 3"/><rect class="kab-sc" x="6" y="24" width="52" height="54"/><path class="kab-pas" d="M12 24h5v54h-5zM47 24h5v54h-5z"/><path class="kab-nogi" d="M9 78h4v6H9zM51 78h4v6h-4z"/></svg><span class="kab-d"></span></span><span class="kab-n">${n}</span></li>`,
  ).join('');
  return `<ul class="kabiny" aria-hidden="true">${kab}</ul>`;
}

/** Znaczniki `<!--IL:NAZWA-->` w index.html, każdy dokładnie raz. */
const ILUSTRACJE: Record<string, () => string> = {
  POCZTOWKA: pocztowka,
  ZNACZEK: znaczek,
  'LAS-SYMBOLE': lasSymbole,
  LAS: las,
  PRZERYWNIK: przerywnik,
  KABINY: kabiny,
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
