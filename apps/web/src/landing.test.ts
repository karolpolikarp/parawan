import { readFileSync } from 'node:fs';
import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import benchmarkMd from '../../../docs/BENCHMARK.md?raw';
import dlaRaw from '../../../docs/wydanie/DLA-IOD-I-IT.txt?raw';
import coreSrc from '../../../packages/core/src/index.ts?raw';
import landingHtmlRaw from '../../landing/index.html?raw';
import landingConfig from '../../landing/vite.config.ts?raw';
import { ICONS as LANDING_ICONS } from '../../landing/src/icons';
import { EXAMPLE_TEXT, MASK_TOKEN_RE, maskCategory, TYPE_MASK, typeCategory } from '../../landing/src/tokens';
import { MARKERS, SUMA_BRAK, wstawWydanie, wydanieZEnv } from '../../landing/src/wydanie';
import { PII_TOKENS } from './pii-meta';
import { ALLOWED_KEYS } from './storage';

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
  expect(landingHtml).not.toMatch(/href="pobierz\/[^"]*"[^>]*target=/);
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
  expect(nav).toContain('class="btn btn-cta btn-sm pasek-pobierz" href="pobierz/Parawan.html" download>');
  expect(nav).toContain('<a href="#dla-iod">Dla IOD i IT</a>');
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



// ── L01: „Dla IOD i działu IT”, suma SHA-256, pobieranie z domeny, uczciwe ograniczenia ──

