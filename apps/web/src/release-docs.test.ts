import { expect, test } from 'vitest';
import benchmarkMdRaw from '../../../docs/BENCHMARK.md?raw';
import dlaRaw from '../../../docs/wydanie/DLA-IOD-I-IT.txt?raw';
import jakRaw from '../../../docs/wydanie/JAK-UZYC.txt?raw';
import webHtmlRaw from '../index.html?raw';
import webConfigRaw from '../vite.config.ts?raw';
import webMainRaw from './main.ts?raw';
import { ALLOWED_KEYS } from './storage';

// Szablony plików wydania (docs/wydanie/, wypełnia je scripts/release/render-docs.mjs). IOD
// i dział IT czytają je zamiast repozytorium, więc każda obietnica w nich, która zależy od kodu,
// jest tu porównana z kodem: polityka CSP, klucze localStorage, formaty plików, przeglądarki,
// nazwy przycisków i liczby z pomiaru. Rozjazd wywraca test, zanim trafi do wydania.

const lf = (s: string) => s.replace(/\r\n/g, '\n');
const dla = lf(dlaRaw);
const jak = lf(jakRaw);
const webHtml = lf(webHtmlRaw);
const webConfig = lf(webConfigRaw);
const benchmarkMd = lf(benchmarkMdRaw);
const DOCS = [
  ['DLA-IOD-I-IT.txt', dla],
  ['JAK-UZYC.txt', jak],
] as const;

const FIELDS = ['WERSJA', 'DATA', 'SHA256', 'ROZMIAR', 'CSP'];
const MAX_LINE = 78;

/** Dyrektywy z tablicy `const CSP = [...]` w vite.config.ts, w kolejności. */
function cspFromConfig(src: string): string[] {
  const block = src.match(/const CSP = \[([\s\S]*?)\]\.join\('; '\);/)?.[1] ?? '';
  return [...block.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => (m[1] ?? m[2]).trim());
}
const CSP = cspFromConfig(webConfig);

/** Wiersze opisu dyrektyw w DLA-IOD-I-IT.txt: „    nazwa źródła   opis”. */
const describedCsp = (tpl: string) =>
  [...tpl.matchAll(/^ {4}([a-z]+-[a-z]+(?: [^ \n]+)+?) {2,}\S/gm)].map((m) => m[1]);

/** Wypełnienie jak w render-docs.mjs: {{CSP}} łamane po dyrektywach z wcięciem wiersza. */
function render(tpl: string): string {
  const csp = CSP.join('; ');
  const sample: Record<string, string> = {
    WERSJA: '10.100.1000',
    DATA: '2026-12-31',
    SHA256: 'f'.repeat(64),
    ROZMIAR: '9999999',
  };
  return tpl.replace(/^([ \t]*)(.*)$/gm, (line, indent: string) =>
    line.replace(/\{\{([A-Z0-9]+)\}\}/g, (_m, key: string) => {
      if (key !== 'CSP') return sample[key] ?? `{{${key}}}`;
      const lines: string[] = [];
      let cur = '';
      const parts = csp.split('; ');
      parts.forEach((p, i) => {
        const piece = p + (i < parts.length - 1 ? ';' : '');
        const next = cur ? `${cur} ${piece}` : piece;
        if (cur && indent.length + next.length > MAX_LINE) {
          lines.push(cur);
          cur = piece;
        } else cur = next;
      });
      lines.push(cur);
      return lines.join(`\n${indent}`);
    }),
  );
}

/** Napisy w „…” z jednego tekstu, z białymi znakami złożonymi do spacji (cytat łamie wiersz). */
const quoted = (s: string) => [...s.matchAll(/„([^”]+)”/g)].map((m) => m[1].replace(/\s+/g, ' '));

/** Nazwy, które nie są kontrolkami Parawana, tylko okien Worda i przeglądarki. */
const EXTERNAL_NAMES = new Set(['Znaczniki struktury dokumentu ułatwień dostępu']);

/** Tekst interfejsu: index.html bez komentarzy i znaczników, napisy z main.ts. */
const uiText = [
  webHtml
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' '),
  ...[...webMainRaw.matchAll(/'([^'\n]*)'/g)].map((m) => m[1]),
].join(' | ');

