import { HOMOGRAPH_SURNAMES, normalizeSurnameKey, surnameBase } from '../surnames.js';
import { PL_LO, PL_UP, RE_CHAR_L, RE_CHAR_LL, RE_CHAR_LU } from '../charset.js';
import { FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { RE_SURNAME_OBLIQUE } from '../person-patterns.js';

/**
 * Wyrazy (małą literą) po których słowo z sufiksem -ski/-cki/-icz to NIE osoba, lecz eponim
 * medyczny („choroba Leśniowskiego"), nazwa ulicy/miejsca („ulica Puławska") lub termin.
 * Wstrzymują samodzielny detektor morfologiczny/słownikowy nazwiska (kroki 13c/13c2).
 */
export const NON_PERSON_CONTEXT = new Set<string>(
  (
    'choroba chorobę choroby chorobą chorobie objaw objawu objawy objawie zespół zespołu zespole ' +
    'syndrom syndromu próba próbę próby odczyn odczynu test testu testem skala skali skalę metoda ' +
    'metodę metody metodą prawo prawa twierdzenie zasada zasadę reguła reakcja klasyfikacja punkt ' +
    'ulica ulicy ulicę ulicą ulic aleja alei aleję aleją plac placu placem placa rondo ronda most ' +
    'mostu mostem osiedle osiedla osiedlu dzielnica dzielnicy dzielnicę park parku skwer bulwar ' +
    // eponimy medyczne („odruch Babińskiego", „prątek Kocha", „uprząż Pawlika", „linii Langera")
    // i miejscownik „na moście Łazienkowskim" (oboczność st→ści — rdzeń „most" go nie obejmuje)
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią linie linii liniami objawem trójkąt trójkąta moście ' +
    // jednostki administracyjne — „powiat pruszkowski", „gmina …ska" to przymiotnik odmiejscowy,
    // nie nazwisko (pola administracyjne są celowo jawne — patrz komentarz przy FORM_FIELDS)
    'powiat powiatu powiecie powiatem gmina gminy gminie gminą województwo województwa województwie'
  ).split(/\s+/),
);
/**
 * Etykieta pola ADMINISTRACYJNEGO tuż przed wartością („Powiat: Pruszkowski", „Województwo:\n
 * Mazowieckie" — też wartość w następnej linii). Przymiotnik odmiejscowy po niej to nazwa
 * jednostki, NIE nazwisko — bez tego strażnika „Powiat: Pruszkowski" stawał się [OSOBA-X]
 * (prevLowerWord nie widzi etykiety przez dwukropek/nową linię).
 */
export const precededByAdminLabel = (t: string, offset: number): boolean =>
  /(?:powiat\w*|gmin[aęyą]|województw[oaeu]m?|dzielnic[aęy])[ \t]*:?[ \t]*(?:\n|\\[\uE009\uE00A\uE00D])?[ \t]*$/i.test(
    t.slice(Math.max(0, offset - 24), offset),
  );
/**
 * Głowy EPONIMÓW medycznych („Odruch Babińskiego", „Prątek Kocha", „Objaw Brudzińskiego"). Tylko
 * one wyłączają nazwisko po wyrazie pisanym WIELKĄ literą (początek zdania). Cały NON_PERSON_CONTEXT
 * w tym miejscu odsłaniał osoby: „Kierownik Zespołu Kowalski", „Reakcja Kowalskiego na wezwanie",
 * „Prawo Wiśniewskiego do udziału", „Zespół Nowaka przygotował ofertę" — zespół, prawo, test, metoda,
 * skala czy reakcja to zwykłe rzeczowniki, po których stoi osoba z dokumentu.
 */
export const EPONYM_HEADS = new Set<string>(
  (
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią objaw objawu objawy objawie objawem odczyn odczynu syndrom syndromu trójkąt trójkąta ' +
    // „Linie Langera zachowane." — tylko z dopełniaczem, więc „Kierownik Linii Nowak" dalej osobą
    'linie linii liniami'
  ).split(/\s+/),
);
/**
 * Wyrazy dopisane do NON_PERSON_CONTEXT dla eponimów, po których nazwisko stoi zawsze w DOPEŁNIACZU
 * („linii Langera", „prątki Kocha"). Wyłączają tylko znany eponim (EPONYM_SURNAME_FORMS): mianownik
 * („Kierownik linii Nowak", „konflikt na linii Kowalski – Nowak") i dopełniacz osoby z pisma
 * („mistrza linii Kowalskiego", „uprząż Nowaka była zużyta") to osoba.
 */
const GEN_ONLY_CONTEXT = new Set<string>(
  (
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią linie linii liniami objawem trójkąt trójkąta'
  ).split(/\s+/),
);
/**
 * Nazwiska EPONIMÓW w formie, w której stoją po głowie („odruch Babińskiego", „prątek Kocha",
 * „linii Langera", „uprząż Pawlika"). Zbiór zamknięty: po głowach z EPONYM_HEADS i GEN_ONLY_CONTEXT
 * w dokumentacji stoi też pacjent albo pracownik w dopełniaczu („Objawy Kowalskiej ustąpiły",
 * „odruch Kowalskiego uratował dziecko", „mistrza linii Kowalskiego", „uprząż Nowaka była zużyta"),
 * a eponimy to znane nazwiska. Rzadki eponim spoza listy wraca do maski, jak przed partią b3.
 */
const EPONYM_SURNAME_FORMS = new Set<string>(
  (
    'babińskiego brudzińskiego biernackiego chełmońskiego leśniowskiego pawlika chwostka goldflama ' +
    'kocha langera fuchsa beckera kerniga romberga blumberga rovsinga jendrassika hoffmanna ' +
    'oppenheima gordona mikulicza korsakowa filatowa bechterewa rydygiera hirszfelda kochera mendla ' +
    'mayera kehra homansa courvoisiera lasègue’a lasègue\'a duchenne duchenne’a duchenne\'a trousseau ' +
    'rossolimo moro zahna kerleya retziusa curzona maginota calota petita hesselbacha scarpy ' +
    'mantoux wassermana coombsa löfflera pfeiffera friedländera blaschko beau mees'
  ).split(/\s+/),
);
// Głowy, po których stoi tylko kilka eponimów: „linie Langera/Blaschko/Beau", „prątki Kocha",
// „uprząż Pawlika". Dowolne nazwisko z listy po nich to osoba: „kierownika linii Pawlika",
// „operatora linii Babińskiego", „Objawy Pawlika ustąpiły" (Pawlik, Koch, Fuchs to też częste nazwiska).
const EPONYM_PAIRED_HEADS: [RegExp, Set<string>][] = [
  [/^lini/, new Set('langera blaschko beau mees meesa kerleya'.split(' '))],
  [/^prąt/, new Set(['kocha'])],
  [/^pałecz/, new Set('kocha pfeiffera friedländera löfflera'.split(' '))],
  [/^uprz[ęą]/, new Set(['pawlika'])],
  [/^dystrofi/, new Set('duchenne duchenne’a duchenne\'a beckera fuchsa'.split(' '))],
  [/^trójkąt/, new Set('hesselbacha scarpy calota petita kocha pawlika'.split(' '))],
];
const EPONYM_PAIRED_ONLY = new Set<string>(['pawlika', 'langera', 'blaschko', 'beau', 'mees', 'meesa', 'kerleya']);
/** Czy nazwisko-eponim pasuje do głowy przed nim (patrz EPONYM_PAIRED_HEADS)? */
export function eponymFits(head: string, word: string): boolean {
  const w = word.toLowerCase();
  if (!EPONYM_SURNAME_FORMS.has(w)) return false;
  for (const [re, set] of EPONYM_PAIRED_HEADS) if (re.test(head)) return set.has(w);
  return !EPONYM_PAIRED_ONLY.has(w);
}
/**
 * Czy nazwisko stoi w formie ZALEŻNEJ (dopełniacz, miejscownik…), a nie w mianowniku? Eponim
 * i patron są zawsze w dopełniaczu („Babińskiego", „Kocha", „Langera"), osoba w zdaniu bywa
 * w mianowniku („Nowak", „Kowalski", „Kowalska", „Wąsowicz"). Formę zależną nazwiska spoza -ski
 * rozpoznajemy po słowniku (forma różna od bazowej).
 */
export function isObliqueSurnameForm(word: string): boolean {
  const w = word.toLowerCase();
  if (RE_SURNAME_OBLIQUE.test(w)) return true;
  if (/(?:sk|ck|dzk)[ia]$|(?:scy|ccy|dzcy|icz|czyk)$/.test(w)) return false;
  const base = surnameBase(w);
  return !!base && base !== w;
}
const prevContextWord = (text: string, offset: number): { word: string; cap: boolean } | undefined => {
  const lo = Math.max(0, offset - 40);
  let j = offset;
  while (j > lo && text[j - 1] === ' ') j--;
  if (j < offset) {
    let k = j;
    while (k > lo && RE_CHAR_LL.test(text[k - 1])) k--;
    if (k < j && k > lo && RE_CHAR_LU.test(text[k - 1]) && (k - 1 === lo || !RE_CHAR_L.test(text[k - 2])))
      return { word: text.slice(k - 1, j).toLowerCase(), cap: true };
  }
  // ostatni ciąg małych liter, za nim same odstępy (też podmienione ucieczki JSON „\n/\r/\t")
  j = offset;
  for (;;) {
    if (j > lo && /\s/.test(text[j - 1])) j--;
    else if (j - 1 > lo && text[j - 2] === '\\' && /[\uE009\uE00A\uE00D]/.test(text[j - 1])) j -= 2;
    else break;
  }
  let k = j;
  while (k > lo && RE_CHAR_LL.test(text[k - 1])) k--;
  return k < j ? { word: text.slice(k, j).toLowerCase(), cap: false } : undefined;
};
/**
 * Czy `word` na pozycji `offset` stoi po rzeczowniku kontekstu nie-osobowego (eponim, ulica,
 * jednostka)? Po „moście" tylko forma uzgodniona z miejscownikiem („na moście Łazienkowskim") albo
 * dopełniacz patrona („na moście Poniatowskiego") — mianownik „Na moście Kowalski potrącił
 * pieszego" to osoba, a nie nazwa mostu. Po wyrazie z wielkiej litery tylko głowa eponimu i tylko
 * ze znanym eponimem („Objaw Nowak zgłosiła się", „Objawy Nowaka nasiliły się" to osoba).
 */
export const afterNonPersonContext = (text: string, offset: number, word: string, masked?: Set<string>): boolean => {
  const prev = prevContextWord(text, offset);
  if (!prev) return false;
  // nazwisko osoby rozpoznanej już w piśmie wygrywa z patronem mostu w dopełniaczu („Jan Gzowski
  // uciekał … Na moście Gzowskiego zatrzymał patrol"); forma uzgodniona („na moście Łazienkowskim")
  // to zawsze nazwa. Eponimów to nie dotyczy: „Pacjent Babiński … odruch Babińskiego" to objaw.
  if (prev.word === 'moście' && /ego$/i.test(word) && masked?.has(normalizeSurnameKey(word))) return false;
  if (prev.word === 'moście') return /(?:im|ym|ego)$/i.test(word);
  if (prev.cap) return EPONYM_HEADS.has(prev.word) && eponymFits(prev.word, word);
  if (!NON_PERSON_CONTEXT.has(prev.word)) return false;
  return !GEN_ONLY_CONTEXT.has(prev.word) || eponymFits(prev.word, word);
};
// Ciąg do trzech wyrazów od wielkiej litery tuż za pozycją (też WERSALIKI) — kandydat na patrona.
const RE_NAME_RUN_AHEAD = /^\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*){0,2}/u;
/**
 * Czy za pozycją stoi OSOBA w mianowniku, a nie patron w dopełniaczu? Patron po tytule albo „św."
 * jest zawsze w dopełniaczu („dra Alfreda Sokołowskiego", „św. Piotra"); „lek. Jan Kowalski",
 * „św. Kowalski", „DR JAN KOWALSKI" to osoba. Imię w mianowniku ze słownika rozstrzyga. Imię
 * w dopełniaczu („Anny", „Marka") przesądza o patronie, także przy nieodmiennym nazwisku („im. dr Anny
 * Nowak"). Imię dwuznaczne, żeńskie w mianowniku i zarazem męskie w dopełniaczu („Aleksandra",
 * „Franciszka", „Stanisława"), rozstrzyga nazwisko za nim: „lek. Aleksandra Nowak" to osoba, „im. dra
 * Aleksandra Kowalskiego" patron. Z `withSurname` także nazwisko w mianowniku (końcówka -ski/-ska,
 * -icz, słownik, homograf).
 */
