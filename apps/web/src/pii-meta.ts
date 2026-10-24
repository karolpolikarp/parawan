import type { PiiType } from 'anonimizator';
import { plural } from './plural';

/* ── JEDNO źródło prawdy o typach PII — z niego wyprowadzamy legendę, znaczniki, chipy,
   przełączniki i tabelę „Co wykrywa” (jedna rodzina kolorów i ikon w całej aplikacji).
   Osobny moduł bez dostępu do DOM, więc spójność tych tabel sprawdzają testy. ── */

export type Cat = 'person' | 'contact' | 'ident' | 'fin' | 'place';

export interface TokenMeta {
  cat: Cat; // kategoria wizualna (kolor + pas w legendzie/tabeli)
  icon: string; // nazwa ikony z icons.ts
  tip: string; // metoda wykrycia w dymku znacznika; nazwę kategorii dokleja maskTip
}

/** Nazwa kategorii: legenda, pasy „Co maskować”, pigułki tabeli i dymki znaczników. */
export const CAT_LABELS: Record<Cat, string> = {
  ident: 'Identyfikatory',
  contact: 'Kontakt',
  fin: 'Finanse',
  place: 'Adres',
  person: 'Osoby',
};

/**
 * Metadane prezentacji per token maski (to, co stoi w [...] w wyniku). To JEDYNE miejsce,
 * w którym żyje kategoria i ikona danego typu — chipy „Zamaskowano”, przełączniki „Co maskować”
 * i legenda czerpią stąd (żadnej z tych wartości nie powielamy w kilku miejscach).
 */
export const PII_TOKENS: Record<string, TokenMeta> = {
  // Identyfikatory
  PESEL: { cat: 'ident', icon: 'pesel', tip: '11 cyfr z poprawną sumą kontrolną albo po etykiecie „PESEL”' },
  NIP: { cat: 'ident', icon: 'nip', tip: '10 cyfr z poprawną sumą kontrolną albo po etykiecie „NIP”' },
  REGON: { cat: 'ident', icon: 'dane-id', tip: '9 lub 14 cyfr z poprawną sumą kontrolną albo po etykiecie „REGON”' },
  'NR-DOWODU': { cat: 'ident', icon: 'numer-dok', tip: '3 litery i 6 cyfr z poprawną sumą kontrolną albo po słowie „dowód”' },
  'NR-PASZPORTU': { cat: 'ident', icon: 'numer-dok', tip: 'kontekst „paszport” + 2 litery + 7 cyfr' },
  KRS: { cat: 'ident', icon: 'dane-id', tip: 'kontekst „KRS” + 10 cyfr' },
  'NR-KSEF': { cat: 'ident', icon: 'numer-dok', tip: 'słowo „KSeF” w dokumencie + numer faktury (NIP-data-znaki) z sumą kontrolną NIP-u' },
  'ZNAK-SPRAWY': { cat: 'ident', icon: 'numer-dok', tip: 'znak sprawy/pisma (JRWA) lub sygnatura akt' },
  'PRAWO-JAZDY': { cat: 'ident', icon: 'numer-dok', tip: 'kontekst „prawo jazdy” + numer z cyfrą' },
  'NR-REJESTRACYJNY': { cat: 'ident', icon: 'numer-dok', tip: 'kontekst „rejestracyjny/tablica” + tablica' },
  VIN: { cat: 'ident', icon: 'dane-id', tip: '17 znaków bez I/O/Q; kontekst „VIN” lub układ VIN' },
  IP: { cat: 'ident', icon: 'dane-id', tip: 'adres IPv4 (oktety 0–255) lub IPv6' },
  MAC: { cat: 'ident', icon: 'dane-id', tip: '6 par hex (00:1A:2B:3C:4D:5E)' },
  // Token i login dają dostęp do konta: klucz, nie koperta (ta oznacza e-mail).
  TOKEN: { cat: 'ident', icon: 'klucz', tip: 'token/JWT (eyJ…), może dawać dostęp' },
  LOGIN: { cat: 'ident', icon: 'klucz', tip: 'kontekst „login/username” + wartość (też w URL i XML/JSON)' },
  // Finanse
  'NR-KONTA': { cat: 'fin', icon: 'iban', tip: 'IBAN (mod 97) lub kontekst „konto/rachunek”' },
  'NR-KARTY': { cat: 'fin', icon: 'iban', tip: 'kontekst „karta/Visa/Mastercard…” + 13–19 cyfr + suma Luhna' },
  // Kontakt
  EMAIL: { cat: 'contact', icon: 'koperta', tip: 'wzorzec adresu e-mail' },
  TELEFON: { cat: 'contact', icon: 'telefon', tip: '9 cyfr, opcjonalnie +48' },
  // Adres
  ADRES: { cat: 'place', icon: 'dom', tip: 'wzorzec ul./al./os./pl. + nazwa + numer' },
  'KOD-POCZTOWY': { cat: 'place', icon: 'mapa-pl', tip: 'wzorzec XX-XXX' },
  'MIEJSCOWOŚĆ': { cat: 'place', icon: 'mapa-pl', tip: 'miejscowość przy adresie, po kodzie pocztowym albo przy zamieszkaniu lub urodzeniu' },
  // Osoby
  'IMIĘ I NAZWISKO': { cat: 'person', icon: 'dane-osobowe', tip: 'słownik imion/nazwisk lub wyzwalacz kontekstu' },
  'DATA-URODZENIA': { cat: 'person', icon: 'kalendarz', tip: 'data z kontekstem „ur./urodzony”' },
};

