/**
 * Ręczna korekta wyniku (bez DOM, więc testowalna w vitest). Urzędnik zostawia jawne to, co
 * automat zasłonił niepotrzebnie (podpis wójta, osoba „z up.”), i zasłania to, co automat
 * przeoczył (numer księgi wieczystej, „z żoną Anną”). Decyzje to lista w kolejności podjęcia;
 * applyCorrections nakłada je na zakresy z alignSpans przy każdym przeliczeniu, więc zmiana
 * „Co maskować” albo „Rozróżniaj osoby” nie gubi poprawek. Późniejsza decyzja wygrywa.
 *
 * Stan żyje wyłącznie w pamięci karty (main.ts), nigdy w localStorage: decyzje zawierają
 * fragmenty pisma.
 */
import { normalizeSurnameKey } from 'anonimizator/surnames';
import type { Span } from './spans';

export type Decision =
  /** Odsłoń zakresy nachodzące na [start, end) oryginału. */
  | { kind: 'keep'; scope: 'here'; start: number; end: number }
  /** Odsłoń każdy zakres o tym samym kluczu (spanKey): ta sama osoba albo ta sama dana. */
  | { kind: 'keep'; scope: 'same'; key: string; label: string }
  /** Zasłoń [start, end) oryginału znacznikiem [token]. */
  | { kind: 'mask'; scope: 'here'; start: number; end: number; token: string }
  /** Zasłoń każde wystąpienie tekstu (bez wielkości liter, na granicach wyrazów). */
  | { kind: 'mask'; scope: 'all'; text: string; token: string };

/** Tokeny do wyboru przy „Zasłoń zaznaczenie”, w kolejności listy. */
export const MANUAL_TOKENS: readonly { token: string; label: string }[] = [
  { token: 'IMIĘ I NAZWISKO', label: 'Imię i nazwisko' },
  { token: 'MIEJSCOWOŚĆ', label: 'Miejscowość' },
  { token: 'ADRES', label: 'Adres' },
  { token: 'DANE', label: 'Inne dane' },
];

export const PERSON_TOKEN = 'IMIĘ I NAZWISKO';
const isPerson = (token: string): boolean => token === PERSON_TOKEN || token.startsWith('OSOBA-');

// Typy, przy których „ta sama dana” to te same cyfry („600 700 800” i „600-700-800”).
const NUMERIC = new Set(['PESEL', 'NIP', 'REGON', 'TELEFON', 'NR-KONTA', 'NR-KARTY', 'KRS', 'KOD-POCZTOWY']);

const WORD_CHAR = /[\p{L}\p{N}]/u;
const isWordChar = (c: string | undefined): boolean => !!c && WORD_CHAR.test(c);
const startsUpper = (s: string): boolean => /^\p{Lu}/u.test(s);

/** Klucz nazwiska: forma bazowa z rdzenia, osobno dla każdej części nazwiska z łącznikiem. */
const surnameKey = (w: string): string => w.split('-').map(normalizeSurnameKey).join('-');

/**
 * Klucz osoby: nazwisko o tym samym normalizeSurnameKey i imię o tych samych pierwszych
 * 3 literach („Jan Nowak”, „Jana Nowaka”, „Janowi Nowakowi”). Inicjał („J. Nowak”) ma własny
 * klucz, więc nie łączy się z pełnym imieniem. Samo nazwisko łączy się tylko z samym nazwiskiem.
 */
export function personKey(text: string): string {
  const words = text
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}]+|[^\p{L}.]+$/gu, ''))
    .filter(Boolean);
  if (!words.length) return 'P:';
  const last = surnameKey(words[words.length - 1].replace(/\.$/, '').toLowerCase());
  if (words.length === 1) return `P:|${last}`;
  const first = words[0].toLowerCase();
  const letters = first.replace(/[^\p{L}]/gu, '');
  const initial = first.endsWith('.') || letters.length < 2;
  return `P:${initial ? first : letters.slice(0, 3)}|${last}`;
}

