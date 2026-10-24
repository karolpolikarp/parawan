// Ręczna korekta wyniku (A09) na gotowym pliku: „Zostaw jawne” na znaczniku pod podpisem wójta,
// „Zasłoń zaznaczenie” w wyniku i w polu źródła (także samą klawiaturą), cofanie i czyszczenie.
// Wynik z poprawkami trafia do schowka, .txt i druku, chipy liczą znaczniki po poprawkach,
// a localStorage po korektach ma te same klucze co przed nimi. Każdy test przez withApp(), więc
// po nim obowiązuje kontrola sieci, CSP, śladów w pamięci i błędów z helpers.mjs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { BROWSER, FIXTURES, launch, withApp } from './helpers.mjs';

/** @type {import('playwright').Browser} */
let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

const DECYZJA = readFileSync(path.join(FIXTURES, 'decyzja.txt'), 'utf8');
const KW = 'OS1W/00045123/6';
const squash = (s) => s.replace(/\s+/g, '');

/** Wkleja tekst w pole źródła i czeka na wynik. @param {import('playwright').Page} page */
async function paste(page, text, needle = '[PESEL]') {
  await page.locator('#input').fill(text);
  await page.waitForFunction((n) => (document.getElementById('output')?.textContent ?? '').includes(n), needle);
}

/** Licznik chipa „imię i nazwisko ×N” w karcie „Zamaskowano”. */
async function personChip(page) {
  const chips = await page.locator('#findings-chips .chip').allInnerTexts();
  const chip = chips.find((c) => c.startsWith('imię i nazwisko')) ?? '';
  return Number(chip.match(/×(\d+)/)?.[1] ?? 0);
}

/** Tekst #print-out, czyli tego, co idzie na papier. */
const printed = (page) => page.locator('#print-out').textContent();

/** Kliknij przycisk pobierania i oddaj tekst pliku bez BOM, z końcami wierszy LF. */
async function downloadTxt(page) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#download').click()]);
  return readFileSync(await file.path(), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

/** Tekst każdej strony PDF z druku, jak „Zapisz jako PDF”. */
async function printedPdf(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
  await page.emulateMedia({ media: 'screen' });
  const task = pdfjs.getDocument({ data: new Uint8Array(pdf), disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  let text = '';
  for (let n = 1; n <= doc.numPages; n++) {
    const content = await (await doc.getPage(n)).getTextContent();
    text += content.items.map((it) => ('str' in it ? it.str : '')).join('');
  }
  await task.destroy();
  return text;
}

/**
 * Zaznacza w wyniku fragment `needle` (od `from` do `to` znaku w nim) tak, jak przeciągnięcie
 * myszą: Range w węźle tekstowym wiersza, potem zdarzenie selectionchange przeglądarki.
 */
async function selectInOutput(page, needle, from = 0, to = needle.length) {
  await page.evaluate(
    ([needle, from, to]) => {
      const out = /** @type {HTMLElement} */ (document.getElementById('output'));
      const walker = document.createTreeWalker(out, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const i = /** @type {Text} */ (t).data.indexOf(needle);
        if (i === -1) continue;
        const r = document.createRange();
        r.setStart(t, i + from);
        r.setEnd(t, i + to);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(r);
        return;
      }
      throw new Error(`w wyniku nie ma „${needle}”`);
    },
    [needle, from, to],
  );
  await page.locator('#fix-sel-out:not([disabled])').waitFor();
}

test('„Zostaw jawne” pod podpisem wójta: schowek z nazwiskiem wójta, PESEL i wnioskodawca dalej zasłonięci', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const clipboard = BROWSER === 'chromium';
    if (clipboard) await app.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await paste(page, DECYZJA);
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort());
    const chipBefore = await personChip(page);

    // znacznik w wierszu „/-/ Sławomir Kędzierski”
    const sig = page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii');
    await sig.click();
    const bar = page.getByRole('group', { name: 'Działania dla bieżącego fragmentu' });
    await bar.waitFor();
    assert.match(await bar.innerText(), /imię i nazwisko · pod znacznikiem: „Sławomir Kędzierski”/);
    assert.equal(await bar.getAttribute('translate'), 'no');
    await bar.getByRole('button', { name: 'Zostaw jawne', exact: true }).click();
    await bar.getByRole('button', { name: 'Zasłoń ponownie' }).waitFor();

    // fragment przywrócony ma ramkę i wchodzi do nawigacji; licznik „jawne: 1”
    assert.equal(await page.locator('#output mark.pii-kept').innerText(), 'Sławomir Kędzierski');
    assert.match((await page.locator('#mask-seen').textContent()) ?? '', /jawne: 1/);
    assert.equal(await personChip(page), chipBefore - 1, 'chip „imię i nazwisko” nie spadł o 1');
    assert.match(await page.locator('#fix-sum').innerText(), /przywrócono 1, zasłonięto 0/);

    const expectResult = (text, where) => {
      assert.ok(text.includes('/-/ Sławomir Kędzierski'), `${where}: brak podpisu wójta`);
      assert.ok(text.includes('[PESEL]'), `${where}: brak [PESEL]`);
      assert.ok(!/wierzbick/i.test(text), `${where}: wnioskodawca jawny`);
      assert.ok(!text.includes('85071412358'), `${where}: numer PESEL`);
    };
    if (clipboard) {
      await page.locator('#copy').click();
      expectResult(await page.evaluate(() => navigator.clipboard.readText()), 'schowek');
    }
    expectResult(await downloadTxt(page), '.txt');
    expectResult((await printed(page)) ?? '', 'druk');

    // protokół: same liczby
    await page.locator('#publikacja > summary').click();
    if (clipboard) {
      await page.locator('#pub-copy-prot').click();
      const prot = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(prot.includes('Zostawiono jawne ręcznie: 1 fragment.'), prot);
      assert.ok(prot.includes('Zasłonięto ręcznie: 0 fragmentów.'), prot);
      assert.ok(!prot.includes('Kędziersk'), 'nazwisko w protokole');
    }

    // „Zasłoń ponownie” wraca do znacznika, a localStorage ma te same klucze co przed korektą
    await bar.getByRole('button', { name: 'Zasłoń ponownie' }).click();
    await page.locator('#output mark.pii-kept').waitFor({ state: 'detached' });
    assert.equal(await personChip(page), chipBefore);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).sort()), keysBefore);
  });
});

test('„Zostaw jawne wszędzie” pokazuje formy, które odsłoni, i obejmuje tylko tę osobę', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    const marks = page.locator('#output mark.pii');
    // pierwszy znacznik osoby „Joanna Malec” (w uzasadnieniu)
    const n = await marks.count();
    let at = -1;
    for (let i = 0; i < n && at === -1; i++) {
      await marks.nth(i).click();
      if ((await page.locator('#fix-bar-val').textContent()) === 'Joanna Malec') at = i;
    }
    assert.ok(at >= 0, 'brak znacznika Joanna Malec');
    const all = page.locator('#fix-keep-all');
    assert.equal(await all.innerText(), 'Zostaw jawne wszędzie (2)');
    assert.equal(await page.locator('#fix-bar-forms').innerText(), 'Obejmie: Joanna Malec');
    await all.click();
    const out = await printed(page);
    assert.equal((out?.match(/Joanna Malec/g) ?? []).length, 2);
    assert.ok(!/wierzbick/i.test(out ?? ''), 'wnioskodawca jawny');
    // Ctrl+Z z fokusem w wyniku cofa ostatnią poprawkę
    await page.locator('#output mark.pii-kept').first().focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => !document.querySelector('#output mark.pii-kept'));
    assert.ok(!(await printed(page))?.includes('Joanna Malec'));
    assert.equal(await page.locator('#fix-foot').isHidden(), true);
  });
});

