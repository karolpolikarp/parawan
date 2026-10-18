import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { escapeHtml, renderAligned } from './compare';
import { extractDocxText } from './docx';
import { type DocxInventory, docxEmptyBodyError, docxInventoryNote, inventoryDocx } from './docx-inventory';
import {
  decodeText,
  FileReadError,
  fileExt,
  looksLikePdf,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  unsupportedFormat,
} from './files';
import { makeFlash } from './flash';
import { downloadFor, finalText, printTitle } from './output';
import { extractPdfText } from './pdf';
import { buildMinimalPdf } from './pdf-fixture';
import {
  CAT_LABELS,
  type Cat,
  CHIP_META,
  catCountLabel,
  MASK_GROUPS,
  type MaskGroup,
  maskCategory,
  maskTip,
  PII_TOKENS,
  tokenOfCode,
  WYKRYWA_ROWS,
} from './pii-meta';
import { plural } from './plural';
import { storageGet, storageSet } from './storage';
import './style.css';
import { initTips, tipDescId } from './tips';

// Ikony — inline SVG (jedno źródło prawdy, kolor z currentColor). Zero rastrów.
import { icon, hydrateIcons } from './icons';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const input = $<HTMLTextAreaElement>('input');
const output = $<HTMLDivElement>('output');
const findingsCard = $<HTMLElement>('findings');
const findingsChips = $<HTMLSpanElement>('findings-chips');
const findingsStatus = $<HTMLSpanElement>('findings-status');
const statCount = $<HTMLElement>('stat-count');
const statCountW = $<HTMLElement>('stat-count-w');
const statCats = $<HTMLElement>('stat-cats');
const statCatsW = $<HTMLElement>('stat-cats-w');
const srcMeta = $<HTMLSpanElement>('src-meta');
const copyBtn = $<HTMLButtonElement>('copy');
const copyLabel = $<HTMLSpanElement>('copy-label');
const downloadBtn = $<HTMLButtonElement>('download');
const downloadLabel = $<HTMLSpanElement>('download-label');
const printBtn = $<HTMLButtonElement>('print');
const printOut = $<HTMLDivElement>('print-out');
const clearBtn = $<HTMLButtonElement>('clear');
const exampleBtn = $<HTMLButtonElement>('example');
const loadFileBtn = $<HTMLButtonElement>('load-file');
const loadFileLabel = $<HTMLSpanElement>('load-file-label');
const fileInput = $<HTMLInputElement>('file-input');
const viewResultBtn = $<HTMLButtonElement>('view-result');
const viewCompareBtn = $<HTMLButtonElement>('view-compare');
const appError = $<HTMLParagraphElement>('app-error');
const appNote = $<HTMLDivElement>('app-note');
const appNoteText = $<HTMLSpanElement>('app-note-text');
const appNoteUndo = $<HTMLButtonElement>('app-note-undo');
const appNoteClose = $<HTMLButtonElement>('app-note-close');
const appNoteStatus = $<HTMLSpanElement>('app-note-status');
const maskNav = $<HTMLSpanElement>('mask-nav');
const maskPrev = $<HTMLButtonElement>('mask-prev');
const maskNext = $<HTMLButtonElement>('mask-next');
const maskCount = $<HTMLSpanElement>('mask-count');
const maskStatus = $<HTMLSpanElement>('mask-status');
const srStatus = $<HTMLParagraphElement>('sr-status');
const outputHint = $<HTMLParagraphElement>('output-hint');

let lastRedacted = '';
let lastInput = '';
// Rozszerzenie ostatnio wczytanego pliku (bez nazwy): po .csv „Pobierz” oddaje .csv.
let lastFileExt = '';
let viewMode: 'result' | 'compare' = 'result';
let maskEls: HTMLElement[] = []; // znaczniki w wyniku, w kolejności dokumentu
let maskIdx = -1; // bieżący znacznik w przeglądaniu (-1 = żaden)
let maskTabStop: HTMLElement | null = null; // jedyny znacznik w kolejności Tab (roving tabindex)

/* ── Legenda, tabela „Co wykrywa” i przełączniki „Co maskować” (dane w pii-meta.ts) ── */

// Liczby typów w legendzie liczymy z przełączników (w index.html stoją te same jako zapas).
document.querySelectorAll<HTMLElement>('.legend .lg[data-cat]').forEach((el) => {
  const out = el.querySelector('.lg-n');
  if (out) out.textContent = catCountLabel(el.dataset.cat as Cat);
});

const maskTogglesEl = $<HTMLSpanElement>('mask-toggles');
// Klucze spoza bieżącej listy (np. z dawnej wersji) pomijamy, inaczej zawyżałyby liczniki.
const disabledGroups = new Set<string>(
  (storageGet('mask-disabled') ?? '').split(',').filter((k) => MASK_GROUPS.some((g) => g.key === k)),
);

const wykrywaBody = document.getElementById('wykrywa-body');
if (wykrywaBody) {
  const groupByCode = new Map(MASK_GROUPS.map((g) => [g.code, g]));
  wykrywaBody.innerHTML = WYKRYWA_ROWS.map(({ code, how }) => {
    const meta = PII_TOKENS[tokenOfCode(code)];
    const name = groupByCode.get(code)?.label ?? tokenOfCode(code);
    return (
      `<tr><td><span class="td-name"><span class="ic ic-s c-${meta.cat}">` +
      `<i class="gi">${icon(meta.icon)}</i></span>${escapeHtml(name)}</span></td>` +
      `<td><span class="catpill cp-${meta.cat}">${CAT_LABELS[meta.cat].toLowerCase()}</span></td>` +
      `<td><span class="how">${how}</span></td>` +
      `<td><mark class="pii pii-${meta.cat}">${escapeHtml(code)}</mark></td></tr>`
    );
  }).join('');
}

function persistDisabled(): void {
  storageSet('mask-disabled', [...disabledGroups].join(','));
}

/** Zwarty wiersz jednego typu PII (ikona + nazwa + kod + przełącznik). */
function buildRow(g: MaskGroup): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'tgr';
  label.dataset.tip = g.tip;

  const ic = document.createElement('span');
  ic.className = `ic ic-s c-${g.cat}`;
  const gi = document.createElement('i');
  gi.className = 'gi';
  gi.innerHTML = icon(g.icon);
  ic.append(gi);

  const t = document.createElement('span');
  t.className = 'tg-t';
  const b = document.createElement('b');
  b.textContent = g.label;
  const code = document.createElement('code');
  code.textContent = g.code;
  t.append(b, code);

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'sw';
  box.dataset.key = g.key;
  box.checked = !disabledGroups.has(g.key);
  box.setAttribute('aria-label', `Maskuj: ${g.label}`);
  box.addEventListener('change', () => {
    if (box.checked) disabledGroups.delete(g.key);
    else disabledGroups.add(g.key);
    persistDisabled();
    updateMaskTotal();
    updateNow();
  });

  label.append(ic, t, box);
  return label;
}

/** Wiersz-tryb „Rozróżniaj osoby” (nie typ danych) — mieszka w grupie „Osoby”. */
function buildModeRow(): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'tgr mode';
  label.dataset.tip = 'Ta sama osoba dostaje ten sam znacznik w całym dokumencie, przydatne w umowach i pismach';

  const ic = document.createElement('span');
  ic.className = 'ic ic-s c-person';
  const gi = document.createElement('i');
  gi.className = 'gi';
  gi.innerHTML = icon('losowanie');
  ic.append(gi);

  const t = document.createElement('span');
  t.className = 'tg-t';
  const b = document.createElement('b');
  b.innerHTML = 'Rozróżniaj osoby<span class="mode-tag">tryb</span>';
  const code = document.createElement('code');
  code.textContent = '[OSOBA-A], [OSOBA-B]…';
  t.append(b, code);

  const box = document.createElement('input');
  box.type = 'checkbox';
  box.className = 'sw';
  box.id = 'pseudonyms';
  box.setAttribute('aria-label', 'Rozróżniaj osoby');

  label.append(ic, t, box);
  return label;
}

