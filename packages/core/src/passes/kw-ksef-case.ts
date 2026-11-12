import { PL_LO, PL_UP } from '../charset.js';
import { maskAfterLabel, maskConst, type RedactCtx } from '../context.js';
import { isValidKw, isValidNip } from '../validators.js';


// ── NUMER KSeF (Krajowy System e-Faktur) ──────────────────────────────────────
// Budowa: NIP wystawcy + data przyjęcia + 12 znaków technicznych + suma kontrolna, np.
// „5265877635-20250826-0100001AF629-AF" (35 znaków). KSeF 1.0 nadawał wariant 36-znakowy
// z częścią techniczną rozbitą na 6+6 („7781464139-20230721-80B510-9675F7-B5") — oba są
// w obiegu (numery starych faktur nie znikają), więc oba maskujemy. Schemat FA(3) dopuszcza
// w pierwszym członie także „M" + 9 cyfr oraz 3 litery + 7 cyfr (podmioty bez NIP).
//
// SUMY KONTROLNEJ NIE WALIDUJEMY: to CRC-8 (poly 0x07, init 0x00) liczone po znakach części
// danych — zgadza się dla numerów z KSeF 2.0, ale numerów z KSeF 1.0 NIE przechodzi (znane
// rozbieżności w repozytoriach MF). Twardy warunek odrzucałby prawdziwe numery, czyli wyciek.
// Zamiast sumy wymagamy KOTWICY „KSeF" — bez niej nie maskujemy (precyzja > nadmaskowanie).
//
// Separator to WYŁĄCZNIE myślnik (też półpauza/pauza/dywiz miękki), z dopuszczalnym złamaniem
// wiersza i cienką spacją wokół — numer bywa łamany w wąskiej kolumnie i autokorygowany przez
// edytor. SAMA SPACJA jako separator jest ODRZUCONA: audyt adwersarialny pokazał, że wzorzec
// „10 cyfr · 8 cyfr · 12 znaków · 2 znaki" rozdzielony spacjami zjada cztery sąsiednie KOLUMNY
// liczb w raporcie („KSeF 5265877635 20250826 000000012345 23") — to nadmaskowanie.
// Złamanie wiersza dopuszczamy TYLKO PO myślniku (tak łamie edytor i PDF: dywiz zostaje na końcu
// linii). Newline PRZED myślnikiem odpada, bo scalałby listę punktowaną „- 5265877635\n- 20250826…"
// w jeden numer — kolejny wariant nadmaskowania z audytu.
// Wokół myślnika NIE MA spacji: dopuszczenie ich scalało kolumny zestawienia rozdzielone „ - "
// („5265877635 - 20250826 - 145000 - 118700 - 23") w jeden numer. Dozwolone jest tylko złamanie
// wiersza PO myślniku (z wcięciem kolejnej linii) — tak numer łamie edytor i PDF.
// Miękki dywiz (U+00AD) NIE jest separatorem: w realnym tekście pada WEWNĄTRZ członu (artefakt
// łamania wyrazu), a w klasie separatora otwierał kształt „ciąg cyfr bez widocznego myślnika".
const KSEF_SEP = '[-\\u2010-\\u2015](?:[ \\t]*\\r?\\n[ \\t\\u00A0\\u2009\\u202F]*)?';
// Wariant pierwszego członu „3 litery + 7 cyfr" (dopuszczony w XSD FA(3), w praktyce niespotykany)
// jest CELOWO pominięty: łapał numery inwentarzowe, seryjne, partii i wydań („SRV2026001-20260108-
// 000000004512-03") w dokumentach, w których słowo „KSeF" pada przy okazji. Data jest walidowana
// zakresowo (rok 20xx, miesiąc 01–12, dzień 01–31), a NIP w pierwszym członie — sumą kontrolną
// (patrz passKsef): przy kotwicie dokumentowej sam kształt to za mało.
const KSEF_HEAD = '(?:\\d{10}|[Mm]\\d{9})';
const KSEF_DATE = '20\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])';
const KSEF_VALUE =
  `${KSEF_HEAD}${KSEF_SEP}${KSEF_DATE}${KSEF_SEP}` +
  `(?:[0-9A-Fa-f]{6}${KSEF_SEP}[0-9A-Fa-f]{6}|[0-9A-Fa-f]{12})${KSEF_SEP}[0-9A-Fa-f]{2}`;
