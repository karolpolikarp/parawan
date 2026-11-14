// Numery dokumentów z kotwicą: dowód osobisty, paszport, KRS, prawo jazdy, tablica rejestracyjna,
// a także kod pocztowy.
import { REJ_MASK_SRC } from '../charset.js';
import { maskAfterLabel, maskKeepPrefix, type RedactCtx } from '../context.js';
import { PLATE_NOT_ACRONYM, PLATE_VOIV_LETTERS, PLATE_YEAR_ABBR, plateYearEndsList, RE_PLATE_ACRONYM_HEAD, RE_PLATE_YEAR_SHAPE } from '../guards/plates.js';
import { type PiiType } from '../types.js';
import { CURRENCY_CODES, precededByLegalRef } from '../guards/numbers.js';
import { isValidDowod } from '../validators.js';
import { institutionPostalAt } from '../guards/institution-address.js';

/** Kod waluty albo jednostki ilości na początku kandydata tablicy to kwota lub liczba sztuk. Bez RUB:
 *  „RUB” może zaczynać tablicę podkarpacką, więc taki kandydat idzie dalej do strażników tablicy. */
const RE_PLATE_CURRENCY_HEAD = new RegExp(
  `^(?:${[...CURRENCY_CODES].filter((c) => c !== 'RUB').join('|')}|SZT|KPL|KOM)(?![A-Z])`,
);
/** Jednostka zaraz po kandydacie („DMC 3500 kg", „150 KM") oznacza parametr. Tylko odstęp poziomy:
 *  jednostka z następnego wiersza nie odbiera maski. „KM Policji/PSP" to komenda, „t.j." skrót. */
const PLATE_NOT_UNIT =
  '(?![ \\t]*(?:kg|t(?!\\.[a-ząćęłńóśźż])|ton\\w*|km|kW|KM(?![ \\t]+(?:Policji|PSP))|mm|cm[3³]?|ccm|zł|PLN|szt)(?![\\wąćęłńóśźż]))';

/** „dokument serii XX nr N": seria musi być wersalikami, flaga „i" służy tylko kotwicy
 *  („DOWÓD OSOBISTY SERIA"). Maska obejmuje serię i numer, „serii" zostaje. */
function maskSeriesNumber(ctx: RedactCtx, re: RegExp, type: PiiType): void {
  ctx.text = ctx.text.replace(re, (m, pre: string, series: string) => {
    if (!/^[A-Z]+$/.test(series)) return m;
    return `${pre}${ctx.hit(type)}`;
  });
}

// Dowód osobisty: 3 litery + 6 cyfr.
export function passIdCard(ctx: RedactCtx): void {
  if (!ctx.on('DOWOD')) return;
  // Seria i numer rozdzielone „nr" albo przecinkiem, jak w aktach notarialnych („dowodem osobistym
  // serii ABA nr 300000"). Osobny przebieg, bo wstawka „nr" w ogólnym wzorcu łapałaby słowa
  // („dowód osobisty wydany pod nr 123456"). Kotwica wymaga „seri…" tuż za dokumentem tożsamości.
  maskSeriesNumber(
    ctx,
    /\b((?:dow[oó]d\w*|legitymacj\w*|dokument\w*\s+tożsamości)(?:\s+(?:osobist\w+|służbow\w+))?\s+seri[aiięą][ \t]+)([A-Za-z]{3}),?[ \t]*(?:(?:nr\.?|numer)[ \t]*)?(\d{6})(?!\d)/gi,
    'DOWOD',
  );
  // Z kontekstem maskujemy nawet przy złej sumie kontrolnej; łączniki także w odmianie
  // („dowodem osobistym serii ABA 123456").
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|dow\.|legitymacj\w*|dokument\w*\s+tożsamości|seria i numer|nr dowodu)(?:\s+(?:osobist\w+|służbow\w+|nr\.?|numer(?:ze|em|u)?|seri[aiięą]|o|i))*[\s:.=-]*)([A-Za-z]{3}[\s-]?\d{6})(?!\d)/gi,
    maskKeepPrefix(ctx, 'DOWOD'),
  );
  // Bez kontekstu tylko z poprawną sumą. Kody walut wyłączone: „PLN 123456" przechodzi sumę co
  // dziesiąty raz, a to kwota.
  ctx.text = ctx.text.replace(/\b([A-Za-z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
    if (CURRENCY_CODES.has(letters.toUpperCase())) return m;
    if (!isValidDowod(m)) return m;
    return ctx.hit('DOWOD');
  });
}

