import { expect, test } from 'vitest';
import { isProductCopy, PRODUCT_HOSTS } from './web-copy';

test('pasek tylko na hostach strony produktu', () => {
  for (const host of PRODUCT_HOSTS) expect(isProductCopy(host)).toBe(true);
  expect(isProductCopy('Parawan.KarolWilczynski.com')).toBe(true);
  expect(isProductCopy('parawan.karolwilczynski.com.')).toBe(true);
  // plik z dysku (pusty host), intranet urzędu, podróbka z dopiskiem w domenie
  for (const host of ['', 'intranet.urzad.local', 'localhost', 'parawan.karolwilczynski.com.evil.pl', 'github.io']) {
    expect(isProductCopy(host), host).toBe(false);
  }
});
