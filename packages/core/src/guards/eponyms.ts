// Strażniki kontekstu nie-osobowego: eponimy medyczne, patroni ulic, instytucji i świętych,
// etykiety jednostek administracyjnych.
import { HOMOGRAPH_SURNAMES, normalizeSurnameKey, surnameBase } from '../surnames.js';
import { JSON_ESC_PUA, PL_LO, PL_UP, RE_CHAR_L, RE_CHAR_LL, RE_CHAR_LU, RE_JSON_ESC_PUA } from '../charset.js';
import { FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { RE_SURNAME_OBLIQUE } from '../person-patterns.js';

/**
 * Głowy eponimów, po których nazwisko stoi zawsze w dopełniaczu („linii Langera", „prątki Kocha").
 * Wyłączają tylko znany eponim (EPONYM_SURNAME_FORMS): mianownik i dopełniacz osoby z pisma
 * („mistrza linii Kowalskiego") to osoba.
 */
const GEN_ONLY_CONTEXT = new Set<string>(
  (
    'odruch odruchu odruchy odruchów odruchem prątek prątka prątki prątków prątkami pałeczka ' +
    'pałeczki pałeczek pałeczkę pałeczkami uprząż uprzęży uprzężą dystrofia dystrofii dystrofię ' +
    'dystrofią linie linii liniami objawem trójkąt trójkąta'
  ).split(/\s+/),
);
/**
 * Wyrazy (małą literą), po których słowo na -ski/-cki to nie osoba, lecz eponim („choroba
 * Leśniowskiego"), nazwa ulicy, miejsca albo termin. Wstrzymują samodzielne detektory nazwiska
 * (passPersonSoloDict, passPersonSoloMorph).
 */
export const NON_PERSON_CONTEXT = new Set<string>([
  ...(
    'choroba chorobę choroby chorobą chorobie objaw objawu objawy objawie zespół zespołu zespole ' +
    'syndrom syndromu próba próbę próby odczyn odczynu test testu testem skala skali skalę metoda ' +
    'metodę metody metodą prawo prawa twierdzenie zasada zasadę reguła reakcja klasyfikacja punkt ' +
    'ulica ulicy ulicę ulicą ulic aleja alei aleję aleją plac placu placem placa rondo ronda most ' +
    'mostu mostem osiedle osiedla osiedlu dzielnica dzielnicy dzielnicę park parku skwer bulwar'
  ).split(/\s+/),
  ...GEN_ONLY_CONTEXT,
  // miejscownik „na moście Łazienkowskim" (oboczność st→ści, rdzeń „most" go nie obejmuje)
  'moście',
  // „powiat pruszkowski", „gmina …ska" to przymiotnik odmiejscowy; pola administracyjne są celowo
  // jawne (patrz FORM_FIELDS)
  ...'powiat powiatu powiecie powiatem gmina gminy gminie gminą województwo województwa województwie'.split(/\s+/),
]);
const RE_ADMIN_LABEL_END = new RegExp(
  String.raw`(?:powiat\w*|gmin[aęyą]|województw[oaeu]m?|dzielnic[aęy])[ \t]*:?[ \t]*(?:\n|\\[${JSON_ESC_PUA}])?[ \t]*$`,
  'i',
);
/**
 * Etykieta pola administracyjnego tuż przed wartością („Powiat: Pruszkowski", też wartość w następnej
 * linii): przymiotnik odmiejscowy po niej to nazwa jednostki, nie nazwisko. prevContextWord nie widzi
 * etykiety przez dwukropek i nową linię.
 */
export const precededByAdminLabel = (t: string, offset: number): boolean =>
  RE_ADMIN_LABEL_END.test(t.slice(Math.max(0, offset - 24), offset));
/**
 * Głowy eponimów, które wyłączają nazwisko także po wyrazie z wielkiej litery (początek zdania).
 * Pozostałe wyrazy NON_PERSON_CONTEXT to tam zwykłe rzeczowniki, po których stoi osoba
 * („Zespół Nowaka przygotował ofertę").
 */
export const EPONYM_HEADS = new Set<string>([
  ...GEN_ONLY_CONTEXT,
  ...'objaw objawu objawy objawie odczyn odczynu syndrom syndromu'.split(' '),
]);
/**
 * Nazwiska eponimów w formie, w jakiej stoją po głowie („odruch Babińskiego", „uprząż Pawlika").
 * Zbiór zamknięty, bo po tych głowach stoi też pacjent albo pracownik w dopełniaczu („Objawy
 * Kowalskiej ustąpiły"). Rzadki eponim spoza listy trafia do maski.
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
// Głowy, po których stoi tylko kilka eponimów. Inne nazwisko z listy po nich to osoba
// („operatora linii Babińskiego"); Pawlik, Koch i Fuchs to też częste nazwiska.
const EPONYM_PAIRED_HEADS: [RegExp, Set<string>][] = [
  [/^lini/, new Set('langera blaschko beau mees kerleya'.split(' '))],
  [/^prąt/, new Set(['kocha'])],
  [/^pałecz/, new Set('kocha pfeiffera friedländera löfflera'.split(' '))],
  [/^uprz[ęą]/, new Set(['pawlika'])],
  [/^dystrofi/, new Set('duchenne duchenne’a duchenne\'a beckera fuchsa'.split(' '))],
  [/^trójkąt/, new Set('hesselbacha scarpy calota petita kocha pawlika'.split(' '))],
];
const EPONYM_PAIRED_ONLY = new Set<string>(['pawlika', 'langera', 'blaschko', 'beau', 'mees', 'kerleya']);
/** Czy nazwisko-eponim pasuje do głowy przed nim (patrz EPONYM_PAIRED_HEADS)? */
export function eponymFits(head: string, word: string): boolean {
  const w = word.toLowerCase();
  if (!EPONYM_SURNAME_FORMS.has(w)) return false;
  for (const [re, set] of EPONYM_PAIRED_HEADS) if (re.test(head)) return set.has(w);
  return !EPONYM_PAIRED_ONLY.has(w);
}
/**
 * Czy nazwisko stoi w formie zależnej, a nie w mianowniku? Eponim i patron są zawsze w dopełniaczu,
 * osoba w zdaniu bywa w mianowniku. Formę zależną nazwiska spoza -ski rozpoznaje słownik.
 */
export function isObliqueSurnameForm(word: string): boolean {
  const w = word.toLowerCase();
  if (RE_SURNAME_OBLIQUE.test(w)) return true;
  if (/(?:sk|ck|dzk)[ia]$|(?:scy|ccy|dzcy|icz|czyk)$/.test(w)) return false;
  const base = surnameBase(w);
  return !!base && base !== w;
}
/**
 * Wyraz tuż przed pozycją, szukany najwyżej 40 znaków wstecz. Wyraz z wielkiej litery liczy się
 * tylko przez same spacje (wtedy cap: true), mały przez dowolne odstępy, też podmienione ucieczki
 * JSON „\n/\r/\t".
 */
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
  j = offset;
  for (;;) {
    if (j > lo && /\s/.test(text[j - 1])) j--;
    else if (j - 1 > lo && text[j - 2] === '\\' && RE_JSON_ESC_PUA.test(text[j - 1])) j -= 2;
    else break;
  }
  let k = j;
  while (k > lo && RE_CHAR_LL.test(text[k - 1])) k--;
  return k < j ? { word: text.slice(k, j).toLowerCase(), cap: false } : undefined;
};
/**
 * Czy `word` stoi po rzeczowniku kontekstu nie-osobowego (eponim, ulica, jednostka)? Po „moście"
 * tylko forma uzgodniona albo dopełniacz patrona; mianownik („Na moście Kowalski potrącił pieszego")
 * to osoba. Po wyrazie z wielkiej litery tylko głowa eponimu ze znanym eponimem.
 */
