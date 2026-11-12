import { maskAfterLabel, type RedactCtx } from '../context.js';
import { CURRENCY_CODES } from '../guards/eponyms.js';
import { type PiiType } from '../types.js';
import { isValidCard, isValidIban, isValidNip, isValidPesel, isValidRegon14, isValidRegon9, precededByLegalRef, precededByNonPhoneLabel } from '../validators.js';


// ═════ FAZA 2 · IDENTYFIKATORY NUMERYCZNE (suma kontrolna / etykieta / długość) ═════
// Najdłuższe ciągi cyfr najpierw (IBAN 26 → PESEL 11 → NIP 10 → REGON), potem krótsze.
// 2) IBAN (z prefiksem kraju, walidacja mod 97). Dopuszcza spacje w grupach.
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
 * Długość (w znakach dopasowania) części, która jest numerem IBAN. Wzorzec IBAN-u połyka kolejne
 * wyrazy WERSALIKAMI („…0130 00 Z OPCJĄ SHA", „…4567 PKO BP", „… W EUR"), bo grupy numeru też
 * są z wielkich liter i cyfr. Dla znanego kraju tniemy na jego długości — tylko na granicy grupy
 * (spacja albo koniec), inaczej to nie ten numer. Dla nieznanego odcinamy końcowe wyrazy z samych
 * liter, o ile zostaje ≥ 15 znaków. Jeden kandydat na dopasowanie: mod-97 pilnuje precyzji jak dotąd.
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
/**
 * Koniec maski numeru uciętego przez ibanCut. Krótkie grupy z cyfrą tuż za długością kraju to ten
 * sam numer z literówką albo nadmiarową cyfrą („DE89 … 0130 00 12", „PL61 … 2874 5") — idą pod
 * maskę razem z nim, inaczej zostaje jawny fragment numeru. Wyrazy z samych liter („PKO BP",
 * „W EUR") zostają jawne jak dotąd, a grupa, po której stoi waluta albo grosze, to kwota
 * („PL61 … 2874 1500 zł"), nie ogon numeru. `after` — tekst za dopasowaniem.
 */
const RE_IBAN_TAIL = /^(?:[ ](?=[A-Z]{0,3}\d)[A-Z0-9]{1,4}(?![A-Z0-9]))*/;
const RE_IBAN_AMOUNT_AFTER = new RegExp(`^[ \\t\\u00A0]*(?:,\\d|zł(?:ot\\p{L}*)?|${[...CURRENCY_CODES].join('|')})(?!\\p{L})`, 'iu');
function ibanMaskEnd(m: string, c: number, after: string): number {
  const tail = RE_IBAN_TAIL.exec(m.slice(c))?.[0] ?? '';
  if (tail && RE_IBAN_AMOUNT_AFTER.test(m.slice(c + tail.length) + after)) return c;
  return c + tail.length;
}
// Odstęp między grupami cyfr numeru konta: spacja, twarda spacja (NBSP), spacja cyfrowa i wąska
// twarda spacja. Edytory i bankowość elektroniczna wstawiają NBSP, żeby numer nie łamał się
// w wierszu — dawniej wzorce znały tylko zwykłą spację i taki numer wyciekał w całości.
const NUM_WS = '[ \\u00A0\\u2007\\u202F]';
/** Kopia z twardymi spacjami zamienionymi na zwykłe — ta sama długość, więc indeksy cięcia
 *  liczone na kopii (ibanCut, ibanMaskEnd) pasują do oryginału. */
const plainSpaces = (s: string): string => s.replace(/[\u00A0\u2007\u202F]/g, ' ');
// IBAN z odstępami (też twardymi) albo w kanonicznym zapisie z łącznikami co 4 znaki
// („PL57-1140-2004-0000-3002-0123-4567") — mod-97 i tak rozstrzyga.
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
// (a) etykieta konta: także złożenia („mikrorachunek", „subkonto") i kwalifikator między etykietą
// a numerem („nr rachunku bankowego:", „rachunek podatkowy", „konto bankowe:", „rachunek VAT") —
// jak przy PESEL-u i NIP-ie. Dawniej przy złej sumie (literówka) taki numer wyciekał w całości.
const RE_ACCOUNT_LABELED = new RegExp(
  `(?<![\\p{L}])((?:mikro)?rachun(?:ek|ku|kiem)|(?:sub)?kont(?:o|a|em)|koncie|iban)(?![\\p{L}])` +
    `((?:\\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3}[\\s:.-]*)` +
    `((?:\\d${NUM_WS}?){25}\\d|\\d{2}(?:-\\d{4}){6})(?!${NUM_WS}?\\d|-\\d)`,
  'giu',
);
// (c) NRB bez etykiety: odstępy jak wyżej albo kanoniczne łączniki 2-4-4-4-4-4-4. Łącznik tylko
// w tym grupowaniu: „Konto księgowe 201-01-001-0002-…" czy numer zamówienia też mają 26 cyfr.
const RE_NRB_BARE = new RegExp(
  `(?<!\\d${NUM_WS}?|\\d-)(?:\\bPL${NUM_WS}?)?(?:(?:\\d${NUM_WS}?){25}\\d|\\d{2}(?:-\\d{4}){6})(?!${NUM_WS}?\\d|-\\d)`,
  'g',
);
// (b) etykieta + wartość w formacie IBAN (opis przy użyciu w passAccount); odstępy także twarde,
// polski numer też w kanonicznym zapisie z łącznikami, etykieta też „mikrorachunek".
const RE_ACCOUNT_IBAN_LABELED = new RegExp(
  `\\b((?:konto|Konto|KONTO|konta|Konta|rachunek|Rachunek|RACHUNEK|rachunku|Rachunku|mikrorachunek|Mikrorachunek|mikrorachunku|Mikrorachunku|nr konta|Nr konta|numer konta|Numer konta|iban|Iban|IBAN)(?:\\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\\s:=.-]+)` +
    `(PL${NUM_WS}?\\d{2}(?:${NUM_WS}?\\d){24}(?:${NUM_WS}?\\d){0,4}|PL\\d{2}(?:-\\d{4}){6}|[A-Z]{2}\\d{2}(?:${NUM_WS}?[A-Z0-9]){11,30})(?![A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]|-\\d)`,
  'g',
);

// 3) NR KONTA (NRB) zakotwiczony słowem „konto/rachunek/IBAN" + 26 cyfr (z opcjonalnymi spacjami).
export function passAccount(ctx: RedactCtx): void {
  if (!ctx.on('NR-KONTA')) return;
  maskAfterLabel(ctx, RE_ACCOUNT_LABELED, 'NR-KONTA');
  // (b) z etykietą + wartość w formacie IBAN — maskuj NAWET bez poprawnej sumy mod-97.
  // BEZ flagi /i: wartość [A-Z0-9] musi być WIELKIMI literami/cyframi (jak realny IBAN). Z /i klasa
  // łapała małe litery następnego słowa („…3152 wpłynęły" → maska zjadała „ wp"). Warianty wielkości
  // liter etykiety wyliczone jawnie; lookahead (?![A-Za-z0-9]) domyka wartość na granicy słowa.
  // Polski numer ma osobną gałąź (PL + 26 cyfr), także ze spacją po „PL" („PL 92 1050 …" — wtedy
  // wzorzec ogólny nie pasował i przy złej sumie numer wyciekał w całości). Gałąź bierze też do
  // 4 nadmiarowych cyfr (literówka „… 2874 5"): idą pod maskę razem z numerem (ibanMaskEnd).
  // Wartość ogólna jest zachłanna jak w passIban, więc nadmiar („ PKO BP", „ W EUR", „ SWIFT")
  // odcina ibanCut i oddaje bez zmian. Prawa granica zna polskie litery: bez nich „…Z TYTU|ŁEM"
  // uchodziło za koniec wyrazu i maska zjadała „Z TYTU".
  ctx.text = ctx.text.replace(
    RE_ACCOUNT_IBAN_LABELED,
    (m, kw: string, sep: string, val: string, offset: number) => {
      ctx.bump('NR-KONTA');
      const p = plainSpaces(val);
      const after = plainSpaces(ctx.text.slice(offset + m.length, offset + m.length + 8));
      return `${kw}${sep}${ctx.M['NR-KONTA']}${val.slice(ibanMaskEnd(p, ibanCut(p), after))}`;
    },
  );
  // (c) NRB BEZ etykiety — 26 cyfr z POPRAWNĄ sumą (walidacja po dodaniu „PL"). Prefiks „PL"/„PL "
  // trafia pod maskę razem z numerem („PL [NR-KONTA]" zostawiało jawny kraj obok maski).
  ctx.text = ctx.text.replace(RE_NRB_BARE, (m) => {
    if (isValidIban('PL' + m.replace(/^PL/, '').replace(/[\s-]/g, ''))) {
      ctx.bump('NR-KONTA');
      return ctx.M['NR-KONTA'];
    }
    return m;
  });
}

// 4) PESEL — 11 cyfr + suma kontrolna, nie po „art./poz.".
export function passPesel(ctx: RedactCtx): void {
  if (!ctx.on('PESEL')) return;
  ctx.text = ctx.text.replace(/(?<![\dA-Za-z])\d{11}(?![\d])/g, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    if (isValidPesel(m)) {
      ctx.bump('PESEL');
      return ctx.M.PESEL;
    }
    return m;
  });
  // (b) z SILNĄ etykietą „PESEL" — maskuj 11 cyfr NAWET bez poprawnej sumy (etykieta to sygnał).
  maskAfterLabel(
    ctx,
    /\b(pesel(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]+)(\d{11})(?![\d])/gi,
    'PESEL',
  );
  // (c) z etykietą i ODSTĘPAMI między cyframi („851 103 142 83", „851103 14283", kratki formularza).
  // Grupy mogą przejść przez JEDNO łamanie wiersza („PESEL 851 103⏎142 83" z zawiniętej kolumny),
  // ale tylko z poprawną sumą (pilnuje maskSpacedAfterLabel): ogon w nowej linii bywa innym polem.
  maskSpacedAfterLabel(ctx, /\b(pesel(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]*[\s:=.|-])(\d(?:(?:[ \t|-]{0,3}|[ \t]*\r?\n[ \t]*)\d){10})(?![ \t|-]{0,3}\d)/gi, 'PESEL', isValidPesel);
}

