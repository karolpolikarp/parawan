import { HOMOGRAPH_SURNAMES, foldAscii, isAsciiSurname } from '../surnames.js';
import { NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from './names.js';
import { normStructKey, STRUCT_KEYS } from '../struct-keys.js';
import { type PiiType } from '../types.js';


// ── Pola formularza (etykieta → wartość) ──────────────────────────────────────
// Eksporty urzędowe często mają układ „Etykieta\nWARTOŚĆ" (wartość w OSOBNEJ linii,
// nierzadko WERSALIKAMI). Reguły tekstowe tego nie łapią (oczekują „etykieta: wartość"
// w jednej linii i nazwisk pisanych normalnie). Etykieta pola to MOCNA kotwica strukturalna,
// więc precyzja jest wysoka. Maskujemy tylko pola jednoznacznie osobowe — pola administracyjne
// (kraj, województwo, powiat, gmina) zostawiamy: są za szerokie, by same w sobie były PII.
type FormKind = 'name' | 'date' | 'place' | 'addr';
export interface FormField {
  re: RegExp; // dopasowuje etykietę (bez numeracji „12. ") do „:" lub końca linii
  type: PiiType;
  mask: string;
  kind: FormKind;
  /** Gdzie w wartości stoi nazwisko — w trybie pseudonimów pole dostaje wtedy etykietę osoby
   *  [OSOBA-X] zamiast stałej maski (patrz passFormFields). */
  surnameAt?: 'first' | 'last';
  /** Etykieta spoza dawnego zestawu (dopełnienie, zapis bez ogonków, szyk ZUS) — wartość przechodzi
   *  ostrzejszą bramkę gatedPersonValue. */
  gated?: true;
  /** Etykieta samego nazwiska („Nazwisko pacjenta:") — jeden wyraz pod nią to zawsze nazwisko. */
  surnameOnly?: true;
  /** Wartość bywa listą dwóch imion („Imiona rodziców: Jan, Anna"). */
  nameList?: true;
}
// Etykiety roli osoby w komórce wiersza z TAB-ami (patrz passFormFields).
export const TAB_ROLE_LABELS = new Set<string>(
  (
    'świadek ojciec matka kierownik kierowniczka pracownik pracownica przełożony przełożona opiekun opiekunka ' +
    'pacjent pacjentka uczeń uczennica dziecko syn córka mąż żona małżonek małżonka wnioskodawca wnioskodawczyni pełnomocnik ' +
    // role ze zgłoszeń szkód, umów najmu i pism komorniczych („Kierujący⇥Paweł⇥Nazwisko⇥Nowak")
    'kierujący kierująca najemca najemczyni wynajmujący wynajmująca poszkodowany poszkodowana dłużnik dłużniczka ' +
    'wierzyciel wierzycielka sprawca sprawczyni uczestnik uczestniczka ubezpieczony ubezpieczona zastępca zastępczyni'
  ).split(' '),
);
// Dopełnienie etykiety osobowej („Imię i nazwisko pacjenta:", „Nazwisko i imię ubezpieczonego:",
// „Imię matki:") — ZAMKNIĘTA lista ról. Otwarty wzorzec końcówek dopełniacza łapałby etykiety
// podmiotów („Imię i nazwisko świadczeniodawcy: Przychodnia Zdrowie Sp. z o.o."); kotwice ^…$
// i tak odcinają prozę z dalszym ciągiem zdania („Imię i nazwisko pacjenta należy wpisać…").
const FORM_PERSON_OF = String.raw`(?:\s+(?:pacjent(?:a|ki)|dziecka|ucznia|uczennicy|ubezpieczon(?:ego|ej)|opiekun(?:a|ki)(?:\s+prawn(?:ego|ej))?|matki|ojca|rodzica|wnioskodawcy|osoby(?:\s+(?:upoważnionej|uprawnionej|kontaktowej|bliskiej))?|przedstawiciela(?:\s+ustawowego)?|zmarł(?:ego|ej)|małżonk(?:a|i)|świadka|pełnomocnika|pracownika))?`;
// Ogonki opcjonalne („imie", „miejscowosc", „panienskie" z systemów bez polskich znaków i z OCR),
// a liczebnik także PO „imię" — szyk ZUS i KRUS („Imię pierwsze", „Imię drugie"). Te warianty
// stoją ZA dawnymi wzorcami: dawne etykiety zachowują stałą maskę także w trybie pseudonimów,
// a nowe (dotąd łapane — o ile w ogóle — przebiegami osób, z etykietą [OSOBA-X]) jej nie tracą.
export const FORM_FIELDS: FormField[] = [
  { re: /^imię\s+i\s+nazwisko$|^nazwisko\s+i\s+imię$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^nazwisk[ao](?:\s+(?:rodowe|panieńskie|poprzednie))?(?:\s+(?:matki|ojca))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  { re: /^(?:pierwsze\s+|drugie\s+|kolejne\s+)?imi(?:ę|ona)(?:\s+(?:ojca|matki))?$/i, type: 'IMIE', kind: 'name', mask: '[IMIĘ I NAZWISKO]' },
  // „Imiona rodziców: Jan, Anna" — lista imion; każde dostaje maskę (patrz passFormFields).
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
/** Wartości „puste" pola — nie maskujemy (nie są danymi). */
const FORM_EMPTY_VALUES = new Set([
  'brak', 'niedotyczy', 'nd', 'n/d', 'bd', 'x', 'bez', '.', '-', '–', '—', '',
  'nieznane', 'nieznana', 'nieznany', 'niepodano', 'niepodane', 'null', 'none',
  // wypełniacze szablonów i wykazów (też rozstrzelone: „W A K A T", „D O   U Z U P E Ł N I E N I A")
  'wakat', 'anonim', 'anonimowy', 'anonimowa', 'zastrzeżone', 'zastrzeżony', 'zastrzeżona', 'ukryte',
  'douzupełnienia', 'douzupelnienia',
]);
/**
 * Czy wartość pola to „puste" oznaczenie? Bez kropek i odstępów: „b.d.", „B.D.", „b. d.", „n.d."
 * sprowadzają się do „bd"/„nd" — wcześniej zdejmowana była tylko OSTATNIA kropka i „b.d." szło jako
 * imię i nazwisko albo login. Jedna normalizacja dla pól formularza, struktur i loginu. Cena:
 * inicjały „B.D." w polu imienia zostają jawne, jak już dziś „BD".
 */
export const isEmptyFormValue = (v: string): boolean => FORM_EMPTY_VALUES.has(v.toLowerCase().replace(/[\s.]+/g, ''));
// Nazwa własna: 1–4 wyrazy, każdy od wielkiej litery (też WERSALIKI) — proza ma małe litery i spójniki.
export const RE_PROPER_WORDS = /^\p{Lu}[\p{L}'’.‑-]*(?:[ \t]+\p{Lu}[\p{L}'’.‑-]*){0,3}$/u;
/**
 * Nazwy kont TECHNICZNYCH i generycznych (lowercase). Pole „Login: admin" maskujemy jak każde
 * inne, ale tej wartości nie rozlewamy na resztę dokumentu: w prozie to zwykłe słowa („panel
 * admin", „zaktualizuj system", „uruchom test", „sterownik postgres"), a nie dane osoby.
 * Do tego konta FUNKCYJNE działów („URZAD\kadry", „Login: magazyn"): to zwykłe rzeczowniki,
 * więc propagacja dawała „przekazano do działu [LOGIN]", „przyjęto na [LOGIN]". Wartość loginu
 * jest ASCII, stąd zapis bez ogonków („ksiegowosc", „zarzad").
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
 * Konta systemowe i katalogi, które w ścieżce profilu (C:\Users\…, /home/…), udziale domowym
 * i logu sshd/sudo stoją na miejscu użytkownika, a osobą nie są (lowercase). Uzupełnia
 * GENERIC_LOGINS: „Public", „Default User", „WDAGUtilityAccount", katalogi współdzielone
 * („/home/www", „/Users/Shared") i zastępniki z dokumentacji („/home/username/").
 */
const SYSTEM_ACCOUNTS = new Set<string>(
  (
    'public default defaultuser defaultuser0 default.migrated allusers wdagutilityaccount defaultapppool ' +
    'localservice networkservice systemprofile shared share git deploy deployer ansible vagrant centos ' +
    'debian fedora pi node app apps runner gitlab-runner docker www html http httpd nginx apache ftp ' +
    'sftp sshd mail data storage media backups lost+found tmp temp home users projects projekty ' +
    'username yourname youruser uzytkownik nazwauzytkownika login user1 sync bin sys halt shutdown ' +
    'adm lp news uucp games nfsnobody polkitd chrony dbus postfix redis elasticsearch kibana grafana ' +
    'prometheus zabbix nagios tomcat wildfly jboss hadoop spark kafka zookeeper azureuser opc ' +
    'cloud-user rocky almalinux alpine kali ' +
    // wbudowane konta Windows i SQL Server, kontenery deweloperskie, serwery gier, zastępniki
    'krbtgt defaultaccount sqlserveragent mssqlserver mssqlfdlauncher vscode codespace codespaces ' +
    'linuxbrew steam minecraft twojlogin twojanazwa twojanazwauzytkownika yourusername ' +
    'unknown nobody anonymous null undefined ' +
    // konta usług z dystrybucji Linuksa i popularnych aplikacji („session opened for user cron")
    'cron syslog proxy gdm lightdm sddm rtkit man list irc gnats messagebus avahi colord pulse saned ' +
    'whoopsie usbmux geoclue uuidd tss tcpdump dnsmasq landscape pollinate splunk bitnami odoo ' +
    'asterisk freeswitch zimbra mongodb memcached rabbitmq couchdb solr sonar nexus ldap openldap ' +
    'named bind squid clamav amavis dovecot exim vmail opendkim ' +
    // wspólne konta i katalogi działów w przychodni, szpitalu i urzędzie („C:\Users\pielegniarki",
    // „/home/dokumenty/2025") — to nie osoba, a maska w ścieżce psuje sens instrukcji
    'skany skan pracownia rtg usg ekg dokumenty dokument oddzial gabinet pielegniarki pielegniarka ' +
    'lekarz lekarze pacjenci pacjent wyniki szpital pracownicy pracownik wnioski zbiory biblioteka ' +
    'promocja aktualnosci szkola budzet mapa start praca raporty druki pisma umowy skrzynka wspolny ' +
    'wspolne dzial referat wydzial urzad gmina starostwo komputer stanowisko ' +
    // konta działów i ról w urzędzie gminy, szkole i ośrodku pomocy („C:\Users\geodezja",
    // „\\fs01\home$\mops", „C:\Users\uczniowie") — bez homografów nazwisk („starosta", „kowal", „sołtys", „woźny",
    // „kasjer", „opiekun"): zamaskowany pod etykietą login takiego konta wyciekał w ścieżce profilu
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
// Sufiks numeru nie zmienia charakteru konta: „faktury01", „recepcja2", „system2" to dalej
// skrzynki i konta działów, nie osoby. Zastępnik z instrukcji bywa pisany z separatorem
// („nazwa_uzytkownika", „twoja-nazwa", „twoj_login"), więc porównujemy też bez niego.
export const isSystemAccount = (v: string): boolean => {
  const l = v.toLowerCase();
  if (isListedAccount(l) || /^(?:systemd-|_)/.test(l)) return true;
  const base = l.replace(/[._-]?[0-9]+$/, '');
  if (base !== l && isListedAccount(base)) return true;
  const joined = base.replace(/[._-]/g, '');
  return joined !== base && isListedAccount(joined);
};
/** Imiona bez polskich znaków („lukasz", „malgorzata") — indeks leniwy, jak isAsciiSurname. */
let asciiFirstNames: Set<string> | null = null;
export const isAsciiFirstName = (w: string): boolean => {
  asciiFirstNames ??= new Set([...POLISH_FIRST_NAMES].filter((n) => !NOUN_LIKE_FIRST_NAMES.has(n)).map(foldAscii));
  return asciiFirstNames.has(w.toLowerCase());
};
/**
 * Czy człon loginu (same litery ASCII) to imię, nazwisko albo inicjał z nazwiskiem
 * („jan", „nowak", „jkowalski", „kaminska")? To odróżnia konto osoby od konta działu
 * czy usługi zapisanego tym samym kształtem („batch01", „web_app", „kadry_archiwum").
 */
/** Imię i nazwisko sklejone kropką albo podkreślnikiem („Jan.Kowalski", „Anna_Nowak"). */
export const RE_DOTTED_PERSON = /^[A-Z][a-z]+(?:[._][A-Z][a-z]+)+$/;
// Nazwisko-homonim („Zając", „Kowal", „Wróbel") słownik nazwisk pomija, bo sam wyraz to zwykłe
// słowo. Po inicjale („mzajac", „tkowal", „awrobel") to już kształt loginu, nie wyraz z prozy.
// Bez nazw miesięcy i dni („pmarzec", „wsobota" to nie konto).
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
// Imię sklejone z nazwiskiem bez separatora („annanowak", „tomaszkaminski") — typowe konto
// profilu, które samo w sobie nie jest ani imieniem, ani nazwiskiem.
const isJoinedFullName = (p: string): boolean => {
  for (let i = 3; i <= p.length - 4; i++) {
    if (isAsciiFirstName(p.slice(0, i)) && isAsciiSurname(p.slice(i))) return true;
  }
  return false;
};
export const isNameishPart = (p: string): boolean =>
  (p.length >= 3 && isAsciiFirstName(p)) ||
  isAsciiSurname(p) ||
  (p.length >= 5 && (isAsciiSurname(p.slice(1)) || isAsciiSurname(p.slice(2)) || isInitialHomograph(p))) ||
  (p.length >= 7 && p.length <= 40 && isJoinedFullName(p));
/**
 * Czy login z kotwicy POŚREDNIEJ (parametr URL-a, klucz JSON/XML, ścieżka profilu, udział
 * domowy, log sshd, słabsza etykieta) wolno rozlać na resztę dokumentu? Tam pod kluczem stoi
 * też „system", „v2.1", nazwa katalogu czy konto usługi, a propagacja zwykłego wyrazu maskowałaby
 * prozę („system restart", „Zadanie batch01 wykonuje import"). Rozlewamy tylko uchwyt osoby:
 * kropka, podkreślnik albo cyfra przy członie, który jest imieniem lub nazwiskiem („a.kaminska",
 * „jan_nowak", „adam1986"), albo nazwisko ze słownika po odcięciu inicjału („jkowalski", „anowak").
 */
export function isPropagatableLogin(v: string): boolean {
  if (v.length < 4 || (v.match(/[A-Za-z]/g) ?? []).length < 3 || isSystemAccount(v)) return false;
  // „Jan.Kowalski" to imię i nazwisko sklejone kropką — maskuje je w całości FAZA 4 z etykietą
  // osoby; jako login rozlany na prozę zabierał osobie pseudonim („zlecił [LOGIN]" obok [OSOBA-A]).
  if (RE_DOTTED_PERSON.test(v)) return false;
  if (/^[A-Za-z][A-Za-z0-9]*[._][A-Za-z0-9._]*[A-Za-z0-9]$|^[A-Za-z]{3,}[0-9]{1,6}$/.test(v)) {
    return (v.match(/[A-Za-z]+/g) ?? []).some(isNameishPart);
  }
  return /^[A-Za-z]+$/.test(v) && (isAsciiSurname(v.slice(1)) || isAsciiSurname(v.slice(2)));
}
/**
 * Czy segment ścieżki profilu, udziału domowego albo nieudanego logowania sshd to konto osoby?
 * Pod „/home/", „/Users/" czy „\\srv\home$\" stoją też trasy serwisu („/home/dashboard",
 * „GET /Users/Edit/15"), wspólne katalogi działu („Biblioteka", „Meldunki") i słownikowe
 * nazwy z ataku („Invalid user test1"). Maskujemy imię, nazwisko, uchwyt z nim albo krótki
 * identyfikator pracownika z cyframi („u12345", „ab1234").
 */
export function isPersonalSegment(seg: string): boolean {
  if (isSystemAccount(seg)) return false;
  const letters = seg.match(/[A-Za-z]+/g) ?? [];
  if (letters.some(isNameishPart)) return true;
  return /\d/.test(seg) && letters.join('').length <= 3;
}
/** Konta usług w dzienniku zdarzeń Windows („SubjectUserName" = „SYSTEM", „DWM-1", „UMFD-0"). */
export const RE_WELL_KNOWN_ACCOUNT = /^(?:SYSTEM|DWM-\d+|UMFD-\d+)$/;
/** Wbudowane grupy i konta Windows („BUILTIN\Administrators", „NT AUTHORITY\SYSTEM") — nie osoba. */
export const RE_BUILTIN_ACCOUNT = /^(?:BUILTIN|NT[ ]AUTHORITY|NT[ ]SERVICE)\\/i;
/** Nazwa użytkownika z zapisu „DOMENA\użytkownik" (w JSON-ie ukośnik bywa podwojony). */
export const loginUserPart = (val: string): string => val.slice(val.lastIndexOf('\\') + 1);
/**
 * Pierwsze słowa TYPOWYCH etykiet/nagłówków formularza (lowercase). Służy TYLKO do rozpoznania,
 * że „wartość" pustego pola PII to w istocie kolejna etykieta/nagłówek sekcji (a nie dana) —
 * chroni przed maskowaniem np. „Rozpoznanie", „Oddział" po pustym „Nazwisko:".
 */
export const FORM_LABEL_WORDS = new Set<string>(
  (
    'nazwisko nazwiska imię imiona imie data miejsce miejscowość miejscowosc ulica nr numer kraj województwo ' +
    'powiat gmina kod pesel nip regon krs telefon tel email e-mail adres rozpoznanie oddział ' +
    'jednostka wydział dział stanowisko zawód wykształcenie obywatelstwo seria dokument płeć stan ' +
    'dane rozdział załącznik punkt pozycja poz specjalność tytuł nazwa firma'
  ).split(' '),
);
/** Wzorzec daty (cyfrowa lub słowna) — do maskowania SAMEJ daty w wartości pola „Data urodzenia". */
export const RE_DATE_VALUE =
  /\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}/i;
/** Zdejmuje numerację („12. ", „3) ") i białe znaki z brzegów — zostaje sama treść etykiety/wartości. */
export const stripFormPrefix = (s: string): string => s.replace(/^[ \t]*\d+[.)][ \t]*/, '').trim();
/**
 * Sama etykieta z wiersza formularza: bez wartości po dwukropku i bez końcowej podpowiedzi
 * w nawiasie („Nazwisko (rodowe): …" → „Nazwisko"). Odpowiednik
 * `s.replace(/\s*:.*$/, '').replace(/\s*\([^)]*\)\s*$/, '')`, ale LINIOWY: tamte regexy
 * od każdej pozycji długiego ciągu spacji albo „((((" skanowały wiersz do końca (sekundy na
 * 100 tys. znaków). Zachowanie identyczne, łącznie z tym, że „.*$" nie przechodzi przez
 * znaki końca wiersza — liczy się pierwszy dwukropek PO ostatnim z nich.
 */
export function formLabelOf(s: string): string {
  const lastTerm = Math.max(s.lastIndexOf('\r'), s.lastIndexOf(' '), s.lastIndexOf(' '));
  const colon = s.indexOf(':', lastTerm + 1);
  const base = colon === -1 ? s : s.slice(0, colon).trimEnd();
  const t = base.trimEnd();
  if (!t.endsWith(')')) return base;
  const open = t.indexOf('(', t.lastIndexOf(')', t.length - 2) + 1);
  if (open === -1 || open > t.length - 2) return base;
  return t.slice(0, open).trimEnd();
}
/** Czy wiersz to etykieta/nagłówek (nie wartość sąsiedniego pola) — chroni pola PUSTE. */
export const isFormLabelLine = (line: string): boolean => {
  const t = stripFormPrefix(line);
  const base = t.replace(/\s*:\s*$/, ''); // zdejmij końcowy dwukropek („Imię:")
  if (FORM_FIELDS.some((f) => f.re.test(base))) return true; // znana etykieta pola
  if (/:\s*$/.test(line)) return true; // wiersz kończy się „:" → etykieta, nie wartość
  if (/^\d+[.)]\s+\S/.test(line.trim())) return true; // numerowana etykieta („14. Kraj")
  // krótka fraza zaczynająca się typowym słowem etykiety/nagłówka („Rozpoznanie", „Oddział…")
  const words = base.split(/\s+/);
  return words.length <= 3 && FORM_LABEL_WORDS.has(words[0]?.toLowerCase() ?? '');
};
const RE_LETTER_SPACED = /^\p{L}(?: \p{L})+(?: {2,}\p{L}(?: \p{L})*)*$/u;
/** Wyrazy tekstu rozstrzelonego („J A N   N O W A K" → ["JAN", "NOWAK"]) albo null. */
function letterSpacedWords(t: string): string[] | null {
  if (!RE_LETTER_SPACED.test(t)) return null;
  return t.split(/ {2,}/).map((w) => w.replace(/ /g, ''));
}
/** Czy `value` to sensowna wartość danego rodzaju pola (chroni przed prozą, etykietami, „nie dotyczy"). */
export const isValidFormValue = (value: string, kind: FormKind): boolean => {
  const t = value.trim();
  if (!t || t.length > 70) return false;
  if (isEmptyFormValue(t)) return false;
  if (/^\d+[.)]\s/.test(t)) return false; // kolejna etykieta numerowana
  if (/^(nie\b|nieznan|niepodan|do ustalenia|brak\b|b\/d)/i.test(t)) return false; // frazy proceduralne
  if (kind === 'place') {
    // miejscowość: nazwa własna — pierwsza litera wielka lub WERSALIKI (proza ma małe litery/spójniki)
    return RE_PROPER_WORDS.test(t);
  }
  if (kind === 'name') {
    // Tekst rozstrzelony („K R Z Y S Z T O F   M A Z U R" z PDF-a i OCR): litery co jedną spację,
    // wyrazy co najmniej dwiema. Rozstrzygamy po sklejeniu — rozstrzelona etykieta pola („N I P",
    // „P E S E L" w wierszu pod „Imię") i pojedyncza litera jako wyraz to nie imię i nazwisko.
    const spaced = letterSpacedWords(t);
    if (spaced) return spaced.length <= 4 && spaced.every((w) => w.length >= 2 && !FORM_LABEL_WORDS.has(w.toLowerCase()) && !STRUCT_KEYS.has(normStructKey(w)));
    // Etykieta pola / klucz strukturalny („Imię:", „firstName") to MOCNA kotwica — maskujemy imię/
    // nazwisko NIEZALEŻNIE od wielkości liter („Imię: pamela", „pAMELA"). Nadal 1–4 wyrazy z samych
    // liter (bez cyfr i prozy); WERSALIKI działały już wcześniej, tu dochodzi zapis małą/mieszaną literą.
    // Tabulator to granica kolumny TSV („Nazwisko:⇥Gzowski⇥Kadry"), nie odstęp w nazwisku.
    return /^\p{L}[\p{L}'’.‑-]*(?: +\p{L}[\p{L}'’.‑-]*){0,3}$/u.test(t);
  }
  if (kind === 'date') return /\d{4}|\d{1,2}[-.\/]\d{1,2}/.test(t);
  // addr: ulica (nazwa własna) lub nr domu (cyfry). Odrzuć zdanie: KAŻDY wyraz musi być nazwą
  // własną (wielka litera / WERSALIKI), tokenem z cyfrą, albo krótką cząstką adresową (m, lok, ul…).
  const toks = t.split(/\s+/);
  if (toks.length > 5) return false;
  const ADDR_PARTICLE = /^(m|lok|ul|al|os|pl|nr|im|św|gen|ks)\.?$/i;
  // skrót typu ulicy na początku wartości („Ulica: ul. Dolna", {"ulica": "ul. Dolna"}) — wielką literę
  // sprawdzamy na nazwie za nim; dawniej sam skrót małą literą odrzucał całą wartość
  const head = t.replace(/^(?:ul|al|os|pl)\.[ \t]*/i, '');
  return (
    /^[\p{Lu}\d]/u.test(head) &&
    toks.every((w) => /^\p{Lu}/u.test(w) || /\d/.test(w) || ADDR_PARTICLE.test(w))
  );
};
