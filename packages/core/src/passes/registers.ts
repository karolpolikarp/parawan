// Numery z rejestrów zawodowych i urzędowych, zawsze z kotwicą: numer prawa wykonywania zawodu
// (PWZ), numer wpisu radcy prawnego, adwokata lub notariusza, numer karty pobytu i numer aktu
// stanu cywilnego. Żaden z tych zapisów bez słowa obok nie odróżnia się od kodu produktu,
// sygnatury czy zwykłej liczby.
import type { RedactCtx } from '../context.js';
import type { PiiType } from '../types.js';
import { escapeRe } from '../util.js';
import { isValidNpwz } from '../validators.js';
import { ORG_HEAD_WORDS } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS } from '../guards/roles.js';
import { isFirstNameLike } from '../dict/names.js';
import { PERSON_MASK_SRC } from '../charset.js';

const LOWER = 'a-ząćęłńóśźż';
const UPPER = 'A-ZĄĆĘŁŃÓŚŹŻ';
const WORD = `\\w${LOWER}${UPPER}`;
const LETTER = `${LOWER}${UPPER}`;

/**
 * Słowo kotwicy bez względu na wielkość liter („nr”, „Nr”, „NR”, „AKT URODZENIA”). Bez flagi `i`,
 * bo wartość (seria karty pobytu, kod izby) musi zostać wersalikami.
 */
function ci(word: string): string {
  return [...word].map((c) => (c.toUpperCase() !== c ? `[${c}${c.toUpperCase()}]` : c)).join('');
}
const ciAlt = (words: string[]): string => words.map(ci).join('|');
/** „nr”, „Nr.”, „NR” oraz „numer”, „numerze”, „Numerem”, „NUMERU”. */
const NR = String.raw`(?:${ci('nr')}\.?|${ci('numer')}(?:${ciAlt(['ze', 'em', 'u'])})?)`;

/**
 * Kolejne numery wyliczenia po masce („akty urodzenia [maska] i 13/2010”, „PWZ [maska], 2405205”).
 * Każdy zamaskowany numer jest kotwicą następnego, więc cały łańcuch bierzemy jednym dopasowaniem
 * i maskujemy element po elemencie, aż któryś nie przejdzie `accept`. Jedno przejście po tekście:
 * dawna pętla „replace do skutku” brała po jednym elemencie na przejście i rosła kwadratowo.
 */
function maskEnumeration(ctx: RedactCtx, type: PiiType, value: string, accept: (v: string) => boolean): void {
  const sep = String.raw`[ \t]*,[ \t]*|[ \t]+(?:i|oraz)[ \t]+`;
  const chain = new RegExp(`${escapeRe(ctx.M[type])}((?:(?:${sep})(?:${value})(?![${WORD}/]))+)`, 'g');
  const one = new RegExp(`(${sep})(${value})(?![${WORD}/])`, 'y');
  ctx.text = ctx.text.replace(chain, (m: string, tail: string) => {
    let out = m.slice(0, m.length - tail.length);
    let end = 0;
    one.lastIndex = 0;
    for (let x = one.exec(tail); x && accept(x[2]); x = one.exec(tail)) {
      out += `${x[1]}${ctx.hit(type)}`;
      end = one.lastIndex;
    }
    return out + tail.slice(end);
  });
}

/** Zawód po etykiecie w dopełniaczu („PWZ farmaceuty”) albo jego skrót („PWZ lek. 2663347”). */
const PWZ_PROFESSION = `(?:(?:lekar|dentyst|pielęgniar|położn|farmaceut|diagnost|fizjoterapeut|weterynar|psycholog)[${LOWER}]*|(?:lek|dent|piel|poł|farm|fizjot|wet)\\.)`;
/**
 * Liczba z jednostką po niej to kwota albo statystyka, a nie numer („PWZ 12000 zł”, „wydała PWZ
 * 12345 lekarzom”, „PWZ 15000 pielęgniarkom”). Zawód w liczbie mnogiej albo celowniku (końcówki
 * -om, -ów, -ek, -ach, -ami, „lekarzy”, „lekarze”) to adresat statystyki. Liczba pojedyncza
 * („PWZ 2663347 lekarz Jan Nowak”) nie blokuje, bo tak bywa podpisany numer.
 */
const NOT_UNIT = String.raw`(?![ \t]*(?:zł|PLN|złotych|EUR|os(?:ób|obom|obach|oby)(?![${LETTER}])|os\.|razy|tys\.|%|lekarz[ye](?![${LETTER}])|(?:lekar|dentyst|pielęgniar|położn|farmaceut|diagnost|fizjoterapeut|weterynar|psycholog|ratowni|aptek)[${LOWER}]*(?:om|ów|ek|ach|ami)(?![${LETTER}])))`;
/**
 * PWZ po etykiecie: „PWZ 2663347”, „(NPWZ: 1234567)”, „nr PWZ 1234567P”, „(PWZ) nr 2663347”,
 * „PWZ lek. 2663347”, „prawo wykonywania zawodu lekarza nr 1234567”, „PWZ farmaceuty: 12345/2010”.
 * Przy etykiecie PWZ maskujemy także przy złej sumie (literówka), jak PESEL. Wartość to 5–8 cyfr
 * z opcjonalną literą P/A pielęgniarki i położnej albo z rokiem po ukośniku; rok („PWZ od 2010”)
 * ma za mało cyfr, a telefon za dużo. Cyfry pogrupowane spacjami („2 663 347”) tylko z sumą NPWZ.
 */
const RE_PWZ_LABEL = new RegExp(
  String.raw`((?<![${WORD}])(?:\(?N?PWZ[LPF]?\)?|(?:${NR}\s+)?${ci('praw')}(?:${ciAlt(['o', 'a', 'em', 'ie'])})\s+${ci('wykonywania')}\s+${ci('zawodu')}(?:\s+\(N?PWZ\))?)(?:\s+${PWZ_PROFESSION}){0,2}(?:\s+${NR})?)([\s:.=-]*)(\d{5,8}[PA]?(?:\/\d{4})?|\d[ ]\d{3}[ ]\d{3})(?![${WORD}]|\/\d)${NOT_UNIT}`,
  'g',
);

const NAME_WORD = `[${UPPER}][${LOWER}]+(?:-[${UPPER}][${LOWER}]+)?`;
/**
 * Słabsza kotwica: konkretny lekarz („lek.”, „dr n. med.” albo „lekarz” w liczbie pojedynczej)
 * z imieniem i nazwiskiem, a numer w nawiasie albo po przecinku w tym samym wierszu („lek. Jan
 * Nowak (2663347)”, „lekarz prowadzący Jan Nowak, 2663347”). Samo słowo „lekarz” bez osoby
 * („Lekarz dyżurny, 1855252”, „porady lekarzy POZ (1855252)”) to nagłówek tabeli albo statystyka.
 * Tu maskujemy tylko numer z poprawną sumą NPWZ.
 */
const RE_PWZ_DOCTOR = new RegExp(
  String.raw`((?<![${WORD}])(?:[Ll]ek\.(?:\s*(?:med|dent)\.)?|[Ll]ekarz(?:a|em|owi)?(?![${LETTER}])(?:\s+[${LOWER}]{3,20}){0,2}:?|[Dd]r\.?\s+n\.\s*med\.)(?:\s+(?:${NAME_WORD}|[${UPPER}]\.)){1,2}\s+${NAME_WORD}[^\n()]{0,40}?(?:\(\s*|,[ \t]*))(\d{7})(?=\s*\)|[ \t]*(?:$|\n|[,;]))`,
  'gm',
);

