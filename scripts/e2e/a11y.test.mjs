// Dostępność gotowego pliku (WCAG 2.1 AA, wymagane w sektorze publicznym ustawą o dostępności
// cyfrowej). axe-core sprawdza aplikację w kilku stanach i landing; reszta testów to to, czego
// axe nie zobaczy: obieg klawiatury bez pułapki, tryb wysokiego kontrastu Windows (forced-colors),
// odstępy tekstu (1.4.12) i powiększenie 200% (1.4.10). Każdy scenariusz przez withApp(), więc
// po nim działa ta sama bramka co w smoke.test.mjs (zero żądań, naruszeń CSP i wyjątków).
//
// Zastane naruszenia, których nie dało się poprawić od razu, stoją w a11y-wyjatki.json (reguła,
// selektor, pakiet, który je usunie). Naruszenie spoza listy wywraca test, a wpis, którego już
// nic nie zgłasza, też: lista może tylko maleć.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { LANDING_HTML, ROOT, SHOTS_DIR, launch, withApp } from './helpers.mjs';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const AXE_VERSION = require('axe-core/package.json').version;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);

const EXCEPTIONS_FILE = path.join(ROOT, 'scripts', 'e2e', 'a11y-wyjatki.json');
/** @type {{ regula: string, selektor: string, gdzie: string, pakiet: string, powod: string }[]} */
const EXCEPTIONS = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8')).wyjatki;

/**
 * Zrzuty do oceny wzrokiem (wysoki kontrast, fokus). Domyślnie w test-results/e2e/a11y, w CI
 * trafiają do artefaktu razem ze zrzutami z nieudanych testów.
 */
const LOOK_DIR = process.env.PARAWAN_A11Y_ZRZUTY || path.join(SHOTS_DIR, 'a11y');

/** @type {import('playwright').Browser} */
let browser;
before(async () => {
  browser = await launch();
  mkdirSync(LOOK_DIR, { recursive: true });
});
after(async () => {
  await browser?.close();
});

/**
 * axe na bieżącym stanie strony. Źródło wstrzyknięte przez page.evaluate (protokół DevTools),
 * więc CSP pliku (script-src bez obcych źródeł) go nie zatrzymuje i nie zgłasza naruszenia.
 * Zwraca naruszenia o wadze serious i critical, po jednym wpisie na węzeł.
 * @param {import('playwright').Page} page
 */
async function axeScan(page) {
  if (!(await page.evaluate(() => typeof window.axe === 'object'))) await page.evaluate(AXE_SOURCE);
  const result = await page.evaluate(
    (tags) =>
      window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        resultTypes: ['violations'],
      }),
    AXE_TAGS,
  );
  const nodes = [];
  for (const v of result.violations) {
    if (!BLOCKING.has(v.impact ?? '')) continue;
    for (const n of v.nodes) {
      nodes.push({
        regula: v.id,
        waga: v.impact,
        selektor: n.target.map((t) => (Array.isArray(t) ? t.join(' ') : t)).join(' '),
        opis: v.help,
        html: n.html.slice(0, 200),
        powod: n.failureSummary?.split('\n').slice(0, 3).join(' ') ?? '',
      });
    }
  }
  return nodes;
}

/** Rozwija każde <details> na stronie (treść schowana domyślnie też musi być dostępna). */
const openAllDetails = (page) =>
  page.evaluate(() => {
    for (const d of document.querySelectorAll('details')) d.open = true;
  });

/** Wpisy z a11y-wyjatki.json, które dopasowało któreś naruszenie (sprawdzane na końcu). */
const usedExceptions = new Set();
const scanned = new Set();

/**
 * Sprawdza wynik axe: każde naruszenie musi mieć wpis w a11y-wyjatki.json dla tego miejsca.
 * Przy błędzie zapisuje raport JSON obok zrzutów (artefakt w CI).
 */
function assertNoNewViolations(where, nodes) {
  scanned.add(where);
  const fresh = [];
  for (const n of nodes) {
    const i = EXCEPTIONS.findIndex((e) => e.gdzie === where && e.regula === n.regula && e.selektor === n.selektor);
    if (i >= 0) usedExceptions.add(i);
    else fresh.push(n);
  }
  if (fresh.length) {
    mkdirSync(SHOTS_DIR, { recursive: true });
    const file = path.join(SHOTS_DIR, `axe-${where.replace(/[^\p{L}\p{N}]+/gu, '-')}.json`);
    writeFileSync(file, JSON.stringify({ gdzie: where, axe: AXE_VERSION, naruszenia: fresh }, null, 1));
  }
  assert.ok(
    !fresh.length,
    `axe ${AXE_VERSION} (${AXE_TAGS.join(', ')}), ${where}: naruszenia serious/critical spoza a11y-wyjatki.json:\n${fresh
      .map((n) => `- ${n.regula} [${n.waga}] ${n.selektor}\n  ${n.opis}\n  ${n.html}\n  ${n.powod}`)
      .join('\n')}`,
  );
}

