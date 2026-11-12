// Post-processing wyjścia neuronowego NER (token-classification) na maski osobowe; szew dla dodatku AI.

import { HOMOGRAPH_SURNAMES, isGeoAdjective, normalizeSurnameKey } from './surnames.js';
import { NON_PERSON_CONTEXT } from './guards/eponyms.js';
import { LEGAL_ENTITY_WORDS } from './guards/roles.js';
import { PERSON_MASK } from './types.js';

const DEFAULT_MIN_SCORE = 0.5;
// Gołych homonimów (Wilk, Lis) nie maskujemy nawet przy wysokim score: model daje „Lis przemknął
// przez drogę" ≥0.9. Osobę z kontekstem (imię obok, „Pan") łapie wcześniej rdzeń.
const DEFAULT_HOMOGRAPH_MIN_SCORE = Infinity;

// Dowolna litera Unicode, żeby obce nazwiska (Müller, Nguyễn) nie gubiły końcówek.
const LETTER = /\p{L}/u;
const NON_LETTER_G = /\P{L}/gu;
const UPPER_START = /^\p{Lu}/u;
// Litera albo myślnik: rozszerzanie spanu na całe słowo (Nowak-Schmidt, „Gz" do „Gzowski").
const WORD_CHAR = /[\p{L}-]/u;
// Placeholdery rdzenia są nietykalne (idempotencja).
const MASK_SPAN = /\[[^\][\n]*\]/gu;
// Znaczniki XML/HTML nietykalne: model taguje nazwy elementów (</Customer>) jako osoby.
const TAG_SPAN = /<[^<>\n]{1,80}>/gu;

// Rzeczowniki pospolite z wielkiej litery na początku zdania, które model taguje jako osobę.
// Bramka „wielka litera" (potrzebna obcym nazwiskom) ich nie odrzuci; żaden nie jest nazwiskiem.
const NER_COMMON_NOUNS = new Set<string>(
  (
    'sprawa sprawie sprawy sprawą sprawozdanie postanowienie postanowieniu rozpoznanie ' +
    'uzasadnienie oświadczenie zawiadomienie wezwanie wezwaniu orzeczenie odwołanie zażalenie ' +
    'skarga skargę skargi protokół protokole notatka notatkę notatki pełnomocnictwo upoważnienie ' +
    'zaświadczenie potwierdzenie zgłoszenie rozstrzygnięcie zarządzenie kotłownia'
  ).split(/\s+/),
);

/** Pojedyncza encja z pipeline `token-classification`. `start`/`end` są opcjonalne, bo transformers.js
 *  ich nie zwraca (issue #359). */
export interface NerToken {
  entity: string;
  word: string;
  score?: number;
  /** Nieużywane, zgodność z wyjściem transformers.js. */
  index?: number;
  start?: number;
  end?: number;
}

export interface NerPostprocessOptions {
  /** Placeholder maski. Domyślnie `[IMIĘ I NAZWISKO]`. */
  mask?: string;
  /** Minimalny score pierwszego tokena grupy (strategia „first"). Domyślnie 0.5. */
  minScore?: number;
  /** Czy etykieta oznacza osobę. Domyślnie: `nam_liv_person` / `PER` / `persName`. */
  isPersonLabel?: (entity: string) => boolean;
  /** Odrzuć kandydata (true: nie maskuj). Domyślnie: przymiotniki geo i słowa instytucji. */
  isStopword?: (candidate: string) => boolean;
  /** Czy kandydat to homonim rzeczownika pospolitego (Wilk, Baran). Domyślnie: HOMOGRAPH_SURNAMES. */
  isHomograph?: (candidate: string) => boolean;
  /** Homonim maskujemy tylko przy score >= tej wartości. Domyślnie Infinity, czyli nigdy (opt-in np. 0.9). */
  homographMinScore?: number;
}

export interface NerPostprocessResult {
  redacted: string;
  found: { type: 'IMIE'; count: number }[];
}

/** Domyślny predykat etykiety osobowej: FastPDN (nam_liv_person), wikiann (PER), spaCy. */
export function defaultIsPersonLabel(entity: string): boolean {
  const e = String(entity ?? '');
  return e.includes('nam_liv_person') || e.endsWith('PER') || e.includes('persName');
}

