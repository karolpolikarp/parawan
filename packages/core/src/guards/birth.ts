// Strażniki kotwic urodzenia: etykieta łączona „Data i miejsce urodzenia” i test, czy „urodził się”
// mówi o osobie, wspólne dla passBirthDate i passCity.
import { PERSON_MASK_SRC } from '../charset.js';

// Etykieta łączona daty i miejsca urodzenia, w obu kolejnościach.
export const BIRTH_COMBO = String.raw`(?:[Dd]ata[ \t]+i[ \t]+[Mm]iejsce|[Mm]iejsce[ \t]+i[ \t]+[Dd]ata)[ \t]+(?:urodzenia|ur\.)`;
// „urodził(a) się” jest kotwicą tylko o osobie: rodzi się też pomysł, festiwal czy cielę, a forma
// nijaka i mnoga to zwykle statystyka. Podmiotu osobowego nie wymagamy, bo nazwisko jest tu jeszcze
// jawne („Kowalski urodził się”). Forma nijaka tylko o dziecku, mnoga tylko o bliźniętach.
const RE_BIRTH_VERB_SELF = /^urodzi(?:łam|łem|łaś|łeś|liśmy|łyśmy|liście|łyście)[ \t]/i;
const RE_BIRTH_VERB_3SG = /^urodzi(?:ł|ła)[ \t]/i;
const RE_BIRTH_VERB_NEUTER = /^urodziło[ \t]/i;
const RE_BIRTH_VERB_PLURAL = /^urodzi(?:li|ły)[ \t]/i;
const RE_BIRTH_SUBJECT_THING =
  /(?<!\p{L})(?:pomysł|projekt|idea|koncepcja|myśl|plan|inicjatywa|przedsięwzięcie|festiwal|ruch|zespół|firma|marka|akcja|tradycja|zwyczaj|impreza|wydarzenie|program|konkurs|stowarzyszenie|fundacja|spółka|teatr|kabaret|cielę|źrebię|źrebak|szczenię|szczeniak|kocię|jagnię|prosię|koźlę|zwierzę|pies|kot|klacz|jałówka|młode|najwięcej|najmniej|łącznie|ogółem|dzieci|noworodków|osób)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_CHILD = new RegExp(
  String.raw`${PERSON_MASK_SRC}|(?<!\p{L})(?:dziecko|dziecię|niemowlę|małoletnie|wnuczę|bliźnię)(?!\p{L})`,
  'iu',
);
const RE_BIRTH_SUBJECT_TWINS = /(?<!\p{L})(?:bliźnięta|bliźniaki|bliźniaczki|bliźniacy|trojaczki)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_PUBLIC =
  /(?<!\p{L})(?:patron\p{L}*|święt(?:y|a|ego|ej)|św\.|bł\.|błogosławion\p{L}*|papież\p{L}*|kardynał\p{L}*|prymas\p{L}*|znan[ya]|słynn[ya]|wybitn[ya]|sławn[ya]|król|króla|królowa|królowej|poeta|poetka|poety|pisarz|pisarka|pisarza|kompozytor|kompozytora)(?!\p{L})/iu;
const RE_BIRTH_SUBJECT_REGNAL = /\p{Lu}\p{Ll}+[ \t]+(?:II|III|IV|VI|VII|VIII|IX|XI|XII|XIII|XIV|XV|XVI)(?![\p{L}\p{N}])/u;
const RE_BIRTH_PATRON_PARA = /(?<!\p{L})(?:patron\p{L}*(?![ \t]*:)|nadani\p{L}*[ \t]+imienia)(?!\p{L})/iu;
const RE_BIRTH_HYPOTHETICAL =
  /(?<!\p{L})(?:jeżeli|jeśli|gdyby|o[ \t]+ile|w[ \t]+przypadku,?[ \t]+gdy|przykład\p{L}*|np\.|załóżmy|przyjmijmy)(?!\p{L})/iu;
// Podmiot ogólny tuż przed czasownikiem („Osoba, która urodziła się …”, „kto”, „nikt”) i rzeczownik
// ogólny z „, który” w regule. Bez ról z decyzji: wnioskodawca, który urodził się …, to strona.
const RE_BIRTH_GENERIC_SUBJECT =
  /(?:^|[^\p{L}])(?:(?:osoba|każdy|każda|ten|ta)[ \t]*,?[ \t]*(?:któr[ay]|kto)|(?:uczeń|uczennica|senior|seniorka|mieszkaniec|mieszkanka|kandydat|kandydatka)[ \t]*,[ \t]*któr[ay]|kto|ktokolwiek|nikt)[ \t]*(?:nie[ \t]+)?$/iu;
/** `kw` zaczyna się od „urodzi” (sprawdzają to obaj wołający), `before` to tekst przed kotwicą. */
export function birthVerbAboutPerson(kw: string, before: string): boolean {
  if (RE_BIRTH_VERB_SELF.test(kw)) return true;
  const seg0 = before.slice(-120);
  const seg = seg0.slice(Math.max(seg0.lastIndexOf('.'), seg0.lastIndexOf('!'), seg0.lastIndexOf('?'), seg0.lastIndexOf('\n')) + 1);
  // Biogram patrona albo władcy z liczbą porządkową („Jan Paweł II urodził się …”) to nie dane strony.
  if (RE_BIRTH_SUBJECT_PUBLIC.test(seg) || RE_BIRTH_SUBJECT_REGNAL.test(seg)) return false;
  // Patron zapowiedziany wcześniej w tym samym akapicie („Patronka szkoły. Irena Sendlerowa urodziła
  // się …”); etykieta pola „Patron:” się nie liczy.
  const para = before.slice(before.lastIndexOf('\n\n') + 1);
  if (RE_BIRTH_PATRON_PARA.test(para)) return false;
  // Pouczenie, przykład obliczeniowy i reguła ogólna mówią o osobie hipotetycznej
  // („Jeżeli dziecko urodziło się 1 czerwca 2026 r., …”).
  if (RE_BIRTH_HYPOTHETICAL.test(seg) || RE_BIRTH_GENERIC_SUBJECT.test(seg)) return false;
  if (RE_BIRTH_VERB_NEUTER.test(kw)) return RE_BIRTH_SUBJECT_CHILD.test(seg) && !RE_BIRTH_SUBJECT_THING.test(seg);
  if (RE_BIRTH_VERB_PLURAL.test(kw)) return RE_BIRTH_SUBJECT_TWINS.test(seg);
  if (!RE_BIRTH_VERB_3SG.test(kw)) return false;
  // Rzeczownik na „-ość” tuż przed czasownikiem to organizacja albo idea („Solidarność urodziła się …”).
  if (/\p{L}{2,}ość[ \t]*$/iu.test(seg)) return false;
  const near = seg.split(/[ \t]+/).filter(Boolean).slice(-3).join(' ');
  return !RE_BIRTH_SUBJECT_THING.test(near);
}
