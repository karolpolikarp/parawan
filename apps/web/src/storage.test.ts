import { afterEach, expect, test, vi } from 'vitest';
import { STORAGE_KEYS, storageGet, storageSet } from './storage';

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
  expect(storageGet('motion')).toBeNull();
  expect(() => storageSet('pseudonyms', '')).not.toThrow();
});

// Moduły aplikacji (bez testów i deklaracji) jako tekst.
const appModules = Object.entries(
  import.meta.glob<string>(['./*.ts', '!./*.test.ts', '!./*.d.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

test('pamięć przeglądarki tylko przez storage.ts, z kluczami z listy STORAGE_KEYS', () => {
  expect(appModules.length).toBeGreaterThan(5);
  // Bramka E2E czyta listę z tekstu storage.ts, więc lista nie może być pusta ani zduplikowana.
  expect(STORAGE_KEYS.length).toBeGreaterThan(0);
  expect(new Set(STORAGE_KEYS).size).toBe(STORAGE_KEYS.length);
  // Inny moduł z własnym localStorage, sessionStorage, IndexedDB albo ciasteczkiem zostawiałby
  // dane na komputerze urzędnika z pominięciem listy kluczy.
  const direct = /\b(?:localStorage|sessionStorage|indexedDB|caches)\b|document\.cookie/;
  for (const [file, src] of appModules) {
    if (file === './storage.ts') continue;
    // bez komentarzy, które opisują zachowanie przeglądarki nazwami tych API
    const code = src.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, '$1');
    expect(code, `${file} sięga po pamięć przeglądarki z pominięciem storage.ts`).not.toMatch(direct);
  }
  // strażnik strażnika: zapis z pominięciem storage.ts zostałby wyłapany
  expect("sessionStorage.setItem('x', tekst);").toMatch(direct);
  expect('document.cookie = tekst;').toMatch(direct);
});
