# Testy E2E gotowego pliku

`npm run e2e` otwiera zbudowane `apps/web/dist/index.html` i `apps/landing/dist/index.html` przez
`file://` w Chromium z Playwright, tak jak urzędnik po dwukrotnym kliknięciu pliku. Najpierw
zbuduj oba pliki:

```bash
npm run build -w anonimizator-web && npm run build -w parawan-landing && npm run e2e
```

Za pierwszym razem Playwright potrzebuje przeglądarki: `npx playwright install chromium`.
Bramka wymaga Node 22 lub nowszego, jak job `e2e` w CI: `node --test` rozwija wzorzec
`scripts/e2e/*.test.mjs` sam dopiero od Node 21. Na Node 20 kończy się komunikatem
`Could not find '…/scripts/e2e/*.test.mjs'`, choć testy są na miejscu.

Po każdym teście `withApp()` z `helpers.mjs` sprawdza, że:

- poza samym dokumentem nie było żadnego żądania (dozwolone tylko `data:`, `blob:` i `about:`;
  każdy inny `file:` też jest błędem, bo plik ma być samowystarczalny) ani próby otwarcia
  WebSocketu,
- strona ani razu nie próbowała utworzyć połączenia WebRTC (`RTCPeerConnection`,
  `webkitRTCPeerConnection`, `RTCDataChannel`, `createDataChannel`): CSP go nie obejmuje,
  a Playwright nie pokazuje go jako żądania, więc kanał danych z numerem PESEL przeszedłby
  resztę bramki. Pułapka z `helpers.mjs` podmienia konstruktory przed pierwszym skryptem strony
  (także w ramkach i nowych oknach), zapisuje każdą próbę i rzuca wyjątek, więc połączenie nie
  powstaje; liczy się sama próba, także złapana przez kod strony,
- w localStorage są tylko klucze z listy `ALLOWED_KEYS` w `apps/web/src/storage.ts` (bramka
  czyta ją z tekstu tego pliku), a w localStorage, sessionStorage, bazach IndexedDB, Cache
  Storage, ciasteczkach, adresie i tytule karty, `window.name` i `history.state` nie ma żadnej
  danej z `FICTIONAL_PII` (PESEL, nazwiska, numer konta, e-mail i telefon z wczytywanych pism),
  bez względu na wielkość liter, spacje, łączniki i zapis w adresie. Sprawdzenie idzie dwa razy:
  zaraz po scenariuszu i po przewinięciu zegara o dobę,
- przeglądarka nie zgłosiła naruszenia CSP,
- w dokumencie nie pojawił się `<meta http-equiv="refresh">`, nawet na chwilę: przenosi on kartę
  pod dowolny adres (z danymi w adresie), CSP tego nie zatrzymuje, a jego licznik biegnie
  w czasie rzeczywistym, więc z opóźnieniem dłuższym niż scenariusz nie odpaliłby w teście,
- nie było wyjątku na stronie ani błędu w konsoli (wyjątek: ostrzeżenie pdf.js o „fake workerze”).

Strona działa na zegarze Playwright: czas płynie normalnie, ale przed sprawdzeniem zegar jest
przewijany: minutę krok po kroku, potem skok o dobę (każdy timer zaplanowany na później odpala
wtedy raz) i znów minutę. Próba wysłania danych z timera, po debounce, w `requestIdleCallback`
albo po kilku godzinach wywraca więc test tak samo jak próba od razu. Wyjątek z takiego timera
też.

Bramkę uruchamia CI (job `e2e`, po każdym wypchnięciu na `main` i w pull requeście) i wydanie
(`release.yml`, na tagu `v*`): plik, który trafia do wydania, przechodzi te same testy.

