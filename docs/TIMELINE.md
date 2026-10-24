# Oś czasu projektu Parawan (repo `anonimizator`)

Stan na 2026-10-24. Źródła: `git log --all`, tagi, gałęzie lokalne i zdalne, `gh pr list`,
`gh release list`, `gh run list` (wdrożenia strony), CHANGELOG.md. Daty commitów w czasie
lokalnym autora (+02:00), daty wydań na GitHubie przeliczone na ten sam czas.

## Podsumowanie

| Co | Wartość |
|---|---|
| Pierwszy commit | `5ca5f32`, 2026-07-03 16:47 (repo na GitHubie założone tego samego dnia o 17:04) |
| Commity we wszystkich gałęziach | 246 (`git rev-list --count --all`) |
| Commity w historii `main` | 242; pozostałe 4 to niezmergowane commity Dependabota |
| Autorzy | 234 commity autora (43 jako „Karol”, do 2026-07-06 i sporadycznie później, oraz 191 pod pełnym imieniem i nazwiskiem), 12 commitów Dependabota |
| Commity scalające | 5 (`31e721e`, `1837bfd`, `3d0812b`, `a3242f8`, `24b6aec`) |
| Wersje aplikacji | 84 numery od v0.1.0 do v0.46.25 |
| Tagi | 85 (84 wersje + `models-fastpdn-onnx-v1`); 7 tagów dodano wstecznie 2026-10-25, patrz niżej |
| Wydania na GitHubie | 78 (77 wersji + paczka modelu ONNX) |
| Dni z pracą autora | 21 |
| Najdłuższy przestój autora | prawie 86 dni (85 d 23 h): od `df58365` (2026-07-20 20:19) do `45ce1cf` (2026-10-14 19:07). Licząc commity Dependabota, najdłuższa przerwa to 54 dni (`b4c632e` → `45ce1cf`) |

**Okresy największej aktywności** (wszystkie gałęzie, z Dependabotem):

| Dzień | Commity | Co się działo |
|---|---|---|
| 2026-10-24 | 67 | sprint do v0.46.24 i v0.46.25, [Unreleased] CLI `--jsonl` |
| 2026-07-04 | 26 (18 autora, 8 Dependabota) | v0.2.1 → v0.12.0, NER, PDF, DOCX, redesign |
| 2026-07-06 | 22 | v0.17.0 → v0.35.0, wydanie dla urzędników |
| 2026-07-11 | 19 | utwardzenie NER, PR #13 i #14, v0.43.0 → v0.44.4 |
| 2026-10-14 | 16 | powrót po przerwie, audyt UI i rdzenia |
| 2026-07-13 | 15 | Apache 2.0, wydzielenie AI, marka Parawan, v0.45.1 → v0.46.8 |
| 2026-10-17 i 2026-10-18 | po 14 | gałąź `core-fixes`, testy e2e, PR #22 |

Tygodniowo (ISO): W27 (do 5 lipca) 36, W28 49, W29 38, W30 2, W34 1, W42 48, W43 72.
Tygodnie W31 do W33 i W35 do W41 są puste.

**Przestoje.** Wszystkie przerwy między commitami autora dłuższe niż doba, poza dwiema
największymi: 2026-07-05 00:59 → 2026-07-06 08:45 (31,8 h), 2026-07-07 22:44 → 2026-07-09 09:12
(34,5 h), 2026-07-09 13:59 → 2026-07-11 00:19 (34,3 h), 2026-07-15 07:28 → 2026-07-16 08:54
(25,4 h), 2026-07-16 23:59 → 2026-07-18 22:28 (46,5 h) i 2026-10-15 16:44 → 2026-10-17 09:57
(41,2 h). Długa przerwa: ostatni commit autora przed nią to `df58365` (2026-07-20 20:19).
W przerwie jest jeden commit Dependabota na osobnej gałęzi: `b4c632e` (2026-08-21). Trzy commity
z 2026-07-17 (`330bf8e`, `06250b4`, `17ce2e6`) powstały jeszcze przed przerwą. Powrót: `45ce1cf`
2026-10-14. Druga co do długości pauza: 2026-10-18 18:53 → 2026-10-23 23:08 (ponad 5 dni).

**Stan dziś.**