const group = (key: string): MaskGroup => MASK_GROUPS.find((g) => g.key === key)!;

function catHeader(cat: Cat): HTMLElement {
  const h = document.createElement('div');
  h.className = 'mg-h';
  const dot = document.createElement('span');
  dot.className = `dot dot-${cat}`;
  const hl = document.createElement('span');
  hl.textContent = CAT_LABELS[cat];
  h.append(dot, hl);
  return h;
}

/** Nagłówek nad konkretną kolumną siatki (klasa steruje pozycją — reset przez media-query). */
function colHeader(cat: Cat, cls: string): HTMLElement {
  const h = catHeader(cat);
  h.classList.add(cls);
  return h;
}

/** Komórka na jawnej pozycji siatki — zgrywa Kontakt+Finanse w jednej linii, kolumnowo z resztą. */
function cellAt(g: MaskGroup, cls: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = cls;
  cell.append(buildRow(g));
  return cell;
}

function band(...kids: HTMLElement[]): HTMLElement {
  const d = document.createElement('div');
  d.className = 'mg-band';
  d.append(...kids);
  return d;
}

// Pasy: Identyfikatory (szeroko) · Kontakt+Finanse (jedna linia, kolumny zgrane) ·
// Adres (szeroko) · Osoby (szeroko + tryb „Rozróżniaj osoby”).
maskTogglesEl.append(
  band(catHeader('ident'), ...MASK_GROUPS.filter((g) => g.cat === 'ident').map(buildRow)),
  band(
    colHeader('contact', 'kf-h-contact'),
    cellAt(group('email'), 'kf-c1'),
    cellAt(group('telefon'), 'kf-c2'),
    colHeader('fin', 'kf-h-fin'),
    cellAt(group('konto'), 'kf-c3'),
    cellAt(group('karta'), 'kf-c4'),
  ),
  band(catHeader('place'), ...MASK_GROUPS.filter((g) => g.cat === 'place').map(buildRow)),
  band(catHeader('person'), ...MASK_GROUPS.filter((g) => g.cat === 'person').map(buildRow), buildModeRow()),
);

/* ── Akcje zbiorcze „Co maskować” + licznik ── */
const maskCountOn = $<HTMLElement>('mask-count-on');
const maskOffNote = $<HTMLElement>('mask-off-note');
const maskOffText = $<HTMLElement>('mask-off-text');
const maskOffReset = $<HTMLButtonElement>('mask-off-reset');

/** Nazwa typu w środku zdania: „Telefon” → „telefon”, ale skrót zostaje („PESEL”, „IBAN / nr konta”). */
function inSentence(label: string): string {
  const first = label.split(/[\s/]/)[0];
  return first.length > 1 && first === first.toUpperCase()
    ? label
    : label[0].toLowerCase() + label.slice(1);
}

/**
 * Ostrzeżenie o wyłączonych typach. Wybór „Co maskować” jest zapamiętywany, więc wyłączony
 * PESEL przechodzi jawny także jutro i w każdej kopii pliku; dlatego ostrzeżenie stoi stale przy
 * wyniku, a nie tylko w sekcji przełączników. Pusty napis, gdy maskujemy wszystko.
 */
function maskOffSummary(): string {
  const off = MASK_GROUPS.filter((g) => disabledGroups.has(g.key));
  if (off.length === 0) return '';
  if (off.length === MASK_GROUPS.length) {
    return 'Maskowanie jest wyłączone dla wszystkich typów, więc wynik nie ukrywa żadnych danych.';
  }
  const what =
    off.length > 5
      ? `Nie maskuję ${off.length} ${plural(off.length, 'typu', 'typów', 'typów')} danych.`
      : `Nie maskuję: ${off.map((g) => inSentence(g.label)).join(', ')}.`;
  return `${what} Te dane zostaną w wyniku bez zmian.`;
}

function updateMaskTotal(): void {
  maskCountOn.textContent = String(MASK_GROUPS.length - disabledGroups.size);
  const note = maskOffSummary();
  maskOffText.textContent = note;
  maskOffNote.hidden = !note;
}
function syncSwitches(): void {
  maskTogglesEl.querySelectorAll<HTMLInputElement>('.sw[data-key]').forEach((sw) => {
    sw.checked = !disabledGroups.has(sw.dataset.key ?? '');
  });
}
function bulkMask(mode: 'on' | 'off' | 'invert'): void {
  for (const g of MASK_GROUPS) {
    if (mode === 'on') disabledGroups.delete(g.key);
    else if (mode === 'off') disabledGroups.add(g.key);
    else if (disabledGroups.has(g.key)) disabledGroups.delete(g.key);
    else disabledGroups.add(g.key);
  }
  persistDisabled();
  syncSwitches();
  updateMaskTotal();
  updateNow();
}
$<HTMLButtonElement>('mask-all-on').addEventListener('click', () => bulkMask('on'));
$<HTMLButtonElement>('mask-all-off').addEventListener('click', () => bulkMask('off'));
$<HTMLButtonElement>('mask-invert').addEventListener('click', () => bulkMask('invert'));
maskOffReset.addEventListener('click', () => {
  // Przycisk znika razem z ostrzeżeniem, więc fokus z klawiatury przenosimy na wynik.
  const hadFocus = document.activeElement === maskOffReset;
  bulkMask('on');
  announce('Włączono maskowanie wszystkich typów.');
  if (hadFocus) output.focus({ preventScroll: true });
});
$('mask-count-total').textContent = String(MASK_GROUPS.length);
updateMaskTotal();

/** Typy aktywne wg przełączników; undefined = wszystkie. */
function activeTypes(): PiiType[] | undefined {
  if (disabledGroups.size === 0) return undefined;
  return MASK_GROUPS.filter((g) => !disabledGroups.has(g.key)).flatMap((g) => g.types);
}

const pseudonymsBox = $<HTMLInputElement>('pseudonyms');
pseudonymsBox.checked = storageGet('pseudonyms') === '1';
pseudonymsBox.addEventListener('change', () => {
  storageSet('pseudonyms', pseudonymsBox.checked ? '1' : '');
  updateNow();
});

/* ── Renderowanie wyniku (numerowane linie, kolorowe znaczniki, tooltips) ── */

// Rozpoznaje znaczniki [TOKEN] do podświetlenia/nawigacji w wyniku. Lista tokenów pochodzi
// z PII_TOKENS (+ dynamiczne OSOBA-A/B…). Żaden token nie zawiera metaznaków regexu, a każdy
// jest zakotwiczony nawiasami [...], więc wstawiamy je wprost i kolejność alternatyw nie ma znaczenia.
const MASK_TOKEN_RE = new RegExp(
  `\\[(${[...Object.keys(PII_TOKENS), 'OSOBA-[A-Z]+'].join('|')})\\]`,
  'g',
);

// tabindex="-1": znaczniki nie są osobnymi przystankami Tab (przy długim piśmie były ich setki).
// Do kolejności Tab wchodzi tylko bieżący znacznik (roving tabindex: refreshMaskNav, goToMask).
function maskHtml(name: string): string {
  return `<mark class="pii pii-${maskCategory(name)}" data-tip="${escapeHtml(maskTip(name))}" tabindex="-1">[${name}]</mark>`;
}