// Paszport: 2 litery + 7 cyfr, tylko z kontekstem.
export function passPassport(ctx: RedactCtx): void {
  if (!ctx.on('PASZPORT')) return;
  maskSeriesNumber(
    ctx,
    /\b((?:paszport\w*|dokument\w*\s+podróży)\s+seri[aiięą][ \t]+)([A-Za-z]{2}),?[ \t]*(?:(?:nr\.?|numer)[ \t]*)?(\d{7})(?!\d)/gi,
    'PASZPORT',
  );
  maskAfterLabel(
    ctx,
    /\b((?:paszport\w*|dokument\w*\s+podróży|nr\s+paszportu|numer\s+paszportu)(?:\s+(?:nr\.?|numer(?:ze|em|u)?|seri[aiięą]|o|i))*)([\s:.=-]*)([A-Za-z]{2}[\s-]?\d{7})(?!\d)/gi,
    'PASZPORT',
  );
}

// KRS: 10 cyfr, tylko z etykietą, bo numer nie ma publicznej sumy kontrolnej. Etykieta wraca
// w oryginalnym zapisie („krs:"), bo regex ma flagę „i".
export function passKrs(ctx: RedactCtx): void {
  if (!ctx.on('KRS')) return;
  maskAfterLabel(ctx, /\b(KRS)((?:\s+(?:pod\s+)?(?:nr\.?|numer(?:em)?))?[\s:.=-]*)(\d{10})(?!\d)/gi, 'KRS');
}

// Prawo jazdy: tylko z kontekstem, numer w całości razem z separatorami „/" i „-".
export function passDriverLicense(ctx: RedactCtx): void {
  if (!ctx.on('PRAWO-JAZDY')) return;
  ctx.text = ctx.text.replace(
    /\b((?:(?:nr|numer)\s+)?praw(?:o|a|em|ie)\s+jazdy(?:\s+(?:nr\.?|numer(?:u|ze|em)?|seri[ai]|kat\.?|kategori[ai]|o|[ABCDEMT]{1,2}\d?))*[\s:=.-]*)((?=[A-Za-z0-9/-]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3})/gi,
    maskKeepPrefix(ctx, 'PRAWO-JAZDY'),
  );
}

