// Fuzzer ręcznej korekty (A09) i karty pisma (A08) na gotowym pliku przez file://, w Chromium
// i Firefoksie. Generator z ziarnem składa losowe ciągi czynności urzędnika: wklejenie pisma
// (także pisma z tego samego wzoru, z innymi danymi), pisanie i usuwanie w jednym miejscu, edycja
// w środku zasłonięcia, Enter w środku, dwuklik i wpisanie innej formy, Ctrl+X fragmentu, Ctrl+X
// i Ctrl+V wiersza, Ctrl+A i wklejenie innego pisma, natywne Ctrl+Z i Ctrl+Y w polu źródła,
// „Zasłoń zaznaczenie” (tu i wszędzie, z pola i z wyniku, także przez znacznik automatu), klik
// w znacznik i „Zostaw jawne”, „Zostaw jawne wszędzie”, „Cofnij zasłonięcie”, „Zasłoń ponownie”,
// Ctrl+Z i Ctrl+Y w wyniku i na pasku poprawki, „Cofnij ostatnią”, „Usuń wszystkie”, znak sprawy
// i Ctrl+Z w polach karty, „Wyczyść” i „Cofnij” na pasku nad polem.
//
// Model odniesienia liczy dla BIEŻĄCEGO tekstu źródła dane automatu (redactPII i alignSpans
// z tych samych źródeł co aplikacja). Ręczne decyzje są przypięte do dokładnego tekstu z chwili
// decyzji: „Zostaw jawne” i „Cofnij zasłonięcie” obowiązują tylko, dopóki tekst się nie zmienił,
// a zasłonięcie „tutaj” po zmianie nie jest wymagane. Zasłonięcie „wszędzie” to reguła tekstowa:
// każde dosłowne wystąpienie jej tekstu w bieżącym piśmie ma być zasłonięte, a reguła znika
// z listy poprawek tylko po czynności urzędnika. Zmiana tekstu, która zdjęła ręczne decyzje, daje
// notkę przy liście poprawek. Skróty poza polem źródła (wynik, pasek poprawki, karta) nie zmieniają
// tekstu. Znak sprawy zeruje się przy zmianie ponad połowy tekstu, Ctrl+A i wklejeniu, pustym polu,
// „Wyczyść” i „Cofnij” na pasku, a poza tym zostaje (także po Ctrl+Z i Ctrl+Y w polu źródła).
// Po każdym kroku sprawdzamy wynik na ekranie, druk, schowek i pobrany .txt, znak po znaku.
//
// Przed losowymi biegną ciągi z wcześniejszych błędów (REGRESSIONS), w każdej przeglądarce.
// Domyślnie 30 ciągów (po połowie na przeglądarkę) z losowym ziarnem. Zmienne:
//   PARAWAN_FUZZ_N        liczba ciągów (długi przebieg: np. 1000)
//   PARAWAN_FUZZ_SEED     ziarno (powtórzenie przebiegu z komunikatu błędu)
//   PARAWAN_FUZZ_KROKI    długość ciągu (domyślnie 10)
//   PARAWAN_FUZZ_PRZEGLADARKI  lista przeglądarek, domyślnie chromium,firefox (brakująca jest pomijana)
//   PARAWAN_FUZZ_WSZYSTKIE=1   nie przerywaj na pierwszym błędzie, policz wszystkie
//   PARAWAN_FUZZ_MIN      ile błędnych ciągów skracać do minimalnych (domyślnie 1)
//   PARAWAN_FUZZ_RAPORT   plik, do którego trafia statystyka i minimalne ciągi
//   PARAWAN_FUZZ_KROKI_JSON  dokładne kroki do powtórzenia (wiersz „kroki:” z raportu) zamiast generatora
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import * as esbuild from 'esbuild';
import { chromium, firefox } from 'playwright';
import { openApp, ROOT } from './helpers.mjs';

const N = Number(process.env.PARAWAN_FUZZ_N || 30);
const SEED = Number(process.env.PARAWAN_FUZZ_SEED || Math.floor(Math.random() * 2 ** 31));
const STEPS = Number(process.env.PARAWAN_FUZZ_KROKI || 10);
const ALL = process.env.PARAWAN_FUZZ_WSZYSTKIE === '1';
const MINIMIZE = Number(process.env.PARAWAN_FUZZ_MIN ?? 1);
const REPORT = process.env.PARAWAN_FUZZ_RAPORT || '';
const REPLAY = process.env.PARAWAN_FUZZ_KROKI_JSON ? JSON.parse(process.env.PARAWAN_FUZZ_KROKI_JSON) : null;
const BROWSERS = (process.env.PARAWAN_FUZZ_PRZEGLADARKI || 'chromium,firefox').split(',').map((s) => s.trim());
const ENGINES = { chromium, firefox };

/* ── Rdzeń i zakresy z tych samych źródeł, z których buduje się aplikacja ── */

