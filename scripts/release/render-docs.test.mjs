// Testy skryptu plików wydania (render-docs.mjs). Biegną w ci.yml przed scaleniem, bo ręczne
// uruchomienie release.yml (dry_run) działa dopiero dla pliku obecnego na gałęzi domyślnej.
//   node --test scripts/release/render-docs.test.mjs
// Zamiast prawdziwego builda biorą mały plik HTML z tą samą polityką CSP co aplikacja, więc nie
// wymagają npm run build.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import {
  changelogSection,
  RenderError,
  releaseNotes,
  renderRelease,
  renderTemplate,
  urgencyOf,
  windowsText,
  wrapCsp,
} from './render-docs.mjs';

const CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; " +
  "font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const HTML =
  '<!doctype html><html lang="pl"><head><meta charset="UTF-8" />\n' +
  `    <meta http-equiv="Content-Security-Policy" content="${CSP}" />\n` +
  '<title>Parawan</title></head><body>Zażółć gęślą jaźń</body></html>\n';

const CHANGELOG = `# Changelog

## v9.9.10 — 2026-11-02

**Późniejsza wersja.**

Pilność: pilna

- Inna zmiana.

## v9.9.9 — 2026-11-01

**Nowy dokument z wyniku.**

Pilność: zalecana

- Pobierz .docx.
- Pliki dla IOD.

## v9.9.8 — 2026-10-01

Pilność: zwykła

- Starsza zmiana.
`;

const dir = mkdtempSync(path.join(tmpdir(), 'parawan-render-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const htmlPath = path.join(dir, 'index.html');
writeFileSync(htmlPath, HTML);
const changelogPath = path.join(dir, 'CHANGELOG.md');
writeFileSync(changelogPath, CHANGELOG);
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

function render(extra = {}) {
  const out = mkdtempSync(path.join(dir, 'out-'));
  const r = renderRelease({
    html: htmlPath,
    outDir: out,
    changelog: changelogPath,
    version: '9.9.9',
    date: '2026-11-01',
    ...extra,
  });
  return { out, r };
}

test('SHA256SUMS.txt w formacie sha256sum, sumy zgodne z crypto.createHash', () => {
  const { out } = render();
  const sums = readFileSync(path.join(out, 'SHA256SUMS.txt'), 'utf8');
  const lines = sums.trimEnd().split('\n');
  assert.deepEqual(
    lines.map((l) => l.split('  ')[1]),
    ['Parawan.html', 'JAK-UZYC.txt', 'DLA-IOD-I-IT.txt'],
  );
  for (const line of lines) {
    const [hash, name] = line.split('  ');
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hash, sha(readFileSync(path.join(out, name))), name);
  }
  assert.ok(sums.endsWith('\n') && !sums.includes('\r'));
  // Parawan.html w katalogu wydania to ten sam plik, bajt w bajt
  assert.deepEqual(readFileSync(path.join(out, 'Parawan.html')), readFileSync(htmlPath));
});

test('pliki .txt: BOM, CRLF, pola wypełnione, polskie litery w UTF-8', () => {
  const { out } = render();
  const hash = sha(readFileSync(htmlPath));
  for (const name of ['JAK-UZYC.txt', 'DLA-IOD-I-IT.txt']) {
    const buf = readFileSync(path.join(out, name));
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${name}: BOM`);
    const text = buf.toString('utf8').slice(1);
    assert.ok(!/[^\r]\n/.test(text), `${name}: każdy koniec wiersza to CRLF`);
    assert.ok(!text.includes('{{'), `${name}: niewypełnione pole`);
    assert.ok(text.includes('PARAWAN 9.9.9'), name);
    assert.ok(text.includes(hash), `${name}: suma pliku`);
    assert.ok(text.includes(String(Buffer.byteLength(HTML))), `${name}: rozmiar`);
    assert.ok(text.includes("connect-src 'none'"), `${name}: CSP z pliku`);
    assert.ok(text.includes('ą') || text.includes('ł'), `${name}: polskie litery`);
    for (const line of text.split('\r\n')) assert.ok([...line].length <= 78, line);
  }
  const dla = readFileSync(path.join(out, 'DLA-IOD-I-IT.txt'), 'utf8');
  assert.ok(dla.includes('Wydanie z 2026-11-01'));
  assert.ok(dla.includes('git clone --branch v9.9.9'));
});

test('opis wydania: właściwa sekcja CHANGELOG i pilność, bez „blokad firmowych”', () => {
  const { out, r } = render();
  assert.equal(r.urgency, 'zalecana');
  const notes = readFileSync(path.join(out, 'release-notes.md'), 'utf8');
  assert.ok(notes.startsWith('# Parawan 9.9.9\n'));
  assert.ok(notes.includes(`SHA-256 Parawan.html: \`${r.hash}\``));
  assert.ok(notes.includes('## Jak sprawdzić plik'));
  assert.ok(notes.includes('**Nowy dokument z wyniku.**'));
  assert.ok(notes.includes('- Pliki dla IOD.'));
  assert.ok(!notes.includes('Późniejsza wersja') && !notes.includes('Starsza zmiana'));
  assert.ok(notes.includes('**Pilność aktualizacji:** zalecana.'));
  assert.ok(!/^Pilność:/m.test(notes), 'surowa linia „Pilność:” nie powtarza się w opisie');
  for (const f of ['Parawan.html', 'JAK-UZYC.txt', 'DLA-IOD-I-IT.txt', 'SHA256SUMS.txt']) {
    assert.ok(notes.includes(`\`${f}\``), f);
  }
  // kolejność: suma, sprawdzenie, zmiany, pilność, pliki, dodatek AI na końcu
  const order = [
    'SHA-256 Parawan.html',
    '## Jak sprawdzić',
    '## Co się zmieniło',
    'Pilność aktualizacji',
    '## Pliki',
    'anonimizator-ai',
  ];
  const pos = order.map((s) => notes.indexOf(s));
  assert.deepEqual(
    [...pos].sort((a, b) => a - b),
    pos,
  );
  assert.ok(pos.every((p) => p >= 0));
  for (const bad of ['blokad', 'local-only', '100%']) assert.ok(!notes.includes(bad), bad);
});