/**
 * Kody okręgowych izb radców prawnych i okręgowych rad adwokackich (WAW, KRA, KRK…), od których
 * zaczyna się numer wpisu. Komplet 19 izb radcowskich: BB BK BY GD KA KI KO KR LB ŁD OL OP PO RZ
 * SZ TO WA WB WR ZG, do tego zapisy LU, LD i BI spotykane w pismach. Zamknięta lista: dowolne
 * wersaliki to też kody faktur (FV/1234), umów, formularzy (PCC-3), norm i spółek (ABC-123).
 */
const CHAMBER_CODES =
  'WAW WAŁ WAL WRO KRA KRK KAT KIE KOS GDA POZ LUB LOD ŁÓD BIA BYD CZE OLS OPO PŁO PLO RAD RZE SIE SZC TOR ZIE ' +
  'WA WB WR KR KA KI KO GD PO LB LU LD ŁD BB BK BI BY OL OP RZ SZ TO ZG';
const LAWYER_NUMBER = String.raw`(?:${CHAMBER_CODES.split(' ').join('|')})(?:[-/][A-Za-z]{1,4})?[-/]\d{2,5}`;
const L = `[${LETTER}]*`;
/** Kotwica zawodu: radca prawny, adwokat, aplikant, notariusz, skróty „r.pr.” i „adw.”, też wersalikami. */
const LAWYER_ANCHOR = String.raw`(?:${ci('radc')}${L}\s+${ci('prawn')}${L}|${ci('radczy')}${L}(?:\s+${ci('prawn')}${L})?|${ci('adwokat')}${L}|${ci('aplikan')}${L}\s+(?:${ciAlt(['radcowsk', 'adwokack', 'notarialn'])})${L}|${ci('notariusz')}${L}|${ci('r')}\.\s?${ci('pr')}\.|${ci('adw')}\.)`;
/**
 * „na listę radców prawnych OIRP w Warszawie”: do sześciu słów z nazwą izby i miastem. Pierwsze
 * słowo nazywa zawód albo izbę, bo „na listę uczestników szkolenia” czy „listę obecności” to nie
 * lista radców ani adwokatów.
 */
const LAWYER_LIST = String.raw`\s+${ci('na')}\s+${ci('list')}[ęyĘY]\s+(?:${ciAlt(['radc', 'adwoka', 'aplikant', 'notariusz', 'okręgow', 'izb', 'oirp', 'ora'])})[${LETTER}]*(?:\s+[${LETTER}]+){0,5}`;
/**
 * „nr wpisu”, „Numer wpisu na listę radców prawnych OIRP w Warszawie” między osobą a numerem,
 * a także szyk „wpis (wpisany) na listę … pod nr”.
 */
const LAWYER_ENTRY = String.raw`(?:(?:${ci('nr')}\.?|${ci('numer')}${L})\s+${ci('wpisu')}(?:${LAWYER_LIST})?|${ci('wpis')}(?:${ciAlt(['any', 'ana', 'anym', 'aną'])})?${LAWYER_LIST}\s+${ci('pod')}\s+${NR})`;
/** Imię albo nazwisko osoby: „Kowalska”, „Nowak-Wilk”, a w nagłówku wersalikami „KOWALSKA”. */
const PERSON_WORD = `(?:${NAME_WORD}|[${UPPER}]{3,}(?:-[${UPPER}]{3,})?)`;
/**
 * Po numerze wpisu kończy się wiersz, zdanie albo pozycja wyliczenia. Dalszy ciąg zdania po kodzie
 * („KR-2020 to numer sprawy”, „PO-350 zł”, „PO-2024 r.”, „GD-10 sala rozpraw”) to inne oznaczenie.
 * Myślnik z dalszym tekstem rozstrzyga `passProfessionalNumber` (patrz `RE_DASH_TAIL`).
 */
const LAWYER_END = String.raw`(?=[ \t]*(?:[),;:]|\.(?![\d${LETTER}])|\r?\n|$)|[ \t]+(?:i|oraz)[ \t]|[ \t]+[–—-](?:[ \t]|$))`;
/** Myślnik, po którym zdanie biegnie dalej: „KR-2026 - plan pracy”, „WA-1234 – aplikacja 2026 r.”. */
const RE_DASH_TAIL = new RegExp(String.raw`^[ \t]+[–—-][ \t]+[\d${LETTER}]`);
/**
 * Sam zawód przed numerem, bez imienia, nazwiska i „nr wpisu” („Kancelaria radcy prawnego,
 * KR-2026”, „Radca prawny, WA-1234”). Taka kotwica jest za słaba, żeby kod przed myślnikiem
 * z dalszym ciągiem zdania uznać za numer wpisu, tak jak „Adwokat, KR-2020 to numer sprawy”.
 * Z osobą („radca prawny Jan Nowak, WA-1234 – pełnomocnik powoda”) to podpis.
 */
const RE_BARE_ANCHOR = new RegExp(String.raw`^${LAWYER_ANCHOR}[\s,:(]*$`);
/**
 * Numer wpisu stoi zaraz po kotwicy zawodu albo po imieniu i nazwisku osoby: „radca prawny,
 * GD-8638”, „radcę prawnego Mariusza Nowakowskiego (KR-4222)”, „r.pr. Anna Kowalska, nr wpisu
 * WA-1234”, a w podpisie blokowym w osobnym wierszu („radca prawny\nWA-3516”), gdy ten wiersz
 * to sam numer albo zaczyna się od „Nr wpisu:” („Adwokat Jan Kowalski\nNr wpisu: KR-1234”). Blok
 * to najwyżej dwa wiersze bez pustej linii, a wiersz z zawodem kończy się na osobie. Numer dalej w zdaniu („adwokat, sprawa KR-2020”) zostaje jawny. Samo „nr wpisu”
 * bez zawodu to za mało: wpis do CEIDG, BDO czy rejestru żłobków też ma numer.
 */
const RE_LAWYER = new RegExp(
  String.raw`((?<![${WORD}])${LAWYER_ANCHOR}(?:[ \t]+${PERSON_WORD}){0,3}(?:[ \t]*[,:]?[ \t]*\(?[ \t]*(?:${LAWYER_ENTRY}[ \t]*:?[ \t]*\(?[ \t]*)?|[ \t]*\r?\n[ \t]*(?:${LAWYER_ENTRY}[ \t]*:?[ \t]*|(?=(?:${LAWYER_NUMBER})[ \t]*(?:\r?\n|$)))))(${LAWYER_NUMBER})(?![${WORD}]|[-/]\d)${LAWYER_END}`,
  'g',
);

const RE_PROFESSION_WORD = new RegExp(String.raw`\s${PWZ_PROFESSION}$`);

