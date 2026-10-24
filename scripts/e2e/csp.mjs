// Ścisłe sprawdzenie polityki CSP gotowych plików, dyrektywa po dyrektywie. Sam napis
// „default-src 'none'” i „connect-src 'none'” nie wystarcza: dopisany host w img-src, font-src
// albo script-src przeszedłby taki test, a obrazek z treścią pisma w adresie wychodzi do sieci
// tak samo jak fetch. Dlatego każde źródło w każdej dyrektywie musi być z krótkiej listy, a
// dyrektywy, które nie dziedziczą po default-src (form-action, base-uri), muszą stać jawnie.
//
// Używają go test E2E (smoke.test.mjs) i strażnik CSP w CI:
//   node scripts/e2e/csp.mjs            sprawdza apps/web/dist i apps/landing/dist
//   node scripts/e2e/csp.mjs web        tylko plik aplikacji
// Moduł nie ma zależności, więc działa też w jobie CI na Node 20.
//
// script-src nie może mieć 'unsafe-inline': dopuszczałoby każdy kod w linii, także procedurę
// onerror wstrzykniętą z treści pisma. W gotowym pliku stoją tam tylko skróty SHA-256, a strażnik
// liczy je od nowa z treści skryptów, niezależnie od wtyczki z apps/web/src/csp-skrot.ts.
// Wyjątek to strona bez żadnego skryptu (podstrona /log/ landingu): tam script-src 'none',
// a strażnik sprawdza, że w pliku naprawdę nie ma skryptu wykonywalnego.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Dyrektywy, które muszą mieć dokładnie 'none'. */
const MUST_BE_NONE = ['default-src', 'connect-src', 'form-action', 'base-uri', 'object-src'];

/** Źródła dozwolone w każdej dyrektywie poza script-src: nic z nich nie sięga poza plik. */
const ALLOWED_SOURCES = ["'none'", "'unsafe-inline'", 'data:'];

/** Jedyne źródło dozwolone w script-src: skrót SHA-256 skryptu zapisanego w pliku. */
const SHA256_SOURCE = /^'sha256-[A-Za-z0-9+/]{43}='$/;

/** Typy <script>, które przeglądarka wykonuje (application/ld+json i inne dane pomijamy). */
const EXECUTABLE = /^(?:module|importmap|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

/**
 * Skróty CSP skryptów wykonywalnych w HTML, liczone tak jak przeglądarka: treść między
 * znacznikami po zamianie CRLF na LF, bajty UTF-8.
 * @param {string} html
 */
export function scriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const type = m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (type && !EXECUTABLE.test(type)) continue;
    const body = m[2].replace(/\r\n?/g, '\n');
    out.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return out;
}

/**
 * Pliki i wyjątki od listy. Landing pokazuje obrazki z własnego katalogu (og.png, ikona), więc
 * ma img-src 'self'; aplikacja nie ma żadnego.
 */
export const CSP_TARGETS = {
  web: { file: path.join(ROOT, 'apps', 'web', 'dist', 'index.html'), extra: {} },
  landing: {
    file: path.join(ROOT, 'apps', 'landing', 'dist', 'index.html'),
    extra: { 'img-src': ["'self'"] },
  },
  // Podstrona „Zmiany i plan” (dziennik zmian i plan): bez skryptu, więc script-src 'none'.
  'landing-log': {
    file: path.join(ROOT, 'apps', 'landing', 'dist', 'log', 'index.html'),
    extra: { 'img-src': ["'self'"] },
  },
};

/**
 * Lista problemów z polityką (pusta = dobra).
 * @param {string} policy treść atrybutu content tagu meta
 * @param {Record<string, string[]>} [extra] dodatkowe źródła dozwolone w danej dyrektywie
 */
