/**
 * Scena „Parawany stają tylko przy danych” (#plaza), adres na pocztówce i stan okna z tekstem,
 * liczone przy buildzie tym samym redactPII co w pliku do pobrania. Moduł bez DOM: woła go
 * wtyczka parawanTresc (vite.config.ts), a sprawdza apps/web/src/landing-scena.test.ts.
 *
 * Bez JavaScriptu strona pokazuje stan końcowy wpisany tutaj. Skrypt (src/plaza.ts) tylko
 * animuje gotowe pismo: nie składa go od nowa i nie potrzebuje silnika.
 *
 * Markup maski (`.d` z `.o`, `.l`, `.s`) jest ten sam co w próbce E:\parawan-landing-proby\r6-k2,
 * bo od niego zależy mechanika animacji w plaza.ts i style.css.
 */
import type { PiiFinding } from 'anonimizator';
import {
  ADRES_POCZTOWKI,
  type Cat,
  EXAMPLE_TEXT,
  MASK_TOKEN_RE,
  maskCategory,
  NAZWA_KAT,
  PISMO_TEXT,
  ZOSTAW,
} from './tokens';
import { escapeHtml, licznikKategorii, plural, renderAligned, statHtml } from './wynik';

export type Redact = (text: string) => { redacted: string; found: PiiFinding[] };

/** Zakres oryginału zastąpiony znacznikiem. */
export interface Maska {
  a: number;
  b: number;
  lab: string;
}

/** Zakresy oryginału, które silnik zastąpił znacznikiem, albo null, gdy wynik się nie dopasuje. */
export function maski(orig: string, red: string): Maska[] | null {
  const re = new RegExp(MASK_TOKEN_RE.source, 'g');
  const czesci: { lit: string; lab: string }[] = [];
  let ost = 0;
  for (let m = re.exec(red); m; m = re.exec(red)) {
    czesci.push({ lit: red.slice(ost, m.index), lab: m[0] });
    ost = m.index + m[0].length;
  }
  const ogon = red.slice(ost);
  const wy: Maska[] = [];
  let kur = 0;
  for (let i = 0; i < czesci.length; i++) {
    const { lit } = czesci[i];
    if (orig.substr(kur, lit.length) !== lit) return null;
    const a = kur + lit.length;
    let b: number;
    if (i + 1 < czesci.length) {
      const nast = czesci[i + 1].lit;
      if (!nast) return null;
      b = orig.indexOf(nast, a + 1);
    } else {
      b = orig.length - ogon.length;
      if (orig.slice(b) !== ogon) return null;
    }
    if (b <= a) return null;
    wy.push({ a, b, lab: czesci[i].lab });
    kur = b;
  }
  return wy;
}

const kat = (lab: string): Cat => maskCategory(lab.replace(/^\[|\]$/g, ''));

/** Nazwa kategorii dla czytnika ekranu: kolor i znak to sygnały tylko dla oka. */
const vhKat = (k: Cat): string => `<span class="vh">, kategoria: ${NAZWA_KAT[k].toLowerCase()}</span>`;

// znak interpunkcyjny tuż za znacznikiem nie może spaść sam do nowego wiersza
const PO = /^[),.;:!?…]+/;

function znacznikMaski(tekst: string, lab: string): string {
  const k = kat(lab);
  return (
    `<span class="d c-${k} lab" title="${NAZWA_KAT[k]}"><span class="o" aria-hidden="true">${escapeHtml(tekst)}</span>` +
    `<span class="l">${escapeHtml(lab)}${vhKat(k)}</span><span class="s" aria-hidden="true"></span></span>`
  );
}

const NBSP = String.fromCharCode(0xa0);

/** Twarde spacje po jednoliterowych spójnikach i przyimkach (jak scripts/typografia/nbsp.mjs). */
export function sierotki(html: string): string {
  return (
    html
      .split(/(<[^>]+>)/)
      // „z ” tuż przed fragmentem w <span> też dostaje twardą spację, stąd (?=\S|$)
      .map((kaw) =>
        kaw.startsWith('<') ? kaw : kaw.replace(/(^|[\s(„\xa0])([aiouwzAIOUWZ]|§) (?=\S|$)/g, `$1$2${NBSP}`),
      )
      .join('')
      // nazwy znaczników zostają ze zwykłymi spacjami, jak w wyniku silnika ([IMIĘ I NAZWISKO])
      .replace(/\[[^\]<]*\]/g, (m) => m.split(NBSP).join(' '))
  );
}

export interface Sklad {
  html: string;
  maski: number;
  zostaje: number;
  licz: Record<string, number>;
  wynik: string;
}

