// Początki zdań w tekście i ich przeliczanie po podmianie fragmentów (bez ponownego przeszukiwania
// całego tekstu).
import type { Edit } from './regex-literals.js';

/** Wielka litera polska albo nawias maski, od której zaczyna się zdanie po [.!?] i odstępie. */
const HEADS = new Set('ĄĆĘŁŃÓŚŹŻ['.split(''));
const isHead = (c: string): boolean => (c >= 'A' && c <= 'Z') || HEADS.has(c);
const RE_STARTS = /\n|[.!?][ \t]+(?=[A-ZĄĆĘŁŃÓŚŹŻ[])/g;

/** Początki zdań: 0, po każdym nowym wierszu i po [.!?] z odstępem przed wielką literą albo „[”. */
export function sentenceStartsOf(text: string): number[] {
  const starts = [0];
  RE_STARTS.lastIndex = 0;
  for (let m = RE_STARTS.exec(text); m; m = RE_STARTS.exec(text)) starts.push(m.index + m[0].length);
  return starts;
}

const isGap = (c: string | undefined): boolean => c === ' ' || c === '\t';
/**
 * Czy s jest początkiem zdania według sentenceStartsOf. Trafienia wzorca nie nakładają się na siebie
 * w sposób, który zmienia wynik: „\n” zajmuje jeden znak, a ciąg „[.!?][ \t]+” zaczyna się znakiem
 * interpunkcji, którego żadne wcześniejsze trafienie nie obejmuje (obejmuje tylko odstępy). Odstęp
 * jest zachłanny, więc początek stoi za całym ciągiem odstępów i tylko przed wielką literą albo „[”.
 */
function isStart(text: string, s: number): boolean {
  if (s === 0) return true;
  if (text[s - 1] === '\n') return true;
  if (s >= text.length || !isGap(text[s - 1]) || !isHead(text[s])) return false;
  let k = s - 1;
  while (k >= 0 && isGap(text[k])) k--;
  const c = text[k];
  return c === '.' || c === '!' || c === '?';
}

/**
 * Początki zdań nowego tekstu z początków starego i zmian (rosnąco, rozłącznie, w położeniach starego
 * tekstu). Początek s zależy tylko od znaków s, s − 1 i ciągu odstępów przed s − 1 ze znakiem przed
 * nim, więc zmienić się mogą tylko początki od początku zmiany do pierwszego znaku po odstępach za
 * nią; te pozycje są liczone od nowa, pozostałe przesuwają się o różnicę długości.
 */
export function updateSentenceStarts(old: readonly number[], text: string, edits: readonly Edit[]): number[] {
  const out: number[] = [];
  let i = 0;
  let delta = 0;
  let dirtyEnd = -1; // ostatnia przeliczona pozycja nowego tekstu
  for (let e = 0; e < edits.length; e++) {
    const [at, oldLen, newLen] = edits[e];
    // ciąg odstępów za zmianą może sięgać następnej zmiany: dalsze stare początki rozlicza ona
    const nextAt = e + 1 < edits.length ? edits[e + 1][0] : Number.POSITIVE_INFINITY;
    while (i < old.length && old[i] < at) {
      const p = old[i] + delta;
      if (p > dirtyEnd) out.push(p);
      i++;
    }
    const a = at + delta;
    let b = a + newLen;
    while (b < text.length && isGap(text[b])) b++;
    for (let s = Math.max(a, dirtyEnd + 1); s <= b && s <= text.length; s++) if (isStart(text, s)) out.push(s);
    delta += newLen - oldLen;
    while (i < old.length && old[i] < nextAt && old[i] + delta <= b) i++;
    if (b > dirtyEnd) dirtyEnd = b;
  }
  for (; i < old.length; i++) {
    const p = old[i] + delta;
    if (p > dirtyEnd) out.push(p);
  }
  return out;
}