function nominativePersonAhead(t: string, offset: number, withSurname: boolean): boolean {
  const run = RE_NAME_RUN_AHEAD.exec(t.slice(offset, offset + 80))?.[0];
  if (!run) return false;
  const ws = run.toLowerCase().split(/[ \t]+/);
  const f = ws[0];
  const gen = isFirstNameGenitive(f);
  if (POLISH_FIRST_NAMES.has(f) && !gen) return true;
  // biernik imienia żeńskiego („przesłuchano św. Annę Gzowską") — patron nigdy nie stoi w bierniku
  if (f.endsWith('ę') && POLISH_FIRST_NAMES.has(`${f.slice(0, -1)}a`)) return true;
  if (gen && !POLISH_FIRST_NAMES.has(f)) return false;
  if (!withSurname && !gen) return false;
  return (gen ? ws.slice(1) : ws).some(
    (w) =>
      !isFirstNameGenitive(w) &&
      (/(?:sk|ck|dzk)[iaą]$|(?:icz|czyk)$/.test(w) || surnameBase(w) === w || HOMOGRAPH_SURNAMES.has(w)),
  );
}
/** Czy tuż przed pozycją stoi „im." (patron instytucji: „Szkoła im. A. Mickiewicza") albo
 *  skrót ulicy („ul. Rakowieckiej", „al. Sikorskiego" — patron ULICY, nie osoba), ewentualnie
 *  z inicjałem imienia? prevLowerWord tego nie widzi (kropka po skrócie). Także „bł." i „św." —
 *  błogosławiony i święty („parafia bł. Jerzego Popiełuszki", „Kościół św. Piotra Apostoła") to
 *  patron, nie osoba z dokumentu. Granica Unicode zamiast \b: ASCII \b nie widzi jej przed „ś".
 *  Spacja po kropce opcjonalna tylko po „ul." i „im." („ul.Jana Kilińskiego", „im.Marii Curie") —
 *  jak w passAddress. Sklejone „os."/„pl." to zwykle skrót „osób" i koniec domeny („Obecnych
 *  12 os.Halina Grzyb przewodniczyła", „gmina.pl.Halina Grzyb"), a strażnik oddawał wtedy jawną
 *  całą osobę. „os." po liczbie to „osób" także ze spacją („Obecnych 12 os. Halina Grzyb"). */
