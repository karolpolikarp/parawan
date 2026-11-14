// Pokrewieństwo i opieka jako kotwica osoby: „jej syn Kuba”, „córce Oli”, „brat Paweł”, „Żona, Barbara”.
// Rzeczownik pokrewieństwa stoi przy osobie, więc imię tuż za nim to osoba. Wspólne dla przebiegu
// passPersonKinship i nasion rozlania (passPersonPropagate).
import { FIRST_NAME_DIMINUTIVES, isFirstNameGenitive, POLISH_FIRST_NAMES } from '../dict/names.js';
import { escapeRe } from '../util.js';

// Formy przypadków (małe litery), także bez ogonków z czatu („maz”, „corka”). Bez „pan”, „pani”
// i ról urzędowych, które mają własne wyzwalacze.
const KIN_FORMS_PL = (
  'syn syna synowi synem synu synek synka synkowi synkiem synowie synów synami ' +
  'córka córki córce córkę córką córko córeczka córeczki córeczce córeczkę córeczką córek córkami ' +
  'corka corki corce corke corka ' +
  'mąż męża mężowi mężem mężu maz meza mezowi mezem ' +
  'żona żony żonie żonę żoną zona zony zonie zone ' +
  'matka matki matce matkę matką mama mamy mamie mamę mamą mamusia mamusi mamusię ' +
  'ojciec ojca ojcu ojcem tata taty tacie tatę tatą tatuś tatusia tatusiem ' +
  'brat brata bratu bratem bracie braciszek braciszka bracia braci braćmi ' +
  'siostra siostry siostrze siostrę siostrą siostrzyczka siostrzyczki siostrzyczkę ' +
  'babcia babci babcię babcią babka babki babce babkę ' +
  'dziadek dziadka dziadkowi dziadkiem dziadku dziadziuś dziadziusia ' +
  'wnuk wnuka wnukowi wnukiem wnuczek wnuczka wnuczki wnuczce wnuczkę wnuczką wnuki wnuków wnukami ' +
  'konkubent konkubenta konkubentowi konkubentem konkubina konkubiny konkubinie konkubinę konkubiną ' +
  'partner partnera partnerowi partnerem partnerka partnerki partnerce partnerkę partnerką ' +
  'opiekun opiekuna opiekunowi opiekunem opiekunka opiekunki opiekunce opiekunkę opiekunką ' +
  'podopieczny podopiecznego podopiecznemu podopiecznym podopieczna podopiecznej podopieczną ' +
  'ciocia cioci ciocię ciocią ciotka ciotki ciotce ciotkę ciotką wujek wujka wujkowi wujkiem wuj wuja ' +
  'kuzyn kuzyna kuzynowi kuzynem kuzynka kuzynki kuzynce kuzynkę kuzynką ' +
  'teść teścia teściowi teściem teściowa teściowej teściową ' +
  'szwagier szwagra szwagrem szwagierka szwagierki szwagierką ' +
  'bratanek bratanka bratanica bratanicy siostrzeniec siostrzeńca siostrzenica siostrzenicy ' +
  'pasierb pasierba pasierbica pasierbicy ' +
  'narzeczony narzeczonego narzeczonym narzeczona narzeczonej narzeczoną ' +
  'chłopak chłopaka chłopakiem chlopak chlopaka chlopakiem dziewczyna dziewczyny dziewczyną dziewczynie ' +
  'dzieci dzieciom dziećmi dziecko dziecka dziecku'
).split(' ');
// Angielskie (tekst dwujęzyczny: „my husband Paweł”). Tylko małymi literami: „Father Brown” to tytuł.
const KIN_FORMS_EN = 'husband wife son daughter brother sister mother father grandmother grandfather grandson granddaughter partner fiancé fiancée'.split(' ');

