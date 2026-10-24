import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { escapeHtml, guessAligned } from './compare';
import {
  applyCorrections,
  type Corrected,
  correctionCounts,
  type Decision,
  defaultToken,
  findOccurrences,
  lineRanges,
  MANUAL_TOKENS,
  shiftDecisions,
  snapSelection,
  spanKey,
} from './corrections';
import { extractDocxText } from './docx';
import { EXAMPLE_TEXT } from './example';
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
import { fileAgeNote, formatBuildDate } from './file-age';
import { makeFlash } from './flash';
import { buildDocx, DOCX_MIME } from './docx-write';
import {
  downloadFor,
  downloadName,
  finalText,
  printTitle,
  protocolName,
  protocolTitle,
  textForDownload,
} from './output';
import { extractPdfText } from './pdf';
import { buildMinimalPdf } from './pdf-fixture';
import {
  CAT_LABELS,
  type Cat,
  CHIP_BY_TOKEN,
  CHIP_META,
  type ChipMeta,
  catCountLabel,
  MASK_GROUPS,
  MASK_TOKEN_RE,
  type MaskGroup,
  maskCategory,
  maskTip,
  PII_TOKENS,
  tokenOfCode,
  WYKRYWA_ROWS,
} from './pii-meta';
import { plural } from './plural';
import {
  BASES,
  buildAnnotation,
  buildProtocol,
  correctionLines,
  countByToken,
  countFromFindings,
  formatDate,
  isOtherDocument,
  OTHER_BASIS,
  type PublicationFields,
  type SourceKind,
  sha256Hex,
} from './publikacja';
import { alignSpans, countTokens, renderSpansHtml, type Span } from './spans';
import { storageGet, storageRemove, storageSet } from './storage';
import { isProductCopy } from './web-copy';
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
const downloadDocxBtn = $<HTMLButtonElement>('download-docx');
const printBtn = $<HTMLButtonElement>('print');
const printOut = $<HTMLDivElement>('print-out');
const printAnnex = $<HTMLDivElement>('print-annex');
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
const appNoteMaskOn = $<HTMLButtonElement>('app-note-mask-on');
const appNoteClose = $<HTMLButtonElement>('app-note-close');
const appNoteStatus = $<HTMLSpanElement>('app-note-status');
const maskNav = $<HTMLSpanElement>('mask-nav');
const maskPrev = $<HTMLButtonElement>('mask-prev');
const maskNext = $<HTMLButtonElement>('mask-next');
const maskCount = $<HTMLSpanElement>('mask-count');
const maskStatus = $<HTMLSpanElement>('mask-status');
const maskSeen = $<HTMLSpanElement>('mask-seen');
const srStatus = $<HTMLParagraphElement>('sr-status');
const outputHint = $<HTMLSpanElement>('output-hint');

let lastRedacted = '';
let lastInput = '';
// Zakresy oryginał–znacznik bieżącego wyniku (spans.ts); null = wynik nie pasuje do oryginału
// co do znaku, więc wszystko, co z zakresów korzysta, jest wyłączone.
let lastSpans: Span[] | null = null;
// Liczniki rdzenia bieżącego wyniku: zapas dla adnotacji i protokołu, gdy zakresów nie ma.
let lastFound: PiiFinding[] = [];
// Rozszerzenie ostatnio wczytanego pliku (bez nazwy): po .csv „Pobierz” oddaje .csv.
let lastFileExt = '';
let viewMode: 'result' | 'compare' = 'result';
let maskEls: HTMLElement[] = []; // znaczniki w wyniku, w kolejności dokumentu
let maskIdx = -1; // bieżący znacznik w przeglądaniu (-1 = żaden)
let maskTabStop: HTMLElement | null = null; // jedyny znacznik w kolejności Tab (roving tabindex)
// Postęp przeglądu: indeksy znaczników, które były bieżące (‹ ›, klik, fokus, chip). Zerowany przy
// nowym wyniku, a nie przy przełączeniu widoku: „Porównanie” ma te same znaczniki w tej kolejności.
const reviewed = new Set<number>();
// Ręczne poprawki (corrections.ts) w kolejności podjęcia: tylko w pamięci karty, nigdy
// w localStorage (zawierają fragmenty pisma). `corrected` to ich wynik dla bieżących zakresów.
let decisions: Decision[] = [];
let corrected: Corrected = { spans: [], kept: [], effects: [], by: [] };
// Lista decyzji sprzed każdej czynności (Ctrl+Z w wyniku i „Cofnij ostatnią” wracają do niej).
// Cała lista, a nie „zdejmij ostatni wpis”: po „Cofnij zasłonięcie” decyzja znika ze środka listy
// i Ctrl+Z musi ją przywrócić na jej miejsce, zamiast zdjąć inną, wcześniejszą poprawkę.
let undoSteps: Decision[][] = [];
// Zmiana źródła od ostatniego przeliczenia, której nie da się zmapować przesunięciem: natywne
// cofanie albo ponawianie w polu ('history'), wklejenie w miejsce całego tekstu ('unsure') albo
// podmiana całego tekstu przez „Wyczyść”, „Przykład”, plik i „Cofnij” na pasku ('replaced', poprawki
// ustawia wtedy sama podmiana). followSource rozstrzyga przy przeliczeniu, co z poprawkami.
let sourceChange: 'none' | 'unsure' | 'history' | 'replaced' = 'none';
// Poprawki tekstu sprzed ostatniej niepewnej zmiany. Wracają tylko wtedy, gdy natywne cofanie albo
// ponawianie przywróci DOKŁADNIE ten tekst (Ctrl+A, Delete, Ctrl+Z). Jedno miejsce, nie stos:
// każda następna niepewna zmiana je nadpisuje, więc poprawki nie przechodzą na inne pismo.
let parked: { text: string; decisions: Decision[] } | null = null;

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
// Wyłączenie wczytane z pamięci przy starcie. W Chromium localStorage jest wspólny dla
// wszystkich plików z dysku, więc mógł je zapisać obcy plik .html, a nie urzędnik (storage.ts,
// reguła b). Pokazujemy je raz, w pasku nad polem źródła, zanim ktoś wklei pismo.
const storedOff = disabledGroups.size > 0;
let storedOffNote = false; // pasek o zapamiętanym wyłączeniu stoi na ekranie

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
// Komunikat pod wynikiem, którego nie da się dopasować do oryginału co do znaku (spans.ts, tryb
// ścisły). Opis w kodzie, a nie w komentarzu HTML: komentarze z index.html trafiają do pliku.
const spansNote = $<HTMLElement>('spans-note');
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
  // Po włączeniu wszystkiego przełącznikami pasek o zapamiętanym wyłączeniu jest już nieaktualny.
  if (storedOffNote && disabledGroups.size === 0) dismissNote();
}

/** Treść paska o wyłączeniu wczytanym z pamięci: skąd, ile typów i które. */
function storedOffMessage(): string {
  const off = MASK_GROUPS.filter((g) => disabledGroups.has(g.key));
  const n = off.length;
  if (n === MASK_GROUPS.length) {
    return `Zapamiętane ustawienie z „Co maskować”: nie zasłaniam żadnego z ${n} typów danych. Wynik pokaże tekst bez zmian.`;
  }
  const count = n === 1 ? 'jednego typu' : `${n} typów`;
  const names = n <= 6 ? ` (${off.map((g) => inSentence(g.label)).join(', ')})` : '';
  return `Zapamiętane ustawienie z „Co maskować”: nie zasłaniam ${count} danych${names}. Te dane zostaną w wyniku bez zmian.`;
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
// Ta sama akcja w pasku o zapamiętanym wyłączeniu; pasek znika razem z wyłączeniem
// (updateMaskTotal), a fokus wraca do pola źródła (dismissNote).
appNoteMaskOn.addEventListener('click', () => {
  bulkMask('on');
  announce('Włączono maskowanie wszystkich typów.');
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

// tabindex="-1": znaczniki nie są osobnymi przystankami Tab (przy długim piśmie były ich setki).
// Do kolejności Tab wchodzi tylko bieżący znacznik (roving tabindex: refreshMaskNav, goToMask).
function maskHtml(name: string, span?: Span): string {
  const tip = span?.source === 'manual' ? `Zasłonięte ręcznie · ${CAT_LABELS[maskCategory(name)]}` : maskTip(name);
  return `<mark class="pii pii-${maskCategory(name)}" data-tip="${escapeHtml(tip)}" tabindex="-1">[${name}]</mark>`;
}

// Fragment odsłonięty ręcznie (mark.pii-kept): oryginał w przerywanej ramce, w nawigacji ‹ ›.
const KEPT_ATTRS = ' tabindex="-1" data-tip="Przywrócone ręcznie. Po kliknięciu nad wynikiem pojawi się „Zasłoń ponownie”."';

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
  syncSelButtons(); // „Zasłoń zaznaczenie” w wyniku działa tylko w widoku „Wynik”
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
    // Bez zakresów zostaje dawna heurystyka, wyłącznie do podglądu (pod wynikiem stoi wtedy
    // #spans-note). Z zakresami tekst oryginału ma data-o, a znacznik data-s (indeks zakresu).
    const compare = viewMode === 'compare';
    const { html, kept } = lastSpans
      ? {
          html: renderSpansHtml(lastInput, corrected.spans, { maskHtml, compare, kept: corrected.kept, keptAttrs: KEPT_ATTRS }),
          kept: keptMasks,
        }
      : guessAligned(lastInput, lastRedacted, { tokenRe: MASK_TOKEN_RE, maskHtml, compare });
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
  const wasOpen = barOpen;
  renderOutput();
  if (prevIdx >= 0 && maskEls.length === prevN) goToMask(prevIdx);
  else output.scrollTop = ratio * (output.scrollHeight - output.clientHeight);
  if (wasOpen) openBar(false); // pasek fragmentu zostaje, w „Porównaniu” bez wiersza z oryginałem
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
  maskStatus.textContent = el.matches('mark.pii-kept')
    ? `Fragment ${maskIdx + 1} z ${n}: przywrócony ręcznie`
    : `Fragment ${maskIdx + 1} z ${n}: ${el.textContent} · ${el.dataset.tip ?? ''}`;
  reviewed.add(maskIdx);
  updateMaskCount();
  syncReview();
  syncBar();
}

/** Przenieś jedyny przystanek Tab w wyniku na znacznik `el` (roving tabindex). */
function setMaskTabStop(el: HTMLElement | null): void {
  if (maskTabStop && maskTabStop !== el) maskTabStop.tabIndex = -1;
  maskTabStop = el;
  if (el) el.tabIndex = 0;
}

/** Po każdym renderze wyniku: zbierz znaczniki, wyzeruj przegląd, pokaż/ukryj nawigację. */
function refreshMaskNav(): void {
  // Znaczniki i fragmenty przywrócone ręcznie, w kolejności dokumentu.
  maskEls = [...output.querySelectorAll<HTMLElement>('mark.pii, mark.pii-kept')];
  maskIdx = -1;
  maskTabStop = null; // poprzedni wynik zniknął z DOM razem ze swoim znacznikiem
  setMaskTabStop(maskEls[0] ?? null); // Tab wchodzi do wyniku na pierwszym znaczniku
  maskStatus.textContent = ''; // stary „Fragment N z M” nie dotyczy nowego wyniku
  barOpen = false; // pasek dotyczył znacznika z poprzedniego renderu
  syncBar();
  maskNav.hidden = maskEls.length === 0;
  updateMaskCount();
  syncReview();
}

const goToPrevMask = (): void => goToMask(maskIdx <= 0 ? maskEls.length - 1 : maskIdx - 1);

maskPrev.addEventListener('click', goToPrevMask);
maskNext.addEventListener('click', () => goToMask(maskIdx + 1));

// Klik w znacznik → uczyń go bieżącym (bez przewijania — użytkownik już na niego patrzy)
// i otwórz pasek działań. Przeciągnięcie zaznaczenia przez znacznik paska nie otwiera.
output.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.('mark.pii, mark.pii-kept') as HTMLElement | null;
  const at = el ? maskEls.indexOf(el) : -1;
  if (at === -1) return;
  goToMask(at, false);
  if (getSelection()?.isCollapsed !== false) openBar(false);
});