/** Owiń HTML w numerowane linie edytora (.cl / .no). */
function wrapLines(html: string): string {
  return html
    .split('\n')
    .map(
      (line, i) =>
        `<div class="cl"><span class="no" aria-hidden="true">${i + 1}</span><span>${line || '&nbsp;'}</span></div>`,
    )
    .join('');
}

// Powyżej tego progu wynik jest zwykłym tekstem: bez podświetleń, nawigacji i „Porównania”
// (dziesiątki tysięcy znaczników z dymkami zamroziłyby kartę na wiele sekund).
const HIGHLIGHT_LIMIT = 300_000;
const isTooBig = (): boolean => lastRedacted.length > HIGHLIGHT_LIMIT;

// Znaczniki, które stały już w tekście źródłowym (np. wklejono wynik wcześniejszej anonimizacji).
let keptMasks = 0;

const OUTPUT_HINT = outputHint.textContent ?? '';

/** Podpowiedź pod nagłówkiem wyniku; przy długim tekście wyjaśnia, czemu nie ma podświetleń. */
function syncOutputHint(): void {
  const n = lastRedacted.length;
  outputHint.textContent = isTooBig()
    ? `długi tekst (${n.toLocaleString('pl-PL')} ${plural(n, 'znak', 'znaki', 'znaków')}): ` +
      'wynik jest kompletny, ale bez podświetleń i porównania'
    : OUTPUT_HINT;
}

function syncViewButtons(): void {
  viewResultBtn.classList.toggle('on', viewMode === 'result');
  viewCompareBtn.classList.toggle('on', viewMode === 'compare');
  viewResultBtn.setAttribute('aria-pressed', String(viewMode === 'result'));
  viewCompareBtn.setAttribute('aria-pressed', String(viewMode === 'compare'));
}

function renderOutput(): void {
  if (!lastRedacted) return;
  const tooBig = isTooBig();
  viewCompareBtn.disabled = tooBig;
  if (tooBig && viewMode === 'compare') {
    viewMode = 'result';
    syncViewButtons();
  }
  syncOutputHint();
  output.classList.toggle('plain', tooBig);
  if (tooBig) {
    keptMasks = 0;
    output.textContent = lastRedacted;
  } else {
    // „Wynik” też idzie przez wyrównanie z oryginałem: dzięki temu znaczniki, które były już
    // w tekście, nie są liczone ani podświetlane jako nowe wykrycia.
    const { html, kept } = renderAligned(lastInput, lastRedacted, {
      tokenRe: MASK_TOKEN_RE,
      maskHtml,
      compare: viewMode === 'compare',
    });
    keptMasks = kept;
    output.innerHTML = wrapLines(html);
  }
  refreshMaskNav();
}

function setViewMode(mode: 'result' | 'compare'): void {
  if (mode === 'compare' && isTooBig()) mode = 'result';
  const changed = mode !== viewMode;
  viewMode = mode;
  syncViewButtons();
  // Długi tekst wygląda tak samo w obu widokach, a ponowny render kosztowałby 1–1,5 s.
  if (!changed || isTooBig()) return;
  // Zachowaj pozycję: bieżący znacznik albo (bez przeglądania) proporcjonalne przewinięcie.
  const prevIdx = maskIdx;
  const prevN = maskEls.length;
  const prevMax = output.scrollHeight - output.clientHeight;
  const ratio = prevMax > 0 ? output.scrollTop / prevMax : 0;
  renderOutput();
  if (prevIdx >= 0 && maskEls.length === prevN) goToMask(prevIdx);
  else output.scrollTop = ratio * (output.scrollHeight - output.clientHeight);
}

viewResultBtn.addEventListener('click', () => setViewMode('result'));
viewCompareBtn.addEventListener('click', () => setViewMode('compare'));

/* ── Przeglądanie zamaskowanych fragmentów — strzałki, klik, klawiatura ── */

/** Etykieta pseudonimu ([OSOBA-A]) — pozwala podświetlić WSZYSTKIE wystąpienia tej samej osoby. */
function personLabel(el: HTMLElement): string | null {
  return /^\[OSOBA-[A-Z]+\]$/.test(el.textContent ?? '') ? el.textContent : null;
}

function updateMaskCount(): void {
  const n = maskEls.length;
  maskCount.textContent = n ? `${maskIdx + 1} / ${n}` : '0 / 0';
  maskPrev.disabled = n === 0;
  maskNext.disabled = n === 0;
}

function goToMask(i: number, scroll = true): void {
  const n = maskEls.length;
  if (!n) return;
  maskIdx = ((i % n) + n) % n; // zawijanie na końcach
  for (const el of maskEls) el.classList.remove('pii-active', 'pii-linked');
  const el = maskEls[maskIdx];
  setMaskTabStop(el); // bieżący znacznik jest jedynym przystankiem Tab w wyniku
  el.classList.add('pii-active');
  const label = personLabel(el); // ta sama osoba → podświetl powiązane wystąpienia
  if (label) for (const o of maskEls) if (o !== el && o.textContent === label) o.classList.add('pii-linked');
  if (scroll) {
    const er = el.getBoundingClientRect();
    const or = output.getBoundingClientRect();
    output.scrollTop += er.top - or.top - (output.clientHeight - er.height) / 2;
  }
  // Fokus idzie za bieżącym znacznikiem tylko wtedy, gdy już stał na znaczniku (strzałki na
  // znaczniku). Z ‹ › ani z pola wyniku go nie przenosimy, inaczej dymek z powodem wyskakiwałby
  // przy każdym przejściu. Bieżący znacznik wskazuje pierścień.
  const ae = document.activeElement;
  if (ae !== el && ae instanceof HTMLElement && ae.matches('mark.pii') && output.contains(ae)) {
    el.focus({ preventScroll: true });
  }
  // Komunikat dla czytnika ekranu (aria-live) z powodem wykrycia. Na dotyku, gdzie dymek
  // znacznika zasłaniał wynik, ta sama linia jest widoczna pod wynikiem (style.css).
  maskStatus.textContent = `Fragment ${maskIdx + 1} z ${n}: ${el.textContent} · ${el.dataset.tip ?? ''}`;
  updateMaskCount();
}

/** Przenieś jedyny przystanek Tab w wyniku na znacznik `el` (roving tabindex). */
function setMaskTabStop(el: HTMLElement | null): void {
  if (maskTabStop && maskTabStop !== el) maskTabStop.tabIndex = -1;
  maskTabStop = el;
  if (el) el.tabIndex = 0;
}

/** Po każdym renderze wyniku: zbierz znaczniki, wyzeruj przegląd, pokaż/ukryj nawigację. */
function refreshMaskNav(): void {
  maskEls = [...output.querySelectorAll<HTMLElement>('mark.pii')];
  maskIdx = -1;
  maskTabStop = null; // poprzedni wynik zniknął z DOM razem ze swoim znacznikiem
  setMaskTabStop(maskEls[0] ?? null); // Tab wchodzi do wyniku na pierwszym znaczniku
  maskStatus.textContent = ''; // stary „Fragment N z M” nie dotyczy nowego wyniku
  maskNav.hidden = maskEls.length === 0;
  updateMaskCount();
}

const goToPrevMask = (): void => goToMask(maskIdx <= 0 ? maskEls.length - 1 : maskIdx - 1);

maskPrev.addEventListener('click', goToPrevMask);
maskNext.addEventListener('click', () => goToMask(maskIdx + 1));

