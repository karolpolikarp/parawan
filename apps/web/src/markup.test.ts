import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import webHtml from '../index.html?raw';
import webMain from './main.ts?raw';

// import „style.css?raw” daje w vitest pusty napis, a asercja not.toContain przeszłaby na nim
// zawsze. Arkusz czytamy więc z dysku i każdy test CSS zaczyna od sprawdzenia, że nie jest pusty.
const webCss = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

// Moduły aplikacji (bez testów i deklaracji) jako tekst, do sprawdzeń „nikt poza main.ts…”.
const appModules = Object.entries(
  import.meta.glob<string>(['./*.ts', '!./*.test.ts', '!./*.d.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
);

/** Atrybuty otwierającego znacznika elementu o danym id (bez parsera DOM, którego vitest nie ma). */
function tagOf(html: string, id: string): string {
  const m = html.match(new RegExp(`<[a-z]+\\s[^>]*\\bid="${id}"[^>]*>`));
  if (!m) throw new Error(`brak elementu #${id}`);
  return m[0];
}

// Bez autocomplete="off" przeglądarka zapisuje treść pola w plikach sesji i przywraca ją
// po „Wstecz” albo po restarcie: oryginał z PESEL-em zostaje na dysku.
// translate="no" trzyma tekst użytkownika z dala od tłumacza przeglądarki (część wysyła go do sieci).
test.each([
  ['aplikacja', webHtml, 'input', 'output'],
  ['landing', landingHtml, 'demo-input', 'demo-output'],
])('%s: pole z tekstem i wynik bez autouzupełniania i tłumaczenia', (_name, html, field, out) => {
  const ta = tagOf(html, field);
  expect(ta.startsWith('<textarea')).toBe(true);
  expect(ta).toContain('autocomplete="off"');
  expect(ta).toContain('translate="no"');
  expect(tagOf(html, out)).toContain('translate="no"');
  // tłumaczenie interfejsu zostaje dostępne
  expect(html).not.toMatch(/<html[^>]*translate="no"/);
});

/** Indeks tuż za znacznikiem zamykającym <div>, który zaczyna się w `start` (liczy zagnieżdżenia). */
function divEnd(html: string, start: number): number {
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  throw new Error('niezamknięty <div>');
}

test('arkusz aplikacji przeczytany z dysku (nie pusty napis z ?raw)', () => {
  expect(webCss.length).toBeGreaterThan(10_000);
  expect(webCss).toContain('.card {');
});

// Bez arkusza druku Ctrl+P wysyłał na papier całą aplikację z polem źródła, w „Porównaniu” także
// przekreślone oryginały, a z wyniku tylko okienko (19 ze 121 wierszy).
test('aplikacja: przy druku widać tylko #print-out', () => {
  expect(webCss.length).toBeGreaterThan(10_000);
  const print = webCss.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(print).toMatch(/^\s*body > :not\(#print-out\) \{ display: none !important; \}/m);
  expect(print).toMatch(/\.print-out \{[^}]*display: block;[^}]*white-space: pre-wrap;/);
  // poza drukiem kontener jest niewidoczny, także dla czytnika ekranu i Ctrl+F
  expect(webCss).toMatch(/^\.print-out \{ display: none; \}$/m);
  expect(webCss).toMatch(/^@page \{ size: A4; margin: 18mm 16mm; \}$/m);
  // margin: 0 chowa nagłówki, ale zabiera marginesy każdej strony wydruku
  expect(webCss).not.toMatch(/@page[^{]*\{[^}]*margin:\s*0\s*[;}]/);
});

// Z wbudowanego, zmiennego Archivo „Zapisz jako PDF” robił PDF bez warstwy tekstu (Firefox
// 115–156) albo z \x00 zamiast ó, ś, ć, ń, ź (Chromium 109–125). Wydruk ma font systemowy.
test('aplikacja: wydruk fontem systemowym, nie wbudowanym Archivo', () => {
  expect(webCss.length).toBeGreaterThan(10_000);
  // bez komentarzy, które o Archivo wspominają
  const print = (webCss.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rule = print.match(/\.print-out \{([^}]*)\}/)?.[1] ?? '';
  expect(rule).toContain('font: 11pt/1.45 Arial, sans-serif;');
  expect(print).not.toMatch(/Archivo|var\(--sans\)|var\(--mono\)|font-family/);
});

test('aplikacja: #print-out to dziecko <body> poza .grid, bez tłumacza', () => {
  const gridStart = webHtml.indexOf('<div class="grid">');
  expect(gridStart).toBeGreaterThan(0);
  const gridEnd = divEnd(webHtml, gridStart);
  const tag = tagOf(webHtml, 'print-out');
  const at = webHtml.indexOf(tag);
  expect(at).toBeGreaterThan(gridEnd);
  // między końcem .grid a kontenerem tylko odstępy i komentarze, więc to dziecko <body>
  expect(webHtml.slice(gridEnd, at).replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
  expect(webHtml.indexOf('</body>')).toBeGreaterThan(at);
  expect(tag).toBe('<div id="print-out" class="print-out" lang="pl" translate="no">');
});

test('aplikacja: #print-out dostaje tekst wyniku wyłącznie przez textContent', () => {
  const v = webMain.match(/const (\w+) = \$<\w+>\('print-out'\);/)?.[1] ?? '';
  expect(v).not.toBe('');
  // jedyny uchwyt do kontenera i jedyne przypisanie: textContent z wyniku albo komunikat
  expect(webMain.match(/['"]#?print-out['"]/g)).toHaveLength(1);
  // każde przypisanie, także złożone (+=, ??= …), i każde wywołanie metody na kontenerze
  const assign = '(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?!=)';
  const writes = [...webMain.matchAll(new RegExp(`\\b${v}\\.(\\w+)\\s*(?:${assign}|\\()`, 'g'))];
  expect(writes.map((m) => m[1])).toEqual(['textContent']);
  // Uchwyt pada tylko w deklaracji i w tym jednym przypisaniu, więc ani alias
  // (const el = printOut), ani zapis przez nawias (printOut['innerHTML']) nie przejdą bokiem.
  expect(webMain.match(new RegExp(`\\b${v}\\b`, 'g'))).toHaveLength(2);
  expect(webMain).not.toMatch(
    new RegExp(`\\b${v}\\s*(?:\\.|\\[)\\s*['"\`]?(?:innerHTML|outerHTML|insertAdjacentHTML)`),
  );
  const value = webMain.match(new RegExp(`\\b${v}\\.textContent = ([^;]+);`))?.[1] ?? '';
  expect(value).toBe('lastRedacted ? outputText() : PRINT_EMPTY');
  expect(webMain).toContain('const outputText = (): string => finalText({ redacted: lastRedacted });');
  // pole źródła ani przekreślone oryginały nie trafiają tam żadną drogą
  expect(value).not.toMatch(/input|orig|innerHTML/);
  // żaden inny moduł aplikacji nie sięga po kontener
  for (const [file, src] of appModules) {
    if (file !== './main.ts') expect(src, file).not.toContain('print-out');
  }
});

test('moduły aplikacji nie importują modułów Node (node-fs.d.ts jest tylko dla testów)', () => {
  expect(appModules.length).toBeGreaterThan(5);
  for (const [file, src] of appModules) expect(src, file).not.toMatch(/from ['"]node:/);
});
