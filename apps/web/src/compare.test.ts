import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import { renderAligned } from './compare';

// Wzorzec znaczników jak w main.ts (lista z PII_TOKENS skrócona do typów z tych testów).
const TOKEN_RE =
  /\[(PESEL|NIP|REGON|TELEFON|EMAIL|ADRES|KOD-POCZTOWY|MIEJSCOWOŚĆ|NR-KONTA|IMIĘ I NAZWISKO|OSOBA-[A-Z]+)\]/g;
const maskHtml = (name: string): string => `<mark>[${name}]</mark>`;

const compareOf = (original: string): string =>
  renderAligned(original, redactPII(original).redacted, { tokenRe: TOKEN_RE, maskHtml, compare: true })
    .html;

/** Przekreślone fragmenty oryginału po kolei. */
const dels = (html: string): string[] => [...html.matchAll(/<del>([^<]*)<\/del>/g)].map((m) => m[1]);

/** Co zostaje po zaznaczeniu całego wyniku i Ctrl+C: `.orig` ma `user-select: none`. */
const selectable = (html: string): string =>
  html.replace(/<span class="orig">.*?<\/span>/g, '').replace(/<[^>]+>/g, '');

test('znaczniki rozdzielone samą spacją dostają jeden wspólny fragment oryginału', () => {
  const html = compareOf('Jan Kowalski 44051401359');
  expect(dels(html)).toEqual(['Jan Kowalski 44051401359']);
  expect(html).toMatch(/<\/del> <\/span><mark>\[IMIĘ I NAZWISKO\]<\/mark> <mark>\[PESEL\]<\/mark>$/);
});

test('adres, kod i miejscowość bez przecinków: jeden fragment, za nim trzy znaczniki', () => {
  const html = compareOf('ul. Polna 12 00-950 Warszawa');
  expect(dels(html)).toEqual(['ul. Polna 12 00-950 Warszawa']);
  expect(html.match(/<mark>/g)).toHaveLength(3);
});

test('telefon i e-mail po spacji: jeden fragment, bez rozbicia numeru', () => {
  const html = compareOf('600 700 800 anna@example.com');
  expect(dels(html)).toEqual(['600 700 800 anna@example.com']);
  expect(html.match(/<mark>/g)).toHaveLength(2);
});

test('tabulator i twarda spacja między wartościami działają jak zwykła spacja', () => {
  const nbsp = String.fromCharCode(160);
  for (const gap of ['\t', nbsp]) {
    const original = `Jan Kowalski${gap}44051401359`;
    expect(dels(compareOf(original))).toEqual([original]);
  }
});

test('wartości oddzielone interpunkcją nadal są parowane osobno', () => {
  const html = compareOf('Jan Kowalski, PESEL 44051401359, tel. 600 700 800');
  expect(dels(html)).toEqual(['Jan Kowalski', '44051401359', '600 700 800']);
});

test('spacja na końcu tekstu nie przesuwa granicy fragmentu', () => {
  expect(dels(compareOf('Jan Kowalski '))).toEqual(['Jan Kowalski']);
});

test('zaznaczenie w „Porównaniu” nie obejmuje żadnej oryginalnej wartości', () => {
  const original =
    'Nazywam się Anna Kowalska, PESEL 44051401359.\nTel. 600 700 800, e-mail: anna.kowalska@example.com';
  const { redacted } = redactPII(original);
  const sel = selectable(compareOf(original));
  expect(sel).toBe(redacted);
  for (const leak of ['Kowalska', '44051401359', '600 700 800', 'anna.kowalska@example.com']) {
    expect(sel).not.toContain(leak);
  }
});

test('wartość przechodząca przez koniec wiersza: każdy wiersz ma własny element nie do zaznaczenia', () => {
  const html = compareOf('Jan\nKowalski, PESEL 44051401359');
  // wiersze wyniku są osobnymi blokami, więc znacznik nie może przekroczyć granicy wiersza
  for (const line of html.split('\n')) {
    expect(line.match(/<span/g)?.length ?? 0).toBe(line.match(/<\/span>/g)?.length ?? 0);
  }
  expect(dels(html)).toEqual(['Jan', 'Kowalski', '44051401359']);
  expect(selectable(html)).not.toContain('Kowalski');
});

test('tekst już zanonimizowany: dawne znaczniki są zwykłym tekstem, liczy się tylko nowe wykrycie', () => {
  const original = 'Pan [IMIĘ I NAZWISKO], tel. 600 700 800, PESEL [PESEL].';
  const { redacted, found } = redactPII(original);
  expect(found).toEqual([{ type: 'TELEFON', count: 1 }]);
  for (const compare of [false, true]) {
    const { html, kept } = renderAligned(original, redacted, { tokenRe: TOKEN_RE, maskHtml, compare });
    expect(kept).toBe(2);
    expect(html.match(/<mark>/g)).toHaveLength(1);
    expect(html).toContain('<mark>[TELEFON]</mark>');
  }
});

test('dawny znacznik przed nową wartością: tylko nowa wartość jest przekreślona', () => {
  const original = '[IMIĘ I NAZWISKO] 600 700 800';
  const { redacted } = redactPII(original);
  const { html, kept } = renderAligned(original, redacted, { tokenRe: TOKEN_RE, maskHtml, compare: true });
  expect(kept).toBe(1);
  expect(dels(html)).toEqual(['600 700 800']);
  expect(html.match(/<mark>/g)).toHaveLength(1);
});

test('widok „Wynik”: ten sam tekst co wynik, bez oryginału', () => {
  const original = 'Jan Kowalski, PESEL 44051401359, tel. 600 700 800 <b>&</b>';
  const { redacted } = redactPII(original);
  const { html } = renderAligned(original, redacted, { tokenRe: TOKEN_RE, maskHtml, compare: false });
  expect(html).not.toContain('<del>');
  expect(html).toContain('&lt;b&gt;&amp;&lt;/b&gt;');
  expect(html.replace(/<\/?mark>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')).toBe(
    redacted,
  );
});