// Klik w znacznik → uczyń go bieżącym (bez przewijania — użytkownik już na niego patrzy).
output.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.('mark.pii') as HTMLElement | null;
  const at = el ? maskEls.indexOf(el) : -1;
  if (at !== -1) goToMask(at, false);
});

// Fokus z klawiatury (Tab na przystanek w wyniku) też ustawia bieżący znacznik. Bez tego licznik
// pokazywał „0 / N”, a pierwsza strzałka ↓ zostawała na tym samym znaczniku.
output.addEventListener('focusin', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.('mark.pii') as HTMLElement | null;
  const at = el ? maskEls.indexOf(el) : -1;
  if (at !== -1 && at !== maskIdx) goToMask(at, false);
});

// Ctrl+A w wyniku zaznacza sam wynik. Domyślnie zaznaczała całą stronę razem z polem źródła,
// więc Ctrl+C po kliknięciu w wynik kopiował też oryginalne dane osobowe.
output.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'a') return;
  e.preventDefault();
  const sel = getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(output);
  sel.removeAllRanges();
  sel.addRange(range);
});

// Klawiatura: ↓/→ następny, ↑/← poprzedni — gdy fokus jest w wyniku LUB na strzałkach nawigacji
// (dzięki temu po kliknięciu ‹/› strzałki nadal działają, mimo że nie fokusujemy znacznika).
document.addEventListener('keydown', (e) => {
  if (!maskEls.length || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  const ae = document.activeElement;
  if (ae !== output && !output.contains(ae) && !maskNav.contains(ae)) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); goToMask(maskIdx + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); goToPrevMask(); }
});

// Synchroniczne przewijanie źródła i wyniku — przewijasz jedno, drugie podąża (jak w recenzji
// dokumentu). Proporcjonalnie (treści mają różną długość), z blokadą pętli sprzężenia zwrotnego.
let syncingScroll = false;
function linkScroll(from: HTMLElement, to: HTMLElement): void {
  from.addEventListener('scroll', () => {
    if (syncingScroll) return;
    syncingScroll = true;
    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    to.scrollTop = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
    requestAnimationFrame(() => {
      syncingScroll = false;
    });
  });
}
linkScroll(input, output);
linkScroll(output, input);

// Rozszerzanie okien — czytelny, symetryczny uchwyt u dołu KAŻDEGO okna (źródła i wyniku).
// Przeciąganie dowolnego z nich zmienia wspólną wysokość --ed-h, więc oba okna rosną i maleją
// równocześnie i równo. Uchwyt jest widoczny, obsługiwany myszą, dotykiem i klawiaturą (↑/↓),
// a dwuklik przywraca domyślną wysokość. Intuicyjniej niż drobny natywny trójkącik w rogu.
const MIN_ED_H = 220;
const grips: HTMLElement[] = [];

const maxEdH = (): number => Math.max(MIN_ED_H, window.innerHeight - 140);
const clampEdH = (px: number): number => Math.max(MIN_ED_H, Math.min(Math.round(px), maxEdH()));

/** Wartość separatora dla czytnika ekranu: bieżąca wysokość i zakres. Bez aria-valuemax
    domyślne maksimum to 100, mniej niż wartość, więc czytnik podawał błędny procent. */
function syncGripAria(h: number = input.offsetHeight): void {
  const max = String(Math.max(maxEdH(), h));
  const text = `${h} ${plural(h, 'piksel', 'piksele', 'pikseli')}`;
  for (const g of grips) {
    g.setAttribute('aria-valuemax', max);
    g.setAttribute('aria-valuenow', String(h));
    g.setAttribute('aria-valuetext', text);
  }
}
function applyEditorHeight(px: number): void {
  const h = clampEdH(px);
  document.documentElement.style.setProperty('--ed-h', `${h}px`);
  syncGripAria(h);
}
function resetEditorHeight(): void {
  document.documentElement.style.removeProperty('--ed-h');
  syncGripAria();
}

function makeGrip(): HTMLElement {
  const g = document.createElement('div');
  g.className = 'ed-grip';
  g.tabIndex = 0;
  g.setAttribute('role', 'separator');
  g.setAttribute('aria-orientation', 'horizontal');
  g.setAttribute('aria-label', 'Zmień wysokość okien: przeciągnij lub użyj strzałek ↑ ↓');
  g.setAttribute('aria-valuemin', String(MIN_ED_H));
  g.dataset.tip = 'Przeciągnij, aby zmienić wysokość obu okien · strzałki ↑ ↓ · dwuklik = reset';
  g.innerHTML = '<span class="ed-grip-bar"></span>';

  let startY = 0;
  let startH = 0;
  let dragging = false;
  g.addEventListener('pointerdown', (e) => {
    dragging = true;
    startY = e.clientY;
    startH = input.offsetHeight;
    g.setPointerCapture(e.pointerId);
    document.body.classList.add('ed-resizing');
    e.preventDefault();
  });
  g.addEventListener('pointermove', (e) => {
    if (dragging) applyEditorHeight(startH + (e.clientY - startY));
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try {
      g.releasePointerCapture(e.pointerId);
    } catch {
      /* wskaźnik mógł już zniknąć */
    }
    document.body.classList.remove('ed-resizing');
  };
  g.addEventListener('pointerup', endDrag);
  g.addEventListener('pointercancel', endDrag);
  g.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowUp') {
      applyEditorHeight(input.offsetHeight - step);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      applyEditorHeight(input.offsetHeight + step);
      e.preventDefault();
    }
  });
  g.addEventListener('dblclick', resetEditorHeight);
  return g;
}

const inputGrip = makeGrip();
const outputGrip = makeGrip();
grips.push(inputGrip, outputGrip);
input.closest('.card-b')?.append(inputGrip); // .card-b okna źródła (pole stoi w <form>)
output.parentElement?.append(outputGrip); // .card-b okna wyniku
// Oba uchwyty sterują tą samą wysokością, więc z klawiatury wystarczy jeden przystanek Tab.
// Drugi zostaje dla myszy i dotyku.
outputGrip.tabIndex = -1;
syncGripAria();
window.addEventListener('resize', () => syncGripAria());

/* ── Pasek „Zamaskowano” (chipy z ikonami, licznik, kategorie) ── */

// Etykieta, kategoria i ikona chipa: CHIP_META (pii-meta.ts), wpis dla każdego typu rdzenia.

const CHIP_NAV_TIP = 'Przejdź do kolejnego fragmentu tego typu w wyniku';