test('„Zasłoń zaznaczenie” w wyniku: numer księgi wieczystej jako [DANE] w wyniku, .txt i druku', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    const keysBefore = await page.evaluate(() => Object.keys(localStorage).sort());
    // zaznaczenie środka numeru: zasłonięty ma być cały numer z ukośnikami
    await selectInOutput(page, KW, 3, 10);
    await page.locator('#fix-sel-out').click();
    const form = page.getByRole('group', { name: 'Zasłoń zaznaczony fragment' });
    await form.waitFor();
    assert.equal(await page.locator('#fix-form-val').textContent(), KW);
    assert.equal(await page.locator('#fix-token').inputValue(), 'DANE', 'numer z cyframi to „Inne dane”');
    assert.match(await form.innerText(), /wszystkie wystąpienia\s+\(1 miejsce\)/);
    await form.getByRole('button', { name: 'Zasłoń', exact: true }).click();
    await form.waitFor({ state: 'hidden' });

    const expectKw = (text, where) => {
      // bez odstępów: tekst wyciągnięty z PDF łamie wiersze inaczej niż wynik
      assert.ok(squash(text).includes(squash('(księga wieczysta nr [DANE])')), `${where}: brak [DANE] w miejscu numeru`);
      assert.ok(!squash(text).includes('00045123'), `${where}: numer księgi jawny`);
    };
    await app.waitForOutput('[DANE]');
    expectKw(await app.output(), 'wynik');
    expectKw(await downloadTxt(page), '.txt');
    expectKw((await printed(page)) ?? '', '#print-out');
    // page.pdf działa tylko w Chromium; w Firefoksie zostaje #print-out (to samo źródło tekstu)
    if (BROWSER !== 'firefox') expectKw(await printedPdf(page), 'PDF z druku');
    const chips = await page.locator('#findings-chips').innerText();
    assert.match(chips, /inne dane\s*×1/);
    assert.match(await page.locator('#fix-sum').innerText(), /przywrócono 0, zasłonięto 1/);
    // lista poprawek pokazuje wartość tylko na ekranie, z „Cofnij” przy pozycji
    await page.locator('#fix-show').click();
    const item = page.locator('#fix-list li').first();
    assert.match(await item.innerText(), /Zasłonięto jako \[DANE\] wszędzie: OS1W\/00045123\/6, 1 miejsce/);
    assert.equal(await page.locator('#fix-foot').getAttribute('translate'), 'no');
    await item.getByRole('button', { name: /^Cofnij/ }).click();
    await page.waitForFunction(() => !(document.getElementById('output')?.textContent ?? '').includes('[DANE]'));
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).sort()), keysBefore);
    // W „Porównaniu” przycisk w wyniku jest nieaktywny
    await page.locator('#view-compare').click();
    assert.equal(await page.locator('#fix-sel-out').isDisabled(), true);
  });
});

test('samą klawiaturą: „Anną” zaznaczona Shift+strzałkami w polu źródła i „Zostaw jawne” Enterem na znaczniku', async (t) => {
  const text = 'Pan Jan Kowalski przyszedł z żoną Anną.\nPani Annasz czekała. Anną zajmie się sekretariat.\nPESEL 44051401359.';
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, text);
    await page.locator('#input').focus();
    // Ctrl+Home, koniec pierwszego wiersza, przed kropką, potem 4 znaki w lewo z Shiftem
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft');
    assert.equal(
      await page.locator('#input').evaluate((el) => {
        const ta = /** @type {HTMLTextAreaElement} */ (el);
        return ta.value.slice(ta.selectionStart, ta.selectionEnd);
      }),
      'Anną',
    );
    // przycisk „Zasłoń zaznaczenie” stoi w pasku źródła tuż przed polem
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fix-sel-src');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fix-token');
    assert.equal(await page.locator('#fix-token').inputValue(), 'IMIĘ I NAZWISKO');
    assert.match(await page.locator('#fix-form').innerText(), /\(2 miejsca\)/);
    await page.keyboard.press('Tab'); // „wszystkie wystąpienia”
    await page.keyboard.press('Tab'); // „Zasłoń”
    await page.keyboard.press('Enter');
    await app.waitForOutput('z żoną [IMIĘ I NAZWISKO].');
    let out = await app.output();
    assert.ok(out.includes('[IMIĘ I NAZWISKO] zajmie się'), out);
    assert.ok(!out.includes('Anną'), out);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fix-sel-src', 'fokus wraca do przycisku');

    // Tab do wyniku: przystanek na bieżącym znaczniku, Enter otwiera pasek, Enter „Zostaw jawne”
    await page.locator('#output').focus();
    await page.keyboard.press('Tab');
    const active = () => page.evaluate(() => document.activeElement?.textContent ?? '');
    assert.equal(await active(), '[IMIĘ I NAZWISKO]');
    // bieżącym fragmentem jest świeżo zasłonięta „Anną” z pierwszego wiersza, więc Tab staje od razu na niej
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fix-keep');
    assert.match(await page.locator('#fix-bar').innerText(), /zasłonięte ręcznie: „Anną”/);
    // Esc wraca na znacznik
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#fix-bar').isHidden(), true);
    assert.equal(await active(), '[IMIĘ I NAZWISKO]');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // „Zostaw jawne” na ręcznym: Anną znów jawna w tym miejscu
    out = await app.output();
    assert.ok(out.includes('z żoną Anną.'), out);
    assert.ok(out.includes('[IMIĘ I NAZWISKO] zajmie się'), out);
    assert.ok(out.includes('[PESEL]'), out);
  });
});

test('edycja źródła zdejmuje „Zostaw jawne” z jednym komunikatem, a „Wyczyść” usuwa wszystkie poprawki', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii').click();
    await page.locator('#fix-keep').click();
    await page.locator('#output mark.pii-kept').waitFor();
    // dopisek na początku pisma: decyzja dotyczyła tekstu sprzed zmiany, więc odpada
    await page.locator('#input').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.insertText('Pismo do akt.\n');
    await app.waitForOutput('Pismo do akt.');
    assert.equal(await page.locator('#output mark.pii-kept').count(), 0);
    const note = 'Pismo zmieniło się, więc ręczne poprawki trzeba zrobić od nowa: cofnięto 1.';
    assert.equal(await page.locator('#fix-note').innerText(), note);
    await page.waitForFunction((n) => document.getElementById('sr-status')?.textContent === n, note);
    await settled(page);
    // nowa poprawka i „Wyczyść”: po nowym tekście nie ma śladu poprzednich
    await page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii').click();
    await page.locator('#fix-keep').click();
    await page.locator('#output mark.pii-kept').waitFor();
    assert.equal(await page.locator('#fix-note').isHidden(), true, 'notka została po nowej poprawce');
    await page.locator('#clear').click();
    await paste(page, DECYZJA);
    assert.equal(await page.locator('#output mark.pii-kept').count(), 0);
    assert.equal(await page.locator('#fix-foot').isHidden(), true);
  });
});

// Poprawki po weryfikacji A09: odsłonięcie nie rośnie razem z zakresem, ręczne zasłonięcia nie
// znikają po cichu z eksportu, a „Wyczyść” nie zostawia fragmentów pisma w ukrytym pasku i liście.
test('„Zostaw jawne” nie odsłania PESEL-u dopisanego potem tuż za nazwiskiem', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii').click();
    await page.locator('#fix-keep').click();
    await page.locator('#output mark.pii-kept').waitFor();
    await page.locator('#input').evaluate((el) => {
      const ta = /** @type {HTMLTextAreaElement} */ (el);
      ta.value = ta.value.replace('/-/ Sławomir Kędzierski', '/-/ Sławomir Kędzierski 44051401359');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => !document.querySelector('#output mark.pii-kept'));
    const out = (await printed(page)) ?? '';
    assert.ok(!out.includes('44051401359'), 'dopisany PESEL jawny');
    assert.ok(!out.includes('Kędzierski'), 'zakres szerszy niż decyzja ma zostać zasłonięty');
  });
});

test('ręczne zasłonięcie, którego nie da się nałożyć na długi tekst, wstrzymuje kopiowanie, pliki i druk', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await selectInOutput(page, KW);
    await page.locator('#fix-sel-out').click();
    await page.locator('#fix-apply').click();
    await app.waitForOutput('[DANE]');
    // załącznik ponad limit podświetleń (300 000 znaków): zakresów nie ma, decyzji nie da się nałożyć
    await page.locator('#input').evaluate((el) => {
      const ta = /** @type {HTMLTextAreaElement} */ (el);
      ta.value = `${ta.value}\n\nZałącznik:\n${'Treść załącznika bez danych osobowych. '.repeat(8000)}`;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => /** @type {HTMLButtonElement} */ (document.getElementById('copy')).disabled);
    for (const id of ['copy', 'download', 'download-docx', 'print']) {
      assert.equal(await page.locator(`#${id}`).isDisabled(), true, `#${id} aktywny`);
    }
    assert.ok(!((await printed(page)) ?? '').includes('00045123'), 'numer księgi w wydruku');
    assert.match(await page.locator('#fix-sum').innerText(), /wstrzymane/);
    // „Usuń wszystkie” zdejmuje poprawki i oddaje przyciski
    await page.locator('#fix-clear').click();
    assert.equal(await page.locator('#copy').isDisabled(), false);
  });
});

