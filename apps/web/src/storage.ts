/**
 * Pamięć witryny (localStorage) bywa zablokowana: Firefox z wyłączonymi ciasteczkami, polityka
 * firmowa, tryb prywatny w starszym Safari. Sam dostęp rzuca wtedy wyjątek (SecurityError), a bez
 * osłony przerwałby skrypt aplikacji na starcie: bez przełączników, z martwym „Przykładem”.
 * Działamy wtedy bez zapamiętywania ustawień, tylko w bieżącej sesji.
 */

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ustawienie zostaje tylko w tej sesji */
  }
}
