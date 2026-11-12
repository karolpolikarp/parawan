// Przebiegi osobowe z kotwicą: „Pan/Pani” i rola, self-ID, inicjał, tytuł przed homografem, obce imię
// z łącznikiem oraz samodzielne nazwisko ze słownika albo z morfologii.
import { COMMON_NOUN_LOOKALIKES, DIMINUTIVE_LOOKALIKES, homographBase, isCompoundAdjective, isConfirmedSurname, isGeoAdjective, looksLikeSurname, NON_SURNAME_ADJ, normalizeSurnameKey, surnameBase, surnameShaped } from '../surnames.js';
import { CAP_WORD, NM_BOUND, NM_LO, NM_UP, PL_LO, PL_UP, PRECEDED_BY_CAP, splitWords } from '../charset.js';
import { JSON_ESC_PUA_EOL, type RedactCtx, VI_GIVEN_SENTINEL } from '../context.js';
import { FORM_LABEL_WORDS, isEmptyFormValue } from '../dict/forms.js';
import { TABLE_HEADER_WORDS } from '../dict/headers.js';
import { FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { afterNonPersonContext, isObliqueSurnameForm, precededByAdminLabel, precededByEponym, STREET_RANK } from '../guards/eponyms.js';
import { DOT_CHAIN, dotChainKind, HOMOGRAPH_PAIR_EXCL, INITIAL_START, isHonorificP, RE_PAST_VERB_AFTER } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, RE_FOLLOWED_BY_PARK, ROLE_COMPLEMENT_GEN, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { RE_FOREIGN_BRAND_WORD, RE_FOREIGN_TAIL_START, RE_NON_PL_LETTER, RE_PL_OBLIQUE_ENDING, RE_SLAVIC_TAIL_START, RE_SOLO_DICT, RE_SOLO_MORPH } from '../person-patterns.js';

const isNonPersonWord = (l: string): boolean => LEGAL_ENTITY_WORDS.has(l) || NON_SURNAME_ADJ.has(l) || TITLE_WORDS.has(l) || ROLE_WORDS.has(l);

/** Dzieli kandydata na wyrazy (parzyste indeksy `parts`) i odstępy; `s` to pierwszy wyraz po wiodących rolach i tytułach („Pan Dyrektor Kowalski” zachowuje „Dyrektor”). */
function splitAfterRoles(name: string): { parts: string[]; words: string[]; s: number } {
  const { parts, words } = splitWords(name);
  let s = 0;
  while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
  return { parts, words, s };
}

// Dopełniacz urzędu wprost we wzorcu (wielka litera), żeby „Pan Pan Pan…” czy „Pan Jan Kowalski”
// odpadały bez funkcji zwrotnej. Jeden lub dwa wyrazy urzędu („Pani Kierownik Działu Kadr Gzowska”).
const ROLE_COMPLEMENT_CAP = [...ROLE_COMPLEMENT_GEN].map((w) => w[0].toUpperCase() + w.slice(1)).join('|');
const RE_PAN_ROLE_COMPLEMENT_SURNAME = new RegExp(
  `\\b([Pp]an(?:i|a|u|em|ią)?[ \\t]+)(${CAP_WORD})([ \\t]+(?:${ROLE_COMPLEMENT_CAP})(?:[ \\t]+(?:${ROLE_COMPLEMENT_CAP}))?[ \\t]+)` +
    `(${CAP_WORD})(?![${NM_BOUND}])`,
  'g',
);
const RE_FACILITY_GEN_MID = /(?<!\p{L})(?:Szpitala|Szkoły|Instytutu|Liceum|Przedszkola|Ośrodka|Zespołu|Uniwersytetu)[ \t]+$/u;
/**
 * „Pan/Pani” + rola + dopełniacz urzędu + nazwisko („Pan Komendant Policji Lisiecki”). Musi biec przed
 * parami, które wzięłyby „Policji Lisiecki” za imię i nazwisko. Rola i urząd zostają w tekście.
 */
export function passPersonRoleComplement(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_PAN_ROLE_COMPLEMENT_SURNAME, (m, kw: string, role: string, mid: string, sur: string) => {
    const rl = role.toLowerCase();
    if (!ROLE_WORDS.has(rl) && !TITLE_WORDS.has(rl)) return m;
    const sl = sur.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(sl) || ROLE_COMPLEMENT_GEN.has(sl) || ROLE_WORDS.has(sl) || isGeoAdjective(sl)) return m;
    // nazwisko dwuczłonowe („Kowalska-Nowak”) rozstrzyga każdy z członów osobno
    if (!isConfirmedSurname(sl) && !(sl.includes('-') && sl.split('-').every((p) => p.length > 1) && sl.split('-').some(isConfirmedSurname))) return m;
    // „Pani Wójt Gminy Kalisz”: nazwa miejscowości, nie nazwisko
    if (/(?<!\p{L})(?:miasta|miast|wsi|gminy|dzielnicy)[ \t]/iu.test(mid) && POLISH_CITIES.has(sl)) return m;
    // Po „Pan/Pani” w mianowniku nazwisko adresata też stoi w mianowniku; męska forma zależna to nazwa
    // placówki albo jej patron („Pani Dyrektor Szpitala Grochowskiego”).
    if (/^[Pp]ani?[ \t]/.test(kw) && isObliqueSurnameForm(sl) && !/(?:ej|ą|ę)$/.test(sl)) return m;
    // W formie zależnej („Do Pana Dyrektora Szpitala Bielańskiego”) nazwisko też byłoby -skiego, więc
    // nazwa placówki tylko po jej rodzaju i dla przymiotnika spoza słownika nazwisk.
    if (/^[Pp]an(?:a|u|em|ią)[ \t]/.test(kw) && RE_FACILITY_GEN_MID.test(mid) && /(?:sk|ck|dzk)iego$/.test(sl) && !surnameBase(sl)) return m;
    ctx.bump('IMIE');
    return `${kw}${role}${mid}${ctx.personMask(sur)}`;
  });
}