test('po „Wyczyść” w DOM nie zostaje nic z poprzedniego pisma', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii').click();
    await page.locator('#fix-keep').click();
    await selectInOutput(page, KW);
    await page.locator('#fix-sel-out').click();
    await page.locator('#fix-apply').click();
    await app.waitForOutput('[DANE]');
    await page.locator('#fix-show').click();
    await page.locator('#clear').click();
    const left = await page.evaluate((needles) => {
      const hits = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (needles.some((s) => /** @type {Text} */ (n).data.includes(s))) hits.push(n.parentElement?.id || n.parentElement?.tagName);
      }
      for (const el of document.body.querySelectorAll('*')) {
        for (const a of el.attributes) if (needles.some((s) => a.value.includes(s))) hits.push(`${el.tagName}@${a.name}`);
      }
      return hits;
    }, ['Kędzierski', '00045123']);
    assert.deepEqual(left, []);
  });
});

// Poprawki po weryfikacji A09, runda 2: wiersz „Zasłoń” nie zasłania starych pozycji po edycji
// źródła, pasek po korekcie zostaje na tym samym fragmencie, a fokus nie spada na <body>.

/** Zaznacza `needle` w polu źródła i otwiera wiersz „Zasłoń zaznaczenie” z odznaczonym „wszystkie”. */
async function openFormFromSource(page, needle) {
  await page.locator('#input').evaluate((el, n) => {
    const ta = /** @type {HTMLTextAreaElement} */ (el);
    const i = ta.value.indexOf(n);
    ta.focus();
    ta.setSelectionRange(i, i + n.length);
    ta.dispatchEvent(new Event('select', { bubbles: true }));
  }, needle);
  await page.locator('#fix-sel-src').click();
  await page.locator('#fix-form').waitFor();
  await page.locator('#fix-all').uncheck();
}

test('edycja źródła przy otwartym wierszu „Zasłoń” nie zasłania przesuniętych pozycji', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    // edycja i od razu „Zasłoń”, zanim wynik się przeliczy (zegar strony stoi)
    await openFormFromSource(page, KW);
    await page.locator('#input').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.type('Pismo z poprawką. ');
    await page.locator('#fix-apply').click({ force: true });
    await page.locator('#fix-form').waitFor({ state: 'hidden' });
    await app.waitForOutput('Pismo z poprawką.');
    let out = await app.output();
    assert.ok(!out.includes('[DANE]'), 'zasłonięty przypadkowy fragment');
    assert.ok(out.includes('(księga wieczysta nr OS1W/00045123/6)'), 'numer naruszony');
    assert.equal(await page.locator('#fix-foot').isHidden(), true, 'stopka liczy poprawkę, której nie ma');
    // edycja po przeliczeniu: wiersz zamyka się sam z komunikatem
    await openFormFromSource(page, KW);
    await page.locator('#input').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Delete');
    await page.clock.runFor(1500);
    await page.locator('#fix-form').waitFor({ state: 'hidden' });
    await page.clock.runFor(100);
    assert.match((await page.locator('#sr-status').textContent()) ?? '', /Zaznacz fragment jeszcze raz/);
    out = await app.output();
    assert.ok(!out.includes('[DANE]'), out);
    assert.ok(((await printed(page)) ?? '').includes('nr OS1W/00045123/6)'), 'druk naruszony');
  });
});

test('po „Zostaw jawne” na drugim znaczniku grupy pasek zostaje na tym samym fragmencie', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    // pierwszy znacznik, który dzieli zakres (data-s) z poprzednim: [MIEJSCOWOŚĆ] po [KOD-POCZTOWY]
    const i = await page.evaluate(() => {
      const m = [...document.querySelectorAll('#output mark.pii')];
      return m.findIndex((el, k) => k > 0 && el.getAttribute('data-s') === m[k - 1].getAttribute('data-s'));
    });
    assert.ok(i > 0, 'w piśmie nie ma zakresu grupowego');
    await page.locator('#output mark.pii').nth(i).click();
    assert.match(await page.locator('#fix-bar').innerText(), /kod pocztowy, miejscowość/);
    await page.locator('#fix-keep').click();
    await page.locator('#fix-remask').waitFor();
    const bar = await page.locator('#fix-bar').innerText();
    assert.match(bar, /kod pocztowy, miejscowość · przywrócone ręcznie: „07-215 Brzozowa/);
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'fix-remask');
    assert.ok((await app.output()).includes('tel. [TELEFON]'), 'telefon odsłonięty');
  });
});

test('„Cofnij zasłonięcie” na fragmencie zasłoniętym ręcznie zamyka pasek zamiast przejść na inną osobę', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await selectInOutput(page, KW);
    await page.locator('#fix-sel-out').click();
    await page.locator('#fix-all').uncheck();
    await page.locator('#fix-apply').click();
    await app.waitForOutput('[DANE]');
    // fokus wraca na nowy znacznik, a nie na wyłączony przycisk (i dalej na <body>)
    await page.waitForFunction(() => !document.querySelector('#fix-sel-out:not([disabled])'));
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '[DANE]');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#fix-keep').innerText(), 'Cofnij zasłonięcie');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !(document.getElementById('output')?.textContent ?? '').includes('[DANE]'));
    assert.equal(await page.locator('#fix-bar').isHidden(), true, 'pasek przeszedł na inny fragment');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'output');
    assert.equal(await page.locator('#fix-foot').isHidden(), true, 'cofnięta poprawka dalej na liście');
    assert.ok(!/wierzbick/i.test(await app.output()), 'wnioskodawca jawny');
  });
});

// Poprawki po weryfikacji A09, runda 3: „Cofnij zasłonięcie” wraca do stanu sprzed ręcznej
// poprawki. Dane zasłonięte przez automat zostają zasłonięte, a stopka i lista mówią to samo.

test('„Cofnij zasłonięcie” na zakresie, który wchłonął PESEL, zostawia [PESEL] w wyniku, pliku i druku', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    // domyślne „wszystkie wystąpienia” (jedno miejsce), zaznaczenie zahacza o PESEL automatu
    await openFormFromSource(page, '85071412358, złożonego');
    await page.locator('#fix-all').check();
    await page.locator('#fix-token').selectOption('DANE');
    await page.locator('#fix-apply').click();
    await app.waitForOutput('[DANE]');
    assert.ok(!(await app.output()).includes('[PESEL], złożonego'));
    await page.locator('#output mark.pii', { hasText: '[DANE]' }).click();
    assert.equal(await page.locator('#fix-keep').innerText(), 'Cofnij zasłonięcie');
    await page.locator('#fix-keep').click();
    await page.waitForFunction(() => !(document.getElementById('output')?.textContent ?? '').includes('[DANE]'));
    const out = await app.output();
    assert.ok(out.includes('PESEL [PESEL], złożonego'), out);
    assert.equal(await page.locator('#fix-bar').isHidden(), true, 'pasek z „Zostaw jawne” na PESEL-u');
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '[PESEL]');
    for (const [where, text] of [
      ['wynik', out],
      ['druk', (await printed(page)) ?? ''],
      ['.txt', await downloadTxt(page)],
    ]) {
      assert.ok(!squash(text).includes('85071412358'), `${where}: PESEL jawny`);
    }
    // jedyne miejsce: poprawka zdjęta z listy, stopka nie liczy niczego
    assert.equal(await page.locator('#fix-foot').isHidden(), true);
  });
});

test('„Cofnij zasłonięcie” w jednym z kilku miejsc „wszędzie”: stopka i lista zgodne, reszta zasłonięta', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await selectInOutput(page, '245/7');
    await page.locator('#fix-sel-out').click();
    await page.locator('#fix-token').selectOption('DANE');
    assert.equal(await page.locator('#fix-all').isChecked(), true);
    await page.locator('#fix-apply').click();
    await page.waitForFunction(() => ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length === 3);
    // fokus stoi na nowym [DANE], Enter otwiera pasek
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), '[DANE]');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#fix-keep').innerText(), 'Cofnij zasłonięcie');
    await page.locator('#fix-keep').click();
    await page.waitForFunction(() => ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length === 2);
    assert.equal((await app.output()).split('245/7').length, 2, 'odsłonięte więcej niż jedno miejsce');
    assert.equal(await page.locator('#fix-sum').textContent(), 'Ręczne poprawki: przywrócono 0, zasłonięto 2');
    await page.locator('#fix-show').click();
    const list = (await page.locator('#fix-list').innerText()).replace(/\s+/g, ' ');
    assert.ok(list.includes('Cofnięto zasłonięcie w jednym miejscu: 245/7'), list);
    assert.ok(!list.includes('Zostawiono jawne'), list);
    // cofnięcie wpisu z listy zasłania to miejsce z powrotem
    await page.locator('#fix-list button[data-i="1"]').click();
    await page.waitForFunction(() => ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length === 3);
  });
});

