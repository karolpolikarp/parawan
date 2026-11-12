import { PL_LO, PL_UP } from '../charset.js';
import { maskAfterLabel, maskConst, type RedactCtx } from '../context.js';
import { isValidKw, isValidNip } from '../validators.js';

// Przebiegi numeru KSeF, numeru księgi wieczystej i znaku sprawy. Biegną przed NIP-em
// i krótszymi detektorami, żeby maskować całe numery, a nie ich fragmenty.

// Numer KSeF: NIP wystawcy (albo „M" + 9 cyfr) + data + 12 znaków hex (w KSeF 1.0 rozbite 6+6)
// + 2 znaki sumy, np. „5265877635-20250826-0100001AF629-AF". Sumy CRC-8 nie sprawdzamy, bo
// numery z KSeF 1.0 jej nie przechodzą; w zamian wymagamy kotwicy „KSeF" w dokumencie.
// Separatorem jest tylko myślnik bez spacji wokół, z łamaniem wiersza wyłącznie po nim: spacja,
// „ - " albo łamanie przed myślnikiem scalały kolumny liczb i listy punktowane w jeden numer.
// Miękki dywiz (U+00AD) pada wewnątrz członów jako artefakt łamania wyrazu, więc nie dzieli.
const KSEF_SEP = '[-\\u2010-\\u2015](?:[ \\t]*\\r?\\n[ \\t\\u00A0\\u2009\\u202F]*)?';
// Wariant „3 litery + 7 cyfr" z FA(3) jest pominięty celowo: w praktyce go nie ma, a łapał numery
// seryjne i partii („SRV2026001-20260108-000000004512-03") w dokumentach wspominających KSeF.
const KSEF_HEAD = '(?:\\d{10}|[Mm]\\d{9})';
const KSEF_DATE = '20\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])';
const KSEF_VALUE =
  `${KSEF_HEAD}${KSEF_SEP}${KSEF_DATE}${KSEF_SEP}` +
  `(?:[0-9A-Fa-f]{6}${KSEF_SEP}[0-9A-Fa-f]{6}|[0-9A-Fa-f]{12})${KSEF_SEP}[0-9A-Fa-f]{2}`;
// Kotwica dokumentowa, nie sąsiedzka: etykieta bywa w nagłówku kolumny, za numerem albo nad
// wyliczeniem kilku numerów. Sztywny kształt numeru wystarcza w dokumencie mówiącym o KSeF.
const RE_KSEF_ANCHOR = /ksef|krajow\w*\s+system\w*\s+e[-‐-―]?faktur/i;
// Granice dopuszczają myślnik, bo numer bywa doklejony do etykiety albo nazwy pliku
// („faktura-5265877635-…-AF.xml"), a taki dłuższy identyfikator i tak niesie NIP wystawcy.
export const RE_KSEF_VALUE = new RegExp(`(?<![0-9A-Za-z])${KSEF_VALUE}(?![0-9A-Za-z])`, 'g');

/** Kotwica liczona na oryginalnym wejściu (patrz RedactCtx.raw). */
export function hasKsefAnchor(ctx: RedactCtx): boolean {
  return RE_KSEF_ANCHOR.test(ctx.raw);
}

/** Słaba kotwica dokumentowa wymaga mocnej wartości: bez sprawdzenia NIP-u znikały numery
 *  zamówień o tym samym kształcie („4500123456-20260115-000000012345-01"). Wariant „M" + 9 cyfr
 *  nie ma sumy, więc tam decyduje sam kształt. */
export function maskKsefMatch(ctx: RedactCtx) {
  return (m: string): string => {
    // KSEF_HEAD ma zawsze 10 znaków, a po nim stoi myślnik.
    const head = m.slice(0, 10);
    // Prawdziwa część techniczna jest losowym hex, więc prawie zawsze ma literę A–F; same cyfry
    // to numer zamówienia albo sklejone kwoty, a sumę NIP przechodzi co jedenasty ciąg cyfr.
    if (!/[A-Fa-f]/.test(m.slice(head.length))) return m;
    // Żaden NIP nie zaczyna się od zera, a suma kontrolna to przepuszcza.
    if (/^\d{10}$/.test(head) && (head.startsWith('0') || !isValidNip(head))) return m;
    ctx.bump('KSEF');
    return ctx.M.KSEF;
  };
}

