/**
 * Ekstrakcja tekstu z PDF — w całości lokalnie (pdf.js, legacy build).
 *
 * Build single-file nie może dołączyć osobnego pliku workera, więc moduł workera
 * importujemy NA GŁÓWNYM WĄTKU i podstawiamy jako `globalThis.pdfjsWorker` —
 * pdf.js wykrywa go i używa „fake workera" (oficjalna ścieżka awaryjna).
 * Dla naszego zastosowania (jeden dokument, sama warstwa tekstu) to w zupełności
 * wystarcza. Legacy build działa też w Node, więc ten moduł jest testowalny w vitest.
 */

import { getDocument, InvalidPDFException, PasswordException } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { FileReadError } from './files';

(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;

/** Konstruktor strumienia; testy podstawiają własną klasę zamiast globalnej. */
type StreamCtor = { prototype: object };

/**
 * pdf.js 6 czyta tekst strony przez `for await` po ReadableStream (getTextContent), a Chrome
 * i Edge mają tę iterację dopiero od wersji 124. Edge 109, ostatni dla Windows 7, 8.1 i Server
 * 2012 R2 (także na starych farmach RDS), i przeglądarki zamrożone zasadą TargetVersionPrefix
 * czytały tekst i DOCX, a każdy PDF kończył się błędem, który wyglądał na zepsuty plik. Dopisujemy
 * więc iterację przez getReader(), tylko gdy jej brak: wbudowanej nie podmieniamy. Zwraca true,
 * gdy dopisała.
 */
export function ensureStreamIteration(
  RS: StreamCtor | undefined = (globalThis as { ReadableStream?: StreamCtor }).ReadableStream,
): boolean {
  if (!RS || Symbol.asyncIterator in RS.prototype) return false;
  // bez enumerable, czyli jak wbudowana: niewidoczna w for…in
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: async function* (this: ReadableStream<unknown>) {
      const reader = this.getReader();
      try {
        for (;;) {
          const r = await reader.read();
          if (r.done) return;
          yield r.value;
        }
      } finally {
        // przerwana pętla nie może zostawić strumienia zablokowanego dla następnego czytelnika
        reader.releaseLock();
      }
    },
  });
  return true;
}

// Raz, przy imporcie modułu, czyli przed pierwszym getDocument.
ensureStreamIteration();

/**
 * Wyjątek spoza FileReadError przy czytaniu stron to najczęściej brak czegoś w silniku
 * przeglądarki, a nie wada pliku, więc komunikat nie każe szukać innego PDF-a.
 */
export const PDF_ENGINE_ERROR =
  'Nie udało się odczytać tekstu z tego PDF-a. Jeśli plik otwiera się w innym programie, ' +
  'otwórz Parawan w aktualnym Edge, Chrome albo Firefoksie i spróbuj ponownie.';

/** Wyciągnij warstwę tekstową z PDF-a. Rzuca FileReadError z polskim komunikatem. */
export async function extractPdfText(buf: Uint8Array): Promise<string> {
  const task = getDocument({
    data: buf,
    disableFontFace: true,
    useSystemFonts: true,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch (err) {
    if (err instanceof PasswordException) {
      throw new FileReadError('Ten PDF jest zabezpieczony hasłem. Zdejmij hasło i spróbuj ponownie.');
    }
    if (err instanceof InvalidPDFException) {
      throw new FileReadError('Nie udało się odczytać pliku: to nie wygląda na poprawny PDF.');
    }
    throw new FileReadError('Nie udało się odczytać tego pliku PDF.');
  }

  try {
    const pages: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const parts: string[] = [];
      for (const item of tc.items) {
        if ('str' in item) {
          parts.push(item.str);
          parts.push(item.hasEOL ? '\n' : ' ');
        }
      }
      pages.push(parts.join('').replace(/[ \t]+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim());
    }
    const text = pages.filter(Boolean).join('\n\n').trim();
    if (!text) {
      throw new FileReadError(
        'Ten PDF nie ma warstwy tekstowej, to pewnie skan. Rozpoznawanie tekstu ze skanów ' +
          '(OCR) nie jest obsługiwane, wklej tekst ręcznie.',
      );
    }
    return text;
  } catch (err) {
    if (err instanceof FileReadError) throw err;
    throw new FileReadError(PDF_ENGINE_ERROR);
  } finally {
    // destroy żyje na loading tasku (w v6 dokument nie ma własnego destroy)
    void task.destroy();
  }
}