Tekst obu gotowych plików sprawdza `zakazane-api.mjs`: nie może w nim stać `RTCPeerConnection`,
`RTCDataChannel`, `sendBeacon`, `EventSource`, `WebTransport`, `new Worker(`, `SharedWorker`
ani `serviceWorker`. Jedyny wyjątek to `new Worker(` w klasie PDFWorker z pdf.js w pliku
aplikacji, rozpoznawany po napisach pdf.js wokół niego i dozwolony dokładnie raz: `pdf.ts`
podstawia workera w głównym wątku, więc ta gałąź się nie wykonuje, a gdyby się wykonała, worker
zatrzyma CSP. Ten sam moduł działa jako strażnik w `ci.yml`, `release.yml` i
`deploy-landing.yml`: `node scripts/e2e/zakazane-api.mjs` (z `web` albo `landing` jeden plik).
Napis złożony w czasie działania (np. `window['RTC' + 'PeerConnection']`) przejdzie ten
strażnik, ale nie pułapkę WebRTC z bramki.

Politykę CSP obu plików `csp.mjs` sprawdza dyrektywa po dyrektywie: dozwolone źródła to tylko
`'none'`, `'unsafe-inline'` i `data:` (w landingu także `img-src 'self'`), a `default-src`,
`connect-src`, `form-action`, `base-uri` i `object-src` muszą mieć `'none'`. W `script-src` stoją
wyłącznie skróty `'sha256-…'`, które `csp.mjs` liczy od nowa z treści skryptów w pliku: brak skrótu
zatrzymałby aplikację, a `'unsafe-inline'` wpuściłoby kod wstrzyknięty z treści pisma (test
w `smoke.test.mjs` wstawia do wyniku `<img onerror>` i oczekuje naruszenia CSP). Skróty wstawia
wtyczka `cspSkrot` z `apps/web/src/csp-skrot.ts` na końcu builda. Ten sam moduł działa
jako strażnik CSP w `ci.yml`, `release.yml` i `deploy-landing.yml`: `node scripts/e2e/csp.mjs`
(bez argumentu oba pliki, z `web` albo `landing` jeden).

Druk sprawdza `wydruk.test.mjs` na prawdziwym PDF-ie z Chromium (`page.pdf()` przy emulacji
druku), a tekst wyciąga z niego `pdfjs-dist` (wersja legacy, ta sama co w aplikacji). Na wydruku
ma być sam wynik, w całości i w obu widokach („Wynik” i „Porównanie”), bez pola źródła
i przekreślonych oryginałów. Wydruk ma font systemowy, a nie wbudowany Archivo (test czyta nazwy
fontów z PDF-u): z Archivo Firefox zapisywał PDF bez warstwy tekstu, a Chromium 109–125 bez
ó, ś, ć, ń, ź. Z `PARAWAN_CHROMIUM` ten sam wydruk powstaje na starym silniku i musi mieć polskie
litery w tekście. Ten sam plik sprawdza pobrany `.txt` (BOM UTF-8, końce wierszy `\r\n`), `.csv`
po wczytaniu pliku `.csv` i pasek nad wynikiem: przy 1351 i 1265 px (1366 i 1280 px z paskiem
przewijania Windows, który Playwright chowa) mieści się w jednym rzędzie, ma wysokość paska
źródła i nie zawija się po „Skopiowano ✓”.

„Pobierz .docx” sprawdza `smoke.test.mjs`: pobrany plik z `?demo` ma dokładnie siedem części
(`apps/web/src/docx-write.ts`), każdą z nich parsuje `DOMParser` przeglądarki bez
`<parsererror>`, nie ma w nich autora ani rsid, a akapity dokumentu to wiersz po wierszu
pobrany `.txt`. Po pierwszym pobraniu wyniku z wczytanego DOCX albo PDF pasek nad polem źródła
prosi o publikację nowego pliku, raz na otwarcie aplikacji. Ten sam dokument w LibreOffice
(`soffice --headless --convert-to txt`) porównuje `libreoffice.test.mjs`; biegnie z
`PARAWAN_SOFFICE` (job `libreoffice` w `zgodnosc.yml`), bez niej jest pomijany. Word sprawdza
się ręcznie: `manual/word-docx.ps1`.