const RE_PATRON_ABBR = /(?<![\p{L}\d_])(?:(?:im|ul)\.[ \t]*|(?<!\d[ \t]?)os\.[ \t]+|(?:al|pl|bł)\.[ \t]+)(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
// „św." to w protokołach sądowych także skrót od „świadek" („św. Kowalski zeznał", „Sąd
// przesłuchał św. Annę Gzowską") — bez kontekstu świadek wyciekał jako „patron". Dlatego święty
// tylko po rzeczowniku sakralnym albo „pw."/„im." (najwyżej dwa wyrazy przerwy: „Kościół
// parafialny pw. św. …"), w tej samej linii. Bez kontekstu „św. Antoniego" zostaje w masce —
// drobne nadmaskowanie zamiast wycieku świadka.
// Zapis bez ogonków („kosciol pw. sw. Michala", „parafia sw. Jozefa") — imię świętego bez
// ogonków przechodzi dziś słownik imion, więc kontekst sakralny musi go rozpoznać tak samo.
const SAINT_CONTEXT_WORD =
  /^(?:ko[sś]ci[oóe]\p{L}*|parafi\p{L}*|bazylik\p{L}*|katedr\p{L}*|kaplic\p{L}*|sanktuari\p{L}*|klasztor\p{L}*|kolegiat\p{L}*|cerk\p{L}*|sob[oó]r\p{L}*|zgromadzeni\p{L}*|zakon\p{L}*|sióstr|pw\.|im\.)$/iu;
const RE_SAINT_ABBR = /(?<!\p{L})[sś]w\.[ \t]+(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
const RE_SAINT_PROCEDURAL_WORD =
  /^(?:przesłuch\p{L}*|wezwan[oaey]\p{L}*|wezwał\p{L}*|zezna\p{L}*|podpis\p{L}*|oświadczeni\p{L}*|protok[oó]ł\p{L}*|relacj\p{L}*|według|wg|ze|z)$/iu;
// „św." i imię w dopełniaczu tuż przed nazwiskiem („Parafia pw. św. Rafała Kalinowskiego") — patron
// w całości, także dla przebiegów samego nazwiska (dawniej „św. Rafała [IMIĘ I NAZWISKO]").
const RE_SAINT_GIVEN_BEFORE = /(?<!\p{L})[sś]w\.[ \t]+(\p{Lu}\p{Ll}+)[ \t]+$/u;
const RE_BLESSED_GIVEN_BEFORE = /(?<!\p{L})bł\.[ \t]+(\p{Lu}\p{Ll}+)[ \t]+$/u;
const RE_SAINT_EPITHET_AHEAD =
  /^\p{Lu}\p{Ll}+[ \t]+(?:Ewangelist\p{L}*|Archanio\p{L}*|Archanioł\p{L}*|Apostoł\p{L}*|Apostol\p{L}*|Męczennik\p{L}*|Meczennik\p{L}*|Chrzciciel\p{L}*|Wyznawc\p{L}*|Pustelnik\p{L}*)(?!\p{L})/u;
// Czynność świadka za parą („Sw. Jan Apostol zeznal", „Sw. Adam Pustelnik zeznał") — „Sw." to wtedy
// skrót świadka, a „Apostoł", „Pustelnik", „Wyznawca" bywają nazwiskami.
const RE_WITNESS_VERB_AHEAD =
  // „poda…" bez imiesłowu biernego („Figura św. Pawła Apostoła podana do renowacji" — proza
  // sakralna, nie czynność świadka)
  /^[ \t,]*(?:nie[ \t]+)?(?:zezna\p{L}*|poda(?!n[aeyi])\p{L}*|wyjaśni\p{L}*|wyjasni\p{L}*|stwierdzi\p{L}*|oświadczy\p{L}*|oswiadczy\p{L}*|potwierdzi\p{L}*|widzia\p{L}*|słysza\p{L}*|slysza\p{L}*|stawi\p{L}*|odmówi\p{L}*|odmowi\p{L}*|rozpozna\p{L}*|wskaza\p{L}*)(?!\p{L})/iu;
// Przydomek świętego w rodzaju męskim po imieniu żeńskim („Sw. Maria Meczennik") — to nie święty.
const RE_SAINT_EPITHET_MASC = /^(?:Apostoł|Apostol|Męczennik|Meczennik|Pustelnik|Archanioł|Archaniol|Chrzciciel)$/u;
function saintEpithetAhead(t: string, offset: number): boolean {
  const m = RE_SAINT_EPITHET_AHEAD.exec(t.slice(offset, offset + 40));
  if (!m) return false;
  if (RE_WITNESS_VERB_AHEAD.test(t.slice(offset + m[0].length, offset + m[0].length + 30))) return false;
  const [given, epithet] = m[0].split(/[ \t]+/);
  return !(/a$/.test(given) && !/^(?:Kuba|Barnaba|Bonawentura|Kosma|Jarema)$/.test(given) && RE_SAINT_EPITHET_MASC.test(epithet));
}
const RE_SAINT_INITIAL =/(?<!\p{L})[sś]w\.[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*$/iu;
/** Czy „św." tuż przed pozycją ma kontekst sakralny (najwyżej trzy wyrazy wstecz, ta sama linia)?
 *  Skan po wyrazach, nie regex z oknem: ten drugi próbował dopasowania od każdej pozycji okna. */
export function saintWithContext(t: string, offset: number, near: string): boolean {
  const m = RE_SAINT_ABBR.exec(near);
  if (!m) return false;
  const at = offset - near.length + m.index;
  const line = t.slice(Math.max(0, at - 60), at);
  const words = line.slice(line.lastIndexOf('\n') + 1).split(/[ \t]+/);
  for (let i = words.length - 1, seen = 0; i >= 0 && seen < 3; i--) {
    const w = words[i];
    if (!w) continue;
    seen++;
    // czynność procesowa między kościołem a „św." („W kaplicy przesłuchano św. Jana Kowalskiego",
    // „W kościele zeznania św. Nowaka", „Parafia wezwała św. Wiśniewskiego") — to skrót „świadek"
    if (RE_SAINT_PROCEDURAL_WORD.test(w)) return false;
    // koniec zdania przerywa skan („Zdarzenie w kaplicy szpitalnej. Przesłuchano św. …")
    if (/[\p{L}]\.$/u.test(w) && !/^(?:pw|im)\.$/i.test(w)) return false;
    if (SAINT_CONTEXT_WORD.test(w)) return true;
    // „pod wezwaniem św. …" — samo „wezwanie" to w protokole wezwanie sądu („Mimo wezwania św. Gzik
    // nie stawił się", „Na wezwanie św. Kowalski stawił się"), a nie tytuł kościoła
    if (/^wezwaniem$/iu.test(w) && /^pod$/i.test(words[i - 1] ?? '')) return true;
    // przecinek, cyfra czy nawias przerywa ciąg nazwy — kontekst dalej w zdaniu już nie liczy się
    if (!/^[\p{L}.]+$/u.test(w)) return false;
  }
  return false;
}
export const precededByPatron = (t: string, offset: number): boolean => {
  const near = t.slice(Math.max(0, offset - 12), offset);
  // patron po „św." stoi w dopełniaczu („kościół św. Piotra"); mianownik to świadek, także obok
  // rzeczownika sakralnego („Pożar kościoła widział św. Kowalski", „W kościele św. Nowak widział …").
  // Inicjał po „św." („przesłuchano św. J. Kowalskiego") też wskazuje świadka: świętego cytuje się
  // z pełnym imieniem.
  // Święty to imię (w dopełniaczu albo znana postać po imieniu); samo nazwisko po „św." („wraz ze
  // św. Kowalskim", „podpis św. Kowalskiego") to świadek, także obok kaplicy czy kościoła.
  if (RE_PATRON_ABBR.test(near)) return true;
  // „Sw. Lukasz Ewangelista", „św. Michał Archanioł" — imię z przydomkiem świętego za nim; świadek
  // („Sw. Kowalski zeznal") przydomka nie ma. Też w zapisie bez ogonków.
  if (/(?<!\p{L})[SsŚś]w\.[ \t]*$/u.test(near) && saintEpithetAhead(t, offset)) return true;
  // „bł." z imieniem w dopełniaczu tuż przed nazwiskiem („Kościół bł. Jana Nowaka", „Parafia pw.
  // bł. Józefa Kowalskiego") — patron w całości, jak przy „św.". Para była chroniona, ale nazwisko
  // ze słownika maskował potem przebieg samego nazwiska i zostawało „bł. Józefa [..]". „bł." nie
  // jest skrótem świadka, więc kontekst sakralny nie jest potrzebny; osoba w mianowniku za nim tak.
  const bl = RE_BLESSED_GIVEN_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset));
  if (bl) {
    const bw = bl[1].toLowerCase();
    if ((isFirstNameGenitive(bw) || egoNameGenitive(bw)) && !nominativePersonAhead(t, offset, true)) {
      const w = (/^\p{L}+/u.exec(t.slice(offset, offset + 30))?.[0] ?? '').toLowerCase();
      if (/(?:[aeiouyąę]|ej)$/.test(w) && !/(?:sk|ck|dzk)i$/.test(w)) return true;
    }
  }
  if (saintWithContext(t, offset, near)) {
    return !RE_SAINT_INITIAL.test(near) && !nominativePersonAhead(t, offset, true) && saintNameAt(t, offset);
  }
  const g = RE_SAINT_GIVEN_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset));
  const gl = g?.[1].toLowerCase() ?? '';
  if (!g || !(isFirstNameGenitive(gl) || egoNameGenitive(gl))) return false;
  // osoba w mianowniku za patronem („W kaplicy św. Rocha Teresa Wróbel prowadzi …")
  if (nominativePersonAhead(t, offset, true)) return false;
  // drugi człon patrona też w dopełniaczu („Kalinowskiego", „Boboli", „Kolbego"); mianownik za
  // patronem to osoba („W kaplicy św. Rocha Bednarz poświęcił bramę")
  const w = (/^\p{L}+/u.exec(t.slice(offset, offset + 30))?.[0] ?? '').toLowerCase();
  if (!/[aeiouyąę]$/.test(w) || /(?:sk|ck|dzk)i$/.test(w)) return false;
  const at = offset - g[0].length + g[0].indexOf(g[1]);
  return saintWithContext(t, at, t.slice(Math.max(0, at - 12), at));
};
function saintNameAt(t: string, offset: number): boolean {
  const w = /^\p{L}+/u.exec(t.slice(offset, offset + 30))?.[0] ?? '';
  const wl = w.toLowerCase();
  return isFirstNameLike(w) || isFirstNameGenitive(wl) || egoNameGenitive(wl) || FOREIGN_GIVEN_NAMES.has(wl);
}
/** Dopełniacz imienia na -i/-y („Antoniego", „Jerzego", „Ksawerego"). */
export const egoNameGenitive = (wl: string): boolean =>
  /ego$/.test(wl) && (POLISH_FIRST_NAMES.has(wl.slice(0, -3)) || POLISH_FIRST_NAMES.has(`${wl.slice(0, -3)}y`));
