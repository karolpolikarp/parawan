// Identyfikatory numeryczne: IBAN, numer konta, PESEL, NIP, REGON, karta płatnicza i telefon.
// Najdłuższe ciągi cyfr idą pierwsze (IBAN 26 → PESEL 11 → NIP 10 → REGON), krótsze potem.
import { countOf } from '../charset.js';
import { maskAfterLabel, type RedactCtx } from '../context.js';
import { type PiiType } from '../types.js';
import { CURRENCY_CODES, isValidCard, isValidIban, isValidNip, isValidPesel, isValidRegon14, isValidRegon9, precededByLegalRef, precededByNonPhoneLabel } from '../validators.js';

/** Długości IBAN wg rejestru ISO 13616 (kraj → liczba znaków bez spacji). */
const IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29, BY: 28, CH: 21,
  CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29, ES: 24, FI: 18, FO: 18, FR: 27,
  GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28, HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26,
  IT: 27, JO: 30, KW: 30, KZ: 20, LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24,
  ME: 22, MK: 19, MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28, TL: 23, TN: 24,
  TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
};
/**
 * Długość części dopasowania, która jest numerem IBAN. Wzorzec połyka kolejne wyrazy wersalikami
 * („…4567 PKO BP", „… W EUR"), bo grupy numeru też są z wielkich liter i cyfr. Znany kraj tniemy na
 * jego długości (tylko na granicy grupy), a w nieznanym odcinamy końcowe wyrazy z samych liter.
 */
function ibanCut(m: string): number {
  const n = IBAN_LENGTHS[m.slice(0, 2)];
  if (n) {
    let k = 0;
    for (let i = 0; i < m.length; i++) {
      if (m[i] !== ' ') k++;
      if (k === n) {
        if (i + 1 === m.length || m[i + 1] === ' ') return i + 1;
        break;
      }
    }
  }
  const t = m.replace(/(?:[ ][A-Z]+)+$/, '');
  return t.replace(/ /g, '').length >= 15 ? t.length : m.length;
}
const RE_IBAN_TAIL = /^(?:[ ](?=[A-Z]{0,3}\d)[A-Z0-9]{1,4}(?![A-Z0-9]))*/;
const RE_IBAN_AMOUNT_AFTER = new RegExp(`^[ \\t\\u00A0]*(?:,\\d|zł(?:ot\\p{L}*)?|${[...CURRENCY_CODES].join('|')})(?!\\p{L})`, 'iu');
/**
 * Koniec maski numeru uciętego przez ibanCut. Krótkie grupy z cyfrą tuż za długością kraju to ten
 * sam numer z literówką („PL61 … 2874 5"), więc idą pod maskę. Grupa, po której stoi waluta albo
 * grosze, to kwota („PL61 … 2874 1500 zł"). `after` to tekst za dopasowaniem.
 */
function ibanMaskEnd(m: string, c: number, after: string): number {
  const tail = RE_IBAN_TAIL.exec(m.slice(c))?.[0] ?? '';
  if (tail && RE_IBAN_AMOUNT_AFTER.test(m.slice(c + tail.length) + after)) return c;
  return c + tail.length;
}
// Twarde spacje (NBSP, spacja cyfrowa, wąska twarda): edytory i bankowość wstawiają je między grupy
// cyfr, żeby numer nie łamał się w wierszu.
const HARD_SPACES = '\\u00A0\\u2007\\u202F';
const NUM_WS = `[ ${HARD_SPACES}]`;
const RE_HARD_SPACE = new RegExp(`[${HARD_SPACES}]`, 'g');
/** Kopia z twardymi spacjami zamienionymi na zwykłe. Długość ta sama, więc indeksy cięcia
 *  liczone na kopii (ibanCut, ibanMaskEnd) pasują do oryginału. */
const plainSpaces = (s: string): string => s.replace(RE_HARD_SPACE, ' ');
// Odstępy także twarde albo kanoniczne łączniki co 4 znaki („PL57-1140-2004-0000-…"). Mod-97 i tak rozstrzyga.
const RE_IBAN = new RegExp(`\\b[A-Z]{2}\\d{2}(?:(?:${NUM_WS}?[A-Z0-9]){11,30}|(?:-[A-Z0-9]{4}){2,7}(?:-[A-Z0-9]{1,3})?)\\b`, 'g');
export function passIban(ctx: RedactCtx): void {
  if (!ctx.on('IBAN')) return;
  ctx.text = ctx.text.replace(RE_IBAN, (m, offset: number) => {
    const p = plainSpaces(m);
    const c = ibanCut(p);
    if (isValidIban(m.slice(0, c))) {
      ctx.bump('IBAN');
      const after = ctx.text.slice(offset + m.length, offset + m.length + 8);
      return ctx.M.IBAN + m.slice(ibanMaskEnd(p, c, plainSpaces(after)));
    }
    return m;
  });
}

// Do trzech słów między etykietą a numerem („nr rachunku bankowego:", „PESEL pacjenta").
const LABEL_WORDS = String.raw`(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3}`;
// Silna etykieta + wartość ciągiem albo z odstępami (grupy 1–3: etykieta, separator, wartość).
const labeledRe = (kw: string, value: string): RegExp =>
  new RegExp(String.raw`\b(${kw}${LABEL_WORDS})([\s:=.-]+)(${value})(?![\d])`, 'gi');
