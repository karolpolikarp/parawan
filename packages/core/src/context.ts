// Kontekst redakcji współdzielony przez przebiegi, sentinele PUA i wspólne helpery masek.
import { POLISH_CITIES } from './dict/places.js';
import { type PiiType } from './types.js';

/** 0→A, 1→B… 25→Z, 26→AA… Etykiety bez cyfr, żeby placeholdery były idempotentne. */
export function indexToLetters(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Odwrotność indexToLetters (A→0, AA→26), do przywracania sentineli URL. */
export function lettersToIndex(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

/** Stan jednego wywołania redactPII; każdy przebieg nadpisuje `text`. */
export interface RedactCtx {
  text: string;
  /** Oryginalne wejście. Kotwice dokumentowe liczy się na nim, bo wcześniejsze przebiegi
   *  zamieniają adresy na sentinel albo [EMAIL], a „KSeF" bywa tylko tam („ksef@mf.gov.pl"). */
  raw: string;
  on: (t: PiiType) => boolean;
  bump: (t: PiiType) => void;
  M: Record<PiiType, string>;
  personMask: (surnameToken: string) => string;
  /** Czy włączona pseudonimizacja (etykiety [OSOBA-X]). */
  pseudonyms: boolean;
  /** Klucze nazwisk już zamaskowanych (normalizeSurnameKey), także bez pseudonimów. */
  maskedSurnames: Set<string>;
  protectedUrls: string[];
  /** Czy passProtectJsonEscapes podmienił ucieczki „\n/\r/\t" i trzeba je przywrócić. */
  jsonEscapes: boolean;
  /** Loginy z kotwic innych niż etykieta „Login:" (parametr URL-a, klucz JSON/XML, ścieżka
   *  profilu, log sshd); passLogin rozlewa je na resztę dokumentu i zapamiętane URL-e. */
  loginSeeds: Set<string>;
}

// Sentinel URL ze znaków Prywatnego Obszaru Użytku: bez cyfr, „@" i liter, więc żaden przebieg go nie rusza.
export const URL_SENTINEL_OPEN = '\uE000';
export const URL_SENTINEL_CLOSE = '\uE001';
export const RE_URL_SENTINEL = new RegExp(`${URL_SENTINEL_OPEN}([A-Z]+)${URL_SENTINEL_CLOSE}`, 'g');

// Dosłowne ucieczki „\n", „\r", „\t" (pole JSON, log) sklejają literę z wartością: „n85031412347"
// nie ma lewej granicy PESEL-u. Na czas detekcji litera ucieczki staje się znakiem PUA (nie litera,
// cyfra ani biały znak), a na końcu wraca. Inne znaki PUA niż sentinel URL.
export const JSON_ESC_TO_PUA: Record<string, string> = { n: '\uE00A', r: '\uE00D', t: '\uE009' };
export const JSON_ESC_FROM_PUA: Record<string, string> = { '\uE00A': 'n', '\uE00D': 'r', '\uE009': 't' };

// Przebieg „etykieta + separator + wartość": grupy 1 i 2 zostają, grupa 3 idzie pod maskę typu.
export function maskAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType): void {
  ctx.text = ctx.text.replace(re, (_m, kw: string, sep: string) => {
    ctx.bump(type);
    return `${kw}${sep}${ctx.M[type]}`;
  });
}

// Callback .replace() ze stałą maską, dla przebiegów bez strażnika i bez użycia dopasowania.
export function maskConst(ctx: RedactCtx, type: PiiType) {
  return (): string => {
    ctx.bump(type);
    return ctx.M[type];
  };
}

// Najdłuższe (do 3 wyrazów) miasto ze słownika na początku albo końcu ciągu wyrazów; null, gdy brak.
// Ciąg dzieli się z zachowaniem odstępów (parzyste = wyrazy), żeby reszta zachowała oryginalny
// separator: tabulator to granica kolumny TSV i nie może zamienić się w spację.
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
