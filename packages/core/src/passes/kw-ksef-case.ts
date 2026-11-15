// Przebiegi numeru KSeF, numeru księgi wieczystej i znaku sprawy. Biegną przed NIP-em
// i krótszymi detektorami, żeby maskować całe numery, a nie ich fragmenty.
import { PL_LO, PL_UP } from '../charset.js';
import type { RedactCtx } from '../context.js';
import { isFirstNameLike } from '../dict/names.js';
import { isValidKw, isValidNip } from '../validators.js';

// Numer KSeF: NIP wystawcy (albo „M" + 9 cyfr) + data + 12 znaków hex (w KSeF 1.0 rozbite 6+6)
// + 2 znaki sumy, np. „5265877635-20250826-0100001AF629-AF". Sumy CRC-8 nie sprawdzamy, bo
// numery z KSeF 1.0 jej nie przechodzą; w zamian wymagamy kotwicy „KSeF" w dokumencie.
// Separatorem jest tylko myślnik bez spacji wokół, z łamaniem wiersza wyłącznie po nim: spacja,
// „ - " albo łamanie przed myślnikiem scaliłyby kolumny liczb i listy punktowane w jeden numer.
// Miękki dywiz (U+00AD) pada wewnątrz członów jako artefakt łamania wyrazu, więc nie dzieli.
const KSEF_SEP = '[-\\u2010-\\u2015](?:[ \\t]*\\r?\\n[ \\t\\u00A0\\u2009\\u202F]*)?';
// Wariant „3 litery + 7 cyfr" z FA(3) jest pominięty celowo: w praktyce go nie ma, a łapałby numery
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

/** Liczona raz na oryginalnym wejściu (patrz RedactCtx.raw): to skan całego dokumentu. */
export function hasKsefAnchor(raw: string): boolean {
  return RE_KSEF_ANCHOR.test(raw);
}

/** Słaba kotwica dokumentowa wymaga mocnej wartości: suma NIP-u odróżnia numer KSeF od numeru
 *  zamówienia o tym samym kształcie („4500123456-20260115-000000012345-01"). Wariant „M" + 9 cyfr
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
    return ctx.hit('KSEF');
  };
}

// Przed passZnakSprawy, który dałby numerowi maskę znaku sprawy, i przed passNip, który
// zamaskowałby sam prefiks i zostawił „[NIP]-20250826-0100001AF629-AF".
export function passKsef(ctx: RedactCtx): void {
  if (!ctx.on('KSEF') || !ctx.ksefAnchor) return;
  ctx.text = ctx.text.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
}

// Numer księgi wieczystej „WA1M/00512345/3". Jawny prowadzi przez publiczną przeglądarkę ksiąg
// wprost do właściciela nieruchomości.
// Separator: ukośnik albo łącznik (także z łamaniem wiersza po nim), po kotwicy też spacja; oba
// tego samego rodzaju, bo mieszany („LU1I/00045678 2 działki") wciąga liczbę z prozy. Bez kotwicy
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
// w środku ciągu „ŻŻŻ…" daje czas kwadratowy. Po roku najwyżej dwa człony: symbol komórki
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

/**
 * Repertoria sądów, których orzeczenia cytuje się jako linię orzeczniczą: NSA i WSA (OSK, FSK, GSK,
 * uchwały OPS/FPS/GPS, zażalenia OZ/FZ/GZ, SA/xx, SAB/xx), Sąd Najwyższy (CSK, CSKP, CZP, CNP, UK,
 * USK, USKP, UZP, PSKP, KK, KZP, PK, Izba Kontroli NSNc/NSNk…), KIO i TSUE (C-…/21, T-…/20). Repertoria sądów
 * powszechnych (C, Ca, ACa, Nc, Ns, Nsm, RC, RNs, Co, K, W, U, AUa, P, GU…) dotyczą spraw konkretnych
 * osób, więc ich sygnatura zostaje zakryta także z zapowiedzią cytatu. Wielkość liter ma znaczenie:
 * dwuliterowe repertoria SN, które wersalikami zlewają się z repertoriami sądów powszechnych
 * (CZ/Cz, KZ/Kz, CO/Co, KO/Ko, UZ/Uz, PZ/Pz), są pominięte.
 */
