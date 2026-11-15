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
   Nowa wersja rdzenia to ta sama wersja w `packages/parawan/package.json` (pole `version`
   i zależność `anonimizator`), a po wydaniu dwie publikacje w npm, najpierw rdzeń:
   `npm publish -w anonimizator`, potem `npm publish -w parawan`. Zgodność obu paczek
   pilnuje `packages/core/src/paczki-npm.test.ts`.
7. Próba wydania na `main`, bez publikacji:

   ```bash
   gh workflow run release.yml --ref main -f dry_run=true
   gh run watch
   ```

   Przebieg ma być zielony; w podsumowaniu są sumy i opis wydania, w artefakcie
   `pliki-wydania` gotowe pliki. Próba nie tworzy wydania ani atestacji.
8. Commit z jawną listą plików (`git add <ścieżki>`, nigdy `git add -A`), adnotowany tag
   `git tag -a vX.Y.Z -m "Parawan X.Y.Z"`, `git push origin main vX.Y.Z`.

### Rozmiar i czas startu

Rozmiaru pliku nie pilnuje żadna wymyślona liczba (do 2026-11-15 był to `MAX_WEB_BYTES` =
2 600 000 B). Są trzy bramki, każda z powodem:

- **Sufit pocztowy** (`smoke.test.mjs`, w `npm run e2e`): plik ≤ 7 120 614 B, czyli tyle, by
  załącznik w base64 z wierszami MIME (RFC 2045) i 256 000 B na treść maila (założenie) zmieścił
  się w domyślnym limicie wiadomości Exchange on-premises 10 MB
  (https://learn.microsoft.com/en-us/exchange/mail-flow/message-size-limits). Chroni tylko to,
  że plik w ogóle dojdzie mailem.
- **Skład pliku** (`sklad.test.mjs`, w `npm run e2e`): bez duplikatów modułów, z `node_modules`
  tylko `pdfjs-dist` i `fflate`, pdf.js nie większy niż jego `*.min.mjs` tej samej wersji, a każdy
  duży URI `data:` to jeden z fontów z `apps/web/src/fonts`. Łapie przypadkową drugą kopię kodu albo
  zasobu. Bajty po minifikacji liczy wtyczka `apps/web/build/sklad.ts` z mapy źródeł
  (`apps/web/dist/sklad.json`, nie trafia do wydania).
- **Czas startu** (`npm run perf`, job `start` w `ci.yml`): przy CPU ×4 (model Lighthouse
  urządzenia średniej klasy) LCP ≤ 2 500 ms (próg „dobry” z https://web.dev/articles/lcp)
  i „gotowe” ≤ 5 000 ms (RAIL, https://web.dev/articles/rail), plus próg względny wobec kotwicy,
  czyli wydania z `scripts/perf/kalibracja.json`. Chroni wygodę urzędnika na słabym komputerze. Opis modelu: `scripts/perf/README.md`.
  Job jest nieblokujący (`continue-on-error: true`), dopóki nie ma pomiaru zmienności (CV) na
  runnerach GitHuba: po ok. 10 przebiegach PR z CV ≤ 5% usuń `continue-on-error` z joba `start`;
  przy większym CV ustaw `MAX_RATIO = 1 + 4×CV` w `scripts/perf/start.mjs` albo usuń próg
  względny. 10 przebiegów, 5% i 4×CV to założenia (margines co najmniej 4 odchyleń
  standardowych); uzasadnienie w `scripts/perf/README.md`, „Zmienność (CV)”.

Po wydaniu (krok kalibracji): zmierz nowe wydanie na komputerze odniesienia i przestaw kotwicę.

```bash
gh release download vX.Y.Z -p Parawan.html -D /tmp/kotwica
node scripts/perf/start.mjs /tmp/kotwica/Parawan.html --rate 1 --runs 11 --json
node scripts/perf/start.mjs /tmp/kotwica/Parawan.html --rate 4 --runs 11 --json
sha256sum /tmp/kotwica/Parawan.html
```

Mediany wpisz do `scripts/perf/kalibracja.json`: `kotwica` (tag), `sha256`, `data`, `metoda`
(z wyniku), `gotowe_x1_ms` (z ×1), `ui_x4_ms`, `lcp_x4_ms`, `gotowe_x4_ms` (z ×4). Wydanie, które
już rozgrzewa silnik przy starcie i ma znaczniki `performance.mark` (każde po v0.47.0), dostaje
`"porownanie": ["ui", "lcp", "gotowe"]`. Pominięcie kroku nie psuje bramki: próg względny mierzy
wtedy zmiany od starszego wydania, co jest ostrzejsze.

Gdy bramka czasu nie przechodzi, zajrzyj do profilu CPU, a nie do bajtów: według pomiaru
z 2026-11-15 najwięcej czasu idzie na rozgrzewkę rdzenia, `regex-literals.ts` (85 ms przy ×1)
i wymuszony układ przez `offsetHeight` w `main.ts` (ok. 103 ms przy ×1); pdf.js to 66% bajtów,
ale ok. 15% czasu startu.

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

3. Strona produktu: po udanym „Release” z tagu deploy-landing.yml rusza sam (workflow_run,
   bo wydanie utworzone przez `GITHUB_TOKEN` nie uruchamia zdarzenia release). Sprawdź przebieg:
   `gh run list --workflow deploy-landing.yml -L 1`. Krok „Najnowsze wydanie zgodne z opisem na
   stronie” pobiera cztery pliki wydania, sprawdza SHA256SUMS.txt, digest z API, CSP
   w Parawan.html, notkę „Dla działu IT” i DLA-IOD-I-IT.txt, a build wstawia sumę na stronę.
   Po deployu krok „Kopia na domenie to plik z wydania” porównuje sumę
   `https://parawan.karolwilczynski.com/pobierz/Parawan.html` z wydaniem (do 10 minut prób).
   Gdy padnie przy HTTP 200, Cloudflare przepisuje HTML: wyłącz funkcję strefy (np. Email Address
   Obfuscation) albo zrezygnuj z kopii na domenie. Ręcznie: `gh workflow run deploy-landing.yml`,
   a próba, że sprawdzenie działa: `gh workflow run deploy-landing.yml -f proba_zlej_sumy=true`
   (job ma się wywrócić; potem zwykłe uruchomienie).
4. Pamięć projektu: stan wydania.
5. Kalibracja czasu startu na nowym wydaniu: część 1, „Rozmiar i czas startu”.
