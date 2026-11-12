import { escapeRe } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { CURRENCY_CODES } from '../guards/eponyms.js';
import { isValidDowod, precededByLegalRef } from '../validators.js';


/** Pierwsze litery wyróżników wojewódzkich tablic rejestracyjnych (+ H/U — służby/wojsko).
 *  Walidują CZŁONY WYLICZENIA i tablice po kotwicy z przerwą („ISO 9001" ≠ tablica). */
export const PLATE_VOIV_LETTERS = 'BCDEFGHKLNOPRSTUWZ';
/** Skróty, które zaczynają się od litery wojewódzkiej, ale nie są wyróżnikiem tablicy: marki
 *  i oznaczenia modeli (BMW, KTM, RAM, FSO), parametry pojazdu (DMC/DMR), normy i katalogi
 *  (EN, DIN, RAL, DOT), kod PKD i numer UN materiału niebezpiecznego (zawsze 4 cyfry — wojskowe
 *  „U…" mają ich 5). „PN" celowo NIE: to Konin. Wstawiany na początku kandydata tablicy. */
const PLATE_NOT_ACRONYM = '(?!(?:BMW|DMC|DMR|RAL|DIN|DOT|EN|PKD|KTM|RAM|FSO)(?![A-Z])|UN[\\s-]?\\d{4}(?![\\dA-Z]))';
/** Jednostka zaraz po kandydacie („DMC 3500 kg", „ładowność 24 t", „150 KM") — to parametr,
 *  nie tablica. Tylko odstęp poziomy: jednostka z następnego wiersza nie odbiera maski.
 *  „KM Policji/PSP" to komenda miejska, a „t.j." skrót „to jest" — po nich tablica zostaje. */
const PLATE_NOT_UNIT =
  '(?![ \\t]*(?:kg|t(?!\\.[a-ząćęłńóśźż])|ton\\w*|km|kW|KM(?![ \\t]+(?:Policji|PSP))|mm|cm[3³]?|ccm|zł|PLN|szt)(?![\\wąćęłńóśźż]))';

// 9) NR DOWODU osobistego — 3 litery + 6 cyfr. Trzy tryby (kontekst / dokładny format / mieszane).
export function passIdCard(ctx: RedactCtx): void {
  if (!ctx.on('DOWOD')) return;
  // (a0) „dowodem osobistym serii ABA nr 300000" — seria i numer rozdzielone słowem „nr"/„numer"
  // albo przecinkiem (tak piszą akty notarialne i protokoły). Maska obejmuje całe „ABA nr 300000",
  // „serii" zostaje jak „seria i numer:". Osobny przebieg, bo w ogólnym (a) wstawka „nr" między
  // literami a cyframi zjadłaby słowa („dowód osobisty wydany pod nr 123456"). Kotwica tylko
  // dokumentu tożsamości z „seri…" tuż za nim („dowód rejestracyjny seria DRB nr …", „akcje serii
  // ABA nr …" odpadają), a seria WIELKIMI literami — flaga „i" jest dla kotwicy („DOWÓD OSOBISTY SERIA").
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|legitymacj\w*|dokument\w*\s+tożsamości)(?:\s+(?:osobist\w+|służbow\w+))?\s+seri[aiięą][ \t]+)([A-Za-z]{3}),?[ \t]*(?:(?:nr\.?|numer)[ \t]*)?(\d{6})(?!\d)/gi,
    (m, pre: string, series: string) => {
      if (!/^[A-Z]{3}$/.test(series)) return m;
      ctx.bump('DOWOD');
      return `${pre}${ctx.M.DOWOD}`;
    },
  );
  // (a) Z KONTEKSTEM — maskujemy nawet BEZ poprawnej sumy kontrolnej. Łączniki w odmianie
  // („serii", „o numerze", „numerem"): dawniej znany był tylko mianownik, a „dowodem osobistym
  // serii ABA 123456" ze złą sumą wyciekał mimo mocnej kotwicy.
  ctx.text = ctx.text.replace(
    /\b((?:dow[oó]d\w*|dow\.|legitymacj\w*|dokument\w*\s+tożsamości|seria i numer|nr dowodu)(?:\s+(?:osobist\w+|służbow\w+|nr\.?|numer(?:ze|em|u)?|seri[aiięą]|o|i))*[\s:.=-]*)([A-Za-z]{3}[\s-]?\d{6})(?!\d)/gi,
    (_m, pre: string, _num: string) => {
      ctx.bump('DOWOD');
      return `${pre}${ctx.M.DOWOD}`;
    },
  );
  // (b) BEZ kontekstu — 3 WIELKIE litery + 6 cyfr, z poprawną sumą (kody walut wyłączone).
  ctx.text = ctx.text.replace(/\b([A-Z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
    if (CURRENCY_CODES.has(letters)) return m;
    if (!isValidDowod(m)) return m;
    ctx.bump('DOWOD');
    return ctx.M.DOWOD;
  });
  // (c) Litery mieszane/małe — tylko gdy suma kontrolna się zgadza. Kody walut wykluczone jak
  // w (b): „PLN 123456" przechodzi sumę (co dziesiąta kwota), a to kwota, nie numer dowodu.
  ctx.text = ctx.text.replace(/\b([A-Za-z]{3})[\s-]?\d{6}\b/g, (m, letters: string) => {
    if (CURRENCY_CODES.has(letters.toUpperCase())) return m;
    if (isValidDowod(m)) {
      ctx.bump('DOWOD');
      return ctx.M.DOWOD;
    }
    return m;
  });
}

