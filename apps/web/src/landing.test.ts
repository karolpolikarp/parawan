import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import benchmarkMd from '../../../docs/BENCHMARK.md?raw';
import coreSrc from '../../../packages/core/src/index.ts?raw';
import landingHtmlRaw from '../../landing/index.html?raw';
import { ICONS as LANDING_ICONS } from '../../landing/src/icons';
import { EXAMPLE_TEXT, MASK_TOKEN_RE, maskCategory, TYPE_MASK, typeCategory } from '../../landing/src/tokens';
import { PII_TOKENS } from './pii-meta';

// Landing nie ma własnych testów: pilnujemy go stąd, jak w a11y-markup.test.ts. Liczby, znaczniki
// i przykłady na stronie łatwo rozjechać z rdzeniem (nowy typ PII, nowy pomiar benchmarku, zmiana
// reguły), więc porównujemy je ze źródłem prawdy, a nie z liczbą wpisaną na sztywno w teście.

// twarde spacje po jednoliterowych słowach nie mają znaczenia dla porównań treści
const landingHtml = landingHtmlRaw.replace(/ /g, ' ');

// Mapa MASK z rdzenia (typ → znacznik bez nawiasów), odczytana ze źródła: rdzeń jej nie eksportuje.
const maskBlock = coreSrc.match(/const MASK: Record<PiiType, string> = \{([\s\S]*?)\n\};/)?.[1] ?? '';
const CORE_MASK: Record<string, string> = Object.fromEntries(
  [...maskBlock.matchAll(/^\s*'?([A-Z-]+)'?: '\[([^\]]+)\]',\s*$/gm)].map((m) => [m[1], m[2]]),
);
const CORE_TOKENS = [...new Set(Object.values(CORE_MASK))];

/** Tekst fragmentu HTML bez tagów, z odkodowanymi encjami (tak, jak widzi go czytelnik). */
const textOf = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

/** Pierwszy element pasujący do wzorca (z czytelnym błędem, gdy go nie ma). */
function block(html: string, re: RegExp, what: string): string {
  const m = html.match(re);
  if (!m) throw new Error(`na landingu brak: ${what}`);
  return m[0];
}

const redacted = (s: string): string => redactPII(s).redacted;

/** Odmiana „typ / typy / typów” po liczebniku (24 typy, 25 typów, 22 typy, 12 typów). */
const typy = (n: number): string =>
  n === 1 ? 'typ' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'typy' : 'typów';

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

test('landing: liczba typów w nagłówku, tabeli kategorii i opisie strony', () => {
  // tabela kategorii w #typy: jeden chip na znacznik rdzenia
  const chips: Record<string, number> = {};
  for (const m of landingHtml.matchAll(/<span class="chip-t ct-(\w+)">/g)) {
    chips[m[1]] = (chips[m[1]] ?? 0) + 1;
  }
  const total = Object.values(chips).reduce((a, b) => a + b, 0);
  expect(total).toBe(CORE_TOKENS.length);
  // chipy stoją w wierszach kategorii z TYPE_MASK (kolory w demo i w aplikacji); jeden znacznik
  // = jeden chip, więc IBAN i NR-KONTA liczą się raz
  const perCat: Record<string, number> = {};
  for (const { cat } of new Map(Object.values(TYPE_MASK).map((m) => [m.token, m])).values()) {
    perCat[cat] = (perCat[cat] ?? 0) + 1;
  }
  expect(chips).toEqual(perCat);
  // nagłówek wiersza (legenda): liczba przy każdej kategorii to liczba jej chipów
  const legend = [...landingHtml.matchAll(/<span class="tl ct-(\w+)">[^<·]+· (\d+)<\/span>/g)];
  expect(Object.fromEntries(legend.map((m) => [m[1], Number(m[2])]))).toEqual(chips);
  // nagłówek sekcji, meta description i dane strukturalne
  expect(landingHtml).toContain(`<h2>${total} ${typy(total)} polskich danych w ${legend.length} kategoriach</h2>`);
  const meta = landingHtml.match(/name="description"\s+content="[^"(]*\(([^)]*) i (\d+) innych typów\)/);
  expect(meta).toBeTruthy();
  expect((meta?.[1] ?? '').split(',').length + Number(meta?.[2])).toBe(total);
  expect(landingHtml).toMatch(new RegExp(`"description": "[^"]*Rozpoznaje ${total} ${typy(total)} danych`));
});

