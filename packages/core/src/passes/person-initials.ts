import { PERSON_MASK_SRC, PL_UP } from '../charset.js';
import type { RedactCtx } from '../context.js';
import { isFirstNameLike } from '../dict/names.js';
import { normalizeSurnameKey } from '../surnames.js';

// Inicjały osoby bez nazwiska po kotwicy odpowiedzialności w liście zadań i stopce notatki
// („(odp. AS)”, „Sporządził: MK”, „opr. A.S.”, kolumna „Odp.” w tabeli zadań). Dwie albo trzy
// wersaliki to klasa otwarta: po tych samych kotwicach stoją odpowiedzi („Odp. TAK”), badania
// („wyk. EKG”, „wyk. MR”), instytucje („oprac. PWN”, „Wykonał: ZDM”), statusy i funkcje
// („Sprawdził: NOK”, „Zatwierdził: DG”). Żadna lista wyjątków tego nie zamknie, więc gołe wersaliki
// maskujemy TYLKO wtedy, gdy są inicjałami osoby zamaskowanej w tym samym piśmie („Anna Sadowska”
// w uczestnikach → „(odp. AS)”). Zapis z kropkami („A.S.”, „A. S.”, „A.S”) ma kształt inicjałów, nie
// akronimu, więc wystarcza sama kotwica, o ile token kończy wpis: po nim nie stoi nazwa firmy
// („Wykonał: P.H.U. Remex”, „F.H.U. „Budmax””) ani nazwisko („Sporządził: A.S. Nowak”, które scala
// finalizePersons w jedną osobę). Znane ograniczenie: gołe inicjały bez pełnego imienia i nazwiska
// w piśmie („(odp. AS)” w notatce z samymi inicjałami) zostają jawne, bo bez osoby w piśmie nie da
// się ich odróżnić od skrótu.

// Skróty: „odp.” (odpowiedzialny), „wyk.”, „opr.”/„oprac.”, „sporz.”. Słowa pełne tylko z dwukropkiem
// albo myślnikiem, bo bez nich w prozie stoi po nich podmiot („projekt zatwierdził RIO”). „kontakt:”
// celowo pominięte: po nim częściej stoi dział albo infolinia („kontakt: BOK”) niż osoba.
const VERB_END = `(?:a|y|i|\\(a\\))?`;
const ANCHOR =
  `(?<![\\p{L}\\d])(?:[Oo]dp|[Ww]yk|[Oo]pr|[Oo]prac|[Ss]porz)\\.[ \\t]*:?|` +
  `(?<![\\p{L}\\d])(?:[Oo]dpowiedzialn(?:y|a|i|e)|[Oo]soba[ \\t]+odpowiedzialna(?:[ \\t]+\\p{Ll}+){0,4}|` +
  `[Ss]porządził${VERB_END}|[Oo]pracował${VERB_END}|[Ss]prawdził${VERB_END}|[Zz]atwierdził${VERB_END}|` +
  `[Ww]ykonał${VERB_END}|[Pp]rzygotował${VERB_END}|[Pp]rowadząc(?:y|a))[ \\t]*(?::|[–—-](?=[ \\t]))`;
