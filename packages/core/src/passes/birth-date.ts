import { CAP_CITY } from '../charset.js';
import { maskAfterLabel, type RedactCtx } from '../context.js';


// ═══════════════════ FAZA 3 · DATA I ADRES / MIEJSCOWOŚĆ ═══════════════════
// Adres i miejscowość kotwiczą na już zamaskowanym [KOD-POCZTOWY]/[ADRES] z wcześniejszych
// przebiegów — dlatego passPostalNoHyphen i passCity biegną tu, a nie w FAZIE 2.
// 11) DATA URODZENIA — tylko z jawnym kontekstem (ur./urodzony/data urodzenia) + data.
const BIRTH_DATE_SRC = String.raw`\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:[IVX]{1,4}|stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)\s+\d{4}`;
// Etykieta z dopełnieniem („Data urodzenia pacjenta:", „Data ur. pierwszego dziecka:", też
// z podpowiedzią formatu w nawiasie przed dwukropkiem) — 1–2 wyrazy z końcówką dopełniacza
// i OBOWIĄZKOWY dwukropek: „Data urodzenia pacjenta w systemie uzupełniono 14.03.2024" to proza.
const BIRTH_LABEL_PAREN = String.raw`\([^()\n]{1,40}\)`;
const RE_BIRTH_LABELED = new RegExp(
  String.raw`\b(data\s+(?:urodzenia|urodz\.|ur\.)(?:[ \t]+[a-ząćęłńóśźż]{2,}(?:a|y|i|ego|ej)){1,2}(?=[ \t]*(?:${BIRTH_LABEL_PAREN}[ \t]*)?:)` +
    // Formy zależne imiesłowu („urodzonej", „urodzonego", „urodzoną") — w pismach sądowych osoba
    // stoi w dopełniaczu albo celowniku. Liczby mnogiej celowo brak: „dla dzieci urodzonych
    // 1 stycznia 2016 r." to przepis, nie dane osoby („urodzonym" w celowniku liczby mnogiej
    // i próg „… lub później" odsiewa passBirthDate). „w dniu" jak „dnia".
    // Forma osobowa czasownika („urodziłam się 12.05.1990", „urodził się dnia 3 maja 1985 r.") —
    // życiorys, oświadczenie, wywiad lekarski. Bez czasu przyszłego („Dziecko urodzi się około
    // 12.05.2026" to termin porodu) i bez przyimka przed datą („urodziły się po 1 stycznia 2016").
    String.raw`|urodzi(?:ł(?:a|am|em|aś|eś|o|y|i)?|liśmy|łyśmy|liście|łyście)[ \t]+się` +
    String.raw`|ur\.|urodz\.|urodzon(?:ego|emu|ej|ym|y|a|ą)|urodzeni[ae]|data\s+(?:urodzenia|urodz\.|ur\.))` +
    String.raw`((?:[ \t]*${BIRTH_LABEL_PAREN})?(?:\s+(?:dnia|w\s+dniu))?[\s:.,-]*)(${BIRTH_DATE_SRC})`,
  'gi',
);
// „Data i miejsce urodzenia" / „Miejsce i data urodzenia" z miejscowością PRZED datą („…: Kielce,
// 12.04.1985") — w zwykłej kolejności datę bierze RE_BIRTH_LABELED, ale tu dawniej zostawała jawna.
// Miejscowość maskuje 12g2 w passCity (tylko słownik).
export const BIRTH_COMBO = String.raw`(?:[Dd]ata[ \t]+i[ \t]+[Mm]iejsce|[Mm]iejsce[ \t]+i[ \t]+[Dd]ata)[ \t]+(?:urodzenia|ur\.)`;
const RE_BIRTH_COMBO_CITY_FIRST = new RegExp(
  String.raw`\b(${BIRTH_COMBO}[ \t]*:?\s*(?:${CAP_CITY}[ \t]+){0,2}${CAP_CITY}[ \t]*,?[ \t]*)()(${BIRTH_DATE_SRC})`,
  'g',
);
// „ur 14.02.1993" bez kropki (czat, notatka) — tylko z data tuż za nim i bez wersalików: „Senat UR
// 14.02.1993" to uczelnia.
const RE_BIRTH_UR_NODOT = new RegExp(String.raw`\b([Uu]r)([ \t]+)(${BIRTH_DATE_SRC})`, 'g');
// Próg w przepisie albo uchwale, nie data osoby: „Kobiecie urodzonej 1 stycznia 1953 r. lub
// później", „dziecka urodzonego w dniu 1 stycznia 2027 r. lub później", „osobie urodzonej 31 grudnia
// 1961 r. lub wcześniej" (becikowe, Karta Seniora, emerytura). Po maskowaniu przepis tracił sens.
// Alternatywa („lub/albo/bądź") zawsze; „i później/wcześniej" tylko na końcu zdania albo przed
// orzeczeniem przepisu („Matce urodzonej 1 stycznia 2004 r. i później przysługuje dodatek", „dziecka
// urodzonego … r. i później stosuje się § 2"): „urodzona 12.03.1953 r. i później zamieszkała
// w Krakowie" czy „… i później zatrudniony" to życiorys osoby.
const RE_BIRTH_THRESHOLD_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:lub|albo|bądź)[ \t]+(?:później|wcześniej)(?!\p{L})/iu;
// Gałąź „i później/wcześniej" tylko w kształcie przepisu: przy formie zależnej („Matce urodzonej …",
// „dziecka urodzonego …", „osobom urodzonym …") i z orzeczeniem w czasie teraźniejszym. Mianownik
// („Jan Kowalski urodzony 14.03.1958 r. i później podlegał ubezpieczeniu", „Anna Nowak, urodzona …
// i wcześniej ma ustalone prawo do renty") i „ur." to życiorys konkretnej osoby, a czas przeszły
// („podlegał", „należał") — zawsze życiorys.
const RE_BIRTH_THRESHOLD_AND_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*i[ \t]+(?:później|wcześniej)(?:[ \t]*(?:[.,;:)!?\n]|$)|[ \t]+(?:przysługuj|stosuj|obowiązuj|należ|nabyw|otrzymuj|podlega|wypłac|przyzna|dotycz|ma[ \t]|mają[ \t])(?!\p{L}*ł))/iu;
// Alternatywa w życiorysie: mianownik i czas przeszły za progiem („Jan Kowalski urodzony 14.03.1958 r.
// lub później podlegał …") to konkretna osoba, jak przy „i później" — przepis ma czas teraźniejszy.
const RE_BIRTH_THRESHOLD_PAST =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:lub|albo|bądź)[ \t]+(?:później|wcześniej)[ \t]+(?:się[ \t]+)?\p{Ll}{2,}(?:ł[aoy]?|li)(?!\p{L})/iu;
const RE_BIRTH_KW_OBLIQUE = /^urodzon(?:ej|ego|ym|emu|ych)(?!\p{L})/iu;
// „urodzonym" to też celownik liczby mnogiej („osobom urodzonym …", „dzieciom urodzonym …") — po
// rzeczowniku na „-om" to przepis, a narzędnik („z Janem Kowalskim urodzonym …") zostaje.
const RE_BIRTH_PLURAL_DATIVE_BEFORE = /\p{L}om[ \t]+$/u;
// …tak samo po rzeczownikowym przymiotniku na „-ym" („Emerytura przysługuje ubezpieczonym urodzonym
// 1 stycznia 1949 r.", „uprawnionym urodzonym …"). Po przyimku to narzędnik albo miejscownik liczby
// pojedynczej, czyli osoba: „umowa z ubezpieczonym urodzonym 3 maja 1980 r.", „opiekun nad
// ubezwłasnowolnionym urodzonym 12.03.1950 r.", „orzeczenie o ubezpieczonym urodzonym …" (liczba
// mnoga miałaby „-ymi"/„-ych").
const RE_BIRTH_ADJ_DATIVE_BEFORE = /(?:^|[^\p{L}])(?:(\p{L}+)[ \t]+)?\p{Ll}{3,}(?:on|an|n|t)ym[ \t]+$/u;
const RE_BIRTH_SINGULAR_BEFORE_ADJ =
  /^(?:z|ze|nad|pod|przed|za|o|po|przy|w|we|na|wobec|się|jako|jest|był|była|został|została|będącego|będącej|będącym|będący|będąca|\p{L}{2,}i?em)$/iu;