/** Nazwy dostępne składane z aria-labelledby, np. „Pobierz .docx” z podpisu grupy i przycisku. */
const composedNames = [...webHtml.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) =>
  m[1]
    .split(/\s+/)
    .map((id) => webHtml.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1].trim() ?? `?${id}`)
    .join(' '),
);

test('szablony mają wszystkie pola i tylko znane pola', () => {
  for (const [name, tpl] of DOCS) {
    for (const f of FIELDS) expect(tpl, `${name}: {{${f}}}`).toContain(`{{${f}}}`);
    for (const m of tpl.matchAll(/\{\{([^}]*)\}\}/g)) expect(FIELDS, name).toContain(m[1]);
    expect(render(tpl), name).not.toMatch(/\{\{|\}\}/);
  }
});

test('DLA-IOD-I-IT.txt opisuje każdą dyrektywę CSP z vite.config.ts i żadnej innej', () => {
  expect(CSP.length).toBeGreaterThanOrEqual(9);
  expect(describedCsp(dla)).toEqual(CSP);
  // każda dyrektywa cytowana gdzie indziej w tekstach (np. „connect-src 'none'”) jest w polityce
  for (const [name, tpl] of DOCS) {
    for (const m of tpl.matchAll(/\b([a-z]+-src|form-action|base-uri) ('[a-z-]+'|data:)/g)) {
      expect(CSP, `${name}: ${m[0]}`).toContain(m[0]);
    }
  }
});

test('klucze localStorage w DLA-IOD-I-IT.txt to dokładnie ALLOWED_KEYS', () => {
  const keys = [...dla.matchAll(/^ {4}([a-z][a-z-]*) {2,}\S/gm)].map((m) => m[1]);
  expect([...keys].sort()).toEqual([...ALLOWED_KEYS].sort());
  expect(dla).toContain('localStorage');
});

test('formaty w JAK-UZYC.txt równe atrybutowi accept pola wczytywania pliku', () => {
  const accept = webHtml.match(/id="file-input" type="file" accept="([^"]+)"/)?.[1];
  expect(accept).toBeTruthy();
  const lists = [...jak.matchAll(/\((\.[a-z0-9]+(?:,\s+\.[a-z0-9]+)+)\)/g)].map((m) =>
    m[1].split(/,\s+/),
  );
  expect(lists).toHaveLength(1);
  expect(lists[0]).toEqual(accept?.split(','));
});

test('przeglądarki w DLA-IOD-I-IT.txt równe build.target z vite.config.ts', () => {
  const list = webConfig.match(/\nconst BUILD_TARGET = \[([^\]]*)\];/)?.[1] ?? '';
  const target = Object.fromEntries(
    [...list.matchAll(/'([a-z]+)([\d.]+)'/g)].map((m) => [m[1], m[2]]),
  );
  expect(Object.keys(target).sort()).toEqual(['chrome', 'edge', 'firefox', 'safari']);
  expect(target.chrome).toBe(target.edge);
  const m = dla.match(
    /Edge i Chrome od wersji (\d+), Firefox od (\d+) \(także ESR\), Safari od ([\d.]+)\./,
  );
  expect(m).toBeTruthy();
  expect([m?.[1], m?.[2], m?.[3]]).toEqual([target.chrome, target.firefox, target.safari]);
  // tryb IE i Internet Explorer wymienione wprost, z prośbą o listę witryn
  expect(dla).toContain('Nie działa\n  w Internet Explorerze ani w trybie IE');
  expect(dla).toContain('Nie dodawaj pliku do listy witryn trybu Internet Explorera');
});

test('każda nazwa w „…” to kontrolka z apps/web/index.html albo opisane okno spoza Parawana', () => {
  for (const [name, tpl] of DOCS) {
    for (const q of quoted(tpl)) {
      const inUi = uiText.includes(q) || composedNames.includes(q) || EXTERNAL_NAMES.has(q);
      expect(inUi, `${name}: „${q}” nie występuje w interfejsie`).toBe(true);
    }
  }
  // przyciski, które JAK-UZYC.txt wymienia z nazwy, istnieją pod tą nazwą
  for (const b of ['Kopiuj', 'Pobierz .txt', 'Pobierz .docx', 'Drukuj lub zapisz PDF']) {
    expect(quoted(jak), b).toContain(b);
  }
  expect(composedNames).toEqual(expect.arrayContaining(['Pobierz .txt', 'Pobierz .docx']));
});

