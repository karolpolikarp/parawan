import { looksLikeSurname, surnameBase } from '../surnames.js';
import { CAP_CITY, escapeRe, PL_LO, PL_UP } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { egoNameGenitive, RE_STREET_WORD } from '../guards/eponyms.js';
import { ADDR_PLACE_ADJ_OK, institutionBeforeAddr, PATRON_GEN_HEADS, RE_CAPS_WORK_HEAD, RE_PERSON_MASK_BEFORE, RE_SHARE_BEFORE } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS } from '../guards/roles.js';
import { RE_SURNAME_OBLIQUE } from '../person-patterns.js';


// Miesiąc w dopełniaczu tuż za numerem („11 listopada", „11 Listopada", „12 MAJA 2024") — numer to
// dzień daty. „Maja" z wielkiej litery to też imię („ul. Lipowa 12⇥Maja Kowalska", „ul. Polna 5 Maja
// Wróbel"): miesiącem jest wtedy, gdy nie stoi za nim wyraz z wielkiej litery („3 Maja o godz. 12",
// „12 Maja 2024 r.").
const RE_MONTH_GEN_AHEAD =
  /^[ \t]+(?:stycznia|lutego|marca|kwietnia|czerwca|lipca|sierpnia|września|października|listopada|grudnia)(?!\p{L})/iu;
const RE_MAY_AHEAD = /^[ \t]+(?:maja(?!\p{L})|(?:Maja|MAJA)(?!\p{L})(?![ \t]+\p{Lu}))/u;
// Ciąg za liczbą po „Miejscowość Rynek N": data, okres, ilość albo lokal („5 maja", „5 lat temu",
// „12 m. 4") — wtedy liczba nie jest gołym numerem urzędu na rynku, a para może być osobą.
export function rynekNoNotHouse(rest: string): boolean {
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
export const RE_PATRON_ROMAN_REF_BEFORE =
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
      ctx.bump('ADRES');
      return `${strong ?? weak}${sep}${city ?? ''}${csep ?? ''}${ctx.M.ADRES}`;
    },
  );
}

export function passAddress(ctx: RedactCtx): void {
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
export function passPostalNoHyphen(ctx: RedactCtx): void {
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
