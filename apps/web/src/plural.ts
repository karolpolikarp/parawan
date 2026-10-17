/**
 * Polska odmiana rzeczownika po liczebniku: 1 → `one` („1 fragment”), końcówka 2–4 poza
 * 12–14 → `few` („3 fragmenty”, „22 fragmenty”), reszta → `many` („5 fragmentów”, „12 fragmentów”).
 * Ten sam algorytm co na landingu (apps/landing/src/main.ts).
 */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}