// Przed passZnakSprawy, który dałby numerowi maskę znaku sprawy, i przed passNip, który
// zamaskowałby sam prefiks i zostawił „[NIP]-20250826-0100001AF629-AF".
export function passKsef(ctx: RedactCtx): void {
  if (!ctx.on('KSEF') || !hasKsefAnchor(ctx)) return;
  ctx.text = ctx.text.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
}

// Numer księgi wieczystej „WA1M/00512345/3". Jawny prowadzi przez publiczną przeglądarkę ksiąg
// wprost do właściciela nieruchomości.
// Separator: ukośnik albo łącznik (także z łamaniem wiersza po nim), po kotwicy też spacja; oba
// tego samego rodzaju, bo mieszany „LU1I/00045678 2 działki" wciągał liczbę z prozy. Bez kotwicy
// maskKwMatch wymaga ukośników. Łącznik z ciągiem dalej („WA1M/00512345/6-12") to dłuższy znak
// sprawy, który passZnakSprawy maskuje w całości.
const KW_SLASH = '[ \\t]*[/-][ \\t]*(?:\\r?\\n[ \\t]*)?';
const KW_SHAPE = `([A-Za-z]{2}[1-9][A-Za-z])(?:${KW_SLASH}(\\d{8})${KW_SLASH}|[ \\t]+(\\d{8})[ \\t]+)(\\d)`;
export const RE_KW_VALUE = new RegExp(
  `(?<![\\p{L}\\d/])${KW_SHAPE}(?![\\p{L}\\d/]|[.,]\\d|[-–][\\p{L}\\d])`,
  'gu',
);
/** Pierwsze dwie litery kodów wydziałów ksiąg wieczystych. Bez kotwicy maskujemy tylko te: sama
 *  cyfra kontrolna przepuszcza co dziesiąty kod produktu o tym kształcie („AB1C/12345678/7"). */
const KW_COURT_PREFIXES = new Set(
  ('BB BI BY CZ EL GD GL GW JG KA KI KN KO KR KS KZ LD LE LM LU NS OL OP OS PL PO PR PT RA RZ ' +
    'SI SL SR SU SW SZ TB TO TR WA WL WR ZA ZG').split(' '),
);
/** Kotwica: „KW" jako osobny wyraz, „Kw nr", „nr kw", odmiany „księga wieczysta" (też bez ogonków
 *  i w kluczu „numerKsiegiWieczystej") i „ks. wiecz.". Bez flagi /i, bo małe „kw." to kwartał
 *  albo kwiecień. Wyłączone są kilowaty („20 KW"), Komenda Wojewódzka („KW PSP") i „KW-2". */
const RE_KW_ANCHOR =
  /(?:(?<![\p{L}\d])(?<!\d[ \t]{0,2})(?:[Nn](?:umer|r)[_-]?)?KW(?![\p{L}\d]|-\d|[ \t]+(?:Policji|PSP|PP)(?!\p{L}))|(?<!\p{L})Kw\.?(?=[ \t]+nr)|(?<![\p{L}\d])[Nn](?:umer|r)\.?[ \t_-]*kw(?![\p{L}\d])|(?:[Kk]si(?:[eęą]g|[eę]dz)|KSI(?:[EĘĄ]G|[EĘ]DZ))\p{L}{0,3}[ \t_-]*(?:[Ww]ieczyst|WIECZYST)\p{L}{0,3}|(?<!\p{L})[Kk]s\.[ \t]*wiecz\.)/u;
/** Koniec zdania w oknie kotwicy, żeby kotwica nie przechodziła na numer z następnego zdania.
 *  Kropka po „nr" czy „wiecz." zdania nie kończy, po „KW." tylko przed „Nr" („KW. Nr WA1M/…"). */
const RE_KW_SENTENCE_END =
  /(?<!(?:\b[Nn]r|wiecz|\bks))(?<!\b[Kk][Ww](?=\.[ \t]+Nr(?!\p{L})))[.!?](?=[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ])|\n[ \t]*\n/gu;
/** Łącznik wyliczenia „KW nr A, B i C": kotwica pierwszego numeru niesie resztę. Bez tabulatora,
 *  bo w wierszu TSV następna komórka to inna kolumna, nie lista. */
const RE_KW_LIST_GAP = /^(?:[ ,;]|\r?\n|(?:i|oraz|lub|albo|a także)(?=[ \t])|(?:[Nn]r|numer)\.?(?=[ \t:]):?)*$/;
/** Parametr adresu zapowiadający numer księgi („?kw=KR1P/…"). Kotwica obejmuje tylko jego wartość,
 *  nie sąsiedni parametr („&plik=ZP1A-20260315-1.pdf"). */
