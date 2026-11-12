import { HOMOGRAPH_SURNAMES, foldAscii, homographBase, isAsciiSurname, looksLikeSurname, surnameBase } from '../surnames.js';
import { escapeRe, NM_BOUND, PL_LO, PL_UP } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { FORM_LABEL_WORDS, GENERIC_LOGINS, isAsciiFirstName, isEmptyFormValue, isNameishPart, isPersonalSegment, isPropagatableLogin, isSystemAccount, loginUserPart, RE_BUILTIN_ACCOUNT, RE_DOTTED_PERSON } from '../dict/forms.js';
import { isFirstNameLike } from '../dict/names.js';
import { ORG_HEAD_WORDS } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS } from '../guards/roles.js';


// Wyraz z wielkiej litery tuż za wartością loginu — bez dwukropka (to kolejna etykieta: „User: Adam
// Status: active") i bez kropki z dalszym ciągiem („Jan.Nowak" to też login).
const RE_NAME_AFTER_LOGIN = new RegExp(`^[ \\t]+([${PL_UP}][${PL_LO}]+)(?![\\p{L}\\p{N}_:-]|\\.[\\p{L}\\p{N}])`, 'u');
/** Czy wartość pola loginu z następnym wyrazem to para imię+nazwisko (w dowolnym szyku)? Nazwisko
 *  potwierdzone słownikiem albo końcówką — tylko taką parę FAZA 4 na pewno zamaskuje w całości. */