// Fokus z klawiatury (Tab na przystanek w wyniku) też ustawia bieżący znacznik. Bez tego licznik
// pokazywał „0 / N”, a pierwsza strzałka ↓ zostawała na tym samym znaczniku.
output.addEventListener('focusin', (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.('mark.pii, mark.pii-kept') as HTMLElement | null;
  const at = el ? maskEls.indexOf(el) : -1;
  if (at !== -1 && at !== maskIdx) goToMask(at, false);
});

// Ctrl+A w wyniku zaznacza sam wynik. Domyślnie zaznaczała całą stronę razem z polem źródła,
// więc Ctrl+C po kliknięciu w wynik kopiował też oryginalne dane osobowe.
output.addEventListener('keydown', (e) => {
  // Enter albo spacja na znaczniku: pasek działań z fokusem na pierwszym przycisku.
  const mark = (e.target as HTMLElement).closest?.('mark.pii, mark.pii-kept');
  if (mark && (e.key === 'Enter' || e.key === ' ') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    const at = maskEls.indexOf(mark as HTMLElement);
    if (at !== -1 && at !== maskIdx) goToMask(at, false);
    openBar(true);
    return;
  }
  // Ctrl+Z w wyniku cofa ostatnią czynność na poprawkach (pole wyniku nie ma własnej historii edycji).
  // Bez czynności do cofnięcia, a także przy Ctrl+Y i Ctrl+Shift+Z, skrót też nie idzie dalej:
  // Chromium cofnąłby wtedy historię pola źródła i zmienił pismo z poziomu wyniku.
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === 'z' || key === 'y')) {
    e.preventDefault();
    if (key === 'z' && !e.shiftKey) undoLast();
    return;
  }
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
// dokumentu). Proporcjonalnie (treści mają różną długość). Zdarzenie scroll, które wywołało samo
// przesunięcie drugiego okna (echo), pomijamy po wartości, a nie po czasie: blokada do następnej
// klatki nie wystarczała w Firefoksie ESR 115, który zgłasza scroll po requestAnimationFrame.
// Okna odbijały wtedy ruch w nieskończoność, wynik pełzł w górę o kilkadziesiąt pikseli co pół
// sekundy, a przeciąganie zaznaczenia w wyniku łapało inny wiersz niż pod kursorem.
const scrollEcho = new WeakMap<HTMLElement, number>();
function linkScroll(from: HTMLElement, to: HTMLElement): void {
  from.addEventListener('scroll', () => {
    const echo = scrollEcho.get(from);
    scrollEcho.delete(from);
    if (echo !== undefined && Math.abs(from.scrollTop - echo) < 2) return;
    const fromMax = from.scrollHeight - from.clientHeight;
    const toMax = to.scrollHeight - to.clientHeight;
    const before = to.scrollTop;
    to.scrollTop = fromMax > 0 ? (from.scrollTop / fromMax) * toMax : 0;
    if (to.scrollTop !== before) scrollEcho.set(to, to.scrollTop);
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

/**
 * Chipy liczą znaczniki z zakresów (tokens), a nie liczniki rdzenia: „Anna i Jan Kowalscy” to
 * dwa znaczniki [IMIĘ I NAZWISKO] przy jednym wykryciu w found. Kolejność chipów zostaje z found.
 * Bez zakresów (tokens null) zostają liczniki rdzenia.
 */
function renderFindings(found: PiiFinding[], tokens: Map<string, number> | null): void {
  findingsCard.hidden = false;
  const byLabel = new Map<string, { count: number; cat: Cat; icon: string; token: string }>();
  const add = (meta: ChipMeta, count: number): void => {
    const prev = byLabel.get(meta.label);
    byLabel.set(meta.label, { count: (prev?.count ?? 0) + count, cat: meta.cat, icon: meta.icon, token: meta.token });
  };
  for (const f of found) {
    // zapas na czas działania (typ spoza CHIP_META mimo typecheck): chip z surowym kodem
    const meta = CHIP_META[f.type] ?? {
      label: String(f.type),
      token: String(f.type),
      cat: 'ident' as Cat,
      icon: 'dane-id',
    };
    // koercja licznika do liczby — obrona przed nie-liczbowym count (XSS/NaN)
    add(meta, tokens ? 0 : Number(f.count) || 0);
  }
  if (tokens) {
    // każdy token z MASK_TOKEN_RE ma chip (pilnuje pii-meta.test.ts)
    for (const [token, n] of tokens) if (CHIP_BY_TOKEN[token]) add(CHIP_BY_TOKEN[token], n);
    for (const [label, v] of byLabel) if (!v.count) byLabel.delete(label);
  }
  const total = [...byLabel.values()].reduce((s, v) => s + v.count, 0);
  const cats = new Set([...byLabel.values()].map((v) => v.cat)).size;
  statCount.textContent = String(total);
  statCountW.textContent = plural(total, 'wykrycie', 'wykrycia', 'wykryć');
  statCats.textContent = String(cats);
  statCatsW.textContent = plural(cats, 'kategoria', 'kategorie', 'kategorii');
  const off = maskOffSummary();
  const keptChip = keptMasks
    ? ` <span class="chip chip-hint">w tekście były już znaczniki <span class="x">×${keptMasks}</span></span>`
    : '';

  if (total === 0) {
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

/* ── Ręczna korekta: „Zostaw jawne” na znaczniku i „Zasłoń zaznaczenie” ──
   Logika (decyzje, klucz osoby, wystąpienia, przesunięcie po edycji) żyje w corrections.ts;
   tu tylko pasek bieżącego fragmentu, wiersz zasłaniania, stopka z listą poprawek i zdarzenia.
   Oryginał spod znacznika pokazujemy wyłącznie na ekranie (translate="no"), nigdy w druku,
   pliku ani protokole: te biorą tekst z finalText (output.ts) i same liczby (publikacja.ts). */
const fixBar = $<HTMLDivElement>('fix-bar');
const fixBarPos = $<HTMLSpanElement>('fix-bar-pos');
const fixBarOrig = $<HTMLSpanElement>('fix-bar-orig');
const fixBarWhat = $<HTMLSpanElement>('fix-bar-what');
const fixBarVal = $<HTMLElement>('fix-bar-val');
const fixBarGroup = $<HTMLParagraphElement>('fix-bar-group');
const fixBarForms = $<HTMLParagraphElement>('fix-bar-forms');
const fixKeep = $<HTMLButtonElement>('fix-keep');
const fixKeepAll = $<HTMLButtonElement>('fix-keep-all');
const fixRemask = $<HTMLButtonElement>('fix-remask');
const fixBarClose = $<HTMLButtonElement>('fix-bar-close');
const fixForm = $<HTMLDivElement>('fix-form');
const fixFormVal = $<HTMLElement>('fix-form-val');
const fixToken = $<HTMLSelectElement>('fix-token');
const fixAll = $<HTMLInputElement>('fix-all');
const fixAllN = $<HTMLSpanElement>('fix-all-n');
const fixApply = $<HTMLButtonElement>('fix-apply');
const fixCancel = $<HTMLButtonElement>('fix-cancel');
const fixSelSrc = $<HTMLButtonElement>('fix-sel-src');
const fixSelOut = $<HTMLButtonElement>('fix-sel-out');
const fixFoot = $<HTMLDivElement>('fix-foot');
const fixSum = $<HTMLSpanElement>('fix-sum');
const fixFootActs = $<HTMLSpanElement>('fix-foot-acts');
const fixShow = $<HTMLButtonElement>('fix-show');
const fixNoteEl = $<HTMLParagraphElement>('fix-note');
const fixList = $<HTMLUListElement>('fix-list');
const fixOff = $<HTMLSpanElement>('fix-off');
const outCard = output.closest('.card') as HTMLElement;
const srcToolbar = input.closest('.card')?.querySelector('.toolbar') as HTMLElement;

for (const t of MANUAL_TOKENS) fixToken.add(new Option(t.label, t.token));

// Przycisk „Zasłoń zaznaczenie” i licznik „jawne: 2 · przejrzano 12 z 28” potrafią zawinąć opis
// w nagłówku wyniku do drugiego wiersza (wąskie okno, powiększenie 125%). Okna źródła i wyniku
// stoją wtedy obok siebie na różnych wysokościach, a przewijają się razem. Nagłówek źródła
// dostaje więc wysokość nagłówka wyniku, gdy karty stoją w jednym rzędzie.
const srcHead = input.closest('.card')?.querySelector<HTMLElement>('.card-h');
const outHead = outCard.querySelector<HTMLElement>('.card-h');
if (srcHead && outHead && 'ResizeObserver' in window) {
  new ResizeObserver(() => {
    srcHead.style.minHeight = '';
    const row = Math.abs(srcHead.getBoundingClientRect().top - outHead.getBoundingClientRect().top) < 1;
    const h = outHead.getBoundingClientRect().height;
    if (row && h > srcHead.getBoundingClientRect().height) srcHead.style.minHeight = `${h}px`;
  }).observe(outHead);
}

// Ikona ma aria-label, więc labelTips() pomija jej dymek: zdanie „najpierw zaznacz” idzie do opisu od razu.
// Dymek mówi też, czemu w „Porównaniu” przycisk jest nieaktywny (zaznacza się w widoku „Wynik”).
fixSelOut.setAttribute('aria-describedby', tipDescId(fixSelOut.dataset.tip ?? ''));
let barOpen = false;
let fixNote = ''; // komunikat o poprawkach odrzuconych po edycji źródła
let formRanges: [number, number][] = [];
let formText = '';
let formInput = ''; // tekst źródła z chwili otwarcia wiersza: formRanges to pozycje w nim
let formAt: { start: number; end: number } | null = null;
let formReturn: HTMLElement | null = null;
let outRange: Range | null = null; // ostatnie niepuste zaznaczenie w wyniku

const fragmentsWord = (n: number): string => `${n} ${plural(n, 'fragment', 'fragmenty', 'fragmentów')}`;
const placesWord = (n: number): string => `${n} ${plural(n, 'miejsce', 'miejsca', 'miejsc')}`;
const tokenLabel = (t: string): string => CHIP_BY_TOKEN[t.startsWith('OSOBA-') ? 'IMIĘ I NAZWISKO' : t]?.label ?? t;
/** Oryginał zakresu w jednym wierszu (do paska i listy poprawek, tylko na ekranie). */
const origOf = (start: number, end: number): string => lastInput.slice(start, end).replace(/\s+/g, ' ').trim();

/** Korekta działa tylko na zakresach: bez nich (tryb ścisły) i przy długim tekście jest wyłączona. */
const fixAvailable = (): boolean => !!lastSpans && !isTooBig();
/**
 * Ręczne zasłonięcia, których nie da się nałożyć (tekst urósł ponad HIGHLIGHT_LIMIT albo wynik nie
 * pasuje do oryginału): wynik rdzenia miałby je jawne, więc kopiowanie, pliki i druk czekają.
 */
const exportBlocked = (): boolean => !!lastRedacted && !lastSpans && decisions.some((d) => d.kind === 'mask');

function recomputeCorrections(): void {
  corrected = lastSpans
    ? applyCorrections(lastInput, lastSpans, decisions)
    : { spans: [], kept: [], effects: decisions.map(() => 0), by: [] };
}

/** Bieżący fragment: zakres pod znacznikiem albo fragment przywrócony ręcznie. */
function currentFrag(): { span: Span; kept: boolean } | null {
  const el = maskEls[maskIdx];
  if (!el || !lastSpans) return null;
  if (el.dataset.s !== undefined) {
    const span = corrected.spans[Number(el.dataset.s)];
    return span ? { span, kept: false } : null;
  }
  if (el.dataset.k !== undefined) {
    const span = corrected.kept[Number(el.dataset.k)];
    return span ? { span, kept: true } : null;
  }
  return null;
}

/** Zakresy wyniku z tym samym kluczem osoby albo danej co `span` (do „Zostaw jawne wszędzie”). */
function sameAs(span: Span): Span[] {
  const key = spanKey(lastInput, span);
  return corrected.spans.filter((s) => spanKey(lastInput, s) === key);
}

const firstBarButton = (): HTMLButtonElement | undefined =>
  [...fixBar.querySelectorAll<HTMLButtonElement>('button')].find((b) => !b.hidden);

/** Pasek bieżącego fragmentu: treść i przyciski dla znacznika albo fragmentu przywróconego. */
function syncBar(): void {
  const frag = barOpen && fixAvailable() ? currentFrag() : null;
  fixBar.hidden = !frag;
  outCard.classList.toggle('fix-open', !!frag);
  if (!frag) return;
  const { span, kept } = frag;
  const manual = span.source === 'manual';
  fixBarPos.textContent = `Fragment ${maskIdx + 1} z ${maskEls.length} · ${span.tokens.map(tokenLabel).join(', ')}`;
  fixBarWhat.textContent = kept ? 'przywrócone ręcznie' : manual ? 'zasłonięte ręcznie' : 'pod znacznikiem';
  fixBarVal.textContent = origOf(span.start, span.end);
  // W „Porównaniu” oryginał i tak stoi przekreślony obok znacznika.
  fixBarOrig.hidden = viewMode === 'compare';
  const n = span.tokens.length;
  fixBarGroup.hidden = kept || n < 2;
  fixBarGroup.textContent =
    n < 2
      ? ''
      : `Ten znacznik obejmuje ${n} ${plural(n, 'daną', 'dane', 'danych')}: ${span.tokens.map(tokenLabel).join(', ')}. ` +
        `„Zostaw jawne” odsłoni ${n === 2 ? 'obie' : 'wszystkie'}.`;
  // Na fragmencie zasłoniętym ręcznie „wszędzie” dotyczy tylko zasłonięć ręcznych tej samej danej.
  const same = kept ? [] : sameAs(span).filter((s) => !manual || s.source === 'manual');
  fixKeep.hidden = kept;
  fixKeep.textContent = manual ? 'Cofnij zasłonięcie' : 'Zostaw jawne';
  fixRemask.hidden = !kept;
  fixKeepAll.hidden = same.length < 2;
  fixBarForms.hidden = same.length < 2;
  if (same.length >= 2) {
    fixKeepAll.textContent = `${manual ? 'Cofnij zasłonięcie wszędzie' : 'Zostaw jawne wszędzie'} (${same.length})`;
    const forms = [...new Set(same.map((s) => origOf(s.start, s.end)))];
    fixBarForms.textContent = `Obejmie: ${forms.slice(0, 8).join(', ')}${forms.length > 8 ? '…' : ''}`;
  }
}

function openBar(focus: boolean): void {
  if (!fixAvailable()) return;
  barOpen = true;
  syncBar();
  if (focus && !fixBar.hidden) firstBarButton()?.focus();
}

function closeBar(returnFocus: boolean): void {
  barOpen = false;
  syncBar();
  if (returnFocus) (maskEls[maskIdx] ?? output).focus({ preventScroll: true });
}

const maskSpans = (): (Span | undefined)[] =>
  maskEls.map((el) => (el.dataset.s !== undefined ? corrected.spans[Number(el.dataset.s)] : corrected.kept[Number(el.dataset.k)]));

/** Indeks znacznika o zakresie `r`, a bez takiego: znacznika, który go obejmuje (-1, gdy żaden). */
function maskAt(r: { start: number; end: number }): number {
  const spans = maskSpans();
  const at = spans.findIndex((s) => s && s.start === r.start && s.end === r.end);
  return at >= 0 ? at : spans.findIndex((s) => s && s.start <= r.start && r.end <= s.end);
}

/**
 * Po każdej zmianie listy decyzji: wynik, chipy, karta publikacji, druk i stopka od nowa.
 * Bieżący fragment wybieramy po zakresie (`target`; domyślnie fragment z paska sprzed przeliczenia,
 * więc po addDecision wołający podaje go sam), a nie po numerze: korekta zmienia liczbę znaczników
 * i ten sam numer wskazywałby inną daną z gotowym „Zostaw jawne”.
 */
function correctionsChanged(msg: string, target?: { start: number; end: number } | null): void {
  const cur = target === undefined ? (currentFrag()?.span ?? null) : target;
  recomputeCorrections();
  const inBar = fixBar.contains(document.activeElement);
  const hadFocus = inBar || output.contains(document.activeElement);
  const top = output.scrollTop;
  const wasOpen = barOpen;
  renderOutput();
  output.scrollTop = top;
  const at = cur ? maskAt(cur) : -1;
  // Fragmentu już nie ma (cofnięte zasłonięcie): pasek się zamyka, zamiast przejść na inną daną.
  // Gdy w jego miejscu wrócił znacznik automatu (PESEL), bieżący jest ten znacznik, ale bez paska:
  // Enter nie może od razu odsłonić danej, o której urzędnik nie decydował.
  barOpen = wasOpen && at >= 0;
  const back = at < 0 && cur ? maskSpans().findIndex((s) => s && cur.start <= s.start && s.end <= cur.end) : -1;
  if (at >= 0 || back >= 0) goToMask(Math.max(at, back), false);
  renderFindings(lastFound, countTokens(corrected.spans));
  syncPublication();
  syncPrintOut();
  copyFlash.reset();
  syncFix();
  // Przycisk, który miał fokus, mógł zniknąć (np. „Zostaw jawne” zmienia się w „Zasłoń ponownie”).
  if (inBar && !fixBar.hidden) firstBarButton()?.focus({ preventScroll: true });
  else if (hadFocus && !output.contains(document.activeElement)) {
    (maskEls[maskIdx] ?? output).focus({ preventScroll: true });
  }
  if (msg) announce(msg);
}

/** Dopisuje decyzję i zwraca liczbę miejsc, które zmieniła. */
function addDecision(d: Decision): number {
  decisions.push(d);
  fixNote = '';
  recomputeCorrections();
  return corrected.effects[corrected.effects.length - 1] ?? 0;
}

/** Zapamiętuje listę decyzji przed czynnością urzędnika, do Ctrl+Z i „Cofnij ostatnią”. */
function remember(): void {
  undoSteps.push(decisions.slice());
  if (undoSteps.length > 200) undoSteps.shift();
}

function undoDecision(i: number, target?: { start: number; end: number }): void {
  if (!decisions[i]) return;
  remember();
  decisions.splice(i, 1);
  // „Cofnięto zasłonięcie” bez zasłonięcia, które cofało, nic już nie robi, a na liście
  // poprawek wyglądałoby na czynność, która dalej obowiązuje.
  if (lastSpans) {
    for (;;) {
      recomputeCorrections();
      const orphan = decisions.findIndex((d, k) => d.kind === 'unmask' && !corrected.effects[k]);
      if (orphan === -1) break;
      decisions.splice(orphan, 1);
    }
  }
  fixNote = '';
  correctionsChanged('Cofnięto ręczną poprawkę.', target);
}

/** Ctrl+Z w wyniku i „Cofnij ostatnią”: lista decyzji wraca do stanu sprzed ostatniej czynności. */
function undoLast(): void {
  const prev = undoSteps.pop();
  if (!prev) return;
  const restored = prev.length >= decisions.length;
  decisions = prev;
  fixNote = '';
  correctionsChanged(restored ? 'Przywrócono cofniętą ręczną poprawkę.' : 'Cofnięto ręczną poprawkę.');
}

/**
 * Źródło zmieniło się z lastInput na `next`: poprawki idą za tekstem (shiftDecisions). Zmiana pewna
 * (pisanie, usuwanie, wklejenie fragmentu w jednym miejscu) przesuwa poprawki i stos do Ctrl+Z
 * w wyniku. Zmiana niepewna zdejmuje decyzje odsłaniające i stos, a zasłonięcia zostają tam, gdzie
 * ich tekst dalej stoi. Natywne cofanie do dokładnie tego tekstu, z którego wyszła poprzednia
 * niepewna zmiana, przywraca jego poprawki.
 */
function followSource(next: string): void {
  const base = lastInput;
  const change = sourceChange;
  sourceChange = 'none';
  if (change === 'replaced' || next === base) return;
  if (change === 'none' && !isOtherDocument(base, next)) {
    undoSteps = undoSteps.map((list) => shiftDecisions(base, next, list).decisions);
    const moved = shiftDecisions(base, next, decisions);
    decisions = moved.decisions;
    if (moved.dropped) {
      fixNote =
        `Po zmianie tekstu źródłowego odrzucono ${moved.dropped} ` +
        `${plural(moved.dropped, 'ręczną poprawkę', 'ręczne poprawki', 'ręcznych poprawek')}.`;
      announce(fixNote);
    }
    return;
  }
  const back = change === 'history' && parked?.text === next ? parked.decisions.slice() : null;
  // Puste pole nie ma poprawek, więc tekst sprzed opróżnienia dalej czeka na Ctrl+Z.
  if (decisions.length) parked = { text: base, decisions: decisions.slice() };
  else if (base.trim()) parked = null;
  undoSteps = [];
  if (back) {
    decisions = back;
    fixNote = 'Tekst źródłowy wrócił do wcześniejszej wersji razem z jej ręcznymi poprawkami.';
    announce(fixNote);
    return;
  }
  const moved = shiftDecisions(base, next, decisions, false);
  decisions = moved.decisions;
  const masks = moved.dropped - moved.reveals;
  const parts = [];
  if (moved.reveals)
    parts.push(
      `Zmieniono pismo: cofnięto ${moved.reveals} ` +
        `${plural(moved.reveals, 'decyzję', 'decyzje', 'decyzji')} o pozostawieniu jawnych danych.`,
    );
  if (masks)
    parts.push(
      `Odrzucono ${masks} ${plural(masks, 'ręczne zasłonięcie', 'ręczne zasłonięcia', 'ręcznych zasłonięć')}, ` +
        `${plural(masks, 'którego', 'których', 'których')} tekstu nie ma już w tym miejscu.`,
    );
  fixNote = next.trim() ? parts.join(' ') : '';
  if (fixNote) announce(fixNote);
}

/** Wyczyść, Przykład, plik i nowe pismo: poprawki dotyczyły poprzedniego tekstu. */
function clearCorrections(): void {
  decisions = [];
  undoSteps = [];
  fixNote = '';
  barOpen = false;
  closeForm(false);
  fixList.hidden = true;
  fixShow.setAttribute('aria-expanded', 'false');
  fixShow.textContent = 'Pokaż';
  // Ukryte elementy też trzymały fragmenty pisma (wartość spod znacznika, wpisy listy), a „Wyczyść”
  // obiecuje usunąć tekst: po nim w DOM nie zostaje nic z poprzedniego pisma.
  for (const el of [fixBarPos, fixBarVal, fixBarGroup, fixBarForms, fixFormVal, fixAllN, fixSum, fixNoteEl]) el.textContent = '';
  fixList.replaceChildren();
  formText = '';
  formRanges = [];
}

fixKeep.addEventListener('click', () => {
  const frag = currentFrag();
  if (!frag || frag.kept) return;
  const { span } = frag;
  if (span.source === 'manual') {
    // „Cofnij zasłonięcie” wraca do stanu sprzed ręcznej poprawki: dane zasłonięte przez automat
    // zostają zasłonięte. Poprawkę „tutaj” albo „wszędzie” z jednym miejscem zdejmuje z listy,
    // a z kilku miejsc cofa tylko to jedno.
    const by = corrected.by[Number(maskEls[maskIdx]?.dataset.s)] ?? -1;
    const d = decisions[by];
    if (d && (d.scope === 'here' || corrected.effects[by] === 1)) undoDecision(by, span);
    else {
      remember();
      addDecision({ kind: 'unmask', scope: 'here', start: span.start, end: span.end });
      correctionsChanged(`Cofnięto zasłonięcie w tym miejscu.`, span);
    }
    return;
  }
  remember();
  addDecision({ kind: 'keep', scope: 'here', start: span.start, end: span.end });
  correctionsChanged(`Zostawiono jawne: ${fragmentsWord(span.tokens.length)}.`, span);
});
fixKeepAll.addEventListener('click', () => {
  const frag = currentFrag();
  if (!frag || frag.kept) return;
  const { span } = frag;
  const label = origOf(span.start, span.end);
  const same = sameAs(span).filter((s) => span.source !== 'manual' || s.source === 'manual');
  // Miejsca z paska („Obejmie: …”) z tej chwili: osoba dopisana później nie wyjdzie jawna po cichu.
  const ranges = same.map((s): [number, number] => [s.start, s.end]);
  if (span.source === 'manual') {
    // Na fragmencie zasłoniętym ręcznie „wszędzie” cofa te zasłonięcia, jak „Cofnij zasłonięcie”
    // w każdym miejscu: PESEL zasłonięty przez automat i wchłonięty przez zaznaczenie zostaje
    // zasłonięty. Gdy wszystkie miejsca pochodzą z jednej poprawki, wystarczy zdjąć ją z listy.
    const bys = new Set(same.map((s) => corrected.by[corrected.spans.indexOf(s)] ?? -1));
    const [by] = [...bys];
    if (bys.size === 1 && by >= 0 && corrected.effects[by] === same.length) {
      undoDecision(by, span);
      return;
    }
    remember();
    const n = addDecision({ kind: 'unmask', scope: 'same', label, ranges });
    correctionsChanged(`Cofnięto zasłonięcie: ${placesWord(n)}.`, span);
    return;
  }
  remember();
  const n = addDecision({ kind: 'keep', scope: 'same', label, ranges });
  correctionsChanged(`Zostawiono jawne: ${fragmentsWord(n)}.`, span);
});
fixRemask.addEventListener('click', () => {
  const frag = currentFrag();
  if (!frag?.kept) return;
  const { start, end } = frag.span;
  // Tuż po „Zostaw jawne” tego samego miejsca wystarczy zdjąć tamtą decyzję.
  const last = decisions[decisions.length - 1];
  remember();
  if (last?.kind === 'keep' && last.scope === 'here' && last.start === start && last.end === end) decisions.pop();
  else addDecision({ kind: 'mask', scope: 'here', start, end, token: frag.span.tokens[0] });
  fixNote = '';
  correctionsChanged(`Zasłonięto ponownie: ${fragmentsWord(1)}.`, frag.span);
});
fixBarClose.addEventListener('click', () => closeBar(true));
fixBar.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  closeBar(true);
});

/* „Zasłoń zaznaczenie”: zaznaczenie w wyniku (Range z data-o i data-s) albo w polu źródła. */

/** Pozycja punktu zakresu w tekście elementu z data-o albo znacznika. */
function offsetIn(el: HTMLElement, node: Node, off: number): number {
  const len = el.textContent?.length ?? 0;
  if (node.nodeType === Node.TEXT_NODE) return Math.min(off, len);
  return off === 0 ? 0 : len;
}

/**
 * Zaznaczenie w wyniku przeliczone na pozycje oryginału. Elementy tekstu (data-o) dają
 * dokładne pozycje, znacznik (data-s) cały swój zakres. Liczymy po elementach, które zaznaczenie
 * przecina, a nie po samych punktach granicznych: Firefox stawia je na granicach elementów
 * (wiersz, znacznik) inaczej niż Chromium.
 */
function rangeToOriginal(range: Range): { start: number; end: number } | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const el of output.querySelectorAll<HTMLElement>('[data-o], mark.pii[data-s]')) {
    if (!range.intersectsNode(el)) continue;
    const len = el.textContent?.length ?? 0;
    const a = el.contains(range.startContainer) ? offsetIn(el, range.startContainer, range.startOffset) : 0;
    const b = el.contains(range.endContainer) ? offsetIn(el, range.endContainer, range.endOffset) : len;
    if (b <= a) continue; // zaznaczenie tylko dotyka elementu na jego brzegu
    if (el.dataset.s !== undefined) {
      const s = corrected.spans[Number(el.dataset.s)];
      if (!s) continue;
      start = Math.min(start, s.start);
      end = Math.max(end, s.end);
    } else {
      const o = Number(el.dataset.o);
      start = Math.min(start, o + a);
      end = Math.max(end, o + b);
    }
  }
  return start < end ? { start, end } : null;
}

function syncSelButtons(): void {
  const on = fixAvailable();
  fixSelSrc.hidden = !on;
  fixSelOut.hidden = !on;
  fixSelSrc.disabled = !on || input.selectionStart === input.selectionEnd;
  fixSelOut.disabled = !on || viewMode === 'compare' || !outRange;
}

document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  const r = sel?.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
  outRange = r && output.contains(r.commonAncestorContainer) ? r.cloneRange() : null;
  syncSelButtons();
});
// Firefox nie zawsze zgłasza selectionchange dla zaznaczenia w polu tekstowym.
for (const ev of ['select', 'keyup', 'mouseup', 'input'] as const) input.addEventListener(ev, syncSelButtons);
// Klik w przycisk nie może zgubić zaznaczenia w wyniku (część przeglądarek czyści je przy mousedown).
fixSelOut.addEventListener('mousedown', (e) => e.preventDefault());