function birthPluralDativeBefore(before: string): boolean {
  if (RE_BIRTH_PLURAL_DATIVE_BEFORE.test(before)) return true;
  const m = RE_BIRTH_ADJ_DATIVE_BEFORE.exec(before);
  if (!m) return false;
  // Narzędnik liczby pojedynczej bez przyimka: po rzeczowniku w narzędniku („bratem niepełnosprawnym
  // urodzonym …"), po „się" („opiekuje się poszkodowanym …"), po „będącego/jest/jako" i w dopowiedzeniu
  // po przecinku („z Janem Nowakiem, ubezpieczonym urodzonym …").
  if (m[1] === undefined) return !/,[ \t]*\p{Ll}+[ \t]+$/u.test(before);
  if (RE_BIRTH_SINGULAR_BEFORE_ADJ.test(m[1])) return false;
  // Rzeczownik między przyimkiem liczby pojedynczej a przymiotnikiem („o pracowniku zatrudnionym
  // urodzonym …", „o pacjencie hospitalizowanym …", „nad synem Kubą przysposobionym …") — to osoba.
  // Sama końcówka rzeczownika nie rozstrzyga („przysługuje ubezpieczonym urodzonym" to przepis),
  // więc liczy się wyraz przed nim, a liczba mnoga („o pracownikach …", „nad dziećmi …") odpada.
  const pre = /(?:^|[^\p{L}])(\p{L}+)[ \t]+$/u.exec(before.slice(0, m.index + m[0].indexOf(m[1])))?.[1];
  if (pre && RE_BIRTH_SINGULAR_BEFORE_ADJ.test(pre) && !/(?:om|ami|ach|mi)$/u.test(m[1])) return false;
  return true;
}
// Czasownik „urodził(a) się" jest kotwicą tylko wtedy, gdy mówi o osobie. W prozie urzędowej
// i prasowej rodzi się też pomysł, projekt, festiwal albo cielę, a forma nijaka i mnoga („najwięcej
// dzieci urodziło się w Krakowie") to statystyka. Pierwsza i druga osoba („urodziłam się") zawsze;
// trzecia pojedyncza, gdy podmiotem nie jest rzecz, zwierzę ani patron. Podmiotu osobowego nie
// wymagamy: przed FAZĄ 4 nazwisko stoi jeszcze jawne („Kowalski urodził się", „Nowakowa", „Wnuczka").
// Forma nijaka tylko o dziecku, mnoga tylko o bliźniętach.
const RE_BIRTH_VERB_SELF = /^urodzi(?:łam|łem|łaś|łeś|liśmy|łyśmy|liście|łyście)[ \t]/i;
const RE_BIRTH_VERB_3SG = /^urodzi(?:ł|ła)[ \t]/i;
const RE_BIRTH_VERB_NEUTER = /^urodziło[ \t]/i;
const RE_BIRTH_VERB_PLURAL = /^urodzi(?:li|ły)[ \t]/i;
const RE_BIRTH_SUBJECT_THING =
  /(?<!\p{L})(?:pomysł|projekt|idea|koncepcja|myśl|plan|inicjatywa|przedsięwzięcie|festiwal|ruch|zespół|firma|marka|akcja|tradycja|zwyczaj|impreza|wydarzenie|program|konkurs|stowarzyszenie|fundacja|spółka|teatr|kabaret|cielę|źrebię|źrebak|szczenię|szczeniak|kocię|jagnię|prosię|koźlę|zwierzę|pies|kot|klacz|jałówka|młode|najwięcej|najmniej|łącznie|ogółem|dzieci|noworodków|osób)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_CHILD = /\[OSOBA-[A-Z]+\]|\[IMIĘ I NAZWISKO\]|(?<!\p{L})(?:dziecko|dziecię|niemowlę|małoletnie|wnuczę|bliźnię)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_TWINS = /(?<!\p{L})(?:bliźnięta|bliźniaki|bliźniaczki|bliźniacy|trojaczki)(?!\p{L})/iu;
