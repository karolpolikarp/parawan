/**
 * Ekstrakcja tekstu z pliku .docx — w całości lokalnie, bez ciężkich zależności.
 *
 * DOCX to ZIP z XML-em w środku; treść dokumentu żyje w `word/document.xml`,
 * a widoczny tekst — w elementach `<w:t>`. Rozpakowujemy (zip.ts) TYLKO ten jeden wpis
 * (z limitem rozmiaru, więc bomba ZIP nie zamrozi karty) i zbieramy tekst runów,
 * wstawiając \n za końce akapitów (`</w:p>`), puste akapity (`<w:p/>`), `<w:br/>` i `<w:cr/>`,
 * \t za `<w:tab/>` oraz zwykły „-” za twardy łącznik `<w:noBreakHyphen/>` (bez niego kod
 * pocztowy „00-950” skleja się w „00950” i przechodzi jawny). Bez `<w:cr/>` „Jan” i „Kowalski”
 * z dwóch wierszy sklejały się w „JanKowalski” i nazwisko przechodziło jawne. Łącznik miękki
 * `<w:softHyphen/>` pomijamy, bo w tekście go nie widać. Pola tekstowe Word zapisuje dwa razy
 * (`mc:Choice` i zapasowo `mc:Fallback`), więc gałęzie `mc:Fallback` usuwamy, żeby treść nie
 * dublowała się w wyniku i licznikach.
 *
 * Prefiks `w:` to tylko zwyczaj Worda: niektóre generatory piszą `ns0:` albo przestrzeń
 * domyślną. Prefiks czytamy więc z deklaracji w elemencie głównym.
 *
 * To świadomie NIE jest pełny konwerter (tabele/format spłaszczają się do tekstu) —
 * do anonimizacji liczy się treść, nie układ.
 */

import { strFromU8 } from 'fflate';
import { FileReadError } from './files';
import { listZipEntries, readZipEntry, type ZipEntry } from './zip';

const XML_ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|apos|#[xX][0-9A-Fa-f]+|#[0-9]+);/g, (m, ent: string) => {
    if (ent[0] !== '#') return XML_ENTITY[ent] ?? m;
    const code =
      ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
    // Encja spoza Unicode (np. &#x110000;) zostaje dosłownie: String.fromCodePoint rzuciłby
    // RangeError, a jedna zła encja zablokowałaby wczytanie całego dokumentu.
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