// Tablica rejestracyjna: po kotwicy „nr rej."/„tablica", po kotwicy pojazdowej i w wyliczeniu.
//
// Kotwica pojazdowa obsługuje wyliczenia pojazdów bez słowa „rejestracyjny". Po słowie kotwicy nie
// może stać litera („AutoCAD 2024" to program). Kandydat nie ciągnie się przez „-cyfra"/„/cyfra"
// (norma „EN 12195-1", akt „WE 1234/2009"), ale „-litera" wolno, żeby zestaw
// „WGM1234A/WGM5678B" nie wyciekł.
// Po „marki <Marka>" do dwóch członów modelu w tej samej linii („samochodem marki Toyota Yaris WE
// 12345"). Człon modelu to wyraz z małą literą w środku albo token z cyfrą; same wersaliki bez cyfry
// („PN", „ISO") nie są modelem, a ujemny lookahead nie pozwala zjeść samej tablicy. „typu" bierze
// tylko jeden wyraz: „pojazdy typu Euro VI PN 2020" to norma.
const PLATE_MODEL_PART = String.raw`[ \t]+(?![A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4}\b)(?:[A-ZĄĆĘŁŃÓŚŹŻ](?=[\w-]*[a-ząćęłńóśźż])[\w-]*|(?=[\w-]*\d)[A-Z0-9][\w-]*)`;
// Rdzeń kotwicy z polską końcówką („pojazdów", „przyczepą"), bo „\w" nie obejmuje „ó" ani „ą".
const RE_PLATE_VEHICLE = new RegExp(
  String.raw`\b([Pp]ojazd[a-ząćęłńóśźż]*|[Ss]amoch[oó]d[a-ząćęłńóśźż]*|[Mm]otocykl[a-ząćęłńóśźż]*|[Mm]otorower[a-ząćęłńóśźż]*|[Cc]iągnik[a-ząćęłńóśźż]*|[Pp]rzyczep[a-ząćęłńóśźż]*|[Nn]aczep[a-ząćęłńóśźż]*|[Aa]ut(?:o|a|em|u|om|ami|ach)|[Pp]arking\w*|[Zz]aparkowan\w*)(?![A-Za-ząćęłńóśźż])((?:\s+(?:o|nr\.?|numerze|siodłow\w+|ciężarow\w+|osobow\w+|dostawcz\w+|specjaln\w+|wolnobieżn\w+))*(?:\s+(?:marki\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?:${PLATE_MODEL_PART}){0,2}|typu\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*)(?=[\s:=.-]))?(?:\s+[a-ząćęłńóśźż]{1,15}){0,3}[\s:=.-]*)(${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4})\b(?![/-]\d)${PLATE_NOT_UNIT}`,
  'g',
);
const RE_PLATE_AFTER_MODEL = new RegExp(`(?:^|\\s)marki\\s+[A-ZĄĆĘŁŃÓŚŹŻ][\\w-]*${PLATE_MODEL_PART}`);
const PLATE_ITEM = `${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\\s-]?\\d[A-Z0-9]{3,4}`;
// Skan ogona wyliczenia startuje tylko na początku tokenu, nie w środku odrzuconego skrótu.
const RE_PLATE_ITEM_SCAN = new RegExp(`(?<![A-Z])${PLATE_ITEM}`, 'g');
// Trzyliterowe marki pojazdów, które z rocznikiem udają tablicę („KIA 2019", „DAF 2018").
const PLATE_VEHICLE_BRANDS = new Set<string>('KIA DAF SAM MAN BMW FSO FSM GAZ UAZ MAZ ZIL JCB FAW BYD DFM KTM SAF BPW'.split(' '));
// Kody typu pojazdu i nadwozia (straż, transport, rolnictwo): z rocznikiem to opis floty.
const PLATE_VEHICLE_TYPE_CODES = new Set<string>('GBA GCB SLR SLB SUV TIR BUS VAN ATV UTV TPV MPV SCD GLM GLB SRT'.split(' '));
const RE_PLATE_GAP_PREP = /^(?:w|we|do|z|ze|od|na|dla|po|przez|przy|o|u|według|wg|wobec|między|pod|nad|za)$/;
// Kod silnika lub wersji z pojemnością („Golf TDI 1896", „Agrotron TTV 1130") ma kształt powiatu
// z czterema cyframi, ale opisuje pojazd. Wśród nich tylko GTC jest wyróżnikiem (Tczew), który za
// modelem i tak częściej oznacza wersję („Astra GTC").
const RE_PLATE_ENGINE_CODE =
  /^(?:TDI|TSI|FSI|TFS|TCE|TDS|TDE|CDI|CRD|DCI|DTI|DID|HDI|HTP|GTI|GTD|GTE|GTS|GTC|GTR|GDI|CGI|TGI|SDI|ECO|EDC|EVO|TTV|TCI|CVT|DSG|STI|LPG|CNG|ETS)[\s-]?\d{4}$/;
const PLATE_WEEKDAYS = 'pon|wt|śr|czw|pt|sob|nd|ndz';
/** Krótkie wyrazy prozy w kształcie wyróżnika małymi literami („to", „do", „od 2025"). */
const RE_PLATE_SHORT_PL_WORD = new RegExp(
  `^(?:to|od|do|po|za|ze|we|na|co|ok|ta|te|ty|go|ja|mu|mi|ci|tu|np|tj|ma|są|by|aż|że|ani|lub|dla|nad|pod|bez|się|nie|tak|już|też|jak|ten|tym|tej|był|jej|ich|nam|was|${PLATE_WEEKDAYS})$`,
);
const RE_PLATE_WEEKDAY = new RegExp(`^(?:${PLATE_WEEKDAYS})$`, 'i');
const RE_PLATE_VEHICLE_ADJ = /^(?:siodłow|ciężarow|osobow|dostawcz|specjaln|wolnobieżn)\p{Ll}*$/u;
// Rzeczownik pojazdu przed kotwicą „numer rejestracji" („Pojazd o numerze rejestracji …").
const RE_PLATE_VEHICLE_BEFORE = /(?<!\p{L})(?:pojazd|samoch[oó]d|aut[aoy]?(?!\p{L})|motocykl|ciągnik|naczep|przyczep)/iu;