test('sekcja ostatniej wersji w pliku sięga do końca, nagłówek nie łapie dłuższego numeru', () => {
  assert.match(changelogSection(CHANGELOG, '9.9.8'), /Starsza zmiana/);
  assert.match(changelogSection(CHANGELOG, '9.9.10'), /Późniejsza wersja/);
  // „## v9.9.10” nie jest sekcją wersji 9.9.1, a „## v9.9.9” wersji 9.9
  assert.throws(() => changelogSection(CHANGELOG, '9.9.1'), RenderError);
  assert.throws(() => changelogSection(CHANGELOG, '9.9'), RenderError);
  assert.equal(urgencyOf(changelogSection(CHANGELOG, '9.9.10')), 'pilna');
  assert.equal(urgencyOf('## v1.0.0\n\n**Pilność:** zwykła\n'), 'zwykła');
});

test('brak sekcji wersji albo linii „Pilność:” kończy się błędem', () => {
  assert.throws(() => render({ version: '9.9.7' }), /nie ma sekcji „## v9\.9\.7”/);
  const bez = path.join(dir, 'bez-pilnosci.md');
  writeFileSync(bez, '# Changelog\n\n## v9.9.9 — 2026-11-01\n\n- Zmiana bez pilności.\n');
  assert.throws(() => render({ changelog: bez }), /nie ma linii „Pilność: …”/);
  assert.throws(() => urgencyOf('Pilność: bardzo pilna\n'), RenderError);
  assert.throws(
    () => urgencyOf('Pilność: natychmiastowa\n'),
    /dozwolone są zwykła, zalecana albo pilna/,
  );
});

test('plik bez CSP albo z dyrektywą, której szablon nie opisuje, kończy się błędem', () => {
  const bezCsp = path.join(dir, 'bez-csp.html');
  writeFileSync(bezCsp, '<!doctype html><meta charset="UTF-8"><title>x</title>');
  assert.throws(() => render({ html: bezCsp }), /nie ma tagu meta z Content-Security-Policy/);
  const inna = path.join(dir, 'inna-csp.html');
  writeFileSync(inna, HTML.replace("object-src 'none'", "object-src 'none'; worker-src 'none'"));
  assert.throws(() => render({ html: inna }), /brak: worker-src/);
});

test('{{CSP}} łamane po dyrektywach z wcięciem wiersza, wiersz ponad 78 znaków to błąd', () => {
  const wrapped = wrapCsp(CSP, '    ');
  for (const line of wrapped.split('\n')) assert.ok(line.length <= 78);
  assert.equal(wrapped.replace(/\n {4}/g, ' '), CSP);
  assert.equal(
    renderTemplate('  {{CSP}}\nx {{WERSJA}}', { CSP, WERSJA: '1.2.3' }).split('\n')[0].slice(0, 20),
    "  default-src 'none'",
  );
  assert.throws(() => renderTemplate('{{NIEZNANE}}', {}), /nieznane pole/);
  assert.throws(() => renderTemplate(`${'x'.repeat(79)}\n`, {}), /dłuższy niż 78/);
  assert.deepEqual([...windowsText('a\nb')], [0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a, 0x62]);
  assert.ok(
    releaseNotes({ version: '1', hash: 'h', section: '## v1\nx', urgency: 'pilna' }).includes(
      'Podmień plik jak najszybciej',
    ),
  );
});

test('--proba bez wpisu w CHANGELOG daje pliki z zaślepką, wydanie z tagu nie ma tej furtki', () => {
  const { out, r } = render({ version: '9.9.7', trial: true });
  assert.equal(r.urgency, 'zwykła');
  const notes = readFileSync(path.join(out, 'release-notes.md'), 'utf8');
  assert.ok(notes.includes('próba: brak wpisu tej wersji w CHANGELOG.md'));
  assert.throws(() => render({ version: '9.9.7' }), RenderError);
});