/**
 * Numery uprawnień i wpisów zawodowych spoza PWZ: uprawnienia budowlane („MAZ/0213/PWOA/14”),
 * członkostwo w izbie inżynierów i architektów („MAZ/BO/4417/12”, „MA-2207”, „IARP nr 1234”),
 * uprawnienia geodety i rzeczoznawcy majątkowego („uprawnienia nr 23011”), wpis tłumacza
 * przysięgłego („TP/1127/09”), biegłego rewidenta, doradcy podatkowego, radcy i adwokata poza
 * kodem izby z listy, świadectwo kwalifikacyjne, licencja zawodowa, legitymacja studencka.
 * Kotwica to słowo rejestru („uprawnienia”, „upr.”, „świadectwo”, „wpis”, „izba”, skrót izby,
 * „licencja zawodowa”, „nr ewid.”, „nr członkowski”, „nr w rejestrze”, „nr na liście”), po nim
 * do ośmiu słów opisu bez cyfr („budowlane do projektowania bez ograniczeń”, „na listę członków
 * … Izby Architektów RP”), potem „nr” i numer. Opis, w którym pada decyzja, uchwała, artykuł,
 * sprawa, adres, rejestr firm albo dostęp do systemu, przerywa kotwicę: numer należy wtedy do
 * tamtego dokumentu albo do instytucji.
 */
const REG_STOP = `(?:${ciAlt(['decyzj', 'uchwał', 'zarządzen', 'postanowien', 'rozporządzen', 'ustaw', 'sygn', 'działk', 'faktur', 'umow', 'pism', 'wnios', 'przedsiębior', 'działalnoś', 'gospodarcz', 'księg', 'ulic', 'alej', 'osiedl', 'siedzib', 'adres', 'telefon', 'rachun', 'kont', 'protok', 'zlecen', 'zamówien', 'ogłoszen', 'dziennik', 'energetyczn', 'zgodnoś', 'dopuszczen', 'homologac', 'legalizac', 'wzorcowan', 'pochodzen', 'szkoln', 'maturaln', 'dojrzałoś', 'obecnoś', 'uczestnik', 'szkoleni', 'kandydat', 'oczekując', 'wyborc', 'system', 'dostęp', 'podpis', 'upoważni', 'logowan'])}|(?:${ciAlt(['spraw', 'sprawa', 'sprawy', 'sprawie', 'sprawą', 'sprawę', 'plac', 'placu', 'art', 'ust', 'par', 'poz', 'pkt', 'znak', 'ul', 'al', 'pl', 'os', 'lok', 'pok', 'sala', 'sali', 'pracy', 'kod', 'tel', 'faks', 'fax', 'dz'])}|EZD)(?![${LETTER}]))`;
// Słowo opisu: litery, kropka skrótu i łącznik; STOP sprawdzamy na samym początku słowa.
const REG_GAP_WORD = String.raw`(?:[ \t]+|[ \t]*[,(][ \t]*)(?!${REG_STOP}|(?:${NR})(?![${LETTER}]))[${LETTER}][${LETTER}.-]*`;
/** Skróty izb zawodowych: MOIIB, ŚlOIIB, PIIB, IARP, MOIA, OIRP, ORA, KIDP, KIBR. */
const CHAMBER_ACRONYM = `(?:(?:[${UPPER}][a-zł]?)?[${UPPER}]{0,2}OIIB|PIIB|IARP|[${UPPER}][a-zł]?[${UPPER}]{0,2}OIA|OIRP|ORA|KIDP|KIBR|PIBR)`;
const RE_CHAMBER_ACRONYM = new RegExp(`^${CHAMBER_ACRONYM}$`);
const REG_KEY = String.raw`(${ci('uprawnie')}[nńNŃ]${L}|${ci('upr')}\.|${ci('świadectw')}${L}|${ci('wpis')}(?:${ciAlt(['u', 'em', 'any', 'ana', 'ani', 'anym', 'aną', 'anego', 'anej'])})?|${ci('izb')}${L}|${CHAMBER_ACRONYM}|${ci('licencj')}${L}[ \t]+${ci('zawodow')}${L}|${ci('legitymacj')}${L}[ \t]+(?:${ciAlt(['studenck', 'doktoranck', 'członkowsk'])})${L}|${NR}[ \t]+(?:${ci('ewid')}(?:\.|${ci('encyjn')}${L})|${ci('członk')}(?:${ciAlt(['owski', 'a', 'ini'])})|${ci('w')}[ \t]+${ci('rejestrze')}|${ci('na')}[ \t]+${ci('liście')}))`;
/**
 * Numer w kształcie rejestru: dwa do pięciu członów z ukośnikiem albo łącznikiem, z cyframi
 * („LOD/0871/POOK/11”, „POZ/Adw/1043”, „TP/1127/09”, „St-145/89”), albo same cyfry.
 */
const REG_CODE = String.raw`(?:[${UPPER}]{1,5}|[${UPPER}][a-z]{1,3}|\d{1,7})(?:[/-](?:[${UPPER}]{1,6}|[${UPPER}][a-z]{1,4}|[a-z]{1,4}|\d{1,7})){1,4}`;
const REG_VALUE = String.raw`(${REG_CODE}|\d{3,8})`;
/** Liczba z jednostką albo rok to nie numer („uprawnienia nr 2015 r.”, „licencja zawodowa 120 zł”). */
const REG_NOT_UNIT = String.raw`(?![ \t]*(?:r\.|rok|roku|zł|PLN|%|tys|os\.|osób|m2|m²|ha|km|godz)(?![${LETTER}]))`;
/**
 * Po numerze kończy się pozycja: nawias, przecinek, średnik, kropka, koniec wiersza, TAB przed
 * następną komórką, myślnik przed podpisem („– mgr inż. Adrian Łoś”), „i”, „oraz” albo opis
 * uprawnień („nr MAP/0123/PWOK/05 w specjalności …”, „… do projektowania”, „… bez ograniczeń”,
 * „… z dnia”, „… wydane”). Dalszy ciąg zdania („KR-2020 to numer sprawy”, „pod nr KR-2020
 * sprawy”) to inne oznaczenie.
 */
const REG_END = String.raw`(?=\t|[ \t]*(?:[(),;:|]|\.(?![\d${LETTER}])|\r?\n|$)|[ \t]+[–—-](?:[ \t]|$)|[ \t]+(?:${ciAlt(['i', 'oraz', 'w', 'do', 'na', 'bez', 'z', 'ze'])}|${ciAlt(['wydan', 'nadan', 'specjaln'])}${L})[ \t])`;
const RE_REGISTER = new RegExp(
  String.raw`(?<![${WORD}])${REG_KEY}((?:${REG_GAP_WORD}){0,8}?)([ \t]*[,:(]?[ \t]*(?:(?:${ciAlt(['pod', 'o'])})[ \t]+)?(?:(${NR})[ \t]*:?[ \t]*)?)${REG_VALUE}(?![${WORD}]|[-/][${WORD}]|[.,][\d${LETTER}])${REG_NOT_UNIT}${REG_END}`,
  'g',
);
/**
 * Zawód osoby jako rzeczownik: „architekt”, „inżynier budownictwa”, „geodeta”, „doradca
 * podatkowy”, „radca prawny”, skróty „arch.”, „inż.”, „r. pr.”. Nazwa dziedziny w nazwie komórki
 * urzędu albo instytucji to nie zawód: „Wydział Architektury”, „Referat Inżynierii Miejskiej”,
 * „Geodezji i Kartografii”, „Inspekcja Farmaceutyczna”, „Doradca ds. architektury”, „Izba
 * Adwokacka”. Dlatego rdzeń ma wykluczone końcówki dziedziny, a doradca, radca i biegły liczą się
 * tylko z dookreśleniem zawodu.
 */