test('landing: notka i liczby benchmarku zgodne z docs/BENCHMARK.md', () => {
  const version = benchmarkMd.match(/Wersja rdzenia \(`anonimizator`\):\*\* ([\d.]+)/)?.[1];
  const sentences = benchmarkMd.match(/Zbiór ewaluacyjny:\*\* (\d+) syntetycznych zdań/)?.[1];
  expect(version && sentences).toBeTruthy();
  expect(landingHtml).toContain(
    `zbiorze ${sentences} syntetycznych zdań (rdzeń <code>anonimizator</code> ${version})`,
  );
  const row = benchmarkMd.match(
    /\| T0\+T1 core \| ([\d.]+)% \((\d+)\/(\d+)\) \| ([\d.]+)% \((\d+)\/(\d+)\) \| ([\d.]+)% \|/,
  );
  expect(row).toBeTruthy();
  const [, recall, hit, mustMask, precision, kept, mustKeep, f1] = row ?? [];
  // trzy miary w kolejności wykrywalność, trafność, F1
  const shown = [...landingHtml.matchAll(/<td class="m-val"[^>]*>([\d,]+)%<\/td>/g)].map((m) => m[1]);
  expect(shown).toEqual([recall, precision, f1].map((v) => v.replace('.', ',')));
  // liczby bezwzględne obok miar i liczba wycieków w „Bez ściemy”
  expect(landingHtml).toContain(`Z ${mustMask} fragmentów, które miały zniknąć, zniknęło ${hit}.`);
  expect(landingHtml).toContain(`Z ${mustKeep} fragmentów, które miały zostać, zostało ${kept}.`);
  expect(landingHtml).toContain(`Każdy z ${Number(mustMask) - Number(hit)} wycieków w pomiarze`);
});

