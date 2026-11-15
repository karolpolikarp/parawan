// Kontakt i rachunek instytucji: telefon centrali albo sekretariatu, skrzynka funkcyjna urzędu
// i rachunek bankowy urzędu do wpłat. To dane podmiotu, które urzędnik przepisuje do odpowiedzi,
// więc zostają jawne. Kotwice są wąskie: numer albo adres, który może należeć do osoby (komórka,
// imienny e-mail, telefon tuż przy nazwisku, rachunek strony), dalej idzie pod maskę.
import { isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { foldAscii, isAsciiSurnameShaped, surnameBase } from '../surnames.js';
import { MASK } from '../types.js';
import { institutionNameLevel, institutionPostalAt, institutionStreetAt, type PersonProbe, STREET_SRC } from './institution-address.js';

// Strefy numeracji stacjonarnej (pierwsze dwie cyfry numeru krajowego). Zakresy komórkowe (45, 50,
// 51, 53, 57, 60, 66, 69, 72, 73, 78, 79, 88) się z nimi nie pokrywają, więc komórka nigdy nie
// zostaje jawna jako numer urzędu: komórką posługuje się zwykle osoba.
const LANDLINE_ZONES = new Set<string>(
  '12 13 14 15 16 17 18 22 23 24 25 29 32 33 34 41 42 43 44 46 48 52 54 55 56 58 59 61 62 63 65 67 68 71 74 75 76 77 81 82 83 84 85 86 87 89 91 94 95'.split(
    ' ',
  ),
);

/** Czy cyfry numeru to telefon stacjonarny albo infolinia 800/801 (z „+48”, „0048” lub zerem)? */
export function landlineDigits(digits: string): boolean {
  let d = digits;
  if (d.startsWith('0048')) d = d.slice(4);
  else if (d.length === 11 && d.startsWith('48')) d = d.slice(2);
  if (d.length === 10 && d[0] === '0') d = d.slice(1);
  if (d.length !== 9) return false;
  return LANDLINE_ZONES.has(d.slice(0, 2)) || /^80[01]/.test(d);
}

/** Początek wiersza z pozycją `offset`, szukany najwyżej `max` znaków wstecz; -1, gdy wiersz zaczyna
 *  się dalej. Pełne `lastIndexOf` przy każdym numerze w długim wierszu bez złamań dawało czas
 *  kwadratowy, a strażnik i tak patrzy tylko na krótkie odcinki przed kontaktem. */
function lineStartWithin(t: string, offset: number, max: number): number {
  const stop = Math.max(0, offset - max);
  for (let i = offset - 1; i >= stop; i--) if (t.charCodeAt(i) === 10) return i + 1;
  return stop === 0 ? 0 : -1;
}
/** Początek odcinka przed `offset`: początek wiersza albo, gdy wiersz jest dłuższy, `offset - max`. */
const windowStart = (t: string, offset: number, max: number): number => {
  const ls = lineStartWithin(t, offset, max);
  return ls < 0 ? offset - max : ls;
};
// Najdłuższy wiersz nagłówka, który strażnik czyta nad kontaktem (nazwa, adres, numery podmiotu).
const MAX_BLOCK_LINE = 300;

const RE_PERSON_MASK = new RegExp(`${MASK.IMIE.replace(/[[\]]/g, '\\$&')}|\\[OSOBA-[A-Z]+\\]`, 'u');
const probeHasPerson = (probe: PersonProbe | undefined, s: string): boolean => !!probe && RE_PERSON_MASK.test(probe(s));

// Etykiety kontaktu w nagłówku i stopce („tel.”, „tel./fax”, „e-mail:”, „centrala”, „wew. 21”).
const RE_CONTACT_LABEL = /(?<!\p{L})(?:tel(?:efon\p{L}*)?|fax|faks|e-?mail|mail|poczta|kontakt|www|centrala|sekretariat|infolinia|kom|nr|wew|wewn)(?!\p{L})\.?/giu;
const RE_CONTACT_EMAIL = /[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[A-Za-z]{2,}/gu;
const RE_ANY_MASK = /\[[A-ZĄĆĘŁŃÓŚŹŻ-]+\]|[-]/gu;
const RE_WWW = /(?:https?:\/\/)?www\.[\p{L}\d.-]+\.[a-z]{2,}\S*/giu;
/** Czy odcinek wiersza zawiera same etykiety i wartości kontaktu (numery, adresy, maski)? */
function contactOnly(s: string): boolean {
  if (s.length > 200) return false;
  const rest = s.replace(RE_WWW, '').replace(RE_CONTACT_EMAIL, '').replace(RE_ANY_MASK, '').replace(RE_CONTACT_LABEL, '');
  return !/\p{L}/u.test(rest);
}
// Wiersz numerów podmiotu w nagłówku między adresem a kontaktem („NIP 123…, REGON 456…”).
const RE_ID_LINE = /^[ \t]*(?:(?:NIP|REGON|KRS|BDO)[ \t]*:?[ \t]*(?:PL[ \t-]?)?(?:[\d \t-]{7,20}|\[[A-ZĄĆĘŁŃÓŚŹŻ-]+\])[ \t,;|]*)+$/iu;
const RE_STREET = new RegExp(STREET_SRC, 'gu');
const RE_POSTAL_START = /^[ \t]*\d{2}-\d{3}(?!\d)/u;
// Kod z miejscowością za ulicą w tym samym wierszu („ul. Szkolna 2, 21-136 Firlej, tel. …”).
const RE_POSTAL_LOCALITY_HEAD = /^[ \t]*,?[ \t]*(?:\d{2}-\d{3}[ \t]+\p{Lu}[\p{L}-]*(?:[ \t]+(?:nad|pod|\p{Lu}[\p{L}-]*)){0,3})?/u;

/** Czy wiersz `line` (od `start`) to adres siedziby instytucji: ulica albo kod pod ulicą, które
 *  strażnik siedziby uznał za adres instytucji, albo sama nazwa instytucji stopnia 2? Podpis osoby
 *  nad blokiem adresowym („Anna Nowak⏎inspektor⏎Urząd Gminy Firlej⏎ul. Szkolna 1⏎tel. …”) robi z
 *  numeru pod nim zwykle bezpośredni telefon tej osoby, chyba że stoi przy nim numer wewnętrzny. */
function institutionBlockLine(t: string, start: number, line: string, ext: boolean, probe?: PersonProbe): boolean {
  RE_STREET.lastIndex = 0;
  const street = RE_STREET.exec(line);
  if (street) return institutionStreetAt(t, start + street.index, probe) && (ext || noSignatureAbove(t, start, probe));
  const postal = RE_POSTAL_START.exec(line);
  if (postal) return institutionPostalAt(t, start + postal[0].search(/\d/), probe) && (ext || noSignatureAbove(t, start, probe));
  if (institutionNameLevel(line) !== 2 || probeHasPerson(probe, line)) return false;
  return ext || noSignatureAbove(t, start, probe);
}

/** Czy wiersz należy jeszcze do bloku adresowego instytucji: ulica, kod, nazwa, kontakt, NIP/REGON? */
function addressBlockLine(line: string): boolean {
  RE_STREET.lastIndex = 0;
  return RE_STREET.test(line) || RE_POSTAL_START.test(line) || contactOnly(line) || RE_ID_LINE.test(line) || institutionNameLevel(line) === 2;
}
/** Czy nad blokiem adresowym, do którego należy wiersz od `start`, nie stoi podpis osoby? Adres
 *  bywa w kilku wierszach (nazwa, ulica, kod), więc liczą się wiersze nad pierwszym z nich. */
function noSignatureAbove(t: string, start: number, probe?: PersonProbe): boolean {
  let top = start;
  for (let k = 0; k < 3 && top > 1; k++) {
    const s = lineStartWithin(t, top - 1, MAX_BLOCK_LINE);
    if (s < 0) break;
    const line = t.slice(s, top - 1).replace(/\r$/u, '');
    if (line.trim() === '' || !addressBlockLine(line)) break;
    top = s;
  }
  return personFree(probe, blockAbove(t, top, 3).join('\n'));
}

/** Czy w tekście nie ma osoby: pusty albo sonda nie zamaskuje w nim osoby (bez sondy: nie wiadomo). */
function personFree(probe: PersonProbe | undefined, s: string): boolean {
  return s.trim() === '' || (!!probe && !probeHasPerson(probe, s));
}
// Numer wewnętrzny za numerem („61 817 04 11 wew. 34”): to centrala urzędu, nie telefon osoby.
const RE_EXTENSION_AFTER = /^[ \t]*,?[ \t]*(?:wew|wewn)\.?[ \t]*\d/iu;
const extensionAfter = (t: string, end: number): boolean => RE_EXTENSION_AFTER.test(t.slice(end, end + 12));

/** Do `max` niepustych wierszy bloku nad wierszem zaczynającym się na `start` (do pustego wiersza). */
function blockAbove(t: string, start: number, max: number): string[] {
  const out: string[] = [];
  let end = start - 1;
  while (out.length < max && end > 0) {
    const s = lineStartWithin(t, end, MAX_BLOCK_LINE);
    if (s < 0) break;
    const line = t.slice(s, end);
    if (line.trim() === '') break;
    out.push(line);
    end = s - 1;
  }
  return out.reverse();
}

/** Czy kontakt na pozycji `offset` stoi w bloku adresowym instytucji: w wierszu kontaktu pod
 *  adresem albo nazwą siedziby (najwyżej trzy wiersze kontaktu i numerów podmiotu pomiędzy), albo
 *  za ulicą siedziby w tym samym wierszu. Adres osoby nie przechodzi przez strażnika siedziby, więc
 *  telefon pod nim zostaje zakryty. */
export function institutionBlockContactAt(t: string, offset: number, contactEnd: number, probe?: PersonProbe): boolean {
  const lineStart = lineStartWithin(t, offset, 201);
  if (lineStart < 0) return false;
  const prefix = t.slice(lineStart, offset);
  RE_STREET.lastIndex = 0;
  let street: RegExpExecArray | null = null;
  for (let m = RE_STREET.exec(prefix); m; m = RE_STREET.exec(prefix)) street = m;
  if (street) {
    const tail = prefix.slice(street.index + street[0].length);
    const head = RE_POSTAL_LOCALITY_HEAD.exec(tail)?.[0] ?? '';
    const rest = tail.slice(head.length);
    if (!/^[ \t]*[,;|–-]/u.test(tail) || !contactOnly(rest) || !institutionStreetAt(t, lineStart + street.index, probe)) return false;
    // Osoba w tym samym wierszu („Sprawdziła: Marta Ziobro, inspektor, Urząd Gminy Mielnik, ul. Piaskowa 1,
    // tel. …”): numer bez wewnętrznego to zwykle jej bezpośredni telefon.
    // Tak samo podpis nad tym wierszem („Zbigniew Pawlak⏎Kierownik Referatu⏎Urząd Miasta Kalisza,
    // ul. Główny Rynek 20, tel. …”).
    return extensionAfter(t, contactEnd) || (personFree(probe, prefix.slice(0, street.index)) && noSignatureAbove(t, lineStart, probe));
  }
  if (!contactOnly(prefix)) return false;
  let end = lineStart - 1;
  for (let k = 0; k < 4 && end > 0; k++) {
    const start = lineStartWithin(t, end, MAX_BLOCK_LINE);
    if (start < 0) return false;
    const line = t.slice(start, end).replace(/\r$/u, '');
    if (line.trim() === '') return false;
    if (contactOnly(line) || RE_ID_LINE.test(line)) {
      end = start - 1;
      continue;
    }
    return institutionBlockLine(t, start, line, extensionAfter(t, contactEnd), probe);
  }
  return false;
}

// Etykieta numeru urzędu tuż przed nim: centrala, sekretariat (z dopowiedzeniem małą literą:
// „sekretariat zakładu:”), infolinia, biuro albo punkt obsługi, „telefon do urzędu”. Między etykietą
// a numerem tylko „tel.” czy „nr”, więc „Sekretariat: Anna Nowak, tel. …” zostaje zakryte.
const OFFICE_GENITIVE = String.raw`(?:urzęd|szkoł|ośrod|sąd|sekretariat|central|placówk|przychodn|poradn|starostw|gmin|miast|powiat|biur|zakład|instytucj|organ)\p{L}*`;
// Dopowiedzenie etykiety małą literą („sekretariat zakładu:”, „biuro obsługi mieszkańców”). Bez „pod
// numerem”: „kontakt z sekretariatem pod numerem …” to prośba o kontakt w prozie, nie etykieta numeru.
const LABEL_GENITIVES = String.raw`(?:[ \t]+(?!pod(?!\p{L})|numer|nr(?!\p{L})|na(?!\p{L}))\p{Ll}+){0,2}`;
const RE_OFFICE_PHONE_LABEL = new RegExp(
  // Bez flagi „i”: dopowiedzenie ma być małą literą, więc „Sekretariat Anna Nowak: …” nie przejdzie.
  String.raw`(?<!\p{L})(?:[Cc]entral[ai]|CENTRAL[AI]|(?:[Ss]ekretariat|SEKRETARIAT)\p{L}*${LABEL_GENITIVES}|(?:[Ii]nfolini|INFOLINI)\p{L}*|(?:[Bb]iur|BIUR|[Pp]unkt|PUNKT)\p{L}*[ \t]+(?:[Oo]bsługi|OBSŁUGI|[Ii]nformacji|INFORMACJI|[Pp]odawcz|PODAWCZ)\p{L}*${LABEL_GENITIVES}|(?:[Tt]el(?:efon)?\.?|TEL(?:EFON)?\.?|[Nn]umer\p{L}*)[ \t]+(?:do[ \t]+)?${OFFICE_GENITIVE})[ \t]*[:.,–-]?[ \t]*(?:(?:[Tt]el(?:efon)?|TEL|[Nn]r|[Nn]umer)\.?[ \t:.-]*)?$`,
  'u',
);
const RE_LABEL_TAIL = /(?:[ \t]*[:.,–-]?[ \t]*(?:tel(?:efon)?|nr|numer|e-?mail|mail)\.?[ \t:.-]*)+$/iu;

/** Czy tuż przed kontaktem stoi w tym samym wierszu nazwa instytucji stopnia 2 („Referat
 *  Organizacyjny, tel. …”, „Wydział Komunikacji, e-mail: …”)? Gdy w wierszu stoi osoba („Umowę
 *  sporządziła: Sylwia Ratajczak, Referat Organizacyjny, tel. …”), numer liczy się jako centrala
 *  tylko z numerem wewnętrznym za nim; bez niego to zwykle bezpośredni telefon tej osoby. Telefon
 *  (`direct`) sprawdza też blok nad wierszem, jak podpis: „Anna Nowak⏎Inspektor⏎Wydział
 *  Komunikacji, tel. …” to numer tej osoby, tak samo jak z numerem w osobnym wierszu. */
function institutionSegmentBefore(t: string, offset: number, end: number, probe: PersonProbe | undefined, direct: boolean): boolean {
  const ls = lineStartWithin(t, offset, 161);
  const from = Math.max(0, ls, offset - 160);
  // Etykiety zdejmowane tylko z końcówki odcinka: wyrażenie z „$” próbowane od każdej pozycji
  // całego odcinka kosztowało przy każdym numerze.
  const raw = t.slice(from, offset);
  const tail = Math.max(0, raw.length - 48);
  const prefix = raw.slice(0, tail) + raw.slice(tail).replace(RE_LABEL_TAIL, '');
  const cut = Math.max(prefix.lastIndexOf(','), prefix.lastIndexOf(';'), prefix.lastIndexOf(':'), prefix.lastIndexOf('('), prefix.lastIndexOf('|'));
  // Bez separatora nazwa zaczyna wiersz („Wydział Komunikacji, tel. …”), chyba że okno ucięło wiersz.
  const cutLine = ls < 0 || from > ls;
  if (cut < 0 && cutLine) return false;
  const seg = prefix.slice(cut + 1).trim();
  if (institutionNameLevel(seg) !== 2) return false;
  if (extensionAfter(t, end)) return true;
  if (!personFree(probe, prefix)) return false;
  // Blok nad wierszem tylko przy znanym początku wiersza (w długim wierszu blok jest daleko).
  return !direct || cutLine || personFree(probe, blockAbove(t, ls, 3).join('\n'));
}

// Kolejny numer telefonu (dziewięć cyfr z pojedynczymi separatorami): od niego zaczyna się kontakt
// kogoś innego, tak samo jak zakryty już numer. Pokój, godziny czy numer wewnętrzny („pok. 12”, „7.30–15.30”) go nie kończą.
const RE_NEXT_PHONE = /\n|\[TELEFON[^\]\n]{0,8}\]|(?<!\d)\d(?:[ \t.-]?\d){8}(?!\d)/u;
/** Czy za numerem w tym samym wierszu, przed kolejnym numerem telefonu, stoi osoba („tel. 81 856 10 23
 *  (Anna Nowak)”, „81 856 10 24, pok. 12, Anna Nowak”, „– ANNA NOWAK, inspektor”)? To wtedy jej
 *  bezpośredni telefon. Bez sondy nie wiadomo, więc wystarcza wyraz z wielkiej litery za numerem. */
function personAfter(t: string, end: number, probe?: PersonProbe): boolean {
  let s = t.slice(end, end + 80);
  const stop = s.search(RE_NEXT_PHONE);
  if (stop >= 0) s = s.slice(0, stop);
  // Także same wersaliki („ANNA NOWAK”): o osobie rozstrzyga sonda.
  if (!/\p{Lu}\p{L}/u.test(s)) return false;
  return !probe || probeHasPerson(probe, s);
}

/** Czy telefon `digits` od pozycji `offset` do `end` to numer instytucji: stacjonarny albo infolinia,
 *  w bloku adresowym siedziby, za etykietą centrali czy sekretariatu albo za nazwą komórki urzędu.
 *  Numer z osobą za nim w tym samym wierszu i bez numeru wewnętrznego zostaje zakryty. */
export function institutionPhoneAt(t: string, offset: number, end: number, digits: string, probe?: PersonProbe): boolean {
  if (!landlineDigits(digits)) return false;
  // 800/801 to wyłącznie infolinie: nie ma ich strefy geograficznej ani zakresu komórkowego.
  if (/^80[01]/u.test(digits.slice(-9))) return true;
  if (!extensionAfter(t, end) && personAfter(t, end, probe)) return false;
  if (RE_OFFICE_PHONE_LABEL.test(t.slice(windowStart(t, offset, 70), offset))) return true;
  return institutionSegmentBefore(t, offset, end, probe, true) || institutionBlockContactAt(t, offset, end, probe);
}

const deburr = (s: string): string =>
  s.replace(/[ąćęłńóśźż]/gu, (c) => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]);
