import { HOMOGRAPH_SURNAMES, looksLikeSurname, normalizeSurnameKey, surnameBase } from '../surnames.js';
import { escapeRe } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { FORM_FIELDS, FORM_LABEL_WORDS, type FormField, formLabelOf, GENERIC_LOGINS, isFormLabelLine, isValidFormValue, RE_DATE_VALUE, RE_PROPER_WORDS, stripFormPrefix, TAB_ROLE_LABELS } from '../dict/forms.js';
import { isFirstNameLike, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';


export const isConfirmedSurname = (w: string): boolean =>
  !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w));
// Wyraz z wielkiej litery samotnie po tytule („Pani Nguyen zgłosiła się", „Pan Gruber") — w polu
// z nierozpoznanym imieniem i nazwiskiem wskazuje, który wyraz jest nazwiskiem.
const RE_TITLED_SINGLE = /(?<!\p{L})(?:Pan(?:i|a|u|ią|em|ie)?|dr|prof|mgr)\.?[ \t]+(\p{Lu}[\p{Ll}'’-]+)(?![\p{L}'’-])(?![ \t]+\p{Lu})/gu;
// Wpis zastępczy w polu osoby: nieznany z nazwiska pacjent albo zmarły („NN", „N.N."), „nieustalone",
// „jak wyżej", „Do uzupełnienia".
const RE_FORM_PERSON_PLACEHOLDER = /^(?:n\.?[ \t]?n\.?|x+|nieustal\p{L}*|do[ \t]+uzupełnienia|jak[ \t]+wyżej|j\.[ \t]?w\.?)$/iu;
// Pierwszy wyraz wartości, który robi z niej komórkę urzędu, a nie osobę (uzupełnia LEGAL_ENTITY_WORDS
// i ROLE_WORDS: „Dział Kadr", „Sekretariat", „Dom Dziecka").
const FORM_NOT_PERSON_HEAD = new Set<string>('dział działu sekretariat kadry dom biuro'.split(' '));
// Zapis bez ogonków („Wojt Gminy", „Kierownik Dzialu") — etykiety bywają z systemów bez polskich znaków.
const foldPl = (s: string): string => s.replace(/[ąćęłńóśźż]/g, (c) => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]);
const FORM_NOT_PERSON_HEAD_FOLDED = new Set<string>([...LEGAL_ENTITY_WORDS, ...ROLE_WORDS, ...FORM_NOT_PERSON_HEAD].map(foldPl));
// Wyrazy, które NA DOWOLNEJ POZYCJI wartości robią z niej instytucję, komórkę albo rolę: instytucja
// zaczyna się zwykle od przymiotnika („Powiatowe Centrum Pomocy Rodzinie", „Gminny Ośrodek Pomocy
// Społecznej", „Ochotnicza Straż Pożarna"), a w rejestrze wniosków wnioskodawcą bywa redakcja,
// wspólnota czy spółka („Gazeta Wyborcza", „Wspólnota Mieszkaniowa Lipowa", „Tauron Dystrybucja").
// Bez homografów nazwisk („Sołtys", „Nowa", „Polski") — te rozstrzyga tylko pierwszy wyraz.
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
    .map(foldPl),
);
// Przymiotnik w kształcie nazwy instytucji („Mieszkaniowa", „Wyborcza", „Gminny", „Społecznej")
// — liczy się tylko wtedy, gdy w wartości nie ma imienia ani nazwiska ze słownika. Ostatni wyraz
// na „-owa/-ewa" to nazwisko: tak kończą się nazwiska wschodniosłowiańskie i środkowoazjatyckie
// („Oksana Petrowa", „Gulnara Iwanowa", „Olena Kuzniecowa", „Dilnoza Karimowa"), a instytucję
// z takim przymiotnikiem po rzeczowniku („Wspólnota Mieszkaniowa") rozstrzyga sam rzeczownik.
// Spółgłoska przed „-na/-ne/-ny" („Pożarna", „Gminny"), bo imię obce w tym kształcie („Svitlana",
// „Oksana") ma przed nią samogłoskę.
const RE_FORM_INSTITUTION_ADJ = /(?:ow[aey]|owej|owego|[^aeiouyąęó]n[aey]|nej|nego|cz[aey]|czej|ych)$/u;
// Otczestwo (imię odojcowskie) w środku wartości („Karimovna", „Iwanowna", „Petrowicz").
const RE_PATRONYMIC = /(?:ovna|owna|evna|ewna|ivna|iwna|ovich|owicz|evich|ewicz)$/i;
// Homograf wyrazu instytucji jako nazwisko za imieniem spoza słownika („Jisoo Park", „Bożydar Rada").
const FORM_HOMOGRAPH_SURNAME_TAIL = new Set<string>(['park', 'rada', 'bank', 'koło']);
// Imię koreańskie w zapisie łacińskim: jedna albo dwie sylaby (nagłos, samogłoska, wygłos n/m/ng/k/l/p/t;
// „Jisoo", „Minho", „Seo-yeon", „Hyun"). Wyraz firmy albo obiektu („Aqua", „Energy", „Business",
// „Techno", „Silesia") tego kształtu nie ma.
const RE_KOREAN_GIVEN_NAME =
  /^(?:(?:kk|tt|pp|ss|jj|ch|[gkndtrlmbpsjh])?(?:yeo|yae|wae|eo|ae|ya|ye|yo|yu|wa|wo|we|wi|oe|eu|ui|oo|ee|[aeiou])(?:ng|[nmklpt])?-?){1,2}$/i;
// Słowiańskie imię złożone spoza słownika przed homografem „Rada/Bank/Koło" („Bożydar Rada").
const RE_SLAVIC_COMPOUND_GIVEN = /(?:mir|mira|sław|sława|dar|gniew|bor|wit|mił|miła|wój|woja|rad|rada)$/i;
// Imię chińskie albo wietnamskie w szyku paszportowym („WANG Xiaoming", „Thi Lan HO", „DOAN Van
// Hung"): sylaby z nagłosem pinyin albo wietnamskim i wygłosem n/ng/nh/m/c/ch/p/t. Nazwa firmy za
// skrótem („BNP Paribas", „ERGO Hestia", „DHL Parcel", „AXA Ubezpieczenia", „Hotel ABC") odpada.
const RE_EAST_ASIAN_GIVEN_NAME =
  /^(?:(?:zh|ch|sh|th|tr|ng|nh|ph|kh|gi|qu|[bcdfghjklmnpqrstvwxyz])?[aeiouy]{1,3}(?:ng|nh|ch|[nmcpt])?){1,3}$/i;
