# Status 2026-11-22 (przegląd po przerwie)

**Stan w jednym zdaniu:** wszystko działa (strona, plik do pobrania, CI zielone), od 15.11 nic się nie
działo poza automatyczną aktualizacją zależności; npm wciąż na starej wersji 0.29.13.

## Co się działo

Ostatnia praca 15.11: scalony PR #29 (serie 2 i 3 pism), wydanie v0.48.0 (tag, Release, kopia na
domenie), kotwica czasu startu przestawiona na v0.48.0. Wydanie poszło przed Backlog 9 (czas startu),
na słowo autora. Od tamtej pory brak commitów. Rozgrzebane: gałąź `fix/tarnowski-przymiotnik`
(3 commity z 14.11, nie w `main`, bez PR) i PR #30 od Dependabota (20.11, CI zielone).

## Produkcja

| cel | stan | co konkretnie | od kiedy |
|---|---|---|---|
| Landing parawan.karolwilczynski.com | działa | `/` 200 (0,43 s), `/log/` 200, pokazuje v0.48.0 | 15.11 |
| Kopia pliku na domenie `/pobierz/Parawan.html` | działa | suma SHA-256 zgodna z Release v0.48.0 | 15.11 |
| GitHub Release v0.48.0 | działa | Parawan.html 2 599 938 B, 8 pobrań; JAK-UZYC, DLA-IOD-I-IT, SHA256SUMS | 15.11 |
| CI / Zgodność przeglądarek / Deploy landing | działa | ostatnie 10 przebiegów zielone | — |
| npm `anonimizator` i `parawan` | uwaga | w npm 0.29.13; czekają 0.30.0 i 0.31.0 (Backlog 4) | 12.11 |

## Zużycie

- Claude, 7 dni: 112 tys. tokenów wyjścia (prawie wszystko 15.11, Opus 5.5); dziś ok. 2 tys.
- Darmowe plany: GitHub Pages i Actions, brak Vercela, bazy i Pi. Nic blisko limitu.
- Płatne API w aplikacji: brak (wszystko lokalne).

## Kontrola kodu

- Rdzeń: 974 testy zielone (1 pominięty, jak dotąd). Typecheck web OK. Web: 335 zielonych.
  Build single-HTML OK. Bramka benchmarku: brak regresji (F1 99,3%). Lint: 0 błędów, 15 ostrzeżeń.
- Brak nowych zmian od ostatniego przeglądu, więc brak nowych uwag w kodzie. TODO/FIXME: 0.
- Alerty Dependabot dla bezpieczeństwa są wyłączone w repo (API 403), aktualizacje wersji działają.

## Do naprawy i zrobienia

Awarie: brak.

Ryzyka:
- #4 Publikacja npm · użytkownicy npm dostają wersję sprzed dwóch wydań · `npm publish` ×2 z 2FA · średnia · wraca gdy `npm view anonimizator version` = 0.31.0
- #9 Czas startu na słabym PC · „gotowe” 1,8× wolniej niż v0.47.0, teraz już w wydanym pliku · `regex-literals.ts`, `main.ts` · wysoka · wraca gdy job `start` zielony wobec kotwicy

Rozgrzebane:
- #3 „tarnowski”: praca leży na gałęzi `fix/tarnowski-przymiotnik` (reguła przypadku i zapisu, 14.11) · ocenić, dograć do `main` albo porzucić · średnia · wraca gdy gałąź scalona lub usunięta
- #13 PR #30 Dependabota (biome 2.6.8, axe-core, playwright, vite) · świeże narzędzia, CI zielone · scalić po sprawdzeniu lint (nowe reguły biome) i zgodności przeglądarek · niska · wraca gdy PR zamknięty
- #14 Sprzątanie gałęzi · `docs/stan-po-serii-3` scalona, 3 gałęzie Dependabota po zamkniętych PR · usunąć zdalne gałęzie · niska

Reszta: Backlog 1, 2, 5–8, 10–12 bez zmian (CLAUDE.md).

## Wymaga Ciebie

1. **Twój PC, terminal w `C:\Users\karol\anonimizator`:** `npm login`, potem
   `npm publish -w anonimizator` i `npm publish -w parawan` (kod 2FA z aplikacji).
   Sprawdzenie: `npm view anonimizator version` pokazuje 0.31.0.
2. Decyzja Backlog 12 (nowy typ danych szczególnych) i Backlog 1 (y/u dla landingu).
3. Opcjonalnie: GitHub → repo → Settings → Advanced Security → „Dependabot alerts” → Enable
   (ostrzeżenia o lukach w zależnościach).

## Rekomendacja

Start od Backlog 9 (czas startu), bo spowolnienie już trafiło do wydanego pliku, a reszta
(tarnowski, PR #30) nie blokuje niczego.

## Backlog 9: wynik sesji 2026-11-22 (gałąź `perf/czas-startu`, niewypchnięta)

Pomiar `scripts/perf/start.mjs`, przeplot z Parawan.html v0.48.0, mediany z 2×7 przebiegów:

| | v0.48.0 | gałąź |
|---|---|---|
| ×1 widać interfejs / gotowe | 296 / 469 ms | 272 / 377 ms |
| ×4 widać interfejs / gotowe (czysta seria) | 1549 / 2516 ms | 1428 / 2032 ms |
| ×4 widać interfejs / gotowe (maszyna obciążona) | 1766 / 2869 ms | 1733 / 2446 ms |

Zgodność: skrót redactPII na 1 436 tekstach (dwa profile) 47e8d237… przed i po; run-eval na
5 zestawach × 2 profile: 0 różnic plików; golden, benchmark --check, e2e (176 zielonych) bez zmian.
Plik 2 627 371 B (+27 kB). Przegląd adwersaryjny: 1 uwaga (kolejność alfabetu w generatorze),
poprawiona.

Następne kroki z rozpoznania (pomiary w scratchpadzie sesji, nie w repo):
- `content-visibility: auto` na kartach pod pierwszym ekranem: LCP ×4 −56 ms, gotowe −118 ms
  (jedna seria); wymaga sprawdzenia mobile, wydruku, kotwic, Firefoxa ESR.
- Wyrażenia z poziomu modułu tworzone leniwie: sam rdzeń ×4 −110…−200 ms; niezmierzone w pełnym
  pliku i na Node 20.
- pdf.js jako `<script type="text/plain">` wstrzykiwany przy pierwszym PDF: górna granica ui ×4
  −494 ms, ale wymaga zmiany CSP (dwa skróty) i strażników CI.
- Odrzucone pomiarem: offsetHeight/syncGripAria (to pierwszy układ strony, nie wymuszony koszt),
  toLocaleString, szablony ikon, font-display.
