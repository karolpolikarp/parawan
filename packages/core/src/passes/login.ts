// Przebieg LOGIN: pola loginu z etykietą, osoba wersalikami w takim polu, loginy z kotwic budowy
// tekstu (ścieżka profilu, udział domowy, logi sshd/sudo) i propagacja znalezionych wartości.
import { foldAscii, HOMOGRAPH_SURNAMES, homographBase, isAsciiSurname, surnameShaped } from '../surnames.js';
import { escapeRe, NM_BOUND, PL_LO, PL_UP, splitWords } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { FORM_LABEL_WORDS, GENERIC_LOGINS, isAsciiFirstName, isEmptyFormValue, isNameishPart, isPersonalSegment, isPropagatableLogin, isSystemAccount, loginUserPart, RE_BUILTIN_ACCOUNT, RE_DOTTED_PERSON } from '../dict/forms.js';
import { isFirstNameLike } from '../dict/names.js';
import { ORG_HEAD_WORDS } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS } from '../guards/roles.js';

const RE_ASCII_CAP_WORD = /^[A-Z][a-z]+$/;
/** Samo nazwisko z wielkiej litery („Kowalska") zostaje dla fazy 4, która nada mu etykietę osoby. */
const isBareAsciiSurname = (w: string): boolean => RE_ASCII_CAP_WORD.test(w) && isAsciiSurname(w) && !isAsciiFirstName(w);
/** Okno wokół wartości loginu, w którym szukamy drugiego członu pary imię+nazwisko. */
const LOGIN_PAIR_WINDOW = 40;

