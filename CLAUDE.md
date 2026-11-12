# CLAUDE.md — przewodnik po repozytorium anonimizator

Marka produktu: **Parawan** („Dane za parawanem"). Repo/pakiet npm/CLI dalej nazywają się
`anonimizator` (identyfikator techniczny — patrz pamięć `marka-parawan-i-fonty-lokalne`).
Lokalny anonimizator polskich danych osobowych (PII). **Wszystko działa lokalnie**, tekst nigdy nie
opuszcza komputera. Zasada nadrzędna: **precyzja > nadmaskowanie** (nadmaskowanie gorsze niż drobny
wyciek) — patrz pamięć `anonimizacja-precyzja-nad-nadmaskowaniem`.

## JEDEN produkt: samowystarczalny HTML (patrz pamięć `dwie-edycje-html-i-ai`)

To repo produkuje **jeden plik `Parawan.html`** — `file://`, zero instalacji, WYŁĄCZNIE
deterministyka (reguły + słowniki + sumy kontrolne). To jest fosa: przechodzi przez blokady
firmowe/urzędowe (dokument, nie program). Fonty marki są wbudowane lokalnie (woff2 → `data:`),
NIGDY zewnętrzny `<link>`. Warstwa AI (NER/LLM) mieszka w OSOBNYM repo-dodatku
**[anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai)** — nie dokładać jej tutaj.

## Struktura (monorepo, npm workspaces)

- `packages/core/` — pakiet npm `anonimizator`. **Jedyne źródło prawdy logiki**, ZERO zależności,
  działa w Node/Deno/Bun/przeglądarce. Moduły `src/`:
  - `redact.ts`: orkiestrator `redactPII()`, kolejność przebiegów i podstawianie własnych masek;
  - `passes/*.ts`: przebiegi według rodzaju danych (numeric, email, network, forms, address, city,
    person-*, finalize…);
  - `guards/*.ts`: strażniki kontekstu wspólne dla kilku przebiegów;
  - `dict/*.ts` i `surnames.ts`: słowniki (imiona, miejscowości, pola formularzy, konta, nagłówki
    kolumn) oraz nazwiska z morfologią;
  - `validators.ts`: sumy kontrolne; `charset.ts`, `person-patterns.ts`, `util.ts`: wspólne wzorce
    i narzędzia tekstowe; `struct-keys.ts`: klucze XML/JSON; `context.ts`: stan redakcji
    (`RedactCtx`) i sentinele PUA; `types.ts`: `PiiType`, `MASK`, `HUMAN_LABEL`, opcje;
  - `http.ts`, `breaker.ts`: wspólne wywołania HTTP i wyłącznik awaryjny klientów NER/LLM;
  - `index.ts`: tylko reeksporty publicznego API. Zbiór eksportów i graf importów (tylko w dół,
    bez cykli) pilnuje `struktura.test.ts`, a wynik `redactPII` zamraża `redact-golden.test.ts`.

  `src/ner-postprocess.ts` / `src/ner-client.ts` / `src/llm-client.ts` = eksporty
  npm (`anonimizator/ner-postprocess`, `/ner`, `/llm`) — SZEW, w który wpina się dodatek AI;
  zostają tu jako część biblioteki, single-HTML ich NIE importuje.
- `packages/parawan/` — pakiet npm `parawan`: nazwa marki dla `anonimizator`, BEZ własnego kodu
  (`export * from 'anonimizator'`, bin `parawan` uruchamia CLI rdzenia). Wersja i zależność
  zawsze = wersja rdzenia; pilnuje tego `packages/core/src/paczki-npm.test.ts`.
- `apps/web/` — pakiet `anonimizator-web`. UI budowane Vite `vite-plugin-singlefile` do JEDNEGO
  samowystarczalnego `index.html`. Bez warstwy AI (wycięta w v0.45.2 — patrz CHANGELOG).
- `scripts/benchmark/` — deterministyczny benchmark precision/recall/F1 (`dataset.mjs` + `run.mjs`).
  Warstwy NER w run.mjs degradują się łagodnie (health-check → skip), gdy brak usług/modelu.

## Komendy

```bash
npm ci
npm run build -w anonimizator                     # rdzeń → dist (tsc)
npm run test  -w anonimizator                     # testy rdzenia (vitest)
npx tsc -p apps/web/tsconfig.json                 # typecheck web (jak CI)
npm run test  -w anonimizator-web                 # testy web
npm run build -w anonimizator-web                 # single-HTML → apps/web/dist/index.html
node scripts/benchmark/run.mjs --check            # BRAMKA regresji rdzenia (używana w CI)
```

CI (`.github/workflows/ci.yml`): build+test core → tsc web → test web → build web → bramka benchmarku.
Release (`.github/workflows/release.yml`, tag `v*`): jeden artefakt — `Parawan.html` + `JAK-UZYC.txt`.

## Konwencje detekcji

- **Sumy kontrolne** (PESEL/NIP/REGON/IBAN/dowód) tną fałszywe trafienia. Ale przy **silnej etykiecie**
  („PESEL:", „NIP", „REGON", „konto/rachunek/IBAN") maskujemy MIMO złej sumy (numer bywa z literówką).
- **Kotwice kontekstowe** dla typów bez sumy (paszport, KRS, prawo jazdy, nr rejestracyjny, VIN, data ur.).
- **Kolejność przebiegów ma znaczenie** (zapisana w `redact.ts`): ochrona URL-i (sentinel + maskowanie parametrów wewnątrz)
  → e-mail → identyfikatory techniczne (token/MAC/IP/VIN) → pola formularza/XML/JSON/login →
  najdłuższe ciągi cyfr (IBAN 26 → PESEL 11 → NIP 10 → REGON) → krótsze (telefon 9, kod 5). MAC PRZED IPv6.
  W telefonie tryb KOTWICOWY przed prefiksowym „+48" (placeholder nie może przerwać łańcucha wyliczenia).
- **Idempotencja**: placeholdery nie zawierają cyfr ani „@", więc ponowny przebieg ich nie pożre.
- Nowy typ PII = dodać do `PiiType`, `MASK`, `HUMAN_LABEL` (types.ts), przebieg w `passes/<rodzaj>.ts`
  i jego wywołanie w `redact.ts` we właściwym miejscu kolejności (lista masek warstwy LLM bierze się
  z `MASK` sama; nowy publiczny eksport wymaga zmiany listy w `struktura.test.ts`), w aplikacji do `PII_TOKENS`,
  `MASK_GROUP_DEFS`, `CHIP_LABELS` i `WYKRYWA_ROWS` (apps/web/src/pii-meta.ts), na landingu do
  `TYPE_MASK` (apps/landing/src/tokens.ts) i na stronę (apps/landing/index.html: chip i liczba
  w tabeli `.kategorie` sekcji `#typy`, nazwa typu w zdaniu właściwego bloku `.metoda`, nagłówek
  sekcji, meta description i opis w JSON-LD), do tabeli w README, oraz testy (index.test.ts)
  i przypadki benchmarku (dataset.mjs). Rozjazdy łapią pii-meta.test.ts i landing.test.ts
  (ten drugi przepuszcza też przez `redactPII` przykład z demo i przykłady z treści landingu).

## Weryfikacja zmian w detekcji

Sam benchmark nie wystarcza — sprawdzaj zmiany wieloagentowo/adwersarialnie na realistycznych pismach
(patrz pamięć `weryfikacja-precyzji-audyt-adwersarialny`). UX weryfikuj zrzutami (Playwright).

## Wersjonowanie

- Każda zmiana widoczna dla użytkownika trafia do `## [Unreleased]` w `CHANGELOG.md` w tym samym
  commicie. Format pliku jest własny (`## vX.Y.Z — RRRR-MM-DD`, pogrubione podsumowanie,
  `Pilność:`), nie Keep a Changelog — nie przerabiać starych wpisów.
- Przy wydaniu `[Unreleased]` staje się `## vX.Y.Z — data` (SemVer: PATCH poprawki, MINOR nowe
  funkcje i typy PII, MAJOR zmiana łamiąca). Podbij `version` w `apps/web/package.json`
  i `apps/landing/package.json` (rdzeń `packages/core` ma własną numerację 0.29.x, a `packages/parawan`
  zawsze tę samą co rdzeń; publikacja w npm: najpierw `-w anonimizator`, potem `-w parawan`), dopisz link
  porównawczy na dole CHANGELOG i utwórz tag adnotowany `vX.Y.Z`. Pełna lista: `docs/WYDANIE.md`.
- Granica wersji = commit podbijający `version` w `apps/web/package.json`; tag stoi na ostatnim
  commicie przed następnym podbiciem.
- `ROADMAP.md` (Teraz / Następnie / Później) aktualizuj przy wydaniu. Oba pliki renderuje strona
  `/log` landingu przy buildzie.
- Commity: Conventional Commits (`feat`, `fix`, `refactor`, `docs`, `chore`, `test`).

## Język

Cała komunikacja, komentarze i teksty UI po polsku (z pełną ortografią i diakrytyką).

## Stan (2026-11-12)

- `main` = v0.46.26 + scalona gałąź `refactor/rdzen-czysty` (2026-11-12, CI zielone): podział i sprzątanie rdzenia (dawny `index.ts` rozbity na moduły,
  patrz Struktura). Zachowanie domyślne, z pseudonimami i z filtrem `types` identyczne z `main`
  (golden bez zmian). Świadome zmiany: własne maski podstawiane po wykryciu, poprawki warstwy LLM,
  dopełniacze postaci historycznych (CHANGELOG `[Unreleased]`). Nie wydane (Parawan.html i npm
  bez tych zmian). Handoff: `docs/handoff-2026-11-12.md`.
- W toku: nowy landing (`/frontend`), kierunek „Sosna o poranku”. Próbki poza repo w
  `E:\parawan-landing-proby\`. Handoff: `docs/handoff-2026-11-01.md`.

## Deploy

- Aplikacja: wydanie przez tag `vX.Y.Z` (workflow `release.yml` buduje `Parawan.html` + `JAK-UZYC.txt`
  do GitHub Release); pełna lista kroków w `docs/WYDANIE.md`.
- Landing: `deploy-landing.yml` na GitHub Pages po pushu na `main` w `apps/landing` albo `ROADMAP.md`.
- npm: `npm publish -w anonimizator`, potem `-w parawan` (ręcznie, przy wydaniu rdzenia).
- Brak Pi, Vercela i bazy.

## Backlog

1. Wybór y/u (kolory kategorii jak w aplikacji czy nowa paleta), potem `DESIGN.md` i przeniesienie
   próbki do `apps/landing` na gałęzi `feat/landing-sosna`. Powrót: odpowiedź użytkownika.
2. Przy wyborze „u”: nowa paleta kategorii w `apps/web/src/style.css` (kolory w handoffie).
3. „tarnowski” w słowniku nazwisk i na liście przymiotników: rozróżnienie przez regułę kontekstową
   (nazwa instytucji lub geografii po przymiotniku, np. „Starosta Tarnowski”, „Ziemia Tarnowska”).
   Usunięcie ze słownika dawało wycieki („Sędzia Tarnowski”), cofnięte w 380586a.
4. Wydanie v0.46.27 / rdzeń 0.29.14 (zmiany rdzenia z `refactor/rdzen-czysty`), wg `docs/WYDANIE.md`.
   Powrót: „rób wydanie”.

## Znane problemy

- Klasy znanych regresji z v0.46.24: formularz z TAB-em z rolą jako etykietą, pierwsza osoba
  wyliczenia w celowniku, dwa imiona bez nazwiska, patron wersalikami (ROADMAP poz. 1, 2 i 13).
- REGON z długim wtrąceniem po etykiecie dostaje znacznik `[TELEFON]` (ROADMAP poz. 7).
- Login w ścieżce URL typu `/user/akowalski` przechodzi jawny (ROADMAP poz. 15).
- „tarnowski” bywa nazwiskiem i przymiotnikiem (Backlog 3).
