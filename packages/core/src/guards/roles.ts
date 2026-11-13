// Słowniki ról, instytucji i nazw własnych oraz strażniki pary „Słowo Nazwisko”, które rozstrzygają,
// czy pierwszy wyraz to imię, rola, czy człon nazwy obiektu.
import { isConfirmedSurname, isGeoAdjective, normalizeSurnameKey } from '../surnames.js';
import { CAP_WORD } from '../charset.js';
import { type RedactCtx } from '../context.js';

/** Instytucje i akty prawne, które nie są parą „imię nazwisko” („Sąd Najwyższy”). */
export const LEGAL_ENTITY_WORDS = new Set<string>(
  (
    'sąd sądu trybunał trybunału izba kodeks kodeksu ustawa ustawie prawo prawa ordynacja ' +
    'rozporządzenie urząd urzędu ministerstwo sejm senat parlament komisja inspekcja straż ' +
    'policja prokuratura rzecznik cywilny cywilnego karny karnego pracy handlowy administracyjny ' +
    'postępowania wykonawczy skarbowy rzeczpospolita polska polski unia europejska najwyższy ' +
    'apelacyjny okręgowy rejonowy konstytucyjny państwowa narodowy narodowa fundusz zakład ' +
    'krajowy krajowa główny główna społecznych ' +
    // rzeczowniki dokumentowe, mylone z nazwiskiem w parze „Słowo Imię”
    'umowa umowie załącznik rozdział artykuł ustęp punkt pozycja faktura pismo wniosek decyzja ' +
    'departament biuro wydział referat oddział sekcja nowy nowa ' +
    // chronią przymiotnik w nazwie instytucji przed rozpoznawaczem nazwisk w parze mianownikowej
    // („Uniwersytet Warszawski”)
    'uniwersytet uniwersytetu politechnika akademia akademii instytut instytutu bank banku ' +
    'szpital szpitala teatr muzeum klub związek związku kancelaria kancelarii fundacja fundacji ' +
    'stowarzyszenie spółka spółki spółdzielnia spółdzielni samorząd samorządu rada rady zarząd ' +
    'zarządu gmina gminy powiat powiatu województwo starostwo kuratorium izby ' +
    'komitet komitetu hufiec zespół zespołu koło zrzeszenie komenda komendy ośrodek ośrodka ' +
    'funduszu centrum agencja agencji dyrekcja dyrekcji park parku'
  ).split(/\s+/),
);

/** Tytuły grzecznościowe: nie są nazwiskiem w parze „Tytuł Imię” (wyzwalacz obsługuje je osobno). */
export const TITLE_WORDS = new Set<string>(
  'pan pani pana panu panią panie państwo szanowny szanowna dr prof mgr inż'.split(/\s+/),
);

/**
 * Role i funkcje przed nazwiskiem („Prezes Gzowski”). W parze mianownikowej maskujemy wtedy samo
 * nazwisko, bo rola niesie sens zdania.
 */
