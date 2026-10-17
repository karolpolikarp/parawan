// Pierwsza strona PDF jako jeden napis JSON (z \n na końcach wierszy). Krótsza odmiana
// pdftext.mjs do porównań: widać dokładnie, gdzie pdf.js łamie wiersze i wstawia spacje.
// Użycie: node scripts/e2e/manual/pdfout.mjs <plik.pdf>
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2];
if (!file) {
  console.error('Użycie: node pdfout.mjs <plik.pdf>');
  process.exit(1);
}
const doc = await pdfjs.getDocument({
  data: new Uint8Array(readFileSync(file)),
  disableFontFace: true,
  useSystemFonts: true,
}).promise;
const page = await doc.getPage(1);
const tc = await page.getTextContent();
let s = '';
for (const it of tc.items) if ('str' in it) s += it.str + (it.hasEOL ? '\n' : ' ');
console.log(JSON.stringify(s));