const bundle = await esbuild.build({
  stdin: {
    contents: "export { alignSpans } from './apps/web/src/spans.ts'; export { redactPII } from './packages/core/src/index.ts';",
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'error',
});
const { alignSpans, redactPII } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

/* ── Pisma (fikcyjne dane) ── */

const DOCS = [
  // A1 i A2: ten sam wzór decyzji, inne dane
  'Decyzja nr 14/2024 w sprawie działki, księga wieczysta nr OS1W/00045123/6.\nWnioskodawca Jan Kowalski, PESEL 44051401359, zam. ul. Lipowa 5, 00-950 Warszawa.\nUzasadnienie jest krótkie, organ uwzględnił wniosek w całości.',
  'Decyzja nr 14/2024 w sprawie działki, księga wieczysta nr KR1P/00012345/9.\nWnioskodawca Anna Nowak, PESEL 85071412358, zam. ul. Polna 12, 30-001 Kraków.\nUzasadnienie jest krótkie, organ uwzględnił wniosek w całości.',
  // B: Jan Kowalski jako inspektor, to samo nazwisko co wnioskodawca w A1
  'Sprawę prowadzi inspektor Jan Kowalski. Kontakt z inspektorem Jan Kowalski w pokoju 12.\nZatwierdził Jan Kowalski, Wójt Gminy Brzozowa Wola.',
  // C i C2: ten sam wzór skargi
  'Skarga z dnia 3 maja 2024 r.\nSkarżący Piotr Zieliński, zam. ul. Ogrodowa 7, 05-800 Pruszków, PESEL 90010112345, wnosi o rozpatrzenie sprawy.\nSkarżący Piotr Zieliński wskazuje, że czeka na odpowiedź urzędu.',
  'Skarga z dnia 3 maja 2024 r.\nSkarżący Jan Kowalski, zam. ul. Lipowa 5, 00-950 Warszawa, PESEL 44051401359, wnosi o rozpatrzenie sprawy.\nSkarżący Jan Kowalski wskazuje, że czeka na odpowiedź urzędu.',
];
const DOC_NAMES = ['A1', 'A2', 'B', 'C', 'C2'];
const TYPED = [' uwaga ', ' por. ', ' i ', ' zob. akta '];

/*
 * Ciągi z wcześniejszych przebiegów, które kończyły się wyciekiem. Biegną w każdej przeglądarce
 * przed losowymi, więc powtarzają się przy każdym `npm run e2e`.
 */
const REGRESSIONS = [
  // „Zostaw jawne”, dopisek, „Zasłoń ponownie”, Ctrl+Z w polu: stary wpis tekstu wskrzeszał decyzję
  [{ a: 'wklej', doc: 0 }, { a: 'znacznik', at: 0.4, co: 'tu' }, { a: 'pisz', at: 0.05, s: ' uwaga ' }, { a: 'znacznik', at: 0.4, co: 'ponownie' }, { a: 'cofnijPole' }],
  [{ a: 'wklej', doc: 0 }, { a: 'znacznik', at: 0.4, co: 'tu' }, { a: 'pisz', at: 0.05, s: ' uwaga ' }, { a: 'usunPoprawki' }, { a: 'cofnijPoleN', n: 2 }, { a: 'ponowPole' }],
  [{ a: 'wklej', doc: 0 }, { a: 'znacznik', at: 0.4, co: 'tu' }, { a: 'pisz', at: 0.05, s: ' uwaga ' }, { a: 'cofnijWynik' }, { a: 'cofnijPole' }],
  // Ctrl+Z w polu karty pisma sięgał w Chromium do pola źródła i wracał do pisma A z jego decyzją
  [{ a: 'wklej', doc: 0 }, { a: 'znacznik', at: 0.4, co: 'tu' }, { a: 'wklej', doc: 3 }, { a: 'karta' }, { a: 'cofnijKarta', n: 3 }],
  // znak sprawy cofnięty przez Ctrl+Z w polu źródła wraca przez Ctrl+Shift+Z przy tym samym piśmie
  [{ a: 'wklej', doc: 3 }, { a: 'karta' }, { a: 'cofnijPoleN', n: 2 }, { a: 'ponowPole' }, { a: 'ponowPoleS' }],
  // „Zostaw jawne” po usunięciu znaku, potem Ctrl+Z w polu: odsłonięcie zostawało w tekście sprzed edycji
  [{ a: 'wklej', doc: 4 }, { a: 'usun', at: 0.69, n: 1 }, { a: 'znacznik', at: 0.58, co: 'tu' }, { a: 'cofnijPole' }],
  [{ a: 'wklej', doc: 1 }, { a: 'pisz', at: 0.51, s: ' i ' }, { a: 'znacznik', at: 0.64, co: 'tu' }, { a: 'cofnijPole' }],
  // „Zostaw jawne wszędzie” po Ctrl+Z, potem Ctrl+Y do tekstu, w którym decyzji nie podjęto
  [
    { a: 'wklej', doc: 4 },
    { a: 'usun', at: 0.75, n: 6 },
    { a: 'cofnijPole' },
    { a: 'znacznik', at: 0.99, co: 'wszedzie' },
    { a: 'ponowPole' },
  ],
  // Ctrl+Z w wyniku bez poprawek cofał historię pola źródła
  [
    { a: 'wklej', doc: 0 },
    { a: 'fragment', doc: 1, line: 0.5, at: 0.69 },
    { a: 'wklej', doc: 4 },
    { a: 'cofnijPole' },
    { a: 'cofnijWynik' },
    { a: 'ponowPole' },
    { a: 'cofnijPole' },
    { a: 'znacznik', at: 0.49, co: 'tu' },
    { a: 'ponowPole' },
  ],
  // wklejony wnioskodawca odsłaniał się przez „Zostaw jawne wszędzie” dla inspektora o tym samym nazwisku
  [{ a: 'wklej', doc: 2 }, { a: 'znacznik', at: 0.1, co: 'wszedzie' }, { a: 'fragment', doc: 4, line: 0.5, at: 0.5 }],
  // „Zasłoń wszędzie”, potem litery doklejone do zasłoniętego tekstu (runda 1)
  [
    { a: 'wklej', doc: 1 },
    { a: 'dwie', at: 0.02, at2: 0.01, s: ' zob. akta ' },
    { a: 'zaslon', z: 'src', wszedzie: true, at: 0.32 },
    { a: 'piszW', at: 0.4, s: 'ski' },
  ],
  [{ a: 'wklej', doc: 1 }, { a: 'zaslon', z: 'out', wszedzie: true, at: 0.32 }, { a: 'piszW', at: 0.3419, s: 'a' }],
  // Ctrl+Y w polu źródła po wyzerowaniu karty dopisywał znak sprawy drugi raz (runda 3)
  [{ a: 'wklej', doc: 2 }, { a: 'karta' }, { a: 'karta' }, { a: 'wklej', doc: 0 }, { a: 'cofnijPoleN', n: 3 }, { a: 'ponowPole' }],
  // zasłonięcie przez znacznik automatu, potem Ctrl+X, zamiana albo całe pismo w środku (runda 3)
  [{ a: 'wklej', doc: 4 }, { a: 'zaslonZnacznik', at: 0.35, k: 9, wszedzie: false }, { a: 'wytnij', at: 0.3, n: 26 }],
  [{ a: 'wklej', doc: 2 }, { a: 'zaslonZnacznik', at: 0.61, k: 8, wszedzie: false }, { a: 'zamien', at: 0.56, n: 11, doc: 0, from: 0.5 }],
  [{ a: 'wklej', doc: 1 }, { a: 'zaslonZnacznik', at: 0.16, k: 6, wszedzie: true }, { a: 'wklejDoc', at: 0.36, doc: 4 }],
  // Enter w środku zasłonięcia „wszędzie” i „tutaj” (runda 3)
  [{ a: 'wklej', doc: 0 }, { a: 'zaslonZnacznik', at: 0.16, k: 6, wszedzie: true }, { a: 'enter', at: 0.09 }],
  [{ a: 'wklej', doc: 3 }, { a: 'zaslon', z: 'src', wszedzie: false, at: 0.3 }, { a: 'enter', at: 0.5 }],
  // dwuklik i inna forma wyrazu zasłoniętego „wszędzie”, przeniesienie wiersza (runda 3)
  [{ a: 'wklej', doc: 3 }, { a: 'zaslon', z: 'out', wszedzie: true, at: 0.2 }, { a: 'dwuklik', at: 0.2, s: 'zie' }],
  [{ a: 'wklej', doc: 0 }, { a: 'zaslon', z: 'out', wszedzie: true, at: 0.9 }, { a: 'wytnijWklej', at: 0.99 }],
  // edycja w środku zasłonięcia i Ctrl+Z na pasku poprawki
  [{ a: 'wklej', doc: 0 }, { a: 'zaslon', z: 'src', wszedzie: true, at: 0.05 }, { a: 'srodek', at: 0.1, pos: 0.5, s: 'x', zamien: true }, { a: 'cofnijPole' }],
  [{ a: 'wklej', doc: 2 }, { a: 'znacznik', at: 0.5, co: 'tu' }, { a: 'paskiemZ', at: 0.5 }, { a: 'cofnijPole' }],
  // „Zostaw jawne” i dopisek, potem Ctrl+Z w polu wraca do tekstu z decyzją (runda 1)
  [{ a: 'wklej', doc: 2 }, { a: 'znacznik', at: 0.2, co: 'tu' }, { a: 'pisz', at: 0.9, s: ' uwaga ' }, { a: 'cofnijPole' }],
  // Ctrl+Z w polach karty działa tylko na nich
  [{ a: 'wklej', doc: 0 }, { a: 'karta' }, { a: 'wklej', doc: 3 }, { a: 'karta' }, { a: 'cofnijKarta', n: 3, pole: 'organ' }, { a: 'cofnijKarta', n: 3, pole: 'znak' }],
];

/* ── Generator z ziarnem ── */

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seqSeed = (base, i) => (Math.imul(base ^ 0x9e3779b9, 2654435761) + i * 40503) >>> 0;

const WEIGHTS = [
  ['wklej', 4],
  ['pisz', 3],
  ['usun', 2],
  ['fragment', 2],
  ['cofnijPole', 5],
  ['ponowPole', 3],
  ['zaslon', 4],
  ['znacznik', 7],
  ['cofnijWynik', 3],
  ['ponowWynik', 1],
  ['cofnijOstatnia', 1],
  ['usunPoprawki', 1],
  ['wyczysc', 1],
  ['cofnijPasek', 2],
  ['piszW', 3],
  ['zamien', 3],
  ['duza', 1],
  ['wklejDoc', 1],
  ['dwie', 2],
  ['ponowWynikS', 1],
  ['pusto', 1],
  ['cofnijPoleN', 2],
  ['ponowPoleS', 1],
  ['karta', 2],
  ['cofnijKarta', 2],
  ['srodek', 3],
  ['enter', 2],
  ['dwuklik', 2],
  ['wytnij', 1],
  ['wytnijWklej', 2],
  ['paskiemZ', 2],
  ['zaslonZnacznik', 3],
];
const TOTAL_W = WEIGHTS.reduce((s, [, w]) => s + w, 0);

function generate(seed, len = STEPS) {
  const r = mulberry32(seed);
  const pick = (n) => Math.floor(r() * n);
  const step = (a) => {
    switch (a) {
      case 'wklej':
        return { a, doc: pick(DOCS.length) };
      case 'pisz':
        return { a, at: r(), s: TYPED[pick(TYPED.length)] };
      case 'usun':
        return { a, at: r(), n: 1 + pick(6) };
      case 'fragment':
        return { a, doc: pick(DOCS.length), line: r(), at: r() };
      case 'piszW':
        return { a, at: r(), s: ['x', 'ab', 'ski', '1'][pick(4)] };
      case 'zamien':
        return { a, at: r(), n: 2 + pick(25), doc: pick(DOCS.length), from: r() };
      case 'duza':
        return { a, at: r(), frac: 0.3 + r() * 0.18, doc: pick(DOCS.length), from: r() };
      case 'wklejDoc':
        return { a, at: r(), doc: pick(DOCS.length) };
      case 'cofnijPoleN':
        return { a, n: 2 + pick(3) };
      case 'cofnijKarta':
        return { a, n: 1 + pick(3), pole: ['znak', 'organ', 'adnotacja'][pick(3)] };
      case 'srodek':
        return { a, at: r(), pos: r(), s: ['x', 'a', ' ', '-'][pick(4)], zamien: r() < 0.5 };
      case 'enter':
      case 'wytnijWklej':
        return { a, at: r() };
      case 'dwuklik':
        return { a, at: r(), s: ['zie', 'ach', 'ą', 'ego'][pick(4)] };
      case 'wytnij':
        return { a, at: r(), n: 2 + pick(30) };
      case 'paskiemZ':
        return { a, at: r(), y: r() < 0.25 };
      case 'zaslonZnacznik':
        return { a, at: r(), k: 1 + pick(10), wszedzie: r() < 0.5 };
      case 'dwie':
        return { a, at: r(), at2: r(), s: TYPED[pick(TYPED.length)] };
      case 'zaslon':
        return { a, z: r() < 0.5 ? 'src' : 'out', wszedzie: r() < 0.5, at: r() };
      case 'znacznik':
        return { a, at: r(), co: ['tu', 'tu', 'wszedzie', 'wszedzie', 'ponownie'][pick(5)] };
      default:
        return { a };
    }
  };
  const steps = [step('wklej')];
  while (steps.length < len) {
    let x = r() * TOTAL_W;
    const [a] = WEIGHTS.find(([, w]) => (x -= w) < 0) ?? WEIGHTS[0];
    steps.push(step(a));
  }
  return steps;
}

const f2 = (x) => x.toFixed(2);
function describe(s) {
  switch (s.a) {
    case 'wklej':
      return `Ctrl+A i wklej ${DOC_NAMES[s.doc]}`;
    case 'pisz':
      return `wpisz „${s.s}” @${f2(s.at)}`;
    case 'usun':
      return `usuń ${s.n} zn. @${f2(s.at)}`;
    case 'piszW':
      return `wpisz w wyraz „${s.s}” @${f2(s.at)}`;
    case 'zamien':
      return `zaznacz ${s.n} zn. @${f2(s.at)} i wklej ${s.n} zn. z ${DOC_NAMES[s.doc]}/${f2(s.from)}`;
    case 'duza':
      return `zaznacz ${f2(s.frac)} tekstu @${f2(s.at)} i wklej kawałek ${DOC_NAMES[s.doc]}`;
    case 'wklejDoc':
      return `wklej całe ${DOC_NAMES[s.doc]} w środek @${f2(s.at)}`;
    case 'cofnijPoleN':
      return `Ctrl+Z w polu ×${s.n}`;
    case 'cofnijKarta':
      return `Ctrl+Z w polu karty „${s.pole ?? 'znak'}” ×${s.n}`;
    case 'srodek':
      return `${s.zamien ? 'zamień znak' : 'wpisz'} „${s.s}” w środku zakresu pod znacznikiem @${f2(s.at)}/${f2(s.pos)}`;
    case 'enter':
      return `Enter w miejscu spacji @${f2(s.at)}`;
    case 'dwuklik':
      return `dwuklik w wyraz @${f2(s.at)} i wpisz formę z „${s.s}”`;
    case 'wytnij':
      return `Ctrl+X ${s.n} zn. @${f2(s.at)}`;
    case 'wytnijWklej':
      return `Ctrl+X wiersza @${f2(s.at)} i Ctrl+V na końcu`;
    case 'paskiemZ':
      return `znacznik @${f2(s.at)}, fokus na pasku poprawki i ${s.y ? 'Ctrl+Y' : 'Ctrl+Z'}`;
    case 'zaslonZnacznik':
      return `Zasłoń zaznaczenie (wynik przez znacznik @${f2(s.at)} ±${s.k}, ${s.wszedzie ? 'wszędzie' : 'tu'})`;
    case 'dwie':
      return `dwie szybkie edycje „${s.s}” @${f2(s.at)} i @${f2(s.at2)}`;
    case 'fragment':
      return `wklej wiersz ${DOC_NAMES[s.doc]}/${f2(s.line)} @${f2(s.at)}`;
    case 'zaslon':
      return `Zasłoń zaznaczenie (${s.z === 'src' ? 'pole' : 'wynik'}, ${s.wszedzie ? 'wszędzie' : 'tu'}) @${f2(s.at)}`;
    case 'znacznik':
      return `znacznik @${f2(s.at)} → ${{ tu: 'Zostaw jawne / Cofnij zasłonięcie', wszedzie: '… wszędzie', ponownie: 'Zasłoń ponownie' }[s.co]}`;
    default:
      return {
        cofnijPole: 'Ctrl+Z w polu',
        ponowPole: 'Ctrl+Y w polu',
        cofnijWynik: 'Ctrl+Z w wyniku',
        ponowWynik: 'Ctrl+Y w wyniku',
        ponowWynikS: 'Ctrl+Shift+Z w wyniku',
        pusto: 'Ctrl+A i Delete w polu',
        ponowPoleS: 'Ctrl+Shift+Z w polu',
        karta: 'wpisz znak sprawy w karcie',
        cofnijOstatnia: '„Cofnij ostatnią”',
        usunPoprawki: '„Usuń wszystkie”',
        wyczysc: '„Wyczyść”',
        cofnijPasek: '„Cofnij” na pasku',
      }[s.a];
  }
}

/* ── Model odniesienia ── */

/** Znaki źródła zasłonięte w tekście `out` (null: wyniku nie da się dopasować do źródła). */
function coverage(src, out) {
  const al = alignSpans(src, out);
  if (!al) return null;
  const cov = new Uint8Array(src.length);
  for (const s of al.spans) cov.fill(1, s.start, s.end);
  return cov;
}

/** Ciągłe odcinki [start, end) znaków, dla których pred(i) jest prawdą (bez samych odstępów). */
function runs(src, pred) {
  const out = [];
  let a = -1;
  for (let i = 0; i <= src.length; i++) {
    const on = i < src.length && pred(i);
    if (on && a < 0) a = i;
    if (!on && a >= 0) {
      if (src.slice(a, i).trim()) out.push([a, i]);
      a = -1;
    }
  }
  return out;
}

/** Zmiana z `a` na `b` jako jeden odcinek: [p, a.length - s) w `a` zastąpiony przez b[p, b.length - s). */
function diff(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { p, endA: a.length - s, delta: b.length - a.length };
}

/** Każde dosłowne wystąpienie `needle` w `src`, także nachodzące na siebie. */
function literal(src, needle) {
  const out = [];
  if (!needle) return out;
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) out.push([i, i + needle.length]);
  return out;
}