// Słowa za etykietą, które nie opisują numeru, tylko otwierają INNE pole albo mówią, że numeru nie
// ma: „PESEL⏎Tel. 48 601 222 333", „REGON brak telefon 601 222 333", „NIP⏎KRS 0000 123 456". Lista
// słów etykiety przechodziła przez nową linię i wartość następnego pola dostawała maskę numeru.
const RE_FOREIGN_FIELD_WORD =
  /^(?:tel\p{L}*|kom|komórk\p{L}*|fax|faks|kontakt\p{L}*|krs|kart[aęyą]?|kont(?:o|a|u|em|cie)|rachun\p{L}*|iban|nrb|dow[oó]d\p{L}*|paszport\p{L}*|pesel|nip|regon|brak|nie)$/iu;
/**
 * Numer z silną etykietą zapisany z odstępami między cyframi: grupy („PESEL: 851 103 142 83",
 * „NIP 5260 2502 74") albo cyfra po cyfrze w kratkach formularza („PESEL: 8 5 1 1 0 3 1 4 2 8 3",
 * „|8|5|1|…"). Dawniej żadna gałąź nie znała separatorów w środku: zapis 3-3-3-2 zjadał detektor
 * telefonu i zostawał jawny ogon („PESEL: [TELEFON] 83"), a pozostałe wyciekały w całości. Grupy
 * co najmniej dwucyfrowe rozdzielone pojedynczą spacją lub łącznikiem to zapis numeru, więc jak przy
 * zapisie ciągiem maskujemy mimo złej sumy (literówka). Cyfry pojedyncze, tabulator, „|" albo kilka
 * spacji: tylko z poprawną sumą, bo to też wzór z instrukcji („Pole PESEL: 1 2 3 4 …") czy kolumny.
 * Bez etykiety nic się nie zmienia: „Jan Kowalski 501 120 345 43" to telefon i wiek, nie PESEL.
 */