const PROFESSION_PERSON_CORE = String.raw`(?:${ci('architekt')}(?!${ciAlt(['ur', 'onicz'])})|${ci('inżynier')}(?![iI])|${ci('projektan')}|${ci('sprawdzając')}|${ci('geodet')}|${ci('kartograf')}(?![iI])|${ci('rzeczoznaw')}|${ci('tłumacz')}(?!${ciAlt(['eni', 'on', 'ył', 'ąc'])})|${ci('biegł')}${L}[ \t]+(?:${ciAlt(['rewident', 'sądow', 'z'])})|${ci('rewident')}|${ci('doradc')}${L}[ \t]+(?:${ciAlt(['podatkow', 'restrukturyzac', 'inwestycyjn'])})|${ci('radc')}${L}[ \t]+${ci('prawn')}|${ci('adwokat')}|${ci('notariusz')}|${ci('komornik')}|${ci('diagnost')}|${ci('instruktor')}|${ci('egzaminator')}|${ci('urbanist')}(?!${ciAlt(['yk', 'yczn'])})|${ci('syndyk')}|${ci('mediator')}|${ci('psycholog')}(?!${ciAlt(['iczn', 'ii', 'ia'])})|${ci('fizjoterapeut')}(?!${ci('yczn')})|${ci('lekarz')}|${ci('pielęgniar')}|${ci('położn')}(?!${ciAlt(['ictw', 'icz'])})|${ci('farmaceut')}(?!${ci('yczn')})|${ci('aptekar')}|${ci('weterynar')}(?!${ciAlt(['yjn', 'ii'])})|${ci('arch')}\.|${ci('inż')}\.|${ci('adw')}\.|${ci('r')}\.[ \t]?${ci('pr')}\.)`;
/**
 * Zawód z przymiotnikiem urzędu to stanowisko organu, a nie osoba z uprawnieniami: „Geodeta
 * Powiatowy”, „Architekt Miejski”, „Lekarz Wojewódzki”. Numer przy takim stanowisku należy do
 * urzędu (upoważnienie, dostęp, okólnik), chyba że obok stoi osoba z tytułem („mgr inż.”).
 */
const OFFICE_TITLE_ADJ = ciAlt(['powiatow', 'miejsk', 'gminn', 'wojewódzk', 'krajow', 'państwow', 'główn', 'naczeln', 'okręgow', 'rejonow', 'urzędow']);
const PROFESSION_PERSON = String.raw`(?:${PROFESSION_PERSON_CORE}(?![${LETTER}]*[ \t]+(?:${OFFICE_TITLE_ADJ})))`;
/** Funkcja na budowie: jej numerem jest numer uprawnień, ale wpis przy niej to pozycja w dzienniku budowy. */
const SITE_ROLE = String.raw`(?:${ci('kierowni')}${L}[ \t]+(?:${ciAlt(['robót', 'budowy'])})|${ci('inspektor')}${L}[ \t]+${ci('nadzoru')}(?![ \t]+${ci('budowlan')}))`;
/** Opis rodzaju uprawnień tuż po kotwicy („uprawnienia budowlane”, „świadectwo kwalifikacyjne”). */
const PROFESSION_DESCRIPTOR = `(?:${ciAlt(['budowlan', 'geodezyj', 'kwalifikac', 'zawodow', 'uprawnion', 'architekton', 'konstrukc', 'instalac', 'projektow', 'kierowani', 'rzeczoznawc'])})`;
const RE_PROFESSION_PERSON = new RegExp(`(?<![${LETTER}])(?:${PROFESSION_PERSON}|${SITE_ROLE})`);
const RE_PROFESSION_PERSON_ONLY = new RegExp(`(?<![${LETTER}])${PROFESSION_PERSON}`);
const RE_PROFESSION_GAP = new RegExp(`(?<![${LETTER}])(?:${PROFESSION_PERSON}|${SITE_ROLE}|${PROFESSION_DESCRIPTOR})`);
/**
 * Rejestr albo lista po kotwicy wpisu mówi, czyj to numer: „do rejestru biegłych rewidentów”, „na
 * listę tłumaczy” to osoba, a „do rejestru aptek”, „rejestru placówek oświatowych”, „rejestru OSK”
 * to podmiot. Tak samo ewidencja, wykaz i spis („do ewidencji placówek”, „w wykazie jednostek”).
 * Wyraz po nazwie rejestru musi nazwać zawód albo członków.
 */
const RE_REGISTER_OF = new RegExp(
  String.raw`(?<![${LETTER}])(?:${ci('rejestr')}|${ci('list')}[aęyAĘY]|${ci('liści')}[eE]|${ci('ewidencj')}|${ci('wykaz')}|${ci('spis')})${L}[ \t]+([${LETTER}]+)`,
  'g',
);
const RE_REGISTER_OF_PERSON = new RegExp(`^(?:${PROFESSION_PERSON}|${ciAlt(['członk', 'biegł', 'radc', 'doradc'])})`);
const RE_REGISTER_OF_NEUTRAL = new RegExp(`^(?:${ciAlt(['pod', 'nr', 'numer', 'prowadzon', 'przez', 'w', 'we', 'z', 'ze', 'o'])})(?![${LETTER}])`);
function registerOfOther(s: string): boolean {
  for (const x of s.matchAll(RE_REGISTER_OF)) {
    const rest = s.slice(x.index + x[0].length - x[1].length);
    if (!RE_REGISTER_OF_NEUTRAL.test(rest) && !RE_REGISTER_OF_PERSON.test(rest)) return true;
  }
  return false;
}
/**
 * Inny dokument albo wydarzenie tuż przed kotwicą („decyzją o nadaniu uprawnień nr 12/2024”,
 * „uchwała w sprawie wpisu nr 5”, „egzamin na uprawnienia budowlane nr 12/2024”).
 */
const RE_REGISTER_OTHER_DOC =
  /(?:decyzj|uchwał|zarządzen|postanowien|komunikat|obwieszcz|ogłoszen|regulamin|w sprawie|sprawy|wnios|pism|egzamin|szkoleni|kurs|posiedzeni|konferencj|okólnik|biuletyn|nabor|nabór|konkurs|zebrani|kontrol)[^,;()\n]{0,40}$/i;
/** Po numerze: system, dostęp, podpis, dziennik („uprawnienia nr 33/2025 do EZD”, „wpis nr 12 w dzienniku”). */
const RE_REGISTER_OTHER_TAIL = new RegExp(
  String.raw`^[ \t]*,?[ \t]*(?:${ciAlt(['do', 'w', 'we', 'z', 'dla'])})[ \t]+(?:${ciAlt(['system', 'dostęp', 'podpis', 'aplikac', 'dziennik', 'księ', 'modu'])}|EZD(?![${LETTER}]))`,
);
/**
 * „do …” i „dla …” za numerem mówią, do czego służą uprawnienia. Uprawnienia zawodowe nadaje się
 * do czynności zawodu („do projektowania”, „do kierowania robotami”, „do wykonywania pomiarów”,
 * „do sporządzania operatów”, „do tłumaczeń”), a do rzeczy albo urzędu tylko upoważnienie
 * pracownika: „uprawnienia nr 3/2025 do PZGiK”, „… do zasobu”, „… do reprezentacji Starosty”,
 * „… do kontroli”. Rzeczownik spoza czynności zawodu albo nazwa rejestru podmiotów („wpis nr 1234
 * do ewidencji placówek”) zostawia numer jawny.
 */