function syncFormCount(): void {
  const n = findOccurrences(lastInput, formText, fixToken.value).length;
  fixAllN.textContent = n ? `(${placesWord(n)})` : '';
}

function openForm(from: 'src' | 'out'): void {
  flushPendingUpdate();
  if (!fixAvailable()) return;
  closeBar(false);
  const raw =
    from === 'src'
      ? { start: input.selectionStart, end: input.selectionEnd }
      : outRange
        ? rangeToOriginal(outRange)
        : null;
  const snapped = raw && snapSelection(lastInput, raw.start, raw.end, [...corrected.spans, ...corrected.kept]);
  if (!snapped) {
    announce('Najpierw zaznacz fragment tekstu.');
    return;
  }
  formRanges = lineRanges(lastInput, snapped.start, snapped.end);
  formInput = lastInput;
  formAt = snapped;
  formText = lastInput.slice(snapped.start, snapped.end);
  const multi = formRanges.length > 1;
  fixFormVal.textContent = formText.replace(/\s+/g, ' ').trim();
  fixToken.value = defaultToken(formText);
  // Tekst z kilku wierszy zasłaniamy tylko w zaznaczonym miejscu, wiersz po wierszu.
  fixAll.checked = !multi;
  fixAll.disabled = multi;
  syncFormCount();
  formReturn = from === 'src' ? fixSelSrc : fixSelOut;
  if (from === 'src') srcToolbar.after(fixForm);
  else fixBar.after(fixForm);
  fixForm.hidden = false;
  fixToken.focus();
}