function maskSpacedAfterLabel(ctx: RedactCtx, re: RegExp, type: PiiType, valid: (d: string) => boolean): void {
  ctx.text = ctx.text.replace(re, (m, kw: string, sep: string, val: string, off: number, str: string) => {
    // słowa etykiety tylko w tym samym wierszu i tylko takie, które opisują ten numer
    // („PESEL pacjenta:", „NIP nabywcy"); pierwsze słowo to sama etykieta
    if (kw.includes('\n') || kw.split(/\s+/).slice(1).some((w) => RE_FOREIGN_FIELD_WORD.test(w))) return m;
    const core = val.replace(/^PL[- ]?/, ''); // prefiks kraju przed NIP-em
    if (!/[ \t|\n-]/.test(core)) return m;
    const d = core.replace(/\D/g, '');
    // Łamanie wiersza w środku numeru: najwyżej jedno. Z poprawną sumą zawsze, z literówką tylko
    // grupy, które w nowej linii same domykają wiersz („PESEL: 851 103⏎142 84"), a nie początek
    // innego pola z liczbą.
    if (core.includes('\n')) {
      if ((core.match(/\n/g) || []).length > 1) return m;
      const tailEnds = /^[ \t]*(?:\r?\n|$)/.test(str.slice(off + m.length));
      if (!valid(d) && !tailEnds) return m;
    }
    const grouped = /^\d{2,}(?:(?:[ -]|[ \t]*\r?\n[ \t]*)\d{2,})+$/.test(core);
    if (!grouped && !valid(d)) return m;
    ctx.bump(type);
    return `${kw}${sep}${ctx.M[type]}`;
  });
}

// 5) NIP — separator MYŚLNIK LUB SPACJA lub 10 cyfr ciągiem + suma kontrolna. Spacja także twarda
// (NUM_WS): „NIP: 526 000 12 46" z NBSP wyciekał, choć ten sam zapis z łącznikami był maskowany.
const NIP_SEP = '[- \\u00A0\\u2007\\u202F]';
const NIP_VALUE = `(?:PL${NIP_SEP}?)?(?:\\d{3}${NIP_SEP}\\d{3}${NIP_SEP}\\d{2}${NIP_SEP}\\d{2}|\\d{3}${NIP_SEP}\\d{2}${NIP_SEP}\\d{2}${NIP_SEP}\\d{3}|\\d{10})`;
const RE_NIP = new RegExp(`(?<![\\d])${NIP_VALUE}(?![\\d])`, 'g');
const RE_NIP_LABELED = new RegExp(`\\b(nip(?:\\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\\s:=.-]+)(${NIP_VALUE})(?![\\d])`, 'gi');
export function passNip(ctx: RedactCtx): void {
  if (!ctx.on('NIP')) return;
  // Opcjonalny prefiks kraju „PL" maskujemy RAZEM z numerem — maskuj całość, nie fragment.
  ctx.text = ctx.text.replace(
    RE_NIP,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset)) return m;
      if (isValidNip(m.replace(/^PL[- \u00A0\u2007\u202F]?/, ''))) {
        ctx.bump('NIP');
        return ctx.M.NIP;
      }
      return m;
    },
  );
  // (b) z SILNĄ etykietą „NIP" — maskuj 10 cyfr (dowolny separator) NAWET bez poprawnej sumy.
  maskAfterLabel(ctx, RE_NIP_LABELED, 'NIP');
  // (c) z etykietą i innym grupowaniem albo cyframi w kratkach („NIP: 5 2 6 0 2 5 0 2 7 4").
  maskSpacedAfterLabel(ctx, /\b(nip(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]*[\s:=.|-])((?:PL[- ]?)?\d(?:[ \t|-]{0,3}\d){9})(?![ \t|-]{0,3}\d)/gi, 'NIP', isValidNip);
}

// 6) REGON 14-cyfrowy (jednoznaczny) + suma kontrolna.
export function passRegon(ctx: RedactCtx): void {
  if (!ctx.on('REGON')) return;
  ctx.text = ctx.text.replace(/(?<![\d])\d{14}(?![\d])/g, (m) => {
    if (isValidRegon14(m)) {
      ctx.bump('REGON');
      return ctx.M.REGON;
    }
    return m;
  });
  // 6a) REGON z etykietą „REGON" — 9 lub 14 cyfr. Maskuj NAWET bez poprawnej sumy.
  maskAfterLabel(
    ctx,
    /\b(regon(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]+)(\d{14}|\d{9})(?![\d])/gi,
    'REGON',
  );
  // (c) z etykietą i odstępami między cyframi („REGON: 012 345 675", „REGON: 0 1 2 3 4 5 6 7 5").
  maskSpacedAfterLabel(
    ctx,
    /\b(regon(?:\s+(?:to|o|nr|[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,})){0,3})([\s:=.-]*[\s:=.|-])(\d(?:[ \t|-]{0,3}\d){13}|\d(?:[ \t|-]{0,3}\d){8})(?![ \t|-]{0,3}\d)/gi,
    'REGON',
    (d) => (d.length === 14 ? isValidRegon14(d) : isValidRegon9(d)),
  );
}