export const afterNonPersonContext = (text: string, offset: number, word: string, masked?: Set<string>): boolean => {
  const prev = prevContextWord(text, offset);
  if (!prev) return false;
  // osoba rozpoznana już w piśmie wygrywa z patronem mostu w dopełniaczu („Na moście Gzowskiego
  // zatrzymał patrol"). Eponimów to nie dotyczy: „Pacjent Babiński … odruch Babińskiego" to objaw.
  if (prev.word === 'moście' && /ego$/i.test(word) && masked?.has(normalizeSurnameKey(word))) return false;
  if (prev.word === 'moście') return /(?:im|ym|ego)$/i.test(word);
  if (prev.cap) return EPONYM_HEADS.has(prev.word) && eponymFits(prev.word, word);
  if (!NON_PERSON_CONTEXT.has(prev.word)) return false;
  return !GEN_ONLY_CONTEXT.has(prev.word) || eponymFits(prev.word, word);
};
// Ciąg do trzech wyrazów od wielkiej litery tuż za pozycją (też wersaliki), kandydat na patrona.
const RE_NAME_RUN_AHEAD = /^\p{Lu}[\p{L}'’-]*(?:[ \t]+\p{Lu}[\p{L}'’-]*){0,2}/u;
/**
 * Czy za pozycją stoi osoba w mianowniku, a nie patron w dopełniaczu? Rozstrzyga imię ze słownika
 * (mianownik albo biernik żeński to osoba, dopełniacz to patron), a z `withSurname` także nazwisko
 * w mianowniku. Imię dwuznaczne („Aleksandra") rozstrzyga nazwisko za nim.
 */
