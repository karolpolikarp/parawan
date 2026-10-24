// Karta „Adnotacja i protokół” (A08) na gotowym pliku: adnotacja o wyłączeniu jawności dołączona
// do wyniku trafia do schowka, .txt, .docx (po podziale strony) i PDF z druku (od nowej strony),
// a pole źródła się nie zmienia. „Drukuj protokół” drukuje sam protokół, bez wyniku i źródła.
// Pierwsza pozycja listy „Przed publikacją” zaznacza się po przejrzeniu wszystkich znaczników.
// Pola nie zostawiają nic w localStorage, dopóki nikt nie zaznaczy „Pamiętaj”. Każdy test przez
// withApp(), więc po nim obowiązuje kontrola sieci, CSP, śladów w pamięci i błędów z helpers.mjs.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  BROWSER,
  EXAMPLE_EMAIL,
  EXAMPLE_NAME,
  EXAMPLE_OFFICIAL,
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

const HEAD = 'Informacja o wyłączeniu jawności';
const PROTOCOL_HEAD = 'Protokół zasłaniania danych';
const squash = (s) => s.replace(/\s+/g, '');

/**
 * Drukuje stronę do PDF jak „Zapisz jako PDF” i zwraca tekst każdej strony osobno.
 * @param {import('playwright').Page} page
 */
async function printedPages(page) {
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
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    pages.push(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join(''));
  }
  await task.destroy();
  return pages;
}

/** Kliknij przycisk pobierania i oddaj nazwę oraz bajty pliku. */
async function download(page, selector) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
  return { name: file.suggestedFilename(), bytes: readFileSync(await file.path()) };
}

/** Otwiera kartę „Adnotacja i protokół” (domyślnie zwiniętą). */
async function openCard(page) {
  await page.locator('#publikacja').waitFor({ state: 'visible' });
  if (!(await page.locator('#publikacja').evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open))) {
    await page.locator('#publikacja > summary').click();
  }
}

/** Tekst akapitów document.xml (w:t i w:tab), jak go widzi Word. */
const docxParagraphs = (xml) =>
  [...xml.matchAll(/<w:p\/>|<w:p>([\s\S]*?)<\/w:p>/g)].map((m) =>
    (m[1] ?? '')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:t xml:space="preserve">([^<]*)<\/w:t>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&'),
  );

test('„Dołącz adnotację”: schowek, .txt, .docx po podziale strony i PDF od nowej strony; źródło bez zmian', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    const clipboard = BROWSER === 'chromium';
    if (clipboard) await app.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const source = await page.locator('#input').inputValue();
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort());
    const result = (await page.locator('#print-out').textContent()) ?? '';
    assert.ok(result.includes('[PESEL]'), result);

    await openCard(page);
    await page.locator('#pub-organ').fill('Wójt Gminy Brzozowa Wola');
    await page.locator('#pub-append').check();
    const annotation = (await page.locator('#pub-adnotacja').inputValue()).trim();
    assert.ok(annotation.startsWith(`${HEAD}\n`), annotation);
    assert.ok(annotation.includes('(Wójt Gminy Brzozowa Wola)'), annotation);
    assert.ok(annotation.includes('imion i nazwisk') && annotation.includes('numerów PESEL'), annotation);
    // adnotacja z nazw typów: żadnej zasłoniętej wartości
    for (const v of [EXAMPLE_PESEL, EXAMPLE_NAME, EXAMPLE_OFFICIAL, EXAMPLE_EMAIL]) {
      assert.ok(!annotation.includes(v), `w adnotacji jest „${v}”`);
    }
    const expected = `${result.replace(/\n+$/, '')}\n\n${annotation}`;

    if (clipboard) {
      await page.locator('#copy').click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.equal(copied.replace(/\r\n/g, '\n'), expected, 'schowek');
    }

    const txt = await download(page, '#download');
    assert.equal(txt.bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), expected, '.txt');

    const docx = await download(page, '#download-docx');
    const xml = strFromU8(unzipSync(docx.bytes)['word/document.xml']);
    const pageBreak = xml.indexOf('<w:br w:type="page"/>');
    assert.ok(pageBreak > 0, '.docx bez podziału strony');
    assert.ok(xml.indexOf('[PESEL]') < pageBreak, '.docx: wynik po podziale strony');
    assert.ok(xml.indexOf(HEAD) > pageBreak, '.docx: adnotacja przed podziałem strony');
    // akapit z podziałem strony zaczyna adnotację, wynik zostaje bez zmian przed nim
    const paras = docxParagraphs(xml);
    assert.deepEqual(paras, [...result.replace(/\n+$/, '').split('\n'), ...annotation.split('\n')], '.docx');

    // druk: #print-out ma sam wynik, adnotacja w #print-annex od nowej strony
    assert.equal(await page.locator('#print-out').textContent(), result);
    assert.equal(await page.locator('#print-annex').textContent(), annotation);
    const pages = await printedPages(page);
    const annexPage = pages.findIndex((p) => p.includes(HEAD));
    assert.ok(annexPage > 0, `PDF: adnotacja nie na osobnej stronie (${annexPage}):\n${pages.join('\n----\n')}`);
    assert.ok(squash(pages[annexPage]).startsWith(squash(HEAD)), `PDF: strona adnotacji:\n${pages[annexPage]}`);
    assert.ok(!pages[annexPage].includes('[PESEL]'), 'PDF: wynik na stronie adnotacji');
    assert.ok(pages.slice(0, annexPage).join('').includes('[PESEL]'), 'PDF: brak wyniku przed adnotacją');
    assert.ok(!squash(pages.join('')).includes(EXAMPLE_PESEL), 'PDF: numer PESEL');

    // pole źródła i silnik bez zmian; bez „Pamiętaj” żadnego nowego klucza w localStorage
    assert.equal(await page.locator('#input').inputValue(), source);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).sort()), keysBefore);

    // odznaczenie „Dołącz” wraca do samego wyniku
    await page.locator('#pub-append').uncheck();
    assert.equal(await page.locator('#print-annex').textContent(), '');
    const plain = await download(page, '#download');
    assert.equal(plain.bytes.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), result);
  });
});