// vitest podaje arkusze CSS z ?raw puste, więc style strony czytamy z dysku
const landingStyle = readFileSync(
  new URL('../../landing/src/style.css', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n');
const dla = dlaRaw.replace(/\r\n/g, '\n');
const iodSection = block(
  landingHtml,
  /<section class="dok" id="dla-iod">[\s\S]*?<\/section>/,
  'sekcja #dla-iod',
);
const pobierzSection = block(
  landingHtml,
  /<section class="dok" id="pobierz">[\s\S]*?<\/section>/,
  'sekcja #pobierz',
);

/** Pary „etykieta → treść” z dl.metryczka (treść bez tagów, ze zwiniętymi odstępami). */
function metryczka(html: string): Map<string, string> {
  const dl = block(html, /<dl class="metryczka[^"]*">[\s\S]*?<\/dl>/, 'dl.metryczka');
  return new Map(
    [...dl.matchAll(/<dt>([^<]+)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [
      m[1],
      textOf(m[2]).replace(/\s+/g, ' ').trim(),
    ]),
  );
}

test('landing: sekcja „Dla inspektora ochrony danych i działu IT” po #pobierz', () => {
  expect(landingHtml.indexOf('id="dla-iod"')).toBeGreaterThan(landingHtml.indexOf('id="pobierz"'));
  expect(iodSection).toContain('<div class="wrap dok-siatka">');
  expect(iodSection).toContain('<h2>Dla inspektora ochrony danych i działu IT</h2>');
  expect(iodSection).toContain(
    '<p>Najważniejsze fakty na jednej stronie. Pełna wersja jest w pliku DLA-IOD-I-IT.txt w każdym wydaniu.</p>',
  );
  // bez kart, pigułek i panelu CTA
  expect(iodSection).not.toMatch(/class="[^"]*\b(btn|chip-t|demo-card)\b/);
  expect(iodSection).toContain(
    '<a href="pobierz/DLA-IOD-I-IT.txt" download>Pobierz DLA-IOD-I-IT.txt</a>',
  );
  expect([...metryczka(iodSection).keys()]).toEqual([
    'Gdzie są przetwarzane dane',
    'Czy autor ma dostęp do danych',
    'Co zostaje na komputerze',
    'Anonimizacja czy pseudonimizacja',
    'Czego Parawan nie rozpozna',
    'Czego nie obejmuje CSP pliku',
    'Jak sprawdzić plik',
    'Jak wdrożyć w urzędzie',
    'Skąd wiadomo o aktualizacji',
    'Przeglądarki',
    'Dostępność',
  ]);
});

test('landing: #dla-iod zgodne z DLA-IOD-I-IT.txt, ALLOWED_KEYS i docs/BENCHMARK.md', () => {
  const rows = metryczka(iodSection);
  // klucze pamięci przeglądarki wymienione na stronie to dokładnie lista z storage.ts
  const keys = [...iodSection.matchAll(/<code class="klucz">([^<]+)<\/code>/g)].map((m) => m[1]);
  expect([...keys].sort()).toEqual([...ALLOWED_KEYS].sort());
  for (const k of keys) expect(dla, k).toMatch(new RegExp(`^ {4}${k} {2,}`, 'm'));
  // zasady grupy i polecenia z sekcji stoją też w pliku dla IOD
  const codes = [...iodSection.matchAll(/<code>([A-Z][A-Za-z]+)<\/code>/g)].map((m) => m[1]);
  expect(codes.length).toBeGreaterThanOrEqual(9);
  for (const c of codes) expect(dla, c).toContain(c);
  for (const c of [
    'gh attestation verify Parawan.html --repo karolpolikarp/parawan',
    'releases.atom',
  ]) {
    expect(textOf(iodSection), c).toContain(c);
    expect(dla, c).toContain(c);
  }
  // liczby z pomiaru jak w BENCHMARK.md i w DLA-IOD-I-IT.txt
  const sentences = benchmarkMd.match(/Zbiór ewaluacyjny:\*\* (\d+) syntetycznych zdań/)?.[1];
  const row = benchmarkMd.match(
    /\| T0\+T1 core \| [\d.]+% \((\d+)\/(\d+)\) \| [\d.]+% \((\d+)\/(\d+)\) \|/,
  );
  expect(sentences && row).toBeTruthy();
  const [, hit, mustMask, kept, mustKeep] = row ?? [];
  const pomiar = `W pomiarze na ${sentences} wymyślonych zdaniach zniknęło ${hit} z ${mustMask} fragmentów, które miały zniknąć, i zostało ${kept} z ${mustKeep}, które miały zostać.`;
  expect(rows.get('Czego Parawan nie rozpozna')).toContain(pomiar);
  expect(dla.replace(/\s+/g, ' ')).toContain(
    `W pomiarze na ${sentences} wymyślonych zdaniach zniknęło ${hit} z ${mustMask} fragmentów`,
  );
  // pseudonimizacja, motyw 26 RODO i decyzja inspektora jak w pliku
  expect(rows.get('Anonimizacja czy pseudonimizacja')).toContain('motywu 26 RODO');
  expect(rows.get('Czy autor ma dostęp do danych')).toContain(
    'rozstrzyga inspektor ochrony danych',
  );
  expect(dla.replace(/\s+/g, ' ')).toContain('rozstrzyga inspektor ochrony danych');
});

test('landing: przeglądarki i suma SHA-256 w #pobierz', () => {
  const pobierz = metryczka(pobierzSection);
  const iod = metryczka(iodSection);
  const browsers =
    'Edge i Chrome od wersji 109, Firefox od 115, także ESR, Safari od 16.4. Internet Explorer i tryb IE w Edge nie wystarczą.';
  expect(pobierz.get('Przeglądarki')).toBe(browsers);
  expect(iod.get('Przeglądarki')).toBe(browsers);
  // te same wersje co build.target strony (i aplikacji, pilnuje tego release-docs.test.ts)
  const target = landingConfig.match(/\nconst BUILD_TARGET = \[([^\]]*)\];/)?.[1] ?? '';
  expect(target).toContain("'chrome109', 'edge109', 'firefox115', 'safari16.4'");
  expect(dla).toContain('Edge i Chrome od wersji 109, Firefox od 115 (także ESR), Safari od 16.4.');
  // suma: znacznik dla builda i polecenia do sprawdzenia
  expect(pobierzSection).toContain('<dt>Suma SHA-256</dt><dd><!--PARAWAN:SUMA-->');
  expect(pobierz.get('Suma SHA-256')).toContain(
    'Sprawdzisz ją w PowerShellu: Get-FileHash .\\Parawan.html albo w wierszu poleceń: certutil -hashfile Parawan.html SHA256',
  );
  expect(landingStyle).toMatch(/\.suma \{[^}]*user-select: all/);
  // polecenia łamią się tylko na spacji: cały <code> w nowrap wchodził przy 901–1080 px na
  // sąsiednią kolumnę, a człon łamany po łączniku przepisuje się z ekranu jako „-- repo”
  expect(landingStyle).not.toMatch(/\.suma-pod code \{[^}]*nowrap/);
  for (const flag of ['Get-FileHash', '-hashfile', '--repo']) {
    expect(iodSection, flag).toContain(`<span class="nw">${flag}</span>`);
  }
  expect(pobierzSection).toContain('<span class="nw">Get-FileHash</span>');
  expect(pobierzSection).toContain('<span class="nw">-hashfile</span>');
  expect(pobierz.get('Aktualizacje')).toContain('kanale Atom');
  expect(pobierzSection).toContain('href="https://github.com/karolpolikarp/parawan/releases.atom"');
  expect(pobierz.get('Wynik')).toMatch(/skopiowania.*\.txt lub \.docx.*wydruku, także do PDF/);
  expect(pobierz.get('Pochodzenie')).toMatch(
    /JakiePrawo\.pl.*Parawan\.html nie łączy się z tym serwisem\.$/,
  );
});

test('landing: przyciski pobierania prowadzą do kopii na domenie, obok GitHub', () => {
  const ctas = [
    ...landingHtml.matchAll(/<a class="btn btn-cta[^"]*" href="([^"]+)"( download)?>/g),
  ];
  expect(ctas.length).toBe(3);
  for (const [, href, dl] of ctas) {
    expect(href).toBe('pobierz/Parawan.html');
    expect(dl).toBe(' download');
  }
  // przy dużych przyciskach (pierwszy ekran i #pobierz) mniejszy odsyłacz do tego samego pliku na GitHubie
  const gh = [
    ...landingHtml.matchAll(
      /<a (?:class="dl-gh" )?href="https:\/\/github\.com\/karolpolikarp\/parawan\/releases\/latest\/download\/([^"]+)">albo z GitHuba<\/a>/g,
    ),
  ].map((m) => m[1]);
  expect(gh).toEqual(['Parawan.html', 'Parawan.html', 'DLA-IOD-I-IT.txt']);
});

