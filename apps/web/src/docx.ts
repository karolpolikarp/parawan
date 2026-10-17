/**
 * Ekstrakcja tekstu z pliku .docx — w całości lokalnie, bez ciężkich zależności.
 *
 * DOCX to ZIP z XML-em w środku; treść dokumentu żyje w `word/document.xml`,
 * a widoczny tekst — w elementach `<w:t>`. Rozpakowujemy maleńkim `fflate` TYLKO ten
 * jeden wpis (z limitem rozmiaru, więc bomba ZIP nie zamrozi karty) i zbieramy tekst runów,
 * wstawiając \n za końce akapitów (`</w:p>`) i `<w:br/>`, \t za `<w:tab/>` oraz zwykły „-”
 * za twardy łącznik `<w:noBreakHyphen/>` (bez niego kod pocztowy „00-950” skleja się
 * w „00950” i przechodzi jawny). Łącznik miękki `<w:softHyphen/>` pomijamy, bo w tekście go
 * nie widać. Pola tekstowe Word zapisuje dwa razy (`mc:Choice` i zapasowo `mc:Fallback`),
 * więc gałęzie `mc:Fallback` usuwamy, żeby treść nie dublowała się w wyniku i licznikach.
 * To świadomie NIE jest pełny konwerter (tabele/format spłaszczają się do tekstu) —
 * do anonimizacji liczy się treść, nie układ.
 */

import { Inflate, strFromU8 } from 'fflate';
import { FileReadError } from './files';

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

// Górny limit rozpakowanego `word/document.xml`. Zwykłe pismo to kilkadziesiąt-kilkaset KB.
const MAX_XML_BYTES = 50 * 1024 * 1024;

const NOT_DOCX = 'Nie udało się odczytać pliku. To nie wygląda na poprawny dokument Word (.docx).';
const TOO_BIG = 'Dokument jest zbyt duży albo uszkodzony, więc nie da się go bezpiecznie wczytać.';

/** Wpis ZIP-a: metoda kompresji, rozmiary z katalogu centralnego i dane skompresowane. */
interface ZipEntry {
  method: number;
  size: number; // skompresowany
  originalSize: number; // deklarowany po rozpakowaniu
  data: Uint8Array;
}

/**
 * Znajdź wpis `name` przez katalog centralny ZIP-a (także ZIP64), bez rozpakowywania czegokolwiek.
 * Własny odczyt zamiast unzipSync: fflate rozpakowuje do bufora o rozmiarze z nagłówka, a gdy
 * strumień jest dłuższy, dekoduje dalej i po cichu gubi nadmiar, więc plik z zaniżonym rozmiarem
 * (2 MB rozwijające się do 2 GB) zamrażał kartę na kilkanaście sekund.
 */
function findZipEntry(buf: Uint8Array, name: string): ZipEntry | null {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u64 = (at: number): number => v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;
  // koniec katalogu centralnego: ostatnie 22 B pliku plus komentarz do 64 KB
  let eocd = buf.length - 22;
  const stop = Math.max(0, eocd - 0xffff);
  while (eocd >= stop && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < stop) throw new FileReadError(NOT_DOCX);
  let count = v.getUint16(eocd + 10, true);
  let off = v.getUint32(eocd + 16, true);
  if ((count === 0xffff || off === 0xffffffff) && eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = u64(eocd - 12); // lokalizator ZIP64 wskazuje rekord z prawdziwymi wartościami
    if (z64 + 56 > buf.length || v.getUint32(z64, true) !== 0x06064b50) throw new FileReadError(NOT_DOCX);
    count = u64(z64 + 32);
    off = u64(z64 + 48);
  }
  const want = new TextEncoder().encode(name);
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || v.getUint32(off, true) !== 0x02014b50) throw new FileReadError(NOT_DOCX);
    const nameLen = v.getUint16(off + 28, true);
    const extraLen = v.getUint16(off + 30, true);
    const next = off + 46 + nameLen + extraLen + v.getUint16(off + 32, true);
    const nm = buf.subarray(off + 46, off + 46 + nameLen);
    if (nm.length === want.length && nm.every((b, j) => b === want[j])) {
      let size = v.getUint32(off + 20, true);
      let originalSize = v.getUint32(off + 24, true);
      let local = v.getUint32(off + 42, true);
      // ZIP64: pola 0xFFFFFFFF mają wartość w dodatku 0x0001, po kolei: rozmiar, skompresowany, offset
      for (let x = off + 46 + nameLen; x + 4 <= off + 46 + nameLen + extraLen; ) {
        const id = v.getUint16(x, true);
        const len = v.getUint16(x + 2, true);
        if (id === 0x0001) {
          let p = x + 4;
          if (originalSize === 0xffffffff) {
            originalSize = u64(p);
            p += 8;
          }
          if (size === 0xffffffff) {
            size = u64(p);
            p += 8;
          }
          if (local === 0xffffffff) local = u64(p);
        }
        x += 4 + len;
      }
      if (local + 30 > buf.length || v.getUint32(local, true) !== 0x04034b50) throw new FileReadError(NOT_DOCX);
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      if (start + size > buf.length) throw new FileReadError(NOT_DOCX);
      return { method: v.getUint16(off + 10, true), size, originalSize, data: buf.subarray(start, start + size) };
    }
    off = next;
  }
  return null;
}