export function birthVerbAboutPerson(kw: string, before: string): boolean {
  if (!/^urodzi/i.test(kw)) return true;
  if (RE_BIRTH_VERB_SELF.test(kw)) return true;
  const seg0 = before.slice(-120);
  const seg = seg0.slice(Math.max(seg0.lastIndexOf('.'), seg0.lastIndexOf('!'), seg0.lastIndexOf('?'), seg0.lastIndexOf('\n')) + 1);
  // biogram patrona szkoły czy ulicy w uzasadnieniu uchwały to nie dane strony; władca albo papież
  // z liczbą porządkową („Jan Paweł II urodził się …") też — silnik i tak zostawia jego imię jawne
  if (RE_BIRTH_SUBJECT_PUBLIC.test(seg) || RE_BIRTH_SUBJECT_REGNAL.test(seg)) return false;
  // Biogram patrona zapowiedziany w poprzednim zdaniu tego samego akapitu („Patronka szkoły.
  // Irena Sendlerowa urodziła się 15 lutego 1910 r. w Warszawie."). Etykieta pola („Patron: Jan
  // Kowalski") się nie liczy.
  const para = before.slice(before.lastIndexOf('\n\n') + 1);
  if (RE_BIRTH_PATRON_PARA.test(para)) return false;
  // Pouczenie i przykład obliczeniowy („Jeżeli dziecko urodziło się 1 czerwca 2026 r., …",
  // „Przykład: ubezpieczony urodził się 1 lipca 1958 r.") mówią o osobie hipotetycznej, a reguła
  // właściwości („Osoba, która urodziła się w Kielcach, …") — o każdym. Maska psuła treść pouczenia.
  if (RE_BIRTH_HYPOTHETICAL.test(seg) || RE_BIRTH_GENERIC_SUBJECT.test(seg)) return false;
  if (RE_BIRTH_VERB_NEUTER.test(kw)) return RE_BIRTH_SUBJECT_CHILD.test(seg) && !RE_BIRTH_SUBJECT_THING.test(seg);
  if (RE_BIRTH_VERB_PLURAL.test(kw)) return RE_BIRTH_SUBJECT_TWINS.test(seg);
  if (!RE_BIRTH_VERB_3SG.test(kw)) return false;
  // rzecz albo zwierzę tuż przed czasownikiem („Pomysł urodził się …", „Festiwal urodził się …")
  const near = seg.split(/[ \t]+/).filter(Boolean).slice(-3).join(' ');
  // rzeczownik abstrakcyjny na „-ość" tuż przed czasownikiem to organizacja albo idea, nie osoba
  // („Solidarność urodziła się 31 sierpnia 1980 r. w Gdańsku", „NSZZ Solidarność urodził się …")
  if (/\p{L}{2,}ość[ \t]*$/iu.test(seg)) return false;
  return !RE_BIRTH_SUBJECT_THING.test(near);
}
const RE_BIRTH_PATRON_PARA = /(?<!\p{L})(?:patron\p{L}*(?![ \t]*:)|nadani\p{L}*[ \t]+imienia)(?!\p{L})/iu;
/** Rok sprzed 1900 jako osobny wyraz („w 1867 r.", „19 lutego 1473"). */
export const RE_PRE1900_YEAR = /(?<![\d.\/-])1[0-8]\d\d(?![\d.\/-]\d)/;
/** Zdanie wokół zakresu [start, end): od poprzedniej kropki, „!", „?" albo nowej linii do następnej. */
export function sentenceAround(t: string, start: number, end: number): string {
  const lo = Math.max(0, start - 200);
  const head = t.slice(lo, start);
  const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('!'), head.lastIndexOf('?'), head.lastIndexOf('\n'));
  const tail = t.slice(end, end + 200);
  const stop = tail.search(/[.!?](?:[ \t]+\p{Lu}|[ \t]*$|[ \t]*\n)|\n/u);
  return head.slice(cut + 1) + t.slice(start, end) + (stop < 0 ? tail : tail.slice(0, stop));
}
const RE_BIRTH_SUBJECT_REGNAL =/\p{Lu}\p{Ll}+[ \t]+(?:II|III|IV|VI|VII|VIII|IX|XI|XII|XIII|XIV|XV|XVI)(?![\p{L}\p{N}])/u;
const RE_BIRTH_HYPOTHETICAL =
  /(?<!\p{L})(?:jeżeli|jeśli|gdyby|o[ \t]+ile|w[ \t]+przypadku,?[ \t]+gdy|przykład\p{L}*|np\.|załóżmy|przyjmijmy)(?!\p{L})/iu;
