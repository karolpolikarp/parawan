/**
 * Parawan, landing page. Logika strony:
 *  1) demo z PRAWDZIWYM silnikiem `redactPII` (import z rdzenia, wtapiany do jednego pliku):
 *     anonimizacja liczona w przeglądarce, bez żadnego żądania sieciowego;
 *  2) licznik żądań do sieci w pasku u góry (#net-count), widoczny cały czas, także podczas
 *     pisania w demo; sekcja „Jak sprawdzić” odwołuje się do niego słownie;
 *  3) drobiazgi UI: wersja w metryczce pliku, przełącznik widoku, kopiowanie, hydracja ikon.
 *
 * Renderowanie znaczników i widok „Porównanie" są przeniesione z apps/web/src/main.ts,
 * żeby wynik wyglądał identycznie jak w narzędziu (spójność marki).
 */
import './style.css';
import { redactPII, type PiiFinding } from 'anonimizator';
import { hydrateIcons } from './icons';
// Znaczniki, kategorie i przykład z modułu bez DOM, który sprawdzają testy (opis w tokens.ts).
import { EXAMPLE_TEXT, MASK_TOKEN_RE, maskCategory, typeCategory } from './tokens';

const $ =<T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

/* ── Wersja strony i demo (z build define, apps/landing/package.json). Stoi tylko w metryczce
   pliku: przy przycisku pobierania obiecywałaby plik, którego przed tagiem jeszcze nie ma. ── */
const verEl = $('ver-foot');
if (verEl) verEl.textContent = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/* ── Renderowanie wyniku (znaczniki + widok „Porównanie") — przeniesione z aplikacji ── */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskHtml(name: string): string {
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

function renderAligned(original: string, redacted: string, compare: boolean): string {
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

/* ── Demo ── */
const input = $<HTMLTextAreaElement>('demo-input');
const outputEl = $('demo-output');
const statEl = $('demo-stat');
const viewResultBtn = $('view-result');
const viewCompareBtn = $('view-compare');
const copyBtn = $<HTMLButtonElement>('demo-copy');
const copyLabel = $('demo-copy-label');

let compareMode = false;
let lastRedacted = '';
let lastInput = ''; // tekst, z którego powstał lastRedacted (do „Porównania”)

/** Polska liczba mnoga: 1 → one; końcówka 2–4 poza 12–14 → few; reszta → many. */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const d = n % 10;
  const h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many;
}

function renderStats(found: PiiFinding[]): void {
  if (!statEl) return;
  const total = found.reduce((s, f) => s + f.count, 0);
  if (total === 0) {
    statEl.innerHTML = 'Nie wykryto danych osobowych w tym tekście.';
    return;
  }
  const cats = new Set(found.map((f) => typeCategory(f.type))).size;
  statEl.innerHTML =
    `Zasłonięto <b>${total}</b> ${plural(total, 'fragment', 'fragmenty', 'fragmentów')} ` +
    `w <b>${cats}</b> ${cats === 1 ? 'kategorii' : 'kategoriach'}.`;
}

function renderOutput(): void {
  if (!outputEl) return;
  if (!lastRedacted) {
    outputEl.innerHTML =
      `<span class="placeholder">Tu pojawi się wynik, np. ${maskHtml('IMIĘ I NAZWISKO')}, ` +
      `tel. ${maskHtml('TELEFON')}. Wpisz coś w polu „Tekst źródłowy” albo kliknij „Wstaw przykład”.</span>`;
    return;
  }
  outputEl.innerHTML = renderAligned(lastInput, lastRedacted, compareMode);
}

function analyze(): void {
  clearTimeout(timer);
  timer = undefined;
  if (!input) return;
  const text = input.value;
  if (!text.trim()) {
    if (lastRedacted) resetCopyLabel();
    lastRedacted = '';
    lastInput = '';
    renderOutput();
    if (statEl) statEl.textContent = 'Pole „Tekst źródłowy” jest puste.'; // ten sam napis co w index.html
    if (copyBtn) copyBtn.disabled = true;
    return;
  }
  const { redacted, found } = redactPII(text);
  // „Skopiowano ✓” dotyczyło poprzedniego wyniku
  if (redacted !== lastRedacted) resetCopyLabel();
  lastRedacted = redacted;
  lastInput = text;
  renderOutput();
  renderStats(found);
  if (copyBtn) copyBtn.disabled = false;
}

let timer: ReturnType<typeof setTimeout> | undefined;
input?.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(analyze, 120);
});