const RE_CITEABLE_REPERTORY = new RegExp(
  '^(?:[IVX]{1,4}[ \\t]+(?:OSK|FSK|GSK|OPS|FPS|GPS|OZ|FZ|GZ|OPK|FPK|GPK|CSKP?|CZP|CNPP?|USKP?|UZP|UK|PSKP?|KK|KZP|PK|PZP|NSN\\p{Ll}|NSK|NKRS|(?:SAB?|SO)/\\p{L}{2,3})[ \\t]+\\d' +
    '|KIO(?:/[A-Z]{2,4})?[ \\t]+\\d|[CTF]-\\d{1,4}/\\d{2})',
  'u',
);
/** Sygnatura Trybunału Konstytucyjnego (bez numeru wydziału): tylko przy „Trybunał”/„TK” w zdaniu. */
const RE_TK_REPERTORY = /^(?:K|P|SK|U|Kp|Ts|Tw|Pp|Kpt)[ \t]+\d+\/\d{2}/;
const RE_TK_WORD = /(?<!\p{L})(?:trybuna\p{L}*|TK)(?!\p{L})/iu;
/** Czasownik tezy z „że” („stwierdził, że”, „uznała przy tym, że”): po nim następuje teza sądu. */
const THESIS =
  '(?:wskaz|podkreśl|zauważ|przypomn|przypomin|stwierdz|wyjaśn|uzna|uznaj|przyj|przesądz|zaznacz|akcentuj|orzek|wywi[óo]d)\\p{L}*,?[ \\t]+(?:\\p{L}+[ \\t]+){0,2}?że(?!\\p{L})';
const RE_THESIS = new RegExp(THESIS, 'iu');
/** Rodzaj orzeczenia albo sąd w zdaniu („w wyroku z dnia…”, „uchwała SN”, „NSA wyjaśnił”). */
const RE_RULING_WORD =
  /(?<!\p{L})(?:wyrok|postanowieni|uchwał|uchwale(?!\p{L})|orzecz|orzek|NSA(?!\p{L})|WSA(?!\p{L})|SN(?!\p{L})|KIO(?!\p{L})|TSUE(?!\p{L})|trybuna)/iu;
/**
 * Zapowiedź cytatu w zdaniu z sygnaturą, przed nią albo po niej. Są to zwroty, którymi pismo
 * urzędowe przywołuje cudze orzeczenie jako argument, a nie dokument z akt: odesłanie („por.”,
 * „zob.”, „vide”), porównanie („podobnie”, „analogicznie”, „tak też”), linia orzecznicza
 * („orzecznictwo”, „stanowisko”, „pogląd”, „teza”, „utrwalony”, „wyrażony”, „przyjęty”), przywołanie
 * („przywołuje”, „powołuje się na”, „odwołuje się do”, „wskazuje na wyrok”, „według”, „wynika z”,
 * „przedmiotem uchwały”, „wypowiedział się”, „zwrócił uwagę”, „podziela”) oraz czasownik tezy
 * z „że” („stwierdził, że”, „wyjaśnił, że”, „uznał, że”, „podkreślił, że”, „przesądził, że”).
 * Samo „m.in.” czy „np.” cytatu nie dowodzi: tak wylicza się też dokumenty w aktach sprawy.
 */
