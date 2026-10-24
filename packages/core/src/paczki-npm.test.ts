/**
 * Paczka `parawan` (packages/parawan) to nazwa marki dla tej paczki: bez własnego kodu,
 * z zależnością przypiętą do tej samej wersji. Test pilnuje, żeby się nie rozjechały,
 * i uruchamia oba CLI (anonimizator i parawan) na tym samym wejściu.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const core = new URL('../', import.meta.url);
const parawan = new URL('../../parawan/', import.meta.url);
const json = (dir: URL) => JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
const corePkg = json(core);
const parawanPkg = json(parawan);

const cli = (dir: URL, bin: string, args: string[], input: string) =>
  execFileSync(process.execPath, [fileURLToPath(new URL(bin, dir)), ...args], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

describe('paczka parawan = anonimizator pod nazwą marki', () => {
  test('ta sama wersja i zależność przypięta dokładnie do niej', () => {
    expect(parawanPkg.version).toBe(corePkg.version);
    expect(parawanPkg.dependencies).toEqual({ anonimizator: corePkg.version });
  });

  test('te same podścieżki eksportów, każda przekazuje odpowiednik z anonimizator', () => {
    expect(Object.keys(parawanPkg.exports)).toEqual(Object.keys(corePkg.exports));
    for (const [sciezka, cel] of Object.entries(parawanPkg.exports) as [string, Record<string, string>][]) {
      const zrodlo = sciezka === '.' ? 'anonimizator' : `anonimizator/${sciezka.slice(2)}`;
      for (const plik of [cel.import, cel.types]) {
        expect(readFileSync(new URL(plik, parawan), 'utf8'), plik).toContain(`export * from '${zrodlo}';`);
      }
    }
  });

  test('LICENSE i NOTICE identyczne z rdzeniem', () => {
    for (const plik of ['LICENSE', 'NOTICE']) {
      expect(readFileSync(new URL(plik, parawan), 'utf8'), plik).toBe(readFileSync(new URL(plik, core), 'utf8'));
    }
  });

  test('import z parawan daje te same funkcje co z anonimizator', async () => {
    const a = await import('anonimizator');
    const p = await import(fileURLToPath(new URL('index.js', parawan)));
    expect(Object.keys(p).sort()).toEqual(Object.keys(a).sort());
    expect(p.redactPII).toBe(a.redactPII);
  });
});

describe('CLI: anonimizator i parawan', () => {
  const tekst = 'Jan Kowalski, PESEL 44051401359, tel. 600 100 200\n';

  test('zwykły tryb: ten sam wynik w obu poleceniach', () => {
    const a = cli(core, 'bin/anonimizator.js', ['--cicho'], tekst);
    expect(a).toBe('[IMIĘ I NAZWISKO], PESEL [PESEL], tel. [TELEFON]\n');
    expect(cli(parawan, 'bin/parawan.js', ['--cicho'], tekst)).toBe(a);
  });

  test('--jsonl: odpowiedź na każdy wiersz w kolejności, zły wiersz nie kończy procesu', () => {
    const wejscie = [
      JSON.stringify({ id: 1, text: 'PESEL 44051401359' }),
      'to nie json',
      JSON.stringify({ id: 3, text: 5 }),
      '',
      JSON.stringify({ id: 4, text: 'brak danych' }),
    ].join('\n');
    for (const [dir, bin] of [
      [core, 'bin/anonimizator.js'],
      [parawan, 'bin/parawan.js'],
    ] as const) {
      const linie = cli(dir, bin, ['--jsonl'], wejscie).trim().split('\n').map((l) => JSON.parse(l));
      expect(linie, bin).toEqual([
        { id: 1, redacted: 'PESEL [PESEL]', found: [{ type: 'PESEL', count: 1 }] },
        { id: null, error: expect.any(String) },
        { id: 3, error: 'pole "text" musi być napisem' },
        { id: 4, redacted: 'brak danych', found: [] },
      ]);
    }
  });
});
