import { PL_LO, PL_UP } from '../charset.js';
import { RE_INSTITUTION_WORD } from './eponyms.js';
import { LEGAL_ENTITY_WORDS, PROPER_NAME_HEADS } from './roles.js';

// Przymiotniki miejscowe, które są też w LEGAL_ENTITY_WORDS („Nowa Wieś", „Stare Babice").
export const ADDR_PLACE_ADJ_OK = new Set<string>('nowa nowe nowy stara stare stary'.split(' '));
// Sam „dom" tuż przed ulicą („DOM PRZY STANISŁAWA WYSPIAŃSKIEGO 5", „dom przy …") to budynek, nie
// instytucja jak „Dom Kultury przy …".
export const RE_PUBLIC_FACILITY_WORD =
  /^(?:aptek\p{L}*|przychodni\p{L}*|hal[aięą]|sal[aięą]|parking\p{L}*|stadion\p{L}*|basen\p{L}*|boisk\p{L}*|kin[oaie]|kinie|poczt\p{L}*|bibliotek\p{L}*|muze\p{L}*|szpital\p{L}*|klinik\p{L}*|hospicj\p{L}*|przedszkol\p{L}*|żłob\p{L}*|liceum|gimnazj\p{L}*|hotel\p{L}*|dworz?c\p{L}*|targowisk\p{L}*|pawilon\p{L}*|cmentarz\p{L}*|kaplic\p{L}*|plebani\p{L}*|remiz\p{L}*|pływalni\p{L}*|lodowisk\p{L}*|zdrowia)$/u;
export function institutionBeforeAddr(before: string): boolean {
  const ws = before.replace(/[ \t]*,[ \t]*$/, '').split(/[ \t]+/).slice(-4);
  const lastIdx = ws[ws.length - 1] === '' ? ws.length - 2 : ws.length - 1;
  // Obiekt publiczny liczymy tylko w BIEŻĄCYM wierszu, ale w każdym wierszu pisma: dzielenie po
  // [ \t]+ sklejało „otwarcia:⏎APTEKA" w jeden wyraz i obiekt poza pierwszym wierszem odpadał.
  const nl = before.lastIndexOf('\n');
  if (nl !== -1) {
    const lws = before.slice(nl + 1).replace(/[ \t]*,[ \t]*$/, '').split(/[ \t]+/).slice(-4);
    if (lws.some((w) => RE_PUBLIC_FACILITY_WORD.test(w.toLowerCase()))) return true;
  }
  return ws.some((w, i) => {
    const l = w.toLowerCase().replace(/[^\p{L}]/gu, '');
    if (l === 'dom' && i === lastIdx) return false;
    return (
      (LEGAL_ENTITY_WORDS.has(l) && !ADDR_PLACE_ADJ_OK.has(l)) ||
      ORG_HEAD_WORDS.has(l) ||
      /^(?:urzęd|starostw|szkol(?!eni)|szkoł|parafi|kości|sąd|komend|ośrod)/.test(l) ||
      // obiekt publiczny („APTEKA PRZY TADEUSZA KOŚCIUSZKI 12", „Hala sportowa przy …", „Parking
      // przy Jana Pawła II 30") — adres obiektu, nie osoby. Tylko goły wyraz w tym samym wierszu:
      // „(sala gimnastyczna)⏎Miejsce szkolenia: Kraków, …" to dopisek do poprzedniego adresu.
      (RE_PUBLIC_FACILITY_WORD.test(l) && /^\p{L}+$/u.test(w) && !ws.slice(i + 1).some((x) => x.includes('\n')))
    );
  });
}
/** Czy przed pozycją zaczyna się komórka: początek tekstu albo wiersza, punkt listy („1. ", „- "),
 *  etykieta „…:", separator pola (; | ⇥), cudzysłów, nawias albo znacznik XML — po samych spacjach.
 *  Bez przecinka: w CSV „1, Kowalski, Jan, 850…" nazwisko i imię to dwie kolumny. Skan wstecz po
 *  znakach zamiast lookbehindu o zmiennej długości. */
