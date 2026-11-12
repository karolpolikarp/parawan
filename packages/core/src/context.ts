import { POLISH_CITIES } from './dict/places.js';
import { type PiiType } from './types.js';


/** 0→A, 1→B… 25→Z, 26→AA… (etykiety bez cyfr — idempotencja placeholderów). */
export function indexToLetters(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Odwrotność indexToLetters (A→0, B→1… AA→26) — przywracanie sentineli URL. */
export function lettersToIndex(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

// ============================================================================
// Kontekst redakcji + przebiegi (top-level; orkiestrowane przez redactPII)
// ============================================================================

/**
 * Wspólny kontekst przebiegów. `text` jest MUTOWALNE — każdy przebieg robi
 * `ctx.text = ctx.text.replace(...)`. Reszta pól to domknięcia/tablice przygotowane
 * raz w `redactPII` (bump/on/M/personMask) plus bufor sentineli URL.
 */
export interface RedactCtx {
  text: string;
  /** Oryginalne wejście. Kotwice DOKUMENTOWE liczymy na nim, nie na `text`: wcześniejsze
   *  przebiegi kasują adresy (URL → sentinel, e-mail → [EMAIL]), a słowo „KSeF" bywa właśnie
   *  tam jedyne („ksef@mf.gov.pl", „ksef.mf.gov.pl") — wtedy kotwica ginęła. */
  raw: string;
  on: (t: PiiType) => boolean;
  bump: (t: PiiType) => void;
  M: Record<PiiType, string>;
  personMask: (surnameToken: string) => string;
  /** Czy włączona pseudonimizacja (etykiety [OSOBA-X]). */
  pseudonyms: boolean;
  /** Klucze nazwisk już zamaskowanych w dokumencie (normalizeSurnameKey) — także bez pseudonimów. */
  maskedSurnames: Set<string>;
  protectedUrls: string[];
  /** Czy passProtectJsonEscapes podmienił ucieczki „\n/\r/\t" (wtedy trzeba je przywrócić). */
  jsonEscapes: boolean;
  /** Loginy z kotwic poza etykietą „Login:" (parametr URL-a, klucz JSON/XML, ścieżka profilu,
   *  udział domowy, log sshd) — passLogin rozlewa je na resztę dokumentu i na zapamiętane URL-e. */
  loginSeeds: Set<string>;
}

// Sentinel URL: znaki z Prywatnego Obszaru Użytku (U+E000/U+E001) — bez cyfr, „@" i liter
// słownikowych, więc żaden przebieg go nie rusza. Definiowane przez fromCharCode (identyczne
// z literałami „"/„"), by uniknąć niejednoznaczności escape'ów w narzędziach.
export const URL_SENTINEL_OPEN = String.fromCharCode(0xe000);
export const URL_SENTINEL_CLOSE = String.fromCharCode(0xe001);
export const RE_URL_SENTINEL = new RegExp(`${URL_SENTINEL_OPEN}([A-Z]+)${URL_SENTINEL_CLOSE}`, 'g');

// Ucieczki JSON/łańcuchów „\n", „\r", „\t" zapisane DOSŁOWNIE („Dane:\n85031412347" w polu
// JSON-a albo w logu). Litera ucieczki sklejała się z wartością: „n85031412347" nie ma lewej
// granicy PESEL-u, „nKowalski" nie jest wyrazem z wielkiej litery, a maska e-maila zjadała „n"
// (wynik „\[EMAIL]" przestawał się parsować). Na czas detekcji litera ucieczki zamienia się w znak
// z Prywatnego Obszaru Użytku — nie jest literą, cyfrą ani białym znakiem, więc każdy przebieg
// widzi przed wartością zwykłą granicę — a na końcu wraca. Inne znaki PUA niż sentinel URL.
export const JSON_ESC_TO_PUA: Record<string, string> = { n: '\uE00A', r: '\uE00D', t: '\uE009' };
export const JSON_ESC_FROM_PUA: Record<string, string> = { '\uE00A': 'n', '\uE00D': 'r', '\uE009': 't' };

// Fabryka przebiegu „etykieta + separator + wartość": słowo-etykieta (grupa 1) i separator
// (grupa 2) zostają, a wartość (grupa 3) znika pod maską typu. Wspólny kształt dla
// NR-KONTA / PESEL / NIP / REGON / ZNAK-SPRAWY / DATA-UR — regex różny, callback identyczny.
export function maskAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType): void {
  ctx.text = ctx.text.replace(re, (_m, kw: string, sep: string) => {
    ctx.bump(type);
    return `${kw}${sep}${ctx.M[type]}`;
  });
}

// Callback stałej maski: bump typu + zwrot placeholdera — dla przebiegów BEZ strażnika i BEZ
// użycia dopasowania (EMAIL/TOKEN/MAC/LOGIN/ADRES/ZNAK…). Zwraca funkcję gotową dla .replace().
export function maskConst(ctx: RedactCtx, type: PiiType) {
  return (): string => {
    ctx.bump(type);
    return ctx.M[type];
  };
}

// Dwa wspólne skanery słownika miast (POLISH_CITIES) dla przebiegu MIEJSCOWOŚĆ: najdłuższe
// (do 3 słów) dopasowanie na PREFIKSIE lub SUFIKSIE ciągu wyrazów z wielkiej litery. Zwracają
// część NIEzamaskowaną (leftover/prefix) albo null, gdy żadne znane miasto nie pasuje. bump()
// woła się dokładnie wtedy, gdy miasto trafione. Ciąg przychodzi SUROWY i jest dzielony
// z zachowaniem odstępów (parzyste = wyrazy, nieparzyste = separatory): `leftover` zaczyna się
// od oryginalnego odstępu, `prefix` się nim kończy. Sklejanie reszty spacją zamieniało tabulator
// między kolumnami („[MIEJSCOWOŚĆ]\tPolska") w spację i scalało kolumny TSV.
export function cityByPrefix(ctx: RedactCtx, run: string): { leftover: string } | null {
  const parts = run.split(/([ \t]+)/);
  const words = parts.filter((_, i) => i % 2 === 0);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    if (POLISH_CITIES.has(words.slice(0, n).join(' ').toLowerCase())) {
      ctx.bump('MIEJSCOWOSC');
      return { leftover: parts.slice(2 * n - 1).join('') };
    }
  }
  return null;
}
export function cityBySuffix(ctx: RedactCtx, run: string): { prefix: string } | null {
  const parts = run.split(/([ \t]+)/);
  const words = parts.filter((_, i) => i % 2 === 0);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    if (POLISH_CITIES.has(words.slice(words.length - n).join(' ').toLowerCase())) {
      ctx.bump('MIEJSCOWOSC');
      return { prefix: parts.slice(0, 2 * (words.length - n)).join('') };
    }
  }
  return null;
}