// Część lokalna skrzynki funkcyjnej urzędu, szkoły, sądu albo ośrodka (bez polskich znaków).
const OFFICE_LOCALS = new Set<string>(
  (
    'sekretariat urzad ug um umig uw gmina miasto starostwo powiat podatki finanse ksiegowosc kadry oswiata ' +
    'edukacja iod abi mops gops mgops ops pcpr mopr gopr usc ewidencja meldunki dowody komunikacja budownictwo ' +
    'architektura geodezja srodowisko rolnictwo inwestycje zamowienia przetargi skargi bip epuap szkola przedszkole ' +
    'zlobek poradnia biblioteka sm strazmiejska straz pinb nadzor wydzial cywilny karny rodzinny pracy gospodarczy ' +
    'penitencjarny kw ksiegiwieczyste dyrekcja servicedesk helpdesk rada oplaty odpady wodociagi zdrowie ' +
    'spoleczny swiadczenia dodatki stypendia rekrutacja'
  ).split(' '),
);
// Skrzynki ogólne: tak samo nazywa się skrzynka firmy jednoosobowej, więc tylko z domeną bez
// nazwiska (to institutionEmailAt sprawdza dla każdej skrzynki poza gov.pl).
const GENERIC_LOCALS = new Set<string>('biuro info informacja kontakt office poczta kancelaria administracja obsluga bok boi'.split(' '));