// Sygnatura kontenera OLE (Compound File). W takim pliku Word zapisuje stary .doc
// oraz .docx zabezpieczony hasłem (wtedy w środku jest strumień „EncryptedPackage”).
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Czy w buforze występuje napis zapisany w UTF-16LE (tak OLE zapisuje nazwy strumieni)? */
function includesUtf16(buf: Uint8Array, s: string): boolean {
  const needle = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) needle[i * 2] = s.charCodeAt(i);
  for (let i = 0; i + needle.length <= buf.length; i++) {
    let j = 0;
    while (j < needle.length && buf[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
  }
  return false;
}

// Górny limit rozpakowanej części XML (`word/document.xml`, nagłówka, przypisów).
// Zwykłe pismo to kilkadziesiąt-kilkaset KB.
export const MAX_XML_BYTES = 50 * 1024 * 1024;

export const NOT_DOCX = 'Nie udało się odczytać pliku. To nie wygląda na poprawny dokument Word (.docx).';
const ODD_DOCX =
  'Ten plik .docx ma nietypową budowę i Parawan nie odczyta jego treści. Otwórz go w Wordzie ' +
  'albo LibreOffice, zapisz ponownie jako .docx i wczytaj jeszcze raz.';

/**
 * Przestrzeń nazw WordprocessingML: przejściowa (zwykły .docx) i ścisła ISO 29500 Strict
 * („Ścisły dokument Open XML” w oknie zapisu Worda). Nazwy elementów są w obu takie same.
 */
const WML_NS = [
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  'http://purl.oclc.org/ooxml/wordprocessingml/main',
];

/** Wpisy ZIP-a; każdy błąd budowy pliku to komunikat „to nie jest .docx”. */
export function docxEntries(buf: Uint8Array): ZipEntry[] {
  try {
    return listZipEntries(buf);
  } catch (err) {
    throw err instanceof FileReadError ? err : new FileReadError(NOT_DOCX);
  }
}

/** Rozpakowana część XML jako tekst, z limitem `limit` bajtów (domyślnie MAX_XML_BYTES). */
export function readDocxPart(buf: Uint8Array, entry: ZipEntry, limit = MAX_XML_BYTES): string {
  try {
    return strFromU8(readZipEntry(buf, entry, limit));
  } catch (err) {
    throw err instanceof FileReadError ? err : new FileReadError(NOT_DOCX);
  }
}

/**
 * Prefiks, pod którym część XML deklaruje WordprocessingML w elemencie głównym („w”, „ns0”,
 * pusty napis dla przestrzeni domyślnej) albo null, gdy deklaracji nie ma. Najpierw prefiks samego
 * elementu głównego, potem dowolny inny związany z tą przestrzenią. Skan indexOf zamiast wyrażeń
 * z `[\s\S]*?`: niedomknięty komentarz albo instrukcja nie skanują tekstu wielokrotnie.
 */
export function wmlPrefix(xml: string): string | null {
  let at = 0;
  for (;;) {
    at = xml.indexOf('<', at);
    if (at < 0) return null;
    // deklaracja XML, komentarz i DOCTYPE przed elementem głównym
    const close = xml.startsWith('<?', at)
      ? '?>'
      : xml.startsWith('<!--', at)
        ? '-->'
        : xml.startsWith('<!', at)
          ? '>'
          : '';
    if (!close) break;
    const end = xml.indexOf(close, at + 2);
    if (end < 0) return null;
    at = end + close.length;
  }
  const end = xml.indexOf('>', at);
  if (end < 0) return null;
  const tag = xml.slice(at + 1, end);
  const name = tag.match(/^[^\s/>]+/)?.[0] ?? '';
  const bound = new Map<string, string>();
  for (const a of tag.matchAll(/\sxmlns(?::([^\s=/>]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    bound.set(a[1] ?? '', a[2] ?? a[3] ?? '');
  }
  const own = name.includes(':') ? name.slice(0, name.indexOf(':')) : '';
  if (WML_NS.includes(bound.get(own) ?? '')) return own;
  for (const [prefix, uri] of bound) if (WML_NS.includes(uri)) return prefix;
  return null;
}

/** Nazwa elementu z prefiksem do wyrażenia regularnego: „w:t”, „ns0:t” albo „t”. */
export function wmlName(prefix: string, local: string): string {
  return (prefix ? `${prefix.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}:` : '') + local;
}

const tokenizers = new Map<string, RegExp>();

/**
 * Wyrażenie wyciągające tekst dla danego prefiksu. `[^<>]` i `[^<]` zamiast `[^>]`
 * i `[\s\S]*?`: niedomknięty znacznik nie skanuje do końca tekstu (koszt kwadratowy), a w <w:t>
 * i tak nie ma „<” (XML zapisuje go jako &lt;). `(?=[\s/>])` za nazwą, żeby `<w:p/>` nie łapało
 * `<w:pPr/>`, a `<w:t>` nie łapało `<w:tab/>` ani `<w:delText>` (tekstu usuniętego w śledzonej
 * zmianie, którego w dokumencie już nie widać).
 */
function tokenizer(prefix: string): RegExp {
  let re = tokenizers.get(prefix);
  if (!re) {
    const n = (local: string): string => wmlName(prefix, local);
    re = new RegExp(
      `<${n('t')}(?:\\s[^<>]*)?>([^<]*)</${n('t')}>|</${n('p')}>|<${n('p')}(?=[\\s/])[^<>]*/>` +
        `|<(${n('tab')}|${n('br')}|${n('cr')}|${n('noBreakHyphen')})(?=[\\s/>])[^<>]*/>`,
      'g',
    );
    tokenizers.set(prefix, re);
  }
  re.lastIndex = 0;
  return re;
}

/**
 * Usuń zapasowe gałęzie `mc:Fallback` (razem z zagnieżdżonymi) jednym przebiegiem z licznikiem
 * głębokości. Dawna pętla wyrażeń regularnych zdejmowała jeden poziom na przebieg, a `[^>]*` od
 * niedomkniętego „<mc:Fallback” skanowało do końca tekstu: plik .docx o rozmiarze 2–4 KB
 * zamrażał kartę na pół minuty. `[^<>]` kończy skan na najbliższym „<”.
 */
function dropFallbacks(xml: string): string {
  const tag = /<(\/?)mc:Fallback\b[^<>]*?(\/?)>/g;
  let out = '';
  let keepFrom = 0; // początek tekstu, który zostaje
  let depth = 0;
  let openAt = 0; // początek najbardziej zewnętrznej otwartej gałęzi
  let m: RegExpExecArray | null;
  while ((m = tag.exec(xml)) !== null) {
    if (m[1]) {
      // zamknięcie bez otwarcia zostawiamy, jak dawniej
      if (depth > 0 && --depth === 0) keepFrom = tag.lastIndex;
    } else if (depth > 0) {
      if (!m[2]) depth++;
    } else if (m[2]) {
      out += xml.slice(keepFrom, m.index);
      keepFrom = tag.lastIndex;
    } else {
      out += xml.slice(keepFrom, m.index);
      openAt = m.index;
      depth = 1;
    }
  }
  // gałąź bez zamknięcia (uszkodzony XML) zostaje w całości, jak przy dawnym wyrażeniu
  return out + xml.slice(depth > 0 ? openAt : keepFrom);
}

/**
 * Tekst fragmentu WordprocessingML (całej części albo jednego przypisu) dla danego prefiksu,
 * bez gałęzi `mc:Fallback`.
 */
export function wmlText(xml: string, prefix: string): string {
  const re = tokenizer(prefix);
  const parts: string[] = [];
  const src = dropFallbacks(xml);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // nazwa bez prefiksu („ns0:tab” → „tab”); bez dwukropka indexOf daje -1, czyli całość
    const local = m[2]?.slice(m[2].indexOf(':') + 1);
    if (m[1] !== undefined) parts.push(decodeXmlEntities(m[1]));
    else if (local === 'tab') parts.push('\t');
    else if (local === 'noBreakHyphen') parts.push('-');
    else parts.push('\n'); // </w:p>, <w:p/>, <w:br/> lub <w:cr/>
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** Wyciągnij czysty tekst z zawartości pliku .docx. Rzuca FileReadError dla nie-docx. */
export function extractDocxText(buf: Uint8Array): string {
  if (OLE_SIGNATURE.every((v, i) => buf[i] === v)) {
    throw new FileReadError(
      includesUtf16(buf, 'EncryptedPackage')
        ? 'Ten dokument jest chroniony hasłem. Zdejmij hasło w Wordzie, zapisz plik i wczytaj go ponownie.'
        : 'Ten dokument jest chroniony hasłem albo zapisany w starym formacie .doc. Zdejmij hasło ' +
            'lub zapisz go w Wordzie jako .docx i wczytaj ponownie.',
    );
  }

  // Rozpakowujemy wyłącznie treść dokumentu, innych wpisów nawet nie dotykamy.
  const entry = docxEntries(buf).find((e) => e.name === 'word/document.xml');
  if (!entry) throw new FileReadError('Ten plik nie jest dokumentem Word (.docx).');
  const xml = readDocxPart(buf, entry);
  // Bez deklaracji przestrzeni nazw nie wiadomo, które znaczniki niosą tekst. Dawniej taki plik
  // dawał mylące „Plik jest pusty”.
  const prefix = wmlPrefix(xml);
  if (prefix === null) throw new FileReadError(ODD_DOCX);
  return wmlText(xml, prefix);
}
