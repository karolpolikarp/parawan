// Etykieta mówcy w eksporcie czatu, SMS-ach, komentarzach i transkrypcji: „[12:03] Ania: …”,
// „12:03 Kasia Nowak: …”, „Konsultant (Marek): …”, „↳ Szymon P.: …”, „- Ola: …”. Wyraz albo dwa
// wyrazy na początku wiersza przed dwukropkiem i treścią wypowiedzi to osoba, gdy są imieniem (także
// zdrobnieniem) albo gdy w eksporcie ze znacznikami czasu ta sama etykieta wraca w roli mówcy i ma
// kształt nazwiska. Rola mówcy („Konsultant:”, „Klient:”, „Bot:”, „Ja:”), etykieta pola („Uwagi:”,
// „Temat:”, „Od:”, „Data:”) i pokrewieństwo bez imienia („Mama:”) zostają jawne.
// Pozycję mówcy daje tylko kształt pisma: znacznik czasu z eksportu czatu, odpowiedź „↳” w wątku albo
// rozmowa, w której mówcy wracają naprzemiennie i co najmniej dwóch z nich mówi jak w rozmowie
// (pytanie, powitanie, „tak”, „ok”, „jestem”). Emotikona, samo powtórzenie etykiety, cytat e-maila
// „>” i program dnia z godzinami („08:00 Kazimierz: zbiórka”) tego nie dają: to listy „Pole: wartość”.
import { isConfirmedSurname, isGeoAdjective } from '../surnames.js';
import type { RedactCtx } from '../context.js';
import {
  COLLIDING_NAME_FORMS,
  FIRST_NAME_DIMINUTIVES,
  FOREIGN_GIVEN_NAMES,
  NOUN_LIKE_FIRST_NAMES,
  POLISH_FIRST_NAMES,
  WESTERN_GIVEN_NAMES,
} from '../dict/names.js';
import { FORM_LABEL_WORDS } from '../dict/forms.js';
import { MULTIWORD_CITIES, POLISH_CITIES } from '../dict/places.js';
import { KIN_SRC } from '../guards/kinship.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';

// Role mówcy w czacie, infolinii i transkrypcji. Stoją przed dwukropkiem zamiast osoby albo przed nią
// („Konsultant Marek:”, „Admin Wiesia:”).
const SPEAKER_ROLES = new Set<string>(
  (
    'konsultant konsultantka klient klientka pracownik pracowniczka agent agentka bot system admin administrator ' +
    'administratorka moderator moderatorka operator operatorka dyspozytor dyspozytorka doradca doradczyni ' +
    'rozmówca rozmówczyni lektor lektorka prowadzący prowadząca uczestnik uczestniczka użytkownik użytkowniczka ' +
    'asystent asystentka infolinia serwis support helpdesk obsługa nadawca odbiorca autor autorka ja ty my wy ' +
    'on ona oni one ktoś gość anonim nieznany nieznana numer kontakt sąsiad sąsiadka szef szefowa kierowca ' +
    'kurier dostawca hydraulik lekarz lekarka pielęgniarka recepcja sekretariat rejestracja dziekanat ' +
    'user customer agent client caller operator host guest speaker moderator interviewer interviewee'
  ).split(' '),
);
const RE_KIN_WORD = new RegExp(`^${KIN_SRC}$`, 'u');
const DIMINUTIVE_LEMMA = new Map<string, string>();
for (const [full, dims] of Object.entries(FIRST_NAME_DIMINUTIVES))
  for (const d of dims) if (!DIMINUTIVE_LEMMA.has(d)) DIMINUTIVE_LEMMA.set(d, full);
// Imiona będące też zwykłymi wyrazami („Hala:”, „Róża:”, „Kuba:”): w etykiecie tylko, gdy wracają
// w roli mówcy.
const WORDLIKE_NAMES = new Set<string>([
  ...NOUN_LIKE_FIRST_NAMES,
  ...COLLIDING_NAME_FORMS,
  ...'hala cela natka oliwka wika hela ala ola kuba wiki'.split(' '),
]);