/** Czy część lokalna to skrzynka urzędu albo ogólna, a nie imię, nazwisko czy inicjał? Dopuszczony
 *  numer i krótki dopisek („sekretariat.sp2”, „cywilny1”). */
function functionalLocal(local: string): boolean {
  const parts = deburr(local.toLowerCase()).split(/[._-]/u);
  if (parts.length > 3) return false;
  const head = parts[0].replace(/\d{1,3}$/u, '');
  if (!OFFICE_LOCALS.has(head) && !GENERIC_LOCALS.has(head)) return false;
  return parts.slice(1).every((p) => /^\d+$/u.test(p) || OFFICE_LOCALS.has(p) || GENERIC_LOCALS.has(p) || (p.length <= 4 && !asciiFirstName(p)));
}

// Domena urzędu, szkoły albo sądu (gov.pl osobno, przed sprawdzeniem nazwiska w domenie): edu.pl, bip, człon z nazwą jednostki („ug-firlej”,
// „mops-tarnobrzeg”, „sp24”, „um.warszawa”). Bez krótkich skrótów, które bywają nazwą firmy
// („so-”, „sr-”, „kas-”): skrzynka sądu czy urzędu skarbowego przechodzi przez nagłówek albo gov.pl.
const RE_OFFICE_DOMAIN =
  /\.edu\.pl$|(?:^|[.-])(?:ug|um|umig|uw|urzad|gmina|gminy|powiat|starostwo|mops|gops|mgops|pcpr|mopr|sp\d{1,3}|zs\d{1,3}|zsp\d{0,3}|zso\d{0,3}|lo\d{1,3}|szkola|przedszkole|sad|zus|krus|pup|bip|psse|wsse|pinb|wios|rdos)(?=[.-])/u;