// 9b) NR PASZPORTU — 2 litery + 7 cyfr. TYLKO z kontekstem („paszport"/„dokument podróży").
export function passPassport(ctx: RedactCtx): void {
  if (!ctx.on('PASZPORT')) return;
  // „paszportem serii EA nr 1234567" — jak (a0) w passIdCard: seria WIELKIMI literami, maska na
  // całe „EA nr 1234567".
  ctx.text = ctx.text.replace(
    /\b((?:paszport\w*|dokument\w*\s+podróży)\s+seri[aiięą][ \t]+)([A-Za-z]{2}),?[ \t]*(?:(?:nr\.?|numer)[ \t]*)?(\d{7})(?!\d)/gi,
    (m, pre: string, series: string) => {
      if (!/^[A-Z]{2}$/.test(series)) return m;
      ctx.bump('PASZPORT');
      return `${pre}${ctx.M.PASZPORT}`;
    },
  );
  ctx.text = ctx.text.replace(
    /\b((?:paszport\w*|dokument\w*\s+podróży|nr\s+paszportu|numer\s+paszportu)(?:\s+(?:nr\.?|numer(?:ze|em|u)?|seri[aiięą]|o|i))*)([\s:.=-]*)([A-Za-z]{2}[\s-]?\d{7})(?!\d)/gi,
    (_m, pre: string, sep: string) => {
      ctx.bump('PASZPORT');
      return `${pre}${sep}${ctx.M.PASZPORT}`;
    },
  );
}

// 9c) NUMER KRS — 10 cyfr. TYLKO z kontekstem „KRS" (brak publicznej sumy kontrolnej).
// Etykietę oddajemy w oryginalnym zapisie: regex jest bez względu na wielkość liter, a stały
// literał „KRS" przepisywał „krs:"/„Krs=" na wersaliki (zmiana tekstu poza maską).
export function passKrs(ctx: RedactCtx): void {
  if (!ctx.on('KRS')) return;
  ctx.text = ctx.text.replace(
    /\b(KRS)((?:\s+(?:pod\s+)?(?:nr\.?|numer(?:em)?))?[\s:.=-]*)(\d{10})(?!\d)/gi,
    (_m, label: string, sep: string) => {
      ctx.bump('KRS');
      return `${label}${sep}${ctx.M.KRS}`;
    },
  );
}

// 9d) PRAWO JAZDY — TYLKO z kontekstem. Numer maskujemy W CAŁOŚCI (z separatorami „/"/„-").
export function passDriverLicense(ctx: RedactCtx): void {
  if (!ctx.on('PRAWO-JAZDY')) return;
  ctx.text = ctx.text.replace(
    /\b((?:(?:nr|numer)\s+)?praw(?:o|a|em|ie)\s+jazdy(?:\s+(?:nr\.?|numer(?:u|ze|em)?|seri[ai]|kat\.?|kategori[ai]|o|[ABCDEMT]{1,2}\d?))*[\s:=.-]*)((?=[A-Za-z0-9/-]*\d)[A-Za-z0-9]{4,15}(?:[/-][A-Za-z0-9]{1,6}){0,3})/gi,
    (_m, pre: string) => {
      ctx.bump('PRAWO-JAZDY');
      return `${pre}${ctx.M['PRAWO-JAZDY']}`;
    },
  );
}

