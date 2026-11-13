// Adresy: ulice ze skrótem i bez, ulice z patronem w dopełniaczu, adres po etykiecie zamieszkania
// i przed kodem pocztowym, kod pocztowy bez myślnika.
import { surnameShaped } from '../surnames.js';
import { ADR_MASK_SRC, CAP_CITY, KOD_MASK_SRC, MONTHS_GEN, PL_LO, PL_UP } from '../charset.js';
import { indexToLetters, INSTITUTION_STREET_CLOSE, INSTITUTION_STREET_OPEN, lettersToIndex, maskKeepPrefix, PATRON_STREET_MARK, RE_INSTITUTION_STREET_SENTINEL, type RedactCtx } from '../context.js';
import { isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { egoNameGenitive, RE_STREET_WORD, STREET_RANK_WORDS } from '../guards/eponyms.js';
import { institutionStreetAt, STREET_SRC } from '../guards/institution-address.js';
import { ADDR_PLACE_ADJ_OK, institutionBeforeAddr, PATRON_GEN_HEADS, RE_CAPS_WORK_HEAD, RE_PERSON_MASK_BEFORE } from '../guards/person-context.js';
import { monthAhead, RE_PATRON_ROMAN_REF_BEFORE, RE_QUANTITY_AFTER } from '../guards/address-context.js';
import { LEGAL_ENTITY_WORDS } from '../guards/roles.js';
import { RE_SURNAME_OBLIQUE } from '../person-patterns.js';
import { countOf } from '../util.js';

// Silna etykieta adresu przed „ul. …": po niej niejednoznaczny numer zostaje numerem domu. Także
// z dopowiedzeniem przed dwukropkiem („Adres do korespondencji:") i „zamieszkały przy".
const RE_STRONG_ADDR_LABEL =
  /(?:adres\p{L}*(?:[ \t]+\p{Ll}+){1,3}[ \t]*:|adres\p{L}*|zam\.|zamieszka\p{L}*|zameldowan\p{L}*)[ \t]*:?(?:[ \t]+(?:przy|na|w))?[ \t]*$/iu;
// „mieszka przy …" jest słabsze od etykiety: liczebnik za nazwą dalej bywa ilością („Mieszkał
// w Alejach Ujazdowskich 3 miesiące"), ale proza za numerem nie odbiera adresu osobie.
const RE_RESIDENCE_BEFORE = /(?<!\p{L})mieszka(?:ł[aoy]?|li|ją|jąc[aey]?|m|sz|my|cie)?[ \t]+(?:przy|na|w)[ \t]+$/iu;
// Imię i nazwisko tuż przed adresem bez etykiety („Jan Nowak, Aleje Jerozolimskie 44 tel. …") to
// adres tej osoby, choć za numerem stoi proza. Para musi mieć imię ze słownika („Rada Miasta" odpada).
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
// Osoba po etykiecie tuż przed adresem („Odbiorca: Jan Kowalski, ul. …") przesądza o adresie jak
// silna etykieta. Tylko imię z nazwiskiem: miejscowość czy urząd po etykiecie („Miejsce: Warszawa,
// plac Piłsudskiego 11 listopada") nie robią z dnia numeru domu.
const RE_LABELED_NAME_BEFORE_ADDR = /:[ \t]*(\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*){1,3})[ \t]*,[ \t]*$/u;
function labeledPersonBeforeAddr(before: string): boolean {
  const run = RE_LABELED_NAME_BEFORE_ADDR.exec(before)?.[1];
  if (!run) return false;
  const ws = run.toLowerCase().split(/[ \t]+/);
  return ws.some((w) => POLISH_FIRST_NAMES.has(w)) && !ws.some((w) => LEGAL_ENTITY_WORDS.has(w));
}
// Numer domu przed dniem albo rokiem daty („ul. Polna 15 1998 r."): maska kończy się na numerze
// domu, a data zostaje za nią.
const RE_HOUSE_NO_BEFORE_DATE = /^(.*[ \t]\d+[A-Za-z]?)([ \t]+\d{1,4})$/;
// To samo przed pełną datą z godziną („ul. Krótka 8 2024-05-12 10:20"): data wchodzi w człon nazwy,
// a godzina udaje numer domu, więc cięcie po samym dniu albo roku nie trafia.
const RE_HOUSE_NO_BEFORE_DATETIME =
  /^(.*[ \t]\d+[A-Za-z]?(?:\/\d+[A-Za-z]?)?)([ \t]+(?:(?:19|20)\d{2}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.(?:19|20)\d{2})(?:[ \t]+\d{1,2})?)$/;
// Numer domu po wyrazie nazwy, a za nim kropka i wielka litera następnego zdania.
const RE_HOUSE_NO_SENTENCE_END = new RegExp(`(?<=[${PL_LO}])[ \\t]+\\d{1,4}[A-Za-z]?(?=\\.[ \\t]+[${PL_UP}][${PL_LO}])`);
// Numer domu, także zakres bez odstępów („Hoża 41-43"). Pierwszy człon zakresu najwyżej trzycyfrowy:
// „przy ul. Okopowej 1944-1956" to lata, nie numery.
const ADDR_HOUSE = String.raw`\d+[A-Za-z]?(?:(?<!\d{4})[-–]\d{1,3}[A-Za-z]?(?!\d))?`;
const RE_YEAR_TAIL = /[ \t](?:19|20)\d{2}$/;
// Numer lokalu nie zaczyna dłuższego wyrazu („mieszkanie 3-pokojowe"), nie jest metrażem („lokal
// 120 m2", „lokal 32,4 m2") ani początkiem dłuższej liczby (cofanie skróciłoby „120" do „12").
const ADDR_UNIT_END = String.raw`(?![-–]?[${PL_LO}${PL_UP}]|\d|[,.]\d|[ \t]*(?:m2|m²|mkw|m\.?[ \t]*kw))`;
// Lokal: „/3", „m. 3", „lok. 3", po przecinku („Długa 5, m. 3"), słowem („lokal 3", „mieszk. 3")
// i z drugim członem („84/92 lok. 105", „m. 3/4", „lok. 2 i 3"). Warianty z przecinkiem i słowem
// tylko w obrębie wiersza: przez nową linię lokal sklejałby się z następnym wpisem.
// „i N" nie przed wyrazem: „m. 3 i 2 dzieci" to lokal i liczebnik.
const ADDR_UNIT_WORD_NO = String.raw`\d+[A-Za-z]?(?:[ \t]*\/[ \t]*\d{1,3}[A-Za-z]?|[ \t]+i[ \t]+\d{1,3}[A-Za-z]?(?![ \t]+[${PL_LO}]{3}))?`;
const ADDR_UNIT_INLINE = String.raw`(?:[ \t]*\/[ \t]*\d+[A-Za-z]?|(?:[ \t]*(?:m\.?|lok\.?)[ \t]*|[ \t]*,[ \t]*(?:m\.?|lok\.?|lokal|mieszk\.?)[ \t]*|[ \t]+(?:lokal|mieszk\.?)[ \t]*)${ADDR_UNIT_WORD_NO})${ADDR_UNIT_END}`;
const ADDR_UNIT = String.raw`(?:\s*(?:\/\s*\d+[A-Za-z]?|(?:m\.?|lok\.?)\s*${ADDR_UNIT_WORD_NO})${ADDR_UNIT_END}|${ADDR_UNIT_INLINE})?(?:${ADDR_UNIT_INLINE})?`;
// Jawny człon lokalu („/3", „m. 3", „mieszk. 5") rozstrzyga, że liczba przed nim to numer domu,
// a nie liczebnik.
const RE_ADDR_HAS_UNIT = /\d[A-Za-z]?[ \t]*\/[ \t]*\d|(?<![\p{L}])(?:m\.?|lok\.?|lokal|mieszk\.?)[ \t]*\d/u;
// Łącznik małą literą przed ostatnim członem nazwy ulicy („Żwirki i Wigury", „Bitwy pod Płowcami").
// „z/ze" nie przed narzędnikiem: „na ul. Długiej z Kowalskim 5 razy" to osoba. Nie po liczbie ani
// numerze z literą: w „przy ul. Polnej 5 i Leśnej 7" liczba to numer domu pierwszego adresu.
const ADDR_CONNECTOR_WORDS = 'i|pod|nad|de|von|van|der|da|di|du|la|le';
const ADDR_CONNECTOR = String.raw`(?:(?<!\d[A-Za-z]?)[ \t]+(?:${ADDR_CONNECTOR_WORDS}|(?:z|ze)(?![ \t]+[${PL_UP}][${PL_LO}${PL_UP}]*(?:em|ą|ami|im|ym|imi|ymi)(?![${PL_LO}])))[ \t]+[${PL_UP}][${PL_LO}${PL_UP}.-]*)?`;
// „Aleje/Alejach" w liczbie mnogiej to częściej nazwa wystawy czy imprezy niż ulica: sam rok za
// nią nie jest numerem domu („Aleje Ujazdowskie 2024 to tytuł wystawy").
const RE_ALEJE_PLURAL = /^alej(?:e|ach)$/i;
// „Aleje/Alejach/Aleją" to słabszy prefiks niż „ul."/„al.": „W Alejach Jerozolimskich 3 wypadki" to
// miejsce zdarzenia. Małą literą to rzeczownik pospolity („w alejach Zasłużonych 15 grobów"), więc
// adresem jest tylko po etykiecie albo z lokalem.
const RE_ALEJE_WEAK = /^alej(?:e|ach|ą)$/i;
const RE_ALEJE_WEAK_LOWER = /^alej(?:e|ach|ą)$/;
// Mianownik liczby mnogiej stoi po liczebniku tylko po 2–4 (bez 12–14): „22 osoby" to ilość, ale
// „Przy ul. Polnej 15 mieszkańcy skarżą się" to numer domu i podmiot zdania.
const RE_QUANTITY_NOM_PL = new RegExp(
  '^[ \\t]+(?:tysiące|osoby|uczestni(?:cy|czki)|demonstran(?:ci|tki)|samochody|pojazdy|minuty|godziny|sekundy|lata|' +
    'miesiące|tygodnie|wieki|metry|kilometry|uczniowie|pracownicy|mieszkańcy|artystki|biegacze|kierowcy|pasażerowie|' +
    'sklepy|domy|pokoje|pomniki|autobusy|tramwaje|ambasady|pasy|drzewa|klony|latarnie|kawiarnie|punkty)(?!\\p{L})',
  'u',
);
const RE_TIME_QUANTITY_AFTER = /^[ \t]+(?:minut|godzin|sekund|dni|dob|dób|lat(?!\p{L})|lata|miesi|tygodni|wiek|razy)/u;
// Rzeczownik z orzeczeniem w liczbie mnogiej („ul. Polnej 5 dzieci bawiły się") to podmiot, nie
// dopełniacz po liczebniku: po liczebniku od pięciu orzeczenie stoi w liczbie pojedynczej („5 dzieci
// bawiło się"). Nie dla miar czasu: w „przy ul. Polnej 7 lat mieszkali" orzeczenie ma inny podmiot.
const RE_PLURAL_VERB_AFTER_NOUN = /^[ \t]+\p{Ll}+[ \t]+(?:nie[ \t]+)?(?:są|\p{Ll}{2,}(?:ją|ą|ły|li))(?!\p{L})/u;
function quantityAfter(m: string, rest: string): boolean {
  if (!RE_QUANTITY_AFTER.test(rest)) return false;
  const n = Number(/(\d+)\D*$/.exec(m)?.[1] ?? '0');
  const few = n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14);
  // po 2–4 liczba mnoga orzeczenia zgadza się z liczebnikiem („3 osoby mieszkają")
  if (!few && n > 1 && RE_PLURAL_VERB_AFTER_NOUN.test(rest) && !RE_TIME_QUANTITY_AFTER.test(rest)) return false;
  if (!RE_QUANTITY_NOM_PL.test(rest)) return true;
  return few;
}
// Rzeczownik z dwukropkiem i wartością („ul. Polna 5 dzieci: 2") to etykieta następnego pola
// formularza spłaszczonego do wiersza, nie liczebnik. W prozie po dwukropku idzie zwykle wyliczenie
// małą literą („3 wypadki: dwa na …").
const RE_FIELD_LABEL_AFTER =
  /^[ \t]+\p{Ll}+\.?(?:[ \t]+\p{Ll}+\.?){0,2}[ \t]*:[ \t]*(?:\d|\p{Lu}|(?:tak|nie|brak)(?!\p{L}))/u;
