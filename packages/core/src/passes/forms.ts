// Pola formularza („Etykieta: wartość", wartość w następnej linii, wiersze z TAB-em) i bramki wartości
// osoby, z których korzysta też przebieg danych strukturalnych.
import { foldAscii, HOMOGRAPH_SURNAMES, isConfirmedSurname, normalizeSurnameKey, surnameShaped } from '../surnames.js';
import { escapeRe } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { FORM_FIELDS, FORM_LABEL_WORDS, type FormField, formLabelOf, GENERIC_LOGINS, isFormLabelLine, isValidFormValue, RE_DATE_VALUE, RE_PROPER_WORDS, stripFormPrefix, TAB_ROLE_LABELS } from '../dict/forms.js';
import { isFirstNameLike, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';


// Wyraz z wielkiej litery sam po tytule („Pani Nguyen") wskazuje, który wyraz wartości z nierozpoznanym
// imieniem i nazwiskiem jest nazwiskiem.
const RE_TITLED_SINGLE = /(?<!\p{L})(?:Pan(?:i|a|u|ią|em|ie)?|dr|prof|mgr)\.?[ \t]+(\p{Lu}[\p{Ll}'’-]+)(?![\p{L}'’-])(?![ \t]+\p{Lu})/gu;
// Wpis zastępczy w polu osoby („NN", „nieustalone", „jak wyżej").
const RE_FORM_PERSON_PLACEHOLDER = /^(?:n\.?[ \t]?n\.?|x+|nieustal\p{L}*|do[ \t]+uzupełnienia|jak[ \t]+wyżej|j\.[ \t]?w\.?)$/iu;
// Pierwszy wyraz wartości, który robi z niej komórkę urzędu albo rolę („Dział Kadr", „Dom Dziecka").
// Porównanie bez ogonków, bo etykiety bywają z systemów bez polskich znaków („Kierownik Dzialu").
const FORM_NOT_PERSON_HEAD_FOLDED = new Set<string>(
  [...LEGAL_ENTITY_WORDS, ...ROLE_WORDS, ...'dział działu sekretariat kadry dom biuro'.split(' ')].map(foldAscii),
);
// Wyrazy, które na dowolnej pozycji wartości robią z niej instytucję, komórkę albo rolę („Powiatowe
// Centrum Pomocy Rodzinie"). Bez homografów nazwisk („Sołtys", „Nowa"), te rozstrzyga tylko pierwszy wyraz.
const FORM_NOT_PERSON_ANY = new Set<string>(
  (
    'ośrodek ośrodka centrum pomocy społecznej rodzinie rodziny wspólnota wspólnoty mieszkaniowa ' +
    'gazeta redakcja tygodnik tygodnika dziennik sieć straż pożarna ochotnicza dystrybucja operator ' +
    'paliwa oddział oddziału gmina gminy gminne gminny gminna miejski miejska miejskie powiatowe ' +
    'powiatowy powiatowa miasto miasta wsi placówka zastępcza rodzina recepcja sekretariat projekt ' +
    'projektu informacji kultury fundacja stowarzyszenie spółka spółdzielnia szkoła przedszkole ' +
    'szpital przychodnia urząd urzędu zarząd kancelaria matka ojciec rodzice opiekun opiekunka ' +
    'kierowca noworodek koordynator koordynatorka dyrekcja'
  )
    .split(' ')
    .map(foldAscii),
);
const isInstitutionWord = (w: string): boolean => w.toLowerCase().split('-').some((p) => FORM_NOT_PERSON_ANY.has(foldAscii(p)));
// Przymiotnik w kształcie nazwy instytucji („Mieszkaniowa", „Gminny"); liczy się tylko bez imienia
// i nazwiska ze słownika. Przed „-na/-ne/-ny" spółgłoska, bo obce imię tego kształtu („Oksana") ma samogłoskę.
const RE_FORM_INSTITUTION_ADJ = /(?:ow[aey]|owej|owego|[^aeiouyąęó]n[aey]|nej|nego|cz[aey]|czej|ych)$/u;
// Otczestwo w środku wartości („Iwanowna", „Petrowicz").
const RE_PATRONYMIC = /(?:ovna|owna|evna|ewna|ivna|iwna|ovich|owicz|evich|ewicz)$/i;
// Homograf wyrazu instytucji jako nazwisko za imieniem spoza słownika („Jisoo Park", „Bożydar Rada").
const FORM_HOMOGRAPH_SURNAME_TAIL = new Set<string>(['park', 'rada', 'bank', 'koło']);
// Imię koreańskie w zapisie łacińskim, jedna albo dwie sylaby („Jisoo", „Seo-yeon"). Wyraz firmy
// („Aqua", „Business") tego kształtu nie ma.
const RE_KOREAN_GIVEN_NAME =
  /^(?:(?:kk|tt|pp|ss|jj|ch|[gkndtrlmbpsjh])?(?:yeo|yae|wae|eo|ae|ya|ye|yo|yu|wa|wo|we|wi|oe|eu|ui|oo|ee|[aeiou])(?:ng|[nmklpt])?-?){1,2}$/i;
// Słowiańskie imię złożone spoza słownika przed homografem „Rada/Bank/Koło" („Bożydar Rada").
const RE_SLAVIC_COMPOUND_GIVEN = /(?:mir|mira|sław|sława|dar|gniew|bor|wit|mił|miła|wój|woja|rad|rada)$/i;
// Imię chińskie albo wietnamskie w szyku paszportowym („WANG Xiaoming"): sylaby pinyin albo wietnamskie.
// Nazwa firmy za skrótem („BNP Paribas", „ERGO Hestia") tego kształtu nie ma.
const RE_EAST_ASIAN_GIVEN_NAME =
  /^(?:(?:zh|ch|sh|th|tr|ng|nh|ph|kh|gi|qu|[bcdfghjklmnpqrstvwxyz])?[aeiouy]{1,3}(?:ng|nh|ch|[nmcpt])?){1,3}$/i;
// Akronimy instytucji, które w wartości pola osoby oznaczają podmiot („BGK Nieruchomości").
const FORM_INSTITUTION_ACRONYMS = new Set<string>(
  (
    'PGE ZUS KRUS PKO PZU NFZ GOPS MOPS MOPR PCPR OPS ZOZ PKP PKS UM UG US PUP WUP KRS GUS NBP BGK BIK ' +
    'PIP SKO WSA NSA SN TK RIO KIO UZP OSP ZHP PCK PZM ZDW ZDP ZDM MPK PWiK ZGK ZUK ZOL DPS ŚDS CUS ' +
    'CAS KOWR IPN UKS GKS MKS LKS AZS PKN PAP LOT PLL ENEA TVP'
  ).split(' '),
);
// Imię dwuczłonowe z łącznikiem w transkrypcji koreańskiej i wietnamskiej („Min-jun").
const RE_HYPHEN_GIVEN_NAME = /^\p{Lu}\p{Ll}+-\p{L}\p{Ll}+$|^\p{Lu}{2,}-\p{Lu}{2,}$/u;
// Słownictwo nagłówków kolumn tabeli z PDF (komórka pod komórką, zapis bez ogonków).
const NEXT_LINE_HEADER_WORDS = new Set<string>(
  (
    'podpis podpisy grupa ocena ocen godzina rodzaj srednia rok lekarz wychowawca klasa klasy data ' +
    'numer termin uwagi wynik wyniki miejsce adres telefon stanowisko kwota liczba status typ opis ' +
    'rozpoznanie zawod plec wiek rodzica rodzicow opiekuna ucznia pacjenta dziecka imie nazwisko lp ' +
    'semestr przedmiot frekwencja oddzial sala pokoj godziny dzien'
  ).split(' '),
);
// Imiesłów i rzeczownik odczasownikowy („Prowadzący", „Przyjęcia").
const RE_NEXT_LINE_HEADER_MORPH = /(?:ący|ąca|ące|[eęa]nia|ęcia|enie|anie|ości|ość)$/u;
const nextLineHeaderWord = (w: string): boolean =>
  NEXT_LINE_HEADER_WORDS.has(foldAscii(w)) || RE_NEXT_LINE_HEADER_MORPH.test(w) || RE_FORM_INSTITUTION_ADJ.test(w);
// Forma prawna w wartości („PGE Dystrybucja S.A.", „Trans Sp. z o.o.").
const RE_FORM_LEGAL_FORM = /(?:^|[ \t])(?:S\.?A|SA|Sp|sp|S\.?C|Sp\.?[ \t]?[jkJK])\.?(?=[ \t]|$)/u;
const RE_LEADING_WORD = /^(\S+)[ \t]+/;
/**
 * Bramka wartości dla etykiet z FormField.gated. Wartość, która nie wygląda na osobę (instytucja, rola,
 * akronim, forma prawna, wpis zastępczy, pouczenie małą literą), zostaje jawna. Rola, instytucja albo
 * tytuł małą literą przed imieniem trafia do `lead`, interpunkcja na końcu do `tail`. Wartość
 * z następnej linii wymaga imienia albo nazwiska ze słownika, bo nagłówek kolumny wygląda tak samo.
 */
function gatedPersonValue(
  val: string,
  nextLine: boolean,
  surnameOnly = false,
): { lead: string; core: string; tail: string } | null {
  let lead = '';
  let core = val;
  for (let m = RE_LEADING_WORD.exec(core); m && /^\p{Ll}/u.test(m[1]) && RE_VALUE_TITLE_OR_INITIAL.test(m[1]); m = RE_LEADING_WORD.exec(core)) {
    lead += m[0];
    core = core.slice(m[0].length);
  }
  const tail = /[.,;]+$/.exec(core)?.[0] ?? '';
  core = core.slice(0, core.length - tail.length);
  if (!core || RE_FORM_PERSON_PLACEHOLDER.test(core)) return null;
  let ws = core.split(/[ \t]+/);
  if (FORM_NOT_PERSON_HEAD_FOLDED.has(foldAscii(ws[0].toLowerCase()))) {
    const fi = ws.findIndex(isFirstNameLike);
    if (fi < 1) return null;
    // Samo imię za rolą to szyk „Nazwisko Imię" z nazwiskiem-homografem („Marszałek Anna"), więc całość
    // jest osobą. Imię z nazwiskiem za nią to osoba po nazwie instytucji albo roli.
    if (ws.length - fi >= 2) {
      const parts = core.split(/([ \t]+)/);
      lead += parts.slice(0, 2 * fi).join('');
      core = parts.slice(2 * fi).join('');
      ws = ws.slice(fi);
    }
  }
  const notPerson = (w: string): boolean =>
    isInstitutionWord(w) ||
    w
      .toLowerCase()
      .split('-')
      .some((p) => LEGAL_ENTITY_WORDS.has(p) && !isConfirmedSurname(w));
  // Nazwisko-homograf wyrazu instytucji na końcu, za samym imieniem („Anna Koło", „Min-jun Park"):
  // imię przed nim rozstrzyga osobę. Wyrazy z FORM_NOT_PERSON_ANY nie bywają nazwiskami.
  const homographSurnameAt = (w: string, i: number): boolean =>
    i === ws.length - 1 &&
    i > 0 &&
    i <= 2 &&
    !isInstitutionWord(w) &&
    (ws.slice(0, i).every((g) => isFirstNameLike(g) || RE_HYPHEN_GIVEN_NAME.test(g)) ||
      // Imię spoza słownika musi mieć kształt imienia: koreański przed „Park", słowiański złożony przed
      // „Rada/Bank/Koło". Nazwa firmy albo obiektu („Aqua Park", „Alior Bank") go nie ma.
      (ws.length === 2 &&
        !nextLine &&
        FORM_HOMOGRAPH_SURNAME_TAIL.has(w.toLowerCase()) &&
        /^\p{Lu}\p{Ll}+$/u.test(ws[0]) &&
        (w.toLowerCase() === 'park' ? RE_KOREAN_GIVEN_NAME.test(ws[0]) : RE_SLAVIC_COMPOUND_GIVEN.test(ws[0])) &&
        !RE_FORM_INSTITUTION_ADJ.test(ws[0].toLowerCase()) &&
        !RE_NEXT_LINE_HEADER_MORPH.test(ws[0].toLowerCase()) &&
        !/(?:sk|ck|dzk|n)[aiey]$/u.test(ws[0].toLowerCase()) &&
        !notPerson(ws[0])));
  if (ws.some((w, i) => notPerson(w) && !homographSurnameAt(w, i)) || RE_FORM_LEGAL_FORM.test(core)) return null;
  if (!RE_PROPER_WORDS.test(core)) return lowercaseNameLooksLikePerson(ws) ? { lead, core, tail } : null;
  const proven = ws.some((w) => isFirstNameLike(w) || isConfirmedSurname(w));
  if (!proven) {
    // Obce imię i nazwisko z następnej linii („Yuki Tanaka") wygląda jak nagłówek kolumny, więc nagłówek
    // odsiewamy po słownictwie i polskiej morfologii. Pojedynczy wyraz dalej wymaga słownika.
    if (nextLine && (ws.length < 2 || ws.some((w) => nextLineHeaderWord(w.toLowerCase())))) return null;
    // Przymiotnik nijaki pod etykietą samego nazwiska („Nazwisko dziecka: Wspólne") to wypełniacz formularza.
    if (surnameOnly && ws.length === 1 && /^\p{Lu}\p{Ll}+(?:ne|owe|ewe|kie|gie|cie|te|łe)$/u.test(ws[0])) return null;
    // Skrót wersalikami w wartości pisanej zwykle („ZUS …") to podmiot. Wyjątek: szyk paszportowy
    // z nazwiskiem wersalikami na początku albo końcu („Thi Lan HO"), gdy skrót nie jest akronimem instytucji.
    const capsAt = ws.flatMap((w, i) => (/^\p{Lu}{2,4}$/u.test(w) ? [i] : []));
    if (core !== core.toUpperCase() && capsAt.length) {
      const ci = capsAt[0];
      const passport =
        capsAt.length === 1 &&
        ws.length >= 2 &&
        ws.length <= 4 &&
        (ci === 0 || ci === ws.length - 1) &&
        !FORM_INSTITUTION_ACRONYMS.has(ws[ci]) &&
        ws.every((w, i) => i === ci || (/^\p{Lu}\p{Ll}+$/u.test(w) && RE_EAST_ASIAN_GIVEN_NAME.test(w)));
      if (!passport) return null;
    }
    // Przymiotnik instytucji odrzuca wartość. Nie dotyczy nazwiska na „-owa/-ewa/-ova" na końcu
    // (wschodniosłowiańskie, środkowoazjatyckie), otczestwa w środku i samego wyrazu pod etykietą nazwiska.
    if (
      !(surnameOnly && ws.length === 1 && !nextLine) &&
      ws.some(
        (w, i) =>
          RE_FORM_INSTITUTION_ADJ.test(w.toLowerCase()) &&
          !(i === ws.length - 1 && i > 0 && /[oe][wv]a$/i.test(w)) &&
          !(i > 0 && i < ws.length - 1 && RE_PATRONYMIC.test(w)),
      )
    )
      return null;
  }
  return { lead, core, tail };
}

// Etykieta następnego pola w wartości tej samej linii: wyraz z wielkiej litery, do dwóch dalszych
// wyrazów i dwukropek („ PESEL:", „ Nr lokalu:").
const RE_NEXT_FIELD_LABEL = /[ \t]+\p{Lu}[\p{L}.]*(?:[ \t]+\p{L}+\.?){0,2}[ \t]*:/u;
// Numer pozycji przed etykietą („04. Ulica: Warszawska  05. Nr domu: 31") należy do etykiety tylko
// w formularzu numerowanym. Bez tego „Ulica: Krótka 7. Piętro: 2" traciłoby numer domu.
const RE_FLAT_FIELD_NO_END = /(?:^|[ \t]+)\d{1,2}[.)]$/;
const RE_FLAT_FORM_NUMBERED = /^[ \t]*\d{1,2}[.)][ \t]/;
// Wyraz otwierający etykietę wielowyrazową („Nr domu:", „Data urodzenia:", „Wymiar Etatu:"): przed nim
// stoi jeszcze wartość poprzedniego pola.
const RE_FLAT_LABEL_OPENER =
  /^(?:nr|numer|kod|data|adres|miejsce|imię|imie|nazwisko|telefon|tel|wymiar|wynagrodzenie|wykształcenie|osoba|do|obywatelstwo|dowód|okres|kwota|stan|stopień|rodzaj|seria|stanowisko|wysokość|forma)\.?$/i;