/** Skład pisma w stanie końcowym: akapity rozdzielone pustą linią, maski i fragmenty „na słońcu”. */
export function sklad(orig: string, redact: Redact, zostaw: readonly { t: string; n: string }[]): Sklad {
  const r = redact(orig);
  const mk = maski(orig, r.redacted);
  if (!mk) throw new Error('scena: wyniku silnika nie da się dopasować do pisma');
  type Znak = { a: number; b: number; typ: 'd'; lab: string } | { a: number; b: number; typ: 'k'; n: string };
  const znaki: Znak[] = mk.map((x) => ({ a: x.a, b: x.b, typ: 'd', lab: x.lab }));
  for (const z of zostaw) {
    const a = orig.indexOf(z.t);
    if (a < 0) throw new Error(`scena: fragmentu „${z.t}” nie ma w piśmie`);
    const b = a + z.t.length;
    if (znaki.some((x) => a < x.b && b > x.a)) {
      throw new Error(`scena: fragment „${z.t}”, który ma zostać, zasłonił silnik`);
    }
    znaki.push({ a, b, typ: 'k', n: z.n });
  }
  znaki.sort((x, y) => x.a - y.a);

  const tekst = (s: string): string => escapeHtml(s).replace(/\n/g, '<br>');
  function kawalek(od: number, doo: number): string {
    let h = '';
    let kur = od;
    for (const z of znaki) {
      if (z.a < od || z.b > doo) continue;
      h += tekst(orig.slice(kur, z.a));
      kur = z.b;
      if (z.typ === 'd') {
        const zn = znacznikMaski(orig.slice(z.a, z.b), z.lab);
        const p = (orig.slice(z.b, doo).match(PO) ?? [''])[0];
        h += p ? `<span class="nw">${zn}<span class="po">${escapeHtml(p)}</span></span>` : zn;
        kur = z.b + p.length;
      } else {
        const t = orig.slice(z.a, z.b);
        // długi fragment (nazwa sądu) może się łamać, krótki zostaje w jednym wierszu
        h += `<span class="k${t.length >= 19 ? ' k-dl' : ''}" data-n="${escapeHtml(z.n)}">${escapeHtml(t)}</span>`;
      }
    }
    return h + tekst(orig.slice(kur, doo));
  }

  const akapity: [number, number][] = [];
  let start = 0;
  for (const m of orig.matchAll(/\n\n/g)) {
    akapity.push([start, m.index ?? 0]);
    start = (m.index ?? 0) + 2;
  }
  akapity.push([start, orig.replace(/\s+$/, '').length]);
  const html = akapity
    .map(([a, b], i) => {
      const kl = i === 0 ? 'data' : i === 1 ? 'adresat' : i === 2 ? 'tyt' : i === akapity.length - 1 ? 'podpis' : '';
      return `<p${kl ? ` class="${kl}"` : ''}>${sierotki(kawalek(a, b))}</p>`;
    })
    .join('\n');

  const licz: Record<string, number> = {};
  for (const x of mk) licz[x.lab] = (licz[x.lab] ?? 0) + 1;
  return { html, maski: mk.length, zostaje: znaki.length - mk.length, licz, wynik: r.redacted };
}

export const odmiana = (n: number, f: readonly [string, string, string]): string => plural(n, f[0], f[1], f[2]);

/** Nazwy znaczników w zdaniu podsumowania („3 imiona i nazwiska, adres, PESEL i telefon”). */
const NAZWY: Record<string, readonly [string, string, string]> = {
  '[IMIĘ I NAZWISKO]': ['imię i nazwisko', 'imiona i nazwiska', 'imion i nazwisk'],
  '[DATA-URODZENIA]': ['data urodzenia', 'daty urodzenia', 'dat urodzenia'],
  '[DANE O ZDROWIU]': ['dane o zdrowiu', 'dane o zdrowiu', 'danych o zdrowiu'],
  '[ADRES]': ['adres', 'adresy', 'adresów'],
  '[KOD-POCZTOWY]': ['kod pocztowy', 'kody pocztowe', 'kodów pocztowych'],
  '[MIEJSCOWOŚĆ]': ['miejscowość', 'miejscowości', 'miejscowości'],
  '[PESEL]': ['PESEL', 'PESEL-e', 'PESEL-i'],
  '[NIP]': ['NIP', 'NIP-y', 'NIP-ów'],
  '[REGON]': ['REGON', 'REGON-y', 'REGON-ów'],
  '[NR-KONTA]': ['numer konta', 'numery kont', 'numerów kont'],
  '[NR-KARTY]': ['numer karty', 'numery kart', 'numerów kart'],
  '[TELEFON]': ['telefon', 'telefony', 'telefonów'],
  '[EMAIL]': ['e-mail', 'e-maile', 'e-maili'],
  '[ZNAK-SPRAWY]': ['znak sprawy', 'znaki spraw', 'znaków spraw'],
  '[NR-KSEF]': ['numer KSeF', 'numery KSeF', 'numerów KSeF'],
};

export function wyliczenie(licz: Record<string, number>): string {
  const el = Object.keys(licz).map((k) => {
    const n = licz[k];
    const nazwa = k.slice(1, -1).toLowerCase();
    const f = NAZWY[k] ?? ([nazwa, nazwa, nazwa] as const);
    return n === 1 ? f[0] : `${n} ${odmiana(n, f)}`;
  });
  if (el.length < 2) return el.join('');
  return `${el.slice(0, -1).join(', ')} i ${el[el.length - 1]}`;
}

