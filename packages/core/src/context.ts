// Kontekst redakcji współdzielony przez przebiegi, sentinele PUA i wspólne helpery masek.
import type { PiiType } from './types.js';

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
  /** Czy oryginalne wejście ma kotwicę KSeF; potrzebne przy URL-ach i w passKsef. */
  ksefAnchor: boolean;
  on: (t: PiiType) => boolean;
  bump: (t: PiiType) => void;
  /** bump i maska typu w jednym, dla callbacków .replace(). */
  hit: (t: PiiType) => string;
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

// Znaki Prywatnego Obszaru Użytku (PUA) to sentinele: bez cyfr, „@" i liter, więc żaden przebieg ich
// nie rusza. Wszystkie są tutaj, każdy z innym kodem: U+E000/E001 URL, U+E009/E00A/E00D ucieczki JSON,
// U+E0D0 „D." z „z d.", U+E0D2 wietnamskie imię, U+E0F1 znacznik ulicy z patronem.

export const URL_SENTINEL_OPEN = '\uE000';
export const URL_SENTINEL_CLOSE = '\uE001';
export const RE_URL_SENTINEL = new RegExp(`${URL_SENTINEL_OPEN}([A-Z]+)${URL_SENTINEL_CLOSE}`, 'g');

// Dosłowne ucieczki „\n", „\r", „\t" (pole JSON, log) sklejają literę z wartością: „n85031412347"
// nie ma lewej granicy PESEL-u. Na czas detekcji litera ucieczki staje się znakiem PUA (nie litera,
// cyfra ani biały znak), a na końcu wraca.
export const JSON_ESC_TO_PUA: Record<string, string> = { n: '\uE00A', r: '\uE00D', t: '\uE009' };
export const JSON_ESC_FROM_PUA: Record<string, string> = Object.fromEntries(Object.entries(JSON_ESC_TO_PUA).map(([l, c]) => [c, l]));
// Treść klasy znaków do wstawienia we wzorzec: wszystkie ucieczki i tylko te końca wiersza.
export const JSON_ESC_PUA = `${JSON_ESC_TO_PUA.t}${JSON_ESC_TO_PUA.n}${JSON_ESC_TO_PUA.r}`;
export const JSON_ESC_PUA_EOL = `${JSON_ESC_TO_PUA.n}${JSON_ESC_TO_PUA.r}`;
export const RE_JSON_ESC_PUA = new RegExp(`[${JSON_ESC_PUA}]`);

// Znak w miejscu „D." ze skrótu „Z D.", żeby finalizePersons nie wciągnął go do maski jako inicjału
// imienia (patrz passPersonMaidenAfterMask).
export const MAIDEN_D_SENTINEL = '\uE0D0';
// Znacznik za maską w miejscu wietnamskiego imienia spoza kandydata (patrz passPersonTrigger).
export const VI_GIVEN_SENTINEL = '\uE0D2';
// Znacznik przed maską adresu z przebiegu ulic z patronem (patrz passes/address.ts).
export const PATRON_STREET_MARK = '\uE0F1';

// Przebieg „etykieta + separator + wartość": grupy 1 i 2 zostają, grupa 3 idzie pod maskę typu.
export function maskAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType): void {
  ctx.text = ctx.text.replace(re, (_m, kw: string, sep: string) => `${kw}${sep}${ctx.hit(type)}`);
}

// Callback .replace(): grupa 1 (kotwica) zostaje, reszta dopasowania znika pod maską.
export function maskKeepPrefix(ctx: RedactCtx, type: PiiType) {
  return (_m: string, pre: string): string => `${pre}${ctx.hit(type)}`;
}

// Chroni fragment przed resztą przebiegów: wstawia sentinel, a finalizacja przywraca `s`.
export function protectSpan(ctx: RedactCtx, s: string): string {
  const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
  ctx.protectedUrls.push(s);
  return sentinel;
}
