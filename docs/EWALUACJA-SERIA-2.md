# Ewaluacja na drugiej serii 100 fikcyjnych pism

Data: 2026-11-14. Wersja: aplikacja v0.47.0, rdzeń 0.30.0 (commit `d823ece`).

## Po co druga seria

Pierwszy zestaw (`docs/EWALUACJA.md`) to 10 szablonów jednego generatora. Po poprawkach Parawan
zakrywał na nim 99,5% danych, ale to mówi tylko o tych szablonach. Druga seria
(`test-data/seria-2/`) ma 10 rodzajów pism, których w pierwszym zestawie nie było:

| rodzaj | co sprawdza |
|---|---|
| tabele | lista płac, lista obecności, wykazy z kolumnami (tabulator, średnik, Markdown) |
| ocr | tekst po skanie: O/0, l/1, złamane wiersze, pieczątki, stopki stron |
| email | nagłówki Od/Do, cytowany wątek, stopki z telefonem, podpis samym imieniem |
| protokol | rada gminy, wspólnota, komisja: lista obecnych, głosowania imienne, samo nazwisko w odmianie |
| decyzja | decyzje i postanowienia KPA: strona, uzasadnienie z sytuacją rodziny, rozdzielnik |
| sad | protokół rozprawy, wyrok, wezwanie: strony, świadkowie, małoletni, cytowane orzecznictwo |
| spoleczne | wywiad środowiskowy, opinia poradni, kurator: rodzina, zdrobnienia, zdrowie, uzależnienia |
| formularz | ZUS, świadczenia, CEIDG, żłobek: pola, imiona spoza słownika (UA, BY, VN, arabskie) |
| dwujezyczne | umowy i korespondencja PL/EN, CV, obcokrajowcy, telefony +44/+49, daty po angielsku |
| nieformalne | czat, SMS, transkrypcja infolinii, helpdesk: małe litery, zdrobnienia, literówki |

Po 5 pism z każdego rodzaju w części **roboczej** (na niej szuka się przyczyn) i **odłożonej**
(tylko do końcowego sprawdzenia, nie do strojenia). Klucz w formacie `eval.py`, sumy kontrolne
z `generuj.py`. Pisma pisali agenci bez dostępu do silnika (nie uruchamiali Parawana, nie czytali
kodu), a każdy klucz sprawdził drugi agent pod kątem pominiętych danych. Pomiar:
`node scripts/eval/run-eval.mjs --eval --set test-data/seria-2/robocza` (bez sieci).

## Wynik

| zestaw | recall | wycieki | nadmiarowe maskowanie |
|---|---:|---:|---:|
| pierwszy zestaw (dla porównania) | 99,5% | 5 / 974 | 0 / 117 |
| seria 2, robocza | **72,7%** | 368 / 1347 | 37 / 359 |
| seria 2, odłożona | **69,8%** | 413 / 1368 | 57 / 320 |

Obie części serii 2 dają podobny wynik, więc spadek to obraz silnika na nowych rodzajach pism,
a nie cecha jednego zestawu. Wyniki z pseudonimami są takie same (poza znacznikami osób).

### Recall per typ (robocza, tylko typy z wyciekiem)

| typ | zakryte / wystąpienia |
|---|---:|
| HEALTH | 22 / 148 |
| PERSON_FIRSTNAME | 48 / 153 |
| PERSON | 457 / 516 |
| PHONE | 74 / 91 |
| SENSITIVE | 0 / 13 |
| PERSON_INITIALS | 0 / 10 |
| DATE_BIRTH | 32 / 39 |
| POSTAL | 45 / 51 |
| PLATE | 3 / 8 |
| PROF_ID | 14 / 18 |
| pozostałe (ADDRESS, PESEL, ID_CARD, PASSPORT, IBAN, EMAIL, …) | 1–3 wycieki na typ |

### Recall per rodzaj pisma (robocza)

nieformalne 42%, spoleczne 55%, dwujezyczne 66%, ocr 73%, protokol 77%, formularz 82%, tabele
85%, sad 85%, decyzja 85%, email 86%.

Nadmiarowo usunięte (robocza): adres siedziby instytucji 17/34, jej kod pocztowy 9/22, numer
dokumentu 2/40, instytucja 3/126, kontakt instytucji 4.