const byLength = (a: string, b: string): number => b.length - a.length;
const capFirst = (w: string): string => `[${w[0].toUpperCase()}${w[0]}]${escapeRe(w.slice(1))}`;
/** Rzeczownik pokrewieństwa: polski z małej albo wielkiej litery, angielski z małej. */
export const KIN_SRC = `(?:${[...new Set(KIN_FORMS_PL)].sort(byLength).map(capFirst).join('|')}|${KIN_FORMS_EN.sort(byLength).map(escapeRe).join('|')})`;
// Wielka litera rzeczownika w środku zdania to tytuł zakonny albo patron („Brat Albert”, „Ojciec Pio”,
// „Matka Teresa”, „im. Brata Alberta”); na początku zdania, wiersza i po etykiecie to zwykły wyraz.
// Cudzysłów otwierający nie jest początkiem zdania: „Babcia Halina”, „Ojciec Mateusz” to nazwy.
const RE_SENTENCE_START_BEFORE = /(?:^|[\n\r]|[.!?:;…)\]>–—•*-][ \t]*)$/u;
const RE_ABBR_BEFORE = /(?<!\p{L})(?:im|św|sw|bł|bl|ul|al|pl|os|ks|o|kard|abp|bp|s|br)\.[ \t]*$/iu;
// Skróty przed tytułem i nazwą („kościół pw. Matki Teresy”, „film pt. Ojciec Mateusz”, „tzw.”, „zob.”):
// wyraz z wielkiej litery za nimi zaczyna nazwę, nie osobę. Małą literą („np. syn Kuba”) to dalej krewny.
const RE_NAME_ABBR_BEFORE = /(?<!\p{L})(?:pw|pt|tzw|zob|por|np|wg|cf|vide)\.[ \t]*$/iu;
/**
 * Czy rzeczownik pokrewieństwa zaczynający się na pozycji `offset` może kotwiczyć osobę: z małej litery
 * zawsze, z wielkiej tylko na początku zdania albo wiersza. Nigdy po skrócie patrona i tytułu („im.”, „św.”)
 * ani wielką literą po skrócie nazwy („pw.”, „pt.”, „tzw.”).
 */
export function kinHeadOk(t: string, offset: number, kin: string): boolean {
  const near = t.slice(Math.max(0, offset - 16), offset);
  if (RE_ABBR_BEFORE.test(near)) return false;
  if (kin[0] === kin[0].toLowerCase()) return true;
  if (RE_NAME_ABBR_BEFORE.test(near)) return false;
  return RE_SENTENCE_START_BEFORE.test(near);
}

// ——— Tytuł zakonny i postać ludowa ———

// Rzeczowniki, które bywają tytułem zakonnym („Matka Teresa”, „Ojciec Pio”, „Brat Albert”, „Siostra
// Faustyna”, „Matki Teresy”, „Brata Alberta”). Polska ortografia każe pisać tytuł zakonny małą literą
// („matka Teresa z Kalkuty”, „brat Albert”), więc forma jest rozpoznawana bez względu na wielkość litery.
const RELIGIOUS_TITLE_FORMS = new Set(
  (
    'matka matki matce matkę matką matko ojciec ojca ojcu ojcem ojcze brat brata bratu bratem bracie ' +
    'siostra siostry siostrze siostrę siostrą siostro'
  ).split(' '),
);
// Święci i patroni znani z tytułu zakonnego (mianownik imienia albo nazwisko).
const SAINT_NAMES = new Set('teresa albert pio faustyna maksymilian kolbe'.split(' '));
// Nazwiska świętych za imieniem („brat Albert Chmielowski”, „ojciec Maksymilian Kolbe”).
const SAINT_SURNAMES = new Set('kolbe kolbego chmielowski chmielowskiego chmielowskim kowalska kowalskiej bojaxhiu'.split(' '));
// Zaimek dzierżawczy (z jednym przymiotnikiem) przed rzeczownikiem: „mój brat Albert”, „jej młodsza
// siostra Faustyna”, „naszej matki Teresy” to krewni, nie tytuł zakonny.
const RE_POSSESSIVE_BEFORE =
  /(?<!\p{L})(?:mój|moja|moje|mojego|mojej|mojemu|moim|moją|mego|mej|twój|twoja|twojego|twojej|twojemu|twoim|twoją|jej|jego|ich|nasz|nasza|naszego|naszej|naszemu|naszym|naszą|wasz|wasza|waszego|waszej|waszemu|waszym|waszą|swój|swoja|swojego|swojej|swojemu|swoim|swoją|swego|swej|moj)(?:[ \t]+\p{Ll}{2,15})?[ \t]+$/iu;
// Przydomek zakonny za imieniem: „Joanna od Aniołów”, „Teresa od Dzieciątka Jezus”, „Teresa z Kalkuty”.
// „od” z wyrazem z wielkiej litery to przydomek, chyba że to rodzina w liczbie mnogiej („Piotr od
// Kowalskich”, „od Nowaków”). „z” tylko przy miejscowości spoza Polski z krótkiej listy: polskie miasto,
// kraj i instytucja po „z” to pochodzenie albo miejsce pracy osoby („Brat Piotr z Niemiec”, „Siostra Ewa
// z MOPS”, „Matka Anna z Wadowic”).
const RE_RELIGIOUS_EPITHET_AFTER = /^[ \t]+(z|ze|od)[ \t]+(\p{Lu}\p{L}*)/u;
const RE_FAMILY_PLURAL = /(?:ich|ych|ów)$/u;
const RELIGIOUS_OD_WORDS = new Set('aniołów apostołów męczenników'.split(' '));
const RELIGIOUS_EPITHET_PLACES = new Set(
  'kalkuty asyżu asyzu padwy lisieux avili ávili sieny pietrelciny loyoli akwinu nazaretu kortony lourdes'.split(' '),
);
function religiousEpithetAfter(after: string): boolean {
  const m = RE_RELIGIOUS_EPITHET_AFTER.exec(after);
  if (!m) return false;
  const w = m[2].toLowerCase();
  if (m[1] === 'od') return RELIGIOUS_OD_WORDS.has(w) || !RE_FAMILY_PLURAL.test(w);
  return RELIGIOUS_EPITHET_PLACES.has(w);
}
// „Dziadek Mikołaj”, „Dziadka Mroza”: postać z bajki i przedszkola, nie krewny.
const RE_FOLK_TITLE = /^Dziad\p{Ll}*$/u;
const RE_FOLK_NAME = /^(?:mikołaj|mikolaj|mróz|mroz)\p{Ll}*$/u;

