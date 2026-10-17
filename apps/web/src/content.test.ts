import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import landingMain from '../../landing/src/main.ts?raw';
import webHtml from '../index.html?raw';
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