/**
 * Czy para „imię nazwisko" na pozycji `offset` to PATRON ULICY/placu/ronda (eponim), a nie osoba?
 * „ulica Tadeusza Kościuszki", „rondo Jana Pawła II", a także WYLICZENIE „u zbiegu ulic … oraz …"
 * (drugi patron poprzedzony spójnikiem — skan wstecz przez nazwy własne i spójniki aż do wyrazu
 * ulicznego). Świadomie TYLKO konteksty ULICZNE/dedykacyjne — kontekstu medycznego („choroba Jana
 * Kowalskiego") NIE obejmuje, bo tam para z imieniem bywa realną osobą (recall). Uzupełnia
 * `precededByPatron` (skróty ul./al./im.) o pełne wyrazy i wyliczenia; strażnik detektora PAR
 * (kroki 13a/a2), których solo-detektory już pilnują przez NON_PERSON_CONTEXT.
 */
// Kotwica wyrazu ulicznego (rdzeń + ZAMKNIĘTA lista końcówek fleksyjnych; pierwsza litera też
// WERSALIK). Otwarte „\p{L}*" łapało wyrazy pochodne i nazwiska: „placówki", „osiedlowej",
// „parkingu", „Mostowski", „Rogalski" — osoba po nich („Kierownik placówki lek. Jan Kowalski")
// szła jako patron. Granice Unicode (?<![\p{L}]) / (?![\p{L}]) zamiast \b — JS \b jest ASCII-only
// nawet z /u, więc „aleją/ulicą" (końcówka diakrytyczna) traciły granicę i strażnik był martwy.
const STREET_ANCHOR_SRC =
  `(?:[Uu]lic(?:a|y|ę|ą|e|om|ami|ach|zk[aięą]|zce)?|[Aa]lej(?:a|ę|ą|e|om|ami|ach)?|[Aa]lei|` +
  `[Pp]lac(?:u|em|e|y|ów|om|ami|ach)?|[Rr]ond(?:o|a|u|em|zie|om|ami|ach)?|[Mm]ost(?:u|em|y|ów|om|ami|ach)?|` +
  `[Oo]siedl(?:e|a|u|em|i|om|ami|ach)?|[Ss]kwer(?:u|em|ze|y|ów|om|ami|ach)?|` +
  `[Bb]ulwar(?:u|em|ze|y|ów|om|ami|ach)?|[Pp]ark(?:u|iem|i|ów|om|ami|ach)?|[Zz]bieg(?:u|iem)?|` +
  `[Rr]og(?:u|iem)?|[Rr]óg|[Ii]mienia|` +
  // „im" tylko jako skrót z kropką: zaimek („Pomógł im Jan Kowalski", „Przedstawiono im dra Jana
  // Kowalskiego") był kotwicą patrona i osoba po nim wyciekała
  `[Ii]m(?=\\.)|[Uu]l|[Aa]l|[Pp]l|[Oo]s)`;
