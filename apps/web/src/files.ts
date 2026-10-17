/**
 * Wczytywanie plików: wspólne narzędzia importu (bez DOM, więc testowalne w vitest).
 *
 * - `FileReadError` niesie komunikat gotowy do pokazania użytkownikowi. Każdy inny wyjątek
 *   (np. RangeError z głębi biblioteki) UI zamienia na ogólne „Nie udało się odczytać pliku.”,
 *   żeby surowy angielski tekst nie trafił na ekran.
 * - `decodeText` sam rozpoznaje kodowanie pliku tekstowego. `FileReader.readAsText` zakłada
 *   UTF-8, a pliki z Notatnika czy eksporty CSV z Excela często są w Windows-1250 (ANSI).
 *   Wtedy „Łukasz Wójcik” zamienia się w „�ukasz W�jcik” i przechodzi przez silnik jawne.
 * - `unsupportedFormat` odrzuca pliki binarne (stary .doc, .odt, obrazy, programy), zanim
 *   ich bajty trafią do pola jako „krzaki”, z których część danych prześlizgnęłaby się jawna.
 */

/** Błąd wczytywania z komunikatem po polsku, który można pokazać w interfejsie wprost. */
export class FileReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileReadError';
  }
}

/** Górny limit rozmiaru wczytywanego pliku. Większy plik i tak zamroziłby kartę. */
export const MAX_FILE_MB = 50;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

/** Rozszerzenie pliku małymi literami („Umowa.DOCX” → „docx”); pusty napis, gdy go brak. */
export function fileExt(name: string): string {
  return name.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? '';
}

export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1250';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

/**
 * Zdekoduj bajty pliku tekstowego. Kolejność: BOM UTF-16 (tak jak robiło `readAsText`),
 * potem ścisły UTF-8 (BOM UTF-8 dekoder zdejmuje sam), a gdy bajty nie są poprawnym UTF-8,
 * Windows-1250, czyli polskie „ANSI” z Notatnika i Excela.
 */
export function decodeText(buf: Uint8Array): DecodedText {
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buf), encoding: 'utf-16le' };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buf), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1250').decode(buf), encoding: 'windows-1250' };
  }
}

// Formaty, których nie czytamy, rozpoznawane po rozszerzeniu (sygnatury bajtów są niżej).
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff']);
const OFFICE_EXT = new Set([
  'doc', 'odt', 'rtf', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp', 'pages', 'numbers', 'key',
]);

/**
 * Czy plik (spoza ścieżek DOCX i PDF) nie nadaje się do odczytu jako tekst? Zwraca komunikat
 * dla użytkownika albo null. `head` to początek pliku (wystarczą 4 KB). Nie ma tu ścisłej
 * białej listy rozszerzeń, bo .xml, .json, .eml czy .html to zwykły tekst i mają działać.
 */
export function unsupportedFormat(name: string, head: Uint8Array): string | null {
  const ext = fileExt(name);
  const sig = (...bytes: number[]): boolean => bytes.every((v, i) => head[i] === v);
  const isImage =
    IMAGE_EXT.has(ext) ||
    sig(0xff, 0xd8, 0xff) || // JPEG
    sig(0x89, 0x50, 0x4e, 0x47) || // PNG
    sig(0x47, 0x49, 0x46, 0x38); // GIF
  if (isImage) {
    return (
      'To jest obraz, a Parawan czyta tylko tekst. Rozpoznawanie tekstu ze zdjęć i skanów ' +
      '(OCR) nie jest obsługiwane, wklej tekst ręcznie.'
    );
  }
  // Tekst w UTF-16 ma bajty zerowe, ale zaczyna się od BOM, więc go nie odrzucamy.
  const utf16Bom = sig(0xff, 0xfe) || sig(0xfe, 0xff);
  const isBinary =
    !utf16Bom &&
    (head.includes(0) ||
      sig(0xd0, 0xcf, 0x11, 0xe0) || // OLE: stary .doc/.xls, zahasłowany .docx
      sig(0x50, 0x4b, 0x03, 0x04) || // ZIP: .odt, .xlsx, .zip
      sig(0x4d, 0x5a)); // MZ: program .exe/.dll
  const isRtf = sig(0x7b, 0x5c, 0x72, 0x74, 0x66); // {\rtf
  if (!isBinary && !isRtf && !OFFICE_EXT.has(ext)) return null;
  // Rozszerzenie pokazujemy tylko, gdy wygląda na rozszerzenie (nazwa pliku bywa daną osobową).
  const shown = /^[a-z0-9]{1,5}$/.test(ext) ? ` (.${ext})` : '';
  return (
    `Tego pliku${shown} nie da się odczytać jako tekstu. Parawan czyta pliki tekstowe ` +
    '(TXT, MD, CSV i podobne), DOCX i PDF. Dokument z innego programu zapisz jako .docx ' +
    'albo PDF i wczytaj ponownie.'
  );
}

/** Czy bajty zaczynają się od nagłówka PDF („%PDF-”)? Pozwala czytać PDF bez rozszerzenia. */
export function looksLikePdf(head: Uint8Array): boolean {
  return [0x25, 0x50, 0x44, 0x46, 0x2d].every((v, i) => head[i] === v);
}