// Bez dwukropka za wyrazem (to kolejna etykieta: „User: Adam Status: active") i bez kropki
// z dalszym ciągiem („Jan.Nowak" to też login).
const RE_NAME_AFTER_LOGIN = new RegExp(`^[ \\t]+([${PL_UP}][${PL_LO}]+)(?![\\p{L}\\p{N}_:-]|\\.[\\p{L}\\p{N}])`, 'u');
/** Para imię+nazwisko w dowolnym szyku z nazwiskiem potwierdzonym słownikiem albo końcówką: tylko taką faza 4 zamaskuje w całości. */
function loginValueIsPersonPair(val: string, after: string): boolean {
  if (!RE_ASCII_CAP_WORD.test(val)) return false;
  const next = RE_NAME_AFTER_LOGIN.exec(after)?.[1];
  if (!next) return false;
  return (isFirstNameLike(val) && surnameShaped(next)) || (surnameShaped(val) && isFirstNameLike(next));
}
const RE_NAME_BEFORE_LOGIN_WORD = new RegExp(`(?<![${NM_BOUND}])([${PL_UP}][${PL_LO}]+)[ \\t]+$`);
function loginWordInPersonPair(t: string, offset: number, v: string): boolean {
  if (loginValueIsPersonPair(v, t.slice(offset + v.length, offset + v.length + LOGIN_PAIR_WINDOW))) return true;
  const prev = RE_NAME_BEFORE_LOGIN_WORD.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!prev && RE_ASCII_CAP_WORD.test(prev) && loginValueIsPersonPair(prev, ` ${v}`);
}
const RE_LOGIN_CAPS_PERSON = new RegExp(
  `(\\b(?:[Ll]ogin|[Uu]ser(?:name)?|[Uu]ser[ \\t]+[Nn]ame)[ \\t]*[:=][ \\t]*)([${PL_UP}]{2,}(?:[ \\t]+[${PL_UP}]{2,}){1,2})(?=[ \\t]*(?:\\r?\\n|$))`,
  'g',
);
/** Wyrazy instytucji w polu loginu wersalikami („Login: GMINA LUBIEŃ"): konto urzędu, nie osoba. */
const LOGIN_CAPS_NOT_PERSON = new Set(
  (
    'gmina gminy urzad urzedu rada rady solectwo soltys powiat powiatu starostwo miasto miasta szkola ' +
    'spolka osp gops mops mopr ops pcpr zus krus wojt burmistrz prezydent biuro sekretariat referat wydzial'
  ).split(' '),
);
/** Wyraz uliczny przed nazwiskiem z pola loginu („UL. ZIELIŃSKA 5", „ALEJA GÓRSKA"). */
const RE_CAPS_SPILL_STREET_HEAD = /^(?:ul|al|os|pl|ulica|ulicy|ulicę|aleja|alei|aleje|osiedle|osiedla|plac|placu|rondo|ronda|skwer|bulwar)$/;
/** Pory roku: „OKRES: ZIMA 2026" to wyraz pospolity, nie nazwisko z pola loginu. */
const LOGIN_CAPS_COMMON_WORDS = new Set(['zima', 'lato', 'wiosna', 'jesień', 'jesien']);
/** Wartość pod „Alias:" w kształcie nazwy hosta („www.firma.pl"). */
const RE_DOMAIN_LIKE = /\.(?:pl|com|net|org|eu|gov|edu|info|biz|io|local|lan|intra|corp|de|uk)$/i;
// Kwalifikator etykiety loginu będący nazwą systemu („Login AD:", „Login (AD):", „Login do VPN:",
// „User SAP:"). Bez skrótów, które opisują metodę albo wynik, a nie system („Login FAILED:", „Login SSO:").
const LOGIN_ACR = String.raw`(?!(?:OK|FAIL|FAILED|ERROR|URL|URI|SSO|MFA|PIN|SMS|OTP|ID|API|IP|PC|HTTP|HTTPS)(?![A-Z0-9]))[A-Z][A-Z0-9]{1,7}(?![\p{L}\p{N}])`;
const LOGIN_ACR_QUAL = String.raw`[ \t]+(?:\(${LOGIN_ACR}\)|\[${LOGIN_ACR}\]|(?:do|w|na)[ \t]+${LOGIN_ACR}|[–-][ \t]*${LOGIN_ACR}|${LOGIN_ACR})`;
const RE_LOGIN_ACR_IN_LABEL = new RegExp(`${LOGIN_ACR_QUAL}[ \\t]*[:=]`, 'u');
/** Stan konta zamiast jego nazwy („Konto AD: zablokowane", „Konto LDAP: aktywne"). */
const LOGIN_STATE_WORDS = new Set<string>(
  (
    'aktywne aktywny nieaktywne nieaktywny zablokowane zablokowany odblokowane odblokowany wygasle ' +
    'utworzone usuniete zawieszone tak nie brak enabled disabled locked unlocked active inactive ' +
    'expired none ok'
  ).split(' '),
);
// Etykieta pola loginu + wartość-token, także w następnej linii.
const RE_LOGIN_FIELD = new RegExp(
  String.raw`((?:\b[Ll]ogin\w{0,3}|\b[Uu]ser(?:name)?|\b[Nn]azwa\s+użytkownika|\b[Ii]dentyfikator\s+użytkownika|\b[Uu]ser[ \t]+[Nn]ame|\b[Ss][Aa][Mm][Aa]ccount[Nn]ame|\b[Kk]onto[ \t]+(?:AD|LDAP|domenowe|w[ \t]+domenie)|\bAlias)(?:\s+(?:użytkownika|administratora|operatora|serwisow\w+|techniczn\w+|w\s+systemie|systemow\w+|domenow\w+|sieciow\w+))?` +
    `(?:${LOGIN_ACR_QUAL})?` +
    String.raw`[ \t]*[:=][ \t]*\n?[ \t]*)(["„'«]?)((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{1,62}[A-Za-z0-9])(?!\.?[\p{L}\p{N}_-]|\\)(["”'»]?)`,
  'gu',
);
// Wartość w cudzysłowie po „użytkownik/login/konto użytkownika".
const RE_LOGIN_QUOTED =
  /\b([Uu]żytkownik\w*|[Ll]ogin\w*|[Kk]onto[ \t]+użytkownika)([ \t]+["„'«])((?:[A-Za-z][A-Za-z0-9.-]{0,62}\\{1,2})?[A-Za-z][A-Za-z0-9._-]{2,63})(["”'»])/g;
const RE_CAPS_RUN = new RegExp(`(?<![${PL_UP}${PL_LO}\\w\\[])[${PL_UP}]{2,}(?:[ \\t]+[${PL_UP}]{2,})*(?![${PL_UP}${PL_LO}\\w\\]])`, 'g');
// Ścieżka profilu użytkownika („C:\Users\tkaminski\…", „/home/jkowalski/…"): segment po katalogu
// profili to nazwa konta. „/home" bez litery, kropki i ukośnika przed sobą, bo „firma.pl/home/news"
// to podstrona serwisu. Kropka zamyka segment tylko na końcu zdania.
const PROFILE_SEG = String.raw`([A-Za-z0-9][A-Za-z0-9._-]{0,62}[A-Za-z0-9])(?=[\\/\s"'”,;:)\]}<>]|\.(?:\s|$)|$)`;
// Segment, za którym stoi odstęp i wielka litera albo wyraz do separatora, to nazwa z odstępem
// („C:\Users\Tomasz Kamiński", „C:\Users\ewa nowak\…"); osobę maskuje faza 4. Najwyżej dwa
// odstępy: szersza luka to kolumna wydruku („\\fs01\home$\tkaminski    Microsoft…").
const RE_CAP_WORD_AHEAD = /^[ \t]{1,2}(?:\p{Lu}|\p{Ll}{2,30}[\\/])/u;
const RE_PROFILE_PATH = new RegExp(
  String.raw`((?<![\p{L}\p{N}_])[A-Za-z]:(?:\\{1,2}|/)(?:Users|Użytkownicy|Documents and Settings)(?:\\{1,2}|/)|(?<![\p{L}\p{N}_./~-])/(?:home|Users)/)` +
    PROFILE_SEG,
  'gu',
);
// Udział z katalogami domowymi („\\FS01\home$\tkaminski"). Kolejki drukarek („\\PRINT01\AdamK")
// nie mają takiej kotwicy i zostają.
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
 * Loginy z kotwic budowy tekstu: maskowany cały segment, konta systemowe zostają. Do propagacji
 * tylko przez isPropagatableLogin, bo „/home/projekty" czy „sudo: deploy" to katalog i konto usługi.
 */
function maskAnchoredLogins(ctx: RedactCtx): void {
  const mask = (path: boolean) => (m: string, pre: string, seg: string, offset: number, t: string): string => {
    if (isSystemAccount(seg) || RE_FILE_EXT.test(seg)) return m;
    if (RE_CAP_WORD_AHEAD.test(t.slice(offset + m.length, offset + m.length + 34))) return m;
    // „C:\Users\Jan.Kowalski" maskuje w całości faza 4
    if (RE_DOTTED_PERSON.test(seg)) return m;
    // „jkowalski.V6": sufiks wersji profilu Windows nie należy do nazwy konta
    const user = seg.replace(/\.V\d$/i, '');
    // Bramka zależy od pewności kotwicy. Profil Windows i udział z „$" to zawsze katalog konta:
    // odpada tylko wyraz z wielkiej litery, który nie jest imieniem ani nazwiskiem („Biblioteka").
    // „/home/", „/Users/" i udział bez „$" bywają trasą serwisu albo katalogiem działu
    // („/home/aktualnosci/2024"), a „Invalid user" niesie nazwę ze słownika ataku („test1"):
    // tam tylko uchwyt osoby. Udane logowanie, sesja i sudo dotyczą istniejącego konta.
    const attempt = !path && /nvalid/.test(pre);
    const sure = path && (/^[A-Za-z]:/.test(pre) || pre.includes('$'));
    const capWord = /^[A-Z][a-z]+[0-9]*$/.test(user);
    if (sure) {
      if (capWord && !(user.match(/[A-Za-z]+/g) ?? []).some(isNameishPart)) return m;
    } else if ((path || attempt) && !isPersonalSegment(user)) {
      return m;
    }
    if (isBareAsciiSurname(user)) return m;
    if (!attempt && isPropagatableLogin(user)) ctx.loginSeeds.add(user);
    return `${pre}${ctx.hit('LOGIN')}`;
  };
  if (/[\\/]/.test(ctx.text)) {
    ctx.text = ctx.text.replace(RE_PROFILE_PATH, mask(true));
    if (ctx.text.includes('\\\\')) ctx.text = ctx.text.replace(RE_UNC_HOME, mask(true));
  }
  for (const re of RE_LOG_USER) ctx.text = ctx.text.replace(re, mask(false));
}
/**
 * Znany login w zapamiętanym URL-u, tylko jako cały segment ścieżki albo wartość parametru
 * („github.com/tkaminski", „/user/dmichalska?x=1"); część segmentu i nazwa hosta zostają.
 */
function maskLoginsInUrls(ctx: RedactCtx, values: Iterable<string>): void {
  const known = new Set<string>();
  // Zwykły wyraz spod „Login:" („projekty") bywa nazwą podstrony, więc tylko uchwyt osoby.
  for (const v of values) if (isPropagatableLogin(v)) known.add(v.toLowerCase());
  if (!known.size) return;
  ctx.protectedUrls = ctx.protectedUrls.map((url) => {
    const head = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*/i.exec(url)?.[0] ?? '';
    const path = url.slice(head.length).replace(/(?<=[/~=])[^/?#&=~\s[\]]+(?=[/?#&]|$)/g, (seg) => {
      if (!known.has(seg.toLowerCase())) return seg;
      return ctx.hit('LOGIN');
    });
    return head + path;
  });
}
/**
 * Osoba wersalikami w polu loginu („User name: ZIELINSKA KATARZYNA") dostaje maskę osoby w całości.
 * Zwraca mapę zapisów tej osoby (para w obu szykach, czasem samo nazwisko) → nazwisko, do rozlania.
 */
function maskCapsPersonLogins(ctx: RedactCtx): Map<string, string> {
  const capsPersons = new Map<string, string>();
  ctx.text = ctx.text.replace(RE_LOGIN_CAPS_PERSON, (m, kw: string, val: string) => {
    const words = val.split(/[ \t]+/);
    const folded = words.map((w) => foldAscii(w.toLowerCase()));
    // Bez imienia ze słownika albo z wyrazem instytucji („Login: GMINA LUBIEŃ") zostaje dla głównego wzorca loginu.
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
      return `${kw}${ctx.hit('LOGIN')}`;
    }
    ctx.bump('IMIE');
    capsPersons.set(words.join(' '), surname);
    if (words.length === 2) {
      // Faza 4 nie łapie pary wersalikami nazwiskiem naprzód („JANKOWSKI TOMASZ").
      capsPersons.set(`${words[1]} ${words[0]}`, surname);
      // Sam wyraz rozlewamy tylko dla nazwiska ze słownika, które nie jest imieniem ani homonimem
      // („PIĄTEK", „MAJ", „ZIMA"): inaczej maska niszczy daty, nagłówki i zawody.
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
  return capsPersons;
}
/** Samo nazwisko za wyrazem ulicznym albo nazwą organizacji („UL. ZIELIŃSKA 5", „KLUB GÓRSKI") to przymiotnik w nazwie, nie osoba. */
function nameHeadBefore(prev: string | undefined): boolean {
  const p = prev?.toLowerCase().replace(/\.$/, '');
  return !!p && (RE_CAPS_SPILL_STREET_HEAD.test(p) || ORG_HEAD_WORDS.has(p) || LEGAL_ENTITY_WORDS.has(p));
}
/**
 * Ta sama osoba z pola loginu w innym miejscu dokumentu, wersalikami. Para w dowolnym szyku; sam
 * wyraz tylko bez imienia obok, bo „TOMASZ WRÓBEL" to może być inna osoba. Jeden skan ciągów
 * wersalików z odczytem z mapy zamiast regexu na każdą osobę.
 */
function spillCapsPersons(ctx: RedactCtx, capsPersons: Map<string, string>): void {
  ctx.text = ctx.text.replace(RE_CAPS_RUN, (run: string, offset: number, t: string) => {
    const { parts: ws, words } = splitWords(run);
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
    // Głowa nazwy także za przymiotnikiem („KLUB SPORTOWY GÓRSKI").
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
        // para z innym imieniem („KOWALCZYK PIOTR") to może być inna osoba, maskuje ją faza 4
        ctx.bump('IMIE');
        out.push(ctx.personMask(words[i]));
      } else out.push(words[i]);
      if (i + 1 < words.length) out.push(ws[2 * i + 1]);
    }
    return out.join('');
  });
}
export function passLogin(ctx: RedactCtx): void {
  if (!ctx.on('LOGIN')) return;
  const loginValues = new Set<string>();
  // Wyraz-login nierozlewany na prozę („Login: soltys"); maskujemy go jeszcze pod inną etykietą konta.
  const fieldOnlyLogins = new Set<string>();
  // Propagujemy cały token („FIRMA\jkowalski") i samą nazwę użytkownika, nigdy samą domenę (nazwa
  // firmy pada w prozie). Konta generyczne („admin") w prozie są zwykłymi słowami („panel admin").
  const remember = (val: string): void => {
    const user = loginUserPart(val);
    for (const v of user === val ? [val] : [val, user]) {
      if (v.length >= 4 && !GENERIC_LOGINS.has(v.toLowerCase())) loginValues.add(v);
    }
  };
  const capsPersons = maskCapsPersonLogins(ctx);
  ctx.text = ctx.text.replace(RE_LOGIN_FIELD, (m, kw: string, q1: string, val: string, q2: string, offset: number) => {
    if (q1 && !q2) return m; // niedomknięty cudzysłów: to nie wartość pola
    const after = offset + m.length;
    const nl = ctx.text.indexOf('\n', after);
    const lineRest = ctx.text.slice(after, nl === -1 ? ctx.text.length : nl);
    // Za etykietą z kwalifikatorem systemu stoi też stan, metoda albo konto wbudowane („Login VPN:
    // tak", „User SAP: Administrator"). Wartość musi wypełniać wiersz i wyglądać na uchwyt osoby.
    if (RE_LOGIN_ACR_IN_LABEL.test(kw) && !/^[Kk]onto/.test(kw)) {
      // dopisek w nawiasie („wkozlowski (konto zablokowane)") nie jest kolejnym wyrazem
      if (!/^[\s.,;]*$/.test(lineRest) && !/^[ \t]+\([^()\n]*\)[\s.,;]*$/.test(lineRest)) return m;
      if (q1 || RE_ASCII_CAP_WORD.test(val) || /^[A-Z0-9]{2,6}$/.test(val)) return m;
      // imiesłów albo przymiotnik z formularza („Login AD: wymagany", „nadane")
      if (/^[a-ząćęłńóśźż]+(?:[aoey]ny|[aoey]ne|[aoey]na|alny|alne|owy|owe)$/.test(val)) return m;
      const lv = val.toLowerCase();
      if (LOGIN_STATE_WORDS.has(lv) || GENERIC_LOGINS.has(lv) || isSystemAccount(loginUserPart(val))) return m;
    }
    // wartość nie może być kolejną etykietą („Login:\nHasło:")
    if (!q2 && ctx.text[after] === ':') return m;
    // „Alias" bywa nazwą hosta, a pod „Konto AD" stoi też stan konta, więc to etykiety słabsze.
    const weak = /^(?:[Aa]lias|[Kk]onto)/.test(kw);
    // wartość pod słabą etykietą albo w następnej linii musi wypełniać wiersz
    if ((kw.includes('\n') || weak) && !/^[\s.,;]*$/.test(lineRest)) return m;
    if (weak && (RE_DOMAIN_LIKE.test(val) || LOGIN_STATE_WORDS.has(val.toLowerCase()))) return m;
    // Pod słabą etykietą stoi też odpowiedź z formularza, alias działu albo samo nazwisko
    // („Konto AD: nadane", „Alias: zamowienia", „Alias: Kowal"): tylko uchwyt osoby.
    if (weak && !isPropagatableLogin(loginUserPart(val))) return m;
    const medium = /^(?:[Uu]ser[ \t]+[Nn]ame|[Ss][Aa][Mm])/.test(kw);
    if (medium) {
      const account = loginUserPart(val);
      // konto wbudowane albo zastępnik („Administrator", „krbtgt", „unknown") to nie osoba
      if (isSystemAccount(account)) return m;
      // Kolejny wyraz po spacji to instrukcja albo osoba („Pole sAMAccountName: jest obowiązkowe",
      // „User name: Anna Zając"), nie login; osobę maskuje faza 4.
      if (/^ {1,2}[\p{L}\p{N}]/u.test(ctx.text.slice(after, after + 3))) return m;
      if (RE_DOTTED_PERSON.test(account) || isBareAsciiSurname(account)) return m;
    }
    const user = loginUserPart(val).toLowerCase();
    if (isEmptyFormValue(user) || FORM_LABEL_WORDS.has(user) || RE_BUILTIN_ACCOUNT.test(val)) return m;
    // „User: Kowalski Jan" to osoba, nie login: parę maskuje w całości faza 4.
    if (!q1 && !kw.includes('\n') && loginValueIsPersonPair(val, ctx.text.slice(after, after + LOGIN_PAIR_WINDOW))) return m;
    // Samo imię albo zwykły wyraz („Tomasz", „mazur", „zima") rozlany na prozę rozbijał pary osób
    // i rzeczowniki, więc rozlewamy tylko uchwyt osoby („jkowalski"), a przy domenie cały token.
    // W samym polu maska zostaje.
    const acct = loginUserPart(val);
    if (!medium && /^[a-z]+$/.test(acct) && !isPropagatableLogin(acct)) {
      if (acct !== val) loginValues.add(val);
      fieldOnlyLogins.add(acct);
    } else if (!medium || isPropagatableLogin(acct)) remember(val);
    return `${kw}${q1}${ctx.hit('LOGIN')}${q2}`;
  });
  ctx.text = ctx.text.replace(RE_LOGIN_QUOTED, (m, kw: string, q1: string, val: string, q2: string) => {
    if (RE_BUILTIN_ACCOUNT.test(val)) return m;
    remember(val);
    return `${kw}${q1}${ctx.hit('LOGIN')}${q2}`;
  });
  if (capsPersons.size) spillCapsPersons(ctx, capsPersons);
  maskAnchoredLogins(ctx);
  for (const v of ctx.loginSeeds) loginValues.add(v);
  // Od najdłuższych: „FIRMA\jkowalski" musi zniknąć w całości, zanim propagacja „jkowalski" go
  // rozetnie. Kropka kończąca zdanie nie blokuje, kropka z dalszym ciągiem tak („jan.nowak.adm").
  // Zakres Latin-1/Extended zamiast \p{L}: regex powstaje dla każdej wartości, a flaga „u" jest
  // wielokrotnie droższa w kompilacji.
  for (const v of [...loginValues].sort((a, b) => b.length - a.length)) {
    // login zapisany jak imię albo nazwisko nie rozbija pary osobowej zostawionej dla fazy 4
    const word = RE_ASCII_CAP_WORD.test(v);
    ctx.text = ctx.text.replace(
      new RegExp(`(?<![\\w.-])${escapeRe(v)}(?!\\.?[\\w\\u00C0-\\u024F-])`, 'g'),
      (m: string, offset: number, t: string) => {
        if (word && loginWordInPersonPair(t, offset, m)) return m;
        return ctx.hit('LOGIN');
      },
    );
  }
  // Ta sama wartość jako całe pole pod inną etykietą konta („Login: soltys⏎Konto: soltys") jawna
  // obok maski zdradzałaby login. W prozie wyraz zostaje.
  if (fieldOnlyLogins.size) {
    const alt = [...fieldOnlyLogins].map(escapeRe).join('|');
    ctx.text = ctx.text.replace(
      new RegExp(
        String.raw`((?:^|\n)[ \t]*(?:[Kk]onto(?:[ \t]+użytkownika)?|[Uu]żytkownik|[Ll]ogin\w{0,3}|[Uu]ser(?:name)?|[Nn]azwa[ \t]+użytkownika)[ \t]*[:=][ \t]*)(?:${alt})(?=[ \t]*(?:\([^()\n]*\)[ \t]*)?(?:\r?\n|$))`,
        'g',
      ),
      (_m: string, lb: string) => {
        return lb + ctx.hit('LOGIN');
      },
    );
  }
  if (ctx.protectedUrls.length) maskLoginsInUrls(ctx, loginValues);
}
