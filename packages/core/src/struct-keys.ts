// Słownik kluczy XML/JSON i nagłówków kolumn, które są kotwicą danej osobowej, oraz ich rodzaje.
import { type PiiType } from './types.js';

export type StructKind =
  | 'first' | 'surname' | 'fullname' | 'name' | 'person' | 'phone' | 'email' | 'addr'
  | 'city' | 'postal' | 'birth' | 'login' | 'pesel' | 'nip' | 'regon'
  | 'passport' | 'idcard' | 'krs' | 'license' | 'plate' | 'account';
// Tag „<Surname>” albo klucz „"lastName"” to kotwica jak etykieta formularza; maskujemy samą
// wartość, więc JSON dalej się parsuje. Klucz normalizuje normStructKey („first_name” = „FirstName”).
export const STRUCT_KEYS = new Map<string, StructKind>(Object.entries({
  imie: 'first', imię: 'first', imiona: 'first', firstname: 'first', givenname: 'first', middlename: 'first',
  // pola e-Deklaracji, JPK i ZUS („<ImiePierwsze>”, „imie_ojca”)
  imiepierwsze: 'first', imiępierwsze: 'first', pierwszeimie: 'first', pierwszeimię: 'first',
  imiedrugie: 'first', imiędrugie: 'first', drugieimie: 'first', drugieimię: 'first',
  imieojca: 'first', imięojca: 'first', imiematki: 'first', imięmatki: 'first',
  fathername: 'first', fathersname: 'first', mothername: 'first', mothersname: 'first',
  nazwisko: 'surname', surname: 'surname', lastname: 'surname', familyname: 'surname',
  nazwiskorodowe: 'surname', nazwiskopanienskie: 'surname', nazwiskopanieńskie: 'surname',
  maidenname: 'surname', mothersmaidenname: 'surname', nazwiskorodowematki: 'surname',
  fullname: 'fullname', imienazwisko: 'fullname', imięnazwisko: 'fullname',
  // nagłówki kolumn tabeli („Imię i nazwisko;PESEL”)
  imieinazwisko: 'fullname', imięinazwisko: 'fullname', nazwiskoiimie: 'fullname', nazwiskoiimię: 'fullname',
  // „osoba” bywa kategorią („<osoba>prawna</osoba>”), więc przechodzi bramkę jak „name”
  osoba: 'person', person: 'person',
  name: 'name', // bywa nazwą produktu albo firmy, stąd bramka słownikowa
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', tel: 'phone', telefon: 'phone', telephone: 'phone', fax: 'phone',
  email: 'email', mail: 'email',
  street: 'addr', address: 'addr', addressline: 'addr', ulica: 'addr', adres: 'addr',
  streetaddress: 'addr', adresl1: 'addr', nrdomu: 'addr', nrlokalu: 'addr', numerdomu: 'addr', numerlokalu: 'addr',
  city: 'city', town: 'city', miasto: 'city', miejscowosc: 'city', miejscowość: 'city',
  miejsceurodzenia: 'city', placeofbirth: 'city', birthplace: 'city',
  postalcode: 'postal', postcode: 'postal', zipcode: 'postal', zip: 'postal', kodpocztowy: 'postal',
  birthdate: 'birth', dateofbirth: 'birth', dob: 'birth', dataurodzenia: 'birth',
  login: 'login', username: 'login', user: 'login', userid: 'login',
  // Active Directory i dziennik zdarzeń Windows („<Data Name="TargetUserName">”)
  samaccountname: 'login', targetusername: 'login', subjectusername: 'login',
  pesel: 'pesel', nrpesel: 'pesel', numerpesel: 'pesel', nip: 'nip', regon: 'regon',
  // Dokumenty i rejestry: przebiegi prozy nie znają cudzysłowu ani „>” jako separatora. Bez kluczy ogólnych
  // („id”, „license” jako licencja programu, „plate” i „tablica” w innym znaczeniu).
  paszport: 'passport', nrpaszportu: 'passport', numerpaszportu: 'passport', passport: 'passport',
  passportno: 'passport', passportnumber: 'passport',
  dowod: 'idcard', dowód: 'idcard', dowodosobisty: 'idcard', dowódosobisty: 'idcard', nrdowodu: 'idcard',
  numerdowodu: 'idcard', idcard: 'idcard', idcardnumber: 'idcard',
  krs: 'krs', nrkrs: 'krs', numerkrs: 'krs',
  prawojazdy: 'license', nrprawajazdy: 'license', numerprawajazdy: 'license', driverlicense: 'license',
  driverslicense: 'license', drivinglicense: 'license', drivinglicence: 'license',
  // Goły „nrRej” sprawdza structKindOf (patrz RE_PLATE_STRICT).
  nrrejestracyjny: 'plate', numerrejestracyjny: 'plate', nrrejestracyjnypojazdu: 'plate',
  tablicarejestracyjna: 'plate', nrtablicy: 'plate', numertablicy: 'plate', licenseplate: 'plate',
  platenumber: 'plate', registrationplate: 'plate', vehicleplate: 'plate',
  iban: 'account', nrb: 'account', nrrb: 'account', konto: 'account', nrkonta: 'account', numerkonta: 'account',
  rachunek: 'account', nrrachunku: 'account', numerrachunku: 'account', rachunekbankowy: 'account',
  bankaccount: 'account', accountnumber: 'account',
  // Celowo bez numeru KSeF: nazwa klucza („<NrKSeF>”) zawiera „KSeF”, więc działa kotwica passKsef.
} as Record<string, StructKind>));
export const STRUCT_KIND_TYPE: Record<StructKind, PiiType> = {
  first: 'IMIE', surname: 'IMIE', fullname: 'IMIE', name: 'IMIE', person: 'IMIE', phone: 'TELEFON',
  email: 'EMAIL', addr: 'ADRES', city: 'MIEJSCOWOSC', postal: 'KOD-POCZTOWY',
  birth: 'DATA-UR', login: 'LOGIN', pesel: 'PESEL', nip: 'NIP', regon: 'REGON',
  passport: 'PASZPORT', idcard: 'DOWOD', krs: 'KRS', license: 'PRAWO-JAZDY', plate: 'NR-REJESTRACYJNY',
  account: 'NR-KONTA',
};
export const normStructKey = (k: string): string => k.toLowerCase().replace(/[\s._-]/g, '');
// Klucz telefonu z kwalifikatorem („nrTelefonu”) dopasowany w całości, nie jako podciąg,
// bo „phoneVerifiedAt” czy „TelefonId” to nie numer.
const RE_PHONE_STRUCT_KEY =
  /^(?:nr|numer|no|num|kontakt(?:owy)?|home|work|private|business|contact)?(?:tel|telefon[uy]?|telephone|phone(?:number)?|mobile(?:phone)?|cell(?:phone)?|kom[oó]rk[aiy]|kom[oó]rkowy|fax|faks)(?:domowy|kom[oó]rkowy|kontaktowy|s[lł]u[zż]bowy|stacjonarny|prywatny|home|work|mobile|number|nr|\d)?$/;
