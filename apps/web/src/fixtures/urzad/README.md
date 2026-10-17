# Fikcyjne pisma urzędowe do testów

Realistyczne pisma, na których sprawdzamy Parawana tak, jak użyje go urzędnik: decyzja wójta,
odpowiedź na wniosek o informację publiczną, protokół kontroli, krótkie pismo w czterech formatach
i dziesięć krótkich próbek z badania praktyki anonimizacji (`probki/`). Korzystają z nich testy E2E
(`scripts/e2e/`), ręczne skrypty (`scripts/e2e/manual/`) i kolejne pakiety planu dla urzędów.

## Wszystkie dane są zmyślone

Pliki leżą w publicznym repozytorium, dlatego każda dana została sprawdzona 17.10.2026:

- Osoby, gminy Brzozowa Wola i Rzeczyca Wielka oraz ich urzędy są wymyślone.
- PESEL, NIP, REGON, numery rachunków i dowodu osobistego mają poprawne sumy kontrolne,
  bo silnik je sprawdza. NIP-y i rachunki nie figurują na białej liście podatników VAT.
- Numery ksiąg wieczystych mają celowo błędną cyfrę kontrolną, więc nie wskazują żadnej
  prawdziwej księgi. Silnik i tak powinien je zasłonić, bo stoją przy słowach „KW” albo
  „księga wieczysta”.
- Numery KRS leżą poza zakresem nadanych dotąd numerów (0009…).
- Domeny urzędów i stowarzyszenia (brzozowawola.pl, rzeczycawielka.pl, zielonabrzozowawola.pl)
  nie były zarejestrowane. Prywatne adresy e-mail osób są w domenie example.com.
- Telefonów i numerów rejestracyjnych nie da się sprawdzić w publicznym rejestrze. Są wymyślone
  i nie należy ich używać poza testami.
- Prawdziwe są tylko tło i przykłady powszechnie publikowane: nazwy miast i wsi (Radom, Ostrów
  Mazowiecka, Wola Kiełpińska, Zawady), sądy i kolegia odwoławcze jako instytucje oraz przykład
  z aplikacji w plikach `pismo.*` (PESEL 44051401359 i rachunek PL61 1090 1014 0000 0712 1981 2874
  to numery przykładowe z dokumentacji).

Względem wersji z badania z 17.10.2026 zmieniono to, czego nie dało się uznać za zmyślone:
protokół kontroli przeniesiono z istniejącej gminy Zawady (z działającą domeną) do gminy Brzozowa
Wola, w informacji publicznej zmieniono numer KRS i adres e-mail adresatki, a próbki osadzono
w fikcyjnych miejscowościach z nowymi nazwiskami, bo pierwowzory nawiązywały do prawdziwych urzędów
(adres i telefon urzędu wojewódzkiego, NIP urzędu centralnego w rejestrze umów, domena istniejącego
miasta).

Nowe pismo dokładaj tylko ze zmyślonymi danymi sprawdzonymi tak samo.

## Pliki

| Plik | Co zawiera |
|---|---|
| `decyzja.txt`, `.docx`, `.pdf` | Decyzja Wójta Gminy Brzozowa Wola o usunięciu drzew: strona, pełnomocniczka z datą urodzenia, rzeczoznawca, podpis wójta, pracownica prowadząca sprawę, dane urzędu w nagłówku, rachunek, księga wieczysta, działka. DOCX z nagłówkiem urzędu w tabeli, PDF wydrukowany z Chromium jak „Zapisz jako PDF” z Worda (wyjustowany akapit, podpis z prawej). |
| `informacja-publiczna.txt` | Odpowiedź burmistrza na wniosek o informację publiczną: adresatka, wykonawca (spółka i osoba prowadząca działalność), pracownicy z funkcjami, wynagrodzenie, podpis „z up.”. |
| `protokol-kontroli.txt`, `.docx` | Protokół kontroli gospodarki odpadami: kontrolujący, tabela obecnych (w .txt kolumny rozdzielone tabulatorem, w .docx prawdziwa tabela), PESEL, dowód, VIN, numer rejestracyjny, sąsiad z telefonem. |
| `pismo.docx`, `.odt`, `.rtf`, `.pdf` | Ta sama krótka decyzja (przykład z aplikacji) w czterech formatach: minimalny DOCX i ODT, RTF w stronie kodowej 1250, PDF z Chromium. Wszystkie formaty mają dać te same znaczniki. |
| `probki/*.txt` | Dziesięć krótkich pism z badania praktyki: wystąpienie pokontrolne, decyzja o warunkach zabudowy, protokół sesji rady, wyrok, skład sądu, petycja z listą poparcia, cytat z doktryny, oświadczenie majątkowe, księga wieczysta, rejestr umów. Każde pokazuje jedną sytuację z praktyki (funkcja publiczna obok osoby prywatnej, dane urzędu, cytowani autorzy). |

Pliki tekstowe są w UTF-8 bez BOM, z końcami wierszy LF. `.gitattributes` wyłącza dla tego
katalogu konwersję końców wierszy, więc na Windows testy czytają te same bajty co w CI.

## Jak odtworzyć pliki binarne

- `node scripts/e2e/manual/zbuduj-pisma.mjs [katalog]` buduje `pismo.docx`, `.odt`, `.rtf`,
  `pismo.pdf` i `decyzja.pdf` (z `decyzja.txt`).
- `python scripts/e2e/manual/zbuduj-pisma-docx.py [katalog]` buduje `decyzja.docx`
  i `protokol-kontroli.docx` (python-docx, pakiet jak z Worda).

Bez argumentu oba skrypty nadpisują pliki w tym katalogu. Po zmianie treści pisma .txt zbuduj
pliki od nowa, żeby formaty się nie rozjechały.
