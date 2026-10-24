import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import changelogMd from '../../../CHANGELOG.md?raw';
import {
  adresLinku,
  dataPoPolsku,
  escapeHtml,
  inline,
  kotwicaWersji,
  mdNaHtml,
  planZRoadmapy,
  porownajWersje,
  REPO_BLOB,
  twardeSpacje,
  wersjeZChangelogu,
} from '../../landing/src/changelog-html';
import { stronaLogu, ZWIJAJ_PRZED } from '../../landing/src/log-strona';

// Podstrona /log/ landingu (zmiany i plan) powstaje przy buildzie z CHANGELOG.md i ROADMAP.md
// małym konwerterem Markdowna (apps/landing/src/changelog-html.ts). Tu: ucieczka znaków, linki,
// listy, kotwice wersji i złożona strona na prawdziwym CHANGELOG.md.

// ROADMAP.md może jeszcze nie istnieć: wtedy strona ma powstać bez planu (test niżej)
const roadmapMd = (() => {
  try {
    return readFileSync(new URL('../../../ROADMAP.md', import.meta.url), 'utf8');
  } catch {
    return null;
  }
})();

const strona = (roadmap: string | null = roadmapMd) =>
  stronaLogu({
    changelog: changelogMd,
    roadmap,
    style: 'body{}',
    styleLogu: '.log{}',
    csp: "default-src 'none'; script-src 'none'",
    ikona: '<link rel="icon" href="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" />',
  });

/** Tekst poza <code> i <pre>, bez znaczników. */
const pozaKodem = (html: string) =>
  html.replace(/<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>/g, ' ').replace(/<[^>]+>/g, ' ');

test('log: znaki HTML z treści zawsze po ucieczce, także w kodzie i adresie', () => {
  expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
    '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
  );
  expect(inline('tekst <script>alert(1)</script>')).toBe(
    'tekst &lt;script&gt;alert(1)&lt;/script&gt;',
  );
  expect(inline('`<w:cr/>` i <img onerror=x>')).toBe(
    '<code>&lt;w:cr/&gt;</code> i &lt;img onerror=x&gt;',
  );
  expect(mdNaHtml('## <b>Nagłówek</b>')).toBe('<h2>&lt;b&gt;Nagłówek&lt;/b&gt;</h2>');
  // cudzysłów w adresie nie wychodzi z atrybutu href
  expect(inline('[x](https://e.example/"onmouseover="a)')).toContain(
    'href="https://e.example/&quot;onmouseover=&quot;a"',
  );
  // adres javascript: nie dostaje się do href jako taki (staje się ścieżką w repozytorium)
  expect(adresLinku('javascript:alert(1)')).toBe(`${REPO_BLOB}javascript:alert(1)`);
});

test('log: pogrubienie, kod i linki', () => {
  expect(inline('**CLI: tryb `--jsonl`.** dalej')).toBe(
    '<strong>CLI: tryb <code>--jsonl</code>.</strong> dalej',
  );
  // gwiazdki w kodzie to treść, nie pogrubienie
  expect(inline('`**Nr KSeF:**` i **ok**')).toBe('<code>**Nr KSeF:**</code> i <strong>ok</strong>');
  // zewnętrzny link w nowej karcie, bez dostępu do okna strony
  expect(inline('[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai)')).toBe(
    '<a href="https://github.com/karolpolikarp/anonimizator-ai" target="_blank" rel="noopener noreferrer">anonimizator-ai</a>',
  );
  // względny odnośnik z pliku prowadzi do pliku w repozytorium na GitHubie
  expect(inline('[`docs/AI.md`](./docs/AI.md)')).toBe(
    `<a href="${REPO_BLOB}docs/AI.md" target="_blank" rel="noopener noreferrer"><code>docs/AI.md</code></a>`,
  );
  expect(REPO_BLOB).toBe('https://github.com/karolpolikarp/parawan/blob/main/');
  // kotwica na tej samej stronie bez nowej karty
  expect(inline('[v0.46.25](#v0-46-25)')).toBe('<a href="#v0-46-25">v0.46.25</a>');
  // niedomknięte znaczniki zostają tekstem
  expect(inline('**bez końca i `bez końca')).toBe('**bez końca i `bez końca');
});

