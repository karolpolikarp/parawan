// Buduje krótkie fikcyjne pismo w czterech formatach: pismo.docx, pismo.odt i pismo.rtf
// (minimalne pakiety, jak z prostego edytora) oraz pismo.pdf (wydruk z Chromium, jak „Zapisz
// jako PDF”). Treść to przykład z aplikacji, więc wszystkie formaty dają te same znaczniki.
// Większe pisma z tabelami i nagłówkiem urzędu buduje zbuduj-pisma-docx.py.
// Użycie: node scripts/e2e/manual/zbuduj-pisma.mjs [katalog-wyjściowy]
// Domyślnie apps/web/src/fixtures/urzad (nadpisuje pliki w repo).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIX = path.join(ROOT, 'apps/web/src/fixtures/urzad');
const out = path.resolve(process.argv[2] ?? FIX);
mkdirSync(out, { recursive: true });

const paras = [
  'Urząd Gminy Testowo, ul. Długa 5, 00-950 Warszawa',
  'Znak sprawy: OR.1234.5.2026',
  'Na wniosek Pani Anny Kowalskiej, PESEL 44051401359, zamieszkałej przy ul. Polnej 12/3, 00-950 Warszawa, tel. 600 700 800, e-mail anna.kowalska@example.com, orzekam o zwrocie opłaty na rachunek PL61 1090 1014 0000 0712 1981 2874.',
  'Sprawę prowadzi Jan Bąkiewicz, inspektor.',
];

const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`;
writeFileSync(
  path.join(out, 'pismo.docx'),
  zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': strToU8(docXml),
  }),
);

// ODT: plik mimetype musi być pierwszy i bez kompresji (wymóg ODF).
const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:text>${paras.map((p) => `<text:p>${p}</text:p>`).join('')}</office:text></office:body></office:document-content>`;
writeFileSync(
  path.join(out, 'pismo.odt'),
  zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>',
    ),
    'content.xml': strToU8(contentXml),
  }),
);

// RTF (KRI dopuszcza go obok DOCX i ODT): polskie litery jako \'xx w stronie kodowej cp1250,
// tak zapisuje je WordPad.
const cp = { ą: 'b9', ę: 'ea', ł: 'b3', ó: 'f3', ż: 'bf', ś: '9c', ć: 'e6', ń: 'f1', ź: '9f', Ł: 'a3', Ś: '8c', Ż: 'af' };
const rtfBody = paras.map((p) => `${p.replace(/[ąęłóżśćńźŁŚŻ]/g, (c) => `\\'${cp[c]}`)}\\par`).join('\n');
writeFileSync(
  path.join(out, 'pismo.rtf'),
  `{\\rtf1\\ansi\\ansicpg1250\\deff0{\\fonttbl{\\f0\\fswiss\\fcharset238 Arial;}}\\f0\\fs24\n${rtfBody}\n}\n`,
);

// PDF: ta sama treść z pogrubionym tytułem, wydrukowana silnikiem Chromium.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const html = `<!doctype html><html lang="pl"><meta charset="utf-8"><title>Pismo</title><body style="font-family:Arial, sans-serif;font-size:12pt"><p>${esc(paras[0])}</p><p>${esc(paras[1])}</p><p><b>Decyzja</b></p><p>${esc(paras[2])}</p><p>${esc(paras[3])}</p></body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html);
await page.pdf({ path: path.join(out, 'pismo.pdf'), format: 'A4' });

// Decyzja z fixtures jako PDF „z Worda”: Times, akapit wyjustowany, podpis wójta z prawej.
const decyzja = readFileSync(path.join(FIX, 'decyzja.txt'), 'utf8').replace(/\r\n/g, '\n');
const body = decyzja
  .split('\n')
  .map((l) =>
    l.startsWith('/-/') || l.startsWith('Wójt Gminy Brzozowa Wola')
      ? `<p style="text-align:right;margin:0">${esc(l)}</p>`
      : `<p style="margin:0 0 4pt 0">${esc(l) || '&nbsp;'}</p>`,
  )
  .join('');
await page.setContent(
  `<html><body style="font:12pt 'Times New Roman';text-align:justify;hyphens:auto" lang="pl">${body}</body></html>`,
);
await page.pdf({
  path: path.join(out, 'decyzja.pdf'),
  format: 'A4',
  margin: { top: '2cm', bottom: '2cm', left: '2.5cm', right: '2cm' },
});
await browser.close();
console.log(`ok: ${out}`);