/**
 * Rozpakuj deflate kawałkami i przerwij, gdy wynik przekroczy `limit`. Kawałek 16 KB rozwija się
 * najwyżej do ok. 16 MB, więc fałszywy rozmiar w nagłówku kosztuje ułamek sekundy, a nie minuty.
 */
function inflateCapped(data: Uint8Array, limit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflate = new Inflate((chunk) => {
    total += chunk.length;
    if (total > limit) throw new FileReadError(TOO_BIG);
    chunks.push(chunk);
  });
  const STEP = 16 * 1024;
  try {
    for (let i = 0; i < data.length || i === 0; i += STEP) {
      inflate.push(data.subarray(i, i + STEP), i + STEP >= data.length);
    }
  } catch (err) {
    throw err instanceof FileReadError ? err : new FileReadError(NOT_DOCX);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
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
  let entry: ZipEntry | null;
  try {
    entry = findZipEntry(buf, 'word/document.xml');
  } catch (err) {
    throw err instanceof FileReadError ? err : new FileReadError(NOT_DOCX);
  }
  if (!entry) throw new FileReadError('Ten plik nie jest dokumentem Word (.docx).');
  // Wpis deklarujący ogromny rozmiar albo rozmiar niemożliwy przy deflate (skompresowany
  // większy niż oryginał) odrzucamy od razu. Rozmiarowi z nagłówka i tak nie ufamy:
  // rozpakowanie przerywamy tuż po jego przekroczeniu.
  const { method, size, originalSize, data } = entry;
  if (originalSize > MAX_XML_BYTES || size > MAX_XML_BYTES || size > originalSize * 1.2 + 1024) {
    throw new FileReadError(TOO_BIG);
  }
  let doc: Uint8Array;
  if (method === 0) doc = data; // zapisany bez kompresji
  else if (method === 8) doc = inflateCapped(data, Math.min(MAX_XML_BYTES, originalSize + 1024));
  else throw new FileReadError(NOT_DOCX);

  const xml = dropFallbacks(strFromU8(doc));
  const parts: string[] = [];
  // `[^<>]` i `[^<]` zamiast `[^>]` i `[\s\S]*?`: niedomknięty znacznik nie skanuje do końca
  // tekstu (koszt kwadratowy), a w <w:t> i tak nie ma „<” (XML zapisuje go jako &lt;).
  const re =
    /<w:t(?:\s[^<>]*)?>([^<]*)<\/w:t>|<\/w:p>|<w:tab\b[^<>]*\/>|<w:br\b[^<>]*\/>|<w:noBreakHyphen\b[^<>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) parts.push(decodeXmlEntities(m[1]));
    else if (m[0].startsWith('<w:tab')) parts.push('\t');
    else if (m[0].startsWith('<w:noBreakHyphen')) parts.push('-');
    else parts.push('\n'); // </w:p> lub <w:br/>
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}