// Godzina za nazwą ulicy („przy ul. Polnej i Leśnej 18:00") to nie numer domu.
const RE_TIME_AFTER = /^[:.][0-5]\d(?!\d|[.:]\d)/;
// Dalszy ciąg liczby za numerem: grupa tysięcy, ułamek, procent, wymiar.
const RE_NUMERIC_TAIL_AFTER = /^(?:[ \t]\d{3}(?!\d)|[,.]\d|[ \t]*%|x\d|\+\d)/;
// Łącznik w nazwie ulicy: sam rok za taką nazwą to data albo wyliczenie ulic („ul. Długiej
// i Krótkiej 2026 — harmonogram"), nie numer domu.
const RE_ADDR_CONNECTOR_USED = new RegExp(`[ \\t](?:${ADDR_CONNECTOR_WORDS}|z|ze)[ \\t]+[${PL_UP}]`);
const RE_ADDR_CONNECTOR_I = new RegExp(`[ \\t]i[ \\t]+[${PL_UP}]`);
// Skrzyżowanie przed skrótem ulicy („na rogu ul. Mickiewicza i Słowackiego"): „X i Y" to dwie ulice,
// a nie jedna nazwa z łącznikiem.
const RE_CROSSING_BEFORE = /(?<!\p{L})(?:skrzyżowani\p{L}*|zbieg\p{L}*|rogu|róg|rejonie|okolic[ay]|między|pomiędzy)[ \t]+$/iu;
// Wyraz małą literą za numerem po słabym prefiksie (łącznik w nazwie, „Aleje") to proza, a liczba
// to liczebnik („W Alejach Jerozolimskich 3 wypadki"). Adres ciągną dalej tylko miejscowość („… 16
// w Warszawie"), kolejny numer („… 15 i 17") albo człon zapisu adresu i kontaktu („tel.", „piętro").
const RE_PROSE_AFTER_WEAK = new RegExp(
  '^[ \\t]+(?!(?:w|we)[ \\t]+\\p{Lu}|(?:i|oraz)[ \\t]+\\d|' +
    '(?:m|lok|kl|p|pok|pię|skr|bud|bl|wej|gm|pow|woj)\\.|' +
    '(?:tel|kom|fax|faks|nr|kod|poczta|lokal|mieszkanie|piętro|klatka|wejście|e-?mail)(?!\\p{L})|' +
    // czasownik zamieszkania za numerem to adres osoby („Przy ul. Jana z Kolna 12 mieszka pani …")
    '(?:za)?mieszka(?:ją|ł[aoy]?|li)?(?!\\p{L})|zamieszkuj[eą](?!\\p{L})|zameldowan[aiyoe]\\p{L}*)\\p{Ll}',
  'u',
);
// Lokal słowem po spacji („ul. Długiej 5 lokal 12") w prozie bywa podmiotem z liczebnikiem („Przy
// ul. Długiej 5 lokal 12 lat stał pusty"). Skrót „mieszk." i lokal po przecinku podmiotem nie bywają.
const RE_SPACE_UNIT_TAIL = /(?<=\d[A-Za-z]?)[ \t]+lokal[ \t]*\d+[A-Za-z]?$/;

// Drugi człon wyliczenia za maską adresu bez „ul." musi mieć kształt nazwy ulicy: przymiotnik
// („Leśnej") albo patron w dopełniaczu („Mickiewicza"). Rzeczownik pospolity z numerem to część
// budynku, odsyłacz albo wersja („i Sali 12", „oraz Windows 10"); te na „-a/-i/-y" odsiewa lista.
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
    // pomieszczenia i budynki obok adresu („lokal przy ul. Długiej 5 oraz Piwnicy 3")
    'piwnicy piwnica szkoły szkoła przychodni przychodnia apteki apteka kaplicy kaplica stacji stacja ' +
    'kamienicy kamienica oficyny oficyna galerii galeria wieży wieża furtki furtka skrytki skrytka szafki ' +
    'szafka ławki ławka bazy baza mety meta hurtowni hurtownia ' +
    // narzędnik po „z ul. … i …" („Salą 3", „Klatką 2")
    'salą halą klatką bramą stroną szafą kasą linią strefą grupą działką'
  ).split(' '),
);
// Biernik albo narzędnik przymiotnika („na ul. Słoneczną 2 i Kwiatową 14") tylko po przyimku
// rządzącym tym przypadkiem, zgodnie z pierwszą ulicą.
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
// Koniec adresu: separator, kropka zdania, koniec wiersza albo „w Mieście".
const ADDR_END_AHEAD = String.raw`(?=[ \t]*(?:[,;)]|\.(?!\d)|\r?\n|$)|[ \t]+we?[ \t]+\p{Lu})`;
// Adres bez „ul." po etykiecie zamieszkania („Adres zamieszkania: Lipowa 14/3, Gdańsk", „zam. Rynek
// 15 m. 3 w Krakowie"). Silna etykieta wystarcza; słaba („Adres:" albo „zam.", które bywa też
// „zamówieniem") wymaga lokalu albo miejscowości ze słownika. Goły rok w miejscu numeru odpada.
const RE_ADDR_AFTER_LABEL = new RegExp(
  String.raw`(?<!\p{L})(?:((?:[Aa]dres|ADRES|[Mm]iejsce|MIEJSCE)[ \t]+(?:zamieszkania|zameldowania|pobytu|ZAMIESZKANIA|ZAMELDOWANIA|POBYTU)|[Aa]dres[ \t]+(?:do[ \t]+)?korespondenc\p{Ll}*|[Zz]amieszka(?:ły|ła|li|łe)|[Zz]ameldowan[aey])|((?<![Nn]r[ \t]{0,3})(?:[Aa]dres(?=[ \t]*:)|zam\.)))` +
    String.raw`([ \t]*:?[ \t]*)(?:(\p{Lu}\p{Ll}+(?:[ \t-]\p{Lu}\p{Ll}+)?)([ \t]*,[ \t]*))?` +
    String.raw`(\p{Lu}[\p{Ll}.-]+(?:[ \t]+(?:\p{Lu}[\p{Ll}.-]+|[IVX]{1,4}|i)){0,3})([ \t]+)` +
    String.raw`(\d{1,4}[a-zA-Z]?(?:[/-]\d{1,4}[a-zA-Z]?)?(?:[ \t]*(?:m\.|lok\.|m)[ \t]*\d{1,3}[a-zA-Z]?)?)` +
    ADDR_END_AHEAD,
  'gu',
);
// Pierwszy wyraz, który po etykiecie adresu nie jest nazwą ulicy ani miejscowości.
const ADDR_LABEL_VALUE_STOP = new Set<string>(
  (
    'sala sali pokój pokoju budynek budynku piętro piętra brama pkt art rozdział załącznik windows wersja tel telefon nr numer kod ' +
    // odsyłacz formularza („Adres zamieszkania: Rubryka 7.", „Zamieszkała: Lat 5.")
    'rubryka rubryki rubryce strona stronie str poz pozycja tabela tabeli wariant formularz formularza wiersz wiersza ' +
    'kolumna kolumny wzór wzoru krok pole pola część ust par lat lata etap okres klasa grupa typ model ' +
    // odsyłacz do akt i druku („Adres zamieszkania: Paragraf 2.", „… Tom 2.")
    'paragraf paragrafu tom tomu karta karty dział działu księga księgi arkusz arkusza wpis wpisu druk druku ' +
    'akta akt według wg patrz jw'
  ).split(' '),
);
const RE_ADDR_CITY_AFTER = /^[ \t]*,[ \t]*(?:\d{2}-\d{3}[ \t]+)?(?:(gm\.)|(\p{Lu}\p{Ll}+(?:[ \t-]\p{Lu}\p{Ll}+)?))/u;
// Ulica z patronem w dopełniaczu bez „ul." („Jana Pawła II 14/3, Gdańsk", „Kardynała Stefana
// Wyszyńskiego 12"): opcjonalny tytuł, imię patrona, drugie imię, człon w dopełniaczu, liczba
// rzymska i numer domu. Środkowy wyraz też musi być dopełniaczem imienia.
const PATRON_STREET_TITLES =
  String.raw`Kardynała|Marszałka|Prymasa|Generała|Gen\.|Ks\.|Księdza|Biskupa|Króla|Hetmana|Prezydenta|Prof\.|Profesora|Dr\.|Doktora|Majora|Pułkownika|Rotmistrza|Kapitana|Porucznika`;
