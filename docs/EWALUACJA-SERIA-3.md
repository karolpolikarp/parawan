# Ewaluacja na trzeciej serii 100 fikcyjnych pism urzędowych

Data: 2026-11-15. Stan silnika: gałąź `feat/seria-2-pism` po naprawie osób i danych o zdrowiu
(commit `87758cb`).

## Po co trzecia seria

Głównym odbiorcą Parawana są urzędnicy, którzy chcą wklejać pisma i dane ze spraw do narzędzi AI.
Seria 3 (`test-data/seria-3/`) obejmuje 10 obszarów pracy urzędu:

| obszar | przykłady pism |
|---|---|
| podatki | wymiar podatku od nieruchomości, upomnienie, ulga, deklaracja na odpady |
| usc-ewidencja | odpis i sprostowanie aktu, zmiana nazwiska, wymeldowanie z urzędu, dowód osobisty |
| budownictwo | pozwolenie na budowę, warunki zabudowy, podział działki, zawiadomienie stron |
| skargi-wnioski | skarga na pracownika, informacja publiczna, interpelacja, petycja z podpisami |
| kadry | nabór z listą kandydatów, świadectwo pracy, oświadczenie majątkowe, urlop |
| oswiata | lista przyjętych do przedszkola, odroczenie obowiązku szkolnego, dowóz, stypendium |
| swiadczenia | dodatek mieszkaniowy, świadczenie pielęgnacyjne, fundusz alimentacyjny, KDR |
| komunikacja-srodowisko | rejestracja pojazdu, zatrzymanie prawa jazdy, wycinka drzew, interwencja straży |
| zamowienia-umowy | wybór oferty JDG, umowa zlecenie z osobą fizyczną, rejestr umów, dzierżawa |
| praca-z-ai | polecenie dla AI („Napisz odpowiedź na tę skargę”) z wklejoną notatką, metryką, tabelą |

Po 5 pism z obszaru w części roboczej i odłożonej. Pisali je agenci bez dostępu do silnika, każdy
klucz sprawdził drugi agent (dopisał 37 pominiętych danych). Seria 2 zostaje sprawdzianem, do którego
się już nie stroi.

## Wynik bazowy

| zestaw | recall | wycieki | nadmiarowe |
|---|---:|---:|---:|
| seria 3, robocza | **87,3%** | 158 / 1245 | **64 / 358** |
| seria 3, odłożona | **87,7%** | 145 / 1180 | **69 / 340** |

Obie części dają ten sam obraz. Wykrywanie osób i numerów w pismach urzędowych działa dobrze, ale
nadmiarowe maskowanie jest wyraźnie większe niż w seriach 1 i 2 (18–20% elementów do zachowania):
pisma urzędowe są pełne danych urzędu, które Parawan bierze za dane osoby.

Recall według obszaru (robocza): praca-z-ai 75%, oswiata 80%, komunikacja-srodowisko 85%,
budownictwo 91%, zamowienia-umowy 88%, usc-ewidencja 91%, swiadczenia 91%, kadry 91%, podatki 92%,
skargi-wnioski 92%.

## Klasy przyczyn (robocza)

Sześciu analityków przejrzało każdy wyciek i każde nadmaskowanie i znalazło przyczynę w kodzie.

### Nadmaskowanie (precyzja, 64 elementy)

| # | klasa | wystąpienia | pisma | ryzyko FP naprawy |
|---|---|---:|---:|---|
| N1 | Nagłówek z organem albo komórką zamiast nazwy urzędu (WÓJT GMINY X, STAROSTA KŁODZKI, Kierownik USC) | 15 | 8 | niskie |
| N2 | Sygnatura cytowanego orzeczenia po „sygn. akt” traktowana jak znak sprawy strony | 11 | 10 | niskie |
| N3 | Nazwa instytucji w środku wiersza (po dwukropku, numerze punktu, przecinku, w komórce tabeli) | 10 | 8 | średnie |
| N4 | Telefon i e-mail instytucji (centrala, skrzynka funkcyjna) | 9 | 6 | wysokie |
| N5 | Nazwa instytucji w przypadku zależnym jako strona umowy („pomiędzy: Gminą X, ul. …”) | 8 | 4 | średnie |
| N6 | Rachunek albo rejestr instytucji maskowany bez sprawdzenia właściciela | 6 | 6 | niskie |
| N7 | Nazwa własna w nazwie instytucji czytana jako osoba, siedziba w zdaniu | 6 | 6 | średnie |

