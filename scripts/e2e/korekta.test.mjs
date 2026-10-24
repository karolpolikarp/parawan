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

    // Tab do wyniku: przystanek na znaczniku, strzałki, Enter otwiera pasek, Enter „Zostaw jawne”
    await page.locator('#output').focus();
    await page.keyboard.press('Tab');
    const active = () => page.evaluate(() => document.activeElement?.textContent ?? '');
    assert.equal(await active(), '[IMIĘ I NAZWISKO]');
    await page.keyboard.press('ArrowDown'); // „Anną” w pierwszym wierszu (zasłonięta ręcznie)
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

test('edycja źródła przesuwa poprawki, a „Wyczyść” usuwa wszystkie', async (t) => {
  await withApp(browser, t, '', async (app) => {
    const { page } = app;
    await paste(page, DECYZJA);
    await page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii').click();
    await page.locator('#fix-keep').click();
    await page.locator('#output mark.pii-kept').waitFor();
    // dopisek na początku pisma: poprawka przesuwa się razem z tekstem
    await page.locator('#input').evaluate((el) => {
      const ta = /** @type {HTMLTextAreaElement} */ (el);
      ta.value = `Pismo do akt.\n${ta.value}`;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await app.waitForOutput('Pismo do akt.');
    assert.equal(await page.locator('#output mark.pii-kept').innerText(), 'Sławomir Kędzierski');
    // zmiana w środku przywróconego nazwiska: poprawka odpada z komunikatem
    await page.locator('#input').evaluate((el) => {
      const ta = /** @type {HTMLTextAreaElement} */ (el);
      ta.value = ta.value.replace('Sławomir Kędzierski', 'Sławomir Kędzierskii');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.locator('#fix-note').waitFor();
    assert.equal(await page.locator('#fix-note').innerText(), 'Po zmianie tekstu źródłowego odrzucono 1 ręczną poprawkę.');
    assert.equal(await page.locator('#output mark.pii-kept').count(), 0);
    // nowa poprawka i „Wyczyść”: po nowym tekście nie ma śladu poprzednich
    await page.locator('#output .cl', { hasText: '/-/' }).locator('mark.pii').click();
    await page.locator('#fix-keep').click();
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