export function cspProblems(policy, extra = {}) {
  const problems = [];
  if (!policy.trim()) return ['brak polityki CSP'];
  const seen = new Map();
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
    if (!name) continue;
    const directive = name.toLowerCase();
    // Przeglądarka bierze pierwsze wystąpienie, a kolejne pomija. Powtórka to prawie zawsze
    // pomyłka przy edycji, po której łatwo czytać politykę nie tak, jak działa.
    if (seen.has(directive)) {
      problems.push(`${directive}: dyrektywa powtórzona`);
      continue;
    }
    seen.set(directive, sources);
    if (directive === 'script-src') {
      // strona bez skryptu: samo 'none', bez niczego obok
      if (sources.length === 1 && sources[0] === "'none'") continue;
      for (const s of sources) {
        if (!SHA256_SOURCE.test(s)) problems.push(`script-src: niedozwolone źródło ${s} (tylko 'sha256-…')`);
      }
      if (!sources.length) problems.push('script-src: bez źródeł');
      continue;
    }
    const allowed = [...ALLOWED_SOURCES, ...(extra[directive] ?? [])];
    for (const s of sources) {
      if (!allowed.includes(s.toLowerCase()))
        problems.push(`${directive}: niedozwolone źródło ${s}`);
    }
    if (sources.includes("'none'") && sources.length > 1) {
      problems.push(`${directive}: 'none' razem z innymi źródłami`);
    }
    if (!sources.length) problems.push(`${directive}: bez źródeł`);
  }
  if (!seen.has('script-src')) problems.push("script-src: brak (default-src 'none' zablokowałby skrypt pliku)");
  for (const d of MUST_BE_NONE) {
    const s = seen.get(d);
    if (!s || s.join(' ') !== "'none'")
      problems.push(`${d}: musi być 'none' (jest: ${s ? s.join(' ') : 'brak'})`);
  }
  return problems;
}

/**
 * Problemy z CSP w zbudowanym pliku HTML: dokładnie jeden tag meta, przed pierwszym skryptem
 * (polityka z meta obejmuje tylko to, co stoi po niej), ścisła treść, a w script-src dokładnie
 * skróty skryptów z pliku: zły skrót zatrzymałby całą aplikację, nadmiarowy niczego nie chroni.
 * @param {string} html
 * @param {Record<string, string[]>} [extra]
 */
export function htmlCspProblems(html, extra = {}) {
  const metas = [
    ...html.matchAll(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"[^>]*>/gi),
  ];
  if (metas.length === 0) return ['brak <meta http-equiv="Content-Security-Policy">'];
  const problems = [];
  if (metas.length > 1) problems.push(`tagów meta CSP jest ${metas.length}, ma być jeden`);
  const firstScript = html.search(/<script\b/i);
  if (firstScript !== -1 && metas[0].index > firstScript)
    problems.push('meta CSP stoi po pierwszym <script>');
  const policy = metas[0][1].replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const declared = policy.match(/(?:^|;)\s*script-src\s+([^;]*)/i)?.[1].trim().split(/\s+/) ?? [];
  const actual = scriptHashes(html);
  if (declared.length === 1 && declared[0] === "'none'") {
    // script-src 'none': żaden skrypt w pliku by nie ruszył, więc żadnego nie może tam być
    if (actual.length)
      problems.push(`script-src 'none', a w pliku jest skryptów: ${actual.length}`);
    return [...problems, ...cspProblems(policy, extra)];
  }
  if (!actual.length) problems.push('w pliku nie ma skryptu w linii');
  for (const h of actual) {
    if (!declared.includes(h)) problems.push(`script-src: brak skrótu skryptu z pliku ${h}`);
  }
  for (const h of declared) {
    if (SHA256_SOURCE.test(h) && !actual.includes(h))
      problems.push(`script-src: skrót ${h} nie pasuje do żadnego skryptu w pliku`);
  }
  return [...problems, ...cspProblems(policy, extra)];
}

// Wywołanie z wiersza poleceń (strażnik w CI).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  let failed = false;
  for (const name of names.length ? names : Object.keys(CSP_TARGETS)) {
    const target = CSP_TARGETS[name];
    if (!target) {
      console.error(`nieznany plik „${name}”, dostępne: ${Object.keys(CSP_TARGETS).join(', ')}`);
      process.exit(2);
    }
    const rel = path.relative(ROOT, target.file).replaceAll('\\', '/');
    const problems = htmlCspProblems(readFileSync(target.file, 'utf8'), target.extra);
    if (problems.length) {
      failed = true;
      for (const p of problems) console.error(`::error file=${rel}::CSP: ${p}`);
    } else {
      console.log(`${rel}: CSP w porządku`);
    }
  }
  process.exit(failed ? 1 : 0);
}