/** Winieta wschodu słońca: jeden pas parawanu na każdą maskę pisma. */
function pasyWiniety(n: number): string {
  return Array.from({ length: n }, (_, i) => {
    const w = (112 / n).toFixed(2);
    return `<rect class="wp ${i % 2 ? 'wp-b' : 'wp-a'}" data-i="${i}" x="${(44 + (i * 112) / n).toFixed(2)}" y="${i % 2 ? 70 : 66}" width="${w}" height="${i % 2 ? 30 : 34}"/>`;
  }).join('');
}

export function winieta(n: number): string {
  return (
    '<rect width="200" height="110" fill="#E8EAE3"/>' +
    '<circle class="sl" cx="100" cy="46" r="20" fill="#F0CB97"/>' +
    '<path fill="#F7F5EE" d="M40 44 C 80 40 120 42 170 38 L170 44 C 120 47 80 49 40 50Z"/>' +
    '<rect y="58" width="200" height="30" fill="#8AA396"/><rect y="58" width="200" height="5" fill="#A8BBB0"/>' +
    '<g class="blyski" fill="#E2B47A"><rect x="76" y="66" width="48" height="3"/><rect x="86" y="74" width="28" height="2.5"/></g>' +
    '<rect y="88" width="200" height="22" fill="#ECE4D2"/>' +
    pasyWiniety(n) +
    '<g fill="#0B3D2E"><rect x="41" y="60" width="3" height="44" rx="1.5"/><rect x="156" y="60" width="3" height="44" rx="1.5"/></g>'
  );
}

const F_PAR = ['parawan', 'parawany', 'parawanów'] as const;
const F_FR = ['fragment', 'fragmenty', 'fragmentów'] as const;

/** Wynik silnika jako znaczniki w barwach kategorii (adres na pocztówce). */
function wynikLab(red: string): string {
  return escapeHtml(red).replace(new RegExp(MASK_TOKEN_RE.source, 'g'), (z) => {
    const k = kat(z);
    return `<span class="lab c-${k}" title="${NAZWA_KAT[k]}">${z}${vhKat(k)}</span>`;
  });
}

/** Wszystko, co strona pokazuje bez JavaScriptu w scenie, na pocztówce i w oknie z tekstem. */
export function tresciSceny(redact: Redact): Record<string, string> {
  const sk = sklad(PISMO_TEXT, redact, ZOSTAW);
  const slonce = ZOSTAW.map(
    (z, i) =>
      `<li data-i="${i}"><span class="sl-t">${escapeHtml(z.t)}</span><span class="sl-n">${escapeHtml(z.n)}</span></li>`,
  ).join('');
  const adres = redact(ADRES_POCZTOWKI)
    .redacted.split('\n')
    .map((w) => `<span class="ad-w">${wynikLab(w)}</span>`)
    .join('');
  const demo = redact(EXAMPLE_TEXT);
  return {
    PISMO: sk.html,
    SLONCE: slonce,
    'N-MASKI': String(sk.maski),
    'N-ZOSTAJE': String(sk.zostaje),
    'L-A': `${odmiana(sk.maski, F_PAR)} przy danych`,
    'L-B': `${odmiana(sk.zostaje, F_FR)} na słońcu`,
    PODSUM: escapeHtml(`Zasłonięto ${sk.maski} ${odmiana(sk.maski, F_FR)}: ${wyliczenie(sk.licz)}.`),
    WINIETA: winieta(sk.maski),
    ADRES: adres,
    'DEMO-WE': escapeHtml(EXAMPLE_TEXT),
    'DEMO-WY': renderAligned(EXAMPLE_TEXT, demo.redacted, false),
    'DEMO-STAT': statHtml(demo.found),
  };
}

/**
 * Podmienia znaczniki `<!--SCENA:NAZWA-->` na treść policzoną silnikiem i wpisuje liczby legendy
 * okna z tekstem. Brak znacznika albo znacznik bez treści zatrzymuje build.
 */
export function wstawScene(html: string, redact: Redact): string {
  const t = tresciSceny(redact);
  // PODSUM i L-A/L-B to proza, więc też dostają twarde spacje
  for (const k of ['PODSUM', 'L-A', 'L-B']) t[k] = sierotki(t[k]);
  let out = html;
  for (const [k, v] of Object.entries(t)) {
    const marker = `<!--SCENA:${k}-->`;
    if (!out.includes(marker)) throw new Error(`parawan-tresc: w index.html brak znacznika ${marker}`);
    out = out.split(marker).join(v);
  }
  const zostal = out.match(/<!--SCENA:[^>]*-->/);
  if (zostal) throw new Error(`parawan-tresc: nieznany znacznik ${zostal[0]}`);
  const ile = licznikKategorii(redact(EXAMPLE_TEXT).redacted);
  return out.replace(
    /(<b class="leg-n" data-k="(\w+)">)0(<\/b>)/g,
    (_m, o: string, k: string, z: string) => o + String(ile[k] ?? 0) + z,
  );
}
