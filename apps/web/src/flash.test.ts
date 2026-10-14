import { afterEach, expect, test, vi } from 'vitest';
import { makeFlash } from './flash';

afterEach(() => {
  vi.useRealTimers();
});

test('dwa szybkie kliknięcia „Kopiuj”: etykieta wraca do stałej, nie przykleja się', () => {
  vi.useFakeTimers();
  let label = 'Kopiuj';
  const flash = makeFlash((t) => (label = t), 'Kopiuj');
  flash.show('Skopiowano ✓');
  vi.advanceTimersByTime(300);
  flash.show('Skopiowano ✓'); // dawniej zapamiętywało „Skopiowano ✓” jako poprzednią etykietę
  expect(label).toBe('Skopiowano ✓');
  vi.advanceTimersByTime(1600);
  expect(label).toBe('Kopiuj');
  vi.advanceTimersByTime(1400);
  expect(label).toBe('Kopiuj');
});

test('reset przywraca stałą etykietę od razu i kasuje zaległy timer', () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  const flash = makeFlash((t) => seen.push(t), 'Kopiuj');
  flash.show('Skopiowano ✓');
  flash.reset();
  vi.advanceTimersByTime(5000);
  expect(seen).toEqual(['Skopiowano ✓', 'Kopiuj']);
});