/**
 * KOTWICA DOKUMENTOWA. Numer maskujemy tylko wtedy, gdy w tekście W OGÓLE pada „KSeF" (albo
 * rozwinięta nazwa systemu) — kotwica sąsiedzka zawodziła w realnych pismach: etykieta bywa
 * w nagłówku kolumny tabeli, po numerze („…-AF — to numer KSeF"), w znacznikach („**Nr KSeF:**",
 * „<td>Nr KSeF</td>"), a pod jedną etykietą stoi wyliczenie kilku numerów. Kształt numeru jest
 * na tyle sztywny (NIP + data + 12 znaków hex + suma), że w dokumencie mówiącym o KSeF nie ma
 * czego innego pomylić — numer referencyjny sesji zaczyna się od DATY, nie od NIP-u.
 */
const RE_KSEF_ANCHOR = /ksef|krajow\w*\s+system\w*\s+e[-‐-―]?faktur/i;
// Granice BEZ myślnika: numer bywa doklejony myślnikiem do etykiety („Nr KSeF-5265877635-…"),
// nazwy pliku („faktura-5265877635-…-AF.xml") czy segmentu ścieżki — wtedy zakaz myślnika
// z boku zostawiał jawny NIP. Dłuższy identyfikator zawierający kształt numeru KSeF i tak
// niesie NIP wystawcy, więc maskujemy.
export const RE_KSEF_VALUE = new RegExp(`(?<![0-9A-Za-z])${KSEF_VALUE}(?![0-9A-Za-z])`, 'g');

/** Kotwica liczona na ORYGINALNYM wejściu: „ksef.mf.gov.pl" w linku albo „ksef@mf.gov.pl"
 *  w stopce bywa jedyną wzmianką o systemie, a wcześniejsze przebiegi już je skasowały. */
export function hasKsefAnchor(ctx: RedactCtx): boolean {
  return RE_KSEF_ANCHOR.test(ctx.raw);
}

/**
 * Maskuje dopasowanie TYLKO wtedy, gdy pierwszy człon jest poprawnym NIP-em. Kotwica jest
 * dokumentowa (słabsza niż etykieta tuż przy numerze), więc sumę kontrolną NIP-u traktujemy jako
 * drugą warstwę: bez niej numery zamówień i identyfikatory korelacji o tym samym kształcie
 * („4500123456-20260115-000000012345-01") znikały w dokumentach wspominających KSeF.
 * Wariant „M" + 9 cyfr (podmiot bez NIP wg FA(3)) sumy nie ma — tam decyduje sam kształt.
 */
export function maskKsefMatch(ctx: RedactCtx) {
  return (m: string): string => {
    const head = (m.match(/^[Mm]?\d+/) as RegExpMatchArray)[0];
    // (1) LOSOWOŚĆ części technicznej. Prawdziwy numer KSeF ma tam 14 znaków hex — szansa, że
    // nie padnie ani jedna litera A–F, to ~0,14%. Za to numery zamówień, seryjne i sklejone
    // kolumny kwot mają tam same cyfry, a sama suma NIP ich nie odsiewa: przechodzi ją co 11.
    // losowy ciąg 10 cyfr (zmierzone 8,97%).
    if (!/[A-Fa-f]/.test(m.slice(head.length))) return m;
    // (2) Suma kontrolna NIP-u w głowie 10-cyfrowej. Zero wiodące odrzucamy wprost — żaden NIP
    // nie zaczyna się od zera (pierwsze trzy cyfry to kod urzędu skarbowego), a suma je puszcza.
    if (/^\d{10}$/.test(head) && (head.startsWith('0') || !isValidNip(head))) return m;
    ctx.bump('KSEF');
    return ctx.M.KSEF;
  };
}

// 1e) NUMER KSeF — biegnie PRZED passZnakSprawy (kształt numeru pasuje do wzorca znaku sprawy
// i dostawał maskę [ZNAK-SPRAWY]) oraz PRZED passNip: pierwszy człon numeru KSeF to NIP
// z poprawną sumą, więc bez tego przebiegu passNip zjadał sam prefiks i zostawiał
// „[NIP]-20250826-0100001AF629-AF" (wyciek fragmentu — „maskuj całość, nie fragment").
export function passKsef(ctx: RedactCtx): void {
  if (!ctx.on('KSEF')) return;
  if (!hasKsefAnchor(ctx)) return;
  ctx.text = ctx.text.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
}