/**
 * Etykieta następnego pola zaczyna się od ostatniego wyrazu z wielkiej litery przed dwukropkiem:
 * w „Długa 5 Kraków Tel:" miasto należy jeszcze do wartości. Dalsze człony etykiety są małą literą.
 */
function flatNextLabel(rest: string): { index: number; text: string } | null {
  const nx = RE_NEXT_FIELD_LABEL.exec(rest);
  if (!nx) return null;
  const parts = nx[0].split(/([ \t]+)/);
  // parts: ['', odstęp, wyraz, odstęp, wyraz, …], wyrazy na pozycjach parzystych od 2
  let i = parts.length - 1;
  while (i > 2 && !/^\p{Lu}/u.test(parts[i])) i -= 2;
  while (i > 2 && RE_FLAT_LABEL_OPENER.test(parts[i - 2])) i -= 2;
  if (i <= 2) return { index: nx.index, text: nx[0] };
  const skip = parts.slice(0, i - 1).join('').length;
  return { index: nx.index + skip, text: nx[0].slice(skip) };
}
// Pola rozpoznawane tylko jako kolejne pole spłaszczonego wiersza adresu („Ulica: Długa 5 M.: 3").
// Samodzielne „Lokal: 5" czy „Miasto: Kraków" to nagłówki urzędów albo opis lokalu, więc nie ma ich
// w FORM_FIELDS. Numer lokalu tylko liczbowy, bo „M.:" bywa skrótem miasta.
const FLAT_ONLY_FIELDS: FormField[] = [
  { re: /^(?:m|lok|lokal|mieszk|mieszkanie)\.?$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:miasto|poczta)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
];
/**
 * Wartość pola adresowego z kolejnymi polami w tym samym wierszu: każda wartość znanego pola dostaje
 * swoją maskę, a etykiety i pola spoza listy („PESEL:") zostają dla dalszych przebiegów. Null, gdy
 * w wartości nie ma kolejnej etykiety.
 */
