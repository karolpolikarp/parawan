// Dwa buildy aplikacji z tego samego commita muszą dać ten sam plik. Obiecuje to DLA-IOD-I-IT.txt
// („budowa z tagu daje plik o tej samej sumie”), a release.yml sprawdza to przed publikacją.
// Tu łapiemy wcześniej to, co psuje powtarzalność: datę w nagłówku (__BUILD_DATE__ z
// apps/web/vite.config.ts) brała z zegara zamiast z commita, a ta sama data idzie do {{DATA}}
// w plikach wydania (render-docs.mjs). Build trwa ok. 1 s.
// Uruchomienie: node --test scripts/release/powtarzalnosc.test.mjs (krok w ci.yml).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = path.join(ROOT, 'apps', 'web');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

/** Build aplikacji do `out` i jej treść. */
function build(out, env = {}) {
  execFileSync(process.execPath, [VITE, 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: WEB,
    env: { ...process.env, NODE_ENV: 'production', ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return readFileSync(path.join(out, 'index.html'));
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

test('dwa buildy z tego samego commita mają identyczną sumę SHA-256 i datę commita', () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'parawan-build-'));
  try {
    const a = build(path.join(tmp, 'a'));
    // drugi build w innej strefie czasowej i z inną datą w SOURCE_DATE_EPOCH: commit wygrywa
    const b = build(path.join(tmp, 'b'), { TZ: 'Pacific/Kiritimati', SOURCE_DATE_EPOCH: '0' });
    assert.equal(sha(a), sha(b));
    const date = execFileSync('git', ['log', '-1', '--format=%cs'], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/);
    // minifikator zapisuje napis w odwrotnych apostrofach albo cudzysłowach
    assert.match(a.toString('utf8'), new RegExp(`[\`"']${date}[\`"']`), `w pliku brak daty commita ${date}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
