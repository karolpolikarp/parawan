export const PL_UP = 'A-ZĄĆĘŁŃÓŚŹŻ';
export const PL_LO = 'a-ząćęłńóśźż';
// Litery obcych nazwisk (niemieckie, czeskie, słowackie, francuskie, hiszpańskie, węgierskie,
// skandynawskie, tureckie) — TYLKO w członach osoby i w granicach reguł osobowych: „Schröder",
// „Müller", „Dvořák", „Čapek", „Peña". Klasy PL_* ich nie znały, więc „Anna Schröder" dawała
// „[IMIĘ I NAZWISKO]öder" (dopasowanie kończyło się przed „ö"), a „Jan Müller" czy „Pan Müller"
// przechodziły w całości. Miasta, adresy i kotwice zostają przy polskim alfabecie; obcy wyraz sam
// osobą się nie staje — potrzebne jest imię ze słownika, wyzwalacz „Pan/Pani" albo inna kotwica.
// Do tego rumuńskie „ș ț" z przecinkiem, azerskie „ə" i wietnamskie litery z kropką lub hakiem
// („Mureșan", „Thị", „Kiệt"). Bez nich maska kończyła się w środku wyrazu („Pani [..]șan", „Pani
// [..]ị Hoa"). Wietnamskie U+1EA0–U+1EF9 idą na przemian: parzyste wielkie, nieparzyste małe.
const VI_LETTERS = (lower: number): string =>
  Array.from({ length: 45 }, (_, i) => String.fromCharCode(0x1ea0 + 2 * i + lower)).join('');
export const NM_UP = `${PL_UP}ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÔÕÖØÙÚÛÜÝÞĀĂĈĊČĎĐĒĔĖĚĜĞĠĢĤĦĨĪĬĮİĴĶĹĻĽĿŅŇŌŎŐŒŔŖŘŜŞŠŢŤŦŨŪŬŮŰŲŴŶŸŽȘȚƠƯƏ${VI_LETTERS(0)}`;
/** Małe litery obce (bez polskich) — ogon nazwiska za polskim rdzeniem („Koval|čuk", „Bondar|čuk"). */
export const NM_LO_EXTRA = `ßàáâãäåæçèéêëìíîïðñòôõöøùúûüýþÿāăĉċčďđēĕėěĝğġģĥħĩīĭįıĵķĺļľŀņňōŏőœŕŗřŝşšţťŧũūŭůűųŵŷžșțơưə${VI_LETTERS(1)}`;
export const NM_LO = `${PL_LO}${NM_LO_EXTRA}`;
// GRANICA wyrazu w regułach osobowych: litery członów i do tego cała łacina rozszerzona (Latin-1,
// Extended-A/B, Extended Additional). Litera spoza klas członów nie może zakończyć dopasowania
// w środku wyrazu: maska ucinała wtedy nazwisko i zostawiała jawny ogon. Bez „×" i „÷", które w tym
// zakresie leżą, a literami nie są. Celowo BEZ znaków łączących (U+0300–U+036F): tekst w rozkładzie
// NFD (litera i osobny znak akcentu) dawał dotąd maskę z ogonem, a granica na nich oddawałaby całe
// nazwisko jawne. To osobna klasa (normalizacja wejścia).
export const NM_BOUND = `${NM_UP}${NM_LO}\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u1E00-\\u1EFF`;

// Dosłowna ucieczka „\n/\r/\t" po podmianie w passProtectJsonEscapes (backslash + znak PUA). Dla
// strażników kontekstu („poprzedni wyraz") liczy się jak biały znak — inaczej „Uniwersytet
// Adama\nMickiewicza" w JSON-ie gubił kontekst złożenia, który ten sam tekst z prawdziwą nową
// linią ma, i nazwa uczelni stawała się osobą.
const ESC_WS = '\\\\[\\uE009\\uE00A\\uE00D]';

// Hoisted (nie budować w callbacku .replace — inaczej kompilacja regexu per-match).
// Sprawdza, czy tuż przed dopasowaniem stoi WYRAZ z wielkiej litery + spacja (2. człon złożenia).
export const PRECEDED_BY_CAP = new RegExp(`[${PL_UP}][${PL_LO}]+(?:\\s|${ESC_WS})+$`);

// Regexy reguł IMIĘ skompilowane RAZ na moduł (nie przy każdym wywołaniu redactPII).
// Kotwica PL-aware zamiast ASCII \b (działa przed Ł/Ś/Ż/Ą). Bezstanowe użycie przez .replace
// (String.replace zeruje lastIndex), więc współdzielenie RE_PAIR między krokami (a2)/(a3) jest bezpieczne.
export const CAP_WORD = `[${NM_UP}][${NM_LO}]+(?:-[${NM_UP}][${NM_LO}]+)?`;
// Ciąg wyrazów MAŁYMI literami — niechlujny zapis (czaty, e-maile, formularze bez wielkich liter).
// Sam wzorzec jest szeroki (łapie całe zdania); PRECYZJĘ daje walidacja w callbacku (a4), która
// szuka W CIĄGU sąsiedztwa „imię (słownik) + nazwisko (morfologia/słownik)" i maskuje TYLKO tę parę.
// Skan całego ciągu (zamiast sztywnej pary) rozwiązuje konsumpcję sąsiadów: „od jan kowalski",
// „z marek górski" — wiodący przyimek nie zjada imienia. Lewa granica odcina fragmenty
// e-maili/URL-i/domen (poprzedzający znak nie może być literą, myślnikiem, „@", kropką ani „/").
export const LO_WORD = `[${PL_LO}]+(?:-[${PL_LO}]+)?`;

// Wyraz z wielkiej litery z myślnikami wielokrotnymi (miejscowości: „Kędzierzyn-Koźle") — '*' (nie '?').
export const CAP_CITY = `[${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)*`;
// Lewa granica wzorców ZACZYNAJĄCYCH się od CAP_CITY (bez innej kotwicy przed nim): start w środku
// wyrazu albo łańcucha „Abc-Abc-…" odpada. Bez niej każdy człon łańcucha skanował go do końca
// (czas kwadratowy, ~5 s na 100 tys. znaków). Sam myślnik przed nazwą (wypunktowanie „-Gliwice")
// granicy nie blokuje — tylko myślnik doklejony do poprzedniego wyrazu.
export const CITY_START = `(?<![${PL_UP}${PL_LO}]|[${PL_UP}${PL_LO}]-)`;
/** Escapuje metaznaki regexu w literale (do budowy wzorca z placeholdera maski). */
export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Wyraz tuż przed pozycją — do sprawdzenia kontekstu nie-osobowego. `cap`: wyraz od wielkiej litery
 * w tej samej linii, oddzielony samymi spacjami (rzeczownik na początku zdania: „Objaw Babińskiego").
 * Tabulator to granica komórki TSV („IT\tTest\tNowak") — sąsiednia kolumna nie jest kontekstem.
 * Poza tym, jak dotąd, ostatni ciąg małych liter (także przez nową linię: nagłówek „Zespół\nKowalski"
 * nie wyłącza osoby z następnego wiersza, bo „espół" nie jest na liście). Skan wstecz po znakach
 * w oknie 40 znaków: regex z „$" próbowany od każdej pozycji okna kosztował przy każdym kandydacie.
 */
export const RE_CHAR_LL = /\p{Ll}/u;
export const RE_CHAR_LU = /\p{Lu}/u;
export const RE_CHAR_L = /\p{L}/u;