// Rangi i tytuły w nazwie patrona: „ul. gen. Andersa", „al. ks. Popiełuszki", „im. dra Alfreda
// Sokołowskiego", „im. dr. med. Rafała Masztaka", „im. prof. dr. hab. …", „dr n. med." („n." = nauk).
// Pierwsza litera rangi także wielka („ul. Ks. Jerzego Popiełuszki", „Rondo Gen. Józefa Bema",
// „im. Ks. Jana Twardowskiego"): tak piszą nazwy ulic i szkół urzędy, a strażnik patrona znał
// tylko zapis małą literą i patron szedł do maski jako osoba.
export const STREET_RANK = `(?:${'gen pułk płk ppłk mjr kpt por ks św bł bp abp kard marsz prof doc dra dr hab med lek n inż hr'
  .split(' ')
  .map((r) => `[${r[0].toUpperCase()}${r[0]}]${r.slice(1)}`)
  .join('|')})\\.?`;
// ZACHOWAWCZO: strażnik uznaje patrona TYLKO bezpośrednio po kotwicy, w JEDNEJ LINII, przez ciąg
// nazw własnych i RANG/skrótów tytułów („ul. gen. Andersa", „al. ks. Popiełuszki"). ŚWIADOMIE BEZ
// mostkowania spójników „oraz/i", przecinka, nowej linii i kropki w tokenie nazwy — każdy z nich
// pozwalał wchłonąć REALNĄ osobę z następnej klauzuli/wiersza/zdania („ulicy X oraz Jan Kowalski",
// „ulic X, Osoba", „skwer X\nOsoba", „X. Osoba") = udokumentowana regresja (wyciek osoby). Cena:
// DRUGI patron w wyliczeniu „ulic X oraz Y" bywa nadmaskowany (zamaskowana nazwa ulicy, NIE wyciek
// PII — dopuszczalne wg zasady „precyzja"). PIERWSZY patron (tuż po kotwicy) jest zawsze chroniony.
// Rangi tylko PRZED nazwą, tuż po kotwicy: tytuł po nazwie ulicy czy patrona zaczyna osobę
// („Na ul. Długiej lek. Anna Nowak", „Szpital im. Mikołaja Kopernika lek. med. Jan Nowak").
// Pierwszy wyraz nazwy także sklejony z „im."/„ul." („Szkoła Podstawowa im.Henryka Sienkiewicza"),
// jak w RE_PATRON_ABBR: przebieg par zostawiał wtedy patrona, a samo nazwisko dostawało maskę
// („im.Henryka [IMIĘ I NAZWISKO]").
const RE_STREET_EPONYM_TAIL = new RegExp(
  `(?<![\\p{L}])(?:${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?` +
    `(?:[ \\t]+${STREET_RANK})*` +
    `|(?:[Ii]m|[Uu]l)\\.[${PL_UP}][${PL_LO}${PL_UP}'’-]*)` +
    `(?:[ \\t]+(?:[${PL_UP}][${PL_LO}${PL_UP}'’-]*|[IVXLCDM]+))*` +
    `[ \\t]*$`,
  'u',
);
// Kotwica i same rangi tuż przed kandydatem („W parku lek. ", „ul. dra "). Patron stoi wtedy
// w dopełniaczu („Ulica dra Alfreda Sokołowskiego"), a mianownik to osoba z prozy („W parku lek.
// Jan Kowalski reanimował poszkodowanego") — rozstrzyga nominativePersonAhead.
const RE_STREET_RANK_ONLY_TAIL = new RegExp(
  `(?<![\\p{L}])${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?(?:[ \\t]+${STREET_RANK})+[ \\t]*$`,
  'u',
);
// Ten sam strażnik dla zapisu WERSALIKAMI („PRZY ALEI WŁADYSŁAWA SIKORSKIEGO", „RONDO ROMANA
// DMOWSKIEGO"). Tylko BEZPOŚREDNIO po kotwicy (dopuszczalne same rangi): w wersalikach każdy wyraz
// wygląda jak nazwa własna, więc mostkowanie przez wyrazy wciągnęłoby osobę z dalszej części zdania.
// Skróty wyłącznie z kropką — „PL"/„OS" bez kropki to kod kraju czy system, nie ulica. Końcówki
// zamknięte jak wyżej: „KIEROWNIK PLACÓWKI", „SKLEP OSIEDLOWY", „FHU MOSTEK" to nie ulica.
const RE_STREET_EPONYM_TAIL_CAPS =
  /(?<!\p{L})(?:ULIC(?:A|Y|Ę|Ą|E)?|ALEJ(?:A|Ę|Ą|E)?|ALEI|PLAC(?:U|EM)?|ROND(?:O|A|U|ZIE|EM)?|MOST(?:U|EM)?|MOŚCIE|OSIEDL(?:E|A|U|EM)?|SKWER(?:U|ZE|EM)?|BULWAR(?:U|ZE|EM)?|PARK(?:U|IEM)?|ZBIEG(?:U)?|RÓG|ROGU|IMIENIA|(?:IM|UL|AL|PL|OS)\.)(?:[ \t]+(?:GEN|PŁK|PPŁK|MJR|KPT|POR|KS|ŚW|BŁ|BP|ABP|KARD|MARSZ|PROF|DR|DRA|INŻ|HR)\.?)*[ \t]+$/u;
