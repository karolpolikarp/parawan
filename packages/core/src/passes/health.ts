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

const LO = 'a-ząćęłńóśźż';
const UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
const LETTER = `${LO}${UP}`;
const NOT_LETTER_BEFORE = `(?<![${LETTER}\\d])`;
const NOT_LETTER_AFTER = `(?![${LETTER}\\d])`;
const L = `[${LO}]*`;
/** Okno kontekstu wokół trafienia: zdanie ze zdaniem obok, ale nie dalej niż tyle znaków. */
const SPAN = 300;

/**
 * Kod ICD-10: litera (bez U, zarezerwowanej dla kodów specjalnych) i dwie cyfry, opcjonalnie
 * podkategoria po kropce albo przecinku („J45.0”, „J45,0”). W zapisie z kotwicą dopuszczamy też
 * spację po literze („F 32.1”, zapis ręczny i OCR).
 */
const ICD = String.raw`[A-TV-Z]\d{2}(?:\.\d{1,2})?`;
const ICD_FLEX = String.raw`[A-TV-Z][ \t]?\d{2}(?:[.,]\d{1,2})?`;
const ICD_ONLY = new RegExp(`^${ICD_FLEX}$`);
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
    `(?:osób|osoby|ludzi|pacjent${L}|chor(?:y|zy|ych)|Pola(?:k|ków|cy)|Polek|dzieci|kobiet${L}|mężczy(?:zn|źni)|pracowni(?:k|ków|cy)|mieszkańc${L}|seniorów|dorosłych|uczniów|ubezpieczon(?:y|ych))(?:[ \\t]+[${LETTER}]+){0,3}[ \\t]*$`,
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
 * Konkretna osoba w oknie: rola procesowa albo kadrowa w liczbie pojedynczej, członek rodziny,
 * pierwsza osoba („doznałem”, „mój”), pole formularza z danymi osoby albo zamaskowany PESEL.
 * Liczba mnoga („pacjentów”, „osoby”, „dzieci”) i „pacjent” w mianowniku (regulaminy) to nie osoba.
 */
const RE_PERSON = new RegExp(
  `${NOT_LETTER_BEFORE}(?:${[
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
    'jestem|mój|moja|moje|mojego|mojej|mojemu|moim|moją|u[ \\t]+mnie',
    // zaimek osobowy w trzeciej osobie („zalecił mu”, „u niego stwierdzono”); samo „jej” bywa
    // dzierżawcze w przepisie („bez jej zgody”), więc tylko po czasowniku lekarza
    `mu|jemu|niemu|u[ \\t]+niego|u[ \\t]+niej|(?:zalecił|przepisał|wypisał|podał|podano|zalecono|przepisano)${L}[ \\t]+jej`,
    // pierwsza osoba czasu przeszłego („doznałem”, „chorowałam”); „przesyłam”, „wysyłam”, „działam”
    // i „wołam” to czas teraźniejszy z listu przewodniego, a nie osoba, o której mowa
    `[${LO}]{2,}(?:łem|(?<!(?:sy|dzia|wo))łam)`,
  ].join('|')})${NOT_LETTER_AFTER}|(?:imię[ \\t]+i[ \\t]+)?nazwisko[ \\t]*:|pacjent(?:ka)?[ \\t]*:|data[ \\t]+urodzenia`,
  'i',
);
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
/** Pozycja pierwszej pary „imię nazwisko” w tekście albo -1. */
function namePairAt(s: string): number {
  RE_CAP_PAIR.lastIndex = 0;
  for (let m = RE_CAP_PAIR.exec(s); m; m = RE_CAP_PAIR.exec(s)) {
    // patron po „im.” („Szpital im. Józefa Babińskiego”) to nazwa instytucji, a nie osoba
    const patron = /(?:im\.|imienia)[ \t]*$/i.test(s.slice(Math.max(0, m.index - 10), m.index));
    if (!patron && (isGivenName(m[1]) || isGivenName(m[2]))) return m.index;
    // para zachodzi na siebie („Pacjentka Maria Kowalska”): następny wyraz zaczyna kolejną parę
    RE_CAP_PAIR.lastIndex = m.index + m[1].length;
  }
  return -1;
}
const hasPerson = (w: string): boolean => RE_PERSON.test(w) || RE_PERSON_CS.test(w);
/**
 * Osoba przy trafieniu: rola, zaimek, „Pan”, „Pani” w szerszym oknie, a imię z nazwiskiem tylko
 * w tym samym zdaniu (nazwisko prezesa w zdaniu obok nie robi z raportu karty pacjenta).
 */
