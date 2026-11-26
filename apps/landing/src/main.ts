/**
 * Parawan, landing page. Logika strony:
 *  1) okno z tekstem z PRAWDZIWYM silnikiem `redactPII` (import z rdzenia, wtapiany do jednego
 *     pliku): anonimizacja liczona w przeglądarce, bez żadnego żądania sieciowego;
 *  2) scena „Parawany stają tylko przy danych” i rzędy w „Skuteczności” (src/plaza.ts);
 *  3) licznik żądań do sieci w oknie i w punkcie 1 „Jak sprawdzić” (#net-count), aktualny także
 *     podczas pisania w oknie;
 *  4) drobiazgi UI: wersja w metryczce pliku, przełącznik widoku, kopiowanie, legenda kategorii,
 *     bloki zwijane na telefonie.
 *
 * Bez JavaScriptu strona pokazuje stan końcowy policzony przy buildzie (src/scena.ts). Znaczniki
 * i widok „Porównanie” (src/wynik.ts) są przeniesione z apps/web, żeby wynik wyglądał jak w pliku.
 */
import './style.css';
import { redactPII } from 'anonimizator';
import { hydrateIcons } from './icons';
import { uruchomRzedy, uruchomScene } from './plaza';
// Znaczniki, kategorie i przykład z modułu bez DOM, który sprawdzają testy (opis w tokens.ts).
import { EXAMPLE_TEXT } from './tokens';
import { licznikKategorii, maskHtml, renderAligned, statHtml } from './wynik';

const $ =<T extends HTMLElement = HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

/* ── Wersja strony i demo (z build define, apps/landing/package.json). Stoi tylko w metryczce
   pliku: przy przycisku pobierania obiecywałaby plik, którego przed tagiem jeszcze nie ma. ── */
const verEl = $('ver-foot');
if (verEl) verEl.textContent = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

// Formularz wokół pola źródła jest tylko dla autocomplete="off" (index.html). Enter w polu
// <input> dopisanym kiedyś do takiego formularza nie może go wysłać ani przeładować strony.
document.addEventListener('submit', (e) => e.preventDefault());

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

const legN = [...document.querySelectorAll<HTMLElement>('#demo-leg .leg-n')];

/** Statystyka i legenda kategorii pod oknem (ten sam napis co w HTML z buildu). */
function renderStats(found: Parameters<typeof statHtml>[0], redacted: string): void {
  if (statEl) statEl.innerHTML = statHtml(found);
  const ile = licznikKategorii(redacted);
  for (const b of legN) b.textContent = String(ile[b.dataset.k ?? ''] ?? 0);
}

function renderOutput(): void {
  if (!outputEl) return;
  if (!lastRedacted) {
    outputEl.innerHTML =
      `<span class="placeholder">Tu pojawi się wynik, np. ${maskHtml('IMIĘ I NAZWISKO')}, ` +
      `tel. ${maskHtml('TELEFON')}. Wystarczy wpisać tekst w polu „Tekst źródłowy” albo użyć przycisku „Wstaw przykład”.</span>`;
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
    if (statEl) statEl.textContent = 'Pole „Tekst źródłowy” jest puste.';
    for (const b of legN) b.textContent = '0';
    if (copyBtn) copyBtn.disabled = true;
    return;
  }
  const { redacted, found } = redactPII(text);
  // „Skopiowano ✓” dotyczyło poprzedniego wyniku
  if (redacted !== lastRedacted) resetCopyLabel();
  lastRedacted = redacted;
  lastInput = text;
  renderOutput();
  renderStats(found, redacted);
  if (copyBtn) copyBtn.disabled = false;
}

let timer: ReturnType<typeof setTimeout> | undefined;
input?.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(analyze, 120);
  rosnij();
});

/* Na telefonie pole źródła rośnie z treścią zamiast przewijać się w środku przewijanej strony. */
const waskiePole = matchMedia('(max-width: 700px)');
function rosnij(): void {
  if (!input) return;
  if (!waskiePole.matches) {
    input.style.height = '';
    return;
  }
  input.style.height = 'auto';
  input.style.height = `${input.scrollHeight + 4}px`;
}
waskiePole.addEventListener?.('change', rosnij);
addEventListener('resize', rosnij);

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
  rosnij();
  input.focus();
});

$('demo-clear')?.addEventListener('click', () => {
  if (!input) return;
  input.value = '';
  analyze();
  rosnij();
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
    else flashCopy('Wynik da się zaznaczyć i skopiować skrótem Ctrl+C', 4000);
  }
});

/* ── Licznik żądań do sieci w oknie i w „Jak sprawdzić” (.net-n). Liczy tylko zasoby o schemacie http(s):
   wszystko w tym pliku jest inline (data:), więc licznik powinien wynosić 0. Prowadzi go sama
   strona, dlatego „Jak sprawdzić” nazywa go podglądem i odsyła do zakładki „Sieć”. ── */
function isExternal(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
function updateNetCount(): void {
  const els = document.querySelectorAll('.net-n');
  if (!els.length) return;
  try {
    const n = performance
      .getEntriesByType('resource')
      .filter((e) => isExternal((e as PerformanceResourceTiming).name)).length;
    for (const el of els) el.textContent = String(n);
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

/* ── Długie bloki (sposoby rozpoznawania, punkty dla IT, przypadki poza pomiarem) na telefonie
   startują zwinięte. Bez JavaScriptu zostają rozwinięte. ── */
const waski = matchMedia('(max-width: 700px)');
function zwin(): void {
  for (const d of document.querySelectorAll<HTMLDetailsElement>('details.zwin')) d.open = !waski.matches;
}
zwin();
waski.addEventListener?.('change', zwin);
// link do sekcji wewnątrz zwiniętego bloku (np. #sprawdz z „Dla IOD i IT”) najpierw go rozwija
addEventListener('hashchange', () => {
  const cel = location.hash && document.getElementById(location.hash.slice(1));
  const det = cel ? cel.closest('details') : null;
  if (det) det.open = true;
});

/* ── Start ── */
hydrateIcons();
uruchomScene();
uruchomRzedy();
if (input) {
  input.value = EXAMPLE_TEXT; // przykład od razu, bez wklejania własnych danych (ten sam stan wpisał już build)
  analyze();
  rosnij();
  document.fonts?.ready.then(rosnij);
}
