# Roadmapa Parawana

Stan na 2026-10-24, wersja bazowa v0.46.25 (rdzeń `anonimizator` 0.29.13 w repo, commit fa5edef).
Każda pozycja ma docelową wersję i rozmiar (S, M, L). Pozycje „Z repozytorium” wynikają z kodu,
CHANGELOG, dokumentów i PR-ów i podają źródło; „Propozycje” to pomysły spoza tych źródeł.

Zasady, które tu obowiązują: precyzja ważniejsza niż nadmaskowanie, jeden samowystarczalny plik
`Parawan.html` bez sieci, wyłącznie deterministyka. Warstwa NER/LLM rozwija się w osobnym repo
[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai) i nie wraca do tego.

## Teraz

Docelowo v0.46.26, rdzeń 0.29.14 (0.29.13 ma silnik z v0.46.24 i tryb `--jsonl`).

### Z repozytorium

1. **Formularz z TAB-em, w którym rola stoi jako etykieta**
   v0.46.26 / rdzeń 0.29.14 · M
   Klasa regresji oznaczona jako wysoka: `Powód:⇥Jan⇥Nazwisko:⇥Nowak` zostawia jawne imię,
   a `Rola⇥Poszkodowany⇥Imię⇥Ewa⇥Nazwisko⇥Lis` całą osobę. Sprawdzone dziś na `src`: wynik
   `Powód:⇥Jan⇥Nazwisko:⇥[IMIĘ I NAZWISKO]`. Źródło: CHANGELOG.md, v0.46.24, „Znane regresje”
   (pierwsza klasa).

2. **Pierwsza osoba w wyliczeniu w celowniku**
   v0.46.26 / rdzeń 0.29.14 · M
   `Przyznano Piotrowi Janowi i Annie Nowak dodatek.` daje `Przyznano Piotrowi Janowi
   i [IMIĘ I NAZWISKO] dodatek.` (odtworzone dziś). To druga klasa wysoka z listy znanych
   regresji v0.46.24. Źródło: CHANGELOG.md, v0.46.24, „Znane regresje”.

3. **CLI: brak testów `bin/anonimizator.js`**
   rdzeń 0.29.14 · S
   Zły wiersz w `--jsonl` nie kończy już procesu (odpowiedź `{"id", "error"}`, poprawione
   w [Unreleased]), ale żaden test ani workflow nie uruchamia CLI. Wystarczy test dymny obu
   trybów: zwykłego (stdin → stdout) i `--jsonl` z poprawnym i złym wierszem.
   Źródło: fa5edef, `packages/core/bin/anonimizator.js`.

4. **Decyzja o paczce npm `anonimizator` 0.29.13**
   rdzeń 0.29.13 · S
   Paczki nie ma w rejestrze (`npm view anonimizator` zwraca 404), README każe instalować
   z katalogu (README.md:235), a `package.json` ma już `prepublishOnly`. Trzeba wybrać: opublikować
   (wtedy także nazwa i lista `files`) albo zostać przy instalacji z repo i zapisać to wprost.
   `LICENSE` musi zostać w `packages/core`: npm dołącza ją do paczki sam, z katalogu paczki.
   Źródło: fa5edef, packages/core/package.json, README.md:235.

5. **Zaległe aktualizacje zależności z Dependabota**
   v0.46.26 · S
   Otwarte od lipca i sierpnia: #21 (Biome, esbuild, Vitest, Vite, pdfjs-dist), #15, #16, #17
   (akcje GitHub Pages i setup-node). `npm outdated` pokazuje już nowsze wersje niż #21 (Vite 8.3.5,
   pdfjs-dist 6.4.299), więc PR trzeba odświeżyć. pdfjs-dist trafia do `Parawan.html`, dlatego
   po podbiciu potrzebne są bramka E2E, limit rozmiaru i porównanie sumy w buildzie z tagu.
   Źródło: PR #21, #15, #16, #17, `npm outdated`.

6. **Job CI na Node 20**
   v0.46.26 · S
   Build i testy rdzenia oraz bramka benchmarku idą na Node 20 (`.github/workflows/ci.yml:15`),
   który nie ma wsparcia od 30.04.2026; reszta workflow jest już na Node 22. Rdzeń deklaruje
   `"node": ">=18"` (packages/core/package.json:60). Job z bramką celowo zostawiono na Node 20,
   gdy E2E przechodziło na Node 22 (komentarz w ci.yml przy jobie `e2e`); tę decyzję trzeba
   teraz rozważyć od nowa i uczciwie zapisać, co jest testowane. Źródło: `.github/workflows/ci.yml`.

