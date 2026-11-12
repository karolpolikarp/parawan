// Bramki wartości osoby pod etykietą lub kluczem (pole formularza, XML, JSON, kolumna): kategorie
// i role zamiast osoby, tytuły, partykuły i kształt imienia z nazwiskiem pisanego małymi literami.
import { HOMOGRAPH_SURNAMES, surnameShaped } from '../surnames.js';
import { FORM_LABEL_WORDS } from '../dict/forms.js';
import { GENERIC_LOGINS } from '../dict/logins.js';
import { NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from './roles.js';

// Kategoria pod kluczem „osoba"/„person" („<osoba>Prawna</osoba>"), nie osoba.
export const PERSON_CATEGORY_VALUES = new Set<string>(
  'osoba prawna prawne fizyczna fizyczne kontaktowa kontaktowe upoważniona upoważnione zainteresowana trzecia legal natural physical juridical person'.split(' '),
);
// Jeden wyraz pod „osoba"/„person", który jest rolą, kategorią albo odpowiedzią („Klient", „Tak").
// Uzupełnia ROLE_WORDS, GENERIC_LOGINS i PERSON_CATEGORY_VALUES; każdy inny wyraz pod tym kluczem to osoba.
const PERSON_ROLE_VALUES = new Set<string>(
  (
    'tak nie inna inny inne anonim anonimowa anonimowy anonymous dorosła dorosły pełnoletnia pełnoletni ' +
    'niepełnoletnia niepełnoletni małoletnia małoletni dziecko opiekun opiekunka rodzic zgłaszający ' +
    'zgłaszająca główna główny dodatkowa dodatkowy pierwsza druga kontakt użytkownik użytkowniczka ' +
    'gość klientka pracownica wnioskodawczyni petent petentka interesant interesantka adresat nadawca ' +
    'odbiorca kierownik kierowniczka specjalista specjalistka konsultant konsultantka agent operator ' +
    'matka ojciec syn córka brat siostra mąż żona partner partnerka babcia dziadek wnuczka ' +
    'customer client user employee manager owner contact guest member admin'
  ).split(/\s+/),
);
export const isPersonRoleValue = (w: string): boolean =>
  PERSON_CATEGORY_VALUES.has(w) ||
  PERSON_ROLE_VALUES.has(w) ||
  ROLE_WORDS.has(w) ||
  GENERIC_LOGINS.has(w) ||
  TITLE_WORDS.has(w) ||
  LEGAL_ENTITY_WORDS.has(w) ||
  FORM_LABEL_WORDS.has(w);
// Tytuł albo inicjał przed nazwiskiem w wartości pola („dr Gzik", „j. kowalski") nie odbiera jej
// charakteru imienia i nazwiska, jak partykuła „van".
export const RE_VALUE_TITLE_OR_INITIAL =
  /^(?:\p{L}\.|dr|dra|dr\.|mgr|mgr\.|inż\.?|prof\.?|lek\.?|med\.?|hab\.?|doc\.?|mec\.?|adw\.?|ks\.?|n\.|pan|pani|sz\.p\.)$/iu;
// Imiona-rzeczowniki, które po przymiotniku tworzą typową nazwę („Olimpijska Nadzieja"). Inne imię
// w szyku „Przymiotnik Imię" na liście („Mazowiecka Maja") to osoba w szyku „Nazwisko Imię".
export const NOUN_LIKE_NAMES_IN_TITLES = new Set<string>(['nadzieja', 'róża', 'kalina']);
// Partykuły nazwisk („Jan van Dijk", „de la Cruz"), ani imię, ani nazwisko.
export const SURNAME_PARTICLES = new Set<string>('van von de del della der den di da du dos das la le ter ten'.split(' '));
// Końcówki przymiotnika, imiesłowu, dopełniacza i zdrobnienia („koralowa", „pustyni"), częste w nazwie
// produktu. Po zwykłym imieniu wersja łagodna bez „-ka/-ko/-na", bo to częste nazwiska („jan sitko").
const RE_LOWER_NOT_SURNAME_LENIENT = /(?:ąc[aey]|yni|ii|ej|ego|ow[aey])$/;
export const RE_LOWER_NOT_SURNAME = /(?:ow[aey]|n[aey]|ąc[aey]|yni|ii|ej|ego|k[aio])$/;
/**
 * Czy wartość małymi literami pod generycznym „name"/„osoba" to osoba („anna gzik", „nowak anna")?
 * Proza łapie tylko nazwiska ze słownika. Nazwa produktu („róża pustyni", „kalina koralowa") i kategoria
 * („prawna") zostają: imię-rzeczownik bez potwierdzonego nazwiska albo drugi wyraz o końcówce przymiotnika.
 */
export function lowercaseNameLooksLikePerson(words: string[]): boolean {
  // inicjał i tytuł przed nazwiskiem („j. kowalski", „dr kowalski") pomijamy jak partykułę
  const lower = words.map((w) => w.toLowerCase()).filter((w) => !SURNAME_PARTICLES.has(w));
  const ws = lower.filter((w) => !RE_VALUE_TITLE_OR_INITIAL.test(w));
  if (!ws.length) return false;
  const confirmed = (w: string): boolean => surnameShaped(w) || HOMOGRAPH_SURNAMES.has(w);
  const plausible = (w: string): boolean => confirmed(w) || POLISH_FIRST_NAMES.has(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME.test(w));
  const [first] = ws;
  const last = ws[ws.length - 1];
  // Jeden wyraz: nazwisko ze słownika albo morfologii, albo imię; sam homograf („kalina", „sowa") to raczej
  // nazwa. Po inicjale albo tytule każdy wyraz o kształcie nazwiska, bo inicjał to kotwica osoby.
  if (ws.length === 1) {
    if (ws.length < lower.length && plausible(first) && !isPersonRoleValue(first)) return true;
    return surnameShaped(first) || (POLISH_FIRST_NAMES.has(first) && !NOUN_LIKE_FIRST_NAMES.has(first));
  }
  const rest = ws.slice(1);
  if (POLISH_FIRST_NAMES.has(first)) {
    if (rest.every((w) => confirmed(w) || POLISH_FIRST_NAMES.has(w))) return true;
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && rest.every((w) => plausible(w) || (w.length >= 3 && !RE_LOWER_NOT_SURNAME_LENIENT.test(w)))) return true;
    // Imię-rzeczownik z nazwiskiem spoza słownika („maja gzik"). Nazwa produktu ma drugi człon
    // przymiotnikowy albo w dopełniaczu („pola lawendy"), którego ten warunek nie przepuści.
    if (rest.every((w) => plausible(w) && !/(?:[iyu]|ów)$/.test(w))) return true;
    // imię z dopiskiem działu czy miejsca („kasia z księgowości")
    if (!NOUN_LIKE_FIRST_NAMES.has(first) && /^(?:z|ze|od|do|u)$/.test(rest[0])) return true;
  }
  // szyk odwrócony („nowak anna") tylko z potwierdzonym nazwiskiem, bo „pasta barbara" to produkt
  return POLISH_FIRST_NAMES.has(last) && !NOUN_LIKE_FIRST_NAMES.has(last) && ws.slice(0, -1).every(confirmed);
}
