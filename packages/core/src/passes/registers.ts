// Numery z rejestrów zawodowych i urzędowych, zawsze z kotwicą: numer prawa wykonywania zawodu
// (PWZ), numer wpisu radcy prawnego, adwokata lub notariusza, numer karty pobytu i numer aktu
// stanu cywilnego. Żaden z tych zapisów bez słowa obok nie odróżnia się od kodu produktu,
// sygnatury czy zwykłej liczby.
import type { RedactCtx } from '../context.js';
import type { PiiType } from '../types.js';
import { escapeRe } from '../util.js';
import { isValidNpwz } from '../validators.js';

const LOWER = 'a-ząćęłńóśźż';
const UPPER = 'A-ZĄĆĘŁŃÓŚŹŻ';
const WORD = `\\w${LOWER}${UPPER}`;
const LETTER = `${LOWER}${UPPER}`;

/**
 * Słowo kotwicy bez względu na wielkość liter („nr”, „Nr”, „NR”, „AKT URODZENIA”). Bez flagi `i`,
 * bo wartość (seria karty pobytu, kod izby) musi zostać wersalikami.
 */
function ci(word: string): string {
  return [...word].map((c) => (c.toUpperCase() !== c ? `[${c}${c.toUpperCase()}]` : c)).join('');
}
const ciAlt = (words: string[]): string => words.map(ci).join('|');
/** „nr”, „Nr.”, „NR” oraz „numer”, „numerze”, „Numerem”, „NUMERU”. */
const NR = String.raw`(?:${ci('nr')}\.?|${ci('numer')}(?:${ciAlt(['ze', 'em', 'u'])})?)`;

/**
 * Kolejne numery wyliczenia po masce („akty urodzenia [maska] i 13/2010”, „PWZ [maska], 2405205”).
 * Każdy zamaskowany numer jest kotwicą następnego, więc cały łańcuch bierzemy jednym dopasowaniem
 * i maskujemy element po elemencie, aż któryś nie przejdzie `accept`. Jedno przejście po tekście:
 * dawna pętla „replace do skutku” brała po jednym elemencie na przejście i rosła kwadratowo.
 */
function maskEnumeration(ctx: RedactCtx, type: PiiType, value: string, accept: (v: string) => boolean): void {
  const sep = String.raw`[ \t]*,[ \t]*|[ \t]+(?:i|oraz)[ \t]+`;
  const chain = new RegExp(`${escapeRe(ctx.M[type])}((?:(?:${sep})(?:${value})(?![${WORD}/]))+)`, 'g');
  const one = new RegExp(`(${sep})(${value})(?![${WORD}/])`, 'y');
  ctx.text = ctx.text.replace(chain, (m: string, tail: string) => {
    let out = m.slice(0, m.length - tail.length);
    let end = 0;
    one.lastIndex = 0;
    for (let x = one.exec(tail); x && accept(x[2]); x = one.exec(tail)) {
      out += `${x[1]}${ctx.hit(type)}`;
      end = one.lastIndex;
    }
    return out + tail.slice(end);
  });
}

/** Zawód po etykiecie w dopełniaczu („PWZ farmaceuty”) albo jego skrót („PWZ lek. 2663347”). */
const PWZ_PROFESSION = `(?:(?:lekar|dentyst|pielęgniar|położn|farmaceut|diagnost|fizjoterapeut|weterynar|psycholog)[${LOWER}]*|(?:lek|dent|piel|poł|farm|fizjot|wet)\\.)`;
/**
 * Liczba z jednostką po niej to kwota albo statystyka, a nie numer („PWZ 12000 zł”, „wydała PWZ
 * 12345 lekarzom”, „PWZ 15000 pielęgniarkom”). Zawód w liczbie mnogiej albo celowniku (końcówki
 * -om, -ów, -ek, -ach, -ami, „lekarzy”, „lekarze”) to adresat statystyki. Liczba pojedyncza
 * („PWZ 2663347 lekarz Jan Nowak”) nie blokuje, bo tak bywa podpisany numer.
 */