// „im" bez kropki („Szkoła Podstawowa nr 3 im Marii Konopnickiej", „Szpitala im Mikołaja Kopernika")
// — niedbały zapis patrona. Kotwicą jest tylko po nazwie instytucji albo „nr N" tuż przed nim;
// zaimek („Pomógł im Jan Kowalski", „Dałem im Jana Kowalskiego za przykład") zostaje osobą.
// Zakotwiczony na początku wycinka od OSTATNIEGO wyrazu „im" (znalezionego przez lastIndexOf w oknie
// 220 znaków): późniejsze „im" przerwałoby ciąg nazw, więc wcześniejsze nie mogą pasować — jeden test
// zamiast skanu regexem od każdej pozycji okna przy każdym kandydacie na nazwisko.
const RE_BARE_IM_TAIL = new RegExp(
  `^im(?:[ \\t]+${STREET_RANK})*(?:[ \\t]+(?:[${PL_UP}][${PL_LO}${PL_UP}'’-]*|[IVXLCDM]+))*[ \\t]*$`,
  'u',
);
export const RE_INSTITUTION_WORD =
  /^(?:szkoł|szkół|szkol|szpital|przedszkol|liceum|gimnazj|technikum|uniwersyte|akademi|politechni|instytu|ośrod|zespoł|zespół|bibliotek|hufc|hufiec|parafi|fundacj|stowarzysze|muze|teatr|filharmoni|centrum|poradni|żłob|internat|burs|hospicj|klinik|przychodni|sanatori|kolegi|seminari|klub|stadion|zakład|dom(?:u|em|y|ów)?$)\p{L}*$/iu;