const RE_CITE_MARKER = new RegExp(
  `(?<!\\p{L})(?:${[
    'por\\.',
    'zob\\.',
    'vide',
    'tak (?:też|samo|również)',
    'podobnie',
    'analogicz',
    'w podobnej sprawie',
    'w tej kwestii',
    'na tle',
    'orzecznictw',
    'orzecznicz',
    'stanowisk',
    'utrwalon',
    'pogląd',
    'wyrażon',
    'przyjęt',
    'potwierdz',
    'tez(?:a|y|ie|ę|ą)(?!\\p{L})',
    'przywoł',
    'powoł\\p{L}*[ \\t]+się',
    'odwoł\\p{L}*[ \\t]+się',
    'według',
    'wedle',
    'wynika(?:ją)?[ \\t]+z',
    'przedmiotem[ \\t]+(?:uchwał|rozważań|analiz|wyrok|orzecz|postanowie)',
    'wypowiedzia\\p{L}*',
    'zwr(?:ó|a)ci\\p{L}*[ \\t]+uwag',
    'zwraca\\p{L}*[ \\t]+uwag',
    'podziel',
    'warto[ \\t]+(?:przywoł|wskaz|przytocz)',
    'przytocz',
    'wskaz\\p{L}*(?:[ \\t]+należy)?[ \\t]+na[ \\t]+(?:wyrok|uchwał|postanowieni|orzecz|stanowisk|pogląd)',
    '(?:jak|co)[ \\t]+(?:to[ \\t]+)?(?:już[ \\t]+)?(?:trafnie[ \\t]+|słusznie[ \\t]+)?(?:wskaz|podkreśl|zauważ|stwierdz|wyjaśn|przyj|wynik|zaznacz|potwierdz)',
    THESIS,
    'tak(?:[ \\t]*:|[ \\t]+(?:m\\.[ \\t]?in\\.|np\\.|NSA|WSA|SN|TK|KIO|TSUE|sąd|trybuna))',
  ].join('|')})|(?<!\\p{L})(?:LEX|Legalis|CBOSA|ONSA|OSNC|OSNK|OSNP|OSP|OTK|ZOTSiS)(?!\\p{L})`,
  'iu',
);
/**
 * Ślad sprawy osoby w zdaniu z sygnaturą (przed albo po niej): zwrot do adresata („pan”, „panie”,
 * „pani”, „państwo”), rola strony (powód, wnioskodawczyni, ubezpieczony, podatnik, skazany,
 * małoletni…), rozstrzygnięcie o osobie (uchylił, oddalił, zasądził, przysądził, ukarano, eksmitowano,
 * ogłoszono upadłość, umieszczenie, uznany za winnego, alimenty, władza rodzicielska, przywrócenie
 * do pracy), dokument z akt (odpis, przedłożył, załączył, „do akt”, „w aktach”), przedmiot sprawy
 * („w przedmiocie”, „dotyczący”, „na korzyść”, „na rzecz”, „przeciwko”, „wobec”) i „z powództwa”,
 * „z wniosku”, „ze skargi”, „w jej sprawie”. Lista nie musi być pełna: jawne zostają tylko
 * repertoria linii orzeczniczej (RE_CITEABLE_REPERTORY), a nazwa osoby w okolicy zawsze zakrywa.
 * OWN_ROLES to role i zwrot do adresata bez ogólnego „strona”, które pada też w tezach sądów.
 */
const OWN_ROLES = [
  'pan(?:a|i|ie|u|em|ią|owie)?(?!\\p{L})',
  'państw',
  'pańsk',
  'szanown',
  'pow(?:ód|oda|odowi|odem|odów|odami|odom|ódk|ódce)',
  'pozwan',
  'wnioskodaw',
  'uczestni[kc]',
  'oskarżon',
  'obwinion',
  'skazan',
  'ubezpieczon',
  'odwołując',
  'dłużni[kc]',
  'wierzyciel',
  'podatni[kc]',
  'płatni[kc]',
  'skarżąc',
  'skarżon',
  'zaskarżon',
  'pokrzywdzon',
  'spadkobierc',
  'spadkodawc',
  'małoletn',
  'nieletn',
];
const RE_OWN_ROLE = new RegExp(`(?<!\\p{L})(?:${OWN_ROLES.join('|')})`, 'iu');
const RE_OWN_CASE = new RegExp(
  `(?<!\\p{L})(?:${[
    ...OWN_ROLES,
    'stron(?:a|y|ie|ę|ą|om|ami)?(?!\\p{L})',
    'uchyl',
    'oddal',
    'zasądz',
    'przysądz',
    'przyzna',
    'umorz',
    'odrzuc',
    'uniewinni',
    'skaza',
    'ukara',
    'eksmit',
    'upadłoś',
    'umieszcz',
    'winn(?:ym|ego|ą|a)(?!\\p{L})',
    'aliment',
    'władz\\p{L}*[ \\t]+rodziciel',
    'piecz\\p{L}*[ \\t]+zastępcz',
    'kurator',
    'przywr(?:ó|a)c\\p{L}*[ \\t]+do[ \\t]+pracy',
    'stwierdz\\p{L}*[ \\t]+nabyci',
    'zmieni(?:ł|ła|ło|li|ono|ając|on)',
    'uwzględni\\p{L}*[ \\t]+(?:skarg|apelac|odwoła|wnios|powództw|zażal|kasac)',
    'prawomocn',
    'ponown',
    'wykonuj',
    'wykonując',
    'w wykonaniu',
    'odpis',
    'przedłoż',
    'załącz',
    'dołącz',
    'przedstawi(?:ł|ła|ło|li|ono|ając|a(?!\\p{L}))',
    'przesyła',
    'przekaza',
    'doręcz',
    'do akt',
    'w aktach',
    'akt(?:a|ach)?[ \\t]+sprawy',
    'dot\\.',
    'dotycz\\p{L}*[ \\t]+(?:\\p{L}+[ \\t]+){0,2}?(?:jej|jego|ich|pan|pani|państw|mnie|moj|nasz|wasz|niniejsz|przedmiotow|tej[ \\t]+spraw)',
    'w przedmiocie',
    'na korzyść',
    'z powództwa',
    'z wniosku',
    'z odwołania',
    'ze skargi',
    'przeciwko',
    'wobec',
    'na rzecz',
    'zapad\\p{L}*[ \\t]+w[ \\t]+sprawie',
    'w (?:jej|jego|ich|tej|niniejszej|przedmiotowej|pana|pani|państwa) sprawie',
  ].join('|')})|(?<!\\p{L})w sprawie(?:[ \\t]+(?:o|z))?[ \\t]*$`,
  'iu',
);
/** „w sprawie Jana Kowalskiego”, „skarga Janiny Pawlak”: nazwa własna po „w sprawie” i „skarga”. */
const RE_CASE_OF_NAME =
  /(?<!\p{L})(?:[Ww] sprawie|[Ss]karg\p{L}*)[ \t]+(?:\p{Lu}\p{Ll}|[Pp]an|[Ss]tron|[Ww]nios|[Ss]karżąc)/u;
