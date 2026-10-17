// Wyciąga tekst z PDF tym samym pdf.js (wersja legacy z repo), który siedzi w Parawanie.
// Służy do sprawdzenia, co aplikacja zobaczy w piśmie, i do porównania wydruku „Zapisz jako PDF”
// z wynikiem (np. czy w wydruku nie zostało pole źródła).
// Użycie: node scripts/e2e/manual/pdftext.mjs <plik.pdf> [od-strony] [do-strony]
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const [file, fromArg, toArg] = process.argv.slice(2);
if (!file) {
  console.error('Użycie: node pdftext.mjs <plik.pdf> [od-strony] [do-strony]');
  process.exit(1);
}
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  disableFontFace: true,
  useSystemFonts: true,
}).promise;
const from = Number(fromArg ?? 1);
const to = Math.min(Number(toArg ?? doc.numPages), doc.numPages);
for (let p = from; p <= to; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  let s = '';
  for (const it of tc.items) if ('str' in it) s += it.str + (it.hasEOL ? '\n' : ' ');
  console.log(`\n===== STRONA ${p} =====\n${s}`);
}
