// Pliki wydania z szablonów w docs/wydanie/. Wydanie dostaje Parawan.html, JAK-UZYC.txt,
// DLA-IOD-I-IT.txt, SHA256SUMS.txt i opis (release-notes.md), a teksty dla urzędnika i działu IT
// żyją w repo, gdzie widzi je test (apps/web/src/release-docs.test.ts), a nie w heredocu w YAML.
//
//   node scripts/release/render-docs.mjs apps/web/dist/index.html out
//   node scripts/release/render-docs.mjs <Parawan.html> <katalog> [--changelog <plik>]
//        [--wersja 0.46.25] [--data 2026-10-24] [--proba]
//
// Pola szablonów: {{WERSJA}} z apps/web/package.json, {{DATA}} z daty ostatniego commita
// (git log -1 --format=%cs, nie z zegara, więc dwa przebiegi z tego samego commita dają te same
// pliki), {{SHA256}} i {{ROZMIAR}} z gotowego pliku, {{CSP}} z tagu meta w gotowym pliku (to, co
// naprawdę egzekwuje przeglądarka, a nie tablica w vite.config.ts). Pliki .txt dostają BOM i
// końce wierszy CRLF: Notatnik czyta UTF-8 i bez tego, ale Word bez BOM pyta o kodowanie.
// Opis wydania bierze sekcję CHANGELOG.md tej wersji z linią „Pilność: …”; bez sekcji albo bez
// tej linii skrypt kończy się błędem, bo informatyk ocenia z opisu, czy aktualizacja jest pilna.
// Wyjątek: --proba (ręczne uruchomienie release.yml bez publikacji) wstawia wtedy zaślepkę.
// Bez zależności, więc działa na Node 20 w CI.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATES = path.join(ROOT, 'docs', 'wydanie');
export const DOCS = ['JAK-UZYC.txt', 'DLA-IOD-I-IT.txt'];
export const FIELDS = ['WERSJA', 'DATA', 'SHA256', 'ROZMIAR', 'CSP'];
/** Najdłuższy wiersz wypełnionego pliku: mieści się w Notatniku i na wydruku A4. */
export const MAX_LINE = 78;
export const URGENCY = {
  zwykła: 'zwykła. Zaktualizuj plik, kiedy będzie wygodnie.',
  zalecana: 'zalecana. Warto podmienić plik przy najbliższej okazji.',
  pilna:
    'pilna. Po tej poprawce Parawan zasłania coś, co wcześniej przepuszczał. ' +
    'Podmień plik jak najszybciej.',
};

export class RenderError extends Error {}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Treść atrybutu content tagu meta z Content-Security-Policy. */
export function cspFromHtml(html) {
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/)?.[1];
  if (!csp) throw new RenderError('w gotowym pliku nie ma tagu meta z Content-Security-Policy');
  return csp;
}

/** Polityka podzielona na wiersze po dyrektywach, każdy najwyżej `width` znaków z wcięciem. */
export function wrapCsp(csp, indent, width = MAX_LINE) {
  const parts = csp.split(/;\s*/).filter(Boolean);
  const lines = [];
  let cur = '';
  parts.forEach((p, i) => {
    const piece = p + (i < parts.length - 1 ? ';' : '');
    const next = cur ? `${cur} ${piece}` : piece;
    if (cur && indent.length + next.length > width) {
      lines.push(cur);
      cur = piece;
    } else cur = next;
  });
  if (cur) lines.push(cur);
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
}

/** Podstawia pola; {{CSP}} łamie po dyrektywach z wcięciem wiersza, w którym stoi. */
export function renderTemplate(tpl, fields) {
  const text = tpl.replace(/\r\n/g, '\n');
  const out = text.replace(/^([ \t]*)(.*)$/gm, (line, indent) =>
    line.replace(/\{\{([A-Z0-9]+)\}\}/g, (m, key) => {
      if (!(key in fields)) throw new RenderError(`nieznane pole ${m} w szablonie`);
      return key === 'CSP' ? wrapCsp(fields.CSP, indent) : String(fields[key]);
    }),
  );
  const long = out.split('\n').find((l) => l.length > MAX_LINE);
  if (long) throw new RenderError(`wiersz dłuższy niż ${MAX_LINE} znaków: ${long}`);
  return out;
}