function nominativePersonAhead(t: string, offset: number, withSurname: boolean): boolean {
  const run = RE_NAME_RUN_AHEAD.exec(t.slice(offset, offset + 80))?.[0];
  if (!run) return false;
  const ws = run.toLowerCase().split(/[ \t]+/);
  const f = ws[0];
  const gen = isFirstNameGenitive(f);
  if (POLISH_FIRST_NAMES.has(f) && !gen) return true;
  // patron nigdy nie stoi w bierniku („przesłuchano św. Annę Gzowską")
  if (f.endsWith('ę') && POLISH_FIRST_NAMES.has(`${f.slice(0, -1)}a`)) return true;
  if (gen && !POLISH_FIRST_NAMES.has(f)) return false;
  if (!withSurname && !gen) return false;
  return (gen ? ws.slice(1) : ws).some(
    (w) =>
      !isFirstNameGenitive(w) &&
      (/(?:sk|ck|dzk)[iaą]$|(?:icz|czyk)$/.test(w) || surnameBase(w) === w || HOMOGRAPH_SURNAMES.has(w)),
  );
}
/**
 * Skrót patrona tuż przed pozycją: im./ul./al./pl./bł., z opcjonalnym inicjałem. Spacja po kropce
 * opcjonalna tylko po ul./im.: sklejone os./pl. to „osób" albo koniec domeny („gmina.pl.Halina").
 * „os." po liczbie to „osób". Granica \p{L} zamiast \b, bo \b w JS jest ASCII.
 */