test('„Drukuj protokół”: PDF z samym protokołem, bez wyniku i źródła; potem druk wraca do wyniku', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    await openCard(page);
    await page.locator('#pub-znak').fill('RGK.6220.14.2026');
    // Okno druku w teście zastępuje zapis tytułu i treści w chwili wywołania (bez afterprint).
    await page.evaluate(() => {
      window.print = () => {
        dispatchEvent(new Event('beforeprint'));
        window.__printed = {
          text: document.getElementById('print-out')?.textContent ?? '',
          title: document.title,
        };
      };
    });
    await page.locator('#pub-print-prot').click();
    await page.waitForFunction(() => window.__printed);
    const printed = await page.evaluate(() => window.__printed);
    assert.ok(printed.text.startsWith(`${PROTOCOL_HEAD}\n`), printed.text);
    assert.match(printed.title, /^protokol-\d{4}-\d{2}-\d{2}$/);
    const pages = await printedPages(page);
    const text = pages.join('\n');
    const flat = squash(text);
    assert.ok(flat.includes(squash(PROTOCOL_HEAD)), `PDF bez nagłówka protokołu:\n${text}`);
    assert.ok(flat.includes(squash('Znak sprawy: RGK.6220.14.2026')), text);
    assert.ok(flat.includes(squash('Protokół nie zawiera zasłoniętych danych.')), text);
    // ani wynik (znaczniki, zdania pisma), ani źródło
    for (const s of [
      '[PESEL]',
      '[IMIĘ I NAZWISKO]',
      'Na podstawie art. 104 Kpa',
      'Kierownik Referatu',
      EXAMPLE_PESEL,
      EXAMPLE_NAME,
      EXAMPLE_OFFICIAL,
      EXAMPLE_EMAIL,
    ]) {
      assert.ok(!flat.includes(squash(s)), `na wydruku protokołu jest „${s}”:\n${text}`);
    }
    // po wydruku (także anulowanym) Ctrl+P znów drukuje wynik
    await page.evaluate(() => dispatchEvent(new Event('afterprint')));
    const back = (await page.locator('#print-out').textContent()) ?? '';
    assert.ok(back.includes('[PESEL]') && !back.includes(PROTOCOL_HEAD), back);
  });
});