/**
 * Odrzuca przymiotniki geo/narodowe (Warszawski, też w odmianie) i słowa instytucji. Wielowyrazowca
 * odrzuca, gdy którykolwiek człon pasuje, żeby „Sąd Najwyższy" nie został zamaskowany jako osoba.
 */
export function defaultIsStopword(candidate: string): boolean {
  const w = candidate.toLowerCase().trim();
  if (!w) return true;
  for (const p of w.split(/\s+/)) {
    if (LEGAL_ENTITY_WORDS.has(p) || NON_PERSON_CONTEXT.has(p) || NER_COMMON_NOUNS.has(p)) return true;
    if (isGeoAdjective(p)) return true;
  }
  return false;
}

/** Domyślny predykat homonimu: sprawdza ostatni człon (pozycję nazwiska), też w odmianie. */
export function defaultIsHomograph(candidate: string): boolean {
  const parts = candidate.toLowerCase().split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? '';
  return HOMOGRAPH_SURNAMES.has(last) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(last));
}

interface Group {
  words: string[];
  headScore: number;
  start?: number;
  end?: number;
}

/**
 * Strumień samych liter (małych) i mapa na pozycje w oryginale. Bez offsetów od modelu, a `word` bywa
 * fragmentem subword, więc kandydata lokalizujemy w tym strumieniu i rozszerzamy do granic słowa.
 * Gdy offsety są, używamy ich zamiast skanu.
 */
function buildLetterStream(text: string): { stream: string; pos: number[] } {
  let stream = '';
  const pos: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (LETTER.test(ch)) {
      const lo = ch.toLowerCase();
      // Mapa 1:1: gdy toLowerCase rozwija znak („İ" na 2 znaki), bierzemy pierwszy.
      stream += lo.length === 1 ? lo : lo[0];
      pos.push(i);
    }
  }
  return { stream, pos };
}

/** Rozszerz [s,e) do granic słowa, bo dopasowanie subwordów potrafi uciąć „Gz|owski". */
function expandToWord(text: string, s: number, e: number): [number, number] {
  while (s > 0 && WORD_CHAR.test(text[s - 1])) s--;
  while (e < text.length && WORD_CHAR.test(text[e])) e++;
  return [s, e];
}

/**
 * Szuka kandydata w strumieniu od `fromLi`, tylko na granicy słowa, żeby „anna" nie trafiła w środek
 * „panna". Zwraca surowy span w pozycjach oryginału i indeks następnej litery.
 */
function locate(
  stream: string,
  pos: number[],
  text: string,
  candLetters: string,
  fromLi: number,
): { rawS: number; rawE: number; nextLi: number } | null {
  if (!candLetters) return null;
  let li = stream.indexOf(candLetters, Math.max(0, fromLi));
  while (li !== -1) {
    const startPos = pos[li];
    if (startPos === 0 || !LETTER.test(text[startPos - 1])) {
      return { rawS: startPos, rawE: pos[li + candLetters.length - 1] + 1, nextLi: li + candLetters.length };
    }
    li = stream.indexOf(candLetters, li + 1);
  }
  return null;
}

/**
 * Zamień wyjście NER na tekst z zamaskowanymi osobami. Deterministyczne, bez `throw`: wyjątki modelu
 * łapie wołający (dodatek AI, benchmark).
 *
 * @param text   tekst wejściowy, zwykle już po redakcji strukturalnej (redactPII).
 * @param tokens surowe encje z pipeline `token-classification`.
 */
