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

/* ── Pola z danymi: reguła dla każdego pola tekstowego ──
   Gwarancje z opisu dla IOD, których CSP nie obejmuje, bo usługi wywołuje przeglądarka, a nie
   strona. Bez autocomplete="off" przeglądarka zapisuje treść pola w plikach sesji i przywraca ją
   po „Wstecz” albo po restarcie: oryginał z PESEL-em zostaje na dysku. Chrome i Edge 109
   (ostatnie dla Windows 7 i 8.1) pomijają ten atrybut na samym <textarea> i słuchają go dopiero
   na formularzu, stąd <form autocomplete="off"> wokół pola (sprawdzone na profilach Chromium 109
   i 149, Edge 155 i Firefoksa ESR 115). Ten formularz nie może niczego wysłać: bez action,
   method, target i name. spellcheck="false" wyłącza sprawdzanie pisowni, które w rozszerzonej
   wersji Chrome i Edge wysyła tekst do serwera. translate="no" trzyma tekst użytkownika z dala
   od tłumacza przeglądarki (część wysyła go do sieci). Atrybut name to droga do autouzupełniania.
   Reguła obejmuje każde pole, także dopisane w kolejnych pakietach. */

// Znacznik otwierający z cudzysłowami w atrybutach (placeholder może zawierać „>”).
const TAG = `(?:[^>"']|"[^"]*"|'[^']*')*>`;
// Typy <input>, w które się pisze tekst; bez atrybutu type to też pole tekstowe.
const TEXT_TYPES = new Set(['text', 'search', 'email', 'tel', 'url', 'password', 'number']);

/**
 * Wartość atrybutu albo null, gdy go nie ma (bez parsera DOM, którego vitest nie ma). Atrybuty
 * czytane po kolei wyrażeniem z flagą y, więc słowo „name” w treści placeholdera nie jest atrybutem.
 */