test('protokół: .txt z BOM i \\r\\n, nazwa z datą, suma SHA-256 wyniku tylko po zaznaczeniu', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    await openCard(page);
    const plain = await download(page, '#pub-dl-prot');
    assert.match(plain.name, /^protokol-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);
    assert.deepEqual([...plain.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'brak BOM');
    const s = plain.bytes.toString('utf8');
    assert.ok(!/[^\r]\n/.test(s), 'koniec wiersza bez \\r');
    const lines = s.replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(lines[0], PROTOCOL_HEAD);
    assert.match(lines[2], /^Narzędzie: Parawan \S+, plik otwierany lokalnie w przeglądarce, bez połączeń sieciowych$/);
    assert.ok(lines.includes('Tryb „Rozróżniaj osoby”: wyłączony.'), s);
    assert.ok(lines.some((l) => /^Zasłonięto: \d+ fragment/.test(l)), s);
    assert.ok(!s.includes('SHA-256'), 'suma bez zaznaczenia');
    for (const v of [EXAMPLE_PESEL, EXAMPLE_NAME, EXAMPLE_OFFICIAL, EXAMPLE_EMAIL]) {
      assert.ok(!s.includes(v), `w protokole jest „${v}”`);
    }
    // suma z tekstu wyniku (tego z „Kopiuj”), nigdy ze źródła
    await page.locator('#pub-sha').check();
    const withSha = (await download(page, '#pub-dl-prot')).bytes.toString('utf8');
    const result = (await page.locator('#print-out').textContent()) ?? '';
    const source = await page.locator('#input').inputValue();
    const hash = (x) => createHash('sha256').update(x, 'utf8').digest('hex');
    assert.ok(withSha.includes(hash(result)), `brak sumy wyniku ${hash(result)}:\n${withSha}`);
    assert.ok(!withSha.includes(hash(source)), 'suma źródła w protokole');
  });
});

test('przegląd: licznik przy wyniku, pierwsza pozycja „Przed publikacją” po wszystkich znacznikach', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    const n = await page.locator('#output mark.pii').count();
    assert.ok(n > 3, `znaczników: ${n}`);
    assert.equal(await page.locator('#mask-seen').textContent(), ` · przejrzano 0 z ${n}`);
    assert.equal(await page.locator('#pub-chk-seen').isChecked(), false);
    for (let i = 0; i < n - 1; i++) await page.locator('#mask-next').click();
    assert.equal(await page.locator('#mask-seen').textContent(), ` · przejrzano ${n - 1} z ${n}`);
    assert.equal(await page.locator('#pub-chk-seen').isChecked(), false, 'zaznaczone przed końcem');
    // ostatni znacznik kliknięciem: klik też liczy się do przeglądu
    await page.locator('#output mark.pii').nth(n - 1).click();
    assert.equal(await page.locator('#mask-seen').textContent(), ` · przejrzano ${n} z ${n}`);
    assert.equal(await page.locator('#pub-chk-seen').isChecked(), true, 'pierwsza pozycja nie zaznaczyła się');
    assert.equal(await page.locator('#pub-chk-seen-n').textContent(), `${n} z ${n}`);
    // przełączenie widoku nie zeruje przeglądu
    await page.locator('#view-compare').click();
    assert.equal(await page.locator('#pub-chk-seen').isChecked(), true);
    // protokół podaje ten sam stan
    await openCard(page);
    const prot = (await download(page, '#pub-dl-prot')).bytes.toString('utf8');
    assert.ok(prot.includes(`Przejrzano znaczniki: ${n} z ${n}.`), prot);
    // nowy wynik liczy od zera
    await page.locator('#input').press('End');
    await page.locator('#input').pressSequentially(' Dopisek.');
    await page.waitForFunction((m) => document.getElementById('mask-seen')?.textContent === ` · przejrzano 0 z ${m}`, n);
    assert.equal(await page.locator('#pub-chk-seen').isChecked(), false);
  });
});