export const ROLE_WORDS = new Set<string>(
  (
    'prezes prezesa prezesie dyrektor dyrektora dyrektorze minister ministra prezydent prezydenta ' +
    'wiceprezes wicedyrektor wojewoda wojewody starosta starosty burmistrz burmistrza wójt wójta ' +
    'marszałek marszałka sędzia sędziego sędzię prokurator prokuratora adwokat adwokata radca radcy ' +
    'notariusz notariusza komornik komornika kierownik kierownika naczelnik naczelnika inspektor ' +
    'inspektora kurator kuratora rektor rektora dziekan dziekana profesor profesora doktor doktora ' +
    'mecenas mecenasa kanclerz przewodniczący przewodnicząca sekretarz skarbnik pełnomocnik biegły ' +
    'świadek powód pozwany oskarżony wnioskodawca ' +
    // strony i rzeczowniki pospolite przed nazwiskiem
    'pracownik pracownica klient klientka pacjent pacjentka najemca wynajmujący właściciel właścicielka ' +
    'dłużnik wierzyciel kupujący sprzedający zleceniodawca zleceniobiorca wykonawca zamawiający konsument ' +
    'ubezpieczony poszkodowany uczestnik członek przedstawiciel abonent użytkownik nabywca darczyńca ' +
    // człony nazw podmiotów gospodarczych („Zakład Usługowy Kowalski”)
    'piekarnia tartak gospodarstwo warsztat hurtownia sklep apteka przychodnia restauracja pracownia ' +
    'przedsiębiorstwo usługowy usługowa usługowe handlowy handlowa handlowe produkcyjny produkcyjna ' +
    'rolny rolna rolne transportowy budowlany budowlana wielobranżowy ' +
    // urzędy i mandaty („Pan Komendant Główny Policji”); celowo bez „sołtys”, bo to też nazwisko
    'komendant komendanta zastępca zastępcy poseł posła posłanka senator senatora wiceminister wiceministra ' +
    // rzecznik z dopełniaczem urzędu przed nazwiskiem („Pani Rzecznik Praw Dziecka Gzowska”)
    'rzecznik rzecznika ' +
    // premier i kanclerz („Pan Premier”), dotąd bez żadnej formy na liście
    'premier premiera ' +
    // Formy zależne urzędów i funkcji po „Panem/Panu/Pana” („z Panem Ministrem”, „Panu Dyrektorowi”).
    // Bez nich wyzwalacz brał sam tytuł za nazwisko. Nazwisko za tytułem dalej idzie pod maskę
    // („z Panem Ministrem Kowalskim”). Homografy nazwisk (Starosta, Wojewoda, Sędzia) mają tu formy
    // zależne na tej samej zasadzie co mianownik, który już był na liście.
    'ministrowi ministrem ministrze wiceministrowi wiceministrem wiceministrze premierowi premierem ' +
    'prezesowi prezesem wiceprezesa wiceprezesowi wiceprezesem wiceprezesie dyrektorowi dyrektorem ' +
    'wicedyrektora wicedyrektorowi wicedyrektorem wicedyrektorze prezydentowi prezydentem prezydencie ' +
    'wojewodzie wojewodę wojewodą staroście starostę starostą burmistrzowi burmistrzem burmistrzu ' +
    'wójtowi wójtem marszałkowi marszałkiem marszałku sędziemu sędzią sędzi rzecznikowi rzecznikiem ' +
    'rzeczniku kierownikowi kierownikiem kierowniku komendantowi komendantem komendancie ' +
    'naczelnikowi naczelnikiem naczelniku dziekanowi dziekanem dziekanie rektorowi rektorem rektorze ' +
    'kanclerza kanclerzowi kanclerzem przewodniczącego przewodniczącemu przewodniczącym ' +
    'przewodniczącej przewodniczącą sekretarza sekretarzowi sekretarzem inspektorowi inspektorem ' +
    'inspektorze kuratorowi kuratorem kuratorze prokuratorowi prokuratorem prokuratorze zastępcą ' +
    'zastępcę posłowi posłem pośle senatorowi senatorem senatorze profesorowi profesorem profesorze ' +
    'doktorowi doktorem doktorze mecenasowi mecenasem ' +
    'komornikowi komornikiem komorniku notariuszowi notariuszem notariuszu adwokatowi adwokatem ' +
    'adwokacie radcą radcę skarbnika skarbnikowi skarbnikiem skarbniku pełnomocnika pełnomocnikowi ' +
    'pełnomocnikiem pełnomocniku biegłego biegłemu biegłym ' +
    // wice- i formy żeńskie urzędów („z Panem Wicewojewodą”, „z Panią Dyrektorką”)
    'wicewojewoda wicewojewody wicewojewodzie wicewojewodę wicewojewodą wicestarosta wicestarosty ' +
    'wicestaroście wicestarostę wicestarostą wiceburmistrz wiceburmistrza wiceburmistrzowi ' +
    'wiceburmistrzem wiceburmistrzu wiceprezydent wiceprezydenta wiceprezydentowi wiceprezydentem ' +
    'wiceprezydencie wicemarszałek wicemarszałka wicemarszałkowi wicemarszałkiem wicemarszałku ' +
    'dyrektorka dyrektorki dyrektorce dyrektorkę dyrektorką kierowniczka kierowniczki kierowniczce ' +
    'kierowniczkę kierowniczką ' +
    // wołacze w zwrotach grzecznościowych („Szanowna Pani Sędzio”)
    'sędzio ' +
    // drugi człon funkcji („Sędzia Sprawozdawca”, „Pani Sędzia Referendarz”, „Prezydent Elekt”)
    'sprawozdawca sprawozdawcy sprawozdawcę sprawozdawcą referendarz referendarza referendarzowi ' +
    'referendarzem elekt elekta elektowi elektem'
  ).split(/\s+/),
);