7. **REGON z długim wtrąceniem dostaje znacznik telefonu**
   rdzeń 0.29.14 · S
   `REGON jednostki lokalnej przy oddziale w Gdańsku to 123456785` daje dziś `… to [TELEFON]`.
   Numer jest zasłonięty, ale z błędnym typem, a ten typ trafia do liczników i protokołu do akt.
   Okno etykiety ma `{0,3}` wyrazów (packages/core/src/index.ts:4483). Możliwy wariant: dłuższe
   okno tylko przy poprawnej sumie kontrolnej. Źródło: przypadek odtworzony na rdzeniu
   2026-10-24, reguła w packages/core/src/index.ts:4483.

8. **Brzmienie adnotacji o wyłączeniu jawności do sprawdzenia przez prawnika**
   v0.46.26 · S (bez kodu)
   Wzór informacji z art. 8 ust. 5 u.d.i.p. wszedł w v0.46.25 z dopiskiem, że brzmienie warto
   uzgodnić z prawnikiem urzędu. Po opinii poprawka tekstów i testu treści. Źródło: CHANGELOG.md,
   v0.46.25, „Adnotacja i protokół”.

### Propozycje

9. **Korpus ataków i narzędzia bilansu w repozytorium**
   v0.46.26 · M
   Bilans przed v0.46.24 (43,7 tys. miejsc lepiej, 334 gorzej) i korpus pod atak żyją tylko
   w roboczych katalogach poza repozytorium. Bez nich poprawki klas z pozycji 1 i 2 nie mają z czym się porównać.
   Proponuję `scripts/bilans/` z syntetycznym korpusem i porównaniem z poprzednim tagiem, wiersz
   po wierszu. Wniosek z rund przed v0.46.24: przy zgłoszeniach, które się nie zbiegają, lepszy jest
   inwariant z automatycznym wykrywaczem niż kolejne łatki.

## Następnie

Docelowo v0.47.x. Plan fal dla urzędów przewidywał A06–A09 i B02 w v0.47.0, ale weszły już do
v0.46.25. Dlatego następna fala (A10, A11 i L02) przesuwa się z v0.47.1 na v0.47.0. Kolejne fale
(A12–A14 i L03) zostają przy v0.48.0, jak w planie.

### Z repozytorium

10. **„Zostaw jawne”: dane urzędu i lista osób, podpowiedzi przy funkcjach publicznych,
    „Zawsze zasłaniaj” (A10)**
    v0.47.0 · L
    Te same dane urzędu (wójt, sekretarz, adres, domena e-mail, NIP, początek znaku sprawy)
    trzeba dziś odsłaniać w każdym piśmie osobno, decyzja wymaga około 10 ręcznych poprawek.
    Lista działa na zakresach po redakcji, bez zmian w `redactPII`, a lista „Zawsze zasłaniaj”
    nie trafia do pamięci przeglądarki. Podpowiedzi przy funkcjach publicznych są propozycją,
    decyduje człowiek. Źródło: plan fal dla urzędów spisany przy v0.46.25 (dokument roboczy
    autora, poza repozytorium; jego pierwsza część weszła do v0.46.25, patrz CHANGELOG.md).

11. **Profil „Do publikacji w BIP” i styl znaczników (A11)**
    v0.47.0 · M
    Jeden profil ustawień pod publikację w BIP zamiast ręcznego przełączania typów. Kolejne
    profile (CRU, petycje, oświadczenia majątkowe) plan odkłada do zebrania uwag. Źródło: jak
    w pozycji 10.

12. **Strona: sekcja „Pismo do publikacji w BIP” (L02)**
    v0.47.0 · S
    Po wydaniu A10 i A11. Źródło: jak w pozycji 10.

13. **Pozostałe klasy znanych regresji**
    v0.47.x / rdzeń 0.30.x · M
    Dwa imiona bez nazwiska brane za osobę (`Annie Paweł i Ola kupili kwiaty`), patron albo postać
    historyczna WERSALIKAMI (`GABINET JÓZEFA PIŁSUDSKIEGO W BELWEDERZE`), spójność pseudonimów przy
    `Imiona⇥Jan Stanisław`. Ostatnia nie powoduje wycieku. Źródło: CHANGELOG.md, v0.46.24, „Znane regresje”.

