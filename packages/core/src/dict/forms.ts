// Słowniki i bramki pól formularza (etykieta → wartość).
import { MONTHS_GEN } from '../charset.js';
import { normStructKey, STRUCT_KEYS } from '../struct-keys.js';
import { type PiiType } from '../types.js';

// Eksporty urzędowe mają często układ „Etykieta\nWARTOŚĆ”, którego reguły prozy nie łapią.
// Etykieta pola to mocna kotwica, ale maskujemy tylko pola osobowe: kraj, województwo, powiat
// i gmina są za szerokie, by same były danymi osobowymi.
type FormKind = 'name' | 'date' | 'place' | 'addr';
export interface FormField {
  re: RegExp; // etykieta bez numeracji („12. ”) do „:” lub końca linii
  type: PiiType;
  kind: FormKind;
  /** Gdzie w wartości stoi nazwisko: w trybie pseudonimów pole dostaje wtedy [OSOBA-X] zamiast stałej maski. */
  surnameAt?: 'first' | 'last';
  /** Etykieta z dopełnieniem, bez ogonków albo w szyku ZUS: wartość przechodzi ostrzejszą bramkę gatedPersonValue. */
  gated?: true;
  /** Etykieta samego nazwiska („Nazwisko pacjenta:”): jeden wyraz pod nią to zawsze nazwisko. */
  surnameOnly?: true;
  /** Wartość bywa listą imion („Imiona rodziców: Jan, Anna”). */
  nameList?: true;
}
// Etykiety roli osoby w komórce wiersza z tabulatorami (patrz passFormFields).
export const TAB_ROLE_LABELS = new Set<string>(
  (
    'świadek ojciec matka kierownik kierowniczka pracownik pracownica przełożony przełożona opiekun opiekunka ' +
    'pacjent pacjentka uczeń uczennica dziecko syn córka mąż żona małżonek małżonka wnioskodawca wnioskodawczyni pełnomocnik ' +
    // role ze zgłoszeń szkód, umów najmu i pism komorniczych („Kierujący⇥Paweł⇥Nazwisko⇥Nowak")
    'kierujący kierująca najemca najemczyni wynajmujący wynajmująca poszkodowany poszkodowana dłużnik dłużniczka ' +
    'wierzyciel wierzycielka sprawca sprawczyni uczestnik uczestniczka ubezpieczony ubezpieczona zastępca zastępczyni'
  ).split(' '),
);
// Dopełnienie etykiety osobowej („Imię i nazwisko pacjenta:”) to zamknięta lista ról: otwarty
// wzorzec dopełniacza łapałby etykiety podmiotów („Imię i nazwisko świadczeniodawcy: Przychodnia…”).
const FORM_PERSON_OF = String.raw`(?:\s+(?:pacjent(?:a|ki)|dziecka|ucznia|uczennicy|ubezpieczon(?:ego|ej)|opiekun(?:a|ki)(?:\s+prawn(?:ego|ej))?|matki|ojca|rodzica|wnioskodawcy|osoby(?:\s+(?:upoważnionej|uprawnionej|kontaktowej|bliskiej))?|przedstawiciela(?:\s+ustawowego)?|zmarł(?:ego|ej)|małżonk(?:a|i)|świadka|pełnomocnika|pracownika))?`;
// Wpisy z `gated` (ogonki opcjonalne z OCR, liczebnik po „imię” w szyku ZUS i KRUS) stoją za
// podstawowymi: podstawowe etykiety zachowują stałą maskę także w trybie pseudonimów.
export const FORM_FIELDS: FormField[] = [
  { re: /^imię\s+i\s+nazwisko$|^nazwisko\s+i\s+imię$/i, type: 'IMIE', kind: 'name' },
  { re: /^nazwisk[ao](?:\s+(?:rodowe|panieńskie|poprzednie))?(?:\s+(?:matki|ojca))?$/i, type: 'IMIE', kind: 'name' },
  { re: /^(?:pierwsze\s+|drugie\s+|kolejne\s+)?imi(?:ę|ona)(?:\s+(?:ojca|matki))?$/i, type: 'IMIE', kind: 'name' },
  { re: /^imiona\s+rodzic[oó]w$/i, type: 'IMIE', kind: 'name', nameList: true },
  { re: new RegExp(`^imi[eę]\\s+i\\s+nazwisko${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', surnameAt: 'last', gated: true },
  { re: new RegExp(`^nazwisko\\s+i\\s+imi[eę]${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', surnameAt: 'first', gated: true },
  { re: new RegExp(`^nazwisk[ao](?:\\s+(?:rodowe|panie[nń]skie|poprzednie))?${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', surnameAt: 'first', gated: true, surnameOnly: true },
  { re: new RegExp(`^(?:(?:pierwsze|drugie|kolejne)\\s+)?imi(?:[eę]|ona)(?:\\s+(?:pierwsze|drugie|kolejne))?${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', gated: true },
  { re: /^data\s+urodzenia$/i, type: 'DATA-UR', kind: 'date' },
  { re: /^miejsce\s+urodzenia$/i, type: 'MIEJSCOWOSC', kind: 'place' },
  { re: /^miejscowo[sś][cć]$/i, type: 'MIEJSCOWOSC', kind: 'place' },
  { re: /^(?:miejsce|adres)\s+(?:zamieszkania|zameldowania|pobytu)$/i, type: 'MIEJSCOWOSC', kind: 'place' },
  { re: /^ulica$/i, type: 'ADRES', kind: 'addr' },
  { re: /^(?:nr|numer)\s+(?:domu|budynku|lokalu|mieszkania)$/i, type: 'ADRES', kind: 'addr' },
];
const FORM_EMPTY_VALUES = new Set([
  'brak', 'niedotyczy', 'nd', 'n/d', 'bd', 'x', 'bez', '-', '–', '—', '',
  'nieznane', 'nieznana', 'nieznany', 'niepodano', 'niepodane', 'null', 'none',
  'wakat', 'anonim', 'anonimowy', 'anonimowa', 'zastrzeżone', 'zastrzeżony', 'zastrzeżona', 'ukryte',
  'douzupełnienia', 'douzupelnienia',
]);
/**
 * Pusty wypełniacz pola („brak”, „b.d.”, „W A K A T”). Porównanie bez kropek i odstępów, wspólne
 * dla pól formularza, struktur i loginu. Cena: inicjały „B.D.” w polu imienia zostają jawne.
 */
export const isEmptyFormValue = (v: string): boolean => FORM_EMPTY_VALUES.has(v.toLowerCase().replace(/[\s.]+/g, ''));
// Nazwa własna: 1–4 wyrazy od wielkiej litery, bo proza ma małe litery i spójniki.
export const RE_PROPER_WORDS = /^\p{Lu}[\p{L}'’.‑-]*(?:[ \t]+\p{Lu}[\p{L}'’.‑-]*){0,3}$/u;
/**
 * Pierwsze słowa typowych etykiet i nagłówków formularza (małe litery). Rozpoznają, że pod pustym
 * polem stoi kolejna etykieta, a nie dana („Rozpoznanie” po pustym „Nazwisko:”).
 */
export const FORM_LABEL_WORDS = new Set<string>(
  (
    'nazwisko nazwiska imię imiona imie data miejsce miejscowość miejscowosc ulica nr numer kraj województwo ' +
    'powiat gmina kod pesel nip regon krs telefon tel email e-mail adres rozpoznanie oddział ' +
    'jednostka wydział dział stanowisko zawód wykształcenie obywatelstwo seria dokument płeć stan ' +
    'dane rozdział załącznik punkt pozycja poz specjalność tytuł nazwa firma'
  ).split(' '),
);
/** Data cyfrowa lub słowna: w polu „Data urodzenia” maskujemy samą datę. */
export const RE_DATE_VALUE = new RegExp(
  String.raw`\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:${MONTHS_GEN})\s+\d{4}`,
  'i',
);
/** Zdejmuje numerację („12. ”, „3) ”) i białe znaki z brzegów. */
export const stripFormPrefix = (s: string): string => s.replace(/^[ \t]*\d+[.)][ \t]*/, '').trim();
/**
 * Etykieta bez wartości po „:” i bez końcowej podpowiedzi w nawiasie („Nazwisko (rodowe): …” →
 * „Nazwisko”). Skan liniowy zamiast `s.replace(/\s*:.*$/, '').replace(/\s*\([^)]*\)\s*$/, '')`, bo ten
 * regex jest kwadratowy na długich ciągach spacji. Jak „.*$” liczy pierwszy „:” po ostatnim końcu wiersza.
 */
export function formLabelOf(s: string): string {
  const lastTerm = Math.max(s.lastIndexOf('\r'), s.lastIndexOf('\u2028'), s.lastIndexOf('\u2029'));
  const colon = s.indexOf(':', lastTerm + 1);
  const base = colon === -1 ? s : s.slice(0, colon).trimEnd();
  const t = base.trimEnd();
  if (!t.endsWith(')')) return base;
  const open = t.indexOf('(', t.lastIndexOf(')', t.length - 2) + 1);
  if (open === -1 || open > t.length - 2) return base;
  return t.slice(0, open).trimEnd();
}
/** Czy wiersz to etykieta albo nagłówek, a nie wartość sąsiedniego pola? Chroni pola puste. */
export const isFormLabelLine = (line: string): boolean => {
  const t = stripFormPrefix(line);
  const base = t.replace(/\s*:\s*$/, '');
  if (FORM_FIELDS.some((f) => f.re.test(base))) return true;
  if (/:\s*$/.test(line)) return true;
  if (/^\d+[.)]\s+\S/.test(line.trim())) return true;
  const words = base.split(/\s+/);
  return words.length <= 3 && FORM_LABEL_WORDS.has(words[0]?.toLowerCase() ?? '');
};
const RE_LETTER_SPACED = /^\p{L}(?: \p{L})+(?: {2,}\p{L}(?: \p{L})*)*$/u;
/** Wyrazy tekstu rozstrzelonego („J A N   N O W A K" → ["JAN", "NOWAK"]) albo null. */
function letterSpacedWords(t: string): string[] | null {
  if (!RE_LETTER_SPACED.test(t)) return null;
  return t.split(/ {2,}/).map((w) => w.replace(/ /g, ''));
}
const RE_ADDR_PARTICLE = /^(m|lok|ul|al|os|pl|nr|im|św|gen|ks)\.?$/i;
/** Czy `value` to sensowna wartość danego rodzaju pola, a nie proza, etykieta czy „nie dotyczy”? */
export const isValidFormValue = (value: string, kind: FormKind): boolean => {
  const t = value.trim();
  if (!t || t.length > 70) return false;
  if (isEmptyFormValue(t)) return false;
  if (/^\d+[.)]\s/.test(t)) return false;
  if (/^(nie\b|nieznan|niepodan|do ustalenia|brak\b|b\/d)/i.test(t)) return false;
  if (kind === 'place') return RE_PROPER_WORDS.test(t);
  if (kind === 'name') {
    // Tekst rozstrzelony z PDF-a i OCR oceniamy po sklejeniu: rozstrzelona etykieta („P E S E L”)
    // i pojedyncza litera jako wyraz to nie imię i nazwisko.
    const spaced = letterSpacedWords(t);
    if (spaced) return spaced.length <= 4 && spaced.every((w) => w.length >= 2 && !FORM_LABEL_WORDS.has(w.toLowerCase()) && !STRUCT_KEYS.has(normStructKey(w)));
    // Etykieta to mocna kotwica, więc wielkość liter nie ma znaczenia; dalej 1–4 wyrazy z liter.
    // Tabulator to granica kolumny TSV, nie odstęp w nazwisku.
    return /^\p{L}[\p{L}'’.‑-]*(?: +\p{L}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'date') return /\d{4}|\d{1,2}[-.\/]\d{1,2}/.test(t);
  // Adres odrzuca zdanie: każdy wyraz to nazwa własna, token z cyfrą albo cząstka adresowa.
  const toks = t.split(/\s+/);
  if (toks.length > 5) return false;
  // Po skrócie typu ulicy („ul. Dolna”) wielka litera liczy się na nazwie.
  const head = t.replace(/^(?:ul|al|os|pl)\.[ \t]*/i, '');
  return (
    /^[\p{Lu}\d]/u.test(head) &&
    toks.every((w) => /^\p{Lu}/u.test(w) || /\d/.test(w) || RE_ADDR_PARTICLE.test(w))
  );
};
