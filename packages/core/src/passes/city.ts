// Maskowanie miejscowości: po kodzie pocztowym, przy adresie, z etykietą TERYT oraz po markerze
// zamieszkania lub urodzenia.
import { HOMOGRAPH_SURNAMES, isConfirmedSurname, looksLikeSurname, NON_SURNAME_ADJ, surnameBase } from '../surnames.js';
import { ADR_MASK_SRC, CAP_CITY, CITY_RUN, CITY_START, DUR_MASK_SRC, KOD_MASK_SRC, PL_LO, PL_UP, RE_CHAR_LL, splitWords } from '../charset.js';
import type { RedactCtx } from '../context.js';
import { MASK } from '../types.js';
import { FORM_LABEL_WORDS } from '../dict/forms.js';
import { isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { MULTIWORD_CITIES, POLISH_CITIES } from '../dict/places.js';
import { BIRTH_COMBO, birthVerbAboutPerson } from '../guards/birth.js';
import { saintWithContext } from '../guards/eponyms.js';
import { LEGAL_ENTITY_WORDS, PARTY_ROLE_WORDS, ROLE_WORDS } from '../guards/roles.js';
import { precededByLegalRef } from '../guards/numbers.js';

/** Rok sprzed 1900 jako osobny wyraz („w 1867 r.”). */
const RE_PRE1900_YEAR = /(?<![\d.\/-])1[0-8]\d\d(?![\d.\/-]\d)/;
/** Zdanie wokół zakresu [start, end), najwyżej 200 znaków w każdą stronę. */
function sentenceAround(t: string, start: number, end: number): string {
  const lo = Math.max(0, start - 200);
  const head = t.slice(lo, start);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('!'), head.lastIndexOf('?'), head.lastIndexOf('\n'));
  const tail = t.slice(end, end + 200);
  const stop = tail.search(/[.!?](?:[ \t]+\p{Lu}|[ \t]*$|[ \t]*\n)|\n/u);
  return head.slice(cut + 1) + t.slice(start, end) + (stop < 0 ? tail : tail.slice(0, stop));
}

// Miejscownik miejscowości spoza słownika po „zam. w", „zamieszkały w", „zameldowana w": słownik zna
// średnie i duże miasta, a mniejsza miejscowość stoi tuż przy zamaskowanym adresie („zam. w Świdniku").
// „-iach" bez „c"/„k" przed „ach" to kraina w liczbie mnogiej („na Kurpiach"), nie miejscowość.
const RE_LOCATIVE_PLACE = /^\p{Lu}\p{Ll}{2,}(?:iku|ku|nie|wie|cach|kach|(?<!i)ach|ie|iu|dzie|rze|ce|le|ze|owie|ynie|inie)$/u;
// Kraj, region i placówka („w Polsce", „w Ośrodku") to nie miejsce zamieszkania osoby. Lista zawiera
// tylko formy, które przechodzą RE_LOCATIVE_PLACE.
const LOCATIVE_NOT_PLACE = new Set<string>(
  (
    // państwa i kontynenty
    'polsce czechach ukrainie kanadzie litwie łotwie ameryce stanach europie chinach egipcie meksyku ' +
    'iranie iraku libanie maroku afryce wietnamie filipinach singapurze azerbejdżanie czarnogórze ' +
    'argentynie ekwadorze chile kubie katarze kuwejcie emiratach sudanie kamerunie birmie bahrajnie ' +
    'kosowie jemenie omanie laosie tajwanie nigerze czadzie beninie ghanie gabonie ugandzie rwandzie ' +
    'mozambiku botswanie panamie kostaryce hondurasie salwadorze gujanie surinamie bhutanie palestynie ' +
    'cyprze malcie madagaskarze jamajce tybecie ' +
    // regiony, krainy i jednostki podziału
    'wielkopolsce małopolsce śląsku podlasiu kaszubach mazurach bieszczadach kujawach lubelszczyźnie ' +
    'ponidziu donbasie kaukazie krymie zakarpaciu podkarpaciu polesiu wołyniu orawie żuławach kociewiu ' +
    'zagłębiu suwalszczyźnie regionie obwodzie rejonie mieście gminie powiecie województwie ' +
    // pasma górskie
    'tatrach sudetach karpatach beskidach pieninach karkonoszach gorcach alpach ' +
    // budynki i placówki pisane wielką literą na początku nazwy własnej albo zdania
    'zakładzie ośrodku internacie akademiku bloku mieszkaniu schronisku placówce areszcie więzieniu ' +
    'klasztorze zakonie bursie budynku domku altanie przyczepie namiocie baraku kontenerze dworze zamku ' +
    'pensjonacie koszarach koszarze jednostce'
  ).split(' '),
);
const RE_LOCATIVE_PLACE_END = /^(?:[ \t]*(?:[,.;)]|\r?\n|$)|[ \t]+(?:przy|ul\.|al\.|os\.|pl\.|gm\.|pow\.|woj\.|nr|i|oraz)(?![\p{L}]))/u;
function residenceLocativeCity(marker: string, run: string, after: string): boolean {
  // tylko liczba pojedyncza: „osób zamieszkałych w …" to zdanie ogólne (ogłoszenie, uchwała)
  if (!/^(?:[Zz]am\.|[Zz]amieszka[łl](?:y|a|ą|ej|ego|emu|ym)?[ \t]|[Zz]ameldowan(?:y|a|ą|ej|ego|emu|ym)[ \t])/.test(marker) || !/(?<!\p{L})[Ww]e?[ \t]+$/u.test(marker)) return false;
  // „-stanie" to miejscownik nazw państw („w Kazachstanie"), nie miejscowości
  if (/[ \t-]/.test(run) || !RE_LOCATIVE_PLACE.test(run) || LOCATIVE_NOT_PLACE.has(run.toLowerCase()) || /stanie$/.test(run)) return false;
  return RE_LOCATIVE_PLACE_END.test(after);
}
// Marker zamieszkania przed miastem: zamknięta lista form zamiast „mieszka\w*", które łapie rzeczowniki
// i przymiotniki („Spółdzielnia Mieszkaniowa w Krakowie"). Klasa [a-ząę] celowo bez „ń": „mieszkańcy
// w Krakowie" to proza. Rzeczownik „zamieszkania/zameldowania" działa tylko po „miejsce/adres".
const RESIDENCE_MARKER =
  `(?:[Zz]a)?[Mm]ieszk(?:a(?:m|sz|my|cie|j[aąę][a-ząę]*|niec|nk[aiąęo])?|a(?:ł|l(?!n))[a-ząę]*|uj[a-ząę]*|iwa[łl][a-ząę]*)|` +
  `[Zz]ameldowan(?!i[aeu])[a-ząęó]*|` +
  // rzeczownik tylko jako etykieta pola z dwukropkiem („Zameldowanie: Wieliczka"), w prozie bez maski
  `[Zz]a(?:mieszk|meldow)ani(?:e|a|u|em)(?=[ \\t]*:)|` +
  // etykiety formularzy urzędowych („miejscowość zamieszkania:")
  `(?:[Mm]iejsc(?:e|a|u|em)|[Aa]dres(?:u|em|ie)?|[Mm]iejscowoś(?:ć|ci)|[Mm]iast(?:o|a)|[Gg]min(?:a|y))` +
  `[ \\t]+(?:(?:sta[łl]|czasow)[a-ząęó]*[ \\t]+)?` +
  `(?:zamieszkania|zameldowania|pobytu|urodzenia)`;
