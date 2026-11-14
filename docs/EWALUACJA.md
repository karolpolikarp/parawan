# Ewaluacja na zestawie 50 fikcyjnych pism

Pomiar bazowy: 2026-11-12, aplikacja v0.46.27, rdzeń 0.29.14, commit `c11836a`. Wynik po
poprawkach (v0.47.0): sekcja „Po poprawkach” na końcu.

Zestaw: `test-data/anonimizator-testy/` (50 pism w 10 szablonach, txt i docx, klucz w `ground_truth/`,
ocena `eval.py`). Wszystkie dane są zmyślone. Runner: `npm run eval` (`scripts/eval/run-eval.mjs`),
ten sam kod co aplikacja (rdzeń i czytnik docx z `apps/web/src/docx.ts`), bez dostępu do sieci.
Wyniki trafiają do `test-data/wyniki/<wersja>/<profil>/<wejście>/` (poza repo).

## Wyniki bazowe

Profil domyślny (jak aplikacja po pierwszym uruchomieniu: wszystkie typy, bez pseudonimów).
Wyniki z txt i docx są identyczne (różni je tylko końcowy znak nowej linii).

| miara | wartość |
|---|---|
| recall (wystąpienia) | **89,2%** (869/974) |
| wycieki | 105 |
| nadmiarowe maskowanie | 30/117 elementów do zachowania |
| znaczniki z numerem / bez | 0 / 1007 |
| znaczniki osób literowe przy włączonych pseudonimach | 356 (`[OSOBA-A]`…), 651 pozostałych bez numeru |

`eval.py` uznaje za numerowane tylko znaczniki z cyfrą, więc literowe `[OSOBA-A]` liczy jako
„bez numeru”. Runner podaje je osobno.

### Recall per typ danych (tylko typy z wyciekiem)

| typ | wystąpienia | wycieki | recall |
|---|---:|---:|---:|
| HEALTH | 50 | 50 | 0% |
| PROF_ID | 20 | 20 | 0% |
| PERSON_INITIALS | 15 | 15 | 0% |
| CIVIL_RECORD | 5 | 5 | 0% |
| RESIDENCE_CARD | 2 | 2 | 0% |
| JDG_NAME | 10 | 5 | 50% |
| PHONE | 62 | 5 | 92% |
| DATE_BIRTH | 34 | 2 | 94% |
| PERSON | 358 | 1 | 100% (99,7%) |

Bez wycieków: ADDRESS, DRIVING_LICENSE, EMAIL, IBAN, ID_CARD, IP, LAND_REGISTER, NIP_PERSON,
PASSPORT, PERSON_FIRSTNAME, PESEL, PLATE, POSTAL, REGON_PERSON, SENSITIVE, VIN.

### Recall per szablon

| szablon | recall | wycieki | nadmiarowo usunięte |
|---|---:|---:|---:|
| karta_szpitalna | 55% | 35 | 0/0 |
| kadry_pracownik | 83% | 22 | 10/15 |
| notatka_sluzbowa | 84% | 16 | 5/40 |
| pozew_rozwod | 87% | 15 | 0/5 |
| wezwanie_zaplata | 92% | 10 | 0/17 |
| szkoda_oc | 95% | 5 | 0/0 |
| pelnomocnictwo | 97% | 2 | 0/5 |
| reklamacja | 100% | 0 | 0/3 |
| umowa_najmu | 100% | 0 | 5/13 |
| wniosek_urzad | 100% | 0 | 10/19 |

### Decyzje polityki (stan obecny)

| typ | wystąpienia | zostaje jawne |
|---|---:|---:|
| CITY (miejscowość z adresu osoby) | 117 | 31 |
| CASE_NUMBER | 30 | 20 |
| COMPANY (nazwa spółki) | 15 | 15 |
| KRS / NIP / REGON / IBAN spółki | po 5 | 0 |
| EMPLOYER, JOB_TITLE, LOCATION, CUSTOMER_ID, ORDER_NUMBER, POLICY_NUMBER, CARD_LAST4, PHONE_EXT, FINANCIAL, VEHICLE_MODEL | 5–10 | wszystkie |

## Grupy przyczyn

Suma wycieków: 105 = 50 + 27 + 15 + 7 + 5 + 1.

