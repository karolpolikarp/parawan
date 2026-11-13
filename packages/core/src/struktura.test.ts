import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import * as core from './index';

const SRC = dirname(fileURLToPath(import.meta.url));

test('publiczne API rdzenia: stały zbiór eksportów', () => {
  expect(Object.keys(core).sort()).toEqual([
    'LEGAL_ENTITY_WORDS',
    'NON_PERSON_CONTEXT',
    'describeFindings',
    'hasPII',
    'isValidCard',
    'isValidDowod',
    'isValidIban',
    'isValidKw',
    'isValidNip',
    'isValidNpwz',
    'isValidPesel',
    'isValidRegon14',
    'isValidRegon9',
    'redactPII',
  ]);
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__snapshots__' ? [] : sourceFiles(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

const graph = new Map<string, string[]>();
for (const file of sourceFiles(SRC)) {
  const deps = [...readFileSync(file, 'utf8').matchAll(/from '(\.{1,2}\/[^']+)\.js'/g)].map((m) => resolve(dirname(file), `${m[1]}.ts`));
  graph.set(file, deps);
}

// Osobne punkty wejścia paczki (`anonimizator/ner`, `/llm`) korzystają z redactPII przez index.
const ENTRYPOINTS = ['index.ts', 'ner-client.ts', 'llm-client.ts'].map((f) => join(SRC, f));

test('moduły wewnętrzne nie importują punktu wejścia', () => {
  const entry = join(SRC, 'index.ts');
  const offenders = [...graph].filter(([f, deps]) => !ENTRYPOINTS.includes(f) && deps.includes(entry)).map(([f]) => relative(SRC, f));
  expect(offenders).toEqual([]);
});

test('graf importów rdzenia bez cykli', () => {
  const state = new Map<string, 'w toku' | 'gotowe'>();
  const cycles: string[] = [];
  const visit = (f: string, path: string[]) => {
    if (state.get(f) === 'gotowe') return;
    if (state.get(f) === 'w toku') {
      cycles.push([...path.slice(path.indexOf(f)), f].map((p) => relative(SRC, p)).join(' → '));
      return;
    }
    state.set(f, 'w toku');
    for (const d of graph.get(f) ?? []) visit(d, [...path, f]);
    state.set(f, 'gotowe');
  };
  for (const f of graph.keys()) visit(f, []);
  expect(cycles).toEqual([]);
});