// Człon toponimu po imieniu („Kazimierz Dolny”, „Kazimierz Wielki”, „Nowy Targ”): para to miejsce
// albo przydomek, nie mówca.
const GEO_QUALIFIER =
  /^(?:doln|górn|wielk|mał|now|star|północn|południow|wschodn|zachodn|środkow)(?:y|a|e|i|ie)$|^zdrój$/u;
// Postacie biblijne i ewangeliści w piśmie religijnym („Jan: 3,16”, jasełka „Józef: Nie ma miejsca”).
// Strażnik działa tylko w rozmowie bez znaczników czasu i bez wątku (scenariusz, lista), i tylko gdy
// każde imię w etykietach jest postacią biblijną: zwykły czat o mszy albo parafii go nie włącza.
const BIBLICAL_FIGURES = new Set<string>(
  'jan mateusz marek łukasz józef maryja maria jezus anioł gabriel herod piotr paweł jakub szymon andrzej tomasz filip judasz elżbieta zachariasz łazarz marta magdalena mojżesz abraham dawid salomon'.split(
    ' ',
  ),
);
const RE_RELIGIOUS_DOC =
  /(?<!\p{L})(?:jase[łl]k|szopk|ewangeli|parafi|liturgi|betlejem|pasterk|kol[ęe]d|czytani[ae] |psalm|nabo[żz]e[ńn]stw|msz[aęy] [śs]w)/iu;
