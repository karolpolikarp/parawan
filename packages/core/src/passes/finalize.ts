import { HOMOGRAPH_SURNAMES, NON_SURNAME_ADJ, isGeoAdjective, looksLikeSurname, surnameBase } from '../surnames.js';
import { CAP_WORD, escapeRe, NM_BOUND, PL_LO, PL_UP, RE_CHAR_LU } from '../charset.js';
import { indexToLetters, JSON_ESC_FROM_PUA, lettersToIndex, RE_URL_SENTINEL, type RedactCtx } from '../context.js';
import { COLLIDING_NAME_FORMS, isFirstNameGenitive, isFirstNameLike, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { isObliqueSurnameForm, precededByPatron } from '../guards/eponyms.js';
import { cellEndsAt, cellStartsBefore, DOT_CHAIN, dotChainKind, INITIAL_START, institutionLabelBefore, isHonorificP, LIST_HEAD_NOT_SURNAME, RE_PERSON_MASK_BEFORE, RE_SAINT_WORD_BEFORE } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { MAIDEN_D_SENTINEL } from './person-caps-ocr.js';
import { RE_NEXT_CAP_WORD_SP } from '../person-patterns.js';


// ══════ FAZA 5 · DOMKNIĘCIA OSÓB · STABILNA NUMERACJA · PRZYWRÓCENIE URL ══════
// Początek wpisu listy/tabeli przed imieniem kończącym wiersz: wiersz albo komórka (po ; | ⇥ , :),
// opcjonalnie numeracja/punktor, JEDEN wyraz z wielkiej litery i odstęp lub separator komórki.
const RE_LIST_ENTRY_HEAD = new RegExp(
  `(?:^|[;|\\t,:][ \\t]*)(?:(?:\\d{1,4}[.)]|[-*•–])[ \\t]*)?(${CAP_WORD})([ \\t]*[;|\\t,][ \\t]*|[ \\t]+)$`,
);
// Dalszy ciąg zdania za maską w następnym wierszu („…\nKowalski złożył", „…\nKowalski.").
const RE_PROSE_TAIL = new RegExp(`^(?:[ \\t]+[${PL_LO}]|[.!?…])`);
/**
 * Czy wyraz otwierający wiersz to NAZWISKO wpisu „Nazwisko Imię"? Wymagamy dowodu: słownik,
 * końcówka nazwiskowa albo lista homografów (Sowa, Wilk, Wróbel, Kowal). Sam brak imienia i roli
 * nie wystarcza — czasowniki podpisu, przyimki i funkcje spoza ROLE_WORDS („Sporządził Jan\n
 * Kowalski", „Od Jana\nKowalskiego", „Lekarz Anna\nNowak", „Żona Anna\nKowalska") brały się za
 * nazwisko, imię zostawało jawne obok maski nazwiska.
 */
function isListEntrySurname(word: string): boolean {
  if (isFirstNameLike(word)) return false;
  return word.split('-').some((part) => {
    const w = part.toLowerCase();
    if (TITLE_WORDS.has(w) || ROLE_WORDS.has(w) || LIST_HEAD_NOT_SURNAME.has(w)) return false;
    if (LEGAL_ENTITY_WORDS.has(w) || NON_SURNAME_ADJ.has(w)) return false;
    return !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(w);
  });
}
/**
 * Czy imię `t[start, …)` na końcu wiersza DOMYKA wpis listy w szyku „Nazwisko Imię" („Sowa
 * Przemysław", „Sowa;Przemysław", „1. Sowa Przemysław")? Tak, gdy przed nim stoi potwierdzone
 * nazwisko (isListEntrySurname), a za maską w następnym wierszu nie ciągnie się proza. Wtedy maska
 * poniżej to INNA osoba — wciągnięcie imienia sklejało wiersze (lista 10 osób dawała 8 wierszy,
 * rekordy CSV się przesuwały). Łamanie prozy („Starosta Jan\nWiśniewski przeprowadził",
 * „Wnioskodawca Anna\nNowak", „Sporządził Jan\nKowalski") nadal domyka osobę. Wiersz dłuższy niż
 * 80 znaków przed imieniem to proza, nie wpis listy (też ogranicza koszt skanu wstecz).
 * Zwraca początek nazwiska i separator za nim albo null.
 */
function listEntryHead(t: string, start: number, end: number): { at: number; word: string; sep: string } | null {
  let ls = start;
  while (ls > 0 && t[ls - 1] !== '\n') {
    if (start - ls >= 80) return null;
    ls--;
  }
  const mm = RE_LIST_ENTRY_HEAD.exec(t.slice(ls, start));
  if (!mm || !(isListEntrySurname(mm[1]) || geoSurnameBeforeName(mm[1], t, start))) return null;
  if (RE_PROSE_TAIL.test(t.slice(end, end + 40))) return null;
  return { at: start - mm[2].length - mm[1].length, word: mm[1], sep: mm[2] };
}
/**
 * Czy wpis „Przymiotnik-ski Imię" („Mazowiecka Anna") to osoba w szyku „Nazwisko Imię"? Przymiotnik
 * odmiejscowy na -ski/-ska bywa nazwiskiem (Mazowiecki), a w liście świadków za nim stoi imię. Nie,
 * gdy imię jest też rzeczownikiem („Olimpijska Nadzieja", „Wielka Nadzieja" — to nazwa).
 */
function geoSurnameBeforeName(word: string, t: string, start: number): boolean {
  if (!/(?:sk|ck|dzk)[ia]$/.test(word) || !isGeoAdjective(word)) return false;
  const name = /^\p{L}+/u.exec(t.slice(start, start + 30))?.[0]?.toLowerCase() ?? '';
  return POLISH_FIRST_NAMES.has(name) && !NOUN_LIKE_FIRST_NAMES.has(name);
}
const RE_PERSON_MASK_AT_START = /^(?:\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])/;
// Maska osoby i wyraz z wielkiej litery za nią (domknięcia w prawo w finalizePersons). W prawo
// tylko przez JEDNĄ spację: kilka spacji to zwykle wyrównanie kolumn, a wyraz za nimi — następna.
const RE_MASK_THEN_NAME = new RegExp(`(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]) ([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}-])`, 'g');
const RE_MASK_COMMA_NAME = new RegExp(
  `(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]),[ \\t]*([${PL_UP}][${PL_LO}]+)(?:[ \\t]+([${PL_UP}][${PL_LO}]+))?(?![${NM_BOUND}-])`,
  'g',
);
const RE_MASK_GLUED_NAME = new RegExp(`(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])[._]([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}])`, 'g');
const OCR_NAME_WORD = `[${PL_UP}](?:[${PL_LO}]*[I01][${PL_LO}I01]*|[${PL_UP}]*[01][${PL_UP}01]*)`;
const RE_OCR_NAME_BEFORE_MASK = new RegExp(
  `(?<![${PL_UP}${PL_LO}0-9])(${OCR_NAME_WORD})([ \\t\\n_-])(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`,
  'g',
);
// Imię z homoglifem za maską na końcu wiersza („[..] KaroI⏎", „Świadkowie: [..] Kami1⏎") — szyk
// rekordu „Nazwisko Imię" z listy przepuszczonej przez OCR.
const RE_MASK_THEN_OCR_NAME = new RegExp(`(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]) (${OCR_NAME_WORD})(?=[ \\t]*(?:\\r?\\n|$))`, 'g');
/** Imię ze słownika (małymi literami), którym jest wyraz z homoglifem OCR (0, 1, „I" zamiast „l"), albo null. */
function ocrFirstNameForm(w: string): string | null {
  if (w.length < 4) return null;
  const tail = w.slice(1);
  const titlecase = /[a-ząćęłńóśźż]/.test(tail);
  const variant = (one: string): string =>
    (w[0] + (titlecase ? tail.replace(/I/g, 'l') : tail).replace(/0/g, 'o').replace(/1/g, one)).toLowerCase();
  const l = variant('l');
  if (isFirstNameLike(l)) return l;
  const i = variant('i');
  return isFirstNameLike(i) ? i : null;
}
const ocrFirstNameLike = (w: string): boolean => ocrFirstNameForm(w) !== null;
// Wiersz złożony z jednego wyrazu (opcjonalnie z numeracją/punktorem) przed imieniem na jego końcu.
const RE_ADJ_LINE_HEAD = new RegExp(`^[ \\t]*(?:(?:\\d{1,4}[.)]|[-*•–])[ \\t]*)?(${CAP_WORD})[ \\t]+$`);
const RE_FIRST_NAME_AT_END = new RegExp(`(?<![${PL_UP}${PL_LO}])[${PL_UP}][${PL_LO}]+$`);
/**
 * Wpis listy „Nazwisko Imię" nad maską osoby („Sowa Przemysław\n[OSOBA]") to osobna osoba:
 * strażnik domknięcia nie wciąga jej imienia do maski z następnego wiersza, więc bez tego kroku
 * zostawała jawna W CAŁOŚCI (homograf w szyku odwróconym — Sowa, Wilk, Kowal — nie ma innej
 * kotwicy). Idziemy od dołu: zamaskowany wpis staje się kotwicą wiersza nad nim, więc cała lista
 * homografów nad potwierdzoną osobą maskuje się w jednym przebiegu (i wynik jest idempotentny).
 * Komórki CSV/TSV („Sowa;Przemysław") dostają osobne maski tej samej osoby — kolumny się nie
 * przesuwają.
 */
