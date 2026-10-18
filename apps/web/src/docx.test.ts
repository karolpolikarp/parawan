import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxText } from './docx';
import { FileReadError } from './files';

// Przestrzeń nazw WordprocessingML: bez jej deklaracji extractDocxText nie wie, który prefiks
// niesie tekst, i odrzuca plik (test niżej). Stąd deklaracja w każdym document.xml z testów.
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W_STRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';

function makeDocx(xmlBody: string): Uint8Array {
  const xml =
    `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${xmlBody}</w:body></w:document>`;
  return zipSync({
    'word/document.xml': strToU8(xml),
    '[Content_Types].xml': strToU8('<Types/>'),
  });
}

test('akapity rozdzielone nową linią, treść z <w:t> sklejona', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>Pierwszy </w:t></w:r><w:r><w:t>akapit</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Drugi akapit</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('Pierwszy akapit\nDrugi akapit');
});

test('<w:br/> i <w:tab/> zamieniane na \\n i \\t', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>b</w:t></w:r>' +
      '<w:r><w:tab/></w:r><w:r><w:t>c</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('a\nb\tc');
});

test('encje XML dekodowane (w tym numeryczne)', () => {
  const docx = makeDocx('<w:p><w:r><w:t>A &amp; B &lt;x&gt; &#65; &#x42;</w:t></w:r></w:p>');
  expect(extractDocxText(docx)).toBe('A & B <x> A B');
});

test('atrybuty na w:t (xml:space) nie psują ekstrakcji', () => {
  const docx = makeDocx('<w:p><w:r><w:t xml:space="preserve">  ze spacjami  </w:t></w:r></w:p>');
  expect(extractDocxText(docx)).toContain('ze spacjami');
});

test('plik niebędący ZIP-em odrzucony z polskim komunikatem', () => {
  expect(() => extractDocxText(strToU8('to nie zip'))).toThrow(/nie wygląda na poprawny/);
});

test('ZIP bez word/document.xml odrzucony', () => {
  const zip = zipSync({ 'cokolwiek.txt': strToU8('x') });
  expect(() => extractDocxText(zip)).toThrow(/nie jest dokument/);
});

test('tekst z realnym PII przechodzi w całości (do dalszej redakcji)', () => {
  const docx = makeDocx('<w:p><w:r><w:t>PESEL 44051401359, Jan Kowalski</w:t></w:r></w:p>');
  const text = extractDocxText(docx);
  expect(text).toContain('44051401359');
  expect(text).toContain('Jan Kowalski');
});

test('twardy łącznik <w:noBreakHyphen/> staje się zwykłym „-”', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>31</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:t xml:space="preserve">042 Kraków</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Kowalska</w:t></w:r><w:r><w:noBreakHyphen/></w:r><w:r><w:t>Nowak</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('31-042 Kraków\nKowalska-Nowak');
});

test('łącznik miękki <w:softHyphen/> pominięty', () => {
  const docx = makeDocx('<w:p><w:r><w:t>Kowal</w:t></w:r><w:r><w:softHyphen/></w:r><w:r><w:t>ski</w:t></w:r></w:p>');
  expect(extractDocxText(docx)).toBe('Kowalski');
});

test('pole tekstowe (mc:Choice + mc:Fallback) daje treść tylko raz', () => {
  const box = '<w:txbxContent><w:p><w:r><w:t>Nadawca: Jan Kowalski</w:t></w:r></w:p></w:txbxContent>';
  const docx = makeDocx(
    '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>' +
      box +
      '</w:drawing></mc:Choice><mc:Fallback><w:pict>' +
      box +
      '</w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>' +
      '<w:p><w:r><w:t>Treść pisma.</w:t></w:r></w:p>',
  );
  const text = extractDocxText(docx);
  expect(text.match(/Nadawca/g)).toHaveLength(1);
  expect(text).toContain('Treść pisma.');
});

test('zagnieżdżone i samozamykające mc:Fallback też znikają, tekst wokół zostaje', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>A</w:t></w:r></w:p><mc:Fallback/>' +
      '<mc:Fallback><w:p><w:r><w:t>X</w:t></w:r></w:p><mc:Fallback><w:p><w:r><w:t>Y</w:t></w:r></w:p></mc:Fallback>' +
      '<w:p><w:r><w:t>Z</w:t></w:r></w:p></mc:Fallback>' +
      '<w:p><w:r><w:t>B</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('A\nB');
});

