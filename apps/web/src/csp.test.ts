import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import landingConfig from '../../landing/vite.config.ts?raw';
import webHtml from '../index.html?raw';
import webConfig from '../vite.config.ts?raw';
import { skrotCsp, wstawSkrotySkryptow } from './csp-skrot';

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
    // w źródle tylko miejsce na skrót: podmienia je wtyczka cspSkrot (test niżej)
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

/** Plik jak po vite-plugin-singlefile: meta z polityką z tablicy CSP, potem skrypt w linii. */
const fakeBuilt = (policy: string, scripts: string) =>
  `<!doctype html><html><head><meta charset="UTF-8">\n<meta http-equiv="Content-Security-Policy" content="${policy}" />` +
  `<script type="application/ld+json">{"@type":"WebPage"}</script>${scripts}</head><body><p>Zażółć</p></body></html>`;
const policyOf = (html: string) => html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1] ?? '';
const SCRIPT = 'const a="Zażółć gęślą jaźń";document.title=a+"\\x3C/script>"';

for (const [name, config] of [['aplikacja', webConfig], ['landing', landingConfig]] as const) {
  test(`${name}: wtyczka cspSkrot zostawia w script-src tylko skrót jedynego skryptu`, async () => {
    const source = [...cspFromConfig(config)].map(([d, s]) => [d, ...s].join(' ')).join('; ');
    const out = await wstawSkrotySkryptow(fakeBuilt(source, `<script type="module" crossorigin>${SCRIPT}</script>`));
    const after = new Map(policyOf(out).split('; ').map((d) => { const [n, ...s] = d.split(' '); return [n, s]; }));
    // skrót policzony obok wtyczki: SHA-256 z bajtów UTF-8, w base64
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SCRIPT)));
    const hash = btoa(String.fromCharCode(...digest));
    expect(after.get('script-src')).toEqual([`'sha256-${hash}'`]);
    expect(policyOf(out)).not.toMatch(/script-src[^;]*unsafe-inline/);
    // reszta polityki bez zmian, także style-src 'unsafe-inline'
    expect([...after].filter(([d]) => d !== 'script-src')).toEqual([...cspFromConfig(config)].filter(([d]) => d !== 'script-src'));
    expect(after.get('style-src')).toEqual(["'unsafe-inline'"]);
    expect(out.replace(policyOf(out), '')).toBe(fakeBuilt('', `<script type="module" crossorigin>${SCRIPT}</script>`));
  });
}

test('cspSkrot: skrót z UTF-8 i CRLF jak w przeglądarce, kilka skryptów, błąd bez skryptu albo meta', async () => {
  expect(await skrotCsp('1')).toBe("'sha256-a4ayc/80/OGda4BO/1o/V0etpOqiLx1JwB5S3beHW0s='");
  expect(await skrotCsp('a\r\nb\rc')).toBe(await skrotCsp('a\nb\nc'));
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";
  const two = policyOf(await wstawSkrotySkryptow(fakeBuilt(policy, '<script>1</script><script>2</script><script>1</script>')));
  expect(two).toBe(`default-src 'none'; script-src ${await skrotCsp('1')} ${await skrotCsp('2')}; style-src 'unsafe-inline'`);
  await expect(wstawSkrotySkryptow(fakeBuilt(policy, ''))).rejects.toThrow(/nie ma skryptu/);
  await expect(wstawSkrotySkryptow('<head><script>1</script></head>')).rejects.toThrow(/meta CSP/);
  await expect(wstawSkrotySkryptow(fakeBuilt("default-src 'none'", '<script>1</script>'))).rejects.toThrow(/do podmiany/);
  await expect(wstawSkrotySkryptow(fakeBuilt(policy, '<script src="x.js"></script>'))).rejects.toThrow(/src/);
  await expect(wstawSkrotySkryptow(fakeBuilt(policy, '<script>a="<!--"</script>'))).rejects.toThrow(/<!--/);
});

test('cspSkrot działa w obu plikach jako ostatnia wtyczka, po viteSingleFile', () => {
  for (const config of [webConfig, landingConfig]) {
    const plugins = config.match(/plugins: \[([^\]]*)\]/)?.[1] ?? '';
    expect(plugins.trim().startsWith('viteSingleFile()')).toBe(true);
    expect(plugins.trim().endsWith('cspSkrot()')).toBe(true);
  }
});