function passListEntries(ctx: RedactCtx): void {
  if (!ctx.text.includes('\n')) return;
  const lines = ctx.text.split('\n');
  let changed = false;
  for (let i = lines.length - 2; i >= 0; i--) {
    const next = lines[i + 1];
    const mm = RE_PERSON_MASK_AT_START.exec(next);
    if (!mm || RE_PROSE_TAIL.test(next.slice(mm[0].length, mm[0].length + 40))) continue;
    const line = lines[i];
    const nm = RE_FIRST_NAME_AT_END.exec(line);
    if (!nm || !isFirstNameLike(nm[0])) continue;
    // proza za maską sprawdzona wyżej na wierszu i+1, więc koniec „tekstu" = koniec tego wiersza
    const head = listEntryHead(line, nm.index, line.length);
    if (!head) continue;
    const mask = ctx.personMask(head.word);
    ctx.bump('IMIE');
    const cell = /[;|\t,]/.test(head.sep);
    lines[i] = line.slice(0, head.at) + (cell ? `${mask}${head.sep}${mask}` : mask);
    changed = true;
  }
  if (changed) ctx.text = lines.join('\n');
}

interface RawWordLink {
  prev: string;
  sep: string;
  prev2: string;
  sep2: string;
  prev3: string;
  sep3: string;
  /** Kilkanaście znaków oryginału za wyrazem — do dopasowania wystąpienia, gdy imię się powtarza. */
  next: string;
  // oceny liczone raz na wpis: ten sam wpis sprawdza każde wystąpienie imienia w dokumencie
  prevName?: boolean;
  prevOblique?: boolean;
  pair?: boolean;
}
const linkPrevIsName = (l: RawWordLink): boolean => (l.prevName ??= isFirstNameLike(l.prev));
const linkPrevOblique = (l: RawWordLink): boolean => (l.prevOblique ??= isObliqueSurnameForm(l.prev));
const RE_RAW_WORD = /\p{L}+/gu;
/**
 * Wyrazy z wielkiej litery ORYGINALNEGO wejścia z trzema poprzednimi wyrazami i separatorami.
 * Domknięcia w prawo w finalizePersons widzą już tylko maskę i nie wiedzą, czy zastąpiła samo
 * nazwisko w szyku rekordu („Kowalski Jan Paweł", „Wiśniewska, Ewa"), parę „Imię Nazwisko"
 * („Zofia Nowak Antoni", „Rodzice: Jan Kowalski, Anna" — imię za nią to następna osoba), czy
 * nazwisko w formie zależnej („Według Nowaka Ewa nie przyszła"). Jeden przebieg po tekście,
 * budowany leniwie dopiero wtedy, gdy jest co domykać.
 */