export function passPlate(ctx: RedactCtx): void {
  if (!ctx.on('NR-REJESTRACYJNY')) return;
  // Wypełniacze po kotwicy {0,3}, bo przy „*" powtórzone „rejestracyjny rejestracyjny …" dawało
  // czas kwadratowy. Kropka po „nr." i odmienione „numer…" tylko ze skrótem „rej"/„rejestr"/
  // „rejestracyjn…": „nr. rejestru ABC 1234/2020", „numerze rejsu LO 3925" to nie tablica.
  // Separator „|" komórki tabeli tylko w tej samej linii, inaczej kotwica z nagłówka kolumny
  // przeskakuje do kolejnego wiersza. Druga gałąź wartości to układ „WPI KC27" (litera na początku
  // numeru), którego lookahead cyfry w pierwszych 6 znakach nie widzi.
  ctx.text = ctx.text.replace(
    /\b((?:nr\s+rej\w*|nr\.\s*rej(?:estracyjn\w*|estr)?\b|numer\s+rej\w*|numer\w+\s+rej(?:estracyjn\w*|estracj\w*|estr)?\b|rejestracyjn\w*|tablic\w*)(?:(?:\.\s*|\s+)(?:nr\.?|numer\w*|pojazdu|poj\.|sam\.|rej\w*|o|pod|to|sprawcy|kierowcy|właściciela|poszkodowanego|samoch[oó]d\w*|naczep\w*|przyczep\w*|ciągnik\w*|motocykl\w*|motorower\w*|aut[aoy]?\b|autobus\w*|autokar\w*|bus[aeuy]?\b|ci[eę][zż]ar[oó]w\w*|osobow\w*|dostawcz\w*|siodłow\w*)){0,3}(?:[ \t:=.-]*\|[ \t]*|[\s:=.-]*))((?=[A-Z0-9\s-]{0,5}\d)[A-Z]{2,3}[\s-]?[A-Z0-9]{4,5}|[A-Z]{3}[\s-][A-Z]{2}\d{2})\b/gi,
    (m, pre: string, plate: string, offset: number, str: string) => {
      // „pod numerem rejestracji RPW 12345/2026" to znak kancelaryjny pisma (EZD): po „rejestracj…"
      // wyróżnik z samymi cyframi i ogonem „/rok". Pojazd tuż przed kotwicą rozstrzyga za tablicą.
      if (
        /rejestracj/i.test(pre) &&
        /^[A-Z]{2,3}[\s-]?\d{4,5}$/i.test(plate) &&
        /^[ \t]*\/[ \t]*\d/.test(str.slice(offset + m.length, offset + m.length + 4)) &&
        !RE_PLATE_VEHICLE_BEFORE.test(str.slice(Math.max(0, offset - 30), offset) + pre)
      )
        return m;
      const hasRej = /rej/i.test(pre);
      const voiv = PLATE_VOIV_LETTERS.includes(plate[0].toUpperCase());
      const upperHead = /^[A-Z]{2,3}(?![a-z])/.test(plate);
      // Flaga „i" służy kotwicy, ale obejmuje też wyróżnik. Po słabych kotwicach „tablic…"
      // i „rejestracyjn…" wyróżnik małymi literami przyjmujemy tylko sklejony („tablica wa12345"),
      // bo „od 2025" to proza. Po „nr rej." stoi wartość pola, więc „nr rej. wa 12345" to tablica.
      const strong = /^(?:nr\.?\s*|numer\p{L}*\s+)rej(?:estracyjn\p{L}*|estr)?(?!\p{L})/iu.test(pre);
      // Krótki wyraz prozy („tablice rejestracyjne to 12345 sztuk") nie jest wyróżnikiem, chyba że
      // stoi przed pięcioma cyframi od wielkiej litery albo jako skrót dnia: przyimek w zdaniu pisze
      // się małą literą, rok ma cztery cyfry, więc „Po 12345" to Poznań, a „PT" to Turek.
      const head = plate.split(/[\s-]/)[0];
      const proseWord =
        RE_PLATE_SHORT_PL_WORD.test(head.toLowerCase()) &&
        !((RE_PLATE_WEEKDAY.test(head) || /^[A-Z]/.test(plate)) && /\d{5}$/.test(plate));
      // Po „rejestracyjn…" wolno też małe litery ze spacją, gdy wyróżnik ma literę województwa
      // („tablice rejestracyjne wa 12345").
      const lowerSpacedOk =
        /rejestracyjn/i.test(pre) && /^[A-Za-z][a-z]{1,2}[\s-]\d{4,5}$/.test(plate) && voiv && !proseWord;
      // „nr" nigdy nie jest wyróżnikiem („Tablica nr 12345 wisi przy wejściu").
      if (/^nr\b/i.test(plate) || (!strong && !lowerSpacedOk && !upperHead && /[\s-]/.test(plate))) return m;
      // Sama „tablica" bywa ostrzegawcza („Na tablicy UN 1203"), tam skrót techniczny nie jest
      // wyróżnikiem. Przy „nr rej." kotwica wygrywa.
      if (!hasRej && !RE_PLATE_ACRONYM_HEAD.test(plate)) return m;
      // Układ „WPI KC27" tylko wersalikami, z literą województwa i po kotwicy z „rej".
      if (/^[A-Za-z]{3}[\s-][A-Za-z]{2}\d{2}$/.test(plate) && !(/^[A-Z]{3}[\s-][A-Z]{2}\d{2}$/.test(plate) && voiv && hasRej)) return m;
      // Łącznik „o/to/pod" po samej „tablicy" („Tablica o numerze INW 12345") jest słabszy niż
      // etykieta pola, więc wyróżnik musi wyglądać na tablicę. Skrót z rokiem („na tablicy o PIT
      // 2024") to temat ogłoszenia.
      if (!hasRej && /(?<!\p{L})(?:o|to|pod)(?!\p{L})/iu.test(pre) && (!(upperHead && voiv) || RE_PLATE_YEAR_SHAPE.test(plate))) return m;
      return `${pre}${ctx.hit('NR-REJESTRACYJNY')}`;
    },
  );
  ctx.text = ctx.text.replace(RE_PLATE_VEHICLE, (m, kw: string, sep: string, plate: string, offset: number, str: string) => {
    if (!PLATE_VOIV_LETTERS.includes(plate[0])) return m;
    // Za członem modelu skrót z czterema cyframi opisuje pojazd: rok („Opel Astra GTC 2015") albo
    // pojemność w pełnych setkach („Skoda Octavia TSI 1400"). Dwie litery z czterema cyframi to
    // w ogóle nie polska tablica („Suzuki V-Strom DL 1000"), a „Ford Transit WPI 1234" zostaje
    // tablicą. Kod silnika z dowolną pojemnością odpada już po samej „marki".
    if (/^(?:[A-Z]{2}[\s-]?\d{4}|[A-Z]{3}[\s-]?(?:\d{2}00|(?:19|20)\d{2}))$/.test(plate) && RE_PLATE_AFTER_MODEL.test(sep)) return m;
    if (RE_PLATE_ENGINE_CODE.test(plate) && /(?:^|\s)marki\s/.test(sep)) return m;
    // Dwie litery z rokiem po kotwicy w liczbie mnogiej, po „dla/według", przed „r." albo przy akcie
    // prawnym („dla pojazdów PN 2020") to norma albo rocznik. Liczba pojedyncza bez takiego kontekstu
    // („Sprawca uciekł samochodem WA 2015") wskazuje konkretny pojazd.
    if (
      /^[A-Z]{2}[\s-]?(?:19|20)\d{2}$/.test(plate) &&
      (/(?:ów|y|ami|ach|om)$/.test(kw) ||
        /(?<!\p{L})(?:dla|według|wg)(?!\p{L})/iu.test(sep) ||
        /^[ \t]*(?:r\.|rok|roku)/.test(str.slice(offset + m.length, offset + m.length + 7)) ||
        /^(?:PN|EN|UE|EU|OC|AC|NW|ISO|IS)/.test(plate) ||
        /(?<!\p{L})(?:dyrektyw|rozporządze|norm|homologacj)\p{L}*/iu.test(str.slice(Math.max(0, offset - 40), offset) + kw))
    )
      return m;
    // Kod waluty albo jednostki z kwotą („Wartość samochodów wynosi PLN 45000").
    if (RE_PLATE_CURRENCY_HEAD.test(plate)) return m;
    // Trzy litery z rokiem: marka z rocznikiem, skrót instytucji, kod silnika, paliwa albo typu
    // pojazdu, rok z „r." za nim, a po dopełniaczu mnogim bez dwukropka proza przetargu („pojazdów
    // marki MAN TGL 2012"). Wykaz z dwukropkiem i liczba pojedyncza („autem WPI 2019") to tablica.
    if (RE_PLATE_YEAR_SHAPE.test(plate) && /^[A-Z]{3}/.test(plate)) {
      if (PLATE_VEHICLE_BRANDS.has(plate.slice(0, 3))) return m;
      if (PLATE_YEAR_ABBR.has(plate.slice(0, 3)) || RE_PLATE_ENGINE_CODE.test(plate) || PLATE_VEHICLE_TYPE_CODES.has(plate.slice(0, 3))) return m;
      if (/^[ \t]*(?:r\.|rok)/.test(str.slice(offset + m.length, offset + m.length + 6))) return m;
      if (/(?:ów|^[Aa]ut|[Pp]rzyczep|[Nn]aczep)$/.test(kw) && !sep.includes(':')) return m;
    }
    // Wtrącenie zakończone przyimkiem („Liczba pojazdów według GUS 2023", „Autem do PZU 2020")
    // wskazuje źródło albo instytucję, a skrót z rokiem po kilku wyrazach („z silnikiem TDI 2000")
    // to opis. Przymiotnik typu pojazdu („samochodem ciężarowym KRA 2015") nie jest wtrąceniem.
    const gap = /(?:^|\s)([a-ząćęłńóśźż]{1,15})[\s:=.-]*$/.exec(sep)?.[1];
    if (gap && RE_PLATE_GAP_PREP.test(gap)) return m;
    if (gap && RE_PLATE_YEAR_SHAPE.test(plate) && !RE_PLATE_VEHICLE_ADJ.test(gap)) return m;
    return `${kw}${sep}${ctx.hit('NR-REJESTRACYJNY')}`;
  });
  maskPlateEnumeration(ctx);
}