// Poprawki po weryfikacji domknięcia, runda 2: „wszędzie” na fragmencie zasłoniętym ręcznie cofa
// zasłonięcia zamiast odsłaniać automat, Ctrl+Z w wyniku cofa ostatnią czynność, a na liście nie
// zostaje „Cofnięto zasłonięcie” bez zasłonięcia, którego dotyczyło.

/** Zasłania `needle` z pola źródła jako „Inne dane”, w jednym miejscu albo wszędzie. */
async function maskFromSource(page, needle, all = false) {
  await openFormFromSource(page, needle);
  if (all) await page.locator('#fix-all').check();
  await page.locator('#fix-token').selectOption('DANE');
  await page.locator('#fix-apply').click();
  await page.locator('#fix-form').waitFor({ state: 'hidden' });
}

const countIn = (page, needle) =>
  page.evaluate(
    (n) => (document.getElementById('output')?.textContent ?? '').split(n).length - 1,
    needle,
  );

test('„Cofnij zasłonięcie wszędzie” na zakresach, które wchłonęły PESEL: [PESEL] w wyniku, pliku i druku', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const pesel = '85071412358';
    await paste(
      page,
      `Wniosek Pana Tomasza, PESEL ${pesel}, złożony dnia 3 maja.\nPonownie: PESEL ${pesel}, złożony dnia 3 maja.`,
    );
    await maskFromSource(page, `${pesel}, złożony`, true);
    await app.waitForOutput('PESEL [DANE] dnia');
    assert.equal(await countIn(page, '[DANE]'), 2);
    await page.locator('#output mark.pii', { hasText: '[DANE]' }).first().click();
    assert.equal(
      await page.locator('#fix-keep-all').innerText(),
      'Cofnij zasłonięcie wszędzie (2)',
    );
    await page.locator('#fix-keep-all').click();
    await page.waitForFunction(
      () => !(document.getElementById('output')?.textContent ?? '').includes('[DANE]'),
    );
    assert.equal(await countIn(page, '[PESEL], złożony'), 2);
    for (const [where, text] of [
      ['wynik', await app.output()],
      ['druk', (await printed(page)) ?? ''],
      ['.txt', await downloadTxt(page)],
    ]) {
      assert.ok(!squash(text).includes(pesel), `${where}: PESEL jawny`);
    }
    // jedna poprawka objęła oba miejsca, więc zniknęła z listy
    assert.equal(await page.locator('#fix-foot').isHidden(), true);
  });
});

test('Ctrl+Z w wyniku po „Cofnij zasłonięcie” przywraca to zasłonięcie, a nie zdejmuje wcześniejszego', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(
      page,
      `Księga wieczysta ${KW} dla działki 245/7. Wnioskodawca Jan Kowalski, PESEL 44051401359.`,
    );
    await maskFromSource(page, KW);
    await maskFromSource(page, '245/7');
    await page.waitForFunction(
      () =>
        ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length ===
        2,
    );
    await page.locator('#output mark.pii', { hasText: '[DANE]' }).nth(1).click();
    assert.equal(await page.locator('#fix-bar-val').textContent(), '245/7');
    await page.locator('#fix-keep').click();
    await app.waitForOutput('działki 245/7');
    await page.locator('#output mark.pii').first().focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      () =>
        ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length ===
        2,
    );
    for (const text of [await app.output(), (await printed(page)) ?? '']) {
      assert.ok(!text.includes('00045123'), 'księga wieczysta jawna');
      assert.ok(!text.includes('245/7'), 'działka jawna po Ctrl+Z');
    }
    // następne Ctrl+Z cofa zasłonięcie działki, księga zostaje zasłonięta
    await page.locator('#output mark.pii').first().focus();
    await page.keyboard.press('Control+z');
    await app.waitForOutput('działki 245/7');
    assert.ok(!(await app.output()).includes('00045123'), 'księga wieczysta jawna');
  });
});

test('cofnięcie z listy zasłonięcia „wszędzie” zdejmuje też „Cofnięto zasłonięcie” w jednym z jego miejsc', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await maskFromSource(page, '245/7', true);
    await page.waitForFunction(
      () =>
        ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length ===
        3,
    );
    await page.locator('#output mark.pii', { hasText: '[DANE]' }).nth(1).click();
    await page.locator('#fix-keep').click();
    await page.waitForFunction(
      () =>
        ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length ===
        2,
    );
    await page.locator('#fix-show').click();
    assert.equal(await page.locator('#fix-list li').count(), 2);
    await page.locator('#fix-list button[data-i="0"]').click();
    await page.waitForFunction(
      () => !(document.getElementById('output')?.textContent ?? '').includes('[DANE]'),
    );
    // lista pusta: nie podaje czynności, która nic już nie robi
    assert.equal(await page.locator('#fix-foot').isHidden(), true);
    // „Cofnij ostatnią” przywraca obie poprawki
    await page.locator('#output').focus();
    await page.keyboard.press('Control+z');
    await page.waitForFunction(
      () =>
        ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length ===
        2,
    );
  });
});

// Model poprawek po fuzzerze: ręczne decyzje są przypięte do dokładnego tekstu z chwili decyzji.
// Każda zmiana źródła (pisanie, wklejenie, Ctrl+Z i Ctrl+Y w polu, Enter, Ctrl+X) zdejmuje
// „Zostaw jawne”, „Cofnij zasłonięcie” i zasłonięcia „tutaj”, z jednym komunikatem i notką przy
// liście poprawek. Nic nie wraca przez historię pola. Zasłonięcie „wszędzie” to reguła tekstowa,
// stosowana od nowa do każdej wersji pisma. Stos Ctrl+Z w wyniku zeruje się przy każdej zmianie
// źródła. Każdy test odtwarza zgłoszenie z rund weryfikacji (fuzzer i audyty).
const outText = (page) => page.locator('#output').textContent().then((t) => t ?? '');

/** Ctrl+A i wpisanie tekstu w pole źródła, jak wklejenie innego pisma. */
async function pasteOver(page, text) {
  const ta = page.locator('#input');
  await ta.focus();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForFunction((t) => /** @type {HTMLTextAreaElement} */ (document.getElementById('input')).value === t, text);
}

/** Czeka, aż wynik dotyczy tekstu z pola (przerwa przed przeliczeniem minęła). */
async function settled(page) {
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.getElementById('output')?.hasAttribute('aria-busy'));
}

const redo = BROWSER === 'firefox' ? 'ControlOrMeta+Shift+z' : 'ControlOrMeta+y';

/** Wynik na ekranie, druk i pobrany .txt: żaden nie może zawierać `needle`. */
async function assertHidden(page, needle, what) {
  for (const [where, text] of [
    ['wynik', await outText(page)],
    ['druk', (await printed(page)) ?? ''],
    ['.txt', await downloadTxt(page)],
  ]) {
    assert.ok(!text.includes(needle), `${where}: ${what} jawne:\n${text}`);
  }
}

/** Zaznacza [start, end) w polu źródła, z fokusem w polu. */
async function selectInSource(page, start, end) {
  await page.locator('#input').evaluate(
    (el, [a, b]) => {
      /** @type {HTMLTextAreaElement} */ (el).focus();
      /** @type {HTMLTextAreaElement} */ (el).setSelectionRange(a, b);
    },
    [start, end],
  );
}

/** Otwiera kartę „Adnotacja i protokół”. */
async function openCard(page) {
  await page.locator('#publikacja').waitFor({ state: 'visible' });
  if (!(await page.locator('#publikacja').evaluate((d) => /** @type {HTMLDetailsElement} */ (d).open)))
    await page.locator('#publikacja > summary').click();
}

const DROP1 = 'Pismo zmieniło się, więc ręczne poprawki trzeba zrobić od nowa: cofnięto 1.';
const fixNote = (page) => page.locator('#fix-note').innerText();

test('zasłonięcie „wszędzie” przetrwa usunięcie dużego fragmentu i Ctrl+Z w polu źródła', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const head = `Decyzja w sprawie działki, księga wieczysta nr ${KW}, wnioskodawca Jan Kowalski, PESEL 44051401359.\n`;
    const tail = Array.from(
      { length: 12 },
      (_, i) =>
        `Akapit uzasadnienia numer ${i + 1} opisuje przebieg postępowania i ustalenia organu w tej sprawie.`,
    ).join('\n');
    await paste(page, head + tail);
    await selectInOutput(page, KW);
    await page.locator('#fix-sel-out').click();
    assert.equal(await page.locator('#fix-all').isChecked(), true);
    await page.locator('#fix-apply').click();
    await app.waitForOutput('[DANE]');
    const ta = page.locator('#input');
    await selectInSource(page, head.length, head.length + tail.length);
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => !(document.getElementById('output')?.textContent ?? '').includes('numer 12'));
    await page.keyboard.press('Control+z');
    assert.equal(await ta.inputValue(), head + tail, 'Ctrl+Z nie przywrócił tekstu');
    await app.waitForOutput('numer 12');
    await assertHidden(page, '00045123', 'księga wieczysta');
    assert.equal(await page.locator('#fix-sum').textContent(), 'Ręczne poprawki: przywrócono 0, zasłonięto 1');
  });
});

