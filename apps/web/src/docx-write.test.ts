import { redactPII } from 'anonimizator';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from 'vitest';
import { extractDocxText } from './docx';
import { buildDocx, DOCX_DEFAULT_TITLE, stripXmlInvalid, xmlText } from './docx-write';
import webMain from './main.ts?raw';
import { crc32 } from './zip';

// Przykład z przycisku „Przykład” (main.ts), żeby test szedł na tym samym piśmie co aplikacja.
const EXAMPLE_TEXT = /const EXAMPLE_TEXT = `([^`]+)`/.exec(webMain)?.[1] ?? '';

const PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/document.xml',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
  'word/settings.xml',
  'docProps/core.xml',
];

const parts = (buf: Uint8Array): Record<string, string> =>
  Object.fromEntries(Object.entries(unzipSync(buf)).map(([k, v]) => [k, strFromU8(v)]));

const documentXml = (text: string): string => parts(buildDocx(text))['word/document.xml'];

// extractDocxText pomija puste akapity (docx.ts), więc porównujemy bez pustych wierszy.
const collapse = (s: string): string =>
  s
    .split('\n')
    .filter((l) => l !== '')
    .join('\n');

const TABELA = 'Lp.\tImię\tNazwisko\n1.\t[IMIĘ I NAZWISKO]\tŻółć\n\nZażółć gęślą jaźń.\n2.\t\tŚliwa';

test('przykład z aplikacji jest w teście i ma znaczniki', () => {
  expect(EXAMPLE_TEXT).toContain('PESEL');
  expect(redactPII(EXAMPLE_TEXT).redacted).toContain('[PESEL]');
});

test('dokładnie siedem części o ustalonych nazwach', () => {
  const zip = unzipSync(buildDocx(redactPII(EXAMPLE_TEXT).redacted));
  expect(Object.keys(zip)).toEqual(PARTS);
});

test('żadna część nie ma autora, ostatniego edytującego, rsid ani dat', () => {
  const all = Object.values(parts(buildDocx(redactPII(EXAMPLE_TEXT).redacted)));
  for (const xml of all) {
    expect(xml).not.toMatch(/creator|lastModifiedBy|rsid|dcterms:created|dcterms:modified/i);
  }
});

test('właściwości: tylko tytuł i język polski, tytuł z ucieczką', () => {
  const core = parts(buildDocx('a'))['docProps/core.xml'];
  expect(core).toContain(`<dc:title>${DOCX_DEFAULT_TITLE}</dc:title>`);
  expect(core).toContain('<dc:language>pl-PL</dc:language>');
  expect(core.match(/<dc:\w+>/g)).toEqual(['<dc:title>', '<dc:language>']);
  expect(parts(buildDocx('a', { title: 'Odpowiedź <BIP> & "wniosek"' }))['docProps/core.xml']).toContain(
    '<dc:title>Odpowiedź &lt;BIP&gt; &amp; &quot;wniosek&quot;</dc:title>',
  );
});

test('style: Arial 11 pt, interlinia 1,15, 6 pt po akapicie, pl-PL; relacja do stylów', () => {
  const p = parts(buildDocx('a'));
  expect(p['word/styles.xml']).toContain('w:ascii="Arial"');
  expect(p['word/styles.xml']).toContain('<w:sz w:val="22"/>');
  expect(p['word/styles.xml']).toContain('w:after="120" w:line="276"');
  expect(p['word/styles.xml']).toContain('<w:lang w:val="pl-PL"');
  expect(p['word/styles.xml']).toContain('w:styleId="Normal"');
  expect(p['word/_rels/document.xml.rels']).toContain('Target="styles.xml"');
  expect(p['[Content_Types].xml']).toContain('/word/styles.xml');
});

test('ten sam tekst daje te same bajty', () => {
  const t = redactPII(EXAMPLE_TEXT).redacted;
  expect(buildDocx(t)).toEqual(buildDocx(t));
});

test('tekst wraca z dokumentu: przykład z aplikacji', () => {
  const t = redactPII(EXAMPLE_TEXT).redacted;
  expect(extractDocxText(buildDocx(t))).toBe(collapse(t));
});

test('tekst wraca z dokumentu: tabulatory, polskie litery, puste wiersze, \\r\\n', () => {
  expect(extractDocxText(buildDocx(TABELA))).toBe(collapse(TABELA));
  expect(extractDocxText(buildDocx('Ala\r\nma\rkota'))).toBe('Ala\nma\nkota');
});

test('tabulator to <w:tab/>, pusty wiersz to pusty akapit', () => {
  const xml = documentXml('Lp.\tImię\n\nKoniec');
  expect(xml).toContain('<w:t xml:space="preserve">Lp.</w:t><w:tab/><w:t xml:space="preserve">Imię</w:t>');
  expect(xml).toContain('</w:p><w:p/><w:p>');
});

test('znacznik w osobnym runie z pogrubieniem, reszta bez', () => {
  const xml = documentXml('PESEL: [PESEL], tel. [TELEFON] i [OSOBA-B]');
  expect(xml).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">[PESEL]</w:t></w:r>');
  expect(xml).toContain('<w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">[OSOBA-B]</w:t></w:r>');
  expect(xml).toContain('<w:r><w:t xml:space="preserve">PESEL: </w:t></w:r>');
  // nawias kwadratowy bez znanego tokenu nie jest pogrubiany
  expect(documentXml('art. [uchylony]')).not.toContain('<w:b/>');
});

// Kody znaków zamiast ucieczek w napisie: formatowanie zamienia ucieczkę U+FFFE w źródle na niewidoczny znak.
const ch = (...codes: number[]): string => String.fromCharCode(...codes);
const BAD = [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0xfffe, 0xffff];

test('ucieczka XML i usunięte znaki spoza XML 1.0', () => {
  const xml = documentXml(`a & b <c> "d"${ch(...BAD)} e`);
  expect(xml).toContain('a &amp; b &lt;c&gt; &quot;d&quot; e');
  for (const c of BAD) expect(xml.includes(ch(c)), `U+${c.toString(16)}`).toBe(false);
  expect(xmlText(`${ch(0)}x${ch(1)}`)).toBe('x');
  // „\u0001” z treści nie wraca też przez extractDocxText
  expect(extractDocxText(buildDocx(`A${ch(1)}B`))).toBe('AB');
  // dozwolone zostają: tabulator, polskie litery, emoji (para surogatów)
  expect(stripXmlInvalid('Ż\tó\u{1F600}')).toBe('Ż\tó\u{1F600}');
});

test('dodatek po podziale strony, bez pustego akapitu na górze strony', () => {
  const xml = parts(buildDocx('Treść', { appendix: ['Adnotacja', 'Data: 1.01.2026'] }))['word/document.xml'];
  expect(xml).toContain(
    '<w:p><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve">Adnotacja</w:t></w:r></w:p>',
  );
  expect(xml.indexOf('Treść')).toBeLessThan(xml.indexOf('w:type="page"'));
  expect(xml.match(/w:type="page"/g)).toHaveLength(1);
});

test('ustawienia: tylko tryb zgodności 15, bez rsid, zmiennych i szablonu', () => {
  const settings = parts(buildDocx('a'))['word/settings.xml'];
  expect(settings).toContain('w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"');
  expect(settings).not.toMatch(/rsid|docVars|attachedTemplate|w:proofState/);
  expect(parts(buildDocx('a'))['word/_rels/document.xml.rels']).toContain('Target="settings.xml"');
});

test('dokument A4', () => {
  expect(documentXml('a')).toContain('<w:pgSz w:w="11906" w:h="16838"/>');
});

test('crc32 zgodny ze wzorcem', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array(0))).toBe(0);
});
