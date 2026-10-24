import { afterEach, expect, test, vi } from 'vitest';
import { ALLOWED_KEYS, storageGet, storageRemove, storageSet } from './storage';

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
    expect(() => storageRemove('adnotacja')).not.toThrow();
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

test('pamięć przeglądarki tylko przez storage.ts, z kluczami z listy ALLOWED_KEYS', () => {
  expect(appModules.length).toBeGreaterThan(5);
  // Bramka E2E czyta listę z tekstu storage.ts, więc lista nie może być pusta ani zduplikowana.
  expect(ALLOWED_KEYS.length).toBeGreaterThan(0);
  expect(new Set(ALLOWED_KEYS).size).toBe(ALLOWED_KEYS.length);
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

test('każde wywołanie storageGet, storageSet i storageRemove ma klucz z ALLOWED_KEYS wpisany wprost', () => {
  const allowed: readonly string[] = ALLOWED_KEYS;
  // Klucz ze zmiennej albo złożony z kawałków ominąłby i tę listę, i bramkę E2E, więc pierwszym
  // argumentem musi być sam napis w apostrofach.
  const call = /\bstorage(?:Get|Set|Remove)\(\s*([^,)]*)/g;
  const literal = /^'([\w-]+)'$/;
  let calls = 0;
  for (const [file, src] of appModules) {
    if (file === './storage.ts') continue;
    const code = src.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/[^\n]*/g, '$1');
    for (const m of code.matchAll(call)) {
      calls++;
      const arg = m[1].trim();
      const key = literal.exec(arg)?.[1];
      expect(key, `${file}: ${m[0]} bez klucza wpisanego wprost`).toBeDefined();
      expect(allowed, `${file}: klucz ${arg} spoza ALLOWED_KEYS`).toContain(key);
    }
  }
  // main.ts czyta i zapisuje każdy klucz, więc zero trafień znaczyłoby zepsuty wzorzec.
  expect(calls).toBeGreaterThanOrEqual(ALLOWED_KEYS.length * 2);
  // strażnik strażnika: klucz ze zmiennej i klucz spoza listy nie przechodzą
  expect(literal.exec('klucz')).toBeNull();
  expect(allowed).not.toContain('lista-jawne');
});

test('tsc odrzuca klucz spoza ALLOWED_KEYS', () => {
  // Sprawdza to typecheck (npx tsc -p apps/web/tsconfig.json): bez błędu typu każda dyrektywa
  // oczekiwanego błędu niżej sama byłaby błędem. W czasie testu zapis idzie do pamięci zastępczej.
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
  });
  // @ts-expect-error 'cokolwiek' nie należy do StorageKey
  storageSet('cokolwiek', 'x');
  // @ts-expect-error 'kopia-pisma' nie należy do StorageKey
  expect(storageGet('kopia-pisma')).toBeNull();
});
