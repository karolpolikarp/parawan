import { redactPII, type PiiFinding, type PiiType } from 'anonimizator';
import { escapeHtml, renderAligned } from './compare';
import { extractDocxText } from './docx';
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
import { extractPdfText } from './pdf';
import { buildMinimalPdf } from './pdf-fixture';
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
const statCats = $<HTMLElement>('stat-cats');
const srcMeta = $<HTMLSpanElement>('src-meta');
const copyBtn = $<HTMLButtonElement>('copy');
const copyLabel = $<HTMLSpanElement>('copy-label');
const downloadBtn = $<HTMLButtonElement>('download');
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
let viewMode: 'result' | 'compare' = 'result';
let maskEls: HTMLElement[] = []; // znaczniki w wyniku, w kolejności dokumentu
let maskIdx = -1; // bieżący znacznik w przeglądaniu (-1 = żaden)
let maskTabStop: HTMLElement | null = null; // jedyny znacznik w kolejności Tab (roving tabindex)

/* ── JEDNO źródło prawdy o typach PII — z niego wyprowadzamy legendę, znaczniki, chipy
   i przełączniki (jedna rodzina kolorów i ikon w całej aplikacji). Klucz = TOKEN w [...]. ── */

type Cat = 'person' | 'contact' | 'ident' | 'fin' | 'place';

interface TokenMeta {
  cat: Cat; // kategoria wizualna (kolor + pas w legendzie/tabeli)
  icon: string; // nazwa ikony z icons.ts
  tip: string; // tooltip znacznika w wyniku: „Kategoria · metoda wykrycia"
}

/**
 * Metadane prezentacji per token maski (to, co stoi w [...] w wyniku). To JEDYNE miejsce,
 * w którym żyje kategoria i ikona danego typu — chipy „Zamaskowano", przełączniki „Co maskować"
 * i legenda czerpią stąd (żadnej z tych wartości nie powielamy w kilku miejscach).
 */
const PII_TOKENS: Record<string, TokenMeta> = {
  // Identyfikatory
  PESEL: { cat: 'ident', icon: 'pesel', tip: 'Identyfikatory · 11 cyfr, suma kontrolna poprawna' },
  NIP: { cat: 'ident', icon: 'nip', tip: 'Identyfikatory · 10 cyfr, suma kontrolna poprawna' },
  REGON: { cat: 'ident', icon: 'dane-id', tip: 'Identyfikatory · suma kontrolna poprawna' },
  'NR-DOWODU': { cat: 'ident', icon: 'numer-dok', tip: 'Identyfikatory · 3 litery + 6 cyfr, suma kontrolna poprawna' },
  'NR-PASZPORTU': { cat: 'ident', icon: 'numer-dok', tip: 'Identyfikatory · kontekst „paszport" + 2 litery + 7 cyfr' },
  KRS: { cat: 'ident', icon: 'dane-id', tip: 'Identyfikatory · kontekst „KRS" + 10 cyfr' },
  'NR-KSEF': { cat: 'ident', icon: 'numer-dok', tip: 'Identyfikatory · słowo „KSeF" w dokumencie + numer faktury (NIP-data-znaki) z sumą kontrolną NIP-u' },
  'ZNAK-SPRAWY': { cat: 'ident', icon: 'numer-dok', tip: 'Identyfikatory · znak sprawy/pisma (JRWA) lub sygnatura akt' },
  'PRAWO-JAZDY': { cat: 'ident', icon: 'numer-dok', tip: 'Identyfikatory · kontekst „prawo jazdy" + numer z cyfrą' },
  'NR-REJESTRACYJNY': { cat: 'ident', icon: 'numer-dok', tip: 'Identyfikatory · kontekst „rejestracyjny/tablica" + tablica' },
  VIN: { cat: 'ident', icon: 'dane-id', tip: 'Identyfikatory · 17 znaków bez I/O/Q; kontekst „VIN" lub układ VIN' },
  IP: { cat: 'ident', icon: 'dane-id', tip: 'Identyfikatory · adres IPv4 (oktety 0–255) lub IPv6' },
  MAC: { cat: 'ident', icon: 'dane-id', tip: 'Identyfikatory · 6 par hex (00:1A:2B:3C:4D:5E)' },
  TOKEN: { cat: 'ident', icon: 'login', tip: 'Identyfikatory · token/JWT (eyJ…), może dawać dostęp' },
  LOGIN: { cat: 'ident', icon: 'login', tip: 'Identyfikatory · kontekst „login/username" + wartość (też w URL i XML/JSON)' },
  // Finanse
  'NR-KONTA': { cat: 'fin', icon: 'iban', tip: 'Finanse · IBAN (mod 97) lub kontekst „konto/rachunek”' },
  'NR-KARTY': { cat: 'fin', icon: 'iban', tip: 'Finanse · kontekst „karta/Visa/Mastercard…" + 13–19 cyfr + suma Luhna' },
  // Kontakt
  EMAIL: { cat: 'contact', icon: 'login', tip: 'Kontakt · wzorzec adresu e-mail' },
  TELEFON: { cat: 'contact', icon: 'telefon', tip: 'Kontakt · 9 cyfr, opcjonalnie +48' },
  // Adres i czas
  ADRES: { cat: 'place', icon: 'dom', tip: 'Adres i czas · wzorzec ul./al./os./pl. + nazwa + numer' },
  'KOD-POCZTOWY': { cat: 'place', icon: 'mapa-pl', tip: 'Adres i czas · wzorzec XX-XXX' },
  'MIEJSCOWOŚĆ': { cat: 'place', icon: 'mapa-pl', tip: 'Adres i czas · miejscowość po kodzie pocztowym' },
  'DATA-URODZENIA': { cat: 'person', icon: 'kalendarz', tip: 'Adres i czas · data z kontekstem „ur./urodzony”' },
  // Osoby
  'IMIĘ I NAZWISKO': { cat: 'person', icon: 'dane-osobowe', tip: 'Osoby · słownik imion/nazwisk lub wyzwalacz kontekstu' },
};