const spacedLabeledRe = (kw: string, value: string): RegExp =>
  new RegExp(String.raw`\b(${kw}${LABEL_WORDS})([\s:=.-]*[\s:=.|-])(${value})(?![ \t|-]{0,3}\d)`, 'gi');

// Etykieta konta także w złożeniach („mikrorachunek", „subkonto") i z kwalifikatorem przed numerem
// („rachunek podatkowy", „konto bankowe:"). Maska mimo złej sumy, bo numer bywa z literówką.
const RE_ACCOUNT_LABELED = new RegExp(
  `(?<![\\p{L}])((?:mikro)?rachun(?:ek|ku|kiem)|(?:sub)?kont(?:o|a|em)|koncie|iban)(?![\\p{L}])` +
    `(${LABEL_WORDS}[\\s:.-]*)` +
    `((?:\\d${NUM_WS}?){25}\\d|\\d{2}(?:-\\d{4}){6})(?!${NUM_WS}?\\d|-\\d)`,
  'giu',
);
// NRB bez etykiety. Łącznik tylko w grupowaniu 2-4-4-4-4-4-4: „Konto księgowe 201-01-001-0002-…"
// czy numer zamówienia też mają 26 cyfr.
const RE_NRB_BARE = new RegExp(
  `(?<!\\d${NUM_WS}?|\\d-)(?:\\bPL${NUM_WS}?)?(?:(?:\\d${NUM_WS}?){25}\\d|\\d{2}(?:-\\d{4}){6})(?!${NUM_WS}?\\d|-\\d)`,
  'g',
);
// Etykieta konta + wartość w formacie IBAN. Bez flagi „i", bo wartość ma być wersalikami jak realny
// IBAN i nie może wciągnąć małych liter następnego słowa; stąd warianty etykiety wyliczone jawnie.
// Gałąź PL dopuszcza spację po „PL" i do 4 nadmiarowych cyfr (literówka, patrz ibanMaskEnd), nadmiar
// wyrazów („ PKO BP", „ W EUR") odcina ibanCut. Prawa granica zna polskie litery („…Z TYTUŁEM").
const RE_ACCOUNT_IBAN_LABELED = new RegExp(
  `\\b((?:konto|Konto|KONTO|konta|Konta|rachunek|Rachunek|RACHUNEK|rachunku|Rachunku|mikrorachunek|Mikrorachunek|mikrorachunku|Mikrorachunku|nr konta|Nr konta|numer konta|Numer konta|iban|Iban|IBAN)${LABEL_WORDS})([\\s:=.-]+)` +
    `(PL${NUM_WS}?\\d{2}(?:${NUM_WS}?\\d){24}(?:${NUM_WS}?\\d){0,4}|PL\\d{2}(?:-\\d{4}){6}|[A-Z]{2}\\d{2}(?:${NUM_WS}?[A-Z0-9]){11,30})(?![A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]|-\\d)`,
  'g',
);

export function passAccount(ctx: RedactCtx): void {
  if (!ctx.on('NR-KONTA')) return;
  maskAfterLabel(ctx, RE_ACCOUNT_LABELED, 'NR-KONTA');
  // Etykieta + format IBAN: maska nawet przy złej sumie mod-97.
  ctx.text = ctx.text.replace(
    RE_ACCOUNT_IBAN_LABELED,
    (m, kw: string, sep: string, val: string, offset: number) => {
      ctx.bump('NR-KONTA');
      const p = plainSpaces(val);
      const after = plainSpaces(ctx.text.slice(offset + m.length, offset + m.length + 8));
      return `${kw}${sep}${ctx.M['NR-KONTA']}${val.slice(ibanMaskEnd(p, ibanCut(p), after))}`;
    },
  );
  // Bez etykiety tylko z poprawną sumą. Prefiks „PL" idzie pod maskę razem z numerem.
  ctx.text = ctx.text.replace(RE_NRB_BARE, (m) => {
    if (isValidIban('PL' + m.replace(/^PL/, ''))) {
      return ctx.hit('NR-KONTA');
    }
    return m;
  });
}

const RE_PESEL_LABELED = labeledRe('pesel', String.raw`\d{11}`);
// Grupy mogą przejść przez jedno łamanie wiersza (zawinięta kolumna); warunki w maskSpacedAfterLabel.
const RE_PESEL_SPACED = spacedLabeledRe('pesel', String.raw`\d(?:(?:[ \t|-]{0,3}|[ \t]*\r?\n[ \t]*)\d){10}`);
export function passPesel(ctx: RedactCtx): void {
  if (!ctx.on('PESEL')) return;
  ctx.text = ctx.text.replace(/(?<![\dA-Za-z])\d{11}(?![\d])/g, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    if (isValidPesel(m)) {
      return ctx.hit('PESEL');
    }
    return m;
  });
  // Silna etykieta: maska mimo złej sumy, bo numer bywa z literówką.
  maskAfterLabel(ctx, RE_PESEL_LABELED, 'PESEL');
  maskSpacedAfterLabel(ctx, RE_PESEL_SPACED, 'PESEL', isValidPesel);
}

