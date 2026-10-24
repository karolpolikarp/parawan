/**
 * Znaczniki rdzenia i ich kategorie wizualne dla demo na landingu. Osobny moduł bez DOM,
 * żeby spójność z rdzeniem mógł sprawdzić test (apps/web/src/landing.test.ts).
 *
 * SYNCHRONIZACJA: `token` to tekst z mapy MASK w packages/core/src/index.ts (bez nawiasów).
 * Record<PiiType, …> sprawia, że nowy typ w rdzeniu bez wpisu tutaj nie przejdzie tsc,
 * a test porównuje same znaczniki z rdzeniem. Bez tego nowy znacznik w wyniku demo
 * zostawał zwykłym tekstem: bez koloru i bez przekreślonego oryginału w „Porównaniu”.
 */
import type { PiiType } from 'anonimizator';

export type Cat = 'person' | 'contact' | 'ident' | 'fin' | 'place';

export const TYPE_MASK: Record<PiiType, { token: string; cat: Cat }> = {
  PESEL: { token: 'PESEL', cat: 'ident' },
  NIP: { token: 'NIP', cat: 'ident' },
  REGON: { token: 'REGON', cat: 'ident' },
  DOWOD: { token: 'NR-DOWODU', cat: 'ident' },
  PASZPORT: { token: 'NR-PASZPORTU', cat: 'ident' },
  KRS: { token: 'KRS', cat: 'ident' },
  KSEF: { token: 'NR-KSEF', cat: 'ident' },
  KW: { token: 'NR-KW', cat: 'ident' },
  'ZNAK-SPRAWY': { token: 'ZNAK-SPRAWY', cat: 'ident' },
  'PRAWO-JAZDY': { token: 'PRAWO-JAZDY', cat: 'ident' },
  'NR-REJESTRACYJNY': { token: 'NR-REJESTRACYJNY', cat: 'ident' },
  VIN: { token: 'VIN', cat: 'ident' },
  IP: { token: 'IP', cat: 'ident' },
  MAC: { token: 'MAC', cat: 'ident' },
  TOKEN: { token: 'TOKEN', cat: 'ident' },
  LOGIN: { token: 'LOGIN', cat: 'ident' },
  IBAN: { token: 'NR-KONTA', cat: 'fin' },
  'NR-KONTA': { token: 'NR-KONTA', cat: 'fin' },
  KARTA: { token: 'NR-KARTY', cat: 'fin' },
  EMAIL: { token: 'EMAIL', cat: 'contact' },
  TELEFON: { token: 'TELEFON', cat: 'contact' },
  ADRES: { token: 'ADRES', cat: 'place' },
  'KOD-POCZTOWY': { token: 'KOD-POCZTOWY', cat: 'place' },
  MIEJSCOWOSC: { token: 'MIEJSCOWOŚĆ', cat: 'place' },
  IMIE: { token: 'IMIĘ I NAZWISKO', cat: 'person' },
  'DATA-UR': { token: 'DATA-URODZENIA', cat: 'person' },
};

const TOKEN_CAT = new Map(Object.values(TYPE_MASK).map((m) => [m.token, m.cat]));

/** Kategoria wizualna znacznika po nazwie tokenu (OSOBA-A/B… to osoby, jak w aplikacji). */
export function maskCategory(name: string): Cat {
  if (name.startsWith('OSOBA-')) return 'person';
  return TOKEN_CAT.get(name) ?? 'ident';
}

/** Kategoria po typie z silnika (do statystyk). */
export function typeCategory(t: PiiType): Cat {
  return TYPE_MASK[t].cat;
}

/**
 * Przykład w demo: wymyślone pismo procesowe. Stoi tutaj, a nie w main.ts, bo test
 * (apps/web/src/landing.test.ts) przepuszcza go przez redactPII i porównuje wynik z sekcją
 * „Co się stało z przykładem” w index.html. PESEL, NIP w numerze KSeF i numer konta mają
 * poprawne sumy kontrolne; numer zamówienia celowo złą i nie dzieli cyfr z PESEL-em,
 * żeby nie zdradzał zasłoniętego numeru.
 */
export const EXAMPLE_TEXT = `Sygn. akt I C 456/23
Powódka Maria Wiśniewska (PESEL 90031512348),
zam. ul. Lipowa 15, 31-100 Kraków, tel. 512 345 678,
e-mail m.wisniewska@example.com.
Wnosi o zasądzenie 12 500 zł z faktury KSeF 5265877635-20250826-0100001AF629-AF
płatnej na rachunek PL61 1090 1014 0000 0712 1981 2874.
Powołuje się na wyrok SN z 12 marca 2019 r. (II CSK 123/18) i art. 471 KC.
Zamówienie nr 48213307715 złożyła w sklepie pozwanego.
Właściwy jest Sąd Rejonowy w Katowicach.`;

// Wszystkie znaczniki z listy wyżej plus dynamiczne OSOBA-A/B… (tryb rozróżniania osób).
// Żaden token nie zawiera metaznaków regexu, a każdy stoi w nawiasach [...], więc wstawiamy
// je wprost i kolejność alternatyw nie ma znaczenia.
export const MASK_TOKEN_RE = new RegExp(`\\[(${[...TOKEN_CAT.keys(), 'OSOBA-[A-Z]+'].join('|')})\\]`, 'g');