test('encja spoza Unicode zostaje dosłownie i nie blokuje dokumentu', () => {
  const docx = makeDocx('<w:p><w:r><w:t>a&#x110000;b &#99999999999; Jan</w:t></w:r></w:p>');
  expect(extractDocxText(docx)).toBe('a&#x110000;b &#99999999999; Jan');
});

test('kontener OLE: zahasłowany .docx i stary .doc dostają pomocny komunikat', () => {
  const ole = new Uint8Array(1024);
  ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(() => extractDocxText(ole)).toThrow(/hasłem albo zapisany w starym formacie \.doc/);
  // strumień „EncryptedPackage” (nazwa w UTF-16LE) = dokument zabezpieczony hasłem
  const name = 'EncryptedPackage';
  for (let i = 0; i < name.length; i++) ole[512 + i * 2] = name.charCodeAt(i);
  expect(() => extractDocxText(ole)).toThrow(/^Ten dokument jest chroniony hasłem\. Zdejmij/);
  expect(() => extractDocxText(ole)).toThrow(FileReadError);
});

/** Przesunięcie wpisu katalogu centralnego ZIP dla danej nazwy (do psucia nagłówków w testach). */
function centralEntry(zip: Uint8Array, name: string): DataView {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const want = strToU8(name);
  for (let i = 0; i + 46 <= zip.length; i++) {
    if (view.getUint32(i, true) !== 0x02014b50) continue;
    const len = view.getUint16(i + 28, true);
    const got = zip.subarray(i + 46, i + 46 + len);
    if (got.length === want.length && got.every((b, j) => b === want[j])) {
      return new DataView(zip.buffer, zip.byteOffset + i, 46);
    }
  }
  throw new Error('brak wpisu ' + name);
}

test('bomba ZIP: rozpakowujemy tylko document.xml, innych wpisów nawet nie dotykamy', () => {
  const zip = zipSync({
    'word/document.xml': strToU8(`<w:p xmlns:w="${W}"><w:r><w:t>Jan Kowalski</w:t></w:r></w:p>`),
    'word/media/image1.png': new Uint8Array(4096),
  });
  // Nieznana metoda kompresji: gdyby wpis był rozpakowywany, fflate rzuciłby wyjątek.
  centralEntry(zip, 'word/media/image1.png').setUint16(10, 99, true);
  expect(extractDocxText(zip)).toBe('Jan Kowalski');
});

test('document.xml deklarujący rozmiar ponad limit odrzucony bez rozpakowywania', () => {
  const zip = zipSync({ 'word/document.xml': strToU8('<w:p><w:r><w:t>x</w:t></w:r></w:p>') });
  centralEntry(zip, 'word/document.xml').setUint32(24, 0xfffffffe, true); // „rozmiar po rozpakowaniu”
  expect(() => extractDocxText(zip)).toThrow(/zbyt duży albo uszkodzony/);
});

/**
 * Surowy strumień deflate (stałe kody Huffmana): `prefix`, spacja, `pairs` razy „długość 258,
 * odległość 1” (każde to 258 spacji) i `suffix`. 13 bitów rozwija się w 258 bajtów, więc kilka MB
 * pliku daje gigabajt tekstu, bez kompresowania gigabajta w teście.
 */
function deflateBomb(prefix: string, pairs: number, suffix: string): Uint8Array {
  const out = new Uint8Array(Math.ceil((pairs * 13 + (prefix.length + suffix.length + 1) * 8 + 20) / 8) + 1);
  let bit = 0;
  const bits = (value: number, n: number): void => {
    for (let i = 0; i < n; i++, bit++) if ((value >> i) & 1) out[bit >> 3] |= 1 << (bit & 7);
  };
  // kody Huffmana idą od najstarszego bitu
  const code = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--, bit++) if ((value >> i) & 1) out[bit >> 3] |= 1 << (bit & 7);
  };
  const literal = (s: string): void => {
    for (const ch of strToU8(s)) code(0x30 + ch, 8); // bajty 0–143: 8 bitów
  };
  bits(1, 1); // ostatni blok
  bits(1, 2); // stałe kody Huffmana
  literal(prefix + ' ');
  for (let i = 0; i < pairs; i++) {
    code(0b11000101, 8); // symbol 285: długość 258
    code(0, 5); // odległość 1
  }
  literal(suffix);
  code(0, 7); // koniec bloku
  return out.subarray(0, Math.ceil(bit / 8));
}