// Odstępy w nazwie i przed numerem tylko spacjami: tabulator to granica komórki TSV, a liczba
// z sąsiedniej komórki („SP nr 1⇥Jana Pawła II⇥12") to nie numer domu.
const PATRON_STREET_NAME_SRC = String.raw`(?<![\p{L}\p{N}])(?:(?<!\.)|(?<=(?<!\p{L})im\.))(?:(?:${PATRON_STREET_TITLES}) +)?(\p{Lu}\p{Ll}+)(?: +(\p{Lu}\p{Ll}+))? +(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)`;
const PATRON_STREET_HEAD_SRC = PATRON_STREET_NAME_SRC + String.raw`(?: +[IVX]{1,4})?`;
// Liczba przed jednostką powierzchni („Mieszkanie Jana Nowaka 48 m2", „… 2 ha") to metraż, a „m"
// bez kropki to lokal tylko ze spacją przed numerem („30 m 2"). Lokal „m."/„lok." także wersalikami.
const PATRON_STREET_NUM_SRC = String.raw` +\d{1,4}[a-zA-Z]?(?: ?[/-] ?\d{1,4}[a-zA-Z]?)?(?: *(?:[mM]\.(?= *\d)|[mM](?= +\d)(?! +\d{1,3} *(?:cm|mm)(?![\p{L}\p{N}]))|[lL][oO][kK]\.|[lL]okal(?:u)?|LOKAL(?:U)?) *\d{1,3}[a-zA-Z]?)?(?! *(?:[mM]2|[mM]²|[mM][kK][wW]|[mM]\.? ?[kK][wW]\.?|ha)(?![\p{L}\p{N}]))`;
const PATRON_STREET_SRC = PATRON_STREET_HEAD_SRC + PATRON_STREET_NUM_SRC;
// Po etykiecie adresu, zamieszkania albo „przy" ulica z numerem w dowolnym otoczeniu: miasto, kod,
// „nr", myślnik czy imię kolejnej osoby za numerem („zamieszkały przy Jana Pawła II nr 14").
const RE_PATRON_STREET_NO_CTX = new RegExp(
  String.raw`${PATRON_STREET_HEAD_SRC}(?: +(?:pod +)?nr\.?)?${PATRON_STREET_NUM_SRC}(?![\p{L}\p{N}])`,
  'gu',
);
// To samo wersalikami („W LOKALU PRZY JANA PAWŁA II 30/2 W GORLICACH") z tą samą kotwicą co tryb
// „ctx". Drugi człon nie bywa liczbą rzymską (ta stoi za nim). Bez kotwicy para zostaje osobą.
const RE_PATRON_STREET_CAPS = new RegExp(
  String.raw`(?<![\p{L}\p{N}.])(\p{Lu}{2,})(?: +(\p{Lu}{2,}))? +(?![IVX]{1,4}(?!\p{L}))(\p{Lu}{2,}(?:-\p{Lu}{2,})?)(?: +[IVX]{1,4})?(?: +(?:POD +)?NR\.?)?${PATRON_STREET_NUM_SRC}(?![\p{L}\p{N}])`,
  'gu',
);
const RE_PATRON_STREET_NO = new RegExp(PATRON_STREET_SRC + ADDR_END_AHEAD, 'gu');
// To samo z dalszym ciągiem zdania za numerem („zamieszkały przy Jana Pawła II 14 zwrócił się …").
// Tylko po etykiecie zamieszkania, adresu albo „przy" (patrz classifyPatronStreet): bez nich liczba
// z rzeczownikiem („Głosowało na Tomasza Mazura 12 radnych") to osoba.
const RE_PATRON_STREET_NO_LOOSE = new RegExp(String.raw`${PATRON_STREET_SRC}(?= +\p{Ll})`, 'gu');
// Data, jednostka albo krotność tuż za numerem („Jana Pawła II 5 egz.", „… 5 lat") należą do zdania,
// nie do adresu. Tylko w tej samej komórce: w „Adres:⇥Jana Pawła II 14⇥Miejsc.:⇥Kielce" „Miejsc."
// to następna etykieta.
const RE_PATRON_NUM_UNIT_AFTER = new RegExp(
  String.raw`^ *(?:${MONTHS_GEN}|r\.|roku|lat|lata|zł|osób|os\.|egz\.?|egzemplarz\p{L}*|razy|raz|szt\.?|sztuk\p{L}*|pkt|punkt\p{L}*|proc\p{L}*|%|tys\.?|godz\p{L}*|min\.?|minut\p{L}*|sekund\p{L}*|dni|tygodni\p{L}*|miesięc\p{L}*|km|metr\p{L}*|m(?! *[.\d])|m +\d{1,3} *(?:cm|mm)|cm|mm|klas\p{L}*|uczni\p{L}*|miejsc\p{L}*)(?!\p{L})`,
  'iu',
);
// Ułamek w kontekście udziału („Udział Marii Lis 1/4”) to nie numer domu.
const RE_SHARE_BEFORE = /(?<!\p{L})(?:udzia\p{L}*|częś\p{L}*|spad[ek]\p{L}*|przypad\p{L}*|dziedzicz\p{L}*|nabył\p{L}*|nabyła)(?!\p{L})/iu;
// Patron z liczbą rzymską i numerem domu („Jana Pawła II 5/2") to nazwa ulicy: żywa osoba nie nosi
// liczby rzymskiej, a papież nie ma numeru domu. Za numerem koniec wiersza, zdania albo komórki,
// separator, „w Mieście" albo miejscowość (sprawdza ją patronStreetRomanOrPerson w słowniku), a nie dalszy ciąg zdania
// („pontyfikat Jana Pawła II 26 lat").
const RE_PATRON_STREET_ROMAN = new RegExp(
  PATRON_STREET_NAME_SRC +
    ' +[IVX]{1,4}' +
    String.raw`(?:,? +(?:pod +)?nr\.?)?` +
    PATRON_STREET_NUM_SRC +
    String.raw`(?![\p{L}\p{N}/])(?=\t| *(?:[,;:)(\-–—"|]|\.(?!\d)|\r?\n|$)|[ \t]+we?[ \t]+\p{Lu}| +\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)? *(?:[,;|\t]|\r?\n|$))`,
  'gu',
);
// Przed patronem z liczbą rzymską bez kotwicy adresu tylko początek wiersza albo komórki czy
// separator („Kraków, …", „Jan Nowak – …"). Wyraz przed nim to odsyłacz albo tytuł („Treny Jana
// Kochanowskiego II 3."), chyba że to imię i nazwisko osoby (patrz personPairBeforeAddr).
const RE_PATRON_ROMAN_BOUNDARY = /(?:^|[\r\n\t;,(–—"„“”«»'|]|[ \t]-)[ \t]*$/u;
const RE_PATRON_STREET_TITLE_HEAD = new RegExp(String.raw`^(?:${PATRON_STREET_TITLES})[ \t]`, 'u');
// Lokal „m."/„lok." w dopasowaniu („Tomasza Mazura 12 m. 3") to kształt adresu sam w sobie, w każdym
// trybie. „m" bez kropki tylko z odstępem przed numerem: „48 m2" to powierzchnia.
const RE_PATRON_STREET_FLAT = /[ \t]\d{1,4}[a-zA-Z]?[ \t]*(?:m\.[ \t]*|m[ \t]+|lok\.[ \t]*|lokalu?[ \t]*)\d{1,3}[a-zA-Z]?$/i;
// Sam ukośnik wygląda jak udział czy ocena („Ocena Tomasza Mazura 3/5"), więc wskazuje adres dopiero
// z miejscowością za numerem. Rok po ukośniku („12/2020") to sygnatura albo numer pisma.
const RE_PATRON_STREET_SLASH = /[ \t](\d{1,4})[a-zA-Z]?\/(?!(?:19|20)\d\d(?!\d))(\d{1,4})[a-zA-Z]?$/;
// Lokal „m./lok." albo ułamek niewłaściwy („30/2"): udział, ocena czy wynik osoby to ułamek właściwy
// („1/2", „12/40"), więc licznik większy od mianownika to numer lokalu.
function patronStreetFlatNo(m: string): boolean {
  if (RE_PATRON_STREET_FLAT.test(m)) return true;
  const f = RE_PATRON_STREET_SLASH.exec(m);
  return !!f && +f[1] > +f[2];
}
// Etykieta adresu albo zamieszkania tuż przed ulicą („zamieszkały przy Kazimierza Wielkiego 5") sama
// wskazuje adres; rdzenie zamiast końcówek („położony przy", „znajdującej się przy") i „pod adresem".
// „mieszka na …" tylko z czasownikiem („mieszkanie na Jana Kowalskiego 1/2" to udział), a „zamieszkały
// w Lubniu, …" z miejscowością i przecinkiem przed ulicą. Etykiety także wersalikami („ZAM.").
const RE_PATRON_STREET_RESIDENCE =
  /(?<!\p{L})(?:[Zz]am(?:\.|(?=[ \t]*:))|ZAM(?:\.|(?=[ \t]*:))|(?:[Zz]a)?[Mm]ieszk\p{L}*|(?:ZA)?MIESZK\p{Lu}*|[Zz]ameldowan\p{L}*|ZAMELDOWAN\p{Lu}*|[Pp]ołożon\p{L}*|POŁOŻON\p{Lu}*|[Uu]sytuowan\p{L}*|USYTUOWAN\p{Lu}*|[Zz]najduj\p{L}*(?:[ \t]+się)?|ZNAJDUJ\p{Lu}*(?:[ \t]+SIĘ)?)(?:[ \t]*:|[ \t]+[-–—])?(?:[ \t]+(?:przy|PRZY))?[ \t]*$|(?<!\p{L})(?:[Pp]od[ \t]+[Aa]dresem|POD[ \t]+ADRESEM)[ \t]*:?[ \t]*$|(?<!\p{L})(?:[Zz]a)?[Mm]ieszk(?:a|am|asz|amy|acie|ają|ał\p{L}*|uj\p{L}*)[ \t]+[Nn]a[ \t]+$|(?<!\p{L})(?:(?:[Zz]a|ZA)?(?:[Mm]ieszk(?:a|am|ają|ając\p{L}*|ał\p{L}*|uj\p{L}*)|MIESZK(?:A|AM|AJĄ|AJĄC\p{Lu}*|AŁ\p{Lu}*|UJ\p{Lu}*))|[Zz]amieszk\p{L}*|ZAMIESZK\p{Lu}*|[Zz]am\.|ZAM\.)[ \t]+(?:we?|WE?)[ \t]+\p{Lu}\p{L}+(?:[ \t-]\p{Lu}\p{L}+)?[ \t]*,[ \t]*$/u;
// Etykieta adresu, także wersalikami, z numerem pola („Adres 2:"), z myślnikiem zamiast dwukropka
// („Adres do doręczeń - ") i sama „Korespondencja:" albo „Doręczyć:".
const RE_PATRON_STREET_LABEL =
  /(?<!\p{L})(?:(?:[Aa]dres\p{L}*|ADRES\p{Lu}*|[Kk]orespondencj\p{Ll}*|KORESPONDENCJ\p{Lu}*|[Dd]oręczyć|DORĘCZYĆ)(?:[ \t]+(?:\p{Ll}+|\p{Lu}+|\d{1,2})){0,3}(?:[ \t]*:|[ \t]+[-–—]))[ \t]*$/u;
// Klucz adresu w logu albo JSON-ie przed wartością, także z miejscowością przed ulicą („street="Jana
// Pawła II 5/2"", „"partyAddress":"Lubień, Jana Pawła II 30/2""); passStructured zna tylko klucze
// STRUCT_KEYS w JSON i XML. Bez adresata, adresu IP, MAC i poczty.
const RE_PATRON_STREET_KEY =
  /(?<![\p{L}\p{N}_])([\p{L}_]*(?:[Ss]treet|STREET|[Aa]ddr(?:ess)?|ADDR(?:ESS)?|[Aa]dres|ADRES|[Uu]lic[ay]|ULIC[AY])[\p{L}\p{N}_]*)["']?[ \t]*[:=][ \t]*["']?(?:\p{Lu}\p{Ll}+(?:[ \t-]\p{Lu}\p{Ll}+)?,[ \t]*)?$/u;
const RE_PATRON_STREET_KEY_NOT = /adresat|(?:ip|mac|e?mail|web|url|wallet|server|host)_?addr/i;
const patronStreetKeyBefore = (before: string): boolean => {
  const k = RE_PATRON_STREET_KEY.exec(before)?.[1];
  return !!k && !RE_PATRON_STREET_KEY_NOT.test(k);
};
// Komórka CSV/TSV z samą ulicą z lokalem, a w sąsiedniej komórce miejscowość albo kod pocztowy
// („"Jana Pawła II 5/2","Lubień""). Przecinek w prozie („Oceny: Jana Kowalskiego 3/5, Anny Nowak
// 4/5") nie jest granicą komórki; goły przecinek bez odstępu tylko w wierszu, który wygląda na CSV
// (co najmniej dwa takie przecinki i żadnego „, "). Ułamek właściwy osoby nie przechodzi (patrz
// patronStreetFlatNo).
const RE_PATRON_CELL_BEFORE = /(?:(?:^|[\r\n\t;,])"|[\t;]|^|[\r\n])$/;
const RE_PATRON_CELL_AFTER = /^(?:"(?=[\t;,]|\r?\n|$)|(?=[\t;]))/;
const RE_PATRON_CELL_PLACE = /^"?\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?"?$/u;
const RE_PATRON_CELL_POSTAL = new RegExp(String.raw`^"?(?:\d{2}-\d{3}|${KOD_MASK_SRC})"?$`);
// kod pocztowy albo jego maska za przecinkiem lub w następnym wierszu
const RE_PATRON_POSTAL_AFTER = new RegExp(String.raw`^[ \t]*(?:,[ \t]*|\r?\n[ \t]*)(?:\d{2}-\d{3}|${KOD_MASK_SRC})`);
// Kolejna ulica w wyliczeniu za zamaskowanym adresem („Mieszkańcy [ADRES] i Jana Pawła II 7").
const RE_PATRON_ENUM_BEFORE = new RegExp(String.raw`${ADR_MASK_SRC}[ \t]*(?:,|i|oraz)[ \t]+$`, 'u');
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
  // sąsiednia komórka za separatorem albo przed nim
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
// Miejscowość na początku wiersza i przecinek przed ulicą („Lubień, Jana Pawła II 30/2"), bez
// udziału, oceny czy imienia przed przecinkiem.
const RE_PATRON_CITY_LEAD = /(?:^|[\r\n])[ \t]*(\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?)[ \t]*,[ \t]*$/u;
// Bez liczby rzymskiej (tę rozstrzyga RE_PATRON_STREET_ROMAN) tylko z lokalem albo ułamkiem
// niewłaściwym: „Kraków, Jana Kowalskiego 12" w protokole głosowania to osoba z liczbą głosów.
function patronStreetCityLead(before: string, m: string): boolean {
  const c = RE_PATRON_CITY_LEAD.exec(before)?.[1];
  if (!c || isFirstNameLike(c.split(/[ -]/)[0]) || RE_PATRON_CELL_NOT.test(c)) return false;
  return patronStreetFlatNo(m);
}
// Komórka z samą ulicą z patronem, a numer w sąsiedniej kolumnie („Ulica⇥Nr⏎Jana Pawła II⇥12"). O
// adresie przesądza nagłówek kolumny (najwyższy wiersz bloku z tym samym separatorem) albo etykieta
// w poprzedniej komórce. Maska obejmuje samą komórkę ulicy.
const RE_PATRON_STREET_CELL = new RegExp(String.raw`(?<=^|[\r\n\t;])${PATRON_STREET_HEAD_SRC}(?= *(?:[\t;]|\r?\n|$))`, 'gu');
const RE_STREET_HEADER_NAME = /^[ \t]*"?(?:ulica|ul\.|adres\p{L}*|street|address)(?:[ \t]+(?:i[ \t]+)?(?:nr|numer)\p{L}*\.?)?"?[ \t]*$/iu;
function streetHeaderAbove(t: string, offset: number): boolean {
  const ls = t.lastIndexOf('\n', offset - 1) + 1;
  const pre = t.slice(ls, offset);
  const le = t.indexOf('\n', offset);
  const row = t.slice(ls, le < 0 ? t.length : le);
  const delim = row.includes('\t') ? '\t' : row.includes(';') ? ';' : '';
  if (!delim || ls === 0) return false;
  const col = countOf(pre, delim);
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
// Samo „przy" przed ulicą z numerem („Nieruchomość przy Tadeusza Kościuszki 5"), o ile przed nim
// nie stoi instytucja („Urząd Gminy przy Jana Pawła II 5" to siedziba urzędu).
const RE_PATRON_STREET_PRZY = /(?<!\p{L})(?:[Pp]rzy|PRZY)[ \t]+$/u;
// Koperta wersalikami: „DO" na początku wiersza albo po etykiecie, za numerem koniec wiersza,
// przecinek albo „W <MIEJSCOWOŚĆ>" („DO ADAMA MICKIEWICZA 5"). Z kwotą czy liczbą egzemplarzy za
// numerem („PISMO DO ANNY KOWALSKIEJ 2 EGZ.") to osoba.
const RE_PATRON_STREET_CAPS_DO = /(?:^|\n)(?:[ \t]*|[^\n]*:[ \t]*)DO[ \t]+$/u;
const RE_PATRON_STREET_CAPS_DO_END = /^(?:[ \t]*(?:,|\r?\n|$)|[ \t]+W[ \t]+\p{Lu}{2,})/u;
// Skrót albo wyraz uliczny tuż przed patronem („al. Jana Pawła II nr 5", „ulicy Tadeusza Kościuszki
// 5"): główny przebieg ulic nie zna wariantu z „nr" między nazwą a numerem.
const STREET_WORD_BEFORE_SRC = String.raw`(?<!\p{L})(?:(?:ul|al|pl|os)\.[ \t]*|(?:ulic[aęyą]|alej[aęą]|alei|plac(?:u|em)?|osiedl(?:e|a|u)|rond(?:o|a|zie)|skwer(?:u|ze)?)[ \t]+)(?:(?:im\.|imienia)[ \t]*)?`;
const RE_PATRON_STREET_WORD_BEFORE = new RegExp(`${STREET_WORD_BEFORE_SRC}$`, 'iu');
// Znacznik przed maską adresu z tego przebiegu: tylko on, a nie dosłowne „[ADRES]" z wejścia, wciąga
// skrót ulicy do maski (idempotencja).
const RE_STREET_WORD_BEFORE_MARK = new RegExp(STREET_WORD_BEFORE_SRC + PATRON_STREET_MARK, 'giu');
// Osoba, a za nią myślnik, średnik albo nawias z adresem („Jan Nowak (Jana Pawła II 5)").
const RE_PATRON_STREET_PERSON_SEP = /[ \t]*(?:[–—;(]|[ \t]-)[ \t]*$/u;
// Patron kaplicy czy kościoła („Kaplica św. Jana Pawła II 2") to nie adres osoby.
const RE_PATRON_STREET_SAINT_BEFORE = /(?<!\p{L})(?:św|bł|ks|abp|bp)\.[ \t]*$|(?<!\p{L})święt\p{L}*[ \t]+$/iu;
// Osoba wersalikami tuż przed ulicą („JAN NOWAK ", „NOWAK JAN⇥"): imię w mianowniku ze słownika
// i drugi wyraz w kształcie nazwiska.
function capsPersonPairBefore(before: string): boolean {
  const mm = /(?:^|[^\p{L}])(\p{Lu}{2,}(?:-\p{Lu}{2,})?) +(\p{Lu}{2,}(?:-\p{Lu}{2,})?)[ \t]*$/u.exec(before);
  if (!mm) return false;
  const [a, b] = [mm[1].toLowerCase(), mm[2].toLowerCase()];
  const nom = (w: string): boolean => POLISH_FIRST_NAMES.has(w) && !isFirstNameGenitive(w);
  const sur = (w: string): boolean => !isFirstNameLike(w) && !LEGAL_ENTITY_WORDS.has(w) && surnameShaped(w);
  return (nom(a) && sur(b)) || (sur(a) && nom(b));
}
// Tryby ulicy z patronem: '' adres na końcu zdania albo komórki; „loose" z dalszym ciągiem zdania
// małą literą; „ctx" w dowolnym otoczeniu, ale tylko po kotwicy adresu; „roman" z liczbą rzymską bez
// kotwicy; „fallback" ostatni przebieg, po którym para z numerem nie może zostać jawna w całości.
type PatronStreetMode = '' | 'loose' | 'ctx' | 'roman' | 'fallback';
// Dopasowanie ulicy z patronem razem z otoczeniem, które czytają kroki rozstrzygania.
interface PatronStreetHit {
  m: string;
  w1: string;
  wMid: string | undefined;
  w2: string;
  offset: number;
  t: string;
  mode: PatronStreetMode;
  before: string;
  tail: string;
  headW: string | undefined;
}
// Kształt pary i otoczenie, które wykluczają adres w każdym trybie.
function patronStreetExcluded(h: PatronStreetHit): boolean {
  const { m, w1, wMid, w2, offset, t, before, tail, headW } = h;
  const a = w1.toLowerCase();
  const b = w2.toLowerCase().split('-')[0];
  if (!isFirstNameGenitive(a) && !egoNameGenitive(a)) return true;
  // Drugie imię patrona spoza słownika („Konstantego Ildefonsa Gałczyńskiego 4 lokal 2") tylko
  // z numerem lokalu, który sam przesądza o adresie.
  const mid = wMid?.toLowerCase();
  if (mid !== undefined && !isFirstNameGenitive(mid) && !egoNameGenitive(mid) && !(RE_PATRON_STREET_FLAT.test(m) && /(?:a|ego|i|y)$/.test(mid))) return true;
  if (!(isFirstNameGenitive(b) || egoNameGenitive(b) || RE_SURNAME_OBLIQUE.test(b) || /(?:a|ego|ej|i|y)$/.test(b))) return true;
  // Patron instytucji („Szkoła Podstawowa im. Jana Pawła II 3, Kraków") i rok zamiast numeru domu
  // („dla Jana Kowalskiego 2023, Warszawa") to nie adres: numer domu 1900–2099 jest rzadszy niż data.
  if ((/(?<!\p{L})(?:im\.|imienia)[ \t]*$/u.test(before) && !RE_PATRON_STREET_WORD_BEFORE.test(before)) || /[ \t](?:1[89]|20)\d\d$/.test(m)) return true;
  // Rok po ukośniku („Rondo Adama Mickiewicza 3/2025" to uchwała) i godzina („… 10:00") to nie
  // numer domu ani lokalu.
  if (/\/(?:19|20)\d\d$/.test(m) || /^:\d/.test(t.slice(offset + m.length, offset + m.length + 2))) return true;
  if (RE_PATRON_STREET_SAINT_BEFORE.test(before) || (/,[ \t]*$/.test(before) && institutionBeforeAddr(before))) return true;
  // Jednostka za numerem („… 5 egz.") albo głowa nazwy obiektu przed patronem („Pomnik Jana Pawła
  // II 3, Kraków") to nie adres. „Dom" bywa zwykłym domem osoby, więc nie przesądza.
  if (RE_PATRON_NUM_UNIT_AFTER.test(tail)) return true;
  return !!headW && headW !== 'dom' && PATRON_GEN_HEADS.has(headW);
}
// Etykieta adresu, zamieszkania albo „przy" wygrywa z udziałem na początku zdania („Udziały
// w lokalu przy Jana Pawła II 12/4 należą …"). Koperta i miejscowość przed przecinkiem tylko
// w trybie '': za „Kraków, Jana Kowalskiego 3 lata temu" stoi dalszy ciąg zdania.
function patronStreetAnchored(h: PatronStreetHit): boolean {
  const { m, w1, before, tail, mode } = h;
  const caps = w1 === w1.toUpperCase();
  return (
    RE_PATRON_STREET_LABEL.test(before) ||
    RE_PATRON_STREET_RESIDENCE.test(before) ||
    patronStreetKeyBefore(before) ||
    (patronStreetFlatNo(m) && patronStreetCell(before, tail)) ||
    (mode === '' && (patronStreetEnvelope(before, tail) || patronStreetCityLead(before, m))) ||
    (RE_PATRON_STREET_PRZY.test(before) && !institutionBeforeAddr(before.replace(RE_PATRON_STREET_PRZY, ''))) ||
    (caps && RE_PATRON_STREET_CAPS_DO.test(before) && RE_PATRON_STREET_CAPS_DO_END.test(tail)) ||
    // osoba wersalikami przed ulicą, np. w wyciągu bankowym („PRZELEW OD: STEFAN GÓRSKI JÓZEFA PIŁSUDSKIEGO 101 ŁÓDŹ")
    (caps && w1.length > 1 && (capsPersonPairBefore(before) || RE_PERSON_MASK_BEFORE.test(before))) ||
    // „NA ROGU ADAMA MICKIEWICZA 30" wersalikami to skrzyżowanie ulic; mieszany zapis w prozie nie jest kotwicą
    (caps && /(?<!\p{L})NA[ \t]+ROGU[ \t]+$/u.test(before)) ||
    RE_PATRON_STREET_WORD_BEFORE.test(before) ||
    RE_PATRON_ENUM_BEFORE.test(before)
  );
}
// Bez instytucji przed patronem („Parafia Jana Pawła II 5"), klucza adresu IP czy adresata i roku
// („… 1978-2005"). Parę, którą zamaskuje przebieg osób („Tadeusza Kościuszki 30 w Krakowie."),
// zostawiamy jemu; tu tylko liczba rzymska i dwa imiona („Jana Pawła 12/4"), które dostają maskę
// osoby, a liczba rzymska i numer zostają.
function patronStreetRomanOrPerson(ctx: RedactCtx, h: PatronStreetHit): string | null {
  const { m, w2, before, tail, headW, mode } = h;
  // wyraz z wielkiej litery za numerem tylko jako miejscowość ze słownika
  const cityAfter = mode === 'roman' ? /^ +(\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?) *(?:[,;|\t]|\r?\n|$)/u.exec(tail) : null;
  if (cityAfter && !POLISH_CITIES.has(cityAfter[1].toLowerCase())) return null;
  const k = RE_PATRON_STREET_KEY.exec(before)?.[1];
  if ((k && RE_PATRON_STREET_KEY_NOT.test(k)) || institutionBeforeAddr(before)) return null;
  if (/(?<!\d)(?:1[89]|20)\d\d(?!\d)/.test(m)) return null;
  // odsyłacz w poprzedniej komórce („Pielgrzymka,Jana Pawła II 2 Kraków,1979") to opis wydarzenia
  const refCell = RE_PATRON_ROMAN_REF_BEFORE.test(before.replace(/[ \t]*[,;|\t][ \t]*$/, ' '));
  if (mode === 'roman' && ((RE_PATRON_ROMAN_BOUNDARY.test(before) && !refCell) || personPairBeforeAddr(before))) {
    return ctx.hit('ADRES');
  }
  const roman = / [IVX]{1,4} /.test(m);
  // wyraz uliczny przed patronem („Rondo Jana Pawła II 2 km") oznacza nazwę ulicy, nie osobę
  if (RE_PATRON_ROMAN_REF_BEFORE.test(before) || (headW && RE_STREET_WORD.test(headW)) || !ctx.on('IMIE') || !(roman || isFirstNameLike(w2))) return null;
  const pairEnd = m.indexOf(w2) + w2.length;
  ctx.bump('IMIE');
  return ctx.personMask(w2) + m.slice(pairEnd);
}
// Tryby '' i „loose" bez kotwicy: adres tylko przy miejscowości, kodzie, tytule z miejscowością
// albo osobie tuż przed ulicą.
function patronStreetUnanchored(ctx: RedactCtx, h: PatronStreetHit): string | null {
  const { m, before, tail, headW, mode } = h;
  // Ułamek po udziale albo spadku („Udział Tomasza Mazura 1/3") to część prawa, nie numer lokalu.
  if (/[ \t]\d{1,4}\/\d/.test(m) && RE_SHARE_BEFORE.test(before)) return null;
  // „… 15/2 to adres korespondencyjny": zdanie samo nazywa ulicę adresem.
  if (mode === 'loose') {
    if (!/^[ \t]+(?:to|jest)[ \t]+adres/u.test(tail)) return null;
    return ctx.hit('ADRES');
  }
  // Ułamek właściwy przed gołym przecinkiem CSV („1,Jana Nowaka 4/5,Kraków" pod nagłówkiem „Ocena")
  // to ocena, wynik albo udział osoby, nie numer lokalu.
  if (RE_PATRON_STREET_SLASH.test(m) && !patronStreetFlatNo(m) && /^,(?![ \t])/.test(tail)) return null;
  // Opis bibliograficzny („Poezje Adama Mickiewicza 2, Warszawa 1955."): tytuł dzieła przed autorem
  // albo rok wydania za miejscem, więc numer to tom, a miasto to miejsce wydania.
  if (
    (headW && (RE_CAPS_WORK_HEAD.test(headW) || RE_PATRON_ROMAN_REF_BEFORE.test(`${headW} `))) ||
    /^[ \t]*,[ \t]*\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+)?[ \t]+(?:1[5-9]|20)\d\d(?!\d)/u.test(tail)
  )
    return null;
  const after = RE_ADDR_CITY_AFTER.exec(tail);
  // Kod pocztowy za przecinkiem bywa już maską („…14, [KOD-POCZTOWY] Busko").
  const cityOk =
    (!!after && (!!after[1] || (!!after[2] && POLISH_CITIES.has(after[2].toLowerCase())))) ||
    // kod pocztowy w następnym wierszu bloku adresowego („Anna Kowalska⏎Jana Pawła II 5⏎25-001 Kielce")
    RE_PATRON_POSTAL_AFTER.test(tail);
  // Tytuł patrona i ukośnik wskazują adres dopiero z miejscowością za numerem: bez niej to też
  // ocena czy liczba godzin osoby („Ocena Tomasza Mazura 3/5", „Prof. Jana Nowaka 30").
  if ((RE_PATRON_STREET_TITLE_HEAD.test(m) || RE_PATRON_STREET_SLASH.test(m)) && (cityOk || /^[ \t]+we?[ \t]+\p{Lu}/u.test(tail))) {
    return ctx.hit('ADRES');
  }
  const sepPerson = RE_PATRON_STREET_PERSON_SEP.exec(before);
  if (sepPerson && personPairBeforeAddr(before.slice(0, sepPerson.index))) {
    return ctx.hit('ADRES');
  }
  if (!cityOk && !personPairBeforeAddr(before)) return null;
  return ctx.hit('ADRES');
}
// Maska adresu, maska osoby albo null, gdy dopasowanie zostaje jawne.
function classifyPatronStreet(
  ctx: RedactCtx,
  m: string,
  w1: string,
  wMid: string | undefined,
  w2: string,
  offset: number,
  t: string,
  mode: PatronStreetMode,
): string | null {
  const before = t.slice(Math.max(0, offset - 60), offset);
  const tail = t.slice(offset + m.length, offset + m.length + 50);
  const headW = /(\p{L}+) +$/u.exec(before)?.[1]?.toLowerCase();
  const h: PatronStreetHit = { m, w1, wMid, w2, offset, t, mode, before, tail, headW };
  if (patronStreetExcluded(h)) return null;
  // Lokal „m."/„lok." sam wskazuje adres w każdym trybie, także w prozie bez etykiety („Lokator
  // Adama Mickiewicza 30 m. 2 zalega z czynszem").
  if (RE_PATRON_STREET_FLAT.test(m)) {
    return ctx.hit('ADRES');
  }
  if (patronStreetAnchored(h)) {
    return ctx.hit('ADRES');
  }
  if (mode === 'roman' || mode === 'fallback') return patronStreetRomanOrPerson(ctx, h);
  if (mode === 'ctx') return null;
  return patronStreetUnanchored(ctx, h);
}
// Przy trzech wyrazach, z których pierwszy nie jest imieniem patrona („Anna Kowalska Jana Pawła II
// 5"), ulicą może być para od drugiego wyrazu i dopasowanie nie może jej pochłonąć.
function replacePatronStreets(ctx: RedactCtx, re: RegExp, mode: PatronStreetMode): void {
  const street = (m: string, w1: string, wMid: string | undefined, w2: string, offset: number, t: string): string | null => {
    const r = classifyPatronStreet(ctx, m, w1, wMid, w2, offset, t, mode);
    return r === ctx.M.ADRES && RE_PATRON_STREET_WORD_BEFORE.test(t.slice(Math.max(0, offset - 60), offset)) ? PATRON_STREET_MARK + r : r;
  };
  ctx.text = ctx.text.replace(re, (m, w1: string, wMid: string | undefined, w2: string, offset: number, t: string) => {
    const r = street(m, w1, wMid, w2, offset, t);
    if (r !== null || wMid === undefined) return r ?? m;
    const idx = m.indexOf(wMid, m.indexOf(w1) + w1.length);
    const r2 = street(m.slice(idx), wMid, undefined, w2, offset + idx, t);
    return r2 === null ? m : m.slice(0, idx) + r2;
  });
}
// Komórka z samą ulicą pod nagłówkiem kolumny albo po etykiecie (patrz RE_PATRON_STREET_CELL).
function maskPatronStreetCells(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_PATRON_STREET_CELL, (m, w1: string, wMid: string | undefined, _w2: string, offset: number, t: string) => {
    const a = w1.toLowerCase();
    if (!(isFirstNameGenitive(a) || egoNameGenitive(a)) || (wMid !== undefined && !isFirstNameGenitive(wMid.toLowerCase()))) return m;
    const before = t.slice(Math.max(0, offset - 60), offset);
    if (!streetHeaderAbove(t, offset) && !RE_PATRON_STREET_LABEL.test(before) && !RE_PATRON_STREET_RESIDENCE.test(before) && !patronStreetKeyBefore(before)) return m;
    return ctx.hit('ADRES');
  });
}
function patronStreetWithNumber(ctx: RedactCtx): void {
  replacePatronStreets(ctx, RE_PATRON_STREET_NO, '');
  maskPatronStreetCells(ctx);
  for (const [re, mode] of [
    [RE_PATRON_STREET_NO_LOOSE, 'loose'],
    [RE_PATRON_STREET_NO_CTX, 'ctx'],
    [RE_PATRON_STREET_CAPS, 'ctx'],
    [RE_PATRON_STREET_ROMAN, 'roman'],
    [RE_PATRON_STREET_NO_CTX, 'fallback'],
  ] as const) {
    replacePatronStreets(ctx, re, mode);
  }
  // Skrót albo wyraz uliczny przed oznaczoną maską wchodzi do niej („al. [ADRES]" → „[ADRES]").
  ctx.text = ctx.text.replace(RE_STREET_WORD_BEFORE_MARK, '').replaceAll(PATRON_STREET_MARK, '');
}
// Ulice z patronem i adres bez „ul." po etykiecie zamieszkania.
export function passAddressAfterResidenceLabel(ctx: RedactCtx): void {
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
      return `${strong ?? weak}${sep}${city ?? ''}${csep ?? ''}${ctx.hit('ADRES')}`;
    },
  );
}

// Wiersz bloku koperty z samym zwrotem albo z imieniem i nazwiskiem, opcjonalnie po „Pan/Pani".
const RE_ENVELOPE_SALUTATION_LINE = /^(?:Pan|Pani|PAN|PANI|Sz\.[ \t]*P\.)$/;
const RE_ENVELOPE_PERSON_LINE = /^(?:(?:Pan|Pani|PAN|PANI)[ \t]+)?\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?[ \t]+\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?$/u;

// Data za numerem domu: maska obejmuje sam adres, a data zostaje; bez numeru przed datą całość jawna.
function maskHouseBeforeDate(ctx: RedactCtx, m: string): string {
  const cut = RE_HOUSE_NO_BEFORE_DATETIME.exec(m) ?? RE_HOUSE_NO_BEFORE_DATE.exec(m);
  if (!cut) return m;
  return `${ctx.hit('ADRES')}${cut[2]}`;
}
// Prefiks ulicy, który w tym otoczeniu nie zaczyna adresu: rok obiektu, cytowanie, notacja
// techniczna, tytuł wystawy.
function streetPrefixMisleads(prefix: string, m: string, offset: number, str: string, strongLabel: boolean): boolean {
  // Rondo, most, skwer czy bulwar z gołą liczbą 1900–2099 („Most Grunwaldzki 1910", także z „r."
  // w środku) to rok obiektu, nie numer domu.
  if (/^(?:rond|most|skwer|bulwar)/i.test(prefix) && /[^0-9](?:19|20)\d{2}(?:[ \t]+(?:r\.|roku)[ \t]+\d+)?$/.test(m)) return true;
  // „Smith et al. Nature 2019" to cytowanie, nie aleja
  if (/^al\./i.test(prefix) && /(?<!\p{L})et[ \t]+$/iu.test(str.slice(Math.max(0, offset - 4), offset))) return true;
  // OCR „UI."/„U1." sklejone z nazwą tylko po etykiecie adresu („zam. UI.LIP0WA 14"): bez niej to
  // notacja techniczna („Zmiana w UI.Panel 2.0").
  if (/^[Uu][I1]\.$/.test(prefix) && !/\s/.test(str[offset + prefix.length] ?? '') && !strongLabel) return true;
  return RE_ALEJE_PLURAL.test(prefix) && RE_YEAR_TAIL.test(m);
}
// Liczba za nazwą ulicy jako numer domu albo liczebnik, ilość czy data w zdaniu.
function maskStreetNumberOrCount(
  ctx: RedactCtx,
  m: string,
  prefix: string,
  offset: number,
  str: string,
  before: string,
  rest: string,
  labeled: boolean,
  hasUnit: boolean,
): string {
  const residenceBefore = RE_RESIDENCE_BEFORE.test(before.slice(-30));
  const personPair = personPairBeforeAddr(before);
  // Słaby prefiks (łącznik w nazwie, „Aleje") bez etykiety, lokalu i osoby przed adresem.
  const weakBare = !labeled && !hasUnit && (RE_ALEJE_WEAK.test(prefix) || RE_ADDR_CONNECTOR_USED.test(m)) && !residenceBefore && !personPair;
  // Za słabym prefiksem dalszy ciąg liczby („Przebudowa ul. Polnej i Leśnej 250 000,00 zł") to kwota
  // albo termin, nie numer domu.
  if (weakBare && RE_NUMERIC_TAIL_AFTER.test(rest)) return m;
  const fieldNext = RE_FIELD_LABEL_AFTER.test(str.slice(offset + m.length, offset + m.length + 48));
  const quantity = !fieldNext && quantityAfter(m, rest);
  // Goła liczba (albo zakres „2-3") przed rzeczownikiem ilości to liczebnik („przy ul. Długiej 5
  // osób rannych"), ale nie z lokalem („zam. ul. Długa 5 m. 3 lat 45"). Osoba tuż przed adresem
  // przesądza o numerze domu jak etykieta („Jan Kowalski, ul. Leśna 3 osoby"); samo „mieszka przy"
  // nie przy mierze czasu („Mieszkał w Alejach Ujazdowskich 3 miesiące").
  const personNear = labeled || personPair || (residenceBefore && !RE_TIME_QUANTITY_AFTER.test(rest));
  if (/[ \t]\d{1,4}(?:[-–]\d{1,4})?$/.test(m) && !hasUnit && quantity) {
    if (!personNear) return maskHouseBeforeDate(ctx, m);
    // Po etykiecie pierwsza liczba zostaje numerem domu, ale druga, tuż przed rzeczownikiem
    // ilości, to liczebnik („Adres pobytu: ul. Polna 5 2 osoby" → „[ADRES] 2 osoby").
    if (RE_HOUSE_NO_BEFORE_DATE.test(m)) return maskHouseBeforeDate(ctx, m);
  }
  // „lokal 12" po spacji przed rzeczownikiem ilości to podmiot i liczebnik, więc maska kończy się
  // na numerze domu.
  if (!personNear && quantity) {
    const tail = RE_SPACE_UNIT_TAIL.exec(m);
    if (tail) {
      return ctx.hit('ADRES') + m.slice(tail.index);
    }
  }
  if (!labeled && RE_YEAR_TAIL.test(m) && RE_ADDR_CONNECTOR_USED.test(m)) return m;
  // Za słabym prefiksem proza: ulice albo miejsce zdarzenia z liczebnikiem („Na skrzyżowaniu
  // ul. Polnej i Leśnej 3 osoby zginęły").
  if (weakBare && !fieldNext && RE_PROSE_AFTER_WEAK.test(rest)) return m;
  // też zakres dni: „przy ul. Długiej 1-3 maja" to termin, nie numery domów
  if (/(?:[ \t]|\d[-–])(?:[1-9]|[12]\d|3[01])$/.test(m) && monthAhead(rest)) {
    if (RE_HOUSE_NO_BEFORE_DATE.test(m)) return maskHouseBeforeDate(ctx, m);
    if (!labeled) return m;
  }
  // Rok przed „r. nr 18" to nazwa ulicy z datą („Bitwy Warszawskiej 1920 r. nr 18"), więc strażnik
  // roku tam nie działa.
  if (
    RE_YEAR_TAIL.test(m) &&
    /^(?:[ \t]*[-–][ \t]*(?:19|20)?\d{2}(?!\d)|[ \t]*r\.|[ \t]+rok)/.test(rest) &&
    !/^[ \t]*(?:r\.|roku)[ \t]+(?:nr\.?[ \t]*)?\d/.test(rest)
  )
    return maskHouseBeforeDate(ctx, m);
  return ctx.hit('ADRES');
}
function maskStreetMatch(ctx: RedactCtx, m: string, prefix: string, offset: number, str: string): string {
  // Kropka końca zdania po numerze domu kończy adres („przy ul. Polnej 3. Od 2 lat choruje"):
  // człon nazwy może zaczynać się cyfrą, więc dopasowanie sięgnęłoby po liczbę z następnego zdania.
  const sb = RE_HOUSE_NO_SENTENCE_END.exec(m);
  if (sb) {
    const cut = sb.index + sb[0].length;
    return maskStreetMatch(ctx, m.slice(0, cut), prefix, offset, str) + m.slice(cut);
  }
  const before = str.slice(Math.max(0, offset - 60), offset);
  const strongLabel = RE_STRONG_ADDR_LABEL.test(before.slice(-30));
  if (streetPrefixMisleads(prefix, m, offset, str, strongLabel)) return m;
  // Goły numer bywa datą: dzień przed miesiącem („z placu Piłsudskiego 11 listopada") albo rok przed
  // „r." czy zakresem lat. Strażnik w callbacku, nie w lookaheadzie, bo cofanie skróciłoby numer
  // („[ADRES]1 listopada"). Po silnej etykiecie dzień przed miesiącem dalej jest numerem domu.
  const rest = str.slice(offset + m.length, offset + m.length + 24);
  if (RE_TIME_AFTER.test(rest)) return maskHouseBeforeDate(ctx, m);
  // Silna etykieta adresu albo osoba po etykiecie tuż przed nim: liczba to numer domu.
  const labeled = strongLabel || labeledPersonBeforeAddr(before);
  // „na rogu ul. Mickiewicza i Słowackiego": dwie ulice, a liczba za nimi to liczebnik
  // („… 1 osoba zginęła"), nie numer domu
  if (RE_ADDR_CONNECTOR_I.test(m) && RE_CROSSING_BEFORE.test(before.slice(-24))) return m;
  const hasUnit = RE_ADDR_HAS_UNIT.test(m);
  if (RE_ALEJE_WEAK_LOWER.test(prefix) && !labeled && !hasUnit) return m;
  return maskStreetNumberOrCount(ctx, m, prefix, offset, str, before, rest, labeled, hasUnit);
}
// Adres ze skrótem albo typem ulicy, nazwą i numerem.
const RE_STREET_ADDR = new RegExp(
  // skróty bez względu na wielkość liter, też ze skanów i OCR („UL. KWIATOWA 5"), oraz „Aleje/Alejach/Aleją"
  `\\b([Uu][lLI1]\\.|[Uu][Ll][Ii][Cc][AaIiYy]|[Aa][Ll]\\.|[Aa][Ll][Ee][IiJj](?:[Aa][Cc][Hh]|[AaIiĘęEeĄą])?|[Oo][Ss]\\.|[Oo][Ss][Ii][Ee][Dd][Ll][EeAaUu]|[Pp][Ll]\\.|[Pp][Ll][Aa][Cc][UuAa]?|` +
    // typy ulic bez skrótu („Rondo Dmowskiego 3", „skwer Kościuszki 5"); bez „park", bo
    // „Park Narodowy … 2024" to instytucja
    `[Rr]ond[${PL_LO}]*|[Mm]ost[${PL_LO}]*|[Ss]kwer[${PL_LO}]*|[Bb]ulwar[${PL_LO}]*)` +
    // po „ul." (też OCR „UI."/„U1.") spacja bywa pominięta („zam. ul.Lipowa 14"); tylko po nim,
    // bo „et al.Nature 12" czy „2 os.Cena 350" to nie adresy
    `(?:\\s+|(?<=\\b[Uu][lLI1]\\.))` +
    // tytuły patrona jak w RE_STREET_EPONYM_TAIL („ul. prof. dr. hab. Jana Nowaka 3"): rangi
    // STREET_RANK bez „pułk”, tylko małymi literami
    `(?:(?:\\d+|${STREET_RANK_WORDS.filter((r) => r !== 'pułk').join('|')})\\.?\\s+|[A-ZĄĆĘŁŃÓŚŹŻ]\\.\\s+){0,4}` +
    // „r."/„roku" jako człon nazwy z datą („ul. Bitwy Warszawskiej 1920 r. 18"); numer domu stoi po nich
    `[${PL_UP}][${PL_LO}${PL_UP}01.-]*(?:[ \\t]+(?:[${PL_UP}0-9][${PL_LO}${PL_UP}0-9.-]*|r\\.|roku)){0,3}` +
    ADDR_CONNECTOR +
    // blok na osiedlu przed numerem („os. Tysiąclecia bl. 4 m. 3")
    `(?:[ \\t]+(?:bl\\.|blok))?` +
    `[ \\t]+${ADDR_HOUSE}${ADDR_UNIT}`,
  'g',
);
function maskStreetAddresses(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_STREET_ADDR, (m: string, prefix: string, offset: number, str: string): string =>
    maskStreetMatch(ctx, m, prefix, offset, str),
  );
}
// Drugi adres w wyliczeniu tuż za maską („Lokale przy ul. Polnej 5 i Leśnej 7"): łącznik po numerze
// domu nie jest członem nazwy (ADDR_CONNECTOR). Liczba przed ilością, kwotą, godziną czy datą
// („… i Leśnej 7 dzieci") zostaje, jak w głównym przebiegu.
const RE_SECOND_STREET = new RegExp(
  `(${ADR_MASK_SRC}[ \\t]+(?:i|oraz)[ \\t]+)[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?(?:[ \\t]+[${PL_UP}][${PL_LO}]+)?` +
    `[ \\t]+${ADDR_HOUSE}${ADDR_UNIT}(?![\\d${PL_LO}${PL_UP}])`,
  'g',
);
function maskSecondStreetInEnumeration(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_SECOND_STREET,
    (m: string, lead: string, offset: number, str: string) => {
      const rest = str.slice(offset + m.length, offset + m.length + 24);
      if (RE_NUMERIC_TAIL_AFTER.test(rest) || RE_TIME_AFTER.test(rest) || monthAhead(rest)) return m;
      if (quantityAfter(m, rest)) return m;
      const accInstr = RE_SECOND_STREET_ACC_PREP.test(str.slice(Math.max(0, offset - 12), offset));
      if (!secondStreetShape(m.slice(lead.length), accInstr)) return m;
      return `${lead}${ctx.hit('ADRES')}`;
    },
  );
}
// Adres bez „ul." tuż przed zamaskowanym kodem pocztowym. Człony nazwy łączy tylko odstęp poziomy:
// przez nową linię nazwisko z podpisu („Monika Sadowska\nSzosa Chełmińska 77/9") stawałoby się
// początkiem nazwy ulicy.
const RE_STREET_BEFORE_POSTAL = new RegExp(
  // bez łącznika „i/z/pod": bez skrótu ulicy „Spółka Kowalski i Syn 5, 00-001 …" to firma.
  // Granica wyrazu jawnie, bo „\b" w JS zna tylko litery ASCII, a nazwa bywa na Ł/Ś/Ż („Łagów 12⏎26-140 Bodzentyn").
  `(?<![${PL_UP}${PL_LO}0-9_])([${PL_UP}][${PL_LO}]+(?:[ \\t]+[${PL_UP}][${PL_LO}]+){0,2})` +
    `\\s+${ADDR_HOUSE}${ADDR_UNIT}` +
    `(\\s*,?\\s*)(${KOD_MASK_SRC})`,
  'g',
);
function maskStreetBeforePostalCode(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_STREET_BEFORE_POSTAL,
    (m: string, street: string, sep: string, kod: string, offset: number, str: string) => {
      // Odsyłacz albo pomieszczenie nad kodem („Sala 12⏎00-001 Warszawa", „Pokój 3") to nie ulica
      // ani wieś (jak ADDR_LABEL_VALUE_STOP po etykiecie). Chyba że to wieś w bloku koperty: osoba
      // albo „Pan/Pani" w wierszu wyżej („Pan⏎Jan Kowalski⏎Pokój 12⏎46-034 Pokój") albo ta sama nazwa za kodem.
      if (!/[ \t]/.test(street) && ADDR_LABEL_VALUE_STOP.has(street.toLowerCase())) {
        const prevLine = /(?:^|\n)([^\n]*)\r?\n[ \t]*$/.exec(str.slice(Math.max(0, offset - 80), offset))?.[1]?.trim() ?? '';
        const envelope =
          RE_ENVELOPE_SALUTATION_LINE.test(prevLine) ||
          (RE_ENVELOPE_PERSON_LINE.test(prevLine) && personPairBeforeAddr(prevLine));
        const after = str.slice(offset + m.length, offset + m.length + 40);
        const sameName = after.startsWith(' ' + street) && !/^\p{L}/u.test(after.slice(street.length + 1));
        if (!envelope && !sameName) return m;
      }
      return `${ctx.hit('ADRES')}${sep}${kod}`;
    },
  );
}
// Adres ze skrótem albo typem ulicy, nazwą i numerem, potem drugi adres w wyliczeniu i adres bez
// „ul." przed zamaskowanym kodem pocztowym.
// Siedziba instytucji w nagłówku pisma albo tuż za jej nazwą („Urząd Miejski⏎ul. gen. Władysława
// Andersa 5”): adres podmiotu, nie osoby. Cała ulica z numerem znika pod sentinelem na czas przebiegów
// adresu, żeby krótszy wzorzec (od imienia patrona, od „Maja 5”) nie zamaskował jej fragmentu.
const RE_INSTITUTION_STREET = new RegExp(STREET_SRC, 'gu');
export function passProtectInstitutionStreets(ctx: RedactCtx): void {
  if (!ctx.on('ADRES')) return;
  ctx.text = ctx.text.replace(RE_INSTITUTION_STREET, (m: string, offset: number, str: string) => {
    if (RE_STRONG_ADDR_LABEL.test(str.slice(Math.max(0, offset - 30), offset))) return m;
    if (!institutionStreetAt(str, offset, ctx.personProbe)) return m;
    ctx.institutionStreets.push(m);
    return `${INSTITUTION_STREET_OPEN}${indexToLetters(ctx.institutionStreets.length - 1)}${INSTITUTION_STREET_CLOSE}`;
  });
}
/** Przywraca ulice siedzib po przebiegach adresu (przed kodem bez myślnika i miejscowością). */
export function passRestoreInstitutionStreets(ctx: RedactCtx): void {
  if (!ctx.institutionStreets.length) return;
  ctx.text = ctx.text.replace(RE_INSTITUTION_STREET_SENTINEL, (mm, letters: string) => ctx.institutionStreets[lettersToIndex(letters)] ?? mm);
}

export function passAddress(ctx: RedactCtx): void {
  if (!ctx.on('ADRES')) return;
  maskStreetAddresses(ctx);
  maskSecondStreetInEnumeration(ctx);
  maskStreetBeforePostalCode(ctx);
}

// Kod pocztowy bez myślnika („65048") tylko przy mocnej kotwicy: tuż za maską adresu i bezpośrednio
// przed miejscowością (wyraz z wielkiej litery).
const RE_POSTAL_NO_HYPHEN = new RegExp(`(${ADR_MASK_SRC}\\s*,?\\s*)(?<!\\d)\\d{5}(?!\\d)(?=[ \\t]+${CAP_CITY})`, 'g');
export function passPostalNoHyphen(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  ctx.text = ctx.text.replace(RE_POSTAL_NO_HYPHEN, maskKeepPrefix(ctx, 'KOD-POCZTOWY'));
}
