/**
 * Jedno źródło tekstu wyjściowego. „Kopiuj”, „Pobierz” i wydruk biorą tekst wyłącznie
 * z finalText, więc nie rozjadą się z tym, co widać w wyniku: kolejna zmiana wyniku (np. ręczna
 * korekta, adnotacja) rozszerza tylko OutputState i tę funkcję, a nie każde wyjście osobno.
 * Bez DOM: moduł testuje vitest, a main.ts tylko podaje stan.
 */
export interface OutputState {
  /** Wynik redactPII dla bieżącego tekstu źródłowego (pusty napis = brak wyniku). */
  redacted: string;
}

export function finalText(s: OutputState): string {
  return s.redacted;
}

// Kodem, a nie ucieczką w napisie: biome format zamienia ją na niewidoczny znak w źródle.
const BOM = String.fromCharCode(0xfeff);

/**
 * Treść pobieranego pliku .txt albo .csv. BOM na początku: bez niego Word otwiera plik
 * z oknem wyboru kodowania, a Excel czyta CSV jako ANSI i psuje polskie litery. Końce wierszy
 * \r\n, bo Notatnik w starszym Windowsie i część programów urzędowych innych nie rozumie.
 * BOM, który przyszedł z tekstem, zdejmujemy, żeby plik nie zaczynał się od dwóch.
 */
export function textForDownload(text: string): string {
  const body = text.startsWith(BOM) ? text.slice(1) : text;
  return BOM + body.replace(/\r\n|\r|\n/g, '\r\n');
}

const p2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Tytuł dokumentu na czas druku. Przeglądarka bierze go na nazwę pliku w „Zapisz jako PDF”
 * i do nagłówka wydruku; zwykły tytuł strony nic nie mówi o tym, co jest na papierze.
 */
export function printTitle(d: Date): string {
  return `zanonimizowany-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

/** Nazwa pobieranego pliku: zanonimizowany-RRRR-MM-DD_GG-MM-SS.{ext}, nigdy z nazwy wczytanego pliku. */
export function downloadName(d: Date, ext: string): string {
  const time = `${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
  return `${printTitle(d)}_${time}.${ext}`;
}

export interface DownloadFile {
  name: string;
  type: string;
  content: string;
}

/**
 * Plik do pobrania. Znacznik czasu odróżnia kolejne pobrania („zanonimizowany (1).txt” nic nie
 * mówi). Nazwy wczytanego pliku NIE używamy: „umowa-najmu-Kowalska” przeszłaby jawna. Z pliku
 * bierzemy tylko rozszerzenie: rejestr wczytany z .csv wraca jako .csv, żeby Excel otworzył go
 * w kolumnach, a nie jako jeden długi tekst.
 */
export function downloadFor(text: string, sourceExt: string, d: Date): DownloadFile {
  const csv = sourceExt === 'csv';
  return {
    name: downloadName(d, csv ? 'csv' : 'txt'),
    type: csv ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8',
    content: textForDownload(text),
  };
}