const RE_TAIL_DO = new RegExp(String.raw`^[ \t]*,?[ \t]*(?:${ciAlt(['do', 'dla'])})[ \t]+([${LETTER}]+)`);
const RE_TAIL_REGISTER = new RegExp(`^(?:${ciAlt(['rejestr', 'list', 'liści', 'ewidencj', 'wykaz', 'spis'])})`);
const RE_TAIL_SCOPE = new RegExp(
  `^(?:${ciAlt(['projektow', 'kierowan', 'wykonywan', 'wykonani', 'sporządzan', 'sprawdzan', 'szacowan', 'pełnieni', 'nadzorowan', 'prowadzeni', 'opracowywan', 'dokonywan', 'tłumacz', 'sprawowan', 'świadczeni', 'samodzieln', 'wykonawstw', 'projektowan'])})`,
);
function otherTail(after: string): boolean {
  if (RE_REGISTER_OTHER_TAIL.test(after)) return true;
  if (/^[ \t]*,?[ \t]*(?:do|dla|w|we)[ \t]/i.test(after) && registerOfOther(after.slice(0, 40))) return true;
  const x = RE_TAIL_DO.exec(after);
  if (!x) return false;
  return !RE_TAIL_REGISTER.test(x[1]) && !RE_TAIL_SCOPE.test(x[1]);
}
/** Zawód za numerem w nawiasie albo po myślniku: „SLK/0456/POOK/10 (inż. Adam Kos)”, „… – mgr inż. Adrian Łoś”. */
const RE_PROFESSION_AFTER = new RegExp(
  String.raw`^[ \t]*[(–—-][ \t]*(?:${ciAlt(['mgr', 'dr', 'hab', 'prof'])}\.?[ \t]+){0,2}(?:${PROFESSION_PERSON}|${SITE_ROLE})`,
);
/**
 * Osoba tuż przed skrótem izby („architekt Iga Wolak (IARP 2231)”, „r.pr. Jakub Brzęk, OIRP
 * Wrocław nr WR-2104”, „Kowalski Jan, PIIB …”). Dwa wyrazy z wielkiej litery to za mało, bo tak
 * samo wygląda nazwa komórki i instytucji w dopełniaczu („Biuro Architektury i Planowania
 * Przestrzennego (MOIA …”, „Zarząd Dróg Powiatowych (PIIB 2025)”): jeden z wyrazów musi być
 * imieniem ze słownika (w dowolnej formie), a żaden nie może być słowem instytucji.
 */
const RE_PERSON_RIGHT_BEFORE = new RegExp(
  String.raw`(?<![${LETTER}])([${UPPER}][${LOWER}]+)(?:-[${UPPER}][${LOWER}]+)?[ \t]+([${UPPER}][${LOWER}]+)(?:-[${UPPER}][${LOWER}]+)?[ \t]*[,(][ \t]*$`,
);
const RE_PERSON_MASK_RIGHT_BEFORE = new RegExp(`(?:${PERSON_MASK_SRC})[ \t]*[,(][ \t]*$`);
function personRightBefore(before: string): boolean {
  if (RE_PERSON_MASK_RIGHT_BEFORE.test(before)) return true;
  const x = RE_PERSON_RIGHT_BEFORE.exec(before);
  if (!x) return false;
  const ws = [x[1], x[2]];
  if (ws.some((w) => LEGAL_ENTITY_WORDS.has(w.toLowerCase()) || ORG_HEAD_WORDS.has(w.toLowerCase()))) return false;
  return ws.some((w) => isFirstNameLike(w));
}

/**
 * Koniec zdania w oknie przed kotwicą: kropka, spacja i wielka litera, ale nie po tytule przed
 * nazwiskiem („arch. Olga”, „mgr inż. Rafał”, „r. pr. Anna”, też wersalikami „MGR INŻ. EDYTA”).
 * Zawód z poprzedniego zdania („Radca prawny, WA-1234 – aplikacja 2026 r. NR WPISU: WA-4321”)
 * nie kotwiczy numeru.
 */
const RE_SENTENCE_END = new RegExp(
  String.raw`(?<!(?<![${LETTER}])(?:${ciAlt(['arch', 'inż', 'mgr', 'dr', 'hab', 'prof', 'adw', 'pr', 'lek', 'med', 'ul', 'al', 'pl', 'nr', 'im', 'św', 'ks', 'tel', 'wz', 'ob', 'ew', 'upr', 'bud'])}|[${UPPER}]))[.!?][ \t]+(?=[${UPPER}])`,
  'g',
);
function sentenceTail(win: string): string {
  let cut = 0;
  for (const x of win.matchAll(RE_SENTENCE_END)) cut = x.index + x[0].length;
  return cut ? win.slice(cut) : win;
}
/** Okno przed kotwicą: najwyżej `size` znaków i nie dalej niż początek wiersza (szukany tylko w oknie). */
function windowBefore(all: string, at: number, size: number): string {
  const w = all.slice(Math.max(0, at - size), at);
  return w.slice(w.lastIndexOf('\n') + 1);
}
/** Okno za numerem: najwyżej `size` znaków i nie dalej niż koniec wiersza. */
function windowAfter(all: string, end: number, size: number): string {
  const w = all.slice(end, end + size);
  const nl = w.indexOf('\n');
  return nl < 0 ? w : w.slice(0, nl);
}

