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
  isGeoAdjective,
  isCompoundAdjective,
  NON_SURNAME_ADJ,
  HOMOGRAPH_SURNAMES,
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
  const s = raw.replace(/\s/g, '').toUpperCase();
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
const CAP_WORD = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?`;
// Separatory między członami nazwy to [ \t]+ (BEZ \n) — nazwisko na końcu wiersza NIE może
// skleić się z pierwszym wyrazem następnej linii (psuło układ i wciągało etykiety formularzy).
// Prawa granica `(?![PL_UP PL_LO])` na KOŃCU każdego wzorca: bez niej token mieszany
// („KowaIski" z OCR-owym I zamiast l, „McDonald") był dopasowywany DO POŁOWY — wprost
// („Jan Kowa|Iski") albo po backtrackingu („Jan Kow|aIski") — i maska ucinała słowo
// („[OSOBA-A]Iski" — wyciek fragmentu nazwiska; maskuj całość, nie fragment).
// Środek „ i "/„ oraz " przechwycony (grupa 2), bo wraca do wyniku w oryginalnym zapisie.
const RE_SPOUSES = new RegExp(`(?<![${PL_UP}${PL_LO}-])(${CAP_WORD})([ \\t]+(?:i|oraz)[ \\t]+)(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${PL_UP}${PL_LO}])`, 'g');
const RE_NAME_SEQ = new RegExp(`(?<![${PL_UP}${PL_LO}-])${CAP_WORD}(?:[ \\t]+${CAP_WORD}){1,3}(?![${PL_UP}${PL_LO}])`, 'g');
const RE_PAIR = new RegExp(`(?<![${PL_UP}${PL_LO}-])(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${PL_UP}${PL_LO}])`, 'g');
// Następny wyraz z wielkiej litery tuż za dopasowaniem (prawy kontekst pary w kroku a2).
const RE_NEXT_CAP_WORD = new RegExp(`^[ \\t]+(${CAP_WORD})`);
const RE_SOLO_DICT = new RegExp(`(?<![${PL_UP}${PL_LO}-])[${PL_UP}][${PL_LO}]+(?![${PL_LO}${PL_UP}-])`, 'g');
const RE_SOLO_MORPH = new RegExp(`(?<![${PL_UP}${PL_LO}-])${CAP_WORD}(?![${PL_UP}${PL_LO}])`, 'g');
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
 * („linii Langera", „prątki Kocha"). Mianownik po nich to osoba: „Kierownik linii Nowak", „konflikt
 * na linii Kowalski – Nowak", „Operator linii Gzowski".
 */
const GEN_ONLY_CONTEXT = new Set<string>(
  (
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią linie linii liniami objawem trójkąt trójkąta'
  ).split(/\s+/),
);
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
 * z nazwiskiem w dopełniaczu („Objaw Nowak zgłosiła się" to osoba).
 */
const afterNonPersonContext = (text: string, offset: number, word: string): boolean => {
  const prev = prevContextWord(text, offset);
  if (!prev) return false;
  if (prev.word === 'moście') return /(?:im|ym|ego)$/i.test(word);
  if (prev.cap) return EPONYM_HEADS.has(prev.word) && isObliqueSurnameForm(word);
  if (!NON_PERSON_CONTEXT.has(prev.word)) return false;
  return !GEN_ONLY_CONTEXT.has(prev.word) || isObliqueSurnameForm(word);
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
  if (gen && !POLISH_FIRST_NAMES.has(f)) return false;
  if (!withSurname && !gen) return false;
  return (gen ? ws.slice(1) : ws).some(
    (w) =>
      !isFirstNameGenitive(w) &&
      (/(?:sk|ck|dzk)[ia]$|(?:icz|czyk)$/.test(w) || surnameBase(w) === w || HOMOGRAPH_SURNAMES.has(w)),
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
 *  patron, nie osoba z dokumentu. Granica Unicode zamiast \b: ASCII \b nie widzi jej przed „ś". */
const RE_PATRON_ABBR = /(?<![\p{L}\d_])(?:im|ul|al|pl|os|bł)\.[ \t]+(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
// „św." to w protokołach sądowych także skrót od „świadek" („św. Kowalski zeznał", „Sąd
// przesłuchał św. Annę Gzowską") — bez kontekstu świadek wyciekał jako „patron". Dlatego święty
// tylko po rzeczowniku sakralnym albo „pw."/„im." (najwyżej dwa wyrazy przerwy: „Kościół
// parafialny pw. św. …"), w tej samej linii. Bez kontekstu „św. Antoniego" zostaje w masce —
// drobne nadmaskowanie zamiast wycieku świadka.
const SAINT_CONTEXT_WORD =
  /^(?:kości[oóe]\p{L}*|parafi\p{L}*|bazylik\p{L}*|katedr\p{L}*|kaplic\p{L}*|sanktuari\p{L}*|klasztor\p{L}*|kolegiat\p{L}*|cerk\p{L}*|zgromadzeni\p{L}*|zakon\p{L}*|sióstr|pw\.|im\.)$/iu;
const RE_SAINT_ABBR = /(?<!\p{L})św\.[ \t]+(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
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
  // rzeczownika sakralnego („Pożar kościoła widział św. Kowalski", „W kościele św. Nowak widział …")
  return RE_PATRON_ABBR.test(near) || (saintWithContext(t, offset, near) && !nominativePersonAhead(t, offset, true));
};
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
const STREET_RANK = `(?:gen|pułk|płk|ppłk|mjr|kpt|por|ks|św|bł|bp|abp|kard|marsz|prof|doc|dra|dr|hab|med|lek|n|inż|hr)\\.?`;
// ZACHOWAWCZO: strażnik uznaje patrona TYLKO bezpośrednio po kotwicy, w JEDNEJ LINII, przez ciąg
// nazw własnych i RANG/skrótów tytułów („ul. gen. Andersa", „al. ks. Popiełuszki"). ŚWIADOMIE BEZ
// mostkowania spójników „oraz/i", przecinka, nowej linii i kropki w tokenie nazwy — każdy z nich
// pozwalał wchłonąć REALNĄ osobę z następnej klauzuli/wiersza/zdania („ulicy X oraz Jan Kowalski",
// „ulic X, Osoba", „skwer X\nOsoba", „X. Osoba") = udokumentowana regresja (wyciek osoby). Cena:
// DRUGI patron w wyliczeniu „ulic X oraz Y" bywa nadmaskowany (zamaskowana nazwa ulicy, NIE wyciek
// PII — dopuszczalne wg zasady „precyzja"). PIERWSZY patron (tuż po kotwicy) jest zawsze chroniony.
// Rangi tylko PRZED nazwą, tuż po kotwicy: tytuł po nazwie ulicy czy patrona zaczyna osobę
// („Na ul. Długiej lek. Anna Nowak", „Szpital im. Mikołaja Kopernika lek. med. Jan Nowak").
const RE_STREET_EPONYM_TAIL = new RegExp(
  `(?<![\\p{L}])${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?` +
    `(?:[ \\t]+${STREET_RANK})*` +
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
  /^(?:szkoł|szkół|szkol|szpital|przedszkol|liceum|gimnazj|technikum|uniwersyte|akademi|politechni|instytu|ośrod|zespoł|zespół|bibliotek|hufc|hufiec|parafi|fundacj|stowarzysze|muze|teatr|filharmoni|centrum|poradni|żłob|internat|burs)\p{L}*$/iu;
/** Czy tuż przed „im" stoi nazwa instytucji (najwyżej dwa wyrazy z wielkiej litery przerwy: „Szkoła
 *  Podstawowa im", „Szpitala im") albo „nr N" („Szkoła Podstawowa nr 3 im")? Skan kilku ostatnich
 *  wyrazów zamiast regexu z „$" próbowanego od każdej pozycji wycinka. */
function institutionBeforeIm(pre: string): boolean {
  const ws = pre.trimEnd().split(/[ \t]+/).slice(-4);
  for (let i = ws.length - 1, caps = 0; i >= 0; i--) {
    const w = ws[i];
    if (RE_INSTITUTION_WORD.test(w)) return true;
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
}
const FORM_FIELDS: FormField[] = [
  { re: /^imię\s+i\s+nazwisko$|^nazwisko\s+i\s+imię$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^nazwisk[ao](?:\s+(?:rodowe|panieńskie|poprzednie))?(?:\s+(?:matki|ojca))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^(?:pierwsze\s+|drugie\s+|kolejne\s+)?imi(?:ę|ona)(?:\s+(?:ojca|matki))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^data\s+urodzenia$/i, type: 'DATA-UR', kind: 'date', mask: '[DATA-URODZENIA]' },
  { re: /^miejsce\s+urodzenia$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^miejscowość$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^(?:miejsce|adres)\s+(?:zamieszkania|zameldowania|pobytu)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^ulica$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:nr|numer)\s+(?:domu|lokalu|mieszkania)$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
];
/** Wartości „puste" pola — nie maskujemy (nie są danymi). */
const FORM_EMPTY_VALUES = new Set([
  'brak', 'niedotyczy', 'nd', 'n/d', 'bd', 'x', 'bez', '.', '-', '–', '—', '',
  'nieznane', 'nieznana', 'nieznany', 'niepodano', 'niepodane', 'null', 'none',
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
    'nazwisko nazwiska imię imiona imie data miejsce miejscowość ulica nr numer kraj województwo ' +
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
    // Etykieta pola / klucz strukturalny („Imię:", „firstName") to MOCNA kotwica — maskujemy imię/
    // nazwisko NIEZALEŻNIE od wielkości liter („Imię: pamela", „pAMELA"). Nadal 1–4 wyrazy z samych
    // liter (bez cyfr i prozy); WERSALIKI działały już wcześniej, tu dochodzi zapis małą/mieszaną literą.
    return /^\p{L}[\p{L}'’.‑-]*(?:[ \t]+\p{L}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'date') return /\d{4}|\d{1,2}[-.\/]\d{1,2}/.test(t);
  // addr: ulica (nazwa własna) lub nr domu (cyfry). Odrzuć zdanie: KAŻDY wyraz musi być nazwą
  // własną (wielka litera / WERSALIKI), tokenem z cyfrą, albo krótką cząstką adresową (m, lok, ul…).
  const toks = t.split(/\s+/);
  if (toks.length > 5) return false;
  const ADDR_PARTICLE = /^(m|lok|ul|al|os|pl|nr|im|św|gen|ks)\.?$/i;
  return (
    /^[\p{Lu}\d]/u.test(t) &&
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
    'komendant komendanta zastępca zastępcy poseł posła posłanka senator senatora wiceminister wiceministra'
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
    'bóg boga bogu bogiem jezus jezusa jezusowi jezusem chrystus chrystusa chrystusowi chrystusem ' +
    'maryja maryi maryję maryją'
  ).split(/\s+/),
);

/**
 * Pierwszy wyraz NAZWY WŁASNEJ obiektu, wydarzenia, akwenu („Kościół Mariacki", „Puszcza
 * Białowieska", „Sobór Watykański", „Kanał Sueski"). Przymiotnik -ski/-cki po nim to człon nazwy,
 * nie nazwisko — w mianownikowej gałęzi pary (krok a2) para nie jest wtedy osobą. Tylko tam: w innych
 * przebiegach te rzeczowniki nie są kotwicą („Kościół Kowalskiego" nie jest tu rozstrzygany).
 */
const PROPER_NAME_HEADS = new Set<string>(
  (
    'kościół bazylika katedra kaplica klasztor sanktuarium cmentarz pomnik kopiec hejnał jarmark ' +
    'festiwal konkurs turniej noc dzień tydzień ocean morze kanał półwysep zatoka wyspa jezioro puszcza ' +
    'las ogród pałac zamek brama wieża dworzec traktat pokój układ pakt sobór synod kongres bitwa ' +
    'powstanie wyżyna nizina kotlina pojezierze pustynia szlak trakt'
  ).split(/\s+/),
);

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
    'kazimierz dolny|kazimierza wielka'
  ).split('|'),
);

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

/** Czy słowo wygląda na polskie imię (mianownik ZE SŁOWNIKA lub jego forma odmieniona)? */
function isFirstNameLike(word: string): boolean {
  const w = word.toLowerCase();
  if (POLISH_FIRST_NAMES.has(w)) return true;
  for (const suf of NAME_INFLECTIONS) {
    const stem = suf ? w.slice(0, -suf.length) : w;
    if (stem.length >= 2 && w.endsWith(suf) && FIRST_NAME_STEMS.has(stem)) return true;
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

// ── Klucze strukturalne XML/JSON ──────────────────────────────────────────────
// Tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna jak etykieta formularza —
// maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Klucz normalizujemy (lowercase, bez ._-), więc „first_name"/„FirstName" to jeden wpis.
type StructKind =
  | 'first' | 'surname' | 'fullname' | 'name' | 'person' | 'phone' | 'email' | 'addr'
  | 'city' | 'postal' | 'birth' | 'login' | 'pesel' | 'nip' | 'regon';
const STRUCT_KEYS = new Map<string, StructKind>(Object.entries({
  imie: 'first', imię: 'first', imiona: 'first', firstname: 'first', givenname: 'first', middlename: 'first',
  nazwisko: 'surname', surname: 'surname', lastname: 'surname', familyname: 'surname',
  fullname: 'fullname', imienazwisko: 'fullname', imięnazwisko: 'fullname',
  // „osoba"/„person" bywa kategorią („<osoba>prawna</osoba>", „"person": "fizyczna"") — bramka jak dla „name"
  osoba: 'person', person: 'person',
  name: 'name', // generyczne — bramka słownikowa (bywa nazwą produktu/firmy, nie osoby)
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', tel: 'phone', telefon: 'phone', telephone: 'phone', fax: 'phone',
  email: 'email', mail: 'email',
  street: 'addr', address: 'addr', addressline: 'addr', ulica: 'addr', adres: 'addr',
  city: 'city', town: 'city', miasto: 'city', miejscowosc: 'city', miejscowość: 'city',
  postalcode: 'postal', postcode: 'postal', zipcode: 'postal', zip: 'postal', kodpocztowy: 'postal',
  birthdate: 'birth', dateofbirth: 'birth', dob: 'birth', dataurodzenia: 'birth',
  login: 'login', username: 'login', user: 'login', userid: 'login',
  pesel: 'pesel', nip: 'nip', regon: 'regon',
  // Numeru KSeF NIE ma na tej liście celowo: nazwa tagu/klucza („<NrKSeF>", „ksefNumber") sama
  // zawiera słowo „KSeF", więc kotwica dokumentowa passKsef i tak zadziała — bez dublowania reguł.
} as Record<string, StructKind>));
const STRUCT_KIND_TYPE: Record<StructKind, PiiType> = {
  first: 'IMIE', surname: 'IMIE', fullname: 'IMIE', name: 'IMIE', person: 'IMIE', phone: 'TELEFON',
  email: 'EMAIL', addr: 'ADRES', city: 'MIEJSCOWOSC', postal: 'KOD-POCZTOWY',
  birth: 'DATA-UR', login: 'LOGIN', pesel: 'PESEL', nip: 'NIP', regon: 'REGON',
};
const normStructKey = (k: string): string => k.toLowerCase().replace(/[._-]/g, '');

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
  '(?![ \\t]*(?:kg|t(?!\\.[a-ząćęłńóśźż])|ton\\w*|km|kW|KM(?![ \\t]+(?:Policji|PSP))|mm|cm|zł|PLN|szt)(?![\\wąćęłńóśźż]))';

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
  /** Klucze nazwisk już zamaskowanych w dokumencie (normalizeSurnameKey) — także bez pseudonimów. */
  maskedSurnames: Set<string>;
  protectedUrls: string[];
  /** Czy passProtectJsonEscapes podmienił ucieczki „\n/\r/\t" (wtedy trzeba je przywrócić). */
  jsonEscapes: boolean;
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
function passProtectUrls(ctx: RedactCtx): void {
  // Kotwica KSeF liczona RAZ: to skan całego wejścia, a wewnątrz callbacku wykonywałby się
  // dla każdego adresu z osobna (dokument z tysiącami linków rósł kwadratowo — 3,7 s na 1 MB).
  const ksefInUrls = ctx.on('KSEF') && hasKsefAnchor(ctx);
  // Podmieniona ucieczka „\n/\t" kończy adres (w JSON-ie „…/x\nKowalski Jan" nazwisko nie należy do URL-a).
  ctx.text = ctx.text.replace(/\b(?:https?:\/\/|www\.)[^\s<>"'„”()\uE009\uE00A\uE00D]+/g, (raw) => {
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
    for (const rule of URL_PARAM_RULES) {
      if (!ctx.on(rule.type)) continue;
      url = url.replace(rule.re, (_pm, key: string) => {
        ctx.bump(rule.type);
        return `${key}${ctx.M[rule.type]}`;
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

// 1b) POLA FORMULARZA — etykieta w linii, wartość w tej samej („Nazwisko: X") lub NASTĘPNEJ
// („Nazwisko\nWILCZYŃSKI"). Kotwica strukturalna o wysokiej precyzji; łapie też WERSALIKI.
// Blok BEZ pojedynczej bramki `on()` — każde pole sprawdza własny typ.
function passFormFields(ctx: RedactCtx): void {
  const lines = ctx.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const bare = stripFormPrefix(lines[i]);
    const label = formLabelOf(bare); // raz na linię, nie dla każdego pola z FORM_FIELDS
    const field = FORM_FIELDS.find((f) => f.re.test(label));
    if (!field || !ctx.on(field.type)) continue;
    const colon = bare.match(/:\s*(.+)$/); // „Etykieta: WARTOŚĆ" w tej samej linii
    if (colon) {
      // Data w tej samej linii ma już swój detektor (passBirthDate), więc same-line
      // obsługujemy tylko dla imion/miejsc/adresów.
      if (field.kind === 'date') continue;
      const val = colon[1].trim();
      if (isValidFormValue(val, field.kind)) {
        // Końcowe „\r" (tekst z CRLF dzielimy po „\n") zostaje — inaczej linia z zamaskowanym
        // polem traciła windowsowy koniec wiersza i plik wychodził z mieszanymi końcami linii.
        lines[i] = lines[i].replace(new RegExp(`${escapeRe(val)}[^\\S\\r]*(?=\\s*$)`), field.mask);
        ctx.bump(field.type);
      }
      continue;
    }
    // wartość w następnej NIEPUSTEJ linii — pomiń puste i podpowiedzi w nawiasach
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || /^\(.*\)$/.test(lines[j].trim()))) j++;
    if (j >= lines.length || isFormLabelLine(lines[j])) continue;
    const val = lines[j].trim();
    if (!isValidFormValue(val, field.kind)) continue;
    if (field.kind === 'date') {
      // maskuj SAMĄ datę w linii wartości (zachowaj adnotacje: „1990-01-01 (wg aktu)")
      if (RE_DATE_VALUE.test(lines[j])) {
        lines[j] = lines[j].replace(RE_DATE_VALUE, field.mask);
        ctx.bump(field.type);
      }
      continue;
    }
    lines[j] = lines[j].replace(/^(\s*)[\s\S]*?(\s*)$/, `$1${field.mask}$2`);
    ctx.bump(field.type);
  }
  ctx.text = lines.join('\n');
}

// 1c) STRUKTURA XML/JSON — tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna.
// Maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Blok BEZ pojedynczej bramki `on()` — structMask sprawdza typ per-wpis.
// Kategoria pod kluczem „osoba"/„person" („<osoba>Prawna</osoba>", „"person": "Fizyczna"") — nie osoba.
const PERSON_CATEGORY_VALUES = new Set<string>(
  'osoba prawna prawne fizyczna fizyczne kontaktowa kontaktowe upoważniona upoważnione zainteresowana trzecia legal natural physical juridical person'.split(' '),
);
// Imiona, które są też rzeczownikiem pospolitym albo nazwą rośliny/produktu („róża", „kalina",
// „jagoda", „pola", „maja") — zapisane małą literą bez nazwiska nie przesądzają o osobie.
const NOUN_LIKE_FIRST_NAMES = new Set<string>('róża kalina jagoda nadzieja wiktoria pola wiola maja'.split(' '));
// Partykuły nazwisk („Jan van Dijk", „de la Cruz") — nie są ani imieniem, ani nazwiskiem.
const SURNAME_PARTICLES = new Set<string>('van von de del della der den di da du dos das la le ter ten'.split(' '));
// Wyraz małą literą o końcówce przymiotnika, imiesłowu, dopełniacza albo zdrobnienia („koralowa",
// „pnąca", „pustyni", „pszczółka") — w nazwie produktu częsty, w nazwisku spoza słownika rzadki.
const RE_LOWER_NOT_SURNAME = /(?:ow[aey]|n[aey]|ąc[aey]|yni|ii|ej|ego|k[aio])$/;
/**
 * Czy wartość małymi literami pod generycznym „name"/„osoba" to osoba („anna", „anna gzik",
 * „marek sowa", „nowak anna", „jan van dijk")? Proza łapie tylko nazwiska ze słownika, więc imię
 * z homografem albo z rzadkim nazwiskiem w zrzucie bazy czy eksporcie czatu wyciekało w całości.
 * Nazwa produktu („róża pustyni", „kalina koralowa", „weronika kłosowa") i kategoria („prawna")
 * zostają: imię-rzeczownik bez potwierdzonego nazwiska albo drugi wyraz o końcówce przymiotnika.
 */
function lowercaseNameLooksLikePerson(words: string[]): boolean {
  const ws = words.map((w) => w.toLowerCase()).filter((w) => !SURNAME_PARTICLES.has(w));
  if (!ws.length) return false;
  const confirmed = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(w);
  const plausible = (w: string): boolean => confirmed(w) || POLISH_FIRST_NAMES.has(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME.test(w));
  const [first] = ws;
  const last = ws[ws.length - 1];
  // jeden wyraz: nazwisko ze słownika/morfologii („a.kaminska" — nazwa konta) albo imię; homograf
  // sam („kalina", „sowa") to raczej nazwa
  if (ws.length === 1) {
    return !!surnameBase(first) || looksLikeSurname(first) || (POLISH_FIRST_NAMES.has(first) && !NOUN_LIKE_FIRST_NAMES.has(first));
  }
  const rest = ws.slice(1);
  if (POLISH_FIRST_NAMES.has(first)) {
    if (rest.every((w) => confirmed(w) || POLISH_FIRST_NAMES.has(w))) return true;
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && rest.every(plausible)) return true;
  }
  // szyk odwrócony „nowak anna", „sowa teresa" — nazwisko potwierdzone (inaczej „pasta Barbara",
  // nazwa produktu z imieniem na końcu, szła jako osoba)
  return POLISH_FIRST_NAMES.has(last) && !NOUN_LIKE_FIRST_NAMES.has(last) && ws.slice(0, -1).every(confirmed);
}

function passStructured(ctx: RedactCtx): void {
  const structMask = (kind: StructKind, value: string): string | null => {
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
        // partykuła małą literą nie odbiera wartości charakteru nazwy własnej („Jan van Dijk")
        const proper = ws.filter((w) => !SURNAME_PARTICLES.has(w));
        if (!proper.length || !RE_PROPER_WORDS.test(proper.join(' '))) {
          if (!lowercaseNameLooksLikePerson(ws)) return null;
          break;
        }
        // „osoba"/„person" od wielkiej litery to osoba jak pod „fullname" — także szyk „NAZWISKO IMIĘ",
        // WERSALIKI, homograf i rzadkie nazwisko („Wróbel Anna", „KOWALSKI JAN", „T. Gzik"); bramka
        // słownikowa „name" je odrzucała. Zostaje tylko kategoria („Prawna", „Osoba Fizyczna"). Jeden
        // wyraz to częściej rola czy kategoria („Pracownik", „Klient", „Wnioskodawca", „Admin") — osobą
        // jest wtedy, gdy wygląda na imię albo nazwisko („Kowalski", „Wróbel").
        if (kind === 'person') {
          if (ws.every((w) => PERSON_CATEGORY_VALUES.has(w.toLowerCase()))) return null;
          if (proper.length === 1) {
            const w = proper[0].toLowerCase();
            if (!isFirstNameLike(w) && !surnameBase(w) && !looksLikeSurname(w) && !HOMOGRAPH_SURNAMES.has(w)) return null;
          }
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
        if (RE_BUILTIN_ACCOUNT.test(v)) return null;
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
    }
    const type = STRUCT_KIND_TYPE[kind];
    if (!ctx.on(type)) return null;
    ctx.bump(type);
    // nazwisko (samo lub na końcu pełnego imienia i nazwiska) → spójna etykieta [OSOBA-X]
    if (kind === 'surname' || kind === 'fullname' || kind === 'person' || (kind === 'name' && /\s/.test(v))) {
      return ctx.personMask(v.split(/\s+/).pop() as string);
    }
    return ctx.M[type];
  };
  // XML: <Tag>wartość</Tag> (tag może mieć atrybuty; wartość jednoliniowa, bez zagnieżdżeń)
  ctx.text = ctx.text.replace(
    /(<([A-Za-z_][\w.-]{0,40})(?:\s[^<>]*)?>)([^<>\r\n]{1,70})(<\/\s*\2\s*>)/g,
    (m, open: string, tag: string, value: string, close: string) => {
      const kind = STRUCT_KEYS.get(normStructKey(tag));
      if (!kind) return m;
      const mask = structMask(kind, value);
      return mask === null ? m : `${open}${mask}${close}`;
    },
  );
  // JSON: "klucz": "wartość" — maskowana sama wartość między cudzysłowami. Także JSON zagnieżdżony
  // w łańcuchu („"payload":"{\"imie\":\"Jadwiga\"}"): poziom ucieczki cudzysłowu (grupa 2) jest
  // wspólny dla klucza i wartości, a wartość nie może zawierać cudzysłowu z tego poziomu — inaczej
  // zewnętrzny klucz brał „{\" za wartość i zjadał otwarcie pierwszego klucza wewnętrznego.
  // (?<!\\) — start na początku ciągu backslashy (jeden start na ciąg, czas liniowy).
  ctx.text = ctx.text.replace(
    /(?<!\\)((\\{0,7})"([A-Za-z_][\w.-]{0,40})\2"\s*:\s*\2")((?:[^"\\\r\n]|\\[^"\r\n]){1,70})(\2")/g,
    (m, prefix: string, _esc: string, key: string, value: string, close: string) => {
      const kind = STRUCT_KEYS.get(normStructKey(key));
      if (!kind) return m;
      const mask = structMask(kind, value);
      return mask === null ? m : `${prefix}${mask}${close}`;
    },
  );
}

// 1d) LOGIN — kotwica „login/username/nazwa użytkownika" + wartość-token, także w NASTĘPNEJ
// linii. Złapaną wartość maskujemy też w pozostałych wystąpieniach w dokumencie oraz w
// wariancie w cudzysłowie po „użytkownik/login/konto".
function passLogin(ctx: RedactCtx): void {
  if (!ctx.on('LOGIN')) return;
  const loginValues = new Set<string>();
  // Wartość do propagacji: cały token („FIRMA\jkowalski") i sama nazwa użytkownika — nigdy sama
  // domena (to nazwa firmy, która pada w prozie). Konta generyczne („admin", „system", „test")
  // maskujemy w polu, ale nie rozlewamy na dokument — tam to zwykłe słowa („panel admin").
  const remember = (val: string): void => {
    const user = loginUserPart(val);
    for (const v of user === val ? [val] : [val, user]) {
      if (v.length >= 4 && !GENERIC_LOGINS.has(v.toLowerCase())) loginValues.add(v);
    }
  };
  ctx.text = ctx.text.replace(
    /((?:\b[Ll]ogin\w{0,3}|\b[Uu]ser(?:name)?|\b[Nn]azwa\s+użytkownika|\b[Ii]dentyfikator\s+użytkownika)(?:\s+(?:użytkownika|administratora|operatora|serwisow\w+|techniczn\w+|w\s+systemie|systemow\w+|domenow\w+|sieciow\w+))?[ \t]*[:=][ \t]*\n?[ \t]*)(["„'«]?)((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{1,62}[A-Za-z0-9])(?!\.?[\p{L}\p{N}_-]|\\)(["”'»]?)/gu,
    (m, kw: string, q1: string, val: string, q2: string, offset: number) => {
      if (q1 && !q2) return m; // niedomknięty cudzysłów — to nie wartość pola
      // wartość nie może być kolejną etykietą („Login:\nHasło:") ani pustym oznaczeniem
      if (!q2 && ctx.text[offset + m.length] === ':') return m;
      // wartość w NASTĘPNEJ linii musi wypełniać ją w całości
      if (kw.includes('\n')) {
        const lineEnd = ctx.text.indexOf('\n', offset + kw.length);
        const rest = ctx.text.slice(offset + m.length, lineEnd === -1 ? ctx.text.length : lineEnd);
        if (!/^[\s.,;]*$/.test(rest)) return m;
      }
      const user = loginUserPart(val).toLowerCase();
      if (isEmptyFormValue(user) || FORM_LABEL_WORDS.has(user) || RE_BUILTIN_ACCOUNT.test(val)) return m;
      remember(val);
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
  for (const v of [...loginValues].sort((a, b) => b.length - a.length)) {
    ctx.text = ctx.text.replace(
      new RegExp(`(?<![\\w.-])${escapeRe(v)}(?!\\.?[\\w\\u00C0-\\u024F-])`, 'g'),
      maskConst(ctx, 'LOGIN'),
    );
  }
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
function passIban(ctx: RedactCtx): void {
  if (!ctx.on('IBAN')) return;
  ctx.text = ctx.text.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/g, (m, offset: number) => {
    const c = ibanCut(m);
    if (isValidIban(m.slice(0, c))) {
      ctx.bump('IBAN');
      const after = ctx.text.slice(offset + m.length, offset + m.length + 8);
      return ctx.M.IBAN + m.slice(ibanMaskEnd(m, c, after));
    }
    return m;
  });
}

// 3) NR KONTA (NRB) zakotwiczony słowem „konto/rachunek/IBAN" + 26 cyfr (z opcjonalnymi spacjami).
function passAccount(ctx: RedactCtx): void {
  if (!ctx.on('NR-KONTA')) return;
  maskAfterLabel(
    ctx,
    /\b(konto|konta|rachunek|rachunku|rachunek bankowy|nr konta|numer konta|iban)\b([\s:.-]*)((?:\d[ ]?){25}\d)(?![ ]?\d)/gi,
    'NR-KONTA',
  );
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
    /\b((?:konto|Konto|KONTO|konta|Konta|rachunek|Rachunek|RACHUNEK|rachunku|Rachunku|nr konta|Nr konta|numer konta|Numer konta|iban|Iban|IBAN)(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]+)(PL[ ]?\d{2}(?:[ ]?\d){24}(?:[ ]?\d){0,4}|[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30})(?![A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż])/g,
    (m, kw: string, sep: string, val: string, offset: number) => {
      ctx.bump('NR-KONTA');
      const after = ctx.text.slice(offset + m.length, offset + m.length + 8);
      return `${kw}${sep}${ctx.M['NR-KONTA']}${val.slice(ibanMaskEnd(val, ibanCut(val), after))}`;
    },
  );
  // (c) NRB BEZ etykiety — 26 cyfr z POPRAWNĄ sumą (walidacja po dodaniu „PL"). Prefiks „PL"/„PL "
  // trafia pod maskę razem z numerem („PL [NR-KONTA]" zostawiało jawny kraj obok maski).
  ctx.text = ctx.text.replace(/(?<!\d[ ]?)(?:\bPL[ ]?)?(?:\d[ ]?){25}\d(?![ ]?\d)/g, (m) => {
    if (isValidIban('PL' + m.replace(/^PL/, '').replace(/ /g, ''))) {
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
}

// 5) NIP — separator MYŚLNIK LUB SPACJA lub 10 cyfr ciągiem + suma kontrolna.
function passNip(ctx: RedactCtx): void {
  if (!ctx.on('NIP')) return;
  // Opcjonalny prefiks kraju „PL" maskujemy RAZEM z numerem — maskuj całość, nie fragment.
  ctx.text = ctx.text.replace(
    /(?<![\d])(?:PL[- ]?)?(?:\d{3}[- ]\d{3}[- ]\d{2}[- ]\d{2}|\d{3}[- ]\d{2}[- ]\d{2}[- ]\d{3}|\d{10})(?![\d])/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (isValidNip(m.replace(/^PL[- ]?/, ''))) {
        ctx.bump('NIP');
        return ctx.M.NIP;
      }
      return m;
    },
  );
  // (b) z SILNĄ etykietą „NIP" — maskuj 10 cyfr (dowolny separator) NAWET bez poprawnej sumy.
  maskAfterLabel(
    ctx,
    /\b(nip(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]+)((?:PL[- ]?)?(?:\d{3}[- ]\d{3}[- ]\d{2}[- ]\d{2}|\d{3}[- ]\d{2}[- ]\d{2}[- ]\d{3}|\d{10}))(?![\d])/gi,
    'NIP',
  );
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
}

// 6b) KARTA PŁATNICZA — TYLKO z kontekstem karty („karta/płatnicz/Visa/Mastercard/Maestro/Amex/
// Diners/Discover/JCB/card"): 13–19 cyfr (grupy po 4, sep. spacja/myślnik) + prefiks znanej sieci
// + suma Luhna. Kontekst jest WYMAGANY, bo sam Luhn+prefiks jest zbyt niejednoznaczny: IMEI
// (15 cyfr, MA sumę Luhna, prefiksy 35/37/4…), numery przesyłek/faktur, kody kreskowe (EAN) i
// identyfikatory transakcji też je spełniają. Bez etykiety karty NIE maskujemy (precyzja >
// nadmaskowanie — audyt adwersarialny wykrył 10 fałszywych trafień na wariancie bez kontekstu).
// Biegnie PRZED REGON, żeby kontekst karty wygrał dla 14-cyfrowego numeru (Diners) nad ślepą
// sumą REGON; numer 14-cyfr bez kontekstu karty zostaje dla REGON.
function passCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA')) return;
  ctx.text = ctx.text.replace(
    /\b((?:kart[a-ząćęłńóśźż]*|card|visa|mastercard|maestro|amex|american\s+express|diners(?:\s+club)?|discover|jcb|płatnicz[a-ząćęłńóśźż]*|kredytow[a-ząćęłńóśźż]*|debetow[a-ząćęłńóśźż]*)(?:[ \t]+(?:nr|numer|no)\.?)?)([\s:="'()<>|.-]+)((?:\d[ -]?){12,18}\d)(?![\d])/gi,
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
const PHONE_ENUM_MEMBER = String.raw`\s*(?:(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|kom\.?|tel\.?)\s+)?(?:\+?48[\s.-]{1,3})?(?:[\s\-().]{0,3}\d){9}`;
const PHONE_NOT_AMOUNT = String.raw`(?![ \t]*(?:,\d{2})?[ \t]*(?:zł|PLN|EUR|USD|gr\b))`;
const RE_PHONE_ANCHORED = new RegExp(
  String.raw`\b(te[li]\.?|telefon\w{0,4}|kom\.?|komórk[aiwy]|fax|faks|nr te[li]\.?|kontakt\w{0,4})((?:\s+(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|telefoniczn\w+|pod|numer\w*))*[\s:.=-]*)((?:\+?48[\s.-]{1,3})?(?:[\s\-().]{0,3}\d){9}(?:\s*${PHONE_ENUM_SEP_OLD}${PHONE_ENUM_MEMBER}${PHONE_NOT_AMOUNT}|\s*${PHONE_ENUM_SEP_NEW}${PHONE_ENUM_MEMBER}(?![ \t\-().]{0,3}\d)${PHONE_NOT_AMOUNT})*)(?![.:]?\d)`,
  'gi',
);
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
const isPersonalJoinPart = (s: string): boolean => /^\p{Lu}\p{Ll}+$/u.test(s) || RE_PHONE_JOIN_WORD.test(s);
/**
 * Czy 9 cyfr to wnętrze identyfikatora („RR123456789PL", „FV/2026/123456789", „ZAM-123456789",
 * „SKU 123456789A", „DE811569869")? Wtedy maska rozrywała token i zostawiała jawne kawałki.
 * Sprawdzamy w callbacku, nie w lookbehindzie: lookbehind o zmiennej długości jest kwadratowy.
 * Mała litera przed numerem NIE blokuje („Kowalski512345678", „dzwoń512345678" z ekstrakcji
 * PDF to telefon), a „/" i „-" blokują tylko jako łącznik tokenu identyfikatora (niżej) —
 * „500600700/501601701" i lista „-500600700" to dalej telefony.
 */
function gluedToIdentifier(full: string, offset: number, len: number): boolean {
  const before = full.slice(Math.max(0, offset - 32), offset);
  if (/\p{Lu}$/u.test(before)) return true;
  // „_" po literze lub cyfrze to łącznik identyfikatora („ZAM_123456789"), a ciąg podkreślników
  // po etykiecie — linia do wypełnienia w formularzu („Telefon: ____601 234 567" to telefon).
  if (/[\p{L}\d]_+$/u.test(before)) return true;
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
  ctx.text = ctx.text.replace(
    RE_PHONE_ANCHORED,
    (m, kw: string, sep: string, nums: string) => {
      const parts = nums.split(RE_PHONE_ENUM_SPLIT);
      const validPart = (p: string) => {
        const d = p.replace(/\D/g, '');
        return d.length === 9 || (d.length === 11 && d.startsWith('48'));
      };
      if (!parts.every(validPart)) return m;
      if (parts.some((p) => RE_PHONE_DATE_SHAPE.test(p))) return m;
      // maskuj każdy 9-cyfrowy człon w miejscu — separatory listy i wypełniacze zostają.
      // Człon po wypełniaczu („, kom. 601…") zaczyna się od „. " — kropka należy do skrótu,
      // nie do numeru, więc zostaje przed maską (dawniej wychodziło „kom[TELEFON]").
      // Wiodące odstępy wchodzą do segmentu PRZED prefiksem: inaczej segment członu „lub 48 602 333
      // 444" startował od spacji, prefiks „48" nie mógł zadziałać, okno 9 cyfr obejmowało „48 602
      // 333 4" i dwie ostatnie cyfry numeru zostawały jawne. Odstępy i tak wracają w `lead`.
      const out = nums.replace(/\s*(?:\+?48[\s.-]{1,3})?(?:[\s\-().]{0,3}\d){9}/g, (seg) => {
        ctx.bump('TELEFON');
        const lead = seg.match(/^[\s.]*/)?.[0] ?? '';
        return `${lead}${ctx.M.TELEFON}`;
      });
      return `${kw}${sep}${out}`;
    },
  );
  // (a) prefiks +48/0048 — maskujemy RAZEM z prefiksem.
  ctx.text = ctx.text.replace(
    /(?<![\d])(?:\+|00)[\s]?48(?:[\s\-().]{0,3}\d){9}(?!\.?\d)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      ctx.bump('TELEFON');
      return ctx.M.TELEFON;
    },
  );
  // (c) fallback bez kontekstu — klasyczne 3-3-3, 9 cyfr ciągiem lub kierunkowy w nawiasie.
  // ŚWIADOMIE bez grupowania 2-3-2-2 bez kontekstu: „Pozycja 32 774 91 55 w wykazie" to numer
  // pozycji, nie telefon — kontekstowy fallback dałby FP (zasada: nadmaskowanie gorsze niż wyciek).
  // Stacjonarny 2-3-2-2 łapie tryb kotwicowy (b) — tam wymagane jest słowo „tel./kontakt/pod numerem".
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
  // (a) Z KONTEKSTEM — maskujemy nawet BEZ poprawnej sumy kontrolnej.
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|dow\.|legitymacj\w*|dokument\w*\s+tożsamości|seria i numer|nr dowodu)(?:\s+(?:osobist\w+|służbow\w+|nr|numer|seria|i))*[\s:.=-]*)([A-Za-z]{3}[\s-]?\d{6})(?!\d)/gi,
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
  ctx.text = ctx.text.replace(
    /\b((?:paszport\w*|dokument\w*\s+podróży|nr\s+paszportu|numer\s+paszportu)(?:\s+(?:nr\.?|numer|seria|i))*)([\s:.=-]*)([A-Za-z]{2}[\s-]?\d{7})(?!\d)/gi,
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
const RE_PLATE_VEHICLE = new RegExp(
  String.raw`\b([Pp]ojazd\w*|[Ss]amoch[oó]d\w*|[Mm]otocykl\w*|[Mm]otorower\w*|[Cc]iągnik\w*|[Pp]rzyczep\w*|[Aa]uto|[Pp]arking\w*|[Zz]aparkowan\w*)(?![A-Za-z])((?:\s+(?:o|nr\.?|numerze|siodłow\w+|ciężarow\w+|osobow\w+|dostawcz\w+|specjaln\w+|wolnobieżn\w+))*(?:\s+(?:marki|typu)\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?=[\s:=.-]))?(?:\s+[a-ząćęłńóśźż]{1,15}){0,3}[\s:=.-]*)(${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4})\b(?![/-]\d)${PLATE_NOT_UNIT}`,
  'g',
);
const PLATE_ITEM = `${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\\s-]?\\d[A-Z0-9]{3,4}`;
// Skan ogona wyliczenia startuje tylko na początku tokenu — nie w środku odrzuconego skrótu.
const RE_PLATE_ITEM_SCAN = new RegExp(`(?<![A-Z])${PLATE_ITEM}`, 'g');
const RE_PLATE_ACRONYM_HEAD = new RegExp(`^${PLATE_NOT_ACRONYM}`);
function passPlate(ctx: RedactCtx): void {
  if (!ctx.on('NR-REJESTRACYJNY')) return;
  // Wypełniacze po kotwicy ograniczone do {0,3}: przy „*" ciąg „rejestracyjny rejestracyjny …"
  // był od każdego słowa pochłaniany do końca (czas kwadratowy, ~7 s na 100 tys. znaków).
  ctx.text = ctx.text.replace(
    /\b((?:nr\s+rej\w*|numer\s+rej\w*|rejestracyjn\w*|tablic\w*)(?:\s+(?:nr\.?|numer|pojazdu|rej\w*)){0,3}[\s:=.-]*)((?=[A-Z0-9\s-]{0,5}\d)[A-Z]{2,3}[\s-]?[A-Z0-9]{4,5})\b/gi,
    (m, pre: string, plate: string) => {
      // Flaga /i jest potrzebna kotwicy („NR REJ.", „Tablica"), ale obejmuje też wyróżnik: słowo
      // prozy („od 2025", „dla 2000 pojazdów", „to 1500 zł") stawało się tablicą — to jednak
      // zdarza się tylko po słabych kotwicach „tablic…" i „rejestracyjn…". Tam wyróżnik małymi
      // literami przyjmujemy tylko w zapisie sklejonym („tablica wa12345"); po „nr rej." /
      // „numer rejestracyjny" stoi wartość pola, więc „nr rej. wa 12345" to tablica. „nr"/„NR"
      // nigdy nie jest wyróżnikiem („Tablica nr 12345 wisi przy wejściu").
      const strong = /^(?:nr|numer)\s+rej(?:estracyjn\p{L}*)?(?!\p{L})/iu.test(pre);
      if (/^nr\b/i.test(plate) || (!strong && !/^[A-Z]{2,3}(?![a-z])/.test(plate) && /[\s-]/.test(plate))) return m;
      // Sama „tablica" bez „rej…" bywa też ostrzegawcza czy informacyjna („Na tablicy UN 1203")
      // — tam skrót techniczny nie jest wyróżnikiem. Przy „nr rej." kotwica wygrywa.
      if (!/rej/i.test(pre) && !RE_PLATE_ACRONYM_HEAD.test(plate)) return m;
      ctx.bump('NR-REJESTRACYJNY');
      return `${pre}${ctx.M['NR-REJESTRACYJNY']}`;
    },
  );
  ctx.text = ctx.text.replace(RE_PLATE_VEHICLE, (m, kw: string, sep: string, plate: string) => {
    if (!PLATE_VOIV_LETTERS.includes(plate[0])) return m;
    ctx.bump('NR-REJESTRACYJNY');
    return `${kw}${sep}${ctx.M['NR-REJESTRACYJNY']}`;
  });
  // WYLICZENIE po zamaskowanej tablicy — kolejne człony listy dziedziczą kotwicę pierwszego.
  // Człon z jednostką („, DMC 18000 kg") albo skrótem technicznym kończy wyliczenie, tak samo
  // numer aktu z ukośnikiem („, UE 2016/679" — rozporządzenie, nie tablica; maska zostawiała „/679").
  {
    const REJ = escapeRe(ctx.M['NR-REJESTRACYJNY']);
    ctx.text = ctx.text.replace(
      new RegExp(`(${REJ})((?:(?:\\s*,\\s*|\\s+oraz\\s+|\\s+i\\s+)${PLATE_ITEM}(?![\\w-]|/\\d)${PLATE_NOT_UNIT})+)`, 'g'),
      (_m, first: string, tail: string) => {
        const maskedTail = tail.replace(RE_PLATE_ITEM_SCAN, (p) => {
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
function passBirthDate(ctx: RedactCtx): void {
  if (!ctx.on('DATA-UR')) return;
  maskAfterLabel(
    ctx,
    /\b(ur\.|urodzony|urodzona|urodzeni[ae]|data urodzenia)((?:\s+dnia)?[\s:.,-]*)(\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:[IVX]{1,4}|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4})/gi,
    'DATA-UR',
  );
}

// Miesiąc w dopełniaczu tuż za numerem („11 listopada", „11 Listopada", „12 MAJA 2024") — numer to
// dzień daty. „Maja" z wielkiej litery to też imię („ul. Lipowa 12⇥Maja Kowalska", „ul. Polna 5 Maja
// Wróbel"): miesiącem jest wtedy, gdy nie stoi za nim wyraz z wielkiej litery („3 Maja o godz. 12",
// „12 Maja 2024 r.").
const RE_MONTH_GEN_AHEAD =
  /^[ \t]+(?:stycznia|lutego|marca|kwietnia|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?!\p{L})/iu;
const RE_MAY_AHEAD = /^[ \t]+(?:maja(?!\p{L})|(?:Maja|MAJA)(?!\p{L})(?![ \t]+\p{Lu}))/u;
// Silna etykieta adresu przed „ul. …" — po niej niejednoznaczny numer zostaje numerem domu. Też
// „zamieszkały przy ul. …".
const RE_STRONG_ADDR_LABEL = /(?:adres\p{L}*|zam\.|zamieszka\p{L}*|zameldowan\p{L}*)[ \t]*:?(?:[ \t]+(?:przy|na|w))?[ \t]*$/iu;
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

// 12) ADRES — ul./al./os./pl. + nazwa + numer (opcjonalnie /mieszkanie). Wysoka precyzja.
function passAddress(ctx: RedactCtx): void {
  if (!ctx.on('ADRES')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      // każda litera skrótu case-insensitive — łapie też WERSALIKI ze skanów/OCR („UL. KWIATOWA 5",
      // „AL. JANA PAWŁA II 12"). Bez tego adres OSOBY zapisany WERSALIKAMI wyciekał (case-sensitive „ul.").
      `\\b([Uu][lLI1]\\.|[Uu][Ll][Ii][Cc][AaIiYy]|[Aa][Ll]\\.|[Aa][Ll][Ee][IiJj][AaIiĘę]?|[Oo][Ss]\\.|[Oo][Ss][Ii][Ee][Dd][Ll][EeAaUu]|[Pp][Ll]\\.|[Pp][Ll][Aa][Cc][UuAa]?|` +
        // typy ulic bez skrótu (nazwa własna + numer): „Rondo Dmowskiego 3", „skwer Kościuszki 5".
        // BEZ „park" — częsta nazwa instytucji („Park Narodowy … 2024") dawała FP.
        `[Rr]ond[${PL_LO}]*|[Mm]ost[${PL_LO}]*|[Ss]kwer[${PL_LO}]*|[Bb]ulwar[${PL_LO}]*)\\s+` +
        // tytuły patrona jak w RE_STREET_EPONYM_TAIL („ul. dra Jana Kowalskiego 12/3", „ul. prof. dr. hab.
        // Jana Nowaka 3", „ul. bł. Karoliny Kózkówny 3") — bez nich adres z takim patronem był cały jawny
        `(?:(?:\\d+|gen|płk|ppłk|mjr|kpt|por|ks|św|bł|bp|abp|kard|marsz|prof|doc|dra|dr|hab|med|lek|n|inż|hr)\\.?\\s+|[A-ZĄĆĘŁŃÓŚŹŻ]\\.\\s+){0,4}` +
        // „r."/„roku" jako człon nazwy: ulice z datą w nazwie („ul. Bitwy Warszawskiej 1920 r. 18",
        // „ul. Ofiar Grudnia 1970 r. 5") — numer domu stoi dopiero po nich
        `[${PL_UP}][${PL_LO}${PL_UP}01.-]*(?:[ \\t]+(?:[${PL_UP}0-9][${PL_LO}${PL_UP}0-9.-]*|r\\.|roku)){0,3}` +
        // blok na osiedlu przed numerem („os. Tysiąclecia bl. 4 m. 3") — bez niego cały adres wyciekał
        `(?:[ \\t]+(?:bl\\.|blok))?` +
        `[ \\t]+\\d+[A-Za-z]?(?:\\s*(?:/|m\\.?|lok\\.?)\\s*\\d+[A-Za-z]?)?`,
      'g',
    ),
    (m: string, prefix: string, offset: number, str: string) => {
      // nowe typy obiektów (rondo/most/skwer/bulwar) + GOŁA 4-cyfrowa liczba 1900–2099 to ROK obiektu
      // („Most Grunwaldzki 1910", „Bulwar Filadelfijski 1998"), NIE numer domu — pomiń. Numer domu z
      // literą/mieszkaniem („Bulwar Nadmorski 10", „Rondo X 12/5") kończy się inaczej → maskowany.
      // Tak samo rok z „r." w środku („Most Grunwaldzki 1910 r. 5 osób przeszło").
      if (/^(?:rond|most|skwer|bulwar)/i.test(prefix) && /[^0-9](?:19|20)\d{2}(?:[ \t]+(?:r\.|roku)[ \t]+\d+)?$/.test(m)) return m;
      // „Smith et al. Nature 2019" — skrót „et al." w cytowaniu, nie aleja
      if (/^al\./i.test(prefix) && /(?<!\p{L})et[ \t]+$/iu.test(str.slice(Math.max(0, offset - 4), offset))) return m;
      // Goły numer to w istocie DATA: dzień przed miesiącem („z placu Piłsudskiego 11 listopada")
      // albo rok przed „r."/„rok"/zakresem lat („przy ul. Okopowej 1944 r."). Strażnik w callbacku,
      // nie w lookaheadzie — cofanie skróciłoby numer i zostawiło fragment („[ADRES]1 listopada").
      // Po silnej etykiecie adresu („Adres:", „zam.") dzień przed miesiącem dalej jest numerem domu.
      const rest = str.slice(offset + m.length, offset + m.length + 24);
      // Gdy przed dniem/rokiem stoi jeszcze numer domu, maskujemy adres bez daty — dawniej
      // strażnik oddawał całe dopasowanie i jawny zostawał cały adres.
      const beforeDate = (): string => {
        const cut = RE_HOUSE_NO_BEFORE_DATE.exec(m);
        if (!cut) return m;
        ctx.bump('ADRES');
        return `${ctx.M.ADRES}${cut[2]}`;
      };
      if (/[ \t](?:[1-9]|[12]\d|3[01])$/.test(m) && (RE_MONTH_GEN_AHEAD.test(rest) || RE_MAY_AHEAD.test(rest))) {
        if (RE_HOUSE_NO_BEFORE_DATE.test(m)) return beforeDate();
        const before = str.slice(Math.max(0, offset - 60), offset);
        if (!RE_STRONG_ADDR_LABEL.test(before.slice(-30)) && !labeledPersonBeforeAddr(before)) return m;
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
    },
  );
  // 12b) ADRES bez prefiksu „ul." — rozpoznawany po SĄSIEDZTWIE (już zamaskowanego) kodu pocztowego.
  // Człony nazwy łączy tylko odstęp poziomy: przez nową linię nazwisko z wiersza podpisu
  // („Monika Sadowska\nSzosa Chełmińska 77/9") stawało się początkiem nazwy ulicy.
  const KOD = escapeRe(ctx.M['KOD-POCZTOWY']);
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([${PL_UP}][${PL_LO}]+(?:[ \\t]+[${PL_UP}][${PL_LO}]+){0,2})` +
        `\\s+\\d+[A-Za-z]?(?:\\s*(?:m\\.?|lok\\.?|/)\\s*\\d+[A-Za-z]?)?` +
        `(\\s*,?\\s*)(${KOD})`,
      'g',
    ),
    (_m, _street: string, sep: string, kod: string) => {
      ctx.bump('ADRES');
      return `${ctx.M.ADRES}${sep}${kod}`;
    },
  );
}

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
const RE_COLLECTIVE_BEFORE_MARKER =
  /(?<!\p{L})(?:osób|osoby|osobom|osobami|dzieci|dzieciom|rodzin|rodziny|rodzinom|mieszkańców|mieszkańcy|mieszkańcom|obywateli|obywatele|uczniów|uczniowie|uczniom|pacjentów|pacjenci|studentów|studenci|studentom|wszystkich|wszystkim|seniorów|seniorzy|emerytów|emeryci|ludzi|ludności|cudzoziemców|cudzoziemcy|podatników|beneficjentów)[ \t]+$/iu;
