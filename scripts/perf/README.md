# Czas startu Parawan.html

`start.mjs` mierzy, jak szybko gotowy plik startuje po otwarciu z dysku (`file://`) w Chromium
z Playwright. Rozmiar pliku tylko w niewielkim stopniu wyznacza ten czas: większość idzie na kod,
który się wykonuje przy starcie (rozgrzewka rdzenia, wzorce, pierwszy układ strony), a nie na
bajty. Dlatego wygodę urzędnika pilnuje pomiar czasu, a nie limit bajtów. Twardy sufit rozmiaru
z limitu poczty i strażnik składu pliku są w `scripts/e2e` (opis w `docs/WYDANIE.md`,
„Rozmiar i czas startu”).

## Pomiar lokalny (bez kotwicy i bez sieci)

```bash
npm run build -w anonimizator-web
node scripts/perf/start.mjs apps/web/dist/index.html --rate 4 --runs 5
node scripts/perf/start.mjs apps/web/dist/index.html --rate 1 --runs 5 --json
```

Każdy przebieg to świeży kontekst przeglądarki; pierwszy przebieg po uruchomieniu przeglądarki
jest odrzucany (zimny proces bywał dwa razy wolniejszy). Wynik to mediana, rozrzut i współczynnik
zmienności (CV) trzech chwil liczonych od początku nawigacji:

- **widać interfejs**: koniec skryptu startu (znacznik `parawan:ui` w `apps/web/src/main.ts`),
- **LCP**: największy element treści na ekranie (wpis `largest-contentful-paint`),
- **gotowe**: silnik rozgrzany, pierwsze wklejenie liczy się tak szybko jak następne (znacznik
  `parawan:gotowe` na końcu `warmEngine()`).

Znaczniki `performance.mark` zostają w pamięci karty, niczego nie wysyłają i niczego nie zmieniają
w działaniu. Pliki sprzed nich (np. v0.47.0) mierzymy „obserwatorem”: chwila zniknięcia paska
`#boot-fail` i pierwsze zadanie po rozgrzewce z `setTimeout`. Obie metody dają na tym samym pliku
wyniki różniące się o kilkanaście ms; porównanie dwóch plików zawsze używa tej samej metody.

Wynik na komputerze odniesienia (i7-13700KF, 2026-11-15, gałąź `feat/seria-2-pism`, 2 599 938 B):
×1 widać interfejs 328 ms, LCP 360 ms, gotowe 522 ms; ×4 widać interfejs 1 817 ms, LCP 1 920 ms,
gotowe 2 964 ms.

## Model słabego komputera: CPU ×4

Dławienie CPU przez CDP (`Emulation.setCPUThrottlingRate`) ustawiane przed nawigacją. ×4 to
mnożnik, którym Lighthouse w profilu mobilnym zamienia typowy komputer w urządzenie „średniej
klasy” (https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md).

Słabość modelu: to nie jest pomiar komputera urzędowego. Utożsamienie ×4 ze starszym laptopem
biurowym nie ma źródła. Dławiony jest tylko wątek strony: odczyt z dysku albo udziału sieciowego,
wolna pamięć i stary dysk nie wchodzą do pomiaru. Powyżej ×4 dławienie bywa nieliniowe (przy ×6
rozgrzewka była 15× wolniejsza niż przy ×1, przy ×4 5,5×). Jednorazowy pomiar `--rate 1` na
prawdziwym starym laptopie pozwoliłby poprawić mnożnik.

## Progi

| próg | wartość | skąd |
|---|---|---|
| LCP przy ×4 | ≤ 2 500 ms | próg „dobry” Core Web Vitals, https://web.dev/articles/lcp (Google liczy go na 75. percentylu w terenie, tu pożyczony do laboratorium) |
| gotowe przy ×4 | ≤ 5 000 ms | RAIL, „Load” w mniej niż 5 s na urządzeniu średniej klasy, https://web.dev/articles/rail; 10 s to granica uwagi (https://www.nngroup.com/articles/response-times-3-important-limits/), 5 s, bo urzędnik otwiera plik w trakcie pracy (założenie) |
| wobec kotwicy | błąd przy > 1,20× **i** > +300 ms naraz | założenie: zmiana poniżej ok. 20% leży w granicy szumu; drugi warunek chroni małe liczby przed szumem |

Stałe stoją w `start.mjs` (`LCP_BUDGET_MS`, `READY_BUDGET_MS`, `CPU_RATE`, `MAX_RATIO`,
`MIN_DELTA_MS`) z tymi samymi źródłami w komentarzach.

## Bramka w CI (job `start`, `npm run perf`)