- Ostatnie wydanie: **v0.46.25** (tag na `72efa8b`, GitHub Release 2026-10-24 23:20, oznaczone jako Latest).
- **[Unreleased]:** `fa5edef`, tryb `--jsonl` w CLI. Rdzeń npm podbity do 0.29.13; ta wersja
  nie jest opublikowana w npm. Aplikacja web bez zmian.
- Otwarte PR Dependabota: #15 (`actions/deploy-pages` 4 → 5), #16 (`actions/upload-pages-artifact` 4 → 5),
  #17 (`actions/setup-node` 6 → 7), wszystkie z 2026-07-17, oraz #21 (grupa npm-all, 5 aktualizacji, 2026-08-21).
- Strona produktu: GitHub Pages z domeną `parawan.karolwilczynski.com`, ostatnie udane wdrożenie
  2026-10-24 23:21 (`72efa8b`), 30 uruchomień `deploy-landing.yml` w historii.

## Wersje uzupełnione wstecznie (tag albo wpis w CHANGELOG)

Podział wersji: wersja trwa od commita, który podbija `version` w `apps/web/package.json`,
do commita przed następnym podbiciem. Tag stoi na ostatnim commicie zakresu.

| Wersja | Data | Zakres | Braki |
|---|---|---|---|
| v0.17.0 | 2026-07-06 | `f05a550` | wpis w CHANGELOG odtworzony w tej rundzie porządków (tag i Release były) |
| v0.40.0 | 2026-07-09 | `25cfd7e..4def736` | wpis w CHANGELOG odtworzony w tej rundzie (tag i Release były) |
| v0.41.0 | 2026-07-09 | `b28e414` | tag dodany 2026-10-25 |
| v0.42.0 | 2026-07-11 | `12cdfae..753e61e` (6 commitów) | tag dodany 2026-10-25 |
| v0.46.11 | 2026-07-14 | `4dff7d5` | tag dodany 2026-10-25 |
| v0.46.14 | 2026-07-15 | `90c8912` | tag dodany 2026-10-25 |
| v0.46.15 | 2026-07-15 | `47940e9` | tag dodany 2026-10-25 |
| v0.46.17 | 2026-07-16 | `07f219d` | tag dodany 2026-10-25 |
| v0.46.21 | 2026-07-19 | `05b2509..3026e7d` (8 commitów) | wpis odtworzony, tag dodany 2026-10-25 |

## Okres 1: start i seria szybkich wydań (2026-07-03 → 2026-07-05)

- **2026-07-03 16:47, `5ca5f32`:** pierwszy commit. Od razu trzy części: biblioteka npm bez zależności,
  CLI i aplikacja web działająca w przeglądarce.
- **2026-07-03, v0.1.0 (`abd66b0`):** opcjonalny lokalny NER w Dockerze (`services/ner`, spaCy)
  i paczka offline. v0.1.1 (`750dcb1`) usuwa przypadkowo zacommitowany zagnieżdżony klon repo.
- **2026-07-03 → 04, v0.2.0 i v0.2.1 (`ceacf43`, `aa7d68e`):** wybór typów maskowania, własne
  placeholdery i pierwszy **jeden samowystarczalny `index.html`** działający z `file://`.
  To zalążek późniejszego produktu single-HTML.
- **2026-07-04, v0.3.0 → v0.3.4 (`66ea011` → `b420498`):** obsługa .docx, stabilizacja,
  szablony zgłoszeń, Dependabot. Rano tego dnia zmergowane PR #1 do #8 Dependabota.
- **2026-07-04, v0.4.0 (`40ed637`):** PDF przez pdf.js w buildzie single-file.
- **2026-07-04, v0.5.0 i v0.6.0 (`fc4f15d`, `bc4f3c8`):** słownik ok. 230 nazwisk z fleksją,
  spójna pseudonimizacja `[OSOBA-A]`/`[OSOBA-B]`.
- **2026-07-04, v0.7.0 (`7c11e3a`):** drugi backend NER, transformerowy clarin-pl/FastPDN obok spaCy.
  Tego samego dnia osobne wydanie `models-fastpdn-onnx-v1` z paczką modelu ONNX int8 (2 pliki).
- **2026-07-04, v0.8.0 (`638d87f`):** benchmark precyzji i czułości (`scripts/benchmark/run.mjs`),
  eksperymentalna warstwa LLM (Ollama, Bielik).
