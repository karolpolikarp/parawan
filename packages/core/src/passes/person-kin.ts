// Pokrewieństwo i opieka jako kotwica osoby: imię (także zdrobnienie, w każdym przypadku) tuż za
// rzeczownikiem pokrewieństwa („jej syn Kuba”, „córce Oli”, „brat Paweł”, „Żona, Barbara”, „dzieci
// Zuzanna (7 lat) i Antoni”, „my husband Paweł”). Bez maski przed rzeczownikiem; imiona rodziców tuż
// za maską osoby rozstrzyga wcześniej passPersonParents.
import { isConfirmedSurname, looksLikeSurname, surnameBase } from '../surnames.js';
import { CAP_WORD, NM_BOUND, PERSON_MASK_SRC } from '../charset.js';
import type { RedactCtx } from '../context.js';
import { FOREIGN_GIVEN_NAMES, isFirstNameGenitive, isFirstNameLike, WESTERN_GIVEN_NAMES } from '../dict/names.js';
import { POLISH_CITIES } from '../dict/places.js';
import { precededByEponym } from '../guards/eponyms.js';
import { inBiblicalSentence, isDeclinedNominativeName, KIN_SRC, kinCaseAgrees, kinHeadOk, kinIsPluralNominative, kinIsReligiousOrFolkTitle } from '../guards/kinship.js';
import { LEGAL_ENTITY_WORDS, ROLE_WORDS, TITLE_WORDS } from '../guards/roles.js';
import { firstNameLemmas } from './person-propagate.js';

const capitalize = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);

// Postacie sakralne: „Jezus, syn Józefa i Maryi”, „Syn Boży”. Forma „Maryja” to tylko Matka Boża.
const RE_SACRED_NAME = /^(?:maryj[aeiąęo]|maryi|jezus\p{Ll}*|chrystus\p{Ll}*|bóg|boga|bogu|bogiem|boż\p{Ll}*)$/u;
const RE_SACRED_BEFORE = /(?<!\p{L})(?:Jezus\p{Ll}*|Chrystus\p{Ll}*|Bóg|Boga|Bogu|Maryj\p{Ll}*|Maryi)[ \t]*,?[ \t]*$/u;

/** Klucz pseudonimu dla imienia za rzeczownikiem pokrewieństwa albo null, gdy wyraz nie jest imieniem. */
function kinGivenKey(w: string): string | null {
  const l = w.toLowerCase();
  if (RE_SACRED_NAME.test(l) || ROLE_WORDS.has(l) || TITLE_WORDS.has(l) || LEGAL_ENTITY_WORDS.has(l)) return null;
  const lemmas = firstNameLemmas(l);
  if (lemmas.length) return capitalize(lemmas[0]);
  if (POLISH_CITIES.has(l)) return null;
  if (isFirstNameLike(l) || FOREIGN_GIVEN_NAMES.has(l) || WESTERN_GIVEN_NAMES.has(l)) return w;
  return null;
}
// Imię matki spoza słownika w dopełniaczu po „i” za imieniem ojca („syn Władysława i Genowefy”).
const motherGenitive = (w: string): boolean =>
  !RE_SACRED_NAME.test(w.toLowerCase()) && /^\p{Lu}\p{Ll}+[iy]$/u.test(w) && !surnameBase(w) && !looksLikeSurname(w);