function renderFindings(found: PiiFinding[]): void {
  findingsCard.hidden = false;
  // koercja licznika do liczby — obrona przed nie-liczbowym count (XSS/NaN)
  const total = found.reduce((s, f) => s + (Number(f.count) || 0), 0);
  const byLabel = new Map<string, { count: number; cat: Cat; icon: string; token: string }>();
  for (const f of found) {
    // zapas na czas działania (typ spoza CHIP_META mimo typecheck): chip z surowym kodem
    const meta = CHIP_META[f.type] ?? {
      label: String(f.type),
      token: String(f.type),
      cat: 'ident' as Cat,
      icon: 'dane-id',
    };
    const prev = byLabel.get(meta.label);
    byLabel.set(meta.label, {
      count: (prev?.count ?? 0) + (Number(f.count) || 0),
      cat: meta.cat,
      icon: meta.icon,
      token: meta.token,
    });
  }
  const cats = new Set([...byLabel.values()].map((v) => v.cat)).size;
  statCount.textContent = String(total);
  statCountW.textContent = plural(total, 'wykrycie', 'wykrycia', 'wykryć');
  statCats.textContent = String(cats);
  statCatsW.textContent = plural(cats, 'kategoria', 'kategorie', 'kategorii');
  const off = maskOffSummary();
  const keptChip = keptMasks
    ? ` <span class="chip chip-hint">w tekście były już znaczniki <span class="x">×${keptMasks}</span></span>`
    : '';

  if (found.length === 0) {
    const allOff = disabledGroups.size === MASK_GROUPS.length;
    const clean = allOff
      ? '<span class="chip chip-hint">nic nie zamaskowano: maskowanie wszystkich typów jest wyłączone w „Co maskować”</span>'
      : disabledGroups.size > 0
        ? '<span class="chip chip-hint">nic nie zamaskowano, część typów jest wyłączona w „Co maskować”</span>'
        : `<span class="chip chip-ok">nie wykryto ${keptMasks ? 'nowych ' : ''}danych osobowych</span>`;
    findingsChips.innerHTML = clean + keptChip;
    findingsStatus.textContent = off ? `Nic nie zamaskowano. ${off}` : 'Nie wykryto danych osobowych.';
    return;
  }
  // zwięzły komunikat dla czytnika ekranu (jeden, po debounce — nie zalewa)
  findingsStatus.textContent =
    `Zamaskowano ${total} ${plural(total, 'fragment', 'fragmenty', 'fragmentów')} ` +
    `w ${cats} ${cats === 1 ? 'kategorii' : 'kategoriach'}.` +
    (off ? ` ${off}` : '');
  // Długi tekst nie ma znaczników w wyniku (zwykły tekst), więc chipy są wtedy tylko licznikami.
  const nav = !isTooBig();
  findingsChips.innerHTML =
    [...byLabel.entries()]
      .map(([label, v]) => {
        const body = `<i class="gi">${icon(v.icon)}</i>${escapeHtml(label)} <span class="x">×${v.count}</span>`;
        return nav
          ? `<button type="button" class="chip chip-nav ch-${v.cat}" data-token="${escapeHtml(v.token)}" ` +
              `data-tip="${CHIP_NAV_TIP}" aria-describedby="${tipDescId(CHIP_NAV_TIP)}">${body}</button>`
          : `<span class="chip ch-${v.cat}">${body}</span>`;
      })
      .join(' ') + keptChip;
}