test('liczby z pomiaru w DLA-IOD-I-IT.txt zgodne z docs/BENCHMARK.md', () => {
  const sentences = benchmarkMd.match(/Zbiór ewaluacyjny:\*\* (\d+) syntetycznych zdań/)?.[1];
  const row = benchmarkMd.match(
    /\| T0\+T1 core \| ([\d.]+)% \((\d+)\/(\d+)\) \| ([\d.]+)% \((\d+)\/(\d+)\) \|/,
  );
  expect(sentences && row).toBeTruthy();
  const [, recall, hit, mustMask, precision, kept, mustKeep] = row ?? [];
  const flat = dla.replace(/\s+/g, ' ');
  expect(flat).toContain(`W pomiarze na ${sentences} wymyślonych zdaniach`);
  expect(flat).toContain(
    `zniknęło ${hit} z ${mustMask} fragmentów, które miały zniknąć (${recall.replace('.', ',')}%)`,
  );
  expect(flat).toContain(
    `zostało ${kept} z ${mustKeep}, które miały zostać (${precision.replace('.', ',')}%)`,
  );
});

test('ton i typografia: polskie cudzysłowy, bez wtrąceń myślnikami, „100%” i „my”', () => {
  for (const [name, tpl] of DOCS) {
    expect(tpl, name).not.toContain('"');
    // apostrof tylko w źródłach CSP ('none', 'unsafe-inline')
    expect(tpl.replace(/'[a-z-]+'/g, ''), name).not.toContain("'");
    expect(tpl, name).not.toMatch(/ [—–] /);
    expect(tpl, name).not.toContain('100%');
    expect(tpl, name).not.toMatch(/\b(w pełni|po prostu)\b/i);
    expect(tpl, name).not.toMatch(/(?<!\p{L})(my|nas|nam|nami|nasz\p{L}*)(?!\p{L})/iu);
    // otwarty cudzysłów zawsze domknięty
    expect((tpl.match(/„/g) ?? []).length, name).toBe((tpl.match(/”/g) ?? []).length);
  }
});

test('wiersze do 78 znaków, także po wypełnieniu; DLA-IOD-I-IT.txt na 3 strony A4', () => {
  for (const [name, tpl] of DOCS) {
    for (const text of [tpl, render(tpl)]) {
      for (const line of text.split('\n')) {
        expect([...line].length, `${name}: ${line}`).toBeLessThanOrEqual(MAX_LINE);
      }
    }
  }
  // 60 wierszy na stronę A4 w Notatniku przy domyślnej czcionce
  expect(render(dla).split('\n').length).toBeLessThanOrEqual(180);
});

test('JAK-UZYC.txt: notka „Dla działu IT” (sprawdza ją deploy-landing) i odesłanie do DLA-IOD', () => {
  expect(jak).toContain('Dla działu IT');
  expect(jak).toContain('DLA-IOD-I-IT.txt');
  expect(jak).toContain('Zanim opublikujesz pismo w BIP');
  expect(jak).toContain('Nagłówki i stopki');
});

test('pasek #boot-fail odsyła dział IT do DLA-IOD-I-IT.txt z adresem, skąd go wziąć', () => {
  // ze strony produktu pobiera się sam Parawan.html, więc pasek musi podać adres wydań
  const bar = webHtml.match(/<div id="boot-fail"[\s\S]*?<\/div>/)?.[0] ?? '';
  expect(bar).toContain('DLA-IOD-I-IT.txt na github.com/karolpolikarp/parawan/<wbr>releases.');
});

test('polecenia w DLA-IOD-I-IT.txt nie są łamane w środku', () => {
  const lines = dla.split('\n').map((l) => l.trim());
  expect(lines).toContain('gh attestation verify Parawan.html --repo karolpolikarp/parawan');
  expect(lines).toContain(
    'git clone -c core.autocrlf=false https://github.com/karolpolikarp/parawan',
  );
  expect(lines).toContain('cd parawan');
  // wiersz z poleceniem nie kończy się na samym poleceniu bez argumentów ani na opcji
  for (const l of lines.filter((x) => /^(gh|git|npm|certutil|Get-FileHash) /.test(x))) {
    expect(l, l).not.toMatch(/(verify Parawan\.html|autocrlf=false|\s--?[a-z]+)$/);
  }
});