// Domena zawsze jest w ASCII, a słowniki imion i nazwisk trzymają formy z ogonkami, więc człon
// porównujemy z ich zapisem bez polskich znaków („zielinski”, „lukasz”, „malgorzata”).
let asciiFirstNames: Set<string> | null = null;
const asciiFirstName = (p: string): boolean => {
  asciiFirstNames ??= new Set([...POLISH_FIRST_NAMES].map(foldAscii));
  return asciiFirstNames.has(p);
};
const nameToken = (p: string): boolean =>
  p.length >= 3 && (asciiFirstName(p) || isFirstNameGenitive(p) || isFirstNameLike(p) || !!surnameBase(p) || isAsciiSurnameShaped(p, true));
/** Imię sklejone z nazwiskiem albo nazwisko z imieniem w jednym członie („annanowak”,
 *  „lukaszkaminski”, „nowakanna”). Nazwisko tylko ze słownika: sama końcówka po imieniu dawałaby
 *  nazwy miejscowości („janowski” to i tak nazwisko, ale „Janowiec” czy „Adamów” nie). */
function joinedName(p: string): boolean {
  for (let i = 3; i <= p.length - 3; i++) {
    const a = p.slice(0, i);
    const b = p.slice(i);
    if (asciiFirstName(a) && (isAsciiSurnameShaped(b, false) || asciiFirstName(b))) return true;
    if (asciiFirstName(b) && isAsciiSurnameShaped(a, false)) return true;
  }
  return false;
}
// Nazwa powiatu to przymiotnik („powiat łęczyński”), więc człon na -ski obok „powiat” czy
// „starostwo” albo sklejony z nim („powiatleczynski”, „starostwo.tarnowski”) to nazwa jednostki.
const RE_UNIT_PART = /^(?:powiat|starostwo)$/u;
const RE_UNIT_ADJ = /^(?:powiat|starostwo)?[a-z]{2,}(?:sk|ck|dzk)i$/u;
/** Człony domeny, które są nazwiskiem albo imieniem („ostrowska-adwokaci”, „kowalski-geodezja”,
 *  „przedszkole-wisniewski”, „sad-brzeczyszczykiewicz”, „annanowak”). */