/** ZIP z jednym wpisem deflate i rozmiarem po rozpakowaniu podanym wprost (może kłamać). */
function zipWithDeflated(name: string, data: Uint8Array, originalSize: number): Uint8Array {
  const nm = strToU8(name);
  const zip = new Uint8Array(30 + nm.length + data.length + 46 + nm.length + 22);
  const v = new DataView(zip.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(8, 8, true);
  v.setUint32(18, data.length, true);
  v.setUint32(22, originalSize, true);
  v.setUint16(26, nm.length, true);
  zip.set(nm, 30);
  zip.set(data, 30 + nm.length);
  const cd = 30 + nm.length + data.length;
  v.setUint32(cd, 0x02014b50, true);
  v.setUint16(cd + 10, 8, true);
  v.setUint32(cd + 20, data.length, true);
  v.setUint32(cd + 24, originalSize, true);
  v.setUint16(cd + 28, nm.length, true);
  zip.set(nm, cd + 46);
  const end = cd + 46 + nm.length;
  v.setUint32(end, 0x06054b50, true);
  v.setUint16(end + 8, 1, true);
  v.setUint16(end + 10, 1, true);
  v.setUint32(end + 12, 46 + nm.length, true);
  v.setUint32(end + 16, cd, true);
  return zip;
}

test('document.xml z fałszywym, zaniżonym rozmiarem: rozpakowanie przerwane od razu', () => {
  const head = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Jan`;
  const tail = 'Kowalski</w:t></w:r></w:p></w:body></w:document>';
  // uczciwy wpis z ręcznie zbudowanym strumieniem czyta się normalnie
  const honest = zipWithDeflated(
    'word/document.xml',
    deflateBomb(head, 2, tail),
    head.length + 1 + 2 * 258 + tail.length,
  );
  expect(extractDocxText(honest)).toBe(`Jan${' '.repeat(1 + 2 * 258)}Kowalski`);
  // ok. 1 GB spacji w 6,5 MB, a nagłówek deklaruje tyle, ile przepuszcza filtr proporcji
  const bomb = deflateBomb(head, 4_000_000, tail);
  const lying = zipWithDeflated('word/document.xml', bomb, Math.ceil(bomb.length / 1.2) + 1);
  const t0 = performance.now();
  expect(() => extractDocxText(lying)).toThrow(/zbyt duży albo uszkodzony/);
  expect(performance.now() - t0).toBeLessThan(300);
});

test('wpis zapisany bez kompresji (metoda 0) też jest czytany', () => {
  const zip = zipSync(
    { 'word/document.xml': strToU8(`<w:p xmlns:w="${W}"><w:r><w:t>Anna Nowak</w:t></w:r></w:p>`) },
    { level: 0 },
  );
  expect(extractDocxText(zip)).toBe('Anna Nowak');
});

test('tysiące zagnieżdżonych albo niedomkniętych mc:Fallback i w:t: tekst w ułamku sekundy', () => {
  const K = 60_000;
  const nested = makeDocx(
    '<w:p><w:r><w:t>A</w:t></w:r></w:p>' +
      '<mc:Fallback>'.repeat(K) +
      '<w:p><w:r><w:t>X</w:t></w:r></w:p>' +
      '</mc:Fallback>'.repeat(K) +
      '<w:p><w:r><w:t>B</w:t></w:r></w:p>',
  );
  const unclosed = makeDocx(
    '<w:p><w:r><w:t>A</w:t></w:r></w:p>' +
      '<mc:Fallback a'.repeat(K) +
      '<w:t a'.repeat(K) +
      '<w:p><w:r><w:t>B</w:t></w:r></w:p>',
  );
  const t0 = performance.now();
  expect(extractDocxText(nested)).toBe('A\nB');
  expect(extractDocxText(unclosed)).toBe('A\nB');
  expect(performance.now() - t0).toBeLessThan(500);
});

test('document.xml z rozmiarem zaniżonym względem skompresowanego odrzucony', () => {
  // pseudolosowe cyfry słabo się kompresują: skompresowany wpis ma kilka KB
  let seed = 1;
  const digits = Array.from({ length: 8000 }, () => ((seed = (seed * 48271) % 2147483647) % 10)).join('');
  const zip = zipSync({ 'word/document.xml': strToU8('<w:p><w:r><w:t>' + digits + '</w:t></w:r></w:p>') });
  // deklaruje 10 B po rozpakowaniu, choć skompresowany jest dużo większy: deflate tak nie umie
  centralEntry(zip, 'word/document.xml').setUint32(24, 10, true);
  expect(() => extractDocxText(zip)).toThrow(/zbyt duży albo uszkodzony/);
});

/* ── Granice wierszy, prefiks przestrzeni nazw ── */

test('<w:cr/> to nowy wiersz: „Jan<w:cr/>Kowalski” nie skleja się i nazwisko jest zasłonięte', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t>Wnioskodawca: Jan</w:t><w:cr/><w:t>Kowalski, tel. 600</w:t><w:cr w:clear="all"/>' +
      '<w:t>700 800</w:t></w:r></w:p>',
  );
  const text = extractDocxText(docx);
  expect(text).toBe('Wnioskodawca: Jan\nKowalski, tel. 600\n700 800');
  expect(text.split('\n').slice(0, 2)).toEqual(['Wnioskodawca: Jan', 'Kowalski, tel. 600']);
  // dawniej „JanKowalski” przechodziło do wyniku jawne
  const { redacted } = redactPII(text);
  expect(redacted).not.toContain('Kowalski');
  expect(redacted).toContain('[IMIĘ I NAZWISKO]');
});

test('pusty akapit <w:p/> nie daje pustego wiersza: „Login:” i imię z nazwiskiem zostają połączone', () => {
  // tak Word 365 zapisuje pusty akapit bez formatowania
  const empty = '<w:p w14:paraId="637B1930" w14:textId="77777777" w:rsidR="007B5933" w:rsidRDefault="007B5933"/>';
  const docx = makeDocx(
    '<w:p><w:r><w:t>Login:</w:t></w:r></w:p>' +
      empty +
      '<w:p><w:r><w:t>pwisniewski</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Wnioskodawca: Jan</w:t></w:r></w:p><w:p />' +
      '<w:p><w:r><w:t>Kowalski</w:t></w:r></w:p>',
  );
  const text = extractDocxText(docx);
  expect(text).toBe('Login:\npwisniewski\nWnioskodawca: Jan\nKowalski');
  const { redacted } = redactPII(text);
  expect(redacted).not.toMatch(/pwisniewski|Jan|Kowalski/);
  expect(redacted).toContain('[LOGIN]');
});

test('znaczniki samozamykające w akapicie (<w:pPr/>, <w:pStyle/>, <w:proofErr/>) nie łamią wiersza', () => {
  // Word otacza znacznikiem sprawdzania pisowni wyrazy, których nie zna, czyli zwykle nazwiska
  const docx = makeDocx(
    '<w:p><w:pPr><w:pStyle w:val="Tresc"/></w:pPr><w:r><w:t xml:space="preserve">Na wniosek Pana Tomasza </w:t></w:r>' +
      '<w:proofErr w:type="spellStart"/><w:r><w:t>Wierzbickiego</w:t></w:r><w:proofErr w:type="spellEnd"/>' +
      '<w:r><w:t xml:space="preserve">, PESEL 85071412358.</w:t></w:r></w:p>',
  );
  const text = extractDocxText(docx);
  expect(text).toBe('Na wniosek Pana Tomasza Wierzbickiego, PESEL 85071412358.');
  expect(redactPII(text).redacted).toBe('Na wniosek Pana [IMIĘ I NAZWISKO], PESEL [PESEL].');
  const two = makeDocx('<w:p><w:pPr/><w:r><w:t>A</w:t></w:r></w:p><w:p><w:pPr/><w:r><w:t>B</w:t></w:r></w:p>');
  expect(extractDocxText(two)).toBe('A\nB');
});

/** Tabela Worda: wiersze z komórkami, każda komórka to akapity (pusty napis = pusta komórka). */
function table(rows: string[][], emptyCell = '<w:p w:rsidR="00B51272" w:rsidRDefault="00B51272"/>'): string {
  const cell = (t: string): string =>
    '<w:tc><w:tcPr><w:tcW w:w="2268" w:type="dxa"/></w:tcPr>' +
    (t ? `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>` : emptyCell) +
    '</w:tc>';
  return `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('')}</w:tbl>`;
}

test('pusta komórka tabeli nie rozdziela sąsiednich: imię i login z tabeli zasłonięte', () => {
  const rows = [
    ['Imię', 'Drugie imię', 'Nazwisko'],
    ['Jan', '', 'Kowalski'],
    ['Login:', '', 'jkowalski'],
  ];
  const expected = 'Imię\nDrugie imię\nNazwisko\nJan\nKowalski\nLogin:\njkowalski';
  // pusta komórka jako <w:p/> i jako akapit z formatowaniem (dawniej dawał pusty wiersz)
  for (const empty of ['<w:p/>', '<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr></w:p>']) {
    const text = extractDocxText(makeDocx(table(rows, empty)));
    expect(text, empty).toBe(expected);
    const { redacted } = redactPII(text);
    expect(redacted, empty).not.toMatch(/\bJan\b|Kowalski|jkowalski/);
    expect(redacted, empty).toContain('[LOGIN]');
  }
});

test('komórka z samą spacją albo tabulatorem jest pusta, z twardym łącznikiem nie; zagnieżdżona tabela', () => {
  const docx = makeDocx(
    '<w:tbl><w:tr>' +
      '<w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t xml:space="preserve">  </w:t><w:tab/></w:r></w:p><w:p/></w:tc>' +
      '<w:tc><w:p><w:r><w:noBreakHyphen/></w:r></w:p></w:tc>' +
      // komórka z tabelą w środku: tekst wewnętrznej komórki liczy się też dla zewnętrznej
      `<w:tc><w:p><w:pPr/></w:p>${table([['', 'B']])}<w:p><w:pPr/></w:p></w:tc>` +
      `<w:tc>${table([['', '']])}<w:p><w:pPr/></w:p></w:tc>` +
      '<w:tc/><w:tc><w:tcPr><w:tcW w:w="1"/></w:tcPr><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc>' +
      '</w:tr></w:tbl>',
  );
  expect(extractDocxText(docx)).toBe('A\n-\n\nB\n\nC');
});

test('niedomknięta komórka i zamknięcie bez otwarcia nie gubią tekstu', () => {
  const docx = makeDocx(
    '</w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p><w:tc><w:p><w:pPr/></w:p><w:p><w:r><w:t>B</w:t></w:r></w:p>',
  );
  expect(extractDocxText(docx)).toBe('A\n\nB');
});

/** Dokument z dowolnym elementem głównym (prefiks, deklaracje). */
function docxWithRoot(open: string, close: string, body: string): Uint8Array {
  return zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?>${open}${body}${close}`) });
}

