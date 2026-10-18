# Ręczne sprawdzenia w prawdziwych i starych przeglądarkach

Automatyczna bramka (`npm run e2e`, pliki `scripts/e2e/*.test.mjs`) biegnie w Chromium
z Playwright. Urzędnik otwiera jednak Parawana w Edge albo Chrome na Windows, czasem w Chrome 109
na Windows 7 albo w Firefoksie ESR. Skrypty z tego katalogu sprawdzają to ręcznie: przed wydaniem
i w pakietach, które dotykają startu aplikacji, PDF albo układu. Uruchamiaj je z katalogu repo.
Fikcyjne pisma, na których pracują, leżą w `apps/web/src/fixtures/urzad/`.

## Przeglądarki

```bash
node scripts/e2e/manual/pobierz-przegladarki.mjs
```

Pobiera do `.cache/przegladarki/` (katalog w `.gitignore`, binarki nie trafiają do repo) snapshoty
Chromium 90, 109, 111 i 125, Firefoksa ESR 115 i 140 oraz geckodriver 0.36, razem ok. 950 MB.
Każde archiwum ma przypiętą sumę SHA-256; przy złej sumie plik jest usuwany, a skrypt kończy się
błędem. Na Windows od razu rozpakowuje archiwa i wypisuje ścieżki do `chrome.exe`, `firefox.exe`
i `geckodriver.exe`. Opcje: `--katalog <ścieżka>`, `--tylko chromium-1070054,geckodriver`,
`--bez-rozpakowania`.

| Katalog | Wersja | Po co |
|---|---|---|
| `chromium-857947` | Chromium 90.0.4430.0 | poniżej progu: skrypt nie startuje (blok statyczny klasy w pdf.js wymaga Chrome 94); pokazuje, co widzi urzędnik, gdy Parawan nie ruszył |
| `chromium-1070054` | Chromium 109.0.5414.0 | ostatni Chrome i Edge dla Windows 7 i 8.1, próg `build.target`; PDF działa dzięki łatce w `pdf.ts` |
| `chromium-1097610` | Chromium 111.0.5563.0 | domyślny cel składni Vite 8; PDF bez łatki w `pdf.ts` zawodził tu jak w 109 |
| `chromium-1287751` | Chromium 125.0.6422.0 | pierwsza wersja, którą pdf.js (legacy) wspiera oficjalnie |
| `firefox-115.43.0esr` | Firefox ESR 115 (pl) | Windows 7 i 8.1 w urzędach |
| `firefox-140.17.0esr` | Firefox ESR 140 (pl) | poprzednie ESR |
| `geckodriver` | 0.36.0 | sterowanie Firefoksem dla `ffprobe.mjs` |

Test dymny bramki na starym silniku: zmienna `PARAWAN_CHROMIUM` ze ścieżką do `chrome.exe`
włącza testy, które bez niej są pomijane (Playwright 1.61 steruje Chromium 109 i 111: przykład,
`?pdftest` i wczytany `pismo.pdf`):

```bash
PARAWAN_CHROMIUM=".cache/przegladarki/chromium-1070054/chrome-win/chrome.exe" npm run e2e
```

## Skrypty