function closeForm(returnFocus: boolean): void {
  if (fixForm.hidden) return;
  fixForm.hidden = true;
  if (!returnFocus) return;
  const usable = formReturn && !formReturn.hidden && !(formReturn as HTMLButtonElement).disabled;
  const back = usable ? (formReturn as HTMLElement) : formReturn === fixSelSrc ? input : output;
  back.focus({ preventScroll: true });
}

fixSelSrc.addEventListener('click', () => openForm('src'));
fixSelOut.addEventListener('click', () => openForm('out'));
fixToken.addEventListener('change', syncFormCount);
fixCancel.addEventListener('click', () => closeForm(true));
fixForm.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  closeForm(true);
});
fixApply.addEventListener('click', () => {
  flushPendingUpdate(); // edycja źródła sprzed chwili zamyka wiersz (renderResult)
  if (fixForm.hidden || !fixAvailable() || lastInput !== formInput) return;
  const token = fixToken.value;
  let n = 0;
  remember();
  if (fixAll.checked && !fixAll.disabled) n = addDecision({ kind: 'mask', scope: 'all', text: formText, token });
  else for (const [start, end] of formRanges) n += addDecision({ kind: 'mask', scope: 'here', start, end, token });
  // Z wyniku fokus idzie na nowy znacznik: przycisk „Zasłoń zaznaczenie” zaraz się wyłączy.
  const fromOut = formReturn === fixSelOut;
  if (fromOut) getSelection()?.removeAllRanges();
  closeForm(!fromOut);
  correctionsChanged(n ? `Zasłonięto ${placesWord(n)}.` : 'Ten fragment był już zasłonięty.', formAt);
  if (fromOut) (maskEls[maskIdx] ?? output).focus({ preventScroll: true });
});