const RE_PATRON_ABBR = /(?<![\p{L}\d_])(?:(?:im|ul)\.[ \t]*|(?<!\d[ \t]?)os\.[ \t]+|(?:al|pl|bł)\.[ \t]+)(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
// „św." w protokołach to też skrót „świadek", więc święty tylko po rzeczowniku sakralnym albo
// „pw."/„im." w tej samej linii. Bez kontekstu „św. Antoniego" trafia do maski (nadmaskowanie
// zamiast wycieku świadka). Warianty bez ogonków („kosciol pw. sw. Michala") też.
const SAINT_CONTEXT_WORD =
  /^(?:ko[sś]ci[oóe]\p{L}*|parafi\p{L}*|bazylik\p{L}*|katedr\p{L}*|kaplic\p{L}*|sanktuari\p{L}*|klasztor\p{L}*|kolegiat\p{L}*|cerk\p{L}*|sob[oó]r\p{L}*|zgromadzeni\p{L}*|zakon\p{L}*|sióstr|pw\.|im\.)$/iu;
const RE_SAINT_ABBR = /(?<!\p{L})[sś]w\.[ \t]+(?:[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*)?$/iu;
const RE_SAINT_PROCEDURAL_WORD =
  /^(?:przesłuch\p{L}*|wezwan[oaey]\p{L}*|wezwał\p{L}*|zezna\p{L}*|podpis\p{L}*|oświadczeni\p{L}*|protok[oó]ł\p{L}*|relacj\p{L}*|według|wg|ze|z)$/iu;
// Imię w dopełniaczu po „św."/„bł." tuż przed nazwiskiem („Parafia pw. św. Rafała Kalinowskiego"):
// patron w całości, także dla przebiegów samego nazwiska.
const RE_SAINT_GIVEN_BEFORE = /(?<!\p{L})[sś]w\.[ \t]+(\p{Lu}\p{Ll}+)[ \t]+$/u;
const RE_BLESSED_GIVEN_BEFORE = /(?<!\p{L})bł\.[ \t]+(\p{Lu}\p{Ll}+)[ \t]+$/u;
const RE_SAINT_EPITHET_AHEAD =
  /^\p{Lu}\p{Ll}+[ \t]+(?:Ewangelist\p{L}*|Archanio\p{L}*|Apostoł\p{L}*|Apostol\p{L}*|Męczennik\p{L}*|Meczennik\p{L}*|Chrzciciel\p{L}*|Wyznawc\p{L}*|Pustelnik\p{L}*)(?!\p{L})/u;
// Czynność świadka za parą („Sw. Adam Pustelnik zeznał"): „Sw." to wtedy świadek, a „Apostoł",
// „Pustelnik", „Wyznawca" bywają nazwiskami. „poda…" bez imiesłowu biernego, bo „podana do
// renowacji" to proza sakralna.
const RE_WITNESS_VERB_AHEAD =
  /^[ \t,]*(?:nie[ \t]+)?(?:zezna\p{L}*|poda(?!n[aeyi])\p{L}*|wyjaśni\p{L}*|wyjasni\p{L}*|stwierdzi\p{L}*|oświadczy\p{L}*|oswiadczy\p{L}*|potwierdzi\p{L}*|widzia\p{L}*|słysza\p{L}*|slysza\p{L}*|stawi\p{L}*|odmówi\p{L}*|odmowi\p{L}*|rozpozna\p{L}*|wskaza\p{L}*)(?!\p{L})/iu;
// Przydomek męski po imieniu żeńskim („Sw. Maria Meczennik") to nie święty.
const RE_SAINT_EPITHET_MASC = /^(?:Apostoł|Apostol|Męczennik|Meczennik|Pustelnik|Archanioł|Archaniol|Chrzciciel)$/u;
function saintEpithetAhead(t: string, offset: number): boolean {
  const m = RE_SAINT_EPITHET_AHEAD.exec(t.slice(offset, offset + 40));
  if (!m) return false;
  if (RE_WITNESS_VERB_AHEAD.test(t.slice(offset + m[0].length, offset + m[0].length + 30))) return false;
  const [given, epithet] = m[0].split(/[ \t]+/);
  return !(/a$/.test(given) && !/^(?:Kuba|Barnaba|Bonawentura|Kosma|Jarema)$/.test(given) && RE_SAINT_EPITHET_MASC.test(epithet));
}
const RE_SAINT_INITIAL = /(?<!\p{L})[sś]w\.[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]*$/iu;
/** Czy „św." tuż przed pozycją ma kontekst sakralny (najwyżej trzy wyrazy wstecz, ta sama linia)?
 *  Skan po wyrazach zamiast regexu z oknem, który próbowałby dopasowania od każdej pozycji. */
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
    // czynność procesowa między kościołem a „św." to skrót „świadek" („W kaplicy przesłuchano św. …")
    if (RE_SAINT_PROCEDURAL_WORD.test(w)) return false;
    if (/[\p{L}]\.$/u.test(w) && !/^(?:pw|im)\.$/i.test(w)) return false;
    if (SAINT_CONTEXT_WORD.test(w)) return true;
    // tylko „pod wezwaniem św. …": samo „wezwanie" to w protokole wezwanie sądu („Mimo wezwania św. Gzik")
    if (/^wezwaniem$/iu.test(w) && /^pod$/i.test(words[i - 1] ?? '')) return true;
    // przecinek, cyfra czy nawias przerywa ciąg nazwy
    if (!/^[\p{L}.]+$/u.test(w)) return false;
  }
  return false;
}
const wordAt = (t: string, i: number): string => /^\p{L}+/u.exec(t.slice(i, i + 30))?.[0] ?? '';
export const precededByPatron = (t: string, offset: number): boolean => {
  const near = t.slice(Math.max(0, offset - 12), offset);
  if (RE_PATRON_ABBR.test(near)) return true;
  // imię z przydomkiem świętego („św. Michał Archanioł"); świadek („Sw. Kowalski zeznal") go nie ma
  if (/(?<!\p{L})[SsŚś]w\.[ \t]*$/u.test(near) && saintEpithetAhead(t, offset)) return true;
  // „bł." nie jest skrótem świadka, więc kontekst sakralny nie jest potrzebny („Kościół bł. Jana
  // Nowaka"); osoba w mianowniku za nim tak
  const bl = RE_BLESSED_GIVEN_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset));
  if (bl) {
    const bw = bl[1].toLowerCase();
    if ((isFirstNameGenitive(bw) || egoNameGenitive(bw)) && !nominativePersonAhead(t, offset, true)) {
      const w = wordAt(t, offset).toLowerCase();
      if (/(?:[aeiouyąę]|ej)$/.test(w) && !/(?:sk|ck|dzk)i$/.test(w)) return true;
    }
  }
  // Święty to imię w dopełniaczu albo znana postać. Mianownik, inicjał („św. J. Kowalskiego") i samo
  // nazwisko („podpis św. Kowalskiego") to świadek, także obok kościoła.
  if (saintWithContext(t, offset, near)) {
    return !RE_SAINT_INITIAL.test(near) && !nominativePersonAhead(t, offset, true) && saintNameAt(t, offset);
  }
  const g = RE_SAINT_GIVEN_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset));
  const gl = g?.[1].toLowerCase() ?? '';
  if (!g || !(isFirstNameGenitive(gl) || egoNameGenitive(gl))) return false;
  // osoba w mianowniku za patronem („W kaplicy św. Rocha Teresa Wróbel prowadzi …")
  if (nominativePersonAhead(t, offset, true)) return false;
  // drugi człon patrona też w dopełniaczu („Kalinowskiego", „Boboli"); mianownik to osoba
  const w = wordAt(t, offset).toLowerCase();
  if (!/[aeiouyąę]$/.test(w) || /(?:sk|ck|dzk)i$/.test(w)) return false;
  const at = offset - g[0].length + g[0].indexOf(g[1]);
  return saintWithContext(t, at, t.slice(Math.max(0, at - 12), at));
};
function saintNameAt(t: string, offset: number): boolean {
  const w = wordAt(t, offset);
  const wl = w.toLowerCase();
  return isFirstNameLike(w) || isFirstNameGenitive(wl) || egoNameGenitive(wl) || FOREIGN_GIVEN_NAMES.has(wl);
}
/** Dopełniacz imienia na -i/-y („Antoniego", „Jerzego", „Ksawerego"). */
export const egoNameGenitive = (wl: string): boolean =>
  /ego$/.test(wl) && (POLISH_FIRST_NAMES.has(wl.slice(0, -3)) || POLISH_FIRST_NAMES.has(`${wl.slice(0, -3)}y`));
