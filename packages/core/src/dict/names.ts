// Słowniki imion (polskie, obce, formy odmienione i zapisy bez ogonków) oraz testy „czy to imię”.
import { foldAscii } from '../surnames.js';

// Imiona pełne i zdrobnienia w mianowniku. Bez zdrobnień kolidujących z rzeczownikami (kuba, maks,
// misiek, ryś), bo imię maskujemy tylko w parze z nazwiskiem albo po wyzwalaczu.
export const POLISH_FIRST_NAMES = new Set<string>(
  (
    'adam adrian agata agnieszka aleksander aleksandra alicja alina amelia andrzej aniela anna ' +
    'antoni antonina arkadiusz artur bartłomiej bartosz beata bogdan bogumił bogusław bożena ' +
    'cezary daniel danuta dariusz dawid dominik dominika dorota edward elżbieta emil emilia ewa ' +
    'ewelina filip franciszek gabriel gabriela grażyna grzegorz halina hanna helena henryk hubert ' +
    'igor ilona irena iwona izabela jacek jadwiga jakub jan janina janusz jarosław jerzy joanna ' +
    'jolanta józef julia julian justyna kacper kamil kamila karina karol karolina katarzyna kazimierz ' +
    'kinga klaudia konrad krystyna krzysztof lena leszek lidia ludwik łukasz maciej magdalena maja ' +
    'małgorzata marcin marek maria mariola mariusz marta martyna mateusz michał mieczysław mikołaj ' +
    'milena mirosław mirosława monika nadia natalia nikodem nikola norbert oliwia oskar patryk patrycja ' +
    'paulina paweł piotr przemysław rafał radosław renata robert roman ryszard sandra sebastian ' +
    'sławomir stanisław stanisława stefan stefania sylwester sylwia szymon tadeusz teresa tomasz ' +
    'urszula wacław waldemar weronika wiesław wiktor wiktoria wincenty witold władysław włodzimierz ' +
    'wojciech zbigniew zdzisław zofia zuzanna ' +
    'edyta aneta iga izabella jagoda klara liliana lucyna łucja marzena nina olga otylia sabina wanda ' +
    'żaneta róża blanka cecylia dagmara diana eliza elwira felicja kalina laura ludmiła malwina michalina ' +
    'oktawia paula rozalia sara wioletta wiola bogna pola nadzieja ' +
    'alan borys cyprian damian dionizy erwin ernest fabian gustaw ignacy kajetan kornel ksawery leon lech ' +
    'marceli maurycy maksymilian olaf remigiusz rudolf seweryn teodor tobiasz walenty wit zenon jeremi jędrzej ' +
    'krystian leonard iwo alojzy bruno feliks gerard konstanty maksym miron przemek roch salomon tymon tymoteusz ' +
    'pamela melania kornelia apolonia sonia tamara żaklina walentyna celina aurelia benedykt alfred edmund herbert oktawian klemens ' +
    'barbara genowefa czesław bronisław eugeniusz ' +
    'janek jaś tomek tomcio franek franio staś stasiek staszek michałek michaś wojtek wojtuś bartek ' +
    'bartuś maciek maciuś piotrek piotruś krzysiek krzyś grzesiek grześ adaś jędrek jędrko jędruś olek ' +
    'oleś romek romcio heniek henio władek stefek zbyszek zbyś mietek antek antoś benek benio gustek ' +
    'kacperek kajtek kubuś mirek darek arek radek rafałek sławek sylwek tadek tymek tymuś wicek ' +
    'witek zenek kamilek konradek oskarek filipek szymek szymuś dawidek damianek bronek gienek jurek ' +
    'marecik nikodemek tobiaszek gabrielek borysek cyprianek fabianek sebastianek ksaweryk arturek ' +
    'andrzejek ignaś leoś lucek zdzisiek zdziś czesiek józek longinek walek wawrek gieniek heniuś ' +
    'kasia zosia basia gosia małgosia madzia ania hania asia jola renia marysia magda magdusia dorotka ' +
    'dorka dosia kingusia natalka julka julcia ulcia wiktorka gabrysia monisia monka kamcia martusia ' +
    'marteczka danusia danka halinka krysia kryśka jadzia wiesia stefcia bożenka tereska tesia elka ewka ' +
    'ewelinka kaśka gośka baśka zośka agatka alcia anka hanka izabelka joasia józia karolinka lidka ' +
    'lucynka marlenka natusia olcia olka paulinka roksanka sabinka sylwka wandzia weronka wiolka zuzia ' +
    'zuzka jagusia kalinka klaudka kornelka michasia martunia nikolka otylka rózia tosia beatka anetka ' +
    'aneczka emilka klarka nelka nadzia oleńka helcia'
  ).split(/\s+/),
);
/** Dopełniacz imienia: męskiego („Jacka", „Pawła") albo żeńskiego („Anny", „Marii", „Haliny"). */
export function isFirstNameGenitive(w: string): boolean {
  return isMaleFirstNameGenitive(w) || (/[iy]$/.test(w) && POLISH_FIRST_NAMES.has(`${w.slice(0, -1)}a`));
}
/** Dopełniacz męskiego imienia („Jacka", „Marka", „Pawła", „Jana") — patron, choć „Jacka" ma
 *  końcówkę żeńskiego nazwiska na -cka. Ruchome „e" jak w słowniku nazwisk (Jacek → Jacka). */
