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
  LANDING_HTML,
  LEGACY_SKIP,
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
 * z @page) i zwraca tekst wszystkich stron oraz nazwy fontów zapisanych w PDF-ie.
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
  /** @type {Set<string>} */
  const fonts = new Set();
  for (let n = 1; n <= doc.numPages; n++) {
    const pdfPage = await doc.getPage(n);
    const content = await pdfPage.getTextContent();
    for (const it of content.items) if ('str' in it) text += it.str + (it.hasEOL ? '\n' : '');
    text += '\n';
    // Nazwa fontu z PDF-u (np. „AAAAAA+ArialMT”) jest w commonObjs po przejściu operatorów strony.
    await pdfPage.getOperatorList();
    for (const id of Object.keys(content.styles)) fonts.add(pdfPage.commonObjs.get(id)?.name ?? id);
  }
  const pages = doc.numPages;
  await task.destroy();
  return { text, pages, fonts: [...fonts] };
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
    const { text, fonts } = await printedText(app.page);
    assertNoExampleData(text);
    await assertPrintIsResult(app.page, text);
    // Z wbudowanego, zmiennego Archivo „Zapisz jako PDF” robił PDF bez warstwy tekstu (Firefox)
    // albo bez ó, ś, ć, ń, ź (Chromium 109–125). Wydruk ma font systemowy.
    assert.ok(fonts.length > 0, 'w PDF-ie brak fontów');
    assert.ok(!fonts.some((f) => /archivo/i.test(f)), `font wydruku: ${fonts.join(', ')}`);
  });
});

// Bieżący Chromium zapisywał tekst poprawnie także z Archivo, więc wadę widać tylko na starym
// silniku: Chromium 109 i 111 (próg build.target, Windows 7 i 8.1) oraz 125 wstawiały \x00
// zamiast ó, ś, ć, ń, ź („Dzie\x00 dobry”, „[MIEJSCOWO\x00\x00]”).
test('stary silnik (PARAWAN_CHROMIUM): PDF ma polskie litery w warstwie tekstu', {
  skip: LEGACY_SKIP,
}, async (t) => {
  const legacy = await launch({ legacy: true });
  try {
    await withApp(legacy, t, '?demo', async (app) => {
      await app.demoReady();
      for (const view of ['Wynik', 'Porównanie']) {
        await setView(app.page, view);
        const { text } = await printedText(app.page);
        assert.ok(!text.includes('\u0000'), `${view}: znak zerowy w PDF:\n${JSON.stringify(text)}`);
        const flat = squash(text);
        assert.ok(
          flat.includes('Dzieńdobry') && flat.includes('[MIEJSCOWOŚĆ]'),
          `${view}:\n${text}`,
        );
        assertNoExampleData(text);
        await assertPrintIsResult(app.page, text);
      }
    });
  } finally {
    await legacy.close();
  }
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
    // etykieta (podpis grupy „Pobierz” i rozszerzenie) zmienia się po wczytaniu i przeliczeniu tekstu z pliku
    await page.getByRole('button', { name: 'Pobierz .csv', exact: true }).waitFor();
    const fromCsv = await download();
    assert.match(fromCsv.name, /^zanonimizowany-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$/);
    assert.ok(!fromCsv.name.includes('rejestr'), 'nazwa wczytanego pliku w nazwie pobranego');
    const c = assertWindowsText(fromCsv.bytes, '.csv');
    assert.ok(c.startsWith(String.fromCharCode(0xfeff) + 'lp;osoba;PESEL\r\n1;'), c);
    assert.ok(!c.includes('85071412358') && !c.includes('44051401359'), c);

    // „Przykład” zastępuje tekst z pliku, więc pobranie wraca do .txt
    await page.locator('#example').click();
    await page.getByRole('button', { name: 'Pobierz .txt', exact: true }).waitFor();
    assert.match((await download()).name, /\.txt$/);
  });
});

