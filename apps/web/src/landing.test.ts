import { expect, test } from 'vitest';
import benchmarkMd from '../../../docs/BENCHMARK.md?raw';
import coreSrc from '../../../packages/core/src/index.ts?raw';
import landingHtmlRaw from '../../landing/index.html?raw';
import { ICONS as LANDING_ICONS } from '../../landing/src/icons';
import { MASK_TOKEN_RE, maskCategory, TYPE_MASK } from '../../landing/src/tokens';
import { PII_TOKENS } from './pii-meta';

// Landing nie ma własnych testów: pilnujemy go stąd, jak w a11y-markup.test.ts. Liczby i znaczniki
// na stronie łatwo rozjechać z rdzeniem (nowy typ PII, nowy pomiar benchmarku), więc porównujemy
// je ze źródłem prawdy, a nie z liczbą wpisaną na sztywno w teście.

// twarde spacje po jednoliterowych słowach nie mają znaczenia dla porównań treści
const landingHtml = landingHtmlRaw.replace(/ /g, ' ');

// Mapa MASK z rdzenia (typ → znacznik bez nawiasów), odczytana ze źródła: rdzeń jej nie eksportuje.
const maskBlock = coreSrc.match(/const MASK: Record<PiiType, string> = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const CORE_MASK: Record<string, string> = Object.fromEntries(
  [...maskBlock.matchAll(/^\s*'?([A-Z-]+)'?: '\[([^\]]+)\]',\s*$/gm)].map((m) => [m[1], m[2]]),
);
const CORE_TOKENS = [...new Set(Object.values(CORE_MASK))];

test('landing: znaczniki demo zgodne z mapą MASK rdzenia', () => {
  expect(Object.keys(CORE_MASK).length).toBeGreaterThan(20);
  expect(Object.keys(TYPE_MASK).sort()).toEqual(Object.keys(CORE_MASK).sort());
  for (const [type, token] of Object.entries(CORE_MASK)) {
    expect(TYPE_MASK[type as keyof typeof TYPE_MASK].token, type).toBe(token);
  }
});

test('landing: wzorzec znaczników łapie każdy znacznik rdzenia i OSOBA-A/B…', () => {
  for (const token of [...CORE_TOKENS, 'OSOBA-A', 'OSOBA-AB']) {
    expect(`x [${token}] y`.split(MASK_TOKEN_RE), token).toEqual(['x ', token, ' y']);
  }
  expect('[NIEZNANY]'.split(MASK_TOKEN_RE)).toEqual(['[NIEZNANY]']);
});

test('landing: kolory znaczników w demo jak w aplikacji', () => {
  for (const token of CORE_TOKENS) {
    expect(maskCategory(token), token).toBe(PII_TOKENS[token]?.cat);
  }
  expect(maskCategory('OSOBA-C')).toBe('person');
});

test('landing: liczba typów w pasku, nagłówku, legendzie, FAQ i opisie strony', () => {
  // chmura typów: jeden chip na znacznik rdzenia
  const chips: Record<string, number> = {};
  for (const m of landingHtml.matchAll(/<span class="chip-t ct-(\w+)">/g)) {
    chips[m[1]] = (chips[m[1]] ?? 0) + 1;
  }
  const total = Object.values(chips).reduce((a, b) => a + b, 0);
  expect(total).toBe(CORE_TOKENS.length);
  // legenda: liczba przy każdej kategorii to liczba jej chipów
  const legend = [...landingHtml.matchAll(/<span class="tl ct-(\w+)">[^<·]+· (\d+)<\/span>/g)];
  expect(Object.fromEntries(legend.map((m) => [m[1], Number(m[2])]))).toEqual(chips);
  // pasek zaufania, nagłówek sekcji, FAQ i meta description
  expect(landingHtml).toContain(
    `<span class="trust-num">${total}</span><span class="trust-lbl">typy danych</span>`,
  );
  expect(landingHtml).toContain(`<h2>${total} typy polskich danych w ${legend.length} kategoriach</h2>`);
  expect(landingHtml).toContain(`<div class="faq-b">${total} typy polskich danych:`);
  const meta = landingHtml.match(/name="description"\s+content="[^"(]*\(([^)]*) i (\d+) innych typów\)/);
  expect(meta).toBeTruthy();
  expect((meta?.[1] ?? '').split(',').length + Number(meta?.[2])).toBe(total);
});

test('landing: notka i liczby benchmarku zgodne z docs/BENCHMARK.md', () => {
  const version = benchmarkMd.match(/Wersja rdzenia \(`anonimizator`\):\*\* ([\d.]+)/)?.[1];
  const sentences = benchmarkMd.match(/Zbiór ewaluacyjny:\*\* (\d+) syntetycznych zdań/)?.[1];
  expect(version && sentences).toBeTruthy();
  expect(landingHtml).toContain(
    `zbiorze ${sentences} syntetycznych zdań (rdzeń <code>anonimizator</code> ${version})`,
  );
  const row = benchmarkMd.match(/\| T0\+T1 core \| ([\d.]+)% [^|]*\| ([\d.]+)% [^|]*\| ([\d.]+)% \|/);
  expect(row).toBeTruthy();
  const shown = [...landingHtml.matchAll(/<div class="trust-num">([\d,]+)%<\/div>/g)].map((m) => m[1]);
  expect(shown).toEqual((row ?? []).slice(1, 4).map((v) => v.replace('.', ',')));
});

test('landing: silnik i CLI prowadzą do packages/core, nie do nieopublikowanego pakietu npm', () => {
  expect(landingHtml).not.toContain('npmjs.com');
  const core = 'https://github.com/karolpolikarp/parawan/tree/main/packages/core';
  expect(landingHtml.split(`href="${core}"`)).toHaveLength(3);
});

test('landing: obietnice zgodne z tym, jak działa Parawan', () => {
  // zatwierdzenie narzędzia to decyzja organizacji, a nie skutek braku instalacji
  expect(landingHtml).not.toContain('Nie trzeba zgody działu bezpieczeństwa');
  // ustawienia „Co maskować” zostają w przeglądarce; znika tekst, nie wszystko
  expect(landingHtml).not.toContain('Znika bez śladu');
  expect(landingHtml).not.toContain('Nic nie zostaje.');
  expect(landingHtml).toContain('Przeglądarka pamięta jedynie Twoje ustawienia');
  // Parawan.html to 2 MB zminifikowanego kodu, a nie plik do przeczytania
  expect(landingHtml).not.toContain('możesz go przeczytać w całości');
  // karta płatnicza ma sumę Luhna; w numerze KSeF sprawdzany jest NIP wystawcy
  expect(landingHtml).toMatch(/<b>Sumy kontrolne\.<\/b>[^<]*numer karty[^<]*numerze KSeF sprawdza NIP/);
});

test('landing: każda ikona ze strony istnieje, przycisk menu ma ikonę menu', () => {
  for (const [, name] of landingHtml.matchAll(/data-i="([^"]+)"/g)) {
    expect(LANDING_ICONS[name], name).toBeTruthy();
  }
  expect(landingHtml).toMatch(/id="nav-toggle"[^>]*><i class="gi" data-i="menu"><\/i>/);
});