test('Ctrl+Z i Ctrl+Y w polu nie przenoszą ani nie przywracają „Zostaw jawne wszędzie” (zgłoszenie: Ctrl+Y)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = 'Wnioskodawca Jan Kowalski, PESEL 44051401359, wnosi o wydanie decyzji. Pan Jan Kowalski mieszka przy ul. Lipowej 4.';
    const B = 'Sprawę prowadzi inspektor Jan Kowalski. Kontakt z inspektorem Jan Kowalski w pokoju 12. Zatwierdził Jan Kowalski.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await pasteOver(page, B);
    await app.waitForOutput('pokoju 12');
    await settled(page);
    await page.locator('#output mark.pii').first().click();
    await page.locator('#fix-keep-all').click();
    await page.waitForFunction(() => !document.querySelector('#output mark.pii:not(.pii-kept)'));
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    assert.equal(await ta.inputValue(), A, 'Ctrl+Z nie wrócił do pisma A');
    await settled(page);
    await assertHidden(page, 'Kowalski', 'wnioskodawca w piśmie A');
    assert.equal(await fixNote(page), DROP1);
    // Ctrl+Y wraca do pisma B, ale bez decyzji: to inna wersja tekstu niż ta z chwili decyzji
    await ta.focus();
    await page.keyboard.press(redo);
    assert.equal(await ta.inputValue(), B, 'Ctrl+Y nie wrócił do pisma B');
    await settled(page);
    await assertHidden(page, 'Kowalski', 'inspektor po Ctrl+Y');
    assert.equal(await page.locator('#output mark.pii-kept').count(), 0);
  });
});

test('Ctrl+A, Delete i Ctrl+Z w polu: „wszędzie” wraca jako reguła, a „tutaj” trzeba zrobić od nowa (zgłoszenie: jedno miejsce)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = `Decyzja w sprawie działki, księga wieczysta nr ${KW}, wnioskodawca Jan Kowalski, PESEL 44051401359.\nUzasadnienie jest krótkie.`;
    const B = 'Notatka służbowa: wnioskodawca Adam Nowak, PESEL 85071412358, stawił się osobiście w urzędzie.';
    const ta = page.locator('#input');
    for (const all of [true, false]) {
      for (const via of ['wklej', 'usun']) {
        await page.locator('#clear').click();
        await ta.click();
        await page.keyboard.insertText(A);
        await app.waitForOutput('[PESEL]');
        await maskFromSource(page, KW, all);
        await app.waitForOutput('[DANE]');
        await ta.focus();
        await page.keyboard.press('ControlOrMeta+a');
        if (via === 'wklej') {
          await page.keyboard.insertText(B);
          await settled(page);
          await page.keyboard.press('End');
          await page.keyboard.insertText(' Uwagi');
        } else {
          await page.keyboard.press('Delete');
          await settled(page);
          await page.keyboard.insertText('Nowe pismo');
        }
        await settled(page);
        for (let i = 0; i < 4 && (await ta.inputValue()) !== A; i++) {
          await page.keyboard.press('ControlOrMeta+z');
          await settled(page);
        }
        assert.equal(await ta.inputValue(), A, `${via}: Ctrl+Z nie wrócił do pisma A`);
        if (all) {
          await assertHidden(page, '00045123', `${via}: księga wieczysta`);
        } else {
          // zasłonięcie „tutaj” należało do tekstu sprzed edycji: urzędnik wie, że ma je zrobić od nowa
          assert.equal(await fixNote(page), DROP1, `${via}: brak notki`);
          assert.equal(await page.locator('#output mark.pii', { hasText: '[DANE]' }).count(), 0);
        }
      }
    }
  });
});

test('„Cofnij” na pasku po „Wyczyść” przywraca tekst bez ręcznych poprawek i mówi o tym', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, `Księga wieczysta ${KW}. Wnioskodawca Jan Kowalski, PESEL 44051401359.`);
    await maskFromSource(page, KW);
    await app.waitForOutput('[DANE]');
    await page.locator('#clear').click();
    await page.waitForFunction(() => !!document.querySelector('#output .placeholder'));
    await page.locator('#app-note-undo').click();
    await app.waitForOutput('[PESEL]');
    assert.equal(
      await page.locator('#app-note-status').textContent(),
      'Przywrócono poprzedni tekst. Jego ręczne poprawki trzeba zrobić od nowa.',
    );
    assert.equal(await page.locator('#fix-foot').isHidden(), true);
  });
});

test('Ctrl+Z w wyniku po edycji źródła nic nie przywraca: stos poprawek zeruje się (zgłoszenie: stary stos)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Świadek Adam Nowak zeznał. Świadek Ewa Lis zeznała. Świadek Jan Kot zeznał. Wnioskodawca PESEL 44051401359.';
    await paste(page, T);
    await page.locator('#output mark.pii').nth(1).click();
    assert.equal(await page.locator('#fix-bar-val').textContent(), 'Ewa Lis');
    await page.locator('#fix-keep').click();
    await app.waitForOutput('Ewa Lis');
    await page.locator('#fix-clear').click();
    await page.waitForFunction(() => !(document.getElementById('output')?.textContent ?? '').includes('Ewa Lis'));
    // usunięcie początku pisma: „Jan Kot” staje tam, gdzie wcześniej stała „Ewa Lis”
    await selectInSource(page, 0, T.indexOf('Jan Kot') - T.indexOf('Ewa Lis'));
    await page.keyboard.press('Delete');
    await page.waitForFunction(
      () => ((document.getElementById('output')?.textContent ?? '').match(/\[IMIĘ I NAZWISKO\]/g) ?? []).length === 2,
    );
    await page.locator('#output mark.pii').first().focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    await assertHidden(page, 'Jan Kot', 'osoba, o której nikt nie decydował');
    await assertHidden(page, 'Ewa Lis', 'poprawka sprzed edycji');
  });
});

test('Ctrl+Z przez wiele pism do pierwszego nie przenosi na nie „Zostaw jawne wszędzie” (zgłoszenie: dziesięć pism)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const tematy = ['drogi gminnej', 'oświetlenia', 'wycinki drzew', 'podatku', 'opłaty śmieciowej', 'dowozu dzieci', 'remontu szkoły', 'planu miejscowego'];
    const docs = [
      'Skarżący Jan Kowalski, zam. w Brzozowej Woli, prosi o interwencję w sprawie hałasu.',
      'Sprawę prowadzi inspektor Jan Kowalski. Pismo podpisał Jan Kowalski, inspektor.',
      ...tematy.map((x, i) => `Notatka nr ${i + 2} w sprawie ${x}. Przyjął referent Adam Zieliński w pokoju ${i + 2}.`),
    ];
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(docs[0]);
    await app.waitForOutput('Skarżący');
    await settled(page);
    for (let i = 1; i < docs.length; i++) {
      await pasteOver(page, docs[i]);
      await settled(page);
      if (i === 1) {
        await page.locator('#output mark.pii').first().click();
        await page.locator('#fix-keep-all').click();
        await page.waitForFunction(() => !document.querySelector('#output mark.pii:not(.pii-kept)'));
      }
    }
    for (let i = docs.length - 1; i > 0; i--) {
      await ta.focus();
      await page.keyboard.press('ControlOrMeta+z');
      await settled(page);
    }
    assert.equal(await ta.inputValue(), docs[0], 'Ctrl+Z nie wrócił do pierwszego pisma');
    await assertHidden(page, 'Kowalski', 'nazwisko skarżącego');
  });
});

