/**
 * Ekstrakcja tekstu z pliku .docx — w całości lokalnie, bez ciężkich zależności.
 *
 * DOCX to ZIP z XML-em w środku; treść dokumentu żyje w `word/document.xml`,
 * a widoczny tekst — w elementach `<w:t>`. Rozpakowujemy (zip.ts) TYLKO ten jeden wpis
 * (z limitem rozmiaru, więc bomba ZIP nie zamrozi karty) i zbieramy tekst runów,
 * wstawiając \n za końce akapitów (`</w:p>`), `<w:br/>` i `<w:cr/>`, \t za `<w:tab/>`
 * i `<w:ptab/>` oraz zwykły „-” za twardy łącznik `<w:noBreakHyphen/>` (bez niego kod pocztowy
 * „00-950” skleja się w „00950” i przechodzi jawny). Bez `<w:cr/>` „Jan” i „Kowalski”
 * z dwóch wierszy sklejały się w „JanKowalski” i nazwisko przechodziło jawne. Te same znaki
 * zapisane parą `<w:cr></w:cr>` (tak puste elementy wypisują niektóre serializatory XML) to
 * w XML ten sam element i też łamią wiersz.
 *
 * Pusty akapit `<w:p/>` (tak Word zapisuje pusty wiersz i pustą komórkę tabeli) nie daje nic,
 * a pusta komórka tabeli nie daje nic także wtedy, gdy jej akapit ma formatowanie. Taki akapit
 * nie rozdziela żadnych wyrazów, tylko dokłada pusty wiersz, a przez pusty wiersz rdzeń nie łączy
 * imienia z nazwiskiem ani etykiety „Login:” z wartością. Tabela „Jan | (puste drugie imię) |
 * Kowalski” zostawiała wtedy imię jawne. Wyjątek: pusta komórka między dwiema liczbami daje pusty
 * wiersz, bo rdzeń łączy grupy cyfr z kolejnych wierszy w numer telefonu, a w tabeli kwot
 * „340 000 | (pusta zmiana) | 340 000” robił z nich „[TELEFON] 000”. Łącznik miękki
 * `<w:softHyphen/>` pomijamy, bo w tekście go nie widać. Pola tekstowe Word zapisuje dwa razy
 * (`mc:Choice` i zapasowo `mc:Fallback`), więc gałęzie `mc:Fallback` usuwamy, żeby treść nie
 * dublowała się w wyniku i licznikach.
 *
 * Prefiks `w:` to tylko zwyczaj Worda: niektóre generatory piszą `ns0:` albo przestrzeń
 * domyślną. Prefiksy czytamy więc z deklaracji w elemencie głównym, wszystkie związane
 * z WordprocessingML: element główny bywa w przestrzeni domyślnej, a treść pod `w:`.
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
 * Prefiksy, pod którymi część XML deklaruje WordprocessingML w elemencie głównym („w”, „ns0”,
 * pusty napis dla przestrzeni domyślnej), albo null, gdy deklaracji nie ma. Wszystkie, nie tylko
 * prefiks samego elementu głównego: `<document xmlns="…main" xmlns:w="…main">` z treścią pod `w:`
 * dawał przy jednym prefiksie fałszywe „Plik jest pusty”, a przy treści pisanej raz tak, raz tak
 * akapity pod `w:` znikały bez słowa. Skan indexOf zamiast wyrażeń z `[\s\S]*?`: niedomknięty
 * komentarz albo instrukcja nie skanują tekstu wielokrotnie.
 */