function personalDomainParts(domain: string): string[] {
  const parts = deburr(domain.toLowerCase()).split(/[.-]/u);
  const unit = parts.some((p) => RE_UNIT_PART.test(p));
  return parts.filter((p) => {
    if (RE_UNIT_ADJ.test(p) && (unit || /^(?:powiat|starostwo)/u.test(p))) return false;
    return nameToken(p) || (p.length >= 6 && joinedName(p));
  });
}
// Nazwa miejscowości w roli miejsca: za kodem pocztowym, po „w”/„we” albo w nazwie jednostki
// samorządu, urzędu czy sądu („Gminy Firlej”, „w Mielniku”, „21-136 Firlej”).
const RE_PLACE_ROLE =
  /(?:\d{2}-\d{3}|(?<!\p{L})(?:w|we|gmin\p{L}*|miast\p{L}*|powiat\p{L}*|starostw\p{L}*|urz[ąę]d\p{L}*|wójt\p{L}*|burmistrz\p{L}*|sąd\p{L}*))[ \t]+(\p{Lu}[\p{L}-]*)/giu;
/** Czy każdy człon domeny podobny do nazwiska to nazwa miejscowości urzędu: ta sama nazwa (z
 *  odmianą) stoi w roli miejsca w wierszu adresu albo w bloku nad nim („WÓJT GMINY FIRLEJ⏎…⏎
 *  podatki@firlej.pl”). Wiele gmin nosi nazwę równą nazwisku (Firlej, Mielnik), a nazwisko w nazwie
 *  firmy czy przedszkola („Przedszkole Niepubliczne Anny Nowak”) w roli miejsca nie stoi. */