export function isMaleFirstNameGenitive(w: string): boolean {
  if (!w.endsWith('a')) return false;
  const stem = w.slice(0, -1);
  return POLISH_FIRST_NAMES.has(stem) || POLISH_FIRST_NAMES.has(stem.replace(/([^aeiouyąęó])([^aeiouyąęó])$/, '$1e$2'));
}

// Częste obce imiona: bramka reguły imion z myślnikiem („Jean-Pierre Dubois”). Bez niej każda para
// „Xxx-Yyy Zzz” (miasto spoza słownika, firma) byłaby osobą. Tylko imiona, które nie są toponimami.
export const FOREIGN_GIVEN_NAMES = new Set<string>(
  (
    'jean pierre paul marie anne claude luc marc jacques michel andre andré louis henri ' +
    'francois françois rené rene yves hans karl heinz klaus peter ernst fritz dieter uwe ' +
    'kurt otto rolf wolf horst jurgen jürgen john james david michael mary sarah kevin ' +
    'jose josé juan carlos luis pedro miguel diego pablo ana maria luigi giovanni marco ' +
    'ali ahmed mohamed muhammad omar hassan ibrahim mustafa abdul kim lee chen wang li ' +
    'minh thi anh van duc thu erik lars sven nils per ola'
  ).split(/\s+/),
);

// Rdzenie imion (żeńskie bez końcowego „a”) do rozpoznania form odmienionych („Anną”, „Janem”).
const FIRST_NAME_STEMS = new Set<string>(
  [...POLISH_FIRST_NAMES].map((n) => (n.endsWith('a') ? n.slice(0, -1) : n)),
);
// Bez pustego sufiksu: mianownik pokrywa POLISH_FIRST_NAMES, a sam rdzeń („maj” z „Maja”) dawał
// fałszywe trafienia („Pierwszego Maja”).
const NAME_INFLECTIONS = ['a', 'i', 'y', 'ie', 'ę', 'ą', 'o', 'u', 'e', 'em', 'owi'];