export function wmlPrefixes(xml: string): string[] | null {
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
  const bound = new Map<string, string>();
  for (const a of tag.matchAll(/\sxmlns(?::([^\s=/>]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    bound.set(a[1] ?? '', a[2] ?? a[3] ?? '');
  }
  const prefixes = [...bound].filter(([, uri]) => WML_NS.includes(uri)).map(([prefix]) => prefix);
  return prefixes.length ? prefixes : null;
}

/**
 * Nazwa elementu z prefiksem do wyrażenia regularnego: „(?:w:)t”, „(?:ns0:)t”, „t”, a dla kilku
 * prefiksów alternatywa, np. „(?:w:)?t” przy przestrzeni domyślnej i `w:` naraz.
 */
export function wmlName(prefixes: readonly string[], local: string): string {
  const named = prefixes
    .filter((p) => p !== '')
    .map((p) => `${p.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}:`);
  if (!named.length) return local;
  return `(?:${named.join('|')})${prefixes.includes('') ? '?' : ''}${local}`;
}

const tokenizers = new Map<string, RegExp>();

/**
 * Wyrażenie wyciągające tekst dla danych prefiksów. `[^<>]` i `[^<]` zamiast `[^>]`
 * i `[\s\S]*?`: niedomknięty znacznik nie skanuje do końca tekstu (koszt kwadratowy), a w <w:t>
 * i tak nie ma „<” (XML zapisuje go jako &lt;). `(?=[\s/>])` za nazwą, żeby `<w:t>` nie łapało
 * `<w:tab/>` ani `<w:delText>` (tekstu usuniętego w śledzonej zmianie, którego w dokumencie już
 * nie widać), a `<w:tc>` nie łapało `<w:tcPr>` ani `<w:tcW/>`. Znak specjalny przyjmujemy też
 * jako pustą parę `<w:br></w:br>` (`\2` to ta sama nazwa z tym samym prefiksem). Grupy: 1 tekst,
 * 2 znak specjalny, 3 „/” zamykającego `</w:tc>`, 4 „/” samozamykającego `<w:tc/>`.
 */
function tokenizer(prefixes: readonly string[]): RegExp {
  const key = prefixes.join(' ');
  let re = tokenizers.get(key);
  if (!re) {
    const n = (local: string): string => wmlName(prefixes, local);
    const special = ['tab', 'ptab', 'br', 'cr', 'noBreakHyphen'].map(n).join('|');
    re = new RegExp(
      `<${n('t')}(?:\\s[^<>]*)?>([^<]*)</${n('t')}>|</${n('p')}>` +
        `|<(${special})(?=[\\s/>])[^<>]*?(?:/>|>\\s*</\\2\\s*>)` +
        `|<(/?)${n('tc')}(?=[\\s/>])[^<>]*?(/?)>`,
      'g',
    );
    tokenizers.set(key, re);
  }
  re.lastIndex = 0;
  return re;
}

const DIGIT = /[0-9]/;

/**
 * Pusta komórka tabeli zostawia pusty wiersz tylko między dwiema liczbami (`marks` to pozycje
 * w `parts`, w których stoi jej „\n”), w pozostałych miejscach znika. Komórka ma same znaki
 * białe, więc sąsiadów szukamy za nią i przed nią, pomijając znaki białe. Dwa przebiegi zamiast
 * szukania od każdej komórki: tabela z tysiącami pustych komórek nie kosztuje kwadratowo.
 */
function settleEmptyCells(parts: string[], marks: number[]): void {
  if (!marks.length) return;
  const mark = new Uint8Array(parts.length);
  for (const i of marks) mark[i] = 1;
  const digitAfter = new Uint8Array(parts.length);
  let next = false;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (mark[i]) digitAfter[i] = next ? 1 : 0;
    else {
      const t = parts[i].trimStart();
      if (t) next = DIGIT.test(t[0]);
    }
  }
  let prev = false;
  for (let i = 0; i < parts.length; i++) {
    if (mark[i]) {
      if (!(prev && digitAfter[i])) parts[i] = '';
    } else {
      const t = parts[i].trimEnd();
      if (t) prev = DIGIT.test(t[t.length - 1]);
    }
  }
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
 * Tekst fragmentu WordprocessingML (całej części albo jednego przypisu) dla danych prefiksów,
 * bez gałęzi `mc:Fallback`.
 */
export function wmlText(xml: string, prefixes: readonly string[]): string {
  const re = tokenizer(prefixes);
  const parts: string[] = [];
  // Otwarte komórki tabeli (także zagnieżdżone): gdzie zaczyna się ich wkład i czy mają tekst.
  const cells: { from: number; text: boolean }[] = [];
  // Pozycje w `parts` po pustych komórkach, rosnąco (o nich rozstrzyga settleEmptyCells).
  const marks: number[] = [];
  const src = dropFallbacks(xml);
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // nazwa bez prefiksu („ns0:tab” → „tab”); bez dwukropka indexOf daje -1, czyli całość
    const local = m[2]?.slice(m[2].indexOf(':') + 1);
    if (m[1] !== undefined) {
      const t = decodeXmlEntities(m[1]);
      parts.push(t);
      if (cells.length && t.trim()) cells[cells.length - 1].text = true;
    } else if (m[3] !== undefined) {
      if (m[4]) continue; // <w:tc/> nie ma treści
      if (!m[3]) {
        cells.push({ from: parts.length, text: false });
        continue;
      }
      const cell = cells.pop(); // zamknięcie bez otwarcia (uszkodzony XML) pomijamy
      if (!cell) continue;
      if (!cell.text) {
        // Wkład pustej komórki (z zagnieżdżonymi pustymi komórkami) zastępuje jeden „\n”, który
        // zostanie tylko między liczbami. Komórka z tekstem czyni niepustą także komórkę,
        // w której stoi jej tabela.
        parts.length = cell.from;
        while (marks.length && marks[marks.length - 1] >= cell.from) marks.pop();
        marks.push(parts.length);
        parts.push('\n');
      } else if (cells.length) cells[cells.length - 1].text = true;
    } else if (local === 'tab' || local === 'ptab') parts.push('\t');
    else if (local === 'noBreakHyphen') {
      parts.push('-');
      if (cells.length) cells[cells.length - 1].text = true;
    } else parts.push('\n'); // </w:p>, <w:br/> lub <w:cr/>
  }
  settleEmptyCells(parts, marks);
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
  const prefixes = wmlPrefixes(xml);
  if (prefixes === null) throw new FileReadError(ODD_DOCX);
  return wmlText(xml, prefixes);
}
