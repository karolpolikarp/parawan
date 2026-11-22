# Changelog

Zmiany w Parawanie, od najnowszej wersji. Nagłówek „## vX.Y.Z — data” odpowiada wersji aplikacji
z `apps/web/package.json` i tagowi `vX.Y.Z` w repozytorium; wpisy z dopiskiem „(wpis odtworzony
z historii commitów)” dopisano później na podstawie commitów z danego zakresu.

Odnośniki na końcu pliku prowadzą do porównania kolejnych wersji na GitHubie. Nagłówki ich nie
używają, bo skrypt wydania (`scripts/release/render-docs.mjs`) szuka sekcji po „## vX.Y.Z”, więc
w podglądzie Markdowna to spis adresów, a nie linki w nagłówkach. Tagi v0.41.0, v0.42.0,
v0.46.11, v0.46.14, v0.46.15, v0.46.17 i v0.46.21 dodano wstecznie 2026-10-25; porównania z nimi
działają na GitHubie od chwili wypchnięcia tagów.

## [Unreleased]

## v0.48.1 — 2026-11-23

**Parawan szybciej startuje: na słabym komputerze jest gotowy do pracy wyraźnie wcześniej, a wynik anonimizacji się nie zmienia.**

Pilność: zalecana

Na komputerze średniej klasy (procesor 4× wolniejszy niż komputer testowy) Parawan jest gotowy
do pracy po ok. 2,0 s zamiast 2,5 s w v0.48.0. Rdzeń 0.31.1 (paczki `anonimizator` i `parawan`).

- **Szybszy start.** Moduł do czytania PDF uruchamia się dopiero, gdy otworzysz pierwszy PDF, a nie
  przy każdym otwarciu pliku. Wzorce danych o zdrowiu są przygotowane już w pliku, więc aplikacja
  nie liczy ich przy starcie i nie robi tego dwa razy. Pierwszy PDF otwiera się o ułamek sekundy
  dłużej niż następne. Wynik anonimizacji jest identyczny co do znaku (sprawdzone na wszystkich
  seriach pism i w benchmarku). Plik urósł o ok. 27 kB.

## v0.48.0 — 2026-11-15

**Parawan zostawia jawne dane urzędu, a zakrywa więcej danych osoby: tę samą osobę w całym piśmie, dane o zdrowiu ze świadczeń i oświaty, numery uprawnień, tabele i inicjały w dekretacji.**

Pilność: pilna

Na trzeciej serii 100 fikcyjnych pism urzędowych (podatki, USC, budownictwo, skargi, kadry, oświata,
świadczenia, komunikacja, zamówienia, polecenia dla AI; `docs/EWALUACJA-SERIA-3.md`) Parawan zakrywa
94,7% danych do zakrycia zamiast 87,3%, a niepotrzebnie zakrytych danych urzędu (organ, adres,
telefon, e-mail, rachunek, sygnatura cytowanego wyroku) jest 2 zamiast 64 na 358. Na części serii,
do której reguł nie dopasowywano, 90,9% zamiast 87,7%. Na drugiej serii (tabele, OCR, czaty,
sprawy społeczne, `docs/EWALUACJA-SERIA-2.md`) 78,1% zamiast 69,8% w części kontrolnej. Pierwszy
zestaw 50 pism bez zmian: 99,5%, żadnego nadmiarowego zakrycia. Rdzeń 0.31.0 (paczki `anonimizator`
i `parawan`). Na słabym komputerze aplikacja jest gotowa do pracy po ok. 2,6 s (v0.47.0: 1,4 s).

**Osoba, której imię i nazwisko Parawan już zakrył, znika też tam, gdzie pismo podaje ją inaczej: samym nazwiskiem w odmianie, samym imieniem, zdrobnieniem, inicjałami albo loginem.**

- **Raz rozpoznana osoba zakryta w całym piśmie.** Gdy pismo podaje osobę z pewną kotwicą (imię
  i nazwisko, „Pani Nowak”, pole „Imię i nazwisko:”), dalsze wzmianki o niej też znikają: samo
  nazwisko w odmianie i wersalikami („radna Elżbieta Sowa” → „radnej Sowy”, „wstrzymała się (1):
  Sowa”, „A. Kmieć”, „ZASTĘPSTWO: WILK R.”), samo imię w odmianie i w wołaczu („Szanowny Panie
  Henryku”, „zgłoszenie Pauliny”), zdrobnienie („Jakub Wrona” → „Kuba”, „Kuby”; „Aleksandra” → „Ola”,
  „Bartosz” → „Bartek”, „Bartkiem”), inicjały jednej osoby („P.L. złoży wniosek”, „dyżur – KB”)
  i login z imienia i nazwiska („amazur”, „@kzielinska”). W czacie, SMS-ie i zgłoszeniu helpdesku
  także imię pisane małą literą („dzieki panie piotrze”, „pozdrawiam aga”). Z pseudonimami wzmianka
  dostaje tę samą etykietę co osoba. Na drugiej serii 100 pism (część robocza) zakrytych danych jest
  78,8% zamiast 72,7%, bez nowych nadmiarowych zakryć.
- **Bez osoby w piśmie i w nazwach nic się nie zmienia.** Samo „Jan” albo „Kuba” bez imienia
  i nazwiska w piśmie zostaje. Patron zostaje także wtedy, gdy osoba z pisma ma to samo imię („ul.
  Jana Pawła II”, „im. Marii Konopnickiej”, „list św. Pawła”), tak samo nazwa z nazwiskiem („Hotel
  Lis”, „Dworzec Kaliski”), region i państwo („na Mazury”, „na Kubę”), data („3 Maja”) i nazwisko
  będące zwykłym słowem na początku zdania, małą literą albo jako wartość pola („Wróbel na dachu”,
  „jak wrona zgubiła ser”, „Zawód: Kowal”). Gołe wersaliki tylko w miejscu osoby („przez BWK”,
  „– KB”), więc „do akceptacji MZ” zostaje.
- **Kraj, miejscowość, urząd i święty o brzmieniu osoby z pisma zostają jawne.** Przy Panu Marku
  Włochu zostaje „wyjazd do Włoch”, przy Ewie Czech „towar z Czech” i „w Czechach”, przy Agnieszce
  Mazur „wakacje na Mazurach”, przy Janie Raku „mecz w Rakowie”, a przy Marcinie Długoszu „mieszka
  przy Długosza 7”. Zostają też skróty urzędów i skróty rozwinięte w piśmie („Ministerstwo Zdrowia
  (MZ)”, „zatwierdzony przez MZ”, „wydał MF”, „Platforma Obywatelska (PO)”, „Kraj: PL”), święci
  i świątynie („parafii św. Piotra i Pawła”, „Kościół Piotra i Pawła”), nazwy rzeczy i tytuły
  („Rondo Trzeciego Maja”, „Kopalnia Barbara”, „Ave Maria”, „Polisa Warty”, „Kino Andrzej”, „Bajka
  o Jasiu i Małgosi”), imię jako miejsce albo dzień („z Helu”, „po Kazimierzu”, „paczki na Mikołaja”)
  oraz nazwisko lub zdrobnienie w znaczeniu zwykłego słowa („Kamień węgielny”, „Zima była ciężka”,
  „Latem”, „matka – Rak jajnika”, „Sowy polują”, „Kuba to wyspa”, „Hala sportowa”, „w celu”,
  „natka pietruszki”). Celownik nazwiska znika jak pozostałe formy („przyznano zasiłek Kowalowi”,
  „Radnemu Dębowi”).
- **Formy, które nie mogą dotyczyć osoby z pisma, zostają jawne.** Przy Panu Piotrze Pomorskim
  zostaje „Pojezierze Pomorskie”, przy Pani Annie Tatrzańskiej „Tatrzańskie szlaki”, bo forma na
  -skie nie odnosi się do osoby. Nazwisko kobiety na spółgłoskę się nie odmienia, więc przy Pani
  Marii Lis zostaje „Przedszkole »Pod Lisem«”, a przy Pani Annie Bałtyk „port nad Bałtykiem”.
  Nazwisko-przymiotnik na początku zdania przed rzeczownikiem to zwykłe słowo („Wolny dostęp do
  informacji”, „Nowa ustawa wchodzi w życie”, „Mostek na rzece”), a przed orzeczeniem dalej osoba
  („Wolny przyszedł”). Miasto o brzmieniu nazwiska zostaje w każdej formie po przyimku („pociąg do
  Kalisza”, „wyjazd do Opola”), a „rozmowa z Kaliszem” znika. Zostają też symbole działów
  w kształcie inicjałów („Dział TZ”, „wydział TZ”, „materiał PS”) i „Ewangelia według Jana”.
- **Imię w zwrocie do osoby i w podpisie znika także wtedy, gdy pismo nie podaje nazwiska.** Wołacz
  imienia po „Panie” („Panie Marku”, „Szanowny Panie Stanisławie”, „dziękuję, panie Ryszardzie”), po
  powitaniu albo podziękowaniu („Cześć Ewo,”, „Hej Kasiu!”, „Witam Zbyszku,”, „Drogi Pawle,”), między
  przecinkami („Tak, Marku, wiem”) i na początku wiersza („Kasiu,”, „> Agnieszko!”). Formy wołacza
  powstają z imion i zdrobnień w słowniku, z obocznościami („Jacek” → „Jacku”, „Paweł” → „Pawle”,
  „Kacper” → „Kacprze”, „Ola” → „Olu”, „Heniek” → „Heńku”). Znika też imię po skrócie „p.” („hydraulik
  p. Marek”), nazwisko po obcym tytule („Dear Mr Brandt”, „Ms Sabine Krüger”, „Herr Müller”, „Frau
  Professor Schmidt”), „Dr Helen Carter” oraz imię i nazwisko w wierszu pod formułą pożegnalną
  („Pozdrawiam, Kuba”, „Z wyrazami szacunku / Kowalski”, „Best regards, / Tomasz”, „Kind regards /
  Mit freundlichen Grüßen / Matthias Brandt”). Takie imię zakrywa też dalsze wzmianki tej osoby.
  Z pseudonimami zwrot dostaje etykietę adresata o tym imieniu („Do: Ewa Nowak / Pani Ewo,”), a podpis
  samym imieniem etykietę nadawcy („Od: Jakub Nowak … Pozdrawiam, Kuba”). Adresatka „Pani Ewo” i
  podpisana pod pismem „Ewa Nowak” to dwie osoby, więc mają osobne etykiety, tak samo uczennica „Ewa
  Nowak” z treści pisma. Po obcym tytule znika tylko nazwisko albo imię ze słownika albo wyraz po
  powitaniu („Dear Mr Dalloway,”), także za stopniem z kropką („Herr Dr. Müller”, „Frau Prof. Dr.
  Weber”, „Sehr geehrte Frau Dr. Becker,”, „Dear Dr. Smith,”), więc zostają marki, utwory i role („płyn Mr Proper”,
  „catering z Mr Cook”, „firma Mr Garden sp. z o.o.”, „Mr Olympia”, „Mrs Dalloway”, „Frau Holle”,
  „Mr. Smith Goes to Washington”, „Herr Ober”, „Mr Prime Minister”, „Dr. Oetker”). Zostaje też
  wyliczenie miejsc („w Juracie, Helu, Jastarni”, „w Krakowie, Kazimierzu, Podgórzu”), wyliczenie
  imion w miejscowniku, równym u mężczyzn wołaczowi („Wykład o apostołach: Piotrze, Pawle, Janie”,
  „Kazanie o Piotrze, Pawle i Janie”, „o świętym Wojciechu, Stanisławie”), nazwy na -o w wyliczeniu
  i tabeli („Ulubione gry: Tetris, Mario, Sonic”, „Filmy: Coco, Kubo, Moana”, „Autorzy: Coelho,
  Paulo”, wiersz CSV „Mario,3”), role i zwroty bez imienia
  („Panie Prezesie”, „Panie Sędzio”, „Panie Boże”, „Szanowni Państwo”, „Herr Doktor”), mianownik po
  przecinku („Dziękuję, Anna przyjdzie jutro”), „Halo,” oraz podpis instytucji („Z poważaniem /
  Zarząd Spółki”, „Pozdrawiam / Dział Kadr”, „Kind regards, / Customer Service”). Na części roboczej drugiej serii zakrytych danych jest 78,9%
  zamiast 78,8%, bez nowych nadmiarowych zakryć; większość zwrotów z tej serii zakrywało już
  rozlanie osoby z pisma.
- **Imię członka rodziny albo podopiecznego znika, choć pismo nie podaje nazwiska.** Imię
  i zdrobnienie w każdym przypadku tuż za słowem pokrewieństwa lub opieki (syn, córka, mąż, żona,
  matka, ojciec, brat, siostra, babcia, dziadek, wnuk, ciocia, wujek, konkubent, partner, opiekun,
  podopieczny, dzieci): „jej syn Kuba”, „córce Oli”, „widziałem syna Jakuba”, „moja siostra Ewelina”,
  „mój syn Antoś”, wtrącenie po przecinku („Żona, Barbara, ale…”, „maz, Grzesiek, na lapku”, „auto
  mojego chlopaka, Kuby”), wyliczenie („dzieci Zuzanna (7 lat) i Antoni (4 lata)”, „mama Kasia, tata
  Marek i brat Tomek”), imiona rodziców bez osoby przed nimi („syn Władysława i Genowefy”, „synu Jana
  i Marii”), etykieta z dwukropkiem albo myślnikiem, jak w formularzach i notatkach („Dzieci: Oliwia
  (8 lat), Filip (5 lat) i Tymon (2 lata)”, „Syn: Piotr, ur. 2015”, „dzieci – Oliwia i Filip”),
  etykieta w czacie („Ciocia Grażka:”) i tekst angielski („my husband Paweł”, „our
  daughter Zofia”). Takie imię zakrywa też dalsze wzmianki („Zuzanna” → „Zuzia”, „Zuzi”; „Antoni” →
  „Antek”, „Antka”). Dawniej działało to tylko za zakrytą osobą („[…], syn Józefa i Marii”), więc
  zmienia się wcześniejsze ustalenie, że „Mój syn Józef ma pięć lat” zostaje jawne. Jawne zostają
  tytuły zakonne, patroni i postacie sakralne, czyli słowo pokrewieństwa z wielkiej litery w środku
  zdania, po „im.” albo „św.” („Schronisko Brata Alberta”, „im. św. Brata Alberta”, „Dom Pomocy
  im. Matki Teresy”, „Pielgrzymka do Ojca Pio”, „Matka Boża”, „Syn Marnotrawny”, „Jezus, syn Józefa
  i Maryi”), nazwa w cudzysłowie („grupa »Babcia Halina«”, „serial »Ojciec Mateusz«”) i nazwa firmy
  („Wnuczka Wiktoria Sp. z o.o.”). Tytuł zakonny przed znanym świętym albo imieniem z przydomkiem
  zostaje jawny w każdym miejscu zdania, także na jego początku, po numerze listy, dwukropku, myślniku
  i skrócie „pw.”, „pt.”, „tzw.”, „zob.” („Kościół pw. Matki Teresy z Kalkuty”, „film pt. Ojciec
  Mateusz”, „Temat lekcji: Brat Albert i ubodzy”, „Matka Joanna od Aniołów to film”). Tak samo
  tytuł pisany małą literą, jak każe ortografia („jak żyła matka Teresa z Kalkuty”, „Jak mawiał brat
  Albert”, „ofiara, którą złożył ojciec Maksymilian”), chyba że przed nim stoi „mój”, „jej”, „naszego”
  („mój brat Albert”, „moja matka Teresa” to krewni i znikają). Przydomek z „z” chroni tytuł tylko
  przy świętym albo przy mieście spoza Polski, więc krewny z kraju, instytucji czy małego miasta
  znika („Brat Piotr z Niemiec”, „Siostra Ewa z MOPS”, „Matka Anna z Wadowic”). Jawne zostaje też
  imię papieża i króla z liczebnikiem po kilku imionach („Matka Jana Pawła II, Emilia”). Jawny zostaje
  też Mikołaj z przedszkola („Wszystkim dzieciom Mikołaj przyniósł prezenty”, „Dziadek Mikołaj
  odwiedził przedszkole”) i każde imię, które jest podmiotem zdania, a nie krewnym („Wczoraj synowi
  Marek kupił rower”), oraz postacie historyczne i biblijne („Synowie Marka Aureliusza”,
  „synem Dawida i Batszeby”, „Ewangelia mówi o Marii, matce Jakuba”). Na części
  roboczej drugiej serii zakrytych danych jest 80,8% zamiast 78,9%, bez nowych nadmiarowych zakryć.
- **Imię autora wiadomości w czacie, SMS-ach, komentarzach i transkrypcji znika, choć pismo nie
  podaje nazwiska.** Imię, zdrobnienie albo imię z inicjałem przed dwukropkiem na początku wiersza
  eksportu rozmowy to osoba: „[08:12] Kasia 🌸: dzwonili ze szpitala”, „12:04 Tomasz: cześć”,
  „2026-10-01 09:14 Zbyszek: czynsz”, „[12.11.2026, 08:12:33] Ania: jestem”, „Konsultant (Marek):
  dzień dobry”, w wątku komentarzy „↳ Szymon P.: offtop” i „↳ Admin Wiesia 🌻: bez wycieczek”,
  w rozmowie bez godzin, w której mówcy wracają naprzemiennie („- Ola: będę o 5”, „- Ja: ok”,
  „- Ola: super”). W eksporcie ze znacznikami czasu znika też samo nazwisko mówcy, gdy
  wraca w kilku wierszach („[08:00] Nowak: kup chleb”). Takie imię zakrywa dalsze wzmianki w treści,
  także małą literą („kasia a recepty?”), a z pseudonimami mówca i wzmianka mają tę samą etykietę.
  Jawne zostają role mówcy („Konsultant:”, „KLIENT:”, „Bot:”, „System:”, „Ja:”, „InPost:”),
  pokrewieństwo bez imienia („Mama:”, „Tata:”), etykiety pól i nagłówki („Od:”, „Temat:”, „Uwagi:”,
  „Data:”, „PL:”/„EN:”), punkty porządku obrad z godziną („10:15 Przerwa: kawa”, „11:00 Kraków:
  przejazd”), zdanie z wyrazem przed dwukropkiem („Marek powiedział: tak”) i imię będące zwykłym
  słowem użyte raz („Hala: sportowa nr 2”, „- Kuba: wyspa na Karaibach”). Lista „Pole: wartość”
  nie jest rozmową, nawet z emotikoną, powtórzoną etykietą albo godziną: lista imienin w e-mailu
  („Temat: Imieniny w grudniu 🎉”, „Barbara: 4 grudnia”), wyjazdów („Jordan: marzec”), czytań
  („Jan: 3,16”), magazynu („Hala: zamknięta”, „Brama: otwarta”, „Hala: remont”), scenariusz jasełek
  („Józef: Nie ma miejsca w gospodzie.”) i program wycieczki („08:00 Kazimierz: zbiórka”, „15:00
  Florian: brama”, „16:00 Kazimierz Dolny: powrót”, „18:00 Sylwester: bal”) zostają jawne, także gdy
  etykieta wraca („08:00 Kazimierz: zbiórka”, „14:00 Kazimierz: obiad”, „08:00 Róża: otwarta”,
  „20:00 Róża: zamknięta”). Rozmową jest dopiero wymiana, w której co najmniej dwie osoby mówią jak
  w rozmowie (pytanie, powitanie, „tak”, „ok”), więc jawne zostają też dzielnice, sale i oddziały
  („Kazimierz: zwiedzanie synagog”, „Podgórze: obiad”, „Kazimierz: kolacja”), plan przekazany
  w cytacie e-maila („> Kazimierz: zwiedzanie”) i ewangeliści w planie lekcji religii, a zwykły czat
  o parafii albo kolędzie („[10:00] Paweł: ślub w parafii”) zakrywa wszystkich mówców. Na
  części roboczej drugiej serii zakrytych danych jest 82,7% zamiast 80,8%, bez nowych nadmiarowych zakryć.
- **Imiona cudzoziemców z pism urzędowych znikają tak jak polskie.** Słownik zna częste imiona
  ukraińskie, białoruskie i rosyjskie w zapisie polskim i paszportowym („matka Oksana Burek”,
  „doręczono Ołeksandrowi Melnykowi”, „pełnomocnictwo dla Dmytra Kowalenki”, „OLEKSANDR MELNYK”,
  „Svitlana Bondarenko”, „Iryna Kovalenko”), arabskie („Fatima Haddad”, „Ahmed”, „Mohammed”)
  i indyjskie („Priya Raman”), a także polskie, których brakowało („Oliwier Zając”, „Eryk Wilk”,
  „Daria Nowak”, „Marianna Zięba-Kot” w bloku adresata). Imię i nazwisko wietnamskie Parawan
  rozpoznaje po układzie sylab, także z diakrytyką: „Małżonek: Tran Thi Hoa”, „ustanawiam Do Minh
  Tuan”, „Nguyễn Văn Hùng”, „Thanh Nguyen” w podpisie. Jawne zostają słowa i nazwy zbieżne
  z imionami: „na tarasie”, „ZIELONY TARAS”, „Omar Jumbo”, „pielgrzymka do Fatimy”, „Salve Regina”,
  „Król Zygmunt August”, „Ho Chi Minh”, „Zatoka Ha Long”, „Do Hanoi lecieliśmy”, „obraz Van Gogha”.
  Na części roboczej drugiej serii zakrytych danych jest 83,5% zamiast 82,7%, bez nowych
  nadmiarowych zakryć.
- **Zdarzenie zdrowotne konkretnej osoby znika razem z tym, czego dotyczy.** Zwolnienie lekarskie
  z okresem („ma zwolnienie lekarskie do 27.11”, „przebywa na zwolnieniu lekarskim od 3 do 17 marca”,
  „jestem na L4”, „(e-ZLA)”), zasiłek chorobowy („6 dni zasiłku chorobowego”), urlop dla poratowania
  zdrowia, orzeczenie o niepełnosprawności, o stopniu niepełnosprawności z symbolem („umiarkowany
  stopień niepełnosprawności, symbol 05-R (choroby narządu ruchu)”), o niezdolności do samodzielnej
  egzystencji i o potrzebie kształcenia specjalnego, opinia o wczesnym wspomaganiu rozwoju, leczenie
  i terapia z rodzajem („leczy się w poradni zdrowia psychicznego”, „przebywał na leczeniu
  odwykowym”, „terapię integracji sensorycznej”, „korzysta z pomocy psychologa szkolnego”), pobyt
  w szpitalu, sanatorium i izbie wytrzeźwień, zabieg z opisem („po operacji biodra”, „po zabiegu
  usunięcia pęcherzyka żółciowego”, „po endoprotezie biodra”, „od czasu udaru”), ciąża z tygodniem
  („w 34. tygodniu ciąży”, „24. tydzień ciąży, ciążę prowadzi lekarz”), uzależnienie od substancji
  („jest uzależniony od amfetaminy”) i dializy. Rozpoznawane są też formy, którymi pisma opisują
  leczenie najczęściej: imiesłów („jest od lat leczona psychiatrycznie”, „był operowany na
  przepuklinę”, „była hospitalizowana w klinice kardiologii”, „jest dializowany”), zabieg nazwany
  jednym słowem albo z narządem („przeszła mastektomię”, „przeszedł zabieg koronarografii”, „po
  przeszczepie nerki”, „po amputacji nogi”, „po wszczepieniu rozrusznika serca”, „po poronieniu”),
  pobyt na oddziale z jego specjalnością, w zakładzie leczniczym, na detoksie i turnusie
  rehabilitacyjnym („kilkukrotnie trafiał do izby wytrzeźwień”), renta z tytułu niezdolności do
  pracy, urlop zdrowotny, „niepełnosprawny w stopniu znacznym”, „pod stałą opieką neurologa”,
  „przyjmuje sertralinę” oraz te same zdarzenia po angielsku w pismach dwujęzycznych („is on sick
  leave until 30 November”, „underwent knee surgery”, „is 24 weeks pregnant”). „Nie może pracować”
  i „wymaga opieki” po spójniku nie robią już z opisu faktu przepisu („przebywa na zwolnieniu
  lekarskim i nie może pracować”). Zakrywana jest sama fraza: osoba, nazwa szpitala pisana wielką
  literą i reszta zdania zostają. Na części roboczej drugiej serii zakrytych danych jest 87,3%
  zamiast 83,5% (dane o zdrowiu: 74 wycieki zamiast 125), bez nowych nadmiarowych zakryć.
- **Przepis, pouczenie i nazwa urzędu o zdrowiu zostają jawne.** „Zwolnienia lekarskie należy
  dostarczyć w ciągu 7 dni”, „art. 92 Kodeksu pracy”, „Jeżeli pracownik przebywa na zwolnieniu…”,
  „osobom ze znacznym lub umiarkowanym stopniem niepełnosprawności”, „Powiatowy Zespół do Spraw
  Orzekania o Niepełnosprawności”, „Poradnia Leczenia Uzależnień prowadzi terapię”, terapeuta, który
  „prowadzi terapię logopedyczną”, kadrowa, która „przyjmuje zwolnienia lekarskie”, pusta opcja
  formularza „[ ] dziecko z orzeczeniem o niepełnosprawności”, a także „zwolniony z pracy”,
  „zwolnienie warunkowe”, „po operacji bankowej” i „firma uzależniona od dostawcy”. Jawne zostają
  też zdania, w których zdrowie jest tematem pisma, a nie zdarzeniem z życia osoby („zasady wypłaty
  zasiłku chorobowego”, „Druk zwolnienia lekarskiego jest dostępny na stronie internetowej ZUS”,
  „Mam pytanie o urlop dla poratowania zdrowia”, „kolejki do psychoterapii w powiecie”, „certyfikat
  z psychoterapii”, „Czy dziecko posiada orzeczenie? TAK / NIE”), pismo, przesyłka i delegacja, które
  „trafiły do szpitala”, pobyt „jako kapelan” albo „z wizytą”, „po zabiegu usunięcia drzew”, zdania
  z „z udziałem”, „z działem płac”, „artykułem 92”, „rozdziałem 4”, pozycja przepisu, tabeli
  i pakietu przetargu („Dz. U. z 2024 r., poz. 146”, „Pakiet 2, poz. 3: endoprotezy…”), podmiot
  zbiorowy („Pracownicy obsługują e-ZLA”) i statystyka („Według danych GUS co trzeci pracownik…”).
  Osoba w zdaniu musi być tą, której zdarzenie dotyczy: urzędnik z funkcją we wtrąceniu („Pani Anna
  Nowak, kierownik działu kadr, przypomina, że zwolnienie lekarskie należy…”, „inspektor ZUS wydała
  decyzję w sprawie renty”), lekarz, logopeda i fundator („Dr Anna Kowalska zajmuje się leczeniem
  onkologicznym dzieci”, „wójt gminy ufundował pobyt w hospicjum dla samotnych mieszkańców”,
  „udostępnia salę na mityngi AA”) i autor pisma w innej roli („Mam przyjemność poinformować…”,
  „przesyłam mój raport o absencji chorobowej”, „od lat wydaję orzeczenia”, „Mam doświadczenie
  w psychoterapii”) nie są pacjentem. Jawne zostają też pobyt w szpitalu w innym celu („zgłosił się
  do szpitala z reklamacją”, „na rozmowę kwalifikacyjną”, „na staż”, „konserwator przebywał
  w szpitalu od 8:00 do 16:00, naprawiając windy”, „Teczka Pana Nowaka leży w szpitalu”), imiesłów
  przy rzeczy albo bez dopowiedzenia medycznego („Budynek był diagnozowany”, „Dron był operowany
  przez strażaka”, „Teren był napromieniowany”, „został rehabilitowany po wyroku z czasów PRL”),
  „zwolnienie dyscyplinarne”, bezosobowe „Na tym oddziale leczy się seniorów”, lek przy instytucji
  („Hurtownia przyjmuje Ibuprom”) i angielskie „a stroke of genius”, „His access was disabled”,
  „the hospital cafeteria”, „the disability pension reform”.
- **Rozpoznanie choroby znika także wtedy, gdy choroby nie ma na liście Parawana.** Po słowach, którymi
  pisma podają rozpoznanie („rozpoznano”, „zdiagnozowano u niej”, „ma rozpoznane”, „z rozpoznanym”,
  „w wywiadzie:”, „stwierdzono u powoda”, „z powodu”, „ze względu na”, „leczenie”, „skarży się na”,
  „stan po”) znika nazwa choroby do końca frazy, razem ze stopniem, dopowiedzeniem i kodem: „U
  wnioskodawczyni rozpoznano toczeń rumieniowaty układowy”, „ma rozpoznane zaburzenia ze spektrum
  autyzmu (6A02)”, „rozpoznała zespół hiperkinetyczny z zaburzeniami uwagi (F90.0)”, „z powodu
  zaawansowanej choroby otępiennej”, „z powodu depresji nawracającej (F33.1)”, „z powodu
  zwolnienia lekarskiego (grypa z powikłaniami)”, „uskarżała się na ból karku”. Nazwę choroby
  Parawan poznaje też po budowie słowa („retinopatia”, „fibromialgia”, „mukowiscydoza”, „dysleksja”,
  „niedowład”, „niedosłuch”, „demencja”), po skrócie („ADHD”, „PTSD”, „POChP”), po nazwisku w nazwie
  zespołu („zespół Aspergera”, „zespół Downa”) i po określeniu choroby albo zaburzeń („choroba
  nerek”, „zaburzenia integracji sensorycznej”, „opóźniony rozwój mowy”, „alergia na białko mleka
  krowiego”). Choroba z listy znika przy konkretnej osobie także bez słowa medycznego („Pani Tereska
  ma nadciśnienie tętnicze”, „mój syn ma autyzm”, „Babcia ma demencję”), uraz z wyrazem między nazwą
  a częścią ciała i z końcem wiersza („złamanie trzonu kości piszczelowej lewej z przemieszczeniem”,
  „stłuczenie odcinka szyjnego kręgosłupa”), wiersz pod nagłówkiem „Rozpoznanie” bez dwukropka
  w opinii poradni, kod ICD-10 z podkategorią w nawiasie i kod ICD-11 po kotwicy („rozpoznanie
  6A02”), a po angielsku „underwent treatment for acute lymphoblastic leukaemia” i „a moderate
  hearing impairment”. Zakrywana jest sama nazwa: kotwica, osoba i reszta zdania zostają. Na części
  roboczej drugiej serii zakrytych danych jest 90,1% zamiast 87,3% (dane o zdrowiu: 36 wycieków
  zamiast 74), bez nowych nadmiarowych zakryć.
- **Zespół ludzi, stwierdzenie urzędowe i przenośnia zostają jawne.** „Zespół Szkół nr 2”, „Zespół
  Zarządzania Kryzysowego”, „Zespół Pieśni i Tańca”, „zespół Nowaka rozpoznał
  problem”, „stwierdzono naruszenie przepisów”, „pęknięcie ściany nośnej”, „złamanie wału silnika”,
  „wady prawne umowy”, „Świadek rozpoznała oskarżonego”, „Sąd rozpoznał apelację”, „ma rozpoznane
  potrzeby mieszkańców”, „rozpoznano u niego talent muzyczny”, „z powodu podejrzenia popełnienia
  przestępstwa”, „W wywiadzie dla radia”, „wywiad środowiskowy”, „nieobecny z powodu choroby”,
  „skarży się na hałas”, „anemia inwestycyjna”, „alergia na biurokrację”, „diagnoza”, „prognoza”,
  „nostalgia”, „sympatia”, „glukoza”, rzeka Odra i kod niebędący kodem choroby („sala A12”, „kod
  rabatowy F32A”). Zostaje też choroba jako temat albo przy grupie („Wiele osób choruje na grypę”,
  „Objawy grypy to gorączka i kaszel”, „Dzieci z autyzmem mają prawo…”, „leczenie cukrzycy
  u dzieci”, „poradnia przyjmuje pacjentów z cukrzycą typu 1 i astmą”), specjalista od choroby
  („specjalistka od autyzmu i dysleksji”) i obserwacja zachowania bez rozpoznania („jest drażliwy
  i ma trudności z koncentracją”). „O każdej porze” nie robi już z opisu faktu przepisu. Słowa
  z polskim rdzeniem przed „-oza” nie są chorobą: „przewozy szkolne”, „odpowiada za przewozy
  pasażerskie”, „opóźnienia w przewozie”, „betonowozy i szambowozy”, „przymrozy w maju”. „Niedorozwój”
  jest chorobą tylko z rodzajem albo narządem („niedorozwój umysłowy”, „niedorozwój kończyny
  dolnej”), więc „niedorozwój sieci kanalizacyjnej”, „rynku pracy” i „komunikacji publicznej” w piśmie
  gminy zostają. Zespół z nazwiskiem po „ma” jest chorobą tylko u osoby i bez dopowiedzenia
  o pracy: „Syn ma zespół Aspergera” znika, a „Szkoła ma zespół Kubiaka do obsługi zawodów”, „Pan
  Kowalski ma zespół Kowalczyka w dziale IT” i „ma zespół Nowaka do pomocy przy inwentaryzacji”
  zostają.
- **Rozpoznanie w przepisie, regule i statystyce zostaje jawne, także po słowie „rozpoznano”.**
  Warunek („Jeżeli u dziecka zdiagnozowano autyzm, rodzice mogą złożyć wniosek”, „Gdy u pacjenta
  rozpoznano gruźlicę, lekarz zgłasza…”), zdanie o każdym takim przypadku („Uczeń, u którego
  rozpoznano dysleksję, może pisać egzamin dłużej”, „Pracownik, u którego stwierdzono chorobę
  zawodową, ma prawo do odszkodowania”, „Każdy uczeń z rozpoznanym ADHD otrzymuje dostosowanie”,
  „Osobom z rozpoznaną padaczką nie wydaje się prawa jazdy”) i dane zbiorcze („rozpoznano 312
  przypadków gruźlicy”, „wzrost zachorowań na boreliozę”) nie mówią o konkretnej osobie. Ta sama
  zasada działa dla chorób z listy („Jeżeli u dziecka zdiagnozowano astmę…”), a także dla roli
  w liczbie pojedynczej z orzeczeniem przepisu: „Pracownik z rozpoznaną depresją może skorzystać
  z urlopu”, „Pracodawca może skierować pracownika z rozpoznaną depresją na badanie”, „Kandydat
  z rozpoznaną padaczką nie może uzyskać prawa jazdy”, „Dziecku z rozpoznanym ADHD przysługuje
  pomoc”, „Pacjent z podejrzeniem udaru jest przewożony na SOR”. Przy osobie z nazwy, krewnym
  i zdarzeniu choroba dalej znika („Syn z rozpoznanym autyzmem ma prawo do asystenta”, „Pracownik
  z rozpoznaną depresją wrócił do pracy w marcu”). Zdarzenie zostaje
  zakryte: „Gdy u syna zdiagnozowano autyzm, rozpoczęliśmy terapię”, „Pacjentka, u której rozpoznano
  boreliozę, została przyjęta na oddział”. Skrót choroby w nazwie instytucji, firmy albo klubu
  („IBS PAN”, „Instytut IBS”, „klub RZS Rzeszów”, „OCD Consulting”, „Fundacja AIDS Healthcare”)
  i zespół ludzi z nazwiskiem w piśmie szpitala („pracuje w zespole Mazura na oddziale kardiologii”,
  „członek zespołu Kubiaka w przychodni”) też zostają; zespół z nazwiskiem jest chorobą po słowie
  rozpoznania albo przyczyny i przy osobie, która go ma („rozpoznano zespół Downa”, „ze względu na
  zespół Aspergera”, „dziecko z zespołem Retta”).
- **Lek, który osoba przyjmuje, znika także bez dawki i spoza słownika Parawana.** Po czasowniku
  przyjmowania albo zlecenia („przyjmuje”, „zażywa”, „stosuje”, „bierze”, „otrzymuje”, „jest na”,
  „włączył”, „ordynowano”, „zalecił mu”, „przepisano”) znika nazwa substancji, którą Parawan poznaje
  po końcówce międzynarodowej nazwy leku (-pryl, -sartan, -olol, -statyna, -prazol, -azepam,
  -mycyna, -paryna, -fenidat i podobne): „Chłopiec przyjmuje metylofenidat”, „lekarz włączył
  metylofenidat”, „Podopieczny stosuje rysperydon”, „Wnioskodawczyni bierze kwetiapinę
  i klonazepam”. Znika też insulina i metadon („chcą, żeby brała insulinę”, „Ojciec jest na
  insulinie”, „Matka przyjmuje metadon”), grupa leków przy osobie („Małoletni otrzymuje leki
  przeciwpadaczkowe”, „przyjmuje leki przeciwpsychotyczne (olanzapina)”, „zasiłek na zakup leków
  przeciwpadaczkowych po wypisie ze szpitala”) i nazwa handlowa po postaci leku albo po „zażywa”
  („zażywa tabletki Relanium”). Droga podania przy dawce wystarcza obok samej osoby albo samego
  słowa medycznego i znika razem z dawką („Pan Nowak: Enoksaparyna 40 mg s.c. raz dziennie”,
  „Pacjentowi ordynowano haloperydol 5 mg i.m.”), podobnie jak dawkowanie „2 razy w tygodniu”.
  Kolejny lek w wyliczeniu po zakrytym leku znika razem z nim („na insulinie aspart i glarginie”,
  „metformina 850 2x dziennie i insulina glargine wieczorem, kod recepty przyjdzie smsem”). Na
  części roboczej drugiej serii zakrytych danych jest 90,7% zamiast 90,1% (dane o zdrowiu: 28
  wycieków zamiast 36), bez nowych nadmiarowych zakryć.