// Akronimy instytucji, które w wartości pola osoby oznaczają podmiot („PGE …", „BGK Nieruchomości").
const FORM_INSTITUTION_ACRONYMS = new Set<string>(
  (
    'PGE ZUS KRUS PKO PZU NFZ GOPS MOPS MOPR PCPR OPS ZOZ PKP PKS UM UG US PUP WUP KRS GUS NBP BGK BIK ' +
    'PIP SKO WSA NSA SN TK RIO KIO UZP OSP ZHP PCK PZM ZDW ZDP ZDM MPK PWiK ZGK ZUK ZOL DPS ŚDS CUS ' +
    'CAS KOWR IPN UKS GKS MKS LKS AZS PKN PAP LOT PLL ENEA TVP'
  ).split(' '),
);
// Imię dwuczłonowe z łącznikiem w transkrypcji koreańskiej i wietnamskiej („Min-jun", „Seo-yeon").
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
// Imiesłów i rzeczownik odczasownikowy („Prowadzący", „Przyjęcia", „Urodzenia", „Zatrudnienie").
const RE_NEXT_LINE_HEADER_MORPH = /(?:ący|ąca|ące|[eęa]nia|ęcia|enie|anie|ości|ość)$/u;
const nextLineHeaderWord = (w: string): boolean =>
  NEXT_LINE_HEADER_WORDS.has(foldPl(w)) || RE_NEXT_LINE_HEADER_MORPH.test(w) || RE_FORM_INSTITUTION_ADJ.test(w);
// Forma prawna w wartości („PGE Dystrybucja S.A.", „Trans Sp. z o.o.", „Bud S.C.").
const RE_FORM_LEGAL_FORM = /(?:^|[ \t])(?:S\.?A|SA|Sp|sp|S\.?C|Sp\.?[ \t]?[jkJK])\.?(?=[ \t]|$)/u;
/**
 * Bramka wartości dla etykiet spoza dawnego zestawu (FormField.gated): dopełnienie („Imię
 * i nazwisko pacjenta:"), zapis bez ogonków, szyk ZUS. Dawniej te etykiety nie były kotwicą, więc
 * wartość, która nie wygląda na osobę, zostaje jawna: instytucja albo rola („Gmina Michałowice",
 * „Prezes Zarządu", „Powiatowe Centrum Pomocy Rodzinie", „Matka"), skrót i forma prawna („PGE
 * Dystrybucja S.A.", „ZUS Oddział Siedlce"), wpis zastępczy („NN", „nieustalone") i pouczenie małą
 * literą („wpisać drukowanymi literami"). Instytucja albo rola przed imieniem zostaje poza maską
 * („Kancelaria Piotr Zając" → „Kancelaria [..]"), tak samo tytuł małą literą („adw. Piotr Zając")
 * i interpunkcja na końcu („Jan Kowalski."). Wartość z następnej linii (tabela z PDF, komórka pod
 * komórką: „Imię i nazwisko ucznia⏎Podpis Rodzica", „…⏎Grupa Wiekowa") musi mieć imię albo
 * nazwisko ze słownika — kolejny nagłówek kolumny też jest dwoma wyrazami z wielkiej litery.
 * Zwraca części wartości albo null.
 */