/**
 * Treść z każdym rodzajem znacznika, który tokenizer zamienia na tekst albo pomija, dla prefiksu
 * `p`. Pusta komórka z formatowanym akapitem zniknie tylko wtedy, gdy `tc` też ma ten prefiks.
 */
const BODY = (p: string): string =>
  `<${p}body><${p}p><${p}r><${p}t>Jan Kowalski</${p}t><${p}tab/><${p}t>PESEL 44051401359</${p}t>` +
  `<${p}br/><${p}t>31</${p}t><${p}noBreakHyphen/><${p}t>042 Kraków</${p}t></${p}r></${p}p>` +
  `<${p}p/><${p}tbl><${p}tr><${p}tc><${p}tcPr><${p}tcW ${p}w="1"/></${p}tcPr><${p}p><${p}pPr/></${p}p>` +
  `</${p}tc></${p}tr></${p}tbl><${p}p><${p}r><${p}t>Anna</${p}t><${p}cr/><${p}t>Nowak</${p}t>` +
  `<${p}delText>usunięte</${p}delText></${p}r></${p}p></${p}body>`;
const EXPECTED = 'Jan Kowalski\tPESEL 44051401359\n31-042 Kraków\nAnna\nNowak';

test('prefiks ns0: (i każdy inny) daje ten sam tekst co w:', () => {
  const w = docxWithRoot(`<w:document xmlns:w="${W}">`, '</w:document>', BODY('w:'));
  expect(extractDocxText(w)).toBe(EXPECTED);
  const ns0 = docxWithRoot(`<ns0:document xmlns:ns0="${W}">`, '</ns0:document>', BODY('ns0:'));
  expect(extractDocxText(ns0)).toBe(EXPECTED);
  // kropka w prefiksie nie może zadziałać w wyrażeniu jak „dowolny znak”
  const dot = docxWithRoot(`<a.b:document xmlns:a.b="${W}">`, '</a.b:document>', BODY('a.b:'));
  expect(extractDocxText(dot)).toBe(EXPECTED);
  // obcy prefiks z tą samą nazwą lokalną (jak DrawingML <a:t>) nie jest tekstem dokumentu
  const mixed = docxWithRoot(
    `<x:document xmlns:x="${W}" xmlns:w="urn:inny">`,
    '</x:document>',
    BODY('x:').replace('<x:t>Anna</x:t>', '<x:t>Anna</x:t><w:t>obce</w:t>'),
  );
  expect(extractDocxText(mixed)).toBe(EXPECTED);
});