14. **Dokończenie audytu adwersarialnego v0.45 w pięciu obszarach**
    v0.47.x · M
    Telefony, tablice, XML i JSON, błędny OCR i wersaliki, adresy i miasta zostały przerwane
    w połowie. Część tych tematów poprawiały później v0.46.17–19, ale audytu według scenariusza nikt nie
    zamknął. Źródło: docs/SCENARIUSZ-TESTOW-v0.45.md:77–90.

15. **Loginy w ścieżkach adresów URL**
    v0.47.x / rdzeń 0.30.x · M
    Profil LinkedIn, osobisty OneDrive (`firma-my.sharepoint.com/personal/…`) i numeryczny profil
    Facebooka (`profile.php?id=…`) są już zasłaniane (packages/core/src/index.ts:1774–1786), ale
    `bank.example.com/user/akowalski` przechodzi jawne (sprawdzone dziś). Segment `/user/` i inne
    jednoznacznie osobowe ścieżki to kotwice strukturalne, więc pasują do zasady precyzji. Gołe
    `github.com/akowalski` świadomie zostaje bez reguły, bo ten sam kształt ma organizacja i projekt
    (komentarz w index.ts:1780). Źródło: docs/SCENARIUSZ-TESTOW-v0.45.md, sekcja 4.

### Propozycje

16. **Podział `index.ts` na moduły według faz**
    v0.47.x · L
    Plik ma 9359 linii i 51 funkcji `pass*`, a testy w `index.test.ts` kolejne 8270. Orkiestrator
    już jest (od v0.46.10), więc przeniesienie faz do osobnych plików nie zmienia zachowania,
    a golden-master daje twarde kryterium pustego diffu. Lepiej po pozycjach 1 i 2, żeby nie
    rozjechać równoległych poprawek. Siatką jest packages/core/src/redact-golden.test.ts.

17. **Wspólne fonty dla aplikacji i strony**
    v0.47.x · S
    Osiem plików woff2 w `apps/web/src/fonts/` i `apps/landing/src/fonts/` jest identycznych.
    Wystarczy jeden katalog i alias w Vite, bez nowych zależności. Ikony zostają osobno:
    `apps/landing/src/icons.ts` to celowo przycięty podzbiór, którego pilnuje test
    `apps/web/src/landing.test.ts`.

18. **Bilans względem poprzedniego tagu w liście kontrolnej wydania**
    v0.47.x · S
    `docs/WYDANIE.md` sprawdza testy, E2E i benchmark, ale nie wymaga porównania wyniku
    z poprzednim wydaniem. Po pozycji 9 to jedno polecenie i raport w opisie wydania (raport,
    nie bramka, bo „zero regresji” tą metodą okazało się nieosiągalne).

19. **Zgłoszenie błędnej maski prosto z aplikacji**
    v0.47.x · S
    Szablony zgłoszeń ze zmyślonym przykładem już są (`.github/ISSUE_TEMPLATE/`), a strona
    prowadzi wprost do nich. W `Parawan.html` link w stopce otwiera jednak tylko listę zgłoszeń,
    a karta „Ograniczenia” nie ma żadnego. Dwa linki prosto do szablonów („coś przeszło”, „coś
    zniknęło niepotrzebnie”) w tej karcie skracają drogę. W repozytorium nie ma dziś ani jednego
    zgłoszenia.

## Później

Docelowo v0.48 i dalej, potem 1.0.0 według kryteriów niżej.

### Z repozytorium

20. **Akapity z PDF składane z geometrii strony, z możliwością cofnięcia (A14)**
    v0.48.0 · M
    Źródło: plan fal (pozycja 10).

21. **Kontrola pliku DOCX i PDF przed publikacją, bez zmiany pliku (A12)**
    v0.48.0 · L
    Raport wylicza, co sprawdzono i czego kontrola nie obejmuje (np. strony bez warstwy tekstu),
    bez werdyktu „plik czysty”. Źródło: plan fal.

22. **ODT/FODT i RTF, nagłówki, stopki i przypisy (A13) oraz strona po v0.48 (L03)**
    v0.48.0 · L
    Formaty wskazane w KRI. Źródło: plan fal.

23. **Zapis .docx z układem oryginału, z białą listą części (A15)**
    v0.49+ · L (plan szacuje więcej)
    Dziś wiersz wyniku to akapit, a kolumny tabel zostają tabulatorami (CHANGELOG.md, v0.46.25,
    „.docx bez układu oryginału”). Źródło: plan fal.