/** Klucz „ta sama osoba albo dana” zakresu: rodzaj danych i znormalizowany tekst oryginału. */
export function spanKey(original: string, span: Pick<Span, 'start' | 'end' | 'tokens'>): string {
  const text = original.slice(span.start, span.end);
  if (span.tokens.length === 1) {
    const t = span.tokens[0];
    if (isPerson(t)) return personKey(text);
    if (NUMERIC.has(t)) return `${t}:${text.replace(/\D/g, '')}`;
    return `${t}:${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
  }
  // Zakres grupowy („[IMIĘ I NAZWISKO] [PESEL]”) łączy się tylko z taką samą grupą.
  return `${span.tokens.map((t) => (isPerson(t) ? 'P' : t)).join('+')}:${text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Wystąpienia tekstu w oryginale: bez wielkości liter, z dowolnym odstępem w miejscu spacji,
 * na granicach wyrazów liczonych po literach i cyfrach („Anna” nie łapie „Annasz”). Dla
 * jednowyrazowej osoby także formy o tym samym kluczu nazwiska pisane wielką literą („Anną”
 * łapie „Anny”, ale nie „malec” jako rzeczownik).
 */
export function findOccurrences(original: string, text: string, token: string): [number, number][] {
  const needle = text.trim().replace(/\s+/g, ' ');
  if (!needle) return [];
  const found = new Map<number, number>();
  const re = new RegExp(needle.split(' ').map(escapeRe).join('\\s+'), 'giu');
  for (const m of original.matchAll(re)) {
    const a = m.index ?? 0;
    const b = a + m[0].length;
    if (isWordChar(needle[0]) && isWordChar(original[a - 1])) continue;
    if (isWordChar(needle[needle.length - 1]) && isWordChar(original[b])) continue;
    // Osoba tylko z wielkiej litery: „malec” w zdaniu to nie nazwisko „Malec”.
    if (isPerson(token) && startsUpper(needle) && !startsUpper(m[0])) continue;
    found.set(a, b);
  }
  if (isPerson(token) && !needle.includes(' ') && /^\p{L}[\p{L}-]{2,}$/u.test(needle)) {
    const key = surnameKey(needle.toLowerCase());
    for (const m of original.matchAll(/\p{L}+(?:-\p{L}+)*/gu)) {
      const w = m[0];
      if (w.length >= 3 && startsUpper(w) && surnameKey(w.toLowerCase()) === key) {
        const a = m.index ?? 0;
        if (!found.has(a)) found.set(a, a + w.length);
      }
    }
  }
  return [...found.entries()].sort((x, y) => x[0] - y[0]);
}

const overlaps = (s: { start: number; end: number }, a: number, b: number): boolean => a < s.end && s.start < b;

/** Zakres w trakcie nakładania: z indeksami zakresów automatycznych, które wchłonął. */
interface Cover extends Span {
  auto: number[];
}

export interface Corrected {
  /** Zakresy wyniku po poprawkach, posortowane, bez nakładania. */
  spans: Span[];
  /** Zakresy automatyczne odsłonięte ręcznie, posortowane. */
  kept: Span[];
  /** Ile miejsc zmieniła każda decyzja (do listy poprawek i komunikatów). */
  effects: number[];
}

/**
 * Nakłada decyzje na zakresy automatyczne. „Zostaw jawne” zdejmuje cały zakres, także grupowy.
 * Zasłonięcie nachodzące na zakresy łączy się z nimi w jeden (suma przedziałów) z tokenem
 * decyzji; zasłonięcie miejsca odsłoniętego wcześniej przywraca zakres automatyczny z jego
 * znacznikami; zasłonięcie wewnątrz zakresu, który już jest zasłonięty, nic nie zmienia.
 */
export function applyCorrections(original: string, autoSpans: Span[], decisions: Decision[]): Corrected {
  if (!decisions.length) return { spans: autoSpans, kept: [], effects: [] };
  let cover: Cover[] = autoSpans.map((s, i) => ({ ...s, auto: [i] }));
  const kept = new Set<number>();
  const effects: number[] = [];
  const keepAll = (pick: (c: Cover) => boolean): number => {
    const hit = cover.filter(pick);
    if (!hit.length) return 0;
    for (const c of hit) for (const i of c.auto) kept.add(i);
    cover = cover.filter((c) => !hit.includes(c));
    return hit.length;
  };
  const maskAt = (a: number, b: number, token: string): boolean => {
    if (!(a >= 0 && b <= original.length && a < b)) return false;
    const restored = [...kept].filter((i) => overlaps(autoSpans[i], a, b));
    for (const i of restored) {
      kept.delete(i);
      cover.push({ ...autoSpans[i], auto: [i] });
    }
    if (cover.some((c) => c.start <= a && b <= c.end)) return restored.length > 0;
    let s = a;
    let e = b;
    const auto: number[] = [];
    for (;;) {
      const hit = cover.filter((c) => overlaps(c, s, e));
      if (!hit.length) break;
      for (const c of hit) {
        s = Math.min(s, c.start);
        e = Math.max(e, c.end);
        auto.push(...c.auto);
      }
      cover = cover.filter((c) => !hit.includes(c));
    }
    cover.push({ start: s, end: e, tokens: [token], gaps: [], source: 'manual', auto });
    return true;
  };
  for (const d of decisions) {
    let n = 0;
    if (d.kind === 'keep') {
      n =
        d.scope === 'here'
          ? keepAll((c) => overlaps(c, d.start, d.end))
          : keepAll((c) => spanKey(original, c) === d.key);
    } else {
      const ranges = d.scope === 'here' ? [[d.start, d.end] as [number, number]] : findOccurrences(original, d.text, d.token);
      for (const [a, b] of ranges) if (maskAt(a, b, d.token)) n++;
    }
    effects.push(n);
  }
  const spans = cover
    .sort((x, y) => x.start - y.start)
    .map(({ auto: _auto, ...s }) => s as Span);
  return { spans, kept: [...kept].sort((x, y) => x - y).map((i) => autoSpans[i]), effects };
}

/**
 * Zaznaczenie [start, end) poprawione do zasłonięcia: bez odstępów na brzegach, rozszerzone do
 * całych wyrazów i numerów i do całych zakresów, o które zahacza (zasłonięcie połowy numeru zostawiłoby
 * drugą połowę jawną). null, gdy po przycięciu nic nie zostaje.
 */
export function snapSelection(
  original: string,
  start: number,
  end: number,
  spans: Pick<Span, 'start' | 'end'>[],
): { start: number; end: number } | null {
  let a = Math.max(0, Math.min(start, end));
  let b = Math.min(original.length, Math.max(start, end));
  while (a < b && /\s/.test(original[a])) a++;
  while (b > a && /\s/.test(original[b - 1])) b--;
  if (a >= b) return null;
  // Znak wewnątrz wyrazu albo numeru: litera, cyfra, a także „/”, „-”, „.” i „_” między nimi
  // („OS1W/00045123/6”, „Nowak-Kowalska”, „3.05.1958”), żeby nie zostawić jawnej końcówki numeru.
  const inWord = (i: number): boolean =>
    isWordChar(original[i]) ||
    (/[/._-]/.test(original[i] ?? '') && isWordChar(original[i - 1]) && isWordChar(original[i + 1]));
  for (let changed = true; changed; ) {
    changed = false;
    while (a > 0 && inWord(a - 1) && inWord(a)) {
      a--;
      changed = true;
    }
    while (b < original.length && inWord(b) && inWord(b - 1)) {
      b++;
      changed = true;
    }
    for (const s of spans) {
      if (overlaps(s, a, b) && (s.start < a || s.end > b)) {
        a = Math.min(a, s.start);
        b = Math.max(b, s.end);
        changed = true;
      }
    }
  }
  return { start: a, end: b };
}

/** Wiersze zakresu [start, end) bez pustych brzegów: znacznik nie przechodzi przez koniec wiersza. */
export function lineRanges(original: string, start: number, end: number): [number, number][] {
  const out: [number, number][] = [];
  let a = start;
  for (let i = start; i <= end; i++) {
    if (i === end || original[i] === '\n') {
      let s = a;
      let e = i;
      while (s < e && /\s/.test(original[s])) s++;
      while (e > s && /\s/.test(original[e - 1])) e--;
      if (s < e) out.push([s, e]);
      a = i + 1;
    }
  }
  return out;
}

/**
 * Domyślny rodzaj danych zaznaczenia: z wielkiej litery osoba, w innym razie „Inne dane”. Tekst
 * z cyframi („OS1W/00045123/6”) to numer, nie osoba, nawet gdy zaczyna się wielką literą.
 */
export function defaultToken(text: string): string {
  const t = text.trim();
  return startsUpper(t) && !/\d/.test(t) ? PERSON_TOKEN : 'DANE';
}

/**
 * Decyzje po edycji tekstu źródłowego. Zmieniony fragment wyznacza wspólny początek i koniec
 * starego i nowego tekstu; decyzje „tutaj” przed nim zostają, za nim przesuwają się o różnicę
 * długości, a nachodzące na niego albo przyklejone do niego są odrzucane (nie wiadomo, czego dotyczą). Decyzje „wszędzie”
 * i „ta sama osoba” nie mają pozycji, więc zostają zawsze.
 */
export function shiftDecisions(
  before: string,
  after: string,
  decisions: Decision[],
): { decisions: Decision[]; dropped: number } {
  if (before === after || !decisions.length) return { decisions, dropped: 0 };
  const max = Math.min(before.length, after.length);
  let p = 0;
  while (p < max && before[p] === after[p]) p++;
  let s = 0;
  while (s < before.length - p && s < after.length - p && before[before.length - 1 - s] === after[after.length - 1 - s]) s++;
  const oldEnd = before.length - s;
  const delta = after.length - before.length;
  const newEnd = after.length - s;
  // Zmiana tuż przy zakresie dotyczy go, gdy styka się z nim literą albo cyfrą: „Lis” dopisany do
  // „Lisowski” zostawiłby „owski” jawne. Przecinek albo spacja na styku zakresu nie ruszają.
  const gluedEnd = isWordChar(before[p - 1]) && isWordChar(after[p]);
  const gluedStart = isWordChar(before[oldEnd]) && isWordChar(after[newEnd - 1]);
  const out: Decision[] = [];
  let dropped = 0;
  for (const d of decisions) {
    if (d.scope !== 'here') out.push(d);
    else if (d.end < p || (d.end === p && !gluedEnd)) out.push(d);
    else if (d.start > oldEnd || (d.start === oldEnd && !gluedStart))
      out.push({ ...d, start: d.start + delta, end: d.end + delta });
    else dropped++;
  }
  return { decisions: out, dropped };
}

/** Liczby do stopki i protokołu: odsłonięte znaczniki i fragmenty zasłonięte ręcznie. */
export function correctionCounts(c: Pick<Corrected, 'spans' | 'kept'>): { kept: number; masked: number } {
  return {
    kept: c.kept.reduce((n, s) => n + s.tokens.length, 0),
    masked: c.spans.filter((s) => s.source === 'manual').length,
  };
}