function maskFlatFormFields(
  ctx: RedactCtx,
  field: FormField,
  val: string,
  numbered: boolean,
  maskOf: (f: FormField, v: string, label: string) => string,
): string | null {
  const segs: { label: string; value: string }[] = [];
  let label = '';
  let rest = val;
  for (let n = 0; n < 8; n++) {
    const nx = flatNextLabel(rest);
    if (!nx || nx.index === 0) break;
    let value = rest.slice(0, nx.index);
    let num = '';
    const no = numbered ? RE_FLAT_FIELD_NO_END.exec(value) : null;
    if (no) {
      num = no[0];
      value = value.slice(0, no.index);
    }
    segs.push({ label, value });
    label = num + nx.text;
    rest = rest.slice(nx.index + nx.text.length);
  }
  if (!segs.length) return null;
  // numer kolejnej pozycji na końcu wiersza („Nr domu:  19.") to etykieta pustego pola, nie wartość
  const lastNo = numbered ? RE_FLAT_FIELD_NO_END.exec(rest) : null;
  segs.push({ label, value: lastNo ? rest.slice(0, lastNo.index) : rest });
  if (lastNo) segs.push({ label: lastNo[0], value: '' });
  let out = '';
  for (let k = 0; k < segs.length; k++) {
    const { label: lb, value } = segs[k];
    const lbl = k === 0 ? '' : formLabelOf(stripFormPrefix(lb.replace(/:[ \t]*$/, '')));
    let f = k === 0 ? field : FORM_FIELDS.find((ff) => ff.re.test(lbl));
    let flatOnly = false;
    if (!f && k > 0) {
      f = FLAT_ONLY_FIELDS.find((ff) => ff.re.test(lbl));
      flatOnly = !!f;
    }
    // Przecinek albo średnik przed etykietą następnego pola („Ulica: Lipowa, Nr domu: 3") rozdziela
    // pola, nie należy do wartości.
    const vt = value.trim().replace(/[ \t]*[,;]$/, '');
    if (
      f &&
      !f.gated &&
      f.kind !== 'date' &&
      ctx.on(f.type) &&
      vt &&
      isValidFormValue(vt, f.kind) &&
      (!flatOnly || f.kind !== 'addr' || /^\d{1,3}[A-Za-z]?$/.test(vt))
    ) {
      const lead = /^[ \t]*/.exec(value)?.[0] ?? '';
      // kolejne pole osobowe w trybie pseudonimów dostaje etykietę osoby (spójną z prozą)
      out += `${lb}${lead}${k === 0 ? f.mask : maskOf(f, vt, lbl)}${value.slice(lead.length + vt.length)}`;
      ctx.bump(f.type);
    } else out += lb + value;
  }
  return out;
}
// Komórka „Etykieta: wartość" w wierszu rozdzielonym TAB-em („Imię: Jan⇥Nazwisko: Kowal"). Kropka
// skrótu może stać w etykiecie („Data ur.:", „Nr tel.:").
const RE_TAB_CELL_LABEL = /^[ ]*(?:\d{1,2}[.)][ ]*)?\p{L}(?:[\p{L} ()]|\.(?=[ ]*[\p{L}:])){0,40}:/u;
// Etykieta bez dwukropka w osobnej komórce („Imię⇥Adam⇥Nazwisko⇥Nowak"): zamknięta lista etykiet
// osobowych i identyfikatorów.
const RE_TAB_BARE_LABEL =
  /^[ ]*(?:(?:pierwsze[ ]+|drugie[ ]+)?imi[eę](?:[ ]+(?:ojca|matki))?|imiona|nazwisko(?:[ ]+(?:rodowe|panie[nń]skie))?(?:[ ]+matki)?|imi[eę][ ]+i[ ]+nazwisko|nazwisko[ ]+i[ ]+imi[eę]|data[ ]+ur(?:\.|odzenia)|miejsce[ ]+ur(?:\.|odzenia)|pesel|nip|tel(?:\.|efon)|nr[ ]+tel(?:\.|efonu)|e-?mail|adres|ulica|miejscowo[sś][cć]|kod[ ]+pocztowy|nr[ ]+dowodu|płeć|obywatelstwo)[ ]*$/iu;