### A. Brak obsługi treści opisowej o zdrowiu — 50 wycieków, krytyczna
Rozpoznania, kody ICD-10, leki, zabiegi, obrażenia, nałogi. Silnik nie ma żadnego typu dla danych
o zdrowiu (`packages/core/src/types.ts:3`, lista `PiiType`).
- 08_karta_szpitalna: `F32.1`, `astma oskrzelowa z przewagą komponenty alergicznej`, `sertralina 50 mg`
- 03_kadry_pracownik: `cesarskie cięcie`, `przeciwwskazane jest dźwiganie ciężarów`
- 07_pozew_rozwod: `nadużywa alkoholu`; 10_szkoda_oc: `stłuczenia klatki piersiowej`

Rozkład: karta_szpitalna 30, kadry 10, pozew 5, szkoda_oc 5.

### B. Brak wzorca dla identyfikatorów zawodowych i rejestrów — 27 wycieków, krytyczna
- numer wpisu radcy `WA-3516`, `KR-4222`, `GD-8776` (10), PWZ lekarza `PWZ 2663347` (10)
  — 02, 07, 08, 03 itd.;
- akt stanu cywilnego `akt małżeństwa nr 1040/2011` (5) — 07, 17, 27;
- karta pobytu `kartą pobytu nr RP6295053` (2) — 09, 19.

Brak przebiegu; najbliższe istniejące to dokumenty w `passes/documents.ts:30` (`passIdCard`)
i `:56` (`passPassport`). Każdy z tych numerów ma jednoznaczną kotwicę („radca prawny”, „PWZ”,
„akt małżeństwa/urodzenia nr”, „karta pobytu nr”).

### C. Inicjały bez kropki w liście zadań — 15 wycieków, kosmetyczna/średnia
`(odp. AS)`, `(odp. MK, …)`, `(odp. KK)` — 06, 16, 26, 36, 46. Inicjały są maskowane tylko przy
masce osoby (`passes/finalize.ts:437`) albo z kropką przed nazwiskiem
(`passes/person-triggers.ts:243`, `passPersonInitial`). Dwie wersaliki bez kotwicy to też skróty
(ZUS, KK, AS), więc bez kotwicy „odp.” ryzyko fałszywych trafień jest wysokie.

### D. Kotwica nie obejmuje kontekstu — 7 wycieków, krytyczna
- Telefon (5/5): `kontaktować się ze mną pod numerem 22 379 56 66` — 03, 13, 23, 33, 43. „pod
  numerem” jest kotwicą tylko po czasowniku „dzwonić” (`passes/numeric.ts:255-259`, `PHONE_ANCHOR`),
  a format 2-3-2-2 bez kotwicy jest celowo pomijany (`passes/numeric.ts:418`, `RE_PHONE_BARE`).
- Data urodzenia (2/2): `w związku z urodzeniem syna, [OSOBA] (PESEL …), w dniu 17 czerwca 2026` —
  03, 43. Rzeczownik „urodzenie(m)” nie jest kotwicą, a między kotwicą a datą stoi osoba i PESEL
  (`passes/birth-date.ts:13-18`, `RE_BIRTH_LABELED`).

### E. Częściowe maskowanie złożonej nazwy (firma JDG) — 5 wycieków, krytyczna
`LIS-BUD [IMIĘ I NAZWISKO]`, `WRZOSEK-BUD`, `JABŁOŃS-TRANS`, `POLAK-POL` — 02, 12, 22, 32, 42.
Nazwisko właściciela znika, ale człon firmy z nazwiskiem zostaje. Łańcuch firmy jest celowo
zostawiany (`guards/person-context.ts:107`). Kotwica: „pod firmą” / „prowadząca działalność
gospodarczą pod firmą”.

### F. Homograf w dopełniaczu — 1 wyciek, średnia
`zespół Joanny Sikory` (46): „Sikora” jest homografem (ptak) w `surnames.ts:42`; para
imię + homograf w dopełniaczu nie przechodzi (`passes/person-pairs.ts:688`), choć „zespół Joanny
Kowalskiej” jest maskowany.

### Nadmiarowe maskowanie

#### G. Adres siedziby instytucji — 30 przypadków (20 ulic, 10 kodów), średnia
Nagłówek urzędu / pracodawcy (`Urząd Miasta Łodzi⏎Wydział Finansowy⏎ul. Piotrkowska 104⏎90-926 Łódź`),
adres administratora budynku (`Spółdzielnia Mieszkaniowa „Przyszłość”, ul. Wspólna 1`) i miejsce
spotkania (`budynek przy ul. Królewskiej 27`). `passAddress` (`passes/address.ts:810`) maskuje każdą
ulicę z numerem; strażnik `institutionBeforeAddr` (`guards/person-context.ts`) działa tylko dla
patronów, nie dla zwykłych ulic w bloku instytucji.