const collapse = (t) => t.replace(/\s+/g, ' ').trim();
const overlap = (rs, x, y) => rs.some(([p, q]) => p < y && x < q);

/**
 * Model poprawek (M1–M5): decyzje są przypięte do dokładnego tekstu z chwili decyzji.
 * - `keeps`: odsłonięcia „Zostaw jawne” w bieżącym tekście (wyłączone, gdy urzędnik potem zasłonił
 *   to miejsce). Każda zmiana tekstu je zdejmuje.
 * - `masks`: zasłonięcia „tutaj” w bieżącym tekście. Po zmianie tekstu nie są wymagane.
 * - `opened`: miejsca odsłonięte przez „Cofnij zasłonięcie” w bieżącym tekście (wyjątki od reguł).
 * - `rules`: zasłonięcia „wszędzie”, reguły tekstowe: każde dosłowne wystąpienie ich tekstu
 *   w bieżącym piśmie ma być zasłonięte. Znikają tylko z czynnością urzędnika (lista poprawek).
 */
class Model {
  constructor() {
    /** @type {{ ranges: [number, number][], on: boolean, what: string }[]} */
    this.keeps = [];
    /** @type {{ ranges: [number, number][], what: string }[]} */
    this.masks = [];
    /** @type {[number, number][]} */
    this.opened = [];
    /** @type {{ text: string, what: string }[]} */
    this.rules = [];
    this.extra = [];
  }

