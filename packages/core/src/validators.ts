// ============================================================================
// Sumy kontrolne (walidacja tnie false-positive do <5%)
// ============================================================================

const onlyDigits = (s: string): number[] =>
  s.replace(/\D/g, '').split('').map((d) => parseInt(d, 10));

/**
 * Wspólny szkielet walidacji sumy kontrolnej „waga × cyfra" (PESEL/NIP/REGON).
 * Sumujemy iloczyny cyfr 0..len-2 z `weights`, a `control(sum)` zwraca oczekiwaną OSTATNIĄ
 * cyfrę kontrolną — albo `null`, gdy dana suma czyni numer nieważnym (wtedy `null === d[…]`
 * jest zawsze fałszem). Cztery walidatory różnią się tylko długością, wagami i regułą kontroli.
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

/** PESEL: 11 cyfr, wagi [1,3,7,9,1,3,7,9,1,3], cyfra kontrolna = (10 − sum%10)%10. */
export function isValidPesel(s: string): boolean {
  return weightedChecksum(s, 11, [1, 3, 7, 9, 1, 3, 7, 9, 1, 3], (sum) => (10 - (sum % 10)) % 10);
}

/** NIP: 10 cyfr, wagi [6,5,7,2,3,4,5,6,7], kontrola = sum%11 (10 → numer nieważny). */
export function isValidNip(s: string): boolean {
  return weightedChecksum(s, 10, [6, 5, 7, 2, 3, 4, 5, 6, 7], (sum) => {
    const c = sum % 11;
    return c === 10 ? null : c;
  });
}

/** REGON 9-cyfrowy: wagi [8,9,2,3,4,5,6,7], kontrola = sum%11 (10 → 0). */
export function isValidRegon9(s: string): boolean {
  return weightedChecksum(s, 9, [8, 9, 2, 3, 4, 5, 6, 7], (sum) => (sum % 11 === 10 ? 0 : sum % 11));
}

/** REGON 14-cyfrowy: wagi [2,4,8,5,0,9,7,3,6,1,2,4,8], kontrola = sum%11 (10 → 0). */
export function isValidRegon14(s: string): boolean {
  return weightedChecksum(
    s,
    14,
    [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8],
    (sum) => (sum % 11 === 10 ? 0 : sum % 11),
  );
}

/** IBAN (dowolny kraj): przenieś 4 pierwsze znaki na koniec, litery→liczby (A=10), mod 97 == 1. */
export function isValidIban(raw: string): boolean {
  // łączniki z kanonicznego zapisu grupami („PL57-1140-2004-…") jak odstępy
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
 * Nr dowodu osobistego: 3 litery + 6 cyfr, wagi [7,3,1,9,7,3,1,7,3] (litera A=10…Z=35),
 * suma ważona WSZYSTKICH 9 znaków (cyfra kontrolna na pozycji 4, waga 9) % 10 == 0.
 * Wektory kontrolne: ABA300000 (7·10+3·11+1·10+9·3 = 140) oraz wzór z materiałów MSWiA
 * ABS123456 (70+33+28+9+14+9+4+35+18 = 220). Do v0.46.22 wagi części cyfrowej były
 * przesunięte ([…,9,1,7,3,1,7]) — ABA300000 to nie wykrywał (same zera), ale ~9 na 10
 * prawdziwych numerów odpadało, więc dowód bez słowa „dowód" obok wyciekał.
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

/**
 * Numer księgi wieczystej: kod wydziału (dwie litery, cyfra, litera), 8 cyfr i cyfra kontrolna,
 * np. „WA1M/00166077/5". Cyfra kontrolna = suma 12 pierwszych znaków z wagami 1, 3, 7 (powtarzanymi)
 * modulo 10; cyfra to swoja wartość, litery mają X=10, A=11, B=12… z pominięciem Q i V (nie występują
 * w kodach wydziałów), więc R=27, S=28, T=29, U=30, W=31, Y=32, Z=33. Algorytm potwierdzony
 * 24.10.2026 na 17 prawdziwych numerach z publicznych ogłoszeń o przetargach (kody KR1P, GD1G,
 * WR1K, WA1M, LD1M, SZ1S, LU1P): wszystkie przechodzą.
 */
const KW_ALPHABET = '0123456789XABCDEFGHIJKLMNOPRSTUWYZ';
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

/** Suma Luhna (mod 10) — walidacja numerów kart płatniczych. */
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
 * Prefiks (IIN) znanej sieci: Visa/Mastercard/Amex/Discover/Diners/JCB. Sam Luhn przepuszcza
 * ~1/10 losowych ciągów — dopiero prefiks + długość + Luhn dają pewność „to naprawdę karta".
 * Maestro i rzadkie sieci (szeroki, mało specyficzny prefiks 50/56–69) celowo pomijamy: ich
 * dodanie zawyżyłoby liczbę fałszywych trafień (precyzja > nadmaskowanie).
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
  if (p4 === 6011 || p2 === 65) return true; // Discover
  if (p2 === 64 && d[2] >= 4 && d[2] <= 9) return true; // Discover 644–649
  if (p4 >= 3528 && p4 <= 3589) return true; // JCB
  if (p2 === 50 || (p2 >= 56 && p2 <= 69)) return true; // Maestro (szeroki prefiks — bezpieczny TYLKO z kontekstem karty)
  return false;
}