/**
 * Znacznik [TOKEN] w wyniku: podświetlenie i nawigacja w aplikacji, pogrubienie w .docx.
 * Lista tokenów pochodzi z PII_TOKENS (+ dynamiczne OSOBA-A/B…). Żaden token nie zawiera
 * metaznaków regexu, a każdy jest zakotwiczony nawiasami [...], więc wstawiamy je wprost
 * i kolejność alternatyw nie ma znaczenia. Flaga g: używać przez split, matchAll albo replace,
 * które nie zależą od lastIndex po poprzednim wywołaniu (test i exec zależą).
 */
export const MASK_TOKEN_RE = new RegExp(
  `\\[(${[...Object.keys(PII_TOKENS), 'OSOBA-[A-Z]+'].join('|')})\\]`,
  'g',
);

/** Kategoria wizualna znacznika po nazwie tokenu (OSOBA-* = osoba; nieznany token → identyfikatory). */
export function maskCategory(name: string): Cat {
  if (name.startsWith('OSOBA-')) return 'person';
  return PII_TOKENS[name]?.cat ?? 'ident';
}

/** Dymek znacznika w wyniku: kategoria · metoda wykrycia. */
export function maskTip(name: string): string {
  if (name.startsWith('OSOBA-')) return `${CAT_LABELS.person} · stały znacznik tej samej osoby (${name})`;
  const meta = PII_TOKENS[name];
  return meta ? `${CAT_LABELS[meta.cat]} · ${meta.tip}` : 'Wykryta dana osobowa';
}

/**
 * Nazwa danych w dopełniaczu do adnotacji o wyłączeniu jawności („wyłączono jawność w zakresie:
 * imion i nazwisk, numerów PESEL”): [liczba pojedyncza, liczba mnoga]. Wpis dla KAŻDEGO tokenu
 * z PII_TOKENS (pilnuje pii-meta.test.ts). Kolejność wpisów to kolejność w adnotacji: najpierw
 * osoba, potem adres i kontakt, na końcu numery.
 */