- **2026-07-04, v0.9.0 i v0.9.1 (`03e9e2f`, `084c066`):** NER ONNX w przeglądarce.
  Zmiana stosu AI: z usługi w Dockerze na model uruchamiany w karcie.
- **2026-07-04 → 05, v0.10.0 → v0.16.0 (`e778c25` → `839a31a`):** siedem wydań o wyglądzie
  i układzie treści: szlif po audycie, ciemny redesign, widok Porównanie (v0.12.0, `18f98a7`),
  potem odejście od „gamingowego” stylu i porządkowanie sekcji.

## Okres 2: wydanie dla urzędników i precyzja (2026-07-06 → 2026-07-09)

- **2026-07-06 08:45, v0.17.0 (`f05a550`):** układ kart na siatce, kategorie maskowania,
  tooltipy, statystyki wyniku. *Wpis w CHANGELOG odtworzony.*
- **2026-07-06, v0.18.0 (`f34763a`):** launcher `START-ANONIMIZATOR.bat` z mini-serwerem
  PowerShell, żeby model ONNX ruszał bez Dockera.
- **2026-07-06, v0.19.0 (`1ec32ef`):** zmiana kursu wydań. Zasób wydania to jeden plik
  `Anonimizator.html` i `JAK-UZYC.txt`; AI zostaje w repo, ale znika z wydania (edycja
  „urzędnik”, `VITE_EDITION`). Poprawki telefonów stacjonarnych i dowodów.
- **2026-07-06, v0.20.0 → v0.25.0 (`b612dec` → `77f5c0c`):** jasny motyw, numer wersji
  w nagłówku, kolejne poprawki wycieków imion i nazwisk. Po nich `366753a`, pierwszy test
  blokujący regresję nadmaskowania na realnym tekście urzędowym.
- **2026-07-06, v0.26.0 → v0.35.0 (`ebe4898` → `a070d0b`):** adresy i miejscowości, ikony
  inline SVG (v0.27.0), morfologia rzadkich nazwisk (v0.28.0), optymalizacja po audycie
  wieloagentowym (v0.30.0), edycja urzędnik zmniejszona z 1,77 MB do 99 kB (v0.31.0,
  częściowo cofnięte w v0.32.0, bo przywrócono PDF), KRS (v0.34.0), data urodzenia słownie (v0.35.0).
  Od v0.26.0 większość tagów jest adnotowana.
- **2026-07-07, v0.36.0 → v0.39.0 (`64ace49` → `9c79c0c`):** pola formularza „etykieta → wartość”,
  miejscowość w kontekście zamieszkania, grupowanie panelu „Co maskować”.
- **2026-07-09, v0.40.0 (`25cfd7e..4def736`):** wspólne rozszerzanie okien, teksty pod AI.
  *Wpis w CHANGELOG odtworzony.*
- **2026-07-09, v0.41.0 (`b28e414`):** znak sprawy (JRWA) i sygnatura akt. Wpis był, tagu brak.

## Okres 3: utwardzenie NER, licencja, wydzielenie AI i nowa marka (2026-07-11 → 2026-07-13)

- **2026-07-11 00:19 → 01:18, v0.42.0 (`12cdfae..753e61e`):** praca na gałęzi
  `feat/utwardzenie-ner-przegladarka`: utwardzenie NER ONNX w przeglądarce, dwie edycje,
  bramka regresji benchmarku w CI (`8f683f9`), reprodukowalny build paczki ONNX. Wpis był, tagu brak.
- **2026-07-11, v0.43.0 (`e377739`):** słownik nazwisk rozszerzony z rejestru PESEL.
  **PR #13** zmergowany o 10:54 (`31e721e`). Ostatni commit gałęzi `e377739`.
- **2026-07-11, PR #14 (`1837bfd`):** gałąź `chore/deps-dependabot` konsoliduje PR Dependabota
  #9 do #12 (te zamknięte bez merge'a) i usuwa `@huggingface/transformers` z devDeps (`56564df`).
- **2026-07-11, v0.44.0 → v0.44.4 (`b5d22ab` → `0b477ea`):** sześć nowych typów PII, maskowanie
  przy silnej etykiecie mimo złej sumy kontrolnej, dwie tury poprawek po raportach testera
  i pierwszy audyt adwersarialny.
