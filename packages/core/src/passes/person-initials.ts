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
//
// Metryka i rejestr z EZD dokładają trzy kotwice. Dekretacja: strzałka w wierszu dekretacji
// („Dekretacja: Kierownik → MK”, „dekretacja: AB → CD”) i pola „Dekretacja:”, „Zadekretowano do:”,
// „Przydzielono do:”, „wg właściwości:”. Po nich z definicji stoi też komórka albo organ („→ WOŚ”,
// „wg właściwości: U.S.C.”), więc tam inicjały, także z kropkami, rozstrzyga WYŁĄCZNIE osoba w piśmie.
// Pola osobowe („Referent:”, „Sprawę prowadzi:”, „Osoba prowadząca:”, „prow.”) działają jak „odp.”.
// Kolumna osoby w tabeli: gołe „Prow.”, „Prowadzący”, „Referent”, „Załatwiający” w rejestrach często
// znaczą organ albo komórkę prowadzącą („Prowadzący | US”, „Prowadzący | GK”), więc rozstrzyga osoba
// w piśmie jak w kolumnie „Odp.”. Bez osoby w piśmie dwie wersaliki zakrywa tylko kolumna z nagłówkiem
// w formie osobowej („Osoba prowadząca”, „Pracownik prowadzący”, „Pracownik”), i to tylko wtedy, gdy
// cała kolumna wygląda na osoby: same dwuliterowe inicjały, żaden skrót instytucji ani symbol komórki
// (prefiks znaku sprawy „GK.6220…”, „Wydział … (GK)”). Legenda skrótów („ES – Ewa Szołtysek,
// TB – Tomasz Bajer”): inicjały tuż przed maską osoby o tych inicjałach.

