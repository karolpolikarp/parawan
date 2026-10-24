/**
 * Rdzeń „Parawan" (pakiet npm `anonimizator`) — twarda, deterministyczna redakcja
 * polskich danych osobowych (PII).
 *
 * Cel: USUNĄĆ dane osobowe z tekstu, zanim trafi gdziekolwiek dalej (LLM, baza danych,
 * logi, e-mail, cache). To NIE jest „ostrzeżenie" — to redakcja: każde wykryte PII
 * jest zamieniane na neutralny placeholder ([PESEL], [NIP], [IMIĘ I NAZWISKO]…), który
 * zachowuje sens tekstu, ale nie pozwala zidentyfikować osoby.
 *
 * Dwie klasy detekcji:
 *  1. STRUKTURALNE (wysoka pewność) — PESEL, NIP, REGON, IBAN/nr konta, nr dowodu, e-mail,
 *     telefon, kod pocztowy. Tam gdzie istnieje suma kontrolna (PESEL/NIP/REGON/IBAN/dowód)
 *     WALIDUJEMY ją — to tnie fałszywe trafienia (np. sygnatura akt „123456 7890" ≠ NIP).
 *  2. HEURYSTYCZNE (umiarkowana pewność) — imię+nazwisko (słownik polskich imion + wyzwalacze
 *     kontekstu) oraz adres (ul./al./os. + numer). Pełny NER (odmiana, rzadkie nazwiska) wymaga
 *     osobnego modelu — to świadomy kompromis tej warstwy (patrz README: ograniczenia).
 *
 * ZERO zależności i zero API środowiska (brak Deno.env / window / process) — ten sam plik
 * działa identycznie w Node, Deno, Bun i przeglądarce.
 *
 * Funkcja jest idempotentna: placeholdery nie zawierają cyfr ani „@", więc ponowny przebieg
 * (np. dwa niezależne przejścia redakcji) niczego nie psuje.
 */

import {
  normalizeSurnameKey,
  surnameBase,
  looksLikeSurname,
  isAsciiSurname,
  foldAscii,
  isGeoAdjective,
  isCompoundAdjective,
  NON_SURNAME_ADJ,
  HOMOGRAPH_SURNAMES,
  homographBase,
  COMMON_NOUN_LOOKALIKES,
  DIMINUTIVE_LOOKALIKES,
} from './surnames.js';

export type PiiType =
  | 'EMAIL'
  | 'IBAN'
  | 'NR-KONTA'
  | 'KARTA'
  | 'PESEL'
  | 'NIP'
  | 'REGON'
  | 'TELEFON'
  | 'DOWOD'
  | 'PASZPORT'
  | 'KRS'
  | 'KSEF'
  | 'KW'
  | 'PRAWO-JAZDY'
  | 'NR-REJESTRACYJNY'
  | 'VIN'
  | 'IP'
  | 'MAC'
  | 'TOKEN'
  | 'LOGIN'
  | 'ZNAK-SPRAWY'
  | 'KOD-POCZTOWY'
  | 'DATA-UR'
  | 'ADRES'
  | 'MIEJSCOWOSC'
  | 'IMIE';

export interface PiiFinding {
  type: PiiType;
  /** liczba wystąpień zredagowanych w tekście (NIGDY nie zapisujemy oryginalnej wartości) */
  count: number;
}

export interface RedactionResult {
  redacted: string;
  found: PiiFinding[];
}

export interface RedactOptions {
  /** Typy do maskowania. Domyślnie (brak pola) — WSZYSTKIE. Pusta lista = nic nie maskuj. */
  types?: PiiType[];
  /**
   * Własne placeholdery per typ. UWAGA na idempotencję: placeholder nie może zawierać cyfr
   * ani „@" — inaczej ponowny przebieg redakcji mógłby go pożreć jako PII.
   */
  masks?: Partial<Record<PiiType, string>>;
  /**
   * Spójna pseudonimizacja osób: zamiast jednej maski [IMIĘ I NAZWISKO] każda osoba
   * dostaje stałą etykietę [OSOBA-A], [OSOBA-B]… — ta sama osoba (także w odmianie:
   * Kowalski/Kowalskiego/Kowalskiemu) zachowuje tę samą literę. Zachowuje strukturę
   * relacji w dokumencie. Klucz tożsamości = znormalizowane nazwisko, więc osoby
   * o tym samym nazwisku (Jan i Anna Kowalscy) dostają wspólną etykietę — ograniczenie.
   */
  pseudonyms?: boolean;
}

/** 0→A, 1→B… 25→Z, 26→AA… (etykiety bez cyfr — idempotencja placeholderów). */
function indexToLetters(i: number): string {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Odwrotność indexToLetters (A→0, B→1… AA→26) — przywracanie sentineli URL. */
function lettersToIndex(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

/** Etykiety placeholderów (czytelne dla człowieka i modelu, bez cyfr → idempotentne). */
const MASK: Record<PiiType, string> = {
  EMAIL: '[EMAIL]',
  IBAN: '[NR-KONTA]',
  'NR-KONTA': '[NR-KONTA]',
  KARTA: '[NR-KARTY]',
  PESEL: '[PESEL]',
  NIP: '[NIP]',
  REGON: '[REGON]',
  TELEFON: '[TELEFON]',
  DOWOD: '[NR-DOWODU]',
  PASZPORT: '[NR-PASZPORTU]',
  KRS: '[KRS]',
  KSEF: '[NR-KSEF]',
  KW: '[NR-KW]',
  'PRAWO-JAZDY': '[PRAWO-JAZDY]',
  'NR-REJESTRACYJNY': '[NR-REJESTRACYJNY]',
  VIN: '[VIN]',
  IP: '[IP]',
  MAC: '[MAC]',
  TOKEN: '[TOKEN]',
  LOGIN: '[LOGIN]',
  'ZNAK-SPRAWY': '[ZNAK-SPRAWY]',
  'KOD-POCZTOWY': '[KOD-POCZTOWY]',
  'DATA-UR': '[DATA-URODZENIA]',
  ADRES: '[ADRES]',
  MIEJSCOWOSC: '[MIEJSCOWOŚĆ]',
  IMIE: '[IMIĘ I NAZWISKO]',
};

// ============================================================================
// Sumy kontrolne (walidacja tnie false-positive do <5%)
// ============================================================================

const onlyDigits = (s: string): number[] =>
  s.replace(/\D/g, '').split('').map((d) => parseInt(d, 10));

/**
 * Wspólny szkielet walidacji sumy kontrolnej „waga × cyfra" (PESEL/NIP/REGON).
 * Sumujemy iloczyny cyfr 0..len-2 z `weights`, a `control(sum)` zwraca oczekiwaną OSTATNIĄ
 * cyfrę kontrolną — albo `null`, gdy dana suma czyni numer nieważnym (wtedy `null === d[…]`
 * jest zawsze fałszem). Cztery walidatory różnią się tylko długością, wagami i regułą kontroli.
 */
function weightedChecksum(
  s: string,
  len: number,
  weights: number[],
  control: (sum: number) => number | null,
): boolean {
  const d = onlyDigits(s);
  if (d.length !== len) return false;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += d[i] * weights[i];
  return control(sum) === d[len - 1];
}

/** PESEL: 11 cyfr, wagi [1,3,7,9,1,3,7,9,1,3], cyfra kontrolna = (10 − sum%10)%10. */
export function isValidPesel(s: string): boolean {
  return weightedChecksum(s, 11, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], (sum) => (10 - (sum % 10)) % 10);
}

/** NIP: 10 cyfr, wagi [6,5,7,2,3,4,5,6,7], kontrola = sum%11 (10 → numer nieważny). */
export function isValidNip(s: string): boolean {
  return weightedChecksum(s, 10, [6, 5, 7, 2, 3, 4, 5, 6, 7], (sum) => {
    const c = sum % 11;
    return c === 10 ? null : c;
  });
}

/** REGON 9-cyfrowy: wagi [8,9,2,3,4,5,6,7], kontrola = sum%11 (10 → 0). */
export function isValidRegon9(s: string): boolean {
  return weightedChecksum(s, 9, [8, 9, 2, 3, 4, 5, 6, 7], (sum) => (sum % 11 === 10 ? 0 : sum % 11));
}

/** REGON 14-cyfrowy: wagi [2,4,8,5,0,9,7,3,6,1,2,4,8], kontrola = sum%11 (10 → 0). */
export function isValidRegon14(s: string): boolean {
  return weightedChecksum(
    s,
    14,
    [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8],
    (sum) => (sum % 11 === 10 ? 0 : sum % 11),
  );
}

/** IBAN (dowolny kraj): przenieś 4 pierwsze znaki na koniec, litery→liczby (A=10), mod 97 == 1. */
export function isValidIban(raw: string): boolean {
  // łączniki z kanonicznego zapisu grupami („PL57-1140-2004-…") jak odstępy
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of code) {
      remainder = (remainder * 10 + parseInt(c, 10)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * Nr dowodu osobistego: 3 litery + 6 cyfr, wagi [7,3,1,9,7,3,1,7,3] (litera A=10…Z=35),
 * suma ważona WSZYSTKICH 9 znaków (cyfra kontrolna na pozycji 4, waga 9) % 10 == 0.
 * Wektory kontrolne: ABA300000 (7·10+3·11+1·10+9·3 = 140) oraz wzór z materiałów MSWiA
 * ABS123456 (70+33+28+9+14+9+4+35+18 = 220). Do v0.46.22 wagi części cyfrowej były
 * przesunięte ([…,9,1,7,3,1,7]) — ABA300000 to nie wykrywał (same zera), ale ~9 na 10
 * prawdziwych numerów odpadało, więc dowód bez słowa „dowód" obok wyciekał.
 */
export function isValidDowod(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{3}\d{6}$/.test(s)) return false;
  const w = [7, 3, 1, 9, 7, 3, 1, 7, 3];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const ch = s[i];
    const val = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : parseInt(ch, 10);
    sum += val * w[i];
  }
  return sum % 10 === 0;
}

/**
 * Numer księgi wieczystej: kod wydziału (dwie litery, cyfra, litera), 8 cyfr i cyfra kontrolna,
 * np. „WA1M/00166077/5". Cyfra kontrolna = suma 12 pierwszych znaków z wagami 1, 3, 7 (powtarzanymi)
 * modulo 10; cyfra to swoja wartość, litery mają X=10, A=11, B=12… z pominięciem Q i V (nie występują
 * w kodach wydziałów), więc R=27, S=28, T=29, U=30, W=31, Y=32, Z=33. Algorytm potwierdzony
 * 24.10.2026 na 17 prawdziwych numerach z publicznych ogłoszeń o przetargach (kody KR1P, GD1G,
 * WR1K, WA1M, LD1M, SZ1S, LU1P): wszystkie przechodzą.
 */
const KW_ALPHABET = '0123456789XABCDEFGHIJKLMNOPRSTUWYZ';
export function isValidKw(raw: string): boolean {
  const s = raw.replace(/[\s/]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d[A-Z]\d{9}$/.test(s)) return false;
  const w = [1, 3, 7];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = KW_ALPHABET.indexOf(s[i]);
    if (v < 0) return false;
    sum += v * w[i % 3];
  }
  return sum % 10 === Number(s[12]);
}

/** Suma Luhna (mod 10) — walidacja numerów kart płatniczych. */
function luhnValid(digits: number[]): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let x = digits[i];
    if (double) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Prefiks (IIN) znanej sieci: Visa/Mastercard/Amex/Discover/Diners/JCB. Sam Luhn przepuszcza
 * ~1/10 losowych ciągów — dopiero prefiks + długość + Luhn dają pewność „to naprawdę karta".
 * Maestro i rzadkie sieci (szeroki, mało specyficzny prefiks 50/56–69) celowo pomijamy: ich
 * dodanie zawyżyłoby liczbę fałszywych trafień (precyzja > nadmaskowanie).
 */
function hasCardPrefix(d: number[]): boolean {
  const p2 = d[0] * 10 + d[1];
  const p4 = p2 * 100 + d[2] * 10 + d[3];
  if (d[0] === 4) return true; // Visa
  if (p2 >= 51 && p2 <= 55) return true; // Mastercard
  if (p4 >= 2221 && p4 <= 2720) return true; // Mastercard (seria 2)
  if (p2 === 34 || p2 === 37) return true; // American Express
  if (p2 === 36 || p2 === 38 || p2 === 39) return true; // Diners Club
  if (d[0] === 3 && d[1] === 0 && d[2] <= 5) return true; // Diners 300–305
  if (p4 === 6011 || p2 === 65) return true; // Discover
  if (p2 === 64 && d[2] >= 4 && d[2] <= 9) return true; // Discover 644–649
  if (p4 >= 3528 && p4 <= 3589) return true; // JCB
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return true; // Maestro (szeroki prefiks — bezpieczny TYLKO z kontekstem karty)
  return false;
}

/**
 * Numer karty płatniczej: 13–19 cyfr, prefiks znanej sieci + suma Luhna. Kombinacja tych trzech
 * cech jest bardzo specyficzna (jak IBAN mod-97), więc wystarcza SAMODZIELNIE, bez etykiety.
 */
export function isValidCard(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length < 13 || d.length > 19) return false;
  if (!hasCardPrefix(d)) return false;
  return luhnValid(d);
}

// ============================================================================
// Strażniki kontekstu — nie myl numeru przepisu z numerem identyfikacyjnym
// ============================================================================

/**
 * Czy dopasowanie jest poprzedzone odwołaniem do aktu/przepisu (art., §, ust., poz., Dz.U., sygn.)?
 * Wtedy ciąg cyfr to numer artykułu/pozycji, NIE telefon/PESEL — nie redagujemy.
 * (Dokumenty urzędowe i prawne są pełne takich odwołań — bez tego strażnika toną w maskach.)
 */
function precededByLegalRef(full: string, offset: number): boolean {
  // Okno 24 znaki — mieści dłuższe frazy jak „w rejestrze " czy „porządkowy ".
  const before = full.slice(Math.max(0, offset - 24), offset);
  // „regon": ciąg po tej kotwicy to (nie)poprawny REGON — obsłużony (albo słusznie
  // odrzucony) przez krok REGON; detektor telefonu nie może go pożerać (bug z benchmarku).
  // „lp./porządkow…/rejestr…": numer porządkowy pozycji w rejestrze ≠ telefon.
  // „seryjn…/wersj…": numer seryjny urządzenia i numer wersji ≠ telefon/IP.
  return /(art\.?|§|ust\.?|pkt|poz\.?|sygn\.?|nr\s|dz\.?\s?u|regon|lp\.?|porządkow\w+|rejestr\w*|seryjn\w+|wersj\w+)\s*$/i.test(before);
}

/**
 * Czy tuż przed liczbą stoi etykieta numeru, który z definicji NIE jest telefonem („Nr seryjny:",
 * „Numer zamówienia", „Kod kreskowy:", „S/N:", „Zamówienie #", „(build")? precededByLegalRef
 * wymaga etykiety bezpośrednio przed cyframi, więc dwukropek albo rzeczownik po „nr" ją omijały,
 * a to najczęstszy zapis w formularzach, fakturach i zleceniach badań. Tylko dla trybu (c)
 * telefonu — inne przebiegi (PESEL/NIP/IP) mają własne kotwice. Etykieta stoi w TEJ SAMEJ linii.
 * Świadomie bez „pacjenta/klienta" (to identyfikatory osoby) i bez gołego „Numer:" — tam bywa telefon.
 * Jeden wyraz dopowiedzenia wolno („Numer seryjny urządzenia"), ale nie „telefon…/kontakt…"
 * („Nr zamówień telefonicznych: 512 345 678" to infolinia, czyli telefon).
 */
const RE_NON_PHONE_LABEL = new RegExp(
  '(?:(?<![\\p{L}\\d])(?:nr|numer|kod|id|identyfikator)\\.?[ \\t]+' +
    '(?:seryjn\\p{L}*|fabryczn\\p{L}*|zamówie(?:nia|ń)|ogłosze(?:nia|ń)|zlecenia|faktury|próbki|badania|' +
    'dokumentu|paragonu|przesyłki|transakcji|kreskowy|referencyjny|partii)(?:[ \\t]+(?!tel|kom|kontakt)\\p{L}+)?[ \\t]*[:#=.-]?' +
    '|(?<![\\p{L}\\d])s\\/n[ \\t]*:?|(?<![\\p{L}\\d])seryjn\\p{L}*[ \\t]*:|(?<![\\p{L}\\d])build[ \\t]*[:#]?' +
    '|(?<![\\p{L}\\d&])#)[ \\t]*$',
  'iu',
);
function precededByNonPhoneLabel(full: string, offset: number): boolean {
  return RE_NON_PHONE_LABEL.test(full.slice(Math.max(0, offset - 48), offset));
}

// ============================================================================
// Słownik polskich imion (najczęstsze) — podnosi precyzję detekcji „Imię Nazwisko"
// ============================================================================

const POLISH_FIRST_NAMES = new Set<string>(
  (
    'adam adrian agata agnieszka aleksander aleksandra alicja alina amelia andrzej aniela anna ' +
    'antoni antonina arkadiusz artur bartłomiej bartosz beata bogdan bogumił bogusław bożena ' +
    'cezary daniel danuta dariusz dawid dominik dominika dorota edward elżbieta emil emilia ewa ' +
    'ewelina filip franciszek gabriel gabriela grażyna grzegorz halina hanna helena henryk hubert ' +
    'igor ilona irena iwona izabela jacek jadwiga jakub jan janina janusz jarosław jerzy joanna ' +
    'jolanta józef julia julian justyna kacper kamil kamila karina karol karolina katarzyna kazimierz ' +
    'kinga klaudia konrad krystyna krzysztof lena leszek lidia ludwik łukasz maciej magdalena maja ' +
    'małgorzata marcin marek maria mariola mariusz marta martyna mateusz michał mieczysław mikołaj ' +
    'milena mirosław mirosława monika nadia natalia nikodem nikola norbert oliwia oskar patryk patrycja ' +
    'paulina paweł piotr przemysław rafał radosław renata robert roman ryszard sandra sebastian ' +
    'sławomir stanisław stanisława stefan stefania sylwester sylwia szymon tadeusz teresa tomasz ' +
    'urszula wacław waldemar weronika wiesław wiktor wiktoria wincenty witold władysław włodzimierz ' +
    'wojciech zbigniew zdzisław zofia zuzanna ' +
    // uzupełnienie częstych imion (luka pokrycia wykryta na nagłówkach e-maili urzędowych)
    'edyta aneta iga izabella jagoda klara liliana lucyna łucja marzena nina olga otylia sabina wanda ' +
    'żaneta róża blanka cecylia dagmara diana eliza elwira felicja kalina laura ludmiła malwina michalina ' +
    'oktawia paula rozalia sara wioletta wiola bogna bożena elwira ewelina emilia lena maja pola nadzieja ' +
    'alan borys cyprian damian dionizy erwin ernest fabian gustaw ignacy kajetan kornel ksawery leon lech ' +
    'marceli maurycy maksymilian olaf remigiusz rudolf seweryn teodor tobiasz walenty wit zenon jeremi jędrzej ' +
    'krystian leonard iwo alojzy bruno feliks gerard konstanty maksym miron przemek roch salomon tymon tymoteusz ' +
    // uzupełnienie: częste imiona wcześniej pomijane — bez nich pary „imię nazwisko" pisane
    // WERSALIKAMI lub małymi literami nie były łapane (detekcja par zależy od słownika imion)
    'pamela melania kornelia apolonia sonia tamara żaklina walentyna celina aurelia benedykt alfred edmund herbert oktawian klemens ' +
    // uzupełnienie częstych imion pełnych brakujących w słowniku (luka recall wykryta audytem v0.46.20)
    'barbara genowefa czesław bronisław eugeniusz ' +
    // ZDROBNIENIA/spieszczenia (v0.46.19) — imiona są maskowane TYLKO w parze z nazwiskiem/po
    // wyzwalaczu, więc dodanie zdrobnień podnosi recall („Janek Kowalski") bez FP na samo zdrobnienie.
    // Kuratorowane z listy wygenerowanej adwersarialnie: mianownik, ≥4 znaki, bez kolizji z wyrazem
    // pospolitym (odrzucono m.in. kuba/maks/jasiek/pola/misiek/ryś — mylące z rzeczownikiem).
    'janek jaś tomek tomcio franek franio staś stasiek staszek michałek michaś wojtek wojtuś bartek ' +
    'bartuś maciek maciuś piotrek piotruś krzysiek krzyś grzesiek grześ adaś jędrek jędrko jędruś olek ' +
    'oleś romek romcio heniek henio władek stefek zbyszek zbyś mietek antek antoś benek benio gustek ' +
    'kacperek kajtek kubuś mirek darek arek radek rafałek przemek sławek sylwek tadek tymek tymuś wicek ' +
    'witek zenek kamilek konradek oskarek filipek szymek szymuś dawidek damianek bronek gienek jurek ' +
    'marecik nikodemek tobiaszek gabrielek borysek cyprianek fabianek sebastianek ksaweryk arturek ' +
    'andrzejek ignaś leoś lucek zdzisiek zdziś czesiek józek longinek walek wawrek gieniek heniuś ' +
    'kasia zosia basia gosia małgosia madzia ania hania asia jola renia marysia magda magdusia dorotka ' +
    'dorka dosia kingusia natalka julka julcia ulcia wiktorka gabrysia monisia monka kamcia martusia ' +
    'marteczka danusia danka halinka krysia kryśka jadzia wiesia stefcia bożenka tereska tesia elka ewka ' +
    'ewelinka kaśka gośka baśka zośka agatka alcia anka hanka izabelka joasia józia karolinka lidka ' +
    'lucynka marlenka natusia olcia olka paulinka roksanka sabinka sylwka wandzia weronka wiolka zuzia ' +
    'zuzka jagusia kalinka klaudka kornelka michasia martunia nikolka otylka rózia tosia beatka anetka ' +
    'aneczka emilka klarka nelka nadzia oleńka helcia'
  ).split(/\s+/),
);

const PL_UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
const PL_LO = 'a-ząćęłńóśźż';
// Litery obcych nazwisk (niemieckie, czeskie, słowackie, francuskie, hiszpańskie, węgierskie,
// skandynawskie, tureckie) — TYLKO w członach osoby i w granicach reguł osobowych: „Schröder",
// „Müller", „Dvořák", „Čapek", „Peña". Klasy PL_* ich nie znały, więc „Anna Schröder" dawała
// „[IMIĘ I NAZWISKO]öder" (dopasowanie kończyło się przed „ö"), a „Jan Müller" czy „Pan Müller"
// przechodziły w całości. Miasta, adresy i kotwice zostają przy polskim alfabecie; obcy wyraz sam
// osobą się nie staje — potrzebne jest imię ze słownika, wyzwalacz „Pan/Pani" albo inna kotwica.
// Do tego rumuńskie „ș ț" z przecinkiem, azerskie „ə" i wietnamskie litery z kropką lub hakiem
// („Mureșan", „Thị", „Kiệt"). Bez nich maska kończyła się w środku wyrazu („Pani [..]șan", „Pani
// [..]ị Hoa"). Wietnamskie U+1EA0–U+1EF9 idą na przemian: parzyste wielkie, nieparzyste małe.
const VI_LETTERS = (lower: number): string =>
  Array.from({ length: 45 }, (_, i) => String.fromCharCode(0x1ea0 + 2 * i + lower)).join('');
const NM_UP = `${PL_UP}ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÔÕÖØÙÚÛÜÝÞĀĂĈĊČĎĐĒĔĖĚĜĞĠĢĤĦĨĪĬĮİĴĶĹĻĽĿŅŇŌŎŐŒŔŖŘŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŽȘȚƠƯƏ${VI_LETTERS(0)}`;
/** Małe litery obce (bez polskich) — ogon nazwiska za polskim rdzeniem („Koval|čuk", „Bondar|čuk"). */
const NM_LO_EXTRA = `ßàáâãäåæçèéêëìíîïðñòôõöøùúûüýþÿāăĉċčďđēĕėěĝğġģĥħĩīĭįıĵķĺļľŀņňōŏőœŕŗřŝşšţťŧũūŭůűųŵŷžșțơưə${VI_LETTERS(1)}`;
const NM_LO = `${PL_LO}${NM_LO_EXTRA}`;
// GRANICA wyrazu w regułach osobowych: litery członów i do tego cała łacina rozszerzona (Latin-1,
// Extended-A/B, Extended Additional). Litera spoza klas członów nie może zakończyć dopasowania
// w środku wyrazu: maska ucinała wtedy nazwisko i zostawiała jawny ogon. Bez „×" i „÷", które w tym
// zakresie leżą, a literami nie są. Celowo BEZ znaków łączących (U+0300–U+036F): tekst w rozkładzie
// NFD (litera i osobny znak akcentu) dawał dotąd maskę z ogonem, a granica na nich oddawałaby całe
// nazwisko jawne. To osobna klasa (normalizacja wejścia).
const NM_BOUND = `${NM_UP}${NM_LO}\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u1E00-\\u1EFF`;

// Dosłowna ucieczka „\n/\r/\t" po podmianie w passProtectJsonEscapes (backslash + znak PUA). Dla
// strażników kontekstu („poprzedni wyraz") liczy się jak biały znak — inaczej „Uniwersytet
// Adama\nMickiewicza" w JSON-ie gubił kontekst złożenia, który ten sam tekst z prawdziwą nową
// linią ma, i nazwa uczelni stawała się osobą.
const ESC_WS = '\\\\[\\uE009\\uE00A\\uE00D]';

// Hoisted (nie budować w callbacku .replace — inaczej kompilacja regexu per-match).
// Sprawdza, czy tuż przed dopasowaniem stoi WYRAZ z wielkiej litery + spacja (2. człon złożenia).
const PRECEDED_BY_CAP = new RegExp(`[${PL_UP}][${PL_LO}]+(?:\\s|${ESC_WS})+$`);

// Regexy reguł IMIĘ skompilowane RAZ na moduł (nie przy każdym wywołaniu redactPII).
// Kotwica PL-aware zamiast ASCII \b (działa przed Ł/Ś/Ż/Ą). Bezstanowe użycie przez .replace
// (String.replace zeruje lastIndex), więc współdzielenie RE_PAIR między krokami (a2)/(a3) jest bezpieczne.
const CAP_WORD = `[${NM_UP}][${NM_LO}]+(?:-[${NM_UP}][${NM_LO}]+)?`;
/** Litera spoza polskiego alfabetu w wyrazie z CAP_WORD (same litery i łącznik). */
const RE_NON_PL_LETTER = new RegExp(`[^${PL_UP}${PL_LO}-]`);
/** Marka z obcą literą po nazwisku („Pan Nowak Škoda", „Pani Mróz Citroënem") — rdzeń, dowolny przypadek. */
const RE_FOREIGN_BRAND_WORD = /^(?:škod|citroën|löwenbräu|nestlé|hermès|moët|häagen)/iu;
/** Polska końcówka przypadka zależnego na obcym wyrazie („Škodę", „Müllerowi", „Citroënem"). */
const RE_PL_OBLIQUE_ENDING = /(?:owi|ę|ą|em|iem|ów|ach|ami|om)$/u;
// Separatory między członami nazwy to [ \t]+ (BEZ \n) — nazwisko na końcu wiersza NIE może
// skleić się z pierwszym wyrazem następnej linii (psuło układ i wciągało etykiety formularzy).
// Prawa granica `(?![PL_UP PL_LO])` na KOŃCU każdego wzorca: bez niej token mieszany
// („KowaIski" z OCR-owym I zamiast l, „McDonald") był dopasowywany DO POŁOWY — wprost
// („Jan Kowa|Iski") albo po backtrackingu („Jan Kow|aIski") — i maska ucinała słowo
// („[OSOBA-A]Iski" — wyciek fragmentu nazwiska; maskuj całość, nie fragment).
// Środek „ i "/„ oraz " przechwycony (grupa 2), bo wraca do wyniku w oryginalnym zapisie.
const RE_SPOUSES = new RegExp(`(?<![${NM_BOUND}-])(${CAP_WORD})([ \\t]+(?:i|oraz)[ \\t]+)(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
const RE_NAME_SEQ = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?:[ \\t]+${CAP_WORD}){1,3}(?![${NM_BOUND}])`, 'g');
// Wyraz z wielkiej litery tuż za porcją RE_NAME_SEQ w tej samej linii (wznowienie okna w kroku (a)).
const RE_NEXT_CAP_WORD = new RegExp(`^[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`);
const RE_PAIR = new RegExp(`(?<![${NM_BOUND}-])(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
// Następny wyraz z wielkiej litery tuż za dopasowaniem (prawy kontekst pary w kroku a2). Tylko
// przez spacje — tabulator zaczyna następną komórkę.
const RE_NEXT_CAP_WORD_SP = new RegExp(`^ +(${CAP_WORD})`);
// Słownikowy rdzeń z ogonem obcych liter („Kovalčuk", „Bondarčuk", „Petrovyč" — transliteracja
// ISO 9 w tłumaczeniach przysięgłych) to jeden wyraz: rozstrzyga o nim rdzeń, a maska obejmuje
// całość. Dawniej maska kończyła się przed „č" („[..]čuk"), a sama granica obcych liter oddawała
// całe nazwisko jawne. Ogon tylko od spółgłoski z haczykiem (č, š, ž, ř, ň, ť, ď, ľ): samogłoska
// z akcentem po polskim rdzeniu to zwykle obcy wyraz („Universidad Politécnica" — rdzeń „Polit"
// jest w słowniku nazwisk), więc taki wyraz zostaje bez maski.
const RE_SOLO_DICT = new RegExp(`(?<![${NM_BOUND}-])[${PL_UP}][${PL_LO}]+(?:[${NM_LO_EXTRA}][${NM_LO}]*)?(?![${NM_BOUND}-])`, 'g');
const RE_FOREIGN_TAIL_START = new RegExp(`[${NM_LO_EXTRA}]`);
const RE_SLAVIC_TAIL_START = /^[čšžřňťďľ]/;
const RE_SOLO_MORPH = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?![${NM_BOUND}])`, 'g');
// Ciąg wyrazów MAŁYMI literami — niechlujny zapis (czaty, e-maile, formularze bez wielkich liter).
// Sam wzorzec jest szeroki (łapie całe zdania); PRECYZJĘ daje walidacja w callbacku (a4), która
// szuka W CIĄGU sąsiedztwa „imię (słownik) + nazwisko (morfologia/słownik)" i maskuje TYLKO tę parę.
// Skan całego ciągu (zamiast sztywnej pary) rozwiązuje konsumpcję sąsiadów: „od jan kowalski",
// „z marek górski" — wiodący przyimek nie zjada imienia. Lewa granica odcina fragmenty
// e-maili/URL-i/domen (poprzedzający znak nie może być literą, myślnikiem, „@", kropką ani „/").
const LO_WORD = `[${PL_LO}]+(?:-[${PL_LO}]+)?`;
const RE_LOWER_RUN = new RegExp(
  `(?<![${PL_UP}${PL_LO}@./-])${LO_WORD}(?:[ \\t]+${LO_WORD}){1,6}(?![${PL_UP}${PL_LO}-])`,
  'g',
);
const RE_SURNAME_OBLIQUE =
  /(?:sk|ck|dzk)(?:iego|iej|iemu|im|imi|ich|ą)$|icz(?:a|owi|em|owie|ami|ach)$|czyk(?:a|owi|iem|ami|ach|owie)$/;

// Wyraz z wielkiej litery z myślnikami wielokrotnymi (miejscowości: „Kędzierzyn-Koźle") — '*' (nie '?').
const CAP_CITY = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)*`;
// Lewa granica wzorców ZACZYNAJĄCYCH się od CAP_CITY (bez innej kotwicy przed nim): start w środku
// wyrazu albo łańcucha „Abc-Abc-…" odpada. Bez niej każdy człon łańcucha skanował go do końca
// (czas kwadratowy, ~5 s na 100 tys. znaków). Sam myślnik przed nazwą (wypunktowanie „-Gliwice")
// granicy nie blokuje — tylko myślnik doklejony do poprzedniego wyrazu.
const CITY_START = `(?<![${PL_UP}${PL_LO}]|[${PL_UP}${PL_LO}]-)`;
/** Escapuje metaznaki regexu w literale (do budowy wzorca z placeholdera maski). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Wyrazy (małą literą) po których słowo z sufiksem -ski/-cki/-icz to NIE osoba, lecz eponim
 * medyczny („choroba Leśniowskiego"), nazwa ulicy/miejsca („ulica Puławska") lub termin.
 * Wstrzymują samodzielny detektor morfologiczny/słownikowy nazwiska (kroki 13c/13c2).
 */
export const NON_PERSON_CONTEXT = new Set<string>(
  (
    'choroba chorobę choroby chorobą chorobie objaw objawu objawy objawie zespół zespołu zespole ' +
    'syndrom syndromu próba próbę próby odczyn odczynu test testu testem skala skali skalę metoda ' +
    'metodę metody metodą prawo prawa twierdzenie zasada zasadę reguła reakcja klasyfikacja punkt ' +
    'ulica ulicy ulicę ulicą ulic aleja alei aleję aleją plac placu placem placa rondo ronda most ' +
    'mostu mostem osiedle osiedla osiedlu dzielnica dzielnicy dzielnicę park parku skwer bulwar ' +
    // eponimy medyczne („odruch Babińskiego", „prątek Kocha", „uprząż Pawlika", „linii Langera")
    // i miejscownik „na moście Łazienkowskim" (oboczność st→ści — rdzeń „most" go nie obejmuje)
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią linie linii liniami objawem trójkąt trójkąta moście ' +
    // jednostki administracyjne — „powiat pruszkowski", „gmina …ska" to przymiotnik odmiejscowy,
    // nie nazwisko (pola administracyjne są celowo jawne — patrz komentarz przy FORM_FIELDS)
    'powiat powiatu powiecie powiatem gmina gminy gminie gminą województwo województwa województwie'
  ).split(/\s+/),
);
/**
 * Etykieta pola ADMINISTRACYJNEGO tuż przed wartością („Powiat: Pruszkowski", „Województwo:\n
 * Mazowieckie" — też wartość w następnej linii). Przymiotnik odmiejscowy po niej to nazwa
 * jednostki, NIE nazwisko — bez tego strażnika „Powiat: Pruszkowski" stawał się [OSOBA-X]
 * (prevLowerWord nie widzi etykiety przez dwukropek/nową linię).
 */
const precededByAdminLabel = (t: string, offset: number): boolean =>
  /(?:powiat\w*|gmin[aęyą]|województw[oaeu]m?|dzielnic[aęy])[ \t]*:?[ \t]*(?:\n|\\[\uE009\uE00A\uE00D])?[ \t]*$/i.test(
    t.slice(Math.max(0, offset - 24), offset),
  );
/**
 * Głowy EPONIMÓW medycznych („Odruch Babińskiego", „Prątek Kocha", „Objaw Brudzińskiego"). Tylko
 * one wyłączają nazwisko po wyrazie pisanym WIELKĄ literą (początek zdania). Cały NON_PERSON_CONTEXT
 * w tym miejscu odsłaniał osoby: „Kierownik Zespołu Kowalski", „Reakcja Kowalskiego na wezwanie",
 * „Prawo Wiśniewskiego do udziału", „Zespół Nowaka przygotował ofertę" — zespół, prawo, test, metoda,
 * skala czy reakcja to zwykłe rzeczowniki, po których stoi osoba z dokumentu.
 */
const EPONYM_HEADS = new Set<string>(
  (
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią objaw objawu objawy objawie objawem odczyn odczynu syndrom syndromu trójkąt trójkąta ' +
    // „Linie Langera zachowane." — tylko z dopełniaczem, więc „Kierownik Linii Nowak" dalej osobą
    'linie linii liniami'
  ).split(/\s+/),
);
/**
 * Wyrazy dopisane do NON_PERSON_CONTEXT dla eponimów, po których nazwisko stoi zawsze w DOPEŁNIACZU
 * („linii Langera", „prątki Kocha"). Wyłączają tylko znany eponim (EPONYM_SURNAME_FORMS): mianownik
 * („Kierownik linii Nowak", „konflikt na linii Kowalski – Nowak") i dopełniacz osoby z pisma
 * („mistrza linii Kowalskiego", „uprząż Nowaka była zużyta") to osoba.
 */
const GEN_ONLY_CONTEXT = new Set<string>(
  (
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią linie linii liniami objawem trójkąt trójkąta'
  ).split(/\s+/),
);
/**
 * Nazwiska EPONIMÓW w formie, w której stoją po głowie („odruch Babińskiego", „prątek Kocha",
 * „linii Langera", „uprząż Pawlika"). Zbiór zamknięty: po głowach z EPONYM_HEADS i GEN_ONLY_CONTEXT
 * w dokumentacji stoi też pacjent albo pracownik w dopełniaczu („Objawy Kowalskiej ustąpiły",
 * „odruch Kowalskiego uratował dziecko", „mistrza linii Kowalskiego", „uprząż Nowaka była zużyta"),
 * a eponimy to znane nazwiska. Rzadki eponim spoza listy wraca do maski, jak przed partią b3.
 */
const EPONYM_SURNAME_FORMS = new Set<string>(
  (
    'babińskiego brudzińskiego biernackiego chełmońskiego leśniowskiego pawlika chwostka goldflama ' +
    'kocha langera fuchsa beckera kerniga romberga blumberga rovsinga jendrassika hoffmanna ' +
    'oppenheima gordona mikulicza korsakowa filatowa bechterewa rydygiera hirszfelda kochera mendla ' +
    'mayera kehra homansa courvoisiera lasègue’a lasègue\'a duchenne duchenne’a duchenne\'a trousseau ' +
    'rossolimo moro zahna kerleya retziusa curzona maginota calota petita hesselbacha scarpy ' +
    'mantoux wassermana coombsa löfflera pfeiffera friedländera blaschko beau mees'
  ).split(/\s+/),
);
// Głowy, po których stoi tylko kilka eponimów: „linie Langera/Blaschko/Beau", „prątki Kocha",
// „uprząż Pawlika". Dowolne nazwisko z listy po nich to osoba: „kierownika linii Pawlika",
// „operatora linii Babińskiego", „Objawy Pawlika ustąpiły" (Pawlik, Koch, Fuchs to też częste nazwiska).
const EPONYM_PAIRED_HEADS: [RegExp, Set<string>][] = [
  [/^lini/, new Set('langera blaschko beau mees meesa kerleya'.split(' '))],
  [/^prąt/, new Set(['kocha'])],
  [/^pałecz/, new Set('kocha pfeiffera friedländera löfflera'.split(' '))],
  [/^uprz[ęą]/, new Set(['pawlika'])],
  [/^dystrofi/, new Set('duchenne duchenne’a duchenne\'a beckera fuchsa'.split(' '))],
  [/^trójkąt/, new Set('hesselbacha scarpy calota petita kocha pawlika'.split(' '))],
];
const EPONYM_PAIRED_ONLY = new Set<string>(['pawlika', 'langera', 'blaschko', 'beau', 'mees', 'meesa', 'kerleya']);
/** Czy nazwisko-eponim pasuje do głowy przed nim (patrz EPONYM_PAIRED_HEADS)? */
function eponymFits(head: string, word: string): boolean {
  const w = word.toLowerCase();
  if (!EPONYM_SURNAME_FORMS.has(w)) return false;
  for (const [re, set] of EPONYM_PAIRED_HEADS) if (re.test(head)) return set.has(w);
  return !EPONYM_PAIRED_ONLY.has(w);
}
/**
 * Czy nazwisko stoi w formie ZALEŻNEJ (dopełniacz, miejscownik…), a nie w mianowniku? Eponim
 * i patron są zawsze w dopełniaczu („Babińskiego", „Kocha", „Langera"), osoba w zdaniu bywa
 * w mianowniku („Nowak", „Kowalski", „Kowalska", „Wąsowicz"). Formę zależną nazwiska spoza -ski
 * rozpoznajemy po słowniku (forma różna od bazowej).
 */
function isObliqueSurnameForm(word: string): boolean {
  const w = word.toLowerCase();
  if (RE_SURNAME_OBLIQUE.test(w)) return true;
  if (/(?:sk|ck|dzk)[ia]$|(?:scy|ccy|dzcy|icz|czyk)$/.test(w)) return false;
  const base = surnameBase(w);
  return !!base && base !== w;
}
/**
 * Wyraz tuż przed pozycją — do sprawdzenia kontekstu nie-osobowego. `cap`: wyraz od wielkiej litery
 * w tej samej linii, oddzielony samymi spacjami (rzeczownik na początku zdania: „Objaw Babińskiego").
 * Tabulator to granica komórki TSV („IT\tTest\tNowak") — sąsiednia kolumna nie jest kontekstem.
 * Poza tym, jak dotąd, ostatni ciąg małych liter (także przez nową linię: nagłówek „Zespół\nKowalski"
 * nie wyłącza osoby z następnego wiersza, bo „espół" nie jest na liście). Skan wstecz po znakach
 * w oknie 40 znaków: regex z „$" próbowany od każdej pozycji okna kosztował przy każdym kandydacie.
 */
const RE_CHAR_LL = /\p{Ll}/u;
const RE_CHAR_LU = /\p{Lu}/u;
const RE_CHAR_L = /\p{L}/u;
const prevContextWord = (text: string, offset: number): { word: string; cap: boolean } | undefined => {
  const lo = Math.max(0, offset - 40);
  let j = offset;
  while (j > lo && text[j - 1] === ' ') j--;
  if (j < offset) {
    let k = j;
    while (k > lo && RE_CHAR_LL.test(text[k - 1])) k--;
    if (k < j && k > lo && RE_CHAR_LU.test(text[k - 1]) && (k - 1 === lo || !RE_CHAR_L.test(text[k - 2])))
      return { word: text.slice(k - 1, j).toLowerCase(), cap: true };
  }
  // ostatni ciąg małych liter, za nim same odstępy (też podmienione ucieczki JSON „\n/\r/\t")
  j = offset;
  for (;;) {
    if (j > lo && /\s/.test(text[j - 1])) j--;
    else if (j - 1 > lo && text[j - 2] === '\\' && /[\uE009\uE00A\uE00D]/.test(text[j - 1])) j -= 2;
    else break;
  }
  let k = j;
  while (k > lo && RE_CHAR_LL.test(text[k - 1])) k--;
  return k < j ? { word: text.slice(k, j).toLowerCase(), cap: false } : undefined;
};
/**
 * Czy `word` na pozycji `offset` stoi po rzeczowniku kontekstu nie-osobowego (eponim, ulica,
 * jednostka)? Po „moście" tylko forma uzgodniona z miejscownikiem („na moście Łazienkowskim") albo
 * dopełniacz patrona („na moście Poniatowskiego") — mianownik „Na moście Kowalski potrącił
 * pieszego" to osoba, a nie nazwa mostu. Po wyrazie z wielkiej litery tylko głowa eponimu i tylko
 * ze znanym eponimem („Objaw Nowak zgłosiła się", „Objawy Nowaka nasiliły się" to osoba).
 */
const afterNonPersonContext = (text: string, offset: number, word: string, masked?: Set<string>): boolean => {
  const prev = prevContextWord(text, offset);
  if (!prev) return false;
  // nazwisko osoby rozpoznanej już w piśmie wygrywa z patronem mostu w dopełniaczu („Jan Gzowski
  // uciekał … Na moście Gzowskiego zatrzymał patrol"); forma uzgodniona („na moście Łazienkowskim")
  // to zawsze nazwa. Eponimów to nie dotyczy: „Pacjent Babiński … odruch Babińskiego" to objaw.
  if (prev.word === 'moście' && /ego$/i.test(word) && masked?.has(normalizeSurnameKey(word))) return false;
  if (prev.word === 'moście') return /(?:im|ym|ego)$/i.test(word);
  if (prev.cap) return EPONYM_HEADS.has(prev.word) && eponymFits(prev.word, word);
  if (!NON_PERSON_CONTEXT.has(prev.word)) return false;
  return !GEN_ONLY_CONTEXT.has(prev.word) || eponymFits(prev.word, word);
};
// Ciąg do trzech wyrazów od wielkiej litery tuż za pozycją (też WERSALIKI) — kandydat na patrona.
const RE_NAME_RUN_AHEAD = /^\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*){0,2}/u;
/**
 * Czy za pozycją stoi OSOBA w mianowniku, a nie patron w dopełniaczu? Patron po tytule albo „św."
 * jest zawsze w dopełniaczu („dra Alfreda Sokołowskiego", „św. Piotra"); „lek. Jan Kowalski",
 * „św. Kowalski", „DR JAN KOWALSKI" to osoba. Imię w mianowniku ze słownika rozstrzyga. Imię
 * w dopełniaczu („Anny", „Marka") przesądza o patronie, także przy nieodmiennym nazwisku („im. dr Anny
 * Nowak"). Imię dwuznaczne, żeńskie w mianowniku i zarazem męskie w dopełniaczu („Aleksandra",
 * „Franciszka", „Stanisława"), rozstrzyga nazwisko za nim: „lek. Aleksandra Nowak" to osoba, „im. dra
 * Aleksandra Kowalskiego" patron. Z `withSurname` także nazwisko w mianowniku (końcówka -ski/-ska,
 * -icz, słownik, homograf).
 */
function nominativePersonAhead(t: string, offset: number, withSurname: boolean): boolean {
  const run = RE_NAME_RUN_AHEAD.exec(t.slice(offset, offset + 80))?.[0];
  if (!run) return false;
  const ws = run.toLowerCase().split(/[ \t]+/);
  const f = ws[0];
  const gen = isFirstNameGenitive(f);
  if (POLISH_FIRST_NAMES.has(f) && !gen) return true;
  // biernik imienia żeńskiego („przesłuchano św. Annę Gzowską") — patron nigdy nie stoi w bierniku
  if (f.endsWith('ę') && POLISH_FIRST_NAMES.has(`${f.slice(0, -1)}a`)) return true;
  if (gen && !POLISH_FIRST_NAMES.has(f)) return false;
  if (!withSurname && !gen) return false;
  return (gen ? ws.slice(1) : ws).some(
    (w) =>
      !isFirstNameGenitive(w) &&
      (/(?:sk|ck|dzk)[iaą]$|(?:icz|czyk)$/.test(w) || surnameBase(w) === w || HOMOGRAPH_SURNAMES.has(w)),
  );
}
/** Dopełniacz imienia: męskiego („Jacka", „Pawła") albo żeńskiego („Anny", „Marii", „Haliny"). */
function isFirstNameGenitive(w: string): boolean {
  return isMaleFirstNameGenitive(w) || (/[iy]$/.test(w) && POLISH_FIRST_NAMES.has(`${w.slice(0, -1)}a`));
}
/** Dopełniacz męskiego imienia („Jacka", „Marka", „Pawła", „Jana") — patron, choć „Jacka" ma
 *  końcówkę żeńskiego nazwiska na -cka. Ruchome „e" jak w słowniku nazwisk (Jacek → Jacka). */
function isMaleFirstNameGenitive(w: string): boolean {
  if (!w.endsWith('a')) return false;
  const stem = w.slice(0, -1);
  return POLISH_FIRST_NAMES.has(stem) || POLISH_FIRST_NAMES.has(stem.replace(/([^aeiouyąęó])([^aeiouyąęó])$/, '$1e$2'));
}
/** Czy tuż przed pozycją stoi „im." (patron instytucji: „Szkoła im. A. Mickiewicza") albo
 *  skrót ulicy („ul. Rakowieckiej", „al. Sikorskiego" — patron ULICY, nie osoba), ewentualnie
 *  z inicjałem imienia? prevLowerWord tego nie widzi (kropka po skrócie). Także „bł." i „św." —
 *  błogosławiony i święty („parafia bł. Jerzego Popiełuszki", „Kościół św. Piotra Apostoła") to
 *  patron, nie osoba z dokumentu. Granica Unicode zamiast \b: ASCII \b nie widzi jej przed „ś".
 *  Spacja po kropce opcjonalna tylko po „ul." i „im." („ul.Jana Kilińskiego", „im.Marii Curie") —
 *  jak w passAddress. Sklejone „os."/„pl." to zwykle skrót „osób" i koniec domeny („Obecnych
 *  12 os.Halina Grzyb przewodniczyła", „gmina.pl.Halina Grzyb"), a strażnik oddawał wtedy jawną
 *  całą osobę. „os." po liczbie to „osób" także ze spacją („Obecnych 12 os. Halina Grzyb"). */
const RE_PATRON_ABBR = /(?<![\p{L}\d_])(?:(?:im|ul)\.[ \t]*|(?<!\d[ \t]?)os\.[ \t]+|(?:al|pl|bł)\.[ \t]+)(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
// „św." to w protokołach sądowych także skrót od „świadek" („św. Kowalski zeznał", „Sąd
// przesłuchał św. Annę Gzowską") — bez kontekstu świadek wyciekał jako „patron". Dlatego święty
// tylko po rzeczowniku sakralnym albo „pw."/„im." (najwyżej dwa wyrazy przerwy: „Kościół
// parafialny pw. św. …"), w tej samej linii. Bez kontekstu „św. Antoniego" zostaje w masce —
// drobne nadmaskowanie zamiast wycieku świadka.
// Zapis bez ogonków („kosciol pw. sw. Michala", „parafia sw. Jozefa") — imię świętego bez
// ogonków przechodzi dziś słownik imion, więc kontekst sakralny musi go rozpoznać tak samo.
const SAINT_CONTEXT_WORD =
  /^(?:ko[sś]ci[oóe]\p{L}*|parafi\p{L}*|bazylik\p{L}*|katedr\p{L}*|kaplic\p{L}*|sanktuari\p{L}*|klasztor\p{L}*|kolegiat\p{L}*|cerk\p{L}*|sob[oó]r\p{L}*|zgromadzeni\p{L}*|zakon\p{L}*|sióstr|pw\.|im\.)$/iu;
const RE_SAINT_ABBR = /(?<!\p{L})[sś]w\.[ \t]+(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
const RE_SAINT_PROCEDURAL_WORD =
  /^(?:przesłuch\p{L}*|wezwan[oaey]\p{L}*|wezwał\p{L}*|zezna\p{L}*|podpis\p{L}*|oświadczeni\p{L}*|protok[oó]ł\p{L}*|relacj\p{L}*|według|wg|ze|z)$/iu;
// „św." i imię w dopełniaczu tuż przed nazwiskiem („Parafia pw. św. Rafała Kalinowskiego") — patron
// w całości, także dla przebiegów samego nazwiska (dawniej „św. Rafała [IMIĘ I NAZWISKO]").
const RE_SAINT_GIVEN_BEFORE = /(?<!\p{L})[sś]w\.[ \t]+(\p{Lu}\p{Ll}+)[ \t]+$/u;
const RE_BLESSED_GIVEN_BEFORE = /(?<!\p{L})bł\.[ \t]+(\p{Lu}\p{Ll}+)[ \t]+$/u;
const RE_SAINT_EPITHET_AHEAD =
  /^\p{Lu}\p{Ll}+[ \t]+(?:Ewangelist\p{L}*|Archanio\p{L}*|Archanioł\p{L}*|Apostoł\p{L}*|Apostol\p{L}*|Męczennik\p{L}*|Meczennik\p{L}*|Chrzciciel\p{L}*|Wyznawc\p{L}*|Pustelnik\p{L}*)(?!\p{L})/u;
// Czynność świadka za parą („Sw. Jan Apostol zeznal", „Sw. Adam Pustelnik zeznał") — „Sw." to wtedy
// skrót świadka, a „Apostoł", „Pustelnik", „Wyznawca" bywają nazwiskami.
const RE_WITNESS_VERB_AHEAD =
  // „poda…" bez imiesłowu biernego („Figura św. Pawła Apostoła podana do renowacji" — proza
  // sakralna, nie czynność świadka)
  /^[ \t,]*(?:nie[ \t]+)?(?:zezna\p{L}*|poda(?!n[aeyi])\p{L}*|wyjaśni\p{L}*|wyjasni\p{L}*|stwierdzi\p{L}*|oświadczy\p{L}*|oswiadczy\p{L}*|potwierdzi\p{L}*|widzia\p{L}*|słysza\p{L}*|slysza\p{L}*|stawi\p{L}*|odmówi\p{L}*|odmowi\p{L}*|rozpozna\p{L}*|wskaza\p{L}*)(?!\p{L})/iu;
// Przydomek świętego w rodzaju męskim po imieniu żeńskim („Sw. Maria Meczennik") — to nie święty.
const RE_SAINT_EPITHET_MASC = /^(?:Apostoł|Apostol|Męczennik|Meczennik|Pustelnik|Archanioł|Archaniol|Chrzciciel)$/u;
function saintEpithetAhead(t: string, offset: number): boolean {
  const m = RE_SAINT_EPITHET_AHEAD.exec(t.slice(offset, offset + 40));
  if (!m) return false;
  if (RE_WITNESS_VERB_AHEAD.test(t.slice(offset + m[0].length, offset + m[0].length + 30))) return false;
  const [given, epithet] = m[0].split(/[ \t]+/);
  return !(/a$/.test(given) && !/^(?:Kuba|Barnaba|Bonawentura|Kosma|Jarema)$/.test(given) && RE_SAINT_EPITHET_MASC.test(epithet));
}
const RE_SAINT_INITIAL =/(?<!\p{L})[sś]w\.[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*$/iu;
/** Czy „św." tuż przed pozycją ma kontekst sakralny (najwyżej trzy wyrazy wstecz, ta sama linia)?
 *  Skan po wyrazach, nie regex z oknem: ten drugi próbował dopasowania od każdej pozycji okna. */
function saintWithContext(t: string, offset: number, near: string): boolean {
  const m = RE_SAINT_ABBR.exec(near);
  if (!m) return false;
  const at = offset - near.length + m.index;
  const line = t.slice(Math.max(0, at - 60), at);
  const words = line.slice(line.lastIndexOf('\n') + 1).split(/[ \t]+/);
  for (let i = words.length - 1, seen = 0; i >= 0 && seen < 3; i--) {
    const w = words[i];
    if (!w) continue;
    seen++;
    // czynność procesowa między kościołem a „św." („W kaplicy przesłuchano św. Jana Kowalskiego",
    // „W kościele zeznania św. Nowaka", „Parafia wezwała św. Wiśniewskiego") — to skrót „świadek"
    if (RE_SAINT_PROCEDURAL_WORD.test(w)) return false;
    // koniec zdania przerywa skan („Zdarzenie w kaplicy szpitalnej. Przesłuchano św. …")
    if (/[\p{L}]\.$/u.test(w) && !/^(?:pw|im)\.$/i.test(w)) return false;
    if (SAINT_CONTEXT_WORD.test(w)) return true;
    // „pod wezwaniem św. …" — samo „wezwanie" to w protokole wezwanie sądu („Mimo wezwania św. Gzik
    // nie stawił się", „Na wezwanie św. Kowalski stawił się"), a nie tytuł kościoła
    if (/^wezwaniem$/iu.test(w) && /^pod$/i.test(words[i - 1] ?? '')) return true;
    // przecinek, cyfra czy nawias przerywa ciąg nazwy — kontekst dalej w zdaniu już nie liczy się
    if (!/^[\p{L}.]+$/u.test(w)) return false;
  }
  return false;
}
const precededByPatron = (t: string, offset: number): boolean => {
  const near = t.slice(Math.max(0, offset - 12), offset);
  // patron po „św." stoi w dopełniaczu („kościół św. Piotra"); mianownik to świadek, także obok
  // rzeczownika sakralnego („Pożar kościoła widział św. Kowalski", „W kościele św. Nowak widział …").
  // Inicjał po „św." („przesłuchano św. J. Kowalskiego") też wskazuje świadka: świętego cytuje się
  // z pełnym imieniem.
  // Święty to imię (w dopełniaczu albo znana postać po imieniu); samo nazwisko po „św." („wraz ze
  // św. Kowalskim", „podpis św. Kowalskiego") to świadek, także obok kaplicy czy kościoła.
  if (RE_PATRON_ABBR.test(near)) return true;
  // „Sw. Lukasz Ewangelista", „św. Michał Archanioł" — imię z przydomkiem świętego za nim; świadek
  // („Sw. Kowalski zeznal") przydomka nie ma. Też w zapisie bez ogonków.
  if (/(?<!\p{L})[SsŚś]w\.[ \t]*$/u.test(near) && saintEpithetAhead(t, offset)) return true;
  // „bł." z imieniem w dopełniaczu tuż przed nazwiskiem („Kościół bł. Jana Nowaka", „Parafia pw.
  // bł. Józefa Kowalskiego") — patron w całości, jak przy „św.". Para była chroniona, ale nazwisko
  // ze słownika maskował potem przebieg samego nazwiska i zostawało „bł. Józefa [..]". „bł." nie
  // jest skrótem świadka, więc kontekst sakralny nie jest potrzebny; osoba w mianowniku za nim tak.
  const bl = RE_BLESSED_GIVEN_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset));
  if (bl) {
    const bw = bl[1].toLowerCase();
    if ((isFirstNameGenitive(bw) || egoNameGenitive(bw)) && !nominativePersonAhead(t, offset, true)) {
      const w = (/^\p{L}+/u.exec(t.slice(offset, offset + 30))?.[0] ?? '').toLowerCase();
      if (/(?:[aeiouyąę]|ej)$/.test(w) && !/(?:sk|ck|dzk)i$/.test(w)) return true;
    }
  }
  if (saintWithContext(t, offset, near)) {
    return !RE_SAINT_INITIAL.test(near) && !nominativePersonAhead(t, offset, true) && saintNameAt(t, offset);
  }
  const g = RE_SAINT_GIVEN_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset));
  const gl = g?.[1].toLowerCase() ?? '';
  if (!g || !(isFirstNameGenitive(gl) || egoNameGenitive(gl))) return false;
  // osoba w mianowniku za patronem („W kaplicy św. Rocha Teresa Wróbel prowadzi …")
  if (nominativePersonAhead(t, offset, true)) return false;
  // drugi człon patrona też w dopełniaczu („Kalinowskiego", „Boboli", „Kolbego"); mianownik za
  // patronem to osoba („W kaplicy św. Rocha Bednarz poświęcił bramę")
  const w = (/^\p{L}+/u.exec(t.slice(offset, offset + 30))?.[0] ?? '').toLowerCase();
  if (!/[aeiouyąę]$/.test(w) || /(?:sk|ck|dzk)i$/.test(w)) return false;
  const at = offset - g[0].length + g[0].indexOf(g[1]);
  return saintWithContext(t, at, t.slice(Math.max(0, at - 12), at));
};
function saintNameAt(t: string, offset: number): boolean {
  const w = /^\p{L}+/u.exec(t.slice(offset, offset + 30))?.[0] ?? '';
  const wl = w.toLowerCase();
  return isFirstNameLike(w) || isFirstNameGenitive(wl) || egoNameGenitive(wl) || FOREIGN_GIVEN_NAMES.has(wl);
}
/** Dopełniacz imienia na -i/-y („Antoniego", „Jerzego", „Ksawerego"). */
const egoNameGenitive = (wl: string): boolean =>
  /ego$/.test(wl) && (POLISH_FIRST_NAMES.has(wl.slice(0, -3)) || POLISH_FIRST_NAMES.has(`${wl.slice(0, -3)}y`));
/**
 * Czy para „imię nazwisko" na pozycji `offset` to PATRON ULICY/placu/ronda (eponim), a nie osoba?
 * „ulica Tadeusza Kościuszki", „rondo Jana Pawła II", a także WYLICZENIE „u zbiegu ulic … oraz …"
 * (drugi patron poprzedzony spójnikiem — skan wstecz przez nazwy własne i spójniki aż do wyrazu
 * ulicznego). Świadomie TYLKO konteksty ULICZNE/dedykacyjne — kontekstu medycznego („choroba Jana
 * Kowalskiego") NIE obejmuje, bo tam para z imieniem bywa realną osobą (recall). Uzupełnia
 * `precededByPatron` (skróty ul./al./im.) o pełne wyrazy i wyliczenia; strażnik detektora PAR
 * (kroki 13a/a2), których solo-detektory już pilnują przez NON_PERSON_CONTEXT.
 */
// Kotwica wyrazu ulicznego (rdzeń + ZAMKNIĘTA lista końcówek fleksyjnych; pierwsza litera też
// WERSALIK). Otwarte „\p{L}*" łapało wyrazy pochodne i nazwiska: „placówki", „osiedlowej",
// „parkingu", „Mostowski", „Rogalski" — osoba po nich („Kierownik placówki lek. Jan Kowalski")
// szła jako patron. Granice Unicode (?<![\p{L}]) / (?![\p{L}]) zamiast \b — JS \b jest ASCII-only
// nawet z /u, więc „aleją/ulicą" (końcówka diakrytyczna) traciły granicę i strażnik był martwy.
const STREET_ANCHOR_SRC =
  `(?:[Uu]lic(?:a|y|ę|ą|e|om|ami|ach|zk[aięą]|zce)?|[Aa]lej(?:a|ę|ą|e|om|ami|ach)?|[Aa]lei|` +
  `[Pp]lac(?:u|em|e|y|ów|om|ami|ach)?|[Rr]ond(?:o|a|u|em|zie|om|ami|ach)?|[Mm]ost(?:u|em|y|ów|om|ami|ach)?|` +
  `[Oo]siedl(?:e|a|u|em|i|om|ami|ach)?|[Ss]kwer(?:u|em|ze|y|ów|om|ami|ach)?|` +
  `[Bb]ulwar(?:u|em|ze|y|ów|om|ami|ach)?|[Pp]ark(?:u|iem|i|ów|om|ami|ach)?|[Zz]bieg(?:u|iem)?|` +
  `[Rr]og(?:u|iem)?|[Rr]óg|[Ii]mienia|` +
  // „im" tylko jako skrót z kropką: zaimek („Pomógł im Jan Kowalski", „Przedstawiono im dra Jana
  // Kowalskiego") był kotwicą patrona i osoba po nim wyciekała
  `[Ii]m(?=\\.)|[Uu]l|[Aa]l|[Pp]l|[Oo]s)`;
// Rangi i tytuły w nazwie patrona: „ul. gen. Andersa", „al. ks. Popiełuszki", „im. dra Alfreda
// Sokołowskiego", „im. dr. med. Rafała Masztaka", „im. prof. dr. hab. …", „dr n. med." („n." = nauk).
// Pierwsza litera rangi także wielka („ul. Ks. Jerzego Popiełuszki", „Rondo Gen. Józefa Bema",
// „im. Ks. Jana Twardowskiego"): tak piszą nazwy ulic i szkół urzędy, a strażnik patrona znał
// tylko zapis małą literą i patron szedł do maski jako osoba.
const STREET_RANK = `(?:${'gen pułk płk ppłk mjr kpt por ks św bł bp abp kard marsz prof doc dra dr hab med lek n inż hr'
  .split(' ')
  .map((r) => `[${r[0].toUpperCase()}${r[0]}]${r.slice(1)}`)
  .join('|')})\\.?`;
// ZACHOWAWCZO: strażnik uznaje patrona TYLKO bezpośrednio po kotwicy, w JEDNEJ LINII, przez ciąg
// nazw własnych i RANG/skrótów tytułów („ul. gen. Andersa", „al. ks. Popiełuszki"). ŚWIADOMIE BEZ
// mostkowania spójników „oraz/i", przecinka, nowej linii i kropki w tokenie nazwy — każdy z nich
// pozwalał wchłonąć REALNĄ osobę z następnej klauzuli/wiersza/zdania („ulicy X oraz Jan Kowalski",
// „ulic X, Osoba", „skwer X\nOsoba", „X. Osoba") = udokumentowana regresja (wyciek osoby). Cena:
// DRUGI patron w wyliczeniu „ulic X oraz Y" bywa nadmaskowany (zamaskowana nazwa ulicy, NIE wyciek
// PII — dopuszczalne wg zasady „precyzja"). PIERWSZY patron (tuż po kotwicy) jest zawsze chroniony.
// Rangi tylko PRZED nazwą, tuż po kotwicy: tytuł po nazwie ulicy czy patrona zaczyna osobę
// („Na ul. Długiej lek. Anna Nowak", „Szpital im. Mikołaja Kopernika lek. med. Jan Nowak").
// Pierwszy wyraz nazwy także sklejony z „im."/„ul." („Szkoła Podstawowa im.Henryka Sienkiewicza"),
// jak w RE_PATRON_ABBR: przebieg par zostawiał wtedy patrona, a samo nazwisko dostawało maskę
// („im.Henryka [IMIĘ I NAZWISKO]").
const RE_STREET_EPONYM_TAIL = new RegExp(
  `(?<![\\p{L}])(?:${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?` +
    `(?:[ \\t]+${STREET_RANK})*` +
    `|(?:[Ii]m|[Uu]l)\\.[${PL_UP}][${PL_LO}${PL_UP}'’-]*)` +
    `(?:[ \\t]+(?:[${PL_UP}][${PL_LO}${PL_UP}'’-]*|[IVXLCDM]+))*` +
    `[ \\t]*$`,
  'u',
);
// Kotwica i same rangi tuż przed kandydatem („W parku lek. ", „ul. dra "). Patron stoi wtedy
// w dopełniaczu („Ulica dra Alfreda Sokołowskiego"), a mianownik to osoba z prozy („W parku lek.
// Jan Kowalski reanimował poszkodowanego") — rozstrzyga nominativePersonAhead.
const RE_STREET_RANK_ONLY_TAIL = new RegExp(
  `(?<![\\p{L}])${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?(?:[ \\t]+${STREET_RANK})+[ \\t]*$`,
  'u',
);
// Ten sam strażnik dla zapisu WERSALIKAMI („PRZY ALEI WŁADYSŁAWA SIKORSKIEGO", „RONDO ROMANA
// DMOWSKIEGO"). Tylko BEZPOŚREDNIO po kotwicy (dopuszczalne same rangi): w wersalikach każdy wyraz
// wygląda jak nazwa własna, więc mostkowanie przez wyrazy wciągnęłoby osobę z dalszej części zdania.
// Skróty wyłącznie z kropką — „PL"/„OS" bez kropki to kod kraju czy system, nie ulica. Końcówki
// zamknięte jak wyżej: „KIEROWNIK PLACÓWKI", „SKLEP OSIEDLOWY", „FHU MOSTEK" to nie ulica.
const RE_STREET_EPONYM_TAIL_CAPS =
  /(?<!\p{L})(?:ULIC(?:A|Y|Ę|Ą|E)?|ALEJ(?:A|Ę|Ą|E)?|ALEI|PLAC(?:U|EM)?|ROND(?:O|A|U|ZIE|EM)?|MOST(?:U|EM)?|MOŚCIE|OSIEDL(?:E|A|U|EM)?|SKWER(?:U|ZE|EM)?|BULWAR(?:U|ZE|EM)?|PARK(?:U|IEM)?|ZBIEG(?:U)?|RÓG|ROGU|IMIENIA|(?:IM|UL|AL|PL|OS)\.)(?:[ \t]+(?:GEN|PŁK|PPŁK|MJR|KPT|POR|KS|ŚW|BŁ|BP|ABP|KARD|MARSZ|PROF|DR|DRA|INŻ|HR)\.?)*[ \t]+$/u;
// „im" bez kropki („Szkoła Podstawowa nr 3 im Marii Konopnickiej", „Szpitala im Mikołaja Kopernika")
// — niedbały zapis patrona. Kotwicą jest tylko po nazwie instytucji albo „nr N" tuż przed nim;
// zaimek („Pomógł im Jan Kowalski", „Dałem im Jana Kowalskiego za przykład") zostaje osobą.
// Zakotwiczony na początku wycinka od OSTATNIEGO wyrazu „im" (znalezionego przez lastIndexOf w oknie
// 220 znaków): późniejsze „im" przerwałoby ciąg nazw, więc wcześniejsze nie mogą pasować — jeden test
// zamiast skanu regexem od każdej pozycji okna przy każdym kandydacie na nazwisko.
const RE_BARE_IM_TAIL = new RegExp(
  `^im(?:[ \\t]+${STREET_RANK})*(?:[ \\t]+(?:[${PL_UP}][${PL_LO}${PL_UP}'’-]*|[IVXLCDM]+))*[ \\t]*$`,
  'u',
);
const RE_INSTITUTION_WORD =
  /^(?:szkoł|szkół|szkol|szpital|przedszkol|liceum|gimnazj|technikum|uniwersyte|akademi|politechni|instytu|ośrod|zespoł|zespół|bibliotek|hufc|hufiec|parafi|fundacj|stowarzysze|muze|teatr|filharmoni|centrum|poradni|żłob|internat|burs|hospicj|klinik|przychodni|sanatori|kolegi|seminari|klub|stadion|zakład|dom(?:u|em|y|ów)?$)\p{L}*$/iu;
/** Czy tuż przed „im" stoi nazwa instytucji (najwyżej dwa wyrazy z wielkiej litery przerwy: „Szkoła
 *  Podstawowa im", „Szpitala im") albo „nr N" („Szkoła Podstawowa nr 3 im")? Skan kilku ostatnich
 *  wyrazów zamiast regexu z „$" próbowanego od każdej pozycji wycinka. Wyrazy dzieli też nowa linia,
 *  cudzysłów, średnik, nawias i ucieczka JSON-a: nazwa placówki zaczyna komórkę CSV („1;Szkoła
 *  Podstawowa im …"), wartość JSON („"Szkoła …") albo wiersz wykazu („Wykaz:⏎Szpital im …"). */
// Obiekty i komórki z patronem po gołym „im" („Kierownik Oddziału im Józefa Babińskiego", „Park im
// Marii Konopnickiej", „Rondo im …", „Kopalnia Soli im …") oraz skrót placówki WERSALIKAMI („ZSO im",
// „III LO im", „MOPS im", „CKZiU im"). Czasownik przed „im" stoi małą literą („Pomógł im Jan Kowalski").
const RE_INSTITUTION_WORD_EXACT =
  /^(?:oddział\p{L}*|katedr\p{L}*|wydział\p{L}*|sal[aię]?|aul[aię]?|pracowni\p{L}*|galeri\p{L}*|drużyn\p{L}*|nagrod\p{L}*|stypendi\p{L}*|konkurs\p{L}*|festiwal\p{L}*|park(?:u|iem)?|rond(?:o|a|zie)?|kopalni\p{L}*|hal[aię]?|pływalni\p{L}*|pomnik\p{L}*|kopiec|kopca|kopcu)$/iu;
const RE_INSTITUTION_ACRONYM = /^\p{Lu}{2,6}(?:i\p{Lu}+)?$/u;
function institutionBeforeIm(pre: string): boolean {
  const ws = pre.trimEnd().split(/[\s"„”';:()\\-]+/u).slice(-4);
  for (let i = ws.length - 1, caps = 0; i >= 0; i--) {
    const w = ws[i];
    if (RE_INSTITUTION_WORD.test(w) || RE_INSTITUTION_WORD_EXACT.test(w)) return true;
    if (RE_INSTITUTION_ACRONYM.test(w) && !/^[IVXLCDM]+$/.test(w)) return true;
    if (/^\d+[a-zA-Z]?$/.test(w)) return /^nr\.?$/i.test(ws[i - 1] ?? '');
    if (!/^\p{Lu}/u.test(w) || ++caps > 2) return false;
  }
  return false;
}
/**
 * Czy kandydat na pozycji `offset` stoi w nazwie ulicy/placu/obiektu (patron, nie osoba)? Osoba
 * w mianowniku nie jest patronem — patron stoi w dopełniaczu („przy alei Władysława Sikorskiego",
 * „PRZY ALEI WŁADYSŁAWA SIKORSKIEGO", „ul. Emilii Plater"). Imię w mianowniku rozstrzyga zawsze („Na
 * ulicy Jan Kowalski zasłabł", „NA ULICY JAN KOWALSKI ZOSTAŁ POTRĄCONY", „Na ul. Długiej Jan Kowalski
 * …"); po samych rangach („W parku lek. ", „ul. dra ") także nazwisko w mianowniku („W parku dr
 * Kowalski"). Poza tym samo nazwisko na -ski/-cki zostaje nazwą: „na placu Grzybowskim", „PLAC
 * GRZYBOWSKI".
 */
const precededByStreetEponym = (t: string, offset: number): boolean => {
  const tail = t.slice(Math.max(0, offset - 220), offset);
  // tabulator tuż przed parą to granica komórki: „Logistyka⇥Plac⇥Kowalczyk Anna" — „Plac" to
  // sąsiednia kolumna (np. miejsce pracy), nie nazwa placu z patronem
  if (/\t[ \t]*$/.test(tail)) return false;
  if (RE_STREET_EPONYM_TAIL.test(tail)) return !nominativePersonAhead(t, offset, RE_STREET_RANK_ONLY_TAIL.test(tail));
  if (RE_STREET_EPONYM_TAIL_CAPS.test(t.slice(Math.max(0, offset - 60), offset))) return !nominativePersonAhead(t, offset, false);
  // ostatni samodzielny wyraz „im" (odstęp po obu stronach) — jedno przejście wstecz po wycinku
  const sep = (c: string | undefined): boolean => c === ' ' || c === '\t';
  let im = tail.lastIndexOf('im');
  while (im > 0 && !(sep(tail[im - 1]) && sep(tail[im + 2]))) im = tail.lastIndexOf('im', im - 1);
  return (
    im > 0 &&
    RE_BARE_IM_TAIL.test(tail.slice(im)) &&
    institutionBeforeIm(tail.slice(Math.max(0, im - 60), im)) &&
    !nominativePersonAhead(t, offset, false)
  );
};
/** Pojedynczy wyraz oznaczający ulicę/plac/obiekt (zamknięta odmiana jak w STREET_ANCHOR_SRC) — gdy
 *  stoi tuż PRZED imieniem w ciągu „Rondo Romana Dmowskiego" (kapitalizowany, wciągnięty do
 *  dopasowania pary), para to patron, nie osoba. Uzupełnia `precededByStreetEponym` (który patrzy
 *  PRZED całym dopasowaniem). */
const RE_STREET_WORD =
  /^(?:ulic(?:a|y|ę|ą|e|om|ami|ach|zk[aięą]|zce)?|alej(?:a|ę|ą|e|om|ami|ach)?|alei|plac(?:u|em|e|y|ów|om|ami|ach)?|rond(?:o|a|u|em|zie|om|ami|ach)?|most(?:u|em|y|ów|om|ami|ach)?|osiedl(?:e|a|u|em|i|om|ami|ach)?|skwer(?:u|em|ze|y|ów|om|ami|ach)?|bulwar(?:u|em|ze|y|ów|om|ami|ach)?|park(?:u|iem|i|ów|om|ami|ach)?|zbieg(?:u|iem)?|rog(?:u|iem)?|róg|imienia|im|ul|al|pl|os)$/iu;
/** Kody walut — „PLN 123456" to kwota, nie dowód (wyjątek w kroku DOWÓD bez kontekstu). */
const CURRENCY_CODES = new Set([
  'PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'JPY', 'UAH', 'RUB',
]);

// ── Pola formularza (etykieta → wartość) ──────────────────────────────────────
// Eksporty urzędowe często mają układ „Etykieta\nWARTOŚĆ" (wartość w OSOBNEJ linii,
// nierzadko WERSALIKAMI). Reguły tekstowe tego nie łapią (oczekują „etykieta: wartość"
// w jednej linii i nazwisk pisanych normalnie). Etykieta pola to MOCNA kotwica strukturalna,
// więc precyzja jest wysoka. Maskujemy tylko pola jednoznacznie osobowe — pola administracyjne
// (kraj, województwo, powiat, gmina) zostawiamy: są za szerokie, by same w sobie były PII.
type FormKind = 'name' | 'date' | 'place' | 'addr';
interface FormField {
  re: RegExp; // dopasowuje etykietę (bez numeracji „12. ") do „:" lub końca linii
  type: PiiType;
  mask: string;
  kind: FormKind;
  /** Gdzie w wartości stoi nazwisko — w trybie pseudonimów pole dostaje wtedy etykietę osoby
   *  [OSOBA-X] zamiast stałej maski (patrz passFormFields). */
  surnameAt?: 'first' | 'last';
  /** Etykieta spoza dawnego zestawu (dopełnienie, zapis bez ogonków, szyk ZUS) — wartość przechodzi
   *  ostrzejszą bramkę gatedPersonValue. */
  gated?: true;
  /** Etykieta samego nazwiska („Nazwisko pacjenta:") — jeden wyraz pod nią to zawsze nazwisko. */
  surnameOnly?: true;
  /** Wartość bywa listą dwóch imion („Imiona rodziców: Jan, Anna"). */
  nameList?: true;
}
// Etykiety roli osoby w komórce wiersza z TAB-ami (patrz passFormFields).
const TAB_ROLE_LABELS = new Set<string>(
  (
    'świadek ojciec matka kierownik kierowniczka pracownik pracownica przełożony przełożona opiekun opiekunka ' +
    'pacjent pacjentka uczeń uczennica dziecko syn córka mąż żona małżonek małżonka wnioskodawca wnioskodawczyni pełnomocnik'
  ).split(' '),
);
// Dopełnienie etykiety osobowej („Imię i nazwisko pacjenta:", „Nazwisko i imię ubezpieczonego:",
// „Imię matki:") — ZAMKNIĘTA lista ról. Otwarty wzorzec końcówek dopełniacza łapałby etykiety
// podmiotów („Imię i nazwisko świadczeniodawcy: Przychodnia Zdrowie Sp. z o.o."); kotwice ^…$
// i tak odcinają prozę z dalszym ciągiem zdania („Imię i nazwisko pacjenta należy wpisać…").
const FORM_PERSON_OF = String.raw`(?:\s+(?:pacjent(?:a|ki)|dziecka|ucznia|uczennicy|ubezpieczon(?:ego|ej)|opiekun(?:a|ki)(?:\s+prawn(?:ego|ej))?|matki|ojca|rodzica|wnioskodawcy|osoby(?:\s+(?:upoważnionej|uprawnionej|kontaktowej|bliskiej))?|przedstawiciela(?:\s+ustawowego)?|zmarł(?:ego|ej)|małżonk(?:a|i)|świadka|pełnomocnika|pracownika))?`;
// Ogonki opcjonalne („imie", „miejscowosc", „panienskie" z systemów bez polskich znaków i z OCR),
// a liczebnik także PO „imię" — szyk ZUS i KRUS („Imię pierwsze", „Imię drugie"). Te warianty
// stoją ZA dawnymi wzorcami: dawne etykiety zachowują stałą maskę także w trybie pseudonimów,
// a nowe (dotąd łapane — o ile w ogóle — przebiegami osób, z etykietą [OSOBA-X]) jej nie tracą.
const FORM_FIELDS: FormField[] = [
  { re: /^imię\s+i\s+nazwisko$|^nazwisko\s+i\s+imię$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^nazwisk[ao](?:\s+(?:rodowe|panieńskie|poprzednie))?(?:\s+(?:matki|ojca))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^(?:pierwsze\s+|drugie\s+|kolejne\s+)?imi(?:ę|ona)(?:\s+(?:ojca|matki))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  // „Imiona rodziców: Jan, Anna" — lista imion; każde dostaje maskę (patrz passFormFields).
  { re: /^imiona\s+rodzic[oó]w$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', nameList: true },
  { re: new RegExp(`^imi[eę]\\s+i\\s+nazwisko${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', surnameAt: 'last', gated: true },
  { re: new RegExp(`^nazwisko\\s+i\\s+imi[eę]${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', surnameAt: 'first', gated: true },
  { re: new RegExp(`^nazwisk[ao](?:\\s+(?:rodowe|panie[nń]skie|poprzednie))?${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', surnameAt: 'first', gated: true, surnameOnly: true },
  { re: new RegExp(`^(?:(?:pierwsze|drugie|kolejne)\\s+)?imi(?:[eę]|ona)(?:\\s+(?:pierwsze|drugie|kolejne))?${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', gated: true },
  { re: /^data\s+urodzenia$/i, type: 'DATA-UR', kind: 'date', mask: '[DATA-URODZENIA]' },
  { re: /^miejsce\s+urodzenia$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^miejscowo[sś][cć]$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^(?:miejsce|adres)\s+(?:zamieszkania|zameldowania|pobytu)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^ulica$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:nr|numer)\s+(?:domu|budynku|lokalu|mieszkania)$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
];
/** Wartości „puste" pola — nie maskujemy (nie są danymi). */
const FORM_EMPTY_VALUES = new Set([
  'brak', 'niedotyczy', 'nd', 'n/d', 'bd', 'x', 'bez', '.', '-', '–', '—', '',
  'nieznane', 'nieznana', 'nieznany', 'niepodano', 'niepodane', 'null', 'none',
  // wypełniacze szablonów i wykazów (też rozstrzelone: „W A K A T", „D O   U Z U P E Ł N I E N I A")
  'wakat', 'anonim', 'anonimowy', 'anonimowa', 'zastrzeżone', 'zastrzeżony', 'zastrzeżona', 'ukryte',
  'douzupełnienia', 'douzupelnienia',
]);
/**
 * Czy wartość pola to „puste" oznaczenie? Bez kropek i odstępów: „b.d.", „B.D.", „b. d.", „n.d."
 * sprowadzają się do „bd"/„nd" — wcześniej zdejmowana była tylko OSTATNIA kropka i „b.d." szło jako
 * imię i nazwisko albo login. Jedna normalizacja dla pól formularza, struktur i loginu. Cena:
 * inicjały „B.D." w polu imienia zostają jawne, jak już dziś „BD".
 */
const isEmptyFormValue = (v: string): boolean => FORM_EMPTY_VALUES.has(v.toLowerCase().replace(/[\s.]+/g, ''));
// Nazwa własna: 1–4 wyrazy, każdy od wielkiej litery (też WERSALIKI) — proza ma małe litery i spójniki.
const RE_PROPER_WORDS = /^\p{Lu}[\p{L}'’.‑-]*(?:[ \t]+\p{Lu}[\p{L}'’.‑-]*){0,3}$/u;
/**
 * Nazwy kont TECHNICZNYCH i generycznych (lowercase). Pole „Login: admin" maskujemy jak każde
 * inne, ale tej wartości nie rozlewamy na resztę dokumentu: w prozie to zwykłe słowa („panel
 * admin", „zaktualizuj system", „uruchom test", „sterownik postgres"), a nie dane osoby.
 * Do tego konta FUNKCYJNE działów („URZAD\kadry", „Login: magazyn"): to zwykłe rzeczowniki,
 * więc propagacja dawała „przekazano do działu [LOGIN]", „przyjęto na [LOGIN]". Wartość loginu
 * jest ASCII, stąd zapis bez ogonków („ksiegowosc", „zarzad").
 */
const GENERIC_LOGINS = new Set<string>(
  (
    'admin administrator root system test tester demo guest gosc gość user users default postgres ' +
    'mysql oracle jenkins nobody daemon operator service serwis support helpdesk backup kiosk public ' +
    'anonymous ubuntu superuser sysadmin www-data ec2-user manager master developer monitor recepcja ' +
    'biuro sekretariat info office ' +
    'kadry kadr ksiegowosc ksiegowa ksiegowy marketing sprzedaz handel handlowy kontakt kontakty ' +
    'faktury faktura fakturowanie rekrutacja sklep noreply no-reply magazyn magazynier ewidencja ' +
    'kancelaria place zarzad prezes dyrektor kierownik sekretarz logistyka zakupy produkcja obsluga ' +
    'klient klienci finanse administracja poczta mail email skaner scanner drukarka printer kasa ' +
    'szkolenia dziekanat rektorat archiwum wsparcie pomoc rejestracja laboratorium apteka przychodnia ' +
    'portiernia ochrona dyzurny informatyka informatyk technik serwisant inspektor rodo audyt legal ' +
    'sales finance accounting billing payroll contact orders shop team staff student uczen nauczyciel'
  ).split(' '),
);
/**
 * Konta systemowe i katalogi, które w ścieżce profilu (C:\Users\…, /home/…), udziale domowym
 * i logu sshd/sudo stoją na miejscu użytkownika, a osobą nie są (lowercase). Uzupełnia
 * GENERIC_LOGINS: „Public", „Default User", „WDAGUtilityAccount", katalogi współdzielone
 * („/home/www", „/Users/Shared") i zastępniki z dokumentacji („/home/username/").
 */
const SYSTEM_ACCOUNTS = new Set<string>(
  (
    'public default defaultuser defaultuser0 default.migrated allusers wdagutilityaccount defaultapppool ' +
    'localservice networkservice systemprofile shared share git deploy deployer ansible vagrant centos ' +
    'debian fedora pi node app apps runner gitlab-runner docker www html http httpd nginx apache ftp ' +
    'sftp sshd mail data storage media backups lost+found tmp temp home users projects projekty ' +
    'username yourname youruser uzytkownik nazwauzytkownika login user1 sync bin sys halt shutdown ' +
    'adm lp news uucp games nfsnobody polkitd chrony dbus postfix redis elasticsearch kibana grafana ' +
    'prometheus zabbix nagios tomcat wildfly jboss hadoop spark kafka zookeeper azureuser opc ' +
    'cloud-user rocky almalinux alpine kali ' +
    // wbudowane konta Windows i SQL Server, kontenery deweloperskie, serwery gier, zastępniki
    'krbtgt defaultaccount sqlserveragent mssqlserver mssqlfdlauncher vscode codespace codespaces ' +
    'linuxbrew steam minecraft twojlogin twojanazwa twojanazwauzytkownika yourusername ' +
    'unknown nobody anonymous null undefined ' +
    // konta usług z dystrybucji Linuksa i popularnych aplikacji („session opened for user cron")
    'cron syslog proxy gdm lightdm sddm rtkit man list irc gnats messagebus avahi colord pulse saned ' +
    'whoopsie usbmux geoclue uuidd tss tcpdump dnsmasq landscape pollinate splunk bitnami odoo ' +
    'asterisk freeswitch zimbra mongodb memcached rabbitmq couchdb solr sonar nexus ldap openldap ' +
    'named bind squid clamav amavis dovecot exim vmail opendkim ' +
    // wspólne konta i katalogi działów w przychodni, szpitalu i urzędzie („C:\Users\pielegniarki",
    // „/home/dokumenty/2025") — to nie osoba, a maska w ścieżce psuje sens instrukcji
    'skany skan pracownia rtg usg ekg dokumenty dokument oddzial gabinet pielegniarki pielegniarka ' +
    'lekarz lekarze pacjenci pacjent wyniki szpital pracownicy pracownik wnioski zbiory biblioteka ' +
    'promocja aktualnosci szkola budzet mapa start praca raporty druki pisma umowy skrzynka wspolny ' +
    'wspolne dzial referat wydzial urzad gmina starostwo komputer stanowisko ' +
    // konta działów i ról w urzędzie gminy, szkole i ośrodku pomocy („C:\Users\geodezja",
    // „\\fs01\home$\mops", „C:\Users\uczniowie") — bez homografów nazwisk („starosta", „kowal", „sołtys", „woźny",
    // „kasjer", „opiekun"): zamaskowany pod etykietą login takiego konta wyciekał w ścieżce profilu
    'uczniowie swietlica kuchnia stolowka referent geodezja usc mops gops ops oswiata podatki wymiar ' +
    'rada radni radny kierowca zaopatrzenie sport turystyka kultura rolnictwo srodowisko inwestycje ' +
    'zamowienia przetargi uchwaly sesja odpady wybory pomoc_spoleczna obywatel mieszkaniec skarbnik ' +
    'wojt burmistrz prawnik radca meldunki dowody ewidencja_ludnosci komunikacja drogi lesnictwo ' +
    'sanepid policja straz osp parafia kontrola bhp ppoz iod abi sekretarka nauczycielka ' +
    'nauczyciele wychowawca pedagog psycholog logopeda higienistka zastepca naczelnik bibliotekarz ' +
    'stazysta praktykant'
  ).split(' '),
);
const isListedAccount = (l: string): boolean => GENERIC_LOGINS.has(l) || SYSTEM_ACCOUNTS.has(l);
// Sufiks numeru nie zmienia charakteru konta: „faktury01", „recepcja2", „system2" to dalej
// skrzynki i konta działów, nie osoby. Zastępnik z instrukcji bywa pisany z separatorem
// („nazwa_uzytkownika", „twoja-nazwa", „twoj_login"), więc porównujemy też bez niego.
const isSystemAccount = (v: string): boolean => {
  const l = v.toLowerCase();
  if (isListedAccount(l) || /^(?:systemd-|_)/.test(l)) return true;
  const base = l.replace(/[._-]?[0-9]+$/, '');
  if (base !== l && isListedAccount(base)) return true;
  const joined = base.replace(/[._-]/g, '');
  return joined !== base && isListedAccount(joined);
};
/** Imiona bez polskich znaków („lukasz", „malgorzata") — indeks leniwy, jak isAsciiSurname. */
let asciiFirstNames: Set<string> | null = null;
const isAsciiFirstName = (w: string): boolean => {
  asciiFirstNames ??= new Set([...POLISH_FIRST_NAMES].filter((n) => !NOUN_LIKE_FIRST_NAMES.has(n)).map(foldAscii));
  return asciiFirstNames.has(w.toLowerCase());
};
/**
 * Czy człon loginu (same litery ASCII) to imię, nazwisko albo inicjał z nazwiskiem
 * („jan", „nowak", „jkowalski", „kaminska")? To odróżnia konto osoby od konta działu
 * czy usługi zapisanego tym samym kształtem („batch01", „web_app", „kadry_archiwum").
 */
/** Imię i nazwisko sklejone kropką albo podkreślnikiem („Jan.Kowalski", „Anna_Nowak"). */
const RE_DOTTED_PERSON = /^[A-Z][a-z]+(?:[._][A-Z][a-z]+)+$/;
// Nazwisko-homonim („Zając", „Kowal", „Wróbel") słownik nazwisk pomija, bo sam wyraz to zwykłe
// słowo. Po inicjale („mzajac", „tkowal", „awrobel") to już kształt loginu, nie wyraz z prozy.
// Bez nazw miesięcy i dni („pmarzec", „wsobota" to nie konto).
let asciiHomographs: Set<string> | null = null;
const isInitialHomograph = (p: string): boolean => {
  asciiHomographs ??= new Set(
    [...HOMOGRAPH_SURNAMES]
      .filter((h) => !/^(?:piątek|sobota|niedziela|środa|kwiecień|maj|marzec|styczeń|grudzień|lipiec|sierpień)$/.test(h))
      .map(foldAscii)
      .filter((h) => h.length >= 4),
  );
  return asciiHomographs.has(p.slice(1).toLowerCase());
};
// Imię sklejone z nazwiskiem bez separatora („annanowak", „tomaszkaminski") — typowe konto
// profilu, które samo w sobie nie jest ani imieniem, ani nazwiskiem.
const isJoinedFullName = (p: string): boolean => {
  for (let i = 3; i <= p.length - 4; i++) {
    if (isAsciiFirstName(p.slice(0, i)) && isAsciiSurname(p.slice(i))) return true;
  }
  return false;
};
const isNameishPart = (p: string): boolean =>
  (p.length >= 3 && isAsciiFirstName(p)) ||
  isAsciiSurname(p) ||
  (p.length >= 5 && (isAsciiSurname(p.slice(1)) || isAsciiSurname(p.slice(2)) || isInitialHomograph(p))) ||
  (p.length >= 7 && p.length <= 40 && isJoinedFullName(p));
/**
 * Czy login z kotwicy POŚREDNIEJ (parametr URL-a, klucz JSON/XML, ścieżka profilu, udział
 * domowy, log sshd, słabsza etykieta) wolno rozlać na resztę dokumentu? Tam pod kluczem stoi
 * też „system", „v2.1", nazwa katalogu czy konto usługi, a propagacja zwykłego wyrazu maskowałaby
 * prozę („system restart", „Zadanie batch01 wykonuje import"). Rozlewamy tylko uchwyt osoby:
 * kropka, podkreślnik albo cyfra przy członie, który jest imieniem lub nazwiskiem („a.kaminska",
 * „jan_nowak", „adam1986"), albo nazwisko ze słownika po odcięciu inicjału („jkowalski", „anowak").
 */
function isPropagatableLogin(v: string): boolean {
  if (v.length < 4 || (v.match(/[A-Za-z]/g) ?? []).length < 3 || isSystemAccount(v)) return false;
  // „Jan.Kowalski" to imię i nazwisko sklejone kropką — maskuje je w całości FAZA 4 z etykietą
  // osoby; jako login rozlany na prozę zabierał osobie pseudonim („zlecił [LOGIN]" obok [OSOBA-A]).
  if (RE_DOTTED_PERSON.test(v)) return false;
  if (/^[A-Za-z][A-Za-z0-9]*[._][A-Za-z0-9._]*[A-Za-z0-9]$|^[A-Za-z]{3,}[0-9]{1,6}$/.test(v)) {
    return (v.match(/[A-Za-z]+/g) ?? []).some(isNameishPart);
  }
  return /^[A-Za-z]+$/.test(v) && (isAsciiSurname(v.slice(1)) || isAsciiSurname(v.slice(2)));
}
/**
 * Czy segment ścieżki profilu, udziału domowego albo nieudanego logowania sshd to konto osoby?
 * Pod „/home/", „/Users/" czy „\\srv\home$\" stoją też trasy serwisu („/home/dashboard",
 * „GET /Users/Edit/15"), wspólne katalogi działu („Biblioteka", „Meldunki") i słownikowe
 * nazwy z ataku („Invalid user test1"). Maskujemy imię, nazwisko, uchwyt z nim albo krótki
 * identyfikator pracownika z cyframi („u12345", „ab1234").
 */
function isPersonalSegment(seg: string): boolean {
  if (isSystemAccount(seg)) return false;
  const letters = seg.match(/[A-Za-z]+/g) ?? [];
  if (letters.some(isNameishPart)) return true;
  return /\d/.test(seg) && letters.join('').length <= 3;
}
/** Konta usług w dzienniku zdarzeń Windows („SubjectUserName" = „SYSTEM", „DWM-1", „UMFD-0"). */
const RE_WELL_KNOWN_ACCOUNT = /^(?:SYSTEM|DWM-\d+|UMFD-\d+)$/;
/** Wbudowane grupy i konta Windows („BUILTIN\Administrators", „NT AUTHORITY\SYSTEM") — nie osoba. */
const RE_BUILTIN_ACCOUNT = /^(?:BUILTIN|NT[ ]AUTHORITY|NT[ ]SERVICE)\\/i;
/** Nazwa użytkownika z zapisu „DOMENA\użytkownik" (w JSON-ie ukośnik bywa podwojony). */
const loginUserPart = (val: string): string => val.slice(val.lastIndexOf('\\') + 1);
/**
 * Pierwsze słowa TYPOWYCH etykiet/nagłówków formularza (lowercase). Służy TYLKO do rozpoznania,
 * że „wartość" pustego pola PII to w istocie kolejna etykieta/nagłówek sekcji (a nie dana) —
 * chroni przed maskowaniem np. „Rozpoznanie", „Oddział" po pustym „Nazwisko:".
 */
const FORM_LABEL_WORDS = new Set<string>(
  (
    'nazwisko nazwiska imię imiona imie data miejsce miejscowość miejscowosc ulica nr numer kraj województwo ' +
    'powiat gmina kod pesel nip regon krs telefon tel email e-mail adres rozpoznanie oddział ' +
    'jednostka wydział dział stanowisko zawód wykształcenie obywatelstwo seria dokument płeć stan ' +
    'dane rozdział załącznik punkt pozycja poz specjalność tytuł nazwa firma'
  ).split(' '),
);
/** Wzorzec daty (cyfrowa lub słowna) — do maskowania SAMEJ daty w wartości pola „Data urodzenia". */
const RE_DATE_VALUE =
  /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}/i;
/** Zdejmuje numerację („12. ", „3) ") i białe znaki z brzegów — zostaje sama treść etykiety/wartości. */
const stripFormPrefix = (s: string): string => s.replace(/^[ \t]*\d+[.)][ \t]*/, '').trim();
/**
 * Sama etykieta z wiersza formularza: bez wartości po dwukropku i bez końcowej podpowiedzi
 * w nawiasie („Nazwisko (rodowe): …" → „Nazwisko"). Odpowiednik
 * `s.replace(/\s*:.*$/, '').replace(/\s*\([^)]*\)\s*$/, '')`, ale LINIOWY: tamte regexy
 * od każdej pozycji długiego ciągu spacji albo „((((" skanowały wiersz do końca (sekundy na
 * 100 tys. znaków). Zachowanie identyczne, łącznie z tym, że „.*$" nie przechodzi przez
 * znaki końca wiersza — liczy się pierwszy dwukropek PO ostatnim z nich.
 */
function formLabelOf(s: string): string {
  const lastTerm = Math.max(s.lastIndexOf('\r'), s.lastIndexOf(' '), s.lastIndexOf(' '));
  const colon = s.indexOf(':', lastTerm + 1);
  const base = colon === -1 ? s : s.slice(0, colon).trimEnd();
  const t = base.trimEnd();
  if (!t.endsWith(')')) return base;
  const open = t.indexOf('(', t.lastIndexOf(')', t.length - 2) + 1);
  if (open === -1 || open > t.length - 2) return base;
  return t.slice(0, open).trimEnd();
}
/** Czy wiersz to etykieta/nagłówek (nie wartość sąsiedniego pola) — chroni pola PUSTE. */
const isFormLabelLine = (line: string): boolean => {
  const t = stripFormPrefix(line);
  const base = t.replace(/\s*:\s*$/, ''); // zdejmij końcowy dwukropek („Imię:")
  if (FORM_FIELDS.some((f) => f.re.test(base))) return true; // znana etykieta pola
  if (/:\s*$/.test(line)) return true; // wiersz kończy się „:" → etykieta, nie wartość
  if (/^\d+[.)]\s+\S/.test(line.trim())) return true; // numerowana etykieta („14. Kraj")
  // krótka fraza zaczynająca się typowym słowem etykiety/nagłówka („Rozpoznanie", „Oddział…")
  const words = base.split(/\s+/);
  return words.length <= 3 && FORM_LABEL_WORDS.has(words[0]?.toLowerCase() ?? '');
};
const RE_LETTER_SPACED = /^\p{L}(?: \p{L})+(?: {2,}\p{L}(?: \p{L})*)*$/u;
/** Wyrazy tekstu rozstrzelonego („J A N   N O W A K" → ["JAN", "NOWAK"]) albo null. */
function letterSpacedWords(t: string): string[] | null {
  if (!RE_LETTER_SPACED.test(t)) return null;
  return t.split(/ {2,}/).map((w) => w.replace(/ /g, ''));
}
/** Czy `value` to sensowna wartość danego rodzaju pola (chroni przed prozą, etykietami, „nie dotyczy"). */
const isValidFormValue = (value: string, kind: FormKind): boolean => {
  const t = value.trim();
  if (!t || t.length > 70) return false;
  if (isEmptyFormValue(t)) return false;
  if (/^\d+[.)]\s/.test(t)) return false; // kolejna etykieta numerowana
  if (/^(nie\b|nieznan|niepodan|do ustalenia|brak\b|b\/d)/i.test(t)) return false; // frazy proceduralne
  if (kind === 'place') {
    // miejscowość: nazwa własna — pierwsza litera wielka lub WERSALIKI (proza ma małe litery/spójniki)
    return RE_PROPER_WORDS.test(t);
  }
  if (kind === 'name') {
    // Tekst rozstrzelony („K R Z Y S Z T O F   M A Z U R" z PDF-a i OCR): litery co jedną spację,
    // wyrazy co najmniej dwiema. Rozstrzygamy po sklejeniu — rozstrzelona etykieta pola („N I P",
    // „P E S E L" w wierszu pod „Imię") i pojedyncza litera jako wyraz to nie imię i nazwisko.
    const spaced = letterSpacedWords(t);
    if (spaced) return spaced.length <= 4 && spaced.every((w) => w.length >= 2 && !FORM_LABEL_WORDS.has(w.toLowerCase()) && !STRUCT_KEYS.has(normStructKey(w)));
    // Etykieta pola / klucz strukturalny („Imię:", „firstName") to MOCNA kotwica — maskujemy imię/
    // nazwisko NIEZALEŻNIE od wielkości liter („Imię: pamela", „pAMELA"). Nadal 1–4 wyrazy z samych
    // liter (bez cyfr i prozy); WERSALIKI działały już wcześniej, tu dochodzi zapis małą/mieszaną literą.
    // Tabulator to granica kolumny TSV („Nazwisko:⇥Gzowski⇥Kadry"), nie odstęp w nazwisku.
    return /^\p{L}[\p{L}'’.‑-]*(?: +\p{L}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'date') return /\d{4}|\d{1,2}[-.\/]\d{1,2}/.test(t);
  // addr: ulica (nazwa własna) lub nr domu (cyfry). Odrzuć zdanie: KAŻDY wyraz musi być nazwą
  // własną (wielka litera / WERSALIKI), tokenem z cyfrą, albo krótką cząstką adresową (m, lok, ul…).
  const toks = t.split(/\s+/);
  if (toks.length > 5) return false;
  const ADDR_PARTICLE = /^(m|lok|ul|al|os|pl|nr|im|św|gen|ks)\.?$/i;
  // skrót typu ulicy na początku wartości („Ulica: ul. Dolna", {"ulica": "ul. Dolna"}) — wielką literę
  // sprawdzamy na nazwie za nim; dawniej sam skrót małą literą odrzucał całą wartość
  const head = t.replace(/^(?:ul|al|os|pl)\.[ \t]*/i, '');
  return (
    /^[\p{Lu}\d]/u.test(head) &&
    toks.every((w) => /^\p{Lu}/u.test(w) || /\d/.test(w) || ADDR_PARTICLE.test(w))
  );
};

/**
 * Encje prawne/instytucje, których NIE traktujemy jako „imię nazwisko"
 * (np. „Sąd Najwyższy", „Kodeks Cywilny", „Prawo Pracy").
 */
export const LEGAL_ENTITY_WORDS = new Set<string>(
  (
    'sąd sądu trybunał trybunału izba kodeks kodeksu ustawa ustawie prawo prawa ordynacja ' +
    'rozporządzenie urząd urzędu ministerstwo sejm senat parlament komisja inspekcja straż ' +
    'policja prokuratura rzecznik cywilny cywilnego karny karnego pracy handlowy administracyjny ' +
    'postępowania wykonawczy skarbowy rzeczpospolita polska polski unia europejska najwyższy ' +
    'apelacyjny okręgowy rejonowy konstytucyjny państwowa narodowy narodowa fundusz zakład ' +
    'krajowy krajowa główny główna społecznych ' +
    // częste rzeczowniki „dokumentowe" — nie mylić z nazwiskiem w parze „Słowo Imię"
    'umowa umowie załącznik rozdział artykuł ustęp punkt pozycja faktura pismo wniosek decyzja ' +
    'departament biuro wydział referat oddział sekcja nowy nowa ' +
    // rzeczowniki instytucjonalne — chronią przymiotnik w nazwie („Uniwersytet Warszawski",
    // „Izba Lekarska", „Bank Śląski") przed morfologicznym rozpoznawaczem nazwisk (krok 13a2)
    'uniwersytet uniwersytetu politechnika akademia akademii instytut instytutu bank banku ' +
    'szpital szpitala teatr muzeum klub związek związku kancelaria kancelarii fundacja fundacji ' +
    'stowarzyszenie spółka spółki spółdzielnia spółdzielni samorząd samorządu rada rady zarząd ' +
    'zarządu gmina gminy powiat powiatu województwo starostwo kuratorium izby prawa ' +
    'komitet komitetu hufiec zespół zespołu koło zrzeszenie komenda komendy ośrodek ośrodka ' +
    'fundusz funduszu centrum agencja agencji dyrekcja dyrekcji park parku'
  ).split(/\s+/),
);

/** Tytuły/grzecznościowe — NIE są nazwiskiem w parze „Tytuł Imię" (trigger obsługuje je osobno). */
const TITLE_WORDS = new Set<string>(
  'pan pani pana panu panią panie państwo szanowny szanowna dr prof mgr inż'.split(/\s+/),
);

/**
 * Role/funkcje/tytuły zawodowe stojące PRZED nazwiskiem („Prezes Gzowski", „Sędzia Trzebiatowski").
 * W parze morfologicznej (krok 13a2) maskujemy wtedy SAMO nazwisko, a rolę zostawiamy —
 * inaczej znikałoby słowo niosące sens („Dyrektor [IMIĘ] podpisał").
 */
const ROLE_WORDS = new Set<string>(
  (
    'prezes prezesa prezesie dyrektor dyrektora dyrektorze minister ministra prezydent prezydenta ' +
    'wiceprezes wicedyrektor wojewoda wojewody starosta starosty burmistrz burmistrza wójt wójta ' +
    'marszałek marszałka sędzia sędziego sędzię prokurator prokuratora adwokat adwokata radca radcy ' +
    'notariusz notariusza komornik komornika kierownik kierownika naczelnik naczelnika inspektor ' +
    'inspektora kurator kuratora rektor rektora dziekan dziekana profesor profesora doktor doktora ' +
    'mecenas mecenasa kanclerz przewodniczący przewodnicząca sekretarz skarbnik pełnomocnik biegły ' +
    'świadek powód pozwany oskarżony wnioskodawca ' +
    // strony/uczestnicy oraz rzeczowniki pospolite stojące przed nazwiskiem (nie osierocaj ich)
    'pracownik pracownica klient klientka pacjent pacjentka najemca wynajmujący właściciel właścicielka ' +
    'dłużnik wierzyciel kupujący sprzedający zleceniodawca zleceniobiorca wykonawca zamawiający konsument ' +
    'ubezpieczony poszkodowany uczestnik członek przedstawiciel abonent użytkownik nabywca darczyńca ' +
    // podmioty gospodarcze i człony ich nazw (finding: „Piekarnia Nowak", „Zakład Usługowy Kowalski")
    'piekarnia tartak gospodarstwo warsztat hurtownia sklep apteka przychodnia restauracja pracownia ' +
    'przedsiębiorstwo usługowy usługowa usługowe handlowy handlowa handlowe produkcyjny produkcyjna ' +
    'rolny rolna rolne transportowy budowlany budowlana wielobranżowy ' +
    // urzędy i mandaty: „Pan Komendant Główny Policji", „Pan Poseł Kowalski" — bez nich rola znikała
    // w masce albo przymiotnik po niej („Główny") szedł jako nazwisko. Celowo BEZ „sołtys" (nazwisko).
    'komendant komendanta zastępca zastępcy poseł posła posłanka senator senatora wiceminister wiceministra ' +
    // „Pani Rzecznik Praw Dziecka Gzowska" — rzecznik z dopełniaczem urzędu przed nazwiskiem
    'rzecznik rzecznika'
  ).split(/\s+/),
);

/**
 * Dopełniacz URZĘDU po roli („Pani Minister Zdrowia", „Pan Komendant Policji", „Pan Sołtys Wsi")
 * i imiona sakralne („do Pana Boga"). Wyzwalacz „Pan/Pani" maskuje ostatni wyraz kandydata, więc
 * bez tej listy znikała nazwa resortu. Celowo NIE całe LEGAL_ENTITY_WORDS na wszystkich wyrazach
 * kandydata — „Pani Anna Nowa", „Pan Adam Nowy" to osoby (nazwiska-homonimy).
 */
const ROLE_COMPLEMENT_GEN = new Set<string>(
  (
    'zdrowia finansów sprawiedliwości infrastruktury edukacji oświaty kultury nauki sportu turystyki ' +
    'obrony spraw rolnictwa rozwoju klimatu środowiska cyfryzacji aktywów funduszy rodziny polityki ' +
    'gospodarki energii przemysłu transportu sejmu senatu miasta miast województwa wsi dzielnicy ' +
    'departamentu wydziału działu biura gabinetu kancelarii policji straży szkoły przedszkola szpitala ' +
    'instytutu ośrodka oddziału delegatury inspektoratu komisji sekcji referatu kadr ochrony ' +
    'praw dziecka obywatelskich pacjenta konsumentów ' +
    'bóg boga bogu bogiem jezus jezusa jezusowi jezusem chrystus chrystusa chrystusowi chrystusem ' +
    'maryja maryi maryję maryją'
  ).split(/\s+/),
);

/**
 * Pierwszy wyraz NAZWY WŁASNEJ obiektu, wydarzenia, akwenu („Kościół Mariacki", „Puszcza
 * Białowieska", „Sobór Watykański", „Kanał Sueski"). Przymiotnik -ski/-cki po nim, uzgodniony z jego
 * rodzajem i w tej samej komórce, to człon nazwy, nie nazwisko — w mianownikowej gałęzi pary (krok a2)
 * para nie jest wtedy osobą. Bez pory dnia i tygodnia („Dzień", „Tydzień" są w NON_NAME_LEADERS:
 * w grafiku stoi po nich nazwisko). Tylko tam: w innych
 * przebiegach te rzeczowniki nie są kotwicą („Kościół Kowalskiego" nie jest tu rozstrzygany).
 */
const PROPER_NAME_HEADS = new Set<string>(
  (
    'kościół bazylika katedra kaplica klasztor sanktuarium cmentarz pomnik kopiec hejnał jarmark ' +
    'festiwal konkurs turniej noc ocean morze kanał półwysep zatoka wyspa jezioro puszcza ' +
    'las ogród pałac zamek brama wieża dworzec traktat pokój układ pakt sobór synod kongres bitwa ' +
    'powstanie wyżyna nizina kotlina pojezierze pustynia szlak trakt'
  ).split(/\s+/),
);
// Wyraz z wielkiej litery za JEDNĄ spacją (strażnik nazwy instytucji w parze a2).
const RE_NEXT_CAP_WORD_1SP = new RegExp(`^ (${CAP_WORD})`);
// Forma firmy, przed którą stoi zwykle nazwisko właściciela („Brzozowski Spółka Jawna", „Lisiecki
// Kancelaria Adwokacka", „Gzowski Zakład Usługowy").
const OWNER_FIRM_HEADS = new Set<string>('spółka kancelaria zakład firma biuro gabinet pracownia warsztat'.split(' '));
// Strona postępowania w mianowniku: po niej przymiotnik ze stoplisty nazwisk to nazwisko osoby.
const PARTY_ROLE_WORDS = new Set<string>(
  (
    'świadek pozwany pozwana powód powódka oskarżony oskarżona obwiniony obwiniona podejrzany podejrzana ' +
    'pokrzywdzony pokrzywdzona wnioskodawca wnioskodawczyni uczestnik uczestniczka dłużnik dłużniczka ' +
    'wierzyciel skazany skazana pacjent pacjentka'
  ).split(' '),
);
const RE_AFTER_PARTY_ADJ = /^(?:[ \t]+\p{Ll}|[ \t]*[,.;:)!?]|[ \t]*$)/u;
/** Czy przerwa przed nazwiskiem w parze to granica kolumny wyrównanej spacjami? */
function columnGapBetween(kept: string, t: string, offset: number): boolean {
  const gap = /[ \t]+$/.exec(kept)?.[0] ?? '';
  if (gap.length >= 3) return true;
  if (gap.length < 2) return false;
  // druga taka przerwa w tym samym wierszu (okno ograniczone: bez skanu całego tekstu w pętli)
  const lo = Math.max(0, offset - 120);
  const win = t.slice(lo, offset + 160);
  const at = offset - lo;
  const ls = win.lastIndexOf('\n', at) + 1;
  const le = win.indexOf('\n', at);
  const line = win.slice(ls, le < 0 ? win.length : le);
  return (line.match(/ {2,}|\t/g)?.length ?? 0) >= 2;
}
// Czasownik osobowy w czasie przeszłym tuż za parą „Głowa Przymiotnik-ska": podmiotem jest osoba
// („Noc Brzozowska spędziła w celi", „Pokój Lisiecki opuścił o 10:00", „Las Gzowski sprzedał"),
// a głowa to dopełnienie albo okolicznik. Nazwa obiektu stoi przy formie bezosobowej („Pokój
// Westfalski podpisano", „Las Kabacki zamknięto"). Za czasownikiem osoby stoi okolicznik (przyimek,
// przysłówek, liczba) albo koniec zdania; wyraz pospolity za nim to podmiot w szyku odwróconym
// („Cmentarz Rakowicki odwiedził oskarżony", „Kościół Mariacki opuściła para młoda") albo
// dopełnienie, gdy podmiotem jest sama nazwa („Kościół Mariacki kupił nowe wyposażenie").
const RE_PERSON_PAST_VERB_AFTER =
  /^[ \t]+(?:spędził|przespał|opuścił|wymienił|sprzedał|kupił|wynajął|wynajmował|zajmował|przeleżał|dyżurował|odwiedził|zgłosił|opuściła|posprzątał)a?(?!\p{L})/u;
const RE_PERSON_VERB_COMPLEMENT =
  /^[ \t]+\p{Ll}+[ \t]*(?:[.,;:!?)]|$|\d|(?:w|we|na|o|od|do|z|ze|po|przy|za|przed|u|dla|około|ok\.|sam|sama|sami|spokojnie|wcześniej|później|wczoraj|dzisiaj|rano|wieczorem|nocą|całą|cały|całe)(?![\p{L}]))/u;
// Grafik dyżurów: „Dzień Lisiecka, Noc Brzozowska", „12.05.2024 Noc Gzowska SOR".
const RE_SHIFT_LIST_BEFORE = /(?<!\p{L})(?:Dzień|Rano|Wieczorem|Popołudnie)[ \t]+\p{Lu}\p{L}+[ \t]*,[ \t]*$/u;
const RE_DATE_LINE_HEAD_BEFORE = /(?:^|\n)[ \t]*\d{1,2}[.:]\d{2}(?:[.:]\d{2,4})?[ \t]+$/;
const RE_WARD_ABBR_AFTER = /^[ \t]+\p{Lu}{2,5}(?![\p{L}])/u;
const NOC_EVENT_ADJ = new Set<string>('świętojańska kupalna sylwestrowa kryształowa muzealna wigilijna listopadowa'.split(' '));
// Głowy, które w piśmie bywają zwykłym dopełnieniem czynności osoby (noc w celi, pokój w hotelu,
// zamek w drzwiach, las na sprzedaż), a nie nazwą zabytku czy miejsca.
const PERSON_PAIR_OBJECT_HEADS = new Set<string>('noc pokój zamek las'.split(' '));
const RE_IMPERSONAL_AFTER_PAIR = /^[ \t]+\p{Ll}{3,}(?:no|to)(?!\p{L})/u;
// Rzeczownik-rola jako podmiot za orzeczeniem („… odwiedził w sobotę wojewoda", „… kupił inwestor").
const RE_INVERTED_SUBJECT_ROLE =
  /(?<!\p{L})(?:wojewoda|wojewodzina|inwestor|inwestorka|prezydent|prezydentka|burmistrz|wójt|starosta|marszałek|minister|ministra|premier|biskup|arcybiskup|kardynał|papież|nabywca|nabywczyni|deweloper|turysta|turystka|turyści|delegacja|komisja|wycieczka|gość|goście|król|królowa|książę|ambasador|konserwator|nadleśniczy|leśniczy)(?!\p{L})/u;
/** Czy para „Głowa nazwy + przymiotnik uzgodniony" to mimo uzgodnienia osoba (patrz wyżej)? */
function properNamePairIsPerson(ctx: RedactCtx, t: string, offset: number, m: string, w1l: string, w2: string): boolean {
  const after = t.slice(offset + m.length, offset + m.length + 30);
  // forma bezosobowa za parą to zawsze obiekt („Dworzec Kaliski zamknięto", „Las Kabacki ogrodzono"),
  // także gdy w piśmie występuje osoba o tym nazwisku („Pozwany Jan Kaliski")
  if (RE_IMPERSONAL_AFTER_PAIR.test(after)) return false;
  const roomHead = PERSON_PAIR_OBJECT_HEADS.has(w1l);
  // nazwisko osoby rozpoznanej już w piśmie („Pacjentka Anna Lisiecka przyjęta. Noc Lisiecka …");
  // przymiotnik od nazwy miejscowości przy obiekcie zostaje nazwą („Dworzec Kaliski", „Las Kabacki")
  if (ctx.maskedSurnames.has(normalizeSurnameKey(w2)) && (roomHead || !isGeoAdjective(w2))) return true;
  // …albo podmiot za czasownikiem osobowym („Noc Brzozowska spędziła w celi", „Pokój Lisiecki
  // opuścił o 10:00"). Tylko przy głowie, która bywa dopełnieniem czynności osoby: przy kościele,
  // cmentarzu, klasztorze czy jarmarku podmiot w szyku odwróconym stoi za okolicznikiem („Kościół
  // Mariacki odwiedził w niedzielę biskup", „Cmentarz Powązkowski odwiedził wczoraj prezydent")
  // albo jest domyślny („Ogród Saski odwiedził.").
  if (
    roomHead &&
    RE_PERSON_PAST_VERB_AFTER.test(after) &&
    RE_PERSON_VERB_COMPLEMENT.test(after) &&
    !isGeoAdjective(w2) &&
    // Podmiot w szyku odwróconym dalej w zdaniu („Las Bielański odwiedził w sobotę wojewoda",
    // „Zamek Grodziecki kupił w 2020 r. inwestor") — para to dopełnienie, czyli nazwa obiektu.
    !RE_INVERTED_SUBJECT_ROLE.test(t.slice(offset + m.length, offset + m.length + 80).split(/[;!?\n]|\.(?![ \t]*\p{Ll})/u)[0])
  )
    return true;
  // nazwa święta albo imprezy, nie dyżur („21.06 Noc Świętojańska", „Noc Kupalna SOR")
  if (w1l !== 'noc' || NOC_EVENT_ADJ.has(w2.toLowerCase())) return false;
  const before = t.slice(Math.max(0, offset - 40), offset);
  return RE_SHIFT_LIST_BEFORE.test(before) || RE_DATE_LINE_HEAD_BEFORE.test(before) || RE_WARD_ABBR_AFTER.test(after);
}
// Rodzaj głów z PROPER_NAME_HEADS (pozostałe są męskie): przymiotnik-człon nazwy uzgadnia się z nim.
const PROPER_NAME_HEADS_FEM = new Set<string>(
  'bazylika katedra kaplica noc zatoka wyspa puszcza brama wieża bitwa wyżyna nizina kotlina pustynia'.split(' '),
);
const PROPER_NAME_HEADS_NEUT = new Set<string>('sanktuarium morze jezioro powstanie pojezierze'.split(' '));
/** Czy wyraz w mianowniku to przymiotnik uzgodniony z rodzajem głowy nazwy („Noc Świętojańska",
 *  „Kanał Sueski", „Jezioro Bielskie")? */
function headAgreesWithAdjective(head: string, w: string): boolean {
  if (PROPER_NAME_HEADS_FEM.has(head)) return /(?:sk|ck|dzk)a$/.test(w);
  if (PROPER_NAME_HEADS_NEUT.has(head)) return /(?:sk|ck|dzk)ie$/.test(w);
  return /(?:sk|ck|dzk)i$/.test(w);
}

/**
 * Wyrazy, które na początku zdania stoją z wielkiej litery przed nazwiskiem, a imieniem nie są:
 * przysłówki, spójniki, partykuły, przyimki („Wczoraj Kowalski przyszedł", „Jednak Lewandowski
 * odmówił") oraz rzeczowniki osobowe i techniczne spoza ROLE_WORDS („Sąsiad Kowalski", „Raport
 * Kowalski"). W mianownikowej gałęzi pary maskujemy wtedy SAMO nazwisko, a wyraz zostaje — wcześniej
 * znikał w masce jako „rzadkie imię". Rzadkich imion spoza słownika („Świętomira", „Bożydar") tu nie
 * ma, więc dalej znikają razem z nazwiskiem. Celowo bez „sam" (imię Sam).
 */
const NON_NAME_LEADERS = new Set<string>(
  (
    'wczoraj przedwczoraj dzisiaj dziś jutro wtedy wówczas potem następnie później wcześniej najpierw ' +
    'teraz obecnie niedawno tymczasem wreszcie ostatecznie dopiero zawsze nigdy często rano wieczorem ' +
    // pora i okres w grafiku czy notatce („Dzień Sosnowski", „Tydzień Gzowski – urlop"): imieniem
    // nie są, a przymiotnik z nazwy święta po nich jest na stopliście („Dzień Papieski")
    'dzień tydzień ' +
    'jednak natomiast ponadto również także też dlatego zatem więc bowiem ale lecz oraz albo lub czy ' +
    'nawet tylko jedynie właśnie już jeszcze chyba może niestety oczywiście tak nie zaś ' +
    'ten ta to każdy gdy kiedy jeśli jeżeli skoro choć chociaż ponieważ aby żeby że ' +
    'według przez dla przy wobec mimo oprócz dzięki od do za na po pod nad przed ' +
    'sąsiad sąsiadka lekarz lekarka ksiądz aspirant sierżant komisarz kapitan porucznik policjant ' +
    'funkcjonariusz strażnik nauczyciel nauczycielka student studentka obywatel obywatelka mieszkaniec ' +
    'mieszkanka lokator lokatorka petent petentka administrator operator technik ojciec matka brat ' +
    'siostra mąż żona syn córka kierowca kolega koleżanka dzielnicowy ' +
    'raport profil katalog folder plik rekord konto'
  ).split(/\s+/),
);
// Rzeczowniki osobowe i techniczne z NON_NAME_LEADERS. Po nich wyraz z wielkiej litery to nazwisko
// także przed nazwą instytucji („Lekarz Lisiecki Oddział Neurologii", „Kierowca Wąsowicz Zakład
// Transportu" — wiersz grafiku czy listy płac); strażnik „człon nazwy instytucji" („Odwiedziliśmy
// Biebrzański Park Narodowy") dotyczy tylko przysłówków, spójników i czasowników.
const NOUN_NAME_LEADERS = new Set<string>(
  (
    'sąsiad sąsiadka lekarz lekarka ksiądz aspirant sierżant komisarz kapitan porucznik policjant ' +
    'funkcjonariusz strażnik nauczyciel nauczycielka student studentka obywatel obywatelka mieszkaniec ' +
    'mieszkanka lokator lokatorka petent petentka administrator operator technik ojciec matka brat ' +
    'siostra mąż żona syn córka kierowca kolega koleżanka dzielnicowy ' +
    'raport profil katalog folder plik rekord konto'
  ).split(/\s+/),
);
// Czasownik w 1. osobie czasu przeszłego na początku zdania („Odwiedziliśmy", „Widziałem") —
// jak NON_NAME_LEADERS: nie imię.
const RE_VERB_1ST_PERSON = /(?:liśmy|łyśmy|liście|łyście|łem|łam|łeś|łaś)$/;
// Nazwa parku po przymiotniku („Słowiński Park Narodowy", „Wolińskiego Parku Narodowego") —
// przymiotnik to człon nazwy, nawet gdy bywa też nazwiskiem (słowiński, woliński, magurski).
const RE_FOLLOWED_BY_PARK = /^[ \t]+Park(?:u|iem|owi)?[ \t]+(?:Narodow|Krajobrazow)/;

/**
 * Polskie miejscowości WIELOWYRAZOWE (człony rozdzielone spacją) — używane WYŁĄCZNIE do
 * rozstrzygnięcia, ile słów za kodem pocztowym doklejać do maski miejscowości (krok 12c).
 * Miasta jednowyrazowe NIE muszą tu być — pierwszy wyraz po kodzie i tak jest maskowany
 * pozycyjnie. Nazwy z myślnikiem („Bielsko-Biała") to jeden token, więc też nie wymagają
 * wpisu — dodajemy jednak ich wariant zapisany spacją („bielsko biała"), bo bywa pisany
 * rozłącznie. Nietrafiona/brakująca pozycja degraduje łagodnie: maskujemy sam pierwszy
 * (główny) człon, a zostaje przymiotnik regionalny („[MIEJSCOWOŚĆ] Wielkopolski").
 */
const MULTIWORD_CITIES = new Set<string>(
  (
    'nowy sącz|nowy targ|nowy dwór mazowiecki|nowy dwór gdański|nowy wiśnicz|nowy żmigród|' +
    'nowe miasto lubawskie|nowe miasto nad pilicą|nowe miasto nad wartą|nowa sól|nowa ruda|' +
    'nowa dęba|nowa słupia|stary sącz|zielona góra|jelenia góra|kamienna góra|góra kalwaria|' +
    'góra śląska|dąbrowa górnicza|dąbrowa tarnowska|dąbrowa białostocka|ruda śląska|stalowa wola|' +
    'ostrów wielkopolski|ostrów mazowiecka|ostrowiec świętokrzyski|biała podlaska|biała rawska|' +
    'bielsko biała|wysokie mazowieckie|grodzisk mazowiecki|grodzisk wielkopolski|tomaszów mazowiecki|' +
    'tomaszów lubelski|piotrków trybunalski|rawa mazowiecka|sokołów podlaski|wodzisław śląski|' +
    'aleksandrów kujawski|aleksandrów łódzki|konstantynów łódzki|gorzów wielkopolski|górowo iławeckie|' +
    'szklarska poręba|bystrzyca kłodzka|nowogród bobrzański|maków mazowiecki|maków podhalański|' +
    'mińsk mazowiecki|kostrzyn nad odrą|miejska górka|tarnowskie góry|czerwionka leszczyny|' +
    'sępólno krajeńskie|solec kujawski|środa wielkopolska|środa śląska|oborniki śląskie|brzeg dolny|' +
    'skarżysko kamienna|murowana goślina|miasteczko śląskie|ożarów mazowiecki|kędzierzyn koźle|' +
    'duszniki zdrój|kudowa zdrój|polanica zdrój|lądek zdrój|busko zdrój|rabka zdrój|iwonicz zdrój|' +
    'konstancin jeziorna|jastrzębie zdrój|goczałkowice zdrój|połczyn zdrój|świeradów zdrój|' +
    // toponimy w kształcie „imię + przymiotnik" — bez wpisu para szła w kroku (a) jako osoba
    'kazimierz dolny|kazimierza wielka|' +
    // człon przymiotnikowy zostawał jawny za maską („55-080 [MIEJSCOWOŚĆ] Wrocławskie"), a nazwisko-
    // podobny („Zebrzydowska") dostawał maskę osoby
    'kąty wrocławskie|pruszcz gdański|kalisz pomorski|siemianowice śląskie|strzelce opolskie|' +
    'strzelce krajeńskie|zalesie górne|stare babice|żabia wola|wiązowna kościelna|kalwaria zebrzydowska|' +
    'biały dunajec|czarny dunajec|tarnowo podgórne|łomianki dolne|dobre miasto|zduńska wola|' +
    'nowe skalmierzyce|bielsk podlaski|sucha beskidzka|krosno odrzańskie|drawsko pomorskie|' +
    'kamień pomorski|radzyń podlaski|międzyrzec podlaski|opole lubelskie|ząbkowice śląskie|' +
    'stronie śląskie|nowy tomyśl|nowe warpno|stargard szczeciński|czechowice dziedzice|' +
    'jelcz laskowice|krynica zdrój|krynica morska|szczawno zdrój|piwniczna zdrój|trzcińsko zdrój|' +
    'ustrzyki dolne|mszana dolna|bukowina tatrzańska|janów lubelski|janów podlaski|sokołów małopolski|' +
    'rudnik nad sanem|krościenko nad dunajcem'
  ).split('|'),
);
/**
 * Miejscowniki nazw wielowyrazowych („zam. w Dąbrowie Górniczej", „ur. w Piotrkowie Trybunalskim").
 * POLISH_CITIES znało tylko pierwszy człon („dąbrowie"), więc przymiotnik zostawał jawny za maską,
 * a ten o końcówce nazwiskowej („Trybunalskim", „Tarnowskiej") dostawał maskę osoby.
 */
const MULTIWORD_CITIES_LOC = (
  'dąbrowie górniczej|dąbrowie tarnowskiej|dąbrowie białostockiej|rudzie śląskiej|stalowej woli|' +
  'piotrkowie trybunalskim|gorzowie wielkopolskim|ostrowie wielkopolskim|ostrowi mazowieckiej|' +
  'ostrowcu świętokrzyskim|tomaszowie mazowieckim|tomaszowie lubelskim|mińsku mazowieckim|' +
  'białej podlaskiej|białej rawskiej|nowym dworze mazowieckim|nowym dworze gdańskim|' +
  'grodzisku mazowieckim|grodzisku wielkopolskim|sokołowie podlaskim|wodzisławiu śląskim|' +
  'aleksandrowie kujawskim|aleksandrowie łódzkim|konstantynowie łódzkim|rawie mazowieckiej|' +
  'tarnowskich górach|środzie wielkopolskiej|środzie śląskiej|makowie mazowieckim|makowie podhalańskim|' +
  'wysokiem mazowieckiem|starym sączu|nowej soli|nowej rudzie|kamiennej górze|górze kalwarii|' +
  'kątach wrocławskich|pruszczu gdańskim|siemianowicach śląskich|strzelcach opolskich|' +
  'strzelcach krajeńskich|starych babicach|zduńskiej woli|tarnowie podgórnym|kalwarii zebrzydowskiej|' +
  'dobrym mieście|nowym mieście lubawskim|bielsku podlaskim|suchej beskidzkiej|krośnie odrzańskim|' +
  'drawsku pomorskim|kamieniu pomorskim|radzyniu podlaskim|międzyrzecu podlaskim|opolu lubelskim|' +
  'ząbkowicach śląskich|solcu kujawskim|skarżysku kamiennej|łomiankach dolnych|zalesiu górnym|' +
  'białym dunajcu|nowym tomyślu|czechowicach dziedzicach|stargardzie szczecińskim|sępólnie krajeńskim|' +
  'ożarowie mazowieckim|obornikach śląskich|brzegu dolnym|bystrzycy kłodzkiej|szklarskiej porębie|' +
  'murowanej goślinie'
).split('|');

/**
 * Słownik polskich MIAST (mianownik + częste formy zależne dużych miast) — używany WYŁĄCZNIE
 * do rozpoznania miejscowości stojącej PRZED adresem BEZ kodu pocztowego („Warszawa, ul. …",
 * „w Poznaniu, ul. …"), krok 12d. Kotwicą jest wtedy sam wskaźnik adresu (nie kod), więc bez
 * słownika nie odróżnilibyśmy miasta od ogona nazwy instytucji („Zarząd Dróg Miejskich, ul. …").
 * Słownik NIE działa w wolnym tekście — tylko w pozycji „…, ul./[ADRES]" — więc „mieszka w
 * Warszawie" pozostaje nietknięte (zero nadmaskowania). Krótkie, wieloznaczne nazwy (Biała,
 * Wola, Góra, Nowe) celowo POMINIĘTE jako samodzielne — łapiemy je tylko w formie wielowyrazowej.
 */
const POLISH_CITIES = new Set<string>([
  ...MULTIWORD_CITIES,
  ...MULTIWORD_CITIES_LOC,
  ...(
    // mianownik — miasta wojewódzkie, na prawach powiatu i większe ośrodki
    'warszawa|kraków|łódź|wrocław|poznań|gdańsk|szczecin|bydgoszcz|lublin|białystok|katowice|' +
    'gdynia|częstochowa|radom|sosnowiec|toruń|kielce|rzeszów|gliwice|zabrze|olsztyn|bytom|rybnik|' +
    'opole|tychy|elbląg|płock|wałbrzych|włocławek|tarnów|chorzów|koszalin|kalisz|legnica|grudziądz|' +
    'słupsk|jaworzno|konin|piła|inowrocław|lubin|suwałki|stargard|gniezno|głogów|pabianice|leszno|' +
    'żory|zamość|pruszków|łomża|ełk|chełm|mielec|przemyśl|tczew|bełchatów|świdnica|będzin|zgierz|' +
    'racibórz|legionowo|ostrołęka|świętochłowice|zawiercie|starachowice|wejherowo|skierniewice|' +
    'świnoujście|puławy|tarnobrzeg|kutno|nysa|ciechanów|sopot|sieradz|radomsko|kołobrzeg|szczecinek|' +
    'otwock|świdnik|bochnia|oświęcim|krosno|sanok|cieszyn|dębica|jarosław|luboń|malbork|żyrardów|' +
    'kwidzyn|oleśnica|chrzanów|jasło|brodnica|kraśnik|wągrowiec|giżycko|sochaczew|olkusz|świebodzice|' +
    'augustów|brzeg|andrychów|wyszków|bartoszyce|mława|kętrzyn|nakło|turek|świecie|oława|krotoszyn|' +
    'kościan|gostyń|jarocin|śrem|trzebnica|bolesławiec|zgorzelec|lubań|dzierżoniów|kluczbork|brzesko|' +
    'wieliczka|myślenice|gorlice|limanowa|zakopane|trzebinia|libiąż|wadowice|żywiec|pszczyna|mikołów|' +
    'lubliniec|knurów|pyskowice|nowogard|police|goleniów|gryfino|choszczno|wałcz|złotów|chodzież|' +
    'oborniki|wolsztyn|września|środa|krapkowice|kędzierzyn|namysłów|prudnik|strzelce|ozimek|' +
    // miasta z myślnikiem (jeden token — słownik musi mieć formę z myślnikiem)
    'bielsko-biała|kędzierzyn-koźle|jastrzębie-zdrój|skarżysko-kamienna|konstancin-jeziorna|' +
    'kudowa-zdrój|polanica-zdrój|duszniki-zdrój|lądek-zdrój|busko-zdrój|rabka-zdrój|iwonicz-zdrój|' +
    'świeradów-zdrój|połczyn-zdrój|goczałkowice-zdrój|' +
    // formy zależne miast z myślnikiem („ur. w Bielsku-Białej", „zam. w Jastrzębiu-Zdroju")
    'bielsku-białej|bielska-białej|kędzierzynie-koźlu|kędzierzyna-koźla|jastrzębiu-zdroju|' +
    'skarżysku-kamiennej|konstancinie-jeziornie|' +
    // częste formy zależne dużych miast (pozycja „w <mieście>, ul. …")
    'warszawie|warszawy|krakowie|krakowa|łodzi|wrocławiu|wrocławia|poznaniu|poznania|gdańsku|gdańska|' +
    'szczecinie|bydgoszczy|lublinie|lublina|katowicach|gdyni|częstochowie|radomiu|radomia|sosnowcu|' +
    'toruniu|torunia|kielcach|rzeszowie|olsztynie|opolu|płocku|tarnowie|koszalinie|kaliszu|legnicy|' +
    'słupsku|zamościu|chełmie|elblągu|gliwicach|bytomiu|rybniku|' +
    // miejscownik częstych średnich miast (pozycja „zamieszkały/mieszka w <mieście>")
    'sopocie|gnieźnie|inowrocławiu|koninie|głogowie|lesznie|ełku|mielcu|tczewie|będzinie|zgierzu|' +
    'raciborzu|zawierciu|wejherowie|świnoujściu|puławach|kutnie|nysie|ciechanowie|sieradzu|kołobrzegu|' +
    'otwocku|oświęcimiu|krośnie|sanoku|cieszynie|jarosławiu|zakopanem|żywcu|wieliczce|wadowicach|' +
    'pszczynie|mikołowie|jaworznie|dąbrowie|chorzowie|zabrzu|jastrzębiu|tychach|wałbrzychu|włocławku|' +
    'grudziądzu|jeleniej górze|zielonej górze|nowym sączu|nowym targu|nowym dworze|gorzowie|' +
    'stargardzie|świdnicy|piotrkowie|ostrowie|suwałkach|starachowicach|skierniewicach|tarnobrzegu|' +
    // Białystok był jedynym miastem wojewódzkim bez formy zależnej, Siedlce — nawet bez mianownika
    // („zam. w Białymstoku", „ur. w Siedlcach")
    'białymstoku|białegostoku|pruszkowie|pruszkowa|legionowie|legionowa|siedlce|siedlcach|siedlec|' +
    // formy zależne toponimów „imię + przymiotnik" (BEZ „kazimierza wielkiego" — król i patron ulic)
    'kazimierzu dolnym|kazimierza dolnego|kazimierzem dolnym|kazimierzy wielkiej'
  ).split('|'),
]);

// Częste OBCE imiona — bramka dla reguły imion dwuczłonowych z myślnikiem („Jean-Pierre
// Dubois"). Bez tej bramki każda para „Xxx-Yyy Zzz" (miasta spoza słownika, nazwy firm)
// stawałaby się osobą. Wyłącznie imiona praktycznie niewystępujące jako polskie toponimy.
const FOREIGN_GIVEN_NAMES = new Set<string>(
  (
    'jean pierre paul marie anne claude luc marc jacques michel andre andré louis henri ' +
    'francois françois rené rene yves hans karl heinz klaus peter ernst fritz dieter uwe ' +
    'kurt otto rolf wolf horst jurgen jürgen john james david michael mary sarah kevin ' +
    'jose josé juan carlos luis pedro miguel diego pablo ana maria luigi giovanni marco ' +
    'ali ahmed mohamed muhammad omar hassan ibrahim mustafa abdul kim lee chen wang li ' +
    'minh thi anh van duc thu erik lars sven nils per ola'
  ).split(/\s+/),
);

// Rdzenie imion (mianownik bez końcowego „a" dla imion żeńskich) — do rozpoznawania
// form ODMIENIONYCH: „Anną", „Annę", „Janem", „Aleksandrą". Słownik ma tylko mianownik,
// więc bez tego imię w odmianie wyciekało obok zamaskowanego nazwiska.
const FIRST_NAME_STEMS = new Set<string>(
  [...POLISH_FIRST_NAMES].map((n) => (n.endsWith('a') ? n.slice(0, -1) : n)),
);
// UWAGA: BEZ pustego sufiksu '' — mianownik pokrywa POLISH_FIRST_NAMES.has(w), a '' uznawałoby
// rdzeń (np. „maj" z „Maja") za imię → fałszywe trafienia („Pierwszego Maja"). Tylko formy odmienione.
const NAME_INFLECTIONS = ['a', 'i', 'y', 'ie', 'ę', 'ą', 'o', 'u', 'e', 'em', 'owi'];

// Formy odmiany, których rdzeń + końcówka nie odtwarza: ruchome „e" („Marek" → Marka, Markiem;
// „Paweł" → Pawła, Pawłem; „Stasiek" → Staśka), „-iem" po k/g („Henrykiem", „Dominikiem"), odmiana
// przymiotnikowa („Jerzego", „Antoniemu", „Ignacym"), zdrobnienia z końcówką zerową („Kasi",
// „Jadzi"), „-ś" („Jasia", „Stasiem") i oboczności żeńskie („Agacie", „Monice", „Jadwidze",
// „Barbarze", „Jagodzie"). Bez nich imię w zależnym przypadku zostawało jawne obok maski
// nazwiska („z powództwa Pawła [..] przeciwko Agacie [..]").
// Formy, które są też słowem pospolitym („marka", „ani", „arka", „witka"), są osobno: imieniem
// są tylko tuż przed potwierdzonym nazwiskiem (patrz COLLIDING_NAME_FORMS w passPersonPairs).
// „Franek" i „Walek" bez ruchomego „e": „franka", „walka" to waluta i walka.
const COLLIDING_NAME_FORMS = new Set<string>('marka ani arka witka antonim dance'.split(' '));
const EXTRA_NAME_FORMS = ((): Set<string> => {
  const out = new Set<string>();
  const add = (...fs: string[]) => {
    for (const f of fs) if (!COLLIDING_NAME_FORMS.has(f) && !POLISH_FIRST_NAMES.has(f)) out.add(f);
  };
  const soft: Record<string, string> = { si: 'ś', zi: 'ź', ci: 'ć', ni: 'ń' };
  for (const n of POLISH_FIRST_NAMES) {
    if (!/^[a-ząćęłńóśźż]{3,}$/.test(n)) continue;
    if (n.endsWith('ek') && n.length >= 5 && n !== 'franek' && n !== 'walek') {
      const s = n.slice(0, -2).replace(/(si|zi|ci|ni)$/, (x) => soft[x]) + 'k';
      add(`${s}a`, `${s}owi`, `${s}iem`);
    } else if (n.endsWith('eł')) {
      const s = `${n.slice(0, -2)}ł`;
      add(`${s}a`, `${s}owi`, `${s}em`, `${n.slice(0, -2)}le`);
    } else if (/[kg]$/.test(n)) {
      add(`${n}iem`);
    } else if (n.endsWith('ś')) {
      const s = `${n.slice(0, -1)}si`;
      add(`${s}a`, `${s}owi`, `${s}em`);
    } else if (/(?:si|zi|ci|ni)a$/.test(n)) {
      add(n.slice(0, -1));
    } else if (/ta$/.test(n)) add(`${n.slice(0, -2)}cie`);
    else if (/ka$/.test(n)) add(`${n.slice(0, -2)}ce`);
    else if (/ga$/.test(n)) add(`${n.slice(0, -2)}dze`);
    else if (/ra$/.test(n)) add(`${n.slice(0, -2)}rze`);
    else if (/da$/.test(n)) add(`${n.slice(0, -2)}dzie`);
  }
  for (const n of ['jerzy', 'ignacy', 'konstanty', 'dionizy', 'ksawery', 'walenty', 'alojzy']) {
    const s = n.slice(0, -1);
    add(`${s}ego`, `${s}emu`, `${s}ym`);
  }
  for (const n of ['antoni', 'jeremi', 'marceli']) add(`${n}ego`, `${n}emu`, `${n}m`);
  return out;
})();

// Imiona zapisane bez polskich znaków („Pawel", „Michal", „Lukaszem", „MALGORZATA") — czat, SMS,
// systemy bez ogonków i OCR. Złożenie tylko dla słowa w całości ASCII, a pomijamy imiona, których
// zapis bez ogonków jest zwykłym słowem („róża" → roza, „kaśka" → kaska, „Kaski ochronne",
// „żaklina" → zaklina) oraz formy-słowa („Stasi" — archiwum, „Rafale" — samoloty).
const FOLD_SKIP = new Set<string>('róża kaśka żaklina'.split(' '));
const FOLD_FORM_STOP = new Set<string>('stasi rafale'.split(' '));
const hasPlDiacritic = (s: string): boolean => /[ąćęłńóśźż]/.test(s);
const FOLDED_FIRST_NAMES = new Set<string>(
  [...POLISH_FIRST_NAMES, ...EXTRA_NAME_FORMS]
    .filter((n) => hasPlDiacritic(n) && ![...FOLD_SKIP].some((x) => n.startsWith(x.slice(0, -1))))
    .map(foldAscii)
    .filter((f) => !FOLD_FORM_STOP.has(f)),
);
const FOLDED_FIRST_NAME_STEMS = new Set<string>(
  [...POLISH_FIRST_NAMES]
    .filter((n) => hasPlDiacritic(n) && !FOLD_SKIP.has(n))
    .map((n) => foldAscii(n.endsWith('a') ? n.slice(0, -1) : n)),
);
const FOLDED_INFLECTIONS = ['a', 'i', 'y', 'ie', 'e', 'o', 'u', 'em', 'owi'];

/** Czy słowo wygląda na polskie imię (mianownik ZE SŁOWNIKA lub jego forma odmieniona)? */
function isFirstNameLike(word: string): boolean {
  const w = word.toLowerCase();
  if (POLISH_FIRST_NAMES.has(w) || EXTRA_NAME_FORMS.has(w)) return true;
  for (const suf of NAME_INFLECTIONS) {
    const stem = suf ? w.slice(0, -suf.length) : w;
    if (stem.length >= 2 && w.endsWith(suf) && FIRST_NAME_STEMS.has(stem)) return true;
  }
  if (!/^[a-z]{3,}$/.test(w) || FOLD_FORM_STOP.has(w)) return false;
  if (FOLDED_FIRST_NAMES.has(w)) return true;
  for (const suf of FOLDED_INFLECTIONS) {
    const stem = w.slice(0, -suf.length);
    if (stem.length >= 2 && w.endsWith(suf) && FOLDED_FIRST_NAME_STEMS.has(stem)) return true;
  }
  return false;
}

// ── URL: ochrona + maskowanie WEWNĄTRZ ────────────────────────────────────────
// E-mail — wzorzec współdzielony przez krok 1 i maskowanie wewnątrz URL-i.
// Część lokalna i domena DOPUSZCZAJĄ polskie litery (ąćęłńóśźż…): adres „piotr.wiśniewski@…" musi
// zostać zamaskowany W CAŁOŚCI. Bez tego klasa ASCII zatrzymywała się na „ś" i zostawiała jawny
// fragment nazwiska („piotr.wiś") przed [EMAIL] — wyciek (patrz „maskuj całość, nie fragment").
const RE_EMAIL = /[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+@[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}/g;
// E-mail zakodowany jak w URL-u („%40" zamiast „@"). Bywa też POZA adresem ze schematem: ścieżka
// względna w logu dostępowym („GET /api?email=jan%40x.pl"), ciało formularza, URL z ukośnikami
// ucieczonymi przez json_encode („https:\/\/…") — dlatego passEmail stosuje go także globalnie.
const RE_EMAIL_URLENC = /[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+%40[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}/g;
// WYDAJNOŚĆ: RE_EMAIL puszczony wprost po tekście jest KWADRATOWY — w długim ciągu znaków
// części lokalnej bez „@" (100 tys. liter, cyfr, „Ż", „a.a.a…") każda pozycja startowa skanuje
// ciąg do końca (5–15 s, karta przeglądarki zamarza). Najpierw szukamy więc ŁAŃCUCHA adresów
// zaczynającego się na POCZĄTKU ciągu znaków lokalnych (lookbehind: start w środku ciągu
// odpada), a dopiero wewnątrz znalezionego fragmentu stosujemy RE_EMAIL. Wynik jest identyczny
// z RE_EMAIL po całym tekście: dopasowanie startujące w środku ciągu zawsze da się przedłużyć
// w lewo do jego początku, a sklejone adresy („a@b.pl.c@d.pl") obejmuje powtórzenie grupy.
const RE_EMAIL_CHAIN =
  /(?<![A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-])(?:[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+@[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,})+/g;
const RE_EMAIL_URLENC_CHAIN =
  /(?<![A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-])(?:[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+%40[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,})+/g;
/** Maskuje e-maile w czasie liniowym: łańcuch → RE_EMAIL wewnątrz (patrz RE_EMAIL_CHAIN). */
function replaceEmails(s: string, chain: RegExp, single: RegExp, mask: (m: string) => string): string {
  return s.replace(chain, (m) => m.replace(single, mask));
}
/**
 * Parametry query URL-a o kluczach OSOBOWYCH — klucz to mocna kotwica, maskujemy samą
 * wartość wg typu (?user=[LOGIN]&email=[EMAIL]), struktura URL-a zostaje. Klasa wartości
 * wyklucza „[" — placeholder z poprzedniego przebiegu nie jest ponownie maskowany.
 */
// Prefiks klucza obejmuje też „#" — parametry bywają we FRAGMENCIE URL-a (OAuth implicit
// flow: „callback#access_token=…"), który wcześniej wyciekał.
const URL_PARAM_RULES: Array<{ re: RegExp; type: PiiType }> = [
  { re: /([?&#](?:user(?:name|id)?|login|usr|uid)=)([^&#\s\[\]]+)/gi, type: 'LOGIN' },
  { re: /([?&#](?:e-?mail|mail)=)([^&#\s\[\]]+)/gi, type: 'EMAIL' },
  { re: /([?&#](?:full_?name|first_?name|last_?name|name|imie|nazwisko|osoba)=)([^&#\s\[\]]+)/gi, type: 'IMIE' },
  { re: /([?&#](?:phone|tel(?:efon)?|mobile|msisdn)=)([^&#\s\[\]]+)/gi, type: 'TELEFON' },
  { re: /([?&#]pesel=)(\d+)/gi, type: 'PESEL' },
  { re: /([?&#](?:card(?:number|no)?|karta|nr_?karty|numer_?karty)=)([^&#\s\[\]]+)/gi, type: 'KARTA' },
  { re: /([?&#](?:token|api_?key|secret|auth|access_?token)=)([^&#\s\[\]]+)/gi, type: 'TOKEN' },
  { re: /([?&#](?:ksef(?:_?number)?|nr_?ksef|numer_?ksef)=)([^&#\s\[\]]+)/gi, type: 'KSEF' },
];
/**
 * Segmenty ścieżki, które z samej budowy adresu są identyfikatorem osoby: profil LinkedIn
 * („/in/joanna-pietrzak-hr", „/pub/joanna-pietrzak/12/345/678"), osobisty OneDrive
 * („firma-my.sharepoint.com/personal/jan_kowalski_firma_pl" — to zawsze UPN użytkownika)
 * i numeryczny profil Facebooka („profile.php?id=…"). Strony firm, szkół i ofert
 * („/company/", „/school/", „/jobs/") oraz witryny zespołów („firma.sharepoint.com/sites/")
 * mają inną ścieżkę i zostają. Gołe „github.com/x", „facebook.com/x" — bez reguły: tam ten sam
 * kształt ma organizacja, projekt i podstrona serwisu.
 */
const URL_PROFILE_PATH_RULES: RegExp[] = [
  /(\blinkedin\.com\/(?:in|pub)\/)([^/?#\s[\]]+(?:\/[0-9a-z]{1,3}(?=[/?#]|$)){0,3})/gi,
  /(-my\.sharepoint\.com\/personal\/)([^/?#\s[\]]+)/gi,
  /(\bfacebook\.com\/profile\.php\?(?:[^#\s]*?&)?id=)(\d+)/gi,
];

// ── Klucze strukturalne XML/JSON ──────────────────────────────────────────────
// Tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna jak etykieta formularza —
// maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Klucz normalizujemy (lowercase, bez odstępów i ._-), więc „first_name"/„FirstName"/„first name"
// to jeden wpis — dawniej spacja zostawała w kluczu i „"Data urodzenia"" nie trafiało w słownik.
type StructKind =
  | 'first' | 'surname' | 'fullname' | 'name' | 'person' | 'phone' | 'email' | 'addr'
  | 'city' | 'postal' | 'birth' | 'login' | 'pesel' | 'nip' | 'regon'
  | 'passport' | 'idcard' | 'krs' | 'license' | 'plate' | 'account';
const STRUCT_KEYS = new Map<string, StructKind>(Object.entries({
  imie: 'first', imię: 'first', imiona: 'first', firstname: 'first', givenname: 'first', middlename: 'first',
  // pola e-Deklaracji, JPK i ZUS („<ImiePierwsze>", „imie_ojca") oraz ich odpowiedniki z formularzy
  imiepierwsze: 'first', imiępierwsze: 'first', pierwszeimie: 'first', pierwszeimię: 'first',
  imiedrugie: 'first', imiędrugie: 'first', drugieimie: 'first', drugieimię: 'first',
  imieojca: 'first', imięojca: 'first', imiematki: 'first', imięmatki: 'first',
  fathername: 'first', fathersname: 'first', mothername: 'first', mothersname: 'first',
  nazwisko: 'surname', surname: 'surname', lastname: 'surname', familyname: 'surname',
  nazwiskorodowe: 'surname', nazwiskopanienskie: 'surname', nazwiskopanieńskie: 'surname',
  maidenname: 'surname', mothersmaidenname: 'surname', nazwiskorodowematki: 'surname',
  fullname: 'fullname', imienazwisko: 'fullname', imięnazwisko: 'fullname',
  // nagłówki kolumn tabeli („Imię i nazwisko;PESEL", „Nazwisko i imię\tStanowisko")
  imieinazwisko: 'fullname', imięinazwisko: 'fullname', nazwiskoiimie: 'fullname', nazwiskoiimię: 'fullname',
  // „osoba"/„person" bywa kategorią („<osoba>prawna</osoba>", „"person": "fizyczna"") — bramka jak dla „name"
  osoba: 'person', person: 'person',
  name: 'name', // generyczne — bramka słownikowa (bywa nazwą produktu/firmy, nie osoby)
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', tel: 'phone', telefon: 'phone', telephone: 'phone', fax: 'phone',
  email: 'email', mail: 'email',
  street: 'addr', address: 'addr', addressline: 'addr', ulica: 'addr', adres: 'addr',
  streetaddress: 'addr', adresl1: 'addr', nrdomu: 'addr', nrlokalu: 'addr', numerdomu: 'addr', numerlokalu: 'addr',
  city: 'city', town: 'city', miasto: 'city', miejscowosc: 'city', miejscowość: 'city',
  miejsceurodzenia: 'city', placeofbirth: 'city', birthplace: 'city',
  postalcode: 'postal', postcode: 'postal', zipcode: 'postal', zip: 'postal', kodpocztowy: 'postal',
  birthdate: 'birth', dateofbirth: 'birth', dob: 'birth', dataurodzenia: 'birth',
  login: 'login', username: 'login', user: 'login', userid: 'login',
  // Active Directory i dziennik zdarzeń Windows („"sAMAccountName"", „<Data Name="TargetUserName">")
  samaccountname: 'login', targetusername: 'login', subjectusername: 'login',
  pesel: 'pesel', nrpesel: 'pesel', numerpesel: 'pesel', nip: 'nip', regon: 'regon',
  // Dokumenty i rejestry: w prozie „paszport: EA1234567" jest maskowany, a pod kluczem
  // („"paszport": "EA1234567"", „<KRS>…</KRS>") wyciekał — separator przebiegów prozy nie zna
  // cudzysłowu ani „>". Bez kluczy ogólnych („id", „number", „license" — licencja programu,
  // „registrationNumber" — rejestr handlowy, „plate"/„tablica" — talerz, tablica ogłoszeń).
  paszport: 'passport', nrpaszportu: 'passport', numerpaszportu: 'passport', passport: 'passport',
  passportno: 'passport', passportnumber: 'passport',
  dowod: 'idcard', dowód: 'idcard', dowodosobisty: 'idcard', dowódosobisty: 'idcard', nrdowodu: 'idcard',
  numerdowodu: 'idcard', idcard: 'idcard', idcardnumber: 'idcard',
  krs: 'krs', nrkrs: 'krs', numerkrs: 'krs',
  prawojazdy: 'license', nrprawajazdy: 'license', numerprawajazdy: 'license', driverlicense: 'license',
  driverslicense: 'license', drivinglicense: 'license', drivinglicence: 'license',
  // Goły „nrRej"/„nr_rej" osobno, w structKindOf (patrz RE_PLATE_STRICT).
  nrrejestracyjny: 'plate', numerrejestracyjny: 'plate', nrrejestracyjnypojazdu: 'plate',
  tablicarejestracyjna: 'plate', nrtablicy: 'plate', numertablicy: 'plate', licenseplate: 'plate',
  platenumber: 'plate', registrationplate: 'plate', vehicleplate: 'plate',
  iban: 'account', nrb: 'account', nrrb: 'account', konto: 'account', nrkonta: 'account', numerkonta: 'account',
  rachunek: 'account', nrrachunku: 'account', numerrachunku: 'account', rachunekbankowy: 'account',
  bankaccount: 'account', accountnumber: 'account',
  // Numeru KSeF NIE ma na tej liście celowo: nazwa tagu/klucza („<NrKSeF>", „ksefNumber") sama
  // zawiera słowo „KSeF", więc kotwica dokumentowa passKsef i tak zadziała — bez dublowania reguł.
} as Record<string, StructKind>));
const STRUCT_KIND_TYPE: Record<StructKind, PiiType> = {
  first: 'IMIE', surname: 'IMIE', fullname: 'IMIE', name: 'IMIE', person: 'IMIE', phone: 'TELEFON',
  email: 'EMAIL', addr: 'ADRES', city: 'MIEJSCOWOSC', postal: 'KOD-POCZTOWY',
  birth: 'DATA-UR', login: 'LOGIN', pesel: 'PESEL', nip: 'NIP', regon: 'REGON',
  passport: 'PASZPORT', idcard: 'DOWOD', krs: 'KRS', license: 'PRAWO-JAZDY', plate: 'NR-REJESTRACYJNY',
  account: 'NR-KONTA',
};
const normStructKey = (k: string): string => k.toLowerCase().replace(/[\s._-]/g, '');
// Klucze telefonu złożone z kwalifikatorem („nrTelefonu", „telefonDomowy", „mobilePhone", „phone2")
// — zamknięta lista całego klucza, nie podciąg: „phoneVerifiedAt", „telemetryId", „TelefonId",
// „phoneCountryCode" czy „phonesTotal" to nie numer.
const RE_PHONE_STRUCT_KEY =
  /^(?:nr|numer|no|num|kontakt(?:owy)?|home|work|private|business|contact)?(?:tel|telefon[uy]?|telephone|phone(?:number)?|mobile(?:phone)?|cell(?:phone)?|kom[oó]rk[aiy]|kom[oó]rkowy|fax|faks)(?:domowy|kom[oó]rkowy|kontaktowy|s[lł]u[zż]bowy|stacjonarny|prywatny|home|work|mobile|number|nr|\d)?$/;
// Numer porządkowy na końcu klucza („addressLine1", „street1", „city2", „firstName1") — tylko dla
// rodzajów, których wartość i tak przechodzi bramkę kształtu; „user1"/„name1" bywają czymkolwiek.
const STRUCT_NUMBERED_OK = new Set<StructKind>(['addr', 'city', 'postal', 'first', 'surname', 'phone', 'email']);
// Druga linia adresu z kodem i miejscowością („"addressLine2": "43-300 Bielsko-Biała"") — kod
// i miasto mają własne przebiegi i maski; jako [ADRES] tracilibyśmy podział na pola.
const RE_POSTAL_LEAD = /^\d{2}-\d{3}(?!\d)/;
// Pełny kształt polskiej tablicy: dwuliterowy wyróżnik z pięcioma znakami, trzyliterowy z czterema
// albo pięcioma. Pod gołym „nrRej"/„nr_rej" bywa też numer w rejestrze umów („UM 1234", „ZP 2026"
// w otwartych danych z BIP), więc tam wartość musi mieć ten kształt; „"nr_rej": "WE 12345"" przy
// „"marka": "Opel"" to dalej tablica.
const RE_PLATE_STRICT = /^(?:[A-Z]{2}[\s-]?(?=[A-Z0-9]{0,4}\d)[A-Z0-9]{5}|[A-Z]{3}[\s-]?(?=[A-Z0-9]{0,3}\d)[A-Z0-9]{4,5})$/;
function structKindOf(key: string, value: string): StructKind | undefined {
  const norm = normStructKey(key);
  const kind = STRUCT_KEYS.get(norm);
  if (kind) return kind;
  if (norm === 'nrrej') return RE_PLATE_STRICT.test(value.trim()) ? 'plate' : undefined;
  if (RE_PHONE_STRUCT_KEY.test(norm)) {
    // Sama „komórka" w eksportach kadrowych i ePUAP to komórka organizacyjna z kodem („"komorka":
    // "120400"", „<Komorka>01-02-03</Komorka>") — telefon tylko z pełnym numerem (co najmniej 9 cyfr).
    if (/kom[oó]rk[aiy]\d?$/.test(norm) && (value.match(/\d/g) ?? []).length < 9) return undefined;
    return 'phone';
  }
  const base = norm.replace(/(?<=\p{L})\d{1,2}$/u, '');
  if (base === norm) return undefined;
  const k2 = STRUCT_KEYS.get(base);
  if (!k2 || !STRUCT_NUMBERED_OK.has(k2)) return undefined;
  // Kolejna linia adresu bez cyfry to zwykle kraj albo region („"addressLine2": "Polska"") — numer
  // domu albo lokalu musi w niej stać, a kod z miejscowością mają własne przebiegi.
  return k2 === 'addr' && (RE_POSTAL_LEAD.test(value.trim()) || !/\d/.test(value)) ? undefined : k2;
}

// ── NUMER KSeF (Krajowy System e-Faktur) ──────────────────────────────────────
// Budowa: NIP wystawcy + data przyjęcia + 12 znaków technicznych + suma kontrolna, np.
// „5265877635-20250826-0100001AF629-AF" (35 znaków). KSeF 1.0 nadawał wariant 36-znakowy
// z częścią techniczną rozbitą na 6+6 („7781464139-20230721-80B510-9675F7-B5") — oba są
// w obiegu (numery starych faktur nie znikają), więc oba maskujemy. Schemat FA(3) dopuszcza
// w pierwszym członie także „M" + 9 cyfr oraz 3 litery + 7 cyfr (podmioty bez NIP).
//
// SUMY KONTROLNEJ NIE WALIDUJEMY: to CRC-8 (poly 0x07, init 0x00) liczone po znakach części
// danych — zgadza się dla numerów z KSeF 2.0, ale numerów z KSeF 1.0 NIE przechodzi (znane
// rozbieżności w repozytoriach MF). Twardy warunek odrzucałby prawdziwe numery, czyli wyciek.
// Zamiast sumy wymagamy KOTWICY „KSeF" — bez niej nie maskujemy (precyzja > nadmaskowanie).
//
// Separator to WYŁĄCZNIE myślnik (też półpauza/pauza/dywiz miękki), z dopuszczalnym złamaniem
// wiersza i cienką spacją wokół — numer bywa łamany w wąskiej kolumnie i autokorygowany przez
// edytor. SAMA SPACJA jako separator jest ODRZUCONA: audyt adwersarialny pokazał, że wzorzec
// „10 cyfr · 8 cyfr · 12 znaków · 2 znaki" rozdzielony spacjami zjada cztery sąsiednie KOLUMNY
// liczb w raporcie („KSeF 5265877635 20250826 000000012345 23") — to nadmaskowanie.
// Złamanie wiersza dopuszczamy TYLKO PO myślniku (tak łamie edytor i PDF: dywiz zostaje na końcu
// linii). Newline PRZED myślnikiem odpada, bo scalałby listę punktowaną „- 5265877635\n- 20250826…"
// w jeden numer — kolejny wariant nadmaskowania z audytu.
// Wokół myślnika NIE MA spacji: dopuszczenie ich scalało kolumny zestawienia rozdzielone „ - "
// („5265877635 - 20250826 - 145000 - 118700 - 23") w jeden numer. Dozwolone jest tylko złamanie
// wiersza PO myślniku (z wcięciem kolejnej linii) — tak numer łamie edytor i PDF.
// Miękki dywiz (U+00AD) NIE jest separatorem: w realnym tekście pada WEWNĄTRZ członu (artefakt
// łamania wyrazu), a w klasie separatora otwierał kształt „ciąg cyfr bez widocznego myślnika".
const KSEF_SEP = '[-\\u2010-\\u2015](?:[ \\t]*\\r?\\n[ \\t\\u00A0\\u2009\\u202F]*)?';
// Wariant pierwszego członu „3 litery + 7 cyfr" (dopuszczony w XSD FA(3), w praktyce niespotykany)
// jest CELOWO pominięty: łapał numery inwentarzowe, seryjne, partii i wydań („SRV2026001-20260108-
// 000000004512-03") w dokumentach, w których słowo „KSeF" pada przy okazji. Data jest walidowana
// zakresowo (rok 20xx, miesiąc 01–12, dzień 01–31), a NIP w pierwszym członie — sumą kontrolną
// (patrz passKsef): przy kotwicie dokumentowej sam kształt to za mało.
const KSEF_HEAD = '(?:\\d{10}|[Mm]\\d{9})';
const KSEF_DATE = '20\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])';
const KSEF_VALUE =
  `${KSEF_HEAD}${KSEF_SEP}${KSEF_DATE}${KSEF_SEP}` +
  `(?:[0-9A-Fa-f]{6}${KSEF_SEP}[0-9A-Fa-f]{6}|[0-9A-Fa-f]{12})${KSEF_SEP}[0-9A-Fa-f]{2}`;
/**
 * KOTWICA DOKUMENTOWA. Numer maskujemy tylko wtedy, gdy w tekście W OGÓLE pada „KSeF" (albo
 * rozwinięta nazwa systemu) — kotwica sąsiedzka zawodziła w realnych pismach: etykieta bywa
 * w nagłówku kolumny tabeli, po numerze („…-AF — to numer KSeF"), w znacznikach („**Nr KSeF:**",
 * „<td>Nr KSeF</td>"), a pod jedną etykietą stoi wyliczenie kilku numerów. Kształt numeru jest
 * na tyle sztywny (NIP + data + 12 znaków hex + suma), że w dokumencie mówiącym o KSeF nie ma
 * czego innego pomylić — numer referencyjny sesji zaczyna się od DATY, nie od NIP-u.
 */
const RE_KSEF_ANCHOR = /ksef|krajow\w*\s+system\w*\s+e[-‐-―]?faktur/i;
// Granice BEZ myślnika: numer bywa doklejony myślnikiem do etykiety („Nr KSeF-5265877635-…"),
// nazwy pliku („faktura-5265877635-…-AF.xml") czy segmentu ścieżki — wtedy zakaz myślnika
// z boku zostawiał jawny NIP. Dłuższy identyfikator zawierający kształt numeru KSeF i tak
// niesie NIP wystawcy, więc maskujemy.
const RE_KSEF_VALUE = new RegExp(`(?<![0-9A-Za-z])${KSEF_VALUE}(?![0-9A-Za-z])`, 'g');

/** Kotwica liczona na ORYGINALNYM wejściu: „ksef.mf.gov.pl" w linku albo „ksef@mf.gov.pl"
 *  w stopce bywa jedyną wzmianką o systemie, a wcześniejsze przebiegi już je skasowały. */
function hasKsefAnchor(ctx: RedactCtx): boolean {
  return RE_KSEF_ANCHOR.test(ctx.raw);
}

/**
 * Maskuje dopasowanie TYLKO wtedy, gdy pierwszy człon jest poprawnym NIP-em. Kotwica jest
 * dokumentowa (słabsza niż etykieta tuż przy numerze), więc sumę kontrolną NIP-u traktujemy jako
 * drugą warstwę: bez niej numery zamówień i identyfikatory korelacji o tym samym kształcie
 * („4500123456-20260115-000000012345-01") znikały w dokumentach wspominających KSeF.
 * Wariant „M" + 9 cyfr (podmiot bez NIP wg FA(3)) sumy nie ma — tam decyduje sam kształt.
 */
function maskKsefMatch(ctx: RedactCtx) {
  return (m: string): string => {
    const head = (m.match(/^[Mm]?\d+/) as RegExpMatchArray)[0];
    // (1) LOSOWOŚĆ części technicznej. Prawdziwy numer KSeF ma tam 14 znaków hex — szansa, że
    // nie padnie ani jedna litera A–F, to ~0,14%. Za to numery zamówień, seryjne i sklejone
    // kolumny kwot mają tam same cyfry, a sama suma NIP ich nie odsiewa: przechodzi ją co 11.
    // losowy ciąg 10 cyfr (zmierzone 8,97%).
    if (!/[A-Fa-f]/.test(m.slice(head.length))) return m;
    // (2) Suma kontrolna NIP-u w głowie 10-cyfrowej. Zero wiodące odrzucamy wprost — żaden NIP
    // nie zaczyna się od zera (pierwsze trzy cyfry to kod urzędu skarbowego), a suma je puszcza.
    if (/^\d{10}$/.test(head) && (head.startsWith('0') || !isValidNip(head))) return m;
    ctx.bump('KSEF');
    return ctx.M.KSEF;
  };
}

/** Pierwsze litery wyróżników wojewódzkich tablic rejestracyjnych (+ H/U — służby/wojsko).
 *  Walidują CZŁONY WYLICZENIA i tablice po kotwicy z przerwą („ISO 9001" ≠ tablica). */
const PLATE_VOIV_LETTERS = 'BCDEFGHKLNOPRSTUWZ';
/** Skróty, które zaczynają się od litery wojewódzkiej, ale nie są wyróżnikiem tablicy: marki
 *  i oznaczenia modeli (BMW, KTM, RAM, FSO), parametry pojazdu (DMC/DMR), normy i katalogi
 *  (EN, DIN, RAL, DOT), kod PKD i numer UN materiału niebezpiecznego (zawsze 4 cyfry — wojskowe
 *  „U…" mają ich 5). „PN" celowo NIE: to Konin. Wstawiany na początku kandydata tablicy. */
const PLATE_NOT_ACRONYM = '(?!(?:BMW|DMC|DMR|RAL|DIN|DOT|EN|PKD|KTM|RAM|FSO)(?![A-Z])|UN[\\s-]?\\d{4}(?![\\dA-Z]))';
/** Jednostka zaraz po kandydacie („DMC 3500 kg", „ładowność 24 t", „150 KM") — to parametr,
 *  nie tablica. Tylko odstęp poziomy: jednostka z następnego wiersza nie odbiera maski.
 *  „KM Policji/PSP" to komenda miejska, a „t.j." skrót „to jest" — po nich tablica zostaje. */
const PLATE_NOT_UNIT =
  '(?![ \\t]*(?:kg|t(?!\\.[a-ząćęłńóśźż])|ton\\w*|km|kW|KM(?![ \\t]+(?:Policji|PSP))|mm|cm[3³]?|ccm|zł|PLN|szt)(?![\\wąćęłńóśźż]))';

// ============================================================================
// Kontekst redakcji + przebiegi (top-level; orkiestrowane przez redactPII)
// ============================================================================

/**
 * Wspólny kontekst przebiegów. `text` jest MUTOWALNE — każdy przebieg robi
 * `ctx.text = ctx.text.replace(...)`. Reszta pól to domknięcia/tablice przygotowane
 * raz w `redactPII` (bump/on/M/personMask) plus bufor sentineli URL.
 */
interface RedactCtx {
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
const URL_SENTINEL_OPEN = String.fromCharCode(0xe000);
const URL_SENTINEL_CLOSE = String.fromCharCode(0xe001);
const RE_URL_SENTINEL = new RegExp(`${URL_SENTINEL_OPEN}([A-Z]+)${URL_SENTINEL_CLOSE}`, 'g');

// Ucieczki JSON/łańcuchów „\n", „\r", „\t" zapisane DOSŁOWNIE („Dane:\n85031412347" w polu
// JSON-a albo w logu). Litera ucieczki sklejała się z wartością: „n85031412347" nie ma lewej
// granicy PESEL-u, „nKowalski" nie jest wyrazem z wielkiej litery, a maska e-maila zjadała „n"
// (wynik „\[EMAIL]" przestawał się parsować). Na czas detekcji litera ucieczki zamienia się w znak
// z Prywatnego Obszaru Użytku — nie jest literą, cyfrą ani białym znakiem, więc każdy przebieg
// widzi przed wartością zwykłą granicę — a na końcu wraca. Inne znaki PUA niż sentinel URL.
const JSON_ESC_TO_PUA: Record<string, string> = { n: '\uE00A', r: '\uE00D', t: '\uE009' };
const JSON_ESC_FROM_PUA: Record<string, string> = { '\uE00A': 'n', '\uE00D': 'r', '\uE009': 't' };

// Fabryka przebiegu „etykieta + separator + wartość": słowo-etykieta (grupa 1) i separator
// (grupa 2) zostają, a wartość (grupa 3) znika pod maską typu. Wspólny kształt dla
// NR-KONTA / PESEL / NIP / REGON / ZNAK-SPRAWY / DATA-UR — regex różny, callback identyczny.
function maskAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType): void {
  ctx.text = ctx.text.replace(re, (_m, kw: string, sep: string) => {
    ctx.bump(type);
    return `${kw}${sep}${ctx.M[type]}`;
  });
}

// Callback stałej maski: bump typu + zwrot placeholdera — dla przebiegów BEZ strażnika i BEZ
// użycia dopasowania (EMAIL/TOKEN/MAC/LOGIN/ADRES/ZNAK…). Zwraca funkcję gotową dla .replace().
function maskConst(ctx: RedactCtx, type: PiiType) {
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
function cityByPrefix(ctx: RedactCtx, run: string): { leftover: string } | null {
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
function cityBySuffix(ctx: RedactCtx, run: string): { prefix: string } | null {
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

// ═══════════════════════ FAZA 0 · OCHRONA URL (sentinel) ═══════════════════════
// Dosłowne ucieczki „\n/\r/\t" (patrz JSON_ESC_TO_PUA). Tylko NIEucieczone (parzysta liczba
// backslashy przed — „C:\\nowy" w JSON-ie to ścieżka, nie nowa linia) i tylko sklejone z treścią
// (litera, cyfra, kolejny backslash): „"\n"" czy „\n " niczego nie sklejają. Długość tekstu bez
// zmian. Tekst, który już zawiera te znaki PUA, zostawiamy w spokoju — przywrócenie byłoby niejednoznaczne.
// Ścieżki Windows („C:\Users\tkaminski", „\\FS01\home$\tkaminski") to NIE ucieczki: wyraz (ciąg bez
// białych znaków) z backslashem, którego nie da się odczytać jako ucieczki JSON („\U", „\h", „\D"),
// zostaje nietknięty — inaczej login „tkaminski" rozpadał się na „\t" + „kaminski" i wyciekał.
const RE_JSON_VALID_ESCAPE = /\\(?:u[0-9A-Fa-f]{4}|["\\/bfnrt])/g;
function passProtectJsonEscapes(ctx: RedactCtx): void {
  if (!ctx.text.includes('\\') || /[\uE009\uE00A\uE00D]/.test(ctx.text)) return;
  ctx.text = ctx.text.replace(/\S+/g, (tok) => {
    if (!tok.includes('\\') || tok.replace(RE_JSON_VALID_ESCAPE, '').includes('\\')) return tok;
    return tok.replace(/(?<!\\)((?:\\\\)*)\\([nrt])(?=[\p{L}\p{N}\\])/gu, (_m, bs: string, l: string) => {
      ctx.jsonEscapes = true;
      return `${bs}\\${JSON_ESC_TO_PUA[l]}`;
    });
  });
}

// CHRONIMY całe adresy przed pozostałymi przebiegami: bez tego detektory nazwisk/telefonów/
// PESEL gryzły fragmenty URL-a. Najpierw maskujemy PII WEWNĄTRZ (e-maile, wartości parametrów
// ?user=/?email=…), potem podmieniamy URL na sentinel U+E000<litery>U+E001 i przywracamy na
// końcu (finalizePersons). Drugi przebieg jest idempotentny: klasy wartości wykluczają „[".
// Adres profilu bywa wklejony bez schematu („pl.linkedin.com/in/…" w stopce CV) — dla tych kilku
// hostów z regułą profilu (URL_PROFILE_PATH_RULES) to też adres. Lewa granica bez kropki, „@"
// i ukośnika: „jan@linkedin.com/…" to e-mail, a „x.pl/linkedin.com/…" część innej ścieżki.
// Adres bez schematu kończy się na samym profilu (segment, krótkie człony „/pub/…/12/345",
// parametry bez „,;|"). W stopce CV i w polu z OCR sklejone z nim „;501-234-567", „,PESEL:…"
// czy „/Documents/PESEL_….pdf" trafiały do chronionego adresu i wychodziły jawne.
const URL_BARE_SEG = String.raw`[^/?#\s<>"'„”()[\],;|]+`;
// Z parametrów tylko te znane z linków tych serwisów („?trk=…&originalSubdomain=pl",
// „?id=…&sk=about"), a kropka w wartości tylko przed małą literą. Doklejone bez spacji
// „.Anna Nowak", „.Tel.501234567", „&Anna=Nowak" czy „?iban=PL61…" wchodziły do chronionego
// adresu i zostawały jawne; teraz adres kończy się przed nimi i resztę czytają zwykłe przebiegi.
const URL_BARE_PARAM =
  '(?:id|sk|ref|refid|fref|hc_ref|__tn__|mibextid|rdid|trk|trkInfo|locale|originalSubdomain|lipi|utm_[a-z]+)' +
  String.raw`=[A-Za-z0-9_%+~-]*(?:\.[a-z][A-Za-z0-9_%+~-]*)*`;
const URL_BARE_QUERY = String.raw`\?${URL_BARE_PARAM}(?:&${URL_BARE_PARAM})*`;
const RE_URL_PROTECT = new RegExp(
  String.raw`\b(?:https?:\/\/|www\.)[^\s<>"'„”()]+|(?<![\w.@/-])(?:[a-z0-9-]+\.)?(?:` +
    String.raw`linkedin\.com\/(?:in|pub)\/${URL_BARE_SEG}(?:\/[0-9a-z]{1,3}(?=[/?#\s]|$)){0,3}\/?(?:${URL_BARE_QUERY})?|` +
    String.raw`facebook\.com\/profile\.php${URL_BARE_QUERY}|[a-z0-9-]+-my\.sharepoint\.com\/personal\/${URL_BARE_SEG})`,
  'g',
);
const RE_URL_PARAM_PERSON = new RegExp(
  `([?&#][A-Za-z_]{1,30}=)(?=([${PL_UP}][${PL_LO}]+)[._+])([${PL_UP}][${PL_LO}]+(?:[._+][${PL_UP}][${PL_LO}]+){1,2})(?=[&#]|$)`,
  'g',
);
const RE_URL_CONTENT_PARAM =
  /^(?:t|q|p|c|s|cat|category|categories|kategoria|kategorie|kolekcja|collection|produkt|product|item|firma|company|brand|marka|shop|sklep|store|title|tytul|tytuł|tag|tags|page|strona|article|artykul|film|movie|book|ksiazka|search|szukaj|query|haslo|wiki|topic|temat|serial|show|album|song|track)$/i;
function passProtectUrls(ctx: RedactCtx): void {
  // Kotwica KSeF liczona RAZ: to skan całego wejścia, a wewnątrz callbacku wykonywałby się
  // dla każdego adresu z osobna (dokument z tysiącami linków rósł kwadratowo — 3,7 s na 1 MB).
  const ksefInUrls = ctx.on('KSEF') && hasKsefAnchor(ctx);
  // Podmieniona ucieczka „\n/\t" kończy adres (w JSON-ie „…/x\nKowalski Jan" nazwisko nie należy do URL-a).
  ctx.text = ctx.text.replace(RE_URL_PROTECT, (raw) => {
    const trailMatch = raw.match(/[.,;:!?\]]+$/); // interpunkcja zdania nie należy do URL-a
    const trail = trailMatch ? trailMatch[0] : '';
    let url = trail ? raw.slice(0, raw.length - trail.length) : raw;
    if (ctx.on('EMAIL')) {
      url = replaceEmails(url, RE_EMAIL_CHAIN, RE_EMAIL, maskConst(ctx, 'EMAIL'));
      url = replaceEmails(url, RE_EMAIL_URLENC_CHAIN, RE_EMAIL_URLENC, maskConst(ctx, 'EMAIL'));
    }
    if (ctx.on('TOKEN')) {
      // JWT w URL-u (fragment „#access_token=eyJ…") — poza URL-em łapie go passTokens,
      // ale URL jest sentinelowany WCZEŚNIEJ, więc token trzeba zdjąć już tutaj.
      url = url.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/g, maskConst(ctx, 'TOKEN'));
    }
    // Numer KSeF w ŚCIEŻCE URL-a („…/faktura/5265877635-20250826-0100001AF629-AF/upo") — URL
    // jest sentinelowany zanim ruszy passKsef, więc numer trzeba zdjąć już tutaj; inaczej NIP
    // wystawcy zostawał jawny w linku.
    if (ksefInUrls) {
      url = url.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
    }
    // Numer księgi w linku do przeglądarki ksiąg („…?kw=KR1P/00234567/6") — URL jest
    // sentinelowany przed passKw, a z takim linkiem numer prowadzi wprost do odpisu.
    if (ctx.on('KW')) {
      url = url.replace(RE_KW_VALUE, maskKwMatch(ctx, true));
    }
    if (ctx.on('LOGIN')) {
      for (const re of URL_PROFILE_PATH_RULES) {
        url = url.replace(re, (_pm, key: string) => {
          ctx.bump('LOGIN');
          return `${key}${ctx.M.LOGIN}`;
        });
      }
    }
    for (const rule of URL_PARAM_RULES) {
      if (!ctx.on(rule.type)) continue;
      url = url.replace(rule.re, (_pm, key: string, val: string) => {
        // „?user=a.kaminska" to ten sam login co „Konto a.kaminska zablokowane" w treści
        if (rule.type === 'LOGIN' && !val.includes('%') && isPropagatableLogin(val)) ctx.loginSeeds.add(val);
        ctx.bump(rule.type);
        return `${key}${ctx.M[rule.type]}`;
      });
    }
    // Imię i nazwisko sklejone podkreślnikiem, kropką albo plusem w wartości DOWOLNEGO parametru
    // („profile.php?ref=Anna_Nowak", „?from=Jan.Kowalski"): adres jest chroniony przed przebiegami
    // osób, więc takie imię wychodziło jawne. Kotwicą jest imię ze słownika i drugi człon od
    // wielkiej litery, cała wartość parametru (nie fragment wyrazu).
    if (ctx.on('IMIE')) {
      url = url.replace(RE_URL_PARAM_PERSON, (pm, key: string, first: string, val: string) => {
        if (!POLISH_FIRST_NAMES.has(first.toLowerCase())) return pm;
        // Parametr treści sklepu albo serwisu („?kategoria=Anna_Karenina", „?produkt=Maria_Plus",
        // „?title=Jan_Matejko") to nazwa produktu, kolekcji albo hasła, a drugi człon musi mieć
        // kształt nazwiska („Maja_Summer", „Anna_Moda" — nie). Precyzja przed nadmaskowaniem.
        if (RE_URL_CONTENT_PARAM.test(key.slice(1, -1))) return pm;
        const last = val.split(/[._+]/).pop() ?? '';
        if (!surnameBase(last) && !looksLikeSurname(last)) return pm;
        ctx.bump('IMIE');
        // w trybie pseudonimów ta sama osoba co w treści („Anna Nowak" → [OSOBA-A])
        return `${key}${ctx.personMask(val.split(/[._+]/).pop() ?? val)}`;
      });
    }
    const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
    ctx.protectedUrls.push(url);
    return `${sentinel}${trail}`;
  });
}

// ═════════ FAZA 1 · STRUKTURALNE WYSOKIEJ PRECYZJI (etykieta / wzorzec) ═════════
// 1) E-MAIL
function passEmail(ctx: RedactCtx): void {
  if (!ctx.on('EMAIL')) return;
  const full = ctx.text;
  ctx.text = full.replace(RE_EMAIL_CHAIN, (chain: string, chainAt: number) =>
    chain.replace(RE_EMAIL, (m: string, at: number) => {
      if (isGitRemote(full, chainAt + at, m)) return m;
      ctx.bump('EMAIL');
      return ctx.M.EMAIL;
    }),
  );
  // URL-e są już za sentinelem, więc to tylko „%40" poza nimi — bez podwójnego maskowania.
  // Domena z samych cyfr przed „rozszerzeniem" („raport%402024.pdf") to nazwa pliku, nie adres.
  ctx.text = replaceEmails(ctx.text, RE_EMAIL_URLENC_CHAIN, RE_EMAIL_URLENC, (m: string) => {
    if (/%40[\d.-]+\.[A-Za-z]{2,}$/.test(m)) return m;
    ctx.bump('EMAIL');
    return ctx.M.EMAIL;
  });
}
/**
 * Adres zdalnego repozytorium „git@host:ścieżka" (forma scp) albo „ssh://git@host/…" — „git" to
 * stałe konto usługi hostingu kodu, nie skrzynka osoby, a maska zjadała nazwę serwera. TYLKO
 * „git@": skrzynki funkcyjne (biuro@, noreply@) i loginy osób w formie scp („jan.kowalski@
 * serwer:/home") maskujemy jak dotąd. Dwukropek ze spacją („git@firma.pl: dział IT") to proza.
 */
function isGitRemote(full: string, at: number, m: string): boolean {
  if (!m.startsWith('git@')) return false;
  return /^:\S/.test(full.slice(at + m.length, at + m.length + 2)) ||
    /(?:^|[^\w+])(?:git\+)?ssh:\/\/$/i.test(full.slice(Math.max(0, at - 12), at));
}

// 1a) TOKEN (JWT + sekrety prefiksowe): eyJ<base64url>.… oraz sk_live_/ghp_/github_pat_/xox?-.
// „eyJ" = base64 z „{\"" — znikome FP, a token może dawać dostęp, więc maskujemy w całości.
function passTokens(ctx: RedactCtx): void {
  if (!ctx.on('TOKEN')) return;
  ctx.text = ctx.text.replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/g, maskConst(ctx, 'TOKEN'));
  ctx.text = ctx.text.replace(
    /\b(?:sk_(?:live|test)_[A-Za-z0-9]{8,}|(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})/g,
    maskConst(ctx, 'TOKEN'),
  );
}

// MAC: 6 par hex po „:"/„-". MUSI biec PRZED IPv6 (MAC pasuje do wzorca grup hex IPv6).
function passMac(ctx: RedactCtx): void {
  if (!ctx.on('MAC')) return;
  // Bierzemy CAŁY łańcuch par hex z jednolitym separatorem i maskujemy go tylko przy dokładnie
  // 6 parach albo po etykiecie „MAC" (pole „MAC=" w logu iptables ma 14 par: dwa adresy i typ
  // ramki). Sztywne {5} cięło dłuższy łańcuch na sześciopary: numer seryjny „4a:3f:22:91:0c:7e:
  // 1d:55" dawał „[MAC]:1d:55", a odcisk klucza hosta „MD5:16:27:…" — „MD5:[MAC]:[MAC]:…".
  // Wyjątki: identyfikator klienta DHCP to typ sprzętu „01" (Ethernet) + MAC — 7 par; etykieta
  // „EUI-64" to sprzętowy adres urządzenia tak samo jak MAC (bez „HMAC" — to skrót kryptograficzny).
  // Identyfikatory z adresem karty w środku też w całości: DUID-LLT (00:01:00:01 + czas + MAC,
  // 14 par) i DUID-LL (00:03:00:01 + MAC, 10 par) z „ipconfig /all" oraz EUI-64 z „ff:fe" w środku
  // (MAC rozcięty wstawką) — bez tego łańcuch inny niż 6 par zostawiał cały adres sprzętowy jawny.
  // Etykieta może mieć jeden wyraz dopowiedzenia („EUI-64 interfejsu:", „DUID. . . :").
  ctx.text = ctx.text.replace(
    /\b[0-9A-Fa-f]{2}([:-])[0-9A-Fa-f]{2}(?:\1[0-9A-Fa-f]{2}){4,}\b/g,
    (m, _sep: string, offset: number) => {
      const pairs = (m.length + 1) / 3;
      const hex = m.toLowerCase().replace(/[:-]/g, '');
      const embedsMac =
        (pairs === 14 && hex.startsWith('00010001')) ||
        (pairs === 10 && hex.startsWith('00030001')) ||
        (pairs === 8 && hex.slice(6, 10) === 'fffe');
      const labeled = /(?<![A-Za-z])(?:mac|eui(?:-?64)?|duid)(?:[ \t]+\p{L}+)?[\s:=.-]*$/iu.test(ctx.text.slice(Math.max(0, offset - 32), offset));
      if (pairs !== 6 && !(pairs === 7 && m.startsWith('01')) && !embedsMac && !labeled) return m;
      ctx.bump('MAC');
      return ctx.M.MAC;
    },
  );
  // Sześć par z MIESZANYMI separatorami („00:11-22:33-44:55") jak dotąd — ale tylko samodzielne,
  // nie jako wycinek dłuższego łańcucha (ten zostawił już pierwszy przebieg).
  ctx.text = ctx.text.replace(
    /(?<![0-9A-Fa-f]{2}[:-])\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b(?![:-][0-9A-Fa-f]{2})/g,
    maskConst(ctx, 'MAC'),
  );
  // MAC w notacji Cisco: „aabb.ccdd.eeff" (3 grupy po 4 hex). Wymagamy ≥1 LITERY hex — w obrębie
  // samego adresu (14 znaków), stąd {0,13}: lookahead bez limitu skanował cały ciąg „1.1.1…"
  // od każdej pozycji (czas kwadratowy, sekundy na 100 tys. znaków).
  ctx.text = ctx.text.replace(
    /\b(?=[0-9A-Fa-f.]{0,13}[A-Fa-f])(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}(?![:\w-]|\.\w)/g,
    maskConst(ctx, 'MAC'),
  );
  // Z SILNĄ etykietą „MAC" maskujemy notację Cisco także CZYSTO CYFROWĄ (etykieta wygrywa).
  ctx.text = ctx.text.replace(
    /\b((?:adres\w*\s+)?MAC[\s:.=-]+)((?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4})(?![:\w-]|\.\w)/gi,
    (_m, pre: string) => {
      ctx.bump('MAC');
      return `${pre}${ctx.M.MAC}`;
    },
  );
}

// IP: IPv6 (grupy hex, także skrócone „::") PRZED IPv4 (oktety 0–255). Jeden typ dla obu wersji.
function passIp(ctx: RedactCtx): void {
  if (!ctx.on('IP')) return;
  const H = '[0-9A-Fa-f]{1,4}';
  const IPV6 =
    `(?:${H}:){7}${H}|(?:${H}:){1,7}:|(?:${H}:){1,6}:${H}|(?:${H}:){1,5}(?::${H}){1,2}|` +
    `(?:${H}:){1,4}(?::${H}){1,3}|(?:${H}:){1,3}(?::${H}){1,4}|(?:${H}:){1,2}(?::${H}){1,5}|` +
    `${H}:(?:(?::${H}){1,6})|:(?:(?::${H}){1,7}|:)`;
  // Prawa granica: kropka KOŃCA ZDANIA po adresie jest OK, ale kropka z kolejnym znakiem słownym nie.
  // Osiem par hex przez „:" to numer seryjny albo odcisk, nie adres IPv6 (passMac go zostawił,
  // bo nie ma 6 par) — inaczej „Serial Number: 4a:3f:22:91:0c:7e:1d:55" dostawał [IP].
  ctx.text = ctx.text.replace(new RegExp(`(?<![:.\\w])(?:${IPV6})(?![:\\w]|\\.\\w)`, 'g'), (m) => {
    if (/^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){7}$/.test(m)) return m;
    ctx.bump('IP');
    return ctx.M.IP;
  });
  // IPv4: 4 oktety 0–255. Nie po „art./poz." ani po „wersja/ver./v" (numer wersji ≠ IP).
  // Prawa granica jak w IPv6: kropka z kolejnym znakiem słownym („10.0.0.1.nip.io", OID
  // „1.3.6.1.4") blokuje, sama kropka — nie. Ale kropka kończy też numer punktu konspektu
  // („1.2.3.4. Zakres prac", „w rozdziale 2.1.1.1."), więc adres przed kropką maskujemy tylko
  // z kontekstem sieciowym w tej samej linii (patrz ipv4BeforeDotIsAddress).
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?!\d|\.\w)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (RE_IPV4_VERSION_BEFORE.test(ctx.text.slice(Math.max(0, offset - 32), offset))) return m;
      if (isNonHostIpv4(m, ctx.text.slice(offset + m.length, offset + m.length + 4))) return m;
      if (ctx.text[offset + m.length] === '.' && !ipv4BeforeDotIsAddress(ctx.text, offset, m)) return m;
      ctx.bump('IP');
      return ctx.M.IP;
    },
  );
}

/**
 * Adres, który nie wskazuje żadnego hosta ani osoby: nieokreślony 0.0.0.0, pętla zwrotna 127/8,
 * maska podsieci (ciągła, od 255), adres SIECI w notacji CIDR („10.0.0.0/24" — host z prefiksem
 * „192.168.1.20/24" dalej jest maskowany) i publiczne resolwery DNS. To parametry konfiguracji,
 * a ich maskowanie tylko zaciemnia instrukcje i logi.
 */
const PUBLIC_DNS_IPV4 = new Set(['8.8.8.8', '8.8.4.4', '1.1.1.1', '1.0.0.1', '9.9.9.9', '149.112.112.112']);
function isNonHostIpv4(ip: string, after: string): boolean {
  const o = ip.split('.').map(Number);
  if (ip === '0.0.0.0' || o[0] === 127 || PUBLIC_DNS_IPV4.has(ip)) return true;
  if (o[0] === 255) {
    const inv = ~(((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0) >>> 0;
    if ((inv & (inv + 1)) === 0) return true;
  }
  return o[3] === 0 && /^\/\d{1,2}(?!\d)/.test(after);
}
/**
 * Numer wersji, nie adres: słowo „wersja/ver/v", „firmware", „build", „release", „kernel",
 * „wydanie" tuż przed liczbą. Okno 32 znaków, polskie końcówki („wersję", „wersji"), dwukropek
 * etykiety („Wersja klienta: 2.1.0.15") i jeden wyraz pośredni („wersję systemu 2.0.1.3") —
 * ale nie przyimek ani spójnik: „wdrożono wersję na 10.20.30.40" to host, na który wdrożono.
 * Lewa granica litery, bo „wersj" siedzi też w „konwersji" i „inwersji" („konwersja adresów
 * 192.168.1.15" to adres).
 */
const RE_IPV4_VERSION_BEFORE =
  /(?<![\p{L}\d])(?:wersj\p{L}*|ver|v|firmware|build|release|kernel|wydani\p{L}*)\.?(?:\s+(?!(?:na|z|ze|od|do|dla|po|pod|przy|przez|w|we|o|u|i|a|oraz|lub|albo|to|jest|za|nad)(?!\p{L}))\p{L}[\p{L}-]*)?\s*:?\s*$/iu;
const RE_IPV4_NET_CONTEXT =
  /(?<![\p{L}\d])(?:ip(?:v4)?|adres\p{L}*|host\p{L}*|serwer\p{L}*|bram\p{L}*|gateway|router\p{L}*|dns|połącz\p{L}*|logowa\p{L}*|zalogowa\p{L}*|nasłuch\p{L}*|interfejs\p{L}*|źródłow\p{L}*|docelow\p{L}*|klient\p{L}*|client|from|src|dst)(?![\p{L}\d])/iu;
const RE_IPV4_STRUCT_WORD =
  /(?<![\p{L}])(?:(?:rozdzia|podrozdzia|punk|sekcj|częś|tabel|rysun|załącznik|wersj|kwot|wynios|klasyfikac)\p{L}*|pkt|rozdz|tab|tabl|rys|zał|p|ver|v|zob|patrz|pkwiu|pkd|cpv|oid)[\s:.]*$/iu;
const RE_PHONE_WORD = /(?<![\p{L}])(?:tel|telefon\p{L}*|kontakt\p{L}*|stacjonarn\p{L}*|komórk\p{L}*|kom|fax|faks)(?![\p{L}])/iu;
// Linia o oprogramowaniu: wydanie, aktualizacja, jądro, nazwa systemu. Słowa „serwer", „klient",
// „host" stoją tu obok numeru wersji („Aktualizacja serwera do 7.0.3.12.", „Kernel serwera
// 5.15.0.91.", „Serwer działa na Debianie 12.0.1.2.") — sam kontekst sieciowy to za mało.
const RE_IPV4_SOFTWARE_CONTEXT =
  /(?<![\p{L}\d])(?:wersj\p{L}*|firmware|build|release|kernel|wydani\p{L}*|z?aktualiz\p{L}*|uaktualni\p{L}*|update\p{L}*|upgrade\p{L}*|patch\p{L}*|debian\p{L}*|ubuntu|centos|fedora|rhel|windows|android|macos|ios|freebsd)(?![\p{L}\d])/iu;
// …chyba że w linii adres jest nazwany wprost: „IP" albo „adres" („po aktualizacji logowanie
// z adresu …", „Adres IP serwera po aktualizacji: …").
const RE_IPV4_ADDRESS_WORD = /(?<![\p{L}\d])(?:ip(?:v4)?|adres\p{L}*)(?![\p{L}\d])/iu;
/**
 * Czy kandydat na IPv4 stojący PRZED KROPKĄ to adres, a nie numer punktu? Bez tej bramki
 * prosta zmiana granicy maskowała numerację konspektu, odwołania („w punkcie 5.3.2.1.")
 * i kwoty z kropkami — regresja, której benchmark nie widzi. Wymagamy kontekstu sieciowego
 * w tej samej linii; numer sam w linii to nagłówek; 9 cyfr przy słowie „tel." to telefon
 * zapisany z kropkami (przejmie go passPhone); w linii o wersji oprogramowania — tylko adres
 * nazwany wprost. Linię wyznaczamy w oknie 60 znaków, nie przez lastIndexOf po całym tekście:
 * w długiej linii bez „\n" (ekstrakcja PDF, zminifikowany log) to był koszt kwadratowy.
 */
function ipv4BeforeDotIsAddress(full: string, offset: number, m: string): boolean {
  const win = full.slice(Math.max(0, offset - 60), offset);
  const lead = win.slice(win.lastIndexOf('\n') + 1);
  if (!/\S/.test(lead)) return false;
  if (RE_IPV4_STRUCT_WORD.test(lead.slice(-24))) return false;
  if (m.replace(/\D/g, '').length === 9 && RE_PHONE_WORD.test(lead)) return false;
  if (RE_IPV4_SOFTWARE_CONTEXT.test(lead) && !RE_IPV4_ADDRESS_WORD.test(lead)) return false;
  return RE_IPV4_NET_CONTEXT.test(lead);
}

// VIN: 17 znaków, charset bez I/O/Q. Z kontekstem („VIN"/„nadwozia") ZAWSZE; bez kontekstu tylko
// gdy układ jest wyraźnie VIN-owy (WIELKIE litery + ≥4 cyfry + ≥3 litery) — inaczej hash/kod.
function passVin(ctx: RedactCtx): void {
  if (!ctx.on('VIN')) return;
  ctx.text = ctx.text.replace(
    /\b((?:vin|nr\s+vin|numer\s+vin|nr\s+nadwozia|numer\s+nadwozia)[\s:.=-]*)([A-HJ-NPR-Za-hj-npr-z0-9]{17})\b/gi,
    (_m, pre: string) => {
      ctx.bump('VIN');
      return `${pre}${ctx.M.VIN}`;
    },
  );
  ctx.text = ctx.text.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, (m) => {
    const digits = (m.match(/\d/g) || []).length;
    const letters = (m.match(/[A-Z]/g) || []).length;
    if (digits >= 4 && letters >= 3) {
      ctx.bump('VIN');
      return ctx.M.VIN;
    }
    return m;
  });
}

const isConfirmedSurname = (w: string): boolean =>
  !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w));
// Wyraz z wielkiej litery samotnie po tytule („Pani Nguyen zgłosiła się", „Pan Gruber") — w polu
// z nierozpoznanym imieniem i nazwiskiem wskazuje, który wyraz jest nazwiskiem.
const RE_TITLED_SINGLE = /(?<!\p{L})(?:Pan(?:i|a|u|ią|em|ie)?|dr|prof|mgr)\.?[ \t]+(\p{Lu}[\p{Ll}'’-]+)(?![\p{L}'’-])(?![ \t]+\p{Lu})/gu;
// Wpis zastępczy w polu osoby: nieznany z nazwiska pacjent albo zmarły („NN", „N.N."), „nieustalone",
// „jak wyżej", „Do uzupełnienia".
const RE_FORM_PERSON_PLACEHOLDER = /^(?:n\.?[ \t]?n\.?|x+|nieustal\p{L}*|do[ \t]+uzupełnienia|jak[ \t]+wyżej|j\.[ \t]?w\.?)$/iu;
// Pierwszy wyraz wartości, który robi z niej komórkę urzędu, a nie osobę (uzupełnia LEGAL_ENTITY_WORDS
// i ROLE_WORDS: „Dział Kadr", „Sekretariat", „Dom Dziecka").
const FORM_NOT_PERSON_HEAD = new Set<string>('dział działu sekretariat kadry dom biuro'.split(' '));
// Zapis bez ogonków („Wojt Gminy", „Kierownik Dzialu") — etykiety bywają z systemów bez polskich znaków.
const foldPl = (s: string): string => s.replace(/[ąćęłńóśźż]/g, (c) => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]);
const FORM_NOT_PERSON_HEAD_FOLDED = new Set<string>([...LEGAL_ENTITY_WORDS, ...ROLE_WORDS, ...FORM_NOT_PERSON_HEAD].map(foldPl));
// Wyrazy, które NA DOWOLNEJ POZYCJI wartości robią z niej instytucję, komórkę albo rolę: instytucja
// zaczyna się zwykle od przymiotnika („Powiatowe Centrum Pomocy Rodzinie", „Gminny Ośrodek Pomocy
// Społecznej", „Ochotnicza Straż Pożarna"), a w rejestrze wniosków wnioskodawcą bywa redakcja,
// wspólnota czy spółka („Gazeta Wyborcza", „Wspólnota Mieszkaniowa Lipowa", „Tauron Dystrybucja").
// Bez homografów nazwisk („Sołtys", „Nowa", „Polski") — te rozstrzyga tylko pierwszy wyraz.
const FORM_NOT_PERSON_ANY = new Set<string>(
  (
    'ośrodek ośrodka centrum pomocy społecznej rodzinie rodziny wspólnota wspólnoty mieszkaniowa ' +
    'gazeta redakcja tygodnik tygodnika dziennik sieć straż pożarna ochotnicza dystrybucja operator ' +
    'paliwa oddział oddziału gmina gminy gminne gminny gminna miejski miejska miejskie powiatowe ' +
    'powiatowy powiatowa miasto miasta wsi placówka zastępcza rodzina recepcja sekretariat projekt ' +
    'projektu informacji kultury fundacja stowarzyszenie spółka spółdzielnia szkoła przedszkole ' +
    'szpital przychodnia urząd urzędu zarząd kancelaria matka ojciec rodzice opiekun opiekunka ' +
    'kierowca noworodek koordynator koordynatorka dyrekcja'
  )
    .split(' ')
    .map(foldPl),
);
// Przymiotnik w kształcie nazwy instytucji („Mieszkaniowa", „Wyborcza", „Gminny", „Społecznej")
// — liczy się tylko wtedy, gdy w wartości nie ma imienia ani nazwiska ze słownika. Ostatni wyraz
// na „-owa/-ewa" to nazwisko: tak kończą się nazwiska wschodniosłowiańskie i środkowoazjatyckie
// („Oksana Petrowa", „Gulnara Iwanowa", „Olena Kuzniecowa", „Dilnoza Karimowa"), a instytucję
// z takim przymiotnikiem po rzeczowniku („Wspólnota Mieszkaniowa") rozstrzyga sam rzeczownik.
// Spółgłoska przed „-na/-ne/-ny" („Pożarna", „Gminny"), bo imię obce w tym kształcie („Svitlana",
// „Oksana") ma przed nią samogłoskę.
const RE_FORM_INSTITUTION_ADJ = /(?:ow[aey]|owej|owego|[^aeiouyąęó]n[aey]|nej|nego|cz[aey]|czej|ych)$/u;
// Otczestwo (imię odojcowskie) w środku wartości („Karimovna", „Iwanowna", „Petrowicz").
const RE_PATRONYMIC = /(?:ovna|owna|evna|ewna|ivna|iwna|ovich|owicz|evich|ewicz)$/i;
// Homograf wyrazu instytucji jako nazwisko za imieniem spoza słownika („Jisoo Park", „Bożydar Rada").
const FORM_HOMOGRAPH_SURNAME_TAIL = new Set<string>(['park', 'rada', 'bank', 'koło']);
// Imię koreańskie w zapisie łacińskim: jedna albo dwie sylaby (nagłos, samogłoska, wygłos n/m/ng/k/l/p/t;
// „Jisoo", „Minho", „Seo-yeon", „Hyun"). Wyraz firmy albo obiektu („Aqua", „Energy", „Business",
// „Techno", „Silesia") tego kształtu nie ma.
const RE_KOREAN_GIVEN_NAME =
  /^(?:(?:kk|tt|pp|ss|jj|ch|[gkndtrlmbpsjh])?(?:yeo|yae|wae|eo|ae|ya|ye|yo|yu|wa|wo|we|wi|oe|eu|ui|oo|ee|[aeiou])(?:ng|[nmklpt])?-?){1,2}$/i;
// Słowiańskie imię złożone spoza słownika przed homografem „Rada/Bank/Koło" („Bożydar Rada").
const RE_SLAVIC_COMPOUND_GIVEN = /(?:mir|mira|sław|sława|dar|gniew|bor|wit|mił|miła|wój|woja|rad|rada)$/i;
// Imię chińskie albo wietnamskie w szyku paszportowym („WANG Xiaoming", „Thi Lan HO", „DOAN Van
// Hung"): sylaby z nagłosem pinyin albo wietnamskim i wygłosem n/ng/nh/m/c/ch/p/t. Nazwa firmy za
// skrótem („BNP Paribas", „ERGO Hestia", „DHL Parcel", „AXA Ubezpieczenia", „Hotel ABC") odpada.
const RE_EAST_ASIAN_GIVEN_NAME =
  /^(?:(?:zh|ch|sh|th|tr|ng|nh|ph|kh|gi|qu|[bcdfghjklmnpqrstvwxyz])?[aeiouy]{1,3}(?:ng|nh|ch|[nmcpt])?){1,3}$/i;
// Akronimy instytucji, które w wartości pola osoby oznaczają podmiot („PGE …", „BGK Nieruchomości").
const FORM_INSTITUTION_ACRONYMS = new Set<string>(
  (
    'PGE ZUS KRUS PKO PZU NFZ GOPS MOPS MOPR PCPR OPS ZOZ PKP PKS UM UG US PUP WUP KRS GUS NBP BGK BIK ' +
    'PIP SKO WSA NSA SN TK RIO KIO UZP OSP ZHP PCK PZM ZDW ZDP ZDM MPK PWiK ZGK ZUK ZOL DPS ŚDS CUS ' +
    'CAS KOWR IPN UKS GKS MKS LKS AZS PKN PAP LOT PLL ENEA TVP'
  ).split(' '),
);
// Imię dwuczłonowe z łącznikiem w transkrypcji koreańskiej i wietnamskiej („Min-jun", „Seo-yeon").
const RE_HYPHEN_GIVEN_NAME = /^\p{Lu}\p{Ll}+-\p{L}\p{Ll}+$|^\p{Lu}{2,}-\p{Lu}{2,}$/u;
// Słownictwo nagłówków kolumn tabeli z PDF (komórka pod komórką, zapis bez ogonków).
const NEXT_LINE_HEADER_WORDS = new Set<string>(
  (
    'podpis podpisy grupa ocena ocen godzina rodzaj srednia rok lekarz wychowawca klasa klasy data ' +
    'numer termin uwagi wynik wyniki miejsce adres telefon stanowisko kwota liczba status typ opis ' +
    'rozpoznanie zawod plec wiek rodzica rodzicow opiekuna ucznia pacjenta dziecka imie nazwisko lp ' +
    'semestr przedmiot frekwencja oddzial sala pokoj godziny dzien'
  ).split(' '),
);
// Imiesłów i rzeczownik odczasownikowy („Prowadzący", „Przyjęcia", „Urodzenia", „Zatrudnienie").
const RE_NEXT_LINE_HEADER_MORPH = /(?:ący|ąca|ące|[eęa]nia|ęcia|enie|anie|ości|ość)$/u;
const nextLineHeaderWord = (w: string): boolean =>
  NEXT_LINE_HEADER_WORDS.has(foldPl(w)) || RE_NEXT_LINE_HEADER_MORPH.test(w) || RE_FORM_INSTITUTION_ADJ.test(w);
// Forma prawna w wartości („PGE Dystrybucja S.A.", „Trans Sp. z o.o.", „Bud S.C.").
const RE_FORM_LEGAL_FORM = /(?:^|[ \t])(?:S\.?A|SA|Sp|sp|S\.?C|Sp\.?[ \t]?[jkJK])\.?(?=[ \t]|$)/u;
/**
 * Bramka wartości dla etykiet spoza dawnego zestawu (FormField.gated): dopełnienie („Imię
 * i nazwisko pacjenta:"), zapis bez ogonków, szyk ZUS. Dawniej te etykiety nie były kotwicą, więc
 * wartość, która nie wygląda na osobę, zostaje jawna: instytucja albo rola („Gmina Michałowice",
 * „Prezes Zarządu", „Powiatowe Centrum Pomocy Rodzinie", „Matka"), skrót i forma prawna („PGE
 * Dystrybucja S.A.", „ZUS Oddział Siedlce"), wpis zastępczy („NN", „nieustalone") i pouczenie małą
 * literą („wpisać drukowanymi literami"). Instytucja albo rola przed imieniem zostaje poza maską
 * („Kancelaria Piotr Zając" → „Kancelaria [..]"), tak samo tytuł małą literą („adw. Piotr Zając")
 * i interpunkcja na końcu („Jan Kowalski."). Wartość z następnej linii (tabela z PDF, komórka pod
 * komórką: „Imię i nazwisko ucznia⏎Podpis Rodzica", „…⏎Grupa Wiekowa") musi mieć imię albo
 * nazwisko ze słownika — kolejny nagłówek kolumny też jest dwoma wyrazami z wielkiej litery.
 * Zwraca części wartości albo null.
 */
function gatedPersonValue(
  val: string,
  nextLine: boolean,
  surnameOnly = false,
): { lead: string; core: string; tail: string } | null {
  let lead = '';
  let core = val;
  for (let m = /^(\S+)[ \t]+/.exec(core); m && /^\p{Ll}/u.test(m[1]) && RE_VALUE_TITLE_OR_INITIAL.test(m[1]); m = /^(\S+)[ \t]+/.exec(core)) {
    lead += m[0];
    core = core.slice(m[0].length);
  }
  const tail = /[.,;]+$/.exec(core)?.[0] ?? '';
  core = core.slice(0, core.length - tail.length);
  if (!core || RE_FORM_PERSON_PLACEHOLDER.test(core)) return null;
  let ws = core.split(/[ \t]+/);
  if (FORM_NOT_PERSON_HEAD_FOLDED.has(foldPl(ws[0].toLowerCase()))) {
    const fi = ws.findIndex(isFirstNameLike);
    if (fi < 1) return null;
    // Samo imię za rolą to szyk „Nazwisko Imię" z nazwiskiem-homografem („Marszałek Anna") — całość
    // jest osobą. Imię z nazwiskiem za nią to osoba po nazwie instytucji albo roli.
    if (ws.length - fi >= 2) {
      const parts = core.split(/([ \t]+)/);
      lead += parts.slice(0, 2 * fi).join('');
      core = parts.slice(2 * fi).join('');
      ws = ws.slice(fi);
    }
  }
  const notPerson = (w: string): boolean =>
    w
      .toLowerCase()
      .split('-')
      .some((p) => FORM_NOT_PERSON_ANY.has(foldPl(p)) || (LEGAL_ENTITY_WORDS.has(p) && !isConfirmedSurname(w)));
  // Nazwisko-homograf wyrazu instytucji na końcu, za samym imieniem („Anna Koło", „Jan Nowy",
  // „Adam Bank", koreańskie „Min-jun Park", „SEO-YEON PARK"): imię przed nim rozstrzyga osobę.
  // Wyrazy z FORM_NOT_PERSON_ANY („Ośrodek", „Gmina") odrzucają dalej, bo nie bywają nazwiskami.
  const homographSurnameAt = (w: string, i: number): boolean =>
    i === ws.length - 1 &&
    i > 0 &&
    i <= 2 &&
    !w.split('-').some((p) => FORM_NOT_PERSON_ANY.has(foldPl(p.toLowerCase()))) &&
    (ws.slice(0, i).every((g) => isFirstNameLike(g) || RE_HYPHEN_GIVEN_NAME.test(g)) ||
      // imię spoza słownika przed homografem („Jisoo Park", „Minho Park", „Bożydar Rada"): dwa
      // wyrazy, pierwszy w kształcie imienia — nie przymiotnik ani wyraz instytucji („Wodny Park",
      // „Miejska Rada", „Aqua Park" pod etykietą osoby się nie zdarza)
      // Imię musi mieć przy tym kształt imienia: koreańskie sylaby przed „Park" („Jisoo", „Minho"),
      // słowiański złożony przed „Rada/Bank/Koło" („Bożydar", „Świętomira") — nazwa firmy albo
      // obiektu („Aqua Park", „Business Park", „Alior Bank", „Santander Bank") go nie ma.
      (ws.length === 2 &&
        !nextLine &&
        FORM_HOMOGRAPH_SURNAME_TAIL.has(w.toLowerCase()) &&
        /^\p{Lu}\p{Ll}+$/u.test(ws[0]) &&
        (w.toLowerCase() === 'park' ? RE_KOREAN_GIVEN_NAME.test(ws[0]) : RE_SLAVIC_COMPOUND_GIVEN.test(ws[0])) &&
        !RE_FORM_INSTITUTION_ADJ.test(ws[0].toLowerCase()) &&
        !RE_NEXT_LINE_HEADER_MORPH.test(ws[0].toLowerCase()) &&
        !/(?:sk|ck|dzk|n)[aiey]$/u.test(ws[0].toLowerCase()) &&
        !notPerson(ws[0])));
  if (ws.some((w, i) => notPerson(w) && !homographSurnameAt(w, i)) || RE_FORM_LEGAL_FORM.test(core)) return null;
  if (!RE_PROPER_WORDS.test(core)) return lowercaseNameLooksLikePerson(ws) ? { lead, core, tail } : null;
  const proven = ws.some((w) => isFirstNameLike(w) || isConfirmedSurname(w));
  if (!proven) {
    // Wartość z następnej linii bez słownika: obce imię i nazwisko („Yuki Tanaka", „Amir Rahimov",
    // „Thanh Hoa Tran") wygląda tak samo jak nagłówek kolumny, więc odsiewamy nagłówek po jego
    // słownictwie i polskiej morfologii („Podpis Rodzica", „Godzina Przyjęcia", „Lekarz Prowadzący",
    // „Grupa Wiekowa"). Pojedynczy wyraz („Klasa") dalej wymaga słownika.
    if (nextLine && (ws.length < 2 || ws.some((w) => nextLineHeaderWord(w.toLowerCase())))) return null;
    // Przymiotnik albo imiesłów w rodzaju nijakim pod etykietą samego nazwiska („Nazwisko dziecka:
    // Wspólne", „Nazwisko małżonka: Dotychczasowe", „Nazwisko pacjenta: Utajnione", „… Ojcowskie")
    // to wypełniacz formularza USC czy placówki, nie nazwisko.
    if (surnameOnly && ws.length === 1 && /^\p{Lu}\p{Ll}+(?:ne|owe|ewe|kie|gie|cie|te|łe)$/u.test(ws[0])) return null;
    // bez imienia i nazwiska ze słownika: skrót WERSALIKAMI w wartości pisanej zwykle („PGE …",
    // „ZUS …") albo przymiotnik instytucji („Wspólnota Mieszkaniowa") to nie osoba
    // — ale nie szyk paszportowy z nazwiskiem WERSALIKAMI na początku albo końcu („WANG Xiaoming",
    // „Thi Lan HO", „DOAN Van Hung"), gdy skrót nie jest znanym akronimem instytucji
    const capsAt = ws.flatMap((w, i) => (/^\p{Lu}{2,4}$/u.test(w) ? [i] : []));
    if (core !== core.toUpperCase() && capsAt.length) {
      const ci = capsAt[0];
      const passport =
        capsAt.length === 1 &&
        ws.length >= 2 &&
        ws.length <= 4 &&
        (ci === 0 || ci === ws.length - 1) &&
        !FORM_INSTITUTION_ACRONYMS.has(ws[ci]) &&
        ws.every((w, i) => i === ci || (/^\p{Lu}\p{Ll}+$/u.test(w) && RE_EAST_ASIAN_GIVEN_NAME.test(w)));
      if (!passport) return null;
    }
    // Przymiotnik instytucji. Wyjątki: nazwisko na „-owa/-ewa/-ova" na końcu, otczestwo w środku
    // („Nodira Karimovna Yusupova", „Gulnara Iwanowna Sadykowa") i sam wyraz pod etykietą samego
    // nazwiska („Nazwisko pacjenta: Iwanowa", „Nazwisko ucznia: Wieczna") — tam to zawsze nazwisko.
    if (
      !(surnameOnly && ws.length === 1 && !nextLine) &&
      ws.some(
        (w, i) =>
          RE_FORM_INSTITUTION_ADJ.test(w.toLowerCase()) &&
          !(i === ws.length - 1 && i > 0 && /[oe][wv]a$/i.test(w)) &&
          !(i > 0 && i < ws.length - 1 && RE_PATRONYMIC.test(w)),
      )
    )
      return null;
  }
  return { lead, core, tail };
}

// 1b) POLA FORMULARZA — etykieta w linii, wartość w tej samej („Nazwisko: X") lub NASTĘPNEJ
// („Nazwisko\nWILCZYŃSKI"). Kotwica strukturalna o wysokiej precyzji; łapie też WERSALIKI.
// Blok BEZ pojedynczej bramki `on()` — każde pole sprawdza własny typ.
// Etykieta następnego pola w wartości tej samej linii: wyraz z wielkiej litery, do dwóch dalszych
// wyrazów i dwukropek („ PESEL:", „ Data:", „ Gmina:", „ Nr lokalu:").
const RE_NEXT_FIELD_LABEL = /[ \t]+\p{Lu}[\p{L}.]*(?:[ \t]+\p{L}+\.?){0,2}[ \t]*:/u;
// Numer pozycji formularza przed etykietą („04. Ulica: Warszawska  05. Nr domu: 31") należy do
// etykiety — ale tylko w formularzu numerowanym, czyli gdy wiersz zaczyna się od takiego numeru.
// Bez niego „Ulica: Krótka 7. Piętro: 2" ma numer domu z kropką końca pola, nie numer pozycji.
const RE_FLAT_FIELD_NO_END = /(?:^|[ \t]+)\d{1,2}[.)]$/;
const RE_FLAT_FORM_NUMBERED = /^[ \t]*\d{1,2}[.)][ \t]/;
// Wyraz otwierający etykietę wielowyrazową („Nr domu:", „Kod pocztowy:", „Data urodzenia:") — przed
// nim stoi jeszcze wartość poprzedniego pola, nie etykieta. Także rzeczowniki z etykiet kadrowych
// i finansowych pisanych Wielkimi Literami w każdym wyrazie („Telefon Komórkowy:", „Wymiar Etatu:",
// „Wynagrodzenie Brutto:", „Osoba Do Kontaktu:", „Dowód Osobisty:", „Okres Zatrudnienia:").
const RE_FLAT_LABEL_OPENER =
  /^(?:nr|numer|kod|data|adres|miejsce|imię|imie|nazwisko|telefon|tel|wymiar|wynagrodzenie|wykształcenie|osoba|do|obywatelstwo|dowód|okres|kwota|stan|stopień|rodzaj|seria|stanowisko|wysokość|forma)\.?$/i;
/**
 * Etykieta następnego pola zaczyna się od OSTATNIEGO wyrazu z wielkiej litery przed dwukropkiem:
 * w „Długa 5 Kraków Tel:" etykietą jest „Tel:", a „Kraków" należy jeszcze do wartości (dawniej
 * miejscowość wypadała z maski adresu). Dalsze człony etykiety piszemy małą literą („Nr domu:").
 */
function flatNextLabel(rest: string): { index: number; text: string } | null {
  const nx = RE_NEXT_FIELD_LABEL.exec(rest);
  if (!nx) return null;
  const parts = nx[0].split(/([ \t]+)/);
  // parts: ['', odstęp, wyraz, odstęp, wyraz, …] — wyrazy na pozycjach parzystych od 2
  let i = parts.length - 1;
  while (i > 2 && !/^\p{Lu}/u.test(parts[i])) i -= 2;
  while (i > 2 && RE_FLAT_LABEL_OPENER.test(parts[i - 2])) i -= 2;
  if (i <= 2) return { index: nx.index, text: nx[0] };
  const skip = parts.slice(0, i - 1).join('').length;
  return { index: nx.index + skip, text: nx[0].slice(skip) };
}
/**
 * Wartość pola adresowego z kolejnymi polami w tym samym wierszu: każda wartość dostaje maskę swojego
 * pola (gdy etykieta jest znanym polem formularza), a etykiety i pola spoza listy („PESEL:", „Data:",
 * „Telefon:") zostają dla dalszych przebiegów. Null, gdy w wartości nie ma kolejnej etykiety.
 */
// Pola rozpoznawane tylko jako KOLEJNE pole spłaszczonego wiersza adresu („Ulica: Długa 5 M.: 3",
// „… Lokal: 5", „… Miasto: Warszawa"). Samodzielne „Lokal: 5" czy „Miasto: Kraków – Urząd Miasta"
// nie są kotwicą (nagłówki urzędów, opis lokalu), więc tych etykiet nie ma w FORM_FIELDS.
// Numer lokalu tylko liczbowy („M.:" bywa też skrótem miasta). „Piętro:" i „Gmina:" zostają jawne.
const FLAT_ONLY_FIELDS: FormField[] = [
  { re: /^(?:m|lok|lokal|mieszk|mieszkanie)\.?$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:miasto|poczta)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
];
function maskFlatFormFields(
  ctx: RedactCtx,
  field: FormField,
  val: string,
  numbered: boolean,
  maskOf: (f: FormField, v: string, label: string) => string,
): string | null {
  const segs: { label: string; value: string }[] = [];
  let label = '';
  let rest = val;
  for (let n = 0; n < 8; n++) {
    const nx = flatNextLabel(rest);
    if (!nx || nx.index === 0) break;
    let value = rest.slice(0, nx.index);
    let num = '';
    const no = numbered ? RE_FLAT_FIELD_NO_END.exec(value) : null;
    if (no) {
      num = no[0];
      value = value.slice(0, no.index);
    }
    segs.push({ label, value });
    label = num + nx.text;
    rest = rest.slice(nx.index + nx.text.length);
  }
  if (!segs.length) return null;
  // numer kolejnej pozycji na końcu wiersza („Nr domu:  19.") to etykieta pustego pola, nie wartość
  const lastNo = numbered ? RE_FLAT_FIELD_NO_END.exec(rest) : null;
  segs.push({ label, value: lastNo ? rest.slice(0, lastNo.index) : rest });
  if (lastNo) segs.push({ label: lastNo[0], value: '' });
  let out = '';
  for (let k = 0; k < segs.length; k++) {
    const { label: lb, value } = segs[k];
    const lbl = k === 0 ? '' : formLabelOf(stripFormPrefix(lb.replace(/:[ \t]*$/, '')));
    let f = k === 0 ? field : FORM_FIELDS.find((ff) => ff.re.test(lbl));
    let flatOnly = false;
    if (!f && k > 0) {
      f = FLAT_ONLY_FIELDS.find((ff) => ff.re.test(lbl));
      flatOnly = !!f;
    }
    // Przecinek albo średnik przed etykietą następnego pola („Ulica: Lipowa, Nr domu: 3, Nr lokalu:
    // brak") rozdziela pola, nie należy do wartości: maska zjadała go tylko przy zamaskowanych polach.
    const vt = value.trim().replace(/[ \t]*[,;]$/, '');
    if (
      f &&
      !f.gated &&
      f.kind !== 'date' &&
      ctx.on(f.type) &&
      vt &&
      isValidFormValue(vt, f.kind) &&
      (!flatOnly || f.kind !== 'addr' || /^\d{1,3}[A-Za-z]?$/.test(vt))
    ) {
      const lead = /^[ \t]*/.exec(value)?.[0] ?? '';
      // kolejne pole osobowe w trybie pseudonimów dostaje etykietę osoby (spójną z prozą)
      out += `${lb}${lead}${k === 0 ? f.mask : maskOf(f, vt, lbl)}${value.slice(lead.length + vt.length)}`;
      ctx.bump(f.type);
    } else out += lb + value;
  }
  return out;
}
// Komórka „Etykieta: wartość" w wierszu formularza rozdzielonym TAB-em („Imię: Jan⇥Nazwisko: Kowal").
// Kropka skrótu w etykiecie („Data ur.:", „Miejsce ur.:", „Nr tel.:") — inaczej komórka nie była
// ani etykietą, ani wartością, wiersz zostawał bez podziału i imię przed nią wyciekało.
const RE_TAB_CELL_LABEL = /^[ ]*(?:\d{1,2}[.)][ ]*)?\p{L}(?:[\p{L} ()]|\.(?=[ ]*[\p{L}:])){0,40}:/u;
// Etykieta pola bez dwukropka w osobnej komórce („Imię⇥Adam⇥Nazwisko⇥Nowak", „Imię:⇥Jan⇥Data ur.⇥
// 03.04.1980") — ZAMKNIĘTA lista etykiet osobowych i identyfikatorów. Inaczej wiersz nie dzielił się
// na pola, a imię obok zamaskowanego nazwiska zostawało jawne (dawniej osoba zjadała etykietę).
const RE_TAB_BARE_LABEL =
  /^[ ]*(?:(?:pierwsze[ ]+|drugie[ ]+)?imi[eę](?:[ ]+(?:ojca|matki))?|imiona|nazwisko(?:[ ]+(?:rodowe|panie[nń]skie))?(?:[ ]+matki)?|imi[eę][ ]+i[ ]+nazwisko|nazwisko[ ]+i[ ]+imi[eę]|data[ ]+ur(?:\.|odzenia)|miejsce[ ]+ur(?:\.|odzenia)|pesel|nip|tel(?:\.|efon)|nr[ ]+tel(?:\.|efonu)|e-?mail|adres|ulica|miejscowo[sś][cć]|kod[ ]+pocztowy|nr[ ]+dowodu|płeć|obywatelstwo)[ ]*$/iu;
// Komórka „etykieta wartość" bez dwukropka („Data ur. 03.04.1980", „PESEL 44051401359", „Tel. 600…")
// to osobne pole — tylko etykiety identyfikatorów, nie osobowe („Imię Jan" bywa nagłówkiem prozy).
// Nazwy kolumn, które w nagłówku tabeli stoją za etykietą osobową („Nazwisko⇥Imię⇥Stanowisko").
const TAB_HEADER_WORDS = new Set<string>([
  ...FORM_LABEL_WORDS,
  ...'wiek miasto lokal dział stanowisko uwagi status lp funkcja rola klasa grupa oddział stopień ocena wynik kwota termin podpis'.split(' '),
]);
const RE_TAB_LABEL_VALUE =/^[ ]*(?:data[ ]+ur(?:\.|odzenia)|pesel|nip|tel(?:\.|efon)|nr[ ]+tel(?:\.|efonu)?)[ ]+[\p{L}\d]/iu;
function passFormFields(ctx: RedactCtx): void {
  // Wiersz z co najmniej dwiema komórkami „Etykieta: wartość" rozdzielonymi TAB-em to kilka pól
  // w jednym wierszu („Imię: Wiesław⇥Nazwisko: Grzelak⇥PESEL: …"). Każdą komórkę przetwarzamy
  // jak osobny wiersz: wartość „Wiesław⇥Nazwisko: Grzelak" nie jest imieniem i odpadała w całości,
  // więc imię (i imiona rodziców w następnych komórkach) zostawały jawne. Wiersz TSV z danymi
  // („Nazwisko:⇥Gzowski⇥Kadry") ma tylko jedną komórkę-etykietę i zostaje bez zmian.
  const lines: string[] = [];
  const groups: { n: number; seps: string[] }[] = [];
  const tabCell = new Set<number>();
  // komórka „etykieta bez dwukropka⇥wartość" → długość etykiety z separatorem (początek wartości)
  const bareLabel = new Map<number, number>();
  // Tryb pseudonimów: nazwisko z komórki „Nazwisko" tego samego wiersza formularza (indeks pierwszej
  // komórki wiersza → nazwisko). Imię w osobnej komórce („Imię⇥Tomasz⇥Nazwisko⇥Wróblewski") dostaje
  // pseudonim tej samej osoby, a nie ogólną etykietę obok [OSOBA-A].
  const rowSurname = new Map<number, string>();
  const noteRowSurname = (first: number, units: string[]): void => {
    if (!ctx.pseudonyms) return;
    const sur = units
      .map((u) => /^[ ]*nazwisko[ ]*:[ \t]*(\p{Lu}[\p{L}-]+)[ \t]*$/iu.exec(u)?.[1])
      .filter((v): v is string => !!v);
    if (sur.length !== 1) return;
    for (let k = 0; k < units.length; k++) rowSurname.set(first + k, sur[0]);
  };
  const srcLines = ctx.text.split('\n');
  // Czy pod wierszem stoi wiersz tabeli z tą samą liczbą komórek (wtedy wiersz to nagłówek)?
  // Etykieta w formularzu z TAB-em (pozycja parzysta): pole osobowe albo identyfikator, rola osoby
  // („Pacjent", „Ojciec") albo nazwa pola spoza osoby („Stanowisko", „Dział", „Oddział").
  const tabLabelish = (c: string): boolean => {
    const l = c.trim().toLowerCase();
    return RE_TAB_CELL_LABEL.test(c) || RE_TAB_LABEL_VALUE.test(c) || RE_TAB_BARE_LABEL.test(c) || TAB_ROLE_LABELS.has(l) || TAB_HEADER_WORDS.has(l);
  };
  // Czy pod wierszem stoi wiersz DANYCH tabeli z tą samą liczbą komórek (wtedy wiersz to nagłówek)?
  // Wiersz formularza pod spodem („Telefon⇥600…⇥E-mail⇥…", „Oddział⇥Wewnętrzny⇥Sala⇥4") ma na
  // pozycjach parzystych etykiety — to dalszy formularz, nie dane pod nagłówkiem.
  const tabRowBelow = (li: number, n: number): boolean => {
    let j = li + 1;
    while (j < srcLines.length && srcLines[j].trim() === '') j++;
    if (j >= srcLines.length) return false;
    const below = srcLines[j].split(/\t+/);
    return below.length === n && !below.some((c, k) => k % 2 === 0 && tabLabelish(c));
  };
  for (let li = 0; li < srcLines.length; li++) {
    const ln = srcLines[li];
    if (ln.includes('\t')) {
      const parts = ln.split(/(\t+)/);
      const cells = parts.filter((_p, k) => k % 2 === 0);
      const fieldCell = (c: string): boolean => RE_TAB_CELL_LABEL.test(c) || RE_TAB_LABEL_VALUE.test(c);
      const labelCell = (c: string): boolean => fieldCell(c) || RE_TAB_BARE_LABEL.test(c);
      const labelled = cells.filter(fieldCell).length;
      if (labelled >= 2 && cells.every((c) => c.trim() === '' || fieldCell(c))) {
        noteRowSurname(lines.length, cells);
        for (const c of cells) {
          tabCell.add(lines.length);
          lines.push(c);
        }
        groups.push({ n: cells.length, seps: parts.filter((_p, k) => k % 2 === 1) });
        continue;
      }
      // Etykieta i wartość w osobnych komórkach („Imię:⇥Adam⇥Nazwisko:⇥Nowak", eksport z Excela
      // albo tabeli Worda): para „etykieta bez wartości⇥wartość" to jedno pole. Każda komórka bez
      // etykiety musi stać tuż za taką pustą etykietą — wiersz TSV z danymi („Nazwisko:⇥Gzowski⇥
      // Kadry") dalej zostaje bez zmian. Dawniej imię i imiona rodziców zostawały jawne obok
      // zamaskowanego nazwiska.
      // Etykieta bez dwukropka („Imię⇥Adam⇥Nazwisko⇥Nowak", „Imię:⇥Jan⇥Data ur.⇥03.04.1980") też
      // tworzy parę z następną komórką; początek wartości trafia do bareLabel.
      // Nagłówek tabeli („Nazwisko⇥Imię⇥Stanowisko", „Imię i nazwisko⇥Lokal⇥Telefon") to nie pary:
      // przy etykiecie bez dwukropka wszystkie komórki muszą tworzyć pary „etykieta⇥wartość",
      // wartość nie jest nazwą kolumny, a wiersz pod nim nie ma tylu samo komórek.
      // Wiersz, w którym komórki NA PRZEMIAN są etykietami i wartościami, to formularz („Imię⇥Adam⇥
      // Nazwisko⇥Nowak", „Pacjent⇥Jan⇥Nazwisko⇥Kowal", „Nazwisko⇥Marek⇥Stanowisko⇥kierowca"), także
      // z dalszymi wierszami formularza pod spodem. Nagłówek tabeli to wiersz z samych nazw kolumn.
      // Wartość pod etykietą imienia musi być imieniem („Imię⇥Szkoła⇥Nazwisko⇥Przedmiot" to nagłówek).
      const roleAt = (k: number): boolean =>
        k % 2 === 0 && TAB_ROLE_LABELS.has(cells[k].trim().toLowerCase()) && k + 1 < cells.length && POLISH_FIRST_NAMES.has(cells[k + 1].trim().toLowerCase());
      const bareRow = cells.some((c, k) => RE_TAB_BARE_LABEL.test(c) || roleAt(k));
      const isValueCell = (c: string): boolean => {
        const l = c.trim().toLowerCase();
        // rola małą literą to wartość pola („Funkcja⇥świadek"), wielką — etykieta („Świadek⇥Jan")
        return l !== '' && !labelCell(c) && !TAB_HEADER_WORDS.has(l) && !(TAB_ROLE_LABELS.has(l) && /^[ ]*\p{Lu}/u.test(c));
      };
      const bareOk =
        !bareRow ||
        (cells.length % 2 === 0 &&
          cells.every((c, k) => (k % 2 === 0 ? tabLabelish(c) : isValueCell(c))) &&
          cells.every((c, k) => k % 2 === 1 || !/^[ ]*(?:pierwsze[ ]+|drugie[ ]+)?imi[eę](?:[ ]+(?:ojca|matki))?[ ]*$/iu.test(c) || isFirstNameLike(cells[k + 1].trim().split(/[ ]+/)[0])) &&
          !tabRowBelow(li, cells.length));
      if (bareOk && (bareRow ? cells.filter((c, k) => k % 2 === 0 && tabLabelish(c)).length : cells.filter(labelCell).length) >= 2) {
        const seps = parts.filter((_p, k) => k % 2 === 1);
        const units: string[] = [];
        const unitSeps: string[] = [];
        const unitBare: number[] = [];
        let pairs = 0;
        let ok = true;
        for (let k = 0; k < cells.length && ok; k++) {
          const c = cells[k];
          if (k > 0) unitSeps.push(seps[k - 1]);
          const colonLabel = /^[^:]*:[ ]*$/.test(c) && RE_TAB_CELL_LABEL.test(c);
          const bareLbl = !colonLabel && (RE_TAB_BARE_LABEL.test(c) || (bareRow && k % 2 === 0 && tabLabelish(c) && !fieldCell(c)));
          if ((colonLabel || bareLbl) && k + 1 < cells.length && cells[k + 1].trim() !== '' && !labelCell(cells[k + 1])) {
            units.push(c + seps[k] + cells[k + 1]);
            unitBare.push(bareLbl ? c.length + seps[k].length : 0);
            pairs++;
            k++;
          } else if (c.trim() === '' || labelCell(c)) {
            units.push(c);
            unitBare.push(0);
          } else ok = false;
        }
        if (ok && pairs) {
          const first = lines.length;
          for (let u = 0; u < units.length; u++) {
            tabCell.add(lines.length);
            if (unitBare[u]) bareLabel.set(lines.length, unitBare[u]);
            lines.push(units[u]);
          }
          noteRowSurname(first, units.map((u, k) => (unitBare[k] ? `${u.slice(0, unitBare[k]).trim()}: ${u.slice(unitBare[k])}` : u)));
          groups.push({ n: units.length, seps: unitSeps });
          continue;
        }
      }
    }
    lines.push(ln);
    groups.push({ n: 1, seps: [] });
  }
  // Wyrazy stojące samotnie po tytule („Pani Nguyen", „Pan Gruber") — liczone raz, na żądanie.
  let titled: Set<string> | null = null;
  const titledSingles = (): Set<string> => {
    if (!titled) {
      titled = new Set<string>();
      for (const mm of ctx.text.matchAll(RE_TITLED_SINGLE)) titled.add(mm[1].toLowerCase());
    }
    return titled;
  };
  // Klucz (nierozpoznany) → drugi wyraz wartości, który przy nim stał (wykrycie kolizji niżej).
  const ambiguousKeys = new Map<string, string>();
  // Maska wartości: stała, a w trybie pseudonimów dla pól z nazwiskiem (surnameAt) — etykieta
  // osoby kluczowana nazwiskiem, jak w przebiegach osób, które takie pole łapały wcześniej.
  const maskFor = (field: FormField, val: string): string => {
    if (!field.surnameAt || !ctx.pseudonyms) return field.mask;
    const ws = val.trim().split(/[ \t]+/);
    let [sur, other] = field.surnameAt === 'first' ? [ws[0], ws[ws.length - 1]] : [ws[ws.length - 1], ws[0]];
    let ambiguous = false;
    if (ws.length > 1) {
      const fnS = isFirstNameLike(sur);
      const fnO = isFirstNameLike(other);
      // wartość wpisana w odwrotnym szyku niż etykieta („Imię i nazwisko:⏎WILK JADWIGA")
      if (fnS && !fnO) [sur, other] = [other, sur];
      else if (fnS === fnO) {
        // imię spoza słownika („Kuba Kowal", „Bondarenko Olena", „Nguyen Thi Hoa"): nazwiskiem jest
        // wyraz rozpoznany jako nazwisko, a gdy żaden — ten, który gdzie indziej stoi sam po tytule
        // („Pani Nguyen"). Dawniej kluczem zostawało imię i dwie osoby o tym samym imieniu dostawały
        // jedną etykietę.
        const cS = isConfirmedSurname(sur);
        const cO = isConfirmedSurname(other);
        if (!cS && cO) [sur, other] = [other, sur];
        else if (!cS && !cO) {
          ambiguous = true;
          if (titledSingles().has(other.toLowerCase()) && !titledSingles().has(sur.toLowerCase())) [sur, other] = [other, sur];
        }
      }
    }
    // fragment przeniesienia („Mał-⏎gorzata") albo inicjał nie jest kluczem tożsamości
    if (!/^\p{L}{2,}(?:-\p{L}{2,})*$/u.test(sur)) return field.mask;
    if (ambiguous) {
      // ten sam nierozpoznany klucz przy innym drugim wyrazie („Hans Schmidt", „Hans Becker",
      // „Nguyen Van Minh", „Tran Van Minh") — to dwie osoby; kluczem drugiej jest cała wartość
      const k = normalizeSurnameKey(sur);
      const o = other.toLowerCase();
      const seen = ambiguousKeys.get(k);
      if (seen !== undefined && seen !== o) return ctx.personMask(ws.join(' '));
      ambiguousKeys.set(k, o);
    }
    return ctx.personMask(sur);
  };
  // Dawne pole „Imię i nazwisko:" (stała maska) w komórce wiersza z TAB-ami albo jako kolejne pole
  // spłaszczonego adresu: w trybie pseudonimów etykieta osoby kluczowana nazwiskiem, spójna z prozą
  // („Imię i nazwisko: Jan Kowalski⇥Lokal: 12" … „Pan Jan Kowalski" → ta sama [OSOBA-A]).
  // Samo nazwisko w komórce („Imię: Jan⇥Nazwisko: Kowalski" … „Pan Jan Kowalski") też dostaje
  // etykietę osoby kluczowaną tym nazwiskiem — stała maska zrywała powiązanie z prozą.
  const maskCell = (field: FormField, val: string, label: string): string => {
    const single = val.trim().split(/[ \t]+/).length < 2;
    if (field.kind !== 'name' || field.surnameAt || !ctx.pseudonyms || !/nazwisk/i.test(label) || (single && !/^nazwisk/i.test(label)))
      return maskFor(field, val);
    return maskFor({ ...field, surnameAt: /^nazwisko/i.test(label) ? 'first' : 'last' }, val);
  };
  for (let i = 0; i < lines.length; i++) {
    // komórka „etykieta bez dwukropka⇥wartość" czytana jak „etykieta: wartość"
    const bareAt = bareLabel.get(i);
    const bare = bareAt ? `${lines[i].slice(0, bareAt).trim()}: ${lines[i].slice(bareAt)}` : stripFormPrefix(lines[i]);
    const label = formLabelOf(bare); // raz na linię, nie dla każdego pola z FORM_FIELDS
    const field = FORM_FIELDS.find((f) => f.re.test(label));
    // Rola osoby w komórce wiersza z TAB-ami („Świadek:⇥Jan⇥Nazwisko:⇥Kowalski", „Ojciec:⇥Jan⇥
    // Matka:⇥Ewa"): samo imię ze słownika jako cała wartość komórki to osoba. Po podziale wiersza
    // na pary „etykieta⇥wartość" zostawało jawne obok zamaskowanego nazwiska. Proza i zwykły
    // wiersz „Świadek: Jan" bez zmian.
    if (!field && tabCell.has(i) && ctx.on('IMIE')) {
      const rv = /^([\p{L} ]{2,30}):[ \t]+(\p{Lu}\p{Ll}+)[ \t]*$/u.exec(bare);
      const nl = rv?.[2].toLowerCase() ?? '';
      if (rv && TAB_ROLE_LABELS.has(rv[1].trim().toLowerCase()) && POLISH_FIRST_NAMES.has(nl) && !NOUN_LIKE_FIRST_NAMES.has(nl)) {
        const rowSur = rowSurname.get(i);
        lines[i] = lines[i].replace(new RegExp(`${escapeRe(rv[2])}(?=[ \\t]*$)`), () => (rowSur ? ctx.personMask(rowSur) : ctx.M.IMIE));
        ctx.bump('IMIE');
      }
      continue;
    }
    if (!field || !ctx.on(field.type)) continue;
    const colon = bare.match(/:\s*(.+)$/); // „Etykieta: WARTOŚĆ" w tej samej linii
    if (colon) {
      // Lista imion („Imiona rodziców: Jan, Anna", „Jan i Anna") — każde imię dostaje maskę; dawniej
      // wartość z przecinkiem odpadała w całości i oba imiona zostawały jawne.
      const list = field.nameList ? /^(\p{Lu}\p{Ll}+)([ \t]*,[ \t]*|[ \t]+(?:i|oraz)[ \t]+)(\p{Lu}\p{Ll}+)$/u.exec(colon[1].trim()) : null;
      if (list && isFirstNameLike(list[1]) && isFirstNameLike(list[3])) {
        const at = lines[i].lastIndexOf(list[0]);
        lines[i] = `${lines[i].slice(0, at)}${field.mask}${list[2]}${field.mask}${lines[i].slice(at + list[0].length)}`;
        ctx.bump(field.type);
        ctx.bump(field.type);
        continue;
      }
      // pod tą etykietą tylko imiona — dopisek („zgodnie z aktem urodzenia", „Urząd Stanu Cywilnego") zostaje
      if (field.nameList && !isFirstNameLike(colon[1].trim())) continue;
      // Data w tej samej linii ma już swój detektor (passBirthDate), więc same-line
      // obsługujemy tylko dla imion/miejsc/adresów.
      if (field.kind === 'date') continue;
      const val = colon[1].trim();
      // Formularz spłaszczony do wiersza („Numer budynku: 7 PESEL: 85031412347", „Ulica: Krótka
      // Nr domu: 7 Miejscowość: Mysiadło"): wartość pola adresowego kończy się przed etykietą
      // następnego pola. Dawniej maska [ADRES] zjadała etykietę i wartość kolejnego pola (albo
      // wartość odpadała w całości i ulica zostawała jawna).
      if (field.kind === 'addr') {
        const flat = maskFlatFormFields(ctx, field, val, RE_FLAT_FORM_NUMBERED.test(lines[i]), maskCell);
        if (flat !== null) {
          const at = lines[i].lastIndexOf(val);
          lines[i] = `${lines[i].slice(0, at)}${flat}${lines[i].slice(at + val.length)}`;
          continue;
        }
      }
      if (isValidFormValue(val, field.kind)) {
        if (field.gated) {
          const g = gatedPersonValue(val, false, !!field.surnameOnly);
          if (!g) continue;
          const at = lines[i].lastIndexOf(val);
          const mask = maskFor(field, g.core);
          lines[i] = `${lines[i].slice(0, at)}${g.lead}${mask}${g.tail}${lines[i].slice(at + val.length).replace(/^[^\S\r]+/, '')}`;
          ctx.bump(field.type);
          continue;
        }
        // Końcowe „\r" (tekst z CRLF dzielimy po „\n") zostaje — inaczej linia z zamaskowanym
        // polem traciła windowsowy koniec wiersza i plik wychodził z mieszanymi końcami linii.
        const rowSur = tabCell.has(i) ? rowSurname.get(i) : undefined;
        const mask =
          rowSur && /^(?:pierwsze[ ]+|drugie[ ]+)?imi[eę]$/iu.test(label) && /^\p{Lu}\p{Ll}+$/u.test(val)
            ? ctx.personMask(rowSur)
            : tabCell.has(i)
              ? maskCell(field, val, label)
              : maskFor(field, val);
        lines[i] = lines[i].replace(new RegExp(`${escapeRe(val)}[^\\S\\r]*(?=\\s*$)`), () => mask);
        ctx.bump(field.type);
      }
      continue;
    }
    // wartość w następnej NIEPUSTEJ linii — pomiń puste i podpowiedzi w nawiasach
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || /^\(.*\)$/.test(lines[j].trim()))) j++;
    if (j >= lines.length || isFormLabelLine(lines[j])) continue;
    // pusta komórka-etykieta w wierszu z TAB-ami: następna komórka to inne pole, nie wartość
    if (tabCell.has(i) && tabCell.has(j)) continue;
    // Ostatnia komórka-etykieta nagłówka („Nazwisko:⇥Miejscowość:⏎Kowalski⇥Radom"): wiersz pod
    // nią z TAB-em to cały wiersz danych tabeli, nie wartość tej jednej etykiety — maska miejsca
    // zjadała osobę i kolumny.
    if (tabCell.has(i) && lines[j].includes('\t')) continue;
    const val = lines[j].trim();
    if (!isValidFormValue(val, field.kind)) continue;
    if (field.nameList && !isFirstNameLike(val)) continue;
    if (field.kind === 'date') {
      // maskuj SAMĄ datę w linii wartości (zachowaj adnotacje: „1990-01-01 (wg aktu)")
      if (RE_DATE_VALUE.test(lines[j])) {
        lines[j] = lines[j].replace(RE_DATE_VALUE, field.mask);
        ctx.bump(field.type);
      }
      continue;
    }
    let lead = '';
    let core = val;
    let tail = '';
    if (field.gated) {
      const g = gatedPersonValue(val, true);
      if (!g) continue;
      ({ lead, core, tail } = g);
    }
    const mask = maskFor(field, core);
    lines[j] = lines[j].replace(/^(\s*)[\s\S]*?(\s*)$/, (_m, a: string, b: string) => `${a}${lead}${mask}${tail}${b}`);
    ctx.bump(field.type);
  }
  const out: string[] = [];
  let at = 0;
  for (const g of groups) {
    let row = lines[at];
    for (let k = 1; k < g.n; k++) row += g.seps[k - 1] + lines[at + k];
    out.push(row);
    at += g.n;
  }
  ctx.text = out.join('\n');
}

// 1c) STRUKTURA XML/JSON — tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna.
// Maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Blok BEZ pojedynczej bramki `on()` — structMask sprawdza typ per-wpis.
// Kategoria pod kluczem „osoba"/„person" („<osoba>Prawna</osoba>", „"person": "Fizyczna"") — nie osoba.
const PERSON_CATEGORY_VALUES = new Set<string>(
  'osoba prawna prawne fizyczna fizyczne kontaktowa kontaktowe upoważniona upoważnione zainteresowana trzecia legal natural physical juridical person'.split(' '),
);
// Jeden wyraz pod „osoba"/„person", który jest rolą, kategorią albo odpowiedzią, a nie nazwiskiem
// („Pracownik", „Klient", „Admin", „Dorosła", „Tak"). Uzupełnia ROLE_WORDS, GENERIC_LOGINS
// i PERSON_CATEGORY_VALUES; każdy inny wyraz pod tym kluczem to osoba.
const PERSON_ROLE_VALUES = new Set<string>(
  (
    'tak nie inna inny inne anonim anonimowa anonimowy anonymous dorosła dorosły pełnoletnia pełnoletni ' +
    'niepełnoletnia niepełnoletni małoletnia małoletni dziecko opiekun opiekunka rodzic zgłaszający ' +
    'zgłaszająca główna główny dodatkowa dodatkowy pierwsza druga kontakt użytkownik użytkowniczka ' +
    'gość klientka pracownica wnioskodawczyni petent petentka interesant interesantka adresat nadawca ' +
    'odbiorca kierownik kierowniczka specjalista specjalistka konsultant konsultantka agent operator ' +
    'matka ojciec syn córka brat siostra mąż żona partner partnerka babcia dziadek wnuczka ' +
    'customer client user employee manager owner contact guest member admin'
  ).split(/\s+/),
);
const isPersonRoleValue = (w: string): boolean =>
  PERSON_CATEGORY_VALUES.has(w) ||
  PERSON_ROLE_VALUES.has(w) ||
  ROLE_WORDS.has(w) ||
  GENERIC_LOGINS.has(w) ||
  TITLE_WORDS.has(w) ||
  LEGAL_ENTITY_WORDS.has(w) ||
  FORM_LABEL_WORDS.has(w);
// Tytuł albo inicjał przed nazwiskiem w wartości pola („dr Gzik", „lek. Gzik", „j. kowalski") —
// nie odbiera wartości charakteru imienia i nazwiska, jak partykuła „van".
const RE_VALUE_TITLE_OR_INITIAL =
  /^(?:\p{L}\.|dr|dra|dr\.|mgr|mgr\.|inż\.?|prof\.?|lek\.?|med\.?|hab\.?|doc\.?|mec\.?|adw\.?|ks\.?|n\.|pan|pani|sz\.p\.)$/iu;
// Imiona, które są też rzeczownikiem pospolitym albo nazwą rośliny/produktu („róża", „kalina",
// „jagoda", „pola", „maja") — zapisane małą literą bez nazwiska nie przesądzają o osobie.
const NOUN_LIKE_FIRST_NAMES = new Set<string>('róża kalina jagoda nadzieja wiktoria pola wiola maja'.split(' '));
// Z nich te, które po przymiotniku tworzą typową nazwę („Olimpijska Nadzieja", „Polska Róża") —
// wpis „Przymiotnik Imię" na liście jest wtedy nazwą. „Mazowiecka Maja", „Gdańska Pola" czy
// „Poznańska Wiktoria" w wykazie osób to już osoba w szyku „Nazwisko Imię".
const NOUN_LIKE_NAMES_IN_TITLES = new Set<string>(['nadzieja', 'róża', 'kalina']);
// Partykuły nazwisk („Jan van Dijk", „de la Cruz") — nie są ani imieniem, ani nazwiskiem.
const SURNAME_PARTICLES = new Set<string>('van von de del della der den di da du dos das la le ter ten'.split(' '));
// Wyraz małą literą o końcówce przymiotnika, imiesłowu, dopełniacza albo zdrobnienia („koralowa",
// „pnąca", „pustyni", „pszczółka") — w nazwie produktu częsty, w nazwisku spoza słownika rzadki.
// Po zwykłym imieniu (spoza NOUN_LIKE_FIRST_NAMES) drugi wyraz odrzucają tylko końcówki przymiotnika
// i dopełniacza: „-ka/-ko/-na/-enko" to częste nazwiska („ewa pietka", „jan sitko", „jan wolny",
// „tetiana szewczenko"), a pod kluczem „name"/„osoba" stoi osoba. Ścisły test zostaje dla imion-rzeczowników.
const RE_LOWER_NOT_SURNAME_LENIENT = /(?:ąc[aey]|yni|ii|ej|ego|ow[aey])$/;
const RE_LOWER_NOT_SURNAME = /(?:ow[aey]|n[aey]|ąc[aey]|yni|ii|ej|ego|k[aio])$/;
/**
 * Czy wartość małymi literami pod generycznym „name"/„osoba" to osoba („anna", „anna gzik",
 * „marek sowa", „nowak anna", „jan van dijk")? Proza łapie tylko nazwiska ze słownika, więc imię
 * z homografem albo z rzadkim nazwiskiem w zrzucie bazy czy eksporcie czatu wyciekało w całości.
 * Nazwa produktu („róża pustyni", „kalina koralowa", „weronika kłosowa") i kategoria („prawna")
 * zostają: imię-rzeczownik bez potwierdzonego nazwiska albo drugi wyraz o końcówce przymiotnika.
 */
function lowercaseNameLooksLikePerson(words: string[]): boolean {
  // inicjał i tytuł przed nazwiskiem („j. kowalski", „dr kowalski", „lek. gzik") pomijamy jak
  // partykułę — bramka wymagała imienia na początku, więc nazwisko ze słownika zostawało jawne
  const lower = words.map((w) => w.toLowerCase()).filter((w) => !SURNAME_PARTICLES.has(w));
  const ws = lower.filter((w) => !RE_VALUE_TITLE_OR_INITIAL.test(w));
  if (!ws.length) return false;
  const confirmed = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(w);
  const plausible = (w: string): boolean => confirmed(w) || POLISH_FIRST_NAMES.has(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME.test(w));
  const [first] = ws;
  const last = ws[ws.length - 1];
  // jeden wyraz: nazwisko ze słownika/morfologii („a.kaminska" — nazwa konta) albo imię; homograf
  // sam („kalina", „sowa") to raczej nazwa. Po inicjale albo tytule („j. gzik", „dr gzik") każdy
  // wyraz o kształcie nazwiska — inicjał to kotwica osoby.
  if (ws.length === 1) {
    if (ws.length < lower.length && plausible(first) && !isPersonRoleValue(first)) return true;
    return !!surnameBase(first) || looksLikeSurname(first) || (POLISH_FIRST_NAMES.has(first) && !NOUN_LIKE_FIRST_NAMES.has(first));
  }
  const rest = ws.slice(1);
  if (POLISH_FIRST_NAMES.has(first)) {
    if (rest.every((w) => confirmed(w) || POLISH_FIRST_NAMES.has(w))) return true;
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && rest.every((w) => plausible(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME_LENIENT.test(w)))) return true;
    // imię-rzeczownik („maja", „wiktoria", „pola") też z nazwiskiem spoza słownika („maja gzik",
    // „wiktoria kos"); nazwa produktu ma drugi człon przymiotnikowy albo w dopełniaczu („kalina
    // koralowa", „róża pustyni", „pola lawendy"), a tych `plausible` i końcówka -y/-i/-u nie przepuszczą
    if (rest.every((w) => plausible(w) && !/(?:[iyu]|ów)$/.test(w))) return true;
    // imię z dopiskiem działu czy miejsca („kasia z księgowości", „marek od kadr")
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && /^(?:z|ze|od|do|u)$/.test(rest[0])) return true;
  }
  // szyk odwrócony „nowak anna", „sowa teresa" — nazwisko potwierdzone (inaczej „pasta Barbara",
  // nazwa produktu z imieniem na końcu, szła jako osoba)
  return POLISH_FIRST_NAMES.has(last) && !NOUN_LIKE_FIRST_NAMES.has(last) && ws.slice(0, -1).every(confirmed);
}

// Rola albo rzeczownik, który jest też częstym nazwiskiem („Marszałek", „Wójt", „Dziadek", „Koło")
// — pod kluczem „osoba"/„person" wartość z wielkiej litery to wtedy nazwisko, nie rola.
const ROLE_HOMOGRAPH_SURNAMES = new Set<string>('marszałek wójt dziadek dziekan komornik król starosta koło kowal'.split(' '));
const RE_EVENT_DATA_NAME = /\sName\s*=\s*["']([\p{L}_][\p{L}\p{N}_.-]{0,40})["']/u;
// Otwarty tag z atrybutami (każdy atrybut zaczyna się literą, wartość w cudzysłowie — podział jednoznaczny).
const RE_XML_TAG_WITH_ATTRS =
  /<[\p{L}_][\p{L}\p{N}_.:-]{0,40}(?:[ \t\r\n]+[\p{L}_][\p{L}\p{N}_.:-]{0,40}[ \t]*=[ \t]*(?:"[^"<>\r\n]{0,80}"|'[^'<>\r\n]{0,80}'))+[ \t\r\n]*\/?>/gu;
const RE_XML_ATTR = /([\p{L}_][\p{L}\p{N}_.:-]{0,40})([ \t]*=[ \t]*)(["'])([^"'<>\r\n]{1,80})\3/gu;
const RE_XML_INSTITUTION_TAG =
  /^<(?:[\p{L}_][\p{L}\p{N}_.-]*:)?(?:urzad|urząd|sad|sąd|oddzial|oddział|szkola|szkoła|bank|organ|instytucja|jednostka|podmiot|placowka|placówka|organizacja)|[ \t\r\n](?:nazwa|bank|patron|organ|urzad|urząd|siedziba)[ \t]*=/iu;
const RE_XML_PERSON_ATTR =
  /[ \t\r\n](?:imie|imię|imiona|nazwisko|first[_-]?name|last[_-]?name|given[_-]?name|surname|full[_-]?name|pesel)[ \t]*=/iu;
// Atrybut XML z kluczem osobowym bywa ustawieniem szablonu albo schematu: „imie="tak"", „nazwisko=
// "rosnąco"", „imie="false"", przykładowa wartość „imie="Imię" nazwisko="Nazwisko"" czy „imie="Wójt"
// nazwisko="Gminy"". Tu wartość musi mieć kształt nazwy własnej (wielka litera na początku każdego
// wyrazu) i nie może być nazwą pola, rolą, urzędem ani wypełniaczem.
// Nazwisko-homograf roli („nazwisko="Marszałek"") zostaje nazwiskiem jak pod kluczem „osoba".
const XML_ATTR_NAME_STOP = new Set<string>(
  (
    'danych dane brak test testowy testowa przykład przykładowy przykładowa string true false referatu wydziału działu biura sekretariatu ' +
    // podmioty państwowe i zbiorowe („nazwisko="Skarb Państwa"", „fullName="Lasy Państwowe"")
    'skarb państwa państwowe państwowy państwowa lasy wspólnota mieszkaniowa'
  ).split(' '),
);
function xmlAttrNameValue(value: string, kind: StructKind): boolean {
  const v = value.trim();
  if (!RE_PROPER_WORDS.test(v) || RE_TABLE_REGNAL_CELL.test(v)) return false;
  const ws = v.split(/[ \t]+/);
  if (kind === 'surname' && ws.length === 1 && ROLE_HOMOGRAPH_SURNAMES.has(ws[0].toLowerCase())) return true;
  return ws.every((w) => {
    const l = w.toLowerCase();
    return !XML_ATTR_NAME_STOP.has(l) && !STRUCT_KEYS.has(normStructKey(w)) && !ROLE_WORDS.has(l) && !LEGAL_ENTITY_WORDS.has(l) && !FORM_LABEL_WORDS.has(l) && !isPersonRoleValue(l);
  });
}
/** Maska wartości pod kluczem strukturalnym (wspólna dla XML, JSON i nagłówka tabeli) — z bramką
 *  kształtu danego rodzaju; `null`, gdy wartość nie wygląda na daną tego rodzaju. */
/**
 * Klucz osoby (nazwisko) z wartości pola struktury. Rozstrzyga słownik imion („Domański Witold" →
 * Domański, „Witold Domański" → Domański), a gdy nie rozstrzyga — szyk z nagłówka („Nazwisko
 * i imię" → pierwszy wyraz). Dawniej kluczem był zawsze ostatni wyraz: w szyku „Nazwisko Imię"
 * było nim imię, więc dwie osoby o tym samym imieniu dostawały jeden pseudonim, a ta sama osoba
 * w tabeli i w prozie — dwa różne.
 */
function structSurnameKey(ws: string[], key?: string): string {
  const last = ws[ws.length - 1];
  if (ws.length < 2) return last;
  const fnF = isFirstNameLike(ws[0]);
  const fnL = isFirstNameLike(last);
  // Klucz w szyku „imię naprzód" („imieNazwisko", „Imię i nazwisko", „firstName…"): nazwisko-homograf
  // imienia na końcu („Iryna Roman", „Tetiana Marek") zostaje kluczem, chyba że pierwszy wyraz to
  // potwierdzone nazwisko (wpis odwrócony „Kowalski Jan"). Inaczej kluczem było obce imię spoza
  // słownika i dwie osoby o tym samym imieniu dostawały jeden pseudonim.
  // To samo pod kluczem bez szyku („fullName", „full_name", „osoba", „<fullName>"): szyk „Nazwisko
  // Imię" rozpoznaje tam dopiero potwierdzone nazwisko na początku, a obce imię („Iryna", „Halyna")
  // kluczem nie zostaje. Tylko klucz „nazwisko…" wskazuje szyk odwrotny.
  if (fnL && !fnF && key && !normStructKey(key).startsWith('nazwisk') && !isConfirmedSurname(ws[0])) return last;
  if (fnL && !fnF) return ws[0];
  if (fnF) return last;
  return key && normStructKey(key).startsWith('nazwisko') ? ws[0] : last;
}
function structMasker(ctx: RedactCtx): (kind: StructKind, value: string, key?: string) => string | null {
  return (kind: StructKind, value: string, key = ''): string | null => {
    const v = value.trim();
    if (!v || v.length > 70 || /[[\]]/.test(v) || v.includes(URL_SENTINEL_OPEN) || v.includes(URL_SENTINEL_CLOSE)) return null;
    if (isEmptyFormValue(v)) return null;
    switch (kind) {
      case 'first':
      case 'surname':
      case 'fullname':
        if (!isValidFormValue(v, 'name')) return null;
        break;
      case 'name':
      case 'person': {
        // generyczny „name" (i „osoba"/„person") bywa nazwą produktu, firmy albo kategorią. Zapis
        // małymi literami („Róża pustyni" pod „name", „<osoba>prawna</osoba>") przechodzi tylko,
        // gdy wygląda na osobę (lowercaseNameLooksLikePerson) — dopuszczenie małych liter (v0.46.15)
        // było dla MOCNYCH kluczy („firstName", „Imię:").
        if (!isValidFormValue(v, 'name')) return null;
        const ws = v.split(/\s+/);
        // partykuła, tytuł i inicjał małą literą nie odbierają wartości charakteru nazwy własnej
        // („Jan van Dijk", „dr Gzik", „lek. Gzik")
        const proper = ws.filter((w) => !SURNAME_PARTICLES.has(w) && !(/^\p{Ll}/u.test(w) && RE_VALUE_TITLE_OR_INITIAL.test(w)));
        if (!proper.length || !RE_PROPER_WORDS.test(proper.join(' '))) {
          // „osoba"/„person" małymi literami: jeden wyraz o kształcie nazwiska, który nie jest rolą
          // ani kategorią („gzik", „dr gzik" — ale „prawna", „fizyczna" zostają)
          const own = proper.map((w) => w.toLowerCase());
          if (kind === 'person' && own.length === 1 && own[0].length >= 3 && !RE_LOWER_NOT_SURNAME.test(own[0]) && !isPersonRoleValue(own[0])) break;
          if (!lowercaseNameLooksLikePerson(ws)) return null;
          break;
        }
        // „osoba"/„person" od wielkiej litery to osoba jak pod „fullname" — także szyk „NAZWISKO IMIĘ",
        // WERSALIKI, homograf i rzadkie nazwisko („Wróbel Anna", „KOWALSKI JAN", „T. Gzik", „Gzik",
        // „Smith"). Zostaje kategoria („Prawna", „Osoba Fizyczna") i jeden wyraz będący rolą czy
        // odpowiedzią („Pracownik", „Klient", „Wnioskodawca", „Admin"). Dawniej jeden wyraz musiał być
        // imieniem albo nazwiskiem ze słownika lub morfologii, więc rzadkie nazwisko wyciekało, choć
        // właśnie ono najbardziej identyfikuje osobę.
        if (kind === 'person') {
          if (ws.every((w) => PERSON_CATEGORY_VALUES.has(w.toLowerCase()))) return null;
          if (proper.length === 1 && isPersonRoleValue(proper[0].toLowerCase()) && !ROLE_HOMOGRAPH_SURNAMES.has(proper[0].toLowerCase())) return null;
          break;
        }
        // „name" od wielkiej litery: bramka słownikowa — pierwszy wyraz to imię albo ostatni to nazwisko
        const last = ws[ws.length - 1];
        if (!isFirstNameLike(ws[0]) && !surnameBase(last) && !looksLikeSurname(last)) return null;
        break;
      }
      case 'city':
        if (!isValidFormValue(v, 'place')) return null;
        break;
      case 'addr':
        if (!isValidFormValue(v, 'addr')) return null;
        break;
      case 'phone':
        if ((v.match(/\d/g) ?? []).length < 6 || /[A-Za-z]{3,}/.test(v)) return null;
        // data w kolumnie telefonu to stopka eksportu („Stan na;;01.10.2026", „Wydruk z dnia⇥⇥2026-10-01")
        if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
        break;
      case 'postal':
        if (!/^\d{2}[- ]?\d{3}$/.test(v)) return null;
        break;
      case 'birth':
        if (!RE_DATE_VALUE.test(v)) return null;
        break;
      case 'login':
        // Zapis Windows/AD „DOMENA\użytkownik" (w JSON-ie „\\") maskujemy w całości — dawniej
        // cała wartość wyciekała. Wbudowane konta systemowe zostają.
        if (!/^(?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._@-]{1,63}$/.test(v)) return null;
        if (RE_BUILTIN_ACCOUNT.test(v) || RE_WELL_KNOWN_ACCOUNT.test(v)) return null;
        // Atrybuty AD i dziennika zdarzeń: wbudowane konta („Administrator", „krbtgt", „Guest")
        // to w audycie bezpieczeństwa informacja, nie dana osobowa. Nazwisko z wielkiej litery
        // („Lewandowski") zostawiamy FAZIE 4 — inaczej osoba traci etykietę [OSOBA-X].
        if (/^(?:samaccountname|targetusername|subjectusername)$/i.test(key)) {
          const user = loginUserPart(v);
          if (isSystemAccount(user) || (/^[A-Z][a-z]+$/.test(user) && isAsciiSurname(user))) return null;
        }
        // ta sama wartość pada zwykle w treści obok („Konto a.kaminska zablokowane", „/home/jwozniak")
        if (ctx.on('LOGIN')) {
          const user = loginUserPart(v);
          if (isPropagatableLogin(user)) ctx.loginSeeds.add(user);
        }
        break;
      case 'email':
        if (!/\S(?:@|%40|\(at\))\S/i.test(v)) return null;
        break;
      case 'pesel':
        if (!/^\d(?:[ -]?\d){10}$/.test(v)) return null;
        break;
      case 'nip':
        if (!/^(?:PL[- ]?)?\d(?:[ -]?\d){9}$/.test(v)) return null;
        break;
      case 'regon':
        if (!/^\d(?:[ -]?\d){8}(?:(?:[ -]?\d){5})?$/.test(v)) return null;
        break;
      // Dokumenty: ten sam kształt wartości co w prozie — klucz jest kotwicą, kształt chroni przed
      // „brak", „kat. B" czy numerem zamówienia pod mylącym kluczem.
      case 'passport':
        if (!/^[A-Za-z]{2}[\s-]?\d{7}$/.test(v)) return null;
        break;
      case 'idcard':
        if (!/^[A-Za-z]{3}[\s-]?\d{6}$/.test(v)) return null;
        break;
      case 'krs':
        if (!/^\d{10}$/.test(v)) return null;
        break;
      case 'license':
        if (!/^(?=[A-Za-z0-9/ -]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3}$/.test(v)) return null;
        // rok albo data uzyskania uprawnień („"prawoJazdy": "2010"", „"2010-05-12"") to nie numer dokumentu
        if (/^(?:\d{1,4}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})$/.test(v)) return null;
        break;
      case 'plate':
        // wyróżnik WIELKIMI literami z literą województwa i cyfra w numerze („WE12345", „KR 3AB12",
        // „WPI KC27"); „nrRej": „000012345" (rejestr BDO) i nazwa modelu odpadają
        if (!/^(?:[A-Z]{2,3}[\s-]?(?=[A-Z0-9]{0,4}\d)[A-Z0-9]{4,5}|[A-Z]{3}[\s-]?[A-Z]{2}\d{2})$/.test(v)) return null;
        if (!PLATE_VOIV_LETTERS.includes(v[0]) || !RE_PLATE_ACRONYM_HEAD.test(v)) return null;
        // skrót z rokiem („"tablica": "ZP 2026"") — jak w wyliczeniu prozy. Klucz z „rej"
        // („nrRejestracyjny", „nr_rej") to etykieta pola, jak „Nr rejestracyjny:" w prozie — tam
        // „RPO 2024" jest wartością pola, czyli tablicą.
        if (!/rej/i.test(key) && plateYearEndsList(v)) return null;
        break;
      case 'account': {
        // dokładnie 26 cyfr NRB (opcjonalnie z „PL"), bez sumy kontrolnej — kotwicą jest klucz, jak
        // etykieta „rachunek:" w prozie. „rachunek": „R/2026/001" (faktura) czy „konto": „201-01"
        // (konto księgowe) odpadają na kształcie. Numer z poprawną sumą zostawiamy przebiegom
        // IBAN/NRB — dają tę samą maskę co dotąd, a tu łapiemy tylko numer z literówką.
        if (!/^(?:PL[ ]?)?\d(?:[ -]?\d){25}$/.test(v)) return null;
        const digits = v.replace(/\D/g, '');
        // same zera czy jedna cyfra powtórzona to wypełniacz szablonu, nie numer
        if (/^(\d)\1+$/.test(digits) || isValidIban(`PL${digits}`)) return null;
        break;
      }
    }
    const type = STRUCT_KIND_TYPE[kind];
    if (!ctx.on(type)) return null;
    ctx.bump(type);
    // nazwisko (samo lub na końcu pełnego imienia i nazwiska) → spójna etykieta [OSOBA-X]
    if (kind === 'surname' || kind === 'fullname' || kind === 'person' || (kind === 'name' && /\s/.test(v))) {
      return ctx.personMask(structSurnameKey(v.split(/\s+/), key));
    }
    return ctx.M[type];
  };
}

function passStructured(ctx: RedactCtx): void {
  const structMask = structMasker(ctx);
  // XML: <Tag>wartość</Tag> (tag może mieć atrybuty; wartość jednoliniowa, bez zagnieżdżeń).
  // Prefiks przestrzeni nazw („<etd:Nazwisko>", „<ns2:Imie>", „<tns:Ulica>") — w plikach
  // e-Deklaracji, JPK i ePUAP to norma, a dawniej żaden taki tag nie był kotwicą. Tag zamykający
  // musi powtórzyć pełną nazwę z prefiksem (\2), klucz szukamy po części lokalnej. Litery spoza
  // ASCII w nazwie („<Miejscowość>", „<Imię>") — wpisy słownika z ogonkami były martwe.
  ctx.text = ctx.text.replace(
    /(<((?:[\p{L}_][\p{L}\p{N}_.-]{0,20}:)?[\p{L}_][\p{L}\p{N}_.-]{0,40})(?:\s[^<>]*)?>)([^<>\r\n]{1,70})(<\/\s*\2\s*>)/gu,
    (m, open: string, tag: string, value: string, close: string) => {
      // Dziennik zdarzeń Windows: nazwą pola jest atrybut („<Data Name="TargetUserName">tnowicki</Data>"),
      // a sam tag „Data" niczego nie mówi.
      const local = tag.slice(tag.indexOf(':') + 1);
      const attr = /^data$/i.test(local) ? RE_EVENT_DATA_NAME.exec(open)?.[1] : undefined;
      const key = attr ?? local;
      const kind = structKindOf(key, value);
      // z atrybutu bierzemy tylko konto: „<Data Name="Name">Kowalski</Data>" maskuje FAZA 4,
      // która w trybie pseudonimów daje tej osobie tę samą etykietę co w reszcie dokumentu
      if (!kind || (attr && kind !== 'login')) return m;
      const mask = structMask(kind, value, key);
      return mask === null ? m : `${open}${mask}${close}`;
    },
  );
  // XML: atrybuty w otwartym tagu („<Pelnomocnik imie="Piotr" nazwisko="Lewandowski"
  // dataUrodzenia="1978-01-09"/>", „<Adres ulica="Ogrodowa 8" miasto="Kalisz"/>") — w eksportach
  // e-Deklaracji, ePUAP i systemów dziedzinowych dane osoby stoją w atrybutach, a nie w treści tagu.
  // Tylko klucze jednoznacznie osobowe: generyczne „name"/„osoba" w atrybucie to zwykle nazwa pola
  // schematu albo kategoria („<xs:element name="Nazwisko"/>", „<input name="imie">", „<Podmiot
  // osoba="prawna"/>").
  // Tag instytucji („<Urzad nazwa="Urząd Skarbowy" ulica=… telefon=…/>", „<szkola patron=…
  // miasto=…/>") bez atrybutu osoby: adres, telefon i siedziba należą do urzędu, nie do człowieka.
  // „<Adres ulica=… miasto=…/>" pod osobą zostaje kotwicą (tag adresu nie jest instytucją).
  ctx.text = ctx.text.replace(RE_XML_TAG_WITH_ATTRS, (m: string) => {
    const inst = RE_XML_INSTITUTION_TAG.test(m) && !RE_XML_PERSON_ATTR.test(m);
    return m.replace(RE_XML_ATTR, (a, key: string, eq: string, q: string, value: string) => {
      const kind = structKindOf(key, value);
      if (!kind || kind === 'name' || kind === 'person' || kind === 'login') return a;
      if (inst && ['addr', 'city', 'phone', 'postal', 'email'].includes(kind)) return a;
      // adres z kodem i miejscowością w jednym atrybucie — kod i miasto mają własne maski
      if (kind === 'addr' && /\d{2}-\d{3}(?!\d)/.test(value)) return a;
      if ((kind === 'first' || kind === 'surname' || kind === 'fullname') && !xmlAttrNameValue(value, kind)) return a;
      const mask = structMask(kind, value, key);
      return mask === null ? a : `${key}${eq}${q}${mask}${q}`;
    });
  });
  // JSON: "klucz": "wartość" — maskowana sama wartość między cudzysłowami. Także JSON zagnieżdżony
  // w łańcuchu („"payload":"{\"imie\":\"Jadwiga\"}"): poziom ucieczki cudzysłowu (grupa 2) jest
  // wspólny dla klucza i wartości, a wartość nie może zawierać cudzysłowu z tego poziomu — inaczej
  // zewnętrzny klucz brał „{\" za wartość i zjadał otwarcie pierwszego klucza wewnętrznego.
  // (?<!\\) — start na początku ciągu backslashy (jeden start na ciąg, czas liniowy).
  // Klucz z ogonkami i spacją („"Imię"", „"Data urodzenia"", „"first name"") jak w tagu XML.
  ctx.text = ctx.text.replace(
    /(?<!\\)((\\{0,7})"([\p{L}_][\p{L}\p{N}_. -]{0,40})\2"\s*:\s*\2")((?:[^"\\\r\n]|\\[^"\r\n]){1,70})(\2")/gu,
    (m, prefix: string, _esc: string, key: string, value: string, close: string) => {
      const kind = structKindOf(key, value);
      if (!kind) return m;
      const mask = structMask(kind, value, key);
      return mask === null ? m : `${prefix}${mask}${close}`;
    },
  );
}

// ── TABELA Z NAGŁÓWKIEM (CSV, TSV, Markdown) ─────────────────────────────────
// Nagłówek kolumny („imie;nazwisko;pesel", „Nr rejestracyjny\tMarka", „| Imię | Nazwisko |") to
// kotwica jak klucz JSON: w eksportach kadrowych, flotowych i z systemów dziedzinowych wartości
// stoją w wierszach pod nim, bez etykiety przy każdej, więc proza łapała tylko to, co ma sumę
// kontrolną. Kotwicą jest CAŁY wiersz nagłówka złożony z samych nazw pól, a tabelą dopiero taki,
// w którym jedna z kolumn wskazuje osobę albo jej dokument (GATE): „city,population" czy
// „id,name,category" to dane o mieście i produkcie, nie o człowieku.
const TABLE_GATE_KINDS = new Set<StructKind>(['first', 'surname', 'fullname', 'pesel', 'birth', 'plate', 'passport', 'idcard', 'license']);
const RE_TABLE_HEADER_CELL = /^\p{L}[\p{L}\p{N}_.\-/() ]{0,39}$/u;
const RE_MD_RULE = /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+(?:[ \t]*:?-{3,}:?[ \t]*)?\|?[ \t]*$/;
interface TableCell { start: number; end: number }
/** Podział wiersza na komórki (zakresy w wierszu); cudzysłów CSV trzyma separator w środku.
 *  `null`, gdy wiersz ma niedomknięty cudzysłów. */
function splitTableRow(line: string, delim: string, md: boolean): TableCell[] | null {
  let from = 0;
  let to = line.length;
  if (md) {
    const lead = /^[ \t]*\|/.exec(line);
    const trail = /\|[ \t]*$/.exec(line);
    if (!lead || !trail || trail.index < lead[0].length) return null;
    from = lead[0].length;
    to = trail.index;
  }
  const cells: TableCell[] = [];
  let start = from;
  let quoted = false;
  for (let i = from; i < to; i++) {
    const ch = line[i];
    if (ch === '"' && !md) {
      if (quoted && line[i + 1] === '"') i++;
      else if (quoted || line.slice(start, i).trim() === '') quoted = !quoted;
    } else if (ch === delim && !quoted) {
      cells.push({ start, end: i });
      start = i + 1;
    }
  }
  if (quoted) return null;
  cells.push({ start, end: to });
  return cells;
}
const tableCellText = (line: string, c: TableCell): string => line.slice(c.start, c.end);
// Nazwy kolumn spoza STRUCT_KEYS, które w wierszu danych osoby nie występują.
const TABLE_GENERIC_HEADERS = new Set<string>(
  (
    'lp produkt towar usługa cena ilość ilosc jednostka kwota wartość wartosc suma status termin ' +
    'opis uwagi nazwa typ rodzaj kategoria liczba data godzina stanowisko dział dzial oddział ' +
    'pokój pokoj kod symbol stawka netto brutto vat waluta priorytet etap wynik'
  ).split(' '),
);
function rowLooksLikeHeader(values: string[]): boolean {
  const cells = values.map((v) => v.trim()).filter((v) => v);
  if (cells.length < 2 || cells.some((v) => /\d/.test(v) || !RE_TABLE_HEADER_CELL.test(v))) return false;
  const known = cells.filter((v) => STRUCT_KEYS.has(normStructKey(v)) || TABLE_GENERIC_HEADERS.has(v.toLowerCase())).length;
  return known >= 2 && known * 2 >= cells.length;
}
// Komórki biura i podmiotu państwowego w kolumnie osoby („Sekretariat Wójta;-;41 378 00 10",
// „Centrala", „Skarb Państwa", „Lasy Państwowe") — wiersz instytucji, jego telefon i siedziba
// nie są danymi osoby.
const TABLE_ORG_EXTRA_WORDS = new Set<string>(
  (
    'sekretariat centrala biuro dyżur recepcja kancelaria informacja punkt dziekanat portiernia dział ' +
    'wydział referat kasa skarb państwa państwowe państwowy państwowa wspólnota mieszkaniowa lasy'
  ).split(' '),
);
const tableOrgCell = (v: string): boolean =>
  v
    .toLowerCase()
    .split(/[ \t]+/)
    .some(
      (w) =>
        ORG_HEAD_WORDS.has(w) ||
        LEGAL_ENTITY_WORDS.has(w) ||
        TABLE_ORG_EXTRA_WORDS.has(w) ||
        /^(?:sp\.?|s\.a\.|spółka|gmina|gminny|gminna|miejski|miejska|powiatowy|powiatowa)$/.test(w),
    );
// Podmiot kościelny w kolumnie osoby („Parafia św. Józefa", „Kościół św. Anny", „Parafia
// Rzymskokatolicka pw. Św. Jana") — imię świętego „potwierdzało" osobę, a to wiersz instytucji.
// Także po wcześniejszej masce w komórce: „pw."/„św." zostają wtedy jawne.
const RE_TABLE_SACRAL_CELL =
  /^[ \t]*(?:parafi\p{L}*|kości[oe]ł\p{L}*|kaplic\p{L}*|klasztor\p{L}*|zgromadzeni\p{L}*|diecezj\p{L}*|sanktuari\p{L}*|bazylik\p{L}*|katedr\p{L}*|caritas)(?!\p{L})|(?<!\p{L})(?:pw|św|bł)\.[ \t]*\p{Lu}/iu;
// Władca albo papież z liczbą porządkową w komórce osoby („Jan Paweł II,Patron") — jak w prozie.
const RE_TABLE_REGNAL_CELL =
  /^\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)?[ \t]+(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)$/u;
// Urząd albo funkcja-homograf nazwiska sama w komórce osoby („3;Sołtys;Lubień 1;", „Ławnik;Lubień 2")
// to wiersz roli z listy obecności zebrania wiejskiego czy wykazu składu: bez osoby i bez jej
// adresu. Para z imieniem („Jan Sołtys") dalej jest osobą.
const TABLE_OFFICE_WORDS = new Set<string>(
  'sołtys sołtyska starosta ławnik ławniczka radny radna skarbnik sekretarz woźny woźna kasjer kasjerka opiekun opiekunka przewodniczący przewodnicząca'.split(' '),
);
const tableOfficeCell = (v: string): boolean => TABLE_OFFICE_WORDS.has(v.trim().toLowerCase());
// Przyimek jako osobny wyraz komórki osoby („wyjazd w maju", „WYJAZD W MAJU") — zdanie, nie osoba.
const RE_TABLE_PROSE_PREP = /^(?:w|we|na|do|od|po|przy|dla|o|u|za|ze|pod|nad|przed|bez|oraz)$/i;
const RE_TABLE_SUMMARY_ROW =/^[ \t]*(?:razem|suma|ogółem|łącznie|wszyscy|wszystkie|podsumowanie|stan[ \t]+na|wydruk|wygenerowano|total)(?![\p{L}])/iu;
function passDelimitedTable(ctx: RedactCtx): void {
  const t = ctx.text;
  if (!/[;,\t|]/.test(t)) return;
  const parts = t.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  let changed = false;
  const structMask = structMasker(ctx);
  for (let h = 0; h + 1 < lines.length; h++) {
    const header = lines[h];
    const md = /^[ \t]*\|.*\|[ \t]*$/.test(header) && RE_MD_RULE.test(lines[h + 1]);
    const delim = md ? '|' : header.includes('\t') ? '\t' : header.includes(';') ? ';' : header.includes(',') ? ',' : '';
    if (!delim) continue;
    const hc = splitTableRow(header, delim, md);
    if (!hc || hc.length < 2) continue;
    const names = hc.map((c) => tableCellText(header, c).trim().replace(/^"(.*)"$/, '$1').trim());
    if (!names.every((n) => RE_TABLE_HEADER_CELL.test(n) && n.split(' ').length <= 4)) continue;
    const headKinds = names.map((n) => STRUCT_KEYS.get(normStructKey(n)));
    if (!headKinds.some((k) => TABLE_GATE_KINDS.has(k as StructKind))) continue;
    // Sama kolumna imienia bez innej danej osoby („Imię;Data imienin", „Imię,Liczba nadań",
    // „Imię,Płeć,Pochodzenie") to kalendarz albo statystyka imion, w której przedmiotem jest nazwa.
    if (headKinds.every((k) => !k || k === 'first' || k === 'city')) continue;
    let r = h + (md ? 2 : 1);
    for (; r < lines.length; r++) {
      const line = lines[r];
      if (!line.trim()) break;
      const cells = splitTableRow(line, delim, md);
      if (!cells || cells.length !== hc.length) break;
      const texts = cells.map((c) => tableCellText(line, c));
      // CSV z przecinkiem bez spacji po separatorze: „Dzień dobry, przesyłam listę." pod
      // nagłówkiem „imie,nazwisko" to proza, nie wiersz tabeli
      if (delim === ',' && texts.some((x, i) => i > 0 && /^ /.test(x))) break;
      const values = texts.map((raw) => {
        const q = /^([ \t]*"?)(.*?)("?[ \t]*)$/.exec(raw) as RegExpExecArray;
        return q[1].endsWith('"') !== q[3].startsWith('"') ? raw.trim() : q[2];
      });
      // Kolejny nagłówek o tej samej liczbie kolumn („Produkt,Cena,Ilość") zaczyna nową tabelę:
      // kolumny poprzedniej przestają obowiązywać, a od tego wiersza nagłówek bada pętla zewnętrzna.
      if (rowLooksLikeHeader(values)) break;
      // Wiersz podsumowania albo stopka eksportu („Razem działów⇥Wszyscy", „Stan na;;01.10.2026").
      if (RE_TABLE_SUMMARY_ROW.test(values.find((v) => v.trim()) ?? '')) continue;
      const kinds = values.map((v, i) => structKindOf(names[i], v));
      // Komórki osoby maskujemy tylko w wierszu, w którym choć jedna z nich jest potwierdzona
      // (imię ze słownika, nazwisko ze słownika, morfologii albo homograf). Wiersz „Oddział⇥Kardiologia"
      // pod „Nazwisko⇥Imię" to opis, a nazwa pola („Imię⇥Imię pracownika") nigdy nie jest osobą.
      const personCell = (k: StructKind | undefined): boolean => k === 'first' || k === 'surname' || k === 'fullname' || k === 'name' || k === 'person';
      // Proza pod tabelą („Wyjazd w maju; szczegóły wkrótce", „Silny mróz; zajęcia odwołane"):
      // komórka osoby z kilku wyrazów, w której obok wyrazu z wielkiej litery stoi wyraz z małej
      // spoza partykuł i tytułów — to zdanie, nie imię i nazwisko („maju" potwierdzało „imię").
      // Władca albo papież z liczbą porządkową („Jan Paweł II") też nie jest osobą z wykazu.
      // Także zdanie zaczęte małą literą albo WERSALIKAMI: przyimek jako osobny wyraz („wyjazd w maju",
      // „WYJAZD W MAJU", „spotkanie w maju") albo same małe litery z wyrazem spoza słowników imion
      // i nazwisk („silny mróz", „szczegóły wkrótce") — imię i nazwisko małymi literami („anna kowal")
      // ma oba wyrazy w słowniku.
      const proseCell = (v: string): boolean => {
        const ws = v.trim().split(/[ \t]+/);
        if (RE_TABLE_REGNAL_CELL.test(v.trim())) return true;
        if (ws.length >= 2 && ws.some((w) => RE_TABLE_PROSE_PREP.test(w))) return true;
        if (
          ws.length >= 2 &&
          ws.every((w) => /^\p{Ll}/u.test(w)) &&
          ws.some((w) => !SURNAME_PARTICLES.has(w) && !RE_VALUE_TITLE_OR_INITIAL.test(w) && !isFirstNameLike(w) && !tsvSurnameProof(w))
        )
          return true;
        return (
          ws.length >= 2 &&
          ws.some((w) => /^\p{Lu}/u.test(w)) &&
          ws.some(
            (w) =>
              /^\p{Ll}/u.test(w) &&
              !SURNAME_PARTICLES.has(w) &&
              !RE_VALUE_TITLE_OR_INITIAL.test(w) &&
              !/^(?:z|i|vel|primo|voto|zd\.?|ur\.?)$/.test(w),
          )
        );
      };
      if (values.some((v, i) => personCell(kinds[i]) && proseCell(v))) continue;
      const personOk = values.some((v, i) => {
        if (!personCell(kinds[i]) || tableOfficeCell(v)) return false;
        const ws = v.trim().split(/ +/);
        // dzień albo miesiąc małą literą („Dzień Matki;maj") to kalendarz, nie nazwisko „Maj"
        return ws.some((w) => isFirstNameLike(w) || (tsvSurnameProof(w) && !(/^\p{Ll}/u.test(w) && TSV_NOT_SURNAME.has(w))));
      });
      // Wiersz instytucji w wykazie osób („Ochotnicza Straż Pożarna,Zalesie,10000", „Urząd
      // Miasta,Łódź"): siedziba to nie dana osoby, więc wiersz zostaje. Tylko z wyrazem instytucji
      // w komórce osoby: obce imię spoza słownika („Liu Wei;Lipowa 5") nie potwierdza osoby, ale
      // adres i dokument w jego wierszu dalej są danymi osoby.
      if (!personOk && values.some((v, i) => personCell(kinds[i]) && tableOrgCell(v))) continue;
      if (values.some((v, i) => personCell(kinds[i]) && RE_TABLE_SACRAL_CELL.test(v))) continue;
      // Wiersz bez osoby („Wakat;-;Warszawa", „Sala;konferencyjna;Gdańsk") nie ma czyjego adresu ani
      // miejscowości. Obce imię spoza słownika („Liu;Wei;Lipowa 5") dalej wygląda na osobę: każda
      // niepusta komórka osoby z wielkiej litery i bez roli.
      const personVals = values.map((v, i) => (personCell(kinds[i]) ? v.trim() : '')).filter((v) => v && !isEmptyFormValue(v));
      const personPlausible =
        personOk ||
        personVals.some((v) => /^\[(?:IMIĘ|OSOBA)/.test(v)) ||
        (personVals.length > 0 && personVals.every((v) => /^\p{Lu}/u.test(v) && !tableOfficeCell(v) && !v.split(/ +/).some((w) => isPersonRoleValue(w.toLowerCase()))));
      let out = '';
      let last = 0;
      // Tryb pseudonimów: imię w osobnej kolumnie („Nazwisko⇥Imię", „Adamczyk⇥Julia") dostaje
      // pseudonim osoby z kolumny nazwiska tego samego wiersza, nie ogólną etykietę obok [OSOBA-A].
      const surCells = values.filter((v, i) => kinds[i] === 'surname' && /^\p{Lu}[\p{L}-]+$/u.test(v.trim()) && !isEmptyFormValue(v.trim()) && !isPersonRoleValue(v.trim().toLowerCase()));
      const rowSur = ctx.pseudonyms && surCells.length === 1 ? surCells[0].trim() : '';
      cells.forEach((c, i) => {
        const raw = texts[i];
        const value = values[i];
        const kind = kinds[i];
        if (!kind) return;
        if (personCell(kind) && (!personOk || tableOfficeCell(value) || value.trim().split(/ +/).some((w) => isPersonRoleValue(w.toLowerCase()) || STRUCT_KEYS.has(normStructKey(w))))) return;
        // adres z kodem i miejscowością w jednej komórce („ul. Lipowa 5, 00-001 Warszawa") — kod
        // i miasto mają własne przebiegi i maski, jak w drugiej linii adresu pod kluczem JSON
        if (kind === 'addr' && /\d{2}-\d{3}(?!\d)/.test(value)) return;
        if ((kind === 'addr' || kind === 'city') && !personPlausible && kinds.some(personCell)) return;
        let mask = structMask(kind, value, names[i]);
        if (mask === null) return;
        if (rowSur && kind === 'first' && /^\p{Lu}\p{Ll}+$/u.test(value.trim()) && mask === ctx.M.IMIE) mask = ctx.personMask(rowSur);
        const at = c.start + raw.indexOf(value);
        out += line.slice(last, at) + mask;
        last = at + value.length;
      });
      if (last) {
        lines[r] = out + line.slice(last);
        changed = true;
      }
    }
    h = r - 1;
  }
  if (!changed) return;
  ctx.text = parts.map((p, i) => (i % 2 === 0 ? lines[i / 2] : p)).join('');
}

// Wyraz z wielkiej litery tuż za wartością loginu — bez dwukropka (to kolejna etykieta: „User: Adam
// Status: active") i bez kropki z dalszym ciągiem („Jan.Nowak" to też login).
const RE_NAME_AFTER_LOGIN = new RegExp(`^[ \\t]+([${PL_UP}][${PL_LO}]+)(?![\\p{L}\\p{N}_:-]|\\.[\\p{L}\\p{N}])`, 'u');
/** Czy wartość pola loginu z następnym wyrazem to para imię+nazwisko (w dowolnym szyku)? Nazwisko
 *  potwierdzone słownikiem albo końcówką — tylko taką parę FAZA 4 na pewno zamaskuje w całości. */
function loginValueIsPersonPair(val: string, after: string): boolean {
  if (!/^[A-Z][a-z]+$/.test(val)) return false;
  const next = RE_NAME_AFTER_LOGIN.exec(after)?.[1];
  if (!next) return false;
  const surname = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w);
  return (isFirstNameLike(val) && surname(next)) || (surname(val) && isFirstNameLike(next));
}
const RE_NAME_BEFORE_LOGIN_WORD = new RegExp(`(?<![${NM_BOUND}])([${PL_UP}][${PL_LO}]+)[ \\t]+$`);
/** Czy wystąpienie loginu-wyrazu tworzy z sąsiednim wyrazem parę imię+nazwisko (w dowolnym szyku)? */
function loginWordInPersonPair(t: string, offset: number, v: string): boolean {
  if (loginValueIsPersonPair(v, t.slice(offset + v.length, offset + v.length + 40))) return true;
  const prev = RE_NAME_BEFORE_LOGIN_WORD.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!prev && /^[A-Z][a-z]+$/.test(prev) && loginValueIsPersonPair(prev, ` ${v}`);
}
const RE_LOGIN_CAPS_PERSON = new RegExp(
  `(\\b(?:[Ll]ogin|[Uu]ser(?:name)?|[Uu]ser[ \\t]+[Nn]ame)[ \\t]*[:=][ \\t]*)([${PL_UP}]{2,}(?:[ \\t]+[${PL_UP}]{2,}){1,2})(?=[ \\t]*(?:\\r?\\n|$))`,
  'g',
);
/** Wyrazy instytucji w polu loginu WERSALIKAMI („Login: GMINA LUBIEŃ") — konto urzędu, nie osoba. */
const LOGIN_CAPS_NOT_PERSON = new Set(
  (
    'gmina gminy urzad urzedu rada rady solectwo soltys powiat powiatu starostwo miasto miasta szkola ' +
    'spolka osp gops mops mopr ops pcpr zus krus wojt burmistrz prezydent biuro sekretariat referat wydzial'
  ).split(' '),
);
/** Wyraz uliczny przed samym nazwiskiem z pola loginu („UL. ZIELIŃSKA 5", „ALEJA GÓRSKA"). */
const RE_CAPS_SPILL_STREET_HEAD = /^(?:ul|al|os|pl|ulica|ulicy|ulicę|aleja|alei|aleje|osiedle|osiedla|plac|placu|rondo|ronda|skwer|bulwar)$/;
/** Pory roku: „OKRES: ZIMA 2026" — wyraz pospolity, nie nazwisko z pola loginu. */
const LOGIN_CAPS_COMMON_WORDS = new Set(['zima', 'lato', 'wiosna', 'jesień', 'jesien']);
/** Wartość pod „Alias:" w kształcie nazwy hosta („www.firma.pl", „mail.urzad.gov.pl"). */
const RE_DOMAIN_LIKE = /\.(?:pl|com|net|org|eu|gov|edu|info|biz|io|local|lan|intra|corp|de|uk)$/i;
/** Stan konta zamiast jego nazwy („Konto AD: zablokowane", „Konto LDAP: aktywne"). */
// Kwalifikator etykiety loginu będący nazwą systemu („Login AD:", „Login (AD):", „Login [SAP]:",
// „Login do VPN:", „Login – AD:", „User AD:"). Zamknięta lista „użytkownika|administratora|…"
// przerywała dopasowanie na akronimie, więc wartość zostawała jawna. Bez skrótów, które opisują
// metodę albo wynik, a nie system („Login FAILED:", „Login SSO:", „Login MFA:", „Login URL:").
const LOGIN_ACR = String.raw`(?!(?:OK|FAIL|FAILED|ERROR|URL|URI|SSO|MFA|PIN|SMS|OTP|ID|API|IP|PC|HTTP|HTTPS)(?![A-Z0-9]))[A-Z][A-Z0-9]{1,7}(?![\p{L}\p{N}])`;
const LOGIN_ACR_QUAL = String.raw`[ \t]+(?:\(${LOGIN_ACR}\)|\[${LOGIN_ACR}\]|(?:do|w|na)[ \t]+${LOGIN_ACR}|[–-][ \t]*${LOGIN_ACR}|${LOGIN_ACR})`;
const RE_LOGIN_ACR_IN_LABEL = new RegExp(`${LOGIN_ACR_QUAL}[ \\t]*[:=]`, 'u');
const LOGIN_STATE_WORDS = new Set<string>(
  (
    'aktywne aktywny nieaktywne nieaktywny zablokowane zablokowany odblokowane odblokowany wygasle ' +
    'utworzone usuniete zawieszone tak nie brak enabled disabled locked unlocked active inactive ' +
    'expired none ok'
  ).split(' '),
);
// Ścieżka profilu użytkownika: „C:\Users\tkaminski\…", „/home/jkowalski/…", „/Users/anowak/…".
// Segment po katalogu profili to zawsze nazwa konta. Lewa granica „/home" bez litery, kropki
// i ukośnika — „firma.pl/home/news" to podstrona serwisu, nie katalog domowy. Prawa granica:
// separator ścieżki, koniec tokenu albo kropka kończąca zdanie. Segment, po którym stoi spacja
// i wielka litera, to początek nazwy z odstępem („C:\Users\Tomasz Kamiński", „All Users") —
// osobę maskuje FAZA 4. Plik wprost w katalogu domowym („/home/index.html") to nie konto.
const PROFILE_SEG = String.raw`([A-Za-z0-9][A-Za-z0-9._-]{0,62}[A-Za-z0-9])(?=[\\/\s"'”,;:)\]}<>]|\.(?:\s|$)|$)`;
// Też małymi literami, gdy nazwa z odstępem ciągnie się do separatora („C:\Users\ewa nowak\…").
// Najwyżej dwa odstępy: szersza luka to kolumna wydruku („\\fs01\home$\tkaminski    Microsoft…").
const RE_CAP_WORD_AHEAD = /^[ \t]{1,2}(?:\p{Lu}|\p{Ll}{2,30}[\\/])/u;
const RE_PROFILE_PATH = new RegExp(
  String.raw`((?<![\p{L}\p{N}_])[A-Za-z]:(?:\\{1,2}|/)(?:Users|Użytkownicy|Documents and Settings)(?:\\{1,2}|/)|(?<![\p{L}\p{N}_./~-])/(?:home|Users)/)` +
    PROFILE_SEG,
  'gu',
);
// Udział z katalogami domowymi: „\\FS01\home$\tkaminski", „\\srv\profiles$\jkowalski.V6".
// Kolejki drukarek („\\PRINT01\AdamK") nie mają takiej kotwicy i zostają.
const RE_UNC_HOME = new RegExp(
  String.raw`((?<![\p{L}\p{N}_\\])\\{2,4}[A-Za-z0-9][A-Za-z0-9.-]{0,62}\\{1,2}(?:home|homes|users|profiles|redirect)\$?\\{1,2})` +
    PROFILE_SEG,
  'giu',
);
// Stałe formaty logów sshd, PAM i sudo: „Accepted publickey for jkowalski from", „Invalid user
// anowak from", „session opened for user jkowalski(uid=1001)", „sudo:  jkowalski : TTY=".
const LOG_USER = '([A-Za-z_][A-Za-z0-9._-]{0,31})';
const RE_LOG_USER: RegExp[] = [
  new RegExp(
    String.raw`(\b(?:(?:Accepted|Failed)[ \t]+(?:password|publickey|keyboard-interactive(?:/pam)?|gssapi-with-mic|gssapi-keyex|hostbased|none)[ \t]+for(?:[ \t]+invalid[ \t]+user)?|Invalid[ \t]+user|(?:Connection[ \t]+closed[ \t]+by|Disconnected[ \t]+from)[ \t]+(?:authenticating|invalid)[ \t]+user)[ \t]+)` +
      `${LOG_USER}(?=[ \\t]+(?:from|port)[ \\t])`,
    'g',
  ),
  new RegExp(String.raw`(\bsession[ \t]+(?:opened|closed)[ \t]+for[ \t]+user[ \t]+)${LOG_USER}(?=\(|[ \t]|$)`, 'gm'),
  new RegExp(String.raw`(\bsudo:[ \t]+)${LOG_USER}(?=[ \t]+:[ \t])`, 'g'),
];
/** Plik wprost w katalogu domowym („/home/index.html"), nie konto. */
const RE_FILE_EXT = /\.(?:html?|php|aspx?|jsp|txt|log|sh|conf|cfg|ini|json|xml|zip|tar|gz)$/i;
/**
 * Loginy z kotwic budowy tekstu (ścieżka profilu, udział domowy, log sshd/sudo) — maskowany
 * cały segment, konta systemowe zostają. Wartość dopisujemy do propagacji tylko przez bramkę
 * isPropagatableLogin: „/home/projekty" czy „sudo: deploy" to katalog i konto usługi.
 */
function maskAnchoredLogins(ctx: RedactCtx): void {
  const mask = (path: boolean) => (m: string, pre: string, seg: string, offset: number, t: string): string => {
    if (isSystemAccount(seg) || RE_FILE_EXT.test(seg)) return m;
    if (RE_CAP_WORD_AHEAD.test(t.slice(offset + m.length, offset + m.length + 34))) return m;
    // „C:\Users\Jan.Kowalski" — imię i nazwisko sklejone kropką maskuje w całości FAZA 4 (K35)
    if (RE_DOTTED_PERSON.test(seg)) return m;
    // „jkowalski.V6" — sufiks wersji profilu Windows nie należy do nazwy konta
    const user = seg.replace(/\.V\d$/i, '');
    // Udane logowanie, sesja i sudo dotyczą istniejącego konta — tam wystarcza stoplista.
    // Gdzie indziej pod tą samą kotwicą stoi też coś innego niż konto osoby, więc bramka zależy
    // od tego, jak pewna jest kotwica:
    // - profil Windows („C:\Users\…") i udział z „$" („\\srv\home$\…") to zawsze katalog konta;
    //   odpada tylko wyraz z wielkiej litery, który nie jest imieniem ani nazwiskiem — wspólny
    //   profil albo katalog działu („Biblioteka", „Meldunki", „Wnioski800");
    // - „/home/", „/Users/" i udział bez „$" bywają trasą serwisu i katalogiem działu
    //   („GET /Users/Edit/15", „/home/dashboard", „\\fs01\home\Skany"), a „Invalid user" niesie
    //   nazwę ze słownika ataku („test1") — tu tylko imię, nazwisko albo uchwyt z nim. Dawniej
    //   dopuszczaliśmy jeszcze dowolny wyraz małymi literami z dalszym członem ścieżki, ale
    //   w pismach o stronie gminy i w instrukcjach to katalog albo sekcja serwisu
    //   („/home/wnioski/przychodzace", „/home/aktualnosci/2024", „/Users/promocja/plakaty").
    const attempt = !path && /nvalid/.test(pre);
    const sure = path && (/^[A-Za-z]:/.test(pre) || pre.includes('$'));
    const capWord = /^[A-Z][a-z]+[0-9]*$/.test(user);
    if (sure) {
      if (capWord && !(user.match(/[A-Za-z]+/g) ?? []).some(isNameishPart)) return m;
    } else if ((path || attempt) && !isPersonalSegment(user)) {
      return m;
    }
    // samo nazwisko z wielkiej litery („C:\Users\Kowalska") zostaje dla FAZY 4 i jej etykiety osoby
    if (/^[A-Z][a-z]+$/.test(user) && isAsciiSurname(user) && !isAsciiFirstName(user)) return m;
    if (!attempt && isPropagatableLogin(user)) ctx.loginSeeds.add(user);
    ctx.bump('LOGIN');
    return `${pre}${ctx.M.LOGIN}`;
  };
  if (/[\\/]/.test(ctx.text)) {
    ctx.text = ctx.text.replace(RE_PROFILE_PATH, mask(true));
    if (ctx.text.includes('\\\\')) ctx.text = ctx.text.replace(RE_UNC_HOME, mask(true));
  }
  for (const re of RE_LOG_USER) ctx.text = ctx.text.replace(re, mask(false));
}
/**
 * Znany login w zapamiętanym URL-u — wyłącznie CAŁY segment ścieżki albo wartość parametru
 * („github.com/tkaminski", „/display/~jnowak82", „/user/dmichalska?x=1"); część segmentu
 * („/dmichalskaneous/") i nazwa hosta zostają.
 */
function maskLoginsInUrls(ctx: RedactCtx, values: Iterable<string>): void {
  const known = new Set<string>();
  // Tylko uchwyt osoby: zwykły wyraz spod „Login:" („projekty", „wroclaw") bywa też nazwą
  // podstrony i psułby link („/oddzialy/[LOGIN]/raporty").
  for (const v of values) if (isPropagatableLogin(v)) known.add(v.toLowerCase());
  if (!known.size) return;
  ctx.protectedUrls = ctx.protectedUrls.map((url) => {
    const head = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i.exec(url)?.[0] ?? '';
    const path = url.slice(head.length).replace(/(?<=[/~=])[^/?#&=~\s[\]]+(?=[/?#&]|$)/g, (seg) => {
      if (!known.has(seg.toLowerCase())) return seg;
      ctx.bump('LOGIN');
      return ctx.M.LOGIN;
    });
    return head + path;
  });
}
// 1d) LOGIN — kotwica „login/username/nazwa użytkownika" + wartość-token, także w NASTĘPNEJ
// linii. Złapaną wartość maskujemy też w pozostałych wystąpieniach w dokumencie oraz w
// wariancie w cudzysłowie po „użytkownik/login/konto".
function passLogin(ctx: RedactCtx): void {
  if (!ctx.on('LOGIN')) return;
  const loginValues = new Set<string>();
  // Wyraz-login nierozlewany na prozę („Login: soltys") — maskujemy go jeszcze pod kolejną etykietą
  // konta w innym wierszu (patrz koniec przebiegu).
  const fieldOnlyLogins = new Set<string>();
  // Wartość do propagacji: cały token („FIRMA\jkowalski") i sama nazwa użytkownika — nigdy sama
  // domena (to nazwa firmy, która pada w prozie). Konta generyczne („admin", „system", „test")
  // maskujemy w polu, ale nie rozlewamy na dokument — tam to zwykłe słowa („panel admin").
  const remember = (val: string): void => {
    const user = loginUserPart(val);
    for (const v of user === val ? [val] : [val, user]) {
      if (v.length >= 4 && !GENERIC_LOGINS.has(v.toLowerCase())) loginValues.add(v);
    }
  };
  // „User name: ZIELINSKA KATARZYNA" — osoba WIELKIMI literami w polu loginu. Główny wzorzec brał
  // pierwszy wyraz i zostawiał imię jawne obok maski („[LOGIN] KATARZYNA"); maskujemy całą parę.
  // To osoba, nie login: maska osoby (w trybie pseudonimów ta sama [OSOBA-X] co „Adam Nowak"
  // obok). Parę zapamiętujemy w obu szykach, bo te same dane wracają w dokumencie
  // nazwiskiem naprzód („JANKOWSKI TOMASZ"), czego FAZA 4 WIELKIMI literami nie łapie.
  const capsPersons = new Map<string, string>();
  ctx.text = ctx.text.replace(RE_LOGIN_CAPS_PERSON, (m, kw: string, val: string) => {
    const words = val.split(/[ \t]+/);
    const folded = words.map((w) => foldAscii(w.toLowerCase()));
    // Osoba tylko z imieniem ze słownika i bez wyrazu instytucji: „Login: GMINA LUBIEŃ" to konto
    // urzędu. Bez imienia biegnie główny wzorzec loginu (jak w v0.46.22).
    if (
      !folded.some((f) => f.length >= 3 && isAsciiFirstName(f)) ||
      folded.some((f) => LOGIN_CAPS_NOT_PERSON.has(f) || isSystemAccount(f))
    )
      return m;
    // kluczem osoby jest nazwisko: wyraz, który nie jest imieniem (domyślnie ostatni)
    let si = words.length - 1;
    if (isAsciiFirstName(folded[si]) && !isAsciiFirstName(folded[0])) si = 0;
    const surname = words[si];
    if (!ctx.on('IMIE')) {
      ctx.bump('LOGIN');
      return `${kw}${ctx.M.LOGIN}`;
    }
    ctx.bump('IMIE');
    capsPersons.set(words.join(' '), surname);
    if (words.length === 2) {
      capsPersons.set(`${words[1]} ${words[0]}`, surname);
      // Pojedynczy wyraz rozlewamy tylko dla NAZWISKA ze słownika, które nie jest wyrazem
      // pospolitym: imię samo („PARAFIA: ŚW. JAN") ani homonim („PIĄTEK", „MAJ", „KOWAL", „ZIMA")
      // nie wskazuje osoby, a maska niszczyła daty, nagłówki i zawody.
      const sl = surname.toLowerCase();
      if (
        surname.length >= 4 &&
        isAsciiSurname(folded[si]) &&
        !isAsciiFirstName(folded[si]) &&
        !HOMOGRAPH_SURNAMES.has(sl) &&
        !homographBase(sl) &&
        !LOGIN_CAPS_COMMON_WORDS.has(sl)
      )
        capsPersons.set(surname, surname);
    }
    return `${kw}${ctx.personMask(surname)}`;
  });
  ctx.text = ctx.text.replace(
    new RegExp(
      String.raw`((?:\b[Ll]ogin\w{0,3}|\b[Uu]ser(?:name)?|\b[Nn]azwa\s+użytkownika|\b[Ii]dentyfikator\s+użytkownika|\b[Uu]ser[ \t]+[Nn]ame|\b[Ss][Aa][Mm][Aa]ccount[Nn]ame|\b[Kk]onto[ \t]+(?:AD|LDAP|domenowe|w[ \t]+domenie)|\bAlias)(?:\s+(?:użytkownika|administratora|operatora|serwisow\w+|techniczn\w+|w\s+systemie|systemow\w+|domenow\w+|sieciow\w+))?` +
        `(?:${LOGIN_ACR_QUAL})?` +
        String.raw`[ \t]*[:=][ \t]*\n?[ \t]*)(["„'«]?)((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{1,62}[A-Za-z0-9])(?!\.?[\p{L}\p{N}_-]|\\)(["”'»]?)`,
      'gu',
    ),
    (m, kw: string, q1: string, val: string, q2: string, offset: number) => {
      if (q1 && !q2) return m; // niedomknięty cudzysłów — to nie wartość pola
      // Kwalifikator systemu („Login AD:", „Login (AD):", „Login do VPN:", „User SAP:") — etykieta
      // słabsza: za nią stoi też stan, metoda albo konto wbudowane („Login VPN: tak", „User SAP:
      // Administrator", „Login AD: root"). Wartość musi wypełniać resztę wiersza i wyglądać na uchwyt
      // osoby, nie na wyraz z wielkiej litery ani skrót.
      if (RE_LOGIN_ACR_IN_LABEL.test(kw) && !/^[Kk]onto/.test(kw)) {
        const lineEnd = ctx.text.indexOf('\n', offset + m.length);
        const rest = ctx.text.slice(offset + m.length, lineEnd === -1 ? ctx.text.length : lineEnd);
        // dopisek w nawiasie za wartością („wkozlowski (konto zablokowane)") nie jest kolejnym wyrazem
        if (!/^[\s.,;]*$/.test(rest) && !/^[ \t]+\([^()\n]*\)[\s.,;]*$/.test(rest)) return m;
        if (q1 || /^[A-Z][a-z]+$/.test(val) || /^[A-Z0-9]{2,6}$/.test(val)) return m;
        // imiesłów albo przymiotnik z formularza („Login AD: wymagany", „nadane", „opcjonalna")
        if (/^[a-ząćęłńóśźż]+(?:[aoey]ny|[aoey]ne|[aoey]na|alny|alne|owy|owe)$/.test(val)) return m;
        const lv = val.toLowerCase();
        if (LOGIN_STATE_WORDS.has(lv) || GENERIC_LOGINS.has(lv) || isSystemAccount(loginUserPart(val))) return m;
      }
      // wartość nie może być kolejną etykietą („Login:\nHasło:") ani pustym oznaczeniem
      if (!q2 && ctx.text[offset + m.length] === ':') return m;
      // „Alias" i „Konto AD" to etykiety słabsze niż „Login": alias bywa nazwą hosta („Alias:
      // www.firma.pl" w DNS), a pod kontem stoi też jego stan („Konto AD: zablokowane"). Wartość
      // musi więc wypełniać resztę wiersza, nie wyglądać na domenę ani na stan konta.
      const weak = /^(?:[Aa]lias|[Kk]onto)/.test(kw);
      // wartość w NASTĘPNEJ linii musi wypełniać ją w całości
      if (kw.includes('\n') || weak) {
        const lineEnd = ctx.text.indexOf('\n', offset + kw.length);
        const rest = ctx.text.slice(offset + m.length, lineEnd === -1 ? ctx.text.length : lineEnd);
        if (!/^[\s.,;]*$/.test(rest)) return m;
      }
      if (weak && (RE_DOMAIN_LIKE.test(val) || LOGIN_STATE_WORDS.has(val.toLowerCase()))) return m;
      // Pod słabą etykietą stoi też zwykły wyraz: odpowiedź z formularza („Konto AD: nadane",
      // „Konto w domenie: posiada"), alias skrzynki działu, hosta czy tytuł („Alias: zamowienia",
      // „Alias: intranet", „Alias: Matrix") albo samo nazwisko („Alias: Kowal"). Propagacja
      // maskowała wtedy ten wyraz w całej prozie, a nazwisko rozbijało pary osób. Bierzemy tylko
      // uchwyt osoby; nazwisko zostaje dla FAZY 4.
      if (weak && !isPropagatableLogin(loginUserPart(val))) return m;
      // Atrybut AD i pole raportu awarii: konto wbudowane albo zastępnik („Administrator",
      // „krbtgt", „unknown") to nie osoba, a „unknown" rozlewało się na „unknown device".
      const medium = /^(?:[Uu]ser[ \t]+[Nn]ame|[Ss][Aa][Mm])/.test(kw);
      if (medium) {
        const account = loginUserPart(val);
        if (isSystemAccount(account)) return m;
        // „User name:" i „sAMAccountName:" stoją też w instrukcjach („Pole sAMAccountName: jest
        // obowiązkowe", „W polu User name: wpisz swój login") i przed imieniem z nazwiskiem
        // („User name: Anna Zając"). Wartość z kolejnym wyrazem po spacji to nie login: dawniej
        // pierwszy wyraz szedł jako [LOGIN], nazwisko zostawało jawne, a „jest" czy „wpisz"
        // znikały z całej prozy. Osobę maskuje wtedy w całości FAZA 4.
        if (/^ {1,2}[\p{L}\p{N}]/u.test(ctx.text.slice(offset + m.length, offset + m.length + 3))) return m;
        // Imię i nazwisko sklejone kropką albo samo nazwisko z wielkiej litery („Jan.Kowalski",
        // „Nowak") zostają dla FAZY 4, jak pod kluczem samaccountname — osoba zachowuje etykietę.
        if (RE_DOTTED_PERSON.test(account)) return m;
        if (/^[A-Z][a-z]+$/.test(account) && isAsciiSurname(account) && !isAsciiFirstName(account)) return m;
      }
      const user = loginUserPart(val).toLowerCase();
      if (isEmptyFormValue(user) || FORM_LABEL_WORDS.has(user) || RE_BUILTIN_ACCOUNT.test(val)) return m;
      // „User: Kowalski Jan", „Username: Adam Kowalski" — w polu stoi osoba, nie login. Dawniej
      // pierwszy wyraz szedł jako [LOGIN], drugi zostawał jawny, a propagacja rozbijała tę samą parę
      // w prozie („Jan [LOGIN] zgłosił awarię"). Parę maskuje w całości FAZA 4.
      if (!q1 && !kw.includes('\n') && loginValueIsPersonPair(val, ctx.text.slice(offset + m.length, offset + m.length + 40))) return m;
      // Pod nowszymi etykietami rozlewamy tylko uchwyt osoby: samo imię („User name: Tomasz")
      // rozbijało pary w prozie („Zgłasza: [LOGIN] Wróbel"), a zwykły wyraz („Nowa", „Lato")
      // znikał z każdego zdania. W samym polu maska zostaje.
      // Zwykły wyraz małymi literami („Login: mazur", „Login AD: wilk", „zima", „zamek") to też
      // rzeczownik z prozy: rozlany na dokument dawał „orkiestra zagrała [LOGIN]", „jak [LOGIN]
      // przechodzi przez ogrodzenie". Taki login rozlewamy tylko jako uchwyt osoby („jkowalski"),
      // a w zapisie z domeną („FIRMA\wilk") sam cały token.
      const acct = loginUserPart(val);
      if (!medium && /^[a-z]+$/.test(acct) && !isPropagatableLogin(acct)) {
        if (acct !== val) loginValues.add(val);
        fieldOnlyLogins.add(acct);
      } else if (!medium || isPropagatableLogin(acct)) remember(val);
      ctx.bump('LOGIN');
      return `${kw}${q1}${ctx.M.LOGIN}${q2}`;
    },
  );
  ctx.text = ctx.text.replace(
    /\b([Uu]żytkownik\w*|[Ll]ogin\w*|[Kk]onto[ \t]+użytkownika)([ \t]+["„'«])((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{2,63})(["”'»])/g,
    (m, kw: string, q1: string, val: string, q2: string) => {
      if (RE_BUILTIN_ACCOUNT.test(val)) return m;
      remember(val);
      ctx.bump('LOGIN');
      return `${kw}${q1}${ctx.M.LOGIN}${q2}`;
    },
  );
  // Od najdłuższych: „FIRMA\jkowalski" musi zniknąć w całości, zanim propagacja samego
  // „jkowalski" rozetnie go na „FIRMA\[LOGIN]". Kropka kończąca zdanie nie blokuje („…konto
  // tkaminski."), kropka z ciągiem dalej tak („jan.nowak.adm", „tkaminski.example.com").
  // Litery spoza ASCII jawnie zakresem Latin-1/Extended zamiast \p{L}: regex budujemy dla każdej
  // wartości, a kompilacja wzorca z flagą „u" jest wielokrotnie droższa (2000 loginów: 0,35 s).
  // Login zapisany jak imię albo nazwisko („Login: Kowalski") nie rozbija pary osobowej, którą
  // zostawiliśmy dla FAZY 4: „User: Jan Kowalski" dawało „Jan [LOGIN]" — imię jawne obok maski.
  // Ta sama osoba z pola loginu w innym miejscu dokumentu, WIELKIMI literami: para w dowolnym
  // szyku („JANKOWSKI TOMASZ"), a pojedynczy wyraz tylko wtedy, gdy stoi sam — w ciągu wielkich
  // liter obok innego wyrazu to może być inna osoba („TOMASZ WRÓBEL"). Jeden skan ciągów
  // wielkich liter z odczytem z mapy, nie regex na każdą osobę.
  if (capsPersons.size) {
    const reCapsRun = new RegExp(`(?<![${PL_UP}${PL_LO}\\w\\[])[${PL_UP}]{2,}(?:[ \\t]+[${PL_UP}]{2,})*(?![${PL_UP}${PL_LO}\\w\\]])`, 'g');
    // Samo nazwisko za wyrazem ulicznym albo nazwą organizacji („UL. ZIELIŃSKA 5", „KLUB GÓRSKI")
    // to przymiotnik w nazwie, nie osoba z pola loginu: maska osoby psuła adres (zostawały „UL."
    // i numer domu) albo nazwę klubu.
    const nameHeadBefore = (prev: string | undefined): boolean => {
      const p = prev?.toLowerCase().replace(/\.$/, '');
      return !!p && (RE_CAPS_SPILL_STREET_HEAD.test(p) || ORG_HEAD_WORDS.has(p) || LEGAL_ENTITY_WORDS.has(p));
    };
    ctx.text = ctx.text.replace(reCapsRun, (run: string, offset: number, t: string) => {
      const ws = run.split(/([ \t]+)/);
      const words = ws.filter((_w, i) => i % 2 === 0);
      const prevWord = /(\p{L}+)\.?[ \t]+$/u.exec(t.slice(Math.max(0, offset - 16), offset))?.[1];
      if (words.length === 1) {
        const sur = capsPersons.get(run);
        if (!sur) return run;
        if (sur === run && nameHeadBefore(prevWord)) return run;
        ctx.bump('IMIE');
        return ctx.personMask(sur);
      }
      const out: string[] = [];
      const fnAt = (j: number): boolean => j >= 0 && j < words.length && isAsciiFirstName(foldAscii(words[j].toLowerCase()));
      // Głowa nazwy także dwa wyrazy wcześniej, za przymiotnikiem („KLUB SPORTOWY GÓRSKI",
      // „PRZEDSIĘBIORSTWO HANDLOWE GÓRSKI").
      const headInRun = (i: number): boolean => {
        for (let j = i - 1; j >= i - 3; j--) if (nameHeadBefore(j >= 0 ? words[j] : prevWord)) return true;
        return false;
      };
      for (let i = 0; i < words.length; i++) {
        const sur = i + 1 < words.length ? capsPersons.get(`${words[i]} ${words[i + 1]}`) : undefined;
        if (sur) {
          ctx.bump('IMIE');
          out.push(ctx.personMask(sur));
          i++;
        } else if (capsPersons.get(words[i]) === words[i] && !fnAt(i - 1) && !fnAt(i + 1) && !headInRun(i)) {
          // samo nazwisko w ciągu wersalików („WNIOSKODAWCA KOWALCZYK ZGŁOSIŁ"); para z innym
          // imieniem („KOWALCZYK PIOTR") to może być inna osoba — tę maskuje w całości FAZA 4
          ctx.bump('IMIE');
          out.push(ctx.personMask(words[i]));
        } else out.push(words[i]);
        if (i + 1 < words.length) out.push(ws[2 * i + 1]);
      }
      return out.join('');
    });
  }
  maskAnchoredLogins(ctx);
  for (const v of ctx.loginSeeds) loginValues.add(v);
  for (const v of [...loginValues].sort((a, b) => b.length - a.length)) {
    const word = /^[A-Z][a-z]+$/.test(v);
    ctx.text = ctx.text.replace(
      new RegExp(`(?<![\\w.-])${escapeRe(v)}(?!\\.?[\\w\\u00C0-\\u024F-])`, 'g'),
      (m: string, offset: number, t: string) => {
        if (word && loginWordInPersonPair(t, offset, m)) return m;
        ctx.bump('LOGIN');
        return ctx.M.LOGIN;
      },
    );
  }
  // Ta sama wartość jako całe pole pod inną etykietą konta („Login: soltys⏎Konto: soltys",
  // „Użytkownik: kasjer") — jawna obok maski zdradzała login. W prozie wyraz zostaje.
  for (const v of fieldOnlyLogins) {
    ctx.text = ctx.text.replace(
      new RegExp(
        String.raw`((?:^|\n)[ \t]*(?:[Kk]onto(?:[ \t]+użytkownika)?|[Uu]żytkownik|[Ll]ogin\w{0,3}|[Uu]ser(?:name)?|[Nn]azwa[ \t]+użytkownika)[ \t]*[:=][ \t]*)${escapeRe(v)}(?=[ \t]*(?:\([^()\n]*\)[ \t]*)?(?:\r?\n|$))`,
        'g',
      ),
      (_m: string, lb: string) => {
        ctx.bump('LOGIN');
        return lb + ctx.M.LOGIN;
      },
    );
  }
  if (ctx.protectedUrls.length) maskLoginsInUrls(ctx, loginValues);
}

// 1e) NUMER KSeF — biegnie PRZED passZnakSprawy (kształt numeru pasuje do wzorca znaku sprawy
// i dostawał maskę [ZNAK-SPRAWY]) oraz PRZED passNip: pierwszy człon numeru KSeF to NIP
// z poprawną sumą, więc bez tego przebiegu passNip zjadał sam prefiks i zostawiał
// „[NIP]-20250826-0100001AF629-AF" (wyciek fragmentu — „maskuj całość, nie fragment").
function passKsef(ctx: RedactCtx): void {
  if (!ctx.on('KSEF')) return;
  if (!hasKsefAnchor(ctx)) return;
  ctx.text = ctx.text.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
}

// 1e') NUMER KSIĘGI WIECZYSTEJ — PRZED passZnakSprawy: kształt „XXXX/NNNNNNNN/C" po etykiecie
// „Sygn." albo „Znak:" pasuje do wartości znaku sprawy, a jawny numer KW przez publiczną
// przeglądarkę ksiąg prowadzi wprost do właściciela nieruchomości.
// Ukośnik może otaczać odstęp, a po ukośniku może się złamać wiersz (tak łamie numer edytor).
// Po kotwicy separatorem bywa też sama spacja albo myślnik („KW WA1M 00512345 3"); bez kotwicy
// wymagamy ukośników (patrz passKw), bo trzy człony rozdzielone spacją to zbyt pospolity układ.
// Oba separatory tego samego rodzaju: mieszany „LU1I/00045678 2 działki" to numer zapisany bez
// cyfry kontrolnej, a spacja wciągała z prozy następną liczbę („2 działki" → „działki").
// Łącznik z ciągiem dalej („WA1M/00512345/6-12") to dłuższy znak sprawy, który passZnakSprawy
// maskuje w całości; odcięty numer zostawiał jawny przyrostek.
const KW_SLASH = '[ \\t]*[/-][ \\t]*(?:\\r?\\n[ \\t]*)?';
const KW_SHAPE = `([A-Za-z]{2}[1-9][A-Za-z])(?:${KW_SLASH}(\\d{8})${KW_SLASH}|[ \\t]+(\\d{8})[ \\t]+)(\\d)`;
const RE_KW_VALUE = new RegExp(
  `(?<![\\p{L}\\d/])${KW_SHAPE}(?![\\p{L}\\d/]|[.,]\\d|[-–][\\p{L}\\d])`,
  'gu',
);
/** Pierwsze dwie litery kodów wydziałów ksiąg wieczystych (obszary sądów okręgowych). Bez kotwicy
 *  maskujemy tylko te: sama cyfra kontrolna przepuszcza co dziesiąty kod produktu o tym kształcie
 *  („AB1C/12345678/7"), a znana para liter zawęża to kilkunastokrotnie. Brak pary na liście
 *  kosztuje najwyżej przeoczenie numeru bez słowa „KW" obok. */
const KW_COURT_PREFIXES = new Set(
  ('BB BI BY CZ EL GD GL GW JG KA KI KN KO KR KS KZ LD LE LM LU NS OL OP OS PL PO PR PT RA RZ ' +
    'SI SL SR SU SW SZ TB TO TR WA WL WR ZA ZG').split(' '),
);
/** Kotwica przed numerem: „KW" wielkimi literami jako osobny wyraz (także „nr KW", „Nr_KW",
 *  „<NumerKW>"), „Kw nr", „nr kw", dowolna odmiana „księga wieczysta" (także bez ogonków i sklejona
 *  w kluczu „numerKsiegiWieczystej") i skrót „ks. wiecz.". Samo małe „kw." to kwartał albo
 *  kwiecień, dlatego bez flagi /i: małe litery liczą się tylko po „nr"/„numer". Wielkie „KW" to
 *  też kilowaty („agregat 20 KW"), Komenda Wojewódzka („KW Policji", „KW PSP") i nazwa towaru
 *  („Zestaw KW-2") — te nie są etykietą księgi. */
const RE_KW_ANCHOR =
  /(?:(?<![\p{L}\d])(?<!\d[ \t]{0,2})(?:[Nn](?:umer|r)[_-]?)?KW(?![\p{L}\d]|-\d|[ \t]+(?:Policji|PSP|PP)(?!\p{L}))|(?<!\p{L})Kw\.?(?=[ \t]+nr)|(?<![\p{L}\d])[Nn](?:umer|r)\.?[ \t_-]*kw(?![\p{L}\d])|(?:[Kk]si[eę]g|KSI[EĘ]G)\p{L}{0,3}[ \t_-]*(?:[Ww]ieczyst|WIECZYST)\p{L}{0,3}|(?<!\p{L})[Kk]s\.[ \t]*wiecz\.)/u;
/** Koniec zdania w oknie kotwicy. Kropka po „nr" czy skrócie „wiecz." to nie koniec zdania; po
 *  „KW." tylko wtedy, gdy dalej stoi „Nr" („KW. Nr WA1M/…"). „Pismo przekazano do KW. Faktura …"
 *  kończy zdanie, inaczej kotwica przechodziła na numer faktury w następnym zdaniu. */
const RE_KW_SENTENCE_END =
  /(?<!(?:\b[Nn]r|wiecz|\bks))(?<!\b[Kk][Ww](?=\.[ \t]+Nr(?!\p{L})))[.!?](?=[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ])|\n[ \t]*\n/gu;
/** Łącznik wyliczenia między dwoma numerami: „KW nr A, B i C" — kotwica pierwszego niesie resztę.
 *  Bez tabulatora: w wierszu TSV („KR1P/…\tFV1A/…") następna komórka to inna kolumna, nie lista. */
const RE_KW_LIST_GAP = /^(?:[ ,;]|\r?\n|(?:i|oraz|lub|albo|a także)(?=[ \t])|(?:[Nn]r|numer)\.?(?=[ \t:]):?)*$/;
/** Parametr adresu, który zapowiada numer księgi („…/wyszukiwanieKW?kw=KR1P/…"). Kotwica dotyczy
 *  tylko wartości tego parametru: „?kw=buty" w sklepie to fraza wyszukiwania, a „?ksiegowosc=" to
 *  nie księga, więc sąsiedni parametr („&plik=ZP1A-20260315-1.pdf") nie może z niej korzystać. */
const RE_KW_URL_PARAM = /[?&#;](?:kw|nr_?kw|numer_?kw|ksi[eę]g[aię]?(?:_?wieczyst\w{0,3})?)=$/i;

/** Odstęp między kotwicą a numerem, przy którym kotwica jest ETYKIETĄ numeru: interpunkcja
 *  etykiety, znaczniki XML/JSON, kolumna tabeli, łamanie wiersza i „nr"/„numer"/„o numerze"/„pod".
 *  Tylko taka kotwica znosi wszystkie zabezpieczenia (zła suma, spacja albo myślnik zamiast
 *  ukośnika, małe litery). „KW" wspomniane w zdaniu jako pojęcie („odpis KW w pliku ZP1A-…",
 *  „KW nr …, faktura FV1A/…", „1;odpis KW;\n2;faktura;FV1A/…") nie jest etykietą kodu, który
 *  stoi za innym słowem, w innym rekordzie albo w następnym punkcie wyliczenia. Taki numer
 *  maskujemy tylko wtedy, gdy jest pewny sam w sobie (znany sąd i poprawna suma), jak bez kotwicy. */
const RE_KW_ADJ_GAP =
  /^(?:[ \t\r\n:=."'<>()[\]|_–-]|(?<!\p{L})(?:o[ \t]+)?(?:[Nn]r|NR|[Nn]umer(?:ze|em|u|y|ach|ami)?|NUMER|pod)(?!\p{L}))*$/u;
const RE_KW_ANCHOR_G = new RegExp(RE_KW_ANCHOR.source, 'gu');
/** Etykieta znaku sprawy tuż przed numerem KW wklejonym w znak („Znak sprawy: GN.KR1P/…/4",
 *  „Znak: WA1M/…/6.GN"). Cały znak maskuje wtedy passZnakSprawy; sam numer zostawiał jawny
 *  symbol komórki (fragment znaku). */
const RE_KW_ZNAK_BEFORE =
  /(?:znak sprawy|znak pisma|nasz znak|wasz znak|sygn\.?[ \t]*akt|sygnatura akt|sygn\.|znak(?=[ \t]*:))[ \t]*:?[ \t]*(?:[\p{L}\d]+[.-])*$/iu;

/** Kotwica-etykieta w oknie 40 znaków przed numerem, w tym samym zdaniu (etykieta z poprzedniego
 *  wiersza „KW:\n…" się liczy, ale nie z poprzedniego akapitu). Liczy się ostatnia kotwica w oknie
 *  i tylko wtedy, gdy od numeru dzieli ją sam odstęp etykiety (RE_KW_ADJ_GAP). */
function kwAnchoredBefore(text: string, offset: number): boolean {
  let win = text.slice(Math.max(0, offset - 40), offset);
  let cut = -1;
  RE_KW_SENTENCE_END.lastIndex = 0;
  for (let m = RE_KW_SENTENCE_END.exec(win); m; m = RE_KW_SENTENCE_END.exec(win)) cut = m.index + m[0].length;
  if (cut >= 0) win = win.slice(cut);
  let end = -1;
  RE_KW_ANCHOR_G.lastIndex = 0;
  for (let m = RE_KW_ANCHOR_G.exec(win); m; m = RE_KW_ANCHOR_G.exec(win)) end = m.index + m[0].length;
  if (end >= 0 && RE_KW_ADJ_GAP.test(win.slice(end))) {
    // Kotwica przez łamanie wiersza tylko jako etykieta: z „:"/„="/„>"/„|" przed łamaniem albo
    // gdy cały wiersz kotwicy to sama etykieta („Nr KW\n…", „1. Księga wieczysta\n…"). „KW" na
    // końcu nagłówka czy zdania („Załączniki do KW\n…", „agregat;20;KW\n…", „Pismo przekazano
    // do KW.\n…") nie jest etykietą kodu z następnego wiersza.
    const gap = win.slice(end);
    const nl = gap.indexOf('\n');
    if (nl < 0 || /[:=>|]/.test(gap.slice(0, nl))) return true;
    const absEnd = offset - win.length + end;
    const ls = text.lastIndexOf('\n', absEnd - 1) + 1;
    const rest = text.slice(ls, absEnd).replace(RE_KW_ANCHOR_G, '');
    if (/^[ \t]*(?:(?:\d{1,3}[.)]|[-*•])[ \t]*)?(?:(?:[Nn]r|NR|[Nn]umer|NUMER)\.?[ \t]*)?$/.test(rest)) return true;
  }
  return kwColumnAnchored(text, offset);
}

const RE_KW_SHAPE_CELL = new RegExp(`^[ \\t"']*${KW_SHAPE}[ \\t\\r"']*$`, 'u');
/** Nagłówek kolumny jako kotwica („Nr KW\tPowierzchnia\nKR1P/…\t120 m2"): numer musi stać w TEJ
 *  SAMEJ kolumnie co komórka z etykietą. Okno 40 znaków przenosiło „KW" z nagłówka na każdą
 *  kolumnę następnego wiersza („Nr KW\tStatus\nbrak\tWA2B 12345678 1 szt."). Idziemy w górę przez
 *  wiersze z numerami KW w tej kolumnie (kilka numerów pod jednym nagłówkiem); wycinek ograniczony,
 *  by długi tekst bez nowych wierszy nie był skanowany przy każdym trafieniu. */
function kwColumnAnchored(text: string, offset: number): boolean {
  const lines = text.slice(Math.max(0, offset - 400), offset).split('\n');
  if (lines.length < 2) return false;
  const cur = lines[lines.length - 1];
  const sep = cur.includes('\t') || lines[lines.length - 2].includes('\t') ? '\t' : cur.includes('|') ? '|' : '';
  if (!sep) return false;
  const curCells = cur.split(sep);
  if (!/^[ \t"']*$/.test(curCells[curCells.length - 1])) return false;
  const col = curCells.length - 1;
  // pierwszy wiersz wycinka bywa ucięty, więc go nie oceniamy (chyba że wycinek zaczyna tekst)
  const first = offset - 400 <= 0 ? 0 : 1;
  // W tabeli „|" nagłówek kolumny stoi zawsze nad linią „|---|". Bez niej wiersze to pary
  // klucz–wartość („| Rejestr | KW |\n| Id | ZZ9Z/… |"), a „KW" jest wartością, nie etykietą.
  let mdSep = false;
  for (let i = lines.length - 2; i >= first; i--) {
    const row = lines[i];
    if (sep === '|' && /^[ \t|:-]+$/.test(row)) {
      mdSep = true; // linia „|---|---|" w Markdownie
      continue;
    }
    const cell = row.split(sep)[col];
    if (cell === undefined) return false;
    if (RE_KW_SHAPE_CELL.test(cell)) continue;
    // Komórka musi BYĆ etykietą („Nr KW", „Księga wieczysta"), a nie opisem z tym słowem
    // („| 2 | odpis KW |" nad „| 3 | ZP1A/… |" to wiersz danych, nie nagłówek).
    const label = cell.trim();
    const a = RE_KW_ANCHOR.exec(label);
    return (
      !!a &&
      (sep !== '|' || mdSep) &&
      label.length <= 30 &&
      /^(?:(?:[Nn]r|NR|[Nn]umer|NUMER)\.?[ \t]*)?$/.test(label.slice(0, a.index)) &&
      RE_KW_ADJ_GAP.test(label.slice(a.index + a[0].length))
    );
  }
  return false;
}

/** Etykieta innego rodzaju numeru tuż przed kodem („Faktura nr PL1A/…", „nr seryjny PO1A/…",
 *  „Nr umowy: KA1F/…"). Kod o kształcie KW pod taką etykietą nie jest księgą, więc tryb bez
 *  kotwicy (znany sąd + suma) go nie maskuje. Rzeczowniki ogólne („umowy", „zamówienia",
 *  „zlecenia") liczą się tylko po „nr"/„numer": „Przedmiot umowy: KR1P/…" w akcie notarialnym
 *  to nadal księga. */
const RE_KW_OTHER_LABEL =
  /(?<!\p{L})(?:(?:faktur\p{L}*|FV|f-ry|rachun\p{L}*|seryjn\p{L}*|fabr\.|s\/n|SN|próbk\p{L}*|ref\.?|ewidencyjn\p{L}*(?:[ \t]+pracownik\p{L}*)?|parti\p{L}*|seri[aiąę]|przesył\p{L}*|paczk\p{L}*|katalogow\p{L}*|produkt\p{L}*|indeks\p{L}*|licznik\p{L}*)[ \t]*(?:(?:nr|numer)\.?[ \t]*)?|(?:nr|numer)\.?[ \t]*(?:umow\p{L}*|zamówie\p{L}*|zlece\p{L}*)[ \t]*)[:#]?[ \t]*$/iu;

/** Callback dla RE_KW_VALUE. `inUrl` — dopasowanie wewnątrz adresu: kotwicą jest wtedy tylko
 *  parametr numeru księgi stojący tuż przed wartością. */
function maskKwMatch(ctx: RedactCtx, inUrl = false) {
  let prevEnd = -1;
  return (
    m: string,
    code: string,
    numSlash: string | undefined,
    numSpace: string | undefined,
    c: string,
    offset: number,
    t: string,
  ): string => {
    const num = numSlash ?? numSpace ?? '';
    const before = t.slice(Math.max(0, offset - 40), offset);
    const after = t.slice(offset + m.length, offset + m.length + 2);
    if ((/[\p{L}\d][.-]$/u.test(before) || /^\.\p{L}/u.test(after)) && RE_KW_ZNAK_BEFORE.test(before)) return m;
    const anchored = inUrl
      ? RE_KW_URL_PARAM.test(before)
      : // wyliczenie niesie kotwicę tylko na kod znanego sądu („KW nr KR1P/…, FV1A/…" — faktura)
        (prevEnd >= 0 &&
          offset - prevEnd <= 12 &&
          KW_COURT_PREFIXES.has(code.slice(0, 2).toUpperCase()) &&
          RE_KW_LIST_GAP.test(t.slice(prevEnd, offset))) ||
        kwAnchoredBefore(t, offset);
    const valid = isValidKw(`${code}${num}${c}`);
    // Bez kotwicy tylko pełna pewność: wielkie litery, ukośniki, znany sąd i poprawna cyfra
    // kontrolna. Przy kotwicy maskujemy mimo złej sumy (literówka w piśmie), jak PESEL po „PESEL:".
    const ok =
      anchored ||
      (!RE_KW_OTHER_LABEL.test(before) &&
        /^[A-Z]{2}\d[A-Z]$/.test(code) &&
        m.split('/').length === 3 &&
        KW_COURT_PREFIXES.has(code.slice(0, 2)) &&
        valid);
    if (!ok) return m;
    // Wyliczenie otwiera tylko numer z kotwicą: numer pewny sam w sobie (sąd + suma) nie przenosi
    // kotwicy na sąsiedni kod („KR1P/…;ZZ9Z/…;OK", „WA1M/… i AB1C/… szt.").
    if (anchored) prevEnd = offset + m.length;
    ctx.bump('KW');
    // „KR1P 00123456 2 lokale": numer bez cyfry kontrolnej, a „2" to liczebnik z prozy. Przy
    // spacjach i złej sumie, gdy dalej stoi wyraz, cyfra zostaje w tekście (numer i tak w masce).
    if (numSpace !== undefined && !valid && /^[ \t]+\p{L}/u.test(t.slice(offset + m.length, offset + m.length + 3))) {
      return ctx.M.KW + m.slice(m.lastIndexOf(numSpace) + numSpace.length);
    }
    return ctx.M.KW;
  };
}

function passKw(ctx: RedactCtx): void {
  if (!ctx.on('KW')) return;
  ctx.text = ctx.text.replace(RE_KW_VALUE, maskKwMatch(ctx));
}

// 1f) ZNAK SPRAWY / ZNAK PISMA — sygnatura pisma urzędowego. Biegnie WCZEŚNIE, by zamaskować
// cały znak, zanim krótsze detektory (kod, telefon) odgryzą jego fragmenty cyfrowe. Dwa tryby:
function passZnakSprawy(ctx: RedactCtx): void {
  if (!ctx.on('ZNAK-SPRAWY')) return;
  // (a) STRUKTURALNIE — znak wg JRWA „SYMBOL.klasa.numer.ROK".
  const ZNAK_START = `[${PL_UP}]{2,}[0-9]*(?:-[A-Za-z${PL_UP}${PL_LO}0-9]+)*`;
  const ZNAK_MID = `(?:\\.[A-Za-z${PL_UP}${PL_LO}0-9-]+)*?`;
  ctx.text = ctx.text.replace(
    // Lookbehind obejmuje też polskie litery: bez nich start w ŚRODKU ciągu „ŻŻŻ…" był dozwolony
    // i każda pozycja skanowała ciąg do końca (czas kwadratowy, ~8 s na 100 tys. znaków).
    // Po roku najwyżej dwa człony: symbol komórki („.PL") albo numer kolejny/załącznika („.1").
    // Dawniej tylko litery — „…2026.1" dawało „[ZNAK-SPRAWY].1", a tryb (b) z etykietą nie
    // dokańczał maski, bo nie zaczyna od „[" (wyciek fragmentu znaku).
    new RegExp(`(?<![A-Za-z${PL_UP}${PL_LO}0-9./-])${ZNAK_START}${ZNAK_MID}\\.\\d+\\.(?:19|20)\\d{2}(?:\\.(?:[${PL_UP}]{2,3}|\\d{1,3})){0,2}(?!\\d)`, 'g'),
    maskConst(ctx, 'ZNAK-SPRAWY'),
  );
  // (b) Z KONTEKSTEM („Znak sprawy:", „Sygn. akt", „Znak:") — słowo zostaje, maskujemy sam znak.
  const ZNAK_VALUE =
    `(?:[IVXLCDM]{1,4}[ \\t]+)?[${PL_UP}][A-Za-z${PL_LO}]{0,4}(?:/[${PL_UP}][A-Za-z${PL_LO}]{0,3})?[ \\t]+\\d+[ \\t]*/[ \\t]*\\d{2,4}` +
    `|[A-Za-z0-9${PL_UP}${PL_LO}]+(?:[.\\-/][A-Za-z0-9${PL_UP}${PL_LO}]+)+`;
  maskAfterLabel(
    ctx,
    new RegExp(
      `\\b(znak sprawy|znak pisma|nasz znak|wasz znak|sygn\\.?[ \\t]*akt|sygnatura akt|sygn\\.|znak(?=[ \\t]*:))` +
        `([ \\t]*:?[ \\t]*)(${ZNAK_VALUE})`,
      'gi',
    ),
    'ZNAK-SPRAWY',
  );
}

// ═════ FAZA 2 · IDENTYFIKATORY NUMERYCZNE (suma kontrolna / etykieta / długość) ═════
// Najdłuższe ciągi cyfr najpierw (IBAN 26 → PESEL 11 → NIP 10 → REGON), potem krótsze.
// 2) IBAN (z prefiksem kraju, walidacja mod 97). Dopuszcza spacje w grupach.
/** Długości IBAN wg rejestru ISO 13616 (kraj → liczba znaków bez spacji). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21,
  CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24,
  TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};
/**
 * Długość (w znakach dopasowania) części, która jest numerem IBAN. Wzorzec IBAN-u połyka kolejne
 * wyrazy WERSALIKAMI („…0130 00 Z OPCJĄ SHA", „…4567 PKO BP", „… W EUR"), bo grupy numeru też
 * są z wielkich liter i cyfr. Dla znanego kraju tniemy na jego długości — tylko na granicy grupy
 * (spacja albo koniec), inaczej to nie ten numer. Dla nieznanego odcinamy końcowe wyrazy z samych
 * liter, o ile zostaje ≥ 15 znaków. Jeden kandydat na dopasowanie: mod-97 pilnuje precyzji jak dotąd.
 */
function ibanCut(m: string): number {
  const n = IBAN_LENGTHS[m.slice(0, 2)];
  if (n) {
    let k = 0;
    for (let i = 0; i < m.length; i++) {
      if (m[i] !== ' ') k++;
      if (k === n) {
        if (i + 1 === m.length || m[i + 1] === ' ') return i + 1;
        break;
      }
    }
  }
  const t = m.replace(/(?:[ ][A-Z]+)+$/, '');
  return t.replace(/ /g, '').length >= 15 ? t.length : m.length;
}
/**
 * Koniec maski numeru uciętego przez ibanCut. Krótkie grupy z cyfrą tuż za długością kraju to ten
 * sam numer z literówką albo nadmiarową cyfrą („DE89 … 0130 00 12", „PL61 … 2874 5") — idą pod
 * maskę razem z nim, inaczej zostaje jawny fragment numeru. Wyrazy z samych liter („PKO BP",
 * „W EUR") zostają jawne jak dotąd, a grupa, po której stoi waluta albo grosze, to kwota
 * („PL61 … 2874 1500 zł"), nie ogon numeru. `after` — tekst za dopasowaniem.
 */
const RE_IBAN_TAIL = /^(?:[ ](?=[A-Z]{0,3}\d)[A-Z0-9]{1,4}(?![A-Z0-9]))*/;
const RE_IBAN_AMOUNT_AFTER = new RegExp(`^[ \\t\\u00A0]*(?:,\\d|zł(?:ot\\p{L}*)?|${[...CURRENCY_CODES].join('|')})(?!\\p{L})`, 'iu');
function ibanMaskEnd(m: string, c: number, after: string): number {
  const tail = RE_IBAN_TAIL.exec(m.slice(c))?.[0] ?? '';
  if (tail && RE_IBAN_AMOUNT_AFTER.test(m.slice(c + tail.length) + after)) return c;
  return c + tail.length;
}
// Odstęp między grupami cyfr numeru konta: spacja, twarda spacja (NBSP), spacja cyfrowa i wąska
// twarda spacja. Edytory i bankowość elektroniczna wstawiają NBSP, żeby numer nie łamał się
// w wierszu — dawniej wzorce znały tylko zwykłą spację i taki numer wyciekał w całości.
const NUM_WS = '[ \\u00A0\\u2007\\u202F]';
/** Kopia z twardymi spacjami zamienionymi na zwykłe — ta sama długość, więc indeksy cięcia
 *  liczone na kopii (ibanCut, ibanMaskEnd) pasują do oryginału. */
const plainSpaces = (s: string): string => s.replace(/[\u00A0\u2007\u202F]/g, ' ');
// IBAN z odstępami (też twardymi) albo w kanonicznym zapisie z łącznikami co 4 znaki
// („PL57-1140-2004-0000-3002-0123-4567") — mod-97 i tak rozstrzyga.
const RE_IBAN = new RegExp(`\\b[A-Z]{2}\\d{2}(?:(?:${NUM_WS}?[A-Z0-9]){11,30}|(?:-[A-Z0-9]{4}){2,7}(?:-[A-Z0-9]{1,3})?)\\b`, 'g');
function passIban(ctx: RedactCtx): void {
  if (!ctx.on('IBAN')) return;
  ctx.text = ctx.text.replace(RE_IBAN, (m, offset: number) => {
    const p = plainSpaces(m);
    const c = ibanCut(p);
    if (isValidIban(m.slice(0, c))) {
      ctx.bump('IBAN');
      const after = ctx.text.slice(offset + m.length, offset + m.length + 8);
      return ctx.M.IBAN + m.slice(ibanMaskEnd(p, c, plainSpaces(after)));
    }
    return m;
  });
}
// (a) etykieta konta: także złożenia („mikrorachunek", „subkonto") i kwalifikator między etykietą
// a numerem („nr rachunku bankowego:", „rachunek podatkowy", „konto bankowe:", „rachunek VAT") —
// jak przy PESEL-u i NIP-ie. Dawniej przy złej sumie (literówka) taki numer wyciekał w całości.
const RE_ACCOUNT_LABELED = new RegExp(
  `(?<![\\p{L}])((?:mikro)?rachun(?:ek|ku|kiem)|(?:sub)?kont(?:o|a|em)|koncie|iban)(?![\\p{L}])` +
    `((?:\\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3}[\\s:.-]*)` +
    `((?:\\d${NUM_WS}?){25}\\d|\\d{2}(?:-\\d{4}){6})(?!${NUM_WS}?\\d|-\\d)`,
  'giu',
);
// (c) NRB bez etykiety: odstępy jak wyżej albo kanoniczne łączniki 2-4-4-4-4-4-4. Łącznik tylko
// w tym grupowaniu: „Konto księgowe 201-01-001-0002-…" czy numer zamówienia też mają 26 cyfr.
const RE_NRB_BARE = new RegExp(
  `(?<!\\d${NUM_WS}?|\\d-)(?:\\bPL${NUM_WS}?)?(?:(?:\\d${NUM_WS}?){25}\\d|\\d{2}(?:-\\d{4}){6})(?!${NUM_WS}?\\d|-\\d)`,
  'g',
);
// (b) etykieta + wartość w formacie IBAN (opis przy użyciu w passAccount); odstępy także twarde,
// polski numer też w kanonicznym zapisie z łącznikami, etykieta też „mikrorachunek".
const RE_ACCOUNT_IBAN_LABELED = new RegExp(
  `\\b((?:konto|Konto|KONTO|konta|Konta|rachunek|Rachunek|RACHUNEK|rachunku|Rachunku|mikrorachunek|Mikrorachunek|mikrorachunku|Mikrorachunku|nr konta|Nr konta|numer konta|Numer konta|iban|Iban|IBAN)(?:\\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\\s:=.-]+)` +
    `(PL${NUM_WS}?\\d{2}(?:${NUM_WS}?\\d){24}(?:${NUM_WS}?\\d){0,4}|PL\\d{2}(?:-\\d{4}){6}|[A-Z]{2}\\d{2}(?:${NUM_WS}?[A-Z0-9]){11,30})(?![A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]|-\\d)`,
  'g',
);

// 3) NR KONTA (NRB) zakotwiczony słowem „konto/rachunek/IBAN" + 26 cyfr (z opcjonalnymi spacjami).
function passAccount(ctx: RedactCtx): void {
  if (!ctx.on('NR-KONTA')) return;
  maskAfterLabel(ctx, RE_ACCOUNT_LABELED, 'NR-KONTA');
  // (b) z etykietą + wartość w formacie IBAN — maskuj NAWET bez poprawnej sumy mod-97.
  // BEZ flagi /i: wartość [A-Z0-9] musi być WIELKIMI literami/cyframi (jak realny IBAN). Z /i klasa
  // łapała małe litery następnego słowa („…3152 wpłynęły" → maska zjadała „ wp"). Warianty wielkości
  // liter etykiety wyliczone jawnie; lookahead (?![A-Za-z0-9]) domyka wartość na granicy słowa.
  // Polski numer ma osobną gałąź (PL + 26 cyfr), także ze spacją po „PL" („PL 92 1050 …" — wtedy
  // wzorzec ogólny nie pasował i przy złej sumie numer wyciekał w całości). Gałąź bierze też do
  // 4 nadmiarowych cyfr (literówka „… 2874 5"): idą pod maskę razem z numerem (ibanMaskEnd).
  // Wartość ogólna jest zachłanna jak w passIban, więc nadmiar („ PKO BP", „ W EUR", „ SWIFT")
  // odcina ibanCut i oddaje bez zmian. Prawa granica zna polskie litery: bez nich „…Z TYTU|ŁEM"
  // uchodziło za koniec wyrazu i maska zjadała „Z TYTU".
  ctx.text = ctx.text.replace(
    RE_ACCOUNT_IBAN_LABELED,
    (m, kw: string, sep: string, val: string, offset: number) => {
      ctx.bump('NR-KONTA');
      const p = plainSpaces(val);
      const after = plainSpaces(ctx.text.slice(offset + m.length, offset + m.length + 8));
      return `${kw}${sep}${ctx.M['NR-KONTA']}${val.slice(ibanMaskEnd(p, ibanCut(p), after))}`;
    },
  );
  // (c) NRB BEZ etykiety — 26 cyfr z POPRAWNĄ sumą (walidacja po dodaniu „PL"). Prefiks „PL"/„PL "
  // trafia pod maskę razem z numerem („PL [NR-KONTA]" zostawiało jawny kraj obok maski).
  ctx.text = ctx.text.replace(RE_NRB_BARE, (m) => {
    if (isValidIban('PL' + m.replace(/^PL/, '').replace(/[\s-]/g, ''))) {
      ctx.bump('NR-KONTA');
      return ctx.M['NR-KONTA'];
    }
    return m;
  });
}

// 4) PESEL — 11 cyfr + suma kontrolna, nie po „art./poz.".
function passPesel(ctx: RedactCtx): void {
  if (!ctx.on('PESEL')) return;
  ctx.text = ctx.text.replace(/(?<![\dA-Za-z])\d{11}(?![\d])/g, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    if (isValidPesel(m)) {
      ctx.bump('PESEL');
      return ctx.M.PESEL;
    }
    return m;
  });
  // (b) z SILNĄ etykietą „PESEL" — maskuj 11 cyfr NAWET bez poprawnej sumy (etykieta to sygnał).
  maskAfterLabel(
    ctx,
    /\b(pesel(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]+)(\d{11})(?![\d])/gi,
    'PESEL',
  );
  // (c) z etykietą i ODSTĘPAMI między cyframi („851 103 142 83", „851103 14283", kratki formularza).
  // Grupy mogą przejść przez JEDNO łamanie wiersza („PESEL 851 103⏎142 83" z zawiniętej kolumny),
  // ale tylko z poprawną sumą (pilnuje maskSpacedAfterLabel): ogon w nowej linii bywa innym polem.
  maskSpacedAfterLabel(ctx, /\b(pesel(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]*[\s:=.|-])(\d(?:(?:[ \t|-]{0,3}|[ \t]*\r?\n[ \t]*)\d){10})(?![ \t|-]{0,3}\d)/gi, 'PESEL', isValidPesel);
}

// Słowa za etykietą, które nie opisują numeru, tylko otwierają INNE pole albo mówią, że numeru nie
// ma: „PESEL⏎Tel. 48 601 222 333", „REGON brak telefon 601 222 333", „NIP⏎KRS 0000 123 456". Lista
// słów etykiety przechodziła przez nową linię i wartość następnego pola dostawała maskę numeru.
const RE_FOREIGN_FIELD_WORD =
  /^(?:tel\p{L}*|kom|komórk\p{L}*|fax|faks|kontakt\p{L}*|krs|kart[aęyą]?|kont(?:o|a|u|em|cie)|rachun\p{L}*|iban|nrb|dow[oó]d\p{L}*|paszport\p{L}*|pesel|nip|regon|brak|nie)$/iu;
/**
 * Numer z silną etykietą zapisany z odstępami między cyframi: grupy („PESEL: 851 103 142 83",
 * „NIP 5260 2502 74") albo cyfra po cyfrze w kratkach formularza („PESEL: 8 5 1 1 0 3 1 4 2 8 3",
 * „|8|5|1|…"). Dawniej żadna gałąź nie znała separatorów w środku: zapis 3-3-3-2 zjadał detektor
 * telefonu i zostawał jawny ogon („PESEL: [TELEFON] 83"), a pozostałe wyciekały w całości. Grupy
 * co najmniej dwucyfrowe rozdzielone pojedynczą spacją lub łącznikiem to zapis numeru, więc jak przy
 * zapisie ciągiem maskujemy mimo złej sumy (literówka). Cyfry pojedyncze, tabulator, „|" albo kilka
 * spacji: tylko z poprawną sumą, bo to też wzór z instrukcji („Pole PESEL: 1 2 3 4 …") czy kolumny.
 * Bez etykiety nic się nie zmienia: „Jan Kowalski 501 120 345 43" to telefon i wiek, nie PESEL.
 */
function maskSpacedAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType, valid: (d: string) => boolean): void {
  ctx.text = ctx.text.replace(re, (m, kw: string, sep: string, val: string, off: number, str: string) => {
    // słowa etykiety tylko w tym samym wierszu i tylko takie, które opisują ten numer
    // („PESEL pacjenta:", „NIP nabywcy"); pierwsze słowo to sama etykieta
    if (kw.includes('\n') || kw.split(/\s+/).slice(1).some((w) => RE_FOREIGN_FIELD_WORD.test(w))) return m;
    const core = val.replace(/^PL[- ]?/, ''); // prefiks kraju przed NIP-em
    if (!/[ \t|\n-]/.test(core)) return m;
    const d = core.replace(/\D/g, '');
    // Łamanie wiersza w środku numeru: najwyżej jedno. Z poprawną sumą zawsze, z literówką tylko
    // grupy, które w nowej linii same domykają wiersz („PESEL: 851 103⏎142 84"), a nie początek
    // innego pola z liczbą.
    if (core.includes('\n')) {
      if ((core.match(/\n/g) || []).length > 1) return m;
      const tailEnds = /^[ \t]*(?:\r?\n|$)/.test(str.slice(off + m.length));
      if (!valid(d) && !tailEnds) return m;
    }
    const grouped = /^\d{2,}(?:(?:[ -]|[ \t]*\r?\n[ \t]*)\d{2,})+$/.test(core);
    if (!grouped && !valid(d)) return m;
    ctx.bump(type);
    return `${kw}${sep}${ctx.M[type]}`;
  });
}

// 5) NIP — separator MYŚLNIK LUB SPACJA lub 10 cyfr ciągiem + suma kontrolna. Spacja także twarda
// (NUM_WS): „NIP: 526 000 12 46" z NBSP wyciekał, choć ten sam zapis z łącznikami był maskowany.
const NIP_SEP = '[- \\u00A0\\u2007\\u202F]';
const NIP_VALUE = `(?:PL${NIP_SEP}?)?(?:\\d{3}${NIP_SEP}\\d{3}${NIP_SEP}\\d{2}${NIP_SEP}\\d{2}|\\d{3}${NIP_SEP}\\d{2}${NIP_SEP}\\d{2}${NIP_SEP}\\d{3}|\\d{10})`;
const RE_NIP = new RegExp(`(?<![\\d])${NIP_VALUE}(?![\\d])`, 'g');
const RE_NIP_LABELED = new RegExp(`\\b(nip(?:\\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\\s:=.-]+)(${NIP_VALUE})(?![\\d])`, 'gi');
function passNip(ctx: RedactCtx): void {
  if (!ctx.on('NIP')) return;
  // Opcjonalny prefiks kraju „PL" maskujemy RAZEM z numerem — maskuj całość, nie fragment.
  ctx.text = ctx.text.replace(
    RE_NIP,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (isValidNip(m.replace(/^PL[- \u00A0\u2007\u202F]?/, ''))) {
        ctx.bump('NIP');
        return ctx.M.NIP;
      }
      return m;
    },
  );
  // (b) z SILNĄ etykietą „NIP" — maskuj 10 cyfr (dowolny separator) NAWET bez poprawnej sumy.
  maskAfterLabel(ctx, RE_NIP_LABELED, 'NIP');
  // (c) z etykietą i innym grupowaniem albo cyframi w kratkach („NIP: 5 2 6 0 2 5 0 2 7 4").
  maskSpacedAfterLabel(ctx, /\b(nip(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]*[\s:=.|-])((?:PL[- ]?)?\d(?:[ \t|-]{0,3}\d){9})(?![ \t|-]{0,3}\d)/gi, 'NIP', isValidNip);
}

// 6) REGON 14-cyfrowy (jednoznaczny) + suma kontrolna.
function passRegon(ctx: RedactCtx): void {
  if (!ctx.on('REGON')) return;
  ctx.text = ctx.text.replace(/(?<![\d])\d{14}(?![\d])/g, (m) => {
    if (isValidRegon14(m)) {
      ctx.bump('REGON');
      return ctx.M.REGON;
    }
    return m;
  });
  // 6a) REGON z etykietą „REGON" — 9 lub 14 cyfr. Maskuj NAWET bez poprawnej sumy.
  maskAfterLabel(
    ctx,
    /\b(regon(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]+)(\d{14}|\d{9})(?![\d])/gi,
    'REGON',
  );
  // (c) z etykietą i odstępami między cyframi („REGON: 012 345 675", „REGON: 0 1 2 3 4 5 6 7 5").
  maskSpacedAfterLabel(
    ctx,
    /\b(regon(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]*[\s:=.|-])(\d(?:[ \t|-]{0,3}\d){13}|\d(?:[ \t|-]{0,3}\d){8})(?![ \t|-]{0,3}\d)/gi,
    'REGON',
    (d) => (d.length === 14 ? isValidRegon14(d) : isValidRegon9(d)),
  );
}

// 6b) KARTA PŁATNICZA — TYLKO z kontekstem karty („karta/płatnicz/Visa/Mastercard/Maestro/Amex/
// Diners/Discover/JCB/card"): 13–19 cyfr (grupy po 4, sep. spacja/myślnik) + prefiks znanej sieci
// + suma Luhna. Kontekst jest WYMAGANY, bo sam Luhn+prefiks jest zbyt niejednoznaczny: IMEI
// (15 cyfr, MA sumę Luhna, prefiksy 35/37/4…), numery przesyłek/faktur, kody kreskowe (EAN) i
// identyfikatory transakcji też je spełniają. Bez etykiety karty NIE maskujemy (precyzja >
// nadmaskowanie — audyt adwersarialny wykrył 10 fałszywych trafień na wariancie bez kontekstu).
// Biegnie PRZED REGON, żeby kontekst karty wygrał dla 14-cyfrowego numeru (Diners) nad ślepą
// sumą REGON; numer 14-cyfr bez kontekstu karty zostaje dla REGON.
// Człon numeru po słowie karty: „Card number:", „kartą o numerze …", „karta o nr …" i klucze
// zrośnięte („card_number", „cardNumber", „card_no") — dawniej znane było tylko „nr/numer/no".
// Kontekst karty i walidacja (Luhn, sieć, długość) bez zmian, więc „umowa o numerze …" czy
// „Discard number …" (bez granicy przed „card") zostają.
function passCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA')) return;
  ctx.text = ctx.text.replace(
    /\b((?:kart[a-ząćęłńóśźż]*|card|visa|mastercard|maestro|amex|american\s+express|diners(?:\s+club)?|discover|jcb|płatnicz[a-ząćęłńóśźż]*|kredytow[a-ząćęłńóśźż]*|debetow[a-ząćęłńóśźż]*)(?:(?:[ \t]+o)?[ \t]+(?:nr|numer(?:ze|u)?|number|no)\.?|[_-]?(?:number|no|nr)\b)?)([\s:="'()<>|.-]+)((?:\d[ -]?){12,18}\d)(?![\d])/gi,
    (m, kw: string, sep: string, num: string) => {
      if (isValidCard(num)) {
        ctx.bump('KARTA');
        return `${kw}${sep}${ctx.M.KARTA}`;
      }
      return m;
    },
  );
}

// 8) TELEFON — polskie numery 9-cyfrowe. Trzy tryby, od najpewniejszego. (b) BIEGNIE PRZED (a),
// by placeholder nie przerwał łańcucha wyliczenia po kotwicy.
// Separatory członów wyliczenia w trybie (b): przecinek i „oraz/i" oraz — od niedawna — średnik,
// ukośnik i „lub/albo/bądź" (dawniej drugi numer po „lub" albo „/" zostawał jawny). „bądź"
// z granicą polskich liter, bo ASCII \b nie widzi granicy przy „ź". Człon po NOWYM separatorze
// musi być CAŁYM numerem (bez dalszych cyfr w tym samym wierszu): „lub 0048 61 852 33 48" nie
// może stać się „[TELEFON] 33 48" — taki numer przejmuje w całości tryb (a). Dawne separatory
// zachowują dawne zachowanie (prefiksy „0048"/„(48)" po przecinku to osobna sprawa). Żaden człon
// łańcucha nie może być kwotą („tel. 601 222 333 lub 120 000 000 zł" — kwota zostaje), jak w (c).
const PHONE_ENUM_SEP_OLD = String.raw`(?:,|\boraz\b|\bi\b)`;
const PHONE_ENUM_SEP_NEW = String.raw`(?:;|\/|\blub\b|\balbo\b|(?<![a-ząćęłńóśźż])bądź(?![a-ząćęłńóśźż]))`;
// Prefiks kraju przed numerem w trybie (b): „+48", „0048", „00 48", „(48)", „(+48)", „(0048)",
// „48" sklejone z numerem („48512345678") i zero międzymiastowe po nim („+48 (0)22 …"). Dawniej znany
// był tylko „+48" z separatorem, więc okno 9 cyfr zaczynało się na kodzie kraju i ostatnie cyfry
// numeru zostawały jawne („tel.: [TELEFON] 55 21"). Za nim opcjonalne zero międzymiastowe starego
// zapisu („(0-61) 852 33 44", „(061) 852 33 45"). Ten sam człon w regexie, w członie wyliczenia
// i w segmencie maskowanym w callbacku — inaczej okna się rozjeżdżają i zostaje ogon numeru.
// Długość całości pilnuje `phoneDigitsValid`: „tel. 4851234567" czy „tel. 485123456789" odpadają.
const PHONE_CC = String.raw`(?:\(?(?:(?:\+|00)[ \t]?)?48\)?[\s.-]{0,3}(?:[ \t]?\(0\))?)?(?:\(?0(?![\s-]?0)[\s-]?)?`;
const PHONE_ENUM_MEMBER = String.raw`\s*(?:(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|kom\.?|tel\.?|nr\.?)\s+)?${PHONE_CC}(?:[\s\-().]{0,3}\d){9}`;
const PHONE_NOT_AMOUNT = String.raw`(?![ \t]*(?:,\d{2})?[ \t]*(?:zł|PLN|EUR|USD|gr\b))`;
// Kotwice trybu (b). MOCNE (tel./telefon/nr tel./fax/faks) dopuszczają przerwę do dwóch wyrazów
// w tej samej linii, gdy ostatni jest skrótem z kropką albo stoi przed dwukropkiem („tel. stacj.
// 22 843 21 09", „Telefon pacjenta: …", „Nr tel. opiekuna: …"): stacjonarny 2-3-2-2 po takiej
// etykiecie wyciekał w całości, bo (c) celowo go nie łapie. Przerwa należy do kotwicy, nie do
// strażnika w callbacku — odrzucone dopasowanie zjadłoby kotwicę leżącą dalej w tym samym ciągu.
// Bez przerwy zostają „kom." (Komisja, Komenda: „Kom. Wyborcza: 32 774 91 55 głosów") i „kontakt"
// („Kontakt sprawy: …"), a liczba mnoga „Telefonów było: …" nie jest mocną kotwicą.
// Pozostałe: odmiana „komórkę/komórce/komórką/komórkowy", „telefonicznie", stopki („Phone:",
// „Mobile:", „mob.", „GSM:" — granica \b odcina „iPhone" i „mobbing") i czasownik z „pod/na
// numer" („dzwonić pod numer …", „zadzwoń pod nr …"); sam czasownik nie wystarcza („Dzwonił
// w sprawie faktury …"), a „dzwo[nń]\w*" łapałoby „Dzwonnica nr 123 456 789". Samo „pod/na" bez
// „numer" też jest kotwicą („proszę dzwonić pod 512 345⏎678"): numer złamany w wierszu wyciekał
// w całości, bo fallback 3-3-3 celowo nie przechodzi przez nową linię.
// Skróty z wykazów sprzętu („Telefon nr inw. 012345678 – zużyty", „Fax nr fabr. 12 345 67 89",
// „nr ewid.", „nr ser.") nie są przerwą w etykiecie telefonu: za nimi stoi numer składnika majątku.
const PHONE_GAP_WORD = String.raw`(?!(?:inw|ewid|fabr|ser|kat|poz|szt|egz|lp)\.)[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{2,15}`;
// Linia vCard z parametrami („TEL;TYPE=WORK:22 123 45 67", „TEL;WORK;VOICE:…") — stacjonarny 2-3-2-2
// po niej wyciekał, bo średnik z parametrami rozdzielał kotwicę „TEL" od dwukropka. Parametr przed
// dwukropkiem jest obowiązkowy: „Hotel; pokój 22 123 45 67" nie ma „TEL" jako osobnego wyrazu.
const PHONE_ANCHOR =
  '(?:tel(?:;[A-Za-z-]{1,20}(?:=[A-Za-z0-9,-]{1,40})?){1,4}(?=:))|' +
  String.raw`(?:te[li]\.?|telefon(?:u|y|em|ie)?|nr te[li]\.?|fax|faks)(?:(?:[ \t]+${PHONE_GAP_WORD}\.?)?[ \t]+${PHONE_GAP_WORD}(?:\.|[ \t]*(?=:)))?` +
  String.raw`|telefon(?:\w|[ąćęłńóśźż]){0,6}|kom\.?|komór(?:k(?:\w|[ąćęłńóśźż]){1,5}|ce)|kontakt\w{0,4}|(?:tele)?phone|mobile|mob\.?|gsm` +
  String.raw`|(?:za|od|prze)?dzwo(?:ni(?:ć|li|ły|my|cie|sz|ą|ę|ł[a-ząęó]*)?|ń(?:cie)?)[ \t]+(?:pod|na)(?:[ \t]+(?:numer\w*|nr\.?))?`;
// Wypełniacz „nr"/„na" tylko w tej samej linii („tel. nr 600 700 800", „Kontakt: nr …", „Tel. na …"):
// „Telefon⏎nr 123 456 789" to nagłówek nad numerem czegoś innego. Po samym „kontakt" bez dwukropka
// „nr" odrzuca callback — „Dotyczy kontaktu nr 123456789 w CRM" to identyfikator rekordu.
// (patrz rejectPhoneNrFiller). Podział wypełniacza musi być jednoznaczny: przy „[ \t]*[:.]?[ \t]+"
// ciąg spacji dzielił się między dwa kwantyfikatory na wiele sposobów, a kropkę po „nr" brało albo
// „nr\.?", albo „[:.]" następnego powtórzenia. W wierszu tabeli bez numerów („Telefon      NA
// NA …" z eksportu danych z brakami) każde powtórzenie mnożyło liczbę prób i jeden wiersz liczył się
// sekundami. Dlatego dwukropek albo kropka tylko z odstępami PRZED nimi, a „nr" zawsze bierze kropkę.
const RE_PHONE_NR_WORD = /(?<!\p{L})nr(?!\p{L})/iu;
// Przymiotnik, liczba mnoga i przysłówek („telefoniczne", „telefonów", „telefony", „telefonicznie")
// — nie rzeczownik „telefon/telefonu/telefonem/telefonie".
const RE_PHONE_KW_WEAK = /^telefon(?!(?:u|em|ie)?(?!\p{L}))/iu;
/**
 * Czy wypełniacz „nr" po kotwicy wskazuje numer sprawy, a nie telefon? Po samym „kontakt…" tuż
 * przed „nr" stoi identyfikator rekordu („Dotyczy kontaktu nr 123456789"), a po przymiotniku,
 * liczbie mnogiej czy przysłówku numer zgłoszenia, umowy albo faktury („Zgłoszenie telefoniczne
 * nr 202410001", „Abonament telefoniczny nr …", „Faktura za telefony nr …", „przyjęto
 * telefonicznie pod nr …"). Dwukropek robi z tego etykietę pola („Kontaktowy nr: …", „Telefony: nr …"),
 * a „Telefony" na początku wiersza albo zdania to nagłówek listy („Telefony nr 600 … i 601 …").
 */
function rejectPhoneNrFiller(kw: string, sep: string, str: string, offset: number): boolean {
  if (sep.includes(':')) return false;
  if (/^kontakt/i.test(kw)) return /^\s+nr\b/i.test(sep);
  if (!RE_PHONE_KW_WEAK.test(kw) || !RE_PHONE_NR_WORD.test(sep)) return false;
  if (/^telefony$/i.test(kw)) {
    let i = offset - 1;
    while (i >= 0 && (str[i] === ' ' || str[i] === '\t')) i--;
    if (i < 0 || /[\n.;!?]/.test(str[i])) return false;
  }
  return true;
}
const RE_PHONE_ANCHORED = new RegExp(
  String.raw`\b(${PHONE_ANCHOR})((?:\s+(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|telefoniczn\w+|pod|numer\w*)|(?:[ \t]*[:.])?[ \t]+(?:nr(?:\.|(?!\.))|na))*[\s:.=-]*)(${PHONE_CC}(?:[\s\-().]{0,3}\d){9}(?:\s*${PHONE_ENUM_SEP_OLD}${PHONE_ENUM_MEMBER}${PHONE_NOT_AMOUNT}|\s*${PHONE_ENUM_SEP_NEW}${PHONE_ENUM_MEMBER}(?![ \t\-().]{0,3}\d)${PHONE_NOT_AMOUNT})*)(?![.:]?\d)`,
  'gi',
);
// Segment zaczyna się od kropki i odstępów wypełniacza („, tel. 0048 601 …", „kom. 0 602 …"): bez
// nich skan startował od samej kropki, okno 9 cyfr (które też przepuszcza kropkę) zaczynało się na
// cyfrach prefiksu, a ogon numeru abonenta zostawał jawny za maską („kom. [TELEFON]3 444").
const RE_PHONE_SEGMENT = new RegExp(String.raw`[\s.]*${PHONE_CC}(?:[\s\-().]{0,3}\d){9}`, 'g');
/**
 * Czy cyfry członu to numer: 9 cyfr krajowych, z zerem międzymiastowym 10, a przed nimi
 * ewentualnie kod kraju „48"/„0048" („+48 (0)22 …" daje 12 cyfr z „480").
 */
function phoneDigitsValid(d: string): boolean {
  const national = (s: string): boolean => s.length === 9 || (s.length === 10 && s[0] === '0');
  return national(d) || (d.startsWith('48') && national(d.slice(2))) || (d.startsWith('0048') && national(d.slice(4)));
}
const PHONE_ENUM_SEP = `(?:${PHONE_ENUM_SEP_OLD}|${PHONE_ENUM_SEP_NEW})`;
const RE_PHONE_ENUM_SPLIT = new RegExp(String.raw`\s*${PHONE_ENUM_SEP}\s*`, 'i');
// Data na początku członu („Kontakt telefoniczny 12.10.2026 9", „Tel. 2026.10.14 9:05"): okno
// 9 cyfr trybu (b) przepuszcza kropki i myślniki, więc data z cyfrą godziny dawała „telefon"
// („[TELEFON]:45"). Prawa granica RE_PHONE_ANCHORED `(?![.:]?\d)` odcina godzinę z minutami,
// a ten wzorzec — datę z samą godziną na końcu członu.
const RE_PHONE_DATE_SHAPE =
  /^[\s(]*(?:\d{1,2}[.\-/](?:0?[1-9]|1[0-2])[.\-/](?:19|20)\d{2}|(?:19|20)\d{2}[.\-/](?:0?[1-9]|1[0-2])[.\-/]\d{1,2})(?!\d)/;

// ── Strażniki trybu (c) — liczba w kształcie telefonu, która telefonem nie jest ──
// Odstępy poziome razem z twardą i wąską spacją: edytory i eksporty z arkuszy wstawiają je
// między grupy cyfr kwoty i przed walutą („150 000 000 zł").
const PHONE_GAP = '[ \\t\\u00A0\\u2009\\u202F]';
const PHONE_CODES = [...CURRENCY_CODES, 'HUF', 'EURO', 'KČ', 'ZL'].join('|');
// Waluta albo mnożnik PO liczbie (bez względu na wielkość liter, z granicą litery: „601 234 567
// EUROPA" to nie kwota). Grosze „,50" mogą stać między liczbą a walutą.
const RE_PHONE_AMOUNT_AFTER = new RegExp(
  `^${PHONE_GAP}*(?:,\\d{1,2}(?!\\d))?${PHONE_GAP}*(?:(?:${PHONE_CODES}|tys|mln|mld)(?!\\p{L})|[€£]|\\$(?!\\p{L}))`,
  'iu',
);
// „zł" i „gr" osobno, z rozróżnieniem wielkości liter i tylko w formach waluty: wyraz zaczynający
// się od tych liter to nie kwota — „601 234 567 Złotów" i „… ZŁOTÓW" to miasto, „… ZŁOŻYŁ
// WNIOSEK" i „… złożył" to proza, „… Gr. A" to grupa (flaga „i" brała ją za grosze).
const RE_PHONE_ZL_AFTER = new RegExp(
  `^${PHONE_GAP}*(?:,\\d{1,2}(?!\\d))?${PHONE_GAP}*` +
    '(?:zł(?:ot(?:y|e|ych|ego|emu|ym|ymi|ówk\\p{L}*|ówek))?|ZŁ(?:OT(?:Y|E|YCH|EGO|EMU|YM|YMI|ÓWK\\p{L}*|ÓWEK))?|' +
    'Zł(?:ot(?:y|e|ych))?|gr(?:osz\\p{L}*)?)(?!\\p{L})',
  'u',
);
// Waluta za numerem, a za nią kolejna liczba („603 456 789 zł 30,00") — waluta poprzedza kwotę.
const RE_CURRENCY_BEFORE_NUMBER = new RegExp(`^${PHONE_GAP}*(?:zł|ZŁ|Zł|PLN|EUR|USD|€|\\$)${PHONE_GAP}*\\d`, 'u');
// Waluta PRZED liczbą („PLN 125 450 300", „€125 450 300") — ale nie wtedy, gdy kończy INNĄ kwotę
// („Abonament 49 zł 600 100 200": tu numer stoi po kwocie, a nie jest nią).
const RE_PHONE_AMOUNT_BEFORE = new RegExp(`(?:(?<![\\p{L}\\d])(?:${PHONE_CODES}|zł)|[€$£])${PHONE_GAP}?$`, 'iu');
const RE_PHONE_AMOUNT_BEFORE_OTHER = new RegExp(`\\d${PHONE_GAP}*(?:(?:${PHONE_CODES}|zł)|[€$£])${PHONE_GAP}?$`, 'iu');
// Ogon liczby ≥ 1 mld: grupa wiodąca 1–3 cyfr otwiera pole („Wartość: 1 234 567 890"), komórkę
// („| 1 234 567 890") albo nawias. Bez cyfry przed ogranicznikiem — „14:22 512 345 678" to godzina
// i telefon — i bez „48" (prefiks kraju zapisany bez plusa).
const RE_PHONE_BILLION_HEAD = /(?<!\d)[:|=;\t(][ \t]*(?!48\D)[1-9]\d{0,2}.$/;
// …ale nie po etykiecie identyfikatora albo telefonu: „PESEL: 85 110 314 283" to numer, nie kwota.
const RE_PHONE_ID_LABEL =
  /(?<![\p{L}])(?:pesel|nip|regon|krs|dow[oó]d\p{L}*|paszport\p{L}*|tel|telefon\p{L}*|kom|komórk\p{L}*|fax|faks|kontakt\p{L}*|nr|numer\p{L}*|id)(?![\p{L}])/iu;
/**
 * Czy liczba w kształcie telefonu to w istocie kwota? Tryb (c) nie ma kotwicy, więc tu decyduje
 * otoczenie: waluta lub mnożnik po liczbie albo przed nią, grosze po liczbie grupowanej spacjami,
 * ogon większej liczby po etykiecie pola, okrągłe setki milionów. Tryb kotwicowy (b) biegnie
 * wcześniej i tego nie sprawdza — „tel. 500 000 000" dalej jest telefonem.
 */
function looksLikeAmount(full: string, offset: number, m: string): boolean {
  const end = offset + m.length;
  const after = full.slice(end, end + 16);
  if (RE_PHONE_AMOUNT_AFTER.test(after) || RE_PHONE_ZL_AFTER.test(after)) return true;
  const before = full.slice(Math.max(0, offset - 16), offset);
  if (RE_PHONE_AMOUNT_BEFORE.test(before) && !RE_PHONE_AMOUNT_BEFORE_OTHER.test(before)) return true;
  if (/^\d{3}0{6}$/.test(m.replace(/\D/g, ''))) return true;
  // Pozostałe reguły tylko dla liczby grupowanej JEDNOLITYM odstępem (kwota). Ciągłe 9 cyfr
  // z polem CSV obok („Kowalski,Jan,512345678,34") to dalej telefon.
  const sep = /^\d{3}([    ])\d{3}\1\d{3}$/.exec(m)?.[1];
  if (!sep) return false;
  // grosze „,55" — ale nie w CSV: bez przecinka przed liczbą i bez kolejnego pola po groszach
  if (full[offset - 1] !== ',' && /^,\d{1,2}(?![\d,])/.test(after)) return true;
  if (!before.endsWith(sep) || !RE_PHONE_BILLION_HEAD.test(before)) return false;
  // Etykieta w tej samej linii — granicę linii szukamy tylko w oknie (lastIndexOf po całym
  // tekście był kwadratowy w długiej linii bez „\n").
  const win = full.slice(Math.max(0, offset - 40), offset);
  return !RE_PHONE_ID_LABEL.test(win.slice(win.lastIndexOf('\n') + 1));
}
// Człon przed „/" lub „-", który nie robi z numeru identyfikatora: wyraz od wielkiej litery
// (osobno od słów telefonicznych — flaga „i" zrównałaby \p{Lu} z małymi literami).
const RE_PHONE_JOIN_WORD = /^(?:tel|telefon\p{L}*|kom|komórk\p{L}*|sms|gsm|fax|faks|kontakt\p{L}*|mob|mobile|cell|phone)$/iu;
// Prefiksy numerów komórkowych w Polsce (9 cyfr bez kierunkowego kraju).
const RE_PL_MOBILE_PREFIX = /^(?:45|5[0137]|6[069]|7[2389]|88)\d{7}$/;
const isPersonalJoinPart = (s: string): boolean => /^\p{Lu}\p{Ll}+$/u.test(s) || RE_PHONE_JOIN_WORD.test(s);
/**
 * Czy 9 cyfr to wnętrze identyfikatora („RR123456789PL", „FV/2026/123456789", „ZAM-123456789",
 * „SKU 123456789A", „DE811569869")? Wtedy maska rozrywała token i zostawiała jawne kawałki.
 * Sprawdzamy w callbacku, nie w lookbehindzie: lookbehind o zmiennej długości jest kwadratowy.
 * Mała litera przed numerem NIE blokuje („Kowalski512345678", „dzwoń512345678" z ekstrakcji
 * PDF to telefon), a „/" i „-" blokują tylko jako łącznik tokenu identyfikatora (niżej) —
 * „500600700/501601701" i lista „-500600700" to dalej telefony.
 */
// Człon nazwy pliku przed numerem: data albo jej część („2024", „20240512", „2024-05-12", „05"),
// wersja („v2"), wyraz CamelCase („WhatsApp") albo przedrostek zdjęcia czy skanu („IMG", „DSC").
const RE_FILE_DATE_PART = /^(?:(?:19|20)\d{2}(?:-?\d{2}){0,2}|\d{2}|[vV]\d{1,3})$/;
const RE_FILE_WORD_PART = /^(?:\p{Ll}{2,}(?:-\p{Ll}{2,})*|\p{Lu}\p{Ll}+(?:\p{Lu}\p{Ll}*)*|IMG|DSC|DSCN|VID|PXL|MVIMG|SCAN|PIC)$/u;
/**
 * Czy przed numerem stoi nazwa pliku ze zwykłych wyrazów, dat i wersji, sklejonych podkreślnikiem
 * („wniosek_2024-05-12_", „skan_dowodu_2024_", „WhatsApp_", „IMG_", „umowa_v2_")? Co najmniej jeden
 * człon musi być wyrazem; kod wersalikami („ZAM_", „FV_2024_") dalej robi z numeru identyfikator.
 */
function fileNameChainBefore(before: string): boolean {
  const chain = /(?:^|[^\p{L}\d_-])((?:[\p{L}\d-]+_+)+)$/u.exec(before)?.[1];
  if (!chain) return false;
  const parts = chain.split(/_+/).filter(Boolean);
  return parts.every((p) => RE_FILE_DATE_PART.test(p) || RE_FILE_WORD_PART.test(p)) && parts.some((p) => RE_FILE_WORD_PART.test(p));
}
function gluedToIdentifier(full: string, offset: number, len: number): boolean {
  const before = full.slice(Math.max(0, offset - 32), offset);
  if (/\p{Lu}$/u.test(before)) return true;
  // „_" po literze lub cyfrze to łącznik identyfikatora („ZAM_123456789"), a ciąg podkreślników
  // po etykiecie — linia do wypełnienia w formularzu („Telefon: ____601 234 567" to telefon).
  // Wyjątek: człon przed „_" jest słowem telefonicznym („kontakt_tel_600111222") albo zwykłym
  // wyrazem w nazwie pliku, a numer ma prefiks komórkowy („dok_600111222.pdf",
  // „Wniosek_…_tel_600111222.pdf"). Kod wersalikami albo z cyfrą („ZAM_…", „x_123456789") dalej blokuje.
  const us = /([\p{L}\d]+)_+$/u.exec(before);
  if (us) {
    const d = full.slice(offset, offset + len).replace(/\D/g, '').replace(/^(?:00)?48(?=\d{9}$)/, '');
    const phoneWord = RE_PHONE_JOIN_WORD.test(us[1]);
    const fileWord = /^(?:\p{Ll}{2,}|\p{Lu}\p{Ll}+)$/u.test(us[1]) && RE_PL_MOBILE_PREFIX.test(d);
    if (!phoneWord && !fileWord && !(RE_PL_MOBILE_PREFIX.test(d) && fileNameChainBefore(before))) return true;
  }
  // Token z literą sklejony „/" lub „-" blokuje, gdy któryś jego człon ma cyfrę albo „_" albo jest
  // skrótem lub słowem małymi literami („FV/2026/", „ZAM-", „sklep/order/"). Imię, nazwisko
  // i słowo telefoniczne przed numerem osoby nie blokują („Anna Nowak/601 234 567",
  // „Kowalski-601234567", „Nowak-Kowalska-…", „SMS/601…", „Tel/607…") — tam numer wyciekałby
  // w całości, a to częsty zapis w pismach („córka Anna/603 456 789").
  const tok = /[\p{L}\d_/-]*[/-]$/u.exec(before)?.[0] ?? '';
  if (/\p{L}/u.test(tok) && !tok.split(/[/-]+/).filter(Boolean).every(isPersonalJoinPart)) return true;
  // Litera albo „_" zaraz po cyfrach („RR123456789PL", „SKU 123456789A"). Wyjątek: jednoliterowy
  // przyimek doklejony do numeru, który sam zaczyna token („512345678w godz. 8-16").
  const next = full.charAt(offset + len);
  if (!/[\p{L}_]/u.test(next)) return false;
  return !(/[wzoiu]/.test(next) && !/[\p{L}\d_]/u.test(full.charAt(offset + len + 1)) && !/[\p{L}\d]$/u.test(before));
}
function passPhone(ctx: RedactCtx): void {
  if (!ctx.on('TELEFON')) return;
  // (b) słowo kontekstowe + 9 cyfr (zachowujemy słowo, maskujemy numer), także wyliczenie.
  // Odrzucona kotwica oddaje resztę dopasowania do ponownego skanu: wyliczenie za numerem rekordu
  // („Kontakt nr 512 345 678, tel. 22 843 21 09") ma własną kotwicę, a dopasowanie zjadało ją razem
  // z numerem i drugi telefon wyciekał w całości.
  const anchored = (m: string, kw: string, sep: string, nums: string, offset: number, str: string): string => {
    if (rejectPhoneNrFiller(kw, sep, str, offset)) return `${kw}${sep}${nums.replace(RE_PHONE_ANCHORED, anchored)}`;
    const parts = nums.split(RE_PHONE_ENUM_SPLIT);
    if (!parts.every((p) => phoneDigitsValid(p.replace(/\D/g, '')))) return m;
    if (parts.some((p) => RE_PHONE_DATE_SHAPE.test(p))) return m;
    // Waluta za liczbą po „komórce/komórkę" i przymiotniku „telefoniczne" to kwota: komórka arkusza
    // („W komórce 123 456 789 zł", „na komórkę 600 700 800 zł"), pozycja zestawienia kosztów („Usługi
    // telefoniczne: 123 456 789 zł"). Po etykiecie („tel. 600 700 800 zł", „kom. … euro") zostaje
    // jak dotąd — tam stoi numer. Waluta przed następną liczbą („komórka: 603 456 789 zł 30,00" w bilingu)
    // należy do tej liczby, nie do numeru.
    if (/^komór/i.test(kw) || RE_PHONE_KW_WEAK.test(kw)) {
      const after = str.slice(offset + m.length, offset + m.length + 16);
      if ((RE_PHONE_AMOUNT_AFTER.test(after) || RE_PHONE_ZL_AFTER.test(after)) && !RE_CURRENCY_BEFORE_NUMBER.test(after)) return m;
    }
    // maskuj każdy 9-cyfrowy człon w miejscu — separatory listy i wypełniacze zostają.
    // Człon po wypełniaczu („, kom. 601…") zaczyna się od „. " — kropka należy do skrótu,
    // nie do numeru, więc zostaje przed maską (dawniej wychodziło „kom[TELEFON]").
    // Wiodące odstępy wchodzą do segmentu PRZED prefiksem: inaczej segment członu „lub 48 602 333
    // 444" startował od spacji, prefiks „48" nie mógł zadziałać, okno 9 cyfr obejmowało „48 602
    // 333 4" i dwie ostatnie cyfry numeru zostawały jawne. Odstępy i tak wracają w `lead`.
    // Nawias otwierający prefiks („(+48 512 345 678)") zostaje przed maską, gdy numer domyka go
    // dopiero za segmentem — jak w trybie (a); inaczej zostawał osierocony „)" za maską.
    const out = nums.replace(RE_PHONE_SEGMENT, (seg) => {
      ctx.bump('TELEFON');
      const lead = seg.match(/^[\s.]*/)?.[0] ?? '';
      const open = seg[lead.length] === '(' && (seg.match(/\(/g) ?? []).length > (seg.match(/\)/g) ?? []).length;
      return `${lead}${open ? '(' : ''}${ctx.M.TELEFON}`;
    });
    return `${kw}${sep}${out}`;
  };
  ctx.text = ctx.text.replace(RE_PHONE_ANCHORED, anchored);
  // (a) prefiks +48/0048 — maskujemy RAZEM z prefiksem, także z zerem „(0)" po nim („+48 (0)22 …"
  // dawniej zostawało jawne w całości, bo zero zajmowało miejsce pierwszej cyfry numeru). Nawias
  // otwierający przed prefiksem („(+48) 512 …", „(+48 22) 654 …") należy do numeru: dawniej
  // zostawał osierocony przed maską. Oddajemy go tylko wtedy, gdy numer domyka się sam
  // („dzwonić (+48 512 345 678)." → „([TELEFON])."). Strażnik przepisów liczony od „+"/„00",
  // nie od nawiasu, i pomijany przy „+": żaden numer artykułu, pozycji czy wersji nie zaczyna się
  // plusem, a „pod nr +48 22 501 23 45" wyciekało przez „nr ". „00" po „nr" zostaje pod strażnikiem
  // („Zamówienie nr 0048512345678").
  ctx.text = ctx.text.replace(
    /(?<![\d])(\([ \t]?)?((?:\+|00)[\s]?48(?:[ \t]?\(0\))?(?:[\s\-().]{0,3}\d){9})(?!\.?\d)/g,
    (m, open: string | undefined, num: string, offset: number) => {
      const o = open ?? '';
      if (!num.startsWith('+') && precededByLegalRef(ctx.text, offset + o.length)) return m;
      ctx.bump('TELEFON');
      const unbalanced = (num.match(/\)/g) ?? []).length > (num.match(/\(/g) ?? []).length;
      return (unbalanced ? '' : o) + ctx.M.TELEFON;
    },
  );
  // (c) fallback bez kontekstu — klasyczne 3-3-3, 9 cyfr ciągiem lub kierunkowy w nawiasie.
  // ŚWIADOMIE bez grupowania 2-3-2-2 bez kontekstu: „Pozycja 32 774 91 55 w wykazie" to numer
  // pozycji, nie telefon — kontekstowy fallback dałby FP (zasada: nadmaskowanie gorsze niż wyciek).
  // Stacjonarny 2-3-2-2 łapie tryb kotwicowy (b) — tam wymagana jest kotwica („tel.", „telefon
  // pacjenta:", „kontakt", „komórkę", „Phone:", „GSM", „dzwonić pod numer"; patrz PHONE_ANCHOR).
  // Separator grup to wyłącznie odstęp POZIOMY (bez tabulatora) albo myślnik: z „\s" kolumna
  // liczb „120\n340\n560" albo komórki TSV „120\t340\t560" sklejały się w jeden „telefon".
  // Strażniki kwot, identyfikatorów i etykiet nie-telefonu są w callbacku (patrz wyżej).
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:\(\d{2}\)[ \t]?\d{3}[ \t-]?\d{2}[ \t-]?\d{2}|\d{3}[    -]?\d{3}[    -]?\d{3})(?!\.?\d)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset) || precededByNonPhoneLabel(ctx.text, offset)) return m;
      const d = m.replace(/\D/g, '');
      // 800/801 to wyłącznie infolinie firm (bezpłatne i o współdzielonym koszcie): nie ma strefy
      // geograficznej 80 ani zakresu komórkowego zaczynającego się od 80, więc to nie numer osoby.
      if (d.startsWith('0') || /^80[01]/.test(d)) return m;
      if (gluedToIdentifier(ctx.text, offset, m.length) || looksLikeAmount(ctx.text, offset, m)) return m;
      ctx.bump('TELEFON');
      return ctx.M.TELEFON;
    },
  );
}

// 9) NR DOWODU osobistego — 3 litery + 6 cyfr. Trzy tryby (kontekst / dokładny format / mieszane).
function passIdCard(ctx: RedactCtx): void {
  if (!ctx.on('DOWOD')) return;
  // (a0) „dowodem osobistym serii ABA nr 300000" — seria i numer rozdzielone słowem „nr"/„numer"
  // albo przecinkiem (tak piszą akty notarialne i protokoły). Maska obejmuje całe „ABA nr 300000",
  // „serii" zostaje jak „seria i numer:". Osobny przebieg, bo w ogólnym (a) wstawka „nr" między
  // literami a cyframi zjadłaby słowa („dowód osobisty wydany pod nr 123456"). Kotwica tylko
  // dokumentu tożsamości z „seri…" tuż za nim („dowód rejestracyjny seria DRB nr …", „akcje serii
  // ABA nr …" odpadają), a seria WIELKIMI literami — flaga „i" jest dla kotwicy („DOWÓD OSOBISTY SERIA").
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|legitymacj\w*|dokument\w*\s+tożsamości)(?:\s+(?:osobist\w+|służbow\w+))?\s+seri[aiięą][ \t]+)([A-Za-z]{3}),?[ \t]*(?:(?:nr\.?|numer)[ \t]*)?(\d{6})(?!\d)/gi,
    (m, pre: string, series: string) => {
      if (!/^[A-Z]{3}$/.test(series)) return m;
      ctx.bump('DOWOD');
      return `${pre}${ctx.M.DOWOD}`;
    },
  );
  // (a) Z KONTEKSTEM — maskujemy nawet BEZ poprawnej sumy kontrolnej. Łączniki w odmianie
  // („serii", „o numerze", „numerem"): dawniej znany był tylko mianownik, a „dowodem osobistym
  // serii ABA 123456" ze złą sumą wyciekał mimo mocnej kotwicy.
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|dow\.|legitymacj\w*|dokument\w*\s+tożsamości|seria i numer|nr dowodu)(?:\s+(?:osobist\w+|służbow\w+|nr\.?|numer(?:ze|em|u)?|seri[aiięą]|o|i))*[\s:.=-]*)([A-Za-z]{3}[\s-]?\d{6})(?!\d)/gi,
    (_m, pre: string, _num: string) => {
      ctx.bump('DOWOD');
      return `${pre}${ctx.M.DOWOD}`;
    },
  );
  // (b) BEZ kontekstu — 3 WIELKIE litery + 6 cyfr, z poprawną sumą (kody walut wyłączone).
  ctx.text = ctx.text.replace(/\b([A-Z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
    if (CURRENCY_CODES.has(letters)) return m;
    if (!isValidDowod(m)) return m;
    ctx.bump('DOWOD');
    return ctx.M.DOWOD;
  });
  // (c) Litery mieszane/małe — tylko gdy suma kontrolna się zgadza. Kody walut wykluczone jak
  // w (b): „PLN 123456" przechodzi sumę (co dziesiąta kwota), a to kwota, nie numer dowodu.
  ctx.text = ctx.text.replace(/\b([A-Za-z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
    if (CURRENCY_CODES.has(letters.toUpperCase())) return m;
    if (isValidDowod(m)) {
      ctx.bump('DOWOD');
      return ctx.M.DOWOD;
    }
    return m;
  });
}

// 9b) NR PASZPORTU — 2 litery + 7 cyfr. TYLKO z kontekstem („paszport"/„dokument podróży").
function passPassport(ctx: RedactCtx): void {
  if (!ctx.on('PASZPORT')) return;
  // „paszportem serii EA nr 1234567" — jak (a0) w passIdCard: seria WIELKIMI literami, maska na
  // całe „EA nr 1234567".
  ctx.text = ctx.text.replace(
    /\b((?:paszport\w*|dokument\w*\s+podróży)\s+seri[aiięą][ \t]+)([A-Za-z]{2}),?[ \t]*(?:(?:nr\.?|numer)[ \t]*)?(\d{7})(?!\d)/gi,
    (m, pre: string, series: string) => {
      if (!/^[A-Z]{2}$/.test(series)) return m;
      ctx.bump('PASZPORT');
      return `${pre}${ctx.M.PASZPORT}`;
    },
  );
  ctx.text = ctx.text.replace(
    /\b((?:paszport\w*|dokument\w*\s+podróży|nr\s+paszportu|numer\s+paszportu)(?:\s+(?:nr\.?|numer(?:ze|em|u)?|seri[aiięą]|o|i))*)([\s:.=-]*)([A-Za-z]{2}[\s-]?\d{7})(?!\d)/gi,
    (_m, pre: string, sep: string) => {
      ctx.bump('PASZPORT');
      return `${pre}${sep}${ctx.M.PASZPORT}`;
    },
  );
}

// 9c) NUMER KRS — 10 cyfr. TYLKO z kontekstem „KRS" (brak publicznej sumy kontrolnej).
// Etykietę oddajemy w oryginalnym zapisie: regex jest bez względu na wielkość liter, a stały
// literał „KRS" przepisywał „krs:"/„Krs=" na wersaliki (zmiana tekstu poza maską).
function passKrs(ctx: RedactCtx): void {
  if (!ctx.on('KRS')) return;
  ctx.text = ctx.text.replace(
    /\b(KRS)((?:\s+(?:pod\s+)?(?:nr\.?|numer(?:em)?))?[\s:.=-]*)(\d{10})(?!\d)/gi,
    (_m, label: string, sep: string) => {
      ctx.bump('KRS');
      return `${label}${sep}${ctx.M.KRS}`;
    },
  );
}

// 9d) PRAWO JAZDY — TYLKO z kontekstem. Numer maskujemy W CAŁOŚCI (z separatorami „/"/„-").
function passDriverLicense(ctx: RedactCtx): void {
  if (!ctx.on('PRAWO-JAZDY')) return;
  ctx.text = ctx.text.replace(
    /\b((?:(?:nr|numer)\s+)?praw(?:o|a|em|ie)\s+jazdy(?:\s+(?:nr\.?|numer(?:u|ze|em)?|seri[ai]|kat\.?|kategori[ai]|o|[ABCDEMT]{1,2}\d?))*[\s:=.-]*)((?=[A-Za-z0-9/-]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3})/gi,
    (_m, pre: string) => {
      ctx.bump('PRAWO-JAZDY');
      return `${pre}${ctx.M['PRAWO-JAZDY']}`;
    },
  );
}

// 9e) NR REJESTRACYJNY (tablica) — z kontekstem oraz z kotwicą pojazdową i wyliczeniem.
// Kotwica POJAZDOWA — wyliczenia pojazdów bez słowa „rejestracyjny". Po słowie kotwicy nie może
// stać litera: „AutoCAD 2024" to program, nie „Auto" + tablica „CAD 2024". Kandydat nie może
// ciągnąć się dalej przez „-cyfra"/„/cyfra" (norma „EN 12195-1", akt „WE 1234/2009") — ale
// „-litera" wolno, inaczej zestaw „WGM1234A/WGM5678B" wyciekłby w całości.
// Po „marki <Marka>" do dwóch członów modelu w tej samej linii („samochodem marki Toyota Yaris
// WE 12345", „marki Audi A4 Avant …"): dawniej model przerywał kotwicę i tablica wyciekała. Człon
// modelu to wyraz z wielkiej litery z małą literą w środku albo token z cyfrą; same WERSALIKI bez
// cyfry („PN", „EURO", „ISO") nie są modelem, a ujemne lookahead nie pozwala zjeść samej tablicy.
// „typu" zostaje z jednym wyrazem — „pojazdy typu Euro VI PN 2020" to norma, nie tablica.
const PLATE_MODEL_PART = String.raw`[ \t]+(?![A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4}\b)(?:[A-ZĄĆĘŁŃÓŚŹŻ](?=[\w-]*[a-ząćęłńóśźż])[\w-]*|(?=[\w-]*\d)[A-Z0-9][\w-]*)`;
// Rdzeń kotwicy z polską końcówką („pojazdów", „samochodów", „przyczepą", „autem", „auta"):
// dawniej „\w*" (tylko ASCII) zatrzymywało się na „ó" albo „ą" i wyliczenie „Wykaz pojazdów: WE
// 12345, GD 2345A" zostawało jawne.
const RE_PLATE_VEHICLE = new RegExp(
  String.raw`\b([Pp]ojazd[a-ząćęłńóśźż]*|[Ss]amoch[oó]d[a-ząćęłńóśźż]*|[Mm]otocykl[a-ząćęłńóśźż]*|[Mm]otorower[a-ząćęłńóśźż]*|[Cc]iągnik[a-ząćęłńóśźż]*|[Pp]rzyczep[a-ząćęłńóśźż]*|[Nn]aczep[a-ząćęłńóśźż]*|[Aa]ut(?:o|a|em|u|om|ami|ach)|[Pp]arking\w*|[Zz]aparkowan\w*)(?![A-Za-ząćęłńóśźż])((?:\s+(?:o|nr\.?|numerze|siodłow\w+|ciężarow\w+|osobow\w+|dostawcz\w+|specjaln\w+|wolnobieżn\w+))*(?:\s+(?:marki\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?:${PLATE_MODEL_PART}){0,2}|typu\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*)(?=[\s:=.-]))?(?:\s+[a-ząćęłńóśźż]{1,15}){0,3}[\s:=.-]*)(${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4})\b(?![/-]\d)${PLATE_NOT_UNIT}`,
  'g',
);
const RE_PLATE_AFTER_MODEL = new RegExp(`(?:^|\\s)marki\\s+[A-ZĄĆĘŁŃÓŚŹŻ][\\w-]*${PLATE_MODEL_PART}`);
const PLATE_ITEM = `${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\\s-]?\\d[A-Z0-9]{3,4}`;
// Skan ogona wyliczenia startuje tylko na początku tokenu — nie w środku odrzuconego skrótu.
const RE_PLATE_ITEM_SCAN = new RegExp(`(?<![A-Z])${PLATE_ITEM}`, 'g');
const RE_PLATE_ACRONYM_HEAD = new RegExp(`^${PLATE_NOT_ACRONYM}`);
// Skrót z rokiem („PIT 2024", „OC 2024", „SN 2020") — kształt tablicy, ale w prozie to temat albo sygnatura.
const RE_PLATE_YEAR_SHAPE = /^[A-Z]{2,3}[\s-]?(?:19|20)\d{2}$/;
// Marki pojazdów o trzech literach, które z rocznikiem udają tablicę („KIA 2019", „DAF 2018").
const PLATE_VEHICLE_BRANDS = new Set<string>('KIA DAF SAM MAN BMW FSO FSM GAZ UAZ MAZ ZIL JCB FAW BYD DFM KTM SAF BPW'.split(' '));
// Kody typu pojazdu i nadwozia (straż pożarna, transport, rolnictwo) — z rocznikiem to opis floty.
const PLATE_VEHICLE_TYPE_CODES = new Set<string>('GBA GCB SLR SLB SUV TIR BUS VAN ATV UTV TPV MPV SCD GLM GLB SRT'.split(' '));
const RE_PLATE_GAP_PREP =/^(?:w|we|do|z|ze|od|na|dla|po|przez|przy|o|u|według|wg|wobec|między|pod|nad|za)$/;
// Trzyliterowe skróty, które z rokiem są tematem, polisą czy programem, a nie tablicą („/ PZU 2024",
// „; RPO 2021"). Inny powiat trzyliterowy z rokiem to zwykła tablica („nr rej. WPI 12345, WPI 2019").
const PLATE_YEAR_ABBR = new Set<string>(
  'PIT CIT VAT RPO WPF KPO ZUS KRS NIP PZU SKO PKD ISO LGD WSA NSA KIO UZP GUS NFZ BIP EFS PFR PUP WUP OSP ZHP PKP PKS'.split(' '),
);
/** Czy człon wyliczenia to skrót z rokiem, który kończy listę tablic? Dwie litery z czterema cyframi
 *  to w ogóle nie polska tablica („OC 2024", „SN 2020"); trzy — tylko skrót z PLATE_YEAR_ABBR. */
const plateYearEndsList = (p: string): boolean =>
  RE_PLATE_YEAR_SHAPE.test(p) && (/^[A-Z]{2}(?![A-Z])/.test(p) || PLATE_YEAR_ABBR.has(p.slice(0, 3)));
// Kod silnika lub wersji za marką z pojemnością w cm³ („Golf TDI 1896", „Clio DCI 1461", „Boxer HDI
// 2198", „Agrotron TTV 1130") — kształt powiatu z czterema cyframi, ale to opis pojazdu. Żaden
// z tych skrótów nie jest wyróżnikiem polskiej tablicy, poza GTC (Tczew), który za modelem i tak
// częściej jest wersją („Astra GTC").
const RE_PLATE_ENGINE_CODE =
  /^(?:TDI|TSI|FSI|TFS|TCE|TDS|TDE|CDI|CRD|DCI|DTI|DID|HDI|HTP|GTI|GTD|GTE|GTS|GTC|GTR|GDI|CGI|TGI|SDI|ECO|EDC|EVO|TTV|TCI|CVT|DSG|STI|LPG|CNG|ETS)[\s-]?\d{4}$/;
/** Krótkie wyrazy prozy w kształcie wyróżnika małymi literami („to", „do", „od 2025"). */
const RE_PLATE_SHORT_PL_WORD =
  /^(?:to|od|do|po|za|ze|we|na|co|ok|ta|te|ty|go|ja|mu|mi|ci|tu|np|tj|ma|są|by|aż|że|ani|lub|dla|nad|pod|bez|się|nie|tak|już|też|jak|ten|tym|tej|był|jej|ich|nam|was|pon|wt|śr|czw|pt|sob|nd|ndz)$/;
const RE_PLATE_VEHICLE_ADJ = /^(?:siodłow|ciężarow|osobow|dostawcz|specjaln|wolnobieżn)\p{Ll}*$/u;
const RE_PLATE_WEEKDAY =/^(?:pon|wt|śr|czw|pt|sob|nd|ndz)$/i;
// Rzeczownik pojazdu przed kotwicą „numer rejestracji" („Pojazd o numerze rejestracji …").
const RE_PLATE_VEHICLE_BEFORE = /(?<!\p{L})(?:pojazd|samoch[oó]d|aut[aoy]?(?!\p{L})|motocykl|ciągnik|naczep|przyczep)/iu;
function passPlate(ctx: RedactCtx): void {
  if (!ctx.on('NR-REJESTRACYJNY')) return;
  // Wypełniacze po kotwicy ograniczone do {0,3}: przy „*" ciąg „rejestracyjny rejestracyjny …"
  // był od każdego słowa pochłaniany do końca (czas kwadratowy, ~7 s na 100 tys. znaków).
  // Kotwica z kropką („nr. rej.", „nr.rej.", „NR. REJ.", „nr. rejestr.") tylko ze skrótem „rej"/
  // „rejestr"/„rejestracyjn…" — „nr. rejestru ABC 1234/2020" to numer rejestru, nie tablica. Tak
  // samo „numer" w odmianie („numerze rej.", „numerem rejestracyjnym", „numerach rej."): „lot
  // o numerze rejsu LO 3925", „pod numerem rejestrowym RIK 12345" czy „numerze rejonu" to nie tablica.
  // Odmienione „numer…" z „rejestracji" to dalej tablica („pod numerem rejestracji WX 12345"), ale
  // z ogonem „/rok" („zarejestrowano pod numerem rejestracji RPW 12345/2026") to rejestracja pisma
  // w kancelarii (EZD) — maska zostawiała osierocone „/2026" (strażnik w callbacku).
  // Wypełniacze także po kropce bez spacji („Nr rej.poj."), z rzeczownikiem pojazdu („nr rej.
  // naczepy", „numer rejestracyjny auta:"), łącznikiem („o numerze", „to", „pod") i rolą („numer
  // tablicy sprawcy:"): dawniej każdy z nich przerywał kotwicę. Separator przed wartością
  // dopuszcza „|" komórki tabeli, ale tylko w tej samej linii — przez „\n" kotwica z nagłówka
  // kolumny przeskakiwała do pierwszej komórki kolejnego wiersza („| Kod | Tablica |⏎|---|…").
  // Tablica z literą na początku numeru przy trzyliterowym powiecie („WPI KC27") osobną gałęzią:
  // lookahead cyfry w pierwszych 6 znakach jej nie widzi, a poszerzony łapał słowa („Tablica
  // nad WC12"). Tylko WIELKIMI literami, z literą województwa i po kotwicy z „rej".
  ctx.text = ctx.text.replace(
    /\b((?:nr\s+rej\w*|nr\.\s*rej(?:estracyjn\w*|estr)?\b|numer\s+rej\w*|numer\w+\s+rej(?:estracyjn\w*|estracj\w*|estr)?\b|rejestracyjn\w*|tablic\w*)(?:(?:\.\s*|\s+)(?:nr\.?|numer\w*|pojazdu|poj\.|sam\.|rej\w*|o|pod|to|sprawcy|kierowcy|właściciela|poszkodowanego|samoch[oó]d\w*|naczep\w*|przyczep\w*|ciągnik\w*|motocykl\w*|motorower\w*|aut[aoy]?\b|autobus\w*|autokar\w*|bus[aeuy]?\b|ci[eę][zż]ar[oó]w\w*|osobow\w*|dostawcz\w*|siodłow\w*)){0,3}(?:[ \t:=.-]*\|[ \t]*|[\s:=.-]*))((?=[A-Z0-9\s-]{0,5}\d)[A-Z]{2,3}[\s-]?[A-Z0-9]{4,5}|[A-Z]{3}[\s-][A-Z]{2}\d{2})\b/gi,
    (m, pre: string, plate: string, offset: number, str: string) => {
      // Tylko wyróżnik z samymi cyframi wygląda na znak kancelaryjny („RPW 12345/2026"); tablica
      // z literą w części numerycznej („KR 5A123/2022") to dalej tablica.
      // Pojazd tuż przed kotwicą („Pojazd o numerze rejestracji KR 12345/2022") rozstrzyga za tablicą.
      if (
        /rejestracj/i.test(pre) &&
        /^[A-Z]{2,3}[\s-]?\d{4,5}$/i.test(plate) &&
        /^[ \t]*\/[ \t]*\d/.test(str.slice(offset + m.length, offset + m.length + 4)) &&
        !RE_PLATE_VEHICLE_BEFORE.test(str.slice(Math.max(0, offset - 30), offset) + pre)
      )
        return m;
      // Flaga /i jest potrzebna kotwicy („NR REJ.", „Tablica"), ale obejmuje też wyróżnik: słowo
      // prozy („od 2025", „dla 2000 pojazdów", „to 1500 zł") stawało się tablicą — to jednak
      // zdarza się tylko po słabych kotwicach „tablic…" i „rejestracyjn…". Tam wyróżnik małymi
      // literami przyjmujemy tylko w zapisie sklejonym („tablica wa12345"); po „nr rej." /
      // „numer rejestracyjny" stoi wartość pola, więc „nr rej. wa 12345" to tablica. „nr"/„NR"
      // nigdy nie jest wyróżnikiem („Tablica nr 12345 wisi przy wejściu").
      const strong = /^(?:nr\.?\s*|numer\p{L}*\s+)rej(?:estracyjn\p{L}*|estr)?(?!\p{L})/iu.test(pre);
      // Wyjątek: po „rejestracyjn…" zapis małymi literami ze spacją, gdy wyróżnik ma literę
      // województwa i nie jest krótkim wyrazem prozy („tablice rejestracyjne wa 12345" — tablica;
      // „tablice rejestracyjne to 12345 sztuk", „… do 2025" — proza).
      // Także zapis od wielkiej litery („Wa 12345"). Skrót dnia tygodnia („pt", „sob") przed pięcioma
      // cyframi nie występuje, a „PT" to wyróżnik Turku.
      const lowerSpacedOk =
        /rejestracyjn/i.test(pre) &&
        /^[A-Za-z][a-z]{1,2}[\s-]\d{4,5}$/.test(plate) &&
        PLATE_VOIV_LETTERS.includes(plate[0].toUpperCase()) &&
        // Krótki wyraz prozy od wielkiej litery przed pięcioma cyframi („Po 12345" — wyróżnik Poznania)
        // to też tablica: przyimek w środku zdania pisze się małą literą, a rok ma cztery cyfry.
        !(
          RE_PLATE_SHORT_PL_WORD.test(plate.split(/[\s-]/)[0].toLowerCase()) &&
          !((RE_PLATE_WEEKDAY.test(plate.split(/[\s-]/)[0]) || /^[A-Z]/.test(plate)) && /\d{5}$/.test(plate))
        );
      if (/^nr\b/i.test(plate) || (!strong && !lowerSpacedOk && !/^[A-Z]{2,3}(?![a-z])/.test(plate) && /[\s-]/.test(plate)))
        return m;
      // Sama „tablica" bez „rej…" bywa też ostrzegawcza czy informacyjna („Na tablicy UN 1203")
      // — tam skrót techniczny nie jest wyróżnikiem. Przy „nr rej." kotwica wygrywa.
      if (!/rej/i.test(pre) && !RE_PLATE_ACRONYM_HEAD.test(plate)) return m;
      // Układ „WPI KC27" (patrz wyżej): WIELKIE litery, litera województwa, kotwica z „rej".
      if (/^[A-Za-z]{3}[\s-][A-Za-z]{2}\d{2}$/.test(plate) && !(/^[A-Z]{3}[\s-][A-Z]{2}\d{2}$/.test(plate) && PLATE_VOIV_LETTERS.includes(plate[0]) && /rej/i.test(pre))) return m;
      // Łącznik „o/to/pod" po samej „tablicy" („Tablica o numerze INW 12345 jest w magazynie",
      // „Tablice to …") jest słabszy niż etykieta pola — wyróżnik musi wyglądać na tablicę. Skrót
      // z rokiem („Ogłoszenie na tablicy o PIT 2024", „na tablicy pod RPO 2021", „o SKO 2023/2024")
      // to w pismach urzędowych temat ogłoszenia, nie tablica.
      if (!/rej/i.test(pre) && /(?<!\p{L})(?:o|to|pod)(?!\p{L})/iu.test(pre) && (!(/^[A-Z]{2,3}(?![a-z])/.test(plate) && PLATE_VOIV_LETTERS.includes(plate[0])) || RE_PLATE_YEAR_SHAPE.test(plate))) return m;
      ctx.bump('NR-REJESTRACYJNY');
      return `${pre}${ctx.M['NR-REJESTRACYJNY']}`;
    },
  );
  ctx.text = ctx.text.replace(RE_PLATE_VEHICLE, (m, kw: string, sep: string, plate: string, offset: number, str: string) => {
    if (!PLATE_VOIV_LETTERS.includes(plate[0])) return m;
    // Za modelem skrót wersji z czterema cyframi to dalszy opis pojazdu, nie tablica: rok („marki
    // Opel Astra GTC 2015 rocznik") albo pojemność silnika w pełnych setkach („Skoda Octavia TSI
    // 1400", „Honda Fireblade CBR 1100 XX"). Dwie litery z czterema cyframi to w ogóle nie polska
    // tablica („Suzuki V-Strom DL 1000"); trzyliterowy powiat z innymi czterema cyframi („Ford
    // Transit WPI 1234") zostaje tablicą. Tylko gdy człon modelu rzeczywiście wystąpił (sama marka
    // jak dotąd). Kod silnika z dowolną pojemnością („Golf TDI 1896 cm3", „Clio DCI 1461") odpada
    // już po samej „marki" — patrz RE_PLATE_ENGINE_CODE.
    if (/^(?:[A-Z]{2}[\s-]?\d{4}|[A-Z]{3}[\s-]?(?:\d{2}00|(?:19|20)\d{2}))$/.test(plate) && RE_PLATE_AFTER_MODEL.test(sep)) return m;
    if (RE_PLATE_ENGINE_CODE.test(plate) && /(?:^|\s)marki\s/.test(sep)) return m;
    // Dwie litery z rokiem po samej kotwicy pojazdowej („dla pojazdów PN 2020", „samochody EN 2018")
    // to norma albo rocznik — polska tablica z dwuliterowym wyróżnikiem ma pięć znaków za nim.
    // Ale kotwica w liczbie pojedynczej bez takiego kontekstu („Sprawca uciekł samochodem WA 2015",
    // „motocyklem KR 1999") wskazuje konkretny pojazd — to tablica, jak w v0.46.22.
    if (
      /^[A-Z]{2}[\s-]?(?:19|20)\d{2}$/.test(plate) &&
      (/(?:ów|y|ami|ach|om)$/.test(kw) ||
        /(?<!\p{L})(?:dla|według|wg)(?!\p{L})/iu.test(sep) ||
        /^[ \t]*(?:r\.|rok|roku)/.test(str.slice(offset + m.length, offset + m.length + 7)) ||
        /^(?:PN|EN|UE|EU|OC|AC|NW|ISO|IS)/.test(plate) ||
        // akt prawny z rokiem („dyrektywa dotycząca pojazdu WE 2007")
        /(?<!\p{L})(?:dyrektyw|rozporządze|norm|homologacj)\p{L}*/iu.test(str.slice(Math.max(0, offset - 40), offset) + kw))
    )
      return m;
    // Kod waluty albo jednostki z kwotą („Wartość samochodów wynosi PLN 45000", „Leasing pojazdów:
    // CHF 12000", „Liczba pojazdów: SZT 1200") to kwota, nie tablica.
    if (/^(?:PLN|EUR|USD|CHF|GBP|CZK|SEK|NOK|DKK|JPY|UAH|SZT|KPL|KOM)(?![A-Z])/.test(plate)) return m;
    // Trzy litery z rokiem to marka z rocznikiem („dostawę samochodów KIA 2019", „Liczba pojazdów:
    // DAF 2018", „przyczepą SAM 2012"), a po kotwicy w dopełniaczu mnogim bez dwukropka to proza
    // przetargu czy sprawozdania („pojazdów marki MAN TGL 2012"). Wykaz z dwukropkiem („Wykaz
    // pojazdów: WPI 2019, WE 12345") i liczba pojedyncza („autem WPI 2019") zostają tablicą.
    if (RE_PLATE_YEAR_SHAPE.test(plate) && /^[A-Z]{3}/.test(plate)) {
      if (PLATE_VEHICLE_BRANDS.has(plate.slice(0, 3))) return m;
      // Skrót instytucji, kod silnika, paliwa albo typu pojazdu z rocznikiem („Autem PKP 2024",
      // „autem LPG 2010", „Autem TIR 2015", „Wykaz pojazdów: GBA 2010" w sprawozdaniu OSP) i liczba
      // z „r." tuż za nią („Zakup pojazdów: GBA 2023 r.") to rok, nie tablica.
      if (PLATE_YEAR_ABBR.has(plate.slice(0, 3)) || RE_PLATE_ENGINE_CODE.test(plate) || PLATE_VEHICLE_TYPE_CODES.has(plate.slice(0, 3))) return m;
      if (/^[ \t]*(?:r\.|rok)/.test(str.slice(offset + m.length, offset + m.length + 6))) return m;
      if (/(?:ów|^[Aa]ut|[Pp]rzyczep|[Nn]aczep)$/.test(kw) && !sep.includes(':')) return m;
    }
    // Wtrącenie między kotwicą a kandydatem: zakończone przyimkiem („Liczba pojazdów według GUS
    // 2023", „samochodów w KRS 1234", „Autem do PZU 2020") wskazuje źródło albo instytucję, a skrót
    // z rokiem po kilku wyrazach („z silnikiem TDI 2000") to opis, nie tablica.
    const gap = /(?:^|\s)([a-ząćęłńóśźż]{1,15})[\s:=.-]*$/.exec(sep)?.[1];
    if (gap && RE_PLATE_GAP_PREP.test(gap)) return m;
    // Przymiotnik typu pojazdu z samej kotwicy („samochód osobowy WPI 2019", „samochodem ciężarowym
    // KRA 2015") to nie wtrącenie — pojazd jest dalej konkretny, jak bez przymiotnika.
    if (gap && RE_PLATE_YEAR_SHAPE.test(plate) && !RE_PLATE_VEHICLE_ADJ.test(gap)) return m;
    ctx.bump('NR-REJESTRACYJNY');
    return `${kw}${sep}${ctx.M['NR-REJESTRACYJNY']}`;
  });
  // WYLICZENIE po zamaskowanej tablicy — kolejne człony listy dziedziczą kotwicę pierwszego.
  // Człon z jednostką („, DMC 18000 kg") albo skrótem technicznym kończy wyliczenie, tak samo
  // numer aktu z ukośnikiem („, UE 2016/679" — rozporządzenie, nie tablica; maska zostawiała „/679").
  // Średnik i ukośnik („WE 12345 / WE 54321", „ciągnik/naczepa: WGM1234A/WGM5678B") tylko z odstępami
  // poziomymi: przez nową linię lista sięgała do kolejnego akapitu („…WE 12345;⏎SN 2020 r. orzekł").
  // Skrót z rokiem kończy wyliczenie („; OC 2024 ważne", „/ PZU 2024", „; SN 2020 r. orzekł") — to
  // kolejne pole kartoteki albo sygnatura, a nie druga tablica; dalszych członów też nie bierzemy.
  // Trzyliterowy powiat z rokiem jest jednak zwykłą tablicą („, WPI 2019") — patrz plateYearEndsList.
  {
    const REJ = escapeRe(ctx.M['NR-REJESTRACYJNY']);
    ctx.text = ctx.text.replace(
      new RegExp(`(${REJ})((?:(?:\\s*,\\s*|[ \\t]*[;/][ \\t]*|\\s+oraz\\s+|\\s+i\\s+)${PLATE_ITEM}(?![\\w-]|/\\d)${PLATE_NOT_UNIT})+)`, 'g'),
      (_m, first: string, tail: string) => {
        let ended = false;
        const maskedTail = tail.replace(RE_PLATE_ITEM_SCAN, (p) => {
          if (ended || plateYearEndsList(p)) {
            ended = true;
            return p;
          }
          if (!PLATE_VOIV_LETTERS.includes(p[0])) return p;
          ctx.bump('NR-REJESTRACYJNY');
          return ctx.M['NR-REJESTRACYJNY'];
        });
        return `${first}${maskedTail}`;
      },
    );
  }
}

// 10) KOD POCZTOWY — XX-XXX, nie po „art./§" i nie przed walutą/jednostką: „10-200 PLN",
// „20-150 km", „30-500 osób" to zakres liczb, a za kodem pocztowym stoi nazwa miejscowości
// (wielką literą). Celowo bez samego „m" — „00-950 m. st. Warszawa" to kod przed nazwą miasta.
const RE_POSTAL = /(?<![\d-])\d{2}-\d{3}(?![\d-])(?![ \t]*(?:zł|zl|PLN|EUR|USD|GBP|CHF|gr|tys|mln|%|km|kg|min|godz|szt|sztuk|osób|osoby|dni|lat)(?![\p{L}]))/gu;
function passPostal(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  ctx.text = ctx.text.replace(RE_POSTAL, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    ctx.bump('KOD-POCZTOWY');
    return ctx.M['KOD-POCZTOWY'];
  });
}

// ═══════════════════ FAZA 3 · DATA I ADRES / MIEJSCOWOŚĆ ═══════════════════
// Adres i miejscowość kotwiczą na już zamaskowanym [KOD-POCZTOWY]/[ADRES] z wcześniejszych
// przebiegów — dlatego passPostalNoHyphen i passCity biegną tu, a nie w FAZIE 2.
// 11) DATA URODZENIA — tylko z jawnym kontekstem (ur./urodzony/data urodzenia) + data.
const BIRTH_DATE_SRC = String.raw`\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:[IVX]{1,4}|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}`;
// Etykieta z dopełnieniem („Data urodzenia pacjenta:", „Data ur. pierwszego dziecka:", też
// z podpowiedzią formatu w nawiasie przed dwukropkiem) — 1–2 wyrazy z końcówką dopełniacza
// i OBOWIĄZKOWY dwukropek: „Data urodzenia pacjenta w systemie uzupełniono 14.03.2024" to proza.
const BIRTH_LABEL_PAREN = String.raw`\([^()\n]{1,40}\)`;
const RE_BIRTH_LABELED = new RegExp(
  String.raw`\b(data\s+(?:urodzenia|urodz\.|ur\.)(?:[ \t]+[a-ząćęłńóśźż]{2,}(?:a|y|i|ego|ej)){1,2}(?=[ \t]*(?:${BIRTH_LABEL_PAREN}[ \t]*)?:)` +
    // Formy zależne imiesłowu („urodzonej", „urodzonego", „urodzoną") — w pismach sądowych osoba
    // stoi w dopełniaczu albo celowniku. Liczby mnogiej celowo brak: „dla dzieci urodzonych
    // 1 stycznia 2016 r." to przepis, nie dane osoby („urodzonym" w celowniku liczby mnogiej
    // i próg „… lub później" odsiewa passBirthDate). „w dniu" jak „dnia".
    // Forma osobowa czasownika („urodziłam się 12.05.1990", „urodził się dnia 3 maja 1985 r.") —
    // życiorys, oświadczenie, wywiad lekarski. Bez czasu przyszłego („Dziecko urodzi się około
    // 12.05.2026" to termin porodu) i bez przyimka przed datą („urodziły się po 1 stycznia 2016").
    String.raw`|urodzi(?:ł(?:a|am|em|aś|eś|o|y|i)?|liśmy|łyśmy|liście|łyście)[ \t]+się` +
    String.raw`|ur\.|urodz\.|urodzon(?:ego|emu|ej|ym|y|a|ą)|urodzeni[ae]|data\s+(?:urodzenia|urodz\.|ur\.))` +
    String.raw`((?:[ \t]*${BIRTH_LABEL_PAREN})?(?:\s+(?:dnia|w\s+dniu))?[\s:.,-]*)(${BIRTH_DATE_SRC})`,
  'gi',
);
// „Data i miejsce urodzenia" / „Miejsce i data urodzenia" z miejscowością PRZED datą („…: Kielce,
// 12.04.1985") — w zwykłej kolejności datę bierze RE_BIRTH_LABELED, ale tu dawniej zostawała jawna.
// Miejscowość maskuje 12g2 w passCity (tylko słownik).
const BIRTH_COMBO = String.raw`(?:[Dd]ata[ \t]+i[ \t]+[Mm]iejsce|[Mm]iejsce[ \t]+i[ \t]+[Dd]ata)[ \t]+(?:urodzenia|ur\.)`;
const RE_BIRTH_COMBO_CITY_FIRST = new RegExp(
  String.raw`\b(${BIRTH_COMBO}[ \t]*:?\s*(?:${CAP_CITY}[ \t]+){0,2}${CAP_CITY}[ \t]*,?[ \t]*)()(${BIRTH_DATE_SRC})`,
  'g',
);
// „ur 14.02.1993" bez kropki (czat, notatka) — tylko z data tuż za nim i bez wersalików: „Senat UR
// 14.02.1993" to uczelnia.
const RE_BIRTH_UR_NODOT = new RegExp(String.raw`\b([Uu]r)([ \t]+)(${BIRTH_DATE_SRC})`, 'g');
// Próg w przepisie albo uchwale, nie data osoby: „Kobiecie urodzonej 1 stycznia 1953 r. lub
// później", „dziecka urodzonego w dniu 1 stycznia 2027 r. lub później", „osobie urodzonej 31 grudnia
// 1961 r. lub wcześniej" (becikowe, Karta Seniora, emerytura). Po maskowaniu przepis tracił sens.
// Alternatywa („lub/albo/bądź") zawsze; „i później/wcześniej" tylko na końcu zdania albo przed
// orzeczeniem przepisu („Matce urodzonej 1 stycznia 2004 r. i później przysługuje dodatek", „dziecka
// urodzonego … r. i później stosuje się § 2"): „urodzona 12.03.1953 r. i później zamieszkała
// w Krakowie" czy „… i później zatrudniony" to życiorys osoby.
const RE_BIRTH_THRESHOLD_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:lub|albo|bądź)[ \t]+(?:później|wcześniej)(?!\p{L})/iu;
// Gałąź „i później/wcześniej" tylko w kształcie przepisu: przy formie zależnej („Matce urodzonej …",
// „dziecka urodzonego …", „osobom urodzonym …") i z orzeczeniem w czasie teraźniejszym. Mianownik
// („Jan Kowalski urodzony 14.03.1958 r. i później podlegał ubezpieczeniu", „Anna Nowak, urodzona …
// i wcześniej ma ustalone prawo do renty") i „ur." to życiorys konkretnej osoby, a czas przeszły
// („podlegał", „należał") — zawsze życiorys.
const RE_BIRTH_THRESHOLD_AND_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*i[ \t]+(?:później|wcześniej)(?:[ \t]*(?:[.,;:)!?\n]|$)|[ \t]+(?:przysługuj|stosuj|obowiązuj|należ|nabyw|otrzymuj|podlega|wypłac|przyzna|dotycz|ma[ \t]|mają[ \t])(?!\p{L}*ł))/iu;
// Alternatywa w życiorysie: mianownik i czas przeszły za progiem („Jan Kowalski urodzony 14.03.1958 r.
// lub później podlegał …") to konkretna osoba, jak przy „i później" — przepis ma czas teraźniejszy.
const RE_BIRTH_THRESHOLD_PAST =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:lub|albo|bądź)[ \t]+(?:później|wcześniej)[ \t]+(?:się[ \t]+)?\p{Ll}{2,}(?:ł[aoy]?|li)(?!\p{L})/iu;
const RE_BIRTH_KW_OBLIQUE = /^urodzon(?:ej|ego|ym|emu|ych)(?!\p{L})/iu;
// „urodzonym" to też celownik liczby mnogiej („osobom urodzonym …", „dzieciom urodzonym …") — po
// rzeczowniku na „-om" to przepis, a narzędnik („z Janem Kowalskim urodzonym …") zostaje.
const RE_BIRTH_PLURAL_DATIVE_BEFORE = /\p{L}om[ \t]+$/u;
// …tak samo po rzeczownikowym przymiotniku na „-ym" („Emerytura przysługuje ubezpieczonym urodzonym
// 1 stycznia 1949 r.", „uprawnionym urodzonym …"). Po przyimku to narzędnik albo miejscownik liczby
// pojedynczej, czyli osoba: „umowa z ubezpieczonym urodzonym 3 maja 1980 r.", „opiekun nad
// ubezwłasnowolnionym urodzonym 12.03.1950 r.", „orzeczenie o ubezpieczonym urodzonym …" (liczba
// mnoga miałaby „-ymi"/„-ych").
const RE_BIRTH_ADJ_DATIVE_BEFORE = /(?:^|[^\p{L}])(?:(\p{L}+)[ \t]+)?\p{Ll}{3,}(?:on|an|n|t)ym[ \t]+$/u;
const RE_BIRTH_SINGULAR_BEFORE_ADJ =
  /^(?:z|ze|nad|pod|przed|za|o|po|przy|w|we|na|wobec|się|jako|jest|był|była|został|została|będącego|będącej|będącym|będący|będąca|\p{L}{2,}i?em)$/iu;
function birthPluralDativeBefore(before: string): boolean {
  if (RE_BIRTH_PLURAL_DATIVE_BEFORE.test(before)) return true;
  const m = RE_BIRTH_ADJ_DATIVE_BEFORE.exec(before);
  if (!m) return false;
  // Narzędnik liczby pojedynczej bez przyimka: po rzeczowniku w narzędniku („bratem niepełnosprawnym
  // urodzonym …"), po „się" („opiekuje się poszkodowanym …"), po „będącego/jest/jako" i w dopowiedzeniu
  // po przecinku („z Janem Nowakiem, ubezpieczonym urodzonym …").
  if (m[1] === undefined) return !/,[ \t]*\p{Ll}+[ \t]+$/u.test(before);
  if (RE_BIRTH_SINGULAR_BEFORE_ADJ.test(m[1])) return false;
  // Rzeczownik między przyimkiem liczby pojedynczej a przymiotnikiem („o pracowniku zatrudnionym
  // urodzonym …", „o pacjencie hospitalizowanym …", „nad synem Kubą przysposobionym …") — to osoba.
  // Sama końcówka rzeczownika nie rozstrzyga („przysługuje ubezpieczonym urodzonym" to przepis),
  // więc liczy się wyraz przed nim, a liczba mnoga („o pracownikach …", „nad dziećmi …") odpada.
  const pre = /(?:^|[^\p{L}])(\p{L}+)[ \t]+$/u.exec(before.slice(0, m.index + m[0].indexOf(m[1])))?.[1];
  if (pre && RE_BIRTH_SINGULAR_BEFORE_ADJ.test(pre) && !/(?:om|ami|ach|mi)$/u.test(m[1])) return false;
  return true;
}
// Czasownik „urodził(a) się" jest kotwicą tylko wtedy, gdy mówi o osobie. W prozie urzędowej
// i prasowej rodzi się też pomysł, projekt, festiwal albo cielę, a forma nijaka i mnoga („najwięcej
// dzieci urodziło się w Krakowie") to statystyka. Pierwsza i druga osoba („urodziłam się") zawsze;
// trzecia pojedyncza, gdy podmiotem nie jest rzecz, zwierzę ani patron. Podmiotu osobowego nie
// wymagamy: przed FAZĄ 4 nazwisko stoi jeszcze jawne („Kowalski urodził się", „Nowakowa", „Wnuczka").
// Forma nijaka tylko o dziecku, mnoga tylko o bliźniętach.
const RE_BIRTH_VERB_SELF = /^urodzi(?:łam|łem|łaś|łeś|liśmy|łyśmy|liście|łyście)[ \t]/i;
const RE_BIRTH_VERB_3SG = /^urodzi(?:ł|ła)[ \t]/i;
const RE_BIRTH_VERB_NEUTER = /^urodziło[ \t]/i;
const RE_BIRTH_VERB_PLURAL = /^urodzi(?:li|ły)[ \t]/i;
const RE_BIRTH_SUBJECT_THING =
  /(?<!\p{L})(?:pomysł|projekt|idea|koncepcja|myśl|plan|inicjatywa|przedsięwzięcie|festiwal|ruch|zespół|firma|marka|akcja|tradycja|zwyczaj|impreza|wydarzenie|program|konkurs|stowarzyszenie|fundacja|spółka|teatr|kabaret|cielę|źrebię|źrebak|szczenię|szczeniak|kocię|jagnię|prosię|koźlę|zwierzę|pies|kot|klacz|jałówka|młode|najwięcej|najmniej|łącznie|ogółem|dzieci|noworodków|osób)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_CHILD = /\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\]|(?<!\p{L})(?:dziecko|dziecię|niemowlę|małoletnie|wnuczę|bliźnię)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_TWINS = /(?<!\p{L})(?:bliźnięta|bliźniaki|bliźniaczki|bliźniacy|trojaczki)(?!\p{L})/iu;
function birthVerbAboutPerson(kw: string, before: string): boolean {
  if (!/^urodzi/i.test(kw)) return true;
  if (RE_BIRTH_VERB_SELF.test(kw)) return true;
  const seg0 = before.slice(-120);
  const seg = seg0.slice(Math.max(seg0.lastIndexOf('.'), seg0.lastIndexOf('!'), seg0.lastIndexOf('?'), seg0.lastIndexOf('\n')) + 1);
  // biogram patrona szkoły czy ulicy w uzasadnieniu uchwały to nie dane strony; władca albo papież
  // z liczbą porządkową („Jan Paweł II urodził się …") też — silnik i tak zostawia jego imię jawne
  if (RE_BIRTH_SUBJECT_PUBLIC.test(seg) || RE_BIRTH_SUBJECT_REGNAL.test(seg)) return false;
  // Biogram patrona zapowiedziany w poprzednim zdaniu tego samego akapitu („Patronka szkoły.
  // Irena Sendlerowa urodziła się 15 lutego 1910 r. w Warszawie."). Etykieta pola („Patron: Jan
  // Kowalski") się nie liczy.
  const para = before.slice(before.lastIndexOf('\n\n') + 1);
  if (RE_BIRTH_PATRON_PARA.test(para)) return false;
  // Pouczenie i przykład obliczeniowy („Jeżeli dziecko urodziło się 1 czerwca 2026 r., …",
  // „Przykład: ubezpieczony urodził się 1 lipca 1958 r.") mówią o osobie hipotetycznej, a reguła
  // właściwości („Osoba, która urodziła się w Kielcach, …") — o każdym. Maska psuła treść pouczenia.
  if (RE_BIRTH_HYPOTHETICAL.test(seg) || RE_BIRTH_GENERIC_SUBJECT.test(seg)) return false;
  if (RE_BIRTH_VERB_NEUTER.test(kw)) return RE_BIRTH_SUBJECT_CHILD.test(seg) && !RE_BIRTH_SUBJECT_THING.test(seg);
  if (RE_BIRTH_VERB_PLURAL.test(kw)) return RE_BIRTH_SUBJECT_TWINS.test(seg);
  if (!RE_BIRTH_VERB_3SG.test(kw)) return false;
  // rzecz albo zwierzę tuż przed czasownikiem („Pomysł urodził się …", „Festiwal urodził się …")
  const near = seg.split(/[ \t]+/).filter(Boolean).slice(-3).join(' ');
  // rzeczownik abstrakcyjny na „-ość" tuż przed czasownikiem to organizacja albo idea, nie osoba
  // („Solidarność urodziła się 31 sierpnia 1980 r. w Gdańsku", „NSZZ Solidarność urodził się …")
  if (/\p{L}{2,}ość[ \t]*$/iu.test(seg)) return false;
  return !RE_BIRTH_SUBJECT_THING.test(near);
}
const RE_BIRTH_PATRON_PARA = /(?<!\p{L})(?:patron\p{L}*(?![ \t]*:)|nadani\p{L}*[ \t]+imienia)(?!\p{L})/iu;
/** Rok sprzed 1900 jako osobny wyraz („w 1867 r.", „19 lutego 1473"). */
const RE_PRE1900_YEAR = /(?<![\d.\/-])1[0-8]\d\d(?![\d.\/-]\d)/;
/** Zdanie wokół zakresu [start, end): od poprzedniej kropki, „!", „?" albo nowej linii do następnej. */
function sentenceAround(t: string, start: number, end: number): string {
  const lo = Math.max(0, start - 200);
  const head = t.slice(lo, start);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('!'), head.lastIndexOf('?'), head.lastIndexOf('\n'));
  const tail = t.slice(end, end + 200);
  const stop = tail.search(/[.!?](?:[ \t]+\p{Lu}|[ \t]*$|[ \t]*\n)|\n/u);
  return head.slice(cut + 1) + t.slice(start, end) + (stop < 0 ? tail : tail.slice(0, stop));
}
const RE_BIRTH_SUBJECT_REGNAL =/\p{Lu}\p{Ll}+[ \t]+(?:II|III|IV|VI|VII|VIII|IX|XI|XII|XIII|XIV|XV|XVI)(?![\p{L}\p{N}])/u;
const RE_BIRTH_HYPOTHETICAL =
  /(?<!\p{L})(?:jeżeli|jeśli|gdyby|o[ \t]+ile|w[ \t]+przypadku,?[ \t]+gdy|przykład\p{L}*|np\.|załóżmy|przyjmijmy)(?!\p{L})/iu;
// Podmiot ogólny tuż przed czasownikiem: „Osoba, która urodziła się …", „Każdy, kto urodził się …".
// Także rzeczownik ogólny z „, który" w regule („Uczeń, który urodził się 1 września 2019 r., zostaje
// przyjęty", „Senior, który urodził się …") i samo „kto/ktokolwiek/nikt" w pouczeniu („kto urodził się
// w Opolu, składa wniosek …"). Bez ról z decyzji („Wnioskodawca, który urodził się …" to strona).
const RE_BIRTH_GENERIC_SUBJECT =
  /(?:^|[^\p{L}])(?:(?:osoba|każdy|każda|ten|ta)[ \t]*,?[ \t]*(?:któr[ay]|kto)|(?:uczeń|uczennica|senior|seniorka|mieszkaniec|mieszkanka|kandydat|kandydatka)[ \t]*,[ \t]*któr[ay]|kto|ktokolwiek|nikt)[ \t]*(?:nie[ \t]+)?$/iu;
const RE_BIRTH_SUBJECT_PUBLIC =
  /(?<!\p{L})(?:patron\p{L}*|święt(?:y|a|ego|ej)|św\.|bł\.|błogosławion\p{L}*|papież\p{L}*|kardynał\p{L}*|prymas\p{L}*|znan[ya]|słynn[ya]|wybitn[ya]|sławn[ya]|król|króla|królowa|królowej|poeta|poetka|poety|pisarz|pisarka|pisarza|kompozytor|kompozytora)(?!\p{L})/iu;
function passBirthDate(ctx: RedactCtx): void {
  if (!ctx.on('DATA-UR')) return;
  ctx.text = ctx.text.replace(RE_BIRTH_LABELED, (m, kw: string, sep: string, d: string, offset: number, str: string) => {
    const after = str.slice(offset + m.length, offset + m.length + 60);
    if (RE_BIRTH_THRESHOLD_AFTER.test(after) && !(!RE_BIRTH_KW_OBLIQUE.test(kw.trim()) && RE_BIRTH_THRESHOLD_PAST.test(after))) return m;
    if (RE_BIRTH_KW_OBLIQUE.test(kw.trim()) && RE_BIRTH_THRESHOLD_AND_AFTER.test(after)) return m;
    if (/^urodzi/i.test(kw)) {
      if (!birthVerbAboutPerson(kw, str.slice(Math.max(0, offset - 320), offset))) return m;
      // biogram patrona w uchwale („Mikołaj Kopernik urodził się 19 lutego 1473 r.") to nie dane osoby
      const year = /(\d{4})$/.exec(d)?.[1];
      if (year && +year < 1900) return m;
    }
    if (/^urodzonym$/i.test(kw) && birthPluralDativeBefore(str.slice(Math.max(0, offset - 50), offset))) return m;
    ctx.bump('DATA-UR');
    return `${kw}${sep}${ctx.M['DATA-UR']}`;
  });
  maskAfterLabel(ctx, RE_BIRTH_COMBO_CITY_FIRST, 'DATA-UR');
  maskAfterLabel(ctx, RE_BIRTH_UR_NODOT, 'DATA-UR');
}

// Miesiąc w dopełniaczu tuż za numerem („11 listopada", „11 Listopada", „12 MAJA 2024") — numer to
// dzień daty. „Maja" z wielkiej litery to też imię („ul. Lipowa 12⇥Maja Kowalska", „ul. Polna 5 Maja
// Wróbel"): miesiącem jest wtedy, gdy nie stoi za nim wyraz z wielkiej litery („3 Maja o godz. 12",
// „12 Maja 2024 r.").
const RE_MONTH_GEN_AHEAD =
  /^[ \t]+(?:stycznia|lutego|marca|kwietnia|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?!\p{L})/iu;
const RE_MAY_AHEAD = /^[ \t]+(?:maja(?!\p{L})|(?:Maja|MAJA)(?!\p{L})(?![ \t]+\p{Lu}))/u;
// Ciąg za liczbą po „Miejscowość Rynek N": data, okres, ilość albo lokal („5 maja", „5 lat temu",
// „12 m. 4") — wtedy liczba nie jest gołym numerem urzędu na rynku, a para może być osobą.
function rynekNoNotHouse(rest: string): boolean {
  return (
    RE_MONTH_GEN_AHEAD.test(rest) ||
    RE_MAY_AHEAD.test(rest) ||
    RE_QUANTITY_AFTER.test(rest) ||
    /^[ \t]*(?:\/|[,.]?[ \t]*(?:m|lok|mieszk)\.?[ \t]*\d|lat(?!\p{L})|lata(?!\p{L})|r\.|rok)/u.test(rest)
  );
}
// Silna etykieta adresu przed „ul. …" — po niej niejednoznaczny numer zostaje numerem domu. Też
// „zamieszkały przy ul. …" i etykieta z dopowiedzeniem przed dwukropkiem („Adres lokalu:", „Adres
// nieruchomości:", „Adres do korespondencji:") — bez niej strażnik ilości oddawał taki adres jawny.
const RE_STRONG_ADDR_LABEL =
  /(?:adres\p{L}*(?:[ \t]+\p{Ll}+){1,3}[ \t]*:|adres\p{L}*|zam\.|zamieszka\p{L}*|zameldowan\p{L}*)[ \t]*:?(?:[ \t]+(?:przy|na|w))?[ \t]*$/iu;
// „mieszka przy …" — słabsza od etykiety: liczebnik za nazwą dalej bywa ilością („Mieszkał
// w Alejach Ujazdowskich 3 miesiące"), ale proza za numerem nie odbiera adresu osobie („Jan Nowak
// mieszka przy Alejach Jerozolimskich 44 od lat").
const RE_RESIDENCE_BEFORE = /(?<!\p{L})mieszka(?:ł[aoy]?|li|ją|jąc[aey]?|m|sz|my|cie)?[ \t]+(?:przy|na|w)[ \t]+$/iu;
// Imię i nazwisko tuż przed adresem, bez etykiety („Wnioskodawca Jan Kowalski ul. Żwirki i Wigury 15
// prosi …", „Jan Nowak, Aleje Jerozolimskie 44 tel. …") — to adres tej osoby, choć za numerem stoi
// proza. Para musi mieć imię ze słownika; „Rada Miasta", „Urząd Gminy" się nie liczą.
// Dwa ostatnie wyrazy szukane skanem wstecz: regex zakończony „$" próbowałby od każdej pozycji okna.
const RE_CAP_NAME_TOKEN = /^[^\p{L}]*(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)$/u;
const RE_CAP_NAME_WORD_ONLY = /^\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u;
function personPairBeforeAddr(before: string): boolean {
  const hs = (c: string | undefined): boolean => c === ' ' || c === '\t';
  let e2 = before.length;
  while (e2 > 0 && hs(before[e2 - 1])) e2--;
  if (before[e2 - 1] === ',') {
    e2--;
    while (e2 > 0 && hs(before[e2 - 1])) e2--;
  }
  let s2 = e2;
  while (s2 > 0 && !hs(before[s2 - 1]) && before[s2 - 1] !== '\n') s2--;
  let e1 = s2;
  while (e1 > 0 && hs(before[e1 - 1])) e1--;
  if (e1 === s2) return false; // przed wyrazem początek okna albo nowa linia
  let s1 = e1;
  while (s1 > 0 && !hs(before[s1 - 1]) && before[s1 - 1] !== '\n') s1--;
  const a = RE_CAP_NAME_TOKEN.exec(before.slice(s1, e1))?.[1]?.toLowerCase();
  const w2 = before.slice(s2, e2);
  if (!a || !RE_CAP_NAME_WORD_ONLY.test(w2)) return false;
  const b = w2.toLowerCase();
  if (LEGAL_ENTITY_WORDS.has(a) || LEGAL_ENTITY_WORDS.has(b)) return false;
  return POLISH_FIRST_NAMES.has(a) || POLISH_FIRST_NAMES.has(b);
}
// Osoba po etykiecie tuż przed adresem („Odbiorca: Jan Kowalski, ul. …", „Wnioskodawca: Jan
// Kowalski, ul. …") — adres tej osoby, jak po silnej etykiecie. Tylko imię z nazwiskiem: miejscowość,
// dzień czy urząd po etykiecie („Miejsce: Warszawa, plac Piłsudskiego 11 listopada", „Termin:
// Poniedziałek, …", „Organizator: Gmina Jarosław, …") nie robią z dnia numeru domu.
const RE_LABELED_NAME_BEFORE_ADDR = /:[ \t]*(\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*){1,3})[ \t]*,[ \t]*$/u;
function labeledPersonBeforeAddr(before: string): boolean {
  const run = RE_LABELED_NAME_BEFORE_ADDR.exec(before)?.[1];
  if (!run) return false;
  const ws = run.toLowerCase().split(/[ \t]+/);
  return ws.some((w) => POLISH_FIRST_NAMES.has(w)) && !ws.some((w) => LEGAL_ENTITY_WORDS.has(w));
}
// Numer domu przed dniem albo rokiem daty („ul. Długiej 15 12 lipca", „ul. Polna 15 1998 r.",
// „ul. Długa 5⇥2024-05-12") — adres kończy się na numerze domu, a dzień/rok zostaje za maską.
const RE_HOUSE_NO_BEFORE_DATE = /^(.*[ \t]\d+[A-Za-z]?)([ \t]+\d{1,4})$/;
// Numer domu przed PEŁNĄ datą z godziną („ul. Krótka 8 2024-05-12 10:20", „… 8 12.05.2024 10:20"):
// data wchodzi w człon nazwy, a godzina staje się „numerem domu", więc cięcie po dniu albo roku
// nie trafiało i strażnik godziny oddawał cały adres jawny.
const RE_HOUSE_NO_BEFORE_DATETIME =
  /^(.*[ \t]\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)([ \t]+(?:(?:19|20)\d{2}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:19|20)\d{2})(?:[ \t]+\d{1,2})?)$/;
// Numer domu po wyrazie nazwy, a za nim kropka i wielka litera następnego zdania.
const RE_HOUSE_NO_SENTENCE_END = new RegExp(`(?<=[${PL_LO}])[ \\t]+\\d{1,4}[A-Za-z]?(?=\\.[ \\t]+[${PL_UP}][${PL_LO}])`);
// Numer domu, także zakres bez odstępów („Hoża 41-43", „41–43"). Pierwszy człon zakresu najwyżej
// trzycyfrowy: „przy ul. Okopowej 1944-1956" to lata, nie numery.
const ADDR_HOUSE = String.raw`\d+[A-Za-z]?(?:(?<!\d{4})[-–]\d{1,3}[A-Za-z]?(?!\d))?`;
// Numer lokalu nie zaczyna dłuższego wyrazu („mieszkanie 3-pokojowe"), nie jest metrażem („lokal
// 120 m2") ani początkiem dłuższej liczby (cofanie skróciłoby „120" do „12"), także ułamka: w „ul.
// Rynek 7, lokal 32,4 m2" po słowie „lokal" stoi metraż, a maska zjadała jego część („[ADRES],4 m2").
const ADDR_UNIT_END = String.raw`(?![-–]?[${PL_LO}${PL_UP}]|\d|[,.]\d|[ \t]*(?:m2|m²|mkw|m\.?[ \t]*kw))`;
// Lokal: „/3", „m. 3", „lok. 3" jak dawniej, a do tego po przecinku („Długa 5, m. 3"), słowem
// („lokal 3", „mieszk. 3") i drugi człon („84/92 lok. 105", „84/92/105"). Dawniej znany był jeden
// człon bez przecinka, więc reszta numeru zostawała jawna za maską („[ADRES] lok. 105"). Drugi człon
// i warianty nowe tylko w obrębie wiersza: przez nową linię lokal sklejałby się z następnym wpisem.
// Numer po słowie lokalu może mieć własny człon: „m. 3/4", „lok. 2 i 3" (dwa lokale). Dawniej
// maska kończyła się na pierwszej liczbie, a reszta zostawała jawna za nią („[ADRES]/4", „[ADRES] i 3").
// „i N" nie przed wyrazem: „m. 3 i 2 dzieci" to lokal i liczebnik.
const ADDR_UNIT_WORD_NO = String.raw`\d+[A-Za-z]?(?:[ \t]*\/[ \t]*\d{1,3}[A-Za-z]?|[ \t]+i[ \t]+\d{1,3}[A-Za-z]?(?![ \t]+[${PL_LO}]{3}))?`;
const ADDR_UNIT_INLINE = String.raw`(?:[ \t]*\/[ \t]*\d+[A-Za-z]?|(?:[ \t]*(?:m\.?|lok\.?)[ \t]*|[ \t]*,[ \t]*(?:m\.?|lok\.?|lokal|mieszk\.?)[ \t]*|[ \t]+(?:lokal|mieszk\.?)[ \t]*)${ADDR_UNIT_WORD_NO})${ADDR_UNIT_END}`;
const ADDR_UNIT = String.raw`(?:\s*(?:\/\s*\d+[A-Za-z]?|(?:m\.?|lok\.?)\s*${ADDR_UNIT_WORD_NO})${ADDR_UNIT_END}|${ADDR_UNIT_INLINE})?(?:${ADDR_UNIT_INLINE})?`;
// Czy dopasowanie adresu ma człon lokalu („/3", „m. 3", „, lok. 2", „mieszk. 5")? Jawny lokal
// rozstrzyga, że liczba przed nim to numer domu, a nie liczebnik.
const RE_ADDR_HAS_UNIT = /\d[A-Za-z]?[ \t]*\/[ \t]*\d|(?<![\p{L}])(?:m\.?|lok\.?|lokal|mieszk\.?)[ \t]*\d/u;
// Łącznik pisany małą literą przed ostatnim członem nazwy ulicy („Żwirki i Wigury", „Jana z Kolna",
// „Bitwy pod Płowcami", „Bolesława z Mazowsza") — dawniej przerywał nazwę i adres zostawał jawny
// albo maska zaczynała się w połowie („ul. Żwirki i [ADRES]"). „z/ze" nie przed narzędnikiem: „na ul.
// Długiej z Kowalskim 5 razy" to osoba, nie człon nazwy. Nie po członie-liczbie: w „Lokale przy ul.
// Polnej 5 i Leśnej 7" liczba to numer domu pierwszego adresu, a nazwa „Polnej 5 i Leśnej" przez
// strażnik prozy oddawała oba adresy jawne. Nazwa z liczbą na początku („3 Maja") kończy się literą.
// Tak samo numer z literą („ul. Polnej 5a i Pawilonie 4"): „5a" to numer domu, nie człon nazwy.
const ADDR_CONNECTOR = String.raw`(?:(?<!\d[A-Za-z]?)[ \t]+(?:i|pod|nad|de|von|van|der|da|di|du|la|le|(?:z|ze)(?![ \t]+[${PL_UP}][${PL_LO}${PL_UP}]*(?:em|ą|ami|im|ym|imi|ymi)(?![${PL_LO}])))[ \t]+[${PL_UP}][${PL_LO}${PL_UP}.-]*)?`;
// Liczba mnoga „Aleje/Alejach" to częściej nazwa (wystawy, imprezy) niż skrót adresu: sam rok za
// nią to nie numer domu („Aleje Ujazdowskie 2024 to tytuł wystawy").
const RE_ALEJE_PLURAL = /^alej(?:e|ach)$/i;
// Formy „Aleje/Alejach/Aleją" — słabszy prefiks niż „ul."/„al.": w prasie „W Alejach Jerozolimskich
// 3 wypadki" to miejsce zdarzenia, a liczba za nazwą to liczebnik. Pisane małą literą to rzeczownik
// pospolity („w alejach Zasłużonych 15 grobów", aleje cmentarza czy parku), nie nazwa ulicy: adresem
// są wtedy tylko po etykiecie albo z lokalem.
const RE_ALEJE_WEAK = /^alej(?:e|ach|ą)$/i;
const RE_ALEJE_WEAK_LOWER = /^alej(?:e|ach|ą)$/;
// Liczebnik z rzeczownikiem za nazwą ulicy to ilość, nie numer domu („Na Alejach Jerozolimskich 15
// tysięcy ludzi", „Wypadek przy ul. Długiej i Krótkiej 5 osób rannych", „przy ul. Długiej 5 minut").
// Tylko małą literą: „Osoby zameldowane:", „Dni pobytu:", „Metraż:", „Pojazd:" to etykiety następnych
// pól formularza spłaszczonego do jednego wiersza. Nie przed liczbą: „lat 45", „osoby 3" to zapis
// wieku albo wartość pola. Rzeczowniki spoza miar tylko w liczbie mnogiej („3 sklepy", „7 domów",
// „2 tramwaje"): forma pojedyncza za prawdziwym adresem bywa jego opisem („ul. Długa 5 sklep
// spożywczy"), a strażnik oddaje wtedy adres jawny. Miary i pojazdy tylko w formach, które stoją po
// liczebniku („5 samochodów", „2 metry"): „samochodem", „pojazdem", „minutę" czy „metraż" ilością
// nie są, więc liczba przed nimi to numer domu („przy ul. Polnej 5 samochodem marki Opel").
const RE_QUANTITY_AFTER = new RegExp(
  '^[ \\t]+(?:tys\\.|tysiąc[ea]?|tysięcy|mln|osób|osoby|ludzi|uczestni(?:ków|cy|czek|czki)|demonstran(?:tów|ci|tek|tki)|' +
    'samochod(?:y|ów)|pojazd(?:y|ów)|razy|minut[y]?|godzin[y]?|sekund[y]?|dni|lat|lata|miesi(?:ące|ęcy)|tygodni(?:e)?|' +
    'doby|dób|wiek(?:i|ów)|metr(?:y|ów)|kilometr(?:y|ów)|km|szt\\.|sztuk|rodzin|dzieci|uczni(?:ów|owie)|' +
    'pracowni(?:ków|cy)|mieszkańc(?:ów|y)|artyst(?:ów|ki|ek)|biegacz(?:y|e)|kierowc(?:ów|y)|pasażer(?:ów|owie)|' +
    'rannych|ofiar|gości|widzów|kibiców|sklep(?:y|ów)|dom(?:y|ów)|budynków|bloków|kamienic|mieszkań|' +
    'pokoje|pokoi|pomnik(?:i|ów)|autobus(?:y|ów)|tramwaj(?:e|ów)|ambasad(?:y)?|pas(?:y|ów)|drzew(?:a)?|' +
    'klon(?:y|ów)|latar(?:ni|nie)|kawiar(?:ni|nie)|miejsc(?!\\.)|punkt(?:y|ów))(?!\\p{L})(?![ \\t]*\\d)',
  'u',
);
// („miejsc." z kropką to skrót „miejscowość": „ul. Polna 5 miejsc. Warszawa" jest adresem.)
// Mianownik liczby mnogiej stoi tylko po 2–4 (bez 12–14): „3 lata", „22 osoby", ale „Przy ul. Polnej
// 15 mieszkańcy skarżą się", „ul. Leśnej 8 pokoje są zawilgocone" czy „ul. Polnej 5 osoby bezdomne"
// to numer domu i podmiot zdania, a nie liczebnik z rzeczownikiem.
const RE_QUANTITY_NOM_PL = new RegExp(
  '^[ \\t]+(?:tysiące|osoby|uczestni(?:cy|czki)|demonstran(?:ci|tki)|samochody|pojazdy|minuty|godziny|sekundy|lata|' +
    'miesiące|tygodnie|wieki|metry|kilometry|uczniowie|pracownicy|mieszkańcy|artystki|biegacze|kierowcy|pasażerowie|' +
    'sklepy|domy|pokoje|pomniki|autobusy|tramwaje|ambasady|pasy|drzewa|klony|latarnie|kawiarnie|punkty)(?!\\p{L})',
  'u',
);
const RE_TIME_QUANTITY_AFTER = /^[ \t]+(?:minut|godzin|sekund|dni|dob|dób|lat(?!\p{L})|lata|miesi|tygodni|wiek|razy)/u;
// Rzeczownik z orzeczeniem w liczbie mnogiej tuż za nim („ul. Kwiatowej 7 dzieci nie mają pokoju",
// „ul. Polnej 5 dzieci bawiły się") to podmiot w mianowniku, a nie dopełniacz po liczebniku: po
// liczebniku od pięciu orzeczenie stoi w liczbie pojedynczej („7 dzieci nie ma", „5 dzieci
// bawiło się"). Liczba przed nim to więc numer domu. Nie dla miar czasu: „przy ul. Polnej 7 lat
// mieszkali" to okres, a orzeczenie należy do innego podmiotu.
const RE_PLURAL_VERB_AFTER_NOUN = /^[ \t]+\p{Ll}+[ \t]+(?:nie[ \t]+)?(?:są|\p{Ll}{2,}(?:ją|ą|ły|li))(?!\p{L})/u;
function quantityAfter(m: string, rest: string): boolean {
  if (!RE_QUANTITY_AFTER.test(rest)) return false;
  const n = Number(/(\d+)\D*$/.exec(m)?.[1] ?? '0');
  const few = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
  // (po 2–4 liczba mnoga orzeczenia jest zgodna z liczebnikiem: „3 osoby mieszkają")
  if (!few && n > 1 && RE_PLURAL_VERB_AFTER_NOUN.test(rest) && !RE_TIME_QUANTITY_AFTER.test(rest)) return false;
  if (!RE_QUANTITY_NOM_PL.test(rest)) return true;
  return few;
}
// Rzeczownik z dwukropkiem i wartością za nim (do trzech wyrazów przed dwukropkiem) to etykieta
// NASTĘPNEGO pola formularza spłaszczonego do wiersza („ul. Polna 5 dzieci: 2", „ul. Kwiatowa 7 osób
// zamieszkujących: 4"), nie liczebnik z rzeczownikiem — strażnik ilości oddawał wtedy cały adres
// jawny. Za dwukropkiem liczba, wielka litera albo „tak/nie/brak": w prozie po dwukropku idzie
// zwykle wyliczenie małą literą („3 wypadki: dwa na …").
const RE_FIELD_LABEL_AFTER =
  /^[ \t]+\p{Ll}+\.?(?:[ \t]+\p{Ll}+\.?){0,2}[ \t]*:[ \t]*(?:\d|\p{Lu}|(?:tak|nie|brak)(?!\p{L}))/u;
// Godzina za nazwą ulicy („Zbiórka przy ul. Polnej i Leśnej 18:00", „Aleje Ujazdowskie 18:00") — to
// nie numer domu; maska zjadała godzinę i zostawał ogon „[ADRES]:00".
const RE_TIME_AFTER = /^[:.][0-5]\d(?!\d|[.:]\d)/;
const RE_NUMERIC_TAIL_AFTER = /^(?:[ \t]\d{3}(?!\d)|[,.]\d|[ \t]*%|x\d|\+\d)/;
// Łącznik w nazwie ulicy („Żwirki i Wigury", „Bitwy pod Płowcami") — sam rok za taką nazwą to data
// albo wyliczenie ulic, nie numer domu („ul. Długiej i Krótkiej 2026 — harmonogram").
const RE_ADDR_CONNECTOR_USED = new RegExp(`[ \\t](?:i|pod|nad|de|von|van|der|da|di|du|la|le|z|ze)[ \\t]+[${PL_UP}]`);
const RE_ADDR_CONNECTOR_I = new RegExp(`[ \\t]i[ \\t]+[${PL_UP}]`);
// Skrzyżowanie przed skrótem ulicy: „Na skrzyżowaniu ul. Polnej i Leśnej", „na rogu ul. Mickiewicza
// i Słowackiego" — „X i Y" to wtedy dwie ulice, a nie jedna nazwa z łącznikiem.
const RE_CROSSING_BEFORE = /(?<!\p{L})(?:skrzyżowani\p{L}*|zbieg\p{L}*|rogu|róg|rejonie|okolic[ay]|między|pomiędzy)[ \t]+$/iu;
// Wyraz małą literą za numerem po słabym prefiksie (łącznik w nazwie, „Aleje"): proza, a liczba
// to liczebnik albo część zdania („ul. Polnej i Leśnej 3 radiowozy", „W Alejach Jerozolimskich 3
// wypadki", „przy ul. Nowy Świat i Chmielnej 15 po południu"). Adres ciągnie się dalej tylko
// miejscowością („… 16 w Warszawie"), kolejnym numerem („… 15 i 17") albo dalszym członem zapisu
// adresu i kontaktu („tel.", „kod", „kl.", „piętro").
const RE_PROSE_AFTER_WEAK = new RegExp(
  '^[ \\t]+(?!(?:w|we)[ \\t]+\\p{Lu}|(?:i|oraz)[ \\t]+\\d|' +
    '(?:m|lok|kl|p|pok|pię|skr|bud|bl|wej|gm|pow|woj)\\.|' +
    '(?:tel|kom|fax|faks|nr|kod|poczta|lokal|mieszkanie|piętro|klatka|wejście|e-?mail)(?!\\p{L})|' +
    // czasownik zamieszkania za numerem to adres osoby („Przy ul. Jana z Kolna 12 mieszka pani …")
    '(?:za)?mieszka(?:ją|ł[aoy]?|li)?(?!\\p{L})|zamieszkuj[eą](?!\\p{L})|zameldowan[aiyoe]\\p{L}*)\\p{Ll}',
  'u',
);
// Lokal zapisany słowem po spacji tuż za numerem domu („ul. Długiej 5 lokal 12") — w prozie „lokal"
// bywa podmiotem zdania, a liczba za nim liczebnikiem („Przy ul. Długiej 5 lokal 12 lat stał
// pusty"). Skrót „mieszk." i lokal po przecinku podmiotem nie bywają.
const RE_SPACE_UNIT_TAIL = /(?<=\d[A-Za-z]?)[ \t]+lokal[ \t]*\d+[A-Za-z]?$/;

// 12) ADRES — ul./al./os./pl. + nazwa + numer (opcjonalnie /mieszkanie). Wysoka precyzja.

// Drugi człon wyliczenia za maską adresu bez skrótu „ul." musi mieć kształt nazwy ulicy: przymiotnik
// („Leśnej", „Krótka", „Lipowa", „Armii Krajowej") albo patron w dopełniaczu („Mickiewicza",
// „Kościuszki", „Słowackiego"). Rzeczownik pospolity z numerem to część budynku, odwołanie do pisma
// albo wersja programu („i Sali 12", „oraz Hala 3", „i Rozdział 3 umowy", „oraz Windows 10"), a miesiąc
// to data („i Grudnia 2020"). Rzeczowniki na „-a/-i/-y" mają kształt dopełniacza patrona, więc
// odsiewa je lista.
const RE_SECOND_STREET_SHAPE = /(?:[aiy]|ego|ej)$/u;
const SECOND_STREET_NOT = new Set<string>(
  (
    'hala hali sala sali klatka klatki strona strony stronie liga ligi wisła grupa grupy strefa strefy ' +
    'faza fazy klasa klasy wersja wersji tura tury runda rundy edycja edycji pozycja pozycji kolumna ' +
    'kolumny kasa kasy bramka bramki linia linii szafa szafy sekcja sekcji kwatera kwatery działka ' +
    'działki lekcja lekcji godzina godziny tabela tabeli faktura faktury umowa umowy uchwała uchwały ' +
    'ustawa ustawy decyzja decyzji opcja opcji kabina kabiny kondygnacja kondygnacji brama bramy ' +
    'kategoria kategorii sesja sesji komórka komórki trasa trasy zmiana zmiany scena sceny cena ceny ' +
    'aneksu etapu budynku pokoju magazynu pawilonu peronu gabinetu osiedla rozdziału lokalu bloku ' +
    'segmentu boksu punktu ustępu załącznika stanowiska wejścia piętra rewiru wydziału oddziału ' +
    'stycznia lutego marca kwietnia maja czerwca lipca sierpnia września października listopada grudnia ' +
    // pomieszczenia i budynki obok adresu („lokal przy ul. Długiej 5 oraz Piwnicy 3", „… i Szkoły 3")
    'piwnicy piwnica szkoły szkoła przychodni przychodnia apteki apteka kaplicy kaplica stacji stacja ' +
    'kamienicy kamienica oficyny oficyna galerii galeria wieży wieża furtki furtka skrytki skrytka szafki ' +
    'szafka ławki ławka bazy baza mety meta hurtowni hurtownia ' +
    // narzędnik rzeczowników po „z ul. … i …" („Salą 3", „Klatką 2")
    'salą halą klatką bramą stroną szafą kasą linią strefą grupą działką'
  ).split(' '),
);
// Biernik albo narzędnik przymiotnika („na ul. Słoneczną 2 i Kwiatową 14", „z ul. Długą 5 i Krótką 3")
// — tylko gdy maska adresu stoi po przyimku rządzącym tym przypadkiem (zgodność z pierwszą ulicą).
const RE_SECOND_STREET_ACC_SHAPE = /\p{Ll}{2,}ą$/u;
const RE_SECOND_STREET_ACC_PREP = /(?<!\p{L})(?:na|za|pod|nad|przed|z|ze|między)[ \t]+$/iu;
function secondStreetShape(street: string, accInstr = false): boolean {
  const ws = street
    .split(/[ \t]+/)
    .filter((w) => /^\p{L}/u.test(w))
    .map((w) => w.toLowerCase());
  if (ws.some((w) => SECOND_STREET_NOT.has(w))) return false;
  if (ws.some((w) => RE_SECOND_STREET_SHAPE.test(w))) return true;
  return accInstr && ws.every((w) => RE_SECOND_STREET_ACC_SHAPE.test(w) && !isFirstNameLike(w));
}
// (12a2) ADRES BEZ „ul." PO ETYKIECIE ZAMIESZKANIA: „Adres zamieszkania: Lipowa 14/3, Gdańsk",
// „Zamieszkały: Zalesie 45", „zam. Rynek 15 m. 3 w Krakowie". 12a wymaga skrótu ulicy, 12b kodu
// pocztowego obok, a pole formularza z miejscowością odrzuca wartość z cyfrą — ulica z numerem
// zostawała jawna (albo dostawała maskę osoby: „[IMIĘ I NAZWISKO] 5/2"). Etykieta silna („Adres
// zamieszkania/zameldowania/do korespondencji", „Miejsce pobytu", „Zamieszkały") wystarcza;
// słaba („Adres:", „zam." — to też „zamówienie") wymaga numeru lokalu albo miejscowości ze słownika
// za przecinkiem. Goły rok w miejscu numeru („Adres: Gdańsk 2024") odpada.
const RE_ADDR_AFTER_LABEL = new RegExp(
  String.raw`(?<!\p{L})(?:((?:[Aa]dres|ADRES|[Mm]iejsce|MIEJSCE)[ \t]+(?:zamieszkania|zameldowania|pobytu|ZAMIESZKANIA|ZAMELDOWANIA|POBYTU)|[Aa]dres[ \t]+(?:do[ \t]+)?korespondenc\p{Ll}*|[Zz]amieszka(?:ły|ła|li|łe)|[Zz]ameldowan[aey])|((?<![Nn]r[ \t]{0,3})(?:[Aa]dres(?=[ \t]*:)|zam\.)))` +
    String.raw`([ \t]*:?[ \t]*)(?:(\p{Lu}\p{Ll}+(?:[ \t-]\p{Lu}\p{Ll}+)?)([ \t]*,[ \t]*))?` +
    String.raw`(\p{Lu}[\p{Ll}.-]+(?:[ \t]+(?:\p{Lu}[\p{Ll}.-]+|[IVX]{1,4}|i)){0,3})([ \t]+)` +
    String.raw`(\d{1,4}[a-zA-Z]?(?:[/-]\d{1,4}[a-zA-Z]?)?(?:[ \t]*(?:m\.|lok\.|m)[ \t]*\d{1,3}[a-zA-Z]?)?)` +
    String.raw`(?=[ \t]*(?:[,;)]|\.(?!\d)|\r?\n|$)|[ \t]+we?[ \t]+\p{Lu})`,
  'gu',
);
// Pierwszy wyraz, który po etykiecie adresu nie jest nazwą ulicy ani miejscowości.
const ADDR_LABEL_VALUE_STOP = new Set<string>(
  (
    'sala sali pokój pokoju budynek budynku piętro piętra brama pkt art rozdział załącznik windows wersja tel telefon nr numer kod ' +
    // odsyłacz formularza („Adres zamieszkania: Rubryka 7.", „Zamieszkała: Lat 5.")
    'rubryka rubryki rubryce strona stronie str poz pozycja tabela tabeli wariant formularz formularza wiersz wiersza ' +
    'kolumna kolumny wzór wzoru krok pole pola część ust par lat lata etap okres klasa grupa typ model ' +
    // odsyłacz do akt i druku („Adres zamieszkania: Paragraf 2.", „… Karta 15.", „… Tom 2.")
    'paragraf paragrafu tom tomu karta karty dział działu księga księgi arkusz arkusza wpis wpisu druk druku ' +
    'akta akt według wg patrz jw'
  ).split(' '),
);
// Przymiotniki miejscowe, które są też w LEGAL_ENTITY_WORDS („Nowa Wieś", „Stare Babice").
const ADDR_PLACE_ADJ_OK = new Set<string>('nowa nowe nowy stara stare stary'.split(' '));
const RE_ADDR_CITY_AFTER = /^[ \t]*,[ \t]*(?:\d{2}-\d{3}[ \t]+)?(?:(gm\.)|(\p{Lu}\p{Ll}+(?:[ \t-]\p{Lu}\p{Ll}+)?))/u;
// Ulica z patronem w dopełniaczu bez „ul." („Jana Pawła II 14/3, Gdańsk", „Anna Kowalska, Jana
// Pawła II 5"): imię patrona w dopełniaczu, drugi człon w dopełniaczu, opcjonalna liczba rzymska
// i numer domu. Dawniej drugi człon („Pawła") szedł jako nazwisko i adres dostawał przypadkiem maskę
// osoby; z pełną odmianą imion to dwa imiona i adres zostawał jawny. Tylko z miejscowością ze
// słownika albo kodem za przecinkiem, albo zaraz po imieniu i nazwisku osoby.
// Także z tytułem patrona i trzecim członem („Kardynała Stefana Wyszyńskiego 12", „Stanisława
// Ignacego Witkiewicza 5", „Marii Skłodowskiej-Curie 5") — tytuł wchodzi do maski, środkowy wyraz
// też musi być dopełniaczem imienia.
const PATRON_STREET_TITLES =
  String.raw`Kardynała|Marszałka|Prymasa|Generała|Gen\.|Ks\.|Księdza|Biskupa|Króla|Hetmana|Prezydenta|Prof\.|Profesora|Dr\.|Doktora|Majora|Pułkownika|Rotmistrza|Kapitana|Porucznika`;
// Odstępy w nazwie i przed numerem tylko spacjami: tabulator to granica komórki TSV, a numer
// z sąsiedniej komórki („SP nr 1⇥Jana Pawła II⇥12" — liczba klas, „…⇥Jana Pawła II⇥98" — punkty)
// to nie numer domu. Lokal „m."/„lok." także WERSALIKAMI („5 M. 2").
const PATRON_STREET_HEAD_SRC = String.raw`(?<![\p{L}\p{N}])(?:(?<!\.)|(?<=(?<!\p{L})im\.))(?:(?:${PATRON_STREET_TITLES}) +)?(\p{Lu}\p{Ll}+)(?: +(\p{Lu}\p{Ll}+))? +(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)(?: +[IVX]{1,4})?`;
// Liczba przed jednostką powierzchni („Mieszkanie Jana Nowaka 48 m2", „Działka … 1200 m2", „… 2 ha")
// to metraż, nie numer domu, a „m" bez kropki to lokal tylko ze spacją przed numerem („30 m 2").
const PATRON_STREET_NUM_SRC = String.raw` +\d{1,4}[a-zA-Z]?(?: ?[/-] ?\d{1,4}[a-zA-Z]?)?(?: *(?:[mM]\.(?= *\d)|[mM](?= +\d)(?! +\d{1,3} *(?:cm|mm)(?![\p{L}\p{N}]))|[lL][oO][kK]\.|[lL]okal(?:u)?|LOKAL(?:U)?) *\d{1,3}[a-zA-Z]?)?(?! *(?:[mM]2|[mM]²|[mM][kK][wW]|[mM]\.? ?[kK][wW]\.?|ha)(?![\p{L}\p{N}]))`;
const PATRON_STREET_SRC = PATRON_STREET_HEAD_SRC + PATRON_STREET_NUM_SRC;
// Po etykiecie adresu, zamieszkania albo „przy" ulica z numerem w dowolnym otoczeniu: miasto
// wielką literą, kod pocztowy, „nr"/„pod nr", myślnik czy imię kolejnej osoby za numerem
// („Adres zamieszkania: Jana Pawła II 14 Kielce", „zamieszkały przy Jana Pawła II nr 14",
// „… przy Jana Pawła II 14 - wnosi"). Dawniej zostawała jawna w całości.
const RE_PATRON_STREET_NO_CTX = new RegExp(
  String.raw`${PATRON_STREET_HEAD_SRC}(?: +(?:pod +)?nr\.?)?${PATRON_STREET_NUM_SRC}(?![\p{L}\p{N}])`,
  'gu',
);
// To samo WERSALIKAMI („DOM PRZY STANISŁAWA WYSPIAŃSKIEGO 5.", „W LOKALU PRZY JANA PAWŁA II 30/2
// W GORLICACH", „ZAM. JANA PAWŁA II 5") — rozstrzyga ta sama kotwica co w trybie „ctx". Drugi
// człon nie bywa liczbą rzymską (ta stoi za nim). Bez kotwicy para WERSALIKAMI zostaje osobą.
const RE_PATRON_STREET_CAPS = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])(\p{Lu}{2,})(?: +(\p{Lu}{2,}))? +(?![IVX]{1,4}(?!\p{L}))(\p{Lu}{2,}(?:-\p{Lu}{2,})?)(?: +[IVX]{1,4})?(?: +(?:POD +)?NR\.?)?${PATRON_STREET_NUM_SRC}(?![\p{L}\p{N}])`,
  'gu',
);
const RE_PATRON_STREET_NO = new RegExp(String.raw`${PATRON_STREET_SRC}(?=[ \t]*(?:[,;)]|\.(?!\d)|\r?\n|$)|[ \t]+we?[ \t]+\p{Lu})`, 'gu');
// To samo, gdy za numerem domu biegnie dalej zdanie („Wnioskodawca zamieszkały przy Jana Pawła II 14
// zwrócił się …", „Mieszkańcy Jana Pawła II 5 zgłosili awarię"). Tylko po etykiecie zamieszkania,
// adresu albo „przy" (patrz street() w patronStreetWithNumber): bez nich liczba z rzeczownikiem
// („Głosowało na Tomasza Mazura 12 radnych") to osoba. Data i jednostka za liczbą odpadają — patrz
// RE_PATRON_NUM_UNIT_AFTER.
const RE_PATRON_STREET_NO_LOOSE = new RegExp(String.raw`${PATRON_STREET_SRC}(?= +\p{Ll})`, 'gu');
// Data, jednostka albo krotność tuż za numerem („Jana Pawła II 5 egz.", „Adama Mickiewicza 5 razy
// odwiedzała", „… 12 maja", „… 5 lat") — liczba należy do zdania, nie do adresu. Tylko w tej samej
// komórce: „Adres:⇥Jana Pawła II 14⇥Miejsc.:⇥Kielce" to adres, a „Miejsc." — następna etykieta.
const RE_PATRON_NUM_UNIT_AFTER =
  /^ *(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia|r\.|roku|lat|lata|zł|osób|os\.|egz\.?|egzemplarz\p{L}*|razy|raz|szt\.?|sztuk\p{L}*|pkt|punkt\p{L}*|proc\p{L}*|%|tys\.?|godz\p{L}*|min\.?|minut\p{L}*|sekund\p{L}*|dni|tygodni\p{L}*|miesięc\p{L}*|km|metr\p{L}*|m(?! *[.\d])|m +\d{1,3} *(?:cm|mm)|cm|mm|klas\p{L}*|uczni\p{L}*|miejsc\p{L}*)(?!\p{L})/iu;
// Patron z liczbą rzymską i numerem domu („Jana Pawła II 5/2", „Jana Pawła II 30") to nazwa ulicy:
// żywa osoba nie nosi liczby rzymskiej, a papież nie ma numeru domu. Od kiedy „Jana Pawła" przestało
// być parą osoby, taka ulica bez kotwicy adresu zostawała jawna w całości (wiersz CSV z rolą
// „Współwłaściciel", koperta z telefonem pod ulicą, „Nowy Targ, …", „KRAKÓW, …", myślnik
// albo nawias za numerem). Za numerem koniec wiersza, zdania albo komórki, separator albo „w Mieście"
// — nie dalszy ciąg zdania („Na Jana Pawła II 5 mieszka Jan", „pontyfikat Jana Pawła II 26 lat").
const RE_PATRON_STREET_ROMAN = new RegExp(
  PATRON_STREET_HEAD_SRC.replace('(?: +[IVX]{1,4})?', ' +[IVX]{1,4}') +
    String.raw`(?:,? +(?:pod +)?nr\.?)?` +
    PATRON_STREET_NUM_SRC +
    // (albo miejscowość tuż za numerem w tej samej komórce: „;Jana Pawła II 30/2 Kraków;" — sprawdza
    // ją street0 w słowniku miejscowości)
    String.raw`(?![\p{L}\p{N}/])(?=\t| *(?:[,;:)(\-–—"|]|\.(?!\d)|\r?\n|$)|[ \t]+we?[ \t]+\p{Lu}| +\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)? *(?:[,;|\t]|\r?\n|$))`,
  'gu',
);
// Przed patronem z liczbą rzymską bez kotwicy adresu tylko początek wiersza albo komórki,
// separator listy czy koperty („Kraków, …", „Jan Nowak – …", „(…") — wyraz przed nim to odsyłacz,
// tytuł albo wyliczenie („Treny Jana Kochanowskiego II 3.", „Encyklika …", „Wizyty Jana Pawła II
// 8.", „Ranking: Kazimierza Wielkiego III 2;"), nie adres — chyba że to imię i nazwisko osoby
// („Anna Kowalska Jana Pawła II 5", patrz personPairBeforeAddr).
const RE_PATRON_ROMAN_BOUNDARY = /(?:^|[\r\n\t;,(–—"„“”«»'|]|[ \t]-)[ \t]*$/u;
// Odsyłacz do pism, wydarzeń i nazw z patronem tuż przed nim („Encyklika …", „Treny …", „Wizyty …",
// „Rocznica Śmierci …", „Kazanie …", „rozdz. …", „Przystanek …", „Sala …") — taki patron z liczbą
// zostaje jawny. Każdy inny wyraz przed nim (bez kotwicy adresu) nie rozstrzyga: para dostaje
// maskę osoby jak w v0.46.23, a liczba rzymska i numer zostają.
const RE_PATRON_ROMAN_REF_BEFORE =
  /(?<!\p{L})(?:(?:encyklik|adhortacj|homili|przemówie|katechez|nauczani|pism|dzieł|pielgrzymk|pontyfikat|rozdz|tren|pieśn|wizyt|rocznic|kazani|cytat|myśl|tryptyk|kanonizacj|wypowied|biografi|poezj|życi|śmier|teologi|ciał|puchar|memoriał|medal|częś|odcin|przystan|pokoj|pokój|tekst|zebran|ranking|edycj|wybor|pamię|modlitw|książ|księg)\p{L}*|list(?:y|u|em|ów|ach)?|tom(?:u|ie|y|ów)?|sal[aieęą]?|krok(?:u|i|ów)?|t|s|str|poz|art|pkt|nr|cyt|zob|por)\.?[ \t]+$/iu;
const RE_PATRON_STREET_TITLE_HEAD = new RegExp(String.raw`^(?:${PATRON_STREET_TITLES})[ \t]`, 'u');
// Numer lokalu w dopasowaniu („Tomasza Mazura 12/3", „… 12 m. 3") — kształt adresu sam w sobie.
// Rok po ukośniku („12/2020") to sygnatura albo numer pisma.
// Sam ukośnik („Jana Lisa 3/4", „Ocena Tomasza Mazura 3/5", „Zeszyty … 5/1") wygląda tak samo
// jak udział, ocena czy odsyłacz, więc wskazuje adres dopiero z miejscowością za numerem; „m."
// i „lok." wskazują go zawsze (w każdym trybie, także w prozie bez etykiety — patrz street()).
// „m" bez kropki tylko z odstępem przed numerem lokalu: „48 m2", „1200 m2" to powierzchnia, nie lokal.
const RE_PATRON_STREET_FLAT = /[ \t]\d{1,4}[a-zA-Z]?[ \t]*(?:m\.[ \t]*|m[ \t]+|lok\.[ \t]*|lokalu?[ \t]*)\d{1,3}[a-zA-Z]?$/i;
const RE_PATRON_STREET_SLASH = /[ \t]\d{1,4}[a-zA-Z]?\/(?!(?:19|20)\d\d(?!\d))\d{1,4}[a-zA-Z]?$/;
// Lokal „m./lok." albo ułamek niewłaściwy („30/2", „14/3") — udział, ocena czy wynik osoby to
// ułamek właściwy („1/2", „4/5", „12/40"), więc numerator większy od mianownika to numer lokalu.
function patronStreetFlatNo(m: string): boolean {
  if (RE_PATRON_STREET_FLAT.test(m)) return true;
  const f = /[ \t](\d{1,4})[a-zA-Z]?\/(\d{1,4})[a-zA-Z]?$/.exec(m);
  return !!f && RE_PATRON_STREET_SLASH.test(m) && +f[1] > +f[2];
}
// Etykieta adresu albo zamieszkania tuż przed ulicą („Adres: Jana Pawła II 5", „zamieszkały przy
// Kazimierza Wielkiego 5 w Zalesiu") sama wskazuje adres — bez niej ulica zostawała jawna.
// Rdzenie zamiast wyliczonych końcówek („zamieszkałą przy", „zamieszkuje przy", „położony przy",
// „usytuowany przy", „znajdującej się przy") i „pod adresem".
const RE_PATRON_STREET_RESIDENCE =
  /(?<!\p{L})(?:[Zz]am(?:\.|(?=[ \t]*:))|ZAM(?:\.|(?=[ \t]*:))|(?:[Zz]a)?[Mm]ieszk\p{L}*|(?:ZA)?MIESZK\p{Lu}*|[Zz]ameldowan\p{L}*|ZAMELDOWAN\p{Lu}*|[Pp]ołożon\p{L}*|POŁOŻON\p{Lu}*|[Uu]sytuowan\p{L}*|USYTUOWAN\p{Lu}*|[Zz]najduj\p{L}*(?:[ \t]+się)?|ZNAJDUJ\p{Lu}*(?:[ \t]+SIĘ)?)(?:[ \t]*:|[ \t]+[-–—])?(?:[ \t]+(?:przy|PRZY))?[ \t]*$|(?<!\p{L})(?:[Pp]od[ \t]+[Aa]dresem|POD[ \t]+ADRESEM)[ \t]*:?[ \t]*$|(?<!\p{L})(?:[Zz]a)?[Mm]ieszk(?:a|am|asz|amy|acie|ają|ał\p{L}*|uj\p{L}*)[ \t]+[Nn]a[ \t]+$|(?<!\p{L})(?:(?:[Zz]a|ZA)?(?:[Mm]ieszk(?:a|am|ają|ając\p{L}*|ał\p{L}*|uj\p{L}*)|MIESZK(?:A|AM|AJĄ|AJĄC\p{Lu}*|AŁ\p{Lu}*|UJ\p{Lu}*))|[Zz]amieszk\p{L}*|ZAMIESZK\p{Lu}*|[Zz]am\.|ZAM\.)[ \t]+(?:we?|WE?)[ \t]+\p{Lu}\p{L}+(?:[ \t-]\p{Lu}\p{L}+)?[ \t]*,[ \t]*$/u;
// Przedostatnia alternatywa: „mieszka na Jana Pawła II 30/2" — tylko czasownik i imiesłów, bo
// „mieszkanie na Jana Kowalskiego 1/2" to przepisanie udziału na osobę, nie adres. Ostatnia:
// miejscowość po „zamieszkały w" i przecinek przed ulicą („zamieszkały w Lubniu, Jana Pawła II
// 30/2"). Etykiety także WERSALIKAMI („ZAM.", „ZAMIESZKAŁY:") — w nagłówkach pism i protokołach
// ulica z patronem zostawała jawna.
// Etykieta także WERSALIKAMI („ADRES DO DORĘCZEŃ:"), z numerem pola („Adres 2:"), z myślnikiem
// zamiast dwukropka („Adres do doręczeń - ") i sama „Korespondencja:" albo „Doręczyć:".
const RE_PATRON_STREET_LABEL =
  /(?<!\p{L})(?:(?:[Aa]dres\p{L}*|ADRES\p{Lu}*|[Kk]orespondencj\p{Ll}*|KORESPONDENCJ\p{Lu}*|[Dd]oręczyć|DORĘCZYĆ)(?:[ \t]+(?:\p{Ll}+|\p{Lu}+|\d{1,2})){0,3}(?:[ \t]*:|[ \t]+[-–—]))[ \t]*$/u;
// Klucz adresu w logu albo JSON-ie tuż przed wartością, z miejscowością przed ulicą w tej samej
// wartości („street="Jana Pawła II 5/2"", „adres=Jana Pawła II 5/2", „"partyAddress":"Lubień, Jana
// Pawła II 30/2""). Pod kluczem spoza STRUCT_KEYS („partyAddress") i w zapisie klucz=wartość
// (passStructured zna tylko JSON i XML) ulica zostawała jawna. Bez adresata, adresu IP, MAC i poczty.
// Klucz z numerem pola („addressLine1", „address_line_1", „adres2") też.
const RE_PATRON_STREET_KEY =
  /(?<![\p{L}\p{N}_])([\p{L}_]*(?:[Ss]treet|STREET|[Aa]ddr(?:ess)?|ADDR(?:ESS)?|[Aa]dres|ADRES|[Uu]lic[ay]|ULIC[AY])[\p{L}\p{N}_]*)["']?[ \t]*[:=][ \t]*["']?(?:\p{Lu}\p{Ll}+(?:[ \t-]\p{Lu}\p{Ll}+)?,[ \t]*)?$/u;
const RE_PATRON_STREET_KEY_NOT = /adresat|(?:ip|mac|e?mail|web|url|wallet|server|host)_?addr/i;
const patronStreetKeyBefore = (before: string): boolean => {
  const k = RE_PATRON_STREET_KEY.exec(before)?.[1];
  return !!k && !RE_PATRON_STREET_KEY_NOT.test(k);
};
// Komórka tabeli CSV/TSV, w której stoi SAMA ulica z numerem lokalu, a w sąsiedniej komórce
// miejscowość („"Jana Pawła II 5/2","Lubień"", „Lubień⇥Jana Pawła II 5/2⇥…"). Tylko tabulator,
// średnik albo przecinek między cudzysłowami: przecinek w prozie („Oceny: Jana Kowalskiego 3/5,
// Anny Nowak 4/5") nie jest granicą komórki.
// Goły przecinek bez odstępu za nim („Halyna Roman,hroman,,Jana Pawła II 5/2,Lubień") też, ale
// tylko w wierszu, który wygląda na CSV: co najmniej dwa takie przecinki i żadnego „, " jak w prozie.
// Za „miejscowość" uchodzi też komórka z kodem pocztowym (eksport AD/CRM: Street, PostalCode, City).
// Osoba z udziałem, oceną czy wynikiem („"Udział";"Adama Nowaka 1/2";"Kraków"", „1,Jana Nowaka 4/5,
// Kraków" pod nagłówkiem „Ocena") ma ułamek właściwy, więc nie przechodzi — patrz patronStreetFlatNo.
// Rola w innej komórce wiersza („Współwłaściciel;Adam Nowak;…") niczego tu nie przesądza.
const RE_PATRON_CELL_BEFORE = /(?:(?:^|[\r\n\t;,])"|[\t;]|^|[\r\n])$/;
const RE_PATRON_CELL_AFTER = /^(?:"(?=[\t;,]|\r?\n|$)|(?=[\t;]))/;
const RE_PATRON_CELL_PLACE = /^"?\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?"?$/u;
const RE_PATRON_CELL_POSTAL = /^"?(?:\d{2}-\d{3}|\[KOD-POCZTOWY\])"?$/;
// Słowo udziału, oceny albo nagrody na miejscu miejscowości (patrz patronStreetCityLead).
const RE_PATRON_CELL_NOT =
  /^(?:udzia\p{L}*|współwłaściciel\p{L}*|właściciel\p{L}*|spadk\p{L}*|nagrod\p{L}*|wyróżnieni\p{L}*|ocen\p{L}*|wynik\p{L}*|punkt\p{L}*|głos\p{L}*|stypend\p{L}*|część|części)$/iu;
function patronStreetCell(before: string, tail: string): boolean {
  const lineStart = before.lastIndexOf('\n') + 1;
  const lineEnd = tail.search(/\r?\n|$/);
  const line = before.slice(lineStart) + '\u0000' + tail.slice(0, lineEnd);
  let pre = RE_PATRON_CELL_BEFORE.exec(before)?.[0];
  let post = RE_PATRON_CELL_AFTER.exec(tail)?.[0];
  if ((line.match(/,(?![ \t])/g)?.length ?? 0) >= 2 && !/,[ \t]/.test(line)) {
    if (pre === undefined && /,$/.test(before)) pre = ',';
    if (post === undefined && (/^,/.test(tail) || lineEnd === 0)) post = '';
  }
  if (pre === undefined || post === undefined || pre.endsWith('"') !== post.startsWith('"')) return false;
  // sąsiednia komórka: następna (za separatorem) albo poprzednia (przed separatorem)
  const next = /^[\t;,]([^\t;,\r\n]*)/.exec(tail.slice(post.length))?.[1];
  const prev = /(?:^|[\t;,\r\n])([^\t;,\r\n]*)[\t;,]$/.exec(pre.endsWith('"') ? before.slice(0, -1) : before)?.[1];
  const place = (c: string | undefined): boolean =>
    !!c && (RE_PATRON_CELL_POSTAL.test(c.trim()) || (RE_PATRON_CELL_PLACE.test(c.trim()) && !isFirstNameLike(c.replace(/"/g, '').trim())));
  return place(next) || place(prev);
}
// Blok koperty bez kodu pocztowego: imię i nazwisko w wierszu wyżej, ulica z numerem w osobnym
// wierszu, a pod nią sama miejscowość („Jan Nowak⏎Jana Pawła II 5/2⏎Lubień").
const RE_PATRON_ENVELOPE_PREV =
  /(?:^|\n)[ \t]*((?:(?:Pan|Pani|PAN|PANI)[ \t]+)?\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?[ \t]+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)[ \t]*\r?\n[ \t]*$/u;
const RE_PATRON_ENVELOPE_NEXT = /^[ \t]*\r?\n[ \t]*(\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?)[ \t]*(?:\r?\n|$)/u;
function patronStreetEnvelope(before: string, tail: string): boolean {
  const prev = RE_PATRON_ENVELOPE_PREV.exec(before)?.[1];
  const next = RE_PATRON_ENVELOPE_NEXT.exec(tail)?.[1];
  return !!prev && !!next && personPairBeforeAddr(prev) && !isFirstNameLike(next.split(/[ -]/)[0]);
}
// Miejscowość na początku wiersza i przecinek przed ulicą („Lubień, Jana Pawła II 30/2") — ze
// słownika albo z numerem lokalu w ulicy; bez udziału, oceny czy imienia przed przecinkiem.
const RE_PATRON_CITY_LEAD = /(?:^|[\r\n])[ \t]*(\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?)[ \t]*,[ \t]*$/u;
// Bez liczby rzymskiej (tę rozstrzyga RE_PATRON_STREET_ROMAN) tylko z lokalem „m./lok." albo
// z ułamkiem niewłaściwym („30/2"): „Lublin, Adama Nowaka 1/2" pod „Spadkobiercy:" i „Kraków,
// Jana Kowalskiego 12" w protokole głosowania to osoba z udziałem albo liczbą głosów.
function patronStreetCityLead(before: string, m: string): boolean {
  const c = RE_PATRON_CITY_LEAD.exec(before)?.[1];
  if (!c || isFirstNameLike(c.split(/[ -]/)[0]) || RE_PATRON_CELL_NOT.test(c)) return false;
  return patronStreetFlatNo(m);
}
// Komórka z samą ulicą z patronem pod nagłówkiem ulicy albo adresu („Ulica⇥Nr⏎Jana Pawła II⇥12"):
// numer stoi w sąsiedniej kolumnie, więc pozostałe wzorce (numer domu tylko z tej samej komórki) jej
// nie widzą, a para nie jest już osobą. O adresie przesądza nagłówek kolumny — najwyższy wiersz
// bloku wierszy z tym samym separatorem — albo etykieta adresu w poprzedniej komórce („Adres:⇥Jana
// Pawła II⇥12"). Maska obejmuje samą komórkę ulicy; numer w swojej kolumnie zostaje.
const RE_PATRON_STREET_CELL = new RegExp(String.raw`(?<=^|[\r\n\t;])${PATRON_STREET_HEAD_SRC}(?= *(?:[\t;]|\r?\n|$))`, 'gu');
const RE_STREET_HEADER_NAME = /^[ \t]*"?(?:ulica|ul\.|adres\p{L}*|street|address)(?:[ \t]+(?:i[ \t]+)?(?:nr|numer)\p{L}*\.?)?"?[ \t]*$/iu;
function streetHeaderAbove(t: string, offset: number): boolean {
  const ls = t.lastIndexOf('\n', offset - 1) + 1;
  const pre = t.slice(ls, offset);
  const le = t.indexOf('\n', offset);
  const row = t.slice(ls, le < 0 ? t.length : le);
  const delim = row.includes('\t') ? '\t' : row.includes(';') ? ';' : '';
  if (!delim || ls === 0) return false;
  const col = pre.split(delim).length - 1;
  let top = ls;
  for (let n = 0; n < 50 && top > 0; n++) {
    const ps = t.lastIndexOf('\n', top - 2) + 1;
    const line = t.slice(ps, top - 1);
    if (!line.trim() || !line.includes(delim)) break;
    top = ps;
  }
  if (top === ls) return false;
  const name = t.slice(top, t.indexOf('\n', top)).replace(/\r$/, '').split(delim)[col];
  return name !== undefined && RE_STREET_HEADER_NAME.test(name);
}
// Samo „przy" przed ulicą z numerem („Nieruchomość przy Tadeusza Kościuszki 5") — o ile przed nim
// nie stoi instytucja („Urząd Gminy przy Jana Pawła II 5" to siedziba urzędu).
const RE_PATRON_STREET_PRZY = /(?<!\p{L})(?:[Pp]rzy|PRZY)[ \t]+$/u;
// Koperta WERSALIKAMI: „DO" na początku wiersza (albo po etykiecie), za numerem koniec wiersza,
// przecinek albo „W <MIEJSCOWOŚĆ>" („DO ADAMA MICKIEWICZA 5"). Kwota, data czy liczba egzemplarzy
// za odbiorcą („PISMO DO ANNY KOWALSKIEJ 2 EGZ.", „DECYZJA DO MARII WIŚNIEWSKIEJ 3") to osoba.
const RE_PATRON_STREET_CAPS_DO = /(?:^|\n)(?:[ \t]*|[^\n]*:[ \t]*)DO[ \t]+$/u;
const RE_PATRON_STREET_CAPS_DO_END = /^(?:[ \t]*(?:,|\r?\n|$)|[ \t]+W[ \t]+\p{Lu}{2,})/u;
// Skrót albo wyraz uliczny tuż przed patronem z numerem („al. Jana Pawła II nr 5", „ulicy Tadeusza
// Kościuszki 5") — ulica z numerem w całości. Główny przebieg ulic nie zna wariantu z „nr" między
// nazwą a numerem i zostawiał go jawnego.
const RE_PATRON_STREET_WORD_BEFORE =
  /(?<!\p{L})(?:(?:ul|al|pl|os)\.[ \t]*|(?:ulic[aęyą]|alej[aęą]|alei|plac(?:u|em)?|osiedl(?:e|a|u)|rond(?:o|a|zie)|skwer(?:u|ze)?)[ \t]+)(?:(?:im\.|imienia)[ \t]*)?$/iu;
// Osoba, a za nią myślnik, średnik albo nawias z adresem („Anna Kowalska – Jana Pawła II 5",
// „Jan Nowak (Jana Pawła II 5)").
const RE_PATRON_STREET_PERSON_SEP = /[ \t]*(?:[–—;(]|[ \t]-)[ \t]*$/u;
// Patron kaplicy czy kościoła („Kaplica św. Jana Pawła II 2") i siedziba urzędu albo instytucji
// tuż przed adresem („w Urzędzie Gminy, Jana Pawła II 5, Kraków") to nie adres osoby.
const RE_PATRON_STREET_SAINT_BEFORE = /(?<!\p{L})(?:św|bł|ks|abp|bp)\.[ \t]*$|(?<!\p{L})święt\p{L}*[ \t]+$/iu;
// Sam „dom" tuż przed ulicą („DOM PRZY STANISŁAWA WYSPIAŃSKIEGO 5", „dom przy …") to budynek, nie
// instytucja jak „Dom Kultury przy …".
const RE_PUBLIC_FACILITY_WORD =
  /^(?:aptek\p{L}*|przychodni\p{L}*|hal[aięą]|sal[aięą]|parking\p{L}*|stadion\p{L}*|basen\p{L}*|boisk\p{L}*|kin[oaie]|kinie|poczt\p{L}*|bibliotek\p{L}*|muze\p{L}*|szpital\p{L}*|klinik\p{L}*|hospicj\p{L}*|przedszkol\p{L}*|żłob\p{L}*|liceum|gimnazj\p{L}*|hotel\p{L}*|dworz?c\p{L}*|targowisk\p{L}*|pawilon\p{L}*|cmentarz\p{L}*|kaplic\p{L}*|plebani\p{L}*|remiz\p{L}*|pływalni\p{L}*|lodowisk\p{L}*|zdrowia)$/u;
function institutionBeforeAddr(before: string): boolean {
  const ws = before.replace(/[ \t]*,[ \t]*$/, '').split(/[ \t]+/).slice(-4);
  const lastIdx = ws[ws.length - 1] === '' ? ws.length - 2 : ws.length - 1;
  // Obiekt publiczny liczymy tylko w BIEŻĄCYM wierszu, ale w każdym wierszu pisma: dzielenie po
  // [ \t]+ sklejało „otwarcia:⏎APTEKA" w jeden wyraz i obiekt poza pierwszym wierszem odpadał.
  const nl = before.lastIndexOf('\n');
  if (nl !== -1) {
    const lws = before.slice(nl + 1).replace(/[ \t]*,[ \t]*$/, '').split(/[ \t]+/).slice(-4);
    if (lws.some((w) => RE_PUBLIC_FACILITY_WORD.test(w.toLowerCase()))) return true;
  }
  return ws.some((w, i) => {
    const l = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (l === 'dom' && i === lastIdx) return false;
    return (
      (LEGAL_ENTITY_WORDS.has(l) && !ADDR_PLACE_ADJ_OK.has(l)) ||
      ORG_HEAD_WORDS.has(l) ||
      /^(?:urzęd|starostw|szkol(?!eni)|szkoł|parafi|kości|sąd|komend|ośrod)/.test(l) ||
      // obiekt publiczny („APTEKA PRZY TADEUSZA KOŚCIUSZKI 12", „Hala sportowa przy …", „Parking
      // przy Jana Pawła II 30") — adres obiektu, nie osoby. Tylko goły wyraz w tym samym wierszu:
      // „(sala gimnastyczna)⏎Miejsce szkolenia: Kraków, …" to dopisek do poprzedniego adresu.
      (RE_PUBLIC_FACILITY_WORD.test(l) && /^\p{L}+$/u.test(w) && !ws.slice(i + 1).some((x) => x.includes('\n')))
    );
  });
}
/**
 * Czy tuż przed ulicą stoi osoba WERSALIKAMI („JAN NOWAK ", „PRZELEW OD: STEFAN GÓRSKI ", „NOWAK
 * JAN⇥")? Jedno imię w mianowniku ze słownika i drugi wyraz w kształcie nazwiska.
 */
function capsPersonPairBefore(before: string): boolean {
  const mm = /(?:^|[^\p{L}])(\p{Lu}{2,}(?:-\p{Lu}{2,})?) +(\p{Lu}{2,}(?:-\p{Lu}{2,})?)[ \t]*$/u.exec(before);
  if (!mm) return false;
  const [a, b] = [mm[1].toLowerCase(), mm[2].toLowerCase()];
  const nom = (w: string): boolean => POLISH_FIRST_NAMES.has(w) && !isFirstNameGenitive(w);
  const sur = (w: string): boolean => !isFirstNameLike(w) && !LEGAL_ENTITY_WORDS.has(w) && (!!surnameBase(w) || looksLikeSurname(w));
  return (nom(a) && sur(b)) || (sur(a) && nom(b));
}
function patronStreetWithNumber(ctx: RedactCtx): void {
  // Kolejna ulica w wyliczeniu za zamaskowanym adresem („Mieszkańcy [ADRES] i Jana Pawła II 7").
  const reEnum = new RegExp(String.raw`${escapeRe(ctx.M.ADRES)}[ \t]*(?:,|i|oraz)[ \t]+$`, 'u');
  // `mode`: „loose" — za numerem dalszy ciąg zdania małą literą; „ctx" — dowolny ciąg, ale tylko
  // po etykiecie adresu, zamieszkania albo „przy".
  const street0 = (m: string, w1: string, wMid: string | undefined, w2: string, offset: number, t: string, mode: '' | 'loose' | 'ctx' | 'roman' | 'fallback' = ''): string | null => {
    const loose = mode !== '';
    const a = w1.toLowerCase();
    const b = w2.toLowerCase().split('-')[0];
    if (!isFirstNameGenitive(a) && !egoNameGenitive(a)) return null;
    // Drugie imię patrona spoza słownika („Konstantego Ildefonsa Gałczyńskiego 4 lokal 2") — tylko
    // z numerem lokalu, który sam przesądza o adresie.
    const mid = wMid?.toLowerCase();
    if (mid !== undefined && !isFirstNameGenitive(mid) && !egoNameGenitive(mid) && !(RE_PATRON_STREET_FLAT.test(m) && /(?:a|ego|i|y)$/.test(mid))) return null;
    if (!(isFirstNameGenitive(b) || egoNameGenitive(b) || RE_SURNAME_OBLIQUE.test(b) || /(?:a|ego|ej|i|y)$/.test(b))) return null;
    const before = t.slice(Math.max(0, offset - 60), offset);
    // Patron instytucji („Szkoła Podstawowa im. Jana Pawła II 3, Kraków", „Nagroda im. Jana
    // Kochanowskiego 2023") i rok zamiast numeru domu („dla Jana Kowalskiego 2023, Warszawa") to
    // nie adres. Rok bez lokalu odrzucamy: numer domu 1900–2099 jest rzadszy niż data.
    if ((/(?<!\p{L})(?:im\.|imienia)[ \t]*$/u.test(before) && !RE_PATRON_STREET_WORD_BEFORE.test(before)) || /[ \t](?:1[89]|20)\d\d$/.test(m)) return null;
    // Numer z rokiem po ukośniku („Rondo Adama Mickiewicza 3/2025" — uchwała, sygnatura) i godzina
    // („RONDO ADAMA MICKIEWICZA 10:00") to nie numer domu ani lokalu.
    if (/\/(?:19|20)\d\d$/.test(m) || /^:\d/.test(t.slice(offset + m.length, offset + m.length + 2))) return null;
    if (RE_PATRON_STREET_SAINT_BEFORE.test(before) || (/,[ \t]*$/.test(before) && institutionBeforeAddr(before))) return null;
    const tail = t.slice(offset + m.length, offset + m.length + 50);
    // Data, jednostka albo krotność za numerem („… 5 egz.", „… 5 razy") i głowa nazwy obiektu tuż
    // przed patronem („Pomnik Jana Pawła II 3, Kraków", „Kaplica …", „Konkurs …") — to nie adres.
    // „Dom" bywa zwykłym domem osoby, więc nie przesądza.
    if (RE_PATRON_NUM_UNIT_AFTER.test(tail)) return null;
    const headW = /(\p{L}+) +$/u.exec(before)?.[1]?.toLowerCase();
    if (headW && headW !== 'dom' && PATRON_GEN_HEADS.has(headW)) return null;
    // Numer lokalu „m."/„lok." sam wskazuje adres — w każdym trybie, także w prozie bez etykiety
    // („Lokator Adama Mickiewicza 30 m. 2 zalega z czynszem", „… 5 m. 3 (powód …)"). Dawniej para
    // przestawała być osobą, a adres nie powstawał, więc ulica z lokalem zostawała jawna w całości.
    if (RE_PATRON_STREET_FLAT.test(m)) {
      ctx.bump('ADRES');
      return ctx.M.ADRES;
    }
    // Etykieta adresu, zamieszkania albo „przy" wygrywa z udziałem na początku zdania („Udziały
    // w lokalu przy Jana Pawła II 12/4 należą …" — ułamek to numer lokalu).
    // Klucz adresu w logu albo JSON-ie i komórka tabeli obok miejscowości (z lokalem) — patrz
    // RE_PATRON_STREET_KEY i patronStreetCell; blok koperty i miejscowość przed przecinkiem — patrz
    // patronStreetEnvelope i patronStreetCityLead (tylko z ulicą na końcu wiersza albo zdania: za
    // „Kraków, Jana Kowalskiego 3 lata temu" stoi dalszy ciąg zdania, nie adres).
    if (
      RE_PATRON_STREET_LABEL.test(before) ||
      RE_PATRON_STREET_RESIDENCE.test(before) ||
      patronStreetKeyBefore(before) ||
      (patronStreetFlatNo(m) && patronStreetCell(before, t.slice(offset + m.length, offset + m.length + 50))) ||
      (mode === '' && (patronStreetEnvelope(before, t.slice(offset + m.length, offset + m.length + 50)) || patronStreetCityLead(before, m))) ||
      (RE_PATRON_STREET_PRZY.test(before) && !institutionBeforeAddr(before.replace(RE_PATRON_STREET_PRZY, ''))) ||
      (w1 === w1.toUpperCase() && RE_PATRON_STREET_CAPS_DO.test(before) && RE_PATRON_STREET_CAPS_DO_END.test(tail)) ||
      // WERSALIKI: osoba tuż przed ulicą z patronem i numerem („JAN NOWAK ADAMA MICKIEWICZA 30
      // KRAKÓW", „PRZELEW OD: STEFAN GÓRSKI JÓZEFA PIŁSUDSKIEGO 101 ŁÓDŹ") — wyciąg bankowy, adres osoby
      (w1 === w1.toUpperCase() && w1.length > 1 && (capsPersonPairBefore(before) || RE_PERSON_MASK_BEFORE.test(before))) ||
      // „NA ROGU ADAMA MICKIEWICZA 30" WERSALIKAMI — skrzyżowanie ulic (zapis mieszany „na rogu …"
      // w prozie prasowej zostaje jak w v0.46.23)
      (w1 === w1.toUpperCase() && /(?<!\p{L})NA[ \t]+ROGU[ \t]+$/u.test(before)) ||
      RE_PATRON_STREET_WORD_BEFORE.test(before) ||
      reEnum.test(before)
    ) {
      ctx.bump('ADRES');
      return ctx.M.ADRES;
    }
    // Patron z liczbą rzymską — patrz RE_PATRON_STREET_ROMAN; bez instytucji przed nim („Parafia
    // Jana Pawła II 5") i bez klucza adresu IP czy adresata. Rok („… 1978-2005") to nie numer domu,
    // a wyraz tuż przed patronem („Encyklika …", „Treny …", „rozdz. …") — odsyłacz (patrz
    // RE_PATRON_ROMAN_BOUNDARY). Zakres numerów („Kraków, Jana Pawła II 12-14") to adres.
    // „fallback" — ostatni przebieg (inwariant I1): para „imię + dopełniacz" z numerem domu, z której
    // adres nie powstał, nie może zostać jawna w całości. Para, którą zamaskuje przebieg osób
    // (nazwisko: „Tadeusza Kościuszki 30 w Krakowie."), zostaje dla niego; tu tylko patron z liczbą
    // rzymską („Jana Pawła II 5/2 Kraków", „Adam Nowak|Jana Pawła II 5|Kraków") i dwa imiona
    // („Jana Pawła 12/4"), których przebieg osób nie bierze. Dostają maskę osoby jak w v0.46.23,
    // a liczba rzymska i numer zostają.
    if (mode === 'roman' || mode === 'fallback') {
      // wyraz z wielkiej litery za numerem tylko jako miejscowość ze słownika
      const cityAfter = mode === 'roman' ? /^ +(\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?) *(?:[,;|\t]|\r?\n|$)/u.exec(tail) : null;
      if (cityAfter && !POLISH_CITIES.has(cityAfter[1].toLowerCase())) return null;
      const k = RE_PATRON_STREET_KEY.exec(before)?.[1];
      if ((k && RE_PATRON_STREET_KEY_NOT.test(k)) || institutionBeforeAddr(before)) return null;
      if (/(?<!\d)(?:1[89]|20)\d\d(?!\d)/.test(m)) return null;
      // odsyłacz w poprzedniej komórce („Pielgrzymka,Jana Pawła II 2 Kraków,1979", „| Pielgrzymka |
      // Jana Pawła II 2 Kraków |") to opis wydarzenia, nie adres — dalej jak w v0.46.23 (osoba)
      const refCell = RE_PATRON_ROMAN_REF_BEFORE.test(before.replace(/[ \t]*[,;|\t][ \t]*$/, ' '));
      if (mode === 'roman' && ((RE_PATRON_ROMAN_BOUNDARY.test(before) && !refCell) || personPairBeforeAddr(before))) {
        ctx.bump('ADRES');
        return ctx.M.ADRES;
      }
      const roman = / [IVX]{1,4} /.test(m);
      // wyraz uliczny przed patronem („Rondo Jana Pawła II 2 km", „Alei …") — nazwa ulicy, nie osoba
      if (RE_PATRON_ROMAN_REF_BEFORE.test(before) || (headW && RE_STREET_WORD.test(headW)) || !ctx.on('IMIE') || !(roman || isFirstNameLike(w2))) return null;
      const pairEnd = m.indexOf(w2) + w2.length;
      ctx.bump('IMIE');
      return ctx.personMask(w2) + m.slice(pairEnd);
    }
    if (mode === 'ctx') return null;
    // Ułamek po udziale albo spadku („Udział Tomasza Mazura 1/3") to część prawa, nie numer lokalu.
    if (/[ \t]\d{1,4}\/\d/.test(m) && RE_SHARE_BEFORE.test(before)) return null;
    // „… 15/2 to adres korespondencyjny" — zdanie samo nazywa ulicę adresem.
    if (loose) {
      if (!/^[ \t]+(?:to|jest)[ \t]+adres/u.test(tail)) return null;
      ctx.bump('ADRES');
      return ctx.M.ADRES;
    }
    // Ułamek właściwy przed gołym przecinkiem CSV („1,Jana Nowaka 4/5,Kraków" pod nagłówkiem „Ocena")
    // to ocena, wynik albo udział osoby, nie numer lokalu.
    if (RE_PATRON_STREET_SLASH.test(m) && !patronStreetFlatNo(m) && /^,(?![ \t])/.test(tail)) return null;
    // Opis bibliograficzny („Poezje Adama Mickiewicza 2, Warszawa 1955.", „Nauczanie Jana Pawła II 4,
    // Kraków 2005.", „Psalmy Jana Kochanowskiego 3, Lublin."): tytuł dzieła przed autorem albo rok
    // wydania za miejscem — numer to tom, a miasto to miejsce wydania, nie adres.
    if (
      (headW && (RE_CAPS_WORK_HEAD.test(headW) || RE_PATRON_ROMAN_REF_BEFORE.test(`${headW} `))) ||
      /^[ \t]*,[ \t]*\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?[ \t]+(?:1[5-9]|20)\d\d(?!\d)/u.test(tail)
    )
      return null;
    const after = RE_ADDR_CITY_AFTER.exec(tail);
    // Kod pocztowy za przecinkiem bywa już maską („…14, [KOD-POCZTOWY] Busko"), a etykieta
    // zamieszkania tuż przed ulicą („zam. Jana Pawła II 14, Busko") sama wskazuje adres.
    const cityOk =
      (!!after && (!!after[1] || (!!after[2] && POLISH_CITIES.has(after[2].toLowerCase())))) ||
      // kod pocztowy w następnym wierszu bloku adresowego („Anna Kowalska⏎Jana Pawła II 5⏎25-001 Kielce")
      /^[ \t]*(?:,[ \t]*|\r?\n[ \t]*)(?:\d{2}-\d{3}|\[KOD-POCZTOWY\])/.test(tail);
    // Tytuł patrona („Do Pani Anny Lis, Marszałka Józefa Piłsudskiego 5/3 w Kielcach") i ukośnik
    // (lokal „m."/„lok." rozstrzyga wyżej) — dopiero z miejscowością za numerem: bez niej to
    // też ocena, liczba godzin czy udział osoby („Ocena Tomasza Mazura 3/5", „Prof. Jana Nowaka 30",
    // „Pismo Generała Władysława Andersa 1."), a maska adresu zjadała wtedy liczbę, tytuł
    // i pseudonim osoby.
    if ((RE_PATRON_STREET_TITLE_HEAD.test(m) || RE_PATRON_STREET_SLASH.test(m)) && (cityOk || /^[ \t]+we?[ \t]+\p{Lu}/u.test(tail))) {
      ctx.bump('ADRES');
      return ctx.M.ADRES;
    }
    const sepPerson = RE_PATRON_STREET_PERSON_SEP.exec(before);
    if (sepPerson && personPairBeforeAddr(before.slice(0, sepPerson.index))) {
      ctx.bump('ADRES');
      return ctx.M.ADRES;
    }
    if (!cityOk && !personPairBeforeAddr(before)) return null;
    ctx.bump('ADRES');
    return ctx.M.ADRES;
  };
  // Adres z wyrazem ulicznym tuż przed nim dostaje znacznik, żeby skrót („al.", „ulicy") wszedł do
  // maski — tylko adres z tego przebiegu, nie dosłowne „[ADRES]" z wejścia (idempotencja).
  const MARK = '\uE0F1';
  const street = (m: string, w1: string, wMid: string | undefined, w2: string, offset: number, t: string, mode: '' | 'loose' | 'ctx' | 'roman' | 'fallback' = ''): string | null => {
    const r = street0(m, w1, wMid, w2, offset, t, mode);
    return r === ctx.M.ADRES && RE_PATRON_STREET_WORD_BEFORE.test(t.slice(Math.max(0, offset - 60), offset)) ? MARK + r : r;
  };
  ctx.text = ctx.text.replace(RE_PATRON_STREET_NO, (m, w1: string, wMid: string | undefined, w2: string, offset: number, t: string) => {
    const r = street(m, w1, wMid, w2, offset, t);
    if (r !== null) return r;
    // Trzy wyrazy, z których pierwszy nie jest imieniem patrona („Anna Kowalska Jana Pawła II 5"):
    // ulicą może być para od drugiego wyrazu — dopasowanie nie może jej pochłonąć.
    if (wMid === undefined) return m;
    const idx = m.indexOf(wMid, m.indexOf(w1) + w1.length);
    const r2 = street(m.slice(idx), wMid, undefined, w2, offset + idx, t);
    return r2 === null ? m : m.slice(0, idx) + r2;
  });
  ctx.text = ctx.text.replace(RE_PATRON_STREET_CELL, (m, w1: string, wMid: string | undefined, _w2: string, offset: number, t: string) => {
    const a = w1.toLowerCase();
    if (!(isFirstNameGenitive(a) || egoNameGenitive(a)) || (wMid !== undefined && !isFirstNameGenitive(wMid.toLowerCase()))) return m;
    const before = t.slice(Math.max(0, offset - 60), offset);
    if (!streetHeaderAbove(t, offset) && !RE_PATRON_STREET_LABEL.test(before) && !RE_PATRON_STREET_RESIDENCE.test(before) && !patronStreetKeyBefore(before)) return m;
    ctx.bump('ADRES');
    return ctx.M.ADRES;
  });
  for (const [re, mode] of [
    [RE_PATRON_STREET_NO_LOOSE, 'loose'],
    [RE_PATRON_STREET_NO_CTX, 'ctx'],
    [RE_PATRON_STREET_CAPS, 'ctx'],
    [RE_PATRON_STREET_ROMAN, 'roman'],
    [RE_PATRON_STREET_NO_CTX, 'fallback'],
  ] as const) {
    ctx.text = ctx.text.replace(re, (m, w1: string, wMid: string | undefined, w2: string, offset: number, t: string) => {
      const r = street(m, w1, wMid, w2, offset, t, mode);
      if (r !== null || wMid === undefined) return r ?? m;
      const idx = m.indexOf(wMid, m.indexOf(w1) + w1.length);
      const r2 = street(m.slice(idx), wMid, undefined, w2, offset + idx, t, mode);
      return r2 === null ? m : m.slice(0, idx) + r2;
    });
  }
  // Skrót albo wyraz uliczny przed adresem z patronem należy do adresu („al. [ADRES]" → „[ADRES]"),
  // jak w głównym przebiegu ulic — patrz RE_PATRON_STREET_WORD_BEFORE.
  ctx.text = ctx.text.replace(new RegExp(RE_PATRON_STREET_WORD_BEFORE.source.replace(/\$$/, '') + MARK, 'giu'), '').replaceAll(MARK, '');
}
function passAddressAfterResidenceLabel(ctx: RedactCtx): void {
  if (!ctx.on('ADRES')) return;
  patronStreetWithNumber(ctx);
  ctx.text = ctx.text.replace(
    RE_ADDR_AFTER_LABEL,
    (m, strong: string | undefined, weak: string | undefined, sep: string, city: string | undefined, csep: string | undefined, street: string, _sp: string, num: string, offset: number, t: string) => {
      const w0 = street.split(/[ \t]/)[0].toLowerCase().replace(/\.$/, '');
      if (ADDR_LABEL_VALUE_STOP.has(w0) || (LEGAL_ENTITY_WORDS.has(w0) && !ADDR_PLACE_ADJ_OK.has(w0))) return m;
      if (/^(?:19|20)\d{2}$/.test(num)) return m;
      const flat = /[/-]|m\.|lok\.|[ \t]m[ \t]*\d/.test(num);
      if (weak) {
        const after = RE_ADDR_CITY_AFTER.exec(t.slice(offset + m.length, offset + m.length + 50));
        const cityOk = (city && POLISH_CITIES.has(city.toLowerCase())) || after?.[1] || (after?.[2] && POLISH_CITIES.has(after[2].toLowerCase()));
        if (!flat && !cityOk) return m;
      } else if (!strong) return m;
      ctx.bump('ADRES');
      return `${strong ?? weak}${sep}${city ?? ''}${csep ?? ''}${ctx.M.ADRES}`;
    },
  );
}

function passAddress(ctx: RedactCtx): void {
  if (!ctx.on('ADRES')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      // każda litera skrótu case-insensitive — łapie też WERSALIKI ze skanów/OCR („UL. KWIATOWA 5",
      // „AL. JANA PAWŁA II 12"). Bez tego adres OSOBY zapisany WERSALIKAMI wyciekał (case-sensitive „ul.").
      // „Aleje/Alejach/Aleją" (A. Jerozolimskie) — dawniej tylko liczba pojedyncza i adres był jawny
      `\\b([Uu][lLI1]\\.|[Uu][Ll][Ii][Cc][AaIiYy]|[Aa][Ll]\\.|[Aa][Ll][Ee][IiJj](?:[Aa][Cc][Hh]|[AaIiĘęEeĄą])?|[Oo][Ss]\\.|[Oo][Ss][Ii][Ee][Dd][Ll][EeAaUu]|[Pp][Ll]\\.|[Pp][Ll][Aa][Cc][UuAa]?|` +
        // typy ulic bez skrótu (nazwa własna + numer): „Rondo Dmowskiego 3", „skwer Kościuszki 5".
        // BEZ „park" — częsta nazwa instytucji („Park Narodowy … 2024") dawała FP.
        `[Rr]ond[${PL_LO}]*|[Mm]ost[${PL_LO}]*|[Ss]kwer[${PL_LO}]*|[Bb]ulwar[${PL_LO}]*)` +
        // Po kropkowym „ul." (też OCR „UI."/„U1.") spacja bywa pominięta („zam. ul.Lipowa 14", „UL.LIPOWA
        // 14/3"): dawniej adres wyciekał w całości. Tylko „ul." — „et al.Nature 12", „2 os.Cena 350",
        // „allegro.pl.W 2020" to nie adresy. Dalszy wzorzec i tak wymaga nazwy z wielkiej litery i numeru.
        `(?:\\s+|(?<=\\b[Uu][lLI1]\\.))` +
        // tytuły patrona jak w RE_STREET_EPONYM_TAIL („ul. dra Jana Kowalskiego 12/3", „ul. prof. dr. hab.
        // Jana Nowaka 3", „ul. bł. Karoliny Kózkówny 3") — bez nich adres z takim patronem był cały jawny
        `(?:(?:\\d+|gen|płk|ppłk|mjr|kpt|por|ks|św|bł|bp|abp|kard|marsz|prof|doc|dra|dr|hab|med|lek|n|inż|hr)\\.?\\s+|[A-ZĄĆĘŁŃÓŚŹŻ]\\.\\s+){0,4}` +
        // „r."/„roku" jako człon nazwy: ulice z datą w nazwie („ul. Bitwy Warszawskiej 1920 r. 18",
        // „ul. Ofiar Grudnia 1970 r. 5") — numer domu stoi dopiero po nich
        `[${PL_UP}][${PL_LO}${PL_UP}01.-]*(?:[ \\t]+(?:[${PL_UP}0-9][${PL_LO}${PL_UP}0-9.-]*|r\\.|roku)){0,3}` +
        ADDR_CONNECTOR +
        // blok na osiedlu przed numerem („os. Tysiąclecia bl. 4 m. 3") — bez niego cały adres wyciekał
        `(?:[ \\t]+(?:bl\\.|blok))?` +
        `[ \\t]+${ADDR_HOUSE}${ADDR_UNIT}`,
      'g',
    ),
    function onAddr(m: string, prefix: string, offset: number, str: string): string {
      // Kropka kończąca zdanie po numerze domu („przy ul. Polnej 3. Od 2 lat choruje"): człon nazwy
      // może zaczynać się cyfrą, więc dopasowanie przechodziło na następne zdanie i brało jego liczbę
      // za numer domu. Strażnik ilości oddawał wtedy cały adres jawny. Adres kończy się na kropce.
      const sb = RE_HOUSE_NO_SENTENCE_END.exec(m);
      if (sb) {
        const cut = sb.index + sb[0].length;
        return onAddr(m.slice(0, cut), prefix, offset, str) + m.slice(cut);
      }
      // nowe typy obiektów (rondo/most/skwer/bulwar) + GOŁA 4-cyfrowa liczba 1900–2099 to ROK obiektu
      // („Most Grunwaldzki 1910", „Bulwar Filadelfijski 1998"), NIE numer domu — pomiń. Numer domu z
      // literą/mieszkaniem („Bulwar Nadmorski 10", „Rondo X 12/5") kończy się inaczej → maskowany.
      // Tak samo rok z „r." w środku („Most Grunwaldzki 1910 r. 5 osób przeszło").
      if (/^(?:rond|most|skwer|bulwar)/i.test(prefix) && /[^0-9](?:19|20)\d{2}(?:[ \t]+(?:r\.|roku)[ \t]+\d+)?$/.test(m)) return m;
      // „Smith et al. Nature 2019" — skrót „et al." w cytowaniu, nie aleja
      if (/^al\./i.test(prefix) && /(?<!\p{L})et[ \t]+$/iu.test(str.slice(Math.max(0, offset - 4), offset))) return m;
      // Zapis OCR „UI."/„U1." sklejony z nazwą tylko po etykiecie adresu („zam. UI.LIP0WA 14"): bez
      // niej to notacja techniczna („Zmiana w UI.Panel 2.0", „UI.Dashboard 10 widgetów", „mod.UI.Grid 12").
      if (/^[Uu][I1]\.$/.test(prefix) && !/\s/.test(str[offset + prefix.length] ?? '') && !RE_STRONG_ADDR_LABEL.test(str.slice(Math.max(0, offset - 30), offset))) return m;
      if (RE_ALEJE_PLURAL.test(prefix) && /[ \t](?:19|20)\d{2}$/.test(m)) return m;
      // Goły numer to w istocie DATA: dzień przed miesiącem („z placu Piłsudskiego 11 listopada")
      // albo rok przed „r."/„rok"/zakresem lat („przy ul. Okopowej 1944 r."). Strażnik w callbacku,
      // nie w lookaheadzie — cofanie skróciłoby numer i zostawiło fragment („[ADRES]1 listopada").
      // Po silnej etykiecie adresu („Adres:", „zam.") dzień przed miesiącem dalej jest numerem domu.
      const rest = str.slice(offset + m.length, offset + m.length + 24);
      // Gdy przed dniem/rokiem stoi jeszcze numer domu, maskujemy adres bez daty — dawniej
      // strażnik oddawał całe dopasowanie i jawny zostawał cały adres.
      const beforeDate = (): string => {
        const cut = RE_HOUSE_NO_BEFORE_DATETIME.exec(m) ?? RE_HOUSE_NO_BEFORE_DATE.exec(m);
        if (!cut) return m;
        ctx.bump('ADRES');
        return `${ctx.M.ADRES}${cut[2]}`;
      };
      if (RE_TIME_AFTER.test(rest)) return beforeDate();
      // Silna etykieta adresu albo osoba po etykiecie tuż przed nim — wtedy liczba to numer domu.
      const before = str.slice(Math.max(0, offset - 60), offset);
      const labeled = RE_STRONG_ADDR_LABEL.test(before.slice(-30)) || labeledPersonBeforeAddr(before);
      // „Na skrzyżowaniu ul. Polnej i Leśnej", „na rogu ul. Mickiewicza i Słowackiego" — dwie ulice,
      // a liczba za nimi to liczebnik („… 1 osoba zginęła"), nie numer domu
      if (RE_ADDR_CONNECTOR_I.test(m) && RE_CROSSING_BEFORE.test(before.slice(-24))) return m;
      const hasUnit = RE_ADDR_HAS_UNIT.test(m);
      if (RE_ALEJE_WEAK_LOWER.test(prefix) && !labeled && !hasUnit) return m;
      // Słaby prefiks (łącznik w nazwie, „Aleje") i dalszy ciąg liczby za numerem: grupa tysięcy,
      // ułamek, data, procent („Przebudowa ul. Polnej i Leśnej 250 000,00 zł", „ul. Polna i Leśna
      // 12.01.2026", „Aleje Lipowe 0,8 km", „… 15%") — to kwota albo termin, nie numer domu. Maska
      // zjadała początek liczby („[ADRES] 000,00 zł", „[ADRES].01.2026").
      if (
        !labeled &&
        !hasUnit &&
        (RE_ALEJE_WEAK.test(prefix) || RE_ADDR_CONNECTOR_USED.test(m)) &&
        RE_NUMERIC_TAIL_AFTER.test(rest) &&
        !RE_RESIDENCE_BEFORE.test(before.slice(-30)) &&
        !personPairBeforeAddr(before)
      )
        return m;
      const fieldNext = RE_FIELD_LABEL_AFTER.test(str.slice(offset + m.length, offset + m.length + 48));
      // Goła liczba (albo zakres „2-3") przed rzeczownikiem ilości to liczebnik („przy ul. Długiej 5
      // osób rannych"). Nie po etykiecie adresu i nie z lokalem: „zam. ul. Długa 5 m. 3 lat 45" to
      // adres i wiek — dawniej strażnik oddawał wtedy cały adres jawny.
      // Adres tuż za imieniem i nazwiskiem albo po „mieszka przy" należy do osoby („Jan Kowalski, ul.
      // Leśna 3 osoby", „Dłużnik Jan Kowalski, ul. Leśna 12 miesięcy zalega") — liczba to numer domu,
      // jak po etykiecie; zgodność liczebnika nic tu nie rozstrzyga, „3 osoby" jest gramatyczne.
      // Samo „mieszka przy" nie przy mierze czasu: „Mieszkał w Alejach Ujazdowskich 3 miesiące" to czas.
      const personNear =
        labeled ||
        personPairBeforeAddr(before) ||
        (RE_RESIDENCE_BEFORE.test(before.slice(-30)) && !RE_TIME_QUANTITY_AFTER.test(rest));
      if (/[ \t]\d{1,4}(?:[-–]\d{1,4})?$/.test(m) && !hasUnit && !fieldNext && quantityAfter(m, rest)) {
        if (!personNear) return beforeDate();
        // Po etykiecie pierwsza liczba zostaje numerem domu, ale druga, tuż przed rzeczownikiem
        // ilości, to liczebnik („Adres pobytu: ul. Polna 5 2 osoby" → „[ADRES] 2 osoby").
        if (RE_HOUSE_NO_BEFORE_DATE.test(m)) return beforeDate();
      }
      // „lokal 12" po spacji przed rzeczownikiem ilości to podmiot i liczebnik, nie numer lokalu:
      // maska kończy się na numerze domu, jak przed rozpoznawaniem lokalu zapisanego słowem.
      if (!personNear && !fieldNext && quantityAfter(m, rest)) {
        const tail = RE_SPACE_UNIT_TAIL.exec(m);
        if (tail) {
          ctx.bump('ADRES');
          return ctx.M.ADRES + m.slice(tail.index);
        }
      }
      if (!labeled && /[ \t](?:19|20)\d{2}$/.test(m) && RE_ADDR_CONNECTOR_USED.test(m)) return m;
      // Słaby prefiks (łącznik w nazwie, „Aleje") bez etykiety i lokalu, a za numerem proza: to nie
      // adres, tylko ulice albo miejsce zdarzenia z liczebnikiem. Przed rozpoznawaniem łącznika
      // i „Alejach" takie zdanie zostawało bez zmian, a dawało „Na skrzyżowaniu [ADRES] osoba zginęła".
      if (
        !labeled &&
        !hasUnit &&
        !fieldNext &&
        (RE_ALEJE_WEAK.test(prefix) || RE_ADDR_CONNECTOR_USED.test(m)) &&
        RE_PROSE_AFTER_WEAK.test(rest) &&
        !RE_RESIDENCE_BEFORE.test(before.slice(-30)) &&
        !personPairBeforeAddr(before)
      )
        return m;
      // (też zakres dni: „przy ul. Długiej 1-3 maja" to termin, nie numery domów)
      if (/(?:[ \t]|\d[-–])(?:[1-9]|[12]\d|3[01])$/.test(m) && (RE_MONTH_GEN_AHEAD.test(rest) || RE_MAY_AHEAD.test(rest))) {
        if (RE_HOUSE_NO_BEFORE_DATE.test(m)) return beforeDate();
        if (!labeled) return m;
      }
      // Rok przed „r. nr 18" to wciąż nazwa ulicy z datą („Bitwy Warszawskiej 1920 r. nr 18") — tam
      // strażnik roku nie działa (maska jak dotąd, zamiast odsłonięcia całego adresu).
      if (
        /[ \t](?:19|20)\d{2}$/.test(m) &&
        /^(?:[ \t]*[-–][ \t]*(?:19|20)?\d{2}(?!\d)|[ \t]*r\.|[ \t]+rok)/.test(rest) &&
        !/^[ \t]*(?:r\.|roku)[ \t]+(?:nr\.?[ \t]*)?\d/.test(rest)
      )
        return beforeDate();
      ctx.bump('ADRES');
      return ctx.M.ADRES;
    }
  );
  // 12a') Drugi adres w wyliczeniu tuż za maską („Lokale przy ul. Polnej 5 i Leśnej 7", „zam. ul.
  // Długa 5 i Krótka 7"). Łącznik po numerze domu nie jest członem nazwy (ADDR_CONNECTOR), więc druga
  // ulica z numerem zostawała jawna obok maski. Kotwicą jest maska adresu ze spójnikiem; liczba przed
  // rzeczownikiem ilości, kwotą, godziną czy datą („… i Leśnej 7 dzieci", „… i Leśnej 15 000 zł")
  // zostaje, jak w głównym przebiegu.
  const ADR = escapeRe(ctx.M.ADRES);
  ctx.text = ctx.text.replace(
    new RegExp(
      `(${ADR}[ \\t]+(?:i|oraz)[ \\t]+)[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?(?:[ \\t]+[${PL_UP}][${PL_LO}]+)?` +
        `[ \\t]+${ADDR_HOUSE}${ADDR_UNIT}(?![\\d${PL_LO}${PL_UP}])`,
      'g',
    ),
    (m: string, lead: string, offset: number, str: string) => {
      const rest = str.slice(offset + m.length, offset + m.length + 24);
      if (RE_NUMERIC_TAIL_AFTER.test(rest) || RE_TIME_AFTER.test(rest) || RE_MONTH_GEN_AHEAD.test(rest) || RE_MAY_AHEAD.test(rest)) return m;
      if (quantityAfter(m, rest)) return m;
      const accInstr = RE_SECOND_STREET_ACC_PREP.test(str.slice(Math.max(0, offset - 12), offset));
      if (!secondStreetShape(m.slice(lead.length), accInstr)) return m;
      ctx.bump('ADRES');
      return `${lead}${ctx.M.ADRES}`;
    },
  );
  // 12b) ADRES bez prefiksu „ul." — rozpoznawany po SĄSIEDZTWIE (już zamaskowanego) kodu pocztowego.
  // Człony nazwy łączy tylko odstęp poziomy: przez nową linię nazwisko z wiersza podpisu
  // („Monika Sadowska\nSzosa Chełmińska 77/9") stawało się początkiem nazwy ulicy.
  const KOD = escapeRe(ctx.M['KOD-POCZTOWY']);
  ctx.text = ctx.text.replace(
    new RegExp(
      // (bez łącznika „i/z/pod" z 12a: bez skrótu ulicy „Spółka Kowalski i Syn 5, 00-001 …" to firma)
      // Granica wyrazu jawnie, nie „\b": bez flagi „u" „\b" zna tylko litery ASCII, więc wieś na Ł/Ś/Ż/Ź/Ć
      // („Łagów 12⏎26-140 Bodzentyn", „Świniary 12") zostawała jawna, a „Łęki Szlacheckie 12" traciła
      // tylko drugi człon („Łęki [ADRES]").
      `(?<![${PL_UP}${PL_LO}0-9_])([${PL_UP}][${PL_LO}]+(?:[ \\t]+[${PL_UP}][${PL_LO}]+){0,2})` +
        `\\s+${ADDR_HOUSE}${ADDR_UNIT}` +
        `(\\s*,?\\s*)(${KOD})`,
      'g',
    ),
    (m: string, street: string, sep: string, kod: string, offset: number, str: string) => {
      // Odsyłacz albo pomieszczenie nad kodem („Sala 12⏎00-001 Warszawa", „Rozdział 12", „Pokój 3")
      // to nie ulica ani wieś — jak po etykiecie adresu (ADDR_LABEL_VALUE_STOP). Chyba że to wieś
      // w bloku koperty: imię i nazwisko (albo „Pan/Pani") w wierszu tuż wyżej („Pan⏎Jan Kowalski⏎
      // Pokój 12⏎46-034 Pokój") albo ta sama nazwa za kodem.
      if (!/[ \t]/.test(street) && ADDR_LABEL_VALUE_STOP.has(street.toLowerCase())) {
        const prevLine = /(?:^|\n)([^\n]*)\r?\n[ \t]*$/.exec(str.slice(Math.max(0, offset - 80), offset))?.[1]?.trim() ?? '';
        const envelope =
          /^(?:Pan|Pani|PAN|PANI|Sz\.[ \t]*P\.)$/u.test(prevLine) ||
          (RE_ENVELOPE_PERSON_LINE.test(prevLine) && personPairBeforeAddr(prevLine));
        const after = str.slice(offset + m.length, offset + m.length + 40);
        const sameName = after.startsWith(' ' + street) && !/^\p{L}/u.test(after.slice(street.length + 1));
        if (!envelope && !sameName) return m;
      }
      ctx.bump('ADRES');
      return `${ctx.M.ADRES}${sep}${kod}`;
    },
  );
}

// Wiersz bloku koperty z samym imieniem i nazwiskiem, opcjonalnie po „Pan/Pani".
const RE_ENVELOPE_PERSON_LINE = /^(?:(?:Pan|Pani|PAN|PANI)[ \t]+)?\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?[ \t]+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u;

// 10b) KOD POCZTOWY BEZ MYŚLNIKA („65048") — TYLKO przy mocnej kotwicy adresowej: tuż po
// zamaskowanym [ADRES] i BEZPOŚREDNIO przed miejscowością (wyraz z wielkiej).
function passPostalNoHyphen(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  const ADR = escapeRe(ctx.M.ADRES);
  ctx.text = ctx.text.replace(
    new RegExp(`(${ADR}\\s*,?\\s*)(?<!\\d)\\d{5}(?!\\d)(?=[ \\t]+${CAP_CITY})`, 'g'),
    (_m, pre: string) => {
      ctx.bump('KOD-POCZTOWY');
      return `${pre}${ctx.M['KOD-POCZTOWY']}`;
    },
  );
}

// Miejscownik miejscowości spoza słownika po „zam. w" / „zamieszkały w" / „zameldowana w"
// („zam. w Świdniku", „zamieszkała w Łomiankach, ul. …"). Słownik zna średnie i duże miasta, więc
// mniejsza miejscowość zostawała jawna przy zamaskowanym adresie. Tylko jeden wyraz z końcówką
// miejscownika, za nim koniec zdania, przecinek albo dalszy adres; kraj, region i nazwa placówki
// („w Polsce", „na Śląsku", „w Domu Pomocy …", „w Szpitalu") to nie miejsce zamieszkania osoby.
// „-iach" (bez „c"/„k" przed „ach") to kraina w liczbie mnogiej („na Kurpiach"), nie miejscowość.
const RE_LOCATIVE_PLACE = /^\p{Lu}\p{Ll}{2,}(?:iku|ku|nie|wie|cach|kach|(?<!i)ach|ie|iu|dzie|rze|ce|le|ze|owie|ynie|inie)$/u;
const LOCATIVE_NOT_PLACE = new Set<string>(
  (
    'polsce niemczech anglii francji holandii irlandii norwegii szwecji hiszpanii włoszech czechach ukrainie ' +
    'kanadzie austrii belgii danii szwajcarii grecji rosji litwie łotwie słowacji rumunii bułgarii chorwacji ' +
    'portugalii finlandii ameryce stanach europie australii japonii chinach indiach islandii szkocji walii ' +
    'turcji egipcie brazylii meksyku wielkopolsce małopolsce mazowszu śląsku pomorzu podlasiu kaszubach ' +
    'warmii mazurach podhalu bieszczadach kujawach lubelszczyźnie domu szpitalu zakładzie ośrodku internacie ' +
    'akademiku bloku mieszkaniu kamienicy hospicjum schronisku placówce kraju mieście gminie powiecie ' +
    'województwie wsi stolicy centrum okolicy rejonie ' +
    // kraje i kontynenty spoza Europy, częste w zawiadomieniach o stronach za granicą
    'iranie iraku libanie izraelu syrii jordanii egipcie maroku tunezji algierii libii nigerii kenii ' +
    'afryce azji wietnamie tajlandii korei mongolii indonezji filipinach malezji singapurze gruzji ' +
    'armenii azerbejdżanie białorusi mołdawii estonii węgrzech serbii słowenii albanii macedonii ' +
    'czarnogórze bośni luksemburgu argentynie ekwadorze kolumbii wenezueli boliwii peru chile kubie ' +
    'katarze kuwejcie emiratach arabii zelandii ' +
    // pasma górskie (liczba mnoga na „-ach" przechodzi końcówkę miejscownika miejscowości)
    'tatrach sudetach karpatach beskidach pieninach karkonoszach gorcach alpach ' +
    // budynki i placówki pisane wielką literą na początku nazwy własnej albo zdania
    'areszcie więzieniu zakładzie klasztorze zakonie plebanii bursie budynku domku pustostanie altanie ' +
    'przyczepie namiocie baraku kontenerze garażu piwnicy dworze zamku pałacu pensjonacie hotelu ' +
    'hostelu motelu lokalu noclegowni koszarach koszarze jednostce ' +
    // państwa z końcówką miejscownika miejscowości (pisma do cudzoziemców, ochrona międzynarodowa)
    'sudanie kamerunie birmie bahrajnie kosowie jemenie omanie laosie tajwanie nigerze czadzie beninie ' +
    'ghanie gabonie ugandzie rwandzie mozambiku botswanie panamie kostaryce hondurasie salwadorze gujanie ' +
    'surinamie bhutanie palestynie cyprze malcie madagaskarze jamajce tybecie nepalu kongu togo ' +
    'kamboży senegalu ekwadorze peru urugwaju paragwaju nikaragui gwatemali kazachstanie ' +
    // regiony, krainy etnograficzne i obszary
    'ponidziu donbasie kaukazie krymie zakarpaciu podkarpaciu roztoczu polesiu wołyniu orawie żuławach ' +
    'kociewiu kurpiach zagłębiu suwalszczyźnie regionie obwodzie okręgu kraju'
  ).split(' '),
);
const RE_LOCATIVE_PLACE_END = /^(?:[ \t]*(?:[,.;)]|\r?\n|$)|[ \t]+(?:przy|ul\.|al\.|os\.|pl\.|gm\.|pow\.|woj\.|nr|i|oraz)(?![\p{L}]))/u;
function residenceLocativeCity(marker: string, run: string, after: string): boolean {
  // liczba pojedyncza: „osób zamieszkałych w …" to zdanie ogólne (ogłoszenie, uchwała)
  if (!/^(?:[Zz]am\.|[Zz]amieszka[łl](?:y|a|ą|ej|ego|emu|ym)?[ \t]|[Zz]ameldowan(?:y|a|ą|ej|ego|emu|ym)[ \t])/.test(marker) || !/(?<!\p{L})[Ww]e?[ \t]+$/u.test(marker)) return false;
  // „-stanie" to miejscownik nazw państw (Kazachstanie, Pakistanie, Afganistanie), nie miejscowości.
  if (/[ \t-]/.test(run) || !RE_LOCATIVE_PLACE.test(run) || LOCATIVE_NOT_PLACE.has(run.toLowerCase()) || /stanie$/.test(run)) return false;
  return RE_LOCATIVE_PLACE_END.test(after);
}
// Marker ZAMIESZKANIA przed miastem (12f) — zamknięta lista form czasownika i imiesłowu zamiast
// otwartego „mieszka\w*", które (1) połykało rzeczowniki i przymiotniki („Spółdzielnia
// Mieszkaniowa w Krakowie", „Mieszkania w Krakowie drożeją", „budynek mieszkalny", „zameldowanie")
// i (2) urywało się na polskiej literze („zamieszkałą", „mieszkający"), a nie znało „zamieszkuje"
// ani „zamieszkiwał". Klasa [a-ząę] celowo bez „ń": „mieszkańcy/mieszkań w Krakowie" to proza.
// „Mieszkaniec/mieszkanka Krakowa" zostaje. Rzeczownik „zamieszkania/zameldowania" działa tylko po
// „miejsce/adres" (też „z miejscem", „pod adresem", „stałego miejsca").
const RESIDENCE_MARKER =
  `(?:[Zz]a)?[Mm]ieszk(?:a(?:m|sz|my|cie|j[aąę][a-ząę]*|niec|nk[aiąęo])?|a(?:ł|l(?!n))[a-ząę]*|uj[a-ząę]*|iwa[łl][a-ząę]*)|` +
  `[Zz]ameldowan(?!i[aeu])[a-ząęó]*|` +
  // rzeczownik jako etykieta pola z dwukropkiem („Zamieszkanie: Kraków", „Zameldowanie: Wieliczka");
  // w prozie („Zameldowanie w Krakowie trwa trzy dni") dalej bez maski
  `[Zz]a(?:mieszk|meldow)ani(?:e|a|u|em)(?=[ \\t]*:)|` +
  // „miejscowość/miasto/gmina zamieszkania:" — kanoniczne etykiety formularzy urzędowych
  `(?:[Mm]iejsc(?:e|a|u|em)|[Aa]dres(?:u|em|ie)?|[Mm]iejscowoś(?:ć|ci)|[Mm]iast(?:o|a)|[Gg]min(?:a|y))` +
  `[ \\t]+(?:(?:sta[łl]|czasow)[a-ząęó]*[ \\t]+)?` +
  `(?:zamieszkania|zameldowania|pobytu|urodzenia)`;
// Imiesłów w liczbie mnogiej („osób zamieszkujących w Gdańsku", „Rodziny mieszkające w Poznaniu")
// albo na początku zdania w formie, która bywa mnoga („Zamieszkującym w Gdańsku przysługuje ulga",
// „Zamieszkujący w Poznaniu studenci …"), to zdanie ogólne z ogłoszenia czy uchwały, nie miejsce
// zamieszkania konkretnej osoby. Forma tylko pojedyncza („Mieszkająca w Krakowie powódka",
// „Zamieszkującej w Gdańsku Annie …") dotyczy osoby i zostaje markerem.
const RE_RESIDENCE_GENERAL =
  /^(?:(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ąc(?:ych|e|ymi)|(?:Zam|M)ieszk(?:uj|aj)ąc(?:y|e|ych|ym|ymi))(?![\p{L}])/u;
// Imiesłów „-ując-/-jąc-" (forma dopisana w partii b3) w formie, która bywa mnoga, po rzeczowniku
// zbiorowym („osób zamieszkujących w …", „Dzieci zamieszkujące w …", „mieszkańcom mieszkającym w …")
// — tak samo zdanie ogólne; „osoby zamieszkującej w Gdańsku" to jedna osoba. Formy
// „zamieszkał-/zameldowan-" działają jak przed b3 („osób zamieszkałych w …" w masce).
const RE_RESIDENCE_PARTICIPLE = /^(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ąc(?:y|e|ych|ym|ymi)(?![\p{L}])/u;
// 3. osoba liczby mnogiej („Ci, którzy mieszkają w Krakowie", „Wszyscy, którzy zamieszkują w …").
const RE_RESIDENCE_3PL = /^(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ą(?![\p{L}])/u;
// Rzeczownik zbiorowy, grupa ludności albo zaimek ogólny przed imiesłowem („osób zamieszkujących",
// „Pracownicy mieszkający", „Ukraińcy mieszkający", „Wszyscy mieszkający"), też przez „, którzy".
// Celowo bez stron postępowania w liczbie mnogiej („Pozwani mieszkający w …", „Powodowie …",
// „Wnioskodawcy …"): w piśmie to konkretne osoby.
const RE_COLLECTIVE_BEFORE_MARKER = new RegExp(
  '(?<!\\p{L})(?:osób|osoby|osobom|osobami|dzieci|dzieciom|rodzin|rodziny|rodzinom|mieszkańców|mieszkańcy|' +
    'mieszkańcom|obywateli|obywatele|obywatelom|uczniów|uczniowie|uczniom|pacjentów|pacjenci|pacjentom|' +
    'studentów|studenci|studentom|wszystkich|wszystkim|wszyscy|seniorów|seniorzy|seniorom|emerytów|emeryci|' +
    'emerytom|rencistów|renciści|rencistom|ludzie|ludzi|ludziom|ludności|cudzoziemców|cudzoziemcy|cudzoziemcom|' +
    'obcokrajowców|obcokrajowcy|imigrantów|imigranci|migrantów|migranci|uchodźców|uchodźcy|uchodźcom|' +
    'podatników|podatnicy|podatnikom|beneficjentów|beneficjentom|pracowników|pracownicy|pracownikom|' +
    'turystów|turyści|turystom|klientów|klienci|klientom|członków|członkowie|członkom|kobiet|kobiety|' +
    'kobietom|mężczyzn|mężczyźni|młodzieży|młodzież|przedsiębiorców|przedsiębiorcy|rolników|rolnicy|' +
    'nauczycieli|nauczyciele|wyborców|wyborcy|kierowców|kierowcy|najemców|najemcy|lokatorów|lokatorzy|' +
    'polaków|polacy|ukraińców|ukraińcy|białorusinów|białorusini|ci|te|tych|tym|tymi|każdy|każda|każde|' +
    'każdego|każdej|każdemu|każdym)(?:[ \\t]*,[ \\t]*(?:którzy|które|którym|których))?[ \\t]+$',
  'iu',
);
// Celownik liczby mnogiej przed imiesłowem na -ym („Najemcom zamieszkującym w Gdańsku przysługuje …",
// „Członkom mieszkającym w …") — rzeczownik zbiorowy spoza listy, małą literą albo na początku zdania.
const RE_DATIVE_PLURAL_BEFORE = /(?:(?<!\p{L})\p{Ll}{3,}om|(?:^|[.!?\n][ \t]*)\p{Lu}\p{Ll}{2,}om)[ \t]+$/u;
// Podmiot ogólny w liczbie pojedynczej („Osoba mieszkająca w Krakowie może złożyć wniosek", „Rodzina
// mieszkająca w Lublinie otrzyma bon") — ogólny tylko z orzeczeniem modalnym albo przyszłym za
// miastem; „Osoba zamieszkująca w Gdańsku złożyła wniosek" to konkretna osoba i zostaje w masce.
const RE_GENERIC_SG_BEFORE = /(?<!\p{L})(?:osoba|osobie|osobę|osobą|rodzina|rodzinie|rodzinę|rodziną)[ \t]+$/iu;
const RE_RESIDENCE_PARTICIPLE_SG = /^(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ąc(?:a|ej|ą|y|e|ego|emu|ym)(?![\p{L}])/u;
const RE_GENERIC_PREDICATE_AFTER =
  /^[ \t]*,?[ \t]*(?:(?:nie|też|także|również|zawsze|jedynie|tylko)[ \t]+)?(?:może|mogą|można|musi|muszą|należy|powinien|powinna|powinno|powinni|powinny|ma[ \t]+prawo|mają[ \t]+prawo|otrzyma|otrzymają|otrzymuje|otrzymują|przysługuje|przysługują|zapłaci|zapłacą|płaci|płacą|skorzysta|skorzystają|korzysta|korzystają|uzyska|uzyskają|będzie|będą|jest[ \t]+uprawnion\p{L}*|jest[ \t]+zobowiązan\p{L}*|są[ \t]+uprawnieni|są[ \t]+zobowiązani)(?!\p{L})/u;
// Imiesłów przysłówkowy na początku zdania przed zdaniem bezosobowym („Mieszkając w Krakowie, można
// korzystać z karty", „Mieszkając w Gdańsku, warto…") — porada, nie miejsce zamieszkania osoby.
// Z orzeczeniem osobowym („Mieszkając w Krakowie, często bywał w teatrze") dotyczy osoby z pisma.
const RE_RESIDENCE_ADVERBIAL = /^(?:Zam|M)ieszk(?:uj|aj)ąc(?![\p{L}])/u;
const RE_IMPERSONAL_AFTER =
  /^[ \t]*,?[ \t]*(?:(?:nie|też|także|również|łatwiej|łatwo|taniej|szybciej|zawsze)[ \t]+)?(?:można|warto|należy|trzeba|wystarczy|da[ \t]+się|opłaca[ \t]+się)(?!\p{L})/u;
const RE_STREET_ADDR_AFTER_CITY = /^[ \t]*,?[ \t]*(?:przy[ \t]+)?\[ADRES\]/;
// Liczba mieszkańców za miastem („Zamieszkuje w Krakowie ok. 800 tys. osób") — statystyka.
const RE_POPULATION_AFTER =
  /^[ \t]+(?:(?:ok\.|około|ponad|blisko|niemal|prawie|przeszło|już|aż)[ \t]+)?\d[\d  .,]{0,12}(?:[ \t]*(?:tys\.|tysięcy|tys|mln|milion\p{L}*))?[ \t]+(?:osób|osoby|mieszkańców|ludzi|rodzin|obywateli|dzieci|uczniów|studentów|cudzoziemców)(?!\p{L})/u;
/**
 * Czy marker zamieszkania w 12f stoi w zdaniu OGÓLNYM (ogłoszenie, uchwała, poradnik, statystyka),
 * a nie przy konkretnej osobie? `before` to tekst przed markerem, `after` — za nazwą miasta.
 */
function residenceIsGeneral(marker: string, before: string, after: string): boolean {
  // zamaskowany już adres za miastem to konkretne miejsce — miasto maskujemy razem z nim („Ludzie
  // mieszkający w Krakowie przy ul. Długiej 5 skarżą się"); sama ulica bez numeru adresem nie jest
  if (RE_STREET_ADDR_AFTER_CITY.test(after)) return false;
  if (RE_RESIDENCE_GENERAL.test(marker)) return true;
  if (populationAfter(after)) return true;
  if (RE_RESIDENCE_ADVERBIAL.test(marker) && RE_IMPERSONAL_AFTER.test(after)) return true;
  if (RE_RESIDENCE_PARTICIPLE.test(marker) || RE_RESIDENCE_3PL.test(marker)) {
    if (subjectBeforeGap(before, RE_COLLECTIVE_BEFORE_MARKER)) return true;
    if (/ym$/.test(marker.trimEnd().split(/[ \t]/)[0]) && RE_DATIVE_PLURAL_BEFORE.test(before)) return true;
  }
  return RE_RESIDENCE_PARTICIPLE_SG.test(marker) && subjectBeforeGap(before, RE_GENERIC_SG_BEFORE) && RE_GENERIC_PREDICATE_AFTER.test(after);
}
// Liczba za miastem to statystyka tylko w dużej skali: „Zamieszkuje w Krakowie ok. 800 tys. osób",
// „… ponad 300 rodzin". Mała liczba to skład gospodarstwa osoby z pisma („Wnioskodawczyni
// zamieszkała w Gdańsku 3 osoby na utrzymaniu", „Z wnioskodawczynią mieszka w Lublinie 3 dzieci")
// i miasto zostawało jawne.
function populationAfter(after: string): boolean {
  const m = RE_POPULATION_AFTER.exec(after);
  if (!m) return false;
  if (/tys|mln|milion/.test(m[0])) return true;
  const n = Number(/\d[\d\s.]*/.exec(m[0])?.[0].replace(/[^\d]/g, '') ?? '0');
  // od 100 w górę to statystyka także bez kwalifikatora („Mieszka w Sopocie 500 cudzoziemców",
  // „… w Pruszkowie 120 rodzin"): gospodarstwo domowe takiej liczby nie ma
  return n >= 100;
}
// Między podmiotem zbiorowym a markerem bywa przydawka albo okolicznik („Obywatele Ukrainy
// mieszkający w …", „Pracownicy sezonowi mieszkający …", „Polacy coraz częściej mieszkają …",
// „Osoba niepełnosprawna mieszkająca …"). Do dwóch takich wyrazów w tej samej frazie; osoba
// w dopełniaczu albo zaimek dzierżawczy („Dzieci wnioskodawczyni mieszkają", „Dzieci Anny
// mieszkają", „moi rodzice") wskazuje konkretną osobę i blokuje.
const GAP_ADVERBS = new Set<string>(
  'coraz częściej rzadziej samotnie nadal wciąż obecnie stale czasowo tymczasowo legalnie nielegalnie wspólnie razem dotąd dalej już jeszcze także również też zwykle najczęściej na stałe'.split(' '),
);
const GAP_PRONOUNS = new Set<string>('moi twoi nasi wasi jego jej ich moja moje twoja nasza wasza'.split(' '));
const RE_GAP_ADJ_LIKE = /(?:ow|n|sk|ck|dz|rz|ł|l|t|w|ż|s|d|c)(?:[iy]|a|e)$/u;
const RE_LAST_GAP_WORD = /(?:^|[ \t])((?:z|ze)[ \t]+)?(\p{L}+)[ \t]+$/u;
function subjectBeforeGap(before: string, subject: RegExp): boolean {
  if (subject.test(before)) return true;
  let s = before;
  for (let k = 0; k < 2; k++) {
    const mm = RE_LAST_GAP_WORD.exec(s);
    if (!mm) return false;
    const w = mm[2];
    const wl = w.toLowerCase();
    if (GAP_PRONOUNS.has(wl) || ROLE_WORDS.has(wl) || /yni$/.test(wl) || isFirstNameLike(w)) return false;
    const proper = /^\p{Lu}/u.test(w);
    // nazwa własna tylko w dopełniaczu i nie osoba: kraj albo region („Ukrainy", „z Białorusi")
    if (proper ? !/(?:[iy]|ii|ji)$/.test(wl) || !!surnameBase(w) || looksLikeSurname(w) : !(GAP_ADVERBS.has(wl) || RE_GAP_ADJ_LIKE.test(wl)))
      return false;
    s = s.slice(0, mm.index + (/^[ \t]/.test(mm[0]) ? 1 : 0));
    if (subject.test(s)) return true;
  }
  return false;
}
// Koniec nazwy miasta w 12f/12g. Także koniec wiersza: regex jest bez flagi „m", więc samo „$"
// oznaczało koniec CAŁEGO tekstu i „zam. w Krakowie⏎PESEL …" zostawiało miasto jawne.
const CITY_END = '(?=[ \\t\\r\\n.,;:?!)]|$)';
// Wyraz WERSALIKAMI jako nazwa miejscowości (12c-caps, 12e): granica po całym wyrazie, żeby
// cofanie nie skracało go do prefiksu („KRAKÓWek").
const CAPS_CITY_TOK = `[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})*(?![${PL_UP}${PL_LO}0-9-])`;
// Skróty, waluty i etykiety pisane wersalikami za kodem — nie miejscowość („[KOD] VAT", „11-222
// ZUS RCA", „00-001 MIEJSCOWOŚĆ WARSZAWA", „00-238 POCZTA WARSZAWA").
const CAPS_CITY_STOP = new Set<string>(
  (
    'vat nip regon pesel krs zus krus gus bdo pkd cit pit kpa kpc ksh rodo rca dra skr tel fax faks ' +
    'brutto netto poz art fv pln eur usd chf gbp czk miasto miejscowość miejscowosc poczta gmina ' +
    'powiat województwo wojewodztwo woj kraj kod polska poland ul al os nr ' +
    // etykiety kolejnego pola w jednowierszowym formularzu z OCR („26-900 TELEFON 600700800", „00-001
    // DATA 12.03.2024") i dopiski pocztowe („SKRYTKA POCZTOWA 12", „ODBIÓR OSOBISTY", „PACZKOMAT …")
    'telefon kom email e-mail mail data dnia skrytka paczkomat odbiór odbior priorytet polecony ' +
    'obywatelstwo adres kontakt numer podpis uwagi pl pow gm ' +
    // odpowiedź w pustym polu miejscowości i dalszy ciąg wiersza („31-616 BRAK", „JAK WYŻEJ",
    // „ODDZIAŁ ZUS", „ZAMELDOWANY OD 2010", „OBSZAR WIEJSKI", „TERYT 2604")
    'brak tak nie jak sprawdzono nieaktualny nieaktualne nieaktualna zameldowany zameldowana ' +
    'zamieszkały zamieszkała oddział obszar osiedle teryt'
  ).split(' '),
);
// Człony nazwy wielowyrazowej miejscowości WERSALIKAMI (12c-caps w bloku adresowym bez słownika):
// przymiotnik albo rzeczownik typowy dla nazw wsi („STARA WIEŚ", „DOMANIÓW GÓRNY", „NOWA WOLA",
// „KAZIMIERZ BISKUPI"), przyimek „NAD/POD" z dopełnieniem i przymiotnik zgodny z głową rodzaju
// żeńskiego („WOLA GOŁĘBIOWSKA", „NOWA WIEŚ LĘBORSKA"). Dawniej szedł tam każdy wyraz WERSALIKAMI
// spoza stoplisty: nazwisko z imieniem („GŁOWACZÓW KOWAL-ZAJĄC ANNA" → „[MIEJSCOWOŚĆ] ANNA"),
// etykieta kolejnej kolumny („DZ. 45/6", „KW …", „OBRĘB …") i dalszy tekst („ZAMELDOWANY OD 2010 R.").
const CAPS_CITY_PART = new Set<string>(
  (
    'nowa nowy nowe stara stary stare wielka wielki wielkie mała mały małe duża duży duże górna górny ' +
    'górne dolna dolny dolne średnia średni średnie wieś wola kolonia osada huta ruda biskupia biskupi ' +
    'biskupie kościelna kościelny kościelne szlachecka szlachecki szlacheckie królewska królewski ' +
    'królewskie nad pod'
  ).split(' '),
);
const CAPS_CITY_FEM_HEAD = new Set<string>('wola wieś kolonia huta ruda osada dąbrowa góra'.split(' '));
// Przymiotnik-głowa nazwy („STARY TARG", „STARA KAMIENICA", „STARE KUROWO") — za nim rzeczownik.
const CAPS_CITY_ADJ_HEAD = new Set<string>(
  'nowa nowy nowe stara stary stare wielka wielki wielkie mała mały małe duża duży duże górna górny górne dolna dolny dolne'.split(' '),
);
/** `lineEnd` — za członem kończy się wiersz, komórka albo pole (koniec tekstu, „\n", TAB, „,", „;"). */
function capsCityTailPart(w: string, prev: string, lineEnd = false): boolean {
  const lo = w.toLowerCase();
  const pl = prev.toLowerCase();
  if (CAPS_CITY_PART.has(lo) || pl === 'nad' || pl === 'pod') return true;
  if (lo === 'miasto') return pl === 'nowe' || pl === 'stare';
  if (CAPS_CITY_FEM_HEAD.has(pl) && /(?:sk|ck|dzk|ow|n)a$/.test(lo)) return true;
  // przymiotnik regionalny rodzaju męskiego i nijakiego po dowolnej głowie („STAROGARD GDAŃSKI",
  // „LIDZBARK WARMIŃSKI"), żeński po głowie żeńskiej („WÓLKA KOSOWSKA")
  if (/(?:sk|ck|dzk)(?:i|ie)$/.test(lo)) return true;
  if (/a$/.test(pl) && /(?:sk|ck|dzk|ow)a$/.test(lo)) return true;
  // rzeczownik po przymiotniku-głowie, ale tylko jako ostatni człon wiersza („34-400 STARY TARG")
  return lineEnd && CAPS_CITY_ADJ_HEAD.has(pl);
}
// „św." osobno: tylko z kontekstem sakralnym (RE_SAINT_CONTEXT), bo bez niego bywa skrótem
// „świadek" („św. Jan Turek, ul. …" to osoba, nie miasto).
const RE_SAINT_BEFORE = /(?<!\p{L})(?:bł|im|pw)\.[ \t]*$/iu;
// Obiekt noclegowy lub lokal (pensjonat, hotel, willa, karczma…) tuż przed nazwą — „Maria" to nazwa
// obiektu, nie imię osoby. Bez sklepu, gabinetu czy zakładu: te zwykle noszą imię i nazwisko
// właściciela („w gabinecie Anna Kalisz" to osoba).
const RE_FACILITY_BEFORE =
  /(?<!\p{L})(?:pensjona|hotel|motel|hostel|restauracj|kawiarni|karczm|zajazd|zajeździe|gospod|will[iaęą])\p{Ll}*[ \t]+$/u;
/**
 * Czy ciąg przed „, ul./[ADRES]" (12d) to OSOBA, której nazwisko jest też nazwą miasta („Jan
 * Turek", „Pani Anna Kalisz", „Jan Maria Turek")? Imię tylko w mianowniku ze słownika — odmiana
 * („Jana", „Stanisława") bywa patronem; „św./bł./im./pw." przed imieniem to też patron („Parafia
 * pw. św. Stanisława Kalisz"). Rzeczownik przed imieniem („Pensjonat Maria Zakopane") to nazwa
 * firmy — zostaje miastem. Miasto będące imieniem („Jan Jarosław") też zostaje jak było.
 */
function cityRunLooksLikePerson(capRun: string, before: string): boolean {
  const lo = capRun.split(/[ \t]+/).map((w) => w.toLowerCase());
  const city = lo[lo.length - 1];
  const isPan = (w: string): boolean => w === 'pan' || w === 'pani' || w === 'panna';
  // toponim „imię + przymiotnik" jako nazwisko po imieniu albo „Pan" („Pan Jan Kazimierz Dolny,
  // ul. …") — bez tego osoba rozpadała się na „[IMIĘ I NAZWISKO] [MIEJSCOWOŚĆ]"
  if (lo.length >= 2 && POLISH_FIRST_NAMES.has(lo[lo.length - 2]) && POLISH_CITIES.has(`${lo[lo.length - 2]} ${city}`)) {
    // także etykieta roli z dwukropkiem („Wnioskodawca: Kazimierz Dolny, ul. Polna 3")
    const prev = lo.length >= 3 ? lo[lo.length - 3] : (/(\p{L}+)[ \t]*:?[ \t]+$/u.exec(before)?.[1] ?? '').toLowerCase();
    return POLISH_FIRST_NAMES.has(prev) || isPan(prev) || (lo.length === 2 && (ROLE_WORDS.has(prev) || PARTY_ROLE_WORDS.has(prev)));
  }
  if (!POLISH_CITIES.has(city) || POLISH_FIRST_NAMES.has(city)) return false;
  // „nocleg w pensjonacie Maria Zakopane" — rzeczownik obiektu małą literą przed imieniem to nazwa
  // firmy, jak „Pensjonat Maria Zakopane". Tylko imię żeńskie (pensjonat i willa noszą zwykle takie)
  // i miasto, które nie bywa nazwiskiem: „Pracownik w hotelu Jan Kalisz, ul. …" to osoba.
  if (lo.length === 2 && RE_FACILITY_BEFORE.test(before) && lo[0].endsWith('a') && !HOMOGRAPH_SURNAMES.has(city)) return false;
  if (lo.length === 2) return isPan(lo[0]) || (POLISH_FIRST_NAMES.has(lo[0]) && !RE_SAINT_BEFORE.test(before) && !saintWithContext(before, before.length, before.slice(-12)));
  if (lo.length === 3) return isPan(lo[1]) || (POLISH_FIRST_NAMES.has(lo[1]) && (POLISH_FIRST_NAMES.has(lo[0]) || isPan(lo[0])));
  return false;
}

// Wyraz po nazwie miejscowości, który nie jest jej członem (państwo, etykieta kontaktu, jednostka,
// nagłówek faktury czy wizytówki: „86-170 Nowe Kontakt: …", „48-210 Biała Faktura VAT nr …").
const RE_NOT_CITY_TAIL =
  /^(?:Polska|Poland|Tel|Telefon|Fax|Faks|Kom|Komórka|Mail|E-mail|Email|Www|NIP|REGON|KRS|PESEL|Woj|Gmina|Powiat|Poczta|Kontakt|Godziny|Faktura|Konto|Bank|Data|Adres|Osoba|Infolinia|Sekretariat|Strona|Nr|Numer|Razem|Suma|Termin|Sposób|Wartość|Kwota|Forma|Uwagi|Wystawca|Odbiorca|Sprzedawca|Nabywca|Płatność|Płatności)$/i;
// Za członem nazwy kończy się wiersz, komórka albo pole („05-082 Stare Babice", „…Babice, ul. …")
// albo idzie wyraz małą literą („Nowa Iwiczna gm. Piaseczno"). Wyraz z wielkiej litery za nim
// znaczy, że człon zaczyna coś innego: osobę („86-170 Nowe Anna Gzik"), instytucję („Nowe Sąd
// Rejonowy"), etykietę („Nowe Godziny otwarcia: 8-16").
function cityTailEnds(t: string, end: number): boolean {
  if (t[end] === '\t') return true;
  let i = end;
  while (t[i] === ' ' || t[i] === '\t') i++;
  // koniec pola JSON/XML/CSV („…Stare Babice"}", „…Babice</Miasto>") i adnotacja „(gmina)" też
  if (i >= t.length || /[,;)(\r\n"'<\]}|/”»]/.test(t[i])) return true;
  return i > end && RE_CHAR_LL.test(t[i]);
}
// Trzeci człon nazwy po „Nowa Wieś", „Stara Wieś": przymiotnik odmiejscowy albo kierunkowy
// („Nowa Wieś Tarnowska", „Stara Wieś Wielka").
const isCityThirdPart = (w: string): boolean =>
  /^\p{Lu}\p{Ll}*(?:sk|ck|dzk)(?:a|ie|i)$/u.test(w) || CITY_PREFIX_ADJ.has(w.toLowerCase()) || /^(?:Królewsk|Kościeln|Szlacheck)\p{Ll}+$/u.test(w);
// Pierwszy człon nazw miejscowości („Stare Babice", „Nowa Wieś", „Wielkie Oczy", „Dolna Grupa").
const CITY_PREFIX_ADJ = new Set<string>(
  (
    'stare stara stary nowe nowa nowy wielkie wielka wielki małe mała mały górne górna górny dolne ' +
    'dolna dolny białe biała biały czarne czarna czarny zielone zielona zielony wysokie wysoka wysoki ' +
    'suche sucha suchy kamienna kamienny'
  ).split(/\s+/),
);

// 12c–12g) MIEJSCOWOŚĆ — nazwa po kodzie pocztowym, przed/po adresie, oraz w kontekście
// zamieszkania/urodzenia. Skanery słownika (cityByPrefix/cityBySuffix) dają precyzję.
function passCity(ctx: RedactCtx): void {
  if (!ctx.on('MIEJSCOWOSC')) return;
  // 12c) MIEJSCOWOŚĆ stojąca BEZPOŚREDNIO po kodzie pocztowym.
  const KOD = escapeRe(ctx.M['KOD-POCZTOWY']);
  // Człon może zaczynać łącznik „nad/pod" („66-470 Kostrzyn nad Odrą", „26-420 Nowe Miasto nad
  // Pilicą"): bez niego wpisy słownika z „nad" były martwe i rzeka zostawała jawna za maską. Łącznik
  // wchodzi do maski tylko wtedy, gdy cała fraza jest w słowniku — inaczej reszta wraca bez zmian.
  ctx.text = ctx.text.replace(
    new RegExp(`(${KOD}|(?<![\\d-])\\d{2}-\\d{3})([ \\t]+)(${CAP_CITY})((?:[ \\t]+(?:(?:nad|pod)[ \\t]+)?${CAP_CITY}){0,2})`, 'g'),
    (m, anchor: string, sep: string, first: string, restRaw: string, offset: number) => {
      // surowy kod poprzedzony odwołaniem prawnym („poz. 12-345 Rejestr") → nie adres
      if (anchor !== ctx.M['KOD-POCZTOWY'] && precededByLegalRef(ctx.text, offset)) return m;
      // człony z ORYGINALNYM odstępem przed każdym („\tPolska", „   Mazowieckie") — niedoklejona
      // reszta wraca w tym zapisie (spacja w miejscu tabulatora scalała kolumny TSV)
      const restParts = restRaw.match(/[ \t]+[^ \t]+/g) ?? [];
      const rest = restParts.map((p) => p.trim());
      // ile kolejnych wyrazów doklejamy: najdłuższe dopasowanie do słownika wielowyrazowego
      let take = 0;
      let combo = first.toLowerCase();
      for (let i = 0; i < rest.length; i++) {
        combo += ' ' + rest[i].toLowerCase();
        if (MULTIWORD_CITIES.has(combo)) take = i + 1;
      }
      // Przymiotnik-człon nazwy spoza słownika („05-082 Stare Babice", „05-500 Nowa Iwiczna"): drugi
      // wyraz należy do nazwy, dawniej zostawał jawny. Tylko przez spację (tabulator to kolumna)
      // i nie przed państwem, etykietą czy skrótem („86-170 Nowe Tel. …", „48-210 Biała Polska" —
      // Nowe i Biała to też miasta). Imię, nazwisko, nazwa instytucji czy etykieta pola to nie
      // człon nazwy: maska miasta połykała imię, a nazwisko za nim zostawało jawne. Tylko przez
      // jedną spację: kilka spacji to kolumna faktury („86-170 Nowe   Sposób płatności: przelew").
      const part0 = restParts[0] ?? '';
      if (take === 0 && part0 && CITY_PREFIX_ADJ.has(first.toLowerCase()) && /^ \S/.test(part0)) {
        const end = offset + anchor.length + sep.length + first.length + part0.length;
        const tail = part0.trim();
        const tl = tail.toLowerCase();
        if (
          !RE_NOT_CITY_TAIL.test(tail) &&
          ctx.text.charAt(end) !== '.' &&
          !isFirstNameLike(tail) &&
          !surnameBase(tl) &&
          !looksLikeSurname(tail) &&
          !LEGAL_ENTITY_WORDS.has(tl) &&
          !FORM_LABEL_WORDS.has(tl) &&
          !ROLE_WORDS.has(tl)
        ) {
          const part1 = restParts[1] ?? '';
          const p1 = part1.trim();
          const end1 = end + part1.length;
          if (cityTailEnds(ctx.text, end)) take = 1;
          else if (/^ +\S/.test(part1) && isCityThirdPart(p1) && ctx.text.charAt(end1) !== '.' && cityTailEnds(ctx.text, end1)) take = 2;
          // za członem zaczyna się osoba („05-082 Stare Babice Kowalski Jan") — człon jest nazwą
          else if (/^ +\S/.test(part1) && (isFirstNameLike(p1) || looksLikeSurname(p1) || !!surnameBase(p1.toLowerCase()))) take = 1;
        }
      }
      ctx.bump('MIEJSCOWOSC');
      return `${anchor}${sep}${ctx.M.MIEJSCOWOSC}${restParts.slice(take).join('')}`;
    },
  );
  // 12c-caps) Miejscowość WERSALIKAMI po kodzie („UL. LIPOWA 14, 26-900 KOZIENICE", „00-001
  // WARSZAWA"). CAP_CITY wymaga małych liter, więc w bloku adresowym ze skanu ulica i kod były
  // maskowane, a miasto wyciekało. Pozycyjnie jak w Titlecase NIE: „Faktura [KOD] VAT", „Partia
  // 11-222 ZUS" — wersalikami pisze się też skróty. Przyjmujemy słownik albo blok adresowy (kod
  // tuż po zamaskowanym [ADRES]), bez stoplisty skrótów i etykiet i bez dwukropka za wyrazem
  // („KOD POCZTOWY: 00-001 POCZTA: WARSZAWA"). Surowy kod (passPostal go odrzucił) — tylko słownik.
  {
    const ADR_BEFORE = new RegExp(`${escapeRe(ctx.M.ADRES)}[ \\t]*[,/;]?[ \\t]*(?:\\r?\\n[ \\t]*)?$`);
    ctx.text = ctx.text.replace(
      new RegExp(`(${KOD}|(?<![\\d-])\\d{2}-\\d{3})([ \\t]+)(${CAPS_CITY_TOK})((?:[ \\t]+(?:(?:NAD|POD)[ \\t]+)?${CAPS_CITY_TOK}){0,2})`, 'g'),
      (m, anchor: string, sep: string, first: string, restRaw: string, offset: number, str: string) => {
        const masked = anchor === ctx.M['KOD-POCZTOWY'];
        if (!masked && precededByLegalRef(str, offset)) return m;
        const lo = first.toLowerCase();
        if (CAPS_CITY_STOP.has(lo)) return m;
        // człony z ORYGINALNYM odstępem przed każdym (jak w 12c)
        const tailParts = restRaw.match(/[ \t]+[^ \t]+/g) ?? [];
        // najdłuższy człon wielowyrazowy ze słownika („NOWY SĄCZ", „KOSTRZYN NAD ODRĄ")
        let take = 0;
        let combo = lo;
        for (let i = 0; i < tailParts.length; i++) {
          combo += ' ' + tailParts[i].trim().toLowerCase();
          if (MULTIWORD_CITIES.has(combo)) take = i + 1;
        }
        const dict = take > 0 || POLISH_CITIES.has(lo);
        const block = masked && lo.length >= 3 && ADR_BEFORE.test(str.slice(Math.max(0, offset - 40), offset));
        if (!dict && !block) return m;
        // Blok adresowy bez słownika: cała nazwa wielowyrazowa („05-300 STARA WIEŚ", „NOWA WIEŚ
        // WIELKA", „KAZIMIERZ BISKUPI") — dawniej maskę dostawał tylko pierwszy człon, a reszta nazwy
        // zostawała jawna. Człon musi wyglądać na część nazwy miejscowości (capsCityTailPart) i stać
        // za spacją: tabulator zaczyna kolejną komórkę („GROCHÓWKA⇥OBRĘB 0007"). Kończy go też imię
        // („… 26-900 GŁOWACZÓW JAN KOWALSKI") albo nazwisko przed imieniem („… WOLA KOWALSKA ANNA").
        if (!dict) {
          const head = offset + anchor.length + sep.length + first.length;
          while (take < tailParts.length) {
            const part = tailParts[take];
            const w = part.trim();
            const prev = take === 0 ? first : tailParts[take - 1].trim();
            // wyraz za członem szukany w tekście, nie w tailParts: tych jest najwyżej dwa
            const at = head + tailParts.slice(0, take + 1).join('').length;
            const lineEnd = /^[ ]*(?:[\r\n\t,;]|$)/.test(str.slice(at, at + 3));
            if (part.includes('\t') || isFirstNameLike(w) || !capsCityTailPart(w, prev, lineEnd)) break;
            if (CAPS_CITY_STOP.has(w.toLowerCase()) && !(w === 'MIASTO' && /^(?:NOWE|STARE)$/.test(prev))) break;
            const next = /^ +(\S+)/.exec(str.slice(at, at + 40))?.[1];
            if (next && isFirstNameLike(next) && isConfirmedSurname(w)) break;
            take++;
          }
          if (take > 0 && /^(?:NAD|POD)$/.test(tailParts[take - 1].trim())) take--;
        }
        const end = offset + anchor.length + sep.length + first.length + tailParts.slice(0, take).join('').length;
        if (/^[ \t]*:/.test(str.slice(end, end + 4))) return m;
        ctx.bump('MIEJSCOWOSC');
        return `${anchor}${sep}${ctx.M.MIEJSCOWOSC}${tailParts.slice(take).join('')}`;
      },
    );
  }
  // 12c') Miejscowość po kodzie za średnikiem albo przecinkiem (CSV: „Nowak;Jan;ul. Długa 5;00-001;
  // Warszawa", „…, 00-001, Warszawa."). Kolejna kolumna bywa krajem, województwem czy „Brak", więc
  // tylko słownik, a nazwa musi zamykać pole — „…, 00-003, Warszawa zgłosiła awarię" to zdanie.
  ctx.text = ctx.text.replace(
    new RegExp(`(${KOD}"?)([ \\t]*[;,][ \\t]*"?)((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})(?=[ \\t]*(?:["';,.)\\r\\n]|$))`, 'g'),
    (m, kod: string, sep: string, run: string) => {
      const r = cityByPrefix(ctx, run);
      return r ? `${kod}${sep}${ctx.M.MIEJSCOWOSC}${r.leftover}` : m;
    },
  );
  // 12h) MIEJSCOWOŚĆ z anotacją rodzaju jednostki TERYT: „Gliwice (miasto)", „Nowa Sól (miasto)",
  //   „Zabłudów (gmina miejsko-wiejska)". Etykieta „(miasto)/(gmina …)/(wieś)" pochodzi z pól
  //   słownikowych systemów e-urzędowych (ePUAP, FINN) — to MOCNA kotwica, że poprzedzający wyraz
  //   z wielkiej to nazwa miejscowości, a nie proza. Dzięki temu znika niespójność, w której ta sama
  //   miejscowość była maskowana po kodzie/adresie, a w osobnej linii „Gliwice (miasto)" wyciekała.
  const TERYT_UNIT =
    `\\([ \\t]*(?:[Mm]iasto(?:[ \\t]+na[ \\t]+prawach[ \\t]+powiatu)?|[Gg]mina(?:[ \\t]+(?:miejska|wiejska|miejsko-wiejska))?|[Ww]ieś|[Oo]sada)[ \\t]*\\)`;
  ctx.text = ctx.text.replace(
    new RegExp(`${CITY_START}(?:(${CAP_CITY})([ \\t]+))?(${CAP_CITY})([ \\t]*${TERYT_UNIT})`, 'g'),
    (m, pre: string | undefined, preSep: string | undefined, city: string, tag: string) => {
      const cl = city.toLowerCase();
      // ostatni wyraz przed etykietą musi wyglądać na miejscowość, nie na człon nazwy instytucji/roli
      if (LEGAL_ENTITY_WORDS.has(cl) || ROLE_WORDS.has(cl) || NON_SURNAME_ADJ.has(cl)) return m;
      ctx.bump('MIEJSCOWOSC');
      // dwuczłonowa nazwa własna („Nowa Sól") — cała pod jedną maskę; inny poprzednik zostaje
      if (pre && MULTIWORD_CITIES.has(`${pre.toLowerCase()} ${cl}`)) return `${ctx.M.MIEJSCOWOSC}${tag}`;
      return `${pre ? pre + preSep : ''}${ctx.M.MIEJSCOWOSC}${tag}`;
    },
  );
  // 12d) MIEJSCOWOŚĆ przed adresem BEZ kodu pocztowego — „Warszawa, ul. …".
  const ADR = escapeRe(ctx.M.ADRES);
  ctx.text = ctx.text.replace(
    new RegExp(`${CITY_START}((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})([ \\t]*,?[ \\t]+)(${ADR}|ul\\.|al\\.|os\\.|pl\\.)`, 'g'),
    (m, capRun: string, sep: string, anchor: string, offset: number, str: string) => {
      // „Jan Turek, ul. Długa 5" — nazwisko-homonim miasta (Turek, Kalisz, Lubin, Mielec) po imieniu
      // albo „Pan/Pani" to osoba: maska miasta zostawiała jawne imię. Ciąg oddajemy fazie osób.
      // Tabulator to granica komórki („1⇥Anna⇥Warszawa⇥ul. Długa 5"): o mieście rozstrzyga ostatnia
      // komórka, sąsiednia kolumna z imieniem nie robi z niego osoby.
      const lead = capRun.slice(0, capRun.lastIndexOf('\t') + 1);
      const run = capRun.slice(lead.length);
      if (cityRunLooksLikePerson(run, str.slice(Math.max(0, offset - 80), offset) + lead)) return m;
      const r = cityBySuffix(ctx, run);
      return r ? `${lead}${r.prefix}${ctx.M.MIEJSCOWOSC}${sep}${anchor}` : m;
    },
  );
  // 12d') Miasto w OSOBNYM wierszu tuż nad adresem („Warszawa⏎Hoża 41, 00-681 Warszawa"). Wcześniej
  // 12b wciągał taki wiersz do maski adresu (sklejając wiersze); teraz wiersz zostaje, a nazwa
  // musi być w całości miastem ze słownika — „Jan Turek⏎ul. …" czy „Wydział Kontroli⏎…" nie.
  ctx.text = ctx.text.replace(
    new RegExp(`(?<=^|\\n)([ \\t]*)((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})(?=[ \\t]*\\r?\\n[ \\t]*(?:${ADR}|ul\\.|al\\.|os\\.|pl\\.))`, 'g'),
    (m, lead: string, run: string) => {
      if (!POLISH_CITIES.has(run.toLowerCase().split(/[ \t]+/).join(' '))) return m;
      ctx.bump('MIEJSCOWOSC');
      return `${lead}${ctx.M.MIEJSCOWOSC}`;
    },
  );
  // 12e) MIEJSCOWOŚĆ tuż PO zamaskowanym adresie bez kodu: „[ADRES], Warszawa". Także po średniku
  // (wiersz CSV „[ADRES];Warszawa") i WERSALIKAMI („UL. LIPOWA 7, KRAKÓW") — krok i tak przepuszcza
  // tylko nazwy ze słownika.
  ctx.text = ctx.text.replace(
    new RegExp(
      `(${ADR})([ \\t]*[,;][ \\t]*|[ \\t]+[Ww][Ee]?[ \\t]+|[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*)` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY}|(?:${CAPS_CITY_TOK}[ \\t]+){0,2}${CAPS_CITY_TOK})`,
      'g',
    ),
    (m, adr: string, sep: string, run: string) => {
      const r = cityByPrefix(ctx, run);
      return r ? `${adr}${sep}${ctx.M.MIEJSCOWOSC}${r.leftover}` : m;
    },
  );
  // 12f) MIEJSCOWOŚĆ w kontekście ZAMIESZKANIA/urodzenia osoby: „zamieszkały w Krakowie".
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b((?:[Zz]am\\.|${RESIDENCE_MARKER})` +
        `[ \\t]*(?::[ \\t]*|[Ww]e?[ \\t]+|[ \\t]+))` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})${CITY_END}`,
      'g',
    ),
    (m, marker: string, run: string, offset: number, str: string) => {
      const after = str.slice(offset + m.length, offset + m.length + 80);
      if (residenceIsGeneral(marker, str.slice(Math.max(0, offset - 40), offset), after)) return m;
      // Po czasowniku bez „w"/dwukropka imię zaczyna podmiot, nie nazwę miasta („zamieszkuje
      // Jarosław Wilk z konkubiną", „Lokal zamieszkują Jarosław i Anna Kowalscy") — inaczej osoba
      // dostawała [MIEJSCOWOŚĆ], a jej nazwisko zostawało jawne. Tylko po czasowniku: etykieta
      // „Miejsce zamieszkania⇥Jarosław" (eksport z arkusza, PDF bez dwukropka) podaje miasto.
      if (
        !/^[Zz]am\./.test(marker) &&
        !/(?::|(?<!\p{L})[Ww]e?)[ \t]*$/u.test(marker) &&
        !/(?:zamieszkania|zameldowania|pobytu|urodzenia)[ \t]*$/u.test(marker) &&
        POLISH_FIRST_NAMES.has(run.split(/[ \t]+/)[0].toLowerCase())
      )
        return m;
      const r = cityByPrefix(ctx, run);
      if (r) return `${marker}${ctx.M.MIEJSCOWOSC}${r.leftover}`;
      if (residenceLocativeCity(marker, run, after)) {
        ctx.bump('MIEJSCOWOSC');
        return `${marker}${ctx.M.MIEJSCOWOSC}`;
      }
      return m;
    },
  );
  // 12g) MIEJSCOWOŚĆ po markerze URODZENIA, z datą pomiędzy: „ur. [DATA-URODZENIA] w Krakowie".
  const DUR = escapeRe(ctx.M['DATA-UR']);
  ctx.text = ctx.text.replace(
    new RegExp(
      // Jedno łamanie wiersza po dacie, ale tylko przed MAŁYM „w/we" (OCR, blok strony: „ur. [DATA]
      // r.⏎w Sosnowcu"); „r.⏎W Sosnowcu odbyła się rozprawa" to już nowe zdanie.
      // także forma osobowa („urodziłam się [DATA] w Łodzi") — jak w passBirthDate
      `\\b((?:[Uu]r\\.|[Uu]rodzon[a-ząę]+|[Uu]rodzi(?:ł(?:a|am|em|aś|eś|o|y|i)?|liśmy|łyśmy)[ \\t]+się)[ \\t]+(?:(?:dnia|w[ \\t]+dniu)[ \\t]+)?` +
        `(?:${DUR}[ \\t]*r?\\.?,?(?:[ \\t]*\\r?\\n[ \\t]*(?=we?[ \\t])|[ \\t]*))?[Ww]e?[ \\t]+)` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})${CITY_END}`,
      'g',
    ),
    (m, marker: string, run: string, offset: number, str: string) => {
      if (/^urodzi/i.test(marker) && !birthVerbAboutPerson(marker, str.slice(Math.max(0, offset - 320), offset))) return m;
      // biogram postaci historycznej: rok sprzed 1900 w tym samym zdaniu („Mikołaj Kopernik urodził
      // się w Toruniu w 1473 r.", „… urodziła się w Warszawie w 1867 r.") — jak dla daty w passBirthDate
      if (/^urodzi/i.test(marker) && RE_PRE1900_YEAR.test(sentenceAround(str, offset, offset + m.length))) return m;
      const r = cityByPrefix(ctx, run);
      return r ? `${marker}${ctx.M.MIEJSCOWOSC}${r.leftover}` : m;
    },
  );
  // 12g2) Etykieta łączona „Data i miejsce urodzenia:" / „Miejsce i data urodzenia:" — miasto przed
  // datą albo za nią („…: 12.04.1985, Kielce", „…: Kielce, 12.04.1985"). Tylko słownik: „Data
  // i miejsce urodzenia Kandydata podaje się w CV" nie może dać maski.
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b(${BIRTH_COMBO}[ \\t]*:?\\s*(?:${DUR}[ \\t]*(?:r\\.)?(?:[ \\t]*,[ \\t]*|[ \\t]+)(?:[Ww]e?[ \\t]+)?)?)` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})(?=[ \\t.,;:?!)(\\r\\n]|$)`,
      'g',
    ),
    (m, marker: string, run: string) => {
      const r = cityByPrefix(ctx, run);
      return r ? `${marker}${ctx.M.MIEJSCOWOSC}${r.leftover}` : m;
    },
  );
}

// ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
// Role procesowe i umowne (też w dopełniaczu) przed toponimem-nazwiskiem („od uczestnika Kazimierza
// Dolnego", „Pracodawca: Kazimierz Dolny", „Dzierżawca: …") — uzupełnia ROLE_WORDS w kroku (a).
const RE_TOPONYM_PERSON_ROLE =
  /^(?:pracodawc\p{L}*|dzierżawc\p{L}*|wydzierżawiając\p{L}*|uczestnik\p{L}*|pozwan\p{L}*|powod\p{L}*|wnioskodawc\p{L}*|oskarżon\p{L}*|świadk\p{L}*|pełnomocnik\p{L}*|najemc\p{L}*|wynajmując\p{L}*|zleceniobiorc\p{L}*|zleceniodawc\p{L}*|dłużnik\p{L}*|wierzyciel\p{L}*|właściciel\p{L}*|pracownik\p{L}*|sprzedawc\p{L}*|nabywc\p{L}*|kupując\p{L}*|obywatel\p{L}*|lokator\p{L}*)$/u;
// Dane osoby tuż za ciągiem („Kazimierz Dolny (PESEL …)", „…, ur. 03.03.1950", „…, zam. ul. …").
const RE_PERSON_DATA_AHEAD = /^[ \t]*[,(]?[ \t]*(?:PESEL|ur\.|urodzon|zam\.|zamieszka|syn |córka )/iu;
// Początek wiersza albo punkt listy („1. ", „- ") przed wpisem.
const RE_LINE_HEAD_ONLY = /(?:^|\n)[ \t]*(?:(?:\d{1,4}[.)]|[-*•–])[ \t]*)?$/;
// Etykieta roli z dwukropkiem tuż przed wpisem („Wnioskodawca: ", „Świadek: ").
const RE_ROLE_LABEL_BEFORE = /(\p{L}+)[ \t]*:[ \t]*$/u;
/**
 * Czy wpis „Przymiotnik-ze-stoplisty Imię" to osoba w szyku „Nazwisko Imię" („Wnioskodawca:
 * Białowieski Jan", „1. Poleski Jan", „Strażacki Jan, ur. …")? Przymiotnik relacyjny czy odmiejscowy
 * bywa nazwiskiem (Mazowiecki, Rybacki, Lekarski), a stoplista wygrywała z mocną kotwicą osoby. Tylko
 * z kotwicą: rola z dwukropkiem, „Pan/Pani" przed, dane osoby za, albo sam wpis w wierszu (listy).
 * W samym wierszu imię-rzeczownik z typowej nazwy („Olimpijska Nadzieja") nie wystarcza.
 */
function stoplistedSurnameAnchored(t: string, offset: number, m: string, w1: string, w2: string): boolean {
  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (!/(?:sk|ck|dzk)[ia]$/.test(w1l) || !isGeoAdjective(w1l)) return false;
  if (!POLISH_FIRST_NAMES.has(w2l) || isFirstNameGenitive(w2l)) return false;
  const end = offset + m.length;
  if (RE_PERSON_DATA_AHEAD.test(t.slice(end, end + 24))) return true;
  // wycięte okno nie zaczyna wiersza — znak \0 blokuje „^" w RE_LINE_HEAD_ONLY
  const before = (offset > 40 ? '\0' : '') + t.slice(Math.max(0, offset - 40), offset);
  const label = RE_ROLE_LABEL_BEFORE.exec(before)?.[1]?.toLowerCase();
  if (label && (ROLE_WORDS.has(label) || RE_TOPONYM_PERSON_ROLE.test(label))) return true;
  if (/(?<!\p{L})(?:pan|pani|panna)[ \t]+$/iu.test(before)) return true;
  // komórka CSV/TSV w szyku „Nazwisko Imię" („1;Poleski Marek;ul. Leśna 7")
  if (cellStartsBefore(t, offset) && /[;|\t]/.test(t.slice(Math.max(0, offset - 3), offset)) && /^[ \t]*[;|\t]/.test(t.slice(end, end + 4))) return true;
  if (NOUN_LIKE_NAMES_IN_TITLES.has(w2l) || !RE_LINE_HEAD_ONLY.test(before)) return false;
  const after = t.slice(end, end + 40);
  return /^[ \t]*[\r\n,;\t]/.test(after) || (end + after.length >= t.length && /^[ \t]*$/.test(after));
}

// „Nazwisko, Imię[ Imię]" — przecinek bez odstępu przed nim, po nim odstęp (CSV „Kowalski,Jan"
// to dwie kolumny, nie jedna komórka).
const RE_PAIR_COMMA = new RegExp(
  `(?<![${NM_BOUND}-])(${CAP_WORD}),[ \\t]+(${CAP_WORD})(?:[ \\t]+(${CAP_WORD}))?(?![${NM_BOUND}])`,
  'g',
);
/** Czy przed pozycją zaczyna się komórka: początek tekstu albo wiersza, punkt listy („1. ", „- "),
 *  etykieta „…:", separator pola (; | ⇥), cudzysłów, nawias albo znacznik XML — po samych spacjach.
 *  Bez przecinka: w CSV „1, Kowalski, Jan, 850…" nazwisko i imię to dwie kolumny. Skan wstecz po
 *  znakach zamiast lookbehindu o zmiennej długości. */
function cellStartsBefore(t: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && t[i] === ' ') i--;
  if (i < 0) return true;
  const c = t[i];
  if (c === '\n' || c === '\r' || ((c === '\uE00A' || c === '\uE00D' || c === '\uE009') && t[i - 1] === '\\')) return true;
  if ((c === '.' || c === ')') && /\d/.test(t[i - 1] ?? '')) return true; // „1. Nowak, Anna"
  if (/[-*•–]/.test(c)) return i === 0 || /\s/.test(t[i - 1]); // punktor
  return /[:;|\t"'„“(<>]/.test(c);
}
/** Czy za pozycją kończy się komórka: koniec wiersza, separator pola (bez przecinka — patrz wyżej),
 *  cudzysłów, nawias, znacznik, dosłowna ucieczka „\n/\t" z JSON-a. */
function cellEndsAt(t: string, end: number): boolean {
  if (t[end] === '\t') return true;
  let i = end;
  while (t[i] === ' ') i++;
  if (i >= t.length) return true;
  const c = t[i];
  if (c === '\\' && /[\uE009\uE00A\uE00D]/.test(t[i + 1] ?? '')) return true;
  return /[\r\n;|\t"'”)<>(]/.test(c);
}
/**
 * Czy „Nazwisko, Imię" na pozycji `offset` to jedna osoba zapisana jak w rekordzie? Dawniej
 * nazwisko maskował przebieg samodzielny, a imię po przecinku zostawało jawne obok maski
 * („[IMIĘ I NAZWISKO], Jan"), homograf („Lis, Jakub") wyciekał w całości, a lista „Kowalski, Jan⏎
 * Wiśniewska, Ewa" sklejała się w jeden wiersz przez domknięcie imienia w lewo. Warunki: para
 * stanowi całą komórkę, imię jest w mianowniku (w prozie „z Kowalskim, Janem i Anną" to dwie osoby),
 * pierwszy wyraz ma dowód nazwiska (słownik, końcówka, homograf). Sam nagłówek „Do:" dowodem nie
 * jest: „Do: Sekretariat, Ewa", „To: Marketing, Ewa" zostają.
 */
function commaPairIsPerson(t: string, offset: number, m: string, w1: string, w2: string, w3: string | undefined): boolean {
  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (!POLISH_FIRST_NAMES.has(w2l) || (w3 && !POLISH_FIRST_NAMES.has(w3.toLowerCase()))) return false;
  if (!cellStartsBefore(t, offset) || !cellEndsAt(t, offset + m.length)) return false;
  if (isFirstNameLike(w1) || TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2l)) return false;
  if (isGeoAdjective(w1l) || LIST_HEAD_NOT_SURNAME.has(w1l)) return false;
  const parts = w1l.split('-');
  const proven = parts.some((p) => !!surnameBase(p) || looksLikeSurname(p));
  // homograf tylko z imieniem, które nie jest też rzeczownikiem („Kwiaty: Kalina, Róża")
  const homograph = !NOUN_LIKE_FIRST_NAMES.has(w2l) && parts.some((p) => HOMOGRAPH_SURNAMES.has(p));
  if (!proven && !homograph) return false;
  if (institutionLabelBefore(t, offset)) return false;
  return !precededByPatron(t, offset) && !precededByStreetEponym(t, offset);
}
/** Czy komórkę otwiera etykieta-placówka („Szpital: Bielański, Marta", „Szkoła: …")? Przymiotnik
 *  po niej to nazwa placówki, a nie nazwisko — imię za przecinkiem nie należy do „osoby". */
function institutionLabelBefore(t: string, offset: number): boolean {
  const label = /(\p{L}+)[ \t]*:[ \t]*$/u.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!label && (RE_INSTITUTION_WORD.test(label) || LEGAL_ENTITY_WORDS.has(label.toLowerCase()));
}

/**
 * Zdrobnienia, które celowo NIE są w POLISH_FIRST_NAMES (kraj „Kuba", „Kuba Libre", „Maks.",
 * „Ada" jako język programowania, krótkie „Ola/Iza/Ela"). Tylko mianownik Titlecase i tylko
 * w parze z nazwiskiem potwierdzonym słownikiem albo końcówką: wpis do słownika imion dałby
 * formy „Kubie/Kubą" i każdy wyraz z wielkiej litery po „Kuba" jako nazwisko.
 */
const PAIR_ONLY_NICKNAMES = 'Kuba|Ola|Ula|Iza|Ela|Ala|Aga|Ada|Kaja|Majka|Mati|Maks|Jasiek';
const RE_NICK_PAIR = new RegExp(`(?<![${NM_BOUND}-])(${PAIR_ONLY_NICKNAMES})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
/**
 * Czy „Zdrobnienie Nazwisko" to osoba? Nazwisko potwierdzone słownikiem albo końcówką (sam
 * homograf „Kuba Lis", „Ada Zając" bez kotwicy zostaje), bez przymiotnika odmiejscowego („Kuba
 * Mazowiecki", „Ola Polska") i kontekstu ulicy czy patrona. Imię za nazwiskiem („Kierunek: Kuba
 * Nowak Jan") oznacza szyk „Nazwisko Imię" — zdrobnienie stoi wtedy przed osobą, a nie w niej.
 */
function nicknamePairIsPerson(t: string, offset: number, m: string, w2: string): boolean {
  const parts = w2.toLowerCase().split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || ROLE_WORDS.has(p) || TITLE_WORDS.has(p) || isGeoAdjective(p))) return false;
  // w nazwisku dwuczłonowym homograf obok potwierdzonego członu też jest nazwiskiem („Nowak-Lis")
  const proven = (p: string): boolean => !!surnameBase(p) || looksLikeSurname(p);
  if (!parts.some(proven) || !parts.every((p) => proven(p) || (parts.length > 1 && HOMOGRAPH_SURNAMES.has(p)))) return false;
  if (precededByPatron(t, offset) || precededByStreetEponym(t, offset) || precededByAdminLabel(t, offset)) return false;
  if (afterNonPersonContext(t, offset, w2)) return false;
  const next = RE_NEXT_CAP_WORD_SP.exec(t.slice(offset + m.length, offset + m.length + 40))?.[1];
  return !(next && isFirstNameLike(next));
}

const RE_MAIL_HEADER_HEAD = /^\s*(to|do|od|from|cc|dw|odbiorca|nadawca|adresat|wysłano|sent)\s*:/i;
/** Początki wierszy tekstu, rosnąco — liczone raz na przebieg, przeszukiwane binarnie. */
function lineStartsOf(t: string): number[] {
  const starts = [0];
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
/**
 * Czy wiersz z pozycją `offset` zaczyna się nagłówkiem wiadomości („To:", „Do:", „Od:" …)? Początek
 * wiersza z tablicy `starts` (lineStartsOf tego samego tekstu): lastIndexOf po całym tekście przy
 * każdej parze był kwadratowy w jednym długim wierszu („Anna Jan Anna Jan …" — 400 ms na 140 tys.
 * znaków), a okno 1000 znaków gubiło dalszych adresatów długiego wiersza „Do:" (Outlook drukuje
 * kilkudziesięciu adresatów „Nazwisko Imię; …" w jednym wierszu).
 */
function inMailHeaderLine(t: string, offset: number, starts: number[]): boolean {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  const ls = starts[lo];
  // etykieta stoi na początku wiersza — wystarczy jego początek, nie cały wiersz do pozycji
  return RE_MAIL_HEADER_HEAD.test(t.slice(ls, Math.min(offset, ls + 64)));
}

// Rodzaj organizacji na początku nazwy własnej („Stowarzyszenie Przyjaciół Szkoły …", „Fundacja
// Rozwoju …", „Teatr …") — za nim imię i nazwisko bez roli bywa patronem (patrz nameSeqTail).
const ORG_HEAD_WORDS = new Set<string>(
  (
    'stowarzyszenie fundacja towarzystwo związek klub teatr muzeum szkoła zespół koło centrum ośrodek ' +
    'dom instytut akademia uniwersytet fundusz spółdzielnia parafia chór orkiestra festiwal nagroda ' +
    'konkurs galeria biblioteka liceum gimnazjum przedszkole hufiec komitet drużyna kółko straż'
  ).split(' '),
);
// Nazwa instytucji z imieniem w środku po samej roli („Prezes Zarządu Spółki Marek Trans", „Dyrektor
// Sportowy Klubu Lech Poznań", „Prezes Zarządu Firmy Adam Sp. z o.o.") rozpoznaje wyraz kończący nazwę
// firmy („Meble", „Holding", „Group", „Browary") albo forma prawna za nim. Sama instytucja
// w dopełniaczu przed imieniem niczego nie rozstrzyga: „Prezes Zarządu Spółki Anna Wrona" to członek
// zarządu z odpisu KRS, a nazwisko-homograf nie przechodzi testu słownika.
const COMPANY_TAIL_WORDS = new Set<string>(
  (
    'trans bud meble moda holding group grupa browary dystrybucja logistics logistyka service serwis ' +
    'auto med invest development consulting design studio system systems tech media travel transport ' +
    'energia sport'
  ).split(' '),
);
const RE_LEGAL_FORM_AHEAD = /^[ \t]*(?:\.[ \t]*)?(?:S\.?A\.?|[Ss][Pp]\.|[Ss]\.?[Cc]\.|S\.?K\.?A\.?|Group|Holding)(?![\p{L}])/u;

// 13a0–a4) Pary/ciągi imię+nazwisko (mianownik, odmiana, WERSALIKI, małe litery, małżonkowie).
const RE_PAST_VERB_AFTER = /^[ \t]+(?:się[ \t]+)?\p{Ll}{3,}ł[aoy]?(?!\p{L})/u;
// Głowy nazw, po których imię w dopełniaczu to patron, a nie osoba („Pomnik Jerzego Popiełuszki",
// „Fundacja Jerzego Owsiaka", „Order Świętego Jerzego", „Kopiec Józefa Piłsudskiego").
const PATRON_GEN_HEADS = new Set<string>([
  ...PROPER_NAME_HEADS,
  ...ORG_HEAD_WORDS,
  ...'pomnika pomniku order orderu krzyż krzyża medal medalu imienia im fundacji szkoły akademii uniwersytetu instytutu'.split(' '),
  // „pod wezwaniem" i nadanie imienia („Parafia pw. ks. Jerzego Popiełuszki", „Nazwanie skweru
  // imieniem Jerzego …", „Kult bł. Jerzego …") — za nimi stoi zawsze patron
  ...'pw imieniem kult kultu kultem'.split(' '),
]);
// Tytuły duchowne między głową nazwy a imieniem patrona („Muzeum ks. Jerzego Popiełuszki",
// „Sanktuarium bł. ks. Jerzego …", „kościele pw. bł. ks. …"): głową jest wyraz przed nimi.
const RE_CLERIC_RANKS_TAIL = /(?:(?<!\p{L})(?:ks|bł|św|sw|bp|abp|kard|o)\.[ \t]*)+$/iu;
// „Świętego", „Błogosławionej" przed imieniem. Skrótu „św." tu nie ma: bywa „świadkiem" („Sąd
// przesłuchał św. Annę …"), a rozstrzyga go precededByPatron z kontekstem sakralnym.
// Zapis bez ogonków też („Kosciol Swietego Michala", „Blogoslawionej …") — parytet z diakrytyką.
const RE_SAINT_WORD_BEFORE = /(?:^|[^\p{L}])(?:[Śś]więt|[Ss]wiet|[Bb]łogosławion|[Bb]logoslawion)\p{L}*[ \t]+$/u;
// Ułamek w kontekście udziału („Udział Marii Lis 1/4", „nabył część Jana Wróbla 1/2") to nie numer domu.
const RE_SHARE_BEFORE = /(?<!\p{L})(?:udzia\p{L}*|częś\p{L}*|spad[ek]\p{L}*|przypad\p{L}*|dziedzicz\p{L}*|nabył\p{L}*|nabyła)(?!\p{L})/iu;
/**
 * Czy imię na pozycji `start` ciągu to imię PATRONA: świętego („Katedra Świętego Jerzego
 * Męczennika", „Sobór św. Jerzego Zwycięzcy"), patrona obiektu lub instytucji („Pomnik Jerzego
 * Popiełuszki", „Fundacja Jerzego Owsiaka")? Drugie tylko dla imienia w przypadku zależnym — osoba
 * w mianowniku za nazwą instytucji („Fundacja … Prezes Jan Kowalski") rozstrzyga nameSeqTail.
 * Numer domu za parą („Tadeusza Kościuszki 5 m. 3") nie czyni z niej patrona: ulicę z numerem
 * rozstrzyga wcześniej patronStreetWithNumber ([ADRES]), a para, z której adres nie powstał, zostaje
 * osobą. Dawniej numer zdejmował maskę osoby także tam, gdzie adresu nie było, i ulica z lokalem
 * wyciekała w całości („Lokator Adama Mickiewicza 30 m. 2 zalega …", „Tadeusza Kościuszki 30
 * w Krakowie.").
 */
function patronFirstNameAt(t: string, offset: number, _m: string, parts: string[], start: number): boolean {
  const before = t.slice(Math.max(0, offset - 30), offset) + parts.slice(0, 2 * start).join('');
  if (RE_SAINT_WORD_BEFORE.test(before)) return true;
  const sw = parts[2 * start].toLowerCase();
  if (POLISH_FIRST_NAMES.has(sw) && !isFirstNameGenitive(sw)) return false;
  // głowa nazwy w tej samej komórce: „Nagroda⇥Jana Lisa⇥Kraków" to kolumna nagrody i laureat
  const prev = /(\p{L}+)\.? +$/u.exec(before)?.[1]?.toLowerCase();
  if (prev && PATRON_GEN_HEADS.has(prev)) return true;
  const ranks = RE_CLERIC_RANKS_TAIL.exec(before);
  if (ranks) {
    const head = /(\p{L}+)\.?[ \t]+$/u.exec(before.slice(0, ranks.index))?.[1]?.toLowerCase();
    if (head && PATRON_GEN_HEADS.has(head)) return true;
  }
  return false;
}
/**
 * Maska ciągu wyrazów osoby od `from` do `to` (indeksy wyrazów w podziale z separatorami).
 * Tabulator w ciągu to granica komórki TSV („Adam⇥Kowalczyk⇥Magazynier"): każda komórka dostaje
 * własną maskę z tym samym kluczem, a tabulatory zostają — inaczej wiersz tracił kolumnę i dane
 * przesuwały się pod cudze nagłówki.
 */
// Homografy kalendarza i narodowości przed imieniem w grafiku czy liście („Maj⇥Anna", „Sobota⇥Marek",
// „Polak⇥Jan") — kolumna dnia albo obywatelstwa, nie nazwisko.
const TSV_NOT_SURNAME = new Set<string>('maj sobota piątek niedziela środa wtorek poniedziałek czwartek polak polka niemiec czech rusin litwin węgier'.split(' '));
const tsvSurnameProof = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w));
function maskCells(parts: string[], from: number, to: number, mask: string): string {
  let out = mask;
  for (let i = from; i < to; i++) if (parts[2 * i + 1].includes('\t')) out += parts[2 * i + 1] + mask;
  return out;
}
/** Para „W1⇥W2" zamaskowana w całości: przy tabulatorze maska w każdej komórce (patrz maskCells). */
function pairCellMask(m: string, w2: string, mask: string): string {
  const gap = /[ \t]+$/.exec(m.slice(0, m.length - w2.length))?.[0] ?? '';
  return gap.includes('\t') ? `${mask}${gap}${mask}` : mask;
}
/**
 * Szyk „Nazwisko-homograf Imię" na miejscu osoby („Pacjent: Wilk Jadwiga", „1. Mazur Grzegorz –
 * Kierownik", „Pracownik: Mazur Grzegorz"). Imię w mianowniku, homograf spoza kalendarza, urzędów
 * i narodowości; bez etykiety albo numeru wpisu („Kot Anny spał", „Król Zygmunt August") nie.
 */
function reversedHomographAnchored(t: string, offset: number, w1l: string, w2l: string): boolean {
  if (!POLISH_FIRST_NAMES.has(w2l) || isMaleFirstNameGenitive(w2l) || NOUN_LIKE_FIRST_NAMES.has(w2l)) return false;
  const hb = homographBase(w1l);
  if (!hb || hb !== w1l || HOMOGRAPH_PAIR_EXCL.has(hb) || CAPS_REVERSED_HEAD_EXCL.has(hb) || isFirstNameLike(w1l)) return false;
  return personSlotBefore(t, offset);
}
// Postacie literackie i artyści znani pod imieniem z przydomkiem („Przygody Tomka Sawyera",
// „Kubuś Puchatek", „Staś Tarkowski", „Pan Wołodyjowski"). Odmiana zdrobnień i zapis bez ogonków
// zrobiły z nich osobę w prozie, choć to tytuł albo bohater lektury. Zbiór zamknięty, tylko pary,
// których nie nosi strona pisma (sam „Tarkowski" bywa nazwiskiem, więc zawsze ze zdrobnieniem
// z lektury; „Michał Anioł" to też zwykłe imię i nazwisko, więc go tu nie ma). Rola, etykieta albo
// dane osoby przy parze rozstrzygają za osobą. Para trafia za sentinel URL i wraca jawna na końcu.
const FICTIONAL_PAIRS_SRC = [
  'tom(?:ek|ka|kowi|kiem|ku)[ \\t]+(?:sawyer(?:a|owi|em|ze)?|wilmowsk(?:i|iego|iemu|im))',
  'kubu(?:ś|sia|siowi|siem|siu)[ \\t]+puchat(?:ek|ka|kowi|kiem|ku)',
  'sta(?:ś|sia|siowi|siem|siu)[ \\t]+tarkowsk(?:i|iego|iemu|im)',
  'ani(?:a|i|ę|ą|u)[ \\t]+shirley',
  'pan(?:a|u|em|ie)?[ \\t]+wołodyjowsk(?:i|iego|iemu|im)',
];
// Każda litera z ogonkiem także w zapisie ASCII („Kubus Puchatek", „Michalem Aniolem").
const foldClass = (s: string): string =>
  s.replace(/[ąćęłńóśźż]/g, (c) => `[${c}${'acelnoszz'['ąćęłńóśźż'.indexOf(c)]}]`);
const RE_FICTIONAL_PAIR = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FICTIONAL_PAIRS_SRC.map(foldClass).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
function passProtectFictional(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_FICTIONAL_PAIR, (m, offset: number, t: string) => {
    const prev = /(\p{L}+)\.?[ \t]*:?[ \t]*$/u.exec(t.slice(Math.max(0, offset - 40), offset))?.[1]?.toLowerCase();
    if (prev && (ROLE_WORDS.has(prev) || TITLE_WORDS.has(prev) || PARTY_ROLE_WORDS.has(prev))) return m;
    if (personSlotBefore(t, offset) || RE_PERSON_DATA_AHEAD.test(t.slice(offset + m.length, offset + m.length + 24))) return m;
    const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
    ctx.protectedUrls.push(m);
    return sentinel;
  });
}
// Postacie historyczne z dwoma imionami w dopełniaczu („za panowania Zygmunta Augusta", „kościół
// Jana Chrzciciela") — bez kotwicy osoby za parą to nie strona pisma.
const HISTORIC_DOUBLE_NAMES_GEN = new Set<string>(
  ['jana kazimierza', 'zygmunta augusta', 'stanisława augusta', 'jana olbrachta', 'władysława hermana', 'jana chrzciciela', 'jana nepomucena', 'jana ewangelisty', 'jana sebastiana', 'jana henryka', 'jana józefa'],
);
// Kotwica osoby tuż ZA parą: data urodzenia, PESEL, adres zamieszkania, ojcostwo, wiek.
const RE_GEN_PAIR_PERSON_AFTER =
  /^[ \t]*(?:\([ \t]*(?:ur\.|urodz|PESEL|lat[ \t]|zam\.)|,[ \t]*(?:ur\.|urodz\p{L}*|PESEL|nr[ \t]+PESEL|zam\.|zamieszka\p{L}*|syn(?:a|em)?|córk\p{L}*|lat[ \t]+\d|l\.[ \t]*\d|s\.[ \t]*\p{Lu}|c\.[ \t]*\p{Lu}|tel\.|legitymując\p{L}*|posiadając\p{L}*|nr[ \t]+dowodu|dow\.))/u;
// Wyraz tuż przed parą, po którym imię w dopełniaczu to patron albo dzieło, a nie osoba: skrót
// „im./ul./św.", wyraz uliczny, głowa nazwy z patronem i odsyłacz do pism albo wydarzeń.
const RE_GEN_PAIR_PATRON_BEFORE =
  /(?<!\p{L})(?:im|imienia|ul|al|pl|os|św|sw|bł|bl|ks|abp|bp|o(?=\.)|pw|papież\p{L}*|świę?t\p{L}*|błogosławion\p{L}*|panowani\p{L}*|czas\p{L}*|epok\p{L}*|dynasti\p{L}*|kr[oó]l\p{L}*|ulic\p{L}*|alej\p{L}*|alei|plac\p{L}*|osiedl\p{L}*|rond\p{L}*|skwer\p{L}*)\.?[ \t]*$/iu;
/**
 * Czy para „imię w dopełniaczu + dopełniacz imienia" bez roli przed nią to osoba (jak w v0.46.23)?
 * Nie, gdy przed nią stoi patron, ulica, instytucja albo odsyłacz do pism („Szkoła im. Jana Pawła",
 * „Encyklika Jana Pawła", „Pomnik …"); postać historyczna z dwoma imionami tylko z kotwicą za parą.
 */
function genPairPersonFree(t: string, at: number, end: number, pair: string): boolean {
  // Wyliczenie rodziców („córka Piotra Pawła i Anny Marii") i szyk rekordu z nazwiskiem przed parą
  // („Wniosek Kowalskiego Stanisława Jana") maskują dalsze przebiegi w całości, nie po kawałku.
  // Tylko gdy dalej stoi drugie imię albo dwa imiona bez nazwiska; osoba z nazwiskiem w wyliczeniu
  // („Piotra Pawła i Annę Nowak", „… i Tomasza Lisa") nie zdejmuje maski z pary.
  const enumNext = /^[ \t]+(?:i|oraz)[ \t]+(\p{Lu}\p{Ll}+)(?:[ \t]+(\p{Lu}\p{Ll}+))?/u.exec(t.slice(end, end + 40));
  if (enumNext && (!isFirstNameLike(enumNext[1]) || !enumNext[2] || (isFirstNameLike(enumNext[2]) && !surnameBase(enumNext[2])))) return false;
  const prevCap = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, at - 30), at))?.[1]?.toLowerCase();
  if (prevCap && !isFirstNameLike(prevCap) && (!!surnameBase(prevCap) || looksLikeSurname(prevCap))) return false;
  if (RE_GEN_PAIR_PERSON_AFTER.test(t.slice(end, end + 30))) return true;
  if (HISTORIC_DOUBLE_NAMES_GEN.has(pair)) return false;
  const before = t.slice(Math.max(0, at - 40), at);
  // odsyłacz do pism i wydarzeń („Encyklika …", „Pielgrzymka …") tylko przy papieżu
  if (RE_GEN_PAIR_PATRON_BEFORE.test(before) || (pair === 'jana pawła' && RE_PATRON_ROMAN_REF_BEFORE.test(before))) return false;
  // ulica papieża po przyimku miejsca („jestem na Jana Pawła, za rogiem", „skręć w Jana Pawła")
  if (pair === 'jana pawła' && /(?<!\p{L})(?:na|w|z|ze)[ \t]+$/iu.test(before)) return false;
  const prev = /(\p{L}+)[ \t]+$/u.exec(before)?.[1]?.toLowerCase();
  if (prev && (PATRON_GEN_HEADS.has(prev) || capsOrgHead(prev))) return false;
  return true;
}
function passPersonPairs(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  // (a0) „Imię i Imię Nazwisko" — małżonkowie/rodzeństwo o WSPÓLNYM nazwisku („Anna i Jan Kowalscy").
  ctx.text = ctx.text.replace(RE_SPOUSES, (m, a: string, mid: string, b: string, c: string, offset: number, t: string) => {
    if (!isFirstNameLike(a) || !isFirstNameLike(b)) return m;
    if (LEGAL_ENTITY_WORDS.has(c.toLowerCase())) return m;
    // Dwie osoby z dwoma imionami („córka Piotra Pawła i Anny Marii"): pierwszy wyraz to drugie imię
    // poprzedniej osoby, a trzeci to drugie imię drugiej, nie wspólne nazwisko. Wspólny klucz robił
    // z ojca i matki jedną osobę, a „Piotra" odrywało się od swojej maski.
    if (isFirstNameLike(c) && !surnameBase(c)) {
      const prev = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
      if (prev && isFirstNameLike(prev)) return m;
    }
    // Imię przed pierwszym członem, który nie jest imieniem w mianowniku („Piotra Pawła i Annę
    // Nowak", „Tomaszem Markiem i Anną Nowak", „Piotrowi Markowi i Annie Nowak"): pierwszy człon to
    // nazwisko poprzedniej osoby (homograf imienia w odmianie), nie imię drugiej osoby o wspólnym
    // nazwisku. Wspólny klucz sklejał dwie różne osoby w jeden pseudonim.
    const al = a.toLowerCase();
    if (!POLISH_FIRST_NAMES.has(al) || isFirstNameGenitive(al)) {
      const prev = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
      if (prev && isFirstNameLike(prev)) return m;
    }
    ctx.bump('IMIE');
    // wspólne nazwisko = ten sam klucz osoby; spójnik i odstępy zostają takie jak w tekście
    // (dawniej stałe „ i " zamieniało „oraz" i zwijało wyrównanie spacjami)
    return `${ctx.personMask(c)}${mid}${ctx.personMask(c)}`;
  });
  // (a) IMIĘ/IMIONA + NAZWISKO — jedno lub dwa imiona (mianownik LUB odmiana) + nazwisko.
  // Okno ma najwyżej 4 wyrazy, więc w dłuższym ciągu imię wypadało na końcu porcji, a nazwisko
  // zostawało samo w następnej („Kierownik Działu Kadr Grzegorz | Mazur", „Sędzia Sądu
  // Okręgowego Jan | Gzowski"). Wtedy porcja oddaje ogon: skan rusza od imienia, prefiks zostaje
  // bez zmian (liczba zwraca pozycję wznowienia). Tylko imię w mianowniku ze słownika (patron
  // w dopełniaczu: „Akademia Wychowania Fizycznego Józefa Piłsudskiego") i następny wyraz
  // w kształcie nazwiska: potwierdzonym (słownik, morfologia, homograf — „Mazur", „Bąk") albo
  // po roli lub tytule w prefiksie („Sędzia Sądu Rejonowego Piotr Gwizdała"), nigdy encja
  // prawna, dopełniacz czy przymiotnik odmiejscowy.
  const nameSeqTail = (m: string, offset: number, words: string[], parts: string[], start: number): number | null => {
    if (start === 0) return null;
    const first = words[start].toLowerCase();
    if (!POLISH_FIRST_NAMES.has(first) || isFirstNameGenitive(first)) return null;
    const nx = RE_NEXT_CAP_WORD.exec(ctx.text.slice(offset + m.length, offset + m.length + 60))?.[1];
    if (!nx) return null;
    const nl = nx.toLowerCase();
    const segs = nl.split('-');
    // „Sp" z „Sp. z o.o." to forma prawna, nie nazwisko (maska zjadała skrót: „[…]. z o.o.")
    if (nl === 'sp' || segs.some((p) => LEGAL_ENTITY_WORDS.has(p) || isGeoAdjective(p)) || RE_SURNAME_OBLIQUE.test(nl)) return null;
    const resume = offset + parts.slice(0, 2 * start).join('').length;
    // drugie imię za oknem („… Kadr Anna Maria Kowalska") — kolejna porcja i tak rozstrzyga osobę
    if (isFirstNameLike(nx)) return resume;
    const prefix = words.slice(0, start).map((w) => w.toLowerCase());
    const role = !NOUN_LIKE_FIRST_NAMES.has(first) && prefix.some((w) => ROLE_WORDS.has(w) || TITLE_WORDS.has(w));
    // Za nazwą organizacji bez roli („Stowarzyszenie Przyjaciół Szkoły Adam Mickiewicz", „Fundacja
    // … Jan Kowalski") imię i nazwisko w mianowniku to częściej patron niż osoba — samo nazwisko
    // ze słownika nie wystarcza, potrzebna rola albo tytuł („Prezes Stowarzyszenia … Adam Nowak").
    // Tylko gdy ciąg ZACZYNA się od rodzaju organizacji, także po przymiotniku („Gminny Ośrodek
    // Kultury Stefan Żeromski", „Miejski Dom Kultury …", „Ochotnicza Straż Pożarna …"): stanowisko
    // w dopełniaczu instytucji („Główny Księgowy Spółki Katarzyna Lis") to osoba.
    if (!role && (ORG_HEAD_WORDS.has(prefix[0]) || ORG_HEAD_WORDS.has(prefix[1] ?? ''))) return null;
    const confirmed = segs.some((p) => !!surnameBase(p) || looksLikeSurname(p) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(p)));
    if (confirmed) return resume;
    if (!role) return null;
    // Sama rola nie wystarcza, gdy dalej stoi nazwa instytucji: miasto w nazwie klubu („Prezes
    // Klubu Sportowego Lech Poznań"), wyraz z nazwy firmy („Agata Meble", „Danuta Holding") albo forma prawna za nim.
    const after = ctx.text.slice(offset + m.length, offset + m.length + 80);
    const nxEnd = after.indexOf(nx) + nx.length;
    if (
      POLISH_CITIES.has(nl) ||
      segs.some((p) => COMPANY_TAIL_WORDS.has(p)) ||
      RE_LEGAL_FORM_AHEAD.test(after.slice(nxEnd))
    )
      return null;
    return resume;
  };
  const nameSeqMask = (m: string, offset: number): string | number => {
    // Podział z zachowaniem separatorów (indeksy parzyste = wyrazy, nieparzyste = odstępy):
    // ciąg bywa dłuższy niż osoba („Jan Kowalski\tWarszawa", „Kowalski     Odebrał"), a sklejanie
    // reszty pojedynczą spacją zwijało tabulatory i wyrównanie kolumn.
    const parts = m.split(/([ \t]+)/);
    const words = parts.filter((_, i) => i % 2 === 0);
    let start = 0;
    while (start < words.length && !isFirstNameLike(words[start])) start++;
    if (start >= words.length) return m; // brak imienia w ciągu → zostaw
    // patron ulicy/placu (też wyliczenie „ulic X oraz Y") to eponim, nie osoba. Gdy ciąg zaczyna
    // się od nazwy ulicy („ul. Długiej Jan Kowalski zasłabł"), rozstrzyga miejsce imienia: osoba
    // w mianowniku za nazwą ulicy to nie patron („ul. Marszałka Józefa Piłsudskiego" nim jest).
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) {
      // Ciąg od imienia patrona w dopełniaczu („W kościele św. Anny Jan Bednarz zagra", „parafii
      // św. Józefa Marek Sikora", „bł. Karoliny Anna Gzik"): osoba w mianowniku za patronem zaczyna
      // się od pierwszego imienia w mianowniku — dawniej cały ciąg wracał jawny razem z nią.
      let pastPatron = false;
      if (start === 0) {
        let j = 1;
        while (j < words.length && !(POLISH_FIRST_NAMES.has(words[j].toLowerCase()) && !isFirstNameGenitive(words[j].toLowerCase()))) j++;
        if (j >= words.length - 1) {
          // Samo nazwisko w mianowniku za patronem, przed czasownikiem w czasie przeszłym („W kaplicy
          // św. Rocha Bednarz poświęcił bramę") — podmiot zdania; patron zostaje, maska na nazwisku.
          // Także przed czasownikiem w czasie teraźniejszym albo dopowiedzeniem po przecinku
          // („Proboszcz parafii św. Wojciecha Brzęczek zaprasza", „św. Rocha Bednarz, miejscowy
          // kowal, …") — dopełniacz patrona kończy się samogłoską, wyraz na spółgłoskę to już osoba.
          // Miejscowość, forma prawna i wyraz uliczny zostają.
          const last = words[words.length - 1];
          const ll = last.toLowerCase();
          const after = ctx.text.slice(offset + m.length, offset + m.length + 24);
          if (
            words.length >= 2 &&
            !isFirstNameLike(last) &&
            // „-ej" to dopełniacz żeński patronki („W kościele bł. Anny Kowalskiej odbyła się
            // msza"), nie mianownik podmiotu
            /(?:[^aeiouyąęó]|(?:sk|ck|dzk)i)$/.test(ll) &&
            !/ej$/.test(ll) &&
            (RE_PAST_VERB_AFTER.test(after) ||
              (/^(?:[ \t]*,[ \t]*\p{Ll}|[ \t]+\p{Ll}{3,})/u.test(after) && !POLISH_CITIES.has(ll) && !LEGAL_ENTITY_WORDS.has(ll) && !RE_STREET_WORD.test(ll)))
          ) {
            ctx.bump('IMIE');
            return `${parts.slice(0, -1).join('')}${ctx.personMask(last)}`;
          }
          return m;
        }
        start = j;
        pastPatron = true;
      }
      // Osoba za patronem („parafii św. Wojciecha Zygmunt Lis prowadził") — patron już pominięty;
      // ponowne sprawdzenie od imienia widziało przed nim tego samego patrona i zostawiało całą osobę
      // jawną (maskę dostawało potem samo nazwisko).
      const at = offset + parts.slice(0, 2 * start).join('').length;
      if (!pastPatron && (precededByPatron(ctx.text, at) || precededByStreetEponym(ctx.text, at))) return m;
    }
    // wyraz uliczny wciągnięty do dopasowania („Rondo Romana Dmowskiego") → patron, nie osoba
    if (start > 0 && RE_STREET_WORD.test(words[start - 1])) return m;
    if (patronFirstNameAt(ctx.text, offset, m, parts, start)) return m;
    let k = start;
    while (k < words.length && isFirstNameLike(words[k]) && !LEGAL_ENTITY_WORDS.has(words[k].toLowerCase())) k++;
    // Imię w mianowniku i dopełniacz męskiego imienia w roli nazwiska („Świadek: Marek Pawła",
    // „Pracownik: Ewa Pawła", „p. Robert Pawła", „mgr Andrzej Pawła"): etykieta, rola albo tytuł
    // przed parą wygrywa z odczytem „dwa imiona" — to osoba. Bez kotwicy (i z liczbą rzymską za
    // parą: „Nagroda: Jan Pawła II") para zostaje jak dawniej. Drugie imię w dopełniaczu pośrodku
    // („mgr Andrzej Jana Pawła") też.
    // Imię w MIANOWNIKU z dopełniaczem bez liczby rzymskiej za parą („Jan Pawła mieszka", „syn Piotr
    // Pawła", „Ja, Krzysztof Pawła,") to osoba także bez kotwicy: dwa imiona stałyby w tym samym
    // przypadku („Jan Paweł"), a papieża zawsze wyróżnia „II". Tak samo imię w bierniku, celowniku,
    // narzędniku albo miejscowniku przed dopełniaczem („świadka Zofię Pawła", „po Janie Pawła",
    // „z Janem Pawła") — niezgodność przypadków robi z drugiego członu nazwisko. Imię w dopełniaczu
    // („wierzyciela Jana Pawła", „z powództwa Piotra Pawła") tylko z rolą przed parą, bo „Jana
    // Pawła" bywa też dwojgiem imion albo patronem.
    if (k >= words.length && (k - start === 2 || (k - start === 3 && isFirstNameGenitive(words[start + 1].toLowerCase())))) {
      const f = words[start].toLowerCase();
      const g = words[k - 1].toLowerCase();
      const at = offset + parts.slice(0, 2 * start).join('').length;
      const prev = /(\p{L}+)\.?[ \t]*(:?)[ \t]*$/u.exec(ctx.text.slice(Math.max(0, at - 30), at));
      const prevTok = prev?.[1]?.toLowerCase();
      // etykieta z dwukropkiem także w środku wiersza („… / "Pracownik: Ewa Pawła, …")
      const anchored =
        [...words.slice(0, start).map((w) => w.toLowerCase()), prevTok].some(
          (w) => !!w && (ROLE_WORDS.has(w) || TITLE_WORDS.has(w) || PARTY_ROLE_WORDS.has(w) || w === 'p'),
        ) ||
        (!!prev?.[2] && prev[1].length >= 2) ||
        personSlotBefore(ctx.text, at);
      const nomF = POLISH_FIRST_NAMES.has(f) && !isFirstNameGenitive(f);
      const genF = isFirstNameGenitive(f);
      const obliqueF = k - start === 2 && !nomF && !genF && !POLISH_FIRST_NAMES.has(f) && isFirstNameLike(f);
      const roleGen =
        !!prevTok && (CAPS_ROLE_OBLIQUE.has(prevTok) || prevTok === 'powództwa' || prevTok === 'wniosku' || prevTok === 'rzecz');
      // Imię w dopełniaczu bez roli: osoba, jak w v0.46.23 („Żona Jana Pawła zeznała", „w obecności
      // Piotra Pawła", „Ujawniono Jana Pawła (ur. …)"), chyba że to patron albo władca: przed parą
      // „im./ul./św.", wyraz uliczny, instytucja albo odsyłacz do pism i wydarzeń („Szkoła im. Jana
      // Pawła", „Encyklika Jana Pawła", „za panowania Zygmunta Augusta"). Postacie z dwoma imionami
      // („Jana Kazimierza", „Zygmunta Augusta", „Jana Chrzciciela") — tylko z kotwicą osoby za parą.
      const genFree = genF && !anchored && !roleGen && genPairPersonFree(ctx.text, at, offset + m.length, `${f} ${g}`);
      // Wyraz z wielkiej litery tuż za parą to nazwisko („Prezesa Zarządu Jana Kazimierza Nowaka"):
      // para to wtedy dwa imiona, a osobę maskuje dalszy przebieg w całości, nie po kawałku.
      const capAfter = /^ +\p{Lu}/u.test(ctx.text.slice(offset + m.length, offset + m.length + 3));
      // Imię w celowniku, narzędniku albo miejscowniku i odmiana imienia z ruchomym „e" („Tomaszowi
      // Markowi", „Tomaszem Markiem", „Janowi Pawłowi", „Krzysztofowi Pawle"): drugi człon to
      // nazwisko-homograf (Marek, Paweł), jak w v0.46.23. Papież z liczbą rzymską zostaje (niżej).
      const obliqueHomo = obliqueF && EXTRA_NAME_FORMS.has(g) && /(?:owi|em|le)$/.test(g) && isFirstNameLike(g);
      if (
        !capAfter &&
        obliqueHomo &&
        !/^[ \t]+[IVX]{1,4}(?!\p{L})/u.test(ctx.text.slice(offset + m.length, offset + m.length + 8))
      ) {
        ctx.bump('IMIE');
        return parts.slice(0, 2 * start).join('') + maskCells(parts, start, k - 1, ctx.personMask(words[k - 1])) + parts.slice(2 * k - 1).join('');
      }
      if (
        !capAfter &&
        (nomF || obliqueF || (genF && (anchored || roleGen || genFree))) &&
        isMaleFirstNameGenitive(g) &&
        !POLISH_FIRST_NAMES.has(g) &&
        !/^[ \t]+[IVX]{1,4}(?!\p{L})/u.test(ctx.text.slice(offset + m.length, offset + m.length + 8))
      ) {
        ctx.bump('IMIE');
        return parts.slice(0, 2 * start).join('') + maskCells(parts, start, k - 1, ctx.personMask(words[k - 1])) + parts.slice(2 * k - 1).join('');
      }
    }
    // same imiona, brak nazwiska w porcji → zostaw albo oddaj ogon (patrz nameSeqTail)
    if (k >= words.length) return nameSeqTail(m, offset, words, parts, start) ?? m;
    const surname = words[k];
    // „Sp" to skrót formy prawnej („Kierownik Sklepu Ewa Sp. z o.o.") — maska zjadała go razem z imieniem
    if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase()) || /^sp$/i.test(surname)) return m;
    // Miejscowość z rynkiem i numerem („Jarosław Rynek 5 to adres urzędu") — adres, nie osoba. Tylko
    // gdy pierwszy wyraz jest nazwą miejscowości, para stoi sama (bez roli, tytułu ani etykiety
    // przed nią: „Świadek Anna Rynek 5" to osoba), a za nią po spacji (nie tabulatorze: liczba
    // z sąsiedniej kolumny to nie numer domu) stoi goły numer domu, a nie data, okres czy lokal.
    // Rynek to też nazwisko: w każdym innym układzie para idzie dalej jako osoba.
    if (
      k === words.length - 1 &&
      k - 1 === start &&
      /^(?:rynek|rynku)$/i.test(surname) &&
      // (miejscowość albo wyraz spoza słownika imion, np. zapis bez znaków diakrytycznych „Jaroslaw")
      (POLISH_CITIES.has(words[k - 1].toLowerCase()) || !POLISH_FIRST_NAMES.has(words[k - 1].toLowerCase())) &&
      /^ +\d{1,3}[A-Za-z]?(?=[ \t]*(?:[,.;)]|$|[ \t]\p{Ll}))/u.test(ctx.text.slice(offset + m.length, offset + m.length + 12)) &&
      !rynekNoNotHouse(ctx.text.slice(offset + m.length, offset + m.length + 40).replace(/^ +\d{1,3}[A-Za-z]?/, ''))
    ) {
      const at = offset + parts.slice(0, 2 * start).join('').length;
      const prev = /(\p{L}+)\.?[ \t]*(:?)[ \t]*$/u.exec(ctx.text.slice(Math.max(0, at - 30), at));
      const pt = prev?.[1]?.toLowerCase();
      const anchored =
        (!!pt && (ROLE_WORDS.has(pt) || TITLE_WORDS.has(pt) || PARTY_ROLE_WORDS.has(pt) || RE_TOPONYM_PERSON_ROLE.test(pt))) ||
        !!prev?.[2] ||
        personSlotBefore(ctx.text, at);
      if (!anchored) return m;
    }
    // Wiersz TSV w szyku „Nazwisko⇥Imię⇥Dział" („Nowak⇥Anna⇥Kardiologia", „Mazur⇥Grzegorz⇥Kierownik"):
    // wyraz za tabulatorem bez dowodu nazwiska to sąsiednia kolumna, a nazwiskiem jest komórka PRZED
    // imieniem. Rola, tytuł albo nazwa pola w tej kolumnie nigdy nie jest nazwiskiem („Jan⇥Operator").
    if (parts[2 * k - 1].includes('\t') && !tsvSurnameProof(surname)) {
      const sl = surname.toLowerCase();
      const prev = start > 0 && parts[2 * start - 1].includes('\t') ? words[start - 1] : '';
      if (prev && tsvSurnameProof(prev) && !TSV_NOT_SURNAME.has(prev.toLowerCase())) {
        ctx.bump('IMIE');
        return parts.slice(0, 2 * start - 2).join('') + maskCells(parts, start - 1, k - 1, ctx.personMask(prev)) + parts.slice(2 * k - 1).join('');
      }
      if (isPersonRoleValue(sl)) return m;
    }
    // Toponim w kształcie „imię + przymiotnik" („Kazimierz Dolny leży nad Wisłą", „w Kazimierzu
    // Dolnym") to miejscowość — chyba że stoi przy nim rola albo tytuł („Wnioskodawca: Kazimierz
    // Dolny", „Pan Kazimierz Dolny", też w dopełniaczu: „od uczestnika Kazimierza Dolnego"), drugie
    // imię („Jan Kazimierz Dolny") albo dane osoby tuż za nim („Kazimierz Dolny (PESEL …)",
    // „…, ur. …", „…, zam. …"): wtedy to osoba o takim nazwisku.
    if (POLISH_CITIES.has(`${words[k - 1]} ${surname}`.toLowerCase())) {
      const prevTok = ctx.text
        .slice(Math.max(0, offset - 40), offset)
        .match(/(\p{L}+)\.?[ \t]*:?[ \t]*$/u)?.[1]
        ?.toLowerCase();
      const anchored =
        [...words.slice(0, start).map((w) => w.toLowerCase()), prevTok].some(
          (w) => !!w && (ROLE_WORDS.has(w) || TITLE_WORDS.has(w) || RE_TOPONYM_PERSON_ROLE.test(w)),
        ) ||
        k - 1 > start ||
        RE_PERSON_DATA_AHEAD.test(ctx.text.slice(offset + m.length, offset + m.length + 24));
      if (!anchored) return m;
    }
    ctx.bump('IMIE');
    return parts.slice(0, 2 * start).join('') + maskCells(parts, start, k, ctx.personMask(surname)) + parts.slice(2 * k + 1).join('');
  };
  {
    const src = ctx.text;
    let out = '';
    let last = 0;
    RE_NAME_SEQ.lastIndex = 0;
    for (let mm = RE_NAME_SEQ.exec(src); mm; mm = RE_NAME_SEQ.exec(src)) {
      const r = nameSeqMask(mm[0], mm.index);
      if (typeof r === 'number') {
        RE_NAME_SEQ.lastIndex = r; // wznowienie od imienia; tekst przed nim skopiuje następny krok
        continue;
      }
      out += src.slice(last, mm.index) + r;
      last = mm.index + mm[0].length;
    }
    RE_NAME_SEQ.lastIndex = 0;
    ctx.text = out + src.slice(last);
  }
  // (a6) ZDROBNIENIE spoza słownika imion + POTWIERDZONE nazwisko („Kuba Nowak", „Ola Nowak",
  // „[12:10] Kuba Nowak: siema"). Przed (a2): tam RE_PAIR zużywa „Napisał Kuba" i „Kowalski"
  // zostaje sam. Nazwisko i tak zamaskowałby przebieg samodzielny — ten krok tylko wciąga
  // zdrobnienie, które dawniej zostawało jawne obok maski.
  ctx.text = ctx.text.replace(RE_NICK_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    if (!nicknamePairIsPerson(t, offset, m, w2)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w2);
  });
  // (a2) para „Wyraz Nazwisko(morfologiczne)" — sufiks -ski/-cki/-icz/-czyk spoza słownika.
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    // Nazwisko dwuczłonowe z obcym drugim członem („Świadek Kowalczyk-Müller", „Pozwany
    // Wróblewski-Öztürk") — końcówkę nazwiskową ma pierwszy człon, a CAP_WORD bierze całość, więc
    // całe nazwisko zostawało jawne. Maska obejmuje oba człony. Tylko z literą spoza polskiego
    // alfabetu w drugim członie: tam wcześniej CAP_WORD kończył wyraz i polski człon dostawał
    // maskę; „Choroba Leśniowskiego-Crohna" zostaje nazwą choroby.
    const hy = w2.indexOf('-');
    const foreignSecond = hy > 0 && RE_NON_PL_LETTER.test(w2.slice(hy)) && looksLikeSurname(w2.slice(0, hy)) && !isGeoAdjective(w2);
    // (przypadek gramatyczny i przymiotnik rozstrzyga wtedy pierwszy człon: „Wezwano Zielińską-Šimek")
    // Strona postępowania przed przymiotnikiem ze stoplisty („Świadek Poleski zeznał", „Pozwany
    // Poleski nie stawił się", „Świadek Strażacki zeznał") — rola wygrywa: to nazwisko. Tylko gdy
    // dalej nie stoi nazwa (wyraz z wielkiej litery): „Pozwany Polski Związek …" zostaje.
    const partyAdj =
      PARTY_ROLE_WORDS.has(w1.toLowerCase()) &&
      /(?:sk|ck|dzk)[ia]$/.test(w2.toLowerCase()) &&
      RE_AFTER_PARTY_ADJ.test(t.slice(offset + m.length, offset + m.length + 3));
    const w2s = looksLikeSurname(w2) || partyAdj ? w2 : foreignSecond ? w2.slice(0, hy) : '';
    if (!w2s) return m;
    // „ulica Tadeusza Kościuszki", „ul. Jana Kilińskiego" (też wyliczenie) → patron, nie osoba;
    // w1 będące wyrazem ulicznym („Ronda Dmowskiego", „mostu Piłsudskiego") też → patron
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset) || RE_STREET_WORD.test(w1)) return m;
    const w1l = w1.toLowerCase();
    // miejscowość dwuczłonowa („Piotrków Trybunalski", „Biała Rawska") i nazwa parku
    // („Słowiński Park Narodowy" — przymiotnik bywa też nazwiskiem, więc nie na stopliście)
    if (POLISH_CITIES.has(`${w1l} ${w2.toLowerCase()}`)) return m;
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    // w1 z ORYGINALNYM odstępem (tabulator, kilka spacji) — gdy w1 zostaje przed maską
    const kept = m.slice(0, m.length - w2.length);
    if (RE_SURNAME_OBLIQUE.test(w2s.toLowerCase())) {
      // przymiotnik ODMIEJSCOWY po roli/rzeczowniku („Starosty Wołomińskiego", „Wojewody
      // Mazowieckiego") to nazwa urzędu, NIE nazwisko — ta gałąź (inaczej niż sąsiednie) tego
      // nie sprawdzała, więc -ski/-cki odmiejscowe leciały jako osoba.
      if (isGeoAdjective(w2s)) return m;
      // eponim po rzeczowniku-głowie z wielkiej litery („Odruch Babińskiego", „Objaw Brudzińskiego")
      // — jak zapis małą literą w przebiegach samodzielnych. TYLKO w tej gałęzi: w mianownikowej
      // „Objaw Kowalska", „Skala Wiśniewski" to osoba (eponim jest zawsze w dopełniaczu). Tylko
      // głowy eponimów: „Reakcja Kowalskiego", „Prawo Wiśniewskiego", „Zespół Zielińskiego" to osoba.
      // I tylko znane eponimy: „Objawy Nowackiego nasiliły się", „Operatorzy Linii Nowaka" to osoba.
      // Dwuczłonowy eponim po głowie („Choroba Leśniowskiego-Crohna", „Zespół Guillaina-Barrégo")
      // to nazwa choroby, nie nazwisko dwuczłonowe.
      // Nazwisko osoby rozpoznanej już w piśmie wygrywa z patronem mostu (patrz afterNonPersonContext).
      const knownOnBridge = w1l === 'moście' && ctx.maskedSurnames.has(normalizeSurnameKey(w2));
      if ((EPONYM_HEADS.has(w1l) && (eponymFits(w1l, w2) || w2s !== w2)) || (w1l === 'moście' && !knownOnBridge)) return m;
      ctx.bump('IMIE'); // dzierżawczy dopełniacz → rzeczownik/imię w w1 zostaje
      return `${kept}${ctx.personMask(w2)}`;
    }
    // mianownik:
    if (LEGAL_ENTITY_WORDS.has(w1l)) return m; // „Nowa Ruda", „Izba …" — raczej nazwa własna
    // Tabulator między wyrazami to granica komórki (TSV, wklejony arkusz): „Noc⇥Kaczyński",
    // „Tak⇥Kaczyński⇥Urząd Miasta", „Pokój⇥Siedlecki" — sąsiednia kolumna nie tworzy z nazwiskiem
    // nazwy własnej ani nie jest jej członem.
    // Tak samo kolumny wyrównane spacjami („Rano  Sosnowska  Oddział Wewnętrzny", „Noc      Brzozowska"):
    // co najmniej trzy spacje albo dwie, gdy wiersz ma jeszcze jedną taką przerwę (pojedyncza
    // podwójna spacja to częsta literówka albo justowanie w tekście z PDF).
    const cell = kept.includes('\t') || columnGapBetween(kept, t, offset);
    if (PROPER_NAME_HEADS.has(w1l)) {
      // Wyrównanie spacjami rozdziela komórki tylko w grafiku („Noc      Brzozowska"): w tabeli
      // o stałej szerokości i w prozie z podwójną spacją „Kościół   Mariacki" to dalej jedna nazwa.
      const headCell = kept.includes('\t') || (w1l === 'noc' && cell);
      // „Kościół Mariacki", „Puszcza Białowieska" — przymiotnik uzgodniony z rodzajem głowy to człon
      // nazwy; nieuzgodniony („Noc Brzozowski spędził w celi") albo rzeczownik („Brama Wąsowicz")
      // członem nazwy być nie może, więc to nazwisko
      if (!headCell && headAgreesWithAdjective(w1l, w2.toLowerCase()) && !properNamePairIsPerson(ctx, t, offset, m, w1l, w2)) return m;
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`;
    }
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l)) {
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`; // „Prezes Gzowski" → rola zostaje
    }
    if (NON_NAME_LEADERS.has(w1l) || RE_VERB_1ST_PERSON.test(w1l)) {
      // „Odwiedziliśmy Biebrzański Park Narodowy" — przymiotnik przed nazwą instytucji to jej człon.
      // Tylko w jednej frazie (same spacje): „Tak⇥Kaczyński⇥Urząd Miasta" to trzy komórki.
      // Jedna spacja: kilka spacji to granica kolumny („Rano  Sosnowska  Oddział Wewnętrzny"). Forma
      // firmy z nazwiskiem właściciela („Również Brzozowski Spółka Jawna", „Dziś Gzowski Zakład
      // Usługowy") nie robi z nazwiska przymiotnika nazwy — chyba że to przymiotnik geograficzny.
      const next = cell ? undefined : RE_NEXT_CAP_WORD_1SP.exec(t.slice(offset + m.length, offset + m.length + 60))?.[1];
      const nextL = next?.toLowerCase() ?? '';
      if (next && LEGAL_ENTITY_WORDS.has(nextL) && !NOUN_NAME_LEADERS.has(w1l) && !(OWNER_FIRM_HEADS.has(nextL) && !isGeoAdjective(w2))) return m;
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`; // „Wczoraj Kowalski", „Sąsiad Kowalski" → wyraz zostaje
    }
    // Wyraz z literą spoza polskiego alfabetu („Señor Kowalski", „Café Nowicki") to zwykle tytuł
    // albo nazwa, a nie rzadkie imię — zostaje przed maską. Znane obce imiona („José", „André") nie.
    // Nazwa pola albo nagłówek kolumny przed nazwiskiem („Nazwisko⇥Kowalski", „Stanowisko
    // Kowalski", „Telefon⇥Gzowski") to etykieta, nie rzadkie imię — zostaje przed maską.
    if ((RE_NON_PL_LETTER.test(w1) && !FOREIGN_GIVEN_NAMES.has(w1l)) || FORM_LABEL_WORDS.has(w1l) || TABLE_HEADER_WORDS.has(w1l)) {
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`;
    }
    ctx.bump('IMIE');
    return pairCellMask(m, w2, ctx.personMask(w2)); // rzadkie imię + nazwisko (mianownik) → oba
  });
  // (a3) ODWRÓCONA kolejność „Nazwisko Imię" — częsta w nagłówkach e-maili.
  let lineStarts: number[] | undefined;
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    if (!isFirstNameLike(w2)) return m;
    const w1l = w1.toLowerCase();
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2.toLowerCase())) return m;
    // Patron instytucji w wierszu nagłówka („Odbiorca: Szkoła Podstawowa nr 12 im. Jana Pawła II",
    // „Do: Hospicjum im. Jana Pawła II"): dwa imiona w dopełniaczu po „im." to nie „Nazwisko Imię"
    // adresata. Bez nagłówka para i tak zostaje, więc strażnik tylko wyrównuje oba przypadki.
    if (precededByStreetEponym(t, offset) || precededByPatron(t, offset)) return m;
    if (
      !surnameBase(w1) &&
      !looksLikeSurname(w1) &&
      !inMailHeaderLine(t, offset, (lineStarts ??= lineStartsOf(t))) &&
      !stoplistedSurnameAnchored(ctx.text, offset, m, w1, w2) &&
      !reversedHomographAnchored(t, offset, w1l, w2.toLowerCase())
    )
      return m;
    ctx.bump('IMIE');
    return pairCellMask(m, w2, ctx.personMask(w1)); // klucz tożsamości = nazwisko (pierwsze słowo)
  });
  // (a3b) ZAPIS REKORDU „Nazwisko, Imię" jako cała komórka: wiersz listy, pole CSV w cudzysłowie,
  // wartość XML/JSON, adresat w nagłówku („To: Grabowski, Rafał <…>", „Do: Lis, Jakub; …").
  ctx.text = ctx.text.replace(RE_PAIR_COMMA, (m, w1: string, w2: string, w3: string | undefined, offset: number, t: string) => {
    if (!commaPairIsPerson(t, offset, m, w1, w2, w3)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1);
  });
  // (a4) IMIĘ + NAZWISKO MAŁYMI literami — niechlujny zapis (czaty, e-maile, formularze).
  const surnameLikeLo = (w: string): boolean =>
    !NON_SURNAME_ADJ.has(w) &&
    !LEGAL_ENTITY_WORDS.has(w) &&
    (looksLikeSurname(w) ||
      !!surnameBase(w) ||
      (w.includes('-') && w.split('-').some((p) => looksLikeSurname(p) || !!surnameBase(p))));
  ctx.text = ctx.text.replace(RE_LOWER_RUN, (m) => {
    const words = m.split(/([ \t]+)/); // zachowaj separatory (indeksy parzyste = wyrazy)
    let changed = false;
    for (let i = 0; i + 2 < words.length; i += 2) {
      const w1 = words[i];
      const w2 = words[i + 2];
      if (!w1 || !w2) continue;
      const w1l = w1.toLowerCase();
      if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l)) continue;
      if (!isFirstNameLike(w1) || !surnameLikeLo(w2.toLowerCase())) continue;
      ctx.bump('IMIE');
      words[i] = ctx.personMask(w2); // cała para „imię nazwisko" → jedna maska (klucz = nazwisko)
      words[i + 1] = '';
      words[i + 2] = '';
      changed = true;
      i += 2; // pomiń zamaskowane nazwisko
    }
    return changed ? words.join('') : m;
  });
  // (a5) NAZWISKO PANIEŃSKIE: „Imię z Nazwiskoskich" / „Imię z domu Nazwisko" — JEDNA osoba (maskuj
  // całość, nie osieroć imienia). Po gołym „z" WYMÓG dopełniacza l.mn. (-skich/-ckich/-dzkich/-ich/
  // -ych/-ów) ODRÓŻNIA panieńskie od narzędnika („Anna z Kowalskim" = „z kimś", DWIE osoby → -im) i od
  // miejsca („z Krakowa" → -owa). „z domu" to jawna kotwica — po niej dowolna forma nazwiska.
  ctx.text = ctx.text.replace(
    new RegExp(
      // [ \t\n] wokół „z" obejmuje łamanie wiersza („Gosia\nz Lewandowskich"); tylko białe znaki
      // między wyrazami, więc proza między imieniem a „z" nie pasuje. Strażnik dopełniacza l.mn.
      // nadal odróżnia od narzędnika, niezależnie od typu białego znaku.
      // Skrót „z d." („Anna z d. Sikora") jak „z domu" — po nim też wymagany wyraz z wielkiej litery,
      // więc „Pismo z d. 12.03.2024" nie pasuje.
      `\\b(${CAP_WORD})[ \\t\\n]+z[ \\t\\n]+` +
        `(?:(?:domu|d\\.)[ \\t\\n]+(${CAP_WORD})` +
        `|([${PL_UP}][${PL_LO}]+(?:skich|ckich|dzkich|ich|ych|ów)))` +
        `(?![${NM_BOUND}])`,
      'g',
    ),
    (m, first: string, domuSurname: string | undefined, genplSurname: string | undefined) => {
      if (!isFirstNameLike(first)) return m;
      const surname = domuSurname ?? genplSurname ?? '';
      if (!surname || LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
      // „Anna z domu Pomocy Społecznej" — instytucja „Dom …", nie nazwisko panieńskie
      if (domuSurname && MAIDEN_NOT_SURNAME.has(domuSurname.toLowerCase())) return m;
      ctx.bump('IMIE');
      return ctx.personMask(surname); // klucz tożsamości = nazwisko panieńskie
    },
  );
}

// Dopełniacz urzędu wprost w wzorcu (wielka litera), żeby ciąg „Pan Pan Pan…" czy „Pan Jan Kowalski"
// odpadał bez wywołania funkcji zwrotnej. Jeden lub dwa wyrazy urzędu („Pani Kierownik Działu Kadr
// Gzowska").
const ROLE_COMPLEMENT_CAP = [...ROLE_COMPLEMENT_GEN].map((w) => w[0].toUpperCase() + w.slice(1)).join('|');
const RE_PAN_ROLE_COMPLEMENT_SURNAME = new RegExp(
  `\\b([Pp]an(?:i|a|u|em|ią)?[ \\t]+)(${CAP_WORD})([ \\t]+(?:${ROLE_COMPLEMENT_CAP})(?:[ \\t]+(?:${ROLE_COMPLEMENT_CAP}))?[ \\t]+)` +
    `(${CAP_WORD})(?![${NM_BOUND}])`,
  'g',
);
/**
 * (b0) „Pan/Pani" + rola + dopełniacz urzędu + nazwisko („Szanowna Pani Dyrektor Szkoły Gzowska",
 * „Pan Komendant Policji Lisiecki", „Pani Minister Zdrowia Kowalska"). Przed parami: para (a2)
 * zjadała „Zdrowia Kowalska" jako imię i nazwisko, a kandydat wyzwalacza (najwyżej dwa wyrazy)
 * kończył się na urzędzie i nazwisko za nim zostawało jawne. Rola i urząd zostają w tekście.
 */
const RE_FACILITY_GEN_MID = /(?<!\p{L})(?:Szpitala|Szkoły|Instytutu|Liceum|Przedszkola|Ośrodka|Zespołu|Uniwersytetu)[ \t]+$/u;
function passPersonRoleComplement(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_PAN_ROLE_COMPLEMENT_SURNAME, (m, kw: string, role: string, mid: string, sur: string) => {
    const rl = role.toLowerCase();
    if (!ROLE_WORDS.has(rl) && !TITLE_WORDS.has(rl)) return m;
    const sl = sur.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(sl) || ROLE_COMPLEMENT_GEN.has(sl) || ROLE_WORDS.has(sl) || isGeoAdjective(sl)) return m;
    // nazwisko dwuczłonowe („Pani Dyrektor Szkoły Kowalska-Nowak") rozstrzyga każdy z członów —
    // dawniej całe zostawało jawne, bo słownik i morfologia dostawały wyraz z łącznikiem
    const surnameLike = (p: string): boolean => !!surnameBase(p) || looksLikeSurname(p) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(p));
    if (!surnameLike(sl) && !(sl.includes('-') && sl.split('-').every((p) => p.length > 1) && sl.split('-').some(surnameLike))) return m;
    // „Pan Burmistrz Miasta Turek", „Pani Wójt Gminy Kalisz" — nazwa miejscowości, nie nazwisko
    if (/(?<!\p{L})(?:miasta|miast|wsi|gminy|dzielnicy)[ \t]/iu.test(mid) && POLISH_CITIES.has(sl)) return m;
    // „Szanowna Pani Dyrektor Szpitala Grochowskiego", „Pan Dyrektor Szpitala Narutowicza": po „Pan/
    // Pani" w mianowniku nazwisko adresata stoi w mianowniku; męska forma zależna to nazwa placówki
    // albo jej patron („Szpital Bielański", „Szpital im. Narutowicza")
    if (/^[Pp]ani?[ \t]/.test(kw) && isObliqueSurnameForm(sl) && !/(?:ej|ą|ę)$/.test(sl)) return m;
    // W formie zależnej („Do Pana Dyrektora Szpitala Bielańskiego") nazwisko też byłoby -skiego, więc
    // nazwa placówki tylko po jej rodzaju i dla przymiotnika spoza słownika nazwisk.
    if (/^[Pp]an(?:a|u|em|ią)[ \t]/.test(kw) && RE_FACILITY_GEN_MID.test(mid) && /(?:sk|ck|dzk)iego$/.test(sl) && !surnameBase(sl)) return m;
    ctx.bump('IMIE');
    return `${kw}${role}${mid}${ctx.personMask(sur)}`;
  });
}

// (b) wyzwalacze kontekstu — łapią nazwiska spoza listy imion („Pan Habdank-Wojewódzki").
// Człon środkowy imienia wietnamskiego (za nazwiskiem rodowym): „Nguyễn Văn Hùng", „Trần Thị Mai".
const VI_MIDDLE_NAMES = new Set<string>('văn thị đức hữu ngọc quang van thi duc huu ngoc'.split(' '));
// Częste imiona węgierskie i czeskie po zdjęciu znaków diakrytycznych (słownik ma imiona polskie).
const CE_GIVEN_NAMES_FOLDED = new Set<string>(
  'laszlo istvan janos gyorgy zoltan ferenc sandor tamas gabor imre lajos attila eva katalin zsuzsanna erzsebet ilona jiri petr tomas pavel jana'.split(' '),
);
/** Czy wyraz za wyzwalaczem „Pan/Pani" to imię — także obce i zapisane z diakrytyką („Éva", „László"). */
function triggerGivenName(w: string): boolean {
  if (isFirstNameLike(w)) return true;
  const f = w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return FOREIGN_GIVEN_NAMES.has(f) || CE_GIVEN_NAMES_FOLDED.has(f) || POLISH_FIRST_NAMES.has(f.replace(/v/g, 'w'));
}
const RE_SACRED_NAME = /^(?:bóg|boga|bogu|bogiem|jezus|jezusa|jezusowi|jezusem|chrystus|chrystusa|chrystusowi|chrystusem)$/;
const VI_GIVEN_SENTINEL = String.fromCharCode(0xe0d2);
const RE_VI_GIVEN_TAIL = new RegExp(`${VI_GIVEN_SENTINEL}(?:[ \\t]+[${NM_UP}][${NM_LO}]{1,6}(?![${NM_BOUND}-]))?`, 'g');
const RE_LABEL_TRIGGER = /^(?:[Ii]mi[eę] i nazwisko|[Nn]azwisko:)$/;
// Nagłówki kolumn spoza FORM_LABEL_WORDS, które w wierszu TSV stoją za etykietą osoby.
const TABLE_HEADER_WORDS = new Set<string>('lokal uwagi funkcja podpis status kontakt login rola grupa klasa termin godzina pokój lp'.split(' '));
function passPersonTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  let viTail = false;
  const nameTrigger = new RegExp(
    `\\b([Nn]azywam się|[Mm]am na imię|[Ii]mię i nazwisko|[Ii]mie i nazwisko|[Nn]azwisko:|` +
      `[Pp]anowie|[Pp]anami|[Pp]anom|[Pp]anów|[Pp]anem|[Pp]ana|[Pp]anią|[Pp]aniom|[Pp]anu|[Pp]ani|[Pp]an)` +
      `([ \\t:]+)(${CAP_WORD}(?:[ \\t]+${CAP_WORD})?)(?![${NM_BOUND}])`,
    'g',
  );
  const onMatch = (m: string, kw: string, sep: string, name: string, offset: number, str: string): string => {
    if (RE_LABEL_TRIGGER.test(kw)) {
      // Etykieta w wierszu tabeli TSV („Imię i nazwisko⇥Lokal⇥Telefon", „Nazwisko:⇥Gzowski⇥Kadry"):
      // za nią stoi nagłówek sąsiedniej kolumny albo wartość tylko w pierwszej komórce. Tabulator
      // w kandydacie to granica kolumny — dalszy wyraz nie jest drugim członem nazwiska.
      const w0 = name.split(/[ \t]/)[0].toLowerCase();
      if (sep.includes('\t') && (FORM_LABEL_WORDS.has(w0) || TABLE_HEADER_WORDS.has(w0))) return m;
      const tab = name.indexOf('\t');
      if (tab > 0) return onMatch(m.slice(0, m.length - name.length + tab), kw, sep, name.slice(0, tab), offset, str) + name.slice(tab);
      // wypełniacz wykazu albo szablonu pod etykietą („Nazwisko: Wakat", „Imię i nazwisko: Zastrzeżone")
      if (isEmptyFormValue(name.trim())) return m;
    }
    const parts = name.split(/([ \t]+)/); // parzyste = wyrazy, nieparzyste = oryginalne odstępy
    const words = parts.filter((_, i) => i % 2 === 0);
    // odetnij wiodące role/tytuły po wyzwalaczu — „Pan Dyrektor Kowalski" → zachowaj „Dyrektor".
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    // Obcy wyraz z polską końcówką narzędnika na końcu kandydata po mianowniku „pan/pani" to
    // dopełnienie, nie nazwisko („Czy jeździ pan Škodą?", „Pani Nowak Citroënem"): nazwisko stoi
    // tu w mianowniku, jak sam wyzwalacz. Odcinamy go; gdy nic nie zostaje, to nie osoba.
    let tail = '';
    const lastWord = words[words.length - 1];
    if (/^[Pp]ani?$/.test(kw) && RE_NON_PL_LETTER.test(lastWord) && /(?:ą|em|ami)$/.test(lastWord)) {
      if (words.length - s === 1) return m;
      tail = parts.splice(-2).join('');
      words.pop();
    }
    // Potwierdzone nazwisko i obcy wyraz za nim, który nie jest imieniem („Pan Nowak Škoda", „Czy
    // Pan Nowak Škodę sprzedał?", „Pani Mróz Müllerowi przekazała") — marka albo dopełnienie
    // w dowolnym przypadku. Dawniej szło do maski i stawało się kluczem pseudonimu, więc dwie osoby
    // z tą samą marką dostawały jeden pseudonim.
    // Tylko marka z listy albo obcy wyraz z polską końcówką przypadka zależnego: sam obcy wyraz
    // w mianowniku po nazwisku to imię w szyku „Nazwisko Imię" („Pan Nowak Bjørn", „Pani Nowak
    // Ayşe") i należy do maski — inaczej imię zostawało jawne obok niej.
    if (
      !tail &&
      words.length - s === 2 &&
      RE_NON_PL_LETTER.test(lastWord) &&
      !triggerGivenName(lastWord) &&
      (RE_FOREIGN_BRAND_WORD.test(lastWord) || RE_PL_OBLIQUE_ENDING.test(lastWord))
    ) {
      const w0 = words[s];
      if (surnameBase(w0) || looksLikeSurname(w0) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w0))) {
        tail = parts.splice(-2).join('');
        words.pop();
      }
    }
    // Klucz pseudonimu z nazwiska: w szyku „Nazwisko Imię" („Pani Schröder Anna", „Pan Nagy László")
    // i przy członie środkowym imienia wietnamskiego („Pan Nguyễn Văn Hùng") nazwisko stoi pierwsze.
    // Z kluczem z imienia „Pani Schröder Anna i Pani Müller Anna" dostawały jeden pseudonim, a „Pan
    // Nagy" w dalszej części pisma — inny niż „Pan Nagy László".
    let keyWord = words[words.length - 1];
    let viGiven = '';
    if (words.length - s === 2) {
      const [w0, w1] = [words[s], words[s + 1]];
      if (VI_MIDDLE_NAMES.has(w1.toLowerCase())) {
        keyWord = w0;
        // imię za członem środkowym („… Văn Hùng") stoi już poza kandydatem (najwyżej dwa wyrazy)
        // i zostawało jawne obok maski — zdejmuje je drugi krok za znacznikiem
        viGiven = VI_GIVEN_SENTINEL;
        viTail = true;
      } else if (triggerGivenName(w1) && !triggerGivenName(w0)) keyWord = w0;
      // obce imię za potwierdzonym nazwiskiem („Pan Nowak Bjørn") — kluczem nazwisko
      else if (RE_NON_PL_LETTER.test(w1) && !RE_NON_PL_LETTER.test(w0) && (surnameBase(w0) || looksLikeSurname(w0))) keyWord = w0;
    }
    const surname = words[words.length - 1];
    const sl = surname.toLowerCase();
    // „Pan Wojewoda Mazowiecki", „Pani Sąd" — przymiotnik geo/encja to nie nazwisko; po pominiętej
    // roli także złożenie „Pan Wojewoda Kujawsko-Pomorski" (gołe „Pan X-sko-Y" dalej maskujemy).
    // Sam przymiotnik -ski/-cki tuż po „Pan/Pani" („Pan Poselski złożył", „Pan Mazowiecki") to już
    // nazwisko: bez roli nie ma czego określać.
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase())) return m;
    if (NON_SURNAME_ADJ.has(sl) && !(s === 0 && words.length === 1 && /(?:sk|ck|dzk)i$/.test(sl))) return m;
    if (s > 0 && isCompoundAdjective(sl)) return m;
    // dopełniacz urzędu albo imię sakralne w kandydacie („Pani Minister Zdrowia", „do Pana Boga")
    if (words.slice(s).some((w) => ROLE_COMPLEMENT_GEN.has(w.toLowerCase()))) {
      // …ale nazwisko za imieniem sakralnym to podmiot zdania („Przy kościele Pana Jezusa Gzik
      // rozdawał opłatki", „Do Pana Boga Gzik się modlił") — maska tylko na nim, „Pana Jezusa" zostaje
      const w0 = words[s].toLowerCase();
      const w1 = words[s + 1];
      const w1l = w1?.toLowerCase() ?? '';
      if (
        words.length - s === 2 &&
        RE_SACRED_NAME.test(w0) &&
        !tail &&
        !ROLE_COMPLEMENT_GEN.has(w1l) &&
        !LEGAL_ENTITY_WORDS.has(w1l) &&
        !NON_SURNAME_ADJ.has(w1l) &&
        !isFirstNameGenitive(w1l) &&
        // przydomek w dopełniaczu to dalszy ciąg imienia („Pana Jezusa Frasobliwego", „Miłosiernego")
        !/(?:ego|emu|ym|ej)$/.test(w1l) &&
        (!!surnameBase(w1) || looksLikeSurname(w1) || RE_PAST_VERB_AFTER.test(str.slice(offset + m.length, offset + m.length + 24)))
      ) {
        ctx.bump('IMIE');
        return `${kw}${sep}${parts.slice(0, 2 * s + 2).join('')}${ctx.personMask(w1)}`;
      }
      return m;
    }
    ctx.bump('IMIE');
    // zachowana rola wraz z odstępem za nią („Pan Dyrektor\tKowalski" — tabulator zostaje)
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(keyWord)}${viGiven}${tail}`;
  };
  ctx.text = ctx.text.replace(nameTrigger, onMatch);
  if (viTail) ctx.text = ctx.text.replace(RE_VI_GIVEN_TAIL, '');
}

// (b2) SILNE wyzwalacze self-ID („nazywam się", „mam na imię") — po nich w polszczyźnie ZAWSZE
// następuje imię/nazwisko, więc łapiemy je NIEZALEŻNIE od wielkości liter („nazywam się pAMELA
// nOWAK", „PAMELA", „pamela"). Świadomie NIE obejmuje „Pan/Pani" (po nich bywa czasownik: „Pan był").
// Precyzja: ufamy wyzwalaczowi tylko gdy kandydat wygląda na nazwę własną (wielka pierwsza litera
// któregoś członu) LUB słownik/morfologia potwierdza imię/nazwisko — inaczej „nazywam się tak jak
// trzeba" (same małe litery, brak potwierdzenia) zostaje nietknięte.
function passPersonStrongTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const AC = `[${PL_UP}${PL_LO}]`;
  const CAND = `${AC}{2,}(?:-${AC}{2,})?`;
  const re = new RegExp(
    `\\b(nazywam się|mam na imię)([ \\t:]+)(${CAND}(?:[ \\t]+${CAND}){0,2})(?![${PL_UP}${PL_LO}])`,
    'gi',
  );
  const startsUpper = (w: string): boolean => new RegExp(`^[${PL_UP}]`).test(w.split('-')[0]);
  ctx.text = ctx.text.replace(re, (m, kw: string, sep: string, name: string) => {
    const parts = name.split(/([ \t]+)/); // parzyste = wyrazy, nieparzyste = oryginalne odstępy
    const words = parts.filter((_, i) => i % 2 === 0);
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    const last = words[words.length - 1];
    const ll = last.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase()) || LEGAL_ENTITY_WORDS.has(ll) || NON_SURNAME_ADJ.has(ll)) return m;
    const cand = words.slice(s);
    const properCase = cand.some(startsUpper); // Titlecase/WERSALIK → traktuj jak nazwę własną
    const dictOk = cand.some((w) => isFirstNameLike(w)) || !!surnameBase(last) || looksLikeSurname(last);
    if (!properCase && !dictOk) return m;
    ctx.bump('IMIE');
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(last)}`;
  });
}

// (c) SAMODZIELNE nazwisko ze słownika najczęstszych nazwisk (z odmianą).
function passPersonSoloDict(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_DICT, (m, offset: number) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    // ogon obcych liter: o nazwisku rozstrzyga polski rdzeń, co najmniej czteroliterowy
    const tailAt = m.search(RE_FOREIGN_TAIL_START);
    if (tailAt !== -1) {
      if (tailAt < 4 || !RE_SLAVIC_TAIL_START.test(m.slice(tailAt)) || !surnameBase(m.slice(0, tailAt))) return m;
    } else if (!surnameBase(m)) return m;
    // „choroba Kowalskiego", „ulica Kwiatkowska", „im. Mickiewicza" — kontekst nie-osobowy
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m; // „Powiat: …", „Gmina: …"
    if (afterNonPersonContext(ctx.text, offset, m, ctx.maskedSurnames)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(m);
  });
}

// Lewa granica INICJAŁU: przed literą nie może stać litera (także polska) ani kropka. ASCII \b
// przepuszczał ostatni człon kropkowego skrótu („S" z „P.S.", „A" z „S.A.", „U" z „Dz.U.",
// „O" z „O.O.") jako inicjał imienia, a odrzucał „Ł."/„Ś." po spacji (brak granicy przed
// znakiem spoza ASCII) — stąd „ORLEN S.[IMIĘ I NAZWISKO]" i jawne „mec. Ł. Baran".
const INITIAL_START = `(?<![.\\w${PL_UP}${PL_LO}])`;
/**
 * Czy „P." na pozycji `offset` to skrót „Pan/Pani" z nagłówka listu („Sz. P. Andrzej Górski",
 * „Szanowny P. Kowalski", „Wielmożna P. …"), a nie inicjał imienia? Wtedy „P." zostaje przed
 * maską. Zapisy bez spacji („Sz.P.", „W.P.") odcina już INITIAL_START (kropka przed literą).
 */
function isHonorificP(t: string, offset: number): boolean {
  if (t[offset] !== 'P') return false;
  return /(?:(?<!\p{L})[Ss][Zz]\.|(?<!\p{L})[SsWw](?:zanown|ielmożn)\p{L}*)[ \t]+$/u.test(t.slice(Math.max(0, offset - 40), offset));
}

// Łańcuch kropkowy sklejony bez spacji, zakończony wielką literą z kropką: „J.M.", „Dr.J.",
// „P.H.U.", „Sz.P.". INITIAL_START odcina ostatni człon (stoi po kropce), więc o tym, czy łańcuch
// kotwiczy osobę, rozstrzyga dotChainKind. Powtórzenia ograniczone ({1,5}, {1,4}) — koszt stały.
const DOT_CHAIN = `(?<![.\\w${PL_UP}${PL_LO}])((?:[${PL_UP}${PL_LO}]{1,5}\\.){1,4})([${PL_UP}])\\.`;
// Skróty z dwóch liter, które NIE są inicjałami osoby (P.S. Mróz, ORLEN S.A., PKO B.P., O.K.).
const DOT_CHAIN_NOT_PERSON = new Set<string>('ps pps sa sc sj sk ska bp us oo ok ad po rp ue mp op'.split(' '));
// Łańcuchy, po których stoi nazwisko, a sam łańcuch zostaje w tekście: formy działalności
// jednoosobowej („P.H.U. Wilk" — w nazwie firmy nazwisko właściciela) i „W.P."/„Ś.P." (Pan, świętej pamięci).
const DOT_CHAIN_KEEP = new Set<string>(
  ('ph phu pphu phup pphup fh fhu fhup fphu fph puh ppuh fuh pu fu pw ppw zph zphu zpuh zuh pph phpu ' +
    'fhpu pthu wp śp').split(' '),
);
// Tytuł sklejony z inicjałem („Dr.J. Kowalski", „mgr.A. Nowak", „r.pr.J. Nowak") — tytuł zostaje.
const DOT_TITLES = new Set<string>('dr mgr prof mec inż adw lek med hab ks red płk gen kpt mjr por sierż sędz r pr st apl'.split(' '));
/**
 * Rodzaj łańcucha `head` + `ini.` przed nazwiskiem: 'absorb' — dwa inicjały osoby („J.M. Wilk"
 * → cała maska), 'keepChain' — skrót zostaje, nazwisko w masce („P.H.U. [..]", „Sz.P. [..]"),
 * 'keepTitle' — tytuł zostaje, inicjał w masce („Dr.[..]"), null — to nie kotwica osoby.
 */
function dotChainKind(head: string, ini: string): 'absorb' | 'keepChain' | 'keepTitle' | null {
  const toks = head.slice(0, -1).split('.');
  const letters = (toks.join('') + ini).toLowerCase();
  if (toks.every((x) => x.length === 1 && x !== x.toLowerCase())) {
    if (DOT_CHAIN_KEEP.has(letters)) return 'keepChain';
    // trzy i więcej liter to skrót (P.P.S.), nie inicjały; dwie — inicjały, chyba że znany skrót
    return toks.length === 1 && !DOT_CHAIN_NOT_PERSON.has(letters) ? 'absorb' : null;
  }
  if (toks.length === 1 && /^[Ss]z$/.test(toks[0]) && ini === 'P') return 'keepChain'; // „Sz.P." = Szanowny Pan
  return toks.every((x) => DOT_TITLES.has(x.toLowerCase())) ? 'keepTitle' : null;
}

/** Czy `w2` po kotwicy inicjału to nazwisko (słownik, końcówka, homograf) w kontekście osobowym? */
function initialAnchorsSurname(ctx: RedactCtx, w2: string, offset: number): boolean {
  const wl = w2.toLowerCase();
  if (LEGAL_ENTITY_WORDS.has(wl) || NON_SURNAME_ADJ.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return false;
  if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return false;
  if (afterNonPersonContext(ctx.text, offset, w2)) return false;
  return !!surnameBase(w2) || looksLikeSurname(w2) || !!homographBase(w2);
}

// (c1a) INICJAŁ + nazwisko („A. Baran", „J. Kowalski"). Inicjał to kotwica OSOBOWA.
function passPersonInitial(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      // Tanie warunki NAJPIERW (granica + lookahead na „X. "): lookbehindy o zmiennej długości
      // (początek wiersza, koniec zdania) liczą się wtedy tylko tam, gdzie naprawdę stoi inicjał.
      // Początek wiersza to też dosłowna ucieczka „\n"/„\r" z JSON-a (punkt wyliczenia „A.").
      // „Sz." na liście skrótów: „Sz. P. Wilk" to nagłówek listu, nie koniec zdania.
      `${INITIAL_START}(?=[${PL_UP}]\\.[ \\t])(?<!(?:^|\\n|\\\\[\\uE00A\\uE00D])[ \\t]*)(?<!(?<!\\b(?:[Mm]ec|[Pp]rof|[Dd]r|[Mm]gr|[Ii]nż|hab|[Aa]dw|[Kk]s|płk|gen|kpt|mjr|por|sierż|lek|med|[Ss]ędz|[Ss]z))[.!?][ \\t]+)[${PL_UP}]\\.[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`,
      'g',
    ),
    (m, w2: string, offset: number) => {
      if (!initialAnchorsSurname(ctx, w2, offset)) return m;
      ctx.bump('IMIE');
      // „Szanowny P. Kowalski" — „P." to „Pan", kotwica osobowa jak inicjał, ale zostaje w tekście
      if (isHonorificP(ctx.text, offset)) return `${m.slice(0, m.length - w2.length)}${ctx.personMask(w2)}`;
      return ctx.personMask(w2);
    },
  );
  // Łańcuch kropkowy przed nazwiskiem („SSO J.M. Wilk", „P.H.U. Wilk", „Dr.J. Wilk"). Bez tego
  // homograf po dwóch inicjałach zostawał jawny — jedyną jego kotwicą jest inicjał.
  ctx.text = ctx.text.replace(
    new RegExp(`${DOT_CHAIN}([ \\t]+)(${CAP_WORD})(?![${NM_BOUND}])`, 'g'),
    (m, head: string, ini: string, sep: string, w2: string, offset: number) => {
      const kind = dotChainKind(head, ini);
      if (!kind || !initialAnchorsSurname(ctx, w2, offset)) return m;
      ctx.bump('IMIE');
      const mask = ctx.personMask(w2);
      if (kind === 'absorb') return mask;
      if (kind === 'keepTitle') return `${head}${mask}`;
      return `${head}${ini}.${sep}${mask}`;
    },
  );
}

// Tytuł naukowy, zawód prawniczy albo rola procesowa tuż przed nazwiskiem-homografem („dr Mróz",
// „do dr. Sikory", „adw. Wilk wnosi", „Prokurator Baran", „świadka Wróbla", „p. Wróbla"). Homograf
// sam w sobie nie jest maskowany (wilk, mróz, sikora to też słowa pospolite), więc przy kotwicy
// osobowej zostawał jawny, choć obok stał ten sam człowiek z imieniem. Gołe „lek." to też lek,
// więc tylko „lek. med."/„lek. dent."; „p." nie po liczbie i nie jako „p.o.".
const RE_HOMOGRAPH_ANCHOR = new RegExp(
  `(?<![\\p{L}\\p{N}.])(?:[Dd]r\\.?(?:[ \\t]+hab\\.)?|[Pp]rof\\.|lek\\.[ \\t]+(?:med|dent)\\.|[Aa]dw\\.|apl\\.[ \\t]+adw\\.|[Mm]ec\\.|r\\.[ \\t]?pr\\.|` +
    `[Pp]rokurator(?:a|owi|em)?|[Ss]ędzi(?:a|ego|emu|ą|ę)|[Śś]wiad(?:ek|ka|kowi|kiem)|[Bb]iegł(?:y|ego|emu|ym|a|ą|ej)|` +
    `[Pp]ełnomocni(?:k|ka|kowi|kiem)|[Oo]brońc(?:a|y|ą|ę)|[Pp]ow(?:ód|oda|odowi|odem|ódka|ódki)|[Pp]ozwan(?:y|ego|emu|ym|a|ej|ą)|` +
    `[Oo]skarżon(?:y|ego|emu|ym|a|ej|ą)|[Mm]ecenas(?:a|owi|em)?|(?<![IVXLC\\d][ \\t]?)p\\.(?!o\\.))[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`,
  'gu',
);
// Także skrót formy prawnej bez kropek, „FHU/PPHU", człony nazw firm windykacyjnych i transportowych
// („Powód Kruk SA", „Pozwany Wilk Trans") i „z siedzibą" — osoba fizyczna ma „zamieszkały".
const RE_HOMOGRAPH_FIRM_AFTER =
  /^(?:[ \t]+\p{Lu}[\p{L}-]*){0,3}[ \t]*(?:S\.?A\.|[Ss][Pp]\.[ \t]*(?:z[ \t]*o\.[ \t]*o\.|[jkp]\.|komandytowa|jawna|akcyjna|partnerska)|[Ss]półk\p{L}*|i[ \t]+(?:Wspólnicy|Partnerzy|Syn(?:owie)?)(?!\p{L})|Towarzystw\p{L}*|Ubezpiecze\p{L}*|Logistics|Transport|Group|Holding|Polska(?!\p{L})|SA(?!\p{L})|S\.?C\.|F\.?H\.?U\.?(?!\p{L})|P\.?P\.?H\.?U\.?(?!\p{L})|P\.?H\.?U\.?(?!\p{L})|Trans\p{L}*|Windykacj\p{L}*|Fundusz\p{L}*|Finans\p{L}*|Finance|Capital|Invest\p{L}*|Serwis|Service|Consulting|z[ \t]+siedzibą)/u;
// Skrót patrona („im.", „imienia", „ul.", „al.", „pl.") z ewentualnymi wcześniejszymi tytułami tuż
// przed kotwicą homografu („im. prof. " przed „dr hab. Wilka").
const RE_PATRON_BEFORE_TITLE = new RegExp(
  `(?<![\\p{L}\\d])(?:(?:im|ul|al|pl)\\.|imienia)(?:[ \\t]+${STREET_RANK})*[ \\t]+$`,
  'iu',
);
function passPersonHomographAnchor(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_HOMOGRAPH_ANCHOR, (m, w: string, offset: number, t: string) => {
    const hb = homographBase(w);
    if (!hb || HOMOGRAPH_PAIR_EXCL.has(hb) || isFirstNameLike(w)) return m;
    // Strona procesowa bywa spółką („Powód Kruk S.A.", „Pozwany Wilk Sp. z o.o.", „Pozwana Wrona
    // i Wspólnicy Sp. k.", „Pozwana Sowa Ubezpieczenia S.A.") — homograf jest wtedy nazwą firmy.
    if (RE_HOMOGRAPH_FIRM_AFTER.test(t.slice(offset + m.length, offset + m.length + 80))) return m;
    // Patron instytucji albo ulicy z tytułem („Szpital im. dr. Wilka", „Centrum Onkologii im.
    // prof. Lisa", „Ośrodek im. prof. dr hab. Wilka", „ul. dr. Mazura") — homograf w nazwie to nie
    // osoba z pisma. W trybie pseudonimów patron dostawał etykietę pracownika o tym samym nazwisku.
    if (RE_PATRON_BEFORE_TITLE.test(t.slice(Math.max(0, offset - 40), offset))) return m;
    ctx.bump('IMIE');
    return `${m.slice(0, m.length - w.length)}${ctx.personMask(hb)}`;
  });
}

// (c1b) OBCE imię DWUCZŁONOWE z myślnikiem + nazwisko („Jean-Pierre Dubois").
function passPersonForeign(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([${NM_UP}][${NM_LO}]{1,6}-[${NM_UP}][${NM_LO}]{1,6})[ \\t]+` +
        `((?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]i|Da|[Bb]in|[Tt]er|El|Al)[ \\t]+)?` +
        `${CAP_WORD})(?![${NM_BOUND}])`,
      'g',
    ),
    (m, first: string, w2: string) => {
      const [f1, f2] = first.toLowerCase().split('-');
      if (!FOREIGN_GIVEN_NAMES.has(f1) && !FOREIGN_GIVEN_NAMES.has(f2)) return m;
      const last = w2.split(/[ \t]+/).pop() ?? w2;
      const wl = last.toLowerCase();
      if (LEGAL_ENTITY_WORDS.has(wl) || NON_SURNAME_ADJ.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      ctx.bump('IMIE');
      return ctx.personMask(last);
    },
  );
}

/**
 * Czy wyraz z COMMON_NOUN_LOOKALIKES to tu rzeczownik, a nie nazwisko? Nazwa mieszkańca
 * („Chińczyk") — zawsze. Zdrobnienie, które bywa nazwiskiem (Kluczyk, Mieczyk), tylko na początku
 * zdania i bez czasownika w czasie przeszłym tuż za nim („Kluczyk do skrzynki leży…", ale
 * „Kluczyk złożył wniosek" to osoba); w środku zdania („świadek Krzaczyk potwierdził", „Odebrał:
 * Kluczyk") i po wcześniejszym rozpoznaniu tej osoby w dokumencie („Andrzej Mieczyk … Mieczyk
 * zajmuje lokal") to nazwisko.
 */
function lookalikeIsCommonNoun(ctx: RedactCtx, t: string, offset: number, m: string): boolean {
  if (ctx.maskedSurnames.has(normalizeSurnameKey(m))) return false;
  if (!DIMINUTIVE_LOOKALIKES.has(m.toLowerCase())) return true;
  let i = offset - 1;
  while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
  if (i >= 0 && !/[\n\r.!?…]/.test(t[i])) return false;
  // kropka po skrócie tytułu („lek. Kluczyk", „dr n. med. Krzaczyk", „inż. Kluczyk") nie kończy zdania
  if (i >= 0 && t[i] === '.' && RE_TITLE_BEFORE_DOT.test(t.slice(Math.max(0, i - 8), i))) return false;
  // Rzeczownikiem jest tylko z frazą rzeczownikową za nim: przyimkiem („Kluczyk do skrzynki",
  // „Kluczyk od szafki") albo przymiotnikiem („Mieczyk ogrodowy", „Kluczyk zapasowy"). Czasownik
  // w dowolnym czasie, przeczenie, przecinek, nawias, inicjał, koniec wiersza (podpis, lista, komórka
  // TSV) — to nazwisko: „Mieczyk wnosi o …", „Kluczyk nie stawił się", „Z poważaniem⏎Kluczyk".
  // Tylko „do/od" jak przy narzędziu: „Kluczyk z działu kadr potwierdził", „Kluczyk na zwolnieniu
  // lekarskim", „Krzaczyk od 2015 r. pracuje" (liczba za „od") to notatka o osobie. Imiesłów
  // i przymiotnik stanu osoby („Mieczyk zatrudniony od …", „Mieczyk przytomny") też.
  const after = t.slice(offset + m.length, offset + m.length + 30);
  const next = /^[ \t]+(\p{Ll}+)(?!\p{L})/u.exec(after)?.[1];
  if (!next) return false;
  if (RE_NOUN_PHRASE_PREP.test(next)) return !/^[ \t]+\p{Ll}+[ \t]+\d/u.test(after) && !RE_PERSON_STATE_LOC_AFTER.test(after);
  return next.length >= 5 && RE_LOWER_ADJECTIVE.test(next) && !RE_PERSON_STATE_ADJ.test(next);
}
// Skrót tytułu lub stopnia tuż przed kropką („lek.", „med.", „inż.", „dr n.").
const RE_TITLE_BEFORE_DOT = /(?<!\p{L})(?:lek|med|inż|hab|prof|mgr|dr|doc|mec|adw|ks|piel|fizj|asp|sierż|st|mł|n|kpt|por|mjr|płk|gen|sędz|prok|r\.pr|r)$/iu;
const RE_NOUN_PHRASE_PREP = /^(?:do|od|w|we|na)$/;
// „na zwolnieniu", „na urlopie", „w delegacji" — stan pracownika, nie położenie przedmiotu
const RE_PERSON_STATE_LOC_AFTER =
  /^[ \t]+(?:na|w|we)[ \t]+(?:zwolnieniu|urlopie|dyżurze|zmianie|delegacji|szkoleniu|zasiłku|rencie|emeryturze|L4|wypowiedzeniu|okresie)(?!\p{L})/u;
const RE_PERSON_STATE_ADJ = /(?:on|ion|ęt|yt|it)y$|^(?:nie)?(?:przytomny|obecny|chory|zdrowy|aktywny|dostępny|spokojny|pobudzony|wydolny|samodzielny|sprawny)$/;
// przymiotnik w mianowniku rodzaju męskiego, uzgodniony z „Kluczyk/Mieczyk" („zapasowy", „ozdobny", „złoty")
const RE_LOWER_ADJECTIVE = /(?:owy|ny|ty|wy|ski|cki|szy)$/;

const RE_CSV_NAME_CELL_AFTER = /^[ \t]*[;|\t][ \t]*(\p{Lu}\p{Ll}+)[ \t]*(?:[;|\t]|\r?\n|$)/u;
function csvSurnameCellBeforeName(t: string, offset: number, m: string): boolean {
  if (!/[;|\t][ \t]*$/.test(t.slice(Math.max(0, offset - 3), offset))) return false;
  const name = RE_CSV_NAME_CELL_AFTER.exec(t.slice(offset + m.length, offset + m.length + 40))?.[1];
  return !!name && POLISH_FIRST_NAMES.has(name.toLowerCase());
}
// Rola w dopełniaczu tuż przed wyrazem („wobec dłużnika Bartnicza", „pozew wierzyciela …") —
// dopełniacz nazwiska na „-nicz" morfologia odrzuca jako przymiotnik (Komornicza, Rolnicza).
const RE_ROLE_GEN_BEFORE = /(?<!\p{L})(?:dłużnika|wierzyciela|pozwanego|powoda|świadka|wnioskodawcy|uczestnika|oskarżonego|pana)[ \t]+$/iu;
// (c2) SAMODZIELNE nazwisko rozpoznane MORFOLOGICZNIE (sufiks -ski/-cki/-icz/-czyk).
function passPersonSoloMorph(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_MORPH, (m, offset: number, t: string) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    // Komórka CSV/TSV przed komórką z imieniem („2;Poleski;Adam;Kraków", „4;Duńczyk;Piotr") to
    // kolumna nazwiska: stoplista przymiotników i nazw mieszkańców jej nie odbiera.
    const csvSurname =
      (/(?:sk|ck|dzk)[ia]$|czyk$/.test(m.toLowerCase()) && csvSurnameCellBeforeName(t, offset, m)) ||
      (/[^aeiouyąęó]nicza$/.test(m.toLowerCase()) && RE_ROLE_GEN_BEFORE.test(t.slice(Math.max(0, offset - 16), offset)));
    // rzeczownik pospolity na -czyk („Kluczyk do skrzynki", „Chińczyk i Japończyk") — tylko bez
    // inicjału przed nim: „J. Kluczyk" na początku wiersza łapie wyłącznie ten przebieg
    if (
      !csvSurname &&
      COMMON_NOUN_LOOKALIKES.has(m.toLowerCase()) &&
      !/[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]+$/.test(t.slice(Math.max(0, offset - 4), offset)) &&
      lookalikeIsCommonNoun(ctx, t, offset, m)
    )
      return m;
    // „Słowiński Park Narodowy" — człon nazwy parku, nie nazwisko
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    const first = m.split('-')[0];
    // morfologia LUB słownik (słownik łapie formę z myślnikiem: „Nowak-Schmidt")
    if (!csvSurname && !looksLikeSurname(m) && !looksLikeSurname(first) && !surnameBase(m) && !surnameBase(first)) return m;
    // drugi człon złożenia z wielkiej litery (np. „… Warszawski") → to przymiotnik nazwy.
    if (PRECEDED_BY_CAP.test(ctx.text.slice(Math.max(0, offset - 40), offset))) return m;
    // eponim/ulica po wyrazie z małej litery oraz patron instytucji
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m;
    if (afterNonPersonContext(ctx.text, offset, m, ctx.maskedSurnames)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(first);
  });
}

// Tytuły/role, po których (WERSALIKAMI) stoi imię/nazwisko. Baza: TITLE_WORDS + ROLE_WORDS;
// dopełnione o „Pan" w narzędniku/l.mn. (TITLE_WORDS ma tylko mianownik/wołacz) i skróty sędziowskie.
const ALLCAPS_TITLES = new Set<string>([
  ...TITLE_WORDS,
  ...ROLE_WORDS,
  'panem', 'panów', 'panom', 'panami', 'paniom',
  'sso', 'ssr', 'ssa', 'mec', 'adw',
]);

// (c2b) TYTUŁ/ROLA + IMIĘ/NAZWISKO — wszystko WERSALIKAMI („SSO JAN KOWALSKI",
// „PANEM MARKIEM WIŚNIEWSKIM", „PAN KOWALSKI"). Zapis Titlecase obsługują wyzwalacze/pary; tu
// domykamy WERSALIKI, których reguły Titlecase nie łapią, a `passPersonOcrPair` odrzuca (pierwszy
// token to tytuł). Precyzja: wymagany ROZPOZNANY tytuł + nazwisko POTWIERDZONE słownikiem/morfologią
// i NIE będące encją prawną/rolą ani przymiotnikiem odmiejscowym — dzięki temu nagłówki instytucji
// WERSALIKAMI („SĄD OKRĘGOWY…", „UNIWERSYTET WARSZAWSKI") zostają nietknięte. Uruchamiane PRZED
// passPersonOcrPair, żeby ten nie sparował zachłannie „tytuł + imię" i nie osierocił nazwiska.
function passPersonOcrTitle(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const UPW = `[${PL_UP}]{2,}`;
  const NAMEW = `[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?`;
  const confirmedSurname = (l: string): boolean =>
    !!surnameBase(l) ||
    looksLikeSurname(l) ||
    (l.includes('-') && l.split('-').some((p) => !!surnameBase(p) || looksLikeSurname(p)));
  ctx.text = ctx.text.replace(
    new RegExp(
      `(?<![${PL_UP}${PL_LO}0-9.\\-])(${UPW})([ \\t]+)(${NAMEW}(?:[ \\t]+${NAMEW})?)(?![${PL_UP}${PL_LO}0-9\\-])`,
      'g',
    ),
    (m, title: string, sep: string, name: string, offset: number) => {
      if (!ALLCAPS_TITLES.has(title.toLowerCase())) return m;
      if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
      const nameWords = name.split(/[ \t]+/);
      // żaden człon nazwy nie może być rolą/tytułem/encją prawną (chroni „PREZES ZARZĄDU SPÓŁKI")
      if (
        nameWords.some((w) => {
          const l = w.toLowerCase();
          return LEGAL_ENTITY_WORDS.has(l) || ROLE_WORDS.has(l) || TITLE_WORDS.has(l);
        })
      )
        return m;
      const last = nameWords[nameWords.length - 1];
      const ll = last.toLowerCase();
      if (NON_SURNAME_ADJ.has(ll)) return m; // „WOJEWODA MAZOWIECKI" — przymiotnik odmiejscowy, nie nazwisko
      // Nazwisko MUSI być potwierdzone (chroni nagłówki instytucji). Homograf („DŁUŻNIK JERZY PIĄTEK",
      // „ŚWIADEK EWA MAJ") po roli i imieniu w mianowniku też jest nazwiskiem: dawniej zostawał jawny,
      // choć ta sama osoba w dopełniaczu („DŁUŻNIKA JERZEGO PIĄTKA") dostawała maskę.
      const homographAfterGiven =
        nameWords.length === 2 && POLISH_FIRST_NAMES.has(nameWords[0].toLowerCase()) && !isFirstNameLike(ll) && !!homographBase(ll);
      if (!confirmedSurname(ll) && !homographAfterGiven) return m;
      ctx.bump('IMIE');
      return `${title}${sep}${ctx.personMask(last)}`;
    },
  );
}

// Homografy, które przy imieniu nie są nazwiskiem: dzień i miesiąc w grafiku („PIĄTEK 3 MAJA"),
// urząd („ANNA STAROSTA", „JAN SOŁTYS"), narodowość i imię-homograf („JAN MAREK", „EWA KALINA"
// to dwa imiona).
const HOMOGRAPH_PAIR_EXCL = new Set<string>(
  'piątek sobota niedziela środa kwiecień maj marzec styczeń grudzień lipiec sierpień sołtys starosta turek czech niemiec prus cygan góral polak kalina jagoda marek'.split(' '),
);
/** Imię + nazwisko-homograf („MAREK DUDA", „MARCINA WRÓBLA") — forma bazowa homografu albo null.
 *  Imię ze słownika (w dowolnym przypadku) i homograf, który sam nie jest imieniem. */
function homographPairBase(n1: string, n2: string): string | null {
  if (!isFirstNameLike(n1) || NOUN_LIKE_FIRST_NAMES.has(n1) || nounLikeNameForm(n1) || isFirstNameLike(n2)) return null;
  const hb = homographBase(n2);
  return hb && !HOMOGRAPH_PAIR_EXCL.has(hb) ? hb : null;
}
// Wyraz uliczny albo „ADRES:" tuż przed parą WERSALIKAMI („ULICA KOŚCIUSZKI TADEUSZA", „OSIEDLE
// KOPERNIKA MIKOŁAJA", „PRZY ALEI …", „ADRES: MICKIEWICZA ADAMA 5") — patron, nie osoba. Regex
// STREET_ANCHOR_SRC zna tylko zapis Titlecase.
// Jeden wyraz pośrodku („IM. IGNACEGO JANA PADEREWSKIEGO", „UL. GEN. JÓZEFA BEMA").
const RE_CAPS_STREET_BEFORE =
  /(?:^|[^\p{L}])(?:ul|al|os|pl|im|gen|ks|św|ulica|ulicy|ulicę|ulicą|aleja|alei|aleje|aleję|osiedle|osiedla|osiedlu|plac|placu|placem|rondo|ronda|rondzie|most|mostu|moście|skwer|skweru|imienia|adres|patron|patrona)[.:]?[ \t]+(?:\p{Lu}{2,}\.?[ \t]+)?$/iu;
const capsStreetBefore = (t: string, offset: number): boolean => RE_CAPS_STREET_BEFORE.test(t.slice(Math.max(0, offset - 32), offset));
// Wyraz WERSALIKAMI tuż przed parą w dopełniaczu („UNIWERSYTET ADAMA MICKIEWICZA", „STADION KAZIMIERZA
// GÓRSKIEGO", „AKADEMIA WYCHOWANIA FIZYCZNEGO JÓZEFA PIŁSUDSKIEGO") — nazwa z patronem. Tytuł albo
// rola przed nią („PANEM PIOTREM WILKIEM") i etykieta z dwukropkiem („PRZELEW OD: KATARZYNY SIKORY")
// to dalej osoba.
const RE_CAPS_WORD_BEFORE = /(?:^|[^\p{L}])(\p{Lu}{2,})[ \t]+$/u;
// Przyimek albo rzeczownik-rola/dokument w dopełniaczu przed parą to nie nazwa obiektu z patronem:
// „ALIMENTY DLA ZUZANNY WOLSKIEJ", „CZYNSZ OD ANNY KOWALSKIEJ", „KARTA PACJENTA ANNY KOWALSKIEJ",
// „ŚWIADECTWO PRACY ADAMA NOWAKA" — osoba. Celowo krótka lista (bez wyrazów instytucji): nazwy
// obiektów („ZESPÓŁ SZKÓŁ JANA KOWALSKIEGO", „CHOROBA STANISŁAWA LEŚNIOWSKIEGO") dalej chronią.
// Rola procesowa albo strona umowy w dopełniaczu i celowniku („WEZWANIE ŚWIADKA ANNY KOWALSKIEJ",
// „W OBECNOŚCI DŁUŻNIKA JANA NOWAKA", „APELACJA OSKARŻONEGO …", „DORĘCZYĆ POZWANEMU …") — za nią
// stoi osoba, nie patron obiektu. ALLCAPS_TITLES zna tylko mianownik tych ról, więc para była
// brana za nazwę z patronem i zostawała jawna. Bez „brata/syna/siostry" („SCHRONISKO BRATA
// ALBERTA CHMIELOWSKIEGO" to patron).
const CAPS_ROLE_OBLIQUE = new Set(
  (
    'świadka świadkowi powoda powodowi powódki powódce pozwanego pozwanej pozwanemu ' +
    'oskarżonego oskarżonej oskarżonemu obwinionego obwinionej obwinionemu podejrzanego podejrzanej podejrzanemu ' +
    'pokrzywdzonego pokrzywdzonej pokrzywdzonemu poszkodowanego poszkodowanej uczestnika uczestniczki uczestnikowi ' +
    'obrońcy pełnomocnika pełnomocnikowi dłużnika dłużniczki dłużnikowi wierzyciela wierzycielki wierzycielowi ' +
    'skazanego skazanej skazanemu nieletniego nieletniej małoletniego małoletniej spadkodawcy spadkodawczyni ' +
    'spadkobiercy spadkobierczyni biegłego biegłej najemcy najemczyni wynajmującego kupującego sprzedającego ' +
    'darczyńcy obdarowanego obdarowanej zainteresowanego zainteresowanej wnioskodawczyni ' +
    'właściciela właścicielki współwłaściciela współwłaścicielki lokatora lokatorki ' +
    'matki ojca żony męża'
  ).split(' '),
);
const CAPS_HEAD_NOT_NAME = new Set([
  ...(
    'dla od do przez za przy ze na we po wobec przeciwko oraz ' +
    'pacjenta pacjentki pracy choroby przesłuchania pracownika pracownicy ucznia uczennicy klienta klientki ' +
    'ubezpieczonego ubezpieczonej zmarłego zmarłej osoby dziecka wnioskodawcy ' +
    // „PRZY UDZIALE/POMOCY/ASYŚCIE/OBECNOŚCI JANA NOWAKA" — czynność z udziałem osoby (protokół
    // zajęcia, oględzin), nie nazwa obiektu z patronem
    'udziale udziałem współudziale pomocy asyście obecności'
  ).split(' '),
  ...CAPS_ROLE_OBLIQUE,
]);
/** Czy tuż przed parą WERSALIKAMI stoi rola w przypadku zależnym (patrz CAPS_ROLE_OBLIQUE)? */
const capsRoleObliqueBefore = (t: string, offset: number): boolean => {
  const w = RE_CAPS_WORD_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
  return !!w && CAPS_ROLE_OBLIQUE.has(w.toLowerCase());
};
// Rzeczownik dokumentu przed przymiotnikiem i parą („AKTA OSOBOWE ANNY KOWALSKIEJ", „DOKUMENTACJA
// MEDYCZNA …", „WNIOSEK URLOPOWY JANA NOWAKA") — akta osoby, nie nazwa z patronem jak „SZKOŁA
// PODSTAWOWA JANA KOCHANOWSKIEGO".
// Rzeczownik dokumentu może stać też przed dopełniaczem albo dłuższym ciągiem („AKTA SPRAWY …",
// „UMOWA NAJMU …", „KARTA INFORMACYJNA LECZENIA SZPITALNEGO …", „AKT NOTARIALNY …") — liczy się
// cały ciąg wersalików przed parą, chyba że między dokumentem a parą stoi głowa instytucji
// („HISTORIA SZKOŁY JANA KOCHANOWSKIEGO" to dalej szkoła z patronem).
const CAPS_DOC_NOUNS = new Set(
  (
    'akta akt dane teczka dokumentacja wniosek karta ocena zaświadczenie opinia historia skierowanie świadectwo orzeczenie umowa informacja ankieta książeczka kartoteka ' +
    'archiwum stypendium testament pełnomocnictwo protokół notatka oświadczenie zeznanie polisa legitymacja życiorys ' +
    // pisma kadrowe i zestawienia osoby („WYPOWIEDZENIE UMOWY JANA KOWALSKIEGO", „LISTA PŁAC JANA NOWAKA",
    // „LIST MOTYWACYJNY JANA NOWAKA")
    'wypowiedzenie lista list podanie skarga deklaracja zgłoszenie wezwanie zawiadomienie kwestionariusz rozliczenie aneks'
  ).split(' '),
);
// Przymiotnik prywatności w nazwie („FUNDACJA RODZINNA JANA NOWAKA", „ARCHIWUM PRYWATNE …",
// „NAGRODA SPECJALNA …", „DOKUMENTACJA PRACOWNICZA …") — rzecz konkretnej osoby, nie patron.
const RE_CAPS_PRIVATE_ADJ = /^(?:RODZINN|PRYWATN|OSOBIST|SPECJALN|INDYWIDUALN|PRACOWNICZ|NOTARIALN|SPADKOW)\p{Lu}*$/u;
// Do czterech wyrazów WERSALIKAMI tuż przed parą (ta sama linia).
const RE_CAPS_RUN_BEFORE = /(?:^|[^\p{L}])((?:\p{Lu}{2,}[ \t]+){1,4})$/u;
// Rzeczownik, nie przymiotnik od niego („SZPITALNEGO" w „KARTA INFORMACYJNA LECZENIA SZPITALNEGO").
const capsOrgHead = (w: string): boolean =>
  ORG_HEAD_WORDS.has(w) ||
  PATRON_GEN_HEADS.has(w) ||
  (/^(?:szkoł|zespoł|zespół|uniwersyt|akademi|instytut|fundacj|stowarzysz|towarzystw|klub|teatr|muze|stadion|parafi|kości|szpital|liceum|gimnazj|przedszkol|bibliotek|galeri|ośrod|centrum)/.test(w) &&
    !/(?:n|sk|ck|ow)(?:y|a|e|i|ego|iego|ej|iej|ym|ych|emu|ą)$/.test(w));
/** Czy ciąg wersalików przed parą to dokument albo rzecz konkretnej osoby (patrz CAPS_DOC_NOUNS)? */
function capsDocRunBefore(before: string): boolean {
  const run = RE_CAPS_RUN_BEFORE.exec(before.slice(-60))?.[1];
  if (!run) return false;
  const ws = run.trim().split(/[ \t]+/);
  for (let i = ws.length - 1; i >= 0; i--) {
    const l = ws[i].toLowerCase();
    if (i > 0 && RE_CAPS_PRIVATE_ADJ.test(ws[i])) return true;
    if (CAPS_DOC_NOUNS.has(l)) return true;
    if (capsOrgHead(l)) return false;
  }
  return false;
}
// Nazwa drogi albo odcinka w nagłówku WERSALIKAMI („REMONT DROGI OD ADAMA MICKIEWICZA DO TADEUSZA
// KOŚCIUSZKI", „TRASA ROWEROWA OD …").
const RE_CAPS_ROUTE_HEAD = /(?<!\p{L})(?:DROG|TRAS|ODCIN|ŚCIEŻK|CHODNIK|JEZDNI|ULIC|KANALIZACJ|WODOCIĄG|OBJAZD|LINI)\p{Lu}*(?!\p{L})/u;
/**
 * Czy wyraz WERSALIKAMI tuż przed parą w dopełniaczu to głowa nazwy z patronem? Przyimek i rola
 * w dopełniaczu wskazują osobę (patrz CAPS_HEAD_NOT_NAME), z wyjątkiem ulicy z patronem bez „UL.":
 * „PRZY" z dopełniaczem albo odcinek drogi „OD … DO …". `end` — koniec pary, `n1` — jej pierwszy
 * wyraz małymi literami.
 * Numer domu za parą („NAJEMCA LOKALU ADAMA MICKIEWICZA 30/2.", „DOM PRZY STANISŁAWA WYSPIAŃSKIEGO
 * 5.", „PRZELEW DO: JAN NOWAK HENRYKA SIENKIEWICZA 12") rozstrzyga patronStreetWithNumber: [ADRES]
 * przy pewnej kotwicy, a para, z której adres nie powstał, zostaje osobą — wyraz przed nią nie
 * zdejmuje już maski. Wyjątek: prawdziwa głowa nazwy instytucji albo obiektu („SZKOŁA …").
 */
// Liczba w kształcie numeru domu za parą WERSALIKAMI. Rok („TRENY JANA KOCHANOWSKIEGO 1580", „ROK
// ADAMA MICKIEWICZA 2022") i liczebnik przed rzeczownikiem („FRASZKI … 3 KSIĘGI") numerem nie są,
// więc głowa nazwy utworu albo wydarzenia dalej chroni parę przed maską osoby.
// Głowa nazwy obiektu, wydarzenia albo dzieła z patronem WERSALIKAMI (po toLowerCase).
const RE_CAPS_PATRON_OBJECT_HEAD =
  /^(?:aul[aiię]|list|listy|listu|puchar\p{L}*|memoriał\p{L}*|turniej\p{L}*|nagrod\p{L}*|stypendi\p{L}*|wystaw\p{L}*|biografi\p{L}*|twórczoś\p{L}*|wykład\p{L}*|pomnik\p{L}*|popiers\p{L}*|tablic\p{L}*|rond\p{L}*|skwer\p{L}*|park\p{L}*|kopiec|kopca)$/u;
const RE_CAPS_HOUSE_NO_AFTER =
  /^[ \t]+(?!(?:1\d|20)\d{2}(?!\d))\d{1,4}[A-Za-z]?(?![\p{L}\d])(?![ \t]*[:%]|\/(?:19|20)\d\d(?!\d))(?![ \t]+(?!(?:W|WE|I|M|LOK|NR)(?!\p{L}))\p{Lu}{2,})/u;
// Głowa tytułu utworu literackiego albo religijnego przed autorem (małymi literami po toLowerCase).
const RE_CAPS_WORK_HEAD =
  /^(?:treny|tren|dziady|ballad[ya]?|romans(?:e|y)?|fraszk[ia]|sonet(?:y)?|pieśni?|pieśń|wiersz(?:e)?|rapsod(?:y)?|hymn(?:y)?|psalm(?:y)?|poemat(?:y)?|poezje|liryki|opowiadani[ae]|nowel[ae]|bajk[ia]|baśni|baśń|dzieła|utwory|kazani[ae]|encyklik[ai]|homili[ae])$/u;
function capsNameHeadBefore(t: string, offset: number, end?: number, n1?: string): boolean {
  const before = t.slice(Math.max(0, offset - 60), offset);
  const w = RE_CAPS_WORD_BEFORE.exec(before.slice(-30))?.[1];
  if (!w) return false;
  const wl = w.toLowerCase();
  if (ALLCAPS_TITLES.has(wl)) return false;
  // Dokument przed postacią historyczną („LIST ADAMA MICKIEWICZA DO JOACHIMA LELEWELA") to dzieło
  // albo odsyłacz, jak w v0.46.23 — nie dokument strony pisma.
  if (capsDocRunBefore(before) && !(/^list(?:y|u|ów)?$/.test(wl) && historicGenPairAt(t, offset))) return false;
  if (end === undefined) return !CAPS_HEAD_NOT_NAME.has(wl);
  const after = t.slice(end, end + 40);
  // „SALA GIMNASTYCZNA PRZY ADAMA MICKIEWICZA 5", „OŚRODEK ZDROWIA PRZY …" — obiekt publiczny przy
  // ulicy z patronem: adres obiektu, nie osoba ani adres osoby
  if (wl === 'przy' && institutionBeforeAddr(before.slice(before.lastIndexOf('\n') + 1).replace(/[ \t]*PRZY[ \t]*$/u, ''))) return true;
  // Tytuł utworu z numerem („TRENY JANA KOCHANOWSKIEGO 19", „DZIADY ADAMA MICKIEWICZA 3 W REŻYSERII",
  // „BALLADY … 5 I 6") — numer utworu albo części, nie numer domu; autor to nie strona pisma.
  if (RE_CAPS_WORK_HEAD.test(wl)) return true;
  // Sala, aula, obiekt, puchar, list albo inne dzieło z patronem („SALA ADAMA MICKIEWICZA 12", „AULA
  // JANA KOCHANOWSKIEGO 3", „MECZ O PUCHAR JANA NOWAKA 3:1", „LIST ADAMA MICKIEWICZA DO …") — nazwa
  // obiektu albo odsyłacz, jak w v0.46.23.
  if (RE_CAPS_PATRON_OBJECT_HEAD.test(wl) || RE_PUBLIC_FACILITY_WORD.test(wl) || PATRON_GEN_HEADS.has(wl)) return true;
  // (przyimek albo rola przed parą: każda liczba, jak dotąd — „DZIAŁAJĄC PRZY ADAMA NOWAKA 5 RAZY")
  if ((CAPS_HEAD_NOT_NAME.has(wl) ? /^[ \t]+\d/ : RE_CAPS_HOUSE_NO_AFTER).test(after) && !capsOrgHead(wl)) return false;
  if (!CAPS_HEAD_NOT_NAME.has(wl)) return true;
  if (!n1 || !isFirstNameGenitive(n1) || !/^(?:przy|od|do)$/.test(wl)) return false;
  // „PRZY ADAMA MICKIEWICZA" (bez numeru) to ulica
  if (wl === 'przy') return true;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (!RE_CAPS_ROUTE_HEAD.test(line)) return false;
  if (wl === 'od') {
    const to = /^[ \t]+DO[ \t]+(\p{Lu}{2,})[ \t]+\p{Lu}{2,}/u.exec(after);
    return !!to && isFirstNameGenitive(to[1].toLowerCase());
  }
  return /(?<!\p{L})OD[ \t]+\p{Lu}{2,}(?:[ \t]+\p{Lu}{2,}){1,3}[ \t]+DO[ \t]+$/u.test(line);
}
// Dopełniacz nazwiska postaci historycznej („MICKIEWICZA", „KOCHANOWSKIEGO", „KONOPNICKIEJ",
// „KOŚCIUSZKI") — patrz HISTORIC_SURNAMES.
const HISTORIC_SURNAMES_GEN = new Set<string>(
  [...'jagiełło matejko sobieski kopernik chopin skłodowska piłsudski mickiewicz słowacki kościuszko moniuszko sienkiewicz konopnicka wyspiański paderewski kochanowski norwid żeromski reymont szymanowski wieniawski lutosławski fredro krasicki orzeszkowa'.split(' ')].map((s) =>
    /ki$/.test(s) ? `${s}ego` : /ka$/.test(s) ? `${s.slice(0, -1)}iej` : /o$/.test(s) ? `${s.slice(0, -1)}i` : `${s}a`,
  ),
);
/** Czy od `offset` stoi para „IMIĘ NAZWISKO" w dopełniaczu postaci historycznej? */
function historicGenPairAt(t: string, offset: number): boolean {
  const p = /^(\p{L}+)[ \t]+(\p{L}+)/u.exec(t.slice(offset, offset + 50));
  return !!p && isFirstNameGenitive(p[1].toLowerCase()) && HISTORIC_SURNAMES_GEN.has(p[2].toLowerCase());
}
/** Przypadek zależny imienia WERSALIKAMI (nie mianownik ze słownika). */
const capsObliqueFirst = (n: string): boolean => !POLISH_FIRST_NAMES.has(n) || isFirstNameGenitive(n);
// Imię w formie wyrazu pospolitego od imion-rzeczowników („POLE KOT" — pole, nie wołacz Poli).
const nounLikeNameForm = (n: string): boolean =>
  [...NOUN_LIKE_FIRST_NAMES].some((x) => n !== x && n.startsWith(x.slice(0, -1)) && n.length <= x.length + 1);
// Postacie historyczne w szyku „NAZWISKO IMIĘ" (spisy, hasła, nazwy) — nie strona pisma.
const HISTORIC_SURNAMES = new Set<string>(
  (
    'jagiełło matejko sobieski kopernik chopin skłodowska piłsudski mickiewicz słowacki kościuszko moniuszko sienkiewicz konopnicka wyspiański paderewski kochanowski norwid żeromski reymont ' +
    'szymanowski wieniawski lutosławski fredro krasicki orzeszkowa'
  ).split(' '),
);
// Etykieta osoby albo numer wpisu tuż przed nazwiskiem („Pacjent: ", „Wnioskodawca: ", „1. ") —
// kotwica dla nazwiska rozpoznanego tylko morfologią albo będącego homografem w szyku odwróconym.
// Etykieta także w środku wiersza po końcu zdania („… nie oponuje. Pacjent: Wilk Jadwiga").
const RE_PERSON_SLOT_BEFORE = /(?:^|\n|[.;!?][ \t]+)[ \t]*(?:\d{1,3}[.)][ \t]*|\p{L}{2,20}(?:[ \t]\p{L}{2,20})?[ \t]*:[ \t]*)$/u;
const personSlotBefore = (t: string, offset: number): boolean => RE_PERSON_SLOT_BEFORE.test(t.slice(Math.max(0, offset - 45), offset));
// Głowy, po których imię w mianowniku to nie szyk odwrócony, tylko tytuł władcy albo świętego
// („KRÓL JAN III SOBIESKI", „ŚWIĘTY JAN").
const CAPS_REVERSED_HEAD_EXCL = new Set<string>('król królowa książę księżna cesarz papież święty święta'.split(' '));
/**
 * Szyk odwrócony WERSALIKAMI („KOWALSKI JAN", „NOWAK PIOTR, WÓJCIK MARIA", „POZWANY NOWAK PIOTR").
 * Imię w mianowniku ze słownika; nazwisko ze słownika od razu, a z samej morfologii albo homograf
 * tylko na miejscu osoby (etykieta, numer wpisu). Patron ulicy w dopełniaczu („MICKIEWICZA ADAMA"),
 * przymiotnik odmiejscowy, homograf kalendarzowy i liczba rzymska za imieniem odpadają.
 */
function capsReversedPair(t: string, offset: number, n1: string, n2: string, end: number): boolean {
  if (!POLISH_FIRST_NAMES.has(n2) || isMaleFirstNameGenitive(n2) || NOUN_LIKE_FIRST_NAMES.has(n2)) return false;
  if (isFirstNameLike(n1) || CAPS_REVERSED_HEAD_EXCL.has(n1) || HOMOGRAPH_PAIR_EXCL.has(n1) || HISTORIC_SURNAMES.has(n1)) return false;
  const parts = n1.split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || isGeoAdjective(p) || RE_SURNAME_OBLIQUE.test(p))) return false;
  if (/^[ \t]+[IVX]{1,4}(?![\p{L}\p{N}])/u.test(t.slice(end, end + 8))) return false;
  if (capsStreetBefore(t, offset)) return false;
  if (parts.every((p) => !!surnameBase(p))) return true;
  return parts.every((p) => !!surnameBase(p) || looksLikeSurname(p) || !!homographBase(p)) && personSlotBefore(t, offset);
}

/** Nazwisko WERSALIKAMI potwierdzone słownikiem albo morfologią (każdy człon dwuczłonowego). */
function capsSurnameConfirmed(l: string): boolean {
  const parts = l.split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || isGeoAdjective(p))) return false;
  return parts.every((p) => !!surnameBase(p) || looksLikeSurname(p));
}
// Imię w Titlecase obok nazwiska WERSALIKAMI („Anna KOWALSKA", „KOWALSKA Anna") — zapis kart
// pacjenta, list i pism z systemów dziedzinowych.
const RE_MIXED_FIRST_CAPS = new RegExp(`(?<![${NM_BOUND}-])([${PL_UP}][${PL_LO}]+)([ \\t]+)([${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)(?![${PL_UP}${PL_LO}0-9-])`, 'g');
const RE_MIXED_CAPS_FIRST = new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])([${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)([ \\t]+)([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}-])`, 'g');
// Tytuł grzecznościowy w Titlecase przed nazwiskiem WERSALIKAMI („Pan KOWALSKI", „Panu KOWALSKIEMU",
// „Pani ELŻBIECIE NOWICKIEJ", „Szanowny Panie KOWALSKI"). Osobny przebieg zamiast alternatywy
// w tytułach WERSALIKAMI: tam „Pani SĘDZIA NOWAK" traciłoby rolę.
const RE_MIXED_TITLE_CAPS = new RegExp(
  `(?<![${NM_BOUND}])(Pan|Pani|Pana|Panu|Panem|Panią|Panie)([ \\t]+)((?:[${PL_UP}]{2,}[ \\t]+)?[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)(?![${PL_UP}${PL_LO}0-9-])`,
  'g',
);
/**
 * (c0) ZAPIS MIESZANY: imię Titlecase + nazwisko WERSALIKAMI w dowolnym szyku oraz tytuł grzecznościowy
 * przed nazwiskiem WERSALIKAMI. Reguły Titlecase nie widzą wersalików, a reguły WERSALIKÓW — imienia
 * w Titlecase, więc „Pani Anna KOWALSKA" dawało „Pani [..] KOWALSKA" (fragment), a „Pacjent:
 * KOWALSKA Anna" zostawało jawne. Nazwisko musi być potwierdzone (słownik, morfologia), imię ze
 * słownika — „Wojewoda MAZOWIECKI", „Szpital BIELAŃSKI", „Fiat PANDA" zostają.
 */
function passPersonMixedCase(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_MIXED_TITLE_CAPS, (m, kw: string, sep: string, name: string, offset: number, t: string) => {
    const ws = name.split(/([ \t]+)/);
    const last = ws[ws.length - 1];
    const ll = last.toLowerCase();
    if (!capsSurnameConfirmed(ll) || ROLE_WORDS.has(ll) || TITLE_WORDS.has(ll)) return m;
    if (precededByPatron(t, offset) || capsStreetBefore(t, offset)) return m;
    let keep = '';
    if (ws.length === 3) {
      const fl = ws[0].toLowerCase();
      if (ROLE_WORDS.has(fl)) keep = ws[0] + ws[1]; // „Pani SĘDZIA NOWAK" — rola zostaje
      else if (!isFirstNameLike(fl)) return m;
    }
    ctx.bump('IMIE');
    return `${kw}${sep}${keep}${ctx.personMask(last)}`;
  });
  ctx.text = ctx.text.replace(RE_MIXED_FIRST_CAPS, (m, w1: string, _sep: string, w2: string, offset: number, t: string) => {
    const w1l = w1.toLowerCase();
    const w2l = w2.toLowerCase();
    // imię w mianowniku: „Pomnik Adama MICKIEWICZA" (dopełniacz) to patron
    if (!POLISH_FIRST_NAMES.has(w1l) || isFirstNameGenitive(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || TITLE_WORDS.has(w1l) || NOUN_LIKE_FIRST_NAMES.has(w1l)) return m;
    // postać historyczna w spisie lektur czy programie koncertu („Henryk SIENKIEWICZ", „Jan MATEJKO")
    // — jak w szyku odwróconym WERSALIKAMI
    if (isFirstNameLike(w2l) || !capsSurnameConfirmed(w2l) || HISTORIC_SURNAMES.has(w2l)) return m;
    if (precededByPatron(t, offset) || precededByStreetEponym(t, offset) || capsStreetBefore(t, offset)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w2);
  });
  ctx.text = ctx.text.replace(RE_MIXED_CAPS_FIRST, (m, w1: string, _sep: string, w2: string, offset: number, t: string) => {
    const w1l = w1.toLowerCase();
    const w2l = w2.toLowerCase();
    if (!POLISH_FIRST_NAMES.has(w2l) || isMaleFirstNameGenitive(w2l) || NOUN_LIKE_FIRST_NAMES.has(w2l)) return m;
    if (isFirstNameLike(w1l) || ROLE_WORDS.has(w1l) || TITLE_WORDS.has(w1l) || CAPS_REVERSED_HEAD_EXCL.has(w1l) || HISTORIC_SURNAMES.has(w1l)) return m;
    if (w1l.split('-').some((p) => RE_SURNAME_OBLIQUE.test(p)) || !capsSurnameConfirmed(w1l)) return m;
    // sama morfologia: tylko na miejscu osoby („Pacjent: KOWALSKA Anna", „1. NOWAK Piotr")
    if (!w1l.split('-').every((p) => !!surnameBase(p)) && !personSlotBefore(t, offset)) return m;
    if (capsStreetBefore(t, offset) || precededByPatron(t, offset)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1);
  });
}

// (c6) IMIONA RODZICÓW za zamaskowaną osobą: „[..], syn Józefa i Marii", „[..], córka JANA, MARII",
// „[..] s. Stanisława i Haliny". Formuła z aktów, odpisów KW i wyroków karnych; imiona rodziców
// zostawały jawne obok maski, a razem z datą i miejscem urodzenia identyfikują osobę. Tylko tuż za
// maską osoby, imiona ze słownika; po skrócie „s."/„c." wymagane oba imiona („[..], s. 15 protokołu").
const RE_PARENTS_AFTER_MASK = new RegExp(
  `(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])(,?[ \\t]+)(syn(?:a|owi|em)?|córk(?:a|i|ą|ę)|SYN|CÓRKA|s\\.|c\\.)([ \\t]+)` +
    `([${PL_UP}][${PL_UP}${PL_LO}]+)(?:([ \\t]+)([${PL_UP}][${PL_UP}${PL_LO}]+))?` +
    `(?:((?:[ \\t]+i|,)[ \\t]+)([${PL_UP}][${PL_UP}${PL_LO}]+)(?:([ \\t]+)([${PL_UP}][${PL_UP}${PL_LO}]+))?)?(?![${NM_BOUND}])`,
  'g',
);
function passPersonParents(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    RE_PARENTS_AFTER_MASK,
    (
      m,
      mask: string,
      sep: string,
      kin: string,
      sp: string,
      a: string,
      sp2: string | undefined,
      a2: string | undefined,
      mid: string | undefined,
      b: string | undefined,
      spb: string | undefined,
      b2: string | undefined,
    ) => {
      const abbr = kin.endsWith('.');
      const head = mask.length + sep.length + kin.length + sp.length;
      // Drugie imię rodzica („córka Piotra Pawła i Anny Marii", „syn Jana Pawła i Marii") należy do
      // tej samej maski: dawniej imię ojca dostawało dwie maski obok siebie, a para „Pawła i Anny"
      // trafiała do innego przebiegu i w trybie pseudonimów ojciec z matką dostawali wspólny znacznik.
      // Wyraz spoza imion za pierwszym imieniem („syn Jana Kowalskiego") zostaje jak dawniej: maska
      // tylko na imieniu, reszta bez zmian.
      if (a2 !== undefined && !isFirstNameLike(a2)) {
        if (abbr || !isFirstNameLike(a)) return m;
        ctx.bump('IMIE');
        return `${mask}${sep}${kin}${sp}${ctx.M.IMIE}${m.slice(head + a.length)}`;
      }
      const father = a + (a2 !== undefined ? `${sp2}${a2}` : '');
      // drugi wyraz matki spoza imion („i Marii Kowalskiej") zostaje dla dalszych przebiegów
      const motherTail = b2 !== undefined && !isFirstNameLike(b2) ? `${spb}${b2}` : '';
      // Imię matki spoza słownika w dopełniaczu po „i" („córka Henryka i Marianny", „syn Jana
      // i Leokadii") — para imion rodziców w całości: dawniej maska obejmowała tylko ojca, a matka
      // zostawała jawna obok rozpoznanej danej.
      const motherGen =
        b !== undefined && /^[ \t]+i[ \t]+$/.test(mid ?? '') && /^\p{Lu}\p{Ll}+[iy]$/u.test(b) && !surnameBase(b) && !looksLikeSurname(b);
      if (!isFirstNameLike(a) || (b !== undefined && !isFirstNameLike(b) && !motherGen)) {
        // drugi wyraz to nie imię („syn Józefa, Kowalski …") — zostaje jawny, pierwszy rozstrzyga sam
        if (abbr || !isFirstNameLike(a)) return m;
        b = undefined;
      }
      if (abbr && b === undefined) return m;
      ctx.bump('IMIE');
      const tail = b !== undefined ? `${mid}${ctx.M.IMIE}${motherTail}` : m.slice(head + father.length);
      return `${mask}${sep}${kin}${sp}${ctx.M.IMIE}${tail}`;
    },
  );
}

// (c3) OCR/WERSALIKI: „J0AN K0WALSKI", „JAN KOWALSKI" — para tokenów WERSALIKAMI z homoglifami.
// Para w lookahead, a pętla exec: odrzucona para („CZYNSZ JAN", „ORAZ ANNA") zużywa tylko pierwszy
// wyraz, więc imię z niej może otworzyć następną parę („CZYNSZ JAN KOWALSKI" było jawne).
function passPersonOcrPair(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCRW = `[${PL_UP}][${PL_UP}01]{1,19}`;
  // Nazwisko dwuczłonowe („ANNA NOWAK-KOWALSKA"): dawniej lookahead odrzucał parę przed
  // „-KOWALSKA", żeby nie maskować fragmentu, i całość zostawała jawna. Trzeci człon nadal nie
  // pasuje, więc fragment nie wycieka.
  const re = new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])(${OCRW})(?=([ \\t]+)(${OCRW}(?:-${OCRW})?)(?![${PL_UP}${PL_LO}0-9-]))`, 'g');
  const src = ctx.text;
  const decide = (t1: string, sep: string, t2: string, offset: number): string | null => {
      const m = null;
      const homo1 = /[01]/.test(t1);
      const homo2 = /[01]/.test(t2);
      const allCaps = t1 === t1.toUpperCase() && t2 === t2.toUpperCase();
      if (!homo1 && !homo2 && !allCaps) return m; // zwykłe pary obsłużyły (a)–(c2)
      const norm = (s: string) => s.replace(/0/g, 'o').replace(/1/g, 'l').toLowerCase();
      const n1 = norm(t1);
      const n2 = norm(t2);
      if (LEGAL_ENTITY_WORDS.has(n1) || ROLE_WORDS.has(n1) || TITLE_WORDS.has(n1)) return m;
      if (!homo1 && !homo2) {
        const pairEnd = offset + t1.length + sep.length + t2.length;
        if (capsReversedPair(src, offset, n1, n2, offset + t1.length + sep.length + t2.length)) {
          ctx.bump('IMIE');
          return ctx.personMask(n1);
        }
        // Homograf z listy wyjątków („PIĄTKA", „MAJA") po roli w dopełniaczu i imieniu w dopełniaczu
        // to nazwisko („W OBECNOŚCI DŁUŻNIKA JERZEGO PIĄTKA") — wyjątki chronią grafik („PIĄTEK 3 MAJA").
        const hbRole =
          (isFirstNameGenitive(n1) || egoNameGenitive(n1)) && !isFirstNameLike(n2) && capsRoleObliqueBefore(src, offset) ? homographBase(n2) : null;
        const hb = homographPairBase(n1, n2) ?? hbRole;
        // patron w nazwie WERSALIKAMI: para w dopełniaczu za wyrazem nazwy albo ulicy („UNIWERSYTET
        // ADAMA MICKIEWICZA"); nazwisko w mianowniku („NA ULICY ALEKSANDRA NOWAK") to osoba
        const obliquePair = capsObliqueFirst(n1) && (RE_SURNAME_OBLIQUE.test(n2) || /[aeiyąę]$/.test(n2));
        if (hb && !capsStreetBefore(src, offset) && !precededByPatron(src, offset) && !(obliquePair && capsNameHeadBefore(src, offset, pairEnd, n1))) {
          ctx.bump('IMIE');
          return ctx.personMask(hb);
        }
        if (obliquePair && (capsNameHeadBefore(src, offset, pairEnd, n1) || capsStreetBefore(src, offset))) return m;
      }
      if (LEGAL_ENTITY_WORDS.has(n2) || NON_SURNAME_ADJ.has(n2)) return m;
      // KAŻDY człon potwierdzony (nie „którykolwiek"): „MARII SKŁODOWSKIEJ-CURIE" w nazwie
      // instytucji przechodziłoby przez „skłodowskiej", „ADAM MIŃSKI-MAZOWIECKI" to miejscowość
      const parts2 = n2.split('-');
      if (parts2.length > 1 && parts2.some((p) => LEGAL_ENTITY_WORDS.has(p) || isGeoAdjective(p))) return m;
      if (!parts2.every((p) => !!surnameBase(p) || looksLikeSurname(p))) return m;
      if (precededByPatron(src, offset) || precededByStreetEponym(src, offset)) return m;
      if (!isFirstNameLike(n1) && !homo1) {
        // pierwszy token to nie imię — maskuj SAMO nazwisko, o ile zawiera homoglif
        if (!homo2) return m;
        ctx.bump('IMIE');
        return `${t1}${sep}${ctx.personMask(n2)}`;
      }
      ctx.bump('IMIE');
      return ctx.personMask(n2);
  };
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  // Domknięcie imion WERSALIKAMI wokół zamaskowanej pary: drugie imię przed parą („Pani ANNA MARIA
  // NOWAK" — para „ANNA MARIA" odpada, maskę dostaje „MARIA NOWAK") i za parą w szyku odwróconym
  // („KOWALSKA ANNA MARIA, córka …", „NADAWCA: KOWALSKI JAN PIOTR"). Tylko mianownik ze słownika.
  const capsGiven = (w: string): boolean => {
    const l = w.toLowerCase();
    return POLISH_FIRST_NAMES.has(l) && !isMaleFirstNameGenitive(l) && !NOUN_LIKE_FIRST_NAMES.has(l) && !ROLE_WORDS.has(l) && !TITLE_WORDS.has(l);
  };
  const RE_CAPS_GIVEN_BEFORE = new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])([${PL_UP}]{2,})[ \\t]+$`);
  const RE_CAPS_GIVEN_AFTER = new RegExp(`^[ \\t]+([${PL_UP}]{2,})(?![${PL_UP}${PL_LO}0-9.-])`);
  for (let mm = re.exec(src); mm; mm = re.exec(src)) {
    const [, t1, sep, t2] = mm;
    const r = decide(t1, sep, t2, mm.index);
    if (r === null) continue;
    let from = mm.index;
    let to = mm.index + t1.length + sep.length + t2.length;
    if (t1 === t1.toUpperCase() && t2 === t2.toUpperCase()) {
      const head = RE_CAPS_GIVEN_BEFORE.exec(src.slice(Math.max(last, from - 24), from));
      if (head && capsGiven(head[1]) && capsGiven(t1)) from -= head[0].length;
      const tail = RE_CAPS_GIVEN_AFTER.exec(src.slice(to, to + 24));
      if (tail && capsGiven(tail[1]) && capsGiven(t2)) to += tail[0].length;
    }
    out += src.slice(last, from) + r;
    last = to;
    re.lastIndex = last;
  }
  if (last) ctx.text = out + src.slice(last);
}

// Dopełnienie „Dom …" po „z domu" (instytucja, nie nazwisko panieńskie): „z Domu Dziecka", „z domu
// Pomocy Społecznej", „Z DOMU KULTURY". „dziecka" ma też kształt nazwiska (-cka), więc sama
// morfologia go nie odrzuci.
const MAIDEN_NOT_SURNAME = new Set<string>(
  (
    'dziecka pomocy kultury opieki seniora bożego maklerskiego towarowego handlowego weselnego ' +
    'pogrzebowego studenckiego samotnej spokojnej starości wczasowego zdrojowego parafialnego ' +
    'rekolekcyjnego aukcyjnego wydawniczego mody książki rodzinnego dziennego ' +
    // rodzina i grzecznościowe „Państwa" pisane wielką literą z szacunku („z domu Babci", „z domu
    // Państwa Wróblów") oraz typowe nazwy „Dom …" w dopełniaczu rzeczownika („Dom Strażaka",
    // „Dom Nauczyciela", „Dom Polonii")
    'babci babki mamy mamusi matki taty ojca rodziców teściów dziadków dziadka cioci wujka siostry ' +
    'brata sąsiadów sąsiada przyjaciół państwa strażaka nauczyciela sportowca turysty harcerza ' +
    'rzemiosła kombatanta działkowca studenta chłopa pielgrzyma samopomocy miłosierdzia rolnika ' +
    'górnika żołnierza ucznia emeryta rencisty kolejarza lekarza pracownika pracy ludu ' +
    // nazwy domów i placówek w mianowniku albo dopełniaczu („z domu Caritas", „Hospicjum", „Dom
    // Muzyki", „Dom Sióstr …") oraz przyimek z nazwy pensjonatu („z domu Pod Lipami", „Na Skarpie")
    'caritas hospicjum muzyki sztuki literatury techniki technika prasy wsi spotkań sióstr braci ' +
    'pod na nad przy za u w we od do po ze przed obok'
  ).split(' '),
);
// Nazwisko panieńskie po „z domu"/„z d." stoi w mianowniku („z domu Kowalska", „z d. Nowak").
// Przymiotnik w przypadku zależnym („z domu Ludowego", „Pogodnej Jesieni", „Polskiego"), narzędnik
// („Spotkanie z D. Nowakiem") i dopełniacz na „-ii" („z domu Polonii") to nazwa domu albo inna
// fraza. Bez „-ów"/„-ych": dopełniacz liczby mnogiej bywa nazwiskiem rodu („z domu Wróblów"), i bez
// słownikowego isObliqueSurnameForm: „-ówna" („z domu Nowakówna") to mianownik, choć ma inną bazę.
const RE_MAIDEN_OBLIQUE = /^.{2,}(?:ego|emu|ej|ym|ii|ji)$|^.{3,}em$|ą$/;
const maidenNotSurname = (w: string): boolean => MAIDEN_NOT_SURNAME.has(w) || RE_MAIDEN_OBLIQUE.test(w);
// Wyraz z wielkiej litery tuż za kandydatem — dalszy ciąg nazwy własnej („z domu Ronalda McDonalda",
// „Wczasów Dziecięcych", „Sue Ryder", „Aniołów Stróżów"), a nie nazwisko panieńskie.
const RE_MAIDEN_NAME_CONTINUES = new RegExp(`^ [${PL_UP}][${PL_LO}]`);
// Ciąg nazwy własnej tylko wtedy, gdy kształt na to wskazuje: dalszy wyraz w dopełniaczu albo
// przymiotnik liczby mnogiej („Wczasów Dziecięcych", „Aniołów Stróżów"), kandydat w dopełniaczu
// imienia albo liczby mnogiej („Ronalda McDonalda", „Wczasów") albo obcy zapis dalszego wyrazu
// („Sue Ryder"). Potwierdzone nazwisko i homograf („z domu Mazur Wdowa po Janie", „z domu Wrona
// Telefon …", „Sowa Zamężna") oraz wyraz pospolity za kandydatem („Pstrąg Emerytka", „Bździuch
// Szpital Wojewódzki") to nazwisko panieńskie, a za nim następna fraza.
const RE_MAIDEN_NEXT_CONTINUES = /(?:ych|ich|ów|ców|ego|iej|ej|er|ey|ay|th|son|ton|ld|ck|ff|ee|oo)$/u;
function maidenNameContinues(sur: string, next: string): boolean {
  const sl = sur.toLowerCase();
  if (isFirstNameGenitive(sl) && !POLISH_FIRST_NAMES.has(sl)) return true;
  if (isConfirmedSurname(sur) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(sur))) return false;
  return RE_MAIDEN_NEXT_CONTINUES.test(next) || /^(?:Mc|Mac|O')\p{Lu}/u.test(next) || /ów$/u.test(sur);
}
// …chyba że ten wyraz to już następne pole spłaszczonego formularza albo zdania: skrót z kropką
// („Zam.", „Ur."), etykieta z dwukropkiem („Imię ojca:"), imiesłów czynny albo bierny („Legitymująca
// się", „Wypisana 12.10.", „Zatrudniona jest", „Przyjęta") albo czasownik w czasie przeszłym z wielkiej
// litery w tekście bez kropek („Zamieszkała w Radomiu", „Zmarła 2015.").
const RE_MAIDEN_NEXT_FIELD = new RegExp(
  `^ (?:[${PL_UP}][${PL_LO}]{0,3}\\.(?![${PL_LO}${PL_UP}])|[${PL_UP}][${PL_LO}]*(?:[ \\t]+[${PL_LO}]+){0,2}[ \\t]*:|[${PL_UP}][${PL_LO}]+(?:ąc(?:a|y|e)|[${PL_LO}]{3}ła|[${PL_LO}](?:an|on|ęt|it|yt)[aey])(?![${PL_LO}])|Zmarł[ay]?(?![${PL_LO}]))`,
);
// Wielkie „D." skrótu „Z D." przed nazwiskiem panieńskim zamienione na znak PUA do domknięcia inicjałów
// w finalizePersons: inaczej „D." szło do maski jako inicjał imienia. Znacznik stoi przy samym
// skrócie, więc maska INNEJ osoby („Rozmowa Jana Kowalskiego z D. Nowakiem") inicjał dalej wciąga —
// dawniej zbiór kluczowany tekstem maski blokował to w całym dokumencie, bo w trybie domyślnym każda
// maska osoby brzmi tak samo.
const MAIDEN_D_SENTINEL = String.fromCharCode(0xe0d0);
// (c5) NAZWISKO PANIEŃSKIE PO MASCE: „Anna Kowalska z domu Sikora", „EWELINA KRAWCZYK Z D. MAJEWSKA",
// „Magdalena Kaczmarek (z d. Sikora)". (a5) w passPersonPairs wymaga surowego imienia przed „z",
// a tu para jest już maską z wcześniejszego przebiegu — nazwisko rodowe spoza słownika (homograf,
// rzadkie, WERSALIKI) zostawało jawne. Po masce osoby „z domu" to jawna kotwica, więc nazwisko
// w Titlecase przyjmujemy po stopliście instytucji; WERSALIKI muszą być potwierdzone (słownik,
// morfologia, homograf) — „JAN KOWALSKI Z DOMU WYSZEDŁ RANO" to zdanie. „domu" tylko małymi albo
// WIELKIMI literami: „z Domu Pomocy Społecznej" to nazwa instytucji.
function passPersonMaidenAfterMask(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const PM = `\\[OSOBA-[A-Z]+\\]|${escapeRe(ctx.M.IMIE)}`;
  ctx.text = ctx.text.replace(
    new RegExp(
      `(${PM})([ \\t]*[,(]?[ \\t\\n]*[Zz][ \\t\\n]+(?:domu|DOMU|d\\.|D\\.)[ \\t]+)` +
        `([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?|[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)(?![${NM_BOUND}0-9-])`,
      'g',
    ),
    (m, mask: string, mid: string, sur: string, offset: number, str: string) => {
      const parts = sur.toLowerCase().split('-');
      if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || ROLE_WORDS.has(p) || TITLE_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || maidenNotSurname(p))) return m;
      if (sur === sur.toUpperCase() && !parts.some((p) => !!surnameBase(p) || looksLikeSurname(p) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(p)))) return m;
      // …chyba że dalej stoi imię: szyk „Kowalska z d. Sikora Anna" (nazwisko panieńskie przed imieniem)
      const after = str.slice(offset + m.length, offset + m.length + 40);
      const nextWord = /^ (\S+)/.exec(after)?.[1].replace(/[.,;:)]+$/, '') ?? '';
      if (
        sur !== sur.toUpperCase() &&
        RE_MAIDEN_NAME_CONTINUES.test(after) &&
        !RE_MAIDEN_NEXT_FIELD.test(after) &&
        !isFirstNameLike(nextWord) &&
        maidenNameContinues(sur, nextWord)
      )
        return m;
      ctx.bump('IMIE');
      return `${mask}${mid.replace(/D(?=\.[ \t]+$)/, MAIDEN_D_SENTINEL)}${ctx.personMask(sur)}`;
    },
  );
}

// (c4) HOMOGLIF OCR WEWNĄTRZ słowa kapitalizowanego: „Jan KowaIski" (wielkie I zamiast l).
function passPersonOcrMix(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCR_MIX = `[${PL_UP}][${PL_LO}]*[I01][${PL_LO}I01]*`;
  ctx.text = ctx.text.replace(
    new RegExp(`(?<![${PL_UP}${PL_LO}0-9-])(?:(${CAP_WORD})([ \\t]+))?(${OCR_MIX})(?![${PL_UP}${PL_LO}0-9-])`, 'g'),
    (m, w1: string | undefined, sep: string | undefined, w2: string) => {
      const n2 = w2[0].toLowerCase() + w2.slice(1).replace(/[I1]/g, 'l').replace(/0/g, 'o').toLowerCase();
      if (!surnameBase(n2) && !looksLikeSurname(n2)) return m;
      ctx.bump('IMIE');
      // znane imię przed nazwiskiem wciągane do maski; inny wyraz („Firma") zostaje
      if (w1 && isFirstNameLike(w1)) return ctx.personMask(n2);
      return `${w1 ? `${w1}${sep}` : ''}${ctx.personMask(n2)}`;
    },
  );
}

// ══════ FAZA 5 · DOMKNIĘCIA OSÓB · STABILNA NUMERACJA · PRZYWRÓCENIE URL ══════
// Początek wpisu listy/tabeli przed imieniem kończącym wiersz: wiersz albo komórka (po ; | ⇥ , :),
// opcjonalnie numeracja/punktor, JEDEN wyraz z wielkiej litery i odstęp lub separator komórki.
const RE_LIST_ENTRY_HEAD = new RegExp(
  `(?:^|[;|\\t,:][ \\t]*)(?:(?:\\d{1,4}[.)]|[-*•–])[ \\t]*)?(${CAP_WORD})([ \\t]*[;|\\t,][ \\t]*|[ \\t]+)$`,
);
// Dalszy ciąg zdania za maską w następnym wierszu („…\nKowalski złożył", „…\nKowalski.").
const RE_PROSE_TAIL = new RegExp(`^(?:[ \\t]+[${PL_LO}]|[.!?…])`);
// Nazwy dni i miesięcy są na liście homografów nazwisk, ale na początku wiersza to częściej
// grafik („Środa Anna\nKowalska" = dyżur Anny Kowalskiej) niż nazwisko — tu odpadają; tak samo
// funkcje sołecka i starościńska.
const LIST_HEAD_NOT_SURNAME = new Set<string>(
  ('poniedziałek wtorek środa czwartek piątek sobota niedziela styczeń luty marzec kwiecień maj ' +
    'czerwiec lipiec sierpień wrzesień październik listopad grudzień sołtys starosta').split(' '),
);
/**
 * Czy wyraz otwierający wiersz to NAZWISKO wpisu „Nazwisko Imię"? Wymagamy dowodu: słownik,
 * końcówka nazwiskowa albo lista homografów (Sowa, Wilk, Wróbel, Kowal). Sam brak imienia i roli
 * nie wystarcza — czasowniki podpisu, przyimki i funkcje spoza ROLE_WORDS („Sporządził Jan\n
 * Kowalski", „Od Jana\nKowalskiego", „Lekarz Anna\nNowak", „Żona Anna\nKowalska") brały się za
 * nazwisko, imię zostawało jawne obok maski nazwiska.
 */
function isListEntrySurname(word: string): boolean {
  if (isFirstNameLike(word)) return false;
  return word.split('-').some((part) => {
    const w = part.toLowerCase();
    if (TITLE_WORDS.has(w) || ROLE_WORDS.has(w) || LIST_HEAD_NOT_SURNAME.has(w)) return false;
    if (LEGAL_ENTITY_WORDS.has(w) || NON_SURNAME_ADJ.has(w)) return false;
    return !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(w);
  });
}
/**
 * Czy imię `t[start, …)` na końcu wiersza DOMYKA wpis listy w szyku „Nazwisko Imię" („Sowa
 * Przemysław", „Sowa;Przemysław", „1. Sowa Przemysław")? Tak, gdy przed nim stoi potwierdzone
 * nazwisko (isListEntrySurname), a za maską w następnym wierszu nie ciągnie się proza. Wtedy maska
 * poniżej to INNA osoba — wciągnięcie imienia sklejało wiersze (lista 10 osób dawała 8 wierszy,
 * rekordy CSV się przesuwały). Łamanie prozy („Starosta Jan\nWiśniewski przeprowadził",
 * „Wnioskodawca Anna\nNowak", „Sporządził Jan\nKowalski") nadal domyka osobę. Wiersz dłuższy niż
 * 80 znaków przed imieniem to proza, nie wpis listy (też ogranicza koszt skanu wstecz).
 * Zwraca początek nazwiska i separator za nim albo null.
 */
function listEntryHead(t: string, start: number, end: number): { at: number; word: string; sep: string } | null {
  let ls = start;
  while (ls > 0 && t[ls - 1] !== '\n') {
    if (start - ls >= 80) return null;
    ls--;
  }
  const mm = RE_LIST_ENTRY_HEAD.exec(t.slice(ls, start));
  if (!mm || !(isListEntrySurname(mm[1]) || geoSurnameBeforeName(mm[1], t, start))) return null;
  if (RE_PROSE_TAIL.test(t.slice(end, end + 40))) return null;
  return { at: start - mm[2].length - mm[1].length, word: mm[1], sep: mm[2] };
}
/**
 * Czy wpis „Przymiotnik-ski Imię" („Mazowiecka Anna") to osoba w szyku „Nazwisko Imię"? Przymiotnik
 * odmiejscowy na -ski/-ska bywa nazwiskiem (Mazowiecki), a w liście świadków za nim stoi imię. Nie,
 * gdy imię jest też rzeczownikiem („Olimpijska Nadzieja", „Wielka Nadzieja" — to nazwa).
 */
function geoSurnameBeforeName(word: string, t: string, start: number): boolean {
  if (!/(?:sk|ck|dzk)[ia]$/.test(word) || !isGeoAdjective(word)) return false;
  const name = /^\p{L}+/u.exec(t.slice(start, start + 30))?.[0]?.toLowerCase() ?? '';
  return POLISH_FIRST_NAMES.has(name) && !NOUN_LIKE_FIRST_NAMES.has(name);
}
const RE_PERSON_MASK_AT_START = /^(?:\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])/;
// Maska osoby przed wyrazem w tym samym wierszu: po odstępie albo po separatorze pola CSV
// („[..];Jan", „[..], Jan") — wyraz należy wtedy do tego wiersza.
const RE_PERSON_MASK_BEFORE = /(?:\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])(?:[ \t]+|[ \t]*[,;|][ \t]*)$/;
// Maska osoby i wyraz z wielkiej litery za nią (domknięcia w prawo w finalizePersons). W prawo
// tylko przez JEDNĄ spację: kilka spacji to zwykle wyrównanie kolumn, a wyraz za nimi — następna.
const RE_MASK_THEN_NAME = new RegExp(`(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]) ([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}-])`, 'g');
const RE_MASK_COMMA_NAME = new RegExp(
  `(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]),[ \\t]*([${PL_UP}][${PL_LO}]+)(?:[ \\t]+([${PL_UP}][${PL_LO}]+))?(?![${NM_BOUND}-])`,
  'g',
);
const RE_MASK_GLUED_NAME = new RegExp(`(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])[._]([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}])`, 'g');
const OCR_NAME_WORD = `[${PL_UP}](?:[${PL_LO}]*[I01][${PL_LO}I01]*|[${PL_UP}]*[01][${PL_UP}01]*)`;
const RE_OCR_NAME_BEFORE_MASK = new RegExp(
  `(?<![${PL_UP}${PL_LO}0-9])(${OCR_NAME_WORD})([ \\t\\n_-])(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`,
  'g',
);
// Imię z homoglifem za maską na końcu wiersza („[..] KaroI⏎", „Świadkowie: [..] Kami1⏎") — szyk
// rekordu „Nazwisko Imię" z listy przepuszczonej przez OCR.
const RE_MASK_THEN_OCR_NAME = new RegExp(`(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]) (${OCR_NAME_WORD})(?=[ \\t]*(?:\\r?\\n|$))`, 'g');
/** Imię ze słownika (małymi literami), którym jest wyraz z homoglifem OCR (0, 1, „I" zamiast „l"), albo null. */
function ocrFirstNameForm(w: string): string | null {
  if (w.length < 4) return null;
  const tail = w.slice(1);
  const titlecase = /[a-ząćęłńóśźż]/.test(tail);
  const variant = (one: string): string =>
    (w[0] + (titlecase ? tail.replace(/I/g, 'l') : tail).replace(/0/g, 'o').replace(/1/g, one)).toLowerCase();
  const l = variant('l');
  if (isFirstNameLike(l)) return l;
  const i = variant('i');
  return isFirstNameLike(i) ? i : null;
}
const ocrFirstNameLike = (w: string): boolean => ocrFirstNameForm(w) !== null;
// Wiersz złożony z jednego wyrazu (opcjonalnie z numeracją/punktorem) przed imieniem na jego końcu.
const RE_ADJ_LINE_HEAD = new RegExp(`^[ \\t]*(?:(?:\\d{1,4}[.)]|[-*•–])[ \\t]*)?(${CAP_WORD})[ \\t]+$`);
const RE_FIRST_NAME_AT_END = new RegExp(`(?<![${PL_UP}${PL_LO}])[${PL_UP}][${PL_LO}]+$`);
/**
 * Wpis listy „Nazwisko Imię" nad maską osoby („Sowa Przemysław\n[OSOBA]") to osobna osoba:
 * strażnik domknięcia nie wciąga jej imienia do maski z następnego wiersza, więc bez tego kroku
 * zostawała jawna W CAŁOŚCI (homograf w szyku odwróconym — Sowa, Wilk, Kowal — nie ma innej
 * kotwicy). Idziemy od dołu: zamaskowany wpis staje się kotwicą wiersza nad nim, więc cała lista
 * homografów nad potwierdzoną osobą maskuje się w jednym przebiegu (i wynik jest idempotentny).
 * Komórki CSV/TSV („Sowa;Przemysław") dostają osobne maski tej samej osoby — kolumny się nie
 * przesuwają.
 */
function passListEntries(ctx: RedactCtx): void {
  if (!ctx.text.includes('\n')) return;
  const lines = ctx.text.split('\n');
  let changed = false;
  for (let i = lines.length - 2; i >= 0; i--) {
    const next = lines[i + 1];
    const mm = RE_PERSON_MASK_AT_START.exec(next);
    if (!mm || RE_PROSE_TAIL.test(next.slice(mm[0].length, mm[0].length + 40))) continue;
    const line = lines[i];
    const nm = RE_FIRST_NAME_AT_END.exec(line);
    if (!nm || !isFirstNameLike(nm[0])) continue;
    // proza za maską sprawdzona wyżej na wierszu i+1, więc koniec „tekstu" = koniec tego wiersza
    const head = listEntryHead(line, nm.index, line.length);
    if (!head) continue;
    const mask = ctx.personMask(head.word);
    ctx.bump('IMIE');
    const cell = /[;|\t,]/.test(head.sep);
    lines[i] = line.slice(0, head.at) + (cell ? `${mask}${head.sep}${mask}` : mask);
    changed = true;
  }
  if (changed) ctx.text = lines.join('\n');
}

interface RawWordLink {
  prev: string;
  sep: string;
  prev2: string;
  sep2: string;
  prev3: string;
  sep3: string;
  /** Kilkanaście znaków oryginału za wyrazem — do dopasowania wystąpienia, gdy imię się powtarza. */
  next: string;
  // oceny liczone raz na wpis: ten sam wpis sprawdza każde wystąpienie imienia w dokumencie
  prevName?: boolean;
  prevOblique?: boolean;
  pair?: boolean;
}
const linkPrevIsName = (l: RawWordLink): boolean => (l.prevName ??= isFirstNameLike(l.prev));
const linkPrevOblique = (l: RawWordLink): boolean => (l.prevOblique ??= isObliqueSurnameForm(l.prev));
const RE_RAW_WORD = /\p{L}+/gu;
/**
 * Wyrazy z wielkiej litery ORYGINALNEGO wejścia z trzema poprzednimi wyrazami i separatorami.
 * Domknięcia w prawo w finalizePersons widzą już tylko maskę i nie wiedzą, czy zastąpiła samo
 * nazwisko w szyku rekordu („Kowalski Jan Paweł", „Wiśniewska, Ewa"), parę „Imię Nazwisko"
 * („Zofia Nowak Antoni", „Rodzice: Jan Kowalski, Anna" — imię za nią to następna osoba), czy
 * nazwisko w formie zależnej („Według Nowaka Ewa nie przyszła"). Jeden przebieg po tekście,
 * budowany leniwie dopiero wtedy, gdy jest co domykać.
 */
function buildRawWordLinks(raw: string): Map<string, RawWordLink[]> {
  const map = new Map<string, RawWordLink[]>();
  // dosłowne ucieczki JSON „\n/\r/\t" jak odstęp: litera ucieczki nie skleja się z wyrazem
  const src = raw.replace(/\\[nrt]/g, '  ');
  let p1 = '';
  let p1Sep = '';
  let p2 = '';
  let p2Sep = '';
  let p3 = '';
  let lastEnd = -1;
  for (const mm of src.matchAll(RE_RAW_WORD)) {
    const w = mm[0];
    const at = mm.index ?? 0;
    // długi odstęp to i tak nie separator, który domknięcia rozważają
    const sep = lastEnd < 0 || at - lastEnd > 8 ? '\n\n' : src.slice(lastEnd, at);
    if (p1 && RE_CHAR_LU.test(w[0])) {
      let list = map.get(w);
      if (!list) map.set(w, (list = []));
      const next = src.slice(at + w.length, at + w.length + 12);
      if (list.length < 32) list.push({ prev: p1, sep, prev2: p2, sep2: p1Sep, prev3: p3, sep3: p2Sep, next });
    }
    p3 = p2;
    p2Sep = p1Sep;
    p2 = p1;
    p1Sep = sep;
    p1 = w;
    lastEnd = at + w.length;
  }
  return map;
}
/**
 * Para „Imię Nazwisko" w tej samej komórce: imię tuż przed nazwiskiem, które zastąpiła maska. Nie,
 * gdy to imię zamyka poprzedni wpis „Nazwisko Imię" („Świadkowie: Kowalski Jan Nowak Piotr" — tam
 * „Nowak Piotr" to drugi wpis, a „Piotr" należy do niego).
 */
function pairBeforeLink(l: RawWordLink): boolean {
  return (l.pair ??= pairBeforeLinkUncached(l));
}
function pairBeforeLinkUncached(l: RawWordLink): boolean {
  if (l.sep2 !== ' ' || !isFirstNameLike(l.prev2)) return false;
  if (l.sep3 !== ' ' || isFirstNameLike(l.prev3)) return true;
  const w3 = l.prev3.toLowerCase();
  if (TITLE_WORDS.has(w3) || ROLE_WORDS.has(w3)) return true;
  return !surnameBase(l.prev3) && !looksLikeSurname(l.prev3);
}
/**
 * Wpisy z oryginału, które mogą odpowiadać temu wystąpieniu imienia: zgodne z tekstem za nim aż do
 * pierwszej maski, cyfry albo znaku technicznego (te przebiegi już podmieniły). Gdy imię pada
 * w dokumencie kilka razy („Dzieci: Zofia Nowak Antoni" i „Kowalski Antoni Jan"), decyduje wpis
 * z tego miejsca, a nie pierwszy lepszy. Bez dopasowania — wszystkie wpisy (ostrożnie).
 */
function linksAt(all: RawWordLink[], t: string, end: number): RawWordLink[] {
  if (all.length < 2) return all;
  const cur = t.slice(end, end + 12).replace(/\\[\uE009\uE00A\uE00D]/g, '  ');
  const fits = all.filter((l) => {
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (c === '[' || (c >= '0' && c <= '9') || c >= '\uE000') return true;
      if (c !== l.next[i]) return false;
    }
    // koniec tekstu za imieniem: w oryginale też musi być koniec
    return cur.length === 12 || l.next.length <= cur.length;
  });
  return fits.length ? fits : all;
}
/**
 * Czy imię `form` (małymi literami) za maską to INNA osoba niż ta pod maską? Drugie imię stoi tylko
 * za szykiem rekordu „Nazwisko Imię" albo za samym nazwiskiem w mianowniku. Za parą „Imię Nazwisko"
 * to imię następnej osoby albo rzeczownik („Zofia Nowak Antoni", „Jan Kowalski Nadzieja na
 * poprawę"), za nazwiskiem w formie zależnej — podmiot dalszej części zdania („Według Nowaka Ewa nie
 * przyszła"), a imię w formie zależnej za odmiennym nazwiskiem w mianowniku — dopełnienie
 * („Pozwany Zieliński Annie groził", „Świadek Kowalski Annę zna"): w rekordzie imię stoi w tym samym
 * przypadku co nazwisko. Dawniej obie osoby szły pod jedną maskę. Nazwisko bez odmiany w żeńskim
 * („Nowak", „Kowalczyk") zostaje przy imieniu w każdym przypadku: „Wezwać Nowak Annę" to jedna osoba.
 */
function nameAfterMaskIsOtherPerson(links: RawWordLink[], form: string): boolean {
  const nominal = POLISH_FIRST_NAMES.has(form);
  return links.some((l) => {
    if (linkAfterMask(l)) return true;
    if (l.sep !== ' ' || linkPrevIsName(l)) return false;
    if (pairBeforeLink(l)) return true;
    // imię na pewno w mianowniku: „Stanisława", „Aleksandra" bywają dopełniaczem męskiego
    // imienia i wtedy zgadzają się z nazwiskiem („Wniosek Kowalskiego Stanisława")
    if (linkPrevOblique(l)) return nominal && !isFirstNameGenitive(form);
    return !nominal && RE_DECLINED_NOM_SURNAME.test(l.prev);
  });
}
/**
 * Czy w oryginale imię stało już tuż za maską („[..] Ewa", „[OSOBA-A], Anna")? Tak jest przy
 * ponownym przebiegu po wyniku: poprzedni przebieg zostawił imię poza maską, więc drugi też musi
 * (idempotencja). Bez tego „Według [..] Ewa nie przyszła" traciło imię dopiero w drugim przebiegu.
 */
const linkAfterMask = (l: RawWordLink): boolean => l.sep[0] === ']';
// Mianownik nazwiska odmiennego jak przymiotnik („Kowalski", „Zielińska", „Nowicki") — w formie
// zależnej byłoby „Kowalskiego", „Zielińskiej".
const RE_DECLINED_NOM_SURNAME = /(?:sk|ck|dzk)[ia]$/i;
/**
 * Czy przez nową linię nie wolno dołączyć imienia z końca wiersza do maski osoby na początku
 * następnego? Tak, gdy imię domyka wpis listy „Nazwisko Imię" („Sowa Przemysław⏎Pawlak Wiesław"),
 * stoi za maską osoby w swoim wierszu („Dzieci: [..] Antoni⏎…", „[..];Jan⏎…") albo wiersz to
 * „Przymiotnik Imię" („Wielka Nadzieja"). Wciągnięcie sklejało wiersze i przesuwało pola CSV.
 */
function newlineJoinBlocked(t: string, offset: number, end: number, links?: RawWordLink[], name?: string, raw?: string): boolean {
  if (listEntryHead(t, offset, end)) return true;
  // Maska na początku wiersza z dwukropkiem za nią to prefiks mówcy w czacie albo etykieta
  // („… tu Gosia⏎Paweł Król: siema", „Pozdrawiam⏎Anna⏎Jan Kowalski: ok") — imię z końca
  // poprzedniego wiersza to inna osoba, a sklejenie zjadało granicę wypowiedzi. Ale gdy maska
  // zastąpiła SAMO nazwisko („Świadek: Jan⏎Kowalski: nie stawił się", „Barbara⏎Kowalska: hej"),
  // to para złamana zawinięciem wiersza — imię należy do niej, inaczej zostawało jawne obok maski.
  if (/^[ \t]*:/.test(t.slice(end, end + 4)) && !(name && raw && surnameOnlySpeakerAfter(raw, name))) return true;
  const maskBefore = RE_PERSON_MASK_BEFORE.exec(t.slice(Math.max(0, offset - 24), offset));
  // Po przecinku albo średniku blokuje tylko maska samego nazwiska (komórka „Kowalski;Jan⏎Nowak").
  // Gdy przed separatorem stała cała osoba („Świadkowie: Anna Nowak, Jan⏎Kowalski", „Nowak Anna,
  // Jan⏎Kowalski"), imię z końca wiersza zaczyna następną osobę i należy do nazwiska pod nim.
  // Ogniwo musi mieć TEN separator co tekst przed imieniem: „, Jan⏎Wójcik" z innego miejsca pisma
  // nie odblokowuje komórki „Kowalski;Jan⏎Nowak" (sklejało wiersze CSV).
  const sepHere = maskBefore?.[0].slice(maskBefore[0].indexOf(']') + 1).trim();
  if (
    maskBefore &&
    !(
      /[,;|]/.test(maskBefore[0].slice(-4)) &&
      links?.some((l) => /^[ \t]*[,;][ \t]*$/.test(l.sep) && l.sep.trim() === sepHere && (linkPrevIsName(l) || pairBeforeLink(l)))
    )
  )
    return true;
  const adj = RE_ADJ_LINE_HEAD.exec(t.slice(t.lastIndexOf('\n', offset - 1) + 1, offset))?.[1];
  return !!adj && isGeoAdjective(adj);
}
/** Czy w oryginale za imieniem `name` w następnym wierszu stoi samo nazwisko z dwukropkiem
 *  („Jan⏎Kowalski: …")? Wyraz przed dwukropkiem nie może być imieniem („Anna⏎Piotr: …" to dwie osoby). */
function surnameOnlySpeakerAfter(raw: string, name: string): boolean {
  const re = new RegExp(String.raw`(?<!\p{L})${escapeRe(name)}[ \t]*\r?\n[ \t]*(\p{Lu}[\p{L}'’-]*)[ \t]*:`, 'gu');
  for (const mm of raw.matchAll(re)) if (!isFirstNameLike(mm[1]) && (!!surnameBase(mm[1]) || looksLikeSurname(mm[1]))) return true;
  return false;
}
/** Czy komórkę „Nazwisko,Imię" (przecinek bez odstępu) wydziela separator pola inny niż przecinek —
 *  średnik, „|", tabulator, cudzysłów, znacznik? Sam początek i koniec wiersza tego nie rozstrzyga:
 *  w „Nazwisko,Imię⏎Kowalski,Jan" przecinek rozdziela dwie kolumny CSV. */
function cellDelimitedNotByComma(t: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && t[i] === ' ') i--;
  if (i >= 0 && /[;|\t"'„“(<>]/.test(t[i])) return true;
  let j = end;
  while (t[j] === ' ') j++;
  return j < t.length && /[;|\t"'”)<>]/.test(t[j]);
}

const RE_MASK_HYPHEN_TAIL = new RegExp(
  `(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]|\\[MIEJSCOWOŚĆ\\])-\\r?\\n[ \\t]*([${PL_LO}]{2,14}|[${PL_UP}]{2,14})(?![${PL_UP}${PL_LO}0-9-])`,
  'g',
);
const RE_ADMIN_UNIT_WORD =
  /^(?:powiat\p{Ll}*|gmin\p{Ll}*|gm|woj|województw\p{Ll}*|wieś|wsi|miasto|miasta|poczta|osiedle|sołectwo|obręb|dzielnica|kod|ul|ulica|tel|kraj)$/u;
// Wyrazy przeniesione do następnego wiersza w oryginale: ogon (małymi literami) → początki sprzed
// łącznika. Maska zastąpiła już początek w `text`, więc o całym wyrazie rozstrzyga oryginał.
const RE_RAW_HYPHEN_SPLIT = new RegExp(
  `([${PL_UP}${PL_LO}]+)-\\r?\\n[ \\t]*([${PL_LO}]{2,14}|[${PL_UP}]{2,14})(?![${PL_UP}${PL_LO}0-9-])`,
  'g',
);
function rawHyphenHeads(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of raw.matchAll(RE_RAW_HYPHEN_SPLIT)) {
    const k = r[2].toLowerCase();
    const list = out.get(k);
    if (list) list.push(r[1].toLowerCase());
    else out.set(k, [r[1].toLowerCase()]);
  }
  return out;
}
function finalizePersons(ctx: RedactCtx): void {
  let links: Map<string, RawWordLink[]> | undefined;
  const rawLinks = (w: string): RawWordLink[] => (links ??= buildRawWordLinks(ctx.raw)).get(w) ?? [];
  // DOMKNIĘCIE W PRAWO, przed domknięciem w lewo: imię za maską w zapisie „Nazwisko Imię" („Kowalska
  // Anna Maria, PESEL …" → dawniej „[..] Maria", „Pozwany Kowalski Jan Paweł" → „Pozwany [..] Jan
  // Paweł"). Tylko przez spację: tabulator zaczyna kolumnę, a nowa linia następny wpis listy.
  // Kolejność ma znaczenie: osierocone imię na końcu wiersza domknięcie w lewo wciągało do maski
  // z NASTĘPNEGO wiersza i lista „Kowalska Anna Maria⏎Nowak Jan Piotr" sklejała się w jeden wiersz.
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(RE_MASK_THEN_NAME, (m, mask: string, w: string, offset: number, t: string) => {
      const wl = w.toLowerCase();
      if (!isFirstNameLike(w) || LEGAL_ENTITY_WORDS.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      // za imieniem zaczyna się inna nazwa własna: „[..] Lech Poznań" (klub), „[..] Jana Pawła II 5"
      // (ulica w adresie) — imię należy do niej, nie do osoby przed nim
      const after = t.slice(offset + m.length, offset + m.length + 40);
      const next = RE_NEXT_CAP_WORD_SP.exec(after)?.[1];
      if (next && !isFirstNameLike(next)) return m;
      // imię przed kolejną maską należy do NASTĘPNEJ osoby („[..]   Anna [..]" — kolumny
      // wyrównane spacjami); to rozstrzyga domknięcie w lewo i zachowuje odstępy
      if (RE_PERSON_MASK_AT_START.test(after.replace(/^ +/, ''))) return m;
      // „Maja" przed liczbą to miesiąc („… Maja 2024 r."), nie drugie imię
      if (wl === 'maja' && /^[ \t]+\d/.test(after)) return m;
      if (nameAfterMaskIsOtherPerson(linksAt(rawLinks(w), t, offset + m.length), wl)) return m;
      return mask;
    });
  }
  // DOMKNIĘCIE W PRAWO PRZEZ PRZECINEK, tylko w rekordzie: maska otwiera komórkę, a imię w mianowniku
  // ją zamyka („"[..], Jan","[PESEL]"", „<osoba>[..], Jan</osoba>", „Odbiorca: [..], Jan Maria").
  // W prozie („Rozmawiałem z [..], Marek też był", „Byli tam [..], Jan i Anna") to dwie osoby.
  // Tylko maska z SAMEGO nazwiska: za parą „Imię Nazwisko" imię po przecinku to następna osoba
  // („Rodzice: Jan Kowalski, Anna", „DW: Marek Zieliński, Ewa (sekretariat)"). Przecinek bez odstępu
  // tylko w komórce wydzielonej innym separatorem („Kowalski,Jan;85031412347"): sam wiersz
  // „Kowalski,Jan" to dwie kolumny CSV, a domknięcie zjadało kolumnę imienia.
  ctx.text = ctx.text.replace(RE_MASK_COMMA_NAME, (m, mask: string, a: string, b: string | undefined, offset: number, t: string) => {
    if (!POLISH_FIRST_NAMES.has(a.toLowerCase()) || (b && !POLISH_FIRST_NAMES.has(b.toLowerCase()))) return m;
    if (institutionLabelBefore(t, offset)) return m;
    if (!cellStartsBefore(t, offset) || !cellEndsAt(t, offset + m.length)) return m;
    if (!/[ \t]/.test(m[mask.length + 1] ?? '') && !cellDelimitedNotByComma(t, offset, offset + m.length)) return m;
    const commaLinks = linksAt(rawLinks(a), t, offset + m.indexOf(a, mask.length) + a.length);
    if (commaLinks.some((l) => linkAfterMask(l) || (l.sep[0] === ',' && (linkPrevIsName(l) || pairBeforeLink(l))))) return m;
    return mask;
  });
  // DOMKNIĘCIE: imię słownikowe tuż przed zamaskowaną osobą (spacja/_/-/JEDNA nowa linia) → do maski.
  // Nowa linia obejmuje „Jan\nWiśniewski" (imię na końcu wiersza, potwierdzone nazwisko w następnym) —
  // gate `isFirstNameLike` chroni („protokół\n[OSOBA]" zostaje). Dwa przebiegi: wciągnięcie jednego
  // imienia może odsłonić kolejne.
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(
      // separator: spacja/⇥/_/-/JEDNA nowa linia albo dosłowna ucieczka „\t" (JSON) — jak prawdziwy ⇥.
      // Także kropka BEZ odstępu („Konto Jan.Kowalski", „C:\Users\Jan.Kowalski"): login i katalog
      // profilu sklejają imię z nazwiskiem, a imię zostawało jawne przed maską. Kropka ze spacją
      // („z Janem. [OSOBA]") kończy zdanie i nie pasuje.
      new RegExp(`(?<![${NM_BOUND}])([${PL_UP}][${PL_LO}]+)([ \\t\\n_.-]|\\\\\\uE009)(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
      (m, w: string, sep: string, mask: string, offset: number, t: string) => {
        // forma imienia, która jest też słowem pospolitym („od Marka [..]", „od Ani [..]"), tylko
        // przez spację tuż przed maską; „Ani" dodatkowo w środku zdania (przed nim mały wyraz)
        const wl = w.toLowerCase();
        const colliding =
          COLLIDING_NAME_FORMS.has(wl) && sep === ' ' && (wl !== 'ani' || /\p{Ll}[ \t]+$/u.test(t.slice(Math.max(0, offset - 3), offset)));
        if (!colliding && !isFirstNameLike(w)) return m;
        // Kropka bez odstępu bywa też końcem zdania bez spacji (OCR, czat): „z Janem.Kowalski
        // odpisał" to dwie osoby. Login i katalog profilu mają imię w mianowniku („Jan.Kowalski").
        if (sep === '.' && !POLISH_FIRST_NAMES.has(w.toLowerCase())) return m;
        // patron w dopełniaczu tuż przed osobą („W kościele św. Anny [OSOBA] zagra", „parafii św.
        // Józefa [OSOBA]") — imię świętego nie należy do osoby za nim
        if (isFirstNameGenitive(wl) && precededByPatron(t, offset)) return m;
        // imię świętego („Order Świętego Jerzego [..]", „Krzyż Świętego Jerzego [..]")
        const pre = t.slice(Math.max(0, offset - 24), offset);
        if (RE_SAINT_WORD_BEFORE.test(pre)) return m;
        // Imię domykające wpis listy albo stojące za maską w swoim wierszu nie przechodzi do osoby
        // z następnego wiersza (sam wpis maskuje passListEntries niżej).
        if (sep === '\n' && newlineJoinBlocked(t, offset, offset + m.length, linksAt(rawLinks(w), t, offset + w.length), w, ctx.raw)) return m;
        // imię w sąsiedniej komórce TSV: własna maska, kolumna zostaje (patrz maskCells)
        return sep === '\t' ? `${mask}\t${mask}` : mask;
      },
    );
  }
  // DOMKNIĘCIE: imię doklejone ZA maską kropką albo podkreśleniem („folder Kowalski_Jan",
  // „Kowalski.Jan") — szyk „Nazwisko_Imię" w nazwach katalogów i kont. Bez odstępu i bez łącznika:
  // spację obsługuje (a3) z walidacją nazwiska, a łącznik należy do nazwiska dwuczłonowego.
  // Przy kropce, jak w lewo, imię tylko w mianowniku i maska tylko z nazwiska w mianowniku: „z
  // Kowalskim.Marek potwierdził" i „Jan Kowalski.Marek" to koniec zdania bez spacji i druga osoba.
  ctx.text = ctx.text.replace(RE_MASK_GLUED_NAME, (m, mask: string, w: string, offset: number, t: string) => {
    if (!isFirstNameLike(w)) return m;
    if (m[mask.length] === '.') {
      if (!POLISH_FIRST_NAMES.has(w.toLowerCase())) return m;
      const glued = linksAt(rawLinks(w), t, offset + m.length);
      if (glued.some((l) => linkAfterMask(l) || (l.sep === '.' && (linkPrevOblique(l) || linkPrevIsName(l) || pairBeforeLink(l))))) return m;
    }
    return mask;
  });
  // PRZENIESIENIE WYRAZU za maską („z powództwa Barbary Wojciechow-⏎skiej", „JAN KOWAL-⏎SKI",
  // „02-511 Warsza-⏎wa"): przebieg złapał początek nazwiska albo miasta, a ogon w następnym wierszu
  // zostawał jawny. Myślnik doklejony do maski i ciąg samych małych (albo samych wielkich) liter na
  // początku wiersza to druga część tego samego wyrazu. Miasto tylko z ogonem małymi literami.
  // Myślnik na końcu wiersza bywa też pauzą przed funkcją albo dalszym zdaniem („Jan Kowalski-⏎
  // kierownik", „Adam Mazur-⏎następnie go wycofał"): ogon doklejamy więc tylko wtedy, gdy początek
  // sprzed łącznika (z oryginału) razem z ogonem daje nazwisko albo miasto, a sam początek nie jest
  // już pełnym nazwiskiem czy miastem ze słownika.
  if (ctx.text.includes('-\n') || ctx.text.includes('-\r\n')) {
    let heads: Map<string, string[]> | undefined;
    ctx.text = ctx.text.replace(RE_MASK_HYPHEN_TAIL, (m, mask: string, tail: string) => {
      if (mask === '[MIEJSCOWOŚĆ]' && tail !== tail.toLowerCase()) return m;
      const lo = tail.toLowerCase();
      const ok = ((heads ??= rawHyphenHeads(ctx.raw)).get(lo) ?? []).some((h) => {
        const joined = h + lo;
        // Etykieta jednostki w następnym wierszu („Halinów-⏎powiat miński", „Zagnańsk-⏎gmina
        // Zagnańsk") to nie ogon nazwy: miasto spoza słownika przyjmowało każdy ogon i maska
        // zjadała nową linię razem z „powiat".
        if (mask === '[MIEJSCOWOŚĆ]') return POLISH_CITIES.has(joined) || (!POLISH_CITIES.has(h) && !RE_ADMIN_UNIT_WORD.test(lo));
        return !!surnameBase(joined) || (looksLikeSurname(joined) && !surnameBase(h));
      });
      return ok ? mask : m;
    });
  }
  // DOMKNIĘCIE OCR: imię z homoglifem tuż przed maską („J0anna [..]", „KaroI [..]", „Kami1 [..]",
  // „J0ANNA [..]"). Nazwisko maskował przebieg słownikowy albo OCR, a imię z zerem czy wielkim „I"
  // nie przechodziło bramki słownika i zostawało jawne. Słowo co najmniej 4-znakowe (kody „A1a",
  // „O1a" odpadają), normalizacja 0→o, I→l (tylko obok małych liter), 1→l albo 1→i („Mar1a").
  // Najpierw w prawo, na końcu wiersza („Nowak KaroI⏎Jan Kowalski" → „[..]⏎[..]"), potem w lewo ze
  // strażnikami nowej linii jak wyżej: dawniej imię z końca wiersza szło do maski osoby
  // z NASTĘPNEGO wiersza i lista się sklejała („[..] [..]", imię pod pseudonimem innej osoby).
  ctx.text = ctx.text.replace(RE_MASK_THEN_OCR_NAME, (m, mask: string, w: string, offset: number, t: string) => {
    const form = ocrFirstNameForm(w);
    if (!form) return m;
    const key = /^\p{L}+/u.exec(w)?.[0] ?? w;
    return nameAfterMaskIsOtherPerson(linksAt(rawLinks(key), t, offset + m.length), form) ? m : mask;
  });
  ctx.text = ctx.text.replace(RE_OCR_NAME_BEFORE_MASK, (m, w: string, sep: string, mask: string, offset: number, t: string) => {
    if (!ocrFirstNameLike(w)) return m;
    if (sep === '\n' && newlineJoinBlocked(t, offset, offset + m.length)) return m;
    return mask;
  });
  passListEntries(ctx);
  // DOMKNIĘCIE: inicjał imienia tuż przed zamaskowaną osobą („mec. J. [OSOBA-B]") wciąga do maski.
  ctx.text = ctx.text.replace(
    new RegExp(`${INITIAL_START}[${PL_UP}]\\.[ \\t]*(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
    (m, mask: string, offset: number, t: string) => {
      // na początku wiersza (po samych odstępach) to punkt wyliczenia („A. Jan Kowalski zeznał");
      // dosłowna ucieczka „\n" w JSON-ie też zaczyna wiersz (znak PUA z passProtectJsonEscapes)
      let i = offset - 1;
      while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
      if (i < 0 || t[i] === '\n' || ((t[i] === '\uE00A' || t[i] === '\uE00D') && t[i - 1] === '\\')) return m;
      // „Sp. J." / „Sp. K." — człon formy prawnej spółki (jawna, komandytowa), nie inicjał
      if (/(?<!\p{L})[Ss][Pp]\.$/u.test(t.slice(Math.max(0, i - 3), i + 1))) return m;
      if (isHonorificP(t, offset)) return m; // „Sz. P. [OSOBA-A]" — „P." to „Pan"
      return mask;
    },
  );
  // „[OSOBA-A] Z D. [OSOBA-B]" — skrót „z domu" przed nazwiskiem panieńskim (znacznik z
  // passPersonMaidenAfterMask) wraca dopiero po domknięciu inicjałów, żeby nie poszedł do maski.
  if (ctx.text.includes(MAIDEN_D_SENTINEL)) ctx.text = ctx.text.split(MAIDEN_D_SENTINEL).join('D');
  // DOMKNIĘCIE: łańcuch inicjałów przed maską („J.K. [OSOBA-A]" → cała maska, „Dr.J. […]" → „Dr.[…]").
  // Skróty (P.S., S.A., P.H.U., W.P.) zostają przed maską — rozstrzyga dotChainKind.
  ctx.text = ctx.text.replace(
    new RegExp(`${DOT_CHAIN}[ \\t]*(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
    (m, head: string, ini: string, mask: string) => {
      const kind = dotChainKind(head, ini);
      if (kind === 'absorb') return mask;
      if (kind === 'keepTitle') return `${head}${mask}`;
      return m;
    },
  );
  // DOMKNIĘCIE: cząstka obcego nazwiska wieloczłonowego po masce osoby („[OSOBA-F] Van Anh").
  ctx.text = ctx.text.replace(
    /(\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])[ \t]+(?:[Vv][ao]n|[Dd]e[rl]|[Dd]ella|[Bb]in|[Tt]er|D[aei]|De[rl]?|El|Al|L[ae])[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+/g,
    '$1',
  );
  // STABILNA NUMERACJA: etykiety osób wg kolejności PIERWSZEGO wystąpienia w tekście.
  {
    const seen: string[] = [];
    for (const mm of ctx.text.matchAll(/\[OSOBA-([A-Z]+)\]/g)) {
      if (!seen.includes(mm[1])) seen.push(mm[1]);
    }
    const remap = new Map(seen.map((l, i) => [l, indexToLetters(i)]));
    ctx.text = ctx.text.replace(/\[OSOBA-([A-Z]+)\]/g, (_m, l: string) => `[OSOBA-${remap.get(l)}]`);
  }
  // PRZYWRÓCENIE chronionych URL-i (PII wewnątrz nich zamaskowano w passProtectUrls).
  if (ctx.protectedUrls.length) {
    ctx.text = ctx.text.replace(RE_URL_SENTINEL, (mm, letters: string) => ctx.protectedUrls[lettersToIndex(letters)] ?? mm);
  }
}

// PRZYWRÓCENIE ucieczek „\n/\r/\t" (passProtectJsonEscapes) — PO przywróceniu URL-i, bo zapamiętane
// adresy też mogą je zawierać. Znak PUA bez backslasha (gdyby maska zjadła backslash) też wraca
// jako pełna ucieczka — wartość JSON-a ma zostać poprawnym łańcuchem.
function passRestoreJsonEscapes(ctx: RedactCtx): void {
  if (!ctx.jsonEscapes) return;
  ctx.text = ctx.text.replace(/\\?([\uE009\uE00A\uE00D])/g, (_m, c: string) => `\\${JSON_ESC_FROM_PUA[c]}`);
}

/** Czy tekst to dokument JSON: obiekt/tablica w całości albo NDJSON (każdy niepusty wiersz osobno). */
function isJsonDocument(s: string): boolean {
  const parses = (t: string): boolean => {
    if (!/^[[{]/.test(t)) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  };
  const t = s.trim();
  if (!/^[[{]/.test(t)) return false; // szybkie odcięcie prozy, zanim cokolwiek parsujemy
  if (parses(t)) return true;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 && lines.every(parses);
}

// FAZA 5b · JSON: maska w miejscu LICZBY. Wartość liczbową („"telefon": 512345678", „"pesel":
// 85031412347", tablica numerów) maskują przebiegi cyfrowe z FAZY 2, które nie znają składni —
// goły placeholder „[TELEFON]" to nie wartość JSON i wynik przestawał się parsować. Tu ujmujemy
// w cudzysłowy maski stojące POZA literałami łańcuchowymi. Bramka DOKUMENTOWA na oryginale: musi
// być poprawnym JSON-em albo NDJSON-em — proza nigdy się nie parsuje, więc „Pole "Telefon":
// 512 345 678" czy „Lista: [601234567]" zostają bez zmian. Wykrywanie się nie zmienia (liczby pod
// dowolnym kluczem dalej są maskowane — inaczej „"id": 85031412347" wyciekałby jako PESEL).
function passJsonRequote(ctx: RedactCtx): void {
  if (ctx.text === ctx.raw || !isJsonDocument(ctx.raw)) return;
  const masks = [...new Set(Object.values(ctx.M))].sort((a, b) => b.length - a.length).map(escapeRe);
  // Literał łańcuchowy (z ucieczkami) pochłaniany w całości i oddawany bez zmian; maska poza nim
  // dostaje cudzysłowy. JSON.stringify — na wypadek własnej maski z cudzysłowem albo backslashem.
  const re = new RegExp(`"(?:[^"\\\\\\n]|\\\\.)*"|(${[...masks, '\\[OSOBA-[A-Z]+\\]'].join('|')})`, 'g');
  ctx.text = ctx.text.replace(re, (m, mask: string | undefined) => (mask ? JSON.stringify(mask) : m));
}

// ============================================================================
// Główna funkcja redakcji
// ============================================================================

export function redactPII(input: string, options?: RedactOptions): RedactionResult {
  if (!input || typeof input !== 'string') {
    return { redacted: input ?? '', found: [] };
  }

  const counts = new Map<PiiType, number>();
  const bump = (t: PiiType) => counts.set(t, (counts.get(t) ?? 0) + 1);

  // Filtr typów (brak = wszystkie) i ewentualne własne placeholdery.
  const enabled = options?.types ? new Set(options.types) : null;
  const on = (t: PiiType) => enabled === null || enabled.has(t);
  const M: Record<PiiType, string> = options?.masks ? { ...MASK, ...options.masks } : MASK;

  // Pseudonimizacja: klucz (znormalizowane nazwisko) → stała etykieta [OSOBA-X].
  // Etykiety przydzielane w kolejności WYKRYCIA (pary → wyzwalacze → solo), deterministycznie.
  const personLabels = options?.pseudonyms ? new Map<string, string>() : null;
  const maskedSurnames = new Set<string>();
  const personMask = (surnameToken: string): string => {
    const key = normalizeSurnameKey(surnameToken);
    maskedSurnames.add(key);
    if (!personLabels) return M.IMIE;
    let label = personLabels.get(key);
    if (!label) {
      label = indexToLetters(personLabels.size);
      personLabels.set(key, label);
    }
    return `[OSOBA-${label}]`;
  };

  const ctx: RedactCtx = { text: input, raw: input, on, bump, M, personMask, pseudonyms: !!personLabels, maskedSurnames, protectedUrls: [], jsonEscapes: false, loginSeeds: new Set() };

  // Kolejność MA znaczenie: przebiegi czytają placeholdery poprzednich, a kolejność pierwszego
  // bump danego typu wyznacza kolejność listy `found`. Sekwencja = dawna kolejność fizyczna 1:1.

  // ═══════════════════════ FAZA 0 · OCHRONA URL (sentinel) ═══════════════════════
  passProtectJsonEscapes(ctx); // PRZED URL-ami: podmieniona ucieczka kończy adres
  passProtectUrls(ctx);

  // ═════════ FAZA 1 · STRUKTURALNE WYSOKIEJ PRECYZJI (etykieta / wzorzec) ═════════
  passEmail(ctx);
  passTokens(ctx);
  passMac(ctx);
  passIp(ctx);
  passVin(ctx);
  passFormFields(ctx);
  passStructured(ctx);
  passDelimitedTable(ctx);
  passLogin(ctx);
  // PRZED passZnakSprawy (kształt numeru KSeF pasuje do wzorca znaku sprawy — dostawał wtedy
  // maskę [ZNAK-SPRAWY]) i PRZED passNip (inaczej znika sam NIP, reszta numeru zostaje jawna).
  passKsef(ctx);
  passKw(ctx); // PRZED passZnakSprawy: numer KW po „Sygn."/„Znak:" dostawał maskę znaku sprawy
  passZnakSprawy(ctx);

  // ═════ FAZA 2 · IDENTYFIKATORY NUMERYCZNE (suma kontrolna / etykieta / długość) ═════
  passIban(ctx);
  passAccount(ctx);
  passPesel(ctx);
  passNip(ctx);
  passCard(ctx);
  passRegon(ctx);
  passPhone(ctx);
  passIdCard(ctx);
  passPassport(ctx);
  passKrs(ctx);
  passDriverLicense(ctx);
  passPlate(ctx);
  passPostal(ctx);

  // ═══════════════════ FAZA 3 · DATA I ADRES / MIEJSCOWOŚĆ ═══════════════════
  passBirthDate(ctx);
  passAddress(ctx);
  passAddressAfterResidenceLabel(ctx);
  passPostalNoHyphen(ctx);
  passCity(ctx);

  // ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
  passProtectFictional(ctx);
  passPersonMixedCase(ctx); // PRZED wyzwalaczem „Pan/Pani" (zjadał imię, nazwisko zostawało jawne)
  passPersonRoleComplement(ctx);
  passPersonPairs(ctx);
  passPersonTrigger(ctx);
  passPersonStrongTrigger(ctx);
  passPersonSoloDict(ctx);
  passPersonInitial(ctx);
  passPersonHomographAnchor(ctx);
  passPersonForeign(ctx);
  passPersonSoloMorph(ctx);
  passPersonOcrTitle(ctx);
  passPersonOcrPair(ctx);
  passPersonOcrMix(ctx);
  passPersonMaidenAfterMask(ctx);
  passPersonParents(ctx);

  // ══════ FAZA 5 · DOMKNIĘCIA OSÓB · STABILNA NUMERACJA · PRZYWRÓCENIE URL ══════
  finalizePersons(ctx);
  passRestoreJsonEscapes(ctx);
  passJsonRequote(ctx); // na samym końcu: widzi tekst z przywróconymi ucieczkami

  const found: PiiFinding[] = [...counts.entries()].map(([type, count]) => ({ type, count }));
  return { redacted: ctx.text, found };
}

/** Wygodny skrót: czy tekst zawiera jakiekolwiek PII (np. do ostrzeżeń UI). */
export function hasPII(text: string): boolean {
  return redactPII(text).found.length > 0;
}

/** Czytelne etykiety wykrytych typów (np. do komunikatu „Zamaskowano: PESEL, e-mail"). */
const HUMAN_LABEL: Record<PiiType, string> = {
  EMAIL: 'adres e-mail',
  IBAN: 'numer konta',
  'NR-KONTA': 'numer konta',
  KARTA: 'numer karty płatniczej',
  PESEL: 'PESEL',
  NIP: 'NIP',
  REGON: 'REGON',
  TELEFON: 'numer telefonu',
  DOWOD: 'numer dowodu',
  PASZPORT: 'numer paszportu',
  KRS: 'numer KRS',
  KSEF: 'numer KSeF',
  KW: 'numer księgi wieczystej',
  'PRAWO-JAZDY': 'nr prawa jazdy',
  'NR-REJESTRACYJNY': 'nr rejestracyjny',
  VIN: 'VIN',
  IP: 'adres IP',
  MAC: 'adres MAC',
  TOKEN: 'token',
  LOGIN: 'login',
  'ZNAK-SPRAWY': 'znak sprawy',
  'KOD-POCZTOWY': 'kod pocztowy',
  'DATA-UR': 'datę urodzenia',
  ADRES: 'adres',
  MIEJSCOWOSC: 'miejscowość',
  IMIE: 'imię i nazwisko',
};

export function describeFindings(found: PiiFinding[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const f of found) {
    const label = HUMAN_LABEL[f.type];
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}