function gatedPersonValue(
  val: string,
  nextLine: boolean,
  surnameOnly = false,
): { lead: string; core: string; tail: string } | null {
  let lead = '';
  let core = val;
  for (let m = /^(\S+)[ \t]+/.exec(core); m && /^\p{Ll}/u.test(m[1]) && RE_VALUE_TITLE_OR_INITIAL.test(m[1]); m = /^(\S+)[ \t]+/.exec(core)) {
    lead += m[0];
    core = core.slice(m[0].length);
  }
  const tail = /[.,;]+$/.exec(core)?.[0] ?? '';
  core = core.slice(0, core.length - tail.length);
  if (!core || RE_FORM_PERSON_PLACEHOLDER.test(core)) return null;
  let ws = core.split(/[ \t]+/);
  if (FORM_NOT_PERSON_HEAD_FOLDED.has(foldPl(ws[0].toLowerCase()))) {
    const fi = ws.findIndex(isFirstNameLike);
    if (fi < 1) return null;
    // Samo imię za rolą to szyk „Nazwisko Imię" z nazwiskiem-homografem („Marszałek Anna") — całość
    // jest osobą. Imię z nazwiskiem za nią to osoba po nazwie instytucji albo roli.
    if (ws.length - fi >= 2) {
      const parts = core.split(/([ \t]+)/);
      lead += parts.slice(0, 2 * fi).join('');
      core = parts.slice(2 * fi).join('');
      ws = ws.slice(fi);
    }
  }
  const notPerson = (w: string): boolean =>
    w
      .toLowerCase()
      .split('-')
      .some((p) => FORM_NOT_PERSON_ANY.has(foldPl(p)) || (LEGAL_ENTITY_WORDS.has(p) && !isConfirmedSurname(w)));
  // Nazwisko-homograf wyrazu instytucji na końcu, za samym imieniem („Anna Koło", „Jan Nowy",
  // „Adam Bank", koreańskie „Min-jun Park", „SEO-YEON PARK"): imię przed nim rozstrzyga osobę.
  // Wyrazy z FORM_NOT_PERSON_ANY („Ośrodek", „Gmina") odrzucają dalej, bo nie bywają nazwiskami.
  const homographSurnameAt = (w: string, i: number): boolean =>
    i === ws.length - 1 &&
    i > 0 &&
    i <= 2 &&
    !w.split('-').some((p) => FORM_NOT_PERSON_ANY.has(foldPl(p.toLowerCase()))) &&
    (ws.slice(0, i).every((g) => isFirstNameLike(g) || RE_HYPHEN_GIVEN_NAME.test(g)) ||
      // imię spoza słownika przed homografem („Jisoo Park", „Minho Park", „Bożydar Rada"): dwa
      // wyrazy, pierwszy w kształcie imienia — nie przymiotnik ani wyraz instytucji („Wodny Park",
      // „Miejska Rada", „Aqua Park" pod etykietą osoby się nie zdarza)
      // Imię musi mieć przy tym kształt imienia: koreańskie sylaby przed „Park" („Jisoo", „Minho"),
      // słowiański złożony przed „Rada/Bank/Koło" („Bożydar", „Świętomira") — nazwa firmy albo
      // obiektu („Aqua Park", „Business Park", „Alior Bank", „Santander Bank") go nie ma.
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
    // Wartość z następnej linii bez słownika: obce imię i nazwisko („Yuki Tanaka", „Amir Rahimov",
    // „Thanh Hoa Tran") wygląda tak samo jak nagłówek kolumny, więc odsiewamy nagłówek po jego
    // słownictwie i polskiej morfologii („Podpis Rodzica", „Godzina Przyjęcia", „Lekarz Prowadzący",
    // „Grupa Wiekowa"). Pojedynczy wyraz („Klasa") dalej wymaga słownika.
    if (nextLine && (ws.length < 2 || ws.some((w) => nextLineHeaderWord(w.toLowerCase())))) return null;
    // Przymiotnik albo imiesłów w rodzaju nijakim pod etykietą samego nazwiska („Nazwisko dziecka:
    // Wspólne", „Nazwisko małżonka: Dotychczasowe", „Nazwisko pacjenta: Utajnione", „… Ojcowskie")
    // to wypełniacz formularza USC czy placówki, nie nazwisko.
    if (surnameOnly && ws.length === 1 && /^\p{Lu}\p{Ll}+(?:ne|owe|ewe|kie|gie|cie|te|łe)$/u.test(ws[0])) return null;
    // bez imienia i nazwiska ze słownika: skrót WERSALIKAMI w wartości pisanej zwykle („PGE …",
    // „ZUS …") albo przymiotnik instytucji („Wspólnota Mieszkaniowa") to nie osoba
    // — ale nie szyk paszportowy z nazwiskiem WERSALIKAMI na początku albo końcu („WANG Xiaoming",
    // „Thi Lan HO", „DOAN Van Hung"), gdy skrót nie jest znanym akronimem instytucji
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
    // Przymiotnik instytucji. Wyjątki: nazwisko na „-owa/-ewa/-ova" na końcu, otczestwo w środku
    // („Nodira Karimovna Yusupova", „Gulnara Iwanowna Sadykowa") i sam wyraz pod etykietą samego
    // nazwiska („Nazwisko pacjenta: Iwanowa", „Nazwisko ucznia: Wieczna") — tam to zawsze nazwisko.
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

// 1b) POLA FORMULARZA — etykieta w linii, wartość w tej samej („Nazwisko: X") lub NASTĘPNEJ
// („Nazwisko\nWILCZYŃSKI"). Kotwica strukturalna o wysokiej precyzji; łapie też WERSALIKI.
// Blok BEZ pojedynczej bramki `on()` — każde pole sprawdza własny typ.
// Etykieta następnego pola w wartości tej samej linii: wyraz z wielkiej litery, do dwóch dalszych
// wyrazów i dwukropek („ PESEL:", „ Data:", „ Gmina:", „ Nr lokalu:").
const RE_NEXT_FIELD_LABEL = /[ \t]+\p{Lu}[\p{L}.]*(?:[ \t]+\p{L}+\.?){0,2}[ \t]*:/u;
// Numer pozycji formularza przed etykietą („04. Ulica: Warszawska  05. Nr domu: 31") należy do
// etykiety — ale tylko w formularzu numerowanym, czyli gdy wiersz zaczyna się od takiego numeru.
// Bez niego „Ulica: Krótka 7. Piętro: 2" ma numer domu z kropką końca pola, nie numer pozycji.
const RE_FLAT_FIELD_NO_END = /(?:^|[ \t]+)\d{1,2}[.)]$/;
const RE_FLAT_FORM_NUMBERED = /^[ \t]*\d{1,2}[.)][ \t]/;
// Wyraz otwierający etykietę wielowyrazową („Nr domu:", „Kod pocztowy:", „Data urodzenia:") — przed
// nim stoi jeszcze wartość poprzedniego pola, nie etykieta. Także rzeczowniki z etykiet kadrowych
// i finansowych pisanych Wielkimi Literami w każdym wyrazie („Telefon Komórkowy:", „Wymiar Etatu:",
// „Wynagrodzenie Brutto:", „Osoba Do Kontaktu:", „Dowód Osobisty:", „Okres Zatrudnienia:").
const RE_FLAT_LABEL_OPENER =
  /^(?:nr|numer|kod|data|adres|miejsce|imię|imie|nazwisko|telefon|tel|wymiar|wynagrodzenie|wykształcenie|osoba|do|obywatelstwo|dowód|okres|kwota|stan|stopień|rodzaj|seria|stanowisko|wysokość|forma)\.?$/i;
/**
 * Etykieta następnego pola zaczyna się od OSTATNIEGO wyrazu z wielkiej litery przed dwukropkiem:
 * w „Długa 5 Kraków Tel:" etykietą jest „Tel:", a „Kraków" należy jeszcze do wartości (dawniej
 * miejscowość wypadała z maski adresu). Dalsze człony etykiety piszemy małą literą („Nr domu:").
 */
function flatNextLabel(rest: string): { index: number; text: string } | null {
  const nx = RE_NEXT_FIELD_LABEL.exec(rest);
  if (!nx) return null;
  const parts = nx[0].split(/([ \t]+)/);
  // parts: ['', odstęp, wyraz, odstęp, wyraz, …] — wyrazy na pozycjach parzystych od 2
  let i = parts.length - 1;
  while (i > 2 && !/^\p{Lu}/u.test(parts[i])) i -= 2;
  while (i > 2 && RE_FLAT_LABEL_OPENER.test(parts[i - 2])) i -= 2;
  if (i <= 2) return { index: nx.index, text: nx[0] };
  const skip = parts.slice(0, i - 1).join('').length;
  return { index: nx.index + skip, text: nx[0].slice(skip) };
}
/**
 * Wartość pola adresowego z kolejnymi polami w tym samym wierszu: każda wartość dostaje maskę swojego
 * pola (gdy etykieta jest znanym polem formularza), a etykiety i pola spoza listy („PESEL:", „Data:",
 * „Telefon:") zostają dla dalszych przebiegów. Null, gdy w wartości nie ma kolejnej etykiety.
 */