// 9e) NR REJESTRACYJNY (tablica) — z kontekstem oraz z kotwicą pojazdową i wyliczeniem.
// Kotwica POJAZDOWA — wyliczenia pojazdów bez słowa „rejestracyjny". Po słowie kotwicy nie może
// stać litera: „AutoCAD 2024" to program, nie „Auto" + tablica „CAD 2024". Kandydat nie może
// ciągnąć się dalej przez „-cyfra"/„/cyfra" (norma „EN 12195-1", akt „WE 1234/2009") — ale
// „-litera" wolno, inaczej zestaw „WGM1234A/WGM5678B" wyciekłby w całości.
// Po „marki <Marka>" do dwóch członów modelu w tej samej linii („samochodem marki Toyota Yaris
// WE 12345", „marki Audi A4 Avant …"): dawniej model przerywał kotwicę i tablica wyciekała. Człon
// modelu to wyraz z wielkiej litery z małą literą w środku albo token z cyfrą; same WERSALIKI bez
// cyfry („PN", „EURO", „ISO") nie są modelem, a ujemne lookahead nie pozwala zjeść samej tablicy.
// „typu" zostaje z jednym wyrazem — „pojazdy typu Euro VI PN 2020" to norma, nie tablica.
const PLATE_MODEL_PART = String.raw`[ \t]+(?![A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4}\b)(?:[A-ZĄĆĘŁŃÓŚŹŻ](?=[\w-]*[a-ząćęłńóśźż])[\w-]*|(?=[\w-]*\d)[A-Z0-9][\w-]*)`;
// Rdzeń kotwicy z polską końcówką („pojazdów", „samochodów", „przyczepą", „autem", „auta"):
// dawniej „\w*" (tylko ASCII) zatrzymywało się na „ó" albo „ą" i wyliczenie „Wykaz pojazdów: WE
// 12345, GD 2345A" zostawało jawne.
const RE_PLATE_VEHICLE = new RegExp(
  String.raw`\b([Pp]ojazd[a-ząćęłńóśźż]*|[Ss]amoch[oó]d[a-ząćęłńóśźż]*|[Mm]otocykl[a-ząćęłńóśźż]*|[Mm]otorower[a-ząćęłńóśźż]*|[Cc]iągnik[a-ząćęłńóśźż]*|[Pp]rzyczep[a-ząćęłńóśźż]*|[Nn]aczep[a-ząćęłńóśźż]*|[Aa]ut(?:o|a|em|u|om|ami|ach)|[Pp]arking\w*|[Zz]aparkowan\w*)(?![A-Za-ząćęłńóśźż])((?:\s+(?:o|nr\.?|numerze|siodłow\w+|ciężarow\w+|osobow\w+|dostawcz\w+|specjaln\w+|wolnobieżn\w+))*(?:\s+(?:marki\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*(?:${PLATE_MODEL_PART}){0,2}|typu\s+[A-ZĄĆĘŁŃÓŚŹŻ][\w-]*)(?=[\s:=.-]))?(?:\s+[a-ząćęłńóśźż]{1,15}){0,3}[\s:=.-]*)(${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\s-]?\d[A-Z0-9]{3,4})\b(?![/-]\d)${PLATE_NOT_UNIT}`,
  'g',
);
const RE_PLATE_AFTER_MODEL = new RegExp(`(?:^|\\s)marki\\s+[A-ZĄĆĘŁŃÓŚŹŻ][\\w-]*${PLATE_MODEL_PART}`);
const PLATE_ITEM = `${PLATE_NOT_ACRONYM}[A-Z]{2,3}[\\s-]?\\d[A-Z0-9]{3,4}`;
// Skan ogona wyliczenia startuje tylko na początku tokenu — nie w środku odrzuconego skrótu.
const RE_PLATE_ITEM_SCAN = new RegExp(`(?<![A-Z])${PLATE_ITEM}`, 'g');
export const RE_PLATE_ACRONYM_HEAD = new RegExp(`^${PLATE_NOT_ACRONYM}`);
// Skrót z rokiem („PIT 2024", „OC 2024", „SN 2020") — kształt tablicy, ale w prozie to temat albo sygnatura.
const RE_PLATE_YEAR_SHAPE = /^[A-Z]{2,3}[\s-]?(?:19|20)\d{2}$/;
// Marki pojazdów o trzech literach, które z rocznikiem udają tablicę („KIA 2019", „DAF 2018").
const PLATE_VEHICLE_BRANDS = new Set<string>('KIA DAF SAM MAN BMW FSO FSM GAZ UAZ MAZ ZIL JCB FAW BYD DFM KTM SAF BPW'.split(' '));
// Kody typu pojazdu i nadwozia (straż pożarna, transport, rolnictwo) — z rocznikiem to opis floty.
const PLATE_VEHICLE_TYPE_CODES = new Set<string>('GBA GCB SLR SLB SUV TIR BUS VAN ATV UTV TPV MPV SCD GLM GLB SRT'.split(' '));
const RE_PLATE_GAP_PREP =/^(?:w|we|do|z|ze|od|na|dla|po|przez|przy|o|u|według|wg|wobec|między|pod|nad|za)$/;
// Trzyliterowe skróty, które z rokiem są tematem, polisą czy programem, a nie tablicą („/ PZU 2024",
// „; RPO 2021"). Inny powiat trzyliterowy z rokiem to zwykła tablica („nr rej. WPI 12345, WPI 2019").
const PLATE_YEAR_ABBR = new Set<string>(
  'PIT CIT VAT RPO WPF KPO ZUS KRS NIP PZU SKO PKD ISO LGD WSA NSA KIO UZP GUS NFZ BIP EFS PFR PUP WUP OSP ZHP PKP PKS'.split(' '),
);
/** Czy człon wyliczenia to skrót z rokiem, który kończy listę tablic? Dwie litery z czterema cyframi
 *  to w ogóle nie polska tablica („OC 2024", „SN 2020"); trzy — tylko skrót z PLATE_YEAR_ABBR. */
