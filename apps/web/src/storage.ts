/**
 * Pamięć witryny (localStorage) bywa zablokowana: Firefox z wyłączonymi ciasteczkami, polityka
 * firmowa, tryb prywatny w starszym Safari. Sam dostęp rzuca wtedy wyjątek (SecurityError), a bez
 * osłony przerwałby skrypt aplikacji na starcie: bez przełączników, z martwym „Przykładem”.
 * Działamy wtedy bez zapamiętywania ustawień, tylko w bieżącej sesji.
 */

/**
 * Jedyne klucze, które Parawan zapisuje w localStorage: wyłączone typy danych, tryb osób
 * i animacja. Każdy nowy klucz to nowa informacja zostawiana na komputerze urzędnika, więc trafia
 * tu świadomie. Bramka E2E (scripts/e2e/helpers.mjs) czyta tę listę z tekstu tego pliku i po
 * każdym teście odrzuca każdy inny klucz, więc lista zostaje w jednym wierszu niżej, jako napisy
 * w nawiasach kwadratowych.
 */
export const STORAGE_KEYS = ['mask-disabled', 'pseudonyms', 'motion'] as const;
export type StorageKey = (typeof STORAGE_KEYS)[number];

export function storageGet(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ustawienie zostaje tylko w tej sesji */
  }
}