// Pola rozpoznawane tylko jako KOLEJNE pole spłaszczonego wiersza adresu („Ulica: Długa 5 M.: 3",
// „… Lokal: 5", „… Miasto: Warszawa"). Samodzielne „Lokal: 5" czy „Miasto: Kraków – Urząd Miasta"
// nie są kotwicą (nagłówki urzędów, opis lokalu), więc tych etykiet nie ma w FORM_FIELDS.
// Numer lokalu tylko liczbowy („M.:" bywa też skrótem miasta). „Piętro:" i „Gmina:" zostają jawne.
const FLAT_ONLY_FIELDS: FormField[] = [
  { re: /^(?:m|lok|lokal|mieszk|mieszkanie)\.?$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:miasto|poczta)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
];
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
    // Przecinek albo średnik przed etykietą następnego pola („Ulica: Lipowa, Nr domu: 3, Nr lokalu:
    // brak") rozdziela pola, nie należy do wartości: maska zjadała go tylko przy zamaskowanych polach.
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
// Komórka „Etykieta: wartość" w wierszu formularza rozdzielonym TAB-em („Imię: Jan⇥Nazwisko: Kowal").
// Kropka skrótu w etykiecie („Data ur.:", „Miejsce ur.:", „Nr tel.:") — inaczej komórka nie była
// ani etykietą, ani wartością, wiersz zostawał bez podziału i imię przed nią wyciekało.
const RE_TAB_CELL_LABEL = /^[ ]*(?:\d{1,2}[.)][ ]*)?\p{L}(?:[\p{L} ()]|\.(?=[ ]*[\p{L}:])){0,40}:/u;
// Etykieta pola bez dwukropka w osobnej komórce („Imię⇥Adam⇥Nazwisko⇥Nowak", „Imię:⇥Jan⇥Data ur.⇥
// 03.04.1980") — ZAMKNIĘTA lista etykiet osobowych i identyfikatorów. Inaczej wiersz nie dzielił się
// na pola, a imię obok zamaskowanego nazwiska zostawało jawne (dawniej osoba zjadała etykietę).
const RE_TAB_BARE_LABEL =
  /^[ ]*(?:(?:pierwsze[ ]+|drugie[ ]+)?imi[eę](?:[ ]+(?:ojca|matki))?|imiona|nazwisko(?:[ ]+(?:rodowe|panie[nń]skie))?(?:[ ]+matki)?|imi[eę][ ]+i[ ]+nazwisko|nazwisko[ ]+i[ ]+imi[eę]|data[ ]+ur(?:\.|odzenia)|miejsce[ ]+ur(?:\.|odzenia)|pesel|nip|tel(?:\.|efon)|nr[ ]+tel(?:\.|efonu)|e-?mail|adres|ulica|miejscowo[sś][cć]|kod[ ]+pocztowy|nr[ ]+dowodu|płeć|obywatelstwo)[ ]*$/iu;
