// Uruchamia Firefoksa w dowolnej wersji (np. ESR 115 z .cache/przegladarki) przez geckodriver,
// czyta sondę #__probe, wersję i początek wyniku, robi zrzut. Playwright nie steruje starym
// Firefoksem, a geckodriver mówi czystym WebDriverem, więc wystarcza wbudowany fetch.
// Nazwa od „Firefox probe”, nie od narzędzia z FFmpeg.
// Użycie: node scripts/e2e/manual/ffprobe.mjs <firefox.exe> <geckodriver.exe> <url> <zrzut.png> [szer] [wys]
// Czas oczekiwania na sondę: zmienna WAIT w ms (domyślnie 6000).
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [ffBin, gdBin, url, outPng, w = '1366', h = '768'] = process.argv.slice(2);
if (!ffBin || !gdBin || !url || !outPng) {
  console.error('Użycie: node ffprobe.mjs <firefox.exe> <geckodriver.exe> <url> <zrzut.png> [szer] [wys]');
  process.exit(1);
}
const port = 4444 + Math.floor(Math.random() * 1000);
const gd = spawn(gdBin, ['--port', String(port)], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
  return j.value;
}

try {
  // geckodriver startuje chwilę; pytamy o status, zanim otworzymy sesję.
  for (let i = 0; i < 50; i++) {
    try {
      await call('GET', '/status');
      break;
    } catch {
      await sleep(200);
    }
  }
  const s = await call('POST', '/session', {
    capabilities: {
      alwaysMatch: {
        'moz:firefoxOptions': { binary: ffBin, args: ['-headless', `--width=${w}`, `--height=${h}`] },
      },
    },
  });
  const sid = s.sessionId;
  try {
    await call('POST', `/session/${sid}/window/rect`, { width: Number(w), height: Number(h) });
  } catch {
    /* tryb headless bywa bez zmiany rozmiaru okna, zostaje rozmiar z argumentów */
  }
  await call('POST', `/session/${sid}/url`, { url });
  await sleep(Number(process.env.WAIT || 6000));
  const probe = await call('POST', `/session/${sid}/execute/sync`, {
    script:
      'var p=document.getElementById("__probe");var o=document.getElementById("output");' +
      'return {ua:navigator.userAgent,vp:window.innerWidth+"x"+window.innerHeight,' +
      'probe:p?p.textContent:"(brak sondy)",ver:(document.getElementById("app-version-top")||{}).textContent,' +
      'out:o?o.textContent.slice(0,300):null};',
    args: [],
  });
  console.log(JSON.stringify(probe, null, 1));
  const png = await call('GET', `/session/${sid}/screenshot`);
  writeFileSync(outPng, Buffer.from(png, 'base64'));
  await call('DELETE', `/session/${sid}`);
} catch (e) {
  console.log('BŁĄD:', e.message);
  process.exitCode = 1;
} finally {
  gd.kill();
}
