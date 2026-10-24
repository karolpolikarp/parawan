import { readFileSync } from 'node:fs';
import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import { GENITIVE_LABEL, PII_TOKENS } from './pii-meta';
import {
  BASES,
  basisText,
  buildAnnotation,
  buildProtocol,
  countByToken,
  countFromFindings,
  formatDate,
  MISSING,
  OTHER_BASIS,
  type ProtocolInput,
  type PublicationFields,
  sha256Hex,
  zakresText,
} from './publikacja';
import { alignSpans } from './spans';

const EMPTY: PublicationFields = {
  organ: '',
  osoba: '',
  zatwierdzil: '',
  basis: BASES[0].key,
  basisOther: '',
  data: '',
  withCounts: false,
};

const counts = (entries: [string, number][]): Map<string, number> => new Map(entries);

test('zakres: dopełniacz w liczbie pojedynczej przy 1 i mnogiej przy 2 i 5 wystąpieniach', () => {
  const one = zakresText(counts([['PESEL', 1]]), { withCounts: true });
  const two = zakresText(counts([['PESEL', 2]]), { withCounts: true });
  const five = zakresText(counts([['PESEL', 5]]), { withCounts: true });
  expect(one).toBe('numeru PESEL (1 fragment)');
  expect(two).toBe('numerów PESEL (2 fragmenty)');
  expect(five).toBe('numerów PESEL (5 fragmentów)');
  expect(zakresText(counts([['IMIĘ I NAZWISKO', 1]]), { withCounts: true })).toBe(
    'imienia i nazwiska (1 fragment)',
  );
  expect(zakresText(counts([['IMIĘ I NAZWISKO', 2]]), { withCounts: true })).toBe(
    'imion i nazwisk (2 fragmenty)',
  );
  expect(zakresText(counts([['NR-KONTA', 5]]), { withCounts: true })).toBe(
    'numerów rachunków bankowych (5 fragmentów)',
  );
  expect(zakresText(counts([['KOD-POCZTOWY', 12]]), { withCounts: true })).toBe(
    'kodów pocztowych (12 fragmentów)',
  );
  expect(zakresText(counts([['TELEFON', 22]]), { withCounts: true })).toBe('numerów telefonów (22 fragmenty)');
});

// Liczba pojedyncza bez liczb mówiłaby to samo co liczba: że w piśmie jest jedna osoba.
test('zakres bez liczb: zawsze liczba mnoga, ta sama dla 1, 2 i 5 wystąpień', () => {
  for (const n of [1, 2, 5]) {
    expect(zakresText(counts([['IMIĘ I NAZWISKO', n]]), { withCounts: false })).toBe('imion i nazwisk');
    expect(zakresText(counts([['EMAIL', n]]), { withCounts: false })).toBe('adresów e-mail');
    expect(zakresText(counts([['MIEJSCOWOŚĆ', n]]), { withCounts: false })).toBe('nazw miejscowości');
  }
});

test('zakres: kolejność stała (osoba, adres, kontakt, numery), ostatni po „oraz”, puste pominięte', () => {
  const c = counts([
    ['PESEL', 1],
    ['TELEFON', 2],
    ['IMIĘ I NAZWISKO', 3],
    ['ADRES', 1],
    ['NIP', 0],
  ]);
  expect(zakresText(c, { withCounts: false })).toBe(
    'imion i nazwisk, adresów, numerów telefonów oraz numerów PESEL',
  );
  expect(zakresText(new Map(), { withCounts: false })).toBe('');
  // każdy token z PII_TOKENS ma własne słowa, a nie zastępczy opis
  for (const token of Object.keys(PII_TOKENS)) {
    expect(zakresText(counts([[token, 2]]), { withCounts: false }), token).toBe(GENITIVE_LABEL[token][1]);
  }
});

test('pseudonimy [OSOBA-A] liczą się jako imię i nazwisko', () => {
  const text = 'Wniosek złożył Jan Kowalski. Odpowiedź otrzymała Anna Nowak.';
  const { redacted } = redactPII(text, { pseudonyms: true });
  const aligned = alignSpans(text, redacted);
  expect(aligned).not.toBeNull();
  const c = countByToken(aligned?.spans ?? []);
  expect([...c.keys()]).toEqual(['IMIĘ I NAZWISKO']);
  expect(c.get('IMIĘ I NAZWISKO')).toBe(2);
});