test('ponownie wstawione pismo nie dostaje przy Ctrl+Z dawnego „Zostaw jawne wszędzie” (zgłoszenia: repaste, stale)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = 'Sprawę prowadzi inspektor Jan Kowalski. Pismo podpisał Jan Kowalski, inspektor.';
    const C = 'Notatka w sprawie oświetlenia ulicy. Przyjął referent Adam Zieliński w pokoju 4.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('Sprawę');
    await settled(page);
    await page.locator('#output mark.pii').first().click();
    await page.locator('#fix-keep-all').click();
    await app.waitForOutput('Jan Kowalski');
    // wariant 1: Ctrl+A, Delete, to samo pismo od nowa, inne pismo i Ctrl+Z
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => !!document.querySelector('#output .placeholder'));
    await page.keyboard.insertText(A);
    await settled(page);
    await pasteOver(page, C);
    await settled(page);
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A);
    await assertHidden(page, 'Kowalski', 'inspektor z dawnej decyzji');
    // wariant 2: „Wyczyść”, to samo pismo od nowa, Ctrl+A, Delete i Ctrl+Z
    await page.locator('#output mark.pii').nth(1).click();
    await page.locator('#fix-keep-all').click();
    await app.waitForOutput('Jan Kowalski');
    await page.locator('#clear').click();
    await page.waitForFunction(() => !!document.querySelector('#output .placeholder'));
    await ta.click();
    await page.keyboard.insertText(A);
    await settled(page);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('Delete');
    await page.waitForFunction(() => !!document.querySelector('#output .placeholder'));
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A);
    await assertHidden(page, 'Kowalski', 'inspektor z decyzji sprzed „Wyczyść”');
  });
});

test('Ctrl+Z do pisma z tego samego wzoru nie odsłania wnioskodawcy decyzją z drugiego pisma (zgłoszenie: wzór)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const body =
      ' Na podstawie art. 104 Kodeksu postępowania administracyjnego, po rozpatrzeniu wniosku o wydanie decyzji o warunkach' +
      ' zabudowy dla inwestycji polegającej na budowie budynku mieszkalnego jednorodzinnego na działce nr 123/4 w obrębie' +
      ' Zalesie, orzeka się jak w sentencji. Od decyzji służy odwołanie w terminie 14 dni od dnia doręczenia.';
    const A = `Sprawę prowadzi inspektor Anna Nowak. Wnioskodawca: Jan Kot, PESEL 44051401359.${body}`;
    const B = `Sprawę prowadzi inspektor Jan Kot, kontakt: inspektor Jan Kot. Wnioskodawca: Ewa Lis, PESEL 02070803628.${body}`;
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await pasteOver(page, B);
    await settled(page);
    await page.locator('#output mark.pii').first().click();
    assert.equal(await page.locator('#fix-bar-val').textContent(), 'Jan Kot');
    await page.locator('#fix-keep-all').click();
    await app.waitForOutput('inspektor Jan Kot');
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A);
    await assertHidden(page, 'Jan Kot', 'wnioskodawca');
    assert.equal(await fixNote(page), DROP1);
  });
});

test('podmiana prawie całego pisma bez Ctrl+A i Ctrl+Z nie przenosi „Zostaw jawne wszędzie” (zgłoszenie: nagłówek)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const H = 'Urząd Gminy Zalesie\n';
    const A = `${H}Wnioskodawca: Jan Kot, PESEL 44051401359, wnosi o wydanie zaświadczenia o niezaleganiu w podatkach.`;
    const B = 'Pismo przygotował inspektor Jan Kot. Kontakt: inspektor Jan Kot, pokój 12, telefon wewnętrzny 44.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await selectInSource(page, H.length, A.length);
    await page.keyboard.insertText(B);
    await app.waitForOutput('pokój 12');
    await settled(page);
    await page.locator('#output mark.pii').first().click();
    await page.locator('#fix-keep-all').click();
    await app.waitForOutput('inspektor Jan Kot');
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A);
    await assertHidden(page, 'Jan Kot', 'wnioskodawca');
  });
});

test('Ctrl+Z w wyniku po „Zasłoń ponownie” i edycji źródła nie odsłania innej danej (zgłoszenie: stary stos)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Pismo przygotowano w Wydziale Spraw Obywatelskich urzędu.\nWniosek podpisał Sławomir Kędzierski, PESEL 44051401359.\nKoniec.';
    await paste(page, T);
    await page.locator('#output mark.pii', { hasText: '[IMIĘ I NAZWISKO]' }).first().click();
    await page.locator('#fix-keep').click();
    await page.locator('#output mark.pii-kept').first().click();
    await page.locator('#fix-remask').click();
    await page.waitForFunction(() => !document.querySelector('#output mark.pii-kept'));
    const cut = ' w Wydziale Spraw Obyw';
    const a = T.indexOf(cut);
    await selectInSource(page, a, a + cut.length);
    await page.keyboard.press('Delete');
    await settled(page);
    await page.locator('#output').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    await assertHidden(page, '44051401359', 'PESEL');
    await assertHidden(page, 'Kędzierski', 'nazwisko');
  });
});

test('Ctrl+Z i Ctrl+Y w polu: zasłonięcie „wszędzie” działa w każdej wersji pisma, bez miejsca zostaje na liście (zgłoszenie: Ctrl+Y)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = 'Pismo pierwsze. Wnioskodawca Jan Kowalski, PESEL 44051401359, mieszka w Radomiu.';
    const B = `Zupełnie inne pismo o księdze wieczystej ${KW} dotyczące Adama Nowaka, PESEL 85071412358, i działki.`;
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await pasteOver(page, B);
    await app.waitForOutput('Zupełnie');
    await settled(page);
    await maskFromSource(page, KW, true);
    await app.waitForOutput('[DANE]');
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A);
    // w piśmie A numeru nie ma: reguła zostaje na liście z „0 miejsc”, a notka to mówi
    assert.match(await fixNote(page), /nie ma teraz w piśmie \(0 miejsc\)/);
    await page.locator('#fix-show').click();
    assert.match(await page.locator('#fix-list').innerText(), /wszędzie: OS1W\/00045123\/6, 0 miejsc/);
    await ta.focus();
    await page.keyboard.press(redo);
    await settled(page);
    assert.equal(await ta.inputValue(), B);
    await assertHidden(page, '00045123', 'księga wieczysta po Ctrl+Y');
    assert.equal(await fixNote(page), '');
  });
});

test('Ctrl+Z i Ctrl+Y w wyniku bez poprawek do cofnięcia nie zmieniają tekstu źródłowego', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = 'Wnioskodawca Jan Kowalski, PESEL 44051401359, wnosi o wydanie decyzji.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await ta.evaluate((el) => /** @type {HTMLTextAreaElement} */ (el).setSelectionRange(0, 0));
    await page.keyboard.insertText('Pismo. ');
    await settled(page);
    await page.locator('#output').focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), `Pismo. ${A}`, 'Ctrl+Z w wyniku zmienił pole źródła');
    // Ctrl+Z w polu cofa wpisanie, a Ctrl+Y w wyniku nie może go ponowić
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A);
    await page.locator('#output').focus();
    await page.keyboard.press(redo);
    await settled(page);
    assert.equal(await ta.inputValue(), A, 'Ctrl+Y w wyniku zmienił pole źródła');
  });
});

test('„Zasłoń wszędzie” na numerze KW: litera doklejona do numeru nie odsłania go (zgłoszenie: doklejona litera)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = `Decyzja nr 14/2024 w sprawie działki, księga wieczysta nr ${KW}.\nUzasadnienie jest krótkie.`;
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(T);
    await app.waitForOutput('Uzasadnienie');
    await maskFromSource(page, KW, true);
    await app.waitForOutput('[DANE]');
    const end = T.indexOf(KW) + KW.length;
    await selectInSource(page, end, end);
    await page.keyboard.insertText('a');
    await settled(page);
    await assertHidden(page, '00045123', 'księga wieczysta z doklejoną literą');
  });
});

test('literówka w ręcznym zasłonięciu: „tutaj” odpada z komunikatem, „wszędzie” zostaje na liście z 0 miejsc (zgłoszenie: Zagroda)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Wniosek dotyczy działki. Kod dostępu do skrzynki: Trzmielowa-Zagroda-77QX, proszę nie udostępniać.';
    const ta = page.locator('#input');
    for (const all of [false, true]) {
      await page.locator('#clear').click();
      await ta.click();
      await page.keyboard.insertText(T);
      await app.waitForOutput('Zagroda');
      await maskFromSource(page, 'Zagroda', all);
      await app.waitForOutput('[DANE]');
      const r = T.indexOf('Zagroda') + 3;
      await selectInSource(page, r, r + 1);
      await page.keyboard.insertText('x');
      await settled(page);
      assert.ok((await ta.inputValue()).includes('Zagxoda'));
      if (all) {
        assert.match(await fixNote(page), /^Tekstu jednego zasłonięcia „wszędzie” nie ma teraz w piśmie \(0 miejsc\)/);
        assert.match((await page.locator('#sr-status').textContent()) ?? '', /0 miejsc/);
        await page.locator('#fix-show').click();
        assert.match(await page.locator('#fix-list').innerText(), /wszędzie: Trzmielowa-Zagroda-77QX, 0 miejsc/);
        // poprawka wraca: reguła znów zasłania
        await selectInSource(page, r, r + 1);
        await page.keyboard.insertText('r');
        await settled(page);
        await assertHidden(page, 'Zagroda', 'fragment „wszędzie” po powrocie tekstu');
      } else {
        assert.equal(await fixNote(page), DROP1);
        assert.equal(await page.locator('#fix-foot li').count(), 0);
      }
    }
  });
});