// 6b) KARTA PŁATNICZA — TYLKO z kontekstem karty („karta/płatnicz/Visa/Mastercard/Maestro/Amex/
// Diners/Discover/JCB/card"): 13–19 cyfr (grupy po 4, sep. spacja/myślnik) + prefiks znanej sieci
// + suma Luhna. Kontekst jest WYMAGANY, bo sam Luhn+prefiks jest zbyt niejednoznaczny: IMEI
// (15 cyfr, MA sumę Luhna, prefiksy 35/37/4…), numery przesyłek/faktur, kody kreskowe (EAN) i
// identyfikatory transakcji też je spełniają. Bez etykiety karty NIE maskujemy (precyzja >
// nadmaskowanie — audyt adwersarialny wykrył 10 fałszywych trafień na wariancie bez kontekstu).
// Biegnie PRZED REGON, żeby kontekst karty wygrał dla 14-cyfrowego numeru (Diners) nad ślepą
// sumą REGON; numer 14-cyfr bez kontekstu karty zostaje dla REGON.
// Człon numeru po słowie karty: „Card number:", „kartą o numerze …", „karta o nr …" i klucze
// zrośnięte („card_number", „cardNumber", „card_no") — dawniej znane było tylko „nr/numer/no".
// Kontekst karty i walidacja (Luhn, sieć, długość) bez zmian, więc „umowa o numerze …" czy
// „Discard number …" (bez granicy przed „card") zostają.
export function passCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA')) return;
  ctx.text = ctx.text.replace(
    /\b((?:kart[a-ząćęłńóśźż]*|card|visa|mastercard|maestro|amex|american\s+express|diners(?:\s+club)?|discover|jcb|płatnicz[a-ząćęłńóśźż]*|kredytow[a-ząćęłńóśźż]*|debetow[a-ząćęłńóśźż]*)(?:(?:[ \t]+o)?[ \t]+(?:nr|numer(?:ze|u)?|number|no)\.?|[_-]?(?:number|no|nr)\b)?)([\s:="'()<>|.-]+)((?:\d[ -]?){12,18}\d)(?![\d])/gi,
    (m, kw: string, sep: string, num: string) => {
      if (isValidCard(num)) {
        ctx.bump('KARTA');
        return `${kw}${sep}${ctx.M.KARTA}`;
      }
      return m;
    },
  );
}

// 8) TELEFON — polskie numery 9-cyfrowe. Trzy tryby, od najpewniejszego. (b) BIEGNIE PRZED (a),
// by placeholder nie przerwał łańcucha wyliczenia po kotwicy.
// Separatory członów wyliczenia w trybie (b): przecinek i „oraz/i" oraz — od niedawna — średnik,
// ukośnik i „lub/albo/bądź" (dawniej drugi numer po „lub" albo „/" zostawał jawny). „bądź"
// z granicą polskich liter, bo ASCII \b nie widzi granicy przy „ź". Człon po NOWYM separatorze
// musi być CAŁYM numerem (bez dalszych cyfr w tym samym wierszu): „lub 0048 61 852 33 48" nie
// może stać się „[TELEFON] 33 48" — taki numer przejmuje w całości tryb (a). Dawne separatory
// zachowują dawne zachowanie (prefiksy „0048"/„(48)" po przecinku to osobna sprawa). Żaden człon
// łańcucha nie może być kwotą („tel. 601 222 333 lub 120 000 000 zł" — kwota zostaje), jak w (c).
const PHONE_ENUM_SEP_OLD = String.raw`(?:,|\boraz\b|\bi\b)`;
const PHONE_ENUM_SEP_NEW = String.raw`(?:;|\/|\blub\b|\balbo\b|(?<![a-ząćęłńóśźż])bądź(?![a-ząćęłńóśźż]))`;
// Prefiks kraju przed numerem w trybie (b): „+48", „0048", „00 48", „(48)", „(+48)", „(0048)",
// „48" sklejone z numerem („48512345678") i zero międzymiastowe po nim („+48 (0)22 …"). Dawniej znany
// był tylko „+48" z separatorem, więc okno 9 cyfr zaczynało się na kodzie kraju i ostatnie cyfry
// numeru zostawały jawne („tel.: [TELEFON] 55 21"). Za nim opcjonalne zero międzymiastowe starego
// zapisu („(0-61) 852 33 44", „(061) 852 33 45"). Ten sam człon w regexie, w członie wyliczenia
// i w segmencie maskowanym w callbacku — inaczej okna się rozjeżdżają i zostaje ogon numeru.
// Długość całości pilnuje `phoneDigitsValid`: „tel. 4851234567" czy „tel. 485123456789" odpadają.
const PHONE_CC = String.raw`(?:\(?(?:(?:\+|00)[ \t]?)?48\)?[\s.-]{0,3}(?:[ \t]?\(0\))?)?(?:\(?0(?![\s-]?0)[\s-]?)?`;
const PHONE_ENUM_MEMBER = String.raw`\s*(?:(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|kom\.?|tel\.?|nr\.?)\s+)?${PHONE_CC}(?:[\s\-().]{0,3}\d){9}`;
const PHONE_NOT_AMOUNT = String.raw`(?![ \t]*(?:,\d{2})?[ \t]*(?:zł|PLN|EUR|USD|gr\b))`;
// Kotwice trybu (b). MOCNE (tel./telefon/nr tel./fax/faks) dopuszczają przerwę do dwóch wyrazów
// w tej samej linii, gdy ostatni jest skrótem z kropką albo stoi przed dwukropkiem („tel. stacj.
// 22 843 21 09", „Telefon pacjenta: …", „Nr tel. opiekuna: …"): stacjonarny 2-3-2-2 po takiej
// etykiecie wyciekał w całości, bo (c) celowo go nie łapie. Przerwa należy do kotwicy, nie do
// strażnika w callbacku — odrzucone dopasowanie zjadłoby kotwicę leżącą dalej w tym samym ciągu.
// Bez przerwy zostają „kom." (Komisja, Komenda: „Kom. Wyborcza: 32 774 91 55 głosów") i „kontakt"
// („Kontakt sprawy: …"), a liczba mnoga „Telefonów było: …" nie jest mocną kotwicą.
// Pozostałe: odmiana „komórkę/komórce/komórką/komórkowy", „telefonicznie", stopki („Phone:",
// „Mobile:", „mob.", „GSM:" — granica \b odcina „iPhone" i „mobbing") i czasownik z „pod/na
// numer" („dzwonić pod numer …", „zadzwoń pod nr …"); sam czasownik nie wystarcza („Dzwonił
// w sprawie faktury …"), a „dzwo[nń]\w*" łapałoby „Dzwonnica nr 123 456 789". Samo „pod/na" bez
// „numer" też jest kotwicą („proszę dzwonić pod 512 345⏎678"): numer złamany w wierszu wyciekał
// w całości, bo fallback 3-3-3 celowo nie przechodzi przez nową linię.
// Skróty z wykazów sprzętu („Telefon nr inw. 012345678 – zużyty", „Fax nr fabr. 12 345 67 89",
// „nr ewid.", „nr ser.") nie są przerwą w etykiecie telefonu: za nimi stoi numer składnika majątku.
const PHONE_GAP_WORD = String.raw`(?!(?:inw|ewid|fabr|ser|kat|poz|szt|egz|lp)\.)[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{2,15}`;
// Linia vCard z parametrami („TEL;TYPE=WORK:22 123 45 67", „TEL;WORK;VOICE:…") — stacjonarny 2-3-2-2
// po niej wyciekał, bo średnik z parametrami rozdzielał kotwicę „TEL" od dwukropka. Parametr przed
// dwukropkiem jest obowiązkowy: „Hotel; pokój 22 123 45 67" nie ma „TEL" jako osobnego wyrazu.
const PHONE_ANCHOR =
  '(?:tel(?:;[A-Za-z-]{1,20}(?:=[A-Za-z0-9,-]{1,40})?){1,4}(?=:))|' +
  String.raw`(?:te[li]\.?|telefon(?:u|y|em|ie)?|nr te[li]\.?|fax|faks)(?:(?:[ \t]+${PHONE_GAP_WORD}\.?)?[ \t]+${PHONE_GAP_WORD}(?:\.|[ \t]*(?=:)))?` +
  String.raw`|telefon(?:\w|[ąćęłńóśźż]){0,6}|kom\.?|komór(?:k(?:\w|[ąćęłńóśźż]){1,5}|ce)|kontakt\w{0,4}|(?:tele)?phone|mobile|mob\.?|gsm` +
  String.raw`|(?:za|od|prze)?dzwo(?:ni(?:ć|li|ły|my|cie|sz|ą|ę|ł[a-ząęó]*)?|ń(?:cie)?)[ \t]+(?:pod|na)(?:[ \t]+(?:numer\w*|nr\.?))?`;
// Wypełniacz „nr"/„na" tylko w tej samej linii („tel. nr 600 700 800", „Kontakt: nr …", „Tel. na …"):
// „Telefon⏎nr 123 456 789" to nagłówek nad numerem czegoś innego. Po samym „kontakt" bez dwukropka
// „nr" odrzuca callback — „Dotyczy kontaktu nr 123456789 w CRM" to identyfikator rekordu.
// (patrz rejectPhoneNrFiller). Podział wypełniacza musi być jednoznaczny: przy „[ \t]*[:.]?[ \t]+"
// ciąg spacji dzielił się między dwa kwantyfikatory na wiele sposobów, a kropkę po „nr" brało albo
// „nr\.?", albo „[:.]" następnego powtórzenia. W wierszu tabeli bez numerów („Telefon      NA
// NA …" z eksportu danych z brakami) każde powtórzenie mnożyło liczbę prób i jeden wiersz liczył się
// sekundami. Dlatego dwukropek albo kropka tylko z odstępami PRZED nimi, a „nr" zawsze bierze kropkę.
const RE_PHONE_NR_WORD = /(?<!\p{L})nr(?!\p{L})/iu;
// Przymiotnik, liczba mnoga i przysłówek („telefoniczne", „telefonów", „telefony", „telefonicznie")
// — nie rzeczownik „telefon/telefonu/telefonem/telefonie".
const RE_PHONE_KW_WEAK = /^telefon(?!(?:u|em|ie)?(?!\p{L}))/iu;
/**
 * Czy wypełniacz „nr" po kotwicy wskazuje numer sprawy, a nie telefon? Po samym „kontakt…" tuż
 * przed „nr" stoi identyfikator rekordu („Dotyczy kontaktu nr 123456789"), a po przymiotniku,
 * liczbie mnogiej czy przysłówku numer zgłoszenia, umowy albo faktury („Zgłoszenie telefoniczne
 * nr 202410001", „Abonament telefoniczny nr …", „Faktura za telefony nr …", „przyjęto
 * telefonicznie pod nr …"). Dwukropek robi z tego etykietę pola („Kontaktowy nr: …", „Telefony: nr …"),
 * a „Telefony" na początku wiersza albo zdania to nagłówek listy („Telefony nr 600 … i 601 …").
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
const RE_PHONE_ANCHORED = new RegExp(
  String.raw`\b(${PHONE_ANCHOR})((?:\s+(?:kontaktow\w+|stacjonarn\w+|służbow\w+|komórkow\w+|domow\w+|telefoniczn\w+|pod|numer\w*)|(?:[ \t]*[:.])?[ \t]+(?:nr(?:\.|(?!\.))|na))*[\s:.=-]*)(${PHONE_CC}(?:[\s\-().]{0,3}\d){9}(?:\s*${PHONE_ENUM_SEP_OLD}${PHONE_ENUM_MEMBER}${PHONE_NOT_AMOUNT}|\s*${PHONE_ENUM_SEP_NEW}${PHONE_ENUM_MEMBER}(?![ \t\-().]{0,3}\d)${PHONE_NOT_AMOUNT})*)(?![.:]?\d)`,
  'gi',
);
// Segment zaczyna się od kropki i odstępów wypełniacza („, tel. 0048 601 …", „kom. 0 602 …"): bez
// nich skan startował od samej kropki, okno 9 cyfr (które też przepuszcza kropkę) zaczynało się na
// cyfrach prefiksu, a ogon numeru abonenta zostawał jawny za maską („kom. [TELEFON]3 444").
const RE_PHONE_SEGMENT = new RegExp(String.raw`[\s.]*${PHONE_CC}(?:[\s\-().]{0,3}\d){9}`, 'g');
/**
 * Czy cyfry członu to numer: 9 cyfr krajowych, z zerem międzymiastowym 10, a przed nimi
 * ewentualnie kod kraju „48"/„0048" („+48 (0)22 …" daje 12 cyfr z „480").
 */
function phoneDigitsValid(d: string): boolean {
  const national = (s: string): boolean => s.length === 9 || (s.length === 10 && s[0] === '0');
  return national(d) || (d.startsWith('48') && national(d.slice(2))) || (d.startsWith('0048') && national(d.slice(4)));
}
const PHONE_ENUM_SEP = `(?:${PHONE_ENUM_SEP_OLD}|${PHONE_ENUM_SEP_NEW})`;
const RE_PHONE_ENUM_SPLIT = new RegExp(String.raw`\s*${PHONE_ENUM_SEP}\s*`, 'i');
// Data na początku członu („Kontakt telefoniczny 12.10.2026 9", „Tel. 2026.10.14 9:05"): okno
// 9 cyfr trybu (b) przepuszcza kropki i myślniki, więc data z cyfrą godziny dawała „telefon"
// („[TELEFON]:45"). Prawa granica RE_PHONE_ANCHORED `(?![.:]?\d)` odcina godzinę z minutami,
// a ten wzorzec — datę z samą godziną na końcu członu.
const RE_PHONE_DATE_SHAPE =
  /^[\s(]*(?:\d{1,2}[.\-/](?:0?[1-9]|1[0-2])[.\-/](?:19|20)\d{2}|(?:19|20)\d{2}[.\-/](?:0?[1-9]|1[0-2])[.\-/]\d{1,2})(?!\d)/;

// ── Strażniki trybu (c) — liczba w kształcie telefonu, która telefonem nie jest ──
// Odstępy poziome razem z twardą i wąską spacją: edytory i eksporty z arkuszy wstawiają je
// między grupy cyfr kwoty i przed walutą („150 000 000 zł").
const PHONE_GAP = '[ \\t\\u00A0\\u2009\\u202F]';
const PHONE_CODES = [...CURRENCY_CODES, 'HUF', 'EURO', 'KČ', 'ZL'].join('|');
// Waluta albo mnożnik PO liczbie (bez względu na wielkość liter, z granicą litery: „601 234 567
// EUROPA" to nie kwota). Grosze „,50" mogą stać między liczbą a walutą.
const RE_PHONE_AMOUNT_AFTER = new RegExp(
  `^${PHONE_GAP}*(?:,\\d{1,2}(?!\\d))?${PHONE_GAP}*(?:(?:${PHONE_CODES}|tys|mln|mld)(?!\\p{L})|[€£]|\\$(?!\\p{L}))`,
  'iu',
);
// „zł" i „gr" osobno, z rozróżnieniem wielkości liter i tylko w formach waluty: wyraz zaczynający
// się od tych liter to nie kwota — „601 234 567 Złotów" i „… ZŁOTÓW" to miasto, „… ZŁOŻYŁ
// WNIOSEK" i „… złożył" to proza, „… Gr. A" to grupa (flaga „i" brała ją za grosze).
const RE_PHONE_ZL_AFTER = new RegExp(
  `^${PHONE_GAP}*(?:,\\d{1,2}(?!\\d))?${PHONE_GAP}*` +
    '(?:zł(?:ot(?:y|e|ych|ego|emu|ym|ymi|ówk\\p{L}*|ówek))?|ZŁ(?:OT(?:Y|E|YCH|EGO|EMU|YM|YMI|ÓWK\\p{L}*|ÓWEK))?|' +
    'Zł(?:ot(?:y|e|ych))?|gr(?:osz\\p{L}*)?)(?!\\p{L})',
  'u',
);
// Waluta za numerem, a za nią kolejna liczba („603 456 789 zł 30,00") — waluta poprzedza kwotę.
const RE_CURRENCY_BEFORE_NUMBER = new RegExp(`^${PHONE_GAP}*(?:zł|ZŁ|Zł|PLN|EUR|USD|€|\\$)${PHONE_GAP}*\\d`, 'u');
// Waluta PRZED liczbą („PLN 125 450 300", „€125 450 300") — ale nie wtedy, gdy kończy INNĄ kwotę
// („Abonament 49 zł 600 100 200": tu numer stoi po kwocie, a nie jest nią).
const RE_PHONE_AMOUNT_BEFORE = new RegExp(`(?:(?<![\\p{L}\\d])(?:${PHONE_CODES}|zł)|[€$£])${PHONE_GAP}?$`, 'iu');
const RE_PHONE_AMOUNT_BEFORE_OTHER = new RegExp(`\\d${PHONE_GAP}*(?:(?:${PHONE_CODES}|zł)|[€$£])${PHONE_GAP}?$`, 'iu');
// Ogon liczby ≥ 1 mld: grupa wiodąca 1–3 cyfr otwiera pole („Wartość: 1 234 567 890"), komórkę
// („| 1 234 567 890") albo nawias. Bez cyfry przed ogranicznikiem — „14:22 512 345 678" to godzina
// i telefon — i bez „48" (prefiks kraju zapisany bez plusa).
const RE_PHONE_BILLION_HEAD = /(?<!\d)[:|=;\t(][ \t]*(?!48\D)[1-9]\d{0,2}.$/;
// …ale nie po etykiecie identyfikatora albo telefonu: „PESEL: 85 110 314 283" to numer, nie kwota.
const RE_PHONE_ID_LABEL =
  /(?<![\p{L}])(?:pesel|nip|regon|krs|dow[oó]d\p{L}*|paszport\p{L}*|tel|telefon\p{L}*|kom|komórk\p{L}*|fax|faks|kontakt\p{L}*|nr|numer\p{L}*|id)(?![\p{L}])/iu;
/**
 * Czy liczba w kształcie telefonu to w istocie kwota? Tryb (c) nie ma kotwicy, więc tu decyduje
 * otoczenie: waluta lub mnożnik po liczbie albo przed nią, grosze po liczbie grupowanej spacjami,
 * ogon większej liczby po etykiecie pola, okrągłe setki milionów. Tryb kotwicowy (b) biegnie
 * wcześniej i tego nie sprawdza — „tel. 500 000 000" dalej jest telefonem.
 */
function looksLikeAmount(full: string, offset: number, m: string): boolean {
  const end = offset + m.length;
  const after = full.slice(end, end + 16);
  if (RE_PHONE_AMOUNT_AFTER.test(after) || RE_PHONE_ZL_AFTER.test(after)) return true;
  const before = full.slice(Math.max(0, offset - 16), offset);
  if (RE_PHONE_AMOUNT_BEFORE.test(before) && !RE_PHONE_AMOUNT_BEFORE_OTHER.test(before)) return true;
  if (/^\d{3}0{6}$/.test(m.replace(/\D/g, ''))) return true;
  // Pozostałe reguły tylko dla liczby grupowanej JEDNOLITYM odstępem (kwota). Ciągłe 9 cyfr
  // z polem CSV obok („Kowalski,Jan,512345678,34") to dalej telefon.
  const sep = /^\d{3}([    ])\d{3}\1\d{3}$/.exec(m)?.[1];
  if (!sep) return false;
  // grosze „,55" — ale nie w CSV: bez przecinka przed liczbą i bez kolejnego pola po groszach
  if (full[offset - 1] !== ',' && /^,\d{1,2}(?![\d,])/.test(after)) return true;
  if (!before.endsWith(sep) || !RE_PHONE_BILLION_HEAD.test(before)) return false;
  // Etykieta w tej samej linii — granicę linii szukamy tylko w oknie (lastIndexOf po całym
  // tekście był kwadratowy w długiej linii bez „\n").
  const win = full.slice(Math.max(0, offset - 40), offset);
  return !RE_PHONE_ID_LABEL.test(win.slice(win.lastIndexOf('\n') + 1));
}
// Człon przed „/" lub „-", który nie robi z numeru identyfikatora: wyraz od wielkiej litery
// (osobno od słów telefonicznych — flaga „i" zrównałaby \p{Lu} z małymi literami).
const RE_PHONE_JOIN_WORD = /^(?:tel|telefon\p{L}*|kom|komórk\p{L}*|sms|gsm|fax|faks|kontakt\p{L}*|mob|mobile|cell|phone)$/iu;
// Prefiksy numerów komórkowych w Polsce (9 cyfr bez kierunkowego kraju).
const RE_PL_MOBILE_PREFIX = /^(?:45|5[0137]|6[069]|7[2389]|88)\d{7}$/;
const isPersonalJoinPart = (s: string): boolean => /^\p{Lu}\p{Ll}+$/u.test(s) || RE_PHONE_JOIN_WORD.test(s);
/**
 * Czy 9 cyfr to wnętrze identyfikatora („RR123456789PL", „FV/2026/123456789", „ZAM-123456789",
 * „SKU 123456789A", „DE811569869")? Wtedy maska rozrywała token i zostawiała jawne kawałki.
 * Sprawdzamy w callbacku, nie w lookbehindzie: lookbehind o zmiennej długości jest kwadratowy.
 * Mała litera przed numerem NIE blokuje („Kowalski512345678", „dzwoń512345678" z ekstrakcji
 * PDF to telefon), a „/" i „-" blokują tylko jako łącznik tokenu identyfikatora (niżej) —
 * „500600700/501601701" i lista „-500600700" to dalej telefony.
 */
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
function gluedToIdentifier(full: string, offset: number, len: number): boolean {
  const before = full.slice(Math.max(0, offset - 32), offset);
  if (/\p{Lu}$/u.test(before)) return true;
  // „_" po literze lub cyfrze to łącznik identyfikatora („ZAM_123456789"), a ciąg podkreślników
  // po etykiecie — linia do wypełnienia w formularzu („Telefon: ____601 234 567" to telefon).
  // Wyjątek: człon przed „_" jest słowem telefonicznym („kontakt_tel_600111222") albo zwykłym
  // wyrazem w nazwie pliku, a numer ma prefiks komórkowy („dok_600111222.pdf",
  // „Wniosek_…_tel_600111222.pdf"). Kod wersalikami albo z cyfrą („ZAM_…", „x_123456789") dalej blokuje.
  const us = /([\p{L}\d]+)_+$/u.exec(before);
  if (us) {
    const d = full.slice(offset, offset + len).replace(/\D/g, '').replace(/^(?:00)?48(?=\d{9}$)/, '');
    const phoneWord = RE_PHONE_JOIN_WORD.test(us[1]);
    const fileWord = /^(?:\p{Ll}{2,}|\p{Lu}\p{Ll}+)$/u.test(us[1]) && RE_PL_MOBILE_PREFIX.test(d);
    if (!phoneWord && !fileWord && !(RE_PL_MOBILE_PREFIX.test(d) && fileNameChainBefore(before))) return true;
  }
  // Token z literą sklejony „/" lub „-" blokuje, gdy któryś jego człon ma cyfrę albo „_" albo jest
  // skrótem lub słowem małymi literami („FV/2026/", „ZAM-", „sklep/order/"). Imię, nazwisko
  // i słowo telefoniczne przed numerem osoby nie blokują („Anna Nowak/601 234 567",
  // „Kowalski-601234567", „Nowak-Kowalska-…", „SMS/601…", „Tel/607…") — tam numer wyciekałby
  // w całości, a to częsty zapis w pismach („córka Anna/603 456 789").
  const tok = /[\p{L}\d_/-]*[/-]$/u.exec(before)?.[0] ?? '';
  if (/\p{L}/u.test(tok) && !tok.split(/[/-]+/).filter(Boolean).every(isPersonalJoinPart)) return true;
  // Litera albo „_" zaraz po cyfrach („RR123456789PL", „SKU 123456789A"). Wyjątek: jednoliterowy
  // przyimek doklejony do numeru, który sam zaczyna token („512345678w godz. 8-16").
  const next = full.charAt(offset + len);
  if (!/[\p{L}_]/u.test(next)) return false;
  return !(/[wzoiu]/.test(next) && !/[\p{L}\d_]/u.test(full.charAt(offset + len + 1)) && !/[\p{L}\d]$/u.test(before));
}
export function passPhone(ctx: RedactCtx): void {
  if (!ctx.on('TELEFON')) return;
  // (b) słowo kontekstowe + 9 cyfr (zachowujemy słowo, maskujemy numer), także wyliczenie.
  // Odrzucona kotwica oddaje resztę dopasowania do ponownego skanu: wyliczenie za numerem rekordu
  // („Kontakt nr 512 345 678, tel. 22 843 21 09") ma własną kotwicę, a dopasowanie zjadało ją razem
  // z numerem i drugi telefon wyciekał w całości.
  const anchored = (m: string, kw: string, sep: string, nums: string, offset: number, str: string): string => {
    if (rejectPhoneNrFiller(kw, sep, str, offset)) return `${kw}${sep}${nums.replace(RE_PHONE_ANCHORED, anchored)}`;
    const parts = nums.split(RE_PHONE_ENUM_SPLIT);
    if (!parts.every((p) => phoneDigitsValid(p.replace(/\D/g, '')))) return m;
    if (parts.some((p) => RE_PHONE_DATE_SHAPE.test(p))) return m;
    // Waluta za liczbą po „komórce/komórkę" i przymiotniku „telefoniczne" to kwota: komórka arkusza
    // („W komórce 123 456 789 zł", „na komórkę 600 700 800 zł"), pozycja zestawienia kosztów („Usługi
    // telefoniczne: 123 456 789 zł"). Po etykiecie („tel. 600 700 800 zł", „kom. … euro") zostaje
    // jak dotąd — tam stoi numer. Waluta przed następną liczbą („komórka: 603 456 789 zł 30,00" w bilingu)
    // należy do tej liczby, nie do numeru.
    if (/^komór/i.test(kw) || RE_PHONE_KW_WEAK.test(kw)) {
      const after = str.slice(offset + m.length, offset + m.length + 16);
      if ((RE_PHONE_AMOUNT_AFTER.test(after) || RE_PHONE_ZL_AFTER.test(after)) && !RE_CURRENCY_BEFORE_NUMBER.test(after)) return m;
    }
    // maskuj każdy 9-cyfrowy człon w miejscu — separatory listy i wypełniacze zostają.
    // Człon po wypełniaczu („, kom. 601…") zaczyna się od „. " — kropka należy do skrótu,
    // nie do numeru, więc zostaje przed maską (dawniej wychodziło „kom[TELEFON]").
    // Wiodące odstępy wchodzą do segmentu PRZED prefiksem: inaczej segment członu „lub 48 602 333
    // 444" startował od spacji, prefiks „48" nie mógł zadziałać, okno 9 cyfr obejmowało „48 602
    // 333 4" i dwie ostatnie cyfry numeru zostawały jawne. Odstępy i tak wracają w `lead`.
    // Nawias otwierający prefiks („(+48 512 345 678)") zostaje przed maską, gdy numer domyka go
    // dopiero za segmentem — jak w trybie (a); inaczej zostawał osierocony „)" za maską.
    const out = nums.replace(RE_PHONE_SEGMENT, (seg) => {
      ctx.bump('TELEFON');
      const lead = seg.match(/^[\s.]*/)?.[0] ?? '';
      const open = seg[lead.length] === '(' && (seg.match(/\(/g) ?? []).length > (seg.match(/\)/g) ?? []).length;
      return `${lead}${open ? '(' : ''}${ctx.M.TELEFON}`;
    });
    return `${kw}${sep}${out}`;
  };
  ctx.text = ctx.text.replace(RE_PHONE_ANCHORED, anchored);
  // (a) prefiks +48/0048 — maskujemy RAZEM z prefiksem, także z zerem „(0)" po nim („+48 (0)22 …"
  // dawniej zostawało jawne w całości, bo zero zajmowało miejsce pierwszej cyfry numeru). Nawias
  // otwierający przed prefiksem („(+48) 512 …", „(+48 22) 654 …") należy do numeru: dawniej
  // zostawał osierocony przed maską. Oddajemy go tylko wtedy, gdy numer domyka się sam
  // („dzwonić (+48 512 345 678)." → „([TELEFON])."). Strażnik przepisów liczony od „+"/„00",
  // nie od nawiasu, i pomijany przy „+": żaden numer artykułu, pozycji czy wersji nie zaczyna się
  // plusem, a „pod nr +48 22 501 23 45" wyciekało przez „nr ". „00" po „nr" zostaje pod strażnikiem
  // („Zamówienie nr 0048512345678").
  ctx.text = ctx.text.replace(
    /(?<![\d])(\([ \t]?)?((?:\+|00)[\s]?48(?:[ \t]?\(0\))?(?:[\s\-().]{0,3}\d){9})(?!\.?\d)/g,
    (m, open: string | undefined, num: string, offset: number) => {
      const o = open ?? '';
      if (!num.startsWith('+') && precededByLegalRef(ctx.text, offset + o.length)) return m;
      ctx.bump('TELEFON');
      const unbalanced = (num.match(/\)/g) ?? []).length > (num.match(/\(/g) ?? []).length;
      return (unbalanced ? '' : o) + ctx.M.TELEFON;
    },
  );
  // (c) fallback bez kontekstu — klasyczne 3-3-3, 9 cyfr ciągiem lub kierunkowy w nawiasie.
  // ŚWIADOMIE bez grupowania 2-3-2-2 bez kontekstu: „Pozycja 32 774 91 55 w wykazie" to numer
  // pozycji, nie telefon — kontekstowy fallback dałby FP (zasada: nadmaskowanie gorsze niż wyciek).
  // Stacjonarny 2-3-2-2 łapie tryb kotwicowy (b) — tam wymagana jest kotwica („tel.", „telefon
  // pacjenta:", „kontakt", „komórkę", „Phone:", „GSM", „dzwonić pod numer"; patrz PHONE_ANCHOR).
  // Separator grup to wyłącznie odstęp POZIOMY (bez tabulatora) albo myślnik: z „\s" kolumna
  // liczb „120\n340\n560" albo komórki TSV „120\t340\t560" sklejały się w jeden „telefon".
  // Strażniki kwot, identyfikatorów i etykiet nie-telefonu są w callbacku (patrz wyżej).
  ctx.text = ctx.text.replace(
    /(?<![\d.])(?:\(\d{2}\)[ \t]?\d{3}[ \t-]?\d{2}[ \t-]?\d{2}|\d{3}[    -]?\d{3}[    -]?\d{3})(?!\.?\d)/g,
    (m, offset: number) => {
      if (precededByLegalRef(ctx.text, offset) || precededByNonPhoneLabel(ctx.text, offset)) return m;
      const d = m.replace(/\D/g, '');
      // 800/801 to wyłącznie infolinie firm (bezpłatne i o współdzielonym koszcie): nie ma strefy
      // geograficznej 80 ani zakresu komórkowego zaczynającego się od 80, więc to nie numer osoby.
      if (d.startsWith('0') || /^80[01]/.test(d)) return m;
      if (gluedToIdentifier(ctx.text, offset, m.length) || looksLikeAmount(ctx.text, offset, m)) return m;
      ctx.bump('TELEFON');
      return ctx.M.TELEFON;
    },
  );
}