test('log: listy ciasne, zagnieżdżone i numerowane', () => {
  const md = [
    '- **A.** pierwsza',
    '  linia dalej',
    '  - zagnieżdżona',
    '    ciąg',
    '- druga',
    '',
    'Akapit.',
  ].join('\n');
  expect(mdNaHtml(md)).toBe(
    '<ul><li><strong>A.</strong> pierwsza linia dalej<ul><li>zagnieżdżona ciąg</li></ul></li><li>druga</li></ul><p>Akapit.</p>',
  );
  // lista numerowana od innego numeru niż 1 zachowuje numerację
  expect(mdNaHtml('10. dziesiąta\n11. jedenasta')).toBe(
    '<ol start="10"><li>dziesiąta</li><li>jedenasta</li></ol>',
  );
  // pozycja planu: tytuł, wersja z rozmiarem i opis w osobnych blokach, lista luźna
  const plan = [
    '1. **Tytuł pozycji**',
    '   v0.46.26 / rdzeń 0.29.14 · M',
    '   Opis pozycji.',
    '',
    '2. **Druga**',
    '   v0.47.0 · S',
  ].join('\n');
  expect(mdNaHtml(plan)).toBe(
    '<ol><li><p class="poz-tytul"><strong>Tytuł pozycji</strong></p><p class="poz-meta">v0.46.26 / rdzeń 0.29.14 · M</p><p>Opis pozycji.</p></li>' +
      '<li><p class="poz-tytul"><strong>Druga</strong></p><p class="poz-meta">v0.47.0 · S</p></li></ol>',
  );
  // tytuł pogrubiony na dwie linie
  expect(mdNaHtml('10. **Długi\n    tytuł**\n    v0.47.0 · L')).toContain(
    '<p class="poz-tytul"><strong>Długi tytuł</strong></p>',
  );
});

test('log: nagłówki, akapity specjalne i bloki kodu', () => {
  expect(mdNaHtml('**Cały akapit pogrubiony.**')).toBe(
    '<p class="wiodacy"><strong>Cały akapit pogrubiony.</strong></p>',
  );
  expect(mdNaHtml('Pilność: zalecana')).toBe(
    '<p class="pilnosc"><span>Pilność</span> zalecana</p>',
  );
  expect(mdNaHtml('```\n<b>&\n```')).toBe('<pre><code>&lt;b&gt;&amp;</code></pre>');
  // definicje odnośników (spis porównań na końcu CHANGELOG.md) nie trafiają na stronę
  expect(
    mdNaHtml('- ostatni punkt\n\n[Unreleased]: https://github.com/a/b/compare/v1...HEAD\n[v0.1.0]: https://github.com/a/b/releases/tag/v0.1.0'),
  ).toBe('<ul><li>ostatni punkt</li></ul>');
  // przesunięcie poziomu i niepowtarzalne id tylko dla „##”
  const ids = new Set<string>();
  expect(
    mdNaHtml('## Teraz\n### Z repozytorium\n## Teraz', { przesuniecie: 1, idNaglowkow: ids }),
  ).toBe('<h3 id="teraz">Teraz</h3><h4>Z repozytorium</h4><h3 id="teraz-2">Teraz</h3>');
  expect(planZRoadmapy('# Roadmapa\n\nWstęp.\n\n## Świadomie poza roadmapą\n\n- x').spis).toEqual([
    ['swiadomie-poza-roadmapa', 'Świadomie poza roadmapą'],
  ]);
});

test('log: twarde spacje po jednoliterowych słowach, poza kodem', () => {
  expect(twardeSpacje('<p>plik w repozytorium i w <code>a b</code></p>')).toBe(
    '<p>plik w\u00a0repozytorium i\u00a0w\u00a0<code>a b</code></p>',
  );
  expect(dataPoPolsku('2026-10-24')).toBe('24\u00a0października 2026');
});