export const GENITIVE_LABEL: Record<string, readonly [string, string]> = {
  'IMIĘ I NAZWISKO': ['imienia i nazwiska', 'imion i nazwisk'],
  'DATA-URODZENIA': ['daty urodzenia', 'dat urodzenia'],
  ADRES: ['adresu', 'adresów'],
  'KOD-POCZTOWY': ['kodu pocztowego', 'kodów pocztowych'],
  'MIEJSCOWOŚĆ': ['nazwy miejscowości', 'nazw miejscowości'],
  TELEFON: ['numeru telefonu', 'numerów telefonów'],
  EMAIL: ['adresu e-mail', 'adresów e-mail'],
  PESEL: ['numeru PESEL', 'numerów PESEL'],
  NIP: ['numeru NIP', 'numerów NIP'],
  REGON: ['numeru REGON', 'numerów REGON'],
  'NR-DOWODU': ['numeru dowodu osobistego', 'numerów dowodów osobistych'],
  'NR-PASZPORTU': ['numeru paszportu', 'numerów paszportów'],
  'PRAWO-JAZDY': ['numeru prawa jazdy', 'numerów praw jazdy'],
  'NR-REJESTRACYJNY': ['numeru rejestracyjnego pojazdu', 'numerów rejestracyjnych pojazdów'],
  VIN: ['numeru VIN', 'numerów VIN'],
  KRS: ['numeru KRS', 'numerów KRS'],
  'NR-KSEF': ['numeru faktury w KSeF', 'numerów faktur w KSeF'],
  'ZNAK-SPRAWY': ['znaku sprawy', 'znaków spraw'],
  'NR-KONTA': ['numeru rachunku bankowego', 'numerów rachunków bankowych'],
  'NR-KARTY': ['numeru karty płatniczej', 'numerów kart płatniczych'],
  IP: ['adresu IP', 'adresów IP'],
  MAC: ['adresu MAC', 'adresów MAC'],
  LOGIN: ['loginu', 'loginów'],
  TOKEN: ['tokenu dostępu', 'tokenów dostępu'],
};

/* ── Przełączniki „Co maskować” (generowane, z ikonami i kodami znaczników) ── */

export interface MaskGroup {
  key: string;
  label: string;
  types: PiiType[];
  cat: Cat;
  icon: string;
  code: string;
  tip: string;
}

