/**
 * Adnotacja o wyłączeniu jawności (art. 8 ust. 5 u.d.i.p.) i protokół zasłaniania do akt, bez DOM.
 *
 * Oba teksty powstają wyłącznie z metadanych wyniku: nazw tokenów i ich liczby (zakresy ze
 * spans.ts), ustawień i pól, które urzędnik wpisuje sam. Żadna zasłonięta wartość nie ma tu
 * wejścia, więc nie może trafić do adnotacji ani protokołu (pilnuje tego test własności na
 * korpusie benchmarku i pismach z fixtures/urzad w publikacja.test.ts).
 *
 * Liczby zasłoniętych fragmentów są w adnotacji domyślnie wyłączone: „imienia i nazwiska (1 fragment)”
 * mówi, że w piśmie jest jedna osoba. Bez liczb zakres stoi w liczbie mnogiej niezależnie od liczby
 * wystąpień, bo pojedyncza forma zdradzałaby to samo.
 *
 * Brzmienie to wzór, a nie formuła urzędowa: pole adnotacji w aplikacji da się poprawić, a pod nim
 * stoi, że podstawę prawną i brzmienie ustala urząd.
 */
import { CHIP_BY_TOKEN, GENITIVE_LABEL, TYPE_TOKEN } from './pii-meta';
import { plural } from './plural';
import { countTokens, type Span } from './spans';

/** Miejsce na dane, których urzędnik jeszcze nie wpisał. */
export const MISSING = '[uzupełnij]';

/** Podstawy prawne z listy w karcie. `interest` decyduje o zdaniu „w interesie…”. */
export interface Basis {
  key: string;
  label: string;
  interest: 'osoby' | 'przedsiebiorca';
}

export const BASES: readonly Basis[] = [
  { key: 'prywatnosc', label: 'art. 5 ust. 2 u.d.i.p., prywatność osoby fizycznej', interest: 'osoby' },
  { key: 'tajemnica', label: 'art. 5 ust. 2 u.d.i.p., tajemnica przedsiębiorcy', interest: 'przedsiebiorca' },
  {
    key: 'oswiadczenie',
    label: 'art. 24i ust. 1 ustawy o samorządzie gminnym, oświadczenie majątkowe',
    interest: 'osoby',
  },
  { key: 'petycja', label: 'art. 8 ust. 1 w związku z art. 4 ust. 3 ustawy o petycjach', interest: 'osoby' },
  { key: 'inna', label: 'Inna (wpisz)', interest: 'osoby' },
];

/** Klucz podstawy, przy której urzędnik wpisuje własne brzmienie. */
export const OTHER_BASIS = 'inna';

/** Liczba znaczników po nazwie tokenu z zakresów; [OSOBA-A] liczy się jako imię i nazwisko. */
export function countByToken(spans: Span[]): Map<string, number> {
  return countTokens(spans);
}

/**
 * Liczby po tokenie z liczników rdzenia, gdy wyniku nie da się dopasować do oryginału (bez zakresów).
 * IBAN i NR-KONTA dają jeden token „NR-KONTA”, IMIE daje „IMIĘ I NAZWISKO”.
 */
export function countFromFindings(found: { type: string; count: number }[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const f of found) {
    const token = TYPE_TOKEN[f.type] ?? f.type;
    const c = Number(f.count) || 0;
    if (c > 0) n.set(token, (n.get(token) ?? 0) + c);
  }
  return n;
}

/** Tokeny w kolejności GENITIVE_LABEL (osoba, adres, kontakt, numery), nieznane na końcu. */
function ordered(counts: Map<string, number>): [string, number][] {
  const order = Object.keys(GENITIVE_LABEL);
  const rank = (t: string): number => {
    const i = order.indexOf(t);
    return i === -1 ? order.length : i;
  };
  return [...counts.entries()].filter(([, n]) => n > 0).sort((a, b) => rank(a[0]) - rank(b[0]));
}