function placeInContext(t: string, offset: number, parts: string[]): boolean {
  const ls = lineStartWithin(t, offset, 201);
  const ctx = `${ls < 0 ? '' : blockAbove(t, ls, 4).join('\n')}\n${t.slice(ls < 0 ? offset - 200 : ls, offset)}`;
  const places: string[] = [];
  RE_PLACE_ROLE.lastIndex = 0;
  for (let m = RE_PLACE_ROLE.exec(ctx); m; m = RE_PLACE_ROLE.exec(ctx)) places.push(deburr(m[1].toLowerCase()));
  // Ta sama nazwa z końcówką odmiany (najwyżej trzy litery; samogłoska na końcu może odpaść:
  // „Opole” → „Opolu”). Dłuższy wyraz to inna nazwa („Nowakowice” to nie „nowak”).
  // Ruchome „e” bywa, że odpada („Turek” → „w Turku”), a bywa, że zostaje („Osiek” → „w Osieku”).
  const stem = (p: string): string => (/[aeiouy]$/u.test(p) && p.length >= 5 ? p.slice(0, -1) : p);
  const mobileE = (p: string): string => p.replace(/e(?=[^aeiouy]$)/u, '');
  return parts.every((p) => places.some((w) => (w.startsWith(stem(p)) || w.startsWith(mobileE(p))) && w.length - p.length <= 3));
}

