import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { expect, test } from 'vitest';
import { extractDocxText } from './docx';
import { type DocxInventory, docxEmptyBodyError, docxInventoryNote, inventoryDocx } from './docx-inventory';
import { FileReadError } from './files';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ns = (p = 'w', uri = W): string => `xmlns:${p}="${uri}"`;

const doc = (body: string): Uint8Array =>
  strToU8(`<?xml version="1.0"?><w:document ${ns()}><w:body>${body}</w:body></w:document>`);
const part = (root: string, body: string, p = 'w'): Uint8Array =>
  strToU8(`<?xml version="1.0"?><${p}:${root} ${ns(p)}>${body}</${p}:${root}>`);
const para = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const ZERO: DocxInventory = {
  headersFooters: 0,
  notes: 0,
  comments: 0,
  diagrams: 0,
  images: 0,
  embeddings: 0,
  hidden: 0,
  insertions: 0,
  deletions: 0,
  properties: 0,
};

/** Fikcyjne pismo z każdą częścią, której Parawan nie czyta (dane zmyślone). */
function fullDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': doc(
      para('Decyzja w sprawie Tomasza Wierzbickiego.') +
        '<w:p><w:r><w:t xml:space="preserve">Jawne </w:t></w:r>' +
        '<w:r><w:rPr><w:b/><w:vanish/></w:rPr><w:t>ukryta notatka</w:t></w:r></w:p>' +
        '<w:p><w:del w:id="1" w:author="Referent"><w:r><w:delText>PESEL 85071412358</w:delText></w:r></w:del>' +
        '<w:ins w:id="2" w:author="Referent"><w:r><w:t>numer w aktach</w:t></w:r></w:ins></w:p>',
    ),
    'word/header1.xml': part('hdr', para('Urząd Gminy Brzozowa Wola')),
    'word/footer1.xml': part('ftr', para('Sprawę prowadzi: Anna Nowak, tel. 600 700 800')),
    'word/footnotes.xml': part(
      'footnotes',
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
        '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1">${para('Wniosek z 3 marca.')}</w:footnote>` +
        `<w:footnote w:id="2">${para('Pismo Tomasza Wierzbickiego.')}</w:footnote>`,
    ),
    'word/comments.xml': part(
      'comments',
      `<w:comment w:id="0" w:author="Jan Kowalski" w:initials="JK">${para('Sprawdzić adres.')}</w:comment>`,
    ),
    'word/media/image1.png': new Uint8Array(64),
  });
}

test('pełny fikcyjny DOCX: dokładne liczby, separator przypisu nie liczony', () => {
  expect(inventoryDocx(fullDocx())).toEqual({
    headersFooters: 2,
    notes: 2,
    comments: 1,
    diagrams: 0,
    images: 1,
    embeddings: 0,
    hidden: 1,
    insertions: 1,
    deletions: 1,
    properties: 0,
  });
});

test('ten sam plik: ukryty tekst jest w polu źródła, usunięty w śledzonej zmianie nie', () => {
  const text = extractDocxText(fullDocx());
  expect(text).toContain('ukryta notatka');
  expect(text).toContain('numer w aktach');
  expect(text).not.toContain('85071412358');
  // nagłówek, stopka, przypisy i komentarz zostają poza polem, stąd komunikat
  expect(text).not.toMatch(/Brzozowa|Nowak|marca|adres/);
});

test('zwykły dokument bez dodatków: same zera i brak komunikatu', () => {
  const zip = zipSync({ 'word/document.xml': doc(para('Treść pisma.')) });
  expect(inventoryDocx(zip)).toEqual(ZERO);
  expect(docxInventoryNote(inventoryDocx(zip))).toBe('');
});

test('nagłówek i stopka bez tekstu (sam akapit, samo pole numeru strony) się nie liczą', () => {
  const zip = zipSync({
    'word/document.xml': doc(para('Treść.')),
    'word/header1.xml': part('hdr', '<w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr></w:p>'),
    'word/footer1.xml': part('ftr', '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>PAGE</w:instrText></w:r></w:p>'),
    'word/footer2.xml': part('ftr', para('   ')),
    // inny prefiks: ten nagłówek ma tekst i jako jedyny się liczy
    'word/header2.xml': part('hdr', '<ns0:p><ns0:r><ns0:t>Znak sprawy RG.6733.1.2026</ns0:t></ns0:r></ns0:p>', 'ns0'),
  });
  expect(inventoryDocx(zip).headersFooters).toBe(1);
});