// Przymiotniki urzędów spoza NON_SURNAME_ADJ i LEGAL_ENTITY_WORDS w formie bazowej („Komendant Główny”,
// „Kurator Sądowy”, „Lekarz Powiatowy”).
const OFFICE_ADJ = new Set<string>(
  'główny rejonowy okręgowy apelacyjny sądowy gminny powiatowy wojewódzki krajowy generalny naczelny wojskowy skarbowy honorowy zawodowy terenowy'.split(' '),
);
// Role, po których przymiotnik od nazwy miejsca albo regionu określa urząd („Wojewoda Mazowiecki”,
// „Komendant Wojewódzki”, „Kurator Oświaty”). Po pozostałych („Dyrektor”, „Prezes”, „Mecenas”, „Sędzia”)
// „Krakowski” czy „Poznański” to prawie zawsze nazwisko.
const RE_TERRITORIAL_ROLE = /^(?:wice)?(?:wojewod|starost|marsza[łl]k|komendan|kurator|prokurator|inspektor|rzeczni|konserwator)/;
// Przyrostki przymiotników funkcji w formie bazowej („Techniczny”, „Finansowy”, „Prowadzący”, „Zwyczajny”).
// Bez -ski/-cki/-dzki: tak kończy się większość nazwisk-przymiotników.
const RE_FUNCTION_ADJ_BASE = /(?:owy|[cz]ny|[aeo]jny|alny|ilny|ywny|ący)$/;
/**
 * Przymiotnik urzędu za rolą, zwykle w formie zależnej („z Panem Komendantem Głównym”, „z Panem
 * Wojewodą Mazowieckim”, „Panu Dyrektorowi Finansowemu”, też „Pan Dyrektor Techniczny”). Mianownik
 * geograficzny („Pan Wojewoda Mazowiecki”) chronią NON_SURNAME_ADJ i LEGAL_ENTITY_WORDS; tu ta sama
 * decyzja po sprowadzeniu odmiany do formy bazowej.
 * Przymiotnik geograficzny tylko po roli terytorialnej (`role` to wyraz roli tuż przed nim), bo
 * „z Panem Dyrektorem Krakowskim” to nazwisko. Przymiotnik funkcji tylko wtedy, gdy nie jest
 * nazwiskiem ze słownika i ma co najmniej 7 liter („z Panem Dyrektorem Czarnym”, „Pan Prezes Nowy”
 * idą pod maskę).
 */
export function isOfficeAdjOblique(w: string, role: string): boolean {
  const m = /^(\p{L}{3,}?)(?:iego|iemu|ego|emu|ym|im|iej|ej|ą|y|a)$/u.exec(w.toLowerCase());
  if (!m) return false;
  const base = m[1] + (/[kg]$/.test(m[1]) ? 'i' : 'y');
  if (OFFICE_ADJ.has(base) || LEGAL_ENTITY_WORDS.has(base)) return true;
  if (isGeoAdjective(base)) return RE_TERRITORIAL_ROLE.test(role.toLowerCase());
  return base.length >= 7 && RE_FUNCTION_ADJ_BASE.test(base) && !isConfirmedSurname(w) && !isConfirmedSurname(base);
}

/**
 * Formy zależne ról, które są też nazwiskami (Starosta, Wojewoda, Sędzia, Marszałek). Jako PIERWSZY
 * wyraz po „Panem/Panu” to rola („z Panem Starostą”); za inną rolą to nazwisko („z Panem Prezesem
 * Marszałkiem”), więc pętla pomijania ról się na nich zatrzymuje.
 */
