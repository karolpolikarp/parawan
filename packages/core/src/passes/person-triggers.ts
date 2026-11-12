import { COMMON_NOUN_LOOKALIKES, DIMINUTIVE_LOOKALIKES, HOMOGRAPH_SURNAMES, NON_SURNAME_ADJ, homographBase, isCompoundAdjective, isGeoAdjective, looksLikeSurname, normalizeSurnameKey, surnameBase } from '../surnames.js';
import { CAP_WORD, NM_BOUND, NM_LO, NM_UP, PL_LO, PL_UP, PRECEDED_BY_CAP } from '../charset.js';
import { type RedactCtx } from '../context.js';
import { FORM_LABEL_WORDS, isEmptyFormValue } from '../dict/forms.js';
import { FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { afterNonPersonContext, isObliqueSurnameForm, precededByAdminLabel, precededByPatron, precededByStreetEponym, STREET_RANK } from '../guards/eponyms.js';
import { DOT_CHAIN, dotChainKind, HOMOGRAPH_PAIR_EXCL, INITIAL_START, isHonorificP, RE_PAST_VERB_AFTER } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, RE_FOLLOWED_BY_PARK, ROLE_COMPLEMENT_GEN, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { RE_FOREIGN_BRAND_WORD, RE_FOREIGN_TAIL_START, RE_NON_PL_LETTER, RE_PL_OBLIQUE_ENDING, RE_SLAVIC_TAIL_START, RE_SOLO_DICT, RE_SOLO_MORPH } from '../person-patterns.js';


// Dopełniacz urzędu wprost w wzorcu (wielka litera), żeby ciąg „Pan Pan Pan…" czy „Pan Jan Kowalski"
// odpadał bez wywołania funkcji zwrotnej. Jeden lub dwa wyrazy urzędu („Pani Kierownik Działu Kadr
// Gzowska").
const ROLE_COMPLEMENT_CAP = [...ROLE_COMPLEMENT_GEN].map((w) => w[0].toUpperCase() + w.slice(1)).join('|');
const RE_PAN_ROLE_COMPLEMENT_SURNAME = new RegExp(
  `\\b([Pp]an(?:i|a|u|em|ią)?[ \\t]+)(${CAP_WORD})([ \\t]+(?:${ROLE_COMPLEMENT_CAP})(?:[ \\t]+(?:${ROLE_COMPLEMENT_CAP}))?[ \\t]+)` +
    `(${CAP_WORD})(?![${NM_BOUND}])`,
  'g',
);
/**
 * (b0) „Pan/Pani" + rola + dopełniacz urzędu + nazwisko („Szanowna Pani Dyrektor Szkoły Gzowska",
 * „Pan Komendant Policji Lisiecki", „Pani Minister Zdrowia Kowalska"). Przed parami: para (a2)
 * zjadała „Zdrowia Kowalska" jako imię i nazwisko, a kandydat wyzwalacza (najwyżej dwa wyrazy)
 * kończył się na urzędzie i nazwisko za nim zostawało jawne. Rola i urząd zostają w tekście.
 */
const RE_FACILITY_GEN_MID = /(?<!\p{L})(?:Szpitala|Szkoły|Instytutu|Liceum|Przedszkola|Ośrodka|Zespołu|Uniwersytetu)[ \t]+$/u;
export function passPersonRoleComplement(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_PAN_ROLE_COMPLEMENT_SURNAME, (m, kw: string, role: string, mid: string, sur: string) => {
    const rl = role.toLowerCase();
    if (!ROLE_WORDS.has(rl) && !TITLE_WORDS.has(rl)) return m;
    const sl = sur.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(sl) || ROLE_COMPLEMENT_GEN.has(sl) || ROLE_WORDS.has(sl) || isGeoAdjective(sl)) return m;
    // nazwisko dwuczłonowe („Pani Dyrektor Szkoły Kowalska-Nowak") rozstrzyga każdy z członów —
    // dawniej całe zostawało jawne, bo słownik i morfologia dostawały wyraz z łącznikiem
    const surnameLike = (p: string): boolean => !!surnameBase(p) || looksLikeSurname(p) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(p));
    if (!surnameLike(sl) && !(sl.includes('-') && sl.split('-').every((p) => p.length > 1) && sl.split('-').some(surnameLike))) return m;
    // „Pan Burmistrz Miasta Turek", „Pani Wójt Gminy Kalisz" — nazwa miejscowości, nie nazwisko
    if (/(?<!\p{L})(?:miasta|miast|wsi|gminy|dzielnicy)[ \t]/iu.test(mid) && POLISH_CITIES.has(sl)) return m;
    // „Szanowna Pani Dyrektor Szpitala Grochowskiego", „Pan Dyrektor Szpitala Narutowicza": po „Pan/
    // Pani" w mianowniku nazwisko adresata stoi w mianowniku; męska forma zależna to nazwa placówki
    // albo jej patron („Szpital Bielański", „Szpital im. Narutowicza")
    if (/^[Pp]ani?[ \t]/.test(kw) && isObliqueSurnameForm(sl) && !/(?:ej|ą|ę)$/.test(sl)) return m;
    // W formie zależnej („Do Pana Dyrektora Szpitala Bielańskiego") nazwisko też byłoby -skiego, więc
    // nazwa placówki tylko po jej rodzaju i dla przymiotnika spoza słownika nazwisk.
    if (/^[Pp]an(?:a|u|em|ią)[ \t]/.test(kw) && RE_FACILITY_GEN_MID.test(mid) && /(?:sk|ck|dzk)iego$/.test(sl) && !surnameBase(sl)) return m;
    ctx.bump('IMIE');
    return `${kw}${role}${mid}${ctx.personMask(sur)}`;
  });
}