function setView(compare: boolean): void {
  compareMode = compare;
  viewResultBtn?.classList.toggle('on', !compare);
  viewResultBtn?.setAttribute('aria-pressed', String(!compare));
  viewCompareBtn?.classList.toggle('on', compare);
  viewCompareBtn?.setAttribute('aria-pressed', String(compare));
  renderOutput();
}
viewResultBtn?.addEventListener('click', () => setView(false));
viewCompareBtn?.addEventListener('click', () => setView(true));

/* Ctrl+A w wyniku zaznacza sam wynik. Domyślnie zaznaczała całą stronę razem z polem źródła,
   więc Ctrl+C po kliknięciu w wynik kopiował też oryginalne dane osobowe. Wynik ma tabindex,
   żeby klik go fokusował i klawisz trafiał tutaj. */
outputEl?.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
  e.preventDefault();
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(outputEl);
  sel.removeAllRanges();
  sel.addRange(range);
});

$('demo-example')?.addEventListener('click', () => {
  if (!input) return;
  input.value = EXAMPLE_TEXT;
  analyze();
  input.focus();
});

$('demo-clear')?.addEventListener('click', () => {
  if (!input) return;
  input.value = '';
  analyze();
  input.focus();
});

/* Kopiowanie. Stała etykieta jest podana z góry: dawniej drugie kliknięcie w ciągu 1,6 s
   zapamiętywało jako „poprzednią” etykietę już „Skopiowano ✓” i ta zostawała na stałe.
   Etykieta ma aria-live, więc czytnik ekranu odczyta też potwierdzenie i komunikat błędu. */
const COPY_LABEL = 'Kopiuj wynik';
let copyTimer: ReturnType<typeof setTimeout> | undefined;

function flashCopy(text: string, ms: number): void {
  if (!copyLabel) return;
  copyLabel.textContent = text;
  clearTimeout(copyTimer);
  copyTimer = setTimeout(resetCopyLabel, ms);
}

function resetCopyLabel(): void {
  clearTimeout(copyTimer);
  copyTimer = undefined;
  if (copyLabel) copyLabel.textContent = COPY_LABEL;
}

copyBtn?.addEventListener('click', async () => {
  if (timer !== undefined) analyze(); // tuż po wpisaniu: skopiuj wynik bieżącego tekstu
  if (!lastRedacted) return;
  try {
    await navigator.clipboard.writeText(lastRedacted);
    flashCopy('Skopiowano ✓', 1600);
  } catch {
    // Schowek bywa niedostępny (np. file:// w części przeglądarek): stara droga przez
    // ukryte pole, a gdy i ona zawiedzie, wskazówka zamiast ciszy.
    const prevFocus = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = lastRedacted;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      /* zostaje ok = false */
    }
    ta.remove();
    prevFocus?.focus({ preventScroll: true }); // select() zabrał fokus do usuniętego pola
    if (ok) flashCopy('Skopiowano ✓', 1600);
    else flashCopy('Zaznacz wynik i naciśnij Ctrl+C', 4000);
  }
});

/* ── Licznik żądań do sieci w pasku (#net-count). Liczy tylko zasoby o schemacie http(s):
   wszystko w tym pliku jest inline (data:), więc licznik powinien wynosić 0. Prowadzi go sama
   strona, dlatego „Jak sprawdzić” nazywa go podglądem i odsyła do zakładki „Sieć”. ── */
function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
function updateNetCount(): void {
  const el = $('net-count');
  if (!el) return;
  try {
    const n = performance
      .getEntriesByType('resource')
      .filter((e) => isExternal((e as PerformanceResourceTiming).name)).length;
    el.textContent = String(n);
  } catch {
    /* Resource Timing API niedostępne — zostaw 0. */
  }
}
updateNetCount();
try {
  new PerformanceObserver(updateNetCount).observe({ type: 'resource', buffered: true });
} catch {
  /* PerformanceObserver niedostępny — licznik pozostaje statyczny. */
}

/* ── Start ── */
hydrateIcons();
if (input) {
  input.value = EXAMPLE_TEXT; // pokaż demo od razu — bez wklejania własnych danych
  analyze();
}
