# Zestaw testowy anonimizatora (50 pism)

50 fikcyjnych pism po polsku w 10 typach, po 5 wariantów każdego. Każde pismo ma klucz z dokładną listą danych, które mają zniknąć, zostać albo zależą od polityki narzędzia. Skrypt `eval.py` porównuje wyniki anonimizatora z kluczem i pisze raport.

Wszystkie dane są zmyślone. PESEL, NIP, REGON, IBAN (NRB), numery dowodów, paszportów, ksiąg wieczystych i PWZ mają poprawne sumy kontrolne, więc przejdą walidację. Adresy IP pochodzą z pul dokumentacyjnych (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32). Domeny e-mail są testowe.

## Struktura

```
docx/           50 pism w Wordzie (wejście dla anonimizatora)
txt/            te same pisma jako zwykły tekst
ground_truth/   klucz JSON dla każdego pisma
manifest.csv    lista pism z liczbą encji i opisem pułapek
eval.py         porównanie wyników z kluczem
generuj.py      generator (python generuj.py KATALOG odtwarza zestaw, te same seedy dają te same pisma)
```

## Typy pism

| szablon | co sprawdza najmocniej |
|---|---|
| wniosek_urzad | odmiana nazwisk małżonków, nazwisko Zima obok słowa „zimą”, adres urzędu do zachowania, ten sam telefon w dwóch formatach |
| wezwanie_zaplata | nazwiska będące zwykłymi słowami (Kos, Lis, Kowal), numer wpisu radcy, firma JDG z nazwiskiem, fałszywy PESEL jako numer polisy, dane spółki |
| kadry_pracownik | dane o zdrowiu opisowo, PESEL i data urodzenia dziecka, paszport, tablica, IP, telefon bez słowa „tel.”, inicjał z nazwiskiem |
| umowa_najmu | komparycja w narzędniku, numer księgi wieczystej, adres lokalu, pułapki kot, lis, wróble |
| reklamacja | samo imię osoby (kurier, konsultantka), numer klienta, ostatnie 4 cyfry karty, NRB bez prefiksu PL |
| notatka_sluzbowa | wiele osób z tytułami, inicjały w liście zadań, instytucje do zachowania, patron w nazwie instytutu |
| pozew_rozwod | dane małoletnich, numer aktu USC, alkohol i Niebieska Karta, dochód |
| karta_szpitalna | kody ICD-10, rozpoznania, leki, eponimy w nazwach chorób, patron w nazwie szpitala, przedstawiciel ustawowy |
| pelnomocnictwo | osoba zagraniczna z paszportem i kartą pobytu, VIN, tablica, notariusz, NIP osoby fizycznej |
| szkoda_oc | dwie tablice, VIN, prawo jazdy, policjant z imienia i nazwiska, obrażenia |

## Format klucza

```json
{
  "id": "02_wezwanie_zaplata",
  "template": "wezwanie_zaplata",
  "traps": ["nazwisko Kos i słowo „kosy”", "..."],
  "entities": [
    {"text": "GD-8638", "type": "PROF_ID", "expect": "mask", "note": "numer wpisu na listę radców", "count": 1}
  ]
}
```

`text` to dokładny ciąg w piśmie, a `count` to liczba jego wystąpień (dopasowanie z granicami słowa, z rozróżnieniem wielkości liter). Pole `expect` przyjmuje trzy wartości.

- `mask` oznacza daną osobową, która ma zniknąć z wyniku. Każde wystąpienie, które zostało, to wyciek.
- `keep` oznacza element do zachowania (instytucja, sąd, adres urzędu, zwykłe słowo, numer faktury, fałszywy PESEL). Brak w wyniku liczy się jako nadmiarowe maskowanie. Dla `keep` liczba wystąpień nie obejmuje tych wewnątrz danych do maskowania, np. „lis” w adresie e-mail.
- `policy` oznacza sprawę do decyzji projektowej (dane spółki, miejscowość, numery spraw, stanowisko, pracodawca). Raport tylko pokazuje, co narzędzie z nimi zrobiło.

Typy `mask`: PERSON, PERSON_FIRSTNAME, PERSON_INITIALS, PESEL, DATE_BIRTH, ID_CARD, PASSPORT, RESIDENCE_CARD, NIP_PERSON, REGON_PERSON, JDG_NAME, IBAN, PHONE, EMAIL, ADDRESS, POSTAL, IP, PLATE, VIN, DRIVING_LICENSE, LAND_REGISTER, CIVIL_RECORD, PROF_ID, HEALTH, SENSITIVE.

## Jak uruchomić ocenę

1. Przepuść pliki z `docx/` (albo `txt/`) przez anonimizator.
2. Zapisz wyniki do jednego katalogu. Nazwa pliku wynikowego musi zaczynać się od id pisma, np. `01_wniosek_urzad.txt` albo `01_wniosek_urzad_anon.docx`. Obsługiwane formaty to .txt, .md, .docx i .html.
3. Uruchom:

```
pip install python-docx
python eval.py WYNIKI --report raport
```

Powstaną `raport.md` (tabele i listy wycieków) oraz `raport.json` (pełne dane per pismo do dalszej analizy).

Raport zawiera:
- recall liczony na wystąpieniach, ogólnie, per typ danych i per szablon,
- listę wycieków z adnotacją „w całości”, „częściowo” albo „inny format tych samych cyfr” (np. IBAN przepisany bez spacji),
- nadmiarowe maskowanie per typ,
- decyzje polityki,
- liczbę znaczników z numerem i bez numeru, czyli czy narzędzie rozróżnia osoby ([OSOBA-1], [OSOBA-2]).

## Ograniczenia oceny

Ocena porównuje ciągi znaków. Jeśli narzędzie zmienia tekst poza maskowaniem (scala spacje, zmienia cudzysłowy, łamie wiersze w środku adresu), elementy `keep` mogą wyglądać na usunięte. W takim przypadku warto przejrzeć listę nadmiarowo zamaskowanych ręcznie. Dane o zdrowiu są w kluczu jako frazy (np. „cesarskie cięcie”, „E10.9”). Zamaskowanie części frazy liczy się jako sukces, bo całego ciągu już nie ma.

## Prompt dla Claude Code

Po uruchomieniu oceny w repozytorium anonimizatora:

> Przeczytaj raport.json z oceny anonimizatora na zestawie anonimizator-testy. Pogrupuj wycieki według przyczyny (brak wzorca, wzorzec zależny od słowa poprzedzającego, odmiana, częściowe maskowanie złożonej nazwy, brak obsługi treści opisowej). Dla każdej grupy wskaż miejsce w kodzie, które za nią odpowiada, i zaproponuj poprawkę z testem regresyjnym opartym na przykładach z raportu. Osobno oceń nadmiarowe maskowanie i zaproponuj, które decyzje z sekcji policy powinny stać się opcjami konfiguracji.