- **Lek znika też w szyku, przeczeniu i zapisie zlecenia z karty.** Przysłówek i droga podania przed
  lekiem nie przerywają rozpoznania, a droga podania znika razem z lekiem („Brała wcześniej
  fluoksetynę”, „Zalecono mu doustnie amoksycylinę”, „Pani X stosuje dopochwowo progesteron”).
  Znika lek w zleceniu bezosobowym albo z drogą podania („Włączono enoksaparynę s.c. raz dziennie”,
  „Odstawiono klonazepam z powodu senności”, „Lekarz ordynował furosemid dożylnie”), lek przed
  czasownikiem („Kwetiapinę przyjmuje od roku”), po przeczeniu i czasowniku fazowym („nie przyjmuje
  regularnie przepisanej olanzapiny”, „Przestała brać leki przeciwpsychotyczne”, „Matka nie podaje
  dziecku leków przeciwpadaczkowych”), po recepcie i zaleceniu przyjmowania („Wypisano receptę na
  rywaroksaban”, „zalecono przyjmowanie sertraliny”, „kontynuację leczenia pantoprazolem”), lek po
  zakrytym leczeniu w całości („jest leczona lamotryginą”) i w wyliczeniu („przyjmuje kwas foliowy
  i lewotyroksynę”, „wenlafaksynę, obecnie duloksetynę”). Parawan poznaje więcej substancji po
  budowie nazwy (cefalosporyny „cef-”, „-wir”, „-mab”, „-nib”, „-zonid”, „-nizon”, sól „walproinian
  sodu”, tamsulosyna, heparyna), grupę leków po przedrostku („leki przeciwretrowirusowe”, „tabletki
  antykoncepcyjne”, „na sterydach wziewnych”, „leki na serce”), postać leku z substancją („inhalator
  z salbutamolem”) i lek w zdaniu angielskim pisma dwujęzycznego („The patient is taking sertraline”,
  „He is on antidepressants”).
- **Postać leku bez nazwy leku i tekst o leku bez pacjenta zostają jawne.** Wyraz z wielkiej litery po
  słowach „tabletki”, „kapsułki”, „syrop”, „lek” nie wystarcza: „Klient dostaje kapsułki Nespresso”,
  „Dziecko bierze tabletki Haribo”, „Pan Nowak przyjmuje lek Ministerstwa jako dowód”. Potrzebna jest
  nazwa leku albo kotwica medyczna. Dawkowanie z ChPL, ulotki, standardu, wykazu i załącznika
  przetargowego zostaje („Dawkowanie według ChPL: Clexane 40 mg s.c. raz na dobę u dorosłych”), tak
  samo zdanie o grupie i z raportu („Po wypisie ze szpitala pacjenci często otrzymują leki
  przeciwzakrzepowe, wynika z raportu”, „Na oddziale pacjentom podawano heparynę”, „Statyny przyjmuje
  co trzeci Polak”) i czasownik bez leku („przestał brać udział”, „podaje mu obiad”, „Zalecono mu
  doustnie wodę”, „Wypisano receptę na nazwisko córki”).
- **Czasownik bez leku, instytucja i obrót lekami zostają jawne.** „Urząd przyjmuje interesantów”,
  „stosuje się przepisy”, „bierze udział w szkoleniu”, „Zalecono uzupełnienie wniosku”, „Podano do
  publicznej wiadomości”, „Wójt przyjmuje Pana Kowalskiego”, „Sołtys otrzymuje Order Uśmiechu”,
  „Dyrektor jest na urlopie”, „zażywa kąpieli słonecznych”, „p.o. dyrektora”, „bierze platynę
  z magazynu”, „aspartam”. Zostaje lek przy instytucji i w obrocie („Szpital stosuje enoksaparynę
  u pacjentów”, „Apteka przyjmuje recepty na leki przeciwdepresyjne”, „kradzież leków
  psychotropowych z apteki przez Jana Kowalskiego”, „obrót lekami psychotropowymi”, „Refundacja leków
  przeciwpadaczkowych dla dzieci”) i w zdaniu ogólnym („Wiele osób przyjmuje leki przeciwdepresyjne”,
  „Kto przyjmuje insulinę, powinien mieć glukometr”, „Pacjent może przyjmować leki przeciwzakrzepowe
  tylko pod kontrolą”).
- **Komunikat o leku, nazwa ubezpieczyciela i sprawozdanie z badania zostają jawne.** Lek z dawką
  „bez recepty” albo „na receptę” to kategoria leku z komunikatu GIF, ulotki czy ogłoszenia apteki
  („Paracetamol 500 mg jest dostępny bez recepty”, „Lek Xanax 0,5 mg wydaje się wyłącznie na
  receptę”). Recepta wskazuje lek osoby dopiero przy tej osobie albo jako jej recepta („kod recepty
  przyjdzie smsem”, „odebrała e-receptę na Concor 5 mg”). Nazwa leku ze słownika znika tylko
  w swojej odmianie, więc „Concordia” w piśmie o rencie czy odszkodowaniu zostaje („Concordia
  odmówiła”, „Concordia Ubezpieczenia potwierdziła polisę”), a „na Concorze” dalej znika. Lek, po
  którym stoi orzeczenie, zaczyna nowe zdanie i nie jest pozycją wyliczenia („Uczeń otrzymał
  pochwałę, penicylina była tematem referatu”, „przyjmuje interesantów i petentów, statyny są
  w szafce”). Zostaje też zlecenie bezosobowe w sprawozdaniu, kontroli i badaniu („W badaniu
  klinicznym włączono metforminę u 300 pacjentów”, „W programie podawano sertralinę 140
  uczestnikom”, „Kontrola NIK: w szpitalu podawano morfinę bez zlecenia”). Wszystkie leki
  wyliczenia przy osobie znikają razem („bierze sertralinę, lamotryginę i insulinę”).
- **Długie pismo bez kropek z wieloma nazwami chorób nie spowalnia już redakcji.** Wiersz z tysiącami
  nazw chorób, tabela JSON z opisami zdrowia albo długi log z adresami IP i liczbami przechodzi kilka
  do kilkunastu razy szybciej. Wynik redakcji jest taki sam jak wcześniej.
- **Sygnatura wyroku NSA, WSA, Sądu Najwyższego, TK, KIO albo TSUE, na który urząd się powołuje,
  zostaje jawna, także po „sygn. akt”.** W uzasadnieniu decyzji czy odpowiedzi na skargę AI widzi
  teraz, które orzeczenie przywołano: „Stanowisko to potwierdza wyrok NSA z dnia 12 maja 2021 r.,
  sygn. akt II OSK 2408/18” zostaje bez zmian (wcześniej „sygn. akt [ZNAK-SPRAWY]”), tak samo
  „WSA w Poznaniu w wyroku …, sygn. akt II SA/Po 1001/19, stwierdził, że…”, „SKO w Rzeszowie odwołuje
  się do wyroku NSA …”, „Kwestia ta była przedmiotem uchwały siedmiu sędziów NSA …, sygn. akt I FPS
  1/20”, „(por. wyrok …, sygn. akt KIO 3871/23)”, wyrok TK „sygn. akt K 38/13” i TSUE „sygn. C-615/21”.
  Zdanie musi zapowiadać cytat przed sygnaturą albo po niej („por.”, „podobnie”, „stanowisko”,
  „przywołuje”, „według”, „jak wynika z”, „stwierdził, że”). Sygnatura sądu rejonowego, okręgowego
  i apelacyjnego (C, Ns, Nsm, RC, K, W, U, GU, Co, Ca, ACa, AKa, AUa) dalej znika, bo wskazuje sprawę
  konkretnej osoby: „Jak wskazał Sąd Rejonowy …, sygn. akt [ZNAK-SPRAWY], władza rodzicielska …”.
  Znika też sygnatura NSA czy WSA, gdy w tym samym zdaniu jest osoba albo jej sprawa („…, sygn. akt
  [ZNAK-SPRAWY], skarga Janiny Pawlak była niezasadna”, „Szanowny Panie, jak wskazał NSA …”,
  rozstrzygnięcie, rola strony, „do akt sprawy przekazano m.in. wyrok …”), także po łamaniu wiersza
  z PDF-u, oraz gdy zdanie obok łączy osobę z wyrokiem albo skargą („Pani Ewa Wróbel złożyła
  skargę na decyzję. Jak wskazał WSA …, sygn. akt [ZNAK-SPRAWY], …”). Na trzeciej serii pism (część
  robocza) nadmiarowych zakryć jest 53 zamiast 64, na drugiej 34 zamiast 37, bez nowych wycieków.
- **Adres urzędu pod nagłówkiem z organem zostaje jawny, tak samo nazwa własna w nazwie
  instytucji.** Pismo zaczynające się od „WÓJT GMINY KOBYLNICA⏎ul. Główna 20, 76-251 Kobylnica”
  zostaje bez zmian (wcześniej „[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]”), tak samo pod „STAROSTA
  KŁODZKI”, „BURMISTRZ MIASTA I GMINY NIEPOŁOMICE”, „KIEROWNIK URZĘDU STANU CYWILNEGO W KIELCACH”,
  „Państwowy Powiatowy Inspektor Sanitarny”, „Zastępca Wójta Gminy”, „Sekretarz Gminy”, „Komendant
  Straży Miejskiej”, pod komórką („Sekcja Świadczeń Rodzinnych”) i pod adresatem w dwóch wierszach
  („Dyrektor⏎Przedszkola Publicznego nr 33 w Rzeszowie⏎al. Tadeusza Rejtana 3”). Numer budynku
  z półpauzą („ul. Koraszewskiego 7–9”) też liczy się jako adres siedziby. Organ z przymiotnikiem od
  powiatu albo województwa to urząd, także gdy strona ma to samo nazwisko: „Pan [IMIĘ I NAZWISKO]
  … oceni Starosta Słupski” (wcześniej „Starosta [IMIĘ I NAZWISKO]”), „do Wojewody Mazowieckiego”,
  „Starosta Tarnowski”. Zostaje patron i kraina w nazwie („na Uniwersytecie Mikołaja Kopernika”,
  „Stowarzyszenie Przyjaciół Ziemi Krzeszowickiej”, „Szkoła Podstawowa Marii Konopnickiej”: tylko
  znana postać, bo „Pacjent Szpitala [IMIĘ I NAZWISKO]” czy „dyrektor Szkoły Podstawowej [IMIĘ
  I NAZWISKO]” to osoba w roli przy placówce), miejscowość o brzmieniu nazwiska, gdy pismo
  nazywa ją miejscowością („Szkoła Podstawowa … w Mielniku”, „Mielnik, 18 sierpnia 2026 r.”, „17-307
  Mielnik”), i siedziba w zdaniu („Spółdzielni Mieszkaniowej „Słoneczny Stok” z siedzibą przy ul.
  Henryka Sienkiewicza 54”, „w siedzibie przedszkola przy ul. Kasztanowej 14”). Dalej znika adres
  pod stanowiskiem w firmie albo funkcją bez urzędu („Kierownik Budowy”, „Dyrektor Handlowy”,
  „Inspektor Nadzoru”, „Kurator”), pod organem z nazwiskiem („Burmistrz Kowalski”, „Dyrektor Jan
  Kowalski”), siedziba firmy osoby („Jan Kowalski, prowadzący działalność … z siedzibą przy ul.
  Polnej 3”, „Szkoła Jazdy Lis z siedzibą przy [ADRES]”, „Wykonawca: Zakład Instalacyjny Kozioł
  z siedzibą przy [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]”, „[IMIĘ I NAZWISKO], Zakład Usług
  Remontowych z siedzibą przy [ADRES]”) oraz nazwisko po roli osoby („Sędzia Tarnowski”,
  „Starosta Kowalski”). Siedzibę w zdaniu daje tylko nazwa urzędu, sądu, spółdzielni albo placówki
  z numerem lub przymiotnikiem organu, bez osoby w tym samym zdaniu; adres kończący zdanie zostaje
  jawny także wtedy, gdy następne zdanie wymienia stronę („… w siedzibie Urzędu Gminy w Baranowie
  przy ul. Rynek 14. Pani [IMIĘ I NAZWISKO] przedstawi wniosek.”). Imię i nazwisko
  urzędnika pod nagłówkiem dalej znika. Na trzeciej serii pism (część robocza) nadmiarowych zakryć
  jest 31 zamiast 53, na drugiej 31 zamiast 34, bez nowych wycieków.
- **Gmina, powiat czy urząd jako strona umowy zostaje jawna razem z adresem, NIP-em i REGON-em,
  a druga strona dalej znika.** Umowa „zawarta pomiędzy: Gminą Pszczyna, ul. Rynek 2, 43-200
  Pszczyna, reprezentowaną przez Zastępcę Burmistrza Pszczyny…” zostaje bez zmian (wcześniej „Gminą
  [MIEJSCOWOŚĆ], [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]”), tak samo „Gminą Miasta Sanoka, Rynek 1,
  38-500 Sanok, NIP 3871652842”, „Urzędem Miejskim w Kórniku, pl. Niepodległości 1, 62-035 Kórnik,
  NIP …, REGON …”, „Powiatem Kłodzkim”, „Miastem Stołecznym Warszawa”, „Skarbem Państwa – Starostą
  Kłodzkim” i „Gmina Kobylnica, ul. …, reprezentowana przez Wójta”. Druga strona umowy znika jak
  dotąd: „a Panią [IMIĘ I NAZWISKO], [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ], NIP [NIP]”, także firma
  osoby („BK-CATERING [IMIĘ I NAZWISKO], [ADRES], …, NIP [NIP]”, „Szkoła Jazdy Lis, [ADRES]”). Sama
  „Gmina Kobylnica” nad adresem albo przed nim, bez reprezentanta, dalej liczy się jako część adresu
  osoby.
- **Nazwa urzędu w środku wiersza też odsłania jego adres.** Adres zostaje jawny po dwukropku („Do
  wiadomości: Zarząd Mienia Komunalnego, ul. Jana Klemensa Branickiego 3/5”, „Miejsce składania: Urząd
  Miejski w Kartuzach, ul. Jana Pawła II 1”), po numerze punktu („4. Starostwo Powiatowe w Wieliczce,
  Wydział Geodezji, Kartografii i Katastru, ul. Józefa Piłsudskiego 25”), po przecinku („pok. 12, Urząd
  Miejski w Andrychowie, ul. Rynek 15”), za stanowiskiem urzędnika („[IMIĘ I NAZWISKO], inspektor ds.
  oświaty, Urząd Gminy Mielnik, ul. Piaskowa 1”), w zdaniu („przekazano do Samodzielnego Publicznego
  Zakładu Opieki Zdrowotnej w Kole, ul. Szpitalna 1”) i w kolumnie tabeli obok nazwy urzędu („| Urząd
  Skarbowy w Gliwicach | ul. Góry Chełmskiej 15, Gliwice |”). Rynek bez „ul.” („Rynek 1”) też jest
  adresem. Adres dalej znika, gdy przed nazwą stoi osoba bez stanowiska („Adresat: [IMIĘ I NAZWISKO],
  Urząd Gminy Kobylnica, [ADRES]”), gdy osoba stoi w tym samym zdaniu („…, [ADRES], przez Pana [IMIĘ
  I NAZWISKO]”), w kolumnie adresu ucznia obok szkoły i przy firmie osoby („Zakład Stolarski [IMIĘ
  I NAZWISKO], [ADRES]”). Na trzeciej serii pism (część robocza) nadmiarowych zakryć jest 16 zamiast
  31, na drugiej 20 zamiast 31, bez nowych wycieków.
- **Kolegium odwoławcze, KRUS, straż miejska, biblioteka, centrum pomocy rodzinie i spółka komunalna
  to też urzędy, w każdym przypadku.** Zostaje jawne „Sprawę skierowano do Samorządowego Kolegium
  Odwoławczego w Siedlcach, ul. Piłsudskiego 38, 08-110 Siedlce” (wcześniej „… w [MIEJSCOWOŚĆ],
  [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]”), tak samo „Kasa Rolniczego Ubezpieczenia Społecznego Oddział
  Regionalny w Rzeszowie, ul. Partyzantów 12”, „Straż Miejska w Bydgoszczy, ul. Bernardyńska 14”,
  „Gminna Biblioteka Publiczna w Jabłonnej”, „Powiatowe Centrum Pomocy Rodzinie w Sokółce”, „umowa
  z Miejskim Przedsiębiorstwem Komunikacyjnym sp. z o.o., ul. Kasprzaka 2”, „Przedsiębiorstwo
  Wodociągów i Kanalizacji”, „Pomiędzy Powiatem Bialskim, …, REGON 030237366” i „W imieniu Gminy
  Miasta Radomia, ul. Kilińskiego 30, …, NIP 7962839123”.
- **NIP i adres osoby obok urzędu dalej znikają.** Osoba na liście za urzędem nie dostaje jego
  statusu: „Urząd Skarbowy w Kole, ul. Toruńska 10, [IMIĘ I NAZWISKO], NIP [NIP]”. Gabinet, studio,
  zakład usługowy, dom weselny czy centrum urody z samą miejscowością po „w” to działalność osoby,
  więc znika NIP i adres („Zakład Fryzjerski w Kole, [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ], NIP
  [NIP]”, „Gabinet Weterynaryjny w Kole, [ADRES], …”). Przy instytucie, ośrodku czy przychodni
  z samą miejscowością znika NIP („Instytut Urody w Kole, ul. Polna 3, NIP [NIP]”). Jawny zostaje
  NIP szkoły z numerem i spółki komunalnej. W tabeli adres znika, gdy
  w wierszu przed urzędem stoi osoba albo kolumna nazywa się „Adres zamieszkania” czy „Adres do
  korespondencji” („| [IMIĘ I NAZWISKO] | Urząd Gminy Mielnik | [ADRES], [KOD-POCZTOWY]
  [MIEJSCOWOŚĆ] |”), a „mieszkaniec Gminy Kobylnica, [ADRES]” zostaje zakryty.
- **Słowo z nazwy usługi komunalnej nie robi z firmy osoby urzędu.** Jawna zostaje tylko stała nazwa
  jednostki, na której nazwa się kończy: „Zakład Gospodarki Komunalnej w Kole, ul. Polna 3”, „Zakład
  Ubezpieczeń Społecznych Oddział w Kole”, „Przedsiębiorstwo Wodociągów i Kanalizacji”, „Ośrodek Sportu
  i Rekreacji”, „Dom Kultury”, „Zakład Komunalny w Kole”. Firma z takim słowem w nazwie dalej znika
  razem z adresem i NIP-em: „Zakład Usług Komunalnych „Czysto”, [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ],
  NIP [NIP]”, tak samo „Centrum Kultury Fizycznej „Atleta””, „Studio Komunikacji Wizualnej”, „Przychodnia
  Opieki Zdrowotnej „Rodzina”” i „Zakład Wodociągów i Kanalizacji Usługi”.
- **Adres osoby w gminie przy jej pełnomocniku dalej znika.** „Skarżąca [IMIĘ I NAZWISKO] (Gmina
  Kobylnica, [ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]), reprezentowana przez adw. [IMIĘ I NAZWISKO]”
  i „Skarżący [IMIĘ I NAZWISKO]; Gmina Kobylnica, [ADRES], reprezentowany przez radcę prawnego”: gmina
  jest stroną tylko wtedy, gdy „reprezentowana” zgadza się z nią rodzajem i przed nią nie stoi osoba.
- **Telefon, e-mail i rachunek urzędu zostają jawne, więc AI może je wpisać do odpowiedzi.** Numer
  pod nagłówkiem urzędu („Urząd Gminy Firlej, ul. Szkolna 2, 21-136 Firlej⏎tel. 81 856 40 12,
  podatki@firlej.example.pl”, wcześniej „tel. [TELEFON], [EMAIL]”), za etykietą („Sekretariat: tel.
  22 123 45 67”, „Centrala, tel. …”, „tel. sekretariatu: …”, infolinia 800 i 801) i przy komórce urzędu
  z numerem wewnętrznym („Referat Organizacyjny, tel. 61 817 04 11 wew. 34”) zostaje jawny, także
  w kolejnych wystąpieniach w piśmie. Skrzynka funkcyjna zostaje w domenie urzędu albo szkoły
  („sekretariat@sp2.kartuzy.pl”, „iod@um.gliwice.pl”), pod nagłówkiem, przy nazwie komórki („Do:
  Wydział Finansowy <finanse@example.pl>”) i po „ogólny adres”. Rachunek przy nazwie urzędu też: „na
  rachunek Gminy Firlej nr 78 1160 2202 6163 7497 8486 2063”, „na rachunek Starostwa Powiatowego
  w Kłodzku nr …”, „na rachunek Miasta Gliwice nr …”, „na rachunek urzędu nr …” (wcześniej „nr
  [NR-KONTA]”). Na trzeciej serii pism (część robocza) nadmiarowych zakryć jest 2 zamiast 16, na
  drugiej 17 zamiast 20, bez nowych wycieków.
- **Telefon, e-mail i rachunek osoby obok urzędu dalej znikają.** Komórka w nagłówku urzędu, imienny
  adres w domenie urzędu („a.siwiec@starakamionka.example.pl”) i numer przy nazwisku pracownika bez
  numeru wewnętrznego („Sprawę prowadzi: [IMIĘ I NAZWISKO], Referat Podatków, tel. [TELEFON]”,
  „[IMIĘ I NAZWISKO], inspektor, Urząd Gminy Mielnik, ul. Piaskowa 1, tel. [TELEFON]”) zostają
  zakryte. Numer pracownika zostaje zakryty także wtedy, gdy jego imię i nazwisko stoi w wierszu nad
  komórką („Z poważaniem⏎[IMIĘ I NAZWISKO]⏎Inspektor⏎Wydział Komunikacji, tel. [TELEFON]”) albo za
  numerem („tel. [TELEFON] ([IMIĘ I NAZWISKO])” pod numerem centrali, który zostaje jawny). Skrzynka
  z nazwiskiem albo imieniem w domenie znika przy każdej nazwie skrzynki i w każdej domenie poza
  gov.pl: „biuro@korepetycje-kowalska.edu.pl”, „biuro@przedszkole-nowak.pl”, „komunikacja@kowalski.pl”
  i „biuro@annanowak.pl” dają „[EMAIL]”. Gmina o nazwie równej nazwisku („Urząd Gminy Mielnik,
  ul. Piaskowa 1, 17-307 Mielnik, e-mail: gmina@mielnik.pl”) zostaje jawna, bo ta sama nazwa stoi
  w nagłówku urzędu jako miejscowość. Rachunek strony („na rachunek
  Rodzica nr [NR-KONTA]”, „na rachunek bankowy wnioskodawczyni nr [NR-KONTA]”, „na mój rachunek”),
  indywidualny rachunek podatnika („na indywidualny rachunek Gminy Firlej nr [NR-KONTA]”, „…,
  przypisany podatnikowi”) i rachunek wynajmującego czy dzierżawcy znikają jak dotąd.
- **Skrzynka z nazwiskiem pisanym bez polskich znaków, subkonto podatnika i numer urzędnika z podpisu
  nad adresem urzędu dalej znikają.** Domena zawsze jest bez ogonków, więc nazwisko i imię w niej
  porównujemy z ich zapisem bez polskich znaków, a nazwisko spoza słownika rozpoznajemy po końcówce:
  „Urząd Gminy Firlej, e-mail: sekretariat@wisniewski.pl”, „komunikacja@zielinski.pl”,
  „biuro@lukaszkaminski.pl”, „biuro@krol.pl”, „biuro@przedszkole-wrzesniewska.pl” i
  „biuro@sad-brzeczyszczykiewicz.pl” dają „[EMAIL]”, także przy członie szkoły, przedszkola czy sądu.
  Skrzynka powiatu z jego nazwą („kancelaria@powiatleczynski.pl” pod nagłówkiem starostwa) zostaje
  jawna. Subkonto i rachunek z zaimkiem adresata przy nazwie gminy znikają: „na rachunek Gminy Firlej
  nr [NR-KONTA] (subkonto podatnika)”, „…: [NR-KONTA] – jest to Pana numer subkonta”, „Numer Pana
  konta podatkowego: rachunek Gminy Firlej [NR-KONTA]”, „nr [NR-KONTA] (subkonto [IMIĘ I
  NAZWISKO])”; „W odpowiedzi na Pana wniosek … na rachunek Gminy Firlej nr 78 1160 …” zostaje jawne.
  Numer z osobą dalej w tym samym wierszu znika także za pokojem, godzinami czy wersalikami
  („Wydział Komunikacji, tel. [TELEFON], pok. 12, [IMIĘ I NAZWISKO]”, „tel. [TELEFON] – [IMIĘ
  I NAZWISKO]” zamiast jawnego numeru przy „ANNA NOWAK”), a numer urzędnika pod podpisem także nad
  adresem z ulicą („Zbigniew Pawlak⏎Kierownik Referatu⏎Urząd Miasta Kalisza, ul. Główny Rynek 20,
  tel. 62 765 43 21” daje „tel. [TELEFON]”). Nagłówek urzędu bez podpisu nad nim i numer z numerem
  wewnętrznym zostają jawne.
- **Numer uprawnień budowlanych, numer członka izby i wpis tłumacza, geodety czy rzeczoznawcy
  znikają przy osobie tak jak PWZ.** Wcześniej w decyzji o pozwoleniu na budowę, operacie
  i protokole zostawały jawne numery projektantów i biegłych. Teraz „mgr inż. Adam Kos,
  uprawnienia nr SLK/0456/POOK/10, członek Śląskiej Okręgowej Izby Inżynierów Budownictwa nr
  SLK/BO/7781/11” daje „mgr inż. [IMIĘ I NAZWISKO], uprawnienia nr [NR-UPRAWNIEŃ], członek …
  nr [NR-UPRAWNIEŃ]”. Tak samo znikają „nr ewid. upr. SLK/1234/POOK/08”, „IARP nr 1234”,
  „członek MOIIB pod nr MAP/BO/1234/05”, numer uprawnień geodety i rzeczoznawcy majątkowego
  („uprawnienia nr 23011”, „świadectwo nadania uprawnień zawodowych nr 15873”, „nr upr. 23456”),
  wpis tłumacza przysięgłego („nr wpisu na listę TP/0912/15”), biegłego rewidenta i doradcy
  podatkowego, wpis radcy i adwokata za wtrąceniem („(Okręgowa Rada Adwokacka w Lublinie, nr
  wpisu LUB/Adw/0457)”, „r. pr. Jan Kot (wpis GD-1287)”), świadectwo kwalifikacyjne, licencja
  zawodowa i legitymacja studencka. Znika też numer w tabeli zespołu projektowego wklejonej
  z Worda albo Excela (kolumna „Nr uprawnień” czy „Nr członka izby”, komórki rozdzielone TAB-em,
  średnikiem albo kreską), numer zapisany wersalikami („UPRAWNIENIA BUDOWLANE NR PDK/0444/PWOS/12”),
  numer przed podpisem po myślniku albo w nawiasie („nr 9876 (zakres 1)”, „… – mgr inż. Adrian
  Łoś”), „nr członkowski”, „nr w rejestrze”, „numer na liście tłumaczy” i „(IARP 2231)” zaraz po
  osobie. Numer musi stać przy zawodzie w tym samym wierszu, więc jawne zostają przepisy („art. 12
  ust. 1”), decyzja i uchwała („Decyzja o nadaniu uprawnień nr 12/2024”, „Uchwała nr XII/123/2024
  w sprawie uprawnień”), adres i komunikat izby („Okręgowa Izba Radców Prawnych, ul. Długa nr
  125”, „Komunikat Okręgowej Izby Lekarskiej nr 12/2024”), dokument i wydarzenie izby bez osoby
  („posiedzenie ORA nr 12/2024”, „szkolenie KIDP nr 2024/05”, „okólnik OIRP nr 3/2024”), wpis do
  rejestru aptek, placówek czy OSK, wpis w dzienniku budowy („kierownik budowy – wpis nr 1235”),
  uprawnienia pracowników urzędu do systemu i do podpisu („Naczelnik Wydziału Architektury
  i Budownictwa, uprawnienia do podpisu nr 4/2025”, „Wydział Geodezji i Kartografii, uprawnienia
  dostępu nr 3/2025”), umowa, świadectwo pracy i świadectwo charakterystyki energetycznej.
  Kolumna „Nr uprawnień”, „Nr członka” albo „Uprawnienia” liczy się tylko w wierszu z osobą
  albo zawodem, więc wykaz działek („Lp.⇥Nr ewidencyjny⇥Obręb⇥Powierzchnia”, „123/4”), środków
  trwałych, pojazdów i jednostek OSP czy spółdzielni zostaje jawny. Jawne zostają też znak sprawy
  i numer umowy w kształcie numeru uprawnień („Sprawa OR/0456/POW/24”, „Umowa nr
  RPO/0123/POIS/2021”), dokument izby dla członków i nazwa komórki przed skrótem izby („Ankieta
  dla członków PIIB nr 2/2026”, „Biuro Architektury i Planowania Przestrzennego (MOIA nr 12/2024
  – stanowisko)”), stanowisko urzędu („Geodeta Powiatowy, uprawnienia nr 3/2025 do PZGiK”) i wpis
  do ewidencji placówek. Na
  trzeciej serii 50 pism (część robocza) wycieków jest 142 zamiast 158, bez nowych nadmiarowych
  zakryć.
- **Tabela wklejona z Worda jako tekst znika w każdym wierszu, także bez linii „---” pod
  nagłówkiem.** Wcześniej tabelę z kreskami „|” Parawan rozpoznawał tylko w zapisie Markdown
  (kreski na obu końcach i wiersz „---”), więc w protokole komisji rekrutacyjnej czy liście
  kandydatów zostawały jawne daty urodzenia i część osób. Teraz „Lp. | Nazwisko i imię | Data
  urodzenia | Pkt” z wierszem „3 | Czerniak Zofia | 22.11.2022 | 165” daje „3 | [IMIĘ I NAZWISKO] |
  [DATA-URODZENIA] | 165”. Tak samo działają kolumny wyrównane spacjami (kopia z PDF-a), kolumna
  nazwana rolą („Kandydat”, „Uczeń”, „Wnioskodawca”, „Pracownik”), nagłówek „Imię i nazwisko
  ucznia” i telefon stacjonarny w kolumnie „telefon” („H. Gąsienica-Ryś | 33 874 12 09” →
  „[IMIĘ I NAZWISKO] | [TELEFON]”). W tabeli, w której Parawan rozpoznał osobę, znika też osoba
  z jednym inicjałem („H. Gąsienica-Ryś”) i osoba spoza słownika imion („Liu Wei”), ta druga tylko
  w wierszu z PESEL-em o poprawnej sumie albo z datą urodzenia. Jawne zostają kolumny bez danych
  osoby (punkty, kryteria, data decyzji, kwota, stanowisko) i podmioty w kolumnie osób, także na
  liście „Imię i nazwisko albo nazwa” beneficjentów czy kontrahentów: „MOPS Lipno”, „Eko Trans”,
  „Czyste Powietrze”, „Armii Krajowej”, „Hotel Zamek”, „F.H. Marex”, „Nadleśnictwo Lipno”,
  „Samorządowe Kolegium Odwoławcze”. Stanowisko w kolumnie osób („Starszy Referent”, „Kierowca
  Autobusu”, „Tłumacz Przysięgły”, „Sołtys Zalesia”) zostaje jawne także w tabeli CSV, gdzie
  wcześniej „Sołtys Zalesia;dieta” pod „Nazwisko i imię” dawało „[IMIĘ I NAZWISKO];dieta”, a numer
  telefonu w wierszu stanowiska zostaje razem z nim. Pod nagłówkiem roli („Wnioskodawca”,
  „Najemca”, „Beneficjent”, „Podatnik”, „Uczestnik”) w urzędzie stoją też firmy i organizacje,
  więc osobę potwierdza tam dopiero komórka złożona z samych imion, nazwisk ze słownika
  i inicjałów: „Kwiaciarnia Róża;lokal 4;54 288 33 12”, „Pensjonat Agata”, „Chór Cecylia”, „Bar
  Mleczny Basia” zostają jawne, a z nimi telefon podmiotu, a w „F.H.U. Marex Jan Nowak” znika
  tylko „Jan Nowak”. Nazwisko utworzone od funkcji w szyku „Nazwisko Imię” znika w całości:
  „Wójtowicz Natan;02070803628” i „Sołtysik Teofil” dają „[IMIĘ I NAZWISKO]”, nie „[IMIĘ
  I NAZWISKO] Natan”, a w wierszu z datą urodzenia także „Marszałek Wit” i „Kanclerz Iwo”. Tabela
  bez kolumny osoby („Lp. | Nazwa podmiotu | Kwota”) się nie zmienia. Na
  trzeciej serii 50 pism (część robocza) wycieków jest 126 zamiast 142, bez nowych nadmiarowych
  zakryć.
- **Inicjały pracownika w metryce i rejestrze z EZD znikają: w dekretacji, w kolumnie „Prow.”
  i w legendzie skrótów.** Wcześniej „Dekretacja: Kierownik Referatu → MK” zostawiało inicjały
  inspektor, choć jej pełne imię i nazwisko stało wiersz wyżej przy „Prowadzący:”, a w rejestrze
  korespondencji wklejonym z Excela kolumna „Prow.” z „ES” i „TB” zostawała jawna razem z legendą
  „Skróty w kolumnie Prow.: ES – Ewa Szołtysek”. Teraz to „Dekretacja: Kierownik Referatu →
  [IMIĘ I NAZWISKO]”, „… | [IMIĘ I NAZWISKO]” w kolumnie i „[IMIĘ I NAZWISKO] – [IMIĘ
  I NAZWISKO]” w legendzie. W kolumnie „Prow.”, „Prowadzący”, „Referent” albo „Załatwiający”
  inicjały znikają tylko wtedy, gdy w piśmie jest osoba o tych inicjałach, bo w wykazach
  i rejestrach stoi tam często organ albo komórka prowadząca: „Prowadzący | US”, „Prowadzący |
  GK” przy znaku „GK.6220.1.2026” i „Referent | UM” zostają bez zmian. Bez osoby w piśmie dwie
  wersaliki zakrywa tylko kolumna „Osoba prowadząca”, „Pracownik prowadzący” albo „Pracownik”,
  w której wszystkie komórki to inicjały, bez skrótu instytucji i bez symbolu komórki z tego
  pisma; „ND”, „BD” i „TAK” zostają. Po strzałce dekretacji, po „Dekretacja:”, „Zadekretowano
  do:”, „Przydzielono do:”, „wg właściwości:” i w kolumnach „Ref.” i „Dekretacja” inicjały,
  także z kropkami, znikają tylko przy osobie z pisma, bo tam stoi też komórka albo organ:
  „Dekretacja: Sekretarz → OR → OR.I, wg właściwości: WOŚ/RGK” i „Przekazano wg właściwości:
  U.S.C.” zostają bez zmian. Jawne zostają też symbole JRWA, kategorie archiwalne („A”, „B5”,
  „BE10”), skróty ustaw („KPA”, „K.P.A. art. 35”, „KC”, „UODO”) i strzałka poza dekretacją
  („Warszawa → Kraków”, „etap I → II”). Symbol komórki z tego pisma wygrywa ze stroną o tych
  samych inicjałach: przy wnioskodawcy Grzegorzu Kowalu i znaku „GK.6220.1.2026”
  „Dekretacja: Burmistrz → GK”, kolumna „Referent | GK” i „Kierownik Referatu GK – [IMIĘ
  I NAZWISKO]” w legendzie zostawiają symbol referatu jawny. Skrót jednostki w polu „Sprawę
  prowadzi:” albo „Referent:” też zostaje: „Sprawę prowadzi: Z.G.K. w Pucku” i „Referent: W.Z.D.
  (Wojewódzki Zarząd Dróg)” bez zmian, a „Sprawę prowadzi: A.S., tel. wew. 21” daje
  „[IMIĘ I NAZWISKO], tel. wew. 21”. Na
  trzeciej serii 50 pism (część robocza) wycieków jest 116 zamiast 126, bez nowych nadmiarowych
  zakryć.
