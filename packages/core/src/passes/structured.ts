// Kotwice strukturalne: wartości pod kluczem XML (tag i atrybut), JSON i pod nagłówkiem tabeli
// (CSV, TSV, Markdown), z bramką kształtu dla każdego rodzaju pola.
import { isAsciiSurname, isConfirmedSurname, surnameShaped } from '../surnames.js';
import { type RedactCtx, URL_SENTINEL_CLOSE, URL_SENTINEL_OPEN } from '../context.js';
import { MASK } from '../types.js';
import { FORM_LABEL_WORDS, isEmptyFormValue, isValidFormValue, RE_DATE_VALUE, RE_PROPER_WORDS } from '../dict/forms.js';
import { TABLE_GENERIC_HEADERS, TSV_NOT_SURNAME } from '../dict/headers.js';
import { isPropagatableLogin, isSystemAccount, loginUserPart, RE_BUILTIN_ACCOUNT, RE_WELL_KNOWN_ACCOUNT } from '../dict/logins.js';
import { isFirstNameLike } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { RE_OFFICIAL_ROLE } from '../guards/institution-address.js';
import { RE_FUNCTION_WORD_START } from './health.js';
import { ORG_HEAD_WORDS } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS } from '../guards/roles.js';
import { PLATE_VOIV_LETTERS, plateYearEndsList, RE_PLATE_ACRONYM_HEAD } from '../guards/plates.js';
import { isPersonRoleValue, lowercaseNameLooksLikePerson, PERSON_CATEGORY_VALUES, RE_LOWER_NOT_SURNAME, RE_VALUE_TITLE_OR_INITIAL, SURNAME_PARTICLES } from '../guards/person-values.js';
import { normStructKey, STRUCT_KEYS, STRUCT_KIND_TYPE, type StructKind, structKindOf } from '../struct-keys.js';
import { isValidDowod, isValidIban, isValidPesel } from '../validators.js';