// Komórka „etykieta wartość" bez dwukropka („Data ur. 03.04.1980", „PESEL 44051401359", „Tel. 600…")
// to osobne pole — tylko etykiety identyfikatorów, nie osobowe („Imię Jan" bywa nagłówkiem prozy).
// Nazwy kolumn, które w nagłówku tabeli stoją za etykietą osobową („Nazwisko⇥Imię⇥Stanowisko").
const TAB_HEADER_WORDS = new Set<string>([
  ...FORM_LABEL_WORDS,
  ...'wiek miasto lokal dział stanowisko uwagi status lp funkcja rola klasa grupa oddział stopień ocena wynik kwota termin podpis'.split(' '),
]);
const RE_TAB_LABEL_VALUE =/^[ ]*(?:data[ ]+ur(?:\.|odzenia)|pesel|nip|tel(?:\.|efon)|nr[ ]+tel(?:\.|efonu)?)[ ]+[\p{L}\d]/iu;
export function passFormFields(ctx: RedactCtx): void {
  // Wiersz z co najmniej dwiema komórkami „Etykieta: wartość" rozdzielonymi TAB-em to kilka pól
  // w jednym wierszu („Imię: Wiesław⇥Nazwisko: Grzelak⇥PESEL: …"). Każdą komórkę przetwarzamy
  // jak osobny wiersz: wartość „Wiesław⇥Nazwisko: Grzelak" nie jest imieniem i odpadała w całości,
  // więc imię (i imiona rodziców w następnych komórkach) zostawały jawne. Wiersz TSV z danymi
  // („Nazwisko:⇥Gzowski⇥Kadry") ma tylko jedną komórkę-etykietę i zostaje bez zmian.
  const lines: string[] = [];
  const groups: { n: number; seps: string[] }[] = [];
  const tabCell = new Set<number>();
  // komórka „etykieta bez dwukropka⇥wartość" → długość etykiety z separatorem (początek wartości)
  const bareLabel = new Map<number, number>();
  // Tryb pseudonimów: nazwisko z komórki „Nazwisko" tego samego wiersza formularza (indeks pierwszej
  // komórki wiersza → nazwisko). Imię w osobnej komórce („Imię⇥Tomasz⇥Nazwisko⇥Wróblewski") dostaje
  // pseudonim tej samej osoby, a nie ogólną etykietę obok [OSOBA-A].
  // Pod kluczem także indeks komórki „Nazwisko": rola osoby („Pacjent⇥Jan⇥Nazwisko⇥Kowal") należy do
  // tej samej osoby tylko tuż PRZED tą komórką — dalsza rola („Opiekunka⇥Ewa", „Świadek⇥Paweł") to
  // inna osoba i dostaje własną maskę, nie pseudonim nazwiska z wiersza.
  const rowSurname = new Map<number, { sur: string; at: number }>();
  const noteRowSurname = (first: number, units: string[]): void => {
    if (!ctx.pseudonyms) return;
    const sur: { sur: string; at: number }[] = [];
    units.forEach((u, k) => {
      const m = /^[ ]*nazwisko[ ]*:[ \t]*(\p{Lu}[\p{L}-]+)[ \t]*$/iu.exec(u);
      if (m) sur.push({ sur: m[1], at: first + k });
    });
    if (sur.length !== 1) return;
    for (let k = 0; k < units.length; k++) rowSurname.set(first + k, sur[0]);
  };
  const srcLines = ctx.text.split('\n');
  // Czy pod wierszem stoi wiersz tabeli z tą samą liczbą komórek (wtedy wiersz to nagłówek)?
  // Etykieta w formularzu z TAB-em (pozycja parzysta): pole osobowe albo identyfikator, rola osoby
  // („Pacjent", „Ojciec") albo nazwa pola spoza osoby („Stanowisko", „Dział", „Oddział").
  const tabLabelish = (c: string): boolean => {
    const l = c.trim().toLowerCase();
    return RE_TAB_CELL_LABEL.test(c) || RE_TAB_LABEL_VALUE.test(c) || RE_TAB_BARE_LABEL.test(c) || TAB_ROLE_LABELS.has(l) || TAB_HEADER_WORDS.has(l);
  };
  // Czy pod wierszem stoi wiersz DANYCH tabeli z tą samą liczbą komórek (wtedy wiersz to nagłówek)?
  // Wiersz formularza pod spodem („Telefon⇥600…⇥E-mail⇥…", „Oddział⇥Wewnętrzny⇥Sala⇥4") ma na
  // pozycjach parzystych etykiety — to dalszy formularz, nie dane pod nagłówkiem.
  const tabRowBelow = (li: number, n: number): boolean => {
    let j = li + 1;
    while (j < srcLines.length && srcLines[j].trim() === '') j++;
    if (j >= srcLines.length) return false;
    const below = srcLines[j].split(/\t+/);
    return below.length === n && !below.some((c, k) => k % 2 === 0 && tabLabelish(c));
  };
  for (let li = 0; li < srcLines.length; li++) {
    const ln = srcLines[li];
    if (ln.includes('\t')) {
      const parts = ln.split(/(\t+)/);
      const cells = parts.filter((_p, k) => k % 2 === 0);
      const fieldCell = (c: string): boolean => RE_TAB_CELL_LABEL.test(c) || RE_TAB_LABEL_VALUE.test(c);
      const labelCell = (c: string): boolean => fieldCell(c) || RE_TAB_BARE_LABEL.test(c);
      const labelled = cells.filter(fieldCell).length;
      if (labelled >= 2 && cells.every((c) => c.trim() === '' || fieldCell(c))) {
        noteRowSurname(lines.length, cells);
        for (const c of cells) {
          tabCell.add(lines.length);
          lines.push(c);
        }
        groups.push({ n: cells.length, seps: parts.filter((_p, k) => k % 2 === 1) });
        continue;
      }
      // Etykieta i wartość w osobnych komórkach („Imię:⇥Adam⇥Nazwisko:⇥Nowak", eksport z Excela
      // albo tabeli Worda): para „etykieta bez wartości⇥wartość" to jedno pole. Każda komórka bez
      // etykiety musi stać tuż za taką pustą etykietą — wiersz TSV z danymi („Nazwisko:⇥Gzowski⇥
      // Kadry") dalej zostaje bez zmian. Dawniej imię i imiona rodziców zostawały jawne obok
      // zamaskowanego nazwiska.
      // Etykieta bez dwukropka („Imię⇥Adam⇥Nazwisko⇥Nowak", „Imię:⇥Jan⇥Data ur.⇥03.04.1980") też
      // tworzy parę z następną komórką; początek wartości trafia do bareLabel.
      // Nagłówek tabeli („Nazwisko⇥Imię⇥Stanowisko", „Imię i nazwisko⇥Lokal⇥Telefon") to nie pary:
      // przy etykiecie bez dwukropka wszystkie komórki muszą tworzyć pary „etykieta⇥wartość",
      // wartość nie jest nazwą kolumny, a wiersz pod nim nie ma tylu samo komórek.
      // Wiersz, w którym komórki NA PRZEMIAN są etykietami i wartościami, to formularz („Imię⇥Adam⇥
      // Nazwisko⇥Nowak", „Pacjent⇥Jan⇥Nazwisko⇥Kowal", „Nazwisko⇥Marek⇥Stanowisko⇥kierowca"), także
      // z dalszymi wierszami formularza pod spodem. Nagłówek tabeli to wiersz z samych nazw kolumn.
      // Wartość pod etykietą imienia musi być imieniem („Imię⇥Szkoła⇥Nazwisko⇥Przedmiot" to nagłówek).
      const roleAt = (k: number): boolean =>
        k % 2 === 0 && TAB_ROLE_LABELS.has(cells[k].trim().toLowerCase()) && k + 1 < cells.length && POLISH_FIRST_NAMES.has(cells[k + 1].trim().toLowerCase());
      const bareRow = cells.some((c, k) => RE_TAB_BARE_LABEL.test(c) || roleAt(k));
      const isValueCell = (c: string): boolean => {
        const l = c.trim().toLowerCase();
        // rola małą literą to wartość pola („Funkcja⇥świadek"), wielką — etykieta („Świadek⇥Jan")
        return l !== '' && !labelCell(c) && !TAB_HEADER_WORDS.has(l) && !(TAB_ROLE_LABELS.has(l) && /^[ ]*\p{Lu}/u.test(c));
      };
      const bareOk =
        !bareRow ||
        (cells.length % 2 === 0 &&
          cells.every((c, k) => (k % 2 === 0 ? tabLabelish(c) : isValueCell(c))) &&
          cells.every((c, k) => k % 2 === 1 || !/^[ ]*(?:pierwsze[ ]+|drugie[ ]+)?imi[eę](?:[ ]+(?:ojca|matki))?[ ]*$/iu.test(c) || isFirstNameLike(cells[k + 1].trim().split(/[ ]+/)[0])) &&
          !tabRowBelow(li, cells.length));
      if (bareOk && (bareRow ? cells.filter((c, k) => k % 2 === 0 && tabLabelish(c)).length : cells.filter(labelCell).length) >= 2) {
        const seps = parts.filter((_p, k) => k % 2 === 1);
        const units: string[] = [];
        const unitSeps: string[] = [];
        const unitBare: number[] = [];
        let pairs = 0;
        let ok = true;
        for (let k = 0; k < cells.length && ok; k++) {
          const c = cells[k];
          if (k > 0) unitSeps.push(seps[k - 1]);
          const colonLabel = /^[^:]*:[ ]*$/.test(c) && RE_TAB_CELL_LABEL.test(c);
          const bareLbl = !colonLabel && (RE_TAB_BARE_LABEL.test(c) || (bareRow && k % 2 === 0 && tabLabelish(c) && !fieldCell(c)));
          if ((colonLabel || bareLbl) && k + 1 < cells.length && cells[k + 1].trim() !== '' && !labelCell(cells[k + 1])) {
            units.push(c + seps[k] + cells[k + 1]);
            unitBare.push(bareLbl ? c.length + seps[k].length : 0);
            pairs++;
            k++;
          } else if (c.trim() === '' || labelCell(c)) {
            units.push(c);
            unitBare.push(0);
          } else ok = false;
        }
        if (ok && pairs) {
          const first = lines.length;
          for (let u = 0; u < units.length; u++) {
            tabCell.add(lines.length);
            if (unitBare[u]) bareLabel.set(lines.length, unitBare[u]);
            lines.push(units[u]);
          }
          noteRowSurname(first, units.map((u, k) => (unitBare[k] ? `${u.slice(0, unitBare[k]).trim()}: ${u.slice(unitBare[k])}` : u)));
          groups.push({ n: units.length, seps: unitSeps });
          continue;
        }
      }
    }
    lines.push(ln);
    groups.push({ n: 1, seps: [] });
  }
  // Wyrazy stojące samotnie po tytule („Pani Nguyen", „Pan Gruber") — liczone raz, na żądanie.
  let titled: Set<string> | null = null;
  const titledSingles = (): Set<string> => {
    if (!titled) {
      titled = new Set<string>();
      for (const mm of ctx.text.matchAll(RE_TITLED_SINGLE)) titled.add(mm[1].toLowerCase());
    }
    return titled;
  };
  // Klucz (nierozpoznany) → drugi wyraz wartości, który przy nim stał (wykrycie kolizji niżej).
  const ambiguousKeys = new Map<string, string>();
  // Maska wartości: stała, a w trybie pseudonimów dla pól z nazwiskiem (surnameAt) — etykieta
  // osoby kluczowana nazwiskiem, jak w przebiegach osób, które takie pole łapały wcześniej.
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
        // imię spoza słownika („Kuba Kowal", „Bondarenko Olena", „Nguyen Thi Hoa"): nazwiskiem jest
        // wyraz rozpoznany jako nazwisko, a gdy żaden — ten, który gdzie indziej stoi sam po tytule
        // („Pani Nguyen"). Dawniej kluczem zostawało imię i dwie osoby o tym samym imieniu dostawały
        // jedną etykietę.
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
      // ten sam nierozpoznany klucz przy innym drugim wyrazie („Hans Schmidt", „Hans Becker",
      // „Nguyen Van Minh", „Tran Van Minh") — to dwie osoby; kluczem drugiej jest cała wartość
      const k = normalizeSurnameKey(sur);
      const o = other.toLowerCase();
      const seen = ambiguousKeys.get(k);
      if (seen !== undefined && seen !== o) return ctx.personMask(ws.join(' '));
      ambiguousKeys.set(k, o);
    }
    return ctx.personMask(sur);
  };
  // Dawne pole „Imię i nazwisko:" (stała maska) w komórce wiersza z TAB-ami albo jako kolejne pole
  // spłaszczonego adresu: w trybie pseudonimów etykieta osoby kluczowana nazwiskiem, spójna z prozą
  // („Imię i nazwisko: Jan Kowalski⇥Lokal: 12" … „Pan Jan Kowalski" → ta sama [OSOBA-A]).
  // Samo nazwisko w komórce („Imię: Jan⇥Nazwisko: Kowalski" … „Pan Jan Kowalski") też dostaje
  // etykietę osoby kluczowaną tym nazwiskiem — stała maska zrywała powiązanie z prozą.
  const maskCell = (field: FormField, val: string, label: string): string => {
    const single = val.trim().split(/[ \t]+/).length < 2;
    if (field.kind !== 'name' || field.surnameAt || !ctx.pseudonyms || !/nazwisk/i.test(label) || (single && !/^nazwisk/i.test(label)))
      return maskFor(field, val);
    return maskFor({ ...field, surnameAt: /^nazwisko/i.test(label) ? 'first' : 'last' }, val);
  };
  for (let i = 0; i < lines.length; i++) {
    // komórka „etykieta bez dwukropka⇥wartość" czytana jak „etykieta: wartość"
    const bareAt = bareLabel.get(i);
    const bare = bareAt ? `${lines[i].slice(0, bareAt).trim()}: ${lines[i].slice(bareAt)}` : stripFormPrefix(lines[i]);
    const label = formLabelOf(bare); // raz na linię, nie dla każdego pola z FORM_FIELDS
    const field = FORM_FIELDS.find((f) => f.re.test(label));
    // Rola osoby w komórce wiersza z TAB-ami („Świadek:⇥Jan⇥Nazwisko:⇥Kowalski", „Ojciec:⇥Jan⇥
    // Matka:⇥Ewa"): samo imię ze słownika jako cała wartość komórki to osoba. Po podziale wiersza
    // na pary „etykieta⇥wartość" zostawało jawne obok zamaskowanego nazwiska. Proza i zwykły
    // wiersz „Świadek: Jan" bez zmian.
    if (!field && tabCell.has(i) && ctx.on('IMIE')) {
      // Także para dwóch imion („Uczestnik:⇥Marek Paweł", „Wnioskodawca:⇥Paweł Marek") — imię
      // i nazwisko-homograf imienia; „Anna Nowak" pod tą samą etykietą łapały przebiegi osób.
      const rv = /^([\p{L} ]{2,30}):[ \t]+(\p{Lu}\p{Ll}+(?:[ ]+\p{Lu}\p{Ll}+)?)[ \t]*$/u.exec(bare);
      const ws = rv ? rv[2].split(/[ ]+/).map((w) => w.toLowerCase()) : [];
      if (rv && TAB_ROLE_LABELS.has(rv[1].trim().toLowerCase()) && ws.every((w) => POLISH_FIRST_NAMES.has(w) && !NOUN_LIKE_FIRST_NAMES.has(w))) {
        const rs = rowSurname.get(i);
        const rowSur = ws.length === 1 && rs && rs.at === i + 1 ? rs.sur : undefined;
        const pair = ws.length === 2 && ctx.pseudonyms ? rv[2].split(/[ ]+/)[1] : undefined;
        lines[i] = lines[i].replace(new RegExp(`${escapeRe(rv[2])}(?=[ \\t]*$)`), () =>
          rowSur ? ctx.personMask(rowSur) : pair ? ctx.personMask(pair) : ctx.M.IMIE,
        );
        ctx.bump('IMIE');
      }
      continue;
    }
    if (!field || !ctx.on(field.type)) continue;
    const colon = bare.match(/:\s*(.+)$/); // „Etykieta: WARTOŚĆ" w tej samej linii
    if (colon) {
      // Lista imion („Imiona rodziców: Jan, Anna", „Jan i Anna") — każde imię dostaje maskę; dawniej
      // wartość z przecinkiem odpadała w całości i oba imiona zostawały jawne.
      const list = field.nameList ? /^(\p{Lu}\p{Ll}+)([ \t]*,[ \t]*|[ \t]+(?:i|oraz)[ \t]+)(\p{Lu}\p{Ll}+)$/u.exec(colon[1].trim()) : null;
      if (list && isFirstNameLike(list[1]) && isFirstNameLike(list[3])) {
        const at = lines[i].lastIndexOf(list[0]);
        lines[i] = `${lines[i].slice(0, at)}${field.mask}${list[2]}${field.mask}${lines[i].slice(at + list[0].length)}`;
        ctx.bump(field.type);
        ctx.bump(field.type);
        continue;
      }
      // pod tą etykietą tylko imiona — dopisek („zgodnie z aktem urodzenia", „Urząd Stanu Cywilnego") zostaje
      if (field.nameList && !isFirstNameLike(colon[1].trim())) continue;
      // Data w tej samej linii ma już swój detektor (passBirthDate), więc same-line
      // obsługujemy tylko dla imion/miejsc/adresów.
      if (field.kind === 'date') continue;
      const val = colon[1].trim();
      // Formularz spłaszczony do wiersza („Numer budynku: 7 PESEL: 85031412347", „Ulica: Krótka
      // Nr domu: 7 Miejscowość: Mysiadło"): wartość pola adresowego kończy się przed etykietą
      // następnego pola. Dawniej maska [ADRES] zjadała etykietę i wartość kolejnego pola (albo
      // wartość odpadała w całości i ulica zostawała jawna).
      if (field.kind === 'addr') {
        const flat = maskFlatFormFields(ctx, field, val, RE_FLAT_FORM_NUMBERED.test(lines[i]), maskCell);
        if (flat !== null) {
          const at = lines[i].lastIndexOf(val);
          lines[i] = `${lines[i].slice(0, at)}${flat}${lines[i].slice(at + val.length)}`;
          continue;
        }
      }
      if (isValidFormValue(val, field.kind)) {
        if (field.gated) {
          const g = gatedPersonValue(val, false, !!field.surnameOnly);
          if (!g) continue;
          const at = lines[i].lastIndexOf(val);
          const mask = maskFor(field, g.core);
          lines[i] = `${lines[i].slice(0, at)}${g.lead}${mask}${g.tail}${lines[i].slice(at + val.length).replace(/^[^\S\r]+/, '')}`;
          ctx.bump(field.type);
          continue;
        }
        // Końcowe „\r" (tekst z CRLF dzielimy po „\n") zostaje — inaczej linia z zamaskowanym
        // polem traciła windowsowy koniec wiersza i plik wychodził z mieszanymi końcami linii.
        const rowSur = tabCell.has(i) ? rowSurname.get(i)?.sur : undefined;
        const mask =
          rowSur && /^(?:pierwsze[ ]+|drugie[ ]+)?imi[eę]$/iu.test(label) && /^\p{Lu}\p{Ll}+$/u.test(val)
            ? ctx.personMask(rowSur)
            : tabCell.has(i)
              ? maskCell(field, val, label)
              : maskFor(field, val);
        lines[i] = lines[i].replace(new RegExp(`${escapeRe(val)}[^\\S\\r]*(?=\\s*$)`), () => mask);
        ctx.bump(field.type);
      }
      continue;
    }
    // wartość w następnej NIEPUSTEJ linii — pomiń puste i podpowiedzi w nawiasach
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === '' || /^\(.*\)$/.test(lines[j].trim()))) j++;
    if (j >= lines.length || isFormLabelLine(lines[j])) continue;
    // pusta komórka-etykieta w wierszu z TAB-ami: następna komórka to inne pole, nie wartość
    if (tabCell.has(i) && tabCell.has(j)) continue;
    // Ostatnia komórka-etykieta nagłówka („Nazwisko:⇥Miejscowość:⏎Kowalski⇥Radom"): wiersz pod
    // nią z TAB-em to cały wiersz danych tabeli, nie wartość tej jednej etykiety — maska miejsca
    // zjadała osobę i kolumny.
    if (tabCell.has(i) && lines[j].includes('\t')) continue;
    const val = lines[j].trim();
    if (!isValidFormValue(val, field.kind)) continue;
    if (field.nameList && !isFirstNameLike(val)) continue;
    if (field.kind === 'date') {
      // maskuj SAMĄ datę w linii wartości (zachowaj adnotacje: „1990-01-01 (wg aktu)")
      if (RE_DATE_VALUE.test(lines[j])) {
        lines[j] = lines[j].replace(RE_DATE_VALUE, field.mask);
        ctx.bump(field.type);
      }
      continue;
    }
    let lead = '';
    let core = val;
    let tail = '';
    if (field.gated) {
      const g = gatedPersonValue(val, true);
      if (!g) continue;
      ({ lead, core, tail } = g);
    }
    const mask = maskFor(field, core);
    lines[j] = lines[j].replace(/^(\s*)[\s\S]*?(\s*)$/, (_m, a: string, b: string) => `${a}${lead}${mask}${tail}${b}`);
    ctx.bump(field.type);
  }
  const out: string[] = [];
  let at = 0;
  for (const g of groups) {
    let row = lines[at];
    for (let k = 1; k < g.n; k++) row += g.seps[k - 1] + lines[at + k];
    out.push(row);
    at += g.n;
  }
  ctx.text = out.join('\n');
}