  /** Ręczne decyzje, które aplikacja musi zdjąć przy zmianie tekstu (z komunikatem). */
  pinned() {
    return this.keeps.some((k) => k.on) || this.masks.length > 0;
  }

  /** Tekst się zmienił: decyzje przypięte do poprzedniego tekstu odpadają, reguły zostają. */
  sourceChanged() {
    this.keeps = [];
    this.masks = [];
    this.opened = [];
  }

  /** Czynność na poprawkach przy tym samym źródle: cov0 przed, cov1 po. */
  corrected(step, kind, src, cov0, cov1) {
    const revealed = runs(src, (i) => cov0[i] && !cov1[i]);
    const masked = runs(src, (i) => !cov0[i] && cov1[i]);
    if ((kind === 'keep' || kind === 'unmask') && step.a === 'znacznik' && step._range) {
      const [ra, rb] = step._range;
      const word = (t) => (t.toLowerCase().match(/[\p{L}\d]{3,}/gu) ?? []).map((w) => w.slice(0, 4));
      const own = new Set(word(src.slice(ra, rb)));
      for (let [x, y] of revealed) {
        while (x < y && /\s/.test(src[x])) x++;
        while (y > x && /\s/.test(src[y - 1])) y--;
        const t = src.slice(x, y);
        // sama interpunkcja na styku znaczników jest w tekście wyniku niejednoznaczna (patrz check)
        if (!/[\p{L}\p{N}]/u.test(t)) continue;
        const outside = src.slice(x, Math.max(x, Math.min(y, ra))) + src.slice(Math.min(y, Math.max(x, rb)), y);
        if (step.co === 'tu' && /[\p{L}\p{N}]/u.test(outside)) this.extra.push(`„${step._co}” odsłonił „${t}” [${x},${y}) poza klikniętym znacznikiem [${ra},${rb}) „${src.slice(ra, rb)}”`);
        if (step.co === 'wszedzie' && !word(t).some((w) => own.has(w))) this.extra.push(`„${step._co}” odsłonił „${t}”, niepodobne do klikniętego „${src.slice(ra, rb)}”`);
      }
    }
    // Zasłonięcie miejsca z decyzją „Zostaw jawne” (Zasłoń ponownie, Usuń wszystkie, Ctrl+Z w wyniku,
    // Zasłoń zaznaczenie) zawiesza tę decyzję. Wraca tylko przez cofnięcie (Ctrl+Z, Cofnij zasłonięcie).
    if (masked.length) for (const k of this.keeps) if (k.on && k.ranges.some(([x, y]) => overlap(masked, x, y))) k.on = false;
    if (kind === 'unmask' && revealed.length) {
      for (const k of this.keeps) if (!k.on && k.ranges.some(([x, y]) => overlap(revealed, x, y))) k.on = true;
    }
    if (kind === 'keep') for (const r of revealed) this.keeps.push({ ranges: [r], on: true, what: describe(step) });
    // „Cofnij zasłonięcie” klikiem w znacznik: to miejsce reguły „wszędzie” może być jawne w tym tekście.
    if (kind === 'unmask' && step.a === 'znacznik') this.opened.push(...revealed);
    if (kind === 'mask' && masked.length && !step._rule) this.masks.push({ ranges: masked, what: describe(step) });
    if (step._rule) this.rules.push({ text: step._rule, what: describe(step) });
    if (kind === 'keep' || kind === 'unmask') {
      for (const m of this.masks) m.ranges = m.ranges.filter(([x, y]) => !overlap(revealed, x, y));
      this.masks = this.masks.filter((m) => m.ranges.length);
    }
  }

  /**
   * Reguły „wszędzie” z listy poprawek aplikacji (tekst bez zwiniętych odstępów). Reguła znika
   * z modelu, gdy nie ma jej na liście; zwraca te, które zniknęły.
   */
  syncRules(listed) {
    const pool = [...listed];
    const alive = [];
    const lost = [];
    for (const r of this.rules) {
      const k = pool.indexOf(collapse(r.text));
      if (k === -1) lost.push(r);
      else {
        pool.splice(k, 1);
        alive.push(r);
      }
    }
    this.rules = alive;
    return lost;
  }

  /** Zakresy, które w bieżącym tekście wolno pokazać jawnie zamiast danej automatu. */
  allowed() {
    return this.keeps.filter((k) => k.on).flatMap((k) => k.ranges);
  }

