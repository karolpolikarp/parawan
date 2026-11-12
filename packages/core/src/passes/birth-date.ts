// Data urodzenia: maskowana tylko za jawną kotwicą („ur.”, etykieta, imiesłów, „urodził się”).
import { CITY_RUN, MONTHS_GEN } from '../charset.js';
import { maskAfterLabel, type RedactCtx } from '../context.js';
import { BIRTH_COMBO, birthVerbAboutPerson } from '../guards/birth.js';

const BIRTH_DATE_SRC = String.raw`\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:[IVX]{1,4}|${MONTHS_GEN})\s+\d{4}`;
const BIRTH_DATA_LABEL = String.raw`data\s+(?:urodzenia|urodz\.|ur\.)`;
const BIRTH_LABEL_PAREN = String.raw`\([^()\n]{1,40}\)`;
// Etykieta z dopełnieniem musi mieć dwukropek, bo bez niego to proza („Data urodzenia pacjenta
// w systemie uzupełniono 14.03.2024”). Imiesłów tylko w liczbie pojedynczej (liczba mnoga to
// przepis), czasownik bez czasu przyszłego (termin porodu) i bez przyimka przed datą.
const RE_BIRTH_LABELED = new RegExp(
  String.raw`\b(${BIRTH_DATA_LABEL}(?:[ \t]+[a-ząćęłńóśźż]{2,}(?:a|y|i|ego|ej)){1,2}(?=[ \t]*(?:${BIRTH_LABEL_PAREN}[ \t]*)?:)` +
    String.raw`|urodzi(?:ł(?:a|am|em|aś|eś|o|y|i)?|liśmy|łyśmy|liście|łyście)[ \t]+się` +
    String.raw`|ur\.|urodz\.|urodzon(?:ego|emu|ej|ym|y|a|ą)|urodzeni[ae]|${BIRTH_DATA_LABEL})` +
    String.raw`((?:[ \t]*${BIRTH_LABEL_PAREN})?(?:\s+(?:dnia|w\s+dniu))?[\s:.,-]*)(${BIRTH_DATE_SRC})`,
  'gi',
);
// Etykieta łączona z miejscowością przed datą („Data i miejsce urodzenia: Kielce, 12.04.1985”).
// Przy zwykłej kolejności datę bierze RE_BIRTH_LABELED, a miejscowość maskuje passCity.
const RE_BIRTH_COMBO_CITY_FIRST = new RegExp(
  String.raw`\b(${BIRTH_COMBO}[ \t]*:?\s*${CITY_RUN}[ \t]*,?[ \t]*)()(${BIRTH_DATE_SRC})`,
  'g',
);
// „ur” bez kropki (czat, notatka) tylko tuż przed datą i nie wersalikami („Senat UR 14.02.1993” to uczelnia).
const RE_BIRTH_UR_NODOT = new RegExp(String.raw`\b([Uu]r)([ \t]+)(${BIRTH_DATE_SRC})`, 'g');
// Próg w przepisie, nie data osoby („Kobiecie urodzonej 1 stycznia 1953 r. lub później”); maska
// zniszczyłaby treść przepisu. Alternatywa „lub/albo/bądź” wystarcza zawsze.
const RE_BIRTH_THRESHOLD_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:lub|albo|bądź)[ \t]+(?:później|wcześniej)(?!\p{L})/iu;
// „i później/wcześniej” to próg tylko w kształcie przepisu: przy formie zależnej imiesłowu, na końcu
// zdania albo przed orzeczeniem w czasie teraźniejszym. Mianownik, „ur.” i czas przeszły to życiorys
// („urodzona 12.03.1953 r. i później zamieszkała w Krakowie”).
const RE_BIRTH_THRESHOLD_AND_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*i[ \t]+(?:później|wcześniej)(?:[ \t]*(?:[.,;:)!?\n]|$)|[ \t]+(?:przysługuj|stosuj|obowiązuj|należ|nabyw|otrzymuj|podlega|wypłac|przyzna|dotycz|ma[ \t]|mają[ \t])(?!\p{L}*ł))/iu;
// Alternatywa z mianownikiem i czasem przeszłym za progiem to też życiorys
// („Jan Kowalski urodzony 14.03.1958 r. lub później podlegał …”).
const RE_BIRTH_THRESHOLD_PAST =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:lub|albo|bądź)[ \t]+(?:później|wcześniej)[ \t]+(?:się[ \t]+)?\p{Ll}{2,}(?:ł[aoy]?|li)(?!\p{L})/iu;
const RE_BIRTH_KW_OBLIQUE = /^urodzon(?:ej|ego|ym|emu|ych)(?!\p{L})/iu;
// „urodzonym” po rzeczowniku na „-om” to celownik liczby mnogiej, czyli przepis („osobom urodzonym …”);
// narzędnik liczby pojedynczej zostaje.
const RE_BIRTH_PLURAL_DATIVE_BEFORE = /\p{L}om[ \t]+$/u;
// To samo po przymiotniku rzeczownikowym na „-ym” („przysługuje ubezpieczonym urodzonym …”).
// Po przyimku to liczba pojedyncza, czyli osoba (liczba mnoga miałaby „-ymi”/„-ych”).
const RE_BIRTH_ADJ_DATIVE_BEFORE = /(?:^|[^\p{L}])(?:(\p{L}+)[ \t]+)?\p{Ll}{3,}(?:on|an|n|t)ym[ \t]+$/u;
const RE_BIRTH_SINGULAR_BEFORE_ADJ =
  /^(?:z|ze|nad|pod|przed|za|o|po|przy|w|we|na|wobec|się|jako|jest|był|była|został|została|będącego|będącej|będącym|będący|będąca|\p{L}{2,}i?em)$/iu;