// Słowa za etykietą, które otwierają inne pole albo mówią, że numeru nie ma („PESEL⏎Tel. 48 601 222 333",
// „REGON brak telefon 601 222 333"): wartość należy wtedy do innego pola.
const RE_FOREIGN_FIELD_WORD =
  /^(?:tel\p{L}*|kom|komórk\p{L}*|fax|faks|kontakt\p{L}*|krs|kart[aęyą]?|kont(?:o|a|u|em|cie)|rachun\p{L}*|iban|nrb|dow[oó]d\p{L}*|paszport\p{L}*|pesel|nip|regon|brak|nie)$/iu;
/**
 * Numer z silną etykietą zapisany z odstępami: grupy („NIP 5260 2502 74") albo cyfra po cyfrze
 * w kratkach („PESEL: 8 5 1 1 0 3 1 4 2 8 3", „|8|5|1|…"). Grupy co najmniej dwucyfrowe z pojedynczą
 * spacją lub łącznikiem maskujemy mimo złej sumy. Pojedyncze cyfry, tabulator, „|" albo kilka spacji
 * tylko z poprawną sumą, bo tak wyglądają też wzory z instrukcji i kolumny tabel.
 * Bez etykiety nic się nie zmienia: „Jan Kowalski 501 120 345 43" to telefon i wiek, nie PESEL.
 * Nie scalać z maskAfterLabel: tam etykieta wystarcza, tu decydują jeszcze wiersz etykiety, układ
 * grup i suma kontrolna.
 */
function maskSpacedAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType, valid: (d: string) => boolean): void {
  ctx.text = ctx.text.replace(re, (m, kw: string, sep: string, val: string, off: number, str: string) => {
    // Słowa etykiety tylko z tego samego wiersza i tylko opisujące ten numer („PESEL pacjenta:").
    // Pierwsze słowo to sama etykieta.
    if (kw.includes('\n') || kw.split(/\s+/).slice(1).some((w) => RE_FOREIGN_FIELD_WORD.test(w))) return m;
    const core = val.replace(/^PL[- ]?/, ''); // prefiks kraju przed NIP-em
    if (!/[ \t|\n-]/.test(core)) return m;
    const d = core.replace(/\D/g, '');
    // Najwyżej jedno łamanie wiersza. Przy złej sumie tylko wtedy, gdy grupy w nowej linii same
    // domykają wiersz („PESEL: 851 103⏎142 84"), a nie otwierają innego pola z liczbą.
    if (core.includes('\n')) {
      if (countOf(core, '\n') > 1) return m;
      const tailEnds = /^[ \t]*(?:\r?\n|$)/.test(str.slice(off + m.length));
      if (!valid(d) && !tailEnds) return m;
    }
    const grouped = /^\d{2,}(?:(?:[ -]|[ \t]*\r?\n[ \t]*)\d{2,})+$/.test(core);
    if (!grouped && !valid(d)) return m;
    return `${kw}${sep}${ctx.hit(type)}`;
  });
}

// Separator łącznik albo spacja (także twarda), albo 10 cyfr ciągiem.
const NIP_SEP = `[- ${HARD_SPACES}]`;
const NIP_VALUE = `(?:PL${NIP_SEP}?)?(?:\\d{3}${NIP_SEP}\\d{3}${NIP_SEP}\\d{2}${NIP_SEP}\\d{2}|\\d{3}${NIP_SEP}\\d{2}${NIP_SEP}\\d{2}${NIP_SEP}\\d{3}|\\d{10})`;
const RE_NIP = new RegExp(`(?<![\\d])${NIP_VALUE}(?![\\d])`, 'g');
const RE_NIP_LABELED = labeledRe('nip', NIP_VALUE);
// Inne grupowanie albo cyfry w kratkach („NIP: 5 2 6 0 2 5 0 2 7 4").
const RE_NIP_SPACED = spacedLabeledRe('nip', String.raw`(?:PL[- ]?)?\d(?:[ \t|-]{0,3}\d){9}`);
export function passNip(ctx: RedactCtx): void {
  if (!ctx.on('NIP')) return;
  // Prefiks „PL" idzie pod maskę razem z numerem; isValidNip i tak liczy tylko cyfry.
  ctx.text = ctx.text.replace(RE_NIP, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset) || !isValidNip(m)) return m;
    return ctx.hit('NIP');
  });
  // Silna etykieta: maska mimo złej sumy.
  maskAfterLabel(ctx, RE_NIP_LABELED, 'NIP');
  maskSpacedAfterLabel(ctx, RE_NIP_SPACED, 'NIP', isValidNip);
}

const RE_REGON_LABELED = labeledRe('regon', String.raw`\d{14}|\d{9}`);
const RE_REGON_SPACED = spacedLabeledRe('regon', String.raw`\d(?:[ \t|-]{0,3}\d){13}|\d(?:[ \t|-]{0,3}\d){8}`);
export function passRegon(ctx: RedactCtx): void {
  if (!ctx.on('REGON')) return;
  // Bez etykiety tylko 14 cyfr z poprawną sumą; 9 cyfr wymaga etykiety.
  ctx.text = ctx.text.replace(/(?<![\d])\d{14}(?![\d])/g, (m) => {
    if (isValidRegon14(m)) {
      return ctx.hit('REGON');
    }
    return m;
  });
  // Silna etykieta: 9 lub 14 cyfr, maska mimo złej sumy.
  maskAfterLabel(ctx, RE_REGON_LABELED, 'REGON');
  maskSpacedAfterLabel(ctx, RE_REGON_SPACED, 'REGON', (d) => (d.length === 14 ? isValidRegon14(d) : isValidRegon9(d)));
}

