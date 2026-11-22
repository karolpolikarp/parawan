// Generuje src/regex-literals-table.ts: wyniki analizy napisów gwarancji dla każdego wyrażenia,
// o które pyta rdzeń, żeby start aplikacji nie parsował wzorców (Backlog 9, czas startu).
// Użycie (z katalogu repo): npm run build -w anonimizator && npm run gen:literals -w anonimizator
// Potem drugi build, bo tablica wchodzi do dist. Zgodność wpisów z analizą sprawdza
// src/regex-literals-table.test.ts.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, '..');
const ROOT = join(CORE, '..', '..');

const load = (...p) => import(pathToFileURL(join(...p)).href);
const { redactPII } = await load(CORE, 'dist', 'index.js');
const rl = await load(CORE, 'dist', 'regex-literals.js');
const { buildDataset } = await load(ROOT, 'scripts', 'benchmark', 'dataset.mjs');

/** Pliki .txt z test-data (pisma ewaluacyjne): szerszy przekrój pism niż benchmark. */
function txtFiles(dir) {
  const out = [];
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (n === 'wyniki' || n === 'node_modules') continue;
    if (statSync(p).isDirectory()) out.push(...txtFiles(p));
    else if (n.endsWith('.txt')) out.push(p);
  }
  return out;
}

const texts = [
  'Pacjent Jan Kowalski przyjmuje metforminę, leczony z powodu cukrzycy.',
  ...buildDataset().cases.map((c) => c.text),
  ...txtFiles(join(ROOT, 'test-data')).map((p) => readFileSync(p, 'utf8')),
];
for (const t of texts) {
  redactPII(t);
  redactPII(t, { pseudonyms: true });
}

const rows = [];
const seen = new Set();
for (const re of rl.analyzedPatterns()) {
  const key = rl.literalTableKey(re);
  if (seen.has(key)) continue;
  seen.add(key);
  const f = rl.analyzeFresh(re);
  const entry = f === null ? 0 : [f.n === Number.POSITIVE_INFINITY ? -1 : f.n, f.cls, f.set];
  rows.push([key, entry]);
}
rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const head = readFileSync(join(CORE, 'src', 'regex-literals-table.ts'), 'utf8').split('\nexport const LITERAL_TABLE')[0];
const body = rows.map(([k, e]) => `  ${JSON.stringify(k)}: ${JSON.stringify(e)},`).join('\n');
const src = `${head}\nexport const LITERAL_TABLE: Readonly<Record<string, LiteralTableEntry>> = {\n${body}\n};\n`;
writeFileSync(join(CORE, 'src', 'regex-literals-table.ts'), src);
console.log(`regex-literals-table.ts: ${rows.length} wyrażeń z ${texts.length} pism, ${Buffer.byteLength(src)} B`);