#### Poza kluczem (zauważone przy przeglądzie)
- `z Panem Ministrem` → `z Panem [IMIĘ I NAZWISKO]` (06 i podobne notatki): tytuł urzędu po „Pan”.
- `procedurę Niebieskiej Karty` → `procedurę [IMIĘ I NAZWISKO] Karty` (07, 17). SENSITIVE ma 100%
  tylko przez to fałszywe trafienie osoby.

## Hipotezy z ręcznych testów

| # | hipoteza | werdykt | dane |
|---|---|---|---|
| 1 | telefon i data urodzenia tylko po słowie poprzedzającym | **częściowo potwierdzona** | „dzwonić pod numerem” maskuje, „kontaktować się ze mną pod numerem” nie (5/5 wycieków telefonu). „w dniu” jest dopuszczone po kotwicy, ale kotwicą nie jest rzeczownik „urodzeniem”, a między nim i datą stoi osoba (2/2 wycieków daty). |
| 2 | brak wzorca dla radców, PWZ, KW, VIN, prawa jazdy, karty pobytu | **częściowo**: potwierdzona dla radców i PWZ (0/20), karty pobytu (0/2) i aktów USC (0/5); **obalona** dla KW (5/5), VIN (7/7) i prawa jazdy (5/5) | |
| 3 | firma JDG maskowana częściowo | **potwierdzona** | 5/5 członów firmy z nazwiskiem zostaje (`LIS-BUD`). |
| 4 | jeden znacznik dla wszystkich osób, brak łączenia odmian | **potwierdzona dla ustawień domyślnych, obalona dla opcji** | Opcja „pseudonimy” istnieje (`RedactOptions.pseudonyms`, w UI przełącznik) i daje `[OSOBA-A]…` z łączeniem odmian (06: „Wojciech Kowal” i „Wojciechowi Kowalowi” → `[OSOBA-E]`). Słabości: domyślnie wyłączona; klucz to nazwisko, więc małżonkowie dostają ten sam znacznik („Anna Kowalska i Jan Kowalski” → oba `[OSOBA-A]`); etykiety literowe. |
| 5 | adres urzędu maskowany, nazwa spółki zostaje obok zamaskowanego KRS | **potwierdzona** | adres/kod instytucji usunięte 30/30; COMPANY zostaje 15/15, a KRS, NIP, REGON i IBAN spółek zamaskowane 20/20. |
| 6 | brak sygnału dla danych o zdrowiu | **potwierdzona** | HEALTH 0/50. |
| 7 | suma PESEL dobra, ale PESEL z literówką po „PESEL” przejdzie | **częściowo potwierdzona** | Fałszywy PESEL bez etykiety zostaje 5/5 (dobrze). 11 cyfr ze złą sumą po „PESEL” jest maskowane. Przechodzi literówka zmieniająca długość: `PESEL: 8909150266` (10 cyfr) i `PESEL 890915026670` (12 cyfr) zostają jawne (`passes/numeric.ts:129`, etykieta wymaga dokładnie 11 cyfr). |

## Po poprawkach (v0.47.0, rdzeń 0.30.0)

Data: 2026-11-14, commit `16c06f7` plus podbicie wersji. Dwa zestawy:
- **roboczy**: `test-data/anonimizator-testy/` (ziarna 1001–1050), na nim szukano przyczyn;
- **odłożony**: 50 pism z tego samego generatora (`generuj.py`) z ziarnami 7001–7050, których nikt
  nie oglądał przy pisaniu poprawek. Leży poza repo; odtworzenie: `generuj.py` z innym ziarnem
  i `eval.py` na wyniku.

Wyniki z txt i docx są identyczne, z pseudonimami i bez też (poza samymi znacznikami osób).

| miara | roboczy przed | roboczy po | odłożony przed | odłożony po |
|---|---:|---:|---:|---:|
| recall (wystąpienia) | 89,2% (869/974) | **99,5%** (969/974) | 89,3% (864/968) | **99,5%** (963/968) |
| wycieki | 105 | **5** | 104 | **5** |
| nadmiarowe maskowanie | 30/117 | **0/117** | 30/119 | **0/119** |
| znaczniki osób literowe (z pseudonimami) | 356 | 362 | | |

Pierwsza wersja poprawek dawała na odłożonym 98,2% i 17 wycieków (leki spoza listy, izba radców
z Lublina, „Marka Sowy”), czyli była lekko dopasowana do zestawu roboczego. Końcowa weryfikacja
wieloagentowa poprawiła te klasy w całości, nie pojedyncze słowa.

