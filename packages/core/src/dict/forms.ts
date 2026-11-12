// Słowniki i bramki pól formularza (etykieta → wartość) oraz kont i loginów, które osobą nie są.
import { HOMOGRAPH_SURNAMES, foldAscii, isAsciiSurname } from '../surnames.js';
import { NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from './names.js';
import { normStructKey, STRUCT_KEYS } from '../struct-keys.js';
import { type PiiType } from '../types.js';

// Eksporty urzędowe mają często układ „Etykieta\nWARTOŚĆ”, którego reguły prozy nie łapią.
// Etykieta pola to mocna kotwica, ale maskujemy tylko pola osobowe: kraj, województwo, powiat
// i gmina są za szerokie, by same były danymi osobowymi.
type FormKind = 'name' | 'date' | 'place' | 'addr';
export interface FormField {
  re: RegExp; // etykieta bez numeracji („12. ”) do „:” lub końca linii
  type: PiiType;
  mask: string;
  kind: FormKind;
  /** Gdzie w wartości stoi nazwisko: w trybie pseudonimów pole dostaje wtedy [OSOBA-X] zamiast stałej maski. */
  surnameAt?: 'first' | 'last';
  /** Etykieta z dopełnieniem, bez ogonków albo w szyku ZUS: wartość przechodzi ostrzejszą bramkę gatedPersonValue. */
  gated?: true;
  /** Etykieta samego nazwiska („Nazwisko pacjenta:”): jeden wyraz pod nią to zawsze nazwisko. */
  surnameOnly?: true;
  /** Wartość bywa listą imion („Imiona rodziców: Jan, Anna”). */
  nameList?: true;
}
// Etykiety roli osoby w komórce wiersza z tabulatorami (patrz passFormFields).
export const TAB_ROLE_LABELS = new Set<string>(
  (
    'świadek ojciec matka kierownik kierowniczka pracownik pracownica przełożony przełożona opiekun opiekunka ' +
    'pacjent pacjentka uczeń uczennica dziecko syn córka mąż żona małżonek małżonka wnioskodawca wnioskodawczyni pełnomocnik ' +
    // role ze zgłoszeń szkód, umów najmu i pism komorniczych („Kierujący⇥Paweł⇥Nazwisko⇥Nowak")
    'kierujący kierująca najemca najemczyni wynajmujący wynajmująca poszkodowany poszkodowana dłużnik dłużniczka ' +
    'wierzyciel wierzycielka sprawca sprawczyni uczestnik uczestniczka ubezpieczony ubezpieczona zastępca zastępczyni'
  ).split(' '),
);
// Dopełnienie etykiety osobowej („Imię i nazwisko pacjenta:”) to zamknięta lista ról: otwarty
// wzorzec dopełniacza łapałby etykiety podmiotów („Imię i nazwisko świadczeniodawcy: Przychodnia…”).
const FORM_PERSON_OF = String.raw`(?:\s+(?:pacjent(?:a|ki)|dziecka|ucznia|uczennicy|ubezpieczon(?:ego|ej)|opiekun(?:a|ki)(?:\s+prawn(?:ego|ej))?|matki|ojca|rodzica|wnioskodawcy|osoby(?:\s+(?:upoważnionej|uprawnionej|kontaktowej|bliskiej))?|przedstawiciela(?:\s+ustawowego)?|zmarł(?:ego|ej)|małżonk(?:a|i)|świadka|pełnomocnika|pracownika))?`;
// Wpisy z `gated` (ogonki opcjonalne z OCR, liczebnik po „imię” w szyku ZUS i KRUS) stoją za
// podstawowymi: podstawowe etykiety zachowują stałą maskę także w trybie pseudonimów.
export const FORM_FIELDS: FormField[] = [
  { re: /^imię\s+i\s+nazwisko$|^nazwisko\s+i\s+imię$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^nazwisk[ao](?:\s+(?:rodowe|panieńskie|poprzednie))?(?:\s+(?:matki|ojca))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^(?:pierwsze\s+|drugie\s+|kolejne\s+)?imi(?:ę|ona)(?:\s+(?:ojca|matki))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^imiona\s+rodzic[oó]w$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', nameList: true },
  { re: new RegExp(`^imi[eę]\\s+i\\s+nazwisko${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', surnameAt: 'last', gated: true },
  { re: new RegExp(`^nazwisko\\s+i\\s+imi[eę]${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', surnameAt: 'first', gated: true },
  { re: new RegExp(`^nazwisk[ao](?:\\s+(?:rodowe|panie[nń]skie|poprzednie))?${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', surnameAt: 'first', gated: true, surnameOnly: true },
  { re: new RegExp(`^(?:(?:pierwsze|drugie|kolejne)\\s+)?imi(?:[eę]|ona)(?:\\s+(?:pierwsze|drugie|kolejne))?${FORM_PERSON_OF}$`, 'i'), type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]', gated: true },
  { re: /^data\s+urodzenia$/i, type: 'DATA-UR', kind: 'date', mask: '[DATA-URODZENIA]' },
  { re: /^miejsce\s+urodzenia$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^miejscowo[sś][cć]$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^(?:miejsce|adres)\s+(?:zamieszkania|zameldowania|pobytu)$/i, type: 'MIEJSCOWOSC', kind: 'place', mask: '[MIEJSCOWOŚĆ]' },
  { re: /^ulica$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
  { re: /^(?:nr|numer)\s+(?:domu|budynku|lokalu|mieszkania)$/i, type: 'ADRES', kind: 'addr', mask: '[ADRES]' },
];
const FORM_EMPTY_VALUES = new Set([
  'brak', 'niedotyczy', 'nd', 'n/d', 'bd', 'x', 'bez', '-', '–', '—', '',
  'nieznane', 'nieznana', 'nieznany', 'niepodano', 'niepodane', 'null', 'none',
  'wakat', 'anonim', 'anonimowy', 'anonimowa', 'zastrzeżone', 'zastrzeżony', 'zastrzeżona', 'ukryte',
  'douzupełnienia', 'douzupelnienia',
]);
/**
 * Pusty wypełniacz pola („brak”, „b.d.”, „W A K A T”). Porównanie bez kropek i odstępów, wspólne
 * dla pól formularza, struktur i loginu. Cena: inicjały „B.D.” w polu imienia zostają jawne.
 */
export const isEmptyFormValue = (v: string): boolean => FORM_EMPTY_VALUES.has(v.toLowerCase().replace(/[\s.]+/g, ''));
// Nazwa własna: 1–4 wyrazy od wielkiej litery, bo proza ma małe litery i spójniki.
export const RE_PROPER_WORDS = /^\p{Lu}[\p{L}'’.‑-]*(?:[ \t]+\p{Lu}[\p{L}'’.‑-]*){0,3}$/u;
/**
 * Konta techniczne i konta działów (małe litery, ASCII jak sam login). Pole „Login: admin”
 * maskujemy, ale wartości nie rozlewamy na dokument, bo w prozie to zwykłe rzeczowniki.
 */
export const GENERIC_LOGINS = new Set<string>(
  (
    'admin administrator root system test tester demo guest gosc gość user users default postgres ' +
    'mysql oracle jenkins nobody daemon operator service serwis support helpdesk backup kiosk public ' +
    'anonymous ubuntu superuser sysadmin www-data ec2-user manager master developer monitor recepcja ' +
    'biuro sekretariat info office ' +
    'kadry kadr ksiegowosc ksiegowa ksiegowy marketing sprzedaz handel handlowy kontakt kontakty ' +
    'faktury faktura fakturowanie rekrutacja sklep noreply no-reply magazyn magazynier ewidencja ' +
    'kancelaria place zarzad prezes dyrektor kierownik sekretarz logistyka zakupy produkcja obsluga ' +
    'klient klienci finanse administracja poczta mail email skaner scanner drukarka printer kasa ' +
    'szkolenia dziekanat rektorat archiwum wsparcie pomoc rejestracja laboratorium apteka przychodnia ' +
    'portiernia ochrona dyzurny informatyka informatyk technik serwisant inspektor rodo audyt legal ' +
    'sales finance accounting billing payroll contact orders shop team staff student uczen nauczyciel'
  ).split(' '),
);
/**
 * Konta systemowe i katalogi, które w ścieżce profilu, udziale domowym i logu sshd stoją na
 * miejscu użytkownika, a osobą nie są (małe litery). Uzupełnia GENERIC_LOGINS.
 */
const SYSTEM_ACCOUNTS = new Set<string>(
  (
    'defaultuser defaultuser0 default.migrated allusers wdagutilityaccount defaultapppool ' +
    'localservice networkservice systemprofile shared share git deploy deployer ansible vagrant centos ' +
    'debian fedora pi node app apps runner gitlab-runner docker www html http httpd nginx apache ftp ' +
    'sftp sshd data storage media backups lost+found tmp temp home projects projekty ' +
    'username yourname youruser uzytkownik nazwauzytkownika login user1 sync bin sys halt shutdown ' +
    'adm lp news uucp games nfsnobody polkitd chrony dbus postfix redis elasticsearch kibana grafana ' +
    'prometheus zabbix nagios tomcat wildfly jboss hadoop spark kafka zookeeper azureuser opc ' +
    'cloud-user rocky almalinux alpine kali ' +
    'krbtgt defaultaccount sqlserveragent mssqlserver mssqlfdlauncher vscode codespace codespaces ' +
    'linuxbrew steam minecraft twojlogin twojanazwa twojanazwauzytkownika yourusername ' +
    'unknown null undefined ' +
    'cron syslog proxy gdm lightdm sddm rtkit man list irc gnats messagebus avahi colord pulse saned ' +
    'whoopsie usbmux geoclue uuidd tss tcpdump dnsmasq landscape pollinate splunk bitnami odoo ' +
    'asterisk freeswitch zimbra mongodb memcached rabbitmq couchdb solr sonar nexus ldap openldap ' +
    'named bind squid clamav amavis dovecot exim vmail opendkim ' +
    // wspólne konta i katalogi działów przychodni, szpitala i urzędu („C:\Users\pielegniarki”)
    'skany skan pracownia rtg usg ekg dokumenty dokument oddzial gabinet pielegniarki pielegniarka ' +
    'lekarz lekarze pacjenci pacjent wyniki szpital pracownicy pracownik wnioski zbiory biblioteka ' +
    'promocja aktualnosci szkola budzet mapa start praca raporty druki pisma umowy skrzynka wspolny ' +
    'wspolne dzial referat wydzial urzad gmina starostwo komputer stanowisko ' +
    // konta działów urzędu gminy, szkoły i ośrodka pomocy; celowo bez homografów nazwisk
    // („starosta”, „kowal”, „sołtys”, „woźny”, „kasjer”, „opiekun”), bo to bywa konto osoby
    'uczniowie swietlica kuchnia stolowka referent geodezja usc mops gops ops oswiata podatki wymiar ' +
    'rada radni radny kierowca zaopatrzenie sport turystyka kultura rolnictwo srodowisko inwestycje ' +
    'zamowienia przetargi uchwaly sesja odpady wybory pomoc_spoleczna obywatel mieszkaniec skarbnik ' +
    'wojt burmistrz prawnik radca meldunki dowody ewidencja_ludnosci komunikacja drogi lesnictwo ' +
    'sanepid policja straz osp parafia kontrola bhp ppoz iod abi sekretarka nauczycielka ' +
    'nauczyciele wychowawca pedagog psycholog logopeda higienistka zastepca naczelnik bibliotekarz ' +
    'stazysta praktykant'
  ).split(' '),
);
const isListedAccount = (l: string): boolean => GENERIC_LOGINS.has(l) || SYSTEM_ACCOUNTS.has(l);
// Sufiks numeru nie zmienia charakteru konta („faktury01”). Zastępnik z instrukcji bywa pisany
// z separatorem („nazwa_uzytkownika”), więc porównujemy też bez niego.
export const isSystemAccount = (v: string): boolean => {
  const l = v.toLowerCase();
  if (isListedAccount(l) || /^(?:systemd-|_)/.test(l)) return true;
  const base = l.replace(/[._-]?[0-9]+$/, '');
  if (base !== l && isListedAccount(base)) return true;
  const joined = base.replace(/[._-]/g, '');
  return joined !== base && isListedAccount(joined);
};
/** Imiona bez polskich znaków („lukasz”), indeks budowany leniwie jak w isAsciiSurname. */
let asciiFirstNames: Set<string> | null = null;
export const isAsciiFirstName = (w: string): boolean => {
  asciiFirstNames ??= new Set([...POLISH_FIRST_NAMES].filter((n) => !NOUN_LIKE_FIRST_NAMES.has(n)).map(foldAscii));
  return asciiFirstNames.has(w.toLowerCase());
};
/** Imię i nazwisko sklejone kropką albo podkreślnikiem („Jan.Kowalski”). */
export const RE_DOTTED_PERSON = /^[A-Z][a-z]+(?:[._][A-Z][a-z]+)+$/;
// Nazwisko-homonim („Zając”) słownik nazwisk pomija, ale po inicjale („mzajac”) to już kształt
// loginu. Bez nazw miesięcy i dni, bo „wsobota” to nie konto.
let asciiHomographs: Set<string> | null = null;
const isInitialHomograph = (p: string): boolean => {
  asciiHomographs ??= new Set(
    [...HOMOGRAPH_SURNAMES]
      .filter((h) => !/^(?:piątek|sobota|niedziela|środa|kwiecień|maj|marzec|styczeń|grudzień|lipiec|sierpień)$/.test(h))
      .map(foldAscii)
      .filter((h) => h.length >= 4),
  );
  return asciiHomographs.has(p.slice(1).toLowerCase());
};
// Imię sklejone z nazwiskiem bez separatora („annanowak”), typowe konto profilu.
const isJoinedFullName = (p: string): boolean => {
  for (let i = 3; i <= p.length - 4; i++) {
    if (isAsciiFirstName(p.slice(0, i)) && isAsciiSurname(p.slice(i))) return true;
  }
  return false;
};
/**
 * Czy człon loginu (same litery ASCII) to imię, nazwisko albo inicjał z nazwiskiem („jkowalski”)?
 * Odróżnia konto osoby od konta działu czy usługi o tym samym kształcie („kadry_archiwum”).
 */
export const isNameishPart = (p: string): boolean =>
  (p.length >= 3 && isAsciiFirstName(p)) ||
  isAsciiSurname(p) ||
  (p.length >= 5 && (isAsciiSurname(p.slice(1)) || isAsciiSurname(p.slice(2)) || isInitialHomograph(p))) ||
  (p.length >= 7 && p.length <= 40 && isJoinedFullName(p));
/**
 * Czy login z kotwicy pośredniej (parametr URL-a, klucz JSON/XML, ścieżka profilu, log sshd)
 * wolno rozlać na resztę dokumentu? Pod takim kluczem stoi też „system” czy konto usługi, więc
 * rozlewamy tylko uchwyt osoby: separator albo cyfra przy imieniu lub nazwisku („a.kaminska”,
 * „adam1986”) albo nazwisko ze słownika po odcięciu inicjału („jkowalski”).
 */
export function isPropagatableLogin(v: string): boolean {
  if (v.length < 4 || (v.match(/[A-Za-z]/g) ?? []).length < 3 || isSystemAccount(v)) return false;
  // „Jan.Kowalski” maskuje w całości faza 4 z etykietą osoby; jako login odebrałby jej pseudonim.
  if (RE_DOTTED_PERSON.test(v)) return false;
  if (/^[A-Za-z][A-Za-z0-9]*[._][A-Za-z0-9._]*[A-Za-z0-9]$|^[A-Za-z]{3,}[0-9]{1,6}$/.test(v)) {
    return (v.match(/[A-Za-z]+/g) ?? []).some(isNameishPart);
  }
  return /^[A-Za-z]+$/.test(v) && (isAsciiSurname(v.slice(1)) || isAsciiSurname(v.slice(2)));
}
/**
 * Czy segment ścieżki profilu, udziału domowego albo logowania sshd to konto osoby? Pod „/home/”
 * stoją też trasy serwisu, katalogi działu i nazwy ze słownika ataku („Invalid user test1”).
 * Konto osoby to imię, nazwisko, uchwyt z nim albo krótki identyfikator z cyframi („u12345”).
 */
export function isPersonalSegment(seg: string): boolean {
  if (isSystemAccount(seg)) return false;
  const letters = seg.match(/[A-Za-z]+/g) ?? [];
  if (letters.some(isNameishPart)) return true;
  return /\d/.test(seg) && letters.join('').length <= 3;
}
/** Konta usług w dzienniku zdarzeń Windows („SYSTEM”, „DWM-1”, „UMFD-0”). */
export const RE_WELL_KNOWN_ACCOUNT = /^(?:SYSTEM|DWM-\d+|UMFD-\d+)$/;
/** Wbudowane grupy i konta Windows („BUILTIN\Administrators”, „NT AUTHORITY\SYSTEM”). */
export const RE_BUILTIN_ACCOUNT = /^(?:BUILTIN|NT[ ]AUTHORITY|NT[ ]SERVICE)\\/i;
/** Nazwa użytkownika z zapisu „DOMENA\użytkownik” (w JSON-ie ukośnik bywa podwojony). */
export const loginUserPart = (val: string): string => val.slice(val.lastIndexOf('\\') + 1);
/**
 * Pierwsze słowa typowych etykiet i nagłówków formularza (małe litery). Rozpoznają, że pod pustym
 * polem stoi kolejna etykieta, a nie dana („Rozpoznanie” po pustym „Nazwisko:”).
 */
export const FORM_LABEL_WORDS = new Set<string>(
  (
    'nazwisko nazwiska imię imiona imie data miejsce miejscowość miejscowosc ulica nr numer kraj województwo ' +
    'powiat gmina kod pesel nip regon krs telefon tel email e-mail adres rozpoznanie oddział ' +
    'jednostka wydział dział stanowisko zawód wykształcenie obywatelstwo seria dokument płeć stan ' +
    'dane rozdział załącznik punkt pozycja poz specjalność tytuł nazwa firma'
  ).split(' '),
);
/** Data cyfrowa lub słowna: w polu „Data urodzenia” maskujemy samą datę. */
export const RE_DATE_VALUE =
  /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}/i;
/** Zdejmuje numerację („12. ”, „3) ”) i białe znaki z brzegów. */
export const stripFormPrefix = (s: string): string => s.replace(/^[ \t]*\d+[.)][ \t]*/, '').trim();
/**
 * Etykieta bez wartości po „:” i bez końcowej podpowiedzi w nawiasie („Nazwisko (rodowe): …” →
 * „Nazwisko”). Liniowy odpowiednik `s.replace(/\s*:.*$/, '').replace(/\s*\([^)]*\)\s*$/, '')`,
 * który na długich ciągach spacji był kwadratowy. Jak „.*$” liczy pierwszy „:” po ostatnim końcu wiersza.
 */
export function formLabelOf(s: string): string {
  const lastTerm = Math.max(s.lastIndexOf('\r'), s.lastIndexOf('\u2028'), s.lastIndexOf('\u2029'));
  const colon = s.indexOf(':', lastTerm + 1);
  const base = colon === -1 ? s : s.slice(0, colon).trimEnd();
  const t = base.trimEnd();
  if (!t.endsWith(')')) return base;
  const open = t.indexOf('(', t.lastIndexOf(')', t.length - 2) + 1);
  if (open === -1 || open > t.length - 2) return base;
  return t.slice(0, open).trimEnd();
}
/** Czy wiersz to etykieta albo nagłówek, a nie wartość sąsiedniego pola? Chroni pola puste. */
export const isFormLabelLine = (line: string): boolean => {
  const t = stripFormPrefix(line);
  const base = t.replace(/\s*:\s*$/, '');
  if (FORM_FIELDS.some((f) => f.re.test(base))) return true;
  if (/:\s*$/.test(line)) return true;
  if (/^\d+[.)]\s+\S/.test(line.trim())) return true;
  const words = base.split(/\s+/);
  return words.length <= 3 && FORM_LABEL_WORDS.has(words[0]?.toLowerCase() ?? '');
};
const RE_LETTER_SPACED = /^\p{L}(?: \p{L})+(?: {2,}\p{L}(?: \p{L})*)*$/u;
/** Wyrazy tekstu rozstrzelonego („J A N   N O W A K" → ["JAN", "NOWAK"]) albo null. */
function letterSpacedWords(t: string): string[] | null {
  if (!RE_LETTER_SPACED.test(t)) return null;
  return t.split(/ {2,}/).map((w) => w.replace(/ /g, ''));
}
const RE_ADDR_PARTICLE = /^(m|lok|ul|al|os|pl|nr|im|św|gen|ks)\.?$/i;
/** Czy `value` to sensowna wartość danego rodzaju pola, a nie proza, etykieta czy „nie dotyczy”? */
export const isValidFormValue = (value: string, kind: FormKind): boolean => {
  const t = value.trim();
  if (!t || t.length > 70) return false;
  if (isEmptyFormValue(t)) return false;
  if (/^\d+[.)]\s/.test(t)) return false;
  if (/^(nie\b|nieznan|niepodan|do ustalenia|brak\b|b\/d)/i.test(t)) return false;
  if (kind === 'place') return RE_PROPER_WORDS.test(t);
  if (kind === 'name') {
    // Tekst rozstrzelony z PDF-a i OCR oceniamy po sklejeniu: rozstrzelona etykieta („P E S E L”)
    // i pojedyncza litera jako wyraz to nie imię i nazwisko.
    const spaced = letterSpacedWords(t);
    if (spaced) return spaced.length <= 4 && spaced.every((w) => w.length >= 2 && !FORM_LABEL_WORDS.has(w.toLowerCase()) && !STRUCT_KEYS.has(normStructKey(w)));
    // Etykieta to mocna kotwica, więc wielkość liter nie ma znaczenia; dalej 1–4 wyrazy z liter.
    // Tabulator to granica kolumny TSV, nie odstęp w nazwisku.
    return /^\p{L}[\p{L}'’.‑-]*(?: +\p{L}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'date') return /\d{4}|\d{1,2}[-.\/]\d{1,2}/.test(t);
  // Adres odrzuca zdanie: każdy wyraz to nazwa własna, token z cyfrą albo cząstka adresowa.
  const toks = t.split(/\s+/);
  if (toks.length > 5) return false;
  // Po skrócie typu ulicy („ul. Dolna”) wielka litera liczy się na nazwie.
  const head = t.replace(/^(?:ul|al|os|pl)\.[ \t]*/i, '');
  return (
    /^[\p{Lu}\d]/u.test(head) &&
    toks.every((w) => /^\p{Lu}/u.test(w) || /\d/.test(w) || RE_ADDR_PARTICLE.test(w))
  );
};