// Koniec nazwy miasta w 12f/12g. Także koniec wiersza: regex jest bez flagi „m", więc samo „$"
// oznaczało koniec CAŁEGO tekstu i „zam. w Krakowie⏎PESEL …" zostawiało miasto jawne.
const CITY_END = '(?=[ \\t\\r\\n.,;:?!)]|$)';
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
    const prev = lo.length >= 3 ? lo[lo.length - 3] : (/(\p{L}+)[ \t]+$/u.exec(before)?.[1] ?? '').toLowerCase();
    return POLISH_FIRST_NAMES.has(prev) || isPan(prev);
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

// Wyraz po nazwie miejscowości, który nie jest jej członem (państwo, etykieta kontaktu, jednostka).
const RE_NOT_CITY_TAIL = /^(?:Polska|Poland|Tel|Telefon|Fax|Faks|Kom|Mail|NIP|REGON|KRS|PESEL|Woj|Gmina|Powiat|Poczta)$/i;
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
  ctx.text = ctx.text.replace(
    new RegExp(`(${KOD}|(?<![\\d-])\\d{2}-\\d{3})([ \\t]+)(${CAP_CITY})((?:[ \\t]+${CAP_CITY}){0,2})`, 'g'),
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
      // Nowe i Biała to też miasta).
      const part0 = restParts[0] ?? '';
      if (take === 0 && part0 && CITY_PREFIX_ADJ.has(first.toLowerCase()) && /^ +\S/.test(part0)) {
        const end = offset + anchor.length + sep.length + first.length + part0.length;
        if (!RE_NOT_CITY_TAIL.test(part0.trim()) && ctx.text.charAt(end) !== '.') take = 1;
      }
      ctx.bump('MIEJSCOWOSC');
      return `${anchor}${sep}${ctx.M.MIEJSCOWOSC}${restParts.slice(take).join('')}`;
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
      if (cityRunLooksLikePerson(capRun, str.slice(Math.max(0, offset - 80), offset))) return m;
      const r = cityBySuffix(ctx, capRun);
      return r ? `${r.prefix}${ctx.M.MIEJSCOWOSC}${sep}${anchor}` : m;
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
  // 12e) MIEJSCOWOŚĆ tuż PO zamaskowanym adresie bez kodu: „[ADRES], Warszawa".
  ctx.text = ctx.text.replace(
    new RegExp(`(${ADR})([ \\t]*,[ \\t]*|[ \\t]+[Ww]e?[ \\t]+|[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*)((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})`, 'g'),
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
      if (RE_RESIDENCE_GENERAL.test(marker)) return m;
      if (RE_RESIDENCE_PARTICIPLE.test(marker) && RE_COLLECTIVE_BEFORE_MARKER.test(str.slice(Math.max(0, offset - 30), offset))) return m;
      // Po czasowniku bez „w"/dwukropka imię zaczyna podmiot, nie nazwę miasta („zamieszkuje
      // Jarosław Wilk z konkubiną", „Lokal zamieszkują Jarosław i Anna Kowalscy") — inaczej osoba
      // dostawała [MIEJSCOWOŚĆ], a jej nazwisko zostawało jawne.
      if (
        !/^[Zz]am\./.test(marker) &&
        !/(?::|(?<!\p{L})[Ww]e?)[ \t]*$/u.test(marker) &&
        POLISH_FIRST_NAMES.has(run.split(/[ \t]+/)[0].toLowerCase())
      )
        return m;
      const r = cityByPrefix(ctx, run);
      return r ? `${marker}${ctx.M.MIEJSCOWOSC}${r.leftover}` : m;
    },
  );
  // 12g) MIEJSCOWOŚĆ po markerze URODZENIA, z datą pomiędzy: „ur. [DATA-URODZENIA] w Krakowie".
  const DUR = escapeRe(ctx.M['DATA-UR']);
  ctx.text = ctx.text.replace(
    new RegExp(
      // Jedno łamanie wiersza po dacie, ale tylko przed MAŁYM „w/we" (OCR, blok strony: „ur. [DATA]
      // r.⏎w Sosnowcu"); „r.⏎W Sosnowcu odbyła się rozprawa" to już nowe zdanie.
      `\\b((?:[Uu]r\\.|[Uu]rodzon[a-ząę]+)[ \\t]+(?:dnia[ \\t]+)?` +
        `(?:${DUR}[ \\t]*r?\\.?,?(?:[ \\t]*\\r?\\n[ \\t]*(?=we?[ \\t])|[ \\t]*))?[Ww]e?[ \\t]+)` +
        `((?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY})${CITY_END}`,
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

// 13a0–a4) Pary/ciągi imię+nazwisko (mianownik, odmiana, WERSALIKI, małe litery, małżonkowie).
function passPersonPairs(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  // (a0) „Imię i Imię Nazwisko" — małżonkowie/rodzeństwo o WSPÓLNYM nazwisku („Anna i Jan Kowalscy").
  ctx.text = ctx.text.replace(RE_SPOUSES, (m, a: string, mid: string, b: string, c: string) => {
    if (!isFirstNameLike(a) || !isFirstNameLike(b)) return m;
    if (LEGAL_ENTITY_WORDS.has(c.toLowerCase())) return m;
    ctx.bump('IMIE');
    // wspólne nazwisko = ten sam klucz osoby; spójnik i odstępy zostają takie jak w tekście
    // (dawniej stałe „ i " zamieniało „oraz" i zwijało wyrównanie spacjami)
    return `${ctx.personMask(c)}${mid}${ctx.personMask(c)}`;
  });
  // (a) IMIĘ/IMIONA + NAZWISKO — jedno lub dwa imiona (mianownik LUB odmiana) + nazwisko.
  ctx.text = ctx.text.replace(RE_NAME_SEQ, (m, offset: number) => {
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
      if (start === 0) return m;
      const at = offset + parts.slice(0, 2 * start).join('').length;
      if (precededByPatron(ctx.text, at) || precededByStreetEponym(ctx.text, at)) return m;
    }
    // wyraz uliczny wciągnięty do dopasowania („Rondo Romana Dmowskiego") → patron, nie osoba
    if (start > 0 && RE_STREET_WORD.test(words[start - 1])) return m;
    let k = start;
    while (k < words.length && isFirstNameLike(words[k]) && !LEGAL_ENTITY_WORDS.has(words[k].toLowerCase())) k++;
    if (k >= words.length) return m; // same imiona, brak nazwiska po nich → zostaw
    const surname = words[k];
    if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
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
    return parts.slice(0, 2 * start).join('') + ctx.personMask(surname) + parts.slice(2 * k + 1).join('');
  });
  // (a2) para „Wyraz Nazwisko(morfologiczne)" — sufiks -ski/-cki/-icz/-czyk spoza słownika.
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    if (!looksLikeSurname(w2)) return m;
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
    if (RE_SURNAME_OBLIQUE.test(w2.toLowerCase())) {
      // przymiotnik ODMIEJSCOWY po roli/rzeczowniku („Starosty Wołomińskiego", „Wojewody
      // Mazowieckiego") to nazwa urzędu, NIE nazwisko — ta gałąź (inaczej niż sąsiednie) tego
      // nie sprawdzała, więc -ski/-cki odmiejscowe leciały jako osoba.
      if (isGeoAdjective(w2)) return m;
      // eponim po rzeczowniku-głowie z wielkiej litery („Odruch Babińskiego", „Objaw Brudzińskiego")
      // — jak zapis małą literą w przebiegach samodzielnych. TYLKO w tej gałęzi: w mianownikowej
      // „Objaw Kowalska", „Skala Wiśniewski" to osoba (eponim jest zawsze w dopełniaczu). Tylko
      // głowy eponimów: „Reakcja Kowalskiego", „Prawo Wiśniewskiego", „Zespół Zielińskiego" to osoba.
      if (EPONYM_HEADS.has(w1l) || w1l === 'moście') return m;
      ctx.bump('IMIE'); // dzierżawczy dopełniacz → rzeczownik/imię w w1 zostaje
      return `${kept}${ctx.personMask(w2)}`;
    }
    // mianownik:
    if (LEGAL_ENTITY_WORDS.has(w1l)) return m; // „Nowa Ruda", „Izba …" — raczej nazwa własna
    if (PROPER_NAME_HEADS.has(w1l)) return m; // „Kościół Mariacki", „Puszcza Białowieska"
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l)) {
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`; // „Prezes Gzowski" → rola zostaje
    }
    if (NON_NAME_LEADERS.has(w1l) || RE_VERB_1ST_PERSON.test(w1l)) {
      // „Odwiedziliśmy Biebrzański Park Narodowy" — przymiotnik przed nazwą instytucji to jej człon
      const next = RE_NEXT_CAP_WORD.exec(t.slice(offset + m.length, offset + m.length + 60))?.[1];
      if (next && LEGAL_ENTITY_WORDS.has(next.toLowerCase()) && !NOUN_NAME_LEADERS.has(w1l)) return m;
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`; // „Wczoraj Kowalski", „Sąsiad Kowalski" → wyraz zostaje
    }
    ctx.bump('IMIE');
    return ctx.personMask(w2); // rzadkie imię + nazwisko (mianownik) → oba
  });
  // (a3) ODWRÓCONA kolejność „Nazwisko Imię" — częsta w nagłówkach e-maili.
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number) => {
    if (!isFirstNameLike(w2)) return m;
    const w1l = w1.toLowerCase();
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2.toLowerCase())) return m;
    const lineStart = ctx.text.lastIndexOf('\n', offset - 1) + 1;
    const headerCtx = /^\s*(to|do|od|from|cc|dw|odbiorca|nadawca|adresat|wysłano|sent)\s*:/i.test(
      ctx.text.slice(lineStart, offset),
    );
    if (!headerCtx && !surnameBase(w1) && !looksLikeSurname(w1)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1); // klucz tożsamości = nazwisko (pierwsze słowo)
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
      `\\b(${CAP_WORD})[ \\t\\n]+z[ \\t\\n]+` +
        `(?:domu[ \\t\\n]+([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)` +
        `|([${PL_UP}][${PL_LO}]+(?:skich|ckich|dzkich|ich|ych|ów)))` +
        `(?![${PL_UP}${PL_LO}])`,
      'g',
    ),
    (m, first: string, domuSurname: string | undefined, genplSurname: string | undefined) => {
      if (!isFirstNameLike(first)) return m;
      const surname = domuSurname ?? genplSurname ?? '';
      if (!surname || LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
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
    `(${CAP_WORD})(?![${PL_UP}${PL_LO}])`,
  'g',
);
/**
 * (b0) „Pan/Pani" + rola + dopełniacz urzędu + nazwisko („Szanowna Pani Dyrektor Szkoły Gzowska",
 * „Pan Komendant Policji Lisiecki", „Pani Minister Zdrowia Kowalska"). Przed parami: para (a2)
 * zjadała „Zdrowia Kowalska" jako imię i nazwisko, a kandydat wyzwalacza (najwyżej dwa wyrazy)
 * kończył się na urzędzie i nazwisko za nim zostawało jawne. Rola i urząd zostają w tekście.
 */
function passPersonRoleComplement(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_PAN_ROLE_COMPLEMENT_SURNAME, (m, kw: string, role: string, mid: string, sur: string) => {
    const rl = role.toLowerCase();
    if (!ROLE_WORDS.has(rl) && !TITLE_WORDS.has(rl)) return m;
    const sl = sur.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(sl) || ROLE_COMPLEMENT_GEN.has(sl) || ROLE_WORDS.has(sl) || isGeoAdjective(sl)) return m;
    if (!surnameBase(sl) && !looksLikeSurname(sl) && !HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(sl))) return m;
    ctx.bump('IMIE');
    return `${kw}${role}${mid}${ctx.personMask(sur)}`;
  });
}

