import { type PiiType } from './types.js';


// ── Klucze strukturalne XML/JSON ──────────────────────────────────────────────
// Tag „<Surname>" / klucz „"lastName"" to kotwica strukturalna jak etykieta formularza —
// maskujemy SAMĄ wartość (tagi, cudzysłowy i przecinki zostają: JSON dalej się parsuje).
// Klucz normalizujemy (lowercase, bez odstępów i ._-), więc „first_name"/„FirstName"/„first name"
// to jeden wpis — dawniej spacja zostawała w kluczu i „"Data urodzenia"" nie trafiało w słownik.
export type StructKind =
  | 'first' | 'surname' | 'fullname' | 'name' | 'person' | 'phone' | 'email' | 'addr'
  | 'city' | 'postal' | 'birth' | 'login' | 'pesel' | 'nip' | 'regon'
  | 'passport' | 'idcard' | 'krs' | 'license' | 'plate' | 'account';
export const STRUCT_KEYS = new Map<string, StructKind>(Object.entries({
  imie: 'first', imię: 'first', imiona: 'first', firstname: 'first', givenname: 'first', middlename: 'first',
  // pola e-Deklaracji, JPK i ZUS („<ImiePierwsze>", „imie_ojca") oraz ich odpowiedniki z formularzy
  imiepierwsze: 'first', imiępierwsze: 'first', pierwszeimie: 'first', pierwszeimię: 'first',
  imiedrugie: 'first', imiędrugie: 'first', drugieimie: 'first', drugieimię: 'first',
  imieojca: 'first', imięojca: 'first', imiematki: 'first', imięmatki: 'first',
  fathername: 'first', fathersname: 'first', mothername: 'first', mothersname: 'first',
  nazwisko: 'surname', surname: 'surname', lastname: 'surname', familyname: 'surname',
  nazwiskorodowe: 'surname', nazwiskopanienskie: 'surname', nazwiskopanieńskie: 'surname',
  maidenname: 'surname', mothersmaidenname: 'surname', nazwiskorodowematki: 'surname',
  fullname: 'fullname', imienazwisko: 'fullname', imięnazwisko: 'fullname',
  // nagłówki kolumn tabeli („Imię i nazwisko;PESEL", „Nazwisko i imię\tStanowisko")
  imieinazwisko: 'fullname', imięinazwisko: 'fullname', nazwiskoiimie: 'fullname', nazwiskoiimię: 'fullname',
  // „osoba"/„person" bywa kategorią („<osoba>prawna</osoba>", „"person": "fizyczna"") — bramka jak dla „name"
  osoba: 'person', person: 'person',
  name: 'name', // generyczne — bramka słownikowa (bywa nazwą produktu/firmy, nie osoby)
  phone: 'phone', phonenumber: 'phone', mobile: 'phone', tel: 'phone', telefon: 'phone', telephone: 'phone', fax: 'phone',
  email: 'email', mail: 'email',
  street: 'addr', address: 'addr', addressline: 'addr', ulica: 'addr', adres: 'addr',
  streetaddress: 'addr', adresl1: 'addr', nrdomu: 'addr', nrlokalu: 'addr', numerdomu: 'addr', numerlokalu: 'addr',
  city: 'city', town: 'city', miasto: 'city', miejscowosc: 'city', miejscowość: 'city',
  miejsceurodzenia: 'city', placeofbirth: 'city', birthplace: 'city',
  postalcode: 'postal', postcode: 'postal', zipcode: 'postal', zip: 'postal', kodpocztowy: 'postal',
  birthdate: 'birth', dateofbirth: 'birth', dob: 'birth', dataurodzenia: 'birth',
  login: 'login', username: 'login', user: 'login', userid: 'login',
  // Active Directory i dziennik zdarzeń Windows („"sAMAccountName"", „<Data Name="TargetUserName">")
  samaccountname: 'login', targetusername: 'login', subjectusername: 'login',
  pesel: 'pesel', nrpesel: 'pesel', numerpesel: 'pesel', nip: 'nip', regon: 'regon',
  // Dokumenty i rejestry: w prozie „paszport: EA1234567" jest maskowany, a pod kluczem
  // („"paszport": "EA1234567"", „<KRS>…</KRS>") wyciekał — separator przebiegów prozy nie zna
  // cudzysłowu ani „>". Bez kluczy ogólnych („id", „number", „license" — licencja programu,
  // „registrationNumber" — rejestr handlowy, „plate"/„tablica" — talerz, tablica ogłoszeń).
  paszport: 'passport', nrpaszportu: 'passport', numerpaszportu: 'passport', passport: 'passport',
  passportno: 'passport', passportnumber: 'passport',
  dowod: 'idcard', dowód: 'idcard', dowodosobisty: 'idcard', dowódosobisty: 'idcard', nrdowodu: 'idcard',
  numerdowodu: 'idcard', idcard: 'idcard', idcardnumber: 'idcard',
  krs: 'krs', nrkrs: 'krs', numerkrs: 'krs',
  prawojazdy: 'license', nrprawajazdy: 'license', numerprawajazdy: 'license', driverlicense: 'license',
  driverslicense: 'license', drivinglicense: 'license', drivinglicence: 'license',
  // Goły „nrRej"/„nr_rej" osobno, w structKindOf (patrz RE_PLATE_STRICT).
  nrrejestracyjny: 'plate', numerrejestracyjny: 'plate', nrrejestracyjnypojazdu: 'plate',
  tablicarejestracyjna: 'plate', nrtablicy: 'plate', numertablicy: 'plate', licenseplate: 'plate',
  platenumber: 'plate', registrationplate: 'plate', vehicleplate: 'plate',
  iban: 'account', nrb: 'account', nrrb: 'account', konto: 'account', nrkonta: 'account', numerkonta: 'account',
  rachunek: 'account', nrrachunku: 'account', numerrachunku: 'account', rachunekbankowy: 'account',
  bankaccount: 'account', accountnumber: 'account',
  // Numeru KSeF NIE ma na tej liście celowo: nazwa tagu/klucza („<NrKSeF>", „ksefNumber") sama
  // zawiera słowo „KSeF", więc kotwica dokumentowa passKsef i tak zadziała — bez dublowania reguł.
} as Record<string, StructKind>));
export const STRUCT_KIND_TYPE: Record<StructKind, PiiType> = {
  first: 'IMIE', surname: 'IMIE', fullname: 'IMIE', name: 'IMIE', person: 'IMIE', phone: 'TELEFON',
  email: 'EMAIL', addr: 'ADRES', city: 'MIEJSCOWOSC', postal: 'KOD-POCZTOWY',
  birth: 'DATA-UR', login: 'LOGIN', pesel: 'PESEL', nip: 'NIP', regon: 'REGON',
  passport: 'PASZPORT', idcard: 'DOWOD', krs: 'KRS', license: 'PRAWO-JAZDY', plate: 'NR-REJESTRACYJNY',
  account: 'NR-KONTA',
};
export const normStructKey = (k: string): string => k.toLowerCase().replace(/[\s._-]/g, '');
// Klucze telefonu złożone z kwalifikatorem („nrTelefonu", „telefonDomowy", „mobilePhone", „phone2")
// — zamknięta lista całego klucza, nie podciąg: „phoneVerifiedAt", „telemetryId", „TelefonId",
// „phoneCountryCode" czy „phonesTotal" to nie numer.
const RE_PHONE_STRUCT_KEY =
  /^(?:nr|numer|no|num|kontakt(?:owy)?|home|work|private|business|contact)?(?:tel|telefon[uy]?|telephone|phone(?:number)?|mobile(?:phone)?|cell(?:phone)?|kom[oó]rk[aiy]|kom[oó]rkowy|fax|faks)(?:domowy|kom[oó]rkowy|kontaktowy|s[lł]u[zż]bowy|stacjonarny|prywatny|home|work|mobile|number|nr|\d)?$/;
