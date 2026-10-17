import { expect, test } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { extractDocxText } from './docx';
import { FileReadError } from './files';

function makeDocx(xmlBody: string): Uint8Array {
  const xml =
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${xmlBody}</w:body></w:document>`;
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
    'word/document.xml': strToU8('<w:p><w:r><w:t>Jan Kowalski</w:t></w:r></w:p>'),
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
  const head = '<w:document><w:body><w:p><w:r><w:t>Jan';
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
    { 'word/document.xml': strToU8('<w:p><w:r><w:t>Anna Nowak</w:t></w:r></w:p>') },
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