// Rola, która jest też częstym nazwiskiem („Marszałek", „Wójt", „Koło"): pod kluczem osoby wartość
// z wielkiej litery to nazwisko, nie rola.
const ROLE_HOMOGRAPH_SURNAMES = new Set<string>('marszałek wójt dziadek dziekan komornik król starosta koło kowal'.split(' '));
const RE_EVENT_DATA_NAME = /\sName\s*=\s*["']([\p{L}_][\p{L}\p{N}_.-]{0,40})["']/u;
// Każdy atrybut zaczyna się literą, a wartość stoi w cudzysłowie, więc podział jest jednoznaczny.
const RE_XML_TAG_WITH_ATTRS =
  /<[\p{L}_][\p{L}\p{N}_.:-]{0,40}(?:[ \t\r\n]+[\p{L}_][\p{L}\p{N}_.:-]{0,40}[ \t]*=[ \t]*(?:"[^"<>\r\n]{0,80}"|'[^'<>\r\n]{0,80}'))+[ \t\r\n]*\/?>/gu;
const RE_XML_ATTR = /([\p{L}_][\p{L}\p{N}_.:-]{0,40})([ \t]*=[ \t]*)(["'])([^"'<>\r\n]{1,80})\3/gu;
const RE_XML_INSTITUTION_TAG =
  /^<(?:[\p{L}_][\p{L}\p{N}_.-]*:)?(?:urzad|urząd|sad|sąd|oddzial|oddział|szkola|szkoła|bank|organ|instytucja|jednostka|podmiot|placowka|placówka|organizacja)|[ \t\r\n](?:nazwa|bank|patron|organ|urzad|urząd|siedziba)[ \t]*=/iu;
const RE_XML_PERSON_ATTR =
  /[ \t\r\n](?:imie|imię|imiona|nazwisko|first[_-]?name|last[_-]?name|given[_-]?name|surname|full[_-]?name|pesel)[ \t]*=/iu;
// Adres, telefon i siedziba w tagu instytucji należą do urzędu, nie do człowieka.
const INSTITUTION_OWNED_KINDS = new Set<StructKind>(['addr', 'city', 'phone', 'postal', 'email']);
// Adres z kodem i miejscowością w jednym polu: kod i miasto mają własne przebiegi i maski.
const RE_ADDR_WITH_POSTAL = /\d{2}-\d{3}(?!\d)/;
// Atrybut z kluczem osobowym bywa ustawieniem szablonu albo schematu („imie="tak"", „nazwisko=
// "rosnąco"", „imie="Wójt" nazwisko="Gminy""), więc wartość musi mieć kształt nazwy własnej i nie
// może być nazwą pola, rolą, urzędem ani wypełniaczem.
const XML_ATTR_NAME_STOP = new Set<string>(
  (
    'danych dane brak test testowy testowa przykład przykładowy przykładowa string true false referatu wydziału działu biura sekretariatu ' +
    // podmioty państwowe i zbiorowe („nazwisko="Skarb Państwa"")
    'skarb państwa państwowe państwowy państwowa lasy wspólnota mieszkaniowa'
  ).split(' '),
);
function xmlAttrNameValue(value: string, kind: StructKind): boolean {
  const v = value.trim();
  if (!RE_PROPER_WORDS.test(v) || RE_TABLE_REGNAL_CELL.test(v)) return false;
  const ws = v.split(/[ \t]+/);
  // nazwisko-homograf roli („nazwisko="Marszałek"") zostaje nazwiskiem jak pod kluczem „osoba"
  if (kind === 'surname' && ws.length === 1 && ROLE_HOMOGRAPH_SURNAMES.has(ws[0].toLowerCase())) return true;
  return ws.every((w) => {
    const l = w.toLowerCase();
    return !XML_ATTR_NAME_STOP.has(l) && !STRUCT_KEYS.has(normStructKey(w)) && !ROLE_WORDS.has(l) && !LEGAL_ENTITY_WORDS.has(l) && !FORM_LABEL_WORDS.has(l) && !isPersonRoleValue(l);
  });
}
/**
 * Klucz osoby (nazwisko) z wartości pola. Szyk rozstrzyga słownik imion („Domański Witold" i „Witold
 * Domański" → Domański), a gdy nie rozstrzyga, klucz pola („Nazwisko i imię" → pierwszy wyraz).
 */
function structSurnameKey(ws: string[], key?: string): string {
  const last = ws[ws.length - 1];
  if (ws.length < 2) return last;
  const fnF = isFirstNameLike(ws[0]);
  const fnL = isFirstNameLike(last);
  // Szyk odwrotny wskazuje tylko klucz „nazwisko…". Pod innym kluczem nazwisko-homograf imienia na
  // końcu („Iryna Roman") zostaje kluczem, chyba że pierwszy wyraz to potwierdzone nazwisko.
  const surnameFirstKey = !!key && normStructKey(key).startsWith('nazwisko');
  if (fnL && !fnF && key && !surnameFirstKey && !isConfirmedSurname(ws[0])) return last;
  if (fnL && !fnF) return ws[0];
  // oba wyrazy to imiona („Iryna Roman”): szyk rozstrzyga klucz pola, jak przy braku imienia
  if (fnF && !(fnL && surnameFirstKey)) return last;
  return surnameFirstKey ? ws[0] : last;
}
const STRUCT_FORM_KIND: Partial<Record<StructKind, Parameters<typeof isValidFormValue>[1]>> = {
  first: 'name', surname: 'name', fullname: 'name', name: 'name', person: 'name', city: 'place', addr: 'addr',
};
// Dokumenty mają ten sam kształt wartości co w prozie: klucz jest kotwicą, a kształt chroni przed
// „brak", „kat. B" czy numerem zamówienia pod mylącym kluczem.
const STRUCT_VALUE_SHAPE: Partial<Record<StructKind, RegExp>> = {
  postal: /^\d{2}[- ]?\d{3}$/,
  birth: RE_DATE_VALUE,
  // zapis Windows/AD „DOMENA\użytkownik" (w JSON-ie „\\") maskujemy w całości
  login: /^(?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._@-]{1,63}$/,
  email: /\S(?:@|%40|\(at\))\S/i,
  pesel: /^\d(?:[ -]?\d){10}$/,
  nip: /^(?:PL[- ]?)?\d(?:[ -]?\d){9}$/,
  regon: /^\d(?:[ -]?\d){8}(?:(?:[ -]?\d){5})?$/,
  passport: /^[A-Za-z]{2}[\s-]?\d{7}$/,
  idcard: /^[A-Za-z]{3}[\s-]?\d{6}$/,
  krs: /^\d{10}$/,
  license: /^(?=[A-Za-z0-9/ -]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3}$/,
  // wyróżnik wielkimi literami i cyfra w numerze; „nrRej": „000012345" (rejestr BDO) odpada
  plate: /^(?:[A-Z]{2,3}[\s-]?(?=[A-Z0-9]{0,4}\d)[A-Z0-9]{4,5}|[A-Z]{3}[\s-]?[A-Z]{2}\d{2})$/,
  // 26 cyfr NRB bez sumy kontrolnej, bo kotwicą jest klucz; „R/2026/001" czy „201-01" odpadają
  account: /^(?:PL[ ]?)?\d(?:[ -]?\d){25}$/,
};
/** Maska wartości pod kluczem strukturalnym (XML, JSON, nagłówek tabeli); `null`, gdy wartość nie ma
 *  kształtu danego rodzaju. */
function structMasker(ctx: RedactCtx): (kind: StructKind, value: string, key?: string) => string | null {
  return (kind: StructKind, value: string, key = ''): string | null => {
    const v = value.trim();
    if (!v || v.length > 70 || /[[\]]/.test(v) || v.includes(URL_SENTINEL_OPEN) || v.includes(URL_SENTINEL_CLOSE)) return null;
    if (isEmptyFormValue(v)) return null;
    const type = STRUCT_KIND_TYPE[kind];
    if (!ctx.on(type)) return null;
    const form = STRUCT_FORM_KIND[kind];
    if (form && !isValidFormValue(v, form)) return null;
    const shape = STRUCT_VALUE_SHAPE[kind];
    if (shape && !shape.test(v)) return null;
    switch (kind) {
      case 'name':
      case 'person': {
        // Generyczny „name" i „osoba" bywa nazwą produktu, firmy albo kategorią, więc zapis małymi
        // literami („Róża pustyni", „<osoba>prawna</osoba>") przechodzi tylko, gdy wygląda na osobę.
        const ws = v.split(/\s+/);
        // partykuła, tytuł i inicjał małą literą nie odbierają charakteru nazwy własnej („dr Gzik")
        const proper = ws.filter((w) => !SURNAME_PARTICLES.has(w) && !(/^\p{Ll}/u.test(w) && RE_VALUE_TITLE_OR_INITIAL.test(w)));
        if (!proper.length || !RE_PROPER_WORDS.test(proper.join(' '))) {
          // „osoba" małymi literami: jeden wyraz o kształcie nazwiska, który nie jest rolą ani
          // kategorią („gzik" tak, „prawna" nie)
          const own = proper.map((w) => w.toLowerCase());
          if (kind === 'person' && own.length === 1 && own[0].length >= 3 && !RE_LOWER_NOT_SURNAME.test(own[0]) && !isPersonRoleValue(own[0])) break;
          if (!lowercaseNameLooksLikePerson(ws)) return null;
          break;
        }
        // „osoba" od wielkiej litery to osoba w każdym szyku, także rzadkie nazwisko spoza słowników
        // („Gzik", „KOWALSKI JAN"); odpadają kategoria („Osoba Fizyczna") i jednowyrazowa rola („Klient").
        if (kind === 'person') {
          if (ws.every((w) => PERSON_CATEGORY_VALUES.has(w.toLowerCase()))) return null;
          if (proper.length === 1 && isPersonRoleValue(proper[0].toLowerCase()) && !ROLE_HOMOGRAPH_SURNAMES.has(proper[0].toLowerCase())) return null;
          break;
        }
        // „name" od wielkiej litery: pierwszy wyraz to imię albo ostatni to nazwisko
        const last = ws[ws.length - 1];
        if (!isFirstNameLike(ws[0]) && !surnameShaped(last)) return null;
        break;
      }
      case 'phone':
        if ((v.match(/\d/g) ?? []).length < 6 || /[A-Za-z]{3,}/.test(v)) return null;
        // data w kolumnie telefonu to stopka eksportu („Stan na;;01.10.2026")
        if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
        break;
      case 'login': {
        if (RE_BUILTIN_ACCOUNT.test(v) || RE_WELL_KNOWN_ACCOUNT.test(v)) return null;
        const user = loginUserPart(v);
        // Wbudowane konto w atrybucie AD i dziennika zdarzeń („krbtgt") to informacja z audytu, nie dana
        // osobowa. Nazwisko z wielkiej litery („Lewandowski") zostaje fazie 4, żeby dostało [OSOBA-X].
        if (/^(?:samaccountname|targetusername|subjectusername)$/i.test(key) && (isSystemAccount(user) || (/^[A-Z][a-z]+$/.test(user) && isAsciiSurname(user)))) return null;
        // ta sama wartość pada zwykle w treści obok („Konto a.kaminska zablokowane")
        if (isPropagatableLogin(user)) ctx.loginSeeds.add(user);
        break;
      }
      case 'license':
        // rok albo data uzyskania uprawnień („"prawoJazdy": "2010"") to nie numer dokumentu
        if (/^(?:\d{1,4}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})$/.test(v)) return null;
        break;
      case 'plate':
        if (!PLATE_VOIV_LETTERS.includes(v[0]) || !RE_PLATE_ACRONYM_HEAD.test(v)) return null;
        // Skrót z rokiem („"tablica": "ZP 2026"") odpada jak w prozie, ale pod kluczem z „rej" jest
        // wartością pola, czyli tablicą.
        if (!/rej/i.test(key) && plateYearEndsList(v)) return null;
        break;
      case 'account': {
        const digits = v.replace(/\D/g, '');
        // Jedna cyfra powtórzona to wypełniacz szablonu. Numer z poprawną sumą zostaje przebiegom
        // IBAN/NRB, tu łapiemy tylko numer z literówką.
        if (/^(\d)\1+$/.test(digits) || isValidIban(`PL${digits}`)) return null;
        break;
      }
    }
    ctx.bump(type);
    // nazwisko (samo lub na końcu pełnego imienia i nazwiska) → spójna etykieta [OSOBA-X]
    if (kind === 'surname' || kind === 'fullname' || kind === 'person' || (kind === 'name' && /\s/.test(v))) {
      return ctx.personMask(structSurnameKey(v.split(/\s+/), key));
    }
    return ctx.M[type];
  };
}

export function passStructured(ctx: RedactCtx): void {
  const structMask = structMasker(ctx);
  // XML: <Tag>wartość</Tag>, wartość jednoliniowa. Prefiks przestrzeni nazw („<etd:Nazwisko>") to
  // norma w e-Deklaracjach i JPK: zamknięcie powtarza pełną nazwę (\2), klucz bierzemy z części lokalnej.
  ctx.text = ctx.text.replace(
    /(<((?:[\p{L}_][\p{L}\p{N}_.-]{0,20}:)?[\p{L}_][\p{L}\p{N}_.-]{0,40})(?:\s[^<>]*)?>)([^<>\r\n]{1,70})(<\/\s*\2\s*>)/gu,
    (m, open: string, tag: string, value: string, close: string) => {
      // W dzienniku zdarzeń Windows nazwą pola jest atrybut („<Data Name="TargetUserName">"), a tag
      // „Data" niczego nie mówi.
      const local = tag.slice(tag.indexOf(':') + 1);
      const attr = /^data$/i.test(local) ? RE_EVENT_DATA_NAME.exec(open)?.[1] : undefined;
      const key = attr ?? local;
      const kind = structKindOf(key, value);
      // Z atrybutu bierzemy tylko konto: „<Data Name="Name">Kowalski</Data>" maskuje faza 4, która
      // w trybie pseudonimów daje tej osobie tę samą etykietę co w reszcie dokumentu.
      if (!kind || (attr && kind !== 'login')) return m;
      const mask = structMask(kind, value, key);
      return mask === null ? m : `${open}${mask}${close}`;
    },
  );
  // XML: atrybuty otwartego tagu („<Pelnomocnik imie="Piotr" nazwisko="Lewandowski"/>"). Tylko
  // klucze jednoznacznie osobowe: „name" i „osoba" w atrybucie to zwykle nazwa pola schematu albo
  // kategoria („<xs:element name="Nazwisko"/>"). Tag instytucji bez atrybutu osoby zostawia adres
  // i telefon, a „<Adres ulica=…/>" pod osobą zostaje kotwicą.
  ctx.text = ctx.text.replace(RE_XML_TAG_WITH_ATTRS, (m: string) => {
    const inst = RE_XML_INSTITUTION_TAG.test(m) && !RE_XML_PERSON_ATTR.test(m);
    return m.replace(RE_XML_ATTR, (a, key: string, eq: string, q: string, value: string) => {
      const kind = structKindOf(key, value);
      if (!kind || kind === 'name' || kind === 'person' || kind === 'login') return a;
      if (inst && INSTITUTION_OWNED_KINDS.has(kind)) return a;
      if (kind === 'addr' && RE_ADDR_WITH_POSTAL.test(value)) return a;
      if ((kind === 'first' || kind === 'surname' || kind === 'fullname') && !xmlAttrNameValue(value, kind)) return a;
      const mask = structMask(kind, value, key);
      return mask === null ? a : `${key}${eq}${q}${mask}${q}`;
    });
  });
  // JSON: "klucz": "wartość", także zagnieżdżony w łańcuchu („"payload":"{\"imie\":\"Jadwiga\"}").
  // Poziom ucieczki cudzysłowu (grupa 2) jest wspólny dla klucza i wartości, inaczej zewnętrzny klucz
  // wziąłby „{\" za wartość. (?<!\\) daje jeden start na ciąg backslashy, czyli czas liniowy.
  ctx.text = ctx.text.replace(
    /(?<!\\)((\\{0,7})"([\p{L}_][\p{L}\p{N}_. -]{0,40})\2"\s*:\s*\2")((?:[^"\\\r\n]|\\[^"\r\n]){1,70})(\2")/gu,
    (m, prefix: string, _esc: string, key: string, value: string, close: string) => {
      const kind = structKindOf(key, value);
      if (!kind) return m;
      const mask = structMask(kind, value, key);
      return mask === null ? m : `${prefix}${mask}${close}`;
    },
  );
}

// Tabela z nagłówkiem (CSV, TSV, Markdown). Wiersz nagłówka złożony z samych nazw pól jest kotwicą
// jak klucz JSON, ale tabelą jest dopiero taki, w którym jedna kolumna wskazuje osobę albo jej
// dokument: „city,population" czy „id,name,category" to dane o mieście i produkcie.
const TABLE_GATE_KINDS = new Set<StructKind>(['first', 'surname', 'fullname', 'pesel', 'birth', 'plate', 'passport', 'idcard', 'license']);
const TABLE_PERSON_KINDS = new Set<StructKind>(['first', 'surname', 'fullname', 'name', 'person']);
const tablePersonCell = (k: StructKind | undefined): boolean => k !== undefined && TABLE_PERSON_KINDS.has(k);
const RE_TABLE_HEADER_CELL = /^\p{L}[\p{L}\p{N}_.\-/() ]{0,39}$/u;
const RE_MD_RULE = /^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+(?:[ \t]*:?-{3,}:?[ \t]*)?\|?[ \t]*$/;
interface TableCell { start: number; end: number }
/**
 * Podział wiersza na komórki (zakresy w wierszu); cudzysłów CSV trzyma separator w środku.
 * Wiersz z „|" (Markdown albo tabela z Worda wklejona jako tekst) może mieć skrajne „|" albo nie,
 * a cudzysłów nic w nim nie znaczy. Separator „  " to kolumny wyrównane spacjami (kopia z PDF-a):
 * granicą są co najmniej dwie spacje. `null`, gdy wiersz ma niedomknięty cudzysłów albo nie ma
 * separatora kolumn.
 */
function splitTableRow(line: string, delim: string): TableCell[] | null {
  let from = 0;
  let to = line.length;
  const pipe = delim === '|';
  if (pipe) {
    if (!line.includes('|')) return null;
    const lead = /^[ \t]*\|/.exec(line);
    const trail = /\|[ \t]*$/.exec(line);
    if (lead) from = lead[0].length;
    if (trail && trail.index >= from) to = trail.index;
  }
  const cells: TableCell[] = [];
  if (delim === '  ') {
    const lead = /^[ \t]*/.exec(line) as RegExpExecArray;
    let start = lead[0].length;
    const re = / {2,}|\t/g;
    re.lastIndex = start;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      if (m.index + m[0].length >= line.length) break;
      cells.push({ start, end: m.index });
      start = m.index + m[0].length;
    }
    // Koniec wiersza bez spacji i tabulatorów z prawej, pętlą wstecz: wyrażenie z „$” po długim
    // ciągu spacji próbowałoby od każdej z nich (czas kwadratowy).
    let end = line.length;
    while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t')) end--;
    cells.push({ start, end });
    return cells.length > 1 ? cells : null;
  }
  let start = from;
  let quoted = false;
  for (let i = from; i < to; i++) {
    const ch = line[i];
    if (ch === '"' && !pipe) {
      if (quoted && line[i + 1] === '"') i++;
      else if (quoted || line.slice(start, i).trim() === '') quoted = !quoted;
    } else if (ch === delim && !quoted) {
      cells.push({ start, end: i });
      start = i + 1;
    }
  }
  if (quoted) return null;
  cells.push({ start, end: to });
  return cells;
}
function rowLooksLikeHeader(values: string[]): boolean {
  const cells = values.map((v) => v.trim()).filter((v) => v);
  if (cells.length < 2 || cells.some((v) => /\d/.test(v) || !RE_TABLE_HEADER_CELL.test(v))) return false;
  const known = cells.filter((v) => STRUCT_KEYS.has(normStructKey(v)) || TABLE_GENERIC_HEADERS.has(v.toLowerCase())).length;
  return known >= 2 && known * 2 >= cells.length;
}
// Biuro albo podmiot państwowy w kolumnie osoby („Sekretariat Wójta", „Skarb Państwa") to wiersz
// instytucji: jego telefon i siedziba nie są danymi osoby.
const TABLE_ORG_EXTRA_WORDS = new Set<string>(
  (
    'sekretariat centrala biuro dyżur recepcja kancelaria informacja punkt dziekanat portiernia dział ' +
    'wydział referat kasa skarb państwa państwowe państwowy państwowa wspólnota mieszkaniowa lasy'
  ).split(' '),
);
// Kolumna z danymi innej osoby niż ta z wiersza (rodzic, opiekun, małżonek, osoba kontaktowa).
const RE_TABLE_OTHER_PERSON_COL =
  /(?:matk|ojc|rodzic|opiekun|małżon|malzon|współmałż|dzieck|dzieci|kontakt|mother|father|parent|guardian|spouse|contact|child)/iu;
const tableOrgCell = (v: string): boolean =>
  v
    .toLowerCase()
    .split(/[ \t]+/)
    .some(
      (w) =>
        ORG_HEAD_WORDS.has(w) ||
        LEGAL_ENTITY_WORDS.has(w) ||
        TABLE_ORG_EXTRA_WORDS.has(w) ||
        /^(?:sp\.?|s\.a\.|spółka|gmina|gminny|gminna|miejski|miejska|powiatowy|powiatowa)$/.test(w),
    );
// Podmiot kościelny w kolumnie osoby („Parafia św. Józefa"): imię świętego potwierdzałoby osobę.
// „pw."/„św." łapie go także po wcześniejszej masce w komórce.
const RE_TABLE_SACRAL_CELL =
  /^[ \t]*(?:parafi\p{L}*|kości[oe]ł\p{L}*|kaplic\p{L}*|klasztor\p{L}*|zgromadzeni\p{L}*|diecezj\p{L}*|sanktuari\p{L}*|bazylik\p{L}*|katedr\p{L}*|caritas)(?!\p{L})|(?<!\p{L})(?:pw|św|bł)\.[ \t]*\p{Lu}/iu;
// Władca albo papież z liczbą porządkową w komórce osoby („Jan Paweł II,Patron"), jak w prozie.
const RE_TABLE_REGNAL_CELL =
  /^\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)?[ \t]+(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)$/u;
// Sam urząd w komórce osoby („3;Sołtys;Lubień 1;") to wiersz roli z listy obecności, bez osoby i jej
// adresu. Para z imieniem („Jan Sołtys") dalej jest osobą.
const TABLE_OFFICE_WORDS = new Set<string>(
  'sołtys sołtyska starosta ławnik ławniczka radny radna skarbnik sekretarz woźny woźna kasjer kasjerka opiekun opiekunka przewodniczący przewodnicząca'.split(' '),
);
const tableOfficeCell = (v: string): boolean => TABLE_OFFICE_WORDS.has(v.trim().toLowerCase());
const RE_TABLE_PROSE_PREP = /^(?:w|we|na|do|od|po|przy|dla|o|u|za|ze|pod|nad|przed|bez|oraz)$/i;
const RE_TABLE_SUMMARY_ROW = /^[ \t]*(?:razem|suma|ogółem|łącznie|wszyscy|wszystkie|podsumowanie|stan[ \t]+na|wydruk|wygenerowano|total)(?![\p{L}])/iu;
/**
 * Komórka osoby, która jest zdaniem, nie imieniem i nazwiskiem („Wyjazd w maju", „silny mróz"):
 * przyimek jako osobny wyraz, same małe litery z wyrazem spoza słowników imion i nazwisk (a „anna
 * kowal" ma oba w słowniku) albo wyraz z wielkiej litery obok wyrazu z małej spoza partykuł i tytułów.
 */
function tableProseCell(v: string): boolean {
  const ws = v.trim().split(/[ \t]+/);
  if (RE_TABLE_REGNAL_CELL.test(v.trim())) return true;
  if (ws.length >= 2 && ws.some((w) => RE_TABLE_PROSE_PREP.test(w))) return true;
  if (
    ws.length >= 2 &&
    ws.every((w) => /^\p{Ll}/u.test(w)) &&
    ws.some((w) => !SURNAME_PARTICLES.has(w) && !RE_VALUE_TITLE_OR_INITIAL.test(w) && !isFirstNameLike(w) && !isConfirmedSurname(w))
  )
    return true;
  return (
    ws.length >= 2 &&
    ws.some((w) => /^\p{Lu}/u.test(w)) &&
    ws.some(
      (w) =>
        /^\p{Ll}/u.test(w) &&
        !SURNAME_PARTICLES.has(w) &&
        !RE_VALUE_TITLE_OR_INITIAL.test(w) &&
        !/^(?:z|i|vel|primo|voto|zd\.?|ur\.?)$/.test(w),
    )
  );
}
// Kolumna osoby nazwana rolą zamiast „Imię i nazwisko" (lista kandydatów, uczniów, wnioskodawców).
// Tylko w nagłówku tabeli: w JSON-ie i XML-u te słowa bywają kluczem obiektu, nie wartością osoby.
const TABLE_PERSON_HEADERS = new Set<string>(
  (
    'kandydat kandydatka kandydaci wnioskodawca wnioskodawczyni wnioskodawcy uczeń uczen uczennica uczniowie ' +
    'pracownik pracownica pracownicy dziecko dzieci pacjent pacjentka podatnik podatniczka świadczeniobiorca ' +
    'uczestnik uczestniczka uczestnicy student studentka słuchacz słuchaczka najemca najemczyni petent petentka ' +
    'beneficjent beneficjentka zawodnik zawodniczka wychowanek wychowanka mieszkaniec mieszkanka ' +
    'zobowiązany zobowiązana dłużnik dłużniczka spadkobierca spadkobiercy wnioskujący zgłaszający'
  ).split(' '),
);
// „Imię i nazwisko ucznia", „Nazwisko i imiona kandydata": nagłówek osoby z dopełnieniem roli.
const RE_TABLE_FULLNAME_HEAD = /^(?:imi[eę]i?nazwisko|nazwiskoi?imi(?:[eę]|ona))\p{Ll}{3,20}$/u;
/** Rodzaj kolumny pod nagłówkiem tabeli: klucz strukturalny albo nagłówek osoby znany tylko tabeli. */
function tableKindOf(name: string, value: string): StructKind | undefined {
  const k = structKindOf(name, value);
  if (k) return k;
  const n = normStructKey(name);
  if (RE_TABLE_FULLNAME_HEAD.test(n)) return 'fullname';
  return TABLE_PERSON_HEADERS.has(n) ? 'person' : undefined;
}
const RE_TABLE_NAME_WORD = /^\p{Lu}[\p{L}'’‑-]*\p{L}$/u;
// Dwie wielkie litery obok siebie („MOPS”, „PUP”, „ZGK”, „KOWALCZYK”): skrót jednostki albo firmy
// albo wyraz wersalikami, którego sam kształt nie odróżnia od nazwy podmiotu.
const RE_TABLE_CAPS_RUN = /\p{Lu}{2}/u;
// Jeden inicjał imienia przed nazwiskiem („H. Gąsienica-Ryś”). Dwa inicjały („F.H. Marex”,
// „P.W. Budrex”, „Z.P. Elmet”) to częściej skrót formy działalności niż osoba; „J.M. Nowak”
// potwierdza nazwisko ze słownika.
const RE_TABLE_INITIAL_SURNAME = /^\p{Lu}\.[ ]\p{Lu}[\p{L}'’‑-]*\p{L}$/u;
// Końcówka przymiotnika albo rzeczownika zbiorowego w nazwie podmiotu i miejscowości („Wody Polskie”,
// „Usługi Remontowe”, „Nadleśnictwo Lipno”, „Grupa Robocza”, „Pozostali Uczestnicy”).
const RE_TABLE_ENTITY_WORD_END = /(?:owe|owy|owa|owi|cze|czy|cza|ne|ny|ni|ie|kie|ctwo|stwo|cja|cje|cji|um|ość|ości|cy|ali|eli|ona|ony|ory|óra|ska|ski|sko)$/u;
/**
 * Czy wiersz ma daną, którą ma tylko człowiek: PESEL z poprawną sumą, datę w kolumnie daty
 * urodzenia albo numer dowodu z poprawną sumą. Firma, program, ulica, wydarzenie czy stanowisko
 * w kolumnie osób („Imię i nazwisko albo nazwa”) takiej danej obok siebie nie ma.
 */
function tableRowPersonDatum(values: string[], kinds: (StructKind | undefined)[]): boolean {
  return values.some((v, i) => {
    const t = v.trim();
    if (!t || t.length > 24) return false;
    if (kinds[i] === 'pesel') return /^\d{11}$/.test(t) && isValidPesel(t);
    if (kinds[i] === 'birth') return RE_DATE_VALUE.test(t);
    return kinds[i] === 'idcard' && isValidDowod(t);
  });
}
/**
 * Komórka o kształcie imienia i nazwiska spoza słowników. Wystarcza tylko w tabeli, w której inny
 * wiersz potwierdził osobę słownikiem. Inicjał z nazwiskiem przechodzi w każdej kolumnie osoby
 * (lista kandydatów z telefonem i e-mailem). Dwa albo trzy pełne wyrazy („Zych Natan”) tylko pod
 * nagłówkiem imienia i nazwiska i tylko w wierszu z daną człowieka (`personDatum`): sam kształt
 * „Wyraz Wyraz” mają też firmy („Eko Trans”), programy („Czyste Powietrze”), ulice („Armii
 * Krajowej”), wydarzenia („Dzień Otwarty”) i stanowiska („Starszy Referent”).
 */
function tableNameShapedCell(v: string, kind: StructKind | undefined, personDatum: boolean): boolean {
  const t = v.trim();
  if (tableOfficeCell(t) || tableOrgCell(t) || RE_TABLE_SACRAL_CELL.test(t) || RE_TABLE_REGNAL_CELL.test(t)) return false;
  if (tablePositionCell(t, personDatum)) return false;
  const ws = t.split(/ +/);
  const plain = (w: string): boolean => {
    const l = w.toLowerCase();
    return (
      !RE_TABLE_CAPS_RUN.test(w) &&
      !RE_OFFICIAL_ROLE.test(w) &&
      !isPersonRoleValue(l) &&
      !ROLE_WORDS.has(l) &&
      !STRUCT_KEYS.has(normStructKey(w)) &&
      !FORM_LABEL_WORDS.has(l)
    );
  };
  if (RE_TABLE_INITIAL_SURNAME.test(t)) {
    const sur = ws[ws.length - 1];
    return plain(sur) && !POLISH_CITIES.has(sur.toLowerCase());
  }
  if (!personDatum || (kind !== 'fullname' && kind !== 'surname' && kind !== 'first')) return false;
  if (ws.length < 2 || ws.length > 3 || POLISH_CITIES.has(t.toLowerCase())) return false;
  return ws.every((w) => {
    if (!RE_TABLE_NAME_WORD.test(w) || w.length < 3 || !plain(w)) return false;
    if (isFirstNameLike(w) || isConfirmedSurname(w) || functionDerivedSurname(w)) return true;
    return !RE_TABLE_ENTITY_WORD_END.test(w.toLowerCase()) && !POLISH_CITIES.has(w.toLowerCase());
  });
}
// Stanowisko albo zawód spoza wzorców urzędu i ochrony zdrowia.
const RE_TABLE_TRADE_START = /^(?:tłumacz|kanclerz|wikariusz|sołtys)\p{Ll}*(?!\p{L})/iu;
// Przymiotnik przed nazwiskiem ze słownika w nazwie dnia czy wydarzenia („Wielki Piątek”).
// Tylko końcówki męskie i nijakie: imię kobiety spoza słownika („Selina Nowak”) kończy się na -a.
const RE_TABLE_ADJ_WORD = /(?:ki|ny|wy|ły|ty|kie|ne|we)$/u;
/**
 * Komórka osoby, która nazywa stanowisko, zawód albo dzień, a nie człowieka: co najmniej dwa wyrazy,
 * żaden nie jest imieniem, a pierwszy to funkcja („Sołtys Zalesia”, „Starszy Referent”, „Kierowca
 * Autobusu”, „Tłumacz Przysięgły”) albo przymiotnik obok nazwiska ze słownika („Wielki Piątek”).
 * Sam wyraz („Sołtys” w kolumnie nazwiska obok imienia) zostaje nazwiskiem. Wiersz z daną
 * człowieka (`personDatum`: PESEL z sumą, data urodzenia, dowód) nie ma stanowiska w kolumnie osób,
 * a nazwisko utworzone od funkcji („Wójtowicz”, „Sołtysik”, „Komornicki”) funkcją nie jest.
 */
function tablePositionCell(v: string, personDatum = false): boolean {
  if (personDatum) return false;
  const ws = v.trim().split(/ +/);
  if (ws.length < 2 || ws.some((w) => isFirstNameLike(w))) return false;
  const t = ws.join(' ');
  // Funkcja przed nazwiskiem ze słownika („Kurator Nowak”) to dalej osoba.
  if (tableFunctionWord(t)) return !functionDerivedSurname(ws[0]) && !ws.slice(1).some((w) => isConfirmedSurname(w));
  return ws.length === 2 && !isConfirmedSurname(ws[0]) && RE_TABLE_ADJ_WORD.test(ws[0].toLowerCase()) && isConfirmedSurname(ws[1]);
}
const tableFunctionWord = (t: string): boolean => RE_OFFICIAL_ROLE.test(t) || RE_FUNCTION_WORD_START.test(t) || RE_TABLE_TRADE_START.test(t);
// Przyrostek nazwiska utworzonego od rdzenia wyrazu („Wójt-owicz”, „Sołtys-ik”, „Komorni-cki”,
// „Lekar-ski”, „Sędzi-kowski”). Odmiana samej funkcji („Wójtowi”, „Sołtysem”, „Komornika”) go nie ma.
const RE_DERIVED_SURNAME_END = /(?:owicz|ewicz|icz|iak|ik|yk|czyk|czak|ak|uk|ski|cki|dzki|ska|cka|dzka)$/u;
/**
 * Nazwisko utworzone od wyrazu funkcji: wyraz z wielkiej litery, którego przyrostek nazwiska stoi
 * w całości za najkrótszym rdzeniem funkcji. „Komornik” ma „-ik” w rdzeniu „komorni-”, więc zostaje
 * funkcją, „Komornicki” ma „-cki” za rdzeniem, więc jest nazwiskiem.
 */
function functionDerivedSurname(w: string): boolean {
  if (!/^\p{Lu}\p{Ll}{3,}$/u.test(w)) return false;
  const end = RE_DERIVED_SURNAME_END.exec(w);
  if (!end) return false;
  for (let i = 2; i <= end.index; i++) if (tableFunctionWord(w.slice(0, i))) return true;
  return false;
}
// Inicjał imienia („J.”) w komórce osoby.
const RE_TABLE_INITIAL = /^\p{Lu}\.$/u;
/**
 * Komórka kolumny nazwanej rolą („Wnioskodawca”, „Najemca”, „Beneficjent”, „Podatnik”). Pod takim
 * nagłówkiem w urzędzie stoją też firmy i organizacje („Pensjonat Agata”, „Kwiaciarnia Róża”, „Chór
 * Cecylia”, „F.H.U. Marex Jan Nowak”), więc osobę potwierdza dopiero komórka z co najmniej dwóch
 * wyrazów, w której każdy jest imieniem, nazwiskiem ze słownika albo inicjałem.
 */
function tableRolePersonCell(v: string): boolean {
  const ws = v.trim().split(/ +/);
  if (ws.length < 2 || ws.length > 4) return false;
  return ws.every((w) => RE_TABLE_INITIAL.test(w) || isFirstNameLike(w) || w.split('-').every((p) => isConfirmedSurname(p) || isFirstNameLike(p)));
}
/** Kolumna, która jest kolumną osób tylko z powodu nagłówka roli (TABLE_PERSON_HEADERS). */
const tableRoleColumn = (name: string, value: string): boolean => !structKindOf(name, value) && TABLE_PERSON_HEADERS.has(normStructKey(name));
interface TableRow { r: number; cells: TableCell[]; texts: string[]; values: string[]; kinds: (StructKind | undefined)[]; personOk: boolean; datum: boolean }
/**
 * Separator kolumn nagłówka. „|" ma pierwszeństwo, bo nazwa kolumny nie zawiera „|", a tabela
 * z Worda czy z czatu wklejona jako tekst ma go bez wiersza „---" i bez skrajnych kresek. Kolumny
 * wyrównane spacjami („Nazwisko i imię   PESEL") dopiero, gdy wiersz nie ma innego separatora.
 */
function tableDelim(header: string): string {
  if (header.includes('|')) return '|';
  if (header.includes('\t')) return '\t';
  if (header.includes(';')) return ';';
  if (header.includes(',')) return ',';
  return /\S {2,}\S/.test(header) ? '  ' : '';
}
export function passDelimitedTable(ctx: RedactCtx): void {
  const t = ctx.text;
  if (!/[;,\t|]|\S {2,}\S/.test(t)) return;
  const parts = t.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  let changed = false;
  const structMask = structMasker(ctx);
  for (let h = 0; h + 1 < lines.length; h++) {
    const header = lines[h];
    const delim = tableDelim(header);
    if (!delim) continue;
    const hc = splitTableRow(header, delim);
    if (!hc || hc.length < 2) continue;
    const names = hc.map((c) => header.slice(c.start, c.end).trim().replace(/^"(.*)"$/, '$1').trim());
    if (!names.every((n) => RE_TABLE_HEADER_CELL.test(n) && n.split(' ').length <= 4)) continue;
    const headKinds = names.map((n) => tableKindOf(n, ''));
    const roleGateOnly = !headKinds.some((k) => TABLE_GATE_KINDS.has(k as StructKind));
    if (roleGateOnly && !headKinds.some((k, i) => k === 'person' && TABLE_PERSON_HEADERS.has(normStructKey(names[i])))) continue;
    // Sama kolumna imienia bez innej danej osoby („Imię;Data imienin") to kalendarz albo statystyka
    // imion, w której przedmiotem jest nazwa.
    if (headKinds.every((k) => !k || k === 'first' || k === 'city')) continue;
    // Wiersz „---" pod nagłówkiem (Markdown) jest opcjonalny.
    let r = h + (delim === '|' && RE_MD_RULE.test(lines[h + 1]) ? 2 : 1);
    // Najpierw cała tabela: wiersz z osobą spoza słowników potwierdza kolumna, w której inny wiersz
    // ma imię albo nazwisko ze słownika.
    const rows: TableRow[] = [];
    for (; r < lines.length; r++) {
      const line = lines[r];
      if (!line.trim()) break;
      const cells = splitTableRow(line, delim);
      if (!cells || cells.length !== hc.length) break;
      const texts = cells.map((c) => line.slice(c.start, c.end));
      // przecinek bez spacji po separatorze („Dzień dobry, przesyłam listę.") to proza, nie wiersz
      if (delim === ',' && texts.some((x, i) => i > 0 && /^ /.test(x))) break;
      const values = texts.map((raw) => {
        const q = /^([ \t]*"?)(.*?)("?[ \t]*)$/.exec(raw) as RegExpExecArray;
        return q[1].endsWith('"') !== q[3].startsWith('"') ? raw.trim() : q[2];
      });
      // Kolejny nagłówek zaczyna nową tabelę: kolumny poprzedniej przestają obowiązywać, a ten wiersz
      // bada pętla zewnętrzna.
      if (rowLooksLikeHeader(values)) break;
      if (RE_TABLE_SUMMARY_ROW.test(values.find((v) => v.trim()) ?? '')) continue;
      const kinds = values.map((v, i) => tableKindOf(names[i], v));
      if (values.some((v, i) => tablePersonCell(kinds[i]) && tableProseCell(v))) continue;
      // Komórki osoby maskujemy w wierszu, w którym choć jedna jest potwierdzona słownikiem albo
      // morfologią: „Oddział⇥Kardiologia" pod „Nazwisko⇥Imię" to opis.
      const rowDatum = tableRowPersonDatum(values, kinds);
      const personOk = values.some((v, i) => {
        if (!tablePersonCell(kinds[i]) || tableOfficeCell(v) || tablePositionCell(v, rowDatum)) return false;
        if (tableRoleColumn(names[i], v)) return tableRolePersonCell(v);
        const ws = v.trim().split(/ +/);
        // dzień albo miesiąc małą literą („Dzień Matki;maj") to kalendarz, nie nazwisko „Maj"
        return ws.some((w) => isFirstNameLike(w) || (isConfirmedSurname(w) && !(/^\p{Ll}/u.test(w) && TSV_NOT_SURNAME.has(w))));
      });
      rows.push({ r, cells, texts, values, kinds, personOk, datum: rowDatum });
    }
    // Osoba spoza słowników („Zych Natan”) wystarcza w tabeli, w której inny wiersz ma osobę ze
    // słownika, jeśli każda jej komórka ma kształt imienia i nazwiska.
    const tableConfirmed = rows.some((row) => row.personOk);
    for (const { r: ri, cells, texts, values, kinds, personOk: dictOk, datum: rowDatum } of rows) {
      const line = lines[ri];
      const personCells = values.flatMap((v, i) => (tablePersonCell(kinds[i]) && v.trim() && !isEmptyFormValue(v.trim()) ? [i] : []));
      const datum = tableConfirmed && !dictOk && rowDatum;
      const personOk = dictOk || (tableConfirmed && personCells.length > 0 && personCells.every((i) => tableNameShapedCell(values[i], kinds[i], datum)));
      // Tabela, którą otworzył tylko nagłówek roli („Najemca;Lokal;Telefon”): wiersz bez osoby to
      // podmiot, a jego telefon, NIP i adres należą do niego.
      if (roleGateOnly && !personOk) continue;
      // Wiersz instytucji („Urząd Miasta,Łódź") zostaje, ale tylko z wyrazem instytucji w komórce
      // osoby: obce imię spoza słownika („Liu Wei;Lipowa 5") nie potwierdza osoby, a jego adres dalej
      // jest daną osoby.
      if (!personOk && values.some((v, i) => tablePersonCell(kinds[i]) && tableOrgCell(v))) continue;
      // Tak samo wiersz stanowiska („Sołtys Zalesia | 54 288 00 01”): telefon funkcji, nie osoby.
      if (!personOk && values.some((v, i) => tablePersonCell(kinds[i]) && tablePositionCell(v, rowDatum))) continue;
      if (values.some((v, i) => tablePersonCell(kinds[i]) && RE_TABLE_SACRAL_CELL.test(v))) continue;
      // Wiersz bez osoby („Wakat;-;Warszawa") nie ma czyjego adresu. Obce imię spoza słownika dalej
      // wygląda na osobę: każda niepusta komórka osoby z wielkiej litery i bez roli.
      const personVals = values.map((v, i) => (tablePersonCell(kinds[i]) ? v.trim() : '')).filter((v) => v && !isEmptyFormValue(v));
      const personPlausible =
        personOk ||
        personVals.some((v) => v.startsWith(MASK.IMIE) || v.startsWith('[OSOBA')) ||
        (personVals.length > 0 && personVals.every((v) => /^\p{Lu}/u.test(v) && !tableOfficeCell(v) && !v.split(/ +/).some((w) => isPersonRoleValue(w.toLowerCase()))));
      let out = '';
      let last = 0;
      // W trybie pseudonimów imię z osobnej kolumny dostaje pseudonim osoby z kolumny nazwiska tego
      // wiersza. Kolumna innej osoby („Imię matki") go nie dostaje.
      const surCells = values.filter((v, i) => kinds[i] === 'surname' && !RE_TABLE_OTHER_PERSON_COL.test(names[i]) && /^\p{Lu}[\p{L}-]+$/u.test(v.trim()) && !isEmptyFormValue(v.trim()) && !isPersonRoleValue(v.trim().toLowerCase()));
      const rowSur = ctx.pseudonyms && surCells.length === 1 ? surCells[0].trim() : '';
      let personMask = '';
      cells.forEach((c, i) => {
        const raw = texts[i];
        const value = values[i];
        const kind = kinds[i];
        if (!kind) return;
        // Wyraz roli z wielkiej litery w wierszu z daną człowieka („Marszałek Wit” z datą urodzenia)
        // jest nazwiskiem.
        const roleWord = (w: string): boolean => isPersonRoleValue(w.toLowerCase()) && !(rowDatum && /^\p{Lu}\p{Ll}/u.test(w));
        if (tablePersonCell(kind) && (!personOk || tableOfficeCell(value) || tablePositionCell(value, rowDatum) || value.trim().split(/ +/).some((w) => roleWord(w) || STRUCT_KEYS.has(normStructKey(w))))) return;
        if (kind === 'addr' && RE_ADDR_WITH_POSTAL.test(value)) return;
        if ((kind === 'addr' || kind === 'city') && !personPlausible && kinds.some(tablePersonCell)) return;
        let mask = structMask(kind, value, names[i]);
        if (mask === null) return;
        if (rowSur && kind === 'first' && !RE_TABLE_OTHER_PERSON_COL.test(names[i]) && /^\p{Lu}\p{Ll}+$/u.test(value.trim()) && mask === ctx.M.IMIE) mask = ctx.personMask(rowSur);
        const at = c.start + raw.indexOf(value);
        out += line.slice(last, at) + mask;
        last = at + value.length;
        if (tablePersonCell(kind)) personMask ||= mask;
      });
      if (last) {
        lines[ri] = out + line.slice(last);
        changed = true;
      }
      // Imię i nazwisko tego wiersza znika przed przebiegiem zdrowia, a przy osobie z tabeli
      // („Kowalska Anna | zapomoga: choroba nowotworowa”) jest ono kotwicą danej o zdrowiu.
      if (personMask) {
        ctx.tablePersonRows ??= { lines: lines.length, rows: new Map() };
        ctx.tablePersonRows.rows.set(ri, personMask);
      }
    }
    h = r - 1;
  }
  if (!changed) return;
  ctx.text = parts.map((p, i) => (i % 2 === 0 ? lines[i / 2] : p)).join('');
}