// Numer porządkowy na końcu klucza („addressLine1", „street1", „city2", „firstName1") — tylko dla
// rodzajów, których wartość i tak przechodzi bramkę kształtu; „user1"/„name1" bywają czymkolwiek.
const STRUCT_NUMBERED_OK = new Set<StructKind>(['addr', 'city', 'postal', 'first', 'surname', 'phone', 'email']);
// Druga linia adresu z kodem i miejscowością („"addressLine2": "43-300 Bielsko-Biała"") — kod
// i miasto mają własne przebiegi i maski; jako [ADRES] tracilibyśmy podział na pola.
const RE_POSTAL_LEAD = /^\d{2}-\d{3}(?!\d)/;
// Pełny kształt polskiej tablicy: dwuliterowy wyróżnik z pięcioma znakami, trzyliterowy z czterema
// albo pięcioma. Pod gołym „nrRej"/„nr_rej" bywa też numer w rejestrze umów („UM 1234", „ZP 2026"
// w otwartych danych z BIP), więc tam wartość musi mieć ten kształt; „"nr_rej": "WE 12345"" przy
// „"marka": "Opel"" to dalej tablica.
const RE_PLATE_STRICT = /^(?:[A-Z]{2}[\s-]?(?=[A-Z0-9]{0,4}\d)[A-Z0-9]{5}|[A-Z]{3}[\s-]?(?=[A-Z0-9]{0,3}\d)[A-Z0-9]{4,5})$/;
export function structKindOf(key: string, value: string): StructKind | undefined {
  const norm = normStructKey(key);
  const kind = STRUCT_KEYS.get(norm);
  if (kind) return kind;
  if (norm === 'nrrej') return RE_PLATE_STRICT.test(value.trim()) ? 'plate' : undefined;
  if (RE_PHONE_STRUCT_KEY.test(norm)) {
    // Sama „komórka" w eksportach kadrowych i ePUAP to komórka organizacyjna z kodem („"komorka":
    // "120400"", „<Komorka>01-02-03</Komorka>") — telefon tylko z pełnym numerem (co najmniej 9 cyfr).
    if (/kom[oó]rk[aiy]\d?$/.test(norm) && (value.match(/\d/g) ?? []).length < 9) return undefined;
    return 'phone';
  }
  const base = norm.replace(/(?<=\p{L})\d{1,2}$/u, '');
  if (base === norm) return undefined;
  const k2 = STRUCT_KEYS.get(base);
  if (!k2 || !STRUCT_NUMBERED_OK.has(k2)) return undefined;
  // Kolejna linia adresu bez cyfry to zwykle kraj albo region („"addressLine2": "Polska"") — numer
  // domu albo lokalu musi w niej stać, a kod z miejscowością mają własne przebiegi.
  return k2 === 'addr' && (RE_POSTAL_LEAD.test(value.trim()) || !/\d/.test(value)) ? undefined : k2;
}