/** Czy tuż przed „im" stoi nazwa instytucji (najwyżej dwa wyrazy z wielkiej litery przerwy: „Szkoła
 *  Podstawowa im", „Szpitala im") albo „nr N" („Szkoła Podstawowa nr 3 im")? Skan kilku ostatnich
 *  wyrazów zamiast regexu z „$" próbowanego od każdej pozycji wycinka. Wyrazy dzieli też nowa linia,
 *  cudzysłów, średnik, nawias i ucieczka JSON-a: nazwa placówki zaczyna komórkę CSV („1;Szkoła
 *  Podstawowa im …"), wartość JSON („"Szkoła …") albo wiersz wykazu („Wykaz:⏎Szpital im …"). */
// Obiekty i komórki z patronem po gołym „im" („Kierownik Oddziału im Józefa Babińskiego", „Park im
// Marii Konopnickiej", „Rondo im …", „Kopalnia Soli im …") oraz skrót placówki WERSALIKAMI („ZSO im",
// „III LO im", „MOPS im", „CKZiU im"). Czasownik przed „im" stoi małą literą („Pomógł im Jan Kowalski").
const RE_INSTITUTION_WORD_EXACT =
  /^(?:oddział\p{L}*|katedr\p{L}*|wydział\p{L}*|sal[aię]?|aul[aię]?|pracowni\p{L}*|galeri\p{L}*|drużyn\p{L}*|nagrod\p{L}*|stypendi\p{L}*|konkurs\p{L}*|festiwal\p{L}*|park(?:u|iem)?|rond(?:o|a|zie)?|kopalni\p{L}*|hal[aię]?|pływalni\p{L}*|pomnik\p{L}*|kopiec|kopca|kopcu)$/iu;