// (b) wyzwalacze kontekstu — łapią nazwiska spoza listy imion („Pan Habdank-Wojewódzki").
function passPersonTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const nameTrigger = new RegExp(
    `\\b([Nn]azywam się|[Mm]am na imię|[Ii]mię i nazwisko|[Ii]mie i nazwisko|[Nn]azwisko:|` +
      `[Pp]anowie|[Pp]anami|[Pp]anom|[Pp]anów|[Pp]anem|[Pp]ana|[Pp]anią|[Pp]aniom|[Pp]anu|[Pp]ani|[Pp]an)` +
      `([ \\t:]+)([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?(?:[ \\t]+[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)?)(?![${PL_UP}${PL_LO}])`,
    'g',
  );
  ctx.text = ctx.text.replace(nameTrigger, (m, kw: string, sep: string, name: string) => {
    const parts = name.split(/([ \t]+)/); // parzyste = wyrazy, nieparzyste = oryginalne odstępy
    const words = parts.filter((_, i) => i % 2 === 0);
    // odetnij wiodące role/tytuły po wyzwalaczu — „Pan Dyrektor Kowalski" → zachowaj „Dyrektor".
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    const surname = words[words.length - 1];
    const sl = surname.toLowerCase();
    // „Pan Wojewoda Mazowiecki", „Pani Sąd" — przymiotnik geo/encja to nie nazwisko; po pominiętej
    // roli także złożenie „Pan Wojewoda Kujawsko-Pomorski" (gołe „Pan X-sko-Y" dalej maskujemy)
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase()) || NON_SURNAME_ADJ.has(sl)) return m;
    if (s > 0 && isCompoundAdjective(sl)) return m;
    // dopełniacz urzędu albo imię sakralne w kandydacie („Pani Minister Zdrowia", „do Pana Boga")
    if (words.slice(s).some((w) => ROLE_COMPLEMENT_GEN.has(w.toLowerCase()))) return m;
    ctx.bump('IMIE');
    // zachowana rola wraz z odstępem za nią („Pan Dyrektor\tKowalski" — tabulator zostaje)
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(surname)}`;
  });
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
    if (!surnameBase(m)) return m;
    // „choroba Kowalskiego", „ulica Kwiatkowska", „im. Mickiewicza" — kontekst nie-osobowy
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m; // „Powiat: …", „Gmina: …"
    if (afterNonPersonContext(ctx.text, offset, m)) return m;
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
  return !!surnameBase(w2) || looksLikeSurname(w2) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w2));
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
      `${INITIAL_START}(?=[${PL_UP}]\\.[ \\t])(?<!(?:^|\\n|\\\\[\\uE00A\\uE00D])[ \\t]*)(?<!(?<!\\b(?:[Mm]ec|[Pp]rof|[Dd]r|[Mm]gr|[Ii]nż|hab|[Aa]dw|[Kk]s|płk|gen|kpt|mjr|por|sierż|lek|med|[Ss]ędz|[Ss]z))[.!?][ \\t]+)[${PL_UP}]\\.[ \\t]+([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)(?![${PL_UP}${PL_LO}])`,
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
    new RegExp(`${DOT_CHAIN}([ \\t]+)([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)(?![${PL_UP}${PL_LO}])`, 'g'),
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

// (c1b) OBCE imię DWUCZŁONOWE z myślnikiem + nazwisko („Jean-Pierre Dubois").
function passPersonForeign(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([${PL_UP}][${PL_LO}]{1,6}-[${PL_UP}][${PL_LO}]{1,6})[ \\t]+` +
        `((?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]i|Da|[Bb]in|[Tt]er|El|Al)[ \\t]+)?` +
        `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?)(?![${PL_LO}${PL_UP}])`,
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
  const next = /^[ \t]+(\p{Ll}+)/u.exec(t.slice(offset + m.length, offset + m.length + 30))?.[1];
  return !next || !/(?:ł|ła|ło|li|ły)$/.test(next);
}

// (c2) SAMODZIELNE nazwisko rozpoznane MORFOLOGICZNIE (sufiks -ski/-cki/-icz/-czyk).
function passPersonSoloMorph(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_MORPH, (m, offset: number, t: string) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    // rzeczownik pospolity na -czyk („Kluczyk do skrzynki", „Chińczyk i Japończyk") — tylko bez
    // inicjału przed nim: „J. Kluczyk" na początku wiersza łapie wyłącznie ten przebieg
    if (
      COMMON_NOUN_LOOKALIKES.has(m.toLowerCase()) &&
      !/[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]+$/.test(t.slice(Math.max(0, offset - 4), offset)) &&
      lookalikeIsCommonNoun(ctx, t, offset, m)
    )
      return m;
    // „Słowiński Park Narodowy" — człon nazwy parku, nie nazwisko
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    const first = m.split('-')[0];
    // morfologia LUB słownik (słownik łapie formę z myślnikiem: „Nowak-Schmidt")
    if (!looksLikeSurname(m) && !looksLikeSurname(first) && !surnameBase(m) && !surnameBase(first)) return m;
    // drugi człon złożenia z wielkiej litery (np. „… Warszawski") → to przymiotnik nazwy.
    if (PRECEDED_BY_CAP.test(ctx.text.slice(Math.max(0, offset - 40), offset))) return m;
    // eponim/ulica po wyrazie z małej litery oraz patron instytucji
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m;
    if (afterNonPersonContext(ctx.text, offset, m)) return m;
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
      if (!confirmedSurname(ll)) return m; // nazwisko MUSI być potwierdzone (chroni nagłówki instytucji)
      ctx.bump('IMIE');
      return `${title}${sep}${ctx.personMask(last)}`;
    },
  );
}

