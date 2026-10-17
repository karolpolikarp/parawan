import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import landingMain from '../../landing/src/main.ts?raw';
import webHtml from '../index.html?raw';
import { ICONS } from './icons';
import webMain from './main.ts?raw';

// Teksty interfejsu, które łatwo rozjechać z zachowaniem silnika albo z układem strony.
// Wygląd (zrzuty przy 320–1920 px) sprawdzamy w przeglądarce; tu pilnujemy samej treści.

test('aplikacja: skrót „Przejdź do edytora” prowadzi do karty tekstu źródłowego', () => {
  expect(webHtml).toMatch(/<a class="btn skip-editor" href="#edytor">/);
  expect(webHtml).toMatch(/<section class="card g6" id="edytor">/);
});

test('aplikacja: zapętloną animację da się zatrzymać przyciskiem', () => {
  expect(webHtml).toMatch(/<button type="button" id="demo-motion" class="btn btn-sm demo-motion">/);
  expect(webMain).toContain("storageSet('motion'");
});

// Na telefonie pole źródła stoi nad wynikiem, więc „po lewej” wprowadzało w błąd.
test('bez „po lewej” w podpowiedziach (aplikacja i landing)', () => {
  for (const src of [webHtml, webMain, landingHtml, landingMain]) {
    expect(src).not.toContain('po lewej');
  }
});

test('landing: ten sam napis statystyk demo na starcie i po wyczyszczeniu pola', () => {
  const idle = landingHtml.match(/id="demo-stat" role="status">([^<]+)</)?.[1];
  expect(idle).toBeTruthy();
  expect(landingMain).toContain(`'${idle}'`);
});

test('bez obietnic, których silnik nie spełnia', () => {
  // „Sygn. akt” rdzeń maskuje jako [ZNAK-SPRAWY], nie zostawia jej „nietkniętej”
  expect(webHtml).not.toContain('(sygnatura akt, numer przepisu)');
  // e-mail, kod pocztowy czy IP nie mają sumy kontrolnej ani kotwicy
  expect(webHtml).not.toContain('każdy z walidacją lub kontekstem');
  expect(landingHtml).not.toContain('Każdy typ ma własną sumę kontrolną');
  // demo pokazuje ten sam znacznik, który daje wynik w trybie domyślnym
  expect(webHtml).toContain('<div class="demo-name">[IMIĘ&nbsp;I&nbsp;NAZWISKO]</div>');
  expect(webHtml).not.toContain('100% offline');
});

test('aplikacja: stopka prowadzi do packages/core, a nie do nieopublikowanego pakietu npm', () => {
  expect(webHtml).not.toContain('pakiet npm');
  expect(webHtml).toContain('href="https://github.com/karolpolikarp/parawan/tree/main/packages/core"');
});

test('aplikacja: wskazówki o upuszczaniu pliku i Ctrl+Enter znikają na telefonie (.hint-desk)', () => {
  expect(webHtml).toContain('<span class="hint-desk">lub upuść plik');
  expect(webHtml).toContain('<span class="hint-touch">lub wczytaj plik');
  expect(webHtml).toMatch(/<li class="hint-desk"><span><kbd>Ctrl<\/kbd>\+<kbd>Enter<\/kbd>/);
  expect(webHtml).toMatch(/<li class="hint-desk"><span>Plik \(TXT, DOCX, PDF\) upuść/);
  expect(webHtml).toContain('<span class="hint-desk"> · plik możesz upuścić');
  // licznik w #src-meta main.ts nadpisuje przy każdej zmianie, więc dopisek stoi obok niego
  expect(webMain).not.toContain('plik możesz upuścić');
});

test('ta sama nazwa funkcji „Rozróżniaj osoby” co w README: znacznik, nie etykieta', () => {
  expect(webMain).not.toContain('tę samą etykietę');
  expect(webMain).toContain('ten sam znacznik w całym dokumencie');
});

test('landing: kod na GitHubie to nie „jeden plik” (jednym plikiem jest Parawan.html)', () => {
  expect(landingHtml).not.toContain('kod na GitHubie: to jeden plik');
});

/* ── Druk i pobieranie ── */

const PRINT_TIP =
  'Drukuje sam wynik, bez tekstu źródłowego. PDF zapiszesz w oknie drukowania: ' +
  '„Zapisz jako PDF” albo „Microsoft Print to PDF”.';
// Pole „Nagłówki i stopki” stoi w Chrome, Edge i Firefoksie w zwiniętej sekcji „Więcej ustawień”:
// kto go nie widzi, drukuje ścieżkę file:///C:/Users/<login>/…, przed którą dopisek ostrzega.
const PRINT_HINT =
  'W oknie drukowania rozwiń „Więcej ustawień” i odznacz „Nagłówki i stopki”. Inaczej na ' +
  'wydruku znajdzie się ścieżka pliku z&nbsp;nazwą użytkownika komputera.';
const PRINT_TIP_LI =
  '<kbd>Ctrl</kbd>+<kbd>P</kbd> drukuje sam wynik. Plik PDF zapiszesz w&nbsp;oknie drukowania.';