export const ROLE_HOMOGRAPH_OBLIQUE = new Set<string>(
  'wojewodzie wojewodę wojewodą staroście starostę starostą marszałkowi marszałkiem marszałku sędziemu sędzią sędzi'.split(' '),
);

/**
 * Nazwa procedury przemocy domowej („wszczęto procedurę Niebieskiej Karty”, „w Niebieskiej Karcie”):
 * przymiotnik przed „Kartą” to człon nazwy, nie nazwisko. Wszystkie przypadki obu wyrazów (miejscownik
 * „Karcie” z obocznością t:c), także z podziałem wiersza między wyrazami i wersalikami. Fraza trafia za
 * sentinel przed przebiegami osobowymi (passProtectFictional), więc żaden z nich jej nie ruszy. Grupy
 * 1 i 2 to końcówki obu wyrazów: chroni tylko blueCardAgrees (zgodny przypadek).
 */
export const RE_BLUE_CARD_NAME =
  /(?<![\p{L}\p{N}])niebiesk(a|iej|ą|ę|ie|ich|im|imi)(?:[ \t]+|[ \t]*\r?\n[ \t]*)kar(t(?:a|y|ę|ą|o|om|ami|ach)?|cie)(?![\p{L}\p{N}])/giu;
// Uzgodnione przypadki przymiotnika i rzeczownika („Niebieskiej Karty/Karcie”, „Niebieską Kartę/Kartą”).
// Rozjazd („Pani Niebieskiej kartę parkingową”, „Annie Niebieskiej karta”) to nazwisko i zwykła karta.
const BLUE_CARD_AGREE: Record<string, string[]> = {
  a: ['ta', 'to'],
  iej: ['ty', 'cie'],
  ą: ['tę', 'tą'],
  ę: ['tę'],
  ie: ['ty'],
  ich: ['t', 'tach'],
  im: ['tom'],
  imi: ['tami'],
};
export const blueCardAgrees = (adjEnd: string, nounEnd: string): boolean =>
  BLUE_CARD_AGREE[adjEnd.toLowerCase()]?.includes(nounEnd.toLowerCase()) ?? false;

/**
 * Dopełniacz urzędu po roli („Pani Minister Zdrowia”) i imiona sakralne („do Pana Boga”). Wyzwalacz
 * „Pan/Pani” maskuje ostatni wyraz kandydata, a to nie nazwisko. Celowo nie całe LEGAL_ENTITY_WORDS:
 * „Pani Anna Nowa” to osoba o nazwisku-homonimie.
 */
export const ROLE_COMPLEMENT_GEN = new Set<string>(
  (
    'zdrowia finansów sprawiedliwości infrastruktury edukacji oświaty kultury nauki sportu turystyki ' +
    'obrony spraw rolnictwa rozwoju klimatu środowiska cyfryzacji aktywów funduszy rodziny polityki ' +
    'gospodarki energii przemysłu transportu sejmu senatu miasta miast województwa wsi dzielnicy ' +
    'departamentu wydziału działu biura gabinetu kancelarii policji straży szkoły przedszkola szpitala ' +
    'instytutu ośrodka oddziału delegatury inspektoratu komisji sekcji referatu kadr ochrony ' +
    'praw dziecka obywatelskich pacjenta konsumentów nadzoru gminy powiatu budowy ' +
    'bóg boga bogu bogiem jezus jezusa jezusowi jezusem chrystus chrystusa chrystusowi chrystusem ' +
    'maryja maryi maryję maryją'
  ).split(/\s+/),
);

/**
 * Pierwszy wyraz nazwy własnej obiektu, wydarzenia, akwenu („Puszcza Białowieska”). Uzgodniony
 * przymiotnik -ski/-cki po nim to człon nazwy, nie nazwisko, ale tylko w mianownikowej gałęzi pary.
 * Pory dnia („Dzień”, „Tydzień”) są w NON_NAME_LEADERS, bo w grafiku stoi po nich nazwisko.
 */
