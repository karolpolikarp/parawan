// Zwrot do osoby i podpis: wołacz imienia po „Panie”, po powitaniu, między przecinkami i na początku
// wiersza, „p. Marek”, obce tytuły (Mr, Mrs, Ms, Herr, Frau, Dr) oraz imię i nazwisko pod formułą
// pożegnalną. Kotwicą jest sama forma zwrotu: wołacz różny od mianownika („Marku”, „Ewo”, „Kasiu”)
// stoi tylko przy osobie. „Panie Prezesie”, „Panie Boże”, „Szanowni Państwo” zostają, bo to nie imiona.
import { isConfirmedSurname, isGeoAdjective } from '../surnames.js';
import { CAP_WORD, NM_BOUND, NM_UP } from '../charset.js';
import type { RedactCtx } from '../context.js';
import { COLLIDING_NAME_FORMS, FIRST_NAME_DIMINUTIVES, FOREIGN_GIVEN_NAMES, firstNameOfBareVocative, firstNameOfVocative, isFirstNameLike, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES, vocativeEqualsLocative, WESTERN_GIVEN_NAMES, WESTERN_SURNAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { precededByEponym } from '../guards/eponyms.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { escapeRe } from '../util.js';

const DIMINUTIVE_FORMS = new Set<string>(Object.values(FIRST_NAME_DIMINUTIVES).flat());
const capitalize = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

/** Imię w mianowniku: polskie, zdrobnienie, obce (także angielskie i niemieckie). */
function isGivenNominative(w: string): boolean {
  const l = w.toLowerCase();
  if (NOUN_LIKE_FIRST_NAMES.has(l) || COLLIDING_NAME_FORMS.has(l)) return false;
  return POLISH_FIRST_NAMES.has(l) || DIMINUTIVE_FORMS.has(l) || FOREIGN_GIVEN_NAMES.has(l) || WESTERN_GIVEN_NAMES.has(l);
}
/** Imię w dowolnej formie (podpis „Anna Kowalska”, szyk „Kowalska Anna”, obce imię). */
const isGivenAny = (w: string): boolean => isGivenNominative(w) || (isFirstNameLike(w) && !COLLIDING_NAME_FORMS.has(w.toLowerCase()));
// Obce role i tytuły po „Herr/Frau/Mr/Dr” („Herr Doktor”, „Frau Professor”, „Mr President”).
const FOREIGN_ROLE_WORDS = new Set<string>(
  (
    'doktor doctor dr professor prof direktor director präsident president minister bürgermeister mayor ' +
    'chairman chairwoman speaker justice judge ambassador senator governor secretary officer manager ' +
    'kollege kollegin rechtsanwalt anwalt notar pfarrer vorsitzender vorsitzende sir madam ' +
    'ministerin präsidentin direktorin doktorin professorin bundeskanzler bundeskanzlerin kanzler kanzlerin ' +
    'kommissar kommissarin lehrer lehrerin ober richter richterin staatsanwalt staatsanwältin abgeordneter ' +
    'abgeordnete pastor bischof hauptmann major general oberst inspektor inspector chair chairperson ' +
    'prime commissioner chancellor deputy chief captain colonel sergeant constable detective counsel ' +
    'attorney vice dean rector provost bishop reverend father'
  ).split(' '),
);
/** Wyraz, który nie bywa członem imienia i nazwiska: rola, tytuł, encja, przymiotnik geograficzny, miasto. */
function nonPersonWord(w: string): boolean {
  const l = w.toLowerCase();
  return ROLE_WORDS.has(l) || TITLE_WORDS.has(l) || LEGAL_ENTITY_WORDS.has(l) || FOREIGN_ROLE_WORDS.has(l) || isGeoAdjective(l) || POLISH_CITIES.has(l);
}

// ——— Wołacz ———

// „Panie Marku”, „panie Ryszardzie”, „Szanowny Panie Henryku”. „Pani Ewo” obsługuje wyzwalacz „Pani”.
const RE_PANIE_VOC = new RegExp(`(?<![${NM_BOUND}])([Pp]anie[ \\t]+)(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
// Powitanie albo podziękowanie i imię przed przecinkiem lub wykrzyknikiem („Cześć Ewo,”, „Hej Kasia!”,
// „Dzień dobry Marku,”, „Dziękuję, Marku!”, „Hi Tom,”, „Dear Anna,”).
const GREETING = String.raw`Cześć|Czesc|Hej(?:ka|o)?|Siema|Witam|Witaj(?:cie)?|Dzień[ \t]+dobry|Dzien[ \t]+dobry|Dobry[ \t]+wieczór|Dobry[ \t]+wieczor|Drog[ai]|Kochan[ay]|Najdroższ[ay]|Hi|Hello|Dear|Hallo|Liebe[r]?`;
const THANKS = '[Dd]ziękuję|[Dd]ziekuje|[Dd]zięki|[Dd]zieki|[Dd]ziękujemy';
const RE_GREETING_VOC = new RegExp(`(?<![${NM_BOUND}])((?:${GREETING}|${THANKS})(?:[ \\t]*,)?[ \\t]+)(${CAP_WORD})(?=[ \\t]*[,!])`, 'g');
const RE_THANKS_START = new RegExp(`^(?:${THANKS})`);
// Wołacz między przecinkami albo przed wykrzyknikiem w środku zdania („Tak, Marku, wiem”) i na początku
// wiersza („Kasiu,”, „> Ewo!”). Tylko forma różna od mianownika, bo „Maria, Anna i Jan” to wyliczenie.
const RE_COMMA_VOC = new RegExp(`(,[ \\t]+)(${CAP_WORD})(?=[ \\t]*[,!?])`, 'g');
const RE_LINE_VOC = new RegExp(`((?:^|\\n)[ \\t>]*(?:(?:Drog[ai]|Kochan[ay]|Najdroższ[ay])[ \\t]+)?)(${CAP_WORD})(?=[ \\t]*[,!])`, 'g');

/** Maska imienia z wołacza: kluczem pseudonimu jest pełne imię („Kasiu” i „Katarzyna” to ta sama osoba). */
function vocMask(ctx: RedactCtx, word: string, bare = false): string | null {
  const lemma = bare ? firstNameOfBareVocative(word) : firstNameOfVocative(word);
  if (!lemma) return null;
  ctx.bump('IMIE');
  return ctx.personMask(capitalize(lemma));
}

/** Wołacz imienia po „Panie”, po powitaniu, między przecinkami i na początku wiersza. */
export function passPersonVocative(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_PANIE_VOC, (m, kw: string, w: string) => {
    const mask = vocMask(ctx, w);
    if (mask) return `${kw}${mask}`;
    // potocznie mianownik („Panie Tomasz, …”), ale nie rola ani imię sakralne („Panie Boże”)
    if (!isGivenNominative(w) || nonPersonWord(w)) return m;
    ctx.bump('IMIE');
    return `${kw}${ctx.personMask(w)}`;
  });
  ctx.text = ctx.text.replace(RE_GREETING_VOC, (m, kw: string, w: string) => {
    const mask = vocMask(ctx, w);
    if (mask) return `${kw}${mask}`;
    // po podziękowaniu tylko wołacz: „Dziękuję, Anna przyjdzie” to podmiot zdania
    if (RE_THANKS_START.test(kw) || !isGivenNominative(w) || nonPersonWord(w)) return m;
    ctx.bump('IMIE');
    return `${kw}${ctx.personMask(w)}`;
  });
  for (const re of [RE_COMMA_VOC, RE_LINE_VOC]) {
    ctx.text = ctx.text.replace(re, (m, kw: string, w: string, offset: number, t: string) => {
      if (bareVocativeIsNotAddress(t, offset, offset + m.length, w, re === RE_COMMA_VOC)) return m;
      const mask = vocMask(ctx, w, true);
      return mask ? `${kw}${mask}` : m;
    });
  }
}

// Kolejny element wyliczenia za przecinkiem: 1–3 wyrazy z wielkiej litery i koniec elementu (przecinek,
// kropka, nawias, koniec wiersza albo spójnik), np. „Tetris, Mario, Sonic”, „Piotrze, Pawle, Janie”.
const RE_NEXT_LIST_ITEM =
  /^,[ \t]{1,8}\p{Lu}[\p{L}'’-]*(?:[ \t]\p{Lu}[\p{L}'’-]*){0,2}(?=[ \t]{0,8}(?:[,.;:…)\]]|\r?\n|$)|[ \t]{1,8}(?:i|oraz|lub|albo|czy)[ \t])/u;
// Wyraz z wielkiej litery tuż przed przecinkiem wołacza („Tetris, Mario”, „o Piotrze, Pawle”).
const RE_PREV_CAP_WORD = /(?<![\p{L}'’-])(\p{Lu}[\p{L}'’-]*)$/u;
// Wstęp wyliczenia w tym samym zdaniu: dwukropek albo przyimek („o apostołach: Piotrze, Pawle”, „o Piotrze,
// Pawle”, „w Juracie, Helu”, „Wśród nocnej ciszy, Józefie”).
const RE_LIST_INTRO =
  /:|(?<!\p{L})(?:o|ob|w|we|na|przy|nad|nade|pod|po|z|ze|od|do|u|dla|za|przed|między|wśród|koło|obok|ku|spod|znad)(?!\p{L})/iu;
/**
 * Czy wołacz bez kotwicy zwrotu (sam przecinek albo początek wiersza) to w istocie element wyliczenia albo
 * pole tabeli? Pole CSV („Mario,3”): przecinek bez odstępu za nim. Wyliczenie: z obu stron wyrazy z wielkiej
 * litery („Tetris, Mario, Sonic”, na początku wiersza „Anno, Domini, Deo”). Forma męska równa miejscownikowi
 * („Pawle”, „Henryku”, „Stanisławie”) po wstępie wyliczenia (przyimek, dwukropek) nie jest wołaczem, gdy za
 * nią idzie kolejny element, przed nią stoi imię albo co najmniej dwa elementy, albo sama jest nazwą miejsca.
 */
function bareVocativeIsNotAddress(t: string, start: number, end: number, w: string, afterComma: boolean): boolean {
  if (vocativeIsPlaceForm(w)) return true;
  const rest = t.slice(end, end + 80).replace(/^[ \t]+/, '');
  // pole tabeli CSV: przecinek bez odstępu za nim („Mario,3”)
  if (/^,[^ \t\r\n]/.test(rest)) return true;
  const nextItem = RE_NEXT_LIST_ITEM.test(rest);
  if (!afterComma) return nextItem;
  const before = t.slice(Math.max(0, start - 120), start);
  const prevWord = RE_PREV_CAP_WORD.exec(before)?.[1];
  if (prevWord && nextItem) return true;
  if (!vocativeEqualsLocative(w)) return false;
  const clause = before.slice(Math.max(...['.', '!', '?', ';', '\n'].map((c) => before.lastIndexOf(c))) + 1);
  const intro = RE_LIST_INTRO.exec(clause);
  if (!intro) return false;
  if (nextItem) return true;
  const items = clause.slice(intro.index + intro[0].length).split(',').length;
  if (items >= 2) return true;
  return !!prevWord && !vocativeIsPlaceForm(prevWord) && (!!firstNameOfVocative(prevWord) || isFirstNameLike(prevWord));
}

// Toponimy równe tematowi imienia (Hel od Hela, dzielnica Kazimierz) spoza słownika miast.
const NAME_TOPONYMS = new Set<string>(['hel', 'kazimierz']);
/** Czy wołacz jest też miejscownikiem miejscowości („Helu”, „Kazimierzu”, „Jarosławie”)? */
function vocativeIsPlaceForm(w: string): boolean {
  const l = w.toLowerCase();
  const stems: string[] = [];
  if (l.endsWith('u')) stems.push(l.slice(0, -1));
  if (l.endsWith('ie')) {
    const s = l.slice(0, -2);
    stems.push(s, s.replace(/ś$/, 'st').replace(/c$/, 't').replace(/dz$/, 'd').replace(/rz$/, 'r'), s.replace(/l$/, 'ł'));
  }
  return stems.some((s) => NAME_TOPONYMS.has(s) || POLISH_CITIES.has(s));
}

// ——— „p. Marek” ———

// Skrót „p.” (pan, pani) przed samym imieniem. Nie po liczbie ani numerze rzymskim („pkt 3 p. 2”),
// nie „p.o.”. Samo nazwisko przy „p.” rozpoznają przebiegi nazwisk.
const RE_P_DOT_NAME = new RegExp(
  `(?<![\\p{L}\\d.])(?<![IVXLC\\d][ \\t]?)(p\\.[ \\t]+)(${CAP_WORD})(?:([ \\t]+)(${CAP_WORD}))?(?![${NM_BOUND}])`,
  'gu',
);
/** Imię po skrócie „p.” („hydraulik p. Marek”), z nazwiskiem za nim, gdy jest w słowniku. */
export function passPersonPDotName(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_P_DOT_NAME, (m, kw: string, w: string, sep: string | undefined, w2: string | undefined) => {
    if (!isGivenAny(w) || nonPersonWord(w)) return m;
    ctx.bump('IMIE');
    if (w2 && isConfirmedSurname(w2) && !nonPersonWord(w2)) return `${kw}${ctx.personMask(w2)}`;
    return `${kw}${ctx.personMask(w)}${sep ?? ''}${w2 ?? ''}`;
  });
}

// ——— Obce tytuły ———

// „Mr Brandt”, „Ms Sabine Krüger”, „Herr Müller”, „Frau Schneider”. Bez „Miss” i „Madame”: „Miss
// Polonia”, „Madame Bovary” to nie osoby z pisma.
// Skrót stopnia między tytułem a nazwiskiem, z kropką albo bez („Herr Dr. Müller”, „Frau Prof. Dr. Weber”).
const DEGREE_ABBR = String.raw`(?:Dr|Prof|Ing|Mag|Dipl\.-Ing)\.?`;
const RE_FOREIGN_TITLE = new RegExp(
  `(?<![\\p{L}])((?:Mrs|Mr|Ms|Mx|Herr|Frau)\\.?[ \\t]+(?:${DEGREE_ABBR}[ \\t]+){0,3})(${CAP_WORD})(?:([ \\t]+)(${CAP_WORD}))?(?![${NM_BOUND}])`,
  'gu',
);
// „Dr Helen Carter”: „Dr” stoi też przed nazwą firmy („Dr Oetker”) i patronem, więc tylko z imieniem.
const RE_DR_GIVEN_SURNAME = new RegExp(`(?<![\\p{L}])(Dr\\.?[ \\t]+)(${CAP_WORD})([ \\t]+)(${CAP_WORD})(?![${NM_BOUND}])`, 'gu');
// „Dear Dr. Smith,”, „Hallo Prof. Weber”: sam stopień przed nazwiskiem tylko po powitaniu.
const RE_DEGREE_SURNAME = new RegExp(`(?<![\\p{L}])((?:Dr|Prof)\\.?[ \\t]+(?:${DEGREE_ABBR}[ \\t]+){0,2})(${CAP_WORD})(?![${NM_BOUND}])`, 'gu');
const RE_PATRON_BEFORE = /(?:(?<!\p{L})(?:im|ul|al|pl|os)\.|(?<!\p{L})(?:imienia|ulic[ayę]|alej[ai]?|placu))[ \t]*$/iu;
/** Nazwisko ze słownika: polskie potwierdzone albo częste angielskie i niemieckie. */
const isKnownSurname = (w: string): boolean => isConfirmedSurname(w) || WESTERN_SURNAMES.has(w.toLowerCase());
// Powitanie tuż przed tytułem („Dear Mr Dalloway,”, „Sehr geehrte Frau Holm”): druga kotwica osoby.
const RE_GREETING_BEFORE_TITLE =
  /(?<!\p{L})(?:Dear|Hi|Hello|Hallo|Sehr[ \t]{1,8}geehrte[rn]?|Liebe[rn]?|Guten[ \t]{1,8}(?:Tag|Morgen|Abend)|Good[ \t]{1,8}(?:morning|afternoon|evening),?)[ \t]{1,8}$/u;
// Nazwa rzeczy przed tytułem: marka, firma, produkt, lokal, utwór, konkurs („płynu Mr Proper”, „catering
// z Mr Cook”, „firma Mr Garden”, „konkurs Mr Olympia”), także z przyimkiem między nimi.
const RE_THING_BEFORE_TITLE = new RegExp(
  '(?<!\\p{L})(?:firm(?:a|y|ie|ę|ą)?|mark(?:a|i|ę|ą)|płyn(?:u|em)?|środ(?:ek|ka|kiem)|prosz(?:ek|ku|kiem)|kosmetyk\\p{L}{0,3}|' +
    'produkt\\p{L}{0,3}|catering\\p{L}{0,3}|restauracj\\p{L}{1,2}|sklep\\p{L}{0,3}|lokal\\p{L}{0,3}|pizzeri\\p{L}{1,2}|bar(?:u|ze)?|' +
    'sieci?|spółk\\p{L}{1,2}|konkurs\\p{L}{0,3}|wybor(?:y|ach|ów)|serial\\p{L}{0,3}|film\\p{L}{0,3}|książ(?:ka|ki|kę|ce|ką)|' +
    'powieś(?:ć|ci|cią)|bajk\\p{L}{1,2}|postać|postaci|postacią|tytuł\\p{L}{0,3}|program\\p{L}{0,3}|aplikacj\\p{L}{1,2}|' +
    'brand|company|shop|store|restaurant|book|novel|movie|film|show|series|contest|pageant)' +
    '[ \\t]{1,8}(?:(?:z|ze|od|w|we|na|do|pod|u)[ \\t]{1,8})?$',
  'iu',
);
// Cudzysłów przed tytułem („„Mrs Dalloway”") albo forma spółki za nazwą („Mr Garden sp. z o.o.”).
const RE_QUOTE_BEFORE = /[„"“”«»‚'’][ \t]{0,2}$/u;
const RE_FIRM_AFTER = /^[ \t]{0,8}(?:sp\.|s\.[ \t]?c\.|S\.?A\.|spółk|Ltd|GmbH|Inc|LLC|plc|AG(?![\p{L}])|KG(?![\p{L}])|&)/u;
// „Mrs Brown's Boys”: dopełniacz saksoński z wyrazem z wielkiej litery to tytuł, nie osoba.
const RE_POSSESSIVE_TITLE_AFTER = /^['’]s[ \t]{1,8}\p{Lu}/u;
/** Czy tytuł z wyrazem za nim to nazwa rzeczy (marka, utwór, spółka), a nie osoba? */
function foreignTitleIsThing(t: string, start: number, end: number): boolean {
  const before = t.slice(Math.max(0, start - 40), start);
  return RE_QUOTE_BEFORE.test(before) || RE_THING_BEFORE_TITLE.test(before) || RE_FIRM_AFTER.test(t.slice(end, end + 12));
}
/**
 * Obcy tytuł grzecznościowy przed nazwiskiem albo imieniem i nazwiskiem; tytuł zostaje w tekście.
 * Sam tytuł nie wystarcza, bo stoi też przed marką, postacią i rolą („Mr Proper”, „Mrs Dalloway”,
 * „Herr Ober”): pojedynczy wyraz za nim to osoba, gdy jest nazwiskiem albo imieniem ze słownika albo
 * gdy przed tytułem stoi powitanie („Dear Mr Dalloway,”). Imię przed wyrazem („Ms Sabine Krüger”) też
 * jest taką drugą kotwicą.
 */
export function passPersonForeignTitle(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_FOREIGN_TITLE, (m, kw: string, w: string, sep: string | undefined, w2: string | undefined, offset: number, t: string) => {
    if (foreignTitleIsThing(t, offset, offset + m.length)) return m;
    const greeted = RE_GREETING_BEFORE_TITLE.test(t.slice(Math.max(0, offset - 30), offset));
    const english = kw.startsWith('M');
    if (nonPersonWord(w)) {
      // „Frau Professor Schmidt”, „Herr Doktor Weber”: rola zostaje, nazwisko za nią pod maską
      if (!w2 || !FOREIGN_ROLE_WORDS.has(w.toLowerCase()) || nonPersonWord(w2)) return m;
      if (!isKnownSurname(w2) && !greeted) return m;
      ctx.bump('IMIE');
      return `${kw}${w}${sep}${ctx.personMask(w2)}`;
    }
    if (w2 && isGivenAny(w) && !nonPersonWord(w2)) {
      ctx.bump('IMIE');
      return `${kw}${ctx.personMask(w2)}`;
    }
    // tytuł angielski z wyrazami z wielkiej litery („Mr. Smith Goes to Washington”, „Mr Prime Minister”)
    if (english && w2 && !isKnownSurname(w2) && !isGivenAny(w2)) return m;
    if (english && !w2 && RE_POSSESSIVE_TITLE_AFTER.test(t.slice(offset + m.length, offset + m.length + 12))) return m;
    if (!isKnownSurname(w) && !isGivenAny(w) && !greeted) return m;
    ctx.bump('IMIE');
    return `${kw}${ctx.personMask(w)}${sep ?? ''}${w2 ?? ''}`;
  });
  ctx.text = ctx.text.replace(RE_DR_GIVEN_SURNAME, (m, kw: string, w: string, _sep: string, w2: string, offset: number, t: string) => {
    if (!isGivenAny(w) || nonPersonWord(w) || nonPersonWord(w2)) return m;
    if (RE_PATRON_BEFORE.test(t.slice(Math.max(0, offset - 12), offset)) || precededByEponym(t, offset)) return m;
    ctx.bump('IMIE');
    return `${kw}${ctx.personMask(w2)}`;
  });
  ctx.text = ctx.text.replace(RE_DEGREE_SURNAME, (m, kw: string, w: string, offset: number, t: string) => {
    if (!RE_GREETING_BEFORE_TITLE.test(t.slice(Math.max(0, offset - 30), offset)) || nonPersonWord(w)) return m;
    if (foreignTitleIsThing(t, offset, offset + m.length)) return m;
    ctx.bump('IMIE');
    return `${kw}${ctx.personMask(w)}`;
  });
}

// ——— Podpis pod formułą pożegnalną ———

const FAREWELL = [
  String.raw`[Zz][ \t]+(?:poważaniem|wyrazami[ \t]+szacunku|(?:serdecznymi[ \t]+)?pozdrowieniami)`,
  String.raw`(?:[Ss]erdecznie[ \t]+)?[Pp]ozdrawiam(?:[ \t]+(?:serdecznie|ciepło|gorąco))?`,
  String.raw`[Pp]ozdrowienia|[Ss]erdeczności|[Łł]ączę[ \t]+(?:wyrazy[ \t]+szacunku|pozdrowienia)`,
  String.raw`[Dd]ziękuję(?:[ \t]+i[ \t]+pozdrawiam)?|[Dd]ziekuje|[Dd]zięki|[Dd]zieki`,
  String.raw`(?:[Bb]est|[Kk]ind|[Ww]arm)(?:est)?[ \t]+(?:[Rr]egards|[Ww]ishes)|[Rr]egards|[Yy]ours[ \t]+(?:[Ss]incerely|[Ff]aithfully|[Tt]ruly)|[Ss]incerely|[Mm]any[ \t]+thanks|[Tt]hanks|[Tt]hank[ \t]+you|[Cc]heers`,
  String.raw`[Mm]it[ \t]+freundlichen[ \t]+Grüßen|(?:[Vv]iele|[Bb]este|[Ll]iebe|[Ff]reundliche)[ \t]+Grüße`,
].join('|');
// Formuła na początku wiersza (także w cytacie „> ”), opcjonalnie druga po „/”, potem przecinek w tym
// samym wierszu albo nowy wiersz (najwyżej jeden pusty).
const FAREWELL_HEAD =
  `(?:^|\\n)[ \\t>]*(?:${FAREWELL})(?:[ \\t]*\\/[ \\t]*(?:${FAREWELL}))?` +
  `(?:[ \\t]*,[ \\t]*|[ \\t]*(?:[,!.][ \\t]*)?(?:\\r?\\n[ \\t>]*){1,2})`;
// Za formułą 1–2 wyrazy (drugi może być inicjałem: „Anna K.”) i koniec wiersza.
const RE_SIGNATURE = new RegExp(`(${FAREWELL_HEAD})(${CAP_WORD})(?:[ \\t]+(${CAP_WORD}|[${NM_UP}]\\.))?(?=[ \\t]*(?:\\r?\\n|$))`, 'g');
const RE_NEXT_LINE_WORD = new RegExp(`^[ \\t]*\\r?\\n[ \\t>]*(${CAP_WORD})(?=[ \\t]*(?:\\r?\\n|$))`);
/** Imię i nazwisko (1–2 wyrazy) w osobnym wierszu pod formułą pożegnalną albo po niej i przecinku. */
export function passPersonSignature(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SIGNATURE, (m, head: string, w: string, w2: string | undefined, offset: number, t: string) => {
    const initial = !!w2 && w2.endsWith('.');
    if (nonPersonWord(w) || (w2 && !initial && nonPersonWord(w2))) return m;
    let key: string;
    if (!w2) {
      // jeden wyraz: imię albo nazwisko ze słownika („Pozdrawiam, Kuba”, „Z poważaniem\nKowalski”)
      if (!isGivenAny(w) && !isConfirmedSurname(w)) return m;
      // imię i nazwisko złamane przez wiersz („Z poważaniem\nJan\nKowalski”) łączy finalizePersons w jedną maskę
      const next = RE_NEXT_LINE_WORD.exec(t.slice(offset + m.length, offset + m.length + 60))?.[1];
      if (next && isConfirmedSurname(next) && !nonPersonWord(next)) return m;
      key = w;
    } else if (initial) {
      if (!isGivenAny(w)) return m;
      key = w;
    } else {
      // dwa wyrazy: co najmniej jeden to imię („Anna Kowalczyk”, „Kowalczyk Anna”, „Matthias Brandt”)
      const g1 = isGivenAny(w);
      const g2 = isGivenAny(w2);
      if (!g1 && !g2) return m;
      key = g1 && !g2 ? w2 : !g1 ? w : w2;
    }
    ctx.bump('IMIE');
    return `${head}${ctx.personMask(key)}`;
  });
}

/**
 * Kotwica nasiona dla pojedynczego wyrazu pod maską (patrz person-propagate): obcy tytuł, powitanie
 * albo podziękowanie, formuła pożegnalna tuż przed wyrazem.
 */
export const RE_ADDRESS_ANCHOR_BEFORE = new RegExp(
  `(?:(?<![\\p{L}])(?:Mrs|Mr|Ms|Mx|Herr|Frau)\\.?[ \\t]+|(?<![\\p{L}])(?:${GREETING}|${THANKS})(?:[ \\t]*,)?[ \\t]+|${FAREWELL_HEAD})$`,
  'u',
);

// Etykiety stron korespondencji w nagłówku: adresat („Do:”, „Adresat:”, „To:”) i nadawca („Od:”, „From:”).
const RE_TO_LABEL = String.raw`(?:Do|Adresat|Odbiorca|To|An)[ \t]{0,8}:[ \t]{0,8}`;
const RE_FROM_LABEL = String.raw`(?:Od|Nadawca|From|Von)[ \t]{0,8}:[ \t]{0,8}`;
/** Strona korespondencji, którą wskazuje miejsce maski: adresat (zwrot, „Do:”) albo nadawca (podpis, „Od:”). */
export interface PartyRoles {
  to: boolean;
  from: boolean;
}
/**
 * Role maski samego imienia ze zwrotu albo podpisu: pod formułą pożegnalną to nadawca, w każdym innym
 * miejscu (po „Panie”, „Pani”, powitaniu, jako wołacz) adresat.
 */
export function soloPartyRoles(text: string, mask: string): PartyRoles {
  const roles: PartyRoles = { to: false, from: false };
  const farewell = new RegExp(`${FAREWELL_HEAD}$`);
  for (let i = text.indexOf(mask); i >= 0; i = text.indexOf(mask, i + mask.length)) {
    if (farewell.test(text.slice(Math.max(0, i - 200), i))) roles.from = true;
    else roles.to = true;
  }
  return roles;
}
/**
 * Role pełnej osoby w korespondencji (dla scalania pseudonimu samego imienia ze zwrotu z pełną osobą,
 * person-propagate). Adresat: pole „Do:” albo osoba sama w wierszu nad zwrotem (blok adresata). Nadawca:
 * podpis pod formułą pożegnalną, pole „Od:” albo osoba sama w wierszu pod zwrotem. `pivot` to pozycja
 * pierwszego zwrotu w piśmie. Osoba z treści („opinia o uczennicy Ewie Nowak”) nie ma żadnej roli.
 */
export function fullPartyRoles(text: string, mask: string, pivot: number): PartyRoles {
  const m = escapeRe(mask);
  const roles: PartyRoles = {
    to: new RegExp(String.raw`(?:^|\n)[ \t>]{0,8}${RE_TO_LABEL}${m}`).test(text),
    from: new RegExp(`${FAREWELL_HEAD}${m}`).test(text) || new RegExp(String.raw`(?:^|\n)[ \t>]{0,8}${RE_FROM_LABEL}${m}`).test(text),
  };
  const alone = new RegExp(String.raw`(?:^|\n)[ \t>]{0,8}${m}[ \t]{0,8}[,.]?[ \t]{0,8}(?=\r?\n|$)`, 'g');
  for (const hit of text.matchAll(alone)) {
    if ((hit.index ?? 0) < pivot) roles.to = true;
    else roles.from = true;
  }
  return roles;
}
