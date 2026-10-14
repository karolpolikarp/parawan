import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import webHtml from '../index.html?raw';

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
  expect(webHtml.match(/<span class="chev" aria-hidden="true">/g)).toHaveLength(2);
  expect(webHtml.match(/<summary class="card-h" aria-labelledby="/g)).toHaveLength(2);
});

test('landing: tabela, nagłówki i statystyki demo dla czytnika ekranu', () => {
  expect(landingHtml).toMatch(/id="demo-stat" role="status"/);
  // po h2 sekcji stopka miała h4 (przeskok poziomu)
  expect(landingHtml).not.toMatch(/<h4/);
  // pierwsza kolumna porównania to nagłówki wierszy: czytnik poda kryterium przy „nigdy”
  expect(landingHtml.match(/<th scope="row" class="cmp-feat">/g)).toHaveLength(7);
  expect(landingHtml).not.toContain('<td class="cmp-feat">');
  expect(landingHtml).toMatch(/<table aria-labelledby="porownanie-h">/);
});
