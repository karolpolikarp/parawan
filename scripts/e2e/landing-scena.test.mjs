// Scena „Parawany stają tylko przy danych” na stronie produktu (apps/landing, src/plaza.ts):
//  1) przewijanie klatka po klatce na laptopie i telefonie: oryginał danej jest widoczny tylko
//     w całości, a zanim miejsce zacznie się zwężać do szerokości znacznika, znika naraz
//     (zasada „maskuj całość” z DESIGN.md: żadna klatka nie pokazuje fragmentu danej);
//  2) bez JavaScriptu: stan końcowy policzony przy buildzie (pismo, okno z tekstem, adresat);
//  3) prefers-reduced-motion: od razu stan końcowy i przycisk z oryginałem.
//  4) rozmiar gotowej strony i podstrony /log/.
// Uruchomienie: npm run e2e (po buildzie landingu).
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { LANDING_HTML, launch, withApp } from './helpers.mjs';

/** @type {import('playwright').Browser} */
let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** Stan każdej maski w bieżącej klatce (w przeglądarce). */
function klatka() {
  const wynik = { maski: 0, widoczne: 0, problemy: [] };
  for (const d of document.querySelectorAll('#tresc .d')) {
    wynik.maski++;
    if (d.classList.contains('lab')) continue;
    const o = d.querySelector('.o');
    const q = Number(d.style.getPropertyValue('--q') || 0);
    const widac = getComputedStyle(o).visibility !== 'hidden' && getComputedStyle(o).display !== 'none';
    if (!widac) continue;
    wynik.widoczne++;
    const tekst = o.textContent;
    // miejsce zaczyna się zwężać od q = .45; oryginał musi zniknąć wcześniej (od q = .4)
    if (q > 0.4) wynik.problemy.push(`„${tekst}” widoczny przy q = ${q}`);
    // widoczny oryginał nie może być przycięty w poziomie przez miejsce maski
    const szer = d.getBoundingClientRect().width + 8; // clip-path ma po 4 px zapasu z obu stron
    const ro = o.getBoundingClientRect();
    if (szer + 0.5 < ro.width) wynik.problemy.push(`„${tekst}” przycięty: ${szer.toFixed(1)} < ${ro.width.toFixed(1)}`);
    // ani przez brzeg kartki (overflow: hidden), np. długi numer konta na wąskim ekranie
    const rk = document.querySelector('.kartka').getBoundingClientRect();
    if (ro.left < rk.left - 0.5 || ro.right > rk.right + 0.5) wynik.problemy.push(`„${tekst}” wychodzi poza kartkę`);
  }
  return wynik;
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
]) {
  test(`landing ${viewport.width} px: żadna klatka sceny nie pokazuje fragmentu danej`, async (t) => {
    await withApp(
      browser,
      t,
      '',
      async ({ page }) => {
        await page.waitForLoadState('load');
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.classList.contains('ruch')), 'scena bez ruchu');
        const [y0, y1] = await page.evaluate(() => {
          const r = document.getElementById('plaza').getBoundingClientRect();
          return [scrollY + r.top - innerHeight, scrollY + r.bottom];
        });
        let widzianoOryginal = 0;
        let widzianoZnacznik = 0;
        const KROKI = 200;
        for (let i = 0; i <= KROKI; i++) {
          await page.evaluate((y) => window.scrollTo(0, y), y0 + ((y1 - y0) * i) / KROKI);
          await page.clock.runFor(40); // klatka liczy się w requestAnimationFrame
          const k = await page.evaluate(klatka);
          assert.deepEqual(k.problemy, [], `klatka ${i}`);
          widzianoOryginal = Math.max(widzianoOryginal, k.widoczne);
          widzianoZnacznik = Math.max(
            widzianoZnacznik,
            await page.evaluate(() => document.querySelectorAll('#tresc .d.lab').length),
          );
        }
        // strażnik strażnika: animacja naprawdę szła (oryginały były widać, a na końcu same znaczniki)
        assert.ok(widzianoOryginal > 0, 'w żadnej klatce nie było oryginału, więc test niczego nie sprawdził');
        const n = await page.evaluate(() => document.querySelectorAll('#tresc .d').length);
        assert.equal(widzianoZnacznik, n, 'po przewinięciu nie wszystkie maski doszły do znacznika');
        assert.equal(await page.evaluate(() => document.querySelector('#podsum').classList.contains('gotowe')), true);
      },
      { file: LANDING_HTML, viewport, reducedMotion: 'no-preference' },
    );
  });
}