export const PROPER_NAME_HEADS = new Set<string>(
  (
    'kościół bazylika katedra kaplica klasztor sanktuarium cmentarz pomnik kopiec hejnał jarmark ' +
    'festiwal konkurs turniej noc ocean morze kanał półwysep zatoka wyspa jezioro puszcza ' +
    'las ogród pałac zamek brama wieża dworzec traktat pokój układ pakt sobór synod kongres bitwa ' +
    'powstanie wyżyna nizina kotlina pojezierze pustynia szlak trakt'
  ).split(/\s+/),
);
// Wyraz z wielkiej litery za jedną spacją (strażnik nazwy instytucji w parze).
export const RE_NEXT_CAP_WORD_1SP = new RegExp(`^ (${CAP_WORD})`);
// Forma firmy, przed którą stoi zwykle nazwisko właściciela („Brzozowski Spółka Jawna”).
export const OWNER_FIRM_HEADS = new Set<string>('spółka kancelaria zakład firma biuro gabinet pracownia warsztat'.split(' '));
// Strona postępowania w mianowniku: po niej przymiotnik ze stoplisty nazwisk to nazwisko osoby.
export const PARTY_ROLE_WORDS = new Set<string>(
  (
    'świadek pozwany pozwana powód powódka oskarżony oskarżona obwiniony obwiniona podejrzany podejrzana ' +
    'pokrzywdzony pokrzywdzona wnioskodawca wnioskodawczyni uczestnik uczestniczka dłużnik dłużniczka ' +
    'wierzyciel skazany skazana pacjent pacjentka'
  ).split(' '),
);
export const RE_AFTER_PARTY_ADJ = /^(?:[ \t]+\p{Ll}|[ \t]*[,.;:)!?]|[ \t]*$)/u;
/** Czy przerwa przed nazwiskiem w parze to granica kolumny wyrównanej spacjami? */
export function columnGapBetween(kept: string, t: string, offset: number): boolean {
  const gap = /[ \t]+$/.exec(kept)?.[0] ?? '';
  if (gap.length >= 3) return true;
  if (gap.length < 2) return false;
  // druga taka przerwa w tym samym wierszu; okno ograniczone, żeby nie skanować całego tekstu w pętli
  const lo = Math.max(0, offset - 120);
  const win = t.slice(lo, offset + 160);
  const at = offset - lo;
  const ls = win.lastIndexOf('\n', at) + 1;
  const le = win.indexOf('\n', at);
  const line = win.slice(ls, le < 0 ? win.length : le);
  return (line.match(/ {2,}|\t/g)?.length ?? 0) >= 2;
}
// Czasownik osobowy w czasie przeszłym za parą „Głowa Przymiotnik-ska” wskazuje osobę jako podmiot
// („Noc Brzozowska spędziła w celi”); nazwa obiektu stoi przy formie bezosobowej („Las Kabacki
// zamknięto”). Za czasownikiem osoby stoi okolicznik albo koniec zdania; wyraz pospolity to podmiot
// w szyku odwróconym albo dopełnienie („Kościół Mariacki kupił nowe wyposażenie”).
const RE_PERSON_PAST_VERB_AFTER =
  /^[ \t]+(?:spędził|przespał|opuścił|wymienił|sprzedał|kupił|wynajął|wynajmował|zajmował|przeleżał|dyżurował|odwiedził|zgłosił|opuściła|posprzątał)a?(?!\p{L})/u;
const RE_PERSON_VERB_COMPLEMENT =
  /^[ \t]+\p{Ll}+[ \t]*(?:[.,;:!?)]|$|\d|(?:w|we|na|o|od|do|z|ze|po|przy|za|przed|u|dla|około|ok\.|sam|sama|sami|spokojnie|wcześniej|później|wczoraj|dzisiaj|rano|wieczorem|nocą|całą|cały|całe)(?![\p{L}]))/u;