function maskRegisterNumbers(ctx: RedactCtx): void {
  const mask = ctx.M['NR-UPRAWNIEN'];
  // Koniec ostatniego numeru zamaskowanego w tym przebiegu (pozycja w tekście przed zamianą).
  let lastHit = -1;
  ctx.text = ctx.text.replace(
    RE_REGISTER,
    (m: string, key: string, gap: string, sep: string, nr: string | undefined, val: string, at: number, all: string) => {
      const digitsOnly = /^\d+$/.test(val);
      if (!/\d/.test(val) || (digitsOnly && val.length > 8)) return m;
      const k = key.toLowerCase();
      const end = at + m.length;
      const memberKey = /^(?:nr|numer)\.?[ \t]+członk/.test(k);
      const listKey = /^(?:nr|numer)\.?[ \t]+(?:w|na)[ \t]/.test(k);
      const strongKey = k.startsWith('uprawnie') || k === 'upr.' || k.startsWith('legitymacj') || k.startsWith('licencj') || memberKey;
      const chamberKey = k.startsWith('izb') || RE_CHAMBER_ACRONYM.test(key);
      const wpisKey = k.startsWith('wpis');
      const before = sentenceTail(windowBefore(all, at, 160));
      const after = windowAfter(all, end, 60);
      if (RE_REGISTER_OTHER_DOC.test(before) || otherTail(after)) return m;
      // „z upr. Wójta nr 12/2024” to upoważnienie urzędnika, nie numer uprawnień.
      if (k === 'upr.' && (/(?<![a-ząćęłńóśźż])z[ \t]*$/i.test(before) || RE_CAPITALIZED.test(gap))) return m;
      // Wpis w dzienniku budowy albo do rejestru podmiotów („do rejestru aptek”) to nie numer osoby.
      if ((wpisKey || listKey) && (/dziennik/i.test(before) || registerOfOther(gap) || registerOfOther(after))) return m;
      // Kotwica wymaga zawodu w wierszu przed nią albo w opisie („uprawnienia budowlane”,
      // „geodeta uprawniony”, „mgr inż.”): same „uprawnienia nr 12/2024” bywają nadaniem dostępu
      // do systemu. Legitymacja studencka, licencja zawodowa i numer członkowski niosą rodzaj
      // w samej kotwicy. Przy wpisie zawód musi stać przed kotwicą i nie może to być sama funkcja
      // na budowie: „kierownik budowy – wpis nr 1235” to pozycja w dzienniku.
      // Skrót izby zawodowej przy członkostwie („członek ŚlOIIB nr …”) sam mówi o zawodzie.
      // Członkostwo blisko kotwicy, w tym samym członie wiersza: „Wpis na listę adwokatów –
      // posiedzenie ORA nr 12/2024” mówi o wpisie, ale numer należy do posiedzenia.
      // Członkostwo tylko w formie jednej osoby („członek”, „członkini”, „wpisany”, „wpis na
      // listę”): forma zbiorowa („Ankieta dla członków PIIB”, „Sprawozdanie z wpisów na listę
      // KIDP”, „Raport o przynależności do OIRP”) mówi o dokumencie izby, nie o osobie.
      const memberSeg = `${before.slice(-60).split(/[–—;|\t]/).pop()}${gap}`;
      const member = RE_MEMBER_ONE.test(memberSeg);
      const prevHit = (lastHit >= 0 && lastHit > at - 160 && !all.slice(lastHit, at).includes('\n')) || before.includes(mask);
      // „nr członkowski” sam nie mówi o izbie (członek OSP, spółdzielni, stowarzyszenia): bez
      // zawodu wystarcza tylko numer w kształcie rejestru izby („KL/BO/0091/03”) albo izba obok.
      const memberSelf = memberKey && (prevHit || (!digitsOnly && /[A-ZĄĆĘŁŃÓŚŹŻ]/.test(val)) || /izb|OIIB|IARP|OIA|PIIB/i.test(`${gap}${after.slice(0, 30)}`));
      const selfNamed = k.startsWith('legitymacj') || k.startsWith('licencj') || memberSelf || (member && RE_CHAMBER_ACRONYM.test(key));
      if (!selfNamed) {
        const ok = wpisKey
          ? RE_PROFESSION_PERSON_ONLY.test(before)
          : RE_PROFESSION_PERSON.test(before) || RE_PROFESSION_GAP.test(`${key}${gap}`) || (strongKey && RE_PROFESSION_AFTER.test(after));
        if (!ok) return m;
      }
      // Numer po nazwie albo skrócie izby to numer członka tylko przy członkostwie albo wpisie
      // („członek Mazowieckiej Izby Architektów nr”), przy osobie tuż przed skrótem („Iga Wolak
      // (IARP 2231)”) albo obok numeru uprawnień tej osoby. Posiedzenie, szkolenie, okólnik czy
      // stanowisko izby („posiedzenie ORA nr 12/2024”) mają numer dokumentu izby.
      const personNext = chamberKey && personRightBefore(before);
      if (chamberKey && !member && !personNext && !prevHit) return m;
      // Numer w kształcie dokumentu („12/2024”, „2025”) po izbie bez osoby obok to numer
      // uchwały, ankiety, okólnika czy rok, także przy słowie członkostwa („Ankieta dla członka
      // PIIB nr 2/2026”). Numer członka izby ma kod okręgu albo cztery cyfry bez roku.
      if (chamberKey && !personNext && !prevHit && RE_DOC_NUMBER.test(val) && !hasPersonEvidence(memberSeg)) return m;
      // Bez „nr” (po kotwicy albo tuż przed nią: „nr wpisu 12345”) tylko numer w kształcie
      // rejestru albo cyfry zaraz po „upr.” czy po skrócie izby przy osobie; same cyfry po izbie
      // i wpisie co najmniej czterocyfrowe (numer domu, pokoju czy pozycji ma mniej).
      if (digitsOnly) {
        const nrBefore = /(?:nr|numer[a-ząćęłńóśźż]*)\.?[ \t]*$/i.test(before);
        const bare = gap === '' && /^[ \t]+$/.test(sep);
        if (!nr && !nrBefore && !memberKey && !listKey && !(k === 'upr.' && gap === '') && !(personNext && bare)) return m;
        if (!strongKey && !listKey && k !== 'upr.' && !k.startsWith('świadectw') && val.length < 4) return m;
      }
      lastHit = end;
      return `${m.slice(0, m.length - val.length)}${ctx.hit('NR-UPRAWNIEN')}`;
    },
  );
}
const RE_CAPITALIZED = new RegExp(`[${UPPER}][${LOWER}]`);
/** Jedna osoba w izbie albo na liście: „członek”, „członkini”, „członka”, „wpisany”, „wpis na listę”. */
const RE_MEMBER_ONE = new RegExp(
  String.raw`(?<![${LETTER}])(?:${ci('członk')}(?:${ciAlt(['ini', 'inią', 'inię', 'iem', 'owi', 'a'])})?|${ci('członek')}|${ci('wpis')}(?:${ciAlt(['any', 'ana', 'anym', 'aną', 'anego', 'anej', 'u', 'em'])})?|${ci('przynależ')}(?:${ciAlt(['y', 'ący', 'ąca', 'ącym', 'ącej'])}))(?![${LETTER}])`,
);
/** Kształt numeru dokumentu albo roku: „12/2024”, „2024/05”, „2025”. */
const RE_DOC_NUMBER = /^(?:\d{1,4}\/(?:19|20)\d\d|(?:19|20)\d\d(?:\/\d{1,3})?)$/;

/**
 * Osoba w tym samym wierszu: zawód („projektant”, „mgr inż.”, „kierownik budowy”) albo para
 * imię i nazwisko z imieniem ze słownika („Celina Bór”, „Kasprzak Bogdan”). Sam kształt dwóch
 * wyrazów z wielkiej litery nie wystarcza, bo tak wygląda nazwa jednostki („Starostwo
 * Powiatowe”, „Ochotnicza Straż”).
 */
const RE_NAME_PAIR = new RegExp(String.raw`(?<![${LETTER}])([${UPPER}][${LOWER}]+)(?:-[${UPPER}][${LOWER}]+)?[ \t]+([${UPPER}][${LOWER}]+)(?![${LETTER}])`, 'g');
const RE_PERSON_MASK = new RegExp(PERSON_MASK_SRC);
function hasPersonEvidence(s: string): boolean {
  if (RE_PROFESSION_PERSON.test(s) || RE_PERSON_MASK.test(s)) return true;
  for (const x of s.matchAll(RE_NAME_PAIR)) {
    const ws = [x[1], x[2]];
    if (ws.some((w) => LEGAL_ENTITY_WORDS.has(w.toLowerCase()) || ORG_HEAD_WORDS.has(w.toLowerCase()))) continue;
    if (ws.some((w) => isFirstNameLike(w))) return true;
  }
  return false;
}

/**
 * Numer uprawnień budowlanych ma własny kształt: okręg, numer, rodzaj i specjalność, rok
 * („MAZ/0213/PWOA/14”, „ZAP/0099/PWBKb/12”, „GOR/0011/OWOK/97”). Ten sam kształt ma jednak znak
 * sprawy i numer umowy („OR/0456/POW/24”, „RPO/0123/POIS/2021”), więc bez kotwicy maskujemy go
 * tylko przy osobie w tym samym wierszu: w komórce tabeli po zawodzie albo nazwisku
 * („Projektant⇥mgr inż. Celina Bór⇥LOD/0871/POOK/11”) i przed zawodem w nawiasie
 * („SLK/0456/POOK/10 (inż. Adam Kos)”). Słowo dokumentu tuż przed numerem („Sprawa”, „Umowa nr”,
 * „Projekt”, „znak”) przesądza, że to inny dokument.
 */
