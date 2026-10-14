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

import { unzipSync, strFromU8 } from 'fflate';
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

/** Usuń zapasowe gałęzie `mc:Fallback` (od najgłębszej, więc zagnieżdżenia też znikają). */
function dropFallbacks(xml: string): string {
  let out = xml.replace(/<mc:Fallback\b[^>]*\/>/g, '');
  let prev: string;
  do {
    prev = out;
    out = out.replace(
      /<mc:Fallback\b[^>]*>(?:(?!<mc:Fallback\b)[\s\S])*?<\/mc:Fallback>/g,
      '',
    );
  } while (out !== prev);
  return out;
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

  let tooBig = false;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      // Rozpakowujemy wyłącznie treść dokumentu. Wpis, który deklaruje ogromny rozmiar albo
      // rozmiar niemożliwy przy deflate (skompresowany większy niż oryginał), odrzucamy.
      filter: (f) => {
        if (f.name !== 'word/document.xml') return false;
        if (
          f.originalSize > MAX_XML_BYTES ||
          f.size > MAX_XML_BYTES ||
          f.size > f.originalSize * 1.2 + 1024
        ) {
          tooBig = true;
          return false;
        }
        return true;
      },
    });
  } catch {
    throw new FileReadError(
      'Nie udało się odczytać pliku. To nie wygląda na poprawny dokument Word (.docx).',
    );
  }
  if (tooBig) {
    throw new FileReadError(
      'Dokument jest zbyt duży albo uszkodzony, więc nie da się go bezpiecznie wczytać.',
    );
  }
  const doc = files['word/document.xml'];
  if (!doc) throw new FileReadError('Ten plik nie jest dokumentem Word (.docx).');

  const xml = dropFallbacks(strFromU8(doc));
  const parts: string[] = [];
  const re =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>|<w:noBreakHyphen\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1] !== undefined) parts.push(decodeXmlEntities(m[1]));
    else if (m[0].startsWith('<w:tab')) parts.push('\t');
    else if (m[0].startsWith('<w:noBreakHyphen')) parts.push('-');
    else parts.push('\n'); // </w:p> lub <w:br/>
  }
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}