  /** Naruszenia w kanale `name` dla wyniku `out`. */
  check(name, src, out, auto) {
    const cov = coverage(src, out);
    if (!cov) return [`${name}: wyniku nie da się dopasować do źródła:\n${out}`];
    const ok = this.allowed();
    const free = (i) => ok.some(([x, y]) => x <= i && i < y);
    const errs = [];
    for (const s of auto) {
      if (runs(src, (i) => i >= s.start && i < s.end && !cov[i] && !free(i)).length) {
        errs.push(`${name}: jawne „${src.slice(s.start, s.end)}” [${s.tokens.join(', ')}] bez decyzji „Zostaw jawne” podjętej na tym tekście`);
      }
    }
    for (const m of this.masks) {
      for (const [x, y] of m.ranges) {
        if (runs(src, (i) => i >= x && i < y && !cov[i]).some(([p, q]) => /[\p{L}\p{N}]/u.test(src.slice(p, q)))) {
          errs.push(`${name}: ręcznie zasłonięte „${src.slice(x, y)}” (${m.what}) jawne bez decyzji`);
        }
      }
    }
    for (const r of this.rules) {
      for (const [x, y] of literal(src, r.text)) {
        // Sama interpunkcja na styku znaczników („[IMIĘ I NAZWISKO] [ADRES],”) jest w tekście wyniku
        // niejednoznaczna: dopasowanie może przypisać przecinek dowolnej stronie. Liczą się litery i cyfry.
        const open = runs(src, (i) => i >= x && i < y && !cov[i] && !free(i) && !this.opened.some(([p, q]) => p <= i && i < q)).filter(
          ([p, q]) => /[\p{L}\p{N}]/u.test(src.slice(p, q)),
        );
        if (open.length) errs.push(`${name}: jawne wystąpienie „${r.text}” reguły „wszędzie” (${r.what})`);
      }
    }
    return errs;
  }
}

/** Odniesienie: inne pismo (jak isOtherDocument w publikacja.ts). */
function otherDoc(before, after) {
  if (before === after) return false;
  if (!before.trim() || !after.trim()) return true;
  const d = diff(before, after);
  const s = before.length - d.endA;
  return (before.length - d.p - s) * 2 > before.length || (after.length - d.p - s) * 2 > after.length;
}

/* ── Przebieg jednego ciągu w przeglądarce ── */

const SETTLE_MS = 350;

async function settle(page, ms = SETTLE_MS) {
  await page.waitForTimeout(ms);
  await page.waitForFunction(() => !document.getElementById('output')?.hasAttribute('aria-busy'));
}

/** Tekst widoku „Wynik” wiersz po wierszu (bez numerów wierszy), null przy pustym polu. */
const readResult = (page) =>
  page.evaluate(() => {
    const out = document.getElementById('output');
    if (!out || out.querySelector('.placeholder')) return null;
    if (out.classList.contains('plain')) return out.textContent ?? '';
    return [...out.querySelectorAll(':scope > .cl')]
      .map((d) => {
        const t = d.lastElementChild?.textContent ?? '';
        return t === '\u00a0' ? '' : t;
      })
      .join('\n');
  });

async function visible(page, sel) {
  const l = page.locator(sel);
  return (await l.count()) > 0 && (await l.first().isVisible()) && (await l.first().isEnabled());
}

/** Ustawia zaznaczenie w polu źródła i pisze albo usuwa (jedna edycja w jednym miejscu). */
async function editAt(page, start, end, text) {
  const ta = page.locator('#input');
  await ta.focus();
  await ta.evaluate((el, [a, b]) => el.setSelectionRange(a, b), [start, end]);
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press('Backspace');
}

const wsPositions = (src) => [...src.matchAll(/ /g)].map((m) => m.index);

/** Zakresy źródła pod znacznikami wyniku [start, end), w kolejności dokumentu. */
const markRanges = (page, len) =>
  page.evaluate((len) => {
    const items = [...document.querySelectorAll('#output [data-o], #output mark.pii, #output mark.pii-kept')];
    const out = [];
    for (let k = 0; k < items.length; k++) {
      const el = items[k];
      if (el.dataset.o !== undefined) continue;
      // fragment przywrócony ręcznie ma w sobie tekst oryginału z data-o
      const inner = [...el.querySelectorAll('[data-o]')];
      if (inner.length) {
        const last = inner[inner.length - 1];
        out.push([Number(inner[0].dataset.o), Number(last.dataset.o) + (last.textContent ?? '').length]);
        continue;
      }
      let a = 0;
      let b = len;
      for (let j = k - 1; j >= 0; j--) {
        const p = items[j];
        if (p.dataset.o !== undefined && !el.contains(p)) {
          a = Number(p.dataset.o) + (p.textContent ?? '').length;
          break;
        }
      }
      for (let j = k + 1; j < items.length; j++) {
        const n = items[j];
        if (n.dataset.o !== undefined) {
          b = Number(n.dataset.o);
          break;
        }
      }
      out.push([a, b]);
    }
    return out;
  }, len);

/** Ustawia zaznaczenie w wyniku na [a, b) źródła (tekst wokół znacznika, przez sam znacznik). */
const selectOut = (page, a, b) =>
  page.evaluate(
    ([a, b]) => {
      const at = (pos, end) => {
        for (const el of document.querySelectorAll('#output [data-o]')) {
          const o = Number(el.dataset.o);
          const t = el.firstChild;
          if (!t || t.nodeType !== Node.TEXT_NODE) continue;
          if (end ? o < pos && pos <= o + t.data.length : o <= pos && pos < o + t.data.length) return [t, pos - o];
        }
        return null;
      };
      const s = at(a, false);
      const e = at(b, true);
      if (!s || !e) return false;
      const r = document.createRange();
      r.setStart(s[0], s[1]);
      r.setEnd(e[0], e[1]);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      return true;
    },
    [a, b],
  );

/**
 * Kończy „Zasłoń zaznaczenie”: ustawia „wszystkie wystąpienia” i zapisuje w kroku tekst reguły
 * (dosłowny fragment źródła, który pokazuje wiersz). Zwraca false, gdy wiersz się nie otworzył.
 */
async function applyForm(page, step, src, start, end) {
  if (!(await visible(page, '#fix-apply'))) return false;
  const all = page.locator('#fix-all');
  const rule = (await all.isEnabled()) && step.wszedzie;
  if (await all.isEnabled()) await all.setChecked(step.wszedzie);
  if (rule) {
    const shown = ((await page.locator('#fix-form-val').textContent()) ?? '').trim();
    const re = new RegExp(shown.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\S\\n]+'), 'g');
    let best = null;
    for (const m of src.matchAll(re)) {
      const a = m.index;
      const b = a + m[0].length;
      const ov = Math.min(b, end) - Math.max(a, start);
      if (ov > 0 && (!best || ov > best.ov)) best = { ov, text: m[0] };
    }
    if (best) step._rule = best.text;
  }
  await page.locator('#fix-apply').click();
  return true;
}

