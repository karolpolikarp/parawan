/**
 * Spis części pliku .docx, których Parawan nie czyta. extractDocxText bierze tylko treść główną
 * (`word/document.xml`), a nagłówki, stopki, przypisy, komentarze, diagramy SmartArt, obrazy,
 * fragmenty wstawione z innych plików (`w:altChunk`), właściwości dokumentu i tekst usunięty
 * w śledzonych zmianach zostają w pliku. Bez tego spisu
 * urzędnik sądził, że sprawdził cały dokument, i publikował oryginał z nazwiskiem w stopce albo
 * w komentarzu.
 *
 * Same liczby, bez treści: komunikat po wczytaniu mówi, ile czego jest, a nie co tam stoi.
 * Rozpakowujemy tu więcej wpisów ZIP niż przy odczycie treści, więc wszystkie części poza
 * `word/document.xml` mają jeden wspólny limit MAX_XML_BYTES (bomba ZIP rozłożona na tysiąc
 * nagłówków też nie zamrozi karty), a sam `word/document.xml` ten sam limit co w docx.ts.
 */

import { docxEntries, MAX_XML_BYTES, readDocxPart, wmlName, wmlPrefixes, wmlText } from './docx';
import { plural } from './plural';
import type { ZipEntry } from './zip';

export interface DocxInventory {
  /** Części `word/header*.xml` i `word/footer*.xml` z niepustym tekstem. */
  headersFooters: number;
  /** Przypisy dolne i końcowe z tekstem, bez separatorów, które Word dopisuje sam. */
  notes: number;
  /** Komentarze (`w:comment`). */
  comments: number;
  /**
   * Diagramy SmartArt z tekstem (`word/diagrams/data*.xml`). Ich tekst widać w treści, ale
   * w `word/document.xml` stoi tylko odsyłacz, więc do pola nie trafia.
   */
  diagrams: number;
  /** Pliki w `word/media/` (obrazy, także logo z nagłówka). */
  images: number;
  /** Pliki w `word/embeddings/` (osadzone arkusze, dokumenty, obiekty OLE). */
  embeddings: number;
  /**
   * Fragmenty wstawione z osobnych plików (`w:altChunk` w treści głównej, np. HTML z przycisku
   * „Pobierz jako Word” albo scalanie korespondencji). Word pokazuje je jak zwykły tekst, ale
   * w `word/document.xml` stoi tylko odsyłacz, więc do pola nie trafiają.
   */
  altChunks: number;
  /** Ciągłe fragmenty tekstu ukrytego (`w:vanish`) w treści głównej. */
  hidden: number;
  /** Wstawienia śledzonych zmian z treścią (`<w:ins>…</w:ins>`). */
  insertions: number;
  /** Usunięcia śledzonych zmian z treścią (`<w:del>…</w:del>`). */
  deletions: number;
  /**
   * Wypełnione właściwości dokumentu (Plik › Informacje): tytuł, temat, słowa kluczowe, komentarze
   * i właściwości niestandardowe z tekstem, w które systemy EZD wpisują dane sprawy.
   */
  properties: number;
}

/** Prefiksy WordprocessingML części; bez deklaracji zakładamy zwyczajowe „w”. */
const prefixOf = (xml: string): string[] => wmlPrefixes(xml) ?? ['w'];

/** Dowolny prefiks przed nazwą lokalną (właściwości i DrawingML mają własne przestrzenie nazw). */
const ANY = '(?:[^\\s<>/:]+:)?';

/**
 * Znaczniki otwierające o nazwie pasującej do `name` (źródło wyrażenia) i treść do zamknięcia;
 * `body` to null dla znacznika samozamykającego. Zamknięcie szukane przez indexOf od miejsca za
 * otwarciem, a następne otwarcie za zamknięciem, więc tekst czytamy raz, także przy niedomkniętym
 * elemencie.
 */