test('przypisy końcowe liczą się razem z dolnymi; pusty przypis i separatory nie', () => {
  const zip = zipSync({
    'word/document.xml': doc(para('Treść.')),
    'word/footnotes.xml': part(
      'footnotes',
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>—</w:t></w:r></w:p></w:footnote>' +
        `<w:footnote w:id="1">${para('Przypis.')}</w:footnote><w:footnote w:id="2"><w:p/></w:footnote>`,
    ),
    'word/endnotes.xml': part(
      'endnotes',
      '<w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:endnote>' +
        `<w:endnote w:id="1">${para('Pierwszy.')}</w:endnote><w:endnote w:id="2">${para('Drugi.')}</w:endnote>`,
    ),
  });
  expect(inventoryDocx(zip).notes).toBe(3);
});

test('ukryty tekst: sąsiednie runy to jeden fragment, w:val="0" nie ukrywa, ukryty znak akapitu się nie liczy', () => {
  const hidden = (t: string, attrs = ''): string => `<w:r><w:rPr><w:vanish${attrs}/></w:rPr><w:t>${t}</w:t></w:r>`;
  const zip = zipSync({
    'word/document.xml': doc(
      `<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>widoczny</w:t></w:r>${hidden('A')}${hidden('B')}</w:p>` +
        `<w:p>${hidden('C', ' w:val="0"')}${hidden('D', ' w:val="false"')}<w:r><w:t>widoczny</w:t></w:r></w:p>` +
        `<w:p>${hidden('E')}<w:r><w:rPr><w:vanish/></w:rPr><w:tab/></w:r>${hidden('F')}</w:p>`,
    ),
  });
  // A+B, potem E (z tabulatorem) i F razem: dwa fragmenty
  expect(inventoryDocx(zip).hidden).toBe(2);
});

test('śledzone zmiany: liczą się wstawienia i usunięcia z treścią, nie znaczniki zmian akapitu', () => {
  const zip = zipSync({
    'word/document.xml': doc(
      '<w:p><w:pPr><w:rPr><w:ins w:id="1" w:author="A"/><w:del w:id="2" w:author="A"/></w:rPr></w:pPr>' +
        '<w:ins w:id="3" w:author="A"><w:r><w:t>nowe</w:t></w:r></w:ins>' +
        '<w:del w:id="4" w:author="A"><w:r><w:delText>stare</w:delText></w:r></w:del>' +
        '<w:del w:id="5" w:author="B"><w:r><w:delText>inne</w:delText></w:r></w:del></w:p>' +
        '<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/></w:tblBorders></w:tblPr></w:tbl>',
    ),
  });
  const inv = inventoryDocx(zip);
  expect(inv.insertions).toBe(1);
  expect(inv.deletions).toBe(2);
});

test('obrazy i obiekty osadzone liczone po plikach, bez katalogów', () => {
  const zip = zipSync({
    'word/document.xml': doc(para('Treść.')),
    'word/media/': new Uint8Array(0),
    'word/media/image1.png': new Uint8Array(8),
    'word/media/image2.emf': new Uint8Array(8),
    'word/embeddings/Microsoft_Excel_Worksheet.xlsx': new Uint8Array(8),
    'media/obce.png': new Uint8Array(8),
  });
  const inv = inventoryDocx(zip);
  expect(inv.images).toBe(2);
  expect(inv.embeddings).toBe(1);
});

test('inny prefiks i ścisły Open XML w częściach dodatkowych', () => {
  const strict = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
  const zip = zipSync({
    'word/document.xml': doc(para('Treść.')),
    'word/comments.xml': strToU8(
      `<ns0:comments xmlns:ns0="${strict}"><ns0:comment ns0:id="0"><ns0:p><ns0:r><ns0:t>Uwaga</ns0:t></ns0:r></ns0:p></ns0:comment>` +
        `<ns0:comment ns0:id="1"><ns0:p><ns0:r><ns0:t>Druga</ns0:t></ns0:r></ns0:p></ns0:comment></ns0:comments>`,
    ),
    'word/footnotes.xml': strToU8(
      `<x:footnotes xmlns:x="${W}"><x:footnote x:id="1"><x:p><x:r><x:t>Przypis</x:t></x:r></x:p></x:footnote></x:footnotes>`,
    ),
  });
  const inv = inventoryDocx(zip);
  expect(inv.comments).toBe(2);
  expect(inv.notes).toBe(1);
});