const RE_TAB_FIRST_NAME_LABEL = /^[ ]*(?:pierwsze[ ]+|drugie[ ]+)?imi[eę](?:[ ]+(?:ojca|matki))?[ ]*$/iu;
// Etykieta własnego imienia osoby z wiersza (bez imion rodziców).
const RE_OWN_FIRST_NAME_LABEL = /^(?:pierwsze[ ]+|drugie[ ]+)?imi[eę]$/iu;
// Nazwy kolumn, które w nagłówku tabeli stoją za etykietą osobową („Nazwisko⇥Imię⇥Stanowisko").
const TAB_HEADER_WORDS = new Set<string>([
  ...FORM_LABEL_WORDS,
  ...'wiek miasto lokal dział stanowisko uwagi status lp funkcja rola klasa grupa oddział stopień ocena wynik kwota termin podpis'.split(' '),
]);
// Komórka „etykieta wartość" bez dwukropka („Data ur. 03.04.1980", „PESEL 44051401359") to osobne pole.
// Tylko etykiety identyfikatorów, bo „Imię Jan" bywa nagłówkiem prozy.
const RE_TAB_LABEL_VALUE = /^[ ]*(?:data[ ]+ur(?:\.|odzenia)|pesel|nip|tel(?:\.|efon)|nr[ ]+tel(?:\.|efonu)?)[ ]+[\p{L}\d]/iu;
const RE_TAB_SURNAME_CELL = /^[ ]*nazwisko[ ]*:[ \t]*(\p{Lu}[\p{L}-]+)[ \t]*$/iu;
const RE_TAB_EMPTY_COLON_LABEL = /^[^:]*:[ ]*$/;
// Rola osoby z imieniem albo dwoma imionami w komórce („Świadek: Jan", „Uczestnik: Marek Paweł").
const RE_TAB_ROLE_NAME_CELL = /^([\p{L} ]{2,30}):[ \t]+(\p{Lu}\p{Ll}+(?:[ ]+\p{Lu}\p{Ll}+)?)[ \t]*$/u;
// Lista dwóch imion („Imiona rodziców: Jan, Anna", „Jan i Anna").
const RE_NAME_LIST_PAIR = /^(\p{Lu}\p{Ll}+)([ \t]*,[ \t]*|[ \t]+(?:i|oraz)[ \t]+)(\p{Lu}\p{Ll}+)$/u;
const isTabFieldCell = (c: string): boolean => RE_TAB_CELL_LABEL.test(c) || RE_TAB_LABEL_VALUE.test(c);
const isTabLabelCell = (c: string): boolean => isTabFieldCell(c) || RE_TAB_BARE_LABEL.test(c);
// Etykieta w formularzu z TAB-em: pole osobowe albo identyfikator, rola osoby („Pacjent") albo nazwa
// pola spoza osoby („Stanowisko").
const isTabLabelish = (c: string): boolean => {
  const l = c.trim().toLowerCase();
  return isTabLabelCell(c) || TAB_ROLE_LABELS.has(l) || TAB_HEADER_WORDS.has(l);
};
const isTabValueCell = (c: string): boolean => {
  const l = c.trim().toLowerCase();
  // rola małą literą to wartość pola („Funkcja⇥świadek"), wielką etykieta („Świadek⇥Jan")
  return l !== '' && !isTabLabelCell(c) && !TAB_HEADER_WORDS.has(l) && !(TAB_ROLE_LABELS.has(l) && /^[ ]*\p{Lu}/u.test(c));
};
// Wiersze tekstu po rozbiciu wierszy z TAB-em na komórki-pola. `groups` pozwala złożyć je z powrotem
// z oryginalnymi separatorami.
interface FormRows {
  lines: string[];
  groups: { n: number; seps: string[] }[];
  tabCell: Set<number>;
  // komórka „etykieta bez dwukropka⇥wartość" → długość etykiety z separatorem (początek wartości)
  bareLabel: Map<number, number>;
  // Tryb pseudonimów: indeks komórki wiersza → nazwisko z komórki „Nazwisko" tego wiersza, żeby imię
  // w osobnej komórce dostało pseudonim tej samej osoby. `at` to indeks komórki „Nazwisko": rola osoby
  // należy do niej tylko tuż przed tą komórką, dalsza rola („Świadek⇥Paweł") to inna osoba.
  rowSurname: Map<number, { sur: string; at: number }>;
}
interface FormMaskers {
  maskFor: (field: FormField, val: string) => string;
  maskCell: (field: FormField, val: string, label: string) => string;
}
function noteRowSurname(ctx: RedactCtx, rows: FormRows, first: number, units: string[]): void {
  if (!ctx.pseudonyms) return;
  const sur: { sur: string; at: number }[] = [];
  units.forEach((u, k) => {
    const m = RE_TAB_SURNAME_CELL.exec(u);
    if (m) sur.push({ sur: m[1], at: first + k });
  });
  if (sur.length !== 1) return;
  for (let k = 0; k < units.length; k++) rows.rowSurname.set(first + k, sur[0]);
}
// Czy pod wierszem stoi wiersz danych tabeli z tą samą liczbą komórek (wtedy wiersz to nagłówek)?
// Wiersz z etykietami na pozycjach parzystych („Oddział⇥Wewnętrzny⇥Sala⇥4") to dalszy formularz.
function tabRowBelow(srcLines: string[], li: number, n: number): boolean {
  let j = li + 1;
  while (j < srcLines.length && srcLines[j].trim() === '') j++;
  if (j >= srcLines.length) return false;
  const below = srcLines[j].split(/\t+/);
  return below.length === n && !below.some((c, k) => k % 2 === 0 && isTabLabelish(c));
}
// Wiersz z co najmniej dwiema komórkami „Etykieta: wartość" rozdzielonymi TAB-em to kilka pól. Każdą
// komórkę przetwarzamy jak osobny wiersz. Wiersz TSV z danymi („Nazwisko:⇥Gzowski⇥Kadry") ma jedną
// komórkę-etykietę i zostaje bez zmian.
function pushColonCellRow(ctx: RedactCtx, rows: FormRows, parts: string[], cells: string[]): boolean {
  const labelled = cells.filter(isTabFieldCell).length;
  if (labelled < 2 || !cells.every((c) => c.trim() === '' || isTabFieldCell(c))) return false;
  noteRowSurname(ctx, rows, rows.lines.length, cells);
  for (const c of cells) {
    rows.tabCell.add(rows.lines.length);
    rows.lines.push(c);
  }
  rows.groups.push({ n: cells.length, seps: parts.filter((_p, k) => k % 2 === 1) });
  return true;
}
// Etykieta i wartość w osobnych komórkach („Imię:⇥Adam⇥Nazwisko:⇥Nowak") to jedno pole. Przy
// etykiecie bez dwukropka cały wiersz musi na przemian składać się z etykiet i wartości, pod
// etykietą imienia musi stać imię („Imię⇥Szkoła⇥Nazwisko⇥Przedmiot" to nagłówek), a pod wierszem
// nie może stać wiersz danych o tej samej liczbie komórek.
function pushLabelValueRow(ctx: RedactCtx, rows: FormRows, srcLines: string[], li: number, parts: string[], cells: string[]): boolean {
  const roleAt = (k: number): boolean =>
    k % 2 === 0 && TAB_ROLE_LABELS.has(cells[k].trim().toLowerCase()) && k + 1 < cells.length && POLISH_FIRST_NAMES.has(cells[k + 1].trim().toLowerCase());
  const bareRow = cells.some((c, k) => RE_TAB_BARE_LABEL.test(c) || roleAt(k));
  const bareOk =
    !bareRow ||
    (cells.length % 2 === 0 &&
      cells.every((c, k) => (k % 2 === 0 ? isTabLabelish(c) : isTabValueCell(c))) &&
      cells.every((c, k) => k % 2 === 1 || !RE_TAB_FIRST_NAME_LABEL.test(c) || isFirstNameLike(cells[k + 1].trim().split(/[ ]+/)[0])) &&
      !tabRowBelow(srcLines, li, cells.length));
  if (!bareOk || (bareRow ? cells.filter((c, k) => k % 2 === 0 && isTabLabelish(c)).length : cells.filter(isTabLabelCell).length) < 2) return false;
  const seps = parts.filter((_p, k) => k % 2 === 1);
  const units: string[] = [];
  const unitSeps: string[] = [];
  const unitBare: number[] = [];
  let pairs = 0;
  let ok = true;
  for (let k = 0; k < cells.length && ok; k++) {
    const c = cells[k];
    if (k > 0) unitSeps.push(seps[k - 1]);
    const colonLabel = RE_TAB_EMPTY_COLON_LABEL.test(c) && RE_TAB_CELL_LABEL.test(c);
    const bareLbl = !colonLabel && (RE_TAB_BARE_LABEL.test(c) || (bareRow && k % 2 === 0 && isTabLabelish(c) && !isTabFieldCell(c)));
    if ((colonLabel || bareLbl) && k + 1 < cells.length && cells[k + 1].trim() !== '' && !isTabLabelCell(cells[k + 1])) {
      units.push(c + seps[k] + cells[k + 1]);
      unitBare.push(bareLbl ? c.length + seps[k].length : 0);
      pairs++;
      k++;
    } else if (c.trim() === '' || isTabLabelCell(c)) {
      units.push(c);
      unitBare.push(0);
    } else ok = false;
  }
  if (!ok || !pairs) return false;
  const first = rows.lines.length;
  for (let u = 0; u < units.length; u++) {
    rows.tabCell.add(rows.lines.length);
    if (unitBare[u]) rows.bareLabel.set(rows.lines.length, unitBare[u]);
    rows.lines.push(units[u]);
  }
  noteRowSurname(ctx, rows, first, units.map((u, k) => (unitBare[k] ? `${u.slice(0, unitBare[k]).trim()}: ${u.slice(unitBare[k])}` : u)));
  rows.groups.push({ n: units.length, seps: unitSeps });
  return true;
}
function splitFormRows(ctx: RedactCtx): FormRows {
  const rows: FormRows = {
    lines: [],
    groups: [],
    tabCell: new Set<number>(),
    bareLabel: new Map<number, number>(),
    rowSurname: new Map<number, { sur: string; at: number }>(),
  };
  const srcLines = ctx.text.split('\n');
  for (let li = 0; li < srcLines.length; li++) {
    const ln = srcLines[li];
    if (ln.includes('\t')) {
      const parts = ln.split(/(\t+)/);
      const cells = parts.filter((_p, k) => k % 2 === 0);
      if (pushColonCellRow(ctx, rows, parts, cells) || pushLabelValueRow(ctx, rows, srcLines, li, parts, cells)) continue;
    }
    rows.lines.push(ln);
    rows.groups.push({ n: 1, seps: [] });
  }
  return rows;
}
function formMaskers(ctx: RedactCtx): FormMaskers {
  // Wyrazy stojące samotnie po tytule („Pani Nguyen"), liczone raz, na żądanie.
  let titled: Set<string> | null = null;
  const titledSingles = (): Set<string> => {
    if (!titled) {
      titled = new Set<string>();
      for (const mm of ctx.text.matchAll(RE_TITLED_SINGLE)) titled.add(mm[1].toLowerCase());
    }
    return titled;
  };
  // Nierozpoznany klucz → drugi wyraz wartości, który przy nim stał (wykrycie kolizji w maskFor).
  const ambiguousKeys = new Map<string, string>();
  // Maska wartości: stała, a w trybie pseudonimów dla pól z nazwiskiem (surnameAt) etykieta osoby
  // kluczowana nazwiskiem, spójna z przebiegami osób.
  const maskFor = (field: FormField, val: string): string => {
    if (!field.surnameAt || !ctx.pseudonyms) return field.mask;
    const ws = val.trim().split(/[ \t]+/);
    let [sur, other] = field.surnameAt === 'first' ? [ws[0], ws[ws.length - 1]] : [ws[ws.length - 1], ws[0]];
    let ambiguous = false;
    if (ws.length > 1) {
      const fnS = isFirstNameLike(sur);
      const fnO = isFirstNameLike(other);
      // wartość wpisana w odwrotnym szyku niż etykieta („Imię i nazwisko:⏎WILK JADWIGA")
      if (fnS && !fnO) [sur, other] = [other, sur];
      else if (fnS === fnO) {
        // Nazwiskiem jest wyraz potwierdzony jako nazwisko, a gdy żaden, ten, który gdzie indziej stoi
        // sam po tytule („Pani Nguyen").
        const cS = isConfirmedSurname(sur);
        const cO = isConfirmedSurname(other);
        if (!cS && cO) [sur, other] = [other, sur];
        else if (!cS && !cO) {
          ambiguous = true;
          if (titledSingles().has(other.toLowerCase()) && !titledSingles().has(sur.toLowerCase())) [sur, other] = [other, sur];
        }
      }
    }
    // fragment przeniesienia („Mał-⏎gorzata") albo inicjał nie jest kluczem tożsamości
    if (!/^\p{L}{2,}(?:-\p{L}{2,})*$/u.test(sur)) return field.mask;
    if (ambiguous) {
      // Ten sam nierozpoznany klucz przy innym drugim wyrazie („Hans Schmidt", „Hans Becker") to dwie
      // osoby; kluczem drugiej jest cała wartość.
      const k = normalizeSurnameKey(sur);
      const o = other.toLowerCase();
      const seen = ambiguousKeys.get(k);
      if (seen !== undefined && seen !== o) return ctx.personMask(ws.join(' '));
      ambiguousKeys.set(k, o);
    }
    return ctx.personMask(sur);
  };
  // Pole z nazwiskiem w komórce TAB albo w spłaszczonym wierszu adresu: w trybie pseudonimów etykieta
  // osoby kluczowana nazwiskiem, żeby „Nazwisko: Kowalski" i „Pan Jan Kowalski" w prozie dały tę samą osobę.
  const maskCell = (field: FormField, val: string, label: string): string => {
    const single = val.trim().split(/[ \t]+/).length < 2;
    if (field.kind !== 'name' || field.surnameAt || !ctx.pseudonyms || !/nazwisk/i.test(label) || (single && !/^nazwisk/i.test(label)))
      return maskFor(field, val);
    return maskFor({ ...field, surnameAt: /^nazwisko/i.test(label) ? 'first' : 'last' }, val);
  };
  return { maskFor, maskCell };
}
// Rola osoby w komórce wiersza z TAB-ami („Świadek:⇥Jan⇥Nazwisko:⇥Kowalski"): samo imię ze słownika
// albo para imion jako cała wartość to osoba. Proza i zwykły wiersz „Świadek: Jan" bez zmian.
function maskRoleNameCell(ctx: RedactCtx, rows: FormRows, i: number, bare: string): void {
  const { lines } = rows;
  const rv = RE_TAB_ROLE_NAME_CELL.exec(bare);
  const ws = rv ? rv[2].split(/[ ]+/).map((w) => w.toLowerCase()) : [];
  if (rv && TAB_ROLE_LABELS.has(rv[1].trim().toLowerCase()) && ws.every((w) => POLISH_FIRST_NAMES.has(w) && !NOUN_LIKE_FIRST_NAMES.has(w))) {
    const rs = rows.rowSurname.get(i);
    const rowSur = ws.length === 1 && rs && rs.at === i + 1 ? rs.sur : undefined;
    const pair = ws.length === 2 && ctx.pseudonyms ? rv[2].split(/[ ]+/)[1] : undefined;
    lines[i] = lines[i].replace(new RegExp(`${escapeRe(rv[2])}(?=[ \\t]*$)`), () =>
      rowSur ? ctx.personMask(rowSur) : pair ? ctx.personMask(pair) : ctx.M.IMIE,
    );
    ctx.bump('IMIE');
  }
}
// Wartość w tej samej linii co etykieta („Nazwisko: X").
function maskSameLineValue(
  ctx: RedactCtx,
  rows: FormRows,
  masks: FormMaskers,
  i: number,
  field: FormField,
  label: string,
  colonVal: string,
): void {
  const { lines, tabCell, rowSurname } = rows;
  // lista imion: każde imię dostaje maskę
  const list = field.nameList ? RE_NAME_LIST_PAIR.exec(colonVal.trim()) : null;
  if (list && isFirstNameLike(list[1]) && isFirstNameLike(list[3])) {
    const at = lines[i].lastIndexOf(list[0]);
    lines[i] = `${lines[i].slice(0, at)}${field.mask}${list[2]}${field.mask}${lines[i].slice(at + list[0].length)}`;
    ctx.bump(field.type);
    ctx.bump(field.type);
    return;
  }
  // pod tą etykietą tylko imiona, dopisek („zgodnie z aktem urodzenia") zostaje
  if (field.nameList && !isFirstNameLike(colonVal.trim())) return;
  // Data w tej samej linii ma swój detektor (passBirthDate).
  if (field.kind === 'date') return;
  const val = colonVal.trim();
  // Formularz spłaszczony do wiersza („Ulica: Krótka Nr domu: 7 Miejscowość: Mysiadło"): wartość
  // pola adresowego kończy się przed etykietą następnego pola.
  if (field.kind === 'addr') {
    const flat = maskFlatFormFields(ctx, field, val, RE_FLAT_FORM_NUMBERED.test(lines[i]), masks.maskCell);
    if (flat !== null) {
      const at = lines[i].lastIndexOf(val);
      lines[i] = `${lines[i].slice(0, at)}${flat}${lines[i].slice(at + val.length)}`;
      return;
    }
  }
  if (!isValidFormValue(val, field.kind)) return;
  if (field.gated) {
    const g = gatedPersonValue(val, false, !!field.surnameOnly);
    if (!g) return;
    const at = lines[i].lastIndexOf(val);
    const mask = masks.maskFor(field, g.core);
    lines[i] = `${lines[i].slice(0, at)}${g.lead}${mask}${g.tail}${lines[i].slice(at + val.length).replace(/^[^\S\r]+/, '')}`;
    ctx.bump(field.type);
    return;
  }
  // Końcowe „\r" (tekst z CRLF dzielimy po „\n") zostaje, inaczej plik wychodziłby z mieszanymi
  // końcami linii.
  const rowSur = tabCell.has(i) ? rowSurname.get(i)?.sur : undefined;
  const mask =
    rowSur && RE_OWN_FIRST_NAME_LABEL.test(label) && /^\p{Lu}\p{Ll}+$/u.test(val)
      ? ctx.personMask(rowSur)
      : tabCell.has(i)
        ? masks.maskCell(field, val, label)
        : masks.maskFor(field, val);
  lines[i] = lines[i].replace(new RegExp(`${escapeRe(val)}[^\\S\\r]*(?=\\s*$)`), () => mask);
  ctx.bump(field.type);
}
// Wartość w następnej niepustej linii („Nazwisko⏎WILCZYŃSKI"), z pominięciem podpowiedzi w nawiasach.
function maskNextLineValue(ctx: RedactCtx, rows: FormRows, masks: FormMaskers, i: number, field: FormField): void {
  const { lines, tabCell } = rows;
  let j = i + 1;
  while (j < lines.length && (lines[j].trim() === '' || /^\(.*\)$/.test(lines[j].trim()))) j++;
  if (j >= lines.length || isFormLabelLine(lines[j])) return;
  // pusta komórka-etykieta w wierszu z TAB-ami: następna komórka to inne pole, nie wartość
  if (tabCell.has(i) && tabCell.has(j)) return;
  // Pod ostatnią komórką-etykietą nagłówka („Nazwisko:⇥Miejscowość:⏎Kowalski⇥Radom") wiersz z TAB-em
  // to cały wiersz danych tabeli, nie wartość tej jednej etykiety.
  if (tabCell.has(i) && lines[j].includes('\t')) return;
  const val = lines[j].trim();
  if (!isValidFormValue(val, field.kind)) return;
  if (field.nameList && !isFirstNameLike(val)) return;
  if (field.kind === 'date') {
    // sama data, adnotacja zostaje („1990-01-01 (wg aktu)")
    if (RE_DATE_VALUE.test(lines[j])) {
      lines[j] = lines[j].replace(RE_DATE_VALUE, field.mask);
      ctx.bump(field.type);
    }
    return;
  }
  let lead = '';
  let core = val;
  let tail = '';
  if (field.gated) {
    const g = gatedPersonValue(val, true);
    if (!g) return;
    ({ lead, core, tail } = g);
  }
  const mask = masks.maskFor(field, core);
  lines[j] = lines[j].replace(/^(\s*)[\s\S]*?(\s*)$/, (_m, a: string, b: string) => `${a}${lead}${mask}${tail}${b}`);
  ctx.bump(field.type);
}
function maskFormLine(ctx: RedactCtx, rows: FormRows, masks: FormMaskers, i: number): void {
  const { lines } = rows;
  // komórka „etykieta bez dwukropka⇥wartość" czytana jak „etykieta: wartość"
  const bareAt = rows.bareLabel.get(i);
  const bare = bareAt ? `${lines[i].slice(0, bareAt).trim()}: ${lines[i].slice(bareAt)}` : stripFormPrefix(lines[i]);
  const label = formLabelOf(bare);
  const field = FORM_FIELDS.find((f) => f.re.test(label));
  if (!field && rows.tabCell.has(i) && ctx.on('IMIE')) {
    maskRoleNameCell(ctx, rows, i, bare);
    return;
  }
  if (!field || !ctx.on(field.type)) return;
  const colon = bare.match(/:\s*(.+)$/);
  if (colon) maskSameLineValue(ctx, rows, masks, i, field, label, colon[1]);
  else maskNextLineValue(ctx, rows, masks, i, field);
}
function joinFormRows(rows: FormRows): string {
  const out: string[] = [];
  let at = 0;
  for (const g of rows.groups) {
    let row = rows.lines[at];
    for (let k = 1; k < g.n; k++) row += g.seps[k - 1] + rows.lines[at + k];
    out.push(row);
    at += g.n;
  }
  return out.join('\n');
}
// Pola formularza to kotwica strukturalna: wartość w tej samej linii („Nazwisko: X") albo w następnej
// („Nazwisko⏎WILCZYŃSKI"), także wersalikami. Każde pole sprawdza własny typ przez ctx.on.
export function passFormFields(ctx: RedactCtx): void {
  const rows = splitFormRows(ctx);
  const masks = formMaskers(ctx);
  for (let i = 0; i < rows.lines.length; i++) maskFormLine(ctx, rows, masks, i);
  ctx.text = joinFormRows(rows);
}

