// Strażnik tekstu gotowych plików: API, którymi strona wysyła dane albo uruchamia kod poza swoim
// wątkiem, nie mają prawa stać w aplikacji ani na stronie produktu. Najważniejsze jest WebRTC
// (RTCPeerConnection, RTCDataChannel): CSP go nie obejmuje, więc połączenie UDP wyszłoby
// z przeglądarki mimo default-src 'none', a zdarzenia sieci w Playwright go nie widzą. Reszta
// (sendBeacon, EventSource, WebTransport, workery) podlega CSP, ale w tym pliku też nie ma po co
// jej używać, a obca biblioteka, która ją przyniesie, ma się pokazać przy przeglądzie zmian.
// Bramka E2E (helpers.mjs) łapie dodatkowo każdą próbę utworzenia RTCPeerConnection w czasie
// testu, także zapisaną tak, że tego tekstu w pliku nie widać.
//
// Używają go test E2E (zakazane-api.test.mjs) i strażnik w CI, obok csp.mjs:
//   node scripts/e2e/zakazane-api.mjs            sprawdza apps/web/dist i apps/landing/dist
//   node scripts/e2e/zakazane-api.mjs landing    tylko stronę produktu
// Moduł nie ma zależności, więc działa też w jobie CI na Node 20.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Zakazane napisy: nazwa w raporcie i wyrażenie (globalne). */
export const FORBIDDEN_APIS = [
  { name: 'RTCPeerConnection', re: /RTCPeerConnection/g }, // też webkitRTCPeerConnection
  { name: 'RTCDataChannel', re: /RTCDataChannel/g },
  { name: 'sendBeacon', re: /sendBeacon/g }, // navigator.sendBeacon i n.sendBeacon po minifikacji
  { name: 'EventSource', re: /EventSource/g },
  { name: 'WebTransport', re: /WebTransport/g },
  { name: 'new Worker(', re: /\bnew\s+(?:[\w$]+\.)*Worker\s*\(/g }, // też new self.Worker(
  { name: 'SharedWorker', re: /SharedWorker/g },
  { name: 'serviceWorker', re: /serviceWorker/g }, // navigator.serviceWorker.register
];

/**
 * Wyjątek z pdf.js (6.x, wersja legacy) w pliku aplikacji: klasa PDFWorker tworzy workera
 * `new Worker(workerSrc, { type: 'module' })`, gdy nie ma workera w głównym wątku. pdf.ts podstawia
 * globalThis.pdfjsWorker (fake worker), więc pdf.js idzie inną gałęzią i ta linia się nie
 * wykonuje. Gdyby się wykonała, worker z adresu `./pdf.worker.mjs` albo z blob: zatrzyma CSP
 * (worker-src dziedziczy po script-src i default-src, żadna nie dopuszcza adresu ani blob:),
 * a bramka E2E zobaczy naruszenie CSP. Rozpoznajemy go po napisach pdf.js wokół tego miejsca, które
 * przeżywają minifikację (nazwy właściwości i komunikat błędu), w oknie znaków przed i za.
 * Liczba wystąpień jest ścisła: drugie `new Worker(` w pdf.js albo zniknięcie tego wymaga
 * ponownego przejrzenia wyjątku przy aktualizacji pdfjs-dist.
 */
export const PDFJS_WORKER = {
  api: 'new Worker(',
  what: 'pdf.js: PDFWorker bez workera w głównym wątku (pdf.ts podstawia fake workera)',
  before: ['_isSameOrigin(window.location', '_createCDNWrapper(new URL('],
  after: ['Worker was destroyed'],
  window: 400,
  count: 1,
};

/** Pliki i dopuszczone wyjątki. Strona produktu nie ma pdf.js, więc nie ma też wyjątku. */
export const API_TARGETS = {
  web: { file: path.join(ROOT, 'apps', 'web', 'dist', 'index.html'), allow: [PDFJS_WORKER] },
  landing: { file: path.join(ROOT, 'apps', 'landing', 'dist', 'index.html'), allow: [] },
};

/**
 * Lista problemów w tekście pliku (pusta = w porządku).
 * @param {string} html
 * @param {typeof PDFJS_WORKER[]} [allow] dopuszczone wystąpienia
 */
export function forbiddenApiProblems(html, allow = []) {
  const problems = [];
  const used = new Map(allow.map((a) => [a, 0]));
  for (const { name, re } of FORBIDDEN_APIS) {
    for (const m of html.matchAll(re)) {
      const at = m.index;
      const ok = allow.find(
        (a) =>
          a.api === name &&
          a.before.every((s) => html.slice(Math.max(0, at - a.window), at).includes(s)) &&
          a.after.every((s) => html.slice(at, at + a.window).includes(s)),
      );
      if (ok) {
        used.set(ok, used.get(ok) + 1);
        continue;
      }
      const ctx = html.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ');
      problems.push(`${name} na pozycji ${at}: „…${ctx}…”`);
    }
  }
  for (const [a, n] of used) {
    if (n !== a.count) {
      problems.push(
        `wyjątek „${a.what}”: ${n} wystąpień ${a.api}, oczekiwane ${a.count}; przejrzyj go na nowo`,
      );
    }
  }
  return problems;
}

// Wywołanie z wiersza poleceń (strażnik w CI).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2);
  let failed = false;
  for (const name of names.length ? names : Object.keys(API_TARGETS)) {
    const target = API_TARGETS[name];
    if (!target) {
      console.error(`nieznany plik „${name}”, dostępne: ${Object.keys(API_TARGETS).join(', ')}`);
      process.exit(2);
    }
    const rel = path.relative(ROOT, target.file).replaceAll('\\', '/');
    const problems = forbiddenApiProblems(readFileSync(target.file, 'utf8'), target.allow);
    if (problems.length) {
      failed = true;
      for (const p of problems) console.error(`::error file=${rel}::zakazane API: ${p}`);
    } else {
      console.log(`${rel}: bez WebRTC, sendBeacon, EventSource, WebTransport i workerów`);
    }
  }
  process.exit(failed ? 1 : 0);
}