/** Przewiń stronę do wyniku, jeśli jest poza ekranem (np. chip kliknięty na telefonie, pod wynikiem). */
function revealOutput(): void {
  const r = output.getBoundingClientRect();
  const visibleH = window.visualViewport?.height ?? window.innerHeight;
  if (r.top >= 0 && r.bottom <= visibleH) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  output.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

// Klik w chip „Zamaskowano” → skok do kolejnego znacznika TEGO typu w wyniku (cyklicznie).
// Dopasowanie po tokenie, nie po kategorii: „PESEL” nie może prowadzić do [NIP].
findingsChips.addEventListener('click', (e) => {
  const chip = (e.target as HTMLElement | null)?.closest?.('button.chip-nav') as HTMLElement | null;
  const token = chip?.dataset.token;
  if (!token || !maskEls.length) return;
  const want = `[${token}]`;
  // W trybie „Rozróżniaj osoby” imię i nazwisko ma w wyniku etykiety [OSOBA-A], [OSOBA-B]…
  const isPerson = token === 'IMIĘ I NAZWISKO';
  const match = (el: HTMLElement): boolean =>
    el.textContent === want || (isPerson && personLabel(el) !== null);
  const n = maskEls.length;
  for (let step = 1; step <= n; step++) {
    const j = (maskIdx + step) % n; // maskIdx ≥ -1, więc indeks nie bywa ujemny
    if (match(maskEls[j])) {
      revealOutput();
      goToMask(j);
      return;
    }
  }
});

/* ── Główny przepływ ── */

function setResultActions(on: boolean): void {
  copyBtn.disabled = !on;
  downloadBtn.disabled = !on;
  printBtn.disabled = !on;
}

/** Tekst dla „Kopiuj”, „Pobierz” i wydruku; jedno źródło, patrz output.ts. */
const outputText = (): string => finalText({ redacted: lastRedacted });

const PRINT_EMPTY = 'Brak wyniku do wydruku. Wklej tekst w pole „Tekst źródłowy”.';

/**
 * Kontener wydruku (#print-out) dostaje cały wynik przy każdym przeliczeniu, niezależnie od
 * widoku i od HIGHLIGHT_LIMIT. Tylko textContent: tekst wyniku pochodzi od użytkownika, a pole
 * źródła i przekreślone oryginały (.orig) nie mogą tu trafić żadną drogą.
 */
function syncPrintOut(): void {
  printOut.textContent = lastRedacted ? outputText() : PRINT_EMPTY;
}

function setFileExt(ext: string): void {
  lastFileExt = ext;
  downloadLabel.textContent = ext === 'csv' ? 'Pobierz .csv' : 'Pobierz .txt';
}

function updateSrcMeta(text: string): void {
  // Dopisek o upuszczaniu pliku stoi obok, w osobnym .hint-desk (na telefonie znika).
  const lines = text ? text.split('\n').length : 0;
  const chars = text.length;
  srcMeta.textContent =
    `${lines.toLocaleString('pl-PL')} ${plural(lines, 'wiersz', 'wiersze', 'wierszy')} · ` +
    `${chars.toLocaleString('pl-PL')} ${plural(chars, 'znak', 'znaki', 'znaków')}`;
}

function renderResult(redacted: string, found: PiiFinding[]): void {
  // Nowy wynik: „Skopiowano ✓” dotyczyło poprzedniego, więc etykieta wraca do „Kopiuj”.
  if (redacted !== lastRedacted) copyFlash.reset();
  lastRedacted = redacted;
  lastInput = input.value;
  setResultActions(true);
  syncPrintOut();
  renderOutput();
  renderFindings(found);
}

// Debounce: przy szybkim pisaniu nie odpalaj pełnego pipeline'u (26 przebiegów + przerender)
// na każdy znak. Licznik znaków/wierszy aktualizujemy NATYCHMIAST (tani), redakcję później.
let updateTimer: ReturnType<typeof setTimeout> | undefined;
let updatePending = false; // tekst zmienił się od ostatniego przeliczenia
let lastUpdateMs = 0; // zmierzony czas ostatniego przeliczenia (redakcja, render, odmalowanie)
// Przeliczenie dłuższe niż to blokuje kartę zauważalnie: najpierw pokazujemy „Analizuję…”.
const SLOW_UPDATE_MS = 300;

function update(): void {
  clearTimeout(updateTimer);
  updateTimer = undefined;
  updatePending = false;
  const t0 = performance.now();
  const text = input.value;
  updateSrcMeta(text);
  if (!text.trim()) {
    copyFlash.reset();
    output.classList.remove('plain');
    output.innerHTML =
      '<span class="placeholder">Tu pojawi się zanonimizowany wynik, na przykład ' +
      `${maskHtml('IMIĘ I NAZWISKO')}, tel. ${maskHtml('TELEFON')}.<br><br>` +
      'Wklej tekst w polu „Tekst źródłowy” albo kliknij „Przykład” powyżej.</span>';
    findingsCard.hidden = true;
    lastRedacted = '';
    syncPrintOut();
    keptMasks = 0;
    maskEls = [];
    maskIdx = -1;
    maskTabStop = null;
    maskStatus.textContent = '';
    maskNav.hidden = true; // placeholder zawiera przykładowe znaczniki — nie nawigujemy po nich
    viewCompareBtn.disabled = false;
    syncOutputHint();
    setResultActions(false);
    measureSeq++; // zaległy pomiar długiego tekstu już nie obowiązuje
    lastUpdateMs = 0;
    return;
  }
  const { redacted, found } = redactPII(text, {
    types: activeTypes(),
    pseudonyms: pseudonymsBox.checked,
  });
  renderResult(redacted, found);
  measureUpdate(t0);
}

/**
 * Koszt przeliczenia liczymy aż do odmalowania: przy długim tekście sam JS to ułamek, a większość
 * czasu zajmuje układ strony z tysiącami znaczników (osobne zadanie po wstawieniu HTML). Zegar
 * zatrzymujemy w zadaniu po klatce. Pomiar odrzucamy, jeśli w międzyczasie było nowe przeliczenie.
 */
let measureSeq = 0;
function measureUpdate(t0: number): void {
  lastUpdateMs = performance.now() - t0;
  const seq = ++measureSeq;
  requestAnimationFrame(() =>
    setTimeout(() => {
      if (seq === measureSeq) lastUpdateMs = performance.now() - t0;
    }, 0),
  );
}

/** Stan „liczę”: wynik przygasa, a podpowiedź mówi „Analizuję…”, dopóki nie ma nowego wyniku. */
function setBusy(on: boolean): void {
  output.classList.toggle('is-busy', on);
  if (on) {
    output.setAttribute('aria-busy', 'true');
    outputHint.textContent = 'Analizuję…';
  } else {
    output.removeAttribute('aria-busy');
    syncOutputHint();
  }
}

/**
 * Przelicz teraz. Przy długim tekście przeliczenie trwa sekundy i blokuje kartę, więc najpierw
 * pokazujemy „Analizuję…” i dajemy przeglądarce jedną klatkę na odmalowanie, a dopiero potem liczymy.
 */
function updateNow(): void {
  updatePending = true;
  clearTimeout(updateTimer);
  if (lastUpdateMs < SLOW_UPDATE_MS) {
    update();
    return;
  }
  setBusy(true);
  requestAnimationFrame(() =>
    setTimeout(() => {
      if (updatePending) update(); // mogło już przeliczyć np. „Kopiuj”
      setBusy(false);
    }, 0),
  );
}

/** Przed kopiowaniem i pobraniem: wynik musi odpowiadać temu, co jest w polu w tej chwili. */
function flushPendingUpdate(): void {
  if (updatePending) update();
}

// Formularz wokół pola źródła jest tylko dla autocomplete="off" (index.html). Enter w polu
// <input> dopisanym kiedyś do takiego formularza nie może go wysłać ani przeładować strony.
document.addEventListener('submit', (e) => e.preventDefault());

input.addEventListener('input', () => {
  // Własna edycja zamyka błąd, bo już nie dotyczy, i „Cofnij”, bo po edycji przywróciłby tekst
  // sprzed niej i skasował to, co właśnie wpisano. Dopisek o pliku (np. o nagłówkach i stopkach,
  // których Parawan nie czyta) zostaje do zamknięcia: te części dalej są w oryginale, a fokus po
  // wczytaniu stoi w polu, więc pierwszy klawisz kasowałby jedyne ostrzeżenie. Puste pole zamyka
  // także dopisek: z pliku nic już w nim nie ma, a dopisek wisiałby nad nowo wpisanym tekstem.
  clearError();
  if (!input.value.trim()) dismissNote();
  else if (undoText !== null || !noteInfo) expireUndo();
  updateSrcMeta(input.value);
  updatePending = true;
  clearTimeout(updateTimer);
  // Pauza dopasowana do zmierzonego kosztu: krótki tekst po 140 ms, długi dopiero po przerwie
  // w pisaniu (inaczej każda pauza między słowami zamrażałaby kartę na kilka sekund).
  updateTimer = setTimeout(updateNow, Math.min(2000, Math.max(140, lastUpdateMs * 1.5)));
});

/* ── Akcje ── */

/** Przewiń do elementu, jeśli jest poza ekranem (np. plik upuszczono na samej górze strony). */
function revealIfOffscreen(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  // Na telefonie widoczna część (visualViewport) bywa niższa niż innerHeight.
  const visibleH = window.visualViewport?.height ?? window.innerHeight;
  if (r.top < 0 || r.bottom > visibleH) el.scrollIntoView({ block: 'center' });
}

// Błąd stoi pod paskiem narzędzi źródła, przy przyciskach, które go wywołują, i NIE znika
// sam (wcześniej po 8 s, często zanim ktokolwiek go zauważył). Czyści go następna akcja:
// wczytanie pliku, „Wyczyść”, „Przykład” albo edycja tekstu.
function showError(msg: string): void {
  appError.textContent = msg;
  appError.hidden = false;
  revealIfOffscreen(appError);
}

function clearError(): void {
  appError.hidden = true;
  appError.textContent = '';
}

// Mysz i touchpad: po akcji fokus wraca do pola. Na dotyku nie, bo fokus otwiera klawiaturę
// ekranową, która zasłania wynik.
const finePointer = matchMedia('(pointer: fine)');

/* Pasek „Cofnij”. „Wyczyść”, „Przykład” i wczytany plik zastępują CAŁY tekst, a przypisanie
   input.value kasuje historię Ctrl+Z pola. Poprzedni tekst trzymamy więc tutaj, do następnej
   edycji albo zamknięcia paska. Nie używamy execCommand('insertText'): wymaga fokusu (na
   dotyku otwiera klawiaturę), przy dużych plikach jest bardzo wolny i jest przestarzały.
   Poprzedni tekst to zwykle dane osobowe, a „Wyczyść” na wspólnym komputerze ma je naprawdę
   usunąć. Dlatego „Cofnij” działa tylko przez chwilę i znika od razu po przejściu do innej
   karty, zminimalizowaniu okna albo zamknięciu strony. */
let undoText: string | null = null;
// Dopisek, który należał do poprzedniego tekstu: „Cofnij” przywraca go razem z nim, bo nagłówki
// i komentarze przywróconego DOCX dalej są w oryginale.
let undoInfo = '';
let noteInfo = ''; // dopisek bez cofania (np. o kodowaniu pliku), zostaje po wygaśnięciu „Cofnij”
const UNDO_MS = 20_000;
let undoTimer: ReturnType<typeof setTimeout> | undefined;

/** Pokaż pasek pod narzędziami: `msg` z przyciskiem „Cofnij” (gdy jest `prev`) i dopisek `info`. */
function showNote(msg: string, prev: string | null, info = ''): void {
  clearTimeout(undoTimer);
  undoText = prev;
  noteInfo = info;
  // Dopisek w osobnym wierszu (white-space: pre-line w style.css): ostrzeżenie o pliku nie ginie
  // w jednym akapicie z „Zastąpiono tekst treścią pliku.”.
  const text = [msg, info].filter(Boolean).join('\n');
  appNoteText.textContent = text;
  appNoteUndo.hidden = prev === null;
  appNote.hidden = false;
  appNoteStatus.textContent = text; // ogłoszenie dla czytnika ekranu
  revealIfOffscreen(appNote);
  if (prev !== null) undoTimer = setTimeout(expireUndo, UNDO_MS);
}

/** Zapomnij poprzedni tekst. Pasek zostaje tylko wtedy, gdy ma jeszcze dopisek do przeczytania. */
function expireUndo(): void {
  if (!noteInfo) {
    dismissNote();
    return;
  }
  clearTimeout(undoTimer);
  const hadFocus = document.activeElement === appNoteUndo;
  undoText = null;
  appNoteUndo.hidden = true;
  appNoteText.textContent = noteInfo;
  if (hadFocus) appNoteClose.focus({ preventScroll: true });
}

function dismissNote(): void {
  clearTimeout(undoTimer);
  // przyciski znikają razem z paskiem, więc fokus z nich wraca do pola źródła
  const hadFocus = appNote.contains(document.activeElement);
  undoText = null;
  noteInfo = '';
  appNote.hidden = true;
  appNoteStatus.textContent = '';
  if (hadFocus && finePointer.matches) input.focus({ preventScroll: true });
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && undoText !== null) expireUndo();
});
addEventListener('pagehide', () => {
  if (undoText !== null) expireUndo();
});