/** Zwrot do adresata: „pan”, „pani”, „państwo” bez nazwiska po nim („informuję Panią”, „Szanowna Pani,”). */
const RE_ADDRESSEE = /(?<!\p{L})(?:[Pp]an(?:a|i|ie|u|em|ią|owie)?|[Pp]aństw\p{L}*|[Ss]zanown\p{L}*)(?!\p{L})(?![ \t]+\p{Lu})/u;
/** „Pan Kozieł”, „Pani Ewy Wróbel”: osoba nazwana z grzecznościowym zwrotem. */
const RE_PAN_NAME = /(?<!\p{L})[Pp]an(?:a|i|ie|u|em|ią)?[ \t]+\p{Lu}\p{Ll}/u;
/** Słowa wiążące zdanie obok z orzeczeniem albo sprawą sądową („Wyrok zapadł…”, „złożyła skargę”). */
const RE_CASE_LINK =
  /(?<!\p{L})(?:wyrok|wyrocz|spraw|skarg|sąd|sądz|orzecz|postanowi|uchwał|apelac|kasac|odwoła|wnios|powództw|pozew|pozwu|pozwem)/iu;
/** Wyraz z wielkiej litery przed następnym wyrazem z wielkiej litery („Tomasza Wrony”, „Ewy Wróbel”). */
const RE_CAP_PAIR = /(?<!\p{L})(\p{Lu}\p{Ll}+)(?=[ \t\r\n]+\p{Lu}\p{Ll})/gu;

/** Imię (także odmienione) przed wyrazem z wielkiej litery: osoba w okolicy sygnatury. */
function hasPersonName(s: string): boolean {
  RE_CAP_PAIR.lastIndex = 0;
  for (let m = RE_CAP_PAIR.exec(s); m; m = RE_CAP_PAIR.exec(s)) if (isFirstNameLike(m[1])) return true;
  return false;
}
/** Osoba w wycinku: zwrot do adresata, „Pani Nowak”, imię z nazwiskiem, „w sprawie Jana…”. */
function personNamed(s: string): boolean {
  return RE_ADDRESSEE.test(s) || RE_PAN_NAME.test(s) || RE_CASE_OF_NAME.test(s) || hasPersonName(s);
}
/** Ślad sprawy osoby w zdaniu z sygnaturą: słowo sprawy, rola albo osoba. */
function ownCase(s: string): boolean {
  return RE_OWN_CASE.test(s) || personNamed(s);
}
/**
 * Zdanie przed i po zdaniu z sygnaturą: zwrot do adresata albo osoba razem ze słowem sprawy
 * sądowej („Pani Ewa Wróbel złożyła skargę.”, „Wyrok zapadł ze skargi Pani Ewy Wróbel.”). Sama
 * osoba bez takiego słowa („Organ zbadał zarzuty Pana Kozła.”) nie wiąże z nią cytatu.
 */
function neighbourCase(s: string): boolean {
  if (RE_ADDRESSEE.test(s)) return true;
  if (!(RE_PAN_NAME.test(s) || hasPersonName(s) || RE_CASE_OF_NAME.test(s))) return false;
  return RE_CASE_LINK.test(s);
}