- **Numer prawa jazdy, dowodu, paszportu, KRS i aktu stanu cywilnego znika także wtedy, gdy między
  nazwą dokumentu a numerem stoi wtrącenie.** Wcześniej „prawo jazdy kat. AM, B nr 44411/23/1586”,
  „Prawo jazdy okazał, nr 18957/11/1031”, „dowodem osobistym wydanym przez Prezydenta Miasta
  Krakowa nr ABC123456”, „paszport (ważny do 2030 r.) nr AB1234567”, „KRS (Sąd Rejonowy dla
  Krakowa-Śródmieścia, XI Wydział Gospodarczy) pod numerem 0000123456” i „odpisu aktu urodzenia
  dziecka, nr aktu 0612/2021” zostawiały numer jawny. Teraz to „prawo jazdy kat. AM, B nr
  [PRAWO-JAZDY]”, „… nr [NR-DOWODU]”, „… nr [NR-PASZPORTU]”, „pod numerem [KRS]” i „nr aktu
  [NR-AKTU-USC]”. Wtrąceniem może być kategoria, organ wydający, data ważności w nawiasie albo
  czasownik, w jednym zdaniu i bez cyfr poza nawiasem, a numer musi stać po „nr” albo „numer”
  i mieć kształt danego dokumentu. Numer aktu w rejestrze stanu cywilnego
  („1661011/00/AU/1995/001061”) znika po samym kształcie, także po „akt otrzymał numer”. Jawne
  zostają numery innych dokumentów i spraw we wtrąceniu („Prawo jazdy kategorii B wydaje starosta
  …, wniosek nr 123/2024”, „zatrzymał dokument prawa jazdy za pokwitowaniem nr 0318842”, „notatkę nr
  123/2026”), przepis o dokumencie („ustawą o dowodach osobistych”) i nazwa punktu („Punkt
  Paszportowy nr 2”). Jawne zostają też dane urzędu po nazwie dokumentu: gdy tuż przed „nr” stoi
  zwykły rzeczownik, numer należy do niego („Wnioski o wydanie prawa jazdy przyjmuje Wydział
  Komunikacji, pokój nr 1011.”, „sala nr 2014”, „stanowisko nr 1204”, „JRWA symbol nr 5430”,
  „skrytka nr ESP12345”, „Dowód osobisty odbierzesz w Urzędzie Miasta, okienko nr …”). Tak samo
  wielką literą i po organie wydającym („Prawo jazdy wydane przez Starostę Kartuskiego, Wydział
  Komunikacji, Pokój nr 2107.”, „…, Stanowisko nr 1204”, „Kancelaria Ogólna nr 1014”, „KRS prowadzony
  przez Sąd Rejonowy …, XI Wydział Gospodarczy, Sala nr …”) i przy lokalu opisanym imiesłowem
  („Odbiór prawa jazdy: stanowisko czasowo zamknięte, nr 1204 czynne od 8:00.”).
- **Imię, nazwisko i adres w formularzu spłaszczonym do jednego wiersza i w prozie znikają.**
  Wcześniej z deklaracji wklejonej jako tekst „D.2 Imię ojca: Leon   Imię matki: Gertruda” dawało
  „D.2 Imię ojca: [IMIĘ I NAZWISKO] matki: Gertruda”, a „Miejscowość: Kiełpino   Ulica: Kartuska
  Nr domu: 41A” zostawało jawne. Teraz każde pole wiersza dostaje swoją maskę, także po średniku
  i z numeracją części deklaracji („D.2”, „1.4.”): „Imię ojca: [IMIĘ I NAZWISKO]   Imię matki:
  [IMIĘ I NAZWISKO]”, „Ulica: [ADRES]   Nr domu: [ADRES]”, „Imię: [IMIĘ I NAZWISKO] Nazwisko:
  [IMIĘ I NAZWISKO] PESEL: [PESEL]”, „Imiona rodziców: [IMIĘ I NAZWISKO], [IMIĘ I NAZWISKO]”. W
  prozie znika wartość po nazwie pola osoby: „nazwisko rodowe w akcie: [IMIĘ I NAZWISKO].”,
  „nazwisko rodowe matki „[IMIĘ I NAZWISKO]””, zmiana nazwiska „z „[IMIĘ I NAZWISKO]” na „[IMIĘ
  I NAZWISKO]””, „o nadanie dziecku imienia [IMIĘ I NAZWISKO].” i „zapamiętałam jedynie imię:
  [IMIĘ I NAZWISKO].”. Jawne zostają puste pola („Imię: ………”), pouczenia („Imię i nazwisko: należy
  wpisać drukowanymi literami.”, „należy podać imię i nazwisko oraz adres”), urząd albo rola pod
  etykietą osoby w jednym wierszu („Nazwisko: Urząd Skarbowy   Adres: …”), Skarb Państwa pod
  etykietą nazwiska („Działka nr 123/4, obręb Bodzentyn, nazwisko właściciela: Skarb Państwa.”,
  „Nazwisko: Skarb Państwa”), patron („nadać szkole imię Jana Pawła II”, „Nagroda imienia Zofii”,
  „Dom Kultury imienia Juliana.”, „Muzeum imienia Stanisława.”), także w cudzysłowie, po dwukropku
  i przy zmianie patrona w uchwale („Nadaje się rondu imię „Józefa”.”, „Szkoła nosi imię: Józef.”,
  „Zmiana imienia patrona z „Stanisław” na „Jan”.”), zmiana nazwy ulicy („z „Polna” na „Lipowa””)
  i firma pod etykietą osoby albo podmiotu („Inwestor, nazwisko lub nazwa: Budimex.”). Imię bez dwukropka znika tylko w zdaniu o nadaniu albo zmianie imienia osoby, w formie
  słownikowej („o zmianę imienia [IMIĘ I NAZWISKO].”, „Wpisano imię [IMIĘ I NAZWISKO].”). Numer pola
  deklaracji przed kolejną etykietą należy do etykiety: „1.1. Imię: Bożydar 1.2. Nazwisko: Pękala” daje
  „1.1. Imię: [IMIĘ I NAZWISKO] 1.2. Nazwisko: [IMIĘ I NAZWISKO]”, a „D.2 Imię: Jan  D.3 Nazwisko:
  Kowalski  D.4 Imię ojca: Piotr” daje „D.2 Imię: [IMIĘ I NAZWISKO]  D.3 Nazwisko: [IMIĘ I NAZWISKO]
  D.4 Imię ojca: [IMIĘ I NAZWISKO]”. Na
  trzeciej serii 50 pism (część robocza) wycieków jest 104 zamiast 116, bez nowych nadmiarowych
  zakryć.
- **Temat szkolenia, programu, kampanii i ulotki zostaje jawny także przy osobie.** W wykazie
  szkoleń pracowników „Jan Kowalski | profilaktyka chorób nowotworowych” dawało „[IMIĘ I NAZWISKO]
  | profilaktyka chorób [DANE O ZDROWIU]”, a „akcja profilaktyczna „Stop cukrzycy”” i „ulotki
  o profilaktyce udaru mózgu i nadciśnienia” traciły nazwę choroby. Teraz po słowie tematu
  (profilaktyka, szkolenie, kurs, warsztaty, program, kampania, prelekcja, konferencja, ulotka,
  akcja, pogadanka, webinar, badania przesiewowe) nazwa choroby zostaje: „[IMIĘ I NAZWISKO] |
  profilaktyka chorób nowotworowych”, „Warsztaty o uzależnieniach od alkoholu”, „Konferencja:
  choroba Alzheimera w opiece społecznej”, „zgłosiła się do programu badań przesiewowych w kierunku
  raka piersi”. Fakt o osobie dalej znika: „po drugim kursie [DANE O ZDROWIU] z powodu [DANE
  O ZDROWIU]”, „profilaktykę przeciwzakrzepową z powodu [DANE O ZDROWIU]”, „W ramach programu badań
  przesiewowych zdiagnozowano u niej [DANE O ZDROWIU]”, „Podczas szkolenia Pan [IMIĘ I NAZWISKO]
  doznał [DANE O ZDROWIU]”, a program lekowy, warsztaty terapii zajęciowej i akcja serca nie są
  tematem. Tematem nie jest też leczenie w złożeniu, opieka i grupa chorych: „zakończyła kurs
  [DANE O ZDROWIU] osy” (immunoterapii alergii na jad), „jest objęta programem kompleksowej opieki
  [DANE O ZDROWIU]”, „uczestniczy w warsztatach dla osób [DANE O ZDROWIU]”, „chodzi na warsztaty
  z [DANE O ZDROWIU]”, a „Kampania dla kobiet o profilaktyce raka piersi” zostaje jawna. Przyczyna
  albo stan w środku opisu zajęć też przerywa temat: „kończy kurs ćwiczeń usprawniających [DANE
  O ZDROWIU]” (po udarze mózgu), „chodzi na warsztaty ruchowe przy [DANE O ZDROWIU]”, „kurs zabiegów
  w leczeniu [DANE O ZDROWIU]”, „programem żywienia klinicznego w trakcie [DANE O ZDROWIU]”.
  Z „o” albo odbiorcami bez choroby temat zostaje: „prelekcja o życiu po udarze mózgu”, „kurs dla
  opiekunów przy chorobie Parkinsona”, a „kurs pierwszej pomocy przy zawale serca” w wykazie szkoleń
  jak dotąd.
- **Opis sprawności osoby w wywiadzie, wniosku i karcie DPS znika jako dana o zdrowiu, a opieka
  nad dzieckiem, zabytkiem czy ogrodem zostaje jawna.** Wcześniej „Pani [IMIĘ I NAZWISKO] porusza
  się na wózku inwalidzkim”, „porusza się po domu przy balkoniku”, „Pan [IMIĘ I NAZWISKO] jest
  osobą leżącą” i „wymaga karmienia przez gastrostomię” zostawały jawne, choć mówią o chorobie albo
  niepełnosprawności tej osoby. Teraz znika sama fraza, a osoba i reszta zdania zostają: „Pani
  [IMIĘ I NAZWISKO] [DANE O ZDROWIU] po urazie rdzenia kręgowego”, „Ojciec wnioskodawczyni [DANE
  O ZDROWIU] i [DANE O ZDROWIU]” (chodzi o kulach łokciowych, wymaga pomocy przy kąpieli),
  „Podopieczny jest [DANE O ZDROWIU]” (niesamodzielny w zakresie samoobsługi). Tak samo znika
  poruszanie się z trudem przy pomocy kuli albo o dwóch kulach, wózek inwalidzki także elektryczny,
  osoba leżąca, przykuta do łóżka i niesamodzielna, pomoc w myciu, ubieraniu i poruszaniu się,
  „nie jest w stanie samodzielnie się ubrać ani umyć”, karmienie przez PEG lub sondę, stomia,
  pieluchomajtki, cewnik i tlenoterapia domowa przy osobie, która je ma, nosi albo z nich korzysta
  („Pan [IMIĘ I NAZWISKO] ma założony [DANE O ZDROWIU]”, „korzysta z [DANE O ZDROWIU]”), osoba
  niewidoma i niesłysząca, „nie słyszy i nie
  mówi”, wynik w skali Barthel („w skali Barthela uzyskał 30 pkt”) i „znacznie ograniczona zdolność
  do samodzielnej egzystencji”. Sama „stała opieka” znika tylko przy chorobie, urazie albo innej
  danej o zdrowiu w tym lub poprzednim zdaniu („Pan [IMIĘ I NAZWISKO] po wylewie [DANE O
  ZDROWIU]”). Jawne zostają: „Zabytek wymaga stałej opieki i nadzoru”, „Ogród wymaga stałej opieki
  ogrodnika”, „Dziecko w wieku 2 lat wymaga stałej opieki”, „Pani … potrzebuje stałej opieki nad
  dziećmi w czasie pracy zmianowej”, „Wnioskodawca wymaga pomocy osób trzecich przy remoncie
  mieszkania”, „wymaga pomocy przy kąpieli dzieci”, „Pan … porusza się na wózku golfowym”, „Babcia
  chodzi z laską trekkingową po górach”, „Pan … jest osobą niesamodzielną finansowo”, „Dziecko nie
  chodzi samodzielnie, bo ma dopiero 10 miesięcy”, „Pan … nie wstaje z łóżka przed dziesiątą”,
  „Pracownik nie mówi i nie chodzi na zebrania”, „pomaga osobom niewidomym w zakupach”, kategorie
  skali oceny („| 2 | porusza się przy balkoniku | 1 |”) oraz definicje, warunki i opis procedury
  („Lekarz orzecznik ocenia, czy badany wymaga stałej opieki”, „Gdy podopieczny wymaga karmienia
  przez PEG, opiekun przechodzi szkolenie”). Jawny zostaje też sprzęt jako towar albo przedmiot
  pracy („Przedmiot zamówienia: worki stomijne i cewniki urologiczne”, „odpowiada za zakup
  pieluchomajtek”, „Pielęgniarka … wymienia cewniki mieszkańcom”, „przekazał tlenoterapię domową do
  rozliczenia z NFZ”) oraz niesamodzielność poza domem bez choroby w pobliżu: „Uczeń nie potrafi
  samodzielnie funkcjonować w grupie rówieśniczej”, „nie jest w stanie samodzielnie wstać rano bez
  budzika”, „wymaga pomocy w poruszaniu się po systemie e-PUAP”, „nie porusza się samodzielnie po
  Warszawie, bo nie zna miasta”. Przestrzeń domowa dalej znika razem z frazą: „Matka [DANE
  O ZDROWIU] po mieszkaniu” (nie jest w stanie samodzielnie poruszać się), „Ojciec [DANE O ZDROWIU]
  z łóżka”. Na trzeciej serii 50 pism (część robocza) wycieków
  jest 97 zamiast 104 (danych o zdrowiu 46 zamiast 53), bez nowych nadmiarowych zakryć.
- **Niepełnosprawność dziecka, męża czy matki i symbol przyczyny z orzeczenia znikają, a nazwa
  zespołu orzekającego, ustawa i program PFRON zostają jawne.** Wcześniej „samotnie wychowuje syna
  z niepełnosprawnością (MPD)”, „Ze względu na niepełnosprawność dziecka” i „orzeczenie … zaliczające
  syna do osób niepełnosprawnych” zostawały jawne, a przy „orzeczeniu o umiarkowanym stopniu
  niepełnosprawności (symbol przyczyny 05-R)” znikał sam stopień, a symbol zostawał. Teraz: „syna
  [DANE O ZDROWIU]”, „Ze względu na [DANE O ZDROWIU] dziecka”, „zaliczające syna [DANE O ZDROWIU]”,
  „Syn wnioskodawczyni jest [DANE O ZDROWIU] od urodzenia”, „Mąż jest [DANE O ZDROWIU]” (osobą
  niepełnosprawną ruchowo), „orzeczenie o [DANE O ZDROWIU], wydano 23 września 2026 r.” (stopień
  razem z symbolem 10-N w jednej masce). Znika też przymiotnik przed krewnym i w dopowiedzeniu:
  „opiekuje się [DANE O ZDROWIU] matką”, „sprawuje opiekę nad [DANE O ZDROWIU] synem”, „jej
  dziecko jest [DANE O ZDROWIU]”, „Wnuk jest [DANE O ZDROWIU]” (dzieckiem niepełnosprawnym), „Mąż
  Pani …, [DANE O ZDROWIU], nie pracuje” (niepełnosprawny ruchowo), „ma [DANE O ZDROWIU]”
  (orzeczoną niepełnosprawność), „został zakwalifikowany [DANE O ZDROWIU]”, „uznano [DANE
  O ZDROWIU]” (za osobę niepełnosprawną). Symbol przyczyny znika razem z frazą orzeczenia także po
  „z symbolem”, „o symbolu” i „symbole przyczyny”: „Dziecko ma [DANE O ZDROWIU]” zamiast „Dziecko ma
  [DANE O ZDROWIU] z symbolem 12-C”. Poza frazą znika z opisem po myślniku i kilka naraz:
  „(symbol przyczyny niepełnosprawności [DANE O ZDROWIU]; dziecko w spektrum…)”, pola „Symbol
  przyczyny niepełnosprawności: [DANE O ZDROWIU]” (05-R, 10-N), „Przyczyna niepełnosprawności:
  [DANE O ZDROWIU]” i „Stopień niepełnosprawności: [DANE O ZDROWIU]”. Wskazanie z orzeczenia
  o konieczności stałej opieki albo współudziału opiekuna w leczeniu dziecka znika razem ze stanem,
  z którego wynika: „Orzeczenie zawiera wskazanie [DANE O ZDROWIU] syna”. Orzeczenie z numerem
  albo datą („nr 214/2025”, „z dnia 3 lipca 2024 r.”) mówi o osobie także obok cytatu przepisu:
  „orzeczenie nr 214/2025 o potrzebie kształcenia specjalnego ze względu na [DANE O ZDROWIU]”;
  data wydania, termin ważności z datą i „bezterminowe” tylko poza zdaniem przepisu. Jawne zostają
  przepis, warunek świadczenia, statystyka i tytuł, także z symbolem albo terminem bez daty:
  „Osoba posiadająca orzeczenie o umiarkowanym stopniu niepełnosprawności z symbolem 05-R może
  otrzymać kartę parkingową”, „W 2025 r. wydano 412 orzeczeń o umiarkowanym stopniu
  niepełnosprawności, w tym 37 z symbolem 02-P”, „Tabela 3. … według symbolu przyczyny: 05-R –
  120, 10-N – 44”, „orzeczeniem o znacznym stopniu niepełnosprawności, ważnym do dnia złożenia
  wniosku”, „Orzeczenie … może być bezterminowe”, „wydane dnia 1 stycznia 1998 r. lub wcześniej
  zachowuje ważność”, „Wskazanie konieczności stałego współudziału … zawiera orzeczenie wydane po
  ukończeniu przez dziecko 3 lat”, „Poradnik dla rodziców: niepełnosprawność dziecka a świadczenia
  rodzinne”, „Rodzic niepełnosprawnego dziecka może otrzymać świadczenie”. Jawne zostają też:
  „Powiatowy Zespół do Spraw Orzekania o Niepełnosprawności”, „ustawa o rehabilitacji zawodowej
  i społecznej oraz zatrudnianiu osób niepełnosprawnych”, „Program PFRON „Aktywny samorząd””, „Dzień
  Osób z Niepełnosprawnościami”, objaśnienie kodu („Symbol przyczyny niepełnosprawności 05-R oznacza
  upośledzenie narządu ruchu”, „np. 05-R lub 10-N”), kod bez słowa „symbol” albo w innym kształcie
  („Sala 05-R”, „element 06-E”), „Dziecko z niepełnosprawnością ma prawo do bezpłatnego transportu”,
  „rodzin dzieci z niepełnosprawnościami”, „w przypadku niepełnosprawności dziecka wymiar urlopu
  wydłuża się” w cytacie Kodeksu pracy oraz „Świadczenie pielęgnacyjne przysługuje, jeżeli
  orzeczenie zawiera wskazanie konieczności stałej … opieki”. Przymiotnik przed krewnym znika
  tylko wtedy, gdy w zdaniu jest osoba poza samym krewnym (imię i nazwisko, Pan, Pani,
  wnioskodawczyni, „jej”, dorosły krewny, „opiekuję się”, „ze względu na … ustalono”), więc
  kryterium, przepis, program, tytuł i opis grupy zostają jawne: „Kryterium: wychowywanie
  niepełnosprawnego dziecka – 10 punktów”, „Przetarg: dowóz niepełnosprawnego dziecka…”, „Zasiłek
  pielęgnacyjny dla niepełnosprawnego dziecka wynosi 215,84 zł”, „Program jest przeznaczony dla
  osób opiekujących się niepełnosprawnym dzieckiem” (także w notatce z nazwiskiem w zdaniu obok),
  „Konferencja „Niepełnosprawny syn, niepełnosprawna córka…””, „Beneficjentem projektu jest
  niepełnosprawny mieszkaniec gminy”, „W klasie jest niepełnosprawne dziecko” i „W polu 12 wpisz,
  czy dziecko jest niepełnosprawne (tak/nie)”. Na trzeciej serii 50 pism (część
  robocza) wycieków jest 83 zamiast 97 (danych o zdrowiu 32 zamiast 46), bez nowych nadmiarowych
  zakryć.
- **Dane o zdrowiu osoby podanej imieniem w odmianie znikają: „U Zosi stwierdzono…”, „sytuację
  materialną Krystyny Pawlik, która utrzymuje się z renty…”, „Kacprowi przyznano…”.** Wcześniej
  osobę z imieniem w dopełniaczu, celowniku albo narzędniku Parawan widział tylko po „Pan” albo
  „Pani”, więc fakt o zdrowiu w tym samym zdaniu zostawał jawny. Teraz: „U Zosi stwierdzono [DANE
  O ZDROWIU]”, „U [IMIĘ I NAZWISKO] stwierdzono [DANE O ZDROWIU]” (cukrzycę typu 2), „Dotyczy
  [IMIĘ I NAZWISKO], u której stwierdzono [DANE O ZDROWIU]”, „…materialną [IMIĘ I NAZWISKO], która
  utrzymuje się z [DANE O ZDROWIU]” (renty z tytułu niezdolności do pracy), „wiozła matkę, [IMIĘ
  I NAZWISKO], która uskarżała się na [DANE O ZDROWIU]” (silny ból w klatce piersiowej),
  „opiekuje się [IMIĘ I NAZWISKO], która [DANE O ZDROWIU]” (porusza się na wózku inwalidzkim),
  „Zosi wystawiono [DANE O ZDROWIU]”, „Kacprowi przyznano [DANE O ZDROWIU]”, „[DANE O ZDROWIU]
  [IMIĘ I NAZWISKO] obejmuje 14 dni” (zwolnienie lekarskie Jana Kowalskiego), „[DANE O ZDROWIU]
  Kacpra wydano w 2025 r.” (imię i czasownik po zakrytej danej nie wchodzą do jej maski). Objaw z natężeniem i miejscem („silny ból w klatce piersiowej”, „silne
  bóle głowy”) znika w całości, a pobyt w szpitalu po wtrąceniu („trafił przez to do szpitala”,
  „po każdym takim wieczorze się dusi, w lutym trafił…”) dalej należy do osoby z początku zdania.
  Jawne zostają patron, adres i nazwa instytucji („Fundacji Anny Dymnej”, „im. Marii
  Konopnickiej”, „Szpital Jana Pawła II”, „szpitala św. Józefa”), autor polecenia („Zgodnie
  z decyzją Anny Nowak zasiłek chorobowy wypłaca pracodawca”), samo imię w przepisie i warunku
  („Zgodnie z wytycznymi Kasi zwolnienie lekarskie należy dostarczyć…”, „Jeżeli u Zosi wystąpi
  gorączka, należy…”), sprawy bez faktu medycznego („U Kasi stwierdzono brak zaległości”, „Zosi
  przyznano stypendium”) i temat zajęć („Zajęcia o cukrzycy w klasie Zosi prowadziła
  pielęgniarka”). Jawny zostaje też patron po „im.” i „ul.” („Szpital im. Ludwika Rydygiera leczy
  pacjentów po zawale”, „Hospicjum przy ul. Heleny Modrzejewskiej przyjmuje osoby po udarze”),
  patron i nazwa po rzeczowniku szkoły, szpitala czy gminy („Uczniowie szkoły Marii Konopnickiej
  z orzeczeniem o niepełnosprawności mogą…”, „Mieszkańcy gminy Kazimierza Wielka mogą skorzystać
  z badań w kierunku cukrzycy”) oraz autor książki, filmu czy wykładu, także z tytułem („Wykład dr.
  [IMIĘ I NAZWISKO] o chorobie Alzheimera”). Osoba na początku zdania przed czasownikiem
  bezosobowym kotwiczy dane o zdrowiu: „[IMIĘ I NAZWISKO] przyznano zasiłek pielęgnacyjny z powodu
  [DANE O ZDROWIU]” (Grażynie Nowak, znacznego stopnia niepełnosprawności). Imię, po którym stoi
  „o” z tematem, to autor albo rozmówca, więc temat zostaje jawny: „Wywiad z [IMIĘ I NAZWISKO]
  o depresji ukazał się w gazecie”, „Monografia [IMIĘ I NAZWISKO] o chorobie afektywnej
  dwubiegunowej…”, „Zaproszenie na spotkanie z [IMIĘ I NAZWISKO] o życiu z cukrzycą”. Prośba
  dalej należy do osoby: „Wniosek [IMIĘ I NAZWISKO] o zasiłek pielęgnacyjny z powodu [DANE
  O ZDROWIU]”. Jawny zostaje też temat rozprawy i badań („[IMIĘ I NAZWISKO] nadano stopień
  doktora za rozprawę o leczeniu cukrzycy”, „przyznano grant na badania nad cukrzycą”), lokal
  z imieniem („Pensjonat u Basi przyjmuje kuracjuszy po zawale serca”, „Gospoda U Kasi”) i imię
  w tytule akcji („Akcja „Pomóż Zuzi” zbiera środki dla dzieci z chorobą nowotworową”). Na trzeciej serii 50 pism (część robocza) wycieków jest 80 zamiast 83 (danych
  o zdrowiu 29 zamiast 32), bez nowych nadmiarowych zakryć.
- **Ślad leczenia osoby znika także bez nazwy choroby, a schorzenie spoza słownika Parawan
  rozpoznaje po budowie słowa.** Wcześniej w wywiadzie i we wniosku zostawało jawne to, że ktoś
  się leczy, choć nazwa choroby była zakryta albo jej nie było. Teraz: „jest w trakcie [DANE
  O ZDROWIU]” (leczenia), „jest po [DANE O ZDROWIU]” (trzech cyklach chemioterapii; „po chemii”,
  „po przeszczepie”), „korzysta z [DANE O ZDROWIU]” (rehabilitacji domowej), „od września jest [DANE
  O ZDROWIU]” (rehabilitowana pięć razy w tygodniu), „była [DANE O ZDROWIU]” (hospitalizowana od
  3 do 12 marca 2026 r.), „pozostaje [DANE O ZDROWIU]” (pod opieką pielęgniarki środowiskowej),
  „kontrole w [DANE O ZDROWIU]” (poradni diabetologicznej), „do dojazdów na [DANE O ZDROWIU]”,
  „jest dwa tygodnie [DANE O ZDROWIU]” (po operacji wszczepienia bypassów). Wtrącenie między
  słowem a chorobą zostaje jawne, a choroba znika: „U syna rozpoznano, według opinii poradni
  z 3 marca, [DANE O ZDROWIU]”, „była [DANE O ZDROWIU] — według zaświadczenia z 3 marca — [DANE
  O ZDROWIU]” (leczona onkologicznie). Schorzenie spoza słownika po końcówce i konstrukcji:
  tetraplegia, hiperglikemia, laryngektomia, endoprotezoplastyka, hipoterapia, „mózgowe porażenie
  dziecięce”, „porażenie nerwu twarzowego”, „przewlekła niewydolność krążenia”, „uraz rdzenia
  kręgowego”, „objawy fobii szkolnej”, a po przecinku dalsza nazwa z wyliczenia („[DANE
  O ZDROWIU], obniżone napięcie mięśniowe”). Zostają jawne: „Spółka jest w trakcie likwidacji”,
  „Gmina prowadzi rehabilitację domową”, „rehabilitacja zawodowa”, „studia z fizjoterapii”,
  „kolejki do fizjoterapii”, „socjoterapia”, „niewydolność systemu”, „niewydolność wychowawcza”,
  „zaburzenia krążenia informacji”, „Zespół Szkół”, „Warsztat Terapii Zajęciowej”, anatomia jako
  przedmiot, proza, „akademia”, „premia”, „mikroskopia”. Diagnostyka i rehabilitacja w toku znikają
  tylko z dopowiedzeniem medycznym i przy osobie: „Ojciec jest w trakcie [DANE O ZDROWIU]”
  (diagnostyki kardiologicznej), a „Pedagog jest w trakcie diagnostyki potrzeb ucznia”, „Poradnia
  jest w trakcie diagnostyki przesiewowej”, „Budynek jest w trakcie rehabilitacji”, „Szpital
  kontynuuje leczenie pacjentów” i „chodzi na rehabilitację zawodową w ramach programu PFRON”
  zostają. Terapia jako zawód, kwalifikacja, usługa, metoda pracy, temat i placówka zostaje jawna:
  „instruktor hipoterapii”, „koordynatorka zajęć z ludoterapii”, „absolwentka fizjoterapii”,
  „ukończyła dwa cykle szkoleń z dogoterapii”, „ma uprawnienia z zakresu kinezyterapii”, „oferta
  Pana Kowalskiego na usługi fizjoterapii”, „wykonawca usług hydroterapii”, „jest terapeutką
  i stosuje muzykoterapię w pracy z dziećmi”, „pracę magisterską o muzykoterapii”, „konferencja
  o fizjoterapii”, „właścicielka salonu aromaterapii”, „sprzedaje sprzęt do magnetoterapii”,
  „zatrudniona w dziale fizjoterapii”, „ośrodek hipoterapii”. Ta sama terapia u uczestnika,
  klienta i pacjenta dalej znika: „korzysta z zajęć z [DANE O ZDROWIU]” (dogoterapii), „korzysta
  z usług [DANE O ZDROWIU]” (fizjoterapii), „jest uczestniczką warsztatów z [DANE O ZDROWIU]”,
  „stosuje [DANE O ZDROWIU] u noworodka”, „rozmawiałam z lekarzem o [DANE O ZDROWIU] syna”,
  „kurs [DANE O ZDROWIU]” (fizjoterapii po udarze). Ziemia rolnika nie jest daną o zdrowiu: „posiada ziemię
  o powierzchni 5 ha”, „dzierżawi ziemię od gminy”, „pracuje w podziemiach kopalni”, „drzemią po
  obiedzie” zostają, a „ischemia” znika. Na trzeciej serii 50 pism (część robocza) wycieków jest
  66 zamiast 80 (danych o zdrowiu 15 zamiast 29), bez nowych nadmiarowych zakryć.
- **Pierwsze wklejone pismo i każda następna zmiana mają wynik od razu.** Parawan przygotowuje
  silnik zaraz po otwarciu pliku, a nie przy pierwszym piśmie. Wcześniej pierwsze przeliczenie
  trwało kilka razy dłużej niż kolejne, a pauza przed następnym rosła od niego do pół sekundy
  i więcej na wolniejszym komputerze, więc wynik zostawał chwilę przy poprzednim tekście.
- **DLA-IOD-I-IT.txt ostrzega przed filtrem załączników w poczcie.** Gdy dział IT dopisał typ html
  do filtru załączników w Defender for Office 365, Parawan.html nie dojdzie mailem nawet pod inną
  nazwą. Notka radzi wtedy dysk sieciowy.

## v0.47.0 — 2026-11-14

**Parawan zakrywa dane o zdrowiu, numery uprawnień zawodowych, karty pobytu i aktów stanu cywilnego, a adres urzędu w nagłówku pisma zostawia jawny.**

Pilność: pilna

Na 50 fikcyjnych pismach z kluczem (karta ze szpitala, pismo kadrowe, pozew, wezwanie do zapłaty
i inne, `docs/EWALUACJA.md`) Parawan zakrywał 89% danych do zakrycia i zakrywał też 30 adresów
urzędów, które miały zostać. Teraz zakrywa 99,5% i żadnego adresu urzędu, także na drugim,
niezależnie wygenerowanym zestawie 50 pism. Jawny zostaje tylko fakt procedury „Niebieskiej
Karty” (ROADMAP poz. 28). Rdzeń 0.30.0 (paczki `anonimizator` i `parawan`).

- **Adres urzędu, sądu czy działu pracodawcy w nagłówku pisma zostaje jawny.** Ulica, kod pocztowy i
  miejscowość pod nazwą instytucji („Urząd Miasta Łodzi⏎Wydział Finansowy⏎ul. Piotrkowska 104⏎90-926
  Łódź”, „Dział Kadr i Płac⏎ul. Stanisława Moniuszki 3”), ulica tuż za nazwą instytucji z
  przecinkiem („(Spółdzielnia Mieszkaniowa „Przyszłość”, ul. Wspólna 1)”) i budynek z salą spotkania
  („sala 214, budynek przy ul. Królewskiej 27”) były zakrywane jak adres osoby. To adres siedziby,
  więc zostaje, także ulica z patronem, stopniem albo liczbą („ul. gen. Władysława Andersa 5”, „ul.
  3 Maja 5”) w całości, również pod organem („Prezydent Miasta⏎Wydział Komunikacji”, „Wójt Gminy”),
  z dzielnicą po łączniku („Urząd Skarbowy Warszawa-Targówek”) i ze skrótem („Oddział PKO”,
  „Delegatura NIK”, „Oddział Regionalny ARiMR”). Miasto w nazwie tuż przed ulicą siedziby zostaje
  razem z nią („Urząd Miasta Łodzi, ul. Piotrkowska 104, 90-926 Łódź”, „Sąd Okręgowy w Poznaniu, ul.
  Hejmowskiego 2”, „Starostwo Powiatowe Turek, ul. Kaliska 59”), tak samo miejscowość między ulicą a
  kodem („ul. Braci Leśnej 3, Sękocin Stary, 05-090 Raszyn”), także kilka siedzib w jednym akapicie.
  Imię albo samo nazwisko w miejscu tej miejscowości („ul. Polna 3, Nowak Kowalski, 05-090 Raszyn”)
  to adresat, więc kod pocztowy i poczta dalej znikają. Szkoła, przedszkole, żłobek, przychodnia,
  poradnia, ośrodek, instytut czy akademia liczą się jako siedziba tylko z numerem, patronem,
  miejscowością po „w” albo słowem „Miejski”, „Gminny”, „Powiatowy”, „Publiczny”, „SP ZOZ” („Szkoła
  Podstawowa nr 5 im. Marii Konopnickiej”, „Przedszkole Miejskie nr 3 w Turku”, także wersalikami:
  „SZKOŁA PODSTAWOWA NR 5”), bo tak samo zaczyna się nazwa firmy jednoosobowej. Adres osoby dalej
  znika: pod imieniem i nazwiskiem (także spoza słownika imion, „Marianna Zięba-Kot”) albo pod
  „Pani”, „Pan”, „Sz. Pan” i „Dla:”, pod inicjałem z nazwiskiem („W. Nowak”), w nazwie firmy z
  imieniem albo nazwiskiem właściciela w każdym zapisie i odmianie, także pisanym wersalikami albo
  będącym zwykłym słowem („Zakład Usług Remontowych Jan Kowalski”, „Przychodnia Lekarska Ewy Nowak”,
  „Szkoła Jazdy KOWALSKI”, „Ośrodek Szkolenia Kierowców KOS”, „Przychodnia Weterynaryjna Wilk”,
  „Żłobek Domowy Ewy”), po „zam.”, „adres zamieszkania” i „miejsce zamieszkania” nad blokiem, pod
  „Gmina” albo „Dzielnica” z nazwą miejscowości, z numerem mieszkania („m. 3”, „lok. 9”, „12/4”,
  „ul. Polna 3, m. 14”, „lokal 4”, „mieszkania 14”), po pustej linii pod nagłówkiem instytucji oraz
  w zdaniu, w którym instytucja coś robi z osobą („Szpital przyjął pacjenta Jana Kowalskiego, ul.
  Polna 3”). Numer mieszkania zapisany słowem w odmianie („ul. Polna 3 mieszkania 14”, „lokalu 14”,
  „mieszkaniu 14”, „Jana Pawła II 14 mieszkania 3”) znika razem z adresem w każdym piśmie, także po
  „Zamieszkały:”; wcześniej zostawał jawny za znacznikiem `[ADRES]`. Sprawdzanie siedziby nie
  spowalnia długich dokumentów: spis kilku tysięcy placówek w jednym wierszu (280 KB) albo lista
  działów jeden pod drugim anonimizuje się w ułamku sekundy.
- **Nowy rodzaj danych: dane o zdrowiu.** Rozpoznania, kody chorób ICD-10, leki z dawką, urazy,
  zabiegi, ciąża i nałogi zostawały jawne w kartach ze szpitala, pismach kadrowych i pozwach. Teraz
  dostają znacznik `[DANE O ZDROWIU]`: wartość po „Rozpoznanie:”, „ICD-10:” czy „Leki:”, leki w
  „Zaleceniach” karty, lek z dawką po „przyjmuje” i choroba po „choruje na”, gdy zdanie dotyczy
  konkretnej osoby (imię i nazwisko, „Pani”, rola, PESEL). Jawne zostają przepis, poradnik,
  statystyka, ulotka, cennik apteki, przykład w instrukcji („np. ibuprofen 200 mg”), kod błędu kotła
  i „depresja gospodarcza”. To dane szczególnej kategorii (art. 9 RODO), więc typ jest domyślnie
  włączony; można go wyłączyć w panelu „Co maskować”.
