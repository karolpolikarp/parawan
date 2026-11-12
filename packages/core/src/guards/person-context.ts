// Strażniki kontekstu osoby: instytucja przed adresem, granice komórek tabeli, patroni, inicjały
// i łańcuchy kropkowe, homografy nazwisk przy imieniu.
import { PERSON_MASK_SRC, PL_LO, PL_UP, RE_JSON_ESC_PUA } from '../charset.js';
import { RE_INSTITUTION_WORD } from './eponyms.js';
import { LEGAL_ENTITY_WORDS, PROPER_NAME_HEADS } from './roles.js';

// Przymiotniki w nazwach miejscowości („Nowa Wieś”, „Stary Sącz”), które nie odbierają adresu jako
// nazwa podmiotu. „nowa” i „nowy” są w LEGAL_ENTITY_WORDS, pozostałe formy dopełniają parę.
export const ADDR_PLACE_ADJ_OK = new Set<string>('nowa nowe nowy stara stare stary'.split(' '));
// Obiekt publiczny przed adresem („Hala sportowa przy …”): adres obiektu, nie osoby.
export const RE_PUBLIC_FACILITY_WORD =
  /^(?:aptek\p{L}*|przychodni\p{L}*|hal[aięą]|sal[aięą]|parking\p{L}*|stadion\p{L}*|basen\p{L}*|boisk\p{L}*|kin[oaie]|kinie|poczt\p{L}*|bibliotek\p{L}*|muze\p{L}*|szpital\p{L}*|klinik\p{L}*|hospicj\p{L}*|przedszkol\p{L}*|żłob\p{L}*|liceum|gimnazj\p{L}*|hotel\p{L}*|dworz?c\p{L}*|targowisk\p{L}*|pawilon\p{L}*|cmentarz\p{L}*|kaplic\p{L}*|plebani\p{L}*|remiz\p{L}*|pływalni\p{L}*|lodowisk\p{L}*|zdrowia)$/u;
export function institutionBeforeAddr(before: string): boolean {
  const ws = before.replace(/[ \t]*,[ \t]*$/, '').split(/[ \t]+/).slice(-4);
  const lastIdx = ws[ws.length - 1] === '' ? ws.length - 2 : ws.length - 1;
  // Obiekt publiczny tylko w bieżącym wierszu: „(sala gimnastyczna)⏎Miejsce szkolenia: Kraków, …”
  // to dopisek do poprzedniego adresu.
  const lws = before.slice(before.lastIndexOf('\n') + 1).replace(/[ \t]*,[ \t]*$/, '').split(/[ \t]+/).slice(-4);
  if (lws.some((w) => RE_PUBLIC_FACILITY_WORD.test(w.toLowerCase()))) return true;
  return ws.some((w, i) => {
    const l = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    // sam „dom” tuż przed ulicą to budynek, nie instytucja jak „Dom Kultury przy …”
    if (l === 'dom' && i === lastIdx) return false;
    return (
      (LEGAL_ENTITY_WORDS.has(l) && !ADDR_PLACE_ADJ_OK.has(l)) ||
      ORG_HEAD_WORDS.has(l) ||
      /^(?:urzęd|starostw|szkol(?!eni)|szkoł|parafi|kości|sąd|komend|ośrod)/.test(l)
    );
  });
}
/** Czy przed pozycją (po samych spacjach) zaczyna się komórka: początek wiersza, punkt listy,
 *  etykieta „…:”, separator pola, cudzysłów, nawias albo znacznik? Bez przecinka, bo w CSV
 *  „1, Kowalski, Jan” nazwisko i imię to dwie kolumny. */
export function cellStartsBefore(t: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && t[i] === ' ') i--;
  if (i < 0) return true;
  const c = t[i];
  if (c === '\n' || c === '\r' || (RE_JSON_ESC_PUA.test(c) && t[i - 1] === '\\')) return true;
  if ((c === '.' || c === ')') && /\d/.test(t[i - 1] ?? '')) return true; // „1. Nowak, Anna”
  if (/[-*•–]/.test(c)) return i === 0 || /\s/.test(t[i - 1]); // punktor
  return /[:;|\t"'„“(<>]/.test(c);
}
/** Czy za pozycją kończy się komórka: koniec wiersza, separator pola (bez przecinka, patrz wyżej),
 *  cudzysłów, nawias, znacznik albo ucieczka z JSON-a? */
