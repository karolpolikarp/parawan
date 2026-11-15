// Pomiar czasu startu gotowego pliku (Parawan.html) przez file:// w Chromium z Playwright,
// z dławieniem CPU przez CDP jako modelem słabego komputera. Opis modelu, kalibracji i progów:
// scripts/perf/README.md.
//
//   node scripts/perf/start.mjs <plik> [--rate 4] [--runs 5] [--json]
//       pomiar jednego pliku na tym komputerze, bez kotwicy i bez sieci;
//   node scripts/perf/start.mjs <plik> --kotwica <Parawan.html z wydania> [--kalibracja <json>]
//       bramka: kalibracja szybkości maszyny na kotwicy, przeplatane pary kotwica/plik i progi
//       (to samo robi npm run perf z PARAWAN_KOTWICA). Kod wyjścia 1, gdy bramka nie przechodzi.
//
// Mierzymy trzy chwile od początku nawigacji: „widać interfejs” (koniec skryptu startu),
// LCP (największy element treści na ekranie) i „gotowe” (silnik rozgrzany, pierwsze wklejenie
// liczy się tak szybko jak następne). Plik od tej wersji ma znaczniki performance.mark
// „parawan:ui” i „parawan:gotowe” (apps/web/src/main.ts). Starsze wydania (kotwica v0.47.0) ich
// nie mają, więc obok znaczników zawsze liczymy to samo z zewnątrz („obserwator”): moment
// zniknięcia #boot-fail i pierwsze zadanie po rozgrzewce z setTimeout. Porównanie dwóch plików
// używa metody, którą mają oba.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KALIBRACJA_JSON = path.join(HERE, 'kalibracja.json');

/**
 * Mnożnik dławienia CPU, którym Lighthouse w profilu mobilnym zamienia typowy komputer
 * w urządzenie „średniej klasy”: https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md.
 * Utożsamienie ×4 ze starym komputerem urzędowym to założenie (bez pomiaru takiego sprzętu).
 */
export const CPU_RATE = 4;
/**
 * Próg „dobry” LCP z Core Web Vitals: https://web.dev/articles/lcp. Google liczy go na 75. percentylu
 * w terenie, tu jest pożyczony do pomiaru laboratoryjnego (założenie).
 */
export const LCP_BUDGET_MS = 2500;
/**
 * Model RAIL, „Load”: strona interaktywna w mniej niż 5 s na urządzeniu średniej klasy:
 * https://web.dev/articles/rail. Granica utrzymania uwagi to 10 s
 * (https://www.nngroup.com/articles/response-times-3-important-limits/); 5 s, bo urzędnik otwiera
 * plik w trakcie pracy, jak dokument (założenie).
 */
export const READY_BUDGET_MS = 5000;
/**
 * Próg względny wobec kotwicy: błąd tylko, gdy start wolniejszy o więcej niż 20% ORAZ o więcej niż
 * 300 ms. Założenie: zmiana poniżej ok. 20% leży w granicy szumu pomiaru. Nie zmierzone na runnerach
 * GitHuba (2026-11-15), dlatego job „start” w ci.yml jest na razie nieblokujący (continue-on-error)
 * i zapisuje współczynnik zmienności do podsumowania. Po ok. 10 przebiegach z CV ≤ 5% bramka
 * staje się blokująca; przy większym CV MAX_RATIO = 1 + 4×CV albo rezygnacja z progu względnego.
 * Założenie: margines co najmniej 4 odchyleń standardowych (20% to 4σ przy CV 5%), a 10 próbek
 * szacuje odchylenie z błędem ok. 24%. Uzasadnienie: scripts/perf/README.md, „Zmienność (CV)”.
 */
export const MAX_RATIO = 1.2;
export const MIN_DELTA_MS = 300;
/** Par kotwica/plik w bramce (przeplot A, B, A, B znosi dryf szybkości maszyny). Założenie. */
export const PAIRS = 7;
/** Przebiegi kotwicy bez dławienia do kalibracji szybkości maszyny. Założenie. */
export const CALIBRATION_RUNS = 3;
/**
 * Pierwszy przebieg po uruchomieniu przeglądarki bywa dwa razy wolniejszy (zimny proces i pamięć
 * podręczna dysku; pomiar 2026-11-15: 970 ms wobec 516–521 ms przy ×1), więc jeden przebieg
 * rozgrzewkowy przed pomiarem odrzucamy.
 */
const WARMUP_RUNS = 1;
/** Najdłuższe czekanie na „gotowe” w jednym przebiegu. */
const RUN_TIMEOUT_MS = 60_000;