// 1c) STRUKTURA XML/JSON — tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna.
// Maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Blok BEZ pojedynczej bramki `on()` — structMask sprawdza typ per-wpis.
// Kategoria pod kluczem „osoba"/„person" („<osoba>Prawna</osoba>", „"person": "Fizyczna"") — nie osoba.
export const PERSON_CATEGORY_VALUES = new Set<string>(
  'osoba prawna prawne fizyczna fizyczne kontaktowa kontaktowe upoważniona upoważnione zainteresowana trzecia legal natural physical juridical person'.split(' '),
);
// Jeden wyraz pod „osoba"/„person", który jest rolą, kategorią albo odpowiedzią, a nie nazwiskiem
// („Pracownik", „Klient", „Admin", „Dorosła", „Tak"). Uzupełnia ROLE_WORDS, GENERIC_LOGINS
// i PERSON_CATEGORY_VALUES; każdy inny wyraz pod tym kluczem to osoba.
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
// Tytuł albo inicjał przed nazwiskiem w wartości pola („dr Gzik", „lek. Gzik", „j. kowalski") —
// nie odbiera wartości charakteru imienia i nazwiska, jak partykuła „van".
export const RE_VALUE_TITLE_OR_INITIAL =
  /^(?:\p{L}\.|dr|dra|dr\.|mgr|mgr\.|inż\.?|prof\.?|lek\.?|med\.?|hab\.?|doc\.?|mec\.?|adw\.?|ks\.?|n\.|pan|pani|sz\.p\.)$/iu;