// Znacznik czasu typowy dla eksportu czatu, nie dla programu dnia: w nawiasie, z datą albo z sekundami.
const RE_CHAT_STAMP = /\[|\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d:\d{2}:\d{2}/u;

const isGiven = (l: string): boolean =>
  POLISH_FIRST_NAMES.has(l) ||
  DIMINUTIVE_LEMMA.has(l) ||
  FOREIGN_GIVEN_NAMES.has(l) ||
  WESTERN_GIVEN_NAMES.has(l);
/** Wyraz, który nie bywa członem imienia i nazwiska mówcy. */
function nonPersonWord(l: string): boolean {
  return (
    SPEAKER_ROLES.has(l) ||
    ROLE_WORDS.has(l) ||
    TITLE_WORDS.has(l) ||
    LEGAL_ENTITY_WORDS.has(l) ||
    FORM_LABEL_WORDS.has(l) ||
    POLISH_CITIES.has(l) ||
    isGeoAdjective(l) ||
    RE_KIN_WORD.test(l)
  );
}
/** Wyraz poprzedzający imię w etykiecie, który zostaje jawny: rola, pokrewieństwo, tytuł („Admin”, „Ciocia”, „dr”). */
const isPrefixWord = (w: string): boolean => {
  const l = w.toLowerCase().replace(/\.$/, '');
  return SPEAKER_ROLES.has(l) || ROLE_WORDS.has(l) || TITLE_WORDS.has(l) || RE_KIN_WORD.test(w);
};

// Znacznik czasu przed mówcą: „[08:12]”, „[12.11.2026, 08:12:33]”, „08:12”, „2026-10-01 09:14”,
// „12.11.2026, 08:12 -”.
const DATE = String.raw`\d{1,4}[./-]\d{1,2}[./-]\d{1,4}`;
const TIME = String.raw`\d{1,2}:\d{2}(?::\d{2})?(?:[ \t]?[AaPp][Mm])?`;
const STAMP = String.raw`(?:\[(?:${DATE},?[ \t]{0,4})?${TIME}\][ \t]{0,4}|(?:${DATE},?[ \t]{1,4})?${TIME}(?:[ \t]{0,4}[-–])?[ \t]{1,4})`;
const WORD = String.raw`\p{L}[\p{L}'’]*(?:-\p{L}[\p{L}'’]*)?\.?`;
const EMOJI = String.raw`(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Variation_Selector}|\p{Join_Control})`;
// grupy: 1 wcięcie i znacznik odpowiedzi lub punktor, 2 znacznik czasu, 3 etykieta (1–3 wyrazy),
// 4 odstęp przed nawiasem, 5 imię w nawiasie po roli, 6 emotikony i odstęp przed dwukropkiem
const RE_SPEAKER_LINE = new RegExp(
  String.raw`^([ \t]{0,8}(?:[↳>][ \t]{0,4})?(?:[-•*–][ \t]{1,4})?)(${STAMP})?(${WORD}(?:[ \t]${WORD}){0,2})(?:([ \t]{0,4})\((${WORD}(?:[ \t]${WORD})?)\))?((?:[ \t]{0,4}${EMOJI}){0,6}[ \t]{0,4}):(?=[ \t]+\S)`,
  'gmu',
);
const RE_EMOJI_ALL = new RegExp(EMOJI, 'gu');
// Każdy wiersz w kształcie wypowiedzi, także z mówcą już pod maską („[08:12] [IMIĘ I NAZWISKO]: …”):
// do oceny, czy pismo to eksport czatu albo wątek komentarzy. Grupy: 1 wcięcie i znacznik odpowiedzi,
// 2 znacznik czasu, 3 etykieta, 4 pierwszy znak treści.
const RE_ANY_SPEAKER_LINE = new RegExp(
  String.raw`^([ \t]{0,8}(?:[↳>][ \t]{0,4})?(?:[-•*–][ \t]{1,4})?)(${STAMP})?([^\n:]{1,60}):[ \t]+(\S[^\n]*)`,
  'gmu',
);
// Treść w kształcie wypowiedzi: pytanie, powitanie, potwierdzenie, podziękowanie, zaimek albo czasownik
// w 1. lub 2. osobie z najczęstszych w rozmowie. Wartość pola („zwiedzanie synagog”, „sala 2”,
// „grudzień”, „oddział stacjonarny”) tego nie ma.
const RE_SPEECH =
  /\?|(?<!\p{L})(?:hej(?:ka)?|cze[śs][ćc]|siema|witam|witaj(?:cie)?|dzie[ńn] dobry|dobry wiecz[óo]r|dobranoc|dzi[ęe]ki|dzi[ęe]kuj[ęe]|ok(?:ej|i)?|spoko|super|tak|nie|no|aha|jasne|dobrze|pa|papa|prosz[ęe]|przepraszam|sorki|sorry|halo|s[łl]ucham|jestem|jeste[śs]|b[ęe]d[ęe]|b[ęe]dziesz|id[ęe]|dzwoni[ęe]|zadzwoni[ęe]|mam|masz|wiem|wiesz|mog[ęe]|mo[żz]esz|chc[ęe]|chcesz|ja|ty|mi|mnie|ci|ci[ęe]|ciebie|tob[ąa]|nam|wam)(?!\p{L})/iu;
const RE_INITIAL = /^\p{Lu}\.$/u;
const RE_CAP = /^\p{Lu}\p{Ll}/u;
const RE_LOWER = /^\p{Ll}+(?:-\p{Ll}+)*$/u;

interface Line {
  start: number;
  end: number;
  lead: string;
  stamp: string;
  label: string;
  gap: string;
  paren: string | undefined;
  tail: string;
}
const labelKey = (l: Line): string => (l.paren ?? l.label).toLowerCase();

interface Utterance {
  reply: boolean;
  stamp: string;
  label: string;
  /** Treść zaczyna się od liczby („3,16”, „4 grudnia”, „3 osoby”): pole z wartością. */
  digit: boolean;
  /** Treść w kształcie wypowiedzi (RE_SPEECH). */
  speech: boolean;
}
const normLabel = (s: string): string =>
  s
    .replace(RE_EMOJI_ALL, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .toLowerCase();
/** Etykieta, która na pewno stoi przy mówcy: maska osoby, rola, pokrewieństwo albo imię niebędące wyrazem. */
function personish(label: string): boolean {
  if (label.includes('[')) return true;
  const w = label.split(' ')[0].replace(/\.$/, '');
  return (
    SPEAKER_ROLES.has(w) ||
    RE_KIN_WORD.test(w) ||
    (isGiven(w) && !WORDLIKE_NAMES.has(w) && !POLISH_CITIES.has(w))
  );
}
/**
 * Kształt rozmowy: co najmniej dwóch różnych mówców, któryś wraca po wypowiedzi innego (A … B … A),
 * wśród etykiet jest pewny mówca (personish), a co najmniej dwóch różnych mówców mówi jak w rozmowie
 * (RE_SPEECH). Lista „Pole: wartość”, w której ta sama etykieta stoi dwa razy z rzędu („Kuba: wiza”,
 * „Kuba: szczepienia”) albo wraca między polami („Kazimierz: zwiedzanie”, „Podgórze: obiad”,
 * „Kazimierz: kolacja”), nie jest rozmową. Jedno przejście: etykieta wraca po innym mówcy, gdy jej
 * poprzednie wystąpienie nie stoi tuż przed bieżącym.
 */
function conversation(us: Utterance[]): boolean {
  const lastAt = new Map<string, number>();
  const speakers = new Set<string>();
  let returns = false;
  let sure = false;
  for (let i = 0; i < us.length; i++) {
    const k = us[i].label;
    const prev = lastAt.get(k);
    if (prev === undefined) {
      if (!sure && personish(k)) sure = true;
    } else if (prev < i - 1) returns = true;
    lastAt.set(k, i);
    if (us[i].speech) speakers.add(k);
  }
  return returns && sure && speakers.size >= 2;
}

/**
 * Część etykiety, która jest osobą, i klucz pseudonimu. Zwraca null, gdy etykieta to rola, pole albo
 * zwykłe słowa. `repeated`: etykieta wraca w roli mówcy; `repeatedStamped`: wraca w wierszach ze
 * znacznikiem czasu.
 */
function personOfLabel(
  words: string[],
  repeated: boolean,
  repeatedStamped: boolean,
): { from: number; key: string } | null {
  let from = 0;
  while (from < words.length - 1 && isPrefixWord(words[from])) from++;
  const name = words.slice(from);
  if (!name.length || name.length > 2) return null;
  const [a, b] = name;
  const al = a.toLowerCase();
  if (nonPersonWord(al) || a.endsWith('.')) return null;
  const lower = name.every((w) => RE_LOWER.test(w.replace(/\.$/, '')));
  if (!lower && !name.every((w) => RE_CAP.test(w) || RE_INITIAL.test(w))) return null;
  if (a === a.toUpperCase()) return null; // „KLIENT:”, „PL:”: wersaliki to rola albo skrót
  const given = isGiven(al) && (!WORDLIKE_NAMES.has(al) || repeated);
  const lemmaKey = (): string => {
    const l = DIMINUTIVE_LEMMA.get(al) ?? al;
    return l.charAt(0).toUpperCase() + l.slice(1);
  };
  if (!b) {
    if (given) return { from, key: lemmaKey() };
    // samo nazwisko mówcy („Nowak:”) tylko w eksporcie ze znacznikami czasu i gdy etykieta wraca
    return repeatedStamped && !lower && isConfirmedSurname(a) ? { from, key: a } : null;
  }
  if (RE_INITIAL.test(b)) return given ? { from, key: lemmaKey() } : null;
  const bl = b.toLowerCase();
  if (
    nonPersonWord(bl) ||
    b.endsWith('.') ||
    GEO_QUALIFIER.test(bl) ||
    MULTIWORD_CITIES.has(`${al} ${bl}`)
  )
    return null;
  if (given && (isConfirmedSurname(b) || isGiven(bl) || repeatedStamped)) return { from, key: b };
  if (isGiven(bl) && isConfirmedSurname(a)) return { from, key: a }; // „Nowak Anna:”
  if (
    repeatedStamped &&
    !lower &&
    isConfirmedSurname(b) &&
    (FOREIGN_GIVEN_NAMES.has(al) || WESTERN_GIVEN_NAMES.has(al))
  )
    return { from, key: b };
  return null;
}

/** Etykieta mówcy na początku wiersza czatu, SMS-ów, komentarzy albo transkrypcji. */
export function passPersonSpeaker(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const t = ctx.text;
  const lines: Line[] = [];
  for (const m of t.matchAll(RE_SPEAKER_LINE)) {
    const start = m.index ?? 0;
    lines.push({
      start,
      end: start + m[0].length,
      lead: m[1],
      stamp: m[2] ?? '',
      label: m[3],
      gap: m[4] ?? '',
      paren: m[5],
      tail: m[6],
    });
  }
  if (!lines.length) return;
  const count = new Map<string, number>();
  const stampedCount = new Map<string, number>();
  for (const l of lines) {
    const k = labelKey(l);
    count.set(k, (count.get(k) ?? 0) + 1);
    if (l.stamp) stampedCount.set(k, (stampedCount.get(k) ?? 0) + 1);
  }
  // Wszystkie wiersze w kształcie wypowiedzi (także z mówcą już pod maską) do oceny kształtu pisma.
  const all: Utterance[] = [];
  for (const m of t.matchAll(RE_ANY_SPEAKER_LINE))
    all.push({
      reply: m[1].includes('↳'),
      stamp: m[2] ?? '',
      label: normLabel(m[3]),
      digit: /\d/.test(m[4].charAt(0)),
      speech: RE_SPEECH.test(m[4]),
    });
  const stampedAll = all.filter((u) => u.stamp);
  const stamped = stampedAll.length;
  // Wątek komentarzy: odpowiedzi „↳” wśród co najmniej trzech wypowiedzi. Sama emotikona, cytat
  // odpowiedzi e-mailem „>” albo wiersze „Pole: wartość” nie dowodzą wątku (lista imienin, wyjazdów,
  // lektur z emotikoną w tytule, przekazany plan wycieczki).
  const thread = all.length >= 3 && all.some((u) => u.reply);
  // Rozmowa bez znaczników czasu: mówcy wracają naprzemiennie (patrz conversation).
  const talk = conversation(all.filter((u) => !u.digit));
  // Eksport ze znacznikami czasu: znacznik w kształcie czatu (nawias, data, sekundy) albo rozmowa
  // w wierszach z godziną. Program dnia, grafik i rozkład („08:00 Kazimierz: zbiórka”, „14:00
  // Kazimierz: obiad”, „08:00 Róża: otwarta”) nie, także gdy ta sama etykieta wraca.
  const stampedTalk = conversation(stampedAll);
  // Obsada z samych postaci biblijnych w piśmie religijnym (patrz BIBLICAL_FIGURES).
  const givenLabels = lines
    .map((l) => (l.paren ?? l.label).toLowerCase())
    .filter((w) => !w.includes(' ') && isGiven(w));
  const religious =
    givenLabels.length > 0 &&
    givenLabels.every((w) => BIBLICAL_FIGURES.has(w)) &&
    RE_RELIGIOUS_DOC.test(ctx.raw);
  let out = '';
  let last = 0;
  for (const l of lines) {
    const k = labelKey(l);
    const repeatedStamped = (stampedCount.get(k) ?? 0) >= 2;
    // Pewna pozycja mówcy: wiersz eksportu czatu ze znacznikiem czasu, wątek komentarzy albo rozmowa.
    // Wiersz z liczbą na początku treści („Jan: 3,16”, „Kuba: 3 osoby”) to pole z wartością, nie wypowiedź.
    const stampPos = !!l.stamp && stamped >= 2 && (RE_CHAT_STAMP.test(l.stamp) || stampedTalk);
    const digitValue = /^[ \t]*\d/.test(t.slice(l.end, l.end + 4));
    if (!(stampPos || thread || (talk && !digitValue))) continue;
    // Samo powtórzenie etykiety nie wystarcza (patrz wyżej): imię-wyraz („Hala:”, „Kuba:”) wymaga
    // pozycji mówcy i powrotu w tej roli.
    const repeated = (count.get(k) ?? 0) >= 2;
    const words = (l.paren ?? l.label).split(/[ \t]/);
    if (l.paren && !l.label.split(/[ \t]/).every(isPrefixWord)) continue;
    // Postać biblijna albo ewangelista w piśmie religijnym („Jan: 3,16”, jasełka „Józef: …”).
    if (
      religious &&
      !stampPos &&
      !thread &&
      words.length === 1 &&
      BIBLICAL_FIGURES.has(words[0].toLowerCase())
    )
      continue;
    const p = personOfLabel(words, repeated, repeatedStamped);
    if (!p) continue;
    const kept = words.slice(0, p.from);
    for (const w of words.slice(p.from))
      if (!RE_INITIAL.test(w)) ctx.speakerNames.add(w.toLowerCase());
    ctx.bump('IMIE');
    const mask = ctx.personMask(p.key);
    const label = [...kept, mask].join(' ');
    const head = l.paren ? `${l.label}${l.gap}(${label})` : label;
    out += t.slice(last, l.start) + l.lead + l.stamp + head + l.tail + ':';
    last = l.end;
  }
  if (last === 0) return;
  ctx.text = out + t.slice(last);
}
