// Faza 0: ucieczki JSON i ochrona URL-i sentinelem, z maskowaniem PII wewnątrz adresu.
import { looksLikeSurname, surnameBase } from '../surnames.js';
import { PL_LO, PL_UP } from '../charset.js';
import { indexToLetters, JSON_ESC_TO_PUA, maskConst, type RedactCtx, URL_SENTINEL_CLOSE, URL_SENTINEL_OPEN } from '../context.js';
import { isPropagatableLogin } from '../dict/forms.js';
import { POLISH_FIRST_NAMES } from '../dict/names.js';
import { RE_EMAIL, RE_EMAIL_CHAIN, RE_EMAIL_URLENC, RE_EMAIL_URLENC_CHAIN, replaceEmails, URL_PARAM_RULES, URL_PROFILE_PATH_RULES } from './email.js';
import { hasKsefAnchor, maskKsefMatch, maskKwMatch, RE_KSEF_VALUE, RE_KW_VALUE } from './kw-ksef-case.js';
import { JWT_SRC } from './network.js';

// Dosłowne ucieczki „\n/\r/\t" (patrz JSON_ESC_TO_PUA), tylko nieucieczone (parzysta liczba
// backslashy: „C:\\nowy" to ścieżka) i sklejone z treścią. Długość tekstu bez zmian. Tekst, który
// już zawiera te znaki PUA, zostawiamy, bo przywrócenie byłoby niejednoznaczne. Wyraz z backslashem
// spoza ucieczek JSON to ścieżka Windows („C:\Users\tkaminski"): zostaje, żeby „\t" nie urwało loginu.
const RE_JSON_VALID_ESCAPE = /\\(?:u[0-9A-Fa-f]{4}|["\\/bfnrt])/g;
const RE_JSON_GLUED_ESCAPE = /(?<!\\)((?:\\\\)*)\\([nrt])(?=[\p{L}\p{N}\\])/gu;
export function passProtectJsonEscapes(ctx: RedactCtx): void {
  if (!ctx.text.includes('\\') || /[\uE009\uE00A\uE00D]/.test(ctx.text)) return;
  ctx.text = ctx.text.replace(/\S+/g, (tok) => {
    if (!tok.includes('\\') || tok.replace(RE_JSON_VALID_ESCAPE, '').includes('\\')) return tok;
    return tok.replace(RE_JSON_GLUED_ESCAPE, (_m, bs: string, l: string) => {
      ctx.jsonEscapes = true;
      return `${bs}\\${JSON_ESC_TO_PUA[l]}`;
    });
  });
}

// Cały adres chronimy przed pozostałymi przebiegami, żeby detektory nazwisk, telefonów i PESEL
// nie gryzły jego fragmentów: PII wewnątrz maskujemy tutaj, potem URL idzie pod sentinel
// U+E000<litery>U+E001 i wraca na końcu (finalizePersons). Klasy wartości wykluczają „[", więc
// drugi przebieg jest idempotentny.
// Bez schematu adresem jest tylko profil z URL_PROFILE_PATH_RULES („pl.linkedin.com/in/…"). Lewa
// granica bez kropki, „@" i ukośnika („jan@linkedin.com/…" to e-mail). Adres kończy się na samym
// profilu, żeby doklejone „;501-234-567" czy „,PESEL:…" czytały zwykłe przebiegi.
const URL_BARE_SEG = String.raw`[^/?#\s<>"'„”()[\],;|]+`;
// Z parametrów tylko znane z linków tych serwisów („?trk=…&originalSubdomain=pl"), a kropka
// w wartości tylko przed małą literą, żeby doklejone „.Anna Nowak" czy „&Anna=Nowak" zostały poza adresem.
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
// Bez \b: JWT stoi w adresie po „=" albo „#" („#access_token=eyJ…").
const RE_JWT_IN_URL = new RegExp(JWT_SRC, 'g');
// Interpunkcja zdania za adresem nie należy do URL-a.
const RE_URL_TRAIL = /[.,;:!?\]]+$/;
export function passProtectUrls(ctx: RedactCtx): void {
  // Kotwica KSeF to skan całego wejścia: liczona raz, nie dla każdego adresu (koszt kwadratowy).
  const ksefInUrls = ctx.on('KSEF') && hasKsefAnchor(ctx);
  // Adres jest chroniony przed resztą przebiegów, więc PII w nim (e-mail, JWT, KSeF, KW, profil,
  // parametry, imię) maskujemy tutaj. Podmieniona ucieczka „\n/\t" kończy adres.
  ctx.text = ctx.text.replace(RE_URL_PROTECT, (raw) => {
    const trail = RE_URL_TRAIL.exec(raw)?.[0] ?? '';
    let url = raw.slice(0, raw.length - trail.length);
    if (ctx.on('EMAIL')) {
      url = replaceEmails(url, RE_EMAIL_CHAIN, RE_EMAIL, maskConst(ctx, 'EMAIL'));
      url = replaceEmails(url, RE_EMAIL_URLENC_CHAIN, RE_EMAIL_URLENC, maskConst(ctx, 'EMAIL'));
    }
    if (ctx.on('TOKEN')) {
      url = url.replace(RE_JWT_IN_URL, maskConst(ctx, 'TOKEN'));
    }
    if (ksefInUrls) {
      url = url.replace(RE_KSEF_VALUE, maskKsefMatch(ctx));
    }
    // Z linkiem do przeglądarki ksiąg („…?kw=KR1P/00234567/6") numer prowadzi wprost do odpisu.
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
    // Imię i nazwisko sklejone „_", „." albo „+" jako cała wartość dowolnego parametru
    // („?ref=Anna_Nowak"). Kotwicą jest imię ze słownika i drugi człon od wielkiej litery.
    if (ctx.on('IMIE')) {
      url = url.replace(RE_URL_PARAM_PERSON, (pm, key: string, first: string, val: string) => {
        if (!POLISH_FIRST_NAMES.has(first.toLowerCase())) return pm;
        // Parametr treści („?kategoria=Anna_Karenina") to nazwa, nie osoba; drugi człon musi mieć
        // kształt nazwiska („Anna_Moda" zostaje).
        if (RE_URL_CONTENT_PARAM.test(key.slice(1, -1))) return pm;
        const last = val.split(/[._+]/).pop() ?? '';
        if (!surnameBase(last) && !looksLikeSurname(last)) return pm;
        ctx.bump('IMIE');
        return `${key}${ctx.personMask(last)}`;
      });
    }
    const sentinel = `${URL_SENTINEL_OPEN}${indexToLetters(ctx.protectedUrls.length)}${URL_SENTINEL_CLOSE}`;
    ctx.protectedUrls.push(url);
    return `${sentinel}${trail}`;
  });
}
