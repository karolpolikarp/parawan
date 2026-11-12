// Klasy liter (polskie, obce w nazwiskach, granice wyrazu) i wspólne fragmenty wzorców
// wyrazów, z których budowane są regexy przebiegów.
import { JSON_ESC_PUA } from './context.js';
import { MASK } from './types.js';
import { escapeRe } from './util.js';

export const PL_UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
export const PL_LO = 'a-ząćęłńóśźż';
// Litery obcych nazwisk („Schröder”, „Dvořák”, „Mureșan”, „Thị”) wchodzą tylko w człony osoby
// i granice reguł osobowych; miasta, adresy i kotwice zostają przy polskim alfabecie. Obcy wyraz sam
// osobą się nie staje, potrzebne jest imię ze słownika, „Pan/Pani” albo inna kotwica.
// Wietnamskie U+1EA0–U+1EF9 idą na przemian: parzyste wielkie, nieparzyste małe.
const viLetters = (lower: number): string =>
  Array.from({ length: 45 }, (_, i) => String.fromCharCode(0x1ea0 + 2 * i + lower)).join('');
export const NM_UP = `${PL_UP}ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÔÕÖØÙÚÛÜÝÞĀĂĈĊČĎĐĒĔĖĚĜĞĠĢĤĦĨĪĬĮİĴĶĹĻĽĿŅŇŌŎŐŒŔŖŘŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŽȘȚƠƯƏ${viLetters(0)}`;
/** Małe litery obce (bez polskich): ogon nazwiska za polskim rdzeniem („Koval|čuk”). */
export const NM_LO_EXTRA = `ßàáâãäåæçèéêëìíîïðñòôõöøùúûüýþÿāăĉċčďđēĕėěĝğġģĥħĩīĭįıĵķĺļľŀņňōŏőœŕŗřŝşšţťŧũūŭůűųŵŷžșțơưə${viLetters(1)}`;
export const NM_LO = `${PL_LO}${NM_LO_EXTRA}`;
// Granica wyrazu w regułach osobowych: łacina z całą łaciną rozszerzoną (bez „×” i „÷”), żeby maska
// nie kończyła się w środku wyrazu. Zawiera wszystkie litery NM_UP i NM_LO („ə” U+0259 leży poza
// zakresami). Celowo bez znaków łączących U+0300–U+036F: granica na nich odsłaniałaby nazwisko w NFD.
export const NM_BOUND = 'A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u0259\\u1E00-\\u1EFF';

// Ucieczka „\n/\r/\t” w JSON-ie po passProtectJsonEscapes (backslash i znak PUA) liczy się jak biały
// znak, inaczej „Uniwersytet Adama\nMickiewicza” traciłby kontekst złożenia i stawał się osobą.
export const ESC_WS = `\\\\[${JSON_ESC_PUA}]`;

/** Wyraz z wielkiej litery i odstęp tuż przed pozycją (drugi człon złożenia). */
export const PRECEDED_BY_CAP = new RegExp(`[${PL_UP}][${PL_LO}]+(?:\\s|${ESC_WS})+$`);

export const CAP_WORD = `[${NM_UP}][${NM_LO}]+(?:-[${NM_UP}][${NM_LO}]+)?`;
// Wyraz małymi literami (czaty, e-maile, formularze bez wielkich liter); precyzję daje dopiero
// walidacja pary imię i nazwisko w przebiegu, sam wzorzec jest szeroki.
export const LO_WORD = `[${PL_LO}]+(?:-[${PL_LO}]+)?`;

// Miejscowości mają wielokrotne łączniki („Kędzierzyn-Koźle”), stąd „*”.
export const CAP_CITY = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)*`;
// Od jednego do trzech wyrazów nazwy miejscowości.
export const CITY_RUN = `(?:${CAP_CITY}[ \\t]+){0,2}${CAP_CITY}`;
// Lewa granica wzorców zaczynających się od CAP_CITY. Bez niej każdy człon łańcucha „Abc-Abc-…”
// skanuje go do końca (czas kwadratowy). Łącznik przed nazwą w wypunktowaniu („-Gliwice”) nie blokuje.
export const CITY_START = `(?<![${PL_UP}${PL_LO}]|[${PL_UP}${PL_LO}]-)`;
// Opcjonalny punkt listy przed wpisem („1. ”, „3) ”, „- ”).
export const LIST_BULLET = '(?:(?:\\d{1,4}[.)]|[-*•–])[ \\t]*)?';
export const MONTHS_GEN = 'stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia';
// Wzorce masek, na których kotwiczą przebiegi. Przebiegi wstawiają zawsze maski domyślne (własne
// z options.masks podstawia redactPII dopiero na końcu), więc wzorce są stałe.
// Maska osoby: etykieta pseudonimu albo maska IMIE.
export const PERSON_MASK_SRC = `\\[OSOBA-[A-Z]+\\]|${escapeRe(MASK.IMIE)}`;
export const ADR_MASK_SRC = escapeRe(MASK.ADRES);
export const KOD_MASK_SRC = escapeRe(MASK['KOD-POCZTOWY']);
export const DUR_MASK_SRC = escapeRe(MASK['DATA-UR']);
export const REJ_MASK_SRC = escapeRe(MASK['NR-REJESTRACYJNY']);

export const RE_CHAR_LL = /\p{Ll}/u;
export const RE_CHAR_LU = /\p{Lu}/u;
export const RE_CHAR_L = /\p{L}/u;
