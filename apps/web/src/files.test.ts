import { expect, test } from 'vitest';
import { redactPII } from 'anonimizator';
import { decodeText, fileExt, looksLikePdf, unsupportedFormat } from './files';

// Niezależny koder Windows-1250: tablica odwrotna zbudowana z dekodera WHATWG (bez ręcznej mapy).
function toCp1250(s: string): Uint8Array {
  const dec = new TextDecoder('windows-1250');
  const rev = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const ch = dec.decode(Uint8Array.of(b));
    if (!rev.has(ch)) rev.set(ch, b);
  }
  return Uint8Array.from([...s].map((c) => rev.get(c) ?? 0x3f));
}

function toUtf16(s: string, le: boolean): Uint8Array {
  const out = new Uint8Array(2 + s.length * 2);
  out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = le ? c & 0xff : c >> 8;
    out[3 + i * 2] = le ? c >> 8 : c & 0xff;
  }
  return out;
}

const PISMO =
  'Wynajmujący: Łukasz Wójcik, PESEL 44051401359, zam. ul. Źródlana 7, 31-042 Kraków.\n' +
  'Najemca: Żaneta Ślęzak, tel. 600 700 800.';

test('Windows-1250 (ANSI): polskie litery bez „�” i ten sam wynik co z UTF-8', () => {
  const cp = decodeText(toCp1250(PISMO));
  expect(cp.encoding).toBe('windows-1250');
  expect(cp.text).toBe(PISMO);
  expect(cp.text).not.toContain('�');
  const utf = decodeText(new TextEncoder().encode(PISMO));
  expect(utf.encoding).toBe('utf-8');
  expect(redactPII(cp.text).redacted).toBe(redactPII(utf.text).redacted);
});

test('UTF-8 z BOM: BOM zdjęty, treść bez zmian', () => {
  const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(PISMO)]);
  expect(decodeText(bytes)).toEqual({ text: PISMO, encoding: 'utf-8' });
});

test('UTF-16 z BOM (LE i BE) wczytuje się poprawnie, nie trafia do gałęzi CP1250', () => {
  expect(decodeText(toUtf16(PISMO, true))).toEqual({ text: PISMO, encoding: 'utf-16le' });
  expect(decodeText(toUtf16(PISMO, false))).toEqual({ text: PISMO, encoding: 'utf-16be' });
});

test('fileExt: małe litery, ostatnia kropka, brak rozszerzenia', () => {
  expect(fileExt('Umowa.najmu.DOCX')).toBe('docx');
  expect(fileExt('README')).toBe('');
});

test('pliki tekstowe (TXT, CSV, XML, JSON, UTF-16) przechodzą', () => {
  const utf8 = new TextEncoder().encode('<?xml version="1.0"?><a>Jan Kowalski</a>');
  for (const name of ['pismo.txt', 'lista.csv', 'dane.xml', 'dane.json', 'list.eml', 'bez-rozszerzenia']) {
    expect(unsupportedFormat(name, utf8)).toBeNull();
  }
  expect(unsupportedFormat('lista.csv', toCp1250(PISMO))).toBeNull();
  expect(unsupportedFormat('pismo.txt', toUtf16(PISMO, true))).toBeNull();
});

test('formaty binarne i biurowe odrzucone z komunikatem', () => {
  const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
  const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);
  const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 0x03, 0, 0, 0]);
  const rtf = new TextEncoder().encode('{\\rtf1\\ansi Jan Kowalski}');
  expect(unsupportedFormat('stary.doc', ole)).toMatch(/nie da się odczytać/);
  expect(unsupportedFormat('umowa.odt', zip)).toMatch(/\(\.odt\)/);
  expect(unsupportedFormat('setup.exe', exe)).toMatch(/DOCX i PDF/);
  expect(unsupportedFormat('pismo.rtf', rtf)).toMatch(/nie da się odczytać/);
  // RTF przemianowany na .txt rozpoznany po sygnaturze „{\rtf”
  expect(unsupportedFormat('pismo.txt', rtf)).toMatch(/nie da się odczytać/);
  // rozszerzenie biurowe wystarczy, nawet gdy początek wygląda na tekst
  expect(unsupportedFormat('arkusz.xlsx', new TextEncoder().encode('abc'))).not.toBeNull();
});

test('obrazy odrzucone z informacją o braku OCR', () => {
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(unsupportedFormat('skan.jpg', jpg)).toMatch(/OCR/);
  expect(unsupportedFormat('zrzut', png)).toMatch(/OCR/);
});

test('rozszerzenie w komunikacie tylko wtedy, gdy wygląda na rozszerzenie', () => {
  const ole = Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  expect(unsupportedFormat('Jan.Kowalski-umowa-najmu', ole)).not.toMatch(/Kowalski/);
});

test('looksLikePdf rozpoznaje nagłówek %PDF-', () => {
  expect(looksLikePdf(new TextEncoder().encode('%PDF-1.7\n'))).toBe(true);
  expect(looksLikePdf(new TextEncoder().encode('PDF'))).toBe(false);
});
