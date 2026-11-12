// Regexy reguł osobowych (pary, ciągi nazw, pojedyncze nazwiska) kompilowane raz na moduł.
import { CAP_WORD, LO_WORD, NM_BOUND, NM_LO, NM_LO_EXTRA, PL_LO, PL_UP } from './charset.js';

/** Litera spoza polskiego alfabetu w wyrazie z CAP_WORD (same litery i łącznik). */
export const RE_NON_PL_LETTER = new RegExp(`[^${PL_UP}${PL_LO}-]`);
/** Marka z obcą literą po nazwisku („Pan Nowak Škoda”, „Pani Mróz Citroënem”), rdzeń w dowolnym przypadku. */
export const RE_FOREIGN_BRAND_WORD = /^(?:škod|citroën|löwenbräu|nestlé|hermès|moët|häagen)/iu;
/** Polska końcówka przypadka zależnego na obcym wyrazie („Škodę”, „Müllerowi”). */
export const RE_PL_OBLIQUE_ENDING = /(?:owi|ę|ą|em|iem|ów|ach|ami|om)$/u;
// Separator członów to [ \t]+ bez \n, żeby nazwisko na końcu wiersza nie skleiło się z następną linią.
// Prawa granica na końcu każdego wzorca nie pozwala dopasować połowy tokenu (OCR „KowaIski”).
// W RE_SPOUSES grupa 2 („ i ”/„ oraz ”) wraca do wyniku w oryginalnym zapisie.
export const RE_SPOUSES = new RegExp(`(?<![${NM_BOUND}-])(${CAP_WORD})([ \\t]+(?:i|oraz)[ \\t]+)(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
export const RE_NAME_SEQ = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?:[ \\t]+${CAP_WORD}){1,3}(?![${NM_BOUND}])`, 'g');
// Wyraz z wielkiej litery tuż za porcją RE_NAME_SEQ w tej samej linii (wznowienie okna).
export const RE_NEXT_CAP_WORD = new RegExp(`^[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`);
// Współdzielony przez kilka przebiegów; bezpieczne, bo .replace zeruje lastIndex.
export const RE_PAIR = new RegExp(`(?<![${NM_BOUND}-])(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
// Prawy kontekst pary tylko przez spacje: tabulator zaczyna następną komórkę.
export const RE_NEXT_CAP_WORD_SP = new RegExp(`^ +(${CAP_WORD})`);
// Słownikowy rdzeń z ogonem obcych liter („Kovalčuk”, transliteracja ISO 9) to jeden wyraz i maska
// obejmuje całość. Ogon tylko od spółgłoski z haczykiem: samogłoska z akcentem po polskim rdzeniu
// to zwykle obcy wyraz („Politécnica”), który zostaje bez maski.
export const RE_SOLO_DICT = new RegExp(`(?<![${NM_BOUND}-])[${PL_UP}][${PL_LO}]+(?:[${NM_LO_EXTRA}][${NM_LO}]*)?(?![${NM_BOUND}-])`, 'g');
export const RE_FOREIGN_TAIL_START = new RegExp(`[${NM_LO_EXTRA}]`);
export const RE_SLAVIC_TAIL_START = /^[čšžřňťďľ]/;
export const RE_SOLO_MORPH = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?![${NM_BOUND}])`, 'g');
// Ciąg wyrazów małymi literami; lewa granica odcina fragmenty e-maili, URL-i i domen.
export const RE_LOWER_RUN = new RegExp(
  `(?<![${PL_UP}${PL_LO}@./-])${LO_WORD}(?:[ \\t]+${LO_WORD}){1,6}(?![${PL_UP}${PL_LO}-])`,
  'g',
);
// Wyraz kapitalizowany z homoglifem OCR w środku („KowaIski": wielkie I albo 1 zamiast l, 0 zamiast o).
export const OCR_MIX_WORD = `[${PL_UP}][${PL_LO}]*[I01][${PL_LO}I01]*`;
// Wyraz z homoglifem OCR: kapitalizowany jak OCR_MIX_WORD albo wersalikami z cyfrą („K0WALSKI").
export const OCR_NAME_WORD = `(?:${OCR_MIX_WORD}|[${PL_UP}][${PL_UP}]*[01][${PL_UP}01]*)`;
// Mianownik nazwiska odmiennego jak przymiotnik („Kowalski", „Zielińska"); forma zależna to „Kowalskiego".
export const RE_DECLINED_NOM_SURNAME = /(?:sk|ck|dzk)[ia]$/i;
export const RE_SURNAME_OBLIQUE =
  /(?:sk|ck|dzk)(?:iego|iej|iemu|im|imi|ich|ą)$|icz(?:a|owi|em|owie|ami|ach)$|czyk(?:a|owi|iem|ami|ach|owie)$/;