- **Trzy nowe rodzaje danych: numer uprawnień zawodowych, numer karty pobytu i numer aktu stanu
  cywilnego.** Numer prawa wykonywania zawodu („PWZ 2663347”), numer wpisu radcy prawnego albo
  adwokata w podpisie („radca prawny, WA-3516”, „radcę prawnego Jana Nowaka (KR-4222)”), numer karty
  pobytu („kartą pobytu nr RP6295053”) i numer aktu („akt małżeństwa nr 1040/2011”) zostawały jawne.
  Teraz dostają znaczniki `[NR-UPRAWNIEŃ]`, `[NR-KARTY-POBYTU]` i `[NR-AKTU-USC]`, zawsze tylko przy
  słowie, które je zapowiada. Przy etykiecie „PWZ” numer jest zakryty także z literówką, a przy
  samym „lek.” tylko wtedy, gdy zgadza się suma kontrolna numeru lekarza. „Sygn. akt I C 1040/2011”
  dalej jest znakiem sprawy, a „WA-1234” bez słowa „radca” czy „adwokat” zostaje, bo może być kodem
  produktu. Numer wpisu musi stać zaraz po zawodzie albo po imieniu i nazwisku i zaczynać się kodem
  izby, więc faktura „FV/1234”, umowa „UM-2023”, norma czy zgłoszenie „LEG-123” w zdaniu z adwokatem
  zostają jawne, tak samo „nr wpisu do CEIDG”. Znane są kody wszystkich 19 okręgowych izb radców
  prawnych, także Lublina („LB-1231”) i Białegostoku („BK-1234”), oraz rad adwokackich („WAW”,
  „KRK/Adw/2345”, „LUB/Adw/456”). Numer jest zakryty także po długiej nazwie izby („nr wpisu na
  listę radców prawnych OIRP w Warszawie: …”, „wpisana na listę adwokatów ORA w Lublinie pod nr …”,
  ale nie po „liście obecności” czy „liście uczestników szkolenia”) i w drugim wierszu podpisu
  („Adwokat Jan Kowalski⏎Nr wpisu: KR-1234”); samo „NR WPISU: WA-1234” bez zawodu zostaje jawne.
  Numer aktu wychodzi też z zapisu „Akt urodzenia: nr …”, „pod nr …” i z wyliczenia („akty urodzenia
  12/2010 i 13/2010”), a udział „1/2” obok aktu zgonu zostaje. Słowa zapowiadające działają bez
  względu na wielkość liter („Akt urodzenia Nr …”, „KARTA POBYTU: …”, „Nr prawa wykonywania zawodu:
  …”). Statystyki zostają jawne: „PWZ 12345 lekarzom”, „wynagrodzenia lekarzy, 1340517”, zakres lat
  „akty urodzenia 2019/2020” i kod po adwokacie, po którym zdanie biegnie dalej („KR-2020 to numer
  sprawy”, „PO-350 zł”), także po myślniku, gdy przed kodem stoi sam zawód („Kancelaria radcy
  prawnego, KR-2026 - plan pracy na rok”). Długa lista numerów jest przetwarzana tak samo szybko jak
  krótka. Nowe typy można wyłączyć w panelu „Co maskować”. Biblioteka npm ma nowy eksport
  `isValidNpwz`, który sprawdza sumę kontrolną numeru prawa wykonywania zawodu lekarza.
- **Osoba z nazwiskiem, które jest też zwykłym słowem, jest zakryta po „zespół” czy „drużyna”.** W
  zdaniu „testy obciążeniowe wykonał zespół Joanny Sikory” imię i nazwisko zostawały jawne, bo
  „zespół” przed imieniem w dopełniaczu był brany za początek nazwy z patronem, a nazwisko „Sikora”
  to też nazwa ptaka. Teraz po „zespół”, „drużyna”, „chór”, „orkiestra”, „komitet”, „hufiec” i
  „koło” pisanych małą literą taka para dostaje znacznik osoby (tak samo „drużyna Piotra Wilka”,
  „zespół Anny Lis”). „Zespół”, „Drużyna” i „Komitet” wielką literą na początku zdania, wiersza albo
  punktu listy też („Zespół Adama Kota wykonał audyt”). Patroni i kluby zostają jawni jak dotąd:
  „chór Stanisława Moniuszki”, „hufiec Tadeusza Kościuszki”, „drużyna Lecha Poznań”, „Koncert dał
  Chór Jana Lisa”, „Fundacja Joanny Sikory”. Po „zespół”, „drużyna” i „komitet” małą literą zakryte
  jest też nazwisko spoza słownika („zespół Ewy Zimy”, „zespół Wiktorii Kos”), osoba z dwoma
  imionami („zespół Joanny Marii Sikory”) i nazwisko z łącznikiem („drużyna Anny Nowak-Lis”). Znani
  patroni i kluby zostają jawni („zespół Marii Skłodowskiej-Curie”, „drużyna Wisły Kraków”). Przy
  okazji „Najświętszej Marii Panny” i „kościół Marii Panny” nie są już brane za imię i nazwisko, a
  „Wezwano Marię Pannę na rozprawę”, „W kościele Maria Panna zauważyła sprawcę” i „Maria Panna,
  PESEL …” nadal są zakryte. Zakryta jest też osoba, której imię w dopełniaczu jest zarazem zwykłym
  słowem („Marka”, „Ani”, „Arka”, „Witka”), a nazwisko nazwą zwierzęcia czy zawodu: w drugim członie
  wyliczenia za zakrytą osobą („akt małżeństwa Marty Sowy i Marka Sowy”, „Marty Lis i Marka Lisa”),
  po „od”, „dla”, „do”, „u”, „wobec”, „według”, „przeciwko” i „z udziałem” („Pismo od Marka Sowy z 3
  marca”), po nazwie pisma („Pozew Marka Gołębia”, „wniosek Ani Sowy”) i po „zespół”, „drużyna”,
  „komitet”. Wcześniej takie imię i nazwisko zostawały jawne. Nazwisko „Gołąb” i „Dąb” jest
  rozpoznawane we wszystkich odmianach („Gołębia”, „Gołębiowi”, „Gołębiem”, „Dęba”). Jawne zostają
  „od Marka do piątku”, „gniazdo sowy i lisa”, „Marka Sowy nie znam” bez słowa przed parą i „Msza w
  kościele pw. Najświętszej Maryi Panny”.
- **Data urodzenia dziecka po słowie „urodzenie” jest zakryta.** W piśmie kadrowym „w związku z
  urodzeniem syna, Marka Nowaka (PESEL …), w dniu 17 czerwca 2026 r.” data zostawała jawna, bo
  między „urodzeniem” a datą stały imię, nazwisko i numer. Teraz data dostaje znacznik daty
  urodzenia, gdy po „urodzeniu”, „urodzenia” albo „urodzeniem” stoi syn, córka, dziecko czy wnuk, a
  dalej tylko imię i nazwisko dziecka, nawias z numerem, przecinek, złamanie wiersza albo „które
  przyszło na świat”, po czym „w dniu”, „dnia” lub „dn.” z datą. Każde inne słowo pomiędzy oznacza
  datę innego zdarzenia, więc zostaje jawna: wypłata zasiłku, termin wizyty, decyzja, powrót do
  pracy, koniec urlopu („po urodzeniu dziecka wraca do pracy dnia 1.09.2026”). Tak samo, gdy przed
  datą stoi urząd, sąd, pracodawca albo osoba z tytułem („Po urodzeniu dziecka ZUS w dniu 10.08.2026
  r. wypłacił zasiłek”), gdy zaraz po dacie stoi czasownik w czasie przeszłym albo termin w czasie
  teraźniejszym lub przyszłym („upływa”, „mija”, „przysługuje”, „wejdą w życie”), gdy data stoi w
  osobnym wtrąceniu po przecinku, a zdanie biegnie dalej („Po urodzeniu dziecka, w dniu 1 września
  2026 r., wejdą w życie nowe przepisy”), i gdy zdanie zaczyna się od „Przed urodzeniem”. Po „z
  tytułu urodzenia” czy „w związku z urodzeniem” oraz przy miejscu i godzinie porodu („w dniu … r.,
  w Szpitalu Miejskim”, „o godz. 14:30”) data dalej znika. Jawne zostają też daty przy „Zgłoszeniu”
  czy „Transkrypcji aktu urodzenia”, przepisy „w przypadku urodzenia dziecka w dniu … i później”,
  termin „6 tygodni po urodzeniu” i rok sprzed 1900. Przy okazji etykieta z myślnikiem zamiast
  dwukropka też zakrywa datę („Data urodzenia – 05.06.2018”, „Data urodzenia dziecka — 05.06.2018”).
- **Nazwa firmy jednoosobowej z nazwiskiem właściciela znika razem z osobą.** W piśmie „prowadząca
  działalność gospodarczą pod firmą LIS-BUD Jadwiga Lis” imię i nazwisko były zakryte, ale „LIS-BUD”
  zostawało jawne i zdradzało nazwisko. Teraz nazwa firmy z wielkich liter z łącznikiem wchodzi do
  znacznika osoby, gdy jej pierwszy człon to nazwisko zakrytej osoby, także skrócone
  („JABŁOŃS-TRANS”, „ZIELIŃS-BUD”) albo zapisane ze spacjami wokół łącznika („NOWAK - POL”), a do
  tego przed nazwą stoi „pod firmą”, „Firma:” czy „w firmie” albo nazwa kończy się typowym członem
  branżowym („-BUD”, „-TRANS”, „-POL”, „-MED”). Dzięki temu znika też nazwa w nagłówku faktury
  („Sprzedawca:”, niżej „LIS-BUD” i „Jadwiga Lis”). Nazwa w cudzysłowie też jest zakrywana, a raz
  rozpoznana firma znika przy każdej kolejnej wzmiance w piśmie, także odmienionej („LIS-BUDU”,
  „LIS-BUDEM”). Spółki („NOWAK-BUD Sp. z o.o.”, „spółki NOWAK-POL”), nazwy bez nazwiska („Firma:
  PKO-BP Jan Kowalski”, „pod nazwą NFZ-POZ”) i zwykłe zapisy wersalikami, w których pierwszy człon
  tylko przypadkiem równa się nazwisku („Jan Rak, RAK-JELITA w wywiadzie”, „Anna Maj, MAJ-CZERWIEC:
  urlop”), zostają, tak samo nazwa firmy z sąsiedniej kolumny tabeli.
- **Tytuł urzędu po „Panem” i „Panu” nie jest już brany za nazwisko.** Zdanie „Zgodnie z ustaleniami
  z Panem Ministrem termin nie może zostać przesunięty.” zamieniało „Ministrem” na znacznik osoby.
  Teraz tytuły urzędów i funkcji w każdej odmianie („z Panem Ministrem”, „Panu Dyrektorowi”, „z
  Panem Wojewodą”, „Panu Komornikowi”, „z Panem Notariuszem”, „z Panem Wicestarostą”, „z Panią
  Dyrektorką”, „Szanowna Pani Sędzio”) zostają jawne. Jawny zostaje też przymiotnik albo drugi człon
  urzędu („z Panem Wojewodą Mazowieckim”, „z Panem Komendantem Głównym Policji”, „Panu Sędziemu
  Sprawozdawcy”). Nazwisko za tytułem dalej trafia pod znacznik, a tytuł zostaje („z Panem Ministrem
  Kowalskim” daje „z Panem Ministrem [IMIĘ I NAZWISKO]”), także w tekście wielkimi literami („Z
  PANEM MINISTREM [IMIĘ I NAZWISKO]”). Przymiotnik od nazwy miasta zostaje jawny tylko po urzędzie
  terytorialnym (wojewoda, starosta, komendant, kurator), więc „z Panem Dyrektorem Krakowskim” i
  „Pismo do Pana Sędziego Krakowskiego” nadal ukrywają nazwisko. Jawny zostaje przymiotnik funkcji
  („Panu Dyrektorowi Finansowemu”, „z Panem Kierownikiem Technicznym”, „z Panem Kierownikiem
  Budowy”), a nazwisko za nim i za nazwą urzędu („z Panem Sekretarzem Gminy [IMIĘ I NAZWISKO]”)
  trafia pod znacznik. Nazwisko brzmiące jak urząd za innym tytułem („z Panem Prezesem Marszałkiem”)
  też jest ukrywane.
- **„Niebieska Karta” zostaje jako nazwa procedury.** Zdanie „wszczęto procedurę Niebieskiej Karty”
  dawało „procedurę [IMIĘ I NAZWISKO] Karty”. Teraz nazwa zostaje jawna w każdym przypadku
  („Niebieska Karta”, „w Niebieskiej Karcie”, „Założono Niebieską Kartę”, „Niebieskie Karty”), także
  wielkimi literami i z podziałem wiersza między wyrazami. Osoba o nazwisku Niebieska jest nadal
  maskowana, gdy nie stoi przed „Kartą” („Pani Niebieska”, „Anna Niebieska”), a także przed zwykłą
  kartą, gdy przed nazwiskiem stoi imię albo „Pani” lub przypadki się nie zgadzają („Pani
  Niebieskiej kartę parkingową”, „Joanna Niebieska karta klienta”). Procedura nie jest też daną o
  zdrowiu: sam jej fakt zostaje jawny, a osoba w zdaniu jest zakryta (osobny rodzaj danych jest w
  planie, ROADMAP.md poz. 28).
- **Inicjały osoby w liście zadań są zamaskowane.** Gdy w piśmie jest osoba, na przykład Anna
  Sadowska na liście uczestników, jej inicjały po „odp.” w punkcie notatki („(odp. AS)”, „(odp. MK,
  kontakt …)”, „odp. AS – termin 15.12”) i w stopce („Sporządził(a): AS”, „Odpowiedzialny – AS”,
  „Prowadzący: AS”, „Sporządziła: mgr AS”) oraz w kolumnie „Odp.” tabeli zadań trafiają pod znacznik
  osoby. Z pseudonimami dostają tę samą etykietę co pełne imię i nazwisko. Inicjały z kropkami
  („Sporządziła: A.S.”, „(odp. A.S., M.K.)”) są maskowane także bez takiej osoby, a „A.S. Nowak” to
  nadal jedna osoba. Zostają jawne odpowiedzi w ankietach i wyjaśnieniach („Odp. TAK”, „Sprawdził:
  NOK”, „B.D.”), badania („wyk. EKG, RTG”, „badanie wyk. MR”), funkcje („Zatwierdził: DG”),
  instytucje i firmy („oprac. PWN”, „Wykonał: ZDM”, „Wykonał: F.H.U. „Budmax””, „do akceptacji MZ”),
  numery etapów („odp. II”) i kody („odp. AS12”). Gołe inicjały w notatce, w której nie ma pełnego
  imienia i nazwiska tej osoby, nadal zostają jawne, bo nie da się ich odróżnić od skrótu.
- **PESEL z literówką w długości jest zamaskowany.** Po etykiecie „PESEL” numer z jedną cyfrą za
  mało albo za dużo („PESEL: 8909150266”, „PESEL Pacjenta: 890915026670”, pole `"pesel"` w JSON lub
  XML) trafia pod znacznik `[PESEL]`. Wcześniej maska obejmowała tylko dokładnie 11 cyfr. Działa też
  po „Nr PESEL:” i „Lp. PESEL:”. Między etykietą a numerem może stać tylko określenie osoby („ojca”,
  „pacjenta”, „ubezpieczonego”). Bez etykiety nic się nie zmienia. Zostają jawne: liczba w następnym
  zdaniu („PESEL. 2024000123 to nr zgłoszenia”), nagłówek tabeli z „PESEL” nad inną kolumną, numer
  po innym słowie („PESEL zgłoszenie 2024100123”), numer sprawy po „PESEL nr”, gdzie PESEL to nazwa
  rejestru („Wniosek dotyczący PESEL nr 2024000123”, „ws. PESEL nr …”, „Korekta PESEL nr …”,
  „zapytanie do bazy PESEL nr 2026111301”), NIP po pustym polu PESEL i dłuższe identyfikatory
  („1234567890-12”). Pełne 11 cyfr po „PESEL nr” są zakryte jak dotąd.
- **Telefon po „pod numerem” w zdaniu o kontakcie jest zamaskowany.** Zdanie „W razie pytań proszę
  kontaktować się z działem kadr pod numerem 22 379 56 66.” zostawiało numer jawny. Teraz numer
  trafia pod znacznik `[TELEFON]`, gdy przed „pod numerem”, „pod numerami”, „pod nr” albo „pod
  wskazanym numerem” stoi zwrot kontaktu („kontaktować się ze mną”, „kontakt z sekretariatem”,
  „dzwonić do mnie w godzinach 8-16”, „telefonować”, „jestem dostępny”, „jestem osiągalna”, „W razie
  pytań”, „Pan Nowak dostępny jest”, „Pani Anna Kos będzie osiągalna”). Osoba przy „dostępny” liczy
  się tylko po „Pan/Pani” z imieniem lub nazwiskiem wielką literą, więc „Pani sprawa dostępna jest
  pod numerem …” i „Akta Pana Nowaka dostępne są pod numerem …” zostają jawne, tak samo jak „W razie
  pytań dotyczących sprawy prowadzonej pod numerem …”. Po „pod numerem” zostaje jawny też dłuższy
  ciąg cyfr („22 123 45 67 89 10”, „2024 123 45 67”) i 9 cyfr od zera („01 123 45 67”), bo maska
  objęłaby tylko część numeru albo numer bez kierunkowego. Między nimi mogą stać tylko krótkie
  wyrazy w rodzaju „się”, „ze mną”, „wyłącznie”, „telefonicznie lub mailowo” albo adresat po „z” („z
  Panią Kierownik”). Adresat liczy się tylko w prośbie o kontakt („proszę kontaktować się z działem
  kadr”, „proszę o kontakt z sekretariatem”), więc opis zdarzenia („Kontakt z firmą wpisaną pod
  numerem …”, „Kontaktowano się z lokatorem mieszkania pod numerem …”, „Sprawa o kontakty z
  dzieckiem prowadzona pod numerem …”) zostawia numer jawny. Samo „pod numerem” niczego nie maskuje,
  więc numer w rejestrze, sprawie, fakturze czy KRS („wpisana do rejestru pod numerem …”,
  „kontaktowała się w sprawie wpisu pod numerem …”) zostaje jak był. „Dostępny pod numerem” maskuje
  tylko przy osobie („jestem dostępny”) albo z „telefonicznie”, więc „Dokument dostępny pod numerem
  …” i „Ogłoszenie jest dostępne pod numerem … w BIP” zostają jawne. Liczba z walutą, data i numer z
  rokiem po ukośniku („… pod numerem 22 379 56 66/2024”) po tym zwrocie też zostają.

## v0.46.27 — 2026-11-12

**Silnik jest podzielony na moduły i działa szybciej, a Parawan.html zaznacza to samo co v0.46.26. Paczka npm poprawia własne maski i warstwę LLM.**

Pilność: zwykła

Parawan.html daje te same znaczniki co v0.46.26, co do znaku: sprawdzone na korpusie benchmarku,
wszystkich tekstach z testów i kilku tysiącach losowo sklejonych pism. Poprawki niżej dotyczą
paczki `anonimizator` (rdzeń 0.29.14, także jako `parawan`).

Silnik:

- **Własne maski działają jak domyślne.** Przy `redactPII(text, { masks })` część reguł szukała
  w tekście domyślnych znaczników, np. `[IMIĘ I NAZWISKO]` czy `[ADRES]`, więc nie widziała maski
  podanej przez użytkownika. Imię nad nazwiskiem albo imiona rodziców zostawały wtedy jawne obok
  maski, a miasto przed zamaskowaną ulicą nie było maskowane. Pola formularza („Imię i nazwisko:”,
  „Ulica:”) wstawiały domyślną maskę zamiast własnej. Teraz własne maski są podstawiane dopiero po
  wykryciu, więc wynik różni się od domyślnego tylko tekstem znaczników, a lista `found` jest ta
  sama. Dotyczy to też znaczników pustych, z samej interpunkcji i wspólnych dla kilku typów (np.
  wszędzie `[UKRYTE]`). IBAN i numer konta mogą mieć różne znaczniki.
- **Poprawne dopełniacze trzech postaci historycznych.** Lista znanych postaci, które w nazwach
  wersalikami nie są stroną pisma (np. „LIST ADAMA MICKIEWICZA”), miała złe formy dla Orzeszkowej,
  Jagiełły i Fredry („ORZESZKOWAA”, „JAGIEŁŁI”, „FREDRI”). Teraz są poprawne. Dziś te trzy nazwiska
  nie są rozpoznawane jako osoby, więc wynik się nie zmienia; poprawka chroni je na przyszłość.
- **Warstwa LLM nie psuje nowszych znaczników.** Biblioteczny klient lokalnego modelu
  (`anonimizator/llm`) znał tylko część masek, więc kandydat „VIN” albo „TOKEN” zamieniał środek
  `[VIN]` czy `[TOKEN]` na maskę osoby, a litery etykiety `[OSOBA-AB]` też były do wzięcia. Teraz
  lista masek pochodzi wprost z rdzenia, fragmenty `[OSOBA-…]` są odrzucane, a zamiana pomija
  wystąpienia, które zaczynają się albo kończą w środku znacznika. Kandydat obejmujący cały znacznik
  („Jan [IMIĘ I NAZWISKO]”) jest zamieniany w całości. Aplikacji Parawan.html to nie dotyczy.
- **Silnik podzielony na moduły, wynik bez zmian.** Kod `redactPII` leżał w jednym pliku
  o ponad 9 tys. linii. Teraz przebiegi, strażniki kontekstu i słowniki są w osobnych modułach,
  a wzorce powstają raz przy ładowaniu paczki, nie przy każdym wywołaniu. Ten sam tekst dostaje te
  same znaczniki, co sprawdza test zamrażający wynik na całym korpusie benchmarku. Krótkie teksty,
  np. pojedyncze zdania i pola formularza, przechodzą mniej więcej dwa razy szybciej, a długie
  pismo prawie w tym samym czasie. Publiczne API paczki `anonimizator` się nie zmienia.

## v0.46.26 — 2026-10-25

**Czytnik ekranu podaje pełne nazwy rozwijanych kart, silnik jest w npm jako `anonimizator` i `parawan`, a strona produktu ma dziennik zmian i plan pod `/log/`.**

Pilność: zwykła

Silnik wykrywania (`packages/core/src`) bez zmian względem v0.46.24, więc ten sam tekst dostaje
te same znaczniki. W Parawan.html zmieniła się tylko dostępność trzech kart. Plik zbudowano
nowszymi narzędziami (Vite 8.3.5), dlatego ma inną sumę SHA-256 niż v0.46.25.

Aplikacja:

- **Dostępność.** Nagłówki rozwijanych kart „Adnotacja i protokół”, „Co maskować” i „Co wykrywa”
  mają teraz nazwę złożoną z tytułu i opisu, czyli z całego widocznego tekstu (WCAG 2.5.3, etykieta
  w nazwie). Czytnik ekranu i sterowanie głosem posługują się tymi samymi słowami, które widać.
  Wadę wykrył axe-core 4.14.

Dla programistów:

- **Paczka npm.** `anonimizator` 0.29.13 jest w rejestrze npm (opublikowana 2026-10-25):
  `npm install anonimizator`, a CLI bez instalacji przez `npx anonimizator`. Paczka zawiera
  `LICENSE` i `NOTICE` licencji Apache 2.0. Wcześniej rdzeń instalowało się tylko z katalogu
  repozytorium. Ten sam silnik jest też pod nazwą marki: `npm install parawan` (paczka bez
  własnego kodu, instaluje `anonimizator` w tej samej wersji) i `npx parawan pismo.txt`.
- **CLI: tryb `--jsonl` dla wywołań programowych.** `anonimizator --jsonl` działa jako proces
  trwały: każda linia JSON `{"id", "text"}` na wejściu daje jedną linię `{"id", "redacted",
  "found"}` na wyjściu, w tej samej kolejności, a proces kończy się po zamknięciu stdin. Puste
  linie są pomijane, `--osoby` działa jak w zwykłym trybie. Z `--bez-tekstu` odpowiedź zawiera
  tylko `id` i listę znalezisk z liczbą wystąpień, bez zredagowanego tekstu. Starsze wydania
  odrzucają nieznaną opcję kodem wyjścia 2, więc program po drugiej stronie może w ten sposób
  sprawdzić, czy wersja zna ten tryb. Wiersz, który nie jest poprawnym JSON-em albo ma `text`
  innego typu niż napis, dostaje odpowiedź `{"id", "error"}` zamiast zakończenia procesu.
  Rdzeń `anonimizator` 0.29.12 → 0.29.13 zawiera silnik z v0.46.24 i eksport `isValidKw`.
  (fa5edef, 00583f4)

Strona produktu:

- **Podstrona „Zmiany i plan” pod `/log/`.** Dziennik zmian i plan rozwoju
  powstają przy buildzie z `CHANGELOG.md` i `ROADMAP.md`. Strona nie ma skryptu, ma tę samą
  regułę CSP co strona główna i wbudowane fonty, więc nie wysyła żadnych żądań. Wersje starsze
  niż v0.46.0 są zwinięte, a każda ma własną kotwicę (np. `/log/#v0-46-25`). Link „Zmiany” jest
  w pasku nawigacji i w stopce strony głównej.

Zależności i automaty:

- **Zależności.** Narzędzia budowania i testów: Vite 8.3.5, vite-plugin-singlefile 2.3.4,
  Vitest 4.1.12, Biome 2.6.3, esbuild 0.28.2. Akcje GitHub: setup-node v7, upload-pages-artifact v5,
  deploy-pages v5. Bramka e2e: axe-core 4.14.0, Playwright 1.64.1. Zastępuje PR-y Dependabota #15,
  #16, #17, #21 i #24, które powstały na starszym `main`.
  pdf.js zostaje na 6.1.200: wersja 6.4 wymaga `Promise.withResolvers`, którego nie ma
  w Chromium i Edge 109, więc PDF-y przestałyby się tam wczytywać.

## v0.46.25 — 2026-10-24

**Parawan dla urzędu: pole tekstu od razu na ekranie, ręczna korekta wyniku, plik Worda z samego wyniku, adnotacja o wyłączeniu jawności z protokołem do akt i pliki wydania dla IOD i działu IT.**

Pilność: zalecana

Silnik wykrywania (`packages/core/src`) bez zmian względem v0.46.24, więc ten sam tekst dostaje
te same znaczniki. Zmieniły się aplikacja, pliki wydania i strona produktu.

Aplikacja:

- **Pierwszy ekran.** Pole tekstu zaczyna się w górnej części okna (na laptopie 1366×768
  w górnych 40% okna), a nie półtora ekranu niżej. Nagłówek mówi, do czego służy:
  „Zasłoń dane osobowe w piśmie, zanim opublikujesz je w BIP albo wkleisz do czatu AI.”
  „Przykład” wstawia fikcyjne pismo urzędowe ze znakiem sprawy, PESEL-em, rachunkiem i podpisem
  urzędnika, na którym widać też, co zostaje: „art. 104 Kpa”, numer działki i kwota. Obok wersji
  stoi data pliku, a plik starszy niż pół roku pokazuje żółte ostrzeżenie (liczy to zegar
  komputera, bez łączenia się z siecią). Karta „Ograniczenia” mówi, że nazwisko urzędnika pod
  pismem też jest zasłaniane, a numer działki zostaje.
- **Ręczna korekta wyniku.** Kliknięcie znacznika albo Enter na nim pokazuje, co pod nim stoi,
  i daje „Zostaw jawne”. Podpis wójta zostaje jawny, wnioskodawca dalej zasłonięty, bez
  wyłączania całego typu. „Zostaw jawne wszędzie” odsłania tę samą osobę w każdej formie
  („Jan Nowak”, „Jana Nowaka”, „Janowi Nowakowi”), a przed kliknięciem pokazuje listę tych form.
  „Janina Nowak” ani „J. Nowak” do niej nie wchodzą. Przeoczenie zasłonisz sam: zaznacz fragment
  w wyniku albo w polu źródła i wybierz „Zasłoń zaznaczenie” (imię i nazwisko, miejscowość, adres
  albo inne dane jako `[DANE]`), tylko tutaj albo we wszystkich wystąpieniach. Zaznaczenie połowy
  numeru zasłania cały numer. Pod wynikiem jest lista poprawek z „Cofnij” przy każdej pozycji,
  „Cofnij ostatnią” i „Usuń wszystkie”, a Ctrl+Z w wyniku cofa ostatnią czynność. Kopiowanie,
  .txt, .docx, wydruk, adnotacja i protokół biorą wynik z poprawkami. Po zamknięciu karty
  poprawki znikają.
- **Plik Worda z wyniku.** „Pobierz” ma dwa formaty: .txt i .docx. Plik .docx powstaje od nowa
  z samego wyniku, więc nie ma w nim autora, ostatniej osoby zapisującej, komentarzy ani historii
  zmian oryginału. W BIP można opublikować ten plik zamiast oryginału z wklejonym tekstem. Ma polski
  język tekstu, Arial 11 pt i format A4, znaczniki są pogrubione, a sprawdzanie ułatwień dostępu
  w Wordzie nie zgłasza problemów. Po pierwszym pobraniu wyniku z wczytanego Worda albo PDF pasek
  przypomina, żeby publikować nowy plik i przy pierwszym zapisie sprawdzić Plik › Informacje ›
  Autor.
- **Adnotacja i protokół.** Nowa karta pod „Zamaskowano” przygotowuje wzór informacji
  o wyłączeniu jawności z art. 8 ust. 5 ustawy o dostępie do informacji publicznej: zakres,
  podstawę prawną, kto wyłączył jawność i kto zatwierdził, w czyim interesie i datę. Liczby
  zasłoniętych fragmentów są domyślnie wyłączone, bo „jedno imię i nazwisko” zdradza, ile osób
  jest w piśmie. Adnotację można dołączyć na końcu wyniku, a w .docx i na wydruku stoi na osobnej
  stronie. Protokół do akt (kopia, .txt albo wydruk) podaje datę, wersję Parawana, znak sprawy,
  liczby zasłonięć według rodzaju danych, wyłączone typy i liczbę ręcznych poprawek, bez nazwy
  pliku i bez zasłoniętych wartości. Licznik „przejrzano 7 z 10” pokazuje, ile znaczników już
  obejrzano, a lista „Przed publikacją” ma pięć punktów do sprawdzenia. Brzmienie wzoru warto
  uzgodnić z prawnikiem urzędu.
- **Pamięć przeglądarki.** Zostają w niej tylko cztery klucze, bez treści pism: wyłączone typy,
  „Rozróżniaj osoby”, animacja oraz organ i osoba do adnotacji (te dwa tylko po zaznaczeniu
  „Pamiętaj”). Zapamiętane wyłączenie typu widać zaraz po otwarciu jako ostrzeżenie z „Włącz
  wszystko”, bo w Chrome i Edge mógł je zostawić inny plik .html otwarty z dysku. Parawan otwarty
  ze strony produktu ma stały pasek z prośbą, żeby prawdziwe pisma otwierać w pobranym pliku.
- **Dostępność.** Liczniki „×1” przy typach danych w „Zamaskowano” mają wystarczający kontrast
  (WCAG 1.4.3). Przy każdej zmianie axe sprawdza interfejs pod kątem WCAG 2.1 AA, a testy
  w przeglądarce sprawdzają obsługę klawiaturą, tryb dużego kontrastu Windows i powiększenie 200%.
  Raz w tygodniu i przy każdym tagu wydania plik jest sprawdzany w Edge na Windows, w Firefoksie
  i w Chromium 109. W Firefoksie ESR 115 wynik nie przewija się już sam
  w górę.
- **Liczniki.** Liczby w „Zamaskowano” odpowiadają znacznikom w wyniku: „Anna i Jan Kowalscy”
  daje „imię i nazwisko ×2”, a nie ×1.

Bezpieczeństwo, pliki wydania i strona produktu:

- **CSP ze skrótem skryptu.** Parawan.html i strona produktu dopuszczają jeden skrypt, rozpoznany
  po skrócie SHA-256 (`script-src 'sha256-…'` zamiast `'unsafe-inline'`). Kod z wczytanego pisma,
  który trafiłby do wyniku (np. obrazek z `onerror`), nie wykona się.
- **DLA-IOD-I-IT.txt.** Nowy plik w wydaniu opisuje, gdzie są przetwarzane dane, co zostaje na
  komputerze, czego Parawan nie zrobi, ryzyko resztkowe w liczbach z pomiaru, wymagane
  przeglądarki, wdrożenie z dysku sieciowego i zasady GPO dla usług przeglądarki, których CSP nie
  obejmuje. Ma gotowy wpis do ewidencji oprogramowania (KRI § 19) z sumą SHA-256. JAK-UZYC.txt
  dostał wersję, datę, sumę i część „Zanim opublikujesz pismo w BIP”. Oba pliki otwierają się
  w Notatniku i Wordzie z polskimi literami.
- **Sumy i pochodzenie.** Wydanie ma SHA256SUMS.txt i atestację z GitHub Actions
  (`gh attestation verify`), a opis wydania powstaje z tego wpisu i podaje pilność aktualizacji.
  Build z tagu, także na Windows, daje plik o tej samej sumie. Błędy bezpieczeństwa zgłasza się
  według SECURITY.md.
- **Strona produktu.** Sekcja „Dla inspektora ochrony danych i działu IT” zbiera najważniejsze
  fakty z DLA-IOD-I-IT.txt, a Ctrl+P drukuje samą ją, na najwyżej dwóch stronach A4. Metryczka
  podaje sumę SHA-256 najnowszego wydania z poleceniami do PowerShella i wiersza poleceń.
  Przyciski pobierania prowadzą do kopii pliku na domenie strony, bo filtr WWW urzędu bywa
  ustawiony na github.com, a po każdym wdrożeniu automat porównuje jej sumę z wydaniem. Demo na
  stronie dostaje nowy silnik razem z wydanym plikiem.

Na co uważać:

- **Ręczne poprawki należą do jednego tekstu.** Każda zmiana tekstu źródłowego (pisanie,
  wklejenie, Enter, Ctrl+Z w polu) zdejmuje „Zostaw jawne”, „Cofnij zasłonięcie” i zasłonięcia
  „tylko tutaj”, a notka pod wynikiem mówi, ile cofnięto. Trzeba je wtedy zrobić od nowa, więc
  najpierw lepiej poprawić tekst, a dopiero potem przejrzeć znaczniki. Zasłonięcie „wszystkie
  wystąpienia” działa jak reguła: po każdej zmianie zasłania od nowa każde dokładne wystąpienie
  (także z podwójną albo twardą spacją), a gdy go nie ma, zostaje na liście z „0 miejsc”. Ręczne
  zasłonięcie nigdy nie odsłania tego, co zasłonił automat.
- **Teksty bez ręcznej korekty.** Gdy wyniku nie da się dopasować do oryginału co do znaku (np.
  dwa takie same znaczniki obok siebie, z których jeden stał już w piśmie) albo tekst ma ponad
  300 000 znaków, ręczne poprawki są wyłączone i mówi o tym zdanie pod wynikiem. Gdy tekst
  z ręcznymi zasłonięciami urośnie ponad ten próg, kopiowanie, zapis i druk czekają z komunikatem,
  zamiast wydać tekst z jawnym fragmentem.
- **.docx bez układu oryginału.** Wiersz wyniku to akapit, a kolumny tabel zostają tabulatorami.
- **Karta „Adnotacja i protokół” zeruje się przy nowym piśmie** (wczytany plik, Ctrl+A
  i wklejenie, zmiana ponad połowy tekstu), żeby znak sprawy nie przeszedł na następne pismo.
- **Rozmiar.** Parawan.html ma 2 316 486 B, o ok. 50 kB więcej niż v0.46.24, głównie przez
  ręczną korektę, .docx i kartę adnotacji. Build usuwa za to z HTML komentarze i wcięcia.

687 testów rdzenia i 326 testów aplikacji przechodzi, bramka E2E i benchmark bez zmian. Web
i landing 0.46.24 → 0.46.25.

## v0.46.24 — 2026-10-24

**Wydruk samego wyniku, DOCX bez sklejania wierszy, PDF w starszym Edge i Chrome, przebudowany silnik wykrywania i nowy typ danych: numer księgi wieczystej.**

Aktualizacja pilna: wydruk z poprzednich wersji ujawniał dane z pola źródła, a DOCX z końcem
wiersza zapisanym znakiem `<w:cr/>` przepuszczał nazwisko.

Silnik wykrywania zmienił się mocno, więc ten sam tekst da inny wynik niż w v0.46.23. Przed
wydaniem porównano jego wyniki z v0.46.23 na 23 646 dokumentach (bilans i znane regresje na końcu
wpisu).
W przykładach `⇥` oznacza tabulator, a `⏎` koniec wiersza.

Aplikacja i strona produktu:

- **Druk i PDF.** Ctrl+P i nowy przycisk „Drukuj lub zapisz PDF” drukują sam zanonimizowany wynik,
  cały, w obu widokach. Wcześniej na papier trafiała strona aplikacji razem z polem „Tekst
  źródłowy” (jawny PESEL, nazwisko, konto), w „Porównaniu” także przekreślone oryginały, a z wyniku
  tylko to, co mieściło się w okienku. PDF z okna drukowania ma prawdziwy tekst z polskimi
  literami. Pod wynikiem jest podpowiedź, gdzie wyłączyć „Nagłówki i stopki”, bo przeglądarka
  dopisuje tam ścieżkę pliku z nazwą użytkownika komputera.
- **Pobieranie.** Plik .txt ma BOM UTF-8 i końce wierszy Windows, więc Word i Notatnik otwierają go
  bez pytania o kodowanie. Rejestr wczytany z .csv wraca jako .csv, który Excel otwiera z polskimi
  literami.
- **DOCX.** Koniec wiersza zapisany jako `<w:cr/>` (i kilka rzadszych zapisów tabulatora i łamania)
  nie skleja już „Jan” z „Kowalski” w „JanKowalski” (takie sklejenie zostawało jawne). Pusta
  komórka tabeli nie rozrywa imienia i nazwiska. Pliki z innym prefiksem przestrzeni nazw
  i „Ścisły dokument Open XML” wczytują się jak zwykłe. Po wczytaniu Parawan wylicza, czego w pliku nie przeczytał: nagłówki
  i stopki, przypisy, komentarze, obrazy, obiekty osadzone, fragmenty wstawione z innych plików,
  usunięcia ze śledzonych zmian. Osobno ostrzega o ukrytym tekście, także ukrytym przez styl
  (np. cały styl „Notatka wewnętrzna”), bo taki tekst trafia do wyniku jak każdy inny.
- **Starsze przeglądarki.** PDF wczytuje się w Edge i Chrome 109–123 (Windows 7, 8.1, Server 2012
  R2, przeglądarki wstrzymane przez dział IT); wcześniej każdy PDF kończył się „Nie udało się
  odczytać pliku.”. Gdy Parawan w ogóle nie ruszy (bardzo stary silnik, tryb Internet Explorera),
  po 4 s pojawia się żółty pasek z wyjaśnieniem. Cel buildu jest przypięty: Chrome i Edge 109,
  Firefox 115, Safari 16.4.
