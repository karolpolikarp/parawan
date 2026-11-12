/**
 * Benchmark anonimizacji: recall (odsetek mustMask usuniętych) i precision-proxy (odsetek
 * mustKeep zachowanych) dla rdzenia i opcjonalnych warstw NER. Warstwa NER widzi tekst po
 * redakcji strukturalnej; niedostępna (health-check, brak modelu) jest pomijana z adnotacją.
 * Wynik: tabele na stdout, docs/BENCHMARK.md i results.json. `--check` to bramka regresji w CI.
 *
 *   npm run build -w anonimizator && node scripts/benchmark/run.mjs [--check]
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildDataset, SEED } from './dataset.mjs';
import { redactPII } from '../../packages/core/dist/index.js';
import { redactPIIFull, nerHealthCheck } from '../../packages/core/dist/ner-client.js';
import { applyNerPersons } from '../../packages/core/dist/ner-postprocess.js';

// Ścieżki względem pliku: runner działa z dowolnego CWD.
const RESULTS_JSON = fileURLToPath(new URL('./results.json', import.meta.url));
const BENCHMARK_MD = fileURLToPath(new URL('../../docs/BENCHMARK.md', import.meta.url));
const CORE_PKG = fileURLToPath(new URL('../../packages/core/package.json', import.meta.url));

const NER_TIMEOUT_MS = 20000; // hojny, bo HerBERT na CPU bywa wolny
const HEALTH_TIMEOUT_MS = 5000;
const WARMUP_TIMEOUT_MS = 60000;
const CONCURRENCY = 4; // lokalna usługa NER, nie przeciążamy

// Wymaga @huggingface/transformers i modelu w ONNX_MODELS_DIR/<ONNX_MODEL_ID>.
const ONNX_MODELS_DIR = process.env.ONNX_MODELS_DIR
  ? process.env.ONNX_MODELS_DIR
  : fileURLToPath(new URL('./models/', import.meta.url));
const ONNX_MODEL_ID = process.env.ONNX_MODEL_ID || 'fastpdn';

let onnxPipe = null;

async function onnxAvailable() {
  const cfg = `${ONNX_MODELS_DIR.replace(/[\\/]$/, '')}/${ONNX_MODEL_ID}/config.json`;
  if (!existsSync(cfg)) return false;
  try {
    const T = await import('@huggingface/transformers');
    T.env.allowRemoteModels = false; // model tylko lokalny, zero sieci
    T.env.localModelPath = ONNX_MODELS_DIR;
    onnxPipe = await T.pipeline('token-classification', ONNX_MODEL_ID, { dtype: 'q8' });
    return true;
  } catch {
    return false;
  }
}

const httpNerLayer = (name, desc, url) => ({
  name,
  desc,
  url,
  run: async (text) => (await redactPIIFull(text, { url, timeoutMs: NER_TIMEOUT_MS })).redacted,
});

const LAYERS = [
  {
    name: 'T0+T1 core',
    desc: 'redactPII(): regex, sumy kontrolne i słownik (in-process, offline)',
    url: null,
    run: async (text) => redactPII(text).redacted,
  },
  httpNerLayer('core+spacy', 'redactPIIFull() + NER spaCy pl_core_news_lg (127.0.0.1:8090)', 'http://127.0.0.1:8090'),
  httpNerLayer('core+fastpdn', 'redactPIIFull() + NER FastPDN/HerBERT (127.0.0.1:8091)', 'http://127.0.0.1:8091'),
  {
    name: 'core+onnx (Node)',
    desc: 'redactPII() + FastPDN ONNX int8 (q8) w Node przez @huggingface/transformers, bez Dockera',
    url: null,
    probe: onnxAvailable,
    skipReason: 'biblioteka @huggingface/transformers lub lokalny model ONNX niedostępne',
    run: async (text) => {
      const base = redactPII(text).redacted;
      const tokens = await onnxPipe(base, { ignore_labels: [] });
      return applyNerPersons(base, tokens).redacted;
    },
  },
];

const isNer = (layer) => Boolean(layer.url || layer.probe);

const CAT_SHORT = {
  'osoby-podstawowe': 'os-podst',
  'osoby-odmiana': 'os-odmiana',
  'osoby-rzadkie': 'os-rzadkie',
  'osoby-rzadkie-ner': 'os-rz-ner',
  'osoby-slownik': 'os-slownik',
  strukturalne: 'struktur.',
  negatywy: 'negatywy',
};

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const pct = (num, den) => (den === 0 ? null : num / den);
const fmtPct = (v) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`);
// F1 nie jest zdefiniowane, gdy brakuje składowej (negatywy nie mają recall).
const f1 = (r, p) => (r === null || p === null || r + p === 0 ? null : (2 * r * p) / (r + p));
const emptyCounts = () => ({ maskTotal: 0, maskHit: 0, keepTotal: 0, keepHit: 0 });
const scores = (v) => {
  const recall = pct(v.maskHit, v.maskTotal);
  const precision = pct(v.keepHit, v.keepTotal);
  return { recall, precision, f1: f1(recall, precision) };
};

function evaluateCase(c, redacted) {
  const leaked = c.mustMask.filter((s) => redacted.includes(s));
  const eaten = c.mustKeep.filter((s) => !redacted.includes(s));
  return { leaked, eaten };
}

async function main() {
  const startedAt = new Date();
  const coreVersion = JSON.parse(readFileSync(CORE_PKG, 'utf8')).version;
  const { cases } = buildDataset();
  const categories = [...new Set(cases.map((c) => c.category))];

  console.log(`Benchmark anonimizatora: ${cases.length} przypadków (seed ${SEED}), core v${coreVersion}\n`);

  const activeLayers = [];
  const skippedLayers = [];
  const WARMUP = 'Rozgrzewka modelu: Jan Testowy z Warszawy.';
  for (const layer of LAYERS) {
    if (!isNer(layer)) {
      activeLayers.push(layer);
      continue;
    }
    const ok = layer.probe ? await layer.probe() : await nerHealthCheck({ url: layer.url, timeoutMs: HEALTH_TIMEOUT_MS });
    if (ok) {
      // Pierwsze wywołanie modelu bywa wolne (ładowanie, JIT): bez rozgrzewki pomiar startowałby
      // od fałszywego timeoutu albo otwartego circuit breakera.
      if (layer.url) {
        await redactPIIFull(WARMUP, { url: layer.url, timeoutMs: WARMUP_TIMEOUT_MS });
      } else {
        try {
          await layer.run(WARMUP);
        } catch {
          /* rozgrzewka nie może wywrócić biegu */
        }
      }
      activeLayers.push(layer);
      console.log(`✔ ${layer.name}: dostępna${layer.url ? ` (${layer.url})` : ''}`);
    } else {
      skippedLayers.push(layer);
      console.log(`✖ ${layer.name}: niedostępna${layer.url ? ` (${layer.url})` : ''}, warstwa pominięta`);
    }
  }
  console.log('');

  const layerResults = [];
  let coreOutputs = null; // rdzeń jest zawsze pierwszy na liście aktywnych warstw
  for (const layer of activeLayers) {
    const ner = isNer(layer);
    const t0 = Date.now();
    // ONNX-Node ma jeden pipeline na CPU, więc bez równoległości.
    const outputs = await mapPool(cases, layer.url ? CONCURRENCY : 1, (c) => layer.run(c.text));
    const elapsedMs = Date.now() - t0;
    if (!ner) coreOutputs = outputs;

    const agg = emptyCounts();
    const perCat = new Map(categories.map((cat) => [cat, emptyCounts()]));
    const failures = [];
    const perCase = [];
    let changedVsCore = 0;

    cases.forEach((c, i) => {
      const redacted = outputs[i];
      const { leaked, eaten } = evaluateCase(c, redacted);
      for (const t of [agg, perCat.get(c.category)]) {
        t.maskTotal += c.mustMask.length;
        t.maskHit += c.mustMask.length - leaked.length;
        t.keepTotal += c.mustKeep.length;
        t.keepHit += c.mustKeep.length - eaten.length;
      }
      if (ner && redacted !== coreOutputs[i]) changedVsCore++;
      if (leaked.length > 0 || eaten.length > 0) {
        failures.push({ id: c.id, category: c.category, text: c.text, leaked, eaten, redacted });
      }
      perCase.push({ id: c.id, leaked, eaten });
    });

    const lr = {
      name: layer.name,
      desc: layer.desc,
      elapsedMs,
      changedVsCore: ner ? changedVsCore : null,
      ...scores(agg),
      agg,
      perCategory: Object.fromEntries([...perCat.entries()].map(([cat, v]) => [cat, { ...scores(v), ...v }])),
      failures,
      perCase,
    };
    layerResults.push(lr);

    console.log(
      `${layer.name}: recall ${fmtPct(lr.recall)}, ` +
        `precision ${fmtPct(lr.precision)}, ` +
        `F1 ${fmtPct(lr.f1)}, ` +
        `porażek: ${failures.length}, czas: ${(elapsedMs / 1000).toFixed(1)} s` +
        (ner ? `, wynik różny od core w ${changedVsCore} przypadkach` : ''),
    );
  }

  console.log('\n=== Recall (odsetek mustMask usuniętych) ===');
  printTable(layerResults, categories, 'recall');
  console.log('\n=== Precision-proxy (odsetek mustKeep zachowanych) ===');
  printTable(layerResults, categories, 'precision');
  console.log('\n=== F1 (średnia harmoniczna recall i precision-proxy) ===');
  printTable(layerResults, categories, 'f1');

  const mustMaskTotal = cases.reduce((a, c) => a + c.mustMask.length, 0);
  const mustKeepTotal = cases.reduce((a, c) => a + c.mustKeep.length, 0);
  const resultsPayload = {
    generatedAt: startedAt.toISOString(),
    seed: SEED,
    coreVersion,
    casesTotal: cases.length,
    mustMaskTotal,
    mustKeepTotal,
    skippedLayers: skippedLayers.map((l) => ({
      name: l.name,
      url: l.url,
      reason: l.skipReason ?? 'usługa niedostępna (health-check)',
    })),
    layers: layerResults,
  };
  writeFileSync(RESULTS_JSON, JSON.stringify(resultsPayload, null, 2) + '\n', 'utf8');
  console.log(`\nZapisano: ${RESULTS_JSON}`);

  writeFileSync(
    BENCHMARK_MD,
    buildMarkdown({ startedAt, coreVersion, cases, mustMaskTotal, mustKeepTotal, categories, layerResults, skippedLayers }),
    'utf8',
  );
  console.log(`Zapisano: ${BENCHMARK_MD}`);

  // --check: progi rdzenia (bez modelu, działa w CI); warstwy NER nie mogą obniżyć recall ani precyzji rdzenia.
  if (process.argv.includes('--check')) {
    const core = layerResults[0];
    const violations = [];
    // Bez osoby-rzadkie-ner (rdzeń z założenia ich nie łapie) i negatywów (brak mustMask).
    for (const cat of ['osoby-podstawowe', 'osoby-odmiana', 'osoby-rzadkie', 'osoby-slownik', 'strukturalne']) {
      const r = core.perCategory[cat]?.recall;
      if (r != null && r < 1) violations.push(`recall[${cat}] = ${fmtPct(r)} < 100% (regresja detekcji)`);
    }
    if (core.precision !== null && core.precision < 0.98) {
      violations.push(`precision-proxy = ${fmtPct(core.precision)} < 98% (nadmaskowanie)`);
    }
    for (const lr of layerResults) {
      if (lr === core) continue;
      if (lr.recall !== null && lr.recall < core.recall - 1e-9) {
        violations.push(`${lr.name}: recall ${fmtPct(lr.recall)} < core ${fmtPct(core.recall)} (warstwa NER obniża ochronę)`);
      }
      if (lr.precision !== null && lr.precision < core.precision - 1e-9) {
        violations.push(`${lr.name}: precision ${fmtPct(lr.precision)} < core ${fmtPct(core.precision)} (warstwa NER nadmaskowuje)`);
      }
    }
    if (violations.length) {
      console.error('\n❌ Bramka benchmarku (--check) wykryła regresję:');
      for (const v of violations) console.error('   - ' + v);
      process.exit(1);
    }
    console.log('\n✔ Bramka benchmarku (--check): brak regresji (rdzeń w normie, warstwy NER nie obniżają ochrony).');
  }
}