/** Wpis listy poprawek: co zrobiono, z wartością (tylko na ekranie) i liczbą miejsc. */
function decisionText(d: Decision, n: number): string {
  const where = `, ${placesWord(n)}`;
  if (d.kind === 'unmask') {
    return d.scope === 'here'
      ? `Cofnięto zasłonięcie w jednym miejscu: ${origOf(d.start, d.end)}`
      : `Cofnięto zasłonięcie wszędzie: ${d.label}${where}`;
  }
  if (d.kind === 'keep') {
    return d.scope === 'here'
      ? `Zostawiono jawne: ${origOf(d.start, d.end)}`
      : `Zostawiono jawne wszędzie: ${d.label}${where}`;
  }
  return d.scope === 'here'
    ? `Zasłonięto jako [${d.token}]: ${origOf(d.start, d.end)}`
    : `Zasłonięto jako [${d.token}] wszędzie: ${d.text.replace(/\s+/g, ' ').trim()}${where}`;
}

function renderFixList(): void {
  fixList.replaceChildren(
    ...decisions.map((d, i) => {
      const li = document.createElement('li');
      const t = document.createElement('span');
      t.textContent = decisionText(d, corrected.effects[i] ?? 0);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'linklike';
      b.textContent = 'Cofnij';
      b.dataset.i = String(i);
      b.setAttribute('aria-label', `Cofnij: ${t.textContent}`);
      li.append(t, ' ', b);
      return li;
    }),
  );
}

/** Stopka poprawek, przyciski zaznaczenia, komunikat o długim tekście i pasek fragmentu. */
function syncFix(): void {
  const has = decisions.length > 0 && !!lastRedacted;
  const c = correctionCounts(corrected);
  const anyMask = decisions.some((d) => d.kind === 'mask');
  const blocked = exportBlocked();
  fixSum.textContent = !has
    ? ''
    : lastSpans
      ? `Ręczne poprawki: przywrócono ${c.kept}, zasłonięto ${c.masked}`
      : anyMask
        ? 'Ręcznych zasłonięć nie da się nałożyć na ten tekst, więc kopiowanie, zapis i druk są wstrzymane. ' +
          'Skróć tekst albo usuń poprawki'
        : 'Ręczne poprawki są wyłączone dla tego tekstu, wynik pokazuje to, co zasłonił automat.';
  fixFootActs.hidden = !has;
  if (lastRedacted) setResultActions(!blocked);
  // „Kopiowanie, zapis plików i druk działają” nie jest wtedy prawdą.
  spansNote.hidden = !lastRedacted || !!lastSpans || isTooBig() || blocked;
  fixNoteEl.textContent = fixNote;
  fixNoteEl.hidden = !fixNote;
  fixFoot.hidden = !lastRedacted || (!has && !fixNote);
  if (!has) {
    fixList.hidden = true;
    fixShow.setAttribute('aria-expanded', 'false');
    fixShow.textContent = 'Pokaż';
  }
  if (!fixList.hidden) renderFixList();
  fixOff.hidden = !(lastRedacted && isTooBig());
  if (!fixAvailable()) {
    barOpen = false;
    closeForm(false);
  }
  syncSelButtons();
  syncBar();
}

fixShow.addEventListener('click', () => {
  const open = fixList.hidden;
  fixList.hidden = !open;
  fixShow.setAttribute('aria-expanded', String(open));
  fixShow.textContent = open ? 'Ukryj' : 'Pokaż';
  if (open) renderFixList();
});
$<HTMLButtonElement>('fix-undo').addEventListener('click', undoLast);
$<HTMLButtonElement>('fix-clear').addEventListener('click', () => {
  remember();
  decisions = [];
  fixNote = '';
  correctionsChanged('Usunięto wszystkie ręczne poprawki.');
  output.focus({ preventScroll: true });
});
fixList.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-i]');
  if (!b) return;
  const i = Number(b.dataset.i);
  undoDecision(i);
  // Fokus na sąsiedni wpis listy albo, gdy lista się skończyła, na wynik.
  const next = fixList.querySelectorAll<HTMLButtonElement>('button[data-i]')[Math.min(i, decisions.length - 1)];
  (next ?? output).focus({ preventScroll: true });
});

/* ── Główny przepływ ── */

function setResultActions(on: boolean): void {
  copyBtn.disabled = !on;
  downloadBtn.disabled = !on;
  downloadDocxBtn.disabled = !on;
  printBtn.disabled = !on;
}

/** Sam wynik, bez dołączonej adnotacji: .docx i wydruk stawiają ją osobno, na nowej stronie. */
const resultText = (): string =>
  finalText({ redacted: lastRedacted, original: lastInput, spans: lastSpans, decisions });
/** Tekst dla „Kopiuj” i „Pobierz .txt”: wynik, a po „Dołącz adnotację” także adnotacja (output.ts). */
const outputText = (): string =>
  finalText({ redacted: lastRedacted, original: lastInput, spans: lastSpans, decisions, annex: annexText() });
/** Treść pobieranego pliku. Rejestr .csv dostaje sam wynik: wiersze adnotacji z przecinkami Excel
 * dokleiłby do arkusza jako rekordy. */
const downloadText = (): string => (lastFileExt === 'csv' ? resultText() : outputText());

const PRINT_EMPTY = 'Brak wyniku do wydruku. Wklej tekst w pole „Tekst źródłowy”.';
const PRINT_BLOCKED = 'Wydruk wstrzymany: ręcznych zasłonięć nie da się nałożyć na ten tekst. Skróć tekst albo usuń poprawki.';

// Co idzie na papier: wynik albo, na czas „Drukuj protokół”, sam protokół. Tryb wraca do wyniku
// po wydruku (afterprint), także anulowanym, i przy przycisku „Drukuj lub zapisz PDF”.
let printMode: 'result' | 'protocol' = 'result';
let printProtocol = '';

