// „Pobierz .docx” otwarty przez drugi program biurowy: LibreOffice bez okna (soffice --headless)
// zamienia pobrany dokument na zwykły tekst, a test porównuje go wiersz po wierszu z pobranym
// .txt, czyli z finalText. Word sprawdza się ręcznie (COM, lista w scripts/e2e/README.md).
// Ścieżkę do soffice podaje PARAWAN_SOFFICE (job libreoffice w .github/workflows/zgodnosc.yml);
// bez niej testy są pomijane, więc zwykłe npm run e2e ich nie uruchamia.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { EXAMPLE_PESEL, launch, withApp } from './helpers.mjs';

const SOFFICE = process.env.PARAWAN_SOFFICE || '';
const SKIP = SOFFICE ? false : 'brak PARAWAN_SOFFICE (ścieżki do soffice z LibreOffice)';

// BOM UTF-8 na początku pobranego .txt, kodem: formatowanie zamienia ucieczkę w źródle na niewidoczny znak.
const BOM_RE = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** @type {import('playwright').Browser} */
let browser;
let dir = '';
before(async () => {
  if (SKIP) return;
  browser = await launch();
  dir = mkdtempSync(path.join(tmpdir(), 'parawan-lo-'));
});
after(async () => {
  await browser?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

async function download(page, name) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
  return readFileSync(await file.path());
}

/** Tekst dokumentu według LibreOffice: filtr „Text (encoded)” w UTF-8, akapit to wiersz. */
function sofficeText(docx, name) {
  const src = path.join(dir, `${name}.docx`);
  writeFileSync(src, docx);
  // Osobny profil: pierwszy start LibreOffice bez profilu nie może czekać na okno powitalne.
  const profile = path.join(dir, 'profil');
  execFileSync(
    SOFFICE,
    [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      '--headless',
      '--convert-to',
      'txt:Text (encoded):UTF8',
      '--outdir',
      dir,
      src,
    ],
    { stdio: 'pipe', timeout: 120_000 },
  );
  return readFileSync(path.join(dir, `${name}.txt`), 'utf8');
}

const lines = (s) => s.replace(BOM_RE, '').replace(/(\r?\n)+$/, '').split(/\r?\n/);

test('LibreOffice: tekst pobranego .docx z ?demo równa się pobranemu .txt', { skip: SKIP }, async (t) => {
  await withApp(browser, t, '?demo', async (app) => {
    await app.demoReady();
    const docx = await download(app.page, 'Pobierz .docx');
    const txt = (await download(app.page, 'Pobierz .txt')).toString('utf8');
    const lo = sofficeText(docx, 'demo');
    assert.ok(!lo.includes(EXAMPLE_PESEL), `w tekście z LibreOffice jest numer ${EXAMPLE_PESEL}`);
    assert.deepEqual(lines(lo), lines(txt));
  });
});

// Fikcyjny wykaz: tabulatory z kolumn tabeli, polskie litery, puste wiersze, znaki do ucieczki XML.
const WYKAZ =
  'Wykaz uczestników zebrania wiejskiego w Brzozowej Woli\n\n' +
  'Lp.\tImię i nazwisko\tUwagi\n' +
  '1.\tGrzegorz Wiśniewski\tsołtys, tel. 600 700 800\n' +
  '2.\tŻaneta Łęcka-Ćwik\t„za” & <przeciw>\n\n' +
  'Zażółć gęślą jaźń.';

test('LibreOffice: tabulatory, polskie litery i znaki XML przechodzą bez zmian', { skip: SKIP }, async (t) => {
  await withApp(browser, t, '', async (app) => {
    await app.page.locator('#input').fill(WYKAZ);
    await app.waitForOutput('[TELEFON]');
    const docx = await download(app.page, 'Pobierz .docx');
    const txt = (await download(app.page, 'Pobierz .txt')).toString('utf8');
    assert.deepEqual(lines(sofficeText(docx, 'wykaz')), lines(txt));
  });
});
