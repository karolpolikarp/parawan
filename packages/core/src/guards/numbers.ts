// Strażniki kontekstu numerów: kod waluty przed kwotą, odwołanie do przepisu albo rejestru i etykieta
// numeru technicznego, które odróżniają taki numer od danej osobowej.

/** Kody walut: ciąg cyfr po nich to kwota (DOWÓD, IBAN, TELEFON). */
export const CURRENCY_CODES = new Set([
  'PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'JPY', 'UAH', 'RUB',
]);
/**
 * Czy tuż przed dopasowaniem stoi odwołanie do przepisu albo rejestru (art., §, poz., Dz.U., sygn.)?
 * Wtedy liczba to numer artykułu lub pozycji, nie telefon ani PESEL.
 */
export function precededByLegalRef(full: string, offset: number): boolean {
  // Okno 24 znaków mieści dłuższe frazy, np. „w rejestrze ”.
  const before = full.slice(Math.max(0, offset - 24), offset);
  // Po „regon” numer obsługuje (albo słusznie odrzuca) przebieg REGON, nie telefon.
  // „lp./porządkow…/rejestr…” to numer pozycji, „seryjn…/wersj…” numer urządzenia lub wersji.
  return /(art\.?|§|ust\.?|pkt|poz\.?|sygn\.?|nr\s|dz\.?\s?u|regon|lp\.?|porządkow\w+|rejestr\w*|seryjn\w+|wersj\w+)\s*$/i.test(before);
}
/**
 * Etykieta numeru, który nie jest telefonem („Nr seryjny:”), w tej samej linii co liczba. Celowo bez
 * „pacjenta/klienta” (identyfikują osobę) i bez gołego „Numer:”, gdzie bywa telefon. Dopowiedzenie
 * po etykiecie nie może zaczynać się od tel/kom/kontakt („Nr zamówień telefonicznych” to infolinia).
 */
const RE_NON_PHONE_LABEL = new RegExp(
  '(?:(?<![\\p{L}\\d])(?:nr|numer|kod|id|identyfikator)\\.?[ \\t]+' +
    '(?:seryjn\\p{L}*|fabryczn\\p{L}*|zamówie(?:nia|ń)|ogłosze(?:nia|ń)|zlecenia|faktury|próbki|badania|' +
    'dokumentu|paragonu|przesyłki|transakcji|kreskowy|referencyjny|partii)(?:[ \\t]+(?!tel|kom|kontakt)\\p{L}+)?[ \\t]*[:#=.-]?' +
    '|(?<![\\p{L}\\d])s\\/n[ \\t]*:?|(?<![\\p{L}\\d])seryjn\\p{L}*[ \\t]*:|(?<![\\p{L}\\d])build[ \\t]*[:#]?' +
    '|(?<![\\p{L}\\d&])#)[ \\t]*$',
  'iu',
);
export function precededByNonPhoneLabel(full: string, offset: number): boolean {
  return RE_NON_PHONE_LABEL.test(full.slice(Math.max(0, offset - 48), offset));
}