const RE_BUILDING_PERMIT = new RegExp(
  String.raw`(?<![${WORD}/-])[${UPPER}]{2,4}\/\d{2,5}\/[PO][OW][A-Z]{1,3}[a-z]?\/\d{2,4}(?![${WORD}]|[/-][${WORD}])`,
  'g',
);
const RE_DOC_WORD_BEFORE = new RegExp(
  String.raw`(?<![${LETTER}])(?:${ciAlt(['umow', 'spraw', 'znak', 'decyzj', 'postanowien', 'uchwał', 'zarządzen', 'pism', 'wnios', 'faktur', 'zleceni', 'zamówieni', 'program', 'konkurs', 'nab', 'grant', 'dotacj', 'porozumieni', 'aneks', 'sygn', 'projekt'])})${L}\.?[ \t]*(?:${NR}[ \t]*:?[ \t]*)?[:(]?[ \t]*$`,
);
function maskBuildingPermits(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_BUILDING_PERMIT, (m: string, at: number, all: string) => {
    const before = sentenceTail(windowBefore(all, at, 160));
    if (RE_DOC_WORD_BEFORE.test(before) && !/projektan/i.test(before.slice(-14))) return m;
    const after = windowAfter(all, at + m.length, 60);
    return hasPersonEvidence(before) || RE_PROFESSION_AFTER.test(after) ? ctx.hit('NR-UPRAWNIEN') : m;
  });
}
/**
 * Kolumna tabeli z nagłówkiem numeru uprawnień albo członka izby („Imię i nazwisko | Funkcja |
 * Nr uprawnień | Nr członka izby”, „Lp.;Imię i nazwisko;Funkcja;Nr uprawnień”): numer w tej
 * kolumnie należy do osoby z wiersza, choć zawód stoi w innej komórce. Nagłówek sam nie mówi
 * o osobie: „Nr członkowski” bywa w wykazie jednostek OSP i spółdzielni, „Uprawnienia” w zestawieniu
 * spraw, a „Nr ewidencyjny” to numer działki, środka trwałego czy pojazdu (dlatego goły „Nr ewid.”
 * bez „upr.” w ogóle nie jest nagłówkiem). Wiersz musi więc mieć osobę albo zawód w innej komórce,
 * a sam rok („2024”) nie jest numerem.
 */
const RE_REG_HEADER_CELL = new RegExp(
  String.raw`^[ \t]*(?:${NR}[ \t]+(?:${ci('uprawnie')}[nńNŃ]${L}(?:[ \t]+${ci('budowlan')}${L})?|${ci('upr')}\.|${ci('członk')}${L}(?:[ \t]+${ci('izb')}${L})?|${ci('ewid')}(?:\.|${ci('encyjn')}${L})[ \t]+${ci('upr')}(?:\.|${ci('awnień')}))|${ci('uprawnieni')}[aA](?:[ \t]+${ci('budowlan')}${L})?)[ \t]*:?[ \t]*$`,
);
const RE_REG_HEADER_QUICK = new RegExp(String.raw`(?:${ci('upr')}|${ci('członk')})`);
const RE_REG_CELL_VALUE = new RegExp(String.raw`^(?=\S*\d)(?:${REG_CODE}|\d{4,8})$`);
function maskRegisterColumns(ctx: RedactCtx): void {
  if (!RE_REG_HEADER_QUICK.test(ctx.text) || !/[\t;|]/.test(ctx.text)) return;
  const parts = ctx.text.split(/(\r?\n)/);
  let changed = false;
  for (let h = 0; h + 2 < parts.length; h += 2) {
    const header = parts[h];
    if (!RE_REG_HEADER_QUICK.test(header)) continue;
    const delim = header.includes('\t') ? '\t' : header.includes('|') ? '|' : header.includes(';') ? ';' : '';
    if (!delim) continue;
    const names = header.split(delim);
    if (names.length < 2) continue;
    const cols = names.map((n, i) => (RE_REG_HEADER_CELL.test(n) ? i : -1)).filter((i) => i >= 0);
    if (!cols.length) continue;
    let r = h + 2;
    for (; r < parts.length; r += 2) {
      const line = parts[r];
      if (!line.trim()) break;
      const cells = line.split(delim);
      if (cells.length !== names.length) break;
      if (!hasPersonEvidence(cells.filter((_, i) => !cols.includes(i)).join('\n'))) continue;
      let hit = false;
      for (const i of cols) {
        const v = cells[i].trim();
        if (!RE_REG_CELL_VALUE.test(v) || /^(?:19|20)\d\d$/.test(v)) continue;
        cells[i] = cells[i].replace(v, ctx.hit('NR-UPRAWNIEN'));
        hit = true;
      }
      if (hit) {
        parts[r] = cells.join(delim);
        changed = true;
      }
    }
    h = r - 2;
  }
  if (changed) ctx.text = parts.join('');
}
/**
 * Kolejna komórka po zamaskowanym numerze (TAB, średnik albo kreska tabeli) z numerem w kształcie
 * rejestru to numer tej samej osoby: „upr. nr [maska]⇥ZPOIIB/BO/0345/13”, „[maska];  DOIA/0321”.
 * Komórka z wyrazem przed numerem („; Decyzja AB/1234/2024”) nie wchodzi do łańcucha.
 */
function maskRegisterCells(ctx: RedactCtx): void {
  // Pierwszy człon do sześciu wersalików: skrót izby z okręgiem („ZPOIIB/BO/0345/13”).
  const code = String.raw`(?=[^\s;|]*[${UPPER}])(?=[^\s;|]*\d)${REG_CODE.replace(`[${UPPER}]{1,5}`, `[${UPPER}]{1,6}`)}`;
  const cell = String.raw`(?:\t+[ \t]*|[ \t]*[;|][ \t]*)`;
  const term = String.raw`(?![${WORD}]|[-/][${WORD}])(?=[ \t]*(?:[\t;|,)]|\r?\n|$))`;
  const chain = new RegExp(`${escapeRe(ctx.M['NR-UPRAWNIEN'])}((?:${cell}${code}${term})+)`, 'g');
  const one = new RegExp(`(${cell})(${code})${term}`, 'y');
  ctx.text = ctx.text.replace(chain, (m: string, tail: string) => {
    let out = m.slice(0, m.length - tail.length);
    one.lastIndex = 0;
    for (let x = one.exec(tail); x; x = one.exec(tail)) out += `${x[1]}${ctx.hit('NR-UPRAWNIEN')}`;
    return out;
  });
}