Start w przeglądarce, w której Parawan nie ruszył, sprawdza `smoke.test.mjs` na kopii pliku bez
`<script type="module">` (tak wygląda Chromium 90, które nie parsuje modułu, i tryb Internet
Explorera): pasek „Parawan nie uruchomił się…” jest na początku ukryty i nie zajmuje miejsca, a po
4,5 s jest widoczny, także przy ograniczonym ruchu. Przy zwykłym starcie `main.ts` usuwa go
z dokumentu. Kontekst z wyłączonym JavaScriptem (`openApp(…, { javaScriptEnabled: false })`,
wtedy bez przewijania zegara i bez nasłuchu CSP, które działają skryptem na stronie) pokazuje
jeden komunikat z `<noscript>`, bez paska po 4 s.

Stary silnik sprawdza `legacy.test.mjs`, tylko z `PARAWAN_CHROMIUM` (bez niej wszystkie testy są
pomijane): przykład z `?demo`, `?pdftest` z wynikiem „[PDF OK]”, wczytany `pismo.pdf` i DOCX
upuszczony na pole źródła. pdf.js czyta tekst przez `for await` po `ReadableStream`, czego Chrome
i Edge przed 124 nie mają, i działa tam dzięki łatce w `pdf.ts`. `PARAWAN_CHROMIUM_WERSJA=109`
dodatkowo sprawdza, że binarka to naprawdę ta wersja.

Pierwszy ekran sprawdza `uklad.test.mjs`: przy oknach 1366×650, 1536×745, 1280×900 i 1920×960
(obszar strony typowych ekranów urzędowych w Edge) pole tekstu zaczyna się w górnych 40% okna
i widać z niego co najmniej 220 px, przy powiększeniu 125% (1093×520) zaczyna się na pierwszym
ekranie, nagłówek przy 1366×768 ma najwyżej 140 px, a przy 320–1920 px strona nie przewija się
w poziomie. Zrzuty w prawdziwym Edge robi ręczny `manual/viewports.mjs`.

Ręczną korektę wyniku sprawdza `korekta.test.mjs` na `fixtures/urzad/decyzja.txt`: „Zostaw jawne” na
znaczniku pod podpisem wójta (schowek, .txt i druk z nazwiskiem wójta, a wnioskodawca i PESEL dalej
zasłonięci, chip „imię i nazwisko” o jeden mniej), „Zostaw jawne wszędzie” z listą form, zaznaczenie
numeru księgi wieczystej w wyniku zasłonięte jako [DANE] w wyniku, .txt, `#print-out` i PDF z druku,
ta sama ścieżka samą klawiaturą (Shift+strzałki w polu źródła, Shift+Tab do „Zasłoń zaznaczenie”,
Enter na znaczniku), Ctrl+Z, przesunięcie poprawek po edycji źródła i „Wyczyść”. Klucze
localStorage po korektach są te same co przed nimi. Zaznaczenie prawdziwą myszą w Firefoksie ESR
sprawdza ręcznie `manual/korekta-zaznaczenie.mjs`.