// Kategoria pod kluczem „osoba"/„person" („<osoba>Prawna</osoba>"), nie osoba.
export const PERSON_CATEGORY_VALUES = new Set<string>(
  'osoba prawna prawne fizyczna fizyczne kontaktowa kontaktowe upoważniona upoważnione zainteresowana trzecia legal natural physical juridical person'.split(' '),
);
// Jeden wyraz pod „osoba"/„person", który jest rolą, kategorią albo odpowiedzią („Klient", „Tak").
// Uzupełnia ROLE_WORDS, GENERIC_LOGINS i PERSON_CATEGORY_VALUES; każdy inny wyraz pod tym kluczem to osoba.
const PERSON_ROLE_VALUES = new Set<string>(
  (
    'tak nie inna inny inne anonim anonimowa anonimowy anonymous dorosła dorosły pełnoletnia pełnoletni ' +
    'niepełnoletnia niepełnoletni małoletnia małoletni dziecko opiekun opiekunka rodzic zgłaszający ' +
    'zgłaszająca główna główny dodatkowa dodatkowy pierwsza druga kontakt użytkownik użytkowniczka ' +
    'gość klientka pracownica wnioskodawczyni petent petentka interesant interesantka adresat nadawca ' +
    'odbiorca kierownik kierowniczka specjalista specjalistka konsultant konsultantka agent operator ' +
    'matka ojciec syn córka brat siostra mąż żona partner partnerka babcia dziadek wnuczka ' +
    'customer client user employee manager owner contact guest member admin'
  ).split(/\s+/),
);
export const isPersonRoleValue = (w: string): boolean =>
  PERSON_CATEGORY_VALUES.has(w) ||
  PERSON_ROLE_VALUES.has(w) ||
  ROLE_WORDS.has(w) ||
  GENERIC_LOGINS.has(w) ||
  TITLE_WORDS.has(w) ||
  LEGAL_ENTITY_WORDS.has(w) ||
  FORM_LABEL_WORDS.has(w);
