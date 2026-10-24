/**
 * Model zakresów oryginał–znacznik (bez DOM, więc testowalny w vitest). Rdzeń zwraca tylko tekst
 * wyniku i liczniki, a ręczna korekta, adnotacja i protokół muszą wiedzieć dokładnie, co stoi pod
 * którym znacznikiem. Zakresy odtwarzamy z samego tekstu tą samą metodą co renderAligned
 * (compare.ts), ale w trybie ścisłym: gdy wyniku nie da się dopasować do oryginału co do znaku,
 * alignSpans zwraca null zamiast zgadywać, a aplikacja wyłącza wtedy wszystko, co z zakresów
 * korzysta. Niezmiennik: applySpans(o, alignSpans(o, r).spans) === r, sprawdzany przed zwrotem.
 */
import { MASK_TOKEN_RE } from './pii-meta';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sam odstęp między dwoma znacznikami nie może być kotwicą: indexOf trafiłby w spację wewnątrz
// zamaskowanej wartości („Jan Kowalski 44051401359” daje „[IMIĘ I NAZWISKO] [PESEL]”, a pierwsza
// spacja oryginału stoi między imieniem a nazwiskiem). Takie znaczniki tworzą jeden zakres
// z jednym, wspólnym fragmentem oryginału. Nowa linia zostaje kotwicą, bo dzieli wiersze wyniku.
export const GAP_ONLY = /^[^\S\r\n]+$/; // same odstępy poziome: spacje, tabulatory, twarde spacje

/**
 * Przekreślony oryginał w widoku „Porównanie”. Element `.orig` ma w CSS `user-select: none`,
 * więc zaznaczenie i Ctrl+C dają sam wynik, bez danych osobowych; odstęp za przekreśleniem
 * siedzi w środku, żeby po skopiowaniu nie zostawały podwójne spacje. Każdy wiersz wartości
 * dostaje własny element: wiersze wyniku są osobnymi blokami i znacznik nie może przejść
 * przez granicę wiersza (druga część wartości zostałaby wtedy zwykłym, kopiowalnym tekstem).
 */
export function origHtml(orig: string): string {
  const lines = escapeHtml(orig).split('\n');
  return lines
    .map((line, i) =>
      line
        ? `<span class="orig"><del>${line}</del>${i === lines.length - 1 ? ' ' : ''}</span>`
        : '',
    )
    .join('\n');
}

export interface Span {
  /** Początek zamaskowanego fragmentu w oryginale. */
  start: number;
  /** Koniec (wyłącznie) zamaskowanego fragmentu w oryginale. */
  end: number;
  /** Nazwy tokenów po kolei („[IMIĘ I NAZWISKO] [PESEL]” to jeden zakres z dwoma tokenami). */
  tokens: string[];
  /** Odstępy z wyniku między kolejnymi tokenami (tokens.length − 1 wpisów, także puste). */
  gaps: string[];
  /** 'auto' z redactPII, 'manual' z ręcznej korekty. */
  source: 'auto' | 'manual';
  /**
   * true: w wyniku każdy znacznik zakresu stoi w cudzysłowach, których nie było w oryginale.
   * Rdzeń dopisuje je w dokumencie JSON („"pesel": 85031412347” daje „"pesel": "[PESEL]"”),
   * żeby wynik dalej się parsował.
   */
  quoted?: boolean;
}

export interface SpanAlignment {
  spans: Span[];
  /** Ile znaczników stało już w oryginale (tekst zanonimizowany wcześniej). */
  kept: number;
}

/** Domyślny wygląd zakresu w tekście wyjściowym: znaczniki i odstępy z wyniku. */
const plainSpan = (s: Span): string => {
  const q = s.quoted ? '"' : '';
  return s.tokens.map((t, i) => (i ? s.gaps[i - 1] : '') + `${q}[${t}]${q}`).join('');
};

/** Oryginał z zakresami zastąpionymi przez render (domyślnie znaczniki), reszta dosłownie. */
export function applySpans(
  original: string,
  spans: Span[],
  render: (s: Span, i: number) => string = plainSpan,
): string {
  let out = '';
  let pos = 0;
  spans.forEach((s, i) => {
    out += original.slice(pos, s.start) + render(s, i);
    pos = s.end;
  });
  return out + original.slice(pos);
}

