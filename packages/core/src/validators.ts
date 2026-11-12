// Sumy kontrolne numerów (PESEL, NIP, REGON, IBAN, dowód, księga wieczysta, karta) i strażniki
// kontekstu, które odróżniają numer przepisu albo etykietę techniczną od danej osobowej.

/** Kody walut: ciąg cyfr po nich to kwota (DOWÓD, IBAN, TELEFON). */
export const CURRENCY_CODES = new Set([
  'PLN', 'EUR', 'USD', 'GBP', 'CHF', 'CZK', 'SEK', 'NOK', 'DKK', 'JPY', 'UAH', 'RUB',
]);

const onlyDigits = (s: string): number[] =>
  s.replace(/\D/g, '').split('').map((d) => parseInt(d, 10));

/**
 * Suma ważona cyfr 0..len-2; `control(sum)` zwraca oczekiwaną ostatnią cyfrę albo `null`,
 * gdy taka suma unieważnia numer (porównanie z cyfrą wtedy zawsze daje fałsz).
 */
function weightedChecksum(
  s: string,
  len: number,
  weights: number[],
  control: (sum: number) => number | null,
): boolean {
  const d = onlyDigits(s);
  if (d.length !== len) return false;
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += d[i] * weights[i];
  return control(sum) === d[len - 1];
}

const regonControl = (sum: number): number => (sum % 11 === 10 ? 0 : sum % 11);

export function isValidPesel(s: string): boolean {
  return weightedChecksum(s, 11, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], (sum) => (10 - (sum % 10)) % 10);
}

export function isValidNip(s: string): boolean {
  return weightedChecksum(s, 10, [6, 5, 7, 2, 3, 4, 5, 6, 7], (sum) => {
    const c = sum % 11;
    return c === 10 ? null : c;
  });
}

export function isValidRegon9(s: string): boolean {
  return weightedChecksum(s, 9, [8, 9, 2, 3, 4, 5, 6, 7], regonControl);
}

export function isValidRegon14(s: string): boolean {
  return weightedChecksum(s, 14, [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8], regonControl);
}

/** IBAN dowolnego kraju: 4 pierwsze znaki na koniec, litery na liczby (A=10), reszta mod 97 równa 1. */
export function isValidIban(raw: string): boolean {
  // Łączniki z zapisu grupami („PL57-1140-2004-…”) traktujemy jak odstępy.
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(s)) return false;
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of code) {
      remainder = (remainder * 10 + parseInt(c, 10)) % 97;
    }
  }
  return remainder === 1;
}

/**
 * Dowód osobisty: 3 litery i 6 cyfr, suma ważona wszystkich 9 znaków (A=10…Z=35) mod 10 równa 0.
 * Cyfra kontrolna stoi na pozycji 4 z wagą 9, np. „ABS123456”.
 */
export function isValidDowod(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{3}\d{6}$/.test(s)) return false;
  const w = [7, 3, 1, 9, 7, 3, 1, 7, 3];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const ch = s[i];
    const val = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : parseInt(ch, 10);
    sum += val * w[i];
  }
  return sum % 10 === 0;
}

const KW_ALPHABET = '0123456789XABCDEFGHIJKLMNOPRSTUWYZ';
/**
 * Księga wieczysta, np. „WA1M/00166077/5”: cyfra kontrolna to suma 12 znaków z wagami 1, 3, 7
 * modulo 10. Litery liczą się od X=10, A=11, B=12… z pominięciem Q i V (nie ma ich w kodach wydziałów).
 */
export function isValidKw(raw: string): boolean {
  const s = raw.replace(/[\s/]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d[A-Z]\d{9}$/.test(s)) return false;
  const w = [1, 3, 7];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const v = KW_ALPHABET.indexOf(s[i]);
    if (v < 0) return false;
    sum += v * w[i % 3];
  }
  return sum % 10 === Number(s[12]);
}

function luhnValid(digits: number[]): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let x = digits[i];
    if (double) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    sum += x;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Prefiks IIN znanej sieci (Visa, Mastercard, Amex, Diners, JCB, Maestro). Maestro (50, 56–69)
 * jest szeroki i pokrywa też Discover, więc bezpieczny tylko z kontekstem karty, który wymusza passCard.
 */
function hasCardPrefix(d: number[]): boolean {
  const p2 = d[0] * 10 + d[1];
  const p4 = p2 * 100 + d[2] * 10 + d[3];
  if (d[0] === 4) return true; // Visa
  if (p2 >= 51 && p2 <= 55) return true; // Mastercard
  if (p4 >= 2221 && p4 <= 2720) return true; // Mastercard (seria 2)
  if (p2 === 34 || p2 === 37) return true; // American Express
  if (p2 === 36 || p2 === 38 || p2 === 39) return true; // Diners Club
  if (d[0] === 3 && d[1] === 0 && d[2] <= 5) return true; // Diners 300–305
  if (p4 >= 3528 && p4 <= 3589) return true; // JCB
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return true; // Maestro i Discover
  return false;
}

/**
 * Karta płatnicza: 13–19 cyfr, prefiks znanej sieci i suma Luhna. To nie wystarcza (IMEI też ma
 * Luhna), więc wołać tylko z kontekstem karty.
 */
export function isValidCard(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length < 13 || d.length > 19) return false;
  if (!hasCardPrefix(d)) return false;
  return luhnValid(d);
}

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
