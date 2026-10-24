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
  /** Odsłoń zakresy leżące w całości w [start, end) oryginału (szerszy zakres zostaje zasłonięty). */
  | { kind: 'keep'; scope: 'here'; start: number; end: number }
  /**
   * Odsłoń zakresy o tym samym kluczu (spanKey), ale tylko w formach z listy z chwili decyzji
   * (formOf): osoba dopisana później z innym imieniem nie wychodzi jawna bez wiedzy urzędnika.
   */
  | { kind: 'keep'; scope: 'same'; key: string; label: string; forms: string[] }
  /** Zasłoń [start, end) oryginału znacznikiem [token]. */
  | { kind: 'mask'; scope: 'here'; start: number; end: number; token: string }
  /** Zasłoń każde wystąpienie tekstu (bez wielkości liter, na granicach wyrazów). */
  | { kind: 'mask'; scope: 'all'; text: string; token: string }
  /**
   * Cofnij ręczne zasłonięcie w [start, end): miejsce wraca do stanu sprzed niego, więc to, co
   * zasłaniał automat (PESEL wchłonięty przez zaznaczenie), dalej jest zasłonięte.
   */
  | { kind: 'unmask'; scope: 'here'; start: number; end: number }
  /**
   * Cofnij ręczne zasłonięcia o tym samym kluczu (spanKey) i w formach z chwili decyzji, tak jak
   * unmask „tutaj” w każdym z tych miejsc. Zakresów automatu nie odsłania.
   */
  | { kind: 'unmask'; scope: 'same'; key: string; label: string; forms: string[] };

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

// Końcówki odmiany imienia („Janowi”, „Jerzego”, „Janem”, „Janinie”, „Anną”). Na końcu wyrazu
// wygrywa najwcześniej zaczynająca się, więc „Janinie” traci „ie”, a nie samo „e”.
const NAME_ENDING = /(?:owi|ego|emu|em|ie|ym|im|ą|ę|a|y|i|u|o|e)$/u;

/**
 * Rdzeń imienia: bez końcówki, bez miękkiego „i” („Maria”, „Marii” → „mar”) i z ruchomym „e”
 * („Marek”, „Marka” → „mark”). Całe imię, a nie jego początek: „Jan”, „Janina” i „Janusz” mają
 * różne rdzenie. Gdy odmiana nie trafi, rdzenie się różnią i znacznik zostaje zasłonięty.
 */
function nameStem(w: string): string {
  const s = w.replace(NAME_ENDING, '');
  const stem = s.length >= 2 ? s : w;
  return (stem.length > 2 ? stem.replace(/i$/u, '') : stem).replace(/e([kłcń])$/u, '$1');
}

/**
 * Klucz osoby: nazwisko o tym samym normalizeSurnameKey i imię o tym samym rdzeniu (nameStem:
 * „Jan Nowak”, „Jana Nowaka”, „Janowi Nowakowi”). Inicjał („J. Nowak”) ma własny klucz, więc nie
 * łączy się z pełnym imieniem. Samo nazwisko łączy się tylko z samym nazwiskiem.
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
  return `P:${initial ? first : nameStem(letters)}|${last}`;
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

/** Forma zakresu do listy decyzji „wszędzie”: tekst oryginału bez wielkości liter i nadmiaru odstępów. */
export const formOf = (original: string, span: { start: number; end: number }): string =>
  original.slice(span.start, span.end).toLowerCase().replace(/\s+/g, ' ').trim();

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
const inside = (s: { start: number; end: number }, a: number, b: number): boolean => a <= s.start && s.end <= b;

/**
 * Zakres w trakcie nakładania. Automatyczny ma numer `ai` w autoSpans; ręczny ma numer decyzji `by`,
 * która go utworzyła, oraz zakresy (`under`) i odsłonięcia automatu (`wasKept`) sprzed niej, żeby
 * „Cofnij zasłonięcie” wróciło dokładnie do tamtego stanu.
 */
interface Cover extends Span {
  ai: number;
  by: number;
  under: Cover[];
  wasKept: number[];
}

export interface Corrected {
  /** Zakresy wyniku po poprawkach, posortowane, bez nakładania. */
  spans: Span[];
  /** Zakresy automatyczne odsłonięte ręcznie, posortowane. */
  kept: Span[];
  /** Ile miejsc zmieniła każda decyzja (do listy poprawek i komunikatów). */
  effects: number[];
  /** Numer decyzji, która utworzyła zakres z `spans` (-1 dla zakresu automatu). */
  by: number[];
}