// Wstrzykiwane przed pierwszym skryptem strony. Liczy chwile „z zewnątrz” (dla plików bez
// znaczników) i zbiera LCP oraz FCP z buforowanych wpisów wydajności.
function probe() {
  const t = { lcp: null, fcp: null, uiObs: null, gotoweObs: null };
  Object.defineProperty(window, '__parawanStart', { value: t });
  const mo = new MutationObserver(() => {
    if (t.uiObs != null || document.readyState === 'loading') return;
    if (!document.getElementById('input') || document.getElementById('boot-fail')) return;
    t.uiObs = performance.now();
    mo.disconnect();
    // Rozgrzewka (setTimeout(warmEngine, 0) w main.ts) stoi w kolejce przed tym zadaniem.
    setTimeout(() => {
      t.gotoweObs = performance.now();
    }, 0);
  });
  mo.observe(document, { childList: true, subtree: true });
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) t.lcp = Math.max(t.lcp ?? 0, e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.name === 'first-contentful-paint') t.fcp = e.startTime;
    }).observe({ type: 'paint', buffered: true });
  } catch {
    // przeglądarka bez tych wpisów: LCP i FCP zostają puste
  }
}

/** Jeden przebieg w świeżym kontekście przeglądarki. Czasy w ms od początku nawigacji. */
export async function measureOnce(browser, file, rate) {
  const context = await browser.newContext({
    locale: 'pl-PL',
    viewport: { width: 1366, height: 768 },
  });
  try {
    await context.addInitScript(probe);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const cdp = await context.newCDPSession(page);
    // Dławienie przed nawigacją: parsowanie i skrypt startu też liczą się na wolnym CPU.
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'commit', timeout: RUN_TIMEOUT_MS });
    await page.waitForFunction(() => window.__parawanStart?.gotoweObs != null, null, {
      timeout: RUN_TIMEOUT_MS,
      polling: 50,
    });
    // Dwie klatki na dopisanie ostatniego kandydata LCP.
    const r = await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const mark = (n) => performance.getEntriesByName(n, 'mark')[0]?.startTime ?? null;
              resolve({
                ...window.__parawanStart,
                uiMark: mark('parawan:ui'),
                gotoweMark: mark('parawan:gotowe'),
              });
            }),
          ),
        ),
    );
    if (errors.length) throw new Error(`${file}: wyjątek na stronie: ${errors[0]}`);
    return r;
  } finally {
    await context.close();
  }
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** Współczynnik zmienności (odchylenie standardowe próby / średnia). */
export const cv = (xs) => {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return sd / mean;
};

/** „znacznik”, gdy każdy przebieg ma oba znaczniki, inaczej „obserwator”. */
export const methodOf = (runs) =>
  runs.every((r) => r.uiMark != null && r.gotoweMark != null) ? 'znacznik' : 'obserwator';

/** Wartości jednej chwili ze wszystkich przebiegów danej metody. */
export function values(runs, metric, method) {
  if (metric === 'lcp' || metric === 'fcp')
    return runs.map((r) => r[metric]).filter((v) => v != null);
  const key = `${metric}${method === 'znacznik' ? 'Mark' : 'Obs'}`;
  return runs.map((r) => r[key]);
}

/** Mediana, rozrzut i CV każdej chwili. */
export function summarize(runs, method = methodOf(runs)) {
  const out = { metoda: method, przebiegi: runs.length };
  for (const metric of ['ui', 'fcp', 'lcp', 'gotowe']) {
    const v = values(runs, metric, method);
    out[metric] = v.length
      ? {
          mediana: Math.round(median(v)),
          min: Math.round(Math.min(...v)),
          max: Math.round(Math.max(...v)),
          cv: +cv(v).toFixed(3),
        }
      : null;
  }
  return out;
}

/** Pomiar jednego pliku: `runs` przebiegów przy dławieniu `rate`. */
export async function measureStart(file, { rate = CPU_RATE, runs = 5, browser } = {}) {
  const own = !browser;
  const b = browser ?? (await chromium.launch());
  try {
    for (let i = 0; i < WARMUP_RUNS; i++) await measureOnce(b, file, rate);
    const list = [];
    for (let i = 0; i < runs; i++) list.push(await measureOnce(b, file, rate));
    return { plik: file, rate, ...summarize(list), runs: list };
  } finally {
    if (own) await b.close();
  }
}

/**
 * Mnożnik dławienia dla tej maszyny: taki, przy którym kotwica startuje tak, jak przy CPU_RATE na
 * komputerze odniesienia (wzorowane na „benchmark index” z Lighthouse). Ograniczony do 1…CPU_RATE:
 * na maszynie wolniejszej od odniesienia dławimy mniej, a powyżej ×4 dławienie bywa nieliniowe
 * (pomiar 2026-11-15: przy ×6 rozgrzewka 15× wolniejsza niż przy ×1, przy ×4 5,5×).
 */
export function calibrateRate(refX1Ms, hereX1Ms, base = CPU_RATE) {
  const r = (base * refX1Ms) / hereX1Ms;
  return Math.round(Math.min(base, Math.max(1, r)) * 100) / 100;
}