// Definicje przełączników „Co maskować” BEZ kategorii i ikony — te wyprowadzamy z PII_TOKENS
// po tokenie z `code`. Zostają tu dane swoiste dla przełącznika: klucz, etykieta, mapowane
// typy rdzenia (`types`), kod znacznika i własny (bardziej szczegółowy niż dymek) opis.
type MaskGroupDef = Omit<MaskGroup, 'cat' | 'icon'>;
export const MASK_GROUP_DEFS: MaskGroupDef[] = [
  { key: 'pesel', label: 'PESEL', types: ['PESEL'], code: '[PESEL]', tip: '11 cyfr + suma kontrolna (przy etykiecie „PESEL” także mimo złej sumy)' },
  { key: 'nip', label: 'NIP', types: ['NIP'], code: '[NIP]', tip: '10 cyfr (także z myślnikami) + suma kontrolna (przy etykiecie „NIP” także mimo złej sumy)' },
  { key: 'regon', label: 'REGON', types: ['REGON'], code: '[REGON]', tip: '9 lub 14 cyfr + suma kontrolna (przy etykiecie „REGON” także mimo złej sumy)' },
  { key: 'dowod', label: 'Nr dowodu osobistego', types: ['DOWOD'], code: '[NR-DOWODU]', tip: '3 litery + 6 cyfr + suma kontrolna (po słowie „dowód” także mimo złej sumy)' },
  { key: 'paszport', label: 'Nr paszportu', types: ['PASZPORT'], code: '[NR-PASZPORTU]', tip: 'Kontekst „paszport” + 2 litery + 7 cyfr' },
  { key: 'krs', label: 'Numer KRS', types: ['KRS'], code: '[KRS]', tip: 'Kontekst „KRS” + 10 cyfr' },
  { key: 'ksef', label: 'Numer KSeF', types: ['KSEF'], code: '[NR-KSEF]', tip: 'Słowo „KSeF” gdziekolwiek w dokumencie + numer faktury (NIP-RRRRMMDD-znaki-suma) z sumą kontrolną NIP-u; także stary format 36-znakowy, a etykieta może stać w nagłówku kolumny lub po numerze' },
  { key: 'znak', label: 'Znak sprawy / pisma', types: ['ZNAK-SPRAWY'], code: '[ZNAK-SPRAWY]', tip: 'Znak sprawy/pisma wg JRWA (ABC-def.123.77.2016) lub sygnatura akt („Sygn. akt II CSK 234/19”)' },
  { key: 'prawojazdy', label: 'Nr prawa jazdy', types: ['PRAWO-JAZDY'], code: '[PRAWO-JAZDY]', tip: 'Kontekst „prawo jazdy” + numer (z cyfrą)' },
  { key: 'rejestracja', label: 'Nr rejestracyjny', types: ['NR-REJESTRACYJNY'], code: '[NR-REJESTRACYJNY]', tip: 'Kontekst „rejestracyjny/tablica” + tablica (WI1234K)' },
  { key: 'vin', label: 'VIN', types: ['VIN'], code: '[VIN]', tip: '17 znaków bez I/O/Q; kontekst „VIN/nadwozia” lub wyraźny układ VIN' },
  { key: 'ip', label: 'Adres IP', types: ['IP'], code: '[IP]', tip: 'IPv4 (oktety 0–255) oraz IPv6' },
  { key: 'mac', label: 'Adres MAC', types: ['MAC'], code: '[MAC]', tip: '6 par hex (00:1A:2B:3C:4D:5E)' },
  { key: 'token', label: 'Token / JWT', types: ['TOKEN'], code: '[TOKEN]', tip: 'Token JWT (eyJ…), może dawać dostęp' },
  { key: 'login', label: 'Login / nazwa użytkownika', types: ['LOGIN'], code: '[LOGIN]', tip: 'Kontekst „login/username/nazwa użytkownika” + wartość; także w parametrach URL (?user=…) i kluczach XML/JSON' },
  { key: 'konto', label: 'IBAN / nr konta', types: ['IBAN', 'NR-KONTA'], code: '[NR-KONTA]', tip: 'Walidacja mod 97 lub kontekst „konto/rachunek”' },
  { key: 'karta', label: 'Karta płatnicza', types: ['KARTA'], code: '[NR-KARTY]', tip: 'Kontekst „karta/Visa/Mastercard/Amex…” + 13–19 cyfr, prefiks sieci + suma Luhna' },
  { key: 'email', label: 'E-mail', types: ['EMAIL'], code: '[EMAIL]', tip: 'Wzorzec adresu e-mail' },
  { key: 'telefon', label: 'Telefon', types: ['TELEFON'], code: '[TELEFON]', tip: '9 cyfr, opcjonalnie prefiks +48' },
  { key: 'adres', label: 'Adres', types: ['ADRES'], code: '[ADRES]', tip: 'ul./al./os./pl. + nazwa + numer' },
  { key: 'kod', label: 'Kod pocztowy', types: ['KOD-POCZTOWY'], code: '[KOD-POCZTOWY]', tip: 'Wzorzec XX-XXX' },
  { key: 'miejscowosc', label: 'Miejscowość', types: ['MIEJSCOWOSC'], code: '[MIEJSCOWOŚĆ]', tip: 'Miejscowość przy adresie (przed nim lub po nim), po kodzie pocztowym albo przy zamieszkaniu lub urodzeniu; nie w zwykłym tekście' },
  { key: 'imie', label: 'Imię i nazwisko', types: ['IMIE'], code: '[IMIĘ I NAZWISKO]', tip: 'Słownik imion i nazwisk z odmianą, morfologia (-ski/-cki/-icz/-czyk) i wyzwalacze kontekstu; wykrywanie heurystyczne' },
  { key: 'dataur', label: 'Data urodzenia', types: ['DATA-UR'], code: '[DATA-URODZENIA]', tip: 'Data z kontekstem „ur./urodzony”' },
];