/** Zastąp cały tekst źródła; gdy było co stracić, pokaż pasek „Cofnij”. `info` to dopisek. */
function replaceSource(text: string, note: string, info = ''): void {
  const prev = input.value;
  const prevInfo = noteInfo;
  input.value = text;
  update();
  if (finePointer.matches) input.focus(); // przed paskiem: przewinięcie do pola nie zasłoni go
  const canUndo = prev.trim() !== '' && prev !== text;
  if (canUndo || info) showNote(canUndo ? note : '', canUndo ? prev : null, info);
  else dismissNote();
  undoInfo = canUndo ? prevInfo : '';
}

appNoteUndo.addEventListener('click', () => {
  if (undoText === null) return;
  const info = undoInfo;
  input.value = undoText;
  setFileExt(''); // pobieranie wraca do .txt jak po „Wyczyść” (rodzaj pliku nie wraca)
  dismissNote();
  clearError();
  update();
  // Dopisek o pliku wraca razem z jego tekstem, a czytnik ekranu słyszy jedno i drugie.
  if (info) showNote('', null, info);
  appNoteStatus.textContent = ['Przywrócono poprzedni tekst.', info].filter(Boolean).join('\n');
  if (finePointer.matches) input.focus(); // przycisk znika, więc fokus nie może na nim zostać
});
appNoteClose.addEventListener('click', () => {
  dismissNote();
  if (finePointer.matches) input.focus();
});

clearBtn.addEventListener('click', () => {
  clearError();
  setFileExt('');
  replaceSource('', 'Wyczyszczono tekst.');
});

/** Komunikat dla czytnika ekranu. Ten sam tekst dwa razy z rzędu też ma zostać odczytany,
    więc region najpierw czyścimy, a treść wstawiamy chwilę później. */
function announce(msg: string): void {
  srStatus.textContent = '';
  setTimeout(() => (srStatus.textContent = msg), 60);
}

const copyFlash = makeFlash((t) => (copyLabel.textContent = t), 'Kopiuj');

copyBtn.addEventListener('click', async () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  try {
    await navigator.clipboard.writeText(outputText());
    copyFlash.show('Skopiowano ✓');
    announce('Skopiowano wynik do schowka.');
  } catch {
    const prevFocus = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = outputText();
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    prevFocus?.focus({ preventScroll: true }); // select() zabrał fokus do usuniętego pola
    if (ok) {
      copyFlash.show('Skopiowano ✓');
      announce('Skopiowano wynik do schowka.');
    } else {
      copyFlash.reset();
      showError(
        viewMode === 'compare'
          ? 'Kopiowanie zablokowane przez przeglądarkę: przełącz na widok „Wynik”, zaznacz tekst i naciśnij Ctrl+C.'
          : 'Kopiowanie zablokowane przez przeglądarkę: zaznacz wynik i naciśnij Ctrl+C.',
      );
    }
  }
});

downloadBtn.addEventListener('click', () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  // Nazwa ze znacznikiem czasu, BOM i windowsowe końce wierszy: output.ts (downloadFor).
  const file = downloadFor(outputText(), lastFileExt, new Date());
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(url);
});

/* ── Druk ──
   @media print w style.css chowa całą stronę poza #print-out, więc Ctrl+P, menu przeglądarki
   i przycisk drukują to samo: cały wynik, bez pola źródła. Przed drukiem kończymy odłożone
   przeliczenie (tekst wklejony przed chwilą), a tytuł karty, z którego przeglądarka robi nazwę
   pliku PDF i nagłówek wydruku, na ten czas mówi, co jest na papierze. */
let titleBeforePrint: string | null = null;

addEventListener('beforeprint', () => {
  flushPendingUpdate();
  // Firefox potrafi zgłosić beforeprint drugi raz przed afterprint: pierwotny tytuł zostaje.
  titleBeforePrint ??= document.title;
  document.title = printTitle(new Date());
});
addEventListener('afterprint', () => {
  if (titleBeforePrint === null) return;
  document.title = titleBeforePrint;
  titleBeforePrint = null;
});

printBtn.addEventListener('click', () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  window.print();
});

// Przykład: maskowanie + strażnik kontekstu (art. 123 456 789 celowo zostaje)
const EXAMPLE_TEXT = `Dzień dobry, nazywam się Anna Kowalska (PESEL 44051401359).
Mieszkam przy ul. Polnej 12/3, 00-950 Warszawa.
Proszę o kontakt: anna.kowalska@example.com lub tel. 600 700 800.
Nr konta do zwrotu: PL61 1090 1014 0000 0712 1981 2874.
Sprawę prowadzi pan Bąkiewicz zgodnie z art. 123 456 789 KC.`;

exampleBtn.addEventListener('click', () => {
  clearError();
  setFileExt('');
  replaceSource(EXAMPLE_TEXT, 'Wstawiono przykład w miejsce Twojego tekstu.');
});

loadFileBtn.addEventListener('click', () => fileInput.click());

const EMPTY_FILE = 'Plik jest pusty: nie zawiera tekstu do anonimizacji.';

/** Spis części DOCX poza treścią główną albo null, gdy się nie udał (treść i tak wczytujemy). */
function docxInventory(buf: Uint8Array): DocxInventory | null {
  try {
    return inventoryDocx(buf);
  } catch {
    return null;
  }
}

/**
 * Wczytaj plik do pola źródła. Pliki tekstowe dekodujemy sami (UTF-8, UTF-16 z BOM albo
 * Windows-1250), DOCX i PDF mają własne ekstraktory. Przy każdym błędzie pole zostaje
 * bez zmian, a użytkownik dostaje komunikat po polsku.
 */
async function loadAnyFile(file: File): Promise<void> {
  clearError();
  if (file.size === 0) {
    showError(EMPTY_FILE);
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    showError(`Plik jest zbyt duży (limit ${MAX_FILE_MB} MB). Podziel go na mniejsze części.`);
    return;
  }
  loadFileBtn.disabled = true;
  loadFileBtn.classList.add('busy');
  const prevLabel = loadFileLabel.textContent;
  loadFileLabel.textContent = 'Wczytuję';
  output.setAttribute('aria-busy', 'true');
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const head = buf.subarray(0, 4096);
    const ext = fileExt(file.name);
    const isPdf = ext === 'pdf' || looksLikePdf(head);
    const isDocx = !isPdf && ext === 'docx';
    let text: string;
    let info = '';
    let emptyError = EMPTY_FILE;
    if (isDocx) {
      text = extractDocxText(buf);
      const inv = docxInventory(buf);
      info = docxInventoryNote(inv);
      // Skan wklejony jako obraz albo dane tylko w nagłówku: plik nie jest pusty, a „Plik jest
      // pusty” zachęcałby do uznania go za czysty.
      emptyError = docxEmptyBodyError(inv) ?? EMPTY_FILE;
    } else if (isPdf) text = await extractPdfText(buf);
    else {
      const unsupported = unsupportedFormat(file.name, head);
      if (unsupported) {
        showError(unsupported);
        return;
      }
      const decoded = decodeText(buf);
      text = decoded.text;
      if (decoded.encoding === 'windows-1250') {
        info =
          'Plik był zapisany w kodowaniu Windows-1250 (ANSI), polskie znaki przekonwertowano. ' +
          'Sprawdź, czy wyglądają poprawnie.';
      }
    }
    if (!text.trim()) {
      showError(emptyError);
      return;
    }
    replaceSource(text, 'Zastąpiono tekst treścią pliku.', info);
    setFileExt(isPdf ? 'pdf' : isDocx ? 'docx' : ext);
    if (text.includes('\uFFFD')) {
      showError(
        'Część znaków w pliku jest nieczytelna, więc maskowanie może być niepełne. Sprawdź wynik.',
      );
    }
    // dokumenty najlepiej przegląda się w trybie recenzji
    if (isDocx || isPdf) setViewMode('compare');
  } catch (err) {
    // Tylko nasze komunikaty idą na ekran wprost; surowy wyjątek biblioteki (często po
    // angielsku, np. „Invalid code point”) zastępujemy ogólnym.
    showError(err instanceof FileReadError ? err.message : 'Nie udało się odczytać pliku.');
  } finally {
    loadFileBtn.disabled = false;
    loadFileBtn.classList.remove('busy');
    loadFileLabel.textContent = prevLabel;
    output.removeAttribute('aria-busy');
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  void loadAnyFile(file);
  fileInput.value = '';
});