export function passProfessionalNumber(ctx: RedactCtx): void {
  if (!ctx.on('NR-UPRAWNIEN')) return;
  ctx.text = ctx.text.replace(RE_PWZ_LABEL, (m, kw: string, sep: string, val: string) => {
    // Cyfry ze spacjami albo sama fraza „prawo wykonywania zawodu” bez „nr” i bez „PWZ” to za
    // mało, żeby wziąć dowolną liczbę („prawo wykonywania zawodu: 152340” to statystyka).
    // Zawód w dopełniaczu z dwukropkiem („Prawo wykonywania zawodu lekarza: 1234567”) to pole
    // formularza, tak samo mocne jak „nr”.
    const field = sep.includes(':') && RE_PROFESSION_WORD.test(kw);
    const weak = val.includes(' ') || (!/PWZ|(?<![a-ząćęłńóśźż])nr(?![a-ząćęłńóśźż])|numer/i.test(kw) && !field && !/[PA]$|\//.test(val));
    if (weak && !isValidNpwz(val)) return m;
    return `${kw}${sep}${ctx.hit('NR-UPRAWNIEN')}`;
  });
  ctx.text = ctx.text.replace(RE_PWZ_DOCTOR, (m, pre: string, num: string) =>
    isValidNpwz(num) ? `${pre}${ctx.hit('NR-UPRAWNIEN')}` : m,
  );
  ctx.text = ctx.text.replace(RE_LAWYER, (m: string, pre: string, _num: string, at: number, all: string) =>
    RE_BARE_ANCHOR.test(pre) && RE_DASH_TAIL.test(all.slice(at + m.length)) ? m : `${pre}${ctx.hit('NR-UPRAWNIEN')}`,
  );
  maskRegisterColumns(ctx);
  maskRegisterNumbers(ctx);
  maskBuildingPermits(ctx);
  maskRegisterCells(ctx);
  // Kilka numerów po jednej etykiecie: PWZ z sumą albo z literą P/A, numer wpisu z kodem izby.
  maskEnumeration(ctx, 'NR-UPRAWNIEN', String.raw`\d{7}[PA]?|${LAWYER_NUMBER}`, (v) => /^\D/.test(v) || /[PA]$/.test(v) || isValidNpwz(v));
}

/** Karta pobytu: seria (2 wersaliki) i 7 cyfr, np. „RP1234567”. */
const RESIDENCE_VALUE = String.raw`[A-Z]{2}[ -]?\d{7}`;
const RESIDENCE_ANCHOR = String.raw`${ci('kart')}(?:${ciAlt(['a', 'y', 'ą', 'ę', 'cie', 'om', 'ami', 'ach'])})\s+${ci('pobytu')}`;
/**
 * Numer karty pobytu w tym samym zdaniu co „karta pobytu”: zaraz po niej (z nazwą rodzaju karty
 * albo jednym, dwoma słowami: „karty pobytu cudzoziemca RP1234567”) albo po „nr”, „numer” lub
 * nawiasie („kartę pobytu (nr RP1234567)”, „Karta pobytu czasowego wydana przez Wojewodę, nr
 * RP1234567”). Wtrącenie z innym dokumentem (paszport, dowód) przerywa kotwicę.
 */
const RE_RESIDENCE = new RegExp(
  String.raw`((?<![${WORD}])${RESIDENCE_ANCHOR}(?:(?:\s+(?:[${LOWER}]{2,20}|[${UPPER}]{3,20})){0,2}[\s:.=-]*|[^\n.;\d]{0,80}?(?<![${WORD}])(?:${NR}|\()[\s:]*))(${RESIDENCE_VALUE})(?!\d)`,
  'g',
);

export function passResidenceCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA-POBYTU')) return;
  // „kartę pobytu stałego seria RP numer 1234567”: maska obejmuje serię i numer.
  ctx.text = ctx.text.replace(
    new RegExp(
      String.raw`(${RESIDENCE_ANCHOR}(?:\s+(?:${ciAlt(['czasowego', 'stałego'])}|${ci('rezydenta')}(?:\s+${ci('długoterminowego')}(?:\s+UE)?)?))?\s+${ci('seri')}[aiięąAIĘĄ][ \t]+)[A-Z]{2},?[ \t]*(?:${NR}[ \t]*)?\d{7}(?!\d)`,
      'g',
    ),
    (_m, pre: string) => `${pre}${ctx.hit('KARTA-POBYTU')}`,
  );
  ctx.text = ctx.text.replace(RE_RESIDENCE, (m, pre: string) =>
    /paszport|dowod|dowód|legitymacj/i.test(pre) ? m : `${pre}${ctx.hit('KARTA-POBYTU')}`,
  );
  maskEnumeration(ctx, 'KARTA-POBYTU', RESIDENCE_VALUE, () => true);
}

/**
 * Akt stanu cywilnego: numer po „akt urodzenia/małżeństwa/zgonu” albo „nr aktu …”. Numer musi
 * mieć ukośnik („1040/2011”, „AU/123/2020”, „1465011/00/AU/2016/000123”). „Sygn. akt I C
 * 1040/2011” nie ma po „akt” rodzaju aktu, więc zostaje dla znaku sprawy.
 */
const CIVIL_STATE = String.raw`${ci('stanu')}\s+${ci('cywilnego')}`;
const CIVIL_HEAD = String.raw`(?:(?:${ci('akt')}(?:${ciAlt(['u', 'em', 'y', 'ów', 'ach', 'ami'])})?|${NR}\s+${ci('aktu')})\s+(?:${CIVIL_STATE}\s+)?(?:${ciAlt(['urodzenia', 'małżeństwa', 'zgonu'])})|(?:${ci('akt')}(?:${ciAlt(['u', 'em'])})?|${NR}\s+${ci('aktu')})\s+${CIVIL_STATE})`;
const CIVIL_VALUE = String.raw`(?:[A-Z]{1,4}[.\s/-]?)?\d{1,8}(?:\/[A-Z0-9]{1,8}){1,4}`;
/**
 * Numer zaraz po rodzaju aktu („akt zgonu 868/2009”, „Akt urodzenia: 123/2020”) albo po „nr”,
 * „numer”, „pod nr” w tym samym zdaniu, bez przecinka i cyfr po drodze („Akt małżeństwa
 * sporządzony w USC Kraków pod nr 1234/2019”, „aktu urodzenia Jana Kowalskiego nr 123/2020”).
 * Wolne słowa bez „nr” nie wystarczą: „aktem zgonu ojca udział 1/2” to udział, nie numer.
 */
const RE_CIVIL_RECORD = new RegExp(
  String.raw`((?<![${WORD}])${CIVIL_HEAD}(?:[^\n.;,\d]{0,60}?(?<![${WORD}])(?:(?:${ciAlt(['pod', 'o'])})\s+)?${NR}(?![${WORD}]))?)([\s:=-]*)(${CIVIL_VALUE})(?![${WORD}/])`,
  'g',
);
/**
 * Ułamek („udział 1/2”), miesiąc z rokiem z zerem wiodącym („05/2020”) i zakres lat („akty
 * urodzenia 2019/2020”, „2019/20”: drugi rok najwyżej 10 lat po pierwszym) to nie numer aktu.
 */
function notCivilNumber(v: string): boolean {
  if (/^\d{1,2}\/\d{1,2}$/.test(v) || /^0\d\/(?:19|20)\d\d$/.test(v)) return true;
  const y = /^((?:19|20)\d\d)\/((?:19|20)?\d\d)$/.exec(v);
  if (!y) return false;
  const from = Number(y[1]);
  const to = y[2].length === 2 ? Math.floor(from / 100) * 100 + Number(y[2]) : Number(y[2]);
  return to > from && to - from <= 10;
}
/** Inny dokument między rodzajem aktu a „nr” („akt zgonu ojca i decyzja nr 12/2020”). */
const OTHER_DOCUMENT = /decyzj|wyrok|postanowieni|uchwał|faktur|umow|pism|wnios|sygn|spraw|repertorium|\brep\b|paszport|dowod|dowód/i;

export function passCivilRecord(ctx: RedactCtx): void {
  if (!ctx.on('AKT-USC')) return;
  ctx.text = ctx.text.replace(RE_CIVIL_RECORD, (m, kw: string, sep: string, val: string) =>
    notCivilNumber(val) || OTHER_DOCUMENT.test(kw) ? m : `${kw}${sep}${ctx.hit('AKT-USC')}`,
  );
  maskEnumeration(ctx, 'AKT-USC', CIVIL_VALUE, (v) => !notCivilNumber(v));
}
