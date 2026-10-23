# Wydanie Parawana: lista kontrolna

Lista dla jednej osoby, która wydaje nową wersję. Część pierwsza da się sprawdzić automatem
(także agentem), część druga wymaga właściciela i jego komputera z Windows, Wordem i czytnikiem
ekranu. Opis wydania, JAK-UZYC.txt, DLA-IOD-I-IT.txt i SHA256SUMS.txt powstają same
w `release.yml` z szablonów w `docs/wydanie/` (`scripts/release/render-docs.mjs`).

## 1. Przed tagiem (automat)

1. Gałąź scalona na `main`, CI zielone, w katalogu roboczym tylko zmiany tego wydania.
2. Pełna bramka z `CLAUDE.md` i E2E:

   ```bash
   npm ci
   npm run lint
   npm run build -w anonimizator && npm run test -w anonimizator
   npx tsc -p apps/web/tsconfig.json && npm run test -w anonimizator-web
   npm run build -w anonimizator-web
   npx tsc -p apps/landing/tsconfig.json && npm run build -w parawan-landing
   node scripts/benchmark/run.mjs --check
   npm run e2e
   ```

   Benchmark nadpisuje `docs/BENCHMARK.md` i `scripts/benchmark/results.json`. Jeśli wydanie
   nie zmienia detekcji, przywróć je: `git checkout -- docs/BENCHMARK.md scripts/benchmark/results.json`.
3. Stare i inne przeglądarki: `gh workflow run zgodnosc.yml` (Chromium 109, Edge na Windows,
   Firefox, LibreOffice) i zielony wynik. Gdy workflow nie przechodzi z powodów
   infrastruktury, ręcznie skryptami z `scripts/e2e/manual/` (opis w jego `README.md`):
   Chromium 109 (`pobierz-przegladarki.mjs`, potem `PARAWAN_CHROMIUM=… npm run e2e`)
   i Firefox ESR 115 (`ffprobe.mjs` z `?demo` i `?pdftest`).
4. Nowe kontrolki w tym wydaniu: migawka drzewa dostępności (Playwright `ariaSnapshot`)
   dołączona do opisu PR, np.:

   ```bash
   node --input-type=module -e "
   import { chromium } from 'playwright';
   import { pathToFileURL } from 'node:url';
   const b = await chromium.launch();
   const p = await b.newPage();
   await p.goto(pathToFileURL('apps/web/dist/index.html').href + '?demo');
   console.log(await p.locator('main').ariaSnapshot());
   await b.close();"
   ```

5. `CHANGELOG.md`: sekcja `## vX.Y.Z — RRRR-MM-DD` z linią `Pilność: zwykła`, `zalecana`
   albo `pilna` (pilna: poprawka zamyka wyciek danych, czyli Parawan zasłania coś, co wcześniej przepuszczał,
   albo tekst mógł opuścić kartę). Najpierw
   to, co zmienia się dla urzędnika, potem szczegóły. Bez tej linii `render-docs.mjs`
   zatrzymuje wydanie.
6. Wersja w `apps/web/package.json` (i w `packages/core/package.json`, jeśli zmienia się rdzeń).
7. Próba wydania na `main`, bez publikacji:

   ```bash
   gh workflow run release.yml --ref main -f dry_run=true
   gh run watch
   ```

   Przebieg ma być zielony; w podsumowaniu są sumy i opis wydania, w artefakcie
   `pliki-wydania` gotowe pliki. Próba nie tworzy wydania ani atestacji.
8. Commit z jawną listą plików (`git add <ścieżki>`, nigdy `git add -A`), adnotowany tag
   `git tag -a vX.Y.Z -m "Parawan X.Y.Z"`, `git push origin main vX.Y.Z`.

## 2. Właściciel (tego automat nie sprawdzi)

- Czytnik ekranu: NVDA albo Narrator przechodzi przez nowe kontrolki i odczytuje ich nazwy.
- Tryb IE w Edge, jeśli jest skonfigurowany na komputerze testowym: Parawan pokazuje
  komunikat, że się nie uruchomił, a nie pustą stronę.
- „Pobierz .docx” z wyniku przykładu otwiera się w Wordzie bez naprawy i bez trybu zgodności
  (`scripts/e2e/manual/word-docx.ps1`).
- Wydruk do PDF w Edge z odznaczonymi „Nagłówkami i stopkami”: w PDF jest sam wynik, bez
  ścieżki pliku.
- JAK-UZYC.txt i DLA-IOD-I-IT.txt z artefaktu próby przeczytane w Notatniku i w Wordzie
  (polskie litery bez pytania o kodowanie).
- Zrzuty aplikacji 1366×768 i 390×844 obejrzane po buildzie.
- Cudze, niezatwierdzone pliki w głównym katalogu roboczym
  (`packages/core/bin/anonimizator.js`, `packages/core/package.json`) zostają poza commitem.

## 3. Po wydaniu

1. Wydanie ma pliki `Parawan.html`, `JAK-UZYC.txt`, `DLA-IOD-I-IT.txt`, `SHA256SUMS.txt`
   i opis z CHANGELOG z pilnością.
2. Sumy na pobranych plikach i zgodność z digestem, który podaje API GitHuba:

   ```bash
   gh release download vX.Y.Z -D /tmp/parawan-vX.Y.Z && cd /tmp/parawan-vX.Y.Z
   sha256sum -c SHA256SUMS.txt
   gh api repos/karolpolikarp/parawan/releases/tags/vX.Y.Z \
     --jq '.assets[] | select(.name == "Parawan.html") | .digest'
   gh attestation verify Parawan.html --repo karolpolikarp/parawan
   ```

3. Strona produktu: `gh workflow run deploy-landing.yml` (wydanie utworzone przez
   `GITHUB_TOKEN` nie uruchamia innych workflowów). Krok „Najnowsze wydanie zgodne z opisem
   na stronie” sprawdza CSP w Parawan.html i notkę „Dla działu IT” w JAK-UZYC.txt.
4. Pamięć projektu: stan wydania.
