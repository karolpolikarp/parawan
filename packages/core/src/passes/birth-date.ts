// Data urodzenia: maskowana tylko za jawną kotwicą („ur.”, etykieta, imiesłów, „urodził się”).
import { CITY_RUN, MONTHS_GEN } from '../charset.js';
import { maskAfterLabel, type RedactCtx } from '../context.js';
import { isFirstNameGenitive, isFirstNameLike } from '../dict/names.js';
import { BIRTH_COMBO, birthVerbAboutPerson } from '../guards/birth.js';

const BIRTH_DATE_SRC = String.raw`\d{1,2}[.\-/]\d{1,2}[.\-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:[IVX]{1,4}|${MONTHS_GEN})\s+\d{4}`;
const BIRTH_DATA_LABEL = String.raw`data\s+(?:urodzenia|urodz\.|ur\.)`;
const BIRTH_LABEL_PAREN = String.raw`\([^()\n]{1,40}\)`;
// Etykieta z dopełnieniem musi mieć dwukropek albo myślnik, bo bez nich to proza („Data urodzenia pacjenta
// w systemie uzupełniono 14.03.2024”). Imiesłów tylko w liczbie pojedynczej (liczba mnoga to
// przepis), czasownik bez czasu przyszłego (termin porodu) i bez przyimka przed datą.
const RE_BIRTH_LABELED = new RegExp(
  String.raw`\b(${BIRTH_DATA_LABEL}(?:[ \t]+[a-ząćęłńóśźż]{2,}(?:a|y|i|ego|ej)){1,2}(?=[ \t]*(?:${BIRTH_LABEL_PAREN}[ \t]*)?[:\-–—])` +
    String.raw`|urodzi(?:ł(?:a|am|em|aś|eś|o|y|i)?|liśmy|łyśmy|liście|łyście)[ \t]+się` +
    String.raw`|ur\.|urodz\.|urodzon(?:ego|emu|ej|ym|y|a|ą)|urodzeni[ae]|${BIRTH_DATA_LABEL})` +
    String.raw`((?:[ \t]*${BIRTH_LABEL_PAREN})?(?:\s+(?:dnia|w\s+dniu))?[\s:.,\-–—]*)(${BIRTH_DATE_SRC})`,
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
// Rzeczownik „urodzenie” z dopełniaczem dziecka i datą w tej samej frazie („w związku
// z urodzeniem syna, Marka Nowaka (PESEL …), w dniu 17 czerwca 2026 r.”). Między nimi wolno stać
// tylko temu, co opisuje dziecko albo samo urodzenie (lista dozwolonych, nie zakazanych): imię
// i nazwisko dziecka (wyrazy z wielkiej litery sprawdza potem birthNounCapsOk), znacznik, nawias
// z numerem, przecinek, jedno złamanie wiersza, rola osoby w dopełniaczu
// („studenta”), miejsce „w Szpitalu …” i zdanie „które nastąpiło / przyszło na świat”. Każdy inny
// wyraz (czasownik, termin, decyzja, myślnik, „tj.”) oznacza, że data dotyczy innego zdarzenia.
const BIRTH_NOUN_CHILD =
  '(?:syna|synka|córki|córeczki|dziecka|dzieci|wnuka|wnuczki|wnuczka|bliźniąt|bliźniaków|bliźniaczek|trojaczków|potomka)';
const BIRTH_NOUN_GAP_SEP = String.raw`(?:[ \t,]|\n(?![ \t]*\n))+(?![ \t,\n])`;
const BIRTH_NOUN_GAP_TOKEN = [
  String.raw`\p{Lu}[\p{L}'’\-]*(?![\p{L}'’\-])`,
  String.raw`\[[^\[\]\n]{1,40}\]`,
  String.raw`[\uE000-\uF8FF]`,
  String.raw`\((?=[^()\n]*[\d\[-])[^()\n]{0,60}\)`,
  String.raw`(?:pracownika|pracownicy|studenta|studentki|pacjenta|pacjentki|ubezpieczonego|ubezpieczonej|wnioskodawcy|wnioskodawczyni|pana|pani|państwa)(?!\p{L})`,
  String.raw`(?:im|św)\.(?=[ \t]*\p{Lu})`,
  String.raw`(?:w|we)(?=[ \t]+\p{Lu})`,
  String.raw`(?:(?:które|który|która|co)[ \t]+)?(?:nastąpił[oa]?|miał[oa]?[ \t]+miejsce|przyszł[oa][ \t]+na[ \t]+świat|przyszedł[ \t]+na[ \t]+świat|urodził[oa]?[ \t]+się|się[ \t]+urodził[oa]?)(?!\p{L})`,
].join('|');
const RE_BIRTH_NOUN = new RegExp(
  String.raw`(?<!\p{L})([Uu]rodzeni(?:e|a|u|em)[ \t]+(?:się[ \t]+)?(?:\p{Ll}+(?:ego|ej)[ \t]+){0,2}${BIRTH_NOUN_CHILD}(?!\p{L}))` +
    String.raw`((?:${BIRTH_NOUN_GAP_SEP}|${BIRTH_NOUN_GAP_TOKEN}){0,40}?(?<![\p{L}.])(?:w[ \t]+dniu|dnia|w[ \t]+dn\.|dn\.)[ \t]*)(${BIRTH_DATE_SRC})`,
  'gu',
);
// „nastąpiło” bez „które” pasuje tylko do mianownika („Urodzenie dziecka nastąpiło w dniu …”); przy
// dopełniaczu podmiotem jest rzeczownik przed kotwicą („Zgłoszenie urodzenia dziecka nastąpiło …”).
const RE_BIRTH_NOUN_BARE_VERB = /(?:^|[^\p{L}])(?<!(?:które|który|która|co)[ \t]+)(?:nastąpił|miał|przysz|urodził|się)/u;
// Dopełniacz „urodzenia” tylko po wyrażeniu przyczyny („z tytułu urodzenia dziecka w dniu …”). Inny
// rzeczownik przed nim („Zgłoszenie/Transkrypcja aktu/Kwestię urodzenia”, „w przypadku urodzenia”)
// to zdarzenie, którego dotyczy data, albo hipoteza z przepisu.
const RE_BIRTH_NOUN_GEN_GOVERNOR =
  /(?:^|[^\p{L}])(?:z[ \t]+tytułu|z[ \t]+okazji|z[ \t]+powodu|z[ \t]+racji|wskutek|na[ \t]+skutek|w[ \t]+następstwie|w[ \t]+wyniku|fakt|faktu|fakcie)[ \t]+$/iu;
// Hipoteza z przepisu albo termin liczony od porodu („w przypadku urodzenia”, „6 tygodni po urodzeniu”);
// „przed urodzeniem” zawsze wskazuje zdarzenie wcześniejsze niż poród.
const RE_BIRTH_NOUN_BEFORE_BLOCK = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:(?:w[ \t]+przypadku|w[ \t]+razie|na[ \t]+wypadek|gdy|jeżeli|jeśli|jeżeliby)(?:[ \t]+\p{L}+){0,3}` +
    String.raw`|(?:\d+|\p{L}+)[ \t]+(?:dni|dnia|doby|dób|tydzień|tygodnie|tygodni|tygodnia|miesiąc|miesiące|miesięcy|miesiąca|rok|lata|lat|roku|godzin|godziny)[ \t]+(?:po|od|przed)` +
    String.raw`|najpóźniej(?:[ \t]+\p{L}+){0,2}|przed)[ \t]+$`,
  'iu',
);
// Próg w przepisie po dacie, także „i później” i „albo po tej dacie”.
const RE_BIRTH_NOUN_THRESHOLD_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:i|lub|albo|bądź|oraz)[ \t]+(?:później|wcześniej|po[ \t]+tej[ \t]+dacie|przed[ \t]+tą[ \t]+datą|po[ \t]+tym[ \t]+dniu|przed[ \t]+tym[ \t]+dniem)(?!\p{L})/iu;
// Czasownik w czasie przeszłym tuż za datą („w dniu 10.08.2026 r. wypłacił zasiłek”): data opisuje
// czynność podmiotu, nie urodzenie, nawet gdy podmiot stoi przed datą („ZUS”, „Anna Nowak”).
const RE_BIRTH_NOUN_PAST_VERB_AFTER = /^[ \t]*(?:r\.|roku)?[ \t,]*(?:się[ \t]+)?\p{Ll}{2,}(?:ł|ła|ło|ły|li|no|to)(?!\p{L})/u;
// Orzeczenie w czasie teraźniejszym albo przyszłym tuż za datą („dnia 15 stycznia 2027 r. upływa
// termin”, „w dniu 1 września 2026 r. wejdą w życie przepisy”): data to termin albo zdarzenie
// prawne liczone od porodu, nie dzień urodzenia.
const RE_BIRTH_NOUN_PRESENT_VERB_AFTER =
  /^[ \t]*(?:r\.|roku)?[ \t,]*(?:się[ \t]+)?(?:upływa|upływają|upłynie|upłyną|wchodzi|wchodzą|wejdzie|wejdą|obowiązuje|obowiązują|przysługuje|przysługują|przysługiwać|należy|rozpoczyna|rozpoczynają|rozpocznie|rozpoczną|zaczyna|zaczynają|zacznie|zaczną|kończy|kończą|skończy|zakończy|mija|mijają|minie|miną|wygasa|wygasają|wygaśnie|wygasną|będzie|będą)(?!\p{L})/u;
// Przecinek tuż po „urodzeniu dziecka” i sama data w osobnym wtrąceniu, po którym zdanie
// biegnie dalej („Po urodzeniu dziecka, w dniu 1 września 2026 r., wejdą …”): wtrącenie należy do
// orzeczenia za nim, a nie do urodzenia.
const RE_BIRTH_NOUN_COMMA_ONLY_MID = /^,[ \t]*(?:w[ \t]+dniu|dnia|w[ \t]+dn\.|dn\.)[ \t]*$/u;
// Miejsce, godzina albo spójnik tuż za datą opisują dalej samo urodzenie („…, w dniu … r.,
// w Szpitalu Miejskim”, „o godz. 14:30”), więc wtedy wtrącenie nie jest osobne.
const RE_BIRTH_NOUN_SENTENCE_GOES_ON =
  /^[ \t]*(?:(?:r\.|roku)(?!\p{L}))?[ \t]*,?[ \t]*(?!(?:r|ok|godz)\.|(?:roku|w|we|o|około|przez|jako|i|oraz|godzinie)(?!\p{L}))\p{Ll}/u;
// Wyrażenie przyczyny przed rzeczownikiem („z tytułu”, „w związku z”) wiąże datę z samym urodzeniem:
// „w związku z urodzeniem dziecka w dniu … r. przysługuje mi zasiłek” to dzień porodu, nie termin.
const RE_BIRTH_NOUN_CAUSAL_BEFORE =
  /(?:^|[^\p{L}])(?:z[ \t]+tytułu|z[ \t]+okazji|z[ \t]+powodu|z[ \t]+racji|wskutek|na[ \t]+skutek|w[ \t]+następstwie|w[ \t]+wyniku|w[ \t]+związku[ \t]+z|ze[ \t]+względu[ \t]+na|wobec|fakt|faktu|fakcie)[ \t]+$/iu;
// Ciąg wyrazów z wielkiej litery w odstępie i to, co stoi tuż przed nim (miejsce po „w”, patron po „im.”).
const RE_BIRTH_NOUN_CAPS_RUN = /(?<![\p{L}'’\-])\p{Lu}[\p{L}'’\-]*(?:[ \t]+\p{Lu}[\p{L}'’\-]*)*/gu;
const RE_BIRTH_NOUN_PLACE_BEFORE = /(?:^|[^\p{L}])(?:w|we|im\.|św\.)[ \t]+$/u;
// Wyraz z wielkiej litery w odstępie to imię i nazwisko dziecka (pierwszy wyraz ze słownika imion,
// najwyżej trzy wyrazy) albo nazwa miejsca po „w”. Instytucja, rola czy osoba z tytułem („ZUS”,
// „Sąd Rejonowy”, „Pracodawca”, „Pani Anna Nowak”, „Zgłoszenie”) to podmiot innego zdarzenia.
// Nawias z numerem i znacznik („(PESEL …)”, „[…]”) sprawdza już lista dozwolonych tokenów.
function birthNounCapsOk(mid: string): boolean {
  const bare = mid.replace(/\([^()\n]*\)|\[[^\[\]\n]*\]/g, (x) => ' '.repeat(x.length));
  for (const m of bare.matchAll(RE_BIRTH_NOUN_CAPS_RUN)) {
    if (RE_BIRTH_NOUN_PLACE_BEFORE.test(bare.slice(0, m.index))) continue;
    const words = m[0].split(/[ \t]+/);
    const first = words[0].toLowerCase();
    if (words.length > 3 || !(isFirstNameLike(first) || isFirstNameGenitive(first))) return false;
  }
  return true;
}
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
  ctx.text = ctx.text.replace(RE_BIRTH_NOUN, (m, kw: string, mid: string, d: string, offset: number, str: string) => {
    if (mid.length > 160) return m;
    const form = /^\p{L}+/u.exec(kw)?.[0].toLowerCase();
    if (form !== 'urodzenie' && RE_BIRTH_NOUN_BARE_VERB.test(mid)) return m;
    if (!birthNounCapsOk(mid)) return m;
    const before = str.slice(Math.max(str.lastIndexOf('\n', offset - 1) + 1, offset - 80), offset);
    if (form === 'urodzenia' && !RE_BIRTH_NOUN_GEN_GOVERNOR.test(before)) return m;
    if (RE_BIRTH_NOUN_BEFORE_BLOCK.test(before)) return m;
    const after = str.slice(offset + m.length, offset + m.length + 60);
    if (RE_BIRTH_THRESHOLD_AFTER.test(after) || RE_BIRTH_NOUN_THRESHOLD_AFTER.test(after)) return m;
    if (RE_BIRTH_NOUN_PAST_VERB_AFTER.test(after)) return m;
    // Termin w czasie teraźniejszym lub przyszłym i osobne wtrącenie liczą się tylko przy okoliczniku
    // czasu („Po urodzeniu dziecka, …”); po wyrażeniu przyczyny data należy do samego urodzenia.
    if (!RE_BIRTH_NOUN_CAUSAL_BEFORE.test(before)) {
      if (RE_BIRTH_NOUN_PRESENT_VERB_AFTER.test(after)) return m;
      if (form === 'urodzeniu' && RE_BIRTH_NOUN_COMMA_ONLY_MID.test(mid) && RE_BIRTH_NOUN_SENTENCE_GOES_ON.test(after)) return m;
    }
    const year = /(\d{4})$/.exec(d)?.[1];
    if (year && +year < 1900) return m;
    return `${kw}${mid}${ctx.hit('DATA-UR')}`;
  });
  maskAfterLabel(ctx, RE_BIRTH_COMBO_CITY_FIRST, 'DATA-UR');
  maskAfterLabel(ctx, RE_BIRTH_UR_NODOT, 'DATA-UR');
}