- **Sesja przeglądarki.** W Chrome i Edge 109 tekst z pola źródła trafiał do plików sesji profilu
  i wracał po ponownym uruchomieniu z przywracaniem kart. Teraz nie trafia. We „Wskazówkach” rada:
  plik lepiej wczytać niż kopiować z Worda, bo kopia zostaje w historii schowka Windows.
- **Bramka testów na gotowym pliku.** `npm run e2e` (Playwright) otwiera Parawan.html i stronę
  produktu z dysku, wczytuje fikcyjne pisma DOCX i PDF, drukuje do PDF i pobiera wynik. Sprawdza,
  że żadna dana nie przechodzi, przeglądarka nie wysłała ani jednego żądania (także odłożonego
  w czasie, przez WebSocket i WebRTC), CSP jest kompletna, a w pamięci przeglądarki, adresie
  i tytule karty nie zostaje treść pisma. Ta sama bramka działa w CI i przed publikacją wydania.
  Fikcyjne pisma urzędowe leżą w `apps/web/src/fixtures/urzad/`.
- **Strona produktu.** Znak marki nad przyciskiem pobierania, jaśniejsze tło i ciemniejszy tekst
  pomocniczy, numer księgi wieczystej w spisie typów (25 zamiast 24).

Wykrywanie:

- **Tekst poza maską zostaje taki jak w oryginale.** Tabulatory, wyrównanie spacjami, kropki
  skrótów i wielkość liter w etykietach się nie zmieniają, więc TSV nie traci kolumn, a JSON
  dalej się wczytuje. `2024-03-01⇥Jan Kowalski⇥Warszawa` dawało
  `2024-03-01⇥[IMIĘ I NAZWISKO] Warszawa`, teraz `2024-03-01⇥[IMIĘ I NAZWISKO]⇥Warszawa`.
  `ORLEN S.A. Jan Kowalski` dawało `ORLEN S.[IMIĘ I NAZWISKO]`, teraz
  `ORLEN S.A. [IMIĘ I NAZWISKO]`. W poprawnym JSON-ie maska w miejscu liczby dostaje cudzysłowy:
  `{"telefon": "[TELEFON]"}`. Drugi numer po „lub” (`tel. 601-222-333 lub 22 501 23 45`) też
  znika.
- **Liczby, które tylko wyglądały na dane.** Kwoty, numery przesyłek, zamówień i seryjne, normy,
  wersje programów i kolumny liczb nie dostają już maski telefonu, tablicy, IP ani MAC.
  `Rysunki wykonano w programie AutoCAD 2024.` dawało `Auto[NR-REJESTRACYJNY]`,
  `Dochody bieżące: 534 210 987,55` dawało `[TELEFON],55`, `Przesyłka RR123456789PL` dawało
  `RR[TELEFON]PL`, a `wersję 2.4.1.0` dawało `wersję [IP]`. Teraz zostają bez zmian. Adresy
  specjalne (`127.0.0.1`, maska `255.255.255.0`, `8.8.8.8`) też zostają, a `git@github.com:…`
  nie jest już e-mailem. W drugą stronę: `Przelew na DE89 3704 0044 0532 0130 00 Z OPCJĄ SHA`
  był jawny, teraz daje `Przelew na [NR-KONTA] Z OPCJĄ SHA`, a IP na końcu zdania
  (`z adresu IP 83.12.45.67.`) dostaje maskę.
- **Nazwy własne, urzędy i patroni.** `Kościół Mariacki w Krakowie`, `Odruch Babińskiego`,
  `Uniwersytet Adama Mickiewicza w Poznaniu` i `Pani Minister Zdrowia podpisała rozporządzenie.`
  zostają bez maski osoby. Wyraz przed nazwiskiem nie znika: `Wczoraj Kowalski przyszedł`
  daje `Wczoraj [IMIĘ I NAZWISKO] przyszedł`, a `Dzień Lisiecka, Noc Brzozowska` w grafiku
  dyżurów daje `Dzień [IMIĘ I NAZWISKO], Noc [IMIĘ I NAZWISKO]`. Zaimek „im” nie jest skrótem
  patrona: `Pomógł im Jan Kowalski` był jawny, teraz daje `Pomógł im [IMIĘ I NAZWISKO]`.
- **Dane rozpoznane tylko w części.** Ogon numeru, imię obok maski, przymiotnik w nazwie miasta
  czy numer lokalu zostawały jawne. `tel.: 0048 12 634 55 21` dawało `tel.: [TELEFON] 55 21`,
  `PESEL: 851 103 142 83` dawało `PESEL: [TELEFON] 83`, `55-080 Kąty Wrocławskie` dawało
  `[KOD-POCZTOWY] [MIEJSCOWOŚĆ] Wrocławskie`, `Anną Schröder` dawało `[IMIĘ I NAZWISKO]öder`,
  a `Kuba Nowak, Ola Nowak` zostawiało oba zdrobnienia. Teraz każda z tych danych jest pod jedną
  maską, tak samo `zam. ul. Hoża 41-43 m. 12` i `ul. Żwirki i Wigury 16/3`. Liczba za ulicą,
  która nie jest numerem domu, zostaje: `Wypadek przy ul. Długiej 5 osób rannych.`
- **Dane obok wyraźnej kotwicy.** Odmiana, skrót z kropką albo dodatkowe słowo między etykietą
  a wartością przepuszczały daną w całości. Teraz `dowodem osobistym serii ABA nr 300000` daje
  `serii [NR-DOWODU]`, `kontakt pod nr 512 345 678` daje `pod nr [TELEFON]`,
  `Telefon pacjenta: 41 344 56 78` daje `Telefon pacjenta: [TELEFON]`, a
  `EWELINA KRAWCZYK z domu MAJEWSKA` maskuje też nazwisko panieńskie. Suma kontrolna dowodu liczy
  się poprawnymi wagami: wcześniej ponad 8 na 10 prawdziwych numerów jej nie przechodziło, więc `okazał dokument PHO996589` był jawny. Adres
  przed zdaniem, które zaczyna się od liczby, nie zjada go już:
  `Mieszka przy ul. Polnej 3. Od 2 lat choruje.` dawało `Mieszka przy [ADRES] lat choruje.`.
- **Tabele, formularze, wersaliki i odmiana.** Wiersze pod nagłówkiem tabeli z kolumną osoby
  dostają maskę w każdej komórce (`imie;nazwisko;pesel⏎Jan;Kos;…` maskowało tylko PESEL). Pola
  w jednym wierszu z TAB-em maskują się pole po polu: `Imię: Jan⇥Nazwisko: Kowalski⇥PESEL: …`
  dawało `Imię: [IMIĘ I NAZWISKO]: [IMIĘ I NAZWISKO]⇥…` (etykieta znikała), teraz
  `Imię: [IMIĘ I NAZWISKO]⇥Nazwisko: [IMIĘ I NAZWISKO]⇥…`. Imiona w odmianie i bez ogonków
  wchodzą do maski (`z powództwa Pawła Kowalskiego przeciwko Agacie Nowak`,
  `z Lukaszem Wisniewskim`), tak samo wersaliki (`Pani Anna KOWALSKA`,
  `Lista obecności: NOWAK PIOTR, WÓJCIK MARIA`, `Nadawca: JAN SIKORA`) i imiona rodziców
  (`Jan Kowalski, syn Józefa i Marii` daje
  `[IMIĘ I NAZWISKO], syn [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO]`). Adres bez „ul.” po
  etykiecie zamieszkania: `Adres zamieszkania: Lipowa 14/3, Gdańsk` daje
  `Adres zamieszkania: [ADRES], [MIEJSCOWOŚĆ]`, a `urodziłam się 12.05.1990 w Łodzi` daje
  `urodziłam się [DATA-URODZENIA] w [MIEJSCOWOŚĆ]`.
- **Loginy i ścieżki.** Maskę `[LOGIN]` dostaje teraz katalog domowy w ścieżce
  (`C:\Users\[LOGIN]\Desktop`, `\\FS01\home$\[LOGIN]`), konto AD (`Konto AD: [LOGIN]`), zapis
  domenowy (`Login: FIRMA\jkowalski` daje `Login: [LOGIN]`), login w logach sshd
  (`Accepted publickey for [LOGIN] from [IP]`) i profil w adresie. Login z pola znika też
  w reszcie dokumentu, np. w linku (`https://github.com/[LOGIN]`) i w zwykłym zdaniu
  (`Zablokowano konto [LOGIN].`). Login, który jest zwykłym słowem (`Login: mazur`), dostaje
  maskę tylko w polu. Konta systemowe i działów (`/home/ubuntu`, `C:\Users\geodezja`) zostają
  jawne.
- **Nowy typ: numer księgi wieczystej `[NR-KW]`.** Taki numer prowadzi przez publiczną
  przeglądarkę ksiąg wprost do właściciela nieruchomości. Po słowach „KW”, „Kw nr”, „księga
  wieczysta”, „księgi wieczystej”, „księdze wieczystej” i „księgą wieczystą” numer znika także
  z błędną cyfrą kontrolną: `objętej księgą wieczystą KW nr KR1P/00234567/6` daje
  `objętej księgą wieczystą KW nr [NR-KW]`, `w księdze wieczystej KR1P/00234567/1` daje
  `w księdze wieczystej [NR-KW]`, a wyliczenie
  `KW nr KR1P/00234567/6, KR1P/00234567/1 oraz WA2M/00512345/0` daje
  `KW nr [NR-KW], [NR-KW] oraz [NR-KW]`. Bez słowa obok numer musi mieć poprawną cyfrę
  kontrolną i kod znanego sądu (`nieruchomość [NR-KW] położona w Krakowie`). Działa też
  w kolumnie „Nr KW”, w XML i JSON oraz w linku do przeglądarki ksiąg.
  `Zamówienie nr AB1C/12345678/0` i `kw. 2026` zostają. W aplikacji jest osobny przełącznik
  „Nr księgi wieczystej” w grupie Identyfikatory.
- **Wydajność.** Długi ciąg bez spacji (wklejony blok base64, łańcuch kropek) zamrażał kartę:
  50 000 znaków `a.a.a.…` liczyło się 1,5 s, a 100 000 znaków 7 s. Teraz to milisekundy.
- **Znane regresje.** Bilans względem v0.46.23 objął 5911 pism z korpusu audytu i benchmarku
  oraz 17 735 tekstów pisanych pod atak (warianty pułapek i dawnych regresji), w trybie zwykłych
  masek i z pseudonimami, wiersz po wierszu. Lepiej wypada około 43,7 tys. miejsc (32 tys.
  domkniętych wycieków, 11,7 tys. zdjętych nadmaskowań), gorzej 334: 170 nowych wycieków lub
  jawnych fragmentów i 164 nowe nadmaskowania. Z tych 334 tylko 10 pochodzi z korpusu zwykłych
  pism, reszta z tekstów pod atak. Liczby dla tekstów pod atak to ekstrapolacja z ręcznie
  sprawdzonej próbki 300 różnych wierszy. Klasy:
  - formularz z TAB-em, w którym rola stoi jako etykieta: `Powód:⇥Jan⇥Nazwisko:⇥Nowak` daje
    `Powód:⇥Jan⇥Nazwisko:⇥[IMIĘ I NAZWISKO]`, czyli imię jest jawne (v0.46.23 maskowało obie
    wartości, choć gubiło etykietę „Nazwisko”). Tak samo przy Oskarżonym i Kupującym oraz
    w układach `Status⇥Poszkodowany⇥Imię⇥Jan⇥…` i `Funkcja⇥Świadek⇥Imię⇥Jan⇥…`. W części
    formularzy z Dłużnikiem jawne zostaje imię tam, gdzie v0.46.23 zostawiało nazwisko.
    Bez zmian względem v0.46.23, ale z pełnym wyciekiem: `Rola⇥Poszkodowany⇥Imię⇥Ewa⇥Nazwisko⇥Lis`
    zostawia całą osobę jawną;
  - pierwsza osoba w wyliczeniu w celowniku: `Przyznano Piotrowi Janowi i Annie Nowak dodatek.`
    daje `Przyznano Piotrowi Janowi i [IMIĘ I NAZWISKO] dodatek.`, a w
    `Doręczono Barbarze Annie i Zbigniewowi Pawlakom.` jawne zostaje samo „Annie”. Podobnie
    `dla Jana Pawła i Marka Nowaków` daje `dla Jana Pawła i [IMIĘ I NAZWISKO]`;
  - dwa imiona bez nazwiska brane za osobę: `Annie Paweł i Ola kupili kwiaty` daje
    `[IMIĘ I NAZWISKO] i Ola kupili kwiaty`;
  - postać historyczna albo patron WERSALIKAMI przy nazwie obiektu i w zapisie mieszanym:
    `GABINET JÓZEFA PIŁSUDSKIEGO W BELWEDERZE` daje `GABINET [IMIĘ I NAZWISKO] W BELWEDERZE`,
    a `Janusz KORCZAK prowadził sierociniec.` daje `[IMIĘ I NAZWISKO] prowadził sierociniec.`;
  - spójność pseudonimów, bez wycieku: przy `Imiona⇥Jan Stanisław⇥Nazwisko⇥Kowalski` imiona
    dostają maskę ogólną, a nazwisko `[OSOBA-A]`.
- **Świadome koszty.** Kilka rzeczy maskowanych w v0.46.23 celowo przestaje być maskowanych.
  Nazwisko, które jest też przymiotnikiem albo nazwą miejsca, zostaje jawne nawet przy kotwicy
  osoby (`Poselski złożył wniosek.`, `Wnioskodawca: Kampinoski`, `Kazimierz Dolny złożył
  wniosek.`), bo maskowanie zabierało nazwy urzędów i miejscowości. Jawne zostaje też rzadkie
  nazwisko na „-nicz” w dopełniaczu bez imienia (`Pozew Bartnicza`) i infolinia
  (`Infolinia 800 123 456`). Zagraniczny numer VAT UE (`DE811569869`) nie dostaje już maski, bo
  dawne `DE[TELEFON]` było przypadkowym kawałkiem telefonu. Telefon bez kotwicy złamany wierszem
  (`pod 512 345⏎678`) przestał być maskowany, bo kolumny liczb nie są już telefonem. Z kotwicą
  (`dzwonić pod`, `tel.`) dalej znika. Samo imię bez nazwiska zostaje jawne jak wcześniej, a model
  po marce (`samochód marki Honda CB 650R`) dalej dostaje `[NR-REJESTRACYJNY]`, bo ma kształt
  tablicy.

687 testów rdzenia przechodzi. Bramka benchmarku bez regresji na zbiorze rozszerzonym z 319 do 496
przypadków (recall 97,8%, precyzja 99,9%). Te liczby są też na stronie produktu i w README.
Golden-master zaktualizowany razem ze zmianami zachowania. Web i landing 0.46.23 → 0.46.24.

## v0.46.23 — 2026-10-15

**Content-Security-Policy w Parawan.html, poprawki aplikacji po audycie UI i nowa strona produktu.**

Silnik wykrywania (`packages/core/src`) bez zmian względem v0.46.22, więc wynik maskowania jest
taki sam.

- **CSP w gotowym pliku.** Build wstawia na początku Parawan.html politykę `default-src 'none'`
  i `connect-src 'none'`: przeglądarka blokuje połączenia skryptów i zasoby spoza pliku.
  Obecność polityki sprawdzają CI i release (wzorzec na samym tagu meta). JAK-UZYC.txt
  ma notkę dla działu IT.
- **Import plików.** DOCX o rozmiarze kilku KB nie zamraża już karty (27–35 s → ok. 50 ms).
  Plik z zaniżonym rozmiarem w nagłówku ZIP jest odrzucany od razu. „Cofnij” działa po
  „Wyczyść”, „Przykład” i wczytaniu pliku. Lepsze komunikaty o kodowaniu i formatach.
- **Wynik i porównanie.** Ctrl+A w wyniku zaznacza sam wynik. Znacznik tuż za nową wartością
  nie liczy się jako nowe wykrycie. Fokus z klawiatury na znaczniku ustawia bieżący fragment.
- **Dostępność i dymki.** Nazwy dostępne pigułek bez znaków z CSS, Esc zamyka dymki, dymki
  nie wychodzą poza edytor przy 320 px, klik w obszar dymka trafia w to, co pod nim leży.
- **Treść aplikacji.** Odmiana liczebników („1 kategoria”, „2 fragmenty”), polskie nazwy
  wszystkich typów w chipach, „znacznik” zamiast „maska/placeholder”, przycisk zatrzymania
  animacji. CLI odmienia licznik wystąpień.
- **Strona produktu przebudowana.** Pierwszy ekran to działające demo. Dalej: co się stało
  z przykładem, 24 typy i cztery sposoby rozpoznawania z parami „zasłania / zostawia”, jak
  samemu sprawdzić, że tekst nie wychodzi z karty (licznik żądań, odłączona sieć, zakładka
  Sieć, cytat CSP), skuteczność z pomiaru razem z prawdziwymi wpadkami, metryczka pliku.
  Przykłady z treści strony testy przepuszczają przez `redactPII`.

## v0.46.22 — 2026-07-20

**Nowy typ danych: numer KSeF (Krajowy System e-Faktur).**

Numer KSeF zaczyna się od NIP-u wystawcy, więc bez własnego przebiegu `passNip` maskował sam
prefiks i zostawiał `[NIP]-20250826-0100001AF629-AF` — wyciek fragmentu danej. Nowy przebieg
`passKsef` biegnie jako PIERWSZY w fazie identyfikatorów numerycznych (przed IBAN/PESEL/NIP)
i maskuje numer w całości jako `[NR-KSEF]`.

