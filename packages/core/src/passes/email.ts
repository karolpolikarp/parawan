import { type RedactCtx } from '../context.js';
import { type PiiType } from '../types.js';


// ── URL: ochrona + maskowanie WEWNĄTRZ ────────────────────────────────────────
// E-mail — wzorzec współdzielony przez krok 1 i maskowanie wewnątrz URL-i.
// Część lokalna i domena DOPUSZCZAJĄ polskie litery (ąćęłńóśźż…): adres „piotr.wiśniewski@…" musi
// zostać zamaskowany W CAŁOŚCI. Bez tego klasa ASCII zatrzymywała się na „ś" i zostawiała jawny
// fragment nazwiska („piotr.wiś") przed [EMAIL] — wyciek (patrz „maskuj całość, nie fragment").
export const RE_EMAIL = /[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+@[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}/g;
// E-mail zakodowany jak w URL-u („%40" zamiast „@"). Bywa też POZA adresem ze schematem: ścieżka
// względna w logu dostępowym („GET /api?email=jan%40x.pl"), ciało formularza, URL z ukośnikami
// ucieczonymi przez json_encode („https:\/\/…") — dlatego passEmail stosuje go także globalnie.
export const RE_EMAIL_URLENC = /[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+%40[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,}/g;
// WYDAJNOŚĆ: RE_EMAIL puszczony wprost po tekście jest KWADRATOWY — w długim ciągu znaków
// części lokalnej bez „@" (100 tys. liter, cyfr, „Ż", „a.a.a…") każda pozycja startowa skanuje
// ciąg do końca (5–15 s, karta przeglądarki zamarza). Najpierw szukamy więc ŁAŃCUCHA adresów
// zaczynającego się na POCZĄTKU ciągu znaków lokalnych (lookbehind: start w środku ciągu
// odpada), a dopiero wewnątrz znalezionego fragmentu stosujemy RE_EMAIL. Wynik jest identyczny
// z RE_EMAIL po całym tekście: dopasowanie startujące w środku ciągu zawsze da się przedłużyć
// w lewo do jego początku, a sklejone adresy („a@b.pl.c@d.pl") obejmuje powtórzenie grupy.
export const RE_EMAIL_CHAIN =
  /(?<![A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-])(?:[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+@[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,})+/g;
export const RE_EMAIL_URLENC_CHAIN =
  /(?<![A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-])(?:[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ._%+-]+%40[A-Za-z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ.-]+\.[A-Za-z]{2,})+/g;
/** Maskuje e-maile w czasie liniowym: łańcuch → RE_EMAIL wewnątrz (patrz RE_EMAIL_CHAIN). */
export function replaceEmails(s: string, chain: RegExp, single: RegExp, mask: (m: string) => string): string {
  return s.replace(chain, (m) => m.replace(single, mask));
}
/**
 * Parametry query URL-a o kluczach OSOBOWYCH — klucz to mocna kotwica, maskujemy samą
 * wartość wg typu (?user=[LOGIN]&email=[EMAIL]), struktura URL-a zostaje. Klasa wartości
 * wyklucza „[" — placeholder z poprzedniego przebiegu nie jest ponownie maskowany.
 */
// Prefiks klucza obejmuje też „#" — parametry bywają we FRAGMENCIE URL-a (OAuth implicit
// flow: „callback#access_token=…"), który wcześniej wyciekał.
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
 * Segmenty ścieżki, które z samej budowy adresu są identyfikatorem osoby: profil LinkedIn
 * („/in/joanna-pietrzak-hr", „/pub/joanna-pietrzak/12/345/678"), osobisty OneDrive
 * („firma-my.sharepoint.com/personal/jan_kowalski_firma_pl" — to zawsze UPN użytkownika)
 * i numeryczny profil Facebooka („profile.php?id=…"). Strony firm, szkół i ofert
 * („/company/", „/school/", „/jobs/") oraz witryny zespołów („firma.sharepoint.com/sites/")
 * mają inną ścieżkę i zostają. Gołe „github.com/x", „facebook.com/x" — bez reguły: tam ten sam
 * kształt ma organizacja, projekt i podstrona serwisu.
 */
export const URL_PROFILE_PATH_RULES: RegExp[] = [
  /(\blinkedin\.com\/(?:in|pub)\/)([^/?#\s[\]]+(?:\/[0-9a-z]{1,3}(?=[/?#]|$)){0,3})/gi,
  /(-my\.sharepoint\.com\/personal\/)([^/?#\s[\]]+)/gi,
  /(\bfacebook\.com\/profile\.php\?(?:[^#\s]*?&)?id=)(\d+)/gi,
];

// ═════════ FAZA 1 · STRUKTURALNE WYSOKIEJ PRECYZJI (etykieta / wzorzec) ═════════
// 1) E-MAIL
export function passEmail(ctx: RedactCtx): void {
  if (!ctx.on('EMAIL')) return;
  const full = ctx.text;
  ctx.text = full.replace(RE_EMAIL_CHAIN, (chain: string, chainAt: number) =>
    chain.replace(RE_EMAIL, (m: string, at: number) => {
      if (isGitRemote(full, chainAt + at, m)) return m;
      ctx.bump('EMAIL');
      return ctx.M.EMAIL;
    }),
  );
  // URL-e są już za sentinelem, więc to tylko „%40" poza nimi — bez podwójnego maskowania.
  // Domena z samych cyfr przed „rozszerzeniem" („raport%402024.pdf") to nazwa pliku, nie adres.
  ctx.text = replaceEmails(ctx.text, RE_EMAIL_URLENC_CHAIN, RE_EMAIL_URLENC, (m: string) => {
    if (/%40[\d.-]+\.[A-Za-z]{2,}$/.test(m)) return m;
    ctx.bump('EMAIL');
    return ctx.M.EMAIL;
  });
}
/**
 * Adres zdalnego repozytorium „git@host:ścieżka" (forma scp) albo „ssh://git@host/…" — „git" to
 * stałe konto usługi hostingu kodu, nie skrzynka osoby, a maska zjadała nazwę serwera. TYLKO
 * „git@": skrzynki funkcyjne (biuro@, noreply@) i loginy osób w formie scp („jan.kowalski@
 * serwer:/home") maskujemy jak dotąd. Dwukropek ze spacją („git@firma.pl: dział IT") to proza.
 */
function isGitRemote(full: string, at: number, m: string): boolean {
  if (!m.startsWith('git@')) return false;
  return /^:\S/.test(full.slice(at + m.length, at + m.length + 2)) ||
    /(?:^|[^\w+])(?:git\+)?ssh:\/\/$/i.test(full.slice(Math.max(0, at - 12), at));
}