// Tytuł albo inicjał przed nazwiskiem w wartości pola („dr Gzik", „j. kowalski") nie odbiera jej
// charakteru imienia i nazwiska, jak partykuła „van".
export const RE_VALUE_TITLE_OR_INITIAL =
  /^(?:\p{L}\.|dr|dra|dr\.|mgr|mgr\.|inż\.?|prof\.?|lek\.?|med\.?|hab\.?|doc\.?|mec\.?|adw\.?|ks\.?|n\.|pan|pani|sz\.p\.)$/iu;
// Imiona-rzeczowniki, które po przymiotniku tworzą typową nazwę („Olimpijska Nadzieja"). Inne imię
// w szyku „Przymiotnik Imię" na liście („Mazowiecka Maja") to osoba w szyku „Nazwisko Imię".
export const NOUN_LIKE_NAMES_IN_TITLES = new Set<string>(['nadzieja', 'róża', 'kalina']);
// Partykuły nazwisk („Jan van Dijk", „de la Cruz"), ani imię, ani nazwisko.
export const SURNAME_PARTICLES = new Set<string>('van von de del della der den di da du dos das la le ter ten'.split(' '));
// Końcówki przymiotnika, imiesłowu, dopełniacza i zdrobnienia („koralowa", „pustyni"), częste w nazwie
// produktu. Po zwykłym imieniu wersja łagodna bez „-ka/-ko/-na", bo to częste nazwiska („jan sitko").
const RE_LOWER_NOT_SURNAME_LENIENT = /(?:ąc[aey]|yni|ii|ej|ego|ow[aey])$/;
export const RE_LOWER_NOT_SURNAME = /(?:ow[aey]|n[aey]|ąc[aey]|yni|ii|ej|ego|k[aio])$/;
/**
 * Czy wartość małymi literami pod generycznym „name"/„osoba" to osoba („anna gzik", „nowak anna")?
 * Proza łapie tylko nazwiska ze słownika. Nazwa produktu („róża pustyni", „kalina koralowa") i kategoria
 * („prawna") zostają: imię-rzeczownik bez potwierdzonego nazwiska albo drugi wyraz o końcówce przymiotnika.
 */