/** Kandydat na koniec zdania: kropka, wykrzyknik albo pytajnik przed wielką literą. */
const RE_SENTENCE_STOP = /[.!?](?=[ \t\r\n]+[A-ZĄĆĘŁŃÓŚŹŻ])/gu;
/**
 * Skróty, po których kropka nie kończy zdania („z dnia 24 maja 2018 r. Naczelny Sąd…”, „art. 7”,
 * „Dz. U.”, „sygn.”, „ust.”, „poz.”). Jedna albo dwie litery przed kropką też nie kończą zdania.
 */
const ABBREV = new Set<string>(
  'art ust poz pkt lit sygn akt tj zm późn nr str tzw ww wyd red zał tys mln mld ok godz prof ' +
    'dr hab inż mgr im ul al pl os św por zob np tj tzn cyt dot ozn sp zw ds wz cdn bm br ub'.split(' '),
);
const RE_WORD_BEFORE_DOT = /(\p{L}+)\.$/u;
/** Pozycje końców zdań w wycinku (indeks znaku po kropce), z pominięciem skrótów. */
function sentenceStops(s: string): number[] {
  const out: number[] = [];
  RE_SENTENCE_STOP.lastIndex = 0;
  for (let m = RE_SENTENCE_STOP.exec(s); m; m = RE_SENTENCE_STOP.exec(s)) {
    if (m[0] === '.') {
      const w = RE_WORD_BEFORE_DOT.exec(s.slice(Math.max(0, m.index - 12), m.index + 1));
      if (w && (w[1].length <= 2 || ABBREV.has(w[1].toLowerCase()))) continue;
    }
    out.push(m.index + 1);
  }
  return out;
}
/** Granica akapitu: pusty wiersz. Pojedyncze łamanie wiersza (PDF, Word) nie kończy zdania. */
const RE_PARAGRAPH = /\n[ \t]*\r?\n/g;
/** Twarde łamanie wiersza dla zapowiedzi cytatu: następny wiersz nie zaczyna się małą literą ani cyfrą. */
const RE_HARD_NEWLINE = /\n(?![ \t]*[\p{Ll}\d])/gu;
/** Porównanie z inną sprawą: „por.”, „zob.”, „vide”, „podobnie”, „analogicznie”, „tak też”. */
const RE_COMPARISON =
  /(?<!\p{L})(?:por\.|zob\.|vide(?!\p{L})|podobn\p{L}*|analogiczn\p{L}*|tak (?:też|samo|również)|w podobnej sprawie)/iu;