test('log: wersje z CHANGELOG.md, od najnowszej, z kotwicami', () => {
  expect(kotwicaWersji('0.46.25')).toBe('v0-46-25');
  expect(porownajWersje('0.9.1', '0.46.0')).toBeLessThan(0);
  expect(porownajWersje('0.46.10', '0.46.9')).toBeGreaterThan(0);
  const md =
    '# Changelog\n\nWstęp.\n\n## [Unreleased]\n\n- nowe\n\n## v0.46.25 — 2026-10-24\n\nTreść.\n';
  expect(wersjeZChangelogu(md)).toEqual([
    { wersja: null, data: null, tytul: 'W przygotowaniu', id: 'w-przygotowaniu', md: '- nowe' },
    { wersja: '0.46.25', data: '2026-10-24', tytul: 'v0.46.25', id: 'v0-46-25', md: 'Treść.' },
  ]);
  // każda wersja z pliku ma wpis i własną kotwicę
  const naglowki = [...changelogMd.matchAll(/^## v(\d+\.\d+\.\d+)/gm)].map((m) => m[1]);
  const wersje = wersjeZChangelogu(changelogMd).filter((w) => w.wersja);
  expect(wersje.map((w) => w.wersja)).toEqual(naglowki);
  expect(new Set(wersje.map((w) => w.id)).size).toBe(wersje.length);
});

test('log: złożona strona na prawdziwych plikach', () => {
  const html = strona();
  expect(html).toMatch(/^<!doctype html>\n<html lang="pl">/);
  expect(html.match(/<h1\b/g)).toHaveLength(1);
  expect(html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1);
  expect(html).toContain(
    '<link rel="canonical" href="https://parawan.karolwilczynski.com/log/" />',
  );
  // bez skryptu i bez zasobów spoza pliku (linki nawigacyjne to nie zasoby)
  expect(html).not.toMatch(/<script\b/i);
  expect(html).not.toMatch(/\ssrc="/);
  expect(html).not.toMatch(/<link\b(?![^>]*rel="(?:icon|canonical|apple-touch-icon)")/);
  // każda wersja ma kotwicę; starsze niż ZWIJAJ_PRZED są zwinięte
  for (const w of wersjeZChangelogu(changelogMd)) {
    expect(html).toContain(`id="${w.id}"`);
    if (w.wersja && porownajWersje(w.wersja, ZWIJAJ_PRZED) < 0)
      // kotwica na treści w środku <details>: przeglądarka rozwija go przy wejściu z linku
      expect(html).toMatch(new RegExp(`<details class="wersja wersja-stara"><summary>(?:(?!</details>).)*?<div class="md" id="${w.id}">`, 's'));
  }
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  expect(ids.length - new Set(ids).size).toBe(0);
  for (const [, cel] of html.matchAll(/href="#([^"]+)"/g)) expect(ids, `#${cel}`).toContain(cel);
  // zakładki: #plan przed #zmiany (przełączanie przez :target bez JavaScriptu)
  expect(html.indexOf('id="plan"')).toBeLessThan(html.indexOf('id="zmiany"'));
  // linki zewnętrzne w nowej karcie bez dostępu do okna strony
  for (const [a] of html.matchAll(/<a href="https?:[^"]*"[^>]*>/g))
    expect(a).toContain('target="_blank" rel="noopener noreferrer"');
  // nic z Markdowna nie zostało na stronie jako surowy znacznik
  const tekst = pozaKodem(html.slice(html.indexOf('<body')));
  expect(tekst).not.toContain('**');
  expect(tekst).not.toMatch(/\]\(/);
  if (roadmapMd) {
    expect(html).toContain('<h3 id="teraz">Teraz</h3>');
    expect(html).not.toContain('class="pusto"');
  }
});

test('log: bez ROADMAP.md strona powstaje, a zakładka Plan mówi, że planu nie ma', () => {
  const html = strona(null);
  expect(html).toContain('class="pusto"');
  expect(html).toContain('id="v0-46-25"');
});