// (b) wyzwalacze kontekstu — łapią nazwiska spoza listy imion („Pan Habdank-Wojewódzki").
// Człon środkowy imienia wietnamskiego (za nazwiskiem rodowym): „Nguyễn Văn Hùng", „Trần Thị Mai".
const VI_MIDDLE_NAMES = new Set<string>('văn thị đức hữu ngọc quang van thi duc huu ngoc'.split(' '));
// Częste imiona węgierskie i czeskie po zdjęciu znaków diakrytycznych (słownik ma imiona polskie).
const CE_GIVEN_NAMES_FOLDED = new Set<string>(
  'laszlo istvan janos gyorgy zoltan ferenc sandor tamas gabor imre lajos attila eva katalin zsuzsanna erzsebet ilona jiri petr tomas pavel jana'.split(' '),
);
/** Czy wyraz za wyzwalaczem „Pan/Pani" to imię — także obce i zapisane z diakrytyką („Éva", „László"). */
function triggerGivenName(w: string): boolean {
  if (isFirstNameLike(w)) return true;
  const f = w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return FOREIGN_GIVEN_NAMES.has(f) || CE_GIVEN_NAMES_FOLDED.has(f) || POLISH_FIRST_NAMES.has(f.replace(/v/g, 'w'));
}
const RE_SACRED_NAME = /^(?:bóg|boga|bogu|bogiem|jezus|jezusa|jezusowi|jezusem|chrystus|chrystusa|chrystusowi|chrystusem)$/;
const VI_GIVEN_SENTINEL = String.fromCharCode(0xe0d2);
const RE_VI_GIVEN_TAIL = new RegExp(`${VI_GIVEN_SENTINEL}(?:[ \\t]+[${NM_UP}][${NM_LO}]{1,6}(?![${NM_BOUND}-]))?`, 'g');
const RE_LABEL_TRIGGER = /^(?:[Ii]mi[eę] i nazwisko|[Nn]azwisko:)$/;
// Nagłówki kolumn spoza FORM_LABEL_WORDS, które w wierszu TSV stoją za etykietą osoby.
export const TABLE_HEADER_WORDS = new Set<string>('lokal uwagi funkcja podpis status kontakt login rola grupa klasa termin godzina pokój lp'.split(' '));
export function passPersonTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  let viTail = false;
  const nameTrigger = new RegExp(
    `\\b([Nn]azywam się|[Mm]am na imię|[Ii]mię i nazwisko|[Ii]mie i nazwisko|[Nn]azwisko:|` +
      `[Pp]anowie|[Pp]anami|[Pp]anom|[Pp]anów|[Pp]anem|[Pp]ana|[Pp]anią|[Pp]aniom|[Pp]anu|[Pp]ani|[Pp]an)` +
      `([ \\t:]+)(${CAP_WORD}(?:[ \\t]+${CAP_WORD})?)(?![${NM_BOUND}])`,
    'g',
  );
  const onMatch = (m: string, kw: string, sep: string, name: string, offset: number, str: string): string => {
    if (RE_LABEL_TRIGGER.test(kw)) {
      // Etykieta w wierszu tabeli TSV („Imię i nazwisko⇥Lokal⇥Telefon", „Nazwisko:⇥Gzowski⇥Kadry"):
      // za nią stoi nagłówek sąsiedniej kolumny albo wartość tylko w pierwszej komórce. Tabulator
      // w kandydacie to granica kolumny — dalszy wyraz nie jest drugim członem nazwiska.
      const w0 = name.split(/[ \t]/)[0].toLowerCase();
      if (sep.includes('\t') && (FORM_LABEL_WORDS.has(w0) || TABLE_HEADER_WORDS.has(w0))) return m;
      const tab = name.indexOf('\t');
      if (tab > 0) return onMatch(m.slice(0, m.length - name.length + tab), kw, sep, name.slice(0, tab), offset, str) + name.slice(tab);
      // wypełniacz wykazu albo szablonu pod etykietą („Nazwisko: Wakat", „Imię i nazwisko: Zastrzeżone")
      if (isEmptyFormValue(name.trim())) return m;
    }
    const parts = name.split(/([ \t]+)/); // parzyste = wyrazy, nieparzyste = oryginalne odstępy
    const words = parts.filter((_, i) => i % 2 === 0);
    // odetnij wiodące role/tytuły po wyzwalaczu — „Pan Dyrektor Kowalski" → zachowaj „Dyrektor".
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    // Obcy wyraz z polską końcówką narzędnika na końcu kandydata po mianowniku „pan/pani" to
    // dopełnienie, nie nazwisko („Czy jeździ pan Škodą?", „Pani Nowak Citroënem"): nazwisko stoi
    // tu w mianowniku, jak sam wyzwalacz. Odcinamy go; gdy nic nie zostaje, to nie osoba.
    let tail = '';
    const lastWord = words[words.length - 1];
    if (/^[Pp]ani?$/.test(kw) && RE_NON_PL_LETTER.test(lastWord) && /(?:ą|em|ami)$/.test(lastWord)) {
      if (words.length - s === 1) return m;
      tail = parts.splice(-2).join('');
      words.pop();
    }
    // Potwierdzone nazwisko i obcy wyraz za nim, który nie jest imieniem („Pan Nowak Škoda", „Czy
    // Pan Nowak Škodę sprzedał?", „Pani Mróz Müllerowi przekazała") — marka albo dopełnienie
    // w dowolnym przypadku. Dawniej szło do maski i stawało się kluczem pseudonimu, więc dwie osoby
    // z tą samą marką dostawały jeden pseudonim.
    // Tylko marka z listy albo obcy wyraz z polską końcówką przypadka zależnego: sam obcy wyraz
    // w mianowniku po nazwisku to imię w szyku „Nazwisko Imię" („Pan Nowak Bjørn", „Pani Nowak
    // Ayşe") i należy do maski — inaczej imię zostawało jawne obok niej.
    if (
      !tail &&
      words.length - s === 2 &&
      RE_NON_PL_LETTER.test(lastWord) &&
      !triggerGivenName(lastWord) &&
      (RE_FOREIGN_BRAND_WORD.test(lastWord) || RE_PL_OBLIQUE_ENDING.test(lastWord))
    ) {
      const w0 = words[s];
      if (surnameBase(w0) || looksLikeSurname(w0) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w0))) {
        tail = parts.splice(-2).join('');
        words.pop();
      }
    }
    // Klucz pseudonimu z nazwiska: w szyku „Nazwisko Imię" („Pani Schröder Anna", „Pan Nagy László")
    // i przy członie środkowym imienia wietnamskiego („Pan Nguyễn Văn Hùng") nazwisko stoi pierwsze.
    // Z kluczem z imienia „Pani Schröder Anna i Pani Müller Anna" dostawały jeden pseudonim, a „Pan
    // Nagy" w dalszej części pisma — inny niż „Pan Nagy László".
    let keyWord = words[words.length - 1];
    let viGiven = '';
    if (words.length - s === 2) {
      const [w0, w1] = [words[s], words[s + 1]];
      if (VI_MIDDLE_NAMES.has(w1.toLowerCase())) {
        keyWord = w0;
        // imię za członem środkowym („… Văn Hùng") stoi już poza kandydatem (najwyżej dwa wyrazy)
        // i zostawało jawne obok maski — zdejmuje je drugi krok za znacznikiem
        viGiven = VI_GIVEN_SENTINEL;
        viTail = true;
      } else if (triggerGivenName(w1) && !triggerGivenName(w0)) keyWord = w0;
      // obce imię za potwierdzonym nazwiskiem („Pan Nowak Bjørn") — kluczem nazwisko
      else if (RE_NON_PL_LETTER.test(w1) && !RE_NON_PL_LETTER.test(w0) && (surnameBase(w0) || looksLikeSurname(w0))) keyWord = w0;
    }
    const surname = words[words.length - 1];
    const sl = surname.toLowerCase();
    // „Pan Wojewoda Mazowiecki", „Pani Sąd" — przymiotnik geo/encja to nie nazwisko; po pominiętej
    // roli także złożenie „Pan Wojewoda Kujawsko-Pomorski" (gołe „Pan X-sko-Y" dalej maskujemy).
    // Sam przymiotnik -ski/-cki tuż po „Pan/Pani" („Pan Poselski złożył", „Pan Mazowiecki") to już
    // nazwisko: bez roli nie ma czego określać.
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase())) return m;
    if (NON_SURNAME_ADJ.has(sl) && !(s === 0 && words.length === 1 && /(?:sk|ck|dzk)i$/.test(sl))) return m;
    if (s > 0 && isCompoundAdjective(sl)) return m;
    // dopełniacz urzędu albo imię sakralne w kandydacie („Pani Minister Zdrowia", „do Pana Boga")
    if (words.slice(s).some((w) => ROLE_COMPLEMENT_GEN.has(w.toLowerCase()))) {
      // …ale nazwisko za imieniem sakralnym to podmiot zdania („Przy kościele Pana Jezusa Gzik
      // rozdawał opłatki", „Do Pana Boga Gzik się modlił") — maska tylko na nim, „Pana Jezusa" zostaje
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
        // przydomek w dopełniaczu to dalszy ciąg imienia („Pana Jezusa Frasobliwego", „Miłosiernego")
        !/(?:ego|emu|ym|ej)$/.test(w1l) &&
        (!!surnameBase(w1) || looksLikeSurname(w1) || RE_PAST_VERB_AFTER.test(str.slice(offset + m.length, offset + m.length + 24)))
      ) {
        ctx.bump('IMIE');
        return `${kw}${sep}${parts.slice(0, 2 * s + 2).join('')}${ctx.personMask(w1)}`;
      }
      return m;
    }
    ctx.bump('IMIE');
    // zachowana rola wraz z odstępem za nią („Pan Dyrektor\tKowalski" — tabulator zostaje)
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(keyWord)}${viGiven}${tail}`;
  };
  ctx.text = ctx.text.replace(nameTrigger, onMatch);
  if (viTail) ctx.text = ctx.text.replace(RE_VI_GIVEN_TAIL, '');
}

// (b2) SILNE wyzwalacze self-ID („nazywam się", „mam na imię") — po nich w polszczyźnie ZAWSZE
// następuje imię/nazwisko, więc łapiemy je NIEZALEŻNIE od wielkości liter („nazywam się pAMELA
// nOWAK", „PAMELA", „pamela"). Świadomie NIE obejmuje „Pan/Pani" (po nich bywa czasownik: „Pan był").
// Precyzja: ufamy wyzwalaczowi tylko gdy kandydat wygląda na nazwę własną (wielka pierwsza litera
// któregoś członu) LUB słownik/morfologia potwierdza imię/nazwisko — inaczej „nazywam się tak jak
// trzeba" (same małe litery, brak potwierdzenia) zostaje nietknięte.
export function passPersonStrongTrigger(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const AC = `[${PL_UP}${PL_LO}]`;
  const CAND = `${AC}{2,}(?:-${AC}{2,})?`;
  const re = new RegExp(
    `\\b(nazywam się|mam na imię)([ \\t:]+)(${CAND}(?:[ \\t]+${CAND}){0,2})(?![${PL_UP}${PL_LO}])`,
    'gi',
  );
  const startsUpper = (w: string): boolean => new RegExp(`^[${PL_UP}]`).test(w.split('-')[0]);
  ctx.text = ctx.text.replace(re, (m, kw: string, sep: string, name: string) => {
    const parts = name.split(/([ \t]+)/); // parzyste = wyrazy, nieparzyste = oryginalne odstępy
    const words = parts.filter((_, i) => i % 2 === 0);
    let s = 0;
    while (s < words.length && (ROLE_WORDS.has(words[s].toLowerCase()) || TITLE_WORDS.has(words[s].toLowerCase()))) s++;
    if (s >= words.length) return m;
    const last = words[words.length - 1];
    const ll = last.toLowerCase();
    if (LEGAL_ENTITY_WORDS.has(words[s].toLowerCase()) || LEGAL_ENTITY_WORDS.has(ll) || NON_SURNAME_ADJ.has(ll)) return m;
    const cand = words.slice(s);
    const properCase = cand.some(startsUpper); // Titlecase/WERSALIK → traktuj jak nazwę własną
    const dictOk = cand.some((w) => isFirstNameLike(w)) || !!surnameBase(last) || looksLikeSurname(last);
    if (!properCase && !dictOk) return m;
    ctx.bump('IMIE');
    return `${kw}${sep}${parts.slice(0, 2 * s).join('')}${ctx.personMask(last)}`;
  });
}

// (c) SAMODZIELNE nazwisko ze słownika najczęstszych nazwisk (z odmianą).
export function passPersonSoloDict(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_DICT, (m, offset: number) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    // ogon obcych liter: o nazwisku rozstrzyga polski rdzeń, co najmniej czteroliterowy
    const tailAt = m.search(RE_FOREIGN_TAIL_START);
    if (tailAt !== -1) {
      if (tailAt < 4 || !RE_SLAVIC_TAIL_START.test(m.slice(tailAt)) || !surnameBase(m.slice(0, tailAt))) return m;
    } else if (!surnameBase(m)) return m;
    // „choroba Kowalskiego", „ulica Kwiatkowska", „im. Mickiewicza" — kontekst nie-osobowy
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m; // „Powiat: …", „Gmina: …"
    if (afterNonPersonContext(ctx.text, offset, m, ctx.maskedSurnames)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(m);
  });
}

/** Czy `w2` po kotwicy inicjału to nazwisko (słownik, końcówka, homograf) w kontekście osobowym? */
function initialAnchorsSurname(ctx: RedactCtx, w2: string, offset: number): boolean {
  const wl = w2.toLowerCase();
  if (LEGAL_ENTITY_WORDS.has(wl) || NON_SURNAME_ADJ.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return false;
  if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return false;
  if (afterNonPersonContext(ctx.text, offset, w2)) return false;
  return !!surnameBase(w2) || looksLikeSurname(w2) || !!homographBase(w2);
}

// (c1a) INICJAŁ + nazwisko („A. Baran", „J. Kowalski"). Inicjał to kotwica OSOBOWA.
export function passPersonInitial(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      // Tanie warunki NAJPIERW (granica + lookahead na „X. "): lookbehindy o zmiennej długości
      // (początek wiersza, koniec zdania) liczą się wtedy tylko tam, gdzie naprawdę stoi inicjał.
      // Początek wiersza to też dosłowna ucieczka „\n"/„\r" z JSON-a (punkt wyliczenia „A.").
      // „Sz." na liście skrótów: „Sz. P. Wilk" to nagłówek listu, nie koniec zdania.
      `${INITIAL_START}(?=[${PL_UP}]\\.[ \\t])(?<!(?:^|\\n|\\\\[\\uE00A\\uE00D])[ \\t]*)(?<!(?<!\\b(?:[Mm]ec|[Pp]rof|[Dd]r|[Mm]gr|[Ii]nż|hab|[Aa]dw|[Kk]s|płk|gen|kpt|mjr|por|sierż|lek|med|[Ss]ędz|[Ss]z))[.!?][ \\t]+)[${PL_UP}]\\.[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`,
      'g',
    ),
    (m, w2: string, offset: number) => {
      if (!initialAnchorsSurname(ctx, w2, offset)) return m;
      ctx.bump('IMIE');
      // „Szanowny P. Kowalski" — „P." to „Pan", kotwica osobowa jak inicjał, ale zostaje w tekście
      if (isHonorificP(ctx.text, offset)) return `${m.slice(0, m.length - w2.length)}${ctx.personMask(w2)}`;
      return ctx.personMask(w2);
    },
  );
  // Łańcuch kropkowy przed nazwiskiem („SSO J.M. Wilk", „P.H.U. Wilk", „Dr.J. Wilk"). Bez tego
  // homograf po dwóch inicjałach zostawał jawny — jedyną jego kotwicą jest inicjał.
  ctx.text = ctx.text.replace(
    new RegExp(`${DOT_CHAIN}([ \\t]+)(${CAP_WORD})(?![${NM_BOUND}])`, 'g'),
    (m, head: string, ini: string, sep: string, w2: string, offset: number) => {
      const kind = dotChainKind(head, ini);
      if (!kind || !initialAnchorsSurname(ctx, w2, offset)) return m;
      ctx.bump('IMIE');
      const mask = ctx.personMask(w2);
      if (kind === 'absorb') return mask;
      if (kind === 'keepTitle') return `${head}${mask}`;
      return `${head}${ini}.${sep}${mask}`;
    },
  );
}

// Tytuł naukowy, zawód prawniczy albo rola procesowa tuż przed nazwiskiem-homografem („dr Mróz",
// „do dr. Sikory", „adw. Wilk wnosi", „Prokurator Baran", „świadka Wróbla", „p. Wróbla"). Homograf
// sam w sobie nie jest maskowany (wilk, mróz, sikora to też słowa pospolite), więc przy kotwicy
// osobowej zostawał jawny, choć obok stał ten sam człowiek z imieniem. Gołe „lek." to też lek,
// więc tylko „lek. med."/„lek. dent."; „p." nie po liczbie i nie jako „p.o.".
const RE_HOMOGRAPH_ANCHOR = new RegExp(
  `(?<![\\p{L}\\p{N}.])(?:[Dd]r\\.?(?:[ \\t]+hab\\.)?|[Pp]rof\\.|lek\\.[ \\t]+(?:med|dent)\\.|[Aa]dw\\.|apl\\.[ \\t]+adw\\.|[Mm]ec\\.|r\\.[ \\t]?pr\\.|` +
    `[Pp]rokurator(?:a|owi|em)?|[Ss]ędzi(?:a|ego|emu|ą|ę)|[Śś]wiad(?:ek|ka|kowi|kiem)|[Bb]iegł(?:y|ego|emu|ym|a|ą|ej)|` +
    `[Pp]ełnomocni(?:k|ka|kowi|kiem)|[Oo]brońc(?:a|y|ą|ę)|[Pp]ow(?:ód|oda|odowi|odem|ódka|ódki)|[Pp]ozwan(?:y|ego|emu|ym|a|ej|ą)|` +
    `[Oo]skarżon(?:y|ego|emu|ym|a|ej|ą)|[Mm]ecenas(?:a|owi|em)?|(?<![IVXLC\\d][ \\t]?)p\\.(?!o\\.))[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`,
  'gu',
);
// Także skrót formy prawnej bez kropek, „FHU/PPHU", człony nazw firm windykacyjnych i transportowych
// („Powód Kruk SA", „Pozwany Wilk Trans") i „z siedzibą" — osoba fizyczna ma „zamieszkały".
const RE_HOMOGRAPH_FIRM_AFTER =
  /^(?:[ \t]+\p{Lu}[\p{L}-]*){0,3}[ \t]*(?:S\.?A\.|[Ss][Pp]\.[ \t]*(?:z[ \t]*o\.[ \t]*o\.|[jkp]\.|komandytowa|jawna|akcyjna|partnerska)|[Ss]półk\p{L}*|i[ \t]+(?:Wspólnicy|Partnerzy|Syn(?:owie)?)(?!\p{L})|Towarzystw\p{L}*|Ubezpiecze\p{L}*|Logistics|Transport|Group|Holding|Polska(?!\p{L})|SA(?!\p{L})|S\.?C\.|F\.?H\.?U\.?(?!\p{L})|P\.?P\.?H\.?U\.?(?!\p{L})|P\.?H\.?U\.?(?!\p{L})|Trans\p{L}*|Windykacj\p{L}*|Fundusz\p{L}*|Finans\p{L}*|Finance|Capital|Invest\p{L}*|Serwis|Service|Consulting|z[ \t]+siedzibą)/u;
// Skrót patrona („im.", „imienia", „ul.", „al.", „pl.") z ewentualnymi wcześniejszymi tytułami tuż
// przed kotwicą homografu („im. prof. " przed „dr hab. Wilka").
const RE_PATRON_BEFORE_TITLE = new RegExp(
  `(?<![\\p{L}\\d])(?:(?:im|ul|al|pl)\\.|imienia)(?:[ \\t]+${STREET_RANK})*[ \\t]+$`,
  'iu',
);
export function passPersonHomographAnchor(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_HOMOGRAPH_ANCHOR, (m, w: string, offset: number, t: string) => {
    const hb = homographBase(w);
    if (!hb || HOMOGRAPH_PAIR_EXCL.has(hb) || isFirstNameLike(w)) return m;
    // Strona procesowa bywa spółką („Powód Kruk S.A.", „Pozwany Wilk Sp. z o.o.", „Pozwana Wrona
    // i Wspólnicy Sp. k.", „Pozwana Sowa Ubezpieczenia S.A.") — homograf jest wtedy nazwą firmy.
    if (RE_HOMOGRAPH_FIRM_AFTER.test(t.slice(offset + m.length, offset + m.length + 80))) return m;
    // Patron instytucji albo ulicy z tytułem („Szpital im. dr. Wilka", „Centrum Onkologii im.
    // prof. Lisa", „Ośrodek im. prof. dr hab. Wilka", „ul. dr. Mazura") — homograf w nazwie to nie
    // osoba z pisma. W trybie pseudonimów patron dostawał etykietę pracownika o tym samym nazwisku.
    if (RE_PATRON_BEFORE_TITLE.test(t.slice(Math.max(0, offset - 40), offset))) return m;
    ctx.bump('IMIE');
    return `${m.slice(0, m.length - w.length)}${ctx.personMask(hb)}`;
  });
}

// (c1b) OBCE imię DWUCZŁONOWE z myślnikiem + nazwisko („Jean-Pierre Dubois").
export function passPersonForeign(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(
    new RegExp(
      `\\b([${NM_UP}][${NM_LO}]{1,6}-[${NM_UP}][${NM_LO}]{1,6})[ \\t]+` +
        `((?:(?:[Vv]an|[Vv]on|[Dd]e|[Dd]el|[Dd]ella|[Dd]i|Da|[Bb]in|[Tt]er|El|Al)[ \\t]+)?` +
        `${CAP_WORD})(?![${NM_BOUND}])`,
      'g',
    ),
    (m, first: string, w2: string) => {
      const [f1, f2] = first.toLowerCase().split('-');
      if (!FOREIGN_GIVEN_NAMES.has(f1) && !FOREIGN_GIVEN_NAMES.has(f2)) return m;
      const last = w2.split(/[ \t]+/).pop() ?? w2;
      const wl = last.toLowerCase();
      if (LEGAL_ENTITY_WORDS.has(wl) || NON_SURNAME_ADJ.has(wl) || TITLE_WORDS.has(wl) || ROLE_WORDS.has(wl)) return m;
      ctx.bump('IMIE');
      return ctx.personMask(last);
    },
  );
}

/**
 * Czy wyraz z COMMON_NOUN_LOOKALIKES to tu rzeczownik, a nie nazwisko? Nazwa mieszkańca
 * („Chińczyk") — zawsze. Zdrobnienie, które bywa nazwiskiem (Kluczyk, Mieczyk), tylko na początku
 * zdania i bez czasownika w czasie przeszłym tuż za nim („Kluczyk do skrzynki leży…", ale
 * „Kluczyk złożył wniosek" to osoba); w środku zdania („świadek Krzaczyk potwierdził", „Odebrał:
 * Kluczyk") i po wcześniejszym rozpoznaniu tej osoby w dokumencie („Andrzej Mieczyk … Mieczyk
 * zajmuje lokal") to nazwisko.
 */
function lookalikeIsCommonNoun(ctx: RedactCtx, t: string, offset: number, m: string): boolean {
  if (ctx.maskedSurnames.has(normalizeSurnameKey(m))) return false;
  if (!DIMINUTIVE_LOOKALIKES.has(m.toLowerCase())) return true;
  let i = offset - 1;
  while (i >= 0 && (t[i] === ' ' || t[i] === '\t')) i--;
  if (i >= 0 && !/[\n\r.!?…]/.test(t[i])) return false;
  // kropka po skrócie tytułu („lek. Kluczyk", „dr n. med. Krzaczyk", „inż. Kluczyk") nie kończy zdania
  if (i >= 0 && t[i] === '.' && RE_TITLE_BEFORE_DOT.test(t.slice(Math.max(0, i - 8), i))) return false;
  // Rzeczownikiem jest tylko z frazą rzeczownikową za nim: przyimkiem („Kluczyk do skrzynki",
  // „Kluczyk od szafki") albo przymiotnikiem („Mieczyk ogrodowy", „Kluczyk zapasowy"). Czasownik
  // w dowolnym czasie, przeczenie, przecinek, nawias, inicjał, koniec wiersza (podpis, lista, komórka
  // TSV) — to nazwisko: „Mieczyk wnosi o …", „Kluczyk nie stawił się", „Z poważaniem⏎Kluczyk".
  // Tylko „do/od" jak przy narzędziu: „Kluczyk z działu kadr potwierdził", „Kluczyk na zwolnieniu
  // lekarskim", „Krzaczyk od 2015 r. pracuje" (liczba za „od") to notatka o osobie. Imiesłów
  // i przymiotnik stanu osoby („Mieczyk zatrudniony od …", „Mieczyk przytomny") też.
  const after = t.slice(offset + m.length, offset + m.length + 30);
  const next = /^[ \t]+(\p{Ll}+)(?!\p{L})/u.exec(after)?.[1];
  if (!next) return false;
  if (RE_NOUN_PHRASE_PREP.test(next)) return !/^[ \t]+\p{Ll}+[ \t]+\d/u.test(after) && !RE_PERSON_STATE_LOC_AFTER.test(after);
  return next.length >= 5 && RE_LOWER_ADJECTIVE.test(next) && !RE_PERSON_STATE_ADJ.test(next);
}
// Skrót tytułu lub stopnia tuż przed kropką („lek.", „med.", „inż.", „dr n.").
const RE_TITLE_BEFORE_DOT = /(?<!\p{L})(?:lek|med|inż|hab|prof|mgr|dr|doc|mec|adw|ks|piel|fizj|asp|sierż|st|mł|n|kpt|por|mjr|płk|gen|sędz|prok|r\.pr|r)$/iu;
const RE_NOUN_PHRASE_PREP = /^(?:do|od|w|we|na)$/;
// „na zwolnieniu", „na urlopie", „w delegacji" — stan pracownika, nie położenie przedmiotu
const RE_PERSON_STATE_LOC_AFTER =
  /^[ \t]+(?:na|w|we)[ \t]+(?:zwolnieniu|urlopie|dyżurze|zmianie|delegacji|szkoleniu|zasiłku|rencie|emeryturze|L4|wypowiedzeniu|okresie)(?!\p{L})/u;
const RE_PERSON_STATE_ADJ = /(?:on|ion|ęt|yt|it)y$|^(?:nie)?(?:przytomny|obecny|chory|zdrowy|aktywny|dostępny|spokojny|pobudzony|wydolny|samodzielny|sprawny)$/;
// przymiotnik w mianowniku rodzaju męskiego, uzgodniony z „Kluczyk/Mieczyk" („zapasowy", „ozdobny", „złoty")
const RE_LOWER_ADJECTIVE = /(?:owy|ny|ty|wy|ski|cki|szy)$/;

const RE_CSV_NAME_CELL_AFTER = /^[ \t]*[;|\t][ \t]*(\p{Lu}\p{Ll}+)[ \t]*(?:[;|\t]|\r?\n|$)/u;
function csvSurnameCellBeforeName(t: string, offset: number, m: string): boolean {
  if (!/[;|\t][ \t]*$/.test(t.slice(Math.max(0, offset - 3), offset))) return false;
  const name = RE_CSV_NAME_CELL_AFTER.exec(t.slice(offset + m.length, offset + m.length + 40))?.[1];
  return !!name && POLISH_FIRST_NAMES.has(name.toLowerCase());
}
// Rola w dopełniaczu tuż przed wyrazem („wobec dłużnika Bartnicza", „pozew wierzyciela …") —
// dopełniacz nazwiska na „-nicz" morfologia odrzuca jako przymiotnik (Komornicza, Rolnicza).
const RE_ROLE_GEN_BEFORE = /(?<!\p{L})(?:dłużnika|wierzyciela|pozwanego|powoda|świadka|wnioskodawcy|uczestnika|oskarżonego|pana)[ \t]+$/iu;
// (c2) SAMODZIELNE nazwisko rozpoznane MORFOLOGICZNIE (sufiks -ski/-cki/-icz/-czyk).
export function passPersonSoloMorph(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  ctx.text = ctx.text.replace(RE_SOLO_MORPH, (m, offset: number, t: string) => {
    if (LEGAL_ENTITY_WORDS.has(m.toLowerCase())) return m;
    // Komórka CSV/TSV przed komórką z imieniem („2;Poleski;Adam;Kraków", „4;Duńczyk;Piotr") to
    // kolumna nazwiska: stoplista przymiotników i nazw mieszkańców jej nie odbiera.
    const csvSurname =
      (/(?:sk|ck|dzk)[ia]$|czyk$/.test(m.toLowerCase()) && csvSurnameCellBeforeName(t, offset, m)) ||
      (/[^aeiouyąęó]nicza$/.test(m.toLowerCase()) && RE_ROLE_GEN_BEFORE.test(t.slice(Math.max(0, offset - 16), offset)));
    // rzeczownik pospolity na -czyk („Kluczyk do skrzynki", „Chińczyk i Japończyk") — tylko bez
    // inicjału przed nim: „J. Kluczyk" na początku wiersza łapie wyłącznie ten przebieg
    if (
      !csvSurname &&
      COMMON_NOUN_LOOKALIKES.has(m.toLowerCase()) &&
      !/[A-ZĄĆĘŁŃÓŚŹŻ]\.[ \t]+$/.test(t.slice(Math.max(0, offset - 4), offset)) &&
      lookalikeIsCommonNoun(ctx, t, offset, m)
    )
      return m;
    // „Słowiński Park Narodowy" — człon nazwy parku, nie nazwisko
    if (RE_FOLLOWED_BY_PARK.test(t.slice(offset + m.length, offset + m.length + 40))) return m;
    const first = m.split('-')[0];
    // morfologia LUB słownik (słownik łapie formę z myślnikiem: „Nowak-Schmidt")
    if (!csvSurname && !looksLikeSurname(m) && !looksLikeSurname(first) && !surnameBase(m) && !surnameBase(first)) return m;
    // drugi człon złożenia z wielkiej litery (np. „… Warszawski") → to przymiotnik nazwy.
    if (PRECEDED_BY_CAP.test(ctx.text.slice(Math.max(0, offset - 40), offset))) return m;
    // eponim/ulica po wyrazie z małej litery oraz patron instytucji
    if (precededByPatron(ctx.text, offset) || precededByStreetEponym(ctx.text, offset)) return m;
    if (precededByAdminLabel(ctx.text, offset)) return m;
    if (afterNonPersonContext(ctx.text, offset, m, ctx.maskedSurnames)) return m;
    ctx.bump('IMIE');
    return ctx.personMask(first);
  });
}
