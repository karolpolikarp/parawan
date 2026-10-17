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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Dyrektywy, które muszą mieć dokładnie 'none'. */
const MUST_BE_NONE = ['default-src', 'connect-src', 'form-action', 'base-uri', 'object-src'];

/** Źródła dozwolone w każdej dyrektywie: nic z nich nie sięga poza plik. */
const ALLOWED_SOURCES = ["'none'", "'unsafe-inline'", 'data:'];

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
  for (const d of MUST_BE_NONE) {
    const s = seen.get(d);
    if (!s || s.join(' ') !== "'none'")
      problems.push(`${d}: musi być 'none' (jest: ${s ? s.join(' ') : 'brak'})`);
  }
  return problems;
}

/**
 * Problemy z CSP w zbudowanym pliku HTML: dokładnie jeden tag meta, przed pierwszym skryptem
 * (polityka z meta obejmuje tylko to, co stoi po niej), i ścisła treść.
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
  return [
    ...problems,
    ...cspProblems(metas[0][1].replace(/&#39;/g, "'").replace(/&quot;/g, '"'), extra),
  ];
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