test('landing: build wstawia sumę i tag z wydania, a bez nich odsyła do strony wydania', () => {
  for (const marker of Object.values(MARKERS)) expect(landingHtmlRaw.split(marker)).toHaveLength(2);
  expect(wydanieZEnv({})).toBeNull();
  const sha = 'ab'.repeat(32);
  const w = wydanieZEnv({ PARAWAN_SHA256: sha.toUpperCase(), PARAWAN_VERSION: 'v0.46.25' });
  expect(w).toEqual({ sha256: sha, version: '0.46.25' });
  const out = wstawWydanie(landingHtmlRaw, w);
  expect(out.split(`<code class="suma" translate="no">${sha}</code>`)).toHaveLength(3);
  expect(out).toContain('git checkout v0.46.25\n');
  expect(out).not.toContain('<!--PARAWAN:');
  const local = wstawWydanie(landingHtmlRaw, null);
  expect(local.split(SUMA_BRAK)).toHaveLength(3);
  expect(textOf(SUMA_BRAK)).toBe('Suma jest podana na stronie wydania.');
  expect(local).not.toContain('<!--PARAWAN:');
  // obcięta suma albo sama wersja zatrzymują build zamiast zostawić stronę z błędną sumą
  expect(() => wydanieZEnv({ PARAWAN_SHA256: sha.slice(1), PARAWAN_VERSION: '0.46.25' })).toThrow();
  expect(() => wydanieZEnv({ PARAWAN_VERSION: '0.46.25' })).toThrow();
  expect(() => wydanieZEnv({ PARAWAN_SHA256: sha, PARAWAN_VERSION: 'latest' })).toThrow();
  expect(() => wstawWydanie('<html></html>', null)).toThrow(/PARAWAN:SUMA/);
  expect(landingConfig).toMatch(/plugins: \[[^\]]*wydanieMeta/);
});