function birthPluralDativeBefore(before: string): boolean {
  if (RE_BIRTH_PLURAL_DATIVE_BEFORE.test(before)) return true;
  const m = RE_BIRTH_ADJ_DATIVE_BEFORE.exec(before);
  if (!m) return false;
  // Narzędnik liczby pojedynczej: po przyimku, „się”, „jest/jako”, rzeczowniku na „-em” albo
  // w dopowiedzeniu po przecinku („z Janem Nowakiem, ubezpieczonym urodzonym …”).
  if (m[1] === undefined) return !/,[ \t]*\p{Ll}+[ \t]+$/u.test(before);
  if (RE_BIRTH_SINGULAR_BEFORE_ADJ.test(m[1])) return false;
  // Rzeczownik między przyimkiem a przymiotnikiem („o pracowniku zatrudnionym urodzonym …”) to osoba,
  // chyba że stoi w liczbie mnogiej. Sama końcówka rzeczownika nie rozstrzyga, więc liczy się wyraz przed nim.
  const pre = /(?:^|[^\p{L}])(\p{L}+)[ \t]+$/u.exec(before.slice(0, m.index + m[0].indexOf(m[1])))?.[1];
  if (pre && RE_BIRTH_SINGULAR_BEFORE_ADJ.test(pre) && !/(?:om|ami|ach|mi)$/u.test(m[1])) return false;
  return true;
}
export function passBirthDate(ctx: RedactCtx): void {
  if (!ctx.on('DATA-UR')) return;
  ctx.text = ctx.text.replace(RE_BIRTH_LABELED, (m, kw: string, sep: string, d: string, offset: number, str: string) => {
    const after = str.slice(offset + m.length, offset + m.length + 60);
    const oblique = RE_BIRTH_KW_OBLIQUE.test(kw);
    if (RE_BIRTH_THRESHOLD_AFTER.test(after) && (oblique || !RE_BIRTH_THRESHOLD_PAST.test(after))) return m;
    if (oblique && RE_BIRTH_THRESHOLD_AND_AFTER.test(after)) return m;
    if (/^urodzi/i.test(kw)) {
      if (!birthVerbAboutPerson(kw, str.slice(Math.max(0, offset - 320), offset))) return m;
      // Rok sprzed 1900 to biogram („Mikołaj Kopernik urodził się 19 lutego 1473 r.”), nie dane osoby.
      const year = /(\d{4})$/.exec(d)?.[1];
      if (year && +year < 1900) return m;
    }
    if (/^urodzonym$/i.test(kw) && birthPluralDativeBefore(str.slice(Math.max(0, offset - 50), offset))) return m;
    return `${kw}${sep}${ctx.hit('DATA-UR')}`;
  });
  maskAfterLabel(ctx, RE_BIRTH_COMBO_CITY_FIRST, 'DATA-UR');
  maskAfterLabel(ctx, RE_BIRTH_UR_NODOT, 'DATA-UR');
}
