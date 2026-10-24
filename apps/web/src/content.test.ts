import { readFileSync } from 'node:fs';
import { redactPII } from 'anonimizator';
import { expect, test } from 'vitest';
import landingHtml from '../../landing/index.html?raw';
import landingMain from '../../landing/src/main.ts?raw';
import webHtml from '../index.html?raw';
import { EXAMPLE_TEXT } from './example';
import { ICONS } from './icons';
import webMain from './main.ts?raw';

// Teksty interfejsu, które łatwo rozjechać z zachowaniem silnika albo z układem strony.
// Wygląd (zrzuty przy 320–1920 px) sprawdzamy w przeglądarce; tu pilnujemy samej treści.

test('aplikacja: skrót „Przejdź do edytora” prowadzi do karty tekstu źródłowego', () => {
  expect(webHtml).toMatch(/<a class="btn skip-editor" href="#edytor">/);
  expect(webHtml).toMatch(/<section class="card g6 card-ed" id="edytor">/);
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

/* ── Pierwszy ekran i teksty dla urzędu (A06) ── */

/** Tekst widoczny na stronie: bez komentarzy, stylów, skryptów i znaczników. */
const visibleText = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script)\b[\s\S]*?<\/\1>/g, '')
    .replace(/<[^>]+>/g, ' ');

test('aplikacja: hasło i teksty bez obietnicy „bezpiecznego” wyniku', () => {
  expect(webHtml).toContain(
    '<p class="hero-lead">Zasłoń dane osobowe w&nbsp;piśmie, zanim opublikujesz je w&nbsp;BIP albo wkleisz do czatu&nbsp;AI.</p>',
  );
  // karta „Ograniczenia” mówi „narzędzie pomocnicze, nie gwarancja”, więc reszta strony też
  expect(webHtml).not.toContain('bezpieczny tekst');
  expect(webHtml).not.toContain('· anonim');
  expect(webHtml).not.toMatch(/>\s*bezpieczne\s*</);
  expect(webHtml).toContain(
    '<li data-tip="Nie ma konta ani serwera. Tekst przetwarza przeglądarka na tym komputerze." tabindex="0">bez konta i serwera</li>',
  );
  expect(webHtml).toContain('<p class="step-d">skopiuj wynik albo zapisz plik</p>');
  expect(webHtml).toContain('<span class="dz-x"> · zasłonięte</span>');
  expect(webHtml).toContain('<span class="demo-anon">zasłonięte</span>');
  // skrót do edytora zostaje dla wąskich ekranów
  expect(webHtml).toMatch(/<section class="card g6 card-ed" id="edytor">/);
});

test('aplikacja: liczba „—” w widocznej treści nie rośnie (dziś zero)', () => {
  const text = visibleText(webHtml);
  expect(text).toContain('Tekst źródłowy');
  expect(text.match(/—/g) ?? []).toHaveLength(0);
});

test('aplikacja: karta „Ograniczenia” opisuje urzędnika, księgę wieczystą, działkę i metadane pliku', () => {
  const card = webHtml.match(/<section class="card g4 caveat" id="ograniczenia"[\s\S]*?<\/section>/)?.[0] ?? '';
  expect(card).not.toBe('');
  for (const li of [
    'Nazwisko urzędnika pod pismem jest zasłaniane tak samo jak dane strony.',
    'Numer księgi wieczystej i&nbsp;numer działki zostają w&nbsp;tekście.',
    'Właściwości pliku (autor), komentarze i&nbsp;historia zmian zostają w&nbsp;oryginale. Publikuj plik zapisany z&nbsp;Parawana.',
  ]) {
    expect(card).toContain(`<li>${li}</li>`);
  }
});