// Formy, których rdzeń + końcówka nie odtwarza: ruchome „e” (Marek → Marka, Paweł → Pawłem),
// „-iem” po k/g, odmiana przymiotnikowa (Jerzego, Antoniemu), zdrobnienia na -sia, -zia, -cia, -nia (Kasi),
// „-ś” (Jasia) i oboczności żeńskie (Agacie, Monice, Jadwidze, Barbarze, Jagodzie).
// Formy będące też słowem pospolitym („marka”, „ani”) są imieniem tylko tuż przed potwierdzonym
// nazwiskiem (patrz finalizePersons). „Franek” i „Walek” bez ruchomego „e”, bo „franka” i „walka”.
export const COLLIDING_NAME_FORMS = new Set<string>('marka ani arka witka antonim dance'.split(' '));
export const EXTRA_NAME_FORMS = ((): Set<string> => {
  const out = new Set<string>();
  const add = (...fs: string[]) => {
    for (const f of fs) if (!COLLIDING_NAME_FORMS.has(f) && !POLISH_FIRST_NAMES.has(f)) out.add(f);
  };
  const soft: Record<string, string> = { si: 'ś', zi: 'ź', ci: 'ć', ni: 'ń' };
  for (const n of POLISH_FIRST_NAMES) {
    if (!/^[a-ząćęłńóśźż]{3,}$/.test(n)) continue;
    if (n.endsWith('ek') && n.length >= 5 && n !== 'franek' && n !== 'walek') {
      const s = n.slice(0, -2).replace(/(si|zi|ci|ni)$/, (x) => soft[x]) + 'k';
      add(`${s}a`, `${s}owi`, `${s}iem`);
    } else if (n.endsWith('eł')) {
      const s = `${n.slice(0, -2)}ł`;
      add(`${s}a`, `${s}owi`, `${s}em`, `${n.slice(0, -2)}le`);
    } else if (/[kg]$/.test(n)) {
      add(`${n}iem`);
    } else if (n.endsWith('ś')) {
      const s = `${n.slice(0, -1)}si`;
      add(`${s}a`, `${s}owi`, `${s}em`);
    } else if (/(?:si|zi|ci|ni)a$/.test(n)) {
      add(n.slice(0, -1));
    } else if (/ta$/.test(n)) add(`${n.slice(0, -2)}cie`);
    else if (/ka$/.test(n)) add(`${n.slice(0, -2)}ce`);
    else if (/ga$/.test(n)) add(`${n.slice(0, -2)}dze`);
    else if (/ra$/.test(n)) add(`${n.slice(0, -2)}rze`);
    else if (/da$/.test(n)) add(`${n.slice(0, -2)}dzie`);
  }
  for (const n of ['jerzy', 'ignacy', 'konstanty', 'dionizy', 'ksawery', 'walenty', 'alojzy']) {
    const s = n.slice(0, -1);
    add(`${s}ego`, `${s}emu`, `${s}ym`);
  }
  for (const n of ['antoni', 'jeremi', 'marceli']) add(`${n}ego`, `${n}emu`, `${n}m`);
  return out;
})();

// Imiona bez polskich znaków (czat, SMS, OCR: „Pawel”), tylko dla słowa w całości ASCII. Pomijamy
// imiona, których zapis bez ogonków jest zwykłym słowem (kaśka → kaska, żaklina → zaklina), i formy
// będące słowami (stasi, rafale).
const FOLD_SKIP = new Set<string>('róża kaśka żaklina'.split(' '));
const FOLD_FORM_STOP = new Set<string>('stasi rafale'.split(' '));
const hasPlDiacritic = (s: string): boolean => /[ąćęłńóśźż]/.test(s);
const FOLDED_FIRST_NAMES = new Set<string>(
  [...POLISH_FIRST_NAMES, ...EXTRA_NAME_FORMS]
    .filter((n) => hasPlDiacritic(n) && ![...FOLD_SKIP].some((x) => n.startsWith(x.slice(0, -1))))
    .map(foldAscii)
    .filter((f) => !FOLD_FORM_STOP.has(f)),
);
const FOLDED_FIRST_NAME_STEMS = new Set<string>(
  [...POLISH_FIRST_NAMES]
    .filter((n) => hasPlDiacritic(n) && !FOLD_SKIP.has(n))
    .map((n) => foldAscii(n.endsWith('a') ? n.slice(0, -1) : n)),
);
const FOLDED_INFLECTIONS = ['a', 'i', 'y', 'ie', 'e', 'o', 'u', 'em', 'owi'];

const hasInflectedStem = (w: string, sufs: readonly string[], stems: Set<string>): boolean =>
  sufs.some((s) => w.endsWith(s) && w.length - s.length >= 2 && stems.has(w.slice(0, -s.length)));

/** Czy słowo wygląda na polskie imię (mianownik ze słownika albo forma odmieniona)? */
export function isFirstNameLike(word: string): boolean {
  const w = word.toLowerCase();
  if (POLISH_FIRST_NAMES.has(w) || EXTRA_NAME_FORMS.has(w)) return true;
  if (hasInflectedStem(w, NAME_INFLECTIONS, FIRST_NAME_STEMS)) return true;
  if (!/^[a-z]{3,}$/.test(w) || FOLD_FORM_STOP.has(w)) return false;
  return FOLDED_FIRST_NAMES.has(w) || hasInflectedStem(w, FOLDED_INFLECTIONS, FOLDED_FIRST_NAME_STEMS);
}
// Imiona będące też rzeczownikiem albo nazwą rośliny („róża”, „kalina”, „maja”): pisane małą literą
// bez nazwiska nie przesądzają o osobie.
export const NOUN_LIKE_FIRST_NAMES = new Set<string>('róża kalina jagoda nadzieja wiktoria pola wiola maja'.split(' '));
