import { type PiiType, redactPII } from 'anonimizator';
import { describe, expect, test } from 'vitest';
// dataset.mjs to plain-JS oracle benchmarku (bez deklaracji typów), jak w redact-golden.test.ts.
// @ts-expect-error brak pliku deklaracji dla modułu .mjs (świadomie, to skrypt benchmarku)
import { buildDataset } from '../../../scripts/benchmark/dataset.mjs';
import { guessAligned } from './compare';
import { MASK_TOKEN_RE } from './pii-meta';
import { alignSpans, applySpans, countTokens, renderSpansHtml, type Span } from './spans';

const maskHtml = (name: string): string => `<mark>[${name}]</mark>`;

/** HTML bez data-o i data-s: to, co pokazywała dawna heurystyka. */
const strip = (html: string): string =>
  html.replace(/<span data-o="\d+">([^<]*)<\/span>/g, '$1').replace(/ data-s="\d+"/g, '');

const unescapeHtml = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/**
 * Sprawdza jeden tekst: zakresy istnieją, niezmiennik applySpans, HTML ten sam co z heurystyki
 * (oba widoki), każdy data-o wskazuje dokładnie swój tekst w oryginale, data-s ma każdy znacznik.
 * Zwraca opis pierwszej niezgodności albo null.
 */
function check(original: string, redacted: string): string | null {
  const a = alignSpans(original, redacted);
  if (!a) return 'alignSpans: null';
  if (applySpans(original, a.spans) !== redacted) return 'applySpans ≠ wynik';
  for (const compare of [false, true]) {
    const html = renderSpansHtml(original, a.spans, { maskHtml, compare });
    // Znaczników w cudzysłowach z JSON-u dawna heurystyka nie umiała dopasować, więc tu nie ma
    // z czym porównywać; resztę (pozycje, niezmiennik) sprawdzamy tak samo.
    if (!a.spans.some((s) => s.quoted)) {
      const old = guessAligned(original, redacted, { tokenRe: MASK_TOKEN_RE, maskHtml, compare });
      if (strip(html) !== old.html) return `HTML (compare: ${compare}) inny niż z heurystyki`;
      if (old.kept !== a.kept) return `kept ${a.kept} zamiast ${old.kept}`;
    }
    for (const m of html.matchAll(/<span data-o="(\d+)">([^<]*)<\/span>/g)) {
      const text = unescapeHtml(m[2]);
      if (original.slice(Number(m[1]), Number(m[1]) + text.length) !== text)
        return `data-o=${m[1]} nie wskazuje „${text}”`;
    }
    const marks = html.match(/<mark/g)?.length ?? 0;
    const tagged = html.match(/<mark data-s="\d+">/g)?.length ?? 0;
    const tokens = a.spans.reduce((n, s) => n + s.tokens.length, 0);
    if (marks !== tokens || tagged !== tokens)
      return `znaczników ${marks}, z data-s ${tagged}, tokenów ${tokens}`;
  }
  return null;
}

// Wejścia z compare.test.ts: ten sam HTML co dawniej, plus pozycje.
const COMPARE_CASES = [
  'Jan Kowalski 44051401359',
  'ul. Polna 12 00-950 Warszawa',
  '600 700 800 anna@example.com',
  `Jan Kowalski\t44051401359`,
  `Jan Kowalski${String.fromCharCode(160)}44051401359`,
  'Jan Kowalski, PESEL 44051401359, tel. 600 700 800',
  'Jan Kowalski ',
  'Nazywam się Anna Kowalska, PESEL 44051401359.\nTel. 600 700 800, e-mail: anna.kowalska@example.com',
  'Jan\nKowalski, PESEL 44051401359',
  'Pan [IMIĘ I NAZWISKO], tel. 600 700 800, PESEL [PESEL].',
  '[IMIĘ I NAZWISKO] 600 700 800',
  'Jan Kowalski [PESEL] i tel. 600 700 800',
  'Dane: Jan Kowalski 44051401359 [PESEL] [TELEFON].',
  'Jan Kowalski, PESEL 44051401359, tel. 600 700 800 <b>&</b>',
];

test.each(COMPARE_CASES)('przypadek z compare.test.ts: %j', (original) => {
  expect(check(original, redactPII(original).redacted)).toBeNull();
});

test('znaczniki rozdzielone samą spacją to jeden zakres z kilkoma tokenami i odstępami z wyniku', () => {
  const original = 'Wnioskodawca: Jan Kowalski 44051401359, tel. 600 700 800.';
  const a = alignSpans(original, redactPII(original).redacted);
  expect(a?.spans).toEqual<Span[]>([
    { start: 14, end: 38, tokens: ['IMIĘ I NAZWISKO', 'PESEL'], gaps: [' '], source: 'auto' },
    { start: 45, end: 56, tokens: ['TELEFON'], gaps: [], source: 'auto' },
  ]);
  expect(original.slice(14, 38)).toBe('Jan Kowalski 44051401359');
});

