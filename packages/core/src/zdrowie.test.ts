// Dane o zdrowiu (typ ZDROWIE, maska [DANE O ZDROWIU]): przykłady z ewaluacji 50 pism
// (karty szpitalne, pisma kadrowe, pozwy, zgłoszenia szkody) i przypadki ujemne bez kotwicy.
import { expect, test } from 'vitest';
import { redactPII } from './index';

const Z = '[DANE O ZDROWIU]';

test('dane o zdrowiu: karta informacyjna, kody ICD-10 po kotwicy, leki z dawką', () => {
  const karta = [
    'KARTA INFORMACYJNA Z LECZENIA SZPITALNEGO',
    'Rozpoznanie:',
    'F32.1 epizod depresyjny umiarkowany',
    'J45.0 astma oskrzelowa z przewagą komponenty alergicznej',
    'Pacjent przyjęty w trybie pilnym z powodu nasilenia objawów. Stan przy wypisie dobry.',
    'Zalecenia przy wypisie:',
    'sertralina 50 mg',
    'salbutamol doraźnie',
    'insulina aspart',
    'kontrola w poradni specjalistycznej za 4 tygodnie',
    'lek. Adam Polak',
  ].join('\n');
  const r = redactPII(karta);
  expect(r.redacted).toBe(
    [
      'KARTA INFORMACYJNA Z LECZENIA SZPITALNEGO',
      'Rozpoznanie:',
      Z,
      Z,
      'Pacjent przyjęty w trybie pilnym z powodu nasilenia objawów. Stan przy wypisie dobry.',
      'Zalecenia przy wypisie:',
      Z,
      Z,
      Z,
      'kontrola w poradni specjalistycznej za 4 tygodnie',
      'lek. [IMIĘ I NAZWISKO]',
    ].join('\n'),
  );
  expect(r.found.find((f) => f.type === 'ZDROWIE')?.count).toBe(5);
  const cases: [string, string][] = [
    // wartość w tym samym wierszu: do końca zdania, kropka zostaje
    ['Rozpoznanie: K50.0 choroba Leśniowskiego-Crohna. Pacjent wypisany.', `Rozpoznanie: ${Z}. Pacjent wypisany.`],
    ['Rozpoznanie (ICD-10): J45.0, I10', `Rozpoznanie (ICD-10): ${Z}`],
    ['Diagnoza: J45.0 astma oskrzelowa', `Diagnoza: ${Z}`],
    ['Choroby współistniejące:\nnadciśnienie tętnicze\nniedoczynność tarczycy\n\nWywiad rodzinny bez obciążeń.', `Choroby współistniejące:\n${Z}\n${Z}\n\nWywiad rodzinny bez obciążeń.`],
    ['Rozpoznanie zasadnicze:\n- I10 Nadciśnienie tętnicze\n- E11.9 Cukrzyca typu 2\nlek. Jan Nowak', `Rozpoznanie zasadnicze:\n- ${Z}\n- ${Z}\nlek. [IMIĘ I NAZWISKO]`],
    ['Leki: Euthyrox 50 µg rano, Concor 5 mg 1x dziennie', `Leki: ${Z}`],
    ['Leki przyjmowane przewlekle:\nBisocard 5 mg\nXyzanol 10 mg 2 x dziennie\n\nWywiad: bez uwag.', `Leki przyjmowane przewlekle:\n${Z}\n${Z}\n\nWywiad: bez uwag.`],
    ['Zalecenia:\nodpoczynek\nmetformina 500 mg 2 x dziennie\nkontrola za miesiąc', `Zalecenia:\nodpoczynek\n${Z}\nkontrola za miesiąc`],
    // kod ICD-10 po słowie, które go zapowiada, wyliczenie kodów i kod w nawiasie po chorobie
    ['Pacjentka z rozpoznaniem F32.1 wymaga kontroli.', `Pacjentka z rozpoznaniem ${Z} wymaga kontroli.`],
    ['Niezdolność do pracy (kod choroby: M54.5, J45.0 i I10).', `Niezdolność do pracy (kod choroby: ${Z}, ${Z} i ${Z}).`],
    ['U pacjenta stwierdzono astmę oskrzelową (J45.0).', `U pacjenta stwierdzono ${Z}.`],
    // lek z dawką przy kotwicy
    ['Lekarz zalecił sertralinę 50 mg dziennie.', `Lekarz zalecił ${Z}.`],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});

test('dane o zdrowiu: frazy opisowe w pismach kadrowych, pozwach i zgłoszeniach szkody', () => {
  const cases: [string, string][] = [
    [
      'Zgodnie z zaświadczeniem lekarskim, po porodzie przez cesarskie cięcie przeciwwskazane jest dźwiganie ciężarów do końca roku.',
      `Zgodnie z zaświadczeniem lekarskim, po porodzie przez ${Z} przeciwwskazane jest ${Z} do końca roku.`,
    ],
    ['Od około dwóch lat pozwany nadużywa alkoholu, a w domu dochodziło do awantur.', `Od około dwóch lat pozwany ${Z}, a w domu dochodziło do awantur.`],
    [
      'W wyniku zdarzenia doznałem stłuczenia klatki piersiowej i przebywałem na zwolnieniu lekarskim przez 25 dni.',
      `W wyniku zdarzenia doznałem ${Z} i przebywałem na zwolnieniu lekarskim przez 25 dni.`,
    ],
    ['W wyniku zdarzenia doznałam złamania kości promieniowej.', `W wyniku zdarzenia doznałam ${Z}.`],
    // kotwica w zdaniu obok: „zaświadczeniem lekarza” stoi w następnym zdaniu
    [
      'Pracownica potrzebuje elastycznego czasu pracy w związku z koniecznością rehabilitacji ruchowej trzy razy w tygodniu. Potrzeba wynika z zerwania więzadła krzyżowego przedniego, potwierdzonego zaświadczeniem lekarza.',
      `Pracownica potrzebuje elastycznego czasu pracy w związku z koniecznością ${Z} trzy razy w tygodniu. Potrzeba wynika z ${Z}, potwierdzonego zaświadczeniem lekarza.`,
    ],
    // kotwica słaba („leczenia”, „rozpoznania”) z osobą obok („Pracownicy”); bez osoby patrz test niżej
    [
      'Pracownicy zapewniono czas pracy w związku z koniecznością wizyt u psychiatry co dwa tygodnie. Potrzeba wynika z leczenia epizodu depresyjnego.',
      `Pracownicy zapewniono czas pracy w związku z koniecznością ${Z} co dwa tygodnie. Potrzeba wynika z leczenia ${Z}.`,
    ],
    [
      'Pracownicy zapewniono przerwy na pomiar glikemii i podanie insuliny. Potrzeba wynika z rozpoznania cukrzycy typu 1.',
      `Pracownicy zapewniono przerwy na ${Z} i ${Z}. Potrzeba wynika z rozpoznania ${Z}.`,
    ],
    ['Pani Anna Nowak choruje na chorobę Hashimoto, co potwierdza zaświadczenie lekarskie.', `Pani [IMIĘ I NAZWISKO] choruje na ${Z}, co potwierdza zaświadczenie lekarskie.`],
    ['Choroba Parkinsona została rozpoznana u ojca w 2019 r.', `${Z} została rozpoznana u ojca w 2019 r.`],
    ['Mąż nadużywał alkoholu przez wiele lat.', `Mąż ${Z} przez wiele lat.`],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
  // typ wyłączony albo z własną maską
  expect(redactPII('Pozwany nadużywa alkoholu.', { types: ['IMIE'] }).redacted).toBe('Pozwany nadużywa alkoholu.');
  expect(redactPII('Pozwany nadużywa alkoholu.', { masks: { ZDROWIE: '[ZDROWIE]' } }).redacted).toBe('Pozwany [ZDROWIE].');
  // idempotencja: drugi przebieg nie zmienia wyniku
  const once = redactPII('Rozpoznanie: F32.1 epizod depresyjny. Leki: sertralina 50 mg.').redacted;
  expect(redactPII(once).redacted).toBe(once);
});

test('dane o zdrowiu: bez kotwicy i bez danych osoby tekst zostaje', () => {
  const same = [
    // „I10” bez kotwicy to też numer sali albo formularza
    'Spotkanie odbędzie się w sali I10 na drugim piętrze.',
    'Formularz I10 należy złożyć do 30 czerwca.',
    'Kod: A12 dotyczy wniosku.',
    'Oddział Kardiologii, sala 12, ICD-10 nie dotyczy.',
    'specjalista chorób wewnętrznych',
    // zdania o zdrowiu bez nazwy choroby i ogólne wzmianki bez kotwicy
    'Dane o zdrowiu pacjenta przetwarza Szpital Miejski zgodnie z art. 9 RODO.',
    'Zgodnie z art. 9 RODO dane o zdrowiu, w tym o nałogach, są szczególnej kategorii.',
    'Program profilaktyki cukrzycy i nadciśnienia tętniczego realizuje gmina.',
    'Wynika to z depresji gospodarczej lat 30.',
    'Osoba uzależniona od alkoholu nie może prowadzić pojazdu.',
    // nazwa instytucji z chorobą w nazwie
    'Centrum Leczenia Stwardnienia Rozsianego w Bydgoszczy przyjmuje pacjentów.',
    'Szpital im. Józefa Babińskiego, Oddział Chorób Wewnętrznych.',
    // lek bez dawki albo w cenniku
    'W magazynie jest paracetamol i ibuprofen.',
    'Cena: paracetamol 500 mg, 20 tabletek, 9,99 zł.',
    // homonimy urazów i przeciwwskazań
    'Zerwanie umowy nastąpiło w maju.',
    'Złamanie przepisów skutkuje karą.',
    'Uraz do szefa pozostał mu na lata.',
    'Brak przeciwwskazań do pracy na stanowisku kierowcy.',
    'Przeciwwskazane jest stosowanie kleju w temperaturze poniżej 5 stopni.',
    'Szkolenie z BHP: dźwiganie ciężarów jest przeciwwskazane dla kobiet w ciąży.',
    // „rozpoznanie” sprawy przez sąd, zalecenia pokontrolne
    'Rozpoznanie sprawy nastąpi na posiedzeniu niejawnym.',
    'Rozpoznanie sprawy nastąpi na posiedzeniu, a osoba uzależniona od alkoholu nie może prowadzić pojazdu.',
    'Zalecenia pokontrolne:\n1. Uzupełnić dokumentację.\n2. Przedłożyć raport.',
    // „Diagnoza:” w raporcie technicznym, bez kodu ICD-10
    'Diagnoza: awaria dysku twardego.\nZalecenia:\nwymiana dysku na nowy',
    'Diagnoza:\nuszkodzony zasilacz\nprzegrzany procesor',
    // Niebieska Karta to procedura przemocy domowej, nie dana o zdrowiu
    'W związku z czym wszczęto procedurę Niebieskiej Karty.',
  ];
  for (const t of same) expect(redactPII(t).redacted, t).toBe(t);
  // „lek.” to tytuł lekarza, a nie lek
  expect(redactPII('lek. Adam Polak').redacted).toBe('lek. [IMIĘ I NAZWISKO]');
});

test('dane o zdrowiu: tekst ogólny bez konkretnej osoby zostaje (poradnik, przepis, OWU, przetarg, raport)', () => {
  const same = [
    // kotwica słaba bez osoby: poradnik, przepis, OWU, przetarg, program NFZ, regulamin, raport
    'Pracodawca nie może pytać kandydata o stan zdrowia. Pytania o depresję, cukrzycę czy astmę są niedopuszczalne.',
    'Art. 26. Osoba uzależniona od alkoholu, która zgodnie z opinią biegłego wymaga leczenia, może zostać skierowana na leczenie odwykowe.',
    'OWU: ochrona nie obejmuje szkód powstałych wskutek nadużywania alkoholu. Leczenie nowotworu złośliwego jest objęte ochroną do 100 000 zł.',
    'Przedmiotem zamówienia jest dostawa glukometrów do pomiaru glikemii dla pacjentów z cukrzycą typu 2 oraz insuliny ludzkiej 100 j./ml.',
    'Program lekowy B.29: leczenie chorych na stwardnienie rozsiane (ICD-10: G35) finansowany przez NFZ.',
    'Regulamin oddziału. Pacjent ma prawo do informacji. Podanie insuliny odbywa się wyłącznie przez personel pielęgniarski.',
    'ZUS kieruje na rehabilitację leczniczą osoby zagrożone niezdolnością do pracy.',
    'Raport NIK: leczenie nowotworów w Polsce trwa zbyt długo, pacjenci czekają miesiącami.',
    'Ośrodek prowadzi leczenie uzależnienia od alkoholu.',
    'Fundacja wspiera dzieci z cukrzycą typu 1 i finansuje ich leczenie.',
    'Leczenie zawału serca w Polsce kosztuje miliardy złotych.',
    'Narodowy Fundusz Zdrowia finansuje leczenie cukrzycy typu 2 w ramach programu.',
    'Czas pracy w związku z koniecznością wizyt u psychiatry. Program obejmuje leczenie epizodu depresyjnego.',
    // nałóg w liczbie mnogiej i w zdaniu względnym
    'Gminny program profilaktyki: osoby, które nadużywają alkoholu, mogą bezpłatnie skorzystać z terapii.',
    'Kto nadużywa alkoholu, podlega karze.',
    // kody błędów urządzeń i sygnatury to nie ICD-10
    'Reklamacja pralki Bosch. Serwis postawił diagnozę: E18, czyli zablokowana pompa odpływowa.',
    'Diagnoza: F28 – brak zapłonu, wymieniono elektrodę.',
    'Diagnoza: F28 brak zapłonu',
    'Trybunał po rozpoznaniu K12/24 orzekł o zgodności.',
    'Trybunał po rozpoznaniu K 12/24 orzekł o zgodności.',
    // depresja terenu i gospodarki
    'Opinia geotechniczna. Na działce nr 123/4 stwierdzono depresję terenu o głębokości 1,2 m.',
    'W raporcie stwierdzono, że gospodarka wchodzi w depresję.',
    'Sprawa przekazana do rozpoznania. Depresja gospodarcza trwała do 1933.',
    // faktura, cennik, ulotka, lista refundacyjna
    'Faktura VAT nr FV/12/2025. Poz. 1: Ibuprofen 400 mg x 20 szt., Poz. 2: Apap 500 mg. Zalecana cena detaliczna.',
    'Leki na receptę: Xarelto 20 mg – 89,99 zł, Euthyrox 50 µg – 12,50 zł',
    'Ulotka: stosować zgodnie z zaleceniem lekarza. Paracetamol 500 mg',
    'Lista refundacyjna: Xarelto 20 mg we wskazaniach zgodnie z ChPL, stosowany u pacjentów po udarze mózgu.',
    'Pacjent stosuje się do zaleceń. Ibuprofen 400 mg kosztuje 12 zł.',
    // nagłówki sekcji w wykazie kosztów, raporcie IT, ofercie, protokole sądowym i technicznym
    'Wykaz kosztów do zwrotu\nLeki: 450,00 zł\nRehabilitacja: 300,00 zł',
    'Rozpoznanie: atak phishingowy na skrzynkę działu kadr.',
    'Leki: paracetamol, ibuprofen, witamina C – dostępne w sklepie.',
    'Rozpoznanie:\nnastąpiło na posiedzeniu niejawnym\nw dniu 12 marca 2025 r.',
    'Zalecenia:\n- błonnik 30 g dziennie\n- sól 5 g dziennie\n- kontrola w poradni',
    'Protokół.\nZalecenia:\n- dysk 500 g\n- Chlor wolny 0,3 mg',
    // odpowiedź przecząca w ankiecie
    'Choroby przewlekłe: nie\nLeki przyjmowane: nie',
    // szkoda w budynku albo maszynie, a nie uraz osoby
    'W budynku stwierdzono pęknięcia klatki schodowej.',
    'Podczas oględzin stwierdzono pęknięcie kolana instalacji wodnej.',
    'Stwierdzono pęknięcie kostki brukowej na chodniku.',
    'Stwierdzono złamanie ramienia dźwigu.',
    'Pracownik zgłosił, że stwierdzono złamanie ramienia dźwigu.',
  ];
  for (const t of same) expect(redactPII(t).redacted, t).toBe(t);
});

test('dane o zdrowiu: leki bez jednostki, częste rozpoznania, urazy czasownikiem, kody przy L4', () => {
  const cases: [string, string][] = [
    ['Pracownik dostarczył L4 z kodem F32 (depresja), zwolnienie do 30 czerwca.', `Pracownik dostarczył L4 z kodem ${Z} (${Z}), zwolnienie do 30 czerwca.`],
    ['Pacjent przyjmuje Euthyrox N 50 rano i Concor 5 raz dziennie.', `Pacjent przyjmuje ${Z} i ${Z}.`],
    ['Lekarz zalecił Depakine Chrono 500 mg dwa razy dziennie.', `Lekarz zalecił ${Z}.`],
    ['Pacjentka leczona onkologicznie z powodu raka piersi, w trakcie chemioterapii.', `Pacjentka leczona onkologicznie z powodu ${Z}, w trakcie ${Z}.`],
    ['Rozpoznano u pracownika zapalenie płuc, hospitalizacja trwała tydzień.', `Rozpoznano u pracownika ${Z}, hospitalizacja trwała tydzień.`],
    ['Pracownik przebywał na zwolnieniu lekarskim z powodu COVID-19.', `Pracownik przebywał na zwolnieniu lekarskim z powodu ${Z}.`],
    ['Pani Anna Nowak jest w ciąży, co potwierdza zaświadczenie lekarskie.', `Pani [IMIĘ I NAZWISKO] jest ${Z}, co potwierdza zaświadczenie lekarskie.`],
    ['Zgodnie z orzeczeniem lekarskim pracownik ma jaskrę i zaćmę.', `Zgodnie z orzeczeniem lekarskim pracownik ma ${Z} i ${Z}.`],
    ['Pozwany jest nosicielem HCV, zakażony wirusem HIV.', `Pozwany jest ${Z}, ${Z}.`],
    ['Poszkodowany doznał obrażeń: złamał nogę w kostce i ma wstrząśnienie mózgu.', `Poszkodowany doznał obrażeń: ${Z} i ma ${Z}.`],
    [
      'W zaświadczeniu lekarskim wskazano, że wnioskodawca od lat choruje na cukrzycę insulinozależną oraz ma nadciśnienie.',
      `W zaświadczeniu lekarskim wskazano, że wnioskodawca od lat choruje na ${Z} oraz ma ${Z}.`,
    ],
    // kod ICD-10 ze spacją po literze albo z przecinkiem
    ['Zaświadczenie lekarskie: rozpoznanie F 32.1, leczenie ambulatoryjne.', `Zaświadczenie lekarskie: rozpoznanie ${Z}, leczenie ambulatoryjne.`],
    ['Pacjentka z rozpoznaniem J45,0 wymaga kontroli.', `Pacjentka z rozpoznaniem ${Z} wymaga kontroli.`],
    // osoba z pola formularza kilka wierszy wyżej
    ['Nazwisko:\nRozpoznanie\nastma', `Nazwisko:\nRozpoznanie\n${Z}`],
    // uraz osoby obok szkody w mieniu
    ['Poszkodowana doznała urazu: stwierdzono złamanie kości promieniowej.', `Poszkodowana doznała urazu: stwierdzono ${Z}.`],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});

test('dane o zdrowiu: uwagi weryfikacji, korespondencja, komunikaty i protokoły bez danych osoby', () => {
  const same = [
    // list przewodni: „przesyłam” to czas teraźniejszy, a „Pani Dyrektor” to adresat
    'Dzień dobry, przesyłam ofertę programu leczenia cukrzycy typu 2 i nadciśnienia tętniczego dla Państwa poradni.',
    'Szanowna Pani Dyrektor, w związku z programem leczenia astmy oskrzelowej u dzieci przesyłam informację.',
    'Fundacja wspiera osoby z chorobą Parkinsona. Szanowna Pani Prezes, przesyłam sprawozdanie z leczenia.',
    // pacjenci w liczbie mnogiej i przetarg obok nazwiska osoby reprezentującej
    'Pani Ewa Nowak, kierownik oddziału, informuje, że od 1 stycznia poradnia przyjmuje pacjentów z cukrzycą typu 1 i astmą w nowym budynku.',
    'Szpital, reprezentowany przez Pana Dyrektora Jana Nowaka, ogłasza przetarg na leki do chemioterapii stosowane w leczeniu pacjentów.',
    // pandemia w sprawozdaniu finansowym i regulaminie
    'Rozpoznano, że pandemia COVID-19 istotnie wpłynęła na przychody Spółki w 2021 r.',
    'Spółka doznała znacznych strat w wyniku pandemii COVID-19.',
    'W okresie pandemii COVID-19 pracownik, który przedstawi zwolnienie lekarskie, zachowuje prawo do wynagrodzenia.',
    // protokoły techniczne i budowlane
    'W trakcie kontroli stwierdzono nadciśnienie w przewodzie zasilającym. Kontrolę przeprowadził pracownik działu technicznego.',
    'Na linii L4 wystąpiło nadciśnienie, operator zatrzymał prasę.',
    'Kierownik budowy, Pan Jan Nowak, odnotował złamanie żebra konstrukcyjnego stropu. Stwierdzono również pęknięcie stopy słupa.',
    'W protokole stwierdzono pęknięcie stopy fundamentowej. Inwestor, Pan Adam Lis, wnosi o usunięcie usterek.',
    'Pracownik doznał złamania nogi stołu podczas montażu.',
    // depresja rynku i tytuł ustawy
    'Raport: w II kwartale rozpoznano przychód 2,4 mln zł; zarząd (Pan Jan Nowak) ocenia wpływ depresji na rynku nieruchomości.',
    'Wnioskodawczyni, Pani Anna Lis, wnosi o zobowiązanie uczestnika do leczenia odwykowego na podstawie ustawy o wychowaniu w trzeźwości i przeciwdziałaniu alkoholizmowi.',
    // „leczony”, „leczona” w przepisie, programie lekowym i regulaminie
    'Osoba uzależniona od alkoholu może być leczona bez jej zgody tylko w przypadkach określonych w ustawie.',
    'W ramach programu lekowego leczony jest nowotwór złośliwy nerki u dorosłych.',
    'Regulamin: pacjent leczony w poradni ma prawo do informacji. Cukrzyca typu 2 jest chorobą przewlekłą.',
  ];
  // imiona i nazwiska znikają jak dotąd; sprawdzamy, że nazwy chorób i urazów zostają jawne
  for (const t of same) expect(redactPII(t, { types: ['ZDROWIE'] }).redacted, t).toBe(t);
  const cases: [string, string][] = [
    // karta: rozpoznanie z wielkiej litery z kodem w nawiasie i choroba bez kodu
    [
      'Karta informacyjna leczenia szpitalnego\nRozpoznanie zasadnicze:\nZapalenie płuc (J18.9)\nOstra niewydolność oddechowa (J96.0)',
      `Karta informacyjna leczenia szpitalnego\nRozpoznanie zasadnicze:\n${Z}\n${Z}`,
    ],
    ['Karta informacyjna leczenia szpitalnego\nChoroby współistniejące:\nNadciśnienie tętnicze\nCukrzyca typu 2', `Karta informacyjna leczenia szpitalnego\nChoroby współistniejące:\n${Z}\n${Z}`],
    ['Rozpoznanie: Zespół bólowy kręgosłupa lędźwiowego (M54.5)', `Rozpoznanie: ${Z}`],
    // urazy ze stroną ciała i częścią ciała po przymiotniku: cała fraza pod jedną maską
    ['Pozwany doznał złamania prawej nogi oraz wstrząśnienia mózgu.', `Pozwany doznał ${Z} oraz ${Z}.`],
    ['Poszkodowana doznała złamania lewej ręki i stłuczenia głowy.', `Poszkodowana doznała ${Z} i ${Z}.`],
    ['Poszkodowany doznał złamania kości promieniowej prawej ręki.', `Poszkodowany doznał ${Z}.`],
    // recepta jako kotwica leku z dawką
    ['Pracownica przedstawiła receptę na sertralinę 50 mg raz dziennie.', `Pracownica przedstawiła receptę na ${Z}.`],
    ['Na recepcie wypisano sertralinę 50 mg.', `Na recepcie wypisano ${Z}.`],
    // kod ICD-10 z opisem: opis pod tą samą maską, kod wyliczenia po opisie też
    ['Wypis ze szpitala z rozpoznaniem J45.0 Astma oskrzelowa.', `Wypis ze szpitala z rozpoznaniem ${Z}.`],
    ['Pracownik dostarczył zwolnienie lekarskie z kodem choroby F32 Epizod depresyjny.', `Pracownik dostarczył zwolnienie lekarskie z kodem choroby ${Z}.`],
    ['Pacjentka z rozpoznaniem J45.0 Astma oskrzelowa, I10', `Pacjentka z rozpoznaniem ${Z}, ${Z}`],
    ['Pacjentka z rozpoznaniem J45.0 Astma oskrzelowa wymaga kontroli.', `Pacjentka z rozpoznaniem ${Z} wymaga kontroli.`],
    // osoba dalej kotwiczy: list do adresata z urzędem, ale pisany w pierwszej osobie o sobie
    ['Szanowna Pani Dyrektor, informuję, że choruję na cukrzycę typu 1.', `Szanowna Pani Dyrektor, informuję, że choruję na ${Z}.`],
    ['Pacjentka leczona z powodu nowotworu złośliwego piersi.', `Pacjentka leczona z powodu ${Z}.`],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
  expect(redactPII('Pacjentka Maria Kowalska, lat 40. Rozpoznanie: J45.0 Astma oskrzelowa').redacted).toBe(
    `Pacjentka [IMIĘ I NAZWISKO], lat 40. Rozpoznanie: ${Z}`,
  );
});

test('dane o zdrowiu: długie ciągi odstępów i długie wiersze nie spowalniają redakcji', () => {
  const inputs = [
    `sertralina 50 mg${' '.repeat(200000)}x`,
    `Lekarz zalecił sertralina 50 mg${'\t'.repeat(50000)},`,
    'astma oskrzelowa, '.repeat(11000),
    'sertralina 50 mg, '.repeat(11000),
    '{"opis":"pacjent z astmą oskrzelową, nadciśnieniem tętniczym","x":1},'.repeat(3000),
  ];
  for (const t of inputs) {
    const t0 = Date.now();
    redactPII(t, { types: ['ZDROWIE'] });
    expect(Date.now() - t0, t.slice(0, 30)).toBeLessThan(2000);
  }
});