test('Ctrl+Z na pasku poprawki i po „Cofnij ostatnią” cofa poprawkę, a nie podmienia pisma w polu (zgłoszenie: fokus na przycisku)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = 'Decyzja nr 14/2024. Wnioskodawca Jan Kowalski, PESEL 44051401359, wnosi o wydanie decyzji.';
    const B = 'Sprawę prowadzi inspektor Ewa Lis. Kontakt z inspektor Ewa Lis w pokoju 12.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await pasteOver(page, B);
    await app.waitForOutput('pokoju 12');
    await settled(page);
    for (const button of ['#fix-keep', '#fix-keep-all']) {
      await page.locator('#output mark.pii').first().click();
      await page.locator(button).click();
      await app.waitForOutput('Ewa Lis');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'fix-remask');
      await page.keyboard.press('ControlOrMeta+z');
      await settled(page);
      assert.equal(await ta.inputValue(), B, `${button}: Ctrl+Z na pasku zmienił pole źródła`);
      assert.ok(!(await outText(page)).includes('Ewa Lis'), `${button}: Ctrl+Z nie cofnął „Zostaw jawne”`);
      await page.keyboard.press(redo);
      await settled(page);
      assert.equal(await ta.inputValue(), B, `${button}: Ctrl+Y na pasku zmienił pole źródła`);
    }
    // „Cofnij ostatnią” zostawia fokus na body: Ctrl+Z dalej nie sięga historii pola
    await page.locator('#output mark.pii').first().click();
    await page.locator('#fix-keep').click();
    await app.waitForOutput('Ewa Lis');
    await page.locator('#fix-undo').click();
    await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), B, 'Ctrl+Z bez fokusu zmienił pole źródła');
    await page.locator('#clear').focus();
    for (const key of ['ControlOrMeta+z', 'ControlOrMeta+y', 'ControlOrMeta+Shift+z']) {
      await page.keyboard.press(key);
      await settled(page);
      assert.equal(await ta.inputValue(), B, `${key} na „Wyczyść” zmienił pole źródła`);
    }
  });
});

test('podmiana pisma poza nagłówkiem zeruje kartę razem z poprawkami (zgłoszenie: częściowa podmiana)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const H = 'URZĄD GMINY BRZOZOWA WOLA\n';
    const A = `${H}Wnioskodawca Jan Kowalski, PESEL 44051401359, wnosi o wydanie zaświadczenia o niezaleganiu w podatkach lokalnych.`;
    const B = 'Wnioskodawczyni Ewa Malinowska, PESEL 85071412358, wnosi o zwrot opłaty skarbowej.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('[PESEL]');
    await page.locator('#output mark.pii').first().click();
    await page.locator('#fix-keep').click();
    await app.waitForOutput('Jan Kowalski');
    await openCard(page);
    await page.locator('#pub-znak').fill('RGK.6131.47.2026');
    await page.locator('#pub-adnotacja').fill('Wyłączono dane Jana Kowalskiego z ul. Lipowej 17.');
    await page.locator('#pub-append').check();
    await selectInSource(page, H.length, A.length);
    await page.keyboard.insertText(B);
    await settled(page);
    assert.equal(await fixNote(page), DROP1);
    assert.equal(await page.locator('#pub-znak').inputValue(), '');
    assert.equal(await page.locator('#pub-append').isChecked(), false);
    await assertHidden(page, 'Lipowej 17', 'adnotacja poprzedniego pisma');
  });
});

test('wklejenie mniej niż połowy pisma przy zostawionym nagłówku zdejmuje „Zostaw jawne”, a karta zostaje (zgłoszenie: duże wklejenie)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const head =
      'URZĄD GMINY BRZOZOWA WOLA, ul. Główna 1, 99-999 Brzozowa Wola.\nZnak sprawy podano w karcie pisma, a pismo idzie do akt sprawy.\n' +
      'Adresat: Sławomir Kędzierski, Opole.\nW sprawie planu miejscowego dla obrębu Zalesie i sąsiednich działek gminnych.\n';
    const A = `${head}Wójt zawiadamia o wyłożeniu projektu planu. Mapa z projektem.`;
    const B = 'Wójt informuje, że Bogumiła Nowicka złożyła uwagę do projektu, a Edward Wilk ją poparł.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('Mapa');
    await page.locator('#output mark.pii', { hasText: '[IMIĘ I NAZWISKO]' }).first().click();
    assert.equal(await page.locator('#fix-bar-val').textContent(), 'Sławomir Kędzierski');
    await page.locator('#fix-keep').click();
    await app.waitForOutput('Kędzierski');
    await openCard(page);
    await page.locator('#pub-znak').fill('RGK.6131.47.2026');
    await selectInSource(page, head.length, A.length);
    await page.keyboard.insertText(B);
    await settled(page);
    await assertHidden(page, 'Kędzierski', 'adresat z decyzji podjętej przy innej treści');
    assert.equal(await fixNote(page), DROP1);
    // zmiana objęła mniej niż połowę pisma: karta zostaje
    assert.equal(await page.locator('#pub-znak').inputValue(), 'RGK.6131.47.2026');
  });
});

test('edycja po „Zostaw jawne” zdejmuje decyzję, a Ctrl+Z i Ctrl+Y w polu jej nie wskrzeszają (zgłoszenia: dopisek, nieaktualny wpis)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Wniosek złożył Sławomir Kędzierski, zam. w Opolu, w sprawie dzialka nr 12.\nKoniec';
    const ta = page.locator('#input');
    const edits = {
      literowka: async () => {
        const at = T.indexOf('dzialka') + 3;
        await selectInSource(page, at, at + 1);
        await page.keyboard.insertText('ł');
      },
      kropka: async () => {
        await selectInSource(page, T.length, T.length);
        await page.keyboard.insertText('.');
      },
      dopisek: async () => {
        await ta.focus();
        await page.keyboard.press('ControlOrMeta+End');
        await page.keyboard.insertText(' Pilne');
      },
    };
    for (const [via, edit] of Object.entries(edits)) {
      await page.locator('#clear').click();
      await ta.click();
      await page.keyboard.insertText(T);
      await app.waitForOutput('Koniec');
      await page.locator('#output mark.pii').first().click();
      assert.equal(await page.locator('#fix-bar-val').textContent(), 'Sławomir Kędzierski');
      await page.locator('#fix-keep').click();
      await app.waitForOutput('Kędzierski');
      await edit();
      await settled(page);
      await assertHidden(page, 'Kędzierski', `${via}: decyzja po edycji`);
      assert.equal(await fixNote(page), DROP1, `${via}: brak notki`);
      await ta.focus();
      for (const key of ['ControlOrMeta+z', 'ControlOrMeta+z', redo, 'ControlOrMeta+z']) {
        await page.keyboard.press(key);
        await settled(page);
        if (!(await ta.inputValue()).trim()) continue;
        await assertHidden(page, 'Kędzierski', `${via}, ${key}: wycofane „Zostaw jawne”`);
      }
    }
  });
});

test('Ctrl+Z w polu karty pisma nie podmienia pisma w polu źródła (zgłoszenie: karta)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const A = 'Pismo A. Wniosek złożył Sławomir Kędzierski, zam. w Opolu.';
    const B = 'Pismo B. Skarga Anny Malinowskiej na bezczynność organu.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(A);
    await app.waitForOutput('złożył');
    await page.locator('#output mark.pii').first().click();
    await page.locator('#fix-keep').click();
    await app.waitForOutput('Kędzierski');
    await pasteOver(page, B);
    await settled(page);
    await openCard(page);
    await page.locator('#pub-znak').click();
    await page.keyboard.type('OR.1431.5');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ControlOrMeta+z');
      await settled(page);
    }
    assert.equal(await ta.inputValue(), B, 'Ctrl+Z w karcie zmienił pole źródła');
    await assertHidden(page, 'Kędzierski', 'pismo A');
    // Ctrl+Z w samym polu źródła dalej cofa wklejenie, ale bez decyzji z pisma A
    await ta.focus();
    await page.keyboard.press('ControlOrMeta+z');
    await settled(page);
    assert.equal(await ta.inputValue(), A, 'Ctrl+Z w polu źródła nie cofnął wklejenia');
    await assertHidden(page, 'Kędzierski', 'pismo A po Ctrl+Z w polu');
  });
});