// Numer na końcu klucza („addressLine1”) tylko dla rodzajów z bramką kształtu wartości;
// „user1” czy „name1” bywają czymkolwiek.
const STRUCT_NUMBERED_OK = new Set<StructKind>(['addr', 'city', 'postal', 'first', 'surname', 'phone', 'email']);
// Linia adresu z kodem i miejscowością („43-300 Bielsko-Biała”) zostaje dla ich własnych przebiegów.
const RE_POSTAL_LEAD = /^\d{2}-\d{3}(?!\d)/;
// Pełny kształt polskiej tablicy (wyróżnik 2 litery + 5 znaków albo 3 litery + 4–5 znaków).
// Pod gołym „nrRej” bywa też numer w rejestrze umów z BIP („UM 1234”), więc wymagamy tego kształtu.
const RE_PLATE_STRICT = /^(?:[A-Z]{2}[\s-]?(?=[A-Z0-9]{0,4}\d)[A-Z0-9]{5}|[A-Z]{3}[\s-]?(?=[A-Z0-9]{0,3}\d)[A-Z0-9]{4,5})$/;
export function structKindOf(key: string, value: string): StructKind | undefined {
  const norm = normStructKey(key);
  const kind = STRUCT_KEYS.get(norm);
  if (kind) return kind;
  if (norm === 'nrrej') return RE_PLATE_STRICT.test(value.trim()) ? 'plate' : undefined;
  if (RE_PHONE_STRUCT_KEY.test(norm)) {
    // „Komórka” w eksportach kadrowych i ePUAP bywa komórką organizacyjną z kodem („120400”),
    // więc telefon tylko z pełnym numerem (co najmniej 9 cyfr).
    if (/kom[oó]rk[aiy]\d?$/.test(norm) && (value.match(/\d/g) ?? []).length < 9) return undefined;
    return 'phone';
  }
  const base = norm.replace(/(?<=\p{L})\d{1,2}$/u, '');
  if (base === norm) return undefined;
  const k2 = STRUCT_KEYS.get(base);
  if (!k2 || !STRUCT_NUMBERED_OK.has(k2)) return undefined;
  // Kolejna linia adresu bez cyfry to zwykle kraj albo region („Polska”), więc wymagamy numeru.
  return k2 === 'addr' && (RE_POSTAL_LEAD.test(value.trim()) || !/\d/.test(value)) ? undefined : k2;
}
