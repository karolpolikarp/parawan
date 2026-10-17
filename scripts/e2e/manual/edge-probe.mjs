// Otwiera podane adresy file:// w zainstalowanych Edge i Chrome (Playwright, channel) i czyta
// sondę #__probe, którą do kopii pliku wstawia mkprobe2.mjs. Sprawdza przeglądarki, w których
// urzędnik naprawdę otwiera Parawana (Windows), a nie Chromium z Playwright.
// Użycie: node scripts/e2e/manual/edge-probe.mjs <url1> [url2 ...]
// Przykład: node scripts/e2e/manual/edge-probe.mjs "file:///C:/sonda/Parawan-probe.html?demo"
import { chromium } from 'playwright';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('Podaj co najmniej jeden adres file://, np. kopii z sondą z mkprobe2.mjs.');
  process.exit(1);
}

for (const channel of ['msedge', 'chrome']) {
  let browser;
  try {
    browser = await chromium.launch({ channel, headless: true });
  } catch (e) {
    console.log(`=== ${channel}: brak przeglądarki (${e.message.split('\n')[0]})`);
    continue;
  }
  for (const url of urls) {
    const page = await browser.newPage({ viewport: { width: 1366, height: 650 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(url);
      // Sonda zapisuje wynik po 4 s od „load” (pliki: 4 s na każdy), stąd zapas.
      await page.waitForTimeout(Number(process.env.WAIT || 5500));
      const probe = await page.evaluate(
        () => document.getElementById('__probe')?.textContent ?? '(brak sondy)',
      );
      console.log(
        `=== ${channel} ${browser.version()} ${url.slice(-60)}\n${probe}\npageerror: ${errors.join(' | ') || 'brak'}`,
      );
    } catch (e) {
      console.log(`=== ${channel} ${url.slice(-60)}\nBŁĄD: ${e.message.split('\n')[0]}`);
    }
    await page.close();
  }
  await browser.close();
}