/** Nawias otwierający cytat („(por. wyrok…”, „(zob. postanowienie…”). */
const RE_CITE_PAREN = /^\([ \t]*(?:por\.|zob\.|vide|tak|podobnie)/i;
/** Zasięg wycinka z każdej strony etykiety (zdanie z sygnaturą i zdania obok). */
const CITE_WINDOW = 300;

function lastMatchEnd(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let end = -1;
  for (let m = re.exec(s); m; m = re.exec(s)) end = m.index + m[0].length;
  return end;
}
function firstMatchIndex(re: RegExp, s: string): number {
  re.lastIndex = 0;
  const m = re.exec(s);
  return m ? m.index : -1;
}

/**
 * Sygnatura cytowanego orzeczenia, a nie sprawy osoby. Wszystkie warunki naraz:
 * 1) repertorium sądu, którego orzeczenia tworzą linię orzeczniczą (NSA, WSA, SN, TK, KIO, TSUE);
 * 2) w zdaniu z sygnaturą stoi rodzaj orzeczenia albo sąd oraz zapowiedź cytatu, przed sygnaturą
 *    albo po niej („Sąd X w wyroku …, sygn. akt …, stwierdził, że”);
 * 3) w zdaniu nie ma śladu sprawy osoby (rola, rozstrzygnięcie o osobie, dokument z akt, zwrot do
 *    adresata, imię i nazwisko), a w zdaniu przed i po nim nie ma zwrotu do adresata ani imienia
 *    z nazwiskiem powiązanego ze sprawą („Wyrok zapadł ze skargi …”, „… złożyła skargę”).
 * Zdanie liczy się do pustego wiersza: łamanie wiersza z PDF-u czy Worda go nie ucina. Nawias
 * z „por.”/„zob.” zawęża zdanie do siebie („…Pana Zająca … (por. wyrok …)”).
 */
function isCitedRuling(t: string, offset: number, end: number, value: string): boolean {
  const tk = RE_TK_REPERTORY.test(value);
  if (!tk && !RE_CITEABLE_REPERTORY.test(value)) return false;
  // Wycinek w granicach akapitu.
  let wideBefore = t.slice(Math.max(0, offset - CITE_WINDOW), offset);
  const par = lastMatchEnd(RE_PARAGRAPH, wideBefore);
  if (par >= 0) wideBefore = wideBefore.slice(par);
  let wideAfter = t.slice(end, end + CITE_WINDOW);
  const parA = firstMatchIndex(RE_PARAGRAPH, wideAfter);
  if (parA >= 0) wideAfter = wideAfter.slice(0, parA);
  // Zdanie z sygnaturą i po jednym zdaniu z każdej strony.
  const stopsB = sentenceStops(wideBefore);
  const curStart = stopsB.length ? stopsB[stopsB.length - 1] : 0;
  const prevStart = stopsB.length > 1 ? stopsB[stopsB.length - 2] : 0;
  const stopsA = sentenceStops(wideAfter);
  const curEnd = stopsA.length ? stopsA[0] : wideAfter.length;
  const nextEnd = stopsA.length > 1 ? stopsA[1] : wideAfter.length;
  let before = wideBefore.slice(curStart);
  let after = wideAfter.slice(0, curEnd);
  const neighbours = `${wideBefore.slice(prevStart, curStart)} ${wideAfter.slice(curEnd, nextEnd)}`;
  // Nawias z „por.”/„zob.”: cytat to sam nawias.
  const paren = before.lastIndexOf('(');
  const inParen = paren >= 0 && !before.includes(')', paren) && RE_CITE_PAREN.test(before.slice(paren));
  if (inParen) {
    before = before.slice(paren);
    const close = after.indexOf(')');
    if (close >= 0) after = after.slice(0, close);
  }
  // Teza sądu po „stwierdził, że” mówi o prawie, nie o stronie: sprawdzamy w niej tylko osobę
  // i jej rolę (imię z nazwiskiem, zwrot do adresata, wnioskodawczyni, skarżący), a nie słowa
  // rozstrzygnięcia („nie mógł odrzucić oferty”, „organ uchyla decyzję”).
  const thesis = RE_THESIS.exec(after);
  const afterCore = thesis ? after.slice(0, thesis.index + thesis[0].length) : after;
  const thesisText = thesis ? after.slice(thesis.index + thesis[0].length) : '';
  if (ownCase(before) || ownCase(afterCore) || personNamed(thesisText) || RE_OWN_ROLE.test(thesisText))
    return false;
  // Porównanie („podobnie”, „por.”, „analogicznie”) mówi o innej sprawie niż ta z pisma, więc osoba
  // ze zdania obok nie wiąże się z cytatem; w samym zdaniu z sygnaturą ślad osoby dalej zakrywa.
  if (!inParen && !RE_COMPARISON.test(`${before} ${after}`) && neighbourCase(neighbours)) return false;
  // Zapowiedź cytatu i rodzaj orzeczenia szukane tylko w wierszu sygnatury i jego miękkich
  // przedłużeniach: nagłówek pisma w wierszu wyżej cytatu nie zapowiada.
  const hardB = lastMatchEnd(RE_HARD_NEWLINE, before);
  const strictBefore = hardB >= 0 ? before.slice(hardB) : before;
  const hardA = firstMatchIndex(RE_HARD_NEWLINE, after);
  const strictAfter = hardA >= 0 ? after.slice(0, hardA) : after;
  const sentence = `${strictBefore} ${strictAfter}`;
  if (tk && !RE_TK_WORD.test(sentence)) return false;
  return RE_RULING_WORD.test(sentence) && RE_CITE_MARKER.test(sentence);
}

// Biegnie wcześnie, żeby zamaskować cały znak, zanim kod pocztowy czy telefon odgryzą jego cyfry.
// Sygnatura cytowanego orzeczenia zostaje jawna: to podstawa prawna, nie znak sprawy strony.
export function passZnakSprawy(ctx: RedactCtx): void {
  if (!ctx.on('ZNAK-SPRAWY')) return;
  ctx.text = ctx.text.replace(RE_ZNAK_JRWA, () => ctx.hit('ZNAK-SPRAWY'));
  ctx.text = ctx.text.replace(
    RE_ZNAK_LABELED,
    (m: string, kw: string, sep: string, value: string, offset: number, t: string): string =>
      /^sygn/i.test(kw) && isCitedRuling(t, offset, offset + m.length, value)
        ? m
        : `${kw}${sep}${ctx.hit('ZNAK-SPRAWY')}`,
  );
}
