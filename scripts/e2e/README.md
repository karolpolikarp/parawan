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

Politykę CSP obu plików `csp.mjs` sprawdza dyrektywa po dyrektywie: dozwolone źródła to tylko
`'none'`, `'unsafe-inline'` i `data:` (w landingu także `img-src 'self'`), a `default-src`,
`connect-src`, `form-action`, `base-uri` i `object-src` muszą mieć `'none'`. Ten sam moduł działa
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

Start w przeglądarce, w której Parawan nie ruszył, sprawdza `smoke.test.mjs` na kopii pliku bez
`<script type="module">` (tak wygląda Chromium 90, które nie parsuje modułu, i tryb Internet
Explorera): pasek „Parawan nie uruchomił się…” jest na początku ukryty i nie zajmuje miejsca, a po
4,5 s jest widoczny, także przy ograniczonym ruchu. Przy zwykłym starcie `main.ts` usuwa go
z dokumentu. Kontekst z wyłączonym JavaScriptem (`openApp(…, { javaScriptEnabled: false })`,
wtedy bez przewijania zegara i bez nasłuchu CSP, które działają skryptem na stronie) pokazuje
jeden komunikat z `<noscript>`, bez paska po 4 s. Z `PARAWAN_CHROMIUM` (Chromium 109 albo 111)
dochodzi `?pdftest` i wczytany `pismo.pdf`: pdf.js czyta tekst przez `for await` po
`ReadableStream`, czego Chrome i Edge przed 124 nie mają, i działa tam dzięki łatce w `pdf.ts`.

Przy błędzie zrzut całej strony trafia do `test-results/e2e/` (w CI jako artefakt).
`PARAWAN_CHROMIUM` ze ścieżką do innej binarki Chromium włącza testy starego silnika
(`skip: LEGACY_SKIP`); stare przeglądarki pobiera `manual/pobierz-przegladarki.mjs`.

## Konwencje dla kolejnych zmian w aplikacji

- Każdy pakiet, który zmienia zachowanie aplikacji, dopisuje swoje scenariusze do
  `scripts/e2e/*.test.mjs` i otwiera plik przez `withApp()`, więc dostaje kontrolę sieci i CSP.
- Stałe zależne od przykładu w aplikacji (dziś `EXAMPLE_PESEL`, `EXAMPLE_NAME`, `EXAMPLE_EMAIL`
  i `EXAMPLE_IBAN_START`), numer z gotowych pism `pismo.*` (`PISMO_PESEL`) i lista kluczy
  localStorage (`ALLOWED_STORAGE_KEYS`) są w jednym miejscu, w `helpers.mjs`. Scenariusze
  z `?demo` zaczynają od `app.demoReady()`, który sprawdza, że te napisy z przykładu naprawdę
  stoją w polu źródła.
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
- Dostępność (axe), klawiatura, wysoki kontrast i stare przeglądarki w CI to osobny zestaw (B03).

Fikcyjne pisma do testów: `apps/web/src/fixtures/urzad/`. Ręczne sprawdzenia w Edge, starym
Chromium i Firefoksie ESR: `scripts/e2e/manual/README.md`.