test('przestrzeń domyślna (bez prefiksu) też jest czytana', () => {
  const docx = docxWithRoot(`<document xmlns="${W}" xmlns:a="urn:drawing">`, '</document>', BODY(''));
  expect(extractDocxText(docx)).toBe(EXPECTED);
});

test('ISO 29500 Strict („Ścisły dokument Open XML”) daje ten sam tekst co zwykły .docx', () => {
  const strict = docxWithRoot(`<w:document xmlns:w="${W_STRICT}">`, '</w:document>', BODY('w:'));
  expect(extractDocxText(strict)).toBe(EXPECTED);
  const strictNs0 = docxWithRoot(
    `<ns0:document xmlns:ns0="${W_STRICT}" xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships">`,
    '</ns0:document>',
    BODY('ns0:'),
  );
  expect(extractDocxText(strictNs0)).toBe(EXPECTED);
});

test('komentarz przed elementem głównym i deklaracje w kilku wierszach nie przeszkadzają', () => {
  const docx = docxWithRoot(
    `<!-- <w:document xmlns:w="urn:zly"> --><w:document\n  xmlns:wp="urn:wp"\n  xmlns:w='${W}'>`,
    '</w:document>',
    BODY('w:'),
  );
  expect(extractDocxText(docx)).toBe(EXPECTED);
});