// Kotwica wyrazu ulicznego: rdzeń i zamknięta lista końcówek (otwarta łapała „placówki", „Mostowski").
// Granice \p{L}, bo \b w JS jest ASCII. „im" tylko z kropką, bo bez niej to zaimek („Pomógł im Jan Kowalski").
const STREET_ANCHOR_SRC =
  `(?:[Uu]lic(?:a|y|ę|ą|e|om|ami|ach|zk[aięą]|zce)?|[Aa]lej(?:a|ę|ą|e|om|ami|ach)?|[Aa]lei|` +
  `[Pp]lac(?:u|em|e|y|ów|om|ami|ach)?|[Rr]ond(?:o|a|u|em|zie|om|ami|ach)?|[Mm]ost(?:u|em|y|ów|om|ami|ach)?|` +
  `[Oo]siedl(?:e|a|u|em|i|om|ami|ach)?|[Ss]kwer(?:u|em|ze|y|ów|om|ami|ach)?|` +
  `[Bb]ulwar(?:u|em|ze|y|ów|om|ami|ach)?|[Pp]ark(?:u|iem|i|ów|om|ami|ach)?|[Zz]bieg(?:u|iem)?|` +
  `[Rr]og(?:u|iem)?|[Rr]óg|[Ii]mienia|` +
  `[Ii]m(?=\\.)|[Uu]l|[Aa]l|[Pp]l|[Oo]s)`;
