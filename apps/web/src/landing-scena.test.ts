import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import benchmarkMd from '../../../docs/BENCHMARK.md?raw';
import landingHtmlRaw from '../../landing/index.html?raw';
import { ICONS, wstawIkony } from '../../landing/src/icons';
import { wstawIlustracje } from '../../landing/src/ilustracje';
import { maski, sklad, tresciSceny, wstawScene } from '../../landing/src/scena';
import { liczbyBenchmarku, opisyRzedow, wstawSkutecznosc } from '../../landing/src/skutecznosc';
import { ADRES_POCZTOWKI, EXAMPLE_TEXT, MASK_TOKEN_RE, PISMO_TEXT, ZOSTAW } from '../../landing/src/tokens';
import { licznikKategorii } from '../../landing/src/wynik';

// Treść strony liczona przy buildzie (wtyczka parawanTresc w apps/landing/vite.config.ts): scena
// „Parawany stają tylko przy danych”, adres na pocztówce, stan okna z tekstem bez JavaScriptu,
// rzędy w „Skuteczności”, ilustracje i ikony. Scena zależy od reguł rdzenia, więc zmiana reguły,
// która zmienia wynik pisma, ma wywrócić ten test (DESIGN.md: maskuj całość).

const html = landingHtmlRaw.replace(/ /g, ' ');
const LITERA_CYFRA = /[\p{L}\p{N}]/u;

test('scena: każdy znacznik w index.html raz, po wstawieniu żaden nie zostaje', () => {
  const t = tresciSceny(redactPII);
  for (const k of Object.keys(t)) expect(html, k).toContain(`<!--SCENA:${k}-->`);
  const out = wstawScene(html, redactPII);
  expect(out).not.toContain('<!--SCENA:');
  // nieznany znacznik zatrzymuje build
  expect(() => wstawScene(`${html}<!--SCENA:NIEZNANY-->`, redactPII)).toThrow(/nieznany znacznik/);
  expect(() => wstawScene('<p></p>', redactPII)).toThrow(/brak znacznika/);
});