// Tytuł albo stanowisko między kotwicą a inicjałami („Sporządziła: mgr A.S.”, „Sprawdził: insp. MK”).
const TITLE = `(?:(?:mgr|dr|inż|hab|prof|insp|st|lek|spec|kier)\\.?[ \\t]+)`;
// Inicjały z kropkami: „A.S.”, „A. S.”, „A.S”, „A.S.K.”.
const DOTTED = `[${PL_UP}]\\.(?:[ \\t]?[${PL_UP}]\\.){0,1}[ \\t]?[${PL_UP}]\\.?`;
// Gołe: „AS”, „ASK”, „AS-K” (nazwisko dwuczłonowe).
const BARE = `[${PL_UP}]{2,3}(?:-[${PL_UP}]{1,2})?`;
// Token nie przechodzi w słowo, kod ani adres. Nie stoi też przed nazwiskiem albo maską osoby
// („A.S. Nowak”: inicjały imion przy nazwisku scala finalizePersons w jedną osobę).
const INI = `(?:${DOTTED}|${BARE})(?![\\p{L}\\d@\\]-]|\\.[\\p{L}\\d])(?!\\.?[ \\u00A0]+(?:\\p{Lu}|${PERSON_MASK_SRC}))`;
const RE_ANCHOR_INI = new RegExp(`(${ANCHOR})([ \\t]+${TITLE}*)(${INI})`, 'gmu');
// Dalsze inicjały tego samego wpisu tylko po separatorze listy („(odp. AS, MK)”, „AS i KK”, „A.S./M.K.”,
// „AS (koordynacja), MK”). Proza po przecinku („odp. AS, do akceptacji MZ”) kończy wpis.
const RE_NEXT_INI = new RegExp(
  `(?:[ \\t]*\\([^()\\n]{0,40}\\))?(?:[ \\t]*[,/&][ \\t]*|[ \\t]+(?:i|oraz)[ \\t]+)${TITLE}*(${INI})`,
  'yu',
);
const RE_DOTTED_ONLY = new RegExp(`^${DOTTED}$`, 'u');
// Po zapisie z kropkami bez osoby w piśmie nie może stać nazwa w cudzysłowie („F.H.U. „Budmax””).
const RE_AFTER_DOTTED_BAD = /^[ \t]*[„"«»“]/u;

// Skróty w kształcie inicjałów. Zawsze jawne: odpowiedzi i statusy, dział albo rola, funkcja
// („Zatwierdził: DG”), formy prawne firm („F.H.U.”, „P.H.U.”) oraz trzyliterowe skróty instytucji.
const ALWAYS_KEEP = new Set<string>(
  (
    'IT HR QA ND NA BD DG OK FH PH SC SJ ' +
    'TAK NIE NOK TBD TBC BHP BOK BOI BOP IOD DPO ABI CEO CFO CTO CIO COO PMO ' +
    'ZUS UMW NSA WSA RIO KIO UZP NFZ GUS NBP PIP SKO IPN ABW CBA CBŚ ' +
    'KGP KWP KMP KPP PSP OSP NIK RPO MON MSZ MEN KRS NIP VAT PIT CIT KAS IAS UCS ' +
    'USA PRM RCB COI UKE URE KNF UDT GIS PZU PKO PGE PKP PKS PAP TVP BGK BIK ' +
    'OPS ZOZ PUP WUP PCK ZHP DPS ŚDS CUS CAS UKS AGH SGH PAN SSE GDOŚ RDOŚ ' +
    'FHU PHU ZUH PPHU FPHU PHP PPH FPH ZPH ZPHU FUH PUH ZHU FHP'
  ).split(' '),
);
// Dwuliterowe skróty instytucji („US”, „UM”, „SR”, „KK”), które są też bardzo częstymi parami
// polskich inicjałów. Zostają jawne, chyba że w piśmie jest osoba o tych inicjałach.
const KEEP_UNLESS_PERSON = new Set<string>(
  'PR US UM UG UW SR SO SA SN TK RP RM PL UE EU SG SW SM ŻW SP ZS LO PW UJ WZ ZG RN KK KW PS NB NN'.split(' '),
);
// Badania po „wyk.” („wyk. EKG”, „badanie wyk. MR”): po tej kotwicy zawsze jawne, także przy
// pacjencie o tych inicjałach. Po innych kotwicach rozstrzyga osoba w piśmie.
const EXAMS = new Set<string>('EKG ECG RTG USG CRP OB MR RM CT KT TK MRI EEG EMG PET OCT KTG'.split(' '));
const RE_EXAM_ANCHOR = /^[Ww]yk(?:\.|onał)/;
// „OK” po „odp.” bywa osobą („(odp. OK)” przy Oliwii Kubiak), po pozostałych kotwicach to status.
const RE_ODP_ANCHOR = /^[Oo]dp/;
// Rzymskie liczby z I, V, X („odp. II”, „wyk. IV”) to numer etapu albo części, nie osoba.
const RE_ROMAN = /^[IVX]+$/;

// Pary „Imię Nazwisko” (i „Nazwisko Imię”) z oryginału, których nazwisko zostało zamaskowane jako osoba.
const RE_PAIR = /(?<!\p{L})(?=(\p{Lu}\p{Ll}+)[ \t]+(\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?)(?!\p{L}))/gu;

/** Inicjały → osoby zamaskowane w piśmie (klucz nazwiska → forma z tekstu). Odmiany jednego nazwiska
 *  („Magdalena Kamińska”, „Magdaleny Kamińskiej”) to jedna osoba. */
type Owners = Map<string, string>;
function personInitials(ctx: RedactCtx): Map<string, Owners> {
  const out = new Map<string, Owners>();
  const add = (letters: string, surname: string) => {
    let s = out.get(letters);
    if (!s) out.set(letters, (s = new Map()));
    const key = normalizeSurnameKey(surname);
    if (!s.has(key)) s.set(key, surname);
  };
  const masked = (surname: string) =>
    ctx.maskedSurnames.has(normalizeSurnameKey(surname)) || surname.split('-').some((p) => ctx.maskedSurnames.has(normalizeSurnameKey(p)));
  const addPerson = (first: string, surname: string) => {
    const parts = surname.split('-');
    add((first[0] + parts[0][0]).toUpperCase(), surname);
    if (parts.length > 1) add((first[0] + parts.map((p) => p[0]).join('')).toUpperCase(), surname);
  };
  for (const m of ctx.raw.matchAll(RE_PAIR)) {
    const [, a, b] = m;
    const aName = isFirstNameLike(a);
    const bName = isFirstNameLike(b);
    if (aName && !bName && masked(b)) addPerson(a, b);
    else if (bName && !aName && masked(a)) addPerson(b, a);
  }
  return out;
}

const lettersOf = (tok: string): string => tok.replace(/[.\s-]/g, '');

// Nagłówek kolumny osoby odpowiedzialnej w tabeli zadań.
const RE_ODP_HEADER = /^(?:odp\.?|odpowiedzialn(?:y|a|i|e)|osoba[ \t]+odpowiedzialna)$/iu;
const RE_CELL_INIS = new RegExp(`^(${INI})((?:[ \\t]*[,/&][ \\t]*|[ \\t]+(?:i|oraz)[ \\t]+)(?:${INI}))*$`, 'u');
const RE_CELL_ONE = new RegExp(`(?<![\\p{L}\\d.])${INI}`, 'gu');

type Cell = { start: number; text: string };
/** Komórki wiersza tabeli (separator „|” albo tabulator) z pozycją w tekście. */
function cellsOf(line: string, at: number, sep: string): Cell[] {
  const out: Cell[] = [];
  let start = 0;
  for (let i = 0; i <= line.length; i++) {
    if (i === line.length || line[i] === sep) {
      out.push({ start: at + start, text: line.slice(start, i) });
      start = i + 1;
    }
  }
  return out;
}

/** Inicjały osoby po kotwicy odpowiedzialności („(odp. AS)”, „Sporządził: MK”) i w kolumnie „Odp.”
 *  tabeli zadań. Maska osoby. */
export function passPersonInitialsAfterAnchor(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  let known: Map<string, Owners> | undefined;
  // Klucz pseudonimu: nazwisko osoby, której to inicjały (ta sama etykieta co pełne imię i nazwisko),
  // a gdy pasuje kilka osób albo żadna, same litery („A.S.” i „AS” to ta sama osoba w jednym piśmie).
  const mask = (letters: string, owners: Owners | undefined): string => {
    ctx.bump('IMIE');
    return ctx.personMask(owners && owners.size === 1 ? [...owners.values()][0] : `#ini-${letters}`);
  };
  const decide = (tok: string, end: number, anchor: string): string | null => {
    const letters = lettersOf(tok);
    if (RE_ROMAN.test(letters)) return null;
    if (EXAMS.has(letters) && RE_EXAM_ANCHOR.test(anchor)) return null;
    const owners = (known ??= personInitials(ctx)).get(letters);
    if (letters === 'OK') return owners && RE_ODP_ANCHOR.test(anchor) ? mask(letters, owners) : null;
    if (ALWAYS_KEEP.has(letters)) return null;
    if (owners) return mask(letters, owners);
    if (KEEP_UNLESS_PERSON.has(letters)) return null;
    // bez osoby w piśmie tylko zapis z kropkami, po którym nie stoi nazwa w cudzysłowie
    if (RE_DOTTED_ONLY.test(tok) && !RE_AFTER_DOTTED_BAD.test(ctx.text.slice(end, end + 8))) return mask(letters, undefined);
    return null;
  };
  // Wpisy sąsiadują („(odp. AS), (odp. MK)”), więc podmiany zbieramy po pozycji, każdy token raz.
  const edits = new Map<number, [number, string]>();
  const take = (start: number, tok: string, anchor: string) => {
    if (edits.has(start)) return;
    const rep = decide(tok, start + tok.length, anchor);
    if (rep !== null) edits.set(start, [start + tok.length, rep]);
  };
  for (const m of ctx.text.matchAll(RE_ANCHOR_INI)) {
    const [, anchor, sp, ini] = m;
    let at = (m.index ?? 0) + anchor.length + sp.length;
    take(at, ini, anchor);
    let pos = at + ini.length;
    for (;;) {
      RE_NEXT_INI.lastIndex = pos;
      const n = RE_NEXT_INI.exec(ctx.text);
      if (!n) break;
      at = pos + n[0].length - n[1].length;
      take(at, n[1], anchor);
      pos = at + n[1].length;
    }
  }
  scanOdpColumn(ctx.text, (start, tok) => take(start, tok, 'odp.'));
  if (edits.size === 0) return;
  let out = '';
  let pos = 0;
  for (const start of [...edits.keys()].sort((x, y) => x - y)) {
    const [end, rep] = edits.get(start) as [number, string];
    if (start < pos) continue;
    out += ctx.text.slice(pos, start) + rep;
    pos = end;
  }
  ctx.text = out + ctx.text.slice(pos);
}

/** Tabela zadań z kolumną „Odp.”/„Odpowiedzialny” (separator „|” albo tabulator): komórki tej
 *  kolumny, które składają się wyłącznie z inicjałów, rozstrzyga się jak inicjały po „odp.”. */
function scanOdpColumn(text: string, onIni: (start: number, tok: string) => void): void {
  if (!/odp|odpowiedzialn/i.test(text)) return;
  const lines: { at: number; s: string }[] = [];
  let at = 0;
  for (const s of text.split('\n')) {
    lines.push({ at, s });
    at += s.length + 1;
  }
  for (let i = 0; i < lines.length; i++) {
    const { s } = lines[i];
    const sep = s.includes('|') ? '|' : s.includes('\t') ? '\t' : '';
    if (!sep) continue;
    const col = cellsOf(s, 0, sep).findIndex((c) => RE_ODP_HEADER.test(c.text.trim()));
    if (col < 0) continue;
    // wiersze tabeli: kolejne linie z tym samym separatorem
    let j = i + 1;
    for (; j < lines.length && lines[j].s.includes(sep); j++) {
      const cell = cellsOf(lines[j].s, lines[j].at, sep)[col];
      if (!cell) continue;
      const lead = cell.text.length - cell.text.trimStart().length;
      const val = cell.text.trim();
      if (!RE_CELL_INIS.test(val)) continue;
      for (const t of val.matchAll(RE_CELL_ONE)) onIni(cell.start + lead + (t.index ?? 0), t[0]);
    }
    i = j - 1;
  }
}