const NOT_UNIT = String.raw`(?![ \t]*(?:zł|PLN|złotych|EUR|os(?:ób|obom|obach|oby)(?![${LETTER}])|os\.|razy|tys\.|%|lekarz[ye](?![${LETTER}])|(?:lekar|dentyst|pielęgniar|położn|farmaceut|diagnost|fizjoterapeut|weterynar|psycholog|ratowni|aptek)[${LOWER}]*(?:om|ów|ek|ach|ami)(?![${LETTER}])))`;
/**
 * PWZ po etykiecie: „PWZ 2663347”, „(NPWZ: 1234567)”, „nr PWZ 1234567P”, „(PWZ) nr 2663347”,
 * „PWZ lek. 2663347”, „prawo wykonywania zawodu lekarza nr 1234567”, „PWZ farmaceuty: 12345/2010”.
 * Przy etykiecie PWZ maskujemy także przy złej sumie (literówka), jak PESEL. Wartość to 5–8 cyfr
 * z opcjonalną literą P/A pielęgniarki i położnej albo z rokiem po ukośniku; rok („PWZ od 2010”)
 * ma za mało cyfr, a telefon za dużo. Cyfry pogrupowane spacjami („2 663 347”) tylko z sumą NPWZ.
 */
const RE_PWZ_LABEL = new RegExp(
  String.raw`((?<![${WORD}])(?:\(?N?PWZ[LPF]?\)?|(?:${NR}\s+)?${ci('praw')}(?:${ciAlt(['o', 'a', 'em', 'ie'])})\s+${ci('wykonywania')}\s+${ci('zawodu')}(?:\s+\(N?PWZ\))?)(?:\s+${PWZ_PROFESSION}){0,2}(?:\s+${NR})?)([\s:.=-]*)(\d{5,8}[PA]?(?:\/\d{4})?|\d[ ]\d{3}[ ]\d{3})(?![${WORD}]|\/\d)${NOT_UNIT}`,
  'g',
);

const NAME_WORD = `[${UPPER}][${LOWER}]+(?:-[${UPPER}][${LOWER}]+)?`;
/**
 * Słabsza kotwica: konkretny lekarz („lek.”, „dr n. med.” albo „lekarz” w liczbie pojedynczej)
 * z imieniem i nazwiskiem, a numer w nawiasie albo po przecinku w tym samym wierszu („lek. Jan
 * Nowak (2663347)”, „lekarz prowadzący Jan Nowak, 2663347”). Samo słowo „lekarz” bez osoby
 * („Lekarz dyżurny, 1855252”, „porady lekarzy POZ (1855252)”) to nagłówek tabeli albo statystyka.
 * Tu maskujemy tylko numer z poprawną sumą NPWZ.
 */
const RE_PWZ_DOCTOR = new RegExp(
  String.raw`((?<![${WORD}])(?:[Ll]ek\.(?:\s*(?:med|dent)\.)?|[Ll]ekarz(?:a|em|owi)?(?![${LETTER}])(?:\s+[${LOWER}]{3,20}){0,2}:?|[Dd]r\.?\s+n\.\s*med\.)(?:\s+(?:${NAME_WORD}|[${UPPER}]\.)){1,2}\s+${NAME_WORD}[^\n()]{0,40}?(?:\(\s*|,[ \t]*))(\d{7})(?=\s*\)|[ \t]*(?:$|\n|[,;]))`,
  'gm',
);

/**
 * Kody okręgowych izb radców prawnych i okręgowych rad adwokackich (WAW, KRA, KRK…), od których
 * zaczyna się numer wpisu. Komplet 19 izb radcowskich: BB BK BY GD KA KI KO KR LB ŁD OL OP PO RZ
 * SZ TO WA WB WR ZG, do tego zapisy LU, LD i BI spotykane w pismach. Zamknięta lista: dowolne
 * wersaliki to też kody faktur (FV/1234), umów, formularzy (PCC-3), norm i spółek (ABC-123).
 */
const CHAMBER_CODES =
  'WAW WAŁ WAL WRO KRA KRK KAT KIE KOS GDA POZ LUB LOD ŁÓD BIA BYD CZE OLS OPO PŁO PLO RAD RZE SIE SZC TOR ZIE ' +
  'WA WB WR KR KA KI KO GD PO LB LU LD ŁD BB BK BI BY OL OP RZ SZ TO ZG';
const LAWYER_NUMBER = String.raw`(?:${CHAMBER_CODES.split(' ').join('|')})(?:[-/][A-Za-z]{1,4})?[-/]\d{2,5}`;
const L = `[${LETTER}]*`;
/** Kotwica zawodu: radca prawny, adwokat, aplikant, notariusz, skróty „r.pr.” i „adw.”, też wersalikami. */
const LAWYER_ANCHOR = String.raw`(?:${ci('radc')}${L}\s+${ci('prawn')}${L}|${ci('radczy')}${L}(?:\s+${ci('prawn')}${L})?|${ci('adwokat')}${L}|${ci('aplikan')}${L}\s+(?:${ciAlt(['radcowsk', 'adwokack', 'notarialn'])})${L}|${ci('notariusz')}${L}|${ci('r')}\.\s?${ci('pr')}\.|${ci('adw')}\.)`;
/**
 * „na listę radców prawnych OIRP w Warszawie”: do sześciu słów z nazwą izby i miastem. Pierwsze
 * słowo nazywa zawód albo izbę, bo „na listę uczestników szkolenia” czy „listę obecności” to nie
 * lista radców ani adwokatów.
 */