// drag&drop: PLIK na pole i GDZIEKOLWIEK na stronie (domyślna nawigacja = utrata pracy).
// Przeciągany TEKST (np. zaznaczenie z Worda) obsługuje sama przeglądarka: wstawia go w polu.
// Dlatego warunek „to plik” stoi i w dragover, i w drop; bez niego Chromium odrzuca tekst.
const hasFiles = (e: DragEvent): boolean =>
  !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

/** Wczytaj pierwszy z upuszczonych plików; o pominiętych powiedz wprost. */
function loadDropped(files: FileList | null | undefined): void {
  if (!files?.length) return;
  const total = files.length;
  // komunikat dopiero po wczytaniu, bo loadAnyFile na starcie czyści błędy
  void loadAnyFile(files[0]).then(() => {
    if (total < 2) return;
    const msg = `Wczytano tylko jeden z ${total} upuszczonych plików. Pozostałe upuść osobno, po jednym.`;
    showError(appError.hidden ? msg : `${appError.textContent} ${msg}`);
  });
}

// Podświetlenie pola na czas przeciągania pliku nad stroną. dragenter/dragleave przychodzą
// od każdego mijanego elementu, więc liczymy głębokość, zamiast reagować na pojedyncze zdarzenie.
let dragDepth = 0;
function endFileDrag(): void {
  dragDepth = 0;
  document.body.classList.remove('file-drag');
  input.classList.remove('dragover');
}
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  document.body.classList.add('file-drag');
});
window.addEventListener('dragleave', (e) => {
  if (hasFiles(e) && --dragDepth <= 0) endFileDrag();
});

input.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  input.classList.add('dragover');
});
input.addEventListener('dragleave', () => input.classList.remove('dragover'));
window.addEventListener('dragover', (e) => {
  if (e.target === input && !hasFiles(e)) return;
  e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (e.target === input && !hasFiles(e)) return;
  e.preventDefault();
  endFileDrag();
  if (hasFiles(e)) loadDropped(e.dataTransfer?.files);
});

// Ctrl/Cmd+Enter — kopiuj wynik. Najpierw dokończ odłożone przeliczenie: tuż po wklejeniu do
// pustego pola przycisk jest jeszcze wyłączony, a click() na wyłączonym nic nie robi.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    flushPendingUpdate();
    copyBtn.click();
  }
});

/* ── Pauza animacji (WCAG 2.2.2) ── */
// Demo „Jak to działa” i podświetlanie kroków biegną w pętli. Przycisk zatrzymuje oba ruchy
// (demo zostaje w kadrze „wejście, parawan, wyjście”), a wybór pamiętamy jak ustawienia.
// Bez aria-pressed: napis mówi, co zrobi przycisk, więc zmienia się razem ze stanem.
const motionBtn = $<HTMLButtonElement>('demo-motion');

function setMotion(on: boolean): void {
  if (on) delete document.documentElement.dataset.motion;
  else document.documentElement.dataset.motion = 'off';
  motionBtn.textContent = on ? 'Zatrzymaj animację' : 'Wznów animację';
}

setMotion(storageGet('motion') !== 'off');
motionBtn.addEventListener('click', () => {
  const on = document.documentElement.dataset.motion === 'off';
  setMotion(on);
  storageSet('motion', on ? '' : 'off');
});

/* ── Parametry URL i start ── */

const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  input.value = EXAMPLE_TEXT;
} else if (finePointer.matches) {
  // Autofokus bez przewijania: pole leży niżej, a nagłówek z obietnicą prywatności ma zostać
  // widoczny. Ctrl+V i tak trafia do pola.
  input.focus({ preventScroll: true });
}

// ?pdftest — samodiagnostyka ścieżki PDF (fake worker w buildzie single-file)
if (params.has('pdftest')) {
  const pdfBytes = buildMinimalPdf('PDFTEST PESEL 44051401359');
  extractPdfText(pdfBytes)
    .then((t) => {
      input.value = `[PDF OK] ${t}`;
      update();
    })
    .catch((e) => {
      input.value = `[PDF FAIL] ${e instanceof Error ? e.message : e}`;
      update();
    });
}

$('app-version-top').textContent = __APP_VERSION__;

// Podmień wszystkie statyczne <i class="gi" data-i="…"> z index.html na inline SVG.
hydrateIcons();

// Na dotyku nie ma skrótu klawiszowego, więc dymki „Kopiuj” i kroku 4 o nim nie wspominają
// (przed initTips: ikona kroku bierze treść dymka jako nazwę dostępną).
if (!finePointer.matches) {
  copyBtn.dataset.tip = 'Kopiuje zanonimizowany tekst do schowka';
  $('step4-tip').dataset.tip = 'Przyciski „Kopiuj” i „Pobierz .txt” stoją nad wynikiem';
}
// Na telefonie pliku nie ma skąd upuścić (ten sam warunek co .hint-desk w style.css).
if (matchMedia('(pointer: coarse) and (max-width: 600px)').matches) {
  input.placeholder = input.placeholder.replace('albo upuść plik', 'albo wczytaj plik');
}

// Dymki: opisy dla czytników ekranu, „?” w summary, Esc i dociskanie do krawędzi (tips.ts).
initTips();

update();

// Ostatnia instrukcja startu: pasek „Parawan nie uruchomił się” (#boot-fail w index.html) znika
// dopiero tutaj. Gdy silnik nie sparsuje modułu (Chromium starsze niż 94, tryb Internet Explorera)
// albo coś wyżej rzuci wyjątek, pasek zostaje i po 4 s pokazuje się sam, zamiast strony, która
// wygląda na gotową i nie reaguje. Do tego czasu jest ukryty i nie zajmuje miejsca (max-height: 0),
// więc przy zwykłym starcie nic nie mignie ani nie przesunie układu. Arkusz paska stoi osobno
// w <head>, bez zmiennych ze style.css, żeby zadziałał także tam, gdzie główny CSS nie zadziała.
// Opóźnienie to animation-delay, a reguła prefers-reduced-motion w style.css skraca tylko
// animation-duration, więc przy ograniczonym ruchu pasek też się pokaże (sprawdza to
// scripts/e2e/smoke.test.mjs). Bez JavaScriptu zamiast niego stoi komunikat z <noscript>, a drugi
// <noscript> w <head> chowa pasek, żeby nie było dwóch.
document.getElementById('boot-fail')?.remove();