### Wycieki (158)

| # | klasa | wystąpienia | pisma | ryzyko FP |
|---|---|---:|---:|---|
| W1 | Zdrowie poza słownikiem i budową słowa (schorzenie, zabieg, terapia) | 13 | 12 | średnie |
| W2 | Numer uprawnień zawodowych spoza PWZ (budowlane, izby, geodeta, rzeczoznawca, tłumacz) | 12 | 8 | niskie |
| W3 | Tabela z „\|” bez wiersza `---`, kolumna osób, szyk „Nazwisko Imię” | 15 | 4 | niskie |
| W4 | Inicjały pracownika w dekretacji („→ MK”), kolumnie „Prow.”, legendzie skrótów | 10 | 2 | niskie |
| W5 | Stan funkcjonalny osoby (wózek, leżąca, karmienie przez PEG) | 10 | 8 | niskie |
| W6 | Niepełnosprawność bez stopnia przy krewnym, symbol przyczyny (05-R, NN-X) poza maską | 9 | 8 | niskie |
| W7 | Dane szczególne bez typu w silniku: wyrok, pozbawienie wolności, wyznanie, ubezwłasnowolnienie | 9 | 6 | średnie |
| W8 | Kotwica osoby niewidoczna dla zdrowia (osoba w innym zdaniu, imię w przypadku zależnym) | 8 | 6 | średnie |
| W9 | Dane zagraniczne (ulica -straße, kod, telefon +49, obca tablica) | 8 | 3 | niskie |
| W10 | Nazwa firmy JDG z nazwiskiem właściciela (GEO-ZAWADA, AGRO-BOR) | 7 | 6 | średnie |
| W11 | Kotwica dokumentu i numer rozdzielone wtrąceniem (prawo jazdy kat. B nr …) | 7 | 6 | średnie |
| W12 | Wartość po „imię/nazwisko” w prozie, spłaszczony wiersz formularza | 8 | 5 | niskie |
| W13 | Samo imię lub zdrobnienie osoby znanej z pisma, imię spoza słownika | 9 | 9 | średnie |
| W14 | Ślad leczenia bez choroby, fraza zdrowia rozbita wtrąceniem | 13 | 11 | średnie |
| W15 | Drobne: forma -owa/-owie, „Pani K.”, „s. Jana”, rok po „ur.”, adres bez „ul.” | ≈14 | ≈10 | niskie |

Spór o klucz: 11 elementów (wiek jako data urodzenia, zwykłe zdania jako dane szczególne).

## Kolejność napraw

1. **Precyzja w danych urzędu (N1–N7):** blok nagłówka z organem jednoosobowym i komórką, nazwa
   instytucji w przypadku zależnym i w środku wiersza, sygnatura cytowana po „sygn. akt”, rachunek
   i kontakt instytucji przy jej nazwie. Około 55 z 64 nadmiarowych.
2. **Numery i struktura pism urzędowych (W2, W3, W4, W11, W12):** rejestry zawodowe, tabele bez
   `---`, inicjały w dekretacji, kotwice z wtrąceniem, pola w prozie. Około 50 wycieków.
3. **Zdrowie w sprawach świadczeń i oświaty (W5, W6, W8, W14, W1):** stan funkcjonalny,
   niepełnosprawność, ślad leczenia.
4. **Dane szczególne (W7):** nowy typ (karalność, wyznanie, ubezwłasnowolnienie, Niebieska Karta;
   ROADMAP poz. 28). Wymaga decyzji o typie i znaczniku.

Każdy krok: pomiar na serii 3 roboczej, sprawdzian na serii 2 (obie części) i serii 3 odłożonej
raz na koniec; pierwszy zestaw, benchmark i nadmaskowanie bez pogorszenia.