// Grafik dyżurów: „Dzień Lisiecka, Noc Brzozowska”.
const RE_SHIFT_LIST_BEFORE = /(?<!\p{L})(?:Dzień|Rano|Wieczorem|Popołudnie)[ \t]+\p{Lu}\p{L}+[ \t]*,[ \t]*$/u;
const RE_DATE_LINE_HEAD_BEFORE = /(?:^|\n)[ \t]*\d{1,2}[.:]\d{2}(?:[.:]\d{2,4})?[ \t]+$/;
const RE_WARD_ABBR_AFTER = /^[ \t]+\p{Lu}{2,5}(?![\p{L}])/u;
const NOC_EVENT_ADJ = new Set<string>('świętojańska kupalna sylwestrowa kryształowa muzealna wigilijna listopadowa'.split(' '));
// Głowy, które w piśmie bywają zwykłym dopełnieniem czynności osoby (noc w celi, pokój w hotelu,
// zamek w drzwiach, las na sprzedaż), a nie nazwą zabytku czy miejsca.
const PERSON_PAIR_OBJECT_HEADS = new Set<string>('noc pokój zamek las'.split(' '));
const RE_IMPERSONAL_AFTER_PAIR = /^[ \t]+\p{Ll}{3,}(?:no|to)(?!\p{L})/u;
// Rzeczownik-rola jako podmiot za orzeczeniem („… odwiedził w sobotę wojewoda”).
const RE_INVERTED_SUBJECT_ROLE =
  /(?<!\p{L})(?:wojewoda|wojewodzina|inwestor|inwestorka|prezydent|prezydentka|burmistrz|wójt|starosta|marszałek|minister|ministra|premier|biskup|arcybiskup|kardynał|papież|nabywca|nabywczyni|deweloper|turysta|turystka|turyści|delegacja|komisja|wycieczka|gość|goście|król|królowa|książę|ambasador|konserwator|nadleśniczy|leśniczy)(?!\p{L})/u;
// Koniec zdania: kropka przed małą literą to skrót, nie koniec.
const RE_SENTENCE_END = /[;!?\n]|\.(?![ \t]*\p{Ll})/u;
/** Czy para „Głowa nazwy + przymiotnik uzgodniony” to mimo uzgodnienia osoba? */
export function properNamePairIsPerson(ctx: RedactCtx, t: string, offset: number, m: string, w1l: string, w2: string): boolean {
  const after = t.slice(offset + m.length, offset + m.length + 30);
  // forma bezosobowa to zawsze obiekt, także gdy w piśmie jest osoba o tym nazwisku („Dworzec Kaliski zamknięto”)
  if (RE_IMPERSONAL_AFTER_PAIR.test(after)) return false;
  const roomHead = PERSON_PAIR_OBJECT_HEADS.has(w1l);
  // nazwisko osoby rozpoznanej już w piśmie; przymiotnik od miejscowości przy obiekcie zostaje nazwą
  if (ctx.maskedSurnames.has(normalizeSurnameKey(w2)) && (roomHead || !isGeoAdjective(w2))) return true;
  // podmiot za czasownikiem osobowym, tylko przy głowie bywającej dopełnieniem czynności osoby; przy
  // kościele czy cmentarzu podmiot w szyku odwróconym stoi za okolicznikiem („Kościół Mariacki
  // odwiedził w niedzielę biskup”) albo jest domyślny
  if (
    roomHead &&
    RE_PERSON_PAST_VERB_AFTER.test(after) &&
    RE_PERSON_VERB_COMPLEMENT.test(after) &&
    !isGeoAdjective(w2) &&
    // rola jako podmiot dalej w zdaniu czyni z pary dopełnienie, czyli nazwę obiektu
    !RE_INVERTED_SUBJECT_ROLE.test(t.slice(offset + m.length, offset + m.length + 80).split(RE_SENTENCE_END)[0])
  )
    return true;
  // nazwa święta albo imprezy, nie dyżur („21.06 Noc Świętojańska”)
  if (w1l !== 'noc' || NOC_EVENT_ADJ.has(w2.toLowerCase())) return false;
  const before = t.slice(Math.max(0, offset - 40), offset);
  return RE_SHIFT_LIST_BEFORE.test(before) || RE_DATE_LINE_HEAD_BEFORE.test(before) || RE_WARD_ABBR_AFTER.test(after);
}
// Rodzaj głów z PROPER_NAME_HEADS (pozostałe są męskie): przymiotnik-człon nazwy uzgadnia się z nim.
const PROPER_NAME_HEADS_FEM = new Set<string>(
  'bazylika katedra kaplica noc zatoka wyspa puszcza brama wieża bitwa wyżyna nizina kotlina pustynia'.split(' '),
);
const PROPER_NAME_HEADS_NEUT = new Set<string>('sanktuarium morze jezioro powstanie pojezierze'.split(' '));
/** Czy wyraz to przymiotnik uzgodniony z rodzajem głowy nazwy („Jezioro Bielskie”)? */
export function headAgreesWithAdjective(head: string, w: string): boolean {
  if (PROPER_NAME_HEADS_FEM.has(head)) return /(?:sk|ck|dzk)a$/.test(w);
  if (PROPER_NAME_HEADS_NEUT.has(head)) return /(?:sk|ck|dzk)ie$/.test(w);
  return /(?:sk|ck|dzk)i$/.test(w);
}

