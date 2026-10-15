import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import landingConfig from '../../landing/vite.config.ts?raw';
import webHtml from '../index.html?raw';
import webConfig from '../vite.config.ts?raw';

// Content-Security-Policy obu plików wstrzykuje przy buildzie plugin parawan-csp z vite.config.ts.
// Obecność polityki w gotowym dist/index.html sprawdza krok w CI, a działanie aplikacji z tą
// polityką (Przykład, DOCX, PDF, kopiowanie) sprawdzaliśmy w przeglądarce. Tu pilnujemy, żeby
// nikt po cichu jej nie poluzował: żadnego źródła sieciowego, żadnego 'unsafe-eval'.

/** Dyrektywy z tablicy `const CSP = [...]` w źródle konfiguracji (typ → lista źródeł). */
function cspFromConfig(src: string): Map<string, string[]> {
  const block = src.match(/const CSP = \[([\s\S]*?)\]\.join\('; '\);/)?.[1] ?? '';
  const items = [...block.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
  return new Map(items.map((it) => { const [name, ...sources] = it.trim().split(/\s+/); return [name, sources]; }));
}

const SAFE_SOURCES = new Set(["'none'", "'self'", "'unsafe-inline'", 'data:']);

for (const [name, config] of [['aplikacja', webConfig], ['landing', landingConfig]] as const) {
  test(`${name}: CSP bez źródeł sieciowych, tylko przy buildzie`, () => {
    const csp = cspFromConfig(config);
    expect(csp.size).toBeGreaterThanOrEqual(9);
    for (const d of ['default-src', 'connect-src', 'form-action', 'base-uri', 'object-src']) {
      expect(csp.get(d), d).toEqual(["'none'"]);
    }
    expect(csp.get('script-src')).toEqual(["'unsafe-inline'"]);
    expect(csp.get('font-src')).toEqual(['data:']);
    for (const [d, sources] of csp) {
      for (const s of sources) expect(SAFE_SOURCES.has(s), `${d} ${s}`).toBe(true);
    }
    // w źródłowym index.html polityka zablokowałaby `vite dev` (HMR przez WebSocket)
    expect(config).toMatch(/name: 'parawan-csp',\s*apply: 'build',/);
  });
}

test('aplikacja: obrazki wyłącznie z data:, bez plików obok', () => {
  expect(cspFromConfig(webConfig).get('img-src')).toEqual(['data:']);
  expect(cspFromConfig(landingConfig).get('img-src')).toEqual(["'self'", 'data:']);
});

test('źródłowe index.html: miejsce na CSP przed pierwszym skryptem, bez polityki na sztywno', () => {
  for (const html of [webHtml, landingHtml]) {
    // nazwa polityki może paść w treści (landing, „Jak sprawdzić”), ale nie jako meta
    expect(html).not.toMatch(/http-equiv=["']?Content-Security-Policy/i);
    const charset = html.search(/<meta charset="UTF-8"\s*\/?>/i);
    expect(charset).toBeGreaterThan(0);
    expect(charset).toBeLessThan(html.indexOf('<script'));
  }
});

test('landing: cytat polityki w „Jak sprawdzić” zgodny z polityką Parawan.html', () => {
  const pre = landingHtml.match(/<pre class="csp">([\s\S]*?)<\/pre>/)?.[1];
  expect(pre).toBeTruthy();
  const quoted = (pre ?? '').replace(/<[^>]+>/g, '');
  const policy = [...cspFromConfig(webConfig)].map(([d, s]) => [d, ...s].join(' ')).join('; ');
  expect(quoted).toBe(policy);
  // wyróżnione na stronie są dwie dyrektywy, o których mówi tekst
  expect(pre).toContain("<mark>default-src 'none'</mark>");
  expect(pre).toContain("<mark>connect-src 'none'</mark>");
});