/** Stany aplikacji i landingu, w których biegnie axe. */
const SCANS = [
  { gdzie: 'aplikacja pusta', query: '', prepare: async () => {} },
  { gdzie: 'aplikacja po ?demo', query: '?demo', prepare: async (app) => app.demoReady() },
  {
    gdzie: 'aplikacja, widok Porównanie',
    query: '?demo',
    prepare: async (app) => {
      await app.demoReady();
      await app.page.locator('#view-compare').click();
      await app.page.waitForFunction(() => document.getElementById('view-compare')?.getAttribute('aria-pressed') === 'true');
    },
  },
  {
    gdzie: 'aplikacja, rozwinięte <details>',
    query: '?demo',
    prepare: async (app) => {
      await app.demoReady();
      await openAllDetails(app.page);
    },
  },
  {
    gdzie: 'aplikacja po ?demo, telefon 390×844',
    query: '?demo',
    viewport: { width: 390, height: 844 },
    prepare: async (app) => app.demoReady(),
  },
  {
    gdzie: 'landing, rozwinięte <details>',
    query: '',
    file: LANDING_HTML,
    prepare: async ({ page }) => {
      await page.waitForLoadState('load');
      // przewinięcie do końca uruchamia sekcje włączane przy wejściu w kadr
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      await openAllDetails(page);
    },
  },
];

for (const scan of SCANS) {
  test(`axe WCAG 2.1 AA: ${scan.gdzie}`, async (t) => {
    await withApp(
      browser,
      t,
      scan.query,
      async (app) => {
        await scan.prepare(app);
        assertNoNewViolations(scan.gdzie, await axeScan(app.page));
      },
      { file: scan.file, viewport: scan.viewport },
    );
  });
}

// Sprawdzian samej bramki: przycisk bez nazwy (np. ikona bez aria-label) musi wywrócić test.
// Bez tego zepsute wstrzyknięcie axe albo zły filtr wagi dawałyby zawsze zielony wynik.
test('bramka axe widzi dopisany przycisk bez nazwy', async (t) => {
  await withApp(browser, t, '', async ({ page }) => {
    await page.evaluate(() => {
      const b = document.createElement('button');
      b.type = 'button';
      b.id = 'b03-bez-nazwy';
      document.querySelector('.toolbar')?.append(b);
    });
    const nodes = await axeScan(page);
    assert.ok(
      nodes.some((n) => n.regula === 'button-name' && n.selektor.includes('b03-bez-nazwy')),
      `axe nie zgłosił przycisku bez nazwy:\n${JSON.stringify(nodes, null, 1)}`,
    );
  });
});

test('a11y-wyjatki.json: każdy wpis wciąż potrzebny (lista może tylko maleć)', (t) => {
  // Ma sens tylko po pełnym przebiegu wszystkich skanów (np. nie przy --test-name-pattern).
  if (SCANS.some((s) => !scanned.has(s.gdzie))) {
    t.skip('nie wszystkie skany axe przeszły w tym przebiegu');
    return;
  }
  for (const e of EXCEPTIONS) {
    assert.ok(e.regula && e.selektor && e.gdzie && e.pakiet && e.powod, `niepełny wpis: ${JSON.stringify(e)}`);
    assert.ok(SCANS.some((s) => s.gdzie === e.gdzie), `wpis dla nieznanego skanu „${e.gdzie}”`);
  }
  const stale = EXCEPTIONS.filter((_, i) => !usedExceptions.has(i));
  assert.deepEqual(stale, [], 'wpisy, których axe już nie zgłasza: usuń je z a11y-wyjatki.json');
});

/** Opis elementu z fokusem: id, a bez niego znacznik, klasa i początek tekstu. */
const describeFocus = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return { key: 'body' };
    const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    const key = el.id ? `#${el.id}` : `${el.localName}.${[...el.classList].join('.')} „${text}”`;
    const cs = getComputedStyle(el);
    // 2.4.7: fokus widać po obrysie albo po cieniu (pierścień)
    const ring = (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
    return { key, ring, visible: el.getClientRects().length > 0 };
  });