function loginValueIsPersonPair(val: string, after: string): boolean {
  if (!/^[A-Z][a-z]+$/.test(val)) return false;
  const next = RE_NAME_AFTER_LOGIN.exec(after)?.[1];
  if (!next) return false;
  const surname = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w);
  return (isFirstNameLike(val) && surname(next)) || (surname(val) && isFirstNameLike(next));
}
const RE_NAME_BEFORE_LOGIN_WORD = new RegExp(`(?<![${NM_BOUND}])([${PL_UP}][${PL_LO}]+)[ \\t]+$`);
/** Czy wystąpienie loginu-wyrazu tworzy z sąsiednim wyrazem parę imię+nazwisko (w dowolnym szyku)? */
function loginWordInPersonPair(t: string, offset: number, v: string): boolean {
  if (loginValueIsPersonPair(v, t.slice(offset + v.length, offset + v.length + 40))) return true;
  const prev = RE_NAME_BEFORE_LOGIN_WORD.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!prev && /^[A-Z][a-z]+$/.test(prev) && loginValueIsPersonPair(prev, ` ${v}`);
}
const RE_LOGIN_CAPS_PERSON = new RegExp(
  `(\\b(?:[Ll]ogin|[Uu]ser(?:name)?|[Uu]ser[ \\t]+[Nn]ame)[ \\t]*[:=][ \\t]*)([${PL_UP}]{2,}(?:[ \\t]+[${PL_UP}]{2,}){1,2})(?=[ \\t]*(?:\\r?\\n|$))`,
  'g',
);
/** Wyrazy instytucji w polu loginu WERSALIKAMI („Login: GMINA LUBIEŃ") — konto urzędu, nie osoba. */
const LOGIN_CAPS_NOT_PERSON = new Set(
  (
    'gmina gminy urzad urzedu rada rady solectwo soltys powiat powiatu starostwo miasto miasta szkola ' +
    'spolka osp gops mops mopr ops pcpr zus krus wojt burmistrz prezydent biuro sekretariat referat wydzial'
  ).split(' '),
);
/** Wyraz uliczny przed samym nazwiskiem z pola loginu („UL. ZIELIŃSKA 5", „ALEJA GÓRSKA"). */
const RE_CAPS_SPILL_STREET_HEAD = /^(?:ul|al|os|pl|ulica|ulicy|ulicę|aleja|alei|aleje|osiedle|osiedla|plac|placu|rondo|ronda|skwer|bulwar)$/;
/** Pory roku: „OKRES: ZIMA 2026" — wyraz pospolity, nie nazwisko z pola loginu. */
const LOGIN_CAPS_COMMON_WORDS = new Set(['zima', 'lato', 'wiosna', 'jesień', 'jesien']);
/** Wartość pod „Alias:" w kształcie nazwy hosta („www.firma.pl", „mail.urzad.gov.pl"). */
const RE_DOMAIN_LIKE = /\.(?:pl|com|net|org|eu|gov|edu|info|biz|io|local|lan|intra|corp|de|uk)$/i;
/** Stan konta zamiast jego nazwy („Konto AD: zablokowane", „Konto LDAP: aktywne"). */
// Kwalifikator etykiety loginu będący nazwą systemu („Login AD:", „Login (AD):", „Login [SAP]:",
// „Login do VPN:", „Login – AD:", „User AD:"). Zamknięta lista „użytkownika|administratora|…"
// przerywała dopasowanie na akronimie, więc wartość zostawała jawna. Bez skrótów, które opisują
// metodę albo wynik, a nie system („Login FAILED:", „Login SSO:", „Login MFA:", „Login URL:").
const LOGIN_ACR = String.raw`(?!(?:OK|FAIL|FAILED|ERROR|URL|URI|SSO|MFA|PIN|SMS|OTP|ID|API|IP|PC|HTTP|HTTPS)(?![A-Z0-9]))[A-Z][A-Z0-9]{1,7}(?![\p{L}\p{N}])`;
const LOGIN_ACR_QUAL = String.raw`[ \t]+(?:\(${LOGIN_ACR}\)|\[${LOGIN_ACR}\]|(?:do|w|na)[ \t]+${LOGIN_ACR}|[–-][ \t]*${LOGIN_ACR}|${LOGIN_ACR})`;
const RE_LOGIN_ACR_IN_LABEL = new RegExp(`${LOGIN_ACR_QUAL}[ \\t]*[:=]`, 'u');
const LOGIN_STATE_WORDS = new Set<string>(
  (
    'aktywne aktywny nieaktywne nieaktywny zablokowane zablokowany odblokowane odblokowany wygasle ' +
    'utworzone usuniete zawieszone tak nie brak enabled disabled locked unlocked active inactive ' +
    'expired none ok'
  ).split(' '),
);
// Ścieżka profilu użytkownika: „C:\Users\tkaminski\…", „/home/jkowalski/…", „/Users/anowak/…".
// Segment po katalogu profili to zawsze nazwa konta. Lewa granica „/home" bez litery, kropki
// i ukośnika — „firma.pl/home/news" to podstrona serwisu, nie katalog domowy. Prawa granica:
// separator ścieżki, koniec tokenu albo kropka kończąca zdanie. Segment, po którym stoi spacja
// i wielka litera, to początek nazwy z odstępem („C:\Users\Tomasz Kamiński", „All Users") —
// osobę maskuje FAZA 4. Plik wprost w katalogu domowym („/home/index.html") to nie konto.
const PROFILE_SEG = String.raw`([A-Za-z0-9][A-Za-z0-9._-]{0,62}[A-Za-z0-9])(?=[\\/\s"'”,;:)\]}<>]|\.(?:\s|$)|$)`;
// Też małymi literami, gdy nazwa z odstępem ciągnie się do separatora („C:\Users\ewa nowak\…").
// Najwyżej dwa odstępy: szersza luka to kolumna wydruku („\\fs01\home$\tkaminski    Microsoft…").
const RE_CAP_WORD_AHEAD = /^[ \t]{1,2}(?:\p{Lu}|\p{Ll}{2,30}[\\/])/u;
const RE_PROFILE_PATH = new RegExp(
  String.raw`((?<![\p{L}\p{N}_])[A-Za-z]:(?:\\{1,2}|/)(?:Users|Użytkownicy|Documents and Settings)(?:\\{1,2}|/)|(?<![\p{L}\p{N}_./~-])/(?:home|Users)/)` +
    PROFILE_SEG,
  'gu',
);
// Udział z katalogami domowymi: „\\FS01\home$\tkaminski", „\\srv\profiles$\jkowalski.V6".
// Kolejki drukarek („\\PRINT01\AdamK") nie mają takiej kotwicy i zostają.
const RE_UNC_HOME = new RegExp(
  String.raw`((?<![\p{L}\p{N}_\\])\\{2,4}[A-Za-z0-9][A-Za-z0-9.-]{0,62}\\{1,2}(?:home|homes|users|profiles|redirect)\$?\\{1,2})` +
    PROFILE_SEG,
  'giu',
);
// Stałe formaty logów sshd, PAM i sudo: „Accepted publickey for jkowalski from", „Invalid user
// anowak from", „session opened for user jkowalski(uid=1001)", „sudo:  jkowalski : TTY=".
const LOG_USER = '([A-Za-z_][A-Za-z0-9._-]{0,31})';
const RE_LOG_USER: RegExp[] = [
  new RegExp(
    String.raw`(\b(?:(?:Accepted|Failed)[ \t]+(?:password|publickey|keyboard-interactive(?:/pam)?|gssapi-with-mic|gssapi-keyex|hostbased|none)[ \t]+for(?:[ \t]+invalid[ \t]+user)?|Invalid[ \t]+user|(?:Connection[ \t]+closed[ \t]+by|Disconnected[ \t]+from)[ \t]+(?:authenticating|invalid)[ \t]+user)[ \t]+)` +
      `${LOG_USER}(?=[ \\t]+(?:from|port)[ \\t])`,
    'g',
  ),
  new RegExp(String.raw`(\bsession[ \t]+(?:opened|closed)[ \t]+for[ \t]+user[ \t]+)${LOG_USER}(?=\(|[ \t]|$)`, 'gm'),
  new RegExp(String.raw`(\bsudo:[ \t]+)${LOG_USER}(?=[ \t]+:[ \t])`, 'g'),
];
/** Plik wprost w katalogu domowym („/home/index.html"), nie konto. */
const RE_FILE_EXT = /\.(?:html?|php|aspx?|jsp|txt|log|sh|conf|cfg|ini|json|xml|zip|tar|gz)$/i;
/**
 * Loginy z kotwic budowy tekstu (ścieżka profilu, udział domowy, log sshd/sudo) — maskowany
 * cały segment, konta systemowe zostają. Wartość dopisujemy do propagacji tylko przez bramkę
 * isPropagatableLogin: „/home/projekty" czy „sudo: deploy" to katalog i konto usługi.
 */