const personNear = (text: string, sentence: string, from: number, to: number): boolean =>
  hasPerson(personWindow(text, from, to)) || (namePairAt(sentence) >= 0 && !RE_NAME_NOT_PATIENT.test(sentence));
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
  RE_GENERIC_RULE.test(sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0;

/** Czasownik o przyjmowaniu leku przez osobę („przyjmuje”, „zalecił”); „zaleca się” i „stosuje się do” nie. */
const RE_DRUG_VERB = new RegExp(
  `${NOT_LETTER_BEFORE}(?:zalecił(?:a)?|zalecono|zaleca(?:m)?(?![ \\t]+się)|przyjmuj(?:e|ę)|przyjmował(?:a|em|am)?|stosuj(?:e|ę)(?![ \\t]+się)|stosował(?:a|em|am)?(?![ \\t]+się)|zażyw(?:a|am)|zażywał(?:a|em|am)?|przepisał(?:a)?|przepisano|wypisał(?:a)?|wypisano|recept(?:ę|a|y|ą)[ \\t]+na|na[ \\t]+recepcie)${NOT_LETTER_AFTER}`,
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
  'lantus humalog novorapid tresiba toujeo mixtard'
).split(/\s+/);
/** Nazwa leku z końcówką („sertraliną”, „salbutamolu”, „Euthyroxu”), wielka litera na początku dozwolona. */
const DRUG_NAME = `(?<![${LETTER}])(?:${DRUG_STEMS.map((s) => `[${s[0]}${s[0].toUpperCase()}]${escapeRe(s.slice(1))}`).join('|')})[${LO}]{0,4}${NOT_LETTER_AFTER}`;
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
/** Pozycja dawkowania: „2 x dziennie”, „1-0-1”, „raz dziennie”, „rano”, „na noc”, „na czczo”, „co 8 godzin”, „doraźnie”. */
const DOSING_ITEM = String.raw`(?:\d[ \t]?x[ \t]?(?:dziennie|\d+|na[ \t]+dobę)|\d(?:-\d){2}|(?:raz|dwa[ \t]+razy|trzy[ \t]+razy)[ \t]+(?:dziennie|na[ \t]+dobę)|rano|wieczorem|na[ \t]+noc|na[ \t]+czczo|co[ \t]+\d{1,2}[ \t]?(?:godzin[ay]?|h)|dziennie|doraźnie)(?![${LETTER}])`;
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

type Anchor = (text: string, starts: number[], from: number, to: number, mask: string) => boolean;

interface Phrase {
  re: RegExp;
  /** Czy fraza sama wskazuje osobę i nie potrzebuje kotwicy w zdaniu. */
  self?: boolean;
  /** Własna kotwica zamiast medycznej (ciąża, pobyt w szpitalu psychiatrycznym). */
  anchor?: Anchor;
}

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
  RE_POPULATION_SUBJECT.test(sentenceHead(text, starts, from));
/** Kotwica medyczna albo konkretna osoba w zdaniu, ale nie w regule ogólnej ani zdaniu warunkowym. */
const personAnchor: Anchor = (text, starts, from, to, mask) => {
  if (medicalAnchored(text, starts, from, to, mask)) return true;
  const sentence = sentenceAt(text, starts, from, to);
  if (RE_CONDITIONAL.test(sentenceHead(text, starts, from)) || isGenericRule(sentence)) return false;
  return personNear(text, sentence, from, to);
};
/** Personel szpitala („pielęgniarka w szpitalu psychiatrycznym”, „pracuje w…”) to miejsce pracy, a nie pobyt. */
const RE_HOSPITAL_STAFF = new RegExp(
  `${NOT_LETTER_BEFORE}(?:pracuj${L}|pracował${L}|zatrudni${L}|praktyk${L}|staż${L}|dyżur${L}|wolontariu${L}|lekar${L}|lekark${L}|pielęgniar${L}|ordynator${L}|kierowni${L}|dyrektor${L}|psycholog${L}|terapeut${L}|personel${L}|ratowni${L}|salow${L}|sanitariusz${L})${NOT_LETTER_AFTER}`,
  'i',
);
const stayAnchor: Anchor = (text, starts, from, to, mask) =>
  !RE_HOSPITAL_STAFF.test(sentenceHead(text, starts, from)) && personAnchor(text, starts, from, to, mask);

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
  phrase(
    String.raw`cukrzyc(?:a|y|ę|ą|e|o)(?:[ \t]+typu[ \t]+(?:1|2|I{1,2}|pierwszego|drugiego)|[ \t]+ciążow${L})?(?:[ \t]+(?:insulinozależn|insulinoniezależn)${L})?(?:[ \t]+bez[ \t]+powikłań)?`,
  ),
  phrase(
    String.raw`epizod${L}[ \t]+depresyjn${L}(?:[ \t]+(?:umiarkowan|łagodn|ciężk)${L})?|depresj(?:a|i|ę|ą)(?![ \t]+(?:(?:na|w|we)[ \t]+)?(?:gospodar|ekonomi|teren|baryczn|termiczn|geograficzn|tektoniczn|rynk|rynek|koniunktur|giełd|branż|sektor|przemyś|budownictw|nieruchomoś|handl|eksport|finans)${L})|zaburzeni${L}[ \t]+(?:depresyjn|lękow|afektywn|psychotyczn|adaptacyjn|osobowości|odżywiania)${L}`,
  ),
  phrase(String.raw`nadciśnieni${L}(?:[ \t]+tętnicz${L}(?:[ \t]+samoistn${L})?)?(?![ \t]+(?:wody|gazu|powietrza|pary|oleju|instalacj${L}|układu|(?:w|we)[ \t]+(?:instalacji|układzie|zbiorniku|rurociągu|sieci|kotle|przewodzie|przewodach|rurze|rurach|komorze|cylindrze|pompie|zaworze|systemie|obwodzie|linii|kolektorze|naczyniu|kanale|turbinie|sprężarce|siłowniku|hydraulice|oponie|oponach|ogumieniu)))`),
  phrase(String.raw`astm(?:a|y|ę|ą|ie)(?:[ \t]+oskrzelow${L})?`),
  phrase(
    String.raw`chor(?:ob(?:a|y|ę|ą|ie|om)|ób)[ \t]+(?:Leśniowskiego-Crohna|Crohna|Hashimoto|Parkinsona|Alzheimera|Gravesa(?:-Basedowa)?|Huntingtona|Bechterewa|Addisona|Cushinga|afektywn${L}[ \t]+dwubiegunow${L}|alkoholow${L}|nowotworow${L}|niedokrwienn${L}[ \t]+serca|wieńcow${L}|psychiczn${L})(?:[ \t]+jelita[ \t]+(?:cienkiego|grubego))?`,
  ),
  phrase(String.raw`stwardnieni${L}[ \t]+rozsian${L}|schizofreni${L}|padaczk${L}|epilepsj${L}|białaczk${L}|chłoniak${L}|nowotw[oó]r${L}(?:[ \t]+(?:złośliw|łagodn)${L})?(?:[ \t]+(?:piersi|płuc|płuca|jelita(?:[ \t]+grubego)?|prostaty|szyjki[ \t]+macicy|trzustki|żołądka|skóry|krtani|jajnika|nerki|nerek|pęcherza(?:[ \t]+moczowego)?|tarczycy|wątroby|odbytnicy|mózgu|kości))?|jaskr(?:a|y|ę|ą|ze)|zaćm(?:a|y|ę|ą|ie)`),
  phrase(
    String.raw`rak(?:a|iem|u)?[ \t]+(?:piersi|płuc|jelita(?:[ \t]+grubego)?|prostaty|szyjki[ \t]+macicy|trzustki|żołądka|skóry|krtani|jajnika|nerki|pęcherza(?:[ \t]+moczowego)?|tarczycy|wątroby|odbytnicy)`,
  ),
  phrase(`chemioterapi${L}|radioterapi${L}|immunoterapi${L}|dializ(?:a|y|ę|ą|ie|ach|om)`),
  phrase(
    String.raw`zapaleni${L}[ \t]+(?:płuc|oskrzeli|wyrostka(?:[ \t]+robaczkowego)?|opon[ \t]+mózgowo-rdzeniowych|trzustki|wątroby|stawów|ucha|zatok|pęcherza(?:[ \t]+moczowego)?|nerek|mięśnia[ \t]+sercowego)`,
  ),
  phrase(`COVID(?:-19)?|SARS-CoV-2|koronawirus${L}`),
  // „jest w ciąży”, „jest w 5. miesiącu ciąży”, „była w piątym tygodniu ciąży”
  phrase(
    String.raw`(?<=(?:jest|była|będąc${L})[ \t]{1,8})w[ \t]+(?:(?:\d{1,2}\.?|[${LO}]{3,}(?:ym|im))[ \t]+(?:miesiącu|tygodniu)[ \t]+)?ciąży`,
    false,
    personAnchor,
  ),
  // pobyt w szpitalu psychiatrycznym; sam „szpital” bez przymiotnika zostaje jawny
  phrase(String.raw`(?<=(?:w|we|do|ze|z)[ \t]{1,8})szpital(?:u|a|em)?[ \t]+psychiatryczn(?:ym|ego|y)`, false, stayAnchor),
  phrase(
    String.raw`udar${L}[ \t]+mózgu|zawał${L}[ \t]+(?:serca|mięśnia[ \t]+sercowego)|niedoczynnoś${L}[ \t]+tarczycy|nadczynnoś${L}[ \t]+tarczycy|(?:zakażeni|zakażon)${L}[ \t]+(?:wirusem[ \t]+)?(?:HIV|HCV|HBV)|nosiciel${L}[ \t]+(?:wirusa[ \t]+)?(?:HCV|HBV|HIV)`,
  ),
  phrase(String.raw`anoreksj${L}|bulimi${L}|alkoholizm${L}|uzależnieni${L}[ \t]+od[ \t]+(?:alkoholu|narkotyków|opioidów|leków|substancji[ \t]+psychoaktywnych)`),
  // urazy z częścią ciała
  phrase(
    String.raw`(?:(?:stłuczeni|złamani|zwichnięci|skręceni|zerwani|naderwani|pęknięci|oparzeni|wstrząśnieni)${L}|uraz(?:u|em|y|ów)?)[ \t]+${SIDE}(?:${ANATOMY})${TECH_AFTER}(?:[ \t]+(?:${ADJ}|${SIDE}(?:${ANATOMY})(?![${LETTER}])${TECH_AFTER})){0,4}`,
  ),
  // zabiegi, leczenie, wizyty
  phrase(String.raw`cesarski${L}[ \t]+cięci${L}|cięci${L}[ \t]+cesarski${L}`),
  phrase(String.raw`rehabilitacj${L}[ \t]+(?:ruchow|lecznicz|medyczn|kardiologiczn|neurologiczn|ortopedyczn|pulmonologiczn)${L}`),
  phrase(String.raw`(?:wizyt|konsultacj|leczeni)${L}[ \t]+u[ \t]+(?:${SPEC_RE})|pod[ \t]+opieką[ \t]+(?:${SPEC_RE}|poradni[ \t]+zdrowia[ \t]+psychicznego)`),
  phrase(String.raw`pomiar${L}[ \t]+glikemii|(?:podani|podawani|przyjmowani)${L}[ \t]+insulin${L}`),
  // „uzależniony od alkoholu” stoi też w przepisach („osoba uzależniona od alkoholu nie może…”)
  phrase(String.raw`uzależnion(?:y|a|e|i|ego|ej|ym)[ \t]+od[ \t]+(?:alkoholu|narkotyków|opioidów|leków|hazardu)`),
  phrase(String.raw`nadużywani${L}[ \t]+(?:alkoholu|narkotyków|leków)`),
];
/** Te same frazy bez flagi „g” do sprawdzania, czy w tekście jest nazwa choroby. */
const PHRASE_TESTS = PHRASES.map((p) => new RegExp(p.re.source, 'i'));
const hasDisease = (s: string): boolean => PHRASE_TESTS.some((re) => re.test(s));
const PHRASE_AT_START = PHRASES.map((p) => new RegExp(`^(?:${p.re.source})`, 'i'));

