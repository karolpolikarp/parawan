# Ewaluacja na zestawie 50 fikcyjnych pism

Data: 2026-11-12. Wersja: aplikacja v0.46.27, rdzeń 0.29.14, commit `c11836a`.

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
