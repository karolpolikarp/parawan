import { looksLikeSurname, surnameBase } from '../surnames.js';
import { PL_LO, PL_UP } from '../charset.js';
import { indexToLetters, JSON_ESC_TO_PUA, maskConst, type RedactCtx, URL_SENTINEL_CLOSE, URL_SENTINEL_OPEN } from '../context.js';
import { isPropagatableLogin } from '../dict/forms.js';
import { POLISH_FIRST_NAMES } from '../dict/names.js';
import { RE_EMAIL, RE_EMAIL_CHAIN, RE_EMAIL_URLENC, RE_EMAIL_URLENC_CHAIN, replaceEmails, URL_PARAM_RULES, URL_PROFILE_PATH_RULES } from './email.js';
import { hasKsefAnchor, maskKsefMatch, maskKwMatch, RE_KSEF_VALUE, RE_KW_VALUE } from './kw-ksef-case.js';


// ═══════════════════════ FAZA 0 · OCHRONA URL (sentinel) ═══════════════════════
// Dosłowne ucieczki „\n/\r/\t" (patrz JSON_ESC_TO_PUA). Tylko NIEucieczone (parzysta liczba
// backslashy przed — „C:\\nowy" w JSON-ie to ścieżka, nie nowa linia) i tylko sklejone z treścią
// (litera, cyfra, kolejny backslash): „"\n"" czy „\n " niczego nie sklejają. Długość tekstu bez
// zmian. Tekst, który już zawiera te znaki PUA, zostawiamy w spokoju — przywrócenie byłoby niejednoznaczne.
// Ścieżki Windows („C:\Users\tkaminski", „\\FS01\home$\tkaminski") to NIE ucieczki: wyraz (ciąg bez
// białych znaków) z backslashem, którego nie da się odczytać jako ucieczki JSON („\U", „\h", „\D"),
// zostaje nietknięty — inaczej login „tkaminski" rozpadał się na „\t" + „kaminski" i wyciekał.
const RE_JSON_VALID_ESCAPE = /\\(?:u[0-9A-Fa-f]{4}|["\\/bfnrt])/g;
export function passProtectJsonEscapes(ctx: RedactCtx): void {
  if (!ctx.text.includes('\\') || /[\uE009\uE00A\uE00D]/.test(ctx.text)) return;
  ctx.text = ctx.text.replace(/\S+/g, (tok) => {
    if (!tok.includes('\\') || tok.replace(RE_JSON_VALID_ESCAPE, '').includes('\\')) return tok;
    return tok.replace(/(?<!\\)((?:\\\\)*)\\([nrt])(?=[\p{L}\p{N}\\])/gu, (_m, bs: string, l: string) => {
      ctx.jsonEscapes = true;
      return `${bs}\\${JSON_ESC_TO_PUA[l]}`;
    });
  });
}

// CHRONIMY całe adresy przed pozostałymi przebiegami: bez tego detektory nazwisk/telefonów/
// PESEL gryzły fragmenty URL-a. Najpierw maskujemy PII WEWNĄTRZ (e-maile, wartości parametrów
// ?user=/?email=…), potem podmieniamy URL na sentinel U+E000<litery>U+E001 i przywracamy na
// końcu (finalizePersons). Drugi przebieg jest idempotentny: klasy wartości wykluczają „[".
// Adres profilu bywa wklejony bez schematu („pl.linkedin.com/in/…" w stopce CV) — dla tych kilku
// hostów z regułą profilu (URL_PROFILE_PATH_RULES) to też adres. Lewa granica bez kropki, „@"
// i ukośnika: „jan@linkedin.com/…" to e-mail, a „x.pl/linkedin.com/…" część innej ścieżki.
// Adres bez schematu kończy się na samym profilu (segment, krótkie człony „/pub/…/12/345",
// parametry bez „,;|"). W stopce CV i w polu z OCR sklejone z nim „;501-234-567", „,PESEL:…"
// czy „/Documents/PESEL_….pdf" trafiały do chronionego adresu i wychodziły jawne.
const URL_BARE_SEG = String.raw`[^/?#\s<>"'„”()[\],;|]+`;
// Z parametrów tylko te znane z linków tych serwisów („?trk=…&originalSubdomain=pl",
// „?id=…&sk=about"), a kropka w wartości tylko przed małą literą. Doklejone bez spacji
// „.Anna Nowak", „.Tel.501234567", „&Anna=Nowak" czy „?iban=PL61…" wchodziły do chronionego
// adresu i zostawały jawne; teraz adres kończy się przed nimi i resztę czytają zwykłe przebiegi.
const URL_BARE_PARAM =
  '(?:id|sk|ref|refid|fref|hc_ref|__tn__|mibextid|rdid|trk|trkInfo|locale|originalSubdomain|lipi|utm_[a-z]+)' +
  String.raw`=[A-Za-z0-9_%+~-]*(?:\.[a-z][A-Za-z0-9_%+~-]*)*`;
const URL_BARE_QUERY = String.raw`\?${URL_BARE_PARAM}(?:&${URL_BARE_PARAM})*`;
const RE_URL_PROTECT = new RegExp(
  String.raw`\b(?:https?:\/\/|www\.)[^\s<>"'„”()]+|(?<![\w.@/-])(?:[a-z0-9-]+\.)?(?:` +
    String.raw`linkedin\.com\/(?:in|pub)\/${URL_BARE_SEG}(?:\/[0-9a-z]{1,3}(?=[/?#\s]|$)){0,3}\/?(?:${URL_BARE_QUERY})?|` +
    String.raw`facebook\.com\/profile\.php${URL_BARE_QUERY}|[a-z0-9-]+-my\.sharepoint\.com\/personal\/${URL_BARE_SEG})`,
  'g',
);
const RE_URL_PARAM_PERSON = new RegExp(
  `([?&#][A-Za-z_]{1,30}=)(?=([${PL_UP}][${PL_LO}]+)[._+])([${PL_UP}][${PL_LO}]+(?:[._+][${PL_UP}][${PL_LO}]+){1,2})(?=[&#]|$)`,
  'g',
);
const RE_URL_CONTENT_PARAM =
  /^(?:t|q|p|c|s|cat|category|categories|kategoria|kategorie|kolekcja|collection|produkt|product|item|firma|company|brand|marka|shop|sklep|store|title|tytul|tytuł|tag|tags|page|strona|article|artykul|film|movie|book|ksiazka|search|szukaj|query|haslo|wiki|topic|temat|serial|show|album|song|track)$/i;
export function passProtectUrls(ctx: RedactCtx): void {
  // Kotwica KSeF liczona RAZ: to skan całego wejścia, a wewnątrz callbacku wykonywałby się
  // dla każdego adresu z osobna (dokument z tysiącami linków rósł kwadratowo — 3,7 s na 1 MB).
  const ksefInUrls = ctx.on('KSEF') && hasKsefAnchor(ctx);
  // Podmieniona ucieczka „\n/\t" kończy adres (w JSON-ie „…/x\nKowalski Jan" nazwisko nie należy do URL-a).
  ctx.text = ctx.text.replace(RE_URL_PROTECT, (raw) => {
    const trailMatch = raw.match(/[.,;:!?\]]+$/); // interpunkcja zdania nie należy do URL-a
    const trail = trailMatch ? trailMatch[0] : '';
    let url = trail ? raw.slice(0, raw.length - trail.length) : raw;
    if (ctx.on('EMAIL')) {
      url = replaceEmails(url, RE_EMAIL_CHAIN, RE_EMAIL, maskConst(ctx, 'EMAIL'));
      url = replaceEmails(url, RE_EMAIL_URLENC_CHAIN, RE_EMAIL_URLENC, maskConst(ctx, 'EMAIL'));
    }
    if (ctx.on('TOKEN')) {
      // JWT w URL-u (fragment „#access_token=eyJ…") — poza URL-em łapie go passTokens,
      // ale URL jest sentinelowany WCZEŚNIEJ, więc token trzeba zdjąć już tutaj.
      url = url.replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}/g, maskConst(ctx, 'TOKEN'));
    }
    // Numer KSeF w ŚCIEŻCE URL-a („…/faktura/5265877635-20250826-0100001AF629-AF/upo") — URL
    // jest sentinelowany zanim ruszy passKsef, więc numer trzeba zdjąć już tutaj; inaczej NIP
    // wystawcy zostawał jawny w linku.
    if (ksefInUrls) {
      url = url.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
    }
    // Numer księgi w linku do przeglądarki ksiąg („…?kw=KR1P/00234567/6") — URL jest
    // sentinelowany przed passKw, a z takim linkiem numer prowadzi wprost do odpisu.
    if (ctx.on('KW')) {
      url = url.replace(RE_KW_VALUE, maskKwMatch(ctx, true));
    }
    if (ctx.on('LOGIN')) {
      for (const re of URL_PROFILE_PATH_RULES) {
        url = url.replace(re, (_pm, key: string) => {
          ctx.bump('LOGIN');
          return `${key}${ctx.M.LOGIN}`;
        });
      }
    }
    for (const rule of URL_PARAM_RULES) {
      if (!ctx.on(rule.type)) continue;
      url = url.replace(rule.re, (_pm, key: string, val: string) => {
        // „?user=a.kaminska" to ten sam login co „Konto a.kaminska zablokowane" w treści
        if (rule.type === 'LOGIN' && !val.includes('%') && isPropagatableLogin(val)) ctx.loginSeeds.add(val);
        ctx.bump(rule.type);
        return `${key}${ctx.M[rule.type]}`;
      });
    }
    // Imię i nazwisko sklejone podkreślnikiem, kropką albo plusem w wartości DOWOLNEGO parametru
    // („profile.php?ref=Anna_Nowak", „?from=Jan.Kowalski"): adres jest chroniony przed przebiegami
    // osób, więc takie imię wychodziło jawne. Kotwicą jest imię ze słownika i drugi człon od
    // wielkiej litery, cała wartość parametru (nie fragment wyrazu).
    if (ctx.on('IMIE')) {
      url = url.replace(RE_URL_PARAM_PERSON, (pm, key: string, first: string, val: string) => {
        if (!POLISH_FIRST_NAMES.has(first.toLowerCase())) return pm;
        // Parametr treści sklepu albo serwisu („?kategoria=Anna_Karenina", „?produkt=Maria_Plus",
        // „?title=Jan_Matejko") to nazwa produktu, kolekcji albo hasła, a drugi człon musi mieć
        // kształt nazwiska („Maja_Summer", „Anna_Moda" — nie). Precyzja przed nadmaskowaniem.
        if (RE_URL_CONTENT_PARAM.test(key.slice(1, -1))) return pm;
        const last = val.split(/[._+]/).pop() ?? '';
        if (!surnameBase(last) && !looksLikeSurname(last)) return pm;
        ctx.bump('IMIE');
        // w trybie pseudonimów ta sama osoba co w treści („Anna Nowak" → [OSOBA-A])
        return `${key}${ctx.personMask(val.split(/[._+]/).pop() ?? val)}`;
      });
    }
    const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
    ctx.protectedUrls.push(url);
    return `${sentinel}${trail}`;
  });
}