// 1e') NUMER KSIĘGI WIECZYSTEJ — PRZED passZnakSprawy: kształt „XXXX/NNNNNNNN/C" po etykiecie
// „Sygn." albo „Znak:" pasuje do wartości znaku sprawy, a jawny numer KW przez publiczną
// przeglądarkę ksiąg prowadzi wprost do właściciela nieruchomości.
// Ukośnik może otaczać odstęp, a po ukośniku może się złamać wiersz (tak łamie numer edytor).
// Po kotwicy separatorem bywa też sama spacja albo myślnik („KW WA1M 00512345 3"); bez kotwicy
// wymagamy ukośników (patrz passKw), bo trzy człony rozdzielone spacją to zbyt pospolity układ.
// Oba separatory tego samego rodzaju: mieszany „LU1I/00045678 2 działki" to numer zapisany bez
// cyfry kontrolnej, a spacja wciągała z prozy następną liczbę („2 działki" → „działki").
// Łącznik z ciągiem dalej („WA1M/00512345/6-12") to dłuższy znak sprawy, który passZnakSprawy
// maskuje w całości; odcięty numer zostawiał jawny przyrostek.
const KW_SLASH = '[ \\t]*[/-][ \\t]*(?:\\r?\\n[ \\t]*)?';
const KW_SHAPE = `([A-Za-z]{2}[1-9][A-Za-z])(?:${KW_SLASH}(\\d{8})${KW_SLASH}|[ \\t]+(\\d{8})[ \\t]+)(\\d)`;
export const RE_KW_VALUE = new RegExp(
  `(?<![\\p{L}\\d/])${KW_SHAPE}(?![\\p{L}\\d/]|[.,]\\d|[-–][\\p{L}\\d])`,
  'gu',
);
/** Pierwsze dwie litery kodów wydziałów ksiąg wieczystych (obszary sądów okręgowych). Bez kotwicy
 *  maskujemy tylko te: sama cyfra kontrolna przepuszcza co dziesiąty kod produktu o tym kształcie
 *  („AB1C/12345678/7"), a znana para liter zawęża to kilkunastokrotnie. Brak pary na liście
 *  kosztuje najwyżej przeoczenie numeru bez słowa „KW" obok. */
const KW_COURT_PREFIXES = new Set(
  ('BB BI BY CZ EL GD GL GW JG KA KI KN KO KR KS KZ LD LE LM LU NS OL OP OS PL PO PR PT RA RZ ' +
    'SI SL SR SU SW SZ TB TO TR WA WL WR ZA ZG').split(' '),
);
/** Kotwica przed numerem: „KW" wielkimi literami jako osobny wyraz (także „nr KW", „Nr_KW",
 *  „<NumerKW>"), „Kw nr", „nr kw", dowolna odmiana „księga wieczysta" („w księdze wieczystej",
 *  „ksiąg wieczystych", także bez ogonków i sklejona w kluczu „numerKsiegiWieczystej") i skrót
 *  „ks. wiecz.". Samo małe „kw." to kwartał albo kwiecień, dlatego bez flagi /i: małe litery
 *  liczą się tylko po „nr"/„numer". Wielkie „KW" to też kilowaty („agregat 20 KW"), Komenda
 *  Wojewódzka („KW Policji", „KW PSP") i nazwa towaru („Zestaw KW-2") — te nie są etykietą księgi. */
const RE_KW_ANCHOR =
  /(?:(?<![\p{L}\d])(?<!\d[ \t]{0,2})(?:[Nn](?:umer|r)[_-]?)?KW(?![\p{L}\d]|-\d|[ \t]+(?:Policji|PSP|PP)(?!\p{L}))|(?<!\p{L})Kw\.?(?=[ \t]+nr)|(?<![\p{L}\d])[Nn](?:umer|r)\.?[ \t_-]*kw(?![\p{L}\d])|(?:[Kk]si(?:[eęą]g|[eę]dz)|KSI(?:[EĘĄ]G|[EĘ]DZ))\p{L}{0,3}[ \t_-]*(?:[Ww]ieczyst|WIECZYST)\p{L}{0,3}|(?<!\p{L})[Kk]s\.[ \t]*wiecz\.)/u;