export function applyNerPersons(
  text: string,
  tokens: NerToken[],
  options: NerPostprocessOptions = {},
): NerPostprocessResult {
  const empty: NerPostprocessResult = { redacted: text, found: [] };
  if (!text || !Array.isArray(tokens) || tokens.length === 0) return empty;

  const mask = options.mask ?? PERSON_MASK;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const homographMinScore = options.homographMinScore ?? DEFAULT_HOMOGRAPH_MIN_SCORE;
  const isPersonLabel = options.isPersonLabel ?? defaultIsPersonLabel;
  const isStopword = options.isStopword ?? defaultIsStopword;
  const isHomograph = options.isHomograph ?? defaultIsHomograph;

  // Grupujemy kolejne tokeny osobowe bez dzielenia po B-/I-: FastPDN int8 znakuje subwordy jako
  // osobne B- („Achtelika" = A|ch|te|lika), więc podział gubiłby nazwisko. Sąsiednie osoby bez
  // separatora scalą się w jedną maskę, co dla anonimizacji jest bezpieczne.
  const groups: Group[] = [];
  let cur: Group | null = null;
  const flush = () => {
    if (cur) groups.push(cur);
    cur = null;
  };
  for (const t of tokens) {
    const entity = String(t?.entity ?? '');
    if (isPersonLabel(entity)) {
      if (!cur) cur = { words: [], headScore: typeof t.score === 'number' ? t.score : 1 };
      cur.words.push(String(t.word ?? ''));
      if (typeof t.start === 'number' && cur.start === undefined) cur.start = t.start;
      if (typeof t.end === 'number') cur.end = t.end;
    } else {
      flush();
    }
  }
  flush();

  const maskRanges = [...text.matchAll(MASK_SPAN), ...text.matchAll(TAG_SPAN)].map((m) => [
    m.index!,
    m.index! + m[0].length,
  ]);
  const inMask = (s: number, e: number) => maskRanges.some(([ms, me]) => s < me && e > ms);

  // Skan kursorowy: kolejne wystąpienia, nie zawsze od 0.
  const { stream, pos } = buildLetterStream(text);
  const spans: Array<[number, number]> = [];
  let cursorLi = 0;
  const overlaps = (s: number, e: number) => spans.some(([ps, pe]) => s < pe && e > ps);

  for (const g of groups) {
    if (g.headScore < minScore) continue;
    const rejected = (w: string) =>
      isStopword(w) || (isHomograph(w) && g.headScore < homographMinScore);

    if (typeof g.start === 'number' && typeof g.end === 'number' && g.end > g.start) {
      const [s, e] = expandToWord(text, g.start, g.end);
      if (!inMask(s, e) && !overlaps(s, e)) spans.push([s, e]);
      continue;
    }

    const cand = g.words.join(' ').replace(/\s+/g, ' ').trim();
    const candLetters = cand.toLowerCase().replace(NON_LETTER_G, '');
    if (candLetters.length < 2) continue;
    if (rejected(cand)) continue;

    // Trafienie w placeholderze albo w zajętym spanie pomijamy i szukamy dalej; porzucenie
    // kandydata zostawiłoby jawne późniejsze wystąpienie nazwiska. Fallback od 0 na rozjazd kolejności.
    let hit = locate(stream, pos, text, candLetters, cursorLi);
    if (!hit) hit = locate(stream, pos, text, candLetters, 0);
    while (hit) {
      cursorLi = Math.max(cursorLi, hit.nextLi);
      const [s, e] = expandToWord(text, hit.rawS, hit.rawE);
      if (inMask(s, e) || overlaps(s, e)) {
        hit = locate(stream, pos, text, candLetters, hit.nextLi);
        continue;
      }
      // Filtry na słowie powierzchniowym odrzucają cały kandydat. Rozszerzenie na słowo z małej
      // litery („mai" do „maila") to zwykły wyraz; obce nazwiska z krótkiego prefiksu mają wielką.
      const surf = text.slice(s, e).trim();
      const surfLetters = surf.toLowerCase().replace(NON_LETTER_G, '');
      if (!rejected(surf) && (surfLetters === candLetters || UPPER_START.test(surf))) {
        spans.push([s, e]);
      }
      break;
    }
  }

  if (spans.length === 0) return empty;

  spans.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const [s, e] of spans) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  // Podmiana od końca, żeby offsety wcześniejszych spanów się nie przesuwały.
  let redacted = text;
  for (let i = merged.length - 1; i >= 0; i--) {
    const [s, e] = merged[i];
    redacted = redacted.slice(0, s) + mask + redacted.slice(e);
  }
  return { redacted, found: [{ type: 'IMIE', count: merged.length }] };
}