/** Kategoria wizualna znacznika po nazwie tokenu (OSOBA-* = osoba; nieznany token → identyfikatory). */
function maskCategory(name: string): Cat {
  if (name.startsWith('OSOBA-')) return 'person';
  return PII_TOKENS[name]?.cat ?? 'ident';
}

/** Tooltip znacznika w wyniku: kategoria · metoda wykrycia. */
function maskTip(name: string): string {
  if (name.startsWith('OSOBA-')) return `Osoby · spójna etykieta tej samej osoby (${name})`;
  return PII_TOKENS[name]?.tip ?? 'Wykryta dana osobowa';
}

/* ── Przełączniki „Co maskować" (generowane, z ikonami i kodami znaczników) ── */

interface MaskGroup {
  key: string;
  label: string;
  types: PiiType[];
  cat: Cat;
  icon: string;
  code: string;
  tip: string;
  full?: boolean;
}

// Definicje przełączników „Co maskować" BEZ kategorii i ikony — te wyprowadzamy z PII_TOKENS
// po tokenie z `code`. Zostają tu dane swoiste dla przełącznika: klucz, etykieta, mapowane
// typy rdzenia (`types`), kod znacznika i własny (bardziej szczegółowy niż tooltip) opis.
type MaskGroupDef = Omit<MaskGroup, 'cat' | 'icon'>;
const MASK_GROUP_DEFS: MaskGroupDef[] = [
  { key: 'pesel', label: 'PESEL', types: ['PESEL'], code: '[PESEL]', tip: '11 cyfr + walidacja sumy kontrolnej' },
  { key: 'nip', label: 'NIP', types: ['NIP'], code: '[NIP]', tip: '10 cyfr (także z myślnikami) + suma kontrolna' },
  { key: 'regon', label: 'REGON', types: ['REGON'], code: '[REGON]', tip: '9 lub 14 cyfr + suma kontrolna' },
  { key: 'dowod', label: 'Nr dowodu osobistego', types: ['DOWOD'], code: '[NR-DOWODU]', tip: '3 litery + 6 cyfr + suma kontrolna' },
  { key: 'paszport', label: 'Nr paszportu', types: ['PASZPORT'], code: '[NR-PASZPORTU]', tip: 'Kontekst „paszport" + 2 litery + 7 cyfr' },
  { key: 'krs', label: 'Numer KRS', types: ['KRS'], code: '[KRS]', tip: 'Kontekst „KRS" + 10 cyfr' },
  { key: 'ksef', label: 'Numer KSeF', types: ['KSEF'], code: '[NR-KSEF]', tip: 'Słowo „KSeF" gdziekolwiek w dokumencie + numer faktury (NIP-RRRRMMDD-znaki-suma) z sumą kontrolną NIP-u; także stary format 36-znakowy, a etykieta może stać w nagłówku kolumny lub po numerze' },
  { key: 'znak', label: 'Znak sprawy / pisma', types: ['ZNAK-SPRAWY'], code: '[ZNAK-SPRAWY]', tip: 'Znak sprawy/pisma wg JRWA (ABC-def.123.77.2016) lub sygnatura akt („Sygn. akt II CSK 234/19")' },
  { key: 'prawojazdy', label: 'Nr prawa jazdy', types: ['PRAWO-JAZDY'], code: '[PRAWO-JAZDY]', tip: 'Kontekst „prawo jazdy" + numer (z cyfrą)' },
  { key: 'rejestracja', label: 'Nr rejestracyjny', types: ['NR-REJESTRACYJNY'], code: '[NR-REJESTRACYJNY]', tip: 'Kontekst „rejestracyjny/tablica" + tablica (WI1234K)' },
  { key: 'vin', label: 'VIN', types: ['VIN'], code: '[VIN]', tip: '17 znaków bez I/O/Q; kontekst „VIN/nadwozia" lub wyraźny układ VIN' },
  { key: 'ip', label: 'Adres IP', types: ['IP'], code: '[IP]', tip: 'IPv4 (oktety 0–255) oraz IPv6' },
  { key: 'mac', label: 'Adres MAC', types: ['MAC'], code: '[MAC]', tip: '6 par hex (00:1A:2B:3C:4D:5E)' },
  { key: 'token', label: 'Token / JWT', types: ['TOKEN'], code: '[TOKEN]', tip: 'Token JWT (eyJ…), może dawać dostęp' },
  { key: 'login', label: 'Login / nazwa użytkownika', types: ['LOGIN'], code: '[LOGIN]', tip: 'Kontekst „login/username/nazwa użytkownika" + wartość; także w parametrach URL (?user=…) i kluczach XML/JSON' },
  { key: 'konto', label: 'IBAN / nr konta', types: ['IBAN', 'NR-KONTA'], code: '[NR-KONTA]', tip: 'Walidacja mod 97 lub kontekst „konto/rachunek”' },
  { key: 'karta', label: 'Karta płatnicza', types: ['KARTA'], code: '[NR-KARTY]', tip: 'Kontekst „karta/Visa/Mastercard/Amex…" + 13–19 cyfr, prefiks sieci + suma Luhna' },
  { key: 'email', label: 'E-mail', types: ['EMAIL'], code: '[EMAIL]', tip: 'Wzorzec adresu e-mail' },
  { key: 'telefon', label: 'Telefon', types: ['TELEFON'], code: '[TELEFON]', tip: '9 cyfr, opcjonalnie prefiks +48' },
  { key: 'adres', label: 'Adres', types: ['ADRES'], code: '[ADRES]', tip: 'ul./al./os./pl. + nazwa + numer' },
  { key: 'kod', label: 'Kod pocztowy', types: ['KOD-POCZTOWY'], code: '[KOD-POCZTOWY]', tip: 'Wzorzec XX-XXX' },
  { key: 'miejscowosc', label: 'Miejscowość', types: ['MIEJSCOWOSC'], code: '[MIEJSCOWOŚĆ]', tip: 'Miejscowość po kodzie pocztowym (w adresie)' },
  { key: 'imie', label: 'Imię i nazwisko', types: ['IMIE'], code: '[IMIĘ I NAZWISKO]', tip: 'Słownik ~200 imion i ~230 nazwisk z odmianą + morfologia i wyzwalacze kontekstu; wykrywanie heurystyczne' },
  { key: 'dataur', label: 'Data urodzenia', types: ['DATA-UR'], code: '[DATA-URODZENIA]', tip: 'Data z kontekstem „ur./urodzony”' },
];

