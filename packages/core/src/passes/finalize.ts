// Ostatnia faza: domknięcia masek osób (imię, inicjał, ogon przeniesienia), stabilna numeracja
// etykiet, przywrócenie URL-i i ucieczek JSON oraz cudzysłowy wokół masek w dokumencie JSON.
import { HOMOGRAPH_SURNAMES, isGeoAdjective, looksLikeSurname, NON_SURNAME_ADJ, surnameBase, surnameShaped } from '../surnames.js';
import { CAP_WORD, ESC_WS, escapeRe, JSON_ESC_PUA, LIST_BULLET, NM_BOUND, personMaskSrc, PL_LO, PL_UP, RE_CHAR_LU } from '../charset.js';
import { indexToLetters, JSON_ESC_FROM_PUA, lettersToIndex, perMasks, RE_URL_SENTINEL, type RedactCtx } from '../context.js';
import { COLLIDING_NAME_FORMS, isFirstNameGenitive, isFirstNameLike, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { isObliqueSurnameForm, precededByPatron } from '../guards/eponyms.js';
import { cellEndsAt, cellStartsBefore, DOT_CHAIN, dotChainKind, INITIAL_START, institutionLabelBefore, isHonorificP, LIST_HEAD_NOT_SURNAME, rePersonMaskBefore, RE_SAINT_WORD_BEFORE } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { MAIDEN_D_SENTINEL } from './person-caps-ocr.js';
import { RE_DECLINED_NOM_SURNAME, RE_NEXT_CAP_WORD_SP } from '../person-patterns.js';

// Długość kontekstu za wyrazem w RawWordLink.next; linksAt porównuje dokładnie tyle znaków.
const LINK_CTX_LEN = 12;

// Początek wpisu listy lub tabeli przed imieniem kończącym wiersz: wiersz albo komórka (po ; | ⇥ , :),
// opcjonalny punktor, jeden wyraz z wielkiej litery i odstęp lub separator komórki.
const RE_LIST_ENTRY_HEAD = new RegExp(`(?:^|[;|\\t,:][ \\t]*)${LIST_BULLET}(${CAP_WORD})([ \\t]*[;|\\t,][ \\t]*|[ \\t]+)$`);
// Dalszy ciąg zdania za maską w następnym wierszu („…\nKowalski złożył").
const RE_PROSE_TAIL = new RegExp(`^(?:[ \\t]+[${PL_LO}]|[.!?…])`);
/**
 * Czy wyraz otwierający wiersz to nazwisko wpisu „Nazwisko Imię"? Wymaga dowodu: słownik, końcówka
 * nazwiskowa albo homograf. Sam brak imienia i roli nie wystarcza, bo czasowniki podpisu, przyimki
 * i funkcje spoza ROLE_WORDS („Sporządził Jan\nKowalski") nie są nazwiskiem.
 */
function isListEntrySurname(word: string): boolean {
  if (isFirstNameLike(word)) return false;
  return word.split('-').some((part) => {
    const w = part.toLowerCase();
    if (TITLE_WORDS.has(w) || ROLE_WORDS.has(w) || LIST_HEAD_NOT_SURNAME.has(w)) return false;
    if (LEGAL_ENTITY_WORDS.has(w) || NON_SURNAME_ADJ.has(w)) return false;
    return surnameShaped(w) || HOMOGRAPH_SURNAMES.has(w);
  });
}
/**
 * Czy imię `t[start, …)` na końcu wiersza domyka wpis listy w szyku „Nazwisko Imię" („1. Sowa
 * Przemysław")? Wtedy maska w następnym wierszu to inna osoba i wciągnięcie imienia skleiłoby
 * wiersze. Łamanie prozy („Starosta Jan\nWiśniewski przeprowadził") nadal domyka osobę. Wiersz
 * dłuższy niż 80 znaków przed imieniem to proza (to też ogranicza skan wstecz).
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
 * Przymiotnik odmiejscowy na -ski/-ska bywa nazwiskiem („Mazowiecka Anna" w liście świadków). Nie,
 * gdy imię jest też rzeczownikiem („Wielka Nadzieja" to nazwa).
 */
function geoSurnameBeforeName(word: string, t: string, start: number): boolean {
  if (!/(?:sk|ck|dzk)[ia]$/.test(word) || !isGeoAdjective(word)) return false;
  const name = /^\p{L}+/u.exec(t.slice(start, start + 30))?.[0]?.toLowerCase() ?? '';
  return POLISH_FIRST_NAMES.has(name) && !NOUN_LIKE_FIRST_NAMES.has(name);
}
const OCR_NAME_WORD = `[${PL_UP}](?:[${PL_LO}]*[I01][${PL_LO}I01]*|[${PL_UP}]*[01][${PL_UP}01]*)`;
/** Znaki za ostatnią literą maski („]" w „[IMIĘ I NAZWISKO]"); pusty, gdy maska kończy się literą. */
const tailAfterLastLetter = (mask: string): string => mask.slice(mask.search(/\p{L}[^\p{L}]*$/u) + 1);
// Domknięcia czytają maskę osoby (i miejscowości) w tekście, więc wzorce zależą od masek.
const finalizeRe = perMasks((M) => {
  const PM = personMaskSrc(M.IMIE);
  const all = Object.values(M).filter(Boolean);
  return {
    personAtStart: new RegExp(`^(?:${PM})`),
    // maska osoby przed wyrazem i okno, w którym jej szukać (maska i separator)
    personBefore: rePersonMaskBefore(M),
    personBeforeWindow: Math.max(24, M.IMIE.length + 7),
    // W prawo tylko przez jedną spację: kilka spacji to zwykle wyrównanie kolumn, a wyraz za nimi
    // należy do następnej.
    maskThenName: new RegExp(`(${PM}) ([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}-])`, 'g'),
    maskCommaName: new RegExp(`(${PM}),[ \\t]*([${PL_UP}][${PL_LO}]+)(?:[ \\t]+([${PL_UP}][${PL_LO}]+))?(?![${NM_BOUND}-])`, 'g'),
    maskGluedName: new RegExp(`(${PM})[._]([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}])`, 'g'),
    // Kropka bez odstępu („Jan.Kowalski", „C:\Users\Jan.Kowalski") skleja imię z nazwiskiem w loginie
    // i katalogu profilu; kropka ze spacją kończy zdanie i nie pasuje. Ucieczka „\t" z JSON-a jak ⇥.
    nameBeforeMask: new RegExp(`(?<![${NM_BOUND}])([${PL_UP}][${PL_LO}]+)([ \\t\\n_.-]|\\\\\\uE009)(${PM})`, 'g'),
    initialBeforeMask: new RegExp(`${INITIAL_START}[${PL_UP}]\\.[ \\t]*(${PM})`, 'g'),
    dotChainBeforeMask: new RegExp(`${DOT_CHAIN}[ \\t]*(${PM})`, 'g'),
    maskForeignParticle: new RegExp(
      `(${PM})[ \\t]+(?:[Vv][ao]n|[Dd]e[rl]|[Dd]ella|[Bb]in|[Tt]er|D[aei]|De[rl]?|El|Al|L[ae])[ \\t]+[${PL_UP}][${PL_LO}]+`,
      'g',
    ),
    ocrNameBeforeMask: new RegExp(`(?<![${PL_UP}${PL_LO}0-9])(${OCR_NAME_WORD})([ \\t\\n_-])(${PM})`, 'g'),
    // Imię z homoglifem za maską na końcu wiersza („[..] KaroI⏎"): rekord „Nazwisko Imię" po OCR.
    maskThenOcrName: new RegExp(`(${PM}) (${OCR_NAME_WORD})(?=[ \\t]*(?:\\r?\\n|$))`, 'g'),
    hyphenTail: new RegExp(
      `(${PM}|${escapeRe(M.MIEJSCOWOSC)})-\\r?\\n[ \\t]*([${PL_LO}]{2,14}|[${PL_UP}]{2,14})(?![${PL_UP}${PL_LO}0-9-])`,
      'g',
    ),
    // pierwsze znaki masek (linksAt) i znaki za ostatnią literą maski (linkAfterMask)
    maskHeads: new Set(['[', ...all.map((m) => m[0])]),
    maskTails: [...new Set([']', ...all.map(tailAfterLastLetter).filter(Boolean)])],
  };
});
type FinalizeRe = ReturnType<typeof finalizeRe>;
const RE_HAS_PL_LO = new RegExp(`[${PL_LO}]`);
/** Imię ze słownika (małymi literami), którym jest wyraz z homoglifem OCR (0, 1, „I" zamiast „l"), albo null. */
function ocrFirstNameForm(w: string): string | null {
  if (w.length < 4) return null;
  const tail = w.slice(1);
  const titlecase = RE_HAS_PL_LO.test(tail);
  const variant = (one: string): string =>
    (w[0] + (titlecase ? tail.replace(/I/g, 'l') : tail).replace(/0/g, 'o').replace(/1/g, one)).toLowerCase();
  const l = variant('l');
  if (isFirstNameLike(l)) return l;
  const i = variant('i');
  return isFirstNameLike(i) ? i : null;
}
const RE_ADJ_LINE_HEAD = new RegExp(`^[ \\t]*${LIST_BULLET}(${CAP_WORD})[ \\t]+$`);
const RE_FIRST_NAME_AT_END = new RegExp(`(?<![${PL_UP}${PL_LO}])[${PL_UP}][${PL_LO}]+$`);
/**
 * Wpis listy „Nazwisko Imię" nad maską osoby („Sowa Przemysław\n[OSOBA]") to osobna osoba, a homograf
 * w szyku odwróconym (Sowa, Wilk, Kowal) nie ma innej kotwicy. Od dołu: zamaskowany wpis staje się
 * kotwicą wiersza nad nim, więc cała lista maskuje się w jednym przebiegu (idempotentnie). Komórki
 * CSV/TSV („Sowa;Przemysław") dostają osobne maski tej samej osoby, żeby kolumny się nie przesuwały.
 */
function passListEntries(ctx: RedactCtx): void {
  if (!ctx.text.includes('\n')) return;
  const { personAtStart } = finalizeRe(ctx.M);
  const lines = ctx.text.split('\n');
  let changed = false;
  for (let i = lines.length - 2; i >= 0; i--) {
    const next = lines[i + 1];
    const mm = personAtStart.exec(next);
    if (!mm || RE_PROSE_TAIL.test(next.slice(mm[0].length, mm[0].length + 40))) continue;
    const line = lines[i];
    const nm = RE_FIRST_NAME_AT_END.exec(line);
    if (!nm || !isFirstNameLike(nm[0])) continue;
    // prozę za maską sprawdza warunek wyżej na wierszu i+1, więc koniec „tekstu" to koniec wiersza
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
  /** Kilka znaków oryginału za wyrazem, do dopasowania wystąpienia, gdy imię się powtarza. */
  next: string;
  /** Czy separator zaczyna się od końcówki maski (patrz linkAfterMask). */
  afterMask: boolean;
  // oceny liczone raz na wpis, bo ten sam wpis sprawdza każde wystąpienie imienia
  prevName?: boolean;
  prevOblique?: boolean;
  pair?: boolean;
}
const linkPrevIsName = (l: RawWordLink): boolean => (l.prevName ??= isFirstNameLike(l.prev));
const linkPrevOblique = (l: RawWordLink): boolean => (l.prevOblique ??= isObliqueSurnameForm(l.prev));
/**
 * Czy w oryginale imię stało już tuż za maską („[OSOBA-A], Anna")? Tak jest przy ponownym przebiegu
 * po wyniku: skoro poprzedni zostawił imię poza maską, ten też musi (idempotencja).
 */
const linkAfterMask = (l: RawWordLink): boolean => l.afterMask;
/**
 * Para „Imię Nazwisko" w tej samej komórce: imię tuż przed nazwiskiem pod maską. Nie, gdy to imię
 * zamyka poprzedni wpis „Nazwisko Imię" („Kowalski Jan Nowak Piotr": „Piotr" należy do Nowaka).
 */
function pairBeforeLink(l: RawWordLink): boolean {
  if (l.pair === undefined) {
    const w3 = l.prev3.toLowerCase();
    l.pair =
      l.sep2 === ' ' &&
      isFirstNameLike(l.prev2) &&
      (l.sep3 !== ' ' ||
        isFirstNameLike(l.prev3) ||
        TITLE_WORDS.has(w3) ||
        ROLE_WORDS.has(w3) ||
        (!surnameBase(l.prev3) && !looksLikeSurname(l.prev3)));
  }
  return l.pair;
}
const RE_RAW_WORD = /\p{L}+/gu;
/**
 * Wyrazy z wielkiej litery oryginalnego wejścia z trzema poprzednimi wyrazami i separatorami.
 * Domknięcia w prawo widzą już tylko maskę i nie wiedzą, czy zastąpiła samo nazwisko („Kowalski Jan
 * Paweł"), parę „Imię Nazwisko" („Zofia Nowak Antoni") czy nazwisko w formie zależnej („Według
 * Nowaka Ewa nie przyszła"). Budowane leniwie, dopiero gdy jest co domykać.
 */
function buildRawWordLinks(raw: string, maskTails: string[]): Map<string, RawWordLink[]> {
  const map = new Map<string, RawWordLink[]>();
  // dosłowne ucieczki JSON „\n/\r/\t" jak odstęp, żeby litera ucieczki nie skleiła się z wyrazem
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
    // długi odstęp i tak nie jest separatorem, który domknięcia rozważają
    const sep = lastEnd < 0 || at - lastEnd > 8 ? '\n\n' : src.slice(lastEnd, at);
    if (p1 && RE_CHAR_LU.test(w[0])) {
      let list = map.get(w);
      if (!list) map.set(w, (list = []));
      const next = src.slice(at + w.length, at + w.length + LINK_CTX_LEN);
      const afterMask = maskTails.some((x) => sep.startsWith(x));
      if (list.length < 32) list.push({ prev: p1, sep, prev2: p2, sep2: p1Sep, prev3: p3, sep3: p2Sep, next, afterMask });
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
const RE_ESC_WS_G = new RegExp(ESC_WS, 'g');
/**
 * Wpisy z oryginału zgodne z tekstem za tym wystąpieniem imienia aż do pierwszej maski, cyfry albo
 * znaku technicznego (te już podmieniono). Gdy imię pada kilka razy, decyduje wpis z tego miejsca.
 * Bez dopasowania zwraca wszystkie wpisy (ostrożnie).
 */
function linksAt(all: RawWordLink[], t: string, end: number, maskHeads: Set<string>): RawWordLink[] {
  if (all.length < 2) return all;
  const cur = t.slice(end, end + LINK_CTX_LEN).replace(RE_ESC_WS_G, '  ');
  const fits = all.filter((l) => {
    for (let i = 0; i < cur.length; i++) {
      const c = cur[i];
      if (maskHeads.has(c) || (c >= '0' && c <= '9') || c >= '\uE000') return true;
      if (c !== l.next[i]) return false;
    }
    // koniec tekstu za imieniem: w oryginale też musi być koniec
    return cur.length === LINK_CTX_LEN || l.next.length <= cur.length;
  });
  return fits.length ? fits : all;
}
/**
 * Czy imię `form` (małymi literami) za maską to inna osoba? Drugie imię stoi tylko za rekordem
 * „Nazwisko Imię" albo za samym nazwiskiem w mianowniku. Za parą „Imię Nazwisko" to następna osoba
 * („Zofia Nowak Antoni"), za nazwiskiem w formie zależnej podmiot zdania („Według Nowaka Ewa"),
 * a imię w formie zależnej za odmiennym nazwiskiem w mianowniku to dopełnienie („Świadek Kowalski
 * Annę zna"). Nieodmienne nazwisko żeńskie zostaje przy imieniu: „Wezwać Nowak Annę" to jedna osoba.
 */
function nameAfterMaskIsOtherPerson(links: RawWordLink[], form: string): boolean {
  const nominal = POLISH_FIRST_NAMES.has(form);
  return links.some((l) => {
    if (linkAfterMask(l)) return true;
    if (l.sep !== ' ' || linkPrevIsName(l)) return false;
    if (pairBeforeLink(l)) return true;
    // „Stanisława", „Aleksandra" bywają dopełniaczem męskiego imienia i wtedy zgadzają się
    // z nazwiskiem („Wniosek Kowalskiego Stanisława")
    if (linkPrevOblique(l)) return nominal && !isFirstNameGenitive(form);
    return !nominal && RE_DECLINED_NOM_SURNAME.test(l.prev);
  });
}
/**
 * Czy przez nową linię nie wolno dołączyć imienia z końca wiersza do maski na początku następnego?
 * Tak, gdy imię domyka wpis listy („Sowa Przemysław⏎Pawlak Wiesław"), stoi za maską w swoim wierszu
 * („[..];Jan⏎…") albo wiersz to „Przymiotnik Imię" („Wielka Nadzieja"). Inaczej wiersze i pola CSV
 * by się skleiły.
 */
function newlineJoinBlocked(fr: FinalizeRe, t: string, offset: number, end: number, links?: RawWordLink[], name?: string, raw?: string): boolean {
  if (listEntryHead(t, offset, end)) return true;
  // Maska z dwukropkiem na początku wiersza to prefiks mówcy w czacie („… tu Gosia⏎Paweł Król: siema"),
  // więc imię wyżej to inna osoba. Wyjątek: maska zastąpiła samo nazwisko („Jan⏎Kowalski: nie
  // stawił się"), czyli para złamana zawinięciem wiersza.
  if (/^[ \t]*:/.test(t.slice(end, end + 4)) && !(name && raw && surnameOnlySpeakerAfter(raw, name))) return true;
  const maskBefore = fr.personBefore.exec(t.slice(Math.max(0, offset - fr.personBeforeWindow), offset));
  // Po przecinku albo średniku blokuje tylko maska samego nazwiska („Kowalski;Jan⏎Nowak"). Za całą
  // osobą („Anna Nowak, Jan⏎Kowalski") imię zaczyna następną. Ogniwo musi mieć ten sam separator,
  // żeby „, Jan⏎Wójcik" z innego miejsca nie odblokował komórki CSV.
  const sepHere = maskBefore?.[1].trim();
  if (
    maskBefore &&
    !(
      /[,;|]/.test(maskBefore[1].slice(-4)) &&
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
/** Czy komórkę „Nazwisko,Imię" wydziela separator inny niż przecinek (średnik, „|", ⇥, cudzysłów,
 *  znacznik)? W samym wierszu „Nazwisko,Imię⏎Kowalski,Jan" przecinek rozdziela dwie kolumny CSV. */
function cellDelimitedNotByComma(t: string, start: number, end: number): boolean {
  let i = start - 1;
  while (i >= 0 && t[i] === ' ') i--;
  if (i >= 0 && /[;|\t"'„“(<>]/.test(t[i])) return true;
  let j = end;
  while (t[j] === ' ') j++;
  return j < t.length && /[;|\t"'”)<>]/.test(t[j]);
}

const RE_ADMIN_UNIT_WORD =
  /^(?:powiat\p{Ll}*|gmin\p{Ll}*|gm|woj|województw\p{Ll}*|wieś|wsi|miasto|miasta|poczta|osiedle|sołectwo|obręb|dzielnica|kod|ul|ulica|tel|kraj)$/u;
// Wyrazy przeniesione do następnego wiersza: ogon (małymi literami) → początki sprzed łącznika.
// Maska zastąpiła już początek w `text`, więc o całym wyrazie rozstrzyga oryginał.
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
/** Wpisy oryginału dla wyrazu; indeks budowany leniwie przy pierwszym użyciu, wspólny dla kroków. */
type RawLinksLookup = (w: string) => RawWordLink[];

/**
 * Domknięcie w prawo: imię za maską w szyku „Nazwisko Imię" („Pozwany Kowalski Jan Paweł"). Tylko
 * przez spację, bo ⇥ zaczyna kolumnę, a nowa linia następny wpis. Idzie przed domknięciem w lewo,
 * inaczej osierocone imię z końca wiersza trafiłoby do maski z następnego wiersza.
 */
function closeNameAfterMask(ctx: RedactCtx, rawLinks: RawLinksLookup): void {
  const fr = finalizeRe(ctx.M);
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(fr.maskThenName, (m, mask: string, w: string, offset: number, t: string) => {
      const wl = w.toLowerCase();
      if (!isFirstNameLike(w) || LEGAL_ENTITY_WORDS.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      // za imieniem zaczyna się inna nazwa własna („[..] Lech Poznań", „[..] Jana Pawła II 5")
      const after = t.slice(offset + m.length, offset + m.length + 40);
      const next = RE_NEXT_CAP_WORD_SP.exec(after)?.[1];
      if (next && !isFirstNameLike(next)) return m;
      // imię przed kolejną maską należy do następnej osoby (kolumny wyrównane spacjami)
      if (fr.personAtStart.test(after.replace(/^ +/, ''))) return m;
      // „Maja" przed liczbą to miesiąc („… Maja 2024 r.")
      if (wl === 'maja' && /^[ \t]+\d/.test(after)) return m;
      if (nameAfterMaskIsOtherPerson(linksAt(rawLinks(w), t, offset + m.length, fr.maskHeads), wl)) return m;
      return mask;
    });
  }
}
/**
 * Domknięcie przez przecinek tylko w rekordzie, gdy maska otwiera komórkę, a imię ją zamyka
 * („<osoba>[..], Jan</osoba>"). W prozie i za parą „Imię Nazwisko" („Rodzice: Jan Kowalski, Anna")
 * to druga osoba. Przecinek bez odstępu tylko w komórce wydzielonej innym separatorem, bo
 * „Kowalski,Jan" w CSV to dwie kolumny.
 */
function closeNameAfterMaskComma(ctx: RedactCtx, rawLinks: RawLinksLookup): void {
  const fr = finalizeRe(ctx.M);
  ctx.text = ctx.text.replace(fr.maskCommaName, (m, mask: string, a: string, b: string | undefined, offset: number, t: string) => {
    if (!POLISH_FIRST_NAMES.has(a.toLowerCase()) || (b && !POLISH_FIRST_NAMES.has(b.toLowerCase()))) return m;
    if (institutionLabelBefore(t, offset)) return m;
    if (!cellStartsBefore(t, offset) || !cellEndsAt(t, offset + m.length)) return m;
    if (!/[ \t]/.test(m[mask.length + 1] ?? '') && !cellDelimitedNotByComma(t, offset, offset + m.length)) return m;
    const commaLinks = linksAt(rawLinks(a), t, offset + m.indexOf(a, mask.length) + a.length, fr.maskHeads);
    if (commaLinks.some((l) => linkAfterMask(l) || (l.sep[0] === ',' && (linkPrevIsName(l) || pairBeforeLink(l))))) return m;
    return mask;
  });
}
/**
 * Domknięcie w lewo: imię tuż przed maską. Nowa linia obejmuje „Jan\nWiśniewski", a bramka
 * isFirstNameLike chroni „protokół\n[OSOBA]". Dwa przebiegi, bo wciągnięte imię odsłania kolejne.
 */
function closeNameBeforeMask(ctx: RedactCtx, rawLinks: RawLinksLookup): void {
  const fr = finalizeRe(ctx.M);
  for (let pass = 0; pass < 2; pass++) {
    ctx.text = ctx.text.replace(fr.nameBeforeMask, (m, w: string, sep: string, mask: string, offset: number, t: string) => {
      // forma imienia, która jest też słowem pospolitym („od Marka [..]", „od Ani [..]"), tylko przez
      // spację; „Ani" dodatkowo w środku zdania (przed nim mały wyraz)
      const wl = w.toLowerCase();
      const colliding =
        COLLIDING_NAME_FORMS.has(wl) && sep === ' ' && (wl !== 'ani' || /\p{Ll}[ \t]+$/u.test(t.slice(Math.max(0, offset - 3), offset)));
      if (!colliding && !isFirstNameLike(w)) return m;
      // kropka bez odstępu bywa końcem zdania („z Janem.Kowalski odpisał"); login ma imię w mianowniku
      if (sep === '.' && !POLISH_FIRST_NAMES.has(wl)) return m;
      // patron w dopełniaczu przed osobą („parafii św. Józefa [OSOBA]")
      if (isFirstNameGenitive(wl) && precededByPatron(t, offset)) return m;
      const pre = t.slice(Math.max(0, offset - 24), offset);
      if (RE_SAINT_WORD_BEFORE.test(pre)) return m;
      // sam wpis listy maskuje passListEntries niżej
      if (sep === '\n' && newlineJoinBlocked(fr, t, offset, offset + m.length, linksAt(rawLinks(w), t, offset + w.length, fr.maskHeads), w, ctx.raw))
        return m;
      // imię w sąsiedniej komórce TSV: własna maska, kolumna zostaje (patrz maskCells)
      return sep === '\t' ? `${mask}\t${mask}` : mask;
    });
  }
}
/**
 * Imię doklejone za maską kropką albo podkreśleniem („Kowalski_Jan" w nazwach katalogów i kont).
 * Spację obsługuje szyk odwrócony w passPersonPairs, a łącznik należy do nazwiska dwuczłonowego.
 * Przy kropce, jak w lewo, tylko imię w mianowniku za nazwiskiem w mianowniku: „z Kowalskim.Marek
 * potwierdził" to koniec zdania bez spacji.
 */
function closeGluedNameAfterMask(ctx: RedactCtx, rawLinks: RawLinksLookup): void {
  const fr = finalizeRe(ctx.M);
  ctx.text = ctx.text.replace(fr.maskGluedName, (m, mask: string, w: string, offset: number, t: string) => {
    if (!isFirstNameLike(w)) return m;
    if (m[mask.length] === '.') {
      if (!POLISH_FIRST_NAMES.has(w.toLowerCase())) return m;
      const glued = linksAt(rawLinks(w), t, offset + m.length, fr.maskHeads);
      if (glued.some((l) => linkAfterMask(l) || (l.sep === '.' && (linkPrevOblique(l) || linkPrevIsName(l) || pairBeforeLink(l))))) return m;
    }
    return mask;
  });
}
/**
 * Ogon wyrazu przeniesionego za maską („Barbary Wojciechow-⏎skiej", „Warsza-⏎wa"). Myślnik na końcu
 * wiersza bywa też pauzą („Jan Kowalski-⏎kierownik"), więc ogon dołącza tylko wtedy, gdy początek
 * z oryginału razem z nim daje nazwisko albo miasto, a sam początek nie jest już pełną nazwą.
 * Miasto tylko z ogonem małymi literami.
 */
function joinHyphenatedTailAfterMask(ctx: RedactCtx): void {
  if (!ctx.text.includes('-\n') && !ctx.text.includes('-\r\n')) return;
  let heads: Map<string, string[]> | undefined;
  const city = ctx.M.MIEJSCOWOSC;
  ctx.text = ctx.text.replace(finalizeRe(ctx.M).hyphenTail, (m, mask: string, tail: string) => {
    if (mask === city && tail !== tail.toLowerCase()) return m;
    const lo = tail.toLowerCase();
    const ok = ((heads ??= rawHyphenHeads(ctx.raw)).get(lo) ?? []).some((h) => {
      const joined = h + lo;
      // etykieta jednostki w następnym wierszu („Halinów-⏎powiat miński") to nie ogon nazwy
      if (mask === city) return POLISH_CITIES.has(joined) || (!POLISH_CITIES.has(h) && !RE_ADMIN_UNIT_WORD.test(lo));
      return !!surnameBase(joined) || (looksLikeSurname(joined) && !surnameBase(h));
    });
    return ok ? mask : m;
  });
}
/**
 * Imię z homoglifem OCR przy masce („J0anna [..]", „KaroI [..]"), którego nie przepuszcza bramka
 * słownika. Najpierw w prawo na końcu wiersza („Nowak KaroI⏎Jan Kowalski"), potem w lewo ze
 * strażnikami nowej linii, żeby imię z końca wiersza nie trafiło do osoby z następnego.
 */
function closeOcrNamesAroundMask(ctx: RedactCtx, rawLinks: RawLinksLookup): void {
  const fr = finalizeRe(ctx.M);
  ctx.text = ctx.text.replace(fr.maskThenOcrName, (m, mask: string, w: string, offset: number, t: string) => {
    const form = ocrFirstNameForm(w);
    if (!form) return m;
    const key = /^\p{L}+/u.exec(w)?.[0] ?? w;
    return nameAfterMaskIsOtherPerson(linksAt(rawLinks(key), t, offset + m.length, fr.maskHeads), form) ? m : mask;
  });
  ctx.text = ctx.text.replace(fr.ocrNameBeforeMask, (m, w: string, sep: string, mask: string, offset: number, t: string) => {
    if (!ocrFirstNameForm(w)) return m;
    if (sep === '\n' && newlineJoinBlocked(fr, t, offset, offset + m.length)) return m;
    return mask;
  });
}
/** Inicjały i cząstki obcych nazwisk przy masce; znacznik „z d." wraca między inicjałem a łańcuchem inicjałów. */
function absorbInitialsAndParticles(ctx: RedactCtx): void {
  const fr = finalizeRe(ctx.M);
  // Inicjał imienia przed maską („mec. J. [OSOBA-B]").
  ctx.text = ctx.text.replace(fr.initialBeforeMask, (m, mask: string, offset: number, t: string) => {
    // na początku wiersza to punkt wyliczenia („A. Jan Kowalski zeznał"); ucieczka „\n" w JSON-ie
    // (znak PUA z passProtectJsonEscapes) też zaczyna wiersz
    let i = offset - 1;
    while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
    if (i < 0 || t[i] === '\n' || ((t[i] === '\uE00A' || t[i] === '\uE00D') && t[i - 1] === '\\')) return m;
    // „Sp. J." / „Sp. K." to forma prawna spółki
    if (/(?<!\p{L})[Ss][Pp]\.$/u.test(t.slice(Math.max(0, i - 3), i + 1))) return m;
    if (isHonorificP(t, offset)) return m; // „Sz. P. [OSOBA-A]": „P." to „Pan"
    return mask;
  });
  // Znacznik „z d." z passPersonMaidenAfterMask wraca dopiero po inicjałach, żeby „D." nie poszło do maski.
  if (ctx.text.includes(MAIDEN_D_SENTINEL)) ctx.text = ctx.text.split(MAIDEN_D_SENTINEL).join('D');
  // Łańcuch inicjałów przed maską („J.K. [OSOBA-A]"); skróty (P.S., S.A.) rozstrzyga dotChainKind.
  ctx.text = ctx.text.replace(fr.dotChainBeforeMask, (m, head: string, ini: string, mask: string) => {
    const kind = dotChainKind(head, ini);
    if (kind === 'absorb') return mask;
    if (kind === 'keepTitle') return `${head}${mask}`;
    return m;
  });
  // Cząstka obcego nazwiska wieloczłonowego („[OSOBA-F] Van Anh").
  ctx.text = ctx.text.replace(fr.maskForeignParticle, '$1');
}
/** Etykiety osób według kolejności pierwszego wystąpienia, dopiero gdy żadna maska już nie powstanie. */
function relabelPersonsAndRestoreUrls(ctx: RedactCtx): void {
  const labels = new Map<string, string>();
  for (const mm of ctx.text.matchAll(/\[OSOBA-([A-Z]+)\]/g)) if (!labels.has(mm[1])) labels.set(mm[1], indexToLetters(labels.size));
  ctx.text = ctx.text.replace(/\[OSOBA-([A-Z]+)\]/g, (_m, l: string) => `[OSOBA-${labels.get(l)}]`);
  // PII wewnątrz chronionych URL-i zamaskował już passProtectUrls.
  if (ctx.protectedUrls.length) {
    ctx.text = ctx.text.replace(RE_URL_SENTINEL, (mm, letters: string) => ctx.protectedUrls[lettersToIndex(letters)] ?? mm);
  }
}
export function finalizePersons(ctx: RedactCtx): void {
  let links: Map<string, RawWordLink[]> | undefined;
  const rawLinks: RawLinksLookup = (w) => (links ??= buildRawWordLinks(ctx.raw, finalizeRe(ctx.M).maskTails)).get(w) ?? [];
  closeNameAfterMask(ctx, rawLinks);
  closeNameAfterMaskComma(ctx, rawLinks);
  closeNameBeforeMask(ctx, rawLinks);
  closeGluedNameAfterMask(ctx, rawLinks);
  joinHyphenatedTailAfterMask(ctx);
  closeOcrNamesAroundMask(ctx, rawLinks);
  passListEntries(ctx);
  absorbInitialsAndParticles(ctx);
  relabelPersonsAndRestoreUrls(ctx);
}

const RE_JSON_ESC_PUA_G = new RegExp(`\\\\?([${JSON_ESC_PUA}])`, 'g');
// Po przywróceniu URL-i, bo zapamiętane adresy też mogą zawierać ucieczki. Znak PUA bez backslasha
// też wraca jako pełna ucieczka, żeby wartość JSON-a została poprawnym łańcuchem.
export function passRestoreJsonEscapes(ctx: RedactCtx): void {
  if (!ctx.jsonEscapes) return;
  ctx.text = ctx.text.replace(RE_JSON_ESC_PUA_G, (_m, c: string) => `\\${JSON_ESC_FROM_PUA[c]}`);
}

/** Czy tekst to dokument JSON: obiekt lub tablica w całości albo NDJSON (każdy niepusty wiersz osobno). */
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
  if (!/^[[{]/.test(t)) return false; // odcina prozę przed parsowaniem
  if (parses(t)) return true;
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 1 && lines.every(parses);
}

// Maska w miejscu liczby JSON („"pesel": 85031412347") dostaje cudzysłowy, żeby wynik się parsował.
// Tylko gdy oryginał to poprawny JSON lub NDJSON; proza się nie parsuje, więc „Pole "Telefon": 512…"
// zostaje. Wykrywanie liczb nie zależy od klucza, bo „"id": 85031412347" to też PESEL.
export function passJsonRequote(ctx: RedactCtx): void {
  if (ctx.text === ctx.raw || !isJsonDocument(ctx.raw)) return;
  const masks = [...new Set(Object.values(ctx.M))].sort((a, b) => b.length - a.length).map(escapeRe);
  // Literał łańcuchowy pochłaniany w całości i oddawany bez zmian. JSON.stringify na wypadek własnej
  // maski z cudzysłowem albo backslashem.
  const re = new RegExp(`"(?:[^"\\\\\\n]|\\\\.)*"|(${[...masks, '\\[OSOBA-[A-Z]+\\]'].join('|')})`, 'g');
  ctx.text = ctx.text.replace(re, (m, mask: string | undefined) => (mask ? JSON.stringify(mask) : m));
}