// Podmiot ogólny tuż przed czasownikiem: „Osoba, która urodziła się …", „Każdy, kto urodził się …".
// Także rzeczownik ogólny z „, który" w regule („Uczeń, który urodził się 1 września 2019 r., zostaje
// przyjęty", „Senior, który urodził się …") i samo „kto/ktokolwiek/nikt" w pouczeniu („kto urodził się
// w Opolu, składa wniosek …"). Bez ról z decyzji („Wnioskodawca, który urodził się …" to strona).
const RE_BIRTH_GENERIC_SUBJECT =
  /(?:^|[^\p{L}])(?:(?:osoba|każdy|każda|ten|ta)[ \t]*,?[ \t]*(?:któr[ay]|kto)|(?:uczeń|uczennica|senior|seniorka|mieszkaniec|mieszkanka|kandydat|kandydatka)[ \t]*,[ \t]*któr[ay]|kto|ktokolwiek|nikt)[ \t]*(?:nie[ \t]+)?$/iu;
const RE_BIRTH_SUBJECT_PUBLIC =
  /(?<!\p{L})(?:patron\p{L}*|święt(?:y|a|ego|ej)|św\.|bł\.|błogosławion\p{L}*|papież\p{L}*|kardynał\p{L}*|prymas\p{L}*|znan[ya]|słynn[ya]|wybitn[ya]|sławn[ya]|król|króla|królowa|królowej|poeta|poetka|poety|pisarz|pisarka|pisarza|kompozytor|kompozytora)(?!\p{L})/iu;
