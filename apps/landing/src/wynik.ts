/**
 * Wynik okna z tekstem jako HTML: znaczniki w barwach kategorii, widok „Porównanie” i zdanie
 * ze statystyką. Moduł bez DOM: używa go strona (main.ts) i build (vite.config.ts liczy nim
 * stan okna widoczny bez JavaScriptu), a testy porównują oba napisy.
 */
import type { PiiFinding } from 'anonimizator';
import { MASK_TOKEN_RE, maskCategory, typeCategory } from './tokens';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function maskHtml(name: string): string {
  return `<mark class="pii pii-${maskCategory(name)}">[${name}]</mark>`;
}

/*
 * Wyrównanie wyniku z oryginałem (widoki „Wynik” i „Porównanie”). Kopia renderAligned
 * z apps/web/src/compare.ts, tam są testy i pełny opis: zmieniaj obie naraz.
 *  - sam odstęp między dwoma znacznikami nie jest kotwicą (trafiałby w spację wewnątrz
 *    wartości), więc takie znaczniki dostają jeden wspólny przekreślony fragment;
 *  - przekreślony oryginał siedzi w `.orig` z `user-select: none`, więc zaznaczenie
 *    i Ctrl+C w „Porównaniu” dają sam wynik, bez danych osobowych;
 *  - znacznik, który stał już w oryginale, zostaje zwykłym tekstem.
 */
const GAP_ONLY = /^[^\S\r\n]+$/; // same odstępy poziome: spacje, tabulatory, twarde spacje

function origHtml(orig: string): string {
  const lines = escapeHtml(orig).split('\n');
  return lines
    .map((line, i) =>
      line ? `<span class="orig"><del>${line}</del>${i === lines.length - 1 ? ' ' : ''}</span>` : '',
    )
    .join('\n');
}

type Pending = { mask: string } | { gap: string };

export function renderAligned(original: string, redacted: string, compare: boolean): string {
  const parts = redacted.split(MASK_TOKEN_RE); // nieparzyste indeksy to nazwy tokenów
  let html = '';
  let pos = 0;
  let group: Pending[] = [];

  const flush = (gapEnd: number): void => {
    if (group.length) {
      let orig = original.slice(pos, gapEnd);
      // znaczniki zastane na końcu grupy („Jan Kowalski [PESEL]”) zostają zwykłym tekstem
      let tail = '';
      while (group.length >= 3) {
        const last = group[group.length - 1];
        const gap = group[group.length - 2];
        if (!('mask' in last) || !('gap' in gap)) break;
        const literal = `[${last.mask}]`;
        const rest = orig.slice(0, orig.length - literal.length - gap.gap.length);
        if (!rest || orig !== rest + gap.gap + literal) break;
        tail = escapeHtml(gap.gap) + escapeHtml(literal) + tail;
        group.length -= 2;
        orig = rest;
      }
      if (compare && orig) html += origHtml(orig);
      html += group.map((p) => ('mask' in p ? maskHtml(p.mask) : escapeHtml(p.gap))).join('') + tail;
      group = [];
    }
    pos = gapEnd;
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const literal = `[${part}]`;
      if (!group.length && original.startsWith(literal, pos)) {
        html += escapeHtml(literal);
        pos += literal.length;
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
  return html;
}

/** Polska liczba mnoga: 1 → one; końcówka 2–4 poza 12–14 → few; reszta → many. */
export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

/** Zdanie pod oknem: ile fragmentów zasłonięto i w ilu kategoriach. */
export function statHtml(found: PiiFinding[]): string {
  const total = found.reduce((s, f) => s + f.count, 0);
  if (total === 0) return 'Nie wykryto danych osobowych w tym tekście.';
  const cats = new Set(found.map((f) => typeCategory(f.type))).size;
  return (
    `Zasłonięto <b>${total}</b> ${plural(total, 'fragment', 'fragmenty', 'fragmentów')} ` +
    `w <b>${cats}</b> ${cats === 1 ? 'kategorii' : 'kategoriach'}.`
  );
}

/** Liczba znaczników wyniku w każdej kategorii (legenda pod oknem). */
export function licznikKategorii(redacted: string): Record<string, number> {
  const ile: Record<string, number> = {};
  for (const m of redacted.matchAll(MASK_TOKEN_RE)) {
    const k = maskCategory(m[1]);
    ile[k] = (ile[k] ?? 0) + 1;
  }
  return ile;
}
