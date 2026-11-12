import { isAsciiSurname, looksLikeSurname, surnameBase } from '../surnames.js';
import { type RedactCtx, URL_SENTINEL_CLOSE, URL_SENTINEL_OPEN } from '../context.js';
import { FORM_LABEL_WORDS, isEmptyFormValue, isPropagatableLogin, isSystemAccount, isValidFormValue, loginUserPart, RE_BUILTIN_ACCOUNT, RE_DATE_VALUE, RE_PROPER_WORDS, RE_WELL_KNOWN_ACCOUNT } from '../dict/forms.js';
import { isFirstNameLike } from '../dict/names.js';
import { ORG_HEAD_WORDS } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS } from '../guards/roles.js';
import { PLATE_VOIV_LETTERS, plateYearEndsList, RE_PLATE_ACRONYM_HEAD } from './documents.js';
import { isConfirmedSurname, isPersonRoleValue, lowercaseNameLooksLikePerson, PERSON_CATEGORY_VALUES, RE_LOWER_NOT_SURNAME, RE_VALUE_TITLE_OR_INITIAL, SURNAME_PARTICLES } from './forms.js';
import { TSV_NOT_SURNAME, tsvSurnameProof } from './person-pairs.js';
import { normStructKey, STRUCT_KEYS, STRUCT_KIND_TYPE, type StructKind, structKindOf } from '../struct-keys.js';
import { isValidIban } from '../validators.js';