/** UTF-8 z BOM i końcami CRLF: Word i Notatnik rozpoznają kodowanie bez pytania. */
export const windowsText = (text) =>
  Buffer.from('﻿' + text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');

/** Sekcja CHANGELOG.md tej wersji: od „## v{wersja}” do następnego nagłówka drugiego poziomu. */
export function changelogSection(md, version) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const head = new RegExp(`^## v${version.replace(/\./g, '\\.')}(\\s|$)`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) throw new RenderError(`CHANGELOG.md nie ma sekcji „## v${version}”`);
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n').trim();
}

/** Pilność z linii „Pilność: zwykła | zalecana | pilna” (także „**Pilność:** …”). */
export function urgencyOf(section) {
  const m = section.match(/^\**Pilność:\**\s*(\S+?)[.\s]*$/m);
  if (!m) throw new RenderError('sekcja CHANGELOG.md tej wersji nie ma linii „Pilność: …”');
  const value = m[1].toLowerCase();
  if (!(value in URGENCY)) {
    throw new RenderError(`„Pilność: ${m[1]}”: dozwolone są zwykła, zalecana albo pilna`);
  }
  return value;
}

/** Opis wydania na GitHubie (body_path w release.yml). */
export function releaseNotes({ version, hash, section, urgency }) {
  // nagłówek sekcji („## v0.46.25 — data”) zastępuje tytuł opisu, linia pilności idzie niżej
  const body = section
    .split('\n')
    .slice(1)
    .filter((l) => !/^\**Pilność:/.test(l))
    .join('\n')
    .trim();
  return [
    `# Parawan ${version}`,
    '',
    `SHA-256 Parawan.html: \`${hash}\``,
    '',
    '## Jak sprawdzić plik',
    '',
    '- PowerShell: `Get-FileHash .\\Parawan.html -Algorithm SHA256`',
    '- Wiersz poleceń Windows: `certutil -hashfile Parawan.html SHA256`',
    '- Linux albo Git Bash, w katalogu z pobranymi plikami: `sha256sum -c SHA256SUMS.txt`',
    '- Pochodzenie z GitHub Actions: `gh attestation verify Parawan.html --repo karolpolikarp/parawan`',
    `- Budowa z kodu: \`git clone --branch v${version} -c core.autocrlf=false ` +
      'https://github.com/karolpolikarp/parawan`, `npm ci`, `npm run build -w anonimizator-web`; ' +
      'plik `apps/web/dist/index.html` ma tę samą sumę.',
    '',
    '## Co się zmieniło',
    '',
    body,
    '',
    `**Pilność aktualizacji:** ${URGENCY[urgency]}`,
    '',
    '## Pliki',
    '',
    '- `Parawan.html`: aplikacja w jednym pliku. Otwórz ją podwójnym kliknięciem, bez instalacji.',
    '- `JAK-UZYC.txt`: krótka instrukcja dla pracownika, z uwagami przed publikacją w BIP.',
    '- `DLA-IOD-I-IT.txt`: informacja dla inspektora ochrony danych i działu IT.',
    '- `SHA256SUMS.txt`: sumy SHA-256 trzech plików wyżej.',
    '',
    'Wykrywanie rzadkich nazwisk modelem językowym to osobny dodatek dla programistów: ' +
      '[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai).',
    '',
  ].join('\n');
}

/** Dyrektywy opisane w szablonie DLA-IOD-I-IT.txt (wiersze „    nazwa wartość  opis”). */
export function describedDirectives(tpl) {
  return [...tpl.matchAll(/^ {4}([a-z]+-[a-z]+) [^ ].*? {2,}\S/gm)].map((m) => m[1]);
}

function commitDate() {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    throw new RenderError('nie udało się odczytać daty commita (git log); podaj --data RRRR-MM-DD');
  }
}

