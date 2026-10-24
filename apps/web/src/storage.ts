/**
 * Pamięć witryny (localStorage) bywa zablokowana: Firefox z wyłączonymi ciasteczkami, polityka
 * firmowa, tryb prywatny w starszym Safari. Sam dostęp rzuca wtedy wyjątek (SecurityError), a bez
 * osłony przerwałby skrypt aplikacji na starcie: bez przełączników, z martwym „Przykładem”.
 * Działamy wtedy bez zapamiętywania ustawień, tylko w bieżącej sesji.
 */

/**
 * Jedyne klucze, które Parawan zapisuje w localStorage: wyłączone typy danych, tryb osób,
 * animacja i (na życzenie) organ z osobą do adnotacji. Każdy nowy klucz to nowa informacja
 * zostawiana na komputerze urzędnika, więc trafia tu świadomie. Bramka E2E
 * (scripts/e2e/helpers.mjs) czyta tę listę z tekstu tego pliku i po każdym teście odrzuca każdy
 * inny klucz, więc lista zostaje w jednym wierszu niżej, jako napisy w nawiasach kwadratowych.
 *
 * W Chromium localStorage jest wspólny dla wszystkich plików otwartych z dysku (file://), więc
 * każdy inny plik .html, np. załącznik otwarty z Pobranych, może tu zapisać, co zechce. Reguły
 * dla każdego pakietu, który dokłada ustawienie:
 * (a) żadnej treści pism ani danych osobowych w localStorage, tylko ustawienia;
 * (b) ustawienie, które zmniejsza zasłanianie (wyłączone typy, lista „Zostaw jawne”, profil BIP),
 *     po odczycie z pamięci jest zawsze widoczne przy wyniku, z liczbą pozycji i sposobem
 *     wyłączenia, bo mógł je zapisać obcy plik;
 * (c) listy z danymi osobowymi („Zawsze zasłaniaj”) żyją tylko w pamięci karty, a przechodzą
 *     między sesjami przez zapis i wczytanie pliku, który wybiera użytkownik;
 * (d) nowy klucz to wpis w ALLOWED_KEYS i w docs/wydanie/DLA-IOD-I-IT.txt;
 * (e) wyjątek od (a): klucz 'adnotacja' trzyma organ i osobę z karty „Adnotacja i protokół”
 *     (imię i nazwisko pracownika), ale tylko po zaznaczeniu „Pamiętaj organ i osobę na tym
 *     komputerze”, a odznaczenie go usuwa. Bez zgody pola żyją tylko w pamięci karty.
 * storage.test.ts pilnuje, żeby każde wywołanie storageGet, storageSet i storageRemove miało klucz
 * z tej listy wpisany wprost, a tsc odrzuca każdy inny napis.
 */
export const ALLOWED_KEYS = ['mask-disabled', 'pseudonyms', 'motion', 'adnotacja'] as const;
export type StorageKey = (typeof ALLOWED_KEYS)[number];

export function storageGet(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageRemove(key: StorageKey): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* pamięć zablokowana: i tak nic w niej nie ma */
  }
}

export function storageSet(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ustawienie zostaje tylko w tej sesji */
  }
}
