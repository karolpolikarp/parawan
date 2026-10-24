// Pierwszy ekran aplikacji przy typowych urzędowych oknach. Urzędnik otwiera Parawana kilka razy
// dziennie, więc pole do wklejenia ma stać na pierwszym ekranie, bez przewijania. Przed A06 pole
// zaczynało się na 1052 px przy oknie 650–960 px. Pomiar przejęty ze skryptu ręcznego
// scripts/e2e/manual/viewports.mjs (zostaje do zrzutów w Edge).
//
// Okno = obszar strony: ekran minus pasek zadań Windows (40–48 px) i interfejs Edge (ok. 71–80 px).
// Powiększenie 125% w przeglądarce przy 1366×768 daje obszar 1093×520 pikseli CSS.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch, withApp } from './helpers.mjs';

/** @type {import('playwright').Browser} */
let browser;
before(async () => {
  browser = await launch();
});
after(async () => {
  await browser?.close();
});

/** Położenie pola źródła, wysokość nagłówka i szerokość dokumentu. */
async function measure(page) {
  return page.evaluate(() => {
    const input = document.getElementById('input')?.getBoundingClientRect();
    const header = document.querySelector('header.hero')?.getBoundingClientRect();
    return {
      vw: innerWidth,
      vh: innerHeight,
      top: input ? input.top + scrollY : -1,
      height: input ? input.height : 0,
      header: header ? header.height : -1,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

const LAPTOPY = [
  { okno: 'laptop 1366×768, 100%', width: 1366, height: 650 },
  { okno: 'FHD w skali 125% (1536×864)', width: 1536, height: 745 },
  { okno: 'monitor 1280×1024', width: 1280, height: 900 },
  { okno: 'FHD 100% (1920×1080)', width: 1920, height: 960 },
];

for (const { okno, width, height } of LAPTOPY) {
  for (const query of ['', '?demo']) {
    test(`${okno}, okno ${width}×${height}${query}: pole tekstu w górnych 40% i co najmniej 220 px na ekranie`, async (t) => {
      await withApp(
        browser,
        t,
        query,
        async (app) => {
          if (query) await app.demoReady();
          const m = await measure(app.page);
          assert.ok(m.top >= 0, 'brak #input');
          assert.ok(m.top <= 0.4 * m.vh, `#input zaczyna się na ${m.top} px, a 40% okna to ${0.4 * m.vh} px`);
          const visible = Math.min(m.top + m.height, m.vh) - m.top;
          assert.ok(visible >= 220, `na pierwszym ekranie widać ${visible} px pola (potrzeba 220)`);
        },
        { viewport: { width, height } },
      );
    });
  }
}

// Urzędnik ze starym plikiem widzi dłuższe ostrzeżenie zamiast „sprawdź nowszą wersję”. Data builda
// to data commita, więc „dziś + 200 dni” jest zawsze ponad 180 dni od niej.
const STARY_PLIK = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
for (const { okno, width, height } of LAPTOPY) {
  test(`${okno}, okno ${width}×${height}, plik starszy niż pół roku: pole tekstu w górnych 40%`, async (t) => {
    await withApp(
      browser,
      t,
      '',
      async (app) => {
        const old = await app.page.locator('#ver-link.is-old').count();
        assert.equal(old, 1, 'brak ostrzeżenia o starym pliku');
        const m = await measure(app.page);
        assert.ok(m.top <= 0.4 * m.vh, `#input zaczyna się na ${m.top} px, a 40% okna to ${0.4 * m.vh} px`);
        assert.ok(m.header <= 140, `nagłówek ma ${m.header} px`);
      },
      { viewport: { width, height }, clockTime: STARY_PLIK },
    );
  });
}

test('powiększenie 125% przy 1366×768 (okno 1093×520): pole zaczyna się na pierwszym ekranie', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async (app) => {
      const m = await measure(app.page);
      // co najmniej trzy wiersze pola nad dolną krawędzią okna
      assert.ok(m.top >= 0 && m.top + 80 <= m.vh, `#input zaczyna się na ${m.top} px przy oknie ${m.vh} px`);
    },
    { viewport: { width: 1093, height: 520 } },
  );
});

test('nagłówek przy 1366×768 ma najwyżej 140 px', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async (app) => {
      const m = await measure(app.page);
      assert.ok(m.header > 0 && m.header <= 140, `nagłówek ma ${m.header} px`);
    },
    { viewport: { width: 1366, height: 768 } },
  );
});

test('autofokus w polu tekstu bez przewijania strony (mysz)', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async (app) => {
      const state = await app.page.evaluate(() => ({ active: document.activeElement?.id, y: scrollY }));
      assert.equal(state.active, 'input');
      assert.equal(state.y, 0);
    },
    { viewport: { width: 1366, height: 650 } },
  );
});

for (const width of [320, 390, 768, 1093, 1366, 1920]) {
  test(`szerokość ${width} px: bez poziomego przewijania (pusta strona i ?demo)`, async (t) => {
    for (const query of ['', '?demo']) {
      await withApp(
        browser,
        t,
        query,
        async (app) => {
          if (query) await app.demoReady();
          const m = await measure(app.page);
          assert.ok(
            m.scrollWidth <= m.vw && m.bodyScrollWidth <= m.vw,
            `${query || 'pusta'}: dokument ma ${m.scrollWidth} px (body ${m.bodyScrollWidth} px) przy oknie ${m.vw} px`,
          );
        },
        { viewport: { width, height: 800 } },
      );
    }
  });
}

test('„Jak to działa” pod narzędziem, przed stopką, i skrót do edytora na wąskim ekranie', async (t) => {
  await withApp(
    browser,
    t,
    '',
    async (app) => {
      const { page } = app;
      const tops = await page.evaluate(() =>
        ['#edytor', '#co-wykrywa', '#jak-to-dziala', 'footer'].map(
          (s) => document.querySelector(s)?.getBoundingClientRect().top ?? -1,
        ),
      );
      assert.ok(tops.every((v, i) => v >= 0 && (i === 0 || v > tops[i - 1])), `kolejność na ekranie: ${tops}`);
      await page.getByRole('heading', { level: 2, name: 'Jak to działa' }).waitFor();
      assert.equal(await page.locator('.skip-editor').isVisible(), false, 'skrót widoczny na szerokim ekranie');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.locator('.skip-editor').isVisible(), true, 'brak skrótu na telefonie');
    },
    { viewport: { width: 1366, height: 650 } },
  );
});

for (const width of [320, 390]) {
  test(`szerokość ${width} px: kropka przed datą zostaje w wierszu z numerem wersji`, async (t) => {
    await withApp(
      browser,
      t,
      '',
      async (app) => {
        const r = await app.page.evaluate(() => {
          const date = document.getElementById('app-build-date')?.firstChild;
          const ver = document.getElementById('app-version-top')?.firstChild;
          if (!date || !ver) return null;
          const top = (node, from, to) => {
            const range = document.createRange();
            range.setStart(node, from);
            range.setEnd(node, to);
            return Math.round(range.getBoundingClientRect().top);
          };
          const text = date.textContent ?? '';
          const dot = text.indexOf('·');
          return { ver: top(ver, ver.length - 1, ver.length), dot: top(date, dot, dot + 1), text };
        });
        // build z „dev” nie ma daty: nie ma czego sprawdzać
        if (!r?.text) return;
        assert.equal(r.dot, r.ver, `kropka w innym wierszu niż numer wersji („${r.text}”)`);
      },
      { viewport: { width, height: 800 } },
    );
  });
}
