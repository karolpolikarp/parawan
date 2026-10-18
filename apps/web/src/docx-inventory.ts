/**
 * Spis części pliku .docx, których Parawan nie czyta. extractDocxText bierze tylko treść główną
 * (`word/document.xml`), a nagłówki, stopki, przypisy, komentarze, diagramy SmartArt, obrazy,
 * fragmenty wstawione z innych plików (`w:altChunk`), właściwości dokumentu i tekst usunięty
 * w śledzonych zmianach zostają w pliku. Bez tego spisu
 * urzędnik sądził, że sprawdził cały dokument, i publikował oryginał z nazwiskiem w stopce albo
 * w komentarzu. Spis liczy też tekst ukryty (`w:vanish` w runie albo w stylu z `word/styles.xml`):
 * Word go nie pokazuje, a w polu źródła i w wyniku stoi jak każdy inny.
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
  /**
   * Ciągłe fragmenty tekstu ukrytego w treści głównej: `w:vanish` w runie albo w stylu znaku,
   * akapitu lub w domyślnych właściwościach dokumentu (`word/styles.xml`). extractDocxText nie
   * patrzy na formatowanie, więc ten tekst jest w polu źródła i w wyniku jak każdy inny.
   */
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

/** Wartość atrybutu (z dowolnym prefiksem) w atrybutach znacznika albo undefined. */
function attrOf(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`\\s(?:[^\\s=]+:)?${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
}

/** `w:val="0"` (także false i off) wyłącza właściwość przełącznikową, np. `w:vanish`. */
const VAL_OFF = /\s(?:[^\s=]+:)?val\s*=\s*["'](?:0|false|off)["']/;

/**
 * Ukrycie tekstu stylem: `w:vanish` we właściwościach stylu akapitu albo znaku w
 * `word/styles.xml` (z dziedziczeniem `w:basedOn`) i w domyślnych właściwościach dokumentu
 * (`w:docDefaults`). Tak ukrywa się np. styl „Notatka wewnętrzna” albo „Ukryty”: w treści runu
 * nie ma wtedy żadnego `w:vanish`, a Word tekstu nie pokazuje ani nie drukuje.
 */
interface HiddenStyles {
  /** Styl akapitu i znaku po identyfikatorze: czy ukrywa tekst. */
  byId: Map<string, boolean>;
  /** Ukrywa styl domyślny akapitu („Normalny”), czyli akapit bez `w:pStyle`. */
  paragraphDefault: boolean;
  /** Ukrywa styl domyślny znaku, czyli run bez `w:rStyle`. */
  characterDefault: boolean;
  /** Ukrywają domyślne właściwości dokumentu: cały tekst bez jawnego `w:vanish w:val="0"`. */
  docDefault: boolean;
}

const NO_HIDDEN_STYLES: HiddenStyles = {
  byId: new Map(),
  paragraphDefault: false,
  characterDefault: false,
  docDefault: false,
};

/**
 * `w:vanish` w treści `w:rPr`: true, false (`w:val="0"`) albo undefined, gdy go nie ma.
 * `w:rPrChange` (dawne formatowanie w śledzonej zmianie) stoi na końcu `w:rPr` i się nie liczy.
 */
function vanishIn(rPr: string, prefixes: readonly string[]): boolean | undefined {
  const current = rPr.split(new RegExp(`<${wmlName(prefixes, 'rPrChange')}(?=[\\s/>])`))[0];
  const v = current.match(new RegExp(`<${wmlName(prefixes, 'vanish')}(?=[\\s/>])([^<>]*)>`));
  return v ? !VAL_OFF.test(v[1]) : undefined;
}

/** Pierwszy element `local` w `xml`: jego treść, '' dla samozamykającego, null, gdy go nie ma. */
function firstBody(xml: string, prefixes: readonly string[], local: string): string | null {
  const first = elements(xml, wmlName(prefixes, local)).next();
  return first.done ? null : (first.value.body ?? '');
}

/** Style ukrywające tekst w `word/styles.xml`. */
function hiddenStyles(xml: string): HiddenStyles {
  const prefixes = prefixOf(xml);
  const basedOnTag = new RegExp(`<${wmlName(prefixes, 'basedOn')}(?=[\\s/>])([^<>]*)>`);
  const own = new Map<string, { basedOn?: string; vanish?: boolean }>();
  let paragraphDefault: string | undefined;
  let characterDefault: string | undefined;
  for (const { attrs, body } of elements(xml, wmlName(prefixes, 'style'))) {
    const id = attrOf(attrs, 'styleId');
    const type = attrOf(attrs, 'type') ?? 'paragraph';
    // Style tabel i numeracji nie stoją w w:pStyle ani w:rStyle.
    if (!id || body === null || (type !== 'paragraph' && type !== 'character')) continue;
    if (/^(?:1|true|on)$/.test(attrOf(attrs, 'default') ?? '')) {
      if (type === 'paragraph') paragraphDefault = id;
      else characterDefault = id;
    }
    const based = body.match(basedOnTag);
    const rPr = firstBody(body, prefixes, 'rPr');
    own.set(id, {
      basedOn: based ? attrOf(based[1], 'val') : undefined,
      vanish: rPr === null ? undefined : vanishIn(rPr, prefixes),
    });
  }
  // Styl dziedziczy po w:basedOn to, czego sam nie ustawia; pętla w łańcuchu nie zawiesza karty.
  const byId = new Map<string, boolean>();
  for (const id of own.keys()) {
    const seen = new Set<string>();
    let at: string | undefined = id;
    let vanish: boolean | undefined;
    while (at !== undefined && vanish === undefined && !seen.has(at)) {
      seen.add(at);
      vanish = own.get(at)?.vanish;
      at = own.get(at)?.basedOn;
    }
    byId.set(id, vanish ?? false);
  }
  const defaults = firstBody(xml, prefixes, 'rPrDefault');
  const defaultsRPr = defaults === null ? null : firstBody(defaults, prefixes, 'rPr');
  return {
    byId,
    paragraphDefault: paragraphDefault !== undefined && byId.get(paragraphDefault) === true,
    characterDefault: characterDefault !== undefined && byId.get(characterDefault) === true,
    docDefault: defaultsRPr !== null && vanishIn(defaultsRPr, prefixes) === true,
  };
}

type HiddenCtx =
  | { kind: 'p'; style: string | null }
  | { kind: 'r'; style: string | null; direct: boolean | undefined; text: boolean }
  | { kind: 'pPr' | 'rPr' | 'change' };

const CTX_OF: Record<string, HiddenCtx['kind'] | undefined> = {
  p: 'p',
  r: 'r',
  pPr: 'pPr',
  rPr: 'rPr',
  pPrChange: 'change',
  rPrChange: 'change',
};

/**
 * Ile ciągłych fragmentów ukrytego tekstu jest w treści głównej. Run jest ukryty przez `w:vanish`
 * w swoich właściwościach (`w:val="0"` jawnie odkrywa), a bez niego przez styl znaku (`w:rStyle`),
 * styl akapitu (`w:pStyle`, bez niego styl domyślny) albo domyślne właściwości dokumentu.
 * `w:vanish` we właściwościach znaku końca akapitu (`w:pPr/w:rPr`) ukrywa sam znak akapitu i się
 * nie liczy, tak samo dawne formatowanie w śledzonych zmianach. Word traktuje `w:vanish` w dwóch
 * stylach naraz (akapitu i znaku) jak przełącznik, który się znosi; tu taki tekst liczy się jako
 * ukryty, bo fałszywe ostrzeżenie kosztuje mniej niż przeoczone.
 */
function countHidden(xml: string, prefixes: readonly string[], styles: HiddenStyles): number {
  const names = ['p', 'r', 'pPr', 'rPr', 'pPrChange', 'rPrChange', 'pStyle', 'rStyle', 'vanish', 't'];
  const tag = new RegExp(
    `<(/?)(${names.map((l) => wmlName(prefixes, l)).join('|')})(?=[\\s/>])([^<>]*)>`,
    'g',
  );
  // Tylko początek tekstu: `\s*[^<\s]` nie cofa się kwadratowo przy długim, niedomkniętym <w:t>.
  const textStart = /\s*[^<\s]/y;
  const styleHidden = (id: string | null, fallback: boolean): boolean =>
    id !== null && styles.byId.has(id) ? styles.byId.get(id) === true : fallback;
  // Stos otwartych elementów, osobno otwarte akapity i liczba otwartych elementów każdego
  // rodzaju: zamknięcie bez otwarcia nie przeszukuje stosu, a uszkodzony plik z tysiącami
  // niedomkniętych znaczników nie kosztuje kwadratowo.
  const stack: HiddenCtx[] = [];
  const paras: Extract<HiddenCtx, { kind: 'p' }>[] = [];
  const open = new Map<HiddenCtx['kind'], number>();
  const push = (ctx: HiddenCtx): void => {
    stack.push(ctx);
    if (ctx.kind === 'p') paras.push(ctx);
    open.set(ctx.kind, (open.get(ctx.kind) ?? 0) + 1);
  };
  let count = 0;
  let prevHidden = false;
  /** Zdejmuje ze stosu wszystko od pozycji `at`, od góry; run rozstrzyga, póki jego akapit stoi niżej. */
  const popTo = (at: number): void => {
    while (stack.length > at) {
      const ctx = stack[stack.length - 1];
      if (ctx.kind === 'r') finish(ctx);
      if (ctx.kind === 'p') paras.pop();
      open.set(ctx.kind, (open.get(ctx.kind) ?? 1) - 1);
      stack.pop();
    }
  };
  const finish = (run: Extract<HiddenCtx, { kind: 'r' }>): void => {
    // run bez tekstu (sam tabulator, przypis, usunięcie) nie przerywa ukrytego fragmentu
    if (!run.text) return;
    const pStyle = paras[paras.length - 1]?.style ?? null;
    const hidden =
      run.direct ??
      (styles.docDefault ||
        styleHidden(pStyle, styles.paragraphDefault) ||
        styleHidden(run.style, styles.characterDefault));
    if (hidden && !prevHidden) count++;
    prevHidden = hidden;
  };
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml)) !== null) {
    const local = m[2].slice(m[2].indexOf(':') + 1);
    const kind = CTX_OF[local];
    if (m[1]) {
      // zamknięcie: zdejmujemy do pasującego otwarcia (niedomknięte wnętrze też)
      if (!kind || !open.get(kind)) continue;
      let at = stack.length - 1;
      while (stack[at].kind !== kind) at--;
      popTo(at);
      continue;
    }
    const selfClosing = m[3].endsWith('/');
    const top = stack[stack.length - 1];
    const owner = stack[stack.length - 2];
    if (kind === 'p') {
      if (!selfClosing) push({ kind: 'p', style: null });
    } else if (kind === 'r') {
      if (!selfClosing) push({ kind: 'r', style: null, direct: undefined, text: false });
    } else if (kind) {
      if (!selfClosing) push({ kind });
    } else if (local === 'pStyle') {
      if (top?.kind === 'pPr' && owner?.kind === 'p') owner.style = attrOf(m[3], 'val') ?? null;
    } else if (local === 'rStyle' || local === 'vanish') {
      if (top?.kind !== 'rPr' || owner?.kind !== 'r') continue;
      if (local === 'rStyle') owner.style = attrOf(m[3], 'val') ?? null;
      else owner.direct = !VAL_OFF.test(m[3]);
    } else if (local === 't' && !selfClosing && top?.kind === 'r') {
      textStart.lastIndex = tag.lastIndex;
      if (textStart.test(xml)) top.text = true;
    }
  }
  popTo(0); // niedomknięte runy na końcu (uszkodzony plik) też się liczą
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
  let documentEntry: ZipEntry | undefined;
  let stylesEntry: ZipEntry | undefined;
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
    else if (name === 'word/styles.xml') stylesEntry = e;
    else if (name === 'word/document.xml') documentEntry = e;
  }
  // Treść główna na końcu: ukrycie stylem wymaga stylów, a ZIP bywa w dowolnej kolejności.
  if (documentEntry) {
    const xml = readDocxPart(buf, documentEntry);
    const prefixes = prefixOf(xml);
    const styles = stylesEntry ? hiddenStyles(read(stylesEntry)) : NO_HIDDEN_STYLES;
    inv.hidden = countHidden(xml, prefixes, styles);
    inv.insertions = countWithBody(xml, prefixes, 'ins');
    inv.deletions = countWithBody(xml, prefixes, 'del');
    inv.altChunks = [...elements(xml, wmlName(prefixes, 'altChunk'))].length;
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
