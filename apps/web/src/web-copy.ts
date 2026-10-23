/**
 * Hosty strony produktu. Plik otwarty wprost z takiego adresu działa jak zwykła strona WWW:
 * rozszerzenia przeglądarki z uprawnieniem do „wszystkich stron” czytają treść karty, czego przy
 * pliku z dysku (file://) zwykle nie robią. Lista stała, bez pytania sieci. Kopia w intranecie
 * urzędu (inny host) paska nie dostaje, bo DLA-IOD-I-IT.txt dopuszcza takie wdrożenie.
 */
export const PRODUCT_HOSTS = ['parawan.karolwilczynski.com', 'karolpolikarp.github.io'] as const;

/** Czy plik otwarto ze strony produktu (host bez rozróżniania wielkości liter i kropki na końcu). */
export function isProductCopy(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (PRODUCT_HOSTS as readonly string[]).includes(host);
}
