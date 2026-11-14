#!/usr/bin/env node
// Runner ewaluacji na zestawie test-data/anonimizator-testy (50 fikcyjnych pism).
//
// Przepuszcza pliki txt/ i docx/ przez ten sam silnik co aplikacja (rdzeń + czytnik docx
// z apps/web), zapisuje wyniki do test-data/wyniki/<wersja>/<profil>/<wejście>/<id>.txt
// i z opcją --eval uruchamia eval.py dla każdego katalogu.
//
// Użycie: node scripts/eval/run-eval.mjs [--eval] [--set KATALOG] [--out KATALOG] [--profile domyslny|pseudonimy]
// --set: inny zestaw o tym samym układzie (txt/, opcjonalnie docx/, ground_truth/); eval.py zawsze z
// test-data/anonimizator-testy, klucz z ground_truth/ wskazanego zestawu.
// Runner nie łączy się z siecią: fetch jest podmieniony na funkcję rzucającą błąd.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const blocked = () => {
  throw new Error('run-eval: dostęp do sieci jest zablokowany');
};
globalThis.fetch = blocked;
globalThis.XMLHttpRequest = undefined;
globalThis.WebSocket = undefined;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EVAL_PY = join(ROOT, 'test-data/anonimizator-testy/eval.py');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const SET = resolve(opt('--set') ?? join(ROOT, 'test-data/anonimizator-testy'));

const PROFILES = {
  domyslny: {}, // ustawienia aplikacji po pierwszym uruchomieniu: wszystkie typy, bez pseudonimów
  pseudonimy: { pseudonyms: true },
};

function version() {
  const v = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8')).version;
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--', 'packages/core/src', 'apps/web/src'], { cwd: ROOT })
      .toString()
      .trim();
    return `v${v}-${sha}${dirty ? '-dirty' : ''}`;
  } catch {
    return `v${v}`;
  }
}

async function loadEngine() {
  const { build } = await import('esbuild');
  const outfile = join(ROOT, 'node_modules/.cache/eval/engine.mjs');
  await build({
    entryPoints: [join(ROOT, 'scripts/eval/entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'warning',
  });
  return import(`${pathToFileURL(outfile).href}?t=${Date.now()}`);
}

function runEval(dir) {
  const r = spawnSync('python', [EVAL_PY, dir, '--gt', join(SET, 'ground_truth'), '--report', join(dir, 'raport')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`eval.py: ${r.stderr || r.stdout}`);
  const rep = JSON.parse(readFileSync(join(dir, 'raport.json'), 'utf8'));
  // eval.py uznaje za numerowane tylko znaczniki z cyfrą; etykiety [OSOBA-A] liczymy osobno.
  let lettered = 0;
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt') && !n.startsWith('raport'))) {
    lettered += (readFileSync(join(dir, f), 'utf8').match(/\[OSOBA-[A-Z]{1,3}\]/g) ?? []).length;
  }
  return { rep, lettered };
}

const engine = await loadEngine();
const setName = opt('--set') ? `-${SET.split(/[\\/]/).filter(Boolean).slice(-2).join('-')}` : '';
const out = resolve(opt('--out') ?? join(ROOT, 'test-data/wyniki', `${version()}${setName}`));
const profiles = opt('--profile') ? [opt('--profile')] : Object.keys(PROFILES);
const summary = [];

for (const profile of profiles) {
  const options = PROFILES[profile];
  if (!options) throw new Error(`Nieznany profil: ${profile}`);
  for (const input of ['txt', 'docx'].filter((i) => existsSync(join(SET, i)))) {
    const dir = join(out, profile, input);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const files = readdirSync(join(SET, input)).filter((n) => n.endsWith(`.${input}`)).sort();
    for (const name of files) {
      const buf = new Uint8Array(readFileSync(join(SET, input, name)));
      const text = input === 'docx' ? engine.extractDocxText(buf) : engine.decodeText(buf).text;
      const { redacted } = engine.redactPII(text, options);
      writeFileSync(join(dir, name.replace(/\.(txt|docx)$/, '.txt')), redacted, 'utf8');
    }
    if (flag('--eval')) {
      const { rep, lettered } = runEval(dir);
      summary.push({ profile, input, rep, lettered });
    }
  }
}

console.log(`Wyniki: ${out}`);
for (const { profile, input, rep, lettered } of summary) {
  const ph = rep.placeholders;
  console.log(
    `${profile}/${input}: recall ${(rep.recall * 100).toFixed(1)}% (${rep.mask_occurrences - rep.leaks_total}/${rep.mask_occurrences}), ` +
      `wycieki ${rep.leaks_total}, nadmiarowe ${rep.over_redacted}/${rep.keep_occurrences}, ` +
      `znaczniki: ${ph.numbered} z cyfrą, ${lettered} z literą, ${ph.plain - lettered} bez numeru`,
  );
}
