/**
 * Zapis wyniku jako NOWY dokument Worda (.docx), bez DOM.
 *
 * Plik powstaje od zera z samego tekstu wyniku, więc nie ma w nim niczego, co niesie oryginał:
 * autora, ostatniego edytującego, komentarzy, historii zmian, identyfikatorów sesji edycji (rsid),
 * szablonu z loginem w ścieżce. Dlatego dokładnie siedem części: typy zawartości, relacje pakietu,
 * treść, relacje treści (style i ustawienia), style, ustawienia i właściwości z samym tytułem
 * i językiem. Bez app.xml (nazwa programu i firmy). settings.xml ma tylko tryb zgodności Word 2013+:
 * bez niego Word otwiera plik w „trybie zgodności” i nie uruchamia sprawdzania ułatwień dostępu
 * (sprawdzone przez COM). Żadnych rsid, zmiennych dokumentu ani szablonu.
 *
 * Wiersz wyniku to akapit, tabulator to `<w:tab/>`, znacznik [TOKEN] to osobny run z pogrubieniem.
 * Język pl-PL w stylach domyślnych: czytnik ekranu czyta tekst po polsku, a sprawdzanie ułatwień
 * dostępu w Wordzie nie zgłasza braku języka. Układ i tabele oryginału nie są przenoszone.
 *
 * ZIP bez kompresji ze stałą datą 1980-01-01 (storeZip w zip.ts): ten sam tekst daje te same
 * bajty, a kod deflate z fflate nie powiększa pliku aplikacji o kolejne 10 kB.
 */

import { MASK_TOKEN_RE } from './pii-meta';
import { storeZip } from './zip';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const DOCX_DEFAULT_TITLE = 'Dokument po anonimizacji';

export interface DocxOptions {
  /** dc:title we właściwościach dokumentu (Word pokazuje go w Plik › Informacje). */
  title?: string;
  /** Akapity dopisywane po podziale strony (np. adnotacja o wyłączeniu jawności). */
  appendix?: string[];
}

// Znak dozwolony w XML 1.0: z kodów sterujących tylko tabulator i końce wierszy, poza nimi
// wszystko od spacji bez U+FFFE i U+FFFF. Inny znak w treści (np. U+0001 ze skopiowanego
// starego programu) i Word odmawia otwarcia pliku: „zawartość jest nieczytelna”. Kodami,
// a nie wyrażeniem regularnym: biome nie przepuszcza kodów sterujących w regexie, a formatowanie
// zamienia ucieczki w rodzaju U+FFFE w źródle na niewidoczne znaki.
const isXmlChar = (c: number): boolean =>
  c >= 0x20 ? c !== 0xfffe && c !== 0xffff : c === 0x09 || c === 0x0a || c === 0x0d;

/** Tekst bez znaków spoza XML 1.0 (zwykle zwraca ten sam napis bez kopiowania). */
export function stripXmlInvalid(s: string): string {
  let i = 0;
  while (i < s.length && isXmlChar(s.charCodeAt(i))) i++;
  if (i === s.length) return s;
  let out = s.slice(0, i);
  for (; i < s.length; i++) if (isXmlChar(s.charCodeAt(i))) out += s[i];
  return out;
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Tekst do treści elementu albo atrybutu XML: ucieczka i bez znaków spoza XML 1.0. */
export function xmlText(s: string): string {
  return stripXmlInvalid(s).replace(/[&<>"]/g, (c) => ESC[c]);
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Treść jednego runu: odcinki tekstu rozdzielone `<w:tab/>`. */
function runBody(s: string): string {
  return s
    .split('\t')
    .map((part) => (part ? `<w:t xml:space="preserve">${xmlText(part)}</w:t>` : ''))
    .join('<w:tab/>');
}

/** Akapit z wiersza wyniku; znaczniki w osobnych runach z pogrubieniem. `lead` wchodzi na początek. */
function paragraph(line: string, lead = ''): string {
  const clean = stripXmlInvalid(line);
  let runs = lead;
  let at = 0;
  for (const m of clean.matchAll(MASK_TOKEN_RE)) {
    const i = m.index ?? 0;
    if (i > at) runs += `<w:r>${runBody(clean.slice(at, i))}</w:r>`;
    runs += `<w:r><w:rPr><w:b/><w:bCs/></w:rPr>${runBody(m[0])}</w:r>`;
    at = i + m[0].length;
  }
  if (at < clean.length) runs += `<w:r>${runBody(clean.slice(at))}</w:r>`;
  return runs ? `<w:p>${runs}</w:p>` : '<w:p/>';
}

const lines = (text: string): string[] => text.split(/\r\n|\r|\n/);

function documentXml(text: string, appendix: string[]): string {
  let body = lines(text)
    .map((l) => paragraph(l))
    .join('');
  // Podział strony w pierwszym akapicie dodatku, a nie w osobnym: pusty akapit z samym podziałem
  // zostawiałby pusty wiersz na górze nowej strony.
  appendix
    .flatMap(lines)
    .forEach((l, i) => {
      body += paragraph(l, i === 0 ? '<w:r><w:br w:type="page"/></w:r>' : '');
    });
  // A4, marginesy 2,5 cm (1417 twipów): bez pgSz Word w części instalacji przyjmuje format Letter.
  const sect =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
    '</w:sectPr>';
  return `${XML_HEAD}<w:document xmlns:w="${W_NS}"><w:body>${body}${sect}</w:body></w:document>`;
}

const CONTENT_TYPES =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const PACKAGE_RELS =
  `${XML_HEAD}<Relationships xmlns="${REL_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="word/document.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

const DOCUMENT_RELS =
  `${XML_HEAD}<Relationships xmlns="${REL_NS}">` +
  `<Relationship Id="rId1" Type="${OFFICE_REL}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="${OFFICE_REL}/settings" Target="settings.xml"/>` +
  '</Relationships>';

// Arial 11 pt, interlinia 1,15 (276/240), odstęp po akapicie 6 pt (120 twipów), język polski.
const STYLES =
  `${XML_HEAD}<w:styles xmlns:w="${W_NS}"><w:docDefaults>` +
  '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="pl-PL" w:eastAsia="pl-PL" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '</w:styles>';

// Tylko tryb zgodności 15 (Word 2013 i nowsze), nic o autorze ani o edycji.
const SETTINGS =
  `${XML_HEAD}<w:settings xmlns:w="${W_NS}"><w:compat>` +
  '<w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>' +
  '</w:compat></w:settings>';

function coreXml(title: string): string {
  return (
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${xmlText(title)}</dc:title><dc:language>pl-PL</dc:language></cp:coreProperties>`
  );
}

/** Nowy dokument .docx z tekstu wyniku. */
export function buildDocx(text: string, opts: DocxOptions = {}): Uint8Array<ArrayBuffer> {
  const title = opts.title?.trim() || DOCX_DEFAULT_TITLE;
  return storeZip([
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', PACKAGE_RELS],
    ['word/document.xml', documentXml(text, opts.appendix ?? [])],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS],
    ['word/styles.xml', STYLES],
    ['word/settings.xml', SETTINGS],
    ['docProps/core.xml', coreXml(title)],
  ]);
}