| Skrypt | Co sprawdza | Uruchomienie |
|---|---|---|
| `mkprobe2.mjs` | Robi kopie pliku z sondą: żółty blok `#__probe` z wersją, wynikiem i błędami JS. `Parawan-probe.html` sprawdza start (otwieraj z `?demo` albo `?pdftest`), `Parawan-pliki.html` upuszcza po kolei `pismo.pdf`, `.docx`, `.odt` i `.rtf`, `Parawan-pliki-polyfill.html` robi to samo z łatką `ReadableStream[Symbol.asyncIterator]`. Kopie służą tylko do diagnozy. | `node scripts/e2e/manual/mkprobe2.mjs [Parawan.html] [katalog]` (domyślnie `apps/web/dist/index.html` i `.cache/sonda`) |
| `stary-chromium.mjs` | Otwiera kopię z sondą w starym Chromium przez `--headless --dump-dom` i wypisuje sondę; opcjonalnie robi zrzut. Nie zależy od Playwright, więc działa na każdym snapshocie, także na Chromium 90. Czas na sondę: zmienna `WAIT` w ms. Zrzut powstaje na czasie wirtualnym, w którym animacje CSS stoją, więc nie widać na nim paska startowego (do tego `pasek-startowy.mjs`). | `node scripts/e2e/manual/stary-chromium.mjs <chrome.exe> "<url kopii>?pdftest" [zrzut.png]` |
| `pasek-startowy.mjs` | Pasek „Parawan nie uruchomił się” w danej przeglądarce (Playwright, zwykły zegar): czy jest ukryty od razu, czy po 4,5 s jest widoczny (aplikacja nie ruszyła) albo usunięty przez `main.ts` (ruszyła), do tego wyjątki i błędy konsoli. Działa na snapshotach Chromium 90, 109 i 111 oraz na Edge i Chrome z systemu (`msedge`, `chrome`). `--ograniczony-ruch` emuluje `prefers-reduced-motion: reduce`. | `node scripts/e2e/manual/pasek-startowy.mjs <chrome.exe \| msedge \| chrome> ["<url>"] [zrzut.png] [--ograniczony-ruch]` (domyślnie `apps/web/dist/index.html?demo`) |
| `ffprobe.mjs` | To samo w Firefoksie dowolnej wersji przez geckodriver: sonda, wersja, początek wyniku, zrzut. | `node scripts/e2e/manual/ffprobe.mjs <firefox.exe> <geckodriver.exe> "<url>" <zrzut.png> [szer] [wys]` |
| `edge-probe.mjs` | Otwiera adresy w zainstalowanych Edge i Chrome (Playwright, `channel`) i czyta sondę. To przeglądarki, w których urzędnik naprawdę otwiera plik. | `node scripts/e2e/manual/edge-probe.mjs "<url1>" ["<url2>" …]` |
| `sesja-przegladarki.mjs` | Czy tekst wklejony do pola źródła zostaje w plikach sesji profilu i wraca po ponownym uruchomieniu z przywracaniem sesji. Wkleja fikcyjny PESEL, zamyka przeglądarkę, przeszukuje cały katalog profilu (w Firefoksie także rozpakowane `*.jsonlz4`), uruchamia ją znowu i czyta pole z przywróconej karty. Chromium działa w widocznym oknie, bo bez okna nie zapisuje sesji. Na kopii pliku bez `autocomplete="off"` na polu i na formularzu wypisuje „TEKST ZOSTAJE”, więc widać, że próba coś mierzy. `--plik`, `--pole demo-input --wynik demo-output` sprawdzają stronę produktu. | `node scripts/e2e/manual/sesja-przegladarki.mjs chromium [chrome.exe \| msedge \| chrome]` albo `… firefox <firefox.exe> <geckodriver.exe>` |
| `viewports.mjs` | Zrzuty pierwszego ekranu w Edge przy ekranach typowych dla urzędów (1366×768, 1280×720, 1536×864 przy skalowaniu 125%, 1920×1080, powiększenie 125%) i pomiar położenia pola źródła, wyniku i „Kopiuj”. | `node scripts/e2e/manual/viewports.mjs [plik.html] [katalog-zrzutów]` (domyślnie `apps/web/dist/index.html` i `.cache/viewports`) |
| `pdftext.mjs` | Tekst PDF wyciągnięty tym samym pdf.js co w aplikacji, strona po stronie. Przydaje się do sprawdzenia wydruku „Zapisz jako PDF” (czy nie zostało w nim pole źródła). | `node scripts/e2e/manual/pdftext.mjs <plik.pdf> [od] [do]` |
| `pdfout.mjs` | Pierwsza strona PDF jako jeden napis JSON: widać, gdzie pdf.js łamie wiersze. | `node scripts/e2e/manual/pdfout.mjs <plik.pdf>` |
| `perf.mjs` | Czas `redactPII` na piśmie 10, 50 i 200 KB; z `--jitless` jak na komputerze z wyłączonym JIT. Wymaga `npm run build -w anonimizator`. | `node [--jitless] scripts/e2e/manual/perf.mjs` |
| `docx-writeback-poc.mjs` | Prototyp zapisu zanonimizowanego DOCX z zachowaniem formatowania (dla A15): buduje DOCX z nagłówkiem, przypisem, komentarzem, śledzoną zmianą i metadanymi, podmienia tekst w węzłach i szuka wycieków w każdej części. Wymaga zbudowanego rdzenia. | `node scripts/e2e/manual/docx-writeback-poc.mjs [katalog]` (domyślnie `.cache/poc-docx`) |
| `zbuduj-pisma.mjs` | Buduje `pismo.docx`, `.odt`, `.rtf`, `.pdf` i `decyzja.pdf` w `apps/web/src/fixtures/urzad`. | `node scripts/e2e/manual/zbuduj-pisma.mjs [katalog]` |
| `zbuduj-pisma-docx.py` | Buduje `decyzja.docx` i `protokol-kontroli.docx` (python-docx) z `decyzja.txt` i `protokol-kontroli.txt` w `apps/web/src/fixtures/urzad`. Katalog z argumentu dostaje tylko gotowe pliki. | `python scripts/e2e/manual/zbuduj-pisma-docx.py [katalog-wyjściowy]` (domyślnie `apps/web/src/fixtures/urzad`) |