test('scena: każda dana zasłonięta w całości, fragmenty „na słońcu” nietknięte', () => {
  const { redacted } = redactPII(PISMO_TEXT);
  const mk = maski(PISMO_TEXT, redacted);
  expect(mk).not.toBeNull();
  // maska zaczyna się i kończy na granicy słowa: żadna litera ani cyfra danej nie zostaje obok
  for (const { a, b, lab } of mk ?? []) {
    const przed = PISMO_TEXT[a - 1] ?? ' ';
    const po = PISMO_TEXT[b] ?? ' ';
    expect(LITERA_CYFRA.test(przed), `${lab} przed „${PISMO_TEXT.slice(a, b)}”`).toBe(false);
    expect(LITERA_CYFRA.test(po), `${lab} po „${PISMO_TEXT.slice(a, b)}”`).toBe(false);
  }
  for (const z of ZOSTAW) {
    expect(PISMO_TEXT, z.t).toContain(z.t);
    expect(redacted, z.t).toContain(z.t);
  }
  // w składzie liczba masek i fragmentów „na słońcu” zgadza się z wynikiem silnika
  const sk = sklad(PISMO_TEXT, redactPII, ZOSTAW);
  expect(sk.maski).toBe([...redacted.matchAll(MASK_TOKEN_RE)].length);
  expect(sk.zostaje).toBe(ZOSTAW.length);
  expect(sk.html.match(/<span class="d c-\w+ lab"/g)).toHaveLength(sk.maski);
  expect(sk.html.match(/<span class="k[ "]/g)).toHaveLength(ZOSTAW.length);
  // oryginał każdej maski stoi w całości w swoim .o (animacja chowa go naraz, nigdy kawałka)
  for (const { a, b } of mk ?? []) {
    const o = PISMO_TEXT.slice(a, b).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    expect(sk.html.replace(/ /g, ' ')).toContain(`<span class="o" aria-hidden="true">${o}</span>`);
  }
  // podsumowanie mówi o tylu fragmentach, ile jest masek
  const t = tresciSceny(redactPII);
  expect(t.PODSUM).toMatch(new RegExp(`^Zasłonięto ${sk.maski} fragment`));
  expect(t['N-MASKI']).toBe(String(sk.maski));
  expect(t.WINIETA.match(/class="wp /g)).toHaveLength(sk.maski);
});

test('pocztówka: adres zasłonięty w całości, podpis nie powtarza danych', () => {
  const t = tresciSceny(redactPII);
  for (const czesc of ['Tomasz', 'Kowalczyk', 'Długa', '7/12', '30-512', 'Kraków']) {
    expect(ADRES_POCZTOWKI).toContain(czesc);
    expect(t.ADRES, czesc).not.toContain(czesc);
  }
  const podpis = html.match(/<p class="ad-podpis">([\s\S]*?)<\/p>/)?.[1] ?? '';
  expect(podpis).not.toBe('');
  for (const czesc of ['Tomasz', 'Kowalczyk', 'Długa', 'Kraków']) expect(podpis, czesc).not.toContain(czesc);
});

test('okno z tekstem bez JavaScriptu: przykład, wynik i legenda z silnika', () => {
  const out = wstawScene(html, redactPII);
  const { redacted } = redactPII(EXAMPLE_TEXT);
  const wy = out.match(/<div id="demo-output"[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
  expect([...wy.matchAll(/<mark class="pii pii-\w+">\[([^\]]+)\]<\/mark>/g)].map((m) => m[1])).toEqual(
    [...redacted.matchAll(MASK_TOKEN_RE)].map((m) => m[1]),
  );
  const ile = licznikKategorii(redacted);
  const legenda = Object.fromEntries(
    [...out.matchAll(/<b class="leg-n" data-k="(\w+)">(\d+)<\/b>/g)].map((m) => [m[1], Number(m[2])]),
  );
  expect(Object.keys(legenda).sort()).toEqual(['contact', 'fin', 'ident', 'person', 'place']);
  for (const [k, n] of Object.entries(legenda)) expect(n, k).toBe(ile[k] ?? 0);
  // duża liczba w „Co się stało z przykładem” to liczba znaczników przykładu
  const duza = html.match(/<p class="dziesiec"[^>]*><b>(\d+)<\/b>/)?.[1];
  expect(Number(duza)).toBe([...redacted.matchAll(MASK_TOKEN_RE)].length);
});

test('skuteczność: liczby i rzędy parawanów zgodne z docs/BENCHMARK.md', () => {
  const b = liczbyBenchmarku(benchmarkMd);
  const recall = benchmarkMd.match(/\| T0\+T1 core \| ([\d.]+)%/)?.[1]?.replace('.', ',');
  expect(recall).toBeTruthy();
  const sekcja = html.match(/<section[^>]*\bid="skutecznosc"[^>]*>[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(sekcja).toContain(`<span class="duza-l">${recall}%</span>`);
  expect(sekcja).toContain(`jeden z ${b.mustMask} fragmentów, które w pomiarze miały zniknąć`);
  expect(sekcja).toContain(`za parawanem: ${b.hit} `);
  expect(sekcja).toContain(`przeszło: ${b.mustMask - b.hit}</figcaption>`);
  expect(sekcja).toContain(`<h3>A to, co miało zostać na słońcu: ${b.kept} z ${b.mustKeep}</h3>`);
  expect(sekcja).toContain(`zostało: ${b.kept} `);
  expect(sekcja).toContain(`zasłonięte bez potrzeby: ${b.mustKeep - b.kept}</figcaption>`);
  // rzędy: każdy pasek to jeden fragment, błędy jako osobne kreskowane paski
  const out = wstawSkutecznosc(sekcja, benchmarkMd);
  const svgs = [...out.matchAll(/<svg class="rzedy rz-(szer|waski)"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
  expect(svgs).toHaveLength(4);
  const o = opisyRzedow(b);
  for (const [i, svg] of svgs.entries()) {
    const n = i < 2 ? b.mustMask : b.mustKeep;
    const zle = i < 2 ? b.mustMask - b.hit : b.mustKeep - b.kept;
    expect(svg).toContain(`aria-label="${i < 2 ? o.a : o.b}"`);
    expect(svg.match(/class="p-zly"/g) ?? []).toHaveLength(zle);
    const w = Number(svg.match(/<pattern id="ds-[AB]\d+" width="(\d+)"/)?.[1]) / 2;
    const suma = [...svg.matchAll(/<rect fill="url\(#ds-[AB]\d+\)" x="4" y="[\d.]+" width="([\d.]+)"/g)]
      .map((m) => Number(m[1]))
      .reduce((x, y) => x + y, 0);
    expect(suma / w).toBe(n);
  }
  expect(o.a).toContain(`${b.hit} zielonych`);
  expect(() => wstawSkutecznosc('<p></p>', benchmarkMd)).toThrow(/RZEDY-A/);
});

test('ilustracje i ikony wstawiane przy buildzie', () => {
  const out = wstawIkony(wstawIlustracje(html));
  // rzędy (<!--IL:RZEDY-A/B-->) wstawia wstawSkutecznosc, test wyżej
  expect(out).not.toMatch(/<!--IL:(?!RZEDY-[AB]-->)/);
  expect(out).toMatch(/<svg viewBox="0 0 1200 800" role="img" aria-label="Pocztówka: [^"]+„Pozdrowienia znad danych”\.">/);
  expect(out).toContain('<symbol id="bor-dal"');
  // kabiny nad tabelą: kategorie w tej samej kolejności co wiersze tabeli, każda ze znakiem i nazwą
  const kab = [...out.matchAll(/<li class="kab c-(\w+)"[\s\S]*?<span class="kab-n">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);
  const wiersze = [...out.matchAll(/<th scope="row" role="rowheader" class="c-(\w+)">[\s\S]*?<span class="tl ct-\w+">([^<·]+) ·/g)].map((m) => [
    m[1],
    m[2].trim(),
  ]);
  expect(kab).toEqual(wiersze);
  expect(kab).toHaveLength(5);
  // bursztyn #B9791F tylko na słońcu: w pocztówce nie ma go wcale (pasek kategorii to CSS)
  expect(out.match(/<svg viewBox="0 0 1200 800"[\s\S]*?<\/svg>/)?.[0]).not.toContain('#B9791F');
  expect(out).not.toMatch(/<i class="gi" data-i="[^"]+"><\/i>/);
  for (const name of Object.keys(ICONS)) expect(out).toContain(`data-i="${name}" data-done="1"><svg`);
  expect(() => wstawIkony('<i class="gi" data-i="nie-ma"></i>')).toThrow(/nie-ma/);
  expect(() => wstawIlustracje('<p></p>')).toThrow(/IL:POCZTOWKA/);
});
