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