test('pola karty: „Wyczyść” i „Przykład” czyszczą, „Pamiętaj” zapisuje tylko organ i osobę', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    await openCard(page);
    const fill = async () => {
      await page.locator('#pub-organ').fill('Wójt Gminy Testowo');
      await page.locator('#pub-osoba').fill('Anna Testowa, inspektor');
      await page.locator('#pub-zatw').fill('Adam Wrona');
      await page.locator('#pub-znak').fill('OR.1431.58.2026');
      await page.locator('#pub-podstawa').selectOption('inna');
      await page.locator('#pub-inna').fill('art. 5 ust. 1 u.d.i.p.');
      await page.locator('#pub-data').fill('01.02.2026');
      for (const id of ['#pub-counts', '#pub-append', '#pub-sha']) await page.locator(id).check();
      await page.locator('#publikacja .pub-check input').nth(2).check();
      await page.locator('#pub-adnotacja').press('End');
      await page.locator('#pub-adnotacja').pressSequentially(' Poprawka.');
      assert.equal(await page.locator('#pub-reset-ann').isVisible(), true, 'brak „Przywróć wzór”');
    };
    const state = () =>
      page.evaluate(() => {
        const v = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).value;
        const c = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id)).checked;
        return {
          organ: v('pub-organ'),
          osoba: v('pub-osoba'),
          zatw: v('pub-zatw'),
          znak: v('pub-znak'),
          podstawa: v('pub-podstawa'),
          inna: v('pub-inna'),
          checks: ['pub-counts', 'pub-append', 'pub-sha'].map(c),
          lista: [...document.querySelectorAll('#publikacja .pub-check input')].map(
            (el) => /** @type {HTMLInputElement} */ (el).checked,
          ),
          data: v('pub-data'),
          poprawiona: !document.getElementById('pub-reset-ann')?.hidden,
          adnotacja: v('pub-adnotacja'),
        };
      });
    const today = await page.evaluate(() => {
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()}`;
    });
    const assertCleared = async (what) => {
      const s = await state();
      assert.deepEqual(
        { ...s, adnotacja: '' },
        {
          organ: '',
          osoba: '',
          zatw: '',
          znak: '',
          podstawa: 'prywatnosc',
          inna: '',
          checks: [false, false, false],
          lista: [false, false, false, false, false],
          data: today,
          poprawiona: false,
          adnotacja: '',
        },
        what,
      );
      assert.ok(!s.adnotacja.includes('Testow') && !s.adnotacja.includes('Poprawka'), `${what}: ${s.adnotacja}`);
    };

    await fill();
    assert.equal(await page.evaluate(() => localStorage.getItem('adnotacja')), null);
    await page.locator('#clear').click();
    await assertCleared('po „Wyczyść”');
    // bez tekstu karty nie widać, więc najpierw wynik
    await page.locator('#example').click();
    await openCard(page);
    await fill();
    await page.locator('#example').click();
    await assertCleared('po „Przykład”');

    // „Pamiętaj”: tylko organ i osoba, wracają po ponownym otwarciu pliku i po „Wyczyść”
    await openCard(page);
    await page.locator('#pub-remember').check();
    await fill();
    const stored = JSON.parse((await page.evaluate(() => localStorage.getItem('adnotacja'))) ?? 'null');
    assert.deepEqual(stored, { organ: 'Wójt Gminy Testowo', osoba: 'Anna Testowa, inspektor' });
    await page.reload();
    await page.locator('#example').click();
    await openCard(page);
    assert.equal(await page.locator('#pub-remember').isChecked(), true);
    assert.equal(await page.locator('#pub-organ').inputValue(), 'Wójt Gminy Testowo');
    assert.equal(await page.locator('#pub-osoba').inputValue(), 'Anna Testowa, inspektor');
    assert.equal(await page.locator('#pub-znak').inputValue(), '');
    await page.locator('#clear').click();
    assert.equal(await page.locator('#pub-organ').inputValue(), 'Wójt Gminy Testowo');
    assert.equal(await page.locator('#pub-osoba').inputValue(), 'Anna Testowa, inspektor');
    // odznaczenie usuwa klucz (karta widoczna przy wyniku)
    await page.locator('#example').click();
    await openCard(page);
    await page.locator('#pub-remember').uncheck();
    assert.equal(await page.evaluate(() => localStorage.getItem('adnotacja')), null);
  });
});

test('„Kopiuj adnotację” kopiuje treść pola; „Przywróć wzór” wraca do wzoru z pól', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    await openCard(page);
    await page.locator('#pub-osoba').fill('Anna Testowa');
    const pattern = await page.locator('#pub-adnotacja').inputValue();
    assert.ok(pattern.includes('Wyłączenia dokonał(a): Anna Testowa ([uzupełnij]).'), pattern);
    await page.locator('#pub-adnotacja').press('End');
    await page.locator('#pub-adnotacja').pressSequentially(' Poprawka.');
    // poprawionej adnotacji pola już nie nadpisują
    await page.locator('#pub-organ').fill('Wójt Gminy Testowo');
    assert.ok((await page.locator('#pub-adnotacja').inputValue()).endsWith(' Poprawka.'));
    if (BROWSER === 'chromium') {
      await app.context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.locator('#pub-copy-ann').click();
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(copied.replace(/\r\n/g, '\n').endsWith(' Poprawka.'), copied);
    }
    await page.locator('#pub-reset-ann').click();
    const restored = await page.locator('#pub-adnotacja').inputValue();
    assert.ok(restored.includes('(Wójt Gminy Testowo)') && !restored.includes('Poprawka'), restored);
    assert.equal(await page.locator('#pub-reset-ann').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'pub-adnotacja');
  });
});