/** Token wewnątrz [...] z kodu znacznika, np. „[NR-KONTA]" → „NR-KONTA". */
const tokenOfCode = (code: string): string => code.slice(1, -1);

// Kategoria i ikona każdego przełącznika pochodzą z PII_TOKENS (po tokenie z `code`) — nie
// duplikujemy ich. Zweryfikowane: dla każdego kodu para (kategoria, ikona) jest tam zdefiniowana.
const MASK_GROUPS: MaskGroup[] = MASK_GROUP_DEFS.map((g) => {
  const meta = PII_TOKENS[tokenOfCode(g.code)];
  return { ...g, cat: meta.cat, icon: meta.icon };
});

const maskTogglesEl = $<HTMLSpanElement>('mask-toggles');
// Klucze spoza bieżącej listy (np. z dawnej wersji) pomijamy, inaczej zawyżałyby liczniki.
const disabledGroups = new Set<string>(
  (storageGet('mask-disabled') ?? '').split(',').filter((k) => MASK_GROUPS.some((g) => g.key === k)),
);

/** Token znacznika po typie rdzenia (IBAN i NR-KONTA → „NR-KONTA”, IMIE → „IMIĘ I NAZWISKO”). */
const TYPE_TOKEN: Record<string, string> = Object.fromEntries(
  MASK_GROUP_DEFS.flatMap((g) => g.types.map((t) => [t, tokenOfCode(g.code)])),
);