/** Wykonuje krok. Zwraca rodzaj czynności dla modelu albo null, gdy krok nic nie zrobił. */
async function perform(page, step, browserName) {
  const src = await page.locator('#input').inputValue();
  const ta = page.locator('#input');
  delete step._rule;
  switch (step.a) {
    case 'wklej': {
      await ta.focus();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.insertText(DOCS[step.doc]);
      return 'source';
    }
    case 'pisz': {
      const ws = wsPositions(src);
      if (!ws.length) return null;
      const at = ws[Math.floor(step.at * ws.length)];
      await editAt(page, at, at, step.s);
      return 'source';
    }
    case 'usun': {
      if (!src) return null;
      const at = Math.floor(step.at * src.length);
      await editAt(page, at, Math.min(src.length, at + step.n), '');
      return 'source';
    }
    case 'fragment': {
      const lines = DOCS[step.doc].split('\n');
      const line = lines[Math.floor(step.line * lines.length)];
      const ws = wsPositions(src);
      const at = ws.length ? ws[Math.floor(step.at * ws.length)] : src.length;
      await editAt(page, at, at, ` ${line} `);
      return 'source';
    }
    case 'piszW': {
      if (!src) return null;
      const at = Math.floor(step.at * src.length);
      await editAt(page, at, at, step.s);
      return 'source';
    }
    case 'zamien': {
      if (!src) return null;
      const at = Math.floor(step.at * src.length);
      const d = DOCS[step.doc];
      const f = Math.floor(step.from * Math.max(1, d.length - step.n));
      await editAt(page, at, Math.min(src.length, at + step.n), d.slice(f, f + step.n));
      return 'source';
    }
    case 'duza': {
      if (!src) return null;
      const len = Math.floor(step.frac * src.length);
      const at = Math.floor(step.at * (src.length - len));
      const d = DOCS[step.doc];
      const f = Math.floor(step.from * Math.max(1, d.length - len));
      await editAt(page, at, at + len, d.slice(f, f + len));
      return 'source';
    }
    case 'wklejDoc': {
      const ws = wsPositions(src);
      const at = ws.length ? ws[Math.floor(step.at * ws.length)] : src.length;
      await editAt(page, at, at, ` ${DOCS[step.doc]} `);
      return 'source';
    }
    case 'dwie': {
      const ws = wsPositions(src);
      if (ws.length < 2) return null;
      const a1 = ws[Math.floor(step.at * ws.length)];
      await editAt(page, a1, a1, step.s);
      step._mids = [await ta.inputValue()];
      const ws2 = wsPositions(step._mids[0]);
      const a2 = ws2[Math.floor(step.at2 * ws2.length)];
      await editAt(page, a2, a2, step.s);
      return 'source';
    }
    case 'srodek': {
      // edycja w środku zasłonięcia: litera wpisana albo zamieniona w środku zakresu pod znacznikiem
      const rs = (await markRanges(page, src.length)).filter(([a, b]) => b - a >= 3);
      if (!rs.length) return null;
      const [a, b] = rs[Math.floor(step.at * rs.length)];
      const at = a + 1 + Math.floor(step.pos * (b - a - 2));
      await editAt(page, at, step.zamien ? at + 1 : at, step.s);
      return 'source';
    }
    case 'enter': {
      // Enter w miejscu spacji, najchętniej w środku zakresu pod znacznikiem
      const rs = await markRanges(page, src.length);
      const inside = wsPositions(src).filter((i) => rs.some(([a, b]) => a < i && i < b - 1));
      const ws = inside.length ? inside : wsPositions(src);
      if (!ws.length) return null;
      const at = ws[Math.floor(step.at * ws.length)];
      await ta.focus();
      await ta.evaluate((el, a) => el.setSelectionRange(a, a + 1), at);
      await page.keyboard.press('Enter');
      return 'source';
    }
    case 'dwuklik': {
      // dwuklik w Windows zaznacza wyraz razem z odstępem za nim; urzędnik wpisuje inną formę
      const words = [...src.matchAll(/\p{L}{4,} /gu)];
      if (!words.length) return null;
      const w = words[Math.floor(step.at * words.length)];
      const stem = w[0].slice(0, -2);
      await editAt(page, w.index, w.index + w[0].length, `${stem}${step.s} `);
      return 'source';
    }
    case 'wytnij': {
      if (!src) return null;
      const at = Math.floor(step.at * src.length);
      await ta.focus();
      await ta.evaluate((el, [a, b]) => el.setSelectionRange(a, b), [at, Math.min(src.length, at + step.n)]);
      await page.keyboard.press('ControlOrMeta+x');
      return 'source';
    }
    case 'wytnijWklej': {
      // przeniesienie wiersza: Ctrl+X wiersza z końcem wiersza, Ctrl+V na końcu pisma
      const lines = [...src.matchAll(/[^\n]*\n/g)];
      if (!lines.length) return null;
      const l = lines[Math.floor(step.at * lines.length)];
      await ta.focus();
      await ta.evaluate((el, [a, b]) => el.setSelectionRange(a, b), [l.index, l.index + l[0].length]);
      await page.keyboard.press('ControlOrMeta+x');
      await page.waitForTimeout(80);
      const cut = await ta.inputValue();
      step._mids = [cut];
      await ta.evaluate((el) => el.setSelectionRange(el.value.length, el.value.length));
      await page.keyboard.press('Enter');
      step._mids.push(await ta.inputValue());
      await page.keyboard.press('ControlOrMeta+v');
      return 'source';
    }
    case 'pusto':
      await ta.focus();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Delete');
      return 'source';
    case 'cofnijPoleN': {
      step._mids = [];
      for (let k = 0; k < step.n; k++) {
        await ta.focus();
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForTimeout(80);
        step._mids.push(await ta.inputValue());
      }
      return 'source';
    }
    case 'cofnijKarta': {
      const sel = { znak: '#pub-znak', organ: '#pub-organ', adnotacja: '#pub-adnotacja' }[step.pole ?? 'znak'];
      if (!(await visible(page, sel))) return null;
      for (let k = 0; k < step.n; k++) {
        await page.locator(sel).focus();
        await page.keyboard.press('ControlOrMeta+z');
        await page.waitForTimeout(80);
      }
      return 'karta-cofnij';
    }
    case 'ponowPoleS':
      await ta.focus();
      await page.keyboard.press('ControlOrMeta+Shift+z');
      return 'source';
    case 'karta': {
      const ok = await page.evaluate(() => {
        const d = document.getElementById('publikacja');
        if (!d || d.hidden) return false;
        d.open = true;
        return true;
      });
      if (!ok || !(await visible(page, '#pub-znak'))) return null;
      await page.locator('#pub-znak').fill('ZN.6220.' + Math.floor(step.at ?? 1) + '.2024');
      return 'karta';
    }
    case 'ponowWynikS':
      await page.locator('#output').focus();
      await page.keyboard.press('ControlOrMeta+Shift+z');
      return 'unmask';
    case 'cofnijPole':
      await ta.focus();
      await page.keyboard.press('ControlOrMeta+z');
      return 'source';
    case 'ponowPole':
      await ta.focus();
      await page.keyboard.press(browserName === 'firefox' ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+y');
      return 'source';
    case 'wyczysc':
      await page.locator('#clear').click();
      return 'source';
    case 'cofnijPasek':
      if (!(await visible(page, '#app-note-undo'))) return null;
      await page.locator('#app-note-undo').click();
      return 'source';
    case 'zaslon': {
      if (!src) return null;
      const words = [...src.matchAll(/[A-Z0-9]{4}\/\d{8}\/\d|\p{Lu}\p{Ll}{3,}|\p{Ll}{5,}/gu)];
      if (!words.length) return null;
      const w = words[Math.floor(step.at * words.length)];
      const start = w.index;
      const end = start + w[0].length;
      if (step.z === 'src') {
        await ta.focus();
        await ta.evaluate((el, [a, b]) => el.setSelectionRange(a, b), [start, end]);
        await ta.dispatchEvent('select');
        if (!(await visible(page, '#fix-sel-src'))) return null;
        await page.locator('#fix-sel-src').click();
      } else {
        if (!(await selectOut(page, start, end))) return null;
        await page.waitForTimeout(60);
        if (!(await visible(page, '#fix-sel-out'))) return null;
        await page.locator('#fix-sel-out').click();
      }
      return (await applyForm(page, step, src, start, end)) ? 'mask' : null;
    }
    case 'zaslonZnacznik': {
      // zaznaczenie w wyniku od kilku znaków przed znacznikiem do kilku znaków za nim
      const rs = await markRanges(page, src.length);
      if (!rs.length) return null;
      const [a, b] = rs[Math.floor(step.at * rs.length)];
      const start = Math.max(0, a - step.k);
      const end = Math.min(src.length, b + step.k);
      if (!(await selectOut(page, start, end))) return null;
      await page.waitForTimeout(60);
      if (!(await visible(page, '#fix-sel-out'))) return null;
      await page.locator('#fix-sel-out').click();
      return (await applyForm(page, step, src, start, end)) ? 'mask' : null;
    }
    case 'znacznik': {
      const marks = page.locator('#output mark.pii, #output mark.pii-kept');
      const n = await marks.count();
      if (!n) return null;
      const k = Math.floor(step.at * n);
      step._range = (await markRanges(page, src.length))[k];
      await marks.nth(k).click();
      await page.waitForTimeout(60);
      const sel = { tu: '#fix-keep', wszedzie: '#fix-keep-all', ponownie: '#fix-remask' }[step.co];
      if (!(await visible(page, sel))) return null;
      const label = (await page.locator(sel).textContent()) ?? '';
      await page.locator(sel).click();
      // „Zasłoń ponownie” tuż po „Zostaw jawne” zdejmuje tamtą decyzję, a dana wraca do automatu:
      // nie powstaje ręczne zasłonięcie, które trzeba by potem pilnować.
      step._co = label;
      if (step.co === 'ponownie') return 'remask';
      return label.startsWith('Cofnij') ? 'unmask' : 'keep';
    }
    case 'paskiemZ': {
      // Ctrl+Z z fokusem na przycisku paska poprawki: cofa ostatnią czynność, nie pismo w polu
      const marks = page.locator('#output mark.pii, #output mark.pii-kept');
      const n = await marks.count();
      if (!n) return null;
      await marks.nth(Math.floor(step.at * n)).click();
      await page.waitForTimeout(60);
      const btn = page.locator('#fix-bar button:visible').first();
      if (!(await btn.count())) return null;
      await btn.focus();
      await page.keyboard.press(step.y ? 'ControlOrMeta+y' : 'ControlOrMeta+z');
      return 'unmask';
    }
    case 'cofnijWynik':
    case 'ponowWynik':
      await page.locator('#output').focus();
      await page.keyboard.press(step.a === 'cofnijWynik' ? 'ControlOrMeta+z' : 'ControlOrMeta+y');
      return 'unmask';
    case 'cofnijOstatnia':
      if (!(await visible(page, '#fix-undo'))) return null;
      await page.locator('#fix-undo').click();
      return 'unmask';
    case 'usunPoprawki':
      if (!(await visible(page, '#fix-clear'))) return null;
      await page.locator('#fix-clear').click();
      return 'unmask';
  }
  return null;
}

/** Wszystkie kanały wyjścia: ekran, druk, schowek i .txt. */
async function channels(page) {
  const ch = [['wynik na ekranie', await readResult(page)]];
  if (ch[0][1] === null) return [];
  ch.push(['druk', (await page.locator('#print-out').textContent()) ?? '']);
  // Przycisk bywa wyłączony (ręcznych zasłonięć nie da się nałożyć): ten kanał wtedy odpada.
  const before = await page.evaluate(() => window.__fuzzSchowek.length);
  if (await page.locator('#copy').click({ timeout: 2000 }).then(() => true, () => false)) {
    const copied = await page
      .waitForFunction((n) => window.__fuzzSchowek.length > n, before, { timeout: 2000 })
      .then(() => page.evaluate(() => window.__fuzzSchowek.at(-1) ?? ''), () => null);
    if (copied !== null) ch.push(['schowek', copied]);
  }
  const file = await Promise.all([
    page.waitForEvent('download', { timeout: 3000 }),
    page.locator('#download').click({ timeout: 2000 }),
  ]).then(
    ([d]) => d,
    () => null,
  );
  if (file) {
    const txt = readFileSync(await file.path(), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    ch.push(['.txt', txt]);
  }
  return ch;
}

/**
 * Teksty reguł „wszędzie” z listy poprawek (po rozwinięciu „Pokaż” kliknięciem bez fokusu), null
 * przy pustym polu: wtedy listy nie ma na ekranie, a reguły i tak zostają w aplikacji.
 */
const listedRules = (page) =>
  page.evaluate(() => {
    const foot = document.getElementById('fix-foot');
    const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
    if (!input.value.trim() || document.querySelector('#output .placeholder')) return null;
    if (!foot || foot.hidden) return [];
    const show = document.getElementById('fix-show');
    if (show && !show.closest('[hidden]') && show.getAttribute('aria-expanded') !== 'true') show.click();
    const out = [];
    for (const s of document.querySelectorAll('#fix-list li > span:first-child')) {
      const t = s.textContent ?? '';
      const at = t.indexOf('] wszędzie: ');
      if (!t.startsWith('Zasłonięto jako [') || at === -1) continue;
      const body = t.slice(at + '] wszędzie: '.length);
      out.push(body.slice(0, body.lastIndexOf(', ')));
    }
    return out;
  });

const RESETS = new Set(['wyczysc', 'cofnijPasek']);
const OUTSIDE = new Set(['cofnijWynik', 'ponowWynik', 'ponowWynikS', 'paskiemZ', 'cofnijOstatnia', 'usunPoprawki', 'karta', 'cofnijKarta']);
const FIELD_HISTORY = new Set(['cofnijPole', 'ponowPole', 'cofnijPoleN', 'ponowPoleS']);

/**
 * Wykonuje ciąg i zwraca pierwszy błąd: { at, errors, log } albo null.
 * @param {import('playwright').Browser} browser
 */
async function runSequence(browser, browserName, steps, { clean = false } = {}) {
  const app = await openApp(browser, '', {
    prepare: (ctx) =>
      ctx.addInitScript(() => {
        // Schowek przechwycony w stronie: ten sam tekst co navigator.clipboard.writeText w aplikacji.
        const log = [];
        Object.defineProperty(window, '__fuzzSchowek', { value: log });
        const cb = { writeText: async (t) => void log.push(String(t)), readText: async () => log.at(-1) ?? '' };
        Object.defineProperty(Navigator.prototype, 'clipboard', { get: () => cb, configurable: true });
      }),
  });
  const { page } = app;
  const model = new Model();
  const log = [];
  let src = '';
  let znak = '';
  let cov = new Uint8Array(0);
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      let kind;
      const pinned = model.pinned();
      try {
        kind = await perform(page, step, browserName);
      } catch (e) {
        // Krok, którego przeglądarka nie dała wykonać, też jest błędem do obejrzenia.
        log.push(`${i + 1}. ${describe(step)}`);
        return { at: i, errors: [`wyjątek w kroku: ${String(e?.message ?? e).split('\n')[0]}`], log, src };
      }
      await settle(page, kind === 'source' ? SETTLE_MS : 120);
      let next = await page.locator('#input').inputValue();
      log.push(`${i + 1}. ${describe(step)}${kind ? '' : ' (bez skutku)'}`);
      const errors = [];
      // Skrót poza polem źródła (wynik, pasek poprawki, karta) nigdy nie zmienia tekstu źródła.
      if (next !== src && OUTSIDE.has(step.a)) {
        errors.push(`${describe(step)} zmieniło tekst źródła`);
        await settle(page);
        next = await page.locator('#input').inputValue();
      }
      // Przerwa przed przeliczeniem rośnie z kosztem poprzedniego (do 2 s): czekamy, aż wynik
      // dotyczy tekstu z pola, zanim sprawdzimy kanały.
      for (let t = 0; t < 30 && next.trim(); t++) {
        const shown = await readResult(page);
        if (shown !== null && alignSpans(next, shown)) break;
        await page.waitForTimeout(100);
      }
      // „Wyczyść” i „Cofnij” na pasku liczą się tylko wtedy, gdy krok coś zrobił.
      const resetStep = !!kind && RESETS.has(step.a);
      const seq = [src, ...(step._mids ?? []), next];
      const changed = seq.some((t, k) => k > 0 && t !== seq[k - 1]);
      const outs = await channels(page); if (process.env.DBG) console.log("DBG", JSON.stringify(outs[0]?.[1]));
      const result = outs[0]?.[1] ?? null;
      const cov1 = result === null ? new Uint8Array(next.length) : coverage(next, result);
      if (changed || resetStep) model.sourceChanged();
      if (resetStep) model.rules = [];
      else if (!changed && kind && kind !== 'source' && cov1 && cov.length === next.length) {
        model.corrected(step, kind, next, cov, cov1);
      }
      const listed = await listedRules(page);
      if (listed) {
        const lost = model.syncRules(listed);
        if (lost.length && (changed || FIELD_HISTORY.has(step.a)) && !resetStep) {
          errors.push(`zasłonięcie „wszędzie” „${lost[0].text}” zniknęło z listy po zmianie tekstu`);
        }
      }
      // M1: zmiana tekstu, która zdjęła ręczne decyzje, daje notkę przy liście poprawek.
      if (changed && pinned && next.trim() && !resetStep) {
        const note = (await page.locator('#fix-note').textContent()) ?? '';
        if (!note.includes('trzeba zrobić od nowa')) errors.push('zmiana tekstu zdjęła ręczne poprawki bez notki przy liście poprawek');
      }
      src = next;
      if (cov1) cov = cov1;
      const al = next.trim() ? alignSpans(next, redactPII(next).redacted) : null;
      const auto = al ? al.spans : [];
      errors.push(...outs.flatMap(([name, out]) => model.check(name, next, out, auto)));
      if (model.extra.length) {
        errors.push(...model.extra);
        model.extra = [];
      }
      // M4: karta zeruje się przy zmianie ponad połowy tekstu, przy Ctrl+A i wklejeniu, przy
      // pustym polu, „Wyczyść” i „Cofnij” na pasku. Poza tym zostaje, także po Ctrl+Z i Ctrl+Y
      // w polu źródła, które w Chromium trafiają na wpis karty.
      {
        const now = await page.locator('#pub-znak').inputValue();
        const reset = resetStep || seq.some((t, k) => k > 0 && t !== seq[k - 1] && otherDoc(seq[k - 1], t));
        const allowed =
          kind === 'karta' || kind === 'karta-cofnij'
            ? [now]
            : reset
              ? ['']
              : step.a === 'wklej'
                ? ['', znak]
                : [znak];
        if (!allowed.includes(now)) {
          errors.push(
            reset
              ? `karta: znak sprawy „${now}” został przy innym piśmie`
              : `karta: znak sprawy zmienił się z „${znak}” na „${now}” bez zmiany pisma`,
          );
        }
        znak = now;
      }
      if (app.pageErrors.length) errors.push(`błąd strony: ${app.pageErrors.join(' | ')}`);
      if (errors.length) return { at: i, errors: [...new Set(errors)], log, src: next };
    }
    if (clean) await app.assertClean();
    return null;
  } finally {
    await app.close();
  }
}

