/**
 * Wyrównanie wyniku z oryginałem, wspólne dla widoków „Wynik” i „Porównanie” (bez DOM, więc
 * testowalne w vitest). Landing (apps/landing/src/main.ts) ma kopię tej logiki: zmieniaj obie naraz.
 *
 * Diff w O(n): niemaskowe odcinki wyniku występują w oryginale dosłownie i po kolei, więc luka
 * w oryginale między nimi to zamaskowana wartość. Najpierw tryb ścisły (spans.ts); gdy wynik
 * nie pasuje do oryginału co do znaku, zostaje dawna heurystyka, wyłącznie do podglądu: przy
 * nieznalezionym odcinku zgaduje granicę zamiast odmówić.
 */
import { alignSpans, escapeHtml, GAP_ONLY, origHtml, renderSpansHtml } from './spans';

export { escapeHtml };

export interface AlignOptions {
  /** Wzorzec znacznika z jedną grupą przechwytującą (nazwą tokenu), np. /\[(PESEL|NIP)\]/g. */
  tokenRe: RegExp;
  /** HTML podświetlonego znacznika po nazwie tokenu. */
  maskHtml: (name: string) => string;
  /** true = widok „Porównanie” (oryginał przekreślony przed znacznikiem), false = sam wynik. */
  compare: boolean;
}

export interface Aligned {
  html: string;
  /** Ile znaczników stało już w oryginale (tekst zanonimizowany wcześniej). */
  kept: number;
}

/** Element grupy czekającej na fragment oryginału: znacznik (nazwa tokenu) albo odstęp między znacznikami. */
type Pending = { mask: string } | { gap: string };

export function renderAligned(original: string, redacted: string, opts: AlignOptions): Aligned {
  const { tokenRe, maskHtml, compare } = opts;
  const strict = alignSpans(original, redacted, tokenRe);
  if (strict) {
    const html = renderSpansHtml(original, strict.spans, { maskHtml, compare, positions: false });
    return { html, kept: strict.kept };
  }
  return guessAligned(original, redacted, opts);
}

/** Dawna heurystyka bez trybu ścisłego, dla tekstów, których alignSpans nie dopasował (eksport dla spans.test.ts). */
export function guessAligned(original: string, redacted: string, opts: AlignOptions): Aligned {
  const { tokenRe, maskHtml, compare } = opts;
  const parts = redacted.split(tokenRe); // nieparzyste indeksy to nazwy tokenów
  let html = '';
  let kept = 0;
  let pos = 0; // bieżąca pozycja w oryginale
  let group: Pending[] = []; // znaczniki (i odstępy między nimi) czekające na swój fragment oryginału

  const flush = (gapEnd: number): void => {
    if (group.length) {
      let orig = original.slice(pos, gapEnd);
      // Znaczniki zastane na końcu grupy: „Jan Kowalski [PESEL] i tel. …” daje „[IMIĘ I NAZWISKO]
      // [PESEL] i tel. …”, a [PESEL] stał w oryginale tuż za nową wartością, oddzielony samą spacją.
      // Zdejmujemy je od końca, dopóki wycinek oryginału kończy się odstępem i literałem znacznika;
      // pierwszy znacznik grupy zostaje, bo to on odpowiada za resztę wycinka.
      let tail = '';
      while (group.length >= 3) {
        const last = group[group.length - 1];
        const gap = group[group.length - 2];
        if (!('mask' in last) || !('gap' in gap)) break;
        const literal = `[${last.mask}]`;
        const rest = orig.slice(0, orig.length - literal.length - gap.gap.length);
        if (!rest || orig !== rest + gap.gap + literal) break;
        tail = escapeHtml(gap.gap) + escapeHtml(literal) + tail;
        kept++;
        group.length -= 2;
        orig = rest;
      }
      if (compare && orig) html += origHtml(orig);
      html +=
        group.map((p) => ('mask' in p ? maskHtml(p.mask) : escapeHtml(p.gap))).join('') + tail;
      group = [];
    }
    pos = gapEnd;
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const literal = `[${part}]`;
      // Znacznik, który stał już w oryginale (np. ponowna anonimizacja wyniku), nie jest nowym
      // wykryciem: zostaje zwykłym tekstem, bez przekreślenia, podświetlenia i miejsca w nawigacji.
      if (!group.length && original.startsWith(literal, pos)) {
        html += escapeHtml(literal);
        pos += literal.length;
        kept++;
      } else {
        group.push({ mask: part });
      }
      continue;
    }
    if (!part) continue;
    if (group.length && i + 1 < parts.length && GAP_ONLY.test(part)) {
      group.push({ gap: part });
      continue;
    }
    // Ostatni odcinek kończy oryginał, więc szukamy go od końca: „Jan Kowalski ” ma spację
    // za nazwiskiem, a indexOf znalazłby wcześniejszą, między imieniem a nazwiskiem.
    const tail = original.length - part.length;
    const idx =
      i === parts.length - 1 && tail >= pos && original.endsWith(part)
        ? tail
        : original.indexOf(part, pos);
    flush(idx === -1 ? pos : idx);
    html += escapeHtml(part);
    pos += part.length;
  }
  flush(original.length);
  return { html, kept };
}