test('limit: części dodatkowe mają razem ten sam limit co document.xml (bomba w wielu nagłówkach)', () => {
  // 26 nagłówków po 2 MB spacji: każdy osobno w limicie, razem ponad 50 MB
  const big = part('hdr', `<w:p><w:r><w:t>${' '.repeat(2 * 1024 * 1024)}x</w:t></w:r></w:p>`);
  const files: Record<string, Uint8Array> = { 'word/document.xml': doc(para('Treść.')) };
  for (let i = 1; i <= 26; i++) files[`word/header${i}.xml`] = big;
  const zip = zipSync(files);
  const t0 = performance.now();
  expect(() => inventoryDocx(zip)).toThrow(/zbyt duży albo uszkodzony/);
  expect(() => inventoryDocx(zip)).toThrow(FileReadError);
  expect(performance.now() - t0).toBeLessThan(3000);
  // treść główna i tak się wczytuje
  expect(extractDocxText(zip)).toBe('Treść.');
});

const DGM = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

test('SmartArt: diagram z tekstem liczony po danych diagramu, pusty i sam rysunek nie', () => {
  const data = (text: string): Uint8Array =>
    strToU8(
      `<dgm:dataModel xmlns:dgm="${DGM}" xmlns:a="${A}"><dgm:ptLst><dgm:pt modelId="1"><dgm:t><a:bodyPr/>` +
        `<a:p><a:r><a:t>${text}</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>`,
    );
  const zip = zipSync({
    // w treści głównej stoi tylko odsyłacz do diagramu, bez zapasowego tekstu
    'word/document.xml': doc(
      para('Skład komisji przedstawia schemat:') +
        `<w:p><w:r><w:drawing><a:graphic xmlns:a="${A}"><a:graphicData uri="${DGM}">` +
        `<dgm:relIds xmlns:dgm="${DGM}"/></a:graphicData></a:graphic></w:drawing></w:r></w:p>`,
    ),
    'word/diagrams/data1.xml': data('Przewodniczący: Wincenty Smartowski'),
    'word/diagrams/data2.xml': data('  '),
    'word/diagrams/drawing1.xml': strToU8(`<dsp:drawing xmlns:a="${A}"><a:t>Przewodniczący: Wincenty Smartowski</a:t></dsp:drawing>`),
    'word/diagrams/layout1.xml': strToU8(`<dgm:layoutDef xmlns:dgm="${DGM}"><dgm:title val=""/></dgm:layoutDef>`),
  });
  expect(inventoryDocx(zip)).toEqual({ ...ZERO, diagrams: 1 });
  expect(extractDocxText(zip)).not.toContain('Smartowski');
  expect(docxInventoryNote(inventoryDocx(zip))).toBe(
    'Wczytano treść główną dokumentu. Parawan nie czyta: diagramów SmartArt (1). Przejrzyj je przed ' +
      'publikacją albo publikuj nowy dokument zapisany z wyniku.',
  );
});

const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const core = (fields: string): Uint8Array =>
  strToU8(`<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}">${fields}<dc:creator>Anna Urzędnicza</dc:creator></cp:coreProperties>`);
const custom = (props: [string, string][]): Uint8Array =>
  strToU8(
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      props
        .map(([name, value], i) => `<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${i + 2}" name="${name}">${value}</property>`)
        .join('') +
      '</Properties>',
  );