test('bez deklaracji WordprocessingML: komunikat o nietypowej budowie, nie „plik jest pusty”', () => {
  const msg =
    'Ten plik .docx ma nietypową budowę i Parawan nie odczyta jego treści. Otwórz go w Wordzie ' +
    'albo LibreOffice, zapisz ponownie jako .docx i wczytaj jeszcze raz.';
  const roots: [string, string, string][] = [
    ['<ns0:document xmlns:ns0="x">', '</ns0:document>', BODY('ns0:')],
    ['<w:document>', '</w:document>', BODY('w:')],
    ['<w:document xmlns:w="http://schemas.openxmlformats.org/drawingml/2006/main">', '</w:document>', BODY('w:')],
    ['', '', ''],
    ['<!-- niedomknięty komentarz', '', ''],
  ];
  for (const root of roots) {
    const docx = docxWithRoot(...root);
    expect(() => extractDocxText(docx)).toThrow(FileReadError);
    expect(() => extractDocxText(docx)).toThrow(msg);
  }
});

test('tekst ukryty (w:vanish) trafia do pola źródła, usunięty w śledzonej zmianie (w:delText) nie', () => {
  const docx = makeDocx(
    '<w:p><w:r><w:t xml:space="preserve">Jawne </w:t></w:r>' +
      '<w:r><w:rPr><w:vanish/></w:rPr><w:t>ukryte Jan Kowalski</w:t></w:r></w:p>' +
      '<w:p><w:del w:id="1" w:author="A"><w:r><w:delText>usunięte Anna Nowak</w:delText></w:r></w:del>' +
      '<w:ins w:id="2" w:author="A"><w:r><w:t>wstawione</w:t></w:r></w:ins></w:p>',
  );
  const text = extractDocxText(docx);
  expect(text).toBe('Jawne ukryte Jan Kowalski\nwstawione');
  // ukryty tekst jest sprawdzany jak reszta pola
  expect(redactPII(text).redacted).not.toContain('Kowalski');
});

test('tysiące niedomkniętych <w:p, <w:cr i <w:tc oraz otwartych komórek: tekst w ułamku sekundy', () => {
  const K = 60_000;
  const docx = makeDocx(
    '<w:p><w:r><w:t>A</w:t></w:r></w:p>' +
      '<w:p a'.repeat(K) +
      '<w:cr a'.repeat(K) +
      '<w:tc a'.repeat(K) +
      '<w:tc>'.repeat(K) +
      '<w:p><w:r><w:t>B</w:t></w:r></w:p>',
  );
  const t0 = performance.now();
  expect(extractDocxText(docx)).toBe('A\nB');
  expect(performance.now() - t0).toBeLessThan(500);
});
