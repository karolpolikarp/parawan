// Imię i nazwisko z heurystyk par: małżonkowie, ciągi imion, zdrobnienia, szyk „Nazwisko Imię",
// zapis rekordu, małe litery i nazwisko panieńskie; ochrona postaci literackich.
import { foldAsciiChar, HOMOGRAPH_SURNAMES, homographBase, isConfirmedSurname, isGeoAdjective, looksLikeSurname, NON_SURNAME_ADJ, normalizeSurnameKey, RE_PL_DIACRITIC_G, surnameBase, surnameShaped } from '../surnames.js';
import { CAP_WORD, LIST_BULLET, NM_BOUND, PL_LO, PL_UP, splitWords } from '../charset.js';
import { protectSpan, type RedactCtx } from '../context.js';
import { FORM_LABEL_WORDS } from '../dict/forms.js';
import { EXTRA_NAME_FORMS, FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, isMaleFirstNameGenitive, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { afterNonPersonContext, EPONYM_HEADS, eponymFits, precededByAdminLabel, precededByEponym, RE_STREET_WORD } from '../guards/eponyms.js';
import { cellEndsAt, cellStartsBefore, HOMOGRAPH_PAIR_EXCL, institutionLabelBefore, LIST_HEAD_NOT_SURNAME, ORG_HEAD_WORDS, PATRON_GEN_HEADS, RE_PAST_VERB_AFTER, RE_ROLE_LABEL_BEFORE, RE_SAINT_WORD_BEFORE } from '../guards/person-context.js';
import { columnGapBetween, headAgreesWithAdjective, LEGAL_ENTITY_WORDS, NON_NAME_LEADERS, NOUN_NAME_LEADERS, OWNER_FIRM_HEADS, PARTY_ROLE_WORDS, PROPER_NAME_HEADS, properNamePairIsPerson, RE_AFTER_PARTY_ADJ, RE_FOLLOWED_BY_PARK, RE_NEXT_CAP_WORD_1SP, RE_VERB_1ST_PERSON, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { RE_PATRON_ROMAN_REF_BEFORE, rynekNoNotHouse } from './address.js';
import { isPersonRoleValue, NOUN_LIKE_NAMES_IN_TITLES } from '../guards/person-values.js';
import { CAPS_REVERSED_HEAD_EXCL, CAPS_ROLE_OBLIQUE, capsOrgHead, MAIDEN_NOT_SURNAME, personSlotBefore } from './person-caps-ocr.js';
import { TABLE_HEADER_WORDS } from './person-triggers.js';
import { RE_DECLINED_NOM_SURNAME, RE_LOWER_RUN, RE_NEXT_CAP_WORD_SP, RE_NON_PL_LETTER, RE_PAIR, RE_SPOUSES, RE_SURNAME_OBLIQUE } from '../person-patterns.js';

// Ostatni wyraz przed pozycją; grupa 2 to dwukropek etykiety („Świadek: ").
const RE_PREV_TOKEN = /(\p{L}+)\.?[ \t]*(:?)[ \t]*$/u;

// Role procesowe i umowne (też w dopełniaczu) przed toponimem-nazwiskiem („od uczestnika Kazimierza
// Dolnego"); uzupełnia ROLE_WORDS.
const RE_TOPONYM_PERSON_ROLE =
  /^(?:pracodawc\p{L}*|dzierżawc\p{L}*|wydzierżawiając\p{L}*|uczestnik\p{L}*|pozwan\p{L}*|powod\p{L}*|wnioskodawc\p{L}*|oskarżon\p{L}*|świadk\p{L}*|pełnomocnik\p{L}*|najemc\p{L}*|wynajmując\p{L}*|zleceniobiorc\p{L}*|zleceniodawc\p{L}*|dłużnik\p{L}*|wierzyciel\p{L}*|właściciel\p{L}*|pracownik\p{L}*|sprzedawc\p{L}*|nabywc\p{L}*|kupując\p{L}*|obywatel\p{L}*|lokator\p{L}*)$/u;
// Dane osoby tuż za ciągiem („Kazimierz Dolny (PESEL …)", „…, ur. 03.03.1950").
const RE_PERSON_DATA_AHEAD = /^[ \t]*[,(]?[ \t]*(?:PESEL|ur\.|urodzon|zam\.|zamieszka|syn |córka )/iu;
// Początek wiersza albo punkt listy („1. ", „- ") przed wpisem.
const RE_LINE_HEAD_ONLY = new RegExp(`(?:^|\\n)[ \\t]*${LIST_BULLET}$`);
/**
 * Czy wpis „Przymiotnik-ze-stoplisty Imię" to osoba w szyku „Nazwisko Imię" („Wnioskodawca:
 * Białowieski Jan")? Przymiotnik odmiejscowy bywa nazwiskiem (Mazowiecki, Rybacki), więc mocna kotwica
 * osoby wygrywa ze stoplistą: rola z dwukropkiem, „Pan/Pani", dane osoby za wpisem albo sam wpis
 * w wierszu listy. W samym wierszu imię-rzeczownik z typowej nazwy („Olimpijska Nadzieja") nie wystarcza.
 */
function stoplistedSurnameAnchored(t: string, offset: number, m: string, w1: string, w2: string): boolean {
  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (!RE_DECLINED_NOM_SURNAME.test(w1l) || !isGeoAdjective(w1l)) return false;
  if (!POLISH_FIRST_NAMES.has(w2l) || isFirstNameGenitive(w2l)) return false;
  const end = offset + m.length;
  if (RE_PERSON_DATA_AHEAD.test(t.slice(end, end + 24))) return true;
  // wycięte okno nie zaczyna wiersza; znak \0 blokuje „^" w RE_LINE_HEAD_ONLY
  const before = (offset > 40 ? '\0' : '') + t.slice(Math.max(0, offset - 40), offset);
  const label = RE_ROLE_LABEL_BEFORE.exec(before)?.[1]?.toLowerCase();
  if (label && (ROLE_WORDS.has(label) || RE_TOPONYM_PERSON_ROLE.test(label))) return true;
  if (/(?<!\p{L})(?:pan|pani|panna)[ \t]+$/iu.test(before)) return true;
  // komórka CSV/TSV w szyku „Nazwisko Imię" („1;Poleski Marek;ul. Leśna 7")
  if (cellStartsBefore(t, offset) && /[;|\t]/.test(t.slice(Math.max(0, offset - 3), offset)) && /^[ \t]*[;|\t]/.test(t.slice(end, end + 4))) return true;
  if (NOUN_LIKE_NAMES_IN_TITLES.has(w2l) || !RE_LINE_HEAD_ONLY.test(before)) return false;
  const after = t.slice(end, end + 40);
  return /^[ \t]*[\r\n,;\t]/.test(after) || (end + after.length >= t.length && /^[ \t]*$/.test(after));
}

// „Nazwisko, Imię[ Imię]": przecinek bez odstępu przed nim, po nim odstęp (CSV „Kowalski,Jan"
// to dwie kolumny, nie jedna komórka).
const RE_PAIR_COMMA = new RegExp(
  `(?<![${NM_BOUND}-])(${CAP_WORD}),[ \\t]+(${CAP_WORD})(?:[ \\t]+(${CAP_WORD}))?(?![${NM_BOUND}])`,
  'g',
);
/**
 * Czy „Nazwisko, Imię" to jedna osoba zapisana jak w rekordzie? Para musi stanowić całą komórkę,
 * imię być w mianowniku (w prozie „z Kowalskim, Janem i Anną" to dwie osoby), a pierwszy wyraz mieć
 * dowód nazwiska (słownik, końcówka, homograf). Sam nagłówek „Do:" dowodem nie jest: „Do: Sekretariat,
 * Ewa" zostaje.
 */
function commaPairIsPerson(t: string, offset: number, m: string, w1: string, w2: string, w3: string | undefined): boolean {
  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (!POLISH_FIRST_NAMES.has(w2l) || (w3 && !POLISH_FIRST_NAMES.has(w3.toLowerCase()))) return false;
  if (!cellStartsBefore(t, offset) || !cellEndsAt(t, offset + m.length)) return false;
  if (isFirstNameLike(w1) || TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2l)) return false;
  if (isGeoAdjective(w1l) || LIST_HEAD_NOT_SURNAME.has(w1l)) return false;
  const parts = w1l.split('-');
  const proven = parts.some(surnameShaped);
  // homograf tylko z imieniem, które nie jest też rzeczownikiem („Kwiaty: Kalina, Róża")
  const homograph = !NOUN_LIKE_FIRST_NAMES.has(w2l) && parts.some((p) => HOMOGRAPH_SURNAMES.has(p));
  if (!proven && !homograph) return false;
  if (institutionLabelBefore(t, offset)) return false;
  return !precededByEponym(t, offset);
}

/**
 * Zdrobnienia celowo spoza POLISH_FIRST_NAMES (kraj „Kuba", „Ada" jako język programowania, krótkie
 * „Ola/Iza/Ela"). Tylko mianownik i tylko w parze z potwierdzonym nazwiskiem: wpis do słownika imion
 * dałby formy „Kubie/Kubą" i każdy wyraz z wielkiej litery po „Kuba" jako nazwisko.
 */
const PAIR_ONLY_NICKNAMES = 'Kuba|Ola|Ula|Iza|Ela|Ala|Aga|Ada|Kaja|Majka|Mati|Maks|Jasiek';
const RE_NICK_PAIR = new RegExp(`(?<![${NM_BOUND}-])(${PAIR_ONLY_NICKNAMES})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
/**
 * Czy „Zdrobnienie Nazwisko" to osoba? Sam homograf („Kuba Lis") bez kotwicy nie wystarcza, przymiotnik
 * odmiejscowy („Ola Polska") i kontekst ulicy czy patrona też nie. Imię za nazwiskiem („Kierunek: Kuba
 * Nowak Jan") oznacza szyk „Nazwisko Imię", w którym zdrobnienie stoi przed osobą.
 */
function nicknamePairIsPerson(t: string, offset: number, m: string, w2: string): boolean {
  const parts = w2.toLowerCase().split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || ROLE_WORDS.has(p) || TITLE_WORDS.has(p) || isGeoAdjective(p))) return false;
  // w nazwisku dwuczłonowym homograf obok potwierdzonego członu też jest nazwiskiem („Nowak-Lis")
  if (!parts.some(surnameShaped) || !parts.every((p) => surnameShaped(p) || (parts.length > 1 && HOMOGRAPH_SURNAMES.has(p)))) return false;
  if (precededByEponym(t, offset) || precededByAdminLabel(t, offset)) return false;
  if (afterNonPersonContext(t, offset, w2)) return false;
  const next = RE_NEXT_CAP_WORD_SP.exec(t.slice(offset + m.length, offset + m.length + 40))?.[1];
  return !(next && isFirstNameLike(next));
}

const RE_MAIL_HEADER_HEAD = /^\s*(to|do|od|from|cc|dw|odbiorca|nadawca|adresat|wysłano|sent)\s*:/i;
/** Początki wierszy tekstu, rosnąco; liczone raz na przebieg, przeszukiwane binarnie. */
function lineStartsOf(t: string): number[] {
  const starts = [0];
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
/**
 * Czy wiersz z pozycją `offset` zaczyna się nagłówkiem wiadomości („To:", „Do:")? Początek wiersza
 * z tablicy `starts` (wyszukiwanie binarne), bo wiersz „Do:" z Outlooka bywa bardzo długi.
 */
function inMailHeaderLine(t: string, offset: number, starts: number[]): boolean {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  const ls = starts[lo];
  // etykieta stoi na początku wiersza, więc wystarczy jego początek
  return RE_MAIL_HEADER_HEAD.test(t.slice(ls, Math.min(offset, ls + 64)));
}
// Nazwę instytucji z imieniem w środku po samej roli („Prezes Klubu Lech Poznań", „Prezes Zarządu
// Firmy Adam Sp. z o.o.") zdradza wyraz kończący nazwę firmy albo forma prawna za nim. Sama instytucja
// w dopełniaczu niczego nie rozstrzyga: „Prezes Zarządu Spółki Anna Wrona" to członek zarządu.
const COMPANY_TAIL_WORDS = new Set<string>(
  (
    'trans bud meble moda holding group grupa browary dystrybucja logistics logistyka service serwis ' +
    'auto med invest development consulting design studio system systems tech media travel transport ' +
    'energia sport'
  ).split(' '),
);
const RE_LEGAL_FORM_AHEAD = /^[ \t]*(?:\.[ \t]*)?(?:S\.?A\.?|[Ss][Pp]\.|[Ss]\.?[Cc]\.|S\.?K\.?A\.?|Group|Holding)(?![\p{L}])/u;
// Tytuły duchowne między głową nazwy a imieniem patrona („Muzeum ks. Jerzego Popiełuszki"): głową
// jest wyraz przed nimi.
const RE_CLERIC_RANKS_TAIL = /(?:(?<!\p{L})(?:ks|bł|św|sw|bp|abp|kard|o)\.[ \t]*)+$/iu;
/**
 * Czy imię na pozycji `start` ciągu to imię patrona: świętego („Sobór św. Jerzego Zwycięzcy") albo
 * obiektu lub instytucji („Pomnik Jerzego Popiełuszki")? Drugie tylko w przypadku zależnym; osobę
 * w mianowniku za nazwą instytucji rozstrzyga nameSeqTail. Numer domu za parą nie czyni z niej patrona:
 * ulicę z numerem obsługuje wcześniej patronStreetWithNumber.
 */
function patronFirstNameAt(t: string, offset: number, parts: string[], start: number): boolean {
  const before = t.slice(Math.max(0, offset - 30), offset) + parts.slice(0, 2 * start).join('');
  if (RE_SAINT_WORD_BEFORE.test(before)) return true;
  const sw = parts[2 * start].toLowerCase();
  if (POLISH_FIRST_NAMES.has(sw) && !isFirstNameGenitive(sw)) return false;
  // głowa nazwy w tej samej komórce: „Nagroda⇥Jana Lisa⇥Kraków" to kolumna nagrody i laureat
  const prev = /(\p{L}+)\.? +$/u.exec(before)?.[1]?.toLowerCase();
  if (prev && PATRON_GEN_HEADS.has(prev)) return true;
  const ranks = RE_CLERIC_RANKS_TAIL.exec(before);
  if (ranks) {
    const head = /(\p{L}+)\.?[ \t]+$/u.exec(before.slice(0, ranks.index))?.[1]?.toLowerCase();
    if (head && PATRON_GEN_HEADS.has(head)) return true;
  }
  return false;
}
// Homografy kalendarza i narodowości przed imieniem w grafiku czy liście („Maj⇥Anna", „Polak⇥Jan"):
// kolumna dnia albo obywatelstwa, nie nazwisko.
export const TSV_NOT_SURNAME = new Set<string>('maj sobota piątek niedziela środa wtorek poniedziałek czwartek polak polka niemiec czech rusin litwin węgier'.split(' '));
/**
 * Maska ciągu wyrazów osoby od `from` do `to` (indeksy wyrazów w podziale z separatorami). Tabulator
 * w ciągu to granica komórki TSV („Adam⇥Kowalczyk⇥Magazynier"): każda komórka dostaje własną maskę
 * z tym samym kluczem, a tabulatory zostają, żeby dane nie przesunęły się pod cudze nagłówki.
 */
function maskCells(parts: string[], from: number, to: number, mask: string): string {
  let out = mask;
  for (let i = from; i < to; i++) if (parts[2 * i + 1].includes('\t')) out += parts[2 * i + 1] + mask;
  return out;
}
/** Para „W1⇥W2" zamaskowana w całości: przy tabulatorze maska w każdej komórce (patrz maskCells). */
function pairCellMask(m: string, w2: string, mask: string): string {
  const gap = /[ \t]+$/.exec(m.slice(0, m.length - w2.length))?.[0] ?? '';
  return gap.includes('\t') ? `${mask}${gap}${mask}` : mask;
}
/**
 * Szyk „Nazwisko-homograf Imię" na miejscu osoby („Pacjent: Wilk Jadwiga", „1. Mazur Grzegorz –
 * Kierownik"). Imię w mianowniku, homograf spoza kalendarza, urzędów i narodowości; bez etykiety albo
 * numeru wpisu („Kot Anny spał", „Król Zygmunt August") nie.
 */
function reversedHomographAnchored(t: string, offset: number, w1l: string, w2l: string): boolean {
  if (!POLISH_FIRST_NAMES.has(w2l) || isMaleFirstNameGenitive(w2l) || NOUN_LIKE_FIRST_NAMES.has(w2l)) return false;
  const hb = homographBase(w1l);
  if (!hb || hb !== w1l || HOMOGRAPH_PAIR_EXCL.has(hb) || CAPS_REVERSED_HEAD_EXCL.has(hb) || isFirstNameLike(w1l)) return false;
  return personSlotBefore(t, offset);
}
// Postacie literackie znane pod imieniem z przydomkiem („Przygody Tomka Sawyera", „Kubuś Puchatek"):
// odmiana zdrobnień czyni z nich osobę w prozie. Zbiór zamknięty, tylko pary, których nie nosi strona
// pisma („Michał Anioł" to też zwykłe imię i nazwisko, więc go tu nie ma). Rola, etykieta albo dane
// osoby przy parze rozstrzygają za osobą. Para trafia za sentinel URL i wraca jawna na końcu.
const FICTIONAL_PAIRS_SRC = [
  'tom(?:ek|ka|kowi|kiem|ku)[ \\t]+(?:sawyer(?:a|owi|em|ze)?|wilmowsk(?:i|iego|iemu|im))',
  'kubu(?:ś|sia|siowi|siem|siu)[ \\t]+puchat(?:ek|ka|kowi|kiem|ku)',
  'sta(?:ś|sia|siowi|siem|siu)[ \\t]+tarkowsk(?:i|iego|iemu|im)',
  'ani(?:a|i|ę|ą|u)[ \\t]+shirley',
  'pan(?:a|u|em|ie)?[ \\t]+wołodyjowsk(?:i|iego|iemu|im)',
];
// Każda litera z ogonkiem także w zapisie ASCII („Kubus Puchatek").
const foldClass = (s: string): string => s.replace(RE_PL_DIACRITIC_G, (c) => `[${c}${foldAsciiChar(c)}]`);
const RE_FICTIONAL_PAIR = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FICTIONAL_PAIRS_SRC.map(foldClass).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
export function passProtectFictional(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_FICTIONAL_PAIR, (m, offset: number, t: string) => {
    const prev = RE_PREV_TOKEN.exec(t.slice(Math.max(0, offset - 40), offset))?.[1]?.toLowerCase();
    if (prev && (ROLE_WORDS.has(prev) || TITLE_WORDS.has(prev) || PARTY_ROLE_WORDS.has(prev))) return m;
    if (personSlotBefore(t, offset) || RE_PERSON_DATA_AHEAD.test(t.slice(offset + m.length, offset + m.length + 24))) return m;
    return protectSpan(ctx, m);
  });
}
// Postacie historyczne z dwoma imionami w dopełniaczu („za panowania Zygmunta Augusta"): bez kotwicy
// osoby za parą to nie strona pisma.
const HISTORIC_DOUBLE_NAMES_GEN = new Set<string>(
  ['jana kazimierza', 'zygmunta augusta', 'stanisława augusta', 'jana olbrachta', 'władysława hermana', 'jana chrzciciela', 'jana nepomucena', 'jana ewangelisty', 'jana sebastiana', 'jana henryka', 'jana józefa'],
);
// Kotwica osoby tuż za parą: data urodzenia, PESEL, adres zamieszkania, ojcostwo, wiek.
const RE_GEN_PAIR_PERSON_AFTER =
  /^[ \t]*(?:\([ \t]*(?:ur\.|urodz|PESEL|lat[ \t]|zam\.)|,[ \t]*(?:ur\.|urodz\p{L}*|PESEL|nr[ \t]+PESEL|zam\.|zamieszka\p{L}*|syn(?:a|em)?|córk\p{L}*|lat[ \t]+\d|l\.[ \t]*\d|s\.[ \t]*\p{Lu}|c\.[ \t]*\p{Lu}|tel\.|legitymując\p{L}*|posiadając\p{L}*|nr[ \t]+dowodu|dow\.))/u;
// Wyraz tuż przed parą, po którym imię w dopełniaczu to patron albo dzieło, a nie osoba: skrót
// „im./ul./św.", wyraz uliczny, głowa nazwy z patronem i odsyłacz do pism albo wydarzeń.
const RE_GEN_PAIR_PATRON_BEFORE =
  /(?<!\p{L})(?:im|imienia|ul|al|pl|os|św|sw|bł|bl|ks|abp|bp|o(?=\.)|pw|papież\p{L}*|świę?t\p{L}*|błogosławion\p{L}*|panowani\p{L}*|czas\p{L}*|epok\p{L}*|dynasti\p{L}*|kr[oó]l\p{L}*|ulic\p{L}*|alej\p{L}*|alei|plac\p{L}*|osiedl\p{L}*|rond\p{L}*|skwer\p{L}*)\.?[ \t]*$/iu;
/**
 * Czy para „imię w dopełniaczu + dopełniacz imienia" bez roli przed nią to osoba? Nie, gdy przed nią
 * stoi patron, ulica, instytucja albo odsyłacz do pism („Szkoła im. Jana Pawła", „Encyklika Jana
 * Pawła"); postać historyczna z dwoma imionami tylko z kotwicą za parą.
 */
function genPairPersonFree(t: string, at: number, end: number, pair: string): boolean {
  // Wyliczenie rodziców („córka Piotra Pawła i Anny Marii") i szyk rekordu z nazwiskiem przed parą
  // („Wniosek Kowalskiego Stanisława Jana") maskują dalsze przebiegi w całości. Tylko gdy dalej stoi
  // drugie imię albo dwa imiona bez nazwiska; osoba z nazwiskiem w wyliczeniu („… i Tomasza Lisa") nie
  // zdejmuje maski z pary.
  const enumNext = /^[ \t]+(?:i|oraz)[ \t]+(\p{Lu}\p{Ll}+)(?:[ \t]+(\p{Lu}\p{Ll}+))?/u.exec(t.slice(end, end + 40));
  if (enumNext && (!isFirstNameLike(enumNext[1]) || !enumNext[2] || (isFirstNameLike(enumNext[2]) && !surnameBase(enumNext[2])))) return false;
  const prevCap = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, at - 30), at))?.[1]?.toLowerCase();
  if (prevCap && !isFirstNameLike(prevCap) && surnameShaped(prevCap)) return false;
  if (RE_GEN_PAIR_PERSON_AFTER.test(t.slice(end, end + 30))) return true;
  if (HISTORIC_DOUBLE_NAMES_GEN.has(pair)) return false;
  const before = t.slice(Math.max(0, at - 40), at);
  // odsyłacz do pism i wydarzeń („Encyklika …", „Pielgrzymka …") tylko przy papieżu
  if (RE_GEN_PAIR_PATRON_BEFORE.test(before) || (pair === 'jana pawła' && RE_PATRON_ROMAN_REF_BEFORE.test(before))) return false;
  // ulica papieża po przyimku miejsca („jestem na Jana Pawła, za rogiem")
  if (pair === 'jana pawła' && /(?<!\p{L})(?:na|w|z|ze)[ \t]+$/iu.test(before)) return false;
  const prev = /(\p{L}+)[ \t]+$/u.exec(before)?.[1]?.toLowerCase();
  if (prev && (PATRON_GEN_HEADS.has(prev) || capsOrgHead(prev))) return false;
  return true;
}
// Nazwisko panieńskie: „Imię z Nazwiskoskich" albo „Imię z domu Nazwisko" to jedna osoba. Po gołym „z"
// wymagany dopełniacz l.mn., który odróżnia panieńskie od narzędnika („Anna z Kowalskim" to dwie osoby)
// i od miejsca („z Krakowa"). Po „z domu" i „z d." dowolna forma, ale wyraz z wielkiej litery, więc
// „Pismo z d. 12.03.2024" nie pasuje. Między wyrazami tylko białe znaki, także łamanie wiersza.
const RE_MAIDEN_NAME = new RegExp(
  `\\b(${CAP_WORD})[ \\t\\n]+z[ \\t\\n]+` +
    `(?:(?:domu|d\\.)[ \\t\\n]+(${CAP_WORD})` +
    `|([${PL_UP}][${PL_LO}]+(?:skich|ckich|dzkich|ich|ych|ów)))` +
    `(?![${NM_BOUND}])`,
  'g',
);
// Małżonkowie albo rodzeństwo o wspólnym nazwisku („Anna i Jan Kowalscy").
function maskSpouses(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_SPOUSES, (m, a: string, mid: string, b: string, c: string, offset: number, t: string) => {
    if (!isFirstNameLike(a) || !isFirstNameLike(b)) return m;
    if (LEGAL_ENTITY_WORDS.has(c.toLowerCase())) return m;
    // Nazwisko w liczbie mnogiej („Annę Marię i Jana Kowalskich") to wspólne nazwisko: pierwszy człon
    // jest wtedy drugim imieniem pierwszej osoby. „-skim" to liczba mnoga przy celowniku, a przy
    // narzędniku tylko za żeńskim drugim imieniem, bo „Tomaszem Markiem i Janem Kowalskim" to dwie osoby.
    const cl = c.toLowerCase();
    const al = a.toLowerCase();
    const pluralSurname =
      /(?:[sc]kich|dzkich|[sc]kimi|dzkimi|ów|owie)$/.test(cl) || (/(?:[sc]kim|dzkim)$/.test(cl) && (/(?:owi|u|ie)$/.test(b.toLowerCase()) || /ą$/.test(al)));
    // Przy imieniu przed parą to dwie osoby: trzeci wyraz jest drugim imieniem drugiej („córka Piotra
    // Pawła i Anny Marii") albo pierwszy człon nazwiskiem poprzedniej („Piotra Pawła i Annę Nowak").
    if (!pluralSurname && ((isFirstNameLike(c) && !surnameBase(c)) || !POLISH_FIRST_NAMES.has(al) || isFirstNameGenitive(al))) {
      const prev = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
      if (prev && isFirstNameLike(prev)) return m;
    }
    ctx.bump('IMIE');
    // wspólne nazwisko to ten sam klucz osoby; spójnik i odstępy zostają z tekstu
    return `${ctx.personMask(c)}${mid}${ctx.personMask(c)}`;
  });
}
/**
 * Maska wyrazów od `from` do `to` w podziale ciągu z separatorami; tekst przed i za nimi zostaje
 * (patrz maskCells).
 */
function maskWordRange(ctx: RedactCtx, parts: string[], from: number, to: number, key: string): string {
  ctx.bump('IMIE');
  return parts.slice(0, 2 * from).join('') + maskCells(parts, from, to, ctx.personMask(key)) + parts.slice(2 * to + 1).join('');
}
// Ciąg 2–4 wyrazów z wielkiej litery. Stanowy (flaga g): maskNameSequences steruje lastIndex ręcznie.
const RE_NAME_SEQ = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?:[ \\t]+${CAP_WORD}){1,3}(?![${NM_BOUND}])`, 'g');
// Wyraz z wielkiej litery tuż za porcją RE_NAME_SEQ w tej samej linii (wznowienie okna).
const RE_NEXT_CAP_WORD = new RegExp(`^[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`);
/**
 * Okno RE_NAME_SEQ ma najwyżej 4 wyrazy, więc w dłuższym ciągu imię wypada na końcu porcji
 * („Kierownik Działu Kadr Grzegorz | Mazur"). Wtedy porcja oddaje ogon: zwraca pozycję imienia, od
 * której skan rusza dalej. Tylko imię w mianowniku ze słownika (patron w dopełniaczu nie) i następny
 * wyraz w kształcie nazwiska: potwierdzony albo po roli lub tytule w prefiksie, nigdy encja prawna,
 * dopełniacz ani przymiotnik odmiejscowy.
 */
function nameSeqTail(ctx: RedactCtx, m: string, offset: number, words: string[], parts: string[], start: number): number | null {
  if (start === 0) return null;
  const first = words[start].toLowerCase();
  if (!POLISH_FIRST_NAMES.has(first) || isFirstNameGenitive(first)) return null;
  const nx = RE_NEXT_CAP_WORD.exec(ctx.text.slice(offset + m.length, offset + m.length + 60))?.[1];
  if (!nx) return null;
  const nl = nx.toLowerCase();
  const segs = nl.split('-');
  // „Sp" z „Sp. z o.o." to forma prawna, nie nazwisko
  if (nl === 'sp' || segs.some((p) => LEGAL_ENTITY_WORDS.has(p) || isGeoAdjective(p)) || RE_SURNAME_OBLIQUE.test(nl)) return null;
  const resume = offset + parts.slice(0, 2 * start).join('').length;
  // drugie imię za oknem („… Kadr Anna Maria Kowalska"): kolejna porcja i tak rozstrzyga osobę
  if (isFirstNameLike(nx)) return resume;
  const prefix = words.slice(0, start).map((w) => w.toLowerCase());
  const role = !NOUN_LIKE_FIRST_NAMES.has(first) && prefix.some((w) => ROLE_WORDS.has(w) || TITLE_WORDS.has(w));
  // Za nazwą organizacji bez roli („Stowarzyszenie Przyjaciół Szkoły Adam Mickiewicz") imię
  // i nazwisko to częściej patron niż osoba. Tylko gdy ciąg zaczyna się od rodzaju organizacji, także
  // po przymiotniku („Gminny Ośrodek Kultury Stefan Żeromski"); stanowisko w dopełniaczu instytucji
  // („Główny Księgowy Spółki Katarzyna Lis") to osoba.
  if (!role && (ORG_HEAD_WORDS.has(prefix[0]) || ORG_HEAD_WORDS.has(prefix[1] ?? ''))) return null;
  if (segs.some(isConfirmedSurname)) return resume;
  if (!role) return null;
  // Sama rola nie wystarcza, gdy dalej stoi nazwa instytucji: miasto w nazwie klubu („Prezes Klubu
  // Sportowego Lech Poznań"), wyraz z nazwy firmy („Agata Meble") albo forma prawna za nim.
  const after = ctx.text.slice(offset + m.length, offset + m.length + 80);
  const nxEnd = after.indexOf(nx) + nx.length;
  if (
    POLISH_CITIES.has(nl) ||
    segs.some((p) => COMPANY_TAIL_WORDS.has(p)) ||
    RE_LEGAL_FORM_AHEAD.test(after.slice(nxEnd))
  )
    return null;
  return resume;
}
/**
 * Patron ulicy lub placu (też wyliczenie „ulic X oraz Y") to eponim, nie osoba. Osoba w mianowniku
 * za nazwą ulicy („ul. Długiej Jan Kowalski zasłabł") nim nie jest, więc rozstrzyga miejsce imienia.
 * Zwraca nowy początek osoby albo gotowy wynik porcji.
 */
function startPastEponym(ctx: RedactCtx, m: string, offset: number, words: string[], parts: string[], start: number): number | string {
  // Ciąg od imienia patrona w dopełniaczu („W kościele św. Anny Jan Bednarz zagra"): osoba zaczyna
  // się od pierwszego imienia w mianowniku.
  let pastPatron = false;
  if (start === 0) {
    let j = 1;
    while (j < words.length && !(POLISH_FIRST_NAMES.has(words[j].toLowerCase()) && !isFirstNameGenitive(words[j].toLowerCase()))) j++;
    if (j >= words.length - 1) {
      // Samo nazwisko w mianowniku za patronem przed czasownikiem albo dopowiedzeniem po przecinku
      // („W kaplicy św. Rocha Bednarz poświęcił bramę") to podmiot: patron zostaje, maska na
      // nazwisku. Dopełniacz patrona kończy się samogłoską, wyraz na spółgłoskę to już osoba.
      // Miejscowość, forma prawna i wyraz uliczny zostają.
      const last = words[words.length - 1];
      const ll = last.toLowerCase();
      const after = ctx.text.slice(offset + m.length, offset + m.length + 24);
      if (
        words.length >= 2 &&
        !isFirstNameLike(last) &&
        // „-ej" to dopełniacz patronki („W kościele bł. Anny Kowalskiej odbyła się msza")
        /(?:[^aeiouyąęó]|(?:sk|ck|dzk)i)$/.test(ll) &&
        !/ej$/.test(ll) &&
        (RE_PAST_VERB_AFTER.test(after) ||
          (/^(?:[ \t]*,[ \t]*\p{Ll}|[ \t]+\p{Ll}{3,})/u.test(after) && !POLISH_CITIES.has(ll) && !LEGAL_ENTITY_WORDS.has(ll) && !RE_STREET_WORD.test(ll)))
      ) {
        ctx.bump('IMIE');
        return `${parts.slice(0, -1).join('')}${ctx.personMask(last)}`;
      }
      return m;
    }
    start = j;
    pastPatron = true;
  }
  // Patrona już pominięto; ponowne sprawdzenie od imienia widziałoby przed nim tego samego patrona.
  const nameAt = offset + parts.slice(0, 2 * start).join('').length;
  if (!pastPatron && precededByEponym(ctx.text, nameAt)) return m;
  return start;
}
/**
 * Imię i dopełniacz męskiego imienia w roli nazwiska („Świadek: Marek Pawła", „po Janie Pawła").
 * Imię w mianowniku albo innym przypadku zależnym niż dopełniacz wystarcza, bo dwa imiona stałyby
 * w tym samym przypadku („Jan Paweł"). Imię w dopełniaczu („wierzyciela Jana Pawła") tylko z rolą
 * albo bez patrona przed parą (genPairPersonFree), bo „Jana Pawła" bywa dwojgiem imion. Liczba
 * rzymska za parą to papież („Jan Pawła II"). Wyraz z wielkiej litery za parą to nazwisko, które
 * dalszy przebieg maskuje razem z oboma imionami.
 */
function maskFirstNameSurnamePair(ctx: RedactCtx, m: string, offset: number, words: string[], parts: string[], start: number, k: number, at: number): string | null {
  const f = words[start].toLowerCase();
  const g = words[k - 1].toLowerCase();
  const prev = RE_PREV_TOKEN.exec(ctx.text.slice(Math.max(0, at - 30), at));
  const prevTok = prev?.[1]?.toLowerCase();
  // etykieta z dwukropkiem także w środku wiersza („… / Pracownik: Ewa Pawła, …")
  const anchored =
    [...words.slice(0, start).map((w) => w.toLowerCase()), prevTok].some(
      (w) => !!w && (ROLE_WORDS.has(w) || TITLE_WORDS.has(w) || PARTY_ROLE_WORDS.has(w) || w === 'p'),
    ) ||
    (!!prev?.[2] && prev[1].length >= 2) ||
    personSlotBefore(ctx.text, at);
  const nomF = POLISH_FIRST_NAMES.has(f) && !isFirstNameGenitive(f);
  const genF = isFirstNameGenitive(f);
  const obliqueF = k - start === 2 && !nomF && !genF && !POLISH_FIRST_NAMES.has(f) && isFirstNameLike(f);
  const roleGen =
    !!prevTok && (CAPS_ROLE_OBLIQUE.has(prevTok) || prevTok === 'powództwa' || prevTok === 'wniosku' || prevTok === 'rzecz');
  const genFree = genF && !anchored && !roleGen && genPairPersonFree(ctx.text, at, offset + m.length, `${f} ${g}`);
  const capAfter = /^ +\p{Lu}/u.test(ctx.text.slice(offset + m.length, offset + m.length + 3));
  // Imię w celowniku, narzędniku albo miejscowniku i odmiana imienia z ruchomym „e" („Tomaszowi
  // Markowi", „Krzysztofowi Pawle"): drugi człon to nazwisko-homograf.
  const obliqueHomo = obliqueF && EXTRA_NAME_FORMS.has(g) && /(?:owi|em|le)$/.test(g) && isFirstNameLike(g);
  // Żeńskie imię w przypadku zależnym i męskie imię w mianowniku („z Anną Marek i Tomaszem Pawłem"):
  // żeńskie nazwisko-homograf się nie odmienia. Tylko w wyliczeniu osób albo z kotwicą, bo „Z Anną
  // Marek pojechał" to dwie osoby bez nazwisk.
  const femOblNom =
    obliqueF &&
    /(?:ą|ę|ie)$/.test(f) &&
    POLISH_FIRST_NAMES.has(g) &&
    !isFirstNameGenitive(g) &&
    !/a$/.test(g) &&
    !NOUN_LIKE_FIRST_NAMES.has(g) &&
    (anchored || /^[ \t]+(?:i|oraz)[ \t]+\p{Lu}/u.test(ctx.text.slice(offset + m.length, offset + m.length + 12)));
  const genSurname =
    (nomF || obliqueF || (genF && (anchored || roleGen || genFree))) && isMaleFirstNameGenitive(g) && !POLISH_FIRST_NAMES.has(g);
  const romanAfter = /^[ \t]+[IVX]{1,4}(?!\p{L})/u.test(ctx.text.slice(offset + m.length, offset + m.length + 8));
  if (!capAfter && !romanAfter && (obliqueHomo || femOblNom || genSurname)) return maskWordRange(ctx, parts, start, k - 1, words[k - 1]);
  return null;
}
/**
 * Miejscowość z rynkiem i numerem („Jarosław Rynek 5 to adres urzędu") to adres, ale Rynek bywa
 * też nazwiskiem. Adres tylko, gdy para stoi sama bez kotwicy osoby („Świadek Anna Rynek 5" to
 * osoba), a za nią po spacji stoi goły numer domu; liczba po tabulatorze to sąsiednia kolumna.
 */
function rynekAddressWithoutPerson(ctx: RedactCtx, m: string, offset: number, words: string[], start: number, k: number, at: number): boolean {
  const surname = words[k];
  if (
    k === words.length - 1 &&
    k - 1 === start &&
    /^(?:rynek|rynku)$/i.test(surname) &&
    // miejscowość albo wyraz spoza słownika imion (zapis bez ogonków „Jaroslaw")
    (POLISH_CITIES.has(words[k - 1].toLowerCase()) || !POLISH_FIRST_NAMES.has(words[k - 1].toLowerCase())) &&
    /^ +\d{1,3}[A-Za-z]?(?=[ \t]*(?:[,.;)]|$|[ \t]\p{Ll}))/u.test(ctx.text.slice(offset + m.length, offset + m.length + 12)) &&
    !rynekNoNotHouse(ctx.text.slice(offset + m.length, offset + m.length + 40).replace(/^ +\d{1,3}[A-Za-z]?/, ''))
  ) {
    const prev = RE_PREV_TOKEN.exec(ctx.text.slice(Math.max(0, at - 30), at));
    const pt = prev?.[1]?.toLowerCase();
    const anchored =
      (!!pt && (ROLE_WORDS.has(pt) || TITLE_WORDS.has(pt) || PARTY_ROLE_WORDS.has(pt) || RE_TOPONYM_PERSON_ROLE.test(pt))) ||
      !!prev?.[2] ||
      personSlotBefore(ctx.text, at);
    return !anchored;
  }
  return false;
}
/**
 * Toponim w kształcie „imię + przymiotnik" („Kazimierz Dolny leży nad Wisłą") to miejscowość,
 * chyba że stoi przy nim rola albo tytuł („od uczestnika Kazimierza Dolnego"), drugie imię („Jan
 * Kazimierz Dolny") albo dane osoby tuż za nim („Kazimierz Dolny (PESEL …)").
 */
function toponymWithoutPerson(ctx: RedactCtx, m: string, offset: number, words: string[], start: number, k: number): boolean {
  const surname = words[k];
  if (POLISH_CITIES.has(`${words[k - 1]} ${surname}`.toLowerCase())) {
    const prevTok = RE_PREV_TOKEN.exec(ctx.text.slice(Math.max(0, offset - 40), offset))?.[1]?.toLowerCase();
    const anchored =
      [...words.slice(0, start).map((w) => w.toLowerCase()), prevTok].some(
        (w) => !!w && (ROLE_WORDS.has(w) || TITLE_WORDS.has(w) || RE_TOPONYM_PERSON_ROLE.test(w)),
      ) ||
      k - 1 > start ||
      RE_PERSON_DATA_AHEAD.test(ctx.text.slice(offset + m.length, offset + m.length + 24));
    return !anchored;
  }
  return false;
}
/** Wynik porcji RE_NAME_SEQ: tekst z maską albo pozycja, od której skan rusza dalej (nameSeqTail). */
function nameSeqMask(ctx: RedactCtx, m: string, offset: number): string | number {
  // Podział zachowuje separatory (parzyste indeksy to wyrazy, nieparzyste odstępy): ciąg bywa dłuższy
  // niż osoba („Jan Kowalski\tWarszawa"), a tabulatory i wyrównanie kolumn muszą zostać.
  const { parts, words } = splitWords(m);
  let start = 0;
  while (start < words.length && !isFirstNameLike(words[start])) start++;
  if (start >= words.length) return m;
  if (precededByEponym(ctx.text, offset)) {
    const r = startPastEponym(ctx, m, offset, words, parts, start);
    if (typeof r === 'string') return r;
    start = r;
  }
  // wyraz uliczny wciągnięty do dopasowania („Rondo Romana Dmowskiego") to patron
  if (start > 0 && RE_STREET_WORD.test(words[start - 1])) return m;
  if (patronFirstNameAt(ctx.text, offset, parts, start)) return m;
  const at = offset + parts.slice(0, 2 * start).join('').length;
  let k = start;
  while (k < words.length && isFirstNameLike(words[k]) && !LEGAL_ENTITY_WORDS.has(words[k].toLowerCase())) k++;
  if (k >= words.length && (k - start === 2 || (k - start === 3 && isFirstNameGenitive(words[start + 1].toLowerCase())))) {
    const masked = maskFirstNameSurnamePair(ctx, m, offset, words, parts, start, k, at);
    if (masked !== null) return masked;
  }
  // same imiona bez nazwiska w porcji: zostaw albo oddaj ogon
  if (k >= words.length) return nameSeqTail(ctx, m, offset, words, parts, start) ?? m;
  const surname = words[k];
  // „Sp" to skrót formy prawnej („Kierownik Sklepu Ewa Sp. z o.o.")
  if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase()) || /^sp$/i.test(surname)) return m;
  if (rynekAddressWithoutPerson(ctx, m, offset, words, start, k, at)) return m;
  // Wiersz TSV w szyku „Nazwisko⇥Imię⇥Dział" („Nowak⇥Anna⇥Kardiologia"): wyraz za tabulatorem bez
  // dowodu nazwiska to sąsiednia kolumna, a nazwiskiem jest komórka przed imieniem. Rola, tytuł albo
  // nazwa pola w tej kolumnie nigdy nie jest nazwiskiem („Jan⇥Operator").
  if (parts[2 * k - 1].includes('\t') && !isConfirmedSurname(surname)) {
    const sl = surname.toLowerCase();
    const prev = start > 0 && parts[2 * start - 1].includes('\t') ? words[start - 1] : '';
    if (prev && isConfirmedSurname(prev) && !TSV_NOT_SURNAME.has(prev.toLowerCase())) return maskWordRange(ctx, parts, start - 1, k - 1, prev);
    if (isPersonRoleValue(sl)) return m;
  }
  if (toponymWithoutPerson(ctx, m, offset, words, start, k)) return m;
  return maskWordRange(ctx, parts, start, k, surname);
}
// Ciągi wyrazów z imieniem: porcja może oddać ogon, więc skan ręczny zamiast replace.
function maskNameSequences(ctx: RedactCtx): void {
  const src = ctx.text;
  let out = '';
  let last = 0;
  RE_NAME_SEQ.lastIndex = 0;
  for (let mm = RE_NAME_SEQ.exec(src); mm; mm = RE_NAME_SEQ.exec(src)) {
    const r = nameSeqMask(ctx, mm[0], mm.index);
    if (typeof r === 'number') {
      RE_NAME_SEQ.lastIndex = r; // tekst przed imieniem skopiuje następny krok
      continue;
    }
    out += src.slice(last, mm.index) + r;
    last = mm.index + mm[0].length;
  }
  RE_NAME_SEQ.lastIndex = 0;
  ctx.text = out + src.slice(last);
}
// Zdrobnienie spoza słownika imion i potwierdzone nazwisko („[12:10] Kuba Nowak: siema"). Przed parą
// RE_PAIR, bo ta zużywa „Napisał Kuba" i „Kowalski" zostaje sam. Nazwisko zamaskowałby też przebieg
// samodzielny; ten krok wciąga do maski zdrobnienie.
function maskNicknamePairs(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_NICK_PAIR, (m, _w1: string, w2: string, offset: number, t: string) => {
    if (!nicknamePairIsPerson(t, offset, m, w2)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w2);
  });
}
// Para „Wyraz Nazwisko" z nazwiskiem rozpoznanym po końcówce (-ski/-cki/-icz/-czyk) spoza słownika.
function maskSuffixSurnamePairs(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    // Nazwisko dwuczłonowe z obcym drugim członem („Świadek Kowalczyk-Müller"): końcówkę nazwiskową ma
    // pierwszy człon, a maska obejmuje oba. Tylko z literą spoza polskiego alfabetu w drugim członie,
    // więc „Choroba Leśniowskiego-Crohna" zostaje nazwą choroby. Przypadek i przymiotnik rozstrzyga
    // wtedy pierwszy człon („Wezwano Zielińską-Šimek").
    const hy = w2.indexOf('-');
    const foreignSecond = hy > 0 && RE_NON_PL_LETTER.test(w2.slice(hy)) && looksLikeSurname(w2.slice(0, hy)) && !isGeoAdjective(w2);
    // Strona postępowania przed przymiotnikiem ze stoplisty („Świadek Poleski zeznał"): rola wygrywa.
    // Tylko gdy dalej nie stoi nazwa z wielkiej litery („Pozwany Polski Związek …").
    const partyAdj =
      PARTY_ROLE_WORDS.has(w1.toLowerCase()) &&
      RE_DECLINED_NOM_SURNAME.test(w2.toLowerCase()) &&
      RE_AFTER_PARTY_ADJ.test(t.slice(offset + m.length, offset + m.length + 3));
    const w2s = looksLikeSurname(w2) || partyAdj ? w2 : foreignSecond ? w2.slice(0, hy) : '';
    if (!w2s) return m;
    // patron ulicy („ul. Jana Kilińskiego", też wyliczenie) albo w1 jako wyraz uliczny („Ronda Dmowskiego")
    if (precededByEponym(t, offset) || RE_STREET_WORD.test(w1)) return m;
    const w1l = w1.toLowerCase();
    // miejscowość dwuczłonowa („Piotrków Trybunalski") i nazwa parku („Słowiński Park Narodowy";
    // przymiotnik bywa też nazwiskiem, więc nie na stopliście)
    if (POLISH_CITIES.has(`${w1l} ${w2.toLowerCase()}`)) return m;
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    // w1 z oryginalnym odstępem (tabulator, kilka spacji), gdy zostaje przed maską
    const kept = m.slice(0, m.length - w2.length);
    if (RE_SURNAME_OBLIQUE.test(w2s.toLowerCase())) {
      // przymiotnik odmiejscowy po rzeczowniku („Starosty Wołomińskiego") to nazwa urzędu
      if (isGeoAdjective(w2s)) return m;
      // Znany eponim po głowie („Odruch Babińskiego") i dwuczłonowy eponim („Zespół Guillaina-Barrégo")
      // to nazwa, nie osoba. Tylko w dopełniaczu, bo w mianowniku „Objaw Kowalska" to osoba. Nazwisko
      // osoby rozpoznanej już w piśmie wygrywa z patronem mostu (patrz afterNonPersonContext).
      const knownOnBridge = w1l === 'moście' && ctx.maskedSurnames.has(normalizeSurnameKey(w2));
      if ((EPONYM_HEADS.has(w1l) && (eponymFits(w1l, w2) || w2s !== w2)) || (w1l === 'moście' && !knownOnBridge)) return m;
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`;
    }
    return nominativeSurnamePairMask(ctx, m, w1, w2, w1l, kept, offset, t);
  });
}
// Para z nazwiskiem w mianowniku: czy pierwszy wyraz zostaje przed maską, czy maska obejmuje oba.
function nominativeSurnamePairMask(ctx: RedactCtx, m: string, w1: string, w2: string, w1l: string, kept: string, offset: number, t: string): string {
  if (LEGAL_ENTITY_WORDS.has(w1l)) return m; // „Nowa Ruda", „Izba …"
  // Granica komórki między wyrazami („Noc⇥Kaczyński", „Rano  Sosnowska  Oddział Wewnętrzny"):
  // sąsiednia kolumna nie tworzy z nazwiskiem nazwy własnej. Spacje liczą się od trzech albo od dwóch,
  // gdy wiersz ma drugą taką przerwę (pojedyncza podwójna spacja to częsta literówka z PDF).
  const cell = kept.includes('\t') || columnGapBetween(kept, t, offset);
  if (PROPER_NAME_HEADS.has(w1l)) {
    // Spacje rozdzielają komórki tylko w grafiku („Noc      Brzozowska"); w prozie „Kościół   Mariacki"
    // to dalej jedna nazwa.
    const headCell = kept.includes('\t') || (w1l === 'noc' && cell);
    // Przymiotnik uzgodniony z rodzajem głowy to człon nazwy („Puszcza Białowieska"); nieuzgodniony
    // („Noc Brzozowski spędził w celi") albo rzeczownik („Brama Wąsowicz") to nazwisko.
    if (!headCell && headAgreesWithAdjective(w1l, w2.toLowerCase()) && !properNamePairIsPerson(ctx, t, offset, m, w1l, w2)) return m;
    ctx.bump('IMIE');
    return `${kept}${ctx.personMask(w2)}`;
  }
  if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l)) {
    ctx.bump('IMIE');
    return `${kept}${ctx.personMask(w2)}`; // „Prezes Gzowski"
  }
  if (NON_NAME_LEADERS.has(w1l) || RE_VERB_1ST_PERSON.test(w1l)) {
    // „Odwiedziliśmy Biebrzański Park Narodowy": przymiotnik przed nazwą instytucji to jej człon, ale
    // tylko w jednej frazie; po granicy komórki formy prawnej się nie szuka. Firma z nazwiskiem
    // właściciela („Dziś Gzowski Zakład Usługowy") nie robi z nazwiska przymiotnika, chyba że to
    // przymiotnik geograficzny.
    const next = cell ? undefined : RE_NEXT_CAP_WORD_1SP.exec(t.slice(offset + m.length, offset + m.length + 60))?.[1];
    const nextL = next?.toLowerCase() ?? '';
    if (next && LEGAL_ENTITY_WORDS.has(nextL) && !NOUN_NAME_LEADERS.has(w1l) && !(OWNER_FIRM_HEADS.has(nextL) && !isGeoAdjective(w2))) return m;
    ctx.bump('IMIE');
    return `${kept}${ctx.personMask(w2)}`; // „Wczoraj Kowalski", „Sąsiad Kowalski"
  }
  // Wyraz z literą spoza polskiego alfabetu („Señor Kowalski") to zwykle tytuł albo nazwa, a nie
  // rzadkie imię; znane obce imiona („José") nie. Nazwa pola albo nagłówek kolumny („Nazwisko⇥Kowalski")
  // to etykieta. W obu przypadkach wyraz zostaje przed maską.
  if ((RE_NON_PL_LETTER.test(w1) && !FOREIGN_GIVEN_NAMES.has(w1l)) || FORM_LABEL_WORDS.has(w1l) || TABLE_HEADER_WORDS.has(w1l)) {
    ctx.bump('IMIE');
    return `${kept}${ctx.personMask(w2)}`;
  }
  ctx.bump('IMIE');
  return pairCellMask(m, w2, ctx.personMask(w2)); // rzadkie imię i nazwisko w mianowniku: oba
}
// Odwrócona kolejność „Nazwisko Imię", częsta w nagłówkach e-maili.
function maskReversedPairs(ctx: RedactCtx): void {
  let lineStarts: number[] | undefined;
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    if (!isFirstNameLike(w2)) return m;
    const w1l = w1.toLowerCase();
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2.toLowerCase())) return m;
    // Patron instytucji w wierszu nagłówka („Do: Hospicjum im. Jana Pawła II") to nie „Nazwisko Imię"
    // adresata. Bez nagłówka para i tak zostaje, więc strażnik tylko wyrównuje oba przypadki.
    if (precededByEponym(t, offset)) return m;
    if (
      !surnameBase(w1) &&
      !looksLikeSurname(w1) &&
      !inMailHeaderLine(t, offset, (lineStarts ??= lineStartsOf(t))) &&
      !stoplistedSurnameAnchored(t, offset, m, w1, w2) &&
      !reversedHomographAnchored(t, offset, w1l, w2.toLowerCase())
    )
      return m;
    ctx.bump('IMIE');
    return pairCellMask(m, w2, ctx.personMask(w1)); // klucz: nazwisko, czyli pierwszy wyraz
  });
}
// Zapis rekordu „Nazwisko, Imię" jako cała komórka: wiersz listy, pole CSV, wartość XML/JSON, adresat
// w nagłówku („To: Grabowski, Rafał <…>").
function maskCommaPairs(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_PAIR_COMMA, (m, w1: string, w2: string, w3: string | undefined, offset: number, t: string) => {
    if (!commaPairIsPerson(t, offset, m, w1, w2, w3)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1);
  });
}
// Imię i nazwisko małymi literami (czaty, e-maile, formularze).
function maskLowercasePairs(ctx: RedactCtx): void {
  const surnameLikeLo = (w: string): boolean =>
    !NON_SURNAME_ADJ.has(w) &&
    !LEGAL_ENTITY_WORDS.has(w) &&
    (surnameShaped(w) || (w.includes('-') && w.split('-').some(surnameShaped)));
  ctx.text = ctx.text.replace(RE_LOWER_RUN, (m) => {
    const words = m.split(/([ \t]+)/); // parzyste indeksy to wyrazy, nieparzyste separatory
    let changed = false;
    for (let i = 0; i + 2 < words.length; i += 2) {
      const w1 = words[i];
      const w2 = words[i + 2];
      const w1l = w1.toLowerCase();
      if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l)) continue;
      if (!isFirstNameLike(w1) || !surnameLikeLo(w2.toLowerCase())) continue;
      ctx.bump('IMIE');
      words[i] = ctx.personMask(w2);
      words[i + 1] = '';
      words[i + 2] = '';
      changed = true;
      i += 2;
    }
    return changed ? words.join('') : m;
  });
}
function maskMaidenNames(ctx: RedactCtx): void {
  ctx.text = ctx.text.replace(RE_MAIDEN_NAME, (m, first: string, domuSurname: string | undefined, genplSurname: string | undefined) => {
    if (!isFirstNameLike(first)) return m;
    const surname = domuSurname ?? genplSurname ?? '';
    if (!surname || LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
    // „Anna z domu Pomocy Społecznej" to instytucja „Dom …", nie nazwisko panieńskie
    if (domuSurname && MAIDEN_NOT_SURNAME.has(domuSurname.toLowerCase())) return m;
    ctx.bump('IMIE');
    return ctx.personMask(surname); // klucz: nazwisko panieńskie
  });
}
export function passPersonPairs(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  maskSpouses(ctx);
  maskNameSequences(ctx);
  maskNicknamePairs(ctx);
  maskSuffixSurnamePairs(ctx);
  maskReversedPairs(ctx);
  maskCommaPairs(ctx);
  maskLowercasePairs(ctx);
  maskMaidenNames(ctx);
}