test('liczby z rdzenia (bez zakresów): IBAN i NR-KONTA w jednym tokenie', () => {
  const c = countFromFindings([
    { type: 'IBAN', count: 1 },
    { type: 'NR-KONTA', count: 2 },
    { type: 'IMIE', count: 3 },
    { type: 'PESEL', count: 0 },
  ]);
  expect([...c.entries()]).toEqual([
    ['NR-KONTA', 3],
    ['IMIĘ I NAZWISKO', 3],
  ]);
});

test('adnotacja: wzór z pól, zatwierdzenie tylko wpisane, interes przedsiębiorcy przy tajemnicy', () => {
  const c = counts([
    ['IMIĘ I NAZWISKO', 2],
    ['PESEL', 1],
  ]);
  const f: PublicationFields = {
    organ: 'Wójt Gminy Brzozowa Wola',
    osoba: 'Joanna Malec, inspektor',
    zatwierdzil: '',
    basis: 'prywatnosc',
    basisOther: '',
    data: '24.10.2026',
    withCounts: false,
  };
  expect(buildAnnotation(c, f)).toBe(
    [
      'Informacja o wyłączeniu jawności',
      'Na podstawie art. 8 ust. 5 ustawy z dnia 6 września 2001 r. o dostępie do informacji publicznej ' +
        'informuje się, że w dokumencie wyłączono jawność w zakresie: imion i nazwisk oraz numerów PESEL.',
      'Podstawa prawna wyłączenia: art. 5 ust. 2 u.d.i.p., prywatność osoby fizycznej.',
      'Wyłączenia dokonał(a): Joanna Malec, inspektor (Wójt Gminy Brzozowa Wola).',
      'Wyłączenia dokonano w interesie osób fizycznych, których dane dotyczą.',
      'Data: 24.10.2026.',
    ].join('\n'),
  );
  const firm = buildAnnotation(c, { ...f, basis: 'tajemnica', zatwierdzil: 'Adam Wrona, sekretarz gminy.' });
  expect(firm).toContain('Zatwierdził(a): Adam Wrona, sekretarz gminy.\n');
  expect(firm).toContain('Podstawa prawna wyłączenia: art. 5 ust. 2 u.d.i.p., tajemnica przedsiębiorcy.');
  expect(firm).toContain('Wyłączenia dokonano w interesie przedsiębiorcy.');
  expect(firm).not.toContain('osób fizycznych');
  // własna podstawa bez podwójnej kropki; puste pola dostają widoczne miejsce do uzupełnienia
  const other = buildAnnotation(c, { ...EMPTY, basis: OTHER_BASIS, basisOther: 'art. 5 ust. 1 u.d.i.p.' });
  expect(other).toContain('Podstawa prawna wyłączenia: art. 5 ust. 1 u.d.i.p.\n');
  expect(other).toContain(`Wyłączenia dokonał(a): ${MISSING} (${MISSING}).`);
  expect(other).toContain(`Data: ${MISSING}.`);
  expect(basisText({ basis: OTHER_BASIS, basisOther: '  ' })).toBe(MISSING);
  // z liczbami
  expect(buildAnnotation(c, { ...f, withCounts: true })).toContain(
    'w zakresie: imion i nazwisk (2 fragmenty) oraz numeru PESEL (1 fragment).',
  );
  expect(buildAnnotation(new Map(), f)).toContain(`w zakresie: ${MISSING}.`);
});

test('data dd.mm.rrrr', () => {
  expect(formatDate(new Date(2026, 0, 5))).toBe('05.01.2026');
});

const PROTOCOL: ProtocolInput = {
  when: new Date(2026, 9, 24, 9, 5),
  version: '0.46.24',
  source: 'docx',
  chars: 12345,
  lines: 28,
  znak: 'RGK.6220.14.2026',
  counts: counts([
    ['PESEL', 1],
    ['IMIĘ I NAZWISKO', 3],
  ]),
  disabled: ['znak sprawy / pisma'],
  pseudonyms: false,
  reviewed: 2,
  marks: 4,
  osoba: 'Joanna Malec, inspektor',
  zatwierdzil: '',
};