const PRINT_EMPTY = 'Brak wyniku do wydruku. Wklej tekst w pole „Tekst źródłowy”.';

test('aplikacja: przycisk druku nad wynikiem, obok „Pobierz”, z ikoną drukarki', () => {
  const acts = webHtml.match(/<span class="out-acts">([\s\S]*?)<\/span>\s*<\/div>/)?.[1] ?? '';
  const ids = [...acts.matchAll(/<button type="button" id="([\w-]+)"/g)].map((m) => m[1]);
  expect(ids).toEqual(['print', 'download', 'copy']);
  expect(acts).toContain(
    `<button type="button" id="print" class="btn tbtn" data-tip="${PRINT_TIP}">` +
      '<i class="gi" data-i="drukarka"></i><span>Drukuj lub zapisz PDF</span></button>',
  );
  // ikona jak pozostałe: inline SVG w kolorze tekstu przycisku
  expect(ICONS.drukarka).toMatch(/^<svg [^>]*stroke="currentColor"[^>]*aria-hidden="true">/);
});

test('aplikacja: prośba o wyłączenie nagłówków druku i wskazówka Ctrl+P', () => {
  expect(webHtml).toContain(`<p class="out-hint">${PRINT_HINT}</p>`);
  // Dopisek ma własny wiersz stopki karty wyniku, z ikoną drukarki, tuż pod ostrzeżeniem
  // „Przejrzyj wynik…”. W jednym bloku z ostrzeżeniem trójkąt stawał przy radzie o druku.
  const warn = webHtml.match(/<div class="card-f warn-note">([\s\S]*?)<\/div>/)?.[1] ?? '';
  expect(warn).toContain('Przejrzyj wynik przed udostępnieniem');
  expect(warn).toContain('data-i="ostrzezenie"');
  expect(warn).not.toContain('out-hint');
  const after = webHtml.slice(webHtml.indexOf(warn) + warn.length);
  const note =
    after.match(
      /^<\/div>\s*(?:<!--[\s\S]*?-->\s*)?<div class="card-f print-note">([\s\S]*?)<\/div>/,
    )?.[1] ?? '';
  expect(note.replace(/\s+</g, '<').trim()).toBe(
    `<i class="gi" data-i="drukarka"></i><p class="out-hint">${PRINT_HINT}</p>`,
  );
  expect(webHtml).toContain(`<li class="hint-desk"><span>${PRINT_TIP_LI}</span></li>`);
  expect(webMain).toContain(`const PRINT_EMPTY = '${PRINT_EMPTY}';`);
});

test('aplikacja: przycisk druku działa jak „Pobierz” i drukuje bieżący wynik', () => {
  const actions = webMain.match(/function setResultActions[\s\S]*?\n\}/)?.[0] ?? '';
  expect(actions).toContain('printBtn.disabled = !on;');
  expect(actions).toContain('downloadBtn.disabled = !on;');
  const click = webMain.match(/printBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? '';
  expect(click.indexOf('flushPendingUpdate();')).toBeGreaterThan(-1);
  expect(click.indexOf('flushPendingUpdate();')).toBeLessThan(click.indexOf('window.print();'));
  // Ctrl+P i menu przeglądarki też najpierw kończą odłożone przeliczenie
  const before = webMain.match(/addEventListener\('beforeprint', \(\) => \{([\s\S]*?)\n\}\);/)?.[1] ?? '';
  expect(before).toContain('flushPendingUpdate();');
  expect(before).toContain('document.title = printTitle(new Date());');
  expect(webMain).toMatch(/addEventListener\('afterprint', /);
});

test('aplikacja: „Kopiuj”, „Pobierz” i druk biorą tekst tylko z finalText (output.ts)', () => {
  expect(webMain).toContain('navigator.clipboard.writeText(outputText())');
  expect(webMain).toContain('ta.value = outputText();');
  expect(webMain).toContain('downloadFor(outputText(), lastFileExt, new Date())');
  for (const raw of ['writeText(lastRedacted', 'Blob([lastRedacted', 'ta.value = lastRedacted']) {
    expect(webMain).not.toContain(raw);
  }
  // rozszerzenie pobieranego pliku zależy tylko od wczytanego pliku i wraca do .txt
  // po „Wyczyść”, „Przykład” i „Cofnij”
  expect(webMain.match(/setFileExt\(''\)/g)).toHaveLength(3);
  expect(webMain).toContain("setFileExt(isPdf ? 'pdf' : isDocx ? 'docx' : ext);");
  expect(webMain).not.toMatch(/file\.name[^;]*download/);
});

test('teksty o druku: bez wtrąceń „ — ”, „100%” i „nas/nam/nasz”', () => {
  for (const t of [PRINT_TIP, PRINT_HINT, PRINT_TIP_LI, PRINT_EMPTY, 'Drukuj lub zapisz PDF']) {
    expect(t).not.toContain(' — ');
    expect(t).not.toContain('100%');
    expect(t).not.toMatch(/\b(nas|nam|nasz\w*)\b/i);
    expect(t).not.toMatch(/w pełni|po prostu/);
  }
});
