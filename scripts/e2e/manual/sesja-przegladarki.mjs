// Czy tekst wklejony do Parawana zostaje w plikach sesji przeglądarki i wraca po ponownym
// uruchomieniu z przywracaniem sesji? Odpowiedź dla IOD ma wynikać z próby, nie z założenia.
//
// Przebieg: nowy profil, plik otwarty z dysku, tekst z fikcyjnym PESEL-em wklejony do pola
// źródła, chwila na zapis sesji, zamknięcie przeglądarki, przeszukanie całego katalogu profilu
// (UTF-8 i UTF-16LE, w Firefoksie także rozpakowane pliki *.jsonlz4), ponowne uruchomienie
// z przywracaniem sesji i odczyt pola z przywróconej karty. Profil jest potem usuwany.
//
// Chromium, Chrome i Edge (Playwright, profil trwały, drugie uruchomienie z --restore-last-session;
// okno jest widoczne, bo Chromium bez okna nie zapisuje sesji):
//   node scripts/e2e/manual/sesja-przegladarki.mjs chromium [chrome.exe | msedge | chrome]
// Firefox w dowolnej wersji (geckodriver, profil w miejscu, browser.startup.page = 3):
//   node scripts/e2e/manual/sesja-przegladarki.mjs firefox <firefox.exe> <geckodriver.exe>
// Opcje: --plik <ścieżka.html> (domyślnie apps/web/dist/index.html), --pole <id> i --wynik <id>
// (domyślnie input i output; dla strony produktu demo-input i demo-output).
// Wynik: JSON z wersją, trafieniami w profilu i wartością pola po przywróceniu.
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  if (i < 0) return def;
  const [, value] = argv.splice(i, 2);
  return value;
};
const html = opt('--plik', path.join(ROOT, 'apps', 'web', 'dist', 'index.html'));
const FIELD = opt('--pole', 'input');
const OUT = opt('--wynik', 'output');
const [mode, bin, gdBin] = argv;
if (mode !== 'chromium' && !(mode === 'firefox' && bin && gdBin)) {
  console.error(
    'Użycie: node sesja-przegladarki.mjs chromium [chrome.exe | msedge | chrome]\n' +
      '        node sesja-przegladarki.mjs firefox <firefox.exe> <geckodriver.exe>\n' +
      '        opcje: --plik <plik.html> --pole <id> --wynik <id>',
  );
  process.exit(1);
}
const URL_APP = pathToFileURL(html).href;
// Fikcyjne dane z poprawną sumą PESEL; ani numeru, ani nazwiska nie ma w pliku Parawana, więc
// trafienie w profilu znaczy, że zapisała je przeglądarka.
const PESEL = '92031507917';
const NAZWISKO = 'Zyxqwertowski';
const TEXT = `Wnioskodawca: Ksawery ${NAZWISKO}, PESEL ${PESEL}, tel. 600 700 800.`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Zawartość pliku mozLz40 (sesja Firefoksa) albo null dla innego pliku. */
function mozLz4(buf) {
  if (buf.length < 12 || buf.subarray(0, 8).toString('latin1') !== 'mozLz40\0') return null;
  const out = Buffer.alloc(buf.readUInt32LE(8));
  const src = buf.subarray(12);
  let i = 0;
  let o = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) for (let b = 255; b === 255; ) lit += b = src[i++];
    src.copy(out, o, i, i + lit);
    i += lit;
    o += lit;
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8);
    i += 2;
    let ml = token & 15;
    if (ml === 15) for (let b = 255; b === 255; ) ml += b = src[i++];
    ml += 4;
    for (let k = 0; k < ml; k++) out[o + k] = out[o - off + k];
    o += ml;
  }
  return out.subarray(0, o);
}

/** Pliki profilu, w których stoi napis, z kodowaniem trafienia. */
function grepProfile(dir, needle) {
  const hits = [];
  const a = Buffer.from(needle, 'utf8');
  const u = Buffer.from(needle, 'utf16le');
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && statSync(p).size < 200 * 1024 * 1024) {
        let b;
        try {
          b = readFileSync(p);
        } catch {
          continue; // plik zablokowany przez przeglądarkę
        }
        const enc = [b.includes(a) && 'utf8', b.includes(u) && 'utf16le'].filter(Boolean);
        if (mozLz4(b)?.includes(a)) enc.push('po rozpakowaniu mozLz4');
        if (enc.length) hits.push(`${path.relative(dir, p)} (${enc.join(', ')})`);
      }
    }
  };
  walk(dir);
  return hits;
}

