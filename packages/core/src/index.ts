/**
 * Rdzeń „Parawan" (pakiet npm `anonimizator`) — twarda, deterministyczna redakcja
 * polskich danych osobowych (PII).
 *
 * Cel: USUNĄĆ dane osobowe z tekstu, zanim trafi gdziekolwiek dalej (LLM, baza danych,
 * logi, e-mail, cache). To NIE jest „ostrzeżenie" — to redakcja: każde wykryte PII
 * jest zamieniane na neutralny placeholder ([PESEL], [NIP], [IMIĘ I NAZWISKO]…), który
 * zachowuje sens tekstu, ale nie pozwala zidentyfikować osoby.
 *
 * Dwie klasy detekcji:
 *  1. STRUKTURALNE (wysoka pewność) — PESEL, NIP, REGON, IBAN/nr konta, nr dowodu, e-mail,
 *     telefon, kod pocztowy. Tam gdzie istnieje suma kontrolna (PESEL/NIP/REGON/IBAN/dowód)
 *     WALIDUJEMY ją — to tnie fałszywe trafienia (np. sygnatura akt „123456 7890" ≠ NIP).
 *  2. HEURYSTYCZNE (umiarkowana pewność) — imię+nazwisko (słownik polskich imion + wyzwalacze
 *     kontekstu) oraz adres (ul./al./os. + numer). Pełny NER (odmiana, rzadkie nazwiska) wymaga
 *     osobnego modelu — to świadomy kompromis tej warstwy (patrz README: ograniczenia).
 *
 * ZERO zależności i zero API środowiska (brak Deno.env / window / process) — ten sam plik
 * działa identycznie w Node, Deno, Bun i przeglądarce.
 *
 * Funkcja jest idempotentna: placeholdery nie zawierają cyfr ani „@", więc ponowny przebieg
 * (np. dwa niezależne przejścia redakcji) niczego nie psuje.
 */

export type { PiiType, PiiFinding, RedactionResult, RedactOptions } from './types.js';
export { isValidPesel, isValidNip, isValidRegon9, isValidRegon14, isValidIban, isValidDowod, isValidKw, isValidCard } from './validators.js';
export { NON_PERSON_CONTEXT } from './guards/eponyms.js';
export { LEGAL_ENTITY_WORDS } from './guards/roles.js';
export { redactPII, hasPII, describeFindings } from './redact.js';