test('dawny znacznik na końcu grupy zostaje tekstem oryginału poza zakresem', () => {
  const original = 'Jan Kowalski [PESEL] i tel. 600 700 800';
  const a = alignSpans(original, '[IMIĘ I NAZWISKO] [PESEL] i tel. [TELEFON]');
  expect(a?.kept).toBe(1);
  expect(a?.spans.map((s) => original.slice(s.start, s.end))).toEqual([
    'Jan Kowalski',
    '600 700 800',
  ]);
});

test('dawny znacznik w środku grupy dzieli ją na dwa zakresy i nie liczy się jako wykrycie', () => {
  const cases: [string, string[], Record<string, number>][] = [
    ['Tel. 600 700 800 [EMAIL] 44051401359', ['600 700 800', '44051401359'], { TELEFON: 1, PESEL: 1 }],
    ['Jan Kowalski [PESEL] 600 700 800', ['Jan Kowalski', '600 700 800'], { 'IMIĘ I NAZWISKO': 1, TELEFON: 1 }],
    ['PESEL 44051401359 [PESEL] 44051401359', ['44051401359', '44051401359'], { PESEL: 2 }],
    ['Tel. 600 700 800 [EMAIL] [NIP] 44051401359', ['600 700 800', '44051401359'], { TELEFON: 1, PESEL: 1 }],
  ];
  for (const [original, values, counts] of cases) {
    const { redacted, found } = redactPII(original);
    const a = alignSpans(original, redacted);
    expect(a, original).not.toBeNull();
    if (!a) continue;
    expect(a.spans.map((s) => original.slice(s.start, s.end))).toEqual(values);
    expect(Object.fromEntries(countTokens(a.spans))).toEqual(counts);
    expect(a.kept).toBeGreaterThan(0);
    expect(applySpans(original, a.spans)).toBe(redacted);
    expect(found.reduce((n, f) => n + f.count, 0)).toBe(values.length);
  }
});

test('dwa jednakowe znaczniki w grupie przy jednym zastanym: null zamiast cudzej wartości w zakresie', () => {
  const original = 'Tel. 600 700 800 a@b.pl [EMAIL] 44051401359';
  const { redacted } = redactPII(original);
  expect(redacted).toBe('Tel. [TELEFON] [EMAIL] [EMAIL] [PESEL]');
  expect(alignSpans(original, redacted)).toBeNull();
  // dwa zastane i dwa znaczniki w wyniku: przypisanie jednoznaczne
  const two = 'Jan Kowalski [EMAIL] [EMAIL] 600 700 800';
  const a = alignSpans(two, '[IMIĘ I NAZWISKO] [EMAIL] [EMAIL] [TELEFON]');
  expect(a?.kept).toBe(2);
  expect(a?.spans.map((s) => two.slice(s.start, s.end))).toEqual(['Jan Kowalski', '600 700 800']);
});

test('wklejka tabeli (grupy po trzy znaczniki) wyrównuje się w czasie liniowym', () => {
  const row = 'Jan Kowalski\t44051401359\t600 700 123\n';
  const masked = '[IMIĘ I NAZWISKO]\t[PESEL]\t[TELEFON]\n';
  const small = alignSpans(row.repeat(2000), masked.repeat(2000));
  const t0 = performance.now();
  const big = alignSpans(row.repeat(40000), masked.repeat(40000));
  const ms = performance.now() - t0;
  expect(small?.spans).toHaveLength(2000);
  expect(big?.spans).toHaveLength(40000);
  // kwadratowo 40 000 wierszy to kilka sekund; liniowo dziesiątki milisekund
  expect(ms).toBeLessThan(1500);
});

test('tryb ścisły odmawia zamiast zgadywać', () => {
  // odcinek wyniku, którego nie ma w oryginale (np. zamieniony odstęp)
  expect(alignSpans('Jan Kowalski\tmieszka tu', '[IMIĘ I NAZWISKO] mieszka tu')).toBeNull();
  // tekst oryginału znikający bez znacznika
  expect(alignSpans('Ala ma kota', 'Ala kota')).toBeNull();
  expect(alignSpans('Ala ma kota', 'Ala ma')).toBeNull();
  // znacznik bez żadnego fragmentu oryginału
  expect(alignSpans('Ala ma kota', 'Ala [PESEL]ma kota')).toBeNull();
  // przy null wynik dalej da się pokazać heurystyką
  expect(
    guessAligned('Jan Kowalski\tmieszka tu', '[IMIĘ I NAZWISKO] mieszka tu', {
      tokenRe: MASK_TOKEN_RE,
      maskHtml,
      compare: false,
    }).html,
  ).toContain('<mark>');
});