/** Koniec zdania w oknie kotwicy. Kropka po „nr" czy skrócie „wiecz." to nie koniec zdania; po
 *  „KW." tylko wtedy, gdy dalej stoi „Nr" („KW. Nr WA1M/…"). „Pismo przekazano do KW. Faktura …"
 *  kończy zdanie, inaczej kotwica przechodziła na numer faktury w następnym zdaniu. */
const RE_KW_SENTENCE_END =
  /(?<!(?:\b[Nn]r|wiecz|\bks))(?<!\b[Kk][Ww](?=\.[ \t]+Nr(?!\p{L})))[.!?](?=[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ])|\n[ \t]*\n/gu;
/** Łącznik wyliczenia między dwoma numerami: „KW nr A, B i C" — kotwica pierwszego niesie resztę.
 *  Bez tabulatora: w wierszu TSV („KR1P/…\tFV1A/…") następna komórka to inna kolumna, nie lista. */
const RE_KW_LIST_GAP = /^(?:[ ,;]|\r?\n|(?:i|oraz|lub|albo|a także)(?=[ \t])|(?:[Nn]r|numer)\.?(?=[ \t:]):?)*$/;
/** Parametr adresu, który zapowiada numer księgi („…/wyszukiwanieKW?kw=KR1P/…"). Kotwica dotyczy
 *  tylko wartości tego parametru: „?kw=buty" w sklepie to fraza wyszukiwania, a „?ksiegowosc=" to
 *  nie księga, więc sąsiedni parametr („&plik=ZP1A-20260315-1.pdf") nie może z niej korzystać. */
const RE_KW_URL_PARAM = /[?&#;](?:kw|nr_?kw|numer_?kw|ksi[eę]g[aię]?(?:_?wieczyst\w{0,3})?)=$/i;

/** Odstęp między kotwicą a numerem, przy którym kotwica jest ETYKIETĄ numeru: interpunkcja
 *  etykiety, znaczniki XML/JSON, kolumna tabeli, łamanie wiersza i „nr"/„numer"/„o numerze"/„pod".
 *  Tylko taka kotwica znosi wszystkie zabezpieczenia (zła suma, spacja albo myślnik zamiast
 *  ukośnika, małe litery). „KW" wspomniane w zdaniu jako pojęcie („odpis KW w pliku ZP1A-…",
 *  „KW nr …, faktura FV1A/…", „1;odpis KW;\n2;faktura;FV1A/…") nie jest etykietą kodu, który
 *  stoi za innym słowem, w innym rekordzie albo w następnym punkcie wyliczenia. Taki numer
 *  maskujemy tylko wtedy, gdy jest pewny sam w sobie (znany sąd i poprawna suma), jak bez kotwicy. */
const RE_KW_ADJ_GAP =
  /^(?:[ \t\r\n:=."'<>()[\]|_–-]|(?<!\p{L})(?:o[ \t]+)?(?:[Nn]r|NR|[Nn]umer(?:ze|em|u|y|ach|ami)?|NUMER|pod)(?!\p{L}))*$/u;
const RE_KW_ANCHOR_G = new RegExp(RE_KW_ANCHOR.source, 'gu');
/** Etykieta znaku sprawy tuż przed numerem KW wklejonym w znak („Znak sprawy: GN.KR1P/…/4",
 *  „Znak: WA1M/…/6.GN"). Cały znak maskuje wtedy passZnakSprawy; sam numer zostawiał jawny
 *  symbol komórki (fragment znaku). */
const RE_KW_ZNAK_BEFORE =
  /(?:znak sprawy|znak pisma|nasz znak|wasz znak|sygn\.?[ \t]*akt|sygnatura akt|sygn\.|znak(?=[ \t]*:))[ \t]*:?[ \t]*(?:[\p{L}\d]+[.-])*$/iu;

/** Kotwica-etykieta w oknie 40 znaków przed numerem, w tym samym zdaniu (etykieta z poprzedniego
 *  wiersza „KW:\n…" się liczy, ale nie z poprzedniego akapitu). Liczy się ostatnia kotwica w oknie
 *  i tylko wtedy, gdy od numeru dzieli ją sam odstęp etykiety (RE_KW_ADJ_GAP). */
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
    // Kotwica przez łamanie wiersza tylko jako etykieta: z „:"/„="/„>"/„|" przed łamaniem albo
    // gdy cały wiersz kotwicy to sama etykieta („Nr KW\n…", „1. Księga wieczysta\n…"). „KW" na
    // końcu nagłówka czy zdania („Załączniki do KW\n…", „agregat;20;KW\n…", „Pismo przekazano
    // do KW.\n…") nie jest etykietą kodu z następnego wiersza.
    const gap = win.slice(end);
    const nl = gap.indexOf('\n');
    if (nl < 0 || /[:=>|]/.test(gap.slice(0, nl))) return true;
    const absEnd = offset - win.length + end;
    const ls = text.lastIndexOf('\n', absEnd - 1) + 1;
    const rest = text.slice(ls, absEnd).replace(RE_KW_ANCHOR_G, '');
    if (/^[ \t]*(?:(?:\d{1,3}[.)]|[-*•])[ \t]*)?(?:(?:[Nn]r|NR|[Nn]umer|NUMER)\.?[ \t]*)?$/.test(rest)) return true;
  }
  return kwColumnAnchored(text, offset);
}