/**
 * Tytuł zakonny albo postać ludowa zamiast krewnego: rzeczownik tytułu przed imieniem z przydomkiem
 * („matka Teresa z Kalkuty”, „Matka Joanna od Aniołów”), przed znanym świętym („Brat Albert”, „Ojca Pio”,
 * „brat Albert”) albo „Dziadek Mikołaj”. Działa w każdej pozycji w zdaniu, także na jego początku.
 * Święty przy tytule małą literą jest krewnym, gdy przed rzeczownikiem stoi zaimek dzierżawczy („mój brat
 * Albert”) albo za imieniem nazwisko spoza świętych („matka Teresa Nowak”).
 * `lemmas` to mianowniki imienia (małe litery), `after` to tekst tuż za imieniem, `before` tekst przed
 * rzeczownikiem, `surname` nazwisko rozpoznane za imieniem (albo null).
 */
export function kinIsReligiousOrFolkTitle(
  kin: string,
  name: string,
  lemmas: readonly string[],
  after: string,
  before = '',
  surname: string | null = null,
): boolean {
  const forms = [name.toLowerCase(), ...lemmas];
  if (RE_FOLK_TITLE.test(kin) && forms.some((f) => RE_FOLK_NAME.test(f))) return true;
  if (!RELIGIOUS_TITLE_FORMS.has(kin.toLowerCase())) return false;
  const lower = kin[0] === kin[0].toLowerCase();
  if (lower && RE_POSSESSIVE_BEFORE.test(before)) return false;
  if (religiousEpithetAfter(after)) return true;
  if (!forms.some((f) => SAINT_NAMES.has(f))) return false;
  return !lower || !surname || SAINT_SURNAMES.has(surname.toLowerCase());
}

// ——— Zgoda przypadka ———

// Formy, w których rzeczownik może stać w mianowniku. Każda inna forma („synowi”, „córce”, „dzieciom”)
// wymaga imienia w tym samym przypadku: „synowi Markowi”, nie „synowi Marek” (wtedy imię to podmiot).
const KIN_NOMINATIVE = new Set(
  (
    'syn synek synowie córka córeczka corka córki corki córeczki mąż maz żona zona żony zony ' +
    'matka mama mamusia matki ojciec tata tatuś brat braciszek bracia siostra siostrzyczka siostry ' +
    'babcia babka babki dziadek dziadziuś dziadkowie wnuk wnuczek wnuczka wnuki wnuczki ' +
    'konkubent konkubina partner partnerka partnerki opiekun opiekunka opiekunki podopieczny podopieczna ' +
    'ciocia ciotka ciotki wujek wuj kuzyn kuzynka kuzynki teść teściowa szwagier szwagierka ' +
    'bratanek bratanica siostrzeniec siostrzenica pasierb pasierbica narzeczony narzeczona ' +
    'chłopak chlopak dziewczyna dziewczyny dzieci dziecko'
  ).split(' '),
);
// Mianownik liczby mnogiej, który brzmi też jak dopełniacz („do dzieci Mikołaj”, „córki Zuzanna”):
// imię w mianowniku tylko jako wyliczenie albo wtrącenie („dzieci Zuzanna (7 lat) i Antoni”).
const KIN_PLURAL_NOMINATIVE = new Set(
  'synowie córki corki córeczki żony zony matki bracia siostry babki dziadkowie wnuki wnuczki partnerki opiekunki ciotki kuzynki dziewczyny dzieci'.split(' '),
);
const KIN_EN = new Set(KIN_FORMS_EN);
let nominatives: Set<string> | null = null;
/** Mianowniki imion i zdrobnień („marek”, „mikołaj”, „ola”, „kuba”). */
function nominativeNames(): Set<string> {
  if (!nominatives) {
    nominatives = new Set(POLISH_FIRST_NAMES);
    for (const dims of Object.values(FIRST_NAME_DIMINUTIVES)) for (const d of dims) nominatives.add(d);
  }
  return nominatives;
}
/** Czy imię stoi na pewno w mianowniku odmiennego imienia (bez form dwuznacznych jak „Jana” i nieodmiennych jak „Nicole”). */
export function isDeclinedNominativeName(name: string): boolean {
  const l = name.toLowerCase();
  return !/[eiouyó]$/u.test(l) && nominativeNames().has(l) && !isFirstNameGenitive(l);
}
/** Rzeczownik w mianowniku liczby mnogiej, dwuznaczny z dopełniaczem: imię w mianowniku tylko w wyliczeniu lub wtrąceniu. */
export const kinIsPluralNominative = (kin: string): boolean => KIN_PLURAL_NOMINATIVE.has(kin.toLowerCase());
/**
 * Czy imię zgadza się w przypadku z rzeczownikiem pokrewieństwa. „Wszystkim dzieciom Mikołaj przyniósł”,
 * „Wczoraj synowi Marek kupił”: rzeczownik w celowniku, imię w mianowniku, więc imię jest podmiotem
 * zdania, nie krewnym. Formy angielskie się nie odmieniają.
 */