test('właściwości dokumentu: tytuł, temat, słowa kluczowe, komentarze i niestandardowe z tekstem', () => {
  const zip = zipSync({
    'word/document.xml': doc(para('Decyzja w sprawie zasiłku.')),
    'docProps/core.xml': core(
      '<dc:title>Decyzja - Marianna Metadanowska</dc:title><dc:subject>PESEL 44051401359</dc:subject>' +
        '<cp:keywords>zasiłek</cp:keywords><dc:description>Sprawdzić u kierownika.</dc:description>',
    ),
    'docProps/custom.xml': custom([
      ['Strona', '<vt:lpwstr>Marianna Metadanowska</vt:lpwstr>'],
      ['Znak sprawy', '<vt:lpwstr>OPS.5311.12.2026</vt:lpwstr>'],
      // techniczne i puste się nie liczą
      ['ContentTypeId', '<vt:lpwstr>0x0101009A3B</vt:lpwstr>'],
      ['MSIP_Label_1234_Enabled', '<vt:lpwstr>true</vt:lpwstr>'],
      ['_dlc_DocIdItemGuid', '<vt:lpwstr>4f1c</vt:lpwstr>'],
      ['Pusta', '<vt:lpwstr></vt:lpwstr>'],
      ['Ostateczna', '<vt:bool>true</vt:bool>'],
    ]),
  });
  expect(inventoryDocx(zip)).toEqual({ ...ZERO, properties: 6 });
  expect(docxInventoryNote(inventoryDocx(zip))).toContain('Parawan nie czyta: właściwości dokumentu (6).');
});

test('właściwości dokumentu: puste pola Worda, sam autor i opis z python-docx nie dają komunikatu', () => {
  const word = zipSync({
    'word/document.xml': doc(para('Treść.')),
    'docProps/core.xml': core(
      '<dc:title></dc:title><dc:subject/><cp:keywords>  </cp:keywords><dc:description></dc:description>',
    ),
  });
  expect(inventoryDocx(word)).toEqual(ZERO);
  const pythonDocx = zipSync({
    'word/document.xml': doc(para('Treść.')),
    'docProps/core.xml': core('<dc:title/><dc:description>generated by python-docx</dc:description>'),
  });
  expect(inventoryDocx(pythonDocx)).toEqual(ZERO);
  expect(docxInventoryNote(inventoryDocx(pythonDocx))).toBe('');
});

/* ── Pusta treść główna ── */

test('pusta treść główna: błąd wylicza części pliku zamiast „Plik jest pusty”', () => {
  // skan pisma wklejony do Worda jako obraz, dane w stopce i komentarzu
  const scan = zipSync({
    'word/document.xml': doc('<w:p/><w:p><w:r><w:drawing/></w:r></w:p><w:p/>'),
    'word/footer1.xml': part('ftr', para('Wnioskodawca: Celestyn Stopkowski, PESEL 02270803628')),
    'word/comments.xml': part('comments', `<w:comment w:id="0" w:author="A">${para('Sprawdzić.')}</w:comment>`),
    'word/media/image1.png': new Uint8Array(8),
  });
  expect(extractDocxText(scan)).toBe('');
  expect(docxEmptyBodyError(inventoryDocx(scan))).toBe(
    'W treści głównej dokumentu nie ma tekstu. Plik nie jest jednak pusty, Parawan nie czyta w nim: ' +
      'nagłówków i stopek (1), komentarzy (1), obrazów (1). Przejrzyj je w Wordzie przed publikacją. ' +
      'Jeśli to skan, wklej tekst ręcznie, bo rozpoznawanie tekstu ze skanów (OCR) nie jest obsługiwane.',
  );
  // dane tylko w nagłówku, treść to same spacje: bez zdania o skanie
  const header = zipSync({
    'word/document.xml': doc('<w:p><w:r><w:t xml:space="preserve">   </w:t></w:r></w:p>'),
    'word/header1.xml': part('hdr', para('Jan Kowalski, PESEL 44051401359')),
  });
  expect(extractDocxText(header)).toBe('');
  expect(docxEmptyBodyError(inventoryDocx(header))).toBe(
    'W treści głównej dokumentu nie ma tekstu. Plik nie jest jednak pusty, Parawan nie czyta w nim: ' +
      'nagłówków i stopek (1). Przejrzyj je w Wordzie przed publikacją.',
  );
});

test('pusta treść główna: naprawdę pusty plik to null (zwykłe „Plik jest pusty”), nieudany spis to błąd', () => {
  const empty = zipSync({ 'word/document.xml': doc('<w:p/>') });
  expect(docxEmptyBodyError(inventoryDocx(empty))).toBeNull();
  expect(docxEmptyBodyError(null)).toBe(
    'W treści głównej dokumentu nie ma tekstu. Parawan nie sprawdził, czy plik ma nagłówki, stopki, ' +
      'przypisy albo komentarze, więc przejrzyj go w Wordzie przed publikacją.',
  );
  // ukryty tekst i wstawienia są w polu, więc przy pustej treści nie ma ich w spisie
  expect(docxEmptyBodyError({ ...ZERO, hidden: 1, insertions: 1 })).toBeNull();
});