- **2026-07-12, v0.45.0 (`b1fa9f0`):** struktura XML/JSON, ochrona URL-i, typ LOGIN, tolerancja OCR.
- **2026-07-13 08:53, v0.45.1 (`abb54d9`):** licencja **MIT → Apache 2.0** (`LICENSE`, `NOTICE`).
- **2026-07-13 11:14, v0.45.2 (`3bf7243`):** **warstwa AI wydzielona do repo `anonimizator-ai`**.
  Z tego repo znikają `services/ner/`, `launcher/`, build paczki ONNX i cały NER w `apps/web`.
  Koniec dwóch edycji: zostaje jeden plik HTML z samą deterministyką. To ostatni commit
  dotykający `services/`.
- **2026-07-13 12:02, v0.46.0 (`54b5721`, tag na `e2cf822`):** **marka Parawan**, nowy interfejs
  wg makiety, fonty Archivo i IBM Plex Mono wbudowane w plik jako `data:`.
- **2026-07-13 15:23, v0.46.2 (`771a9b8`, tag na `08c5dd5`):** **repo przemianowane z `anonimizator`
  na `parawan`** (stara nazwa przekierowuje), nowy favicon. Tego dnia także v0.46.1 i v0.46.3 → v0.46.8
  (`d1ef6f7` … `f7afbc3`): seria poprawek wyglądu, na koniec imię i nazwisko małymi literami.

## Okres 4: porządki w kodzie, strona produktu i audyty (2026-07-14 → 2026-07-20)

- **2026-07-14, v0.46.9 (`3b3d5c2`):** sprzątanie kodu, Biome, test golden-master
  `redact-golden.test.ts` zamrażający wynik `redactPII` na całym korpusie. Ten sam commit
  wnosi pierwszą wersję strony produktu (`apps/landing/`) i workflow `deploy-landing.yml`.
- **2026-07-14, v0.46.10 (`c383f0c`):** **dekompozycja `redactPII`** na 35 nazwanych przebiegów
  `passX` spiętych kontekstem; golden-master i benchmark bez zmian. Gałąź
  `chore/cleanup-transparency` kończy się na tym commicie. Tagi v0.46.9 i v0.46.10 założone
  razem o 10:27.
- **2026-07-14 10:50, pierwsze udane wdrożenie strony na GitHub Pages** (uruchomienie
  `deploy-landing.yml` na `c383f0c`; pierwsze, o 10:27, zakończyło się błędem).
- **2026-07-14, v0.46.11 (`4dff7d5`):** przepisane teksty strony. Tag dodany wstecznie.
- **2026-07-14, v0.46.12 i v0.46.13 (`0b607a9`, `1426796`):** karta płatnicza jako 23. typ PII.
- **2026-07-15, v0.46.14 i v0.46.15 (`90c8912`, `47940e9`):** animowany hero na stronie,
  imiona i nazwiska niezależne od wielkości liter w kontekście. Tagi obu dodane wstecznie.
- **2026-07-16, v0.46.16 → v0.46.20 (`e0ab9a8` → `8ef4b60`):** cztery rundy poprawek po audytach
  (petycja do urzędu marszałkowskiego, eponimy uliczne, PESEL po łączniku, REGON wielowyrazowy).
  Tag v0.46.17 (`07f219d`) dodany wstecznie.
- **2026-07-17:** Dependabot otwiera PR #15, #16, #17 (akcje GitHub) i #18 (grupa npm). #15 do #17
  nie są zmergowane, #18 zamknięto bez merge'a 2026-08-07, kilka sekund przed otwarciem #19.
- **2026-07-18 → 19, v0.46.21 (`05b2509..3026e7d`, 8 commitów):** audyt treści strony pod SEO
  i WCAG AA, 20 wad z audytu adwersarialnego, przepisanie tekstów na naturalną polszczyznę,
  skrypt statystyk odwiedzin przez Cloudflare GraphQL w `scripts/`. *Wpis w CHANGELOG odtworzony,
  tagu brak.*
- **2026-07-20, v0.46.22 (`53aaf2c`):** numer KSeF jako nowy typ danych z kotwicą dokumentową.
  Ostatni commit przed przerwą: `df58365` (opis KSeF na stronie), 20:19.

## Przerwa (2026-07-21 → 2026-10-13)

Brak commitów autora. W tym czasie Dependabot otwiera PR #19 (2026-08-07) i #20 (2026-08-14),
zamknięte później bez merge'a, oraz #21 (2026-08-21, `b4c632e`, otwarty).

