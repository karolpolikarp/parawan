/**
 * Znaczniki rdzenia i ich kategorie wizualne dla demo na landingu. Osobny moduł bez DOM,
 * żeby spójność z rdzeniem mógł sprawdzić test (apps/web/src/landing.test.ts).
 *
 * SYNCHRONIZACJA: `token` to tekst z mapy MASK w packages/core/src/types.ts (bez nawiasów).
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
  'NR-UPRAWNIEN': { token: 'NR-UPRAWNIEŃ', cat: 'ident' },
  'KARTA-POBYTU': { token: 'NR-KARTY-POBYTU', cat: 'ident' },
  'AKT-USC': { token: 'NR-AKTU-USC', cat: 'ident' },
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
  ZDROWIE: { token: 'DANE O ZDROWIU', cat: 'person' },
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

/** Kategorie w kolejności legendy (jak MASK_GROUP_DEFS w aplikacji) i ich nazwy na stronie. */
export const KOLEJNOSC_KAT: readonly Cat[] = ['ident', 'fin', 'contact', 'place', 'person'];
export const NAZWA_KAT: Record<Cat, string> = {
  ident: 'Identyfikatory',
  fin: 'Finanse',
  contact: 'Kontakt',
  place: 'Adres',
  person: 'Osoby',
};

/**
 * Pismo w scenie „Parawany stają tylko przy danych” (sekcja #plaza). Zmyślone wezwanie do
 * zapłaty: PESEL i numer konta mają poprawne sumy kontrolne, numer faktury celowo złą (inny niż
 * numer zamówienia z EXAMPLE_TEXT: na jednej stronie jeden numer ma jedną rolę). Wynik
 * redactPII liczy przy buildzie wtyczka parawanTresc (vite.config.ts, src/scena.ts), a test
 * apps/web/src/landing-scena.test.ts sprawdza, że każda dana jest zasłonięta w całości.
 * Akapity rozdziela pusta linia: pierwszy to data, drugi adresat, trzeci tytuł, ostatni podpis.
 */
export const PISMO_TEXT = `Kraków, 14 października 2026 r.

Pan
Tomasz Kowalczyk
ul. Długa 7/12
30-512 Kraków

Przedsądowe wezwanie do zapłaty

Działając w imieniu Anny Nowak (PESEL 90031512348), wzywam Pana do zapłaty kwoty 8 400 zł tytułem czynszu za lipiec i sierpień 2026 r. (faktura nr 75104832619). Kwotę proszę wpłacić w ciągu 7 dni od doręczenia na rachunek PL61 1090 1014 0000 0712 1981 2874.

Od dnia wymagalności naliczam odsetki ustawowe za opóźnienie (art. 481 § 1 KC). Sąd Najwyższy w wyroku z 12 marca 2019 r. (II CSK 123/18) potwierdził, że brak odpowiedzi na wezwanie nie wstrzymuje ich biegu.

Po bezskutecznym upływie terminu wniosę pozew do Sądu Rejonowego dla Krakowa-Śródmieścia. W sprawie rat proszę dzwonić pod numer 512 345 678.

Radca prawny
Ewa Zielińska`;

/**
 * Fragmenty pisma, które mają zostać „na słońcu” (bez znacznika), z krótkim powodem. Test sceny
 * sprawdza, że każdy stoi w piśmie i w wyniku silnika bez zmian.
 */
export const ZOSTAW: readonly { t: string; n: string }[] = [
  { t: 'Kraków', n: 'miejsce wystawienia' },
  { t: '8 400 zł', n: 'kwota' },
  { t: '75104832619', n: 'numer faktury' },
  { t: 'art. 481 § 1 KC', n: 'przepis' },
  { t: '12 marca 2019 r.', n: 'data wyroku' },
  { t: 'II CSK 123/18', n: 'sygnatura cytowanego wyroku' },
  { t: 'Sądu Rejonowego dla Krakowa-Śródmieścia', n: 'nazwa sądu' },
];

/** Adres na odwrocie pocztówki w pierwszym ekranie (zasłonięty przy buildzie). */
export const ADRES_POCZTOWKI = 'Pan\nTomasz Kowalczyk\nul. Długa 7/12\n30-512 Kraków';