function buildRawWordLinks(raw: string): Map<string, RawWordLink[]> {
  const map = new Map<string, RawWordLink[]>();
  // dosłowne ucieczki JSON „\n/\r/\t" jak odstęp: litera ucieczki nie skleja się z wyrazem
  const src = raw.replace(/\\[nrt]/g, '  ');
  let p1 = '';
  let p1Sep = '';
  let p2 = '';
  let p2Sep = '';
  let p3 = '';
  let lastEnd = -1;
  for (const mm of src.matchAll(RE_RAW_WORD)) {
    const w = mm[0];
    const at = mm.index ?? 0;
    // długi odstęp to i tak nie separator, który domknięcia rozważają
    const sep = lastEnd < 0 || at - lastEnd > 8 ? '\n\n' : src.slice(lastEnd, at);
    if (p1 && RE_CHAR_LU.test(w[0])) {
      let list = map.get(w);
      if (!list) map.set(w, (list = []));
      const next = src.slice(at + w.length, at + w.length + 12);
      if (list.length < 32) list.push({ prev: p1, sep, prev2: p2, sep2: p1Sep, prev3: p3, sep3: p2Sep, next });
    }
    p3 = p2;
    p2Sep = p1Sep;
    p2 = p1;
    p1Sep = sep;
    p1 = w;
    lastEnd = at + w.length;
  }
  return map;
}
/**
 * Para „Imię Nazwisko" w tej samej komórce: imię tuż przed nazwiskiem, które zastąpiła maska. Nie,
 * gdy to imię zamyka poprzedni wpis „Nazwisko Imię" („Świadkowie: Kowalski Jan Nowak Piotr" — tam
 * „Nowak Piotr" to drugi wpis, a „Piotr" należy do niego).
 */
function pairBeforeLink(l: RawWordLink): boolean {
  return (l.pair ??= pairBeforeLinkUncached(l));
}
function pairBeforeLinkUncached(l: RawWordLink): boolean {
  if (l.sep2 !== ' ' || !isFirstNameLike(l.prev2)) return false;
  if (l.sep3 !== ' ' || isFirstNameLike(l.prev3)) return true;
  const w3 = l.prev3.toLowerCase();
  if (TITLE_WORDS.has(w3) || ROLE_WORDS.has(w3)) return true;
  return !surnameBase(l.prev3) && !looksLikeSurname(l.prev3);
}
/**
 * Wpisy z oryginału, które mogą odpowiadać temu wystąpieniu imienia: zgodne z tekstem za nim aż do
 * pierwszej maski, cyfry albo znaku technicznego (te przebiegi już podmieniły). Gdy imię pada
 * w dokumencie kilka razy („Dzieci: Zofia Nowak Antoni" i „Kowalski Antoni Jan"), decyduje wpis
 * z tego miejsca, a nie pierwszy lepszy. Bez dopasowania — wszystkie wpisy (ostrożnie).
 */
function linksAt(all: RawWordLink[], t: string, end: number): RawWordLink[] {
  if (all.length < 2) return all;
  const cur = t.slice(end, end + 12).replace(/\\[\uE009\uE00A\uE00D]/g, '  ');
  const fits = all.filter((l) => {
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (c === '[' || (c >= '0' && c <= '9') || c >= '\uE000') return true;
      if (c !== l.next[i]) return false;
    }
    // koniec tekstu za imieniem: w oryginale też musi być koniec
    return cur.length === 12 || l.next.length <= cur.length;
  });
  return fits.length ? fits : all;
}
/**
 * Czy imię `form` (małymi literami) za maską to INNA osoba niż ta pod maską? Drugie imię stoi tylko
 * za szykiem rekordu „Nazwisko Imię" albo za samym nazwiskiem w mianowniku. Za parą „Imię Nazwisko"
 * to imię następnej osoby albo rzeczownik („Zofia Nowak Antoni", „Jan Kowalski Nadzieja na
 * poprawę"), za nazwiskiem w formie zależnej — podmiot dalszej części zdania („Według Nowaka Ewa nie
 * przyszła"), a imię w formie zależnej za odmiennym nazwiskiem w mianowniku — dopełnienie
 * („Pozwany Zieliński Annie groził", „Świadek Kowalski Annę zna"): w rekordzie imię stoi w tym samym
 * przypadku co nazwisko. Dawniej obie osoby szły pod jedną maskę. Nazwisko bez odmiany w żeńskim
 * („Nowak", „Kowalczyk") zostaje przy imieniu w każdym przypadku: „Wezwać Nowak Annę" to jedna osoba.
 */