## Okres 5: powrót, audyt i gałąź core-fixes (2026-10-14 → 2026-10-18)

- **2026-10-14 19:07, `45ce1cf`:** pierwszy commit po przerwie. Koniec kwadratowych wyrażeń
  regularnych: patologiczne wejście z 56 s do poniżej 60 ms. Tego wieczoru 16 commitów:
  poprawna suma kontrolna dowodu (`37f5002`), import plików, dostępność, nadmaskowanie numerów.
- **2026-10-14, `8a9dffa`:** **Content-Security-Policy w gotowych plikach** i strażnik w CI.
- **2026-10-15, v0.46.23 (`e4ac366`):** wydanie z CSP i poprawkami po audycie UI; tuż przed nim
  `f5dd4d0`, **nowa strona produktu** (demo na pierwszym ekranie).
- **2026-10-17 → 18, gałąź `core-fixes`:** scalenie `main` do gałęzi (`3d0812b`), partie poprawek
  rdzenia b3 do b5, fikcyjne pisma urzędowe do testów (`3282e5e`), **bramka e2e na gotowym pliku**
  (`4bf58ab`: sieć, CSP, błędy startu, rozmiar), sprawdzenia w Edge, starym Chromium i Firefoksie ESR.
  Funkcje web: druk samego wyniku (`cd9feb0`), PDF w Chrome i Edge 109–123 (`7e84ce4`),
  DOCX bez sklejania wierszy (`c0c8f78`). **PR #22 zmergowany 2026-10-18 18:35** (`a3242f8`),
  ostatni commit gałęzi `79ac306`.
- **2026-10-18 18:53, `d4264b8`:** ostatni commit przed pięciodniową pauzą (edycja `style.css`
  przez interfejs GitHuba).

## Okres 6: sprint do v0.46.24 i v0.46.25 (2026-10-23 → 2026-10-24)

- **2026-10-23 23:08, `b61c1bd`:** od tego commitu praca idzie dwoma torami równolegle
  (63 commity między 2026-10-23 23:00 a wydaniem v0.46.24).
- **Tor rdzenia na `main`:** partie poprawek wykrywania (resztki b3 do b5, b6-enterprise, b7,
  regresje z audytu końcowego i przed wydaniem). Najważniejsze: `4361790`, numer księgi wieczystej
  `[NR-KW]` jako nowy typ; `e163f6b`, ulica z patronem jako jeden inwariant; `1085e8d`, kotwica KW
  w miejscowniku.
- **2026-10-24 17:05, v0.46.24 (`82b73bc`):** wydanie z `main`, czyli nowy silnik wykrywania
  i funkcje z PR #22 (druk wyniku, DOCX bez sklejania, PDF w starszym Edge).
- **Tor aplikacji na gałęzi `ui-fala2`** (36 commitów od `1707502`, 2026-10-23 23:37, do `8bc4fb1`,
  2026-10-24 21:46): rundy weryfikacji A04 do A09, B02, C01, L01 i trzy rundy fuzzera. Najważniejsze:
  - `1707502`: WCAG 2.1 AA w bramce e2e;
  - `2172656`: „Pobierz .docx” z samego wyniku;
  - `741e4fc`: pliki dla IOD i działu IT, `SHA256SUMS`, atestacja wydania; `dec1b9a`: `.gitattributes` z LF;
  - `03e300c`: sekcja „Dla IOD i działu IT” na stronie;
  - `9e111b7`: model zakresów oryginał–znacznik (`spans.ts`);
  - `5b26aca`: adnotacja o wyłączeniu jawności i protokół do akt;
  - `ba5bc22`: ręczna korekta wyniku („Zostaw jawne”, „Zasłoń zaznaczenie”);
  - `5ace417`: **CSP ze skrótem skryptu** zamiast `'unsafe-inline'`;
  - `5a704ef`, `902f28d`, `8bc4fb1`: poprawki przypięte do tekstu, już po v0.46.24.
- **2026-10-24 22:08, `24b6aec`:** scalenie `main` (v0.46.24) do `ui-fala2`, potem przesunięcie
  `main` na wynik scalenia. Gałąź nie istnieje już jako ref.
- **2026-10-24 23:01, v0.46.25 (`f660678`, tag na `72efa8b`):** ręczna korekta wyniku, .docx z wyniku,
  adnotacja i protokół, pliki dla IOD i działu IT, CSP ze skrótem.