async function chromiumRun(profile, report) {
  const { chromium } = await import('playwright');
  const target = !bin ? {} : /[\\/]/.test(bin) ? { executablePath: bin } : { channel: bin };
  const launch = (args = []) =>
    chromium.launchPersistentContext(profile, { headless: false, ...target, viewport: { width: 1366, height: 768 }, args });
  let ctx = await launch();
  report.wersja = ctx.browser()?.version() ?? '(nieznana)';
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(URL_APP);
  await page.locator(`#${FIELD}`).click();
  await page.keyboard.insertText(TEXT); // jak wklejenie: jedno zdarzenie input
  await page.waitForFunction((o) => document.getElementById(o)?.textContent.includes('[PESEL]'), OUT);
  await sleep(12_000);
  report.poZapisieWTrakcie = grepProfile(profile, PESEL);
  await ctx.close();
  await sleep(1500);
  report.poZamknieciu = { pesel: grepProfile(profile, PESEL), nazwisko: grepProfile(profile, NAZWISKO) };
  ctx = await launch(['--restore-last-session']);
  await sleep(4000);
  report.kartyPoPrzywroceniu = ctx.pages().map((p) => p.url());
  page = ctx.pages().find((p) => p.url().startsWith(URL_APP));
  if (page) {
    await page.waitForLoadState('load');
    await sleep(1500);
    report.polePoPrzywroceniu = await page.locator(`#${FIELD}`).inputValue();
  }
  await ctx.close();
}

async function firefoxRun(profile, report) {
  const prefs = {
    'browser.startup.page': 3, // „Otwieraj poprzednie okna i karty”
    'browser.sessionstore.resume_from_crash': true,
    'browser.sessionstore.interval': 15000, // domyślny zapis co 15 s
    'browser.warnOnQuit': false,
    'browser.tabs.warnOnClose': false,
  };
  const open = async () => {
    const port = 4444 + Math.floor(Math.random() * 1000);
    const gd = spawn(gdBin, ['--port', String(port)], { stdio: 'ignore' });
    const call = async (method, p, body) => {
      const r = await fetch(`http://127.0.0.1:${port}${p}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json();
      if (j.value?.error) throw new Error(`${j.value.error}: ${j.value.message}`);
      return j.value;
    };
    for (let i = 0; i < 50; i++) {
      try {
        await call('GET', '/status');
        break;
      } catch {
        await sleep(200);
      }
    }
    // -profile: geckodriver pracuje na tym katalogu, a nie na kopii, więc sesja przetrwa restart
    const { sessionId } = await call('POST', '/session', {
      capabilities: { alwaysMatch: { 'moz:firefoxOptions': { binary: bin, args: ['-headless', '-profile', profile], prefs } } },
    });
    const s = (m, p, b) => call(m, `/session/${sessionId}${p}`, b);
    const js = (script) => s('POST', '/execute/sync', { script, args: [] });
    return {
      s,
      js,
      async quit() {
        await call('DELETE', `/session/${sessionId}`).catch(() => {});
        await sleep(1500);
        gd.kill();
      },
    };
  };
  let ff = await open();
  report.wersja = await ff.js('return navigator.userAgent');
  await ff.s('POST', '/url', { url: URL_APP });
  await sleep(1500);
  const el = await ff.s('POST', '/element', { using: 'css selector', value: `#${FIELD}` });
  await ff.s('POST', `/element/${Object.values(el)[0]}/value`, { text: TEXT });
  await sleep(20_000); // recovery.jsonlz4 zapisuje się co 15 s
  report.poZapisieWTrakcie = grepProfile(profile, PESEL);
  await ff.quit();
  report.poZamknieciu = { pesel: grepProfile(profile, PESEL), nazwisko: grepProfile(profile, NAZWISKO) };
  ff = await open();
  await sleep(5000);
  report.kartyPoPrzywroceniu = [];
  for (const h of await ff.s('GET', '/window/handles')) {
    await ff.s('POST', '/window', { handle: h });
    const url = await ff.s('GET', '/url');
    report.kartyPoPrzywroceniu.push(url);
    if (url.startsWith(URL_APP)) {
      await sleep(1500);
      report.polePoPrzywroceniu = await ff.js(`return document.getElementById(${JSON.stringify(FIELD)}).value`);
    }
  }
  await ff.quit();
}

const profile = mkdtempSync(path.join(tmpdir(), `parawan-sesja-${mode}-`));
const report = { przegladarka: bin || 'chromium z Playwright', plik: URL_APP, pole: `#${FIELD}` };
try {
  await (mode === 'firefox' ? firefoxRun : chromiumRun)(profile, report);
  report.polePoPrzywroceniu ??= '(karta z Parawanem nie wróciła)';
  report.wynik =
    report.poZamknieciu.pesel.length || report.polePoPrzywroceniu.includes(PESEL)
      ? 'TEKST ZOSTAJE: numer jest w profilu albo wrócił do pola'
      : 'tekst nie zostaje: numeru nie ma w profilu, pole po przywróceniu bez niego';
} catch (e) {
  report.blad = String(e?.message ?? e).split('\n')[0];
  process.exitCode = 1;
} finally {
  console.log(JSON.stringify(report, null, 1));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