// Człon środkowy imienia wietnamskiego za nazwiskiem rodowym: „Nguyễn Văn Hùng”, „Trần Thị Mai”.
const VI_MIDDLE_NAMES = new Set<string>('văn thị đức hữu ngọc quang van thi duc huu ngoc'.split(' '));
// Częste imiona węgierskie i czeskie bez diakrytyki (słownik ma imiona polskie).
const CE_GIVEN_NAMES_FOLDED = new Set<string>(
  'laszlo istvan janos gyorgy zoltan ferenc sandor tamas gabor imre lajos attila eva katalin zsuzsanna erzsebet ilona jiri petr tomas pavel jana'.split(' '),
);
/** Czy wyraz za wyzwalaczem „Pan/Pani” to imię, także obce i z diakrytyką („Éva”, „László”). */
function triggerGivenName(w: string): boolean {
  if (isFirstNameLike(w)) return true;
  const f = w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return FOREIGN_GIVEN_NAMES.has(f) || CE_GIVEN_NAMES_FOLDED.has(f) || POLISH_FIRST_NAMES.has(f.replace(/v/g, 'w'));
}
const RE_SACRED_NAME = /^(?:bóg|boga|bogu|bogiem|jezus|jezusa|jezusowi|jezusem|chrystus|chrystusa|chrystusowi|chrystusem)$/;
const RE_VI_GIVEN_TAIL = new RegExp(`${VI_GIVEN_SENTINEL}(?:[ \\t]+[${NM_UP}][${NM_LO}]{1,6}(?![${NM_BOUND}-]))?`, 'g');
const RE_LABEL_TRIGGER = /^(?:[Ii]mi[eę] i nazwisko|[Nn]azwisko:)$/;
const RE_NAME_TRIGGER = new RegExp(
  `\\b([Nn]azywam się|[Mm]am na imię|[Ii]mię i nazwisko|[Ii]mie i nazwisko|[Nn]azwisko:|` +
    `[Pp]anowie|[Pp]anami|[Pp]anom|[Pp]anów|[Pp]anem|[Pp]ana|[Pp]anią|[Pp]aniom|[Pp]anu|[Pp]ani|[Pp]an)` +
    `([ \\t:]+)(${CAP_WORD}(?:[ \\t]+${CAP_WORD})?)(?![${NM_BOUND}])`,
  'g',
);
/** Wyzwalacze kontekstu („Pan”, „Nazwisko:”) łapią nazwiska spoza słownika („Pan Habdank-Wojewódzki”). */
export function passPersonTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  let viTail = false;
  const onMatch = (m: string, kw: string, sep: string, name: string, offset: number, str: string): string => {
    if (RE_LABEL_TRIGGER.test(kw)) {
      // Etykieta w wierszu tabeli TSV („Imię i nazwisko⇥Lokal⇥Telefon”): za nią stoi nagłówek sąsiedniej
      // kolumny albo wartość tylko w pierwszej komórce. Tabulator w kandydacie to granica kolumny.
      const w0 = name.split(/[ \t]/)[0].toLowerCase();
      if (sep.includes('\t') && (FORM_LABEL_WORDS.has(w0) || TABLE_HEADER_WORDS.has(w0))) return m;
      const tab = name.indexOf('\t');
      if (tab > 0) return onMatch(m.slice(0, m.length - name.length + tab), kw, sep, name.slice(0, tab), offset, str) + name.slice(tab);
      // wypełniacz wykazu albo szablonu („Nazwisko: Wakat”)
      if (isEmptyFormValue(name.trim())) return m;
    }
    const { parts, words, s } = splitAfterRoles(name);
    if (s >= words.length) return m;
    // Obcy wyraz z polską końcówką narzędnika po mianowniku „pan/pani” to dopełnienie, nie nazwisko
    // („Czy jeździ pan Škodą?”). Odcinamy go; gdy nic nie zostaje, to nie osoba.
    let tail = '';
    const lastWord = words[words.length - 1];
    if (/^[Pp]ani?$/.test(kw) && RE_NON_PL_LETTER.test(lastWord) && /(?:ą|em|ami)$/.test(lastWord)) {
      if (words.length - s === 1) return m;
      tail = parts.splice(-2).join('');
      words.pop();
    }
    // Marka z listy albo obcy wyraz w przypadku zależnym za potwierdzonym nazwiskiem nie należy do maski
    // ani klucza pseudonimu („Pan Nowak Škodę sprzedał”). Obcy wyraz w mianowniku to imię w szyku
    // „Nazwisko Imię” („Pan Nowak Bjørn”) i zostaje w masce.
    if (
      !tail &&
      words.length - s === 2 &&
      RE_NON_PL_LETTER.test(lastWord) &&
      !triggerGivenName(lastWord) &&
      (RE_FOREIGN_BRAND_WORD.test(lastWord) || RE_PL_OBLIQUE_ENDING.test(lastWord))
    ) {
      const w0 = words[s];
      if (isConfirmedSurname(w0)) {
        tail = parts.splice(-2).join('');
        words.pop();
      }
    }
    // Kluczem pseudonimu jest nazwisko, więc w szyku „Nazwisko Imię” („Pan Nagy László”) i przy członie
    // wietnamskim („Pan Nguyễn Văn Hùng”) pierwszy wyraz; samo „Pan Nagy” dostaje wtedy ten sam pseudonim.
    let keyWord = words[words.length - 1];
    let viGiven = '';
    if (words.length - s === 2) {
      const [w0, w1] = [words[s], words[s + 1]];
      if (VI_MIDDLE_NAMES.has(w1.toLowerCase())) {
        keyWord = w0;
        // imię za członem środkowym stoi poza kandydatem (najwyżej dwa wyrazy); zdejmuje je RE_VI_GIVEN_TAIL za znacznikiem
        viGiven = VI_GIVEN_SENTINEL;
        viTail = true;
      } else if (triggerGivenName(w1) && !triggerGivenName(w0)) keyWord = w0;
      else if (RE_NON_PL_LETTER.test(w1) && !RE_NON_PL_LETTER.test(w0) && surnameShaped(w0)) keyWord = w0;
    }
    const surname = words[words.length - 1];
    const sl = surname.toLowerCase();
    // „Pan Wojewoda Mazowiecki”, „Pani Sąd”: przymiotnik geo albo encja to nie nazwisko; po pominiętej roli
    // także złożenie („Pan Wojewoda Kujawsko-Pomorski”). Sam przymiotnik -ski/-cki tuż po „Pan/Pani” to
    // już nazwisko, bo bez roli nie ma czego określać.
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase())) return m;
    if (NON_SURNAME_ADJ.has(sl) && !(s === 0 && words.length === 1 && /(?:sk|ck|dzk)i$/.test(sl))) return m;
    if (s > 0 && isCompoundAdjective(sl)) return m;
    // dopełniacz urzędu albo imię sakralne w kandydacie („Pani Minister Zdrowia”, „do Pana Boga”)
    if (words.slice(s).some((w) => ROLE_COMPLEMENT_GEN.has(w.toLowerCase()))) {
      // nazwisko za imieniem sakralnym to podmiot zdania („Do Pana Boga Gzik się modlił”): maska tylko na nim
      const w0 = words[s].toLowerCase();
      const w1 = words[s + 1];
      const w1l = w1?.toLowerCase() ?? '';
      if (
        words.length - s === 2 &&
        RE_SACRED_NAME.test(w0) &&
        !tail &&
        !ROLE_COMPLEMENT_GEN.has(w1l) &&
        !LEGAL_ENTITY_WORDS.has(w1l) &&
        !NON_SURNAME_ADJ.has(w1l) &&
        !isFirstNameGenitive(w1l) &&
        // przydomek w dopełniaczu to dalszy ciąg imienia („Pana Jezusa Frasobliwego”)
        !/(?:ego|emu|ym|ej)$/.test(w1l) &&
        (surnameShaped(w1) || RE_PAST_VERB_AFTER.test(str.slice(offset + m.length, offset + m.length + 24)))
      ) {
        ctx.bump('IMIE');
        return `${kw}${sep}${parts.slice(0, 2 * s + 2).join('')}${ctx.personMask(w1)}`;
      }
      return m;
    }
    ctx.bump('IMIE');
    // zachowana rola wraz z odstępem za nią („Pan Dyrektor\tKowalski”: tabulator zostaje)
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(keyWord)}${viGiven}${tail}`;
  };
  ctx.text = ctx.text.replace(RE_NAME_TRIGGER, onMatch);
  if (viTail) ctx.text = ctx.text.replace(RE_VI_GIVEN_TAIL, '');
}

const STRONG_CAND = `[${PL_UP}${PL_LO}]{2,}(?:-[${PL_UP}${PL_LO}]{2,})?`;
const RE_STRONG_TRIGGER = new RegExp(
  `\\b(nazywam się|mam na imię)([ \\t:]+)(${STRONG_CAND}(?:[ \\t]+${STRONG_CAND}){0,2})(?![${PL_UP}${PL_LO}])`,
  'gi',
);
const RE_STARTS_PL_UP = new RegExp(`^[${PL_UP}]`);
const startsUpper = (w: string): boolean => RE_STARTS_PL_UP.test(w.split('-')[0]);
/**
 * Po „nazywam się”, „mam na imię” zawsze stoi nazwa, więc wielkość liter nie ma znaczenia („nazywam się
 * pamela nowak”). Kandydat musi mieć wielką literę albo potwierdzenie słownikowe. Bez „Pan/Pani”, bo po
 * nich bywa czasownik („Pan był”).
 */
export function passPersonStrongTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_STRONG_TRIGGER, (m, kw: string, sep: string, name: string) => {
    const { parts, words, s } = splitAfterRoles(name);
    if (s >= words.length) return m;
    const last = words[words.length - 1];
    const ll = last.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase()) || LEGAL_ENTITY_WORDS.has(ll) || NON_SURNAME_ADJ.has(ll)) return m;
    const cand = words.slice(s);
    const properCase = cand.some(startsUpper);
    const dictOk = cand.some((w) => isFirstNameLike(w)) || surnameShaped(last);
    if (!properCase && !dictOk) return m;
    ctx.bump('IMIE');
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(last)}`;
  });
}

