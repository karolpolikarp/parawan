// Dane o zdrowiu (art. 9 RODO), wersja ostrożna: tylko z kotwicą wskazującą konkretną osobę.
// Cztery źródła:
// 1) sekcje karty informacyjnej („Rozpoznanie:”, „Leki:”) i ich pozycje w kolejnych wierszach;
//    przy nagłówku wieloznacznym („Rozpoznanie:”, „Diagnoza:”, „Leki:”, „Zalecenia:”) potrzebny
//    jest kod choroby, nazwa choroby, lek z dawką albo słownictwo medyczne w sąsiednich wierszach,
//    bo te same nagłówki stoją w raportach z incydentów, protokołach serwisowych i wykazach kosztów;
// 2) kod ICD-10 po słowie, które go zapowiada („rozpoznanie”, „kod choroby”); sam „I10” bez
//    kotwicy to też numer sali, a „diagnoza: E18” bywa kodem błędu pralki;
// 3) lek ze słownika z dawką („sertralina 50 mg”, „Concor 5 raz dziennie”) albo z „doraźnie”,
//    przy czasowniku o przyjmowaniu leku przez osobę („przyjmuje”, „zalecił”);
// 4) frazy opisowe (choroba, uraz, zabieg, nałóg, wizyta u specjalisty) przy kotwicy w tym samym
//    zdaniu albo w zdaniu obok. Kotwica silna mówi o zdarzeniu konkretnej osoby sama z siebie
//    („zaświadczenie lekarskie”, „choruje”, „doznał”, „zwolnienie lekarskie”). Kotwica słaba
//    („leczenie”, „pacjent”, „stan zdrowia”, „stwierdzono”) wystarcza tylko wtedy, gdy obok stoi
//    osoba („Pani”, „pracownik”, „pozwany”, pierwsza osoba, zamaskowany PESEL). Dzięki temu
//    poradnik, przepis, OWU, przetarg czy raport („leczenie nowotworów w Polsce”) zostają jawne.
// Ogólne zdania o zdrowiu bez nazwy choroby („Dane o zdrowiu pacjenta przetwarza…”) zostają.
import type { RedactCtx } from '../context.js';
import { NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { escapeRe } from '../util.js';

/*
 * Pamięć podręczna wyników czystych funkcji tekstu. Kotwice przy każdym trafieniu sprawdzają te same
 * zdanie i okno kilkoma wyrażeniami (długi wiersz z tysiącami trafień liczył je od nowa przy każdym).
 * Kluczem jest dokładnie ten napis, który dostaje wyrażenie albo funkcja, więc wynik nie może się
 * różnić od policzonego wprost. Wyrażenia z flagą g albo y zależą od lastIndex i idą bez pamięci.
 * Pamięć czyści passHealth na początku i na końcu (nie trzyma tekstu pisma po redakcji).
 */
const MEMO_MAX = 4096;
/** Dłuższy napis liczony wprost: pamięć dla niego kosztowałaby więcej (skrót klucza, pamięć) niż sam test. */
const MEMO_KEY_MAX = 2048;
const memoTests = new Map<RegExp, Map<string, boolean>>();
const memoFns = new Map<(s: string) => unknown, Map<string, unknown>>();
function mtest(re: RegExp, s: string): boolean {
  if (re.global || re.sticky || s.length > MEMO_KEY_MAX) return re.test(s);
  let m = memoTests.get(re);
  if (!m) memoTests.set(re, (m = new Map()));
  let r = m.get(s);
  if (r === undefined) {
    if (m.size >= MEMO_MAX) m.clear();
    r = re.test(s);
    m.set(s, r);
  }
  return r;
}
/** Wynik czystej funkcji jednego napisu, liczony raz na napis. Wynik jest tylko do odczytu. */
function memo<T>(fn: (s: string) => T): (s: string) => T {
  const m = new Map<string, T>();
  memoFns.set(fn, m as Map<string, unknown>);
  return (s: string): T => {
    if (s.length > MEMO_KEY_MAX) return fn(s);
    if (m.has(s)) return m.get(s) as T;
    if (m.size >= MEMO_MAX) m.clear();
    const r = fn(s);
    m.set(s, r);
    return r;
  };
}
function clearMemo(): void {
  for (const m of memoTests.values()) m.clear();
  for (const m of memoFns.values()) m.clear();
  startsText = null;
  startsValue = [];
}

const LO = 'a-ząćęłńóśźż';
const UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
const LETTER = `${LO}${UP}`;
const NOT_LETTER_BEFORE = `(?<![${LETTER}\\d])`;
const NOT_LETTER_AFTER = `(?![${LETTER}\\d])`;
const L = `[${LO}]*`;
/** Pierwsza litera wielka albo mała, reszta małymi (fraza na początku zdania, nie w nazwie własnej). */
const cap = (w: string): string => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`;
/** Okno kontekstu wokół trafienia: zdanie ze zdaniem obok, ale nie dalej niż tyle znaków. */
const SPAN = 300;

/**
 * Kod ICD-10: litera (bez U, zarezerwowanej dla kodów specjalnych) i dwie cyfry, opcjonalnie
 * podkategoria po kropce albo przecinku („J45.0”, „J45,0”). W zapisie z kotwicą dopuszczamy też
 * spację po literze („F 32.1”, zapis ręczny i OCR).
 */
const ICD = String.raw`[A-TV-Z]\d{2}(?:\.\d{1,2})?`;
const ICD_FLEX = String.raw`[A-TV-Z][ \t]?\d{2}(?:[.,]\d{1,2})?`;
/**
 * Kod ICD-11 (rdzeń: „6A02”, „5A11”, „BA00”, „MB23.5”): rozdział cyfrą albo literą, litera, cyfra
 * i znak. Bez I i O (myliłyby się z 1 i 0). Tylko po kotwicy, bo bez niej to zwykły symbol.
 */
const ICD11 = String.raw`(?:[1-9]|[A-HJ-NP-Z])[A-HJ-NP-Z]\d[0-9A-HJ-NP-Z](?:\.[0-9A-HJ-NP-Z]{1,2})?`;
/** Kod po kotwicy: ICD-10 w zapisie swobodnym albo ICD-11. */
const ICD_ANCH = `(?:${ICD_FLEX}|${ICD11})`;
const ICD_ONLY = new RegExp(`^${ICD_ANCH}$`);
/** Po kodzie nie może stać cyfra, litera ani „/” (sygnatura „K 12/24” to nie kod choroby). */
const ICD_END = String.raw`(?![\d${LETTER}/]|[.,]\d)`;
/** Etykieta przed kodem („ICD-10: I10”, „ICD10 F32.1”) należy do zapisu kodu. */
const ICD_LABEL = String.raw`ICD(?:-?10)?[ \t]*:?[ \t]*`;
const ICD_AT_START = new RegExp(`^(?:${ICD_LABEL})?${ICD}${ICD_END}`);
/** Kod w nawiasie na końcu wiersza („Zapalenie płuc (J18.9)”), najczęstszy układ karty. */
const ICD_PAREN_END = new RegExp(String.raw`\([ \t]*(?:ICD(?:-?10)?[ \t]*:?[ \t]*)?${ICD}(?:[ \t]*[,;][ \t]*${ICD})*[ \t]*\)[ \t.;,]*$`);
const hasIcd = (body: string): boolean => ICD_AT_START.test(body) || ICD_PAREN_END.test(body);

/* ── Kotwice ── */

/**
 * Podmiot ogólny tuż przed czasownikiem („Osoba, która choruje”, „Każdy pacjent, który choruje”,
 * „Kto choruje”, „Każdy choruje”): mowa o każdym, kogo to dotyczy, a nie o konkretnej osobie.
 * „Pracownik, który choruje” i „Jan Kowalski, który choruje” to dalej konkretna osoba.
 */
const GENERIC_SUBJECT = `(?:osob${L}|każd${L}(?:[ \\t]+[${LO}]+)?|ktoś|człowiek|ten|ta|ci|te|wszys${L}|ludzie|pacjenci|chorzy)`;
const NOT_GENERIC_SUBJECT = `(?<!(?:${GENERIC_SUBJECT}[ \\t]{0,8},?[ \\t]{0,8}któr${L}|kto|każd${L})[ \\t]{1,8})`;
/**
 * Podmiot liczony w populacji przed czasownikiem („Wiele osób choruje na…”, „Co trzeci Polak…”,
 * „Większość pacjentów przyjmuje…”, „Każdy chory przyjmuje…”): statystyka albo reguła, a nie
 * konkretna osoba. „Każdego dnia przyjmuje…” nie ma rzeczownika osobowego, więc zostaje osobą.
 */
const RE_POPULATION_SUBJECT = new RegExp(
  `${NOT_LETTER_BEFORE}(?:każd${L}|większoś${L}|wiel(?:e|u)|wszys${L}|niektór${L}|część|połow${L}|coraz[ \\t]+więcej|co[ \\t]+[${LO}]+[iy]|około|ok\\.|blisko|ponad|prawie|kilk${L}|\\d[\\d \\t,.%]*(?:mln|tys\\.)?)[ \\t]+(?:[${LO}]+(?:ych|ich|ej|y|a|e)[ \\t]+)?` +
    `(?:osób|osoby|osoba|ludzi|pacjent${L}|chor(?:y|zy|ych)|Pola(?:k|ków|cy)|Polek|dzieci|dziecko|kobiet${L}|mężczy(?:zn|źni|zna)|pracowni(?:k|ków|cy|ca)|mieszkańc${L}|mieszkaniec|seniorów|senior|dorosłych|dorosły|uczniów|uczeń|uczennica|ubezpieczon(?:y|a|ych)|kandydat${L}|kierowc${L}|student${L}|żołnierz${L}|funkcjonariusz${L}|podopieczn${L}|wychowan(?:ek|ków|kowie))(?:[ \\t]+[${LETTER}]+){0,3}[ \\t]*$`,
  'i',
);

/** Kotwica silna: zdarzenie zdrowotne konkretnej osoby albo dokument lekarski wystawiony dla niej. */
const STRONG = [
  `zaświadczeni${L}[ \\t]+(?:od[ \\t]+)?lekar${L}`,
  'zdiagnozowa(?:no|ny|na|ł|ła|łem|łam)',
  // „rozpoznano, że…”, „rozpoznano przychód” w sprawozdaniu finansowym to nie rozpoznanie choroby
  `rozpoznano(?![ \\t]*,?[ \\t]*(?:że|iż|przychod|przychód|koszt|odpis|rezerw|strat|zysk|aktyw|zobowiąz|należnoś|podat|wynik|wartoś|utrat)${L})`,
  'rozpoznan[aoy][ \\t]+u',
  'hospitalizowan(?:y|a|ego|ej)',
  `${NOT_GENERIC_SUBJECT}(?:choruj(?:e|ę)|chorował(?:a|em|am)?)`,
  `${NOT_GENERIC_SUBJECT}cierpi(?:ał|ała|ałem|ałam|ę)?[ \\t]+na`,
  `${NOT_GENERIC_SUBJECT}doznał(?:a|em|am)?`,
  // Imiesłów „leczony”, „leczona” stoi też w przepisach i programach („może być leczona”), więc
  // jest kotwicą słabą; silna jest tylko forma zwrotna osoby („leczy się”, „leczyłam się”).
  `${NOT_GENERIC_SUBJECT}lecz(?:ę[ \\t]+się|y[ \\t]+się|ył(?:a|em|am)?[ \\t]+się)`,
  `zwolnieni${L}[ \\t]+lekarsk${L}`,
  `orzeczeni${L}[ \\t]+lekarsk${L}`,
  `wypis${L}[ \\t]+ze[ \\t]+szpitala`,
  // „linia L4”, „hala L4” to oznaczenie miejsca albo wariantu, a nie zwolnienie lekarskie
  `(?<!(?:lini|hal|sektor|stref|poziom|bram|budyn|sal|klas|kondygnacj|piętr|segment|blok|modu|wariant|typ|model|wersj|rząd|rzęd|pol|stanowisk|magazyn|regał|kabin|peron|tor|ciąg|nr)${L}[ \\t]{1,8})L-?4`,
].join('|');

/**
 * „Kod choroby” stoi i w zwolnieniu lekarskim, i w słowniku ICD-10 czy statystyce NFZ („Kod
 * choroby J18.9 oznacza…”), więc jest kotwicą słabą: potrzebuje osoby obok.
 */
const ICD_WORD = `kod(?:em|u)?[ \\t]+choroby`;

/** Kotwica słaba: słowo medyczne, które stoi też w poradnikach, przepisach i raportach. */
const WEAK = [
  `rozpozna(?:nie|nia|niem|niu|ny|na|ne)(?![${LETTER}])(?![ \\t]+(?:sprawy|spraw|sprawę|wniosku|wniosków|skargi|odwołania|apelacji|zażalenia|kasacji|pozwu|sprzeciwu|zarzutów|środka|pisma|reklamacji|ofert${L}|rynku|terenu|potrzeb))`,
  `stwierdzon${L}`,
  `leczeni${L}`,
  'lecz(?:ony|ona|onego|onej)',
  `hospitalizacj${L}`,
  `obrażeni${L}|obrażeń`,
  `uraz${L}`,
  `porod${L}|poród`,
  `przeciwwskazan${L}`,
  `niezdolnoś${L}[ \\t]+do[ \\t]+pracy`,
  // tylko liczba pojedyncza: „pacjentów z cukrzycą” w komunikacie placówki to nie konkretna osoba
  'pacjent(?:a|owi|em|cie|ka|ki|ce|kę|ką)?',
  `stan${L}[ \\t]+zdrowia`,
  `niepełnosprawnoś${L}`,
  ICD_WORD,
].join('|');

const RE_STRONG = new RegExp(`${NOT_LETTER_BEFORE}(?:${STRONG})${NOT_LETTER_AFTER}`, 'i');
const RE_WEAK = new RegExp(`${NOT_LETTER_BEFORE}(?:${WEAK})${NOT_LETTER_AFTER}`, 'i');

/**
 * Pierwsza osoba czasu przeszłego („byłem”, „przebywałam”, „chorowałem”, „poszedłem”, „mogłem”).
 * Narzędnik rzeczownika na -ł albo -ło ma tę samą końcówkę („artykułem”, „rozdziałem”, „z udziałem”,
 * „zespołem”, „kościołem”, „węzłem”, „hasłem”), więc: przed -łem musi stać samogłoska czasownika
 * (-ał, -ił, -ył, -ął, -ęł) albo jedna z form z zamkniętej listy („szedłem”, „mogłem”, „czułem”),
 * -ałem po rdzeniu rzeczownika („dział”, „kanał”, „materiał”) odpada, a po przyimku z narzędnikiem
 * („z”, „przed”, „pod”, „nad”, „za”) słowo jest zawsze rzeczownikiem. Forma żeńska -łam nie ma
 * odpowiednika rzeczownikowego; „działam”, „wysyłam”, „wołam” to czas teraźniejszy.
 */
const PAST_NOUN = `(?:(?:roz|po|u|przy|od|wy|za|przed)?dzia|kana|materia|kapita|sygna|potencja|idea|genera|upa|zapa|sza|kryszta|ty|py)łem`;
// Składnia zamiast listy rzeczowników: narzędnik stoi po przyimku („z kwartałem”, „przed Trybunałem”),
// po przymiotniku w narzędniku („ubiegłym kwartałem”, „starym arsenałem”) i po łączniku w orzeczniku
// („był kanałem”, „stał się rytuałem”); czasownik w pierwszej osobie w tych miejscach nie stoi.
const FIRST_PAST =
  `(?<!(?<![${LETTER}])(?:z|ze|przed|pod|nad|za|między)[ \\t]{1,4}(?:[${LO}]{1,18}(?:ym|im|ą)[ \\t]{1,4})?)` +
  `(?<!(?<![${LETTER}])[${LO}]{2,18}(?:ym|im)[ \\t]{1,4})` +
  `(?<!(?<![${LETTER}])(?:jest|był|była|było|byli|były|są|został|została|zostało|stał[ \\t]{1,4}się|stała[ \\t]{1,4}się)[ \\t]{1,4})` +
  `(?!${PAST_NOUN}(?![${LETTER}]))` +
  `(?:[${LO}]{1,}(?:[aiyąę]|ar)łem|[${LO}]*(?:szedłem|szłam|adłem|niosłem|rosłem|wiozłem|ogłem|rzekłem|czułem|psułem|snułem)|[${LO}]{2,}(?<!(?:sy|dzia|wo))łam)`;

/**
 * Konkretna osoba w oknie: rola procesowa albo kadrowa w liczbie pojedynczej, członek rodziny,
 * pierwsza osoba („doznałem”, „mój”), pole formularza z danymi osoby albo zamaskowany PESEL.
 * Liczba mnoga („pacjentów”, „osoby”, „dzieci”) i „pacjent” w mianowniku (regulaminy) to nie osoba.
 */
const PERSON_THIRD = [
  'pracowni(?:k|ka|kowi|kiem|ku|ca|cy|cę|cą)',
  'wnioskodaw(?:ca|cy|cę|cą|czyni|czynię|czynią)',
  `powód|powoda|powodowi|powódk${L}`,
  'pozwan(?:y|a|ego|ej|emu|ym|ą)',
  'poszkodowan(?:y|a|ego|ej|emu|ym|ą)',
  'ubezpieczon(?:y|a|ego|ej|emu|ym|ą)',
  'skarżąc(?:y|a|ego|ej)',
  'mąż|męża|mężowi|mężem|żona|żony|żonie|żoną|ojciec|ojca|ojcu|ojcem|matka|matki|matce|matką',
  'syn|syna|synowi|synem|córka|córki|córce|córką|dziecko|dziecka|dziecku|małoletni(?:ego|ej|a)?',
  'pacjentk(?:a|i|ę|ą|ce)|u[ \\t]+pacjenta|pacjentowi',
  // zaimek osobowy w trzeciej osobie („zalecił mu”, „u niego stwierdzono”); samo „jej” bywa
  // dzierżawcze w przepisie („bez jej zgody”), więc tylko po czasowniku lekarza
  `mu|jemu|niemu|u[ \\t]+niego|u[ \\t]+niej|(?:zalecił|przepisał|wypisał|podał|podano|zalecono|przepisano)${L}[ \\t]+jej`,
];
const PERSON_FORM = `(?:imię[ \\t]+i[ \\t]+)?nazwisko[ \\t]*:|pacjent(?:ka)?[ \\t]*:|data[ \\t]+urodzenia`;
const RE_PERSON = new RegExp(
  `${NOT_LETTER_BEFORE}(?:${[
    ...PERSON_THIRD,
    'jestem|mój|moja|moje|mojego|mojej|mojemu|moim|moją|u[ \\t]+mnie',
    // pierwsza osoba czasu przeszłego („doznałem”, „chorowałam”), ale nie narzędnik rzeczownika
    // („z udziałem”, „artykułem”) ani czas teraźniejszy z listu przewodniego („przesyłam”, „działam”)
    FIRST_PAST,
  ].join('|')})${NOT_LETTER_AFTER}|${PERSON_FORM}`,
  'i',
);
/**
 * Osoba w trzeciej osobie (rola, krewny, zaimek, pole formularza) bez autora pisma: przy zdarzeniu
 * pierwszą osobę sprawdza firstPersonIn, bo „mój raport”, „Jestem lekarzem” to autor w innej roli.
 */
const RE_PERSON_THIRD = new RegExp(`${NOT_LETTER_BEFORE}(?:${PERSON_THIRD.join('|')})${NOT_LETTER_AFTER}|${PERSON_FORM}`, 'i');
/** Urząd po „Pan”, „Pani” („Pani Dyrektor”, „Pana Prezesa”) to adresat pisma, a nie osoba z danymi o zdrowiu. */
const OFFICE = `(?:Dyrektor|Prezes|Prezydent|Kierowni|Minist|Burmistrz|Wójt|Starost|Marszał|Rzeczni|Prokurator|Komorni|Mecenas|Dziekan|Rektor|Prorektor|Ordynator|Przewodnicząc|Kanclerz|Wojewod|Senator|Posł|Posel|Radn|Redaktor|Inspektor|Naczelni|Komendant|Profesor|Doktor|Sędzi|Koordynator|Sołty|Proboszcz)${L}`;
const RE_PERSON_CS = new RegExp(
  `(?<![${LETTER}])(?:Pan|Pani|Panu|Panią|Pana|Panem)[ \\t]+(?!${OFFICE}(?![${LETTER}]))[${UP}]|\\[(?:PESEL|DATA-URODZENIA|NR-DOWODU)\\]`,
);
/** Para wyrazów z wielkiej litery, z których jeden jest imieniem („Jan Kowalski”, „Kowalski Jan”). */
const RE_CAP_PAIR = new RegExp(`(?<![${LETTER}])([${UP}][${LO}]+)[ \\t]+([${UP}][${LO}]+)(?:-[${UP}][${LO}]+)?(?![${LETTER}])`, 'g');
const isGivenName = (w: string): boolean => {
  const k = w.toLowerCase();
  return POLISH_FIRST_NAMES.has(k) && !NOUN_LIKE_FIRST_NAMES.has(k);
};
/** Patron instytucji przed imieniem („Szpital im. Józefa Babińskiego”, „im. dr. Jana Biziela”, „imienia ks. Jana Twardowskiego”). */
const RE_PATRON_BEFORE = /(?:im\.|imienia)[ \t]*(?:(?:dr|prof|ks|św|gen|bp|abp|płk|hm)\.?[ \t]*){0,2}$/i;
/** Pozycja pierwszej pary „imię nazwisko” w tekście albo -1. */
const namePairAt = memo(function namePairAt(s: string): number {
  RE_CAP_PAIR.lastIndex = 0;
  for (let m = RE_CAP_PAIR.exec(s); m; m = RE_CAP_PAIR.exec(s)) {
    // patron po „im.” („Szpital im. Józefa Babińskiego”) to nazwa instytucji, a nie osoba
    const patron = mtest(RE_PATRON_BEFORE, s.slice(Math.max(0, m.index - 24), m.index));
    if (!patron && (isGivenName(m[1]) || isGivenName(m[2]))) return m.index;
    // para zachodzi na siebie („Pacjentka Maria Kowalska”): następny wyraz zaczyna kolejną parę
    RE_CAP_PAIR.lastIndex = m.index + m[1].length;
  }
  return -1;
});
const hasPerson = (w: string): boolean => mtest(RE_PERSON, w) || mtest(RE_PERSON_CS, w);
/**
 * Osoba przy trafieniu: rola, zaimek, „Pan”, „Pani” w szerszym oknie, a imię z nazwiskiem tylko
 * w tym samym zdaniu (nazwisko prezesa w zdaniu obok nie robi z raportu karty pacjenta).
 */
const personNear = (text: string, sentence: string, from: number, to: number): boolean =>
  hasPerson(personWindow(text, from, to)) || (namePairAt(sentence) >= 0 && !mtest(RE_NAME_NOT_PATIENT, sentence));
/**
 * Zdanie o grupie ludzi albo o kodzie ze słownika: imię i nazwisko w nim to prelegent czy autor,
 * a nie pacjent („Jan Kowalski omówił rozpoznanie astmy u dzieci”, „Kod J45 oznacza astmę; Jan
 * Kowalski jest autorem opracowania”).
 */
const RE_NAME_NOT_PATIENT = new RegExp(
  `${NOT_LETTER_BEFORE}(?:u[ \\t]+(?:dzieci|pacjentów|osób|chorych|kobiet|mężczyzn|seniorów|dorosłych|niemowląt|młodzieży|ludzi)|wśród[ \\t]+[${LO}]+|oznacza(?:ją)?|słownik${L}|klasyfikacj${L}|statystyk${L}|mln)${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Reguła ogólna z podmiotem i zdaniem względnym („Pacjent, który choruje na astmę, może otrzymać
 * refundację”, „Chory, który cierpi na depresję, ma prawo…”): mowa o każdym takim pacjencie.
 * „Pracownik, który choruje na cukrzycę, przedstawił zaświadczenie” opisuje konkretną osobę.
 */
const RE_GENERIC_RULE = new RegExp(
  `^[ \\t"„(]*[${UP}][${LO}]+(?:[ \\t]+[${LO}]+)?[ \\t]*,[ \\t]*któr${L}[^.!?\\n]{1,100}?,[ \\t]*(?:nie[ \\t]+)?(?:powin${L}|może|mogą|ma[ \\t]+prawo|mają[ \\t]+prawo|musi|muszą|przysługuj${L}|należy)${NOT_LETTER_AFTER}`,
);
const isGenericRule = (sentence: string): boolean =>
  mtest(RE_GENERIC_RULE, sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0;

/** Czasownik o przyjmowaniu leku przez osobę („przyjmuje”, „zalecił”); „zaleca się” i „stosuje się do” nie. */
const RE_DRUG_VERB = new RegExp(
  `${NOT_LETTER_BEFORE}(?:zalecił(?:a)?|zalecono|zaleca(?:m)?(?![ \\t]+się)|przyjmuj(?:e|ę)|przyjmował(?:a|em|am)?|stosuj(?:e|ę)(?![ \\t]+się)|stosował(?:a|em|am)?(?![ \\t]+się)|zażyw(?:a|am)|zażywał(?:a|em|am)?|bierze|biorę|brał(?:a|em|am)?|włączył(?:a)?|włączono|ordynował(?:a)?|ordynowano|przepisał(?:a)?|przepisano|wypisał(?:a)?|wypisano|(?<!bez[ \\t]{1,8})recept(?:ę|a|y|ą)[ \\t]+na|na[ \\t]+recepcie)${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Recepta jako dokument osoby („kod recepty przyjdzie smsem”, „e-recepta: Xanax 0,5 mg”). Sama nie jest
 * kotwicą: lek „bez recepty”, „na receptę” albo „wydawany z przepisu lekarza” to opis kategorii leku
 * w komunikacie GIF, ulotce czy ogłoszeniu apteki. Liczy się tylko przy osobie w zdaniu.
 */
const RE_RX_DOC = new RegExp(
  `(?<![${LETTER}])(?<!(?:bez|na|z)[ \\t]{1,8})(?:e-?)?recept(?:a|y|ę|ą|ie)${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Recepta konkretnego pacjenta bez osoby w zdaniu: kod albo numer recepty („kod recepty przyjdzie
 * smsem”) i czynność pacjenta na recepcie („wykupiła receptę”, „odebrałem e-receptę”, „dostał receptę”).
 */
const RE_RX_OWN = new RegExp(
  `${NOT_LETTER_BEFORE}(?:(?:kod(?:em|u)?|numer(?:em|u)?|nr|PIN)[ \\t]+(?:e-?)?recept(?:y|ą)|(?:wykupił|kupił|odebrał|zrealizował|dostał|otrzymał)(?:a|em|am)?[ \\t]+(?:e-?)?recept(?:ę|y))${NOT_LETTER_AFTER}`,
  'i',
);

/** Cena w zdaniu leku: faktura, cennik, lista refundacyjna. */
const RE_PRICE = new RegExp(`${NOT_LETTER_BEFORE}(?:zł|PLN|kosztuj${L}|cen(?:a|y|ę|ie|ą)|brutto|netto)${NOT_LETTER_AFTER}`, 'i');
const RE_MONEY = new RegExp(`${NOT_LETTER_BEFORE}(?:zł|PLN)${NOT_LETTER_AFTER}`, 'i');

/* ── Leki ── */

/**
 * Substancje czynne (rdzeń bez końcówki fleksyjnej) i nazwy handlowe najczęściej spotykane
 * w polskich kartach i zaświadczeniach. Bez dawki ani „doraźnie” nazwa leku zostaje jawna,
 * bo wtedy to zwykle wzmianka w ulotce, cenniku albo przepisie.
 */
const DRUG_STEMS = (
  // układ krążenia
  'ramipryl peryndopryl enalapryl kaptopryl chinapryl lizynopryl bisoprolol metoprolol nebiwolol karwedilol ' +
  'propranolol amlodypin lerkanidypin nitrendypin werapamil diltiazem losartan walsartan telmisartan kandesartan ' +
  'hydrochlorotiazyd indapamid furosemid torasemid spironolakton eplerenon atorwastatyn rosuwastatyn simwastatyn ' +
  'ezetymib acenokumarol warfaryn rywaroksaban apiksaban dabigatran klopidogrel tikagrelor digoksyn amiodaron ' +
  'enoksaparyn ' +
  // cukrzyca, tarczyca, hormony
  'metformin gliklazyd glimepiryd sitagliptyn empagliflozyn dapagliflozyn liraglutyd semaglutyd dulaglutyd ' +
  'lewotyroksyn tiamazol prednizon prednizolon metyloprednizolon deksametazon hydrokortyzon ' +
  // płuca i alergia
  'salbutamol fenoterol formoterol salmeterol budezonid flutykazon beklometazon tiotropium montelukast ' +
  'cetyryzyn lewocetyryzyn desloratadyn feksofenadyn ' +
  // przewód pokarmowy
  'pantoprazol omeprazol esomeprazol lanzoprazol mesalazyn sulfasalazyn budesonid azatiopryn ' +
  // psychiatria i neurologia
  'sertralin escitalopram citalopram fluoksetyn paroksetyn fluwoksamin wenlafaksyn duloksetyn mirtazapin ' +
  'trazodon bupropion agomelatyn wortioksetyn kwetiapin olanzapin rysperydon arypiprazol klozapin haloperydol ' +
  'lamotrygin karbamazepin okskarbazepin lewetyracetam walproinian pregabalin gabapentyn topiramat ' +
  'alprazolam lorazepam diazepam klonazepam hydroksyzyn zolpidem melatonin donepezil memantyn lewodop ' +
  // ból i zapalenie
  'ibuprofen paracetamol ketoprofen deksketoprofen diklofenak naproksen metamizol tramadol morfin oksykodon ' +
  'fentanyl kodein nimesulid meloksykam celekoksyb ' +
  // antybiotyki i inne
  'amoksycylin klarytromycyn azytromycyn cefuroksym cyprofloksacyn lewofloksacyn doksycyklin nitrofurantoin ' +
  'metotreksat allopurynol kolchicyn alendronian ' +
  // nazwy handlowe
  'euthyrox letrox concor bisocard polpril tritace prestarium amlozek atoris siofor glucophage ventolin berodual ' +
  'symbicort seretide asertin zoloft xanax pramolan hydroxyzinum depakine lamitrin keppra ketonal nurofen ' +
  'ibuprom apap pyralgina clexane xarelto eliquis pradaxa encorton medrol controloc nolpaza polocard acard ' +
  'lantus humalog novorapid tresiba toujeo mixtard relanium tegretol medikinet concert ritalin strattera rispolept ketrel ' +
  'ketipinor zyprexa abilify convulex neurotop trittico mirzaten velaxin efectin elicea cipralex seroquel lorafen ' +
  // substancje bez typowej końcówki INN
  'heparyn tamsulosyn budezonid ceftriakson progesteron'
).split(/\s+/);
/**
 * Końcówka fleksyjna po rdzeniu leku („sertraliną”, „salbutamolu”, „Euthyroxem”, „Concorze”), a nie
 * dowolne litery: „Concordia” (ubezpieczyciel) czy „Acardia” to nie odmiana leku, tylko inne słowo.
 */
const DRUG_INFL = `(?:a|ą|ę|e|i|y|u|em|ie|iem|ze|zie|cie|ów|om|owi|ami|ach)?`;
/** Nazwa leku z końcówką („sertraliną”, „salbutamolu”, „Euthyroxu”), wielka litera na początku dozwolona. */
const DRUG_NAME = `(?<![${LETTER}])(?:${DRUG_STEMS.map((s) => `[${s[0]}${s[0].toUpperCase()}]${escapeRe(s.slice(1))}`).join('|')})${DRUG_INFL}${NOT_LETTER_AFTER}`;
const RE_DRUG_NAME = new RegExp(DRUG_NAME, 'i');
/** Człon nazwy handlowej po nazwie („Euthyrox N”, „Depakine Chrono”, „Concor Cor”). */
const DRUG_MOD = String.raw`(?:[ \t]+(?:N|SR|XR|CR|XL|ODT|Chrono|Forte|Retard|Mite|Max|Plus|Duo|Combi|Comp|HCT|Neo|Rapid|Long|Mini|Cor|Junior)(?![${LETTER}]))?`;
const NUM = String.raw`\d+(?:[.,]\d+)?`;
const UNIT = String.raw`(?:mg|g|µg|μg|mcg|ml|j\.?m\.?|jm|j\.|IU)`;
/** Jednostki typowo lekowe: bez „g” i „ml”, które stoją też w zaleceniach dietetycznych i protokołach. */
const UNIT_DRUG = String.raw`(?:mg|µg|μg|mcg|j\.?m\.?|jm|j\.|IU)`;
/** Dawka: liczba i jednostka („50 mg”, „1 g”, „2,5 mg”, „100 µg”, „10 j.”, „5 mg/ml”). */
const doseOf = (unit: string): string =>
  String.raw`${NUM}(?:[ \t]*\/[ \t]*${NUM})?[ \t]?${unit}(?:[ \t]*\/[ \t]*(?:ml|dobę|d|24[ \t]?h))?(?![${LETTER}])`;
const DOSE = doseOf(UNIT);
const DOSE_DRUG = doseOf(UNIT_DRUG);
/**
 * Droga podania w zleceniu („s.c.”, „i.m.”, „p.o.”, „doustnie”, „podskórnie”). Skróty tylko z kropką
 * między literami: gołe „po”, „im”, „iv” to przyimek, zaimek albo numer.
 */
// Kropka po skrócie należy do skrótu tylko przed dalszym ciągiem zalecenia („s.c. raz dziennie”);
// na końcu zdania („i.m. Stan dobry.”) zostaje, żeby kolejne zdanie nie dołączyło do maski.
// Dalszy ciąg nazwany wprost, bo wzorce leków mają flagę „i” i klasa małych liter łapie też wielkie.
const ROUTE_DOT = String.raw`(?:\.(?=[ \t]{0,8}(?:\d|[,;(]|(?:raz|dwa|trzy|co|rano|wieczorem|na|dziennie|doraźnie|przez|w)(?![${LETTER}]))))?`;
const ROUTE = String.raw`(?:(?:s\.c|i\.v|i\.m|p\.o|s\.l)${ROUTE_DOT}|doustnie|podskórnie|dożylnie|domięśniowo|wziewnie|podjęzykowo|doodbytniczo|przezskórnie|dopochwowo|donosowo)(?![${LETTER}])`;
const RE_ROUTE = new RegExp(`(?<![${LETTER}])${ROUTE}`);
/**
 * Pozycja dawkowania: „2 x dziennie”, „1-0-1”, „raz dziennie”, „2 razy w tygodniu”, „rano”, „na noc”,
 * „na czczo”, „co 8 godzin”, „doraźnie” i droga podania („s.c.”, „doustnie”).
 */
const DOSING_ITEM = String.raw`(?:\d[ \t]?x[ \t]?(?:dziennie|\d+|na[ \t]+dobę|w[ \t]+tygodniu)|\d(?:-\d){2}|(?:raz|dwa[ \t]+razy|trzy[ \t]+razy|\d[ \t]?razy)[ \t]+(?:dziennie|na[ \t]+dobę|w[ \t]+tygodniu)|rano|wieczorem|na[ \t]+noc|na[ \t]+czczo|co[ \t]+\d{1,2}[ \t]?(?:godzin[ay]?|h)|dziennie|doraźnie|${ROUTE})(?![${LETTER}])`;
// Jeden odstęp z opcjonalnym przecinkiem: dwa sąsiednie [ \t]* dawały wykładnicze cofanie na długich ciągach spacji.
const DOSING = String.raw`(?:[ \t]*(?:,[ \t]*)?${DOSING_ITEM})*`;
const DOSING_REQ = String.raw`(?:[ \t]*(?:,[ \t]*)?${DOSING_ITEM})+`;
const DRUG_FORM = String.raw`(?:[ \t]+(?:w[ \t]+dawce(?:[ \t]+dobowej)?|tabl\.|kaps\.|tabletk[${LO}]*|kapsułk[${LO}]*)[ \t]*:?)?`;
const INSULIN_KIND = `(?:aspart|lispro|glargin[${LO}]*|detemir|degludek|glulizyn[${LO}]*|ludzk[${LO}]*|NPH|izofanow[${LO}]*)`;
const RE_DRUG = new RegExp(
  String.raw`(?:${DRUG_NAME}${DRUG_MOD}(?:${DRUG_FORM}[ \t]+(?:${DOSE}${DOSING}|${NUM}${DOSING_REQ})|[ \t]+doraźnie(?![${LETTER}]))|(?<![${LETTER}])[Ii]nsulin[${LO}]{0,3}[ \t]+${INSULIN_KIND}(?![${LETTER}])(?:[ \t]+${DOSE}${DOSING})?)`,
  'gi',
);
const LINE_END = String.raw`[ \t]*(?:[.;,][ \t]*)?$`;
const LIST_HEAD = String.raw`^[ \t]*(?:[-•*][ \t]*|\d{1,2}[.)][ \t]*)?`;
/** Cały wiersz listy to lek ze słownika („salbutamol doraźnie”, „insulina aspart”). */
const RE_DRUG_LINE = new RegExp(`${LIST_HEAD}(?:${RE_DRUG.source})${LINE_END}`, 'i');
/** Wiersz „nazwa dawka” dla leku spoza słownika („Xyzanol 10 mg”), tylko z jednostką lekową. */
const RE_DOSE_LINE = new RegExp(
  String.raw`${LIST_HEAD}[${LETTER}][${LETTER}-]{2,30}(?:[ \t]+[${LETTER}][${LETTER}-]{2,30})?${DRUG_FORM}[ \t]+${DOSE_DRUG}${DOSING}${LINE_END}`,
);
const RE_HAS_DOSE = new RegExp(String.raw`(?<![\d${LETTER}])${DOSE}|${DOSING_ITEM}`, 'i');

/* ── Frazy opisowe ── */

/** Części ciała w dopełniaczu po nazwie urazu („złamania kości promieniowej”). */
const ANATOMY = [
  'klatki[ \\t]+piersiowej', 'kości', 'kość', 'więzadła', 'więzadeł', 'ścięgna', 'ścięgien', 'łąkotki', 'kręgosłupa',
  'kręgu', 'kręgów', 'głowy', 'czaszki', 'mózgu', 'szyi', 'barku', 'łokcia', 'nadgarstka', 'ręki', 'dłoni', 'palca',
  'palców', 'przedramienia', 'ramienia', 'obojczyka', 'łopatki', 'żebra', 'żeber', 'miednicy', 'biodra', 'uda',
  'kolana', 'kolan', 'podudzia', 'goleni', 'kostki', 'stawu', 'stawów', 'stopy', 'stóp', 'pięty', 'nosa', 'twarzy',
  'żuchwy', 'szczęki', 'oczodołu', 'oka', 'zęba', 'zębów', 'śledziony', 'wątroby', 'nerki', 'płuca', 'mostka',
  'nogi', 'nóg', 'rąk', 'kończyny(?:[ \\t]+(?:górnej|dolnej))?', 'kończyn(?:[ \\t]+(?:górnych|dolnych))?',
].join('|');
/** Strona ciała przed częścią ciała („złamania prawej nogi”, „stłuczenia lewego barku”). */
const SIDE = '(?:(?:lew|praw)(?:ej|ego|ych)[ \\t]+)?';
/** Dopełniacz techniczny po części ciała: „klatki schodowej”, „kolana instalacji”, „ramienia dźwigu”. */
const TECH_AFTER = `(?![ \\t]+(?:schodow|brukow|instalacj|dźwig|żuraw|maszyn|rur|wodn|kanalizac|gazow|hydraulic|urządze|pojazd|most|konstrukc|słup|fundament|cylindr|strop|belk|ścian|dach|wał|silnik|tłok|kolumn|filar|dźwigar|kratownic|stalow|betonow|żelbet|nośn|krokw|balustrad|robot|stoł|stół|krzes|łóżk|mebl|kran|zawor|okn|drzwi|wysięgnik|koparki|ładowark)${L})`;
const ADJ = `[${LO}]{3,}(?:ej|ego|ych|ich|nej|owej|owego|nego)`;
const BODY_ACC =
  `(?:(?:lew|praw)(?:ą|y|e|a)[ \\t]+)?(?:nogę|nogi|rękę|ręce|kostkę|bark|kolano|nadgarstek|łokieć|palec|palce|kciuk|żebro|żebra|obojczyk|` +
  `kość(?:[ \\t]+${ADJ})?|kręgosłup|staw(?:[ \\t]+${ADJ})?|nos|szczękę|żuchwę|biodro|stopę|ramię|przedramię|udo|piszczel|` +
  `więzadło(?:[ \\t]+${ADJ}){0,2}|ścięgno(?:[ \\t]+Achillesa)?|łąkotkę|miednicę|łopatkę)`;
const BODY_LOC = '(?:[ \\t]+(?:w|we)[ \\t]+(?:kostce|kolanie|nadgarstku|łokciu|barku|biodrze|stawie|udzie|kostkach|kolanach))?';
const SPECIALIST =
  'psychiatry psychiatrów psychoterapeuty psychologa onkologa kardiologa neurologa diabetologa endokrynologa ' +
  'ginekologa ortopedy reumatologa gastroenterologa urologa pulmonologa nefrologa hematologa fizjoterapeuty ' +
  'dermatologa alergologa okulisty laryngologa seksuologa';
const SPEC_RE = SPECIALIST.split(' ').join('|');
/**
 * Substancja albo czynność nałogu po „uzależniony od”, „uzależnienie od”: zamknięta lista, bo „gmina
 * uzależniona od dotacji” i „firma uzależniona od dostawcy” to zależność, a nie nałóg.
 */
const SUBST = String.raw`(?:alkoholu|narkotyków|opioidów|opiatów|leków(?:[ \t]+(?:nasennych|uspokajających|przeciwbólowych))?|hazardu|amfetaminy|metamfetaminy|marihuany|kokainy|heroiny|dopalaczy|mefedronu|benzodiazepin|nikotyny|substancji[ \t]+psychoaktywnych|środków[ \t]+odurzających|gier[ \t]+(?:hazardowych|komputerowych))`;

/** Odstęp we frazie: spacje albo jedno łamanie wiersza (OCR, wąska kolumna, tabela). */
const WS = String.raw`(?:[ \t]{1,4}|[ \t]{0,4}\r?\n[ \t]{0,8})`;
/** Wyraz w dopełniaczu między urazem a częścią ciała („złamanie trzonu kości”, „stłuczenie odcinka szyjnego kręgosłupa”). */
const INJ_GEN = `(?:[${LO}]{3,}(?:a|u|y|i|ej|ego)${WS}){0,2}`;

/*
 * Nazwa choroby po budowie słowa, a nie ze słownika całych nazw: przyrostki medyczne (-opatia,
 * -algia, -oza, -emia krwi), przedrostek dys- zaburzeń rozwojowych, nazwy guzów, przedrostek niedo-
 * ubytku funkcji, infekcje. Słowa ogólne o tej samej budowie odpadają przez pełny przyrostek
 * („sympatia”, „empatia” nie mają „-opatia”) albo wyjątek („diagnoza”, „prognoza”, „nostalgia”,
 * „glukoza”, „symbioza”, „wirtuoza”). „Dysfunkcja” („rodzina dysfunkcyjna”) nie jest rozpoznaniem.
 */
const DX_MORPH = [
  `[${LO}]{2,}opati${L}`,
  `(?!nostalg)[${LO}]{2,}algi${L}`,
  // -oza choroby stoi po rdzeniu greckim; rdzenie polskie z „-oz-” to pojazd i transport („przewozy”,
  // „betonowozy”, „przewozie” od „wozić”), pogoda („przymrozy”), „groza” i „proza”; cukry i słowa
  // ogólne odpadają też w złożeniach („galaktoza”, „prediagnoza”), bo wyjątek stoi tuż przed „-oza”
  `[${LO}]{4,}(?<!(?:diagn|progn|metamorf|symbi|hipn|apote|gluk|frukt|lakt|celul|sachar|dekstr|malt|wirtu|mafi|kolch|kołch|sowch|w|mr|gr|pr))oz(?:a|y|ę|ą|ie|om)`,
  `(?:hipo|hiper|dys)?(?:glik|lipid|cholesterol|kali|natr|kalc|uryk)emi${L}|bakteriemi${L}|wiremi${L}|toksemi${L}|uremi${L}|anemi${L}|leukemi${L}`,
  `dys(?:leksj|ortografi|grafi|kalkuli|praksj|lali|fagi|artri|plazj|toni|kinez|trofi|rytmi|menore)${L}`,
  `(?:chłoniak|mięśniak|czerniak|glejak|tłuszczak|włókniak|naczyniak|szpiczak|gruczolak|oponiak|nerwiak|kostniak)${L}`,
  `(?:gruźlic|łuszczyc|miażdżyc|zakrzepic|kamic|żółtacz|grzybic|posocznic)${L}`,
  `niedo(?:wład|słuch|widzeni|krwistoś|żywieni|tlenieni)${L}`,
  // „niedorozwój” bez dopełnienia medycznego to przenośnia z pism samorządu („niedorozwój sieci
  // kanalizacyjnej”, „rynku pracy”, „komunikacji publicznej”); choroba tylko z rodzajem albo narządem
  `niedorozw(?:ój|oju|ojem)${WS}(?:(?:umysłow|intelektualn|psychiczn|psychoruchow|fizyczn|ruchow|płciow)${L}|narząd(?:u|ów)|${SIDE}(?:${ANATOMY}|serca|móżdżku|ucha|uszu|oczu|gałki${WS}ocznej|tarczycy|macicy|jajnik(?:a|ów)|szkliwa|żuchwy)(?![${LETTER}]))`,
  `autyzm${L}|afazj${L}|demencj${L}|otępieni${L}|nerwic${L}|migren${L}`,
  `gryp(?:a|y|ę|ą|ie)|angin(?:a|y|ę|ą|ie)|osp(?:a|y|ę|ą|ie)(?:${WS}wietrzn${L})?|różyczk${L}|szkarlatyn${L}|seps(?:a|y|ę|ą|ie)`,
].join('|');
/** Skrót rozpoznania pisany wersalikami („ADHD”, „PTSD”, „POChP”); bez skrótów z innym znaczeniem (SM, AZS, MPD). */
const DX_ACRONYM = 'ADHD|PTSD|POChP|ChAD|OCD|FASD|RZS|SMA|IBS|GERD|AIDS|ZZSK';
/**
 * Nazwisko w nazwie zespołu albo choroby („zespół Aspergera”, „choroba Leśniowskiego-Crohna”). Odpada
 * rzeczownik odczasownikowy i przymiotnik z nazwy instytucji („Zespół Wsparcia”, „Zespół Szybkiego
 * Reagowania”, „Zespół Kontroli”), bo eponim kończy się inaczej.
 */
const EPONYM = `[${UP}][${LO}'’é]{2,}(?:-[${UP}][${LO}'’é]{2,})?(?<!(?:ni|ci|si|zi|ji|dzi)a|[${LO}](?:ego|ej|ych|ości|i|y|ów|u|ł))`;
/** Określenie medyczne zespołu („zespół hiperkinetyczny”); „zespół redakcyjny”, „zespół orzekający” to grupa ludzi. */
const ZESP_MOD = `(?:hiperkinetyczn|depresyjn|abstynencyjn|nerczycow|metaboliczn|bólow|korzeniow|otępienn|psychoorganiczn|odstawienn)${L}|zależności${WS}(?:alkoholowej|od)|stresu${WS}pourazowego|jelita${WS}drażliwego|cieśni${WS}nadgarstka|policystycznych${WS}jajników|niespokojnych${WS}nóg|przewlekłego${WS}zmęczenia`;
/** Określenie medyczne choroby albo zaburzeń: rodzaj, narząd, funkcja („choroba otępienna”, „zaburzenia snu”). */
const CHOR_MOD =
  `(?:otępienn|nowotworow|psychiczn|afektywn|neurologiczn|metaboliczn|zakaźn|wrodzon|genetyczn|autoimmunologiczn|zwyrodnieniow|reumatyczn|reumatoidaln|dwubiegunow|wieńcow|niedokrwienn|nadciśnieniow|alkoholow|zawodow|wrzodow|refluksow|psychotyczn|lękow|depresyjn|adaptacyjn|obsesyjn|ruchow|przewlekł)${L}` +
  `|(?:nerek|wątroby|płuc|serca|tarczycy|naczyń|stawów|kręgosłupa|oczu|skóry|krwi|jelit|trzustki|osobowości|odżywiania|snu|mowy|słuchu|wzroku|nastroju|rytmu${WS}serca|integracji${WS}sensorycznej|ze${WS}spektrum${WS}autyzmu)(?![${LETTER}])`;
/** Zespół, choroba i zaburzenia z określeniem medycznym; bez nagłówka pola („Choroby przewlekłe:”). */
const DX_NAMED =
  `(?:${cap('zesp')}(?:ół|ołu|ołem|ole)${WS}(?:${ZESP_MOD}|${EPONYM}(?![ \t]{1,4}[${UP}]))|${cap('chor')}(?:ob(?:a|y|ę|ą|ie|om)|ób)${WS}(?:${CHOR_MOD})|${cap('zaburze')}(?:nie|nia|niem|niu|ń|niami)${WS}(?:${CHOR_MOD}))(?![ \\t]*:)`;
/** Alergen po „alergia na”, „uczulenie na”: „alergia na polityków” to przenośnia. */
const ALLERGEN =
  'białk|mlek|mlecz|orzech|orzesz|arachid|pyłk|pyłek|roztocz|sierś|kurz|penicylin|antybiotyk|lek|jad|gluten|laktoz|jaj|ryb|owoc|truskaw|cytrus|użądleni|lateks|nikiel|nikl|soj|pszen|zbóż|seler|gorczyc|sezam|skorupiak|mięczak|pokarm|traw|brzoz|sulfonamid|aspiryn|ibuprofen|jod|kontrast|pleś|kakao|czekolad|miód|miod|kiwi';

type Anchor = (text: string, starts: number[], from: number, to: number, mask: string) => boolean;

interface Phrase {
  re: RegExp;
  /** Nazwa choroby albo urazu: w drugim przebiegu także z kotwicą osoby (diseaseAnchor). */
  late?: boolean;
  /** Czy fraza sama wskazuje osobę i nie potrzebuje kotwicy w zdaniu. */
  self?: boolean;
  /** Własna kotwica zamiast medycznej (ciąża, pobyt w szpitalu psychiatrycznym). */
  anchor?: Anchor;
}

const dx = (p: Phrase): Phrase => ({ ...p, late: true });
const phrase = (src: string, self = false, anchor?: Anchor): Phrase => ({
  re: new RegExp(`${NOT_LETTER_BEFORE}(?:${src})${NOT_LETTER_AFTER}`, 'gi'),
  self,
  anchor,
});

/** Zdanie warunkowe albo względne przed frazą („Jeżeli pracownica jest w ciąży…”, „która jest w ciąży”). */
const RE_CONDITIONAL = new RegExp(`${NOT_LETTER_BEFORE}(?:jeżeli|jeśli|gdy|gdyby|kiedy|o[ \\t]+ile|któr${L}|kto)${NOT_LETTER_AFTER}`, 'i');
const sentenceHead = (text: string, starts: number[], from: number): string =>
  text.slice(Math.max(starts[sentenceIndex(starts, from)], from - SPAN), from);
const populationSubject = (text: string, starts: number[], from: number): boolean =>
  mtest(RE_POPULATION_SUBJECT, sentenceHead(text, starts, from));
/** Kotwica medyczna albo konkretna osoba w zdaniu, ale nie w regule ogólnej ani zdaniu warunkowym. */
const personAnchor: Anchor = (text, starts, from, to, mask) => {
  if (medicalAnchored(text, starts, from, to, mask)) return true;
  const sentence = sentenceAt(text, starts, from, to);
  if (mtest(RE_CONDITIONAL, sentenceHead(text, starts, from)) || isGenericRule(sentence)) return false;
  return personNear(text, sentence, from, to);
};
/** Personel szpitala („pielęgniarka w szpitalu psychiatrycznym”, „pracuje w…”) to miejsce pracy, a nie pobyt. */
const RE_HOSPITAL_STAFF = new RegExp(
  `${NOT_LETTER_BEFORE}(?:pracuj${L}|pracował${L}|zatrudni${L}|praktyk${L}|staż${L}|dyżur${L}|wolontariu${L}|lekar${L}|lekark${L}|pielęgniar${L}|ordynator${L}|kierowni${L}|dyrektor${L}|psycholog${L}|terapeut${L}|personel${L}|ratowni${L}|salow${L}|sanitariusz${L})${NOT_LETTER_AFTER}`,
  'i',
);
const stayAnchor: Anchor = (text, starts, from, to, mask) =>
  !mtest(RE_HOSPITAL_STAFF, sentenceHead(text, starts, from)) && personAnchor(text, starts, from, to, mask);

// Frazy, które same wskazują osobę, idą pierwsze: ich maska jest kotwicą dla fraz dalej.
const PHRASES: Phrase[] = [
  // nałogi: czasownik osobowy w liczbie pojedynczej wskazuje osobę, ale nie w zdaniu względnym
  // ani po „kto” („osoby, które nadużywają alkoholu”, „kto nadużywa alkoholu, podlega…”)
  phrase(String.raw`(?<!(?:któr${L}|kto)[ \t]{1,8})nadużyw(?:a|ał|ała)[ \t]+(?:alkoholu|narkotyków|leków|substancji[ \t]+psychoaktywnych)`, true),
  // „jest nosicielem HCV”, „była zakażona wirusem HIV”: łącznik wskazuje osobę
  phrase(
    String.raw`(?<=(?:jest|był|była|został|została)[ \t]{1,8})(?:nosiciel(?:em|ką)[ \t]+(?:wirusa[ \t]+)?(?:HCV|HBV|HIV|WZW[ \t]+typu[ \t]+[BC])|zakażon[ya][ \t]+(?:wirusem[ \t]+)?(?:HIV|HCV|HBV))`,
    true,
  ),
  // uraz zapisany czasownikiem w czasie przeszłym („złamał nogę w kostce”, „skręciłam kostkę”)
  phrase(
    String.raw`(?:(?:złamał|skręcił|naderwał|zerwał|nadwyrężył)(?:a|em|am)?|zwichn(?:ął|ęła|ąłem|ęłam)|stłukł(?:a|em|am)?|rozci(?:ął|ęła|ąłem|ęłam))[ \t]+(?:sobie[ \t]+)?${BODY_ACC}${TECH_AFTER}${BODY_LOC}`,
    true,
  ),
  // choroby
  dx(phrase(
    String.raw`cukrzyc(?:a|y|ę|ą|e|o)(?:[ \t]+typu[ \t]+(?:1|2|I{1,2}|pierwszego|drugiego)|[ \t]+ciążow${L})?(?:[ \t]+(?:insulinozależn|insulinoniezależn)${L})?(?:[ \t]+bez[ \t]+powikłań)?`,
  )),
  dx(phrase(
    String.raw`epizod${L}[ \t]+depresyjn${L}(?:[ \t]+(?:umiarkowan|łagodn|ciężk)${L})?|depresj(?:a|i|ę|ą)(?![ \t]+(?:(?:na|w|we)[ \t]+)?(?:gospodar|ekonomi|teren|baryczn|termiczn|geograficzn|tektoniczn|rynk|rynek|koniunktur|giełd|branż|sektor|przemyś|budownictw|nieruchomoś|handl|eksport|finans)${L})|zaburzeni${L}[ \t]+(?:depresyjn|lękow|afektywn|psychotyczn|adaptacyjn|osobowości|odżywiania)${L}`,
  )),
  dx(phrase(String.raw`nadciśnieni${L}(?:[ \t]+tętnicz${L}(?:[ \t]+samoistn${L})?)?(?![ \t]+(?:wody|gazu|powietrza|pary|oleju|instalacj${L}|układu|(?:w|we)[ \t]+(?:instalacji|układzie|zbiorniku|rurociągu|sieci|kotle|przewodzie|przewodach|rurze|rurach|komorze|cylindrze|pompie|zaworze|systemie|obwodzie|linii|kolektorze|naczyniu|kanale|turbinie|sprężarce|siłowniku|hydraulice|oponie|oponach|ogumieniu)))`)),
  dx(phrase(String.raw`astm(?:a|y|ę|ą|ie)(?:[ \t]+oskrzelow${L})?`)),
  dx(phrase(
    String.raw`chor(?:ob(?:a|y|ę|ą|ie|om)|ób)[ \t]+(?:Leśniowskiego-Crohna|Crohna|Hashimoto|Parkinsona|Alzheimera|Gravesa(?:-Basedowa)?|Huntingtona|Bechterewa|Addisona|Cushinga|afektywn${L}[ \t]+dwubiegunow${L}|alkoholow${L}|nowotworow${L}|niedokrwienn${L}[ \t]+serca|wieńcow${L}|psychiczn${L})(?:[ \t]+jelita[ \t]+(?:cienkiego|grubego))?`,
  )),
  dx(phrase(String.raw`stwardnieni${L}[ \t]+rozsian${L}|schizofreni${L}|padaczk${L}|epilepsj${L}|białaczk${L}|chłoniak${L}|nowotw[oó]r${L}(?:[ \t]+(?:złośliw|łagodn)${L})?(?:[ \t]+(?:piersi|płuc|płuca|jelita(?:[ \t]+grubego)?|prostaty|szyjki[ \t]+macicy|trzustki|żołądka|skóry|krtani|jajnika|nerki|nerek|pęcherza(?:[ \t]+moczowego)?|tarczycy|wątroby|odbytnicy|mózgu|kości))?|jaskr(?:a|y|ę|ą|ze)|zaćm(?:a|y|ę|ą|ie)`)),
  dx(phrase(
    String.raw`rak(?:a|iem|u)?[ \t]+(?:piersi|płuc|jelita(?:[ \t]+grubego)?|prostaty|szyjki[ \t]+macicy|trzustki|żołądka|skóry|krtani|jajnika|nerki|pęcherza(?:[ \t]+moczowego)?|tarczycy|wątroby|odbytnicy)`,
  )),
  // leczenie przewlekłe: kotwica medyczna albo konkretna osoba („jestem na dializach”, „matkę na dializy”)
  phrase(`chemioterapi${L}|radioterapi${L}|immunoterapi${L}|insulinoterapi${L}|dializ(?:a|y|ę|ą|ie|ach|om)`, false, eventOrMedical),
  dx(phrase(
    String.raw`zapaleni${L}[ \t]+(?:płuc|oskrzeli|wyrostka(?:[ \t]+robaczkowego)?|opon[ \t]+mózgowo-rdzeniowych|trzustki|wątroby|stawów|ucha|zatok|pęcherza(?:[ \t]+moczowego)?|nerek|mięśnia[ \t]+sercowego)`,
  )),
  dx(phrase(`COVID(?:-19)?|SARS-CoV-2|koronawirus${L}`)),
  // „jest w ciąży”, „jest w 5. miesiącu ciąży”, „była w piątym tygodniu ciąży”
  phrase(
    String.raw`(?<=(?:jest|była|będąc${L})[ \t]{1,8})w[ \t]+(?:(?:\d{1,2}\.?|[${LO}]{3,}(?:ym|im))[ \t]+(?:miesiącu|tygodniu)[ \t]+)?ciąży`,
    false,
    personAnchor,
  ),
  // pobyt w szpitalu psychiatrycznym; sam „szpital” bez przymiotnika zostaje jawny
  phrase(String.raw`(?<=(?:w|we|do|ze|z)[ \t]{1,8})szpital(?:u|a|em)?[ \t]+psychiatryczn(?:ym|ego|y)`, false, stayAnchor),
  dx(phrase(
    String.raw`udar${L}(?:${WS}(?:niedokrwienn|krwotoczn)${L})?${WS}mózgu|udar${L}${WS}(?:niedokrwienn|krwotoczn)${L}|zawał${L}[ \t]+(?:serca|mięśnia[ \t]+sercowego)|niedoczynnoś${L}[ \t]+tarczycy|nadczynnoś${L}[ \t]+tarczycy|(?:zakażeni|zakażon)${L}[ \t]+(?:wirusem[ \t]+)?(?:HIV|HCV|HBV)|nosiciel${L}[ \t]+(?:wirusa[ \t]+)?(?:HCV|HBV|HIV)`,
  )),
  dx(phrase(String.raw`anoreksj${L}|bulimi${L}|alkoholizm${L}|uzależnieni${L}[ \t]+od[ \t]+${SUBST}`)),
  // urazy z częścią ciała
  dx(phrase(
    `(?:(?:stłuczeni|złamani|zwichnięci|skręceni|zerwani|naderwani|pęknięci|oparzeni|wstrząśnieni)${L}|uraz(?:u|em|y|ów)?)${WS}${INJ_GEN}${SIDE}(?:${ANATOMY})(?![${LETTER}])${TECH_AFTER}(?:${WS}(?:${ADJ}|${SIDE}(?:${ANATOMY})(?![${LETTER}])${TECH_AFTER})){0,4}`,
  )),
  // zabiegi, leczenie, wizyty
  phrase(String.raw`cesarski${L}[ \t]+cięci${L}|cięci${L}[ \t]+cesarski${L}`),
  phrase(String.raw`rehabilitacj${L}[ \t]+(?:ruchow|lecznicz|medyczn|kardiologiczn|neurologiczn|ortopedyczn|pulmonologiczn)${L}`),
  phrase(String.raw`(?:wizyt|konsultacj|leczeni)${L}[ \t]+u[ \t]+(?:${SPEC_RE})|pod[ \t]+opieką[ \t]+(?:(?:lekarza[ \t]+)?(?:${SPEC_RE})|poradni[ \t]+zdrowia[ \t]+psychicznego)`),
  phrase(String.raw`pomiar${L}[ \t]+glikemii|(?:podani|podawani|przyjmowani)${L}[ \t]+insulin${L}`),
  // „uzależniony od alkoholu” stoi też w przepisach („osoba uzależniona od alkoholu nie może…”)
  phrase(String.raw`uzależnion(?:y|a|e|i|ego|ej|ym)[ \t]+od[ \t]+${SUBST}`),
  phrase(String.raw`nadużywani${L}[ \t]+(?:alkoholu|narkotyków|leków)`),
  // rozpoznanie spoza listy: nazwa choroby po budowie słowa, skrót rozpoznania, zespół i choroba
  // z określeniem medycznym, alergia na alergen, opóźniony rozwój; kotwica jak przy zdarzeniu
  phrase(DX_MORPH, false, morphAnchor),
  { re: new RegExp(`(?<![${LETTER}])(?:${DX_ACRONYM})(?![${LETTER}])`, 'g'), anchor: acronymAnchor },
  { re: new RegExp(`(?<![${LETTER}])(?:${DX_NAMED})(?![${LETTER}'’-])`, 'g'), anchor: namedAnchor },
  phrase(
    `(?:alergi|uczuleni|nietolerancj)${L}(?:${WS}pokarmow${L})?${WS}na${WS}(?:${ALLERGEN})${L}(?:${WS}(?!(?:i|oraz|a|ale|lub|jest|ma|się|nie|wymaga)(?![${LETTER}]))[${LO}]{3,}(?:a|u|y|i|ego|ych|ów)){0,3}`,
    false,
    diseaseAnchor,
  ),
  phrase(
    `(?:opóźnion${L}|zaburzon${L}|nieharmonijn${L})${WS}rozw(?:ój|oju|ojem)${WS}(?:mowy|psychoruchow${L}|ruchow${L}|intelektualn${L}|umysłow${L})|opóźnieni${L}${WS}rozwoju${WS}(?:mowy|psychoruchowego|ruchowego|intelektualnego|umysłowego)`,
    false,
    diseaseAnchor,
  ),
  phrase(`aparat${L}${WS}słuchow${L}|implant${L}${WS}ślimakow${L}`, false, diseaseAnchor),
];
/** Te same frazy bez flagi „g” do sprawdzania, czy w tekście jest nazwa choroby. */
const PHRASE_TESTS = PHRASES.map((p) => new RegExp(p.re.source, 'i'));
const hasDisease = memo((s: string): boolean => PHRASE_TESTS.some((re) => re.test(s)));
const PHRASE_AT_START = PHRASES.map((p) => new RegExp(`^(?:${p.re.source})`, 'i'));

/** Słownictwo medyczne w otoczeniu nagłówka sekcji: karta ze szpitala, a nie raport techniczny. */
const RE_MED_VOCAB = new RegExp(
  `${NOT_LETTER_BEFORE}(?:${STRONG}|pacjen(?:t|tk)${L}|leczeni${L}|hospitaliz${L}|porod${L}|poród|lekar${L}|lekark${L}|szpital${L}|przychodni${L}|poradni${L}|klinik${L}|ICD(?:-?10)?|pielęgniar${L}|ordynator${L}|oddział${L}[ \\t]+(?:chorób|kardiolog|neurolog|chirurg|psychiatr|onkolog|wewnętrzn|intensywn|ratunkow|pediatr|ginekolog|ortoped)${L})${NOT_LETTER_AFTER}`,
  'i',
);
const hasMedVocab = (s: string): boolean => mtest(RE_MED_VOCAB, s) || hasDisease(s) || mtest(RE_DRUG_NAME, s);

/* ── Zdarzenia zdrowotne przy osobie ── */

// Zdarzenie zdrowotne to fakt z życia konkretnej osoby: zwolnienie lekarskie i zasiłek chorobowy,
// orzeczenie o niepełnosprawności albo niezdolności, leczenie, pobyt w szpitalu, zabieg, ciąża,
// nałóg i jego leczenie, opieka specjalisty. Same słowa stoją też w przepisach, regulaminach,
// pouczeniach i nazwach instytucji („Zwolnienia lekarskie należy dostarczyć w ciągu 7 dni”,
// „art. 92 Kodeksu pracy”, „Powiatowy Zespół do Spraw Orzekania o Niepełnosprawności”), więc
// fraza zdarzenia jest pisana małą literą (poza początkiem zdania), a kotwicą jest osoba w zdaniu
// i brak zdania normatywnego. Maska obejmuje frazę z dopowiedzeniem medycznym (czego dotyczy,
// stopień, okres), nigdy nazwy placówki pisanej wielką literą ani osoby.
// Formy rozpoznawane mechanizmem, a nie listą zdań: imiesłów bierny po łączniku („jest leczona
// psychiatrycznie”, „był operowany”), zabieg po budowie słowa (-ektomia, -skopia, przeszczep
// z narządem), pobyt z podmiotem-człowiekiem (pismo i przesyłka też „trafiają do szpitala”).
// Fraza nie jest zdarzeniem, gdy nazywa temat pisma albo procedury („zasady wypłaty zasiłku
// chorobowego”, „druk zwolnienia lekarskiego”, „pytanie o urlop dla poratowania zdrowia”).

const MONTH_GEN = 'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia';
/**
 * Data w okresie: „17.03”, „20.12.2026 r.”, „3 marca 2026”. Skrót „r.” w środku zdania wchodzi do maski
 * cały; na końcu zdania kropka zostaje jako jego koniec.
 */
const EV_DATE = String.raw`(?:\d{1,2}[./]\d{1,2}(?:[./](?:\d{4}|\d{2}))?|\d{1,2}[ \t]+(?:${MONTH_GEN})(?:[ \t]+\d{4})?)(?:[ \t]*r\.(?=[ \t]*[,;)]|[ \t]+[${LO}])|[ \t]*r(?=\.))?`;
/** Okres tuż po frazie: „od 3 do 17 marca”, „do 27.11”, „od 1.03.2026 r”, „przez 25 dni”. */
const PERIOD = String.raw`(?:[ \t]+(?:od[ \t]+(?:${EV_DATE}|\d{1,2})[ \t]+)?do[ \t]+${EV_DATE}|[ \t]+od[ \t]+${EV_DATE}(?:[ \t]+do[ \t]+${EV_DATE})?|[ \t]+przez[ \t]+\d{1,3}[ \t]+(?:dni|tygodnie|tygodni|miesiąc|miesiące|miesięcy))?`;
/** Przymiotnik rodzaju leczenia („psychiatryczne”, „odwykowym”, „logopedycznej”). */
const TREAT_ADJ = `(?:psychiatryczn|odwykow|onkologiczn|szpitaln|psychologiczn|psychoterapeutyczn|logopedyczn|neurologopedyczn|antydepresyjn|przeciwnowotworow|paliatywn|hospicyjn|dializacyjn|kardiologiczn|neurologiczn|diabetologiczn|endokrynologiczn|hematologiczn|nefrologiczn|reumatologiczn|ortopedyczn|ginekologiczn|położnicz|chirurgiczn|neurochirurgiczn|kardiochirurgiczn|internistyczn|pediatryczn|geriatryczn|okulistyczn|laryngologiczn|urologiczn|dermatologiczn|pulmonologiczn|gastroenterologiczn|detoksykacyjn|toksykologiczn|rehabilitacyjn|zakaźn|ratunkow|urazow|psychiatr)[${LO}]*`;
/** Specjalność w dopełniaczu po placówce („w klinice kardiologii”, „na oddziale intensywnej terapii”). */
const SPECIALTY_GEN = `(?:kardiologii|neurologii|psychiatrii|onkologii|ginekologii|położnictwa|chirurgii|neurochirurgii|kardiochirurgii|ortopedii|traumatologii|pediatrii|neonatologii|geriatrii|okulistyki|laryngologii|otolaryngologii|urologii|dermatologii|pulmonologii|gastroenterologii|nefrologii|hematologii|reumatologii|endokrynologii|diabetologii|toksykologii|rehabilitacji|detoksykacji|intensywnej${WS}terapii|chorób${WS}(?:wewnętrznych|zakaźnych|płuc|serca|psychicznych))(?:${WS}(?:dziecięcej|dorosłych|ogólnej|naczyniowej|klinicznej))?`;
/** Placówka opisana małą literą przez rodzaj leczenia („w poradni zdrowia psychicznego”); nazwa własna zostaje. */
const PLACE_MED = `(?:poradni|przychodni|szpitalu|klinice|ośrodku|oddziale|centrum|gabinecie)${WS}(?:zdrowia${WS}psychicznego|leczenia${WS}uzależnień|terapii${WS}uzależnie(?:ń|nia)(?:${WS}od${WS}${SUBST})?|dla${WS}osób${WS}uzależnionych|leczenia${WS}${TREAT_ADJ}|${TREAT_ADJ})`;
const DEGREE = '(?:lekk|umiarkowan|znaczn)(?:i|y|ym|ego|im)';
const DIS_STEP = `stop(?:ień|nia|niu|niem)${WS}niepełnosprawności`;
/** Symbol przyczyny niepełnosprawności z opisem w nawiasie („symbol 05-R (choroby narządu ruchu)”). */
const DIS_SYMBOL = String.raw`(?:,?${WS}symbol(?:em)?${WS}(?:przyczyny${WS}niepełnosprawności${WS})?\d{2}-[A-Z](?:${WS}\([^()\n]{1,60}\))?)?`;
const SELF_CARE = `samodzie[l1]n(?:ej|ego)${WS}egzystencji`;
const INCAPACITY = `niezdolności${WS}do${WS}(?:pracy(?:${WS}i${WS}${SELF_CARE})?|${SELF_CARE})`;
/**
 * Wyraz medyczny sam z siebie: dziedzina, narząd, urządzenie wszczepiane („kolana”, „kardiochirurgicznym”,
 * „tarczycy”, „rozrusznika”). Narządy wewnętrzne poza ANATOMY: macica, jajniki, pierś, prostata, zastawka…
 */
const MED_STEM =
  'chirurg|kardio|ortoped|okulist|laryngolog|ginekolog|urolog|onkolog|operacyjn|endoskop|laparoskop|artroskop|medyczn|' +
  'bajpas|by-pass|stawu|stawów|zaćm|przepuklin|wyrostk|migdał|pęcherzyk|tarczyc|serca|kręgosłup|kolan|biodr|żylak|' +
  'endoprotez|bariatryczn|transplant|naczyni|kardiolog|neurolog';
/** Narząd albo urządzenie jako cały wyraz od początku („macicy”, „rozrusznika”, „zastawki”); bez wnętrza słowa. */
const ORGAN =
  'macic|jajnik|piersi|sutk|prostat|zastawk|nerk|nerek|wątrob|płuc|trzustk|żołąd|jelit|śledzion|rozrusznik|stent|kardiowerter|' +
  'defibrylator|implant|soczewk|rogówk|szpik|guz(?:a|ów|em|y)?(?![a-ząćęłńóśźż])|torbiel|mięśniak|łąkotk|więzad|ścięgn|zęb|' +
  'ósem|nowotw|tętnic|aort|krtani|przełyk|odbytnic|okrężnic|pęcherz|moczowod|oskrzel|ślinian|czaszk|mózg|rdzeni|oczu|uszu';
/**
 * Rzeczownik czynności („usunięcia”, „przeszczepu”, „wszczepienia”, „wymiany”, „resekcji”, „amputacji”)
 * jest medyczny dopiero z narządem albo częścią ciała po nim: „usunięcia drzew”, „wymiany okien”
 * i „przeszczepu drzewek” zostają.
 */
const MED_ACTION = '(?:usunięci|przeszczep|wszczepieni|wymian|resekcj|amputacj|rekonstrukcj|zespoleni|nastawieni|odbarczeni|stabilizacj)';
const MED_WORD = `(?:${SIDE}(?:${ANATOMY})(?![${LETTER}])${TECH_AFTER}|[${LO}]*(?:${MED_STEM})[${LO}]*|(?<![${LETTER}])(?:${ORGAN})[${LO}]*)`;
const MED_FIRST = `(?:${MED_WORD}|${MED_ACTION}[${LO}]{0,4}${WS}(?:(?:lew|praw)(?:ej|ego|ych)${WS})?${MED_WORD})`;
/** Dalsze wyrazy dopowiedzenia w dopełniaczu albo miejscowniku („usunięcia pęcherzyka żółciowego”). */
const OBJ_STOP_EV = '(?:i|oraz|a|ale|lecz|lub|albo|od|przez|w|we|z|ze|po|do|na|u|dla|co|jak|już|się|nie|bo|więc|ponieważ|według|mimo|przy|dnia)';
const MED_MORE = `(?:${WS}(?!${OBJ_STOP_EV}(?![${LETTER}]))[${LO}]{2,}(?:a|y|ego|ej|ych|ich|u|ów|i|ym|im))${'{0,3}'}`;
/**
 * Nazwa zabiegu medycznego sama z siebie, rozpoznawana po budowie słowa: -ektomia („mastektomię”,
 * „histerektomii”, „cholecystektomii”), -skopia narządu („kolonoskopię”, „artroskopii”), -grafia
 * i -plastyka naczyń serca („koronarografii”, „angioplastyki”), -tomia narządu („tracheotomii”),
 * a także przeszczep, amputacja, wszczepienie i usunięcie z narządem, poronienie, cesarskie cięcie.
 */
const PROC = `(?:[${LO}]{2,}ektomi[${LO}]{0,3}|(?:kolono|gastro|artro|laparo|broncho|bronchofiberoskop|cysto|histero|kolpo|rekto|ezofago|duodeno|torako|kapsulko)skopi[${LO}]{0,3}|(?:koronaro|angio|cholangio|urografi|scyntygrafi)(?:grafi|plastyk)?[${LO}]{0,3}|koronaroplastyk[${LO}]{0,3}|(?:tracheo|krani|laparo|torako)tomi[${LO}]{0,3}|transplantacj[${LO}]{0,3}(?:${WS}${MED_WORD})?|${MED_ACTION}[${LO}]{0,4}${WS}(?:(?:lew|praw)(?:ej|ego|ych)${WS})?${MED_WORD}|poronieni[${LO}]{0,2}|poro(?:dzie|du|dem)(?:${WS}(?:przedwczesn|bliźniacz|zabiegow|naturaln|cesarsk)[${LO}]*)?|łyżeczkowani[${LO}]{0,2}(?:${WS}jamy${WS}macicy)?|przerwani[${LO}]{0,2}${WS}ciąży|biopsj[${LO}]{0,2}(?:${WS}${MED_WORD})?|chemioterapi[${LO}]{0,2}|radioterapi[${LO}]{0,2}|cięci(?:u|a|em)${WS}cesarski(?:m|ego)|cesarski(?:m|ego)${WS}cięci(?:u|a|em))`;

/**
 * Zdanie normatywne: przepis, regulamin, pouczenie. Te słowa nie stoją w opisie faktu o osobie,
 * więc rozstrzygają w całym zdaniu.
 */
const RE_NORMATIVE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:należy|trzeba|powin(?:ien|na|no|ni|ny)|ma[ \\t]+prawo|mają[ \\t]+prawo|przysługuj${L}|zachowuj${L}|obowiązan${L}|obowiąz(?:ek|ku)|wlicza${L}|art\\.|artykuł${L}|ustaw(?:a|y|ie|ę|ą|om|ach)|kodeks${L}|rozporządzeni${L}|regulamin${L}|statut${L}|zgodnie[ \\t]+z[ \\t]+(?:celem|przeznaczeniem|przepisami|zasadami|procedur${L}|wytycznymi))(?![${LETTER}])|§|Dz\\.[ \\t]?U\\.|k\\.p\\.`,
  'i',
);
/**
 * Słowa reguły, które stoją też w zwykłej narracji („nie może pracować”, „wymaga opieki”, „o każdej porze”, „każdego
 * dnia”). Rozstrzygają tylko przed frazą („Pracownik może skorzystać ze zwolnienia”) albo zaraz po
 * niej w tym samym członie („Zwolnienie pracownika może być kontrolowane”); po spójniku zaczyna się
 * nowe orzeczenie o tej samej osobie („przebywa na zwolnieniu i nie może pracować”).
 */
const RE_NORMATIVE_WEAK = new RegExp(`${NOT_LETTER_BEFORE}(?:może|mogą|można|wymagan${L}|wymaga|każd${L}(?![ \\t]+(?:dnia|dzień|roku|tygodnia|miesiąca|razem|razie|wieczór|rano|nocy|porze|porę|godzinie|chwili|chwilę))|wszys(?:cy|tkie|tkich))(?![${LETTER}])`, 'i');
const RE_COORD = new RegExp(`(?:[,;:–]|${NOT_LETTER_BEFORE}(?:i|oraz|a|ale|lecz|więc|dlatego|ponieważ|bo|gdyż|zatem|przez[ \\t]+co)(?![${LETTER}]))`, 'i');
function weakNormative(sentence: string, from: number, to: number): boolean {
  if (mtest(RE_NORMATIVE_WEAK, sentence.slice(0, from))) return true;
  const after = sentence.slice(to);
  const w = RE_NORMATIVE_WEAK.exec(after);
  return !!w && !mtest(RE_COORD, after.slice(0, w.index));
}
/** Warunek i reguła („jeżeli”, „w przypadku”, „kto”): bez osoby wskazanej z nazwy mowa o każdym. */
const RE_IF = new RegExp(`${NOT_LETTER_BEFORE}(?:jeżeli|jeśli|gdyby|o[ \\t]+ile|kto|w[ \\t]+razie|w[ \\t]+przypadku)${NOT_LETTER_AFTER}`, 'i');
/**
 * Osoba wskazana w zdaniu wprost: zakryty PESEL albo data urodzenia i pozycja wykazu osób („poz. 3:”
 * na początku wiersza). Osoba z nazwy („Pan Nowak”, imię i nazwisko) i pierwsza osoba autora pisma
 * liczą się tylko w zdaniu podrzędnym z frazą i nie w roli urzędnika (patrz patientNamed i firstPerson).
 * Maska osoby ([IMIĘ I NAZWISKO]) nie jest kotwicą: przebieg zdrowia idzie przed osobami, więc przy
 * ponownej redakcji wyniku dawałaby kotwicę, której pierwszy przebieg nie miał (idempotencja).
 */
const RE_NAMED = /\[(?:PESEL|DATA-URODZENIA)\]/;
/**
 * Pierwsza osoba jako osoba, której dotyczy zdarzenie: czasownik w czasie przeszłym („byłem”,
 * „trafiłam”) albo „u mnie”. „Mam przyjemność”, „Mam wątpliwość co do”, „Jestem lekarzem” i „mój raport”
 * to autor pisma w innej roli; „mam”, „jestem na” tuż przed frazą łapie selfFrame, a „mój”, „moja”
 * tylko tuż przed frazą („mojego zwolnienia lekarskiego”, „moja ciąża”).
 */
const RE_FIRST_PERSON = new RegExp(`${NOT_LETTER_BEFORE}(?:u[ \\t]+mnie|ja|${FIRST_PAST})${NOT_LETTER_AFTER}`, 'i');
const RE_MY_BEFORE = new RegExp(`${NOT_LETTER_BEFORE}(?:mój|moja|moje|mojego|mojej|mojemu|moim|moją|mego|mej)[ \\t]{1,4}$`, 'i');
/**
 * Pozycja wykazu osób: „poz. 4:” na początku wiersza (lista nieobecności, lista płac). Pozycja w środku
 * zdania to przepis („Dz. U. z 2024 r., poz. 146”), tabela albo pakiet przetargu („Pakiet 2, poz. 3:”),
 * a pozycja z ilością albo kwotą („40 sztuk”, „1200 zł”) to wiersz zestawienia, a nie osoba.
 */
const RE_LIST_POS = /^[ \t]*(?:[-•*][ \t]*)?poz\.[ \t]*\d{1,3}(?!\d)[ \t]*[:)]/i;
const RE_QUANTITY = new RegExp(`${NOT_LETTER_BEFORE}(?:szt\\.|sztuk${L}|zł|PLN|kwot${L}|cen${L}|netto|brutto|opakowa${L}|kpl\\.|komplet${L})(?![${LETTER}])`, 'i');
const namedIn = (sentence: string): boolean =>
  mtest(RE_NAMED, sentence) || (mtest(RE_LIST_POS, sentence) && !mtest(RE_QUANTITY, sentence));
/**
 * Czasownik osoby tuż przed frazą („przebywa na zwolnieniu lekarskim”, „ma orzeczenie”, „dostarczył L4”,
 * „jestem na dializach”): podmiot w liczbie pojedynczej, więc fraza mówi o konkretnej osobie.
 * Imiesłów („przebywający na zwolnieniu”) opisuje każdego, kogo to dotyczy, więc nie jest tu formą osoby.
 */
const RE_SELF_FRAME = new RegExp(
  `${NOT_LETTER_BEFORE}(?:(?:przebyw(?:a|am|ał|ała|ałem|ałam)|jest|jestem|był|była|byłem|byłam)[ \\t]{1,4}(?:na|po|w)|przebyw(?:a|am|ał|ała|ałem|ałam)|(?:ma|mam|miał|miała)(?:[ \\t]{1,4}(?:zaplanowan|wyznaczon|stwierdzon|rozpoznan|przyznan|orzeczon|wystawion|zalecon)[${LO}]{1,3})?|posiada|dostarczył(?:a|em|am)?|przedstawił(?:a|em|am)?|otrzymał(?:a|em|am)?|legitymuj(?:e|ę)[ \\t]+się)[ \\t]{1,4}$`,
);
const selfFrame = (whole: string, offset: number): boolean => mtest(RE_SELF_FRAME, whole.slice(Math.max(0, offset - 40), offset));
/**
 * Osoba wskazana słabiej: rola, krewny. Wystarcza tylko w zdaniu, które nie jest normatywne.
 * „Strona” to też strona internetowa i strona dokumentu („na stronie internetowej”, „na stronie 4”,
 * „Strona internetowa szpitala”), a „z drugiej strony” to zwrot, więc te układy osobą nie są.
 */
const RE_EV_PERSON = new RegExp(
  `${NOT_LETTER_BEFORE}(?:${[
    `(?<!(?:na|ze|z|po|drugiej|jednej|tej|każdej|głównej|pierwszej|ostatniej)[ \\t]{1,4})stron(?:a|y|ie|ę|ą)(?![ \\t]*(?:\\d|internetow|www|główn|tytułow|BIP|portal|serwis|dokumentu|pisma|formularza|wniosku|umowy|nr(?![${LETTER}])))`,
    'ucz(?:eń|nia|niowi|niem|ennica|ennicy|ennicę|ennicą)',
    'stażyst(?:a|ka|ki|ce|kę|ką)',
    'radn(?:a|y|ej|ego|emu)',
    'nauczyciel(?:ka|ki|ce|kę|ką)?',
    'klient(?:ka|ki|ce|kę|ką)?',
    'podopieczn(?:y|a|ego|ej|emu|ą)',
    'świadczeniobiorc[a-ząćęłńóśźż]*',
    'uczestni(?:k|ka|kowi|czka|czki|czce)',
    'chłop(?:iec|ca|cu)',
    'dziewczyn(?:ka|ki|ce|kę|ką)',
    'matkę|ojczym(?:a)?|macoch[a-ząćęłńóśźż]*|konkubent(?:a|ka|ki)?|babci(?:a|ę|ą)?|dziad(?:ek|ka|kowi)',
    'brat(?:a|u)?|siostr(?:a|y|ze|ę|ą)|wnu(?:k|ka|czka|czki)|teś(?:ć|cia|ciowa|ciowej)',
  ].join('|')})${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Zaimek osobowy jako kotwica tylko w tym samym członie zdania co fraza: „On zwrócił uwagę, że
 * psychoterapia dla dzieci jest trudno dostępna” mówi o temacie, a nie o nim. Samo dzierżawcze
 * „jego”, „jej” przed rzeczownikiem osoby („jego zastępca”) wskazuje tę drugą osobę, a nie pacjenta.
 */
const RE_EV_PRONOUN = new RegExp(
  `${NOT_LETTER_BEFORE}(?:on|ona|niego|niej|ją|go|jego|u[ \\t]+niego|u[ \\t]+niej)(?![${LETTER}])(?![ \\t]+(?:zastęp|dyrektor|kierowni|przełożon|pełnomocni|obrońc|asystent|sekretar|pracowni|szef|prezes|zdani|opini|ocen)${L})`,
  'i',
);
/** Granica członu: przecinek, średnik, dwukropek albo „że”, „iż”, „który” zaczynające zdanie podrzędne. */
const RE_CLAUSE_BREAK = new RegExp(`[;(]|[,:](?!\\d)|${NOT_LETTER_BEFORE}(?:że|iż|któr${L}|gdy|kiedy|ponieważ|bo)(?![${LETTER}])`, 'gi');
/** Człon zdania z frazą: od ostatniej granicy przed frazą do pierwszej granicy po niej. */
function clauseAt(sentence: string, from: number, to: number): { head: string; clause: string; tail: string } {
  const [a, b] = boundsAt(sentence, from, to, RE_CLAUSE_BREAK);
  const rest = sentence.slice(to, b);
  const coord = RE_COORD.exec(rest);
  return { head: sentence.slice(a, from), clause: `${sentence.slice(a, from)} ${rest}`, tail: coord ? rest.slice(0, coord.index) : rest };
}
/**
 * Orzeczenie w liczbie mnogiej w członie z frazą, przed nią albo zaraz po niej („Pracownicy obsługują e-ZLA”, „Rodzice
 * korzystają z…”, „Pracownicy przebywający na zwolnieniu otrzymują…”): podmiot zbiorowy, a nie konkretna osoba.
 */
const RE_PLURAL_VERB = new RegExp(`${NOT_LETTER_BEFORE}(?:[${LO}]{2,}(?:ują|ają|eją|iją)|są|mają|mogą|chcą|biorą|idą|piszą|muszą)(?![${LETTER}])`, 'i');

/* ── Rola osoby przy zdarzeniu: pacjent, urzędnik albo świadczeniodawca ── */

/**
 * Granica zdania podrzędnego: „że”, „iż”, „który”, „gdy”, średnik, dwukropek. Przecinek i nawias nie,
 * bo wtrącenie („Pan Nowak, magazynier, przebywa…”) nie zmienia podmiotu, a „Pani Nowak, kierownik
 * działu kadr, przypomina, że zwolnienie lekarskie należy…” ma osobę w innym zdaniu niż fraza.
 */
const RE_SUB_BREAK = new RegExp(`;|:(?!\\d)|${NOT_LETTER_BEFORE}(?:że|iż|czy|ile|dlaczego|któr${L}|gdy|kiedy|ponieważ|bo|aby|żeby|jeżeli|jeśli)(?![${LETTER}])`, 'gi');
/** Granice [a, b) członu z frazą: od ostatniej granicy przed frazą do pierwszej granicy po niej. */
function boundsAt(sentence: string, from: number, to: number, re: RegExp): [number, number] {
  const br = re === RE_CLAUSE_BREAK ? clauseBreaks(sentence) : re === RE_SUB_BREAK ? subBreaks(sentence) : breaksOf(re, sentence);
  let a = 0;
  let k = 0;
  for (; k < br.length && br[k] < from; k += 2) a = br[k + 1];
  // szukanie od „to” daje pierwszą granicę z listy od tego miejsca: granica to jeden znak albo całe słowo
  // z literą przed nim zabronioną, więc żadna nie zaczyna się wewnątrz innej
  while (k < br.length && br[k] < to) k += 2;
  return [a, k < br.length ? br[k] : sentence.length];
}
/** Wszystkie granice członu w zdaniu jako pary [początek, koniec] (płaska tablica, tylko do odczytu). */
function breaksOf(re: RegExp, sentence: string): number[] {
  const out: number[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) out.push(m.index, m.index + m[0].length);
  return out;
}
const clauseBreaks = memo((s: string) => breaksOf(RE_CLAUSE_BREAK, s));
const subBreaks = memo((s: string) => breaksOf(RE_SUB_BREAK, s));
/**
 * Funkcja w wtrąceniu po nazwisku („Pan Nowak, wójt gminy,”, „Pani Kowalska, logopeda,”, „Pan Nowak,
 * konserwator,”): osoba występuje w roli urzędnika, świadczeniodawcy albo pracownika, a nie pacjenta.
 */
const FUNCTION_WORD = `(?:kierowni|inspektor|wójt|burmistrz|starost|prezydent|marszał|proboszcz|ksiądz|wikar|lekar|lekark|nauczyciel|trener|instruktor|logoped|neurologoped|psycholog|terapeut|psychoterapeut|pielęgniar|położn|ordynator|dyrektor|specjalist|orzeczni|pedagog|wychowawc|kurator|asystent|pracowni(?:k|czka)[ \\t]+socjaln|sędzi|referent|urzędni|sekretarz|prezes|rzeczni|koordynator|komendant|policjant|funkcjonariusz|dzielnicow|sołty|przewodnicząc|ratowni|fizjoterapeut|opiekun(?:ka)?[ \\t]+medyczn|rezydent|konsultant|doradc|ekspert|biegł|mediator|notariusz|adwokat|radc|prokurator|komorni|kapelan|wolontariusz|student|praktykant|konserwator|elektryk|technik|serwisant|monter|hydraulik|informatyk|kierowc|kurier|dostawc|ochroniarz|sprzątacz|salow|sanitariusz|farmaceut|diagnost|laborant|dietety|sprzedaw|handlowc|przedstawiciel)${L}`;
const RE_FUNCTION_APPOS = new RegExp(`^(?:[ \\t]+[${UP}][${LO}]+(?:-[${UP}][${LO}]+)?)?[ \\t]*,[ \\t]*(?:[${LO}]+[ \\t]+)?${FUNCTION_WORD}(?![${LETTER}])`, 'i');
/** Tytuł lekarza przed nazwiskiem („Dr Anna Kowalska”, „lek. med. Jan Nowak”): lekarz, a nie pacjent. */
const RE_CLINICIAN_BEFORE = new RegExp(`(?<![${LETTER}])(?:dr|lek|prof|doc|mgr)\\.?(?:[ \\t]+(?:med|n\\.[ \\t]?med|hab)\\.?)?[ \\t]+$`, 'i');
const RE_TITLED = new RegExp(`(?<![${LETTER}])(?:[Pp]an|[Pp]ani|[Pp]anu|[Pp]anią|[Pp]ana|[Pp]anem)[ \\t]+(?!${OFFICE}(?![${LETTER}]))[${UP}][${LO}]+`, 'g');
/**
 * Osoby z nazwy w zdaniu jako przedziały [a, b): „Pan Nowak”, „pani Ewy Kos”, imię z nazwiskiem.
 * Pomija lekarza z tytułem, osobę z funkcją w wtrąceniu i imię prelegenta w zdaniu o grupie.
 */
const patientNamed = memo(function patientNamed(sentence: string): [number, number][] {
  const out: [number, number][] = [];
  const keep = (a: number, b: number): void => {
    if (mtest(RE_CLINICIAN_BEFORE, sentence.slice(Math.max(0, a - 16), a))) return;
    if (mtest(RE_FUNCTION_APPOS, sentence.slice(b, b + 60))) return;
    out.push([a, b]);
  };
  RE_TITLED.lastIndex = 0;
  for (let m = RE_TITLED.exec(sentence); m; m = RE_TITLED.exec(sentence)) keep(m.index, m.index + m[0].length);
  if (!mtest(RE_NAME_NOT_PATIENT, sentence)) {
    RE_CAP_PAIR.lastIndex = 0;
    for (let m = RE_CAP_PAIR.exec(sentence); m; m = RE_CAP_PAIR.exec(sentence)) {
      const patron = mtest(RE_PATRON_BEFORE, sentence.slice(Math.max(0, m.index - 24), m.index));
      if (!patron && (isGivenName(m[1]) || isGivenName(m[2]))) keep(m.index, m.index + m[0].length);
      RE_CAP_PAIR.lastIndex = m.index + m[1].length;
    }
  }
  return out;
});
const spanIn = (spans: [number, number][], a: number, b: number): boolean => spans.some(([x, y]) => x >= a && y <= b);
/**
 * Pierwsza osoba w zdaniu podrzędnym z frazą: czasownik przeszły albo „u mnie” w nim, albo „mój”,
 * „mojego” tuż przed frazą.
 */
function firstPersonIn(sentence: string, a: number, b: number, f: number): boolean {
  return mtest(RE_FIRST_PERSON, sentence.slice(a, f)) || mtest(RE_FIRST_PERSON, sentence.slice(f, b)) || mtest(RE_MY_BEFORE, sentence.slice(Math.max(a, f - 12), f));
}

/**
 * Osoba w roli świadczeniodawcy, fundatora albo urzędnika tuż przed frazą („zajmuje się leczeniem
 * onkologicznym”, „jest specjalistką od psychoterapii”, „ufundował pobyt w hospicjum”, „udostępnia salę
 * na mityngi AA”, „od lat wydaję orzeczenia”, „Mam doświadczenie w terapii uzależnień”): fraza nazywa
 * usługę albo przedmiot pracy, a nie zdarzenie z życia tej osoby. Odbiorca w celowniku między
 * czasownikiem a frazą („wystawił mu zwolnienie”, „przyznał Panu Nowakowi rentę”) zostaje pacjentem.
 */
const PROVIDER = `(?:zajmuj${L}|zajmował${L}|zajmie|specjalizuj${L}|specjalizował${L}|specjalist${L}|specjalizacj${L}|ekspert${L}|doświadczeni${L}|praktyk${L}|wydaj(?:e|ę|emy|ą)|wydaw${L}|wydał${L}|wyda|wystawia${L}|wystawił${L}|orzeka${L}|orzekał${L}|ufundow${L}|funduj${L}|sfinansow${L}|sfinansuj${L}|finansuj${L}|finansował${L}|dofinansow${L}|udostępni${L}|refunduj${L}|kontraktuj${L}|zakontraktow${L}|uczy|uczył${L}|wykłada${L}|szkoli${L}|prowadz${L}|prowadził${L}|oferuj${L}|zaoferow${L}|realizuj${L}|zrealizow${L}|organizuj${L}|zorganizow${L}|zapewni${L}|świadcz${L}|udziela${L}|udzielił${L}|wspiera${L}|wsparł${L}|koordynuj${L}|nadzoruj${L})`;
const RE_PROVIDER_REL = new RegExp(`${NOT_LETTER_BEFORE}${PROVIDER}((?:[ \\t]{1,4}[^ \\t,.;:!?]{1,30}){0,4})[ \\t]{1,4}$`, 'i');
const RE_DATIVE_PERSON = new RegExp(`${NOT_LETTER_BEFORE}(?:mu|jej|mi|mnie|im|jemu|niej|niemu)(?![${LETTER}])`, 'i');
const RE_TITLED_ANY = new RegExp(`(?:Pan|Pani)[ \\t]+[${UP}]`);
const RE_PROVIDER_COORD = new RegExp(`${NOT_LETTER_BEFORE}${PROVIDER}((?:[ \\t]{1,4}[^ \\t,.;:!?]{1,30}){0,6})[ \\t]{1,4}(?:i|oraz|lub|albo)[ \\t]{1,4}$`, 'i');
const providerRel = memo(function providerRel(before: string): boolean {
  const tail = before.slice(-160);
  const m = RE_PROVIDER_REL.exec(tail) ?? RE_PROVIDER_COORD.exec(tail);
  if (!m) return false;
  const gap = m[1];
  return !(mtest(RE_DATIVE_PERSON, gap) || hasPerson(gap) || mtest(RE_EV_PERSON, gap) || mtest(RE_TITLED_ANY, gap));
});
/**
 * Grupa w liczbie mnogiej tuż po frazie („pobyt w hospicjum dla samotnych mieszkańców”, „leczenie
 * onkologiczne dzieci”, „zasiłku chorobowego dla pracowników tymczasowych”, „u dorosłych”): mowa
 * o usłudze albo zasadzie dla grupy, a nie o zdarzeniu z życia konkretnej osoby.
 */
const GROUP = `(?:dzieci|dzieciom|osób|osobom|pracowników|pracownikom|pracownic|mieszkańców|mieszkańcom|mieszkanek|seniorów|seniorom|seniorek|uczniów|uczniom|uczennic|pacjentów|pacjentom|pacjentek|dorosłych|młodzieży|kobiet|mężczyzn|chorych|rodzin|podopiecznych|podopiecznym|więźniów|osadzonych|osadzonym|żołnierzy|emerytów|rencistów|ubezpieczonych|studentów|wychowanków|klientów|beneficjentów|świadczeniobiorców|ludzi|niemowląt|noworodków|nastolatków)`;
const RE_GROUP_AFTER = new RegExp(`^[ \\t]*(?:(?:dla|u|wśród|wobec)[ \\t]+)?(?:(?:\\d+|kilku|kilkunastu|kilkudziesięciu|wielu|wszystkich|[${LO}]{3,}(?:ych|ich|ym|im))[ \\t]+){0,2}${GROUP}(?![${LETTER}])`, 'i');

/* ── Podmiot zdania przy czasowniku zdarzenia ── */

const SUBJ_FILLER = new Set(
  ('i oraz a ale lecz natomiast zaś jednak więc także również też ponadto następnie potem wtedy wówczas wczoraj dziś ' +
    'dzisiaj niedawno ostatnio obecnie aktualnie nadal wciąż ponownie już jeszcze kilkukrotnie wielokrotnie dwukrotnie ' +
    'wcześniej później niestety ostatecznie dodatkowo faktycznie rzeczywiście prawdopodobnie najprawdopodobniej codziennie ' +
    'regularnie stale systematycznie zwykle zazwyczaj czasem czasami nie np. m.in. to tak r. roku stycznia lutego marca ' +
    'raz razy dwa trzy cztery pięć kilka kilkanaście parę że iż czy ile dlaczego gdy kiedy ponieważ bo aby żeby jeżeli jeśli gdyż choć chociaż ' +
    'kwietnia maja czerwca lipca sierpnia września października listopada grudnia').split(' '),
);
const SUBJ_PREP = new Set('w we od do po przed przez dnia z ze na około ok. u przy dla podczas według wg'.split(' '));
const RE_ADJ_TOKEN = new RegExp(`^[${LO}]{2,}(?:ym|im|ej|ego|ych|ich|ą)$`);
const RE_UP_TOKEN = new RegExp(`^[${UP}]`);
const RE_NAME_TOKEN = new RegExp(`^[${UP}][${LO}]+(?:-[${UP}][${LO}]+)?$`);
/** Podmiot-człowiek w mianowniku: rola, krewny, zaimek („Pozwany”, „Syn”, „ona”). */
const RE_SUBJ_ROLE =
  /^(?:pracowni(?:k|ca)|wnioskodaw(?:ca|czyni)|powód|powódka|pozwan[ya]|poszkodowan[ya]|ubezpieczon[ya]|skarżąc[ya]|uczestni(?:k|czka)|mąż|żona|ojciec|matka|syn|córka|dziecko|małoletni[a]?|pacjent(?:ka)?|chor[ya]|uczeń|uczennica|wychowan(?:ek|ka)|podopieczn[ya]|klient(?:ka)?|babcia|dziadek|brat|siostra|wnu(?:k|czka)|teś(?:ć|ciowa)|ojczym|macocha|konkubent(?:ka)?|partner(?:ka)?|senior(?:ka)?|emeryt(?:ka)?|rencist(?:a|ka)|osadzon[ya]|skazan[ya]|oskarżon[ya]|podejrzan[ya]|chłopiec|dziewczynka|dziewczyna|noworodek|niemowlę|mężczyzna|kobieta|on|ona|ja|świadczeniobiorc[aą]|stażyst(?:a|ka)|nauczyciel(?:ka)?|radn[ya]|interesant(?:ka)?|petent(?:ka)?|mieszka(?:niec|nka)|beneficjent(?:ka)?|opiekun(?:ka)?|kierowca|sprawca|ofiara|świadek|lokator(?:ka)?|najemca|ubezpieczając[ya]|zmarł[ya]|zainteresowan[ya]|niepełnosprawn[ya]|strona|jego|jej|mój|moja|moje)$/i;
const RE_OFFICE_TOKEN = new RegExp(`^${OFFICE}$`);
function personStart(tok: string[], i: number): boolean {
  const w = tok[i];
  if (/^\[(?:PESEL|DATA-URODZENIA)\]$/.test(w)) return true;
  if (/^(?:Pan|Pani)$/.test(w)) return i + 1 < tok.length && mtest(RE_UP_TOKEN, tok[i + 1]) && !mtest(RE_OFFICE_TOKEN, tok[i + 1]);
  if (mtest(RE_UP_TOKEN, w) && isGivenName(w)) return true;
  return mtest(RE_SUBJ_ROLE, w);
}
type SubjectKind = 'person' | 'none' | 'verb' | 'name' | 'other';
/**
 * Kto jest podmiotem przed czasownikiem: człowiek z roli, krewnego, zaimka albo imienia („person”),
 * brak podmiotu w zdaniu, czyli podmiot domyślny z poprzedniego zdania („none”; „verb”, gdy przed frazą
 * stoi czasownik albo inny wyraz małą literą: „że „pije za dużo” i dwa razy trafił”), samo nazwisko
 * („name”: jeden albo dwa wyrazy z wielkiej litery) albo rzecz, instytucja, miejsce („other”:
 * „Hurtownia przyjmuje”, „a szpital stosuje”, „Teczka Pana Nowaka leży”, „Pomnikowy dąb jest”).
 * Przysłówki, spójniki, daty i przyimek z dopełnieniem („Od roku”, „W dniu 3 marca 2025 r.”,
 * „Na tym oddziale”) nie są podmiotem.
 */
const subjectKind = memo(function subjectKind(region: string): SubjectKind {
  const tok = region.match(/\[[^\]\n]{1,30}\]|[^\s,;:„”"()–]+/g) ?? [];
  let i = 0;
  while (i < tok.length) {
    const w = tok[i];
    const lw = w.toLowerCase();
    if (SUBJ_FILLER.has(lw) || /^[\d./-]+$/.test(w)) {
      i++;
      continue;
    }
    if (SUBJ_PREP.has(lw)) {
      i++;
      while (i < tok.length && (mtest(RE_ADJ_TOKEN, tok[i]) || /^(?:tym|tej|tę|ten|tamtym|[\d./-]+)$/i.test(tok[i]))) i++;
      if (i < tok.length && !personStart(tok, i)) i++;
      continue;
    }
    if (personStart(tok, i)) return 'person';
    if (!mtest(RE_UP_TOKEN, w) && !(i > 0 && /^(?:a|zaś|natomiast)$/i.test(tok[i - 1]))) return 'verb';
    let k = i;
    while (k < tok.length && k - i < 2 && mtest(RE_NAME_TOKEN, tok[k]) && !/^pan/i.test(tok[k])) k++;
    if (k > i && (k === tok.length || !mtest(RE_UP_TOKEN, tok[k]))) return 'name';
    return 'other';
  }
  return 'none';
});
/**
 * Podmiot czasownika zdarzenia: najpierw człon z frazą (po przecinku zaczyna się nowe orzeczenie,
 * „a szpital stosuje”), a gdy człon nie ma podmiotu, początek zdania podrzędnego („Pan Nowak,
 * konserwator, przebywał…”). verbTail zdejmuje z końca czasownik zdarzenia („przebywał w”, „był”).
 */
function eventSubject(text: string, starts: number[], from: number, to: number, verbTail?: RegExp): SubjectKind {
  const sentence = sentenceAt(text, starts, from, to);
  const s0 = Math.max(starts[sentenceIndex(starts, from)], from - SPAN);
  const f = from - s0;
  const t = to - s0;
  const strip = (s: string): string => (verbTail ? s.replace(verbTail, '') : s);
  const [ca] = boundsAt(sentence, f, t, RE_CLAUSE_BREAK);
  const near = subjectKind(strip(sentence.slice(ca, f)));
  if (near !== 'none' && near !== 'verb') return near;
  const [sa] = boundsAt(sentence, f, t, RE_SUB_BREAK);
  if (sa >= ca) return near;
  const far = subjectKind(sentence.slice(sa, ca));
  return far === 'person' || far === 'name' ? far : near;
}

interface HealthEvent {
  re: RegExp;
  /** Czasownik osobowy w liczbie pojedynczej („leczy się”, „przebywa na zwolnieniu”) wskazuje osobę sam. */
  self?: boolean;
  /** Dodatkowy warunek odrzucenia (wyliczenie stopni, tytuł dokumentu, personel szpitala). */
  reject?: (whole: string, offset: number, m: string, starts: number[]) => boolean;
  /** Fraza tylko obok innej zakrytej danej o zdrowiu w tym samym zdaniu („ciążę prowadzi lekarz”). */
  afterMask?: boolean;
  /**
   * Podmiotem czasownika musi być człowiek („trafił do szpitala”, „był operowany”): pismo, przesyłka
   * i delegacja też „trafiają do szpitala”, a pobyt „jako kapelan” albo „z wizytą” to praca, nie leczenie.
   */
  subject?: boolean;
  /** Zdarzenie zapisane po angielsku: kotwicą jest osoba w zdaniu angielskim (patrz enAnchor). */
  en?: boolean;
}
const ev = (src: string, opts: Omit<HealthEvent, 're'> = {}): HealthEvent => ({
  re: new RegExp(`${NOT_LETTER_BEFORE}(?:${src})${NOT_LETTER_AFTER}`, 'g'),
  ...opts,
});
const RE_DEGREE_LIST_BEFORE = new RegExp(`${DEGREE}[ \\t]*(?:lub|albo|i|oraz|,|/)[ \\t]*$`);
const RE_DEGREE_LIST_AFTER = new RegExp(`^[ \\t]*(?:lub|albo|i|oraz|,|/)[ \\t]*${DEGREE}`);
const degreeList = (whole: string, offset: number, m: string): boolean =>
  mtest(RE_DEGREE_LIST_BEFORE, whole.slice(Math.max(0, offset - 30), offset)) || mtest(RE_DEGREE_LIST_AFTER, whole.slice(offset + m.length, offset + m.length + 30));
/** Tytuł dokumentu („karta informacyjna leczenia szpitalnego”) i kształcenie terapeutów („szkoła psychoterapii”). */
const RE_TITLE_BEFORE = new RegExp(`(?:informacyjn${L}|szkoł${L}|kurs${L}|szkoleni${L}|studi${L}|certyfikat${L}|dyplom${L}|ofert${L}|program${L}|zakres${L}|koszt${L}|finansowani${L}|refundacj${L})(?:[ \\t]+(?:z|ze|w[ \\t]+zakresie))?[ \\t]+$`, 'i');
const titleBefore = (whole: string, offset: number): boolean => mtest(RE_TITLE_BEFORE, whole.slice(Math.max(0, offset - 40), offset));
/** Terapię prowadzi terapeuta, logopeda, poradnia („prowadzi terapię logopedyczną”): to usługa, a nie leczenie osoby. */
const RE_PROVIDER_BEFORE = new RegExp(`(?:prowadz${L}|prowadził${L}|oferuj${L}|realizuj${L}|organizuj${L}|zapewnia${L}|świadcz${L}|udziela${L})[ \\t]+(?:[${LO}]+[ \\t]+){0,2}$`, 'i');
const providerBefore = (whole: string, offset: number): boolean => mtest(RE_PROVIDER_BEFORE, whole.slice(Math.max(0, offset - 40), offset));
const staffBefore = (whole: string, offset: number, _m: string, starts: number[]): boolean =>
  mtest(RE_HOSPITAL_STAFF, sentenceHead(whole, starts, offset));
/** Placówka tuż przed frazą („poradni leczenia uzależnień”, „ośrodka terapii”): nazwa placówki, a nie leczenie osoby. */
const RE_PLACE_BEFORE = new RegExp(`${NOT_LETTER_BEFORE}(?:poradni${L}|przychodni${L}|ośrod(?:ek|ka|ku|kiem|ków|kach)|oddzia(?:ł|łu|le|łem|łów)|centr(?:um|ów|ach)|gabinet${L}|zakład${L}|klinik${L}|placów(?:ka|ki|ce|kę|ek)|specjalist${L}|terapeut${L})[ \\t]+$`, 'i');
const placeBefore = (whole: string, offset: number): boolean => mtest(RE_PLACE_BEFORE, whole.slice(Math.max(0, offset - 30), offset));

/**
 * Temat pisma albo procedury tuż przed frazą: zasady, wnioski, informacje, druk, system, rozliczenie,
 * wypłata, pytanie, kolejka, dostęp, szkolenie, wykaz („zasady wypłaty zasiłku chorobowego”, „druk
 * zwolnienia lekarskiego”, „pytanie o urlop dla poratowania zdrowia”, „kolejki do psychoterapii”,
 * „Spotkanie dotyczyło zwolnień lekarskich”, „zasiłek za okres pobytu w szpitalu”). Wtedy fraza nazywa sprawę, a nie zdarzenie z życia osoby.
 * Między tematem a frazą mogą stać dwa wyrazy („z zakresu opieki po operacji”), ale nie zaimek ani
 * rola osoby („dotyczy jego zwolnienia”), bo wtedy sprawa jest już czyjaś.
 */
const PERSON_WORD = `(?:jego|jej|ich|mojego|mojej|mego|mej|swojego|swojej|swego|pana|pani|syna|córki|męża|żony|ojca|matki|dziecka|pracownika|pracownicy|wnioskodawcy|wnioskodawczyni|ucznia|uczennicy|małoletni${L}|ubezpieczon${L}|pozwan${L}|powoda|powódki|skarżąc${L})`;
const RE_TOPIC_BEFORE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:zasad${L}|pytani(?:e|a|em|u)(?:[ \\t]+o)?|zapyta${L}[ \\t]+o|kolejk${L}(?:[ \\t]+(?:do|na))?|dostęp(?:u|em)?[ \\t]+do|dostępnoś${L}|informacj${L}(?:[ \\t]+(?:o|na[ \\t]+temat|dotycząc${L}))?|informuj${L}[ \\t]+o|druk${L}|formularz${L}|wzor(?:u|em|y|ów)|wzór|system${L}|rozliczeni${L}|rozlicza${L}|wypłat${L}|wypłaca${L}|przyznawani${L}|przyznani${L}|udzielani${L}|wystawiani${L}|kwesti${L}|dotycząc${L}|dotycz(?:y|ą|ył|yła|yło|yły)|temat${L}|z[ \\t]+zakresu|w[ \\t]+zakresie|wnios(?:ki|ków|kami|kach)[ \\t]+o|odwołani(?:a|ach|om)[ \\t]+od|liczb${L}|statystyk${L}|kosztów|koszt(?:y|u)?|finansowani${L}|refundacj${L}|organizacj${L}|obsług${L}|obsługuj${L}|ewidencj${L}|rejestr${L}|opisano|opis(?:u|ie)?|zestawieni${L}|wykaz${L}|procedur${L}|wykorzystywani${L}|wykorzystani${L}|kontrol(?:a|i|ę|ą)|o[ \\t]+zasadach|za[ \\t]+(?:okres|czas)|w[ \\t]+sprawie|co[ \\t]+do|na[ \\t]+temat|omawia${L}|omówi${L}|omówił${L}|dyskutow${L}|przedyskutow${L}|rozmawia${L}[ \\t]+o|analizow${L}|przeanalizow${L}|opracow${L}|referow${L}|prezentow${L}|zaprezentow${L}|raport${L}(?:[ \\t]+o)?|sprawozdani${L}|analiz${L}|wskaźnik${L}|brak(?:u|iem)?|zajęci(?:a|ach|om)[ \\t]+z)` +
    `(?:[ \\t]+(?!${PERSON_WORD}(?![${LETTER}]))(?:[${LO}]{3,}|z|ze|w|we|o|na|do|u|po)){0,3}[ \\t]+$`,
  'i',
);
/** Osoba zaraz po frazie w dopełniaczu („zasiłku chorobowego Pana Nowaka”, „zwolnienia lekarskiego pracownika”). */
const RE_OWNER_AFTER = new RegExp(`^[ \\t]*(?:(?:Pana|Pani|pana|pani)[ \\t]+[${UP}]|[${UP}][${LO}]+[ \\t]+[${UP}][${LO}]+|${PERSON_WORD}(?![${LETTER}]))`);
function topicBefore(whole: string, offset: number, m: string): boolean {
  if (!mtest(RE_TOPIC_BEFORE, whole.slice(Math.max(0, offset - 70), offset))) return false;
  return !mtest(RE_OWNER_AFTER, whole.slice(offset + m.length, offset + m.length + 40));
}

/**
 * Podmiot rzeczowy na początku członu („Pismo pana Nowaka trafiło do szpitala”, „Przesyłka trafiła…”,
 * „Delegacja radnych przebywała w szpitalu”): pismo, rzecz, grupa albo instytucja, a nie pacjent.
 */
const RE_THING_SUBJECT = new RegExp(
  `^[ \\t"„(]*(?:(?:wczoraj|dziś|dzisiaj|następnie|potem|ponadto|również|także|natomiast|jednak|ostatecznie|niezwłocznie)[ \\t]+)?(?:pism|przesyłk|paczk|list(?:y|u)?(?![${LETTER}])|wnios(?:ek|ku|kiem|ki|ków|kami)(?![${LETTER}])|skarg|zgłoszeni|dokument|korespondencj|faktur|decyzj|spraw(?:a|y)(?![${LETTER}])|dostaw|transport|sprzęt|aparat|urządzeni|karetk|delegacj|komisj|kontrol|ekip|grup|zesp[oó]ł|zamówieni|darowizn|dotacj|środk|pieniądz|informacj|odpowied|zawiadomieni|wezwani|zapytani|towar|lek(?:i|ów)?(?![${LETTER}])|szczepionk|próbk|materiał|odpad|pojazd|samochód|autobus|wycieczk|zbiórk|kwot|wizytacj|kurier|personel|zarząd|chorob|schorzeni|nowotw|depresj|zaburzeni|infekcj|problem|usterk|awari|błąd|błęd|maszyn|dźwig|system|sieć|sieci|metod|urząd|urzęd|placówk|gmin|spółk|firm|instytucj)${L}(?![${LETTER}])`,
  'i',
);
/** Cel pobytu po miejscu: praca albo wizyta („jako kapelan”, „z wizytą”, „na spotkaniu”, „w celu kontroli”). */
const RE_STAY_PURPOSE = new RegExp(
  `^[^.;!?\\n]{0,40}?${NOT_LETTER_BEFORE}(?:jako|z[ \\t]+wizyt${L}|służbowo|w[ \\t]+celu|w[ \\t]+ramach|na[ \\t]+(?:spotkani${L}|kontroli|szkoleniu|dyżurze|zebraniu|naradzie|wizytacji|konferencji|posiedzeniu|praktyce|stażu|delegacji))(?![${LETTER}])`,
  'i',
);
function thingSubject(whole: string, offset: number, m: string, starts: number[]): boolean {
  const sentence = sentenceAt(whole, starts, offset, offset + m.length);
  const s0 = Math.max(starts[sentenceIndex(starts, offset)], offset - SPAN);
  const { head } = clauseAt(sentence, offset - s0, offset - s0 + m.length);
  return mtest(RE_THING_SUBJECT, head) || mtest(RE_STAY_PURPOSE, whole.slice(offset + m.length, offset + m.length + 60));
}
/** Pytanie formularza („Czy dziecko posiada orzeczenie? TAK / NIE”): treść druku, a nie fakt o osobie. */
const RE_QUESTION = /^[ \t"„(]*(?:\d{1,2}[.)][ \t]*)?czy(?![a-ząćęłńóśźż])[^?\n]*\?/i;

const STAY_VERB = `(?:[pP]rzebywa(?:m|sz|ją|ł|ła|łem|łam|li|ły|jąc[${LO}]{0,3})?|[lL]eży|[lL]eżał[${LO}]{0,3}|[tT]rafiał[${LO}]{0,3}|[tT]rafia|[tT]rafił[${LO}]{0,3}|[tT]rafi|[pP]ozostaje|[pP]ozostawał[${LO}]{0,3}|[sS]kierowan(?:y|a)|[zZ]głosił[${LO}]{0,3}[ \\t]{1,4}się|[pP]rzyjęt[${LO}]{1,3}|[uU]mieszczon[${LO}]{1,3}|[hH]ospitalizowan[${LO}]{1,3}|[oO]dwiezion[${LO}]{1,3}|[pP]rzewiezion[${LO}]{1,3})`;
const STAY_PLACE = `(?:szpital(?:u|a)?|klini(?:ka|ki|kę|ce)(?:${WS}${SPECIALTY_GEN})?|hospicjum|sanatorium|uzdrowisku|izb(?:y|ie|ę)${WS}(?:wytrzeźwień|przyjęć)|oddzia(?:ł|łu|le)${WS}(?:${TREAT_ADJ}|${SPECIALTY_GEN})|OIOM(?:-ie|-u)?|detoks(?:ie|u)?|odwyk(?:u)?|turnus(?:ie|u)?${WS}rehabilitacyjn(?:ym|ego|y)|zakład(?:zie|u)?${WS}(?:opiekuńczo-|pielęgnacyjno-)?(?:lecznicz|opiekuńcz)(?:ym|ego|y)(?:${WS}dla${WS}osób${WS}uzależnionych(?:${WS}od${WS}${SUBST})?)?|ośrod(?:ek|ka|ku)${WS}(?:(?:leczenia|terapii)${WS}uzależnie(?:ń|nia)|(?:odwykow|detoksykacyjn|terapeutyczn|rehabilitacyjn)[${LO}]*))(?:${WS}(?:psychiatryczn|neurologiczn|onkologiczn|uzdrowiskow|rehabilitacyjn|zakaźn|dziecięc|odwykow|domow|stacjonarn|dzienn|całodobow|zamknięt|specjalistyczn|kliniczn|wojewódzk|powiatow|miejsk|uniwersyteck|regionaln|rejonow|ogóln|wielospecjalistyczn)[${LO}]*)?`;

/** Leczenie i terapia z rodzajem („leczenia odwykowego”, „terapię integracji sensorycznej”, „psychoterapię”). */
const TREATMENT = `${cap('lecz')}(?:enie|enia|eniu|eniem)${WS}(?:${TREAT_ADJ}|uzależnie(?:ń|nia)(?:${WS}od${WS}${SUBST})?|(?:w|we)${WS}${PLACE_MED})|${cap('terapi')}(?:a|i|ę|ą)${WS}(?:${TREAT_ADJ}|integracji${WS}sensorycznej|uzależnie(?:ń|nia)(?:${WS}od${WS}${SUBST})?|ręki)|${cap('psychoterapi')}(?:a|i|ę|ą)`;

const RE_L4_PLACE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:lini|hal|sektor|stref|poziom|bram|budyn|sal|magazyn|regał|kabin|peron|tor|blok|modu|segment|warstw|wariant|model)${L}[ \\t]{1,8}L-?4`,
  'i',
);

/* ── Zdarzenia zdrowotne po angielsku (pisma dwujęzyczne) ── */

const EN_MONTH = 'January|February|March|April|May|June|July|August|September|October|November|December';
const EN_DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?[ \t]+(?:${EN_MONTH})(?:[ \t]+\d{4})?|(?:${EN_MONTH})[ \t]+\d{1,2}(?:st|nd|rd|th)?(?:,?[ \t]+\d{4})?|\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)`;
const EN_PERIOD = `(?:${WS}(?:until|till|from|since|to)${WS}${EN_DATE}(?:${WS}(?:to|until|till)${WS}${EN_DATE})?)?`;
/** Rodzaj zabiegu przed „surgery” („knee replacement surgery”, „hip surgery”). */
const EN_SURG_MOD = '(?:knee|hip|heart|back|spine|spinal|cardiac|brain|eye|cataract|shoulder|bypass|hernia|replacement|cancer|major|emergency|planned|thyroid|kidney|liver|gallbladder|bowel|breast|lung|open-heart|keyhole|orthopaedic|orthopedic)';
const EN_PROC = '(?:surgery|operation|transplant|amputation|mastectomy|hysterectomy|chemotherapy|radiotherapy|dialysis|angioplasty|coronary[ \\t]+angiography|colonoscopy)';
const EN_STOP = '(?:in|on|at|and|or|last|this|next|when|by|after|since|from|which|that|but|for|with|to|of|the|a|an|was|is)';
const EN_WORD = `(?!${EN_STOP}(?![A-Za-z]))[a-z][a-z'-]+`;
/**
 * Rzeczownik po nazwie placówki („the hospital cafeteria”, „the hospital expansion project”): mowa o części
 * albo sprawie szpitala, a nie o przyjęciu na leczenie. Przyimek, spójnik, przysłówek na -ly i koniec zdania przepuszcza.
 */
const EN_NOT_NOUN_AFTER = String.raw`(?![ \t]+(?!(?:in|on|at|for|with|after|by|and|or|where|when|last|yesterday|today|due|because|following|from|since|until|without|overnight|again|twice|once|under|as|of|the|a|an|this|that|which|who|he|she|but|then)(?![A-Za-z])|[a-z]+ly(?![A-Za-z]))[a-z])`;
/** Podmiot-człowiek przed „is disabled” („He was disabled”, „Mr Smith is disabled”, „my son is disabled”); „His access”, „My account” nie. */
const EN_HUMAN_SUBJ = String.raw`(?:(?<![A-Za-z])(?:he|she|I|He|She)|(?:Mr|Mrs|Ms|Miss|Dr)\.?[ \t]+[A-Z][a-z]+|(?<![A-Za-z])(?:son|daughter|wife|husband|mother|father|child|applicant|claimant|employee|patient|tenant|pupil|student|boy|girl|brother|sister|grandmother|grandfather))`;
const evEn = (src: string): HealthEvent => ({
  re: new RegExp(`(?<![A-Za-z])(?:${src})(?![A-Za-z])`, 'g'),
  en: true,
});
const EN_EVENTS: HealthEvent[] = [
  // „is on sick leave until 30 November”, „has been on sick leave since 3 March”
  evEn(String.raw`(?<=(?:is|was|been|be|am|are|remains|remained|currently|still|went)[ \t]{1,4})on${WS}sick${WS}leave${EN_PERIOD}|sick${WS}leave${WS}(?:from|until|since)${WS}${EN_DATE}(?:${WS}(?:to|until)${WS}${EN_DATE})?`),
  // „underwent knee surgery”, „had hip replacement surgery”, „after a kidney transplant”
  evEn(
    String.raw`(?<=(?:underwent|undergone|undergoes|undergo|had|has[ \t]{1,4}had|recovering[ \t]{1,4}from|after|following)[ \t]{1,4})(?:(?:an?|the|his|her)[ \t]{1,4})?(?:${EN_SURG_MOD}${WS}){1,3}${EN_PROC}|(?<=(?:underwent|undergone|undergoes|undergo|recovering[ \t]{1,4}from)[ \t]{1,4})(?:(?:an?|the|his|her)[ \t]{1,4})?${EN_PROC}|(?<=(?:after|following|had|has[ \t]{1,4}had)[ \t]{1,4})(?:(?:an?|the|his|her)[ \t]{1,4})?(?:transplant|amputation|mastectomy|hysterectomy|chemotherapy|radiotherapy|miscarriage|stroke(?![ \t]+of(?![A-Za-z]))|heart[ \t]+attack)`,
  ),
  // „is receiving chemotherapy”, „is on dialysis”, „started psychotherapy”
  evEn(String.raw`(?<=(?:receiving|undergoing|started|completed|began|on|having|in|attends|attended|attending)[ \t]{1,4})(?:chemotherapy|radiotherapy|dialysis|psychotherapy|psychiatric[ \t]+treatment|cancer[ \t]+treatment|addiction[ \t]+(?:treatment|therapy)|rehab(?:ilitation)?(?:[ \t]+for[ \t]+(?:alcohol|drug)[ \t]+(?:addiction|abuse))?)`),
  // „is 24 weeks pregnant”, „is pregnant with twins”
  evEn(String.raw`(?:\d{1,2}|[a-z]+(?:-[a-z]+)?)${WS}(?:weeks?|months?)${WS}pregnant|(?<=(?:is|was|am|been|became|got)[ \t]{1,4})pregnant(?:${WS}with${WS}(?:twins|her[ \t]+(?:first|second|third)[ \t]+child))?`),
  // „was admitted to a psychiatric hospital”, „was hospitalised”
  evEn(
    String.raw`(?<=(?:was|been|is|were|got)[ \t]{1,4})(?:admitted|hospitali[sz]ed|committed|taken)${WS}(?:to|in|into|at)${WS}(?:(?:an?|the)${WS})?(?:(?:psychiatric|mental[ \t]+health|general|district|regional|children's|rehabilitation|county|university|cardiology|oncology|neurology|maternity)${WS}){0,2}(?:hospital|clinic|ward|unit|rehab(?:ilitation)?(?:[ \t]+cent(?:er|re))?|hospice|intensive[ \t]+care)${EN_NOT_NOUN_AFTER}|(?<=(?:was|been|is)[ \t]{1,4})hospitali[sz]ed`,
  ),
  // „holds a certificate of moderate disability”, „moderate degree of disability”, „is registered disabled”
  evEn(
    String.raw`(?:certificate|decision|statement|ruling)${WS}(?:of|on)${WS}(?:(?:a|the)${WS})?(?:(?:mild|moderate|severe|significant|light|considerable)${WS})?(?:degree${WS}of${WS})?disability|(?:mild|moderate|severe|significant|considerable)${WS}(?:degree${WS}of${WS})?disability|(?<=(?:holds|has|have|had|receives|received|receiving|gets|got|granted|awarded|claims|claimed|obtained|(?:is|was|been|lives|living)[ \t]{1,4}on)[ \t]{1,4}(?:(?:a|an|the|his|her|my)[ \t]{1,4})?)disability${WS}(?:certificate|pension|status)|(?<=${EN_HUMAN_SUBJ}[ \t]{1,4}(?:is|was|am|has[ \t]+been|had[ \t]+been)[ \t]{1,4})(?:registered${WS})?disabled`,
  ),
  // „was diagnosed with depression”, „is treated for diabetes”, „is treated psychiatrically”
  evEn(String.raw`(?<=(?:was|been|is|being)[ \t]{1,4})(?:diagnosed${WS}with|treated${WS}for)(?:${WS}${EN_WORD}){1,4}|(?<=(?:was|been|is|being)[ \t]{1,4})treated${WS}psychiatrically`),
  // rozpoznanie po kotwicy: „underwent treatment for acute lymphoblastic leukaemia”, „suffers from asthma”;
  // ubytek funkcji i jego urządzenie: „a moderate hearing impairment”, „uses hearing aids”
  evEn(
    String.raw`(?<=(?:underwent|undergoing|received|receiving|completed|started)[ \t]{1,4}treatment[ \t]{1,4}for[ \t]{1,4})${EN_WORD}(?:${WS}${EN_WORD}){0,3}|(?<=(?:suffers|suffered|suffering)[ \t]{1,4}from[ \t]{1,4})${EN_WORD}(?:${WS}${EN_WORD}){0,3}`,
  ),
  evEn(
    `(?:(?:mild|moderate|severe|profound|partial|significant)${WS})?(?:hearing|visual|sight|vision|speech|mobility|cognitive|intellectual)${WS}(?:impairment|loss|disability)|hearing${WS}aids?|cochlear${WS}implants?`,
  ),
];
/** Osoba w zdaniu angielskim: tytuł z nazwiskiem, pierwsza osoba, zaimek, rola w liczbie pojedynczej. */
const RE_EN_NAMED = /(?<![A-Za-z])(?:(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?[ \t]+[A-Z]|(?:I(?=[ \t]+(?:am|was|have|had|underwent|went|will))|my|me)(?![A-Za-z]))/;
const RE_EN_PERSON =
  /(?<![A-Za-z])(?:he|she|his|her|him|(?:the|this|our|your|my)[ \t]+(?:applicant|claimant|employee|patient|pupil|student|child|tenant|defendant|plaintiff|mother|father|son|daughter|husband|wife|worker|candidate|appellant|respondent|participant|client|customer|teacher|minor|boy|girl))(?![A-Za-z])/i;
/** Zdanie ogólne po angielsku: przepis, polityka, każdy, grupa w liczbie mnogiej. */
const RE_EN_GENERAL =
  /(?<![A-Za-z])(?:may|must|shall|should|can|entitled|eligible|policy|policies|regulations?|Act|Code|section|rules?|procedure|any|all|every|each|whoever|anyone|employees|patients|people|workers|persons|individuals|pupils|students|staff|those|who)(?![A-Za-z])/;
function enAnchor(text: string, starts: number[], from: number, to: number): boolean {
  const sentence = sentenceAt(text, starts, from, to);
  if (mtest(RE_EN_NAMED, sentence) || namePairAt(sentence) >= 0) return true;
  if (mtest(RE_EN_GENERAL, sentence)) return false;
  return mtest(RE_EN_PERSON, sentence);
}

/** Rodzaj niepełnosprawności po rzeczowniku („niepełnosprawność ruchowa”, „intelektualną”). */
const DIS_KIND = `(?:ruchow|intelektualn|sprzężon|wzrokow|słuchow|psychiczn|umysłow|fizyczn|neurologiczn)[${LO}]*`;
/** Dopełnienie zabiegu: nazwa zabiegu albo wyraz medyczny („koronarografii”, „kolana”, „usunięcia macicy”). */
const MED_OBJ = `(?:${PROC}|${MED_FIRST})`;
/** Wyraz dopełnienia po „z powodu”, „na” („z powodu przepukliny kręgosłupa”, „na depresję”). */
const EV_OBJ = `(?!${OBJ_STOP_EV}(?![${LETTER}]))[${LO}]{3,}`;
/** Łącznik w liczbie pojedynczej przed imiesłowem („jest leczona”, „był operowany”, „została hospitalizowana”). */
const COPULA = `(?:${'jest|był|była|jestem|byłem|byłam|jesteś|zostaje|został|została|zostałem|zostałam|pozostaje|będzie'.split('|').map(cap).join('|')})`;
/** Do dwóch okoliczników między łącznikiem a imiesłowem („jest od lat leczony”, „był w 2023 r. operowany”). */
const ADV_GAP = String.raw`(?:(?:(?:od|przez|w|we|od[ \t]+\d{4}|do)[ \t]{1,4}[${LO}\d]{1,12}(?:[ \t]{1,4}r\.)?|[${LO}]{3,14})[ \t]{1,8}){0,2}`;
/** Okolicznik między czasownikiem pobytu a miejscem („przebywa obecnie w szpitalu”, „trafiał kilkukrotnie na oddział”). */
const STAY_ADV = String.raw`(?:(?:obecnie|ponownie|nadal|wciąż|kilkukrotnie|wielokrotnie|dwukrotnie|trzykrotnie|często|ostatnio|stale|czasowo|okresowo|aktualnie|już|jeszcze|wtedy|wówczas|od[ \t]{1,4}[${LO}\d]{2,12})[ \t]{1,8})?`;

/** Przysłówek rodzaju leczenia („leczona psychiatrycznie”, „operowany laparoskopowo”); „przyrodniczo”, „ekologicznie” nie. */
const MED_ADV = `(?:psychiatrycznie|neurologicznie|onkologicznie|kardiologicznie|psychologicznie|psychoterapeutycznie|ortopedycznie|dermatologicznie|laryngologicznie|ginekologicznie|urologicznie|endokrynologicznie|diabetologicznie|hematologicznie|nefrologicznie|reumatologicznie|pulmonologicznie|gastroenterologicznie|okulistycznie|chirurgicznie|internistycznie|laparoskopowo|endoskopowo|artroskopowo|odwykowo|ambulatoryjnie|szpitalnie|stacjonarnie|farmakologicznie|operacyjnie|zachowawczo|paliatywnie|objawowo|przewlekle)(?![${LETTER}])`;
const PART_AMBIG = `(?:lecz(?:ony|ona)|(?:operowan|zoperowan|diagnozowan|rehabilitowan|napromieniowan)(?:y|a))`;
/** Dopowiedzenie imiesłowu: miejsce leczenia, specjalista albo przyczyna („z powodu…”, „na…”, „w kierunku…”). */
const PART_COMPL = `(?:${WS}(?:w|we|na)${WS}(?:${STAY_PLACE}|${PLACE_MED})|${WS}u${WS}(?:${SPEC_RE})|${WS}(?:z${WS}powodu|na|w${WS}kierunku)(?:${WS}${EV_OBJ}){1,3})`;
const RE_PART_PLACE = new RegExp(`${NOT_LETTER_BEFORE}(?:${MED_ADV}|u${WS}(?:${SPEC_RE})|(?:w|we|na)${WS}(?:${STAY_PLACE}|${PLACE_MED}))`, 'i');
const RE_PART_CAUSE = /(?:z[ \t]+powodu|(?<![a-ząćęłńóśźż])na|w[ \t]+kierunku)[ \t\r\n]+(.*)$/is;
const RE_MED_WORD = new RegExp(`${NOT_LETTER_BEFORE}${MED_WORD}`, 'i');
/** Czy dopowiedzenie imiesłowu jest medyczne: przysłówek leczenia, placówka, specjalista albo wyraz medyczny. */
function partMedical(m: string): boolean {
  if (mtest(RE_PART_PLACE, m)) return true;
  const cause = RE_PART_CAUSE.exec(m);
  return !!cause && (hasMedVocab(cause[1]) || mtest(RE_MED_WORD, cause[1]));
}
const RE_AGENT = /^[ \t]+przez[ \t]+([^ \t,.;:!?]+(?:[ \t]+[^ \t,.;:!?]+)?)/i;
const RE_MED_AGENT = new RegExp(`^(?:lekar|lekark|specjalist|psychiatr|onkolog|kardiolog|neurolog|chirurg|ortoped|ginekolog|okulist|laryngolog|urolog|dermatolog|psycholog|terapeut|psychoterapeut|fizjoterapeut|ratowni|zesp|personel|dr|prof|lek|doktor|profesor|ordynator|rezydent|anestezjolog|internist|pediatr|${SPEC_RE})`, 'i');
function agentNotMedical(after: string): boolean {
  const a = RE_AGENT.exec(after);
  return !!a && !mtest(RE_MED_AGENT, a[1]) && !hasMedVocab(a[1]);
}
const RE_COPULA_TAIL = new RegExp(String.raw`${COPULA}[ \t]{1,8}${ADV_GAP}$`);
const RE_STAY_TAIL = new RegExp(String.raw`${STAY_VERB}[ \t]{1,8}${STAY_ADV}$`);

/**
 * Bezosobowe „leczy się” („Na tym oddziale leczy się seniorów”, „w poradni leczy się dorosłych”):
 * dopełnienie po „się” albo samo miejsce zamiast podmiotu. Forma zwrotna osoby („Syn leczy się
 * psychiatrycznie”, „Od roku leczy się w poradni”) dopełnienia nie ma.
 */
const RE_CURE_OBJECT = new RegExp(
  `^(?:[ \\t]+(?:głównie|przede[ \\t]+wszystkim|najczęściej|zwykle|przeważnie|wyłącznie|zwłaszcza|także|również|też|m\\.[ \\t]?in\\.)){0,2}[ \\t]+(?!(?:od|w|we|u|z|ze|na|do|po|przez|i|oraz|a|ale|bo|już|nadal|wciąż|regularnie|systematycznie|stale|tam|tu|sam|sama|sami|nie|się|dalej|długo|krótko|prywatnie|odpłatnie|bezpłatnie|wiele|kilka|kilkanaście|tylko|jedynie|obecnie|aktualnie|ponownie|ciągle|przewlekle|ambulatoryjnie)(?![${LETTER}]))[${LO}]{3,}(?:ów|ych|ich|i|y|e|ę|a)(?![${LETTER}])`,
  'i',
);
const RE_CURE_PLACE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:na|w|we)[ \\t]+(?:(?:tym|tej|naszym|naszej|danym|danej|każdym|każdej|takim|takiej)[ \\t]+)?(?:oddzia|poradni|szpital|klini|ośrod|placówc|przychodni|gabine|Polsce|kraju|zakładzie|centrum|sanatori|hospicj|izbie|Europie|świecie)`,
  'i',
);
function impersonalCure(whole: string, offset: number, m: string, starts: number[]): boolean {
  if (mtest(RE_CURE_OBJECT, whole.slice(offset + m.length, offset + m.length + 80))) return true;
  const kind = eventSubject(whole, starts, offset, offset + m.length);
  if (kind !== 'none' && kind !== 'verb') return false;
  const sentence = sentenceAt(whole, starts, offset, offset + m.length);
  const s0 = Math.max(starts[sentenceIndex(starts, offset)], offset - SPAN);
  const [ca] = boundsAt(sentence, offset - s0, offset - s0 + m.length, RE_CLAUSE_BREAK);
  return mtest(RE_CURE_PLACE, sentence.slice(ca, offset - s0));
}

/**
 * Pobyt bez leczenia: cel pozamedyczny po miejscu („zgłosił się do szpitala z reklamacją”, „w sprawie
 * praktyk”, „na rozmowę kwalifikacyjną”, „na staż”, „do naprawy agregatu”), godziny pracy („od 8:00
 * do 16:00”), imiesłów czynności („naprawiając windy”), podmiot-rzecz („Teczka Pana Nowaka leży
 * w szpitalu”) albo osoba z zawodem we wtrąceniu bez dopowiedzenia medycznego („Pan Nowak, konserwator,
 * przebywał w szpitalu”). Cel medyczny („z bólem brzucha”, „na obserwację”, „z powodu zapalenia płuc”,
 * „na sygnale”) i dopowiedzenie czasu („na kilka dni”) pobytu nie wykluczają.
 */
const MED_PURPOSE = `(?:leczeni|obserwacj|chemi|reanim|cesarsk|cięci|hospitaliz|psychiatr|neurolog|kardiolog|porodów|badani|badań|zabieg|operacj|oddzia|SOR|izb|konsultacj|rehabilitacj|dializ|detoks|odwyk|chemioterapi|radioterapi|poród|porod|intensywn|terapi|prześwietl|tomografi|rezonans|biopsj|przeszczep|transfuzj|przetoczeni|szyci|zszyci|opatrun|pobrani|kontrol|wizyt|ostr|pogotowi|ratunk|sygnal|skut|wniosek|wniosk|skierowani|polecen|zalecen|własn|żądani|prośb|odwołani|czas|chwil|moment|dzień|dni|dnia|dob|noc|tydzień|tygod|miesi|rok|lat|okres|początk|końc|koniec|przełom|weekend|święt|kilk|kolejn|następn|wieczor|ran|poniedział|wtor|środ|czwart|piąt|sobot|niedziel|domu|szpital|klinik|hospicj|sanatori|ośrod|zakład|placówk|inn|izolac|kwarantann|wypis|stał|krótk|dług)`;
const RE_MED_PURPOSE = new RegExp(`^${MED_PURPOSE}`, 'i');
const RE_PURPOSE_PREP = new RegExp(`^[ \\t]*(?:[${LO}]{3,}(?:ym|im|ego|ej)[ \\t]{1,4})?(w[ \\t]+sprawie|z|ze|na|do)[ \\t]{1,4}([${LO}]{3,})`, 'i');
const RE_MED_INSTR =
  /^(?:bólem|bólami|urazem|urazami|podejrzeniem|objawami|gorączką|raną|ranami|obrażeniami|rozpoznaniem|diagnozą|złamaniem|zawałem|udarem|krwotokiem|dusznością|dusznościami|zapaleniem|skierowaniem|zatruciem|oparzeniem|oparzeniami|krwawieniem|wymiotami|omdleniem|drgawkami|infekcją|zakażeniem|wysoką|silnym|silnymi|silną|ostrym|ostrymi|ostrą|nagłym|nagłą|ciężkim|ciężkimi|ciężką|dzieckiem|synem|córką|matką|ojcem|żoną|mężem|wnukiem|wnuczką|bratem|siostrą|karetką|pogotowiem|helikopterem|śmigłowcem|zespołem|krwią|temperaturą|ciśnieniem|niewydolnością|zaostrzeniem|nawrotem|nowotworem|guzem|ciążą)$/i;
const RE_WORK_TIME = /od[ \t]+\d{1,2}[:.]\d{2}[ \t]+do[ \t]+\d{1,2}[:.]\d{2}|w[ \t]+godzinach|(?<![a-ząćęłńóśźż])codziennie|na[ \t]+zmian/i;
const RE_GERUND = new RegExp(`${NOT_LETTER_BEFORE}[${LO}]{3,}ąc(?![${LETTER}])`, 'i');
const RE_MED_AFTER = /z[ \t]+powodu|po[ \t]+(?:zawale|udarze|wypadku|operacji|zabiegu|urazie|upadku|porodzie|próbie|pobiciu|przedawkowaniu)|w[ \t]+(?:stanie|ciężkim)|z[ \t]+(?:urazem|obrażeniami|podejrzeniem|bólem|gorączką|zawałem|udarem|złamaniem)/i;
const RE_INSPECTION_AFTER = /^[ \t]+(?:przeciwpożar|sanitarn|techniczn|budowlan|skarbow|podatkow|finansow|NIK|PIP|sanepid|planow|doraźn|problemow|zewnętrzn|wewnętrzn|instalacj|urządze|dokumentacj|BHP|ppoż)/i;
function nonMedicalStay(after: string): boolean {
  const seg = /^[^.;!?\n]{0,90}/.exec(after)?.[0] ?? '';
  if (mtest(RE_STAY_PURPOSE, seg) || mtest(RE_WORK_TIME, seg)) return true;
  const first = seg.split(/[,;(]/)[0];
  // Cel tuż po miejscu rozstrzyga pierwszy: „na stanowisko sekretarki medycznej” to praca, choć dalej stoi wyraz medyczny.
  const m = RE_PURPOSE_PREP.exec(first);
  if (m) {
    const prep = m[1].toLowerCase();
    const word = m[2];
    if (prep.startsWith('w')) return true;
    const inspection = /^kontrol/i.test(word) && mtest(RE_INSPECTION_AFTER, first.slice(m.index + m[0].length));
    const medWord = !inspection && (mtest(RE_MED_PURPOSE, word) || hasMedVocab(word) || mtest(RE_MED_WORD, word));
    if (prep === 'z' || prep === 'ze') {
      if (/(?:ą|em|ami|mi)$/.test(word) && !mtest(RE_MED_INSTR, word) && !medWord && !hasMedVocab(first.slice(m.index))) return true;
    } else if (!medWord) return true;
  }
  if (mtest(RE_MED_AFTER, first) || hasMedVocab(first) || mtest(RE_MED_WORD, first)) return false;
  const g = RE_GERUND.exec(seg);
  return !!g && !hasMedVocab(seg.slice(g.index, g.index + 50));
}
const STAY_TRADE = `(?:lekar|lekark|logoped|psycholog|terapeut|psychoterapeut|pielęgniar|położn|ordynator|ratowni|fizjoterapeut|opiekun(?:ka)?[ \\t]+medyczn|rezydent|kapelan|wolontariusz|student|praktykant|stażyst|konserwator|elektryk|technik|serwisant|monter|hydraulik|informatyk|kierowc|kurier|dostawc|ochroniarz|sprzątacz|salow|sanitariusz|farmaceut|diagnost|laborant|dietety|sprzedaw|handlowc|przedstawiciel|malarz|stolarz|murarz|dekarz|ślusarz|spawacz|portier|recepcjonist|sekretark|księgow|kucharz|kucharka|praczk|magazynier|zaopatrzeniow|audytor|kontroler|inspektor[ \\t]+sanepid)${L}`;
const RE_FUNCTION_IN_HEAD = new RegExp(`,[ \\t]*(?:[${LO}]+[ \\t]+)?${STAY_TRADE}(?![${LETTER}])[^,\\n]{0,40},`, 'i');
function stayNotTreatment(whole: string, offset: number, m: string, starts: number[]): boolean {
  if (staffBefore(whole, offset, m, starts)) return true;
  const after = whole.slice(offset + m.length, offset + m.length + 120);
  if (nonMedicalStay(after)) return true;
  const verbForm = !/^(?:pobyt|pobyci|Pobyt|Pobyci)/.test(m);
  if (verbForm && eventSubject(whole, starts, offset, offset + m.length, RE_STAY_TAIL) === 'other') return true;
  const seg = /^[^.;!?\n]{0,90}/.exec(after)?.[0] ?? '';
  return mtest(RE_FUNCTION_IN_HEAD, sentenceHead(whole, starts, offset)) && !(mtest(RE_MED_AFTER, seg) || hasMedVocab(seg));
}

const EVENTS: HealthEvent[] = [
  // zwolnienie lekarskie, e-ZLA i L4 z okresem; samo „zwolnienie” tylko po czasowniku pobytu
  // (zwolnienie z pracy, z opłat i zwolnienie warunkowe zostają), samo „L4” tylko po czasowniku
  ev(
    String.raw`(?:${cap('zwolnieni')}(?:e${WS}lekarskie|a${WS}lekarskiego|(?:u|em)${WS}lekarskim|e${WS}chorobowe|a${WS}chorobowego|(?:u|em)${WS}chorobowym)|e-ZLA|(?<=(?:na|dostarczy[${LO}]{0,4}|przedstawi[${LO}]{0,4}|przyni[${LO}]{0,6}|wystawi[${LO}]{0,5}|otrzyma[${LO}]{0,4}|dosta[${LO}]{0,4}|ma|mam|miał[${LO}]{0,3}|poszedł[${LO}]{0,3}|poszła[${LO}]{0,2})[ \t]{1,8})L-?4)(?:[ \t]*\((?:e-ZLA|ZLA|L-?4)\))?${PERIOD}`,
    // „L4” w zdaniu, w którym oznacza linię, halę albo strefę („Linia L4 stoi, operator ma L4 w grafiku”)
    { reject: (w, o, m, st) => /^L-?4/.test(m) && mtest(RE_L4_PLACE, sentenceAt(w, st, o, o + m.length)) },
  ),
  // „przebywa na zwolnieniu”: czasownik pobytu w liczbie pojedynczej wskazuje osobę sam; imiesłów
  // („przebywający na zwolnieniu”) opisuje każdego, kogo to dotyczy
  ev(
    String.raw`(?<=(?:przebyw(?:a|am|ał|ała|ałem|ałam)|jest|jestem|był|była|byłem|byłam|będzie|pozostaje|pozostawał(?:a|em|am)?)[ \t]{1,8}na[ \t]{1,8})zwolnieniu(?![ \t]+(?:z|ze|od(?![ \t]+\d)|warunkow[${LO}]*|lekarsk[${LO}]*|chorobow[${LO}]*|[${LO}]{3,}(?:ym|im))(?![${LETTER}]))${PERIOD}`,
    { self: true },
  ),
  // zasiłek chorobowy, świadczenie rehabilitacyjne, urlop dla poratowania zdrowia i zdrowotny, absencja
  // chorobowa, renta z tytułu niezdolności do pracy
  ev(
    String.raw`(?:\d{1,3}[ \t]+dni[ \t]+)?${cap('zasił')}(?:ek${WS}chorobowy|ku${WS}chorobowego|kiem${WS}chorobowym)${PERIOD}|${cap('świadczeni')}(?:e|a|u|em)${WS}rehabilitacyjn(?:e|ego|ym)${PERIOD}|${cap('urlop')}(?:u|em|ie)?${WS}(?:dla${WS}poratowania${WS}zdrowia|zdrowotn(?:y|ego|ym))${PERIOD}|${cap('absencj')}(?:a|i|ę|ą)${WS}chorobow(?:a|ej|ą)|(?:${cap('rent')}(?:a|y|ę|ą)|${cap('renci')}e)${WS}(?:z${WS}tytułu${WS}(?:(?:całkowitej|częściowej|trwałej|okresowej)${WS})?niezdolności${WS}do${WS}pracy|(?:chorobow|inwalidzk)(?:a|ej|ą|ę|iej))`,
  ),
  // orzeczenie o niepełnosprawności, stopniu, niezdolności, potrzebie kształcenia specjalnego; opinia WWR
  ev(
    `${cap('orzeczeni')}(?:e|a|u|em)${WS}(?:lekarza${WS}orzecznika(?:${WS}ZUS)?${WS})?o${WS}(?:${DEGREE}${WS}${DIS_STEP}|niepełnosprawności|(?:(?:całkowitej|częściowej|trwałej|okresowej)${WS})?${INCAPACITY}|potrzebie${WS}(?:kształcenia${WS}specjalnego|zajęć${WS}rewalidacyjno-wychowawczych|indywidualnego${WS}(?:obowiązkowego${WS}rocznego${WS}przygotowania${WS}przedszkolnego|nauczania|przygotowania${WS}przedszkolnego)))${DIS_SYMBOL}|${cap('opini')}(?:a|i|ę|ą)${WS}o${WS}potrzebie${WS}wczesnego${WS}wspomagania${WS}rozwoju|wczesn(?:e|ego|ym)${WS}wspomagani(?:e|a|u|em)${WS}rozwoju`,
  ),
  // stopień niepełnosprawności przy osobie; wyliczenie stopni w pouczeniu („znacznym lub umiarkowanym”) zostaje
  ev(`${DEGREE}${WS}${DIS_STEP}${DIS_SYMBOL}`, { reject: degreeList }),
  // stwierdzona i orzeczona niepełnosprawność, szyk odwrócony („niepełnosprawny w stopniu znacznym”),
  // rodzaj niepełnosprawności („z niepełnosprawnością intelektualną”), niezdolność do pracy
  ev(
    `${cap('stwierdzon')}(?:o|a|ą)${WS}niepełnosprawnoś(?:ć|ci)(?:${WS}${DIS_KIND})?(?:${WS}w${WS}stopniu${WS}${DEGREE})?|${cap('orzeczon')}(?:o|a|ą)${WS}(?:${DEGREE}${WS})?${DIS_STEP}|niepełnosprawn(?:y|a|ego|ej|emu|ym|ą)${WS}(?:${DIS_KIND}${WS})?w${WS}stopniu${WS}${DEGREE}|niepełnosprawnoś(?:ć|cią|ci)${WS}${DIS_KIND}(?:${WS}w${WS}stopniu${WS}${DEGREE})?|(?:(?:całkowicie|częściowo|trwale|okresowo)${WS})?niezdoln(?:y|a|ego|ej|emu|ym|ą)${WS}do${WS}(?:pracy(?:${WS}i${WS}${SELF_CARE})?|${SELF_CARE})${PERIOD}`,
    { reject: degreeList },
  ),
  // leczenie po czasowniku osoby („przebywał na leczeniu odwykowym”, „przerwał terapię uzależnienia”,
  // „podjęła leczenie psychiatryczne”): czasownik w liczbie pojedynczej wskazuje osobę sam
  ev(
    String.raw`(?<=(?:${STAY_VERB}|podj(?:ął|ęła|ąłem|ęłam)|kontynuuj(?:e|ę)|kontynuował[${LO}]{0,3}|przerwa(?:ł|ła|łem|łam)|rozpocz(?:ął|ęła|ąłem|ęłam)|zakończy(?:ł|ła|łem|łam)|skierowan(?:y|a|ego|ej))[ \t]{1,8}(?:(?:na|do)[ \t]{1,8})?)(?:${TREATMENT})`,
    { self: true, reject: (w, o) => titleBefore(w, o) || placeBefore(w, o) },
  ),
  // „jest uzależniony od amfetaminy”: łącznik z przymiotnikiem w liczbie pojedynczej
  ev(String.raw`(?<=(?:jest|był|była|jestem|byłem|byłam|pozostaje)[ \t]{1,8}(?:[${LO}]{2,12}[ \t]{1,8})?)uzależnion(?:y|a)${WS}od${WS}${SUBST}`, { self: true }),
  // leczenie i terapia z rodzajem („leczenia odwykowego”, „terapię integracji sensorycznej”, „psychoterapię”);
  // po nazwie placówki („poradni leczenia uzależnień”) to nazwa placówki
  ev(TREATMENT, { reject: (w, o) => titleBefore(w, o) || providerBefore(w, o) || placeBefore(w, o) }),
  // „leczy się (psychiatrycznie) (w poradni zdrowia psychicznego)”: czasownik osobowy wskazuje osobę
  ev(
    `${NOT_GENERIC_SUBJECT}${cap('lecz')}(?:ę|y|ył|yła|yłem|yłam)${WS}się(?:${WS}(?:psychiatrycznie|onkologicznie|odwykowo|neurologicznie|kardiologicznie|ambulatoryjnie|szpitalnie|psychologicznie))?(?:${WS}(?:w|we)${WS}${PLACE_MED}|${WS}u${WS}(?:${SPEC_RE}))?`,
    { self: true, reject: impersonalCure },
  ),
  // imiesłów jednoznacznie medyczny po łączniku w liczbie pojedynczej („była hospitalizowana w klinice
  // kardiologii”, „jest dializowany”, „został zaintubowany”); „może być leczona” (przepis) nie ma łącznika osobowego
  ev(
    String.raw`(?<=${COPULA}[ \t]{1,8}${ADV_GAP})(?:hospitalizowan|dializowan|reanimowan|intubowan|zaintubowan|cewnikowan)(?:y|a)(?:${WS}(?:w|we|na)${WS}${STAY_PLACE})?(?:${WS}(?:z${WS}powodu|na|w${WS}kierunku)(?:${WS}${EV_OBJ}){1,3})?`,
    { self: true, subject: true },
  ),
  // imiesłów dwuznaczny („operowany”, „diagnozowany”, „rehabilitowany”, „leczony”, „napromieniowany”: silnik,
  // most, rachunek, teren po żwirowni, rehabilitacja skazanego) tylko z dopowiedzeniem medycznym: przysłówek
  // leczenia, miejsce leczenia, specjalista albo przyczyna z wyrazem medycznym („był operowany na przepuklinę”)
  ev(
    String.raw`(?<=${COPULA}[ \t]{1,8}${ADV_GAP})${PART_AMBIG}(?:${WS}${MED_ADV}(?:${PART_COMPL})?|${PART_COMPL})`,
    { self: true, subject: true, reject: (_w, _o, m) => !partMedical(m) },
  ),
  // bez dopowiedzenia imiesłów mówi o zdrowiu tylko przy człowieku jako podmiocie („Pani Nowak była
  // operowana”, „Syn jest leczony”); „rehabilitowany” bez dopowiedzenia to zwykle rehabilitacja prawna
  ev(String.raw`(?<=${COPULA}[ \t]{1,8}${ADV_GAP})(?:lecz(?:ony|ona)|(?:operowan|zoperowan|diagnozowan|napromieniowan)(?:y|a))`, {
    self: true,
    subject: true,
    reject: (w, o, m, st) => eventSubject(w, st, o, o + m.length, RE_COPULA_TAIL) !== 'person' || agentNotMedical(w.slice(o + m.length, o + m.length + 60)),
  }),
  // opieka i pomoc specjalisty przy osobie („korzysta z pomocy psychologa szkolnego”, „chodzi do psychiatry”,
  // „jest pod stałą opieką kardiologa”, „pod opieką poradni zdrowia psychicznego”), mityngi AA
  ev(
    `${cap('korzyst')}[${LO}]{1,5}${WS}z${WS}(?:pomocy|opieki|porad|konsultacji|terapii|wsparcia)${WS}(?:${SPEC_RE})(?:${WS}(?:szkolnego|dziecięcego|klinicznego))?|(?:chodzi|chodził[${LO}]{0,3}|uczęszcza[${LO}]{0,3}|jeździ[${LO}]{0,3})${WS}do${WS}(?:${SPEC_RE})|pod${WS}(?:(?:stałą|regularną|ciągłą|specjalistyczną|długotrwałą|stałą${WS}i${WS}regularną)${WS})?opieką${WS}(?:(?:lekarza${WS})?(?:${SPEC_RE})(?:${WS}(?:dziecięcego|szkolnego|klinicznego))?|poradni${WS}(?:zdrowia${WS}psychicznego|leczenia${WS}uzależnień|${TREAT_ADJ})|(?:zespołu${WS})?hospicjum(?:${WS}domowego)?|PZP)|(?:mityng|spotkani)[${LO}]{0,3}${WS}(?:grupy${WS})?(?:AA|Anonimowych${WS}(?:Alkoholików|Narkomanów|Hazardzistów))(?![${LETTER}])`,
  ),
  // pobyt w szpitalu, sanatorium, izbie wytrzeźwień, na detoksie; po czasowniku maska obejmuje samo miejsce
  ev(
    String.raw`(?:${cap('pobyt')}(?:u|em)?|${cap('pobyci')}e)${WS}(?:w|we|na)${WS}${STAY_PLACE}|(?<=${STAY_VERB}[ \t]{1,8}${STAY_ADV})(?:w|we|do|na)${WS}${STAY_PLACE}`,
    { reject: stayNotTreatment, subject: true },
  ),
  ev(`(?:po|przy)${WS}wypisie${WS}ze${WS}szpitala|po${WS}(?:wyjściu|powrocie)${WS}ze${WS}szpitala`),
  // zabieg i operacja z dopowiedzeniem medycznym („po operacji biodra”, „po zabiegu usunięcia pęcherzyka
  // żółciowego”) i zabieg nazwany sam („po przeszczepie nerki”, „po amputacji nogi”, „po poronieniu”);
  // „po operacji bankowej”, „po zabiegu usunięcia drzew” nie mają słowa medycznego
  ev(
    `(?:po|przed|w${WS}trakcie|podczas|od${WS}czasu|w${WS}wyniku)${WS}(?:tym${WS}|przebyt(?:ej|ym|ego)${WS}|planowan(?:ej|ym|ego)${WS}|niedawn(?:ej|ym|ego)${WS})?(?:(?:operacji|zabiegu)${WS}${MED_OBJ}|${PROC})${MED_MORE}`,
  ),
  // zabieg po czasowniku osoby („przeszedł zabieg koronarografii”, „przeszła mastektomię”, „miała w lutym
  // zabieg usunięcia macicy”, „ma wszczepiony rozrusznik”)
  ev(
    String.raw`(?<=(?:przeszedł|przeszła|przeszedłem|przeszłam|przejdzie|przechodzi|przebył[${LO}]{0,3}|miał|miała|miałem|miałam|ma|mam|będzie[ \t]{1,4}miał[${LO}]{0,2}|wykonano[ \t]{1,4}(?:mu|jej)|przeprowadzono[ \t]{1,4}(?:mu|jej))[ \t]{1,8}(?:(?:w|we)[ \t]{1,4}[${LO}]{3,12}[ \t]{1,8}|(?:planowo|niedawno|ponownie|wczoraj|dziś|niedawno)[ \t]{1,8})?)(?:(?:zabieg|operację)${WS}${MED_OBJ}|${PROC})${MED_MORE}|(?<=(?:ma|mam|miał|miała)[ \t]{1,8})wszczepion(?:y|ą|e)${WS}${MED_WORD}${MED_MORE}`,
    { subject: true },
  ),
  // „jestem po operacji”, „jest po zabiegu” bez dopowiedzenia, na końcu zdania albo przed spójnikiem
  ev(
    String.raw`(?<=(?:jest|jestem|był|była|będzie|jesteś)[ \t]{1,8})po${WS}(?:operacji|zabiegu)(?=[ \t]*(?:[,.;:!?)\n]|$)|[ \t]+(?:i|oraz|a|ale|więc|dlatego)(?![${LETTER}]))`,
  ),
  // stan po zawale albo udarze („po tym zawale”, „od czasu udaru”)
  ev(
    `(?:po|od|przed)${WS}(?:czasu${WS})?(?:tym${WS}|przebytym${WS}|drugim${WS}|ostatnim${WS}|(?!tym|tamtym)[${LO}]{3,}(?:ym|im|ego)${WS})?(?:zawale|zawału|udarze|udaru)(?:${WS}(?:serca|mózgu|(?:niedokrwienn|krwotoczn)(?:ym|ego)(?:${WS}mózgu)?))?`,
  ),
  // endoproteza, także jej wszczepienie i wymiana („po endoprotezie biodra”)
  ev(
    `(?:(?:wszczepieni|wymian)[${LO}]{1,3}${WS})?endoprotez(?:a|y|ę|ą|ie|om|ach)?(?:${WS}stawu)?(?:${WS}(?:biodrow|kolanow|barkow|łokciow|skokow)[${LO}]{1,3}|${WS}(?:biodra|kolana|barku))?`,
    { reject: titleBefore },
  ),
  // ciąża z tygodniem albo miesiącem („w 20. tygodniu ciąży”, „24. tydzień ciąży”), ciąża zagrożona,
  // „spodziewa się dziecka”, termin porodu
  ev(
    String.raw`(?:\d{1,2}\.?|[${LO}]{3,}(?:ym|im))${WS}(?:tydzień|tygodniu|tygodnia|tygodniem|miesiąc|miesiącu|miesiąca|miesiącem)${WS}ciąży|${cap('ciąż')}(?:a|y|ę|ą)${WS}(?:zagrożon[${LO}]+|bliźniacz[${LO}]+|wysokiego${WS}ryzyka|pozamaciczn[${LO}]+)|(?:zagrożon|bliźniacz|pozamaciczn)[${LO}]+${WS}ciąż[${LO}]+|(?<=(?:zaszł[${LO}]{1,3}|zajść|zachodzi)[ \t]{1,8}w[ \t]{1,8})ciążę|${NOT_GENERIC_SUBJECT}spodziewa(?:ła|m|łam)?${WS}się${WS}dziecka|termin(?:u)?${WS}porodu(?:${WS}(?:wyznaczono${WS})?(?:na|to)${WS}${EV_DATE})?`,
  ),
  // dalsza wzmianka o ciąży w zdaniu z zakrytą już ciążą („24. tydzień ciąży, ciążę prowadzi lekarz”)
  ev(`${cap('ciąż')}(?:a|y|ę|ą)`, { afterMask: true }),
  // przyjmowanie insuliny przez osobę („brała insulinę”, „jest na insulinie”)
  ev(
    String.raw`(?<=(?:bierze|brał[${LO}]{0,3}|brać|przyjmuj[${LO}]{1,3}|przyjmował[${LO}]{0,3}|dostaje|dostawał[${LO}]{0,3}|stosuj[${LO}]{1,3}|jest|jestem|był[${LO}]{0,3})[ \t]{1,8}(?:na[ \t]{1,8})?)insulin(?:ę|y|ie|ą)(?![ \t]+(?:aspart|lispro|glargin|detemir|degludek|glulizyn|ludzk|NPH|izofanow))`,
  ),
  // Pisma dwujęzyczne: te same zdarzenia po angielsku, z kotwicą osoby w zdaniu angielskim (enAnchor).
  ...EN_EVENTS,
];

/** Statystyka: „według danych GUS co trzeci pracownik…”, „odsetek”, „średnio” (procent zostaje, bo stoi też w liście płac). */
const RE_STATS = new RegExp(`${NOT_LETTER_BEFORE}(?:według[ \\t]+danych|dan(?:e|ych)[ \\t]+(?:GUS|ZUS|NFZ|PFRON)|statystyk${L}|odset(?:ek|ka|ku)|średnio|przeciętnie)(?![${LETTER}])`, 'i');
/**
 * Kotwica zdarzenia. Osoba musi być tą, której zdarzenie dotyczy, i stać przy frazie, a nie gdziekolwiek
 * w zdaniu:
 * - osoba z nazwy w członie z frazą („Pan Nowak ma prawo do zasiłku chorobowego”) albo zaraz po niej
 *   w dopełniaczu („zwolnienie lekarskie Pana Nowaka”) wystarcza nawet w zdaniu z przepisem;
 * - osoba z nazwy albo pierwsza osoba w tym samym zdaniu podrzędnym wystarcza, gdy człon z frazą nie
 *   jest przepisem; „Pani Nowak, kierownik działu kadr, przypomina, że zwolnienie lekarskie należy…”
 *   ma urzędnika w innym zdaniu niż frazę, a „Mam przyjemność poinformować, że…” to autor pisma;
 * - urzędnik i świadczeniodawca nie są kotwicą: funkcja we wtrąceniu („Pan Nowak, wójt gminy,”), tytuł
 *   lekarza („Dr Anna Kowalska”) i czasownik usługi przed frazą („zajmuje się leczeniem”, „ufundował
 *   pobyt”, „wydaję orzeczenia”); grupa po frazie („dla samotnych mieszkańców”, „dzieci”) też nie;
 * - czasownik osobowy, rola, krewny, zaimek i karta pacjenta tylko w zdaniu, które nie jest przepisem,
 *   pouczeniem, warunkiem, statystyką ani pytaniem formularza, i nie w członie z orzeczeniem
 *   w liczbie mnogiej („Pracownicy obsługują…”).
 */
function eventAnchor(text: string, starts: number[], from: number, to: number, mask: string, self = false): boolean {
  const sentence = sentenceAt(text, starts, from, to);
  const s0 = Math.max(starts[sentenceIndex(starts, from)], from - SPAN);
  const f = from - s0;
  const t = to - s0;
  if (isGenericRule(sentence) || populationSubject(text, starts, from) || mtest(RE_QUESTION, sentence)) return false;
  if (mtest(RE_GENERIC_RULE, sentence) && !mtest(RE_PERSON_CS, sentence) && namePairAt(sentence) < 0 && !mtest(RE_POSSESSIVE, sentence)) return false;
  const after = sentence.slice(t);
  const named = patientNamed(sentence);
  const owner = named.some(([a]) => a >= t && a <= t + 3);
  const [ca, cb] = boundsAt(sentence, f, t, RE_CLAUSE_BREAK);
  const [sa, sb] = boundsAt(sentence, f, t, RE_SUB_BREAK);
  if (!mtest(RE_OWNER_AFTER, after.slice(0, 40)) && providerRel(sentence.slice(sa, f))) return false;
  const tight = owner || spanIn(named, ca, cb) || mtest(RE_NAMED, sentence.slice(ca, cb));
  if (tight) return true;
  if (!self && mtest(RE_GROUP_AFTER, after)) return false;
  const sub = spanIn(named, sa, sb) || firstPersonIn(sentence, sa, sb, f) || namedIn(sentence);
  const rule = (a: number, b: number): boolean => mtest(RE_NORMATIVE, sentence.slice(a, b).replace(RE_LEGAL_BASIS, ' '));
  if (sub && !rule(ca, cb)) return true;
  // Osoba dziedziczona z innego zdania (podmiot przed „który”, przed „że”) tylko poza przepisem:
  // „pracownik, który przedstawi zwolnienie lekarskie, zachowuje prawo do wynagrodzenia” to reguła.
  const sentenceRule = rule(0, sentence.length);
  if (!sentenceRule && (antecedentPerson(sentence, named, sa) || (sa > 0 && mainSubjectPerson(text, starts, from, to, sentence, sa)))) return true;
  if (sentenceRule || mtest(RE_STATS, sentence) || mtest(RE_IF, sentenceHead(text, starts, from))) return false;
  const { head, clause, tail } = clauseAt(sentence, f, t);
  if (mtest(RE_PLURAL_VERB, head) || mtest(RE_PLURAL_VERB, tail)) return false;
  // Słowo reguły w członie z frazą („może zostać skierowana na leczenie”) wygrywa nawet z czasownikiem osoby.
  if (mtest(RE_NORMATIVE_WEAK, head) || mtest(RE_NORMATIVE_WEAK, tail)) return false;
  if (self) return true;
  if (weakNormative(sentence, f, t)) return false;
  // Zakryta już dana o zdrowiu w tym samym zdaniu („przebywa na zwolnieniu po zabiegu…”) mówi o tej samej osobie.
  if (sentence.includes(mask) || isPatientCard(text)) return true;
  if (fieldValue(text, from) && (isPersonForm(text) || hasPerson(personWindow(text, from, to)))) return true;
  // Rola, krewny i zaimek w tym samym zdaniu podrzędnym, bez samej frazy („Radna zwróciła uwagę, że…”).
  const subText = `${sentence.slice(sa, f)} ${sentence.slice(t, sb)}`;
  if (mtest(RE_EV_PERSON, subText) || mtest(RE_PERSON_THIRD, subText) || mtest(RE_EV_PRONOUN, clause)) return true;
  return continuesPerson(text, starts, from, to, sentence.slice(sa, f));
}
/** Wartość pola formularza: „Etykieta:” na początku wiersza przed frazą („03. Orzeczenie: …”, „Rozpoznanie: …”). */
const RE_FIELD_BEFORE = new RegExp(`(?:^|\\n)[ \\t]*(?:\\d{1,2}[.)][ \\t]*)?[${LETTER}][${LETTER} \\t./-]{1,40}:[ \\t]*$`);
const RE_TOPIC_LABEL = new RegExp(`(?:^|\\n)[ \\t]*(?:\\d{1,2}[.)][ \\t]*)?(?:temat|tytuł|przedmiot|nazwa|cel|zakres|opis|program|szkoleni|kurs|zadani|projekt|kategori|dziedzin|obszar|specjalizacj|rodzaj|usług|oferta|ofert)[${LETTER} \\t./-]{0,40}:[ \\t]*$`, 'i');
const fieldValue = (text: string, from: number): boolean => {
  const before = text.slice(Math.max(0, from - 60), from);
  return mtest(RE_FIELD_BEFORE, before) && !mtest(RE_TOPIC_LABEL, before);
};
/**
 * Podstawa prawna rozstrzygnięcia w konkretnej sprawie („na podstawie art. 26 ustawy o wychowaniu
 * w trzeźwości…”, „w trybie ustawy o ochronie zdrowia psychicznego”): cytat przepisu, a nie zdanie
 * normatywne, więc nie zasłania osoby z nazwy w tym samym zdaniu.
 */
const RE_LEGAL_BASIS = new RegExp(
  `${NOT_LETTER_BEFORE}(?:na[ \\t]+podstawie|w[ \\t]+trybie)[ \\t]+(?:art\\.[ \\t]*\\d+[a-z]?(?:[ \\t]+(?:ust|pkt|§)\\.?[ \\t]*\\d+[a-z]?)*[ \\t]+)?(?:ustaw|kodeks|rozporządzeni)[${LO}]*`,
  'gi',
);
/**
 * Zdanie podrzędne bez własnego podmiotu („że „pije za dużo” i dwa razy trafił…”) dziedziczy podmiot
 * zdania głównego, gdy ten jest człowiekiem w roli innej niż urzędowa („Konkubent przyznał, że…”).
 */
function mainSubjectPerson(text: string, starts: number[], from: number, to: number, sentence: string, sa: number): boolean {
  if (!mtest(RE_REPORT_BREAK, sentence.slice(Math.max(0, sa - 12), sa))) return false;
  if (!mtest(RE_EVENT_VERB_TAIL, text.slice(Math.max(0, from - 60), from))) return false;
  const kind = eventSubject(text, starts, from, to);
  if (kind !== 'verb') return false;
  const [, mainEnd] = boundsAt(sentence, 0, 0, RE_SUB_BREAK);
  const main = sentence.slice(0, Math.min(mainEnd, sa));
  return subjectKind(main) === 'person' && !mtest(RE_FUNCTION_IN_HEAD, main) && !mtest(RE_CLINICIAN_START, main);
}
const RE_EVENT_VERB_TAIL = new RegExp(
  String.raw`${NOT_LETTER_BEFORE}(?:${STAY_VERB}|przeszedł|przeszła|przeszedłem|przeszłam|przechodzi|przebył[${LO}]{0,3}|ma|mam|miał[${LO}]{0,3}|jest|jestem|był[${LO}]{0,3}|będzie|otrzymał[${LO}]{0,3}|dostał[${LO}]{0,3}|korzysta|korzystał[${LO}]{0,3}|uczęszcza[${LO}]{0,3}|podj(?:ął|ęła)|przerwał[${LO}]{0,3}|kontynuuje|zakończył[${LO}]{0,3}|rozpocz(?:ął|ęła))[ \t]{1,8}${STAY_ADV}(?:(?:na|po|w|we|do|z)[ \t]{1,8})?$`,
  'i',
);
const RE_REPORT_BREAK = new RegExp(`${NOT_LETTER_BEFORE}(?:że|iż|bo|ponieważ|gdyż)[ \\t]*$`, 'i');
const RE_CLINICIAN_START = /^[ \t"„(]*(?:dr|lek|prof|doc)\.?[ \t]/i;
const RE_POSSESSIVE = new RegExp(`${NOT_LETTER_BEFORE}(?:mój|moja|moje|mojego|mojej|nasz|nasza|jego|jej)${NOT_LETTER_AFTER}`, 'i');
/**
 * Zdanie względne mówi o osobie tuż przed „który”, „która” („córka stron, Oliwia Kaczor, która korzysta
 * z pomocy psychologa szkolnego”, „syn, który od roku leczy się…”).
 */
const RE_REL_PRONOUN = new RegExp(`(?<![${LETTER}])któr${L}[ \\t]*$`, 'i');
const RE_ANTECEDENT_ROLE = new RegExp(`(?:${PERSON_THIRD.join('|')}|córk[${LO}]*|syn[${LO}]*|stron[${LO}]*|uczestni[${LO}]*)[ \\t]*,?[ \\t]*$`, 'i');
function antecedentPerson(sentence: string, named: [number, number][], sa: number): boolean {
  const before = sentence.slice(0, sa);
  if (!mtest(RE_REL_PRONOUN, before)) return false;
  const rel = before.search(RE_REL_PRONOUN);
  return named.some(([, b]) => b <= rel && b >= rel - 4) || mtest(RE_ANTECEDENT_ROLE, before.slice(Math.max(0, rel - 40), rel));
}
/**
 * Dalsza wzmianka: zdanie bez własnego podmiotu ciągnie wątek osoby z poprzedniego zdania („Matka
 * wnioskodawczyni, Halina Pietrzak, mieszka… Pomaga przy odbiorze dzieci, choć sama porusza się o kulach
 * po endoprotezie biodra”, „Komisja skierowała Mirosława Kaczora na badanie. Po otrzymaniu opinii wniosek
 * o zobowiązanie do leczenia odwykowego…”). Fraza na początku zdania („Absencja chorobowa w spółce
 * wzrosła”) jest jego podmiotem i tematem, więc nie ciągnie osoby z poprzedniego zdania.
 */
function continuesPerson(text: string, starts: number[], from: number, to: number, head: string): boolean {
  if (!/[\p{L}\d]/u.test(head)) return false;
  const kind = eventSubject(text, starts, from, to);
  if (kind !== 'verb' && kind !== 'name') return false;
  const i = sentenceIndex(starts, from);
  if (i === 0) return false;
  const para = text.lastIndexOf('\n', starts[i] - 2) + 1;
  const prev = text.slice(Math.max(Math.min(para, starts[i - 1]), starts[i] - SPAN), starts[i]);
  return patientNamed(prev).length > 0 || mtest(RE_PERSON_THIRD, prev) || mtest(RE_EV_PERSON, prev);
}
/** Leczenie przewlekłe z listy fraz: kotwica medyczna jak przy chorobie albo osoba jak przy zdarzeniu. */
function eventOrMedical(text: string, starts: number[], from: number, to: number, mask: string): boolean {
  return medicalAnchored(text, starts, from, to, mask) || eventAnchor(text, starts, from, to, mask, selfFrame(text, from));
}

/**
 * Opcja formularza bez zaznaczenia („[ ] dziecko z orzeczeniem o niepełnosprawności”) to treść druku,
 * a nie fakt o osobie; zaznaczona („[X] …”) już tak. Liczy się ostatnie pole wyboru przed frazą w wierszu.
 */
const RE_LAST_BOX = /(\[[ \t]?\]|\[[xX✓✔]\]|[☐□☒☑])[^[\]☐□☒☑\n]*$/;
function uncheckedOption(whole: string, offset: number): boolean {
  // Najwyżej 200 znaków wstecz: długi wiersz bez końca nie może dać czasu kwadratowego.
  const seg = whole.slice(Math.max(0, offset - 200), offset);
  const box = RE_LAST_BOX.exec(seg.slice(seg.lastIndexOf('\n') + 1));
  return !!box && /^(?:\[[ \t]?\]|[☐□])$/.test(box[1]);
}
/** Karta pacjenta („Pacjent:” w wierszu) sprawdzana raz na tekst, a nie przy każdym trafieniu. */
let cardText = '';
let cardValue = false;
function isPatientCard(text: string): boolean {
  if (text !== cardText) {
    cardText = text;
    cardValue = mtest(RE_CARD_PATIENT, text);
  }
  return cardValue;
}

/** Druk z polem osoby („PESEL:”, „Imię i nazwisko:”) sprawdzany raz na tekst. */
let formText = '';
let formValue = false;
function isPersonForm(text: string): boolean {
  if (text !== formText) {
    formText = text;
    formValue = mtest(RE_CARD_PERSON, text);
  }
  return formValue;
}

const RE_PREP_START = /^(?:po|w|we|na)[ \t]/i;
const RE_COPULA_BEFORE = new RegExp(`${NOT_LETTER_BEFORE}(?:jest|jestem|był|była|byłem|byłam|będzie|będę|jesteś)[ \\t]{1,4}$`, 'i');

/** Jeden przebieg zdarzeń zdrowotnych (w punkcie stałym razem z frazami). */
function maskEventsOnce(ctx: RedactCtx, mask: string): void {
  for (const e of EVENTS) {
    const starts = sentenceStarts(ctx.text);
    ctx.text = ctx.text.replace(e.re, (m: string, ...args: unknown[]) => {
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      if (inProperName(whole, offset, m) || genericBefore(whole, offset)) return m;
      if (uncheckedOption(whole, offset) || e.reject?.(whole, offset, m, starts)) return m;
      const to = offset + m.length;
      if (e.en) return enAnchor(whole, starts, offset, to) ? ctx.hit('ZDROWIE') : m;
      if (topicBefore(whole, offset, m) || (e.subject && thingSubject(whole, offset, m, starts))) return m;
      if (e.afterMask && !sentenceAt(whole, starts, offset, to).includes(mask)) return m;
      const self = e.self || selfFrame(whole, offset) || (mtest(RE_PREP_START, m) && mtest(RE_COPULA_BEFORE, whole.slice(Math.max(0, offset - 16), offset)));
      return eventAnchor(whole, starts, offset, to, mask, self) ? ctx.hit('ZDROWIE') : m;
    });
  }
  // „rehabilitacja po [zabiegu]”, „leczenie po [udarze]”: rzeczownik przed zakrytym zdarzeniem wchodzi do maski
  const M = escapeRe(mask);
  ctx.text = ctx.text.replace(new RegExp(`${NOT_LETTER_BEFORE}(?:${cap('rehabilitacj')}(?:a|i|ę|ą)|${cap('lecz')}(?:enie|enia|eniu|eniem))${WS}po${WS}${M}`, 'g'), mask);
}

/* ── Okno kontekstu ── */

/** Początki zdań w tekście: po nowym wierszu albo po [.!?] i odstępie przed wielką literą. */
let startsText: string | null = null;
let startsValue: number[] = [];
function sentenceStarts(text: string): number[] {
  // ten sam tekst między przebiegami (nic nie zamaskowano) nie wymaga ponownego liczenia; tablica tylko do odczytu
  if (text === startsText) return startsValue;
  startsText = text;
  startsValue = sentenceStartsOf(text);
  return startsValue;
}
function sentenceStartsOf(text: string): number[] {
  const starts = [0];
  const re = new RegExp(`\\n|[.!?][ \\t]+(?=[${UP}\\[])`, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) starts.push(m.index + m[0].length);
  return starts;
}

/** Indeks zdania, w którym leży pozycja (wyszukiwanie binarne). */
function sentenceIndex(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Zdanie z trafieniem i zdania obok, przycięte do SPAN znaków z każdej strony (długie wiersze
 * bez kropek nie robią z okna całego tekstu). Samo trafienie jest zastąpione spacjami, więc
 * fraza nie jest własną kotwicą („uraz kolana” nie kotwiczy się słowem „uraz”).
 */
function windowAt(text: string, starts: number[], from: number, to: number): string {
  const i = sentenceIndex(starts, from);
  const a = Math.max(starts[Math.max(0, i - 1)], from - SPAN);
  const b = Math.min(i + 2 < starts.length ? starts[i + 2] : text.length, to + SPAN);
  return `${text.slice(a, from)}${' '.repeat(Math.min(to - from, 50))}${text.slice(to, b)}`;
}

/** Samo zdanie z trafieniem (do sprawdzenia ceny przy leku). */
function sentenceAt(text: string, starts: number[], from: number, to: number): string {
  const i = sentenceIndex(starts, from);
  const a = Math.max(starts[i], from - SPAN);
  const b = Math.min(i + 1 < starts.length ? starts[i + 1] : text.length, to + SPAN);
  return text.slice(a, b);
}

/** Szersze okno do szukania osoby: SPAN znaków w obie strony bez względu na granice zdań i wierszy. */
function personWindow(text: string, from: number, to: number): string {
  return `${text.slice(Math.max(0, from - SPAN), from)} ${text.slice(to, to + SPAN)}`;
}

/**
 * Kotwica medyczna konkretnej osoby: silna sama, słaba z osobą w pobliżu (formularz „Nazwisko:”
 * bywa kilka wierszy wyżej), albo już zamaskowana dana o zdrowiu.
 */
function medicalAnchored(text: string, starts: number[], from: number, to: number, mask?: string): boolean {
  const w = windowAt(text, starts, from, to);
  const sentence = sentenceAt(text, starts, from, to);
  if (mask !== undefined && w.includes(mask)) return true;
  if (isGenericRule(sentence) || populationSubject(text, starts, from)) return false;
  if (mtest(RE_STRONG, w)) return true;
  return mtest(RE_WEAK, w) && personNear(text, sentence, from, to);
}

/* ── Sekcje karty informacyjnej ── */

const DIAG_HEADER = String.raw`(?:rozpoznani[ea](?:[ \t]+(?:zasadnicze|główne|wstępne|końcowe|kliniczne|ostateczne|współistniejące|dodatkowe|towarzyszące|przy[ \t]+(?:przyjęciu|wypisie)))*|rozp\.|diagnoz[ay]|choroby[ \t]+(?:współistniejące|przewlekłe|towarzyszące))`;
const DRUG_HEADER = String.raw`(?:leki(?:[ \t]+(?:stosowane|przyjmowane|zalecane))?(?:[ \t]+(?:przewlekle|na[ \t]+stałe|przy[ \t]+wypisie|obecnie))?|przyjmowane[ \t]+leki|zalecane[ \t]+leki|leczenie[ \t]+farmakologiczne|farmakoterapia)`;
const ADVICE_HEADER = String.raw`(?:zalecenia(?:[ \t]+(?:przy[ \t]+wypisie|lekarskie|po[ \t]+wypisie))?)`;
/** Nagłówek sekcji na początku wiersza; wartość w tym samym wierszu albo w kolejnych. */
const RE_SECTION = new RegExp(String.raw`^([ \t]*(${DIAG_HEADER}|${DRUG_HEADER}|${ADVICE_HEADER})[ \t]*(?:\([^)\n]{1,20}\)[ \t]*)?:)([^\n]*)`, 'im');
const RE_DIAG = new RegExp(`^${DIAG_HEADER}$`, 'i');
const RE_SECTION_BARE = new RegExp(String.raw`^[ \t]*(?:${DIAG_HEADER})[ \t]*$`, 'i');
const RE_DRUG_HEAD = new RegExp(`^${DRUG_HEADER}$`, 'i');
/** „Diagnoza:” i „Rozp.:” bywają w protokołach serwisowych („Diagnoza: F28 – brak zapłonu”). */
const RE_STRICT_HEAD = /^(?:diagnoz|rozp\.)/i;
/** Nagłówek jednoznacznie medyczny: z dopowiedzeniem („Rozpoznanie zasadnicze”, „Leki przyjmowane”, „Choroby przewlekłe”). */
const RE_MEDICAL_HEAD = /^(?:choroby|rozpoznani[ea] \S|leki \S|przyjmowane|zalecane|leczenie|farmakoterapia|zalecenia \S)/i;
/** Odpowiedź przecząca w ankiecie („Choroby przewlekłe: nie”) zostaje. */
const RE_NEGATIVE = /^(?:nie|brak|brak danych|nie dotyczy|b\.[ \t]?d\.?|bd|nie przyjmuje|nie choruje|bez|b\/z|-|–|—|żadne|nie ma)[ \t.]*$/i;
/** Wartość z definicji, przepisu albo raportu („w rozumieniu art. 5 ustawy…”), a nie rozpoznanie osoby. */
const RE_SECTION_GENERAL = new RegExp(
  `${NOT_LETTER_BEFORE}(?:definicj${L}|w[ \\t]+rozumieniu|rozporządzeni${L}|art\\.|artykuł${L}|epidemiologi${L})(?![${LETTER}\\d])`,
  'i',
);
/** Pozycja listy: kod ICD, znacznik wyliczenia albo mała litera na początku wiersza. */
const RE_LIST_MARK = /^[ \t]*(?:[-•*][ \t]*|\d{1,2}[.)][ \t]+)/;
const RE_SENTENCE_BREAK = new RegExp(`[.!?][ \\t]+[${UP}]`);
/** Wiersz z dwukropkiem na końcu albo „Etykieta: wartość” to już inna sekcja. */
const RE_OTHER_LABEL = new RegExp(`^[ \\t]*[${LETTER}][${LETTER} \\t.]{0,40}:`);
const RE_TITLE = new RegExp(`^(?:lek|dr|prof|mgr)\\.?(?![${LETTER}])`, 'i');
const RE_LO_START = new RegExp(`^[${LO}]`);

function isListItem(line: string, drugs: boolean): boolean {
  const body = line.replace(RE_LIST_MARK, '').trim();
  if (!body || body.length > 120 || mtest(RE_OTHER_LABEL, line) || mtest(RE_SENTENCE_BREAK, body)) return false;
  if (hasIcd(body)) return true;
  // Nazwa choroby z wielkiej litery („Nadciśnienie tętnicze”, „Zapalenie płuc”) w sekcji rozpoznań.
  if (!drugs && hasDisease(body)) return true;
  if (drugs && (mtest(RE_DOSE_LINE, line) || mtest(RE_DRUG_LINE, line))) return true;
  // Mała litera albo znacznik wyliczenia: pozycja listy. Wiersz z wielkiej litery bez kodu
  // może być już podpisem („lek. Adam Polak” to też mała litera, ale z tytułem i osobą).
  if (mtest(RE_TITLE, body)) return false;
  return mtest(RE_LIST_MARK, line) || mtest(RE_LO_START, body);
}

/**
 * Otoczenie nagłówka: do pięciu wierszy w każdą stronę, najwyżej SPAN znaków, bez wiersza
 * z nagłówkiem (wartość „Leki: paracetamol, ibuprofen” nie może sama siebie uwiarygodnić).
 */
function headerContext(lines: string[], i: number): string {
  const before = lines.slice(Math.max(0, i - 5), i).join('\n').slice(-SPAN);
  const after = lines.slice(i + 1, i + 6).join('\n').slice(0, SPAN);
  return `${before}\n${after}`;
}

type Mode = 'diag' | 'drug' | 'advice';

/**
 * Koniec wartości etykiety w wierszu: pierwszy koniec zdania albo para „imię nazwisko”
 * („Rozpoznanie: astma oskrzelowa Jan Kowalski”), bez odstępów i przecinka przed nią.
 */
function valueEnd(rest: string): number {
  const brk = RE_SENTENCE_BREAK.exec(rest);
  let cut = brk ? brk.index : rest.replace(/[ \t]+$/, '').length;
  const name = namePairAt(rest.slice(0, cut));
  if (name >= 0) cut = rest.slice(0, name).replace(/[ \t,;–-]+$/, '').length;
  return cut;
}

/** Czy wartość sekcji (w wierszu nagłówka albo pozycja listy) to dana o zdrowiu. */
function valueIsHealth(mode: Mode, value: string, strict: boolean, medCtx: boolean): boolean {
  const body = value.replace(RE_LIST_MARK, '').trim();
  if (!body || mtest(RE_NEGATIVE, body) || mtest(RE_SECTION_GENERAL, body)) return false;
  if (mode === 'drug') {
    if (mtest(RE_MONEY, body)) return false; // „Leki: 450,00 zł” w wykazie kosztów
    return mtest(RE_HAS_DOSE, body) || mtest(RE_DRUG_LINE, value) || medCtx;
  }
  if (mode === 'advice') {
    // W zaleceniach tylko wiersz z lekiem: ze słownika albo z jednostką lekową w karcie.
    return mtest(RE_DRUG_LINE, value) || (medCtx && mtest(RE_DOSE_LINE, value));
  }
  if (hasDisease(body)) return true;
  if (strict) return medCtx && hasIcd(body);
  return hasIcd(body) || medCtx;
}

/**
 * Karta konkretnej osoby: pole „Pacjent:” wystarcza samo. PESEL, „Imię i nazwisko:” i zakryta osoba
 * stoją też w pozwie, protokole serwisowym czy zgłoszeniu awarii („Rozpoznanie:\nSprawa o zapłatę”,
 * „Uszkodzenie łożyska”), więc wtedy potrzebne jest słownictwo medyczne obok albo słowo choroby
 * w samym wierszu. 2 = karta pacjenta, 1 = karta osoby, 0 = brak.
 */
const RE_CARD_PATIENT = /(?:^|\n)[ \t]*pacjent(?:ka)?[ \t]*:/i;
const RE_CARD_PERSON = /(?:^|\n)[ \t]*(?:PESEL|imię[ \t]+i[ \t]+nazwisko|nazwisko[ \t]+i[ \t]+imię)(?:[ \t]+(?:pacjent|chor)\S*)?[ \t]*:/i;
function cardSignal(ctx: RedactCtx, near: string): 0 | 1 | 2 {
  const t = ctx.text;
  if (mtest(RE_CARD_PATIENT, t)) return 2;
  if (!(mtest(RE_CARD_PERSON, t) || t.includes(ctx.M.PESEL) || near.includes(ctx.M.IMIE))) return 0;
  return hasMedVocab(near) ? 2 : 1;
}
/** Rdzenie słów nazw chorób w wierszu rozpoznania (bez słownika całych nazw). */
const RE_DIAG_WORD = new RegExp(
  `${NOT_LETTER_BEFORE}(?:chor(?:oba|oby|obę|obą|obie|ób)|zesp[oó]ł${L}|zaburzeni${L}|niewydolnoś${L}|zapaleni${L}|migotani${L}|przewlekł${L}|nadciśnieni${L}|niedokrwi${L}|miażdżyc${L}|otyłoś${L}|niedokrwistoś${L}|anemi${L}|zawał${L}|udar${L}|przepuklin${L}|kamic${L}|marskoś${L}|refluks${L}|dyskopati${L}|zwyrodnieni${L}|nerwic${L}|psychoz${L}|otępieni${L}|demencj${L}|niedoczynnoś${L}|nadczynnoś${L}|łuszczyc${L}|autyzm${L}|nowotw${L}|guz${L}|alergi${L}|astm${L}|cukrzyc${L}|depresj${L}|epizod${L})${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Wiersz rozpoznania bez kodu w karcie osoby („Niewydolność serca”, „Zaburzenia lękowe”): od wielkiej
 * litery, najwyżej osiem wyrazów, bez cyfr, dwukropka i kropki na końcu. Wiersz opisu („Pacjent
 * wypisany do domu”, „Stan dobry”) i podpis z imieniem i nazwiskiem to już nie rozpoznanie.
 */
const RE_DIAG_LINE = new RegExp(`^[${UP}][${LO}]+(?:-[${LETTER}][${LO}]+)?(?:[ \\t]+[${LETTER}][${LETTER}-]*){0,7}$`);
const RE_DIAG_LINE_NOT = new RegExp(
  `^(?:pacjent${L}|chor(?:y|a|ego|ej)|stan|wypis${L}|przyjęt${L}|zalecen${L}|kontrol${L}|lek|leki|badani${L}|wywiad${L}|przebieg${L}|epikryz${L}|data|podpis${L}|lekarz${L}|ordynator${L}|oddział${L}|szpital${L}|informacj${L}|skierowan${L}|wynik${L}|bez|brak${L})(?![${LETTER}])`,
  'i',
);
const isCardDiagLine = (body: string): boolean =>
  mtest(RE_DIAG_LINE, body) && !mtest(RE_DIAG_LINE_NOT, body) && !mtest(RE_NEGATIVE, body) && namePairAt(body) < 0;

/** Rozpoznania i leki w sekcjach karty. Zalecenia nie są maskowane w całości, tylko wiersze z lekiem. */
function maskSections(ctx: RedactCtx): void {
  // Wiersze bez „\r” (plik z Windows): inaczej „$” w regułach wiersza nie trafia, a maska zjada „\r”.
  const raw = ctx.text.split('\n');
  const cr = raw.map((l) => l.endsWith('\r'));
  const lines = raw.map((l, i) => (cr[i] ? l.slice(0, -1) : l));
  let mode: Mode | null = null;
  let card: 0 | 1 | 2 = 0;
  let strict = false;
  let medCtx = false;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Nagłówek bez dwukropka w osobnym wierszu („Rozpoznanie”, a pod nim akapit opinii): dalej tylko
    // wiersze z nazwą choroby, tak jak przy nagłówku „Diagnoza:”.
    if (mtest(RE_SECTION_BARE, line) && (i === 0 || !lines[i - 1].trim()) && lines[i + 1]?.trim()) {
      mode = 'diag';
      strict = true;
      medCtx = hasMedVocab(headerContext(lines, i));
      card = 0;
      out.push(line);
      continue;
    }
    const head = RE_SECTION.exec(line);
    if (head) {
      const name = head[2].replace(/\s+/g, ' ');
      mode = mtest(RE_DIAG, name) ? 'diag' : mtest(RE_DRUG_HEAD, name) ? 'drug' : 'advice';
      strict = mtest(RE_STRICT_HEAD, name);
      // Nagłówek wieloznaczny („Rozpoznanie:”, „Leki:”) potrzebuje słownictwa medycznego obok.
      medCtx = mtest(RE_MEDICAL_HEAD, name) || hasMedVocab(headerContext(lines, i));
      card = mode === 'diag' && !strict ? cardSignal(ctx, headerContext(lines, i)) : 0;
      const value = head[3];
      const lead = /^[ \t]*/.exec(value)?.[0] ?? '';
      const rest = value.slice(lead.length);
      // Wartość w tym samym wierszu: do końca zdania albo wiersza („brak danych. Pacjent wypisany.”
      // to odpowiedź „brak danych”), a przed imieniem i nazwiskiem, które należy do osoby.
      const cut = valueEnd(rest);
      const own = rest.slice(0, cut);
      if (mode !== 'advice' && own.trim() && !own.includes(ctx.M.ZDROWIE) && valueIsHealth(mode, own, strict, medCtx)) {
        out.push(`${head[1]}${lead}${ctx.hit('ZDROWIE')}${rest.slice(cut)}`);
        mode = null; // lista w kolejnych wierszach następuje tylko po pustym nagłówku
        continue;
      }
      out.push(line);
      if (value.trim()) mode = null;
      continue;
    }
    if (mode === null) {
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      mode = null;
      out.push(line);
      continue;
    }
    if (mode === 'advice') {
      // W zaleceniach tylko wiersz „lek dawka”; reszta („kontrola w poradni za 4 tygodnie”) zostaje.
      const m = RE_LIST_MARK.exec(line)?.[0] ?? '';
      if (!mtest(RE_OTHER_LABEL, line) && valueIsHealth('advice', line, false, medCtx)) out.push(`${m}${ctx.hit('ZDROWIE')}`);
      else if (line.length <= 120 && !mtest(RE_OTHER_LABEL, line) && !mtest(RE_SENTENCE_BREAK, line)) out.push(line);
      else {
        mode = null;
        out.push(line);
      }
      continue;
    }
    const body = line.replace(RE_LIST_MARK, '').trim();
    const item = strict ? hasIcd(body) || hasDisease(body) : isListItem(line, mode === 'drug');
    const health = item && !mtest(RE_OTHER_LABEL, line) && valueIsHealth(mode, line, strict, medCtx);
    const cardDiag = mode === 'diag' && card > 0 && isCardDiagLine(body) && (card === 2 || mtest(RE_DIAG_WORD, body));
    if (health || cardDiag) {
      const m = RE_LIST_MARK.exec(line)?.[0] ?? (/^[ \t]*/.exec(line)?.[0] ?? '');
      const trail = /[ \t]*$/.exec(line)?.[0] ?? '';
      out.push(`${m}${ctx.hit('ZDROWIE')}${trail}`);
      continue;
    }
    mode = null;
    out.push(line);
  }
  ctx.text = out.map((l, i) => (cr[i] ? `${l}\r` : l)).join('\n');
}

/* ── Kody ICD-10 ── */

/**
 * Kod po słowie, które go zapowiada: „rozpoznanie F32.1”, „z rozpoznaniem: J45.0”, „kod choroby
 * E10.9”, „(ICD-10: K50.0)”, „diagnoza I10”, „L4 z kodem F32”. Kolejne kody wyliczenia też
 * („J45.0, I10 i E11”). Słabsze zapowiedzi potrzebują potwierdzenia w oknie (patrz icdAnchorOk).
 */
const ICD_ANCHOR = String.raw`(?:${NOT_LETTER_BEFORE}(?:[Rr]ozpoznani(?:e|a|u|em)|[Rr]ozp\.|[Dd]iagnoz(?:a|y|ie|ą|ę)|[Kk]od(?:em|u)?(?:[ \t]+(?:choroby|jednostki[ \t]+chorobowej|rozpoznania|ICD(?:-?1[01])?))?|ICD(?:-?1[01])?|ROZPOZNANIE))`;
const ICD_SEP = String.raw`(?:[ \t]*,[ \t]*|[ \t]*;[ \t]*|[ \t]+(?:i|oraz)[ \t]+)`;
// Jeden odstęp z opcjonalnym znakiem: dwa sąsiednie [ \t]* cofały się kwadratowo na długich odstępach.
const RE_ICD_ANCHORED = new RegExp(
  String.raw`(${ICD_ANCHOR}[ \t]*(?:[(:\-–][ \t]*)?)(${ICD_ANCH}(?:${ICD_SEP}${ICD_ANCH})*)${ICD_END}`,
  'g',
);
const RE_ICD_CODE = new RegExp(ICD_ANCH, 'g');

/**
 * „rozpoznanie”, „kod choroby” zapowiadają kod same. „Diagnoza” i „rozp.” tylko ze słownictwem
 * medycznym obok (kody błędów AGD: „diagnoza: E18”), sama etykieta „ICD-10” tylko przy osobie
 * albo kotwicy silnej (nazwa programu NFZ), samo „kod”/„z kodem” tylko przy kotwicy silnej („L4 z kodem F32”).
 */
/**
 * Zdanie słownikowe, statystyczne albo przepis o kodzie, a nie rozpoznanie osoby: „Kod choroby J18.9
 * oznacza…”, „(opis w słowniku ICD-10)”, „w 2025 r. zgłoszono 1,2 mln porad”, „Rozpoznanie E11 nie
 * jest wymagane do refundacji”.
 */
const RE_ICD_GENERAL = new RegExp(
  `${NOT_LETTER_BEFORE}(?:oznacza(?:ją)?|dotycz${L}|opis${L}|słownik${L}|przypadków|porad|mln|liczb(?:a|y|ie|ę|ą)|statystyk${L}|klasyfikacj${L}|(?:nie[ \\t]+)?(?:jest|są)[ \\t]+wymagan${L}|w[ \\t]+\\d{4}[ \\t]*r\\.)${NOT_LETTER_AFTER}`,
  'i',
);
/** Etykieta formularza na początku wiersza („Kod choroby: F32”, „Rozpoznanie: J45.0”). */
const RE_LINE_LABEL_BEFORE = /(?:^|\n)[ \t]*(?:[-•*][ \t]*|\d{1,2}[.)][ \t]*)?$/;
/** „Rozpoznanie:” tuż przed etykietą ICD („Rozpoznanie: ICD10 F32.1”). */
const RE_DIAG_LABEL_BEFORE = /rozpoznani[ea][ \t]*:[ \t]*$/i;
/** e-ZLA: „niezdolność do pracy (kod choroby: …)” to zwolnienie konkretnej osoby. */
const RE_SICK_LEAVE = new RegExp(`${NOT_LETTER_BEFORE}niezdolnoś${L}[ \\t]+do[ \\t]+pracy${NOT_LETTER_AFTER}`, 'i');

/**
 * Etykieta formularza na początku wiersza zapowiada kod sama, o ile zdanie nie jest słownikowe
 * ani statystyczne. W zdaniu każda zapowiedź („rozpoznanie”, „kod choroby”) potrzebuje osoby
 * obok, kotwicy silnej (wypis, zaświadczenie lekarskie) albo zakrytej już danej o zdrowiu. „Diagnoza” i „rozp.” dodatkowo
 * słownictwa medycznego (kody błędów AGD: „diagnoza: E18”), samo „kod”/„z kodem” kotwicy silnej
 * („L4 z kodem F32”), a sama etykieta „ICD-10” osoby albo kotwicy silnej (nazwa programu NFZ).
 */
function icdAnchorOk(whole: string, starts: number[], offset: number, end: number, pre: string, mask: string): boolean {
  const a = pre.trim();
  const w = windowAt(whole, starts, offset, end);
  if (mtest(RE_ICD_GENERAL, sentenceAt(whole, starts, offset, end))) return false;
  // samo „kod”/„z kodem” (bez „choroby”); „kodem choroby” nie może cofnąć się do „kod” + „em…”
  if (/^kod(?:em|u)?(?![a-z]|[ \t]+[a-zA-Z])/i.test(a)) return mtest(RE_STRONG, w);
  if (/^(?:diagnoz|rozp\.)/i.test(a) && !hasMedVocab(w)) return false;
  const lineStart = mtest(RE_LINE_LABEL_BEFORE, whole.slice(Math.max(0, offset - 12), offset));
  // Etykieta „ICD-10:”, „ICD10” na początku wiersza albo zaraz po „Rozpoznanie:” to pole karty;
  // w zdaniu („program B.29 (ICD-10: G35)”) dalej potrzebuje osoby albo kotwicy silnej.
  if (/^ICD/.test(a) && (lineStart || mtest(RE_DIAG_LABEL_BEFORE, whole.slice(Math.max(0, offset - 30), offset)))) return true;
  if (a.endsWith(':') && lineStart && !/^ICD/.test(a)) return true;
  if (mtest(RE_STRONG, w) || w.includes(mask) || personNear(whole, sentenceAt(whole, starts, offset, end), offset, end)) return true;
  return /^kod/i.test(a) && mtest(RE_SICK_LEAVE, w);
}

function maskIcdAnchored(ctx: RedactCtx): void {
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_ICD_ANCHORED, (m: string, pre: string, codes: string, offset: number, whole: string) => {
    if (!icdAnchorOk(whole, starts, offset, offset + m.length, pre, ctx.M.ZDROWIE)) return m;
    const masked = codes.replace(RE_ICD_CODE, (c) => (ICD_ONLY.test(c) ? ctx.hit('ZDROWIE') : c));
    return `${pre}${masked}`;
  });
  // „leczony z powodu S82.6”: kod bez spacji po literze, przy osobie albo słowie medycznym w zdaniu
  // („z powodu W 12 godzin opóźnienia” to nie kod).
  const starts2 = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_ICD_CAUSE, (m: string, pre: string, codes: string, offset: number, whole: string) => {
    const end = offset + m.length;
    const sentence = sentenceAt(whole, starts2, offset, end);
    if (mtest(RE_ICD_GENERAL, sentence) || isGenericRule(sentence)) return m;
    const w = windowAt(whole, starts2, offset, end);
    if (!(mtest(RE_STRONG, w) || mtest(RE_WEAK, sentence.replace(m, ' ')) || personNear(whole, sentence, offset, end))) return m;
    return `${pre}${codes.replace(new RegExp(ICD, 'g'), () => ctx.hit('ZDROWIE'))}`;
  });
}
const ICD_DOT = String.raw`[A-TV-Z]\d{2}\.\d{1,2}`;
const RE_ICD_PAREN_DOT = new RegExp(String.raw`(\([ \t]*)(${ICD_DOT}(?:${ICD_SEP}${ICD_DOT})*)[ \t]*\)`, 'g');
const RE_ICD_CAUSE = new RegExp(String.raw`(${NOT_LETTER_BEFORE}[Zz][ \t]+powodu[ \t]+)(${ICD}(?:${ICD_SEP}${ICD})*)${ICD_END}`, 'g');

/**
 * Kod z podkategorią w nawiasie w zdaniu („orzeczenie (F84.0) wydano…”, „leczy się (F33.1)”), po frazach,
 * żeby kod tuż po zakrytej chorobie wszedł do jej maski. Kotwica medyczna albo osoba przy chorobie; sama
 * litera z cyframi bez kropki to częściej numer sali czy pozycji.
 */
function maskIcdInParens(ctx: RedactCtx): void {
  const starts3 = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_ICD_PAREN_DOT, (m: string, pre: string, codes: string, offset: number, whole: string) => {
    const end = offset + m.length;
    const sentence = sentenceAt(whole, starts3, offset, end);
    if (mtest(RE_ICD_GENERAL, sentence) || isGenericRule(sentence)) return m;
    if (!diseaseAnchor(whole, starts3, offset, end, ctx.M.ZDROWIE)) return m;
    return `${pre}${codes.replace(new RegExp(ICD, 'g'), () => ctx.hit('ZDROWIE'))})`;
  });
}

/** Kod w nawiasie zaraz po zamaskowanej chorobie („astma oskrzelowa (J45.0)”) wchodzi do tej maski. */
function mergeIcdInParens(ctx: RedactCtx, mask: string): void {
  ctx.text = ctx.text.replace(
    new RegExp(String.raw`${escapeRe(mask)}[ \t]*\([ \t]*(?:ICD(?:-?10)?[ \t]*:?[ \t]*)?${ICD}(?:${ICD_SEP}${ICD})*[ \t]*\)`, 'g'),
    () => mask,
  );
}

/* ── Frazy opisowe z kotwicą kontekstu ── */

/**
 * Przeciwwskazanie lekarskie: maskujemy czynność („przeciwwskazane jest [dźwiganie ciężarów]”),
 * bo ona mówi o stanie zdrowia. Rzeczownik odczasownikowy na -nie/-cie i do dwóch wyrazów po nim,
 * aż do przyimka albo znaku interpunkcji. „Brak przeciwwskazań do pracy” zostaje.
 */
const RE_CONTRAINDICATION = new RegExp(
  String.raw`${NOT_LETTER_BEFORE}(przeciwwskazan(?:e|a|y)[ \t]+(?:(?:jest|są|będzie|było)[ \t]+)?)([${LO}]+(?:nie|cie)(?:[ \t]+(?!(?:do|przez|w|we|na|od|po|z|ze|i|oraz|lub|albo|bez|dla|przy)${NOT_LETTER_AFTER})[${LO}]+){0,2})${NOT_LETTER_AFTER}`,
  'gi',
);

/**
 * Fraza z wielkiej litery poza początkiem zdania i wiersza to część nazwy własnej („Centrum
 * Leczenia Stwardnienia Rozsianego”, „Poradnia Leczenia Cukrzycy”), a nie choroba osoby.
 */
// Skrót wersalikami („COVID-19”, „HIV”) to nie nazwa własna instytucji.
const RE_UP_START = new RegExp(`^[${UP}][${LO}]`);
function inProperName(whole: string, offset: number, m: string): boolean {
  if (!mtest(RE_UP_START, m)) return false;
  const before = whole.slice(0, offset);
  if (!before.trim()) return false;
  return !/(?:[.!?:(\n]|\n[ \t]*(?:[-•*]|\d{1,2}[.)]))[ \t]*$/.test(before.slice(-8));
}

/**
 * Zapowiedź ogólna tuż przed frazą: grupa ludzi w liczbie mnogiej („pacjentów z cukrzycą”, „osoby
 * z chorobą Parkinsona”), program leczenia, pandemia, przeciwdziałanie („przeciwdziałaniu
 * alkoholizmowi” w tytule ustawy). Wtedy nazwa choroby nie mówi o konkretnej osobie.
 */
const RE_GENERIC_BEFORE = new RegExp(
  String.raw`(?:${NOT_LETTER_BEFORE}(?:(?:pacjent(?:ów|om|ami|ach)|pacjenci|pacjentek|osób|osoby|osobom|osobami|dzieci|dzieciom|dziećmi|chorych|chorym|ludzi|kobiet|mężczyzn|seniorów|dorosłych|mieszkańców|pracowników|uczniów|podopiecznych)(?:[ \t]+(?:chorych|chorujących|cierpiących|dotkniętych))?[ \t]+(?:z|ze|na|po|dotkniętych)|program${L}(?:[ \t]+[${LO}]+)?[ \t]+(?:leczenia|profilaktyki|wczesnego[ \t]+wykrywania|badań)|(?:pandemi|epidemi)${L}(?:[ \t]+(?:choroby|koronawirusa|wirusa))?|(?:przeciwdziałani|zwalczani|profilaktyk|zapobiegani|walk)${L}(?:[ \t]+(?:z|ze))?|leki[ \t]+do|leków[ \t]+do))[ \t]+$`,
  'i',
);
/** Zapowiedź ogólna przed pierwszym członem wyliczenia („pacjentów z cukrzycą typu 1 i astmą”). */
const RE_GENERIC_COORD = new RegExp(
  `${RE_GENERIC_BEFORE.source.slice(0, -'[ \\t]+$'.length)}(?:[ \\t]+[^\\s,.;:()]+){1,5}[ \\t]+(?:i|oraz|lub|albo)[ \\t]+$`,
  'i',
);
const genericBefore = (whole: string, offset: number): boolean => {
  const before = whole.slice(Math.max(0, offset - 120), offset);
  return mtest(RE_GENERIC_BEFORE, before.slice(-80)) || mtest(RE_GENERIC_COORD, before);
};

/**
 * Dopełnienie po „choruje na”, „cierpi na” (do sześciu wyrazów) i „przeszedł operację” (do czterech):
 * nazwa choroby albo zabiegu spoza listy fraz („choruje na łuszczycę”, „przeszedł operację kręgosłupa”).
 * Kończy je znak interpunkcji, spójnik albo przyimek („choruje na astmę od dzieciństwa”). Tylko przy
 * konkretnej osobie w liczbie pojedynczej; podmiot ogólny („Pacjenci, którzy chorują…”, „kto choruje…”)
 * i reguła ogólna zostają, a „cierpi na brak czasu” to nie choroba.
 */
const OBJ_STOP = '(?:i|oraz|a|ale|lecz|lub|albo|od|przez|w|we|z|ze|po|do|na|u|dla|co|jak|już|się|nie|bo|więc|ponieważ|któr[a-ząćęłńóśźż]*|według|mimo)';
const OBJ_WORD = `(?!${OBJ_STOP}(?![${LETTER}]))[${LETTER}][${LETTER}-]*`;
const OBJ_NOT = `(?!(?:to|coś|nic|wszystko|brak${L}|nią|niego|nie|tym|tę|tą|ten)(?![${LETTER}]))`;
const RE_SUFFER = new RegExp(
  String.raw`(${NOT_LETTER_BEFORE}${NOT_GENERIC_SUBJECT}(?:choruj(?:e|ę)|chorował(?:a|em|am)?|cierpi(?:ał|ała|ałem|ałam|ę)?)[ \t]+na[ \t]+)${OBJ_NOT}(${OBJ_WORD}(?:[ \t]+${OBJ_WORD}){0,5})(?![${LETTER}\d])`,
  'gi',
);
const RE_SURGERY = new RegExp(
  String.raw`(${NOT_LETTER_BEFORE}${NOT_GENERIC_SUBJECT}(?:przeszedł(?:em)?|przeszła(?:m)?)[ \t]+)(operacj(?:ę|e)(?:[ \t]+${OBJ_WORD}){0,4})(?![${LETTER}\d])`,
  'gi',
);
/** Czasownik w pierwszej osobie („choruję”, „chorowałam”, „przeszedłem”) wskazuje autora pisma. */
const RE_FIRST_PERSON_VERB = /(?:ę|łem|łam|szedłem|szłam)[ \t]/i;
const RE_PATIENT_WORD = new RegExp(`${NOT_LETTER_BEFORE}pacjent(?:ka)?${NOT_LETTER_AFTER}`, 'i');

/** Jeden przebieg fraz i przeciwwskazań; zwraca, czy coś zamaskował. */
/**
 * Frazy z listy. Pierwszy przebieg (late = false) z kotwicą medyczną; drugi, po zdarzeniach, z kotwicą
 * choroby przy osobie (diseaseAnchor), żeby zdarzenie z okresem („od zawału serca”, „jest po udarze
 * niedokrwiennym”) zakryło się w całości, zanim sama nazwa choroby dostanie maskę.
 */
function maskPhraseList(ctx: RedactCtx, mask: string, late: boolean): void {
  for (const p of PHRASES) {
    const lateOnly = p.anchor === diseaseAnchor || p.anchor === namedAnchor || p.anchor === morphAnchor || p.anchor === acronymAnchor;
    if (late ? p.self || !(lateOnly || (p.late && !p.anchor)) : lateOnly) continue;
    const anchor = late ? (p.anchor ?? diseaseAnchor) : (p.anchor ?? medicalAnchored);
    const starts = sentenceStarts(ctx.text);
    ctx.text = ctx.text.replace(p.re, (m: string, ...args: unknown[]) => {
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      if (inProperName(whole, offset, m)) return m;
      if (!p.self && genericBefore(whole, offset)) return m;
      // grupa tuż po nazwie („leczenie cukrzycy u dzieci”, „astma wśród uczniów”): mowa o grupie, nie o osobie
      if (!p.self && mtest(RE_GROUP_AFTER, whole.slice(offset + m.length, offset + m.length + 80))) return m;
      // nazwa choroby w zdaniu ogólnym (warunek, reguła, grupa, dane zbiorcze): ten sam strażnik co po kotwicy rozpoznania
      if ((p.late || lateOnly) && generalDx(whole, starts, offset, offset, offset + m.length)) return m;
      if (!p.self && !anchor(whole, starts, offset, offset + m.length, mask)) return m;
      return ctx.hit('ZDROWIE');
    });
  }
}

function maskPhrasesOnce(ctx: RedactCtx, mask: string): boolean {
  const before = ctx.text;
  maskPhraseList(ctx, mask, false);
  for (const re of [RE_SUFFER, RE_SURGERY]) {
    const st = sentenceStarts(ctx.text);
    ctx.text = ctx.text.replace(re, (m: string, pre: string, obj: string, offset: number, whole: string) => {
      const from = offset + pre.length;
      const to = from + obj.length;
      const sentence = sentenceAt(whole, st, from, to);
      if (isGenericRule(sentence) || populationSubject(whole, st, from)) return m;
      const person = mtest(RE_FIRST_PERSON_VERB, pre) || mtest(RE_PATIENT_WORD, sentence) || personNear(whole, sentence, from, to);
      return person ? `${pre}${ctx.hit('ZDROWIE')}` : m;
    });
  }
  maskEventsOnce(ctx, mask);
  maskDiagnoses(ctx, mask);
  maskPhraseList(ctx, mask, true);
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_CONTRAINDICATION, (m: string, pre: string, _act: string, offset: number, whole: string) => {
    if (!medicalAnchored(whole, starts, offset, offset + pre.length, mask)) return m;
    return `${pre}${ctx.hit('ZDROWIE')}`;
  });
  return ctx.text !== before;
}

/**
 * Frazy do punktu stałego: zamaskowana dana o zdrowiu jest kotwicą dla fraz obok, więc powtarzamy
 * przebieg, aż nic się nie zmieni (inaczej ponowna redakcja wyniku mogłaby zamaskować coś jeszcze).
 */
function maskPhrases(ctx: RedactCtx, mask: string): void {
  for (let round = 0; round < 4 && maskPhrasesOnce(ctx, mask); round++);
}

/**
 * Zapis ICD-10 „kod + opis” („z rozpoznaniem J45.0 Astma oskrzelowa”, „F32 Epizod depresyjny”):
 * opis zaraz po zakrytym kodzie wchodzi do tej samej maski, bo jest nazwą tej samej choroby.
 * Opis z wielkiej litery ma co najmniej dwa wyrazy, z których dalsze są pisane małą literą
 * (imię i nazwisko po kodzie, „J45.0 Jan Kowalski”, się nie łapie), albo jest nazwą choroby.
 * Opis małą literą zakrywa przebieg fraz; dwie sąsiednie maski scalamy w jedną. Kod wyliczenia
 * po opisie („Astma oskrzelowa, I10”) dostaje własną maskę, tak jak kody wyliczenia po kotwicy.
 */
const DESC_WORD = `(?!(?:i|oraz|lub|albo|w|we|z|ze|na|do|od|u|przez|po|przy|dla|bez)(?![${LETTER}]))[${LO}]+(?:-[${LO}]+)?`;
function mergeAfterMask(ctx: RedactCtx, mask: string): void {
  const M = escapeRe(mask);
  const reDesc = new RegExp(String.raw`${M}([ \t]+(?:[-–][ \t]+)?[${UP}][${LO}]+(?:-[${LETTER}][${LO}]+)?(?:[ \t]+${DESC_WORD}){0,6})(?![${LETTER}\d])`, 'g');
  const reAdj = new RegExp(String.raw`${M}(?:[ \t]+${M})+`, 'g');
  const reNext = new RegExp(`(${M}${ICD_SEP})(${ICD})${ICD_END}`, 'g');
  for (let round = 0; round < 4; round++) {
    const before = ctx.text;
    ctx.text = ctx.text.replace(reDesc, (m: string, desc: string) => {
      const d = desc.replace(/^[ \t]*(?:[-–][ \t]*)?/, '');
      // Znana nazwa choroby na początku opisu: tylko ona, reszta zdania („wymaga kontroli”) zostaje.
      const known = Math.max(0, ...PHRASE_AT_START.map((re) => re.exec(d)?.[0].length ?? 0));
      if (known) return `${mask}${d.slice(known)}`;
      return /[ \t]/.test(d) ? mask : m;
    });
    ctx.text = ctx.text.replace(reAdj, mask);
    ctx.text = ctx.text.replace(reNext, (_m: string, pre: string) => `${pre}${ctx.hit('ZDROWIE')}`);
    if (ctx.text === before) break;
  }
}

/** Lek jako przykład („np. paracetamol 500 mg”, „leki takie jak…”, „m.in.”), a nie lek osoby. */
const RE_DRUG_EXAMPLE_BEFORE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:np\\.|na[ \\t]+przykład|m\\.[ \\t]?in\\.|tak(?:ich|ie|i|imi)[ \\t]+jak)[^.!?;\\n]{0,60}$`,
  'i',
);
/** Instrukcja albo statystyka: „zgodnie z ulotką”, „1,2 mln recept na…”, „stosować paracetamol”. */
const RE_DRUG_GENERAL = new RegExp(
  `${NOT_LETTER_BEFORE}(?:zgodnie[ \\t]+z[ \\t]+ulotk${L}|recept[ \\t]+na|mln|stosować)${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Dokument o leku, a nie o pacjencie: charakterystyka produktu (ChPL), ulotka, standard, wytyczne,
 * rekomendacja, wykaz, załącznik, przetarg, receptariusz, program lekowy, raport, protokół kontroli.
 */
const RE_DRUG_DOC = new RegExp(
  `${NOT_LETTER_BEFORE}(?:ChPL|charakterystyk${L}[ \\t]+produktu|ulotk${L}|standard(?:u|y|ów|em|zie)?|wytyczn${L}|rekomendacj${L}|wykaz${L}|załącznik${L}|przetarg${L}|S?IWZ|SWZ|receptariusz${L}|program${L}[ \\t]+lekow${L}|obwieszczeni${L}|raport${L}|sprawozdani${L}|monografi${L}|farmakope${L})${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Grupa po leku („u dorosłych”, „u wszystkich pacjentów”, „u chorych unieruchomionych”, „dla dzieci
 * powyżej 12 lat”): dawkowanie dla populacji, a nie zlecenie dla osoby.
 */
const POP_NOUN = `(?:dorosłych|dzieci|młodzieży|pacjentów|chorych|osób|kobiet|mężczyzn|seniorów|niemowląt|noworodków|ciężarnych|kobiet[ \\t]+w[ \\t]+ciąży)`;
/** Liczebnik albo zaimek grupy („300”, „kilkunastu”, „wszystkich”, „części”) przed rzeczownikiem w liczbie mnogiej. */
const POP_NUM = `(?:\\d[\\d \\t]{0,6}|kilku|kilkunastu|kilkudziesięciu|kilkuset|wielu|licznych|wszystkich|każdego|tych|takich|niektórych|części|większości|połowy)`;
const RE_POP_AFTER = new RegExp(
  // „u 300 pacjentów”, „u 12 chorych”, „u wszystkich hospitalizowanych”: po liczebniku każdy rzeczownik
  // w dopełniaczu liczby mnogiej (-ów) albo rzeczownik przymiotnikowy (-ych, -ich), bez listy; bez liczebnika
  // rzeczownik z listy albo imiesłów w liczbie mnogiej („u leczonych”, „u hospitalizowanych”).
  `${NOT_LETTER_BEFORE}(?:u|dla|w[ \\t]+grupie)[ \\t]+(?:${POP_NUM}[ \\t]+(?:[${LO}]{3,}(?:ych|ich)[ \\t]+)?(?:${POP_NOUN}|[${LO}]{3,}(?:ów|ych|ich))` +
    `|(?:[${LO}]{3,}(?:ych|ich)[ \\t]+)?${POP_NOUN}|[${LO}]{2,}(?:owanych|onych|anych|ętych|ytych))${NOT_LETTER_AFTER}`,
  'i',
);
/** Orzeczenie w liczbie mnogiej o przyjmowaniu leku („pacjenci otrzymują”, „chorzy przyjmują”): grupa, nie osoba. */
const RE_PLURAL_INTAKE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:przyjmują|otrzymują|stosują|biorą|zażywają|dostają|(?:są|pozostają|byli|były)[ \\t]+na|przyjmowali|przyjmowały|otrzymywali|otrzymywały|stosowali|stosowały|brali|brały|zażywali|zażywały)${NOT_LETTER_AFTER}`,
  'i',
);
/** Odbiorcy leku w liczbie mnogiej („Pacjentom podawano heparynę”, „wszystkim chorym włączono…”). */
const RE_PLURAL_DATIVE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:pacjentom|chorym|dzieciom|osobom|kobietom|seniorom|mieszkańcom|uczniom|pensjonariuszom|podopiecznym|(?<!przede[ \\t]{1,4})wszystkim)${NOT_LETTER_AFTER}` +
    // celownik liczby mnogiej po budowie, po liczebniku („140 uczestnikom”, „12 chorym”, „kilku badanym”)
    `|(?<![${LETTER}])(?:\\d[\\d \\t]{0,6}|kilku|kilkunastu|kilkudziesięciu|wielu)[ \\t]+[${LO}]{3,}(?:om|ym|im)${NOT_LETTER_AFTER}`,
  'i',
);
/** Źródło danych zbiorczych w zdaniu („wynika z raportu”, „według danych NFZ”, „na podstawie badań”). */
const RE_REPORT_SOURCE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:wynika(?:ją)?[ \\t]+z|według|wg|na[ \\t]+podstawie)[ \\t]+(?:[${LO}]{2,}[ \\t]+){0,2}(?:raport|dan(?:ych|e)|badań|badania|statystyk|analiz|sprawozda|ankiet|przegląd|NFZ|GUS|WHO|ChPL|ulotk|wytyczn)${L}`,
  'i',
);
/**
 * Lek w tekście ogólnym, a nie lek osoby: przepis, populacja przed lekiem albo po nim, orzeczenie
 * w liczbie mnogiej, źródło danych zbiorczych i dokument o leku (ChPL, ulotka, standard, wykaz).
 * Osoba w zdaniu („Pani Nowak: Clexane 40 mg s.c. według ChPL”) przeważa nad dokumentem.
 */
function generalDrug(text: string, starts: number[], from: number, to: number): boolean {
  const sentence = sentenceAt(text, starts, from, to);
  if (isGenericRule(sentence) || populationSubject(text, starts, from)) return true;
  if (hasPerson(sentence) || namePairAt(sentence) >= 0) return false;
  const s0 = starts[sentenceIndex(starts, from)];
  const head = text.slice(Math.max(s0, from - SPAN), from);
  const tail = text.slice(to, to + 80);
  return (
    mtest(RE_PLURAL_INTAKE, head) ||
    mtest(RE_POP_AFTER, tail) ||
    mtest(RE_PLURAL_DATIVE, sentence) ||
    mtest(RE_DRUG_DOC, sentence) ||
    mtest(RE_REPORT_SOURCE, sentence)
  );
}

function maskDrugs(ctx: RedactCtx): void {
  // Lek z dawką poza sekcją karty tylko przy kotwicy: cennik apteki („paracetamol 500 mg, 9,99 zł”),
  // faktura i lista refundacyjna zostają, tak samo lek podany jako przykład albo w instrukcji
  // i statystyce bez osoby („stosować paracetamol 500 mg”, „1,2 mln recept na metforminę 500 mg”).
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_DRUG, (m: string, offset: number, whole: string) => {
    const to = offset + m.length;
    const sentence = sentenceAt(whole, starts, offset, to);
    if (mtest(RE_PRICE, sentence)) return m;
    if (mtest(RE_DRUG_EXAMPLE_BEFORE, whole.slice(Math.max(0, offset - 80), offset))) return m;
    if (mtest(RE_DRUG_GENERAL, sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0) return m;
    if (populationSubject(whole, starts, offset)) return m;
    // Droga podania przy dawce („Enoksaparyna 40 mg s.c.”) wzmacnia kotwicę, ale jej nie zastępuje:
    // wystarcza wtedy sama osoba albo samo słowo medyczne pacjenta, a dawkowanie z ChPL, ulotki,
    // standardu czy wykazu i dawkowanie dla grupy („u dorosłych”) zostają jawne.
    if (mtest(RE_ROUTE, m)) {
      if (generalDrug(whole, starts, offset, to)) return m;
      const w = windowAt(whole, starts, offset, to);
      if (mtest(RE_WEAK, w) || personNear(whole, sentence, offset, to)) return ctx.hit('ZDROWIE');
    }
    const win = windowAt(whole, starts, offset, to);
    if (medicalAnchored(whole, starts, offset, to) || mtest(RE_DRUG_VERB, win)) return ctx.hit('ZDROWIE');
    if (mtest(RE_RX_OWN, sentence)) return ctx.hit('ZDROWIE');
    return mtest(RE_RX_DOC, sentence) && (hasPerson(sentence) || namePairAt(sentence) >= 0 || personNear(whole, sentence, offset, to))
      ? ctx.hit('ZDROWIE')
      : m;
  });
}

/**
 * Lek spoza słownika w zdaniu: czasownik przyjmowania albo zalecenia, 1–3 wyrazy nazwy, dawka
 * z jednostką i ewentualnie dawkowanie („przyjmuje Augmentin 875 mg”, „Zalecono syrop Mucosolvan
 * 5 ml 3x dziennie”, „zalecił mu Lorafen 1 mg na noc”). Samo „zalecił” bez osoby po nim bywa
 * zaleceniem pokontrolnym, więc tu wymaga dopełnienia osobowego. „Przyjmuje się”, „stosuje się”
 * (ulotka, instrukcja) i podmiot ogólny („kto przyjmuje…”) zostają.
 */
const DOSE_VERB = String.raw`${NOT_GENERIC_SUBJECT}(?:przyjmuj(?:e|ę)|przyjmował(?:a|em|am)?|zażyw(?:a|am)|zażywał(?:a|em|am)?|stosuj(?:e|ę)|stosował(?:a|em|am)?|otrzymuj(?:e|ę)|otrzymywał(?:a|em|am)?|zalecono|zalecił(?:a)?[ \t]+(?:mu|jej|mi|mnie|pacjent(?:owi|ce)|choremu|chorej|synowi|córce|dziecku|pracowni(?:kowi|cy)|wnioskodaw(?:cy|czyni)|ubezpieczon(?:emu|ej)|poszkodowan(?:emu|ej)))(?![ \t]+się)`;
const DOSE_WORD = `(?!(?:się|w|we|z|ze|na|do|po|od|i|oraz|lub|albo|nie|co|to|jest|był|była|dawk${L}|ilości|ok|około)(?![${LETTER}]))[${LETTER}][${LETTER}-]{1,30}`;
const RE_DOSE_SENTENCE = new RegExp(
  String.raw`(${NOT_LETTER_BEFORE}(?:${DOSE_VERB})[ \t]+)((?:${DOSE_WORD}[ \t]+){0,2}${DOSE_WORD}${DRUG_FORM}[ \t]+(${NUM}(?:[ \t]*\/[ \t]*${NUM})?[ \t]?(${UNIT})(?:[ \t]*\/[ \t]*(?:ml|dobę|d|24[ \t]?h))?(?![${LETTER}]))(${DOSING}))`,
  'gi',
);
/** Postać leku w nazwie („syrop”, „krople”): przy „g” i „ml” odróżnia lek od nawozu czy kleju. */
const RE_DRUG_FORM_WORD = new RegExp(
  `${NOT_LETTER_BEFORE}(?:syrop${L}|krop(?:le|li)|tabletk${L}|kapsułk${L}|zastrzyk${L}|maś(?:ć|ci)|zawiesin${L}|aerozol${L}|inhalacj${L}|wlew${L}|czopk${L}|insulin${L})${NOT_LETTER_AFTER}`,
  'i',
);
const RE_HAS_UPPER = new RegExp(`[${UP}]`);
const RE_UNIT_DRUG_ONLY = new RegExp(`^${UNIT_DRUG}$`, 'i');

function maskDoseSentences(ctx: RedactCtx): void {
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(
    RE_DOSE_SENTENCE,
    (m: string, pre: string, drug: string, _dose: string, unit: string, tail: string, offset: number, whole: string) => {
      const from = offset + pre.length;
      const to = offset + m.length;
      const sentence = sentenceAt(whole, starts, from, to);
      if (mtest(RE_PRICE, sentence) || isGenericRule(sentence) || populationSubject(whole, starts, from)) return m;
      if (mtest(RE_DRUG_EXAMPLE_BEFORE, whole.slice(Math.max(0, offset - 80), offset))) return m;
      if (mtest(RE_DRUG_GENERAL, sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0) return m;
      // „g” i „ml” stoją też w dawkach nawozu, smaru, mleka czy diety: potrzebna postać leku („syrop”),
      // lek ze słownika albo nazwa handlowa (wielka litera) przy słownictwie medycznym w oknie.
      if (!mtest(RE_UNIT_DRUG_ONLY, unit)) {
        const name = drug.slice(0, drug.length - tail.length);
        const medical = mtest(RE_HAS_UPPER, name) && (medicalAnchored(whole, starts, from, to) || hasMedVocab(windowAt(whole, starts, from, to)));
        if (!(mtest(RE_DRUG_FORM_WORD, name) || mtest(RE_DRUG_NAME, name) || medical)) return m;
      }
      return `${pre}${ctx.hit('ZDROWIE')}`;
    },
  );
}

/**
 * Lek ze słownika bez dawki po czasowniku przyjmowania w liczbie pojedynczej („Pani Kos przyjmuje
 * sertralinę”, „Pozwany przyjmuje metforminę dwa razy dziennie”, „zażywa Xanax”): czasownik osobowy
 * wskazuje osobę. „Przyjmuje się”, podmiot ogólny, przepis, cennik i przykład zostają.
 */
const RE_VERB_DRUG = new RegExp(String.raw`(${NOT_LETTER_BEFORE}(?:${DOSE_VERB})[ \t]+)(${DRUG_NAME}${DRUG_MOD}(?:${DRUG_FORM}[ \t]+${DOSE}${DOSING}|${DOSING_REQ})?)(?![${LETTER}\d])`, 'gi');

function maskVerbDrugs(ctx: RedactCtx, mask: string): void {
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_VERB_DRUG, (m: string, pre: string, drug: string, offset: number, whole: string) => {
    const from = offset + pre.length;
    const to = from + drug.length;
    const sentence = sentenceAt(whole, starts, from, to);
    if (mtest(RE_PRICE, sentence) || mtest(RE_DRUG_EXAMPLE_BEFORE, whole.slice(Math.max(0, offset - 80), offset))) return m;
    if (mtest(RE_DRUG_GENERAL, sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0) return m;
    // Podmiot przed czasownikiem musi być człowiekiem albo domyślny („Hurtownia przyjmuje Ibuprom”,
    // „a szpital stosuje sertralinę” to instytucja; „Pani Kos przyjmuje”, „Od roku przyjmuje” to osoba).
    const kind = eventSubject(whole, starts, offset, from);
    if (kind === 'other' || kind === 'name') return m;
    return eventAnchor(whole, starts, from, to, mask, true) ? `${pre}${ctx.hit('ZDROWIE')}` : m;
  });
}

/* ── Lek bez dawki: kształt nazwy, insulina, klasa leków ── */

/**
 * Końcówki międzynarodowych nazw substancji (rdzenie INN w polskiej pisowni): „-pryl”, „-sartan”,
 * „-olol”, „-statyna”, „-prazol”, „-azepam”, „-mycyna”, „-paryna”, „-fenidat”, „-mab”, „-nib”,
 * „-wir”, „-zonid”, „-nizon”, „-sulosyna” i przedrostek cefalosporyn „cef-”. Przed końcówką co
 * najmniej trzy litery, więc zwykłe słowa („platyna”, „Kain”) nie pasują. Sam kształt nie wystarcza:
 * nazwa jest lekiem dopiero przy czasowniku przyjmowania albo zlecenia, obok zakrytego leku albo
 * w sekcji karty.
 */
const INN_SUFFIX = [
  'pryl', 'sartan', 'olol', 'dypin', 'statyn', 'prazol', 'azepam', 'azolam', 'cyklin', 'mycyn', 'floksacyn', 'cylin',
  'gliptyn', 'gliflozyn', 'glutyd', 'tydyn', 'setron', 'tryptan', 'fenidat', 'orfin', 'paryn', 'ksaban', 'konazol',
  'tiazyd', 'semid', 'profen', 'koksyb', 'kortyzon', 'metazon', 'tropium', 'lukast', 'tyryzyn', 'loratadyn', 'tiapin',
  'zapin', 'peryd', 'piprazol', 'oksetyn', 'faksyn', 'pramin', 'tryptylin', 'trygin', 'racetam', 'gabalin', 'dronian',
  'tyroksyn', 'formin', 'mab', 'nib', 'platyn', 'wudyn', 'kain', 'fetamin',
  'sulosyn', 'zosyn', 'zonid', 'sonid', 'nizon', 'nizolon', 'proinian', 'trozol', 'ksyfen', 'dazol', 'penem',
  'noprost', 'toprost', 'woprost', 'osteron', 'estradiol',
].join('|');
// „-wir” (acyklowir, tenofowir, remdesiwir) bez „wirus”: „koronawirus” to nie lek.
const INN_WORD = `(?<![${LETTER}])(?:[${LETTER}][${LO}]{2,24}(?:${INN_SUFFIX}|wir(?!us))|[Cc]ef[${LO}]{4,14})${DRUG_INFL}(?![${LETTER}\\d])`;
/** Rodzaj insuliny bez słowa „insulina” („i glarginie”); „aspartam” to słodzik. */
const INSULIN_ALONE = `(?<![${LETTER}])(?:glargin|detemir|degludek|degludec|lispro|glulizyn|aspart(?!am))[${LO}]{0,4}(?![${LETTER}\\d])`;
const INSULIN_WORD = `(?<![${LETTER}])[Ii]nsulin[${LO}]{0,3}(?:[ \\t]+${INSULIN_KIND})?(?![${LETTER}\\d])`;
/** Grupa leków przy osobie („leki przeciwdepresyjne”, „leków przeciwpadaczkowych”, „środki nasenne”). */
const DRUG_CLASS_ADJ = `(?:przeciwdepresyjn|przeciwpadaczkow|przeciwdrgawkow|przeciwpsychotyczn|psychotropow|neuroleptyczn|przeciwlękow|anksjolityczn|nasenn|uspokajając|normotymiczn|przeciwzakrzepow|przeciwkrzepliw|przeciwcukrzycow|hipoglikemizując|hipotensyjn|przeciwnadciśnieniow|immunosupresyjn|cytostatyczn|przeciwnowotworow|antyretrowirusow|przeciwretrowirusow|przeciwgruźlicz|przeciwparkinsonowsk|przeciwotępienn|przeciwbólow|opioidow|sterydow|steroidow)[${LO}]{0,3}`;
/**
 * Po słowie „lek” albo postaci leku każdy przymiotnik z przedrostkiem „przeciw-” lub „anty-” nazywa
 * grupę leków („leki przeciwhistaminowe”, „tabletki antykoncepcyjne”, „krople przeciwalergiczne”);
 * „środki” i „preparaty” bywają przeciwpożarowe czy antykorozyjne, więc tam tylko lista powyżej.
 */
const LEK_CLASS_ADJ = `(?:${DRUG_CLASS_ADJ}|(?:przeciw|anty)(?!wskaza|działa|pożar|korozy|korupc|terror|smog|dyskrymin|mobbing|przemoc|włam|kradzie|poślizg)[${LO}]{4,24}|hormonaln[${LO}]{1,3}|biologiczn[${LO}]{1,3})`;
const LEK_FAMILY = `(?:lek(?:i|ów|ami|om|u|iem|ach)?|tabletk(?:a|i|ę|ą|ek|ami|om|ach)|kapsułk(?:a|i|ę|ą|ek|ami|om|ach)|krop(?:le|li|lami)|syrop(?:y|u|em|ów|ami)?|zastrzyk(?:i|ów|ami|u)?)`;
/**
 * Lek „na” narząd albo objaw („leki na serce”, „leków na tarczycę”, „tabletki na sen”). Lek „na” chorobę
 * („leki na nadciśnienie tętnicze”) zostawia „leki na” jawne, bo samą chorobę zakrywają frazy chorób.
 */
const LEK_FOR = `(?:serce|ciśnienie|tarczycę|nerwy|sen|spanie|uspokojenie|wątrobę|nerki|cholesterol|krzepliwość|krążenie|żołądek|stawy|pamięć|lęki)`;
/** Rzeczownik grupy leków („antybiotyk”, „sterydach wziewnych”, „antykoagulanty”). */
const DRUG_CLASS_NOUN = `(?:neuroleptyk|cytostatyk|antybiotyk|antypsychotyk|anksjolityk)(?:i|ów|ami|om|u|iem|ach)?|antydepresant(?:y|ów|ami|om|ach)?|antykoagulant(?:y|ów|ami|om|ach)?|(?:gliko)?kortykosteroid(?:y|ów|ami|ach)?|steryd(?:y|ów|ami|om|ach)|statyn(?:y|ę|ami|ach)|opioid(?:y|ów|ami|ach)|benzodiazepin(?:y|a|ę|ami|om)?|metadon(?:u|em|ie)?|buprenorfin(?:a|y|ę|ą|ie)?`;
const DRUG_CLASS =
  `(?<![${LETTER}])(?:${LEK_FAMILY}[ \\t]+(?:${LEK_CLASS_ADJ}|na[ \\t]+${LEK_FOR})|(?:środk(?:i|ów|ami|om|ach)|preparat(?:y|ów|ami|om|ach))[ \\t]+${DRUG_CLASS_ADJ}` +
  `|${DRUG_CLASS_NOUN})(?:(?:[ \\t]*,[ \\t]*|[ \\t]+(?:i|oraz|lub|albo)[ \\t]+)${DRUG_CLASS_ADJ}){0,2}(?:[ \\t]+(?:wziewn|doustn|dożyln|podskórn|domięśniow|miejscow)[${LO}]{1,3})?(?![${LETTER}\\d])`;
/** Postać leku przed nazwą handlową („przyjmuje lek Concerta”, „zażywa tabletki Relanium”). */
const DRUG_FORM_NOUN = `(?:lek(?:i|u)?|preparat(?:y|u)?|tabletk[${LO}]{0,3}|kapsułk[${LO}]{0,3}|krople|syrop|zastrzyk(?:i|ów)?)`;
/** Postać leku z substancją („inhalator z salbutamolem”, „maść z hydrokortyzonem”, „krople do oczu z latanoprostem”). */
const DRUG_DEVICE = `(?:inhalator${L}|inhalacj${L}|maś(?:ć|ci)|krem${L}|żel${L}|plast(?:ry|rów|er|rami|rach)|krop(?:le|li|lami)|czop(?:ki|ków|kami)|wlew${L}|zastrzyk${L}|aerozol${L})(?:[ \\t]+do[ \\t]+(?:oczu|nosa|uszu|ucha|oka))?[ \\t]+z(?:e)?[ \\t]+(?:${DRUG_NAME}|${INN_WORD})`;
/** Sól po nazwie substancji („walproinian sodu”, „lewotyroksyna sodowa”) należy do nazwy leku. */
const DRUG_SALT = `(?:[ \\t]+(?:sodu|potasu|wapnia|magnezu|sodow[${LO}]{1,2}|potasow[${LO}]{1,2}))?`;
const BARE_DRUG = `(?:(?:${DRUG_NAME}|${INN_WORD})${DRUG_SALT}|${INSULIN_WORD}|${INSULIN_ALONE}|${DRUG_CLASS}|${DRUG_DEVICE}|${DRUG_FORM_NOUN}[ \\t]+[${UP}][${LO}]{2,20}(?![${LETTER}\\d])|[${UP}][${LO}]{2,20}(?![${LETTER}\\d]))`;
/** Czasownik fazowy przed bezokolicznikiem („przestała brać”, „zaczął przyjmować”, „odmawia stosowania”). */
const PHASE_DRUG_VERB = String.raw`(?:przestał(?:a|em|am)?|przestaje|zaczął|zaczęła|zaczyna|odmawia|odmówił(?:a)?|zaprzestał(?:a)?)[ \t]+(?:brać|przyjmować|zażywać|stosować|przyjmowania|zażywania|stosowania|brania)`;
/** Lek, który przyjmuje sama osoba: podmiot czasownika to pacjent („jest na insulinie” też). */
const SELF_DRUG_VERB = String.raw`${NOT_GENERIC_SUBJECT}(?:przyjmuj(?:e|ę)|przyjmował(?:a|em|am)?|przyjął|przyjęła|zażyw(?:a|am)|zażywał(?:a|em|am)?|zażył(?:a|em|am)?|stosuj(?:e|ę)|stosował(?:a|em|am)?|bierze|biorę|brał(?:a|em|am)?|otrzymuj(?:e|ę)|otrzymywał(?:a|em|am)?|otrzymał(?:a|em|am)?|dostaj(?:e|ę)|dostawał(?:a|em|am)?|dostał(?:a|em|am)?|(?:jest|jestem|był|była|byłem|byłam|pozostaje)[ \t]+na|${PHASE_DRUG_VERB})`;
/** Odbiorca leku w celowniku („zalecił mu”, „podaje dziecku”, „ordynowano pacjentce”). */
const DRUG_DATIVE = `(?:mu|jej|mi|mnie|dziecku|synowi|córce|pacjent(?:owi|ce)|choremu|chorej|matce|ojcu|mężowi|żonie|wnukowi|wnuczce|podopieczn(?:emu|ej)|małoletni(?:emu|ej))`;
/**
 * Lek, który zlecił lekarz albo podał opiekun: podmiot to nie pacjent, więc pacjent musi stać
 * w zdaniu, w celowniku albo w zapisie zlecenia (forma bezosobowa, droga podania, dawkowanie).
 * „Podaje” i „podał” tylko z celownikiem („podaje mu insulinę”), bo „podał adres” to co innego.
 */
const RX_DRUG_VERB = String.raw`(?:(?:włączył(?:a)?|włączono|ordynował(?:a)?|ordynowano|zalecił(?:a)?|zalecono|przepisał(?:a)?|przepisano|odstawił(?:a)?|odstawiono|podano|podawano)(?:[ \t]+${DRUG_DATIVE})?|(?:podaj(?:e|ę)|podawał(?:a)?|podał(?:a)?)[ \t]+${DRUG_DATIVE}|(?:wypisał(?:a)?|wypisano|przepisał(?:a)?|przepisano|wystawił(?:a)?|wystawiono)(?:[ \t]+${DRUG_DATIVE})?[ \t]+(?:e-?)?recept(?:ę|y)[ \t]+na)`;
/** Rzeczownik czynności między zleceniem a lekiem („zalecono przyjmowanie sertraliny”, „kontynuację leczenia pantoprazolem”). */
const RX_NOMINAL = String.raw`(?:[ \t]+(?:przyjmowanie|stosowanie|zażywanie|podawanie|włączenie|odstawienie|leczenie|kontynuacj[ęa](?:[ \t]+(?:leczenia|przyjmowania|stosowania))?|(?:zmniejszenie|zwiększenie|zmian[ęa])[ \t]+dawki))?`;
/**
 * Okolicznik między czasownikiem a lekiem: przysłówek po budowie (-nie, -wo, -ej, -ie: „regularnie”,
 * „wcześniej”, „obecnie”, „domięśniowo”), droga podania („s.c.”), określenie czasu i imiesłów
 * zlecenia („przepisanej”, „zaleconą”, „dotychczasowe”), najwyżej dwa. Sam lek dalej musi mieć kształt leku.
 */
const DRUG_ADV = String.raw`(?:[ \t]+(?:${ROUTE}|(?:też|także|również|nadal|wciąż|stale|już|jeszcze|dalej|ponownie|od[ \t]+(?:roku|lat|miesięcy|dawna)|na[ \t]+stałe|(?!nie(?![${LETTER}]))[${LO}]{2,16}(?:nie|wo|ej|ie)|(?:przepisan|zalecon|zlecon|dotychczasow|ordynowan)[${LO}]{1,3}|sw(?:ój|oje|oich|oją|oim|ego|ej))(?![${LETTER}]))){0,2}`;
/**
 * Wcześniejsze pozycje wyliczenia przed lekiem („przyjmuje kwas foliowy i lewotyroksynę”, „bierze
 * sertralinę, lamotryginę i insulinę”), najwyżej dwie. Przecinek kończy też zdanie składowe („Uczeń
 * otrzymał pochwałę, penicylina była tematem referatu”), więc po przecinku można pominąć tylko pozycję
 * o kształcie leku albo pierwszą pozycję wyliczenia „A, B i lek”. Dowolny wyraz tylko przed spójnikiem.
 */
const LIST_WORD = String.raw`[${LETTER}]{2,20}(?:[ \t]+[${LO}]{2,20})?`;
const LIST_SHAPE = `(?:${DRUG_NAME}|${INN_WORD}|${INSULIN_WORD}|${INSULIN_ALONE}|${DRUG_CLASS})`;
const LIST_CONJ = String.raw`[ \t]+(?:i|oraz|lub|albo)[ \t]+`;
const DRUG_LIST_SKIP = String.raw`(?:${LIST_WORD}[ \t]*,[ \t]*${LIST_WORD}${LIST_CONJ}|(?:${LIST_SHAPE}(?:[ \t]*,[ \t]*|${LIST_CONJ})|${LIST_WORD}${LIST_CONJ}){0,2})`;
/**
 * Orzeczenie tuż po leku: lek jest podmiotem nowego zdania („statyny są w szafce”, „sertralina jest
 * omawiana”, „penicylina była tematem”, „X odmówiła”), a nie dopełnieniem czasownika przyjmowania.
 * Łącznik, czasownik modalny, „się”, czas przeszły po budowie (-ł, -ła, -ło, -ły) i teraźniejszy na -uje.
 */
const PRED_AFTER = String.raw`[ \t]+(?:(?:nie|też|także|również|już|zaś|natomiast|wtedy|potem|teraz)[ \t]+)?(?:jest|są|był|była|było|byli|były|będzie|będą|bywa|bywają|zostaje|zostają|zostanie|zostaną|ma|mają|wie|wiedzą|może|mogą|musi|muszą|powin(?:ien|na|no|ny)|się|stanowi|stanowią|[${LO}]{3,}(?:ł|ła|ło|ły|uje|ują))(?![${LETTER}])`;
const RE_BARE_DRUG = new RegExp(
  String.raw`(${NOT_LETTER_BEFORE}(?:(${SELF_DRUG_VERB})|(${RX_DRUG_VERB}))(?![ \t]+się)${RX_NOMINAL}${DRUG_ADV}[ \t]+(${DRUG_LIST_SKIP}))(${BARE_DRUG}(?:${DRUG_FORM}[ \t]+${DOSE}${DOSING}|${DOSING_REQ})?)(?![${LETTER}\d])(?!${PRED_AFTER})`,
  'gi',
);

const RE_LIST_SHAPE = new RegExp(LIST_SHAPE, 'gi');
const RE_BARE_SHAPE = new RegExp(`^(?:${DRUG_NAME}|${INSULIN_WORD}|${INSULIN_ALONE}|${INN_WORD}|${DRUG_CLASS}|${DRUG_DEVICE})`, 'i');
const RE_FORM_TRADE = new RegExp(`^${DRUG_FORM_NOUN}[ \\t]+(?=[${UP}])`, 'i');
const RE_FORM_TRADE_CS = new RegExp(`^${DRUG_FORM_NOUN}[ \\t]+[${UP}]`);
const RE_ZAZYWA = /^zażyw/i;
/** Zlecenie w zapisie karty: forma bezosobowa („włączono”, „odstawiono”), z której nie wynika lekarz jako podmiot zdania. */
const RE_ROUTE_BEFORE = new RegExp(String.raw`[ \t](?:${ROUTE})[ \t]+$`);
const RE_RX_IMPERSONAL = /^(?:włączono|ordynowano|zalecono|przepisano|odstawiono|podano|podawano|wypisano|wystawiono)/i;
const RE_RX_DATIVE = new RegExp(String.raw`[ \t]${DRUG_DATIVE}(?![${LETTER}])`, 'i');
const RE_DOSING_IN = new RegExp(String.raw`(?<![${LETTER}])(?:\d|${DOSING_ITEM})`, 'i');

/**
 * Lek bez dawki przy czasowniku przyjmowania albo zlecenia: substancja o kształcie nazwy leku
 * („Chłopiec przyjmuje metylofenidat”, „lekarz włączył klozapinę”), insulina („brała insulinę”),
 * grupa leków („przyjmuje leki przeciwdepresyjne”) i nazwa handlowa po postaci leku („zażywa
 * tabletki Relanium”). Czasownik bez leku („przyjmuje interesantów”, „bierze udział”, „zalecono
 * uzupełnienie wniosku”, „stosuje się przepisy”) zostaje, tak samo cennik, przykład i reguła ogólna.
 */
/** Szybkie sito: bez czasownika przyjmowania albo zlecenia przebieg nie ma czego szukać (długie pisma, JSON). */
const RE_BARE_VERB_QUICK = /przyjm|przyj[ąę]|zażyw|zażył|stosu|stosow|bier|bior|brał|brać|otrzym|dosta|jest|był|pozostaje|włącz|ordyn|zalec|przepis|odstaw|podan|podaw|podaj|poda[łl]|wypis|wystaw|przesta|zaczą|zaczę|zaczyna|odm[aó]w|zaprzesta/i;

/**
 * Miejsce albo ramy działania w miejscowniku („w szpitalu”, „na oddziale”, „w programie”, „w badaniu
 * klinicznym”, „w placówce”, „w DPS”): forma bezosobowa w takim zdaniu opisuje praktykę instytucji
 * (kontrola NIK, sprawozdanie, badanie), a nie zlecenie dla pacjenta.
 */
const RE_INSTITUTION_LOC = new RegExp(
  `${NOT_LETTER_BEFORE}(?:w|we|na)[ \\t]+(?:(?:tym|tej|naszym|naszej|całym|całej|każdym|każdej|[${LO}]{3,}(?:ym|ej))[ \\t]+)?` +
    `(?:szpital(?:u|ach)|oddzia(?:le|łach)|klini(?:ce|kach)|przychodni(?:ach)?|poradni(?:ach)?|placów(?:ce|kach)|ośrod(?:ku|kach)|zakład(?:zie|ach)|jednost(?:ce|kach)|hospicj(?:um|ach)|DPS|ZOL|SOR|izbie[ \\t]+przyjęć|programie|programach|badaniu|badaniach|projekcie|grupie|populacji|kohorcie)${NOT_LETTER_AFTER}`,
  'i',
);
/** Forma bezosobowa bez odbiorcy w celowniku i bez osoby w zdaniu, w zdaniu o miejscu albo ramach działania. */
function impersonalAtInstitution(text: string, starts: number[], rx: string, from: number, to: number): boolean {
  if (!mtest(RE_RX_IMPERSONAL, rx) || mtest(RE_RX_DATIVE, rx)) return false;
  const sentence = sentenceAt(text, starts, from, to);
  if (hasPerson(sentence) || namePairAt(sentence) >= 0) return false;
  return mtest(RE_INSTITUTION_LOC, sentence);
}

/** Wspólne odrzucenia leku bez dawki: cennik, przykład, instrukcja i tekst ogólny bez osoby. */
function bareDrugRejected(whole: string, starts: number[], offset: number, from: number, to: number): boolean {
  const sentence = sentenceAt(whole, starts, from, to);
  if (mtest(RE_PRICE, sentence) || mtest(RE_DRUG_EXAMPLE_BEFORE, whole.slice(Math.max(0, offset - 80), offset))) return true;
  if (mtest(RE_DRUG_GENERAL, sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0) return true;
  return generalDrug(whole, starts, from, to);
}

function maskBareDrugs(ctx: RedactCtx, mask: string): void {
  if (!mtest(RE_BARE_VERB_QUICK, ctx.text)) return;
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(
    RE_BARE_DRUG,
    (m: string, pre: string, self: string | undefined, rx: string | undefined, skip: string, drug: string, offset: number, whole: string) => {
      const from = offset + pre.length;
      const to = from + drug.length;
      const shaped = mtest(RE_BARE_SHAPE, drug);
      // Nazwa handlowa po postaci leku („tabletki Relanium”): kształt „postać + wielka litera” nie jest
      // walidacją („kapsułki Nespresso”, „tabletki Mentos”, „lek Ministerstwa”). Liczy się nazwa ze
      // słownika albo o kształcie substancji, a bez niej kotwica medyczna w oknie, nie sama osoba.
      // Po „zażywa” (czasownik właściwie tylko lekowy) nazwa z wielkiej litery wystarcza przy osobie.
      const zazywa = self !== undefined && mtest(RE_ZAZYWA, self);
      let needMedical = false;
      if (!shaped) {
        const trade = mtest(RE_FORM_TRADE_CS, drug);
        if (!trade && !(zazywa && mtest(RE_UP_START, drug))) return m;
        if (trade && !zazywa && !mtest(RE_BARE_SHAPE, drug.replace(RE_FORM_TRADE, ''))) needMedical = true;
      }
      if (bareDrugRejected(whole, starts, offset, from, to)) return m;
      // Droga podania tuż przed lekiem („zalecono mu doustnie amoksycylinę”) należy do zlecenia i znika z lekiem.
      const route = RE_ROUTE_BEFORE.exec(pre);
      const lead = route ? pre.slice(0, route.index + 1) : pre;
      // Wcześniejsze pozycje wyliczenia o kształcie leku („bierze sertralinę, lamotryginę i insulinę”) znikają razem z ostatnią.
      const hit = (): string => {
        const listed = skip && lead === pre ? `${lead.slice(0, lead.length - skip.length)}${skip.replace(RE_LIST_SHAPE, () => ctx.hit('ZDROWIE'))}` : lead;
        return `${listed}${ctx.hit('ZDROWIE')}`;
      };
      if (needMedical) return medicalAnchored(whole, starts, from, to, mask) ? hit() : m;
      if (self) {
        const kind = eventSubject(whole, starts, offset, from);
        if (kind === 'other' || kind === 'name') return m;
        // „chcą, żeby brała insulinę”: liczba mnoga w zdaniu nadrzędnym to lekarze, lek bierze osoba z zakrytą chorobą obok
        return eventAnchor(whole, starts, from, to, mask, true) || medicalAnchored(whole, starts, from, to, mask) ? hit() : m;
      }
      // Zlecenie w zapisie karty: forma bezosobowa, odbiorca w celowniku, droga podania albo dawkowanie
      // przy leku o kształcie substancji („Włączono enoksaparynę s.c.”, „Odstawiono klonazepam”,
      // „Lekarz ordynował furosemid dożylnie”). To ta sama reguła co przy leku z dawką.
      if (rx && shaped && (mtest(RE_RX_IMPERSONAL, rx) || mtest(RE_RX_DATIVE, rx) || mtest(RE_ROUTE, pre) || mtest(RE_DOSING_IN, drug.slice(1)))) {
        const kind = eventSubject(whole, starts, offset, from);
        if (kind !== 'other' && !impersonalAtInstitution(whole, starts, rx, from, to)) return hit();
      }
      return eventAnchor(whole, starts, from, to, mask) || medicalAnchored(whole, starts, from, to, mask) ? hit() : m;
    },
  );
}

/**
 * Szyk z dopełnieniem przed czasownikiem („Kwetiapinę przyjmuje od roku”, „Leki przeciwdepresyjne
 * bierze od dwóch lat”): lek o kształcie substancji albo grupa leków i czasownik przyjmowania osoby.
 * „Kwetiapinę przyjmuje się wieczorem” i podmiot w liczbie mnogiej zostają. Szukamy od czasownika
 * wstecz (najwyżej 100 znaków), żeby nie sprawdzać kształtu leku przy każdym wyrazie pisma.
 */
const RE_SELF_VERB_AT = new RegExp(String.raw`(?<![${LETTER}])(?:${SELF_DRUG_VERB})(?![ \t]+się)(?![${LETTER}])`, 'gi');
const RE_DRUG_BEFORE_VERB = new RegExp(String.raw`(${DRUG_NAME}|${INSULIN_WORD}|${INN_WORD}|${DRUG_CLASS})(?:${DRUG_ADV})[ \t]+$`, 'i');
const RE_POST_SUBJECT = new RegExp(
  `^[ \\t]+(?:(?:każd|większoś|wiel(?:e|u)|wszys|niektór|część|połow|kilk|coraz|około|ponad|prawie|blisko)${L}|co[ \\t]+[${LO}]+[iy]|\\d|pacjenci|chorzy|ludzie|osoby|dzieci|kobiety|mężczyźni|seniorzy|Polacy|szpital${L}|aptek${L}|przychodni${L}|poradni${L}|oddział${L}|NFZ|firm${L}|placówk${L}|ośrod${L})(?![${LETTER}])`,
  'i',
);
function maskDrugFirst(ctx: RedactCtx, mask: string): void {
  if (!mtest(RE_BARE_VERB_QUICK, ctx.text)) return;
  const text = ctx.text;
  const starts = sentenceStarts(text);
  const cuts: [number, number][] = [];
  RE_SELF_VERB_AT.lastIndex = 0;
  for (let v = RE_SELF_VERB_AT.exec(text); v; v = RE_SELF_VERB_AT.exec(text)) {
    const lo = Math.max(0, v.index - 100);
    const d = RE_DRUG_BEFORE_VERB.exec(text.slice(lo, v.index));
    if (!d) continue;
    const from = lo + d.index;
    const to = from + d[1].length;
    if (cuts.length > 0 && from < cuts[cuts.length - 1][1]) continue;
    if (bareDrugRejected(text, starts, from, from, to)) continue;
    // Podmiot przed lekiem: instytucja („Szpital kwetiapinę stosuje…”) odpada, osoba albo podmiot domyślny zostaje.
    const kind = eventSubject(text, starts, from, from);
    if (kind === 'other' || kind === 'name') continue;
    const end = v.index + v[0].length;
    // Podmiot po czasowniku („Statyny przyjmuje co trzeci Polak”, „Leki wydaje apteka”): grupa albo instytucja.
    if (mtest(RE_POST_SUBJECT, text.slice(end, end + 60))) continue;
    if (eventAnchor(text, starts, from, end, mask, true) || medicalAnchored(text, starts, from, end, mask)) cuts.push([from, to]);
  }
  if (cuts.length === 0) return;
  let out = '';
  let pos = 0;
  for (const [a, b] of cuts) {
    out += `${text.slice(pos, a)}${ctx.hit('ZDROWIE')}`;
    pos = b;
  }
  ctx.text = out + text.slice(pos);
}

/** Grupa leków bez czasownika przy kotwicy medycznej („zasiłek na zakup leków przeciwpadaczkowych po wypisie ze szpitala”). */
const RE_DRUG_CLASS = new RegExp(DRUG_CLASS, 'gi');
/** Obrót lekami, a nie leczenie: kradzież, sprzedaż, dostawa, hurtownia, przemyt, posiadanie, refundacja. */
const RE_DRUG_TRADE_BEFORE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:kradzież${L}|ukradł${L}|sprzedaż${L}|sprzedawa${L}|dostaw${L}|hurtowni${L}|przemyt${L}|obrot${L}|obrót|posiadani${L}|magazyn${L}|wydawani${L}|przetarg${L}|refundacj${L}|produkcj${L}|reklam${L})(?:[ \\t]+[${LO}]+){0,3}[ \\t]+$`,
  'i',
);

const RE_DRUG_CLASS_QUICK =
  /lek|środk|preparat|tablet|kapsuł|krop|syrop|zastrzyk|neuroleptyk|antydepresant|cytostatyk|antybiotyk|antypsychotyk|anksjolityk|antykoagulant|kortykosteroid|steryd|statyn|opioid|benzodiazepin|metadon|buprenorfin/i;

function maskDrugClasses(ctx: RedactCtx, mask: string): void {
  if (!mtest(RE_DRUG_CLASS_QUICK, ctx.text)) return;
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_DRUG_CLASS, (m: string, offset: number, whole: string) => {
    const to = offset + m.length;
    const sentence = sentenceAt(whole, starts, offset, to);
    const head = whole.slice(Math.max(0, offset - 70), offset);
    if (mtest(RE_PRICE, sentence) || mtest(RE_DRUG_EXAMPLE_BEFORE, head) || mtest(RE_DRUG_TRADE_BEFORE, head) || mtest(RE_DX_TOPIC, head)) return m;
    // Sama osoba w zdaniu nie wystarcza („kradzież leków psychotropowych przez Jana Kowalskiego”): potrzebna kotwica
    // medyczna. Zdanie o grupie („pacjenci często otrzymują…”, „wynika z raportu”) zostaje mimo kotwicy.
    if (generalDx(whole, starts, offset, offset, to) || generalDrug(whole, starts, offset, to)) return m;
    return medicalAnchored(whole, starts, offset, to, mask) ? ctx.hit('ZDROWIE') : m;
  });
}

/**
 * Kolejny lek w wyliczeniu po zakrytym leku („na [lek] i glarginie”, „[lek], metadon”): wyliczenie
 * dziedziczy kotwicę poprzedniej pozycji. Lek tuż po zakrytym leczeniu („jest [leczona] lamotryginą”)
 * należy do tej samej frazy i znika razem z nią, tak samo lek po przysłówku w wyliczeniu („[lek], obecnie
 * duloksetynę”). Tylko wyraz o kształcie leku, nie dowolny rzeczownik.
 */
function maskDrugAfterMask(ctx: RedactCtx, mask: string): void {
  const shape = `(?:${DRUG_NAME}|${INSULIN_WORD}|${INSULIN_ALONE}|${INN_WORD}|${DRUG_CLASS})`;
  // Lek z orzeczeniem tuż po nim to podmiot nowego zdania („[astma], sertralina jest omawiana”), nie wyliczenie.
  const reJoin = new RegExp(String.raw`${escapeRe(mask)}[ \t]+${shape}(?!${PRED_AFTER})`, 'g');
  ctx.text = ctx.text.replace(reJoin, mask);
  const re = new RegExp(
    String.raw`(${escapeRe(mask)}(?:[ \t]*,[ \t]*|[ \t]*\([ \t]*|[ \t]+(?:i|oraz|lub|albo|a[ \t]+także)[ \t]+)(?:na[ \t]+)?(?:(?:teraz|potem|też|także|również|[${LO}]{2,16}(?:nie|wo|ej))[ \t]+)?)(${shape})(?!${PRED_AFTER})`,
    'g',
  );
  for (let round = 0; round < 3; round++) {
    const before = ctx.text;
    ctx.text = ctx.text.replace(re, (_m: string, pre: string) => `${pre}${ctx.hit('ZDROWIE')}`);
    if (ctx.text === before) break;
  }
}

/**
 * Lek w zdaniu angielskim pisma dwujęzycznego („The patient is taking sertraline”, „He is on
 * antidepressants”): czasownik przyjmowania, lek o kształcie substancji albo grupa leków i osoba
 * w zdaniu (enAnchor). Zdanie ogólne („Patients are often prescribed…”) zostaje.
 */
const EN_DRUG_CLASS = `(?:anti(?:depressants?|psychotics?|epileptics?|convulsants?|coagulants?|biotics?|retrovirals?|histamines?)|benzodiazepines?|opioids?|steroids?|corticosteroids?|neuroleptics?|sedatives?|sleeping[ \\t]+pills|painkillers?|methadone|methylphenidate|insulin(?:[ \\t]+injections)?|chemotherapy)`;
const RE_EN_DRUG = new RegExp(
  String.raw`((?<![A-Za-z])(?:(?:is|was|has[ \t]+been|have[ \t]+been|had[ \t]+been)[ \t]+(?:taking|on|prescribed|receiving|given|started[ \t]+on|treated[ \t]+with)|takes|took|receives|received|uses|prescribed)[ \t]+(?:(?:daily|regularly|currently|also|still|now)[ \t]+)?)(${EN_DRUG_CLASS}|${DRUG_NAME}|${INN_WORD})(?![A-Za-z])`,
  'gi',
);
function maskEnglishDrugs(ctx: RedactCtx): void {
  if (!/(?:taking|prescribed|receiv|takes|took|given|uses|is on|was on)/i.test(ctx.text)) return;
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_EN_DRUG, (m: string, pre: string, drug: string, offset: number, whole: string) => {
    const from = offset + pre.length;
    return enAnchor(whole, starts, from, from + drug.length) ? `${pre}${ctx.hit('ZDROWIE')}` : m;
  });
}

/* ── Rozpoznanie spoza listy fraz: kotwica rozpoznania i fraza do końca ── */

/**
 * Kotwica choroby z listy fraz i z budowy słowa: medyczna jak dotąd, osoba przy zdarzeniu („Pani
 * Nowak ma nadciśnienie tętnicze”, „syn ma autyzm”) albo osoba i słownictwo medyczne obok („dzwonili
 * ze szpitala, babcię wypisują… udar niedokrwienny”). Reguła ogólna, statystyka, warunek i podmiot
 * w populacji („Wiele osób choruje na…”) zostają jawne.
 */
function diseaseAnchor(text: string, starts: number[], from: number, to: number, mask: string): boolean {
  if (generalDx(text, starts, from, from, to)) return false;
  if (medicalAnchored(text, starts, from, to, mask)) return true;
  const sentence = sentenceAt(text, starts, from, to);
  if (isGenericRule(sentence) || populationSubject(text, starts, from)) return false;
  // choroba jako temat („artykuł o nadciśnieniu”, „referat o chorobie Alzheimera”, „szczepienia na COVID-19”)
  const head = text.slice(Math.max(0, from - 70), from);
  if ((topicBefore(text, from, text.slice(from, to)) || mtest(RE_DX_TOPIC, head)) && !mtest(RE_OWNER_AFTER, text.slice(to, to + 40))) return false;
  // „Mam umiarkowany niedosłuch”, „ma przewlekłą chorobę nerek”: czasownik osoby przed określeniem stopnia
  const lead = RE_SEV_TAIL.exec(text.slice(Math.max(0, from - 40), from))?.[0].length ?? 0;
  const self =
    (selfFrame(text, from - lead) || mtest(RE_DEVICE_VERB, text.slice(Math.max(0, from - lead - 30), from - lead))) &&
    eventSubject(text, starts, from, to) !== 'other';
  if (eventAnchor(text, starts, from, to, mask, self)) return true;
  return medicalPersonContext(text, starts, from, to);
}
/** Choroba jako temat wypowiedzi, nauki albo działania dla wszystkich („lekcja o cukrzycy”, „izolacja przy COVID-19”). */
const RE_DX_TOPIC = new RegExp(
  `${NOT_LETTER_BEFORE}(?:artykuł|referat|lekcj|wykład|prelekcj|prezentacj|konferencj|szkoleni|kurs|webinar|broszur|ulotk|poradnik|kampani|szczepie|szczepionk)${L}` +
    `(?:[ \\t]+(?!${PERSON_WORD}(?![${LETTER}]))(?:[${LO}]{3,}|z|ze|w|we|o|na|do|u|po|przy)){0,3}[ \\t]+$`,
  'i',
);
/** Określenia stopnia tuż przed nazwą („umiarkowany ”, „przewlekłą ”), pomijane przy szukaniu czasownika osoby. */
const RE_SEV_TAIL = new RegExp(`(?:(?<![${LETTER}])(?:przewlekł|ostr|zaawansowan|ciężk|lekk|umiarkowan|znaczn|głębok|wrodzon|obustronn|jednostronn)${L}[ \\t]{1,4}){1,2}$`, 'i');
/** Używanie urządzenia medycznego przez osobę („noszę aparaty słuchowe”, „używa aparatu”). */
const RE_DEVICE_VERB = new RegExp(`${NOT_LETTER_BEFORE}(?:nosz(?:ę|e)|nosi|nosił${L}|używa(?:m)?|używał${L})[ \\t]{1,4}$`, 'i');
/**
 * Zespół z nazwiskiem albo choroba z określeniem: imię po „zespół” („zespół Piotra Kosa”) to zespół
 * ludzi tej osoby, a nie zespół chorobowy.
 */
function namedAnchor(text: string, starts: number[], from: number, to: number, mask: string): boolean {
  const last = /([\p{Lu}][\p{Ll}'’é]+)$/u.exec(text.slice(from, to))?.[1];
  if (last && /^zesp/i.test(text.slice(from, to)) && isGivenName(last)) return false;
  if (mtest(RE_ZESP_EPONYM, text.slice(from, to)) && !eponymLead(text, from, to)) return false;
  return diseaseAnchor(text, starts, from, to, mask);
}
/**
 * Nazwa choroby po budowie słowa z przymiotnikiem spoza medycyny tuż po niej to przenośnia albo
 * technika („anemia inwestycyjna”, „sepsa finansowa”); medyczny zostaje („anemia złośliwa”, „grypa
 * żołądkowa”, „retinopatia cukrzycowa”).
 */
function morphAnchor(text: string, starts: number[], from: number, to: number, mask: string): boolean {
  const next = /^[ \t]{1,4}([a-ząćęłńóśźż]+)/.exec(text.slice(to, to + 40))?.[1];
  if (next && (mtest(RE_ADJ_OBL_W, next) || mtest(RE_ADJ_NOM_W, next) || /[a-ząćęłńóśźż]{3,}(?:ną|wą|ową|cą|ką|tą)$/.test(next)) && !mtest(RE_VERB_W, next) && !mtest(RE_MED_W, next)) return false;
  return diseaseAnchor(text, starts, from, to, mask);
}
/** Osoba i słownictwo medyczne w oknie, w zdaniu, które nie jest przepisem, statystyką, warunkiem ani pytaniem. */
function medicalPersonContext(text: string, starts: number[], from: number, to: number): boolean {
  const sentence = sentenceAt(text, starts, from, to);
  if (mtest(RE_NORMATIVE, sentence) || mtest(RE_STATS, sentence) || mtest(RE_QUESTION, sentence)) return false;
  if (mtest(RE_IF, sentenceHead(text, starts, from)) || mtest(RE_GENERIC_BEFORE, text.slice(Math.max(0, from - 80), from))) return false;
  if (providerRel(sentenceHead(text, starts, from)) || eventSubject(text, starts, from, to) === 'other') return false;
  const w = personWindow(text, from, to);
  if (!hasMedVocab(w)) return false;
  // osoba z nazwy (poza urzędnikiem i lekarzem) tylko w tym samym zdaniu; rola, krewny i zaimek w oknie;
  // samo „pacjent” tylko poza regulaminem
  const patient = mtest(RE_PATIENT_WORD, w) && !mtest(RE_NORMATIVE, w);
  return patientNamed(sentence).length > 0 || mtest(RE_PERSON_THIRD, w) || mtest(RE_EV_PERSON, w) || patient;
}

/** Określenie stopnia, przebiegu i rodzaju przy nazwie choroby („ostrej”, „nawracającej”, „prawostronnym”). */
const DX_SEV = `(?:przewlekł|ostr|zaawansowan|ciężk|lekk|umiarkowan|znaczn|głębok|wrodzon|nabyt|nawracając|postępując|łagodn|złośliw|samoistn|pierwotn|wtórn|obustronn|jednostronn|prawostronn|lewostronn|mieszan|rozwojow|dziecięc|wczesnodziecięc|atypow|niedokrwienn|krwotoczn|limfoblastyczn|szpikow|rozsian|zaostrzon|utrwalon|napadow|nadciśnieniow|cukrzycow|alergiczn|atopow|ciążow|insulinozależn|insulinoniezależn|oddechow|moczow|bakteryjn|wirusow|odbiorcz|przewodzeniow|obturacyjn|rumieniow|układow|ropn|sezonow|żołądkow|jelitow|pokarmow|skórn|płucn|stawow)${L}`;
const RE_SEV_W = new RegExp(`^(?:${DX_SEV})$`, 'i');
const RE_MORPH_W = new RegExp(`^(?:${DX_MORPH})$`, 'i');
const RE_ACR_W = new RegExp(`^(?:${DX_ACRONYM})$`);
const RE_EPONYM_W = new RegExp(`^${EPONYM}$`);
/** Nazwa wymagająca określenia medycznego: „choroba”, „zaburzenia”, „zespół”, „wada”. */
const RE_HEAD_MOD_W = /^(?:chor(?:ob[a-ząćęłńóśźż]*|ób)|zaburze[a-ząćęłńóśźż]*|zesp(?:ół|o[lł][a-ząćęłńóśźż]*)|wad(?:a|y|ę|ą|zie))$/i;
/** Nazwa wymagająca narządu albo części ciała: uraz, uszkodzenie, niewydolność, zapalenie, guz („uszkodzenie dachu” zostaje). */
const RE_HEAD_BODY_W =
  /^(?:uszkodzeni|pęknięci|zerwani|naderwani|złamani|stłuczeni|zwichnięci|skręceni|oparzeni|wstrząśnieni|uraz|niewydolnoś|zapaleni|zwężeni|niedomykalnoś|przerost|guz|torbiel|przepuklin|infekcj|zakażeni)[a-ząćęłńóśźż]*$/i;
/** Objaw zgłaszany przez osobę („skarży się na bóle kręgosłupa”) i zdarzenie po „stan po” („stan po udarze”). */
const RE_HEAD_SYMPTOM_W = /^(?:ból|bóle|bólu|bólem|bólami|bólów|dolegliwoś[a-ząćęłńóśźż]*|dusznoś[a-ząćęłńóśźż]*|zawrot[a-ząćęłńóśźż]*|nudnoś[a-ząćęłńóśźż]*|wymiot[a-ząćęłńóśźż]*|gorączk[a-ząćęłńóśźż]*|kaszel|kaszl[a-ząćęłńóśźż]*|krwawieni[a-ząćęłńóśźż]*|drętwieni[a-ząćęłńóśźż]*|obrzęk[a-ząćęłńóśźż]*|udar[a-ząćęłńóśźż]*|zawał[a-ząćęłńóśźż]*)$/i;
const RE_HEAD_ALLERGY_W = /^(?:alergi|uczuleni|nietolerancj)[a-ząćęłńóśźż]*$/i;
const RE_ALLERGEN_W = new RegExp(`^(?:${ALLERGEN}|pokarmow)[${LO}]*$`, 'i');
/** Wyraz medyczny w dalszej części frazy: narząd, część ciała, dziedzina, określenie choroby. */
const RE_MED_W = new RegExp(
  `^(?:${ANATOMY}|(?:${ORGAN})[${LO}]*|[${LO}]*(?:${MED_STEM})[${LO}]*|${DX_SEV}|${CHOR_MOD}|${ZESP_MOD}|powikłan${L}|przemieszczeni${L}|zaostrzeni${L}|niedowład${L}|obu|lewej|prawej|lewego|prawego|ręki|nogi|karku|brzucha|pleców|gardła|spojówek|mięśni|nerwu|krzyżow${L})$`,
  'i',
);
const RE_ADJ_OBL_W = new RegExp(`^[${LO}]{3,}(?:ej|ego|ych|ymi|ym|ich|imi|im)$`);
const RE_ADJ_NOM_W = new RegExp(`^[${LO}]{3,}(?:n|w|t|ł|l|r|cz|sk|ck)(?:y|a|e)$`);
const RE_VERB_W = /(?:ywa|iwa|awa|ała|iła|yła|ęła|ąła|eła|uje|ują|ał|ił|ył)$/;
/** Dopełniacz techniczny po części ciała („ramienia dźwigu”, „stopy fundamentowej”): to nie uraz. */
const RE_TECH_W = new RegExp(`^${TECH_AFTER.slice('(?![ \\t]+'.length, -1)}$`, 'i');
const RE_GEN_W = new RegExp(`^[${LO}]{3,}(?:a|u|y|i|ów|ek)$`);
/** Koniec frazy: spójnik, zaimek względny, czasownik posiłkowy, przyimek okolicznika. */
const RE_DX_STOP_W =
  /^(?:a|ale|lecz|bo|że|iż|któr[a-ząćęłńóśźż]*|gdy|kiedy|jest|są|był[a-ząćęłńóśźż]*|ma|mają|miał[a-ząćęłńóśźż]*|się|nie|od|do|przez|dla|u|po|przy|według|wg|we|ponieważ|gdyż|więc|dlatego|co|jak|to|jednak|także|również|też|już|jeszcze|oraz|i|lub|albo|na|w|z|ze|o|typu|stopnia)$/i;
/** Osoba w dopełniaczu po nazwie choroby („autyzm syna”) należy do osoby, a nie do rozpoznania. */
const RE_PERSON_GEN_W =
  /^(?:syna|córki|dziecka|matki|ojca|męża|żony|babci|dziadka|brata|siostry|pacjenta|pacjentki|ucznia|uczennicy|wnuka|wnuczki|klienta|klientki|pracownika|pracownicy|strony|wnioskodawcy|wnioskodawczyni|małoletniego|małoletniej)$/i;

interface DxTok {
  t: string;
  a: number;
  b: number;
  /** icd: kod albo kod w nawiasie; mask: zakryta już dana o zdrowiu. */
  kind: 'icd' | 'mask' | 'word' | 'num' | 'punct';
  /** Odstęp przed wyrazem: spacje albo jedno łamanie wiersza przed małą literą. */
  gap: boolean;
}
const RE_DX_PIECE = new RegExp(
  String.raw`\[DANE O ZDROWIU\]|\([ \t]*(?:ICD(?:-?1[01])?[ \t]*:?[ \t]*)?${ICD_ANCH}(?:${ICD_SEP}${ICD_ANCH})*[ \t]*\)|${ICD_ANCH}(?![\d${LETTER}])|[${LETTER}][${LETTER}'’]*(?:-[${UP}][${LETTER}'’]*)?|\d{1,2}(?![\d])|\S`,
  'g',
);
const RE_DX_GAP = /^(?:[ \t]{1,4}|[ \t]{0,4}\r?\n[ \t]{0,8})$/;
function dxTokens(s: string, max: number): DxTok[] {
  const out: DxTok[] = [];
  let prev = 0;
  RE_DX_PIECE.lastIndex = 0;
  for (let m = RE_DX_PIECE.exec(s); m && out.length < max; m = RE_DX_PIECE.exec(s)) {
    const gapText = s.slice(prev, m.index);
    const t = m[0];
    const kind = t === '[DANE O ZDROWIU]' ? 'mask' : t.startsWith('(') && t.length > 1 ? 'icd' : ICD_ONLY.test(t) ? 'icd' : /^\d/.test(t) ? 'num' : /^[^\p{L}]/u.test(t) ? 'punct' : 'word';
    const nl = gapText.includes('\n');
    const gap = out.length === 0 ? /^[ \t]{0,4}$/.test(gapText) : mtest(RE_DX_GAP, gapText) && (!nl || /^[a-ząćęłńóśźż(]/.test(t));
    out.push({ t, a: m.index, b: m.index + t.length, kind, gap });
    prev = m.index + t.length;
  }
  return out;
}
type DxHead = 'self' | 'mod' | 'body' | 'allergy' | 'symptom' | 'free';
function dxHeadKind(tok: DxTok, rest: string, free: boolean): DxHead | null {
  if (tok.kind === 'icd' || tok.kind === 'mask') return 'self';
  if (tok.kind !== 'word') return null;
  const w = tok.t;
  if (mtest(RE_ACR_W, w) || mtest(RE_MORPH_W, w) || PHRASE_AT_START.some((re) => re.test(rest))) return 'self';
  // sam „niedorozwój” jest rozpoznaniem tylko po silnej kotwicy przy osobie („rozpoznano u syna niedorozwój”)
  if (free && /^niedorozw(?:ój|oju|ojem)$/i.test(w)) return 'self';
  if (mtest(RE_HEAD_MOD_W, w)) return 'mod';
  if (mtest(RE_HEAD_BODY_W, w)) return 'body';
  if (mtest(RE_HEAD_ALLERGY_W, w)) return 'allergy';
  if (mtest(RE_HEAD_SYMPTOM_W, w)) return 'symptom';
  if (free && /^[a-ząćęłńóśźż]{3,}$/.test(w) && !mtest(RE_DX_STOP_W, w) && !mtest(RE_VERB_W, w)) return 'free';
  return null;
}
const isMedTok = (k: DxTok): boolean =>
  k.kind === 'icd' || (k.kind === 'word' && (mtest(RE_MED_W, k.t) || mtest(RE_MORPH_W, k.t) || mtest(RE_ACR_W, k.t)));

/**
 * Długość frazy rozpoznania od początku s albo 0. Fraza to nazwa choroby (po budowie słowa, skrót,
 * kod, fraza z listy albo nazwa ogólna z określeniem medycznym: „choroba otępienna”, „zespół
 * Aspergera”, „złamanie trzonu kości piszczelowej”) z określeniami i dopowiedzeniem („z zaburzeniami
 * uwagi”, „ze spektrum autyzmu”, „3 stopnia”, „(F84.0)”). Kończy ją znak interpunkcji, spójnik przed
 * czymś, co nie jest chorobą, czasownik albo przyimek okolicznika („od 2023 r.”, „w dzieciństwie”).
 * free: kotwica wskazała osobę („rozpoznano u niej …”), więc nazwa może być spoza budowy słowa.
 * cont: dopowiedzenie po zakrytej już chorobie, bez własnej nazwy, tylko wyrazy medyczne.
 */
function dxSpan(s: string, opts: { free?: boolean; cont?: boolean } = {}): number {
  const toks = dxTokens(s, 18);
  if (toks.some((k, j) => k.kind === 'word' && j > 0 && mtest(RE_TECH_W, k.t) && mtest(RE_MED_W, toks[j - 1].t))) return 0;
  let i = 0;
  let head: DxHead = 'self';
  let end = 0;
  if (!opts.cont) {
    let lead = 0;
    while (i < toks.length && lead < 2 && toks[i].gap && toks[i].kind === 'word' && mtest(RE_SEV_W, toks[i].t) && !dxHeadKind(toks[i], s.slice(toks[i].a), false)) {
      i++;
      lead++;
    }
    const tk = toks[i];
    if (!tk || !tk.gap) return 0;
    const rest = s.slice(tk.a);
    const kind = dxHeadKind(tk, rest, !!opts.free);
    if (!kind) return 0;
    head = kind;
    // fraza z listy na początku: cała do końca dopasowania
    const known = Math.max(0, ...PHRASE_AT_START.map((re) => re.exec(rest)?.[0].length ?? 0));
    end = Math.max(tk.b, tk.a + known);
    while (i + 1 < toks.length && toks[i + 1].b <= end) i++;
    i++;
  }
  // nazwa spoza budowy słowa („toczeń rumieniowaty układowy”) potrzebuje określenia medycznego: „talent muzyczny” nie
  let needMed = head === 'mod' || head === 'body' || head === 'free';
  let freeNext = 0;
  let joined = false;
  let afterHead = false;
  const startI = i;
  for (; i < toks.length && i < startI + 10; i++) {
    const k = toks[i];
    if (!k.gap) break;
    if (k.kind === 'icd' || k.kind === 'mask') {
      end = k.b;
      needMed = false;
      continue;
    }
    if (k.kind === 'punct') break;
    const prevW = toks[i - 1]?.t.toLowerCase() ?? '';
    const next = toks[i + 1];
    if (k.kind === 'num') {
      const nw = next?.t.toLowerCase() ?? '';
      if (/^(?:typu|stopnia|st\.?|stopień)$/.test(prevW) || /^(?:stopnia|st|typu|stopień)$/.test(nw)) {
        end = k.b;
        continue;
      }
      break;
    }
    const w = k.t.toLowerCase();
    if (/^(?:i|oraz|lub|albo)$/.test(w)) {
      if (opts.cont) break;
      // wyliczenie chorób („ADHD i zaburzenia lękowe”), ale nie „autyzm i jest wrażliwy”
      if (!next?.gap || !(dxHeadKind(next, s.slice(next.a), false) || next.kind === 'icd' || next.kind === 'mask')) break;
      joined = true;
      continue;
    }
    if (/^(?:z|ze|o)$/.test(w) || (w === 'na' && head === 'allergy') || (w === 'w' && /^(?:obrębie|przebiegu|stadium)$/i.test(next?.t ?? ''))) {
      if (!next?.gap || (next.kind !== 'word' && next.kind !== 'mask')) break;
      if (opts.cont && next.kind === 'word' && !(isMedTok(next) || dxHeadKind(next, s.slice(next.a), false) || mtest(RE_HEAD_SYMPTOM_W, next.t))) break;
      freeNext = opts.cont ? 0 : 2;
      continue;
    }
    if (/^(?:typu|stopnia)$/.test(w)) {
      if (next?.kind !== 'num' && !(next?.kind === 'word' && /^[IVX]+$|^(?:pierwszego|drugiego|trzeciego|lekkiego|umiarkowanego|znacznego)$/.test(next.t))) break;
      continue;
    }
    if (mtest(RE_DX_STOP_W, w)) break;
    if (/^[\p{Lu}]/u.test(k.t)) {
      const eponym = mtest(RE_EPONYM_W, k.t) && /^zesp/.test(prevW) && !isGivenName(k.t) && !(next?.kind === 'word' && /^[\p{Lu}]/u.test(next.t));
      if (mtest(RE_ACR_W, k.t) || eponym) {
        end = k.b;
        needMed = false;
        continue;
      }
      break;
    }
    if ((joined || opts.cont) && dxHeadKind(k, s.slice(k.a), false)) {
      // kolejna choroba wyliczenia albo nazwa w dopowiedzeniu („z zaburzeniami uwagi”): jej dopełniacz też
      end = k.b;
      joined = false;
      afterHead = true;
      continue;
    }
    if (afterHead && mtest(RE_GEN_W, w) && !mtest(RE_VERB_W, w) && !mtest(RE_PERSON_GEN_W, w)) {
      end = k.b;
      afterHead = false;
      continue;
    }
    afterHead = false;
    if (isMedTok(k) || (head === 'allergy' && mtest(RE_ALLERGEN_W, k.t))) {
      end = k.b;
      needMed = false;
      freeNext = 0;
      continue;
    }
    if (opts.cont) break;
    if (mtest(RE_PERSON_GEN_W, w)) break;
    if ((mtest(RE_ADJ_OBL_W, w) || mtest(RE_ADJ_NOM_W, w)) && !mtest(RE_VERB_W, w)) {
      end = k.b;
      continue;
    }
    // wyraz po „z”, „o” („z opóźnieniem rozwoju mowy”, „o charakterze mieszanym”)
    if (freeNext > 0 && !mtest(RE_VERB_W, w)) {
      end = k.b;
      freeNext--;
      continue;
    }
    // jeden rzeczownik w dopełniaczu tuż po nazwie („ból karku”, „zaburzeń integracji sensorycznej”)
    if (i === startI && mtest(RE_GEN_W, w) && !mtest(RE_VERB_W, w) && head !== 'free') {
      const nx = toks[i + 1];
      const medNext = nx?.gap && nx.kind === 'word' && (isMedTok(nx) || mtest(RE_ADJ_OBL_W, nx.t));
      if (head === 'symptom' || medNext) {
        end = k.b;
        continue;
      }
    }
    break;
  }
  if (needMed || (head === 'allergy' && end <= (toks[startI - 1]?.b ?? 0))) return 0;
  return end;
}

/** Osoba po „u” przy kotwicy rozpoznania („rozpoznano u niej”, „zdiagnozowano u syna Szymona”). */
const DX_PERSON_U = String.raw`u[ \t]{1,4}(?:niego|niej|mnie|nich|nas|pacjent${L}|chor(?:ego|ej)|dziecka|syna|córki|matki|ojca|męża|żony|babci|dziadka|brata|siostry|ucznia|uczennicy|wnioskodaw${L}|ubezpieczon(?:ego|ej)|pozwan(?:ego|ej)|powoda|powódki|małoletni(?:ego|ej)|[${UP}][${LO}]+)(?:[ \t]{1,4}[${UP}][${LO}]+)?`;
/**
 * Kotwica rozpoznania osoby: czasownik rozpoznania („rozpoznano”, „zdiagnozowała”) i imiesłów po „ma”
 * albo „z” („ma rozpoznane ADHD”, „z rozpoznanym autyzmem”, „z rozpoznaniem”). „Rozpoznał oskarżonego”
 * i „ma rozpoznane potrzeby” nie mają po sobie nazwy choroby, więc zostają.
 */
const RE_DX_STRONG = new RegExp(
  String.raw`${NOT_LETTER_BEFORE}(?:rozpozna(?:no|ła|ł|li|ły)|zdiagnozowa(?:no|ła|ł|li|ły)|(?:ma|mam|miał|miała|mają|mieli|posiada)[ \t]{1,4}(?:rozpoznan|zdiagnozowan|stwierdzon)(?:e|y|ą|a|ego|ej|ym|ymi)|(?:z|ze)[ \t]{1,4}(?:rozpoznan|zdiagnozowan)(?:ym|ymi|ą|em)|z[ \t]{1,4}diagnozą|w[ \t]{1,4}wywiadzie)(?![${LETTER}])(?:[ \t]{1,4}(${DX_PERSON_U}))?[ \t]*:?(?=[ \t\n])`,
  'gi',
);
const RE_DX_PERSON_BEFORE = new RegExp(`(?<![${LETTER}])${DX_PERSON_U}[ \\t]{1,4}$`, 'i');
/**
 * Kotwica słabsza: stwierdzenie, podejrzenie, wywiad, objawy, przyczyna, leczenie, skarga na objaw,
 * „stan po”. Fraza musi być nazwą choroby, a zdanie dotyczyć osoby („stwierdzono naruszenie”,
 * „z powodu awarii”, „leczenie nowotworów w Polsce” zostają).
 */
const RE_DX_WEAK = new RegExp(
  String.raw`${NOT_LETTER_BEFORE}(?:stwierdz(?:ono|ił|iła|ili|iły)|stwierdzon(?:o|y|a|e)|podejrzeni(?:e|a|em|u)(?:[ \t]{1,4}(?:o|na))?|objaw(?:y|ami|ów)|z[ \t]{1,4}powodu|ze[ \t]{1,4}względu[ \t]{1,4}na|z[ \t]{1,4}uwagi[ \t]{1,4}na|w[ \t]{1,4}związku[ \t]{1,4}z|w[ \t]{1,4}przebiegu|na[ \t]{1,4}skutek|wskutek|leczeni(?:e|a|u|em)|(?:uskarża|skarży|uskarżał|skarżył)(?:a)?[ \t]{1,4}się[ \t]{1,4}na|stan(?:u|em|ie)?[ \t]{1,4}po|diagnoz(?:a|ę|y|ie)(?:[ \t]{1,4}w[ \t]{1,4}kierunku)?|rozpoznani(?:e|a|em|u))(?![${LETTER}])(?:[ \t]{1,4}(${DX_PERSON_U}))?[ \t]*:?(?=[ \t\n])`,
  'gi',
);

/* ── Rozpoznanie w zdaniu ogólnym: warunek, zdanie względne reguły, kwantyfikator, dane zbiorcze ── */

/**
 * Spójnik zdania podrzędnego przed kotwicą w tym samym członie. Warunek („jeżeli”, „jeśli”, „gdyby”,
 * „o ile”) mówi o przypadku możliwym, chyba że wskazuje osobę z nazwy; „w razie” i „w przypadku”
 * także przy krewnym („W przypadku syna rozpoznano…” to konkretna osoba). „Gdy”, „kiedy” i zaimek
 * względny osoby z rozpoznaniem („u którego”, „u kogo”, „kto”) tylko wtedy, gdy nikt nie jest wskazany
 * wprost, rozpoznanie nie ma sprawcy („która rozpoznała” to lekarka i zdarzenie), a zdanie główne nie
 * opisuje zdarzenia z przeszłości. „Jeżeli chodzi o syna” to wprowadzenie tematu, a nie warunek.
 */
const RE_DX_COND = new RegExp(
  `${NOT_LETTER_BEFORE}(?:(jeżeli|jeśli|gdyby|o[ \\t]+ile)(?![ \\t]+chodzi(?![${LETTER}]))|(w[ \\t]+razie|w[ \\t]+przypadku)|(gdy|kiedy|u[ \\t]+(?:którego|której|których|kogo)|kto))(?![${LETTER}])`,
  'gi',
);
/** Rozpoznanie ze sprawcą („rozpoznała”, „zdiagnozowali”): zdarzenie, a nie reguła. */
const RE_DX_AGENT = new RegExp(`^(?:rozpozna|zdiagnozowa)(?:ła|ł|li|ły)(?![${LETTER}])`, 'i');
/** Granica członu zdania przed kotwicą: przecinek, średnik, dwukropek, myślnik, nawias. */
const RE_DX_CLAUSE_END = /[,;:(–—][^,;:(–—]*$/;
/**
 * Osoba wskazana wprost: krewny, zaimek osobowy, pierwsza osoba autora pisma, zaimek dzierżawczy.
 * Rola („pracownik”, „uczeń”, „pacjent”, „dziecko”) bywa podmiotem przepisu, więc tu się nie liczy.
 */
const RE_DX_CONCRETE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:syn(?:a|owi|em)?|córk(?:a|i|ę|ą|ce)|m(?:ąż|ęża|ężowi|ężem)|żon(?:a|y|ie|ą)|ojc(?:iec|a|u|em)|mat(?:ka|ki|ce|kę|ką)|bra(?:t|ta|tu|tem)|siostr${L}|babci${L}|dziad(?:ek|ka|kowi|kiem)|wnu(?:k|ka|czka|czki)|niego|niej|mnie|mój|moja|moje|mojego|mojej|moim|moją|nasz(?:a|e|ego|ej|ym)?|jestem|mam)${NOT_LETTER_AFTER}|${FIRST_PAST}`,
  'i',
);
/** Osoba z nazwy albo z danych: „Pan Nowak”, imię i nazwisko, zakryty PESEL. */
const namedInSentence = (sentence: string): boolean => mtest(RE_PERSON_CS, sentence) || namePairAt(sentence) >= 0 || mtest(RE_NAMED, sentence);
/** Orzeczenie w czasie przeszłym w zdaniu głównym („rozpoczęliśmy terapię”, „skierowano go”): zdarzenie, a nie reguła. */
const RE_DX_PAST = new RegExp(`[${LO}]{2,}(?:ł|ła|ło|li|ły|łem|łam|łeś|łaś|liśmy|łyśmy)(?![${LETTER}])|[${LO}]{3,}(?:ano|ono|ęto|yto|ito)(?![${LETTER}])`, 'i');
/** Grupa ludzi w liczbie mnogiej tuż przed kotwicą („Osobom z rozpoznaną…”, „dzieci z rozpoznanym…”). */
const RE_DX_GROUP_BEFORE = new RegExp(
  `(?<!(?:dwoje|troje|czworo|pięcioro|moje|moich|nasze|naszych|jej|jego)[ \\t]{1,4})(?<![${LETTER}])${GROUP}(?:[ \\t]{1,4}[${LO}]{3,}(?:ych|ich|ym|im|ymi|imi))?[ \\t]{1,4}$`,
  'i',
);
/** Dane zbiorcze przed nazwą choroby („45 przypadków boreliozy”, „zachorowań na gruźlicę”, „zakażeń HIV”). */
const RE_DX_COUNT_BEFORE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:przypadk(?:ów|i|ach)|zachorowa(?:ń|nia|niach)|zakaże(?:ń|nia)|zgon(?:ów|y)|ognisk(?:a)?|hospitalizacji)(?:[ \\t]{1,4}(?:na|z|ze))?[ \\t]{1,4}$`,
  'i',
);
/**
 * Rola w liczbie pojedynczej, która w przepisie i pouczeniu oznacza każdego takiego człowieka
 * („Pracownik z rozpoznaną…”, „pracownika z…”, „Dziecku z rozpoznanym…”, „osobę z…”). Strony
 * postępowania („wnioskodawca”, „powód”, „małoletni”, „ubezpieczony”) i krewni wskazują konkretną osobę,
 * więc ich tu nie ma.
 */
const DX_RULE_ROLE =
  '(?:pracowni(?:k|ka|kowi|kiem|ca|cy|cę|cą)|kandydat(?:a|owi|em|ka|ki|ce|kę|ką)?|osob(?:a|y|ie|ę|ą)|ucz(?:eń|nia|niowi|niem)|uczennic(?:a|y|ę|ą)|' +
  'dzieck(?:o|a|iem|u)|pacjent(?:a|owi|em|ka|ki|ce|kę|ką)?|chor(?:y|ego|emu|ym|a|ej|ą)|student(?:a|owi|em|ka|ki|ce|kę|ką)?|kierowc(?:a|y|ę|ą)|' +
  'żołnierz(?:a|owi|em)?|funkcjonariusz(?:a|owi|em)?|świadczeniobiorc(?:a|y|ę|ą)|beneficjent(?:a|owi|em|ka|ki|ce|kę|ką)?|podopieczn(?:y|ego|emu|ym|a|ej|ą)|' +
  'wychowan(?:ek|ka|kowi|kiem)|osadzon(?:y|ego|emu|ym)|klient(?:a|owi|em|ka|ki|ce|kę|ką)?|mieszkan(?:iec|ca|cowi|cem|ka|ki|ce|kę|ką)|' +
  'cudzoziem(?:iec|ca|cowi|cem|ka|ki|ce|kę|ką)|dorosł(?:y|ego|emu|ym)|senior(?:a|owi|em|ka|ki)?)';
/** Rola tuż przed kotwicą „z rozpoznaną”, „z podejrzeniem”, „z” (z jednym przymiotnikiem między nimi). */
const RE_DX_ROLE_BEFORE = new RegExp(
  `(?<![${LETTER}])${DX_RULE_ROLE}(?:[ \\t]{1,4}[${LO}]{3,}(?:y|a|e|ego|ej|emu|ym|ą))?[ \\t]{1,4}(?:z|ze)` +
    `(?:[ \\t]{1,4}(?:(?:rozpoznan|zdiagnozowan|stwierdzon)[${LO}]*|podejrzeniem(?:[ \\t]{1,4}(?:o|na))?|diagnozą))?[ \\t]{0,4}$`,
  'i',
);
/**
 * Orzeczenie reguły: możliwość, uprawnienie, obowiązek, procedura w stronie biernej czasu
 * teraźniejszego („może skorzystać”, „nie może uzyskać”, „ma prawo”, „przysługuje”, „jest przewożony”,
 * „zostaje skierowany”). Stan leczenia osoby („jest hospitalizowany”, „jest leczony”) to opis faktu.
 */
const RE_DX_RULE_PRED = new RegExp(
  `${NOT_LETTER_BEFORE}(?:może|mogą|można|musi|muszą|powin(?:ien|na|no|ni|ny)|ma[ \\t]{1,4}prawo|mają[ \\t]{1,4}prawo|przysługuj${L}|należy|zostaje|zostają|` +
    `(?:jest|są)[ \\t]{1,4}(?!(?:hospitaliz|obserwow|monitorow|diagnozow|konsultow|rehabilitow|lecz)[${LO}]*)[${LO}]{3,}(?:ywan|iwan|owan|awan|żon|szon)(?:y|a|e|i))(?![${LETTER}])`,
  'i',
);
/**
 * Przepis o roli w liczbie pojedynczej („Pracownik z rozpoznaną depresją może skorzystać z urlopu”,
 * „Pracodawca może skierować pracownika z rozpoznaną depresją…”, „Pacjent z podejrzeniem udaru jest
 * przewożony na SOR”): rola tuż przed kotwicą i orzeczenie reguły przed nią albo zaraz za frazą w tym
 * samym członie. Osoba z nazwy, krewny i pierwsza osoba robią z tego fakt o konkretnej osobie.
 */
function roleRule(text: string, s0: number, sEnd: number, a: number, b: number, sentence: string): boolean {
  if (!mtest(RE_DX_ROLE_BEFORE, text.slice(Math.max(s0, a - 80), a))) return false;
  if (namedInSentence(sentence) || mtest(RE_DX_CONCRETE, sentence)) return false;
  if (mtest(RE_DX_RULE_PRED, text.slice(s0, a))) return true;
  const tail = text.slice(b, sEnd);
  const w = RE_DX_RULE_PRED.exec(tail);
  return !!w && !mtest(RE_COORD, tail.slice(0, w.index));
}
/**
 * Rozpoznanie w zdaniu ogólnym, a nie fakt o konkretnej osobie: warunek i zdanie względne reguły
 * („Jeżeli u dziecka zdiagnozowano autyzm, rodzice mogą…”, „Uczeń, u którego rozpoznano dysleksję,
 * może…”), kwantyfikator i grupa przed kotwicą („Każdy uczeń z rozpoznanym ADHD…”, „Osobom
 * z rozpoznaną padaczką…”), dane zbiorcze („rozpoznano 312 przypadków gruźlicy”, „według danych
 * NFZ”). at to początek kotwicy, [a, b) to fraza choroby. Wspólny strażnik silnej i słabej kotwicy
 * oraz nazw chorób spoza listy (diseaseAnchor).
 */
function generalDx(text: string, starts: number[], at: number, a: number, b: number): boolean {
  // zdanie przycięte do SPAN znaków z każdej strony, jak w sentenceAt (długi wiersz bez kropek nie jest całym tekstem)
  const si = sentenceIndex(starts, at);
  const s0 = Math.max(starts[si], at - SPAN);
  const sEnd = Math.min(si + 1 < starts.length ? starts[si + 1] : text.length, b + SPAN);
  const sentence = text.slice(s0, sEnd);
  if (mtest(RE_STATS, sentence) || mtest(RE_DX_COUNT_BEFORE, text.slice(Math.max(0, a - 40), a))) return true;
  if (populationSubject(text, starts, at) || mtest(RE_DX_GROUP_BEFORE, text.slice(Math.max(s0, at - 60), at))) return true;
  if (roleRule(text, s0, sEnd, a, b, sentence)) return true;
  // człon z kotwicą: od ostatniej granicy przed kotwicą; spójnik po przecinku („Uczeń, u którego”) należy do członu
  const { clause, cond, caseOf, rel } = dxClause(text.slice(s0, at));
  if (!cond && !caseOf && !rel) return false;
  if (namedInSentence(sentence)) return false;
  if (cond) return true;
  if (mtest(RE_DX_CONCRETE, sentence)) return false;
  if (caseOf) return true;
  if (mtest(RE_DX_AGENT, text.slice(at, at + 20))) return false;
  // zdanie główne: przed członem z kotwicą i po przecinku za frazą
  const rest = text.slice(b, sEnd);
  const comma = rest.search(/[,;–—]/);
  const main = `${text.slice(s0, at - clause.length)} ${comma >= 0 ? rest.slice(comma + 1) : ''}`;
  return !mtest(RE_DX_PAST, main);
}
/** Człon z kotwicą rozpoznania na końcu head i rodzaj spójników w nim (warunek, przypadek, zdanie względne). */
const dxClause = memo((head: string): { clause: string; cond: boolean; caseOf: boolean; rel: boolean } => {
  const cut = RE_DX_CLAUSE_END.exec(head);
  const clause = cut ? head.slice(cut.index + 1) : head;
  let cond = false;
  let caseOf = false;
  let rel = false;
  RE_DX_COND.lastIndex = 0;
  for (let m = RE_DX_COND.exec(clause); m; m = RE_DX_COND.exec(clause)) {
    if (m[1]) cond = true;
    else if (m[2]) caseOf = true;
    else rel = true;
  }
  return { clause, cond, caseOf, rel };
});

/**
 * Skrót choroby w nazwie własnej: po rzeczowniku instytucji, firmy, klubu albo programu („Instytutu
 * IBS”, „Fundacji AIDS Healthcare”, „klubie RZS Rzeszów”, „spółki OCD Consulting”) albo przed wyrazem
 * z wielkiej litery („IBS PAN”, „SMA Solar”).
 */
const RE_ACR_INST_BEFORE = new RegExp(
  `${NOT_LETTER_BEFORE}(?:instytut|fundacj|stowarzysz|towarzyst|klub|spół|spółk|firm|zakład|centr|związ|federacj|program|projekt|grup|sekcj|drużyn|organizacj|agencj|biur|fundusz|kampani|konferencj|kongres|portal|serwis|aplikacj|poradni|ośrod|szkoł|przedszkol|katedr|pracowni|laboratori|mark|platform|sieci)${L}[ \\t]{1,4}[„"»]?$`,
  'i',
);
const RE_ACR_NAME_AFTER = new RegExp(`^[”"«]?[ \\t]{1,4}[${UP}]`);
const RE_ACR_ANY = new RegExp(`(?<![${LETTER}])(?:${DX_ACRONYM})(?![${LETTER}])`, 'g');
function acronymInName(text: string, a: number, b: number): boolean {
  const span = text.slice(a, b);
  RE_ACR_ANY.lastIndex = 0;
  for (let m = RE_ACR_ANY.exec(span); m; m = RE_ACR_ANY.exec(span)) {
    const x = a + m.index;
    const y = x + m[0].length;
    if (mtest(RE_ACR_INST_BEFORE, text.slice(Math.max(0, x - 40), x)) || mtest(RE_ACR_NAME_AFTER, text.slice(y, y + 6))) return true;
  }
  return false;
}
function acronymAnchor(text: string, starts: number[], from: number, to: number, mask: string): boolean {
  return !acronymInName(text, from, to) && diseaseAnchor(text, starts, from, to, mask);
}

/**
 * Zespół z nazwiskiem („zespół Aspergera”) to rozpoznanie tylko tuż po kotwicy rozpoznania albo
 * przyczyny i przy osobie, która go ma („rozpoznano zespół Downa”, „ze względu na zespół Aspergera”,
 * „ma zespół Tourette’a”, „dziecko z zespołem Retta”). Bez niej „w zespole Mazura”, „do zespołu
 * Nowaka”, „członkiem zespołu Kubiaka”, „w związku z zespołem Wójcika” to zespół ludzi, także
 * w piśmie szpitala czy przychodni, gdzie słownictwo medyczne stoi obok.
 */
const RE_ZESP_EPONYM = new RegExp(`^${cap('zesp')}(?:ół|ołu|ołem|ole)${WS}[${UP}]`);
const RE_EPONYM_LEAD = new RegExp(
  `${NOT_LETTER_BEFORE}(?:(?:rozpozna|zdiagnozowa)(?:no|ła|ł|li|ły|ny|na|ne|nym|ną|nego|nej)|stwierdzon(?:o|y|ym|ego|ej)|(ma|mam|miał(?:a)?|mają|mieli|posiada)|(?:cierpi|choruj)(?:e|ący|ąca|ącego|ącej)?[ \\t]{1,4}na|` +
    `z[ \\t]{1,4}powodu|ze[ \\t]{1,4}względu[ \\t]{1,4}na|z[ \\t]{1,4}uwagi[ \\t]{1,4}na|w[ \\t]{1,4}przebiegu|na[ \\t]{1,4}skutek|wskutek|w[ \\t]{1,4}wywiadzie|objaw(?:y|ami|ów)|podejrzeni(?:e|a|em|u)(?:[ \\t]{1,4}(?:o|na))?|rozpoznani(?:e|a|em|u)|diagnoz(?:a|ę|y|ie|ą)|leczeni(?:e|a|u|em)|stan(?:u|em|ie)?[ \\t]{1,4}po|` +
    `(?:dzieck(?:o|a|iem)|syn(?:a|em)?|córk(?:a|i|ą)|pacjent(?:a|em|ka|ki|ką)?|chłop(?:iec|ca|cem)|dziewczyn(?:ka|ki|ką)|ucz(?:eń|nia|niem)|uczennic(?:a|y|ą)|małoletni(?:ego|ej|m|a)?|wnu(?:k|ka|kiem|czka|czki)|niemowl(?:ę|ęcia)|chor(?:y|ego|ej|ym))[ \\t]{1,4}z)` +
    `(?:[ \\t]{1,4}u[ \\t]{1,4}[${LETTER}]+(?:[ \\t]{1,4}[${UP}][${LO}]+)?)?(?:[ \\t]{1,4}${DX_SEV}){0,2}[ \\t]*:?[ \\t]*$`,
  'i',
);
/**
 * Podmiot przed „ma”, „miał”, „posiada”: osoba, która może mieć chorobę (krewny, rola, zaimek, „Pan
 * Nowak”, imię i nazwisko, pierwsza osoba). Instytucja („Szkoła ma zespół Kubiaka”) i funkcja bez
 * osoby („Dyrektor ma zespół Nowaka”) mają zespół ludzi.
 */
const RE_EPONYM_SUBJ = new RegExp(
  `${NOT_LETTER_BEFORE}(?:on|ona|ono|oni|one|dzieck(?:o|a)|dzieci|syn|córka|chłopiec|dziewczynka|dziewczyna|uczeń|uczennica|pacjent(?:ka)?|chor(?:y|a)|wnu(?:k|czka)|niemowlę|bliźni(?:ak|aczka|ęta)|brat|siostra|małoletni(?:a)?|podopieczn(?:y|a)|wychowan(?:ek|ka))${NOT_LETTER_AFTER}`,
  'i',
);
/**
 * Dopowiedzenie organizacyjne po nazwisku („do pomocy”, „do obsługi zawodów”, „w dziale IT”, „z biura
 * projektów”): zespół ludzi, nie zespół chorobowy. Czas („do dziś”, „do końca życia”) nie jest celem.
 */
const RE_EPONYM_ORG_AFTER = new RegExp(
  `^[ \\t]{1,4}(?:(?:do|przy|dla)[ \\t]{1,4}(?!(?:dziś|dzisiaj|teraz|końca|tej|chwili|obecnie|śmierci|urodzenia)(?![${LETTER}]))[${LO}]{3,}|` +
    `(?:w|we|z|ze|na)[ \\t]{1,4}(?:dzia|wydzia|oddzia|biur|firm|spół|urzęd|urząd|szkol|szkoł|referac|sekcj|zakład|projek|pracy|pracowni|gmin|starostw|ośrod|placówk|budow|stanowisk|zmian|magazyn|sklep|siedzib|instytu|klub|drużyn|redakcj|kancelari|centr)${L})`,
  'i',
);
/**
 * Kotwica przed zespołem z nazwiskiem. Po czasowniku posiadania („ma zespół …”) dodatkowo podmiot
 * musi być osobą, a po nazwisku nie może stać dopowiedzenie organizacyjne.
 */
function eponymLead(text: string, from: number, to: number): boolean {
  const lo = Math.max(0, from - 80);
  const m = RE_EPONYM_LEAD.exec(text.slice(lo, from));
  if (!m) return false;
  if (m[1] === undefined) return true;
  if (mtest(RE_EPONYM_ORG_AFTER, text.slice(to, to + 60))) return false;
  if (/^mam$/i.test(m[1])) return true;
  const head = text.slice(Math.max(0, from - 160), lo + m.index);
  const subj = head.slice(Math.max(head.search(/[.!?\n][^.!?\n]*$/) + 1, 0));
  return mtest(RE_EPONYM_SUBJ, subj) || hasPerson(subj) || namePairAt(subj) >= 0;
}

/** Rozpoznanie po kotwicy: zakrywa nazwę choroby do końca frazy, kotwica zostaje jawna. */
function maskDiagnoses(ctx: RedactCtx, mask: string): void {
  for (const [re, strong] of [
    [RE_DX_STRONG, true],
    [RE_DX_WEAK, false],
  ] as const) {
    const text = ctx.text;
    const starts = sentenceStarts(text);
    const spans: [number, number][] = [];
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const from = m.index + m[0].length;
      const s = text.slice(from, from + 220);
      const lead = /^[ \t]*/.exec(s)?.[0].length ?? 0;
      if (s.startsWith(mask, lead)) continue;
      // osoba po „u” przy kotwicy („rozpoznano u niej …”, „U wnioskodawczyni rozpoznano …”)
      const who = !!m[1] || mtest(RE_DX_PERSON_BEFORE, text.slice(Math.max(0, m.index - 60), m.index));
      const len = dxSpan(s.slice(lead), { free: strong && who });
      if (!len) continue;
      const a = from + lead;
      const b = a + len;
      if (inProperName(text, a, text.slice(a, b)) || uncheckedOption(text, a)) continue;
      const sentence = sentenceAt(text, starts, a, b);
      if (isGenericRule(sentence) || mtest(RE_ICD_GENERAL, sentence) || generalDx(text, starts, m.index, a, b)) continue;
      if (mtest(RE_GROUP_AFTER, text.slice(b, b + 80)) || genericBefore(text, a) || acronymInName(text, a, b)) continue;
      // zespół z nazwiskiem bez kotwicy rozpoznania tuż przed nim („w związku z zespołem Nowaka”) to zespół ludzi
      if (mtest(RE_ZESP_EPONYM, text.slice(a, b)) && !eponymLead(text, a, b)) continue;
      if (!strong && !diseaseAnchor(text, starts, a, b, mask)) continue;
      spans.push([a, b]);
      re.lastIndex = b;
    }
    if (!spans.length) continue;
    // wynik składany jednym przejściem: podstawianie od końca kopiowałoby cały tekst przy każdej masce
    const parts: string[] = [];
    let pos = 0;
    for (const [a, b] of spans) {
      parts.push(text.slice(pos, a), ctx.hit('ZDROWIE'));
      pos = b;
    }
    parts.push(text.slice(pos));
    ctx.text = parts.join('');
  }
}

/**
 * Dopowiedzenie przy zakrytej chorobie wchodzi do tej samej maski: stopień przed nią („ostrej [ZDROWIE]”,
 * „przewlekła [ZDROWIE]”), określenia, kod i „z …” po niej („[ZDROWIE] nawracającej (F33.1)”, „[ZDROWIE]
 * z niedowładem prawostronnym”, „[ZDROWIE] obu oczu”) i rozpoznanie w nawiasie („[ZDROWIE] (grypa
 * z powikłaniami)”). Po masce tylko wyrazy medyczne, więc „[ZDROWIE] ciężkiej pracy” zostaje.
 */
function extendMasks(ctx: RedactCtx, mask: string): void {
  const M = escapeRe(mask);
  const reBefore = new RegExp(`(?<![${LETTER}])(?:${DX_SEV})[ \\t]{1,4}${M}`, 'gi');
  const reParen = new RegExp(`${M}[ \\t]*\\(([^()\\n]{2,80})\\)`, 'g');
  for (let round = 0; round < 3; round++) {
    const before = ctx.text;
    ctx.text = ctx.text.replace(reBefore, mask);
    ctx.text = ctx.text.replace(reParen, (m: string, inner: string) => {
      const t = inner.trim();
      return t !== mask && dxSpan(t) === t.length ? mask : m;
    });
    let out = '';
    let pos = 0;
    for (let i = ctx.text.indexOf(mask, pos); i >= 0; i = ctx.text.indexOf(mask, pos)) {
      const after = i + mask.length;
      const len = dxSpan(ctx.text.slice(after, after + 160), { cont: true });
      out += ctx.text.slice(pos, after);
      pos = after + len;
    }
    ctx.text = out + ctx.text.slice(pos);
    if (ctx.text === before) break;
  }
}

export function passHealth(ctx: RedactCtx): void {
  if (!ctx.on('ZDROWIE')) return;
  clearMemo();
  try {
    passHealthWith(ctx);
  } finally {
    clearMemo();
  }
}
function passHealthWith(ctx: RedactCtx): void {
  const mask = ctx.M.ZDROWIE;
  maskSections(ctx);
  maskDrugs(ctx);
  maskDoseSentences(ctx);
  maskVerbDrugs(ctx, mask);
  maskEnglishDrugs(ctx);
  maskBareDrugs(ctx, mask);
  maskDrugFirst(ctx, mask);
  maskIcdAnchored(ctx);
  maskPhrases(ctx, mask);
  maskDrugClasses(ctx, mask);
  // drugi raz: choroba zakryta przez frazy jest kotwicą leku w tym samym zdaniu („cukrzyca się rozjechała i chcą, żeby brała insulinę”)
  maskBareDrugs(ctx, mask);
  maskDrugFirst(ctx, mask);
  mergeIcdInParens(ctx, mask);
  extendMasks(ctx, mask);
  maskDrugAfterMask(ctx, mask);
  maskIcdInParens(ctx);
  mergeAfterMask(ctx, mask);
}