/** Token wewnątrz [...] z kodu znacznika, np. „[NR-KONTA]” → „NR-KONTA”. */
export const tokenOfCode = (code: string): string => code.slice(1, -1);

// Kategoria i ikona każdego przełącznika pochodzą z PII_TOKENS (po tokenie z `code`) — nie
// duplikujemy ich. Że dla każdego kodu para (kategoria, ikona) tam jest, pilnuje pii-meta.test.ts.
export const MASK_GROUPS: MaskGroup[] = MASK_GROUP_DEFS.map((g) => {
  const meta = PII_TOKENS[tokenOfCode(g.code)];
  return { ...g, cat: meta.cat, icon: meta.icon };
});

/** Token znacznika po typie rdzenia (IBAN i NR-KONTA → „NR-KONTA”, IMIE → „IMIĘ I NAZWISKO”). */
export const TYPE_TOKEN: Record<string, string> = Object.fromEntries(
  MASK_GROUP_DEFS.flatMap((g) => g.types.map((t) => [t, tokenOfCode(g.code)])),
);

/** Licznik typów kategorii w legendzie, np. „15 typów” (liczony z przełączników). */
export function catCountLabel(cat: Cat): string {
  const n = MASK_GROUPS.filter((g) => g.cat === cat).length;
  return `${n} ${plural(n, 'typ', 'typy', 'typów')}`;
}

/* ── Tabela „Co wykrywa” — generowana z jednego źródła (nie ~130 linii statycznego HTML) ── */
// Opis „jak rozpoznaje” jest SWOISTY dla tabeli (z wyróżnieniem <strong>/<code>, zaufany statyczny
// HTML) i determinuje KOLEJNOŚĆ wierszy. Nazwa, kategoria, ikona i kod pochodzą z MASK_GROUPS/
// PII_TOKENS po kodzie znacznika — nie powielamy ich tu.
export const WYKRYWA_ROWS: Array<{ code: string; how: string }> = [
  { code: '[PESEL]', how: '11 cyfr + <strong>walidacja sumy kontrolnej</strong> (przy etykiecie „PESEL” także mimo złej sumy)' },
  { code: '[NIP]', how: '10 cyfr (także z myślnikami) + <strong>suma kontrolna</strong> (przy etykiecie „NIP” także mimo złej sumy)' },
  { code: '[REGON]', how: '9/14 cyfr + <strong>suma kontrolna</strong> (przy etykiecie „REGON” także mimo złej sumy)' },
  { code: '[NR-DOWODU]', how: '3 litery + 6 cyfr + <strong>suma kontrolna</strong> (po słowie „dowód” także mimo złej sumy)' },
  { code: '[NR-PASZPORTU]', how: 'kontekst „paszport” + 2 litery + 7 cyfr' },
  { code: '[KRS]', how: 'kontekst „KRS” + 10 cyfr' },
  { code: '[NR-KSEF]', how: 'słowo „KSeF” w dokumencie + numer faktury (<code>NIP-RRRRMMDD-…</code>) + <strong>suma kontrolna NIP-u</strong>' },
  { code: '[ZNAK-SPRAWY]', how: 'znak sprawy/pisma wg JRWA lub sygnatura akt („Sygn. akt II CSK 234/19”)' },
  { code: '[PRAWO-JAZDY]', how: 'kontekst „prawo jazdy” + numer (z cyfrą)' },
  { code: '[NR-REJESTRACYJNY]', how: 'kontekst „rejestracyjny/tablica/pojazd” + tablica (np. WI1234K)' },
  { code: '[VIN]', how: '17 znaków bez I/O/Q; kontekst „VIN/nadwozia” lub wyraźny układ VIN' },
  { code: '[IP]', how: 'IPv4 (oktety 0–255) oraz IPv6' },
  { code: '[MAC]', how: '6 par hex (00:1A:2B:3C:4D:5E)' },
  { code: '[TOKEN]', how: 'token JWT (<code>eyJ…</code>), może dawać dostęp' },
  { code: '[LOGIN]', how: 'kontekst „login/username” + wartość (też w URL i XML/JSON)' },
  { code: '[NR-KONTA]', how: 'walidacja <strong>mod 97</strong> lub kontekst „konto/rachunek”' },
  { code: '[NR-KARTY]', how: 'kontekst „karta/Visa/Mastercard…” + 13–19 cyfr, prefiks sieci + <strong>suma Luhna</strong>' },
  { code: '[EMAIL]', how: 'wzorzec adresu' },
  { code: '[TELEFON]', how: '9 cyfr, opcjonalnie +48' },
  { code: '[ADRES]', how: 'ul./al./os./pl. + nazwa + numer' },
  { code: '[KOD-POCZTOWY]', how: 'XX-XXX' },
  { code: '[MIEJSCOWOŚĆ]', how: 'miejscowość przy adresie, po kodzie pocztowym albo przy zamieszkaniu lub urodzeniu (nie w zwykłym tekście ani w nazwie instytucji)' },
  { code: '[DATA-URODZENIA]', how: 'data z kontekstem „ur./urodzony”' },
  { code: '[IMIĘ I NAZWISKO]', how: 'słownik imion i nazwisk (z odmianą), morfologia (-ski/-cki/-icz/-czyk), wyzwalacze („nazywam się”, „Pan/Pani”)' },
];