/** Samodzielne nazwisko ze słownika najczęstszych nazwisk (z odmianą). */
export function passPersonSoloDict(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_DICT, (m, offset: number) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    // ogon obcych liter: o nazwisku rozstrzyga polski rdzeń, co najmniej czteroliterowy
    const tailAt = m.search(RE_FOREIGN_TAIL_START);
    if (tailAt !== -1) {
      if (tailAt < 4 || !RE_SLAVIC_TAIL_START.test(m.slice(tailAt)) || !surnameBase(m.slice(0, tailAt))) return m;
    } else if (!surnameBase(m)) return m;
    // „choroba Kowalskiego”, „ulica Kwiatkowska”, „im. Mickiewicza”: kontekst nie-osobowy
    if (precededByEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m; // „Powiat: …”, „Gmina: …”
    if (afterNonPersonContext(ctx.text, offset, m, ctx.maskedSurnames)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(m);
  });
}

/** Czy `w2` po kotwicy inicjału to nazwisko (słownik, końcówka, homograf) w kontekście osobowym? */
function initialAnchorsSurname(ctx: RedactCtx, w2: string, offset: number): boolean {
  if (isNonPersonWord(w2.toLowerCase())) return false;
  if (precededByEponym(ctx.text, offset)) return false;
  if (afterNonPersonContext(ctx.text, offset, w2)) return false;
  return surnameShaped(w2) || !!homographBase(w2);
}