// Imiesłów w liczbie mnogiej albo na początku zdania w formie bywającej mnogą („Zamieszkującym
// w Gdańsku przysługuje ulga") to zdanie ogólne, nie miejsce zamieszkania konkretnej osoby. Forma
// tylko pojedyncza („Mieszkająca w Krakowie powódka") zostaje markerem.
const RE_RESIDENCE_GENERAL =
  /^(?:(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ąc(?:ych|e|ymi)|(?:Zam|M)ieszk(?:uj|aj)ąc(?:y|e|ych|ym|ymi))(?![\p{L}])/u;
// Imiesłów „-ując-/-jąc-" w formie bywającej mnogą jest ogólny po rzeczowniku zbiorowym („Dzieci
// zamieszkujące w …"). Formy „zamieszkał-/zameldowan-" tu nie wchodzą: „osób zamieszkałych w …" zostaje w masce.
const RE_RESIDENCE_PARTICIPLE = /^(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ąc(?:y|e|ych|ym|ymi)(?![\p{L}])/u;
// 3. osoba liczby mnogiej („Ci, którzy mieszkają w Krakowie").
const RE_RESIDENCE_3PL = /^(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ą(?![\p{L}])/u;
// Rzeczownik zbiorowy, grupa ludności albo zaimek ogólny przed imiesłowem, też przez „, którzy".
// Celowo bez stron postępowania w liczbie mnogiej („Pozwani mieszkający w …"): w piśmie to konkretne osoby.
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
// Celownik liczby mnogiej spoza listy przed imiesłowem na -ym („Najemcom zamieszkującym w Gdańsku
// przysługuje …"), małą literą albo na początku zdania.
const RE_DATIVE_PLURAL_BEFORE = /(?:(?<!\p{L})\p{Ll}{3,}om|(?:^|[.!?\n][ \t]*)\p{Lu}\p{Ll}{2,}om)[ \t]+$/u;
// Podmiot ogólny w liczbie pojedynczej („Osoba mieszkająca w Krakowie może złożyć wniosek") jest ogólny
// tylko z orzeczeniem modalnym albo przyszłym za miastem; „Osoba … złożyła wniosek" to konkretna osoba.
const RE_GENERIC_SG_BEFORE = /(?<!\p{L})(?:osoba|osobie|osobę|osobą|rodzina|rodzinie|rodzinę|rodziną)[ \t]+$/iu;
const RE_RESIDENCE_PARTICIPLE_SG = /^(?:[Zz]a)?[Mm]ieszk(?:uj|aj)ąc(?:a|ej|ą|y|e|ego|emu|ym)(?![\p{L}])/u;
const RE_GENERIC_PREDICATE_AFTER =
  /^[ \t]*,?[ \t]*(?:(?:nie|też|także|również|zawsze|jedynie|tylko)[ \t]+)?(?:może|mogą|można|musi|muszą|należy|powinien|powinna|powinno|powinni|powinny|ma[ \t]+prawo|mają[ \t]+prawo|otrzyma|otrzymają|otrzymuje|otrzymują|przysługuje|przysługują|zapłaci|zapłacą|płaci|płacą|skorzysta|skorzystają|korzysta|korzystają|uzyska|uzyskają|będzie|będą|jest[ \t]+uprawnion\p{L}*|jest[ \t]+zobowiązan\p{L}*|są[ \t]+uprawnieni|są[ \t]+zobowiązani)(?!\p{L})/u;
// Imiesłów przysłówkowy przed zdaniem bezosobowym („Mieszkając w Krakowie, można korzystać z karty")
// to porada. Z orzeczeniem osobowym („…, często bywał w teatrze") dotyczy osoby z pisma.
const RE_RESIDENCE_ADVERBIAL = /^(?:Zam|M)ieszk(?:uj|aj)ąc(?![\p{L}])/u;
const RE_IMPERSONAL_AFTER =
  /^[ \t]*,?[ \t]*(?:(?:nie|też|także|również|łatwiej|łatwo|taniej|szybciej|zawsze)[ \t]+)?(?:można|warto|należy|trzeba|wystarczy|da[ \t]+się|opłaca[ \t]+się)(?!\p{L})/u;
const RE_STREET_ADDR_AFTER_CITY = new RegExp(String.raw`^[ \t]*,?[ \t]*(?:przy[ \t]+)?${ADR_MASK_SRC}`);
const RE_POPULATION_AFTER =
  /^[ \t]+(?:(?:ok\.|około|ponad|blisko|niemal|prawie|przeszło|już|aż)[ \t]+)?\d[\d  .,]{0,12}(?:[ \t]*(?:tys\.|tysięcy|tys|mln|milion\p{L}*))?[ \t]+(?:osób|osoby|mieszkańców|ludzi|rodzin|obywateli|dzieci|uczniów|studentów|cudzoziemców)(?!\p{L})/u;
/**
 * Czy marker zamieszkania stoi w zdaniu ogólnym (ogłoszenie, uchwała, poradnik, statystyka), a nie
 * przy konkretnej osobie? `before` to tekst przed markerem, `after` to tekst za nazwą miasta.
 */
function residenceIsGeneral(marker: string, before: string, after: string): boolean {
  // zamaskowany adres za miastem to konkretne miejsce („Ludzie mieszkający w Krakowie przy ul. Długiej 5")
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
// Liczba za miastem to statystyka tylko w dużej skali (tysiące albo od 100 w górę). Mała liczba to skład
// gospodarstwa osoby z pisma („Wnioskodawczyni zamieszkała w Gdańsku 3 osoby na utrzymaniu").
function populationAfter(after: string): boolean {
  const m = RE_POPULATION_AFTER.exec(after);
  if (!m) return false;
  if (/tys|mln|milion/.test(m[0])) return true;
  const n = Number(/\d[\d\s.]*/.exec(m[0])?.[0].replace(/[^\d]/g, '') ?? '0');
  return n >= 100;
}
// Między podmiotem zbiorowym a markerem bywa do dwóch wyrazów przydawki albo okolicznika („Obywatele
// Ukrainy mieszkający w …", „Polacy coraz częściej mieszkają …"). Osoba w dopełniaczu albo zaimek
// dzierżawczy („Dzieci wnioskodawczyni mieszkają") wskazuje konkretną osobę i blokuje.
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
// Koniec nazwy miasta po markerze zamieszkania i urodzenia: separator, koniec wiersza albo koniec
// tekstu. Regex jest bez flagi „m", więc samo „$" oznacza koniec całego tekstu i nie łapie
// „zam. w Krakowie⏎PESEL …".
const CITY_END = '(?=[ \\t\\r\\n.,;:?!)]|$)';
// Wyraz wersalikami jako nazwa miejscowości (po kodzie i po adresie). Granica po całym wyrazie, żeby cofanie
// nie skracało go do prefiksu („KRAKÓWek").
const CAPS_CITY_TOK = `[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})*(?![${PL_UP}${PL_LO}0-9-])`;
// Skróty, waluty i etykiety wersalikami za kodem to nie miejscowość („[KOD] VAT", „00-238 POCZTA WARSZAWA").
const CAPS_CITY_STOP = new Set<string>(
  (
    'vat nip regon pesel krs zus krus gus bdo pkd cit pit kpa kpc ksh rodo rca dra skr tel fax faks ' +
    'brutto netto poz art fv pln eur usd chf gbp czk miasto miejscowość miejscowosc poczta gmina ' +
    'powiat województwo wojewodztwo woj kraj kod polska poland ul al os nr ' +
    // etykiety kolejnego pola w jednowierszowym formularzu z OCR („26-900 TELEFON 600700800") i dopiski pocztowe
    'telefon kom email e-mail mail data dnia skrytka paczkomat odbiór odbior priorytet polecony ' +
    'obywatelstwo adres kontakt numer podpis uwagi pl pow gm ' +
    // odpowiedź w pustym polu miejscowości i dalszy ciąg wiersza („31-616 BRAK", „ZAMELDOWANY OD 2010")
    'brak tak nie jak sprawdzono nieaktualny nieaktualne nieaktualna zameldowany zameldowana ' +
    'zamieszkały zamieszkała oddział obszar osiedle teryt'
  ).split(' '),
);
// Przymiotnik-głowa nazwy („STARY TARG"): za nim rzeczownik.
const CAPS_CITY_ADJ_HEAD = new Set<string>(
  'nowa nowy nowe stara stary stare wielka wielki wielkie mała mały małe duża duży duże górna górny górne dolna dolny dolne'.split(' '),
);
// Człony wielowyrazowej nazwy wersalikami w bloku adresowym bez słownika („STARA WIEŚ", „KAZIMIERZ
// BISKUPI"). Zamknięta lista, bo dowolny wyraz wersalikami złapałby nazwisko z imieniem albo etykietę
// kolejnej kolumny („GŁOWACZÓW KOWAL-ZAJĄC ANNA").
const CAPS_CITY_PART = new Set<string>([
  ...CAPS_CITY_ADJ_HEAD,
  ...(
    'średnia średni średnie wieś wola kolonia osada huta ruda biskupia biskupi biskupie kościelna ' +
    'kościelny kościelne szlachecka szlachecki szlacheckie królewska królewski królewskie nad pod'
  ).split(' '),
]);
const CAPS_CITY_FEM_HEAD = new Set<string>('wola wieś kolonia huta ruda osada dąbrowa góra'.split(' '));
/** `lineEnd`: za członem kończy się wiersz, komórka albo pole (koniec tekstu, „\n", TAB, „,", „;"). */
function capsCityTailPart(w: string, prev: string, lineEnd = false): boolean {
  const lo = w.toLowerCase();
  const pl = prev.toLowerCase();
  // „MIASTO" ze stoplisty jest członem tylko w „NOWE/STARE MIASTO"
  if (lo === 'miasto') return pl === 'nowe' || pl === 'stare';
  if (CAPS_CITY_STOP.has(lo)) return false;
  if (CAPS_CITY_PART.has(lo) || pl === 'nad' || pl === 'pod') return true;
  if (CAPS_CITY_FEM_HEAD.has(pl) && /(?:sk|ck|dzk|ow|n)a$/.test(lo)) return true;
  // przymiotnik regionalny męski i nijaki po dowolnej głowie („STAROGARD GDAŃSKI"), żeński po
  // głowie żeńskiej („WÓLKA KOSOWSKA")
  if (/(?:sk|ck|dzk)(?:i|ie)$/.test(lo)) return true;
  if (/a$/.test(pl) && /(?:sk|ck|dzk|ow)a$/.test(lo)) return true;
  // rzeczownik po przymiotniku-głowie tylko jako ostatni człon wiersza („34-400 STARY TARG")
  return lineEnd && CAPS_CITY_ADJ_HEAD.has(pl);
}
// „św." osobno: tylko z kontekstem sakralnym (saintWithContext), bo bez niego bywa skrótem
// „świadek" („św. Jan Turek, ul. …" to osoba, nie miasto).
const RE_SAINT_BEFORE = /(?<!\p{L})(?:bł|im|pw)\.[ \t]*$/iu;
// Obiekt noclegowy lub lokal tuż przed nazwą: „Maria" to nazwa obiektu, nie imię osoby. Bez sklepu,
// gabinetu czy zakładu, bo te zwykle noszą imię i nazwisko właściciela („w gabinecie Anna Kalisz").
const RE_FACILITY_BEFORE =
  /(?<!\p{L})(?:pensjona|hotel|motel|hostel|restauracj|kawiarni|karczm|zajazd|zajeździe|gospod|will[iaęą])\p{Ll}*[ \t]+$/u;
/**
 * Czy ciąg przed „, ul./[ADRES]" to osoba z nazwiskiem będącym też nazwą miasta („Jan Turek",
 * „Pani Anna Kalisz")? Imię tylko w mianowniku ze słownika, bo odmiana bywa patronem; „św./bł./im./pw."
 * przed imieniem to też patron. Rzeczownik przed imieniem („Pensjonat Maria Zakopane") to nazwa firmy.
 */
function cityRunLooksLikePerson(capRun: string, before: string): boolean {
  const lo = capRun.split(/[ \t]+/).map((w) => w.toLowerCase());
  const city = lo[lo.length - 1];
  const isPan = (w: string): boolean => w === 'pan' || w === 'pani' || w === 'panna';
  // toponim „imię + przymiotnik" po imieniu albo „Pan" jest nazwiskiem („Pan Jan Kazimierz Dolny, ul. …")
  if (lo.length >= 2 && POLISH_FIRST_NAMES.has(lo[lo.length - 2]) && POLISH_CITIES.has(`${lo[lo.length - 2]} ${city}`)) {
    // także etykieta roli z dwukropkiem („Wnioskodawca: Kazimierz Dolny, ul. Polna 3")
    const prev = lo.length >= 3 ? lo[lo.length - 3] : (/(\p{L}+)[ \t]*:?[ \t]+$/u.exec(before)?.[1] ?? '').toLowerCase();
    return POLISH_FIRST_NAMES.has(prev) || isPan(prev) || (lo.length === 2 && (ROLE_WORDS.has(prev) || PARTY_ROLE_WORDS.has(prev)));
  }
  if (!POLISH_CITIES.has(city) || POLISH_FIRST_NAMES.has(city)) return false;
  // rzeczownik obiektu małą literą przed imieniem żeńskim to nazwa firmy („nocleg w pensjonacie Maria
  // Zakopane"), o ile miasto nie bywa nazwiskiem: „Pracownik w hotelu Jan Kalisz, ul. …" to osoba
  if (lo.length === 2 && RE_FACILITY_BEFORE.test(before) && lo[0].endsWith('a') && !HOMOGRAPH_SURNAMES.has(city)) return false;
  if (lo.length === 2) return isPan(lo[0]) || (POLISH_FIRST_NAMES.has(lo[0]) && !RE_SAINT_BEFORE.test(before) && !saintWithContext(before, before.length, before.slice(-12)));
  if (lo.length === 3) return isPan(lo[1]) || (POLISH_FIRST_NAMES.has(lo[1]) && (POLISH_FIRST_NAMES.has(lo[0]) || isPan(lo[0])));
  return false;
}

// Wyraz po nazwie miejscowości, który nie jest jej członem: państwo, etykieta kontaktu, nagłówek
// faktury czy wizytówki („86-170 Nowe Kontakt: …").
const RE_NOT_CITY_TAIL =
  /^(?:Polska|Poland|Tel|Telefon|Fax|Faks|Kom|Komórka|Mail|E-mail|Email|Www|NIP|REGON|KRS|PESEL|Woj|Gmina|Powiat|Poczta|Kontakt|Godziny|Faktura|Konto|Bank|Data|Adres|Osoba|Infolinia|Sekretariat|Strona|Nr|Numer|Razem|Suma|Termin|Sposób|Wartość|Kwota|Forma|Uwagi|Wystawca|Odbiorca|Sprzedawca|Nabywca|Płatność|Płatności)$/i;
// Człon nazwy kończy wiersz, komórkę albo pole („05-082 Stare Babice, ul. …") albo stoi przed wyrazem
// małą literą („Nowa Iwiczna gm. Piaseczno"). Wyraz z wielkiej litery za nim zaczyna coś innego:
// osobę, instytucję albo etykietę („86-170 Nowe Anna Gzik").
function cityTailEnds(t: string, end: number): boolean {
  if (t[end] === '\t') return true;
  let i = end;
  while (t[i] === ' ' || t[i] === '\t') i++;
  // koniec pola JSON/XML/CSV („…Babice</Miasto>") i adnotacja „(gmina)" też
  if (i >= t.length || /[,;)(\r\n"'<\]}|/”»]/.test(t[i])) return true;
  return i > end && RE_CHAR_LL.test(t[i]);
}
// Pierwszy człon nazw miejscowości („Stare Babice", „Wielkie Oczy").
const CITY_PREFIX_ADJ = new Set<string>(
  (
    'stare stara stary nowe nowa nowy wielkie wielka wielki małe mała mały górne górna górny dolne ' +
    'dolna dolny białe biała biały czarne czarna czarny zielone zielona zielony wysokie wysoka wysoki ' +
    'suche sucha suchy kamienna kamienny'
  ).split(/\s+/),
);
// Trzeci człon nazwy po „Nowa Wieś", „Stara Wieś": przymiotnik odmiejscowy albo kierunkowy („Nowa Wieś Tarnowska").
const isCityThirdPart = (w: string): boolean =>
  /^\p{Lu}\p{Ll}*(?:sk|ck|dzk)(?:a|ie|i)$/u.test(w) || CITY_PREFIX_ADJ.has(w.toLowerCase()) || /^(?:Królewsk|Kościeln|Szlacheck)\p{Ll}+$/u.test(w);

// Człony za pierwszym wyrazem z oryginalnym odstępem przed każdym: niedoklejona reszta wraca w tym
// zapisie (spacja w miejscu tabulatora scaliłaby kolumny TSV).
const splitTail = (raw: string): string[] => raw.match(/[ \t]+[^ \t]+/g) ?? [];
// Ile członów dokleić do maski: najdłuższe dopasowanie do słownika nazw wielowyrazowych („Kostrzyn nad Odrą").
function multiwordTake(first: string, parts: string[]): number {
  let take = 0;
  let combo = first.toLowerCase();
  for (let i = 0; i < parts.length; i++) {
    combo += ' ' + parts[i].trim().toLowerCase();
    if (MULTIWORD_CITIES.has(combo)) take = i + 1;
  }
  return take;
}
// Najdłuższe (do 3 wyrazów) miasto ze słownika na początku albo końcu ciągu wyrazów. Zwraca resztę
// ciągu z oryginalnymi odstępami (tabulator to granica kolumny TSV), a null, gdy miasta nie ma.
// Pusta reszta to też trafienie, więc wynik porównuje się z null.
function cityAtEdge(ctx: RedactCtx, run: string, edge: 'start' | 'end'): string | null {
  const { parts, words } = splitWords(run);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const city = edge === 'start' ? words.slice(0, n) : words.slice(words.length - n);
    if (POLISH_CITIES.has(city.join(' ').toLowerCase())) {
      ctx.bump('MIEJSCOWOSC');
      return edge === 'start' ? parts.slice(2 * n - 1).join('') : parts.slice(0, 2 * (words.length - n)).join('');
    }
  }
  return null;
}
// Maska nazwy ze słownika na początku `run`; null, gdy jej tam nie ma.
function maskCityPrefix(ctx: RedactCtx, head: string, run: string): string | null {
  const rest = cityAtEdge(ctx, run, 'start');
  return rest === null ? null : `${head}${ctx.M.MIEJSCOWOSC}${rest}`;
}

const TERYT_UNIT =
  `\\([ \\t]*(?:[Mm]iasto(?:[ \\t]+na[ \\t]+prawach[ \\t]+powiatu)?|[Gg]mina(?:[ \\t]+(?:miejska|wiejska|miejsko-wiejska))?|[Ww]ieś|[Oo]sada)[ \\t]*\\)`;
const RE_CITY_TERYT = new RegExp(`${CITY_START}(?:(${CAP_CITY})([ \\t]+))?(${CAP_CITY})([ \\t]*${TERYT_UNIT})`, 'g');
const RE_CITY_RESIDENCE = new RegExp(
  `\\b((?:[Zz]am\\.|${RESIDENCE_MARKER})[ \\t]*(?::[ \\t]*|[Ww]e?[ \\t]+|[ \\t]+))(${CITY_RUN})${CITY_END}`,
  'g',
);

// Miejscowość tuż po kodzie pocztowym. Człon może zaczynać łącznik „nad/pod" („66-470 Kostrzyn
// nad Odrą"); łącznik wchodzi do maski tylko wtedy, gdy cała fraza jest w słowniku.
const RE_CITY_AFTER_POSTAL = new RegExp(
  `(${KOD_MASK_SRC}|(?<![\\d-])\\d{2}-\\d{3})([ \\t]+)(${CAP_CITY})((?:[ \\t]+(?:(?:nad|pod)[ \\t]+)?${CAP_CITY}){0,2})`,
  'g',
);
function maskCityAfterPostalCode(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_CITY_AFTER_POSTAL,
    (m, anchor: string, sep: string, first: string, restRaw: string, offset: number, str: string) => {
      // surowy kod poprzedzony odwołaniem prawnym („poz. 12-345 Rejestr") to nie adres
      if (anchor !== MASK['KOD-POCZTOWY'] && precededByLegalRef(str, offset)) return m;
      const restParts = splitTail(restRaw);
      let take = multiwordTake(first, restParts);
      // Przymiotnik-człon spoza słownika („05-082 Stare Babice") dokleja drugi wyraz tylko po jednej
      // spacji (kilka spacji albo tabulator to kolumna) i nie przed etykietą, imieniem, nazwiskiem ani
      // instytucją: maska miasta połknęłaby imię, a nazwisko za nim zostałoby jawne.
      const part0 = restParts[0] ?? '';
      if (take === 0 && part0 && CITY_PREFIX_ADJ.has(first.toLowerCase()) && /^ \S/.test(part0)) {
        const end = offset + anchor.length + sep.length + first.length + part0.length;
        const tail = part0.trim();
        const tl = tail.toLowerCase();
        if (
          !RE_NOT_CITY_TAIL.test(tail) &&
          str.charAt(end) !== '.' &&
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
          if (cityTailEnds(str, end)) take = 1;
          else if (/^ +\S/.test(part1) && isCityThirdPart(p1) && str.charAt(end1) !== '.' && cityTailEnds(str, end1)) take = 2;
          // za członem zaczyna się osoba („05-082 Stare Babice Kowalski Jan")
          else if (/^ +\S/.test(part1) && (isFirstNameLike(p1) || looksLikeSurname(p1) || !!surnameBase(p1.toLowerCase()))) take = 1;
        }
      }
      return `${anchor}${sep}${ctx.hit('MIEJSCOWOSC')}${restParts.slice(take).join('')}`;
    },
  );
}

// Miejscowość wersalikami po kodzie („26-900 KOZIENICE"). Wersalikami pisze się też skróty
// („Partia 11-222 ZUS"), więc tylko słownik albo blok adresowy (kod tuż po [ADRES]), bez stoplisty
// i bez dwukropka za nazwą („POCZTA: WARSZAWA"). Surowy kod (odrzucony przez passPostal): tylko słownik.
const RE_ADR_BEFORE_POSTAL = new RegExp(`${ADR_MASK_SRC}[ \\t]*[,/;]?[ \\t]*(?:\\r?\\n[ \\t]*)?$`);
const RE_CAPS_CITY_AFTER_POSTAL = new RegExp(
  `(${KOD_MASK_SRC}|(?<![\\d-])\\d{2}-\\d{3})([ \\t]+)(${CAPS_CITY_TOK})((?:[ \\t]+(?:(?:NAD|POD)[ \\t]+)?${CAPS_CITY_TOK}){0,2})`,
  'g',
);
function maskCapsCityAfterPostalCode(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_CAPS_CITY_AFTER_POSTAL,
    (m, anchor: string, sep: string, first: string, restRaw: string, offset: number, str: string) => {
      const masked = anchor === MASK['KOD-POCZTOWY'];
      if (!masked && precededByLegalRef(str, offset)) return m;
      const lo = first.toLowerCase();
      if (CAPS_CITY_STOP.has(lo)) return m;
      const tailParts = splitTail(restRaw);
      let take = multiwordTake(first, tailParts);
      const dict = take > 0 || POLISH_CITIES.has(lo);
      const block = masked && lo.length >= 3 && RE_ADR_BEFORE_POSTAL.test(str.slice(Math.max(0, offset - 40), offset));
      if (!dict && !block) return m;
      // Blok adresowy bez słownika: cała nazwa wielowyrazowa („NOWA WIEŚ WIELKA"). Człon musi wyglądać
      // na część nazwy i stać za spacją, bo tabulator zaczyna kolejną komórkę. Kończy go też imię albo
      // nazwisko przed imieniem („… WOLA KOWALSKA ANNA").
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
          const next = /^ +(\S+)/.exec(str.slice(at, at + 40))?.[1];
          if (next && isFirstNameLike(next) && isConfirmedSurname(w)) break;
          take++;
        }
        if (take > 0 && /^(?:NAD|POD)$/.test(tailParts[take - 1].trim())) take--;
      }
      const end = offset + anchor.length + sep.length + first.length + tailParts.slice(0, take).join('').length;
      if (/^[ \t]*:/.test(str.slice(end, end + 4))) return m;
      return `${anchor}${sep}${ctx.hit('MIEJSCOWOSC')}${tailParts.slice(take).join('')}`;
    },
  );
}

// Miejscowość po kodzie za średnikiem albo przecinkiem (CSV „…;00-001;Warszawa"). Kolejna
// kolumna bywa krajem czy województwem, więc tylko słownik, a nazwa musi zamykać pole: „…, 00-003,
// Warszawa zgłosiła awarię" to zdanie.
const RE_CITY_CSV_AFTER_POSTAL = new RegExp(`(${KOD_MASK_SRC}"?)([ \\t]*[;,][ \\t]*"?)(${CITY_RUN})(?=[ \\t]*(?:["';,.)\\r\\n]|$))`, 'g');
function maskCityInCsvAndTerytFields(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_CITY_CSV_AFTER_POSTAL, (m, kod: string, sep: string, run: string) => maskCityPrefix(ctx, kod + sep, run) ?? m);
  // Etykieta TERYT z systemów e-urzędowych („Gliwice (miasto)", „Zabłudów (gmina miejsko-wiejska)")
  // to pewna kotwica, że wyraz przed nią jest nazwą miejscowości.
  ctx.text = ctx.text.replace(RE_CITY_TERYT, (m, pre: string | undefined, preSep: string | undefined, city: string, tag: string) => {
    const cl = city.toLowerCase();
    // ostatni wyraz przed etykietą nie może być członem nazwy instytucji ani roli
    if (LEGAL_ENTITY_WORDS.has(cl) || ROLE_WORDS.has(cl) || NON_SURNAME_ADJ.has(cl)) return m;
    ctx.bump('MIEJSCOWOSC');
    // dwuczłonowa nazwa („Nowa Sól") idzie pod jedną maskę; inny poprzednik zostaje
    if (pre && MULTIWORD_CITIES.has(`${pre.toLowerCase()} ${cl}`)) return `${ctx.M.MIEJSCOWOSC}${tag}`;
    return `${pre ? pre + preSep : ''}${ctx.M.MIEJSCOWOSC}${tag}`;
  });
}

