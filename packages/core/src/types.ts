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
  /** liczba wystąpień zredagowanych w tekście (NIGDY nie zapisujemy oryginalnej wartości) */
  count: number;
}

export interface RedactionResult {
  redacted: string;
  found: PiiFinding[];
}

export interface RedactOptions {
  /** Typy do maskowania. Domyślnie (brak pola) — WSZYSTKIE. Pusta lista = nic nie maskuj. */
  types?: PiiType[];
  /**
   * Własne placeholdery per typ. UWAGA na idempotencję: placeholder nie może zawierać cyfr
   * ani „@" — inaczej ponowny przebieg redakcji mógłby go pożreć jako PII.
   */
  masks?: Partial<Record<PiiType, string>>;
  /**
   * Spójna pseudonimizacja osób: zamiast jednej maski [IMIĘ I NAZWISKO] każda osoba
   * dostaje stałą etykietę [OSOBA-A], [OSOBA-B]… — ta sama osoba (także w odmianie:
   * Kowalski/Kowalskiego/Kowalskiemu) zachowuje tę samą literę. Zachowuje strukturę
   * relacji w dokumencie. Klucz tożsamości = znormalizowane nazwisko, więc osoby
   * o tym samym nazwisku (Jan i Anna Kowalscy) dostają wspólną etykietę — ograniczenie.
   */
  pseudonyms?: boolean;
}

/** Etykiety placeholderów (czytelne dla człowieka i modelu, bez cyfr → idempotentne). */
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