// Tanie warunki najpierw (granica i lookahead na „X. ”): lookbehindy o zmiennej długości (początek wiersza,
// koniec zdania) liczą się tylko tam, gdzie stoi inicjał. Początek wiersza to też ucieczka „\n” z JSON-a
// (punkt wyliczenia „A.”). „Sz.” na liście skrótów: „Sz. P. Wilk” to nagłówek listu, nie koniec zdania.
// Skróty tytułów są też w RE_TITLE_BEFORE_DOT (niżej) i w DOT_TITLES (guards/person-context.ts); listy celowo się różnią.
const RE_INITIAL_SURNAME = new RegExp(
  `${INITIAL_START}(?=[${PL_UP}]\\.[ \\t])(?<!(?:^|\\n|\\\\[${JSON_ESC_PUA_EOL}])[ \\t]*)(?<!(?<!\\b(?:[Mm]ec|[Pp]rof|[Dd]r|[Mm]gr|[Ii]nż|hab|[Aa]dw|[Kk]s|płk|gen|kpt|mjr|por|sierż|lek|med|[Ss]ędz|[Ss]z))[.!?][ \\t]+)[${PL_UP}]\\.[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`,
  'g',
);
const RE_DOT_CHAIN_SURNAME = new RegExp(`${DOT_CHAIN}([ \\t]+)(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
/** Inicjał + nazwisko („A. Baran”). Inicjał to kotwica osobowa, także dla homografu. */
export function passPersonInitial(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_INITIAL_SURNAME, (m, w2: string, offset: number) => {
    if (!initialAnchorsSurname(ctx, w2, offset)) return m;
    ctx.bump('IMIE');
    // „Szanowny P. Kowalski”: „P.” to „Pan”, kotwica jak inicjał, ale zostaje w tekście
    if (isHonorificP(ctx.text, offset)) return `${m.slice(0, m.length - w2.length)}${ctx.personMask(w2)}`;
    return ctx.personMask(w2);
  });
  // Łańcuch kropkowy przed nazwiskiem („SSO J.M. Wilk”, „P.H.U. Wilk”, „Dr.J. Wilk”): jedyna kotwica homografu.
  ctx.text = ctx.text.replace(RE_DOT_CHAIN_SURNAME, (m, head: string, ini: string, sep: string, w2: string, offset: number) => {
    const kind = dotChainKind(head, ini);
    if (!kind || !initialAnchorsSurname(ctx, w2, offset)) return m;
    ctx.bump('IMIE');
    const mask = ctx.personMask(w2);
    if (kind === 'absorb') return mask;
    if (kind === 'keepTitle') return `${head}${mask}`;
    return `${head}${ini}.${sep}${mask}`;
  });
}

// Tytuł, zawód prawniczy albo rola procesowa tuż przed nazwiskiem-homografem („dr Mróz”, „adw. Wilk
// wnosi”). Sam homograf nie jest maskowany (wilk, mróz to słowa pospolite), więc kotwicą jest tytuł.
// Gołe „lek.” to też lek, więc tylko „lek. med.”/„lek. dent.”; „p.” nie po liczbie i nie jako „p.o.”.
const RE_HOMOGRAPH_ANCHOR = new RegExp(
  `(?<![\\p{L}\\p{N}.])(?:[Dd]r\\.?(?:[ \\t]+hab\\.)?|[Pp]rof\\.|lek\\.[ \\t]+(?:med|dent)\\.|[Aa]dw\\.|apl\\.[ \\t]+adw\\.|[Mm]ec\\.|r\\.[ \\t]?pr\\.|` +
    `[Pp]rokurator(?:a|owi|em)?|[Ss]ędzi(?:a|ego|emu|ą|ę)|[Śś]wiad(?:ek|ka|kowi|kiem)|[Bb]iegł(?:y|ego|emu|ym|a|ą|ej)|` +
    `[Pp]ełnomocni(?:k|ka|kowi|kiem)|[Oo]brońc(?:a|y|ą|ę)|[Pp]ow(?:ód|oda|odowi|odem|ódka|ódki)|[Pp]ozwan(?:y|ego|emu|ym|a|ej|ą)|` +
    `[Oo]skarżon(?:y|ego|emu|ym|a|ej|ą)|[Mm]ecenas(?:a|owi|em)?|(?<![IVXLC\\d][ \\t]?)p\\.(?!o\\.))[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`,
  'gu',
);
// Forma prawna (także bez kropek, „FHU/PPHU”), człony nazw firm („Powód Kruk SA”, „Pozwany Wilk Trans”)
// i „z siedzibą”: osoba fizyczna ma „zamieszkały”.
const RE_HOMOGRAPH_FIRM_AFTER =
  /^(?:[ \t]+\p{Lu}[\p{L}-]*){0,3}[ \t]*(?:S\.?A\.|[Ss][Pp]\.[ \t]*(?:z[ \t]*o\.[ \t]*o\.|[jkp]\.|komandytowa|jawna|akcyjna|partnerska)|[Ss]półk\p{L}*|i[ \t]+(?:Wspólnicy|Partnerzy|Syn(?:owie)?)(?!\p{L})|Towarzystw\p{L}*|Ubezpiecze\p{L}*|Logistics|Transport|Group|Holding|Polska(?!\p{L})|SA(?!\p{L})|S\.?C\.|F\.?H\.?U\.?(?!\p{L})|P\.?P\.?H\.?U\.?(?!\p{L})|P\.?H\.?U\.?(?!\p{L})|Trans\p{L}*|Windykacj\p{L}*|Fundusz\p{L}*|Finans\p{L}*|Finance|Capital|Invest\p{L}*|Serwis|Service|Consulting|z[ \t]+siedzibą)/u;
// Skrót patrona („im.”, „ul.”, „al.”, „pl.”, „imienia”) z ewentualnymi tytułami przed kotwicą („im. prof. dr hab. Wilka”).
const RE_PATRON_BEFORE_TITLE = new RegExp(
  `(?<![\\p{L}\\d])(?:(?:im|ul|al|pl)\\.|imienia)(?:[ \\t]+${STREET_RANK})*[ \\t]+$`,
  'iu',
);
export function passPersonHomographAnchor(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_HOMOGRAPH_ANCHOR, (m, w: string, offset: number, t: string) => {
    const hb = homographBase(w);
    if (!hb || HOMOGRAPH_PAIR_EXCL.has(hb) || isFirstNameLike(w)) return m;
    // strona procesowa bywa spółką („Pozwany Wilk Sp. z o.o.”): homograf jest wtedy nazwą firmy
    if (RE_HOMOGRAPH_FIRM_AFTER.test(t.slice(offset + m.length, offset + m.length + 80))) return m;
    // patron instytucji albo ulicy z tytułem („Szpital im. dr. Wilka”) to nie osoba z pisma
    if (RE_PATRON_BEFORE_TITLE.test(t.slice(Math.max(0, offset - 40), offset))) return m;
    ctx.bump('IMIE');
    return `${m.slice(0, m.length - w.length)}${ctx.personMask(hb)}`;
  });
}

const RE_FOREIGN_HYPHEN_NAME = new RegExp(
  `\\b([${NM_UP}][${NM_LO}]{1,6}-[${NM_UP}][${NM_LO}]{1,6})[ \\t]+` +
    `((?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]i|Da|[Bb]in|[Tt]er|El|Al)[ \\t]+)?` +
    `${CAP_WORD})(?![${NM_BOUND}])`,
  'g',
);
/** Obce imię dwuczłonowe z łącznikiem + nazwisko („Jean-Pierre Dubois”). */
export function passPersonForeign(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_FOREIGN_HYPHEN_NAME, (m, first: string, w2: string) => {
    const [f1, f2] = first.toLowerCase().split('-');
    if (!FOREIGN_GIVEN_NAMES.has(f1) && !FOREIGN_GIVEN_NAMES.has(f2)) return m;
    const last = w2.split(/[ \t]+/).pop() ?? w2;
    if (isNonPersonWord(last.toLowerCase())) return m;
    ctx.bump('IMIE');
    return ctx.personMask(last);
  });
}

/**
 * Czy wyraz z COMMON_NOUN_LOOKALIKES to tu rzeczownik, a nie nazwisko? Nazwa mieszkańca („Chińczyk”)
 * zawsze. Zdrobnienie, które bywa nazwiskiem (Kluczyk, Mieczyk), tylko na początku zdania i z frazą
 * rzeczownikową za nim; w środku zdania i po wcześniejszym rozpoznaniu tej osoby to nazwisko.
 */
function lookalikeIsCommonNoun(ctx: RedactCtx, t: string, offset: number, m: string): boolean {
  if (ctx.maskedSurnames.has(normalizeSurnameKey(m))) return false;
  if (!DIMINUTIVE_LOOKALIKES.has(m.toLowerCase())) return true;
  let i = offset - 1;
  while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
  if (i >= 0 && !/[\n\r.!?…]/.test(t[i])) return false;
  // kropka po skrócie tytułu („dr n. med. Krzaczyk”) nie kończy zdania
  if (i >= 0 && t[i] === '.' && RE_TITLE_BEFORE_DOT.test(t.slice(Math.max(0, i - 8), i))) return false;
  // Rzeczownikiem jest tylko z przyimkiem „do/od/w/na” („Kluczyk do skrzynki”) albo przymiotnikiem
  // („Mieczyk ogrodowy”) za nim. Czasownik, przecinek, koniec wiersza, liczba za przyimkiem („Krzaczyk od
  // 2015 r. pracuje”), stan osoby („na zwolnieniu”, „przytomny”) to nazwisko.
  const after = t.slice(offset + m.length, offset + m.length + 30);
  const next = /^[ \t]+(\p{Ll}+)(?!\p{L})/u.exec(after)?.[1];
  if (!next) return false;
  if (RE_NOUN_PHRASE_PREP.test(next)) return !/^[ \t]+\p{Ll}+[ \t]+\d/u.test(after) && !RE_PERSON_STATE_LOC_AFTER.test(after);
  return next.length >= 5 && RE_LOWER_ADJECTIVE.test(next) && !RE_PERSON_STATE_ADJ.test(next);
}
// Skrót tytułu lub stopnia tuż przed kropką („lek.”, „dr n.”). Por. RE_INITIAL_SURNAME i DOT_TITLES.
const RE_TITLE_BEFORE_DOT = /(?<!\p{L})(?:lek|med|inż|hab|prof|mgr|dr|doc|mec|adw|ks|piel|fizj|asp|sierż|st|mł|n|kpt|por|mjr|płk|gen|sędz|prok|r\.pr|r)$/iu;
const RE_NOUN_PHRASE_PREP = /^(?:do|od|w|we|na)$/;
// stan pracownika, nie położenie przedmiotu
const RE_PERSON_STATE_LOC_AFTER =
  /^[ \t]+(?:na|w|we)[ \t]+(?:zwolnieniu|urlopie|dyżurze|zmianie|delegacji|szkoleniu|zasiłku|rencie|emeryturze|L4|wypowiedzeniu|okresie)(?!\p{L})/u;
const RE_PERSON_STATE_ADJ = /(?:on|ion|ęt|yt|it)y$|^(?:nie)?(?:przytomny|obecny|chory|zdrowy|aktywny|dostępny|spokojny|pobudzony|wydolny|samodzielny|sprawny)$/;
// przymiotnik w mianowniku rodzaju męskiego, uzgodniony z „Kluczyk/Mieczyk”
const RE_LOWER_ADJECTIVE = /(?:owy|ny|ty|wy|ski|cki|szy)$/;

const RE_CSV_NAME_CELL_AFTER = /^[ \t]*[;|\t][ \t]*(\p{Lu}\p{Ll}+)[ \t]*(?:[;|\t]|\r?\n|$)/u;
function csvSurnameCellBeforeName(t: string, offset: number, m: string): boolean {
  if (!/[;|\t][ \t]*$/.test(t.slice(Math.max(0, offset - 3), offset))) return false;
  const name = RE_CSV_NAME_CELL_AFTER.exec(t.slice(offset + m.length, offset + m.length + 40))?.[1];
  return !!name && POLISH_FIRST_NAMES.has(name.toLowerCase());
}
// Rola w dopełniaczu przed wyrazem („wobec dłużnika Bartnicza”): dopełniacz nazwiska na „-nicz”
// morfologia odrzuca jako przymiotnik (Komornicza, Rolnicza).
const RE_ROLE_GEN_BEFORE = /(?<!\p{L})(?:dłużnika|wierzyciela|pozwanego|powoda|świadka|wnioskodawcy|uczestnika|oskarżonego|pana)[ \t]+$/iu;
/** Samodzielne nazwisko rozpoznane morfologicznie (-ski/-cki/-icz/-czyk). */
export function passPersonSoloMorph(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_MORPH, (m, offset: number, t: string) => {
    const ml = m.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(ml)) return m;
    // Komórka CSV/TSV przed komórką z imieniem („4;Duńczyk;Piotr”) to kolumna nazwiska: stoplista
    // przymiotników i nazw mieszkańców jej nie odbiera.
    const csvSurname =
      (/(?:sk|ck|dzk)[ia]$|czyk$/.test(ml) && csvSurnameCellBeforeName(t, offset, m)) ||
      (/[^aeiouyąęó]nicza$/.test(ml) && RE_ROLE_GEN_BEFORE.test(t.slice(Math.max(0, offset - 16), offset)));
    // rzeczownik pospolity na -czyk („Kluczyk do skrzynki”) tylko bez inicjału przed nim:
    // „J. Kluczyk” na początku wiersza łapie wyłącznie ten przebieg
    if (
      !csvSurname &&
      COMMON_NOUN_LOOKALIKES.has(ml) &&
      !/[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]+$/.test(t.slice(Math.max(0, offset - 4), offset)) &&
      lookalikeIsCommonNoun(ctx, t, offset, m)
    )
      return m;
    // „Słowiński Park Narodowy”: człon nazwy parku
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    const first = m.split('-')[0];
    // słownik łapie też formę z łącznikiem („Nowak-Schmidt”)
    if (!csvSurname && !looksLikeSurname(m) && !looksLikeSurname(first) && !surnameBase(m) && !surnameBase(first)) return m;
    // drugi człon złożenia z wielkiej litery („… Warszawski”) to przymiotnik nazwy
    if (PRECEDED_BY_CAP.test(t.slice(Math.max(0, offset - 40), offset))) return m;
    if (precededByEponym(t, offset)) return m;
    if (precededByAdminLabel(t, offset)) return m;
    if (afterNonPersonContext(t, offset, m, ctx.maskedSurnames)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(first);
  });
}
