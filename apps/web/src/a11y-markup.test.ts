import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import webHtml from '../index.html?raw';
import webMain from './main.ts?raw';

// Wygląd dymków i wskaźnika fokusu (style.css) sprawdzamy w przeglądarce: vitest podaje
// pliki CSS jako puste. Tu pilnujemy znaczników HTML, od których zależą czytniki ekranu.

test('aplikacja: semantyka strony', () => {
  expect(webHtml).toMatch(/<main class="grid-main">/);
  // kroki to nie regiony; nazwy wyniku nie dublujemy (ma ją pole #output)
  expect(webHtml).not.toContain('aria-label="Krok');
  expect(webHtml).not.toContain('aria-label="Wynik zanonimizowany"');
  // licznik ‹ › nie dubluje ogłoszenia z #mask-status
  expect(webHtml).not.toMatch(/id="mask-count"[^>]*aria-live/);
  // „▸”, opis i pomoc „?” nie wchodzą do nazwy rozwijanych sekcji
  const sections = webHtml.match(/<details class="card g12"/g)?.length ?? 0;
  expect(sections).toBe(3); // „Adnotacja i protokół”, „Co maskować”, „Co wykrywa”
  expect(webHtml.match(/<span class="chev" aria-hidden="true">/g)).toHaveLength(sections);
  expect(webHtml.match(/<summary class="card-h" aria-labelledby="/g)).toHaveLength(sections);
});

test('landing: tabele, nagłówki i statystyki demo dla czytnika ekranu', () => {
  expect(landingHtml).toMatch(/id="demo-stat" role="status"/);
  // po h2 sekcji stopka miała h4 (przeskok poziomu)
  expect(landingHtml).not.toMatch(/<h4/);
  // tabela przykładu zostaje tabelą na każdej szerokości: podpis i nagłówki wierszy
  const zostalo = landingHtml.match(/<table class="zostalo">[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(zostalo).toMatch(/<caption>[^<]+<\/caption>/);
  expect(zostalo.match(/<th scope="row">/g)).toHaveLength(3);
  // Tabele kategorii i miar zmieniają display na wąskim ekranie, a Safari z VoiceOverem gubi
  // wtedy semantykę tabeli: jawne role ją trzymają.
  const kategorie = landingHtml.match(/<table class="kategorie" role="table">[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(kategorie.match(/role="rowheader"/g)).toHaveLength(5);
  const miary = landingHtml.match(/<table class="miary" role="table">[\s\S]*?<\/table>/)?.[0] ?? '';
  expect(miary.match(/<th scope="row" role="rowheader">/g)).toHaveLength(3);
  expect(miary.match(/<td class="m-val" role="cell">/g)).toHaveLength(3);
  for (const t of [kategorie, miary]) {
    expect(t).toContain('<tbody role="rowgroup">');
    const rows = t.match(/<tr\b[^>]*>/g) ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const tr of rows) expect(tr).toBe('<tr role="row">');
  }
  // metody rozpoznawania mają nagłówki, więc czytnik ekranu przeskakuje między nimi
  const typy = landingHtml.match(/<section class="dok" id="typy">[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(typy.match(/<div class="metoda">\s*<div class="m-opis">\s*<h3>/g)).toHaveLength(4);
  // wynik demo przyjmuje fokus: klik w niego i Ctrl+A zaznacza sam wynik, nie całą stronę
  expect(landingHtml).toMatch(/id="demo-output"[^>]*tabindex="0"/);
});

/**
 * Formularze bez nazwy dostępnej, które nie mają roli none (presentation). Formularz wokół pola
 * źródła jest tylko dla autocomplete="off" (markup.test.ts), a nowe Chrome i Edge pokazywały go
 * czytnikowi ekranu jako nienazwany punkt orientacyjny „formularz”. Rola nie psuje celu
 * formularza: z role="none" Chromium 109 dalej nie zapisuje treści pola w plikach sesji, a kopia
 * pliku bez autocomplete="off" zapisuje (scripts/e2e/manual/sesja-przegladarki.mjs). Drzewo
 * dostępności samej przeglądarki sprawdza smoke.test.mjs.
 */
function unnamedForms(html: string): string[] {
  const forms = html.replace(/<!--[\s\S]*?-->/g, '').match(/<form\b[^>]*>/g) ?? [];
  return forms.filter(
    (f) => !/\saria-label(?:ledby)?="[^"]+"/.test(f) && !/\srole="(?:none|presentation)"/.test(f),
  );
}

test.each([
  ['aplikacja', webHtml],
  ['landing', landingHtml],
])('%s: formularz wokół pola nie jest nienazwanym punktem orientacyjnym', (_name, html) => {
  const forms = html.replace(/<!--[\s\S]*?-->/g, '').match(/<form\b[^>]*>/g) ?? [];
  expect(forms.length).toBeGreaterThan(0);
  expect(unnamedForms(html)).toEqual([]);
  // strażnik strażnika: ten sam formularz bez roli zostałby wyłapany
  const stripped = html.replace(/(<form\b[^>]*?) role="none"/g, '$1');
  expect(unnamedForms(stripped).length).toBe(forms.length);
});

/* ── Kolejność, nagłówki i animacja po przebudowie pierwszego ekranu (A06) ── */

// style.css czytany z dysku: import ?raw daje w vitest pusty napis.
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/**
 * Reguły z właściwością order (bez komentarzy). Kolejność na ekranie ma być kolejnością w kodzie,
 * bo w niej idzie fokus i czytnik ekranu (WCAG 1.3.2, 2.4.3). Dwa zastane wyjątki przestawiają
 * elementy w obrębie jednego wiersza, a nie sekcje strony: opis typu w wierszu tabeli „Co wykrywa”
 * pod nazwą i znacznikiem (wąski ekran) i licznik „Zamaskowano” pod tytułem karty (telefon).
 */
function cssOrderRules(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...code.matchAll(/([^{};]+)\{[^{}]*?(?:^|[\s;{])order\s*:[^{}]*\}/gm)].map((m) => m[1].trim());
}
const ORDER_OK = ['#co-wykrywa td:nth-child(3)', '.stats .stat-total'];

test('aplikacja: kolejność sekcji bez CSS order (style.css z dysku)', () => {
  expect(css.length).toBeGreaterThan(1000);
  expect(cssOrderRules(css).filter((sel) => !ORDER_OK.includes(sel))).toEqual([]);
  // strażnik strażnika: order dopisany do sekcji zostałby wyłapany
  expect(cssOrderRules(`${css}\n.how { order: -1; }`)).toContain('.how');
  expect(cssOrderRules('.x { border-order: 1; }\n.y { min-order: 2 }')).toEqual([]);
});

test('aplikacja: nagłówki h1–h6 bez przeskoków, jeden h1', () => {
  const html = webHtml.replace(/<!--[\s\S]*?-->/g, '');
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  expect(levels[0]).toBe(1);
  expect(levels.filter((l) => l === 1)).toHaveLength(1);
  for (let i = 1; i < levels.length; i++) expect(levels[i], `nagłówek nr ${i + 1}`).toBeLessThanOrEqual(levels[i - 1] + 1);
  // sekcja „Jak to działa” ma h2, a kroki i demo h3 pod nim
  expect(html).toContain('<h2 id="jak-h">Jak to działa</h2>');
  expect(html.match(/<h3 class="step-t">/g)).toHaveLength(4);
  expect(html).toMatch(/<section class="card demo g12" aria-labelledby="demo-h">\s*<div class="demo-head-row">\s*<h3 id="demo-h">/);
});

test('aplikacja: animację kroków i demo dalej da się zatrzymać (WCAG 2.2.2)', () => {
  const how = webHtml.match(/<section class="how g12" id="jak-to-dziala"[\s\S]*<\/section>\s*\n\s*<!-- ═+ STOPKA/)?.[0] ?? '';
  expect(how).not.toBe('');
  // przycisk stoi w sekcji przed krokami i demo, więc klawiatura trafia na niego pierwsza
  const btn = how.indexOf('<button type="button" id="demo-motion" class="btn btn-sm demo-motion">');
  expect(btn).toBeGreaterThan(-1);
  expect(btn).toBeLessThan(how.indexOf('class="card step g3"'));
  expect(btn).toBeLessThan(how.indexOf('class="demo-stage"'));
  // przycisk wyłącza oba ruchy, a wybór zostaje zapamiętany
  expect(css).toMatch(/:root\[data-motion="off"\] \.step \{ animation: none; \}/);
  expect(css).toMatch(/:root\[data-motion="off"\] \.demo-in \{ animation: none;/);
  expect(css).toMatch(/:root\[data-motion="off"\] \.demo-out \{ animation: none;/);
  expect(css).toMatch(/:root\[data-motion="off"\] \.demo-badge \{ animation: none; \}/);
  expect(webMain).toContain("document.documentElement.dataset.motion = 'off'");
  expect(webMain).toContain("storageSet('motion'");
  // kroki świecą po kolei dzięki nth-of-type: przed nimi w sekcji nie może stać inna <section>
  const beforeSteps = how.slice(how.indexOf('>') + 1, how.indexOf('<section class="card step g3"'));
  expect(beforeSteps).not.toContain('<section');
});
