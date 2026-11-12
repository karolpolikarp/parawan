// Konta i loginy: konta techniczne, systemowe i działów, które osobą nie są, oraz rozpoznanie uchwytu
// osoby w loginie, ścieżce profilu i dzienniku zdarzeń.
import { foldAscii, HOMOGRAPH_SURNAMES, isAsciiSurname } from '../surnames.js';
import { NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from './names.js';

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