/** Skraca błędny ciąg: najpierw do kroku z błędem, potem zdejmuje po jednym kroku, dopóki błąd zostaje. */
async function minimize(browser, browserName, steps, fail, budget = 40) {
  let best = steps.slice(0, fail.at + 1);
  let bestFail = fail;
  let changed = true;
  while (changed && budget > 0) {
    changed = false;
    for (let i = best.length - 1; i >= 1 && budget > 0; i--) {
      const cand = best.filter((_, k) => k !== i);
      budget--;
      const f = await runSequence(browser, browserName, cand);
      if (f) {
        best = cand.slice(0, f.at + 1);
        bestFail = f;
        changed = true;
        i = Math.min(i, best.length);
      }
    }
  }
  return { steps: best, fail: bestFail };
}

/* ── Testy ── */

const report = { seed: SEED, sequences: 0, failed: 0, byBrowser: {}, minimal: [] };

function writeReport() {
  if (!REPORT) return;
  const lines = [
    `Fuzzer korekty: ziarno ${report.seed}, ciągów ${report.sequences}, z błędem ${report.failed}, kroków w ciągu ${STEPS}`,
    ...Object.entries(report.byBrowser).map(([b, s]) => `  ${b}: ${s.failed} z ${s.sequences}; rodzaje: ${JSON.stringify(s.kinds)}`),
    '',
    ...report.minimal.flatMap((m, k) => [
      `Minimalny ciąg ${k + 1} (${m.browser}, ziarno ciągu ${m.seed}, ${m.steps.length} kroków):`,
      ...m.log,
      ...m.errors.map((e) => `  BŁĄD ${e}`),
      `  źródło: ${JSON.stringify(m.src)}`,
      `  kroki: ${JSON.stringify(m.steps)}`,
      '',
    ]),
  ];
  writeFileSync(REPORT, lines.join('\n'), 'utf8');
}