test('protokół: wiersze z metadanych, bez nazwy pliku, z miejscem na wiersze kolejnych funkcji', () => {
  const text = buildProtocol({ ...PROTOCOL, extra: ['Zostawiono jawne: 1 fragment.'] });
  expect(text.split('\n')).toEqual([
    'Protokół zasłaniania danych',
    'Data i godzina: 24.10.2026, 09:05',
    'Narzędzie: Parawan 0.46.24, plik otwierany lokalnie w przeglądarce, bez połączeń sieciowych',
    'Źródło: plik DOCX, 12 345 znaków, 28 wierszy. Nazwy pliku nie zapisano.',
    'Znak sprawy: RGK.6220.14.2026',
    'Zasłonięto: 4 fragmenty w 2 rodzajach danych: imię i nazwisko (3), PESEL (1).',
    'Typy niezasłaniane z wyboru: znak sprawy / pisma.',
    'Tryb „Rozróżniaj osoby”: wyłączony.',
    'Przejrzano znaczniki: 2 z 4.',
    'Zostawiono jawne: 1 fragment.',
    'Wyłączenia dokonał(a): Joanna Malec, inspektor.',
    'Protokół nie zawiera zasłoniętych danych.',
  ]);
  const pasted = buildProtocol({
    ...PROTOCOL,
    source: 'wklejony',
    znak: '',
    disabled: [],
    pseudonyms: true,
    reviewed: null,
    sha256: 'ab'.repeat(32),
    zatwierdzil: 'Adam Wrona',
  });
  expect(pasted).toContain('Źródło: tekst wklejony lub wpisany, 12 345 znaków, 28 wierszy.\n');
  expect(pasted).not.toContain('Znak sprawy');
  expect(pasted).toContain('Typy niezasłaniane z wyboru: brak.');
  expect(pasted).toContain('Tryb „Rozróżniaj osoby”: włączony.');
  expect(pasted).toContain('Przejrzano znaczniki: przegląd niedostępny');
  expect(pasted).toContain(`Suma SHA-256 tekstu wyniku (UTF-8, końce wierszy LF): ${'ab'.repeat(32)}`);
  expect(pasted).toContain('Zatwierdził(a): Adam Wrona.');
  expect(buildProtocol({ ...PROTOCOL, counts: new Map() })).toContain('Nie zasłonięto żadnego fragmentu.');
  expect(buildProtocol({ ...PROTOCOL, counts: counts([['EMAIL', 1]]) })).toContain(
    'Zasłonięto: 1 fragment w 1 rodzaju danych: e-mail (1).',
  );
});

test('sha256Hex: suma tekstu w UTF-8; bez crypto.subtle null', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Hex('zażółć')).toMatch(/^[0-9a-f]{64}$/);
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    expect(await sha256Hex('abc')).toBeNull();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'crypto', desc);
  }
});

/* ── Własność: adnotacja i protokół bez żadnego fragmentu zasłoniętych wartości ── */

