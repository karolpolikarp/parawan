import { expect, test } from 'vitest';
import { downloadFor, finalText, printTitle, textForDownload } from './output';

const BOM = String.fromCharCode(0xfeff);
const boms = (s: string): number => s.split(BOM).length - 1;

test('finalText: dziś to sam wynik maskowania', () => {
  expect(finalText({ redacted: 'PESEL [PESEL]' })).toBe('PESEL [PESEL]');
  expect(finalText({ redacted: '' })).toBe('');
});

test('textForDownload: dokładnie jeden BOM na początku', () => {
  for (const text of ['Pan [IMIĘ I NAZWISKO]', `${BOM}Pan [IMIĘ I NAZWISKO]`, '']) {
    const out = textForDownload(text);
    expect(out.startsWith(BOM)).toBe(true);
    expect(boms(out)).toBe(1);
  }
  // BOM w środku tekstu to treść, nie znacznik kodowania: zostaje tam, gdzie był
  expect(textForDownload(`a${BOM}b`)).toBe(`${BOM}a${BOM}b`);
});

test('textForDownload: \\n i \\r\\n dają \\r\\n, bez podwójnego \\r', () => {
  expect(textForDownload('a\nb')).toBe(`${BOM}a\r\nb`);
  expect(textForDownload('a\r\nb')).toBe(`${BOM}a\r\nb`);
  expect(textForDownload('a\r\n\nb\n')).toBe(`${BOM}a\r\n\r\nb\r\n`);
  // samotny \r (stary zapis z Maca) też staje się końcem wiersza
  expect(textForDownload('a\rb')).toBe(`${BOM}a\r\nb`);
  const out = textForDownload('1\n2\r\n3\n\n4\r\n\r\n5');
  expect(out).not.toContain('\r\r');
  expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  // ponowne przejście nie zmienia już końców wierszy
  expect(textForDownload(out)).toBe(out);
});

// 7 stycznia, 9:05:03: jednocyfrowe pola z zerem na początku, miesiąc liczony od 1
const AT = new Date(2026, 0, 7, 9, 5, 3);

test('printTitle: data bez godziny, bez nazwy wczytanego pliku', () => {
  expect(printTitle(AT)).toBe('zanonimizowany-2026-01-07');
});

test('downloadFor: .txt, a po wczytaniu .csv plik .csv; treść przez textForDownload', () => {
  for (const ext of ['', 'txt', 'docx', 'pdf', 'CSV.bak']) {
    expect(downloadFor('a\nb', ext, AT)).toEqual({
      name: 'zanonimizowany-2026-01-07_09-05-03.txt',
      type: 'text/plain;charset=utf-8',
      content: `${BOM}a\r\nb`,
    });
  }
  expect(downloadFor('nr;osoba\n1;[IMIĘ I NAZWISKO]', 'csv', AT)).toEqual({
    name: 'zanonimizowany-2026-01-07_09-05-03.csv',
    type: 'text/csv;charset=utf-8',
    content: `${BOM}nr;osoba\r\n1;[IMIĘ I NAZWISKO]`,
  });
});
