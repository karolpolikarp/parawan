/**
 * Rdzeń Parawana (pakiet npm `anonimizator`): deterministyczna redakcja polskich danych osobowych.
 * Każde wykryte PII zamienia się na placeholder ([PESEL], [IMIĘ I NAZWISKO]…). Typy z sumą
 * kontrolną są walidowane, pozostałe wymagają kotwicy kontekstowej (etykieta, wyzwalacz, słownik).
 * Bez zależności i bez API środowiska, więc działa tak samo w Node, Deno, Bun i przeglądarce.
 * Wynik jest idempotentny: placeholdery nie zawierają cyfr ani „@".
 *
 * Ten plik tylko reeksportuje publiczne API. Logika: redact.ts (orkiestrator i kolejność przebiegów),
 * passes/ (przebiegi według rodzaju danych), guards/ (strażniki kontekstu), dict/ i surnames.ts
 * (słowniki), validators.ts (sumy kontrolne), charset.ts i person-patterns.ts (wspólne wzorce),
 * context.ts (stan redakcji), struct-keys.ts (klucze XML/JSON), types.ts (typy i placeholdery).
 */

export type { PiiType, PiiFinding, RedactionResult, RedactOptions } from './types.js';
export { isValidPesel, isValidNip, isValidRegon9, isValidRegon14, isValidIban, isValidDowod, isValidKw, isValidCard } from './validators.js';
export { NON_PERSON_CONTEXT } from './guards/eponyms.js';
export { LEGAL_ENTITY_WORDS } from './guards/roles.js';
export { redactPII, hasPII, describeFindings } from './redact.js';