/**
 * Zaczyna obieg Tab od początku dokumentu: fokus na niewidocznym punkcie startu (tabindex=-1,
 * poza kolejnością Tab) wstawionym przed pierwszym elementem body.
 */
const focusDocumentStart = (page) =>
  page.evaluate(() => {
    let start = document.getElementById('b03-start');
    if (!start) {
      start = document.createElement('span');
      start.tabIndex = -1;
      start.id = 'b03-start';
      document.body.prepend(start);
    }
    start.focus();
  });

test('klawiatura: Tab od początku dochodzi do pola, „Kopiuj” i nawigacji po znacznikach, obieg wraca na początek', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    const { page } = app;
    await focusDocumentStart(page);
    const seen = [];
    let back = false;
    for (let i = 0; i < 250; i++) {
      await page.keyboard.press('Tab');
      const f = await describeFocus(page);
      if (f.key === '#b03-start') throw new Error('fokus wrócił na punkt startu z tabindex=-1');
      if (seen.length && f.key === seen[0].key) {
        back = true;
        break;
      }
      // Ten sam element dwa razy z rzędu po Tab = pułapka (Tab przechwycony, fokus stoi).
      if (seen.length && f.key === seen.at(-1).key && f.key !== 'body') {
        throw new Error(`pułapka klawiatury: Tab nie opuszcza ${f.key}`);
      }
      seen.push(f);
    }
    const keys = seen.map((f) => f.key);
    assert.ok(back, `po 250 naciśnięciach Tab fokus nie wrócił na początek strony:\n${keys.join('\n')}`);
    t.diagnostic(`obieg Tab: ${keys.length} przystanków: ${keys.join(' → ')}`);
    const at = (k) => keys.indexOf(k);
    assert.ok(at('#input') >= 0, `Tab nie dochodzi do pola źródła #input:\n${keys.join('\n')}`);
    for (const k of ['#copy', '#mask-prev', '#mask-next']) {
      assert.ok(at(k) > at('#input'), `Tab nie dochodzi do ${k} po polu źródła:\n${keys.join('\n')}`);
    }
    const hidden = seen.filter((f) => f.key !== 'body' && !f.visible);
    assert.deepEqual(hidden, [], 'fokus na niewidocznym elemencie');
    const noRing = seen.filter((f) => f.key !== 'body' && !f.ring);
    assert.deepEqual(noRing, [], 'fokus bez widocznego obrysu (WCAG 2.4.7)');

    // zrzut widocznego fokusu na „Kopiuj” (dojście z klawiatury, więc :focus-visible)
    await focusDocumentStart(page);
    for (let i = 0; i <= at('#copy'); i++) await page.keyboard.press('Tab');
    assert.equal((await describeFocus(page)).key, '#copy');
    await page.locator('.toolbar-out').screenshot({ path: path.join(LOOK_DIR, 'fokus-kopiuj.png') });
    await page.screenshot({ path: path.join(LOOK_DIR, 'fokus-kopiuj-ekran.png') });
    await page.evaluate(() => document.getElementById('b03-start')?.remove());
  });
});

/** Przenosi fokus z klawiatury na bieżący znacznik w wyniku (jedyny przystanek Tab w #output). */
async function focusMarker(page) {
  await page.locator('#output').focus();
  await page.keyboard.press('Tab');
  const onMark = await page.evaluate(() => document.activeElement?.matches('#output mark.pii') ?? false);
  assert.ok(onMark, 'Tab z pola wyniku nie przeszedł na znacznik');
}