// Z nich te, które po przymiotniku tworzą typową nazwę („Olimpijska Nadzieja", „Polska Róża") —
// wpis „Przymiotnik Imię" na liście jest wtedy nazwą. „Mazowiecka Maja", „Gdańska Pola" czy
// „Poznańska Wiktoria" w wykazie osób to już osoba w szyku „Nazwisko Imię".
export const NOUN_LIKE_NAMES_IN_TITLES = new Set<string>(['nadzieja', 'róża', 'kalina']);
// Partykuły nazwisk („Jan van Dijk", „de la Cruz") — nie są ani imieniem, ani nazwiskiem.
export const SURNAME_PARTICLES = new Set<string>('van von de del della der den di da du dos das la le ter ten'.split(' '));
// Wyraz małą literą o końcówce przymiotnika, imiesłowu, dopełniacza albo zdrobnienia („koralowa",
// „pnąca", „pustyni", „pszczółka") — w nazwie produktu częsty, w nazwisku spoza słownika rzadki.
// Po zwykłym imieniu (spoza NOUN_LIKE_FIRST_NAMES) drugi wyraz odrzucają tylko końcówki przymiotnika
// i dopełniacza: „-ka/-ko/-na/-enko" to częste nazwiska („ewa pietka", „jan sitko", „jan wolny",
// „tetiana szewczenko"), a pod kluczem „name"/„osoba" stoi osoba. Ścisły test zostaje dla imion-rzeczowników.
const RE_LOWER_NOT_SURNAME_LENIENT = /(?:ąc[aey]|yni|ii|ej|ego|ow[aey])$/;
export const RE_LOWER_NOT_SURNAME = /(?:ow[aey]|n[aey]|ąc[aey]|yni|ii|ej|ego|k[aio])$/;
/**
 * Czy wartość małymi literami pod generycznym „name"/„osoba" to osoba („anna", „anna gzik",
 * „marek sowa", „nowak anna", „jan van dijk")? Proza łapie tylko nazwiska ze słownika, więc imię
 * z homografem albo z rzadkim nazwiskiem w zrzucie bazy czy eksporcie czatu wyciekało w całości.
 * Nazwa produktu („róża pustyni", „kalina koralowa", „weronika kłosowa") i kategoria („prawna")
 * zostają: imię-rzeczownik bez potwierdzonego nazwiska albo drugi wyraz o końcówce przymiotnika.
 */