export function cellEndsAt(t: string, end: number): boolean {
  if (t[end] === '\t') return true;
  let i = end;
  while (t[i] === ' ') i++;
  if (i >= t.length) return true;
  const c = t[i];
  if (c === '\\' && RE_JSON_ESC_PUA.test(t[i + 1] ?? '')) return true;
  return /[\r\n;|\t"'”)<>(]/.test(c);
}
// Etykieta z dwukropkiem tuż przed wpisem („Wnioskodawca: ”, „Szpital: ”).
export const RE_ROLE_LABEL_BEFORE = /(\p{L}+)[ \t]*:[ \t]*$/u;
/** Czy komórkę otwiera etykieta-placówka („Szpital: Bielański, Marta”)? Przymiotnik po niej to
 *  nazwa placówki, nie nazwisko, więc imię za przecinkiem nie tworzy z nim osoby. */
export function institutionLabelBefore(t: string, offset: number): boolean {
  const label = RE_ROLE_LABEL_BEFORE.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!label && (RE_INSTITUTION_WORD.test(label) || LEGAL_ENTITY_WORDS.has(label.toLowerCase()));
}

// Rodzaj organizacji na początku nazwy własnej („Fundacja Rozwoju …”): imię i nazwisko za nim bez
// roli bywa patronem (patrz nameSeqTail).
export const ORG_HEAD_WORDS = new Set<string>(
  (
    'stowarzyszenie fundacja towarzystwo związek klub teatr muzeum szkoła zespół koło centrum ośrodek ' +
    'dom instytut akademia uniwersytet fundusz spółdzielnia parafia chór orkiestra festiwal nagroda ' +
    'konkurs galeria biblioteka liceum gimnazjum przedszkole hufiec komitet drużyna kółko straż'
  ).split(' '),
);

// Czasownik w czasie przeszłym za parą („Jan Nowak przyszedł”): para jest podmiotem, czyli osobą.
export const RE_PAST_VERB_AFTER = /^[ \t]+(?:się[ \t]+)?\p{Ll}{3,}ł[aoy]?(?!\p{L})/u;
// Głowy nazw, po których imię w dopełniaczu to patron, a nie osoba („Pomnik Jerzego Popiełuszki”).
export const PATRON_GEN_HEADS = new Set<string>([
  ...PROPER_NAME_HEADS,
  ...ORG_HEAD_WORDS,
  ...'pomnika pomniku order orderu krzyż krzyża medal medalu imienia im fundacji szkoły akademii uniwersytetu instytutu'.split(' '),
  // „pod wezwaniem” i nadanie imienia („Parafia pw. ks. Jerzego Popiełuszki”): za nimi stoi patron
  ...'pw imieniem kult kultu kultem'.split(' '),
]);
// „Świętego”, „Błogosławionej” przed imieniem, także bez ogonków. Skrótu „św.” tu nie ma, bo bywa
// świadkiem; rozstrzyga go precededByPatron z kontekstem sakralnym.
export const RE_SAINT_WORD_BEFORE = /(?:^|[^\p{L}])(?:[Śś]więt|[Ss]wiet|[Bb]łogosławion|[Bb]logoslawion)\p{L}*[ \t]+$/u;

// Lewa granica inicjału: przed literą nie może stać litera (także polska) ani kropka. Odcina ostatni
// człon kropkowego skrótu („A” z „S.A.”), a ASCII \b nie zadziałałby przed „Ł.”, „Ś.”.
export const INITIAL_START = `(?<![.\\w${PL_UP}${PL_LO}])`;
/**
 * Czy „P.” na pozycji `offset` to skrót „Pan/Pani” z nagłówka listu („Szanowny P. Kowalski”), a nie
 * inicjał imienia? Zapisy bez spacji („Sz.P.”) odcina już INITIAL_START.
 */
export function isHonorificP(t: string, offset: number): boolean {
  if (t[offset] !== 'P') return false;
  return /(?:(?<!\p{L})[Ss][Zz]\.|(?<!\p{L})[SsWw](?:zanown|ielmożn)\p{L}*)[ \t]+$/u.test(t.slice(Math.max(0, offset - 40), offset));
}

// Łańcuch kropkowy bez spacji zakończony wielką literą z kropką („J.M.”, „Dr.J.”, „P.H.U.”).
// INITIAL_START odcina jego ostatni człon, więc o kotwicy osoby rozstrzyga dotChainKind.
// Powtórzenia ograniczone, żeby koszt był stały.
export const DOT_CHAIN = `(?<![.\\w${PL_UP}${PL_LO}])((?:[${PL_UP}${PL_LO}]{1,5}\\.){1,4})([${PL_UP}])\\.`;
// Skróty z dwóch liter, które nie są inicjałami osoby („ORLEN S.A.”).
const DOT_CHAIN_NOT_PERSON = new Set<string>('ps pps sa sc sj sk ska bp us oo ok ad po rp ue mp op'.split(' '));
// Łańcuchy, po których stoi nazwisko, a sam łańcuch zostaje: formy działalności jednoosobowej
// („P.H.U. Wilk”) oraz „W.P.” i „Ś.P.”.
const DOT_CHAIN_KEEP = new Set<string>(
  ('ph phu pphu phup pphup fh fhu fhup fphu fph puh ppuh fuh pu fu pw ppw zph zphu zpuh zuh pph phpu ' +
    'fhpu pthu wp śp').split(' '),
);
// Tytuł sklejony z inicjałem („Dr.J. Kowalski”): tytuł zostaje.
const DOT_TITLES = new Set<string>('dr mgr prof mec inż adw lek med hab ks red płk gen kpt mjr por sierż sędz r pr st apl'.split(' '));
/**
 * Rodzaj łańcucha `head` + `ini.` przed nazwiskiem: 'absorb' to inicjały osoby (cała maska),
 * 'keepChain' zostawia skrót („P.H.U. [..]”), 'keepTitle' zostawia tytuł („Dr.[..]”), null to nie
 * kotwica osoby.
 */
export function dotChainKind(head: string, ini: string): 'absorb' | 'keepChain' | 'keepTitle' | null {
  const toks = head.slice(0, -1).split('.');
  const letters = (toks.join('') + ini).toLowerCase();
  if (toks.every((x) => x.length === 1 && x !== x.toLowerCase())) {
    if (DOT_CHAIN_KEEP.has(letters)) return 'keepChain';
    // trzy i więcej liter to skrót („P.P.S.”), dwie to inicjały, chyba że znany skrót
    return toks.length === 1 && !DOT_CHAIN_NOT_PERSON.has(letters) ? 'absorb' : null;
  }
  if (toks.length === 1 && /^[Ss]z$/.test(toks[0]) && ini === 'P') return 'keepChain'; // „Sz.P.” = Szanowny Pan
  return toks.every((x) => DOT_TITLES.has(x.toLowerCase())) ? 'keepTitle' : null;
}

// Homografy, które przy imieniu nie są nazwiskiem: dzień i miesiąc w grafiku, urząd („ANNA
// STAROSTA”), narodowość i drugie imię („JAN MAREK”).
export const HOMOGRAPH_PAIR_EXCL = new Set<string>(
  'piątek sobota niedziela środa kwiecień maj marzec styczeń grudzień lipiec sierpień sołtys starosta turek czech niemiec prus cygan góral polak kalina jagoda marek'.split(' '),
);
// Głowa tytułu utworu literackiego albo religijnego przed autorem (małymi literami po toLowerCase).
export const RE_CAPS_WORK_HEAD =
  /^(?:treny|tren|dziady|ballad[ya]?|romans(?:e|y)?|fraszk[ia]|sonet(?:y)?|pieśni?|pieśń|wiersz(?:e)?|rapsod(?:y)?|hymn(?:y)?|psalm(?:y)?|poemat(?:y)?|poezje|liryki|opowiadani[ae]|nowel[ae]|bajk[ia]|baśni|baśń|dzieła|utwory|kazani[ae]|encyklik[ai]|homili[ae])$/u;
// Dni, miesiące i funkcje („sołtys”) na początku wiersza to częściej grafik niż nazwisko
// („Środa Anna⏎Kowalska” to dyżur Anny Kowalskiej).
export const LIST_HEAD_NOT_SURNAME = new Set<string>(
  ('poniedziałek wtorek środa czwartek piątek sobota niedziela styczeń luty marzec kwiecień maj ' +
    'czerwiec lipiec sierpień wrzesień październik listopad grudzień sołtys starosta').split(' '),
);
// Maska osoby przed wyrazem w tym samym wierszu, po odstępie albo separatorze pola („[..];Jan”).
export const RE_PERSON_MASK_BEFORE = new RegExp(`(?:${PERSON_MASK_SRC})(?:[ \\t]+|[ \\t]*[,;|][ \\t]*)$`);