// Rangi i tytuły w nazwie patrona („ul. gen. Andersa", „im. dr. med. Rafała Masztaka"); pierwsza
// litera też wielka, bo tak piszą urzędy („ul. Ks. Jerzego Popiełuszki").
export const STREET_RANK_WORDS = 'gen pułk płk ppłk mjr kpt por ks św bł bp abp kard marsz prof doc dra dr hab med lek n inż hr'.split(' ');
export const STREET_RANK = `(?:${STREET_RANK_WORDS
  .map((r) => `[${r[0].toUpperCase()}${r[0]}]${r.slice(1)}`)
  .join('|')})\\.?`;
// Patron tylko tuż po kotwicy, w jednej linii, bez mostkowania „i/oraz", przecinka, nowej linii
// i kropki (wciągały osobę z następnej klauzuli). Cena: drugi patron w wyliczeniu „ulic X oraz Y"
// bywa zamaskowany. Rangi tylko przed nazwą, bo tytuł po nazwie zaczyna osobę („Na ul. Długiej
// lek. Anna Nowak"). Dopuszczone „im."/„ul." sklejone z nazwą („im.Henryka Sienkiewicza").
const RE_STREET_EPONYM_TAIL = new RegExp(
  `(?<![\\p{L}])(?:${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?` +
    `(?:[ \\t]+${STREET_RANK})*` +
    `|(?:[Ii]m|[Uu]l)\\.[${PL_UP}][${PL_LO}${PL_UP}'’-]*)` +
    `(?:[ \\t]+(?:[${PL_UP}][${PL_LO}${PL_UP}'’-]*|[IVXLCDM]+))*` +
    `[ \\t]*$`,
  'u',
);
// Kotwica i same rangi tuż przed kandydatem („W parku lek. "): patron stoi wtedy w dopełniaczu,
// a mianownik to osoba z prozy, co rozstrzyga nominativePersonAhead z nazwiskiem.
const RE_STREET_RANK_ONLY_TAIL = new RegExp(
  `(?<![\\p{L}])${STREET_ANCHOR_SRC}(?![\\p{L}])\\.?(?:[ \\t]+${STREET_RANK})+[ \\t]*$`,
  'u',
);
// Wersalikowa kopia STREET_ANCHOR_SRC i podzbioru STREET_RANK („RONDO ROMANA DMOWSKIEGO"). Tylko tuż
// po kotwicy, bo w wersalikach każdy wyraz wygląda jak nazwa własna. Skróty tylko z kropką: „PL"/„OS"
// bez niej to kod kraju czy system.
const RE_STREET_EPONYM_TAIL_CAPS =
  /(?<!\p{L})(?:ULIC(?:A|Y|Ę|Ą|E)?|ALEJ(?:A|Ę|Ą|E)?|ALEI|PLAC(?:U|EM)?|ROND(?:O|A|U|ZIE|EM)?|MOST(?:U|EM)?|MOŚCIE|OSIEDL(?:E|A|U|EM)?|SKWER(?:U|ZE|EM)?|BULWAR(?:U|ZE|EM)?|PARK(?:U|IEM)?|ZBIEG(?:U)?|RÓG|ROGU|IMIENIA|(?:IM|UL|AL|PL|OS)\.)(?:[ \t]+(?:GEN|PŁK|PPŁK|MJR|KPT|POR|KS|ŚW|BŁ|BP|ABP|KARD|MARSZ|PROF|DR|DRA|INŻ|HR)\.?)*[ \t]+$/u;