const RE_KW_URL_PARAM = /[?&#;](?:kw|nr_?kw|numer_?kw|ksi[eę]g[aię]?(?:_?wieczyst\w{0,3})?)=$/i;

/** Odstęp, przy którym kotwica jest etykietą numeru: interpunkcja, znaczniki, kolumna, łamanie
 *  wiersza i „nr"/„o numerze"/„pod". Tylko taka kotwica znosi wymóg sumy i ukośników; „KW" użyte
 *  w zdaniu jako pojęcie („odpis KW w pliku ZP1A-…") nie jest etykietą kodu za innym słowem. */
const RE_KW_ADJ_GAP =
  /^(?:[ \t\r\n:=."'<>()[\]|_–-]|(?<!\p{L})(?:o[ \t]+)?(?:[Nn]r|NR|[Nn]umer(?:ze|em|u|y|ach|ami)?|NUMER|pod)(?!\p{L}))*$/u;
const RE_KW_ANCHOR_G = new RegExp(RE_KW_ANCHOR.source, 'gu');
/** Etykiety znaku sprawy, wspólne dla RE_KW_ZNAK_BEFORE i trybu z etykietą w passZnakSprawy. */
const ZNAK_LABEL = String.raw`znak sprawy|znak pisma|nasz znak|wasz znak|sygn\.?[ \t]*akt|sygnatura akt|sygn\.|znak(?=[ \t]*:)`;
/** Numer KW wklejony w znak sprawy („Znak sprawy: GN.KR1P/…/4") zostawiamy passZnakSprawy, który
 *  maskuje cały znak; sam numer odsłoniłby symbol komórki. */
const RE_KW_ZNAK_BEFORE = new RegExp(String.raw`(?:${ZNAK_LABEL})[ \t]*:?[ \t]*(?:[\p{L}\d]+[.-])*$`, 'iu');

/** Opcjonalne „nr"/„numer" przed etykietą KW w wierszu albo komórce. */
const KW_NR_PREFIX = String.raw`(?:(?:[Nn]r|NR|[Nn]umer|NUMER)\.?[ \t]*)?`;
/** Wiersz, który poza kotwicą zawiera tylko numerację punktu i „nr" („1. Księga wieczysta"). */
const RE_KW_LABEL_LINE = new RegExp(String.raw`^[ \t]*(?:(?:\d{1,3}[.)]|[-*•])[ \t]*)?` + KW_NR_PREFIX + '$');
const RE_KW_NR_ONLY = new RegExp(`^${KW_NR_PREFIX}$`);

/** Kotwica-etykieta w oknie 40 znaków przed numerem, w tym samym zdaniu (poprzedni wiersz „KW:\n…"
 *  się liczy, poprzedni akapit nie). Liczy się ostatnia kotwica w oknie. */
function kwAnchoredBefore(text: string, offset: number): boolean {
  let win = text.slice(Math.max(0, offset - 40), offset);
  let cut = -1;
  RE_KW_SENTENCE_END.lastIndex = 0;
  for (let m = RE_KW_SENTENCE_END.exec(win); m; m = RE_KW_SENTENCE_END.exec(win)) cut = m.index + m[0].length;
  if (cut >= 0) win = win.slice(cut);
  let end = -1;
  RE_KW_ANCHOR_G.lastIndex = 0;
  for (let m = RE_KW_ANCHOR_G.exec(win); m; m = RE_KW_ANCHOR_G.exec(win)) end = m.index + m[0].length;
  if (end >= 0 && RE_KW_ADJ_GAP.test(win.slice(end))) {
    // Przez łamanie wiersza kotwica przechodzi tylko jako etykieta: z „:", „=", „>" albo „|"
    // przed łamaniem albo gdy wiersz kotwicy to sama etykieta. „KW" na końcu zdania czy nagłówka
    // („Załączniki do KW\n…") nie opisuje kodu z następnego wiersza.
    const gap = win.slice(end);
    const nl = gap.indexOf('\n');
    if (nl < 0 || /[:=>|]/.test(gap.slice(0, nl))) return true;
    const absEnd = offset - win.length + end;
    const ls = text.lastIndexOf('\n', absEnd - 1) + 1;
    const rest = text.slice(ls, absEnd).replace(RE_KW_ANCHOR_G, '');
    if (RE_KW_LABEL_LINE.test(rest)) return true;
  }
  return kwColumnAnchored(text, offset);
}

const RE_KW_SHAPE_CELL = new RegExp(`^[ \\t"']*${KW_SHAPE}[ \\t\\r"']*$`, 'u');
/** Nagłówek kolumny jako kotwica („Nr KW\tPowierzchnia\nKR1P/…\t120 m2"): numer musi stać w tej
 *  samej kolumnie co etykieta, inaczej „KW" z nagłówka obejmowałoby każdą kolumnę. W górę idziemy
 *  przez wiersze z numerami KW; wycinek 400 znaków chroni przed skanowaniem długiego tekstu. */
function kwColumnAnchored(text: string, offset: number): boolean {
  const lines = text.slice(Math.max(0, offset - 400), offset).split('\n');
  if (lines.length < 2) return false;
  const cur = lines[lines.length - 1];
  const sep = cur.includes('\t') || lines[lines.length - 2].includes('\t') ? '\t' : cur.includes('|') ? '|' : '';
  if (!sep) return false;
  const curCells = cur.split(sep);
  if (!/^[ \t"']*$/.test(curCells[curCells.length - 1])) return false;
  const col = curCells.length - 1;
  // Pierwszy wiersz wycinka bywa ucięty, chyba że wycinek zaczyna tekst.
  const first = offset - 400 <= 0 ? 0 : 1;
  // W tabeli „|" nagłówek stoi nad linią „|---|". Bez niej wiersze to pary klucz–wartość
  // („| Rejestr | KW |"), a „KW" jest wartością, nie etykietą.
  let mdSep = false;
  for (let i = lines.length - 2; i >= first; i--) {
    const row = lines[i];
    if (sep === '|' && /^[ \t|:-]+$/.test(row)) {
      mdSep = true;
      continue;
    }
    const cell = row.split(sep)[col];
    if (cell === undefined) return false;
    if (RE_KW_SHAPE_CELL.test(cell)) continue;
    // Komórka ma być samą etykietą, nie opisem z tym słowem („| 2 | odpis KW |").
    const label = cell.trim();
    const a = RE_KW_ANCHOR.exec(label);
    return (
      !!a &&
      (sep !== '|' || mdSep) &&
      label.length <= 30 &&
      RE_KW_NR_ONLY.test(label.slice(0, a.index)) &&
      RE_KW_ADJ_GAP.test(label.slice(a.index + a[0].length))
    );
  }
  return false;
}

/** Etykieta innego numeru tuż przed kodem („Faktura nr PL1A/…"): wtedy tryb bez kotwicy go nie
 *  maskuje. „umowy", „zamówienia" i „zlecenia" liczą się tylko po „nr", bo „Przedmiot umowy:
 *  KR1P/…" w akcie notarialnym to nadal księga. */
const RE_KW_OTHER_LABEL =
  /(?<!\p{L})(?:(?:faktur\p{L}*|FV|f-ry|rachun\p{L}*|seryjn\p{L}*|fabr\.|s\/n|SN|próbk\p{L}*|ref\.?|ewidencyjn\p{L}*(?:[ \t]+pracownik\p{L}*)?|parti\p{L}*|seri[aiąę]|przesył\p{L}*|paczk\p{L}*|katalogow\p{L}*|produkt\p{L}*|indeks\p{L}*|licznik\p{L}*)[ \t]*(?:(?:nr|numer)\.?[ \t]*)?|(?:nr|numer)\.?[ \t]*(?:umow\p{L}*|zamówie\p{L}*|zlece\p{L}*)[ \t]*)[:#]?[ \t]*$/iu;

/** Callback dla RE_KW_VALUE. Przy `inUrl` kotwicą jest tylko parametr numeru księgi tuż przed
 *  wartością. */
export function maskKwMatch(ctx: RedactCtx, inUrl = false) {
  let prevEnd = -1;
  return (
    m: string,
    code: string,
    numSlash: string | undefined,
    numSpace: string | undefined,
    c: string,
    offset: number,
    t: string,
  ): string => {
    const num = numSlash ?? numSpace ?? '';
    const before = t.slice(Math.max(0, offset - 40), offset);
    const after = t.slice(offset + m.length, offset + m.length + 2);
    if ((/[\p{L}\d][.-]$/u.test(before) || /^\.\p{L}/u.test(after)) && RE_KW_ZNAK_BEFORE.test(before)) return m;
    const anchored = inUrl
      ? RE_KW_URL_PARAM.test(before)
      : // Wyliczenie niesie kotwicę tylko na kod znanego sądu, nie na fakturę („KW nr KR1P/…, FV1A/…").
        (prevEnd >= 0 &&
          offset - prevEnd <= 12 &&
          KW_COURT_PREFIXES.has(code.slice(0, 2).toUpperCase()) &&
          RE_KW_LIST_GAP.test(t.slice(prevEnd, offset))) ||
        kwAnchoredBefore(t, offset);
    const valid = isValidKw(`${code}${num}${c}`);
    // Bez kotwicy tylko pełna pewność: wielkie litery, ukośniki, znany sąd i poprawna cyfra
    // kontrolna. Przy kotwicy maskujemy mimo złej sumy (literówka w piśmie), jak PESEL po „PESEL:".
    const ok =
      anchored ||
      (!RE_KW_OTHER_LABEL.test(before) &&
        /^[A-Z]{2}\d[A-Z]$/.test(code) &&
        m.split('/').length === 3 &&
        KW_COURT_PREFIXES.has(code.slice(0, 2)) &&
        valid);
    if (!ok) return m;
    // Wyliczenie otwiera tylko numer z kotwicą: numer pewny sam w sobie (sąd + suma) nie przenosi
    // kotwicy na sąsiedni kod („KR1P/…;ZZ9Z/…;OK", „WA1M/… i AB1C/… szt.").
    if (anchored) prevEnd = offset + m.length;
    ctx.bump('KW');
    // „KR1P 00123456 2 lokale": numer bez cyfry kontrolnej, a „2" to liczebnik z prozy. Przy
    // spacjach i złej sumie, gdy dalej stoi wyraz, cyfra zostaje w tekście (numer i tak w masce).
    if (numSpace !== undefined && !valid && /^[ \t]+\p{L}/u.test(t.slice(offset + m.length, offset + m.length + 3))) {
      return ctx.M.KW + m.slice(m.lastIndexOf(numSpace) + numSpace.length);
    }
    return ctx.M.KW;
  };
}

export function passKw(ctx: RedactCtx): void {
  if (!ctx.on('KW')) return;
  ctx.text = ctx.text.replace(RE_KW_VALUE, maskKwMatch(ctx));
}

// Znak sprawy wg JRWA „SYMBOL.klasa.numer.ROK". Lookbehind obejmuje polskie litery, bo start
// w środku ciągu „ŻŻŻ…" dawał czas kwadratowy. Po roku najwyżej dwa człony: symbol komórki
// („.PL") albo numer kolejny („.1"), żeby maska objęła cały znak.
const ZNAK_START = `[${PL_UP}]{2,}[0-9]*(?:-[A-Za-z${PL_UP}${PL_LO}0-9]+)*`;
const ZNAK_MID = `(?:\\.[A-Za-z${PL_UP}${PL_LO}0-9-]+)*?`;
const RE_ZNAK_JRWA = new RegExp(
  `(?<![A-Za-z${PL_UP}${PL_LO}0-9./-])${ZNAK_START}${ZNAK_MID}\\.\\d+\\.(?:19|20)\\d{2}(?:\\.(?:[${PL_UP}]{2,3}|\\d{1,3})){0,2}(?!\\d)`,
  'g',
);
// Znak po etykiecie („Znak sprawy:", „Sygn. akt"): etykieta zostaje, maskujemy sam znak.
const ZNAK_VALUE =
  `(?:[IVXLCDM]{1,4}[ \\t]+)?[${PL_UP}][A-Za-z${PL_LO}]{0,4}(?:/[${PL_UP}][A-Za-z${PL_LO}]{0,3})?[ \\t]+\\d+[ \\t]*/[ \\t]*\\d{2,4}` +
  `|[A-Za-z0-9${PL_UP}${PL_LO}]+(?:[.\\-/][A-Za-z0-9${PL_UP}${PL_LO}]+)+`;
const RE_ZNAK_LABELED = new RegExp(`\\b(${ZNAK_LABEL})([ \\t]*:?[ \\t]*)(${ZNAK_VALUE})`, 'gi');

// Biegnie wcześnie, żeby zamaskować cały znak, zanim kod pocztowy czy telefon odgryzą jego cyfry.
export function passZnakSprawy(ctx: RedactCtx): void {
  if (!ctx.on('ZNAK-SPRAWY')) return;
  ctx.text = ctx.text.replace(RE_ZNAK_JRWA, maskConst(ctx, 'ZNAK-SPRAWY'));
  maskAfterLabel(ctx, RE_ZNAK_LABELED, 'ZNAK-SPRAWY');
}