/**
 * Numer karty płatniczej: 13–19 cyfr, prefiks znanej sieci + suma Luhna. Kombinacja tych trzech
 * cech jest bardzo specyficzna (jak IBAN mod-97), więc wystarcza SAMODZIELNIE, bez etykiety.
 */
export function isValidCard(raw: string): boolean {
  const d = onlyDigits(raw);
  if (d.length < 13 || d.length > 19) return false;
  if (!hasCardPrefix(d)) return false;
  return luhnValid(d);
}

// ============================================================================
// Strażniki kontekstu — nie myl numeru przepisu z numerem identyfikacyjnym
// ============================================================================

/**
 * Czy dopasowanie jest poprzedzone odwołaniem do aktu/przepisu (art., §, ust., poz., Dz.U., sygn.)?
 * Wtedy ciąg cyfr to numer artykułu/pozycji, NIE telefon/PESEL — nie redagujemy.
 * (Dokumenty urzędowe i prawne są pełne takich odwołań — bez tego strażnika toną w maskach.)
 */
export function precededByLegalRef(full: string, offset: number): boolean {
  // Okno 24 znaki — mieści dłuższe frazy jak „w rejestrze " czy „porządkowy ".
  const before = full.slice(Math.max(0, offset - 24), offset);
  // „regon": ciąg po tej kotwicy to (nie)poprawny REGON — obsłużony (albo słusznie
  // odrzucony) przez krok REGON; detektor telefonu nie może go pożerać (bug z benchmarku).
  // „lp./porządkow…/rejestr…": numer porządkowy pozycji w rejestrze ≠ telefon.
  // „seryjn…/wersj…": numer seryjny urządzenia i numer wersji ≠ telefon/IP.
  return /(art\.?|§|ust\.?|pkt|poz\.?|sygn\.?|nr\s|dz\.?\s?u|regon|lp\.?|porządkow\w+|rejestr\w*|seryjn\w+|wersj\w+)\s*$/i.test(before);
}

/**
 * Czy tuż przed liczbą stoi etykieta numeru, który z definicji NIE jest telefonem („Nr seryjny:",
 * „Numer zamówienia", „Kod kreskowy:", „S/N:", „Zamówienie #", „(build")? precededByLegalRef
 * wymaga etykiety bezpośrednio przed cyframi, więc dwukropek albo rzeczownik po „nr" ją omijały,
 * a to najczęstszy zapis w formularzach, fakturach i zleceniach badań. Tylko dla trybu (c)
 * telefonu — inne przebiegi (PESEL/NIP/IP) mają własne kotwice. Etykieta stoi w TEJ SAMEJ linii.
 * Świadomie bez „pacjenta/klienta" (to identyfikatory osoby) i bez gołego „Numer:" — tam bywa telefon.
 * Jeden wyraz dopowiedzenia wolno („Numer seryjny urządzenia"), ale nie „telefon…/kontakt…"
 * („Nr zamówień telefonicznych: 512 345 678" to infolinia, czyli telefon).
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