### Recall per typ, przed i po

| typ | roboczy przed | roboczy po | odłożony przed | odłożony po |
|---|---:|---:|---:|---:|
| PERSON | 357/358 | 358/358 | 350/352 | 352/352 |
| ADDRESS | 100/100 | 100/100 | 100/100 | 100/100 |
| POSTAL | 85/85 | 85/85 | 85/85 | 85/85 |
| PESEL | 64/64 | 64/64 | 64/64 | 64/64 |
| PHONE | 57/62 | **62/62** | 57/62 | **62/62** |
| HEALTH | 0/50 | **50/50** | 0/50 | **50/50** |
| EMAIL | 45/45 | 45/45 | 45/45 | 45/45 |
| DATE_BIRTH | 32/34 | **34/34** | 32/34 | **34/34** |
| IBAN | 27/27 | 27/27 | 28/28 | 28/28 |
| PROF_ID | 0/20 | **20/20** | 0/20 | **20/20** |
| ID_CARD | 18/18 | 18/18 | 20/20 | 20/20 |
| PLATE | 17/17 | 17/17 | 18/18 | 18/18 |
| PERSON_INITIALS | 0/15 | **15/15** | 0/15 | **15/15** |
| NIP_PERSON | 13/13 | 13/13 | 12/12 | 12/12 |
| JDG_NAME | 5/10 | **10/10** | 5/10 | **10/10** |
| PERSON_FIRSTNAME | 10/10 | 10/10 | 10/10 | 10/10 |
| PASSPORT | 7/7 | 7/7 | 5/5 | 5/5 |
| VIN | 7/7 | 7/7 | 8/8 | 8/8 |
| IP | 5/5 | 5/5 | 5/5 | 5/5 |
| REGON_PERSON | 5/5 | 5/5 | 5/5 | 5/5 |
| SENSITIVE | 5/5 | 0/5 | 5/5 | 0/5 |
| CIVIL_RECORD | 0/5 | **5/5** | 0/5 | **5/5** |
| LAND_REGISTER | 5/5 | 5/5 | 5/5 | 5/5 |
| DRIVING_LICENSE | 5/5 | 5/5 | 5/5 | 5/5 |
| RESIDENCE_CARD | 0/2 | **2/2** | – | – |

SENSITIVE „spadło” z 5/5 na 0/5, ale wcześniejsze 5/5 brało się z fałszywego trafienia
(„procedurę [IMIĘ I NAZWISKO] Karty”). Po poprawce tytułów urzędów i „Niebieskiej Karty” to słowo
nie jest już osobą, a samego faktu procedury silnik nie zakrywa. Wszystkie 5 pozostałych wycieków
w obu zestawach to właśnie „Niebieskiej Karty” w pozwach (07, 17, 27, 37, 47).

Nadmiarowe maskowanie per typ: INSTITUTION_ADDRESS 20/20 → 0/20, INSTITUTION_POSTAL 10/10 → 0/10,
pozostałe bez zmian (0).

### Polityka po poprawkach

Zmieniła się tylko miejscowość: CITY jawne 31 → 37 (roboczy) i 32 → 38 (odłożony), bo miasto
w nazwie urzędu tuż przed jawną ulicą siedziby zostaje razem z nią. Reszta bez zmian: COMPANY
15/15 jawne, KRS, NIP, REGON i IBAN spółek zakryte, CASE_NUMBER 20/30 jawne, EMPLOYER, JOB_TITLE
i podobne jawne.

### Commity poprawek

Pierwsza runda (grupy przyczyn A–G i hipotezy): `ca8f1c3` PESEL z literówką w długości, `7cc6dac`
telefon po „pod numerem”, `75e6351` inicjały po „odp.”, `c79287d` tytuł urzędu po „Pan” i
„Niebieska Karta”, `9c2eb1e` firma jednoosobowa w całości, `68ce603` data urodzenia po
„urodzeniem”, `5bcbcd4` homograf w dopełniaczu, `8ff2bcf` trzy nowe typy numerów, `522172d` dane
o zdrowiu, `d939cc0` adres siedziby instytucji.

Końcowa weryfikacja (98 zgłoszeń, 33 potwierdzone, 12 grup): `668cdca`, `1bbdb18`, `cb3e799`,
`5358ac1`, `e016054`, `98de206`, `e7b5932`, `5407239`, `df196f6`, `7feb79a`, `5d0b2d6`, `16c06f7`.
Dwie z nich były blokerami: strażnik siedziby zwalniał długi wiersz (280 KB: 0,2 s w v0.46.27,
22 s po pierwszej rundzie, teraz 0,3 s) i odsłaniał adres szkoły jazdy czy żłobka domowego
z nazwiskiem właściciela.

