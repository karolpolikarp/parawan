// Wzorce e-maila, reguły PII wewnątrz URL-i (parametry, ścieżki profili) i przebieg passEmail.
import { type RedactCtx } from '../context.js';
import { type PiiType } from '../types.js';

// Polskie litery w części lokalnej i domenie: „piotr.wiśniewski@…" maskujemy w całości, a nie od „ś".
const EMAIL_CH = '[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]';
const EMAIL_DOMAIN = String.raw`[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}`;
const emailSrc = (at: string): string => `${EMAIL_CH}+${at}${EMAIL_DOMAIN}`;
const emailChainSrc = (at: string): string => `(?<!${EMAIL_CH})(?:${emailSrc(at)})+`;

export const RE_EMAIL = new RegExp(emailSrc('@'), 'g');
// „%40" zamiast „@" bywa też poza adresem ze schematem (ścieżka względna w logu, ciało formularza,
// „https:\/\/…" z json_encode), dlatego passEmail stosuje go także globalnie.
export const RE_EMAIL_URLENC = new RegExp(emailSrc('%40'), 'g');
// RE_EMAIL puszczony wprost po tekście jest kwadratowy: w długim ciągu znaków lokalnych bez „@"
// każda pozycja startowa skanuje go do końca. Łańcuch startuje tylko na początku takiego ciągu
// (lookbehind), a RE_EMAIL działa dopiero wewnątrz. Wynik jest ten sam: dopasowanie ze środka ciągu
// da się przedłużyć w lewo do jego początku, a sklejone adresy obejmuje powtórzenie grupy.
export const RE_EMAIL_CHAIN = new RegExp(emailChainSrc('@'), 'g');
export const RE_EMAIL_URLENC_CHAIN = new RegExp(emailChainSrc('%40'), 'g');

/** Maskuje e-maile w czasie liniowym: łańcuch, potem pojedynczy wzorzec wewnątrz. */
export function replaceEmails(s: string, chain: RegExp, single: RegExp, mask: (m: string) => string): string {
  return s.replace(chain, (m) => m.replace(single, mask));
}

/**
 * Parametry URL-a o kluczach osobowych: klucz jest kotwicą, maskujemy samą wartość wg typu
 * (?user=[LOGIN]&email=[EMAIL]). Prefiks „#" obejmuje fragment adresu („callback#access_token=…").
 * Klasa wartości wyklucza „[", więc placeholder z poprzedniego przebiegu zostaje.
 */
export const URL_PARAM_RULES: Array<{ re: RegExp; type: PiiType }> = [
  { re: /([?&#](?:user(?:name|id)?|login|usr|uid)=)([^&#\s\[\]]+)/gi, type: 'LOGIN' },
  { re: /([?&#](?:e-?mail|mail)=)([^&#\s\[\]]+)/gi, type: 'EMAIL' },
  { re: /([?&#](?:full_?name|first_?name|last_?name|name|imie|nazwisko|osoba)=)([^&#\s\[\]]+)/gi, type: 'IMIE' },
  { re: /([?&#](?:phone|tel(?:efon)?|mobile|msisdn)=)([^&#\s\[\]]+)/gi, type: 'TELEFON' },
  { re: /([?&#]pesel=)(\d+)/gi, type: 'PESEL' },
  { re: /([?&#](?:card(?:number|no)?|karta|nr_?karty|numer_?karty)=)([^&#\s\[\]]+)/gi, type: 'KARTA' },
  { re: /([?&#](?:token|api_?key|secret|auth|access_?token)=)([^&#\s\[\]]+)/gi, type: 'TOKEN' },
  { re: /([?&#](?:ksef(?:_?number)?|nr_?ksef|numer_?ksef)=)([^&#\s\[\]]+)/gi, type: 'KSEF' },
];
/**
 * Segmenty ścieżki, które z samej budowy adresu wskazują osobę: profil LinkedIn („/in/…", „/pub/…"),
 * osobisty OneDrive („-my.sharepoint.com/personal/" to zawsze UPN) i „facebook.com/profile.php?id=".
 * Strony firm, szkół, ofert i witryny zespołów mają inną ścieżkę. Gołe „github.com/x" czy
 * „facebook.com/x" bez reguły: ten sam kształt ma organizacja, projekt i podstrona serwisu.
 */
export const URL_PROFILE_PATH_RULES: RegExp[] = [
  /(\blinkedin\.com\/(?:in|pub)\/)([^/?#\s[\]]+(?:\/[0-9a-z]{1,3}(?=[/?#]|$)){0,3})/gi,
  /(-my\.sharepoint\.com\/personal\/)([^/?#\s[\]]+)/gi,
  /(\bfacebook\.com\/profile\.php\?(?:[^#\s]*?&)?id=)(\d+)/gi,
];

// Domena z samych cyfr przed rozszerzeniem („raport%402024.pdf") to nazwa pliku, nie adres.
const RE_URLENC_FILE_NAME = /%40[\d.-]+\.[A-Za-z]{2,}$/;

export function passEmail(ctx: RedactCtx): void {
  if (!ctx.on('EMAIL')) return;
  const full = ctx.text;
  ctx.text = full.replace(RE_EMAIL_CHAIN, (chain: string, chainAt: number) =>
    chain.replace(RE_EMAIL, (m: string, at: number) => {
      if (isGitRemote(full, chainAt + at, m)) return m;
      return ctx.hit('EMAIL');
    }),
  );
  // URL-e są już za sentinelem, więc zostaje tylko „%40" poza nimi.
  ctx.text = replaceEmails(ctx.text, RE_EMAIL_URLENC_CHAIN, RE_EMAIL_URLENC, (m: string) => {
    if (RE_URLENC_FILE_NAME.test(m)) return m;
    return ctx.hit('EMAIL');
  });
}

/**
 * „git@host:ścieżka" (forma scp) albo „ssh://git@host/…" to konto usługi hostingu kodu, nie skrzynka.
 * Tylko „git@": skrzynki funkcyjne i loginy osób w formie scp maskujemy. „git@firma.pl: dział IT" to proza.
 */
function isGitRemote(full: string, at: number, m: string): boolean {
  if (!m.startsWith('git@')) return false;
  return /^:\S/.test(full.slice(at + m.length, at + m.length + 2)) ||
    /(?:^|[^\w+])(?:git\+)?ssh:\/\/$/i.test(full.slice(Math.max(0, at - 12), at));
}
