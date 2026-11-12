// Słowniki nagłówków kolumn tabel. Każdy przebieg pyta o nagłówek w innym miejscu tabeli, więc listy
// się różnią; wspólna baza to nagłówki obok kolumn osoby w tabeli osobowej.
import { FORM_LABEL_WORDS } from './forms.js';

const words = (s: string): string[] => s.split(' ');

// Nagłówki obok kolumn osoby w tabeli osobowej, wspólne dla wiersza TSV i komórek z TAB-em.
const PERSON_TABLE_HEADER_BASE = words('lokal uwagi funkcja podpis status rola grupa klasa termin lp');

/** Nagłówki kolumn spoza FORM_LABEL_WORDS, które w wierszu TSV stoją za etykietą osoby. Do bazy
 *  dochodzą kolumny kontaktu i grafiku. */
export const TABLE_HEADER_WORDS = new Set<string>([...PERSON_TABLE_HEADER_BASE, ...words('kontakt login godzina pokój')]);

/** Nazwy kolumn, które w nagłówku tabeli z TAB-em stoją za etykietą osobową („Nazwisko⇥Imię⇥Stanowisko").
 *  Obejmują etykiety formularza, bo komórka nagłówka bywa etykietą pola, oraz kolumny kadr i ocen. */
export const TAB_HEADER_WORDS = new Set<string>([
  ...FORM_LABEL_WORDS,
  ...PERSON_TABLE_HEADER_BASE,
  ...words('wiek miasto dział stanowisko oddział stopień ocena wynik kwota'),
]);

/** Nazwy kolumn spoza STRUCT_KEYS, które w wierszu danych osoby nie występują (faktura, zamówienie,
 *  grafik). Rozpoznają wiersz nagłówka tabeli CSV, więc są też w zapisie bez ogonków. */
export const TABLE_GENERIC_HEADERS = new Set<string>(
  words(
    'lp produkt towar usługa cena ilość ilosc jednostka kwota wartość wartosc suma status termin ' +
      'opis uwagi nazwa typ rodzaj kategoria liczba data godzina stanowisko dział dzial oddział ' +
      'pokój pokoj kod symbol stawka netto brutto vat waluta priorytet etap wynik',
  ),
);

/** Słownictwo nagłówków kolumn tabeli z PDF (komórka pod komórką). Zapis bez ogonków, bo porównanie
 *  idzie po foldAscii. */
export const NEXT_LINE_HEADER_WORDS = new Set<string>(
  words(
    'podpis podpisy grupa ocena ocen godzina rodzaj srednia rok lekarz wychowawca klasa klasy data ' +
      'numer termin uwagi wynik wyniki miejsce adres telefon stanowisko kwota liczba status typ opis ' +
      'rozpoznanie zawod plec wiek rodzica rodzicow opiekuna ucznia pacjenta dziecka imie nazwisko lp ' +
      'semestr przedmiot frekwencja oddzial sala pokoj godziny dzien',
  ),
);

/** Homografy kalendarza i narodowości przed imieniem w grafiku czy liście („Maj⇥Anna", „Polak⇥Jan"):
 *  kolumna dnia albo obywatelstwa, nie nazwisko. */
export const TSV_NOT_SURNAME = new Set<string>(
  words('maj sobota piątek niedziela środa wtorek poniedziałek czwartek polak polka niemiec czech rusin litwin węgier'),
);
