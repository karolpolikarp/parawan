import { expect, test } from 'vitest';
import webHtml from '../index.html?raw';
import { ICONS } from './icons';
import {
  CAT_LABELS,
  type Cat,
  CHIP_BY_TOKEN,
  CHIP_META,
  catCountLabel,
  GENITIVE_LABEL,
  MASK_GROUP_DEFS,
  MASK_GROUPS,
  maskTip,
  PII_TOKENS,
  tokenOfCode,
  TYPE_TOKEN,
  WYKRYWA_ROWS,
} from './pii-meta';

const groupTypes = MASK_GROUP_DEFS.flatMap((g) => g.types);

test('każdy przełącznik ma token z kategorią i istniejącą ikoną', () => {
  for (const g of MASK_GROUPS) {
    const meta = PII_TOKENS[tokenOfCode(g.code)];
    expect(meta, g.code).toBeDefined();
    expect(ICONS[meta.icon], `${g.code}: ikona ${meta.icon}`).toBeTruthy();
  }
});

// Chipy „Zamaskowano”: każdy typ rdzenia ma polską etykietę (wcześniej VIN, IP czy KSEF
// pokazywały surowy kod). Record<PiiType, …> pilnuje tego w tsc, a test spina chipy
// z przełącznikami: typ bez przełącznika albo bez chipa to rozjazd.
test('chipy: wpis dla każdego typu z przełączników, z tokenem i ikoną', () => {
  expect(Object.keys(CHIP_META).sort()).toEqual([...groupTypes].sort());
  for (const [type, chip] of Object.entries(CHIP_META)) {
    expect(chip.token, type).toBe(TYPE_TOKEN[type]);
    expect(PII_TOKENS[chip.token], type).toBeDefined();
    expect(ICONS[chip.icon], type).toBeTruthy();
  }
});

// Chipy z zakresów (main.ts, renderFindings) liczą znaczniki po nazwie tokenu, a token bez
// wpisu w CHIP_BY_TOKEN nie dałby chipa. MASK_TOKEN_RE łapie wyłącznie klucze PII_TOKENS
// (plus [OSOBA-X], liczone jako imię i nazwisko), więc każdy z nich musi mieć chip.
test('chipy: każdy token z PII_TOKENS ma chip po nazwie tokenu', () => {
  for (const token of [...Object.keys(PII_TOKENS), 'IMIĘ I NAZWISKO'])
    expect(CHIP_BY_TOKEN[token], token).toBeDefined();
});

// Adnotacja o wyłączeniu jawności (publikacja.ts) wymienia zakres nazwami w dopełniaczu. Token
// bez wpisu dostałby w adnotacji zastępczy opis, więc nowy typ PII musi dopisać tu obie formy.
test('adnotacja: każdy token z PII_TOKENS ma GENITIVE_LABEL w obu liczbach', () => {
  expect(Object.keys(GENITIVE_LABEL).sort()).toEqual(Object.keys(PII_TOKENS).sort());
  for (const [token, [one, many]] of Object.entries(GENITIVE_LABEL)) {
    expect(one, token).toMatch(/^[a-ząćęłńóśźż][\p{L} -]+$/u);
    expect(many, token).toMatch(/^[a-ząćęłńóśźż][\p{L} -]+$/u);
    expect(one, token).not.toBe(many);
  }
  expect(GENITIVE_LABEL['IMIĘ I NAZWISKO']).toEqual(['imienia i nazwiska', 'imion i nazwisk']);
  expect(GENITIVE_LABEL['NR-KONTA']).toEqual(['numeru rachunku bankowego', 'numerów rachunków bankowych']);
});

test('chipy: skróty zostają skrótami, reszta po polsku małą literą', () => {
  expect(CHIP_META.KSEF.label).toBe('numer KSeF');
  expect(CHIP_META['PRAWO-JAZDY'].label).toBe('nr prawa jazdy');
  expect(CHIP_META.IP.label).toBe('adres IP');
});

test('tabela „Co wykrywa” ma po jednym wierszu na przełącznik', () => {
  expect(WYKRYWA_ROWS.map((r) => r.code).sort()).toEqual(MASK_GROUPS.map((g) => g.code).sort());
});

test('dymek znacznika: nazwa kategorii doklejana raz, z jednego słownika', () => {
  expect(maskTip('PESEL')).toBe(`Identyfikatory · ${PII_TOKENS.PESEL.tip}`);
  expect(maskTip('MIEJSCOWOŚĆ').startsWith('Adres · ')).toBe(true);
  expect(maskTip('DATA-URODZENIA').startsWith('Osoby · ')).toBe(true);
  expect(maskTip('OSOBA-B').startsWith('Osoby · ')).toBe(true);
  const labels = Object.values(CAT_LABELS);
  for (const [token, meta] of Object.entries(PII_TOKENS)) {
    expect(labels.some((l) => meta.tip.startsWith(l)), token).toBe(false);
  }
});

// Przy etykiecie („PESEL:”, „NIP”, „dowód”) rdzeń maskuje numer mimo złej sumy, więc dymek
// nie może twierdzić, że suma była poprawna.
test('dymki numerów z sumą kontrolną mówią o masce po etykiecie', () => {
  for (const token of ['PESEL', 'NIP', 'REGON', 'NR-DOWODU']) {
    expect(PII_TOKENS[token].tip, token).toMatch(/albo po (etykiecie|słowie)/);
    expect(PII_TOKENS[token].tip, token).not.toContain('suma kontrolna poprawna');
  }
  for (const key of ['pesel', 'nip', 'regon', 'dowod']) {
    expect(MASK_GROUP_DEFS.find((g) => g.key === key)?.tip, key).toContain('także mimo złej sumy');
  }
});

test('teksty bez mieszanych cudzysłowów „…" i bez liczby haseł słownika', () => {
  const texts = [
    ...Object.values(PII_TOKENS).map((m) => m.tip),
    ...MASK_GROUP_DEFS.map((g) => g.tip),
    ...WYKRYWA_ROWS.map((r) => r.how),
  ];
  for (const t of texts) {
    expect(t).not.toMatch(/„[^”\n]*"/);
    expect(t).not.toMatch(/~\d/); // słownik rośnie z każdym audytem, liczba szybko kłamie
  }
});

// Koperta to e-mail; token i login dają dostęp do konta, więc mają klucz.
test('token i login z ikoną klucza, e-mail z kopertą', () => {
  expect(PII_TOKENS.TOKEN.icon).toBe('klucz');
  expect(PII_TOKENS.LOGIN.icon).toBe('klucz');
  expect(PII_TOKENS.EMAIL.icon).toBe('koperta');
  expect(ICONS.klucz).toContain('currentColor');
});

test('legenda: zapasowe liczby w index.html zgodne z przełącznikami', () => {
  const found = [...webHtml.matchAll(/<span class="lg" data-cat="(\w+)"[\s\S]*?<span class="lg-n">([^<]+)<\/span>/g)];
  const cats = Object.keys(CAT_LABELS) as Cat[];
  expect(found.map((m) => m[1]).sort()).toEqual([...cats].sort());
  for (const [, cat, text] of found) expect(text, cat).toBe(catCountLabel(cat as Cat));
  const sum = found.reduce((s, [, , text]) => s + Number.parseInt(text, 10), 0);
  expect(sum).toBe(MASK_GROUPS.length);
});