// Rzeczowniki osobowe i techniczne przed nazwiskiem. Po nich wyraz z wielkiej litery to nazwisko
// także przed nazwą instytucji („Lekarz Lisiecki Oddział Neurologii”); strażnik członu nazwy
// instytucji dotyczy tylko przysłówków, spójników i czasowników z NON_NAME_LEADERS.
export const NOUN_NAME_LEADERS = new Set<string>(
  (
    'sąsiad sąsiadka lekarz lekarka ksiądz aspirant sierżant komisarz kapitan porucznik policjant ' +
    'funkcjonariusz strażnik nauczyciel nauczycielka student studentka obywatel obywatelka mieszkaniec ' +
    'mieszkanka lokator lokatorka petent petentka administrator operator technik ojciec matka brat ' +
    'siostra mąż żona syn córka kierowca kolega koleżanka dzielnicowy ' +
    'raport profil katalog folder plik rekord konto'
  ).split(/\s+/),
);

/**
 * Wyrazy z wielkiej litery na początku zdania przed nazwiskiem, które imieniem nie są („Jednak
 * Lewandowski odmówił”). W mianownikowej gałęzi pary maskujemy wtedy samo nazwisko. Rzadkich imion
 * spoza słownika tu nie ma, więc znikają razem z nazwiskiem. Celowo bez „sam” (imię Sam).
 */
export const NON_NAME_LEADERS = new Set<string>([
  ...(
    'wczoraj przedwczoraj dzisiaj dziś jutro wtedy wówczas potem następnie później wcześniej najpierw ' +
    'teraz obecnie niedawno tymczasem wreszcie ostatecznie dopiero zawsze nigdy często rano wieczorem ' +
    // pora w grafiku („Tydzień Gzowski – urlop”); przymiotnik święta po nich jest na stopliście
    'dzień tydzień ' +
    'jednak natomiast ponadto również także też dlatego zatem więc bowiem ale lecz oraz albo lub czy ' +
    'nawet tylko jedynie właśnie już jeszcze chyba może niestety oczywiście tak nie zaś ' +
    'ten ta to każdy gdy kiedy jeśli jeżeli skoro choć chociaż ponieważ aby żeby że ' +
    'według przez dla przy wobec mimo oprócz dzięki od do za na po pod nad przed'
  ).split(/\s+/),
  ...NOUN_NAME_LEADERS,
]);
// Czasownik w 1. osobie czasu przeszłego na początku zdania („Odwiedziliśmy”) też nie jest imieniem.
export const RE_VERB_1ST_PERSON = /(?:liśmy|łyśmy|liście|łyście|łem|łam|łeś|łaś)$/;
// Przymiotnik przed nazwą parku to człon nazwy, nawet gdy bywa nazwiskiem („Słowiński Park Narodowy”).
export const RE_FOLLOWED_BY_PARK = /^[ \t]+Park(?:u|iem|owi)?[ \t]+(?:Narodow|Krajobrazow)/;