function nameAfterMaskIsOtherPerson(links: RawWordLink[], form: string): boolean {
  const nominal = POLISH_FIRST_NAMES.has(form);
  return links.some((l) => {
    if (linkAfterMask(l)) return true;
    if (l.sep !== ' ' || linkPrevIsName(l)) return false;
    if (pairBeforeLink(l)) return true;
    // imię na pewno w mianowniku: „Stanisława", „Aleksandra" bywają dopełniaczem męskiego
    // imienia i wtedy zgadzają się z nazwiskiem („Wniosek Kowalskiego Stanisława")
    if (linkPrevOblique(l)) return nominal && !isFirstNameGenitive(form);
    return !nominal && RE_DECLINED_NOM_SURNAME.test(l.prev);
  });
}
/**
 * Czy w oryginale imię stało już tuż za maską („[..] Ewa", „[OSOBA-A], Anna")? Tak jest przy
 * ponownym przebiegu po wyniku: poprzedni przebieg zostawił imię poza maską, więc drugi też musi
 * (idempotencja). Bez tego „Według [..] Ewa nie przyszła" traciło imię dopiero w drugim przebiegu.
 */
const linkAfterMask = (l: RawWordLink): boolean => l.sep[0] === ']';
// Mianownik nazwiska odmiennego jak przymiotnik („Kowalski", „Zielińska", „Nowicki") — w formie
// zależnej byłoby „Kowalskiego", „Zielińskiej".
const RE_DECLINED_NOM_SURNAME = /(?:sk|ck|dzk)[ia]$/i;
/**
 * Czy przez nową linię nie wolno dołączyć imienia z końca wiersza do maski osoby na początku
 * następnego? Tak, gdy imię domyka wpis listy „Nazwisko Imię" („Sowa Przemysław⏎Pawlak Wiesław"),
 * stoi za maską osoby w swoim wierszu („Dzieci: [..] Antoni⏎…", „[..];Jan⏎…") albo wiersz to
 * „Przymiotnik Imię" („Wielka Nadzieja"). Wciągnięcie sklejało wiersze i przesuwało pola CSV.
 */
function newlineJoinBlocked(t: string, offset: number, end: number, links?: RawWordLink[], name?: string, raw?: string): boolean {
  if (listEntryHead(t, offset, end)) return true;
  // Maska na początku wiersza z dwukropkiem za nią to prefiks mówcy w czacie albo etykieta
  // („… tu Gosia⏎Paweł Król: siema", „Pozdrawiam⏎Anna⏎Jan Kowalski: ok") — imię z końca
  // poprzedniego wiersza to inna osoba, a sklejenie zjadało granicę wypowiedzi. Ale gdy maska
  // zastąpiła SAMO nazwisko („Świadek: Jan⏎Kowalski: nie stawił się", „Barbara⏎Kowalska: hej"),
  // to para złamana zawinięciem wiersza — imię należy do niej, inaczej zostawało jawne obok maski.
  if (/^[ \t]*:/.test(t.slice(end, end + 4)) && !(name && raw && surnameOnlySpeakerAfter(raw, name))) return true;
  const maskBefore = RE_PERSON_MASK_BEFORE.exec(t.slice(Math.max(0, offset - 24), offset));
  // Po przecinku albo średniku blokuje tylko maska samego nazwiska (komórka „Kowalski;Jan⏎Nowak").
  // Gdy przed separatorem stała cała osoba („Świadkowie: Anna Nowak, Jan⏎Kowalski", „Nowak Anna,
  // Jan⏎Kowalski"), imię z końca wiersza zaczyna następną osobę i należy do nazwiska pod nim.
  // Ogniwo musi mieć TEN separator co tekst przed imieniem: „, Jan⏎Wójcik" z innego miejsca pisma
  // nie odblokowuje komórki „Kowalski;Jan⏎Nowak" (sklejało wiersze CSV).
  const sepHere = maskBefore?.[0].slice(maskBefore[0].indexOf(']') + 1).trim();
  if (
    maskBefore &&
    !(
      /[,;|]/.test(maskBefore[0].slice(-4)) &&
      links?.some((l) => /^[ \t]*[,;][ \t]*$/.test(l.sep) && l.sep.trim() === sepHere && (linkPrevIsName(l) || pairBeforeLink(l)))
    )
  )
    return true;
  const adj = RE_ADJ_LINE_HEAD.exec(t.slice(t.lastIndexOf('\n', offset - 1) + 1, offset))?.[1];
  return !!adj && isGeoAdjective(adj);
}
/** Czy w oryginale za imieniem `name` w następnym wierszu stoi samo nazwisko z dwukropkiem
 *  („Jan⏎Kowalski: …")? Wyraz przed dwukropkiem nie może być imieniem („Anna⏎Piotr: …" to dwie osoby). */