// Kolejne człony listy po zamaskowanej tablicy dziedziczą kotwicę pierwszego. Listę kończy człon
// z jednostką, skrót techniczny, numer aktu z ukośnikiem („, UE 2016/679") i skrót z rokiem
// („; SN 2020 r. orzekł"); trzyliterowy powiat z rokiem jest jednak tablicą (plateYearEndsList).
// Średnik i ukośnik tylko z odstępami poziomymi, żeby lista nie sięgała do kolejnego akapitu.
const RE_PLATE_ENUM = new RegExp(
  `(${REJ_MASK_SRC})((?:(?:\\s*,\\s*|[ \\t]*[;/][ \\t]*|\\s+oraz\\s+|\\s+i\\s+)${PLATE_ITEM}(?![\\w-]|/\\d)${PLATE_NOT_UNIT})+)`,
  'g',
);
function maskPlateEnumeration(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(
    RE_PLATE_ENUM,
    (_m, first: string, tail: string) => {
      let ended = false;
      const maskedTail = tail.replace(RE_PLATE_ITEM_SCAN, (p) => {
        if (ended || plateYearEndsList(p)) {
          ended = true;
          return p;
        }
        if (!PLATE_VOIV_LETTERS.includes(p[0])) return p;
        return ctx.hit('NR-REJESTRACYJNY');
      });
      return `${first}${maskedTail}`;
    },
  );
}

// Kod pocztowy XX-XXX, nie po „art./§" i nie przed walutą czy jednostką: „10-200 PLN", „30-500 osób"
// to zakres liczb. Celowo bez samego „m", bo „00-950 m. st. Warszawa" to kod przed nazwą miasta.
const RE_POSTAL = /(?<![\d-])\d{2}-\d{3}(?![\d-])(?![ \t]*(?:zł|zl|PLN|EUR|USD|GBP|CHF|gr|tys|mln|%|km|kg|min|godz|szt|sztuk|osób|osoby|dni|lat)(?![\p{L}]))/gu;
export function passPostal(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  ctx.text = ctx.text.replace(RE_POSTAL, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    // Kod pod ulicą siedziby instytucji zostaje razem z jej adresem.
    if (institutionPostalAt(ctx.text, offset, ctx.personProbe)) return m;
    return ctx.hit('KOD-POCZTOWY');
  });
}