const RE_INSTITUTION_ACRONYM = /^\p{Lu}{2,6}(?:i\p{Lu}+)?$/u;
function institutionBeforeIm(pre: string): boolean {
  const ws = pre.trimEnd().split(/[\s"„”';:()\\-]+/u).slice(-4);
  for (let i = ws.length - 1, caps = 0; i >= 0; i--) {
    const w = ws[i];
    if (RE_INSTITUTION_WORD.test(w) || RE_INSTITUTION_WORD_EXACT.test(w)) return true;
    if (RE_INSTITUTION_ACRONYM.test(w) && !/^[IVXLCDM]+$/.test(w)) return true;
    if (/^\d+[a-zA-Z]?$/.test(w)) return /^nr\.?$/i.test(ws[i - 1] ?? '');
    if (!/^\p{Lu}/u.test(w) || ++caps > 2) return false;
  }
  return false;
}
/**
 * Czy kandydat na pozycji `offset` stoi w nazwie ulicy/placu/obiektu (patron, nie osoba)? Osoba
 * w mianowniku nie jest patronem — patron stoi w dopełniaczu („przy alei Władysława Sikorskiego",
 * „PRZY ALEI WŁADYSŁAWA SIKORSKIEGO", „ul. Emilii Plater"). Imię w mianowniku rozstrzyga zawsze („Na
 * ulicy Jan Kowalski zasłabł", „NA ULICY JAN KOWALSKI ZOSTAŁ POTRĄCONY", „Na ul. Długiej Jan Kowalski
 * …"); po samych rangach („W parku lek. ", „ul. dra ") także nazwisko w mianowniku („W parku dr
 * Kowalski"). Poza tym samo nazwisko na -ski/-cki zostaje nazwą: „na placu Grzybowskim", „PLAC
 * GRZYBOWSKI".
 */
export const precededByStreetEponym = (t: string, offset: number): boolean => {
  const tail = t.slice(Math.max(0, offset - 220), offset);
  // tabulator tuż przed parą to granica komórki: „Logistyka⇥Plac⇥Kowalczyk Anna" — „Plac" to
  // sąsiednia kolumna (np. miejsce pracy), nie nazwa placu z patronem
  if (/\t[ \t]*$/.test(tail)) return false;
  if (RE_STREET_EPONYM_TAIL.test(tail)) return !nominativePersonAhead(t, offset, RE_STREET_RANK_ONLY_TAIL.test(tail));
  if (RE_STREET_EPONYM_TAIL_CAPS.test(t.slice(Math.max(0, offset - 60), offset))) return !nominativePersonAhead(t, offset, false);
  // ostatni samodzielny wyraz „im" (odstęp po obu stronach) — jedno przejście wstecz po wycinku
  const sep = (c: string | undefined): boolean => c === ' ' || c === '\t';
  let im = tail.lastIndexOf('im');
  while (im > 0 && !(sep(tail[im - 1]) && sep(tail[im + 2]))) im = tail.lastIndexOf('im', im - 1);
  return (
    im > 0 &&
    RE_BARE_IM_TAIL.test(tail.slice(im)) &&
    institutionBeforeIm(tail.slice(Math.max(0, im - 60), im)) &&
    !nominativePersonAhead(t, offset, false)
  );
};
/** Pojedynczy wyraz oznaczający ulicę/plac/obiekt (zamknięta odmiana jak w STREET_ANCHOR_SRC) — gdy
 *  stoi tuż PRZED imieniem w ciągu „Rondo Romana Dmowskiego" (kapitalizowany, wciągnięty do
 *  dopasowania pary), para to patron, nie osoba. Uzupełnia `precededByStreetEponym` (który patrzy
 *  PRZED całym dopasowaniem). */
export const RE_STREET_WORD =
  /^(?:ulic(?:a|y|ę|ą|e|om|ami|ach|zk[aięą]|zce)?|alej(?:a|ę|ą|e|om|ami|ach)?|alei|plac(?:u|em|e|y|ów|om|ami|ach)?|rond(?:o|a|u|em|zie|om|ami|ach)?|most(?:u|em|y|ów|om|ami|ach)?|osiedl(?:e|a|u|em|i|om|ami|ach)?|skwer(?:u|em|ze|y|ów|om|ami|ach)?|bulwar(?:u|em|ze|y|ów|om|ami|ach)?|park(?:u|iem|i|ów|om|ami|ach)?|zbieg(?:u|iem)?|rog(?:u|iem)?|róg|imienia|im|ul|al|pl|os)$/iu;
/** Kody walut — „PLN 123456" to kwota, nie dowód (wyjątek w kroku DOWÓD bez kontekstu). */
export const CURRENCY_CODES = new Set([
  'PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'JPY', 'UAH', 'RUB',
]);