/* ── Chipy „Zamaskowano” ── */

// Krótka etykieta chipa per typ rdzenia (finding.type), swoista dla chipa. Record<PiiType, …>:
// nowy typ w rdzeniu bez etykiety tutaj nie przejdzie typecheck (tsc w CI). Token, kategorię
// i ikonę wyprowadzamy z TYPE_TOKEN i PII_TOKENS (jedno źródło).
const CHIP_LABELS: Record<PiiType, string> = {
  IMIE: 'imię i nazwisko',
  PESEL: 'PESEL',
  NIP: 'NIP',
  REGON: 'REGON',
  DOWOD: 'nr dowodu',
  PASZPORT: 'nr paszportu',
  KRS: 'numer KRS',
  KSEF: 'numer KSeF',
  'ZNAK-SPRAWY': 'znak sprawy',
  'PRAWO-JAZDY': 'nr prawa jazdy',
  'NR-REJESTRACYJNY': 'nr rejestracyjny',
  VIN: 'VIN',
  IP: 'adres IP',
  MAC: 'adres MAC',
  TOKEN: 'token',
  LOGIN: 'login',
  IBAN: 'nr konta',
  'NR-KONTA': 'nr konta',
  KARTA: 'nr karty',
  EMAIL: 'e-mail',
  TELEFON: 'telefon',
  ADRES: 'adres',
  'KOD-POCZTOWY': 'kod pocztowy',
  MIEJSCOWOSC: 'miejscowość',
  'DATA-UR': 'data urodzenia',
};

export interface ChipMeta {
  label: string;
  token: string;
  cat: Cat;
  icon: string;
}

export const CHIP_META: Record<string, ChipMeta> = Object.fromEntries(
  Object.entries(CHIP_LABELS).map(([type, label]) => {
    const token = TYPE_TOKEN[type] ?? type;
    const meta = PII_TOKENS[token];
    return [type, { label, token, cat: meta?.cat ?? 'ident', icon: meta?.icon ?? 'dane-id' }];
  }),
);

/**
 * Chip po nazwie tokenu z wyniku (chipy liczą znaczniki z zakresów, nie liczniki rdzenia).
 * Kilka typów może mieć ten sam token: bierzemy pierwszy wpis, etykieta i tak łączy je w jeden chip.
 */
export const CHIP_BY_TOKEN: Record<string, ChipMeta> = {};
for (const m of Object.values(CHIP_META)) CHIP_BY_TOKEN[m.token] ??= m;