/** „a, b oraz c”: „i” stałoby obok „i” z „imion i nazwisk”. */
function joinList(items: string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} oraz ${items[items.length - 1]}`;
}

const fragments = (n: number): string => `${n} ${plural(n, 'fragment', 'fragmenty', 'fragmentów')}`;

/**
 * Zakres wyłączenia w dopełniaczu, np. „imion i nazwisk, adresów oraz numerów PESEL”. Z liczbami:
 * „imienia i nazwiska (1 fragment), numerów PESEL (2 fragmenty)”. Pusty napis, gdy nic nie zasłonięto.
 */
export function zakresText(counts: Map<string, number>, opts: { withCounts: boolean }): string {
  return joinList(
    ordered(counts).map(([token, n]) => {
      const forms = GENITIVE_LABEL[token] ?? [`danych oznaczonych [${token}]`, `danych oznaczonych [${token}]`];
      if (!opts.withCounts) return forms[1];
      return `${n === 1 ? forms[0] : forms[1]} (${fragments(n)})`;
    }),
  );
}

/** Pola karty „Adnotacja i protokół” wpisywane przez urzędnika. */
export interface PublicationFields {
  /** Organ, który wyłączył jawność, np. „Wójt Gminy Brzozowa Wola”. */
  organ: string;
  /** Kto dokonał wyłączenia, np. „Joanna Malec, inspektor”. */
  osoba: string;
  /** Kto zatwierdził (opcjonalnie). */
  zatwierdzil: string;
  /** Klucz podstawy z BASES. */
  basis: string;
  /** Własne brzmienie podstawy przy „Inna (wpisz)”. */
  basisOther: string;
  /** Data adnotacji, zwykle dd.mm.rrrr. */
  data: string;
  /** Podaj liczbę zasłoniętych fragmentów (domyślnie wyłączone). */
  withCounts: boolean;
}

const filled = (s: string): string => s.trim().replace(/\s+/g, ' ') || MISSING;
const noDot = (s: string): string => s.replace(/[.\s]+$/, '');

/** Brzmienie podstawy prawnej: z listy albo wpisane przy „Inna (wpisz)”. */
export function basisText(f: Pick<PublicationFields, 'basis' | 'basisOther'>): string {
  if (f.basis === OTHER_BASIS) return noDot(filled(f.basisOther));
  return noDot(BASES.find((b) => b.key === f.basis)?.label ?? BASES[0].label);
}

/** dd.mm.rrrr */
export function formatDate(d: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Wzór adnotacji do BIP. Wiersz zatwierdzenia tylko wtedy, gdy wpisano zatwierdzającego. */
export function buildAnnotation(counts: Map<string, number>, f: PublicationFields): string {
  const zakres = zakresText(counts, { withCounts: f.withCounts }) || MISSING;
  const interest = BASES.find((b) => b.key === f.basis)?.interest ?? 'osoby';
  const organ = f.organ.trim() ? ` (${noDot(filled(f.organ))})` : ` (${MISSING})`;
  return [
    'Informacja o wyłączeniu jawności',
    'Na podstawie art. 8 ust. 5 ustawy z dnia 6 września 2001 r. o dostępie do informacji publicznej ' +
      `informuje się, że w dokumencie wyłączono jawność w zakresie: ${zakres}.`,
    `Podstawa prawna wyłączenia: ${basisText(f)}.`,
    `Wyłączenia dokonał(a): ${noDot(filled(f.osoba))}${organ}.`,
    ...(f.zatwierdzil.trim() ? [`Zatwierdził(a): ${noDot(filled(f.zatwierdzil))}.`] : []),
    interest === 'przedsiebiorca'
      ? 'Wyłączenia dokonano w interesie przedsiębiorcy.'
      : 'Wyłączenia dokonano w interesie osób fizycznych, których dane dotyczą.',
    `Data: ${noDot(filled(f.data))}.`,
  ].join('\n');
}

/** Skąd przyszedł tekst źródłowy (bez nazwy pliku). */
export type SourceKind = 'wklejony' | 'docx' | 'pdf' | 'tekstowy';

export interface ProtocolInput {
  when: Date;
  version: string;
  source: SourceKind;
  /** Długość tekstu źródłowego w znakach i wierszach (bez treści). */
  chars: number;
  lines: number;
  /** Znak sprawy wpisany w karcie (bez danych strony); pusty = wiersz pominięty. */
  znak: string;
  counts: Map<string, number>;
  /** Nazwy typów odznaczonych w „Co maskować”. */
  disabled: string[];
  pseudonyms: boolean;
  /** Przejrzane znaczniki; null = przegląd niedostępny (długi tekst bez podświetleń). */
  reviewed: number | null;
  /** Liczba znaczników w wyniku. */
  marks: number;
  /** Wiersze dopisywane przez kolejne funkcje (np. zostawione jawne, kontrola pliku). */
  extra?: string[];
  /** Suma SHA-256 tekstu wyniku; null albo brak = wiersz pominięty. */
  sha256?: string | null;
  osoba: string;
  zatwierdzil: string;
}

const SOURCE_LABEL: Record<SourceKind, string> = {
  wklejony: 'tekst wklejony lub wpisany',
  docx: 'plik DOCX',
  pdf: 'plik PDF',
  tekstowy: 'plik tekstowy',
};

const num = (n: number): string => n.toLocaleString('pl-PL');

/** Protokół zasłaniania danych do akt sprawy. Same liczby, nazwy typów i pola z karty. */
export function buildProtocol(p: ProtocolInput): string {
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const time = `${p2(p.when.getHours())}:${p2(p.when.getMinutes())}`;
  const items = ordered(p.counts);
  const total = items.reduce((s, [, n]) => s + n, 0);
  const kinds = items.length;
  const list = items.map(([token, n]) => `${CHIP_BY_TOKEN[token]?.label ?? token} (${n})`).join(', ');
  const masked = total
    ? `Zasłonięto: ${fragments(total)} w ${kinds} ${kinds === 1 ? 'rodzaju' : 'rodzajach'} danych: ${list}.`
    : 'Nie zasłonięto żadnego fragmentu.';
  const file = p.source === 'wklejony' ? '' : ' Nazwy pliku nie zapisano.';
  const reviewed =
    p.reviewed === null
      ? 'Przejrzano znaczniki: przegląd niedostępny (długi tekst bez podświetleń).'
      : `Przejrzano znaczniki: ${num(p.reviewed)} z ${num(p.marks)}.`;
  return [
    'Protokół zasłaniania danych',
    `Data i godzina: ${formatDate(p.when)}, ${time}`,
    `Narzędzie: Parawan ${p.version}, plik otwierany lokalnie w przeglądarce, bez połączeń sieciowych`,
    `Źródło: ${SOURCE_LABEL[p.source]}, ${num(p.chars)} ${plural(p.chars, 'znak', 'znaki', 'znaków')}, ` +
      `${num(p.lines)} ${plural(p.lines, 'wiersz', 'wiersze', 'wierszy')}.${file}`,
    ...(p.znak.trim() ? [`Znak sprawy: ${p.znak.trim().replace(/\s+/g, ' ')}`] : []),
    masked,
    `Typy niezasłaniane z wyboru: ${p.disabled.length ? `${p.disabled.join(', ')}.` : 'brak.'}`,
    `Tryb „Rozróżniaj osoby”: ${p.pseudonyms ? 'włączony' : 'wyłączony'}.`,
    reviewed,
    ...(p.extra ?? []),
    ...(p.sha256 ? [`Suma SHA-256 tekstu wyniku (UTF-8, końce wierszy LF): ${p.sha256}`] : []),
    `Wyłączenia dokonał(a): ${noDot(filled(p.osoba))}.`,
    ...(p.zatwierdzil.trim() ? [`Zatwierdził(a): ${noDot(filled(p.zatwierdzil))}.`] : []),
    'Protokół nie zawiera zasłoniętych danych.',
  ].join('\n');
}

/**
 * Wiersze protokołu o ręcznej korekcie (corrections.ts): ile znaczników odsłonięto i ile
 * fragmentów zasłonięto ręcznie. Same liczby, bez wartości.
 */
export function correctionLines(kept: number, masked: number): string[] {
  return [`Zostawiono jawne ręcznie: ${fragments(kept)}.`, `Zasłonięto ręcznie: ${fragments(masked)}.`];
}

/** Suma SHA-256 tekstu (UTF-8) szesnastkowo; null, gdy przeglądarka nie daje crypto.subtle. */
export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}