test('landing: „Jak sprawdzić” zachęca do zmyślonego tekstu i buduje z tagu', () => {
  const sprawdz = block(
    landingHtml,
    /<section class="dok" id="sprawdz">[\s\S]*?<\/section>/,
    'sekcja #sprawdz',
  );
  expect(sprawdz).toContain('Wklej w demo dowolny tekst, najlepiej zmyślony, i skopiuj wynik');
  expect(sprawdz).not.toContain('własny tekst');
  expect(sprawdz).toContain(
    '<p class="kroki-pod">Prawdziwe pisma otwieraj w pobranym pliku. Strona w internecie służy do wypróbowania.</p>',
  );
  // polecenia budowy na stronie to te same wiersze co w DLA-IOD-I-IT.txt (tag zamiast {{WERSJA}})
  const pre = block(
    sprawdz,
    /<pre class="csp polecenia"[^>]*><code>[\s\S]*?<\/code><\/pre>/,
    'pre.polecenia',
  );
  // na wąskim ekranie blok przewija się w poziomie, więc musi przyjąć fokus z klawiatury
  expect(pre).toMatch(/^<pre class="csp polecenia" tabindex="0" role="region" aria-label="Polecenia budowy">/);
  const onPage = textOf(pre.replace(MARKERS.tag, 'v{{WERSJA}}')).split('\n');
  const inDla = (dla.match(/BUDOWA Z KODU\n[\s\S]*?\n((?: {4}\S.*\n)+)/)?.[1] ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  expect(inDla.length).toBe(5);
  expect(onPage).toEqual(inDla);
  expect(sprawdz).toContain('Suma wyjdzie taka sama jak przy pliku z wydania.');
});

test('landing: blok dla firm i urzędów, nagłówki zostają', () => {
  const firma = block(landingHtml, /<div class="firma">[\s\S]*?<\/div>/, 'div.firma');
  expect(firma).toContain('<h3>Przechodzi tam, gdzie „program” się nie przeciśnie</h3>');
  expect(textOf(firma)).toContain(
    'Parawan.html nie wymaga instalacji ani uprawnień administratora, więc dział IT może go dopuścić bez wdrażania programu. Najprościej położyć jedną kopię tylko do odczytu na dysku sieciowym i dodać skrót albo zakładkę. Aktualizacja to podmiana tego jednego pliku po sprawdzeniu sumy.',
  );
  expect(textOf(firma)).toContain(
    'Czy wolno go używać w pracy, decyduje Twój urząd. Inspektorowi ochrony danych i działowi IT wyślij plik DLA-IOD-I-IT.txt z wydania. Część skrzynek blokuje załączniki .html, więc sam Parawan wysyłaj jako link.',
  );
  expect(landingHtml).toContain('<p><b>Bez ściemy.</b> ');
});

test('landing: ograniczenia dla urzędu zgodne z silnikiem', () => {
  const granice = block(landingHtml, /<ul class="granice">[\s\S]*?<\/ul>/, 'ul.granice');
  const claims: [onPage: string, input: string, output: string][] = [
    [
      'Imię i nazwisko urzędnika, który podpisał pismo, znika tak samo jak dane strony.',
      'Z up. Burmistrza\nJan Kowalski\nKierownik Referatu',
      'Z up. Burmistrza\n[IMIĘ I NAZWISKO]\nKierownik Referatu',
    ],
    // D01 (typ NR-KW) usuwa to zdanie, a ten test przypomni o tym, gdy numer zacznie znikać
    [
      'Numer księgi wieczystej i numer działki zostają w tekście.',
      'Księga wieczysta nr KR1P/00012345/0, działka nr 245/7.',
      'Księga wieczysta nr KR1P/00012345/0, działka nr 245/7.',
    ],
  ];
  for (const [onPage, input, output] of claims) {
    expect(granice, onPage).toContain(onPage);
    expect(redacted(input), input).toBe(output);
  }
  expect(granice).toContain('W BIP zwykle trzeba je zostawić jawne.');
  expect(granice).toContain(
    'Parawan nie zmienia oryginalnego pliku. Autor we właściwościach, komentarze i historia zmian zostają w oryginale, więc publikuj nowy dokument z wyniku.',
  );
  expect(iodSection).toContain('numeru księgi wieczystej, numeru działki');
});

test('landing: wydruk to sama sekcja #dla-iod', () => {
  const print = landingStyle.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(print).toMatch(/main > :not\(#dla-iod\)/);
  expect(print).toMatch(/\.pasek/);
  expect(print).toMatch(/\.iod-pobierz/);
  expect(print).toMatch(/color: #000/);
  // kartka w teczce IOD jest samodzielna: pełne polecenia sumy, a odsyłacze do innych sekcji
  // strony stoją tylko w .tylko-ekran, którego wydruk nie pokazuje
  expect(print).toMatch(/\.tylko-ekran \{ display: none; \}/);
  const kody = [...iodSection.matchAll(/<code>([\s\S]*?)<\/code>/g)].map((m) => textOf(m[1]));
  expect(kody).toContain('certutil -hashfile Parawan.html SHA256');
  expect(kody).toContain('Get-FileHash .\\Parawan.html');
  expect(iodSection).not.toContain('wyżej');
  const bezEkranu = iodSection.replace(/<span class="tylko-ekran">[\s\S]*?<\/span>/g, '');
  expect(bezEkranu).not.toMatch(/href="#(?!dla-iod)/);
  expect(textOf(bezEkranu)).not.toMatch(/punkt\S* \d/);
});

test('landing: ton nowych fragmentów bez wtrąceń i bez „nas”', () => {
  const fragments = [
    iodSection,
    pobierzSection,
    block(landingHtml, /<ul class="granice">[\s\S]*?<\/ul>/, 'ul.granice'),
    block(landingHtml, /<p class="kroki-pod">[\s\S]*?<\/p>/, 'p.kroki-pod'),
  ].map((f) => textOf(f.replace(/<!--[\s\S]*?-->/g, '')));
  for (const f of fragments) {
    expect(f).not.toContain(' — ');
    expect(f).not.toMatch(/(^|[^\p{L}])(nas|nam|nasz\p{L}*|nami)(?!\p{L})/iu);
    expect(f).not.toMatch(/100%|w pełni|po prostu/i);
  }
});