// Rzeczownik, opcjonalnie dopełnienie małą literą przed przecinkiem („syn zmarłego, Andrzej”), i imię.
// Rzeczownik bywa też etykietą z dwukropkiem albo myślnikiem, jak w formularzach i notatkach
// („Dzieci: Oliwia i Filip”, „Syn: Piotr, ur. 2015”, „dzieci – Oliwia”).
const RE_KIN_NAME = new RegExp(
  `(?<![${NM_BOUND}])(${KIN_SRC})((?:[ \\t]+[a-ząćęłńóśźż]{2,15})?[ \\t]*,[ \\t]+|[ \\t]*:[ \\t]{1,8}|[ \\t]+[–—-][ \\t]+|[ \\t]+)(${CAP_WORD})(?![${NM_BOUND}0-9])`,
  'g',
);
const RE_LABEL_SEP = /[:–—-]/;
// Za przecinkiem imię musi kończyć wtrącenie („Żona, Barbara, ale…”), inaczej to początek nowego zdania.
const RE_APPOSITION_END = /^(?:[ \t]*(?:[,.;:!?)…]|\r?\n|$)|[ \t]+(?:i|oraz)[ \t]|[ \t]*\()/u;
// Nazwisko tuż za imieniem, które nie trafiło do pary; za końcem wiersza tylko nazwisko kończące wpis
// („Żona Anna⏎Kowalska, w 1/2 części”).
const RE_SURNAME_AFTER = new RegExp(`^([ \\t]+|[ \\t]*\\r?\\n[ \\t]*)(${CAP_WORD})(?![${NM_BOUND}0-9])`);
const RE_ENTRY_END = /^[ \t]*(?:[,;]|\r?\n|$)/;
// Nazwisko zakryte już wcześniej („Żona Anna⏎[maska]”): imię wchodzi do tej maski.
const RE_MASK_AFTER = new RegExp(`^(?:[ \\t]+|[ \\t]*\\r?\\n[ \\t]*)(${PERSON_MASK_SRC})`);
// Kolejne imię wyliczenia („Zuzanna (7 lat) i Antoni”).
const RE_NEXT_NAME = new RegExp(`^((?:[ \\t]*\\([^()\\n]{1,20}\\))?(?:[ \\t]*,[ \\t]*|[ \\t]+(?:i|oraz)[ \\t]+))(${CAP_WORD})(?![${NM_BOUND}0-9])`);
// Liczebnik władcy albo przydomek za imieniem („żona Jana III Sobieskiego”, „Synowie Marka Aureliusza”,
// „Matka Jana Pawła II”): imię jest częścią dłuższej nazwy, której maska by nie objęła. Wtedy bez maski,
// żeby nie ciąć całości. Sprawdzane za końcem całego ciągu (kolejne imiona, nazwisko), nie tylko za
// pierwszym imieniem.
const RE_ROMAN_AFTER = /^[ \t]+[IVXLC]{1,6}(?![\p{L}\d])/u;
const RE_CAP_AFTER = new RegExp(`^[ \\t]+(${CAP_WORD})(?![${NM_BOUND}0-9])`);
const isGivenWord = (w: string): boolean => {
  const l = w.toLowerCase();
  return isFirstNameLike(l) || FOREIGN_GIVEN_NAMES.has(l) || WESTERN_GIVEN_NAMES.has(l);
};
/**
 * Czy za ciągiem od `end` stoi liczebnik rzymski albo wyraz z wielkiej litery spoza słowników imion,
 * nazwisk i miejscowości (część nazwy). Kolejne imiona („Jana Pawła”) są przeskakiwane.
 */
function trailingNamePart(t: string, end: number): boolean {
  let at = end;
  for (let i = 0; i < 4; i++) {
    const after = t.slice(at, at + 60);
    if (RE_ROMAN_AFTER.test(after)) return true;
    const cap = RE_CAP_AFTER.exec(after);
    if (!cap) return false;
    const w = cap[1];
    if (!isGivenWord(w)) return !surnameBase(w) && !looksLikeSurname(w) && !POLISH_CITIES.has(w.toLowerCase());
    at += cap[0].length;
  }
  return false;
}
const RE_FIRM_AFTER = /^[ \t]{0,8}(?:[Ss]p\.|[Ss]\.[ \t]?[Cc]\.|S\.?A\.|[Ss]półk|Ltd|GmbH|Inc|LLC|&)/u;

