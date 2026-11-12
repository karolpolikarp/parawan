// Drobne narzędzia tekstowe wspólne dla przebiegów: podział na wyrazy, ucieczka regexu, liczenie znaku.

/** Wyrazy (parzyste indeksy `parts`) i zachowane odstępy między nimi; `words` to same wyrazy. */
export function splitWords(s: string): { parts: string[]; words: string[] } {
  const parts = s.split(/([ \t]+)/);
  return { parts, words: parts.filter((_, i) => i % 2 === 0) };
}
export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const countOf = (s: string, ch: string): number => s.split(ch).length - 1;
