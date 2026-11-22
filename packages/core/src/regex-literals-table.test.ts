// Tablica analizy z buildu (regex-literals-table.ts) musi dawać dokładnie to, co analiza liczona
// od nowa: inaczej filtr napisów gwarancji mógłby przepuścić trafienie i zmienić wynik redakcji.
import { expect, test } from 'vitest';
// @ts-expect-error — brak pliku deklaracji dla modułu .mjs (skrypt benchmarku)
import { buildDataset } from '../../../scripts/benchmark/dataset.mjs';
import { redactPII } from './index';
import { analyzedPatterns, analyzeFresh, literalTableKey, literalTableMisses } from './regex-literals';
import { LITERAL_TABLE } from './regex-literals-table';

const REGEN = 'npm run build -w anonimizator && npm run gen:literals -w anonimizator && npm run build -w anonimizator';

const texts: string[] = [
  'Pacjent Jan Kowalski przyjmuje metforminę, leczony z powodu cukrzycy.',
  ...buildDataset().cases.map((c: { text: string }) => c.text),
];
for (const t of texts) {
  redactPII(t);
  redactPII(t, { pseudonyms: true });
}
const patterns = analyzedPatterns();

test('regex-literals-table: każde wyrażenie rdzenia ma wpis w tablicy', () => {
  expect(patterns.length).toBeGreaterThan(50);
  const misses = literalTableMisses().map(([k, s]) => `${k} ${s.slice(0, 60)}`);
  expect(misses, `tablica nieaktualna, odśwież: ${REGEN}`).toEqual([]);
});

test('regex-literals-table: wpis równa się analizie liczonej od nowa (kolejność napisów, n, alfabet)', () => {
  for (const re of patterns) {
    const e = LITERAL_TABLE[literalTableKey(re)];
    const f = analyzeFresh(re);
    const want = f === null ? 0 : [f.n === Number.POSITIVE_INFINITY ? -1 : f.n, f.cls, f.set];
    expect(e, `${re.source.slice(0, 80)} (odśwież: ${REGEN})`).toEqual(want);
  }
});

test('regex-literals-table: różne wyrażenia mają różne klucze', () => {
  const byKey = new Map<string, string>();
  for (const re of patterns) {
    const id = `${re.source}\u0000${re.flags}`;
    const k = literalTableKey(re);
    const prev = byKey.get(k);
    if (prev !== undefined) expect(prev).toBe(id);
    byKey.set(k, id);
  }
});

test('regex-literals-table: tablica nie trzyma wpisów spoza rdzenia', () => {
  const keys = new Set(patterns.map(literalTableKey));
  const stale = Object.keys(LITERAL_TABLE).filter((k) => !keys.has(k));
  expect(stale, `wpisy bez wyrażenia, odśwież: ${REGEN}`).toEqual([]);
});