// Rola albo rzeczownik, który jest też częstym nazwiskiem („Marszałek", „Wójt", „Dziadek", „Koło")
// — pod kluczem „osoba"/„person" wartość z wielkiej litery to wtedy nazwisko, nie rola.
const ROLE_HOMOGRAPH_SURNAMES = new Set<string>('marszałek wójt dziadek dziekan komornik król starosta koło kowal'.split(' '));
const RE_EVENT_DATA_NAME = /\sName\s*=\s*["']([\p{L}_][\p{L}\p{N}_.-]{0,40})["']/u;
// Otwarty tag z atrybutami (każdy atrybut zaczyna się literą, wartość w cudzysłowie — podział jednoznaczny).
const RE_XML_TAG_WITH_ATTRS =
  /<[\p{L}_][\p{L}\p{N}_.:-]{0,40}(?:[ \t\r\n]+[\p{L}_][\p{L}\p{N}_.:-]{0,40}[ \t]*=[ \t]*(?:"[^"<>\r\n]{0,80}"|'[^'<>\r\n]{0,80}'))+[ \t\r\n]*\/?>/gu;
const RE_XML_ATTR = /([\p{L}_][\p{L}\p{N}_.:-]{0,40})([ \t]*=[ \t]*)(["'])([^"'<>\r\n]{1,80})\3/gu;
const RE_XML_INSTITUTION_TAG =
  /^<(?:[\p{L}_][\p{L}\p{N}_.-]*:)?(?:urzad|urząd|sad|sąd|oddzial|oddział|szkola|szkoła|bank|organ|instytucja|jednostka|podmiot|placowka|placówka|organizacja)|[ \t\r\n](?:nazwa|bank|patron|organ|urzad|urząd|siedziba)[ \t]*=/iu;
const RE_XML_PERSON_ATTR =
  /[ \t\r\n](?:imie|imię|imiona|nazwisko|first[_-]?name|last[_-]?name|given[_-]?name|surname|full[_-]?name|pesel)[ \t]*=/iu;
// Atrybut XML z kluczem osobowym bywa ustawieniem szablonu albo schematu: „imie="tak"", „nazwisko=
// "rosnąco"", „imie="false"", przykładowa wartość „imie="Imię" nazwisko="Nazwisko"" czy „imie="Wójt"
// nazwisko="Gminy"". Tu wartość musi mieć kształt nazwy własnej (wielka litera na początku każdego
// wyrazu) i nie może być nazwą pola, rolą, urzędem ani wypełniaczem.
// Nazwisko-homograf roli („nazwisko="Marszałek"") zostaje nazwiskiem jak pod kluczem „osoba".
const XML_ATTR_NAME_STOP = new Set<string>(
  (
    'danych dane brak test testowy testowa przykład przykładowy przykładowa string true false referatu wydziału działu biura sekretariatu ' +
    // podmioty państwowe i zbiorowe („nazwisko="Skarb Państwa"", „fullName="Lasy Państwowe"")
    'skarb państwa państwowe państwowy państwowa lasy wspólnota mieszkaniowa'
  ).split(' '),
);
function xmlAttrNameValue(value: string, kind: StructKind): boolean {
  const v = value.trim();
  if (!RE_PROPER_WORDS.test(v) || RE_TABLE_REGNAL_CELL.test(v)) return false;
  const ws = v.split(/[ \t]+/);
  if (kind === 'surname' && ws.length === 1 && ROLE_HOMOGRAPH_SURNAMES.has(ws[0].toLowerCase())) return true;
  return ws.every((w) => {
    const l = w.toLowerCase();
    return !XML_ATTR_NAME_STOP.has(l) && !STRUCT_KEYS.has(normStructKey(w)) && !ROLE_WORDS.has(l) && !LEGAL_ENTITY_WORDS.has(l) && !FORM_LABEL_WORDS.has(l) && !isPersonRoleValue(l);
  });
}
/** Maska wartości pod kluczem strukturalnym (wspólna dla XML, JSON i nagłówka tabeli) — z bramką
 *  kształtu danego rodzaju; `null`, gdy wartość nie wygląda na daną tego rodzaju. */
/**
 * Klucz osoby (nazwisko) z wartości pola struktury. Rozstrzyga słownik imion („Domański Witold" →
 * Domański, „Witold Domański" → Domański), a gdy nie rozstrzyga — szyk z nagłówka („Nazwisko
 * i imię" → pierwszy wyraz). Dawniej kluczem był zawsze ostatni wyraz: w szyku „Nazwisko Imię"
 * było nim imię, więc dwie osoby o tym samym imieniu dostawały jeden pseudonim, a ta sama osoba
 * w tabeli i w prozie — dwa różne.
 */
function structSurnameKey(ws: string[], key?: string): string {
  const last = ws[ws.length - 1];
  if (ws.length < 2) return last;
  const fnF = isFirstNameLike(ws[0]);
  const fnL = isFirstNameLike(last);
  // Klucz w szyku „imię naprzód" („imieNazwisko", „Imię i nazwisko", „firstName…"): nazwisko-homograf
  // imienia na końcu („Iryna Roman", „Tetiana Marek") zostaje kluczem, chyba że pierwszy wyraz to
  // potwierdzone nazwisko (wpis odwrócony „Kowalski Jan"). Inaczej kluczem było obce imię spoza
  // słownika i dwie osoby o tym samym imieniu dostawały jeden pseudonim.
  // To samo pod kluczem bez szyku („fullName", „full_name", „osoba", „<fullName>"): szyk „Nazwisko
  // Imię" rozpoznaje tam dopiero potwierdzone nazwisko na początku, a obce imię („Iryna", „Halyna")
  // kluczem nie zostaje. Tylko klucz „nazwisko…" wskazuje szyk odwrotny.
  if (fnL && !fnF && key && !normStructKey(key).startsWith('nazwisk') && !isConfirmedSurname(ws[0])) return last;
  if (fnL && !fnF) return ws[0];
  if (fnF) return last;
  return key && normStructKey(key).startsWith('nazwisko') ? ws[0] : last;
}
function structMasker(ctx: RedactCtx): (kind: StructKind, value: string, key?: string) => string | null {
  return (kind: StructKind, value: string, key = ''): string | null => {
    const v = value.trim();
    if (!v || v.length > 70 || /[[\]]/.test(v) || v.includes(URL_SENTINEL_OPEN) || v.includes(URL_SENTINEL_CLOSE)) return null;
    if (isEmptyFormValue(v)) return null;
    switch (kind) {
      case 'first':
      case 'surname':
      case 'fullname':
        if (!isValidFormValue(v, 'name')) return null;
        break;
      case 'name':
      case 'person': {
        // generyczny „name" (i „osoba"/„person") bywa nazwą produktu, firmy albo kategorią. Zapis
        // małymi literami („Róża pustyni" pod „name", „<osoba>prawna</osoba>") przechodzi tylko,
        // gdy wygląda na osobę (lowercaseNameLooksLikePerson) — dopuszczenie małych liter (v0.46.15)
        // było dla MOCNYCH kluczy („firstName", „Imię:").
        if (!isValidFormValue(v, 'name')) return null;
        const ws = v.split(/\s+/);
        // partykuła, tytuł i inicjał małą literą nie odbierają wartości charakteru nazwy własnej
        // („Jan van Dijk", „dr Gzik", „lek. Gzik")
        const proper = ws.filter((w) => !SURNAME_PARTICLES.has(w) && !(/^\p{Ll}/u.test(w) && RE_VALUE_TITLE_OR_INITIAL.test(w)));
        if (!proper.length || !RE_PROPER_WORDS.test(proper.join(' '))) {
          // „osoba"/„person" małymi literami: jeden wyraz o kształcie nazwiska, który nie jest rolą
          // ani kategorią („gzik", „dr gzik" — ale „prawna", „fizyczna" zostają)
          const own = proper.map((w) => w.toLowerCase());
          if (kind === 'person' && own.length === 1 && own[0].length >= 3 && !RE_LOWER_NOT_SURNAME.test(own[0]) && !isPersonRoleValue(own[0])) break;
          if (!lowercaseNameLooksLikePerson(ws)) return null;
          break;
        }
        // „osoba"/„person" od wielkiej litery to osoba jak pod „fullname" — także szyk „NAZWISKO IMIĘ",
        // WERSALIKI, homograf i rzadkie nazwisko („Wróbel Anna", „KOWALSKI JAN", „T. Gzik", „Gzik",
        // „Smith"). Zostaje kategoria („Prawna", „Osoba Fizyczna") i jeden wyraz będący rolą czy
        // odpowiedzią („Pracownik", „Klient", „Wnioskodawca", „Admin"). Dawniej jeden wyraz musiał być
        // imieniem albo nazwiskiem ze słownika lub morfologii, więc rzadkie nazwisko wyciekało, choć
        // właśnie ono najbardziej identyfikuje osobę.
        if (kind === 'person') {
          if (ws.every((w) => PERSON_CATEGORY_VALUES.has(w.toLowerCase()))) return null;
          if (proper.length === 1 && isPersonRoleValue(proper[0].toLowerCase()) && !ROLE_HOMOGRAPH_SURNAMES.has(proper[0].toLowerCase())) return null;
          break;
        }
        // „name" od wielkiej litery: bramka słownikowa — pierwszy wyraz to imię albo ostatni to nazwisko
        const last = ws[ws.length - 1];
        if (!isFirstNameLike(ws[0]) && !surnameBase(last) && !looksLikeSurname(last)) return null;
        break;
      }
      case 'city':
        if (!isValidFormValue(v, 'place')) return null;
        break;
      case 'addr':
        if (!isValidFormValue(v, 'addr')) return null;
        break;
      case 'phone':
        if ((v.match(/\d/g) ?? []).length < 6 || /[A-Za-z]{3,}/.test(v)) return null;
        // data w kolumnie telefonu to stopka eksportu („Stan na;;01.10.2026", „Wydruk z dnia⇥⇥2026-10-01")
        if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return null;
        break;
      case 'postal':
        if (!/^\d{2}[- ]?\d{3}$/.test(v)) return null;
        break;
      case 'birth':
        if (!RE_DATE_VALUE.test(v)) return null;
        break;
      case 'login':
        // Zapis Windows/AD „DOMENA\użytkownik" (w JSON-ie „\\") maskujemy w całości — dawniej
        // cała wartość wyciekała. Wbudowane konta systemowe zostają.
        if (!/^(?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._@-]{1,63}$/.test(v)) return null;
        if (RE_BUILTIN_ACCOUNT.test(v) || RE_WELL_KNOWN_ACCOUNT.test(v)) return null;
        // Atrybuty AD i dziennika zdarzeń: wbudowane konta („Administrator", „krbtgt", „Guest")
        // to w audycie bezpieczeństwa informacja, nie dana osobowa. Nazwisko z wielkiej litery
        // („Lewandowski") zostawiamy FAZIE 4 — inaczej osoba traci etykietę [OSOBA-X].
        if (/^(?:samaccountname|targetusername|subjectusername)$/i.test(key)) {
          const user = loginUserPart(v);
          if (isSystemAccount(user) || (/^[A-Z][a-z]+$/.test(user) && isAsciiSurname(user))) return null;
        }
        // ta sama wartość pada zwykle w treści obok („Konto a.kaminska zablokowane", „/home/jwozniak")
        if (ctx.on('LOGIN')) {
          const user = loginUserPart(v);
          if (isPropagatableLogin(user)) ctx.loginSeeds.add(user);
        }
        break;
      case 'email':
        if (!/\S(?:@|%40|\(at\))\S/i.test(v)) return null;
        break;
      case 'pesel':
        if (!/^\d(?:[ -]?\d){10}$/.test(v)) return null;
        break;
      case 'nip':
        if (!/^(?:PL[- ]?)?\d(?:[ -]?\d){9}$/.test(v)) return null;
        break;
      case 'regon':
        if (!/^\d(?:[ -]?\d){8}(?:(?:[ -]?\d){5})?$/.test(v)) return null;
        break;
      // Dokumenty: ten sam kształt wartości co w prozie — klucz jest kotwicą, kształt chroni przed
      // „brak", „kat. B" czy numerem zamówienia pod mylącym kluczem.
      case 'passport':
        if (!/^[A-Za-z]{2}[\s-]?\d{7}$/.test(v)) return null;
        break;
      case 'idcard':
        if (!/^[A-Za-z]{3}[\s-]?\d{6}$/.test(v)) return null;
        break;
      case 'krs':
        if (!/^\d{10}$/.test(v)) return null;
        break;
      case 'license':
        if (!/^(?=[A-Za-z0-9/ -]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3}$/.test(v)) return null;
        // rok albo data uzyskania uprawnień („"prawoJazdy": "2010"", „"2010-05-12"") to nie numer dokumentu
        if (/^(?:\d{1,4}|\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})$/.test(v)) return null;
        break;
      case 'plate':
        // wyróżnik WIELKIMI literami z literą województwa i cyfra w numerze („WE12345", „KR 3AB12",
        // „WPI KC27"); „nrRej": „000012345" (rejestr BDO) i nazwa modelu odpadają
        if (!/^(?:[A-Z]{2,3}[\s-]?(?=[A-Z0-9]{0,4}\d)[A-Z0-9]{4,5}|[A-Z]{3}[\s-]?[A-Z]{2}\d{2})$/.test(v)) return null;
        if (!PLATE_VOIV_LETTERS.includes(v[0]) || !RE_PLATE_ACRONYM_HEAD.test(v)) return null;
        // skrót z rokiem („"tablica": "ZP 2026"") — jak w wyliczeniu prozy. Klucz z „rej"
        // („nrRejestracyjny", „nr_rej") to etykieta pola, jak „Nr rejestracyjny:" w prozie — tam
        // „RPO 2024" jest wartością pola, czyli tablicą.
        if (!/rej/i.test(key) && plateYearEndsList(v)) return null;
        break;
      case 'account': {
        // dokładnie 26 cyfr NRB (opcjonalnie z „PL"), bez sumy kontrolnej — kotwicą jest klucz, jak
        // etykieta „rachunek:" w prozie. „rachunek": „R/2026/001" (faktura) czy „konto": „201-01"
        // (konto księgowe) odpadają na kształcie. Numer z poprawną sumą zostawiamy przebiegom
        // IBAN/NRB — dają tę samą maskę co dotąd, a tu łapiemy tylko numer z literówką.
        if (!/^(?:PL[ ]?)?\d(?:[ -]?\d){25}$/.test(v)) return null;
        const digits = v.replace(/\D/g, '');
        // same zera czy jedna cyfra powtórzona to wypełniacz szablonu, nie numer
        if (/^(\d)\1+$/.test(digits) || isValidIban(`PL${digits}`)) return null;
        break;
      }
    }
    const type = STRUCT_KIND_TYPE[kind];
    if (!ctx.on(type)) return null;
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
  // XML: <Tag>wartość</Tag> (tag może mieć atrybuty; wartość jednoliniowa, bez zagnieżdżeń).
  // Prefiks przestrzeni nazw („<etd:Nazwisko>", „<ns2:Imie>", „<tns:Ulica>") — w plikach
  // e-Deklaracji, JPK i ePUAP to norma, a dawniej żaden taki tag nie był kotwicą. Tag zamykający
  // musi powtórzyć pełną nazwę z prefiksem (\2), klucz szukamy po części lokalnej. Litery spoza
  // ASCII w nazwie („<Miejscowość>", „<Imię>") — wpisy słownika z ogonkami były martwe.
  ctx.text = ctx.text.replace(
    /(<((?:[\p{L}_][\p{L}\p{N}_.-]{0,20}:)?[\p{L}_][\p{L}\p{N}_.-]{0,40})(?:\s[^<>]*)?>)([^<>\r\n]{1,70})(<\/\s*\2\s*>)/gu,
    (m, open: string, tag: string, value: string, close: string) => {
      // Dziennik zdarzeń Windows: nazwą pola jest atrybut („<Data Name="TargetUserName">tnowicki</Data>"),
      // a sam tag „Data" niczego nie mówi.
      const local = tag.slice(tag.indexOf(':') + 1);
      const attr = /^data$/i.test(local) ? RE_EVENT_DATA_NAME.exec(open)?.[1] : undefined;
      const key = attr ?? local;
      const kind = structKindOf(key, value);
      // z atrybutu bierzemy tylko konto: „<Data Name="Name">Kowalski</Data>" maskuje FAZA 4,
      // która w trybie pseudonimów daje tej osobie tę samą etykietę co w reszcie dokumentu
      if (!kind || (attr && kind !== 'login')) return m;
      const mask = structMask(kind, value, key);
      return mask === null ? m : `${open}${mask}${close}`;
    },
  );
  // XML: atrybuty w otwartym tagu („<Pelnomocnik imie="Piotr" nazwisko="Lewandowski"
  // dataUrodzenia="1978-01-09"/>", „<Adres ulica="Ogrodowa 8" miasto="Kalisz"/>") — w eksportach
  // e-Deklaracji, ePUAP i systemów dziedzinowych dane osoby stoją w atrybutach, a nie w treści tagu.
  // Tylko klucze jednoznacznie osobowe: generyczne „name"/„osoba" w atrybucie to zwykle nazwa pola
  // schematu albo kategoria („<xs:element name="Nazwisko"/>", „<input name="imie">", „<Podmiot
  // osoba="prawna"/>").
  // Tag instytucji („<Urzad nazwa="Urząd Skarbowy" ulica=… telefon=…/>", „<szkola patron=…
  // miasto=…/>") bez atrybutu osoby: adres, telefon i siedziba należą do urzędu, nie do człowieka.
  // „<Adres ulica=… miasto=…/>" pod osobą zostaje kotwicą (tag adresu nie jest instytucją).
  ctx.text = ctx.text.replace(RE_XML_TAG_WITH_ATTRS, (m: string) => {
    const inst = RE_XML_INSTITUTION_TAG.test(m) && !RE_XML_PERSON_ATTR.test(m);
    return m.replace(RE_XML_ATTR, (a, key: string, eq: string, q: string, value: string) => {
      const kind = structKindOf(key, value);
      if (!kind || kind === 'name' || kind === 'person' || kind === 'login') return a;
      if (inst && ['addr', 'city', 'phone', 'postal', 'email'].includes(kind)) return a;
      // adres z kodem i miejscowością w jednym atrybucie — kod i miasto mają własne maski
      if (kind === 'addr' && /\d{2}-\d{3}(?!\d)/.test(value)) return a;
      if ((kind === 'first' || kind === 'surname' || kind === 'fullname') && !xmlAttrNameValue(value, kind)) return a;
      const mask = structMask(kind, value, key);
      return mask === null ? a : `${key}${eq}${q}${mask}${q}`;
    });
  });
  // JSON: "klucz": "wartość" — maskowana sama wartość między cudzysłowami. Także JSON zagnieżdżony
  // w łańcuchu („"payload":"{\"imie\":\"Jadwiga\"}"): poziom ucieczki cudzysłowu (grupa 2) jest
  // wspólny dla klucza i wartości, a wartość nie może zawierać cudzysłowu z tego poziomu — inaczej
  // zewnętrzny klucz brał „{\" za wartość i zjadał otwarcie pierwszego klucza wewnętrznego.
  // (?<!\\) — start na początku ciągu backslashy (jeden start na ciąg, czas liniowy).
  // Klucz z ogonkami i spacją („"Imię"", „"Data urodzenia"", „"first name"") jak w tagu XML.
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

// ── TABELA Z NAGŁÓWKIEM (CSV, TSV, Markdown) ─────────────────────────────────
// Nagłówek kolumny („imie;nazwisko;pesel", „Nr rejestracyjny\tMarka", „| Imię | Nazwisko |") to
// kotwica jak klucz JSON: w eksportach kadrowych, flotowych i z systemów dziedzinowych wartości
// stoją w wierszach pod nim, bez etykiety przy każdej, więc proza łapała tylko to, co ma sumę
// kontrolną. Kotwicą jest CAŁY wiersz nagłówka złożony z samych nazw pól, a tabelą dopiero taki,
// w którym jedna z kolumn wskazuje osobę albo jej dokument (GATE): „city,population" czy
// „id,name,category" to dane o mieście i produkcie, nie o człowieku.
const TABLE_GATE_KINDS = new Set<StructKind>(['first', 'surname', 'fullname', 'pesel', 'birth', 'plate', 'passport', 'idcard', 'license']);
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
const tableCellText = (line: string, c: TableCell): string => line.slice(c.start, c.end);
// Nazwy kolumn spoza STRUCT_KEYS, które w wierszu danych osoby nie występują.
const TABLE_GENERIC_HEADERS = new Set<string>(
  (
    'lp produkt towar usługa cena ilość ilosc jednostka kwota wartość wartosc suma status termin ' +
    'opis uwagi nazwa typ rodzaj kategoria liczba data godzina stanowisko dział dzial oddział ' +
    'pokój pokoj kod symbol stawka netto brutto vat waluta priorytet etap wynik'
  ).split(' '),
);
function rowLooksLikeHeader(values: string[]): boolean {
  const cells = values.map((v) => v.trim()).filter((v) => v);
  if (cells.length < 2 || cells.some((v) => /\d/.test(v) || !RE_TABLE_HEADER_CELL.test(v))) return false;
  const known = cells.filter((v) => STRUCT_KEYS.has(normStructKey(v)) || TABLE_GENERIC_HEADERS.has(v.toLowerCase())).length;
  return known >= 2 && known * 2 >= cells.length;
}
// Komórki biura i podmiotu państwowego w kolumnie osoby („Sekretariat Wójta;-;41 378 00 10",
// „Centrala", „Skarb Państwa", „Lasy Państwowe") — wiersz instytucji, jego telefon i siedziba
// nie są danymi osoby.
const TABLE_ORG_EXTRA_WORDS = new Set<string>(
  (
    'sekretariat centrala biuro dyżur recepcja kancelaria informacja punkt dziekanat portiernia dział ' +
    'wydział referat kasa skarb państwa państwowe państwowy państwowa wspólnota mieszkaniowa lasy'
  ).split(' '),
);
// Nazwa kolumny z danymi INNEJ osoby niż ta z wiersza (rodzic, opiekun, małżonek, osoba kontaktowa).
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
// Podmiot kościelny w kolumnie osoby („Parafia św. Józefa", „Kościół św. Anny", „Parafia
// Rzymskokatolicka pw. Św. Jana") — imię świętego „potwierdzało" osobę, a to wiersz instytucji.
// Także po wcześniejszej masce w komórce: „pw."/„św." zostają wtedy jawne.
const RE_TABLE_SACRAL_CELL =
  /^[ \t]*(?:parafi\p{L}*|kości[oe]ł\p{L}*|kaplic\p{L}*|klasztor\p{L}*|zgromadzeni\p{L}*|diecezj\p{L}*|sanktuari\p{L}*|bazylik\p{L}*|katedr\p{L}*|caritas)(?!\p{L})|(?<!\p{L})(?:pw|św|bł)\.[ \t]*\p{Lu}/iu;
// Władca albo papież z liczbą porządkową w komórce osoby („Jan Paweł II,Patron") — jak w prozie.
const RE_TABLE_REGNAL_CELL =
  /^\p{Lu}\p{Ll}+(?:[ \t]+\p{Lu}\p{Ll}+)?[ \t]+(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI)$/u;
// Urząd albo funkcja-homograf nazwiska sama w komórce osoby („3;Sołtys;Lubień 1;", „Ławnik;Lubień 2")
// to wiersz roli z listy obecności zebrania wiejskiego czy wykazu składu: bez osoby i bez jej
// adresu. Para z imieniem („Jan Sołtys") dalej jest osobą.
const TABLE_OFFICE_WORDS = new Set<string>(
  'sołtys sołtyska starosta ławnik ławniczka radny radna skarbnik sekretarz woźny woźna kasjer kasjerka opiekun opiekunka przewodniczący przewodnicząca'.split(' '),
);
const tableOfficeCell = (v: string): boolean => TABLE_OFFICE_WORDS.has(v.trim().toLowerCase());
// Przyimek jako osobny wyraz komórki osoby („wyjazd w maju", „WYJAZD W MAJU") — zdanie, nie osoba.
const RE_TABLE_PROSE_PREP = /^(?:w|we|na|do|od|po|przy|dla|o|u|za|ze|pod|nad|przed|bez|oraz)$/i;
const RE_TABLE_SUMMARY_ROW =/^[ \t]*(?:razem|suma|ogółem|łącznie|wszyscy|wszystkie|podsumowanie|stan[ \t]+na|wydruk|wygenerowano|total)(?![\p{L}])/iu;
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
    const names = hc.map((c) => tableCellText(header, c).trim().replace(/^"(.*)"$/, '$1').trim());
    if (!names.every((n) => RE_TABLE_HEADER_CELL.test(n) && n.split(' ').length <= 4)) continue;
    const headKinds = names.map((n) => STRUCT_KEYS.get(normStructKey(n)));
    if (!headKinds.some((k) => TABLE_GATE_KINDS.has(k as StructKind))) continue;
    // Sama kolumna imienia bez innej danej osoby („Imię;Data imienin", „Imię,Liczba nadań",
    // „Imię,Płeć,Pochodzenie") to kalendarz albo statystyka imion, w której przedmiotem jest nazwa.
    if (headKinds.every((k) => !k || k === 'first' || k === 'city')) continue;
    let r = h + (md ? 2 : 1);
    for (; r < lines.length; r++) {
      const line = lines[r];
      if (!line.trim()) break;
      const cells = splitTableRow(line, delim, md);
      if (!cells || cells.length !== hc.length) break;
      const texts = cells.map((c) => tableCellText(line, c));
      // CSV z przecinkiem bez spacji po separatorze: „Dzień dobry, przesyłam listę." pod
      // nagłówkiem „imie,nazwisko" to proza, nie wiersz tabeli
      if (delim === ',' && texts.some((x, i) => i > 0 && /^ /.test(x))) break;
      const values = texts.map((raw) => {
        const q = /^([ \t]*"?)(.*?)("?[ \t]*)$/.exec(raw) as RegExpExecArray;
        return q[1].endsWith('"') !== q[3].startsWith('"') ? raw.trim() : q[2];
      });
      // Kolejny nagłówek o tej samej liczbie kolumn („Produkt,Cena,Ilość") zaczyna nową tabelę:
      // kolumny poprzedniej przestają obowiązywać, a od tego wiersza nagłówek bada pętla zewnętrzna.
      if (rowLooksLikeHeader(values)) break;
      // Wiersz podsumowania albo stopka eksportu („Razem działów⇥Wszyscy", „Stan na;;01.10.2026").
      if (RE_TABLE_SUMMARY_ROW.test(values.find((v) => v.trim()) ?? '')) continue;
      const kinds = values.map((v, i) => structKindOf(names[i], v));
      // Komórki osoby maskujemy tylko w wierszu, w którym choć jedna z nich jest potwierdzona
      // (imię ze słownika, nazwisko ze słownika, morfologii albo homograf). Wiersz „Oddział⇥Kardiologia"
      // pod „Nazwisko⇥Imię" to opis, a nazwa pola („Imię⇥Imię pracownika") nigdy nie jest osobą.
      const personCell = (k: StructKind | undefined): boolean => k === 'first' || k === 'surname' || k === 'fullname' || k === 'name' || k === 'person';
      // Proza pod tabelą („Wyjazd w maju; szczegóły wkrótce", „Silny mróz; zajęcia odwołane"):
      // komórka osoby z kilku wyrazów, w której obok wyrazu z wielkiej litery stoi wyraz z małej
      // spoza partykuł i tytułów — to zdanie, nie imię i nazwisko („maju" potwierdzało „imię").
      // Władca albo papież z liczbą porządkową („Jan Paweł II") też nie jest osobą z wykazu.
      // Także zdanie zaczęte małą literą albo WERSALIKAMI: przyimek jako osobny wyraz („wyjazd w maju",
      // „WYJAZD W MAJU", „spotkanie w maju") albo same małe litery z wyrazem spoza słowników imion
      // i nazwisk („silny mróz", „szczegóły wkrótce") — imię i nazwisko małymi literami („anna kowal")
      // ma oba wyrazy w słowniku.
      const proseCell = (v: string): boolean => {
        const ws = v.trim().split(/[ \t]+/);
        if (RE_TABLE_REGNAL_CELL.test(v.trim())) return true;
        if (ws.length >= 2 && ws.some((w) => RE_TABLE_PROSE_PREP.test(w))) return true;
        if (
          ws.length >= 2 &&
          ws.every((w) => /^\p{Ll}/u.test(w)) &&
          ws.some((w) => !SURNAME_PARTICLES.has(w) && !RE_VALUE_TITLE_OR_INITIAL.test(w) && !isFirstNameLike(w) && !tsvSurnameProof(w))
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
      };
      if (values.some((v, i) => personCell(kinds[i]) && proseCell(v))) continue;
      const personOk = values.some((v, i) => {
        if (!personCell(kinds[i]) || tableOfficeCell(v)) return false;
        const ws = v.trim().split(/ +/);
        // dzień albo miesiąc małą literą („Dzień Matki;maj") to kalendarz, nie nazwisko „Maj"
        return ws.some((w) => isFirstNameLike(w) || (tsvSurnameProof(w) && !(/^\p{Ll}/u.test(w) && TSV_NOT_SURNAME.has(w))));
      });
      // Wiersz instytucji w wykazie osób („Ochotnicza Straż Pożarna,Zalesie,10000", „Urząd
      // Miasta,Łódź"): siedziba to nie dana osoby, więc wiersz zostaje. Tylko z wyrazem instytucji
      // w komórce osoby: obce imię spoza słownika („Liu Wei;Lipowa 5") nie potwierdza osoby, ale
      // adres i dokument w jego wierszu dalej są danymi osoby.
      if (!personOk && values.some((v, i) => personCell(kinds[i]) && tableOrgCell(v))) continue;
      if (values.some((v, i) => personCell(kinds[i]) && RE_TABLE_SACRAL_CELL.test(v))) continue;
      // Wiersz bez osoby („Wakat;-;Warszawa", „Sala;konferencyjna;Gdańsk") nie ma czyjego adresu ani
      // miejscowości. Obce imię spoza słownika („Liu;Wei;Lipowa 5") dalej wygląda na osobę: każda
      // niepusta komórka osoby z wielkiej litery i bez roli.
      const personVals = values.map((v, i) => (personCell(kinds[i]) ? v.trim() : '')).filter((v) => v && !isEmptyFormValue(v));
      const personPlausible =
        personOk ||
        personVals.some((v) => /^\[(?:IMIĘ|OSOBA)/.test(v)) ||
        (personVals.length > 0 && personVals.every((v) => /^\p{Lu}/u.test(v) && !tableOfficeCell(v) && !v.split(/ +/).some((w) => isPersonRoleValue(w.toLowerCase()))));
      let out = '';
      let last = 0;
      // Tryb pseudonimów: imię w osobnej kolumnie („Nazwisko⇥Imię", „Adamczyk⇥Julia") dostaje
      // pseudonim osoby z kolumny nazwiska tego samego wiersza, nie ogólną etykietę obok [OSOBA-A].
      // Kolumna innej osoby („Imię matki", „Imię ojca", „Nazwisko panieńskie matki", „mother_name")
      // nie dostaje pseudonimu osoby z wiersza — dawniej matka i ojciec dostawali pseudonim syna.
      const otherPersonCol = (n: string): boolean => RE_TABLE_OTHER_PERSON_COL.test(n);
      const surCells = values.filter((v, i) => kinds[i] === 'surname' && !otherPersonCol(names[i]) && /^\p{Lu}[\p{L}-]+$/u.test(v.trim()) && !isEmptyFormValue(v.trim()) && !isPersonRoleValue(v.trim().toLowerCase()));
      const rowSur = ctx.pseudonyms && surCells.length === 1 ? surCells[0].trim() : '';
      cells.forEach((c, i) => {
        const raw = texts[i];
        const value = values[i];
        const kind = kinds[i];
        if (!kind) return;
        if (personCell(kind) && (!personOk || tableOfficeCell(value) || value.trim().split(/ +/).some((w) => isPersonRoleValue(w.toLowerCase()) || STRUCT_KEYS.has(normStructKey(w))))) return;
        // adres z kodem i miejscowością w jednej komórce („ul. Lipowa 5, 00-001 Warszawa") — kod
        // i miasto mają własne przebiegi i maski, jak w drugiej linii adresu pod kluczem JSON
        if (kind === 'addr' && /\d{2}-\d{3}(?!\d)/.test(value)) return;
        if ((kind === 'addr' || kind === 'city') && !personPlausible && kinds.some(personCell)) return;
        let mask = structMask(kind, value, names[i]);
        if (mask === null) return;
        if (rowSur && kind === 'first' && !otherPersonCol(names[i]) && /^\p{Lu}\p{Ll}+$/u.test(value.trim()) && mask === ctx.M.IMIE) mask = ctx.personMask(rowSur);
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