const CAT_LABELS: Record<Cat, string> = {
  ident: 'Identyfikatory',
  contact: 'Kontakt',
  fin: 'Finanse',
  place: 'Adres',
  person: 'Dane osobowe',
};

/* ── Tabela „Co wykrywa" — generowana z jednego źródła (nie ~130 linii statycznego HTML) ── */
// Krótka etykieta kategorii w pigułce tabeli (inna niż CAT_LABELS: person → „osoby", place → „adres").
const CATPILL: Record<Cat, string> = {
  ident: 'identyfikatory',
  contact: 'kontakt',
  fin: 'finanse',
  place: 'adres',
  person: 'osoby',
};
// Opis „jak rozpoznaje" jest SWOISTY dla tabeli (z wyróżnieniem <strong>/<code>, zaufany statyczny
// HTML) i determinuje KOLEJNOŚĆ wierszy. Nazwa, kategoria, ikona i kod pochodzą z MASK_GROUPS/
// PII_TOKENS po kodzie znacznika — nie powielamy ich tu.
const WYKRYWA_ROWS: Array<{ code: string; how: string }> = [
  { code: '[PESEL]', how: '11 cyfr + <strong>walidacja sumy kontrolnej</strong>' },
  { code: '[NIP]', how: '10 cyfr (także z myślnikami) + <strong>suma kontrolna</strong>' },
  { code: '[REGON]', how: '9/14 cyfr + <strong>suma kontrolna</strong>' },
  { code: '[NR-DOWODU]', how: '3 litery + 6 cyfr + <strong>suma kontrolna</strong>' },
  { code: '[NR-PASZPORTU]', how: 'kontekst „paszport" + 2 litery + 7 cyfr' },
  { code: '[KRS]', how: 'kontekst „KRS" + 10 cyfr' },
  { code: '[NR-KSEF]', how: 'słowo „KSeF" w dokumencie + numer faktury (<code>NIP-RRRRMMDD-…</code>) + <strong>suma kontrolna NIP-u</strong>' },
  { code: '[ZNAK-SPRAWY]', how: 'znak sprawy/pisma wg JRWA lub sygnatura akt („Sygn. akt II CSK 234/19")' },
  { code: '[PRAWO-JAZDY]', how: 'kontekst „prawo jazdy" + numer (z cyfrą)' },
  { code: '[NR-REJESTRACYJNY]', how: 'kontekst „rejestracyjny/tablica/pojazd" + tablica (np. WI1234K)' },
  { code: '[VIN]', how: '17 znaków bez I/O/Q; kontekst „VIN/nadwozia" lub wyraźny układ VIN' },
  { code: '[IP]', how: 'IPv4 (oktety 0–255) oraz IPv6' },
  { code: '[MAC]', how: '6 par hex (00:1A:2B:3C:4D:5E)' },
  { code: '[TOKEN]', how: 'token JWT (<code>eyJ…</code>), może dawać dostęp' },
  { code: '[LOGIN]', how: 'kontekst „login/username" + wartość (też w URL i XML/JSON)' },
  { code: '[NR-KONTA]', how: 'walidacja <strong>mod 97</strong> lub kontekst „konto/rachunek”' },
  { code: '[NR-KARTY]', how: 'kontekst „karta/Visa/Mastercard…" + 13–19 cyfr, prefiks sieci + <strong>suma Luhna</strong>' },
  { code: '[EMAIL]', how: 'wzorzec adresu' },
  { code: '[TELEFON]', how: '9 cyfr, opcjonalnie +48' },
  { code: '[ADRES]', how: 'ul./al./os./pl. + nazwa + numer' },
  { code: '[KOD-POCZTOWY]', how: 'XX-XXX' },
  { code: '[MIEJSCOWOŚĆ]', how: 'miejscowość po kodzie pocztowym lub przy zamieszkaniu (nie w prozie/instytucji)' },
  { code: '[DATA-URODZENIA]', how: 'data z kontekstem „ur./urodzony”' },
  { code: '[IMIĘ I NAZWISKO]', how: 'słownik ~200 imion i ~230 nazwisk (z odmianą) + wyzwalacze („nazywam się”, „Pan/Pani”)' },
];
const wykrywaBody = document.getElementById('wykrywa-body');
if (wykrywaBody) {
  const groupByCode = new Map(MASK_GROUPS.map((g) => [g.code, g]));
  wykrywaBody.innerHTML = WYKRYWA_ROWS.map(({ code, how }) => {
    const meta = PII_TOKENS[tokenOfCode(code)];
    const name = groupByCode.get(code)?.label ?? tokenOfCode(code);
    return (
      `<tr><td><span class="td-name"><span class="ic ic-s c-${meta.cat}">` +
      `<i class="gi">${icon(meta.icon)}</i></span>${escapeHtml(name)}</span></td>` +
      `<td><span class="catpill cp-${meta.cat}">${CATPILL[meta.cat]}</span></td>` +
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

/** Wiersz-tryb „Rozróżniaj osoby" (nie typ danych) — mieszka w grupie „Dane osobowe". */
function buildModeRow(): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'tgr mode';
  label.dataset.tip = 'Ta sama osoba zachowuje tę samą etykietę w całym dokumencie, przydatne w umowach i pismach';

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
// Adres (szeroko) · Dane osobowe (szeroko + tryb „Rozróżniaj osoby").
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

/* ── Akcje zbiorcze „Co maskować" + licznik ── */
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
input.parentElement?.append(inputGrip); // .card-b okna źródła
output.parentElement?.append(outputGrip); // .card-b okna wyniku
// Oba uchwyty sterują tą samą wysokością, więc z klawiatury wystarczy jeden przystanek Tab.
// Drugi zostaje dla myszy i dotyku.
outputGrip.tabIndex = -1;
syncGripAria();
window.addEventListener('resize', () => syncGripAria());

/* ── Pasek „Zamaskowano" (chipy z ikonami, licznik, kategorie) ── */

// Chipy „Zamaskowano" per typ rdzenia (finding.type). Krótka etykieta jest swoista dla chipa;
// kategorię i ikonę bierzemy z PII_TOKENS po tokenie (jedno źródło). Typy spoza tej listy
// (VIN/IP/MAC/TOKEN/LOGIN/…) dostają w renderFindings generyczny chip zapasowy.
const CHIP_DEFS: Array<{ type: PiiType; token: string; label: string }> = [
  { type: 'IMIE', token: 'IMIĘ I NAZWISKO', label: 'imię i nazwisko' },
  { type: 'PESEL', token: 'PESEL', label: 'PESEL' },
  { type: 'NIP', token: 'NIP', label: 'NIP' },
  { type: 'REGON', token: 'REGON', label: 'REGON' },
  { type: 'DOWOD', token: 'NR-DOWODU', label: 'nr dowodu' },
  { type: 'PASZPORT', token: 'NR-PASZPORTU', label: 'nr paszportu' },
  { type: 'KRS', token: 'KRS', label: 'numer KRS' },
  { type: 'ZNAK-SPRAWY', token: 'ZNAK-SPRAWY', label: 'znak sprawy' },
  { type: 'LOGIN', token: 'LOGIN', label: 'login' },
  { type: 'IBAN', token: 'NR-KONTA', label: 'nr konta' },
  { type: 'NR-KONTA', token: 'NR-KONTA', label: 'nr konta' },
  { type: 'KARTA', token: 'NR-KARTY', label: 'nr karty' },
  { type: 'EMAIL', token: 'EMAIL', label: 'e-mail' },
  { type: 'TELEFON', token: 'TELEFON', label: 'telefon' },
  { type: 'ADRES', token: 'ADRES', label: 'adres' },
  { type: 'KOD-POCZTOWY', token: 'KOD-POCZTOWY', label: 'kod pocztowy' },
  { type: 'MIEJSCOWOSC', token: 'MIEJSCOWOŚĆ', label: 'miejscowość' },
  { type: 'DATA-UR', token: 'DATA-URODZENIA', label: 'data urodzenia' },
];
const CHIP_META: Record<string, { label: string; cat: Cat; icon: string }> = Object.fromEntries(
  CHIP_DEFS.map(({ type, token, label }) => {
    const meta = PII_TOKENS[token];
    return [type, { label, cat: meta.cat, icon: meta.icon }];
  }),
);

const CHIP_NAV_TIP = 'Przejdź do kolejnego fragmentu tego typu w wyniku';

function renderFindings(found: PiiFinding[]): void {
  findingsCard.hidden = false;
  // koercja licznika do liczby — obrona przed nie-liczbowym count (XSS/NaN)
  const total = found.reduce((s, f) => s + (Number(f.count) || 0), 0);
  const byLabel = new Map<string, { count: number; cat: Cat; icon: string; token: string }>();
  for (const f of found) {
    const meta = CHIP_META[f.type] ?? { label: String(f.type), cat: 'ident' as Cat, icon: 'dane-id' };
    const prev = byLabel.get(meta.label);
    byLabel.set(meta.label, {
      count: (prev?.count ?? 0) + (Number(f.count) || 0),
      cat: meta.cat,
      icon: meta.icon,
      token: TYPE_TOKEN[f.type] ?? String(f.type),
    });
  }
  const cats = new Set([...byLabel.values()].map((v) => v.cat)).size;
  statCount.textContent = String(total);
  statCats.textContent = String(cats);
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
    `Zamaskowano ${total} ${total === 1 ? 'fragment' : 'fragmentów'} w ${cats} ${cats === 1 ? 'kategorii' : 'kategoriach'}.` +
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
}

function updateSrcMeta(text: string): void {
  const lines = text ? text.split('\n').length : 0;
  srcMeta.textContent = `${lines} wierszy · ${text.length} znaków · plik możesz upuścić w dowolnym miejscu strony`;
}

function renderResult(redacted: string, found: PiiFinding[]): void {
  // Nowy wynik: „Skopiowano ✓” dotyczyło poprzedniego, więc etykieta wraca do „Kopiuj”.
  if (redacted !== lastRedacted) copyFlash.reset();
  lastRedacted = redacted;
  lastInput = input.value;
  setResultActions(true);
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
      'Wklej tekst po lewej albo kliknij „Przykład" powyżej.</span>';
    findingsCard.hidden = true;
    lastRedacted = '';
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

input.addEventListener('input', () => {
  // Własna edycja zamyka komunikaty: stary błąd już nie dotyczy, a „Cofnij” po edycji
  // przywróciłby tekst sprzed niej i skasował to, co właśnie wpisano.
  clearError();
  dismissNote();
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

/* Pasek „Cofnij”. „Wyczyść”, „Przykład” i wczytany plik zastępują CAŁY tekst, a przypisanie
   input.value kasuje historię Ctrl+Z pola. Poprzedni tekst trzymamy więc tutaj, do następnej
   edycji albo zamknięcia paska. Nie używamy execCommand('insertText'): wymaga fokusu (na
   dotyku otwiera klawiaturę), przy dużych plikach jest bardzo wolny i jest przestarzały. */
let undoText: string | null = null;

/** Pokaż informację pod paskiem narzędzi; z `prev` dochodzi przycisk „Cofnij”. */
function showNote(msg: string, prev: string | null): void {
  undoText = prev;
  appNoteText.textContent = msg;
  appNoteUndo.hidden = prev === null;
  appNote.hidden = false;
  appNoteStatus.textContent = msg; // ogłoszenie dla czytnika ekranu
  revealIfOffscreen(appNote);
}

function dismissNote(): void {
  undoText = null;
  appNote.hidden = true;
  appNoteStatus.textContent = '';
}

// Mysz i touchpad: po akcji fokus wraca do pola. Na dotyku nie, bo fokus otwiera klawiaturę
// ekranową, która zasłania wynik.
const finePointer = matchMedia('(pointer: fine)');

/** Zastąp cały tekst źródła; gdy było co stracić, pokaż pasek „Cofnij”. `info` to dopisek. */
function replaceSource(text: string, note: string, info = ''): void {
  const prev = input.value;
  input.value = text;
  update();
  if (finePointer.matches) input.focus(); // przed paskiem: przewinięcie do pola nie zasłoni go
  const canUndo = prev.trim() !== '' && prev !== text;
  if (canUndo || info) showNote([canUndo ? note : '', info].filter(Boolean).join(' '), canUndo ? prev : null);
  else dismissNote();
}

appNoteUndo.addEventListener('click', () => {
  if (undoText === null) return;
  input.value = undoText;
  dismissNote();
  clearError();
  update();
  appNoteStatus.textContent = 'Przywrócono poprzedni tekst.';
  if (finePointer.matches) input.focus(); // przycisk znika, więc fokus nie może na nim zostać
});
appNoteClose.addEventListener('click', () => {
  dismissNote();
  if (finePointer.matches) input.focus();
});

clearBtn.addEventListener('click', () => {
  clearError();
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
    await navigator.clipboard.writeText(lastRedacted);
    copyFlash.show('Skopiowano ✓');
    announce('Skopiowano wynik do schowka.');
  } catch {
    const prevFocus = document.activeElement as HTMLElement | null;
    const ta = document.createElement('textarea');
    ta.value = lastRedacted;
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
  const blob = new Blob([lastRedacted], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Znacznik czasu odróżnia kolejne pobrania („zanonimizowany (1).txt” nic nie mówi).
  // Nazwy wczytanego pliku NIE używamy: „umowa-najmu-Kowalska” przeszłaby jawna.
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  a.download =
    `zanonimizowany-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.txt`;
  a.click();
  URL.revokeObjectURL(url);
});

// Przykład: maskowanie + strażnik kontekstu (art. 123 456 789 celowo zostaje)
const EXAMPLE_TEXT = `Dzień dobry, nazywam się Anna Kowalska (PESEL 44051401359).
Mieszkam przy ul. Polnej 12/3, 00-950 Warszawa.
Proszę o kontakt: anna.kowalska@example.com lub tel. 600 700 800.
Nr konta do zwrotu: PL61 1090 1014 0000 0712 1981 2874.
Sprawę prowadzi pan Bąkiewicz zgodnie z art. 123 456 789 KC.`;

exampleBtn.addEventListener('click', () => {
  clearError();
  replaceSource(EXAMPLE_TEXT, 'Wstawiono przykład w miejsce Twojego tekstu.');
});

loadFileBtn.addEventListener('click', () => fileInput.click());

const EMPTY_FILE = 'Plik jest pusty: nie zawiera tekstu do anonimizacji.';

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
    if (isDocx) text = extractDocxText(buf);
    else if (isPdf) text = await extractPdfText(buf);
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
      showError(EMPTY_FILE);
      return;
    }
    replaceSource(text, 'Zastąpiono tekst treścią pliku.', info);
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

/* ── Parametry URL i start ── */

const params = new URLSearchParams(location.search);
if (params.has('demo')) {
  input.value = EXAMPLE_TEXT;
} else if (finePointer.matches) {
  input.focus();
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

// Na dotyku nie ma skrótu klawiszowego, więc dymek „Kopiuj” o nim nie wspomina.
if (!finePointer.matches) copyBtn.dataset.tip = 'Kopiuje zanonimizowany tekst do schowka';

// Dymki: opisy dla czytników ekranu, „?” w summary, Esc i dociskanie do krawędzi (tips.ts).
initTips();

update();
