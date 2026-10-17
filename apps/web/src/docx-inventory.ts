/**
 * Spis części pliku .docx, których Parawan nie czyta. extractDocxText bierze tylko treść główną
 * (`word/document.xml`), a nagłówki, stopki, przypisy, komentarze, obrazy i tekst usunięty
 * w śledzonych zmianach zostają w pliku. Bez tego spisu urzędnik sądził, że sprawdził cały
 * dokument, i publikował oryginał z nazwiskiem w stopce albo w komentarzu.
 *
 * Same liczby, bez treści: komunikat po wczytaniu mówi, ile czego jest, a nie co tam stoi.
 * Rozpakowujemy tu więcej wpisów ZIP niż przy odczycie treści, więc wszystkie części poza
 * `word/document.xml` mają jeden wspólny limit MAX_XML_BYTES (bomba ZIP rozłożona na tysiąc
 * nagłówków też nie zamrozi karty), a sam `word/document.xml` ten sam limit co w docx.ts.
 */

import { docxEntries, MAX_XML_BYTES, readDocxPart, wmlName, wmlPrefix, wmlText } from './docx';
import { plural } from './plural';
import type { ZipEntry } from './zip';

export interface DocxInventory {
  /** Części `word/header*.xml` i `word/footer*.xml` z niepustym tekstem. */
  headersFooters: number;
  /** Przypisy dolne i końcowe z tekstem, bez separatorów, które Word dopisuje sam. */
  notes: number;
  /** Komentarze (`w:comment`). */
  comments: number;
  /** Pliki w `word/media/` (obrazy, także logo z nagłówka). */
  images: number;
  /** Pliki w `word/embeddings/` (osadzone arkusze, dokumenty, obiekty OLE). */
  embeddings: number;
  /** Ciągłe fragmenty tekstu ukrytego (`w:vanish`) w treści głównej. */
  hidden: number;
  /** Wstawienia śledzonych zmian z treścią (`<w:ins>…</w:ins>`). */
  insertions: number;
  /** Usunięcia śledzonych zmian z treścią (`<w:del>…</w:del>`). */
  deletions: number;
}

/** Prefiks WordprocessingML części; bez deklaracji zakładamy zwyczajowe „w”. */
const prefixOf = (xml: string): string => wmlPrefix(xml) ?? 'w';

/** Nazwa elementu bez ucieczek, do indexOf („w:t”, „ns0:t”, „t”). */
const rawName = (prefix: string, local: string): string => (prefix ? `${prefix}:` : '') + local;

/**
 * Znaczniki otwierające `local` (bez samozamykających, gdy `withBody`) i treść do zamknięcia.
 * Zamknięcie szukane przez indexOf od miejsca za otwarciem, a następne otwarcie za zamknięciem,
 * więc tekst czytamy raz, także przy niedomkniętym elemencie.
 */