const ADDR_ANCHOR = `(?:${ADR_MASK_SRC}|ul\\.|al\\.|os\\.|pl\\.)`;
// Miejscowość przed adresem bez kodu pocztowego („Warszawa, ul. …").
const RE_CITY_BEFORE_ADDR = new RegExp(`${CITY_START}(${CITY_RUN})([ \\t]*,?[ \\t]+)(${ADDR_ANCHOR})`, 'g');
// Miasto w osobnym wierszu tuż nad adresem („Warszawa⏎Hoża 41"). Cały wiersz musi być miastem
// ze słownika: „Wydział Kontroli⏎ul. …" nie jest.
const RE_CITY_LINE_ABOVE_ADDR = new RegExp(`(?<=^|\\n)([ \\t]*)(${CITY_RUN})(?=[ \\t]*\\r?\\n[ \\t]*${ADDR_ANCHOR})`, 'g');
// Miejscowość tuż po adresie bez kodu („[ADRES], Warszawa"), też po średniku i wersalikami.
// Przechodzą tylko nazwy ze słownika.
const RE_CITY_AFTER_ADDR = new RegExp(
  `(${ADR_MASK_SRC})([ \\t]*[,;][ \\t]*|[ \\t]+[Ww][Ee]?[ \\t]+|[ \\t]*\\n(?:[ \\t]*\\n)?[ \\t]*)` +
    `(${CITY_RUN}|(?:${CAPS_CITY_TOK}[ \\t]+){0,2}${CAPS_CITY_TOK})`,
  'g',
);
function maskCityNextToAddress(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_CITY_BEFORE_ADDR,
    (m, capRun: string, sep: string, anchor: string, offset: number, str: string) => {
      // Nazwisko-homonim miasta po imieniu albo „Pan/Pani" to osoba („Jan Turek, ul. Długa 5"), ciąg
      // zostaje dla fazy osób. Tabulator to granica komórki: o mieście rozstrzyga ostatnia komórka.
      const lead = capRun.slice(0, capRun.lastIndexOf('\t') + 1);
      const run = capRun.slice(lead.length);
      if (cityRunLooksLikePerson(run, str.slice(Math.max(0, offset - 80), offset) + lead)) return m;
      const rest = cityAtEdge(ctx, run, 'end');
      return rest === null ? m : `${lead}${rest}${ctx.M.MIEJSCOWOSC}${sep}${anchor}`;
    },
  );
  ctx.text = ctx.text.replace(
    RE_CITY_LINE_ABOVE_ADDR,
    (m, lead: string, run: string) => {
      if (!POLISH_CITIES.has(run.toLowerCase().split(/[ \t]+/).join(' '))) return m;
      return `${lead}${ctx.hit('MIEJSCOWOSC')}`;
    },
  );
  ctx.text = ctx.text.replace(
    RE_CITY_AFTER_ADDR,
    (m, adr: string, sep: string, run: string) => maskCityPrefix(ctx, adr + sep, run) ?? m,
  );
}

