import { afterEach, expect, test, vi } from 'vitest';
import { storageGet, storageSet } from './storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('zablokowana pamięć witryny (SecurityError przy samym dostępie) nie przerywa aplikacji', () => {
  // Firefox z wyłączonymi ciasteczkami rzuca już przy odczycie window.localStorage.
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  try {
    expect(storageGet('mask-disabled')).toBeNull();
    expect(() => storageSet('mask-disabled', 'pesel')).not.toThrow();
  } finally {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('pełna pamięć (QuotaExceededError przy zapisie) też nie rzuca', () => {
  const data = new Map<string, string>([['pseudonyms', '1']]);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    },
  });
  expect(storageGet('pseudonyms')).toBe('1');
  expect(storageGet('brak')).toBeNull();
  expect(() => storageSet('pseudonyms', '')).not.toThrow();
});
