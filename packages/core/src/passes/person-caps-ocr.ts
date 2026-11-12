import { HOMOGRAPH_SURNAMES, NON_SURNAME_ADJ, homographBase, isGeoAdjective, looksLikeSurname, normalizeSurnameKey, surnameBase } from '../surnames.js';
import { CAP_WORD, escapeRe, NM_BOUND, PL_LO, PL_UP } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { isFirstNameGenitive, isFirstNameLike, isMaleFirstNameGenitive, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { egoNameGenitive, precededByPatron, precededByStreetEponym } from '../guards/eponyms.js';
import { HOMOGRAPH_PAIR_EXCL, institutionBeforeAddr, ORG_HEAD_WORDS, PATRON_GEN_HEADS, RE_CAPS_WORK_HEAD, RE_PUBLIC_FACILITY_WORD } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { isConfirmedSurname } from './forms.js';
import { RE_SURNAME_OBLIQUE } from '../person-patterns.js';


// Tytuły/role, po których (WERSALIKAMI) stoi imię/nazwisko. Baza: TITLE_WORDS + ROLE_WORDS;
// dopełnione o „Pan" w narzędniku/l.mn. (TITLE_WORDS ma tylko mianownik/wołacz) i skróty sędziowskie.
const ALLCAPS_TITLES = new Set<string>([
  ...TITLE_WORDS,
  ...ROLE_WORDS,
  'panem', 'panów', 'panom', 'panami', 'paniom',
  'sso', 'ssr', 'ssa', 'mec', 'adw',
]);

// (c2b) TYTUŁ/ROLA + IMIĘ/NAZWISKO — wszystko WERSALIKAMI („SSO JAN KOWALSKI",
// „PANEM MARKIEM WIŚNIEWSKIM", „PAN KOWALSKI"). Zapis Titlecase obsługują wyzwalacze/pary; tu
// domykamy WERSALIKI, których reguły Titlecase nie łapią, a `passPersonOcrPair` odrzuca (pierwszy
// token to tytuł). Precyzja: wymagany ROZPOZNANY tytuł + nazwisko POTWIERDZONE słownikiem/morfologią
// i NIE będące encją prawną/rolą ani przymiotnikiem odmiejscowym — dzięki temu nagłówki instytucji
// WERSALIKAMI („SĄD OKRĘGOWY…", „UNIWERSYTET WARSZAWSKI") zostają nietknięte. Uruchamiane PRZED
// passPersonOcrPair, żeby ten nie sparował zachłannie „tytuł + imię" i nie osierocił nazwiska.
export function passPersonOcrTitle(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const UPW = `[${PL_UP}]{2,}`;
  const NAMEW = `[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?`;
  const confirmedSurname = (l: string): boolean =>
    !!surnameBase(l) ||
    looksLikeSurname(l) ||
    (l.includes('-') && l.split('-').some((p) => !!surnameBase(p) || looksLikeSurname(p)));
  ctx.text = ctx.text.replace(
    new RegExp(
      `(?<![${PL_UP}${PL_LO}0-9.\\-])(${UPW})([ \\t]+)(${NAMEW}(?:[ \\t]+${NAMEW})?)(?![${PL_UP}${PL_LO}0-9\\-])`,
      'g',
    ),
    (m, title: string, sep: string, name: string, offset: number) => {
      if (!ALLCAPS_TITLES.has(title.toLowerCase())) return m;
      if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
      const nameWords = name.split(/[ \t]+/);
      // żaden człon nazwy nie może być rolą/tytułem/encją prawną (chroni „PREZES ZARZĄDU SPÓŁKI")
      if (
        nameWords.some((w) => {
          const l = w.toLowerCase();
          return LEGAL_ENTITY_WORDS.has(l) || ROLE_WORDS.has(l) || TITLE_WORDS.has(l);
        })
      )
        return m;
      const last = nameWords[nameWords.length - 1];
      const ll = last.toLowerCase();
      if (NON_SURNAME_ADJ.has(ll)) return m; // „WOJEWODA MAZOWIECKI" — przymiotnik odmiejscowy, nie nazwisko
      // Nazwisko MUSI być potwierdzone (chroni nagłówki instytucji). Homograf („DŁUŻNIK JERZY PIĄTEK",
      // „ŚWIADEK EWA MAJ") po roli i imieniu w mianowniku też jest nazwiskiem: dawniej zostawał jawny,
      // choć ta sama osoba w dopełniaczu („DŁUŻNIKA JERZEGO PIĄTKA") dostawała maskę.
      const homographAfterGiven =
        nameWords.length === 2 && POLISH_FIRST_NAMES.has(nameWords[0].toLowerCase()) && !isFirstNameLike(ll) && !!homographBase(ll);
      if (!confirmedSurname(ll) && !homographAfterGiven) return m;
      ctx.bump('IMIE');
      return `${title}${sep}${ctx.personMask(last)}`;
    },
  );
}
/** Imię + nazwisko-homograf („MAREK DUDA", „MARCINA WRÓBLA") — forma bazowa homografu albo null.
 *  Imię ze słownika (w dowolnym przypadku) i homograf, który sam nie jest imieniem. */
function homographPairBase(n1: string, n2: string): string | null {
  if (!isFirstNameLike(n1) || NOUN_LIKE_FIRST_NAMES.has(n1) || nounLikeNameForm(n1) || isFirstNameLike(n2)) return null;
  const hb = homographBase(n2);
  return hb && !HOMOGRAPH_PAIR_EXCL.has(hb) ? hb : null;
}
// Wyraz uliczny albo „ADRES:" tuż przed parą WERSALIKAMI („ULICA KOŚCIUSZKI TADEUSZA", „OSIEDLE
// KOPERNIKA MIKOŁAJA", „PRZY ALEI …", „ADRES: MICKIEWICZA ADAMA 5") — patron, nie osoba. Regex
// STREET_ANCHOR_SRC zna tylko zapis Titlecase.
// Jeden wyraz pośrodku („IM. IGNACEGO JANA PADEREWSKIEGO", „UL. GEN. JÓZEFA BEMA").
const RE_CAPS_STREET_BEFORE =
  /(?:^|[^\p{L}])(?:ul|al|os|pl|im|gen|ks|św|ulica|ulicy|ulicę|ulicą|aleja|alei|aleje|aleję|osiedle|osiedla|osiedlu|plac|placu|placem|rondo|ronda|rondzie|most|mostu|moście|skwer|skweru|imienia|adres|patron|patrona)[.:]?[ \t]+(?:\p{Lu}{2,}\.?[ \t]+)?$/iu;
const capsStreetBefore = (t: string, offset: number): boolean => RE_CAPS_STREET_BEFORE.test(t.slice(Math.max(0, offset - 32), offset));
// Wyraz WERSALIKAMI tuż przed parą w dopełniaczu („UNIWERSYTET ADAMA MICKIEWICZA", „STADION KAZIMIERZA
// GÓRSKIEGO", „AKADEMIA WYCHOWANIA FIZYCZNEGO JÓZEFA PIŁSUDSKIEGO") — nazwa z patronem. Tytuł albo
// rola przed nią („PANEM PIOTREM WILKIEM") i etykieta z dwukropkiem („PRZELEW OD: KATARZYNY SIKORY")
// to dalej osoba.
const RE_CAPS_WORD_BEFORE = /(?:^|[^\p{L}])(\p{Lu}{2,})[ \t]+$/u;
// Przyimek albo rzeczownik-rola/dokument w dopełniaczu przed parą to nie nazwa obiektu z patronem:
// „ALIMENTY DLA ZUZANNY WOLSKIEJ", „CZYNSZ OD ANNY KOWALSKIEJ", „KARTA PACJENTA ANNY KOWALSKIEJ",
// „ŚWIADECTWO PRACY ADAMA NOWAKA" — osoba. Celowo krótka lista (bez wyrazów instytucji): nazwy
// obiektów („ZESPÓŁ SZKÓŁ JANA KOWALSKIEGO", „CHOROBA STANISŁAWA LEŚNIOWSKIEGO") dalej chronią.
// Rola procesowa albo strona umowy w dopełniaczu i celowniku („WEZWANIE ŚWIADKA ANNY KOWALSKIEJ",
// „W OBECNOŚCI DŁUŻNIKA JANA NOWAKA", „APELACJA OSKARŻONEGO …", „DORĘCZYĆ POZWANEMU …") — za nią
// stoi osoba, nie patron obiektu. ALLCAPS_TITLES zna tylko mianownik tych ról, więc para była
// brana za nazwę z patronem i zostawała jawna. Bez „brata/syna/siostry" („SCHRONISKO BRATA
// ALBERTA CHMIELOWSKIEGO" to patron).
export const CAPS_ROLE_OBLIQUE = new Set(
  (
    'świadka świadkowi powoda powodowi powódki powódce pozwanego pozwanej pozwanemu ' +
    'oskarżonego oskarżonej oskarżonemu obwinionego obwinionej obwinionemu podejrzanego podejrzanej podejrzanemu ' +
    'pokrzywdzonego pokrzywdzonej pokrzywdzonemu poszkodowanego poszkodowanej uczestnika uczestniczki uczestnikowi ' +
    'obrońcy pełnomocnika pełnomocnikowi dłużnika dłużniczki dłużnikowi wierzyciela wierzycielki wierzycielowi ' +
    'skazanego skazanej skazanemu nieletniego nieletniej małoletniego małoletniej spadkodawcy spadkodawczyni ' +
    'spadkobiercy spadkobierczyni biegłego biegłej najemcy najemczyni wynajmującego kupującego sprzedającego ' +
    'darczyńcy obdarowanego obdarowanej zainteresowanego zainteresowanej wnioskodawczyni ' +
    'właściciela właścicielki współwłaściciela współwłaścicielki lokatora lokatorki ' +
    'matki ojca żony męża'
  ).split(' '),
);
const CAPS_HEAD_NOT_NAME = new Set([
  ...(
    'dla od do przez za przy ze na we po wobec przeciwko oraz ' +
    'pacjenta pacjentki pracy choroby przesłuchania pracownika pracownicy ucznia uczennicy klienta klientki ' +
    'ubezpieczonego ubezpieczonej zmarłego zmarłej osoby dziecka wnioskodawcy ' +
    // „PRZY UDZIALE/POMOCY/ASYŚCIE/OBECNOŚCI JANA NOWAKA" — czynność z udziałem osoby (protokół
    // zajęcia, oględzin), nie nazwa obiektu z patronem
    'udziale udziałem współudziale pomocy asyście obecności ' +
    // grafik i ogłoszenie („W PONIEDZIAŁEK URLOP JANA NOWAKA", „DZIŚ DYŻUR ANNY KOWALSKIEJ", „W PIĄTEK
    // GABINET ANNY KOWALSKIEJ NIECZYNNY", „W SOBOTĘ KIOSK JANA NOWAKA 12") — rzecz albo czynność
    // konkretnej osoby, nie nazwa obiektu z patronem
    'urlop urlopu urlopie dyżur dyżuru dyżurze zastępstwo zastępstwa zastępstwie gabinet gabinetu gabinecie ' +
    'kiosk kiosku stoisko stoiska warsztat warsztatu wizyta wizyty wizycie zwolnienie zwolnienia nieobecność nieobecności'
  ).split(' '),
  ...CAPS_ROLE_OBLIQUE,
]);
/** Czy tuż przed parą WERSALIKAMI stoi rola w przypadku zależnym (patrz CAPS_ROLE_OBLIQUE)? */
const capsRoleObliqueBefore = (t: string, offset: number): boolean => {
  const w = RE_CAPS_WORD_BEFORE.exec(t.slice(Math.max(0, offset - 30), offset))?.[1];
  return !!w && CAPS_ROLE_OBLIQUE.has(w.toLowerCase());
};
// Rzeczownik dokumentu przed przymiotnikiem i parą („AKTA OSOBOWE ANNY KOWALSKIEJ", „DOKUMENTACJA
// MEDYCZNA …", „WNIOSEK URLOPOWY JANA NOWAKA") — akta osoby, nie nazwa z patronem jak „SZKOŁA
// PODSTAWOWA JANA KOCHANOWSKIEGO".
// Rzeczownik dokumentu może stać też przed dopełniaczem albo dłuższym ciągiem („AKTA SPRAWY …",
// „UMOWA NAJMU …", „KARTA INFORMACYJNA LECZENIA SZPITALNEGO …", „AKT NOTARIALNY …") — liczy się
// cały ciąg wersalików przed parą, chyba że między dokumentem a parą stoi głowa instytucji
// („HISTORIA SZKOŁY JANA KOCHANOWSKIEGO" to dalej szkoła z patronem).
const CAPS_DOC_NOUNS = new Set(
  (
    'akta akt dane teczka dokumentacja wniosek karta ocena zaświadczenie opinia historia skierowanie świadectwo orzeczenie umowa informacja ankieta książeczka kartoteka ' +
    'archiwum stypendium testament pełnomocnictwo protokół notatka oświadczenie zeznanie polisa legitymacja życiorys ' +
    // pisma kadrowe i zestawienia osoby („WYPOWIEDZENIE UMOWY JANA KOWALSKIEGO", „LISTA PŁAC JANA NOWAKA",
    // „LIST MOTYWACYJNY JANA NOWAKA")
    'wypowiedzenie lista list podanie skarga deklaracja zgłoszenie wezwanie zawiadomienie kwestionariusz rozliczenie aneks'
  ).split(' '),
);
// Przymiotnik prywatności w nazwie („FUNDACJA RODZINNA JANA NOWAKA", „ARCHIWUM PRYWATNE …",
// „NAGRODA SPECJALNA …", „DOKUMENTACJA PRACOWNICZA …") — rzecz konkretnej osoby, nie patron.
const RE_CAPS_PRIVATE_ADJ = /^(?:RODZINN|PRYWATN|OSOBIST|SPECJALN|INDYWIDUALN|PRACOWNICZ|NOTARIALN|SPADKOW)\p{Lu}*$/u;
// Do czterech wyrazów WERSALIKAMI tuż przed parą (ta sama linia).
const RE_CAPS_RUN_BEFORE = /(?:^|[^\p{L}])((?:\p{Lu}{2,}[ \t]+){1,4})$/u;
// Rzeczownik, nie przymiotnik od niego („SZPITALNEGO" w „KARTA INFORMACYJNA LECZENIA SZPITALNEGO").
export const capsOrgHead = (w: string): boolean =>
  ORG_HEAD_WORDS.has(w) ||
  PATRON_GEN_HEADS.has(w) ||
  (/^(?:szkoł|zespoł|zespół|uniwersyt|akademi|instytut|fundacj|stowarzysz|towarzystw|klub|teatr|muze|stadion|parafi|kości|szpital|liceum|gimnazj|przedszkol|bibliotek|galeri|ośrod|centrum)/.test(w) &&
    !/(?:n|sk|ck|ow)(?:y|a|e|i|ego|iego|ej|iej|ym|ych|emu|ą)$/.test(w));
/** Czy ciąg wersalików przed parą to dokument albo rzecz konkretnej osoby (patrz CAPS_DOC_NOUNS)? */
function capsDocRunBefore(before: string): boolean {
  const run = RE_CAPS_RUN_BEFORE.exec(before.slice(-60))?.[1];
  if (!run) return false;
  const ws = run.trim().split(/[ \t]+/);
  for (let i = ws.length - 1; i >= 0; i--) {
    const l = ws[i].toLowerCase();
    if (i > 0 && RE_CAPS_PRIVATE_ADJ.test(ws[i])) return true;
    if (CAPS_DOC_NOUNS.has(l)) return true;
    if (capsOrgHead(l)) return false;
  }
  return false;
}
// Nazwa drogi albo odcinka w nagłówku WERSALIKAMI („REMONT DROGI OD ADAMA MICKIEWICZA DO TADEUSZA
// KOŚCIUSZKI", „TRASA ROWEROWA OD …").
const RE_CAPS_ROUTE_HEAD = /(?<!\p{L})(?:DROG|TRAS|ODCIN|ŚCIEŻK|CHODNIK|JEZDNI|ULIC|KANALIZACJ|WODOCIĄG|OBJAZD|LINI)\p{Lu}*(?!\p{L})/u;
/**
 * Czy wyraz WERSALIKAMI tuż przed parą w dopełniaczu to głowa nazwy z patronem? Przyimek i rola
 * w dopełniaczu wskazują osobę (patrz CAPS_HEAD_NOT_NAME), z wyjątkiem ulicy z patronem bez „UL.":
 * „PRZY" z dopełniaczem albo odcinek drogi „OD … DO …". `end` — koniec pary, `n1` — jej pierwszy
 * wyraz małymi literami.
 * Numer domu za parą („NAJEMCA LOKALU ADAMA MICKIEWICZA 30/2.", „DOM PRZY STANISŁAWA WYSPIAŃSKIEGO
 * 5.", „PRZELEW DO: JAN NOWAK HENRYKA SIENKIEWICZA 12") rozstrzyga patronStreetWithNumber: [ADRES]
 * przy pewnej kotwicy, a para, z której adres nie powstał, zostaje osobą — wyraz przed nią nie
 * zdejmuje już maski. Wyjątek: prawdziwa głowa nazwy instytucji albo obiektu („SZKOŁA …").
 */
// Liczba w kształcie numeru domu za parą WERSALIKAMI. Rok („TRENY JANA KOCHANOWSKIEGO 1580", „ROK
// ADAMA MICKIEWICZA 2022") i liczebnik przed rzeczownikiem („FRASZKI … 3 KSIĘGI") numerem nie są,
// więc głowa nazwy utworu albo wydarzenia dalej chroni parę przed maską osoby.
// Głowa nazwy obiektu, wydarzenia albo dzieła z patronem WERSALIKAMI (po toLowerCase).
const RE_CAPS_PATRON_OBJECT_HEAD =
  /^(?:aul[aiię]|list|listy|listu|puchar\p{L}*|memoriał\p{L}*|turniej\p{L}*|nagrod\p{L}*|stypendi\p{L}*|wystaw\p{L}*|biografi\p{L}*|twórczoś\p{L}*|wykład\p{L}*|pomnik\p{L}*|popiers\p{L}*|tablic\p{L}*|rond\p{L}*|skwer\p{L}*|park\p{L}*|kopiec|kopca)$/u;
// Dzień tygodnia albo „DZIŚ/JUTRO" w wierszu ogłoszenia WERSALIKAMI.
const RE_CAPS_SCHEDULE_DAY =
  /(?<!\p{L})(?:PONIEDZIAŁ\p{Lu}*|WTOR\p{Lu}*|ŚROD\p{Lu}*|CZWART\p{Lu}*|PIĄT\p{Lu}*|SOBOT\p{Lu}*|NIEDZIEL\p{Lu}*|DZIŚ|DZISIAJ|JUTRO)(?!\p{L})/u;
// Liczba za parą bez warunku na wyraz za nią („SALA JANA NOWAKA 12 KRAKÓW"); rok, wynik i procent nie.
const RE_CAPS_NUMBER_AFTER = /^[ \t]+(?!(?:1\d|20)\d{2}(?!\d))\d{1,4}[A-Za-z]?(?![\p{L}\d])(?![ \t]*[:%]|\/(?:19|20)\d\d(?!\d))/u;
const RE_CAPS_HOUSE_NO_AFTER =
  /^[ \t]+(?!(?:1\d|20)\d{2}(?!\d))\d{1,4}[A-Za-z]?(?![\p{L}\d])(?![ \t]*[:%]|\/(?:19|20)\d\d(?!\d))(?![ \t]+(?!(?:W|WE|I|M|LOK|NR)(?!\p{L}))\p{Lu}{2,})/u;
function capsNameHeadBefore(t: string, offset: number, end?: number, n1?: string): boolean {
  const before = t.slice(Math.max(0, offset - 60), offset);
  const w = RE_CAPS_WORD_BEFORE.exec(before.slice(-30))?.[1];
  if (!w) return false;
  const wl = w.toLowerCase();
  if (ALLCAPS_TITLES.has(wl)) return false;
  // Dokument przed postacią historyczną („LIST ADAMA MICKIEWICZA DO JOACHIMA LELEWELA") to dzieło
  // albo odsyłacz, jak w v0.46.23 — nie dokument strony pisma.
  if (capsDocRunBefore(before) && !(/^list(?:y|u|ów)?$/.test(wl) && historicGenPairAt(t, offset))) return false;
  if (end === undefined) return !CAPS_HEAD_NOT_NAME.has(wl);
  const after = t.slice(end, end + 40);
  // „SALA GIMNASTYCZNA PRZY ADAMA MICKIEWICZA 5", „OŚRODEK ZDROWIA PRZY …" — obiekt publiczny przy
  // ulicy z patronem: adres obiektu, nie osoba ani adres osoby
  if (wl === 'przy' && institutionBeforeAddr(before.slice(before.lastIndexOf('\n') + 1).replace(/[ \t]*PRZY[ \t]*$/u, ''))) return true;
  // Tytuł utworu z numerem („TRENY JANA KOCHANOWSKIEGO 19", „DZIADY ADAMA MICKIEWICZA 3 W REŻYSERII",
  // „BALLADY … 5 I 6") — numer utworu albo części, nie numer domu; autor to nie strona pisma.
  if (RE_CAPS_WORK_HEAD.test(wl)) return true;
  // Sala, aula, obiekt, puchar, list albo inne dzieło z patronem („SALA ADAMA MICKIEWICZA 12", „AULA
  // JANA KOCHANOWSKIEGO 3", „MECZ O PUCHAR JANA NOWAKA 3:1", „LIST ADAMA MICKIEWICZA DO …") — nazwa
  // obiektu albo odsyłacz, jak w v0.46.23.
  // Sala albo obiekt z numerem za parą, która nie jest postacią historyczną, w ogłoszeniu z dniem
  // tygodnia („W SOBOTĘ SALA JANA NOWAKA 12 KRAKÓW", „ZEBRANIE W SOBOTĘ: SALA JANA NOWAKA 12") albo
  // z miejscowością za numerem (kształt adresu) — osoba prywatna, jak w v0.46.23. Sama nazwa obiektu
  // („SALA ADAMA NOWAKA 12", „STADION KAZIMIERZA GÓRSKIEGO 15 TYS. MIEJSC") i postać historyczna
  // („SALA ADAMA MICKIEWICZA 12", „AULA JANA KOCHANOWSKIEGO 3") dalej chronią; wynik „3:1" to nie numer.
  if (
    (RE_CAPS_PATRON_OBJECT_HEAD.test(wl) || RE_PUBLIC_FACILITY_WORD.test(wl)) &&
    RE_CAPS_NUMBER_AFTER.test(after) &&
    !historicGenPairAt(t, offset)
  ) {
    const line = before.slice(before.lastIndexOf('\n') + 1);
    const city = /^[ \t]+\d{1,4}[A-Za-z]?[ \t]*,?[ \t]+(\p{Lu}{2,})(?!\p{L})/u.exec(after)?.[1];
    if (RE_CAPS_SCHEDULE_DAY.test(line) || (!!city && POLISH_CITIES.has(city.toLowerCase()))) return false;
  }
  if (RE_CAPS_PATRON_OBJECT_HEAD.test(wl) || RE_PUBLIC_FACILITY_WORD.test(wl) || PATRON_GEN_HEADS.has(wl)) return true;
  // (przyimek albo rola przed parą: każda liczba, jak dotąd — „DZIAŁAJĄC PRZY ADAMA NOWAKA 5 RAZY")
  if ((CAPS_HEAD_NOT_NAME.has(wl) ? /^[ \t]+\d/ : RE_CAPS_HOUSE_NO_AFTER).test(after) && !capsOrgHead(wl)) return false;
  if (!CAPS_HEAD_NOT_NAME.has(wl)) return true;
  if (!n1 || !isFirstNameGenitive(n1) || !/^(?:przy|od|do)$/.test(wl)) return false;
  // „PRZY ADAMA MICKIEWICZA" (bez numeru) to ulica
  if (wl === 'przy') return true;
  const line = before.slice(before.lastIndexOf('\n') + 1);
  if (!RE_CAPS_ROUTE_HEAD.test(line)) return false;
  if (wl === 'od') {
    const to = /^[ \t]+DO[ \t]+(\p{Lu}{2,})[ \t]+\p{Lu}{2,}/u.exec(after);
    return !!to && isFirstNameGenitive(to[1].toLowerCase());
  }
  return /(?<!\p{L})OD[ \t]+\p{Lu}{2,}(?:[ \t]+\p{Lu}{2,}){1,3}[ \t]+DO[ \t]+$/u.test(line);
}
// Dopełniacz nazwiska postaci historycznej („MICKIEWICZA", „KOCHANOWSKIEGO", „KONOPNICKIEJ",
// „KOŚCIUSZKI") — patrz HISTORIC_SURNAMES.
const HISTORIC_SURNAMES_GEN = new Set<string>(
  [...'jagiełło matejko sobieski kopernik chopin skłodowska piłsudski mickiewicz słowacki kościuszko moniuszko sienkiewicz konopnicka wyspiański paderewski kochanowski norwid żeromski reymont szymanowski wieniawski lutosławski fredro krasicki orzeszkowa'.split(' ')].map((s) =>
    /ki$/.test(s) ? `${s}ego` : /ka$/.test(s) ? `${s.slice(0, -1)}iej` : /o$/.test(s) ? `${s.slice(0, -1)}i` : `${s}a`,
  ),
);
/** Czy od `offset` stoi para „IMIĘ NAZWISKO" w dopełniaczu postaci historycznej? */
function historicGenPairAt(t: string, offset: number): boolean {
  const p = /^(\p{L}+)[ \t]+(\p{L}+)/u.exec(t.slice(offset, offset + 50));
  return !!p && isFirstNameGenitive(p[1].toLowerCase()) && HISTORIC_SURNAMES_GEN.has(p[2].toLowerCase());
}
/** Przypadek zależny imienia WERSALIKAMI (nie mianownik ze słownika). */
const capsObliqueFirst = (n: string): boolean => !POLISH_FIRST_NAMES.has(n) || isFirstNameGenitive(n);
// Imię w formie wyrazu pospolitego od imion-rzeczowników („POLE KOT" — pole, nie wołacz Poli).
const nounLikeNameForm = (n: string): boolean =>
  [...NOUN_LIKE_FIRST_NAMES].some((x) => n !== x && n.startsWith(x.slice(0, -1)) && n.length <= x.length + 1);
// Postacie historyczne w szyku „NAZWISKO IMIĘ" (spisy, hasła, nazwy) — nie strona pisma.
const HISTORIC_SURNAMES = new Set<string>(
  (
    'jagiełło matejko sobieski kopernik chopin skłodowska piłsudski mickiewicz słowacki kościuszko moniuszko sienkiewicz konopnicka wyspiański paderewski kochanowski norwid żeromski reymont ' +
    'szymanowski wieniawski lutosławski fredro krasicki orzeszkowa'
  ).split(' '),
);
// Etykieta osoby albo numer wpisu tuż przed nazwiskiem („Pacjent: ", „Wnioskodawca: ", „1. ") —
// kotwica dla nazwiska rozpoznanego tylko morfologią albo będącego homografem w szyku odwróconym.
// Etykieta także w środku wiersza po końcu zdania („… nie oponuje. Pacjent: Wilk Jadwiga").
const RE_PERSON_SLOT_BEFORE = /(?:^|\n|[.;!?][ \t]+)[ \t]*(?:\d{1,3}[.)][ \t]*|\p{L}{2,20}(?:[ \t]\p{L}{2,20})?[ \t]*:[ \t]*)$/u;
export const personSlotBefore = (t: string, offset: number): boolean => RE_PERSON_SLOT_BEFORE.test(t.slice(Math.max(0, offset - 45), offset));
// Głowy, po których imię w mianowniku to nie szyk odwrócony, tylko tytuł władcy albo świętego
// („KRÓL JAN III SOBIESKI", „ŚWIĘTY JAN").
export const CAPS_REVERSED_HEAD_EXCL = new Set<string>('król królowa książę księżna cesarz papież święty święta'.split(' '));
/**
 * Szyk odwrócony WERSALIKAMI („KOWALSKI JAN", „NOWAK PIOTR, WÓJCIK MARIA", „POZWANY NOWAK PIOTR").
 * Imię w mianowniku ze słownika; nazwisko ze słownika od razu, a z samej morfologii albo homograf
 * tylko na miejscu osoby (etykieta, numer wpisu). Patron ulicy w dopełniaczu („MICKIEWICZA ADAMA"),
 * przymiotnik odmiejscowy, homograf kalendarzowy i liczba rzymska za imieniem odpadają.
 */