function printTable(layerResults, categories, metric) {
  const col = (c) => (CAT_SHORT[c] ?? c).padStart(11);
  const header = ['Warstwa'.padEnd(16), 'Łącznie'.padStart(8), ...categories.map(col)].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const lr of layerResults) {
    const cells = categories.map((cat) => fmtPct(lr.perCategory[cat][metric]).padStart(11));
    console.log([lr.name.padEnd(16), fmtPct(lr[metric]).padStart(8), ...cells].join(' | '));
  }
}

function buildMarkdown({ startedAt, coreVersion, cases, mustMaskTotal, mustKeepTotal, categories, layerResults, skippedLayers }) {
  const date = startedAt.toISOString().slice(0, 10);
  const perCatCount = new Map();
  for (const c of cases) perCatCount.set(c.category, (perCatCount.get(c.category) ?? 0) + 1);

  const lines = [];
  const push = (...xs) => lines.push(...xs);

  push(`# Benchmark anonimizacji: precision i recall`);
  push('');
  push(`- **Data uruchomienia:** ${date}`);
  push(`- **Wersja rdzenia (\`anonimizator\`):** ${coreVersion}`);
  push(`- **Zbiór ewaluacyjny:** ${cases.length} syntetycznych zdań (deterministyczny, seed \`${SEED}\`), ` +
    `${mustMaskTotal} elementów do zamaskowania (mustMask), ${mustKeepTotal} elementów do zachowania (mustKeep)`);
  push(`- **Reprodukcja:** \`npm run build -w anonimizator && node scripts/benchmark/run.mjs\``);
  push('');
  push(`## Metodologia`);
  push('');
  push(`Każdy przypadek testowy to zdanie z listą **mustMask** (dokładne podłańcuchy, które mają`);
  push(`zniknąć z wyniku redakcji: PESEL-e, nazwiska w odmianie itd.) oraz **mustKeep** (podłańcuchy,`);
  push(`które mają zostać: numery przepisów, sygnatury akt, instytucje, homonimy nazwisk).`);
  push('');
  push(`- **recall**: odsetek elementów mustMask nieobecnych w wyniku (miara skuteczności anonimizacji;`);
  push(`  element obecny w wyniku = wyciek danych osobowych);`);
  push(`- **precision-proxy**: odsetek elementów mustKeep zachowanych w wyniku (miara nadmaskowania;`);
  push(`  element usunięty = fałszywy pozytyw, który psuje użyteczność tekstu).`);
  push('');
  push(`Wszystkie identyfikatory w zbiorze mają **poprawne sumy kontrolne** policzone w generatorze`);
  push(`(PESEL, NIP, REGON, IBAN mod-97, nr dowodu), a negatywy zawierają m.in. ciągi o celowo`);
  push(`**błędnych** sumach kontrolnych, które silnik ma zostawić w spokoju.`);
  push('');
  push(`Liczności kategorii: ${[...perCatCount.entries()].map(([c, n]) => `${c}: ${n}`).join(', ')}.`);
  push('');
  push(`### Warstwy`);
  push('');
  for (const lr of layerResults) push(`- **${lr.name}**: ${lr.desc}`);
  for (const sl of skippedLayers) {
    const why = sl.skipReason ?? `usługa \`${sl.url}\` niedostępna w chwili uruchomienia (health-check)`;
    push(`- **${sl.name}**: pominięta, ${why}.`);
  }
  push('');
  push(`## Wyniki`);
  push('');
  push(`| Warstwa | Recall (łącznie) | Precision-proxy (łącznie) | F1 | Porażki (przypadki) | Czas | Wynik ≠ core |`);
  push(`|---|---|---|---|---|---|---|`);
  for (const lr of layerResults) {
    push(
      `| ${lr.name} | ${fmtPct(lr.recall)} (${lr.agg.maskHit}/${lr.agg.maskTotal}) | ` +
        `${fmtPct(lr.precision)} (${lr.agg.keepHit}/${lr.agg.keepTotal}) | ${fmtPct(lr.f1)} | ${lr.failures.length} | ` +
        `${(lr.elapsedMs / 1000).toFixed(1)} s | ${lr.changedVsCore === null ? '—' : `${lr.changedVsCore} przyp.`} |`,
    );
  }
  push('');
  push(`F1 liczone jako średnia harmoniczna recall i precision-proxy (łącznie po wszystkich kategoriach`);
  push(`z oboma rodzajami elementów; kategoria „negatywy" nie ma recall, więc nie wchodzi do składowej recall).`);
  push('');
  // Kolejność tabel czytają landing.test.ts i release-docs.test.ts.
  for (const [label, key] of [['Recall', 'recall'], ['F1', 'f1'], ['Precision-proxy', 'precision']]) {
    push(`### ${label} per kategoria`);
    push('');
    push(`| Warstwa | ${categories.join(' | ')} |`);
    push(`|---|${categories.map(() => '---').join('|')}|`);
    for (const lr of layerResults) {
      push(`| ${lr.name} | ${categories.map((c) => fmtPct(lr.perCategory[c][key])).join(' | ')} |`);
    }
    push('');
  }
  push(`(„—" = brak elementów danego rodzaju w kategorii, np. negatywy nie mają mustMask.)`);
  push('');
  push(`## Najczęstsze porażki`);
  push('');
  push(`Legenda: **przeszło** = element mustMask pozostał w wyniku (wyciek PII);`);
  push(`**zjedzono** = element mustKeep został zamaskowany (fałszywy pozytyw).`);
  push('');
  for (const lr of layerResults) {
    push(`### ${lr.name}: ${lr.failures.length} przypadków z porażką`);
    push('');
    if (lr.failures.length === 0) {
      push(`Brak porażek.`);
      push('');
      continue;
    }
    const leaks = lr.failures.filter((f) => f.leaked.length > 0);
    const eats = lr.failures.filter((f) => f.eaten.length > 0);
    if (leaks.length > 0) {
      push(`**Wycieki (przeszło ${leaks.reduce((a, f) => a + f.leaked.length, 0)} elem. w ${leaks.length} przypadkach):**`);
      push('');
      for (const f of leaks) {
        push(`- \`${f.id}\` (${f.category}): przeszło ${f.leaked.map((s) => `„${s}"`).join(', ')}; tekst: _${f.text}_`);
      }
      push('');
    }
    if (eats.length > 0) {
      push(`**Nadmaskowania (zjedzono ${eats.reduce((a, f) => a + f.eaten.length, 0)} elem. w ${eats.length} przypadkach):**`);
      push('');
      for (const f of eats) {
        push(`- \`${f.id}\` (${f.category}): zjedzono ${f.eaten.map((s) => `„${s}"`).join(', ')}; wynik: _${f.redacted}_`);
      }
      push('');
    }
  }
  push(`## Uwagi`);
  push('');
  push(`- Kategoria **osoby-rzadkie-ner** to przypadki, w których rdzeń deterministyczny świadomie`);
  push(`  dopuszcza wyciek (nazwiska bez wyzwalacza i bez sufiksu -ski/-cki/-icz/-czyk oraz obce),`);
  push(`  więc recall rdzenia jest tu z założenia niski (bliski 0%). Ta kategoria mierzy przewagę`);
  push(`  warstwy NER: uruchom benchmark z modelem ONNX, aby zobaczyć wzrost recall bez spadku`);
  push(`  precyzji na negatywach.`);
  push(`- Warstwę **core+onnx (Node)** aktywujesz bez Dockera: \`npm i -D @huggingface/transformers\``);
  push(`  oraz rozpakuj model do \`scripts/benchmark/models/fastpdn/\` (albo wskaż \`ONNX_MODELS_DIR\`).`);
  push(`  Bez biblioteki/modelu warstwa jest pomijana (fail-safe), a raport pokazuje tylko rdzeń.`);
  push(`- Zbiór jest w pełni syntetyczny: wszystkie dane (PESEL-e, nazwiska, adresy) zostały`);
  push(`  wygenerowane albo wymyślone; nie zawierają danych rzeczywistych osób.`);
  push(`- Kolumna „Wynik ≠ core" pokazuje, w ilu przypadkach warstwa NER faktycznie zmieniła`);
  push(`  wynik względem czystego rdzenia. Wartość bliska zeru sugerowałaby, że usługa NER`);
  push(`  nie działała podczas pomiaru (fail-safe po cichu wraca do rdzenia).`);
  push(`- Usługi NER widzą tekst już po redakcji strukturalnej (PESEL/NIP/IBAN zamaskowane`);
  push(`  in-process), zgodnie z architekturą \`redactPIIFull\`.`);
  push(`- Metryka precision jest przybliżeniem (proxy): mierzy tylko zachowanie wskazanych`);
  push(`  podłańcuchów mustKeep, a nie wszystkich nie-PII tokenów w zdaniu.`);
  push('');
  return lines.join('\n');
}

main().catch((err) => {
  console.error('Benchmark zakończony błędem:', err);
  process.exit(1);
});