function surnameOnlySpeakerAfter(raw: string, name: string): boolean {
  const re = new RegExp(String.raw`(?<!\p{L})${escapeRe(name)}[ \t]*\r?\n[ \t]*(\p{Lu}[\p{L}'’-]*)[ \t]*:`, 'gu');
  for (const mm of raw.matchAll(re)) if (!isFirstNameLike(mm[1]) && (!!surnameBase(mm[1]) || looksLikeSurname(mm[1]))) return true;
  return false;
}
/** Czy komórkę „Nazwisko,Imię" (przecinek bez odstępu) wydziela separator pola inny niż przecinek —
 *  średnik, „|", tabulator, cudzysłów, znacznik? Sam początek i koniec wiersza tego nie rozstrzyga:
 *  w „Nazwisko,Imię⏎Kowalski,Jan" przecinek rozdziela dwie kolumny CSV. */
function cellDelimitedNotByComma(t: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && t[i] === ' ') i--;
  if (i >= 0 && /[;|\t"'„“(<>]/.test(t[i])) return true;
  let j = end;
  while (t[j] === ' ') j++;
  return j < t.length && /[;|\t"'”)<>]/.test(t[j]);
}

const RE_MASK_HYPHEN_TAIL = new RegExp(
  `(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\]|\\[MIEJSCOWOŚĆ\\])-\\r?\\n[ \\t]*([${PL_LO}]{2,14}|[${PL_UP}]{2,14})(?![${PL_UP}${PL_LO}0-9-])`,
  'g',
);
const RE_ADMIN_UNIT_WORD =
  /^(?:powiat\p{Ll}*|gmin\p{Ll}*|gm|woj|województw\p{Ll}*|wieś|wsi|miasto|miasta|poczta|osiedle|sołectwo|obręb|dzielnica|kod|ul|ulica|tel|kraj)$/u;
// Wyrazy przeniesione do następnego wiersza w oryginale: ogon (małymi literami) → początki sprzed
// łącznika. Maska zastąpiła już początek w `text`, więc o całym wyrazie rozstrzyga oryginał.
const RE_RAW_HYPHEN_SPLIT = new RegExp(
  `([${PL_UP}${PL_LO}]+)-\\r?\\n[ \\t]*([${PL_LO}]{2,14}|[${PL_UP}]{2,14})(?![${PL_UP}${PL_LO}0-9-])`,
  'g',
);
function rawHyphenHeads(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of raw.matchAll(RE_RAW_HYPHEN_SPLIT)) {
    const k = r[2].toLowerCase();
    const list = out.get(k);
    if (list) list.push(r[1].toLowerCase());
    else out.set(k, [r[1].toLowerCase()]);
  }
  return out;
}
export function finalizePersons(ctx: RedactCtx): void {
  let links: Map<string, RawWordLink[]> | undefined;
  const rawLinks = (w: string): RawWordLink[] => (links ??= buildRawWordLinks(ctx.raw)).get(w) ?? [];
  // DOMKNIĘCIE W PRAWO, przed domknięciem w lewo: imię za maską w zapisie „Nazwisko Imię" („Kowalska
  // Anna Maria, PESEL …" → dawniej „[..] Maria", „Pozwany Kowalski Jan Paweł" → „Pozwany [..] Jan
  // Paweł"). Tylko przez spację: tabulator zaczyna kolumnę, a nowa linia następny wpis listy.
  // Kolejność ma znaczenie: osierocone imię na końcu wiersza domknięcie w lewo wciągało do maski
  // z NASTĘPNEGO wiersza i lista „Kowalska Anna Maria⏎Nowak Jan Piotr" sklejała się w jeden wiersz.
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(RE_MASK_THEN_NAME, (m, mask: string, w: string, offset: number, t: string) => {
      const wl = w.toLowerCase();
      if (!isFirstNameLike(w) || LEGAL_ENTITY_WORDS.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      // za imieniem zaczyna się inna nazwa własna: „[..] Lech Poznań" (klub), „[..] Jana Pawła II 5"
      // (ulica w adresie) — imię należy do niej, nie do osoby przed nim
      const after = t.slice(offset + m.length, offset + m.length + 40);
      const next = RE_NEXT_CAP_WORD_SP.exec(after)?.[1];
      if (next && !isFirstNameLike(next)) return m;
      // imię przed kolejną maską należy do NASTĘPNEJ osoby („[..]   Anna [..]" — kolumny
      // wyrównane spacjami); to rozstrzyga domknięcie w lewo i zachowuje odstępy
      if (RE_PERSON_MASK_AT_START.test(after.replace(/^ +/, ''))) return m;
      // „Maja" przed liczbą to miesiąc („… Maja 2024 r."), nie drugie imię
      if (wl === 'maja' && /^[ \t]+\d/.test(after)) return m;
      if (nameAfterMaskIsOtherPerson(linksAt(rawLinks(w), t, offset + m.length), wl)) return m;
      return mask;
    });
  }
  // DOMKNIĘCIE W PRAWO PRZEZ PRZECINEK, tylko w rekordzie: maska otwiera komórkę, a imię w mianowniku
  // ją zamyka („"[..], Jan","[PESEL]"", „<osoba>[..], Jan</osoba>", „Odbiorca: [..], Jan Maria").
  // W prozie („Rozmawiałem z [..], Marek też był", „Byli tam [..], Jan i Anna") to dwie osoby.
  // Tylko maska z SAMEGO nazwiska: za parą „Imię Nazwisko" imię po przecinku to następna osoba
  // („Rodzice: Jan Kowalski, Anna", „DW: Marek Zieliński, Ewa (sekretariat)"). Przecinek bez odstępu
  // tylko w komórce wydzielonej innym separatorem („Kowalski,Jan;85031412347"): sam wiersz
  // „Kowalski,Jan" to dwie kolumny CSV, a domknięcie zjadało kolumnę imienia.
  ctx.text = ctx.text.replace(RE_MASK_COMMA_NAME, (m, mask: string, a: string, b: string | undefined, offset: number, t: string) => {
    if (!POLISH_FIRST_NAMES.has(a.toLowerCase()) || (b && !POLISH_FIRST_NAMES.has(b.toLowerCase()))) return m;
    if (institutionLabelBefore(t, offset)) return m;
    if (!cellStartsBefore(t, offset) || !cellEndsAt(t, offset + m.length)) return m;
    if (!/[ \t]/.test(m[mask.length + 1] ?? '') && !cellDelimitedNotByComma(t, offset, offset + m.length)) return m;
    const commaLinks = linksAt(rawLinks(a), t, offset + m.indexOf(a, mask.length) + a.length);
    if (commaLinks.some((l) => linkAfterMask(l) || (l.sep[0] === ',' && (linkPrevIsName(l) || pairBeforeLink(l))))) return m;
    return mask;
  });
  // DOMKNIĘCIE: imię słownikowe tuż przed zamaskowaną osobą (spacja/_/-/JEDNA nowa linia) → do maski.
  // Nowa linia obejmuje „Jan\nWiśniewski" (imię na końcu wiersza, potwierdzone nazwisko w następnym) —
  // gate `isFirstNameLike` chroni („protokół\n[OSOBA]" zostaje). Dwa przebiegi: wciągnięcie jednego
  // imienia może odsłonić kolejne.
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(
      // separator: spacja/⇥/_/-/JEDNA nowa linia albo dosłowna ucieczka „\t" (JSON) — jak prawdziwy ⇥.
      // Także kropka BEZ odstępu („Konto Jan.Kowalski", „C:\Users\Jan.Kowalski"): login i katalog
      // profilu sklejają imię z nazwiskiem, a imię zostawało jawne przed maską. Kropka ze spacją
      // („z Janem. [OSOBA]") kończy zdanie i nie pasuje.
      new RegExp(`(?<![${NM_BOUND}])([${PL_UP}][${PL_LO}]+)([ \\t\\n_.-]|\\\\\\uE009)(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
      (m, w: string, sep: string, mask: string, offset: number, t: string) => {
        // forma imienia, która jest też słowem pospolitym („od Marka [..]", „od Ani [..]"), tylko
        // przez spację tuż przed maską; „Ani" dodatkowo w środku zdania (przed nim mały wyraz)
        const wl = w.toLowerCase();
        const colliding =
          COLLIDING_NAME_FORMS.has(wl) && sep === ' ' && (wl !== 'ani' || /\p{Ll}[ \t]+$/u.test(t.slice(Math.max(0, offset - 3), offset)));
        if (!colliding && !isFirstNameLike(w)) return m;
        // Kropka bez odstępu bywa też końcem zdania bez spacji (OCR, czat): „z Janem.Kowalski
        // odpisał" to dwie osoby. Login i katalog profilu mają imię w mianowniku („Jan.Kowalski").
        if (sep === '.' && !POLISH_FIRST_NAMES.has(w.toLowerCase())) return m;
        // patron w dopełniaczu tuż przed osobą („W kościele św. Anny [OSOBA] zagra", „parafii św.
        // Józefa [OSOBA]") — imię świętego nie należy do osoby za nim
        if (isFirstNameGenitive(wl) && precededByPatron(t, offset)) return m;
        // imię świętego („Order Świętego Jerzego [..]", „Krzyż Świętego Jerzego [..]")
        const pre = t.slice(Math.max(0, offset - 24), offset);
        if (RE_SAINT_WORD_BEFORE.test(pre)) return m;
        // Imię domykające wpis listy albo stojące za maską w swoim wierszu nie przechodzi do osoby
        // z następnego wiersza (sam wpis maskuje passListEntries niżej).
        if (sep === '\n' && newlineJoinBlocked(t, offset, offset + m.length, linksAt(rawLinks(w), t, offset + w.length), w, ctx.raw)) return m;
        // imię w sąsiedniej komórce TSV: własna maska, kolumna zostaje (patrz maskCells)
        return sep === '\t' ? `${mask}\t${mask}` : mask;
      },
    );
  }
  // DOMKNIĘCIE: imię doklejone ZA maską kropką albo podkreśleniem („folder Kowalski_Jan",
  // „Kowalski.Jan") — szyk „Nazwisko_Imię" w nazwach katalogów i kont. Bez odstępu i bez łącznika:
  // spację obsługuje (a3) z walidacją nazwiska, a łącznik należy do nazwiska dwuczłonowego.
  // Przy kropce, jak w lewo, imię tylko w mianowniku i maska tylko z nazwiska w mianowniku: „z
  // Kowalskim.Marek potwierdził" i „Jan Kowalski.Marek" to koniec zdania bez spacji i druga osoba.
  ctx.text = ctx.text.replace(RE_MASK_GLUED_NAME, (m, mask: string, w: string, offset: number, t: string) => {
    if (!isFirstNameLike(w)) return m;
    if (m[mask.length] === '.') {
      if (!POLISH_FIRST_NAMES.has(w.toLowerCase())) return m;
      const glued = linksAt(rawLinks(w), t, offset + m.length);
      if (glued.some((l) => linkAfterMask(l) || (l.sep === '.' && (linkPrevOblique(l) || linkPrevIsName(l) || pairBeforeLink(l))))) return m;
    }
    return mask;
  });
  // PRZENIESIENIE WYRAZU za maską („z powództwa Barbary Wojciechow-⏎skiej", „JAN KOWAL-⏎SKI",
  // „02-511 Warsza-⏎wa"): przebieg złapał początek nazwiska albo miasta, a ogon w następnym wierszu
  // zostawał jawny. Myślnik doklejony do maski i ciąg samych małych (albo samych wielkich) liter na
  // początku wiersza to druga część tego samego wyrazu. Miasto tylko z ogonem małymi literami.
  // Myślnik na końcu wiersza bywa też pauzą przed funkcją albo dalszym zdaniem („Jan Kowalski-⏎
  // kierownik", „Adam Mazur-⏎następnie go wycofał"): ogon doklejamy więc tylko wtedy, gdy początek
  // sprzed łącznika (z oryginału) razem z ogonem daje nazwisko albo miasto, a sam początek nie jest
  // już pełnym nazwiskiem czy miastem ze słownika.
  if (ctx.text.includes('-\n') || ctx.text.includes('-\r\n')) {
    let heads: Map<string, string[]> | undefined;
    ctx.text = ctx.text.replace(RE_MASK_HYPHEN_TAIL, (m, mask: string, tail: string) => {
      if (mask === '[MIEJSCOWOŚĆ]' && tail !== tail.toLowerCase()) return m;
      const lo = tail.toLowerCase();
      const ok = ((heads ??= rawHyphenHeads(ctx.raw)).get(lo) ?? []).some((h) => {
        const joined = h + lo;
        // Etykieta jednostki w następnym wierszu („Halinów-⏎powiat miński", „Zagnańsk-⏎gmina
        // Zagnańsk") to nie ogon nazwy: miasto spoza słownika przyjmowało każdy ogon i maska
        // zjadała nową linię razem z „powiat".
        if (mask === '[MIEJSCOWOŚĆ]') return POLISH_CITIES.has(joined) || (!POLISH_CITIES.has(h) && !RE_ADMIN_UNIT_WORD.test(lo));
        return !!surnameBase(joined) || (looksLikeSurname(joined) && !surnameBase(h));
      });
      return ok ? mask : m;
    });
  }
  // DOMKNIĘCIE OCR: imię z homoglifem tuż przed maską („J0anna [..]", „KaroI [..]", „Kami1 [..]",
  // „J0ANNA [..]"). Nazwisko maskował przebieg słownikowy albo OCR, a imię z zerem czy wielkim „I"
  // nie przechodziło bramki słownika i zostawało jawne. Słowo co najmniej 4-znakowe (kody „A1a",
  // „O1a" odpadają), normalizacja 0→o, I→l (tylko obok małych liter), 1→l albo 1→i („Mar1a").
  // Najpierw w prawo, na końcu wiersza („Nowak KaroI⏎Jan Kowalski" → „[..]⏎[..]"), potem w lewo ze
  // strażnikami nowej linii jak wyżej: dawniej imię z końca wiersza szło do maski osoby
  // z NASTĘPNEGO wiersza i lista się sklejała („[..] [..]", imię pod pseudonimem innej osoby).
  ctx.text = ctx.text.replace(RE_MASK_THEN_OCR_NAME, (m, mask: string, w: string, offset: number, t: string) => {
    const form = ocrFirstNameForm(w);
    if (!form) return m;
    const key = /^\p{L}+/u.exec(w)?.[0] ?? w;
    return nameAfterMaskIsOtherPerson(linksAt(rawLinks(key), t, offset + m.length), form) ? m : mask;
  });
  ctx.text = ctx.text.replace(RE_OCR_NAME_BEFORE_MASK, (m, w: string, sep: string, mask: string, offset: number, t: string) => {
    if (!ocrFirstNameLike(w)) return m;
    if (sep === '\n' && newlineJoinBlocked(t, offset, offset + m.length)) return m;
    return mask;
  });
  passListEntries(ctx);
  // DOMKNIĘCIE: inicjał imienia tuż przed zamaskowaną osobą („mec. J. [OSOBA-B]") wciąga do maski.
  ctx.text = ctx.text.replace(
    new RegExp(`${INITIAL_START}[${PL_UP}]\\.[ \\t]*(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
    (m, mask: string, offset: number, t: string) => {
      // na początku wiersza (po samych odstępach) to punkt wyliczenia („A. Jan Kowalski zeznał");
      // dosłowna ucieczka „\n" w JSON-ie też zaczyna wiersz (znak PUA z passProtectJsonEscapes)
      let i = offset - 1;
      while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
      if (i < 0 || t[i] === '\n' || ((t[i] === '\uE00A' || t[i] === '\uE00D') && t[i - 1] === '\\')) return m;
      // „Sp. J." / „Sp. K." — człon formy prawnej spółki (jawna, komandytowa), nie inicjał
      if (/(?<!\p{L})[Ss][Pp]\.$/u.test(t.slice(Math.max(0, i - 3), i + 1))) return m;
      if (isHonorificP(t, offset)) return m; // „Sz. P. [OSOBA-A]" — „P." to „Pan"
      return mask;
    },
  );
  // „[OSOBA-A] Z D. [OSOBA-B]" — skrót „z domu" przed nazwiskiem panieńskim (znacznik z
  // passPersonMaidenAfterMask) wraca dopiero po domknięciu inicjałów, żeby nie poszedł do maski.
  if (ctx.text.includes(MAIDEN_D_SENTINEL)) ctx.text = ctx.text.split(MAIDEN_D_SENTINEL).join('D');
  // DOMKNIĘCIE: łańcuch inicjałów przed maską („J.K. [OSOBA-A]" → cała maska, „Dr.J. […]" → „Dr.[…]").
  // Skróty (P.S., S.A., P.H.U., W.P.) zostają przed maską — rozstrzyga dotChainKind.
  ctx.text = ctx.text.replace(
    new RegExp(`${DOT_CHAIN}[ \\t]*(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])`, 'g'),
    (m, head: string, ini: string, mask: string) => {
      const kind = dotChainKind(head, ini);
      if (kind === 'absorb') return mask;
      if (kind === 'keepTitle') return `${head}${mask}`;
      return m;
    },
  );
  // DOMKNIĘCIE: cząstka obcego nazwiska wieloczłonowego po masce osoby („[OSOBA-F] Van Anh").
  ctx.text = ctx.text.replace(
    /(\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])[ \t]+(?:[Vv][ao]n|[Dd]e[rl]|[Dd]ella|[Bb]in|[Tt]er|D[aei]|De[rl]?|El|Al|L[ae])[ \t]+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+/g,
    '$1',
  );
  // STABILNA NUMERACJA: etykiety osób wg kolejności PIERWSZEGO wystąpienia w tekście.
  {
    const seen: string[] = [];
    for (const mm of ctx.text.matchAll(/\[OSOBA-([A-Z]+)\]/g)) {
      if (!seen.includes(mm[1])) seen.push(mm[1]);
    }
    const remap = new Map(seen.map((l, i) => [l, indexToLetters(i)]));
    ctx.text = ctx.text.replace(/\[OSOBA-([A-Z]+)\]/g, (_m, l: string) => `[OSOBA-${remap.get(l)}]`);
  }
  // PRZYWRÓCENIE chronionych URL-i (PII wewnątrz nich zamaskowano w passProtectUrls).
  if (ctx.protectedUrls.length) {
    ctx.text = ctx.text.replace(RE_URL_SENTINEL, (mm, letters: string) => ctx.protectedUrls[lettersToIndex(letters)] ?? mm);
  }
}

// PRZYWRÓCENIE ucieczek „\n/\r/\t" (passProtectJsonEscapes) — PO przywróceniu URL-i, bo zapamiętane
// adresy też mogą je zawierać. Znak PUA bez backslasha (gdyby maska zjadła backslash) też wraca
// jako pełna ucieczka — wartość JSON-a ma zostać poprawnym łańcuchem.
export function passRestoreJsonEscapes(ctx: RedactCtx): void {
  if (!ctx.jsonEscapes) return;
  ctx.text = ctx.text.replace(/\\?([\uE009\uE00A\uE00D])/g, (_m, c: string) => `\\${JSON_ESC_FROM_PUA[c]}`);
}

/** Czy tekst to dokument JSON: obiekt/tablica w całości albo NDJSON (każdy niepusty wiersz osobno). */
function isJsonDocument(s: string): boolean {
  const parses = (t: string): boolean => {
    if (!/^[[{]/.test(t)) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  };
  const t = s.trim();
  if (!/^[[{]/.test(t)) return false; // szybkie odcięcie prozy, zanim cokolwiek parsujemy
  if (parses(t)) return true;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 && lines.every(parses);
}

// FAZA 5b · JSON: maska w miejscu LICZBY. Wartość liczbową („"telefon": 512345678", „"pesel":
// 85031412347", tablica numerów) maskują przebiegi cyfrowe z FAZY 2, które nie znają składni —
// goły placeholder „[TELEFON]" to nie wartość JSON i wynik przestawał się parsować. Tu ujmujemy
// w cudzysłowy maski stojące POZA literałami łańcuchowymi. Bramka DOKUMENTOWA na oryginale: musi
// być poprawnym JSON-em albo NDJSON-em — proza nigdy się nie parsuje, więc „Pole "Telefon":
// 512 345 678" czy „Lista: [601234567]" zostają bez zmian. Wykrywanie się nie zmienia (liczby pod
// dowolnym kluczem dalej są maskowane — inaczej „"id": 85031412347" wyciekałby jako PESEL).
export function passJsonRequote(ctx: RedactCtx): void {
  if (ctx.text === ctx.raw || !isJsonDocument(ctx.raw)) return;
  const masks = [...new Set(Object.values(ctx.M))].sort((a, b) => b.length - a.length).map(escapeRe);
  // Literał łańcuchowy (z ucieczkami) pochłaniany w całości i oddawany bez zmian; maska poza nim
  // dostaje cudzysłowy. JSON.stringify — na wypadek własnej maski z cudzysłowem albo backslashem.
  const re = new RegExp(`"(?:[^"\\\\\\n]|\\\\.)*"|(${[...masks, '\\[OSOBA-[A-Z]+\\]'].join('|')})`, 'g');
  ctx.text = ctx.text.replace(re, (m, mask: string | undefined) => (mask ? JSON.stringify(mask) : m));
}