Adres pliku do skryptów to `file:///` i ścieżka z ukośnikami, np.
`file:///C:/Users/ja/anonimizator/.cache/sonda/Parawan-probe.html?demo`.

## Typowe sprawdzenie przed wydaniem

1. `npm run build -w anonimizator-web`, potem `node scripts/e2e/manual/mkprobe2.mjs`.
2. Chromium 109 i 111: `stary-chromium.mjs` z `Parawan-probe.html?pdftest` ma pokazać `[PDF OK]`,
   a `Parawan-pliki.html` zasłonięty PESEL we wszystkich czterech plikach.
3. Chromium 90: `pasek-startowy.mjs` ze zrzutem oryginalnego pliku, bez sondy (domyślny adres
   `apps/web/dist/index.html?demo`), raz zwykle i raz z `--ograniczony-ruch`. Ma wypisać
   „Parawan nie ruszył: pasek widoczny po 4,5 s” i wyjątek `Unexpected token '{'`, a na górze
   zrzutu ma stać żółty pasek „Parawan nie uruchomił się w tej przeglądarce…”. Bez paska porażka
   nie wygląda jak pusta strona: nagłówek, karty kroków i pokaz „Jak to działa” się rysują, a pola
   niżej nie reagują. Ten sam skrypt na Chromium 109 i 111 oraz z `msedge` ma wypisać „start
   w porządku: main.ts usunął pasek” i „błędy: brak”. Zrzut z `stary-chromium.mjs` paska nie
   pokaże (czas wirtualny zatrzymuje animacje CSS), a kopia z sondą przydaje się tu tylko do
   odczytania błędu.
4. Firefox ESR 115 i 140: `ffprobe.mjs` z `Parawan-probe.html?demo` i `?pdftest`.
5. Edge i Chrome: `edge-probe.mjs` z tymi samymi adresami, potem `viewports.mjs`.
6. Chromium 109, Edge i Firefox ESR 115: `sesja-przegladarki.mjs` ma wypisać „tekst nie zostaje”.

Wyniki i zrzuty zapisuj poza repo. Skrypty łączą się z siecią tylko przy pobieraniu przeglądarek;
sam Parawan w żadnym z tych sprawdzeń nie ma dostępu do sieci.
