// Bramka czasu startu (npm run perf). Testy logiki biegną zawsze i bez przeglądarki. Pomiar wymaga
// kotwicy: PARAWAN_KOTWICA = ścieżka do Parawan.html z wydania z kalibracja.json (job „start”
// w ci.yml pobiera ją przez gh release download). Bez niej pomiar jest pomijany z powodem,
// a pomiar lokalny bez kotwicy i bez sieci daje node scripts/perf/start.mjs <plik>.
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  CPU_RATE,
  LCP_BUDGET_MS,
  MAX_RATIO,
  MIN_DELTA_MS,
  READY_BUDGET_MS,
  calibrateRate,
  cv,
  evaluate,
  gate,
  gateMarkdown,
  median,
  readKalibracja,
} from './start.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB_HTML =
  process.env.PARAWAN_WEB_HTML || path.join(ROOT, 'apps', 'web', 'dist', 'index.html');
const ANCHOR = process.env.PARAWAN_KOTWICA || '';

test('kalibracja.json: kotwica z sumą, pomiar komputera odniesienia i chwile do porównania', () => {
  const kal = readKalibracja();
  assert.match(kal.kotwica, /^v\d+\.\d+\.\d+$/);
  assert.match(kal.sha256, /^[0-9a-f]{64}$/);
  assert.equal(kal.rate, CPU_RATE);
  assert.ok(['znacznik', 'obserwator'].includes(kal.metoda));
  for (const k of ['gotowe_x1_ms', 'ui_x4_ms', 'lcp_x4_ms', 'gotowe_x4_ms']) {
    assert.ok(Number.isFinite(kal[k]) && kal[k] > 0, `kalibracja.json: ${k}`);
  }
  assert.ok(
    kal.porownanie.length > 0 && kal.porownanie.every((m) => ['ui', 'lcp', 'gotowe'].includes(m)),
  );
});

test('progi: źródłowe wartości (web.dev LCP i RAIL, Lighthouse ×4) i próg względny', () => {
  assert.equal(LCP_BUDGET_MS, 2500);
  assert.equal(READY_BUDGET_MS, 5000);
  assert.equal(CPU_RATE, 4);
  assert.equal(MAX_RATIO, 1.2);
  assert.equal(MIN_DELTA_MS, 300);
});

test('mediana, CV i kalibracja mnożnika dławienia', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(cv([5, 5, 5]), 0);
  assert.ok(Math.abs(cv([90, 100, 110]) - 0.1) < 1e-9);
  // maszyna dwa razy wolniejsza od odniesienia: dławimy dwa razy mniej
  assert.equal(calibrateRate(333, 666), 2);
  // w granicach 1…4
  assert.equal(calibrateRate(333, 100), CPU_RATE);
  assert.equal(calibrateRate(333, 5000), 1);
});

const KAL = {
  ui_x4_ms: 1500,
  lcp_x4_ms: 1700,
  gotowe_x4_ms: 2000,
  porownanie: ['ui', 'lcp', 'gotowe'],
};

test('ocena: przeliczenie na komputer odniesienia i progi bezwzględne', () => {
  // ta maszyna dwa razy wolniejsza: kotwica 2× dłużej, plik przeliczony z powrotem
  const ok = evaluate({
    a: { ui: 3000, lcp: 3400, gotowe: 4000 },
    b: { ui: 3000, lcp: 3400, gotowe: 4000 },
    kal: KAL,
  });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.ref.gotowe, 2000);
  const slow = evaluate({
    a: { ui: 1500, lcp: 1700, gotowe: 2000 },
    b: { ui: 1500, lcp: 2600, gotowe: 5100 },
    kal: { ...KAL, porownanie: [] },
  });
  assert.equal(slow.problems.length, 2, slow.problems.join('\n'));
  const noLcp = evaluate({
    a: { ui: 1, lcp: null, gotowe: 1 },
    b: { ui: 1, lcp: null, gotowe: 1 },
    kal: KAL,
  });
  assert.ok(noLcp.problems.some((p) => p.includes('LCP')));
});

test('ocena: próg względny tylko przy obu warunkach naraz i tylko dla chwil z porownanie', () => {
  const a = { ui: 1500, lcp: 1700, gotowe: 2000 };
  // +25%, ale tylko +125 ms przy małej liczbie: szum, bez błędu
  const small = evaluate({
    a: { ...a, ui: 500 },
    b: { ...a, ui: 625 },
    kal: { ...KAL, ui_x4_ms: 500 },
  });
  assert.deepEqual(small.problems, []);
  // +10% i +200 ms: poniżej progu procentowego
  assert.deepEqual(evaluate({ a, b: { ...a, gotowe: 2200 }, kal: KAL }).problems, []);
  // +25% i +500 ms: błąd
  assert.equal(evaluate({ a, b: { ...a, gotowe: 2500 }, kal: KAL }).problems.length, 1);
  // ta sama zmiana dla chwili spoza porownanie: bez błędu
  assert.deepEqual(
    evaluate({ a, b: { ...a, gotowe: 2500 }, kal: { ...KAL, porownanie: ['ui'] } }).problems,
    [],
  );
});

test('czas startu: progi bezwzględne na modelu słabego komputera i bez wyraźnego spowolnienia wobec kotwicy', {
  skip: ANCHOR
    ? false
    : 'brak PARAWAN_KOTWICA (Parawan.html z wydania z kalibracja.json); pomiar lokalny: node scripts/perf/start.mjs <plik>',
  timeout: 900_000,
}, async () => {
  const report = await gate({ anchor: ANCHOR, file: WEB_HTML });
  const md = gateMarkdown(report);
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  assert.deepEqual(report.problems, [], report.problems.join('\n'));
});