`korekta-fuzz.test.mjs` składa losowe ciągi czynności (wklejanie pism, pisanie i usuwanie w jednym
miejscu, Ctrl+A z innym pismem, Ctrl+A i Delete, natywne Ctrl+Z, Ctrl+Y i Ctrl+Shift+Z w polu
i w wyniku, także kilka razy z rzędu, Ctrl+Z w polu karty pisma, „Zasłoń zaznaczenie”, „Zostaw
jawne” i „Cofnij zasłonięcie” tu i wszędzie, znak sprawy w karcie, „Wyczyść”, „Cofnij” na pasku)
w Chromium i Firefoksie. Po każdym kroku porównuje wynik, druk, schowek i .txt z modelem, znak po
znaku: dana wykryta w bieżącym tekście jest zasłonięta, chyba że „Zostaw jawne” podjęto na tym
samym tekście (albo na tekście, z którego bieżący powstał samym pisaniem obok) i urzędnik nie
zasłonił potem tego miejsca, a ręczne zasłonięcie nie znika bez decyzji. Znak sprawy stoi tylko
przy piśmie, przy którym go wpisano. Przed losowymi biegną ciągi z wcześniejszych błędów (`REGRESSIONS`). Domyślnie 30 ciągów
z losowym ziarnem; błąd podaje ziarno i skrócony ciąg kroków.
Długi przebieg: `PARAWAN_FUZZ_N=1000 PARAWAN_FUZZ_WSZYSTKIE=1 PARAWAN_FUZZ_RAPORT=raport.txt`,
powtórzenie: `PARAWAN_FUZZ_SEED=…` albo `PARAWAN_FUZZ_KROKI_JSON='[…]'` (opis zmiennych na górze pliku).
Brak Firefoksa z Playwright (jak w CI, które instaluje tylko Chromium) pomija jego część.

Dostępność sprawdza `a11y.test.mjs`. axe-core (wersja dokładna w `package.json`, reguły
`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`) biegnie na pustej aplikacji, po `?demo`, w widoku
„Porównanie”, z rozwiniętymi `<details>`, na telefonie 390×844 i na landingu. Źródło axe trafia
na stronę przez `page.evaluate`, więc CSP pliku go nie blokuje i bramka z `withApp()` działa jak
w innych testach. Naruszenie o wadze serious albo critical wywraca test, chyba że ma wpis
w `a11y-wyjatki.json` (skan, reguła, selektor, pakiet, który je usunie, powód). Wpis, którego axe
już nie zgłasza, też wywraca test, więc lista może tylko maleć. Raport axe z nieudanego skanu
trafia jako JSON do `test-results/e2e/`. Test-sprawdzian dopisuje na chwilę przycisk bez nazwy
i wymaga, żeby axe go zgłosił. Poza axe: obieg Tab od początku strony przez pole źródła,
nawigację po znacznikach i „Kopiuj” wraca na początek bez pułapki, a każdy przystanek ma widoczny
obrys; w trybie wysokiego kontrastu Windows (`forcedColors: 'active'`) znaczniki mają ramkę,
a fokus na znaczniku obrys; odstępy tekstu z WCAG 1.4.12 i okno 683×384 (powiększenie 200%) nie
dają poziomego przewijania ani przycisków wystających z pasków. Zrzuty do oceny wzrokiem
(fokus, wysoki kontrast, odstępy, powiększenie) zapisuje do `test-results/e2e/a11y/` albo do
katalogu z `PARAWAN_A11Y_ZRZUTY`.

Inne przeglądarki: `PARAWAN_PRZEGLADARKA=msedge` (Edge z systemu) albo `firefox` (Firefox
z Playwright, `npx playwright install firefox`) zmienia przeglądarkę testów, a
`PARAWAN_WEB_HTML` i `PARAWAN_LANDING_HTML` wskazują kopię plików w innym katalogu. Tak biegnie
`.github/workflows/zgodnosc.yml` (raz w tygodniu, po tagu `v*` i na żądanie, bez blokowania PR):
Chromium 109 ze snapshotu (`legacy.test.mjs` i wydruk), Edge na Windows na kopii w katalogu
„Narzędzia urzędu” i Firefox (`smoke.test.mjs` i `korekta.test.mjs`). W Firefoksie test drzewa dostępności formularza
jest pomijany, bo czyta je przez CDP. `wydruk.test.mjs` i `a11y.test.mjs` są dla Chromium.