test('uszkodzony plik: FileReadError, nie surowy wyjątek', () => {
  expect(() => inventoryDocx(strToU8('to nie zip'))).toThrow(FileReadError);
});

test('fikcyjne pisma z fixtures/urzad: spis bez wyjątku, liczby nieujemne', () => {
  for (const name of ['pismo.docx', 'decyzja.docx', 'protokol-kontroli.docx']) {
    const buf = new Uint8Array(readFileSync(new URL(`./fixtures/urzad/${name}`, import.meta.url)));
    const inv = inventoryDocx(buf);
    for (const n of Object.values(inv)) expect(n, name).toBeGreaterThanOrEqual(0);
    // python-docx wpisuje sam opis „generated by python-docx”, to nie jest dana do przejrzenia
    expect(inv.properties, name).toBe(0);
  }
});

/* ── Komunikat po wczytaniu ── */

test('komunikat: przykład ze specyfikacji, tylko niezerowe pozycje', () => {
  expect(docxInventoryNote({ ...ZERO, headersFooters: 2, notes: 3, comments: 1, images: 4 })).toBe(
    'Wczytano treść główną dokumentu. Parawan nie czyta: nagłówków i stopek (2), przypisów (3), ' +
      'komentarzy (1), obrazów (4). Przejrzyj je przed publikacją albo publikuj nowy dokument ' +
      'zapisany z wyniku.',
  );
  expect(docxInventoryNote({ ...ZERO, headersFooters: 1, comments: 1 })).toBe(
    'Wczytano treść główną dokumentu. Parawan nie czyta: nagłówków i stopek (1), komentarzy (1). ' +
      'Przejrzyj je przed publikacją albo publikuj nowy dokument zapisany z wyniku.',
  );
  expect(docxInventoryNote({ ...ZERO, embeddings: 1, deletions: 2 })).toContain(
    'Parawan nie czyta: obiektów osadzonych (1), fragmentów usuniętych w śledzonych zmianach (2).',
  );
});

test('komunikat: ukryty tekst w osobnym wierszu, z odmianą liczebnika', () => {
  const hidden = (n: number): string => docxInventoryNote({ ...ZERO, hidden: n });
  expect(hidden(1)).toBe('Dokument ma ukryty tekst (1 fragment). Jest w polu źródła i został sprawdzony.');
  expect(hidden(2)).toBe('Dokument ma ukryty tekst (2 fragmenty). Jest w polu źródła i został sprawdzony.');
  expect(hidden(5)).toContain('(5 fragmentów)');
  expect(hidden(22)).toContain('(22 fragmenty)');
  expect(docxInventoryNote({ ...ZERO, comments: 1, hidden: 2 })).toBe(
    'Wczytano treść główną dokumentu. Parawan nie czyta: komentarzy (1). Przejrzyj je przed ' +
      'publikacją albo publikuj nowy dokument zapisany z wyniku.\nDokument ma ukryty tekst ' +
      '(2 fragmenty). Jest w polu źródła i został sprawdzony.',
  );
});

test('komunikat: wstawienia ze śledzonych zmian są w polu, więc o nich nie mówi', () => {
  expect(docxInventoryNote({ ...ZERO, insertions: 3 })).toBe('');
});

test('komunikat: nieudany spis to też komunikat, nie cisza', () => {
  expect(docxInventoryNote(null)).toBe(
    'Wczytano treść główną dokumentu. Parawan nie sprawdził, czy plik ma też nagłówki, stopki, ' +
      'przypisy albo komentarze. Przejrzyj je przed publikacją albo publikuj nowy dokument ' +
      'zapisany z wyniku.',
  );
});

test('komunikat nie mówi, że reszta jest bezpieczna', () => {
  const all = docxInventoryNote({ ...ZERO, headersFooters: 1, notes: 1, comments: 1, images: 1, hidden: 1 });
  expect(all).not.toMatch(/bezpieczn|czyst|w porządku|100%|w pełni|po prostu| — /);
  const empty = docxEmptyBodyError({ ...ZERO, headersFooters: 1, images: 1, properties: 1 });
  expect(empty).not.toMatch(/bezpieczn|czyst|w porządku|100%|w pełni|po prostu| — /);
});