/**
 * Tworzy pliki wydania w `outDir` i zwraca ich opis. `opts`: html (ścieżka gotowego pliku),
 * outDir, changelog (ścieżka), version, date, templatesDir, trial (próba bez wpisu w CHANGELOG).
 */
export function renderRelease(opts) {
  const htmlBuf = readFileSync(opts.html);
  const html = htmlBuf.toString('utf8');
  const version =
    opts.version ??
    JSON.parse(readFileSync(path.join(ROOT, 'apps', 'web', 'package.json'), 'utf8')).version;
  const date = opts.date ?? commitDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RenderError(`zła data „${date}”`);
  const csp = cspFromHtml(html);
  const hash = sha256(htmlBuf);
  const fields = { WERSJA: version, DATA: date, SHA256: hash, ROZMIAR: htmlBuf.length, CSP: csp };

  const changelog = readFileSync(opts.changelog ?? path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  let section;
  let urgency;
  try {
    section = changelogSection(changelog, version);
    urgency = urgencyOf(section);
  } catch (e) {
    // Próba (release.yml z dry_run) sprawdza build i szablony, zanim powstanie wpis w CHANGELOG
    // nowej wersji. Wydanie z tagu nie ma tej furtki.
    if (!opts.trial || !(e instanceof RenderError)) throw e;
    console.warn(`render-docs (próba): ${e.message}; opis wydania dostaje zaślepkę`);
    section = `## v${version}

(próba: brak wpisu tej wersji w CHANGELOG.md)`;
    urgency = 'zwykła';
  }

  const tplDir = opts.templatesDir ?? TEMPLATES;
  const files = { 'Parawan.html': htmlBuf };
  for (const name of DOCS) {
    const tpl = readFileSync(path.join(tplDir, name), 'utf8');
    if (name === 'DLA-IOD-I-IT.txt') {
      // opis dyrektyw w szablonie ma pokrywać politykę z gotowego pliku, nie starszą
      const built = csp
        .split(/;\s*/)
        .filter(Boolean)
        .map((d) => d.split(/\s+/)[0]);
      const described = describedDirectives(tpl);
      const missing = built.filter((d) => !described.includes(d));
      const extra = described.filter((d) => !built.includes(d));
      if (missing.length || extra.length) {
        throw new RenderError(
          `opis CSP w ${name} nie zgadza się z plikiem (brak: ${missing.join(', ') || '-'}; ` +
            `nadmiar: ${extra.join(', ') || '-'})`,
        );
      }
    }
    files[name] = windowsText(renderTemplate(tpl, fields));
  }
  const sums = Object.entries(files)
    .map(([name, buf]) => `${sha256(buf)}  ${name}\n`)
    .join('');

  mkdirSync(opts.outDir, { recursive: true });
  for (const [name, buf] of Object.entries(files)) writeFileSync(path.join(opts.outDir, name), buf);
  writeFileSync(path.join(opts.outDir, 'SHA256SUMS.txt'), sums);
  writeFileSync(
    path.join(opts.outDir, 'release-notes.md'),
    releaseNotes({ version, hash, section, urgency }),
  );
  return { version, date, hash, size: htmlBuf.length, urgency, sums };
}

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--changelog') opts.changelog = argv[++i];
    else if (a === '--wersja') opts.version = argv[++i];
    else if (a === '--data') opts.date = argv[++i];
    else if (a === '--proba') opts.trial = true;
    else pos.push(a);
  }
  if (pos.length !== 2) {
    throw new RenderError(
      'użycie: node scripts/release/render-docs.mjs <Parawan.html> <katalog> ' +
        '[--changelog <plik>] [--wersja X.Y.Z] [--data RRRR-MM-DD] [--proba]',
    );
  }
  return { ...opts, html: pos[0], outDir: pos[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = renderRelease(parseArgs(process.argv.slice(2)));
    console.log(`Parawan ${r.version} (${r.date}), pilność: ${r.urgency}`);
    console.log(`SHA-256 Parawan.html: ${r.hash} (${r.size} bajtów)`);
    process.stdout.write(r.sums);
  } catch (e) {
    console.error(`render-docs: ${e instanceof RenderError ? e.message : e}`);
    process.exit(1);
  }
}