// Przycisk druku dołożył do paska wyniku trzecią akcję. Kiedy pasek schodził do drugiego rzędu,
// miał 166 px zamiast 90 px, a okno wyniku zaczynało się 76 px niżej niż okno źródła: przy 1366 px
// z paskiem przewijania Windows, przy 1280 px, a po kliknięciu „Kopiuj” (szersze „Skopiowano ✓”)
// przy każdej szerokości. Playwright chowa pasek przewijania (--hide-scrollbars), więc szerokości
// są podane bez niego: 1351 = 1366 − 15, 1265 = 1280 − 15.
test('pasek wyniku w jednym rzędzie i równy paskowi źródła, także po „Skopiowano ✓”', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    await app.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const measure = () =>
      page.evaluate(() => {
        const [src, out] = [...document.querySelectorAll('.toolbar')].map((el) =>
          el.getBoundingClientRect(),
        );
        const y = (id) => document.getElementById(id)?.getBoundingClientRect().y ?? NaN;
        return {
          heights: [Math.round(src.height), Math.round(out.height)],
          dy: Math.round(y('output') - y('input')),
          scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          label: document.getElementById('copy-label')?.textContent,
        };
      });
    // [szerokość okna bez paska przewijania, dwie kolumny, sprawdzić też „Skopiowano ✓”]
    for (const [width, twoCols, flash] of [
      [1214, true, false], // 1229 px z paskiem (1536 × 864 w skali 125%), przed kliknięciem
      [1905, true, true],
      [1351, true, true],
      [1265, true, true],
      [685, false, true], // jedna kolumna, 700 px z paskiem
    ]) {
      await page.setViewportSize({ width, height: 768 });
      const states = [await measure()];
      if (flash) {
        await page.locator('#copy').click();
        await page.waitForFunction(
          () => document.getElementById('copy-label')?.textContent === 'Skopiowano ✓',
        );
        states.push(await measure());
      }
      for (const s of states) {
        const at = `${width} px, „${s.label}”`;
        assert.equal(s.heights[1], s.heights[0], `${at}: paski wyniku i źródła ${s.heights}`);
        if (twoCols) assert.equal(s.dy, 0, `${at}: okno wyniku ${s.dy} px niżej niż okno źródła`);
        assert.equal(s.scroll, 0, `${at}: poziome przewijanie`);
      }
    }
  });
});

// Rada o druku dołożyła do stopki wyniku drugi wiersz. Karty stoją od 1081 px obok siebie
// i mają równą wysokość, a nadmiar w karcie źródła brał .card-b: nad stopką źródła zostawał pusty
// pas ok. 41 px (1366 px), a stopki stały na różnych wysokościach. Dodatkowe 8 px dokładało
// <textarea> jako element w linii (odstęp pod linią tekstu), więc okno źródła z uchwytem stało
// niżej niż wynik. Teraz między uchwytem a stopką w obu kartach jest ten sam odstęp, a przy pasku
// wyniku w jednym rzędzie stopki zaczynają się na tej samej wysokości.
test('stopki kart źródła i wyniku na jednej wysokości, bez pustego pasa nad stopką źródła', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    const measure = () =>
      page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const card = (id) => document.getElementById(id).closest('.card-ed');
        const parts = (c) => ({
          grip: box(c.querySelector('.card-b .ed-grip')).bottom,
          foot: box(c.querySelector(':scope > .card-f')).top,
          bottom: box(c).bottom,
        });
        return {
          src: parts(card('input')),
          out: parts(card('output')),
          scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
    // [szerokość bez paska przewijania, pasek wyniku w jednym rzędzie (stopki równo)]
    for (const [width, aligned] of [
      [1351, true],
      [1265, true],
      [1905, true],
      [1081, false], // pasek wyniku w dwóch rzędach: wynik niżej o ten rząd
      [390, false], // jedna kolumna
    ]) {
      await page.setViewportSize({ width, height: 800 });
      const m = await measure();
      const at = `${width} px`;
      const gap = (p) => Math.round(p.foot - p.grip);
      assert.equal(gap(m.src), gap(m.out), `${at}: odstęp nad stopką źródła ${gap(m.src)} px, wyniku ${gap(m.out)} px`);
      if (aligned) {
        assert.equal(Math.round(m.src.foot), Math.round(m.out.foot), `${at}: stopki ${m.src.foot} i ${m.out.foot}`);
        assert.equal(Math.round(m.src.grip), Math.round(m.out.grip), `${at}: uchwyty okien ${m.src.grip} i ${m.out.grip}`);
        assert.equal(Math.round(m.src.bottom), Math.round(m.out.bottom), `${at}: karty różnej wysokości`);
      }
      assert.equal(m.scroll, 0, `${at}: poziome przewijanie`);
    }
  });
});

// L01: Ctrl+P na stronie produktu drukuje samą sekcję „Dla inspektora ochrony danych i działu IT”,
// do teczki z wnioskiem o zgodę. Najwyżej dwie strony A4, bez demo, paska i przycisków.
test('landing: wydruk to sama sekcja #dla-iod, najwyżej 2 strony A4, bez demo', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async ({ page }) => {
      await page.waitForLoadState('load');
      const { text, pages } = await printedText(page);
      assert.ok(pages >= 1 && pages <= 2, `wydruk #dla-iod ma ${pages} stron A4`);
      // etykiety metryczki są pisane wersalikami (text-transform), więc porównujemy bez wielkości liter
      const flat = squash(text).toLowerCase();
      const has = (s) => flat.includes(squash(s).toLowerCase());
      for (const want of [
        'Dla inspektora ochrony danych i działu IT',
        'Gdzie są przetwarzane dane',
        'Dostępność',
      ]) {
        assert.ok(has(want), `na wydruku brak „${want}”:\n${text}`);
      }
      for (const ui of [
        'Tekst źródłowy',
        'Wstaw przykład',
        'Kopiuj wynik',
        'Pobierz Parawan.html',
        'albo z GitHuba',
        'Typy danych',
        'Co się stało z przykładem',
      ]) {
        assert.ok(!has(ui), `na wydruku jest „${ui}”:\n${text}`);
      }
    },
    { file: LANDING_HTML },
  );
});