type Case = { id: string; text: string };
const datasetUrl = new URL('../../../scripts/benchmark/dataset.mjs', import.meta.url).href;
const { buildDataset } = (await import(/* @vite-ignore */ datasetUrl)) as {
  buildDataset: () => { cases: Case[] };
};
const LETTERS = ['decyzja.txt', 'informacja-publiczna.txt', 'protokol-kontroli.txt'].map((name) => ({
  id: name,
  text: readFileSync(new URL(`./fixtures/urzad/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'),
}));

/** Wszystkie podciągi długości 4 (dłuższy niż 3 znaki zawiera któryś z nich). */
function grams(s: string): Set<string> {
  const g = new Set<string>();
  for (let i = 0; i + 4 <= s.length; i++) g.add(s.slice(i, i + 4));
  return g;
}

// Stałe brzmienie obu tekstów (nazwy typów, zdania wzoru, nazwy trybów) ma czteroznakowe podciągi
// wspólne ze zwykłymi słowami pism: „Prze” z „Przejrzano” i „ul. Przemysłowa”, „ości”
// z „miejscowości” i „pl. Wolności”. To nie wyciek, bo te słowa stoją w każdym protokole, więc
// podciągi samego wzoru, zbudowanego dla wszystkich tokenów, podstaw i rodzajów źródła, nie liczą
// się. Liczy się każdy inny: liczby, zmienne fragmenty i wszystko, co mogłoby przyjść z wartości.
const WHEN = new Date(1901, 0, 1, 0, 0);
// Protokół z pustymi polami: znak sprawy i osoba z PROTOCOL nie mogą wejść do stałego wzoru.
const BLANK: ProtocolInput = {
  ...PROTOCOL,
  when: WHEN,
  version: 'test',
  source: 'wklejony',
  chars: 0,
  lines: 0,
  znak: '',
  disabled: [],
  reviewed: 0,
  marks: 0,
  osoba: '',
  zatwierdzil: '',
};
const ALL = new Map(Object.keys(GENITIVE_LABEL).map((t) => [t, 2]));
const ONE = new Map(Object.keys(GENITIVE_LABEL).map((t) => [t, 1]));
const TEMPLATE = grams(
  [
    ...BASES.flatMap((b) =>
      [ALL, ONE].flatMap((c) => [
        buildAnnotation(c, { ...EMPTY, basis: b.key }),
        buildAnnotation(c, { ...EMPTY, basis: b.key, withCounts: true }),
      ]),
    ),
    ...(['wklejony', 'docx', 'pdf', 'tekstowy'] as const).flatMap((source) =>
      [true, false].map((pseudonyms) =>
        buildProtocol({ ...BLANK, source, counts: ALL, pseudonyms, reviewed: pseudonyms ? null : 0 }),
      ),
    ),
    buildProtocol({ ...BLANK, counts: ONE }),
    buildProtocol({ ...BLANK, counts: new Map() }),
  ].join('\n'),
);

/** Podciągi wartości spod zakresów, które stoją w tekstach, a nie pochodzą ze stałego wzoru. */
function leaksIn(outputs: string[], values: string[]): string[] {
  const out = grams(outputs.join('\n'));
  const found: string[] = [];
  for (const value of values) {
    for (const g of grams(value)) if (out.has(g) && !TEMPLATE.has(g)) found.push(`„${g}” z „${value}”`);
  }
  return found;
}

test('adnotacja i protokół nie zawierają podciągu dłuższego niż 3 znaki spod żadnego zakresu', () => {
  const cases = [...buildDataset().cases, ...LETTERS];
  expect(cases.length).toBeGreaterThan(300);
  let aligned = 0;
  let checked = 0;
  const leaks: string[] = [];
  for (const c of cases) {
    for (const pseudonyms of [false, true]) {
      const { redacted } = redactPII(c.text, { pseudonyms });
      const a = alignSpans(c.text, redacted);
      if (!a) continue;
      aligned++;
      const n = countByToken(a.spans);
      const marks = [...n.values()].reduce((s, x) => s + x, 0);
      const outputs = [
        buildAnnotation(n, EMPTY),
        buildAnnotation(n, { ...EMPTY, withCounts: true }),
        buildProtocol({ ...BLANK, chars: c.text.length, lines: c.text.split('\n').length, counts: n, pseudonyms, marks }),
      ];
      const values = a.spans.map((s) => c.text.slice(s.start, s.end));
      checked += values.length;
      for (const l of leaksIn(outputs, values)) leaks.push(`${c.id}: ${l}`);
    }
  }
  expect(leaks).toEqual([]);
  // test ma sens tylko na dużej liczbie dopasowanych wyników i zasłoniętych wartości
  expect(aligned).toBeGreaterThan(cases.length);
  expect(checked).toBeGreaterThan(500);
  // strażnik strażnika: wartość albo jej kawałek w tekście zostałby wyłapany
  expect(leaksIn(['Wyłączenia dokonał(a): Kowalski.'], ['Jan Kowalski'])).not.toEqual([]);
  expect(leaksIn(['Znak sprawy: 85071412358'], ['PESEL 85071412358'])).not.toEqual([]);
  expect(leaksIn(['Przemysłowa'], ['ul. Przemysłowa 8'])).not.toEqual([]);
});
