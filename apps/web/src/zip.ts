/**
 * Odczyt ZIP-a (DOCX, w przyszłości ODT) bez rozpakowywania tego, czego nie potrzebujemy.
 *
 * Własny odczyt katalogu centralnego zamiast unzipSync: fflate rozpakowuje do bufora o rozmiarze
 * z nagłówka, a gdy strumień jest dłuższy, dekoduje dalej i po cichu gubi nadmiar, więc plik
 * z zaniżonym rozmiarem (2 MB rozwijające się do 2 GB) zamrażał kartę na kilkanaście sekund.
 * Tutaj każdy wpis rozpakowuje się osobno, kawałkami i z limitem.
 *
 * Błędy budowy pliku (zły podpis, wpis poza plikiem, nieznana metoda, uszkodzony deflate) to
 * zwykłe Error: wywołujący zamienia je na własny komunikat („to nie jest .docx”). Przekroczony
 * limit to od razu FileReadError z ZIP_TOO_BIG, bo ten komunikat pasuje do każdego formatu.
 */

import { Inflate } from 'fflate';
import { FileReadError } from './files';

export const ZIP_TOO_BIG =
  'Dokument jest zbyt duży albo uszkodzony, więc nie da się go bezpiecznie wczytać.';

/** Wpis z katalogu centralnego: dane skompresowane czyta dopiero readZipEntry. */
export interface ZipEntry {
  name: string;
  method: number;
  size: number; // skompresowany
  originalSize: number; // deklarowany po rozpakowaniu
  localOffset: number; // nagłówek lokalny wpisu
}

/**
 * Wszystkie wpisy z katalogu centralnego (także ZIP64), bez dotykania danych i nagłówków
 * lokalnych. Uszkodzony nagłówek lokalny obrazka nie przeszkodzi więc w odczycie treści.
 */
