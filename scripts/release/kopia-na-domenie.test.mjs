// Testy sprawdzenia kopii Parawan.html na domenie (kopia-na-domenie.mjs), na lokalnym serwerze
// HTTP zamiast parawan.karolwilczynski.com. Biegną w ci.yml razem z render-docs.test.mjs:
//   node --test scripts/release/kopia-na-domenie.test.mjs
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkCopy, sha256, sumFromSums, wrongSum } from './kopia-na-domenie.mjs';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'kopia-na-domenie.mjs');
const FILE = Buffer.from('<!doctype html><title>Parawan</title><p>kontakt: a@example.com</p>\n');
const SHA = sha256(FILE);
// Tak Cloudflare „Email Address Obfuscation” przepisuje adres e-mail w HTML-u.
const REWRITTEN = Buffer.from(
  '<!doctype html><title>Parawan</title><p>kontakt: <a href="/cdn-cgi/l/email-protection">[email protected]</a></p>\n',
);

/** Kolejne odpowiedzi serwera: [status, treść]; ostatnia powtarza się w nieskończoność. */
let answers = [[200, FILE]];
let hits = 0;
let base = '';
const server = createServer((_req, res) => {
  const [status, body] = answers[Math.min(hits++, answers.length - 1)];
  res.writeHead(status, { 'content-type': 'text/html' });
  res.end(body);
});
before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}/pobierz/Parawan.html`;
});
after(() => server.close());

const serve = (...a) => {
  answers = a;
  hits = 0;
};

/** Uruchamia skrypt jak w deploy-landing.yml i zwraca kod wyjścia i wydruk. */
const run = (...args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, base, ...args], (err, stdout, stderr) =>
      resolve({ code: err ? err.code : 0, out: stdout + stderr }),
    );
  });

test('suma z SHA256SUMS.txt w formacie sha256sum, także z CRLF i znakiem *', () => {
  const sums = `${'a'.repeat(64)}  JAK-UZYC.txt\r\n${SHA} *Parawan.html\r\n`;
  assert.equal(sumFromSums(sums, 'Parawan.html'), SHA);
  assert.throws(() => sumFromSums(sums, 'DLA-IOD-I-IT.txt'), /DLA-IOD-I-IT\.txt/);
  assert.notEqual(wrongSum(SHA), SHA);
  assert.equal(wrongSum(SHA).length, 64);
});

test('plik zgodny z wydaniem: skrypt kończy się kodem 0', async () => {
  serve([200, FILE]);
  const { code, out } = await run('--sha256', SHA, '--proby', '1');
  assert.equal(code, 0, out);
  assert.match(out, /plik zgodny z wydaniem/);
});

test('celowo zła suma (--zla-suma) wywraca krok', async () => {
  serve([200, FILE]);
  const { code, out } = await run('--sha256', SHA, '--proby', '2', '--odstep', '0', '--zla-suma');
  assert.equal(code, 1, out);
  assert.match(out, /::error::.*nie jest plikiem z wydania/);
  assert.equal(hits, 2, 'dwie próby');
});

test('HTML przepisany przez funkcję strefy Cloudflare wywraca krok', async () => {
  serve([200, REWRITTEN]);
  const { code, out } = await run('--sha256', SHA, '--proby', '1');
  assert.equal(code, 1, out);
  assert.match(out, /Email Address Obfuscation/);
});

test('404 i stara wersja z pamięci podręcznej: kolejna próba po odstępie przechodzi', async () => {
  serve([404, Buffer.from('nie ma')], [200, Buffer.from('stara wersja')], [200, FILE]);
  const log = [];
  const { ok, attempts } = await checkCopy(base, SHA, {
    tries: 5,
    delayMs: 0,
    log: (s) => log.push(s),
  });
  assert.ok(ok, log.join('\n'));
  assert.deepEqual(
    attempts.map((a) => a.status),
    [404, 200, 200],
  );
  assert.equal(attempts[2].sha, SHA);
});

test('brak sumy albo adresu: kod 2 z instrukcją użycia', async () => {
  const { code, out } = await run('--sha256', 'abc');
  assert.equal(code, 2, out);
  assert.match(out, /użycie/);
});
