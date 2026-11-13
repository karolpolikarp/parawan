// Adres siedziby instytucji: ulica z numerem (i kod pocztowy pod nią) w nagłówku urzędu, sądu czy
// działu pracodawcy albo tuż za nazwą instytucji w nawiasie. To dane podmiotu, nie osoby, więc
// zostają jawne. Kotwica jest wąska, bo wyciek adresu osoby jest gorszy niż nadmiarowa maska.
import { POLISH_FIRST_NAMES } from '../dict/names.js';
import { MASK } from '../types.js';

// Pierwszy człon nazwy instytucji publicznej albo jednostki organizacyjnej (mianownik, jak
// w nagłówku pisma). Bez „Biuro”, „Firma”, „Usługi” czy „Kancelaria”: tak zaczynają się nazwy
// jednoosobowych firm z nazwiskiem właściciela. Bez „Gmina” i „Dzielnica”: to zwykły człon adresu
// osoby („Gmina Kobylnica⏎ul. Polna 3”), a urząd i tak zaczyna się od „Urząd Gminy”.
const INSTITUTION_HEADS = new Set<string>(
  (
    'urząd wydział dział departament instytut ministerstwo sąd prokuratura komenda komisariat spółdzielnia ' +
    'szpital szkoła uniwersytet politechnika akademia starostwo kuratorium inspektorat ' +
    'izba ośrodek oddział referat delegatura zarząd rada archiwum przedszkole żłobek przychodnia'
  ).split(' '),
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

/** Czy fragment wiersza to sama nazwa instytucji („Urząd Miasta Łodzi”, „Wydział Finansowy”,
 *  „Powiatowy Urząd Pracy”)? Człon z listy wśród trzech pierwszych wyrazów, bez etykiety,
 *  maski osoby, adresu e-mail, bez wyrazów z małej litery spoza spójników i przyimków nazwy
 *  („Szpital przyjął pacjenta…” to zdanie) i bez imienia w mianowniku („Zakład Usług
 *  Remontowych Jan Kowalski”, „Przychodnia Lekarska Kowalski Jan” to firma osoby). */
export function institutionNameLine(line: string): boolean {
  const s = line.trim().replace(RE_CITY_MASK, 'Miejscowość');
  if (s.length < 4 || s.length > 100 || !/^\p{Lu}/u.test(s)) return false;
  // Łącznik wewnątrz wyrazu zostaje („Sąd Rejonowy dla Łodzi-Śródmieścia”), osobny myślnik nie.
  if (/[:@[\]]|(?<!\p{L})-|-(?!\p{L})/u.test(s) || RE_RESIDENCE_LABEL.test(s)) return false;
  const ws = s.split(/[ \t]+/);
  if (!ws.slice(0, 3).some((w) => /^\p{Lu}/u.test(w) && INSTITUTION_HEADS.has(w.toLowerCase()))) return false;
  if (ws.some((w) => /^\p{Ll}/u.test(w) && !NAME_LOWER_WORDS.has(w.toLowerCase()))) return false;
  return !hasFirstName(ws);
}

/** Czy wiersz nad nazwą instytucji wskazuje, że pod spodem stoi adres osoby: zwrot do adresata,
 *  etykieta zamieszkania albo adresu, imię i nazwisko (jawne albo już zamaskowane)? */
function personLineAbove(line: string | undefined): boolean {
  const s = line?.trim();
  if (!s) return false;
  return RE_SALUTATION_LINE.test(s) || RE_RESIDENCE_LABEL.test(s) || RE_PERSON_MASK.test(s) || hasFirstName(s.split(/[ \t]+/));
}

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
 *  ponad nim) to nazwa instytucji albo jej jednostki, a nad tym blokiem nie stoi zwrot do osoby,
 *  etykieta zamieszkania ani imię i nazwisko. Sonda osób sprawdza nazwy i wiersz nad nimi. */