- **Kotwica DOKUMENTOWA**: numer maskujemy, gdy słowo „KSeF" (albo „Krajowy System e-Faktur")
  pada gdziekolwiek w tekście — wtedy znikają wszystkie wystąpienia numeru. Kotwica sąsiedzka
  („etykieta tuż przed numerem", jak przy KRS) przepuszczała realne pisma: etykieta stoi
  w nagłówku kolumny tabeli/CSV, po numerze („…-AF — to numer KSeF"), w znacznikach
  (`**Nr KSeF:**`, `<td>Nr KSeF</td>`), a pod jedną etykietą stoi wyliczenie kilku numerów.
- **Oba formaty w obiegu**: 35-znakowy z KSeF 2.0 (`NIP-RRRRMMDD-12 znaków-suma`) i historyczny
  36-znakowy z KSeF 1.0 (część techniczna rozbita 6+6). Schemat FA(3) dopuszcza w pierwszym
  członie także `M`+9 cyfr (obsłużone) i 3 litery+7 cyfr (wycięte, patrz niżej).
- **Druga warstwa: losowość części technicznej + suma kontrolna NIP-u + zakres daty.** Kotwica
  dokumentowa jest słabsza niż etykieta tuż przy numerze, a sam kształt (10 cyfr · 8 cyfr ·
  12 znaków hex · 2 znaki) noszą też numery zamówień, inwentarzowe, seryjne, identyfikatory
  korelacji z logów i sklejone kolumny kwot — audyt maskował je w dokumentach, w których „KSeF"
  pada przy okazji. Sama suma NIP-u nie wystarcza: przechodzi ją co jedenasty losowy ciąg
  10 cyfr (zmierzone 8,97%). Dlatego wymagamy też **co najmniej jednej litery A–F** w części
  technicznej — prawdziwy numer ma tam losowy hex (szansa na brak litery ≈ 0,14%), a numery
  zamówień i kwoty mają same cyfry. Zero wiodące w NIP-ie odrzucamy wprost. Wariant pierwszego
  członu „3 litery + 7 cyfr" (dopuszczony w XSD FA(3), w praktyce niespotykany) został wycięty.
- **Własnej sumy KSeF-a NIE walidujemy**: CRC-8 zgadza się dla numerów z KSeF 2.0, ale numery
  z KSeF 1.0 go nie przechodzą (znane rozbieżności w repozytoriach MF) — twardy warunek
  odrzucałby prawdziwe numery.
- **Separatorem jest TYLKO myślnik** (też półpauza/pauza/dywiz miękki, ze spacjami i złamaniem
  wiersza PO nim — tak łamie się numer w wąskiej kolumnie). Dopuszczenie spacji jako separatora
  zjadało cztery sąsiednie kolumny liczb w raporcie („KSeF 5265877635 20250826 000000012345 23"),
  a złamanie wiersza PRZED myślnikiem scalało listę punktowaną — oba warianty odrzucone
  po audycie adwersarialnym.

- **Numer w ŚCIEŻCE URL-a** (`…/faktura/5265877635-…-AF/upo`) zdejmowany już przy ochronie
  adresów — bez tego NIP wystawcy zostawał jawny w linku. Numer doklejony myślnikiem do
  etykiety lub nazwy pliku (`Nr KSeF-5265…`, `faktura-5265…-AF.xml`) też jest maskowany.

Precyzja: numer referencyjny sesji (`20250626-SO-…`) zaczyna się od DATY, nie od NIP-u, i nie
zawiera danych podatnika — zostaje nietknięty nawet obok słowa „KSeF".

ŚWIADOMIE POMINIĘTE: numer KSeF BEZ etykiety (wtedy jak dotąd znika sam NIP-prefiks), token
autoryzacyjny KSeF, numery referencyjne sesji/UPO oraz identyfikator zbiorczy.

Landing: numer KSeF w przykładzie live demo, w chmurze typów, w notce o sumach kontrolnych
i w karcie „Księgowość" (24 typy zamiast 23).

Kotwicę liczymy na ORYGINALNYM wejściu: adres portalu w linku i skrzynka w stopce
(`ksef@mf.gov.pl`) bywają jedyną wzmianką o systemie, a wcześniejsze przebiegi już je maskują.
Przebieg biegnie też przed znakiem sprawy — kształt numeru pasował do wzorca JRWA i dostawał
maskę `[ZNAK-SPRAWY]`.

Bez regresji: 334 testy zielone, golden-master bez zmian w istniejących przypadkach, bramka
benchmarku bez regresji (recall 94,8%, precyzja 99,7%). Trzy rundy audytu adwersarialnego
(FP / FN / kolejność przebiegów / wydajność) zamknięte — po drodze zniknęła też kwadratowa
złożoność w dokumentach z tysiącami linków (1 MB: 3,7 s → 0,12 s).
Rdzeń 0.29.11 → 0.29.12, web/landing 0.46.21 → 0.46.22.

## v0.46.21 — 2026-07-19

(wpis odtworzony z historii commitów)

**Strona produktu po audycie treści, SEO i dostępności: aktualne liczby skuteczności, demo zgodne
z silnikiem i tekst przepisany na prostszą polszczyznę.**

Silnik i aplikacja bez zmian (rdzeń dalej 0.29.11), wersja aplikacji podbita razem ze stroną.
Doszły skrypty pomocnicze dla autora, uruchamiane ręcznie poza stroną.

- **Treść strony.** FAQ wylicza wszystkie 23 typy (brakowało znaku sprawy). Sekcja
  o przejrzystości ma panel „Skuteczność zmierzona, nie obiecana” z nowym pomiarem: wykrywalność
  94,8%, trafność 99,7%, F1 97,2% na 309 zdaniach (wcześniej 94,2% i 96,8% na 268 zdaniach).
  Przyciski pobierania prowadzą prosto do pliku `Parawan.html` z najnowszego wydania zamiast do
  listy wydań, a stopka ma link do npm, „Wszystkie wydania” i „Ograniczenia”. (05b2509)
- **SEO i podgląd linku.** Obraz podglądu 1200×630 dla serwisów społecznościowych, adres
  kanoniczny, ikona dla iOS, dane strukturalne JSON-LD, krótszy opis (153 znaki zamiast około
  280) i tytuł (60 znaków). Obraz powstaje z ręcznie uruchamianego `scripts/og/generate.mjs`
  i leży w plikach strony, która dalej nie wykonuje żadnych żądań. (05b2509)
- **Kontrast WCAG AA.** Ciemniejsze odcienie złota tylko na stronie produktu: etykiety i kroki
  5,05:1 na kremowym tle, biały tekst na przyciskach 4,83:1. Małe teksty dostały ciemniejszy
  kolor (5,45:1). Kolory wspólne z aplikacją bez zmian. (05b2509)
- **Demo zgodne z silnikiem.** Znaczniki `[NR-KARTY]` i `[LOGIN]` wyświetlały się w demo jako
  zwykły tekst, a widok „Porównanie” się rozjeżdżał. Teraz są rozpoznawane, a karta płatnicza
  trafia do kategorii Finanse. Notka o sumach kontrolnych twierdziła, że sygnatura akt zostaje
  nietknięta, choć chip „znak sprawy” mówi o jej maskowaniu, więc przykład zmieniono na numer
  przepisu. Krok 1 nie obiecuje już upuszczania pliku na stronę, tylko w oknie pobranego
  narzędzia. (e81308e)
- **Dostępność.** Link pomijający nawigację widać przy fokusie z klawiatury, treść jest
  w `<main>`, sekcja ograniczeń ma nagłówek h2. Wynik demo nie ma już `aria-live`, bo czytnik
  ekranu dostawał cały wynik po każdej serii klawiszy. Obrys fokusu na ciemnozielonym tle jest
  biały, a tekst chipów ma kontrast 5,59–6,07:1 zamiast 4,10–4,49:1. Te poprawki to część
  20 wad potwierdzonych w audycie wieloagentowym. (e81308e)
- **Ton tekstu.** Treść przepisana na zwykłą polszczyznę: z 51 wtrąceń myślnikowych zostało około
  trzech, zniknęły puste wzmacniacze („100%” w prozie, „w pełni”, „po prostu”). Strona przestała
  też mówić jak firma („naszych serwerach”, „maskujemy”), bo to lokalne narzędzie jednego autora.
  Liczby i układ bez zmian. (3d141f1, 73366d9)
- **Drobiazgi wizualne.** Kafelek z plikiem `Parawan.html` na stronie ma teraz ikonę `</>`
  w zielonym kolorze marki zamiast niebieskiej ikony adresu. W tabeli
  porównania „wysokie ryzyko wycieku” na czerwono zmieniło się na „podwyższone” na bursztynowo.
  Krótkie bloki łamią się równiej, a po jednoliterowych spójnikach stoją twarde spacje
  (wstawia je `scripts/typografia/nbsp.mjs`). (5def39e)
- **Statystyki odwiedzin po stronie Cloudflare.** `scripts/analytics/cf-stats.mjs` (Node, bez
  zależności) czyta z API GraphQL Cloudflare zagregowane dane ruchu strony produktu: odwiedziny,
  żądania, trend dzienny albo godzinowy, kraje oraz podział na ludzi i boty. To narzędzie autora
  uruchamiane z wiersza poleceń. Strona nie dostała żadnego skryptu analitycznego, dalej nie
  wysyła żadnych żądań, a jej licznik żądań nadal pokazuje zero. Dane dostępowe skrypt bierze ze
  zmiennych środowiskowych (`CLOUDFLARE_API_TOKEN`, awaryjnie `CLOUDFLARE_API_KEY`
  z `CLOUDFLARE_EMAIL`, opcjonalnie `CLOUDFLARE_ZONE_ID`), nigdy z repozytorium.
  (6a342d5, e5a208d, 3026e7d)

## v0.46.20 — 2026-07-16

**Rdzeń: trzy wady WCZEŚNIEJSZE (wykryte audytami v0.46.18–19) domknięte bez regresji.**

- **Imię osierocone przy rozerwaniu pary:** gdy nazwisko było maskowane, a imię zostawało jawne —
  „Jan\nWiśniewski" (imię na końcu wiersza) oraz „Gosia z Lewandowskich" (nazwisko panieńskie).
  (1) Domknięcie imienia przed maską obejmuje teraz JEDNĄ nową linię (gate `isFirstNameLike` chroni
  prozę: „protokół\n[OSOBA]" zostaje). (2) Nowy pass panieński „Imię z Nazwiskoskich"/„z domu Nazwisko"
  → jedna osoba. Po gołym „z" WYMÓG dopełniacza l.mn. (-skich/-ckich/-ich/-ych/-ów) ODRÓŻNIA
  panieńskie od NARZĘDNIKA „Anna z Kowalskim" (= „z kimś", dwie osoby — imię zostaje) i od miejsca
  („z Krakowa").
- **REGON/PESEL po etykiecie z wieloma wyrazami:** „REGON zakładu opiekuńczego wynosi 012345675"
  wyciekał — wtrącenie między etykietą a numerem dopuszczało do 2 wyrazów; teraz do 3.
- **Uzupełnienie słownika imion:** dodano częste imiona brakujące w słowniku (Barbara, Genowefa,
  Czesław, Bronisław, Eugeniusz) — bez nich „Barbara Nowak" osierocała imię (nazwisko maskowane,
  imię jawne), gdy nazwisko nie miało sufiksu morfologicznego.

ŚWIADOMIE POMINIĘTE (wprowadzałyby regresje): PESEL po „nr" (bez etykiety „PESEL" ~10% numerów spraw
losowo przechodzi sumę PESEL → FP) oraz przymiotniki GMINNE po roli („Wójt Klembowski" — „-owski" to
najczęstszy sufiks NAZWISKA, dodanie gmin wyciekłoby realne nazwiska).

Bez regresji: 321 testów zielonych, golden-master czysto addytywny, bramka benchmarku bez regresji
(recall 94,8%, precyzja 99,7%). Zweryfikowane adwersarialnie. Rdzeń 0.29.10 → 0.29.11, web/landing 0.46.19 → 0.46.20.

## v0.46.19 — 2026-07-16

**Rdzeń: cztery domknięcia wykryte audytem adwersarialnym v0.46.18 + systemowe zdrobnienia imion.**

- **PESEL/NIP/REGON po słabym łączniku:** „PESEL **to** 71030512399", „PESEL o numerze …",
  „NIP to …" wyciekały — grupa wtrącenia między silną etykietą a numerem dopuszczała tylko wyraz
  ≥3 liter. Teraz obejmuje krótkie łączniki „to/o/nr" (do 2 wyrazów). Zgodne z zasadą „przy silnej
  etykiecie maskuj MIMO złej sumy".
- **ADRES z typem ulicy bez skrótu:** „zam. Rondo Romana Dmowskiego 3/7" wyciekał (i kaskadowo
  miasto) — prefiks ADRES znał tylko ul./al./os./pl. Dodano **rondo/most/skwer/bulwar** (odmieniane).
  „park" ŚWIADOMIE pominięty (częsta nazwa instytucji — „Park Narodowy … 2024" dawał FP). Dla nowych
  typów GOŁA 4-cyfrowa liczba-ROK (1900–2099) NIE jest numerem domu („Most Grunwaldzki 1910",
  „Bulwar Filadelfijski 1998" zostają) — strażnik dodany po audycie.
- **Kotwica IBAN nie zjada następnego słowa:** „…3152 wpłynęły" dawało „[NR-KONTA]łynęły" — flaga
  `/i` pozwalała klasie `[A-Z0-9]` wartości łapać małe litery „wp" przylegające do diakrytyku „ł".
  Usunięto `/i` z wartości (warianty etykiety wyliczone jawnie). Wada wcześniejsza (od v0.44.0).
- **Przymiotnik ODMIEJSCOWY powiatowy po roli:** „Starosty Wołomińskiego" → [OSOBA] (nadmaskowanie).
  Gałąź dzierżawczego dopełniacza (RE_PAIR) nie sprawdzała `NON_SURNAME_ADJ` (inaczej niż sąsiednie)
  — dodano guard `isGeoAdjective`. `NON_SURNAME_ADJ` rozszerzone o ~300 przymiotników powiatowych
  (wygenerowane i zweryfikowane adwersarialnie; wykluczono formy będące częstym NAZWISKIEM).
- **Zdrobnienia imion (systemowo):** „Janek Kowalski", „Kasia Nowak", „Tomek/Gosia/Zosia/Franek …"
  nie były wykrywane — słownik miał tylko formy pełne. Dodano ~150 kuratorowanych zdrobnień
  (mianownik). Imiona maskowane TYLKO w parze z nazwiskiem/po wyzwalaczu, więc samo zdrobnienie
  („Janek poszedł") ani wyraz pospolity o podobnej formie („anka zamówień") nie są maskowane.

Bez regresji: 317 testów zielonych, golden-master czysto addytywny, bramka benchmarku bez regresji
(recall 94,6%, precyzja 99,7%). Zweryfikowane adwersarialnie wieloagentowo.
Rdzeń 0.29.9 → 0.29.10, web/landing 0.46.18 → 0.46.19.

## v0.46.18 — 2026-07-16

**Rdzeń: dwie wady wykryte audytem adwersarialnym v0.46.17 — eponimy uliczne i telefon 2-3-2-2.**
Domknięcie w duchu „precyzja > nadmaskowanie": jedna poprawka precyzji (mniej nadmaskowania),
jedna recall (więcej trafnego maskowania), obie bez nowych fałszywych trafień.

- **Nadmaskowanie eponimów ulicznych (patronów):** para „imię nazwisko" BEZPOŚREDNIO po wyrazie
  ULICZNYM („ulica Tadeusza Kościuszki", „Rondo Romana Dmowskiego", „ul. gen. Andersa") była
  maskowana jako osoba. Nowy strażnik `precededByStreetEponym` (+ `RE_STREET_WORD` dla wyrazu
  ulicznego wciągniętego do dopasowania) dodany do detektora PAR (13a/a2) oraz do detektorów SOLO
  (13c/13c1a/13c2/OCR). Pokrywa: końcówki diakrytyczne kotwicy („aleją/ulicą" — granice Unicode
  `\p{L}` zamiast ASCII-owego `\b`), RANGI między kotwicą a nazwą („ul. gen. Andersa", „ul. ks.
  Popiełuszki") i krótką formę solo („Ronda Dmowskiego"). Strażnik jest **zachowawczy**: działa
  tylko w JEDNEJ LINII, tuż po kotwicy, BEZ mostkowania spójników „oraz/i", przecinka, nowej linii
  i kropki — każdy z nich wchłaniał REALNĄ osobę z następnej klauzuli/wiersza („ulicy X oraz Jan
  Kowalski", „skwer X\nOsoba") — więc „choroba Jana Kowalskiego", „na ulicy spotkałem Jana
  Kowalskiego", „gen. Jan Kowalski" (bez ulicy) to nadal OSOBA (recall utrzymany). Cena: DRUGI
  patron w wyliczeniu „ulic X oraz Y" bywa nadmaskowany (zamaskowana nazwa ulicy, nie wyciek PII).
- **Niedomaskowanie telefonu 2-3-2-2 po kotwicy pośredniej:** „kontakt telefoniczny pod numerem
  32 774 91 55" wyciekał, bo między kotwicą a cyframi stało „pod numerem". Grupa separatora trybu
  kotwicowego (b) przyjmuje teraz most „pod/numer…". Numer 2-3-2-2 **bez** kotwicy telefonicznej
  CELOWO zostaje jawny (kontekstowy fallback dawał FP na „Pozycja 32 774 91 55 w wykazie" — zasada
  „nadmaskowanie gorsze niż drobny wyciek").

Bez regresji: 312 testów zielonych (4 nowe), golden-master czysto addytywny, bramka benchmarku bez
regresji (recall 94,5→94,6%, precyzja 99,7% utrzymana). Zweryfikowane adwersarialnie wieloagentowo.

Rdzeń `anonimizator` 0.29.8 → 0.29.9, aplikacja web 0.46.17 → 0.46.18, landing 0.46.17 → 0.46.18.

## v0.46.17 — 2026-07-16

**Rdzeń: trzy poprawki nad/niedomaskowania z realnej petycji do Urzędu Marszałkowskiego.**
Audyt pisma („System FINN 8 SQL", petycja stowarzyszenia) ujawnił jedną jaskrawą niespójność:
fraza „Urzędu Marszałkowskiego Województwa Śląskiego" była raz maskowana jako osoba
(„Urzędu [OSOBA-A]"), raz nie — zależnie od łamania wiersza.

- **Nadmaskowanie „Marszałkowski/ego":** przymiotnik URZĘDOWY (Urząd/Sejmik/Zarząd Marszałkowski)
  trafił do stoplisty `NON_SURNAME_ADJ` — analogicznie do „wojewódzki", „królewski", „lekarski".
  Osoba o nazwisku „Marszałkowski"/„Marszałkowska" w parze z imieniem (np. „Jan Marszałkowski")
  **jest nadal maskowana** — łapie ją słownikowy detektor imię+nazwisko, niezależny od stoplisty.
- **Niedomaskowanie adresu WERSALIKAMI:** kotwica ulicy była case-sensitive („ul." tak, „UL." nie),
  więc adresy ze skanów/OCR („UL. KWIATOWA 5", „AL. JANA PAWŁA II 12", „OS. TYSIĄCLECIA 3",
  „PL. DEFILAD 1") wyciekały. Każda litera skrótu jest teraz case-insensitive — adres OSOBY
  zapisany WERSALIKAMI już nie ucieka.
- **Niedomaskowanie miejscowości z anotacją TERYT:** nowy pass 12h maskuje „Gliwice (miasto)",
  „Nowa Sól (miasto)", „Zabłudów (gmina miejsko-wiejska)" — etykieta rodzaju jednostki
  („(miasto)/(gmina …)/(wieś)") to mocna kotwica pola słownikowego systemów e-urzędowych.
  Strażniki `LEGAL_ENTITY_WORDS`/`NON_SURNAME_ADJ` chronią „Sąd Rejonowy (miasto)" i „Śląski (miasto)".

Bez regresji: 308 testów zielonych (4 nowe), golden-master czysto addytywny, bramka benchmarku
bez regresji (strukturalne 100%/100%). Zmiany zweryfikowane adwersarialnie wieloagentowo na
realistycznych pismach urzędowych — zero nowych nad/niedomaskowań z powyższych trzech zmian.

Rdzeń `anonimizator` 0.29.7 → 0.29.8, aplikacja web 0.46.16 → 0.46.17, landing 0.46.16 → 0.46.17.

## v0.46.16 — 2026-07-16

**Rdzeń: imię/nazwisko WERSALIKAMI po tytule lub roli.** Domknięcie luki zapowiedzianej w v0.46.15:
zapis w całości WIELKIMI literami po tytule/roli („SSO JAN KOWALSKI", „PANEM MARKIEM WIŚNIEWSKIM",
„PAN KOWALSKI", „POZWANY JAN KOWALSKI") był pomijany — reguły Titlecase go nie łapały, a detektor
par WERSALIKAMI odrzucał kandydatów zaczynających się od tytułu.

- Nowy pass `passPersonOcrTitle`: „[TYTUŁ/ROLA WERSALIKAMI] [IMIĘ?] [NAZWISKO WERSALIKAMI]" →
  maska; **tytuł/rola zostaje** (sens wiersza zachowany). Uruchamiany przed detektorem par, by ten
  nie sparował zachłannie „tytuł + imię" i nie osierocił nazwiska.
- Precyzja utrzymana: wymagany **rozpoznany tytuł/rola** (Pan/Pani w odmianie, SSO/SSR/SSA, dr/prof/
  mec, sędzia/prokurator/pozwany/świadek…) **oraz nazwisko potwierdzone** słownikiem/morfologią i
  niebędące encją prawną ani przymiotnikiem odmiejscowym. Dzięki temu nagłówki instytucji
  WERSALIKAMI zostają nietknięte („SĄD OKRĘGOWY W WARSZAWIE", „UNIWERSYTET WARSZAWSKI",
  „WOJEWODA MAZOWIECKI", „PREZES ZARZĄDU SPÓŁKI").

Bez regresji: benchmark precision-proxy 99,7% (bez zmian), recall 100% na kategoriach
deterministycznych, golden-master czysto addytywny (żaden istniejący przypadek się nie zmienił),
304 testy zielone (nowe must-mask + must-not-mask WERSALIKAMI).

Rdzeń `anonimizator` 0.29.6 → 0.29.7, aplikacja web 0.46.15 → 0.46.16, landing 0.46.15 → 0.46.16.

## v0.46.15 — 2026-07-15

**Rdzeń: imiona i nazwiska wykrywane niezależnie od wielkości liter — ale tylko w kontekście.**
Wcześniej „pAMELA", „PAMELA" czy „pamela" prześlizgiwały się, bo regexy wyłuskujące kandydata
wymagały Titlecase. Teraz poluzowaliśmy to **wyłącznie tam, gdzie kontekst już gwarantuje, że to
imię** — Titlecase + wymóg pary pozostają jedyną tarczą precyzji dla solo-nazwisk (homonimy jak
„jagoda", „maja", „kalina" nietknięte).

- **Silne wyzwalacze self-ID** („nazywam się", „mam na imię") — nowy pass łapie następujące po nich
  imię/nazwisko w dowolnej wielkości liter („nazywam się pAMELA nOWAK", „mam na imię PAMELA").
  Ufa wyzwalaczowi tylko, gdy kandydat wygląda na nazwę własną albo słownik/morfologia go potwierdza
  — „nazywam się tak, jak trzeba" zostaje. **„Pan/Pani" świadomie NIE poluzowane** (po nich bywa
  czasownik: „Pan był", „Pani ma").
- **Pola formularza i klucze strukturalne** („Imię:", „Nazwisko:", JSON `firstName`/`lastName`) —
  wartość maskowana też małą i mieszaną literą (etykieta/klucz to mocna kotwica). WERSALIKI działały
  już wcześniej. Miejscowość (`place`) celowo bez zmian.
- **Słownik imion** uzupełniony o częste pozycje (Pamela, Melania, Kornelia, Apolonia, Sonia…) —
  odblokowuje pary „imię nazwisko" pisane WERSALIKAMI i małymi literami przez istniejące passy.

Precyzja bez regresji: benchmark precision-proxy 99,7% (bez zmian), recall 100% na kategoriach
deterministycznych, golden-master i testy zielone (nowe przypadki must-mask + must-not-mask casingu).
Znane ograniczenie (bez zmian): all-capsowe imię+nazwisko w ciągu z tytułem („SSO JAN KOWALSKI")
nadal bywa pomijane — to osobna luka `passPersonOcrPair`, nietknięta tą zmianą.

Rdzeń `anonimizator` 0.29.5 → 0.29.6, aplikacja web 0.46.13 → 0.46.15, landing 0.46.14 → 0.46.15.

## v0.46.14 — 2026-07-15

**Landing (parawan.karolwilczynski.com): pomysły z projektu w Claude Design.** Dwie zmiany
wizualne, wyłącznie HTML/CSS — bez zmian w narzędziu ani silniku.

- **Hero „Redakcja na żywo" (kierunek 1a):** dokument w wizualu hero dostał animowaną bursztynową
  linię skanującą, sunącą po piśmie („analiza na bieżąco"). Szanuje `prefers-reduced-motion`
  (linia znika). Nagłówek, CTA i box prywatności bez zmian.
- **„Co znika za parawanem" — chmura tagów:** sekcja „Co wykrywa" zamiast 6 kart pokazuje wszystkie
  23 typy jako jedną, skanowalną chmurę kolorowych chipów (kolory 5 kategorii + legenda). Notka
  o sumach kontrolnych zachowana (przekaz „precyzja > nadmaskowanie").

Landing 0.46.12 → 0.46.14. Rdzeń i aplikacja web bez zmian.

## v0.46.13 — 2026-07-14

**UI: „Karta płatnicza" i „IBAN / nr konta" w jednym rzędzie w „Co maskować".** Przełącznik nowej
karty stał wcześniej pod IBAN-em (osobny wiersz). Pas Kontakt+Finanse zajmuje teraz cały rząd
(e-mail · telefon · IBAN · karta) na szerokich ekranach; poniżej ~1240px spłaszcza się czytelnie
(nagłówki na całą szerokość, elementy pod spodem) — bez wypadania karty poza pas. Tylko CSS.

Aplikacja web 0.46.12 → 0.46.13. Rdzeń i landing bez zmian.

## v0.46.12 — 2026-07-14

**Nowy typ: karta płatnicza (Visa/Mastercard/Amex/Discover/Diners/JCB/Maestro).** 23. typ danych.

- Wykrywanie numerów kart: 13–19 cyfr + prefiks znanej sieci + suma **Luhna**, TYLKO z kontekstem
  karty („karta/Visa/Mastercard/Amex…", pole `card=` w URL). Placeholder `[NR-KARTY]`, kategoria
  Finanse.
- Kontekst jest wymagany ŚWIADOMIE: audyt adwersarialny na realistycznych pismach pokazał, że sam
  Luhn+prefiks daje fałszywe trafienia na IMEI (15 cyfr, ma sumę Luhna!), numerach przesyłek, kodach
  kreskowych (EAN) i identyfikatorach transakcji. Precyzja > nadmaskowanie: **FP = 0** na zbiorze
  audytowym; nietypowe formaty (separator kropka/ukośnik, kontekst nieprzylegający) świadomie pomijane.
- Dodane do rdzenia, aplikacji web (przełącznik „Co maskować", chip „Zamaskowano", tabela „Co
  wykrywa"), README i strony produktowej. Golden-master i benchmark bez regresji na istniejących typach.

Rdzeń `anonimizator` 0.29.4 → 0.29.5, aplikacja web 0.46.10 → 0.46.12, landing 0.46.11 → 0.46.12.

## v0.46.11 — 2026-07-14

**Landing (parawan.karolwilczynski.com): przepisane copy — mniej marketingu, więcej konkretu.**
Bez zmian w narzędziu ani silniku; tylko treść strony produktowej.

- Usunięte tellów „AI slop": potrójne pytanie retoryczne na wejściu, sloganowe nagłówki
  („Otwarty kod to nie ozdoba — to dowód", „Zmierzone, nie obiecane", „Nie ma serwera do
  zhakowania — bo nie ma żadnego serwera"), klisze („na zawsze").
- Bardziej konkretne scenariusze w „Dla kogo", mniej powtórzeń tezy o offline, żywszy i mniej
  sprzedażowy ton w sekcjach: problem, bezpieczeństwo, transparentność, ograniczenia, demo, kroki.

Landing 0.46.8 → 0.46.11 (tylko copy). Rdzeń i aplikacja web bez zmian.

## v0.46.10 — 2026-07-14

**Dekompozycja silnika, [LOGIN] podświetlany, tabela „Co wykrywa" z jednego źródła.** Dalsze
sprzątanie po v0.46.9 — czytelniejszy rdzeń i web. Jedyna zmiana zachowania to podświetlanie [LOGIN].

- **Silnik `redactPII` rozbity na 35 nazwanych funkcji przebiegów** (`passEmail`, `passPesel`,
  `passCity`… `finalizePersons`) na top-level, spiętych kontekstem `RedactCtx`. `redactPII` to teraz
  czytelny ORKIESTRATOR listujący przebiegi w kolejności wykonania — koniec monolitu ~1300 linii.
  Zero zmian zachowania: golden-master i benchmark bit-identyczne, tsc/lint czyste. Sentinel URL
  jako nazwane stałe (`URL_SENTINEL_OPEN/CLOSE`) zamiast niewidzialnych znaków U+E000/E001.
- **[LOGIN] w wyniku podświetlany i nawigowalny** — wcześniej `[LOGIN]` był maskowany, ale pomijany
  w podświetleniu/nawigacji i chipach; teraz dołączony do `MASK_TOKEN_RE` i chipów „Zamaskowano".
- **Tabela „Co wykrywa" generowana z jednego źródła** (`WYKRYWA_ROWS`) zamiast ~130 linii
  statycznego HTML — dodanie/zmiana typu w jednym miejscu; wygląd tabeli bez zmian.

Rdzeń `anonimizator` 0.29.3 → 0.29.4, aplikacja web 0.46.9 → 0.46.10.

## v0.46.9 — 2026-07-14

**Sprzątanie i przejrzystość kodu — zero zmian zachowania.** Runda porządkowa po wydaniu: mniej
duplikacji, czytelniejsza struktura, narzędzia jakości. Detekcja, wynik redakcji i UI bez zmian
(potwierdzone golden-master na całym korpusie oraz pełną weryfikacją: testy, tsc, benchmark, zrzuty).

- **Sieć bezpieczeństwa dla refaktoru**: nowy golden-master (`redact-golden.test.ts`) zamraża wynik
  `redactPII` na całym korpusie benchmarku (warianty domyślny / pseudonimy / filtr typów) i na zbiorze
  adwersarialnym, plus testy idempotencji. Testy rdzenia 284 → 291.
- **Rdzeń czytelniej (bez zmiany logiki)**: banery FAZ 0–5 i uporządkowana numeracja kroków w
  `redactPII` (koniec mylącego „1e przed 1c", „7 zagnieżdżone w 6"); wspólny walidator sum
  kontrolnych (`weightedChecksum`) zamiast 4 kopii; fabryka „etykieta + wartość" (`maskAfterLabel`)
  i stała maska (`maskConst`) zamiast powtarzanych callbacków; dwa helpery słownika miast zamiast
  4 pętli. Usunięty martwy, nigdy niewpięty `NON_CITY_AFTER_RESIDENCE`.
- **Web: jedno źródło prawdy o typach PII** (`PII_TOKENS`) — kategoria, ikona i opis każdego typu
  w jednym miejscu; kategorie/ikony przełączników, chipów i legendy są z niego wyprowadzane (koniec
  powielania w 4 miejscach). Wartości identyczne co do znaku (dowiedzione osobnym testem równoważności).
- **Usunięty martwy kod po wyciętej warstwie AI**: ikony `ner`/`ustawienia`/`haslo`/`onoff`/`regula`,
  reguły CSS `.ner-updated` + `@keyframes ner-flash`, `.field*`, `.ic-xl`, `.tg`, pusty katalog `src/icons/`.
- **Narzędzia i higiena**: dodany Biome (formatter + linter) z bramką `lint` w CI (bez masowego
  przeformatowania); wspólna baza `tsconfig.base.json` zamiast powtórzeń w 3 konfiguracjach; usunięty
  osierocony `docker-compose.yml` (wskazywał na nieistniejące `./services/ner`); współdzielony generator
  minimalnego PDF dla testu i samodiagnostyki `?pdftest`; drobiazgi (cyrylica w komentarzu → „słownik",
  `@ts-expect-error`, jawny typ `let doc`).

Rdzeń `anonimizator` 0.29.2 → 0.29.3, aplikacja web 0.46.8 → 0.46.9. Bez zmian zachowania detekcji i UI.

## v0.46.8 — 2026-07-13

**Detekcja rdzenia: imię i nazwisko małymi literami, e-mail z polską diakrytyką, kod pocztowy bez myślnika.**

- **Imię + nazwisko MAŁYMI literami** („jan kowalski", „anna kowalska-nowak", „od anna nowak…") —
  niechlujny zapis z czatów/e-maili/formularzy. Wysoka precyzja: pierwszy wyraz musi być imieniem
  ZE SŁOWNIKA, drugi nazwiskiem wg morfologii/słownika (też dwuczłonowym po myślniku). Skan całego
  ciągu małych wyrazów rozwiązuje konsumpcję sąsiadów (wiodący przyimek nie zjada imienia).
  Zero nadmaskowania w prozie — „mam ochotę na kawę", „polski rynek", „ala ma kota" zostają.
- **E-mail z polską literą w części lokalnej** („piotr.wiśniewski@…") maskowany W CAŁOŚCI — wcześniej
  klasa ASCII zatrzymywała się na „ś" i zostawiała jawny fragment nazwiska („piotr.wiś") przed `[EMAIL]`.
- **Kod pocztowy BEZ myślnika** („65048 Zielona Góra") — maskowany TYLKO przy kotwicy adresowej
  (tuż po zamaskowanym `[ADRES]` i przed miejscowością). Pięć cyfr luzem („50000 Euro", „faktura 12345")
  pozostaje jawne (precyzja > nadmaskowanie). Ulica nie sięga już następnego wiersza (kod z nowej linii
  nie jest wciągany do adresu, miejscowość nie wycieka).
- Testy rdzenia 275 → 284; benchmark 94,0 → 94,2% recall / 99,6 → 99,7% precyzja / F1 96,8%.

Rdzeń `anonimizator` 0.29.1 → 0.29.2, aplikacja web 0.46.7 → 0.46.8.

## v0.46.7 — 2026-07-13

**Spójność edytorów, proporcje hero.**

- **Placeholder wyniku w tej samej czcionce co źródło** (mono) — koniec rozjazdu lewe/prawe okno.
- **Koniec poziomego paska przewijania** w oknie wyniku (`overflow: hidden auto` + zawijanie długiej treści).
- **Lockup hero lepiej wyważony**: większy znak i „PARAWAN", ciaśniejszy odstęp do tagline — mniej pustej przestrzeni.

Aplikacja web 0.46.6 → 0.46.7. Rdzeń bez zmian.

## v0.46.6 — 2026-07-13

**Finałowe dopięcie tekstów i drobiazgów UI.**

- **Placeholder wyniku** bez surowych (niezanonimizowanych) danych — pokazuje tylko przykład wyniku
  (`[IMIĘ I NAZWISKO], tel. [TELEFON]`) i podpowiedź „Wklej tekst… albo kliknij Przykład".
- **Podtytuł wyniku**: „kliknij znacznik albo przechodź strzałkami ‹ ›" (usunięte mylące „najedź, by poznać powód").
- **Box prywatności** rozszerzony — mieści się w 2 liniach (nagłówek + jednowierszowy podtekst).
- **Link wersji**: „sprawdź nowszą wersję ↗" (jasne, że o wersję aplikacji).
- **Lead**: „…zanim wkleisz go do asystenta lub czatu AI." (AI na końcu).
- Final check spójności fontów/stylów/kolorów — bez rozjazdów.

Aplikacja web 0.46.5 → 0.46.6. Rdzeń bez zmian.

## v0.46.5 — 2026-07-13

**Dopięcie hero, czcionek, kart i kompletna tabela „Co wykrywa".**

- **Hero bez pustej przestrzeni**: lead i pasek cech w jednym rzędzie (lead po lewej, cechy po prawej),
  wyrównane z rzędem nagłówka (lockup │ callout prywatności).
- **Czcionki**: tagline „Lokalny anonimizator polskich danych" i etykiety stref demo z monospace na
  Archivo (sans) — czytelniej, mniej „technicznie".
- **Tabela „Co wykrywa" kompletna**: dodane brakujące typy (Znak sprawy, Prawo jazdy, Nr rejestracyjny,
  VIN, IP, MAC, Token/JWT, Login, Miejscowość) — pełne 22 typy zgodne z panelem i benchmarkiem.
- **Karty informacyjne**: wyróżnienia (w tym „Parawan", „Porównanie", „heurystyczne", „Strażnik
  kontekstu") na zielono marki.

Aplikacja web 0.46.4 → 0.46.5. Rdzeń bez zmian.

## v0.46.4 — 2026-07-13

**Kompozycja hero i strefy demo.**

- **Hero na nowo**: callout prywatności („Twój tekst nie opuszcza przeglądarki") przeniesiony do
  prawej części nagłówka jako mocny akcent zaufania (dopasowany do treści, nic nie „zwisa").
  Cztery cechy zamiast bloku 2×2 badge'ów to teraz czysty **pasek pigułek z „✓"** pod leadem
  (100% offline · bezpieczne · open source · reguły + sumy kontrolne). Lead powiększony.
- **Demo — strefy Wejście/Wyjście** uwydatnione jako pigułki z kolorową kropką (WEJŚCIE zielona,
  WYJŚCIE bursztynowa), wyraźnie kotwiczące przepływ animacji.
- Responsywność: na węższych ekranach callout prywatności spływa pod lockup marki.

Aplikacja web 0.46.3 → 0.46.4. Rdzeń bez zmian.

## v0.46.3 — 2026-07-13

**Pass polerski przed finałem: hero-lockup, demo, box prywatności, ikony, tła pól.**

- **Hero — poziomy lockup marki**: znak │ dzielnik │ **PARAWAN** (wersaliki) + tagline
  „Lokalny anonimizator polskich danych" (mono, wersaliki). Badge'y ułożone w zwarty blok 2×2.
- **Box prywatności** mocniejszy: nagłówek „Twój tekst nie opuszcza przeglądarki" + podtekst
  wypełniający dotąd pustą przestrzeń, obwódka.
- **Demo „Jak to działa"**: nagłówek przeniesiony na górę karty (koniec „zwisania"), lepszy tekst
  („Wrzucasz dokument z danymi, wychodzi zanonimizowany"), strefy **Wejście/Wyjście** wyeksponowane
  jako etykiety z akcentem (zielony / bursztyn), powiązane z przepływem animacji.
- **Ikony SVG**: „Co maskować" dostaje sensowną ikonę suwaków zamiast koła-„słoneczka".
- **„Co maskować"**: pola dostały tła i obwódki (wyraźna separacja wierszy).
- **Favicon aplikacji** nieodwrócony (ciemny znak na jasnym kaflu, jak baner); favicon autora
  w jednej linii z linkiem. Przepracowane teksty 3 kart informacyjnych na dole. Legenda: „Adres i czas"
  → „Adres", „Osoby" = 2 typy (z Datą urodzenia).

Aplikacja web 0.46.2 → 0.46.3. Rdzeń bez zmian.

## v0.46.2 — 2026-07-13

**Przebudowa panelu „Co maskować", zmiana nazwy repozytorium na `parawan`, marka i favicony.**

Panel „Co maskować":
- **Zwarte wiersze** zamiast dużych kafelków + **akcje zbiorcze** (Zaznacz / Odznacz / Odwróć)
  i licznik na żywo „Maskuję X/22".
- **Kolumny zgrane między pasami** (wspólna siatka): Identyfikatory szeroko, a **Kontakt i Finanse
  w jednej linii** (nagłówek „Finanse" nad kolumną IBAN), Adres i Dane osobowe pełną szerokością.
- **Data urodzenia przeniesiona do kategorii „Osoby"** (kolor fioletowy) — zaktualizowane
  `maskCategory`, legenda, tabela „Co wykrywa" i README. Kategoria „Adres i czas" → **„Adres"**.
- **„Rozróżniaj osoby"** to teraz zwykły wiersz-tryb w grupie „Dane osobowe" (etykieta „tryb"),
  nie osobna belka na całą szerokość.

Marka i repozytorium:

- **Repozytorium GitHub: `anonimizator` → `parawan`** (stara nazwa przekierowuje). Zaktualizowane
  wszystkie odniesienia URL w README, aplikacji, `release.yml`, szablonach i `packages/core`.
  Pakiet npm / CLI dalej `anonimizator`.
- **Baner README**: znak marki w kolorach marki (ciemna zieleń na jasnym kafelku) zamiast
  odwróconych (jasny na ciemnym). Tagline skrócony do „Lokalny anonimizator polskich danych
  osobowych" (bez „Dane za parawanem").
- **Favicon aplikacji**: prawdziwy znak-harmonijka (ParawanMark) zamiast uproszczonego zygzaka.
  Przy linku „autor" dodana ikona strony `karolwilczynski.com` (osadzona jako `data:`, offline).
- **Hero**: pod-tytuł skrócony do „Lokalny anonimizator polskich danych osobowych".
- **README**: badge „dystrybucja: jeden plik HTML" (zamiast `file://`), usunięty badge „zgodność RODO".

Aplikacja web 0.46.1 → 0.46.2. Rdzeń bez zmian.

## v0.46.1 — 2026-07-13

**Dopracowanie UI po v0.46.0 — usunięty panel, czytelniejsze „Co maskować", płynniejsze demo.**

- **Usunięto panel „Tryb urzędowy · bez AI"** (za dużo pustej przestrzeni, treść zbędna —
  deterministykę komunikuje już badge „bez AI · tryb urzędowy" w hero). „Co maskować" wraca na
  całą szerokość.
- **„Co maskować" — nowy układ**: jedna płaska siatka na całą szerokość z nagłówkami kategorii
  rozpiętymi na cały rząd (grid-column 1/-1). Kafelki wszystkich typów mają równą szerokość i
  wysokość w rzędzie — czytelne pasma zamiast poszarpanych, w większości pustych rzędów. Wszystkie
  przełączniki obecne (Identyfikatory ×14, Kontakt ×2, Finanse ×1, Adres i czas ×4, Osoby ×1).
- **Animacja „Jak to działa"** przepisana na współrzędne WZGLĘDEM ŚRODKA (left:50% + translateX):
  karta wejścia płynnie wchodzi z lewej za wyśrodkowany parawan, karta wyjścia wyłania się zza
  niego i odjeżdża w prawo, spójnie niezależnie od szerokości karty (koniec „wiszenia" w sztywnym
  punkcie).
- **Teksty**: ogólne ujęcie zamiast celowania w urzędników (czat AI / asystent zamiast „poza urząd",
  badge „reguły + sumy kontrolne" zamiast „bez AI · tryb urzędowy"); ograniczone nadmiarowe myślniki
  („—") w UI, README i wydaniu (przecinki / dwukropki / nawiasy).

Aplikacja web 0.46.0 → 0.46.1. Rdzeń bez zmian.

## v0.46.0 — 2026-07-13

**Nowa marka „Parawan" i przeprojektowany interfejs (wg makiety z Claude Design).**

Rebranding głównego produktu: „Anonimizator" → **Parawan** („Dane za parawanem"). Nowa
tożsamość wizualna z makiety `Parawan - makieta aplikacji.dc.html` — **bez zmian w logice
detekcji** (rdzeń nietknięty, bramka benchmarku bez regresji: recall 94% / precyzja 99,6%).

- **Marka i paleta:** głęboka leśna zieleń `#0B3D2E` + krem `#EFEDE6` + bursztyn `#B9791F`
  (akcja główna „Kopiuj"). Znak marki **ParawanMark** — parawan złożony w harmonijkę, widok
  z góry (inline SVG w `icons.ts`). Nowa favicona i kolor motywu.
- **Typografia:** Archivo (nagłówki 800/900) + IBM Plex Mono (etykiety/wersaliki/mono).
  Fonty **wbudowane lokalnie** (woff2 latin + latin-ext, z polskimi znakami) i wtapiane do
  jednego pliku HTML jako `data:` — ZERO zależności zewnętrznych, `file://` bez internetu
  (fosa nienaruszona). Archivo jako font zmienny (zakres wag 100–900). Atrybucja OFL:
  `apps/web/src/fonts/LICENSE-FONTS.md`.
- **Nowe sekcje:** animacja „Jak to działa" (dokument znika za parawanem, wychodzi
  zanonimizowany) oraz panel **„Tryb urzędowy · bez AI"** (podkreśla deterministykę — zero
  modeli AI, walidacja sum kontrolnych, 100% offline). „Co maskować" wraca do 7 kolumn obok
  panelu (zamiast pustki po prawej).
- **Bez zmian:** cała mechanika (maskowanie na bieżąco, przeglądanie znaczników, Porównanie,
  wczytywanie DOCX/PDF, „Co maskować", tabela „Co wykrywa"). Kolory kategorii PII te same
  (osoby lekko przyciemnione do `#5B3FA8`).
- **Rebranding wszędzie:** artefakt release `Anonimizator.html` → **`Parawan.html`**, nowy
  `JAK-UZYC.txt` i treść wydania; przebudowane README (baner SVG `docs/parawan-banner.svg`,
  więcej znaczników shields, alerty GitHub, sekcje transparentności, przyjazny język, techniczne
  części w zwijanych `<details>`), nowy zrzut `docs/screenshot.png`; zaktualizowane `NOTICE`,
  `CLAUDE.md`, szablony zgłoszeń. **Nazwa pakietu npm / CLI / repozytorium pozostaje `anonimizator`**
  (identyfikator techniczny — zmiana złamałaby importy i instalacje).

Aplikacja web 0.45.2 → 0.46.0. Rdzeń `anonimizator` bez zmian (0.29.1).

## v0.45.2 — 2026-07-13

**Warstwa AI wydzielona do osobnego repozytorium — główny produkt to jeden plik HTML.**

Powód: edycja „pełna / AI" była myląca i w praktyce nieużywalna (wymagała pobrania modelu
z release'u `models-fastpdn-onnx-v1`). Zgodnie z decyzją: rozdział na dwa repozytoria.

Sprostowanie (2026-10-25): pierwotny wpis mówił, że release `models-fastpdn-onnx-v1` „nigdy
nie powstał”. Release istnieje od 2026-07-04 i ma dwa pliki (`fastpdn-onnx-int8.zip`,
`anonimizator-onnx-pack.zip`).

- **To repo produkuje jeden artefakt: `Anonimizator.html`** (deterministyka — reguły, słowniki,
  sumy kontrolne, w całości offline). Koniec dwóch edycji i przełącznika `VITE_EDITION`.
- **Warstwa AI → [anonimizator-ai](https://github.com/karolpolikarp/anonimizator-ai)** (DLC,
  local-only): usługa NER (spaCy/HerBERT), NER ONNX w przeglądarce, launcher HTTP, build paczki
  modelu, eksperymentalny LLM. Wpina się w rdzeń przez npm (`anonimizator/ner`,
  `anonimizator/ner-postprocess`, `anonimizator/llm` — te eksporty biblioteki ZOSTAJĄ w rdzeniu).
- Usunięte z głównego repo: `services/ner/`, `launcher/`, `scripts/build-onnx-pack/`,
  `apps/web/src/ner-browser.ts`, `examples/ner-onnx-node.mjs`, `docs/SOTA-ANALIZA.md`,
  `docs/AI-BEZ-DOCKERA.md` oraz cała warstwa NER z `apps/web` (UI przełącznika, sekcja
  „Wykrywanie nazwisk AI"). „Co maskować" rozciąga się teraz na całą szerokość.
- Release: jeden plik `Anonimizator.html` + `JAK-UZYC.txt` (koniec `Anonimizator-AI.zip`).
- Detekcja rdzenia bez zmian: 275 testów, benchmark rdzenia recall 94%/precyzja 99,6%.

Aplikacja web 0.45.1 → 0.45.2. Rdzeń `anonimizator` bez zmian (0.29.1) — nadal eksportuje
warstwy AI jako szew dla dodatku.

## v0.45.1 — 2026-07-13

**Zmiana licencji na Apache 2.0 + poprawki precyzji po II raporcie testera.**

- **Licencja MIT → Apache License 2.0**: nowy `LICENSE` (pełny tekst), `NOTICE`
  (copyright + informacja o wcześniejszych wydaniach MIT), pole `license` w pakiecie
  rdzenia, badge i sekcja w README, plakietka i stopka aplikacji web.
- **Pola administracyjne nie są osobą**: „Powiat: Pruszkowski", „Województwo:
  Mazowieckie" (także wartość w następnej linii) — przymiotnik odmiejscowy po
  etykiecie administracyjnej przestał dostawać maskę `[OSOBA-X]` (strażnik
  `precededByAdminLabel` + jednostki administracyjne w NON_PERSON_CONTEXT).
- **Koniec ucinania masek w pół słowa (maskuj całość)**: prawa granica
  `(?![wielka|mała litera])` we wszystkich regułach osobowych — token mieszany
  („KowaIski" z OCR-owym I zamiast l, „McDonald") nie jest już dopasowywany do połowy
  („[OSOBA-A]Iski"/„[OSOBA-A]aIski" — wyciek fragmentu nazwiska).
- **Nowa reguła (c4)**: homoglif OCR WEWNĄTRZ słowa kapitalizowanego — „Jan KowaIski",
  „Anna NowaIska", „K0walski" maskowane w całości po normalizacji I/1→l, 0→o
  i walidacji słownikiem/morfologią („McIntosh" zostaje).
- **Imię przed maską wciągane do maski** — także złączone podkreśleniem, jak w nazwach
  plików: „Umowa_Kredytowa_Adam_[OSOBA-C].pdf" → „Umowa_Kredytowa_[OSOBA-C].pdf"
  (wyciek imienia obok maski łamał zasadę „maskuj całość").
- Scenariusz testów uzupełniony o nowe przypadki „enterprise" z II raportu (alias,
  hostname/nazwa komputera, drukarka UNC, loginy w ścieżkach URL — GitHub/GitLab/
  LinkedIn/SharePoint, granularność masek `[IMIĘ]`/`[NAZWISKO]` w JSON/XML).

Aplikacja web 0.45.0 → 0.45.1, rdzeń `anonimizator` 0.29.0 → 0.29.1.

## v0.45.0 — 2026-07-12

**Struktura XML/JSON, ochrona URL-i, nowy typ LOGIN, tolerancja OCR, domknięcie telefonu
z kropkami i tablic w wyliczeniu (raport testów: XML/JSON/OCR + mikrotest N1/B3).**

- **Nowy typ `LOGIN`** (`[LOGIN]`): kotwica „login/username/nazwa użytkownika" + wartość
  (także w NASTĘPNEJ linii i małymi literami: „Login użytkownika:\ntkaminski"); wariant
  w cudzysłowie po „użytkownik/login/konto" („wylogowanie użytkownika «tkaminski»");
  złapana wartość maskowana też w pozostałych wystąpieniach w dokumencie.
  Identyfikatory systemowe („USR-005182") i etykiety po pustym polu zostają.
- **URL-e chronione i maskowane WEWNĄTRZ**: adres jest wyjmowany sentinelem przed wszystkimi
  przebiegami (wcześniej detektor nazwisk rozbijał URL — „[IMIĘ I NAZWISKO]]"), a wartości
  parametrów osobowych (`?user=`, `?email=` — też `%40`, `?name=`, `?tel=`, `?token=`…)
  maskowane wg typu. Struktura adresu (domena, `id=`) zostaje; URL bez PII nietknięty.
- **Struktura XML/JSON**: tagi `<Name>/<Surname>/<Phone>/<Street>/<City>…` i klucze
  `"firstName"/"lastName"/"city"/"street"…` (EN i PL) to kotwice strukturalne — maskowana
  sama wartość, tagi/cudzysłowy/przecinki zostają (wynik JSON dalej się parsuje). Generyczny
  `<Name>` bramkowany słownikiem („Produkt X200" zostaje); nazwisko dostaje spójną etykietę
  `[OSOBA-X]`.
- **Telefon z kropkami — domknięcie (B3)**: „+48.512.345.678" (kropki w trybie prefiksowym),
  kotwica „kontakt(owy)", wyliczenie po kotwicy akceptuje „oraz"/„i" i wypełniacz
  („oraz stacjonarny 22.501.23.45"); tryb kotwicowy biegnie PRZED prefiksowym, żeby placeholder
  nie przerywał łańcucha listy. Kropkowy bez żadnej kotwicy nadal niemaskowany (numery
  seryjne/wersje/kwoty — świadoma polityka).
- **Tablice w wyliczeniu — domknięcie (N1)**: człony po przecinku/„oraz"/„i" dziedziczą
  kotwicę pierwszej tablicy („pojazdy: WW 1234A, ZS 4567, WE 123AB…"); nowe kotwice
  „parking/zaparkowan…" z przerwą do 3 słów; bezpiecznik: ścisły format (druga część od cyfry) +
  walidacja pierwszej litery wyróżnika wojewódzkiego. „Rozporządzenie (WE) nr 1234/2009"
  i „dyrektywa WE 123" zostają. Naprawiona idempotencja: kotwica „rej…" nie zjada już
  końcówki „…cyjnym" przy drugim przebiegu (wartość tablicy musi zawierać cyfrę).
- **Tolerancja błędów OCR**: kotwice z homoglifem („teI:" → telefon, „uI." → ulica), nazwa
  ulicy z 0/1 w środku („Lip0wa 15"), pary WERSALIKAMI z homoglifami 0→O/1→l walidowane
  słownikiem/morfologią („J0AN K0WALSKI" → maska; „SN-44A8-9912-XXA", „CZĘŚĆ IV" zostają).
  Przy okazji: czyste WERSALIKI „JAN KOWALSKI" w prozie też maskowane (oba słowniki wymagane).
- **Miasto po adresie z przyimkiem/nową linią**: „przy [ADRES] w Gdańsku" →
  „przy [ADRES] w [MIEJSCOWOŚĆ]" (bramka słownikowa); blok adresowy „[ADRES]\nWarszawa"
  też domknięty. Goła proza („spotkanie w Gdańsku") nadal nietknięta.
- **Audyt adwersarialny nowych reguł (obszar URL/LOGIN) — 6 poprawek**: parametry we
  FRAGMENCIE URL-a („callback#access_token=…" → `[TOKEN]`, klucze po „#"); login
  w guillemetach («tkaminski») i w cudzysłowie po dwukropku („Login: „jkowalski"");
  kotwica „Login administratora/operatora/serwisowy/techniczny"; strażnik pustego
  „Login:" przed etykietą DWUWYRAZOWĄ („System operacyjny: …" — wcześniej „System"
  stawał się loginem i propagował maskę po całym dokumencie); goły „konto" usunięty
  z kotwic cudzysłowowych („konto «Firmowe»" to produkt, wymagane „konto użytkownika").
- **Warstwa NER nie rozrywa znaczników XML/HTML**: model tagował „Customer" w
  „</Customer>" jako osobę — znaczniki `<…>` są teraz nietykalne w obu ścieżkach
  (`ner-postprocess.ts` dla ONNX/przeglądarki i `services/ner/app.py` dla usług HTTP).
  Pełny benchmark 4 warstw po przebudowie obrazów: core F1 96,7%, +spacy 99,4%,
  +fastpdn 99,2%, +onnx 99,0% (precision-proxy 99,6% we wszystkich warstwach).
- Scenariusz testów do dokończenia (5 obszarów audytu + testy ręczne UI):
  `docs/SCENARIUSZ-TESTOW-v0.45.md`.

Aplikacja web 0.44.4 → 0.45.0, rdzeń `anonimizator` 0.28.1 → 0.29.0, usługa NER 2.0.1 → 2.1.0.

## v0.44.4 — 2026-07-11

**Audyt adwersarialny reguł z v0.44.3 — poprawki precyzji + filtr precyzji w usłudze NER.**

- **Kotwica pojazdowa dopracowana**: druga część tablicy musi zaczynać się CYFRĄ („pojazd
  VW GOLF5", „marki KIA CEED2" zostają — wcześniej modele aut stawały się tablicami przez
  backtracking regexu marki), a wtrącenia „siodłowy/ciężarowy/o nr" nie przerywają dopasowania.
- **Patron ULICY nie jest osobą**: „ul. Rakowieckiej", „al. Sikorskiego" — strażnik patrona
  rozszerzony ze skrótu „im." na „ul./al./pl./os."; „Al. W. Andersa 15" (kapitalizowane, z
  inicjałem) wchodzi teraz w `[ADRES]`.
- **Inicjał po dwukropku maskowany**: „Do wiadomości: K. Baran" (rozdzielnik) — dwukropek
  nie jest już traktowany jak początek wyliczenia.
- **Obce imiona z myślnikiem tylko ze słownika**: bramka ~90 znanych obcych imion — bez niej
  „Golub-Dobrzyń Zaprasza", „Ruciane-Nida", „Rolls-Royce Motor" stawały się osobami, a maska
  obcinała „Toruń" do „ń" (ASCII \b nie działa po polskim znaku — granica lookaheadem).
  „Jean-Claude Van Damme" maskowany w całości (cząstka w regule).
- **Cząstki dwuliterowe (Da/De/La…) po masce osoby tylko z WIELKIEJ litery** — małe „da"
  kolidowało z polską prozą („da Radę").
- **Stoplista -ski/-cki rozszerzona**: przyciski, uciski, rozbłyski, odblaski, obcaski,
  piski, odpryski, uzyski, potrzaski, klocki, kluski, pieski i in.
- **Usługa NER (services/ner) dostała filtr precyzji** — odpowiednik stoplist rdzenia po
  stronie Pythona: jednowyrazowe homonimy („Wilk biegał po lesie", „Baran to znak zodiaku"),
  role procesowe („Powódka"), rzeczowniki techniczne („Token") i patroni („im. Mickiewicza")
  nie są już maskowane przez spaCy. Warstwa core+spacy: precision 94,7% → 99,6% (F1 99,3%),
  bramka benchmarku obejmuje teraz także żywą usługę.

Aplikacja web 0.44.3 → 0.44.4, rdzeń `anonimizator` 0.28.0 → 0.28.1, usługa NER 2.0.1.

## v0.44.3 — 2026-07-11

**Druga tura poprawek detekcji po finalnym raporcie regresyjnym (N1–N3, B3, B9/B10).**

- **Tablice rejestracyjne w wyliczeniu (N1)**: nowa kotwica POJAZDOWA — „drugi pojazd
  WW 1234A", „motocykl ZS 4567" maskowane bez słowa „rejestracyjny". Wartość musi być
  WIELKIMI literami i zawierać cyfrę („pojazd MERCEDES" zostaje).
- **NRB bez prefiksu „PL" (N3)**: goły ciąg 26 cyfr z POPRAWNĄ sumą mod-97 (walidacja jak
  IBAN po dodaniu „PL") maskowany bez etykiety — codzienna forma zapisu konta w pismach.
- **Wyliczenie telefonów po jednej kotwicy (B3)**: „Telefony: 512.345.678, 601 234 567" —
  kotwica działa na wszystkie człony listy, nie tylko pierwszy.
- **Inicjał + nazwisko (N2)**: „A. Baran", „J. Kowalski" maskowane (inicjał wciągany);
  inicjał to kotwica osobowa, więc łapane są też homonimy (Baran/Wilk). Wyliczenia
  („A. Wnioski stron"), patroni instytucji („Szkoła im. A. Mickiewicza") i pozycje po
  kropce zdania zostają; skróty tytułów (mec./dr/prof.…) przed inicjałem nie przeszkadzają.
- **Obce nazwiska wieloczłonowe (B9/B10)**: „Jean-Pierre Dubois" (imię z myślnikiem,
  człony ≤7 liter — odróżnia od „Czechowice-Dziedzice") oraz cząstki „Van/von/de/bin…"
  po masce osoby („Nguyen Van Anh" → całość w masce).
- **Stabilna numeracja osób**: etykiety [OSOBA-X] idą teraz w kolejności pierwszego
  wystąpienia w tekście (wcześniej wg typu reguły — litery „skakały").
- **Nadmaskowanie (pre-existing, wykryte przy okazji)**: rzeczowniki pospolite lm. na
  „-ski" („Wnioski stron oddalono", „Zapiski", „Maski") nie są już maskowane jako
  nazwiska — stoplista w surnames.ts; „im. Mickiewicza" chronione nowym strażnikiem
  patrona (prevLowerWord nie widział „im." przez kropkę).
- Kosmetyka: NR-KONTA z etykietą nie zjada spacji po numerze.

Aplikacja web 0.44.2 → 0.44.3, rdzeń `anonimizator` 0.27.0 → 0.28.0.

## v0.44.2 — 2026-07-11

**Poprawki detekcji po zewnętrznym raporcie z testów (partie 1–3).**

Fałszywe negatywy (wycieki) usunięte:

- **Sekrety prefiksowe jako TOKEN**: `sk_live_`/`sk_test_` (Stripe), `ghp_`/`gho_`/`ghs_`/`ghu_`/
  `ghr_`/`github_pat_` (GitHub), `xox?-` (Slack) — dotąd kategoria łapała wyłącznie JWT, a to
  najczęstszy wyciek przy wklejaniu logów do asystenta AI.
- **Telefon**: format z kropkami (`512.345.678`), kierunkowy w nawiasie (`(22) 501-23-45`),
  wtrącenie po słowie kontekstowym („telefon **kontaktowy**…"), goły prefiks kraju
  („kom. **48** 512 345 678" — prefiks maskowany razem z numerem).
- **MAC w notacji Cisco** (`aabb.ccdd.eeff`; wymagana ≥1 litera hex — czysto cyfrowe ciągi
  z kropkami zostają).
- **IPv6 przed kropką końca zdania** (`…fe80::1ff:fe23:4567:890a.` — adres wyciekał w całości).
- **Sygnatura sądowa z dwuczłonowym wydziałem** („Sygn. akt: II SA/Wa 1234/23") — decyzja
  polityki: sygnatury maskowane TYLKO przy kotwicy („Sygn. akt"), cytowane orzecznictwo
  w prozie („w sprawie III CZP 45/22") pozostaje jawne.
- **KRS z wypełniaczem** („wpisana do KRS **pod numerem** 0000123456").
- **Prawo jazdy w odmianie** („**prawem** jazdy nr 05678/13/1234" — narzędnik nie był kotwicą).
- **Data urodzenia z „dnia" i miesiącem rzymskim** („ur. dnia 31 XII 2010").
- **Miasto urodzenia z datą pomiędzy** („ur. 08.05.1992 **w Krakowie**" — nowy krok 12g,
  wyłącznie miasta ze słownika; goła proza „spotkanie w Krakowie" nietknięta).
- **Numer lokalu w adresie** („ul. Polna 12 **lok. 5**", „ul. Długa 3 **m. 7**" — dotąd poza
  znacznikiem `[ADRES]`).
- **NIP z prefiksem kraju** („NIP **PL**5262735917" — prefiks maskowany razem z numerem).
- **Inicjał przed nazwiskiem** („mec. **J.** Kowalski" — inicjał wciągany do maski osoby;
  punkty wyliczeń na początku linii nietknięte).

Fałszywe pozytywy (nadmaskowanie) usunięte:

- **Numer porządkowy ≠ telefon**: 9-cyfrowe ciągi zaczynające się od zera odrzucane (polski
  numer nigdy nie zaczyna się od 0), a strażnik kontekstu zna teraz „lp.", „porządkowy",
  „rejestr…" (okno poszerzone do 24 znaków).

Dodatkowo po wewnętrznym audycie adwersarialnym nowych reguł:

- **Notacja kropkowa telefonu wymaga kotwicy** („tel./telefon…") — bez niej pożerała kwoty
  z separatorem tysięcy („123.456.789 zł") i numery seryjne. Fallback bez kotwicy nie maskuje
  też ciągów przed częścią groszową/walutą („512 345 678,00 zł" to kwota) i zna negatywne
  kotwice „seryjny"/„wersja".
- **MAC Cisco czysto cyfrowy** maskowany przy jawnej etykiecie „MAC" (etykieta wygrywa
  z warunkiem strukturalnym, jak przy PESEL/NIP ze złą sumą).
- **Znak sprawy z inicjałami referenta** („WKU.5589.12.2026.AB") maskowany w całości —
  końcówka `.AB` identyfikuje urzędnika.
- **Prawo jazdy z wtrąceniem kategorii** („prawo jazdy kat. B o numerze …") — wypełniacze
  między kotwicą a numerem nie przerywają już dopasowania.
- **Miasta z myślnikiem w odmianie** („w Bielsku-Białej") i **mianownik po „zam."**
  („zam. Kraków") dodane do detekcji miejscowości.

Poza zakresem deterministyki (domena warstwy NER/słownika): obce nazwiska wieloczłonowe
(„Jean-Pierre Dubois", „Nguyen Van Anh") oraz tablica rejestracyjna bez kotwicy („ZS 4567" —
format zbyt wieloznaczny, precyzja > nadmaskowanie).

Aplikacja web 0.44.1 → 0.44.2, rdzeń `anonimizator` 0.26.1 → 0.27.0.

## v0.44.1 — 2026-07-11

**Poprawki interfejsu + pełne maskowanie numeru prawa jazdy.**

- **Numer prawa jazdy maskowany W CAŁOŚCI.** Format z wewnętrznymi separatorami (np.
  `12345/67/8901`) był maskowany tylko do pierwszego separatora (`[PRAWO-JAZDY]/67/8901`) —
  fragment numeru wyciekał. Teraz wzorzec obejmuje separatory `/` i `-`, więc cały numer jest
  zastępowany jednym znacznikiem. Zasada: maskujemy całą informację, nie jej fragment.
  (Rdzeń `anonimizator` 0.26.0 → 0.26.1.)
- **Kolorowe znaczniki dla nowych typów w wyniku.** `[PRAWO-JAZDY]`, `[NR-REJESTRACYJNY]`,
  `[VIN]`, `[IP]`, `[MAC]`, `[TOKEN]` były renderowane jako zwykły tekst — teraz dostają
  kolorowy znacznik kategorii „Identyfikatory" (jak PESEL/NIP) wraz z tooltipem metody wykrycia.
  Przyczyna: brak tych typów w `MASK_TOKEN_RE`.
- **Intuicyjniejsza zmiana wysokości okien.** Drobny natywny trójkącik w rogu okna źródła
  zastąpiony widocznym, symetrycznym uchwytem u dołu OBU okien (źródła i wyniku). Przeciągnięcie
  dowolnego z nich zmienia wysokość obu równocześnie; działa myszą, dotykiem i klawiaturą
  (strzałki ↑ ↓), a dwuklik przywraca wysokość domyślną. Wyraźny stan hover i podpowiedź.
- **Wersja i link autora w hero.** Numer wersji przeniesiony na samą górę (obok „sprawdź
  najnowszą"), dodany link do strony autora (karolwilczynski.com); zduplikowana wersja
  usunięta ze stopki.
- **Lepsze wykorzystanie przestrzeni panelu „Co maskować".** Cztery małe kategorie
  (Kontakt, Finanse, Adres i czas, Dane osobowe) stoją teraz obok siebie w jednym wspólnym
  pasie, zamiast czterech osobnych, w większości pustych rzędów. Kafelki utrzymują jednolitą
  szerokość w całym panelu. „Identyfikatory" (najliczniejsze) zostają pełną szerokością.

Aplikacja web 0.44.0 → 0.44.1, rdzeń `anonimizator` 0.26.0 → 0.26.1.

## v0.44.0 — 2026-07-11

**Nowe typy danych technicznych + maskowanie przy silnej etykiecie mimo złej sumy kontrolnej.**
Rdzeń rozpoznaje teraz ponad 20 typów PII. Zmiany wynikły z audytu realnego pisma, w którym
wyciekał NIP („NIP działalności:\n9452176998" — kwalifikator rozbijał kotwicę), telefon w nawiasach
i identyfikatory techniczne.

- **6 nowych typów:** nr prawa jazdy, nr rejestracyjny pojazdu, VIN (17 znaków), adres IP (v4 i v6),
  adres MAC, token/JWT. Wszystkie precyzyjnie kotwiczone: VIN/prawo jazdy/tablica wymagają kontekstu,
  IPv4 pomija numery wersji (`wersja 1.2.3.4`), VIN wymaga min. 4 cyfr i 3 liter, JWT/MAC/IPv6 są
  strukturalnie odróżnialne. Kolejność przebiegów: identyfikatory techniczne PRZED ciągami cyfr,
  MAC przed IPv6.
- **Maskowanie mimo złej sumy przy silnej etykiecie.** PESEL/NIP/REGON/IBAN z literówką (błędna suma
  kontrolna) są teraz maskowane, gdy poprzedza je jednoznaczna etykieta („PESEL:", „NIP", „REGON",
  „konto/rachunek"). Numer z literówką to nadal dana osobowa. Bez etykiety — walidacja sumy dalej
  chroni przed fałszywym trafieniem. Kotwieta toleruje kwalifikator („NIP działalności", „PESEL matki").
- **Telefon w nawiasach.** `+48 (501) 234-567` jest teraz maskowany; zawężono też zachłanność
  9-cyfrowego fallbacku telefonu, by nie zjadał REGON-u.
- **UI:** nowa grupa „Identyfikatory techniczne" w panelu „Co maskować" (6 przełączników).
- **Testy:** 207 testów rdzenia (nowe: telefon-nawiasy, PESEL/NIP/konto zła-suma-z-etykietą,
  wszystkie 6 nowych typów, poszanowanie `options.types`). Benchmark 211 przypadków, precyzja 99,1%.
- Dodano `CLAUDE.md` (przewodnik po repozytorium).

Rdzeń `anonimizator` 0.25.0 → 0.26.0, aplikacja web 0.43.0 → 0.44.0.

## v0.43.0 — 2026-07-11

**Rozszerzenie słownika nazwisk — wyższy recall edycji „czysty HTML", bez AI, bez launchera.**
Warstwa deterministyczna (jeden plik, `file://`, zero instalacji) łapie teraz ~900 dodatkowych
najczęstszych nazwisk BEZ sufiksu `-ski/-cki/-icz/-czyk` (te i tak łapie morfologia) — w tym częste
nazwiska obce (ukraińskie, niemieckie, wietnamskie), coraz realniejsze w dzisiejszej Polsce.

- **Źródło:** rejestr PESEL osób żyjących (dane.gov.pl, 2023, licencja **CC0**).
- **Kuracja precyzja > recall:** odsiew homonimów wyrazów pospolitych (filtr listy częstości korpusu) +
  wieloagentowa klasyfikacja nazwisko/wyraz. Homonimy typu „górka/zięba/żurek/bednarz" świadomie
  pominięte — łapie je warstwa kontekstowa (imię obok / „Pan"). Zero nowego nadmaskowania.
- **Wynik (benchmark):** recall rdzenia 89,7% → 91,8% (kategoria `osoby-rzadkie-ner` 0% → 21%),
  **precyzja 99,0% bez zmian**. Plik edycji „urząd" nadal ~1,83 MB (fosa single-HTML zachowana).
- Nowa kategoria benchmarku `osoby-slownik` (strażnik słownika) + bramka regresji CI na nią.

Rdzeń `anonimizator` 0.24.0 → 0.25.0.

## v0.42.0 — 2026-07-11

**Utwardzenie warstwy NER w przeglądarce (ONNX + transformers.js) — precyzyjniej, bez Dockera.**
Funkcja „Wykrywanie nazwisk AI" działała, ale jej post-processing był stratny. Teraz:

- **Poprawna lokalizacja bez offsetów.** Przeglądarkowy transformers.js nie zwraca offsetów
  znakowych ani nie agreguje encji — dawne sklejanie subwordów i globalny `indexOf` gubiły
  pozycje przy duplikatach nazwisk, subwordach i obcych diakrytykach. Zastąpione lokalizacją
  przez strumień liter (Unicode) z mapą na oryginał + rozszerzeniem do granic słowa.
- **Próg pewności `score`** (min 0.5; homonimy rzeczowników — Wilk, Baran, Lis — tylko przy
  score ≥ 0.9) i **reużyte stoplisty rdzenia** (przymiotniki geo/narodowe, słowa instytucji):
  „Uniwersytet Warmiński", „Bank Śląski", „Sąd Najwyższy" nie są maskowane. Zgodnie z zasadą
  precyzja > nadmaskowanie.
- **Koniec duplikacji:** cała selekcja i maskowanie osób to jeden wspólny moduł rdzenia
  `anonimizator/ner-postprocess`, używany przez przeglądarkę, przykład Node i benchmark.
- **Testy:** nowe zestawy jednostkowe dla modułu i dla warstwy przeglądarki (mock pipeline,
  kontrakt fail-safe).

**Dwie edycje w release.** `Anonimizator.html` — „czysty HTML" (jeden plik, `file://`, bez AI,
bez uruchamiania) dla maszyn z blokadami firmowymi. `Anonimizator-AI.zip` — „pełna / AI"
(HTML z sekcją AI + launcher HTTP + instrukcja) dla komputerów bez blokad.

**Benchmark.** Nowa warstwa `core+onnx (Node)` — FastPDN ONNX int8 w Node, bez Dockera
(pomijana fail-safe, gdy brak biblioteki/modelu). Nowa kategoria `osoby-rzadkie-ner` — przypadki,
których rdzeń deterministyczny świadomie nie łapie (recall ~0%), mierzące przewagę warstwy NER.

Rdzeń `anonimizator` 0.23.0 → 0.24.0 (nowy publiczny eksport `./ner-postprocess`; wyeksportowane
stoplisty `LEGAL_ENTITY_WORDS`, `NON_PERSON_CONTEXT`, pomocnik `isGeoAdjective`).

## v0.41.0 — 2026-07-09

**Maskowanie znaku sprawy / znaku pisma** (nowy typ `[ZNAK-SPRAWY]`) — z myślą o urzędnikach,
u których sygnatura pisma identyfikuje sprawę i pośrednio osobę. Dwa tryby wykrywania:

- **Strukturalnie, wg JRWA** — znak `SYMBOL.klasa.numer.ROK` (np. `DPR-II.054.3.2026`,
  `ZP.271.12.2026`, `DC.WAC.5555.30.2026`, `ABC-def.123.77.2016`). Kotwica: symbol komórki
  (≥2 wersaliki, człony po „-" lub „.") + grupy cyfr zakończone 4-cyfrowym rokiem. Rozpoznawany
  także w środku zdania, bez etykiety.
- **Z kontekstem** — „Znak sprawy:", „Znak pisma:", „Nasz/Wasz znak:", „Sygn. akt", „Znak:";
  łapie też sygnatury sądowe („Sygn. akt II CSK 234/19"). Słowo kontekstowe zostaje, maskujemy
  sam znak.

Anty-nadmaskowanie: daty (`12.05.2024`), odwołania prawne (`art. 5 ust. 1`), numeracja
(`Rozdział 5.2`) i frazy typu „znak drogowy B-2" pozostają nietknięte. Nowy przełącznik
w „Co maskować" (Identyfikatory).

## v0.40.0 — 2026-07-09

(wpis odtworzony z historii commitów)

**Okna źródła i wyniku rozszerzają się razem, a nagłówek mówi wprost o wklejaniu tekstu do czatu
AI.**

Silnik bez zmian, zmieniła się tylko aplikacja.

- **Wspólne rozszerzanie okien.** Okno źródła ma uchwyt w prawym dolnym rogu (wcześniej rozmiar
  był zablokowany), a okno wyniku dostaje tę samą wysokość, więc oba rosną i maleją równo.
  Najmniejsza wysokość zależy od wysokości ekranu. (25cfd7e)
- **Równe paski narzędzi.** Paski przycisków nad oboma oknami mają tę samą minimalną wysokość,
  więc wiersze przycisków nie rozjeżdżają się w pionie. (25cfd7e)
- **Teksty.** Podpowiedź przy „Porównanie” i wskazówka opisują ten widok jako oryginał
  przekreślony obok znacznika, bez odwołania do recenzji w Wordzie. Komunikat o prywatności
  brzmi teraz: „Twój tekst nie opuszcza przeglądarki — nic nie trafia na żaden serwer.”
  (25cfd7e)
- **Nagłówek.** „Usuń dane osobowe z tekstu, zanim wkleisz go do czatu AI lub asystenta.”
  zamiast „…do czatu, e-maila czy formularza”. Wersję z nazwami ChatGPT i Claude z pierwszego
  commita tego samego dnia zastąpiło określenie bez nazw własnych. (25cfd7e, 4def736)

## v0.39.0 — 2026-07-07

Dopracowanie UX (bez zmian w silniku):

- **„Co maskować": jednolita siatka kafelków tej samej szerokości.** Pojedynczy typ w kategorii
  (IBAN w „Finansach", Imię i nazwisko w „Danych osobowych") to teraz normalny kafelek, a nie
  rozciągnięta belka na całą szerokość. Tokeny (`[NR-PASZPORTU]` itd.) nie łamią się już na dwie linie.
- **Okna źródła i wyniku zmniejszone** do rozsądnej wysokości (było za duże) — nadal równe
  i ze synchronicznym przewijaniem.

## v0.38.0 — 2026-07-07

UX i dokumentacja (bez zmian w silniku):

- **„Co maskować" pogrupowane po kategoriach** (Identyfikatory, Kontakt, Finanse, Adres i czas,
  Dane osobowe) — każda sekcja z kolorową kropką jak w legendzie. Koniec poszarpanej siatki;
  układ ma teraz „ład i skład".
- **Okna źródła i wyniku: większe, równej wysokości, ze synchronicznym przewijaniem** — przewijasz
  jedno, drugie podąża (jak w recenzji dokumentu). Ułatwia porównywanie oryginału z wynikiem.
- **README rozbudowany o przystępną sekcję „Jak to działa i dlaczego jest bezpieczne — bez
  żargonu"** dla osób bez wiedzy technicznej: gdzie trafiają dane (nigdzie), jak to sprawdzić,
  jak działa rozpoznawanie, co można ustawić. Tabela „Co wykrywa" uzupełniona (KRS, miasto
  w kontekście zamieszkania, daty słowne, pola formularza).

## v0.37.0 — 2026-07-07

**Miejscowość w kontekście adresu i zamieszkania jest teraz maskowana** (zgłoszony wyciek miast).

- Miasto maskowane, gdy: stoi zaraz po zamaskowanym adresie („ul. Kwiatowa 5, **Warszawa**"),
  po markerze zamieszkania („**zamieszkały w Krakowie**", „**mieszka w Sopocie**", „**zam. w Rzeszowie**",
  „**miejsce zamieszkania: Białystok**", „miejsce urodzenia: Kraków"), po kodzie pocztowym lub przed
  adresem. Obsługa miast wielowyrazowych („Nowy Sącz", „Zielona Góra") i form odmienionych.
- **Precyzja utrzymana** (weryfikacja wieloagentowym audytem adwersarialnym): miasta w prozie
  („spotkanie w Łodzi"), w nazwach instytucji („Sąd Okręgowy w Katowicach"), kraje („w Polsce")
  i placówki/ulice po markerze („mieszka w Sądzie", „zam. Plac Wolności 2") **NIE są ruszane** —
  maskowanie zamieszkania jest bramkowane słownikiem znanych miast.

## v0.36.0 — 2026-07-07

**Formularze urzędowe (etykieta → wartość) + twarde utwardzenie precyzji.**

- **Nowość: detekcja pól formularza.** Eksporty urzędowe mają układ „Etykieta\nWARTOŚĆ"
  (wartość w osobnej linii, często WERSALIKAMI) — reguły tego nie łapały. Teraz pola
  „Nazwisko", „Imię/Imiona", „Data urodzenia", „Miejsce urodzenia", „Ulica", „Nr domu/lokalu",
  „Miejscowość" (w tej samej linii po „:" lub w następnej) są maskowane. Pola administracyjne
  (Kraj, Województwo, Powiat, Gmina) celowo zostają — za szerokie na PII.
- **Precyzja utwardzona po wieloagentowym audycie adwersarialnym** (5 agentów × realistyczne
  pisma sądowe/wnioski/karty medyczne/HR/proza). Naprawione klasy nadmaskowania:
  - separatory nazwisk `\s+` → `[ \t]+` — nazwisko na końcu wiersza nie skleja się z następną
    linią (nie zjada etykiet/wyrazów; dotyczy też miejscowości po kodzie pocztowym);
  - para „rzeczownik + nazwisko" („Pracownik Kowalski", „Zakład Usługowy Nowak") — rzeczownik
    zostaje, maskowane jest samo nazwisko;
  - eponimy medyczne i nazwy ulic z sufiksem -ski/-cki („choroba Leśniowskiego", „ulica Puławska")
    oraz przymiotniki instytucji („Ogólnopolski Związek", „Uniwersytet Jagielloński") — nie osoby;
  - puste pole formularza nie przejmuje następnej etykiety; proza/instrukcje z „Ulica"/„Imię
    i nazwisko" nie są brane za etykiety; wartości proceduralne („nie dotyczy", „do ustalenia") pomijane.
- **Nowość: numer KRS** i **data urodzenia słownie** — z poprzednich wydań, potwierdzone testami.

## v0.35.0 — 2026-07-06

- **Data urodzenia zapisana słownie jest teraz maskowana** — „ur. 5 maja 1985 r.",
  „urodzony 12 grudnia 1970", „data urodzenia: 1 stycznia 2000" → `[DATA-URODZENIA]`.
  Wcześniej detektor znał tylko formaty cyfrowe (DD.MM.RRRR / RRRR-MM-DD). Precyzja zachowana:
  „W maju 1985" bez kontekstu urodzenia pozostaje jawne.

## v0.34.0 — 2026-07-06

- **Numer KRS jest teraz maskowany** — kontekst „KRS" + 10 cyfr (także z zerami wiodącymi,
  np. „KRS 0000173413") → `[KRS]`. Nowy typ z osobnym przełącznikiem i chipem. Wcześniej wyciekał.
- **Przeglądanie wyniku: powód pokazuje się po najechaniu, nie po kliknięciu strzałki.**
  Przejście ‹ › podświetla bieżący fragment pierścieniem, ale nie wyświetla już automatycznie
  dymka z powodem (wyskakiwał, bo znacznik był fokusowany). Klawiatura działa też, gdy fokus jest
  na strzałkach; czytnik ekranu dostaje zwięzły komunikat.
- **Kopia z „—" (pauza) usunięta z interfejsu** — tytuły, podtytuły, notki i podpowiedzi używają
  teraz przecinków/dwukropków zamiast pauzy (np. „Wynik zanonimizowany", „Lokalny anonimizator
  polskich danych osobowych", „Usuń dane osobowe z tekstu, zanim wkleisz…").
- **„Co maskować" bez dziury** — układ przełączników przełączony na flexbox, który wypełnia
  ostatni (niepełny) rząd, więc przy dowolnej liczbie typów nie zostaje pusta przestrzeń.

## v0.33.0 — 2026-07-06

Sprzątanie kodu z wieloagentowego przeglądu (bez zmiany zachowania — 138 testów rdzenia + 10 web,
benchmark 100%/99,4%):

- **Rdzeń:** wspólny circuit breaker wydzielony do `breaker.ts` (był kopiowany 1:1 w NER i LLM);
  helper `escapeRe` i stała `CAP_CITY`/`CURRENCY_CODES` zamiast powtórzeń; regex `RE_SOLO_MORPH`
  z jednego źródła (`CAP_WORD`); `KNOWN_MASKS` w warstwie LLM uzupełnione o `[NR-PASZPORTU]`
  i `[MIEJSCOWOŚĆ]`; ujednolicony timeout w `nerHealthCheck`; usunięty artefakt stoplisty
  i zbędny eksport `SURNAMES`; poprawiony przesunięty komentarz JSDoc.
- **Web:** martwe reguły CSS usunięte (`.tip-open`, nadpisane kolumny `.toggles`, ukryte
  `.step-no`, no-op `margin-left`); cztery identyczne klasy plakietek scalone w `.badge`;
  meta `color-scheme`/`theme-color` zmienione na jasne (spójnie z motywem); helper `goToPrevMask`
  zamiast zdublowanego wyrażenia; nagłówkowy komentarz CSS zaktualizowany.
- **Konfiguracja:** usunięte martwe pole `allowScripts` z root `package.json`.

## v0.32.0 — 2026-07-06

- **NIP zapisany spacjami już maskowany** — „526 27 35 917" (i grupowanie 3-3-2-2:
  „526 273 59 17") wcześniej wyciekał, bo wzorzec znał tylko myślniki i 10 cyfr ciągiem.
  Separatorem jest teraz **myślnik LUB spacja**; suma kontrolna liczona po samych cyfrach.
- **Przywrócono odczyt PDF w edycji „urzędnik"** — cofnięto odchudzenie z v0.31 (odcięcie pdfjs).
  Obsługa PDF wróciła do obu edycji; plik znów ~1,77 MB. (Odchudzenie okazało się niepotrzebnym
  kosztem funkcjonalności.)

## v0.31.0 — 2026-07-06

- **Edycja „urzędnik" ~94% mniejsza: 1,77 MB → 99 kB.** Odcięto bibliotekę pdfjs (dominowała
  rozmiar) — w tej edycji obsługa PDF nie jest potrzebna. Plik otwiera się natychmiast i łatwo
  go rozesłać e-mailem. Pełna edycja **zachowuje PDF** (ładowany dynamicznie dopiero przy otwarciu
  pliku PDF). Urzędnik przy próbie wczytania PDF pokazuje jasny komunikat (wklej tekst / TXT / DOCX).
- **Wydajność:** regexy wykrywania nazwisk kompilowane raz (moduł), nie przy każdym wywołaniu.
- **Dokumentacja:** README zsynchronizowane z rzeczywistością (recall 100% offline, morfologiczne
  nazwiska, nowe typy: miejscowość i numer paszportu, ulice z liczbą/skrótem).

## v0.30.0 — 2026-07-06

Zbiorcza optymalizacja z wieloagentowego audytu (9 soczewek → backlog). 17 poprawek,
benchmark bez regresji (recall 100%, precyzja 99,4%), 137 testów rdzenia + 10 web.

- **Precyzja (mniej nadmaskowania — czołowy priorytet pisma urzędowego):**
  - „Nazwisko Imię" (reguła odwrócona) nie kasuje już zwykłego wyrazu przed imieniem —
    „Wczoraj Anna", „Umowa Marii", „Witam Ewa" zostają; nagłówki e-maili („From: Ejkszto Anna")
    nadal maskowane.
  - Nazwy komitetów/związków/parków nietknięte: „Komitet Obywatelski", „Hufiec Harcerski",
    „Bieszczadzki Park Narodowy"; pospolite przymiotniki „Niski poziom", „wąski" itd.
  - „Pan/Pani + funkcja" zachowuje rolę: „Pani Minister", „Pan Wojewoda Mazowiecki" bez zmian,
    „Pan Dyrektor Kowalski" → maska tylko nazwiska.
  - Dowód bez kontekstu wymaga poprawnej sumy kontrolnej — sygnatury/kody („RPO 401234",
    „ABC 123456") nie są brane za dowód.
  - Miesiąc „Maja" nie jest już mylony z imieniem („Pierwszego Maja").
- **Recall (mniej wycieków):** nazwisko słownikowe z myślnikiem („Nowak-Schmidt"), imiona/nazwiska
  zaczynające się od Ł/Ś/Ż/Ą (naprawiona granica słowa), odmieniony honoryfik („Panem Kowalskim").
- **Nowy typ: numer paszportu** — `[NR-PASZPORTU]` (kontekst „paszport" + 2 litery + 7 cyfr),
  osobny przełącznik i chip.
- **Wydajność:** koniec O(N²) w rozpoznawaniu nazwisk; debounce redakcji (~140 ms) — płynne pole
  niezależnie od długości tekstu (licznik znaków nadal natychmiastowy).
- **Dostępność (WCAG):** dostępna nazwa głównego pola, `aria-pressed` na przełączniku widoku,
  koniec zalewania czytnika przy pisaniu (jeden zwięzły komunikat po debounce), treść podpowiedzi
  dostępna dla czytników (aria-label z treści tooltipa).
- **Bezpieczeństwo:** `escapeHtml` obejmuje cudzysłowy, licznik z warstwy NER koercjonowany do liczby.

## v0.29.0 — 2026-07-06

- **Przeglądanie zamaskowanych fragmentów w wyniku** (prośba użytkownika: „łatwo przeglądać
  zanonimizowane dane"). W pasku Wyniku pojawia się nawigacja **‹ N / M ›**:
  - **strzałki + licznik** — poprzedni/następny zamaskowany fragment (cyklicznie); bieżący
    dostaje wyraźny pierścień i **automatycznie pokazuje powód wykrycia** (podświetlenie + tooltip);
  - **klik w znacznik** — czyni go bieżącym; dla pseudonimów `[OSOBA-A]` podświetla **wszystkie
    wystąpienia tej samej osoby**;
  - **klik w chip „Zamaskowano"** (np. „PESEL ×3") — skacze po fragmentach danej kategorii;
  - **klawiatura** — ↑/↓ oraz ←/→ przechodzą między maskami, gdy fokus jest na wyniku;
  - działa w widoku „Wynik" i „Porównanie", uwzględnia `prefers-reduced-motion`, większe cele
    dotykowe na mobile, a kopiowany tekst pozostaje czysty (nawigacja to wyłącznie warstwa UI).

## v0.28.0 — 2026-07-06

- **Rzadkie i odmienione nazwiska maskowane BEZ słownika i BEZ AI — rozpoznawanie
  morfologiczne.** Nazwiska o charakterystycznym polskim sufiksie (`-ski/-cki/-dzki` +
  odmiana, `-icz/-wicz`, `-czyk`) są teraz wykrywane po samej formie: „Gzowskiego",
  „Krzemieniecka", „Bąkiewiczowi", „Zdrojewczyka", „Świętomira Gzowska", „Rzepeckiej-Gil".
  Dotąd łapał je tylko opcjonalny NER — teraz działa to w warstwie offline (edycja „urzędnik").
  **Benchmark (offline, bez NER): recall 89% → 100%, rzadkie nazwiska 51% → 100%, precyzja
  99,4%** — poziom NER, ale w jednym pliku HTML bez instalacji.
- **Precyzja utrzymana dzięki trzem zabezpieczeniom:** (1) stoplista przymiotników
  narodowych/regionalnych/miejskich („polski", „śląski", „warszawski", „mazowiecki"…);
  (2) ochrona nazw instytucji — przymiotnik po rzeczowniku z wielkiej litery nie jest
  nazwiskiem („Uniwersytet Warszawski", „Izba Lekarska", „Bank Śląski", „Politechnika Śląska");
  (3) dzierżawczy dopełniacz przy rzeczowniku maskuje SAMO nazwisko, zostawiając wyraz
  („Zaległości Trzebiatowskiego" → „Zaległości [IMIĘ I NAZWISKO]"). Zweryfikowane na
  realnych frazach urzędowych (zero nadmaskowań).
- **Małżonkowie/rodzeństwo o wspólnym nazwisku** („Anna i Jan Kowalscy") maskowani w całości
  — wcześniej pierwsze imię wyciekało.
- Benchmark uzgodniony z aktualną specyfikacją (miejscowość po kodzie, format dowodu).

## v0.27.0 — 2026-07-06

- **Nowe ikony — inline SVG zamiast ciemnych rastrów.** Dotychczasowe ikony były ciemnymi
  kafelkami PNG, które „gryzły się" z jasnym motywem (skarga użytkownika). Cały zestaw
  (30 ikon) przepisany na inline SVG: ostre w każdym rozmiarze, przezroczyste,
  **automatycznie w kolorze kategorii** (osoby fiolet, kontakt turkus, identyfikatory złoto,
  finanse zieleń, adres/czas błękit), znikoma waga, zero zewnętrznych assetów. Jedno źródło
  prawdy (`icons.ts`), spójne w statycznym HTML i elementach dynamicznych.
- **Lifting UX/UI (na bazie wieloperspektywicznej krytyki):**
  - **Rozwarstwienie jasności** tło/pole/karta — koniec „mdłej", płaskiej bieli; karty
    wyraźniej odcinają się od tła, pola edytorów są jaśniejszym panelem.
  - **Typografia**: baza 16px (czytelność dla urzędników), mocniejszy tytuł (hero),
    spójne wagi 600/700, usunięte niespójne rozmiary „.5px".
  - **Stany**: wyłączony przycisk „Kopiuj" nie wygląda już na aktywny (szary, gdy nie ma
    czego kopiować).
  - **Kroki 1–4**: usunięta zdublowana numeracja (kicker „KROK N" wystarcza).
  - **Kontrast/dostępność**: przyciemnione kolory znaczników kontakt/identyfikatory/finanse
    do AA na tle pól; cienie i drobne błędy (`var(--txt)`) zestrojone z jasnym motywem.
  - **Legenda**: pigułki spójne z resztą rodziny (zaokrąglenie 999px), interlinia edytorów
    zbita 1.9 → 1.6.

## v0.26.0 — 2026-07-06

- **Miejscowość w adresie już nie wycieka** — dotąd maskowaliśmy ulicę i kod pocztowy,
  ale nazwa miasta tuż za kodem zostawała jawna („Królewska 27, 00-060 **Warszawa**").
  Teraz cały blok schodzi do `[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]`. Kotwica to kod
  pocztowy: w polskim adresie miejscowość ZAWSZE stoi za kodem („XX-XXX Miasto"), więc
  rozpoznanie jest pozycyjne i pewne. Miasta jedno- i wielowyrazowe („Nowy Sącz"), z
  myślnikiem („Bielsko-Biała") — maskowane w całości; drugi/trzeci człon doklejany tylko
  gdy tworzy znaną wielowyrazową miejscowość (słownik ~75 pozycji), więc następne zdanie
  („00-950 Warszawa. **Sprawę**…") nie jest pożerane.
- **Miasto PRZED adresem bez kodu też maskowane** — „Warszawa, ul. Królewska 27",
  „Zielona Góra, ul. Długa 5", „Sąd Okręgowy w Poznaniu, ul. …" (także forma zależna).
  Tu nie ma kodu-kotwicy, więc używamy słownika ~250 polskich miast (mianownik + częste
  formy zależne dużych miast) **wyłącznie w pozycji adresowej** „…, ul./[ADRES]". Dzięki
  temu ogon nazwy instytucji NIE jest ruszany („Zarząd Dróg Miejskich, ul. …",
  „Ministerstwo Cyfryzacji, ul. …" → nazwa zostaje).
- **Miasto w WOLNYM TEKŚCIE pozostaje nietknięte** (świadomy wybór: wysoka precyzja, zero
  nadmaskowania) — „mieszka w Warszawie", „dotyczy Warszawy oraz Krakowa", „Sąd Rejonowy
  dla Warszawy-Śródmieścia" bez „, ul./[ADRES]" obok NIE są ruszane. Słownik miast działa
  tylko w pozycji adresowej. Osobny przełącznik „Miejscowość" w „Co maskować".
- **Ulice z liczbą lub skrótem w nazwie już maskowane** — „ul. 3 Maja 1",
  „ul. 11 Listopada 5/3", „ul. gen. Andersa 5", „ul. ks. Popiełuszki 3", „ul. św. Marcin 8".
  Wcześniej wzorzec adresu oczekiwał nazwy z wielkiej litery zaraz po „ul.", więc ulice
  zaczynające się od cyfry lub małego skrótu rangi/tytułu zostawały jawne.

## v0.25.0 — 2026-07-06

- **Dwa imiona + nazwisko — nazwisko już nie wycieka** — „Monika Ewa Nojszewska",
  „Moniką Ewą Nojszewską", „Jan Maria Rokita" maskowane w całości jedną etykietą.
  Wcześniej para zjadała same imiona, a prawdziwe nazwisko zostawało jawne. Logika imion
  przepisana na jedną regułę „imiona (1–2) + nazwisko", kotwiczoną na pierwszym imieniu —
  wyrazy poprzedzające („Pracownik", „Wczoraj") zostają, encje prawne nietknięte.

## v0.24.0 — 2026-07-06

- **Nazwiska w kolejności „Nazwisko Imię" (nagłówki e-maili) maskowane** — listy To/Cc/From
  z Outlooka („Kowalska Ewa", „Ejkszto Anna", „Bryzek-Muszyńska Edyta") są teraz maskowane
  w całości. Wcześniej imię lub całość wyciekało. Reguła wymaga znanego imienia jako drugiego
  słowa i chroni tytuły („Pani Anna" → zostaje „Pani") oraz encje prawne/dokumentowe.
- **+~90 częstych imion w słowniku** (Edyta, Aneta, Iga, Olga, Leon, Fabian, Ksawery…) —
  luka pokrycia wykryta na realnych nagłówkach.

## v0.23.0 — 2026-07-06

- **Adres bez prefiksu „ul." też maskowany** — ulica rozpoznawana po sąsiedztwie kodu
  pocztowego: „Królewska 27, 00-060 Warszawa" i „Aleje Jerozolimskie 100, …" → `[ADRES]`.
  Kotwica na (już zamaskowanym) kodzie pocztowym daje wysoką precyzję — „Rozdział 5",
  „Załącznik 2" czy „poz. 5" nie są mylone z adresem. Zamyka lukę z realnego pisma
  urzędowego, gdzie ulica bez „ul." zostawała jawna.

## v0.22.0 — 2026-07-06

- **Numer wersji w nagłówku + link „sprawdź najnowszą"** — pod tytułem widnieje teraz
  „wersja X · sprawdź najnowszą ↗" prowadząca do strony wydań. Rozwiązuje powracające
  zamieszanie: użytkownik testował stary, wcześniej pobrany plik, nie wiedząc, że jest
  nieaktualny — teraz od razu porówna numer.
- **Edycja urzędnik bez wzmianek o AI** — nagłówek, plakietka i krok „Analiza" nie mówią
  już o „lokalnym AI/NER" (którego w tej edycji nie ma) — spójny, uczciwy przekaz dla
  głównej grupy docelowej.

## v0.21.0 — 2026-07-06

- **Imiona w ODMIANIE nie wyciekają już obok nazwiska** — „Anną Kowalską", „Janem
  Nowakiem", „Annę Wiśniewską" maskowane w całości. Wcześniej słownik znał tylko mianownik,
  więc nazwisko znikało, a imię („Anną") zostawało jawne. Teraz imię rozpoznajemy po rdzeniu
  słownikowym + końcówce fleksyjnej (para „imię-jak + nazwisko" → jedna maska). Encje prawne
  („Sąd Najwyższy", „Kodeks Cywilny") i miasta („w Warszawie") pozostają nietknięte.

  Uwaga dla użytkowników: to poprawka w kodzie — pobierz świeży `Anonimizator.html`
  z tego wydania (stary, wcześniej zapisany plik nie ma tych zmian).

## v0.20.0 — 2026-07-06

- **Jasny, przyjazny motyw** (feedback: „zrób bardziej przyjazną kolorystykę") — cała
  aplikacja przełączona z ciemnego „enterprise" na jasny, bliski oprogramowaniu
  biurowemu/urzędowemu: białe karty, delikatne błękity, przyciemnione kolory kategorii
  dla kontrastu. Zweryfikowane zrzutem (obie edycje).
- **Koniec dziury obok „Co maskować"** — po usunięciu karty NER w edycji urzędnik
  „Co maskować" rozciąga się na całą szerokość, a przełączniki układają się w responsywną
  siatkę (5 w rzędzie zamiast 2). Struktura strony bez pustych flanków.
- **Numer dowodu wykrywany także BEZ kontekstu** — sam format „3 wielkie litery + 6 cyfr"
  (`ABC 123456`, `ABC123456`) jest maskowany, bo to charakterystyczny układ dowodu; wyjątek:
  kody walut (`PLN 123456`). Rozszerzone też wyzwalacze kontekstowe (legitymacja, dokument
  tożsamości, „dowód osobisty nr …"). Kompromis: numer typu `FVS 202401` też zostanie
  zamaskowany — świadomie w stronę bezpieczeństwa.

## v0.19.0 — 2026-07-06

Wydanie skrojone pod główną grupę docelową — **urzędników** (feedback z testów na realnych
pismach). Wersja dla prawników/zaawansowanych przyjdzie osobno.

- **Release = jeden plik + instrukcja.** Zasób wydania to teraz `Anonimizator.html`
  (samowystarczalny, podwójny klik) i `JAK-UZYC.txt` — koniec z ZIP-em, launcherem i AI
  w paczce. **Cała wiedza (NER, launcher, ONNX, LLM) zostaje w repozytorium** — znika
  wyłącznie z wydania. Build „urzędnik" (`VITE_EDITION=urzednik`) ukrywa warstwę AI/NER
  (elementy `[data-full]`) już od pierwszego malowania, bez mignięcia.
- **Telefony stacjonarne z +48** — naprawiony realny błąd z pism: numer
  `+48 22 245 59 22` (podział 2-3-2-2) zostawał jawny, bo detektor zakładał tylko układ
  3-3-3. Teraz prefiks `+48/0048` dopuszcza dowolne grupowanie 9 cyfr, a słowa
  kontekstowe (`tel.`, `telefon`, `kom.`, `fax`) też wyzwalają maskowanie stacjonarnych.
- **Nr dowodu osobistego z kontekstem** — słowa `dowód/dowodu/seria i numer/nr dowodu`
  (z diakrytykiem i bez) maskują numer `ABC 123456` nawet bez poprawnej sumy kontrolnej;
  bez kontekstu nadal wymagana suma (mało fałszywych trafień). „dowód zakupu" nie jest
  mylony z dowodem osobistym.

## v0.18.0 — 2026-07-06

- **AI jednym kliknięciem, bez Dockera** — launcher `START-ANONIMIZATOR.bat` +
  `launcher/serve.ps1`: mini-serwer na `127.0.0.1` (zwykły `TcpListener`, bez uprawnień
  administratora, bez zależności) podaje aplikację po `http`, dzięki czemu model
  ONNX w przeglądarce rusza po podwójnym kliknięciu. Launcher trafia do paczki offline;
  instrukcja krok po kroku: [`docs/AI-BEZ-DOCKERA.md`](https://github.com/karolpolikarp/parawan/blob/v0.18.0/docs/AI-BEZ-DOCKERA.md).
  Odpowiedź na feedback: „większość urzędników nie zainstaluje Dockera”.
- **NER przeprojektowany na „AI, opcjonalne”** — karta zwinięta domyślnie (mniej
  natłoku), prowadzi ścieżką przeglądarkową (Docker zdegradowany do „zaawansowane”),
  status widoczny na zwiniętym nagłówku. Selektor źródła zawsze dostępny (koniec
  uwięzienia użytkowników Dockera bez paczki ONNX).
- **Czytelniejsza legenda kategorii** — duże kolorowe kropki zamiast maleńkich ikon,
  wyraźniejsze etykiety i kontrast (feedback: „wiersz słabo widoczny, ikonki za małe”).
- **Mniej natłoku** — tabela „Co wykrywa” zwinięta domyślnie (czysty widok narzędzia,
  szczegóły po kliknięciu).

## v0.17.0 — 2026-07-06

(wpis odtworzony z historii commitów)

**Aplikacja przebudowana na układ kart w siatce, z typami danych pogrupowanymi w kategorie
i podsumowaniem wykryć pod wynikiem.**

Silnik bez zmian, całość weszła jednym commitem.

- **Układ kart.** Strona składa się z kart na 12-kolumnowej siatce: cztery kroki (Wklej tekst,
  Analiza, Maskowanie, Gotowe), legenda „Kategorie danych” (kolor znacznika oznacza kategorię),
  okna „Tekst źródłowy” i „Wynik” oraz karty „Dlaczego mało fałszywych trafień”, „Ograniczenia”
  i „Wskazówki”. (f05a550)
- **„Co maskować” w kategoriach.** Typy są pogrupowane w Osoby, Kontakt, Identyfikatory, Finanse
  oraz Adres i czas. Każdy kafelek ma ikonę i podpowiedź z metodą wykrywania, np. „11 cyfr +
  walidacja sumy kontrolnej” przy PESEL-u. (f05a550)
- **Podsumowanie wykryć.** Karta „Zamaskowano” pokazuje liczbę wykryć i kategorii, a czytnik
  ekranu ogłasza jej zmiany. „Kopiuj” i „Pobierz” są aktywne dopiero, gdy jest wynik. (f05a550)
- **Ikony.** Aplikacja używa 30 ikon PNG (23 z nich doszły w tej wersji), wbudowanych w pojedynczy
  plik. W repozytorium przybył też katalog `design-variants/` z trzema wariantami makiety (A, B, C) i zrzutami ekranu. (f05a550)

## v0.16.0 — 2026-07-05

- **Ikony wróciły** (sprite użytkownika) — nagłówek, przyciski, karty ustawień;
  na stonowanych kafelkach wpasowanych w ton enterprise.
- **Wypełnienie ekranu**: sekcja „Co wykrywa" w układzie dwukolumnowym —
  tabela + boczna kolumna trzech kart („Dlaczego mało fałszywych trafień",
  „Ograniczenia", „Wskazówki" ze skrótami klawiszowymi w stylu <kbd>);
  całość poszerzona do 1320 px. Koniec pustych flanków na szerokich ekranach.

## v0.15.0 — 2026-07-05

**Ułożenie treści** (architektura informacji):

- Hero odchudzone: wielkie pudło prywatności → smukła linijka pod badge'ami
  (komunikat „100% Offline" niesie już badge); mniej dublowania, szybciej do narzędzia.
- **Kroki 1→4 przeniesione NAD narzędzie** jako kompaktowy poziomy pasek
  (numer + tytuł + krótki opis) — edukacja przed użyciem, bez spychania panelu;
  znika duża sekcja kroków z dołu strony.
- **Tabela „Co wykrywa" pogrupowana kategoriami** w kolejności: identyfikatory →
  finanse → kontakt → adres/czas → osoby, z kolorowymi kropkami zgodnymi ze
  znacznikami w wyniku — treść strony i wynik mówią jednym językiem;
  zaktualizowany opis wiersza „Imię i nazwisko" (~230 nazwisk z odmianą).

## v0.14.0 — 2026-07-05

**Repozycjonowanie stylu: dark enterprise zamiast „cyber-gaming"** (feedback:
„zbyt gamingowo, za mało profesjonalnie"):

- Usunięte: siatka i kolorowe poświaty tła, neonowe glow na kartach/CTA/badge'ach,
  gradientowy tytuł, prefiks `//` nagłówków, kreskówkowe ikony ze sprite'a
  w przyciskach (zostaje favicon).
- W zamian: płaskie powierzchnie z subtelną elewacją, czysty wordmark, jednolite
  spokojne badge'e, pełny solidny akcent #3663d9, minimalistyczne kroki 1→4,
  mniejsze promienie (8–12px), typografia w duchu Linear/Vercel.
- Kolory znaczników PII zostają (funkcja czytania wyniku), ale w stonowanych
  odcieniach; przekreślenia w Porównaniu przygaszone.

## v0.13.0 — 2026-07-05

**Przestrzeń i hierarchia** (feedback: „więcej oddechu, lepszy układ, lepsza kolejność"):

- Wycentrowane hero z dużym światłem (tytuł 2.9rem, tagline, badge'e i plakietka
  prywatności na osi), sekcje rozsunięte do 5.5–6rem, stopka wycentrowana.
- **Ustawienia w dwóch kartach obok siebie** („Co maskować" | „Dokładniejsze
  wykrywanie nazwisk") — koniec pionowego ścisku pod narzędziem; na mobile
  wracają do jednej kolumny.
- Większe wszystko: padding paneli 1.75rem, pola 360px z paddingiem 1.3rem,
  odstęp paneli 2rem, kroki z gap 2rem, komórki tabeli 0.85/1.2rem,
  delikatniejsza siatka tła.

## v0.12.0 — 2026-07-04

- **Widok „Porównanie"** — recenzja jak w Wordzie: oryginalna wartość przekreślona
  na czerwono obok kolorowego znacznika, w jednym dokumencie. Przełącznik
  Wynik | Porównanie w panelu wyniku; po wczytaniu pliku (DOCX/PDF/TXT) tryb
  porównania włącza się automatycznie. Diff w O(n) bez bibliotek (nie-maskowe
  segmenty wyniku występują w oryginale dosłownie i po kolei).
- **Oddech**: większe światło w całym układzie (padding paneli/pól/tabeli,
  odstępy sekcji 4rem, delikatniejsza siatka tła) — czytelniej i bardziej
  profesjonalnie, klimat „2027" bez zmian.

## v0.11.0 — 2026-07-04

**Pełny redesign wizualny „2027"** (kierunek: cyber-privacy, na bazie UI-kitu użytkownika):

- Dark-only: głęboki granat z techniczną siatką i poświatami (czysty CSS, zero
  zewnętrznych zasobów — single-file bez zmian architektury).
- Gradientowy tytuł ze świecącą plakietką, rząd badge'ów (100% Offline / Bezpieczne /
  Open Source·MIT / Reguły+lokalne AI), pasek kroków 1→4, nagłówki sekcji w stylu `//`.
- **Kolorowe znaczniki per kategoria PII** — spójnie w wyniku i chipach:
  osoby=fiolet, kontakt=cyjan, identyfikatory=bursztyn, finanse=zieleń,
  adres/czas=błękit. Wynik czyta się na pierwszy rzut oka.
- Świecące CTA (gradient + glow), neonowe stany hover/focus/drag, tabela
  z hover-em wierszy, sekcja ograniczeń z bursztynową listwą.
- Weryfikacja: pełnostronicowe zrzuty desktop/mobile (0 px poziomego overflow),
  regresja NER ONNX 4/4.

## v0.10.0 — 2026-07-04

Duży szlif UX/UI po audycie panelu 5 agentów (5 soczewek, 39 znalezisk — wdrożone
wszystkie P0, komplet P1 i większość P2):

- **Mobile naprawione na dobre**: przyciski przenoszą się do własnego wiersza
  (koniec poziomego overflow), pola krótsze (wynik widoczny bez przewijania),
  fonty pól ≥16 px (iOS nie robi auto-zoomu), cele dotykowe ≥44 px.
- **Dostępność**: panel wyniku to nazwany, fokusowalny region (przewijanie
  z klawiatury); aria-live przeniesione na pasek wyników (czytnik nie czyta całego
  tekstu przy każdym klawiszu); spójny :focus-visible wszędzie; color-scheme
  (natywne kontrolki w kolorach motywu); prefers-reduced-motion.
- **Bezpieczeństwo pracy użytkownika**: upuszczenie pliku GDZIEKOLWIEK wczytuje go
  (wcześniej drop obok pola kasował stronę z tekstem!); link GitHub w nowej karcie;
  notka „⚠️ przejrzyj wynik" bezpośrednio pod wynikiem.
- **Stany**: „Wczytuję…" przy parsowaniu PDF/DOCX, „analizuję…" przy NER + błysk
  po dołożeniu masek, pasek błędów w UI zamiast alert(), martwe Kopiuj/Pobierz
  są teraz disabled, mini-przykład „przed → po" w pustym wyniku.
- **Język i detale**: „Wynik — zanonimizowany", plik zanonimizowany.txt, „Wynik
  skanowania:" przy zeru trafień, etykieta NER od korzyści (nie od akronimu),
  poprawiona podwójna negacja w „Co maskować", kontrast CTA w dark (AA),
  naprawiony promień tabeli, theme-color per motyw, wersja aplikacji w stopce.

## v0.9.1 — 2026-07-04

- **Ikony w interfejsie** (sprite od użytkownika, wycięte i osadzone inline —
  paczka offline nadal jednoplikowa): nagłówek, Przykład/Wczytaj/Wyczyść/Kopiuj/
  Pobierz, „Co maskować", plakietka NER. Świeży zrzut w README.
- **Podpowiedź o warstwie NER**: gdy rdzeń nic nie znajdzie, a NER jest wyłączony,
  pasek wyników podpowiada włączenie NER (feedback: trudne nazwiska bez NER dawały
  mylące zielone „nie wykryto danych osobowych").
- **Benchmark warstwy ONNX (int8)** na tym samym zbiorze 159 przypadków:
  **97,5% recall / 98,8% precision** (~7 ms/tekst na CPU) — recall minimalnie niższy
  od FastPDN w Dockerze (kwantyzacja), precyzja najwyższa ze wszystkich warstw NER.

## v0.9.0 — 2026-07-04

- **NER w przeglądarce (ONNX)** — finał programu SOTA T1–T5: rozpakuj
  `anonimizator-onnx-pack.zip` (z release'u `models-fastpdn-onnx-v1`) obok `index.html`,
  a przy serwowaniu po http w ustawieniach NER pojawia się źródło „w przeglądarce
  (ONNX, bez Dockera)" — pełny recall FastPDN w 100% offline, bez instalowania
  czegokolwiek. E2E zweryfikowane (Playwright): 4/4 trudne nazwiska w odmianie.
  Build aplikacji bez zmian rozmiaru (dynamiczny import spoza bundla); z `file://`
  opcja się nie pojawia (ograniczenie wasm/fetch przeglądarek).

Format wersji: [SemVer](https://semver.org/lang/pl/). Tagi `vX.Y.Z` budują paczkę
offline (`anonimizator-offline.zip`) w [Releases](https://github.com/karolpolikarp/anonimizator/releases).

## v0.8.0 — 2026-07-04

Trzy równoległe fronty programu SOTA (T3+T4+T5) w jednym wydaniu:

- **Benchmark** (`scripts/benchmark`, raport w `docs/BENCHMARK.md`): 159 przypadków
  z odmianą i negatywami. Wyniki: core 86,5% R / 99,4% P; core+FastPDN 99,4% R / 97,1% P.
- **4 fixy rdzenia wykryte benchmarkiem**: REGON ze złą sumą nie jest już zjadany
  przez detektor telefonu; „ur. 12.05.1985" maskowane (bug trailing \b); adresy
  w formach zależnych („na ulicy…"); nazwiska dwuczłonowe po wyzwalaczu w całości
  („Pan Habdank-Wojewódzki"). +4 testy regresyjne.
- **Warstwa LLM** (`anonimizator/llm`): `redactPIIUltra` przez lokalne Ollama
  (np. Bielik-11B) — span-extraction z twardą walidacją, fail-safe, breaker;
  eksperymentalna. +11 testów.
- **FastPDN jako ONNX int8** (release `models-fastpdn-onnx-v1`, 125 MB, CC-BY-4.0
  z atrybucją CLARIN-PL): NER bez Dockera przez transformers.js (~16 ms/akapit CPU);
  przykład `examples/ner-onnx-node.mjs` (zweryfikowany end-to-end).

## v0.7.0 — 2026-07-04

- **Usługa NER z dwoma backendami** (T2): `spacy` (domyślny, lekki) i `herbert`
  (transformers — `clarin-pl/FastPDN`, destylat HerBERT-a trenowany na KPWr).
  Na teście 7 trudnych nazwisk w odmianie: FastPDN 7/7 z kompletnymi spanami
  (w tym „Sarneckiej-Dul"), spaCy 7/7 z uciętym członem po myślniku.
  Wybór: `docker compose build --build-arg NER_BACKEND=herbert`.
- Odrzucony po testach: `pczarnik/herbert-base-ner` (wikiann) — mimo F1≈0,90
  na karcie modelu nie generalizował na realne zdania (szczegóły w SOTA-ANALIZA).
- Naprawa subwordowych offsetów (expand-to-word + scalanie), chunking długich
  tekstów z zakładką, filtr etykiet PER/nam_liv_person.

## v0.6.0 — 2026-07-04

- **Spójna pseudonimizacja** (T1b): opcja `pseudonyms` / flaga CLI `--osoby` /
  checkbox „Rozróżniaj osoby" — każda osoba dostaje stałą etykietę [OSOBA-A]/[OSOBA-B]…,
  zachowywaną w odmianie (Kowalski/Kowalskiego → ta sama litera). Zachowuje strukturę
  relacji w dokumentach prawnych. Ograniczenie: klucz = nazwisko, więc Jan i Anna
  Kowalscy dzielą etykietę. +6 testów.

## v0.5.0 — 2026-07-04

Start programu „najlepszy anonimizator PL 2026/2027" — analiza SOTA i architektura
warstwowa w [docs/SOTA-ANALIZA.md](https://github.com/karolpolikarp/parawan/blob/v0.5.0/docs/SOTA-ANALIZA.md).

- **Słownik ~230 najczęstszych polskich nazwisk z obsługą fleksji** w rdzeniu (T1a):
  maskuje nazwisko występujące samodzielnie („Sprawę Kowalskiego przekazano…"),
  w odmianie przymiotnikowej (-ski/-cki/-dzki, formy żeńskie i mnogie) i rzeczownikowej
  (Nowakowi, Wójcikiem), z ruchomym „e". Nazwiska-homonimy (Wilk, Baran, Mazurek…)
  świadomie wymagają kontekstu — „Wilk biegał po lesie" nie jest maskowane.
  Zero nowych zależności; działa w paczce offline i npm. +8 testów.

## v0.4.0 — 2026-07-04

- **Aplikacja czyta pliki PDF** — pdf.js (legacy build) z fake-workerem w buildzie
  single-file; ekstrakcja w pełni offline, zweryfikowana E2E z `file://`.
  Skany (bez warstwy tekstu) i PDF-y z hasłem dostają jasne polskie komunikaty.
  Paczka offline: ~31 kB → ~1,7 MB (544 kB gzip) — nadal jeden plik.
- 3 testy ekstrakcji PDF (minimalny PDF budowany w teście) + diagnostyczny `?pdftest`.

## v0.3.4 — 2026-07-04

- Zmergowane wszystkie 8 PR-ów Dependabota: TypeScript 6.0, Vitest 4, Vite 8,
  actions/checkout v7, setup-node v6, gh-release v3, minima pip usługi NER.
  Naprawy pod TS 6.0: jawny `rootDir` w buildzie core, `vite-env.d.ts` dla importu CSS.
- 7 testów jednostkowych parsera .docx w CI (dotąd tylko ręczny smoke-test).
- Angielskie streszczenie w README.

## v0.3.3 — 2026-07-04

- Favicon aplikacji (inline SVG — działa też offline) i `theme-color`.
- Szablony zgłoszeń GitHub (nierozpoznane PII / fałszywe trafienie) z ostrzeżeniem,
  by NIE wklejać prawdziwych danych osobowych do publicznych issues.
- Dependabot (npm / pip / GitHub Actions, tygodniowo).
- Zweryfikowany układ mobilny (~500 px, jedna kolumna); odświeżony zrzut w README.

## v0.3.2 — 2026-07-04

Przegląd stabilizacyjny:

- **CI typechekuje aplikację webową** (`tsc --noEmit`) — Vite tylko transpiluje,
  więc błędy typów przechodziły niezauważone.
- Uczciwy komunikat, gdy część typów jest wyłączona w „Co maskować" — zamiast
  mylącego „nie wykryto danych osobowych".
- „Kopiuj" ma fallback, gdy przeglądarka odmówi Clipboard API.
- CLI zdejmuje BOM z plików UTF-8 (Windows/`Out-File`).

## v0.3.1 — 2026-07-04

- UX: „Kopiuj" jako przycisk główny (akcent) + skrót **Ctrl/Cmd+Enter**; licznik
  zamaskowanych wystąpień w pasku „Zamaskowano (N)"; autofocus pola tekstowego.
- Paczka npm: dołączony `LICENSE`; zawartość zweryfikowana `npm publish --dry-run`
  (8 plików, ~11,5 kB). Homepage repo wskazuje najnowszy release.

## v0.3.0 — 2026-07-04

- **Aplikacja czyta pliki .docx** — ekstrakcja tekstu w 100% lokalnie (maleńki `fflate` +
  własny parser `word/document.xml`, bez ciężkich zależności); drag&drop i „Wczytaj plik".
- `CHANGELOG.md`.

## v0.2.1 — 2026-07-04

- **Naprawiona paczka offline**: Chromium blokuje skrypty modułowe i style `crossorigin`
  na `file://`, więc rozbite assety nie działały po podwójnym kliknięciu w Chrome/Edge.
  Teraz build to JEDEN samowystarczalny `index.html` (JS+CSS inline, ~24 kB).
- Zrzut ekranu aplikacji w README; parametr `?demo` autouzupełnia przykład.
- Bezpiecznik renderowania: wyniki > 300 tys. znaków bez podświetleń (ochrona DOM);
  zmierzona wydajność silnika: ~1,45 mln znaków w ~31 ms.

## v0.2.0 — 2026-07-03

- Biblioteka: `redactPII(tekst, { types?, masks? })` — wybór typów do maskowania
  i własne placeholdery; ścieżka bez opcji niezmieniona.
- Aplikacja: panel „Co maskować" (zapamiętywany lokalnie); odznaczenie imion wyłącza NER.
- Badge'e CI/Release/MIT w README.

## v0.1.1 — 2026-07-03

- Przycisk „Przykład" (pokazuje maskowanie + strażnik kontekstu numerów przepisów).
- Drag&drop pliku `.txt` na pole tekstowe.
- `JAK-UZYC.txt` w paczce offline; tematy repo na GitHubie.

## v0.1.0 — 2026-07-03

- Pierwsze wydanie: silnik regex + sumy kontrolne (PESEL/NIP/REGON/IBAN/nr dowodu),
  heurystyka imion i adresów, strażniki kontekstu prawnego; biblioteka npm (zero
  zależności), CLI, aplikacja webowa 100% client-side.
- Opcjonalny lokalny NER (spaCy PL): usługa `services/ner` (Docker) + klient
  `anonimizator/ner` (fail-safe, circuit breaker).

[Unreleased]: https://github.com/karolpolikarp/parawan/compare/v0.48.1...HEAD
[v0.48.1]: https://github.com/karolpolikarp/parawan/compare/v0.48.0...v0.48.1
[v0.48.0]: https://github.com/karolpolikarp/parawan/compare/v0.47.0...v0.48.0
[v0.47.0]: https://github.com/karolpolikarp/parawan/compare/v0.46.27...v0.47.0
[v0.46.27]: https://github.com/karolpolikarp/parawan/compare/v0.46.26...v0.46.27
[v0.46.26]: https://github.com/karolpolikarp/parawan/compare/v0.46.25...v0.46.26
[v0.46.25]: https://github.com/karolpolikarp/parawan/compare/v0.46.24...v0.46.25
[v0.46.24]: https://github.com/karolpolikarp/parawan/compare/v0.46.23...v0.46.24
[v0.46.23]: https://github.com/karolpolikarp/parawan/compare/v0.46.22...v0.46.23
[v0.46.22]: https://github.com/karolpolikarp/parawan/compare/v0.46.21...v0.46.22
[v0.46.21]: https://github.com/karolpolikarp/parawan/compare/v0.46.20...v0.46.21
[v0.46.20]: https://github.com/karolpolikarp/parawan/compare/v0.46.19...v0.46.20
[v0.46.19]: https://github.com/karolpolikarp/parawan/compare/v0.46.18...v0.46.19
[v0.46.18]: https://github.com/karolpolikarp/parawan/compare/v0.46.17...v0.46.18
[v0.46.17]: https://github.com/karolpolikarp/parawan/compare/v0.46.16...v0.46.17
[v0.46.16]: https://github.com/karolpolikarp/parawan/compare/v0.46.15...v0.46.16
[v0.46.15]: https://github.com/karolpolikarp/parawan/compare/v0.46.14...v0.46.15
[v0.46.14]: https://github.com/karolpolikarp/parawan/compare/v0.46.13...v0.46.14
[v0.46.13]: https://github.com/karolpolikarp/parawan/compare/v0.46.12...v0.46.13
[v0.46.12]: https://github.com/karolpolikarp/parawan/compare/v0.46.11...v0.46.12
[v0.46.11]: https://github.com/karolpolikarp/parawan/compare/v0.46.10...v0.46.11
[v0.46.10]: https://github.com/karolpolikarp/parawan/compare/v0.46.9...v0.46.10
[v0.46.9]: https://github.com/karolpolikarp/parawan/compare/v0.46.8...v0.46.9
[v0.46.8]: https://github.com/karolpolikarp/parawan/compare/v0.46.7...v0.46.8
[v0.46.7]: https://github.com/karolpolikarp/parawan/compare/v0.46.6...v0.46.7
[v0.46.6]: https://github.com/karolpolikarp/parawan/compare/v0.46.5...v0.46.6
[v0.46.5]: https://github.com/karolpolikarp/parawan/compare/v0.46.4...v0.46.5
[v0.46.4]: https://github.com/karolpolikarp/parawan/compare/v0.46.3...v0.46.4
[v0.46.3]: https://github.com/karolpolikarp/parawan/compare/v0.46.2...v0.46.3
[v0.46.2]: https://github.com/karolpolikarp/parawan/compare/v0.46.1...v0.46.2
[v0.46.1]: https://github.com/karolpolikarp/parawan/compare/v0.46.0...v0.46.1
[v0.46.0]: https://github.com/karolpolikarp/parawan/compare/v0.45.2...v0.46.0
[v0.45.2]: https://github.com/karolpolikarp/parawan/compare/v0.45.1...v0.45.2
[v0.45.1]: https://github.com/karolpolikarp/parawan/compare/v0.45.0...v0.45.1
[v0.45.0]: https://github.com/karolpolikarp/parawan/compare/v0.44.4...v0.45.0
[v0.44.4]: https://github.com/karolpolikarp/parawan/compare/v0.44.3...v0.44.4
[v0.44.3]: https://github.com/karolpolikarp/parawan/compare/v0.44.2...v0.44.3
[v0.44.2]: https://github.com/karolpolikarp/parawan/compare/v0.44.1...v0.44.2
[v0.44.1]: https://github.com/karolpolikarp/parawan/compare/v0.44.0...v0.44.1
[v0.44.0]: https://github.com/karolpolikarp/parawan/compare/v0.43.0...v0.44.0
[v0.43.0]: https://github.com/karolpolikarp/parawan/compare/v0.42.0...v0.43.0
[v0.42.0]: https://github.com/karolpolikarp/parawan/compare/v0.41.0...v0.42.0
[v0.41.0]: https://github.com/karolpolikarp/parawan/compare/v0.40.0...v0.41.0
[v0.40.0]: https://github.com/karolpolikarp/parawan/compare/v0.39.0...v0.40.0
[v0.39.0]: https://github.com/karolpolikarp/parawan/compare/v0.38.0...v0.39.0
[v0.38.0]: https://github.com/karolpolikarp/parawan/compare/v0.37.0...v0.38.0
[v0.37.0]: https://github.com/karolpolikarp/parawan/compare/v0.36.0...v0.37.0
[v0.36.0]: https://github.com/karolpolikarp/parawan/compare/v0.35.0...v0.36.0
[v0.35.0]: https://github.com/karolpolikarp/parawan/compare/v0.34.0...v0.35.0
[v0.34.0]: https://github.com/karolpolikarp/parawan/compare/v0.33.0...v0.34.0
[v0.33.0]: https://github.com/karolpolikarp/parawan/compare/v0.32.0...v0.33.0
[v0.32.0]: https://github.com/karolpolikarp/parawan/compare/v0.31.0...v0.32.0
[v0.31.0]: https://github.com/karolpolikarp/parawan/compare/v0.30.0...v0.31.0
[v0.30.0]: https://github.com/karolpolikarp/parawan/compare/v0.29.0...v0.30.0
[v0.29.0]: https://github.com/karolpolikarp/parawan/compare/v0.28.0...v0.29.0
[v0.28.0]: https://github.com/karolpolikarp/parawan/compare/v0.27.0...v0.28.0
[v0.27.0]: https://github.com/karolpolikarp/parawan/compare/v0.26.0...v0.27.0
[v0.26.0]: https://github.com/karolpolikarp/parawan/compare/v0.25.0...v0.26.0
[v0.25.0]: https://github.com/karolpolikarp/parawan/compare/v0.24.0...v0.25.0
[v0.24.0]: https://github.com/karolpolikarp/parawan/compare/v0.23.0...v0.24.0
[v0.23.0]: https://github.com/karolpolikarp/parawan/compare/v0.22.0...v0.23.0
[v0.22.0]: https://github.com/karolpolikarp/parawan/compare/v0.21.0...v0.22.0
[v0.21.0]: https://github.com/karolpolikarp/parawan/compare/v0.20.0...v0.21.0
[v0.20.0]: https://github.com/karolpolikarp/parawan/compare/v0.19.0...v0.20.0
[v0.19.0]: https://github.com/karolpolikarp/parawan/compare/v0.18.0...v0.19.0
[v0.18.0]: https://github.com/karolpolikarp/parawan/compare/v0.17.0...v0.18.0
[v0.17.0]: https://github.com/karolpolikarp/parawan/compare/v0.16.0...v0.17.0
[v0.16.0]: https://github.com/karolpolikarp/parawan/compare/v0.15.0...v0.16.0
[v0.15.0]: https://github.com/karolpolikarp/parawan/compare/v0.14.0...v0.15.0
[v0.14.0]: https://github.com/karolpolikarp/parawan/compare/v0.13.0...v0.14.0
[v0.13.0]: https://github.com/karolpolikarp/parawan/compare/v0.12.0...v0.13.0
[v0.12.0]: https://github.com/karolpolikarp/parawan/compare/v0.11.0...v0.12.0
[v0.11.0]: https://github.com/karolpolikarp/parawan/compare/v0.10.0...v0.11.0
[v0.10.0]: https://github.com/karolpolikarp/parawan/compare/v0.9.1...v0.10.0
[v0.9.1]: https://github.com/karolpolikarp/parawan/compare/v0.9.0...v0.9.1
[v0.9.0]: https://github.com/karolpolikarp/parawan/compare/v0.8.0...v0.9.0
[v0.8.0]: https://github.com/karolpolikarp/parawan/compare/v0.7.0...v0.8.0
[v0.7.0]: https://github.com/karolpolikarp/parawan/compare/v0.6.0...v0.7.0
[v0.6.0]: https://github.com/karolpolikarp/parawan/compare/v0.5.0...v0.6.0
[v0.5.0]: https://github.com/karolpolikarp/parawan/compare/v0.4.0...v0.5.0
[v0.4.0]: https://github.com/karolpolikarp/parawan/compare/v0.3.4...v0.4.0
[v0.3.4]: https://github.com/karolpolikarp/parawan/compare/v0.3.3...v0.3.4
[v0.3.3]: https://github.com/karolpolikarp/parawan/compare/v0.3.2...v0.3.3
[v0.3.2]: https://github.com/karolpolikarp/parawan/compare/v0.3.1...v0.3.2
[v0.3.1]: https://github.com/karolpolikarp/parawan/compare/v0.3.0...v0.3.1
[v0.3.0]: https://github.com/karolpolikarp/parawan/compare/v0.2.1...v0.3.0
[v0.2.1]: https://github.com/karolpolikarp/parawan/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/karolpolikarp/parawan/compare/v0.1.1...v0.2.0
[v0.1.1]: https://github.com/karolpolikarp/parawan/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/karolpolikarp/parawan/releases/tag/v0.1.0
