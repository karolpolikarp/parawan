// Druk i pobieranie wyniku na gotowym pliku. Ctrl+P, „Zapisz jako PDF” i przycisk „Drukuj lub
// zapisz PDF” mają dać na papierze sam wynik: bez pola źródła, bez przekreślonych oryginałów
// z „Porównania” i w całości, a nie tylko to, co mieści się w okienku wyniku. Sprawdzamy to na
// prawdziwym PDF-ie z Chromium (page.pdf przy emulacji druku), z którego tekst wyciąga ten sam
// pdf.js (wersja legacy), który siedzi w aplikacji. Każdy test przez withApp(), więc po nim
// obowiązuje też kontrola sieci, CSP i błędów z helpers.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  EXAMPLE_EMAIL,
  EXAMPLE_IBAN_START,
  EXAMPLE_NAME,
  EXAMPLE_PESEL,
  launch,
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

/** Napis w #print-out, gdy nie ma wyniku (PRINT_EMPTY w main.ts). */
const PRINT_EMPTY = 'Brak wyniku do wydruku. Wklej tekst w pole „Tekst źródłowy”.';

/** Bez białych znaków: pdf.js rozstawia odstępy między fragmentami tekstu po swojemu. */
const squash = (s) => s.replace(/\s+/g, '');

/**
 * Drukuje stronę do PDF tak jak „Zapisz jako PDF” (arkusz @media print, rozmiar i marginesy
 * z @page) i zwraca tekst wszystkich stron.
 * @param {import('playwright').Page} page
 */
async function printedText(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  await page.emulateMedia({ media: 'screen' });
  const task = pdfjs.getDocument({
    data: new Uint8Array(pdf),
    disableFontFace: true,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    for (const it of content.items) if ('str' in it) text += it.str + (it.hasEOL ? '\n' : '');
    text += '\n';
  }
  const pages = doc.numPages;
  await task.destroy();
  return { text, pages };
}

/** Na wydruku nie ma żadnej danej z przykładu, a jest znacznik w miejscu numeru PESEL. */
function assertNoExampleData(text) {
  assert.ok(text.includes('[PESEL]'), `na wydruku brak [PESEL]:\n${text}`);
  const flat = squash(text);
  for (const [name, value] of [
    ['EXAMPLE_PESEL', EXAMPLE_PESEL],
    ['imię i nazwisko', 'Anna Kowalska'],
    ['EXAMPLE_NAME', EXAMPLE_NAME],
    ['EXAMPLE_EMAIL', EXAMPLE_EMAIL],
    ['EXAMPLE_IBAN_START', EXAMPLE_IBAN_START],
  ]) {
    assert.ok(!flat.includes(squash(value)), `na wydruku jest ${name} „${value}”:\n${text}`);
  }
  // elementy interfejsu nie idą na papier
  for (const ui of ['Tekst źródłowy', 'Kopiuj', 'Porównanie', 'Zamaskowano']) {
    assert.ok(!text.includes(ui), `na wydruku jest element interfejsu „${ui}”:\n${text}`);
  }
}

/** Wydruk to dokładnie tekst z #print-out, czyli z finalText (output.ts). */
async function assertPrintIsResult(page, text) {
  const printOut = await page.locator('#print-out').textContent();
  assert.equal(squash(text), squash(printOut ?? ''), 'wydruk różni się od #print-out');
}

async function setView(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
  const id = name === 'Wynik' ? 'view-result' : 'view-compare';
  await page.waitForFunction(
    (i) => document.getElementById(i)?.getAttribute('aria-pressed') === 'true',
    id,
  );
}

test('?demo, widok „Wynik”: PDF ma sam wynik, bez danych z pola źródła', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    await setView(app.page, 'Wynik');
    const { text } = await printedText(app.page);
    assertNoExampleData(text);
    await assertPrintIsResult(app.page, text);
  });
});