export function passBirthDate(ctx: RedactCtx): void {
  if (!ctx.on('DATA-UR')) return;
  ctx.text = ctx.text.replace(RE_BIRTH_LABELED, (m, kw: string, sep: string, d: string, offset: number, str: string) => {
    const after = str.slice(offset + m.length, offset + m.length + 60);
    if (RE_BIRTH_THRESHOLD_AFTER.test(after) && !(!RE_BIRTH_KW_OBLIQUE.test(kw.trim()) && RE_BIRTH_THRESHOLD_PAST.test(after))) return m;
    if (RE_BIRTH_KW_OBLIQUE.test(kw.trim()) && RE_BIRTH_THRESHOLD_AND_AFTER.test(after)) return m;
    if (/^urodzi/i.test(kw)) {
      if (!birthVerbAboutPerson(kw, str.slice(Math.max(0, offset - 320), offset))) return m;
      // biogram patrona w uchwale („Mikołaj Kopernik urodził się 19 lutego 1473 r.") to nie dane osoby
      const year = /(\d{4})$/.exec(d)?.[1];
      if (year && +year < 1900) return m;
    }
    if (/^urodzonym$/i.test(kw) && birthPluralDativeBefore(str.slice(Math.max(0, offset - 50), offset))) return m;
    ctx.bump('DATA-UR');
    return `${kw}${sep}${ctx.M['DATA-UR']}`;
  });
  maskAfterLabel(ctx, RE_BIRTH_COMBO_CITY_FIRST, 'DATA-UR');
  maskAfterLabel(ctx, RE_BIRTH_UR_NODOT, 'DATA-UR');
}