`start.test.mjs` uruchamia bramkę, gdy `PARAWAN_KOTWICA` wskazuje Parawan.html z wydania
z `kalibracja.json`. Job `start` w `ci.yml` pobiera je przez `gh release download` (przypięty tag,
nie „latest”), a bramka sprawdza jego SHA-256 z `kalibracja.json`. Bez zmiennej pomiar jest
pomijany z powodem; testy samej logiki biegną zawsze. `npm run e2e` nie potrzebuje ani kotwicy,
ani sieci.

Procedura:

1. **Kalibracja szybkości maszyny** (w stylu „benchmark index” z Lighthouse): przebieg
   rozgrzewkowy i trzy przebiegi kotwicy bez dławienia. Mnożnik dla tej maszyny:
   `rate = clamp(4 × gotowe_x1_ms / mediana_tutaj_x1, 1, 4)`, gdzie `gotowe_x1_ms` to kotwica na
   komputerze odniesienia. Runner dwa razy wolniejszy dostaje więc ×2, a nie ×4, i nie wypada
   w nieliniowy zakres dławienia.
2. **Przeplot**: 7 par kotwica, plik, kotwica, plik… przy tym mnożniku. Przeplot znosi dryf
   szybkości runnera w trakcie joba. Liczy się mediana.
3. **Przeliczenie na komputer odniesienia**: `B_ref = B_tutaj × (A_ref / A_tutaj)` dla każdej
   chwili, gdzie `A_ref` to kotwica z `kalibracja.json` (`ui_x4_ms`, `lcp_x4_ms`, `gotowe_x4_ms`).
   Progi bezwzględne porównujemy z `B_ref`. Mnożnik i ta proporcja zabezpieczają się nawzajem.
4. **Próg względny** tylko dla chwil z `kalibracja.json` → `porownanie`. Kotwica v0.47.0 nie
   rozgrzewała silnika przy starcie (to przyszło w fc3668a), więc jej „gotowe” to inna praca
   niż w nowszym pliku: dziś porównujemy tylko „widać interfejs” i LCP. Pomiar z 2026-11-15:
   „gotowe” tej gałęzi jest 1,53× dłuższe niż w v0.47.0, bo rozgrzewka przeszła z pierwszego
   wklejenia na start. To zamierzone, a nie regresja.
5. **Powtórzenie**: gdy bramka nie przejdzie, cały pomiar (1–4) powtarza się raz, a błąd
   jest dopiero po dwóch nieudanych pomiarach z rzędu. Asercja się nie zmienia.

Wynik trafia do `$GITHUB_STEP_SUMMARY`: tabela z kotwicą i plikiem na runnerze (mediana, rozrzut,
CV), stosunkiem, przeliczeniem na komputer odniesienia i progiem. Ten sam pomiar lokalnie:
`node scripts/perf/start.mjs apps/web/dist/index.html --kotwica <Parawan.html z wydania>` albo
`PARAWAN_KOTWICA=<plik> npm run perf`. Na komputerze odniesienia trwa ok. 40 s.

## Zmienność (CV) i kiedy bramka staje się blokująca

Job `start` ma `continue-on-error: true`: zmienności pomiaru na runnerach GitHuba jeszcze nie
zmierzono, więc próg względny 1,20 nie ma oparcia w danych. Lokalnie CV przy ×4 wynosi 1–3%
(pojedynczo do 8%). Po ok. 10 przebiegach PR odczytaj z podsumowań CV mediany stosunku
plik/kotwica:

- CV ≤ 5%: usuń `continue-on-error` z joba `start` w `ci.yml` (commit `ci`),
- CV > 5%: ustaw `MAX_RATIO = 1 + 4×CV` (np. CV 8% daje 1,32) albo usuń próg względny; progi
  bezwzględne zostają.

Wszystkie trzy liczby to założenia, nie pomiar:

- 10 przebiegów: z 10 próbek odchylenie standardowe szacuje się z błędem względnym ok.
  1/√(2·9) ≈ 24%, co wystarcza, żeby odróżnić CV 2% od 8%;
- margines progu to co najmniej 4 odchylenia standardowe (reguła trzech sigm plus jedna na dryf
  runnera między przebiegami); 20% to 4σ przy CV 5%, stąd granica 5%;
- `1 + 4×CV` zachowuje ten sam margines 4σ przy większym CV i przy CV 5% daje dokładnie 1,20.

Przy każdym wydaniu kotwica przechodzi na nowe wydanie: krok kalibracji w `docs/WYDANIE.md`.

## Pliki

- `start.mjs`: pomiar, kalibracja, ocena i podsumowanie (CLI i moduł).
- `start.test.mjs`: testy logiki i bramka (`npm run perf`).
- `kalibracja.json`: kotwica (tag, SHA-256) i jej pomiar na komputerze odniesienia z datą,
  komendą i metodą.