test('?demo, widok „Porównanie”: przekreślone oryginały nie trafiają na wydruk', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    await setView(app.page, 'Porównanie');
    // Na ekranie oryginał stoi obok znacznika, więc test sprawdza właściwy widok.
    assert.ok(
      (await app.output()).includes(EXAMPLE_PESEL),
      'w „Porównaniu” na ekranie brak oryginału',
    );
    const { text } = await printedText(app.page);
    assertNoExampleData(text);
    await assertPrintIsResult(app.page, text);
  });
});

test('121 wierszy z telefonem: na wydruku 121 × [TELEFON], z ostatnim wierszem', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const lines = Array.from(
      { length: 121 },
      (_, i) => `Wiersz ${i + 1}: kontakt w sprawie pod nr tel. 600 700 ${String(100 + i)}.`,
    );
    await app.page.locator('#input').fill(lines.join('\n'));
    await app.page.waitForFunction(() =>
      (document.getElementById('print-out')?.textContent ?? '').includes('Wiersz 121:'),
    );
    const { text, pages } = await printedText(app.page);
    assert.equal(
      text.match(/\[TELEFON\]/g)?.length ?? 0,
      121,
      `liczba [TELEFON] na ${pages} stronach`,
    );
    assert.ok(pages > 1, `121 wierszy na ${pages} stronie: wydruk ucięty do okienka?`);
    assert.match(squash(text), /Wiersz121:kontaktwsprawiepodnrtel\.\[TELEFON\]\.\s*$/);
    assert.ok(!text.includes('600 700'), 'na wydruku jest numer telefonu');
    await assertPrintIsResult(app.page, text);
  });
});

test('pusty tekst: na wydruku tylko „Brak wyniku do wydruku…”', async (t) => {
  await withApp(browser, t, '', async (app) => {
    assert.equal(await app.page.locator('#print-out').textContent(), PRINT_EMPTY);
    const { text, pages } = await printedText(app.page);
    assert.equal(pages, 1);
    assert.equal(text.replace(/\s+/g, ' ').trim(), PRINT_EMPTY);
  });
});

test('wynik ponad próg podświetleń (300 000 znaków) drukuje się w całości', async (t) => {
  await withApp(browser, t, '', async (app) => {
    // ok. 330 000 znaków: wynik jest wtedy zwykłym tekstem, bez znaczników i „Porównania”
    const line = 'Pismo w sprawie budowy drogi gminnej, wnioskodawca tel. 600 700 800, ';
    const text = `${Array.from({ length: 4600 }, (_, i) => `${i + 1}. ${line}`).join('\n')}\nKONIEC`;
    // fill() wpisuje tak długi tekst bardzo wolno; wklejenie to jedno zdarzenie input
    await app.page.evaluate((t) => {
      const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await app.page.waitForFunction(
      () => (document.getElementById('print-out')?.textContent ?? '').endsWith('KONIEC'),
      null,
      { timeout: 30_000 },
    );
    const printOut = (await app.page.locator('#print-out').textContent()) ?? '';
    assert.ok(printOut.length > 300_000, `#print-out ma ${printOut.length} znaków`);
    assert.equal(printOut.match(/\[TELEFON\]/g)?.length ?? 0, 4600);
    assert.ok(!printOut.includes('600 700 800'));
  });
});

test('przed drukiem (beforeprint) wynik dogania wklejony tekst, a tytuł nie zdradza treści', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    const title = await app.page.title();
    // Wklejenie i druk w jednym zadaniu: przeliczenie z opóźnieniem jeszcze nie ruszyło.
    const seen = await app.page.evaluate(() => {
      const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
      input.value = 'Wniosek złożyła Joanna Wiśniewska, PESEL 85071412358.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const before = document.getElementById('print-out')?.textContent;
      dispatchEvent(new Event('beforeprint'));
      return {
        before,
        during: document.getElementById('print-out')?.textContent,
        title: document.title,
      };
    });
    assert.ok(
      seen.before?.includes('[PESEL]') && !seen.before.includes('Wniosek'),
      'przeliczenie ruszyło za wcześnie',
    );
    assert.ok(
      seen.during?.startsWith('Wniosek złożyła') && seen.during.includes('[PESEL]'),
      seen.during,
    );
    assert.ok(!seen.during.includes('85071412358'));
    assert.match(seen.title, /^zanonimizowany-\d{4}-\d{2}-\d{2}$/);
    await app.page.evaluate(() => dispatchEvent(new Event('afterprint')));
    assert.equal(await app.page.title(), title);
  });
});