function institutionHeaderAbove(t: string, lineStart: number, probe?: PersonProbe): boolean {
  const lines = linesAbove(t, lineStart, 6);
  let n = 0;
  while (n < lines.length && n < 4 && institutionNameLine(lines[n])) n++;
  if (n === 0 || personLineAbove(lines[n])) return false;
  return !probeFindsPerson(probe, lines.slice(0, n + 1), lines[n] === undefined ? undefined : lines[n + 1]);
}

// Nazwa instytucji z przecinkiem tuż przed adresem, od początku nawiasu, wiersza albo zdania
// („(Spółdzielnia Mieszkaniowa „Przyszłość”, ul. Wspólna 1)”).
const RE_INLINE_INSTITUTION = /(?:^|[\n(]|[.;][ \t])[ \t]*([^\n(),;]{4,100}),[ \t]*$/u;
// Sala z numerem w budynku przy ulicy („sala 214, budynek przy ul. Królewskiej 27”): miejsce
// spotkania w gmachu instytucji, nie mieszkanie.
const RE_ROOM_IN_BUILDING = /(?<!\p{L})sal[aię][ \t]+(?:nr[ \t]*)?\d+[a-z]?[ \t]*,[ \t]*(?:w[ \t]+)?(?:budyn\p{L}*|gmach\p{L}*)[ \t]+przy[ \t]+$/iu;
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
  const lineStart = t.lastIndexOf('\n', offset - 1) + 1;
  const inLine = t.slice(lineStart, offset);
  if (RE_RESIDENCE_LABEL.test(inLine.slice(-40))) return false;
  // Numer mieszkania („m. 3”, „lok. 9”, „3/5”, także po przecinku: „3, m. 14”) wskazuje lokal
  // mieszkalny, nie siedzibę. Za przecinkiem liczy się tylko lokal tuż po nim, żeby sygnatura czy
  // data dalej w wierszu nie myliła.
  const eol = t.indexOf('\n', offset);
  const seg = t.slice(offset, eol < 0 ? offset + 80 : Math.min(eol, offset + 80));
  const comma = seg.indexOf(',');
  if (flatUnit(comma < 0 ? seg : seg.slice(0, comma))) return false;
  if (comma >= 0 && RE_FLAT_UNIT_AFTER_COMMA.test(seg.slice(comma + 1))) return false;
  if (!inLine.trim()) return institutionHeaderAbove(t, lineStart, probe);
  if (RE_ROOM_IN_BUILDING.test(inLine)) return true;
  const m = RE_INLINE_INSTITUTION.exec(inLine);
  if (!m || !institutionNameLine(m[1])) return false;
  // Nazwa od początku wiersza: wiersz wyżej nie może wskazywać osoby („Jan Kowalski⏎Spółdzielnia…, ul.”).
  const fromLineStart = !inLine.slice(0, m.index + m[0].indexOf(m[1])).trim();
  const above = fromLineStart ? linesAbove(t, lineStart, 2) : [];
  if (personLineAbove(above[0])) return false;
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
const RE_STREET_BEFORE_POSTAL_INLINE = new RegExp(String.raw`(${STREET_SRC})[ \t]*,[ \t]*$`, 'u');

/** Czy kod pocztowy na pozycji `offset` należy do adresu siedziby instytucji? Tylko razem z ulicą
 *  tej siedziby: w wierszu wyżej albo przed przecinkiem w tym samym wierszu. */
export function institutionPostalAt(t: string, offset: number, probe?: PersonProbe): boolean {
  const lineStart = t.lastIndexOf('\n', offset - 1) + 1;
  const inLine = t.slice(lineStart, offset);
  if (!inLine.trim()) {
    if (lineStart === 0) return false;
    const prevStart = t.lastIndexOf('\n', lineStart - 2) + 1;
    const m = RE_STREET_LINE.exec(t.slice(prevStart, lineStart - 1));
    return !!m && institutionStreetAt(t, prevStart + m.index + m[0].indexOf(m[1]), probe);
  }
  const m = RE_STREET_BEFORE_POSTAL_INLINE.exec(inLine);
  return !!m && institutionStreetAt(t, lineStart + m.index + m[0].indexOf(m[1]), probe);
}