function maskCityAfterResidenceMarker(ctx: RedactCtx): void {
  // Miejscowość po markerze zamieszkania („zamieszkały w Krakowie").
  ctx.text = ctx.text.replace(RE_CITY_RESIDENCE, (m, marker: string, run: string, offset: number, str: string) => {
    const after = str.slice(offset + m.length, offset + m.length + 80);
    if (residenceIsGeneral(marker, str.slice(Math.max(0, offset - 40), offset), after)) return m;
    // Po czasowniku bez „w" i dwukropka imię zaczyna podmiot („zamieszkuje Jarosław Wilk"), nie miasto:
    // inaczej imię dostałoby maskę miasta, a nazwisko zostałoby jawne. Etykieta „Miejsce
    // zamieszkania⇥Jarosław" podaje miasto.
    if (
      !/^[Zz]am\./.test(marker) &&
      !/(?::|(?<!\p{L})[Ww]e?)[ \t]*$/u.test(marker) &&
      !/(?:zamieszkania|zameldowania|pobytu|urodzenia)[ \t]*$/u.test(marker) &&
      POLISH_FIRST_NAMES.has(run.split(/[ \t]+/)[0].toLowerCase())
    )
      return m;
    const masked = maskCityPrefix(ctx, marker, run);
    if (masked) return masked;
    if (residenceLocativeCity(marker, run, after)) {
      return `${marker}${ctx.hit('MIEJSCOWOSC')}`;
    }
    return m;
  });
}