## Klasy przyczyn (robocza)

Pięciu analityków przejrzało każdy wyciek i każde nadmaskowanie części roboczej, znalazło przebieg
albo strażnik w kodzie i pogrupowało błędy według mechanizmu. Ranking według zasięgu (wystąpienia
i pisma) przy ryzyku fałszywych trafień i rozmiarze pracy:

| # | klasa | wystąpienia | pisma | ryzyko FP | rozmiar |
|---|---|---:|---:|---|---|
| 1 | **Osoba potwierdzona w piśmie nie jest zakrywana w innych miejscach**: samo imię, zdrobnienie, odmiana, samo nazwisko, inicjały, login, kolumna tabeli. Silnik pamięta zakryte nazwiska (`ctx.maskedSurnames`), ale używa tego tylko jako strażnika. | 67 | ≤29 | niskie–średnie | M–L |
| 2 | **Zwrot do osoby i podpis**: „Panie Marku”, „p. Nowak”, Mr/Mrs/Frau, wołacz na początku wiersza, „Pozdrawiam, Ania”. Brak wołacza i obcych tytułów w wyzwalaczach. | 22 | ≤16 | niskie | S |
| 3 | **Zdrowie jako zdarzenie przy osobie**: zwolnienie lekarskie, zasiłek chorobowy, orzeczenie o niepełnosprawności, leczenie, „po operacji”, tydzień ciąży. Kotwice są, ale same nie maskują. | 37 | ≤29 | średnie | M |
| 4 | **Zdrowie: rozpoznanie spoza zamkniętej listy chorób**, kod ICD w zdaniu, uraz. | 40 | ≤33 | średnie | L |
| 5 | **Pokrewieństwo jako kotwica osoby** („jej syn Kuba”, „córce Oli”). Działa dziś tylko po masce. | 16 | ≤12 | niskie | M |
| 6 | **Tekst po OCR i miękkie łamanie wiersza**: O/0 i l/1 w numerach, numer albo nazwisko złamane końcem wiersza. Potrzebny „cień” tekstu o tej samej długości. | ≈20 | 10 | niskie | M |
| 7 | **Blok nagłówka instytucji w nowych układach** (organ, filia, zakład, etykieta z dwukropkiem, kontakt instytucji, ten sam adres raz jawny, raz zakryty): nadmaskowanie. | 29 | ≤16 | niskie–średnie | M |
| 8 | Telefon z zagranicznym kodem (+44, +49, 00…) | 10 | 7 | niskie | S |
| 9 | Etykieta mówcy w czacie i transkrypcji (zasila klasę 1) | 30 | 2 | niskie | M |
| 10 | Leki bez dawki, drogi podania, klasy leków | 9 | 6 | niskie | M |
| 11 | Data urodzenia po angielsku, rok dwucyfrowy | 5 | 5 | niskie | S |
| 12 | Imiona spoza słownika (UA, BY) | 6 | 4 | niskie | S |
| 13 | Kotwica dokumentu z wtrąceniem przed numerem, tablica po marce pojazdu, rejestry zawodowe spoza PWZ | 12 | 10 | niskie–średnie | M |
| 14 | Dane podane słownie (dyktowane przez telefon) | 4 | 1 | średnie | L |
| 15 | Sygnatura cytowanego orzeczenia po „sygn. akt” (nadmaskowanie) | 3 | 3 | niskie | S |

Klasy 1, 2, 5, 9 i 12 dotyczą jednego mechanizmu (kto jest osobą w tym piśmie) i razem dają około
140 wystąpień, czyli ok. 38% wycieków części roboczej. Klasy 3, 4 i 10 to dane o zdrowiu: około
85 wystąpień.

### Spór o klucz

Około 17 wycieków (4,6%) to elementy, przy których klucz jest dyskusyjny: obserwacje zachowania
dziecka jako dane o zdrowiu („drażliwy”, „trudności z koncentracją”), sama nazwa narządu, mandat,
dzielnicowy w funkcji służbowej. Do tego 7 wycieków danych szczególnych poza zdrowiem (wyznanie,
Niebieska Karta, odbywanie kary), dla których brak typu (ROADMAP poz. 28). Zasada do przyjęcia: dana
o zdrowiu wymaga rozpoznania, leczenia, świadczenia albo faktu przypisanego osobie; obserwacje
i funkcjonariusze w funkcji to `policy`.