function* elements(
  xml: string,
  prefix: string,
  local: string,
): Generator<{ attrs: string; body: string | null }> {
  const open = new RegExp(`<${wmlName(prefix, local)}(?=[\\s/>])([^<>]*)>`, 'g');
  const close = `</${rawName(prefix, local)}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null) {
    if (m[1].endsWith('/')) {
      yield { attrs: m[1], body: null };
      continue;
    }
    const end = xml.indexOf(close, open.lastIndex);
    const body = xml.slice(open.lastIndex, end < 0 ? xml.length : end);
    open.lastIndex = end < 0 ? xml.length : end + close.length;
    yield { attrs: m[1], body };
  }
}

// Separatory przypisów (kreska nad przypisami i jej przedłużenie na następnej stronie) Word
// zapisuje jako przypisy specjalnego typu. Nie ma w nich tekstu użytkownika.
const NOTE_SEPARATORS = new Set(['separator', 'continuationSeparator']);

function countNotes(xml: string, local: 'footnote' | 'endnote'): number {
  const prefix = prefixOf(xml);
  let n = 0;
  for (const { attrs, body } of elements(xml, prefix, local)) {
    const type = attrs.match(/\s(?:[^\s=]+:)?type\s*=\s*["']([^"']*)["']/)?.[1] ?? '';
    if (body !== null && !NOTE_SEPARATORS.has(type) && wmlText(body, prefix) !== '') n++;
  }
  return n;
}

/** Ile ciągłych fragmentów tekstu z `w:vanish` (bez `w:val="0"`) jest w treści głównej. */
function countHidden(xml: string, prefix: string): number {
  const vanish = new RegExp(`<${wmlName(prefix, 'vanish')}(?=[\\s/>])([^<>]*)>`);
  // Tylko początek tekstu: `\s*[^<\s]` nie cofa się kwadratowo przy długim, niedomkniętym <w:t>.
  const text = new RegExp(`<${wmlName(prefix, 't')}(?:\\s[^<>]*)?>\\s*[^<\\s]`);
  const rPrOpen = `<${rawName(prefix, 'rPr')}`;
  const rPrClose = `</${rawName(prefix, 'rPr')}>`;
  let count = 0;
  let prevHidden = false;
  for (const { body } of elements(xml, prefix, 'r')) {
    // run bez tekstu (sam tabulator, przypis, usunięcie) nie przerywa ukrytego fragmentu
    if (body === null || !text.test(body)) continue;
    const from = body.indexOf(rPrOpen);
    const to = from < 0 ? -1 : body.indexOf(rPrClose, from);
    const props = to < 0 ? '' : body.slice(from, to);
    const v = props.match(vanish);
    const hidden = !!v && !/\s(?:[^\s=]+:)?val\s*=\s*["'](?:0|false|off)["']/.test(v[1]);
    if (hidden && !prevHidden) count++;
    prevHidden = hidden;
  }
  return count;
}

/** Ile elementów `local` ma treść (samozamykające znaczniki zmian akapitu się nie liczą). */
function countWithBody(xml: string, prefix: string, local: string): number {
  let n = 0;
  for (const { body } of elements(xml, prefix, local)) if (body !== null) n++;
  return n;
}

/**
 * Spis części dokumentu poza treścią główną. Rzuca FileReadError, gdy plik nie jest poprawnym
 * ZIP-em albo części przekraczają limit; wywołujący mówi wtedy, że spisu nie zrobiono.
 */
export function inventoryDocx(buf: Uint8Array): DocxInventory {
  const entries = docxEntries(buf);
  let budget = MAX_XML_BYTES;
  const read = (e: ZipEntry): string => {
    const xml = readDocxPart(buf, e, budget);
    budget -= xml.length;
    return xml;
  };
  const inv: DocxInventory = {
    headersFooters: 0,
    notes: 0,
    comments: 0,
    images: 0,
    embeddings: 0,
    hidden: 0,
    insertions: 0,
    deletions: 0,
  };
  for (const e of entries) {
    const name = e.name;
    if (name.endsWith('/')) continue; // katalog
    if (name.startsWith('word/media/')) inv.images++;
    else if (name.startsWith('word/embeddings/')) inv.embeddings++;
    else if (/^word\/(?:header|footer)\d*\.xml$/.test(name)) {
      const xml = read(e);
      if (wmlText(xml, prefixOf(xml)) !== '') inv.headersFooters++;
    } else if (name === 'word/footnotes.xml') inv.notes += countNotes(read(e), 'footnote');
    else if (name === 'word/endnotes.xml') inv.notes += countNotes(read(e), 'endnote');
    else if (name === 'word/comments.xml') {
      const xml = read(e);
      inv.comments += [...elements(xml, prefixOf(xml), 'comment')].length;
    } else if (name === 'word/document.xml') {
      const xml = readDocxPart(buf, e);
      const prefix = prefixOf(xml);
      inv.hidden = countHidden(xml, prefix);
      inv.insertions = countWithBody(xml, prefix, 'ins');
      inv.deletions = countWithBody(xml, prefix, 'del');
    }
  }
  return inv;
}

/**
 * Dopisek po wczytaniu DOCX: czego Parawan nie przeczytał (tylko niezerowe pozycje) i osobno
 * ukryty tekst, który jest w polu źródła. Pusty napis, gdy nie ma o czym mówić. `null` znaczy,
 * że spisu nie udało się zrobić, i wtedy też trzeba o tym powiedzieć, a nie milczeć.
 */
export function docxInventoryNote(inv: DocxInventory | null): string {
  const review = 'Przejrzyj je przed publikacją albo publikuj nowy dokument zapisany z wyniku.';
  if (!inv) {
    return (
      'Wczytano treść główną dokumentu. Parawan nie sprawdził, czy plik ma też nagłówki, ' +
      `stopki, przypisy albo komentarze. ${review}`
    );
  }
  const skipped = [
    [inv.headersFooters, 'nagłówków i stopek'],
    [inv.notes, 'przypisów'],
    [inv.comments, 'komentarzy'],
    [inv.images, 'obrazów'],
    [inv.embeddings, 'obiektów osadzonych'],
    [inv.deletions, 'tekstu usuniętego w śledzonych zmianach'],
  ] as const;
  const list = skipped.filter(([n]) => n > 0).map(([n, what]) => `${what} (${n})`);
  const out: string[] = [];
  if (list.length) {
    out.push(`Wczytano treść główną dokumentu. Parawan nie czyta: ${list.join(', ')}. ${review}`);
  }
  if (inv.hidden > 0) {
    const h = inv.hidden;
    out.push(
      `Dokument ma ukryty tekst (${h} ${plural(h, 'fragment', 'fragmenty', 'fragmentów')}). ` +
        'Jest w polu źródła i został sprawdzony.',
    );
  }
  return out.join(' ');
}