/** Słownictwo medyczne w otoczeniu nagłówka sekcji: karta ze szpitala, a nie raport techniczny. */
const RE_MED_VOCAB = new RegExp(
  `${NOT_LETTER_BEFORE}(?:${STRONG}|pacjen(?:t|tk)${L}|leczeni${L}|hospitaliz${L}|porod${L}|poród|lekar${L}|lekark${L}|szpital${L}|przychodni${L}|poradni${L}|klinik${L}|ICD(?:-?10)?|pielęgniar${L}|ordynator${L}|oddział${L}[ \\t]+(?:chorób|kardiolog|neurolog|chirurg|psychiatr|onkolog|wewnętrzn|intensywn|ratunkow|pediatr|ginekolog|ortoped)${L})${NOT_LETTER_AFTER}`,
  'i',
);
const hasMedVocab = (s: string): boolean => RE_MED_VOCAB.test(s) || hasDisease(s) || RE_DRUG_NAME.test(s);

/* ── Okno kontekstu ── */

/** Początki zdań w tekście: po nowym wierszu albo po [.!?] i odstępie przed wielką literą. */
function sentenceStarts(text: string): number[] {
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
  if (RE_STRONG.test(w)) return true;
  return RE_WEAK.test(w) && personNear(text, sentence, from, to);
}