Przy błędzie zrzut całej strony trafia do `test-results/e2e/` (w CI jako artefakt).
`PARAWAN_CHROMIUM` ze ścieżką do innej binarki Chromium włącza testy starego silnika
(`skip: LEGACY_SKIP`); stare przeglądarki pobiera `manual/pobierz-przegladarki.mjs`.

## Konwencje dla kolejnych zmian w aplikacji

- Każdy pakiet, który zmienia zachowanie aplikacji, dopisuje swoje scenariusze do
  `scripts/e2e/*.test.mjs` i otwiera plik przez `withApp()`, więc dostaje kontrolę sieci i CSP.
- Stałe zależne od przykładu w aplikacji (dziś `EXAMPLE_PESEL`, `EXAMPLE_NAME`, `EXAMPLE_EMAIL`
  i `EXAMPLE_IBAN_START`), numer z gotowych pism `pismo.*` (`PISMO_PESEL`) i lista fikcyjnych
  danych osobowych, których nie może być w pamięci przeglądarki ani w karcie (`FICTIONAL_PII`),
  są w jednym miejscu, w `helpers.mjs`. Scenariusz, który wczytuje pismo z nowymi danymi
  osobowymi, dopisuje je do `FICTIONAL_PII`. Scenariusze z `?demo` zaczynają od
  `app.demoReady()`, który sprawdza, że te napisy z przykładu naprawdę stoją w polu źródła.
- Nowy klucz localStorage trafia do `ALLOWED_KEYS` w `apps/web/src/storage.ts` (jedyna droga
  zapisu, `storageGet` i `storageSet` przyjmują tylko klucze z tej listy, a vitest pilnuje, że
  inne moduły nie sięgają po pamięć przeglądarki same). Bramka czyta tę listę z pliku.
  Ustawienie, które zmniejsza zasłanianie, po odczycie z pamięci musi być widoczne przy wyniku
  (reguły w komentarzu w `storage.ts`); scenariusz zapisu przez obcy plik z dysku jest
  w `smoke.test.mjs` (opcja `prepare` w `withApp()` dostaje kontekst przed otwarciem pliku).
- Kopię pod adresem http(s) (strona produktu, intranet urzędu) daje opcja `address` w `withApp()`:
  plik z dysku podany przez `page.route`, bez prawdziwej sieci.
- Asercja „numeru nie ma w wyniku” idzie w parze z asercją, że znacznik (np. `[PESEL]`) w nim
  jest. Sama negatywna przechodzi także na pustym wyniku.
- Testy treści CSS czytają `style.css` przez `node:fs` i zaczynają od asercji, że treść nie jest
  pusta: `import style.css?raw` daje w vitest pusty napis, a `not.toContain` przeszłoby zawsze.
- Nowe teksty widoczne dla użytkownika przechodzą sprawdzenie tonu: bez wtrąceń „ — ”, bez „100%”,
  bez „nas”, „nam”, „nasz”.
- Nowy kod nie używa API ani CSS nowszych niż `build.target` aplikacji (Chrome i Edge 109,
  Firefox 115, Safari 16.4). Build obniża tylko składnię, więc listę znanych pułapek (`:has(`,
  `color-mix(`, `toSorted`, `Promise.withResolvers` i inne) pilnuje strażnik w
  `apps/web/src/content.test.ts`, na plikach, które trafiają do aplikacji i strony.
- Każde nowe pole tekstowe na dane ma `autocomplete="off"`, `spellcheck="false"`
  i `translate="no"`.
- Nowy element interaktywny ma nazwę dostępną i widoczny fokus; `a11y.test.mjs` (axe, obieg Tab)
  to wyłapie. Wyjątku w `a11y-wyjatki.json` nie dopisuje się, żeby przejść bramkę: lista służy
  tylko zastanym naruszeniom i może tylko maleć.

Fikcyjne pisma do testów: `apps/web/src/fixtures/urzad/`. Ręczne sprawdzenia w Edge, starym
Chromium i Firefoksie ESR: `scripts/e2e/manual/README.md`.