const errKind = (e) =>
  e.replace(/^[^:]+: /, '').replace(/„[^”]*”/g, '„…”').replace(/\[[^\]]*\]/g, '[…]').replace(/\(.*\)/, '(…)');

BROWSERS.forEach((name, bi) => {
  const engine = ENGINES[name];
  const missing = !engine ? `nieznana przeglądarka ${name}` : !existsSync(engine.executablePath()) ? `brak ${name} z Playwright` : false;
  test(`fuzzer ręcznej korekty i karty pisma (${name}, ziarno ${SEED})`, { skip: missing, timeout: Number.POSITIVE_INFINITY }, async () => {
    const browser = await engine.launch();
    const stats = { sequences: 0, failed: 0, kinds: {} };
    report.byBrowser[name] = stats;
    const failures = [];
    const signatures = new Set();
    try {
      // Najpierw ciągi z wcześniejszych błędów (ziarno -1 do -n), potem losowe.
      const fixed = REPLAY ? [] : REGRESSIONS.map((steps, k) => ({ i: -1 - k, seed: -1 - k, steps }));
      const random = [];
      for (let i = bi; i < N; i += BROWSERS.length) random.push({ i, seed: seqSeed(SEED, i), steps: REPLAY ?? generate(seqSeed(SEED, i)) });
      for (const { i, seed, steps } of [...fixed, ...random]) {
        stats.sequences++;
        report.sequences++;
        const fail = await runSequence(browser, name, steps, { clean: i >= 0 && i < BROWSERS.length });
        if (!fail) continue;
        stats.failed++;
        report.failed++;
        for (const e of fail.errors) stats.kinds[errKind(e)] = (stats.kinds[errKind(e)] ?? 0) + 1;
        // Skracamy błędy różnego rodzaju (rodzaj naruszenia i krok, po którym wyszło).
        const sig = `${errKind(fail.errors[0])}|${steps[fail.at].a}`;
        if (failures.length < Math.max(1, MINIMIZE) && !signatures.has(sig)) {
          signatures.add(sig);
          const min = MINIMIZE > 0 ? await minimize(browser, name, steps, fail) : { steps, fail };
          const entry = { browser: name, seed, steps: min.steps, log: min.fail.log, errors: min.fail.errors, src: min.fail.src };
          failures.push(entry);
          report.minimal.push(entry);
          writeReport();
        }
        if (!ALL) break;
      }
    } finally {
      await browser.close();
      writeReport();
    }
    if (failures.length) {
      const f = failures[0];
      assert.fail(
        [
          `${stats.failed} z ${stats.sequences} ciągów z błędem (${name}). Powtórz: PARAWAN_FUZZ_SEED=${SEED} PARAWAN_FUZZ_N=${N} ` +
            `(ziarno ciągu ${f.seed}). Minimalny ciąg:`,
          ...f.log,
          ...f.errors.map((e) => `  ${e}`),
          `  źródło: ${JSON.stringify(f.src)}`,
        ].join('\n'),
      );
    }
  });
});