/**
 * Nakłada decyzje na zakresy automatyczne. „Zostaw jawne” zdejmuje cały zakres, także grupowy,
 * ale tylko taki, który mieści się w miejscu decyzji: gdy po edycji źródła do odsłoniętego nazwiska
 * dołączy PESEL („Jan Nowak 44051401359” w jednym zakresie), decyzja przestaje działać i całość
 * zostaje zasłonięta, bo o PESEL-u urzędnik nie decydował.
 * Zasłonięcie nachodzące na zakresy łączy się z nimi w jeden (suma przedziałów) z tokenem
 * decyzji; zasłonięcie miejsca odsłoniętego wcześniej przywraca zakres automatyczny z jego
 * znacznikami; zasłonięcie wewnątrz zakresu, który już jest zasłonięty, nic nie zmienia.
 * Cofnięcie zasłonięcia (unmask) przywraca to, co zakres ręczny wchłonął, a nie odsłania automatu.
 */
export function applyCorrections(original: string, autoSpans: Span[], decisions: Decision[]): Corrected {
  if (!decisions.length) return { spans: autoSpans, kept: [], effects: [], by: autoSpans.map(() => -1) };
  const autoCover = (i: number): Cover => ({ ...autoSpans[i], ai: i, by: -1, under: [], wasKept: [] });
  let cover: Cover[] = autoSpans.map((_, i) => autoCover(i));
  const kept = new Set<number>();
  const effects: number[] = [];
  /** Zakresy automatyczne wchłonięte w `c` (także przez wchłonięte zakresy ręczne). */
  const autoOf = (c: Cover): number[] => (c.by < 0 ? [c.ai] : c.under.flatMap(autoOf));
  /** Zdejmuje zakres ręczny: wraca to, co wchłonął, i odsłonięcia automatu sprzed niego. */
  const release = (c: Cover): void => {
    cover = cover.filter((x) => x !== c).concat(c.under.filter((u) => !c.wasKept.includes(u.ai)));
    for (const k of c.wasKept) kept.add(k);
  };
  const sameAs = (c: Cover, key: string, forms: string[]): boolean =>
    spanKey(original, c) === key && forms.includes(formOf(original, c));
  const keepAll = (pick: (c: Cover) => boolean): number => {
    const hit = cover.filter(pick);
    if (!hit.length) return 0;
    for (const c of hit) for (const i of autoOf(c)) kept.add(i);
    cover = cover.filter((c) => !hit.includes(c));
    return hit.length;
  };
  const maskAt = (a: number, b: number, token: string, by: number): boolean => {
    if (!(a >= 0 && b <= original.length && a < b)) return false;
    const restored = [...kept].filter((i) => overlaps(autoSpans[i], a, b));
    for (const i of restored) {
      kept.delete(i);
      cover.push(autoCover(i));
    }
    if (cover.some((c) => c.start <= a && b <= c.end)) return restored.length > 0;
    let s = a;
    let e = b;
    const under: Cover[] = [];
    for (;;) {
      const hit = cover.filter((c) => overlaps(c, s, e));
      if (!hit.length) break;
      for (const c of hit) {
        s = Math.min(s, c.start);
        e = Math.max(e, c.end);
        under.push(c);
      }
      cover = cover.filter((c) => !hit.includes(c));
    }
    cover.push({ start: s, end: e, tokens: [token], gaps: [], source: 'manual', ai: -1, by, under, wasKept: restored });
    return true;
  };
  decisions.forEach((d, i) => {
    let n = 0;
    if (d.kind === 'keep') {
      n =
        d.scope === 'here'
          ? keepAll((c) => inside(c, d.start, d.end))
          : keepAll((c) => sameAs(c, d.key, d.forms));
    } else if (d.kind === 'unmask') {
      // „Tutaj”: zakres ręczny w miejscu decyzji albo szerszy od niego (po ponownym włączeniu typu
      // urósł). „Wszędzie”: każdy zakres ręczny tej samej danej w formach z chwili decyzji.
      const hit = cover.filter(
        (c) =>
          c.by >= 0 &&
          (d.scope === 'same' ? sameAs(c, d.key, d.forms) : inside(c, d.start, d.end) || inside(d, c.start, c.end)),
      );
      for (const c of hit) release(c);
      n = hit.length;
    } else {
      const ranges = d.scope === 'here' ? [[d.start, d.end] as [number, number]] : findOccurrences(original, d.text, d.token);
      for (const [a, b] of ranges) if (maskAt(a, b, d.token, i)) n++;
    }
    effects.push(n);
  });
  cover.sort((x, y) => x.start - y.start);
  const spans = cover.map(({ ai: _a, by: _b, under: _u, wasKept: _w, ...s }) => s as Span);
  return { spans, kept: [...kept].sort((x, y) => x - y).map((i) => autoSpans[i]), effects, by: cover.map((c) => c.by) };
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
