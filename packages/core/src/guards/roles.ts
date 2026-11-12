import { isGeoAdjective, normalizeSurnameKey } from '../surnames.js';
import { CAP_WORD } from '../charset.js';
import { type RedactCtx } from '../context.js';


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
export const TITLE_WORDS = new Set<string>(
  'pan pani pana panu panią panie państwo szanowny szanowna dr prof mgr inż'.split(/\s+/),
);

/**
 * Role/funkcje/tytuły zawodowe stojące PRZED nazwiskiem („Prezes Gzowski", „Sędzia Trzebiatowski").
 * W parze morfologicznej (krok 13a2) maskujemy wtedy SAMO nazwisko, a rolę zostawiamy —
 * inaczej znikałoby słowo niosące sens („Dyrektor [IMIĘ] podpisał").
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
export const ROLE_COMPLEMENT_GEN = new Set<string>(
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
export const PROPER_NAME_HEADS = new Set<string>(
  (
    'kościół bazylika katedra kaplica klasztor sanktuarium cmentarz pomnik kopiec hejnał jarmark ' +
    'festiwal konkurs turniej noc ocean morze kanał półwysep zatoka wyspa jezioro puszcza ' +
    'las ogród pałac zamek brama wieża dworzec traktat pokój układ pakt sobór synod kongres bitwa ' +
    'powstanie wyżyna nizina kotlina pojezierze pustynia szlak trakt'
  ).split(/\s+/),
);
// Wyraz z wielkiej litery za JEDNĄ spacją (strażnik nazwy instytucji w parze a2).
export const RE_NEXT_CAP_WORD_1SP = new RegExp(`^ (${CAP_WORD})`);
// Forma firmy, przed którą stoi zwykle nazwisko właściciela („Brzozowski Spółka Jawna", „Lisiecki
// Kancelaria Adwokacka", „Gzowski Zakład Usługowy").
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
export function properNamePairIsPerson(ctx: RedactCtx, t: string, offset: number, m: string, w1l: string, w2: string): boolean {
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
export function headAgreesWithAdjective(head: string, w: string): boolean {
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
export const NON_NAME_LEADERS = new Set<string>(
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
export const NOUN_NAME_LEADERS = new Set<string>(
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
export const RE_VERB_1ST_PERSON = /(?:liśmy|łyśmy|liście|łyście|łem|łam|łeś|łaś)$/;
// Nazwa parku po przymiotniku („Słowiński Park Narodowy", „Wolińskiego Parku Narodowego") —
// przymiotnik to człon nazwy, nawet gdy bywa też nazwiskiem (słowiński, woliński, magurski).
export const RE_FOLLOWED_BY_PARK = /^[ \t]+Park(?:u|iem|owi)?[ \t]+(?:Narodow|Krajobrazow)/;