export const plateYearEndsList = (p: string): boolean =>
  RE_PLATE_YEAR_SHAPE.test(p) && (/^[A-Z]{2}(?![A-Z])/.test(p) || PLATE_YEAR_ABBR.has(p.slice(0, 3)));
// Kod silnika lub wersji za marką z pojemnością w cm³ („Golf TDI 1896", „Clio DCI 1461", „Boxer HDI
// 2198", „Agrotron TTV 1130") — kształt powiatu z czterema cyframi, ale to opis pojazdu. Żaden
// z tych skrótów nie jest wyróżnikiem polskiej tablicy, poza GTC (Tczew), który za modelem i tak
// częściej jest wersją („Astra GTC").
const RE_PLATE_ENGINE_CODE =
  /^(?:TDI|TSI|FSI|TFS|TCE|TDS|TDE|CDI|CRD|DCI|DTI|DID|HDI|HTP|GTI|GTD|GTE|GTS|GTC|GTR|GDI|CGI|TGI|SDI|ECO|EDC|EVO|TTV|TCI|CVT|DSG|STI|LPG|CNG|ETS)[\s-]?\d{4}$/;
/** Krótkie wyrazy prozy w kształcie wyróżnika małymi literami („to", „do", „od 2025"). */
const RE_PLATE_SHORT_PL_WORD =
  /^(?:to|od|do|po|za|ze|we|na|co|ok|ta|te|ty|go|ja|mu|mi|ci|tu|np|tj|ma|są|by|aż|że|ani|lub|dla|nad|pod|bez|się|nie|tak|już|też|jak|ten|tym|tej|był|jej|ich|nam|was|pon|wt|śr|czw|pt|sob|nd|ndz)$/;