test('przycisk „Drukuj lub zapisz PDF”: Tab, nazwa, nieaktywny bez wyniku, drukuje bieżący wynik', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const btn = page.getByRole('button', { name: 'Drukuj lub zapisz PDF' });
    assert.equal(await btn.count(), 1);
    assert.ok(await btn.isDisabled(), 'bez wyniku przycisk druku jest aktywny');
    await page.locator('#example').click();
    await page.waitForFunction(() => !document.getElementById('print')?.hasAttribute('disabled'));
    // Okno druku w teście zastępuje zapis tego, co poszłoby na papier w chwili wywołania.
    await page.evaluate(() => {
      window.print = () => {
        window.__printed = document.getElementById('print-out')?.textContent ?? '';
      };
    });
    await page.locator('body').focus();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => document.activeElement?.id === 'print');
    }
    assert.ok(reached, 'Tab nie dochodzi do przycisku druku');
    // Tekst zmieniony tuż przed drukiem (przeliczenie jeszcze odłożone) też trafia na papier.
    await page.evaluate(() => {
      const input = /** @type {HTMLTextAreaElement} */ (document.getElementById('input'));
      input.value = `${input.value}\nDopisek: tel. 601 222 333.`;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.keyboard.press('Enter');
    const printed = await page.evaluate(() => window.__printed);
    assert.ok(printed?.includes('[PESEL]') && !printed.includes(EXAMPLE_PESEL), printed);
    assert.ok(printed.endsWith('Dopisek: tel. [TELEFON].'), printed);
  });
});

test('„Pobierz .txt”: BOM i \\r\\n; po wczytaniu .csv pobiera się .csv', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    const download = async () => {
      const [d] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#download').click(),
      ]);
      return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
    };
    const assertWindowsText = (bytes, what) => {
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${what}: brak BOM UTF-8`);
      const s = bytes.toString('utf8');
      assert.ok(s.includes('\r\n'), `${what}: brak \\r\\n`);
      assert.ok(!/[^\r]\n/.test(s), `${what}: koniec wiersza bez \\r`);
      assert.ok(!s.includes('\r\r'), `${what}: podwójne \\r`);
      return s;
    };

    const txt = await download();
    assert.match(txt.name, /^zanonimizowany-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);
    const s = assertWindowsText(txt.bytes, '.txt');
    assert.ok(s.includes('[PESEL]') && !s.includes(EXAMPLE_PESEL));

    const csv = [
      'lp;osoba;PESEL',
      '1;Tomasz Wierzbicki;85071412358',
      '2;Ewa Zielińska;44051401359',
    ].join('\n');
    await page.locator('#file-input').setInputFiles({
      name: 'rejestr-wnioskow.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    // etykieta zmienia się po wczytaniu i przeliczeniu tekstu z pliku
    await page.waitForFunction(
      () => document.getElementById('download-label')?.textContent === 'Pobierz .csv',
    );
    const fromCsv = await download();
    assert.match(fromCsv.name, /^zanonimizowany-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/);
    assert.ok(!fromCsv.name.includes('rejestr'), 'nazwa wczytanego pliku w nazwie pobranego');
    const c = assertWindowsText(fromCsv.bytes, '.csv');
    assert.ok(c.startsWith(String.fromCharCode(0xfeff) + 'lp;osoba;PESEL\r\n1;'), c);
    assert.ok(!c.includes('85071412358') && !c.includes('44051401359'), c);

    // „Przykład” zastępuje tekst z pliku, więc pobranie wraca do .txt
    await page.locator('#example').click();
    await page.waitForFunction(
      () => document.getElementById('download-label')?.textContent === 'Pobierz .txt',
    );
    assert.match((await download()).name, /\.txt$/);
  });
});
