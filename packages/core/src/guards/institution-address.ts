// Adres siedziby instytucji: ulica z numerem (i kod pocztowy pod nią) w nagłówku urzędu, sądu czy
// działu pracodawcy albo tuż za nazwą instytucji w nawiasie. To dane podmiotu, nie osoby, więc
// zostają jawne. Kotwica jest wąska, bo wyciek adresu osoby jest gorszy niż nadmiarowa maska.
import { isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { MULTIWORD_CITIES, POLISH_CITIES } from '../dict/places.js';
import { HOMOGRAPH_SURNAMES, homographBase, looksLikeSurname, surnameBase } from '../surnames.js';
import { MASK } from '../types.js';

// Pierwszy człon nazwy instytucji publicznej albo jednostki organizacyjnej (mianownik, jak
// w nagłówku pisma). Bez „Biuro”, „Firma”, „Usługi” czy „Kancelaria”: tak zaczynają się nazwy
// jednoosobowych firm z nazwiskiem właściciela. Bez „Gmina” i „Dzielnica”: to zwykły człon adresu
// osoby („Gmina Kobylnica⏎ul. Polna 3”), a urząd i tak zaczyna się od „Urząd Gminy”.
// Człony mocne nazywają tylko jednostki publiczne albo działy większej organizacji.
const STRONG_HEADS = new Set<string>(
  (
    'urząd wydział dział departament ministerstwo sąd prokuratura komenda komisariat spółdzielnia ' +
    'szpital uniwersytet politechnika starostwo kuratorium inspektorat izba oddział referat delegatura ' +
    'zarząd rada archiwum'
  ).split(' '),
);
// Człony słabe tak samo zaczynają nazwę firmy jednoosobowej („Szkoła Jazdy KOWALSKI”, „Przychodnia
// Weterynaryjna Wilk”, „Żłobek Domowy Ewy”), więc same nie robią z adresu siedziby. Potrzebny jest
// znacznik placówki publicznej (RE_PUBLIC_MARKER).
const WEAK_HEADS = new Set<string>(
  'szkoła ośrodek przychodnia instytut akademia żłobek przedszkole poradnia gabinet studio'.split(' '),
);
// Znacznik placówki publicznej przy słabym członie: numer, patron, miejscowość po „w”, przymiotnik
// organu prowadzącego, SP ZOZ, uczelnia, ośrodek pomocy społecznej. „Niepubliczne”
// się nie liczy (przed znacznikiem nie może stać litera). Bez względu na wielkość liter: nagłówek
// bywa pisany wersalikami („SZKOŁA PODSTAWOWA NR 5”) albo z „Nr”.
const PUBLIC_ADJ = String.raw`(?:Publiczn|Miejsk|Gminn|Powiatow|Wojewódzk|Samodzieln|Państwow|Narodow|Badawcz)\p{L}*`;
const RE_PUBLIC_ADJ_WORD = new RegExp(`^${PUBLIC_ADJ}$`, 'u');
const RE_PUBLIC_MARKER = new RegExp(
  String.raw`(?<![\p{L}.])(?:nr[ \t]*(?:\d|[IVXL]+(?!\p{L}))|im\.|imienia(?!\p{L})|we?[ \t]+\p{Lu}|pw\.|` +
    `${PUBLIC_ADJ}|` +
    String.raw`SP[ \t]*ZOZ|Uniwersytet\p{L}*|Politechni\p{L}*|Pomocy[ \t]+Społecznej|[MG]?OPS(?!\p{L})|MOPR(?!\p{L})|PCPR(?!\p{L}))`,
  'iu',
);
// Zwrot do adresata albo podpis nad blokiem: wtedy pod spodem stoi adres osoby.
const RE_SALUTATION_LINE = /^(?:Pan|Pani|Państwo|PAN|PANI|Sz\.[ \t]*(?:P\.|Pan\p{L}*|Państwo)|Szanown\p{L}*)(?:[ \t]|$)/u;
// Etykiety zamieszkania i adresu do doręczeń przed adresem odbierają mu charakter siedziby.
// „Mieszkaniowa” i „Mieszkańców” z nazw spółdzielni i wydziałów to nie etykiety, a znacznik
// „[ADRES]” z pierwszego przebiegu też nie (inaczej drugi przebieg dałby inny wynik).
const RE_RESIDENCE_LABEL =
  /(?<![\p{L}[])(?:zam\.|zamieszk\p{L}*|zameldowan\p{L}*|mieszka(?:ł[aoy]?|li|ją|jąc[aey]?|m|sz|my|cie)?(?!\p{L})|adres\p{L}*)/iu;

// Wyrazy pisane małą literą, które mieszczą się w nazwie instytucji („Sąd Rejonowy w Łodzi”,
// „Wydział ds. Cudzoziemców”, „Szkoła Podstawowa nr 5 im. Jana Pawła II”). Każdy inny wyraz
// z małej litery (czasownik, rzeczownik pospolity) oznacza zdanie, a nie samą nazwę.
const NAME_LOWER_WORDS = new Set<string>(
  'w we i dla nr z ze na do przy ds. d/s oraz im. imienia pod o od po u sp. o.o. spółka m.st.'.split(' '),
);
// Wyrazy, od których zaczyna się dopowiedzenie za właściwą nazwą: miejscowość, patron, numer,
// zakres („Sąd Rejonowy w Lublinie”, „Szkoła Podstawowa nr 5 im. …”, „Wydział ds. Cudzoziemców”).
// Ogon właściciela szukany jest przed nimi („Szkoła Jazdy Lis w Lublinie”).
const NAME_TAIL_STOPS = new Set<string>('w we dla nr im. imienia przy ds. d/s pod na z ze o od po sp. spółka'.split(' '));
// Skróty urzędów i uczelni wersalikami, które nie są nazwiskiem właściciela („Oddział ZUS”).
const OFFICE_ACRONYMS = new Set<string>(
  (
    'zus krus nfz mops gops ops mopr pcpr pup wup zoz spzoz psp kas gus ipn uke ure uodo rp pkp pzu kgp kwp kmp ' +
    'kpp psse pip wios gios gddkia zdw zdp zgm zgn mpk mpwik tbs zbk us um ug osp nbp knf pan agh sggw ' +
    'umk uam uw uj uwm ue awf asp'
  ).split(' '),
);
// Pospolite dopełniacze liczby mnogiej zakończone spółgłoską („Dział Kadr i Płac”, „Zarząd Dróg”):
// koniec nazwy rodzajowej, nie nazwisko w mianowniku.
const GENITIVE_PLURAL_TAILS = new Set<string>(
  'kadr płac dróg nauk spraw usług szkół ulic gmin miast osób ksiąg opłat służb kas rent emerytur'.split(' '),
);
// Wyraz po „Miasta”, „Gminy”, „Powiatu” czy „Dzielnicy” to nazwa miejsca („Urząd Miasta Łodzi”).
const PLACE_GOVERNORS = new Set<string>('miasta gminy powiatu województwa dzielnicy sołectwa'.split(' '));
const COMPASS = new Set<string>('północ południe wschód zachód centrum śródmieście miejscowość'.split(' '));
const RE_ROMAN = /^[IVXLC]+$/u;
const RE_ALL_CAPS_WORD = /^\p{Lu}[\p{Lu}-]+$/u;
const RE_MIXED_ACRONYM = /^\p{Lu}{2,}\p{Ll}{1,2}\p{Lu}+$/u;

/** Czy wyraz (małymi literami, bez interpunkcji) wygląda na nazwisko właściciela, a nie na człon
 *  nazwy rodzajowej? Nazwisko ze słownika albo homograf („lis”, „wilk”, „sowa”), forma rodziny
 *  („ptakowie”), imię w dopełniaczu („ewy”) albo nieznany rzeczownik zakończony spółgłoską, który
 *  nie jest miejscowością ani dopełniaczem liczby mnogiej. Sama końcówka nazwiska (-ski, -cka)
 *  liczy się tylko przy słabym członie: przy mocnym to przymiotnik nazwy („Szpital Bielański”). */
function ownerWord(w: string, strong: boolean): boolean {
  if (w.length < 2) return false;
  if (POLISH_CITIES.has(w) || COMPASS.has(w) || MULTIWORD_CITIES.has(w)) return false;
  if (w.includes('-')) {
    const parts = w.split('-');
    // Przy mocnym członie „Miasto-Dzielnica” to nazwa jednostki terenowej („Urząd Skarbowy
    // Warszawa-Targówek”, „Sąd Rejonowy Poznań-Grunwald”), nie nazwisko dwuczłonowe.
    if (strong && POLISH_CITIES.has(parts[0])) return false;
    return parts.some((p) => p.length >= 2 && ownerWord(p, strong));
  }
  if (surnameBase(w) || HOMOGRAPH_SURNAMES.has(w) || homographBase(w) || (!strong && looksLikeSurname(w))) return true;
  if (w.endsWith('owie') || isFirstNameGenitive(w) || (w.length >= 3 && isFirstNameLike(w))) return true;
  if (/[aeiouyąęó]$/u.test(w) || /(?:ów|ń|ej|ych|ich|ym|im|ego)$/u.test(w) || GENITIVE_PLURAL_TAILS.has(w)) return false;
  return true;
}

/** Czy za nazwą instytucji stoi ogon wskazujący właściciela: wyraz wersalikami („Szkoła Jazdy
 *  KOWALSKI”, „Ośrodek Szkolenia Kierowców KOS”), nazwisko albo rzeczownik spoza nazw rodzajowych
 *  („Szkoła Jazdy Lis”, „Przychodnia Rodzinna Ptakowie”), imię w dopełniaczu („Żłobek Domowy Ewy”)
 *  albo „u Ani”? Ogon szukany przed dopowiedzeniem miejscowości, patrona czy numeru i przed nazwą
 *  własną w cudzysłowie („Spółdzielnia Mieszkaniowa „Przyszłość””). */
function ownerTail(ws: string[], strong: boolean): boolean {
  const raw = ws.filter((w) => w.length > 0);
  const words = raw.map((w) => w.replace(/^[„"«(]+|[”"»),.;]+$/gu, ''));
  const lower = words.map((w) => w.toLowerCase());
  for (let i = 0; i + 1 < raw.length; i++) {
    if (lower[i] === 'u' && /^\p{Lu}/u.test(words[i + 1])) return true;
  }
  // Nazwa w całości wersalikami: wyrazy czytane jak pisane zwykle („SZKOŁA JAZDY KOWALSKI”).
  const letters = words.filter((w) => /\p{L}/u.test(w));
  const allCaps = letters.length >= 2 && letters.every((w) => !/\p{Ll}/u.test(w));
  let end = 1;
  while (end < raw.length && !NAME_TAIL_STOPS.has(lower[end]) && !/^[„"«]/u.test(raw[end])) end++;
  if (end < 2) return false;
  const tail = words[end - 1];
  if (!/^\p{Lu}/u.test(tail) || /\d/u.test(tail)) return false;
  if (PLACE_GOVERNORS.has(lower[end - 2])) return false;
  const bare = lower[end - 1];
  if (OFFICE_ACRONYMS.has(bare) || RE_ROMAN.test(tail)) return false;
  // Skrót pisany mieszanie („ARiMR”, „PGNiG”) to nazwa urzędu albo spółki, nie nazwisko.
  if (RE_MIXED_ACRONYM.test(tail)) return false;
  // Przy mocnym członie krótki wyraz wersalikami spoza słownika nazwisk to skrót („Oddział PKO”,
  // „Delegatura NIK”, „Oddział PFRON”): nazwisko wersalikami pod urzędem się nie zdarza.
  if (strong && !allCaps && RE_ALL_CAPS_WORD.test(tail) && tail.length <= 5 && !surnameBase(bare) && !HOMOGRAPH_SURNAMES.has(bare)) {
    return false;
  }
  if (!allCaps && RE_ALL_CAPS_WORD.test(tail)) return tail.length >= 3 && /[AEIOUYĄĘÓ]/u.test(tail);
  if (STRONG_HEADS.has(bare) || WEAK_HEADS.has(bare) || RE_PUBLIC_ADJ_WORD.test(tail)) return false;
  return ownerWord(bare, strong);
}

// Znacznik miejscowości z pierwszego przebiegu w nazwie („Starostwo Powiatowe [MIEJSCOWOŚĆ]”)
// czytany jak nazwa miejscowości, żeby drugi przebieg dał ten sam wynik.
const RE_CITY_MASK = /\[MIEJSCOWOŚĆ\]/gu;
// Maska osoby w trybie domyślnym i w pseudonimach („[OSOBA-A]”).
const RE_PERSON_MASK = new RegExp(`${MASK.IMIE.replace(/[[\]]/g, '\\$&')}|\\[OSOBA-[A-Z]+\\]`, 'u');

/** Sonda osób: redakcja kilku wierszy tym samym silnikiem (bez strażnika siedziby), żeby decyzja
 *  o adresie widziała osobę, którą przebiegi osób zamaskują dopiero po adresie („Przychodnia
 *  Lekarska Ewy Nowak”, „W. Nowak”, „Szkoła Jazdy Kowalski”). Wstrzykuje ją redact.ts. */
export type PersonProbe = (text: string) => string;

/** Czy sonda zamaskuje osobę w którymś z wierszy `checked` (od najbliższego adresu w górę)?
 *  Wiersz `context` nad nimi idzie do sondy tylko jako kontekst („Sz. Pan” nad nazwiskiem). */
function probeFindsPerson(probe: PersonProbe | undefined, checked: string[], context?: string): boolean {
  if (!probe || checked.length === 0) return false;
  const ordered = [...checked].reverse();
  if (context !== undefined) ordered.unshift(context);
  const out = probe(ordered.join('\n')).split('\n');
  return out.slice(context !== undefined ? 1 : 0).some((l) => RE_PERSON_MASK.test(l));
}

/** Czy w wierszu stoi imię w mianowniku (w dowolnym zapisie: „Jan Kowalski”, „Kowalski Jan”,
 *  „JAN KOWALSKI”)? Bez patrona po „im.” albo po liczbie („im. Jana Pawła II”, „3 Maja”). */
function hasFirstName(ws: string[]): boolean {
  return ws.some((w, i) => {
    const prev = (ws[i - 1] ?? '').toLowerCase();
    if (prev === 'im.' || prev === 'imienia' || /^\d/u.test(prev)) return false;
    return /^\p{Lu}/u.test(w) && POLISH_FIRST_NAMES.has(w.replace(/[,.;]+$/u, '').toLowerCase());
  });
}

/** Stopień nazwy instytucji: 0 to nie nazwa, 1 nazwa ze słabym członem bez znacznika placówki
 *  publicznej („Szkoła Jazdy”, „Przychodnia Specjalistyczna”), 2 nazwa urzędu, sądu, działu albo
 *  słaby człon ze znacznikiem („Szkoła Podstawowa nr 5”, „Przedszkole Miejskie”, „Przychodnia
 *  SP ZOZ w Kole”). Sam stopień 1 nie daje siedziby: tak samo zaczyna się firma jednoosobowa. */
type NameLevel = 0 | 1 | 2;

/** Czy fragment wiersza to sama nazwa instytucji („Urząd Miasta Łodzi”, „Wydział Finansowy”,
 *  „Powiatowy Urząd Pracy”), i jakiego stopnia? Człon z listy wśród trzech pierwszych wyrazów, bez
 *  etykiety, maski osoby, adresu e-mail, bez wyrazów z małej litery spoza spójników i przyimków
 *  nazwy („Szpital przyjął pacjenta…” to zdanie), bez imienia w mianowniku („Zakład Usług
 *  Remontowych Jan Kowalski”, „Przychodnia Lekarska Kowalski Jan” to firma osoby) i bez ogonu
 *  właściciela („Szkoła Jazdy KOWALSKI”, „Przychodnia Weterynaryjna Wilk”). */
export function institutionNameLevel(line: string): NameLevel {
  const s = line.trim().replace(RE_CITY_MASK, 'Miejscowość');
  if (s.length < 4 || s.length > 100 || !/^\p{Lu}/u.test(s)) return 0;
  // Łącznik wewnątrz wyrazu zostaje („Sąd Rejonowy dla Łodzi-Śródmieścia”), osobny myślnik nie.
  if (/[:@[\]]|(?<!\p{L})-|-(?!\p{L})/u.test(s) || RE_RESIDENCE_LABEL.test(s)) return 0;
  const ws = s.split(/[ \t]+/);
  const heads = ws
    .slice(0, 3)
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w.toLowerCase());
  const strong = heads.some((w) => STRONG_HEADS.has(w));
  if (!strong && !heads.some((w) => WEAK_HEADS.has(w))) return 0;
  if (ws.some((w) => /^\p{Ll}/u.test(w) && !NAME_LOWER_WORDS.has(w.toLowerCase()))) return 0;
  if (hasFirstName(ws) || ownerTail(ws, strong)) return 0;
  return strong || RE_PUBLIC_MARKER.test(s) ? 2 : 1;
}

// Wiersz z samym imieniem i nazwiskiem, także spoza słownika imion i z nazwiskiem z łącznikiem
// („Marianna Zięba-Kot”, „Ołeksandr Bondarenko”). Bez nazw miejsc i jednostek podziału
// („Dzielnica Mokotów”, „Stalowa Wola”, „Rzeczpospolita Polska”), bez organu nad jego urzędem
// („Prezydent Miasta”, „Wójt Gminy”, „Starosta Lubelski”) i bez nazw instytucji z przymiotnikiem
// („Poczta Polska”, „Straż Miejska”, „Wody Polskie”).
const RE_TWO_WORD_NAME = /^\p{Lu}\p{Ll}+[ \t]+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u;
const NOT_GIVEN_NAMES = new Set<string>(
  (
    'dzielnica gmina powiat miasto województwo osiedle sołectwo rzeczpospolita miejscowość ulica obręb ' +
    'prezydent burmistrz wójt starosta wojewoda marszałek komendant prezes dyrektor dyrektorka kierownik ' +
    'kierowniczka naczelnik sekretarz skarbnik przewodniczący przewodnicząca zastępca rzecznik sędzia ' +
    'prokurator kurator inspektor nadleśnictwo poczta straż wody lasy policja inspekcja kasa biuro ' +
    'kancelaria zakład fundusz agencja służba centrum zespół'
  ).split(' '),
);
// Drugi wyraz będący przymiotnikiem nazwy instytucji („Poczta Polska”, „Straż Graniczna”).
const RE_INSTITUTION_ADJ = new RegExp(
  String.raw`^(?:${PUBLIC_ADJ}|(?:Polsk|Skarbow|Pożarn|Graniczn|Generaln|Regionaln|Główn|Okręgow|Rejonow|Krajow)\p{L}*)$`,
  'u',
);
function twoWordNameLine(s: string): boolean {
  if (!RE_TWO_WORD_NAME.test(s)) return false;
  const [firstRaw, second] = s.split(/[ \t]+/);
  if (RE_INSTITUTION_ADJ.test(second)) return false;
  const first = firstRaw.toLowerCase();
  return !NOT_GIVEN_NAMES.has(first) && !STRONG_HEADS.has(first) && !WEAK_HEADS.has(first) && !MULTIWORD_CITIES.has(s.toLowerCase());
}
// Etykieta adresata w bloku („Dla:”, „Do:”, „Adresat:”): pod nią stoi osoba, której adres się zakrywa.
const RE_RECIPIENT_LABEL = /^[ \t]*(?:Dla|Do|Adresat\p{L}*|Odbiorc\p{L}*)[ \t]*:/iu;

/** Czy wiersz nad nazwą instytucji wskazuje, że pod spodem stoi adres osoby: zwrot do adresata,
 *  etykieta zamieszkania, adresu albo adresata, imię i nazwisko (jawne, już zamaskowane albo w samej
 *  postaci „Imię Nazwisko”)? */
function personLineAbove(line: string | undefined): boolean {
  const s = line?.trim();
  if (!s) return false;
  return (
    RE_SALUTATION_LINE.test(s) ||
    RE_RESIDENCE_LABEL.test(s) ||
    RE_PERSON_MASK.test(s) ||
    RE_RECIPIENT_LABEL.test(s) ||
    twoWordNameLine(s) ||
    hasFirstName(s.split(/[ \t]+/))
  );
}

// Wiersz zaczynający się od kodu pocztowego (jawnego albo już zamaskowanego): „00-950 Warszawa”.
const RE_POSTAL_LINE = new RegExp(String.raw`^[ \t]*(?:\d{2}-\d{3}|${MASK['KOD-POCZTOWY'].replace(/[[\]]/g, '\\$&')})(?![\d\p{L}])`, 'u');

// Wiersze tekstu tuż nad pozycją (od najbliższego), do pierwszej pustej linii.
function linesAbove(t: string, lineStart: number, max: number): string[] {
  const out: string[] = [];
  let end = lineStart - 1; // znak „\n” kończący wiersz wyżej
  while (out.length < max && end >= 0 && t[end] === '\n') {
    const start = t.lastIndexOf('\n', end - 1) + 1;
    const line = t.slice(start, end).replace(/\r$/, '');
    if (!line.trim()) break;
    out.push(line);
    end = start - 1;
  }
  return out;
}

/** Nagłówek instytucji nad wierszem adresu: wiersz tuż wyżej (i ewentualnie do trzech kolejnych
 *  ponad nim) to nazwa instytucji albo jej jednostki, nad tym blokiem nie stoi zwrot do osoby,
 *  etykieta zamieszkania ani imię i nazwisko, a w bloku etykieta adresata („Dla:”). Sonda osób
 *  sprawdza nazwy i wiersz nad nimi. Blok z samych nazw stopnia 1 („Przychodnia Specjalistyczna”)
 *  daje siedzibę tylko pod adresem poprzedniego bloku instytucji (lista placówek szpitala). */
function institutionHeaderAbove(t: string, lineStart: number, probe?: PersonProbe): boolean {
  const lines = linesAbove(t, lineStart, 12);
  let n = 0;
  let level = 0;
  while (n < lines.length && n < 4) {
    const l = institutionNameLevel(lines[n]);
    if (l === 0) break;
    level = Math.max(level, l);
    n++;
  }
  if (n === 0 || personLineAbove(lines[n]) || lines.some((l) => RE_RECIPIENT_LABEL.test(l))) return false;
  // Nad blokiem stoi sama ulica z numerem albo wiersz z kodem pocztowym: to koniec adresu poprzedniego
  // bloku („Dział Kadr⏎ul. Polna 1⏎Dział Płac⏎ul. Polna 2”), nie osoba. Sonda sprawdza wtedy same
  // nazwy, więc ten sam nagłówek trafia w pamięć sondy zamiast pełnej redakcji przy każdym numerze.
  const above = lines[n];
  const afterAddress = above !== undefined && (RE_STREET_LINE.test(above) || RE_POSTAL_LINE.test(above));
  if (level < 2 && !(afterAddress && previousBlockStrong(lines, n))) return false;
  if (afterAddress) return !probeFindsPerson(probe, lines.slice(0, n));
  return !probeFindsPerson(probe, lines.slice(0, n + 1), lines[n] === undefined ? undefined : lines[n + 1]);
}

/** Czy nad adresem poprzedniego bloku (wiersze od `n` w górę) stoi nazwa instytucji stopnia 2,
 *  a nad nią nie stoi osoba? */
function previousBlockStrong(lines: string[], n: number): boolean {
  let k = n;
  while (k < lines.length && k < n + 3 && (RE_STREET_LINE.test(lines[k]) || RE_POSTAL_LINE.test(lines[k]))) k++;
  for (let j = k; j < lines.length && j < k + 4; j++) {
    const l = institutionNameLevel(lines[j]);
    if (l === 0) return false;
    if (l === 2) return !personLineAbove(lines[j + 1]);
  }
  return false;
}

// Nazwa instytucji z przecinkiem tuż przed adresem, od początku nawiasu, wiersza albo zdania
// („(Spółdzielnia Mieszkaniowa „Przyszłość”, ul. Wspólna 1)”).
// Biegnie przez execTail (flaga g), więc początek wiersza to `(?<![^\n])`, a nie `^`: lookbehind
// widzi tekst przed oknem i trafia tylko w prawdziwy początek wiersza.
const RE_INLINE_INSTITUTION = /(?:(?<![^\n])|[\n(]|[.;][ \t])[ \t]*([^\n(),;]{4,100}),[ \t]*$/gu;
// Sala z numerem w budynku przy ulicy („sala 214, budynek przy ul. Królewskiej 27”): miejsce
// spotkania w gmachu instytucji, nie mieszkanie.
const RE_ROOM_IN_BUILDING = /(?<!\p{L})sal[aię][ \t]+(?:nr[ \t]*)?\d+[a-z]?[ \t]*,[ \t]*(?:w[ \t]+)?(?:budyn\p{L}*|gmach\p{L}*)[ \t]+przy[ \t]+$/giu;
// Okno przed adresem, w którym szukają wyrażenia tego wiersza. Nazwa ma najwyżej 100 znaków, ulica
// przed kodem około 80 (bez spacji), więc dalej nic nie sięga. Bez okna każde wywołanie przeszukiwało
// wiersz od początku, a dokument w jednym długim wierszu dawał czas kwadratowy (280 KB: 30 s).
const INLINE_WINDOW = 160;
/** Dopasowanie wyrażenia (flaga g) kończącego się na `to` (`$`), szukane od `from`. Lookbehind widzi
 *  prawdziwy tekst przed oknem, więc wynik jest taki sam jak na całym wierszu. */
function execTail(re: RegExp, t: string, from: number, to: number): RegExpExecArray | null {
  re.lastIndex = from;
  return re.exec(t.slice(0, to));
}
// Czy w tekście [from, to) stoi coś poza białymi znakami? Kończy na pierwszym takim znaku.
const RE_NON_SPACE = /\S/u;
const blankBetween = (t: string, from: number, to: number): boolean => !RE_NON_SPACE.test(t.slice(from, to));
/** Okno przed pozycją `offset`: INLINE_WINDOW znaków innych niż spacja i tabulator wstecz, najdalej
 *  do początku wiersza. Spacje się nie liczą, bo wyrażenia przyjmują ich dowolnie dużo („Urząd
 *  Miasta,⎵⎵⎵…ul. Długa 5”). Dokładny początek wiersza (`lineStart()`) liczony dopiero na żądanie:
 *  szukanie go wstecz przez cały długi wiersz przy każdym adresie też dawało czas kwadratowy. */
function windowBefore(t: string, offset: number): { from: number; lineStart: () => number } {
  const blank = (i: number): boolean => t[i] === ' ' || t[i] === '\t';
  let from = offset;
  let budget = INLINE_WINDOW;
  while (from > 0 && t[from - 1] !== '\n' && (budget > 0 || blank(from - 1))) {
    from--;
    if (!blank(from)) budget--;
  }
  let ls = from === 0 || t[from - 1] === '\n' ? from : -1;
  return {
    from,
    lineStart: () => {
      if (ls < 0) ls = t.lastIndexOf('\n', offset - 1) + 1;
      return ls;
    },
  };
}
// Numer lokalu za numerem domu („m. 3”, „lok. 9”, „lokal 4”, „mieszkania 14”); numer z ukośnikiem
// ocenia flatUnit.
const FLAT_UNIT_SRC = String.raw`(?:m|lok|lokal\p{L}*|mieszk\p{L}*|apt)\.?[ \t]*(?:nr\.?[ \t]*)?\d`;
const RE_FLAT_UNIT = new RegExp(String.raw`(?<!\p{L})${FLAT_UNIT_SRC}`, 'u');
// Lokal tuż po przecinku za numerem domu („ul. Polna 3, m. 14”).
const RE_FLAT_UNIT_AFTER_COMMA = new RegExp(String.raw`^[ \t]*${FLAT_UNIT_SRC}`, 'u');
const RE_SLASH_NUMBER = /(?<!\d)(\d+)[a-zA-Z]?[ \t]*\/[ \t]*(\d+)/u;
/** Numer z ukośnikiem to lokal („12/4”, „1/15”, „23/8”), chyba że to para numerów budynku po tej
 *  samej stronie ulicy („Rakowiecka 25/27”, „Nowe Ogrody 8/12”): drugi większy o 2, 4 albo 6. */
function flatUnit(street: string): boolean {
  if (RE_FLAT_UNIT.test(street)) return true;
  const m = RE_SLASH_NUMBER.exec(street);
  if (!m) return false;
  const d = Number(m[2]) - Number(m[1]);
  return !(d === 2 || d === 4 || d === 6);
}
/** Czy ulica zaczynająca się na pozycji `offset` to adres siedziby instytucji? Sonda osób (z redact.ts)
 *  sprawdza, czy w nazwie albo nad nią nie stoi osoba, którą zamaskują dopiero przebiegi osób. */
export function institutionStreetAt(t: string, offset: number, probe?: PersonProbe): boolean {
  const { from, lineStart } = windowBefore(t, offset);
  if (RE_RESIDENCE_LABEL.test(t.slice(Math.max(from, offset - 40), offset))) return false;
  // Numer mieszkania („m. 3”, „lok. 9”, „3/5”, także po przecinku: „3, m. 14”) wskazuje lokal
  // mieszkalny, nie siedzibę. Za przecinkiem liczy się tylko lokal tuż po nim, żeby sygnatura czy
  // data dalej w wierszu nie myliła.
  const after = t.slice(offset, offset + 80);
  const eol = after.indexOf('\n');
  const seg = eol < 0 ? after : after.slice(0, eol);
  const comma = seg.indexOf(',');
  if (flatUnit(comma < 0 ? seg : seg.slice(0, comma))) return false;
  if (comma >= 0 && RE_FLAT_UNIT_AFTER_COMMA.test(seg.slice(comma + 1))) return false;
  // Pusty początek wiersza liczony od prawdziwego początku wiersza, nie od okna.
  if (blankBetween(t, from, offset) && blankBetween(t, lineStart(), from)) return institutionHeaderAbove(t, lineStart(), probe);
  if (execTail(RE_ROOM_IN_BUILDING, t, from, offset)) return true;
  const m = execTail(RE_INLINE_INSTITUTION, t, from, offset);
  // Za przecinkiem siedzibę daje tylko nazwa stopnia 2 („Szkoła Jazdy Lis, ul. Lipowa 8” to firma).
  if (!m || institutionNameLevel(m[1]) < 2) return false;
  // Nazwa od początku wiersza: wiersz wyżej nie może wskazywać osoby („Jan Kowalski⏎Spółdzielnia…, ul.”)
  // ani blok nie może mieć etykiety adresata („Dla:⏎Wydział Komunikacji, ul. Lipowa 8”).
  const fromLineStart = blankBetween(t, from, m.index + m[0].indexOf(m[1])) && blankBetween(t, lineStart(), from);
  const above = fromLineStart ? linesAbove(t, lineStart(), 8) : [];
  if (personLineAbove(above[0]) || above.some((l) => RE_RECIPIENT_LABEL.test(l))) return false;
  return !probeFindsPerson(probe, above[0] === undefined ? [m[1]] : [m[1], above[0]], above[1]);
}

// Stopień, tytuł albo godność przed imieniem patrona ulicy („gen.”, „ks.”, „św.”). Bez „im.”: ulica
// „im. Henryka Sienkiewicza” zostaje przy dotychczasowych regułach adresu.
const STREET_TITLE = String.raw`(?:gen|ks|św|kard|marsz|prof|dr|bp|abp|płk|ppłk|kpt|por|mjr|bł|hetm|kmdr|adm|inż)\.`;
/** Ulica z numerem domu: skrót albo pełne słowo, nazwa (także z liczbą albo stopniem na początku:
 *  „3 Maja”, „gen. Władysława Andersa”, „św. Jana”) i numer, ewentualnie drugi po ukośniku. */
export const STREET_SRC = String.raw`(?<!\p{L})(?:[Uu]l\.|[Aa]l\.|[Pp]l\.|[Oo]s\.|(?:[Uu]lica|[Aa]lej[ae]|[Pp]lac|[Oo]siedle)(?!\p{L}))[ \t]*(?:\d+[ \t]+|${STREET_TITLE}[ \t]*)?\p{Lu}[^\n,:;()]{0,60}?[ \t]\d+[a-zA-Z]?(?:[ \t]*[/-][ \t]*\d+[a-zA-Z]?)?(?![\d\p{L}])`;
// Pokój, piętro czy wejście za numerem („ul. Piotrkowska 104, pok. 12”) to część siedziby.
const ROOM_TAIL = String.raw`(?:[ \t]*,[ \t]*(?:pok\.|pokój|p\.|piętro|wejście|budynek|bud\.)[^\n,]{0,30})?`;
const RE_STREET_LINE = new RegExp(String.raw`^[ \t]*(${STREET_SRC})${ROOM_TAIL}[ \t]*,?[ \t]*\r?$`, 'u');
const RE_STREET_BEFORE_POSTAL_INLINE = new RegExp(String.raw`(${STREET_SRC})[ \t]*,[ \t]*$`, 'gu');

/** Czy kod pocztowy na pozycji `offset` należy do adresu siedziby instytucji? Tylko razem z ulicą
 *  tej siedziby: w wierszu wyżej albo przed przecinkiem w tym samym wierszu. */
export function institutionPostalAt(t: string, offset: number, probe?: PersonProbe): boolean {
  const win = windowBefore(t, offset);
  if (blankBetween(t, win.from, offset) && blankBetween(t, win.lineStart(), win.from)) {
    const lineStart = win.lineStart();
    if (lineStart === 0) return false;
    const prevStart = t.lastIndexOf('\n', lineStart - 2) + 1;
    const m = RE_STREET_LINE.exec(t.slice(prevStart, lineStart - 1));
    return !!m && institutionStreetAt(t, prevStart + m.index + m[0].indexOf(m[1]), probe);
  }
  const m = execTail(RE_STREET_BEFORE_POSTAL_INLINE, t, win.from, offset);
  return !!m && institutionStreetAt(t, m.index + m[0].indexOf(m[1]), probe);
}
