// Strażniki tablicy rejestracyjnej wspólne dla przebiegu dokumentów i danych strukturalnych:
// litery wyróżników wojewódzkich, skróty o kształcie tablicy i skrót z rokiem kończący wyliczenie.

/** Pierwsze litery wyróżników wojewódzkich tablic (H i U to służby i wojsko). Walidują człony
 *  wyliczenia i tablice po kotwicy z przerwą („ISO 9001" to nie tablica). */
export const PLATE_VOIV_LETTERS = 'BCDEFGHKLNOPRSTUWZ';
/** Skróty od litery wojewódzkiej, które nie są wyróżnikiem: marki i modele, parametry pojazdu
 *  (DMC/DMR), normy, PKD i numer UN materiału niebezpiecznego (cztery cyfry, wojskowe „U…" mają
 *  pięć). „PN" celowo nie, bo to Konin. Wstawiany na początku kandydata tablicy. */
export const PLATE_NOT_ACRONYM = '(?!(?:BMW|DMC|DMR|RAL|DIN|DOT|EN|PKD|KTM|RAM|FSO)(?![A-Z])|UN[\\s-]?\\d{4}(?![\\dA-Z]))';
export const RE_PLATE_ACRONYM_HEAD = new RegExp(`^${PLATE_NOT_ACRONYM}`);
// Skrót z rokiem („PIT 2024", „SN 2020") ma kształt tablicy, ale w prozie to temat albo sygnatura.
export const RE_PLATE_YEAR_SHAPE = /^[A-Z]{2,3}[\s-]?(?:19|20)\d{2}$/;
// Trzyliterowe skróty, które z rokiem są tematem, polisą czy programem („/ PZU 2024", „; RPO 2021").
// Inny trzyliterowy powiat z rokiem to zwykła tablica („nr rej. WPI 12345, WPI 2019").
export const PLATE_YEAR_ABBR = new Set<string>(
  'PIT CIT VAT RPO WPF KPO ZUS KRS NIP PZU SKO PKD ISO LGD WSA NSA KIO UZP GUS NFZ BIP EFS PFR PUP WUP OSP ZHP PKP PKS'.split(' '),
);
/** Czy człon wyliczenia to skrót z rokiem, który kończy listę tablic? Dwie litery z czterema cyframi
 *  to w ogóle nie polska tablica („OC 2024"); trzy tylko wtedy, gdy skrót jest w PLATE_YEAR_ABBR. */
export const plateYearEndsList = (p: string): boolean =>
  RE_PLATE_YEAR_SHAPE.test(p) && (/^[A-Z]{2}(?![A-Z])/.test(p) || PLATE_YEAR_ABBR.has(p.slice(0, 3)));