function maskAnchoredLogins(ctx: RedactCtx): void {
  const mask = (path: boolean) => (m: string, pre: string, seg: string, offset: number, t: string): string => {
    if (isSystemAccount(seg) || RE_FILE_EXT.test(seg)) return m;
    if (RE_CAP_WORD_AHEAD.test(t.slice(offset + m.length, offset + m.length + 34))) return m;
    // „C:\Users\Jan.Kowalski" — imię i nazwisko sklejone kropką maskuje w całości FAZA 4 (K35)
    if (RE_DOTTED_PERSON.test(seg)) return m;
    // „jkowalski.V6" — sufiks wersji profilu Windows nie należy do nazwy konta
    const user = seg.replace(/\.V\d$/i, '');
    // Udane logowanie, sesja i sudo dotyczą istniejącego konta — tam wystarcza stoplista.
    // Gdzie indziej pod tą samą kotwicą stoi też coś innego niż konto osoby, więc bramka zależy
    // od tego, jak pewna jest kotwica:
    // - profil Windows („C:\Users\…") i udział z „$" („\\srv\home$\…") to zawsze katalog konta;
    //   odpada tylko wyraz z wielkiej litery, który nie jest imieniem ani nazwiskiem — wspólny
    //   profil albo katalog działu („Biblioteka", „Meldunki", „Wnioski800");
    // - „/home/", „/Users/" i udział bez „$" bywają trasą serwisu i katalogiem działu
    //   („GET /Users/Edit/15", „/home/dashboard", „\\fs01\home\Skany"), a „Invalid user" niesie
    //   nazwę ze słownika ataku („test1") — tu tylko imię, nazwisko albo uchwyt z nim. Dawniej
    //   dopuszczaliśmy jeszcze dowolny wyraz małymi literami z dalszym członem ścieżki, ale
    //   w pismach o stronie gminy i w instrukcjach to katalog albo sekcja serwisu
    //   („/home/wnioski/przychodzace", „/home/aktualnosci/2024", „/Users/promocja/plakaty").
    const attempt = !path && /nvalid/.test(pre);
    const sure = path && (/^[A-Za-z]:/.test(pre) || pre.includes('$'));
    const capWord = /^[A-Z][a-z]+[0-9]*$/.test(user);
    if (sure) {
      if (capWord && !(user.match(/[A-Za-z]+/g) ?? []).some(isNameishPart)) return m;
    } else if ((path || attempt) && !isPersonalSegment(user)) {
      return m;
    }
    // samo nazwisko z wielkiej litery („C:\Users\Kowalska") zostaje dla FAZY 4 i jej etykiety osoby
    if (/^[A-Z][a-z]+$/.test(user) && isAsciiSurname(user) && !isAsciiFirstName(user)) return m;
    if (!attempt && isPropagatableLogin(user)) ctx.loginSeeds.add(user);
    ctx.bump('LOGIN');
    return `${pre}${ctx.M.LOGIN}`;
  };
  if (/[\\/]/.test(ctx.text)) {
    ctx.text = ctx.text.replace(RE_PROFILE_PATH, mask(true));
    if (ctx.text.includes('\\\\')) ctx.text = ctx.text.replace(RE_UNC_HOME, mask(true));
  }
  for (const re of RE_LOG_USER) ctx.text = ctx.text.replace(re, mask(false));
}
/**
 * Znany login w zapamiętanym URL-u — wyłącznie CAŁY segment ścieżki albo wartość parametru
 * („github.com/tkaminski", „/display/~jnowak82", „/user/dmichalska?x=1"); część segmentu
 * („/dmichalskaneous/") i nazwa hosta zostają.
 */