function attrOf(tag: string, name: string): string | null {
  const re = /\s+([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/y;
  re.lastIndex = tag.match(/^<[^\s/>]+/)?.[0].length ?? 0;
  for (let a = re.exec(tag); a; a = re.exec(tag)) {
    if (a[1].toLowerCase() === name) return a[2] ?? a[3] ?? a[4] ?? '';
  }
  return null;
}

/** Pola tekstowe dokumentu: każdy <textarea> i każdy <input> tekstowy, z miejscem w pliku. */
function textFields(html: string): { tag: string; at: number }[] {
  const out: { tag: string; at: number }[] = [];
  for (const m of html.matchAll(new RegExp(String.raw`<(textarea|input)\b${TAG}`, 'gi'))) {
    const type = (attrOf(m[0], 'type') ?? 'text').toLowerCase();
    if (m[1].toLowerCase() === 'textarea' || TEXT_TYPES.has(type)) out.push({ tag: m[0], at: m.index });
  }
  return out;
}

/** Formularz, w którym stoi pole na pozycji `at` (znacznik otwierający), albo null. */
function formAround(html: string, at: number): string | null {
  for (const m of html.matchAll(new RegExp(String.raw`<form\b${TAG}[\s\S]*?(?:</form>|$)`, 'gi'))) {
    if (at > m.index && at < m.index + m[0].length) {
      return m[0].match(new RegExp(String.raw`^<form\b${TAG}`, 'i'))?.[0] ?? null;
    }
  }
  return null;
}

/** Naruszenia reguły pól w dokumencie (pusta lista = w porządku). */
function fieldProblems(html: string): string[] {
  const problems: string[] = [];
  for (const { tag, at } of textFields(html)) {
    const label = tag.replace(/\s+/g, ' ').slice(0, 60);
    if (attrOf(tag, 'autocomplete') !== 'off') problems.push(`${label}: brak autocomplete="off"`);
    if (attrOf(tag, 'spellcheck') !== 'false') problems.push(`${label}: brak spellcheck="false"`);
    if (attrOf(tag, 'translate') !== 'no') problems.push(`${label}: brak translate="no"`);
    if (attrOf(tag, 'name') !== null) problems.push(`${label}: ma atrybut name`);
    const form = formAround(html, at);
    if (!form) problems.push(`${label}: nie stoi w <form autocomplete="off">`);
    else {
      if (attrOf(form, 'autocomplete') !== 'off') problems.push(`${label}: formularz bez autocomplete="off"`);
      for (const a of ['action', 'method', 'target', 'name']) {
        if (attrOf(form, a) !== null) problems.push(`${label}: formularz z atrybutem ${a}`);
      }
    }
  }
  return problems;
}

// Bez komentarzy: te przy formularzu cytują „<textarea>” i „<form>”.
const noComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '');
const PAGES = [
  ['aplikacja', noComments(webHtml)],
  ['landing', noComments(landingHtml)],
] as const;

test.each(PAGES)('%s: każde pole tekstowe bez autouzupełniania, sprawdzania pisowni i tłumaczenia', (_name, html) => {
  expect(html.length).toBeGreaterThan(1000);
  expect(textFields(html).length).toBeGreaterThan(0);
  expect(fieldProblems(html)).toEqual([]);
  // tłumaczenie interfejsu zostaje dostępne
  expect(html).not.toMatch(/<html[^>]*translate="no"/);
});

// Strażnik strażnika: usunięcie dowolnego z atrybutów w dowolnym polu musi wywrócić regułę.
test.each(PAGES)('%s: reguła pól pada po usunięciu atrybutu z dowolnego pola', (_name, html) => {
  for (const { tag, at } of textFields(html)) {
    for (const attr of ['autocomplete="off"', 'spellcheck="false"', 'translate="no"']) {
      expect(tag).toContain(attr);
      const broken = html.replace(tag, tag.replace(attr, ''));
      expect(fieldProblems(broken), `${tag} bez ${attr}`).not.toEqual([]);
    }
    expect(fieldProblems(html.replace(tag, tag.replace(/^<(\w+)/, '<$1 name="tresc"')))).not.toEqual([]);
    // formularz: bez autocomplete="off", z adresem wysyłki albo bez formularza
    const form = formAround(html, at) ?? '';
    expect(form).toContain('autocomplete="off"');
    expect(fieldProblems(html.replace(form, form.replace('autocomplete="off"', '')))).not.toEqual([]);
    expect(fieldProblems(html.replace(form, form.replace('<form', '<form action="https://example.com/"')))).not.toEqual([]);
    expect(fieldProblems(html.replace(form, '<div>'))).not.toEqual([]);
  }
  // nowe pole bez atrybutów i bez formularza też jest wyłapane, z typem i bez
  const extra = '<input id="nowe" type="search"><input id="nowe2"><textarea id="nowe3"></textarea>';
  expect(fieldProblems(html.replace('</body>', `${extra}</body>`))).toHaveLength(12);
  // pole wyboru pliku i checkbox nie są polami tekstowymi
  expect(fieldProblems('<input type="file" id="f"><input type="checkbox" id="c">')).toEqual([]);
});

/**
 * Elementy, w których pokazuje się oryginał albo wynik. Nowy pasek albo podgląd z treścią pisma
 * dopisuje się tutaj (i dostaje translate="no").
 */
const CONTENT_VIEWS = {
  // fix-bar, fix-form i fix-foot (A09) pokazują oryginał spod znacznika i listę poprawek
  aplikacja: ['input', 'output', 'print-out', 'fix-bar', 'fix-form', 'fix-foot'],
  landing: ['demo-input', 'demo-output'],
} as const;

test.each(PAGES)('%s: oryginał i wynik bez tłumacza przeglądarki', (name, html) => {
  for (const id of CONTENT_VIEWS[name]) expect(tagOf(html, id), id).toContain('translate="no"');
  expect(tagOf(html, CONTENT_VIEWS[name][0]).startsWith('<textarea')).toBe(true);
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
test('aplikacja: przy druku widać tylko #print-out i dołączoną adnotację', () => {
  expect(webCss.length).toBeGreaterThan(10_000);
  const print = webCss.match(/@media print \{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(print).toMatch(/^\s*body > :not\(#print-out\):not\(#print-annex\) \{ display: none !important; \}/m);
  expect(print).toMatch(/\.print-out \{[^}]*display: block;[^}]*white-space: pre-wrap;/);
  // adnotacja od nowej strony i tylko wtedy, gdy ją dołączono (pusty kontener nie dokłada strony)
  expect(print).toMatch(
    /\.print-annex:not\(:empty\) \{[^}]*display: block;[^}]*break-before: page;[^}]*white-space: pre-wrap;/,
  );
  // poza drukiem kontenery są niewidoczne, także dla czytnika ekranu i Ctrl+F
  expect(webCss).toMatch(/^\.print-out \{ display: none; \}$/m);
  expect(webCss).toMatch(/^\.print-annex \{ display: none; \}$/m);
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
  const annex = print.match(/\.print-annex:not\(:empty\) \{([^}]*)\}/)?.[1] ?? '';
  expect(annex).toContain('font: 11pt/1.45 Arial, sans-serif;');
  expect(print).not.toMatch(/Archivo|var\(--sans\)|var\(--mono\)|font-family/);
});

test('aplikacja: #print-out i #print-annex to dzieci <body> poza .grid, bez tłumacza', () => {
  const gridStart = webHtml.indexOf('<div class="grid">');
  expect(gridStart).toBeGreaterThan(0);
  const gridEnd = divEnd(webHtml, gridStart);
  const tag = tagOf(webHtml, 'print-out');
  const at = webHtml.indexOf(tag);
  expect(at).toBeGreaterThan(gridEnd);
  // między końcem .grid a kontenerem tylko odstępy i komentarze, więc to dziecko <body>
  expect(webHtml.slice(gridEnd, at).replace(/<!--[\s\S]*?-->/g, '').trim()).toBe('');
  expect(tag).toBe('<div id="print-out" class="print-out" lang="pl" translate="no">');
  // adnotacja tuż za wynikiem, też dziecko <body>
  const annexTag = tagOf(webHtml, 'print-annex');
  const annexAt = webHtml.indexOf(annexTag);
  const between = webHtml.slice(at + tag.length, annexAt).replace(/<!--[\s\S]*?-->/g, '').trim();
  expect(between).toBe('</div>');
  expect(webHtml.indexOf('</body>')).toBeGreaterThan(annexAt);
  expect(annexTag).toBe('<div id="print-annex" class="print-annex" lang="pl" translate="no">');
});

test('aplikacja: #print-out i #print-annex dostają tekst wyłącznie przez textContent', () => {
  for (const [id, field] of [
    ['print-out', 'main'],
    ['print-annex', 'annex'],
  ]) {
    const v = webMain.match(new RegExp(`const (\\w+) = \\$<\\w+>\\('${id}'\\);`))?.[1] ?? '';
    expect(v, id).not.toBe('');
    // jedyny uchwyt do kontenera i jedyne przypisanie: textContent z printContent()
    expect(webMain.match(new RegExp(`['"]#?${id}['"]`, 'g')), id).toHaveLength(1);
    // każde przypisanie, także złożone (+=, ??= …), i każde wywołanie metody na kontenerze
    const assign = '(?:[-+*/%&|^]|\\*\\*|<<|>>>?|&&|\\|\\||\\?\\?)?=(?!=)';
    const writes = [...webMain.matchAll(new RegExp(`\\b${v}\\.(\\w+)\\s*(?:${assign}|\\()`, 'g'))];
    expect(writes.map((m) => m[1]), id).toEqual(['textContent']);
    // Uchwyt pada tylko w deklaracji i w tym jednym przypisaniu, więc ani alias
    // (const el = printOut), ani zapis przez nawias (printOut['innerHTML']) nie przejdą bokiem.
    expect(webMain.match(new RegExp(`\\b${v}\\b`, 'g')), id).toHaveLength(2);
    expect(webMain).not.toMatch(
      new RegExp(`\\b${v}\\s*(?:\\.|\\[)\\s*['"\`]?(?:innerHTML|outerHTML|insertAdjacentHTML)`),
    );
    const value = webMain.match(new RegExp(`\\b${v}\\.textContent = ([^;]+);`))?.[1] ?? '';
    expect(value, id).toBe(`print.${field}`);
  }
  expect(webMain).toContain('const print = printContent();');
  // printContent: wynik z finalText (output.ts), dołączona adnotacja, komunikat albo protokół
  // z metadanych (publikacja.ts); pole źródła ani przekreślone oryginały żadną drogą
  const body = webMain.match(/function printContent\(\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  expect(body).toContain("if (printMode === 'protocol') return { main: printProtocol, annex: '' };");
  expect(body).toContain("if (!lastRedacted) return { main: PRINT_EMPTY, annex: '' };");
  expect(body).toContain('return { main: resultText(), annex: annexText() };');
  expect(body).not.toMatch(/input|orig|innerHTML/);
  // wynik po ręcznych poprawkach (A09): finalText nakłada decyzje na zakresy
  expect(webMain).toMatch(
    /const resultText = \(\): string =>\s+finalText\(\{ redacted: lastRedacted, original: lastInput, spans: lastSpans, decisions \}\);/,
  );
  expect(webMain).toMatch(/function annexText\(\): string \{\n {2}return pubAppend\.checked && lastRedacted \? pubAnn\.value\.trim\(\) : '';\n\}/);
  // protokół do druku powstaje tylko z buildProtocol
  expect(webMain.match(/^\s*printProtocol = /gm)).toHaveLength(1);
  expect(webMain).toContain('printProtocol = await protocolNow();');
  expect(webMain).toMatch(/async function protocolNow\(\): Promise<string> \{[\s\S]*?return buildProtocol\(\{/);
  // żaden inny moduł aplikacji nie sięga po kontenery
  for (const [file, src] of appModules) {
    if (file !== './main.ts') expect(src, file).not.toMatch(/print-out|print-annex/);
  }
});

test('moduły aplikacji nie importują modułów Node (node-fs.d.ts jest tylko dla testów)', () => {
  expect(appModules.length).toBeGreaterThan(5);
  for (const [file, src] of appModules) expect(src, file).not.toMatch(/from ['"]node:/);
});