// Miejscowość po markerze urodzenia, z datą pomiędzy („ur. [DATA-URODZENIA] w Krakowie").
const RE_CITY_AFTER_BIRTH = new RegExp(
  // jedno łamanie wiersza po dacie tylko przed małym „w/we" („ur. [DATA] r.⏎w Sosnowcu"); „r.⏎W …"
  // zaczyna nowe zdanie. Forma osobowa („urodziłam się [DATA] w Łodzi") jak w passBirthDate.
  `\\b((?:[Uu]r\\.|[Uu]rodzon[a-ząę]+|[Uu]rodzi(?:ł(?:a|am|em|aś|eś|o|y|i)?|liśmy|łyśmy)[ \\t]+się)[ \\t]+(?:(?:dnia|w[ \\t]+dniu)[ \\t]+)?` +
    `(?:${DUR_MASK_SRC}[ \\t]*r?\\.?,?(?:[ \\t]*\\r?\\n[ \\t]*(?=we?[ \\t])|[ \\t]*))?[Ww]e?[ \\t]+)` +
    `(${CITY_RUN})${CITY_END}`,
  'g',
);
// Etykieta łączona „Data i miejsce urodzenia:", miasto przed datą albo za nią („…: 12.04.1985,
// Kielce"). Tylko słownik: „Data i miejsce urodzenia Kandydata podaje się w CV" nie daje maski.
const RE_CITY_AFTER_BIRTH_COMBO = new RegExp(
  `\\b(${BIRTH_COMBO}[ \\t]*:?\\s*(?:${DUR_MASK_SRC}[ \\t]*(?:r\\.)?(?:[ \\t]*,[ \\t]*|[ \\t]+)(?:[Ww]e?[ \\t]+)?)?)` +
    `(${CITY_RUN})(?=[ \\t.,;:?!)(\\r\\n]|$)`,
  'g',
);
function maskCityAfterBirthMarker(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_CITY_AFTER_BIRTH,
    (m, marker: string, run: string, offset: number, str: string) => {
      if (/^urodzi/i.test(marker) && !birthVerbAboutPerson(marker, str.slice(Math.max(0, offset - 320), offset))) return m;
      // biogram postaci historycznej: rok sprzed 1900 w tym samym zdaniu („Mikołaj Kopernik urodził się
      // w Toruniu w 1473 r."), jak dla daty w passBirthDate
      if (/^urodzi/i.test(marker) && RE_PRE1900_YEAR.test(sentenceAround(str, offset, offset + m.length))) return m;
      return maskCityPrefix(ctx, marker, run) ?? m;
    },
  );
  ctx.text = ctx.text.replace(RE_CITY_AFTER_BIRTH_COMBO, (m, marker: string, run: string) => maskCityPrefix(ctx, marker, run) ?? m);
}

export function passCity(ctx: RedactCtx): void {
  if (!ctx.on('MIEJSCOWOSC')) return;
  maskCityAfterPostalCode(ctx);
  maskCapsCityAfterPostalCode(ctx);
  maskCityInCsvAndTerytFields(ctx);
  maskCityNextToAddress(ctx);
  maskCityAfterResidenceMarker(ctx);
  maskCityAfterBirthMarker(ctx);
}