/** Element grupy czekającej na fragment oryginału: znacznik (nazwa tokenu) albo odstęp między znacznikami. */
type Pending = { mask: string } | { gap: string };

export function alignSpans(
  original: string,
  redacted: string,
  tokenRe: RegExp = MASK_TOKEN_RE,
): SpanAlignment | null {
  const parts = redacted.split(tokenRe); // nieparzyste indeksy to nazwy tokenów
  const spans: Span[] = [];
  let kept = 0;
  let pos = 0; // bieżąca pozycja w oryginale
  let group: Pending[] = [];
  // Cudzysłowy dopisane przez rdzeń wokół znacznika (passJsonRequote) bierzemy pod uwagę tylko
  // w tekście, który wygląda na JSON; w prozie cudzysłów w wyniku musi stać w oryginale.
  const json = /^\s*[[{]/.test(original);
  let quoted = false; // odcinek przed bieżącą grupą stracił końcowy cudzysłów (otwarcie znacznika)

  /** Zamyka grupę na fragmencie oryginału [pos, gapEnd); false = dopasowanie nie jest dokładne. */
  const flush = (gapEnd: number): boolean => {
    if (!group.length) return gapEnd === pos; // tekst oryginału zniknąłby bez znacznika
    let end = gapEnd;
    // Znaczniki zastane na końcu grupy (jak w renderAligned): zostają tekstem oryginału za zakresem.
    while (group.length >= 3) {
      const last = group[group.length - 1];
      const gap = group[group.length - 2];
      if (!('mask' in last) || !('gap' in gap)) break;
      const suffix = gap.gap + `[${last.mask}]`;
      if (end - suffix.length <= pos || !original.startsWith(suffix, end - suffix.length)) break;
      kept++;
      group.length -= 2;
      end -= suffix.length;
    }
    if (end === pos) return false; // znacznik bez żadnego fragmentu oryginału
    // Znaczniki zastane w środku grupy („600 700 800 [EMAIL] 44051401359” daje
    // „[TELEFON] [EMAIL] [PESEL]”): jeśli oryginał zawiera dosłownie odstęp, znacznik i odstęp
    // z wyniku, grupa dzieli się tam na dwa zakresy, a znacznik zostaje tekstem oryginału.
    // Inaczej liczyłby się jako nowe wykrycie (chip typu, którego rdzeń w tekście nie znalazł).
    let segStart = pos;
    let seg: Pending[] = [];
    for (let k = 0; k < group.length; k++) {
      const p = group[k];
      const prev = group[k - 1];
      const next = group[k + 1];
      if ('mask' in p && next && 'gap' in next && k + 2 < group.length) {
        const lit = `[${p.mask}]`;
        if (seg.length && prev && 'gap' in prev) {
          // odstęp przed znacznikiem siedzi już na końcu seg
          const needle = prev.gap + lit + next.gap;
          const f = original.indexOf(needle, segStart + 1);
          if (f !== -1 && f + needle.length < end) {
            pushSpan(segStart, f, seg);
            kept++;
            segStart = f + needle.length;
            seg = [];
            k++; // odstęp za znacznikiem należy do tekstu oryginału
            continue;
          }
        } else if (!seg.length && original.startsWith(lit + next.gap, segStart)) {
          // kolejny zastany znacznik tuż za poprzednim
          const after = segStart + lit.length + next.gap.length;
          if (after < end) {
            kept++;
            segStart = after;
            k++;
            continue;
          }
        }
      }
      seg.push(p);
    }
    pushSpan(segStart, end, seg);
    group = [];
    pos = gapEnd;
    return true;
  };

  /** Dopisuje zakres [start, end) z tokenami i odstępami z elementów grupy. */
  const pushSpan = (start: number, end: number, elems: Pending[]): void => {
    const tokens: string[] = [];
    const gaps: string[] = [];
    let gapAcc = '';
    for (const p of elems) {
      if ('gap' in p) gapAcc += p.gap;
      else {
        if (tokens.length) gaps.push(gapAcc);
        tokens.push(p.mask);
        gapAcc = '';
      }
    }
    const span: Span = { start, end, tokens, gaps, source: 'auto' };
    if (quoted) span.quoted = true;
    spans.push(span);
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (i % 2 === 1) {
      const literal = `[${part}]`;
      if (!group.length && original.startsWith(literal, pos)) {
        pos += literal.length;
        kept++;
      } else {
        group.push({ mask: part });
      }
      continue;
    }
    if (!part) continue;
    if (group.length && !quoted && i + 1 < parts.length && GAP_ONLY.test(part)) {
      group.push({ gap: part });
      continue;
    }
    let text = part;
    // Zamknięcie cudzysłowu znacznika: odcinek musi się od niego zaczynać, a w oryginale go nie ma.
    if (quoted) {
      if (!text.startsWith('"') || group.length !== 1) return null;
      text = text.slice(1);
    }
    const find = (t: string): number => {
      const tail = original.length - t.length;
      return i === parts.length - 1 && tail >= pos && original.endsWith(t)
        ? tail
        : original.indexOf(t, pos);
    };
    let idx = text ? find(text) : i === parts.length - 1 ? original.length : pos;
    // Otwarcie cudzysłowu przed następnym znacznikiem: wybieramy wcześniejsze z dwóch dopasowań,
    // bo dosłowny odcinek znaleziony dalej przeskoczyłby fragment oryginału.
    let opens = false;
    if (json && i + 1 < parts.length && text.endsWith('"')) {
      const bare = original.indexOf(text.slice(0, -1), pos);
      if (bare !== -1 && (idx === -1 || bare < idx)) {
        idx = bare;
        opens = true;
      }
    }
    if (idx === -1 || !flush(idx)) return null;
    quoted = opens;
    pos += text.length - (opens ? 1 : 0);
  }
  if (quoted) return null;
  if (!flush(original.length)) return null;
  return applySpans(original, spans) === redacted ? { spans, kept } : null;
}

export interface SpansHtmlOptions {
  /** HTML podświetlonego znacznika po nazwie tokenu. */
  maskHtml: (name: string) => string;
  /** true = widok „Porównanie” (oryginał przekreślony przed znacznikiem). */
  compare: boolean;
  /**
   * true (domyślnie): tekst oryginału w <span data-o="pozycja">, znacznik z data-s="indeks
   * zakresu". Pozycje służą przeliczeniu zaznaczenia w wyniku na miejsca w oryginale.
   */
  positions?: boolean;
}

/** Tekst oryginału od pozycji at, pocięty na wiersze: każdy kawałek z własną pozycją. */
function textHtml(text: string, at: number, positions: boolean): string {
  if (!positions) return escapeHtml(text);
  let o = at;
  return text
    .split('\n')
    .map((line) => {
      const s = line ? `<span data-o="${o}">${escapeHtml(line)}</span>` : '';
      o += line.length + 1;
      return s;
    })
    .join('\n');
}

/**
 * HTML wyniku z zakresów, ten sam co z renderAligned (klasy .orig i del, podział na wiersze);
 * z positions dochodzą data-o i data-s. data-s wstawiamy do pierwszego znacznika HTML z maskHtml.
 */
export function renderSpansHtml(original: string, spans: Span[], opts: SpansHtmlOptions): string {
  const { maskHtml, compare, positions = true } = opts;
  let html = '';
  let pos = 0;
  spans.forEach((s, i) => {
    html += textHtml(original.slice(pos, s.start), pos, positions);
    if (compare) html += origHtml(original.slice(s.start, s.end));
    const q = s.quoted ? '&quot;' : '';
    html += s.tokens
      .map((t, k) => {
        const m = maskHtml(t);
        const tagged = positions ? m.replace(/^<[a-z]+/i, `$& data-s="${i}"`) : m;
        return (k ? escapeHtml(s.gaps[k - 1]) : '') + q + tagged + q;
      })
      .join('');
    pos = s.end;
  });
  return html + textHtml(original.slice(pos), pos, positions);
}

/** Liczba znaczników po nazwie tokenu; pseudonimy [OSOBA-A] liczą się jako imię i nazwisko. */
export function countTokens(spans: Span[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const s of spans)
    for (const t of s.tokens) {
      const k = t.startsWith('OSOBA-') ? 'IMIĘ I NAZWISKO' : t;
      n.set(k, (n.get(k) ?? 0) + 1);
    }
  return n;
}