test('landing: silnik i CLI prowadzą do packages/core, nie do nieopublikowanego pakietu npm', () => {
  expect(landingHtml).not.toContain('npmjs.com');
  const core = 'https://github.com/karolpolikarp/parawan/tree/main/packages/core';
  // punkt 5 „Jak sprawdzić” i stopka
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
  expect(landingHtml).toMatch(/<h3>Sumy kontrolne<\/h3>\s*<p>[^<]*numer karty[^<]*numerze KSeF sprawdza NIP/);
  // zgłoszenia na GitHubie widzi każdy: ostrzeżenie przed prawdziwymi danymi
  expect(landingHtml).toContain('Zgłoszenia są publiczne');
  // pobranie w nowej karcie zostawia pustą kartę (Firefox, Safari na iOS)
  expect(landingHtml).toMatch(/releases\/latest\/download\/Parawan\.html"/);
  expect(landingHtml).not.toMatch(/releases\/latest\/download\/Parawan\.html"[^>]*target=/);
});

test('landing: ikony, pasek i kotwice', () => {
  // każda ikona ze strony istnieje i żadna ikona w ICONS nie wisi bez użycia
  const used = new Set([...landingHtml.matchAll(/data-i="([^"]+)"/g)].map((m) => m[1]));
  for (const name of used) expect(LANDING_ICONS[name], name).toBeTruthy();
  expect(Object.keys(LANDING_ICONS).sort()).toEqual([...used].sort());
  // bez menu mobilnego: pobranie stoi w pasku także na telefonie; licznik żądań jest w „Jak sprawdzić”
  expect(landingHtml).not.toContain('nav-toggle');
  const nav = block(landingHtml, /<nav class="pasek"[\s\S]*?<\/nav>/, 'pasek <nav class="pasek">');
  expect(nav).not.toContain('id="net-count"');
  expect(landingHtml.slice(landingHtml.indexOf('id="sprawdz"'))).toContain('id="net-count"');
  expect(nav).toContain(
    'class="btn btn-cta btn-sm pasek-pobierz" href="https://github.com/karolpolikarp/parawan/releases/latest/download/Parawan.html">',
  );
  // każdy link wewnętrzny ma cel na stronie
  const ids = new Set([...landingHtml.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...new Set([...landingHtml.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]))];
  expect(anchors.length).toBeGreaterThanOrEqual(5);
  for (const a of anchors) expect(ids.has(a), `#${a}`).toBe(true);
  // link „Ograniczenia” prowadzi do nagłówka o tej samej nazwie
  expect(landingHtml).toContain('<h3 class="ogr-tyt" id="ograniczenia">Ograniczenia</h3>');
});

test('landing: przykład z demo i przykłady w treści zgodne z silnikiem', () => {
  // (a) przykład w demo: tyle fragmentów i kategorii, ile podaje sekcja „Co się stało z przykładem”
  const { redacted: out, found } = redactPII(EXAMPLE_TEXT);
  const tokens = [...out.matchAll(MASK_TOKEN_RE)].map((m) => m[1]);
  expect(found.reduce((s, f) => s + f.count, 0)).toBe(tokens.length);
  const zn = block(landingHtml, /<p class="zniknelo">[\s\S]*?<\/p>/, 'p.zniknelo');
  const shown = [...zn.matchAll(/<mark class="pii pii-(\w+)">\[([^\]]+)\]<\/mark>/g)];
  // (b) te same znaczniki po kolei, w kolorach kategorii, i ta sama liczba w podpisie
  expect(shown.map((m) => m[2])).toEqual(tokens);
  for (const [, cat, token] of shown) expect(cat, token).toBe(maskCategory(token));
  expect(zn).toContain(`Zasłonięto ${tokens.length} fragmentów:`);
  expect(new Set(shown.map((m) => m[1])).size).toBe(new Set(found.map((f) => typeCategory(f.type))).size);
  // (c) to, co według tabeli zostało, stoi w przykładzie i w wyniku bez zmian
  const table = block(landingHtml, /<table class="zostalo">[\s\S]*?<\/table>/, 'table.zostalo');
  const stets = [...table.matchAll(/<code class="stet">([^<]*)<\/code>/g)].map((m) => textOf(m[1]));
  expect(stets.length).toBeGreaterThanOrEqual(3);
  for (const s of stets) {
    expect(EXAMPLE_TEXT, s).toContain(s);
    expect(out, s).toContain(s);
  }
  // (d) numer, który zostaje, nie zdradza zasłoniętego PESEL-u (10 pierwszych cyfr wystarczy,
  //     żeby z algorytmu odtworzyć ostatnią)
  const elevens = [...EXAMPLE_TEXT.matchAll(/(?<!\d)\d{11}(?!\d)/g)].map((m) => m[0]);
  const hidden = elevens.filter((n) => !out.includes(n));
  expect(hidden).toHaveLength(1);
  for (const n of elevens.filter((x) => out.includes(x))) {
    expect(n.slice(0, 10), n).not.toBe(hidden[0].slice(0, 10));
  }

  // (e) pary „zasłania / zostawia / przechodzi” w sekcji #typy
  const typy = block(landingHtmlRaw, /<section class="dok" id="typy">[\s\S]*?<\/section>/, 'sekcja #typy');
  const pairs = [...typy.matchAll(/<dd><code>([\s\S]*?)<\/code><span class="po">→\s<code>([\s\S]*?)<\/code><\/span><\/dd>/g)];
  expect(pairs.length).toBe(4);
  for (const [, input, output] of pairs) expect(redacted(textOf(input)), textOf(input)).toBe(textOf(output));
  const keeps = [...typy.matchAll(/<dd><code class="stet">([\s\S]*?)<\/code><\/dd>/g)].map((m) => textOf(m[1]));
  expect(keeps.length).toBe(3);
  for (const k of keeps) expect(redacted(k), k).toBe(k);
  const leaks = [...typy.matchAll(/class="dt-err">[^<]*<\/dt><dd><code>([\s\S]*?)<\/code><\/dd>/g)];
  expect(leaks.length).toBe(1);
  for (const [, c] of leaks) {
    expect(c).toContain('<mark class="leak">');
    expect(redacted(textOf(c)), textOf(c)).toBe(textOf(c)); // wyciek nadal istnieje
  }

  // (e) wpadki z pomiaru w „Ograniczeniach”: wycieki dalej przechodzą, „Pan Tadeusz” dalej znika
  const wpadki = block(landingHtmlRaw, /<ul class="wpadki">[\s\S]*?<\/ul>/, 'ul.wpadki');
  const lines = [...wpadki.matchAll(/<li><code>([\s\S]*?)<\/code>/g)].map((m) => m[1]);
  expect(lines.length).toBe(3);
  for (const c of lines) {
    if (c.includes('class="leak"')) {
      expect(redacted(textOf(c)), textOf(c)).toBe(textOf(c));
    } else {
      expect(textOf(c).startsWith('Pan [IMIĘ I NAZWISKO]'), textOf(c)).toBe(true);
      expect(landingHtml).toContain('„Pan Tadeusz”');
      expect(redacted(textOf(c).replace('[IMIĘ I NAZWISKO]', 'Tadeusz'))).toBe(textOf(c));
    }
  }

  // (f) nota o polach formularza, XML i JSON: zasłonięta sama wartość, struktura zostaje
  const nota = block(landingHtmlRaw, /<p class="nota">[\s\S]*?<\/p>/, 'p.nota');
  const lastCode = [...nota.matchAll(/<code>([\s\S]*?)<\/code>/g)].pop()?.[1] ?? '';
  expect(redacted('{"lastName": "Kowalski"}')).toBe(textOf(lastCode));
  expect(redacted('Nazwisko: Achtelik')).toBe('Nazwisko: [IMIĘ I NAZWISKO]');
  expect(redacted('<Surname>Achtelik</Surname>')).toBe('<Surname>[IMIĘ I NAZWISKO]</Surname>');

  // zdania z opisów metod: przykład z treści (musi stać na stronie) → oczekiwany wynik silnika
  const claims: [onPage: string, input: string, output: string][] = [
    ['(„Pawlakowi”)', 'Przekazano Pawlakowi dokumenty.', 'Przekazano [IMIĘ I NAZWISKO] dokumenty.'],
    ['(„Bąkiewiczowi”)', 'Przekazano Bąkiewiczowi dokumenty.', 'Przekazano [IMIĘ I NAZWISKO] dokumenty.'],
    ['Samo imię zostaje.', 'Maria przyszła.', 'Maria przyszła.'],
    ['Z imieniem albo z „Pani” znika', 'Pani Achtelik', 'Pani [IMIĘ I NAZWISKO]'],
    ['(„zam. w Krakowie”)', 'zam. w Krakowie', 'zam. w [MIEJSCOWOŚĆ]'],
    ['w nazwie sądu zostaje', 'Sąd Rejonowy w Krakowie', 'Sąd Rejonowy w Krakowie'],
    ['w zwykłym zdaniu', 'Jadę jutro do Krakowa.', 'Jadę jutro do Krakowa.'],
    ['nazwie sieci, np. Visa', 'Karta Visa 4111 1111 1111 1111', 'Karta Visa [NR-KARTY]'],
    ['numer IMEI telefonu', 'IMEI 490154203237518', 'IMEI 490154203237518'],
    ['po „sygn.”', 'z 12.03.2019 r., sygn. II CSK 123/18', 'z 12.03.2019 r., sygn. [ZNAK-SPRAWY]'],
    ['OR-II.1431.12.2024', 'Pismo OR-II.1431.12.2024 z dnia', 'Pismo [ZNAK-SPRAWY] z dnia'],
    ['17-znakowy</span> numer VIN', 'Samochód WVWZZZ1JZXW000001 sprzedano', 'Samochód [VIN] sprzedano'],
    // numer KSeF tylko wtedy, gdy słowo „KSeF” pada w dokumencie (bez niego zostaje reszta numeru)
    [
      'gdziekolwiek w dokumencie',
      'Faktura 5265877635-20250826-0100001AF629-AF. Wysłano do KSeF.',
      'Faktura [NR-KSEF]. Wysłano do KSeF.',
    ],
  ];
  for (const [onPage, input, output] of claims) {
    expect(landingHtml, onPage).toContain(onPage);
    expect(redacted(input), input).toBe(output);
  }
});

test('landing: twarde spacje po jednoliterowych wyrazach i przed „MB”', () => {
  // test normalizuje tylko znak U+00A0, więc encja przeszłaby niezauważona
  expect(landingHtmlRaw).not.toContain('&nbsp;');
  // Fragmenty w <code> trafiają do silnika w teście wyżej, a znaczniki rdzenia ([IMIĘ I NAZWISKO])
  // mają zwykłe spacje, więc te miejsca pomijamy.
  const text = landingHtmlRaw
    .replace(/<head>[\s\S]*?<\/head>/, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(code|pre|textarea|script|style)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<mark class="pii[^"]*">[\s\S]*?<\/mark>/g, ' ')
    .replace(/<[^>]+>/g, '');
  const around = (i: number): string => text.slice(Math.max(0, i - 25), i + 25);
  const single = [...text.matchAll(/(^|[\s>(„])[aiouwzAIOUWZ] (?=\S)/g)].map((m) => around(m.index ?? 0));
  expect(single).toEqual([]);
  const mb = [...text.matchAll(/\d MB/g)].map((m) => around(m.index ?? 0));
  expect(mb).toEqual([]);
});