test('wysoki kontrast (forced-colors): znaczniki mają ramkę, fokus na znaczniku ma obrys', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    const { page } = app;
    await page.emulateMedia({ forcedColors: 'active' });
    assert.ok(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), 'forced-colors nie działa');
    // W trybie wysokiego kontrastu tło znacznika znika (kolory systemowe), więc znacznik od
    // zwykłego tekstu odróżnia tylko ramka.
    const marks = await page.evaluate(() =>
      [...document.querySelectorAll('#output mark.pii')].map((m) => {
        const cs = getComputedStyle(m);
        return {
          text: m.textContent,
          border: cs.borderTopStyle !== 'none' && Number.parseFloat(cs.borderTopWidth) >= 1,
          color: cs.borderTopColor,
          bg: cs.backgroundColor,
        };
      }),
    );
    assert.ok(marks.length > 0, 'brak znaczników w wyniku');
    const bad = marks.filter((m) => !m.border || m.color === m.bg);
    assert.deepEqual(bad, [], 'znaczniki bez widocznej ramki w trybie wysokiego kontrastu');
    await page.screenshot({ path: path.join(LOOK_DIR, 'wysoki-kontrast-wynik.png') });

    await focusMarker(page);
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.activeElement);
      return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
    });
    assert.ok(
      ring.style !== 'none' && Number.parseFloat(ring.width) >= 2,
      `fokus na znaczniku bez obrysu: ${JSON.stringify(ring)}`,
    );
    await page.locator('#output').screenshot({ path: path.join(LOOK_DIR, 'wysoki-kontrast-fokus-znacznik.png') });
    await page.screenshot({ path: path.join(LOOK_DIR, 'wysoki-kontrast-fokus-ekran.png') });
  });
});

/**
 * Elementy wychodzące poza swój pojemnik w poziomie: cała strona, paski narzędzi i przyciski
 * w nich (ucięty napis na przycisku to też utrata treści, WCAG 1.4.10 i 1.4.12).
 */
const overflowProblems = (page) =>
  page.evaluate(() => {
    const out = [];
    const se = document.scrollingElement;
    if (se.scrollWidth > se.clientWidth) out.push(`strona: scrollWidth ${se.scrollWidth} > clientWidth ${se.clientWidth}`);
    const name = (el) => (el.id ? `#${el.id}` : `${el.localName}.${[...el.classList].join('.')}`);
    for (const bar of document.querySelectorAll('.toolbar, .mask-toolbar, .out-acts, .mask-nav, .seg')) {
      if (!bar.getClientRects().length) continue;
      if (bar.scrollWidth > bar.clientWidth + 1) {
        out.push(`${name(bar)}: scrollWidth ${bar.scrollWidth} > clientWidth ${bar.clientWidth}`);
      }
      const br = bar.getBoundingClientRect();
      for (const b of bar.querySelectorAll('button')) {
        if (!b.getClientRects().length) continue;
        if (b.scrollWidth > b.clientWidth + 1) out.push(`${name(b)}: scrollWidth ${b.scrollWidth} > clientWidth ${b.clientWidth}`);
        const r = b.getBoundingClientRect();
        if (r.right > br.right + 1 || r.left < br.left - 1) out.push(`${name(b)} wystaje poza ${name(bar)}`);
      }
    }
    return out;
  });

// Odstępy z kryterium 1.4.12, jak w bookmarklecie „Text Spacing”. Arkusz wstawiony ze skryptu
// podlega style-src pliku, które dopuszcza 'unsafe-inline', więc nie daje naruszenia CSP.
const TEXT_SPACING = `*, *::before, *::after {
  line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important;
}
p { margin-bottom: 2em !important; }`;

const STATES = [
  ['pusta aplikacja', '', 'pusta'],
  ['po ?demo', '?demo', 'demo'],
];

for (const [label, query, slug] of STATES) {
  test(`odstępy tekstu (WCAG 1.4.12), ${label}: bez poziomego przewijania i uciętych przycisków`, async (t) => {
    await withApp(browser, t, query, async (app) => {
      if (query) await app.demoReady();
      const { page } = app;
      await page.addStyleTag({ content: TEXT_SPACING });
      await page.waitForTimeout(100);
      const problems = await overflowProblems(page);
      await page.screenshot({ path: path.join(LOOK_DIR, `odstepy-tekstu-${slug}.png`), fullPage: true });
      assert.deepEqual(problems, [], 'przy odstępach z 1.4.12 treść wychodzi poza pojemnik');
    });
  });
}

for (const [label, query, slug] of STATES) {
  test(`powiększenie 200% (okno 683×384), ${label}: bez poziomego przewijania`, async (t) => {
    await withApp(
      browser,
      t,
      query,
      async (app) => {
        if (query) await app.demoReady();
        const { page } = app;
        const problems = await overflowProblems(page);
        await page.screenshot({ path: path.join(LOOK_DIR, `powiekszenie-200-${slug}.png`), fullPage: true });
        assert.deepEqual(problems, [], 'przy powiększeniu 200% treść wychodzi poza pojemnik');
      },
      { viewport: { width: 683, height: 384 } },
    );
  });
}