export function lowercaseNameLooksLikePerson(words: string[]): boolean {
  // inicjał i tytuł przed nazwiskiem („j. kowalski", „dr kowalski") pomijamy jak partykułę
  const lower = words.map((w) => w.toLowerCase()).filter((w) => !SURNAME_PARTICLES.has(w));
  const ws = lower.filter((w) => !RE_VALUE_TITLE_OR_INITIAL.test(w));
  if (!ws.length) return false;
  const confirmed = (w: string): boolean => surnameShaped(w) || HOMOGRAPH_SURNAMES.has(w);
  const plausible = (w: string): boolean => confirmed(w) || POLISH_FIRST_NAMES.has(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME.test(w));
  const [first] = ws;
  const last = ws[ws.length - 1];
  // Jeden wyraz: nazwisko ze słownika albo morfologii, albo imię; sam homograf („kalina", „sowa") to raczej
  // nazwa. Po inicjale albo tytule każdy wyraz o kształcie nazwiska, bo inicjał to kotwica osoby.
  if (ws.length === 1) {
    if (ws.length < lower.length && plausible(first) && !isPersonRoleValue(first)) return true;
    return surnameShaped(first) || (POLISH_FIRST_NAMES.has(first) && !NOUN_LIKE_FIRST_NAMES.has(first));
  }
  const rest = ws.slice(1);
  if (POLISH_FIRST_NAMES.has(first)) {
    if (rest.every((w) => confirmed(w) || POLISH_FIRST_NAMES.has(w))) return true;
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && rest.every((w) => plausible(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME_LENIENT.test(w)))) return true;
    // Imię-rzeczownik z nazwiskiem spoza słownika („maja gzik"). Nazwa produktu ma drugi człon
    // przymiotnikowy albo w dopełniaczu („pola lawendy"), którego ten warunek nie przepuści.
    if (rest.every((w) => plausible(w) && !/(?:[iyu]|ów)$/.test(w))) return true;
    // imię z dopiskiem działu czy miejsca („kasia z księgowości")
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && /^(?:z|ze|od|do|u)$/.test(rest[0])) return true;
  }
  // szyk odwrócony („nowak anna") tylko z potwierdzonym nazwiskiem, bo „pasta barbara" to produkt
  return POLISH_FIRST_NAMES.has(last) && !NOUN_LIKE_FIRST_NAMES.has(last) && ws.slice(0, -1).every(confirmed);
}