function* elements(xml: string, name: string): Generator<{ attrs: string; body: string | null }> {
  const open = new RegExp(`<(${name})(?=[\\s/>])([^<>]*)>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null) {
    if (m[2].endsWith('/')) {
      yield { attrs: m[2], body: null };
      continue;
    }
    const end = xml.indexOf(`</${m[1]}>`, open.lastIndex);
    const body = xml.slice(open.lastIndex, end < 0 ? xml.length : end);
    open.lastIndex = end < 0 ? xml.length : end + m[1].length + 3;
    yield { attrs: m[2], body };
  }
}

// Separatory przypisów (kreska nad przypisami i jej przedłużenie na następnej stronie) Word
// zapisuje jako przypisy specjalnego typu. Nie ma w nich tekstu użytkownika.
const NOTE_SEPARATORS = new Set(['separator', 'continuationSeparator']);

function countNotes(xml: string, local: 'footnote' | 'endnote'): number {
  const prefixes = prefixOf(xml);
  let n = 0;
  for (const { attrs, body } of elements(xml, wmlName(prefixes, local))) {
    const type = attrs.match(/\s(?:[^\s=]+:)?type\s*=\s*["']([^"']*)["']/)?.[1] ?? '';
    if (body !== null && !NOTE_SEPARATORS.has(type) && wmlText(body, prefixes) !== '') n++;
  }
  return n;
}

/** Ile ciągłych fragmentów tekstu z `w:vanish` (bez `w:val="0"`) jest w treści głównej. */
function countHidden(xml: string, prefixes: readonly string[]): number {
  const vanish = new RegExp(`<${wmlName(prefixes, 'vanish')}(?=[\\s/>])([^<>]*)>`);
  // Tylko początek tekstu: `\s*[^<\s]` nie cofa się kwadratowo przy długim, niedomkniętym <w:t>.
  const text = new RegExp(`<${wmlName(prefixes, 't')}(?:\\s[^<>]*)?>\\s*[^<\\s]`);
  // Zamknięcie szukane przez indexOf z nazwą, która naprawdę stoi w otwarciu (prefiksów bywa kilka).
  const rPr = new RegExp(`<(${wmlName(prefixes, 'rPr')})(?=[\\s/>])`);
  let count = 0;
  let prevHidden = false;
  for (const { body } of elements(xml, wmlName(prefixes, 'r'))) {
    // run bez tekstu (sam tabulator, przypis, usunięcie) nie przerywa ukrytego fragmentu
    if (body === null || !text.test(body)) continue;
    const open = rPr.exec(body);
    const to = open ? body.indexOf(`</${open[1]}>`, open.index) : -1;
    const props = open && to >= 0 ? body.slice(open.index, to) : '';
    const v = props.match(vanish);
    const hidden = !!v && !/\s(?:[^\s=]+:)?val\s*=\s*["'](?:0|false|off)["']/.test(v[1]);
    if (hidden && !prevHidden) count++;
    prevHidden = hidden;
  }
  return count;
}

/** Ile elementów `local` ma treść (samozamykające znaczniki zmian akapitu się nie liczą). */
function countWithBody(xml: string, prefixes: readonly string[], local: string): number {
  let n = 0;
  for (const { body } of elements(xml, wmlName(prefixes, local))) if (body !== null) n++;
  return n;
}

// Tekst DrawingML (`<a:t>`) w danych diagramu. `<dgm:t>` też nazywa się „t”, ale zaczyna się od
// znacznika, a nie od tekstu, więc się nie łapie.
const DRAWING_TEXT = new RegExp(`<${ANY}t(?:\\s[^<>]*)?>\\s*[^<\\s]`);

// Właściwości, które wpisuje sam program, a nie człowiek: identyfikatory SharePointa, etykiety
// poufności i domyślny opis z python-docx. Bez tego co drugi plik z systemu miałby fałszywy alarm.
const TECH_PROPERTY = /^(?:ContentTypeId$|MSIP_Label_|_dlc_)/;
const DEFAULT_VALUES = new Set(['generated by python-docx']);

/** Wypełnione pola tytułu, tematu, słów kluczowych i komentarzy w `docProps/core.xml`. */
function countCoreProperties(xml: string): number {
  let n = 0;
  for (const name of ['title', 'subject', 'keywords', 'description']) {
    const m = xml.match(new RegExp(`<${ANY}${name}(?:\\s[^<>]*)?>([^<]*)<`));
    const value = m?.[1].trim() ?? '';
    if (value && !DEFAULT_VALUES.has(value)) n++;
  }
  return n;
}

/** Właściwości niestandardowe z tekstem w `docProps/custom.xml`, bez technicznych. */
function countCustomProperties(xml: string): number {
  const text = new RegExp(`<${ANY}(?:lpwstr|lpstr|bstr)(?:\\s[^<>]*)?>\\s*[^<\\s]`);
  let n = 0;
  for (const { attrs, body } of elements(xml, `${ANY}property`)) {
    const name = attrs.match(/\sname\s*=\s*["']([^"']*)["']/)?.[1] ?? '';
    if (body !== null && !TECH_PROPERTY.test(name) && text.test(body)) n++;
  }
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
    diagrams: 0,
    images: 0,
    embeddings: 0,
    altChunks: 0,
    hidden: 0,
    insertions: 0,
    deletions: 0,
    properties: 0,
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
      inv.comments += [...elements(xml, wmlName(prefixOf(xml), 'comment'))].length;
    } else if (/^word\/diagrams\/data\d*\.xml$/.test(name)) {
      if (DRAWING_TEXT.test(read(e))) inv.diagrams++;
    } else if (name === 'docProps/core.xml') inv.properties += countCoreProperties(read(e));
    else if (name === 'docProps/custom.xml') inv.properties += countCustomProperties(read(e));
    else if (name === 'word/document.xml') {
      const xml = readDocxPart(buf, e);
      const prefixes = prefixOf(xml);
      inv.hidden = countHidden(xml, prefixes);
      inv.insertions = countWithBody(xml, prefixes, 'ins');
      inv.deletions = countWithBody(xml, prefixes, 'del');
      inv.altChunks = [...elements(xml, wmlName(prefixes, 'altChunk'))].length;
    }
  }
  return inv;
}

/** Niezerowe pozycje spisu w dopełniaczu, do zdania „Parawan nie czyta: …”. */
function skippedList(inv: DocxInventory): string[] {
  const skipped = [
    [inv.headersFooters, 'nagłówków i stopek'],
    [inv.notes, 'przypisów'],
    [inv.comments, 'komentarzy'],
    [inv.diagrams, 'diagramów SmartArt'],
    [inv.images, 'obrazów'],
    [inv.embeddings, 'obiektów osadzonych'],
    [inv.altChunks, 'fragmentów wstawionych z innych plików'],
    [inv.deletions, 'fragmentów usuniętych w śledzonych zmianach'],
    [inv.properties, 'właściwości dokumentu'],
  ] as const;
  return skipped.filter(([n]) => n > 0).map(([n, what]) => `${what} (${n})`);
}

// Word przy otwarciu wstawia te fragmenty do treści, a przy zapisie zapisuje je już jako zwykłe
// akapity (sprawdzone na plikach w stylu html-docx-js i OpenXML SDK), więc jest prosta droga,
// żeby Parawan je przeczytał.
const ALT_CHUNK_HINT =
  ' Wstawione fragmenty wyglądają w Wordzie jak zwykły tekst. Gdy zapiszesz tam dokument ponownie, ' +
  'Parawan je przeczyta.';

/**
 * Dopisek po wczytaniu DOCX: czego Parawan nie przeczytał (tylko niezerowe pozycje) i w osobnym
 * wierszu ukryty tekst, który jest w polu źródła. Ostrzeżenie i zdanie o tym, co sprawdzono,
 * w jednym akapicie kończyły się słowem „sprawdzony” i osłabiały ostrzeżenie. Pusty napis, gdy
 * nie ma o czym mówić. `null` znaczy, że spisu nie udało się zrobić, i wtedy też trzeba o tym
 * powiedzieć, a nie milczeć.
 */
export function docxInventoryNote(inv: DocxInventory | null): string {
  const review = 'Przejrzyj je przed publikacją albo publikuj nowy dokument zapisany z wyniku.';
  if (!inv) {
    return (
      'Wczytano treść główną dokumentu. Parawan nie sprawdził, czy plik ma też nagłówki, ' +
      `stopki, przypisy albo komentarze. ${review}`
    );
  }
  const list = skippedList(inv);
  const out: string[] = [];
  if (list.length) {
    const alt = inv.altChunks > 0 ? ALT_CHUNK_HINT : '';
    out.push(`Wczytano treść główną dokumentu. Parawan nie czyta: ${list.join(', ')}. ${review}${alt}`);
  }
  if (inv.hidden > 0) {
    // Nie „został sprawdzony”: to brzmiało jak uspokojenie, a ukryte zdanie stoi w wyniku jak
    // każde inne i trafi do publikacji, choć w oryginale nikt go nie widział.
    const h = inv.hidden;
    out.push(
      `Dokument ma ukryty tekst (${h} ${plural(h, 'fragment', 'fragmenty', 'fragmentów')}). ` +
        'W polu źródła i w wyniku widać go jak zwykły tekst. Usuń go, jeśli nie ma trafić do publikacji.',
    );
  }
  return out.join('\n');
}

/**
 * Błąd dla DOCX bez tekstu w treści głównej. Zwykłe „Plik jest pusty” jest wtedy nieprawdą, gdy
 * dane stoją w nagłówku albo plik to skan wklejony do Worda jako obraz, a urzędnik uznałby taki
 * plik za czysty. `null`, gdy w pliku naprawdę nic nie ma i wystarczy „Plik jest pusty”.
 */
export function docxEmptyBodyError(inv: DocxInventory | null): string | null {
  const intro = 'W treści głównej dokumentu nie ma tekstu.';
  if (!inv) {
    return (
      `${intro} Parawan nie sprawdził, czy plik ma nagłówki, stopki, przypisy albo komentarze, ` +
      'więc przejrzyj go w Wordzie przed publikacją.'
    );
  }
  const list = skippedList(inv);
  if (!list.length) return null;
  const scan =
    inv.images + inv.embeddings > 0
      ? ' Jeśli to skan, wklej tekst ręcznie, bo rozpoznawanie tekstu ze skanów (OCR) nie jest obsługiwane.'
      : '';
  const alt = inv.altChunks > 0 ? ALT_CHUNK_HINT : '';
  return (
    `${intro} Plik nie jest jednak pusty, Parawan nie czyta w nim: ${list.join(', ')}. ` +
    `Przejrzyj je w Wordzie przed publikacją.${alt}${scan}`
  );
}
