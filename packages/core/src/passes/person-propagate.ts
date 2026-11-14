// Osoby potwierdzone w piśmie zakryte także w innych miejscach. Nasiona to maski osób z pewnych kotwic
// (para imię + nazwisko, „Pan/Pani” + nazwisko, pole formularza), odczytane z oryginału przez
// dopasowanie tekstu po przebiegach do wejścia. Rozwinięcie: samo nazwisko w odmianie i wersalikami,
// samo imię w odmianie i ze zdrobnieniem, inicjały jednej osoby i login z imienia i nazwiska.
import { foldAscii, HOMOGRAPH_SURNAMES, homographBase, normalizeSurnameKey, surnameBase, surnameShaped } from '../surnames.js';
import { PERSON_MASK_SRC } from '../charset.js';
import type { RedactCtx } from '../context.js';
import { COLLIDING_NAME_FORMS, FIRST_NAME_DIMINUTIVES, FOREIGN_GIVEN_NAMES, isFirstNameLike, NOUN_LIKE_FIRST_NAMES, POLISH_FIRST_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { afterNonPersonContext, precededByAdminLabel, precededByEponym, RE_INSTITUTION_WORD } from '../guards/eponyms.js';
import { ORG_HEAD_WORDS, RE_SAINT_WORD_BEFORE } from '../guards/person-context.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { ALWAYS_KEEP_INITIALS, INITIAL_EXAMS } from './person-initials.js';
import { propagateLoginValues } from './login.js';
import { escapeRe } from '../util.js';

/** Osoba z pisma: maska nasiona (ta sama etykieta pseudonimu) i to, co o niej wiadomo. */
interface Seed {
  mask: string;
  /** Rdzeń nazwiska (canonSurname) albo null, gdy nasiono to samo imię („Pani Ewa”). */
  surname: string | null;
  /** Nazwisko w zapisie z pisma (do loginu i inicjałów). */
  surnameForm: string | null;
  /** Nazwisko jest też wyrazem pospolitym (Sowa, Wróbel): bez kotwicy nie na początku zdania. */
  homograph: boolean;
  /** Imiona w mianowniku (małe litery), także pełne imię zdrobnienia. */
  firstLemmas: string[];
  /** Litery inicjałów imion (z imienia albo z inicjału przed nazwiskiem). */
  firstInitials: string[];
  /** Nasiono zapisane małymi literami: wolno szukać jego form małymi literami. */
  lower: boolean;
  /** Mężczyzna (imię męskie, „Pan”, nazwisko na -ski): nazwisko się odmienia. */
  male: boolean;
  /** Kobieta (imię żeńskie, „Pani”, nazwisko na -ska): nazwisko na spółgłoskę się nie odmienia. */
  female: boolean;
}

// ——— Dopasowanie tekstu po przebiegach do oryginału ———

// Wzorzec znaczników (maski, sentinele PUA) dla zestawu masek; zwykle jeden, z domyślnymi maskami.
const tokenRes = new Map<Record<string, string>, RegExp>();
function tokenRe(M: Record<string, string>): RegExp {
  let re = tokenRes.get(M);
  if (!re) {
    const masks = [...new Set(Object.values(M))].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    re = new RegExp(`\\[OSOBA-[A-Z]+\\]|${masks}|\\uE000[A-Z]+\\uE001|\\uE0F2[A-Z]+\\uE0F3|[\\uE000-\\uF8FF]`, 'g');
    if (tokenRes.size > 16) tokenRes.clear();
    tokenRes.set(M, re);
  }
  return re;
}
/**
 * Fragmenty oryginału pod maskami osób. Tekst po przebiegach to oryginał z podmienionymi fragmentami
 * (maski, sentinele PUA), więc kolejne odcinki literalne szuka się w oryginale od bieżącej pozycji.
 * Gdy odcinka nie ma (inny przebieg zmienił tekst), dopasowanie kończy się na tym, co już ustalono.
 */
function personSpans(ctx: RedactCtx): { mask: string; raw: string; start: number }[] {
  const token = tokenRe(ctx.M);
  const isPerson = (tok: string): boolean => tok === ctx.M.IMIE || /^\[OSOBA-[A-Z]+\]$/.test(tok);
  const out: { mask: string; raw: string; start: number }[] = [];
  const t = ctx.text;
  const raw = ctx.raw;
  let cursor = 0;
  let last = 0;
  let pending: string[] = [];
  const flush = (litStart: number): void => {
    if (pending.length === 1 && isPerson(pending[0])) out.push({ mask: pending[0], raw: raw.slice(cursor, litStart), start: cursor });
  };
  for (const m of t.matchAll(token)) {
    const at = m.index ?? 0;
    if (at > last) {
      const lit = t.slice(last, at);
      const p = pending.length ? raw.indexOf(lit, cursor) : raw.startsWith(lit, cursor) ? cursor : -1;
      if (p < 0) return out;
      flush(p);
      cursor = p + lit.length;
      pending = [];
    }
    pending.push(m[0]);
    last = at + m[0].length;
  }
  if (pending.length) {
    const lit = t.slice(last);
    const p = lit ? raw.indexOf(lit, cursor) : raw.length;
    if (p >= 0 && (!lit || p + lit.length === raw.length)) flush(p);
  }
  return out;
}

// ——— Nazwiska: rdzeń wspólny dla form jednej osoby ———

const RE_ADJ_SURNAME = /(sk|ck|dzk)(?:i|a|iego|iemu|im|imi|ich|iej|ą|ie)$/;
const RE_ADJ_SURNAME_PL = /(s|c|dz)cy$/;
const SURNAME_ENDINGS = ['owie', 'owi', 'ami', 'ach', 'iem', 'ego', 'emu', 'em', 'om', 'ów', 'ie', 'ym', 'ej', 'u', 'a', 'ą', 'ę', 'y', 'o', 'e', 'i'];
const SOFT: Record<string, string> = { ć: 'c', ń: 'n', ś: 's', ź: 'z', ó: 'o', ą: 'ę' };
/**
 * Rdzeń nazwiska wspólny dla jego form („Sowa”, „Sowy”, „Sowie” → „sow”; „Wróbel”, „Wróbla” →
 * „wrobl”; „Kmieć”, „Kmiecia” → „kmiec”). Nie musi być poprawny językowo, ma być ten sam dla obu
 * porównywanych wyrazów. Krótszy niż trzy litery: null.
 */
function canonPart(word: string): string | null {
  let w = word.toLowerCase();
  if (RE_ADJ_SURNAME.test(w)) return w.replace(RE_ADJ_SURNAME, '$1');
  if (RE_ADJ_SURNAME_PL.test(w)) return w.replace(RE_ADJ_SURNAME_PL, '$1k');
  let end = '';
  for (const e of SURNAME_ENDINGS) {
    if (w.length - e.length >= 3 && w.endsWith(e)) {
      end = e;
      w = w.slice(0, -e.length);
      break;
    }
  }
  if (end === 'e') w = w.replace(/rz$/, 'r').replace(/dz$/, 'g').replace(/c$/, 'k');
  w = w.replace(/([csnz])i$/, '$1').replace(/[ćńśźóą]/g, (c) => SOFT[c]);
  w = w.replace(/([^aeiouyęó])e([^aeiouyęó])$/, '$1$2');
  return w.length >= 3 ? w : null;
}
function canonSurname(word: string): string | null {
  const parts = word.split('-').map(canonPart);
  return parts.every(Boolean) ? parts.join('-') : null;
}

// ——— Imiona: odmiana, zdrobnienia, indeks form ———

const ADJ_NAMES = new Set(['antoni', 'jeremi', 'marceli']);
const Y_NAMES = new Set(['jerzy', 'ignacy', 'konstanty', 'dionizy', 'ksawery', 'walenty', 'alojzy']);
/** Formy przypadków imienia (małe litery), z wołaczem. Odmiana przybliżona, ale bez form obcych imieniu. */
function declineFirstName(n: string): string[] {
  const out = [n];
  if (n.endsWith('a')) {
    const s = n.slice(0, -1);
    if (/(?:dzi|si|zi|ci|ni)$/.test(s)) out.push(s, `${s}ę`, `${s}ą`, `${s}u`);
    else if (/[^aeiouy]i$|j$/.test(s)) out.push(`${s}i`, `${s}ę`, `${s}ą`, `${s}o`);
    else {
      const gen = /[kgl]$/.test(s) ? `${s}i` : `${s}y`;
      const dat = /t$/.test(s)
        ? `${s.slice(0, -1)}cie`
        : /d$/.test(s)
          ? `${s.slice(0, -1)}dzie`
          : /r$/.test(s)
            ? `${s}ze`
            : /k$/.test(s)
              ? `${s.slice(0, -1)}ce`
              : /g$/.test(s)
                ? `${s.slice(0, -1)}dze`
                : /l$/.test(s)
                  ? `${s}i`
                  : /(?:sz|cz|rz|ż|c)$/.test(s)
                    ? `${s}y`
                    : `${s}ie`;
      out.push(gen, dat, `${s}ę`, `${s}ą`, /l$/.test(s) ? `${s}u` : `${s}o`);
    }
    return out;
  }
  if (ADJ_NAMES.has(n)) return [...out, `${n}ego`, `${n}emu`, `${n}m`];
  if (Y_NAMES.has(n)) {
    const s = n.slice(0, -1);
    return [...out, `${s}ego`, `${s}emu`, `${s}ym`];
  }
  if (/[iyoeuó]$/.test(n)) return out; // „Nati”, „Iwo”: bez odmiany
  let s = n;
  if (n.endsWith('ek') && n.length >= 4) s = n.slice(0, -2).replace(/(si|zi|ci|ni)$/, (x) => ({ si: 'ś', zi: 'ź', ci: 'ć', ni: 'ń' })[x] ?? x) + 'k';
  else if (n.endsWith('eł')) s = `${n.slice(0, -2)}ł`;
  else if (n.endsWith('ś')) s = `${n.slice(0, -1)}si`;
  else if (n.endsWith('ń')) s = `${n.slice(0, -1)}ni`;
  out.push(`${s}a`, `${s}owi`, /[kg]$/.test(s) ? `${s}iem` : `${s}em`);
  // miejscownik i wołacz
  if (/(?:[kgjlh]|ch|cz|sz|rz|ż|c|dz|si|ni)$/.test(s)) out.push(`${s}u`);
  else if (/t$/.test(s)) out.push(`${s.slice(0, -1)}cie`);
  else if (/d$/.test(s)) out.push(`${s.slice(0, -1)}dzie`);
  else if (/r$/.test(s)) out.push(`${s}ze`);
  else if (/ł$/.test(s)) out.push(`${s.slice(0, -1)}le`);
  else out.push(`${s}ie`);
  return out;
}

let formIndex: Map<string, Set<number>> | null = null;
let families: string[][] = [];
/** Rodziny imion (pełne imię i zdrobnienia) i indeks: forma → rodziny. Budowane raz, leniwie. */
function nameIndex(): Map<string, Set<number>> {
  if (formIndex) return formIndex;
  const fams: string[][] = [];
  const inFamily = new Set<string>();
  for (const [full, dims] of Object.entries(FIRST_NAME_DIMINUTIVES)) {
    fams.push([full, ...dims]);
    inFamily.add(full);
    for (const d of dims) inFamily.add(d);
  }
  for (const n of POLISH_FIRST_NAMES) if (!inFamily.has(n)) fams.push([n]);
  const idx = new Map<string, Set<number>>();
  fams.forEach((fam, i) => {
    for (const member of fam) {
      for (const f of declineFirstName(member)) {
        let s = idx.get(f);
        if (!s) idx.set(f, (s = new Set()));
        s.add(i);
      }
    }
  });
  families = fams;
  formIndex = idx;
  return idx;
}
/** Wszystkie formy imion z rodzin, do których należy forma `w` (małe litery). */
function familyForms(w: string): { lemmas: string[]; forms: string[] } {
  const ids = nameIndex().get(w);
  if (!ids) return { lemmas: [], forms: [] };
  const lemmas: string[] = [];
  const forms: string[] = [];
  for (const i of ids) {
    lemmas.push(families[i][0]);
    for (const member of families[i]) forms.push(...declineFirstName(member));
  }
  return { lemmas, forms };
}

// ——— Nasiona ———

const RE_SPAN_WORD = /^\p{L}+(?:-\p{L}+)*$/u;
const RE_INITIAL_WORD = /^\p{Lu}\.$/u;
const RE_TITLE_ABBR = /^\p{Ll}{1,5}\.$/u;
const capitalize = (w: string): string => w.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('-');
const isNameWord = (w: string): boolean => isFirstNameLike(w) || FOREIGN_GIVEN_NAMES.has(w.toLowerCase());
const isSurnameish = (w: string): boolean => surnameShaped(w) || !!homographBase(w);
// Kotwica pojedynczego wyrazu pod maską: „Pan/Pani”, „p.”, rola z wyzwalaczy, etykieta pola.
const RE_SOLO_ANCHOR_BEFORE =
  /(?:(?<!\p{L})(?:[Pp]an(?:i|a|u|em|ią|ie|o)?|[Pp]\.|[Pp]aństw[oau]|[Rr]adn\p{Ll}*|[Ss]zanown\p{Ll}*)[ \t]+|(?<!\p{L})(?:[Nn]azwisk\p{Ll}*|NAZWISK\p{Lu}*|[Ii]mi[eęo]\p{Ll}*|IMI[EĘ]\p{Lu}*)(?:[ \t]+\p{L}+){0,3}[ \t]*:[ \t]*)$/u;
const RE_FIRST_NAME_LABEL_BEFORE = /(?<!\p{L})(?:[Ii]mi[eęo]\p{Ll}*|IMI[EĘ]\p{Lu}*)(?:[ \t]+\p{L}+){0,2}[ \t]*:[ \t]*$/u;
const RE_MALE_ANCHOR_BEFORE = /(?<!\p{L})[Pp]an(?:a|u|em|ie)?[ \t]+$/u;
const RE_FEMALE_ANCHOR_BEFORE = /(?<!\p{L})[Pp]ani(?:ą)?[ \t]+$/u;
const RE_PARENT_LABEL_BEFORE = /(?<!\p{L})(?:[Ii]mi[eęo]\p{Ll}*|IMI[EĘ]\p{Lu}*)[ \t]+(?:ojca|matki|OJCA|MATKI)[ \t]*:[ \t]*$/u;

function buildSeeds(ctx: RedactCtx): Seed[] {
  const seeds: Seed[] = [];
  const seen = new Set<string>();
  for (const sp of personSpans(ctx)) {
    const s = sp.raw.trim();
    if (!s || s.length > 60 || /[\d@\n\r]/.test(s)) continue;
    const before = ctx.raw.slice(Math.max(0, sp.start - 40), sp.start + (sp.raw.length - sp.raw.trimStart().length));
    if (RE_PARENT_LABEL_BEFORE.test(before)) continue; // imię ojca, matki: inna osoba niż strona
    const initials: string[] = [];
    const words: string[] = [];
    for (const w of s.split(/[ \t]+/)) {
      if (RE_INITIAL_WORD.test(w)) initials.push(w[0]);
      else if (RE_TITLE_ABBR.test(w) || TITLE_WORDS.has(w.toLowerCase().replace(/\.$/, ''))) continue;
      else if (RE_SPAN_WORD.test(w)) words.push(w);
      else {
        words.length = 0;
        break;
      }
    }
    if (!words.length || words.length > 4) continue;
    const lower = words.every((w) => w === w.toLowerCase());
    const norm = words.map((w) => (w === w.toUpperCase() || lower ? capitalize(w) : w));
    if (!norm.every((w) => /^\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)*$/u.test(w))) continue;
    let first: string[] = [];
    let surname: string | null = null;
    if (norm.length >= 2) {
      const a = norm[0];
      const z = norm[norm.length - 1];
      if (isNameWord(a) && !(isNameWord(z) && !isSurnameish(z))) {
        first = norm.slice(0, -1).filter(isNameWord);
        surname = z;
      } else if (isNameWord(z) && !isNameWord(a)) {
        first = norm.slice(1).filter(isNameWord);
        surname = a;
      } else continue;
    } else {
      const w = norm[0];
      if (!RE_SOLO_ANCHOR_BEFORE.test(before)) continue;
      // „Pani Dyrektor”, „Pan Prezes”: rola, nie osoba
      if (ROLE_WORDS.has(w.toLowerCase()) || TITLE_WORDS.has(w.toLowerCase()) || isNameOfThingHead(w)) continue;
      const nameForm = isNameWord(w) || nameIndex().has(w.toLowerCase());
      if (RE_FIRST_NAME_LABEL_BEFORE.test(before) || (nameForm && !isSurnameish(w))) first = nameForm ? [w] : [];
      else surname = w;
    }
    const firstLemmas = new Set<string>();
    for (const f of first) {
      const { lemmas } = familyForms(f.toLowerCase());
      if (lemmas.length) for (const l of lemmas) firstLemmas.add(l);
      else if (POLISH_FIRST_NAMES.has(f.toLowerCase())) firstLemmas.add(f.toLowerCase());
    }
    const canon = surname ? canonSurname(surname) : null;
    if (!canon && !firstLemmas.size) continue;
    // ta sama osoba wspomniana wiele razy to jedno nasiono
    const key = `${sp.mask}|${surname ?? ''}|${[...firstLemmas].join(',')}|${initials.join('')}|${lower}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const male =
      (firstLemmas.size > 0 && [...firstLemmas].every((l) => !l.endsWith('a'))) ||
      (!!surname && /(?:sk|ck|dzk)i$/i.test(surname)) ||
      RE_MALE_ANCHOR_BEFORE.test(before);
    seeds.push({
      mask: sp.mask,
      surname: canon,
      surnameForm: surname,
      homograph: !!surname && (HOMOGRAPH_SURNAMES.has(surname.toLowerCase()) || !!homographBase(surname)),
      firstLemmas: [...firstLemmas],
      firstInitials: [...initials, ...first.map((f) => f[0].toUpperCase())],
      lower,
      male,
      female:
        !male &&
        ((firstLemmas.size > 0 && [...firstLemmas].every((l) => l.endsWith('a'))) ||
          (!!surname && /(?:sk|ck|dzk)a$/i.test(surname)) ||
          RE_FEMALE_ANCHOR_BEFORE.test(before)),
    });
  }
  return seeds;
}

// ——— Strażniki kontekstu ———

// Człony nazw firm z ROLE_WORDS („Piekarnia Wrona”): przed nazwiskiem zaczynają nazwę, nie osobę.
const FIRM_ROLE_WORDS = new Set(
  (
    'piekarnia tartak gospodarstwo warsztat hurtownia sklep apteka przychodnia restauracja pracownia ' +
    'przedsiębiorstwo usługowy usługowa usługowe handlowy handlowa handlowe produkcyjny produkcyjna ' +
    'rolny rolna rolne transportowy budowlany budowlana wielobranżowy'
  ).split(' '),
);
const NAME_HEAD_WORDS = new Set(
  'gmina gminy gminie gminą miasto miasta mieście wieś wsi sołectwo sołectwa hotel hotelu pensjonat kawiarnia salon studio apteka apteki osiedle osiedla'.split(' '),
);
/** Wyraz z wielkiej litery przed nazwiskiem, który zaczyna nazwę rzeczy, a nie osobę („Apteka Wrona”, „Gmina Ryba”). */
const isNameOfThingHead = (w: string): boolean => {
  const l = w.toLowerCase();
  return FIRM_ROLE_WORDS.has(l) || ORG_HEAD_WORDS.has(l) || LEGAL_ENTITY_WORDS.has(l) || NAME_HEAD_WORDS.has(l) || POLISH_CITIES.has(l) || RE_INSTITUTION_WORD.test(l);
};
// Kotwica osoby przed wyrazem na początku zdania („Radny Kmieć”, „Ciocia Grażka”): tytuł, rola, urząd,
// pokrewieństwo. Bez członów nazw firm z ROLE_WORDS.
const KIN_HEADS = /^(?:mam|matk|ojc|tat|cioci|ciotk|wuj|babci|babk|dziad|brat|siostr|syn|córk|mąż|męż|żon|teść|teściow|szwagr|kuzyn|wnu|radn|sołtys|wójt|ławni|kurator|pedagog|wychowaw|asystent|dzielnicow|admin)/;
const isAnchorWord = (w: string): boolean => {
  const l = w.toLowerCase();
  if (FIRM_ROLE_WORDS.has(l)) return false;
  return TITLE_WORDS.has(l) || ROLE_WORDS.has(l) || KIN_HEADS.test(l);
};
const RE_PREV_WORD = /(\p{L}+)([ \t]+)$/u;
const RE_SENTENCE_START = /(?:^|[\n\r]|[.!?…][ \t]+|^[ \t]*(?:\d{1,3}[.)]|[-*•–])[ \t]+)[ \t]*$/u;
const RE_ROMAN_AFTER = /^[ \t]+(?:\p{Lu}\p{Ll}+[ \t]+)?[IVX]+(?![\p{L}\d])/u;
const RE_NEXT_CAP = /^[ \t]+(\p{Lu}[\p{L}-]*)/u;
const RE_LOC_PREP_BEFORE = /(?<!\p{L})(?:w|we|do|z|ze|koło|pod|nad|przy|od|na)[ \t]+$/iu;
const RE_FIRM_AFTER = /^[ \t]*(?:S\.?A\.|[Ss][Pp]\.[ \t]*(?:z[ \t]*o\.|[jkp]\.)|[Ss]półk\p{L}*|SA(?!\p{L})|S\.?C\.|Sp(?!\p{L})| ?- ?\p{Lu}{2,})/u;
const RE_DIGIT_BEFORE = /\d[ .]*$/;
// „św.”, „bł.” przed imieniem: święty, także bez kontekstu sakralnego („list św. Pawła”).
const RE_SAINT_ABBR_BEFORE = /(?<!\p{L})(?:[Śś]w|[Bb]ł)\.[ \t]*$/u;
// „Kuba” to też państwo („na Kubę”, „z Kuby”).
const COUNTRY_NAME_FORMS = new Set(['kuba', 'kuby', 'kubie', 'kubę', 'kubą']);
const RE_COUNTRY_PREP_BEFORE = /(?<!\p{L})(?:na|z|ze|do|po)[ \t]+$/iu;
const PERSON_MASK_AHEAD = new RegExp(`^[ \\t]+(?:${PERSON_MASK_SRC})`);
// Przymiotnik przed homografem zaczyna nazwę („Złota Sowa”, „Biały Wilk”).
const RE_ADJ_LIKE = /(?:[nłtwkcsz]y|[nłtwkcsz]a|[nłtwk]e|owy|owa|owe)$/u;
const RE_ADJ_SURNAME_SHAPE = /(?:sk|ck|dzk)(?:i|a|iego|iej|im|ą)$/i;

/** Czy wyraz na pozycji stoi w kontekście osoby, a nie nazwy (patron, instytucja, miejscowość, firma)? */
function personContextOk(t: string, offset: number, word: string, nextOk: (w: string) => boolean, homographWord = false): boolean {
  if (precededByEponym(t, offset) || precededByAdminLabel(t, offset) || afterNonPersonContext(t, offset, word)) return false;
  const near = t.slice(Math.max(0, offset - 40), offset);
  if (RE_SAINT_WORD_BEFORE.test(near) || RE_SAINT_ABBR_BEFORE.test(near) || RE_DIGIT_BEFORE.test(t.slice(Math.max(0, offset - 4), offset))) return false;
  const far = t.slice(Math.max(0, offset - 60), offset);
  if (RE_SAINT_CHAIN_BEFORE.test(far) || RE_WORK_TITLE_BEFORE.test(far) || RE_GOSPEL_BEFORE.test(far)) return false;
  if (thingNameBefore(near)) return false;
  const after = t.slice(offset + word.length, offset + word.length + 40);
  if (RE_ROMAN_AFTER.test(after) || RE_FIRM_AFTER.test(after)) return false;
  // Wyraz z wielkiej litery tuż przed, który nie jest kotwicą osoby ani imieniem ze słownika: nie
  // początek nazwy firmy, instytucji, miejsca („Apteka Wrona”), a nazwisko przymiotnikowe albo
  // homograf po przymiotniku nie jako człon nazwy („Dworzec Kaliski”, „Złota Sowa”). Obce imię przed nazwiskiem
  // („Matthias Brandt”, „Oliwiera Zająca”) przechodzi.
  const prev = RE_PREV_WORD.exec(near);
  if (prev && /^\p{Lu}/u.test(prev[1]) && !isAnchorWord(prev[1]) && !isFirstNameLike(prev[1])) {
    if (isNameOfThingHead(prev[1]) || RE_ADJ_SURNAME_SHAPE.test(word) || (homographWord && RE_ADJ_LIKE.test(prev[1]))) return false;
  }
  // wyraz z wielkiej litery tuż za: inna nazwa własna, chyba że to ta sama osoba („Wróbel Tomasz”)
  const next = RE_NEXT_CAP.exec(after);
  if (next && !PERSON_MASK_AHEAD.test(after) && !RE_INITIAL_AHEAD.test(after) && !nextOk(next[1])) return false;
  return true;
}
// Święci w łańcuchu „X i Y” w jednej nazwie: „św. Piotra i Pawła”, „pw. świętych Stanisława i Wacława”,
// „parafii Piotra i Pawła”, „Kościół Piotra i Pawła”. Wezwanie świątyni bez „św.” to też święty.
const RE_SAINT_CHAIN_BEFORE =
  /(?<!\p{L})(?:(?:[Śś]w|[Bb]ł|[Pp]w|[Śś]św)\.|[Śś]więt\p{Ll}*|[Bb]łogosławion\p{Ll}*|[Pp]arafi[aięą]|[Kk]ości(?:ół|oła|ele|ołem|oły|ołów)|[Kk]atedr(?:a|y|ze|ę|ą)|[Bb]azylik(?:a|i|ę|ą)|[Kk]aplic(?:a|y|ę|ą|y)|[Ss]anktuari(?:um|a)|[Ww]ezwani(?:e|em|u))[ \t]+(?:(?:pw\.|św\.|świętych|świętego|świętej)[ \t]+)?(?:\p{Lu}\p{Ll}+[ \t]+(?:i|oraz)[ \t]+)?$/u;
// Ewangelista bez „św.”: „Ewangelia według Jana”, „Ewangelii wg św. Łukasza”.
const RE_GOSPEL_BEFORE = /(?<!\p{L})[Ee]wangeli\p{Ll}{0,3}[ \t]+(?:według|wg\.?)[ \t]+(?:(?:św\.|świętego)[ \t]+)?$/u;
// Imię jako człon tytułu dzieła: „przedstawieniu „Jaś i Małgosia””, „Bajka o Jasiu i Małgosi”.
const RE_WORK_TITLE_BEFORE =
  /(?<!\p{L})(?:[Bb]ajk|[Bb]aś[nń]|[Bb]aśni|[Ff]ilm|[Kk]siążk|[Pp]iosenk|[Ss]pektak|[Ss]ztuk|[Pp]rzedstawieni|[Oo]powiadani|[Ww]iersz|[Pp]owieś|[Ll]egend|[Ss]erial|[Kk]reskówk|[Mm]usical|[Tt]ytuł)\p{Ll}{0,4}[ \t]+(?:(?:o|pt\.|pod[ \t]+tytułem)[ \t]+)?[„"«]?(?:\p{Lu}\p{Ll}+[ \t]+i[ \t]+)?$/u;
// Wyraz przed imieniem albo nazwiskiem, który zaczyna nazwę rzeczy (w każdym przypadku i bez względu
// na wielkość litery): „Kopalnia Barbara”, „Kino Andrzej”, „w cukierni Sowa”, „Polisa Warty”,
// „Akcja Zima 2025”, „Spływ Wartą”, „Ubezpieczyciel Warta”.
const RE_THING_HEAD =
  /^(?:kopal[nń]\p{Ll}{0,3}|kin(?:o|a|ie|em|ach)|cukier[nń]\p{Ll}{0,3}|kawiar[nń]\p{Ll}{0,3}|piekar[nń]\p{Ll}{0,3}|restauracj\p{Ll}{0,2}|pizzeri\p{Ll}{0,2}|pensjonat\p{Ll}{0,3}|sklep\p{Ll}{0,3}|firm(?:a|y|ie|ę|ą|om)|spół(?:ka|ki|ce|kę|ką)|polis(?:a|y|ie|ę|ą)|ubezpieczyciel\p{Ll}{0,3}|towarzystw\p{Ll}{0,3}|akcj(?:a|i|ę|ą)|operacj(?:a|i|ę|ą)|kampani(?:a|i|ę|ą)|program(?:u|ie|em)?|projekt(?:u|cie|em)?|rond(?:o|a|zie|em)|statk(?:u|iem)|statek|jacht(?:u|em)?|prom(?:u|ie|em)?|pociąg(?:u|iem)?|hal(?:a|i|ę|ą)|spływ(?:u|ie|em)?|rajd(?:u|zie|em)?|turniej(?:u|em)?|festiwal(?:u|em)?|konkurs(?:u|ie|em)?|nagrod(?:a|y|zie|ę|ą)|rzek(?:a|i|ę|ą)|rzece|jezior(?:o|a|ze|em)|wydawnictw\p{Ll}{0,2}|gazet(?:a|y|cie|ę|ą)|dziennik(?:a|u|iem)?|tygodnik(?:a|u|iem)?|radi(?:o|a|u|em)|stacj(?:a|i|ę|ą)|salon(?:u|ie|em)?|galeri(?:a|i|ę|ą)|centrum|muze(?:um|a)|teatr(?:u|ze|em)?|klub(?:u|ie|em)?|chór|chóru|orkiestr(?:a|y|ze|ę|ą)|zesp(?:ół|ołu|ole|ołem)|drużyn(?:a|y|ie|ę|ą)|marka|marki|marce|markę|stadion(?:u|ie|em)?|osiedl(?:e|a|u|em)|hotel(?:u|em)?|apte(?:ka|ki|ce|kę|ką))$/u;
// Liczebnik porządkowy słowem przed imieniem („Trzeciego Maja”) i obce przedrostki nazw („Ave Maria”).
const RE_ORDINAL_WORD =
  /^(?:pierwsz|drug|trzec|czwart|piąt|szóst|siódm|ósm|dziewiąt|dziesiąt|jedenast|dwunast|trzynast|czternast|piętnast|szesnast|siedemnast|osiemnast|dziewiętnast|dwudziest|trzydziest)\p{Ll}*$/u;
const NAME_PREFIX_WORDS = new Set('ave santa san saint sankt sainte notre'.split(' '));
const RE_PREV_WORDS = /((?:\p{L}+[ \t]+){1,3})$/u;
/**
 * Czy wyrazy tuż przed tworzą z imieniem albo nazwiskiem nazwę rzeczy? Patrzy na wyraz bezpośrednio
 * przed oraz wstecz przez wyrazy z wielkiej litery („Centrum Nauki Kopernik”).
 */
function thingNameBefore(near: string): boolean {
  const ws = RE_PREV_WORDS.exec(near)?.[1].trim().split(/[ \t]+/) ?? [];
  for (let i = ws.length - 1; i >= 0; i--) {
    const w = ws[i];
    const l = w.toLowerCase();
    if (i === ws.length - 1 && (RE_ORDINAL_WORD.test(l) || NAME_PREFIX_WORDS.has(l))) return true;
    if (RE_THING_HEAD.test(l)) return true;
    // dalej wstecz tylko przez ciąg wyrazów z wielkiej litery, które nie są kotwicą osoby ani imieniem
    if (!/^\p{Lu}/u.test(w) || isAnchorWord(w) || isFirstNameLike(w)) return false;
  }
  return false;
}
// Zaimek albo przymiotnik przed homografem: „Każdy Polak”, „ten Kowal”, „prawdziwy Mazur”.
const DETERMINERS = new Set(
  (
    'każdy każda każde każdego każdej każdemu żaden żadna żadne żadnego ten ta to tego tej temu tym ów owa ' +
    'jakiś jakaś pewien pewna niejeden typowy typowa prawdziwy prawdziwa przeciętny przeciętna statystyczny ' +
    'statystyczna rodowity rodowita dumny dumna'
  ).split(' '),
);
// Rzeczowniki pospolite będące nazwiskami, spoza HOMOGRAPH_SURNAMES (pory roku, przyroda, przedmioty).
// Na początku zdania, po myślniku i w formach przysłówkowych („Zimą”, „Latem”) to słowo, nie osoba.
const NOUN_SURNAMES = new Set(
  (
    'zima lato wiosna jesień kamień mak groch kapusta cebula burak koper czosnek chrzan pieprz kminek ' +
    'grad śnieg deszcz wiatr burza chmura mgła szron lód rosa woda ogień las góra pole łąka gaj bór ' +
    'dąb buk grab jodła sosna świerk lipa wierzba topola klon jawor brzoza olcha kasztan orzech malina ' +
    'wiśnia śliwa jabłoń gruszka kwiatek kwiat liść korzeń pień gałąź ziarno kłos siano słoma ' +
    'koza kozioł byk krowa wół koń kobyła baran owca świnia wieprz kret mysz jeleń sarna dzik borsuk ' +
    'kos kruk wrona sowa sokół jastrząb orzeł czapla bocian łabędź gęś kaczka kogut kura indyk szczupak ' +
    'karp sum lin węgorz leszcz okoń śledź pstrąg żaba wąż ślimak pszczoła osa trzmiel komar ' +
    'kowal młynarz piekarz szewc rybak ' +
    'dzwon młot kosa sierp pług wóz koło kolano ręka głowa broda wąs ząb nos kość skóra chleb bułka ' +
    'miód sól cukier piwo wino mleko ser masło ' +
    'polak czech włoch węgier niemiec litwin rusin szwed francuz kaszuba ślązak mazur góral kurp ' +
    'warta wisła odra noteć san bug narew pilica'
  ).split(' '),
);
const nounSurnameStems = new Set([...NOUN_SURNAMES].map((w) => canonPart(w)).filter((c): c is string => !!c));
// Myślnik, nawias albo cudzysłów tuż przed: wyliczenie, diagnoza, hasło („matka – Rak jajnika”). Dwukropek
// rozstrzyga etykieta (afterFieldLabel), bo „wstrzymała się (1): Sowa” to osoba.
const RE_PUNCT_START_BEFORE = /(?:[–—(„"«]|(?<![\p{L}\d])-)[ \t]*$/u;
// Narzędnik bez przyimka to przysłówek czasu albo sposobu („Zimą jeździmy”, „Latem”, „Wiosną”).
const RE_INSTR_FORM = /(?:ą|em)$/;
const RE_INSTR_GOVERNOR_BEFORE =
  /(?<!\p{L})(?:z|ze|nad|pod|przed|za|między|pomiędzy|[Pp]an(?:em|ią)|[Pp]aństwem|kierowan\p{Ll}*|zarządzan\p{Ll}*|jest|był|była|został|została)[ \t]+$/iu;
// Orzeczenie w liczbie mnogiej tuż za formą na -y/-i/-e: „Sowy polują”, „Wróble ćwierkały”.
const RE_PLURAL_VERB_AFTER = /^[ \t]+(?:nie[ \t]+)?\p{Ll}+(?:ją|ują|eją|ają|ą|ały|ili|yli|eły|ęły)(?!\p{L})/u;
// Imiona i zdrobnienia będące rzeczownikami („hala”, „cela” i „celu”, „natka”, „oliwki”, „wika”, „jagody”):
// rozwinięte przez odmianę lematu, żeby objąć wszystkie przypadki. Z wielkiej litery na początku zdania
// to też rzeczownik („Hala sportowa”). Małą literą dodatkowo zdrobnienia z formą wspólną ze słowem
// („helu”, „wiki”, „kuba”) albo z wykrzyknikiem („ola”).
const NOUN_NAME_LEMMAS = 'hala cela natka oliwka wika'.split(' ');
const LOWER_ONLY_NAME_LEMMAS = 'hela ala ola kuba wiki'.split(' ');
let nounNameForms: Set<string> | null = null;
let lowerStopForms: Set<string> | null = null;
function nounNameForm(ml: string): boolean {
  if (!nounNameForms) {
    nounNameForms = new Set<string>(COLLIDING_NAME_FORMS);
    for (const l of [...NOUN_LIKE_FIRST_NAMES, ...NOUN_NAME_LEMMAS]) for (const f of declineFirstName(l)) nounNameForms.add(f);
  }
  return nounNameForms.has(ml);
}
function wordLikeNameForm(ml: string): boolean {
  if (!lowerStopForms) {
    lowerStopForms = new Set<string>();
    for (const l of LOWER_ONLY_NAME_LEMMAS) for (const f of declineFirstName(l)) lowerStopForms.add(f);
  }
  return nounNameForm(ml) || lowerStopForms.has(ml);
}
// Wołacz imienia żeńskiego („Helu”, „Kasiu”, „Ewo”) po przyimku jest niegramatyczny: „z Helu” to miejsce.
let vocativeForms: Set<string> | null = null;
function vocativeOnly(ml: string): boolean {
  if (!vocativeForms) {
    vocativeForms = new Set<string>();
    const other = new Set<string>();
    nameIndex();
    for (const fam of families) {
      for (const n of fam) {
        const forms = declineFirstName(n);
        if (!n.endsWith('a')) {
          for (const f of forms) other.add(f);
          continue;
        }
        const s = n.slice(0, -1);
        const voc = new Set([`${s}o`, `${s}u`]);
        for (const f of forms) (voc.has(f) ? vocativeForms : other).add(f);
      }
    }
    for (const f of other) vocativeForms.delete(f);
  }
  return vocativeForms.has(ml);
}
const atSentenceStart = (t: string, offset: number): boolean => RE_SENTENCE_START.test(t.slice(Math.max(0, offset - 12), offset));
// Etykieta pola na początku wiersza („Alias:”, „Zawód:”): homograf za nią to wartość pola, nie osoba.
// Etykiety osobowe („Nazwisko:”, „Uczestnik:”) zostają kotwicą.
const RE_FIELD_LABEL_BEFORE = /(?:^|\n)[ \t]*(\p{L}+(?:[ \t]+\p{L}+){0,2})[ \t]*:[ \t]*$/u;
const RE_PERSON_LABEL = /^(?:nazwisk|imi|osob|uczestni|wnioskodaw|stron|świad|pracowni|klient|pacjent|zgłaszając|kandyda|najemc|właściciel|przewodnicząc|protokołował|sporządził|podpis)/iu;
const afterFieldLabel = (t: string, offset: number): boolean => {
  const lab = RE_FIELD_LABEL_BEFORE.exec(t.slice(Math.max(0, offset - 40), offset))?.[1];
  return !!lab && !RE_PERSON_LABEL.test(lab);
};
// Wersaliki: wyraz osoby tylko obok drugiego członu tej samej osoby (imię, nazwisko, inicjał, maska)
// albo jako komórka tabeli; „KLUB SPORTOWY GÓRSKI”, „Termin: LIPIEC 2025” to nie osoba.
const RE_INITIAL_AHEAD = /^[ \t]+\p{Lu}\.(?![\p{L}\d])/u;
const RE_CAPS_NEIGHBOR_AFTER = new RegExp(String.raw`^[ \t]+(\p{Lu}\.(?![\p{L}\d])|\p{Lu}[\p{L}-]*|${PERSON_MASK_SRC})`, 'u');
const RE_CAPS_NEIGHBOR_BEFORE = new RegExp(String.raw`(?:(\p{Lu}[\p{L}-]*)|${PERSON_MASK_SRC})[ \t]+$`, 'u');

// Pismo potoczne (czat, SMS, helpdesk): emotikony albo znaczniki godzin na początku wierszy.
const RE_EMOJI = /[\u{1F300}-\u{1FAFF}]|(?<![\p{L}\d])[:;]-?[()DPp](?![\p{L}\d])/u;
const RE_CHAT_STAMP = /^[ \t]*\[?\d{1,2}:\d{2}(?::\d{2})?\]?[ \t]/gm;
const isInformal = (raw: string): boolean => RE_EMOJI.test(raw) || (raw.match(RE_CHAT_STAMP)?.length ?? 0) >= 3;
const RE_PAN_BEFORE = /(?<!\p{L})(?:pan|pani|pana|panu|panem|panią|panie|p\.)[ \t]+$/iu;

// ——— Rozwinięcie ———

// Wyraz i opcjonalny inicjał za nim („WILK R.”, „Szymon P.”), o ile po inicjale nie stoi kolejny wyraz
// z wielkiej litery (wtedy to inicjał następnej osoby).
const RE_WORD = /(?<![\p{L}\d_@#/\\.\]-])(\p{L}+(?:-\p{L}+)*)(?![\p{L}\d_@/\\-]|[._][\p{L}\d[])( \p{Lu}\.(?![\p{L}\d])(?![ \t]+\p{Lu}))?/gu;

/** Maska nasiona najbliższego przed pozycją (pseudonimy: ta sama etykieta), a bez wzmianki pierwsza. */
function nearestMask(t: string, offset: number, cands: Seed[]): string {
  const masks = [...new Set(cands.map((c) => c.mask))];
  if (masks.length === 1) return masks[0];
  // okno wstecz ograniczone, żeby długi dokument nie kosztował kwadratowo
  const want = new Set(masks);
  let best = masks[0];
  for (const m of t.slice(Math.max(0, offset - NEAREST_WINDOW), offset).matchAll(RE_PERSON_MASK_G)) if (want.has(m[0])) best = m[0];
  return best;
}
const NEAREST_WINDOW = 4000;
const RE_PERSON_MASK_G = new RegExp(PERSON_MASK_SRC, 'g');

// Nazwisko męskie zakończone spółgłoską („Mazur”, „Wróbel”) nie ma w liczbie pojedynczej form na
// -y/-i: „Mazury” to region, a „Wróble” to ptaki. Celownik „Wróblowi”, „Gzylakowi” to osoba.
const RE_MASC_SURNAME_FORM = /(?:[^aeiouyąęó]|owi|i?em)$/;
const masculinePlural = (ml: string, cands: Seed[]): boolean =>
  /[yi]$|(?<![aeiouyąęó])e$/.test(ml) &&
  !/(?:sk|ck|dzk)i$|rze$|ie$|owi$/.test(ml) &&
  cands.every((s) => !!s.surnameForm && RE_MASC_SURNAME_FORM.test(s.surnameForm.toLowerCase()));
// Liczba mnoga nazwiska rzeczownikowego („na Mazurach”, „Polaków”, „Wróblom”, „z Kowalami”): region,
// naród, gatunek albo rodzina, nie osoba z pisma. „Państwa Nowaków” zostaje przy kotwicy.
const RE_PLURAL_OBLIQUE = /(?:ach|ami|om|ów)$/;
const RE_FAMILY_ANCHOR_BEFORE = /(?<!\p{L})(?:[Pp]aństw\p{Ll}*|[Rr]odzin\p{Ll}*|[Mm]ałżonk\p{Ll}*|[Mm]ałżeństw\p{Ll}*)[ \t]+$/u;

// ——— Miejsca: kraje, regiony, miejscowości ———

// Kraje i krainy z nazwiskami o tym samym brzmieniu: „do Włoch”, „z Czech”, „z Węgier”, „na Mazurach”,
// „w Wielkopolsce”. Nazwy w liczbie pojedynczej odmienia declineFirstName (ta sama odmiana na -a i na
// spółgłoskę), nazwy w liczbie mnogiej mają formy wypisane, bo dopełniacz jest nieregularny.
const PLACE_SINGULAR =
  'polska wielkopolska małopolska litwa łotwa estonia słowacja białoruś ukraina rosja rumunia bułgaria serbia ' +
  'chorwacja słowenia grecja turcja austria szwajcaria francja hiszpania portugalia anglia szkocja irlandia ' +
  'walia holandia belgia dania szwecja norwegia finlandia islandia kuba ameryka kanada brazylia argentyna ' +
  'japonia gruzja armenia mołdawia albania warmia orawa galicja lubelszczyzna kielecczyzna opolszczyzna ' +
  'śląsk spisz wołyń hel';
const PLACE_PLURAL_FORMS =
  'włochy włoch włochom włochami włoszech czechy czech czechom czechami czechach węgry węgier węgrom węgrami ' +
  'węgrzech niemcy niemiec niemcom niemcami niemczech mazury mazur mazurom mazurami mazurach kaszuby kaszub ' +
  'kaszubom kaszubami kaszubach kujawy kujaw kujawach kurpie kurpi kurpiach żuławy żuław żuławach tatry tatr ' +
  'tatrach sudety sudetów sudetach karpaty karpat karpatach beskidy beskidów beskidach pieniny pienin pieninach ' +
  'bieszczady bieszczad bieszczadach gorce gorców gorcach chiny chin chinach indie indii indiach ' +
  'pomorze pomorza pomorzu mazowsze mazowsza mazowszu podlasie podlasia podlasiu podhale podhala podhalu ' +
  'podkarpacie podkarpacia podkarpaciu roztocze roztocza roztoczu kociewie kociewia kociewiu polesie polesia polesiu';
let placeForms: Set<string> | null = null;
/** Forma (małe litery) nazwy kraju albo krainy z listy. */
function placeForm(ml: string): boolean {
  if (!placeForms) {
    placeForms = new Set<string>(PLACE_PLURAL_FORMS.split(' '));
    for (const p of PLACE_SINGULAR.split(' ')) for (const f of declineFirstName(p)) placeForms.add(f);
  }
  return placeForms.has(ml);
}
// Przyimek przed nazwą miejsca. „w/we” z nazwą własną to prawie zawsze miejsce („w Rakowie”, „w Bielsku”).
const RE_COUNTRY_PREDICATE_AFTER = /^[ \t]+(?:to|jest|była|był|leży|słynie|graniczy|należy|liczy|ogłosiła|eksportuje|importuje)(?!\p{L})/u;
const RE_FIRST_PLACE_PREP_BEFORE = /(?<!\p{L})(?:[Ww]e?|[Nn]a|[Pp]o)[ \t]+$/u;
const RE_IN_BEFORE = /(?<!\p{L})[Ww]e?[ \t]+$/u;
const RE_PREP_BEFORE =
  /(?<!\p{L})(?:[Ww]e?|[Dd]o|[Zz]e?|[Nn]a|[Pp]o|[Oo]d|[Uu]|[Kk]oło|[Oo]bok|[Pp]od|[Nn]ad|[Pp]rzed|[Pp]rzez|[Zz]a|[Ss]pod|[Zz]nad|[Zz]za|[Ss]przed|[Pp]rzy|[Dd]la|[Bb]ez|[Kk]u|[Oo])[ \t]+$/u;
// Za nazwą jednostka administracyjna: „Zawada w gminie Pilzno”, „Kowale, gm. Kolbudy”.
const RE_PLACE_AFTER = /^[ \t]*,?[ \t]*(?:(?:w|we)[ \t]+(?:gminie|powiecie|województwie|parafii|sołectwie)|gm\.|gmina|pow\.|powiat|woj\.)(?!\p{L})/u;
// Ulica bez „ul.” po „przy” z numerem domu: „przy Długosza 7”, „przy Krakowskiej 12a”.
const RE_STREET_PREP_BEFORE = /(?<!\p{L})(?:[Pp]rzy|[Nn]a|[Uu]l\.?|[Aa]l\.?|[Uu]lic\p{Ll}*|[Aa]lej\p{Ll}*)[ \t]+$/u;
const RE_HOUSE_NO_AFTER = /^[ \t]+\d{1,4}[a-zA-Z]?(?:[ \t]*\/[ \t]*\d{1,4}[a-zA-Z]?)?(?![\d,.:]\d|\p{L})/u;

/**
 * Czy wyraz na pozycji to nazwa miejsca, ulicy albo krainy, a nie wzmianka o osobie? `nominativeMale`:
 * wyraz to mianownik nazwiska mężczyzny z pisma; po przyimku jest niegramatyczny („do Włoch”, „z Węgier”),
 * bo osoba stałaby w dopełniaczu albo narzędniku („do Włocha”, „z Węgrem”). Nazwiska żeńskie się nie odmieniają.
 */
function placeContext(t: string, offset: number, word: string, nominativeMale: boolean): boolean {
  const near = t.slice(Math.max(0, offset - 12), offset);
  const after = t.slice(offset + word.length, offset + word.length + 30);
  if (RE_PLACE_AFTER.test(after)) return true;
  if (RE_STREET_PREP_BEFORE.test(near) && RE_HOUSE_NO_AFTER.test(after)) return true;
  if (!RE_PREP_BEFORE.test(near)) return false;
  return RE_IN_BEFORE.test(near) || placeForm(word.toLowerCase()) || nominativeMale;
}

// ——— Formy, które nie mogą być osobą ———

// Forma na -kie, -gie albo spółgłoskę twardą + -e (-ne, -te, -we, -łe…) to przymiotnik rodzaju
// nijakiego albo niemęskoosobowego („Pojezierze Pomorskie”, „Polańskie łąki”, „Nowe przepisy”).
// Odmiana rzeczownikowa takich form nie tworzy: k, g miękną przed -e („Kaczce”, „Nodze”), r, ł, ch
// zmieniają się w -rze, -le, -sze, a pozostałe spółgłoski dostają -ie („Wierzbie”, „Sowie”).
const RE_NON_PERSON_E = /(?:[kg]ie|[nmtdwpbłf]e)$/;
// Nazwisko kobiety na spółgłoskę („Lis”, „Dąb”, „Nowak”) się nie odmienia: „pod Lisem”, „nad Bałtykiem”
// to nie ona.
const RE_CONSONANT_END = /[^aeiouyąęó]$/i;

// Miejscowość ze słownika w każdej formie, porównywana tym samym rdzeniem co nazwisko („do Kalisza”,
// „z Opola”, „do Zamościa”). Narzędnik po „z/ze” to osoba („z Kaliszem”), nie miejsce.
let cityCanons: Set<string> | null = null;
function cityCanon(canon: string): boolean {
  if (!cityCanons) {
    cityCanons = new Set<string>();
    for (const c of POLISH_CITIES) {
      if (c.includes(' ')) continue;
      const k = canonSurname(c);
      if (k) cityCanons.add(k);
    }
  }
  return cityCanons.has(canon);
}
const RE_WITH_BEFORE = /(?<!\p{L})[Zz]e?[ \t]+$/u;
const RE_INSTR_END = /(?:em|ą)$/;
/** Nazwa miejscowości (w dowolnej formie) po przyimku miejsca. */
function cityForm(t: string, offset: number, ml: string, canon: string): boolean {
  const near = t.slice(Math.max(0, offset - 6), offset);
  if (!RE_LOC_PREP_BEFORE.test(near)) return false;
  if (POLISH_CITIES.has(ml)) return true;
  return cityCanon(canon) && !(RE_WITH_BEFORE.test(near) && RE_INSTR_END.test(ml));
}

// Wyraz na początku zdania z wyrazem pospolitym za nim: przymiotnik przed rzeczownikiem („Wolny dostęp”,
// „Nowa ustawa”), rzeczownik przed przyimkiem albo przymiotnikiem („Mostek na rzece”, „Wieczorek
// autorski”). Osoba na początku zdania stoi przed orzeczeniem („Wolny przyszedł”, „Nowa twierdzi”).
// Przyimki i partykuły to klasy zamknięte. Nazwiska o końcówce typowo nazwiskowej (-ski, -cki, -icz,
// -czyk) nie są wyrazami pospolitymi i ta reguła ich nie dotyczy.
const PREPOSITIONS = new Set('w we z ze na do od po o u za przy pod nad bez dla przez przed obok koło wobec według spod znad'.split(' '));
const PARTICLES = new Set('jest też zaś już dziś wraz natomiast jednak wówczas więc bowiem przecież nawet sam oraz wcześniej później dalej wczoraj'.split(' '));
const RE_NEXT_LOWER = /^[ \t]+(\p{Ll}+)(?![\p{L}\d.-]\p{L})/u;
const RE_STRONG_SURNAME = /(?:sk|ck|dzk)[ia]$|icz$|czyk$/;
const RE_ADJ_WORD = /(?:sk|ck|dzk)(?:i|a|ie)$|ow[yae]$|[^aeiouyąęón]n[yae]$/;
const RE_NOUN_CONSONANT = /[^aeiouyąęół]$/;
function commonPhraseStart(word: string, next: string): boolean {
  const w = word.toLowerCase();
  if (RE_STRONG_SURNAME.test(w)) return false;
  if (PREPOSITIONS.has(next) || RE_ADJ_WORD.test(next)) return true;
  const nounNext = RE_NOUN_CONSONANT.test(next) && !PARTICLES.has(next);
  // przymiotnik męski przed rzeczownikiem na spółgłoskę („Stary budynek”, „Młody człowiek”)
  if (/[^aeiouyąęó][yi]$/.test(w)) return nounNext;
  // przymiotnik żeński przed rzeczownikiem („Wysoka temperatura”, „Nowa wieś”); -ła, -ka, -ta, -ma, -na
  // to też czas teraźniejszy albo przeszły („Nowa mieszka”, „Nowa złożyła”)
  if (/[^aeiouyąęó]a$/.test(w)) return nounNext || (/a$/.test(next) && !/(?:ła|ka|ta|ma|na)$/.test(next));
  return false;
}

function propagateNames(ctx: RedactCtx, seeds: Seed[]): void {
  const bySurname = new Map<string, Seed[]>();
  const firstSets = new Map<string, Set<Seed>>();
  for (const s of seeds) {
    if (s.surname) {
      const list = bySurname.get(s.surname);
      if (list) list.push(s);
      else bySurname.set(s.surname, [s]);
    }
    for (const l of s.firstLemmas) {
      for (const f of familyForms(l).forms) {
        const set = firstSets.get(f);
        if (set) set.add(s);
        else firstSets.set(f, new Set([s]));
      }
    }
  }
  const byFirst = new Map<string, Seed[]>([...firstSets].map(([f, set]) => [f, [...set]]));
  if (!bySurname.size && !byFirst.size) return;
  const informal = isInformal(ctx.raw);
  // wyraz użyty w piśmie małą literą jest tu też słowem pospolitym („grzyb”), jak homograf
  const lowerInDoc = new Set(ctx.text.match(RE_LOWER_WORD) ?? []);
  let lowerStemSet: Set<string> | null = null;
  const lowerStems = (): Set<string> => {
    if (!lowerStemSet) {
      lowerStemSet = new Set<string>();
      for (const w of lowerInDoc) {
        const c = w.length >= 3 ? canonPart(w) : null;
        if (c) lowerStemSet.add(c);
      }
    }
    return lowerStemSet;
  };
  const isSeedSurname = (w: string): boolean => bySurname.has(canonSurname(w) ?? '');
  // za wyrazem może stać imię albo nazwisko tej samej osoby („Wróbel Tomasz”, „BEATA KONIECZNA”)
  const nextOk = (w: string): boolean => isFirstNameLike(w) || byFirst.has(w.toLowerCase()) || isSeedSurname(w);
  // Wersaliki: sąsiad z tej samej osoby. Dla nazwiska imię, inicjał albo maska; dla imienia tylko
  // nazwisko osoby z pisma („BEATA KONIECZNA”), bo samo imię wersalikami nie jest rozlewane.
  const capsNeighbor = (t: string, offset: number, m: string, forFirst: boolean): boolean => {
    const a = RE_CAPS_NEIGHBOR_AFTER.exec(t.slice(offset + m.length, offset + m.length + 40));
    const b = RE_CAPS_NEIGHBOR_BEFORE.exec(t.slice(Math.max(0, offset - 40), offset));
    const ok = (hit: RegExpExecArray | null): boolean => {
      if (!hit) return false;
      const w = hit[1];
      if (forFirst) return !!w && w.length > 1 && w === w.toUpperCase() && isSeedSurname(w);
      return !w || /^\p{Lu}\.$/u.test(w) || isFirstNameLike(w);
    };
    return ok(a) || ok(b);
  };
  const mark = (mask: string): string => `${NEW_MASK_MARK}${mask}`;
  ctx.text = ctx.text.replace(RE_WORD, (whole: string, m: string, ini: string | undefined, offset: number, t: string) => {
    const lowerWord = m === m.toLowerCase();
    const caps = m.length > 1 && m === m.toUpperCase();
    if (!lowerWord && !caps && !/^\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)*$/u.test(m)) return whole;
    const ml = m.toLowerCase();
    // nazwisko
    const canon = lowerWord ? null : canonSurname(m);
    const sCands = canon ? bySurname.get(canon) : undefined;
    if (canon && sCands && !(isFirstNameLike(m) && !sCands.some((s) => s.surnameForm && isFirstNameLike(s.surnameForm))) && !masculinePlural(ml, sCands)) {
      const seedForm = sCands.some((s) => s.surnameForm?.toLowerCase() === ml);
      // Homograf: nazwisko z listy wyrazów pospolitych albo o rdzeniu wyrazu użytego w piśmie małą
      // literą („Kamień” przy „kamienia”, „Rak” przy „raka”).
      const homograph =
        sCands.every((s) => s.homograph) || HOMOGRAPH_SURNAMES.has(ml) || lowerInDoc.has(ml) || nounSurnameStems.has(canon) || lowerStems().has(canon);
      const near = t.slice(Math.max(0, offset - 24), offset);
      const after = t.slice(offset + m.length, offset + m.length + 30);
      const adjectival = RE_ADJ_SURNAME.test(ml) || RE_ADJ_SURNAME_PL.test(ml);
      const prevLower = RE_PREV_WORD.exec(near)?.[1].toLowerCase() ?? '';
      const blocked =
        // inicjał imienia za nazwiskiem („WILK R.”) przesądza o osobie
        (homograph && !ini && (atSentenceStart(t, offset) || afterFieldLabel(t, offset) || RE_PUNCT_START_BEFORE.test(near))) ||
        (homograph && !ini && DETERMINERS.has(prevLower)) ||
        (homograph && !seedForm && RE_INSTR_FORM.test(ml) && !RE_INSTR_GOVERNOR_BEFORE.test(near)) ||
        (homograph && !seedForm && /[yie]$/.test(ml) && RE_PLURAL_VERB_AFTER.test(after)) ||
        (!adjectival && !seedForm && RE_PLURAL_OBLIQUE.test(ml) && !RE_FAMILY_ANCHOR_BEFORE.test(near)) ||
        (!seedForm && RE_NON_PERSON_E.test(ml)) ||
        (!seedForm && sCands.every((s) => s.female && !!s.surnameForm && RE_CONSONANT_END.test(s.surnameForm))) ||
        (!ini && !caps && (atSentenceStart(t, offset) || RE_PUNCT_START_BEFORE.test(near)) && commonPhraseStart(m, RE_NEXT_LOWER.exec(after)?.[1] ?? '')) ||
        cityForm(t, offset, ml, canon) ||
        placeContext(t, offset, m, seedForm && sCands.every((s) => s.male)) ||
        (caps && !capsNeighbor(t, offset, m, false));
      if (!blocked && personContextOk(t, offset, m, nextOk, homograph)) {
        ctx.bump('IMIE');
        ctx.maskedSurnames.add(normalizeSurnameKey(m));
        return mark(nearestMask(t, offset, sCands));
      }
    }
    // imię
    const fCands = byFirst.get(ml);
    if (!fCands) return whole;
    if (lowerWord) {
      if (!(informal || fCands.some((s) => s.lower))) return whole;
      if (ml.length < 3) return whole;
      if (wordLikeNameForm(ml) && !RE_PAN_BEFORE.test(t.slice(Math.max(0, offset - 8), offset))) return whole;
    } else if (
      (nounNameForm(ml) || COUNTRY_NAME_FORMS.has(ml) || lowerInDoc.has(ml)) &&
      (atSentenceStart(t, offset) || RE_PUNCT_START_BEFORE.test(t.slice(Math.max(0, offset - 4), offset))) &&
      // „Kuba to wyspa”, „Kuba leży na Karaibach”: państwo; „Kuba choruje”, „Kuba przyszedł”: osoba
      !(COUNTRY_NAME_FORMS.has(ml) && !RE_COUNTRY_PREDICATE_AFTER.test(t.slice(offset + m.length, offset + m.length + 30)))
    )
      return whole;
    if (COUNTRY_NAME_FORMS.has(ml) && RE_COUNTRY_PREP_BEFORE.test(t.slice(Math.max(0, offset - 6), offset))) return whole;
    // Samo imię po „w/na/po” to miejsce, dzień albo dzielnica („po Kazimierzu”, „na Mikołaja”, „imieniny na
    // Józefa”), a po przyimku wołacz albo nazwa kraju („z Helu”, „do Kuby”).
    const nearF = t.slice(Math.max(0, offset - 12), offset);
    if (RE_FIRST_PLACE_PREP_BEFORE.test(nearF) || (RE_PREP_BEFORE.test(nearF) && (vocativeOnly(ml) || placeForm(ml))) || placeContext(t, offset, m, false)) return whole;
    if (caps && !capsNeighbor(t, offset, m, true)) return whole;
    // imię tuż za maską osoby rozstrzyga finalizePersons (ta sama albo inna osoba)
    if (RE_PERSON_MASK_JUST_BEFORE.test(t.slice(Math.max(0, offset - 24), offset))) return whole;
    if (!personContextOk(t, offset, m, nextOk)) return whole;
    ctx.bump('IMIE');
    return mark(nearestMask(t, offset, fCands));
  });
  mergeNewMasks(ctx);
}
// Wyraz małą literą w prozie, nie człon adresu, loginu ani ścieżki.
const RE_LOWER_WORD = /(?<![\p{L}\d.@_/\\-])\p{Ll}+(?![\p{L}\d@_/\\-]|\.\p{L})/gu;
const RE_PERSON_MASK_JUST_BEFORE = new RegExp(`(?:${PERSON_MASK_SRC})[ \\t]+$`);

// Znacznik nowej maski na czas scalania z sąsiednią maską tej samej osoby.
const NEW_MASK_MARK = '\uE0A7';
const PM = PERSON_MASK_SRC;
const RE_NEW_BEFORE_MASK = new RegExp(`${NEW_MASK_MARK}(?:${PM})([ \t]+|\r?\n)(${PM})`, 'g');
const RE_MASK_BEFORE_NEW = new RegExp(`(${PM})[ \t]+${NEW_MASK_MARK}(?:${PM})`, 'g');
/**
 * Nowa maska tuż obok maski osoby to ta sama osoba („Serhiy [OSOBA-A]”, „Stanisław⏎[OSOBA-A]”):
 * zostaje jedna maska, ta z pewniejszego przebiegu. Przez koniec wiersza tylko, gdy nowa maska nie
 * zaczyna wiersza (lista osób po jednej w wierszu to osobne osoby).
 */
function mergeNewMasks(ctx: RedactCtx): void {
  if (!ctx.text.includes(NEW_MASK_MARK)) return;
  ctx.text = ctx.text
    .replace(RE_NEW_BEFORE_MASK, (m: string, sep: string, mask: string, offset: number, t: string) => {
      if (sep.includes('\n') && /(?:^|\n)[ \t]*$/.test(t.slice(Math.max(0, offset - 8), offset))) return m;
      return mask;
    })
    .replace(RE_MASK_BEFORE_NEW, '$1')
    .split(NEW_MASK_MARK)
    .join('');
}

// Inicjały z kropkami („P.W.”, „Z. K.”) i bez („PD”, „BWK”), gdy pasują do dokładnie jednej osoby.
const RE_INITIALS = /(?<![\p{L}\d.@_/\\-])(?:(\p{Lu})\.[ \t]?(\p{Lu})\.(?:[ \t]?(\p{Lu})\.)?|(\p{Lu}{2,3}))(?![\p{L}\d@_/\\-]|\.\p{L})/gu;
const RE_ROMAN = /^[IVXLCDM]+$/;
const RE_BARE_INI_SLOT = /(?:(?<!\p{L})(?:przez|dla|wg|według)|[–—:(]|(?<![\p{L}\d])-|\p{Ll}{2,}(?:uje|je|ał|ała|ił|iła|ył|yła|ęła|li|ły))[ \t]*$/u;
// Rzeczownik na -ał w miejscu czasownika: „dział”, „wydział” (czasowniki „widział”, „wiedział” mają e/i
// przed -dział), „materiał”, „potencjał”, „ideał”. Czasowniki na -iał to wąska klasa (miał, chciał, musiał).
const RE_NOUN_AL = /(?:ri|cj|e|(?:^|[^ei])dzi)ał$/;
const RE_SLOT_WORD = /(\p{L}+)[ \t]*$/u;
// Za inicjałami koniec zdania, wiersza, przecinek albo data: podpis („Opracował JK.”).
const RE_CLAUSE_END_AFTER = /^[ \t]*(?:$|[\n\r.,;:)]|\d)/;
// Skróty ministerstw, urzędów, sądów, partii i formacji w kształcie inicjałów.
const OFFICE_ABBR = new Set<string>(
  (
    'MZ MF MS MSZ MON MEN MRR MAP MSP MSiT MKiŚ MRiRW MSWiA KPRM PO PiS PSL SLD KO AK AL BCh NSZ ' +
    'US UM UG UW UZ UE UK EU ZUS NFZ GUS SN NSA WSA TK SO SR SA KW KP KM KG PSP OSP PG PK SG BG NBP KNF ' +
    'NIK CBA ABW SKW PKP PKS PZU PKO ZOZ DPS OPS MOPS GOPS PCPR PUP WUP RIO SKO PIP PIS ITD ZDP ZDW ZDM'
  )
    .split(' ')
    .filter((a) => /^\p{Lu}{2,3}$/u.test(a)),
);
// Definicja skrótu w piśmie: wyrazy z wielkiej litery (z łącznikami „i/w/do…”) i skrót w nawiasie.
const RE_ABBR_DEF = /((?:\p{Lu}\p{L}*[ \t]+(?:(?:i|w|we|z|ze|do|na|dla|ds\.|oraz|pod|nad|przy)[ \t]+)?){1,7})\((\p{Lu}[\p{L}]{1,7})\)/gu;
/** Skróty rozwinięte w piśmie: litery skrótu są kolejnymi inicjałami wyrazów przed nawiasem albo powtarzają wyraz. */
function definedAbbreviations(raw: string): Set<string> {
  const out = new Set<string>();
  if (!raw.includes('(')) return out;
  for (const m of raw.matchAll(RE_ABBR_DEF)) {
    const abbr = m[2].replace(/\p{Ll}/gu, '');
    const words = m[1].trim().split(/[ \t]+/).filter((w) => /^\p{Lu}/u.test(w));
    const initials = words.map((w) => w[0]).join('');
    // „Adam Kowalski (AK)” to inicjały osoby, nie skrót nazwy
    if (words.some(isFirstNameLike)) continue;
    if ((abbr.length >= 2 && initials.includes(abbr)) || words.includes(m[2])) out.add(abbr);
  }
  return out;
}
const RE_PERSON_DEFINED_INI = new RegExp(`(?:${PERSON_MASK_SRC})[ \\t]*\\((\\p{Lu}{2,3})\\)`, 'gu');
/** Inicjały w nawiasie tuż za maską osoby („[IMIĘ I NAZWISKO] (AK)”). */
function personDefinedInitials(t: string): Set<string> {
  return new Set(t.includes('(') ? [...t.matchAll(RE_PERSON_DEFINED_INI)].map((m) => m[1]) : []);
}
const RE_DASH_BEFORE = /[–—-][ \t]*$/;
const RE_COLON_LABEL_BEFORE = /(\p{L}+)\.?[ \t]*:[ \t]*$/u;
// Etykieta pola, za którą stoi osoba: podpis, autor, rola, czasownik w czasie przeszłym („Sporządził:”).
const RE_SIGN_LABEL = /^(?:podpis|autor|odp|osob|kontakt|wykonawc|referent|prowadząc|opiekun|koordynator|odpowiedzialn|uczestni|obecn|świad|sporządz|zatwierdz|sprawdz|opracow|przygotow|akceptow|weryfik|zgłasz)/iu;
const isSignLabel = (label: string): boolean =>
  RE_SIGN_LABEL.test(label) || RE_PERSON_LABEL.test(label) || ROLE_WORDS.has(label.toLowerCase()) || /\p{Ll}(?:ał|ała|ił|iła|ył|yła|ął|ęła|eł|li|ły)$/u.test(label);
function propagateInitials(ctx: RedactCtx, seeds: Seed[]): void {
  const owners = new Map<string, Map<string, Seed>>();
  for (const s of seeds) {
    if (!s.surnameForm || !s.firstInitials.length) continue;
    const parts = s.surnameForm.split('-').map((p) => p[0].toUpperCase());
    const combos = new Set<string>();
    const f0 = s.firstInitials[0];
    combos.add(f0 + parts[0]);
    combos.add(f0 + parts.join(''));
    if (s.firstInitials.length > 1) combos.add(s.firstInitials.slice(0, 2).join('') + parts.join(''));
    for (const c of combos) {
      const m = owners.get(c) ?? new Map<string, Seed>();
      m.set(s.surname ?? s.mask, s);
      owners.set(c, m);
    }
  }
  if (!owners.size) return;
  let defined: Set<string> | undefined;
  let personDefined: Set<string> | undefined;
  ctx.text = ctx.text.replace(RE_INITIALS, (m: string, a, b, c, bare: string | undefined, offset: number, t: string) => {
    const letters = bare ?? `${a}${b}${c ?? ''}`;
    const own = owners.get(letters);
    if (!own || own.size !== 1) return m;
    if ((bare && RE_ROMAN.test(letters)) || ALWAYS_KEEP_INITIALS.has(letters) || INITIAL_EXAMS.has(letters)) return m;
    const after = t.slice(offset + m.length, offset + m.length + 20);
    // za inicjałami nazwisko albo maska: „A.S. Nowak” scala finalizePersons
    if (/^[ \t]+(?:\p{Lu}\p{Ll}|\[)/u.test(after)) return m;
    if (bare) {
      const before = t.slice(Math.max(0, offset - 20), offset);
      // gołe wersaliki obok innych wersalików albo liczby to skrót („PROTOKÓŁ NR 5”, „5 KB”)
      if (/\p{Lu}{2,}[ \t]*$|\d[ \t]*$/u.test(before) || /^[ \t]*(?:\p{Lu}{2,}|\d)/u.test(after)) return m;
      // i tylko w miejscu osoby: po „przez/dla”, myślniku, dwukropku, nawiasie albo czasowniku
      // („utrzymuje JS”); „do akceptacji MZ” to urząd
      if (!RE_BARE_INI_SLOT.test(before)) return m;
      const slot = RE_SLOT_WORD.exec(before);
      if (slot && /ła?$/.test(slot[1])) {
        if (RE_NOUN_AL.test(slot[1].toLowerCase())) return m;
        // Wyraz na -ł z wielkiej litery na początku zdania, a za inicjałami ciąg zdania: rzeczownik-podmiot
        // („Kanał JK na platformie działa”, „Dział TZ i materiał PS przekazano”), nie podpis.
        const slotAt = offset - before.length + slot.index;
        if (/^\p{Lu}/u.test(slot[1]) && atSentenceStart(t, slotAt) && !RE_CLAUSE_END_AFTER.test(after)) return m;
      }
      // Inicjały podane przy osobie („Adam Kowalski (AK)”) należą do niej mimo zbieżności ze skrótem.
      const ownDefined = (personDefined ??= personDefinedInitials(t)).has(letters);
      // skrót rozwinięty w piśmie („Ministerstwo Zdrowia (MZ)”, „Armii Krajowej (AK)”) to nazwa wszędzie
      if (!ownDefined && (defined ??= definedAbbreviations(ctx.raw)).has(letters)) return m;
      // pole formularza: tylko etykieta osoby („Sporządził: MZ”); „Kraj: PL”, „Kod: AB” to wartość
      const label = RE_COLON_LABEL_BEFORE.exec(before)?.[1];
      const signLabel = !!label && isSignLabel(label);
      if (label && !signLabel) return m;
      // skrót urzędu albo partii po czasowniku, „przez”, „dla” albo w nawiasie („wydał MF”, „przez PO”)
      // jawny; w polu podpisu i w wyliczeniu po myślniku („14–18 lipca – MK”) to osoba
      if (OFFICE_ABBR.has(letters) && !signLabel && !ownDefined && !RE_DASH_BEFORE.test(before)) return m;
    }
    ctx.bump('IMIE');
    return [...own.values()][0].mask;
  });
}

const RE_LOGIN_TOKEN = /[a-z][a-z0-9]*(?:[._][a-z0-9]+)*/g;
/** Login z imienia i nazwiska osoby z pisma („amazur”, „a.mazur”, „kzielinska”), przez propagację loginów. */
function propagateSeedLogins(ctx: RedactCtx, seeds: Seed[]): void {
  if (!ctx.on('LOGIN')) return;
  const values = new Set<string>();
  for (const s of seeds) {
    if (!s.surnameForm || !s.firstLemmas.length) continue;
    const surs = new Set([s.surnameForm.toLowerCase(), surnameBase(s.surnameForm) ?? '']);
    for (const raw of surs) {
      const sur = foldAscii(raw).replace('-', '');
      if (!/^[a-z]{3,}$/.test(sur)) continue;
      for (const l of s.firstLemmas) {
        const f = foldAscii(l);
        if (!/^[a-z]+$/.test(f)) continue;
        for (const v of [`${f[0]}${sur}`, `${f[0]}.${sur}`, `${f}.${sur}`, `${f}_${sur}`, `${sur}.${f}`, `${f}${sur}`]) if (v.length >= 5) values.add(v);
      }
    }
  }
  if (!values.size) return;
  // tylko wartości obecne w tekście: jeden przebieg po wyrazach zamiast wzorca na każdą kandydatkę
  const present = new Set(ctx.text.match(RE_LOGIN_TOKEN) ?? []);
  const hits = new Set([...values].filter((v) => present.has(v)));
  if (hits.size) propagateLoginValues(ctx, hits);
}

/** Rozlewa osoby potwierdzone w piśmie na pozostałe wzmianki. Po przebiegach osobowych, przed finalizePersons. */
export function passPersonPropagate(ctx: RedactCtx): void {
  if (!ctx.on('IMIE') || !(ctx.text.includes('[OSOBA-') || ctx.text.includes(ctx.M.IMIE))) return;
  const seeds = buildSeeds(ctx);
  if (!seeds.length) return;
  propagateSeedLogins(ctx, seeds);
  propagateNames(ctx, seeds);
  propagateInitials(ctx, seeds);
}