export function kinCaseAgrees(kin: string, name: string): boolean {
  if (KIN_EN.has(kin) || KIN_NOMINATIVE.has(kin.toLowerCase())) return true;
  return !isDeclinedNominativeName(name);
}

// ——— Postacie biblijne ———

// Postacie tylko biblijne, dziś rzadkie jako imię: „Salomon był synem Dawida i Batszeby”.
const RE_BIBLICAL_NAME =
  /(?<!\p{L})(?:Abraham|Izaak|Mojżesz|Salomon|Batszeb|Kain|Abel|Noe|Herod|Piłat|Saul|Goliat|Jozue|Eliasz|Izajasz|Jeremiasz|Ezechiel|Zebedeusz|Kleofas)\p{Ll}{0,4}(?!\p{L})/u;
// Słowa, które przenoszą zdanie do Biblii („Ewangelia mówi o Marii, matce Jakuba”).
const RE_BIBLICAL_CONTEXT =
  /(?<!\p{L})(?:[Ee]wangeli\p{Ll}*|[Ee]wangelist\p{Ll}*|[Bb]ibli\p{Ll}*|[Tt]estament\p{Ll}*|[Aa]postoł\p{Ll}*|[Pp]rorok\p{Ll}*|[Pp]atriarch\p{Ll}*|[Ss]tarotestamentow\p{Ll}*|[Nn]owotestamentow\p{Ll}*|Pism\p{Ll}{0,2}[ \t]+Święt\p{Ll}*|Piśmie[ \t]+Świętym|Jezus\p{Ll}*|Chrystus\p{Ll}*)(?!\p{L})/u;
const RE_SENTENCE_END = /[.!?](?:[ \t]|$)|\n/;
/**
 * Czy zdanie wokół pozycji `at` mówi o postaciach biblijnych (wtedy pokrewieństwo nie kotwiczy osoby):
 * postać tylko biblijna gdziekolwiek w zdaniu albo słowo biblijne przed rzeczownikiem. Słowo za nim
 * nie wystarcza: „Syn Jakub czytał Ewangelię” to krewny.
 */
export function inBiblicalSentence(t: string, at: number): boolean {
  const back = t.slice(Math.max(0, at - 200), at);
  const cut = Math.max(back.lastIndexOf('. '), back.lastIndexOf('! '), back.lastIndexOf('? '), back.lastIndexOf('\n'));
  const head = back.slice(cut + 1);
  const fwd = t.slice(at, at + 200);
  const stop = fwd.search(RE_SENTENCE_END);
  const sentence = head + (stop < 0 ? fwd : fwd.slice(0, stop));
  return RE_BIBLICAL_NAME.test(sentence) || RE_BIBLICAL_CONTEXT.test(head);
}
/**
 * Kotwica pokrewieństwa tuż przed wyrazem (nasiona rozlania): „siostra ”, „Żona, ”, „mojego chłopaka, ”,
 * etykieta „Dzieci: ”, „dzieci – ”, także drugie imię w wyliczeniu („dzieci Zuzanna (7 lat) i ”).
 */
export const RE_KIN_ANCHOR_BEFORE = new RegExp(
  `(?<![\\p{L}])(${KIN_SRC})(?:[ \\t]*[,:]|[ \\t]+[–—-])?[ \\t]+(?:\\p{Lu}\\p{Ll}+(?:[ \\t]*\\([^()\\n]{1,20}\\))?(?:[ \\t]*,|[ \\t]+(?:i|oraz))[ \\t]+){0,3}$`,
  'u',
);