// (c3) OCR/WERSALIKI: „J0AN K0WALSKI", „JAN KOWALSKI" — para tokenów WERSALIKAMI z homoglifami.
function passPersonOcrPair(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCRW = `[${PL_UP}][${PL_UP}01]{1,19}`;
  ctx.text = ctx.text.replace(
    new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])(${OCRW})([ \\t]+)(${OCRW})(?![${PL_UP}${PL_LO}0-9-])`, 'g'),
    (m, t1: string, sep: string, t2: string, offset: number) => {
      const homo1 = /[01]/.test(t1);
      const homo2 = /[01]/.test(t2);
      const allCaps = t1 === t1.toUpperCase() && t2 === t2.toUpperCase();
      if (!homo1 && !homo2 && !allCaps) return m; // zwykłe pary obsłużyły (a)–(c2)
      const norm = (s: string) => s.replace(/0/g, 'o').replace(/1/g, 'l').toLowerCase();
      const n1 = norm(t1);
      const n2 = norm(t2);
      if (LEGAL_ENTITY_WORDS.has(n1) || ROLE_WORDS.has(n1) || TITLE_WORDS.has(n1)) return m;
      if (LEGAL_ENTITY_WORDS.has(n2) || NON_SURNAME_ADJ.has(n2)) return m;
      if (!surnameBase(n2) && !looksLikeSurname(n2)) return m;
      if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
      if (!isFirstNameLike(n1) && !homo1) {
        // pierwszy token to nie imię — maskuj SAMO nazwisko, o ile zawiera homoglif
        if (!homo2) return m;
        ctx.bump('IMIE');
        return `${t1}${sep}${ctx.personMask(n2)}`;
      }
      ctx.bump('IMIE');
      return ctx.personMask(n2);
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

function finalizePersons(ctx: RedactCtx): void {
  // DOMKNIĘCIE: imię słownikowe tuż przed zamaskowaną osobą (spacja/_/-/JEDNA nowa linia) → do maski.
  // Nowa linia obejmuje „Jan\nWiśniewski" (imię na końcu wiersza, potwierdzone nazwisko w następnym) —
  // gate `isFirstNameLike` chroni („protokół\n[OSOBA]" zostaje). Dwa przebiegi: wciągnięcie jednego
  // imienia może odsłonić kolejne.
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(
      // separator: spacja/⇥/_/-/JEDNA nowa linia albo dosłowna ucieczka „\t" (JSON) — jak prawdziwy ⇥
      new RegExp(`(?<![${PL_UP}${PL_LO}])([${PL_UP}][${PL_LO}]+)([ \\t\\n_-]|\\\\\\uE009)(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
      (m, w: string, sep: string, mask: string, offset: number, t: string) => {
        if (!isFirstNameLike(w)) return m;
        // Imię DOMYKA wpis listy („Sowa Przemysław\nPawlak Wiesław") — nie należy do osoby
        // z następnego wiersza; wciągnięcie sklejało wiersze i przesuwało pola CSV.
        // Sam wpis maskuje passListEntries niżej.
        if (sep === '\n' && listEntryHead(t, offset, offset + m.length)) return m;
        // Wiersz „Przymiotnik Imię" („Wielka Nadzieja", „Olimpijska Nadzieja") to nazwa, nie osoba
        // przełamana w pół — wciągnięcie imienia sklejało go z maską z następnego wiersza.
        if (sep === '\n') {
          const adj = RE_ADJ_LINE_HEAD.exec(t.slice(t.lastIndexOf('\n', offset - 1) + 1, offset))?.[1];
          if (adj && isGeoAdjective(adj)) return m;
        }
        return mask;
      },
    );
  }
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

  const ctx: RedactCtx = { text: input, raw: input, on, bump, M, personMask, maskedSurnames, protectedUrls: [], jsonEscapes: false };

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
  passLogin(ctx);
  // PRZED passZnakSprawy (kształt numeru KSeF pasuje do wzorca znaku sprawy — dostawał wtedy
  // maskę [ZNAK-SPRAWY]) i PRZED passNip (inaczej znika sam NIP, reszta numeru zostaje jawna).
  passKsef(ctx);
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
  passPostalNoHyphen(ctx);
  passCity(ctx);

  // ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
  passPersonRoleComplement(ctx);
  passPersonPairs(ctx);
  passPersonTrigger(ctx);
  passPersonStrongTrigger(ctx);
  passPersonSoloDict(ctx);
  passPersonInitial(ctx);
  passPersonForeign(ctx);
  passPersonSoloMorph(ctx);
  passPersonOcrTitle(ctx);
  passPersonOcrPair(ctx);
  passPersonOcrMix(ctx);

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
