import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import webHtml from '../index.html?raw';

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
