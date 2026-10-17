# Testy E2E gotowego pliku

`npm run e2e` otwiera zbudowane `apps/web/dist/index.html` i `apps/landing/dist/index.html` przez
`file://` w Chromium z Playwright, tak jak urzędnik po dwukrotnym kliknięciu pliku. Najpierw
zbuduj oba pliki:

```bash
npm run build -w anonimizator-web && npm run build -w parawan-landing && npm run e2e
```

Za pierwszym razem Playwright potrzebuje przeglądarki: `npx playwright install chromium`.

Po każdym teście `withApp()` z `helpers.mjs` sprawdza, że:

- poza samym dokumentem nie było żadnego żądania (dozwolone tylko `data:`, `blob:` i `about:`;
  każdy inny `file:` też jest błędem, bo plik ma być samowystarczalny),
- przeglądarka nie zgłosiła naruszenia CSP,
- nie było wyjątku na stronie ani błędu w konsoli (wyjątek: ostrzeżenie pdf.js o „fake workerze”).

Przy błędzie zrzut całej strony trafia do `test-results/e2e/` (w CI jako artefakt).
`PARAWAN_CHROMIUM` ze ścieżką do innej binarki Chromium włącza testy starego silnika
(`skip: LEGACY_SKIP`); stare przeglądarki pobiera `manual/pobierz-przegladarki.mjs`.

## Konwencje dla kolejnych zmian w aplikacji

- Każdy pakiet, który zmienia zachowanie aplikacji, dopisuje swoje scenariusze do
  `scripts/e2e/*.test.mjs` i otwiera plik przez `withApp()`, więc dostaje kontrolę sieci i CSP.
- Stałe zależne od przykładu w aplikacji (dziś `EXAMPLE_PESEL`) i lista kluczy localStorage
  (`ALLOWED_STORAGE_KEYS`) są w jednym miejscu, w `helpers.mjs`.
- Testy treści CSS czytają `style.css` przez `node:fs` i zaczynają od asercji, że treść nie jest
  pusta: `import style.css?raw` daje w vitest pusty napis, a `not.toContain` przeszłoby zawsze.
- Nowe teksty widoczne dla użytkownika przechodzą sprawdzenie tonu: bez wtrąceń „ — ”, bez „100%”,
  bez „nas”, „nam”, „nasz”.
- Nowy kod nie używa API ani CSS nowszych niż `build.target` aplikacji.
- Każde nowe pole tekstowe na dane ma `autocomplete="off"`, `spellcheck="false"`
  i `translate="no"`.
- Dostępność (axe), klawiatura, wysoki kontrast i stare przeglądarki w CI to osobny zestaw (B03).

Fikcyjne pisma do testów: `apps/web/src/fixtures/urzad/`. Ręczne sprawdzenia w Edge, starym
Chromium i Firefoksie ESR: `scripts/e2e/manual/README.md`.