function capsReversedPair(t: string, offset: number, n1: string, n2: string, end: number): boolean {
  if (!POLISH_FIRST_NAMES.has(n2) || isMaleFirstNameGenitive(n2) || NOUN_LIKE_FIRST_NAMES.has(n2)) return false;
  if (isFirstNameLike(n1) || CAPS_REVERSED_HEAD_EXCL.has(n1) || HOMOGRAPH_PAIR_EXCL.has(n1) || HISTORIC_SURNAMES.has(n1)) return false;
  const parts = n1.split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || isGeoAdjective(p) || RE_SURNAME_OBLIQUE.test(p))) return false;
  if (/^[ \t]+[IVX]{1,4}(?![\p{L}\p{N}])/u.test(t.slice(end, end + 8))) return false;
  if (capsStreetBefore(t, offset)) return false;
  if (parts.every((p) => !!surnameBase(p))) return true;
  return parts.every((p) => !!surnameBase(p) || looksLikeSurname(p) || !!homographBase(p)) && personSlotBefore(t, offset);
}

/** Nazwisko WERSALIKAMI potwierdzone słownikiem albo morfologią (każdy człon dwuczłonowego). */
function capsSurnameConfirmed(l: string): boolean {
  const parts = l.split('-');
  if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || isGeoAdjective(p))) return false;
  return parts.every((p) => !!surnameBase(p) || looksLikeSurname(p));
}
// Imię w Titlecase obok nazwiska WERSALIKAMI („Anna KOWALSKA", „KOWALSKA Anna") — zapis kart
// pacjenta, list i pism z systemów dziedzinowych.
const RE_MIXED_FIRST_CAPS = new RegExp(`(?<![${NM_BOUND}-])([${PL_UP}][${PL_LO}]+)([ \\t]+)([${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)(?![${PL_UP}${PL_LO}0-9-])`, 'g');
const RE_MIXED_CAPS_FIRST = new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])([${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)([ \\t]+)([${PL_UP}][${PL_LO}]+)(?![${NM_BOUND}-])`, 'g');
// Tytuł grzecznościowy w Titlecase przed nazwiskiem WERSALIKAMI („Pan KOWALSKI", „Panu KOWALSKIEMU",
// „Pani ELŻBIECIE NOWICKIEJ", „Szanowny Panie KOWALSKI"). Osobny przebieg zamiast alternatywy
// w tytułach WERSALIKAMI: tam „Pani SĘDZIA NOWAK" traciłoby rolę.
const RE_MIXED_TITLE_CAPS = new RegExp(
  `(?<![${NM_BOUND}])(Pan|Pani|Pana|Panu|Panem|Panią|Panie)([ \\t]+)((?:[${PL_UP}]{2,}[ \\t]+)?[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)(?![${PL_UP}${PL_LO}0-9-])`,
  'g',
);
/**
 * (c0) ZAPIS MIESZANY: imię Titlecase + nazwisko WERSALIKAMI w dowolnym szyku oraz tytuł grzecznościowy
 * przed nazwiskiem WERSALIKAMI. Reguły Titlecase nie widzą wersalików, a reguły WERSALIKÓW — imienia
 * w Titlecase, więc „Pani Anna KOWALSKA" dawało „Pani [..] KOWALSKA" (fragment), a „Pacjent:
 * KOWALSKA Anna" zostawało jawne. Nazwisko musi być potwierdzone (słownik, morfologia), imię ze
 * słownika — „Wojewoda MAZOWIECKI", „Szpital BIELAŃSKI", „Fiat PANDA" zostają.
 */
export function passPersonMixedCase(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_MIXED_TITLE_CAPS, (m, kw: string, sep: string, name: string, offset: number, t: string) => {
    const ws = name.split(/([ \t]+)/);
    const last = ws[ws.length - 1];
    const ll = last.toLowerCase();
    if (!capsSurnameConfirmed(ll) || ROLE_WORDS.has(ll) || TITLE_WORDS.has(ll)) return m;
    if (precededByPatron(t, offset) || capsStreetBefore(t, offset)) return m;
    let keep = '';
    if (ws.length === 3) {
      const fl = ws[0].toLowerCase();
      if (ROLE_WORDS.has(fl)) keep = ws[0] + ws[1]; // „Pani SĘDZIA NOWAK" — rola zostaje
      else if (!isFirstNameLike(fl)) return m;
    }
    ctx.bump('IMIE');
    return `${kw}${sep}${keep}${ctx.personMask(last)}`;
  });
  ctx.text = ctx.text.replace(RE_MIXED_FIRST_CAPS, (m, w1: string, _sep: string, w2: string, offset: number, t: string) => {
    const w1l = w1.toLowerCase();
    const w2l = w2.toLowerCase();
    // imię w mianowniku: „Pomnik Adama MICKIEWICZA" (dopełniacz) to patron
    if (!POLISH_FIRST_NAMES.has(w1l) || isFirstNameGenitive(w1l) || LEGAL_ENTITY_WORDS.has(w1l) || ROLE_WORDS.has(w1l) || TITLE_WORDS.has(w1l) || NOUN_LIKE_FIRST_NAMES.has(w1l)) return m;
    // postać historyczna w spisie lektur czy programie koncertu („Henryk SIENKIEWICZ", „Jan MATEJKO")
    // — jak w szyku odwróconym WERSALIKAMI
    if (isFirstNameLike(w2l) || !capsSurnameConfirmed(w2l) || HISTORIC_SURNAMES.has(w2l)) return m;
    if (precededByPatron(t, offset) || precededByStreetEponym(t, offset) || capsStreetBefore(t, offset)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w2);
  });
  ctx.text = ctx.text.replace(RE_MIXED_CAPS_FIRST, (m, w1: string, _sep: string, w2: string, offset: number, t: string) => {
    const w1l = w1.toLowerCase();
    const w2l = w2.toLowerCase();
    if (!POLISH_FIRST_NAMES.has(w2l) || isMaleFirstNameGenitive(w2l) || NOUN_LIKE_FIRST_NAMES.has(w2l)) return m;
    if (isFirstNameLike(w1l) || ROLE_WORDS.has(w1l) || TITLE_WORDS.has(w1l) || CAPS_REVERSED_HEAD_EXCL.has(w1l) || HISTORIC_SURNAMES.has(w1l)) return m;
    if (w1l.split('-').some((p) => RE_SURNAME_OBLIQUE.test(p)) || !capsSurnameConfirmed(w1l)) return m;
    // sama morfologia: tylko na miejscu osoby („Pacjent: KOWALSKA Anna", „1. NOWAK Piotr")
    if (!w1l.split('-').every((p) => !!surnameBase(p)) && !personSlotBefore(t, offset)) return m;
    if (capsStreetBefore(t, offset) || precededByPatron(t, offset)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(w1);
  });
}

// (c6) IMIONA RODZICÓW za zamaskowaną osobą: „[..], syn Józefa i Marii", „[..], córka JANA, MARII",
// „[..] s. Stanisława i Haliny". Formuła z aktów, odpisów KW i wyroków karnych; imiona rodziców
// zostawały jawne obok maski, a razem z datą i miejscem urodzenia identyfikują osobę. Tylko tuż za
// maską osoby, imiona ze słownika; po skrócie „s."/„c." wymagane oba imiona („[..], s. 15 protokołu").
const RE_PARENTS_AFTER_MASK = new RegExp(
  `(\\[OSOBA-[A-Z]+\\]|\\[IMIĘ I NAZWISKO\\])(,?[ \\t]+)(syn(?:a|owi|em)?|córk(?:a|i|ą|ę)|SYN|CÓRKA|s\\.|c\\.)([ \\t]+)` +
    `([${PL_UP}][${PL_UP}${PL_LO}]+)(?:([ \\t]+)([${PL_UP}][${PL_UP}${PL_LO}]+))?` +
    `(?:((?:[ \\t]+i|,)[ \\t]+)([${PL_UP}][${PL_UP}${PL_LO}]+)(?:([ \\t]+)([${PL_UP}][${PL_UP}${PL_LO}]+))?)?(?![${NM_BOUND}])`,
  'g',
);
export function passPersonParents(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    RE_PARENTS_AFTER_MASK,
    (
      m,
      mask: string,
      sep: string,
      kin: string,
      sp: string,
      a: string,
      sp2: string | undefined,
      a2: string | undefined,
      mid: string | undefined,
      b: string | undefined,
      spb: string | undefined,
      b2: string | undefined,
    ) => {
      const abbr = kin.endsWith('.');
      const head = mask.length + sep.length + kin.length + sp.length;
      // Drugie imię rodzica („córka Piotra Pawła i Anny Marii", „syn Jana Pawła i Marii") należy do
      // tej samej maski: dawniej imię ojca dostawało dwie maski obok siebie, a para „Pawła i Anny"
      // trafiała do innego przebiegu i w trybie pseudonimów ojciec z matką dostawali wspólny znacznik.
      // Wyraz spoza imion za pierwszym imieniem („syn Jana Kowalskiego") zostaje jak dawniej: maska
      // tylko na imieniu, reszta bez zmian.
      if (a2 !== undefined && !isFirstNameLike(a2)) {
        if (abbr || !isFirstNameLike(a)) return m;
        ctx.bump('IMIE');
        return `${mask}${sep}${kin}${sp}${ctx.M.IMIE}${m.slice(head + a.length)}`;
      }
      const father = a + (a2 !== undefined ? `${sp2}${a2}` : '');
      // drugi wyraz matki spoza imion („i Marii Kowalskiej") zostaje dla dalszych przebiegów
      const motherTail = b2 !== undefined && !isFirstNameLike(b2) ? `${spb}${b2}` : '';
      // Imię matki spoza słownika w dopełniaczu po „i" („córka Henryka i Marianny", „syn Jana
      // i Leokadii") — para imion rodziców w całości: dawniej maska obejmowała tylko ojca, a matka
      // zostawała jawna obok rozpoznanej danej.
      const motherGen =
        b !== undefined && /^[ \t]+i[ \t]+$/.test(mid ?? '') && /^\p{Lu}\p{Ll}+[iy]$/u.test(b) && !surnameBase(b) && !looksLikeSurname(b);
      if (!isFirstNameLike(a) || (b !== undefined && !isFirstNameLike(b) && !motherGen)) {
        // drugi wyraz to nie imię („syn Józefa, Kowalski …") — zostaje jawny, pierwszy rozstrzyga sam
        if (abbr || !isFirstNameLike(a)) return m;
        b = undefined;
      }
      if (abbr && b === undefined) return m;
      ctx.bump('IMIE');
      const tail = b !== undefined ? `${mid}${ctx.M.IMIE}${motherTail}` : m.slice(head + father.length);
      return `${mask}${sep}${kin}${sp}${ctx.M.IMIE}${tail}`;
    },
  );
}

// (c3) OCR/WERSALIKI: „J0AN K0WALSKI", „JAN KOWALSKI" — para tokenów WERSALIKAMI z homoglifami.
// Para w lookahead, a pętla exec: odrzucona para („CZYNSZ JAN", „ORAZ ANNA") zużywa tylko pierwszy
// wyraz, więc imię z niej może otworzyć następną parę („CZYNSZ JAN KOWALSKI" było jawne).
export function passPersonOcrPair(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCRW = `[${PL_UP}][${PL_UP}01]{1,19}`;
  // Nazwisko dwuczłonowe („ANNA NOWAK-KOWALSKA"): dawniej lookahead odrzucał parę przed
  // „-KOWALSKA", żeby nie maskować fragmentu, i całość zostawała jawna. Trzeci człon nadal nie
  // pasuje, więc fragment nie wycieka.
  const re = new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])(${OCRW})(?=([ \\t]+)(${OCRW}(?:-${OCRW})?)(?![${PL_UP}${PL_LO}0-9-]))`, 'g');
  const src = ctx.text;
  const decide = (t1: string, sep: string, t2: string, offset: number): string | null => {
      const m = null;
      const homo1 = /[01]/.test(t1);
      const homo2 = /[01]/.test(t2);
      const allCaps = t1 === t1.toUpperCase() && t2 === t2.toUpperCase();
      if (!homo1 && !homo2 && !allCaps) return m; // zwykłe pary obsłużyły (a)–(c2)
      const norm = (s: string) => s.replace(/0/g, 'o').replace(/1/g, 'l').toLowerCase();
      const n1 = norm(t1);
      const n2 = norm(t2);
      if (LEGAL_ENTITY_WORDS.has(n1) || ROLE_WORDS.has(n1) || TITLE_WORDS.has(n1)) return m;
      if (!homo1 && !homo2) {
        const pairEnd = offset + t1.length + sep.length + t2.length;
        if (capsReversedPair(src, offset, n1, n2, offset + t1.length + sep.length + t2.length)) {
          ctx.bump('IMIE');
          return ctx.personMask(n1);
        }
        // Homograf z listy wyjątków („PIĄTKA", „MAJA") po roli w dopełniaczu i imieniu w dopełniaczu
        // to nazwisko („W OBECNOŚCI DŁUŻNIKA JERZEGO PIĄTKA") — wyjątki chronią grafik („PIĄTEK 3 MAJA").
        const hbRole =
          (isFirstNameGenitive(n1) || egoNameGenitive(n1)) && !isFirstNameLike(n2) && capsRoleObliqueBefore(src, offset) ? homographBase(n2) : null;
        const hb = homographPairBase(n1, n2) ?? hbRole;
        // patron w nazwie WERSALIKAMI: para w dopełniaczu za wyrazem nazwy albo ulicy („UNIWERSYTET
        // ADAMA MICKIEWICZA"); nazwisko w mianowniku („NA ULICY ALEKSANDRA NOWAK") to osoba
        const obliquePair = capsObliqueFirst(n1) && (RE_SURNAME_OBLIQUE.test(n2) || /[aeiyąę]$/.test(n2));
        if (hb && !capsStreetBefore(src, offset) && !precededByPatron(src, offset) && !(obliquePair && capsNameHeadBefore(src, offset, pairEnd, n1))) {
          ctx.bump('IMIE');
          return ctx.personMask(hb);
        }
        if (obliquePair && (capsNameHeadBefore(src, offset, pairEnd, n1) || capsStreetBefore(src, offset))) return m;
      }
      if (LEGAL_ENTITY_WORDS.has(n2) || NON_SURNAME_ADJ.has(n2)) return m;
      // KAŻDY człon potwierdzony (nie „którykolwiek"): „MARII SKŁODOWSKIEJ-CURIE" w nazwie
      // instytucji przechodziłoby przez „skłodowskiej", „ADAM MIŃSKI-MAZOWIECKI" to miejscowość
      const parts2 = n2.split('-');
      if (parts2.length > 1 && parts2.some((p) => LEGAL_ENTITY_WORDS.has(p) || isGeoAdjective(p))) return m;
      if (!parts2.every((p) => !!surnameBase(p) || looksLikeSurname(p))) return m;
      if (precededByPatron(src, offset) || precededByStreetEponym(src, offset)) return m;
      if (!isFirstNameLike(n1) && !homo1) {
        // pierwszy token to nie imię — maskuj SAMO nazwisko, o ile zawiera homoglif
        if (!homo2) return m;
        ctx.bump('IMIE');
        return `${t1}${sep}${ctx.personMask(n2)}`;
      }
      ctx.bump('IMIE');
      return ctx.personMask(n2);
  };
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  // Domknięcie imion WERSALIKAMI wokół zamaskowanej pary: drugie imię przed parą („Pani ANNA MARIA
  // NOWAK" — para „ANNA MARIA" odpada, maskę dostaje „MARIA NOWAK") i za parą w szyku odwróconym
  // („KOWALSKA ANNA MARIA, córka …", „NADAWCA: KOWALSKI JAN PIOTR"). Tylko mianownik ze słownika.
  const capsGiven = (w: string): boolean => {
    const l = w.toLowerCase();
    return POLISH_FIRST_NAMES.has(l) && !isMaleFirstNameGenitive(l) && !NOUN_LIKE_FIRST_NAMES.has(l) && !ROLE_WORDS.has(l) && !TITLE_WORDS.has(l);
  };
  const RE_CAPS_GIVEN_BEFORE = new RegExp(`(?<![${PL_UP}${PL_LO}0-9.-])([${PL_UP}]{2,})[ \\t]+$`);
  const RE_CAPS_GIVEN_AFTER = new RegExp(`^[ \\t]+([${PL_UP}]{2,})(?![${PL_UP}${PL_LO}0-9.-])`);
  for (let mm = re.exec(src); mm; mm = re.exec(src)) {
    const [, t1, sep, t2] = mm;
    const r = decide(t1, sep, t2, mm.index);
    if (r === null) continue;
    let from = mm.index;
    let to = mm.index + t1.length + sep.length + t2.length;
    if (t1 === t1.toUpperCase() && t2 === t2.toUpperCase()) {
      const head = RE_CAPS_GIVEN_BEFORE.exec(src.slice(Math.max(last, from - 24), from));
      if (head && capsGiven(head[1]) && capsGiven(t1)) from -= head[0].length;
      const tail = RE_CAPS_GIVEN_AFTER.exec(src.slice(to, to + 24));
      if (tail && capsGiven(tail[1]) && capsGiven(t2)) to += tail[0].length;
    }
    out += src.slice(last, from) + r;
    last = to;
    re.lastIndex = last;
  }
  if (last) ctx.text = out + src.slice(last);
}

// Dopełnienie „Dom …" po „z domu" (instytucja, nie nazwisko panieńskie): „z Domu Dziecka", „z domu
// Pomocy Społecznej", „Z DOMU KULTURY". „dziecka" ma też kształt nazwiska (-cka), więc sama
// morfologia go nie odrzuci.
export const MAIDEN_NOT_SURNAME = new Set<string>(
  (
    'dziecka pomocy kultury opieki seniora bożego maklerskiego towarowego handlowego weselnego ' +
    'pogrzebowego studenckiego samotnej spokojnej starości wczasowego zdrojowego parafialnego ' +
    'rekolekcyjnego aukcyjnego wydawniczego mody książki rodzinnego dziennego ' +
    // rodzina i grzecznościowe „Państwa" pisane wielką literą z szacunku („z domu Babci", „z domu
    // Państwa Wróblów") oraz typowe nazwy „Dom …" w dopełniaczu rzeczownika („Dom Strażaka",
    // „Dom Nauczyciela", „Dom Polonii")
    'babci babki mamy mamusi matki taty ojca rodziców teściów dziadków dziadka cioci wujka siostry ' +
    'brata sąsiadów sąsiada przyjaciół państwa strażaka nauczyciela sportowca turysty harcerza ' +
    'rzemiosła kombatanta działkowca studenta chłopa pielgrzyma samopomocy miłosierdzia rolnika ' +
    'górnika żołnierza ucznia emeryta rencisty kolejarza lekarza pracownika pracy ludu ' +
    // nazwy domów i placówek w mianowniku albo dopełniaczu („z domu Caritas", „Hospicjum", „Dom
    // Muzyki", „Dom Sióstr …") oraz przyimek z nazwy pensjonatu („z domu Pod Lipami", „Na Skarpie")
    'caritas hospicjum muzyki sztuki literatury techniki technika prasy wsi spotkań sióstr braci ' +
    'pod na nad przy za u w we od do po ze przed obok'
  ).split(' '),
);
// Nazwisko panieńskie po „z domu"/„z d." stoi w mianowniku („z domu Kowalska", „z d. Nowak").
// Przymiotnik w przypadku zależnym („z domu Ludowego", „Pogodnej Jesieni", „Polskiego"), narzędnik
// („Spotkanie z D. Nowakiem") i dopełniacz na „-ii" („z domu Polonii") to nazwa domu albo inna
// fraza. Bez „-ów"/„-ych": dopełniacz liczby mnogiej bywa nazwiskiem rodu („z domu Wróblów"), i bez
// słownikowego isObliqueSurnameForm: „-ówna" („z domu Nowakówna") to mianownik, choć ma inną bazę.
const RE_MAIDEN_OBLIQUE = /^.{2,}(?:ego|emu|ej|ym|ii|ji)$|^.{3,}em$|ą$/;
const maidenNotSurname = (w: string): boolean => MAIDEN_NOT_SURNAME.has(w) || RE_MAIDEN_OBLIQUE.test(w);
// Wyraz z wielkiej litery tuż za kandydatem — dalszy ciąg nazwy własnej („z domu Ronalda McDonalda",
// „Wczasów Dziecięcych", „Sue Ryder", „Aniołów Stróżów"), a nie nazwisko panieńskie.
const RE_MAIDEN_NAME_CONTINUES = new RegExp(`^ [${PL_UP}][${PL_LO}]`);
// Ciąg nazwy własnej tylko wtedy, gdy kształt na to wskazuje: dalszy wyraz w dopełniaczu albo
// przymiotnik liczby mnogiej („Wczasów Dziecięcych", „Aniołów Stróżów"), kandydat w dopełniaczu
// imienia albo liczby mnogiej („Ronalda McDonalda", „Wczasów") albo obcy zapis dalszego wyrazu
// („Sue Ryder"). Potwierdzone nazwisko i homograf („z domu Mazur Wdowa po Janie", „z domu Wrona
// Telefon …", „Sowa Zamężna") oraz wyraz pospolity za kandydatem („Pstrąg Emerytka", „Bździuch
// Szpital Wojewódzki") to nazwisko panieńskie, a za nim następna fraza.
const RE_MAIDEN_NEXT_CONTINUES = /(?:ych|ich|ów|ców|ego|iej|ej|er|ey|ay|th|son|ton|ld|ck|ff|ee|oo)$/u;
function maidenNameContinues(sur: string, next: string): boolean {
  const sl = sur.toLowerCase();
  if (isFirstNameGenitive(sl) && !POLISH_FIRST_NAMES.has(sl)) return true;
  if (isConfirmedSurname(sur) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(sur))) return false;
  return RE_MAIDEN_NEXT_CONTINUES.test(next) || /^(?:Mc|Mac|O')\p{Lu}/u.test(next) || /ów$/u.test(sur);
}
// …chyba że ten wyraz to już następne pole spłaszczonego formularza albo zdania: skrót z kropką
// („Zam.", „Ur."), etykieta z dwukropkiem („Imię ojca:"), imiesłów czynny albo bierny („Legitymująca
// się", „Wypisana 12.10.", „Zatrudniona jest", „Przyjęta") albo czasownik w czasie przeszłym z wielkiej
// litery w tekście bez kropek („Zamieszkała w Radomiu", „Zmarła 2015.").
const RE_MAIDEN_NEXT_FIELD = new RegExp(
  `^ (?:[${PL_UP}][${PL_LO}]{0,3}\\.(?![${PL_LO}${PL_UP}])|[${PL_UP}][${PL_LO}]*(?:[ \\t]+[${PL_LO}]+){0,2}[ \\t]*:|[${PL_UP}][${PL_LO}]+(?:ąc(?:a|y|e)|[${PL_LO}]{3}ła|[${PL_LO}](?:an|on|ęt|it|yt)[aey])(?![${PL_LO}])|Zmarł[ay]?(?![${PL_LO}]))`,
);
// Wielkie „D." skrótu „Z D." przed nazwiskiem panieńskim zamienione na znak PUA do domknięcia inicjałów
// w finalizePersons: inaczej „D." szło do maski jako inicjał imienia. Znacznik stoi przy samym
// skrócie, więc maska INNEJ osoby („Rozmowa Jana Kowalskiego z D. Nowakiem") inicjał dalej wciąga —
// dawniej zbiór kluczowany tekstem maski blokował to w całym dokumencie, bo w trybie domyślnym każda
// maska osoby brzmi tak samo.
export const MAIDEN_D_SENTINEL = String.fromCharCode(0xe0d0);
// (c5) NAZWISKO PANIEŃSKIE PO MASCE: „Anna Kowalska z domu Sikora", „EWELINA KRAWCZYK Z D. MAJEWSKA",
// „Magdalena Kaczmarek (z d. Sikora)". (a5) w passPersonPairs wymaga surowego imienia przed „z",
// a tu para jest już maską z wcześniejszego przebiegu — nazwisko rodowe spoza słownika (homograf,
// rzadkie, WERSALIKI) zostawało jawne. Po masce osoby „z domu" to jawna kotwica, więc nazwisko
// w Titlecase przyjmujemy po stopliście instytucji; WERSALIKI muszą być potwierdzone (słownik,
// morfologia, homograf) — „JAN KOWALSKI Z DOMU WYSZEDŁ RANO" to zdanie. „domu" tylko małymi albo
// WIELKIMI literami: „z Domu Pomocy Społecznej" to nazwa instytucji.
export function passPersonMaidenAfterMask(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const PM = `\\[OSOBA-[A-Z]+\\]|${escapeRe(ctx.M.IMIE)}`;
  ctx.text = ctx.text.replace(
    new RegExp(
      `(${PM})([ \\t]*[,(]?[ \\t\\n]*[Zz][ \\t\\n]+(?:domu|DOMU|d\\.|D\\.)[ \\t]+)` +
        `([${PL_UP}][${PL_LO}]+(?:-[${PL_UP}][${PL_LO}]+)?|[${PL_UP}]{2,}(?:-[${PL_UP}]{2,})?)(?![${NM_BOUND}0-9-])`,
      'g',
    ),
    (m, mask: string, mid: string, sur: string, offset: number, str: string) => {
      const parts = sur.toLowerCase().split('-');
      if (parts.some((p) => LEGAL_ENTITY_WORDS.has(p) || ROLE_WORDS.has(p) || TITLE_WORDS.has(p) || NON_SURNAME_ADJ.has(p) || maidenNotSurname(p))) return m;
      if (sur === sur.toUpperCase() && !parts.some((p) => !!surnameBase(p) || looksLikeSurname(p) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(p)))) return m;
      // …chyba że dalej stoi imię: szyk „Kowalska z d. Sikora Anna" (nazwisko panieńskie przed imieniem)
      const after = str.slice(offset + m.length, offset + m.length + 40);
      const nextWord = /^ (\S+)/.exec(after)?.[1].replace(/[.,;:)]+$/, '') ?? '';
      if (
        sur !== sur.toUpperCase() &&
        RE_MAIDEN_NAME_CONTINUES.test(after) &&
        !RE_MAIDEN_NEXT_FIELD.test(after) &&
        !isFirstNameLike(nextWord) &&
        maidenNameContinues(sur, nextWord)
      )
        return m;
      ctx.bump('IMIE');
      return `${mask}${mid.replace(/D(?=\.[ \t]+$)/, MAIDEN_D_SENTINEL)}${ctx.personMask(sur)}`;
    },
  );
}

// (c4) HOMOGLIF OCR WEWNĄTRZ słowa kapitalizowanego: „Jan KowaIski" (wielkie I zamiast l).
export function passPersonOcrMix(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const OCR_MIX = `[${PL_UP}][${PL_LO}]*[I01][${PL_LO}I01]*`;
  ctx.text = ctx.text.replace(
    new RegExp(`(?<![${PL_UP}${PL_LO}0-9-])(?:(${CAP_WORD})([ \\t]+))?(${OCR_MIX})(?![${PL_UP}${PL_LO}0-9-])`, 'g'),
    (m, w1: string | undefined, sep: string | undefined, w2: string) => {
      const n2 = w2[0].toLowerCase() + w2.slice(1).replace(/[I1]/g, 'l').replace(/0/g, 'o').toLowerCase();
      if (!surnameBase(n2) && !looksLikeSurname(n2)) return m;
      ctx.bump('IMIE');
      // znane imię przed nazwiskiem wciągane do maski; inny wyraz („Firma") zostaje
      if (w1 && isFirstNameLike(w1)) return ctx.personMask(n2);
      return `${w1 ? `${w1}${sep}` : ''}${ctx.personMask(n2)}`;
    },
  );
}
