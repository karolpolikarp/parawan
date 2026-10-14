import { expect, test } from 'vitest';
import { plural } from './plural';

test('odmiana po liczebniku: 1, 2–4 (poza 12–14) i reszta', () => {
  const f = (n: number): string => `${n} ${plural(n, 'fragment', 'fragmenty', 'fragmentów')}`;
  expect([0, 1, 2, 5, 12, 22, 112].map(f)).toEqual([
    '0 fragmentów',
    '1 fragment',
    '2 fragmenty',
    '5 fragmentów',
    '12 fragmentów',
    '22 fragmenty',
    '112 fragmentów',
  ]);
});
