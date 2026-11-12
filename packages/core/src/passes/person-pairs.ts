import { HOMOGRAPH_SURNAMES, NON_SURNAME_ADJ, homographBase, isGeoAdjective, looksLikeSurname, normalizeSurnameKey, surnameBase } from '../surnames.js';
import { CAP_WORD, NM_BOUND, PL_LO, PL_UP } from '../charset.js';
import { indexToLetters, type RedactCtx, URL_SENTINEL_CLOSE, URL_SENTINEL_OPEN } from '../context.js';
import { FORM_LABEL_WORDS } from '../dict/forms.js';
import { EXTRA_NAME_FORMS, FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, isMaleFirstNameGenitive, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { afterNonPersonContext, EPONYM_HEADS, eponymFits, precededByAdminLabel, precededByPatron, precededByStreetEponym, RE_STREET_WORD } from '../guards/eponyms.js';
import { cellEndsAt, cellStartsBefore, HOMOGRAPH_PAIR_EXCL, institutionLabelBefore, LIST_HEAD_NOT_SURNAME, ORG_HEAD_WORDS, PATRON_GEN_HEADS, RE_PAST_VERB_AFTER, RE_SAINT_WORD_BEFORE } from '../guards/person-context.js';
import { columnGapBetween, headAgreesWithAdjective, LEGAL_ENTITY_WORDS, NON_NAME_LEADERS, NOUN_NAME_LEADERS, OWNER_FIRM_HEADS, PARTY_ROLE_WORDS, PROPER_NAME_HEADS, properNamePairIsPerson, RE_AFTER_PARTY_ADJ, RE_FOLLOWED_BY_PARK, RE_NEXT_CAP_WORD_1SP, RE_VERB_1ST_PERSON, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { RE_PATRON_ROMAN_REF_BEFORE, rynekNoNotHouse } from './address.js';
import { isPersonRoleValue, NOUN_LIKE_NAMES_IN_TITLES } from './forms.js';
import { CAPS_REVERSED_HEAD_EXCL, CAPS_ROLE_OBLIQUE, capsOrgHead, MAIDEN_NOT_SURNAME, personSlotBefore } from './person-caps-ocr.js';
import { TABLE_HEADER_WORDS } from './person-triggers.js';
import { RE_LOWER_RUN, RE_NAME_SEQ, RE_NEXT_CAP_WORD, RE_NEXT_CAP_WORD_SP, RE_NON_PL_LETTER, RE_PAIR, RE_SPOUSES, RE_SURNAME_OBLIQUE } from '../person-patterns.js';


// ═══════════════════ FAZA 4 · IMIĘ I NAZWISKO (heurystyka) ═══════════════════
// Role procesowe i umowne (też w dopełniaczu) przed toponimem-nazwiskiem („od uczestnika Kazimierza
// Dolnego", „Pracodawca: Kazimierz Dolny", „Dzierżawca: …") — uzupełnia ROLE_WORDS w kroku (a).
const RE_TOPONYM_PERSON_ROLE =
  /^(?:pracodawc\p{L}*|dzierżawc\p{L}*|wydzierżawiając\p{L}*|uczestnik\p{L}*|pozwan\p{L}*|powod\p{L}*|wnioskodawc\p{L}*|oskarżon\p{L}*|świadk\p{L}*|pełnomocnik\p{L}*|najemc\p{L}*|wynajmując\p{L}*|zleceniobiorc\p{L}*|zleceniodawc\p{L}*|dłużnik\p{L}*|wierzyciel\p{L}*|właściciel\p{L}*|pracownik\p{L}*|sprzedawc\p{L}*|nabywc\p{L}*|kupując\p{L}*|obywatel\p{L}*|lokator\p{L}*)$/u;
// Dane osoby tuż za ciągiem („Kazimierz Dolny (PESEL …)", „…, ur. 03.03.1950", „…, zam. ul. …").
const RE_PERSON_DATA_AHEAD = /^[ \t]*[,(]?[ \t]*(?:PESEL|ur\.|urodzon|zam\.|zamieszka|syn |córka )/iu;
// Początek wiersza albo punkt listy („1. ", „- ") przed wpisem.
const RE_LINE_HEAD_ONLY = /(?:^|\n)[ \t]*(?:(?:\d{1,4}[.)]|[-*•–])[ \t]*)?$/;
// Etykieta roli z dwukropkiem tuż przed wpisem („Wnioskodawca: ", „Świadek: ").
const RE_ROLE_LABEL_BEFORE = /(\p{L}+)[ \t]*:[ \t]*$/u;
/**
 * Czy wpis „Przymiotnik-ze-stoplisty Imię" to osoba w szyku „Nazwisko Imię" („Wnioskodawca:
 * Białowieski Jan", „1. Poleski Jan", „Strażacki Jan, ur. …")? Przymiotnik relacyjny czy odmiejscowy
 * bywa nazwiskiem (Mazowiecki, Rybacki, Lekarski), a stoplista wygrywała z mocną kotwicą osoby. Tylko
 * z kotwicą: rola z dwukropkiem, „Pan/Pani" przed, dane osoby za, albo sam wpis w wierszu (listy).
 * W samym wierszu imię-rzeczownik z typowej nazwy („Olimpijska Nadzieja") nie wystarcza.
 */
function stoplistedSurnameAnchored(t: string, offset: number, m: string, w1: string, w2: string): boolean {
  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (!/(?:sk|ck|dzk)[ia]$/.test(w1l) || !isGeoAdjective(w1l)) return false;
  if (!POLISH_FIRST_NAMES.has(w2l) || isFirstNameGenitive(w2l)) return false;
  const end = offset + m.length;
  if (RE_PERSON_DATA_AHEAD.test(t.slice(end, end + 24))) return true;
  // wycięte okno nie zaczyna wiersza — znak \0 blokuje „^" w RE_LINE_HEAD_ONLY
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

// „Nazwisko, Imię[ Imię]" — przecinek bez odstępu przed nim, po nim odstęp (CSV „Kowalski,Jan"
// to dwie kolumny, nie jedna komórka).
const RE_PAIR_COMMA = new RegExp(
  `(?<![${NM_BOUND}-])(${CAP_WORD}),[ \\t]+(${CAP_WORD})(?:[ \\t]+(${CAP_WORD}))?(?![${NM_BOUND}])`,
  'g',
);
/**
 * Czy „Nazwisko, Imię" na pozycji `offset` to jedna osoba zapisana jak w rekordzie? Dawniej
 * nazwisko maskował przebieg samodzielny, a imię po przecinku zostawało jawne obok maski
 * („[IMIĘ I NAZWISKO], Jan"), homograf („Lis, Jakub") wyciekał w całości, a lista „Kowalski, Jan⏎
 * Wiśniewska, Ewa" sklejała się w jeden wiersz przez domknięcie imienia w lewo. Warunki: para
 * stanowi całą komórkę, imię jest w mianowniku (w prozie „z Kowalskim, Janem i Anną" to dwie osoby),
 * pierwszy wyraz ma dowód nazwiska (słownik, końcówka, homograf). Sam nagłówek „Do:" dowodem nie
 * jest: „Do: Sekretariat, Ewa", „To: Marketing, Ewa" zostają.
 */
function commaPairIsPerson(t: string, offset: number, m: string, w1: string, w2: string, w3: string | undefined): boolean {
  const w1l = w1.toLowerCase();
  const w2l = w2.toLowerCase();
  if (!POLISH_FIRST_NAMES.has(w2l) || (w3 && !POLISH_FIRST_NAMES.has(w3.toLowerCase()))) return false;
  if (!cellStartsBefore(t, offset) || !cellEndsAt(t, offset + m.length)) return false;
  if (isFirstNameLike(w1) || TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2l)) return false;
  if (isGeoAdjective(w1l) || LIST_HEAD_NOT_SURNAME.has(w1l)) return false;
  const parts = w1l.split('-');
  const proven = parts.some((p) => !!surnameBase(p) || looksLikeSurname(p));
  // homograf tylko z imieniem, które nie jest też rzeczownikiem („Kwiaty: Kalina, Róża")
  const homograph = !NOUN_LIKE_FIRST_NAMES.has(w2l) && parts.some((p) => HOMOGRAPH_SURNAMES.has(p));
  if (!proven && !homograph) return false;
  if (institutionLabelBefore(t, offset)) return false;
  return !precededByPatron(t, offset) && !precededByStreetEponym(t, offset);
}

/**
 * Zdrobnienia, które celowo NIE są w POLISH_FIRST_NAMES (kraj „Kuba", „Kuba Libre", „Maks.",
 * „Ada" jako język programowania, krótkie „Ola/Iza/Ela"). Tylko mianownik Titlecase i tylko
 * w parze z nazwiskiem potwierdzonym słownikiem albo końcówką: wpis do słownika imion dałby
 * formy „Kubie/Kubą" i każdy wyraz z wielkiej litery po „Kuba" jako nazwisko.
 */
const PAIR_ONLY_NICKNAMES = 'Kuba|Ola|Ula|Iza|Ela|Ala|Aga|Ada|Kaja|Majka|Mati|Maks|Jasiek';
const RE_NICK_PAIR = new RegExp(`(?<![${NM_BOUND}-])(${PAIR_ONLY_NICKNAMES})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
/**
 * Czy „Zdrobnienie Nazwisko" to osoba? Nazwisko potwierdzone słownikiem albo końcówką (sam
 * homograf „Kuba Lis", „Ada Zając" bez kotwicy zostaje), bez przymiotnika odmiejscowego („Kuba
 * Mazowiecki", „Ola Polska") i kontekstu ulicy czy patrona. Imię za nazwiskiem („Kierunek: Kuba
 * Nowak Jan") oznacza szyk „Nazwisko Imię" — zdrobnienie stoi wtedy przed osobą, a nie w niej.
 */
function nicknamePairIsPerson(t: string, offset: number, m: string, w2: string): boolean {
  const parts = w2.toLowerCase().split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || ROLE_WORDS.has(p) || TITLE_WORDS.has(p) || isGeoAdjective(p))) return false;
  // w nazwisku dwuczłonowym homograf obok potwierdzonego członu też jest nazwiskiem („Nowak-Lis")
  const proven = (p: string): boolean => !!surnameBase(p) || looksLikeSurname(p);
  if (!parts.some(proven) || !parts.every((p) => proven(p) || (parts.length > 1 && HOMOGRAPH_SURNAMES.has(p)))) return false;
  if (precededByPatron(t, offset) || precededByStreetEponym(t, offset) || precededByAdminLabel(t, offset)) return false;
  if (afterNonPersonContext(t, offset, w2)) return false;
  const next = RE_NEXT_CAP_WORD_SP.exec(t.slice(offset + m.length, offset + m.length + 40))?.[1];
  return !(next && isFirstNameLike(next));
}

const RE_MAIL_HEADER_HEAD = /^\s*(to|do|od|from|cc|dw|odbiorca|nadawca|adresat|wysłano|sent)\s*:/i;
/** Początki wierszy tekstu, rosnąco — liczone raz na przebieg, przeszukiwane binarnie. */
function lineStartsOf(t: string): number[] {
  const starts = [0];
  for (let i = t.indexOf('\n'); i !== -1; i = t.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}
/**
 * Czy wiersz z pozycją `offset` zaczyna się nagłówkiem wiadomości („To:", „Do:", „Od:" …)? Początek
 * wiersza z tablicy `starts` (lineStartsOf tego samego tekstu): lastIndexOf po całym tekście przy
 * każdej parze był kwadratowy w jednym długim wierszu („Anna Jan Anna Jan …" — 400 ms na 140 tys.
 * znaków), a okno 1000 znaków gubiło dalszych adresatów długiego wiersza „Do:" (Outlook drukuje
 * kilkudziesięciu adresatów „Nazwisko Imię; …" w jednym wierszu).
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
  // etykieta stoi na początku wiersza — wystarczy jego początek, nie cały wiersz do pozycji
  return RE_MAIL_HEADER_HEAD.test(t.slice(ls, Math.min(offset, ls + 64)));
}
// Nazwa instytucji z imieniem w środku po samej roli („Prezes Zarządu Spółki Marek Trans", „Dyrektor
// Sportowy Klubu Lech Poznań", „Prezes Zarządu Firmy Adam Sp. z o.o.") rozpoznaje wyraz kończący nazwę
// firmy („Meble", „Holding", „Group", „Browary") albo forma prawna za nim. Sama instytucja
// w dopełniaczu przed imieniem niczego nie rozstrzyga: „Prezes Zarządu Spółki Anna Wrona" to członek
// zarządu z odpisu KRS, a nazwisko-homograf nie przechodzi testu słownika.
const COMPANY_TAIL_WORDS = new Set<string>(
  (
    'trans bud meble moda holding group grupa browary dystrybucja logistics logistyka service serwis ' +
    'auto med invest development consulting design studio system systems tech media travel transport ' +
    'energia sport'
  ).split(' '),
);
const RE_LEGAL_FORM_AHEAD = /^[ \t]*(?:\.[ \t]*)?(?:S\.?A\.?|[Ss][Pp]\.|[Ss]\.?[Cc]\.|S\.?K\.?A\.?|Group|Holding)(?![\p{L}])/u;
// Tytuły duchowne między głową nazwy a imieniem patrona („Muzeum ks. Jerzego Popiełuszki",
// „Sanktuarium bł. ks. Jerzego …", „kościele pw. bł. ks. …"): głową jest wyraz przed nimi.
const RE_CLERIC_RANKS_TAIL = /(?:(?<!\p{L})(?:ks|bł|św|sw|bp|abp|kard|o)\.[ \t]*)+$/iu;
/**
 * Czy imię na pozycji `start` ciągu to imię PATRONA: świętego („Katedra Świętego Jerzego
 * Męczennika", „Sobór św. Jerzego Zwycięzcy"), patrona obiektu lub instytucji („Pomnik Jerzego
 * Popiełuszki", „Fundacja Jerzego Owsiaka")? Drugie tylko dla imienia w przypadku zależnym — osoba
 * w mianowniku za nazwą instytucji („Fundacja … Prezes Jan Kowalski") rozstrzyga nameSeqTail.
 * Numer domu za parą („Tadeusza Kościuszki 5 m. 3") nie czyni z niej patrona: ulicę z numerem
 * rozstrzyga wcześniej patronStreetWithNumber ([ADRES]), a para, z której adres nie powstał, zostaje
 * osobą. Dawniej numer zdejmował maskę osoby także tam, gdzie adresu nie było, i ulica z lokalem
 * wyciekała w całości („Lokator Adama Mickiewicza 30 m. 2 zalega …", „Tadeusza Kościuszki 30
 * w Krakowie.").
 */
function patronFirstNameAt(t: string, offset: number, _m: string, parts: string[], start: number): boolean {
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
/**
 * Maska ciągu wyrazów osoby od `from` do `to` (indeksy wyrazów w podziale z separatorami).
 * Tabulator w ciągu to granica komórki TSV („Adam⇥Kowalczyk⇥Magazynier"): każda komórka dostaje
 * własną maskę z tym samym kluczem, a tabulatory zostają — inaczej wiersz tracił kolumnę i dane
 * przesuwały się pod cudze nagłówki.
 */
// Homografy kalendarza i narodowości przed imieniem w grafiku czy liście („Maj⇥Anna", „Sobota⇥Marek",
// „Polak⇥Jan") — kolumna dnia albo obywatelstwa, nie nazwisko.
export const TSV_NOT_SURNAME = new Set<string>('maj sobota piątek niedziela środa wtorek poniedziałek czwartek polak polka niemiec czech rusin litwin węgier'.split(' '));
export const tsvSurnameProof = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w));
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
 * Kierownik", „Pracownik: Mazur Grzegorz"). Imię w mianowniku, homograf spoza kalendarza, urzędów
 * i narodowości; bez etykiety albo numeru wpisu („Kot Anny spał", „Król Zygmunt August") nie.
 */
function reversedHomographAnchored(t: string, offset: number, w1l: string, w2l: string): boolean {
  if (!POLISH_FIRST_NAMES.has(w2l) || isMaleFirstNameGenitive(w2l) || NOUN_LIKE_FIRST_NAMES.has(w2l)) return false;
  const hb = homographBase(w1l);
  if (!hb || hb !== w1l || HOMOGRAPH_PAIR_EXCL.has(hb) || CAPS_REVERSED_HEAD_EXCL.has(hb) || isFirstNameLike(w1l)) return false;
  return personSlotBefore(t, offset);
}
// Postacie literackie i artyści znani pod imieniem z przydomkiem („Przygody Tomka Sawyera",
// „Kubuś Puchatek", „Staś Tarkowski", „Pan Wołodyjowski"). Odmiana zdrobnień i zapis bez ogonków
// zrobiły z nich osobę w prozie, choć to tytuł albo bohater lektury. Zbiór zamknięty, tylko pary,
// których nie nosi strona pisma (sam „Tarkowski" bywa nazwiskiem, więc zawsze ze zdrobnieniem
// z lektury; „Michał Anioł" to też zwykłe imię i nazwisko, więc go tu nie ma). Rola, etykieta albo
// dane osoby przy parze rozstrzygają za osobą. Para trafia za sentinel URL i wraca jawna na końcu.
const FICTIONAL_PAIRS_SRC = [
  'tom(?:ek|ka|kowi|kiem|ku)[ \\t]+(?:sawyer(?:a|owi|em|ze)?|wilmowsk(?:i|iego|iemu|im))',
  'kubu(?:ś|sia|siowi|siem|siu)[ \\t]+puchat(?:ek|ka|kowi|kiem|ku)',
  'sta(?:ś|sia|siowi|siem|siu)[ \\t]+tarkowsk(?:i|iego|iemu|im)',
  'ani(?:a|i|ę|ą|u)[ \\t]+shirley',
  'pan(?:a|u|em|ie)?[ \\t]+wołodyjowsk(?:i|iego|iemu|im)',
];
// Każda litera z ogonkiem także w zapisie ASCII („Kubus Puchatek", „Michalem Aniolem").
const foldClass = (s: string): string =>
  s.replace(/[ąćęłńóśźż]/g, (c) => `[${c}${'acelnoszz'['ąćęłńóśźż'.indexOf(c)]}]`);
const RE_FICTIONAL_PAIR = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FICTIONAL_PAIRS_SRC.map(foldClass).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
export function passProtectFictional(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_FICTIONAL_PAIR, (m, offset: number, t: string) => {
    const prev = /(\p{L}+)\.?[ \t]*:?[ \t]*$/u.exec(t.slice(Math.max(0, offset - 40), offset))?.[1]?.toLowerCase();
    if (prev && (ROLE_WORDS.has(prev) || TITLE_WORDS.has(prev) || PARTY_ROLE_WORDS.has(prev))) return m;
    if (personSlotBefore(t, offset) || RE_PERSON_DATA_AHEAD.test(t.slice(offset + m.length, offset + m.length + 24))) return m;
    const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
    ctx.protectedUrls.push(m);
    return sentinel;
  });
}
// Postacie historyczne z dwoma imionami w dopełniaczu („za panowania Zygmunta Augusta", „kościół
// Jana Chrzciciela") — bez kotwicy osoby za parą to nie strona pisma.
const HISTORIC_DOUBLE_NAMES_GEN = new Set<string>(
  ['jana kazimierza', 'zygmunta augusta', 'stanisława augusta', 'jana olbrachta', 'władysława hermana', 'jana chrzciciela', 'jana nepomucena', 'jana ewangelisty', 'jana sebastiana', 'jana henryka', 'jana józefa'],
);
// Kotwica osoby tuż ZA parą: data urodzenia, PESEL, adres zamieszkania, ojcostwo, wiek.
const RE_GEN_PAIR_PERSON_AFTER =
  /^[ \t]*(?:\([ \t]*(?:ur\.|urodz|PESEL|lat[ \t]|zam\.)|,[ \t]*(?:ur\.|urodz\p{L}*|PESEL|nr[ \t]+PESEL|zam\.|zamieszka\p{L}*|syn(?:a|em)?|córk\p{L}*|lat[ \t]+\d|l\.[ \t]*\d|s\.[ \t]*\p{Lu}|c\.[ \t]*\p{Lu}|tel\.|legitymując\p{L}*|posiadając\p{L}*|nr[ \t]+dowodu|dow\.))/u;
// Wyraz tuż przed parą, po którym imię w dopełniaczu to patron albo dzieło, a nie osoba: skrót
// „im./ul./św.", wyraz uliczny, głowa nazwy z patronem i odsyłacz do pism albo wydarzeń.
const RE_GEN_PAIR_PATRON_BEFORE =
  /(?<!\p{L})(?:im|imienia|ul|al|pl|os|św|sw|bł|bl|ks|abp|bp|o(?=\.)|pw|papież\p{L}*|świę?t\p{L}*|błogosławion\p{L}*|panowani\p{L}*|czas\p{L}*|epok\p{L}*|dynasti\p{L}*|kr[oó]l\p{L}*|ulic\p{L}*|alej\p{L}*|alei|plac\p{L}*|osiedl\p{L}*|rond\p{L}*|skwer\p{L}*)\.?[ \t]*$/iu;
/**
 * Czy para „imię w dopełniaczu + dopełniacz imienia" bez roli przed nią to osoba (jak w v0.46.23)?
 * Nie, gdy przed nią stoi patron, ulica, instytucja albo odsyłacz do pism („Szkoła im. Jana Pawła",
 * „Encyklika Jana Pawła", „Pomnik …"); postać historyczna z dwoma imionami tylko z kotwicą za parą.
 */
function genPairPersonFree(t: string, at: number, end: number, pair: string): boolean {
  // Wyliczenie rodziców („córka Piotra Pawła i Anny Marii") i szyk rekordu z nazwiskiem przed parą
  // („Wniosek Kowalskiego Stanisława Jana") maskują dalsze przebiegi w całości, nie po kawałku.
  // Tylko gdy dalej stoi drugie imię albo dwa imiona bez nazwiska; osoba z nazwiskiem w wyliczeniu
  // („Piotra Pawła i Annę Nowak", „… i Tomasza Lisa") nie zdejmuje maski z pary.
  const enumNext = /^[ \t]+(?:i|oraz)[ \t]+(\p{Lu}\p{Ll}+)(?:[ \t]+(\p{Lu}\p{Ll}+))?/u.exec(t.slice(end, end + 40));
  if (enumNext && (!isFirstNameLike(enumNext[1]) || !enumNext[2] || (isFirstNameLike(enumNext[2]) && !surnameBase(enumNext[2])))) return false;
  const prevCap = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, at - 30), at))?.[1]?.toLowerCase();
  if (prevCap && !isFirstNameLike(prevCap) && (!!surnameBase(prevCap) || looksLikeSurname(prevCap))) return false;
  if (RE_GEN_PAIR_PERSON_AFTER.test(t.slice(end, end + 30))) return true;
  if (HISTORIC_DOUBLE_NAMES_GEN.has(pair)) return false;
  const before = t.slice(Math.max(0, at - 40), at);
  // odsyłacz do pism i wydarzeń („Encyklika …", „Pielgrzymka …") tylko przy papieżu
  if (RE_GEN_PAIR_PATRON_BEFORE.test(before) || (pair === 'jana pawła' && RE_PATRON_ROMAN_REF_BEFORE.test(before))) return false;
  // ulica papieża po przyimku miejsca („jestem na Jana Pawła, za rogiem", „skręć w Jana Pawła")
  if (pair === 'jana pawła' && /(?<!\p{L})(?:na|w|z|ze)[ \t]+$/iu.test(before)) return false;
  const prev = /(\p{L}+)[ \t]+$/u.exec(before)?.[1]?.toLowerCase();
  if (prev && (PATRON_GEN_HEADS.has(prev) || capsOrgHead(prev))) return false;
  return true;
}
export function passPersonPairs(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  // (a0) „Imię i Imię Nazwisko" — małżonkowie/rodzeństwo o WSPÓLNYM nazwisku („Anna i Jan Kowalscy").
  ctx.text = ctx.text.replace(RE_SPOUSES, (m, a: string, mid: string, b: string, c: string, offset: number, t: string) => {
    if (!isFirstNameLike(a) || !isFirstNameLike(b)) return m;
    if (LEGAL_ENTITY_WORDS.has(c.toLowerCase())) return m;
    // Nazwisko w liczbie mnogiej („Annę Marię i Jana Kowalskich", „Annie Marii i Janowi Kowalskim",
    // „Krystyny Ewy i Stanisława Mazurów") to wspólne nazwisko małżonków: pierwszy człon jest wtedy
    // drugim imieniem pierwszej osoby, a nie nazwiskiem poprzedniej. Bez tego obie strażnice niżej
    // zostawiały pierwszą osobę jawną. „-skim" jest liczbą mnogą przy imieniu w celowniku; przy
    // narzędniku („Janem Kowalskim") tylko za żeńskim drugim imieniem („z Anną Marią i Janem
    // Kowalskim"), bo „Tomaszem Markiem i Janem Kowalskim" to dwie osoby.
    const cl = c.toLowerCase();
    const pluralSurname =
      /(?:[sc]kich|dzkich|[sc]kimi|dzkimi|ów|owie)$/.test(cl) || (/(?:[sc]kim|dzkim)$/.test(cl) && (/(?:owi|u|ie)$/.test(b.toLowerCase()) || /ą$/.test(a.toLowerCase())));
    // Dwie osoby z dwoma imionami („córka Piotra Pawła i Anny Marii"): pierwszy wyraz to drugie imię
    // poprzedniej osoby, a trzeci to drugie imię drugiej, nie wspólne nazwisko. Wspólny klucz robił
    // z ojca i matki jedną osobę, a „Piotra" odrywało się od swojej maski.
    if (!pluralSurname && isFirstNameLike(c) && !surnameBase(c)) {
      const prev = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
      if (prev && isFirstNameLike(prev)) return m;
    }
    // Imię przed pierwszym członem, który nie jest imieniem w mianowniku („Piotra Pawła i Annę
    // Nowak", „Tomaszem Markiem i Anną Nowak", „Piotrowi Markowi i Annie Nowak"): pierwszy człon to
    // nazwisko poprzedniej osoby (homograf imienia w odmianie), nie imię drugiej osoby o wspólnym
    // nazwisku. Wspólny klucz sklejał dwie różne osoby w jeden pseudonim.
    const al = a.toLowerCase();
    if (!pluralSurname && (!POLISH_FIRST_NAMES.has(al) || isFirstNameGenitive(al))) {
      const prev = /(\p{Lu}\p{Ll}+)[ \t]+$/u.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
      if (prev && isFirstNameLike(prev)) return m;
    }
    ctx.bump('IMIE');
    // wspólne nazwisko = ten sam klucz osoby; spójnik i odstępy zostają takie jak w tekście
    // (dawniej stałe „ i " zamieniało „oraz" i zwijało wyrównanie spacjami)
    return `${ctx.personMask(c)}${mid}${ctx.personMask(c)}`;
  });
  // (a) IMIĘ/IMIONA + NAZWISKO — jedno lub dwa imiona (mianownik LUB odmiana) + nazwisko.
  // Okno ma najwyżej 4 wyrazy, więc w dłuższym ciągu imię wypadało na końcu porcji, a nazwisko
  // zostawało samo w następnej („Kierownik Działu Kadr Grzegorz | Mazur", „Sędzia Sądu
  // Okręgowego Jan | Gzowski"). Wtedy porcja oddaje ogon: skan rusza od imienia, prefiks zostaje
  // bez zmian (liczba zwraca pozycję wznowienia). Tylko imię w mianowniku ze słownika (patron
  // w dopełniaczu: „Akademia Wychowania Fizycznego Józefa Piłsudskiego") i następny wyraz
  // w kształcie nazwiska: potwierdzonym (słownik, morfologia, homograf — „Mazur", „Bąk") albo
  // po roli lub tytule w prefiksie („Sędzia Sądu Rejonowego Piotr Gwizdała"), nigdy encja
  // prawna, dopełniacz czy przymiotnik odmiejscowy.
  const nameSeqTail = (m: string, offset: number, words: string[], parts: string[], start: number): number | null => {
    if (start === 0) return null;
    const first = words[start].toLowerCase();
    if (!POLISH_FIRST_NAMES.has(first) || isFirstNameGenitive(first)) return null;
    const nx = RE_NEXT_CAP_WORD.exec(ctx.text.slice(offset + m.length, offset + m.length + 60))?.[1];
    if (!nx) return null;
    const nl = nx.toLowerCase();
    const segs = nl.split('-');
    // „Sp" z „Sp. z o.o." to forma prawna, nie nazwisko (maska zjadała skrót: „[…]. z o.o.")
    if (nl === 'sp' || segs.some((p) => LEGAL_ENTITY_WORDS.has(p) || isGeoAdjective(p)) || RE_SURNAME_OBLIQUE.test(nl)) return null;
    const resume = offset + parts.slice(0, 2 * start).join('').length;
    // drugie imię za oknem („… Kadr Anna Maria Kowalska") — kolejna porcja i tak rozstrzyga osobę
    if (isFirstNameLike(nx)) return resume;
    const prefix = words.slice(0, start).map((w) => w.toLowerCase());
    const role = !NOUN_LIKE_FIRST_NAMES.has(first) && prefix.some((w) => ROLE_WORDS.has(w) || TITLE_WORDS.has(w));
    // Za nazwą organizacji bez roli („Stowarzyszenie Przyjaciół Szkoły Adam Mickiewicz", „Fundacja
    // … Jan Kowalski") imię i nazwisko w mianowniku to częściej patron niż osoba — samo nazwisko
    // ze słownika nie wystarcza, potrzebna rola albo tytuł („Prezes Stowarzyszenia … Adam Nowak").
    // Tylko gdy ciąg ZACZYNA się od rodzaju organizacji, także po przymiotniku („Gminny Ośrodek
    // Kultury Stefan Żeromski", „Miejski Dom Kultury …", „Ochotnicza Straż Pożarna …"): stanowisko
    // w dopełniaczu instytucji („Główny Księgowy Spółki Katarzyna Lis") to osoba.
    if (!role && (ORG_HEAD_WORDS.has(prefix[0]) || ORG_HEAD_WORDS.has(prefix[1] ?? ''))) return null;
    const confirmed = segs.some((p) => !!surnameBase(p) || looksLikeSurname(p) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(p)));
    if (confirmed) return resume;
    if (!role) return null;
    // Sama rola nie wystarcza, gdy dalej stoi nazwa instytucji: miasto w nazwie klubu („Prezes
    // Klubu Sportowego Lech Poznań"), wyraz z nazwy firmy („Agata Meble", „Danuta Holding") albo forma prawna za nim.
    const after = ctx.text.slice(offset + m.length, offset + m.length + 80);
    const nxEnd = after.indexOf(nx) + nx.length;
    if (
      POLISH_CITIES.has(nl) ||
      segs.some((p) => COMPANY_TAIL_WORDS.has(p)) ||
      RE_LEGAL_FORM_AHEAD.test(after.slice(nxEnd))
    )
      return null;
    return resume;
  };
  const nameSeqMask = (m: string, offset: number): string | number => {
    // Podział z zachowaniem separatorów (indeksy parzyste = wyrazy, nieparzyste = odstępy):
    // ciąg bywa dłuższy niż osoba („Jan Kowalski\tWarszawa", „Kowalski     Odebrał"), a sklejanie
    // reszty pojedynczą spacją zwijało tabulatory i wyrównanie kolumn.
    const parts = m.split(/([ \t]+)/);
    const words = parts.filter((_, i) => i % 2 === 0);
    let start = 0;
    while (start < words.length && !isFirstNameLike(words[start])) start++;
    if (start >= words.length) return m; // brak imienia w ciągu → zostaw
    // patron ulicy/placu (też wyliczenie „ulic X oraz Y") to eponim, nie osoba. Gdy ciąg zaczyna
    // się od nazwy ulicy („ul. Długiej Jan Kowalski zasłabł"), rozstrzyga miejsce imienia: osoba
    // w mianowniku za nazwą ulicy to nie patron („ul. Marszałka Józefa Piłsudskiego" nim jest).
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) {
      // Ciąg od imienia patrona w dopełniaczu („W kościele św. Anny Jan Bednarz zagra", „parafii
      // św. Józefa Marek Sikora", „bł. Karoliny Anna Gzik"): osoba w mianowniku za patronem zaczyna
      // się od pierwszego imienia w mianowniku — dawniej cały ciąg wracał jawny razem z nią.
      let pastPatron = false;
      if (start === 0) {
        let j = 1;
        while (j < words.length && !(POLISH_FIRST_NAMES.has(words[j].toLowerCase()) && !isFirstNameGenitive(words[j].toLowerCase()))) j++;
        if (j >= words.length - 1) {
          // Samo nazwisko w mianowniku za patronem, przed czasownikiem w czasie przeszłym („W kaplicy
          // św. Rocha Bednarz poświęcił bramę") — podmiot zdania; patron zostaje, maska na nazwisku.
          // Także przed czasownikiem w czasie teraźniejszym albo dopowiedzeniem po przecinku
          // („Proboszcz parafii św. Wojciecha Brzęczek zaprasza", „św. Rocha Bednarz, miejscowy
          // kowal, …") — dopełniacz patrona kończy się samogłoską, wyraz na spółgłoskę to już osoba.
          // Miejscowość, forma prawna i wyraz uliczny zostają.
          const last = words[words.length - 1];
          const ll = last.toLowerCase();
          const after = ctx.text.slice(offset + m.length, offset + m.length + 24);
          if (
            words.length >= 2 &&
            !isFirstNameLike(last) &&
            // „-ej" to dopełniacz żeński patronki („W kościele bł. Anny Kowalskiej odbyła się
            // msza"), nie mianownik podmiotu
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
      // Osoba za patronem („parafii św. Wojciecha Zygmunt Lis prowadził") — patron już pominięty;
      // ponowne sprawdzenie od imienia widziało przed nim tego samego patrona i zostawiało całą osobę
      // jawną (maskę dostawało potem samo nazwisko).
      const at = offset + parts.slice(0, 2 * start).join('').length;
      if (!pastPatron && (precededByPatron(ctx.text, at) || precededByStreetEponym(ctx.text, at))) return m;
    }
    // wyraz uliczny wciągnięty do dopasowania („Rondo Romana Dmowskiego") → patron, nie osoba
    if (start > 0 && RE_STREET_WORD.test(words[start - 1])) return m;
    if (patronFirstNameAt(ctx.text, offset, m, parts, start)) return m;
    let k = start;
    while (k < words.length && isFirstNameLike(words[k]) && !LEGAL_ENTITY_WORDS.has(words[k].toLowerCase())) k++;
    // Imię w mianowniku i dopełniacz męskiego imienia w roli nazwiska („Świadek: Marek Pawła",
    // „Pracownik: Ewa Pawła", „p. Robert Pawła", „mgr Andrzej Pawła"): etykieta, rola albo tytuł
    // przed parą wygrywa z odczytem „dwa imiona" — to osoba. Bez kotwicy (i z liczbą rzymską za
    // parą: „Nagroda: Jan Pawła II") para zostaje jak dawniej. Drugie imię w dopełniaczu pośrodku
    // („mgr Andrzej Jana Pawła") też.
    // Imię w MIANOWNIKU z dopełniaczem bez liczby rzymskiej za parą („Jan Pawła mieszka", „syn Piotr
    // Pawła", „Ja, Krzysztof Pawła,") to osoba także bez kotwicy: dwa imiona stałyby w tym samym
    // przypadku („Jan Paweł"), a papieża zawsze wyróżnia „II". Tak samo imię w bierniku, celowniku,
    // narzędniku albo miejscowniku przed dopełniaczem („świadka Zofię Pawła", „po Janie Pawła",
    // „z Janem Pawła") — niezgodność przypadków robi z drugiego członu nazwisko. Imię w dopełniaczu
    // („wierzyciela Jana Pawła", „z powództwa Piotra Pawła") tylko z rolą przed parą, bo „Jana
    // Pawła" bywa też dwojgiem imion albo patronem.
    if (k >= words.length && (k - start === 2 || (k - start === 3 && isFirstNameGenitive(words[start + 1].toLowerCase())))) {
      const f = words[start].toLowerCase();
      const g = words[k - 1].toLowerCase();
      const at = offset + parts.slice(0, 2 * start).join('').length;
      const prev = /(\p{L}+)\.?[ \t]*(:?)[ \t]*$/u.exec(ctx.text.slice(Math.max(0, at - 30), at));
      const prevTok = prev?.[1]?.toLowerCase();
      // etykieta z dwukropkiem także w środku wiersza („… / "Pracownik: Ewa Pawła, …")
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
      // Imię w dopełniaczu bez roli: osoba, jak w v0.46.23 („Żona Jana Pawła zeznała", „w obecności
      // Piotra Pawła", „Ujawniono Jana Pawła (ur. …)"), chyba że to patron albo władca: przed parą
      // „im./ul./św.", wyraz uliczny, instytucja albo odsyłacz do pism i wydarzeń („Szkoła im. Jana
      // Pawła", „Encyklika Jana Pawła", „za panowania Zygmunta Augusta"). Postacie z dwoma imionami
      // („Jana Kazimierza", „Zygmunta Augusta", „Jana Chrzciciela") — tylko z kotwicą osoby za parą.
      const genFree = genF && !anchored && !roleGen && genPairPersonFree(ctx.text, at, offset + m.length, `${f} ${g}`);
      // Wyraz z wielkiej litery tuż za parą to nazwisko („Prezesa Zarządu Jana Kazimierza Nowaka"):
      // para to wtedy dwa imiona, a osobę maskuje dalszy przebieg w całości, nie po kawałku.
      const capAfter = /^ +\p{Lu}/u.test(ctx.text.slice(offset + m.length, offset + m.length + 3));
      // Imię w celowniku, narzędniku albo miejscowniku i odmiana imienia z ruchomym „e" („Tomaszowi
      // Markowi", „Tomaszem Markiem", „Janowi Pawłowi", „Krzysztofowi Pawle"): drugi człon to
      // nazwisko-homograf (Marek, Paweł), jak w v0.46.23. Papież z liczbą rzymską zostaje (niżej).
      const obliqueHomo = obliqueF && EXTRA_NAME_FORMS.has(g) && /(?:owi|em|le)$/.test(g) && isFirstNameLike(g);
      // Żeńskie imię w narzędniku, bierniku albo celowniku i męskie imię w MIANOWNIKU („z Anną Marek
      // i Tomaszem Pawłem", „Annę Paweł oraz …"): kobiece nazwisko-homograf męskiego imienia się nie
      // odmienia, a drugie imię stałoby w tym samym przypadku („Anną Marią"). Tylko w wyliczeniu
      // osób albo z kotwicą osoby — „Z Anną Marek pojechał" to dwie osoby bez nazwisk.
      const femOblNom =
        obliqueF &&
        /(?:ą|ę|ie)$/.test(f) &&
        POLISH_FIRST_NAMES.has(g) &&
        !isFirstNameGenitive(g) &&
        !/a$/.test(g) &&
        !NOUN_LIKE_FIRST_NAMES.has(g) &&
        (anchored || /^[ \t]+(?:i|oraz)[ \t]+\p{Lu}/u.test(ctx.text.slice(offset + m.length, offset + m.length + 12)));
      if (
        !capAfter &&
        (obliqueHomo || femOblNom) &&
        !/^[ \t]+[IVX]{1,4}(?!\p{L})/u.test(ctx.text.slice(offset + m.length, offset + m.length + 8))
      ) {
        ctx.bump('IMIE');
        return parts.slice(0, 2 * start).join('') + maskCells(parts, start, k - 1, ctx.personMask(words[k - 1])) + parts.slice(2 * k - 1).join('');
      }
      if (
        !capAfter &&
        (nomF || obliqueF || (genF && (anchored || roleGen || genFree))) &&
        isMaleFirstNameGenitive(g) &&
        !POLISH_FIRST_NAMES.has(g) &&
        !/^[ \t]+[IVX]{1,4}(?!\p{L})/u.test(ctx.text.slice(offset + m.length, offset + m.length + 8))
      ) {
        ctx.bump('IMIE');
        return parts.slice(0, 2 * start).join('') + maskCells(parts, start, k - 1, ctx.personMask(words[k - 1])) + parts.slice(2 * k - 1).join('');
      }
    }
    // same imiona, brak nazwiska w porcji → zostaw albo oddaj ogon (patrz nameSeqTail)
    if (k >= words.length) return nameSeqTail(m, offset, words, parts, start) ?? m;
    const surname = words[k];
    // „Sp" to skrót formy prawnej („Kierownik Sklepu Ewa Sp. z o.o.") — maska zjadała go razem z imieniem
    if (LEGAL_ENTITY_WORDS.has(surname.toLowerCase()) || /^sp$/i.test(surname)) return m;
    // Miejscowość z rynkiem i numerem („Jarosław Rynek 5 to adres urzędu") — adres, nie osoba. Tylko
    // gdy pierwszy wyraz jest nazwą miejscowości, para stoi sama (bez roli, tytułu ani etykiety
    // przed nią: „Świadek Anna Rynek 5" to osoba), a za nią po spacji (nie tabulatorze: liczba
    // z sąsiedniej kolumny to nie numer domu) stoi goły numer domu, a nie data, okres czy lokal.
    // Rynek to też nazwisko: w każdym innym układzie para idzie dalej jako osoba.
    if (
      k === words.length - 1 &&
      k - 1 === start &&
      /^(?:rynek|rynku)$/i.test(surname) &&
      // (miejscowość albo wyraz spoza słownika imion, np. zapis bez znaków diakrytycznych „Jaroslaw")
      (POLISH_CITIES.has(words[k - 1].toLowerCase()) || !POLISH_FIRST_NAMES.has(words[k - 1].toLowerCase())) &&
      /^ +\d{1,3}[A-Za-z]?(?=[ \t]*(?:[,.;)]|$|[ \t]\p{Ll}))/u.test(ctx.text.slice(offset + m.length, offset + m.length + 12)) &&
      !rynekNoNotHouse(ctx.text.slice(offset + m.length, offset + m.length + 40).replace(/^ +\d{1,3}[A-Za-z]?/, ''))
    ) {
      const at = offset + parts.slice(0, 2 * start).join('').length;
      const prev = /(\p{L}+)\.?[ \t]*(:?)[ \t]*$/u.exec(ctx.text.slice(Math.max(0, at - 30), at));
      const pt = prev?.[1]?.toLowerCase();
      const anchored =
        (!!pt && (ROLE_WORDS.has(pt) || TITLE_WORDS.has(pt) || PARTY_ROLE_WORDS.has(pt) || RE_TOPONYM_PERSON_ROLE.test(pt))) ||
        !!prev?.[2] ||
        personSlotBefore(ctx.text, at);
      if (!anchored) return m;
    }
    // Wiersz TSV w szyku „Nazwisko⇥Imię⇥Dział" („Nowak⇥Anna⇥Kardiologia", „Mazur⇥Grzegorz⇥Kierownik"):
    // wyraz za tabulatorem bez dowodu nazwiska to sąsiednia kolumna, a nazwiskiem jest komórka PRZED
    // imieniem. Rola, tytuł albo nazwa pola w tej kolumnie nigdy nie jest nazwiskiem („Jan⇥Operator").
    if (parts[2 * k - 1].includes('\t') && !tsvSurnameProof(surname)) {
      const sl = surname.toLowerCase();
      const prev = start > 0 && parts[2 * start - 1].includes('\t') ? words[start - 1] : '';
      if (prev && tsvSurnameProof(prev) && !TSV_NOT_SURNAME.has(prev.toLowerCase())) {
        ctx.bump('IMIE');
        return parts.slice(0, 2 * start - 2).join('') + maskCells(parts, start - 1, k - 1, ctx.personMask(prev)) + parts.slice(2 * k - 1).join('');
      }
      if (isPersonRoleValue(sl)) return m;
    }
    // Toponim w kształcie „imię + przymiotnik" („Kazimierz Dolny leży nad Wisłą", „w Kazimierzu
    // Dolnym") to miejscowość — chyba że stoi przy nim rola albo tytuł („Wnioskodawca: Kazimierz
    // Dolny", „Pan Kazimierz Dolny", też w dopełniaczu: „od uczestnika Kazimierza Dolnego"), drugie
    // imię („Jan Kazimierz Dolny") albo dane osoby tuż za nim („Kazimierz Dolny (PESEL …)",
    // „…, ur. …", „…, zam. …"): wtedy to osoba o takim nazwisku.
    if (POLISH_CITIES.has(`${words[k - 1]} ${surname}`.toLowerCase())) {
      const prevTok = ctx.text
        .slice(Math.max(0, offset - 40), offset)
        .match(/(\p{L}+)\.?[ \t]*:?[ \t]*$/u)?.[1]
        ?.toLowerCase();
      const anchored =
        [...words.slice(0, start).map((w) => w.toLowerCase()), prevTok].some(
          (w) => !!w && (ROLE_WORDS.has(w) || TITLE_WORDS.has(w) || RE_TOPONYM_PERSON_ROLE.test(w)),
        ) ||
        k - 1 > start ||
        RE_PERSON_DATA_AHEAD.test(ctx.text.slice(offset + m.length, offset + m.length + 24));
      if (!anchored) return m;
    }
    ctx.bump('IMIE');
    return parts.slice(0, 2 * start).join('') + maskCells(parts, start, k, ctx.personMask(surname)) + parts.slice(2 * k + 1).join('');
  };
  {
    const src = ctx.text;
    let out = '';
    let last = 0;
    RE_NAME_SEQ.lastIndex = 0;
    for (let mm = RE_NAME_SEQ.exec(src); mm; mm = RE_NAME_SEQ.exec(src)) {
      const r = nameSeqMask(mm[0], mm.index);
      if (typeof r === 'number') {
        RE_NAME_SEQ.lastIndex = r; // wznowienie od imienia; tekst przed nim skopiuje następny krok
        continue;
      }
      out += src.slice(last, mm.index) + r;
      last = mm.index + mm[0].length;
    }
    RE_NAME_SEQ.lastIndex = 0;
    ctx.text = out + src.slice(last);
  }
  // (a6) ZDROBNIENIE spoza słownika imion + POTWIERDZONE nazwisko („Kuba Nowak", „Ola Nowak",
  // „[12:10] Kuba Nowak: siema"). Przed (a2): tam RE_PAIR zużywa „Napisał Kuba" i „Kowalski"
  // zostaje sam. Nazwisko i tak zamaskowałby przebieg samodzielny — ten krok tylko wciąga
  // zdrobnienie, które dawniej zostawało jawne obok maski.
  ctx.text = ctx.text.replace(RE_NICK_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    if (!nicknamePairIsPerson(t, offset, m, w2)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w2);
  });
  // (a2) para „Wyraz Nazwisko(morfologiczne)" — sufiks -ski/-cki/-icz/-czyk spoza słownika.
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    // Nazwisko dwuczłonowe z obcym drugim członem („Świadek Kowalczyk-Müller", „Pozwany
    // Wróblewski-Öztürk") — końcówkę nazwiskową ma pierwszy człon, a CAP_WORD bierze całość, więc
    // całe nazwisko zostawało jawne. Maska obejmuje oba człony. Tylko z literą spoza polskiego
    // alfabetu w drugim członie: tam wcześniej CAP_WORD kończył wyraz i polski człon dostawał
    // maskę; „Choroba Leśniowskiego-Crohna" zostaje nazwą choroby.
    const hy = w2.indexOf('-');
    const foreignSecond = hy > 0 && RE_NON_PL_LETTER.test(w2.slice(hy)) && looksLikeSurname(w2.slice(0, hy)) && !isGeoAdjective(w2);
    // (przypadek gramatyczny i przymiotnik rozstrzyga wtedy pierwszy człon: „Wezwano Zielińską-Šimek")
    // Strona postępowania przed przymiotnikiem ze stoplisty („Świadek Poleski zeznał", „Pozwany
    // Poleski nie stawił się", „Świadek Strażacki zeznał") — rola wygrywa: to nazwisko. Tylko gdy
    // dalej nie stoi nazwa (wyraz z wielkiej litery): „Pozwany Polski Związek …" zostaje.
    const partyAdj =
      PARTY_ROLE_WORDS.has(w1.toLowerCase()) &&
      /(?:sk|ck|dzk)[ia]$/.test(w2.toLowerCase()) &&
      RE_AFTER_PARTY_ADJ.test(t.slice(offset + m.length, offset + m.length + 3));
    const w2s = looksLikeSurname(w2) || partyAdj ? w2 : foreignSecond ? w2.slice(0, hy) : '';
    if (!w2s) return m;
    // „ulica Tadeusza Kościuszki", „ul. Jana Kilińskiego" (też wyliczenie) → patron, nie osoba;
    // w1 będące wyrazem ulicznym („Ronda Dmowskiego", „mostu Piłsudskiego") też → patron
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset) || RE_STREET_WORD.test(w1)) return m;
    const w1l = w1.toLowerCase();
    // miejscowość dwuczłonowa („Piotrków Trybunalski", „Biała Rawska") i nazwa parku
    // („Słowiński Park Narodowy" — przymiotnik bywa też nazwiskiem, więc nie na stopliście)
    if (POLISH_CITIES.has(`${w1l} ${w2.toLowerCase()}`)) return m;
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    // w1 z ORYGINALNYM odstępem (tabulator, kilka spacji) — gdy w1 zostaje przed maską
    const kept = m.slice(0, m.length - w2.length);
    if (RE_SURNAME_OBLIQUE.test(w2s.toLowerCase())) {
      // przymiotnik ODMIEJSCOWY po roli/rzeczowniku („Starosty Wołomińskiego", „Wojewody
      // Mazowieckiego") to nazwa urzędu, NIE nazwisko — ta gałąź (inaczej niż sąsiednie) tego
      // nie sprawdzała, więc -ski/-cki odmiejscowe leciały jako osoba.
      if (isGeoAdjective(w2s)) return m;
      // eponim po rzeczowniku-głowie z wielkiej litery („Odruch Babińskiego", „Objaw Brudzińskiego")
      // — jak zapis małą literą w przebiegach samodzielnych. TYLKO w tej gałęzi: w mianownikowej
      // „Objaw Kowalska", „Skala Wiśniewski" to osoba (eponim jest zawsze w dopełniaczu). Tylko
      // głowy eponimów: „Reakcja Kowalskiego", „Prawo Wiśniewskiego", „Zespół Zielińskiego" to osoba.
      // I tylko znane eponimy: „Objawy Nowackiego nasiliły się", „Operatorzy Linii Nowaka" to osoba.
      // Dwuczłonowy eponim po głowie („Choroba Leśniowskiego-Crohna", „Zespół Guillaina-Barrégo")
      // to nazwa choroby, nie nazwisko dwuczłonowe.
      // Nazwisko osoby rozpoznanej już w piśmie wygrywa z patronem mostu (patrz afterNonPersonContext).
      const knownOnBridge = w1l === 'moście' && ctx.maskedSurnames.has(normalizeSurnameKey(w2));
      if ((EPONYM_HEADS.has(w1l) && (eponymFits(w1l, w2) || w2s !== w2)) || (w1l === 'moście' && !knownOnBridge)) return m;
      ctx.bump('IMIE'); // dzierżawczy dopełniacz → rzeczownik/imię w w1 zostaje
      return `${kept}${ctx.personMask(w2)}`;
    }
    // mianownik:
    if (LEGAL_ENTITY_WORDS.has(w1l)) return m; // „Nowa Ruda", „Izba …" — raczej nazwa własna
    // Tabulator między wyrazami to granica komórki (TSV, wklejony arkusz): „Noc⇥Kaczyński",
    // „Tak⇥Kaczyński⇥Urząd Miasta", „Pokój⇥Siedlecki" — sąsiednia kolumna nie tworzy z nazwiskiem
    // nazwy własnej ani nie jest jej członem.
    // Tak samo kolumny wyrównane spacjami („Rano  Sosnowska  Oddział Wewnętrzny", „Noc      Brzozowska"):
    // co najmniej trzy spacje albo dwie, gdy wiersz ma jeszcze jedną taką przerwę (pojedyncza
    // podwójna spacja to częsta literówka albo justowanie w tekście z PDF).
    const cell = kept.includes('\t') || columnGapBetween(kept, t, offset);
    if (PROPER_NAME_HEADS.has(w1l)) {
      // Wyrównanie spacjami rozdziela komórki tylko w grafiku („Noc      Brzozowska"): w tabeli
      // o stałej szerokości i w prozie z podwójną spacją „Kościół   Mariacki" to dalej jedna nazwa.
      const headCell = kept.includes('\t') || (w1l === 'noc' && cell);
      // „Kościół Mariacki", „Puszcza Białowieska" — przymiotnik uzgodniony z rodzajem głowy to człon
      // nazwy; nieuzgodniony („Noc Brzozowski spędził w celi") albo rzeczownik („Brama Wąsowicz")
      // członem nazwy być nie może, więc to nazwisko
      if (!headCell && headAgreesWithAdjective(w1l, w2.toLowerCase()) && !properNamePairIsPerson(ctx, t, offset, m, w1l, w2)) return m;
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`;
    }
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l)) {
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`; // „Prezes Gzowski" → rola zostaje
    }
    if (NON_NAME_LEADERS.has(w1l) || RE_VERB_1ST_PERSON.test(w1l)) {
      // „Odwiedziliśmy Biebrzański Park Narodowy" — przymiotnik przed nazwą instytucji to jej człon.
      // Tylko w jednej frazie (same spacje): „Tak⇥Kaczyński⇥Urząd Miasta" to trzy komórki.
      // Jedna spacja: kilka spacji to granica kolumny („Rano  Sosnowska  Oddział Wewnętrzny"). Forma
      // firmy z nazwiskiem właściciela („Również Brzozowski Spółka Jawna", „Dziś Gzowski Zakład
      // Usługowy") nie robi z nazwiska przymiotnika nazwy — chyba że to przymiotnik geograficzny.
      const next = cell ? undefined : RE_NEXT_CAP_WORD_1SP.exec(t.slice(offset + m.length, offset + m.length + 60))?.[1];
      const nextL = next?.toLowerCase() ?? '';
      if (next && LEGAL_ENTITY_WORDS.has(nextL) && !NOUN_NAME_LEADERS.has(w1l) && !(OWNER_FIRM_HEADS.has(nextL) && !isGeoAdjective(w2))) return m;
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`; // „Wczoraj Kowalski", „Sąsiad Kowalski" → wyraz zostaje
    }
    // Wyraz z literą spoza polskiego alfabetu („Señor Kowalski", „Café Nowicki") to zwykle tytuł
    // albo nazwa, a nie rzadkie imię — zostaje przed maską. Znane obce imiona („José", „André") nie.
    // Nazwa pola albo nagłówek kolumny przed nazwiskiem („Nazwisko⇥Kowalski", „Stanowisko
    // Kowalski", „Telefon⇥Gzowski") to etykieta, nie rzadkie imię — zostaje przed maską.
    if ((RE_NON_PL_LETTER.test(w1) && !FOREIGN_GIVEN_NAMES.has(w1l)) || FORM_LABEL_WORDS.has(w1l) || TABLE_HEADER_WORDS.has(w1l)) {
      ctx.bump('IMIE');
      return `${kept}${ctx.personMask(w2)}`;
    }
    ctx.bump('IMIE');
    return pairCellMask(m, w2, ctx.personMask(w2)); // rzadkie imię + nazwisko (mianownik) → oba
  });
  // (a3) ODWRÓCONA kolejność „Nazwisko Imię" — częsta w nagłówkach e-maili.
  let lineStarts: number[] | undefined;
  ctx.text = ctx.text.replace(RE_PAIR, (m, w1: string, w2: string, offset: number, t: string) => {
    if (!isFirstNameLike(w2)) return m;
    const w1l = w1.toLowerCase();
    if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w2.toLowerCase())) return m;
    // Patron instytucji w wierszu nagłówka („Odbiorca: Szkoła Podstawowa nr 12 im. Jana Pawła II",
    // „Do: Hospicjum im. Jana Pawła II"): dwa imiona w dopełniaczu po „im." to nie „Nazwisko Imię"
    // adresata. Bez nagłówka para i tak zostaje, więc strażnik tylko wyrównuje oba przypadki.
    if (precededByStreetEponym(t, offset) || precededByPatron(t, offset)) return m;
    if (
      !surnameBase(w1) &&
      !looksLikeSurname(w1) &&
      !inMailHeaderLine(t, offset, (lineStarts ??= lineStartsOf(t))) &&
      !stoplistedSurnameAnchored(ctx.text, offset, m, w1, w2) &&
      !reversedHomographAnchored(t, offset, w1l, w2.toLowerCase())
    )
      return m;
    ctx.bump('IMIE');
    return pairCellMask(m, w2, ctx.personMask(w1)); // klucz tożsamości = nazwisko (pierwsze słowo)
  });
  // (a3b) ZAPIS REKORDU „Nazwisko, Imię" jako cała komórka: wiersz listy, pole CSV w cudzysłowie,
  // wartość XML/JSON, adresat w nagłówku („To: Grabowski, Rafał <…>", „Do: Lis, Jakub; …").
  ctx.text = ctx.text.replace(RE_PAIR_COMMA, (m, w1: string, w2: string, w3: string | undefined, offset: number, t: string) => {
    if (!commaPairIsPerson(t, offset, m, w1, w2, w3)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1);
  });
  // (a4) IMIĘ + NAZWISKO MAŁYMI literami — niechlujny zapis (czaty, e-maile, formularze).
  const surnameLikeLo = (w: string): boolean =>
    !NON_SURNAME_ADJ.has(w) &&
    !LEGAL_ENTITY_WORDS.has(w) &&
    (looksLikeSurname(w) ||
      !!surnameBase(w) ||
      (w.includes('-') && w.split('-').some((p) => looksLikeSurname(p) || !!surnameBase(p))));
  ctx.text = ctx.text.replace(RE_LOWER_RUN, (m) => {
    const words = m.split(/([ \t]+)/); // zachowaj separatory (indeksy parzyste = wyrazy)
    let changed = false;
    for (let i = 0; i + 2 < words.length; i += 2) {
      const w1 = words[i];
      const w2 = words[i + 2];
      if (!w1 || !w2) continue;
      const w1l = w1.toLowerCase();
      if (TITLE_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || LEGAL_ENTITY_WORDS.has(w1l)) continue;
      if (!isFirstNameLike(w1) || !surnameLikeLo(w2.toLowerCase())) continue;
      ctx.bump('IMIE');
      words[i] = ctx.personMask(w2); // cała para „imię nazwisko" → jedna maska (klucz = nazwisko)
      words[i + 1] = '';
      words[i + 2] = '';
      changed = true;
      i += 2; // pomiń zamaskowane nazwisko
    }
    return changed ? words.join('') : m;
  });
  // (a5) NAZWISKO PANIEŃSKIE: „Imię z Nazwiskoskich" / „Imię z domu Nazwisko" — JEDNA osoba (maskuj
  // całość, nie osieroć imienia). Po gołym „z" WYMÓG dopełniacza l.mn. (-skich/-ckich/-dzkich/-ich/
  // -ych/-ów) ODRÓŻNIA panieńskie od narzędnika („Anna z Kowalskim" = „z kimś", DWIE osoby → -im) i od
  // miejsca („z Krakowa" → -owa). „z domu" to jawna kotwica — po niej dowolna forma nazwiska.
  ctx.text = ctx.text.replace(
    new RegExp(
      // [ \t\n] wokół „z" obejmuje łamanie wiersza („Gosia\nz Lewandowskich"); tylko białe znaki
      // między wyrazami, więc proza między imieniem a „z" nie pasuje. Strażnik dopełniacza l.mn.
      // nadal odróżnia od narzędnika, niezależnie od typu białego znaku.
      // Skrót „z d." („Anna z d. Sikora") jak „z domu" — po nim też wymagany wyraz z wielkiej litery,
      // więc „Pismo z d. 12.03.2024" nie pasuje.
      `\\b(${CAP_WORD})[ \\t\\n]+z[ \\t\\n]+` +
        `(?:(?:domu|d\\.)[ \\t\\n]+(${CAP_WORD})` +
        `|([${PL_UP}][${PL_LO}]+(?:skich|ckich|dzkich|ich|ych|ów)))` +
        `(?![${NM_BOUND}])`,
      'g',
    ),
    (m, first: string, domuSurname: string | undefined, genplSurname: string | undefined) => {
      if (!isFirstNameLike(first)) return m;
      const surname = domuSurname ?? genplSurname ?? '';
      if (!surname || LEGAL_ENTITY_WORDS.has(surname.toLowerCase())) return m;
      // „Anna z domu Pomocy Społecznej" — instytucja „Dom …", nie nazwisko panieńskie
      if (domuSurname && MAIDEN_NOT_SURNAME.has(domuSurname.toLowerCase())) return m;
      ctx.bump('IMIE');
      return ctx.personMask(surname); // klucz tożsamości = nazwisko panieńskie
    },
  );
}
