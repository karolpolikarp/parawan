// Adres siedziby instytucji: ulica z numerem (i kod pocztowy pod nią) w nagłówku urzędu, sądu czy
// działu pracodawcy albo tuż za nazwą instytucji w nawiasie. To dane podmiotu, nie osoby, więc
// zostają jawne. Kotwica jest wąska, bo wyciek adresu osoby jest gorszy niż nadmiarowa maska.
import { isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { MULTIWORD_CITIES, POLISH_CITIES } from '../dict/places.js';
import { HOMOGRAPH_SURNAMES, homographBase, isGeoAdjective, looksLikeSurname, surnameBase } from '../surnames.js';
import { MASK } from '../types.js';

// Pierwszy człon nazwy instytucji publicznej albo jednostki organizacyjnej (mianownik, jak
// w nagłówku pisma). Bez „Biuro”, „Firma”, „Usługi” czy „Kancelaria”: tak zaczynają się nazwy
// jednoosobowych firm z nazwiskiem właściciela. Bez „Gmina” i „Dzielnica”: to zwykły człon adresu
// osoby („Gmina Kobylnica⏎ul. Polna 3”), a urząd i tak zaczyna się od „Urząd Gminy”.
// Człony mocne nazywają tylko jednostki publiczne albo działy większej organizacji.
// Dopełniacz tych członów zaczyna drugi wiersz nagłówka pod organem („Dyrektor⏎Przedszkola
// Publicznego nr 33”, „Kierownik⏎Urzędu Stanu Cywilnego”).
const STRONG_HEADS = new Set<string>(
  (
    'urząd wydział dział departament ministerstwo sąd prokuratura komenda komisariat spółdzielnia ' +
    'szpital uniwersytet politechnika starostwo kuratorium inspektorat izba oddział referat delegatura ' +
    'zarząd rada archiwum sekcja kolegium kasa straż biblioteka nadleśnictwo dyrekcja ' +
    'urzędu wydziału działu departamentu ministerstwa sądu prokuratury komendy komisariatu spółdzielni ' +
    'szpitala uniwersytetu politechniki starostwa inspektoratu izby oddziału referatu delegatury ' +
    'zarządu rady archiwum sekcji kasy straży biblioteki nadleśnictwa dyrekcji ' +
    // Celownik, narzędnik i miejscownik: nazwa jako strona umowy albo adresat w środku zdania
    // („zawarta pomiędzy Urzędem Miejskim w Kórniku, pl. …”, „przekazano Wydziałowi Komunikacji, ul. …”).
    'urzędowi urzędem urzędzie wydziałowi wydziałem wydziale działowi działem dziale departamentowi ' +
    'departamentem departamencie ministerstwu ministerstwem ministerstwie sądowi sądem sądzie ' +
    'prokuraturze prokuraturą komendzie komendą komisariatowi komisariatem komisariacie spółdzielnią ' +
    'szpitalowi szpitalem szpitalu uniwersytetowi uniwersytetem uniwersytecie politechnice politechniką ' +
    'starostwu starostwem starostwie inspektoratowi inspektoratem inspektoracie izbie izbą oddziałowi ' +
    'oddziałem oddziale referatowi referatem referacie delegaturze delegaturą zarządowi zarządem ' +
    'zarządzie radzie radą sekcją kasie kasą strażą bibliotece biblioteką nadleśnictwu nadleśnictwem ' +
    'nadleśnictwie dyrekcją ' +
    // Biernik członów żeńskich („pozwał Kasę Rolniczego Ubezpieczenia Społecznego, ul. …”).
    'spółdzielnię prokuraturę komendę izbę delegaturę radę sekcję kasę bibliotekę dyrekcję'
  ).split(' '),
);
// Organ jednoosobowy albo funkcja kierującego jednostką na początku nagłówka („WÓJT GMINY KOBYLNICA”,
// „STAROSTA KŁODZKI”, „Kierownik Urzędu Stanu Cywilnego w Kielcach”, „Państwowy Powiatowy Inspektor
// Sanitarny”, „Zastępca Burmistrza”, „Dyrektor⏎Szkoły Podstawowej nr 3”). Pismo wydaje urząd, więc
// adres pod takim nagłówkiem to siedziba. Imię i nazwisko w wierszu („Dyrektor Jan Kowalski”) albo
// ogon właściciela („Dyrektor Kowalski”) dalej odbiera mu tę rolę. Bez kuratora, pełnomocnika
// i komornika: kuratorem i pełnomocnikiem strony bywa osoba prywatna z adresem zamieszkania.
// Organy terytorialne stoją z nazwą jednostki albo przymiotnikiem od niej („Burmistrz Pszczyny”,
// „Wojewoda Mazowiecki”); nazwisko za nimi („Burmistrz Kowalski”) odcina ogon właściciela.
const TERRITORIAL_HEADS = new Set<string>(
  (
    'wójt burmistrz prezydent starosta marszałek wojewoda wicewojewoda wicestarosta wiceburmistrz wiceprezydent wicemarszałek ' +
    // narzędnik: organ reprezentujący stronę umowy („Skarbem Państwa – Starostą Kłodzkim, ul. …”)
    'wójtem burmistrzem prezydentem starostą marszałkiem wojewodą'
  ).split(' '),
);
// Jednostka samorządu albo Skarb Państwa jako strona umowy w narzędniku („zawarta pomiędzy: Gminą
// Pszczyna, ul. Rynek 2”, „Gminą Miasta Sanoka”, „Powiatem Kłodzkim”, „Miastem Stołecznym Warszawa”).
// Mianownik („Gmina Kobylnica⏎ul. Polna 3”) bywa członem adresu osoby, więc liczy się tylko jako
// strona z reprezentantem w tym samym wierszu (partyUnitRepresented).
// Mianownik i dopełniacz (strona „w imieniu Gminy Miasta Radomia”) liczą się tylko z `party`.
const PARTY_UNITS = new Set<string>('gminą miastem powiatem województwem'.split(' '));
const PARTY_UNITS_NOMINATIVE = new Set<string>('gmina miasto powiat województwo gminy powiatu województwa'.split(' '));
// Skarb Państwa przed organem, który go reprezentuje („Skarbem Państwa – Starostą Kłodzkim”).
const RE_STATE_TREASURY = /^Skarb(?:em|u|owi)?[ \t]+Państwa(?:[ \t]*[–-][ \t]*|[ \t]*$)/u;
// Funkcje kierującego jednostką: organem są tylko z dopełniaczem jednostki albo organu w tym samym
// wierszu („Kierownik Urzędu Stanu Cywilnego”, „Zastępca Wójta”, „Sekretarz Gminy”, „Dyrektor
// Miejskiego Ośrodka”). „Kierownik Budowy” czy „Dyrektor Handlowy” to stanowisko w firmie. Sam wyraz
// w wierszu („Dyrektor⏎Przedszkola Publicznego nr 33”) ma stopień 1 i liczy się tylko z nazwą pod nim.
const UNIT_HEADS = new Set<string>(
  'kierownik kierowniczka naczelnik naczelniczka dyrektor dyrektorka wicedyrektor komendant zastępca sekretarz skarbnik'.split(' '),
);
// Dopełniacz organu po „Zastępca”, „Sekretarz” czy „Skarbnik” („Zastępca Wójta”, „Skarbnik Miasta”).
const ORGAN_GENITIVES = new Set<string>(
  'wójta burmistrza prezydenta starosty marszałka wojewody straży urzędu biura centrum zespołu ośrodka szkoły przedszkola'.split(' '),
);
// Inspektor jest organem tylko z przymiotnikiem urzędu („Państwowy Powiatowy Inspektor Sanitarny”,
// „Powiatowy Inspektor Nadzoru Budowlanego”, „Okręgowy Inspektor Pracy”); sam „Inspektor Nadzoru”
// bywa osobą prywatną z uprawnieniami.
const RE_INSPECTOR_ORGAN = /^(?:(?:Państwow|Powiatow|Wojewódzk|Główn|Okręgow|Graniczn|Weterynaryjn)\p{L}*[ \t]+){1,2}Inspektor(?!\p{L})/iu;
const RE_OFFICE_ADJ_WORD = /^(?:Publiczn|Miejsk|Gminn|Powiatow|Wojewódzk|Samorządow|Państwow|Główn|Okręgow|Rejonow|Krajow|Regionaln|Komunaln)\p{L}*$/iu;
// Organ terytorialny, po którym przymiotnik od powiatu albo województwa to nazwa urzędu
// („STAROSTA KŁODZKI”, „Wojewoda Mazowiecki”), a nie nazwisko właściciela.
const TERRITORIAL_ORGANS = new Set<string>('starosta wojewoda wicestarosta wicewojewoda marszałek starostą wojewodą marszałkiem'.split(' '));

/** Stopień nagłówka z organem: 2 dla organu z jednostką („Wójt Gminy Firlej”, „Kierownik Referatu
 *  Podatków”), 1 dla samej funkcji w wierszu („Dyrektor”), 0 gdy wiersz nie zaczyna się organem. */
function organLevel(ws: string[]): NameLevel {
  const lower = ws.map((w) => w.toLowerCase().replace(/[,.;]+$/u, ''));
  if (RE_INSPECTOR_ORGAN.test(ws.join(' '))) return 2;
  const first = lower[0];
  if (TERRITORIAL_HEADS.has(first)) return ws.length > 1 ? 2 : 0;
  if (!UNIT_HEADS.has(first)) return 0;
  if (ws.length === 1) return 1;
  const next = lower[1];
  if (STRONG_HEADS.has(next) || WEAK_HEADS.has(next) || PLACE_GOVERNORS.has(next) || ORGAN_GENITIVES.has(next)) return 2;
  return RE_OFFICE_ADJ_WORD.test(next) ? 2 : 0;
}
// Człony słabe tak samo zaczynają nazwę firmy jednoosobowej („Szkoła Jazdy KOWALSKI”, „Przychodnia
// Weterynaryjna Wilk”, „Żłobek Domowy Ewy”), więc same nie robią z adresu siedziby. Potrzebny jest
// znacznik placówki publicznej (RE_PUBLIC_MARKER).
const WEAK_HEADS = new Set<string>(
  (
    'szkoła ośrodek przychodnia instytut akademia żłobek przedszkole poradnia gabinet studio zespół zakład ' +
    'szkoły ośrodka przychodni instytutu akademii żłobka przedszkola poradni zespołu zakładu ' +
    'szkole szkołą ośrodkowi ośrodkiem ośrodku przychodnią instytutowi instytutem instytucie akademią ' +
    'żłobkowi żłobkiem żłobku przedszkolu przedszkolem poradnią zespołowi zespołem zespole zakładowi ' +
    'zakładem zakładzie ' +
    // Centrum, przedsiębiorstwo, dom i agencja („Powiatowe Centrum Pomocy Rodzinie”, „Przedsiębiorstwo
    // Gospodarki Komunalnej”, „Dom Pomocy Społecznej”) we wszystkich przypadkach.
    'centrum przedsiębiorstwo przedsiębiorstwa przedsiębiorstwu przedsiębiorstwem przedsiębiorstwie ' +
    'dom domu domowi domem agencja agencji agencją agencję'
  ).split(' '),
);
// Słabe człony, którymi zwykle zaczyna się nazwa działalności osoby („Zakład Fryzjerski w Kole”,
// „Gabinet Weterynaryjny w Kole”, „Centrum Urody w Kole”, „Dom Weselny w Kole”): sama miejscowość
// po „w” nie robi z nich placówki publicznej. Potrzebny przymiotnik organu, numer, patron albo
// dziedzina usługi publicznej (RE_PUBLIC_MARKER_STRICT).
const BUSINESS_WEAK_HEADS = new Set<string>(
  (
    'zakład zakładu zakładowi zakładem zakładzie gabinet studio centrum przedsiębiorstwo przedsiębiorstwa ' +
    'przedsiębiorstwu przedsiębiorstwem przedsiębiorstwie dom domu domowi domem agencja agencji agencją agencję'
  ).split(' '),
);
// Znacznik placówki publicznej przy słabym członie: numer, patron, miejscowość po „w”, przymiotnik
// organu prowadzącego, SP ZOZ, uczelnia, ośrodek pomocy społecznej. „Niepubliczne”
// się nie liczy (przed znacznikiem nie może stać litera). Bez względu na wielkość liter: nagłówek
// bywa pisany wersalikami („SZKOŁA PODSTAWOWA NR 5”) albo z „Nr”.
const PUBLIC_ADJ = String.raw`(?:Publiczn|Miejsk|Gminn|Powiatow|Wojewódzk|Samodzieln|Państwow|Narodow|Badawcz)\p{L}*`;
const RE_PUBLIC_ADJ_WORD = new RegExp(`^${PUBLIC_ADJ}$`, 'u');
// Forma spółki prawa handlowego („Miejskie Przedsiębiorstwo Komunikacyjne sp. z o.o.”, „Wodociągi
// Miejskie S.A.”): numer i adres spółki to nie dane osoby fizycznej.
const COMPANY_FORM = String.raw`sp\.[ \t]*z[ \t]*o\.[ \t]*o\.|S\.A\.`;
const PUBLIC_MARKER_BASE =
  String.raw`nr[ \t]*(?:\d|[IVXL]+(?!\p{L}))|im\.|imienia(?!\p{L})|pw\.|${PUBLIC_ADJ}|` +
  String.raw`SP[ \t]*ZOZ|Uniwersytet\p{L}*|Politechni\p{L}*|Pomocy[ \t]+Społecznej|[MG]?OPS(?!\p{L})|MOPR(?!\p{L})|PCPR(?!\p{L})`;
const PLACE_MARKER = String.raw`we?[ \t]+\p{Lu}`;
const markerRe = (alts: string[]): RegExp => new RegExp(String.raw`(?<![\p{L}.])(?:${alts.join('|')})`, 'iu');
// Pełny znacznik; bez miejscowości po „w” dla członów działalności (BUSINESS_WEAK_HEADS) i numerów
// podmiotu (NIP, REGON firmy osoby to jej dane). „Niepubliczny Zakład Opieki Zdrowotnej”, „Prywatne
// Przedszkole”: placówka prywatna, często działalność osoby, więc forma spółki ani dziedzina usługi
// jej nie upubliczniają.
const RE_PUBLIC_MARKER = markerRe([PLACE_MARKER, PUBLIC_MARKER_BASE, COMPANY_FORM]);
const RE_PUBLIC_MARKER_NON_PUBLIC = markerRe([PLACE_MARKER, PUBLIC_MARKER_BASE]);
const RE_PUBLIC_MARKER_STRICT = markerRe([PUBLIC_MARKER_BASE, COMPANY_FORM]);
const RE_PUBLIC_MARKER_STRICT_NON_PUBLIC = markerRe([PUBLIC_MARKER_BASE]);
const RE_NON_PUBLIC = /(?<!\p{L})(?:Niepubliczn|Prywatn)\p{L}*/iu;
// Dziedzina usługi komunalnej jako cała nazwa jednostki tuż za członem („Zakład Gospodarki Komunalnej”,
// „Przedsiębiorstwo Wodociągów i Kanalizacji”, „Zakład Ubezpieczeń Społecznych”, „Ośrodek Sportu
// i Rekreacji”, „Przedsiębiorstwo Energetyki Cieplnej”, „Zakład Komunalny”). Tylko stałe nazwy jednostek
// gminy i państwa, które zwykła działalność osoby nie nosi: same „Kultury”, „Komunikacji”, „Opieki
// Zdrowotnej”, „Oczyszczania”, „Kanalizacji” czy „Usług Komunalnych” to także nazwy firm („Studio
// Komunikacji Wizualnej”, „Przychodnia Opieki Zdrowotnej „Rodzina””, „Zakład Usług Komunalnych „Czysto””).
// Za dziedziną kończy się nazwa: najwyżej miejscowość po „w”, jednostka („Gminy Kobylnica”), oddział
// („Zakład Ubezpieczeń Społecznych Oddział w Kole”), numer, patron albo forma spółki. Dalszy wyraz z wielkiej litery („Dom Kultury Fizycznej”, „Zakład Wodociągów
// i Kanalizacji Usługi”) albo nazwa w cudzysłowie to już nazwa firmy.
const DOMAIN_HEADS = new Set<string>(
  (
    'zakład zakładu zakładowi zakładem zakładzie przedsiębiorstwo przedsiębiorstwa przedsiębiorstwu ' +
    'przedsiębiorstwem przedsiębiorstwie ośrodek ośrodka ośrodkowi ośrodkiem ośrodku zespół zespołu ' +
    'zespołowi zespołem zespole centrum'
  ).split(' '),
);
// Instytucja kultury samorządu: „Dom Kultury”, „Ośrodek Kultury”, „Centrum Kultury” bez dalszego
// dopowiedzenia (poza miejscowością, jednostką, numerem czy patronem).
const CULTURE_HEADS = new Set<string>('dom domu domowi domem ośrodek ośrodka ośrodkowi ośrodkiem ośrodku centrum'.split(' '));
const NAME_END = String.raw`(?:[ \t]*$|[ \t]+(?:we?[ \t]+\p{Lu}|nr|im\.|imienia|dla|${COMPANY_FORM}|sp\.|spółka|SP[ \t]*ZOZ|(?:Gminy|Miasta|Powiatu|Województwa|m\.[ \t]*st\.|Oddział(?:u|em)?)(?:[ \t]+\p{Lu}|[ \t]*$)))`;
const RE_PUBLIC_DOMAIN = new RegExp(
  String.raw`^(?:Gospodarki[ \t]+(?:Komunalnej|Mieszkaniowej|Lokalowej|Nieruchomościami|Wodnej)|` +
    String.raw`Ubezpiecze(?:ń[ \t]+Społecznych|nia[ \t]+Społecznego)|Pomocy[ \t]+Rodzinie|Wodociągów[ \t]+i[ \t]+Kanalizacji|` +
    String.raw`Energetyki[ \t]+Cieplnej|Sportu[ \t]+i[ \t]+Rekreacji|Oczyszczania[ \t]+Miasta|` +
    String.raw`Komunaln(?:y|a|e|ego|ej|emu|ym))(?![\p{L}])${NAME_END}`,
  'iu',
);
const RE_CULTURE_DOMAIN = new RegExp(String.raw`^Kultury(?![\p{L}])${NAME_END}`, 'iu');
/** Czy za członem z DOMAIN_HEADS (albo instytucji kultury) stoi stała nazwa jednostki komunalnej,
 *  na której nazwa się kończy? Bez cudzysłowu w nazwie i bez „Niepubliczny”/„Prywatny”. */
function publicDomain(ws: string[]): boolean {
  if (ws.join(' ').search(/[„"”«]/u) >= 0) return false;
  for (let i = 0; i < Math.min(ws.length - 1, 3); i++) {
    const w = ws[i].toLowerCase();
    const rest = ws.slice(i + 1).join(' ');
    if (DOMAIN_HEADS.has(w) && RE_PUBLIC_DOMAIN.test(rest)) return true;
    if (CULTURE_HEADS.has(w) && RE_CULTURE_DOMAIN.test(rest)) return true;
  }
  return false;
}
function publicMarker(s: string, strict: boolean): boolean {
  const nonPublic = RE_NON_PUBLIC.test(s);
  if (!nonPublic && publicDomain(s.split(/[ \t]+/))) return true;
  if (strict) return (nonPublic ? RE_PUBLIC_MARKER_STRICT_NON_PUBLIC : RE_PUBLIC_MARKER_STRICT).test(s);
  return (nonPublic ? RE_PUBLIC_MARKER_NON_PUBLIC : RE_PUBLIC_MARKER).test(s);
}
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
  if (PLACE_GOVERNORS.has(lower[end - 2]) || PARTY_UNITS.has(lower[end - 2]) || PARTY_UNITS_NOMINATIVE.has(lower[end - 2])) return false;
  const bare = lower[end - 1];
  if (TERRITORIAL_ORGANS.has(lower[end - 2]) && isGeoAdjective(bare)) return false;
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

/** Stopień nazwy jednostki samorządu jako strony umowy („Gminą Pszczyna”, „Gminą Miasta Sanoka”,
 *  „Powiatem Kłodzkim”, „Miastem Stołecznym Warszawa”): 2, gdy za jednostką stoi sama nazwa miejsca
 *  (wyrazy z wielkiej litery, łącznik „nad/pod”), 0, gdy w nazwie stoi imię; -1, gdy wiersz nie
 *  zaczyna się jednostką. Mianownik liczy się tylko z `party`. */
function partyUnitLevel(s: string, party: boolean): -1 | 0 | 2 {
  const ws = s.split(/[ \t]+/);
  const first = ws[0].toLowerCase();
  if (!PARTY_UNITS.has(first) && !(party && PARTY_UNITS_NOMINATIVE.has(first))) return -1;
  if (ws.length < 2 || ws.length > 6 || !/^\p{Lu}/u.test(ws[1])) return 0;
  const rest = ws.slice(1);
  if (rest.some((w) => !/^\p{Lu}/u.test(w) && !NAME_LOWER_WORDS.has(w) && w !== 'nad')) return 0;
  return hasFirstName(rest) ? 0 : 2;
}

/** Czy fragment wiersza to sama nazwa instytucji („Urząd Miasta Łodzi”, „Wydział Finansowy”,
 *  „Powiatowy Urząd Pracy”), i jakiego stopnia? Człon z listy wśród trzech pierwszych wyrazów, bez
 *  etykiety, maski osoby, adresu e-mail, bez wyrazów z małej litery spoza spójników i przyimków
 *  nazwy („Szpital przyjął pacjenta…” to zdanie), bez imienia w mianowniku („Zakład Usług
 *  Remontowych Jan Kowalski”, „Przychodnia Lekarska Kowalski Jan” to firma osoby) i bez ogonu
 *  właściciela („Szkoła Jazdy KOWALSKI”, „Przychodnia Weterynaryjna Wilk”). Jednostka samorządu
 *  w narzędniku („Gminą Pszczyna”, „Powiatem Kłodzkim”) i Skarb Państwa („Skarbem Państwa – Starostą
 *  Kłodzkim”) to strona umowy, stopień 2; mianownik („Gmina Pszczyna”) tylko z `party` (strona
 *  z reprezentantem w tym samym wierszu). `strictMarker`: słaby człon wymaga znacznika innego niż
 *  sama miejscowość po „w” (numery podmiotu: NIP gabinetu czy szkoły jazdy to NIP osoby).
 *  Wynik zależy tylko od argumentów i stałych słowników, więc liczony raz na napis: ta sama nazwa
 *  przy każdym adresie pisma wraca w kilku przebiegach (kod, miejscowość, ochrona ulic). */
export function institutionNameLevel(line: string, party = false, strictMarker = false): NameLevel {
  if (line.length > 200) return institutionNameLevelNow(line, party, strictMarker);
  const key = `${party ? 1 : 0}${strictMarker ? 1 : 0}${line}`;
  let r = nameLevelMemo.get(key);
  if (r === undefined) {
    if (nameLevelMemo.size >= 4096) nameLevelMemo.clear();
    r = institutionNameLevelNow(line, party, strictMarker);
    nameLevelMemo.set(key, r);
  }
  return r;
}
const nameLevelMemo = new Map<string, NameLevel>();
function institutionNameLevelNow(line: string, party: boolean, strictMarker: boolean): NameLevel {
  const s = line.trim().replace(RE_CITY_MASK, 'Miejscowość');
  if (s.length < 4 || s.length > 100 || !/^\p{Lu}/u.test(s)) return 0;
  if (/[:@[\]]/u.test(s) || RE_RESIDENCE_LABEL.test(s)) return 0;
  const treasury = RE_STATE_TREASURY.exec(s);
  if (treasury) {
    const rest = s.slice(treasury[0].length);
    if (rest.length === 0) return party || /^Skarbem/u.test(s) ? 2 : 0;
    return organLevel(rest.split(/[ \t]+/)) === 2 ? institutionNameLevel(rest) : 0;
  }
  const partyLevel = partyUnitLevel(s, party);
  if (partyLevel >= 0) return partyLevel as NameLevel;
  // Łącznik wewnątrz wyrazu zostaje („Sąd Rejonowy dla Łodzi-Śródmieścia”), osobny myślnik nie.
  if (/[:@[\]]|(?<!\p{L})-|-(?!\p{L})/u.test(s) || RE_RESIDENCE_LABEL.test(s)) return 0;
  const ws = s.split(/[ \t]+/);
  const heads = ws
    .slice(0, 3)
    .filter((w) => /^\p{Lu}/u.test(w))
    .map((w) => w.toLowerCase());
  const organ = organLevel(ws);
  const strong = organ === 2 || heads.some((w) => STRONG_HEADS.has(w));
  if (!strong && organ === 0 && !heads.some((w) => WEAK_HEADS.has(w))) return 0;
  if (ws.some((w) => /^\p{Ll}/u.test(w) && !NAME_LOWER_WORDS.has(w.toLowerCase()))) return 0;
  if (hasFirstName(ws) || ownerTail(ws, strong)) return 0;
  if (organ === 1) return 1;
  if (strong) return 2;
  return publicMarker(s, strictMarker || heads.some((w) => BUSINESS_WEAK_HEADS.has(w))) ? 2 : 1;
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
  String.raw`^(?:${PUBLIC_ADJ}|(?:Polsk|Skarbow|Pożarn|Graniczn|Generaln|Regionaln|Główn|Okręgow|Rejonow|Krajow|Komunaln)\p{L}*)$`,
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

// Nazwa instytucji z przecinkiem tuż przed adresem: od początku wiersza, nawiasu, zdania, po
// dwukropku, numerze punktu, przecinku albo w poprzedniej komórce tabeli („(Spółdzielnia Mieszkaniowa
// „Przyszłość”, ul. Wspólna 1)”, „Do wiadomości: Zarząd Mienia Komunalnego, ul. …”, „2. Zakład
// Gospodarki Komunalnej sp. z o.o., ul. …”, „pok. 12, Urząd Miejski w Andrychowie, ul. …”,
// „| Urząd Skarbowy w Gliwicach | ul. …”). Odcinki dzielą przecinek, średnik, dwukropek, nawias,
// kreska tabeli, nowy wiersz i kropka z odstępem. Kropka skrótu ulicy i skrótu w nazwie („ds.”,
// „im.”, „sp. z o.o.”, „św.”) odcinka nie kończy: w „…, ul. Hejmowskiego 2. Starostwo Powiatowe
// Turek, ul. Kaliska 59” nazwa zaczyna się po „2.”, a nie po „ul.”.
const RE_SEG_BREAK = /[,;:()|\n]|[.!?](?=[ \t])/gu;
const DOT_IN_NAME = new Set<string>('ul al pl os ds d/s im sp o.o m.st św pw bł ks'.split(' '));
const RE_LAST_TOKEN = /(?:^|[ \t(„"])([^ \t(„"]*)$/u;
type Segment = { text: string; start: number; sep: string };
/** Odcinki tekstu (od lewej) z separatorem, który stoi przed każdym z nich ('' dla pierwszego). */
function segmentsOf(body: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let sep = '';
  RE_SEG_BREAK.lastIndex = 0;
  for (let m = RE_SEG_BREAK.exec(body); m; m = RE_SEG_BREAK.exec(body)) {
    if (m[0] === '.') {
      const tok = RE_LAST_TOKEN.exec(body.slice(Math.max(0, m.index - 8), m.index))?.[1].toLowerCase() ?? '';
      if (DOT_IN_NAME.has(tok)) continue;
    }
    out.push({ text: body.slice(last, m.index), start: last, sep });
    sep = m[0];
    last = m.index + 1;
  }
  out.push({ text: body.slice(last), start: last, sep });
  return out;
}
/** Czy odcinek po przecinku dopowiada nazwę komórki tej samej instytucji („Wydział Geodezji”,
 *  „Kartografii i Katastru”): same wyrazy z wielkiej litery albo spójniki nazwy, bez cyfr i imion. */
function nameContinuation(seg: string): boolean {
  const ws = seg.trim().split(/[ \t]+/);
  if (ws.length === 0 || ws.length > 6 || !/^\p{Lu}/u.test(ws[0]) || /[\d@[\]]/u.test(seg)) return false;
  if (ws.some((w) => !/^\p{Lu}/u.test(w) && !NAME_LOWER_WORDS.has(w.toLowerCase()))) return false;
  // Nazwisko na liście za instytucją („Urząd Skarbowy w Kole, Kowalski, NIP …”) to nie dopowiedzenie.
  return !hasFirstName(ws) && !ws.some((w) => surnameLike(w.replace(/[,.;]+$/u, '').toLowerCase()));
}
function surnameLike(w: string): boolean {
  if (STRONG_HEADS.has(w) || WEAK_HEADS.has(w) || PLACE_GOVERNORS.has(w) || NAME_LOWER_WORDS.has(w)) return false;
  return !!surnameBase(w) || HOMOGRAPH_SURNAMES.has(w) || looksLikeSurname(w);
}
// Strona umowy z reprezentantem dalej w wierszu („Gmina Pszczyna, ul. Rynek 2, …, reprezentowana przez
// Burmistrza”): mianownik jednostki samorządu to wtedy strona, nie człon adresu osoby.
// Forma „reprezentowan…” musi zgadzać się rodzajem z jednostką: „Gmina … reprezentowana”, „Miasto …
// reprezentowane”, „Powiat …”, „Skarb Państwa … reprezentowany”. „Skarżący Jan Kowalski (Gmina
// Kobylnica, ul. Polna 3), reprezentowany przez …” to osoba z adresem w gminie i jej pełnomocnik.
const RE_REPRESENTED = /(?<!\p{L})reprezentowan(\p{L}*)/u;
const REPRESENTED_ENDINGS: Record<'f' | 'n' | 'm', string[]> = {
  f: ['a', 'ej', 'ą'],
  n: ['e', 'ego', 'emu', 'ym'],
  m: ['y', 'ego', 'emu', 'ym'],
};
function unitGender(first: string): 'f' | 'n' | 'm' {
  if (first.startsWith('gmin')) return 'f';
  if (first.startsWith('miast') || first.startsWith('wojew')) return 'n';
  return 'm';
}
function representedAfter(t: string, end: number, first: string): boolean {
  let s = t.slice(end, end + 240);
  const eol = s.indexOf('\n');
  if (eol >= 0) s = s.slice(0, eol);
  const m = RE_REPRESENTED.exec(s);
  return !!m && REPRESENTED_ENDINGS[unitGender(first)].includes(m[1].toLowerCase());
}
// Strona po „w imieniu” albo „na rzecz” (dopełniacz jednostki samorządu: „w imieniu Gminy Miasta Radomia”).
const RE_ON_BEHALF = /(?<!\p{L})(?:imieniu|rzecz)[ \t]*$/iu;
// Mieszkaniec, mieszkanka, mieszkańcy w zdaniu przed nazwą jednostki: adres za nią to adres osoby.
const RE_RESIDENT_WORD = /(?<!\p{L})mieszka[nń]\p{L}*/iu;
const SENTENCE_PREPOSITIONS = new Set<string>('pomiędzy między do z ze w we przez dla od przy wobec'.split(' '));
/** Nazwa z wielkiej litery po wyrazach z małej litery w tym samym odcinku („przekazano do Zakładu
 *  …”); null, gdy odcinek nie ma takiego początku. */
function nameInSentence(seg: string): string | null {
  const ws = seg.trim().split(/[ \t]+/);
  // Przyimek na początku zdania („Pomiędzy Powiatem Bialskim, ul. …”, „Do Urzędu Gminy …”).
  if (ws.length > 1 && SENTENCE_PREPOSITIONS.has(ws[0].toLowerCase()) && /^\p{Lu}/u.test(ws[1])) return ws.slice(1).join(' ');
  // Pierwszy wyraz zdania bywa z wielkiej litery („Pismo skierowano do Urzędu…”).
  let i = ws.length > 1 && /^\p{Lu}/u.test(ws[0]) && /^\p{Ll}/u.test(ws[1]) ? 1 : 0;
  const lead = i;
  while (i < ws.length && /^\p{Ll}/u.test(ws[i])) i++;
  if (i === lead || i >= ws.length || i > 8) return null;
  // Same spójniki nazwy („Kartografii i Katastru”) to dalszy ciąg nazwy, nie zdanie. Przyimek już tak:
  // „Pismo do Miejskiego Ośrodka Sportu…”, „Zgłoszenie do Miejskiego Zakładu Komunikacji…”.
  if (ws.slice(lead, i).every((w) => w === 'i' || w === 'oraz')) return null;
  return ws.slice(i).join(' ');
}
const RE_INLINE_TAIL = /([,|])[ \t]*$/u;
// Stanowisko urzędnika przed nazwą urzędu, w którym pracuje („inspektor ds. oświaty”, „starszy
// referent”, „kierownik referatu”, „pracownik socjalny”).
export const RE_OFFICIAL_ROLE =
  /^(?:(?:starsz|młodsz|główn)\p{L}*[ \t]+)?(?:podinspektor|inspektor|referent|specjalist|kierowni[kc]|naczelni[kc]|sekretarz|skarbnik|dyrektor|zastępc|pracowni[kc]|urzędni[kc]|radc|asystent|koordynator|komendant|kontroler|ewidencjoner|archiwist|informatyk|księgow)\p{L}*(?![\p{L}])/iu;
// Nagłówek kolumny adresu osoby w tabeli („Adres zamieszkania”, „Zam.”, „Adres do doręczeń”).
const RE_RESIDENCE_HEADER = /(?<!\p{L})(?:zam\.|zamieszk|zameldow|mieszka|doręcze|korespondenc)/iu;
const TABLE_ROW_MAX = 600;
const RE_TABLE_SEPARATOR_ROW = /^[ \t|:+-]+$/u;
/** Czy w wierszu tabeli (wiersz zaczyna się kreską) w komórkach przed nazwą na pozycji `nameStart`
 *  stoi osoba albo kolumna z pozycją `colPos` ma w nagłówku etykietę zamieszkania? Poza tabelą false. */
function tableRowPerson(t: string, nameStart: number, probe: PersonProbe | undefined, colPos: number): boolean {
  // Wiersz tabeli ma kreskę tuż przed nazwą albo wcześniej w komórkach. Początek wiersza szukany
  // najdalej TABLE_ROW_MAX znaków wstecz: dłuższy wiersz to nie wiersz tabeli, a szukanie przez cały
  // długi wiersz przy każdym adresie dawałoby czas kwadratowy.
  const limit = Math.max(0, nameStart - TABLE_ROW_MAX);
  const nl = t.slice(limit, nameStart).lastIndexOf('\n');
  if (nl < 0 && limit > 0) return false;
  const ls = nl < 0 ? 0 : limit + nl + 1;
  if (!/^[ \t]*\|/u.test(t.slice(ls, ls + 8))) return false;
  const prefix = t.slice(ls, nameStart);
  if (personInSentence(prefix.split('|'), probe)) return true;
  const col = t.slice(ls, colPos).split('|').length - 1;
  let header: string | undefined;
  for (const l of linesAbove(t, ls, 60)) {
    if (!/^[ \t]*\|/u.test(l)) break;
    if (!RE_TABLE_SEPARATOR_ROW.test(l)) header = l;
  }
  const cell = header?.split('|')[col];
  return cell !== undefined && RE_RESIDENCE_HEADER.test(cell);
}
/** Czy tuż przed pozycją `end` (za przecinkiem albo kreską tabeli) stoi nazwa instytucji stopnia 2,
 *  ewentualnie z dopowiedzeniem komórki po przecinku, a nad nią i w niej nie stoi osoba? `from` to
 *  początek okna (windowBefore). Wspólne dla ulicy siedziby i numerów NIP/REGON przy nazwie. */
function inlineInstitutionBefore(t: string, from: number, end: number, lineStart: () => number, probe: PersonProbe | undefined, street: boolean): boolean {
  const before = t.slice(from, end);
  const tail = RE_INLINE_TAIL.exec(before);
  if (!tail) return false;
  const segs = segmentsOf(before.slice(0, tail.index));
  let j = segs.length - 1;
  // Numer podmiotu (NIP, REGON) przy słabym członie wymaga znacznika innego niż „w <Miejscowość>”.
  const strict = !street;
  // Mianownik jednostki samorządu jako strona (`party`): reprezentant dalej w wierszu zgodny rodzajem
  // z jednostką, a przed nazwą w oknie żadnej osoby, także za nawiasem, średnikiem czy kropką
  // („Skarżąca Anna Nowak (Gmina Kobylnica, ul. Polna 3), reprezentowana przez adw. …” to adres
  // skarżącej). Łańcuch przecinków niżej tego nie widzi, bo kończy się na nawiasie.
  const levelOf = (k: number): NameLevel => {
    const seg = segs[k].text;
    const l = institutionNameLevel(seg, false, strict);
    if (l === 2) return l;
    const first = seg.trim().split(/[ \t]/, 1)[0].toLowerCase();
    if (!(PARTY_UNITS_NOMINATIVE.has(first) || first === 'skarb') || !representedAfter(t, end, first)) return l;
    const pl = institutionNameLevel(seg, true, strict);
    return pl === 2 && personInSentence([before.slice(0, segs[k].start)], probe) ? 0 : pl;
  };
  let level = levelOf(j);
  for (let k = 0; level < 2 && k < 2 && j > 0 && segs[j].sep === ',' && nameContinuation(segs[j].text); k++) {
    j--;
    level = levelOf(j);
  }
  if (level < 2 && tail[1] === ',') {
    // Nazwa w zdaniu po wyrazach z małej litery („przekazano do Samodzielnego Publicznego Zakładu
    // Opieki Zdrowotnej w Kole, ul. …”, „umowa zawarta z Gminą Pszczyna, ul. …, NIP …”): siedziba
    // i numer tylko bez osoby w całym zdaniu, przed nazwą i za nią („Jan Kowalski, uczeń Szkoły…, ul. …”).
    const inSentence = nameInSentence(segs[segs.length - 1].text);
    if (inSentence !== null) {
      // Dopełniacz jednostki samorządu jako strona tylko po „w imieniu” albo „na rzecz” („w imieniu
      // Gminy Miasta Radomia, ul. …”); „mieszkaniec Gminy Kobylnica, ul. …” to adres osoby.
      const segText = segs[segs.length - 1].text;
      const onBehalf = RE_ON_BEHALF.test(segText.slice(0, segText.lastIndexOf(inSentence)));
      if (institutionNameLevel(inSentence, onBehalf, strict) < 2) return false;
      if (tableRowPerson(t, from + segs[segs.length - 1].start, probe, end)) return false;
      const cut = Math.max(sentenceStart(before), before.lastIndexOf(';') + 1, before.lastIndexOf('|') + 1, before.lastIndexOf('\n') + 1);
      const sentence = before.slice(cut);
      if (RE_RESIDENCE_LABEL.test(sentence) || RE_RESIDENT_WORD.test(sentence)) return false;
      if (personInSentence([sentence, sentenceAfterStreet(t, end)], probe)) return false;
      return true;
    }
  }
  if (level < 2) return false;
  // W komórce tabeli tylko mocny człon albo organ: szkoła czy przychodnia w kolumnie obok adresu bywa
  // placówką ucznia albo pacjenta, a adres w następnej kolumnie jego adresem.
  if (tail[1] === '|' && !strongName(segs[j].text.trim().split(/[ \t]+/)) && partyUnitLevel(segs[j].text.trim(), false) !== 2) return false;
  // Wiersz tabeli: osoba w komórce przed nazwą („| Jan Kowalski | Urząd Gminy Mielnik | ul. Polna 3 |”)
  // albo nagłówek kolumny z etykietą zamieszkania („| Pracodawca | Adres zamieszkania |”): urząd to
  // wtedy pracodawca albo adresat osoby, a adres w kolumnie obok jej adresem.
  if (tableRowPerson(t, from + segs[j].start, probe, end)) return false;
  const nameText = segs.slice(j).map((sg) => sg.text.trim()).join(', ');
  // Pierwszy odcinek okna: okno mogło uciąć wiersz, więc nazwa liczy się tylko od prawdziwego
  // początku wiersza. Wtedy wiersz wyżej nie może wskazywać osoby („Jan Kowalski⏎Spółdzielnia…, ul.”)
  // ani blok nie może mieć etykiety adresata („Dla:⏎Wydział Komunikacji, ul. Lipowa 8”).
  // Nazwa w środku wiersza za osobą w tym samym zdaniu („Jan Kowalski, przedstawiciel, Urząd Miasta,
  // ul. …”, „Pan Jan Nowak, Urząd Gminy, ul. …”): adres bywa wtedy adresem tej osoby. Zostaje jawny
  // tylko za stanowiskiem urzędnika tuż przed nazwą („Marta Ziobro, inspektor ds. oświaty, Urząd Gminy
  // Mielnik, ul. Piaskowa 1”): to miejsce pracy, nie zamieszkania.
  // Osoby szuka się w łańcuchu odcinków po przecinkach przed nazwą, do dwukropka, średnika, nawiasu,
  // kreski tabeli albo początku wiersza: dalej stoi już inna pozycja wyliczenia.
  if (j > 0 && segs[j].sep === ',') {
    let k = j - 1;
    while (k > 0 && segs[k].sep === ',') k--;
    const chain = segs.slice(k, j).map((sg) => sg.text);
    if (personInSentence(chain, probe) && !RE_OFFICIAL_ROLE.test(segs[j - 1].text.trim())) return false;
  }
  let above: string[] = [];
  if (j === 0) {
    if (!blankBetween(t, lineStart(), from)) return false;
    above = linesAbove(t, lineStart(), 8);
    if (personLineAbove(above[0]) || above.some((l) => RE_RECIPIENT_LABEL.test(l))) return false;
  }
  return !probeFindsPerson(probe, above[0] === undefined ? [nameText] : [nameText, above[0]], above[1]);
}
// Sala z numerem w budynku przy ulicy („sala 214, budynek przy ul. Królewskiej 27”): miejsce
// spotkania w gmachu instytucji, nie mieszkanie.
const RE_ROOM_IN_BUILDING = /(?<!\p{L})sal[aię][ \t]+(?:nr[ \t]*)?\d+[a-z]?[ \t]*,[ \t]*(?:w[ \t]+)?(?:budyn\p{L}*|gmach\p{L}*)[ \t]+przy[ \t]+$/giu;
// Siedziba w zdaniu: „z siedzibą przy ul. …”, „z siedzibą w Białymstoku przy ul. …”, „w siedzibie
// przedszkola przy ul. …”. Grupa 1 to wyrazy po „w siedzibie” (właściciel siedziby), bez niej właściciel
// stoi przed „z siedzibą”.
const RE_SEAT_BEFORE_STREET =
  /(?<!\p{L})(?:[Zz][ \t]+siedzibą|[Ww][ \t]+siedzibie((?:[ \t]+[^\s,;:()]+){1,5}?)?)(?:[ \t]+w[ \t]+\p{Lu}[\p{L}-]*(?:[ \t]+\p{Lu}[\p{L}-]*)?[ \t]*,?)?[ \t]+(?:przy[ \t]+)?$/gu;
// Ogólne odesłanie do jednostki małą literą po „w siedzibie” („w siedzibie przedszkola”, „w siedzibie
// urzędu gminy”, „w siedzibie ośrodka pomocy społecznej”). Tylko dopełniacze jednostek publicznych:
// bez zakładu, centrum, akademii, fundacji, gabinetu i firmy, bo tak nazywa się też działalność osoby.
const SEAT_GENERIC_HEADS = new Set<string>(
  (
    'urzędu starostwa sądu prokuratury komendy komisariatu spółdzielni szkoły przedszkola żłobka szpitala ' +
    'uniwersytetu politechniki biblioteki zarządu inspektoratu kuratorium izby gminy ośrodka organu ' +
    'wydziału referatu delegatury oddziału archiwum'
  ).split(' '),
);
// Dalsze wyrazy takiego odesłania: jednostka podziału, „pomocy społecznej”, przymiotnik urzędu.
const SEAT_GENERIC_TAIL = new Set<string>('gminy miasta powiatu województwa pomocy społecznej rodzinie stanu cywilnego'.split(' '));
// Osoba w zdaniu przy siedzibie: zwrot grzecznościowy albo maska osoby z wcześniejszego przebiegu.
const RE_PERSON_TITLE = /(?<!\p{L})(?:Pan|Pani|Pana|Panu|Panią|Panem|Państwo|Państwa)(?!\p{L})/u;
// Granica zdania: kropka, wykrzyknik albo pytajnik po słowie (nie po skrócie „ul.” czy „nr”) albo
// po liczbie, przed wielką literą.
const RE_SENTENCE_END = /(?<=\p{Ll}{3}|\d|[”"»)])[.!?](?=[ \t]+\p{Lu}|[ \t]*$)/gu;
// Ta sama granica na początku odcinka, gdy znak przed nią (numer domu) został za cięciem.
const RE_SENTENCE_END_LEAD = /^[ \t]*[.!?](?=[ \t]+\p{Lu}|[ \t]*$)/u;

/** Czy w odcinku zdania stoi osoba: maska osoby, imię w mianowniku, „Pan”/„Pani” albo osoba,
 *  którą zamaskuje sonda? */
function personInSentence(parts: string[], probe?: PersonProbe): boolean {
  const live = parts.map((p) => p.trim()).filter((p) => p.length > 0);
  for (const p of live) {
    if (RE_PERSON_MASK.test(p) || RE_PERSON_TITLE.test(p) || hasFirstName(p.split(/[ \t]+/))) return true;
  }
  return probeFindsPerson(probe, live);
}

/** Czy nazwa po „w siedzibie” to jednostka publiczna: nazwa własna stopnia 2 („Urzędu Gminy
 *  w Mielniku”) albo ogólne odesłanie małą literą („przedszkola”, „urzędu gminy”)? */
function seatGenericOwner(seg: string): boolean {
  const ws = seg.trim().split(/[ \t]+/);
  if (/^\p{Lu}/u.test(ws[0])) return institutionNameLevel(seg) === 2;
  if (!SEAT_GENERIC_HEADS.has(ws[0])) return false;
  return ws.slice(1).every((w) => SEAT_GENERIC_TAIL.has(w) || NAME_LOWER_WORDS.has(w) || RE_PUBLIC_ADJ_WORD.test(w));
}

/** Czy siedziba z dopasowania RE_SEAT_BEFORE_STREET należy do instytucji? Po „w siedzibie” stoi
 *  jednostka publiczna, a przed „z siedzibą” nazwa stopnia 2 z institutionNameLevel (urząd, sąd,
 *  spółdzielnia, szkoła z numerem, przedszkole miejskie), więc nazwa firmy jednoosobowej („Szkoła
 *  Jazdy Lis”, „Zakład Usługowy KOWALSKI”, „Przychodnia Weterynaryjna Wilk”) siedziby nie daje: ma
 *  słaby człon bez znacznika, ogon właściciela albo w ogóle nie jest nazwą jednostki. Do tego w tym
 *  samym zdaniu przed nazwą i za adresem nie może stać osoba („Jan Kowalski, Zakład …”, „… przy
 *  ul. Polnej 3 prowadzi Pan Jan Kowalski”). Wyjątek: nazwa z mocnym członem połączona z osobą
 *  wyrazem z małej litery („Pana Marka Sienkiewicza, administratora z ramienia Spółdzielni
 *  Mieszkaniowej”): to jednostka, w której osoba pełni funkcję, a nie jej firma. */
function seatOfInstitution(t: string, from: number, offset: number, seat: RegExpExecArray, probe?: PersonProbe): boolean {
  const lineFrom = Math.max(from, seat.index - 100);
  const before = t.slice(lineFrom, seat.index);
  const sentence = before.slice(sentenceStart(before));
  let personParts: string[];
  let linked = false;
  if (seat[1] !== undefined) {
    if (!seatGenericOwner(seat[1])) return false;
    personParts = [sentence, seat[1]];
  } else {
    const cut = Math.max(
      before.lastIndexOf(','),
      before.lastIndexOf(';'),
      before.lastIndexOf(':'),
      before.lastIndexOf('('),
      before.lastIndexOf('|'),
      before.lastIndexOf('\n'),
      sentenceStart(before) - 1,
    );
    const ws = before.slice(cut + 1).trim().split(/[ \t]+/);
    let start = -1;
    for (let i = 0; i < ws.length && start < 0; i++) {
      if (/^\p{Lu}/u.test(ws[i]) && institutionNameLevel(ws.slice(i).join(' ')) === 2) start = i;
    }
    if (start < 0) return false;
    const name = ws.slice(start);
    const prefix = ws.slice(0, start);
    // Przed nazwą wyrazy małą literą („z ramienia”, „prezes”): nazwa zależy od nich, nie jest dopowiedzeniem.
    linked = prefix.length > 0 && prefix.every((w) => !/^\p{Lu}/u.test(w)) && strongName(name);
    personParts = [before.slice(sentenceStart(before), cut + 1) + ' ' + prefix.join(' '), name.join(' ')];
  }
  const after = sentenceAfterStreet(t, offset);
  if (personInSentence([after], probe)) return false;
  return linked ? !personInSentence([personParts[1]], probe) : !personInSentence(personParts, probe);
}

/** Początek ostatniego zdania w odcinku (0, gdy w odcinku nie ma granicy zdania). */
function sentenceStart(s: string): number {
  let start = 0;
  RE_SENTENCE_END.lastIndex = 0;
  for (let m = RE_SENTENCE_END.exec(s); m; m = RE_SENTENCE_END.exec(s)) start = m.index + 1;
  return start;
}

/** Czy nazwa ma mocny człon albo organ stopnia 2 („Spółdzielni Mieszkaniowej”, „Urzędu Gminy”)? */
function strongName(ws: string[]): boolean {
  const heads = ws.slice(0, 3).map((w) => w.toLowerCase());
  return organLevel(ws) === 2 || heads.some((w) => STRONG_HEADS.has(w));
}

/** Reszta zdania za ulicą z numerem (najwyżej 120 znaków, do końca wiersza albo zdania). */
function sentenceAfterStreet(t: string, offset: number): string {
  let s = t.slice(offset, offset + 160);
  const eol = s.indexOf('\n');
  if (eol >= 0) s = s.slice(0, eol);
  RE_STREET_AT.lastIndex = 0;
  const m = RE_STREET_AT.exec(s);
  if (m) s = s.slice(m[0].length);
  // Kropka tuż za numerem domu („przy ul. Rynek 14. Pani Anna Kot…”): lookbehind RE_SENTENCE_END
  // nie widzi cyfry sprzed odcinka, więc granicę zdania na samym początku łapie RE_SENTENCE_END_LEAD.
  if (RE_SENTENCE_END_LEAD.test(s)) return '';
  RE_SENTENCE_END.lastIndex = 0;
  const end = RE_SENTENCE_END.exec(s);
  return end ? s.slice(0, end.index) : s;
}
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
  const seat = execTail(RE_SEAT_BEFORE_STREET, t, from, offset);
  if (seat) return seatOfInstitution(t, from, offset, seat, probe);
  // Za przecinkiem siedzibę daje tylko nazwa stopnia 2 („Szkoła Jazdy Lis, ul. Lipowa 8” to firma).
  return inlineInstitutionBefore(t, from, offset, lineStart, probe, true);
}

// Stopień, tytuł albo godność przed imieniem patrona ulicy („gen.”, „ks.”, „św.”). Bez „im.”: ulica
// „im. Henryka Sienkiewicza” zostaje przy dotychczasowych regułach adresu.
const STREET_TITLE = String.raw`(?:gen|ks|św|kard|marsz|prof|dr|bp|abp|płk|ppłk|kpt|por|mjr|bł|hetm|kmdr|adm|inż)\.`;
/** Ulica z numerem domu: skrót albo pełne słowo, nazwa (także z liczbą albo stopniem na początku:
 *  „3 Maja”, „gen. Władysława Andersa”, „św. Jana”) i numer, ewentualnie drugi po ukośniku, łączniku
 *  albo półpauzie („Koraszewskiego 7–9”). Rynek bez skrótu ulicy („Rynek 1”, „Rynek Główny 12”) też:
 *  tak zapisuje się adres ratusza w setkach gmin. */
const HOUSE_NO_SRC = String.raw`\d+[a-zA-Z]?(?:[ \t]*[/–-][ \t]*\d+[a-zA-Z]?)?(?![\d\p{L}])`;
export const STREET_SRC = String.raw`(?<!\p{L})(?:(?:[Uu]l\.|[Aa]l\.|[Pp]l\.|[Oo]s\.|(?:[Uu]lica|[Aa]lej[ae]|[Pp]lac|[Oo]siedle)(?!\p{L}))[ \t]*(?:\d+[ \t]+|${STREET_TITLE}[ \t]*)?\p{Lu}[^\n,:;()]{0,60}?[ \t]${HOUSE_NO_SRC}|Rynek(?:[ \t]+\p{Lu}\p{Ll}+){0,2}[ \t]+${HOUSE_NO_SRC})`;
// Ulica z numerem od pozycji (do odcięcia jej od reszty zdania za siedzibą).
const RE_STREET_AT = new RegExp(STREET_SRC, 'uy');
// Pokój, piętro czy wejście za numerem („ul. Piotrkowska 104, pok. 12”) to część siedziby.
const ROOM_TAIL = String.raw`(?:[ \t]*,[ \t]*(?:pok\.|pokój|p\.|piętro|wejście|budynek|bud\.)[^\n,]{0,30})?`;
const RE_STREET_LINE = new RegExp(String.raw`^[ \t]*(${STREET_SRC})${ROOM_TAIL}[ \t]*,?[ \t]*\r?$`, 'u');
// Miejscowość (poczta) między ulicą a kodem, gdy siedziba leży we wsi z pocztą gdzie indziej
// („ul. Braci Leśnej 3, Sękocin Stary, 05-090 Raszyn”): do trzech wyrazów z wielkiej litery, także
// z łącznikiem albo „nad/pod”, albo znacznik miejscowości z pierwszego przebiegu.
const LOCALITY_SRC = String.raw`(?:\[MIEJSCOWOŚĆ\]|\p{Lu}\p{Ll}+(?:(?:[ \t]+(?:(?:nad|pod)[ \t]+)?|-)\p{Lu}\p{Ll}+){0,2})`;
const RE_STREET_BEFORE_POSTAL_INLINE = new RegExp(String.raw`(${STREET_SRC})[ \t]*,[ \t]*(?:(${LOCALITY_SRC})[ \t]*,[ \t]*)?$`, 'gu');
const RE_LOCALITY_LINE = new RegExp(String.raw`^[ \t]*(${LOCALITY_SRC})[ \t]*,?[ \t]*\r?$`, 'u');
/** Czy segment między ulicą a kodem to miejscowość, a nie imię i nazwisko („ul. Polna 3, Jan Nowak,”)
 *  ani samo nazwisko, które sonda osób rozpozna („ul. Polna 3, Nowak Kowalski,”)? */
function localitySegment(seg: string | undefined, probe?: PersonProbe): boolean {
  if (seg === undefined) return true;
  return !hasFirstName(seg.split(/[ \t-]+/)) && !probeFindsPerson(probe, [seg]);
}

/** Czy kod pocztowy na pozycji `offset` należy do adresu siedziby instytucji? Tylko razem z ulicą
 *  tej siedziby: w wierszu wyżej albo przed przecinkiem w tym samym wierszu. */
export function institutionPostalAt(t: string, offset: number, probe?: PersonProbe): boolean {
  const win = windowBefore(t, offset);
  if (blankBetween(t, win.from, offset) && blankBetween(t, win.lineStart(), win.from)) {
    const lineStart = win.lineStart();
    if (lineStart === 0) return false;
    let prevStart = t.lastIndexOf('\n', lineStart - 2) + 1;
    let m = RE_STREET_LINE.exec(t.slice(prevStart, lineStart - 1));
    // Wiersz z samą miejscowością między ulicą a kodem („ul. Braci Leśnej 3⏎Sękocin Stary⏎05-090 Raszyn”).
    if (!m && prevStart > 0) {
      const loc = RE_LOCALITY_LINE.exec(t.slice(prevStart, lineStart - 1));
      if (loc && localitySegment(loc[1], probe)) {
        const streetStart = t.lastIndexOf('\n', prevStart - 2) + 1;
        m = RE_STREET_LINE.exec(t.slice(streetStart, prevStart - 1));
        prevStart = streetStart;
      }
    }
    return !!m && institutionStreetAt(t, prevStart + m.index + m[0].indexOf(m[1]), probe);
  }
  const m = execTail(RE_STREET_BEFORE_POSTAL_INLINE, t, win.from, offset);
  return !!m && localitySegment(m[2], probe) && institutionStreetAt(t, m.index + m[0].indexOf(m[1]), probe);
}

// Etykieta numeru podmiotu tuż przed numerem („NIP 3871652842”, „REGON: 672556487”).
const RE_ID_LABEL_BEFORE = /(?<!\p{L})(?:NIP|REGON|KRS)(?:[ \t]*nr)?[ \t]*[:.]?[ \t]*(?:PL[ \t-]?)?$/iu;
// Odcinki adresu i numerów między nazwą a numerem: ulica z numerem, kod z miejscowością, sama
// miejscowość, inny numer podmiotu (jawny albo pod maską).
const RE_STREET_SEGMENT = new RegExp(String.raw`^[ \t]*${STREET_SRC}${ROOM_TAIL}[ \t]*$`, 'u');
const RE_POSTAL_SEGMENT = new RegExp(
  String.raw`^[ \t]*(?:\d{2}-\d{3}|${MASK['KOD-POCZTOWY'].replace(/[[\]]/g, '\\$&')})(?:[ \t]+(${LOCALITY_SRC}))?[ \t]*$`,
  'u',
);
const RE_LOCALITY_SEGMENT = new RegExp(String.raw`^[ \t]*${LOCALITY_SRC}[ \t]*$`, 'u');
const RE_ID_SEGMENT = /^[ \t]*(?:NIP|REGON|KRS)(?:[ \t]*nr)?[ \t]*[:.]?[ \t]*(?:PL[ \t-]?)?(?:\d[\d \t-]{7,16}\d|\[[A-ZĄĆĘŁŃÓŚŹŻ-]+\])[ \t]*$/iu;
/** Czy NIP, REGON albo KRS na pozycji `offset` należy do instytucji: za etykietą, a przed nią po
 *  przecinkach tylko adres i inne numery tej samej instytucji, a na początku nazwa stopnia 2
 *  („Gminą Miasta Sanoka, Rynek 1, 38-500 Sanok, NIP 3871652842”, „Urzędem Miejskim w Kórniku,
 *  pl. Niepodległości 1, 62-035 Kórnik, NIP …, REGON …”). Firma osoby („BK-CATERING Anna Nowak,
 *  ul. …, NIP …”) i osoba fizyczna przed numerem nie dają nazwy stopnia 2, więc numer zostaje zakryty. */
export function institutionIdAt(t: string, offset: number, probe?: PersonProbe): boolean {
  const { from, lineStart } = windowBefore(t, offset);
  const before = t.slice(from, offset);
  const label = RE_ID_LABEL_BEFORE.exec(before);
  if (!label) return false;
  const segs = segmentsOf(before.slice(0, label.index));
  // Ostatni odcinek (między przecinkiem a etykietą) musi być pusty: numer stoi zaraz po przecinku.
  let j = segs.length - 1;
  if (segs[j].text.trim() !== '' || segs[j].sep !== ',') return false;
  j--;
  for (let k = 0; j > 0 && k < 5; k++) {
    const seg = segs[j].text;
    // Nazwa jednostki („Gminą Miasta Sanoka”) wygląda też jak miejscowość: nazwa kończy przegląd.
    if (institutionNameLevel(seg, true, true) === 2) break;
    // Między nazwą a numerem tylko ulica, kod z pocztą i inne numery. Sama miejscowość tylko tuż przed
    // kodem („ul. Braci Leśnej 3, Sękocin Stary, 05-090 Raszyn”): w innym miejscu dwa wyrazy z wielkiej
    // litery to zwykle osoba na liście za instytucją („Urząd Skarbowy w Kole, ul. …, Jan Kowalski, NIP …”).
    // Poczta i miejscowość przechodzą sondę osób.
    const postal = RE_POSTAL_SEGMENT.exec(seg);
    const locality = !postal && RE_LOCALITY_SEGMENT.test(seg) && RE_POSTAL_SEGMENT.test(segs[j + 1].text);
    if (!postal && !locality && !RE_STREET_SEGMENT.test(seg) && !RE_ID_SEGMENT.test(seg)) break;
    const place = locality ? seg : postal?.[1];
    if (place !== undefined && !localitySegment(place, probe)) return false;
    if (segs[j].sep !== ',') return false;
    j--;
  }
  if (j < 0) return false;
  // Pozycja tuż za przecinkiem kończącym nazwę: z niej inlineInstitutionBefore ocenia nazwę.
  const end = from + segs[j + 1].start;
  return inlineInstitutionBefore(t, from, end, lineStart, probe, false);
}