24. **Nazwa komputera, ścieżki UNC i uchwyty komunikatorów**
    v0.48+ / rdzeń 0.30+ · L
    `AKOWALSKI-PC` przechodzi jawne (sprawdzone dziś), a nazwa zawiera nazwisko. Na liście są też
    `\\PRINT01\AdamK`, uchwyty Teams i Slack oraz `CN=` z loginem zamiast imienia i nazwiska
    (`CN=akowalski`, sprawdzone dziś). `CN=Adam Kowalski` i ścieżka `C:\Users\Imię Nazwisko\…`
    są już zasłaniane. Każdy nowy typ wymaga kotwicy i audytu, jak przy karcie płatniczej
    (CHANGELOG.md, v0.46.12). Źródło: docs/SCENARIUSZ-TESTOW-v0.45.md, sekcja 4.

25. **Osobne `[IMIĘ]` i `[NAZWISKO]` dla kluczy `firstName` i `lastName` w XML i JSON**
    v0.48+ · M
    Kosmetyka zgłoszona przez testera. Wymaga nowych znaczników, czyli zmiany listy tokenów
    w rdzeniu, aplikacji, stronie i README. Źródło: docs/SCENARIUSZ-TESTOW-v0.45.md, sekcja 4.

### Propozycje

26. **Kontrakt rdzenia przed 1.0**
    v0.48+ / rdzeń 1.0.0 · M
    Lista znaczników, opcje `redactPII` i format `found` są dziś de facto API dla mostu `--jsonl`
    i bibliotek. Proponuję spisać je jako kontrakt i przyjąć regułę: zmiana snapshotu golden to
    co najmniej wersja minor z opisem w CHANGELOG, zmiana tokenu to wersja major.

27. **Vitest 5**
    v0.48+ · M
    `npm outdated`: Vitest 4.1.10, najnowszy 5.0.5. Osobno od pozycji 5, bo to zmiana główna
    w narzędziu, na którym stoją golden-master i 1000+ testów. Źródło: `npm outdated`.

## Kryteria 1.0.0

Parawan jest publicznie wydawany od miesięcy, ma stronę, sumy SHA-256, atestację i odbiorców
w urzędach, więc numer 0.x nie oddaje już tego, jak plik jest używany. Z drugiej strony wydanie
v0.46.24 świadomie wyszło z listą znanych regresji, w tym dwiema klasami wysokimi. Uczciwie:
1.0.0 dla `Parawan.html` ma sens, gdy:

- nie ma znanych regresji wysokich (pozycje 1 i 2), a lista pozostałych jest w CHANGELOG
  i w DLA-IOD-I-IT.txt;
- audyt v0.45 jest domknięty (pozycja 14), a korpus ataków i bilans względem poprzedniego tagu
  żyją w repo i są częścią wydania (pozycje 9 i 18);
- lista znaczników i obsługiwanych przeglądarek jest zapisana jako obietnica, której nie zmienia
  się bez wersji głównej (pozycja 26);
- wzór adnotacji przeszedł opinię prawnika (pozycja 8);
- CI nie stoi na wersjach bez wsparcia, a zaległe PR zależności są zamknięte (pozycje 5 i 6).

Rdzeń ma własną numerację (0.29.x) i może dojść do 1.0 osobno, dopiero gdy zapadnie decyzja
o publikacji w npm (pozycja 4).

## Świadomie poza roadmapą

- **Nazwiska bez kotwicy i obce nazwiska** (`list od Achtelika`, `Weber`, `Rossi`): 15 z 16
  porażek benchmarku rdzenia (docs/BENCHMARK.md:66–84). To zadanie warstwy NER w anonimizator-ai.
- **PESEL albo NIP po samym „nr”** i **przymiotniki gminne po roli** (`Wójt Klembowski`):
  dawałyby nadmaskowanie albo wyciek nazwisk. Bez nowego pomysłu nie ruszać.
- **Numer działki jako typ**, OCR skanów, wersja online, telemetria i automatyczna aktualizacja,
  PWA lub rozszerzenie: odrzucone w planie fal, bo łamią precyzję, deterministykę albo zasadę
  „bez instalacji i bez sieci”.
- **Analityka odwiedzin strony** (`scripts/analytics/cf-stats.mjs`): odłożona przez właściciela,
  wraca tylko na jego prośbę.
- **Włączanie wyłączonych reguł Biome**: wyłączone celowo (`biome.json`).