## Znane ograniczenia

1. **Niebieska Karta**: osoba jest zakryta, sam fakt procedury zostaje (SENSITIVE 0/5). Plan:
   osobny typ, ROADMAP poz. 28.
2. Silna etykieta działa także w instrukcji: „W polu „Numer PWZ” wpisz…, np. PWZ 5425740” i „np.
   PESEL 1234567890” są zakryte (świadomie: lepiej zakryć przykład, niż przepuścić numer).
3. „Numer PESEL nr 8909150266” (10 cyfr po „PESEL nr”) zostaje jawny, bo „PESEL nr” z numerem
   sprawy też się zdarza.
4. „Urodzenie dziecka Jana Kowalskiego w dniu 10.08.2020 r. zostało zgłoszone”: data zostaje jawna.
   „Termin urodzenia – 05.06.2026 r.” jest za to brany za datę urodzenia.
5. „przebywał w szpitalu” bez „psychiatrycznym” czy rozpoznania zostaje jawne.
6. Bez pseudonimów „Rozpoznanie: RAK-JELITA Jan Kowalski” zostawia „RAK-JELITA” jawne.
7. „Parafia pw. św. Stanisława Kalisz, ul. Polna 3” daje `[ADRES]`, bo parafii bez „w” nie ma wśród
   mocnych członów nazwy instytucji.
8. „(Urząd Skarbowy w Łodzi, …)”: adres siedziby zostaje, ale miasto dostaje `[MIEJSCOWOŚĆ]` (stare
   zachowanie przebiegu miejscowości).
9. Osoba spoza słownika imion („Marianna Zięba-Kot”, „Ołeksandr”) zostaje jawna; adres pod nią jest
   zakryty.
10. „pod numerem 123456789 w systemie EZD”, „z przesyłką pod numerem …” i „Dokumentacja dostępna
    pod numerem …” po „Pani” dają `[TELEFON]` (stare zachowanie).
11. Stare nadmaskowania poza tą rundą: „Mariackim” jako osoba, „Lecha Poznań” po „z udziałem Arka
    Gdynia”, „Niebieska wstążka” → `[IMIĘ I NAZWISKO]`, słowo w masce adresu w „ul. Długiej 5
    mieszkania 20 rodzin”.
12. Gołe inicjały po „odp.” są zakryte tylko, gdy w piśmie stoi pełne imię i nazwisko tej osoby.
13. Oba zestawy pochodzą z jednego generatora z 10 szablonami. Wynik 99,5% mówi o tych szablonach,
    nie o dowolnych pismach: tabel, skanów po OCR, tekstu angielskiego i pism przepisanych
    ręcznie nie mierzono.

## Decyzje polityki do podjęcia (kandydaci na opcje)

Klucz zestawu oznacza te pozycje jako `policy`, czyli bez jednej dobrej odpowiedzi. Dziś każda ma
stałe zachowanie.

| decyzja | dziś | rekomendacja |
|---|---|---|
| Dane spółek (nazwa, KRS, NIP, REGON, IBAN firmy) | nazwa jawna, numery zakryte | opcja „Zostaw jawne dane firm” (domyślnie wyłączona): przy publikacji w BIP numery spółek są jawne, w pismach wewnętrznych bywają zbędne |
| Miejscowość | zakryta przy adresie osoby, jawna w prozie i w nazwie urzędu | bez zmian; ewentualnie przełącznik „zakrywaj każdą miejscowość” dla małych gmin, gdzie miejscowość wskazuje osobę |
| Numery spraw (znak, sygnatura) | zakryte tylko z kotwicą („Znak sprawy:”, „Sygn. akt”) | bez zmian w trybie domyślnym; w profilu „Do publikacji” (ROADMAP poz. 11) jawne |
| Tryb pseudonimizacja / publikacja | jeden tryb, pseudonimy osobnym przełącznikiem | dwa profile: „Do pracy” (pseudonimy i numeracja osób) i „Do publikacji w BIP” (ROADMAP poz. 11) |
| Numeracja osób: litery czy cyfry | `[OSOBA-A]`, `[OSOBA-B]` | litery zostają, bo znacznik bez cyfr nie myli się z daną przy ponownym przebiegu; to `eval.py` powinien liczyć litery jako numerację. Do zrobienia: osobna etykieta dla małżonków o tym samym nazwisku (dziś klucz to nazwisko) |