## Po naprawie „osób w piśmie” (klasy 1, 2, 5, 9, 12)

Commity `595fc3d`–`d199ff7`: propagacja osoby rozpoznanej w piśmie (odmiana, samo imię,
zdrobnienie, inicjały, login), zwrot i wołacz, obce tytuły, podpis, pokrewieństwo, mówca w czacie,
imiona cudzoziemców. Każda część przeszła przez weryfikatora precyzji i skuteczności.

| zestaw | recall przed | recall po | wycieki | nadmiarowe |
|---|---:|---:|---:|---:|
| pierwszy zestaw | 99,5% | 99,5% | 5 → 5 | 0 → 0 |
| seria 2, robocza | 72,7% | **83,5%** | 368 → 222 | 37 → 37 |
| seria 2, odłożona | 69,8% | **73,9%** | 413 → 357 | 57 → 57 |

Wycieki danych osobowych (PERSON, PERSON_FIRSTNAME, PERSON_INITIALS):

| zestaw | przed | po | spadek |
|---|---:|---:|---:|
| robocza | 123 | 23 | 81% |
| odłożona | 111 | 59 | 47% |

Na części odłożonej zysk jest mniejszy niż na roboczej. Mechanizmy działają na nowych pismach,
ale część reguł dopasowała się do form z części roboczej, więc wynik roboczy przecenia skuteczność.
Następne kroki trzeba sprawdzać zdaniami spoza obu części. Na części odłożonej największą
grupą wycieków są teraz dane o zdrowiu (156 z 357), potem data urodzenia (20) i dane szczególne (15).

## Po naprawie danych o zdrowiu (klasy 3, 4, 10)

Commity `6c5091c`, `3148d3a`, `ca7f01b`: zdarzenie zdrowotne przy osobie (zwolnienie, orzeczenie,
leczenie, zabieg, ciąża), rozpoznanie po kotwicy i kod ICD, uraz, lek przy czasowniku przyjmowania.

| zestaw | recall przed | recall po | wycieki | HEALTH | nadmiarowe |
|---|---:|---:|---:|---:|---:|
| pierwszy zestaw | 99,5% | 99,5% | 5 → 5 | 0 → 0 | 0 → 0 |
| seria 2, robocza | 83,5% | **90,7%** | 222 → 125 | 125 → 28 | 37 → 37 |
| seria 2, odłożona | 73,9% | **77,3%** | 357 → 311 | 156 → 110 | 57 → 57 |

Wycieki zdrowia spadły o 78% na części roboczej i tylko o 29% na odłożonej. Różnica jest większa niż
przy osobach. Pozostałe wycieki części odłożonej to w większości prawdziwe dane o zdrowiu, nie spór
o klucz: opis medyczny po angielsku w piśmie dwujęzycznym (diabetes, stent, nazwy leków), sam kod
ICD bez kotwicy (I10, J18.9), objawy (gorączka, wysypka), sprzęt i stan funkcjonalny (pompa
insulinowa, wózek, balkonik), skróty potoczne. Te grupy trzeba naprawiać ogólnie i sprawdzać na
nowych pismach, bo część odłożona była już mierzona dwa razy i przestaje być w pełni niezależna.

## Kolejność napraw

1. Klasy 1 + 2 + 5 + 9 + 12 razem: „osoby w piśmie” (nasiona z pewnych kotwic, rozwinięcie na
   odmiany, zdrobnienia, samo imię, inicjały, login; zwrot, wołacz, podpis, pokrewieństwo, mówca).
2. Klasy 3 + 4 + 10: zdrowie jako zdarzenie i rozpoznanie przy osobie.
3. Klasa 7: nagłówek instytucji (nadmaskowanie).
4. Klasy 6, 8, 11, 13: OCR i formaty numerów.

Każdy krok: pomiar na części roboczej, potem jednorazowo na odłożonej; pierwszy zestaw, benchmark
i nadmaskowanie nie mogą się pogorszyć; audyt adwersarialny przed commitem.