function maskLoginsInUrls(ctx: RedactCtx, values: Iterable<string>): void {
  const known = new Set<string>();
  // Tylko uchwyt osoby: zwykły wyraz spod „Login:" („projekty", „wroclaw") bywa też nazwą
  // podstrony i psułby link („/oddzialy/[LOGIN]/raporty").
  for (const v of values) if (isPropagatableLogin(v)) known.add(v.toLowerCase());
  if (!known.size) return;
  ctx.protectedUrls = ctx.protectedUrls.map((url) => {
    const head = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i.exec(url)?.[0] ?? '';
    const path = url.slice(head.length).replace(/(?<=[/~=])[^/?#&=~\s[\]]+(?=[/?#&]|$)/g, (seg) => {
      if (!known.has(seg.toLowerCase())) return seg;
      ctx.bump('LOGIN');
      return ctx.M.LOGIN;
    });
    return head + path;
  });
}
// 1d) LOGIN — kotwica „login/username/nazwa użytkownika" + wartość-token, także w NASTĘPNEJ
// linii. Złapaną wartość maskujemy też w pozostałych wystąpieniach w dokumencie oraz w
// wariancie w cudzysłowie po „użytkownik/login/konto".
export function passLogin(ctx: RedactCtx): void {
  if (!ctx.on('LOGIN')) return;
  const loginValues = new Set<string>();
  // Wyraz-login nierozlewany na prozę („Login: soltys") — maskujemy go jeszcze pod kolejną etykietą
  // konta w innym wierszu (patrz koniec przebiegu).
  const fieldOnlyLogins = new Set<string>();
  // Wartość do propagacji: cały token („FIRMA\jkowalski") i sama nazwa użytkownika — nigdy sama
  // domena (to nazwa firmy, która pada w prozie). Konta generyczne („admin", „system", „test")
  // maskujemy w polu, ale nie rozlewamy na dokument — tam to zwykłe słowa („panel admin").
  const remember = (val: string): void => {
    const user = loginUserPart(val);
    for (const v of user === val ? [val] : [val, user]) {
      if (v.length >= 4 && !GENERIC_LOGINS.has(v.toLowerCase())) loginValues.add(v);
    }
  };
  // „User name: ZIELINSKA KATARZYNA" — osoba WIELKIMI literami w polu loginu. Główny wzorzec brał
  // pierwszy wyraz i zostawiał imię jawne obok maski („[LOGIN] KATARZYNA"); maskujemy całą parę.
  // To osoba, nie login: maska osoby (w trybie pseudonimów ta sama [OSOBA-X] co „Adam Nowak"
  // obok). Parę zapamiętujemy w obu szykach, bo te same dane wracają w dokumencie
  // nazwiskiem naprzód („JANKOWSKI TOMASZ"), czego FAZA 4 WIELKIMI literami nie łapie.
  const capsPersons = new Map<string, string>();
  ctx.text = ctx.text.replace(RE_LOGIN_CAPS_PERSON, (m, kw: string, val: string) => {
    const words = val.split(/[ \t]+/);
    const folded = words.map((w) => foldAscii(w.toLowerCase()));
    // Osoba tylko z imieniem ze słownika i bez wyrazu instytucji: „Login: GMINA LUBIEŃ" to konto
    // urzędu. Bez imienia biegnie główny wzorzec loginu (jak w v0.46.22).
    if (
      !folded.some((f) => f.length >= 3 && isAsciiFirstName(f)) ||
      folded.some((f) => LOGIN_CAPS_NOT_PERSON.has(f) || isSystemAccount(f))
    )
      return m;
    // kluczem osoby jest nazwisko: wyraz, który nie jest imieniem (domyślnie ostatni)
    let si = words.length - 1;
    if (isAsciiFirstName(folded[si]) && !isAsciiFirstName(folded[0])) si = 0;
    const surname = words[si];
    if (!ctx.on('IMIE')) {
      ctx.bump('LOGIN');
      return `${kw}${ctx.M.LOGIN}`;
    }
    ctx.bump('IMIE');
    capsPersons.set(words.join(' '), surname);
    if (words.length === 2) {
      capsPersons.set(`${words[1]} ${words[0]}`, surname);
      // Pojedynczy wyraz rozlewamy tylko dla NAZWISKA ze słownika, które nie jest wyrazem
      // pospolitym: imię samo („PARAFIA: ŚW. JAN") ani homonim („PIĄTEK", „MAJ", „KOWAL", „ZIMA")
      // nie wskazuje osoby, a maska niszczyła daty, nagłówki i zawody.
      const sl = surname.toLowerCase();
      if (
        surname.length >= 4 &&
        isAsciiSurname(folded[si]) &&
        !isAsciiFirstName(folded[si]) &&
        !HOMOGRAPH_SURNAMES.has(sl) &&
        !homographBase(sl) &&
        !LOGIN_CAPS_COMMON_WORDS.has(sl)
      )
        capsPersons.set(surname, surname);
    }
    return `${kw}${ctx.personMask(surname)}`;
  });
  ctx.text = ctx.text.replace(
    new RegExp(
      String.raw`((?:\b[Ll]ogin\w{0,3}|\b[Uu]ser(?:name)?|\b[Nn]azwa\s+użytkownika|\b[Ii]dentyfikator\s+użytkownika|\b[Uu]ser[ \t]+[Nn]ame|\b[Ss][Aa][Mm][Aa]ccount[Nn]ame|\b[Kk]onto[ \t]+(?:AD|LDAP|domenowe|w[ \t]+domenie)|\bAlias)(?:\s+(?:użytkownika|administratora|operatora|serwisow\w+|techniczn\w+|w\s+systemie|systemow\w+|domenow\w+|sieciow\w+))?` +
        `(?:${LOGIN_ACR_QUAL})?` +
        String.raw`[ \t]*[:=][ \t]*\n?[ \t]*)(["„'«]?)((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{1,62}[A-Za-z0-9])(?!\.?[\p{L}\p{N}_-]|\\)(["”'»]?)`,
      'gu',
    ),
    (m, kw: string, q1: string, val: string, q2: string, offset: number) => {
      if (q1 && !q2) return m; // niedomknięty cudzysłów — to nie wartość pola
      // Kwalifikator systemu („Login AD:", „Login (AD):", „Login do VPN:", „User SAP:") — etykieta
      // słabsza: za nią stoi też stan, metoda albo konto wbudowane („Login VPN: tak", „User SAP:
      // Administrator", „Login AD: root"). Wartość musi wypełniać resztę wiersza i wyglądać na uchwyt
      // osoby, nie na wyraz z wielkiej litery ani skrót.
      if (RE_LOGIN_ACR_IN_LABEL.test(kw) && !/^[Kk]onto/.test(kw)) {
        const lineEnd = ctx.text.indexOf('\n', offset + m.length);
        const rest = ctx.text.slice(offset + m.length, lineEnd === -1 ? ctx.text.length : lineEnd);
        // dopisek w nawiasie za wartością („wkozlowski (konto zablokowane)") nie jest kolejnym wyrazem
        if (!/^[\s.,;]*$/.test(rest) && !/^[ \t]+\([^()\n]*\)[\s.,;]*$/.test(rest)) return m;
        if (q1 || /^[A-Z][a-z]+$/.test(val) || /^[A-Z0-9]{2,6}$/.test(val)) return m;
        // imiesłów albo przymiotnik z formularza („Login AD: wymagany", „nadane", „opcjonalna")
        if (/^[a-ząćęłńóśźż]+(?:[aoey]ny|[aoey]ne|[aoey]na|alny|alne|owy|owe)$/.test(val)) return m;
        const lv = val.toLowerCase();
        if (LOGIN_STATE_WORDS.has(lv) || GENERIC_LOGINS.has(lv) || isSystemAccount(loginUserPart(val))) return m;
      }
      // wartość nie może być kolejną etykietą („Login:\nHasło:") ani pustym oznaczeniem
      if (!q2 && ctx.text[offset + m.length] === ':') return m;
      // „Alias" i „Konto AD" to etykiety słabsze niż „Login": alias bywa nazwą hosta („Alias:
      // www.firma.pl" w DNS), a pod kontem stoi też jego stan („Konto AD: zablokowane"). Wartość
      // musi więc wypełniać resztę wiersza, nie wyglądać na domenę ani na stan konta.
      const weak = /^(?:[Aa]lias|[Kk]onto)/.test(kw);
      // wartość w NASTĘPNEJ linii musi wypełniać ją w całości
      if (kw.includes('\n') || weak) {
        const lineEnd = ctx.text.indexOf('\n', offset + kw.length);
        const rest = ctx.text.slice(offset + m.length, lineEnd === -1 ? ctx.text.length : lineEnd);
        if (!/^[\s.,;]*$/.test(rest)) return m;
      }
      if (weak && (RE_DOMAIN_LIKE.test(val) || LOGIN_STATE_WORDS.has(val.toLowerCase()))) return m;
      // Pod słabą etykietą stoi też zwykły wyraz: odpowiedź z formularza („Konto AD: nadane",
      // „Konto w domenie: posiada"), alias skrzynki działu, hosta czy tytuł („Alias: zamowienia",
      // „Alias: intranet", „Alias: Matrix") albo samo nazwisko („Alias: Kowal"). Propagacja
      // maskowała wtedy ten wyraz w całej prozie, a nazwisko rozbijało pary osób. Bierzemy tylko
      // uchwyt osoby; nazwisko zostaje dla FAZY 4.
      if (weak && !isPropagatableLogin(loginUserPart(val))) return m;
      // Atrybut AD i pole raportu awarii: konto wbudowane albo zastępnik („Administrator",
      // „krbtgt", „unknown") to nie osoba, a „unknown" rozlewało się na „unknown device".
      const medium = /^(?:[Uu]ser[ \t]+[Nn]ame|[Ss][Aa][Mm])/.test(kw);
      if (medium) {
        const account = loginUserPart(val);
        if (isSystemAccount(account)) return m;
        // „User name:" i „sAMAccountName:" stoją też w instrukcjach („Pole sAMAccountName: jest
        // obowiązkowe", „W polu User name: wpisz swój login") i przed imieniem z nazwiskiem
        // („User name: Anna Zając"). Wartość z kolejnym wyrazem po spacji to nie login: dawniej
        // pierwszy wyraz szedł jako [LOGIN], nazwisko zostawało jawne, a „jest" czy „wpisz"
        // znikały z całej prozy. Osobę maskuje wtedy w całości FAZA 4.
        if (/^ {1,2}[\p{L}\p{N}]/u.test(ctx.text.slice(offset + m.length, offset + m.length + 3))) return m;
        // Imię i nazwisko sklejone kropką albo samo nazwisko z wielkiej litery („Jan.Kowalski",
        // „Nowak") zostają dla FAZY 4, jak pod kluczem samaccountname — osoba zachowuje etykietę.
        if (RE_DOTTED_PERSON.test(account)) return m;
        if (/^[A-Z][a-z]+$/.test(account) && isAsciiSurname(account) && !isAsciiFirstName(account)) return m;
      }
      const user = loginUserPart(val).toLowerCase();
      if (isEmptyFormValue(user) || FORM_LABEL_WORDS.has(user) || RE_BUILTIN_ACCOUNT.test(val)) return m;
      // „User: Kowalski Jan", „Username: Adam Kowalski" — w polu stoi osoba, nie login. Dawniej
      // pierwszy wyraz szedł jako [LOGIN], drugi zostawał jawny, a propagacja rozbijała tę samą parę
      // w prozie („Jan [LOGIN] zgłosił awarię"). Parę maskuje w całości FAZA 4.
      if (!q1 && !kw.includes('\n') && loginValueIsPersonPair(val, ctx.text.slice(offset + m.length, offset + m.length + 40))) return m;
      // Pod nowszymi etykietami rozlewamy tylko uchwyt osoby: samo imię („User name: Tomasz")
      // rozbijało pary w prozie („Zgłasza: [LOGIN] Wróbel"), a zwykły wyraz („Nowa", „Lato")
      // znikał z każdego zdania. W samym polu maska zostaje.
      // Zwykły wyraz małymi literami („Login: mazur", „Login AD: wilk", „zima", „zamek") to też
      // rzeczownik z prozy: rozlany na dokument dawał „orkiestra zagrała [LOGIN]", „jak [LOGIN]
      // przechodzi przez ogrodzenie". Taki login rozlewamy tylko jako uchwyt osoby („jkowalski"),
      // a w zapisie z domeną („FIRMA\wilk") sam cały token.
      const acct = loginUserPart(val);
      if (!medium && /^[a-z]+$/.test(acct) && !isPropagatableLogin(acct)) {
        if (acct !== val) loginValues.add(val);
        fieldOnlyLogins.add(acct);
      } else if (!medium || isPropagatableLogin(acct)) remember(val);
      ctx.bump('LOGIN');
      return `${kw}${q1}${ctx.M.LOGIN}${q2}`;
    },
  );
  ctx.text = ctx.text.replace(
    /\b([Uu]żytkownik\w*|[Ll]ogin\w*|[Kk]onto[ \t]+użytkownika)([ \t]+["„'«])((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{2,63})(["”'»])/g,
    (m, kw: string, q1: string, val: string, q2: string) => {
      if (RE_BUILTIN_ACCOUNT.test(val)) return m;
      remember(val);
      ctx.bump('LOGIN');
      return `${kw}${q1}${ctx.M.LOGIN}${q2}`;
    },
  );
  // Od najdłuższych: „FIRMA\jkowalski" musi zniknąć w całości, zanim propagacja samego
  // „jkowalski" rozetnie go na „FIRMA\[LOGIN]". Kropka kończąca zdanie nie blokuje („…konto
  // tkaminski."), kropka z ciągiem dalej tak („jan.nowak.adm", „tkaminski.example.com").
  // Litery spoza ASCII jawnie zakresem Latin-1/Extended zamiast \p{L}: regex budujemy dla każdej
  // wartości, a kompilacja wzorca z flagą „u" jest wielokrotnie droższa (2000 loginów: 0,35 s).
  // Login zapisany jak imię albo nazwisko („Login: Kowalski") nie rozbija pary osobowej, którą
  // zostawiliśmy dla FAZY 4: „User: Jan Kowalski" dawało „Jan [LOGIN]" — imię jawne obok maski.
  // Ta sama osoba z pola loginu w innym miejscu dokumentu, WIELKIMI literami: para w dowolnym
  // szyku („JANKOWSKI TOMASZ"), a pojedynczy wyraz tylko wtedy, gdy stoi sam — w ciągu wielkich
  // liter obok innego wyrazu to może być inna osoba („TOMASZ WRÓBEL"). Jeden skan ciągów
  // wielkich liter z odczytem z mapy, nie regex na każdą osobę.
  if (capsPersons.size) {
    const reCapsRun = new RegExp(`(?<![${PL_UP}${PL_LO}\\w\\[])[${PL_UP}]{2,}(?:[ \\t]+[${PL_UP}]{2,})*(?![${PL_UP}${PL_LO}\\w\\]])`, 'g');
    // Samo nazwisko za wyrazem ulicznym albo nazwą organizacji („UL. ZIELIŃSKA 5", „KLUB GÓRSKI")
    // to przymiotnik w nazwie, nie osoba z pola loginu: maska osoby psuła adres (zostawały „UL."
    // i numer domu) albo nazwę klubu.
    const nameHeadBefore = (prev: string | undefined): boolean => {
      const p = prev?.toLowerCase().replace(/\.$/, '');
      return !!p && (RE_CAPS_SPILL_STREET_HEAD.test(p) || ORG_HEAD_WORDS.has(p) || LEGAL_ENTITY_WORDS.has(p));
    };
    ctx.text = ctx.text.replace(reCapsRun, (run: string, offset: number, t: string) => {
      const ws = run.split(/([ \t]+)/);
      const words = ws.filter((_w, i) => i % 2 === 0);
      const prevWord = /(\p{L}+)\.?[ \t]+$/u.exec(t.slice(Math.max(0, offset - 16), offset))?.[1];
      if (words.length === 1) {
        const sur = capsPersons.get(run);
        if (!sur) return run;
        if (sur === run && nameHeadBefore(prevWord)) return run;
        ctx.bump('IMIE');
        return ctx.personMask(sur);
      }
      const out: string[] = [];
      const fnAt = (j: number): boolean => j >= 0 && j < words.length && isAsciiFirstName(foldAscii(words[j].toLowerCase()));
      // Głowa nazwy także dwa wyrazy wcześniej, za przymiotnikiem („KLUB SPORTOWY GÓRSKI",
      // „PRZEDSIĘBIORSTWO HANDLOWE GÓRSKI").
      const headInRun = (i: number): boolean => {
        for (let j = i - 1; j >= i - 3; j--) if (nameHeadBefore(j >= 0 ? words[j] : prevWord)) return true;
        return false;
      };
      for (let i = 0; i < words.length; i++) {
        const sur = i + 1 < words.length ? capsPersons.get(`${words[i]} ${words[i + 1]}`) : undefined;
        if (sur) {
          ctx.bump('IMIE');
          out.push(ctx.personMask(sur));
          i++;
        } else if (capsPersons.get(words[i]) === words[i] && !fnAt(i - 1) && !fnAt(i + 1) && !headInRun(i)) {
          // samo nazwisko w ciągu wersalików („WNIOSKODAWCA KOWALCZYK ZGŁOSIŁ"); para z innym
          // imieniem („KOWALCZYK PIOTR") to może być inna osoba — tę maskuje w całości FAZA 4
          ctx.bump('IMIE');
          out.push(ctx.personMask(words[i]));
        } else out.push(words[i]);
        if (i + 1 < words.length) out.push(ws[2 * i + 1]);
      }
      return out.join('');
    });
  }
  maskAnchoredLogins(ctx);
  for (const v of ctx.loginSeeds) loginValues.add(v);
  for (const v of [...loginValues].sort((a, b) => b.length - a.length)) {
    const word = /^[A-Z][a-z]+$/.test(v);
    ctx.text = ctx.text.replace(
      new RegExp(`(?<![\\w.-])${escapeRe(v)}(?!\\.?[\\w\\u00C0-\\u024F-])`, 'g'),
      (m: string, offset: number, t: string) => {
        if (word && loginWordInPersonPair(t, offset, m)) return m;
        ctx.bump('LOGIN');
        return ctx.M.LOGIN;
      },
    );
  }
  // Ta sama wartość jako całe pole pod inną etykietą konta („Login: soltys⏎Konto: soltys",
  // „Użytkownik: kasjer") — jawna obok maski zdradzała login. W prozie wyraz zostaje.
  for (const v of fieldOnlyLogins) {
    ctx.text = ctx.text.replace(
      new RegExp(
        String.raw`((?:^|\n)[ \t]*(?:[Kk]onto(?:[ \t]+użytkownika)?|[Uu]żytkownik|[Ll]ogin\w{0,3}|[Uu]ser(?:name)?|[Nn]azwa[ \t]+użytkownika)[ \t]*[:=][ \t]*)${escapeRe(v)}(?=[ \t]*(?:\([^()\n]*\)[ \t]*)?(?:\r?\n|$))`,
        'g',
      ),
      (_m: string, lb: string) => {
        ctx.bump('LOGIN');
        return lb + ctx.M.LOGIN;
      },
    );
  }
  if (ctx.protectedUrls.length) maskLoginsInUrls(ctx, loginValues);
}