const LAWYER_LIST = String.raw`\s+${ci('na')}\s+${ci('list')}[ęyĘY]\s+(?:${ciAlt(['radc', 'adwoka', 'aplikant', 'notariusz', 'okręgow', 'izb', 'oirp', 'ora'])})[${LETTER}]*(?:\s+[${LETTER}]+){0,5}`;
/**
 * „nr wpisu”, „Numer wpisu na listę radców prawnych OIRP w Warszawie” między osobą a numerem,
 * a także szyk „wpis (wpisany) na listę … pod nr”.
 */
const LAWYER_ENTRY = String.raw`(?:(?:${ci('nr')}\.?|${ci('numer')}${L})\s+${ci('wpisu')}(?:${LAWYER_LIST})?|${ci('wpis')}(?:${ciAlt(['any', 'ana', 'anym', 'aną'])})?${LAWYER_LIST}\s+${ci('pod')}\s+${NR})`;
/** Imię albo nazwisko osoby: „Kowalska”, „Nowak-Wilk”, a w nagłówku wersalikami „KOWALSKA”. */
const PERSON_WORD = `(?:${NAME_WORD}|[${UPPER}]{3,}(?:-[${UPPER}]{3,})?)`;
/**
 * Po numerze wpisu kończy się wiersz, zdanie albo pozycja wyliczenia. Dalszy ciąg zdania po kodzie
 * („KR-2020 to numer sprawy”, „PO-350 zł”, „PO-2024 r.”, „GD-10 sala rozpraw”) to inne oznaczenie.
 * Myślnik z dalszym tekstem rozstrzyga `passProfessionalNumber` (patrz `RE_DASH_TAIL`).
 */
const LAWYER_END = String.raw`(?=[ \t]*(?:[),;:]|\.(?![\d${LETTER}])|\r?\n|$)|[ \t]+(?:i|oraz)[ \t]|[ \t]+[–—-](?:[ \t]|$))`;
/** Myślnik, po którym zdanie biegnie dalej: „KR-2026 - plan pracy”, „WA-1234 – aplikacja 2026 r.”. */
const RE_DASH_TAIL = new RegExp(String.raw`^[ \t]+[–—-][ \t]+[\d${LETTER}]`);
/**
 * Sam zawód przed numerem, bez imienia, nazwiska i „nr wpisu” („Kancelaria radcy prawnego,
 * KR-2026”, „Radca prawny, WA-1234”). Taka kotwica jest za słaba, żeby kod przed myślnikiem
 * z dalszym ciągiem zdania uznać za numer wpisu, tak jak „Adwokat, KR-2020 to numer sprawy”.
 * Z osobą („radca prawny Jan Nowak, WA-1234 – pełnomocnik powoda”) to podpis.
 */
const RE_BARE_ANCHOR = new RegExp(String.raw`^${LAWYER_ANCHOR}[\s,:(]*$`);
/**
 * Numer wpisu stoi zaraz po kotwicy zawodu albo po imieniu i nazwisku osoby: „radca prawny,
 * GD-8638”, „radcę prawnego Mariusza Nowakowskiego (KR-4222)”, „r.pr. Anna Kowalska, nr wpisu
 * WA-1234”, a w podpisie blokowym w osobnym wierszu („radca prawny\nWA-3516”), gdy ten wiersz
 * to sam numer albo zaczyna się od „Nr wpisu:” („Adwokat Jan Kowalski\nNr wpisu: KR-1234”). Blok
 * to najwyżej dwa wiersze bez pustej linii, a wiersz z zawodem kończy się na osobie. Numer dalej w zdaniu („adwokat, sprawa KR-2020”) zostaje jawny. Samo „nr wpisu”
 * bez zawodu to za mało: wpis do CEIDG, BDO czy rejestru żłobków też ma numer.
 */
