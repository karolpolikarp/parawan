// „Zasłoń zaznaczenie” (A09) z prawdziwym zaznaczeniem myszą w Firefoksie dowolnej wersji (np. ESR
// 115 z .cache/przegladarki) przez geckodriver. Gecko stawia granice zaznaczenia inaczej niż
// Chromium (na elementach wiersza i znacznika, a nie w węzłach tekstu), a Playwright nie steruje
// starym Firefoksem, więc ruchy myszy idą czystym WebDriverem (akcje pointerMove, pointerDown,
// pointerUp). Cztery próby na decyzji z fixtures/urzad: przeciągnięcie przez środek numeru księgi
// wieczystej, przeciągnięcie z tekstu w środek znacznika, z tekstu przez cały znacznik i cały wiersz
// od brzegu do brzegu okna. Każda porównuje fragment w wierszu „Zasłoń „…”” z oczekiwanym; pierwsza
// zasłania numer i sprawdza tekst do druku.
// Użycie: node scripts/e2e/manual/korekta-zaznaczenie.mjs <firefox.exe> <geckodriver.exe> <adres pliku> <zrzut.png>
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [ffBin, gdBin, url, outPng] = process.argv.slice(2);
if (!ffBin || !gdBin || !url || !outPng) {
  console.error('Użycie: node korekta-zaznaczenie.mjs <firefox.exe> <geckodriver.exe> <adres pliku> <zrzut.png>');
  process.exit(1);
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DECYZJA = readFileSync(path.join(ROOT, 'apps', 'web', 'src', 'fixtures', 'urzad', 'decyzja.txt'), 'utf8');
const port = 4444 + Math.floor(Math.random() * 1000);
const gd = spawn(gdBin, ['--port', String(port)], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
  return j.value;
}

// Punkty przeciągnięcia (współrzędne okna) dla par [napis, pozycja, znacznik?], mierzone po
// przewinięciu do wiersza z pierwszym napisem ('przewiń'). Znacznik (trzeci element pary, np. '[PESEL]') szukany po treści
// w wierszu z napisem (pozycja to ułamek szerokości), tekst przez Range w węźle tekstowym. Pozycja
// 'lewo' i 'prawo' to brzegi okna wyniku na wysokości wiersza (granice zaznaczenia na elementach).
const POINTS = `
  const out = document.getElementById('output');
  const line = (needle) => [...out.querySelectorAll('.cl')].find((l) => l.textContent.includes(needle));
  const specs = [...arguments];
  if (specs[0] === 'przewiń') {
    line(specs[1]).scrollIntoView({ block: 'center', behavior: 'instant' });
    return null;
  }
  return specs.map(([needle, at, mark]) => {
    const l = line(needle);
    if (at === 'lewo' || at === 'prawo') {
      const o = out.getBoundingClientRect();
      const r = l.getBoundingClientRect();
      return { x: Math.round(at === 'lewo' ? o.left + 4 : o.right - 8), y: Math.round(r.top + 10) };
    }
    if (mark) {
      const m = [...l.querySelectorAll('mark.pii')].find((x) => x.textContent === mark);
      const r = m.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * at), y: Math.round(r.top + r.height / 2) };
    }
    const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const i = t.data.indexOf(needle);
      if (i === -1) continue;
      const r = document.createRange();
      r.setStart(t, i + at);
      r.setEnd(t, i + at + 1);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
    }
    throw new Error('brak ' + needle);
  });
`;

try {
  for (let i = 0; i < 50; i++) {
    try {
      await call('GET', '/status');
      break;
    } catch {
      await sleep(200);
    }
  }
  const s = await call('POST', '/session', {
    capabilities: { alwaysMatch: { 'moz:firefoxOptions': { binary: ffBin, args: ['-headless', '--width=1366', '--height=900'] } } },
  });
  const sid = s.sessionId;
  const run = (script, args = []) => call('POST', `/session/${sid}/execute/sync`, { script, args });
  const mouse = (actions) =>
    call('POST', `/session/${sid}/actions`, {
      actions: [{ type: 'pointer', id: 'mysz', parameters: { pointerType: 'mouse' }, actions }],
    });
  // Przeciągnięcie: wciśnięcie w punkcie a, potem pomiar punktu b od nowa i puszczenie w b.
  const drag = async (a, specB) => {
    // Najpierw kursor w róg okna: dymek znacznika najechanego w poprzedniej próbie zasłania dwa
    // wiersze pod nim i wciśnięcie trafiłoby w znacznik zamiast w tekst.
    await mouse([{ type: 'pointerMove', duration: 0, x: 1, y: 1, origin: 'viewport' }]);
    await sleep(100);
    await mouse([
      { type: 'pointerMove', duration: 0, x: a.x, y: a.y, origin: 'viewport' },
      { type: 'pointerDown', button: 0 },
    ]);
    await sleep(300);
    const [b] = await run(POINTS, [specB]);
    await mouse([
      { type: 'pointerMove', duration: 150, x: b.x, y: b.y, origin: 'viewport' },
      { type: 'pointerUp', button: 0 },
    ]);
    await call('DELETE', `/session/${sid}/actions`);
  };
  const points = async (...specs) => {
    await run(POINTS, ['przewiń', specs[0][0]]);
    await sleep(500);
    return run(POINTS, specs);
  };
  /** Klik „Zasłoń zaznaczenie” w wyniku i fragment z wiersza „Zasłoń „…””. */
  const formValue = async () => {
    await sleep(150);
    const r = await run(
      `const b = document.getElementById('fix-sel-out');
       if (b.disabled) return { disabled: true, sel: String(getSelection()) };
       b.click();
       const f = document.getElementById('fix-form');
       return { val: f.hidden ? null : document.getElementById('fix-form-val').textContent, sel: String(getSelection()) };`,
    );
    return r;
  };
  const cancel = () => run(`document.getElementById('fix-cancel').click(); getSelection().removeAllRanges();`);

  await call('POST', `/session/${sid}/url`, { url });
  await sleep(2500);
  await run(
    `const i = document.getElementById('input'); i.value = arguments[0]; i.dispatchEvent(new Event('input', { bubbles: true }));`,
    [DECYZJA],
  );
  await sleep(1500);
  const ua = await run('return navigator.userAgent;');
  const results = [];
  const check = (name, got, want) => {
    const ok = got?.val === want;
    results.push({ próba: name, ok, oczekiwane: want, ...got });
  };

  // 1. przeciągnięcie przez środek numeru księgi wieczystej („00045123” bez brzegów numeru)
  await drag(...(await points(['OS1W/00045123/6', 5])), ['OS1W/00045123/6', 12]);
  const kw = await formValue();
  check('środek numeru KW', kw, 'OS1W/00045123/6');
  if (kw.val) {
    await run(`document.getElementById('fix-token').value = 'DANE'; document.getElementById('fix-apply').click();`);
    await sleep(300);
    const printed = await run(`return document.getElementById('print-out').textContent;`);
    results.push({ próba: 'druk po zasłonięciu KW', ok: printed.includes('(księga wieczysta nr [DANE])') && !printed.includes('00045123') });
  }
  // 2. z tekstu „Pana” w środek znacznika osoby
  await drag(...(await points(['wniosku Pana ', 8])), ['wniosku Pana ', 0.5, '[IMIĘ I NAZWISKO]']);
  check('z tekstu w znacznik', await formValue(), 'Pana Tomasza Wierzbickiego');
  await cancel();
  // 3. przez cały znacznik PESEL: z tekstu przed nim w tekst za nim (wciśnięcie na samym znaczniku
  // otwiera pasek fragmentu, a Chromium nie zaczyna wtedy zaznaczenia)
  await drag(...(await points([', PESEL ', 2])), [', złożonego', 6]);
  check('przez znacznik', await formValue(), 'PESEL 85071412358, złożonego');
  await cancel();
  // 4. cały wiersz od numeru wiersza po prawy brzeg okna: granice na elementach, nie w tekście
  await drag(...(await points(['DECYZJA NR 112/2026', 'lewo'])), ['DECYZJA NR 112/2026', 'prawo']);
  check('cały wiersz od brzegu do brzegu', await formValue(), 'DECYZJA NR 112/2026');
  await cancel();

  console.log(JSON.stringify({ ua, results }, null, 1));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
  const png = await call('GET', `/session/${sid}/screenshot`);
  writeFileSync(outPng, Buffer.from(png, 'base64'));
  await call('DELETE', `/session/${sid}`);
} catch (e) {
  console.log('BŁĄD:', e.message);
  process.exitCode = 1;
} finally {
  gd.kill();
}