export function cellStartsBefore(t: string, offset: number): boolean {
  let i = offset - 1;
  while (i >= 0 && t[i] === ' ') i--;
  if (i < 0) return true;
  const c = t[i];
  if (c === '\n' || c === '\r' || ((c === '\uE00A' || c === '\uE00D' || c === '\uE009') && t[i - 1] === '\\')) return true;
  if ((c === '.' || c === ')') && /\d/.test(t[i - 1] ?? '')) return true; // „1. Nowak, Anna"
  if (/[-*•–]/.test(c)) return i === 0 || /\s/.test(t[i - 1]); // punktor
  return /[:;|\t"'„“(<>]/.test(c);
}
/** Czy za pozycją kończy się komórka: koniec wiersza, separator pola (bez przecinka — patrz wyżej),
 *  cudzysłów, nawias, znacznik, dosłowna ucieczka „\n/\t" z JSON-a. */
export function cellEndsAt(t: string, end: number): boolean {
  if (t[end] === '\t') return true;
  let i = end;
  while (t[i] === ' ') i++;
  if (i >= t.length) return true;
  const c = t[i];
  if (c === '\\' && /[\uE009\uE00A\uE00D]/.test(t[i + 1] ?? '')) return true;
  return /[\r\n;|\t"'”)<>(]/.test(c);
}
/** Czy komórkę otwiera etykieta-placówka („Szpital: Bielański, Marta", „Szkoła: …")? Przymiotnik
 *  po niej to nazwa placówki, a nie nazwisko — imię za przecinkiem nie należy do „osoby". */
export function institutionLabelBefore(t: string, offset: number): boolean {
  const label = /(\p{L}+)[ \t]*:[ \t]*$/u.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!label && (RE_INSTITUTION_WORD.test(label) || LEGAL_ENTITY_WORDS.has(label.toLowerCase()));
}

// Rodzaj organizacji na początku nazwy własnej („Stowarzyszenie Przyjaciół Szkoły …", „Fundacja
// Rozwoju …", „Teatr …") — za nim imię i nazwisko bez roli bywa patronem (patrz nameSeqTail).
export const ORG_HEAD_WORDS = new Set<string>(
  (
    'stowarzyszenie fundacja towarzystwo związek klub teatr muzeum szkoła zespół koło centrum ośrodek ' +
    'dom instytut akademia uniwersytet fundusz spółdzielnia parafia chór orkiestra festiwal nagroda ' +
    'konkurs galeria biblioteka liceum gimnazjum przedszkole hufiec komitet drużyna kółko straż'
  ).split(' '),
);

// 13a0–a4) Pary/ciągi imię+nazwisko (mianownik, odmiana, WERSALIKI, małe litery, małżonkowie).
export const RE_PAST_VERB_AFTER = /^[ \t]+(?:się[ \t]+)?\p{Ll}{3,}ł[aoy]?(?!\p{L})/u;
// Głowy nazw, po których imię w dopełniaczu to patron, a nie osoba („Pomnik Jerzego Popiełuszki",
// „Fundacja Jerzego Owsiaka", „Order Świętego Jerzego", „Kopiec Józefa Piłsudskiego").
export const PATRON_GEN_HEADS = new Set<string>([
  ...PROPER_NAME_HEADS,
  ...ORG_HEAD_WORDS,
  ...'pomnika pomniku order orderu krzyż krzyża medal medalu imienia im fundacji szkoły akademii uniwersytetu instytutu'.split(' '),
  // „pod wezwaniem" i nadanie imienia („Parafia pw. ks. Jerzego Popiełuszki", „Nazwanie skweru
  // imieniem Jerzego …", „Kult bł. Jerzego …") — za nimi stoi zawsze patron
  ...'pw imieniem kult kultu kultem'.split(' '),
]);
// „Świętego", „Błogosławionej" przed imieniem. Skrótu „św." tu nie ma: bywa „świadkiem" („Sąd
// przesłuchał św. Annę …"), a rozstrzyga go precededByPatron z kontekstem sakralnym.
// Zapis bez ogonków też („Kosciol Swietego Michala", „Blogoslawionej …") — parytet z diakrytyką.
export const RE_SAINT_WORD_BEFORE = /(?:^|[^\p{L}])(?:[Śś]więt|[Ss]wiet|[Bb]łogosławion|[Bb]logoslawion)\p{L}*[ \t]+$/u;
// Ułamek w kontekście udziału („Udział Marii Lis 1/4", „nabył część Jana Wróbla 1/2") to nie numer domu.
export const RE_SHARE_BEFORE = /(?<!\p{L})(?:udzia\p{L}*|częś\p{L}*|spad[ek]\p{L}*|przypad\p{L}*|dziedzicz\p{L}*|nabył\p{L}*|nabyła)(?!\p{L})/iu;

// Lewa granica INICJAŁU: przed literą nie może stać litera (także polska) ani kropka. ASCII \b
// przepuszczał ostatni człon kropkowego skrótu („S" z „P.S.", „A" z „S.A.", „U" z „Dz.U.",
// „O" z „O.O.") jako inicjał imienia, a odrzucał „Ł."/„Ś." po spacji (brak granicy przed
// znakiem spoza ASCII) — stąd „ORLEN S.[IMIĘ I NAZWISKO]" i jawne „mec. Ł. Baran".
export const INITIAL_START = `(?<![.\\w${PL_UP}${PL_LO}])`;
/**
 * Czy „P." na pozycji `offset` to skrót „Pan/Pani" z nagłówka listu („Sz. P. Andrzej Górski",
 * „Szanowny P. Kowalski", „Wielmożna P. …"), a nie inicjał imienia? Wtedy „P." zostaje przed
 * maską. Zapisy bez spacji („Sz.P.", „W.P.") odcina już INITIAL_START (kropka przed literą).
 */
export function isHonorificP(t: string, offset: number): boolean {
  if (t[offset] !== 'P') return false;
  return /(?:(?<!\p{L})[Ss][Zz]\.|(?<!\p{L})[SsWw](?:zanown|ielmożn)\p{L}*)[ \t]+$/u.test(t.slice(Math.max(0, offset - 40), offset));
}

// Łańcuch kropkowy sklejony bez spacji, zakończony wielką literą z kropką: „J.M.", „Dr.J.",
// „P.H.U.", „Sz.P.". INITIAL_START odcina ostatni człon (stoi po kropce), więc o tym, czy łańcuch
// kotwiczy osobę, rozstrzyga dotChainKind. Powtórzenia ograniczone ({1,5}, {1,4}) — koszt stały.
export const DOT_CHAIN = `(?<![.\\w${PL_UP}${PL_LO}])((?:[${PL_UP}${PL_LO}]{1,5}\\.){1,4})([${PL_UP}])\\.`;
// Skróty z dwóch liter, które NIE są inicjałami osoby (P.S. Mróz, ORLEN S.A., PKO B.P., O.K.).
const DOT_CHAIN_NOT_PERSON = new Set<string>('ps pps sa sc sj sk ska bp us oo ok ad po rp ue mp op'.split(' '));
// Łańcuchy, po których stoi nazwisko, a sam łańcuch zostaje w tekście: formy działalności
// jednoosobowej („P.H.U. Wilk" — w nazwie firmy nazwisko właściciela) i „W.P."/„Ś.P." (Pan, świętej pamięci).
const DOT_CHAIN_KEEP = new Set<string>(
  ('ph phu pphu phup pphup fh fhu fhup fphu fph puh ppuh fuh pu fu pw ppw zph zphu zpuh zuh pph phpu ' +
    'fhpu pthu wp śp').split(' '),
);
// Tytuł sklejony z inicjałem („Dr.J. Kowalski", „mgr.A. Nowak", „r.pr.J. Nowak") — tytuł zostaje.
const DOT_TITLES = new Set<string>('dr mgr prof mec inż adw lek med hab ks red płk gen kpt mjr por sierż sędz r pr st apl'.split(' '));
/**
 * Rodzaj łańcucha `head` + `ini.` przed nazwiskiem: 'absorb' — dwa inicjały osoby („J.M. Wilk"
 * → cała maska), 'keepChain' — skrót zostaje, nazwisko w masce („P.H.U. [..]", „Sz.P. [..]"),
 * 'keepTitle' — tytuł zostaje, inicjał w masce („Dr.[..]"), null — to nie kotwica osoby.
 */
export function dotChainKind(head: string, ini: string): 'absorb' | 'keepChain' | 'keepTitle' | null {
  const toks = head.slice(0, -1).split('.');
  const letters = (toks.join('') + ini).toLowerCase();
  if (toks.every((x) => x.length === 1 && x !== x.toLowerCase())) {
    if (DOT_CHAIN_KEEP.has(letters)) return 'keepChain';
    // trzy i więcej liter to skrót (P.P.S.), nie inicjały; dwie — inicjały, chyba że znany skrót
    return toks.length === 1 && !DOT_CHAIN_NOT_PERSON.has(letters) ? 'absorb' : null;
  }
  if (toks.length === 1 && /^[Ss]z$/.test(toks[0]) && ini === 'P') return 'keepChain'; // „Sz.P." = Szanowny Pan
  return toks.every((x) => DOT_TITLES.has(x.toLowerCase())) ? 'keepTitle' : null;
}

// Homografy, które przy imieniu nie są nazwiskiem: dzień i miesiąc w grafiku („PIĄTEK 3 MAJA"),
// urząd („ANNA STAROSTA", „JAN SOŁTYS"), narodowość i imię-homograf („JAN MAREK", „EWA KALINA"
// to dwa imiona).
export const HOMOGRAPH_PAIR_EXCL = new Set<string>(
  'piątek sobota niedziela środa kwiecień maj marzec styczeń grudzień lipiec sierpień sołtys starosta turek czech niemiec prus cygan góral polak kalina jagoda marek'.split(' '),
);
// Głowa tytułu utworu literackiego albo religijnego przed autorem (małymi literami po toLowerCase).
export const RE_CAPS_WORK_HEAD =
  /^(?:treny|tren|dziady|ballad[ya]?|romans(?:e|y)?|fraszk[ia]|sonet(?:y)?|pieśni?|pieśń|wiersz(?:e)?|rapsod(?:y)?|hymn(?:y)?|psalm(?:y)?|poemat(?:y)?|poezje|liryki|opowiadani[ae]|nowel[ae]|bajk[ia]|baśni|baśń|dzieła|utwory|kazani[ae]|encyklik[ai]|homili[ae])$/u;
// Nazwy dni i miesięcy są na liście homografów nazwisk, ale na początku wiersza to częściej
// grafik („Środa Anna\nKowalska" = dyżur Anny Kowalskiej) niż nazwisko — tu odpadają; tak samo
// funkcje sołecka i starościńska.
export const LIST_HEAD_NOT_SURNAME = new Set<string>(
  ('poniedziałek wtorek środa czwartek piątek sobota niedziela styczeń luty marzec kwiecień maj ' +
    'czerwiec lipiec sierpień wrzesień październik listopad grudzień sołtys starosta').split(' '),
);
// Maska osoby przed wyrazem w tym samym wierszu: po odstępie albo po separatorze pola CSV
// („[..];Jan", „[..], Jan") — wyraz należy wtedy do tego wiersza.
export const RE_PERSON_MASK_BEFORE = /(?:\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\])(?:[ \t]+|[ \t]*[,;|][ \t]*)$/;