const RE_KW_SHAPE_CELL = new RegExp(`^[ \\t"']*${KW_SHAPE}[ \\t\\r"']*$`, 'u');
/** Nagłówek kolumny jako kotwica („Nr KW\tPowierzchnia\nKR1P/…\t120 m2"): numer musi stać w TEJ
 *  SAMEJ kolumnie co komórka z etykietą. Okno 40 znaków przenosiło „KW" z nagłówka na każdą
 *  kolumnę następnego wiersza („Nr KW\tStatus\nbrak\tWA2B 12345678 1 szt."). Idziemy w górę przez
 *  wiersze z numerami KW w tej kolumnie (kilka numerów pod jednym nagłówkiem); wycinek ograniczony,
 *  by długi tekst bez nowych wierszy nie był skanowany przy każdym trafieniu. */
function kwColumnAnchored(text: string, offset: number): boolean {
  const lines = text.slice(Math.max(0, offset - 400), offset).split('\n');
  if (lines.length < 2) return false;
  const cur = lines[lines.length - 1];
  const sep = cur.includes('\t') || lines[lines.length - 2].includes('\t') ? '\t' : cur.includes('|') ? '|' : '';
  if (!sep) return false;
  const curCells = cur.split(sep);
  if (!/^[ \t"']*$/.test(curCells[curCells.length - 1])) return false;
  const col = curCells.length - 1;
  // pierwszy wiersz wycinka bywa ucięty, więc go nie oceniamy (chyba że wycinek zaczyna tekst)
  const first = offset - 400 <= 0 ? 0 : 1;
  // W tabeli „|" nagłówek kolumny stoi zawsze nad linią „|---|". Bez niej wiersze to pary
  // klucz–wartość („| Rejestr | KW |\n| Id | ZZ9Z/… |"), a „KW" jest wartością, nie etykietą.
  let mdSep = false;
  for (let i = lines.length - 2; i >= first; i--) {
    const row = lines[i];
    if (sep === '|' && /^[ \t|:-]+$/.test(row)) {
      mdSep = true; // linia „|---|---|" w Markdownie
      continue;
    }
    const cell = row.split(sep)[col];
    if (cell === undefined) return false;
    if (RE_KW_SHAPE_CELL.test(cell)) continue;
    // Komórka musi BYĆ etykietą („Nr KW", „Księga wieczysta"), a nie opisem z tym słowem
    // („| 2 | odpis KW |" nad „| 3 | ZP1A/… |" to wiersz danych, nie nagłówek).
    const label = cell.trim();
    const a = RE_KW_ANCHOR.exec(label);
    return (
      !!a &&
      (sep !== '|' || mdSep) &&
      label.length <= 30 &&
      /^(?:(?:[Nn]r|NR|[Nn]umer|NUMER)\.?[ \t]*)?$/.test(label.slice(0, a.index)) &&
      RE_KW_ADJ_GAP.test(label.slice(a.index + a[0].length))
    );
  }
  return false;
}

/** Etykieta innego rodzaju numeru tuż przed kodem („Faktura nr PL1A/…", „nr seryjny PO1A/…",
 *  „Nr umowy: KA1F/…"). Kod o kształcie KW pod taką etykietą nie jest księgą, więc tryb bez
 *  kotwicy (znany sąd + suma) go nie maskuje. Rzeczowniki ogólne („umowy", „zamówienia",
 *  „zlecenia") liczą się tylko po „nr"/„numer": „Przedmiot umowy: KR1P/…" w akcie notarialnym
 *  to nadal księga. */
const RE_KW_OTHER_LABEL =
  /(?<!\p{L})(?:(?:faktur\p{L}*|FV|f-ry|rachun\p{L}*|seryjn\p{L}*|fabr\.|s\/n|SN|próbk\p{L}*|ref\.?|ewidencyjn\p{L}*(?:[ \t]+pracownik\p{L}*)?|parti\p{L}*|seri[aiąę]|przesył\p{L}*|paczk\p{L}*|katalogow\p{L}*|produkt\p{L}*|indeks\p{L}*|licznik\p{L}*)[ \t]*(?:(?:nr|numer)\.?[ \t]*)?|(?:nr|numer)\.?[ \t]*(?:umow\p{L}*|zamówie\p{L}*|zlece\p{L}*)[ \t]*)[:#]?[ \t]*$/iu;

/** Callback dla RE_KW_VALUE. `inUrl` — dopasowanie wewnątrz adresu: kotwicą jest wtedy tylko
 *  parametr numeru księgi stojący tuż przed wartością. */
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
      : // wyliczenie niesie kotwicę tylko na kod znanego sądu („KW nr KR1P/…, FV1A/…" — faktura)
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

// 1f) ZNAK SPRAWY / ZNAK PISMA — sygnatura pisma urzędowego. Biegnie WCZEŚNIE, by zamaskować
// cały znak, zanim krótsze detektory (kod, telefon) odgryzą jego fragmenty cyfrowe. Dwa tryby:
export function passZnakSprawy(ctx: RedactCtx): void {
  if (!ctx.on('ZNAK-SPRAWY')) return;
  // (a) STRUKTURALNIE — znak wg JRWA „SYMBOL.klasa.numer.ROK".
  const ZNAK_START = `[${PL_UP}]{2,}[0-9]*(?:-[A-Za-z${PL_UP}${PL_LO}0-9]+)*`;
  const ZNAK_MID = `(?:\\.[A-Za-z${PL_UP}${PL_LO}0-9-]+)*?`;
  ctx.text = ctx.text.replace(
    // Lookbehind obejmuje też polskie litery: bez nich start w ŚRODKU ciągu „ŻŻŻ…" był dozwolony
    // i każda pozycja skanowała ciąg do końca (czas kwadratowy, ~8 s na 100 tys. znaków).
    // Po roku najwyżej dwa człony: symbol komórki („.PL") albo numer kolejny/załącznika („.1").
    // Dawniej tylko litery — „…2026.1" dawało „[ZNAK-SPRAWY].1", a tryb (b) z etykietą nie
    // dokańczał maski, bo nie zaczyna od „[" (wyciek fragmentu znaku).
    new RegExp(`(?<![A-Za-z${PL_UP}${PL_LO}0-9./-])${ZNAK_START}${ZNAK_MID}\\.\\d+\\.(?:19|20)\\d{2}(?:\\.(?:[${PL_UP}]{2,3}|\\d{1,3})){0,2}(?!\\d)`, 'g'),
    maskConst(ctx, 'ZNAK-SPRAWY'),
  );
  // (b) Z KONTEKSTEM („Znak sprawy:", „Sygn. akt", „Znak:") — słowo zostaje, maskujemy sam znak.
  const ZNAK_VALUE =
    `(?:[IVXLCDM]{1,4}[ \\t]+)?[${PL_UP}][A-Za-z${PL_LO}]{0,4}(?:/[${PL_UP}][A-Za-z${PL_LO}]{0,3})?[ \\t]+\\d+[ \\t]*/[ \\t]*\\d{2,4}` +
    `|[A-Za-z0-9${PL_UP}${PL_LO}]+(?:[.\\-/][A-Za-z0-9${PL_UP}${PL_LO}]+)+`;
  maskAfterLabel(
    ctx,
    new RegExp(
      `\\b(znak sprawy|znak pisma|nasz znak|wasz znak|sygn\\.?[ \\t]*akt|sygnatura akt|sygn\\.|znak(?=[ \\t]*:))` +
        `([ \\t]*:?[ \\t]*)(${ZNAK_VALUE})`,
      'gi',
    ),
    'ZNAK-SPRAWY',
  );
}
