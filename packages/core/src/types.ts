// Publiczne typy redakcji oraz placeholdery i czytelne nazwy każdego typu PII.

export type PiiType =
  | 'EMAIL'
  | 'IBAN'
  | 'NR-KONTA'
  | 'KARTA'
  | 'PESEL'
  | 'NIP'
  | 'REGON'
  | 'TELEFON'
  | 'DOWOD'
  | 'PASZPORT'
  | 'KRS'
  | 'KSEF'
  | 'KW'
  | 'PRAWO-JAZDY'
  | 'NR-REJESTRACYJNY'
  | 'VIN'
  | 'IP'
  | 'MAC'
  | 'TOKEN'
  | 'LOGIN'
  | 'ZNAK-SPRAWY'
  | 'KOD-POCZTOWY'
  | 'DATA-UR'
  | 'ADRES'
  | 'MIEJSCOWOSC'
  | 'IMIE';

export interface PiiFinding {
  type: PiiType;
  /** Liczba zredagowanych wystąpień; oryginalnej wartości nigdy nie zapisujemy. */
  count: number;
}

export interface RedactionResult {
  redacted: string;
  found: PiiFinding[];
}

export interface RedactOptions {
  /** Typy do maskowania. Bez pola maskowane są wszystkie, pusta lista nie maskuje niczego. */
  types?: PiiType[];
  /**
   * Własne placeholdery dla typów. Placeholder nie może zawierać cyfr ani „@”, bo ponowny
   * przebieg redakcji wziąłby go za dane osobowe.
   */
  masks?: Partial<Record<PiiType, string>>;
  /**
   * Zamiast jednej maski każda osoba dostaje stałą etykietę [OSOBA-A], [OSOBA-B]…, także w odmianie.
   * Kluczem jest znormalizowane nazwisko, więc Jan i Anna Kowalscy dzielą jedną etykietę.
   */
  pseudonyms?: boolean;
}

/** Placeholdery czytelne dla człowieka i modelu; bez cyfr, więc redakcja jest idempotentna. */
export const MASK: Record<PiiType, string> = {
  EMAIL: '[EMAIL]',
  IBAN: '[NR-KONTA]',
  'NR-KONTA': '[NR-KONTA]',
  KARTA: '[NR-KARTY]',
  PESEL: '[PESEL]',
  NIP: '[NIP]',
  REGON: '[REGON]',
  TELEFON: '[TELEFON]',
  DOWOD: '[NR-DOWODU]',
  PASZPORT: '[NR-PASZPORTU]',
  KRS: '[KRS]',
  KSEF: '[NR-KSEF]',
  KW: '[NR-KW]',
  'PRAWO-JAZDY': '[PRAWO-JAZDY]',
  'NR-REJESTRACYJNY': '[NR-REJESTRACYJNY]',
  VIN: '[VIN]',
  IP: '[IP]',
  MAC: '[MAC]',
  TOKEN: '[TOKEN]',
  LOGIN: '[LOGIN]',
  'ZNAK-SPRAWY': '[ZNAK-SPRAWY]',
  'KOD-POCZTOWY': '[KOD-POCZTOWY]',
  'DATA-UR': '[DATA-URODZENIA]',
  ADRES: '[ADRES]',
  MIEJSCOWOSC: '[MIEJSCOWOŚĆ]',
  IMIE: '[IMIĘ I NAZWISKO]',
};

/** Czytelne etykiety wykrytych typów (np. do komunikatu „Zamaskowano: PESEL, e-mail"). */
export const HUMAN_LABEL: Record<PiiType, string> = {
  EMAIL: 'adres e-mail',
  IBAN: 'numer konta',
  'NR-KONTA': 'numer konta',
  KARTA: 'numer karty płatniczej',
  PESEL: 'PESEL',
  NIP: 'NIP',
  REGON: 'REGON',
  TELEFON: 'numer telefonu',
  DOWOD: 'numer dowodu',
  PASZPORT: 'numer paszportu',
  KRS: 'numer KRS',
  KSEF: 'numer KSeF',
  KW: 'numer księgi wieczystej',
  'PRAWO-JAZDY': 'nr prawa jazdy',
  'NR-REJESTRACYJNY': 'nr rejestracyjny',
  VIN: 'VIN',
  IP: 'adres IP',
  MAC: 'adres MAC',
  TOKEN: 'token',
  LOGIN: 'login',
  'ZNAK-SPRAWY': 'znak sprawy',
  'KOD-POCZTOWY': 'kod pocztowy',
  'DATA-UR': 'datę urodzenia',
  ADRES: 'adres',
  MIEJSCOWOSC: 'miejscowość',
  IMIE: 'imię i nazwisko',
};