const RE_LAWYER = new RegExp(
  String.raw`((?<![${WORD}])${LAWYER_ANCHOR}(?:[ \t]+${PERSON_WORD}){0,3}(?:[ \t]*[,:]?[ \t]*\(?[ \t]*(?:${LAWYER_ENTRY}[ \t]*:?[ \t]*\(?[ \t]*)?|[ \t]*\r?\n[ \t]*(?:${LAWYER_ENTRY}[ \t]*:?[ \t]*|(?=(?:${LAWYER_NUMBER})[ \t]*(?:\r?\n|$)))))(${LAWYER_NUMBER})(?![${WORD}]|[-/]\d)${LAWYER_END}`,
  'g',
);

const RE_PROFESSION_WORD = new RegExp(String.raw`\s${PWZ_PROFESSION}$`);

export function passProfessionalNumber(ctx: RedactCtx): void {
  if (!ctx.on('NR-UPRAWNIEN')) return;
  ctx.text = ctx.text.replace(RE_PWZ_LABEL, (m, kw: string, sep: string, val: string) => {
    // Cyfry ze spacjami albo sama fraza „prawo wykonywania zawodu” bez „nr” i bez „PWZ” to za
    // mało, żeby wziąć dowolną liczbę („prawo wykonywania zawodu: 152340” to statystyka).
    // Zawód w dopełniaczu z dwukropkiem („Prawo wykonywania zawodu lekarza: 1234567”) to pole
    // formularza, tak samo mocne jak „nr”.
    const field = sep.includes(':') && RE_PROFESSION_WORD.test(kw);
    const weak = val.includes(' ') || (!/PWZ|(?<![a-ząćęłńóśźż])nr(?![a-ząćęłńóśźż])|numer/i.test(kw) && !field && !/[PA]$|\//.test(val));
    if (weak && !isValidNpwz(val)) return m;
    return `${kw}${sep}${ctx.hit('NR-UPRAWNIEN')}`;
  });
  ctx.text = ctx.text.replace(RE_PWZ_DOCTOR, (m, pre: string, num: string) =>
    isValidNpwz(num) ? `${pre}${ctx.hit('NR-UPRAWNIEN')}` : m,
  );
  ctx.text = ctx.text.replace(RE_LAWYER, (m: string, pre: string, _num: string, at: number, all: string) =>
    RE_BARE_ANCHOR.test(pre) && RE_DASH_TAIL.test(all.slice(at + m.length)) ? m : `${pre}${ctx.hit('NR-UPRAWNIEN')}`,
  );
  // Kilka numerów po jednej etykiecie: PWZ z sumą albo z literą P/A, numer wpisu z kodem izby.
  maskEnumeration(ctx, 'NR-UPRAWNIEN', String.raw`\d{7}[PA]?|${LAWYER_NUMBER}`, (v) => /^\D/.test(v) || /[PA]$/.test(v) || isValidNpwz(v));
}

/** Karta pobytu: seria (2 wersaliki) i 7 cyfr, np. „RP1234567”. */
const RESIDENCE_VALUE = String.raw`[A-Z]{2}[ -]?\d{7}`;
const RESIDENCE_ANCHOR = String.raw`${ci('kart')}(?:${ciAlt(['a', 'y', 'ą', 'ę', 'cie', 'om', 'ami', 'ach'])})\s+${ci('pobytu')}`;
/**
 * Numer karty pobytu w tym samym zdaniu co „karta pobytu”: zaraz po niej (z nazwą rodzaju karty
 * albo jednym, dwoma słowami: „karty pobytu cudzoziemca RP1234567”) albo po „nr”, „numer” lub
 * nawiasie („kartę pobytu (nr RP1234567)”, „Karta pobytu czasowego wydana przez Wojewodę, nr
 * RP1234567”). Wtrącenie z innym dokumentem (paszport, dowód) przerywa kotwicę.
 */
const RE_RESIDENCE = new RegExp(
  String.raw`((?<![${WORD}])${RESIDENCE_ANCHOR}(?:(?:\s+(?:[${LOWER}]{2,20}|[${UPPER}]{3,20})){0,2}[\s:.=-]*|[^\n.;\d]{0,80}?(?<![${WORD}])(?:${NR}|\()[\s:]*))(${RESIDENCE_VALUE})(?!\d)`,
  'g',
);

export function passResidenceCard(ctx: RedactCtx): void {
  if (!ctx.on('KARTA-POBYTU')) return;
  // „kartę pobytu stałego seria RP numer 1234567”: maska obejmuje serię i numer.
  ctx.text = ctx.text.replace(
    new RegExp(
      String.raw`(${RESIDENCE_ANCHOR}(?:\s+(?:${ciAlt(['czasowego', 'stałego'])}|${ci('rezydenta')}(?:\s+${ci('długoterminowego')}(?:\s+UE)?)?))?\s+${ci('seri')}[aiięąAIĘĄ][ \t]+)[A-Z]{2},?[ \t]*(?:${NR}[ \t]*)?\d{7}(?!\d)`,
      'g',
    ),
    (_m, pre: string) => `${pre}${ctx.hit('KARTA-POBYTU')}`,
  );
  ctx.text = ctx.text.replace(RE_RESIDENCE, (m, pre: string) =>
    /paszport|dowod|dowód|legitymacj/i.test(pre) ? m : `${pre}${ctx.hit('KARTA-POBYTU')}`,
  );
  maskEnumeration(ctx, 'KARTA-POBYTU', RESIDENCE_VALUE, () => true);
}

/**
 * Akt stanu cywilnego: numer po „akt urodzenia/małżeństwa/zgonu” albo „nr aktu …”. Numer musi
 * mieć ukośnik („1040/2011”, „AU/123/2020”, „1465011/00/AU/2016/000123”). „Sygn. akt I C
 * 1040/2011” nie ma po „akt” rodzaju aktu, więc zostaje dla znaku sprawy.
 */
const CIVIL_STATE = String.raw`${ci('stanu')}\s+${ci('cywilnego')}`;
const CIVIL_HEAD = String.raw`(?:(?:${ci('akt')}(?:${ciAlt(['u', 'em', 'y', 'ów', 'ach', 'ami'])})?|${NR}\s+${ci('aktu')})\s+(?:${CIVIL_STATE}\s+)?(?:${ciAlt(['urodzenia', 'małżeństwa', 'zgonu'])})|(?:${ci('akt')}(?:${ciAlt(['u', 'em'])})?|${NR}\s+${ci('aktu')})\s+${CIVIL_STATE})`;
const CIVIL_VALUE = String.raw`(?:[A-Z]{1,4}[.\s/-]?)?\d{1,8}(?:\/[A-Z0-9]{1,8}){1,4}`;
/**
 * Numer zaraz po rodzaju aktu („akt zgonu 868/2009”, „Akt urodzenia: 123/2020”) albo po „nr”,
 * „numer”, „pod nr” w tym samym zdaniu, bez przecinka i cyfr po drodze („Akt małżeństwa
 * sporządzony w USC Kraków pod nr 1234/2019”, „aktu urodzenia Jana Kowalskiego nr 123/2020”).
 * Wolne słowa bez „nr” nie wystarczą: „aktem zgonu ojca udział 1/2” to udział, nie numer.
 */
const RE_CIVIL_RECORD = new RegExp(
  String.raw`((?<![${WORD}])${CIVIL_HEAD}(?:[^\n.;,\d]{0,60}?(?<![${WORD}])(?:(?:${ciAlt(['pod', 'o'])})\s+)?${NR}(?![${WORD}]))?)([\s:=-]*)(${CIVIL_VALUE})(?![${WORD}/])`,
  'g',
);
/**
 * Ułamek („udział 1/2”), miesiąc z rokiem z zerem wiodącym („05/2020”) i zakres lat („akty
 * urodzenia 2019/2020”, „2019/20”: drugi rok najwyżej 10 lat po pierwszym) to nie numer aktu.
 */
function notCivilNumber(v: string): boolean {
  if (/^\d{1,2}\/\d{1,2}$/.test(v) || /^0\d\/(?:19|20)\d\d$/.test(v)) return true;
  const y = /^((?:19|20)\d\d)\/((?:19|20)?\d\d)$/.exec(v);
  if (!y) return false;
  const from = Number(y[1]);
  const to = y[2].length === 2 ? Math.floor(from / 100) * 100 + Number(y[2]) : Number(y[2]);
  return to > from && to - from <= 10;
}
/** Inny dokument między rodzajem aktu a „nr” („akt zgonu ojca i decyzja nr 12/2020”). */
const OTHER_DOCUMENT = /decyzj|wyrok|postanowieni|uchwał|faktur|umow|pism|wnios|sygn|spraw|repertorium|\brep\b|paszport|dowod|dowód/i;

export function passCivilRecord(ctx: RedactCtx): void {
  if (!ctx.on('AKT-USC')) return;
  ctx.text = ctx.text.replace(RE_CIVIL_RECORD, (m, kw: string, sep: string, val: string) =>
    notCivilNumber(val) || OTHER_DOCUMENT.test(kw) ? m : `${kw}${sep}${ctx.hit('AKT-USC')}`,
  );
  maskEnumeration(ctx, 'AKT-USC', CIVIL_VALUE, (v) => !notCivilNumber(v));
}
