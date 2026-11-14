// Drobne narzędzia tekstowe wspólne dla przebiegów: podział na wyrazy, ucieczka regexu, liczenie znaku.

/** Wyrazy (parzyste indeksy `parts`) i zachowane odstępy między nimi; `words` to same wyrazy. */
export function splitWords(s: string): { parts: string[]; words: string[] } {
  const parts = s.split(/([ \t]+)/);
  return { parts, words: parts.filter((_, i) => i % 2 === 0) };
}
export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const countOf = (s: string, ch: string): number => s.split(ch).length - 1;

/**
 * Decyzja o trafieniu, która czyta tekst tylko w oknie [offset - before, offset + m.length + after]
 * (lewy brzeg przez Math.max(0, …)), liczona raz na okno. Długa linia z tysiącami takich samych
 * trafień („IP 10.1.2.3. ” w kółko) nie przelicza wtedy tych samych strażników. Kluczem jest całe
 * okno z położeniem trafienia, więc wynik jest ten sam co bez pamięci. clear() po przebiegu zwalnia
 * fragmenty tekstu.
 */
export function windowMemo(
  before: number,
  after: number,
  fn: (text: string, offset: number, m: string) => boolean,
): { (text: string, offset: number, m: string): boolean; clear(): void } {
  const memo = new Map<string, boolean>();
  const run = (text: string, offset: number, m: string): boolean => {
    const a = Math.max(0, offset - before);
    const s = text.slice(a, offset + m.length + after);
    // długi klucz (trafienie z tysiącami spacji) kosztuje więcej niż sama decyzja
    if (s.length > 2048) return fn(s, offset - a, m);
    const key = `${offset - a},${m.length},${s}`;
    let r = memo.get(key);
    if (r === undefined) {
      if (memo.size >= 4096) memo.clear();
      r = fn(s, offset - a, m);
      memo.set(key, r);
    }
    return r;
  };
  return Object.assign(run, { clear: () => memo.clear() });
}