/**
 * Treść wydruku: wynik i dołączona adnotacja albo sam protokół. Pole źródła i przekreślone
 * oryginały (.orig) nie mogą tu trafić żadną drogą: tylko finalText (output.ts) i protokół
 * z metadanych (publikacja.ts).
 */
function printContent(): { main: string; annex: string } {
  if (printMode === 'protocol') return { main: printProtocol, annex: '' };
  if (!lastRedacted) return { main: PRINT_EMPTY, annex: '' };
  if (exportBlocked()) return { main: PRINT_BLOCKED, annex: '' };
  return { main: resultText(), annex: annexText() };
}

/**
 * Kontener wydruku (#print-out) dostaje cały wynik przy każdym przeliczeniu, niezależnie od
 * widoku i od HIGHLIGHT_LIMIT, a #print-annex adnotację, którą arkusz druku stawia od nowej
 * strony. Tylko textContent: tekst wyniku pochodzi od użytkownika.
 */
function syncPrintOut(): void {
  const print = printContent();
  printOut.textContent = print.main;
  printAnnex.textContent = print.annex;
}

function setFileExt(ext: string): void {
  lastFileExt = ext;
  downloadLabel.textContent = ext === 'csv' ? '.csv' : '.txt'; // nazwa: „Pobierz .csv” (z podpisem grupy)
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
  // Przegląd dotyczy dokładnie tego wyniku: po każdej zmianie tekstu albo wyniku liczy się od zera.
  if (redacted !== lastRedacted || input.value !== lastInput) reviewed.clear();
  // Edycja źródła: poprawki idą za tekstem albo odpadają (followSource).
  // Otwarty wiersz „Zasłoń” trzyma pozycje w starym tekście: po edycji zasłoniłby co innego.
  if (!fixForm.hidden && input.value !== lastInput) {
    closeForm(false);
    announce('Tekst źródłowy się zmienił. Zaznacz fragment jeszcze raz.');
  }
  followSource(input.value);
  lastRedacted = redacted;
  lastInput = input.value;
  lastFound = found;
  // Ponad HIGHLIGHT_LIMIT nie ma podświetleń ani porównania: zakresy kosztowałyby czas przy każdej edycji.
  const aligned = isTooBig() ? null : alignSpans(lastInput, redacted);
  lastSpans = aligned?.spans ?? null;
  recomputeCorrections();
  keptMasks = aligned?.kept ?? 0; // z zakresami renderOutput go nie zmienia
  // Przy długim tekście i tak nie ma podświetleń ani porównania, więc komunikat nic by nie dodał.
  spansNote.hidden = !!lastSpans || isTooBig();
  setResultActions(true);
  renderOutput();
  renderFindings(found, lastSpans && countTokens(corrected.spans));
  // Po renderze: wzór adnotacji liczy z zakresów, a dołączona adnotacja idzie do wydruku.
  syncPublication();
  syncPrintOut();
  syncFix();
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
    followSource(''); // poprawki pisma czekają w `parked` na Ctrl+Z w polu
    lastInput = '';
    lastSpans = null;
    lastFound = [];
    reviewed.clear();
    spansNote.hidden = true;
    recomputeCorrections();
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
    resetDocumentPublication(); // puste pole: następny tekst to już inne pismo
    syncPublication();
    syncFix();
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

// Tekst wstawiony w puste pole albo w miejsce całego tekstu (wklejenie, upuszczenie, pisanie po
// zaznaczeniu wszystkiego) to nowe pismo, tak samo jak opróżnione pole: karta „Adnotacja
// i protokół” nie może przenieść do niego znaku sprawy, ręcznej adnotacji ani „Dołącz”.
// Natywne cofanie i ponawianie (Ctrl+Z w polu) też może podmienić całe pismo: Firefox trzyma osobny
// stos cofania dla pola i wraca jednym ruchem do pisma sprzed wklejenia, a karta wypełniona dla
// nowego pisma przeszłaby wtedy na poprzednie. Tekst sprzed takiej zmiany porównuje isOtherDocument.
let newDocument = false;
let historyBefore: string | null = null;
input.addEventListener('beforeinput', (e) => {
  const whole = !input.value.trim() || (input.selectionStart === 0 && input.selectionEnd === input.value.length);
  newDocument = whole && e.inputType.startsWith('insert');
  historyBefore = e.inputType.startsWith('history') ? input.value : null;
  // Poprawki odnoszą się do lastInput, a followSource porównuje go z polem przy przeliczeniu.
  // Zaległą zmianę przeliczamy przed następną, żeby każda szła osobno: niepewna (cofanie,
  // wklejenie w miejsce całości) nie zlewa się z pisaniem, a dwie edycje w różnych miejscach nie
  // dają jednego dużego zmienionego fragmentu, który zdjąłby poprawki między nimi. Przy długim
  // tekście z poprawkami nie przeliczamy co klawisz: zlany fragment najwyżej zdejmie więcej.
  const fast = (decisions.length > 0 || undoSteps.length > 0) && lastUpdateMs < SLOW_UPDATE_MS;
  if (updatePending && (whole || historyBefore !== null || sourceChange !== 'none' || fast)) update();
});

input.addEventListener('input', (e) => {
  // Natywne cofanie i ponawianie w polu oraz wklejenie w miejsce całości to zmiany, których nie da
  // się pewnie zmapować przesunięciem: followSource zdejmie przy nich decyzje odsłaniające.
  const history = (e as InputEvent).inputType?.startsWith('history') ?? false;
  if (history) sourceChange = 'history';
  else if (newDocument && sourceChange === 'none') sourceChange = 'unsure';
  // Karta zeruje się przy nowym piśmie i przy cofaniu, które podmienia większość tekstu.
  if (newDocument || !input.value.trim()) resetDocumentPublication();
  else if (historyBefore !== null && isOtherDocument(historyBefore, input.value)) resetDocumentPublication();
  newDocument = false;
  historyBefore = null;
  // Własna edycja zamyka błąd, bo już nie dotyczy, i „Cofnij”, bo po edycji przywróciłby tekst
  // sprzed niej i skasował to, co właśnie wpisano. Dopisek o pliku (np. o nagłówkach i stopkach,
  // których Parawan nie czyta) zostaje do zamknięcia: te części dalej są w oryginale, a fokus po
  // wczytaniu stoi w polu, więc pierwszy klawisz kasowałby jedyne ostrzeżenie. Puste pole zamyka
  // także dopisek: z pliku nic już w nim nie ma, a dopisek wisiałby nad nowo wpisanym tekstem.
  // Pasek o zapamiętanym wyłączeniu zostaje: urzędnik wkleja pismo zaraz po otwarciu pliku
  // (fokus stoi w polu), a pierwszy Ctrl+V nie może zamknąć ostrzeżenia, którego nie przeczytał.
  clearError();
  if (storedOffNote) {
    /* zostaje do zamknięcia, „Włącz wszystko” albo następnego komunikatu */
  } else if (!input.value.trim()) dismissNote();
  else if (undoText !== null || !noteInfo) expireUndo();
  updateSrcMeta(input.value);
  updatePending = true;
  clearTimeout(updateTimer);
  // Pauza dopasowana do zmierzonego kosztu: krótki tekst po 140 ms, długi dopiero po przerwie
  // w pisaniu (inaczej każda pauza między słowami zamrażałaby kartę na kilka sekund).
  updateTimer = setTimeout(updateNow, Math.min(2000, Math.max(140, lastUpdateMs * 1.5)));
  // Cofanie przeliczamy od razu: powrót do tekstu z `parked` liczy się tylko przy tym samym tekście,
  // a wynik nie może wisieć na starym tekście, gdy poprawki już się zmieniły.
  if (history) update();
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
// Ręczne poprawki tekstu z undoText: wracają z nim i giną razem z nim.
let undoDecisions: Decision[] = [];
// Dopisek, który należał do poprzedniego tekstu: „Cofnij” przywraca go razem z nim, bo nagłówki
// i komentarze przywróconego DOCX dalej są w oryginale.
let undoInfo = '';
let noteInfo = ''; // dopisek bez cofania (np. o kodowaniu pliku), zostaje po wygaśnięciu „Cofnij”
const UNDO_MS = 20_000;
let undoTimer: ReturnType<typeof setTimeout> | undefined;

/** Pokaż pasek pod narzędziami: `msg` z przyciskiem „Cofnij” (gdy jest `prev`) i dopisek `info`. */
function showNote(msg: string, prev: string | null, info = '', reveal = true): void {
  clearTimeout(undoTimer);
  undoText = prev;
  if (prev === null) undoDecisions = [];
  noteInfo = info;
  // Dopisek w osobnym wierszu (white-space: pre-line w style.css): ostrzeżenie o pliku nie ginie
  // w jednym akapicie z „Zastąpiono tekst treścią pliku.”.
  const text = [msg, info].filter(Boolean).join('\n');
  appNoteText.textContent = text;
  appNoteUndo.hidden = prev === null;
  appNoteMaskOn.hidden = true;
  storedOffNote = false;
  appNote.classList.remove('is-warn');
  appNote.hidden = false;
  appNoteStatus.textContent = text; // ogłoszenie dla czytnika ekranu
  if (reveal) revealIfOffscreen(appNote);
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
  undoDecisions = [];
  appNoteUndo.hidden = true;
  appNoteText.textContent = noteInfo;
  if (hadFocus) appNoteClose.focus({ preventScroll: true });
}

function dismissNote(): void {
  clearTimeout(undoTimer);
  // przyciski znikają razem z paskiem, więc fokus z nich wraca do pola źródła
  const hadFocus = appNote.contains(document.activeElement);
  undoText = null;
  undoDecisions = [];
  noteInfo = '';
  storedOffNote = false;
  appNoteMaskOn.hidden = true;
  appNote.classList.remove('is-warn');
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
  if (prev !== text) {
    // Natywne Ctrl+Z nie sięga sprzed podmiany wartości, więc poprawki czekają tylko na „Cofnij”
    // na pasku i giną razem z nim.
    flushPendingUpdate();
    undoDecisions = prev.trim() ? decisions.slice() : [];
    parked = null;
    clearCorrections();
    sourceChange = 'replaced';
    resetDocumentPublication();
  }
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
  // Przywrócone pismo to inne pismo niż bieżące (jak w replaceSource): karta wypełniona dla
  // cofanego tekstu nie może przejść na poprzedni.
  const back = undoDecisions;
  if (input.value !== undoText) {
    flushPendingUpdate();
    parked = null;
    clearCorrections();
    sourceChange = 'replaced';
    resetDocumentPublication();
    // Pismo wraca razem ze swoimi ręcznymi poprawkami (np. zasłoniętą ręcznie księgą wieczystą):
    // to dokładnie ten tekst, na którym je podjęto.
    decisions = back;
  }
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
  clearPublication();
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
  if (!lastRedacted || exportBlocked()) return;
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

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/* Po pierwszym pobraniu w sesji, gdy źródłem był wczytany DOCX albo PDF: do BIP ma iść nowy plik.
   Oryginał poprawiony wklejonym wynikiem dalej ma we właściwościach autora, a często komentarze
   i historię zmian (tak wyciekło nazwisko autorki zarządzenia z poprawkami). */
const PUBLISH_NOTE =
  'Do publikacji użyj nowego pliku. Oryginał ma we właściwościach autora, a często także ' +
  'komentarze i historię zmian. Przy pierwszym zapisie w Wordzie sprawdź Plik › Informacje › Autor.';
let publishNoteShown = false;

// Bez przewijania do paska: w jednej kolumnie (telefon, powiększenie 150%) stoi on w karcie
// źródła, setki pikseli nad przyciskiem pobierania, i skok zabierałby fokus z ekranu. Czytnik
// dostaje zdanie przez #app-note-status, a pasek czeka nad tekstem źródłowym.
function notePublishNewFile(): void {
  if (publishNoteShown || (lastFileExt !== 'docx' && lastFileExt !== 'pdf')) return;
  publishNoteShown = true;
  if (appNote.hidden) {
    showNote('', null, PUBLISH_NOTE, false);
    return;
  }
  // Pasek już stoi (dopisek o częściach DOCX, „Cofnij”): zdanie dochodzi w nowym wierszu,
  // a cofanie i jego czas zostają bez zmian.
  noteInfo = [noteInfo, PUBLISH_NOTE].filter(Boolean).join('\n');
  appNoteText.textContent = [appNoteText.textContent, PUBLISH_NOTE].filter(Boolean).join('\n');
  appNoteStatus.textContent = PUBLISH_NOTE;
}

downloadBtn.addEventListener('click', () => {
  flushPendingUpdate();
  if (!lastRedacted || exportBlocked()) return;
  // Nazwa ze znacznikiem czasu, BOM i windowsowe końce wierszy: output.ts (downloadFor).
  const file = downloadFor(downloadText(), lastFileExt, new Date());
  saveFile(new Blob([file.content], { type: file.type }), file.name);
  notePublishNewFile();
});

// Nowy dokument Worda z samego wyniku (docx-write.ts). Nazwa jak przy .txt, nigdy z nazwy
// wczytanego pliku.
downloadDocxBtn.addEventListener('click', () => {
  flushPendingUpdate();
  if (!lastRedacted || exportBlocked()) return;
  // Dołączona adnotacja w dodatku po podziale strony (docx-write.ts), nie w ciągu wyniku.
  const annex = annexText();
  const docx = buildDocx(resultText(), { appendix: annex ? [annex] : [] });
  saveFile(new Blob([docx], { type: DOCX_MIME }), downloadName(new Date(), 'docx'));
  notePublishNewFile();
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
  // Przy protokole nazwa pliku PDF mówi, że to protokół, a nie wynik.
  document.title = printMode === 'protocol' ? protocolTitle(new Date()) : printTitle(new Date());
});
addEventListener('afterprint', () => {
  if (printMode === 'protocol') {
    printMode = 'result';
    syncPrintOut();
  }
  if (titleBeforePrint === null) return;
  document.title = titleBeforePrint;
  titleBeforePrint = null;
});

printBtn.addEventListener('click', () => {
  flushPendingUpdate();
  if (!lastRedacted || exportBlocked()) return;
  printMode = 'result';
  syncPrintOut();
  window.print();
});

/* ── Adnotacja o wyłączeniu jawności, protokół i lista „Przed publikacją” ──
   Teksty składa publikacja.ts z nazw typów i liczb; tu tylko pola karty i akcje. Pola żyją
   w pamięci karty i czyszczą je „Wyczyść” i „Przykład”. Organ i osoba (imię i nazwisko
   pracownika) trafiają do localStorage wyłącznie po zaznaczeniu „Pamiętaj” (storage.ts, reguła e). */
const pubCard = $<HTMLDetailsElement>('publikacja');
const pubOrgan = $<HTMLInputElement>('pub-organ');
const pubOsoba = $<HTMLInputElement>('pub-osoba');
const pubZatw = $<HTMLInputElement>('pub-zatw');
const pubBasis = $<HTMLSelectElement>('pub-podstawa');
const pubOther = $<HTMLInputElement>('pub-inna');
const pubOtherLabel = $<HTMLLabelElement>('pub-inna-l');
const pubDate = $<HTMLInputElement>('pub-data');
const pubCounts = $<HTMLInputElement>('pub-counts');
const pubRemember = $<HTMLInputElement>('pub-remember');
const pubAnn = $<HTMLTextAreaElement>('pub-adnotacja');
const pubAnnState = $<HTMLSpanElement>('pub-ann-state');
const pubResetAnn = $<HTMLButtonElement>('pub-reset-ann');
const pubAppend = $<HTMLInputElement>('pub-append');
const pubZnak = $<HTMLInputElement>('pub-znak');
const pubSha = $<HTMLInputElement>('pub-sha');
const pubSeenBox = $<HTMLInputElement>('pub-chk-seen');
const pubSeenN = $<HTMLSpanElement>('pub-chk-seen-n');
const pubChecks = [...pubCard.querySelectorAll<HTMLInputElement>('.pub-check input[type="checkbox"]')];

for (const b of BASES) pubBasis.add(new Option(b.label, b.key));

const ANN_AUTO = pubAnnState.textContent ?? '';
const ANN_EDITED = 'poprawiony ręcznie, pola już go nie zmieniają';
// true: urzędnik poprawił treść adnotacji, więc zmiana pól jej nie nadpisuje („Przywróć wzór”).
let annEdited = false;
// Stan „przejrzano wszystkie” z ostatniego odświeżenia: pierwsza pozycja listy zmienia się sama
// tylko przy zmianie tego stanu, więc ręczne odznaczenie zostaje do następnej zmiany.
let allReviewed = false;

function pubFields(): PublicationFields {
  return {
    organ: pubOrgan.value,
    osoba: pubOsoba.value,
    zatwierdzil: pubZatw.value,
    basis: pubBasis.value,
    basisOther: pubOther.value,
    data: pubDate.value,
    withCounts: pubCounts.checked,
  };
}

/** Liczby po tokenie: z zakresów, a bez nich z liczników rdzenia. */
function currentCounts(): Map<string, number> {
  return lastSpans ? countByToken(corrected.spans) : countFromFindings(lastFound);
}

/** Adnotacja dopisywana do wyniku; pusty napis, gdy „Dołącz” nie jest zaznaczone. */
function annexText(): string {
  return pubAppend.checked && lastRedacted ? pubAnn.value.trim() : '';
}

function refreshAnnotation(): void {
  if (!annEdited) pubAnn.value = buildAnnotation(currentCounts(), pubFields());
  pubResetAnn.hidden = !annEdited;
  pubAnnState.textContent = annEdited ? ANN_EDITED : ANN_AUTO;
}

/** Licznik „przejrzano N z M” przy ‹ › i pierwsza pozycja listy „Przed publikacją”. */
function syncReview(): void {
  const n = maskEls.length;
  const seen = Math.min(reviewed.size, n);
  // Przy podpowiedzi pod nagłówkiem wyniku: w pasku nad wynikiem nie ma już miejsca w jednym rzędzie.
  // „jawne: 2”: fragmenty przywrócone ręcznie, widoczne obok postępu przeglądu.
  const keptN = maskEls.filter((el) => el.matches('mark.pii-kept')).length;
  maskSeen.textContent = `${keptN ? ` · jawne: ${keptN}` : ''} · przejrzano ${seen} z ${n}`;
  maskSeen.hidden = n === 0;
  maskSeen.classList.toggle('is-done', n > 0 && seen === n);
  pubSeenN.textContent = `${seen} z ${n}`;
  const all = n > 0 && seen === n;
  if (all !== allReviewed) {
    allReviewed = all;
    pubSeenBox.checked = all;
    if (all) announce(`Przejrzano wszystkie zasłonięte fragmenty: ${n} z ${n}.`);
  }
}

/** Po każdym przeliczeniu: karta przy niepustym wyniku, świeży wzór i postęp przeglądu. */
function syncPublication(): void {
  pubCard.hidden = !lastRedacted;
  refreshAnnotation();
  syncReview();
}

/** Zmiana adnotacji przy zaznaczonym „Dołącz”: inny tekst w „Kopiuj”, w pliku i w druku. */
function annexChanged(): void {
  if (!pubAppend.checked) return;
  copyFlash.reset();
  syncPrintOut();
}

const REMEMBER_MAX = 200;

/**
 * Zapamiętany organ i osoba. Wartość mógł zapisać obcy plik, więc tylko krótkie napisy. Znacznika
 * „Pamiętaj” nie da się odróżnić od podrobionego (Chrome i Edge dzielą localStorage między plikami
 * z dysku); to ryzyko opisuje docs/wydanie/DLA-IOD-I-IT.txt, a zaznaczone pole widać w karcie.
 */
function readRemembered(): { organ: string; osoba: string } | null {
  try {
    const v = JSON.parse(storageGet('adnotacja') ?? 'null') as unknown;
    if (!v || typeof v !== 'object') return null;
    const { organ, osoba, pamietaj } = v as Record<string, unknown>;
    const str = (x: unknown): string => (typeof x === 'string' ? x.slice(0, REMEMBER_MAX).trim() : '');
    const kept = { organ: str(organ), osoba: str(osoba) };
    return pamietaj === true && (kept.organ || kept.osoba) ? kept : null;
  } catch {
    return null;
  }
}

function saveRemembered(): void {
  if (!pubRemember.checked) return;
  storageSet(
    'adnotacja',
    JSON.stringify({ pamietaj: true, organ: pubOrgan.value.trim(), osoba: pubOsoba.value.trim() }),
  );
}

function syncOtherBasis(): void {
  const other = pubBasis.value === OTHER_BASIS;
  pubOther.hidden = !other;
  pubOtherLabel.hidden = !other;
}

/**
 * Nowe pismo w polu źródła (plik, wklejenie w miejsce całego tekstu, puste pole): to, co dotyczy
 * poprzedniego pisma, znika. Ręczna adnotacja mogła zawierać jego dane, a „Dołącz” przy zwiniętej
 * karcie dopisałoby ją do nowego wyniku. Organ, osoba, podstawa i data zostają.
 */
function resetDocumentPublication(): void {
  pubZnak.value = '';
  for (const el of [pubAppend, ...pubChecks]) el.checked = false;
  allReviewed = false;
  annEdited = false;
  refreshAnnotation();
  copyFlash.reset();
  syncPrintOut(); // druk i „Kopiuj” bez adnotacji jeszcze przed odłożonym przeliczeniem
}

/**
 * „Wyczyść” i „Przykład”: pola karty wracają do stanu z otwarcia pliku, lista „Przed publikacją”
 * jest pusta. Zapamiętany organ i osoba wracają, jeśli „Pamiętaj” jest zaznaczone.
 */
function clearPublication(): void {
  flushPendingUpdate(); // poprawki „Cofnij” na pasku bierze replaceSource z tekstem z pola
  const kept = pubRemember.checked ? readRemembered() : null;
  pubOrgan.value = kept?.organ ?? '';
  pubOsoba.value = kept?.osoba ?? '';
  for (const el of [pubZatw, pubOther]) el.value = '';
  pubBasis.value = BASES[0].key;
  syncOtherBasis();
  pubDate.value = formatDate(new Date());
  for (const el of [pubCounts, pubSha]) el.checked = false;
  resetDocumentPublication();
}

for (const el of [pubOrgan, pubOsoba, pubZatw, pubOther, pubDate]) {
  el.addEventListener('input', () => {
    refreshAnnotation();
    annexChanged();
    if (el === pubOrgan || el === pubOsoba) saveRemembered();
  });
}
for (const el of [pubBasis, pubCounts]) {
  el.addEventListener('change', () => {
    syncOtherBasis();
    refreshAnnotation();
    annexChanged();
  });
}
pubAnn.addEventListener('input', () => {
  annEdited = true;
  refreshAnnotation();
  annexChanged();
});
pubResetAnn.addEventListener('click', () => {
  annEdited = false;
  refreshAnnotation();
  annexChanged();
  // przycisk znika, więc fokus przechodzi do adnotacji
  pubAnn.focus({ preventScroll: true });
  announce('Przywrócono wzór adnotacji.');
});
pubAppend.addEventListener('change', () => {
  copyFlash.reset();
  syncPrintOut();
  announce(
    pubAppend.checked
      ? 'Adnotacja zostanie dołączona na końcu wyniku.'
      : 'Adnotacja nie będzie dołączana do wyniku.',
  );
});
pubRemember.addEventListener('change', () => {
  if (pubRemember.checked) saveRemembered();
  else storageRemove('adnotacja');
});

/** Rodzaj źródła do protokołu: z rozszerzenia wczytanego pliku, bez jego nazwy. */
function sourceKind(): SourceKind {
  if (!lastFileExt) return 'wklejony';
  if (lastFileExt === 'docx' || lastFileExt === 'pdf') return lastFileExt;
  return 'tekstowy';
}

/** Protokół bieżącego wyniku. Suma SHA-256 tylko po zaznaczeniu i tylko z wyniku, nigdy ze źródła. */
async function protocolNow(): Promise<string> {
  const sha = pubSha.checked ? await sha256Hex(downloadText()) : null;
  const marks = maskEls.length;
  return buildProtocol({
    when: new Date(),
    version: __APP_VERSION__,
    source: sourceKind(),
    chars: lastInput.length,
    lines: lastInput.split('\n').length,
    znak: pubZnak.value,
    counts: currentCounts(),
    disabled: MASK_GROUPS.filter((g) => disabledGroups.has(g.key)).map((g) => inSentence(g.label)),
    pseudonyms: pseudonymsBox.checked,
    reviewed: isTooBig() ? null : Math.min(reviewed.size, marks),
    marks,
    // Ręczne poprawki: same liczby (wartości nie trafiają do protokołu).
    extra: lastSpans ? correctionLines(correctionCounts(corrected).kept, correctionCounts(corrected).masked) : [],
    sha256: sha,
    osoba: pubOsoba.value,
    zatwierdzil: pubZatw.value,
  });
}

/** Kopiowanie do schowka z zapasem przez ukryte pole (jak „Kopiuj” wyniku). */
async function copyPlain(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const prevFocus = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    prevFocus?.focus({ preventScroll: true });
    return ok;
  }
}

const annCopyLabel = $<HTMLSpanElement>('pub-copy-ann-label');
const protCopyLabel = $<HTMLSpanElement>('pub-copy-prot-label');
const annCopyFlash = makeFlash((t) => (annCopyLabel.textContent = t), 'Kopiuj adnotację');
const protCopyFlash = makeFlash((t) => (protCopyLabel.textContent = t), 'Kopiuj protokół');
const COPY_BLOCKED = 'Kopiowanie zablokowane przez przeglądarkę: zaznacz tekst i naciśnij Ctrl+C.';

$<HTMLButtonElement>('pub-copy-ann').addEventListener('click', async () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  if (await copyPlain(pubAnn.value.trim())) {
    annCopyFlash.show('Skopiowano ✓');
    announce('Skopiowano adnotację do schowka.');
  } else showError(COPY_BLOCKED);
});

$<HTMLButtonElement>('pub-copy-prot').addEventListener('click', async () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  if (await copyPlain(await protocolNow())) {
    protCopyFlash.show('Skopiowano ✓');
    announce('Skopiowano protokół do schowka.');
  } else showError(COPY_BLOCKED);
});

// Plik jak „Pobierz .txt”: BOM i końce wierszy \r\n, nazwa z datą, bez nazwy pliku i znaku sprawy.
$<HTMLButtonElement>('pub-dl-prot').addEventListener('click', async () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  const text = textForDownload(await protocolNow());
  saveFile(new Blob([text], { type: 'text/plain;charset=utf-8' }), protocolName(new Date()));
});