/* ── Sekcje karty informacyjnej ── */

const DIAG_HEADER = String.raw`(?:rozpoznani[ea](?:[ \t]+(?:zasadnicze|główne|wstępne|końcowe|kliniczne|ostateczne|współistniejące|dodatkowe|towarzyszące|przy[ \t]+(?:przyjęciu|wypisie)))*|rozp\.|diagnoz[ay]|choroby[ \t]+(?:współistniejące|przewlekłe|towarzyszące))`;
const DRUG_HEADER = String.raw`(?:leki(?:[ \t]+(?:stosowane|przyjmowane|zalecane))?(?:[ \t]+(?:przewlekle|na[ \t]+stałe|przy[ \t]+wypisie|obecnie))?|przyjmowane[ \t]+leki|zalecane[ \t]+leki|leczenie[ \t]+farmakologiczne|farmakoterapia)`;
const ADVICE_HEADER = String.raw`(?:zalecenia(?:[ \t]+(?:przy[ \t]+wypisie|lekarskie|po[ \t]+wypisie))?)`;
/** Nagłówek sekcji na początku wiersza; wartość w tym samym wierszu albo w kolejnych. */
const RE_SECTION = new RegExp(String.raw`^([ \t]*(${DIAG_HEADER}|${DRUG_HEADER}|${ADVICE_HEADER})[ \t]*(?:\([^)\n]{1,20}\)[ \t]*)?:)([^\n]*)`, 'im');
const RE_DIAG = new RegExp(`^${DIAG_HEADER}$`, 'i');
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
  if (!body || body.length > 120 || RE_OTHER_LABEL.test(line) || RE_SENTENCE_BREAK.test(body)) return false;
  if (hasIcd(body)) return true;
  // Nazwa choroby z wielkiej litery („Nadciśnienie tętnicze”, „Zapalenie płuc”) w sekcji rozpoznań.
  if (!drugs && hasDisease(body)) return true;
  if (drugs && (RE_DOSE_LINE.test(line) || RE_DRUG_LINE.test(line))) return true;
  // Mała litera albo znacznik wyliczenia: pozycja listy. Wiersz z wielkiej litery bez kodu
  // może być już podpisem („lek. Adam Polak” to też mała litera, ale z tytułem i osobą).
  if (RE_TITLE.test(body)) return false;
  return RE_LIST_MARK.test(line) || RE_LO_START.test(body);
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
  if (!body || RE_NEGATIVE.test(body) || RE_SECTION_GENERAL.test(body)) return false;
  if (mode === 'drug') {
    if (RE_MONEY.test(body)) return false; // „Leki: 450,00 zł” w wykazie kosztów
    return RE_HAS_DOSE.test(body) || RE_DRUG_LINE.test(value) || medCtx;
  }
  if (mode === 'advice') {
    // W zaleceniach tylko wiersz z lekiem: ze słownika albo z jednostką lekową w karcie.
    return RE_DRUG_LINE.test(value) || (medCtx && RE_DOSE_LINE.test(value));
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
  if (RE_CARD_PATIENT.test(t)) return 2;
  if (!(RE_CARD_PERSON.test(t) || t.includes(ctx.M.PESEL) || near.includes(ctx.M.IMIE))) return 0;
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
  RE_DIAG_LINE.test(body) && !RE_DIAG_LINE_NOT.test(body) && !RE_NEGATIVE.test(body) && namePairAt(body) < 0;

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
    const head = RE_SECTION.exec(line);
    if (head) {
      const name = head[2].replace(/\s+/g, ' ');
      mode = RE_DIAG.test(name) ? 'diag' : RE_DRUG_HEAD.test(name) ? 'drug' : 'advice';
      strict = RE_STRICT_HEAD.test(name);
      // Nagłówek wieloznaczny („Rozpoznanie:”, „Leki:”) potrzebuje słownictwa medycznego obok.
      medCtx = RE_MEDICAL_HEAD.test(name) || hasMedVocab(headerContext(lines, i));
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
      if (!RE_OTHER_LABEL.test(line) && valueIsHealth('advice', line, false, medCtx)) out.push(`${m}${ctx.hit('ZDROWIE')}`);
      else if (line.length <= 120 && !RE_OTHER_LABEL.test(line) && !RE_SENTENCE_BREAK.test(line)) out.push(line);
      else {
        mode = null;
        out.push(line);
      }
      continue;
    }
    const body = line.replace(RE_LIST_MARK, '').trim();
    const item = strict ? hasIcd(body) || hasDisease(body) : isListItem(line, mode === 'drug');
    const health = item && !RE_OTHER_LABEL.test(line) && valueIsHealth(mode, line, strict, medCtx);
    const cardDiag = mode === 'diag' && card > 0 && isCardDiagLine(body) && (card === 2 || RE_DIAG_WORD.test(body));
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
const ICD_ANCHOR = String.raw`(?:${NOT_LETTER_BEFORE}(?:[Rr]ozpoznani(?:e|a|u|em)|[Rr]ozp\.|[Dd]iagnoz(?:a|y|ie|ą|ę)|[Kk]od(?:em|u)?(?:[ \t]+(?:choroby|jednostki[ \t]+chorobowej|rozpoznania|ICD(?:-?10)?))?|ICD(?:-?10)?|ROZPOZNANIE))`;
const ICD_SEP = String.raw`(?:[ \t]*,[ \t]*|[ \t]*;[ \t]*|[ \t]+(?:i|oraz)[ \t]+)`;
// Jeden odstęp z opcjonalnym znakiem: dwa sąsiednie [ \t]* cofały się kwadratowo na długich odstępach.
const RE_ICD_ANCHORED = new RegExp(
  String.raw`(${ICD_ANCHOR}[ \t]*(?:[(:\-–][ \t]*)?)(${ICD_FLEX}(?:${ICD_SEP}${ICD_FLEX})*)${ICD_END}`,
  'g',
);
const RE_ICD_CODE = new RegExp(ICD_FLEX, 'g');

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
  if (RE_ICD_GENERAL.test(sentenceAt(whole, starts, offset, end))) return false;
  // samo „kod”/„z kodem” (bez „choroby”); „kodem choroby” nie może cofnąć się do „kod” + „em…”
  if (/^kod(?:em|u)?(?![a-z]|[ \t]+[a-zA-Z])/i.test(a)) return RE_STRONG.test(w);
  if (/^(?:diagnoz|rozp\.)/i.test(a) && !hasMedVocab(w)) return false;
  const lineStart = RE_LINE_LABEL_BEFORE.test(whole.slice(Math.max(0, offset - 12), offset));
  // Etykieta „ICD-10:”, „ICD10” na początku wiersza albo zaraz po „Rozpoznanie:” to pole karty;
  // w zdaniu („program B.29 (ICD-10: G35)”) dalej potrzebuje osoby albo kotwicy silnej.
  if (/^ICD/.test(a) && (lineStart || RE_DIAG_LABEL_BEFORE.test(whole.slice(Math.max(0, offset - 30), offset)))) return true;
  if (a.endsWith(':') && lineStart && !/^ICD/.test(a)) return true;
  if (RE_STRONG.test(w) || w.includes(mask) || personNear(whole, sentenceAt(whole, starts, offset, end), offset, end)) return true;
  return /^kod/i.test(a) && RE_SICK_LEAVE.test(w);
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
    if (RE_ICD_GENERAL.test(sentence) || isGenericRule(sentence)) return m;
    const w = windowAt(whole, starts2, offset, end);
    if (!(RE_STRONG.test(w) || RE_WEAK.test(sentence.replace(m, ' ')) || personNear(whole, sentence, offset, end))) return m;
    return `${pre}${codes.replace(new RegExp(ICD, 'g'), () => ctx.hit('ZDROWIE'))}`;
  });
}
const RE_ICD_CAUSE = new RegExp(String.raw`(${NOT_LETTER_BEFORE}[Zz][ \t]+powodu[ \t]+)(${ICD}(?:${ICD_SEP}${ICD})*)${ICD_END}`, 'g');

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
  if (!RE_UP_START.test(m)) return false;
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
const genericBefore = (whole: string, offset: number): boolean => RE_GENERIC_BEFORE.test(whole.slice(Math.max(0, offset - 80), offset));

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
function maskPhrasesOnce(ctx: RedactCtx, mask: string): boolean {
  const before = ctx.text;
  for (const p of PHRASES) {
    const starts = sentenceStarts(ctx.text);
    ctx.text = ctx.text.replace(p.re, (m: string, ...args: unknown[]) => {
      const offset = args[args.length - 2] as number;
      const whole = args[args.length - 1] as string;
      if (inProperName(whole, offset, m)) return m;
      if (!p.self && genericBefore(whole, offset)) return m;
      if (p.anchor) {
        if (!p.anchor(whole, starts, offset, offset + m.length, mask)) return m;
      } else if (!p.self && !medicalAnchored(whole, starts, offset, offset + m.length, mask)) return m;
      return ctx.hit('ZDROWIE');
    });
  }
  for (const re of [RE_SUFFER, RE_SURGERY]) {
    const st = sentenceStarts(ctx.text);
    ctx.text = ctx.text.replace(re, (m: string, pre: string, obj: string, offset: number, whole: string) => {
      const from = offset + pre.length;
      const to = from + obj.length;
      const sentence = sentenceAt(whole, st, from, to);
      if (isGenericRule(sentence) || populationSubject(whole, st, from)) return m;
      const person = RE_FIRST_PERSON_VERB.test(pre) || RE_PATIENT_WORD.test(sentence) || personNear(whole, sentence, from, to);
      return person ? `${pre}${ctx.hit('ZDROWIE')}` : m;
    });
  }
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

function maskDrugs(ctx: RedactCtx): void {
  // Lek z dawką poza sekcją karty tylko przy kotwicy: cennik apteki („paracetamol 500 mg, 9,99 zł”),
  // faktura i lista refundacyjna zostają, tak samo lek podany jako przykład albo w instrukcji
  // i statystyce bez osoby („stosować paracetamol 500 mg”, „1,2 mln recept na metforminę 500 mg”).
  const starts = sentenceStarts(ctx.text);
  ctx.text = ctx.text.replace(RE_DRUG, (m: string, offset: number, whole: string) => {
    const to = offset + m.length;
    const sentence = sentenceAt(whole, starts, offset, to);
    if (RE_PRICE.test(sentence)) return m;
    if (RE_DRUG_EXAMPLE_BEFORE.test(whole.slice(Math.max(0, offset - 80), offset))) return m;
    if (RE_DRUG_GENERAL.test(sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0) return m;
    if (populationSubject(whole, starts, offset)) return m;
    return medicalAnchored(whole, starts, offset, to) || RE_DRUG_VERB.test(windowAt(whole, starts, offset, to)) ? ctx.hit('ZDROWIE') : m;
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
      if (RE_PRICE.test(sentence) || isGenericRule(sentence) || populationSubject(whole, starts, from)) return m;
      if (RE_DRUG_EXAMPLE_BEFORE.test(whole.slice(Math.max(0, offset - 80), offset))) return m;
      if (RE_DRUG_GENERAL.test(sentence) && !hasPerson(sentence) && namePairAt(sentence) < 0) return m;
      // „g” i „ml” stoją też w dawkach nawozu, smaru, mleka czy diety: potrzebna postać leku („syrop”),
      // lek ze słownika albo nazwa handlowa (wielka litera) przy słownictwie medycznym w oknie.
      if (!RE_UNIT_DRUG_ONLY.test(unit)) {
        const name = drug.slice(0, drug.length - tail.length);
        const medical = RE_HAS_UPPER.test(name) && (medicalAnchored(whole, starts, from, to) || hasMedVocab(windowAt(whole, starts, from, to)));
        if (!(RE_DRUG_FORM_WORD.test(name) || RE_DRUG_NAME.test(name) || medical)) return m;
      }
      return `${pre}${ctx.hit('ZDROWIE')}`;
    },
  );
}

export function passHealth(ctx: RedactCtx): void {
  if (!ctx.on('ZDROWIE')) return;
  const mask = ctx.M.ZDROWIE;
  maskSections(ctx);
  maskDrugs(ctx);
  maskDoseSentences(ctx);
  maskIcdAnchored(ctx);
  maskPhrases(ctx, mask);
  mergeIcdInParens(ctx, mask);
  mergeAfterMask(ctx, mask);
}
