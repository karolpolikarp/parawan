// Kotwice strukturalne: wartości pod kluczem XML (tag i atrybut), JSON i pod nagłówkiem tabeli
// (CSV, TSV, Markdown), z bramką kształtu dla każdego rodzaju pola.
import { isAsciiSurname, isConfirmedSurname, surnameShaped } from '../surnames.js';
import { type RedactCtx, URL_SENTINEL_CLOSE, URL_SENTINEL_OPEN } from '../context.js';
import { MASK } from '../types.js';
import { FORM_LABEL_WORDS, isEmptyFormValue, isValidFormValue, RE_DATE_VALUE, RE_PROPER_WORDS } from '../dict/forms.js';
import { TABLE_GENERIC_HEADERS, TSV_NOT_SURNAME } from '../dict/headers.js';
import { isPropagatableLogin, isSystemAccount, loginUserPart, RE_BUILTIN_ACCOUNT, RE_WELL_KNOWN_ACCOUNT } from '../dict/logins.js';
import { isFirstNameLike } from '../dict/names.js';
import { ORG_HEAD_WORDS } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS } from '../guards/roles.js';
import { PLATE_VOIV_LETTERS, plateYearEndsList, RE_PLATE_ACRONYM_HEAD } from '../guards/plates.js';
import { isPersonRoleValue, lowercaseNameLooksLikePerson, PERSON_CATEGORY_VALUES, RE_LOWER_NOT_SURNAME, RE_VALUE_TITLE_OR_INITIAL, SURNAME_PARTICLES } from '../guards/person-values.js';
import { normStructKey, STRUCT_KEYS, STRUCT_KIND_TYPE, type StructKind, structKindOf } from '../struct-keys.js';
import { isValidIban } from '../validators.js';

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
  if (fnF) return last;
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
/** Podział wiersza na komórki (zakresy w wierszu); cudzysłów CSV trzyma separator w środku.
 *  `null`, gdy wiersz ma niedomknięty cudzysłów. */
function splitTableRow(line: string, delim: string, md: boolean): TableCell[] | null {
  let from = 0;
  let to = line.length;
  if (md) {
    const lead = /^[ \t]*\|/.exec(line);
    const trail = /\|[ \t]*$/.exec(line);
    if (!lead || !trail || trail.index < lead[0].length) return null;
    from = lead[0].length;
    to = trail.index;
  }
  const cells: TableCell[] = [];
  let start = from;
  let quoted = false;
  for (let i = from; i < to; i++) {
    const ch = line[i];
    if (ch === '"' && !md) {
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
export function passDelimitedTable(ctx: RedactCtx): void {
  const t = ctx.text;
  if (!/[;,\t|]/.test(t)) return;
  const parts = t.split(/(\r?\n)/);
  const lines = parts.filter((_, i) => i % 2 === 0);
  let changed = false;
  const structMask = structMasker(ctx);
  for (let h = 0; h + 1 < lines.length; h++) {
    const header = lines[h];
    const md = /^[ \t]*\|.*\|[ \t]*$/.test(header) && RE_MD_RULE.test(lines[h + 1]);
    const delim = md ? '|' : header.includes('\t') ? '\t' : header.includes(';') ? ';' : header.includes(',') ? ',' : '';
    if (!delim) continue;
    const hc = splitTableRow(header, delim, md);
    if (!hc || hc.length < 2) continue;
    const names = hc.map((c) => header.slice(c.start, c.end).trim().replace(/^"(.*)"$/, '$1').trim());
    if (!names.every((n) => RE_TABLE_HEADER_CELL.test(n) && n.split(' ').length <= 4)) continue;
    const headKinds = names.map((n) => STRUCT_KEYS.get(normStructKey(n)));
    if (!headKinds.some((k) => TABLE_GATE_KINDS.has(k as StructKind))) continue;
    // Sama kolumna imienia bez innej danej osoby („Imię;Data imienin") to kalendarz albo statystyka
    // imion, w której przedmiotem jest nazwa.
    if (headKinds.every((k) => !k || k === 'first' || k === 'city')) continue;
    let r = h + (md ? 2 : 1);
    for (; r < lines.length; r++) {
      const line = lines[r];
      if (!line.trim()) break;
      const cells = splitTableRow(line, delim, md);
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
      const kinds = values.map((v, i) => structKindOf(names[i], v));
      if (values.some((v, i) => tablePersonCell(kinds[i]) && tableProseCell(v))) continue;
      // Komórki osoby maskujemy tylko w wierszu, w którym choć jedna jest potwierdzona słownikiem
      // albo morfologią: „Oddział⇥Kardiologia" pod „Nazwisko⇥Imię" to opis.
      const personOk = values.some((v, i) => {
        if (!tablePersonCell(kinds[i]) || tableOfficeCell(v)) return false;
        const ws = v.trim().split(/ +/);
        // dzień albo miesiąc małą literą („Dzień Matki;maj") to kalendarz, nie nazwisko „Maj"
        return ws.some((w) => isFirstNameLike(w) || (isConfirmedSurname(w) && !(/^\p{Ll}/u.test(w) && TSV_NOT_SURNAME.has(w))));
      });
      // Wiersz instytucji („Urząd Miasta,Łódź") zostaje, ale tylko z wyrazem instytucji w komórce
      // osoby: obce imię spoza słownika („Liu Wei;Lipowa 5") nie potwierdza osoby, a jego adres dalej
      // jest daną osoby.
      if (!personOk && values.some((v, i) => tablePersonCell(kinds[i]) && tableOrgCell(v))) continue;
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
      cells.forEach((c, i) => {
        const raw = texts[i];
        const value = values[i];
        const kind = kinds[i];
        if (!kind) return;
        if (tablePersonCell(kind) && (!personOk || tableOfficeCell(value) || value.trim().split(/ +/).some((w) => isPersonRoleValue(w.toLowerCase()) || STRUCT_KEYS.has(normStructKey(w))))) return;
        if (kind === 'addr' && RE_ADDR_WITH_POSTAL.test(value)) return;
        if ((kind === 'addr' || kind === 'city') && !personPlausible && kinds.some(tablePersonCell)) return;
        let mask = structMask(kind, value, names[i]);
        if (mask === null) return;
        if (rowSur && kind === 'first' && !RE_TABLE_OTHER_PERSON_COL.test(names[i]) && /^\p{Lu}\p{Ll}+$/u.test(value.trim()) && mask === ctx.M.IMIE) mask = ctx.personMask(rowSur);
        const at = c.start + raw.indexOf(value);
        out += line.slice(last, at) + mask;
        last = at + value.length;
      });
      if (last) {
        lines[r] = out + line.slice(last);
        changed = true;
      }
    }
    h = r - 1;
  }
  if (!changed) return;
  ctx.text = parts.map((p, i) => (i % 2 === 0 ? lines[i / 2] : p)).join('');
}