// Karta tylko z kontekstem karty: Luhn z prefiksem sieci przechodzi też dla IMEI, EAN, numerów
// przesyłek i transakcji. Biegnie przed REGON, żeby 14-cyfrowy Diners z kontekstem wygrał ze ślepą
// sumą REGON. Człon numeru obejmuje klucze zrośnięte („card_number", „cardNumber").
const RE_CARD_LABELED =
  /\b((?:kart[a-ząćęłńóśźż]*|card|visa|mastercard|maestro|amex|american\s+express|diners(?:\s+club)?|discover|jcb|płatnicz[a-ząćęłńóśźż]*|kredytow[a-ząćęłńóśźż]*|debetow[a-ząćęłńóśźż]*)(?:(?:[ \t]+o)?[ \t]+(?:nr|numer(?:ze|u)?|number|no)\.?|[_-]?(?:number|no|nr)\b)?)([\s:="'()<>|.-]+)((?:\d[ -]?){12,18}\d)(?![\d])/gi;
export function passCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA')) return;
  ctx.text = ctx.text.replace(RE_CARD_LABELED, (m, kw: string, sep: string, num: string) => {
    if (isValidCard(num)) {
      return `${kw}${sep}${ctx.hit('KARTA')}`;
    }
    return m;
  });
}

// Telefon, polskie numery 9-cyfrowe, trzy tryby. Kotwicowy (b) biegnie przed prefiksowym (a), żeby
// placeholder nie przerwał łańcucha wyliczenia po kotwicy. (c) to fallback bez kontekstu.
// Separatory wyliczenia. Po ścisłym człon musi być całym numerem bez dalszych cyfr w wierszu:
// „lub 0048 61 852 33 48" przejmuje wtedy w całości tryb (a). „bądź" z granicą polskich liter,
// bo \b nie widzi granicy przy „ź".
const PHONE_ENUM_SEP_LOOSE = String.raw`(?:,|\boraz\b|\bi\b)`;
const PHONE_ENUM_SEP_STRICT = String.raw`(?:;|\/|\blub\b|\balbo\b|(?<![a-ząćęłńóśźż])bądź(?![a-ząćęłńóśźż]))`;
// Prefiks kraju („+48", „0048", „(+48)", „48" sklejone z numerem, „+48 (0)22") i zero międzymiastowe
// („(0-61) 852 33 44"). Ten sam człon w regexie, w członie wyliczenia i w segmencie maskowanym,
// inaczej okna 9 cyfr się rozjeżdżają i zostaje ogon numeru. Długość całości pilnuje phoneDigitsValid.
const PHONE_CC = String.raw`(?:\(?(?:(?:\+|00)[ \t]?)?48\)?[\s.-]{0,3}(?:[ \t]?\(0\))?)?(?:\(?0(?![\s-]?0)[\s-]?)?`;
const PHONE_KIND_WORD = String.raw`(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+)`;
const PHONE_ENUM_MEMBER = String.raw`\s*(?:(?:${PHONE_KIND_WORD}|kom\.?|tel\.?|nr\.?)\s+)?${PHONE_CC}(?:[\s\-().]{0,3}\d){9}`;
// Żaden człon łańcucha nie może być kwotą („tel. 601 222 333 lub 120 000 000 zł").
const PHONE_NOT_AMOUNT = String.raw`(?![ \t]*(?:,\d{2})?[ \t]*(?:zł|PLN|EUR|USD|gr\b))`;
// Słowo przerwy w mocnej kotwicy. Skróty z wykazów sprzętu („Telefon nr inw. 012345678", „Fax nr
// fabr. 12 345 67 89") nie są przerwą: za nimi stoi numer składnika majątku.
const PHONE_GAP_WORD = String.raw`(?!(?:inw|ewid|fabr|ser|kat|poz|szt|egz|lp)\.)[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{2,15}`;
// Kotwice trybu (b). Linia vCard wymaga parametru przed dwukropkiem („TEL;TYPE=WORK:…"), więc
// „Hotel; pokój 22 123 45 67" odpada. Mocne kotwice (tel., telefon, nr tel., fax) dopuszczają do
// dwóch wyrazów przerwy w tej samej linii, gdy ostatni jest skrótem z kropką albo stoi przed
// dwukropkiem („tel. stacj. 22 843 21 09", „Nr tel. opiekuna: …"). Przerwa należy do kotwicy, nie do
// strażnika w callbacku: odrzucone dopasowanie zjadłoby kotwicę leżącą dalej. „kom." (Komisja)
// i „kontakt" są bez przerwy. \b odcina „iPhone" i „mobbing". Czasownik tylko z „pod/na"
// („dzwonić pod 512 345⏎678"), bo „Dzwonił w sprawie faktury …" to nie numer.
const PHONE_ANCHOR =
  '(?:tel(?:;[A-Za-z-]{1,20}(?:=[A-Za-z0-9,-]{1,40})?){1,4}(?=:))|' +
  String.raw`(?:te[li]\.?|telefon(?:u|y|em|ie)?|nr te[li]\.?|fax|faks)(?:(?:[ \t]+${PHONE_GAP_WORD}\.?)?[ \t]+${PHONE_GAP_WORD}(?:\.|[ \t]*(?=:)))?` +
  String.raw`|telefon(?:\w|[ąćęłńóśźż]){0,6}|kom\.?|komór(?:k(?:\w|[ąćęłńóśźż]){1,5}|ce)|kontakt\w{0,4}|(?:tele)?phone|mobile|mob\.?|gsm` +
  String.raw`|(?:za|od|prze)?dzwo(?:ni(?:ć|li|ły|my|cie|sz|ą|ę|ł[a-ząęó]*)?|ń(?:cie)?)[ \t]+(?:pod|na)(?:[ \t]+(?:numer\w*|nr\.?))?`;
const RE_PHONE_NR_WORD = /(?<!\p{L})nr(?!\p{L})/iu;
// Przymiotnik, liczba mnoga i przysłówek („telefoniczne", „telefony", „telefonicznie"), nie
// rzeczownik „telefon/telefonu/telefonem/telefonie".
const RE_PHONE_KW_WEAK = /^telefon(?!(?:u|em|ie)?(?!\p{L}))/iu;
/**
 * Czy wypełniacz „nr" po kotwicy wskazuje numer sprawy, a nie telefon? Po samym „kontakt…" stoi
 * identyfikator rekordu („Dotyczy kontaktu nr 123456789"), a po przymiotniku, liczbie mnogiej czy
 * przysłówku numer zgłoszenia lub umowy („Zgłoszenie telefoniczne nr 202410001"). Dwukropek robi
 * z tego etykietę pola („Kontaktowy nr: …"), a „Telefony" na początku wiersza albo zdania to nagłówek listy.
 */
function rejectPhoneNrFiller(kw: string, sep: string, str: string, offset: number): boolean {
  if (sep.includes(':')) return false;
  if (/^kontakt/i.test(kw)) return /^\s+nr\b/i.test(sep);
  if (!RE_PHONE_KW_WEAK.test(kw) || !RE_PHONE_NR_WORD.test(sep)) return false;
  if (/^telefony$/i.test(kw)) {
    let i = offset - 1;
    while (i >= 0 && (str[i] === ' ' || str[i] === '\t')) i--;
    if (i < 0 || /[\n.;!?]/.test(str[i])) return false;
  }
  return true;
}
// Wypełniacz „nr"/„na" tylko w tej samej linii: „Telefon⏎nr 123 456 789" to nagłówek nad innym
// numerem. Podział wypełniacza musi być jednoznaczny (dwukropek lub kropka tylko z odstępami przed
// nimi, „nr" zawsze bierze kropkę), inaczej wiersz tabeli „Telefon  NA NA …" backtrackuje wykładniczo.
const RE_PHONE_ANCHORED = new RegExp(
  String.raw`\b(${PHONE_ANCHOR})((?:\s+(?:${PHONE_KIND_WORD}|telefoniczn\w+|pod|numer\w*)|(?:[ \t]*[:.])?[ \t]+(?:nr(?:\.|(?!\.))|na))*[\s:.=-]*)(${PHONE_CC}(?:[\s\-().]{0,3}\d){9}(?:\s*${PHONE_ENUM_SEP_LOOSE}${PHONE_ENUM_MEMBER}${PHONE_NOT_AMOUNT}|\s*${PHONE_ENUM_SEP_STRICT}${PHONE_ENUM_MEMBER}(?![ \t\-().]{0,3}\d)${PHONE_NOT_AMOUNT})*)(?![.:]?\d)`,
  'gi',
);
// Segment zaczyna się od kropki i odstępów wypełniacza („kom. 0 602 …"), inaczej okno 9 cyfr
// startuje na cyfrach prefiksu i ogon numeru zostaje jawny za maską.
const RE_PHONE_SEGMENT = new RegExp(String.raw`[\s.]*${PHONE_CC}(?:[\s\-().]{0,3}\d){9}`, 'g');
/**
 * Czy cyfry członu to numer: 9 cyfr krajowych, z zerem międzymiastowym 10, a przed nimi
 * ewentualnie kod kraju „48"/„0048" („+48 (0)22 …" daje 12 cyfr z „480").
 */
function phoneDigitsValid(d: string): boolean {
  const national = (s: string): boolean => s.length === 9 || (s.length === 10 && s[0] === '0');
  return national(d) || (d.startsWith('48') && national(d.slice(2))) || (d.startsWith('0048') && national(d.slice(4)));
}
const PHONE_ENUM_SEP = `(?:${PHONE_ENUM_SEP_LOOSE}|${PHONE_ENUM_SEP_STRICT})`;
const RE_PHONE_ENUM_SPLIT = new RegExp(String.raw`\s*${PHONE_ENUM_SEP}\s*`, 'i');
// Data na początku członu („Tel. 2026.10.14 9:05"): okno 9 cyfr przepuszcza kropki i myślniki, więc
// data z cyfrą godziny wyglądałaby jak numer. Godzinę z minutami odcina prawa granica RE_PHONE_ANCHORED.
const RE_PHONE_DATE_SHAPE =
  /^[\s(]*(?:\d{1,2}[.\-/](?:0?[1-9]|1[0-2])[.\-/](?:19|20)\d{2}|(?:19|20)\d{2}[.\-/](?:0?[1-9]|1[0-2])[.\-/]\d{1,2})(?!\d)/;

// Strażniki trybu (c): liczba w kształcie telefonu, która telefonem nie jest.
// Odstępy także twarde i wąskie: arkusze wstawiają je między grupy cyfr kwoty i przed walutą.
const PHONE_GAP = '[ \\t\\u00A0\\u2009\\u202F]';
const PHONE_CODES = [...CURRENCY_CODES, 'HUF', 'EURO', 'KČ', 'ZL'].join('|');
// Waluta albo mnożnik po liczbie, z granicą litery („601 234 567 EUROPA" to nie kwota). Grosze „,50"
// mogą stać między liczbą a walutą.
const RE_PHONE_AMOUNT_AFTER = new RegExp(
  `^${PHONE_GAP}*(?:,\\d{1,2}(?!\\d))?${PHONE_GAP}*(?:(?:${PHONE_CODES}|tys|mln|mld)(?!\\p{L})|[€£]|\\$(?!\\p{L}))`,
  'iu',
);
// „zł" i „gr" osobno, z rozróżnieniem wielkości liter i tylko w formach waluty: „601 234 567 Złotów"
// to miasto, „… złożył" to proza, a „… Gr. A" to grupa.
const RE_PHONE_ZL_AFTER = new RegExp(
  `^${PHONE_GAP}*(?:,\\d{1,2}(?!\\d))?${PHONE_GAP}*` +
    '(?:zł(?:ot(?:y|e|ych|ego|emu|ym|ymi|ówk\\p{L}*|ówek))?|ZŁ(?:OT(?:Y|E|YCH|EGO|EMU|YM|YMI|ÓWK\\p{L}*|ÓWEK))?|' +
    'Zł(?:ot(?:y|e|ych))?|gr(?:osz\\p{L}*)?)(?!\\p{L})',
  'u',
);
// Waluta za numerem, a za nią kolejna liczba („603 456 789 zł 30,00"): waluta poprzedza tamtą kwotę.
const RE_CURRENCY_BEFORE_NUMBER = new RegExp(`^${PHONE_GAP}*(?:zł|ZŁ|Zł|PLN|EUR|USD|€|\\$)${PHONE_GAP}*\\d`, 'u');
// Waluta przed liczbą („PLN 125 450 300"), ale nie wtedy, gdy kończy inną kwotę („Abonament 49 zł
// 600 100 200": numer stoi po kwocie).
const RE_PHONE_AMOUNT_BEFORE = new RegExp(`(?:(?<![\\p{L}\\d])(?:${PHONE_CODES}|zł)|[€$£])${PHONE_GAP}?$`, 'iu');
const RE_PHONE_AMOUNT_BEFORE_OTHER = new RegExp(`\\d${PHONE_GAP}*(?:(?:${PHONE_CODES}|zł)|[€$£])${PHONE_GAP}?$`, 'iu');
// Ogon liczby ≥ 1 mld: grupa wiodąca 1–3 cyfr otwiera pole („Wartość: 1 234 567 890"), komórkę
// albo nawias. Bez cyfry przed ogranicznikiem („14:22 512 345 678" to godzina i telefon) i bez „48".
const RE_PHONE_BILLION_HEAD = /(?<!\d)[:|=;\t(][ \t]*(?!48\D)[1-9]\d{0,2}.$/;
// Etykieta identyfikatora albo telefonu znosi regułę miliarda: „PESEL: 85 110 314 283" to numer.
const RE_PHONE_ID_LABEL =
  /(?<![\p{L}])(?:pesel|nip|regon|krs|dow[oó]d\p{L}*|paszport\p{L}*|tel|telefon\p{L}*|kom|komórk\p{L}*|fax|faks|kontakt\p{L}*|nr|numer\p{L}*|id)(?![\p{L}])/iu;
/**
 * Czy liczba w kształcie telefonu to kwota? Tryb (c) nie ma kotwicy, więc decyduje otoczenie:
 * waluta lub mnożnik obok, grosze, ogon większej liczby po etykiecie pola, okrągłe setki milionów.
 * Tryb (b) tego nie sprawdza: „tel. 500 000 000" jest telefonem.
 */
function looksLikeAmount(full: string, offset: number, m: string): boolean {
  const end = offset + m.length;
  const after = full.slice(end, end + 16);
  if (RE_PHONE_AMOUNT_AFTER.test(after) || RE_PHONE_ZL_AFTER.test(after)) return true;
  const before = full.slice(Math.max(0, offset - 16), offset);
  if (RE_PHONE_AMOUNT_BEFORE.test(before) && !RE_PHONE_AMOUNT_BEFORE_OTHER.test(before)) return true;
  if (/^\d{3}0{6}$/.test(m.replace(/\D/g, ''))) return true;
  // Dalej tylko liczba grupowana jednolitym odstępem (te co PHONE_GAP, bez tabulatora). Ciągłe
  // 9 cyfr w polu CSV („Kowalski,Jan,512345678,34") to telefon.
  const sep = /^\d{3}([ \u00A0\u2009\u202F])\d{3}\1\d{3}$/.exec(m)?.[1];
  if (!sep) return false;
  // grosze „,55", ale nie w CSV: bez przecinka przed liczbą i bez kolejnego pola po groszach
  if (full[offset - 1] !== ',' && /^,\d{1,2}(?![\d,])/.test(after)) return true;
  if (!before.endsWith(sep) || !RE_PHONE_BILLION_HEAD.test(before)) return false;
  // Etykieta w tej samej linii. Granicę linii szukamy w oknie, bo lastIndexOf po całym tekście
  // jest kwadratowy w długiej linii bez „\n".
  const win = full.slice(Math.max(0, offset - 40), offset);
  return !RE_PHONE_ID_LABEL.test(win.slice(win.lastIndexOf('\n') + 1));
}
// Słowa telefoniczne przed łącznikiem, które nie robią z numeru identyfikatora. Wyraz od wielkiej
// litery sprawdza osobno isPersonalJoinPart, bo flaga „i" zrównałaby \p{Lu} z małymi literami.
const RE_PHONE_JOIN_WORD = /^(?:tel|telefon\p{L}*|kom|komórk\p{L}*|sms|gsm|fax|faks|kontakt\p{L}*|mob|mobile|cell|phone)$/iu;
// Prefiksy numerów komórkowych w Polsce (9 cyfr bez kierunkowego kraju).
const RE_PL_MOBILE_PREFIX = /^(?:45|5[0137]|6[069]|7[2389]|88)\d{7}$/;
const isPersonalJoinPart = (s: string): boolean => /^\p{Lu}\p{Ll}+$/u.test(s) || RE_PHONE_JOIN_WORD.test(s);
// Człon nazwy pliku przed numerem: data albo jej część („2024", „20240512", „2024-05-12", „05"),
// wersja („v2"), wyraz CamelCase („WhatsApp") albo przedrostek zdjęcia czy skanu („IMG", „DSC").
const RE_FILE_DATE_PART = /^(?:(?:19|20)\d{2}(?:-?\d{2}){0,2}|\d{2}|[vV]\d{1,3})$/;
const RE_FILE_WORD_PART = /^(?:\p{Ll}{2,}(?:-\p{Ll}{2,})*|\p{Lu}\p{Ll}+(?:\p{Lu}\p{Ll}*)*|IMG|DSC|DSCN|VID|PXL|MVIMG|SCAN|PIC)$/u;
/**
 * Czy przed numerem stoi nazwa pliku ze zwykłych wyrazów, dat i wersji, sklejonych podkreślnikiem
 * („wniosek_2024-05-12_", „skan_dowodu_2024_", „WhatsApp_", „IMG_", „umowa_v2_")? Co najmniej jeden
 * człon musi być wyrazem; kod wersalikami („ZAM_", „FV_2024_") dalej robi z numeru identyfikator.
 */
function fileNameChainBefore(before: string): boolean {
  const chain = /(?:^|[^\p{L}\d_-])((?:[\p{L}\d-]+_+)+)$/u.exec(before)?.[1];
  if (!chain) return false;
  const parts = chain.split(/_+/).filter(Boolean);
  return parts.every((p) => RE_FILE_DATE_PART.test(p) || RE_FILE_WORD_PART.test(p)) && parts.some((p) => RE_FILE_WORD_PART.test(p));
}
/**
 * Czy 9 cyfr to wnętrze identyfikatora („RR123456789PL", „FV/2026/123456789", „ZAM-123456789",
 * „SKU 123456789A", „DE811569869")? Sprawdzane w callbacku, bo lookbehind o zmiennej długości jest
 * kwadratowy. Mała litera przed numerem nie blokuje („Kowalski512345678" z ekstrakcji PDF to telefon),
 * a „/" i „-" blokują tylko jako łącznik tokenu („500600700/501601701" to dalej telefony).
 */
function gluedToIdentifier(full: string, offset: number, len: number): boolean {
  const before = full.slice(Math.max(0, offset - 32), offset);
  if (/\p{Lu}$/u.test(before)) return true;
  // „_" po literze lub cyfrze to łącznik identyfikatora („ZAM_123456789"), a ciąg podkreślników po
  // etykiecie to linia do wypełnienia („Telefon: ____601 234 567"). Nie blokuje słowo telefoniczne
  // („kontakt_tel_600111222") ani wyraz lub nazwa pliku przed numerem komórkowym („dok_600111222.pdf").
  const us = /([\p{L}\d]+)_+$/u.exec(before);
  if (us) {
    const d = full.slice(offset, offset + len).replace(/\D/g, '').replace(/^(?:00)?48(?=\d{9}$)/, '');
    const phoneWord = RE_PHONE_JOIN_WORD.test(us[1]);
    const fileWord = /^(?:\p{Ll}{2,}|\p{Lu}\p{Ll}+)$/u.test(us[1]) && RE_PL_MOBILE_PREFIX.test(d);
    if (!phoneWord && !fileWord && !(RE_PL_MOBILE_PREFIX.test(d) && fileNameChainBefore(before))) return true;
  }
  // Token z literą sklejony „/" lub „-" blokuje, gdy któryś człon ma cyfrę, „_" albo jest skrótem
  // czy słowem małymi literami („FV/2026/", „sklep/order/"). Imię, nazwisko i słowo telefoniczne
  // nie blokują: „córka Anna/603 456 789" to częsty zapis numeru osoby.
  const tok = /[\p{L}\d_/-]*[/-]$/u.exec(before)?.[0] ?? '';
  if (/\p{L}/u.test(tok) && !tok.split(/[/-]+/).filter(Boolean).every(isPersonalJoinPart)) return true;
  // Litera albo „_" zaraz po cyfrach („RR123456789PL"). Wyjątek: jednoliterowy przyimek doklejony
  // do numeru, który sam zaczyna token („512345678w godz. 8-16").
  const next = full.charAt(offset + len);
  if (!/[\p{L}_]/u.test(next)) return false;
  return !(/[wzoiu]/.test(next) && !/[\p{L}\d_]/u.test(full.charAt(offset + len + 1)) && !/[\p{L}\d]$/u.test(before));
}
// Tryb (a): nawias przed prefiksem należy do numeru. Strażnik przepisów liczony od „+"/„00",
// nie od nawiasu.
const RE_PHONE_INTL = /(?<![\d])(\([ \t]?)?((?:\+|00)[\s]?48(?:[ \t]?\(0\))?(?:[\s\-().]{0,3}\d){9})(?!\.?\d)/g;
// Tryb (c): bez kontekstu tylko 3-3-3, 9 cyfr ciągiem lub kierunkowy w nawiasie. Grupowanie 2-3-2-2
// bez kotwicy to zwykle numer pozycji („Pozycja 32 774 91 55 w wykazie"). Separator tylko poziomy
// (bez tabulatora) albo łącznik, bo kolumna liczb i komórki TSV skleiłyby się w jeden „telefon".
const RE_PHONE_BARE =
  /(?<![\d.])(?:\(\d{2}\)[ \t]?\d{3}[ \t-]?\d{2}[ \t-]?\d{2}|\d{3}[ \u00A0\u2009\u202F-]?\d{3}[ \u00A0\u2009\u202F-]?\d{3})(?!\.?\d)/g;
export function passPhone(ctx: RedactCtx): void {
  if (!ctx.on('TELEFON')) return;
  // (b) kotwica + 9 cyfr, także wyliczenie; słowo zostaje, numer idzie pod maskę. Odrzucona kotwica
  // oddaje resztę dopasowania do ponownego skanu, bo wyliczenie za numerem rekordu („Kontakt nr
  // 512 345 678, tel. 22 843 21 09") ma własną kotwicę.
  const anchored = (m: string, kw: string, sep: string, nums: string, offset: number, str: string): string => {
    if (rejectPhoneNrFiller(kw, sep, str, offset)) return `${kw}${sep}${nums.replace(RE_PHONE_ANCHORED, anchored)}`;
    const parts = nums.split(RE_PHONE_ENUM_SPLIT);
    if (!parts.every((p) => phoneDigitsValid(p.replace(/\D/g, '')))) return m;
    if (parts.some((p) => RE_PHONE_DATE_SHAPE.test(p))) return m;
    // Waluta za liczbą po „komórce" i „telefoniczne" to kwota (komórka arkusza, pozycja kosztów),
    // a po etykiecie „tel." numer. Waluta przed następną liczbą („603 456 789 zł 30,00") należy do niej.
    if (/^komór/i.test(kw) || RE_PHONE_KW_WEAK.test(kw)) {
      const after = str.slice(offset + m.length, offset + m.length + 16);
      if ((RE_PHONE_AMOUNT_AFTER.test(after) || RE_PHONE_ZL_AFTER.test(after)) && !RE_CURRENCY_BEFORE_NUMBER.test(after)) return m;
    }
    // Każdy człon maskujemy w miejscu, separatory i wypełniacze zostają. Kropka skrótu („, kom. 601…")
    // i wiodące odstępy wracają w `lead` przed maską. Nawias otwierający prefiks („(+48 512 345 678)")
    // zostaje, gdy numer domyka go dopiero za segmentem.
    const out = nums.replace(RE_PHONE_SEGMENT, (seg) => {
      ctx.bump('TELEFON');
      const lead = seg.match(/^[\s.]*/)?.[0] ?? '';
      const open = seg[lead.length] === '(' && countOf(seg, '(') > countOf(seg, ')');
      return `${lead}${open ? '(' : ''}${ctx.M.TELEFON}`;
    });
    return `${kw}${sep}${out}`;
  };
  ctx.text = ctx.text.replace(RE_PHONE_ANCHORED, anchored);
  // (a) prefiks +48/0048 razem z zerem „(0)". Nawias oddajemy tylko, gdy numer domyka się sam
  // („(+48 512 345 678)." → „([TELEFON])."). Przy „+" bez strażnika przepisów, bo żaden numer
  // przepisu nie zaczyna się plusem; „00" po „nr" zostaje pod strażnikiem („Zamówienie nr 0048512345678").
  ctx.text = ctx.text.replace(RE_PHONE_INTL, (m, open: string | undefined, num: string, offset: number) => {
    const o = open ?? '';
    if (!num.startsWith('+') && precededByLegalRef(ctx.text, offset + o.length)) return m;
    ctx.bump('TELEFON');
    const unbalanced = countOf(num, ')') > countOf(num, '(');
    return (unbalanced ? '' : o) + ctx.M.TELEFON;
  });
  // (c) fallback bez kontekstu; strażniki kwot, identyfikatorów i etykiet nie-telefonu wyżej.
  ctx.text = ctx.text.replace(RE_PHONE_BARE, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset) || precededByNonPhoneLabel(ctx.text, offset)) return m;
    const d = m.replace(/\D/g, '');
    // 800/801 to wyłącznie infolinie firm: nie ma strefy geograficznej ani zakresu komórkowego 80.
    if (d.startsWith('0') || /^80[01]/.test(d)) return m;
    if (gluedToIdentifier(ctx.text, offset, m.length) || looksLikeAmount(ctx.text, offset, m)) return m;
    return ctx.hit('TELEFON');
  });
}
