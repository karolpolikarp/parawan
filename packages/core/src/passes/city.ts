import { HOMOGRAPH_SURNAMES, NON_SURNAME_ADJ, looksLikeSurname, surnameBase } from '../surnames.js';
import { CAP_CITY, CITY_START, escapeRe, PL_LO, PL_UP, RE_CHAR_LL } from '../charset.js';
import { cityByPrefix, cityBySuffix, type RedactCtx } from '../context.js';
import { FORM_LABEL_WORDS } from '../dict/forms.js';
import { isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { MULTIWORD_CITIES, POLISH_CITIES } from '../dict/places.js';
import { saintWithContext } from '../guards/eponyms.js';
import { LEGAL_ENTITY_WORDS, PARTY_ROLE_WORDS, ROLE_WORDS } from '../guards/roles.js';
import { BIRTH_COMBO, birthVerbAboutPerson, RE_PRE1900_YEAR, sentenceAround } from './birth-date.js';
import { isConfirmedSurname } from './forms.js';
import { precededByLegalRef } from '../validators.js';


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
export function passCity(ctx: RedactCtx): void {
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