/** Czy wyraz za imieniem to jego nazwisko (jedna maska na całość). */
function surnameAfter(t: string, end: number): RegExpExecArray | null {
  const sur = RE_SURNAME_AFTER.exec(t.slice(end, end + 60));
  if (!sur) return null;
  if (sur[1].includes('\n') && !RE_ENTRY_END.test(t.slice(end + sur[0].length))) return null;
  const sl = sur[2].toLowerCase();
  if (!isConfirmedSurname(sl) || isFirstNameLike(sl) || POLISH_CITIES.has(sl) || LEGAL_ENTITY_WORDS.has(sl) || ROLE_WORDS.has(sl)) return null;
  return sur;
}

export function passPersonKinship(ctx: RedactCtx): void {
  if (!ctx.on('IMIE')) return;
  const t = ctx.text;
  const re = RE_KIN_NAME;
  re.lastIndex = 0;
  let out = '';
  let last = 0;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const [, kin, sep, name] = m;
    const nameAt = m.index + kin.length + sep.length;
    let end = nameAt + name.length;
    const key = kinGivenKey(name);
    const after = t.slice(end, end + 60);
    const masked = RE_MASK_AFTER.exec(t.slice(end, end + 40));
    const sur = masked ? null : surnameAfter(t, end);
    const spanEnd = end + (masked ? masked[0].length : sur ? sur[0].length : 0);
    const before = t.slice(Math.max(0, m.index - 40), m.index);
    const ok =
      !!key &&
      kinHeadOk(t, m.index, kin) &&
      // „synowi Marek kupił”, „dzieciom Mikołaj przyniósł”: imię w mianowniku to podmiot, nie krewny
      kinCaseAgrees(kin, name) &&
      // etykieta („Dzieci: Filip chodzi…”) rozstrzyga dwuznaczność mianownika z dopełniaczem
      (!kinIsPluralNominative(kin) || RE_LABEL_SEP.test(sep) || !isDeclinedNominativeName(name) || RE_APPOSITION_END.test(after)) &&
      !kinIsReligiousOrFolkTitle(kin, name, firstNameLemmas(name), after, before, sur ? sur[2] : masked ? masked[1] : null) &&
      !trailingNamePart(t, end) &&
      (spanEnd === end || !trailingNamePart(t, spanEnd)) &&
      !inBiblicalSentence(t, m.index) &&
      !RE_SACRED_BEFORE.test(t.slice(Math.max(0, m.index - 20), m.index)) &&
      !precededByEponym(t, nameAt) &&
      !RE_FIRM_AFTER.test(t.slice(end)) &&
      (!sep.includes(',') || RE_APPOSITION_END.test(t.slice(end)));
    if (!key || !ok) {
      // odrzucone imię może samo być rzeczownikiem pokrewieństwa następnej pary
      re.lastIndex = m.index + kin.length;
      continue;
    }
    let rep: string;
    if (masked) {
      rep = masked[1];
      end += masked[0].length;
    } else {
      ctx.bump('IMIE');
      if (sur) end += sur[0].length;
      rep = ctx.personMask(sur ? sur[2] : key);
    }
    // wyliczenie imion za tym samym rzeczownikiem
    let prev = name;
    for (let i = 0; i < 3; i++) {
      const nx = RE_NEXT_NAME.exec(t.slice(end, end + 60));
      if (!nx) break;
      const k2 = kinGivenKey(nx[2]) ?? (/[ \t]i[ \t]/.test(nx[1]) && isFirstNameGenitive(prev.toLowerCase()) && motherGenitive(nx[2]) ? nx[2] : null);
      if (!k2) break;
      ctx.bump('IMIE');
      rep += `${nx[1]}${ctx.personMask(k2)}`;
      end += nx[0].length;
      prev = nx[2];
    }
    out += t.slice(last, nameAt) + rep;
    last = end;
    re.lastIndex = end;
  }
  if (last === 0) return;
  ctx.text = out + t.slice(last);
}
