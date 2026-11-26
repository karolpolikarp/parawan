// Scena „Parawany stają tylko przy danych” na stronie produktu (apps/landing, src/plaza.ts):
//  1) przewijanie klatka po klatce na laptopie i telefonie: oryginał danej jest widoczny tylko
//     w całości, gaśnie, zanim stanie nad nim płótno, i nie wraca spod parawanu przy przewijaniu
//     w dół (zasada „maskuj całość” z DESIGN.md: żadna klatka nie pokazuje fragmentu danej);
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
  const wynik = { maski: 0, widoczne: 0, problemy: [], widac: [], q: [] };
  for (const d of document.querySelectorAll('#tresc .d')) {
    wynik.maski++;
    wynik.q.push(d.classList.contains('lab') ? 1 : Number(d.style.getPropertyValue('--q') || 0));
    const o = d.querySelector('.o');
    const cs = getComputedStyle(o);
    const widac =
      !d.classList.contains('lab') && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    wynik.widac.push(widac);
    if (!widac) continue;
    wynik.widoczne++;
    const tekst = o.textContent;
    const q = Number(d.style.getPropertyValue('--q') || 0);
    const c = Number(d.style.getPropertyValue('--c') || 0);
    // płótno rośnie dopiero nad zgaszonym oryginałem (od q = .1): bez połówek cyfr nad parawanem
    if (q >= 0.1) wynik.problemy.push(`„${tekst}” widoczny przy q = ${q}`);
    if (c > 0) wynik.problemy.push(`„${tekst}” częściowo przykryty płótnem (c = ${c})`);
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
  // laptop z niskim oknem i telefony: tryb bez przypięcia, w którym zwężona maska przesuwa wiersz
  { width: 1366, height: 657 },
  { width: 414, height: 896 },
  { width: 390, height: 844 },
  { width: 320, height: 640 },
  // gęsty skan co 3 px: tu przed poprawką PESEL i IBAN wracały spod parawanu (krytyka ruchu r7)
  { width: 360, height: 740, krok: 3 },
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
        // maska widziana z oryginałem, a potem już za parawanem, przy przewijaniu w dół nie wraca
        const byly = new Set();
        const zakryte = new Set();
        let qPop = [];
        const KROKI = viewport.krok ? Math.ceil((y1 - y0) / viewport.krok) : 200;
        for (let i = 0; i <= KROKI; i++) {
          await page.evaluate((y) => window.scrollTo(0, y), y0 + ((y1 - y0) * i) / KROKI);
          await page.clock.runFor(40); // klatka liczy się w requestAnimationFrame
          const k = await page.evaluate(klatka);
          assert.deepEqual(k.problemy, [], `klatka ${i}`);
          // postęp maski przy przewijaniu w dół tylko rośnie (zwężenie nie może go cofnąć)
          k.q.forEach((q, j) => {
            assert.ok(q >= (qPop[j] ?? 0) - 0.005, `klatka ${i}: postęp maski ${j} cofa się z ${qPop[j]} do ${q}`);
          });
          qPop = k.q;
          k.widac.forEach((w, j) => {
            assert.ok(!(w && zakryte.has(j)), `klatka ${i}: maska ${j} wróciła spod parawanu`);
            if (w) byly.add(j);
            else if (byly.has(j)) zakryte.add(j);
          });
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
      { file: LANDING_HTML, viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'no-preference' },
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