// Druk przez ten sam #print-out: na czas wydruku zamiast wyniku stoi w nim protokół.
$<HTMLButtonElement>('pub-print-prot').addEventListener('click', async () => {
  flushPendingUpdate();
  if (!lastRedacted) return;
  printProtocol = await protocolNow();
  printMode = 'protocol';
  syncPrintOut();
  window.print();
});

// Start: zapamiętany organ i osoba (tylko gdy kiedyś zaznaczono „Pamiętaj”), dzisiejsza data.
{
  const kept = readRemembered();
  if (kept) {
    pubRemember.checked = true;
    pubOrgan.value = kept.organ;
    pubOsoba.value = kept.osoba;
  }
  pubDate.value = formatDate(new Date());
  syncOtherBasis();
}

exampleBtn.addEventListener('click', () => {
  clearError();
  setFileExt('');
  clearPublication();
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
  // Autofokus bez przewijania: na laptopie pole stoi na pierwszym ekranie, a przy wąskim oknie
  // leży niżej i nagłówek z obietnicą prywatności ma zostać widoczny. Ctrl+V i tak trafia do pola.
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

// Raz na otwarcie pliku: zapamiętane wyłączenie widać, zanim ktoś wklei tekst. Bez przewijania
// do paska, bo stoi pod przyciskami pola źródła, a strona dopiero się otwiera.
if (storedOff && disabledGroups.size > 0) {
  const msg = storedOffMessage();
  appNoteText.textContent = msg;
  appNoteUndo.hidden = true;
  appNoteMaskOn.hidden = false;
  appNote.classList.add('is-warn'); // kolor i ikona ostrzeżenia: te dane zostaną jawne w wyniku
  appNote.hidden = false;
  appNoteStatus.textContent = msg;
  storedOffNote = true;
}

// Kopia otwarta ze strony produktu dostaje stały pasek nad edytorem (web-copy.ts).
if (isProductCopy(location.hostname)) $('web-copy').hidden = false;

$('app-version-top').textContent = __APP_VERSION__;
// Data builda (data commita) obok wersji, a po pół roku odsyłacz do wydań staje się
// ostrzeżeniem. Tylko zegar komputera (file-age.ts): bez sieci i bez zapisu.
const buildDate = formatBuildDate(__BUILD_DATE__);
// Twarda spacja przed kropką: na telefonie wiersz łamie się dopiero za kropką, a data
// przechodzi do drugiej linii sama („wersja 0.46.23 ·” / „24.10.2026”).
if (buildDate) $('app-build-date').textContent = `\u00a0· ${buildDate}`;
const ageNote = fileAgeNote(__BUILD_DATE__, new Date());
if (ageNote) {
  const verLink = $('ver-link');
  verLink.textContent = `${ageNote} ↗`;
  verLink.classList.add('is-old');
}

// Podmień wszystkie statyczne <i class="gi" data-i="…"> z index.html na inline SVG.
hydrateIcons();

// Na dotyku nie ma skrótu klawiszowego, więc dymki „Kopiuj” i kroku 4 o nim nie wspominają
// (przed initTips: ikona kroku bierze treść dymka jako nazwę dostępną).
if (!finePointer.matches) {
  copyBtn.dataset.tip = 'Kopiuje zanonimizowany tekst do schowka';
  $('step4-tip').dataset.tip = 'Przyciski „Kopiuj” i „Pobierz” (.txt albo .docx) stoją nad wynikiem';
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