// Gołe „im" („Szkoła Podstawowa nr 3 im Marii Konopnickiej") jest kotwicą tylko po nazwie instytucji
// albo „nr N", bo inaczej to zaimek. Test od ostatniego „im" w oknie (lastIndexOf): późniejsze „im"
// przerwałoby ciąg nazw, więc wcześniejsze nie mogą pasować.
const RE_BARE_IM_TAIL = new RegExp(
  `^im(?:[ \\t]+${STREET_RANK})*(?:[ \\t]+(?:[${PL_UP}][${PL_LO}${PL_UP}'’-]*|[IVXLCDM]+))*[ \\t]*$`,
  'u',
);
export const RE_INSTITUTION_WORD =
  /^(?:szkoł|szkół|szkol|szpital|przedszkol|liceum|gimnazj|technikum|uniwersyte|akademi|politechni|instytu|ośrod|zespoł|zespół|bibliotek|hufc|hufiec|parafi|fundacj|stowarzysze|muze|teatr|filharmoni|centrum|poradni|żłob|internat|burs|hospicj|klinik|przychodni|sanatori|kolegi|seminari|klub|stadion|zakład|dom(?:u|em|y|ów)?$)\p{L}*$/iu;
// Obiekty z patronem po gołym „im" („Kierownik Oddziału im Józefa Babińskiego", „Park im …").
const RE_INSTITUTION_WORD_EXACT =
  /^(?:oddział\p{L}*|katedr\p{L}*|wydział\p{L}*|sal[aię]?|aul[aię]?|pracowni\p{L}*|galeri\p{L}*|drużyn\p{L}*|nagrod\p{L}*|stypendi\p{L}*|konkurs\p{L}*|festiwal\p{L}*|park(?:u|iem)?|rond(?:o|a|zie)?|kopalni\p{L}*|hal[aię]?|pływalni\p{L}*|pomnik\p{L}*|kopiec|kopca|kopcu)$/iu;
// Skrót placówki wersalikami („ZSO im", „CKZiU im").
const RE_INSTITUTION_ACRONYM = /^\p{Lu}{2,6}(?:i\p{Lu}+)?$/u;
/** Czy tuż przed „im" stoi nazwa instytucji (najwyżej dwa wyrazy z wielkiej litery przerwy) albo
 *  „nr N"? Wyrazy dzieli też cudzysłów, średnik, nawias i ucieczka JSON, bo nazwa placówki zaczyna
 *  komórkę CSV albo wartość JSON. Czasownik przed „im" stoi małą literą („Pomógł im Jan Kowalski"). */
function institutionBeforeIm(pre: string): boolean {
  const ws = pre.trimEnd().split(/[\s"„”';:()\\-]+/u).slice(-4);
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
 * Czy kandydat stoi w nazwie ulicy, placu albo obiektu (patron w dopełniaczu), a nie jest osobą
 * w mianowniku („Na ulicy Jan Kowalski zasłabł")? Tylko konteksty uliczne i dedykacyjne: w medycznych
 * para z imieniem bywa realną osobą. Uzupełnia precededByPatron o pełne wyrazy i gołe „im".
 */
export const precededByStreetEponym = (t: string, offset: number): boolean => {
  const tail = t.slice(Math.max(0, offset - 220), offset);
  // tabulator tuż przed parą to granica komórki: „Plac⇥Kowalczyk Anna" to sąsiednia kolumna
  if (/\t[ \t]*$/.test(tail)) return false;
  if (RE_STREET_EPONYM_TAIL.test(tail)) return !nominativePersonAhead(t, offset, RE_STREET_RANK_ONLY_TAIL.test(tail));
  if (RE_STREET_EPONYM_TAIL_CAPS.test(t.slice(Math.max(0, offset - 60), offset))) return !nominativePersonAhead(t, offset, false);
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
/** Pojedynczy wyraz uliczny (ta sama zamknięta odmiana co STREET_ANCHOR_SRC). Stoi tuż przed imieniem
 *  wciągniętym do pary („Rondo Romana Dmowskiego"), więc para to patron. */
export const RE_STREET_WORD = new RegExp(`^${STREET_ANCHOR_SRC.replace('(?=\\.)', '')}$`, 'iu');