const RE_PLATE_VEHICLE_ADJ = /^(?:siodłow|ciężarow|osobow|dostawcz|specjaln|wolnobieżn)\p{Ll}*$/u;
const RE_PLATE_WEEKDAY =/^(?:pon|wt|śr|czw|pt|sob|nd|ndz)$/i;
// Rzeczownik pojazdu przed kotwicą „numer rejestracji" („Pojazd o numerze rejestracji …").
const RE_PLATE_VEHICLE_BEFORE = /(?<!\p{L})(?:pojazd|samoch[oó]d|aut[aoy]?(?!\p{L})|motocykl|ciągnik|naczep|przyczep)/iu;
export function passPlate(ctx: RedactCtx): void {
  if (!ctx.on('NR-REJESTRACYJNY')) return;
  // Wypełniacze po kotwicy ograniczone do {0,3}: przy „*" ciąg „rejestracyjny rejestracyjny …"
  // był od każdego słowa pochłaniany do końca (czas kwadratowy, ~7 s na 100 tys. znaków).
  // Kotwica z kropką („nr. rej.", „nr.rej.", „NR. REJ.", „nr. rejestr.") tylko ze skrótem „rej"/
  // „rejestr"/„rejestracyjn…" — „nr. rejestru ABC 1234/2020" to numer rejestru, nie tablica. Tak
  // samo „numer" w odmianie („numerze rej.", „numerem rejestracyjnym", „numerach rej."): „lot
  // o numerze rejsu LO 3925", „pod numerem rejestrowym RIK 12345" czy „numerze rejonu" to nie tablica.
  // Odmienione „numer…" z „rejestracji" to dalej tablica („pod numerem rejestracji WX 12345"), ale
  // z ogonem „/rok" („zarejestrowano pod numerem rejestracji RPW 12345/2026") to rejestracja pisma
  // w kancelarii (EZD) — maska zostawiała osierocone „/2026" (strażnik w callbacku).
  // Wypełniacze także po kropce bez spacji („Nr rej.poj."), z rzeczownikiem pojazdu („nr rej.
  // naczepy", „numer rejestracyjny auta:"), łącznikiem („o numerze", „to", „pod") i rolą („numer
  // tablicy sprawcy:"): dawniej każdy z nich przerywał kotwicę. Separator przed wartością
  // dopuszcza „|" komórki tabeli, ale tylko w tej samej linii — przez „\n" kotwica z nagłówka
  // kolumny przeskakiwała do pierwszej komórki kolejnego wiersza („| Kod | Tablica |⏎|---|…").
  // Tablica z literą na początku numeru przy trzyliterowym powiecie („WPI KC27") osobną gałęzią:
  // lookahead cyfry w pierwszych 6 znakach jej nie widzi, a poszerzony łapał słowa („Tablica
  // nad WC12"). Tylko WIELKIMI literami, z literą województwa i po kotwicy z „rej".
  ctx.text = ctx.text.replace(
    /\b((?:nr\s+rej\w*|nr\.\s*rej(?:estracyjn\w*|estr)?\b|numer\s+rej\w*|numer\w+\s+rej(?:estracyjn\w*|estracj\w*|estr)?\b|rejestracyjn\w*|tablic\w*)(?:(?:\.\s*|\s+)(?:nr\.?|numer\w*|pojazdu|poj\.|sam\.|rej\w*|o|pod|to|sprawcy|kierowcy|właściciela|poszkodowanego|samoch[oó]d\w*|naczep\w*|przyczep\w*|ciągnik\w*|motocykl\w*|motorower\w*|aut[aoy]?\b|autobus\w*|autokar\w*|bus[aeuy]?\b|ci[eę][zż]ar[oó]w\w*|osobow\w*|dostawcz\w*|siodłow\w*)){0,3}(?:[ \t:=.-]*\|[ \t]*|[\s:=.-]*))((?=[A-Z0-9\s-]{0,5}\d)[A-Z]{2,3}[\s-]?[A-Z0-9]{4,5}|[A-Z]{3}[\s-][A-Z]{2}\d{2})\b/gi,
    (m, pre: string, plate: string, offset: number, str: string) => {
      // Tylko wyróżnik z samymi cyframi wygląda na znak kancelaryjny („RPW 12345/2026"); tablica
      // z literą w części numerycznej („KR 5A123/2022") to dalej tablica.
      // Pojazd tuż przed kotwicą („Pojazd o numerze rejestracji KR 12345/2022") rozstrzyga za tablicą.
      if (
        /rejestracj/i.test(pre) &&
        /^[A-Z]{2,3}[\s-]?\d{4,5}$/i.test(plate) &&
        /^[ \t]*\/[ \t]*\d/.test(str.slice(offset + m.length, offset + m.length + 4)) &&
        !RE_PLATE_VEHICLE_BEFORE.test(str.slice(Math.max(0, offset - 30), offset) + pre)
      )
        return m;
      // Flaga /i jest potrzebna kotwicy („NR REJ.", „Tablica"), ale obejmuje też wyróżnik: słowo
      // prozy („od 2025", „dla 2000 pojazdów", „to 1500 zł") stawało się tablicą — to jednak
      // zdarza się tylko po słabych kotwicach „tablic…" i „rejestracyjn…". Tam wyróżnik małymi
      // literami przyjmujemy tylko w zapisie sklejonym („tablica wa12345"); po „nr rej." /
      // „numer rejestracyjny" stoi wartość pola, więc „nr rej. wa 12345" to tablica. „nr"/„NR"
      // nigdy nie jest wyróżnikiem („Tablica nr 12345 wisi przy wejściu").
      const strong = /^(?:nr\.?\s*|numer\p{L}*\s+)rej(?:estracyjn\p{L}*|estr)?(?!\p{L})/iu.test(pre);
      // Wyjątek: po „rejestracyjn…" zapis małymi literami ze spacją, gdy wyróżnik ma literę
      // województwa i nie jest krótkim wyrazem prozy („tablice rejestracyjne wa 12345" — tablica;
      // „tablice rejestracyjne to 12345 sztuk", „… do 2025" — proza).
      // Także zapis od wielkiej litery („Wa 12345"). Skrót dnia tygodnia („pt", „sob") przed pięcioma
      // cyframi nie występuje, a „PT" to wyróżnik Turku.
      const lowerSpacedOk =
        /rejestracyjn/i.test(pre) &&
        /^[A-Za-z][a-z]{1,2}[\s-]\d{4,5}$/.test(plate) &&
        PLATE_VOIV_LETTERS.includes(plate[0].toUpperCase()) &&
        // Krótki wyraz prozy od wielkiej litery przed pięcioma cyframi („Po 12345" — wyróżnik Poznania)
        // to też tablica: przyimek w środku zdania pisze się małą literą, a rok ma cztery cyfry.
        !(
          RE_PLATE_SHORT_PL_WORD.test(plate.split(/[\s-]/)[0].toLowerCase()) &&
          !((RE_PLATE_WEEKDAY.test(plate.split(/[\s-]/)[0]) || /^[A-Z]/.test(plate)) && /\d{5}$/.test(plate))
        );
      if (/^nr\b/i.test(plate) || (!strong && !lowerSpacedOk && !/^[A-Z]{2,3}(?![a-z])/.test(plate) && /[\s-]/.test(plate)))
        return m;
      // Sama „tablica" bez „rej…" bywa też ostrzegawcza czy informacyjna („Na tablicy UN 1203")
      // — tam skrót techniczny nie jest wyróżnikiem. Przy „nr rej." kotwica wygrywa.
      if (!/rej/i.test(pre) && !RE_PLATE_ACRONYM_HEAD.test(plate)) return m;
      // Układ „WPI KC27" (patrz wyżej): WIELKIE litery, litera województwa, kotwica z „rej".
      if (/^[A-Za-z]{3}[\s-][A-Za-z]{2}\d{2}$/.test(plate) && !(/^[A-Z]{3}[\s-][A-Z]{2}\d{2}$/.test(plate) && PLATE_VOIV_LETTERS.includes(plate[0]) && /rej/i.test(pre))) return m;
      // Łącznik „o/to/pod" po samej „tablicy" („Tablica o numerze INW 12345 jest w magazynie",
      // „Tablice to …") jest słabszy niż etykieta pola — wyróżnik musi wyglądać na tablicę. Skrót
      // z rokiem („Ogłoszenie na tablicy o PIT 2024", „na tablicy pod RPO 2021", „o SKO 2023/2024")
      // to w pismach urzędowych temat ogłoszenia, nie tablica.
      if (!/rej/i.test(pre) && /(?<!\p{L})(?:o|to|pod)(?!\p{L})/iu.test(pre) && (!(/^[A-Z]{2,3}(?![a-z])/.test(plate) && PLATE_VOIV_LETTERS.includes(plate[0])) || RE_PLATE_YEAR_SHAPE.test(plate))) return m;
      ctx.bump('NR-REJESTRACYJNY');
      return `${pre}${ctx.M['NR-REJESTRACYJNY']}`;
    },
  );
  ctx.text = ctx.text.replace(RE_PLATE_VEHICLE, (m, kw: string, sep: string, plate: string, offset: number, str: string) => {
    if (!PLATE_VOIV_LETTERS.includes(plate[0])) return m;
    // Za modelem skrót wersji z czterema cyframi to dalszy opis pojazdu, nie tablica: rok („marki
    // Opel Astra GTC 2015 rocznik") albo pojemność silnika w pełnych setkach („Skoda Octavia TSI
    // 1400", „Honda Fireblade CBR 1100 XX"). Dwie litery z czterema cyframi to w ogóle nie polska
    // tablica („Suzuki V-Strom DL 1000"); trzyliterowy powiat z innymi czterema cyframi („Ford
    // Transit WPI 1234") zostaje tablicą. Tylko gdy człon modelu rzeczywiście wystąpił (sama marka
    // jak dotąd). Kod silnika z dowolną pojemnością („Golf TDI 1896 cm3", „Clio DCI 1461") odpada
    // już po samej „marki" — patrz RE_PLATE_ENGINE_CODE.
    if (/^(?:[A-Z]{2}[\s-]?\d{4}|[A-Z]{3}[\s-]?(?:\d{2}00|(?:19|20)\d{2}))$/.test(plate) && RE_PLATE_AFTER_MODEL.test(sep)) return m;
    if (RE_PLATE_ENGINE_CODE.test(plate) && /(?:^|\s)marki\s/.test(sep)) return m;
    // Dwie litery z rokiem po samej kotwicy pojazdowej („dla pojazdów PN 2020", „samochody EN 2018")
    // to norma albo rocznik — polska tablica z dwuliterowym wyróżnikiem ma pięć znaków za nim.
    // Ale kotwica w liczbie pojedynczej bez takiego kontekstu („Sprawca uciekł samochodem WA 2015",
    // „motocyklem KR 1999") wskazuje konkretny pojazd — to tablica, jak w v0.46.22.
    if (
      /^[A-Z]{2}[\s-]?(?:19|20)\d{2}$/.test(plate) &&
      (/(?:ów|y|ami|ach|om)$/.test(kw) ||
        /(?<!\p{L})(?:dla|według|wg)(?!\p{L})/iu.test(sep) ||
        /^[ \t]*(?:r\.|rok|roku)/.test(str.slice(offset + m.length, offset + m.length + 7)) ||
        /^(?:PN|EN|UE|EU|OC|AC|NW|ISO|IS)/.test(plate) ||
        // akt prawny z rokiem („dyrektywa dotycząca pojazdu WE 2007")
        /(?<!\p{L})(?:dyrektyw|rozporządze|norm|homologacj)\p{L}*/iu.test(str.slice(Math.max(0, offset - 40), offset) + kw))
    )
      return m;
    // Kod waluty albo jednostki z kwotą („Wartość samochodów wynosi PLN 45000", „Leasing pojazdów:
    // CHF 12000", „Liczba pojazdów: SZT 1200") to kwota, nie tablica.
    if (/^(?:PLN|EUR|USD|CHF|GBP|CZK|SEK|NOK|DKK|JPY|UAH|SZT|KPL|KOM)(?![A-Z])/.test(plate)) return m;
    // Trzy litery z rokiem to marka z rocznikiem („dostawę samochodów KIA 2019", „Liczba pojazdów:
    // DAF 2018", „przyczepą SAM 2012"), a po kotwicy w dopełniaczu mnogim bez dwukropka to proza
    // przetargu czy sprawozdania („pojazdów marki MAN TGL 2012"). Wykaz z dwukropkiem („Wykaz
    // pojazdów: WPI 2019, WE 12345") i liczba pojedyncza („autem WPI 2019") zostają tablicą.
    if (RE_PLATE_YEAR_SHAPE.test(plate) && /^[A-Z]{3}/.test(plate)) {
      if (PLATE_VEHICLE_BRANDS.has(plate.slice(0, 3))) return m;
      // Skrót instytucji, kod silnika, paliwa albo typu pojazdu z rocznikiem („Autem PKP 2024",
      // „autem LPG 2010", „Autem TIR 2015", „Wykaz pojazdów: GBA 2010" w sprawozdaniu OSP) i liczba
      // z „r." tuż za nią („Zakup pojazdów: GBA 2023 r.") to rok, nie tablica.
      if (PLATE_YEAR_ABBR.has(plate.slice(0, 3)) || RE_PLATE_ENGINE_CODE.test(plate) || PLATE_VEHICLE_TYPE_CODES.has(plate.slice(0, 3))) return m;
      if (/^[ \t]*(?:r\.|rok)/.test(str.slice(offset + m.length, offset + m.length + 6))) return m;
      if (/(?:ów|^[Aa]ut|[Pp]rzyczep|[Nn]aczep)$/.test(kw) && !sep.includes(':')) return m;
    }
    // Wtrącenie między kotwicą a kandydatem: zakończone przyimkiem („Liczba pojazdów według GUS
    // 2023", „samochodów w KRS 1234", „Autem do PZU 2020") wskazuje źródło albo instytucję, a skrót
    // z rokiem po kilku wyrazach („z silnikiem TDI 2000") to opis, nie tablica.
    const gap = /(?:^|\s)([a-ząćęłńóśźż]{1,15})[\s:=.-]*$/.exec(sep)?.[1];
    if (gap && RE_PLATE_GAP_PREP.test(gap)) return m;
    // Przymiotnik typu pojazdu z samej kotwicy („samochód osobowy WPI 2019", „samochodem ciężarowym
    // KRA 2015") to nie wtrącenie — pojazd jest dalej konkretny, jak bez przymiotnika.
    if (gap && RE_PLATE_YEAR_SHAPE.test(plate) && !RE_PLATE_VEHICLE_ADJ.test(gap)) return m;
    ctx.bump('NR-REJESTRACYJNY');
    return `${kw}${sep}${ctx.M['NR-REJESTRACYJNY']}`;
  });
  // WYLICZENIE po zamaskowanej tablicy — kolejne człony listy dziedziczą kotwicę pierwszego.
  // Człon z jednostką („, DMC 18000 kg") albo skrótem technicznym kończy wyliczenie, tak samo
  // numer aktu z ukośnikiem („, UE 2016/679" — rozporządzenie, nie tablica; maska zostawiała „/679").
  // Średnik i ukośnik („WE 12345 / WE 54321", „ciągnik/naczepa: WGM1234A/WGM5678B") tylko z odstępami
  // poziomymi: przez nową linię lista sięgała do kolejnego akapitu („…WE 12345;⏎SN 2020 r. orzekł").
  // Skrót z rokiem kończy wyliczenie („; OC 2024 ważne", „/ PZU 2024", „; SN 2020 r. orzekł") — to
  // kolejne pole kartoteki albo sygnatura, a nie druga tablica; dalszych członów też nie bierzemy.
  // Trzyliterowy powiat z rokiem jest jednak zwykłą tablicą („, WPI 2019") — patrz plateYearEndsList.
  {
    const REJ = escapeRe(ctx.M['NR-REJESTRACYJNY']);
    ctx.text = ctx.text.replace(
      new RegExp(`(${REJ})((?:(?:\\s*,\\s*|[ \\t]*[;/][ \\t]*|\\s+oraz\\s+|\\s+i\\s+)${PLATE_ITEM}(?![\\w-]|/\\d)${PLATE_NOT_UNIT})+)`, 'g'),
      (_m, first: string, tail: string) => {
        let ended = false;
        const maskedTail = tail.replace(RE_PLATE_ITEM_SCAN, (p) => {
          if (ended || plateYearEndsList(p)) {
            ended = true;
            return p;
          }
          if (!PLATE_VOIV_LETTERS.includes(p[0])) return p;
          ctx.bump('NR-REJESTRACYJNY');
          return ctx.M['NR-REJESTRACYJNY'];
        });
        return `${first}${maskedTail}`;
      },
    );
  }
}

// 10) KOD POCZTOWY — XX-XXX, nie po „art./§" i nie przed walutą/jednostką: „10-200 PLN",
// „20-150 km", „30-500 osób" to zakres liczb, a za kodem pocztowym stoi nazwa miejscowości
// (wielką literą). Celowo bez samego „m" — „00-950 m. st. Warszawa" to kod przed nazwą miasta.
const RE_POSTAL = /(?<![\d-])\d{2}-\d{3}(?![\d-])(?![ \t]*(?:zł|zl|PLN|EUR|USD|GBP|CHF|gr|tys|mln|%|km|kg|min|godz|szt|sztuk|osób|osoby|dni|lat)(?![\p{L}]))/gu;
export function passPostal(ctx: RedactCtx): void {
  if (!ctx.on('KOD-POCZTOWY')) return;
  ctx.text = ctx.text.replace(RE_POSTAL, (m, offset: number) => {
    if (precededByLegalRef(ctx.text, offset)) return m;
    ctx.bump('KOD-POCZTOWY');
    return ctx.M['KOD-POCZTOWY'];
  });
}