test('Ctrl+Z i Ctrl+Y w polu źródła nie zmieniają karty pisma (zgłoszenia: znak sprawy, podwójny znak)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const C = 'Skarga z dnia 3 maja 2024 r. Skarżący Piotr Zieliński, PESEL 90010112345, wnosi o rozpatrzenie sprawy.';
    const A = 'Decyzja nr 14/2024. Wnioskodawca Jan Kowalski, PESEL 44051401359, zam. ul. Lipowa 5, 00-950 Warszawa.';
    const ZN = 'ZN.6220.1.2024';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(C);
    await app.waitForOutput('[PESEL]');
    await openCard(page);
    await page.locator('#pub-znak').click();
    await page.keyboard.type(ZN);
    await ta.focus();
    // Wspólna historia Chromium: Ctrl+Z w polu źródła trafia najpierw na wpisy karty. Krok przechodzi,
    // ale znak zostaje, fokus wraca do pola, a komunikat mówi, co się stało. Firefox cofa od razu pismo.
    let hops = 0;
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('ControlOrMeta+z');
      await settled(page);
      if ((await ta.inputValue()) !== C) break;
      hops++;
      assert.equal(await page.locator('#pub-znak').inputValue(), ZN, 'Ctrl+Z w polu źródła zmienił znak sprawy');
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'input');
      assert.match((await page.locator('#sr-status').textContent()) ?? '', /^Skrót trafił na wpis w polu „Znak sprawy”/);
    }
    if (BROWSER === 'chromium') assert.ok(hops > 0, 'Chromium nie przeszedł przez wpis karty');
    assert.notEqual(await ta.inputValue(), C, 'Ctrl+Z w polu źródła nie cofnął wpisania pisma');
    // podwójny znak: wpis w karcie, nowe pismo przez Ctrl+A, Ctrl+Z do poprzedniego i Ctrl+Y
    await pasteOver(page, C);
    await settled(page);
    await page.locator('#pub-znak').fill(ZN);
    await page.locator('#pub-znak').fill(ZN);
    await pasteOver(page, A);
    await settled(page);
    assert.equal(await page.locator('#pub-znak').inputValue(), '', 'karta nie wyzerowała się po Ctrl+A i wklejeniu');
    await ta.focus();
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ControlOrMeta+z');
      await settled(page);
    }
    await page.keyboard.press(redo);
    await settled(page);
    const znak = await page.locator('#pub-znak').inputValue();
    assert.ok(znak === '' || znak === ZN, `znak sprawy po Ctrl+Y w polu źródła: „${znak}”`);
    assert.equal(znak.split('ZN.').length - 1 <= 1, true);
  });
});

test('nowe brzmienie wiersza z ręcznym zasłonięciem nie zasłania całego wiersza (zgłoszenie: wiersz)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Wniosek o podział działki.\nNieruchomość leży w obrębie Zagroda, przy drodze gminnej.\nKoniec pisma.';
    const line = T.split('\n')[1];
    const typed = 'Nieruchomość leży w obrębie geodezyjnym Rokitnica, przy drodze powiatowej nr 2228G, na skraju lasu.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(T);
    await app.waitForOutput('Koniec');
    await maskFromSource(page, 'Zagroda');
    await app.waitForOutput('[DANE]');
    const at = T.indexOf(line);
    await selectInSource(page, at, at + line.length);
    await page.keyboard.insertText(typed);
    await settled(page);
    assert.ok((await outText(page)).includes('na skraju lasu'), 'nowe brzmienie wiersza zasłonięte');
    assert.ok(!(await outText(page)).includes('[DANE]'));
    assert.equal(await fixNote(page), DROP1);
  });
});

test('Enter i zmiana w środku ręcznego zasłonięcia: „tutaj” odpada z komunikatem, „wszędzie” nie łączy wierszy (zgłoszenie: Enter)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Notatka służbowa.\nRozmowę przeprowadzono z mieszkanką osiedla Zielone Wzgórze w gminie, która wnosi o zwrot.\nKoniec.';
    const ta = page.locator('#input');
    const space = T.indexOf('Zielone Wzgórze') + 'Zielone'.length;
    for (const all of [false, true]) {
      await page.locator('#clear').click();
      await ta.click();
      await page.keyboard.insertText(T);
      await app.waitForOutput('Koniec');
      await maskFromSource(page, 'Zielone Wzgórze', all);
      await app.waitForOutput('[DANE]');
      await selectInSource(page, space, space + 1);
      await page.keyboard.press('Enter');
      await settled(page);
      assert.equal(await ta.inputValue(), T.replace('Zielone Wzgórze', 'Zielone\nWzgórze'));
      // wynik ma tyle wierszy co źródło: znacznik nie połyka końca wiersza
      assert.equal(await page.locator('#output > .cl').count(), 4);
      assert.ok(!(await outText(page)).includes('[DANE]'), 'ciąg rozdzielony enterem to już inny tekst');
      if (all) assert.match(await fixNote(page), /\(0 miejsc\)/);
      else assert.equal(await fixNote(page), DROP1);
    }
    // zmiana od środka zasłonięcia poza nie: „tutaj” odpada z komunikatem, bez połowy zakresu
    const U = 'Działka leży w obrębie Zagroda Górna przy drodze gminnej.\nKoniec';
    await page.locator('#clear').click();
    await ta.click();
    await page.keyboard.insertText(U);
    await app.waitForOutput('Koniec');
    await maskFromSource(page, 'Zagroda Górna');
    await app.waitForOutput('[DANE]');
    const g = U.indexOf('Górna przy');
    await selectInSource(page, g, g + 'Górna przy'.length);
    await page.keyboard.insertText('Dolna obok');
    await settled(page);
    assert.equal(await fixNote(page), DROP1);
    assert.equal(await page.locator('#output mark.pii', { hasText: '[DANE]' }).count(), 0);
  });
});

test('„Zasłoń wszędzie” po zmianie wyrazu dwuklikiem zasłania każde dosłowne wystąpienie (zgłoszenie: dwuklik)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Działka leży w obrębie Zagroda przy drodze gminnej.\nOgłoszenie wywieszono w Zagroda oraz w urzędzie.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(T);
    await app.waitForOutput('urzędzie');
    await maskFromSource(page, 'Zagroda', true);
    await page.waitForFunction(() => ((document.getElementById('output')?.textContent ?? '').match(/\[DANE\]/g) ?? []).length === 2);
    // dwuklik w Windows zaznacza wyraz razem z odstępem za nim
    const second = T.lastIndexOf('Zagroda ');
    await selectInSource(page, second, second + 'Zagroda '.length);
    await page.keyboard.insertText('Zagrodzie ');
    await settled(page);
    assert.equal(await countIn(page, '[DANE]'), 1);
    assert.ok(!(await outText(page)).includes('obrębie Zagroda'), 'pierwsze wystąpienie jawne');
    await page.locator('#fix-show').click();
    assert.match(await page.locator('#fix-list').innerText(), /wszędzie: Zagroda, 1 miejsce/);
    // poprawiona forma z dosłownym ciągiem reguły („Zagrodach”) znów jest zasłonięta w tym ciągu
    const now = await ta.inputValue();
    const z = now.indexOf('Zagrodzie');
    await selectInSource(page, z, z + 'Zagrodzie'.length);
    await page.keyboard.insertText('Zagrodach');
    await settled(page);
    await assertHidden(page, 'Zagroda', 'reguła „wszędzie”');
  });
});

test('Ctrl+X i Ctrl+V wiersza z regułą „wszędzie”: po wklejeniu tekst znów jest zasłonięty (zgłoszenie: przeniesienie wiersza)', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    const T = 'Wniosek o ustalenie warunków zabudowy.\nUzasadnienie: do wniosku dołączono mapę.\nKoniec pisma.';
    const ta = page.locator('#input');
    await ta.click();
    await page.keyboard.insertText(T);
    await app.waitForOutput('Koniec');
    await selectInOutput(page, 'mapę');
    await page.locator('#fix-sel-out').click();
    assert.equal(await page.locator('#fix-all').isChecked(), true);
    await page.locator('#fix-apply').click();
    await app.waitForOutput('[DANE]');
    const line = T.split('\n')[1];
    const at = T.indexOf(line);
    await selectInSource(page, at, at + line.length + 1);
    await page.keyboard.press('ControlOrMeta+x');
    await settled(page);
    assert.match(await fixNote(page), /\(0 miejsc\)/);
    await selectInSource(page, T.length - line.length - 1, T.length - line.length - 1);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+v');
    await settled(page);
    assert.ok((await ta.inputValue()).includes('dołączono mapę'), 'Ctrl+V nie wkleił wiersza');
    await assertHidden(page, 'mapę', 'przeniesiony wiersz');
    assert.equal(await fixNote(page), '');
  });
});