export function lowercaseNameLooksLikePerson(words: string[]): boolean {
  // inicjał i tytuł przed nazwiskiem („j. kowalski", „dr kowalski", „lek. gzik") pomijamy jak
  // partykułę — bramka wymagała imienia na początku, więc nazwisko ze słownika zostawało jawne
  const lower = words.map((w) => w.toLowerCase()).filter((w) => !SURNAME_PARTICLES.has(w));
  const ws = lower.filter((w) => !RE_VALUE_TITLE_OR_INITIAL.test(w));
  if (!ws.length) return false;
  const confirmed = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(w);
  const plausible = (w: string): boolean => confirmed(w) || POLISH_FIRST_NAMES.has(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME.test(w));
  const [first] = ws;
  const last = ws[ws.length - 1];
  // jeden wyraz: nazwisko ze słownika/morfologii („a.kaminska" — nazwa konta) albo imię; homograf
  // sam („kalina", „sowa") to raczej nazwa. Po inicjale albo tytule („j. gzik", „dr gzik") każdy
  // wyraz o kształcie nazwiska — inicjał to kotwica osoby.
  if (ws.length === 1) {
    if (ws.length < lower.length && plausible(first) && !isPersonRoleValue(first)) return true;
    return !!surnameBase(first) || looksLikeSurname(first) || (POLISH_FIRST_NAMES.has(first) && !NOUN_LIKE_FIRST_NAMES.has(first));
  }
  const rest = ws.slice(1);
  if (POLISH_FIRST_NAMES.has(first)) {
    if (rest.every((w) => confirmed(w) || POLISH_FIRST_NAMES.has(w))) return true;
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && rest.every((w) => plausible(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME_LENIENT.test(w)))) return true;
    // imię-rzeczownik („maja", „wiktoria", „pola") też z nazwiskiem spoza słownika („maja gzik",
    // „wiktoria kos"); nazwa produktu ma drugi człon przymiotnikowy albo w dopełniaczu („kalina
    // koralowa", „róża pustyni", „pola lawendy"), a tych `plausible` i końcówka -y/-i/-u nie przepuszczą
    if (rest.every((w) => plausible(w) && !/(?:[iyu]|ów)$/.test(w))) return true;
    // imię z dopiskiem działu czy miejsca („kasia z księgowości", „marek od kadr")
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && /^(?:z|ze|od|do|u)$/.test(rest[0])) return true;
  }
  // szyk odwrócony „nowak anna", „sowa teresa" — nazwisko potwierdzone (inaczej „pasta Barbara",
  // nazwa produktu z imieniem na końcu, szła jako osoba)
  return POLISH_FIRST_NAMES.has(last) && !NOUN_LIKE_FIRST_NAMES.has(last) && ws.slice(0, -1).every(confirmed);
}
