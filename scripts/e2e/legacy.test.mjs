// Stary silnik: Chromium 109, ostatni Chrome i Edge dla Windows 7 i 8.1 oraz próg build.target
// (chrome109/edge109). Binarkę wskazuje PARAWAN_CHROMIUM (snapshot z pobierz-przegladarki.mjs
// albo z joba chromium-109 w .github/workflows/zgodnosc.yml); bez niej testy są pomijane, więc
// zwykłe npm run e2e ich nie uruchamia. Ten sam zestaw co dla urzędnika: przykład, samodiagnostyka
// PDF, upuszczony DOCX i wczytany pismo.pdf, każdy przez withApp() z pełną bramką.
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  DOCX_MIME,
  EXAMPLE_PESEL,
  FIXTURES,
  LEGACY_SKIP,
  PISMO_PESEL,
  launch,
  makeDocx,
  resultText,
  withApp,
} from './helpers.mjs';

/** @type {import('playwright').Browser} */
let legacy;
before(async () => {
  if (!LEGACY_SKIP) legacy = await launch({ legacy: true });
});
after(async () => {
  await legacy?.close();
});

test('stary silnik (PARAWAN_CHROMIUM): wersja przeglądarki', { skip: LEGACY_SKIP }, (t) => {
  t.diagnostic(`PARAWAN_CHROMIUM: ${legacy.version()}`);
  // Sprawdzenie, że PARAWAN_CHROMIUM to naprawdę stary silnik, a nie przypadkiem bieżący Chromium.
  const major = Number.parseInt(legacy.version(), 10);
  const want = Number.parseInt(process.env.PARAWAN_CHROMIUM_WERSJA ?? '', 10);
  if (want) assert.equal(major, want, `oczekiwano Chromium ${want}, jest ${legacy.version()}`);
});

test('stary silnik (PARAWAN_CHROMIUM): ?demo maskuje PESEL', { skip: LEGACY_SKIP }, async (t) => {
  await withApp(legacy, t, '?demo', async (app) => {
    await app.demoReady();
    assert.ok(!(await app.output()).includes(EXAMPLE_PESEL));
  });
});

// Chrome i Edge 109–123 nie mają iteracji ReadableStream, z której korzysta pdf.js 6; łatka
// w pdf.ts ją dopisuje. Bez niej oba scenariusze PDF kończyły się błędem odczytu.
test('stary silnik (PARAWAN_CHROMIUM): ?pdftest daje „[PDF OK]”', { skip: LEGACY_SKIP }, async (t) => {
  await withApp(legacy, t, '?pdftest', async ({ page }) => {
    await page.waitForFunction(
      () => /^\[PDF (OK|FAIL)\]/.test(document.getElementById('input')?.value ?? ''),
      null,
      { timeout: 10_000 },
    );
    const value = await page.locator('#input').inputValue();
    t.diagnostic(value.split('\n')[0]);
    assert.ok(value.startsWith('[PDF OK]'), `samodiagnostyka PDF: „${value.slice(0, 200)}”`);
  });
});

test('stary silnik (PARAWAN_CHROMIUM): wczytany pismo.pdf', { skip: LEGACY_SKIP }, async (t) => {
  await withApp(legacy, t, '', async (app) => {
    await app.page.locator('#file-input').setInputFiles(path.join(FIXTURES, 'pismo.pdf'));
    await app.waitForOutput('[PESEL]');
    const out = await resultText(app);
    assert.ok(!out.includes(PISMO_PESEL), `numer PESEL z PDF przeszedł do wyniku:\n${out}`);
  });
});

// Upuszczenie pliku, tak jak urzędnik przeciąga pismo z Eksploratora na pole: DataTransfer
// z plikiem i zdarzenia dragenter, dragover, drop na polu źródła.
test('stary silnik (PARAWAN_CHROMIUM): upuszczony DOCX', { skip: LEGACY_SKIP }, async (t) => {
  await withApp(legacy, t, '', async (app) => {
    const docx = makeDocx([
      'Wójt Gminy Brzozowa Wola',
      'Na wniosek Pana Tomasza Wierzbickiego, PESEL 85071412358, orzekam jak w sentencji.',
    ]);
    const dataTransfer = await app.page.evaluateHandle(
      ({ bytes, type }) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], 'decyzja-test.docx', { type }));
        return dt;
      },
      { bytes: [...docx], type: DOCX_MIME },
    );
    const input = app.page.locator('#input');
    for (const type of ['dragenter', 'dragover', 'drop']) await input.dispatchEvent(type, { dataTransfer });
    await app.waitForOutput('[PESEL]');
    assert.match(await input.inputValue(), /Wierzbickiego/);
    const out = await resultText(app);
    assert.ok(!out.includes('85071412358'), `numer PESEL z DOCX przeszedł do wyniku:\n${out}`);
  });
});