export function listZipEntries(buf: Uint8Array): ZipEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u64 = (at: number): number => v.getUint32(at, true) + v.getUint32(at + 4, true) * 2 ** 32;
  // koniec katalogu centralnego: ostatnie 22 B pliku plus komentarz do 64 KB
  let eocd = buf.length - 22;
  const stop = Math.max(0, eocd - 0xffff);
  while (eocd >= stop && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < stop) throw new Error('brak końca katalogu centralnego');
  let count = v.getUint16(eocd + 10, true);
  let off = v.getUint32(eocd + 16, true);
  if ((count === 0xffff || off === 0xffffffff) && eocd >= 20 && v.getUint32(eocd - 20, true) === 0x07064b50) {
    const z64 = u64(eocd - 12); // lokalizator ZIP64 wskazuje rekord z prawdziwymi wartościami
    if (z64 + 56 > buf.length || v.getUint32(z64, true) !== 0x06064b50) throw new Error('zły rekord ZIP64');
    count = u64(z64 + 32);
    off = u64(z64 + 48);
  }
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || v.getUint32(off, true) !== 0x02014b50) throw new Error('zły wpis katalogu');
    const nameLen = v.getUint16(off + 28, true);
    const extraLen = v.getUint16(off + 30, true);
    const next = off + 46 + nameLen + extraLen + v.getUint16(off + 32, true);
    let size = v.getUint32(off + 20, true);
    let originalSize = v.getUint32(off + 24, true);
    let localOffset = v.getUint32(off + 42, true);
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
        if (localOffset === 0xffffffff) localOffset = u64(p);
      }
      x += 4 + len;
    }
    entries.push({
      name: decoder.decode(buf.subarray(off + 46, off + 46 + nameLen)),
      method: v.getUint16(off + 10, true),
      size,
      originalSize,
      localOffset,
    });
    off = next;
  }
  return entries;
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
    if (total > limit) throw new FileReadError(ZIP_TOO_BIG);
    chunks.push(chunk);
  });
  const STEP = 16 * 1024;
  for (let i = 0; i < data.length || i === 0; i += STEP) {
    inflate.push(data.subarray(i, i + STEP), i + STEP >= data.length);
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
 * Rozpakowana treść wpisu, najwyżej `limit` bajtów. Wpis deklarujący rozmiar ponad limit albo
 * rozmiar niemożliwy przy deflate (skompresowany większy niż oryginał) odrzucamy od razu.
 * Rozmiarowi z nagłówka i tak nie ufamy: rozpakowanie przerywamy tuż po jego przekroczeniu.
 */
export function readZipEntry(buf: Uint8Array, entry: ZipEntry, limit: number): Uint8Array {
  const { method, size, originalSize, localOffset: local } = entry;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (local + 30 > buf.length || v.getUint32(local, true) !== 0x04034b50) throw new Error('zły nagłówek lokalny');
  const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
  if (start + size > buf.length) throw new Error('wpis poza plikiem');
  if (originalSize > limit || size > limit || size > originalSize * 1.2 + 1024) {
    throw new FileReadError(ZIP_TOO_BIG);
  }
  const data = buf.subarray(start, start + size);
  if (method === 0) return data; // zapisany bez kompresji
  if (method === 8) return inflateCapped(data, Math.min(limit, originalSize + 1024));
  throw new Error('nieznana metoda kompresji');
}

/* ── Zapis ── */

let crcTable: Uint32Array | undefined;

/** CRC-32 (wielomian 0xEDB88320), jak w nagłówkach ZIP. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Data 1980-01-01, godzina 00:00 w formacie DOS: ten sam zestaw plików daje te same bajty.
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * ZIP bez kompresji (metoda 0, STORE) z wpisów [nazwa, treść tekstowa w UTF-8]. Nazwy tylko
 * ASCII. Bez ZIP64: plik zapisujemy z wyniku, który przeglądarka trzyma w pamięci, więc jest
 * daleko od 4 GB. Kod deflate z fflate kosztowałby ok. 10 kB w pliku aplikacji, a dokument
 * z samym tekstem i tak ma najwyżej kilkaset kilobajtów.
 */
export function storeZip(entries: Array<[string, string]>): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const files = entries.map(([name, text]) => {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    return { nameBytes, data, crc: crc32(data) };
  });
  const localSize = files.reduce((n, f) => n + 30 + f.nameBytes.length + f.data.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const v = new DataView(out.buffer);
  // wspólna część nagłówka lokalnego (od pola „wersja potrzebna”) i centralnego (od pola o tej samej nazwie)
  const common = (at: number, f: (typeof files)[number]): void => {
    v.setUint16(at, 10, true); // wersja potrzebna do rozpakowania: 1.0 (STORE)
    v.setUint16(at + 2, 0, true); // flagi
    v.setUint16(at + 4, 0, true); // metoda: STORE
    v.setUint16(at + 6, 0, true); // godzina
    v.setUint16(at + 8, DOS_DATE, true);
    v.setUint32(at + 10, f.crc, true);
    v.setUint32(at + 14, f.data.length, true);
    v.setUint32(at + 18, f.data.length, true);
    v.setUint16(at + 22, f.nameBytes.length, true);
    v.setUint16(at + 24, 0, true); // dodatkowe pole
  };
  let at = 0;
  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(at);
    v.setUint32(at, 0x04034b50, true);
    common(at + 4, f);
    out.set(f.nameBytes, at + 30);
    out.set(f.data, at + 30 + f.nameBytes.length);
    at += 30 + f.nameBytes.length + f.data.length;
  }
  const centralStart = at;
  files.forEach((f, i) => {
    v.setUint32(at, 0x02014b50, true);
    v.setUint16(at + 4, 20, true); // wersja programu zapisującego: 2.0, system MS-DOS
    common(at + 6, f);
    // komentarz, numer dysku, atrybuty wewnętrzne i zewnętrzne: zera
    v.setUint32(at + 42, offsets[i], true);
    out.set(f.nameBytes, at + 46);
    at += 46 + f.nameBytes.length;
  });
  v.setUint32(at, 0x06054b50, true);
  v.setUint16(at + 8, files.length, true);
  v.setUint16(at + 10, files.length, true);
  v.setUint32(at + 12, centralSize, true);
  v.setUint32(at + 16, centralStart, true);
  return out;
}
