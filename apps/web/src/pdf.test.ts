import { expect, test } from 'vitest';
import { extractPdfText } from './pdf';

/**
 * Budujemy minimalny, POPRAWNY PDF (ASCII ⇒ offsety bajtowe == długości stringów),
 * żeby test nie zależał od zewnętrznych plików binarnych.
 */
function buildMinimalPdf(text: string): Uint8Array {
  const header = '%PDF-1.4\n';
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n',
    `4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n`,
    '5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n',
  ];
  let offset = header.length;
  const offsets: number[] = [];
  for (const o of objects) {
    offsets.push(offset);
    offset += o.length;
  }
  const pad = (n: number) => String(n).padStart(10, '0');
  const xref =
    'xref\n0 6\n0000000000 65535 f \n' + offsets.map((o) => `${pad(o)} 00000 n \n`).join('');
  const trailer = `trailer<</Size 6/Root 1 0 R>>\nstartxref\n${offset}\n%%EOF`;
  return new TextEncoder().encode(header + objects.join('') + xref + trailer);
}

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