// Zwrot przed skrzynką urzędu w zdaniu („na ogólny adres”, „adres e-mail urzędu”, „skrzynka podawcza”).
const RE_OFFICE_MAIL_PHRASE = new RegExp(
  String.raw`(?<!\p{L})(?:[Oo]góln\p{L}*[ \t]+(?:adres\p{L}*|skrzynk\p{L}*)(?:[ \t]+e-?mail\p{L}*)?|(?:[Aa]dres\p{L}*|[Ee]-?mail\p{L}*|[Pp]oczt\p{L}*)[ \t]+(?:e-?mail[ \t]+)?(?:do[ \t]+)?${OFFICE_GENITIVE}|[Ss]krzynk\p{L}*[ \t]+(?:podawcz|funkcyjn|urzęd|ogóln)\p{L}*)(?:[ \t]+\p{Ll}+){0,2}[ \t]*:?[ \t]*$`,
  'u',
);
// Nazwa wyświetlana przed adresem w nagłówku wiadomości („Wydział Finansowy <finanse@…>”).
const RE_DISPLAY_NAME = /(?:^|[:;,]|[ \t]{2})[ \t]*["„]?(\p{Lu}[^<>\n,;:"„”]{1,80}?)["”]?[ \t]*<$/u;

/** Czy e-mail `m` na pozycji `offset` to skrzynka funkcyjna instytucji: część lokalna urzędu albo
 *  ogólna, a do tego domena urzędu, blok adresowy siedziby, nazwa instytucji przed adresem, zwrot
 *  „ogólny adres” czy „skrzynka podawcza”. Poza gov.pl każda skrzynka tylko bez nazwiska i imienia
 *  w domenie, chyba że ten człon to miejscowość urzędu z kontekstu. Imienny adres („a.siwiec@…”)
 *  zawsze zostaje zakryty. */
export function institutionEmailAt(t: string, offset: number, m: string, probe?: PersonProbe): boolean {
  const at = m.indexOf('@');
  if (at <= 0) return false;
  if (!functionalLocal(m.slice(0, at))) return false;
  const domain = m.slice(at + 1).toLowerCase();
  if (domain.endsWith('.gov.pl')) return true;
  // Nazwisko albo imię w domenie (poza gov.pl, także w edu.pl i przy członie „przedszkole”) to
  // zwykle skrzynka firmy czy działalności osoby, chyba że ten człon to miejscowość urzędu.
  const personal = personalDomainParts(domain);
  if (personal.length && !placeInContext(t, offset, personal)) return false;
  if (RE_OFFICE_DOMAIN.test(domain)) return true;
  const before = t.slice(windowStart(t, offset, 100), offset);
  if (RE_OFFICE_MAIL_PHRASE.test(before)) return true;
  const display = RE_DISPLAY_NAME.exec(before);
  if (display) return institutionNameLevel(display[1]) === 2 && !probeHasPerson(probe, display[1]);
  return institutionSegmentBefore(t, offset, offset + m.length, probe, false) || institutionBlockContactAt(t, offset, offset + m.length, probe);
}

// Rachunek z właścicielem w dopełniaczu tuż przed numerem („na rachunek Gminy Firlej nr …”,
// „na rachunek bankowy Starostwa Powiatowego w Kłodzku nr …”, „wpłaty na konto Miasta Gliwice: …”)
// albo z ogólnym odesłaniem do organu („na rachunek urzędu”, „rachunek bankowy organu”).
const RE_ACCOUNT_OWNER_BEFORE =
  /(?<!\p{L})(?:rachun(?:ek|ku|kiem)|kont(?:o|a|em)|koncie)(?:[ \t]+bankow\p{L}*)?[ \t]+((?:\p{Lu}|organu|urzędu|gminy|miasta|powiatu|starostwa|ośrodka|szkoły|sądu)[^\n:;()]{0,100}?)[ \t]*,?[ \t]*(?:(?:nr|numer)\.?[ \t]*:?[ \t]*)?(?::[ \t]*)?(?:IBAN:?[ \t]*)?$/u;
// To samo od pozycji słowa „rachunek”/„konto”, od najbliższego numeru: wyrażenie z „$” próbowane
// od każdej pozycji okna kosztowało przy każdym numerze, a dopasowanie zaczyna się tylko na tym
// słowie. Najbliższe słowo daje właściciela tuż przed numerem.
const RE_ACCOUNT_OWNER_AT = new RegExp(RE_ACCOUNT_OWNER_BEFORE.source, 'uy');
const RE_ACCOUNT_WORD = /(?<!\p{L})(?:rachun|kon[tc])/gu;
function accountOwnerBefore(before: string): RegExpExecArray | null {
  const at: number[] = [];
  RE_ACCOUNT_WORD.lastIndex = 0;
  for (let w = RE_ACCOUNT_WORD.exec(before); w; w = RE_ACCOUNT_WORD.exec(before)) at.push(w.index);
  for (let i = at.length - 1; i >= 0; i--) {
    RE_ACCOUNT_OWNER_AT.lastIndex = at[i];
    const m = RE_ACCOUNT_OWNER_AT.exec(before);
    if (m) return m;
  }
  return null;
}
// Rachunek przypisany osobie mimo nazwy urzędu: mikrorachunek, subkonto podatnika, rachunek
// indywidualny, wirtualny, przypisany albo nadany podatnikowi, rachunek z zaimkiem dzierżawczym
// („Numer Pana konta podatkowego: rachunek Gminy …”, „Twój rachunek: …”). Subkonto w gminie
// identyfikuje podatnika tak samo jak mikrorachunek w urzędzie skarbowym. Znacznik musi stać przy
// słowie „rachunek”, „konto” czy „numer”, bo „decyzja indywidualna” albo „Pana wniosek” w tym samym
// wierszu nie mówią nic o rachunku.
const ACCOUNT_NOUN = String.raw`(?:rachun\p{L}*|(?:sub)?kont(?:o|a|em|ach|om)?(?!\p{L})|(?:sub)?koncie|mikrorachun\p{L}*)`;
const PERSONAL_ADJ = String.raw`(?:indywidualn|wirtualn|przypisan|nadan|własn|osobist)\p{L}*`;
const POSSESSIVE = String.raw`(?:Pan(?:a|u)?|Pani|Państw[ao]?|Tw(?:ój|oj\p{L}+)|Wasz\p{L}*|mój|moj\p{L}+|swój|swoj\p{L}+)`;
const RE_PERSONAL_ACCOUNT_BEFORE = new RegExp(
  String.raw`(?<!\p{L})(?:subkont|mikrorachun|dla[ \t]+podatni|${PERSONAL_ADJ}[ \t]+(?:\p{L}+[ \t]+){0,2}(?:${ACCOUNT_NOUN}|numer|nr(?!\p{L}))|${POSSESSIVE}(?!\p{L})[ \t]+(?:\p{L}+[ \t]+){0,2}${ACCOUNT_NOUN}|(?:${ACCOUNT_NOUN}|numer)[ \t]+(?:\p{L}+[ \t]+)?${PERSONAL_ADJ})`,
  'iu',
);
// Za numerem w tym samym zdaniu: znacznik rachunku osoby albo zwrot do adresata wielką literą
// („– jest to Pana numer subkonta”, „właściwy wyłącznie dla Pani”, „nadany dla podatnika …”).
const RE_PERSONAL_ACCOUNT_AFTER =
  /(?<!\p{L})(?:[Ss]ubkont|[Mm]ikrorachun|[Pp]rzypisan|[Ii]ndywidualn|[Ww]irtualn|[Nn]adan\p{L}*[ \t]+(?!przez(?!\p{L}))|dla[ \t]+podatni|(?:Pan(?:a|u)?|Pani|Państw[aou]?|Tw(?:ój|oj\p{L}+)|Wasz\p{L}*)(?!\p{L}))/u;
// Koniec dopisku o numerze: koniec zdania albo wiersza, kolejny rachunek albo kolejna liczba
// („…, a nadpłata zostanie zwrócona na rachunek nr … wskazany przez Jana Kowalskiego” mówi o innym
// rachunku).
const RE_AFTER_STOP = /\n|[.!?](?=[ \t]+\p{Lu}|[ \t]*$)|(?<!\p{L})(?:rachun|kont|koncie)\p{L}{0,6}[ \t]+(?:\p{L}+[ \t]+){0,2}(?:nr|numer)(?!\p{L})|\d{2}/u;
// Koniec poprzedniego zdania w wierszu: kropka, wykrzyknik albo pytajnik przed wielką literą.
const RE_SENTENCE_END = /[.!?][ \t]+(?=\p{Lu})/gu;
/** Odcinek przed numerem od początku zdania albo wiersza (najwyżej 180 znaków). */
function sentenceBefore(t: string, offset: number): string {
  const ls = lineStartWithin(t, offset, 180);
  const s = t.slice(ls < 0 ? offset - 180 : ls, offset);
  let from = 0;
  RE_SENTENCE_END.lastIndex = 0;
  for (let m = RE_SENTENCE_END.exec(s); m; m = RE_SENTENCE_END.exec(s)) from = m.index + m[0].length;
  return s.slice(from);
}
/** Odcinek za numerem do końca zdania, wiersza albo kolejnego rachunku (najwyżej 80 znaków): tu stoi
 *  dopisek o właścicielu. */
function sentenceAfter(t: string, end: number): string {
  const s = t.slice(end, end + 80);
  const stop = s.search(RE_AFTER_STOP);
  return stop >= 0 ? s.slice(0, stop) : s;
}
const GENERIC_OWNERS = new Set<string>('organu urzędu gminy miasta powiatu starostwa ośrodka szkoły sądu'.split(' '));
// Jednostka samorządu w dopełniaczu z samą nazwą miejsca („Gminy Firlej”, „Miasta Gliwice”,
// „Gminy Miasto Rzeszów”, „Powiatu Kłodzkiego”, „Miasta Stołecznego Warszawy”).
const RE_PLACE_UNIT_GENITIVE =
  /^(?:Gminy|Miasta|Powiatu|Województwa|Dzielnicy)(?:[ \t]+(?:Miasto|Miejskiej|Stołecznego|\p{Lu}[\p{Ll}]+(?:-\p{Lu}\p{Ll}+)?|nad|pod)){0,3}$/u;

/** Czy nazwa właściciela rachunku to instytucja publiczna albo jednostka samorządu, bez osoby? */
function institutionOwner(name: string, probe?: PersonProbe): boolean {
  const n = name.replace(/[ \t]+/gu, ' ').trim();
  if (GENERIC_OWNERS.has(n)) return true;
  const ws = n.split(' ');
  if (ws.some((w, i) => i > 0 && POLISH_FIRST_NAMES.has(w.toLowerCase()))) return false;
  if (!RE_PLACE_UNIT_GENITIVE.test(n) && institutionNameLevel(n, true) !== 2) return false;
  return !probeHasPerson(probe, n);
}

/** Czy rachunek zaczynający się na pozycji `offset` należy do instytucji: właściciel w dopełniaczu
 *  tuż przed numerem to urząd, jednostka samorządu albo ogólne „urzędu”/„organu”, a numer nie jest
 *  rachunkiem indywidualnym podatnika. Rachunek strony („na rachunek Rodzica nr”, „na rachunek
 *  wnioskodawczyni”, „na mój rachunek”) nie ma takiego właściciela i zostaje zakryty. */
export function institutionAccountAt(t: string, offset: number, end: number, probe?: PersonProbe): boolean {
  const before = t.slice(windowStart(t, offset, 180), offset);
  const m = accountOwnerBefore(before);
  if (!m) return false;
  // Znacznik rachunku osoby w wierszu przed numerem, w tym samym zdaniu za nim, albo osoba za numerem
  // („nr … (subkonto Jana Kowalskiego)”, „nr … – ANNA NOWAK”): wtedy to rachunek tej osoby.
  if (RE_PERSONAL_ACCOUNT_BEFORE.test(sentenceBefore(t, offset))) return false;
  const after = sentenceAfter(t, end);
  if (RE_PERSONAL_ACCOUNT_AFTER.test(after) || (/\p{Lu}\p{L}/u.test(after) && !personFree(probe, after))) return false;
  return institutionOwner(m[1], probe);
}