test('landing bez JavaScriptu: scena, okno z tekstem i adresat w stanie końcowym', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async ({ page }) => {
      await page.waitForLoadState('load');
      const s = await page.evaluate(() => ({
        maski: document.querySelectorAll('#tresc .d').length,
        znaczniki: document.querySelectorAll('#tresc .d.lab').length,
        wynik: document.querySelectorAll('#demo-output mark.pii').length,
        pismo: document.querySelector('#plaza').innerText,
        adres: document.querySelector('.o-adres .ad').innerText,
        stat: document.getElementById('demo-stat').textContent,
        logo: !!document.querySelector('.pasek .gi svg'),
        pocztowka: !!document.querySelector('.kadr svg[role="img"]'),
      }));
      assert.ok(s.maski > 5, `masek w piśmie: ${s.maski}`);
      assert.equal(s.znaczniki, s.maski);
      assert.equal(s.wynik, 10);
      for (const dana of ['Kowalczyk', 'Długa 7/12', '30-512', '90031512348', 'PL61', '512 345 678', 'Zielińska', 'Nowak']) {
        assert.ok(!s.pismo.includes(dana), `w scenie widać „${dana}”`);
      }
      for (const dana of ['Kowalczyk', 'Długa', '30-512']) assert.ok(!s.adres.includes(dana), `w adresie widać „${dana}”`);
      assert.match(s.stat, /^Zasłonięto 10 fragmentów w 5 kategoriach\.$/);
      assert.ok(s.logo, 'znak marki bez JavaScriptu');
      assert.ok(s.pocztowka, 'pocztówka bez JavaScriptu');
    },
    { file: LANDING_HTML, javaScriptEnabled: false, viewport: { width: 1440, height: 900 } },
  );
});

test('landing z prefers-reduced-motion: stan końcowy i przycisk z oryginałem pisma', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async ({ page }) => {
      await page.waitForLoadState('load');
      assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ruch')), false);
      const btn = page.locator('#przelacz');
      await btn.scrollIntoViewIfNeeded();
      assert.ok(await btn.isVisible(), 'przycisk „Pokaż pismo przed zasłonięciem” niewidoczny');
      const n = await page.evaluate(() => document.querySelectorAll('#tresc .d').length);
      assert.equal(await page.evaluate(() => document.querySelectorAll('#tresc .d.lab').length), n);
      assert.ok(!(await page.locator('#plaza').innerText()).includes('Kowalczyk'));
      await btn.click();
      assert.equal(await btn.getAttribute('aria-pressed'), 'true');
      assert.ok((await page.locator('#tresc').innerText()).includes('Kowalczyk'), 'po kliknięciu brak oryginału');
      await btn.click();
      assert.ok(!(await page.locator('#tresc').innerText()).includes('Kowalczyk'));
    },
    { file: LANDING_HTML, viewport: { width: 1440, height: 900 } },
  );
});

// Strona i podstrona /log/ niosą te same fonty (data:), ilustracje i silnik okna z tekstem.
// 2026-11-26 po nowym wyglądzie: ok. 1,02 MB i 0,66 MB (wcześniej 0,80 MB). Próg z zapasem na
// treść, ale bez miejsca na drugi zestaw fontów czy obrazy rastrowe.
test('landing: rozmiar strony i podstrony /log/ najwyżej 1,3 MB', () => {
  for (const plik of [LANDING_HTML, path.join(path.dirname(LANDING_HTML), 'log', 'index.html')]) {
    const b = statSync(plik).size;
    assert.ok(b <= 1_300_000, `${path.relative(process.cwd(), plik)}: ${b} B`);
  }
});
