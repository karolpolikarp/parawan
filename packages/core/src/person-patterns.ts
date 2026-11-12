import { CAP_WORD, LO_WORD, NM_BOUND, NM_LO, NM_LO_EXTRA, PL_LO, PL_UP } from './charset.js';

/** Litera spoza polskiego alfabetu w wyrazie z CAP_WORD (same litery i łącznik). */
export const RE_NON_PL_LETTER = new RegExp(`[^${PL_UP}${PL_LO}-]`);
/** Marka z obcą literą po nazwisku („Pan Nowak Škoda", „Pani Mróz Citroënem") — rdzeń, dowolny przypadek. */
export const RE_FOREIGN_BRAND_WORD = /^(?:škod|citroën|löwenbräu|nestlé|hermès|moët|häagen)/iu;
/** Polska końcówka przypadka zależnego na obcym wyrazie („Škodę", „Müllerowi", „Citroënem"). */
export const RE_PL_OBLIQUE_ENDING = /(?:owi|ę|ą|em|iem|ów|ach|ami|om)$/u;
// Separatory między członami nazwy to [ \t]+ (BEZ \n) — nazwisko na końcu wiersza NIE może
// skleić się z pierwszym wyrazem następnej linii (psuło układ i wciągało etykiety formularzy).
// Prawa granica `(?![PL_UP PL_LO])` na KOŃCU każdego wzorca: bez niej token mieszany
// („KowaIski" z OCR-owym I zamiast l, „McDonald") był dopasowywany DO POŁOWY — wprost
// („Jan Kowa|Iski") albo po backtrackingu („Jan Kow|aIski") — i maska ucinała słowo
// („[OSOBA-A]Iski" — wyciek fragmentu nazwiska; maskuj całość, nie fragment).
// Środek „ i "/„ oraz " przechwycony (grupa 2), bo wraca do wyniku w oryginalnym zapisie.
export const RE_SPOUSES = new RegExp(`(?<![${NM_BOUND}-])(${CAP_WORD})([ \\t]+(?:i|oraz)[ \\t]+)(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
export const RE_NAME_SEQ = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?:[ \\t]+${CAP_WORD}){1,3}(?![${NM_BOUND}])`, 'g');
// Wyraz z wielkiej litery tuż za porcją RE_NAME_SEQ w tej samej linii (wznowienie okna w kroku (a)).
export const RE_NEXT_CAP_WORD = new RegExp(`^[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`);
export const RE_PAIR = new RegExp(`(?<![${NM_BOUND}-])(${CAP_WORD})[ \\t]+(${CAP_WORD})(?![${NM_BOUND}])`, 'g');
// Następny wyraz z wielkiej litery tuż za dopasowaniem (prawy kontekst pary w kroku a2). Tylko
// przez spacje — tabulator zaczyna następną komórkę.
export const RE_NEXT_CAP_WORD_SP = new RegExp(`^ +(${CAP_WORD})`);
// Słownikowy rdzeń z ogonem obcych liter („Kovalčuk", „Bondarčuk", „Petrovyč" — transliteracja
// ISO 9 w tłumaczeniach przysięgłych) to jeden wyraz: rozstrzyga o nim rdzeń, a maska obejmuje
// całość. Dawniej maska kończyła się przed „č" („[..]čuk"), a sama granica obcych liter oddawała
// całe nazwisko jawne. Ogon tylko od spółgłoski z haczykiem (č, š, ž, ř, ň, ť, ď, ľ): samogłoska
// z akcentem po polskim rdzeniu to zwykle obcy wyraz („Universidad Politécnica" — rdzeń „Polit"
// jest w słowniku nazwisk), więc taki wyraz zostaje bez maski.
export const RE_SOLO_DICT = new RegExp(`(?<![${NM_BOUND}-])[${PL_UP}][${PL_LO}]+(?:[${NM_LO_EXTRA}][${NM_LO}]*)?(?![${NM_BOUND}-])`, 'g');
export const RE_FOREIGN_TAIL_START = new RegExp(`[${NM_LO_EXTRA}]`);
export const RE_SLAVIC_TAIL_START = /^[čšžřňťďľ]/;
export const RE_SOLO_MORPH = new RegExp(`(?<![${NM_BOUND}-])${CAP_WORD}(?![${NM_BOUND}])`, 'g');
export const RE_LOWER_RUN = new RegExp(
  `(?<![${PL_UP}${PL_LO}@./-])${LO_WORD}(?:[ \\t]+${LO_WORD}){1,6}(?![${PL_UP}${PL_LO}-])`,
  'g',
);
export const RE_SURNAME_OBLIQUE =
  /(?:sk|ck|dzk)(?:iego|iej|iemu|im|imi|ich|ą)$|icz(?:a|owi|em|owie|ami|ach)$|czyk(?:a|owi|iem|ami|ach|owie)$/;