test('aplikacja: stopka prowadzi do informacji dla IOD i działu IT na stronie produktu', () => {
  const foot = webHtml.match(/<footer class="card foot g12">[\s\S]*?<\/footer>/)?.[0] ?? '';
  expect(foot).toContain(
    '<a href="https://parawan.karolwilczynski.com/#dla-iod" target="_blank" rel="noopener noreferrer">Informacja dla IOD i działu IT</a>',
  );
  // sekcja istnieje na stronie produktu
  expect(landingHtml).toMatch(/id="dla-iod"/);
});

test('aplikacja: kolejność sekcji w kodzie równa kolejności na ekranie', () => {
  const html = webHtml.replace(/<!--[\s\S]*?-->/g, '');
  const order = [
    '<header class="card hero g12">',
    'id="edytor"',
    '<h2 id="output-label">',
    'id="findings"',
    'id="co-maskowac"',
    '<h2>Kolory znaczników</h2>',
    'id="co-wykrywa"',
    'id="ograniczenia"',
    '<section class="how g12" id="jak-to-dziala"',
    '<footer class="card foot g12">',
  ].map((m) => html.indexOf(m));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // nagłówek strony bez kroków i animacji: są w „Jak to działa”
  const header = html.match(/<header class="card hero g12">[\s\S]*?<\/header>/)?.[0] ?? '';
  expect(header).toContain('id="app-build-date"');
  expect(header).not.toMatch(/class="card step|demo-stage/);
});

// Przykład pod „Przykład” i w ?demo: pismo urzędowe, na którym widać i to, co Parawan zasłania,
// i to, co zostawia. Gdy wynik zaskoczy, poprawia się przykład, nie silnik.
test('aplikacja: przykład pisma urzędowego, co zasłania, a co zostawia', () => {
  const { redacted } = redactPII(EXAMPLE_TEXT);
  for (const leak of [
    'RGK.6220.14.2026',
    '85071412358',
    'Lipowa',
    '62-650',
    'Kłodawa',
    'PL43 1090',
    '600 700 800',
    't.wierzbicki@example.com',
    'Wierzbicki',
    'Malec',
  ]) {
    expect(redacted, leak).not.toContain(leak);
  }
  for (const token of ['[ZNAK-SPRAWY]', '[PESEL]', '[ADRES]', '[KOD-POCZTOWY]', '[MIEJSCOWOŚĆ]', '[NR-KONTA]', '[TELEFON]', '[EMAIL]']) {
    expect(redacted, token).toContain(token);
  }
  expect(redacted.match(/\[IMIĘ I NAZWISKO\]/g)).toHaveLength(2);
  for (const kept of ['art. 104 Kpa', 'działki nr 245/7', '17 zł', 'Z up. Wójta', 'Kierownik Referatu Gospodarki Komunalnej']) {
    expect(redacted, kept).toContain(kept);
  }
  // ten sam numer PESEL i nazwisko powtarza scripts/e2e/helpers.mjs
  const helpers = repoFile(new URL('../../../scripts/e2e/helpers.mjs', import.meta.url));
  expect(helpers).toContain("export const EXAMPLE_PESEL = '85071412358';");
  expect(helpers).toContain("export const EXAMPLE_NAME = 'Wierzbicki';");
  // demo w ?demo i przycisk „Przykład” biorą ten sam tekst
  expect(webMain).toContain("import { EXAMPLE_TEXT } from './example';");
  expect(webMain.match(/EXAMPLE_TEXT/g)).toHaveLength(3);
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
  expect(ids).toEqual(['print', 'download', 'download-docx', 'copy']);
  expect(acts).toContain(
    `<button type="button" id="print" class="btn tbtn" data-tip="${PRINT_TIP}">` +
      '<i class="gi" data-i="drukarka"></i><span>Drukuj lub zapisz PDF</span></button>',
  );
  // ikona jak pozostałe: inline SVG w kolorze tekstu przycisku
  expect(ICONS.drukarka).toMatch(/^<svg [^>]*stroke="currentColor"[^>]*aria-hidden="true">/);
});

// „Pobierz .docx” zapisuje nowy dokument, a nie poprawiony oryginał: dymek mówi, czego w nim
// nie ma, a dopisek pod wynikiem, że układ i tabele oryginału nie przechodzą.
const DOCX_TIP =
  'Zapisuje nowy dokument Word z samym wynikiem. Nie ma w nim autora, komentarzy ani historii zmian oryginału.';
const DOCX_HINT = 'Układ i tabele oryginału nie są przenoszone, kolumny tabel zostają tabulatorami.';

test('aplikacja: „Pobierz .docx” obok „Pobierz .txt”, z dymkiem, ikoną i dopiskiem o układzie', () => {
  // Podpis „Pobierz” nad oboma formatami; nazwa przycisku to podpis i rozszerzenie.
  const pair = webHtml.match(/<span class="dl-pair"[\s\S]*?<\/button>\s*<\/span>\s*<\/span>/)?.[0] ?? '';
  expect(pair).toContain('role="group" aria-labelledby="dl-cap"');
  expect(pair).toContain('<span class="dl-cap" id="dl-cap">Pobierz</span>');
  expect(pair).toContain(
    '<button type="button" id="download" class="btn dl-btn" aria-labelledby="dl-cap download-label"',
  );
  expect(pair).toContain(
    `<button type="button" id="download-docx" class="btn dl-btn" aria-labelledby="dl-cap download-docx-label" data-tip="${DOCX_TIP}">` +
      '<i class="gi" data-i="plik-docx"></i><span id="download-docx-label">.docx</span></button>',
  );
  expect(ICONS['plik-docx']).toMatch(/^<svg [^>]*stroke="currentColor"[^>]*aria-hidden="true">/);
  expect(webHtml).toContain(
    `<div class="card-f print-note">\n          <i class="gi" data-i="plik-docx"></i>\n          <p class="out-hint">${DOCX_HINT}</p>`,
  );
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

/* ── Start w starszych przeglądarkach urzędowych ── */

/** Plik z repo jako tekst z końcami wierszy \n (checkout na Windows ma \r\n). */
const repoFile = (url: URL): string => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');

// 109 to ostatnie Chrome i Edge dla Windows 7, 8.1 i Server 2012 R2, 115 to ostatni Firefox ESR
// dla Windows 7 i 8.1. Ta sama lista musi stać w obu plikach konfiguracji.
const BUILD_TARGET = ['chrome109', 'edge109', 'firefox115', 'safari16.4'];

for (const [name, rel] of [
  ['aplikacja', '../vite.config.ts'],
  ['landing', '../../landing/vite.config.ts'],
] as const) {
  test(`${name}: build.target i build.cssTarget przypięte do Chrome i Edge 109, Firefoksa 115 i Safari 16.4`, () => {
    const cfg = repoFile(new URL(rel, import.meta.url));
    expect(cfg.length).toBeGreaterThan(0);
    const list = cfg.match(/\nconst BUILD_TARGET = \[([^\]]*)\];\n/)?.[1] ?? '';
    expect([...list.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(BUILD_TARGET);
    const build = cfg.match(/\n {2}build: \{\n([\s\S]*?)\n {2}\},\n/)?.[1] ?? '';
    expect(build).toMatch(/^ {4}target: BUILD_TARGET,$/m);
    expect(build).toMatch(/^ {4}cssTarget: BUILD_TARGET,$/m);
    // uzasadnienie przy liście, bo podniesienie wyłącza Windows 7 i 8.1
    expect(cfg).toContain('Windows 7');
    expect(cfg).toContain('DLA-IOD-I-IT.txt');
  });
}

const BOOT_FAIL =
  '<div id="boot-fail" class="boot-fail" role="alert"><p><strong>Parawan nie uruchomił się w tej ' +
  'przeglądarce, więc pola poniżej nie działają.</strong> Otwórz plik w aktualnym Edge, Chrome albo ' +
  'Firefoksie. Na komputerze służbowym dział IT może blokować skrypty w plikach otwieranych z dysku ' +
  'albo otwierać je w trybie Internet Explorera. Opis dla działu IT: plik DLA-IOD-I-IT.txt na ' +
  'github.com/karolpolikarp/parawan/<wbr>releases.</p></div>';
const NO_JS =
  '<noscript><div class="boot-fail boot-fail-now"><p><strong>Ta przeglądarka ma wyłączony ' +
  'JavaScript.</strong> Parawan rozpoznaje dane programem zapisanym w tym pliku, więc bez ' +
  'JavaScriptu nie zadziała. Plik nie łączy się z internetem. Na komputerze służbowym poproś dział ' +
  'IT o zezwolenie na skrypty w plikach otwieranych z dysku.</p></div></noscript>';

test('aplikacja: pasek „nie uruchomił się” i komunikat bez JavaScriptu na początku strony', () => {
  const html = webHtml.replace(/\r\n/g, '\n');
  // pierwsze dziecko <body>, zaraz po nim <noscript>, potem siatka strony
  expect(html).toContain(`<body>\n    ${BOOT_FAIL}\n    ${NO_JS}\n    <div class="grid">`);
  // bez JavaScriptu stoi tylko komunikat z <noscript>, bez paska po 4 s
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('<noscript><style>#boot-fail{display:none}</style></noscript>');
  // osobny arkusz w <head>: działa także bez zmiennych i reguł ze style.css
  const css = head.match(/<style>\n([\s\S]*?)\n {4}<\/style>/)?.[1] ?? '';
  expect(css).not.toBe('');
  expect(css).not.toContain('var(');
  expect(css).toMatch(/\.boot-fail p\{[^}]*padding:14px 16px;[^}]*background:#fff4c2;color:#1a1a1a;/);
  expect(css).toMatch(/#boot-fail\{[^}]*visibility:hidden;max-height:0;animation:boot-reveal 0s linear 4s forwards\}/);
  expect(css).toContain('@keyframes boot-reveal{to{visibility:visible;max-height:40em}}');
  // Na wydruk nie trafiają, bo oba są dziećmi <body> (pierwsza asercja), a @media print w
  // style.css chowa każde dziecko <body> poza #print-out regułą z !important (pilnuje jej
  // markup.test.ts). Przebić ją mogłoby tylko !important w tym arkuszu. Sam wydruk paska
  // sprawdza e2e (emulacja druku w smoke.test.mjs).
  expect(css).not.toContain('!important');
});

/** Współczynnik kontrastu WCAG dwóch kolorów #rrggbb. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('aplikacja: tekst paska startowego ma kontrast co najmniej 7:1', () => {
  expect(contrast('#1a1a1a', '#fff4c2')).toBeGreaterThanOrEqual(7);
});

test('aplikacja: przy ograniczonym ruchu style.css skraca animacje, ale nie zeruje opóźnienia', () => {
  const css = repoFile(new URL('./style.css', import.meta.url));
  expect(css.length).toBeGreaterThan(1000);
  const reduce = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)];
  expect(reduce.length).toBeGreaterThan(0);
  for (const [block] of reduce) {
    // reguła dla wszystkich elementów: bez animation-delay i bez skrótu animation, który zeruje
    // opóźnienie (pasek „nie uruchomił się” czeka przez nie 4 s)
    const all = block.match(/\*, \*::before, \*::after \{([^}]*)\}/)?.[1] ?? '';
    expect(all).toContain('animation-duration');
    expect(all).not.toMatch(/animation-delay|animation:/);
  }
});

test('aplikacja: pasek „nie uruchomił się” znika w ostatniej instrukcji startu (main.ts)', () => {
  const code = webMain.replace(/\r\n/g, '\n');
  const remove = "document.getElementById('boot-fail')?.remove();";
  const at = code.indexOf(remove);
  expect(at).toBeGreaterThan(0);
  expect(code.indexOf(remove, at + 1)).toBe(-1);
  // nic po niej, a przed nią (pomijając komentarz) pierwsze przeliczenie update()
  expect(code.slice(at + remove.length).trim()).toBe('');
  expect(code.slice(0, at).replace(/(\n\/\/[^\n]*)+\n$/, '').trimEnd()).toMatch(/\nupdate\(\);$/);
});

test('teksty startowe: bez wtrąceń „ — ”, „100%” i „nas/nam/nasz”', () => {
  for (const t of [BOOT_FAIL, NO_JS]) {
    expect(t).not.toContain(' — ');
    expect(t).not.toContain('100%');
    expect(t).not.toMatch(/\b(nas|nam|nasz\w*)\b/i);
    expect(t).not.toMatch(/w pełni|po prostu/);
  }
});

/* ── Strażnik: API i CSS nowsze niż build.target ── */

// build.target obniża tylko składnię. Nowe API albo właściwość CSS przechodzą build bez słowa,
// a w Edge 109 (Windows 7 i 8.1) i Firefoksie ESR 115 kończą się wyjątkiem albo pominiętą regułą.
// Lista to konstrukcje, których te przeglądarki nie znają, a które łatwo dopisać odruchowo; każda
// z przykładem, na którym strażnik musi zadziałać. text-wrap zostaje: stare silniki pomijają go
// bez szkody. Gdy któraś będzie potrzebna, to sygnał do podniesienia BUILD_TARGET (vite.config.ts).
const NEWER_THAN_TARGET: { re: RegExp; what: string; sample: string }[] = [
  {
    re: /:has\(/,
    what: ':has() (Firefox od 121; 115 pomija całą regułę, a querySelector rzuca wyjątek)',
    sample: '.card:has(> .x) { display: grid; }',
  },
  { re: /\bcolor-mix\(/, what: 'color-mix() (Chrome i Edge od 111)', sample: 'color: color-mix(in srgb, red, blue);' },
  { re: /\blight-dark\(/, what: 'light-dark() (Chrome od 123, Firefox od 120)', sample: 'color: light-dark(#000, #fff);' },
  { re: /@starting-style\b/, what: '@starting-style (Chrome od 117, Firefox od 129)', sample: '@starting-style { .x { opacity: 0; } }' },
  { re: /\b(anchor-name|position-anchor)\s*:/, what: 'pozycjonowanie kotwicą CSS (Chrome od 125)', sample: '.x { anchor-name: --a; }' },
  { re: /\bfield-sizing\s*:/, what: 'field-sizing (Chrome od 123)', sample: 'textarea { field-sizing: content; }' },
  { re: /@scope\b/, what: '@scope (Chrome od 118, Firefox od 128)', sample: '@scope (.card) { p { margin: 0; } }' },
  {
    re: /:popover-open|\b(show|hide|toggle)Popover\(|\.popover\s*=|<[a-z][^>]*\spopover(target)?\b/i,
    what: 'popover (Chrome od 114, Firefox od 125)',
    sample: 'el.showPopover();',
  },
  { re: /\bPromise\.withResolvers\b/, what: 'Promise.withResolvers (Chrome od 119)', sample: 'const { promise } = Promise.withResolvers();' },
  { re: /\b(Object|Map)\.groupBy\b/, what: 'Object.groupBy i Map.groupBy (Chrome od 117)', sample: 'Object.groupBy(rows, (r) => r.type);' },
  { re: /\.(toSorted|toReversed|toSpliced)\(/, what: 'toSorted, toReversed, toSpliced (Chrome od 110)', sample: 'const s = list.toSorted();' },
  { re: /\bArray\.fromAsync\b/, what: 'Array.fromAsync (Chrome od 121)', sample: 'await Array.fromAsync(stream);' },
  { re: /\bIntl\.Segmenter\b/, what: 'Intl.Segmenter (Firefox od 125)', sample: 'new Intl.Segmenter("pl");' },
  { re: /\bstartViewTransition\b/, what: 'View Transitions (Chrome od 111, Firefox od 144)', sample: 'document.startViewTransition(f);' },
  {
    re: /\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/,
    what: 'metody zbiorów Set (Chrome od 122, Firefox od 127)',
    sample: 'a.union(b);',
  },
];

/** Konstrukcje nowsze niż build.target znalezione w tekście (bez komentarzy). */
function newerThanTarget(src: string): string[] {
  const code = src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, '$1');
  return NEWER_THAN_TARGET.filter((c) => c.re.test(code)).map((c) => c.what);
}

/**
 * Pliki, które trafiają do gotowej strony: index.html i moduł startowy, a od niego każdy import
 * względny (także style.css) i rdzeń przez alias „anonimizator”. Zależności z node_modules
 * (pdf.js, fflate) sprawdza test na Chromium 109 (scripts/e2e/manual/README.md).
 */
function shippedFiles(html: URL, entry: URL): Map<string, string> {
  const core = new URL('../../../packages/core/src/index.ts', import.meta.url);
  const out = new Map<string, string>([[html.href, repoFile(html)]]);
  const visit = (url: URL): void => {
    if (out.has(url.href)) return;
    const src = repoFile(url);
    out.set(url.href, src);
    if (!url.pathname.endsWith('.ts')) return;
    const specs = src.matchAll(
      /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*\(?\s*['"]([^'"]+)['"]/g,
    );
    for (const m of specs) {
      const spec = m[1] ?? m[2] ?? '';
      if (spec === 'anonimizator') visit(core);
      else if (spec.startsWith('.') && !spec.includes('?')) {
        if (spec.endsWith('.css')) visit(new URL(spec, url));
        else if (!/\.\w+$/.test(spec) || spec.endsWith('.js')) visit(new URL(`${spec.replace(/\.js$/, '')}.ts`, url));
      }
    }
  };
  visit(entry);
  return out;
}

test('strażnik nowszych API i CSS: każda konstrukcja z listy zostaje wykryta', () => {
  for (const c of NEWER_THAN_TARGET) expect(newerThanTarget(c.sample)).toContain(c.what);
  // dopisane do arkusza aplikacji color-mix( wywraca strażnika
  const css = repoFile(new URL('./style.css', import.meta.url));
  expect(css.length).toBeGreaterThan(1000);
  expect(newerThanTarget(`${css}\n.x { color: color-mix(in srgb, red, blue); }`)).toEqual([
    'color-mix() (Chrome i Edge od 111)',
  ]);
  // komentarze i podobne nazwy nie są alarmem
  expect(newerThanTarget('/* bez color-mix(, bo Edge 109 */\n// list.toSorted() nie\nconst groupByCode = 1;')).toEqual([]);
  expect(newerThanTarget('p { text-wrap: pretty; }')).toEqual([]);
});

for (const [name, html, entry, mustHave] of [
  ['aplikacja', '../index.html', './main.ts', ['/apps/web/src/style.css', '/apps/web/src/pdf.ts', '/packages/core/src/surnames.ts']],
  ['landing', '../../landing/index.html', '../../landing/src/main.ts', ['/apps/landing/src/style.css', '/apps/landing/src/tokens.ts', '/packages/core/src/index.ts']],
] as const) {
  test(`${name}: kod i CSS strony bez API i CSS nowszych niż Chrome i Edge 109 i Firefox ESR 115`, () => {
    const files = shippedFiles(new URL(html, import.meta.url), new URL(entry, import.meta.url));
    for (const p of mustHave) expect([...files.keys()].some((k) => k.endsWith(p))).toBe(true);
    for (const [file, src] of files) {
      expect(src.length, file).toBeGreaterThan(0);
      expect(newerThanTarget(src), file).toEqual([]);
    }
  });
}
