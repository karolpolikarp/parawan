import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { fileAgeNote, formatBuildDate, STALE_NOTE } from './file-age';
import webHtml from '../index.html?raw';
import webMain from './main.ts?raw';

const DAY = 24 * 60 * 60 * 1000;
/** Chwila `days` dni i `hours` godzin po północy UTC dnia builda. */
const after = (date: string, days: number, hours = 0): Date => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY + hours * 3600_000);

test('wiek pliku: 179 dni bez notki, 181 z notką', () => {
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 0))).toBeNull();
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 179))).toBeNull();
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 179, 23))).toBeNull();
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 180))).toBeNull();
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 181))).toBe(STALE_NOTE);
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 800))).toBe(STALE_NOTE);
  expect(STALE_NOTE).toBe('Ten plik ma ponad pół roku. Sprawdź, czy jest nowsza wersja');
});

test('wiek pliku: data z przyszłości, „dev” i zła data bez notki', () => {
  // zegar komputera cofnięty o rok: zwykły odsyłacz, bez straszenia
  expect(fileAgeNote('2026-10-17', after('2026-10-17', -365))).toBeNull();
  expect(fileAgeNote('2026-10-17', after('2026-10-17', 0, -1))).toBeNull();
  expect(fileAgeNote('dev', new Date('2030-01-01T00:00:00Z'))).toBeNull();
  expect(fileAgeNote('', new Date('2030-01-01T00:00:00Z'))).toBeNull();
  expect(fileAgeNote('2026-02-31', new Date('2030-01-01T00:00:00Z'))).toBeNull();
  expect(fileAgeNote('2026-10-17', new Date(Number.NaN))).toBeNull();
});

test('data pliku po polsku w nagłówku', () => {
  expect(formatBuildDate('2026-10-17')).toBe('17.10.2026');
  expect(formatBuildDate('2027-01-05')).toBe('05.01.2027');
  expect(formatBuildDate('dev')).toBe('');
  expect(formatBuildDate('2026-13-01')).toBe('');
});

test('nagłówek: data obok wersji i notka w miejscu odsyłacza do wydań, bez sieci i zapisu', () => {
  expect(webHtml).toContain(
    '<span class="ver-chip">wersja <span id="app-version-top">…</span><span id="app-build-date"></span></span>',
  );
  // twarda spacja przed kropką: na telefonie „·” zostaje przy numerze wersji, nie zaczyna wiersza
  expect(webMain).toContain("$('app-build-date').textContent = `\\u00a0· ");
  expect(webHtml).toMatch(/<a class="ver-link" id="ver-link" href="https:\/\/github\.com\/karolpolikarp\/parawan\/releases\/latest"[^>]*>sprawdź nowszą wersję ↗<\/a>/);
  expect(webMain).toContain('fileAgeNote(__BUILD_DATE__, new Date())');
  expect(webMain).toContain('formatBuildDate(__BUILD_DATE__)');
  const src = readFileSync(new URL('./file-age.ts', import.meta.url), 'utf8');
  expect(src.length).toBeGreaterThan(0);
  for (const net of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'storageSet', 'import ']) {
    expect(src, net).not.toContain(net);
  }
});

// Sumy dwóch buildów z tego samego commita porównuje scripts/release/powtarzalnosc.test.mjs
// (node --test w ci.yml): test potrzebuje procesu i plików tymczasowych, których typy aplikacji
// przeglądarkowej celowo nie znają (node-fs.d.ts).
test('vite.config.ts: data builda z commita, nie z zegara', () => {
  const cfg = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  expect(cfg).toContain("'log', '-1', '--format=%cs'");
  expect(cfg).toContain('SOURCE_DATE_EPOCH');
  expect(cfg).toContain('__BUILD_DATE__: JSON.stringify(buildDate())');
  expect(cfg).not.toMatch(/Date\.now\(\)|new Date\(\)/);
});