- **2026-10-24 23:25, `fa5edef`:** [Unreleased], CLI `--jsonl`, rdzeń 0.29.13.

## Zmiany stosu i architektury w skrócie

| Data | Commit lub tag | Zmiana |
|---|---|---|
| 2026-07-03 | `5ca5f32` | monorepo: rdzeń npm bez zależności, CLI, aplikacja web |
| 2026-07-03 | v0.1.0 `abd66b0` | NER spaCy w Dockerze jako opcja |
| 2026-07-04 | v0.2.1 `aa7d68e` | jeden samowystarczalny `index.html` z `file://` |
| 2026-07-04 | v0.7.0 `7c11e3a` | backend transformerowy FastPDN obok spaCy |
| 2026-07-04 | v0.8.0 `638d87f` | benchmark, warstwa LLM (Ollama) |
| 2026-07-04 | v0.9.0 `03e9e2f` | NER ONNX w przeglądarce |
| 2026-07-06 | v0.18.0 `f34763a` | launcher bez Dockera |
| 2026-07-06 | v0.19.0 `1ec32ef` | wydanie = jeden plik HTML, AI poza wydaniem |
| 2026-07-11 | `8f683f9` | bramka regresji benchmarku w CI |
| 2026-07-13 | v0.45.1 `abb54d9` | licencja Apache 2.0 |
| 2026-07-13 | v0.45.2 `3bf7243` | AI wydzielone do `anonimizator-ai`, w repo tylko deterministyka |
| 2026-07-13 | v0.46.0 | marka Parawan, fonty wbudowane |
| 2026-07-13 | v0.46.2 `771a9b8` | repo przemianowane na `parawan` |
| 2026-07-14 | v0.46.9 `3b3d5c2` | golden-master, Biome, strona produktu i GitHub Pages |
| 2026-07-14 | v0.46.10 `c383f0c` | `redactPII` jako orkiestrator 35 przebiegów |
| 2026-10-14 | `8a9dffa` | CSP w gotowych plikach, strażnik w CI |
| 2026-10-17 | `4bf58ab` | bramka e2e na gotowym pliku |
| 2026-10-24 | `741e4fc` | sumy SHA-256 i atestacja wydania |
| 2026-10-24 | `5ace417` | CSP ze skrótem skryptu |

## Gałęzie

| Gałąź | Ostatni commit | Zmergowana |
|---|---|---|
| `feat/utwardzenie-ner-przegladarka` (zdalna) | `e377739`, 2026-07-11 | tak, PR #13 |
| `chore/deps-dependabot` (zdalna) | `56564df`, 2026-07-11 | tak, PR #14 |
| `feat/landing-page` (lokalna) | `f7afbc3`, 2026-07-13 | tak, wskazuje na commit z `main`, brak własnych zmian |
| `chore/cleanup-transparency` (lokalna) | `c383f0c`, 2026-07-14 | tak, wskazuje na commit z `main` |
| `core-fixes` (lokalna i zdalna) | `79ac306`, 2026-10-18 | tak, PR #22 |
| `ui-fala2` (usunięta, odgałęziona od `b61c1bd`) | `8bc4fb1`, 2026-10-24 | tak, przez `24b6aec` |
| `dependabot/github_actions/actions/deploy-pages-5` | `330bf8e`, 2026-07-17 | nie, PR #15 otwarty |
| `dependabot/github_actions/actions/upload-pages-artifact-5` | `06250b4`, 2026-07-17 | nie, PR #16 otwarty |
| `dependabot/github_actions/actions/setup-node-7` | `17ce2e6`, 2026-07-17 | nie, PR #17 otwarty |
| `dependabot/npm_and_yarn/npm-all-5d9802417a` | `b4c632e`, 2026-08-21 | nie, PR #21 otwarty |

Porzucone kierunki: edycja „pełna / AI” z NER w przeglądarce, launcherem i usługą Docker
(rozwijana od v0.1.0 do v0.44.4) została zamknięta w tym repo w v0.45.2 i żyje dalej
w `anonimizator-ai`. Wcześniejsze cięcie rozmiaru edycji urzędnik przez wycięcie pdf.js
(v0.31.0) cofnięto w v0.32.0. Zamknięte bez merge'a PR Dependabota: #9 do #12 (zastąpione
przez #14), #18, #19, #20.