/** Chwile mierzone przy starcie, w kolejności. */
export const METRICS = ['ui', 'lcp', 'gotowe'];
const LABEL = { ui: 'widać interfejs', lcp: 'LCP', gotowe: '„gotowe”' };
/** Progi bezwzględne na komputerze odniesienia. */
export const BUDGETS = { lcp: LCP_BUDGET_MS, gotowe: READY_BUDGET_MS };

/**
 * Ocena bramki z median tej maszyny. Szacunek dla komputera odniesienia dla każdej chwili:
 * B_ref = B_tu × (A_ref / A_tu), gdzie A_ref to kotwica zmierzona na komputerze odniesienia
 * (kalibracja.json, pola <chwila>_x4_ms). Kalibracja mnożnika i ta proporcja zabezpieczają się
 * nawzajem. Próg względny dotyczy tylko chwil z kal.porownanie: chwila znaczy to samo w kotwicy
 * i w pliku tylko wtedy, gdy oba robią przy starcie tę samą pracę (patrz README).
 * @param {{ a: Record<string, number|null>, b: Record<string, number|null>,
 *   kal: Record<string, unknown> & { porownanie: string[] } }} m
 */
export function evaluate({ a, b, kal }) {
  const ref = {};
  const ratio = {};
  const deltaRef = {};
  const problems = [];
  for (const m of METRICS) {
    const refA = kal[`${m}_x4_ms`];
    if (a[m] == null || b[m] == null || !a[m] || typeof refA !== 'number') {
      ref[m] = ratio[m] = deltaRef[m] = null;
      if (m in BUDGETS || kal.porownanie.includes(m)) problems.push(`brak pomiaru: ${LABEL[m]}`);
      continue;
    }
    ratio[m] = b[m] / a[m];
    ref[m] = b[m] * (refA / a[m]);
    deltaRef[m] = ref[m] - refA;
    if (m in BUDGETS && ref[m] > BUDGETS[m]) {
      problems.push(
        `${LABEL[m]} ${Math.round(ref[m])} ms na komputerze odniesienia, próg ${BUDGETS[m]} ms`,
      );
    }
    if (kal.porownanie.includes(m) && ratio[m] > MAX_RATIO && deltaRef[m] > MIN_DELTA_MS) {
      problems.push(
        `${LABEL[m]} ${ratio[m].toFixed(2)}× wolniej niż kotwica (+${Math.round(deltaRef[m])} ms), ` +
          `próg ${MAX_RATIO}× i ${MIN_DELTA_MS} ms`,
      );
    }
  }
  return { ref, ratio, deltaRef, problems };
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Jeden pełny pomiar bramki: kalibracja na kotwicy, potem przeplatane pary. */
async function gateOnce(browser, { anchor, file, kal, pairs }) {
  for (let i = 0; i < WARMUP_RUNS; i++) await measureOnce(browser, anchor, 1);
  const cal = [];
  for (let i = 0; i < CALIBRATION_RUNS; i++) cal.push(await measureOnce(browser, anchor, 1));
  const calMethod = methodOf(cal);
  if (calMethod !== kal.metoda) {
    throw new Error(
      `kotwica zmierzona metodą „${calMethod}”, a kalibracja.json ma „${kal.metoda}”`,
    );
  }
  const hereX1 = median(values(cal, 'gotowe', calMethod));
  const rate = calibrateRate(kal.gotowe_x1_ms, hereX1);
  const runsA = [];
  const runsB = [];
  for (let i = 0; i < pairs; i++) {
    runsA.push(await measureOnce(browser, anchor, rate));
    runsB.push(await measureOnce(browser, file, rate));
  }
  // Ta sama metoda dla obu plików: kotwica bez znaczników wymusza obserwatora.
  const method =
    methodOf(runsA) === 'znacznik' && methodOf(runsB) === 'znacznik' ? 'znacznik' : 'obserwator';
  const A = summarize(runsA, method);
  const B = summarize(runsB, method);
  const med = (S) => Object.fromEntries(METRICS.map((m) => [m, S[m]?.mediana ?? null]));
  const ev = evaluate({ a: med(A), b: med(B), kal });
  return { hereX1: Math.round(hereX1), rate, method, A, B, ...ev };
}

/**
 * Bramka czasu startu. Gdy pomiar nie przejdzie, powtarza się raz w całości, a błąd jest dopiero
 * po dwóch nieudanych pomiarach z rzędu. Asercja się nie zmienia: to procedura pomiaru, która
 * odsiewa pojedynczy przebieg zakłócony przez inny proces na maszynie.
 */
export async function gate({ anchor, file, kal = readKalibracja(), pairs = PAIRS }) {
  const sum = sha256(anchor);
  if (sum !== kal.sha256)
    throw new Error(
      `kotwica ${anchor} ma sumę ${sum}, kalibracja.json: ${kal.sha256} (${kal.kotwica})`,
    );
  const browser = await chromium.launch();
  try {
    const attempts = [await gateOnce(browser, { anchor, file, kal, pairs })];
    if (attempts[0].problems.length)
      attempts.push(await gateOnce(browser, { anchor, file, kal, pairs }));
    const last = attempts[attempts.length - 1];
    return { kal, attempts, problems: last.problems, ok: last.problems.length === 0 };
  } finally {
    await browser.close();
  }
}

export function readKalibracja(file = KALIBRACJA_JSON) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Podsumowanie bramki w Markdown (do $GITHUB_STEP_SUMMARY). */
export function gateMarkdown(report) {
  const { kal } = report;
  const lines = [`### Czas startu wobec ${kal.kotwica}`, ''];
  report.attempts.forEach((a, i) => {
    const fmt = (s) =>
      s ? `${s.mediana} (${s.min}–${s.max}, CV ${(s.cv * 100).toFixed(1)}%)` : 'brak';
    lines.push(
      `Pomiar ${i + 1}: kotwica ×1 tutaj ${a.hereX1} ms (na komputerze odniesienia ${kal.gotowe_x1_ms} ms), ` +
        `dławienie ×${a.rate}, metoda „${a.method}”, ${a.A.przebiegi} par.`,
      '',
      '| chwila | kotwica tutaj, ms | PR tutaj, ms | PR / kotwica | PR na komputerze odniesienia, ms | próg, ms |',
      '|---|---|---|---|---|---|',
      ...METRICS.map((m) => {
        const rel = kal.porownanie.includes(m)
          ? ` (próg ${MAX_RATIO}× i +${MIN_DELTA_MS} ms)`
          : ' (bez progu)';
        const r = a.ratio[m] == null ? 'brak' : `${a.ratio[m].toFixed(2)}${rel}`;
        const d =
          a.deltaRef[m] == null
            ? ''
            : ` (${a.deltaRef[m] >= 0 ? '+' : ''}${Math.round(a.deltaRef[m])})`;
        const v = a.ref[m] == null ? 'brak' : `${Math.round(a.ref[m])}${d}`;
        return `| ${LABEL[m]} | ${fmt(a.A[m])} | ${fmt(a.B[m])} | ${r} | ${v} | ${BUDGETS[m] ?? ''} |`;
      }),
      '',
      a.problems.length ? `Nie przechodzi: ${a.problems.join('; ')}.` : 'Przechodzi.',
      '',
    );
  });
  lines.push(
    report.ok
      ? '**Wynik: przechodzi.**'
      : `**Wynik: nie przechodzi** (${report.problems.join('; ')}).`,
  );
  return `${lines.join('\n')}\n`;
}

/** Wynik pojedynczego pomiaru jako tabela tekstowa. */
function measureText(res) {
  const row = (name, s) =>
    `${name.padEnd(16)} ${s ? `${String(s.mediana).padStart(6)} ms  (${s.min}–${s.max}, CV ${(s.cv * 100).toFixed(1)}%)` : 'brak'}`;
  return [
    `${res.plik}: ×${res.rate}, ${res.przebiegi} przebiegów, metoda „${res.metoda}”, mediany:`,
    row('widać interfejs', res.ui),
    row('FCP', res.fcp),
    row('LCP', res.lcp),
    row('gotowe', res.gotowe),
  ].join('\n');
}

function parseArgs(argv) {
  const opts = {
    rate: CPU_RATE,
    runs: 5,
    json: false,
    kotwica: null,
    kalibracja: KALIBRACJA_JSON,
    file: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rate') opts.rate = Number(argv[++i]);
    else if (a === '--runs') opts.runs = Number(argv[++i]);
    else if (a === '--json') opts.json = true;
    else if (a === '--kotwica') opts.kotwica = argv[++i];
    else if (a === '--kalibracja') opts.kalibracja = argv[++i];
    else if (!opts.file) opts.file = a;
    else throw new Error(`nieznany argument: ${a}`);
  }
  if (!opts.file)
    throw new Error('podaj plik: node scripts/perf/start.mjs apps/web/dist/index.html');
  if (!(opts.rate >= 1) || !(opts.runs >= 1)) throw new Error('--rate ≥ 1 i --runs ≥ 1');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.kotwica) {
    const res = await measureStart(opts.file, { rate: opts.rate, runs: opts.runs });
    console.log(opts.json ? JSON.stringify(res, null, 1) : measureText(res));
    return;
  }
  const report = await gate({
    anchor: opts.kotwica,
    file: opts.file,
    kal: readKalibracja(opts.kalibracja),
  });
  const md = gateMarkdown(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(opts.json ? JSON.stringify(report, null, 1) : md);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