test('JSON: cudzysłowy dopisane przez rdzeń wokół znacznika należą do zakresu', () => {
  const original = '{"klient_id": 7, "pesel": 85031412347, "telefon": 601234567}';
  const { redacted } = redactPII(original);
  expect(redacted).toBe('{"klient_id": 7, "pesel": "[PESEL]", "telefon": "[TELEFON]"}');
  const a = alignSpans(original, redacted);
  expect(a?.spans.map((s) => [original.slice(s.start, s.end), s.quoted])).toEqual([
    ['85031412347', true],
    ['601234567', true],
  ]);
  expect(a && renderSpansHtml(original, a.spans, { maskHtml, compare: false })).toBe(
    '<span data-o="0">{&quot;klient_id&quot;: 7, &quot;pesel&quot;: </span>&quot;<mark data-s="0">[PESEL]</mark>&quot;' +
      '<span data-o="37">, &quot;telefon&quot;: </span>&quot;<mark data-s="1">[TELEFON]</mark>&quot;<span data-o="59">}</span>',
  );
  // tablica numerów i znacznik na samym końcu dokumentu
  const arr = '[85031412347, 601234567]';
  expect(check(arr, redactPII(arr).redacted)).toBeNull();
  // proza nie jest JSON-em: cudzysłowu, którego nie ma w oryginale, nie dopisujemy zakresowi
  expect(alignSpans('Pole: 85031412347', 'Pole: "[PESEL]"')).toBeNull();
});

test('applySpans z własnym renderem: ten sam podział, inny wygląd znacznika', () => {
  const original = 'Jan Kowalski 44051401359, tel. 600 700 800';
  const a = alignSpans(original, redactPII(original).redacted);
  expect(a && applySpans(original, a.spans, (s, i) => `<${i}:${s.tokens.join('+')}>`)).toBe(
    '<0:IMIĘ I NAZWISKO+PESEL>, tel. <1:TELEFON>',
  );
});

test('data-o po podziale na wiersze: każdy kawałek ma własną pozycję', () => {
  const original = 'Wiersz pierwszy\n\nPESEL 44051401359\nkoniec';
  const a = alignSpans(original, redactPII(original).redacted);
  const html = a ? renderSpansHtml(original, a.spans, { maskHtml, compare: false }) : '';
  expect(html).toBe(
    '<span data-o="0">Wiersz pierwszy</span>\n\n<span data-o="17">PESEL </span><mark data-s="0">[PESEL]</mark>' +
      '\n<span data-o="35">koniec</span>',
  );
});

test('„Anna i Jan Kowalscy”: liczba tokenów równa liczbie znaczników, nie licznikowi rdzenia', () => {
  const original = 'Wnioskodawcy: Anna i Jan Kowalscy, PESEL 44051401359.';
  for (const pseudonyms of [false, true]) {
    const { redacted, found } = redactPII(original, { pseudonyms });
    const a = alignSpans(original, redacted);
    const counts = countTokens(a?.spans ?? []);
    expect(counts.get('IMIĘ I NAZWISKO')).toBe(2);
    expect([...counts.values()].reduce((x, y) => x + y, 0)).toBe(
      redacted.match(MASK_TOKEN_RE)?.length,
    );
    // rdzeń liczy tu jedno wykrycie osoby (dlatego chipy nie biorą już found)
    expect(found.find((f) => f.type === 'IMIE')?.count).toBe(1);
  }
});

/* ── Własność na całym korpusie benchmarku (ten sam, co golden rdzenia) ── */

interface Case {
  id: string;
  text: string;
}
const cases: Case[] = buildDataset().cases;
const STRUCT_ONLY: PiiType[] = ['PESEL', 'NIP', 'REGON', 'IBAN', 'NR-KONTA', 'EMAIL', 'TELEFON'];

describe('korpus benchmarku', () => {
  // Liczba przypadków rośnie z benchmarkiem; próg tylko pilnuje, że import nie dał pustej listy.
  test('korpus jest wczytany', () => {
    expect(cases.length).toBeGreaterThanOrEqual(450);
  });

  for (const [name, opts] of [
    ['domyślny', {}],
    ['pseudonyms', { pseudonyms: true }],
    ['filtr types', { types: STRUCT_ONLY }],
  ] as const) {
    test(`wariant ${name}: zakresy, niezmiennik i data-o dla każdego przypadku`, () => {
      const bad = cases.flatMap((c) => {
        const why = check(c.text, redactPII(c.text, opts).redacted);
        return why ? [`${c.id}: ${why}`] : [];
      });
      expect(bad).toEqual([]);
    });
  }

  test('wariant „co siódma spacja jako tabulator” (tabele z Worda)', () => {
    let n = 0;
    const tabbed = (s: string): string => s.replace(/ /g, (sp) => (++n % 7 === 0 ? '\t' : sp));
    // Przed scaleniem core-fixes (b1, czyste wyjście) rdzeń zamieniał część tabulatorów na spacje
    // i część przypadków nie dawała zakresów. Gałąź jest już w main, więc próg wynosi 0.
    const bad = cases.flatMap((c) => {
      const text = tabbed(c.text);
      const why = check(text, redactPII(text).redacted);
      return why ? [`${c.id}: ${why}`] : [];
    });
    expect(bad).toEqual([]);
  });
});