// Skróty: „odp.” (odpowiedzialny), „wyk.”, „opr.”/„oprac.”, „sporz.”, „prow.”. Słowa pełne tylko z dwukropkiem
// albo myślnikiem, bo bez nich w prozie stoi po nich podmiot („projekt zatwierdził RIO”). „kontakt:”
// celowo pominięte: po nim częściej stoi dział albo infolinia („kontakt: BOK”) niż osoba.
const VERB_END = `(?:a|y|i|\\(a\\))?`;
const ANCHOR =
  `(?<![\\p{L}\\d])(?:[Oo]dp|[Ww]yk|[Oo]pr|[Oo]prac|[Ss]porz|[Pp]row)\\.[ \\t]*:?|` +
  `(?<![\\p{L}\\d])(?:[Oo]dpowiedzialn(?:y|a|i|e)|[Oo]soba[ \\t]+odpowiedzialna(?:[ \\t]+\\p{Ll}+){0,4}|` +
  `[Ss]porządził${VERB_END}|[Oo]pracował${VERB_END}|[Ss]prawdził${VERB_END}|[Zz]atwierdził${VERB_END}|` +
  `[Ww]ykonał${VERB_END}|[Pp]rzygotował${VERB_END}|[Pp]rowadząc(?:y|a)|` +
  `[Oo]soba[ \\t]+prowadząca|[Ss]prawę[ \\t]+prowadzi|[Rr]eferent(?:ka)?|[Dd]ekretacja|` +
  `(?:[Zz]a)?[Dd]ekretowan[oya](?:[ \\t]+(?:do|na))?|(?:[Ww]g|[Ww]edług)[ \\t]+właściwości|` +
  `[Pp]rzydzielon[oya](?:[ \\t]+(?:do|dla))?)[ \\t]*(?::|[–—-](?=[ \\t]))`;
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
// Strzałka dekretacji („→ MK”, „-> MK”, „=> MK”) i wiersz, w którym strzałka jest dekretacją
// („Dekretacja: Kierownik → MK”, „przekazano wg właściwości → KW”). Strzałka w innym wierszu
// („Warszawa → Kraków”, „etap I → II”) nie jest kotwicą.
const ARROW = `(?:→|⟶|⇒|=>|-{1,2}>)`;
const RE_ARROW_INI = new RegExp(`${ARROW}([ \\t]*${TITLE}*)(${INI})`, 'gu');
const RE_HAS_ARROW = new RegExp(ARROW, 'u');
const RE_DEKRET_LINE = /dekret|przydziel|właściwości|przekaza|do załatwienia|do realizacji/iu;
// Kotwice, po których stoi komórka albo organ (strzałka i pola dekretacji, przydziału i właściwości,
// kolumny „Ref.” i „Dekretacja”): inicjały tylko osoby z pisma, zapis z kropkami nie wystarcza.
const RE_UNIT_ANCHOR = /^(?:→|[Dd]ekret|(?:[Zz]a)?[Dd]ekretowan|[Pp]rzydziel|[Ww]g[ \t]|[Ww]edług|komórka)/u;
// Kotwica kolumny tabeli rozstrzyganej jak „odp.” („Odp.”, „Prowadzący”, „Referent”, „Pracownik”).
const COL_ODP = 'odp. (kolumna)';
// Pola metryki, w których obok pracownika stoi też jednostka prowadząca („Sprawę prowadzi: Z.G.K.
// w Pucku”, „Referent: W.Z.D. (Wojewódzki Zarząd Dróg)”). Bez osoby w piśmie trzy litery z kropkami
// na końcu pola, przed „w <Miejscowość>” albo przed nawiasem z rozwinięciem to skrót jednostki.
const RE_FIELD_ANCHOR = /^(?:[Ss]prawę|[Rr]eferent|[Oo]soba[ \t]+prowadząca|[Pp]row\.)/u;
const RE_AFTER_UNIT_ABBR = /^\.?[ \t]*(?:$|[\n;|\t]|\(|w[ \t]+\p{Lu})/u;
// Słowo komórki tuż przed inicjałami legendy („Kierownik Referatu GK – Jan Kowalski”): to symbol
// komórki, nie skrót osoby.
const RE_UNIT_WORD_END = /(?:[Ww]ydział|[Rr]eferat|[Bb]iur|[Dd]ział|[Zz]espoł|[Kk]omórk|[Ss]ekcj|[Oo]ddział)\p{L}{0,3}[ \t]+$/u;
// Po zapisie z kropkami stoi przepis („K.P.A. art. 35”, „K.C. § 2”): to skrót ustawy, nie osoba.
const RE_AFTER_LAW = /^[ \t]*,?[ \t]*(?:art\.|§|ust\.|pkt[ \t]|\(Dz)/u;
// Skróty kodeksów, z kropkami albo bez („K.P.A.”, „KPA”, „K.C.”).
const LAW_CODES = new Set<string>('KPA KC KK KP KPC KPK KW KSH KRO KPW KKS KKW KPSA PPSA'.split(' '));
// Symbol komórki w piśmie: prefiks znaku sprawy („GK.6220.1.2026”, „OR-I.1431”, „WOŚ.271”) albo
// symbol przy nazwie komórki („Wydział Geodezji (GD)”, „Referat OR”). Zbierane raz na pismo.
// Wzorce zaczynają się od litery, a granicę słowa przed trafieniem sprawdza kod: lookbehind na
// początku wzorca kosztuje próbę w każdym miejscu długiego tekstu.
const RE_CASE_PREFIX = new RegExp(`([${PL_UP}]{2,4})(?:-[IVX]{1,4})?\\.\\d`, 'gu');
const RE_UNIT_NAMED = new RegExp(
  `(?:[Ww]ydzia|[Rr]eferat|[Bb]iur|[Kk]omórk|[Dd]zia|[Zz]esp[oó])\\p{L}{0,4}` +
    `(?:[ \\t]+[\\p{L}-]{1,30}){0,6}?[ \\t]+\\(?([${PL_UP}]{2,4})\\)?(?![\\p{L}\\d])`,
  'gu',
);
const RE_WORD_BEFORE = /[\p{L}\d.]/u;
function unitSymbols(raw: string): Set<string> {
  const out = new Set<string>();
  for (const re of [RE_CASE_PREFIX, RE_UNIT_NAMED]) {
    for (const m of raw.matchAll(re)) {
      const i = m.index ?? 0;
      if (i === 0 || !RE_WORD_BEFORE.test(raw[i - 1])) out.add(m[1]);
    }
  }
  return out;
}
// Legenda skrótów: inicjały, myślnik albo „=” i maska osoby („ES – [OSOBA]”). Litery muszą być
// inicjałami osoby zamaskowanej w piśmie. Dwukropek pominięty: „PS: Paweł…”, „AS: Dzień dobry” to
// dopisek albo mówca. Zapis „[OSOBA] (ES)” rozstrzyga passPersonPropagate (definicja inicjałów przy
// osobie działa tam w całym piśmie).
const LEGEND_INI = `(?:${DOTTED}|${BARE})`;
// Granicę przed inicjałami sprawdza kod (RE_LEGEND_BEFORE), bo lookbehind na początku wzorca
// kosztuje próbę w każdym miejscu tekstu.
const RE_LEGEND_FWD = new RegExp(
  `(${LEGEND_INI})[ \\t]*(?:[–—=]|-(?=[ \\t]))[ \\t]*${TITLE}*(?=${PERSON_MASK_SRC})`,
  'gu',
);
const RE_LEGEND_BEFORE = /[\p{L}\d.\]-]/u;

// Skróty w kształcie inicjałów. Zawsze jawne: odpowiedzi i statusy, dział albo rola, funkcja
// („Zatwierdził: DG”), formy prawne firm („F.H.U.”, „P.H.U.”) oraz trzyliterowe skróty instytucji.
export const ALWAYS_KEEP_INITIALS = new Set<string>(
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
export const INITIAL_EXAMS = new Set<string>('EKG ECG RTG USG CRP OB MR RM CT KT TK MRI EEG EMG PET OCT KTG'.split(' '));
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

// Nagłówek kolumny osoby w tabeli. Forma osobowa („Osoba prowadząca”, „Pracownik prowadzący”,
// „Pracownik”) mówi wprost, że stoi w niej osoba. Gołe „Odp.”, „Prow.”, „Prowadzący”, „Referent”
// i „Załatwiający” bywają kolumną organu albo komórki („Prowadzący | US”, „Referent | OR”), a „Ref.”
// i „Dekretacja” kolumną komórki („Ref. | OŚ”, „Dekretacja | WOŚ → MK”).
const RE_WORKER_HEADER =
  /^(?:osoba[ \t]+prowadząca|pracownik(?:[ \t]+(?:prowadzący|prowadząca|merytoryczny|merytoryczna))?)$/iu;
const RE_ODP_HEADER =
  /^(?:odp\.?|odpowiedzialn(?:y|a|i|e)|osoba[ \t]+odpowiedzialna|prow\.?|prowadząc[ya]|sprawę[ \t]+prowadzi|referent(?:ka)?|załatwiając[ya])$/iu;
// Odpowiedzi i statusy w komórce kolumny osoby: zostają jawne (ALWAYS_KEEP_INITIALS), a przy
// rozstrzyganiu, czy kolumna to osoby czy komórki, się nie liczą.
const CELL_STATUS = new Set<string>('ND NA BD OK TAK NIE NOK TBD TBC'.split(' '));
const RE_UNIT_HEADER = /^(?:ref\.?|dekret\.?|dekretacja|(?:za)?dekretowan[oya](?:[ \t]+do)?)$/iu;
const RE_TABLE_HINT = /odp|odpowiedzialn|prow|referent|pracownik|ref\.|dekret|załatwiaj/i;
const CELL_SEP = `(?:[ \\t]*[,/&][ \\t]*|[ \\t]*${ARROW}[ \\t]*|[ \\t]+(?:i|oraz)[ \\t]+)`;
const RE_CELL_INIS = new RegExp(`^(${INI})(?:${CELL_SEP}(?:${INI}))*$`, 'u');
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
  let units: Set<string> | undefined;
  // Skrót instytucji, kodeksu albo symbol komórki z tego pisma: bez osoby w piśmie zostaje jawny.
  const orgLike = (letters: string): boolean =>
    ALWAYS_KEEP_INITIALS.has(letters) ||
    KEEP_UNLESS_PERSON.has(letters) ||
    LAW_CODES.has(letters) ||
    (units ??= unitSymbols(ctx.raw)).has(letters);
  // `worker`: kolumna z nagłówkiem osobowym, w której wszystkie komórki to inicjały osób.
  const decide = (tok: string, end: number, anchor: string, worker: boolean): string | null => {
    const letters = lettersOf(tok);
    if (RE_ROMAN.test(letters)) return null;
    if (INITIAL_EXAMS.has(letters) && RE_EXAM_ANCHOR.test(anchor)) return null;
    const owners = (known ??= personInitials(ctx)).get(letters);
    if (letters === 'OK') return owners && RE_ODP_ANCHOR.test(anchor) ? mask(letters, owners) : null;
    if (ALWAYS_KEEP_INITIALS.has(letters)) return null;
    // Po dekretacji, przydziale i właściwości oraz w kolumnie tabeli symbol komórki z tego pisma
    // („GK.6220…”, „Wydział … (GK)”) wygrywa z osobą o tych inicjałach: „Dekretacja: Burmistrz → GK”
    // przy wnioskodawcy Grzegorzu Kowalu to referat, nie on.
    if ((RE_UNIT_ANCHOR.test(anchor) || anchor === COL_ODP) && (units ??= unitSymbols(ctx.raw)).has(letters)) return null;
    if (owners) return mask(letters, owners);
    // bez osoby w piśmie: po dekretacji i właściwości stoi komórka albo organ
    if (RE_UNIT_ANCHOR.test(anchor) || orgLike(letters)) return null;
    // kolumna pracownika: dwie wersaliki to inicjały także bez osoby w piśmie
    if (worker && /^[^.\s-]{2}$/u.test(tok)) return mask(letters, undefined);
    // tylko zapis z kropkami, po którym nie stoi nazwa w cudzysłowie ani przepis
    if (!RE_DOTTED_ONLY.test(tok)) return null;
    const after = ctx.text.slice(end, end + 12);
    if (RE_AFTER_DOTTED_BAD.test(after) || RE_AFTER_LAW.test(after)) return null;
    if (letters.length > 2 && RE_FIELD_ANCHOR.test(anchor) && RE_AFTER_UNIT_ABBR.test(after)) return null;
    return mask(letters, undefined);
  };
  // Wpisy sąsiadują („(odp. AS), (odp. MK)”), więc podmiany zbieramy po pozycji, każdy token raz.
  const edits = new Map<number, [number, string]>();
  const take = (start: number, tok: string, anchor: string, worker = false) => {
    if (edits.has(start)) return;
    const rep = decide(tok, start + tok.length, anchor, worker);
    if (rep !== null) edits.set(start, [start + tok.length, rep]);
  };
  // Kotwica i dalsze inicjały tego samego wpisu po separatorze listy.
  const entry = (at: number, ini: string, anchor: string) => {
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
  };
  const t = ctx.text;
  for (const m of t.matchAll(RE_ANCHOR_INI)) {
    const [, anchor, sp, ini] = m;
    entry((m.index ?? 0) + anchor.length + sp.length, ini, anchor);
  }
  // strzałka dekretacji: wiersz sprawdzany raz, niezależnie od liczby strzałek
  if (RE_HAS_ARROW.test(t)) {
    let lineAt = -1;
    let lineOk = false;
    for (const m of t.matchAll(RE_ARROW_INI)) {
      const idx = m.index ?? 0;
      if (idx >= lineAt) {
        const s = t.lastIndexOf('\n', idx) + 1;
        const e = t.indexOf('\n', idx);
        lineAt = e < 0 ? t.length : e;
        lineOk = RE_DEKRET_LINE.test(t.slice(s, lineAt));
      }
      if (lineOk) entry(idx + m[0].length - m[2].length, m[2], '→');
    }
  }
  // legenda skrótów: tylko litery osoby z pisma, kropki bez osoby nie wystarczą
  if (t.includes('[')) {
    const legend = (at: number, tok: string) => {
      const letters = lettersOf(tok);
      if (!(known ??= personInitials(ctx)).has(letters)) return;
      // symbol komórki: po słowie komórki („Referatu GK –”) albo symbol z tego pisma („GK.6831…”)
      if (RE_UNIT_WORD_END.test(t.slice(Math.max(0, at - 24), at)) || (units ??= unitSymbols(ctx.raw)).has(letters)) return;
      take(at, tok, 'legenda');
    };
    for (const m of t.matchAll(RE_LEGEND_FWD)) {
      const i = m.index ?? 0;
      if (i === 0 || !RE_LEGEND_BEFORE.test(t[i - 1])) legend(i, m[1]);
    }
  }
  scanPersonColumns(t, orgLike, take);
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

/** Tabela z kolumną osoby (separator „|” albo tabulator). Komórki z samych inicjałów (także
 *  „AB → CD”, „KW/MK”) i inicjały po strzałce w komórce („Kierownik → MK”) rozstrzyga się jak
 *  inicjały po kotwicy: „odp.” w kolumnie osoby albo organu („Odp.”, „Prowadzący”, „Referent”),
 *  „komórka” w kolumnie „Ref.” i „Dekretacja” oraz w każdej kolumnie, w której stoi skrót instytucji
 *  albo symbol komórki. `worker` dostaje tylko kolumna z nagłówkiem osobowym, w której wszystkie
 *  komórki to dwuliterowe inicjały spoza skrótów instytucji i symboli komórek. */
function scanPersonColumns(
  text: string,
  orgLike: (letters: string) => boolean,
  onIni: (start: number, tok: string, anchor: string, worker: boolean) => void,
): void {
  if (!RE_TABLE_HINT.test(text)) return;
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
    const cols: [number, 'worker' | 'odp' | 'unit'][] = [];
    cellsOf(s, 0, sep).forEach((c, k) => {
      const h = c.text.trim();
      if (RE_WORKER_HEADER.test(h)) cols.push([k, 'worker']);
      else if (RE_ODP_HEADER.test(h)) cols.push([k, 'odp']);
      else if (RE_UNIT_HEADER.test(h)) cols.push([k, 'unit']);
    });
    if (!cols.length) continue;
    // wiersze tabeli: kolejne linie z tym samym separatorem
    let j = i + 1;
    while (j < lines.length && lines[j].s.includes(sep)) j++;
    const rows = lines.slice(i + 1, j).map((l) => cellsOf(l.s, l.at, sep));
    for (const [col, kind] of cols) {
      // kolumna rozstrzygana w całości: najpierw inicjały wszystkich wierszy
      const hits: [number, string][] = [];
      let personal = kind === 'worker';
      let org = false;
      for (const cells of rows) {
        const cell = cells[col];
        const val = cell ? cell.text.trim() : '';
        if (!cell || !val) continue;
        if (RE_CELL_INIS.test(val)) {
          const lead = cell.text.length - cell.text.trimStart().length;
          for (const t of val.matchAll(RE_CELL_ONE)) {
            const letters = lettersOf(t[0]);
            hits.push([cell.start + lead + (t.index ?? 0), t[0]]);
            // Odpowiedź albo status w wierszu („ND”, „BD”, „OK”) nie mówi nic o kolumnie, ale sam
            // dalej idzie do decide: „O.K.” przy Oliwii Kubiak z pisma to ona, jak po „odp.”.
            if (CELL_STATUS.has(letters)) continue;
            if (orgLike(letters)) org = true;
            if (letters.length !== 2) personal = false;
          }
          continue;
        }
        personal = false;
        // komórka dekretacji z rolą przed strzałką („Kierownik → MK”): inicjały po strzałce
        if (!RE_HAS_ARROW.test(val)) continue;
        for (const t of cell.text.matchAll(RE_ARROW_INI)) hits.push([cell.start + (t.index ?? 0) + t[0].length - t[2].length, t[2]]);
      }
      const anchor = kind === 'unit' || org ? 'komórka' : COL_ODP;
      for (const [pos, tok] of hits) onIni(pos, tok, anchor, personal && !org);
    }
    i = j - 1;
  }
}
