import { expect, test } from 'vitest';
import { FileReadError } from './files';
import { ensureStreamIteration, extractPdfText, PDF_ENGINE_ERROR } from './pdf';
import { buildMinimalPdf } from './pdf-fixture';

test('wyciąga tekst z poprawnego PDF-a', async () => {
  const pdf = buildMinimalPdf('PESEL 44051401359, Jan Kowalski');
  const text = await extractPdfText(pdf);
  expect(text).toContain('PESEL 44051401359');
  expect(text).toContain('Jan Kowalski');
});

test('plik niebędący PDF-em odrzucony z polskim komunikatem', async () => {
  await expect(extractPdfText(new TextEncoder().encode('to nie pdf'))).rejects.toThrow(
    /nie wygląda na poprawny PDF/,
  );
});

test('PDF bez warstwy tekstowej (pusta strona) → komunikat o skanie', async () => {
  const pdf = buildMinimalPdf('');
  await expect(extractPdfText(pdf)).rejects.toThrow(/warstwy tekstowej/);
});

test('błędy PDF to FileReadError (UI pokazuje je wprost, bez surowych wyjątków)', async () => {
  await expect(extractPdfText(new TextEncoder().encode('to nie pdf'))).rejects.toBeInstanceOf(
    FileReadError,
  );
  await expect(extractPdfText(buildMinimalPdf(''))).rejects.toBeInstanceOf(FileReadError);
});

/* ── Iteracja strumieni w starszych przeglądarkach (Chrome i Edge 109–123) ── */

/** Strumień bez wbudowanej iteracji, jak ReadableStream w Chrome 109: same getReader(). */
function streamClass() {
  return class {
    released = 0;
    constructor(private readonly chunks: string[]) {}
    getReader() {
      const left = [...this.chunks];
      return {
        read: async () =>
          left.length ? { done: false, value: left.shift() } : { done: true, value: undefined },
        releaseLock: () => {
          this.released++;
        },
      };
    }
  };
}

test('ensureStreamIteration dopisuje for await do strumienia bez iteracji', async () => {
  const Stream = streamClass();
  expect(Symbol.asyncIterator in Stream.prototype).toBe(false);
  expect(ensureStreamIteration(Stream)).toBe(true);
  // jak wbudowana: niewidoczna w for…in
  expect(Object.getOwnPropertyDescriptor(Stream.prototype, Symbol.asyncIterator)?.enumerable).toBe(false);

  const s = new Stream(['a', 'b', 'c']);
  const got: string[] = [];
  for await (const v of s as unknown as AsyncIterable<string>) got.push(v);
  expect(got).toEqual(['a', 'b', 'c']);
  expect(s.released).toBe(1);

  // przerwana pętla też zwalnia blokadę czytelnika
  const early = new Stream(['x', 'y']);
  for await (const v of early as unknown as AsyncIterable<string>) {
    expect(v).toBe('x');
    break;
  }
  expect(early.released).toBe(1);
  // drugie wywołanie niczego nie zmienia
  expect(ensureStreamIteration(Stream)).toBe(false);
});

test('ensureStreamIteration nie nadpisuje istniejącej iteracji', () => {
  const Stream = streamClass();
  const own = async function* () {};
  Object.defineProperty(Stream.prototype, Symbol.asyncIterator, { value: own, configurable: true });
  expect(ensureStreamIteration(Stream)).toBe(false);
  expect((Stream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator]).toBe(own);
  // wbudowany ReadableStream (Node, nowe przeglądarki) zostaje nietknięty
  const native = (ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator];
  expect(ensureStreamIteration()).toBe(false);
  expect((ReadableStream.prototype as unknown as Record<symbol, unknown>)[Symbol.asyncIterator]).toBe(native);
  // bez ReadableStream w ogóle (bardzo stary silnik) funkcja nic nie robi i nie rzuca
  expect(ensureStreamIteration(undefined)).toBe(false);
});

test('PDF bez wbudowanej iteracji strumieni: komunikat o przeglądarce, a po łatce tekst', async () => {
  // Node ma iterację wbudowaną, więc zabieramy ją na czas testu: tak wygląda Chrome 109.
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
  const native = Object.getOwnPropertyDescriptor(proto, Symbol.asyncIterator);
  expect(native).toBeDefined();
  delete proto[Symbol.asyncIterator];
  try {
    const pdf = buildMinimalPdf('PESEL 44051401359, Jan Kowalski');
    // bez łatki pdf.js wywraca się na `for await` (w Chrome 109: „t is not async iterable”)
    const err = await extractPdfText(pdf).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FileReadError);
    expect((err as Error).message).toBe(PDF_ENGINE_ERROR);
    expect(PDF_ENGINE_ERROR).toContain('aktualnym Edge, Chrome albo Firefoksie');

    expect(ensureStreamIteration()).toBe(true);
    const text = await extractPdfText(buildMinimalPdf('PESEL 44051401359, Jan Kowalski'));
    expect(text).toContain('PESEL 44051401359');
    expect(text).toContain('Jan Kowalski');
  } finally {
    if (native) Object.defineProperty(proto, Symbol.asyncIterator, native);
  }
});

test('komunikat o przeglądarce: bez wtrąceń „ — ”, „100%” i „nas/nam/nasz”', () => {
  expect(PDF_ENGINE_ERROR).not.toContain(' — ');
  expect(PDF_ENGINE_ERROR).not.toContain('100%');
  expect(PDF_ENGINE_ERROR).not.toMatch(/\b(nas|nam|nasz\w*)\b/i);
});
