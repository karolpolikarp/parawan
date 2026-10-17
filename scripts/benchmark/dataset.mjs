/**
 * Syntetyczny zbiór ewaluacyjny do benchmarku precision/recall anonimizacji polskiego PII.
 *
 * DETERMINIZM: wszystkie wartości losowe pochodzą z PRNG mulberry32 z STAŁYM ziarnem
 * (SEED poniżej). Brak wywołań Math.random() bez ziarna — dwa uruchomienia generatora
 * dają IDENTYCZNY zbiór (stabilne porównania między wersjami silnika).
 *
 * Format przypadku:
 *   { id, category, text, mustMask: [...], mustKeep: [...] }
 *   - mustMask — dokładne podłańcuchy, które MUSZĄ zniknąć z wyniku redakcji (miara recall);
 *   - mustKeep — podłańcuchy, które MUSZĄ pozostać (miara precision-proxy; „zjedzenie"
 *     ich przez maskę to fałszywy pozytyw).
 *
 * Kategorie:
 *   - osoby-podstawowe — imię+nazwisko w mianowniku (konteksty: urzędowy/prawniczy/czatowy),
 *     formy żeńskie, mnogie, nazwiska dwuczłonowe, wyzwalacze („nazywam się", „Pan/Pani");
 *   - osoby-odmiana   — samo nazwisko w odmianie (dopełniacz/celownik/narzędnik, l.mn.)
 *     oraz odmienione pary „Jana Kowalskiego" (imię odmienione = znany słaby punkt słownika);
 *   - osoby-rzadkie   — nazwiska rzadkie/wymyślone (Bąkiewicz, Krzemieniecka, Gzowski…),
 *     z imieniem słownikowym, z imieniem rzadkim, solo w odmianie, z wyzwalaczem;
 *   - strukturalne    — PESEL/NIP/REGON/IBAN/telefon/e-mail/kod pocztowy/adres/data ur./dowód
 *     (wszystkie sumy kontrolne LICZONE w generatorze i weryfikowane asercją);
 *   - negatywy        — NIE wolno maskować: numery przepisów, sygnatury akt, Dz.U. poz.,
 *     instytucje, homonimy nazwisk (Wilk/Lis/Baran… jako zwierzęta itp.),
 *     ciągi 10–11 cyfr ze złą sumą kontrolną.
 *
 * Generator asercjami pilnuje własnej spójności: każda wartość „ważna" naprawdę przechodzi
 * walidację sum kontrolnych rdzenia, każda „zła" — nie przechodzi, a każdy podłańcuch
 * mustMask/mustKeep faktycznie występuje w tekście przypadku.
 */

import {
  isValidPesel,
  isValidNip,
  isValidRegon9,
  isValidRegon14,
  isValidIban,
  isValidDowod,
} from '../../packages/core/dist/index.js';

/** Stałe ziarno — zmiana ziarna to ŚWIADOMA zmiana wersji zbioru. */
export const SEED = 20260704;

// ============================================================================
// Deterministyczny PRNG (mulberry32) + pomocnicze
// ============================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randInt = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
const randDigits = (rng, n) => Array.from({ length: n }, () => randInt(rng, 0, 9)).join('');

/** Asercja spójności generatora — błąd tutaj to błąd w SAMYM zbiorze, nie w silniku. */
function assert(cond, msg) {
  if (!cond) throw new Error(`[dataset] Błąd spójności zbioru: ${msg}`);
}

// ============================================================================
// Generatory wartości strukturalnych — sumy kontrolne liczone NA MIEJSCU
// ============================================================================

/** PESEL: data 1950–1999 (miesiąc bez przesunięcia stulecia) + seria + cyfra kontrolna. */
function genPesel(rng) {
  const yy = String(randInt(rng, 50, 99)).padStart(2, '0');
  const mm = String(randInt(rng, 1, 12)).padStart(2, '0');
  const dd = String(randInt(rng, 1, 28)).padStart(2, '0');
  const serial = randDigits(rng, 4);
  const d10 = yy + mm + dd + serial;
  const w = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d10[i]) * w[i];
  const control = (10 - (sum % 10)) % 10;
  const pesel = d10 + String(control);
  assert(isValidPesel(pesel), `wygenerowany PESEL ${pesel} nie przechodzi walidacji`);
  return pesel;
}

/** NIP: 9 cyfr + cyfra kontrolna (sum%11); wynik 10 jest niedozwolony → losujemy ponownie. */
function genNip(rng) {
  for (;;) {
    const d9 = String(randInt(rng, 1, 9)) + randDigits(rng, 8);
    const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(d9[i]) * w[i];
    const control = sum % 11;
    if (control === 10) continue; // taka kombinacja nie tworzy poprawnego NIP
    const nip = d9 + String(control);
    assert(isValidNip(nip), `wygenerowany NIP ${nip} nie przechodzi walidacji`);
    return nip;
  }
}

/** REGON 9-cyfrowy: 8 cyfr + kontrola (sum%11, 10→0). */
function genRegon9(rng) {
  const d8 = String(randInt(rng, 1, 9)) + randDigits(rng, 7);
  const w = [8, 9, 2, 3, 4, 5, 6, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(d8[i]) * w[i];
  const control = sum % 11 === 10 ? 0 : sum % 11;
  const regon = d8 + String(control);
  assert(isValidRegon9(regon), `wygenerowany REGON9 ${regon} nie przechodzi walidacji`);
  return regon;
}

/** REGON 14-cyfrowy: 13 cyfr + kontrola (sum%11, 10→0). */
function genRegon14(rng) {
  const d13 = String(randInt(rng, 1, 9)) + randDigits(rng, 12);
  const w = [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(d13[i]) * w[i];
  const control = sum % 11 === 10 ? 0 : sum % 11;
  const regon = d13 + String(control);
  assert(isValidRegon14(regon), `wygenerowany REGON14 ${regon} nie przechodzi walidacji`);
  return regon;
}

/** mod 97 dla łańcucha IBAN po zamianie liter na liczby (A=10 … Z=35) — bez BigInt. */
function ibanMod97(s) {
  let remainder = 0;
  for (const ch of s) {
    const code = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const c of code) remainder = (remainder * 10 + Number(c)) % 97;
  }
  return remainder;
}

/**
 * IBAN PL: losowe 24 cyfry BBAN + POLICZONE cyfry kontrolne mod-97
 * (check = 98 − mod97(BBAN + "PL00")). Wynik: „PL" + 26 cyfr (28 znaków).
 */
function genIbanPl(rng) {
  const bban = randDigits(rng, 24);
  const check = String(98 - ibanMod97(bban + 'PL00')).padStart(2, '0');
  const iban = 'PL' + check + bban;
  assert(isValidIban(iban), `wygenerowany IBAN ${iban} nie przechodzi walidacji mod-97`);
  return iban;
}

/**
 * Nr dowodu: 3 litery + cyfra kontrolna (pozycja 4, waga 9) + 5 cyfr.
 * Suma ważona wszystkich 9 znaków (A=10…Z=35) musi być podzielna przez 10;
 * 9d ≡ −S (mod 10), a 9⁻¹ (mod 10) = 9, stąd d = 9·(10 − S%10) mod 10.
 */
function genDowod(rng) {
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + randInt(rng, 0, 25))).join('');
  const tail = randDigits(rng, 5);
  const w = [7, 3, 1, 9, 7, 3, 1, 7, 3]; // jak isValidDowod (wagi poprawione w 0.29.13)
  const chars = letters + '0' + tail; // miejsce kontrolne tymczasowo 0
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    if (i === 3) continue; // pozycję kontrolną liczymy osobno
    const ch = chars[i];
    const val = /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : Number(ch);
    sum += val * w[i];
  }
  const d = (9 * ((10 - (sum % 10)) % 10)) % 10;
  const dowod = letters + String(d) + tail;
  assert(isValidDowod(dowod), `wygenerowany nr dowodu ${dowod} nie przechodzi walidacji`);
  return dowod;
}

/** Zepsuj sumę kontrolną: podbij ostatnią cyfrę o 1 (mod 10). */
function flipLastDigit(s) {
  const last = Number(s[s.length - 1]);
  return s.slice(0, -1) + String((last + 1) % 10);
}

/** Grupowanie cyfr po 4 (czytelny zapis IBAN/NRB). */
const group4 = (digits) => digits.match(/.{1,4}/g).join(' ');

// ============================================================================
// Budowa zbioru
// ============================================================================

export function buildDataset() {
  const rng = mulberry32(SEED);

  // ── Wartości strukturalne (KOLEJNOŚĆ generacji = stabilność zbioru; nie przestawiać) ──
  const P3 = genPesel(rng);
  const P4 = genPesel(rng);
  const P5 = genPesel(rng);
  const P6 = genPesel(rng);
  const NIP1 = genNip(rng);
  const R9B = genRegon9(rng);
  const R14 = genRegon14(rng);
  const IBAN_A = genIbanPl(rng); // ciągły, z prefiksem PL
  const IBAN_B = genIbanPl(rng); // zapis grupowany spacjami
  const NRB_A = genIbanPl(rng).slice(2); // 26 cyfr (bez PL) — kotwica „konto/rachunek"
  const NRB_B = genIbanPl(rng).slice(2);
  const IBAN_BAD = flipLastDigit(genIbanPl(rng));
  const DOWOD_B = genDowod(rng);

  // Wartości stałe z zadania — weryfikujemy sumy kontrolne przy budowie zbioru.
  assert(isValidPesel('44051401359'), 'stały PESEL 44051401359 powinien być poprawny');
  assert(isValidPesel('90010112349'), 'stały PESEL 90010112349 powinien być poprawny');
  assert(isValidNip('1234563218'), 'stały NIP 1234563218 powinien być poprawny');
  assert(isValidRegon9('123456785'), 'stały REGON 123456785 powinien być poprawny');
  assert(isValidDowod('ABA300000'), 'stały nr dowodu ABA300000 powinien być poprawny');
  // …a wartości celowo błędne NIE mogą przechodzić walidacji:
  assert(!isValidPesel('44051401350'), 'PESEL 44051401350 ma być błędny');
  assert(!isValidNip('1234563210'), 'NIP 1234563210 ma być błędny');
  assert(!isValidRegon9('123456784'), 'REGON 123456784 ma być błędny');
  assert(!isValidIban(IBAN_BAD), `IBAN ${IBAN_BAD} ma być błędny`);
  assert(!isValidDowod('ABA300001'), 'nr dowodu ABA300001 ma być błędny');
  assert(!isValidPesel('12345678901'), 'ciąg 12345678901 ma być błędny jako PESEL');
  assert(!isValidNip('4561237891'), 'ciąg 4561237891 ma być błędny jako NIP');

  const cases = [];
  const counters = new Map();
  /** Dodaj przypadek z automatyczną numeracją w kategorii. */
  const add = (category, prefix, text, mustMask, mustKeep = []) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    cases.push({ id: `${prefix}-${String(n).padStart(2, '0')}`, category, text, mustMask, mustKeep });
  };
  const osp = (t, mm, mk) => add('osoby-podstawowe', 'os-p', t, mm, mk);
  const oso = (t, mm, mk) => add('osoby-odmiana', 'os-o', t, mm, mk);
  const osr = (t, mm, mk) => add('osoby-rzadkie', 'os-r', t, mm, mk);
  // osoby-rzadkie-ner: nazwiska, których rdzeń deterministyczny NIE łapie (brak wyzwalacza,
  // brak sufiksu -ski/-cki/-icz/-czyk, nazwiska obce) — tu warstwa NER ma dać przewagę recall.
  const osrn = (t, mm, mk) => add('osoby-rzadkie-ner', 'os-rn', t, mm, mk);
  // osoby-slownik: częste nazwiska z rozszerzonego słownika PESEL (bez sufiksu -ski/-cki/-icz/-czyk),
  // samodzielnie/w odmianie, bez wyzwalacza — rdzeń deterministyczny łapie je BEZ AI (strażnik słownika).
  const osd = (t, mm, mk) => add('osoby-slownik', 'os-sl', t, mm, mk);
  const str = (t, mm, mk) => add('strukturalne', 'str', t, mm, mk);
  const neg = (t, mk) => add('negatywy', 'neg', t, [], mk);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-PODSTAWOWE — mianownik, konteksty urzędowe/prawnicze/czatowe
  // ──────────────────────────────────────────────────────────────────────────
  osp('Pozwany Jan Kowalski nie stawił się na rozprawie.', ['Jan', 'Kowalski'], ['Pozwany', 'rozprawie']);
  osp('Powódka Anna Nowak wniosła o zasądzenie kosztów.', ['Anna', 'Nowak'], ['Powódka', 'kosztów']);
  osp('Świadek Piotr Wiśniewski zeznał, że widział zdarzenie.', ['Piotr', 'Wiśniewski'], ['Świadek']);
  osp('Umowę podpisała Katarzyna Zielińska w obecności notariusza.', ['Katarzyna', 'Zielińska'], ['notariusza']);
  osp('Wniosek złożył Tomasz Szymański dnia 12 marca.', ['Tomasz', 'Szymański'], ['Wniosek', '12 marca']);
  osp('Magdalena Woźniak została powołana do zarządu.', ['Magdalena', 'Woźniak'], ['zarządu']);
  osp('Krzysztof Kaczmarek prowadzi warsztat przy rynku.', ['Krzysztof', 'Kaczmarek'], ['warsztat']);
  osp('Na spotkanie przyszedł Marek Mazur z dokumentami.', ['Marek', 'Mazur'], ['dokumentami']);
  osp('Ewa Lewandowska odebrała przesyłkę osobiście.', ['Ewa', 'Lewandowska'], ['przesyłkę']);
  osp('hej, pisze do was Jakub Dąbrowski, mam pytanie o umowę', ['Jakub', 'Dąbrowski'], ['umowę']);
  // v0.46.x: IMIĘ+NAZWISKO małymi literami (niechlujny zapis) — imię ze słownika + nazwisko morfologiczne
  osp('imię i nazwisko: jan kowalski', ['jan', 'kowalski'], []);
  osp('od anna nowak dostałem pismo', ['anna', 'nowak'], ['dostałem', 'pismo']);
  osp('pełnomocnik: anna kowalska-nowak', ['anna', 'kowalska-nowak'], ['pełnomocnik']);
  // formy żeńskie
  osp('Anna Kowalska wygrała sprawę w drugiej instancji.', ['Anna', 'Kowalska'], ['instancji']);
  osp('Agnieszka Wiśniewska złożyła reklamację w sklepie.', ['Agnieszka', 'Wiśniewska'], ['reklamację']);
  osp('Nowa księgowa to Joanna Zielińska.', ['Joanna', 'Zielińska'], ['księgowa']);
  // liczba mnoga
  osp('Anna i Jan Kowalscy kupili mieszkanie na osiedlu.', ['Anna', 'Jan', 'Kowalscy'], ['mieszkanie']);
  osp('Państwo Nowakowie wynajmują lokal od miasta.', ['Nowakowie'], ['lokal']);
  // nazwiska dwuczłonowe z myślnikiem
  osp('Maria Nowak-Kowalska reprezentuje spółkę.', ['Maria', 'Nowak-Kowalska'], ['spółkę']);
  osp('Pełnomocnikiem jest Karolina Zielińska-Wójcik.', ['Karolina', 'Zielińska-Wójcik'], ['Pełnomocnikiem']);
  osp('Pismo podpisała Hanna Kowalczyk-Nowak.', ['Hanna', 'Kowalczyk-Nowak'], ['Pismo']);
  // wyzwalacze kontekstu
  osp('Nazywam się Robert Malinowski i piszę w sprawie faktury.', ['Robert', 'Malinowski'], ['faktury']);
  osp('Mam na imię Weronika, nazwisko Sobczak.', ['Weronika', 'Sobczak'], []);
  osp('Pan Wiśniewski nie odpowiada na wezwania.', ['Wiśniewski'], ['nie odpowiada', 'wezwania']);
  osp('Proszę przekazać dokumenty pani Kowalskiej.', ['Kowalskiej'], ['dokumenty']);
  osp('Imię i nazwisko: Adrian Borkowski.', ['Adrian', 'Borkowski'], []);
  // v0.29.6: nietypowa WIELKOŚĆ LITER imienia/nazwiska w KONTEKŚCIE (self-ID, pole, para)
  osp('nazywam się pAMELA nOWAK i czekam na odpowiedź.', ['pAMELA', 'nOWAK'], ['odpowiedź']);
  osp('Nazywam się PAMELA NOWAK, proszę o kontakt telefoniczny.', ['PAMELA', 'NOWAK'], ['kontakt']);
  osp('mam na imię PAMELA i dzwonię w sprawie faktury.', ['PAMELA'], ['faktury']);
  osp('Imię: pamela\nNazwisko: nowak', ['pamela', 'nowak'], []);
  osp('PAMELA NOWAK złożyła wniosek w urzędzie miasta.', ['PAMELA', 'NOWAK'], ['wniosek']);
  // v0.29.7: TYTUŁ/ROLA + imię/nazwisko WERSALIKAMI (tytuł zostaje, nazwisko potwierdzone słownikiem)
  osp('W składzie SSO JAN KOWALSKI wydał wyrok.', ['JAN KOWALSKI'], ['składzie', 'wyrok']);
  osp('Rozmawiałem z PANEM MARKIEM WIŚNIEWSKIM osobiście.', ['MARKIEM WIŚNIEWSKIM'], ['osobiście']);
  osp('POZWANY JAN KOWALSKI nie stawił się na rozprawie.', ['JAN KOWALSKI'], ['POZWANY', 'rozprawie']);
  osp('Wezwanie otrzymał PAN KOWALSKI dnia wczorajszego.', ['KOWALSKI'], ['Wezwanie', 'wczorajszego']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-ODMIANA — samo nazwisko w przypadku zależnym (bez imienia, bez wyzwalacza)
  // ──────────────────────────────────────────────────────────────────────────
  // odmiana rzeczownikowa: dopełniacz / celownik / narzędnik
  oso('Sprawę Nowaka umorzono z braku dowodów.', ['Nowaka'], ['umorzono', 'dowodów']);
  oso('Sąd doręczył Nowakowi odpis wyroku.', ['Nowakowi'], ['Sąd', 'wyroku']);
  oso('Ugoda zawarta z Nowakiem obowiązuje od stycznia.', ['Nowakiem'], ['Ugoda', 'stycznia']);
  oso('Pełnomocnik Wójcika złożył apelację.', ['Wójcika'], ['apelację']);
  oso('Wierzyciel wystąpił przeciwko Wójcikowi z pozwem.', ['Wójcikowi'], ['Wierzyciel']);
  oso('Negocjacje z Wójcikiem zakończyły się ugodą.', ['Wójcikiem'], ['ugodą']);
  oso('Zeznania Kaczmarka potwierdzili sąsiedzi.', ['Kaczmarka'], ['sąsiedzi']);
  oso('Komornik zajął wynagrodzenie Woźniaka.', ['Woźniaka'], ['Komornik']);
  oso('Grunt należał wcześniej do Kowalczyka.', ['Kowalczyka'], ['Grunt']);
  // odmiana przymiotnikowa (-ski/-cki)
  oso('Wniosek Kowalskiego oddalono w całości.', ['Kowalskiego'], ['Wniosek']);
  oso('Kowalskiemu wręczono wypowiedzenie umowy.', ['Kowalskiemu'], ['wypowiedzenie']);
  oso('Protokół podpisano razem z Kowalskim.', ['Kowalskim'], ['Protokół']);
  oso('Apelacja Wiśniewskiego okazała się skuteczna.', ['Wiśniewskiego'], ['Apelacja']);
  oso('Sąd przyznał Wiśniewskiemu zwrot kosztów.', ['Wiśniewskiemu'], ['zwrot kosztów']);
  oso('Obrońca Zielińskiego wniósł o uniewinnienie.', ['Zielińskiego'], ['Obrońca']);
  // formy żeńskie odmienione
  oso('Zeznania Wiśniewskiej uznano za wiarygodne.', ['Wiśniewskiej'], ['wiarygodne']);
  oso('Sprawę przeciwko Zielińskiej zawieszono.', ['Zielińskiej'], ['zawieszono']);
  oso('Rozmawiałem z Kowalską o warunkach najmu.', ['Kowalską'], ['najmu']);
  oso('Mieszkanie Kamińskiej zostało wycenione.', ['Kamińskiej'], ['wycenione']);
  // liczba mnoga odmieniona
  oso('Nieruchomość Kowalskich objęto hipoteką.', ['Kowalskich'], ['hipoteką']);
  oso('Spadek po Nowakach podzielono na troje dzieci.', ['Nowakach'], ['Spadek']);
  oso('Roszczenia Wiśniewskich przedawniły się w maju.', ['Wiśniewskich'], ['przedawniły']);
  // odmienione pary imię+nazwisko (imię w przypadku zależnym — poza słownikiem mianowników)
  oso('Pozew Jana Kowalskiego wpłynął we wtorek.', ['Jana', 'Kowalskiego'], ['Pozew']);
  oso('Sąd wysłuchał Anny Wiśniewskiej na rozprawie zdalnej.', ['Anny', 'Wiśniewskiej'], ['rozprawie']);
  oso('Zarzuty postawiono Piotrowi Zielińskiemu.', ['Piotrowi', 'Zielińskiemu'], ['Zarzuty']);
  oso('Nagrodę wręczono Magdalenie Woźniak.', ['Magdalenie', 'Woźniak'], ['Nagrodę']);
  // rejestr potoczny/czatowy
  oso('u Szymańskiego w biurze zostawiłem parasol', ['Szymańskiego'], ['parasol']);
  oso('pytałem Lewandowskiego, ale nie odpisał', ['Lewandowskiego'], ['nie odpisał']);
  oso('wczoraj widziałem Dąbrowskiego w urzędzie', ['Dąbrowskiego'], ['urzędzie']);
  oso('Krawczykowi nikt nie uwierzył.', ['Krawczykowi'], ['nie uwierzył']);
  oso('Dokumenty od Grabowskiej dotarły pocztą.', ['Grabowskiej'], ['pocztą']);
  oso('Decyzję wysłano do Jankowskich.', ['Jankowskich'], ['Decyzję']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-RZADKIE — nazwiska rzadkie/wymyślone (spoza słownika najczęstszych)
  // ──────────────────────────────────────────────────────────────────────────
  // z imieniem słownikowym (kotwica na imieniu powinna działać)
  osr('Marek Bąkiewicz podpisał protokół odbioru.', ['Marek', 'Bąkiewicz'], ['protokół']);
  osr('Alicja Krzemieniecka złożyła wniosek o urlop.', ['Alicja', 'Krzemieniecka'], ['urlop']);
  osr('Tadeusz Gzowski wynajął magazyn pod miastem.', ['Tadeusz', 'Gzowski'], ['magazyn']);
  osr('Ewelina Zdrojewczyk odebrała nagrodę jubileuszową.', ['Ewelina', 'Zdrojewczyk'], ['nagrodę']);
  osr('Norbert Pękalski przesłał ofertę w terminie.', ['Norbert', 'Pękalski'], ['ofertę']);
  // imię rzadkie + nazwisko rzadkie (poza słownikiem imion — pełny test NER)
  osr('Świętomira Gzowska przyszła na przesłuchanie.', ['Świętomira', 'Gzowska'], ['przesłuchanie']);
  osr('Bożydar Krzemieniecki prowadzi kancelarię w Radomiu.', ['Bożydar', 'Krzemieniecki'], ['Radomiu']);
  osr('Protokół sporządził Wieńczysław Trzebiatowski.', ['Wieńczysław', 'Trzebiatowski'], ['Protokół']);
  // solo w odmianie (bez imienia i wyzwalacza — poza zasięgiem słownika rdzenia)
  osr('napisała do mnie Krzemieniecka w sprawie zaliczki', ['Krzemieniecka'], ['zaliczki']);
  osr('sprawę Zdrojewczyka przekazano do prokuratury', ['Zdrojewczyka'], ['prokuratury']);
  osr('list od Gzowskiego leżał na biurku tydzień', ['Gzowskiego'], ['biurku']);
  osr('Bąkiewiczowi zależało na szybkiej wypłacie.', ['Bąkiewiczowi'], ['wypłacie']);
  osr('Zaległości Trzebiatowskiego rosły z miesiąca na miesiąc.', ['Trzebiatowskiego'], ['Zaległości']);
  osr('Wniosek Młodzianowskiej rozpatrzono odmownie.', ['Młodzianowskiej'], ['odmownie']);
  // z wyzwalaczem kontekstu (rdzeń powinien łapać mimo rzadkości)
  osr('Pani Krzemieniecka prosi o kontakt po godzinie 15.', ['Krzemieniecka'], ['po godzinie 15']);
  osr('Proszę o pilny telefon do pana Pękalskiego.', ['Pękalskiego'], ['telefon']);
  osr('Pan Habdank-Wojewódzki oczekuje w sekretariacie.', ['Habdank', 'Wojewódzki'], ['sekretariacie']);
  osr('Nazywam się Melania Szczudłowska i proszę o fakturę korygującą.', ['Melania', 'Szczudłowska'], ['fakturę']);
  // żeńskie rzadkie w mianowniku, solo
  osr('Fiołkowska wygrała przetarg na dostawę mebli.', ['Fiołkowska'], ['przetarg']);
  osr('Opinię przygotowała Gzowska z działu prawnego.', ['Gzowska'], ['działu prawnego']);
  // liczba mnoga rzadkich
  osr('Państwo Bąkiewiczowie odwołali się od decyzji.', ['Bąkiewiczowie'], ['decyzji']);
  osr('Spór z Krzemienieckimi trwa od dwóch lat.', ['Krzemienieckimi'], ['Spór']);
  // dwuczłonowe rzadkie
  osr('Dorota Sajkowska-Mróz podpisała aneks.', ['Dorota', 'Sajkowska-Mróz'], ['aneks']);
  osr('opinia Rzepeckiej-Gil była druzgocąca', ['Rzepeckiej-Gil'], ['opinia']);

  // ──────────────────────────────────────────────────────────────────────────
  // STRUKTURALNE — identyfikatory z POPRAWNYMI sumami kontrolnymi
  // ──────────────────────────────────────────────────────────────────────────
  // PESEL
  str('PESEL: 44051401359', ['44051401359'], ['PESEL:']);
  str('Mój PESEL to 90010112349, proszę o weryfikację.', ['90010112349'], ['weryfikację']);
  str(`Wnioskodawca legitymuje się numerem PESEL ${P3}.`, [P3], ['Wnioskodawca']);
  str(`W formularzu wpisano ${P4} jako identyfikator.`, [P4], ['formularzu']);
  // NIP (ciągiem i z myślnikami — oba układy separatorów)
  str('NIP firmy: 1234563218.', ['1234563218'], ['NIP firmy']);
  str('Faktura wystawiona dla NIP 123-456-32-18.', ['123-456-32-18'], ['Faktura']);
  str('Kontrahent posługuje się NIP 123-45-63-218.', ['123-45-63-218'], ['Kontrahent']);
  str(`Numer identyfikacji podatkowej ${NIP1} należy do spółki.`, [NIP1], ['spółki']);
  // REGON (9-cyfrowy z kotwicą „REGON", 14-cyfrowy samodzielnie)
  str('REGON 123456785 widnieje w rejestrze.', ['123456785'], ['rejestrze']);
  str(`Spółka o numerze REGON: ${R9B} zawiesiła działalność.`, [R9B], ['działalność']);
  str(`${R14} to REGON jednostki lokalnej.`, [R14], ['jednostki lokalnej']);
  // IBAN / numer konta (cyfry kontrolne mod-97 policzone w generatorze)
  str(`Przelew na rachunek ${IBAN_A} do końca miesiąca.`, [IBAN_A], ['Przelew']);
  str(`IBAN: ${'PL' + IBAN_B.slice(2, 4) + ' ' + group4(IBAN_B.slice(4))} (mBank).`, [group4(IBAN_B.slice(4))], ['mBank']);
  str(`Numer konta: ${NRB_A.slice(0, 2) + ' ' + group4(NRB_A.slice(2))} prowadzony w PKO.`, [group4(NRB_A.slice(2))], ['PKO']);
  str(`Zwrot nastąpi na konto ${NRB_B} wskazane w umowie.`, [NRB_B], ['Zwrot', 'umowie']);
  // telefony
  str('Kontakt: +48 601 234 567 po godzinie 17.', ['601 234 567'], ['po godzinie 17']);
  str('Zadzwoń pod 512 345 678 wieczorem.', ['512 345 678'], ['wieczorem']);
  str('Numer telefonu 601-234-567 jest nieaktualny.', ['601-234-567'], ['nieaktualny']);
  str('sms na 728901234 nie doszedł', ['728901234'], ['nie doszedł']);
  str('Infolinia oddzwoni z +48501234567.', ['501234567'], ['Infolinia']);
  // e-maile
  str('Proszę o odpowiedź na jan.kowalski@example.com w tym tygodniu.', ['jan.kowalski@example.com'], ['tygodniu']);
  str('Zgłoszenia przyjmujemy pod adresem biuro+rekrutacja@firma.com.pl.', ['biuro+rekrutacja@firma.com.pl'], ['Zgłoszenia']);
  str('e-mail: a.nowak-wojcik@uw.edu.pl (służbowy)', ['a.nowak-wojcik@uw.edu.pl'], ['służbowy']);
  // kody pocztowe
  // miejscowość po kodzie pocztowym jest maskowana od v0.26 (funkcja „Miejscowość")
  str('Adres do doręczeń: 00-950 Warszawa, skrytka 21.', ['00-950', 'Warszawa'], ['skrytka 21']);
  str('Przesyłkę nadano z kodu 31-042.', ['31-042'], ['nadano']);
  // adresy
  // v0.45: miasto po adresie z przyimkiem („przy [ADRES] w Krakowie") jest maskowane —
  // wcześniej zostawało jawne (zmiana polityki po raporcie testów: adres zamieszkania w całości)
  str('Zamieszkały przy ul. Polnej 12/3 w Krakowie.', ['ul. Polnej 12/3', 'Krakowie'], ['Zamieszkały']);
  str('Biuro mieści się przy al. Jerozolimskich 44.', ['al. Jerozolimskich 44'], ['Biuro']);
  str('Nowy lokal: os. Piastów 3/12, obok szkoły.', ['os. Piastów 3/12'], ['szkoły']);
  str('Spotkanie odbędzie się na pl. Zbawiciela 5.', ['pl. Zbawiciela 5'], ['Spotkanie']);
  str('Mieszkam na ulicy Krakowskie Przedmieście 26/28.', ['Krakowskie Przedmieście 26/28'], ['Mieszkam']);
  str('ul. Marszałkowska 140 m. 7 to adres korespondencyjny.', ['ul. Marszałkowska 140'], ['korespondencyjny']);
  // daty urodzenia (z jawnym kontekstem)
  // miasto zamieszkania to dana osobowa (decyzja produktowa): marker „zamieszkały w" → maskuj miasto
  str('Wnioskodawca, ur. 12.05.1985, zamieszkały w Łodzi.', ['12.05.1985', 'Łodzi'], ['Wnioskodawca']);
  // v0.44.2: miasto urodzenia po markerze „urodzona … w" to PII — maskowane (krok 12g)
  str('Urodzona 3.04.1992 w Poznaniu.', ['3.04.1992', 'Poznaniu'], []);
  str('Data urodzenia: 1990-01-01 (wg aktu).', ['1990-01-01'], ['wg aktu']);
  str('urodzony 07/11/1978 w Gdańsku', ['07/11/1978', 'Gdańsku'], []);
  // numery dowodów osobistych
  str('Seria i numer dowodu: ABA300000.', ['ABA300000'], ['Seria i numer']);
  str(`Legitymuje się dowodem ${DOWOD_B}.`, [DOWOD_B], ['Legitymuje']);
  // przypadki łączone (kilka typów PII w jednym zdaniu)
  str(
    `Dłużnik (PESEL ${P5}) zamieszkały przy ul. Długiej 8/2, tel. 604 112 233.`,
    [P5, 'ul. Długiej 8/2', '604 112 233'],
    ['Dłużnik'],
  );
  str(
    `Nadawca Piotr Nowak, konto ${NRB_B}, e-mail piotr.nowak@onet.pl.`,
    ['Piotr', 'Nowak', NRB_B, 'piotr.nowak@onet.pl'],
    ['Nadawca'],
  );
  str(
    `Klientka Anna Zielińska (PESEL ${P6}, tel. 500-600-700) prosi o kontakt.`,
    ['Anna', 'Zielińska', P6, '500-600-700'],
    ['Klientka', 'kontakt'],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // NEGATYWY — tego NIE wolno maskować
  // ──────────────────────────────────────────────────────────────────────────
  // numery przepisów i odwołania do aktów
  neg('Zgodnie z art. 123 456 789 nie stosuje się przepisów przejściowych.', ['123 456 789']);
  neg('Podstawą roszczenia jest art. 415 KC.', ['art. 415 KC']);
  neg('Oskarżono go z art. 148 § 1 Kodeksu karnego.', ['art. 148 § 1', 'Kodeksu karnego']);
  neg('Zastosowanie ma ust. 2 pkt 3 lit. b.', ['ust. 2 pkt 3']);
  neg('Rozporządzenie opublikowano w Dz.U. z 2023 r. poz. 1234.', ['poz. 1234']);
  neg('Przepis § 7 regulaminu pozostaje w mocy.', ['§ 7', 'regulaminu']);
  neg('Zakres art. 10-100 obejmuje przepisy ogólne.', ['10-100']);
  // sygnatury akt
  neg('Wyrok w sprawie II K 123/45 uprawomocnił się.', ['II K 123/45']);
  // v0.44.2 (decyzja polityki): sygnatura sądowa PRZY KOTWICY „Sygn. akt" identyfikuje sprawę
  // → maskowana; cytowane orzecznictwo BEZ kotwicy („w sprawie III CZP 45/22") zostaje jawne.
  str('Sygn. akt III CZP 12/23 — uchwała siedmiu sędziów.', ['III CZP 12/23'], ['uchwała']);
  neg('Apelację oddalono w sprawie I ACa 1234/22.', ['I ACa 1234/22']);
  // instytucje i akty prawne (wielkie litery, ale to nie osoby)
  neg('Sąd Najwyższy oddalił skargę kasacyjną.', ['Sąd Najwyższy']);
  neg('Trybunał Konstytucyjny odroczył ogłoszenie wyroku.', ['Trybunał Konstytucyjny']);
  neg('Nowelizacja Kodeksu Cywilnego weszła w życie w maju.', ['Kodeksu Cywilnego']);
  neg('Urząd Skarbowy wezwał spółkę do korekty deklaracji.', ['Urząd Skarbowy']);
  neg('Ministerstwo Sprawiedliwości opublikowało projekt ustawy.', ['Ministerstwo Sprawiedliwości']);
  neg('Zakład Ubezpieczeń Społecznych wydał decyzję odmowną.', ['Zakład Ubezpieczeń Społecznych']);
  neg('Naczelny Sąd Administracyjny uchylił zaskarżony wyrok.', ['Naczelny Sąd Administracyjny']);
  neg('Skierowano pytanie do Izby Cywilnej Sądu Najwyższego.', ['Izby Cywilnej']);
  neg('Prokuratura Okręgowa w Warszawie umorzyła śledztwo.', ['Prokuratura Okręgowa', 'Warszawie']);
  neg('Rzecznik Praw Obywatelskich zabrał głos w debacie.', ['Rzecznik Praw Obywatelskich']);
  // homonimy nazwisk — rzeczowniki pospolite, dni, miesiące (kontekst niebędący osobą)
  neg('Wilk biegał po lesie za sarną.', ['Wilk']);
  neg('Lis przemknął przez drogę tuż przed autem.', ['Lis']);
  neg('Baran to pierwszy znak zodiaku.', ['Baran']);
  neg('Mazurek wielkanocny stygł na parapecie.', ['Mazurek']);
  neg('Sowa hukała całą noc pod oknem.', ['Sowa']);
  neg('Kruk krukowi oka nie wykole, jak mówi przysłowie.', ['Kruk']);
  neg('Dudek to ptak o charakterystycznym czubie.', ['Dudek']);
  neg('Kot przewrócił doniczkę z parapetu.', ['Kot']);
  neg('W piątek trzynastego lepiej zostać w domu.', ['piątek']);
  neg('Kwiecień plecień, bo przeplata trochę zimy, trochę lata.', ['Kwiecień']);
  neg('Król wydał ucztę na zamku.', ['Król']);
  // ciągi cyfr ze ZŁĄ sumą kontrolną — muszą zostać nietknięte
  neg('Numer 44051401350 nie przeszedł walidacji w systemie.', ['44051401350']);
  neg('Ciąg 1234563210 to przykładowy identyfikator testowy.', ['1234563210']);
  // v0.44 (pkt 3): przy SILNEJ etykiecie („REGON"/„Rachunek") maskujemy mimo złej sumy kontrolnej
  // (numer bywa realny z literówką). Bez etykiety bad-checksum dalej zostaje (patrz negatywy wyżej).
  str('W formularzu wpisano REGON 123456784 z błędem.', ['123456784'], ['formularzu']);
  str(`Podano rachunek ${IBAN_BAD} (błędna suma).`, [IBAN_BAD], ['błędna']);
  // v0.44: nowe typy PII (token JWT, IP v4/v6, MAC, VIN, prawo jazdy, nr rejestracyjny)
  str('Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc-DEF_1', ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc-DEF_1'], ['Token']);
  str('Adres IP serwera: 192.168.1.20 w sieci lokalnej.', ['192.168.1.20'], ['serwera']);
  str('IPv6: 2001:db8::8a2e:370:7334 przydzielony automatycznie.', ['2001:db8::8a2e:370:7334'], ['automatycznie']);
  str('MAC karty sieciowej 00:1A:2B:3C:4D:5E jest unikalny.', ['00:1A:2B:3C:4D:5E'], ['unikalny']);
  str('Numer VIN WAUZZZ8V4JA123456 widnieje w dowodzie rejestracyjnym.', ['WAUZZZ8V4JA123456'], ['dowodzie']);
  str('Prawo jazdy nr KR1234567 wydane w 2020 roku.', ['KR1234567'], ['wydane']);
  // numer prawa jazdy ze slashami maskowany W CAŁOŚCI (nie fragment)
  str('Prawo jazdy: 12345/67/8901 (kat. B).', ['12345/67/8901'], ['kat']);
  str('Pojazd o nr rejestracyjnym WI1234K, marka Audi.', ['WI1234K'], ['Audi']);
  // v0.44.2 (raport testów partii 1–3): sekrety prefiksowe, warianty telefonu, Cisco MAC,
  // sygnatura sądowa z wydziałem, KRS/prawo jazdy z odmianą frazy, adres z „lok."/„m."
  str('Klucz API sk_live_a1b2c3d4e5f6g7h8i9j0 w konfiguracji.', ['sk_live_a1b2c3d4e5f6g7h8i9j0'], ['konfiguracji']);
  str('Sekret ghp_AbCdEfGh1234567890IjKlMnOpQrStUv w repozytorium.', ['ghp_AbCdEfGh1234567890IjKlMnOpQrStUv'], ['repozytorium']);
  str('Telefon kontaktowy (22) 501-23-45 czynny do 16.', ['(22) 501-23-45'], ['czynny']);
  // notacja kropkowa telefonu wymaga kotwicy (bez niej pożerała kwoty „123.456.789 zł")
  str('Telefon 512.345.678 zapisano w aktach.', ['512.345.678'], ['aktach']);
  neg('Wartość zamówienia: 123.456.789 zł brutto.', ['123.456.789']);
  str('Interfejs o adresie aabb.ccdd.eeff w notacji Cisco.', ['aabb.ccdd.eeff'], ['notacji']);
  str('Sygn. akt: II SA/Wa 1234/23 w postępowaniu.', ['II SA/Wa 1234/23'], ['postępowaniu']);
  str('Spółka wpisana do KRS pod numerem 0000123456.', ['0000123456'], ['wpisana']);
  str('Legitymował się prawem jazdy nr 05678/13/1234 podczas kontroli.', ['05678/13/1234'], ['kontroli']);
  str('Zamieszkały przy ul. Polnej 12 lok. 5 od urodzenia.', ['Polnej 12 lok. 5'], ['urodzenia']);
  str('Świadek, ur. dnia 31 XII 2010, stawił się z opiekunem.', ['31 XII 2010'], ['opiekunem']);
  // v0.44.3 (raport finalny): kotwica pojazdowa, NRB bez PL, inicjał+nazwisko, obce nazwiska
  str('Motocykl ZS 4567 zabezpieczono na parkingu.', ['ZS 4567'], ['zabezpieczono']);
  str('Drugi pojazd WW 1234A odholowano.', ['WW 1234A'], ['odholowano']);
  str('Przelew na 66 1097 1200 0012 3456 7890 1234 zaksięgowano.', ['66 1097 1200 0012 3456 7890 1234'], ['zaksięgowano']);
  str('Zeznania złożył A. Baran do protokołu.', ['Baran'], ['protokołu']);
  str('Stawił się Jean-Pierre Dubois z tłumaczem.', ['Jean-Pierre Dubois'], ['tłumaczem']);
  neg('Pojazd MERCEDES odholowano na parking strzeżony.', ['MERCEDES']);
  str('Ciągnik siodłowy GD 890KL zatrzymano do kontroli.', ['GD 890KL'], ['kontroli']);
  str('Do wiadomości: K. Baran, referat pierwszy.', ['Baran'], ['referat']);
  neg('pojazd marki KIA CEED2 oraz auto VW GOLF5 sprzedano.', ['KIA CEED2', 'VW GOLF5']);
  neg('Golub-Dobrzyń Zaprasza turystów przez cały rok.', ['Golub-Dobrzyń', 'Zaprasza']);
  neg('Rolls-Royce Motor Cars otworzył salon.', ['Rolls-Royce', 'Motor']);
  neg('Mieszka przy ul. Rakowieckiej od dawna.', ['Rakowieckiej']);
  neg('Przyciski i Klocki hamulcowe wymieniono.', ['Przyciski', 'Klocki']);
  neg('Wnioski dowodowe stron oddalono w całości.', ['Wnioski']);
  neg('Szkoła im. A. Mickiewicza ogłosiła nabór.', ['Mickiewicza']);
  neg('Ciąg 10 2010 9712 0000 1234 5678 9013 ma błędną sumę kontrolną.', ['10 2010 9712 0000 1234 5678 9013']);
  // precyzja: numer porządkowy / lp. / cytowane orzecznictwo NIE są maskowane
  neg('Numer porządkowy pozycji w rejestrze 000012345 pozostaje jawny.', ['000012345']);
  neg('Lp. 123456789 w wykazie środków trwałych.', ['123456789']);
  neg('Orzeczenie w sprawie III CZP 45/22 przywołano w uzasadnieniu.', ['III CZP 45/22']);
  neg('Oprogramowanie w wersji 10.0.19045.3803 zainstalowano zdalnie.', ['10.0.19045.3803']);
  // precyzja: numer wersji oprogramowania to NIE adres IP
  neg('Aktualizacja do wersji 1.2.3.4 usuwa błędy krytyczne.', ['1.2.3.4']);
  // dowód BEZ kontekstu wymaga poprawnej sumy kontrolnej (v0.30) — ABA300001 ma złą sumę,
  // więc (jak sygnatura/kod) pozostaje; realny dowód z kontekstem „dowód…" maskuje gałąź (a)
  neg('Seria ABA300001 nie jest poprawnym numerem dowodu.', ['ABA300001']);
  neg('Wartość 12345678901 pojawiła się w logu importu.', ['12345678901']);
  // ciągi cyfr osłonięte kontekstem numeracyjnym
  neg('Zamówienie nr 987654321 zostało wysłane kurierem.', ['987654321']);
  neg('Faktura VAT nr 4561237891 czeka na akceptację.', ['4561237891']);
  // pułapka wyzwalacza „Pan" — tytuł dzieła, nie osoba
  neg('Pan Tadeusz to najsłynniejsza polska epopeja narodowa.', ['Tadeusz']);
  // przymiotniki geograficzne/instytucjonalne w nazwach własnych — warstwa NER NIE może ich
  // maskować (stoplista NON_SURNAME_ADJ / LEGAL_ENTITY w ner-postprocess). To dowód precyzji AI.
  neg('Uniwersytet Warmiński ogłosił nabór na studia.', ['Warmiński']);
  neg('Kredyt zaciągnięto w Banku Śląskim w zeszłym roku.', ['Śląskim']);
  neg('Komitet Obywatelski wystosował apel do władz.', ['Obywatelski']);
  neg('Powstał Ogólnopolski Związek Przewoźników Drogowych.', ['Ogólnopolski']);
  neg('Uniwersytet Jagielloński świętuje jubileusz.', ['Jagielloński']);
  neg('Skargę rozpoznał Wojewódzki Sąd Administracyjny.', ['Wojewódzki']);
  // dodatkowe sygnatury akt (pilnują, że warstwa NER nie tknie oznaczeń spraw)
  neg('Postanowienie zapadło w sprawie IV CSK 77/24.', ['IV CSK 77/24']);
  neg('Skargę kasacyjną zarejestrowano pod III UK 210/23.', ['III UK 210/23']);
  // instytucje z przymiotnikiem (chronione stoplistą LEGAL_ENTITY/NON_SURNAME_ADJ w NER)
  neg('Sąd Rejonowy w Pruszkowie wydał nakaz.', ['Rejonowy']);
  neg('Prokuratura Krajowa wszczęła postępowanie.', ['Krajowa']);
  neg('Wojewódzki Fundusz Ochrony Środowiska ogłosił nabór.', ['Wojewódzki']);
  neg('Naczelny Sąd Administracyjny oddalił skargę.', ['Naczelny']);
  // homonimy w kontekście rzeczownikowym (warstwa NER nie maskuje homonimów)
  neg('Sroka skakała po świeżo skoszonym trawniku.', ['Sroka']);
  neg('Mróz ściął kałuże twardą skorupą nad ranem.', ['Mróz']);
  neg('Kruk siedział na gałęzi i obserwował drogę.', ['Kruk']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-RZADKIE-NER — rdzeń deterministyczny je PRZEPUSZCZA (brak wyzwalacza, brak sufiksu
  // -ski/-cki/-icz/-czyk, nazwiska obce). Recall zależy od warstwy NER — to tu dowodzimy jej
  // przewagi. mustKeep pilnuje, że kontekst nie jest zjadany.
  // ──────────────────────────────────────────────────────────────────────────
  osrn('list od Achtelika leżał tydzień na biurku', ['Achtelika'], ['biurku']);
  osrn('sprawę Fąfary umorzono w drugiej instancji', ['Fąfary'], ['umorzono']);
  osrn('zeznania Gągały spisano protokolarnie', ['Gągały'], ['protokolarnie']);
  osrn('wniosek Grzmota rozpatrzono odmownie', ['Grzmota'], ['odmownie']);
  osrn('do akt dołączono notatkę Ciołka z rozmowy', ['Ciołka'], ['notatkę']);
  osrn('reklamację złożył wczoraj Müller osobiście', ['Müller'], ['reklamację']);
  osrn('umowę parafował Nguyen dzień wcześniej', ['Nguyen'], ['umowę']);
  osrn('protokół podpisał Kovač w obecności świadka', ['Kovač'], ['świadka']);
  osrn('opinię biegłego sporządził Popescu w terminie', ['Popescu'], ['opinię']);
  osrn('pełnomocnikiem powoda był mecenas Schmidt', ['Schmidt'], ['powoda']);
  // dalsze rzadkie rodzime bez wyzwalacza/sufiksu -ski/-cki/-icz/-czyk
  osrn('sprawę Pytlaka odroczono do przyszłego miesiąca', ['Pytlaka'], ['odroczono']);
  osrn('zeznania Habaja spisano na komisariacie', ['Habaja'], ['komisariacie']);
  osrn('wniosek Momota oddalono w pierwszej instancji', ['Momota'], ['instancji']);
  osrn('do akt dołączono notatkę Cieciory z narady', ['Cieciory'], ['narady']);
  osrn('pismo od Bździucha wpłynęło z opóźnieniem', ['Bździucha'], ['opóźnieniem']);
  // dalsze nazwiska obce (różne systemy)
  osrn('opinię prawną wydał Petrov zeszłego tygodnia', ['Petrov'], ['opinię']);
  osrn('umowę serwisową parafował Horvat osobiście', ['Horvat'], ['umowę']);
  osrn('reklamację rozpatrzył Weber w dwa dni', ['Weber'], ['reklamację']);
  osrn('kontrakt firmował Rossi przed notariuszem', ['Rossi'], ['kontrakt']);

  // ──────────────────────────────────────────────────────────────────────────
  // OSOBY-SLOWNIK — częste nazwiska z rozszerzonego słownika PESEL (deterministyka, bez AI)
  // ──────────────────────────────────────────────────────────────────────────
  osd('Sprawę Szczepaniaka umorzono w drugiej instancji.', ['Szczepaniaka'], ['umorzono']);
  osd('Zeznania Madeja potwierdzili sąsiedzi.', ['Madeja'], ['sąsiedzi']);
  osd('Wniosek Michalika rozpatrzono odmownie.', ['Michalika'], ['odmownie']);
  osd('list od Ratajczaka leżał tydzień na biurku', ['Ratajczaka'], ['biurku']);
  osd('pismo od Grzelaka wpłynęło z opóźnieniem', ['Grzelaka'], ['opóźnieniem']);
  osd('opinię sporządził biegły Kujawa w terminie', ['Kujawa'], ['opinię']);
  osd('reklamację złożył wczoraj Nguyen osobiście', ['Nguyen'], ['reklamację']);
  osd('umowę serwisową parafował Melnyk', ['Melnyk'], ['umowę']);
  osd('protokół podpisał mecenas Schulz', ['Schulz'], ['protokół']);
  osd('do akt dołączono zeznania świadka Petrova', ['Petrova'], ['akt']);

  // v0.45: struktura XML/JSON, URL z parametrami osobowymi, login, OCR, telefon z kropkami
  // w wyliczeniu, tablice w wyliczeniu bez powtórzonej kotwicy
  str('<Customer><Name>Jan</Name><Surname>Kowalski</Surname><City>Warszawa</City><Street>Leśna 15</Street></Customer>', ['Jan', 'Kowalski', 'Warszawa', 'Leśna 15'], ['<Customer>', '</Customer>']);
  str('{ "firstName": "Jan", "lastName": "Kowalski", "city": "Warszawa", "street": "Lipowa 12" }', ['Jan', 'Kowalski', 'Warszawa', 'Lipowa 12'], ['firstName', 'lastName']);
  neg('<Name>Produkt X200</Name> dodano do katalogu ofert.', ['Produkt X200']);
  str('Zgłoszenie https://portal.example.com/ticket?id=987001234&user=tomasz.kaminski w kolejce.', ['user=tomasz.kaminski'], ['portal.example.com', 'id=987001234']);
  neg('Repozytorium https://github.com/apache/kafka jest publiczne.', ['github.com/apache/kafka']);
  str('Login użytkownika: tkaminski (konto domenowe).', ['tkaminski'], ['konto domenowe']);
  neg('Identyfikator w systemie: USR-005182 pozostaje jawny.', ['USR-005182']);
  str('Kontakt: 512.345.678, +48.512.345.678 oraz stacjonarny 22.501.23.45.', ['512.345.678', '+48.512.345.678', '22.501.23.45'], ['stacjonarny']);
  neg('Kwota 1.234.567 zł oraz wersja 10.2.3 z dnia 12.05.1990.', ['1.234.567', '10.2.3', '12.05.1990']);
  str('Zabezpieczono pojazdy: WW 1234A, ZS 4567, WE 123AB oraz KR 8XY90.', ['WW 1234A', 'ZS 4567', 'WE 123AB', 'KR 8XY90'], ['Zabezpieczono']);
  neg('Rozporządzenie (WE) nr 1234/2009 oraz dyrektywa WE 123 obowiązują.', ['(WE) nr 1234/2009', 'WE 123']);
  str('Zgłosił się J0AN K0WALSKI, zamieszkały uI. Lip0wa 15.', ['J0AN K0WALSKI', 'Lip0wa 15'], ['Zgłosił']);
  str('Biuro przy ul. Morskiej 12 w Gdańsku czynne od 8:00.', ['Morskiej 12', 'Gdańsku'], ['czynne']);
  neg('Spotkanie zespołu odbyło się w Gdańsku przy kawie.', ['Gdańsku']);
  // v0.45.1: pola administracyjne jawne; imię w nazwie pliku i homoglif I w środku — maskuj całość
  neg('Powiat: Pruszkowski, województwo mazowieckie pozostają jawne.', ['Pruszkowski', 'mazowieckie']);
  str('Załącznik: Umowa_Kredytowa_Adam_Kowalski.pdf w aktach.', ['Adam_Kowalski'], ['Umowa_Kredytowa', '.pdf']);
  str('Zgłosił się Jan KowaIski po odbiór dokumentów.', ['Jan KowaIski'], ['odbiór']);
  // v0.46.x: kod pocztowy BEZ myślnika przy kotwicy adresowej (ulica → miasto); 5 cyfr luzem zostają
  str('Adres korespondencyjny: ul. Krótka 5, 65048 Zielona Góra.', ['Krótka 5', '65048', 'Zielona Góra'], ['korespondencyjny']);
  neg('Kwota 50000 Euro oraz faktura 12345 Netto do rozliczenia.', ['50000', '12345', 'Euro', 'Netto']);
  // e-mail z polską diakrytyką w części lokalnej — maskuj W CAŁOŚCI (bez wycieku fragmentu nazwiska)
  str('Kontakt: piotr.wiśniewski@poczta.pl w sprawie umowy.', ['piotr.wiśniewski@poczta.pl'], ['sprawie']);
  // proza małymi literami — sąsiedztwa mylące, ale zero nadmaskowania (krok 13a4 wymaga imienia+nazwiska)
  neg('polski rynek pracy zmienia się, a wąski segment rośnie.', ['polski', 'wąski']);
  neg('mam ochotę na kawę, ala woli herbatę, ola pije wodę.', ['ochotę', 'ala', 'ola']);
  // v0.29.6: granice precyzji przy poluzowaniu WIELKOŚCI LITER w imionach/nazwiskach —
  // po „Pan/Pani" bywa czasownik, „nazywam się" bez nazwy własnej/słownika to nie identyfikacja,
  // a nagłówek WERSALIKAMI to nie osoba (dopisane na KOŃCU bloku, by nie przenumerować neg-NN)
  neg('Pan był wczoraj w urzędzie, a Pani ma rację w tej sprawie.', ['Pan był', 'Pani ma rację']);
  neg('nazywam się tak, jak trzeba, i nic więcej nie dodam.', ['nazywam się tak', 'trzeba']);
  neg('USTAWA O OCHRONIE DANYCH OSOBOWYCH obowiązuje wszystkich.', ['USTAWA O OCHRONIE DANYCH OSOBOWYCH']);
  // v0.29.7: nagłówki/instytucje WERSALIKAMI NIE są nazwiskami mimo poprzedzającego słowa
  neg('NACZELNY SĄD ADMINISTRACYJNY oddalił skargę kasacyjną.', ['NACZELNY SĄD ADMINISTRACYJNY']);
  neg('UNIWERSYTET WARSZAWSKI ogłosił nabór na nowy kierunek.', ['UNIWERSYTET WARSZAWSKI']);
  neg('PREZES ZARZĄDU SPÓŁKI podpisał uchwałę o połączeniu.', ['PREZES ZARZĄDU SPÓŁKI']);
  neg('SĘDZIA SĄDU REJONOWEGO rozpoznał sprawę na posiedzeniu.', ['SĘDZIA SĄDU REJONOWEGO']);

  // v0.46.17: nad/niedomaskowania z realnej petycji do Urzędu Marszałkowskiego.
  // „marszałkowski" to przymiotnik URZĘDOWY (instytucja), NIE nazwisko — nie wolno maskować…
  neg('platformach społecznościowych Urzędu Marszałkowskiego Województwa Śląskiego.', ['Marszałkowskiego']);
  neg('Petycję rozpatrzył Urząd Marszałkowski Województwa Śląskiego.', ['Marszałkowski']);
  // …ale OSOBA o nazwisku „Marszałkowski" w parze z imieniem MUSI zniknąć (recall zachowany).
  str('Petycję podpisał Jan Marszałkowski, przewodniczący stowarzyszenia.', ['Jan Marszałkowski'], ['przewodniczący']);
  // adres WERSALIKAMI ze skanu (kotwica „UL." case-insensitive) — dawniej wyciekał
  str('Adres do doręczeń: UL. JULIUSZA LIGONIA 46 w budynku.', ['JULIUSZA LIGONIA 46'], ['doręczeń']);
  // miejscowość z anotacją jednostki TERYT „(miasto)" — pole słownikowe e-urzędowe
  str('W rejestrze figuruje Gliwice (miasto) jako jednostka.', ['Gliwice'], ['(miasto)', 'jednostka']);
  // v0.46.18: eponimy uliczne (patroni) — para imię+nazwisko po „ulic/rondo" to NAZWA ULICY, nie osoba…
  // strażnik chroni PIERWSZEGO patrona (tuż po kotwicy); drugi po „oraz" bywa nadmaskowany — świadomy
  // kompromis (mostkowanie spójnika wchłaniało realne osoby: „ulicy X oraz Jan Kowalski")
  neg('Zdarzenie miało miejsce u zbiegu ulic Tadeusza Kościuszki oraz świadka.', ['Tadeusza Kościuszki']);
  neg('Rondo Romana Dmowskiego było wczoraj zamknięte.', ['Romana Dmowskiego']);
  // luki domknięte w audycie: końcówka diakrytyczna kotwicy, ranga „gen." między kotwicą a nazwą,
  // krótka forma solo „Ronda Dmowskiego"
  neg('Jadąc aleją Tadeusza Kościuszki minął sygnalizację świetlną.', ['Tadeusza Kościuszki']);
  neg('Sklep mieści się na rogu ul. gen. Władysława Andersa.', ['Władysława Andersa']);
  neg('Na odcinku od Ronda Dmowskiego wprowadzono objazd.', ['Dmowskiego']);
  // …ale realna osoba w sąsiedztwie słowa „ulica" (czasownik między) MUSI zniknąć (recall).
  oso('Na ulicy spotkałem wczoraj Jana Kowalskiego.', ['Jana Kowalskiego'], ['spotkałem']);
  // telefon 2-3-2-2 po kotwicy „kontakt … pod numerem" (most kotwicowy); bez kotwicy — patrz neg niżej
  str('Kontakt telefoniczny pod numerem 32 774 91 55 w godzinach pracy.', ['32 774 91 55'], ['godzinach']);
  // liczba w kształcie 2-3-2-2 BEZ kontekstu telefonicznego to numer pozycji — zostaje jawna
  neg('Pozycja 32 774 91 55 w wykazie inwentarza magazynowego.', ['32 774 91 55']);

  // v0.46.19: PESEL po słabym łączniku „to"; adres z typem ulicy bez skrótu (Rondo); przymiotnik
  // powiatowy po roli; zdrobnienia imion w parze z nazwiskiem
  str('Wnioskodawca podał PESEL to 89010112345 w formularzu.', ['89010112345'], ['formularzu']);
  str('Adres zamieszkania: Rondo Kościuszki 5 w bloku.', ['Rondo Kościuszki 5'], ['zamieszkania']);
  neg('Park Narodowy Gór Stołowych 2024 świętuje jubileusz.', ['Park Narodowy Gór Stołowych 2024']);
  neg('Decyzję wydał Starosta Wołomiński osobiście.', ['Wołomiński']);
  osd('Zgłosił się wczoraj Janek Kowalski osobiście.', ['Janek Kowalski'], ['osobiście']);
  osd('Reklamację złożyła Kasia Nowak w sklepie.', ['Kasia Nowak'], ['sklepie']);
  // rok po nowym typie obiektu to NIE numer domu; kotwica IBAN nie zjada następnego słowa (audyt v0.46.19)
  neg('Bulwar Filadelfijski 1998 objęty jest programem rewitalizacji nadbrzeży.', ['Bulwar Filadelfijski 1998']);
  str('Na rachunek wspólnoty PL61 1090 1014 0000 0712 1981 3152 wpłynęły zaliczki.', ['PL61 1090 1014 0000 0712 1981 3152'], ['wpłynęły']);

  // v0.46.20: imię osierocone (newline / panieńskie „z") — maskuj całość; narzędnik „z Kowalskim" =
  // dwie osoby (imię zostaje); REGON po etykiecie z wieloma wyrazami wtrącenia
  oso('Jan\nWiśniewski złożył wniosek do urzędu.', ['Jan', 'Wiśniewski'], ['wniosek']);
  str('Gosia z Lewandowskich głosowała wczoraj przeciw.', ['Gosia', 'Lewandowskich'], ['głosowała']);
  str('Anna rozmawiała z Kowalskim przez telefon.', ['Kowalskim'], ['Anna', 'rozmawiała']);
  str('REGON zakładu opiekuńczego wynosi 012345675 w rejestrze.', ['012345675'], ['opiekuńczego']);

  // v0.46.22 — numer KSeF (Krajowy System e-Faktur). Numer zawiera NIP wystawcy, więc maskujemy
  // go W CAŁOŚCI (bez tego passNip zjadał sam prefiks i zostawiał „[NIP]-20250826-…").
  str('Numer KSeF: 5265877635-20250826-0100001AF629-AF na fakturze.', ['5265877635-20250826-0100001AF629-AF'], ['fakturze']);
  str('Korekta dotyczy numeru KSeF 7781464139-20230721-80B510-9675F7-B5 z lipca.', ['7781464139-20230721-80B510-9675F7-B5'], ['lipca']);
  str('W polu <NrKSeF>5265877635-20260213-01008C4F21B7-3D</NrKSeF> zapisano identyfikator.', ['5265877635-20260213-01008C4F21B7-3D'], ['identyfikator']);
  // numer inwentarzowy/seryjny o tym samym KSZTAŁCIE, w dokumencie wspominającym KSeF —
  // pierwszy człon nie jest poprawnym NIP-em, więc zostaje jawny (kotwica dokumentowa to za mało)
  neg('Faktury wystawiamy przez KSeF. Nr inwentarzowy 4500123456-20260115-000000012345-01 bez zmian.', ['4500123456-20260115-000000012345-01']);
  // ten sam kształt bez ani jednej litery hex: numer modelu i sklejone kolumny kwot — zostają
  neg('Rozliczenie w KSeF. Nr modelu urządzenia M000000001-20240101-000000000000-00.', ['M000000001-20240101-000000000000-00']);
  // (sam NIP w tym ciągu jest maskowany jako NIP — pilnujemy, że reszta kolumn zostaje jawna)
  neg('Uzgodnienie przed wysyłką do KSeF: 5265877635-20250826-145000-118700-23 w tabeli.', ['20250826-145000-118700-23']);
  // kotwicą bywa sam adres skrzynki — e-mail znika wcześniej, więc liczymy ją na wejściu
  str('Kontakt: ksef@mf.gov.pl, numer dokumentu 5265877635-20250826-0100001AF629-AF.', ['5265877635-20250826-0100001AF629-AF'], ['numer dokumentu']);
  // numer referencyjny sesji zaczyna się od DATY (nie od NIP-u) — nie jest numerem KSeF
  neg('Numer referencyjny sesji w KSeF: 20250626-SO-2F14610000-242991F8C9-B4', ['20250626-SO-2F14610000-242991F8C9-B4']);
  neg('System KSeF w wersji 2.0 działa od 2026 roku.', ['KSeF']);
  // separatorem numeru KSeF jest TYLKO myślnik — kolumny liczb w raporcie nie są scalane
  neg('Raport KSeF 5265877635 20250826 000000012345 23 w podziale na kanały.', ['20250826 000000012345 23']);

  // Czyste wyjście (audyt, partia b1): tekst POZA maską zostaje co do znaku — odstępy i tabulatory
  // między kolumnami, zapis etykiety, kropki skrótów, składnia JSON-a. mustKeep z odstępami pilnuje
  // struktury, której sama detekcja nie mierzy.
  osp('2024-03-01\tJan Kowalski\tWarszawa\t1250,00', ['Jan', 'Kowalski'], ['\tWarszawa\t1250,00']);
  osp('Wystawił: Marek Dąbrowski     Odebrał: Ewa Kamińska', ['Marek', 'Dąbrowski', 'Ewa', 'Kamińska'], ['     Odebrał:']);
  str('kod\tmiasto\tkraj\n00-001\tWarszawa\tPolska', ['00-001', 'Warszawa'], ['\tPolska']);
  str('krs: 0000123456, regon: 123456785', ['0000123456', '123456785'], ['krs:', 'regon:']);
  str('Kontakt: tel. 601-222-333 lub 22 501 23 45, faks 12 634 55 22 / 12 634 55 23.', ['601-222-333', '22 501 23 45', '12 634 55 22', '12 634 55 23'], ['Kontakt', 'lub', 'faks']);
  str('tel. 22 501 23 45, kom. 601 222 333 lub 120 000 000 zł zaliczki', ['22 501 23 45', '601 222 333'], ['kom. ', '120 000 000 zł']);
  osp('ORLEN S.A. Jan Kowalski — pełnomocnik spółki.', ['Jan', 'Kowalski'], ['ORLEN S.A. ', 'pełnomocnik']);
  osp('Sz. P. Andrzej Górski — odpowiedź na pismo.', ['Andrzej', 'Górski'], ['Sz. P. ', 'odpowiedź']);
  osp('Pełnomocnik: mec. Ł. Baran przedłożył pełnomocnictwo.', ['Ł.', 'Baran'], ['Pełnomocnik', 'przedłożył']);
  neg('P.S. Mróz ma być w nocy, okryj róże.', ['P.S. Mróz']);
  str(String.raw`{"opis": "Zgłosił:\nKowalski Jan, PESEL:\n85031412347"}`, ['Kowalski', 'Jan', '85031412347'], [String.raw`"Zgłosił:\n`, String.raw`PESEL:\n`]);
  str(String.raw`{"payload":"{\"imie\":\"Jadwiga\",\"nazwisko\":\"Gżegżółka\",\"miasto\":\"Słupsk\"}"}`, ['Jadwiga', 'Gżegżółka', 'Słupsk'], [String.raw`{\"imie\":\"`]);
  neg(String.raw`{"sciezka": "C:\\Users\\nowak\\Documents\\raport.docx", "opis": "Linia 1\nLinia 2"}`, [String.raw`C:\\Users\\nowak\\Documents`, String.raw`Linia 1\nLinia 2`]);
  // (cudzysłowy wokół masek w miejscu liczb pilnuje snapshot golden — mustKeep musi stać w wejściu)
  str('{"klient_id": 7, "pesel": 85031412347, "telefon": 601234567}', ['85031412347', '601234567'], ['"klient_id": 7']);
  // Regresje partii b1 wyłapane w weryfikacji: imię nad nazwiskiem po czasowniku podpisu, lista
  // „Nazwisko Imię" z homografami, łańcuch inicjałów w składzie sądu, firma jednoosobowa,
  // człon telefonu z prefiksem „48" bez plusa.
  osp('Sporządził Jan\nKowalski, dnia 3 marca.', ['Jan', 'Kowalski'], ['Sporządził', 'dnia 3 marca']);
  osp('Lista obecności:\nWilk Bartosz\nSowa Przemysław\nPawlak Wiesław', ['Wilk', 'Bartosz', 'Sowa', 'Przemysław', 'Pawlak', 'Wiesław'], ['Lista obecności:\n']);
  osp('Przewodniczący: SSO J.M. Wilk\nSędziowie: SO A.K. Sowa, SO T.J. Mazur (spr.)', ['J.M.', 'Wilk', 'A.K.', 'Sowa', 'T.J.', 'Mazur'], ['Przewodniczący: SSO ', 'Sędziowie: SO ', '(spr.)']);
  osp('Wykonawca: P.H.U. Wilk Tomasz Wilk, NIP w załączeniu.', ['Tomasz', 'Wilk'], ['Wykonawca: P.H.U. ', 'NIP w załączeniu']);
  neg('P.P.S. Mróz ma być w nocy, a PKO B.P. Wilk to nazwa robocza.', ['P.P.S. Mróz', 'B.P. Wilk']);
  str('tel. 601 222 333 lub 48 602 333 444, faks 22 501 23 45; 48 22 123 45 67', ['601 222 333', '48 602 333 444', '22 501 23 45', '48 22 123 45 67'], ['tel.', 'lub', 'faks']);

  // Nadmaskowanie numerów (audyt, partia b2): liczby w kształcie telefonu, tablicy, IBAN-u, IP
  // czy MAC, które nimi nie są, oraz prawdziwe wartości, które obok nich nadal muszą zniknąć.
  neg('Ilość\n120\n340\n560\nRazem 1020', ['120\n340\n560']);
  neg('Numer przesyłki: RR123456789PL, faktura FV/2026/123456789, SKU 123456789A.', ['RR123456789PL', 'FV/2026/123456789', 'SKU 123456789A']);
  str('Numery 500600700/501601701 do biura.', ['500600700', '501601701'], ['Numery', 'do biura']);
  neg('Kontakt telefoniczny 03.10.2026 9:45 – brak odpowiedzi.', ['03.10.2026 9:45']);
  neg('Dochody bieżące: 534 210 987,55; wartość: 1 234 567 890; kwota 150 000 000 zł.', ['534 210 987,55', '1 234 567 890', '150 000 000 zł']);
  neg('Nr seryjny urządzenia: 512345678\nNumer zamówienia: 302114587\nInfolinia sklepu: 801 300 400', ['512345678', '302114587', '801 300 400']);
  str('Telefon do działu zamówień: 512 345 678, nr zamówienia 302114587.', ['512 345 678'], ['działu zamówień', '302114587']);
  neg('Rysunki wykonano w programie AutoCAD 2024. Samochód ciężarowy o DMC 3500 kg.', ['AutoCAD 2024', 'DMC 3500 kg']);
  neg('Opłata za tablice rejestracyjne od 2025 r. wynosi 135,50 zł.', ['od 2025 r.']);
  str('Ciągnik: nr rej. WGM 12345, DMC 18000 kg, ładowność 24 t.', ['WGM 12345'], ['DMC 18000 kg', 'ładowność 24 t']);
  str('Przelew na DE89 3704 0044 0532 0130 00 Z OPCJĄ SHA', ['DE89 3704 0044 0532 0130 00'], ['Z OPCJĄ SHA']);
  str('IBAN: PL 92 1050 0099 0000 1234 5678 9013, BIC: INGBPLPW', ['PL 92', '1050 0099 0000 1234 5678 9013'], ['BIC: INGBPLPW']);
  str('Login: FIRMA\\jkowalski\nKonto założono w domenie FIRMA.', ['jkowalski'], ['w domenie FIRMA.']);
  str('Login: tkaminski\nZablokowano konto tkaminski.', ['tkaminski'], ['Zablokowano konto']);
  neg('Login: admin\nPo zalogowaniu do panelu admin zmień domyślne hasło.', ['panelu admin']);
  str('Logowanie nastąpiło z adresu IP 83.12.45.67.', ['83.12.45.67'], ['Logowanie nastąpiło z adresu IP']);
  neg('Wymagania opisano w rozdziale 2.1.1.1. Zainstalowano wersję 2.4.1.0 na serwerze.', ['2.1.1.1', '2.4.1.0']);
  neg('Maska podsieci: 255.255.255.0, localhost 127.0.0.1, nasłuch 0.0.0.0', ['255.255.255.0', '127.0.0.1', '0.0.0.0']);
  neg('Serial Number: 4a:3f:22:91:0c:7e:1d:55', ['4a:3f:22:91:0c:7e:1d:55']);
  str('IN=eth0 MAC=00:1a:2b:3c:4d:5e:00:11:22:33:44:55:08:00 LEN=60', ['00:1a:2b:3c:4d:5e', '00:11:22:33:44:55'], ['LEN=60']);
  neg('git clone git@github.com:zespol/portal.git', ['git@github.com:zespol/portal.git']);
  str('GET /api/v1/clients?email=jan.kowalski%40example.pl&status=1 200', ['jan.kowalski%40example.pl'], ['&status=1 200']);
  str('Sygn. akt: CAN-PST-SWW.7421.1234567.2026.1 — wezwanie.', ['CAN-PST-SWW.7421.1234567.2026.1'], ['wezwanie']);
  // Regresje partii b2 wykryte w weryfikacji: numer osoby po nazwisku sklejonym „/" lub „-",
  // tablica małymi literami po „nr rej.", host po „wersję na", wersja w linii o serwerze,
  // „ZŁ…" wersalikami po numerze, DUID z adresem karty, konto funkcyjne w prozie.
  str('Koordynator: Anna Nowak/601 234 567, zastępca Tomasz Zawadzki-604123456.', ['601 234 567', '604123456'], ['Koordynator', 'zastępca']);
  str('Zatrzymano pojazd nr rej. wa 12345 na parkingu.', ['wa 12345'], ['Zatrzymano pojazd nr rej.', 'na parkingu']);
  str('Wdrożono nową wersję na 10.20.30.40 wieczorem. Konwersja adresów 192.168.1.15 nie działa.', ['10.20.30.40', '192.168.1.15'], ['nową wersję na', 'Konwersja adresów']);
  neg('Aktualizacja serwera do 7.0.3.12. Kernel serwera 5.15.0.91. Konfiguracja adresów IP: rozdz. 5.2.1.3.', ['7.0.3.12', '5.15.0.91', '5.2.1.3']);
  str('NOWAK JAN 602 345 678 ZŁOŻYŁ WNIOSEK', ['602 345 678'], ['ZŁOŻYŁ WNIOSEK']);
  str('DHCPv6 Client DUID. . . : 00-01-00-01-2A-3B-4C-5D-00-1A-2B-3C-4D-5E', ['00-1A-2B-3C-4D-5E'], ['DHCPv6 Client DUID']);
  str('Login: URZAD\\kadry\nPismo przekazano do działu kadry.', ['URZAD\\kadry'], ['do działu kadry.']);

  // Nadmaskowanie osób i miejsc (audyt, partia b3): nazwy własne, eponimy, urzędy, przymiotniki
  // i rzeczowniki z końcówką nazwiskową, marker zamieszkania — oraz osoby obok nich, które dalej
  // muszą zniknąć w całości.
  neg('Kościół Mariacki w Krakowie pochodzi z XIV wieku, a Puszcza Białowieska jest na liście UNESCO.', ['Kościół Mariacki', 'Puszcza Białowieska']);
  osp('Wczoraj Kowalski przyszedł do biura. Sąsiad Wiśniewski zeznał, że nic nie słyszał.', ['Kowalski', 'Wiśniewski'], ['Wczoraj', 'Sąsiad']);
  osr('Świętomira Gzowska przyszła na przesłuchanie.', ['Świętomira', 'Gzowska']);
  neg('Kancelaria Komornicza w Zamościu, Izba Rolnicza w Lublinie i Ochotnicza Straż Pożarna w Lipnie.', ['Komornicza', 'Rolnicza', 'Ochotnicza']);
  neg('Akademia Górniczo-Hutnicza i Kujawsko-Pomorski Oddział Wojewódzki NFZ.', ['Górniczo-Hutnicza', 'Kujawsko-Pomorski']);
  neg('Poselski projekt ustawy trafił do Sejmu. Opieka Pielęgniarska w domu chorego. Władza Rodzicielska została ograniczona.', ['Poselski', 'Opieka Pielęgniarska', 'Władza Rodzicielska']);
  neg('Regionalna Dyrekcja Ochrony Środowiska w Gdańsku wydała decyzję.', ['Ochrony Środowiska']);
  neg('Słowiński Park Narodowy leży nad morzem, a Kampinoski Park Narodowy otacza Warszawę.', ['Słowiński', 'Kampinoski']);
  neg('Kaski ochronne są obowiązkowe. Skierowano do Instytutu Matki i Dziecka w Warszawie.', ['Kaski', 'Dziecka']);
  osp('Sprawę Kowalewicza przekazano do sądu, a Pan Kluczyk złożył wniosek.', ['Kowalewicza', 'Kluczyk'], ['Sprawę', 'Pan']);
  neg('Pani Minister Zdrowia podpisała rozporządzenie, a Pan Komendant Policji przyjął skargę.', ['Minister Zdrowia', 'Komendant Policji']);
  osp('Pani Minister Anna Nowak przemówiła.', ['Anna', 'Nowak'], ['Pani Minister']);
  neg('Odruch Babińskiego dodatni. Prątek Kocha w posiewie. Korek na moście Łazienkowskim od rana.', ['Babińskiego', 'Kocha', 'Łazienkowskim']);
  neg('Konsultacja w Szpitalu im. dra Alfreda Sokołowskiego w Wałbrzychu. Kościół św. Piotra Apostoła.', ['Alfreda Sokołowskiego', 'Piotra Apostoła']);
  osp('Pomógł im Jan Kowalski w przeprowadzce.', ['Jan', 'Kowalski'], ['Pomógł im']);
  neg('Kazimierz Dolny leży nad Wisłą.', ['Kazimierz Dolny']);
  osp('Wnioskodawca: Kazimierz Dolny', ['Kazimierz', 'Dolny'], ['Wnioskodawca']);
  // „św." w protokole to skrót „świadek" — patronem jest tylko z kontekstem sakralnym
  osp('Sąd przesłuchał św. Annę Gzowską. św. Kowalski zeznał, że nic nie widział.', ['Annę', 'Gzowską', 'Kowalski'], ['Sąd przesłuchał św.']);
  neg('Zarząd Spółdzielni Mieszkaniowej w Krakowie ogłasza przetarg. Mieszkania w Gdańsku drożeją.', ['Krakowie', 'Gdańsku']);
  str('Jan Nowak, zam. w Krakowie\nPESEL 85031412347', ['Jan', 'Nowak', 'Krakowie', '85031412347'], ['zam. w']);
  str('z Anną Nowak, zamieszkałą w Łodzi. Pozwana zamieszkuje w Gdańsku od 2015 r.', ['Anną', 'Nowak', 'Łodzi', 'Gdańsku'], ['zamieszkałą w', 'zamieszkuje w']);
  str('1. Jan Turek, ul. Długa 5, 00-001 Warszawa', ['Jan', 'Turek', 'Długa 5', '00-001', 'Warszawa']);
  str('Pozdrawiam\nMonika Sadowska\nSzosa Chełmińska 77/9\n87-100 Toruń', ['Monika', 'Sadowska', 'Chełmińska 77/9', '87-100', 'Toruń'], ['Pozdrawiam\n']);
  neg('Marsz wyruszy z placu Piłsudskiego 11 listopada. Remont ul. Puławskiej 2021-2023 zakończono.', ['placu Piłsudskiego 11 listopada', 'ul. Puławskiej 2021-2023']);
  str('Badania: ul. Bitwy Warszawskiej 1920 r. 18, 02-366 Warszawa', ['Bitwy Warszawskiej 1920 r. 18', '02-366', 'Warszawa'], ['Badania']);
  neg('{"sku": "A-107", "name": "Róża pustyni"} oraz <osoba>prawna</osoba>', ['Róża pustyni', 'prawna']);
  neg('{"imie": "b.d.", "nazwisko": "b.d."}\nLogin: none', ['b.d.', 'none']);
  neg('Koszt naprawy wyniesie 10-200 PLN brutto. Smith et al. Nature 2019.', ['10-200 PLN', 'et al. Nature 2019']);
  // Regresje partii b3 po weryfikacji: osoba po rzeczowniku z wielkiej litery, po tytule za nazwą
  // ulicy, WERSALIKAMI po kotwicy, po „św.", pod „osoba", zdrobnienie-nazwisko, adres przed datą,
  // etykieta zamieszkania — oraz zdania ogólne i eponimy, które mają zostać.
  osp('Kierownik Zespołu Kowalski zatwierdził urlop. Reakcja Wiśniewskiego na wezwanie była natychmiastowa.', ['Kowalski', 'Wiśniewskiego'], ['Kierownik Zespołu', 'Reakcja']);
  osp('Konflikt na linii Nowak – Zieliński trwał od lat. Kierownik linii Wójcik polecił wyłączenie zasilania.', ['Nowak', 'Zieliński', 'Wójcik'], ['Konflikt na linii', 'Kierownik linii']);
  osp('Na ul. Długiej lek. Anna Nowak udzieliła pomocy. W parku lek. Jan Kowalski reanimował poszkodowanego.', ['Anna', 'Nowak', 'Jan', 'Kowalski'], ['Na ul. Długiej lek.', 'W parku lek.']);
  str('Adres: ul. dra Jana Kowalskiego 12/3, Kraków', ['Jana Kowalskiego 12/3', 'Kraków'], ['Adres:']);
  osp('NA ULICY JAN KOWALSKI ZOSTAŁ POTRĄCONY. KIEROWNIK PLACÓWKI JOLANTA PYREK.', ['JAN', 'KOWALSKI', 'JOLANTA', 'PYREK'], ['NA ULICY', 'KIEROWNIK PLACÓWKI']);
  osp('Mimo wezwania św. Tomasz Gzik nie stawił się. Pożar kościoła widział św. Kowalski.', ['Tomasz', 'Gzik', 'Kowalski'], ['Mimo wezwania św.', 'Pożar kościoła widział św.']);
  str('{"osoba": "KOWALSKI JAN"}, <osoba>Wróbel Anna</osoba>, {"id": 7, "name": "anna"}', ['KOWALSKI', 'JAN', 'Wróbel', 'Anna', '"anna"'], ['"osoba"', '"name"']);
  osp('Na rozprawie świadek Krzaczyk potwierdził, że Kluczyk był obecny. Pełnomocnik Placka wniósł o oddalenie powództwa.', ['Krzaczyk', 'Kluczyk', 'Placka'], ['Na rozprawie świadek', 'Pełnomocnik']);
  str('Zdarzenie miało miejsce przy ul. Długiej 15 12 lipca 2023 r. Dostawa: ul. Lipowa 12\tMaja Kowalska', ['Długiej 15', 'Lipowa 12', 'Maja', 'Kowalska'], ['12 lipca 2023 r.']);
  str('Wnioskodawca: Jan Kowalski, miejscowość zamieszkania: Tarnów. Zamieszkanie: Kraków', ['Jan', 'Kowalski', 'Tarnów', 'Kraków'], ['miejscowość zamieszkania:', 'Zamieszkanie:']);
  neg('Program skierowany jest do osób zamieszkujących w Gdańsku. Rodziny mieszkające w Poznaniu otrzymają dodatek.', ['Gdańsku', 'Poznaniu']);
  osp('Pod wskazanym adresem zamieszkuje Jarosław Wilk z konkubiną.', ['Jarosław', 'Wilk'], ['Pod wskazanym adresem zamieszkuje']);
  osp('Sąd zasądził od uczestnika Kazimierza Dolnego koszty.', ['Kazimierza', 'Dolnego'], ['Sąd zasądził od uczestnika']);
  osp('Wniosek złożyła Pasko-Gzowska. Szanowna Pani Dyrektor Szkoły Kowalska, uprzejmie informuję.', ['Pasko-Gzowska', 'Kowalska'], ['Wniosek złożyła', 'Pani Dyrektor Szkoły']);
  neg('Szkoła Podstawowa nr 3 im Marii Konopnickiej. Linie Langera zachowane. Kościół pod wezwaniem św. Jana Chrzciciela.', ['Marii Konopnickiej', 'Langera', 'Jana Chrzciciela']);
  osp('Na ulicy Jan Kowalski zasłabł. W parku Anna Nowak spacerowała z psem.', ['Jan', 'Kowalski', 'Anna', 'Nowak'], ['Na ulicy', 'W parku']);
  neg('Szpital im. dr Anny Nowak w Lublinie. Polsko-Szwedzka Izba Gospodarcza. Obchody na placu Piłsudskiego 11 Listopada.', ['Anny Nowak', 'Polsko-Szwedzka', 'Piłsudskiego 11 Listopada']);
  // Regresje partii b3, runda 2: komórka TSV obok nazwiska, zdrobnienie-nazwisko po tytule i bez
  // czasownika przeszłego, rzadkie nazwisko pod „osoba", osoba za patronem po „św.", pacjent po
  // głowie eponimu, osoba po mieście-przymiotniku — oraz zdania ogólne i nazwy, które mają zostać.
  str('Data\tZmiana\tNazwisko\tOddział\n2024-05-12\tNoc\tLisiecki\tSOR\nTak\tKaczyński\tUrząd Miasta', ['Lisiecki', 'Kaczyński'], ['Noc', 'SOR', 'Tak', 'Urząd Miasta']);
  osp('Badanie wykonał lek. Kluczyk. Mieczyk przebywa na zwolnieniu lekarskim.', ['Kluczyk', 'Mieczyk'], ['Badanie wykonał lek.', 'przebywa na zwolnieniu']);
  str('{"klient": {"osoba": "Bednarz", "telefon": "601 234 567"}}, <person>Gzik</person>, {"name": "j. kowalski"}', ['Bednarz', 'Gzik', 'kowalski'], ['"osoba"', '<person>']);
  osp('W kościele św. Anny Jan Bednarz zagra koncert kolęd. W kościele przesłuchano św. Annę Gzowską.', ['Jan', 'Bednarz', 'Annę', 'Gzowską'], ['W kościele św. Anny', 'przesłuchano św.']);
  osp('Pacjent Tadeusz Nowacki trafił na SOR. Objawy Nowackiego nasiliły się w nocy. Mistrz linii Kowalskiego wydał polecenie.', ['Tadeusz', 'Nowacki', 'Nowackiego', 'Kowalskiego'], ['Objawy', 'Mistrz linii']);
  str('ul. Polna 3, 86-170 Nowe Anna Gzik', ['Polna 3', 'Anna', 'Gzik'], []);
  neg('Osoba mieszkająca w Krakowie może złożyć wniosek. Pracownikom zamieszkującym w Gdańsku przysługuje dodatek. Odruch Babińskiego dodatni.', ['Krakowie', 'Gdańsku', 'Babińskiego']);
  // Wyciek fragmentu (audyt, partia b4): prefiks telefonu, PESEL/NIP/REGON z odstępami, imię po
  // przecinku i drugie imię za maską, zdrobnienie, imię sklejone kropką, OCR, miasto wielowyrazowe,
  // zakres i lokal w adresie, konto z twardą spacją, osoba w polu loginu, obce litery w nazwisku.
  // Fragmenty („55 21", „-43", „öder") osobno w mustMask: jawny ogon to też wyciek.
  str('Kontakt: tel.: 0048 12 634 55 21, tel./fax (0048) 61 852 33 49, T: +48 (0)22 395 41 00, (+48) 512 345 678.', ['0048 12 634', '55 21', '852 33 49', '(0)22', '395 41 00', '(+48', '512 345 678'], ['Kontakt:', 'tel./fax', 'T:']);
  str('PESEL: 851 103 142 83, NIP: 5260 2502 74, REGON 012-345-675.', ['851 103 142 83', '142 83', '5260 2502 74', '012-345-675'], ['PESEL:', 'NIP:', 'REGON']);
  osp('Do: Wiśniewska, Ewa; Sowa, Jakub\nLista obecności:\nKowalska Anna Maria\nNowak Jan Piotr', ['Wiśniewska', 'Ewa', 'Sowa', 'Jakub', 'Kowalska', 'Anna', 'Maria', 'Nowak', 'Jan', 'Piotr'], ['Do:', 'Lista obecności:']);
  osp('[12:10] Kuba Nowak: siema\nNapisał Kuba Kowalski.', ['Kuba', 'Nowak', 'Kowalski'], ['[12:10]', 'siema', 'Napisał']);
  neg('Kuba Libre to drink z rumem. Ambasador RP na Kubie złożył wizytę.', ['Kuba Libre', 'na Kubie']);
  osp('Konto Jan.Kowalski zostało zablokowane. Przeniesiono folder Nowak_Anna do archiwum.', ['Jan.', 'Kowalski', 'Nowak', '_Anna'], ['Konto', 'zablokowane', 'folder', 'archiwum']);
  osp('Od: J0anna Kowalczyk\nPani ANNA NOWAK-KOWALSKA', ['J0anna', 'Kowalczyk', 'ANNA', 'NOWAK-KOWALSKA'], ['Od:', 'Pani']);
  neg('CENTRUM ONKOLOGII MARII SKŁODOWSKIEJ-CURIE. SĄD REJONOWY W BIELSKU-BIAŁEJ.', ['MARII SKŁODOWSKIEJ-CURIE', 'BIELSKU-BIAŁEJ']);
  str('zam. 55-080 Kąty Wrocławskie, a wcześniej zam. w Dąbrowie Górniczej i 66-470 Kostrzyn nad Odrą.', ['55-080', 'Kąty', 'Wrocławskie', 'Dąbrowie', 'Górniczej', 'Kostrzyn', 'nad Odrą'], ['a wcześniej']);
  str('zam. ul. Hoża 41-43 m. 12, 00-681 Warszawa; korespondencja: ul. Żwirki i Wigury 16/3, Aleje Jerozolimskie 44 lok. 5.', ['Hoża 41', '-43', 'm. 12', 'Żwirki', 'Wigury 16/3', 'Jerozolimskie 44', 'lok. 5'], ['korespondencja:']);
  neg('Wypadek przy ul. Długiej 5 osób rannych. Mieszkanie 3-pokojowe, m.in. sklepy obok.', ['5 osób rannych', '3-pokojowe', 'm.in. sklepy']);
  str(`Numer rachunku: ${'57 1140 2004 0000 3002 0123 4567'.replace(/ /g, '\u00A0')}, konto: 57-1140-2004-0000-3002-0123-4567, mikrorachunek podatkowy 52 1010 0071 2221 7743 1005 2400, NIP: 526\u00A0000\u00A012\u00A046.`, ['3002\u00A00123', '3002-0123', '7743 1005 2400', '526\u00A0000'], ['Numer rachunku:', 'mikrorachunek podatkowy', 'NIP:']);
  neg('Kwota przelewu: 1\u00A0234\u00A0567,89 zł. Konto księgowe 201-01-001-0002-0003-0004-0005-01 (plan kont).', ['1\u00A0234\u00A0567,89 zł', '201-01-001-0002-0003-0004-0005-01']);
  osp('User: Kowalski Jan\nJan Kowalski zgłosił awarię.', ['Kowalski', 'Jan'], ['User:', 'zgłosił awarię']);
  osp('Pani Anna Schröder i Jan Müller oraz Pan Dvořák złożyli wniosek.', ['Anna', 'Schröder', 'öder', 'Jan', 'Müller', 'Dvořák'], ['Pani', 'oraz Pan', 'złożyli wniosek']);
  neg('Spektakl Café Müller wystawiono w Zürichu.', ['Café Müller', 'Zürichu']);
  // Regresje partii b4 po weryfikacji: liczebnik za lokalem i po etykiecie adresu, człon wyliczenia
  // telefonów z prefiksem po „kom.", nawias przed „+48", zakres i wyliczenie ulic w prozie.
  str('Pacjent zam. ul. Długa 5 m. 3 lat 45, przywieziony przez ZRM. Zameldowanie: ul. Polna 5 Osoby zameldowane: 3', ['Długa 5', 'm. 3', 'Polna 5'], ['lat 45', 'przywieziony przez ZRM', 'Osoby zameldowane: 3']);
  str('Pracownik socjalny: tel. 22 501 23 46, kom. 0048 602 333 444; kontakt (+48 512 345 678).', ['22 501 23 46', '0048 602', '333 444', '512 345 678'], ['Pracownik socjalny:', 'kom.', 'kontakt (']);
  neg('Na ul. Długiej 2-3 osoby czekały. W Alejach Jerozolimskich 2 pasy ruchu zamknięto. Ulica Żwirki i Wigury 2023 remont.', ['2-3 osoby', 'Alejach Jerozolimskich 2 pasy', 'Żwirki i Wigury 2023']);
  // Regresje partii b4, runda 2: skrzyżowanie i „Aleje" z liczebnikiem, godzina za nazwą ulicy,
  // forma zależna i etykieta pola za numerem domu, imię z homoglifem na końcu wiersza, imię innej
  // osoby w formie zależnej, rdzeń nazwiska z obcym ogonem, marka auta po „pan".
  neg('Na skrzyżowaniu ul. Długiej i Polnej 1 osoba zginęła. W Alejach Jerozolimskich 3 wypadki tylko w tym tygodniu. Zbiórka przy ul. Polnej i Leśnej 18:00. Czy jeździ pan Škodą?', ['Długiej i Polnej 1 osoba', 'Alejach Jerozolimskich 3 wypadki', 'Leśnej 18:00', 'pan Škodą']);
  str('Sprawca odjechał spod posesji przy ul. Polnej 5 samochodem marki Opel. 1. Kowalczyk Joanna ul. Polna 7 dzieci: 2', ['Polnej 5', 'Kowalczyk', 'Joanna', 'Polna 7'], ['samochodem marki Opel', 'dzieci: 2']);
  osp('Nowak KaroI\nJan Kowalski\nPozwany Zieliński Annie groził.', ['Nowak', 'KaroI', 'Jan', 'Kowalski', 'Zieliński'], ['Pozwany', 'groził']);
  osp('Kovalčuk Anna, obywatelka Ukrainy. Świadek Bondarčuk zeznał. Pani Ioana Mureșan złożyła wniosek.', ['Kovalčuk', 'čuk', 'Anna', 'Bondarčuk', 'Ioana', 'Mureșan', 'șan'], ['obywatelka Ukrainy', 'Świadek', 'zeznał', 'złożyła wniosek']);

  // ── Kontrola spójności zbioru ──
  const ids = new Set();
  for (const c of cases) {
    assert(!ids.has(c.id), `zduplikowane id ${c.id}`);
    ids.add(c.id);
    for (const s of c.mustMask) {
      assert(c.text.includes(s), `${c.id}: mustMask "${s}" nie występuje w tekście`);
    }
    for (const s of c.mustKeep) {
      assert(c.text.includes(s), `${c.id}: mustKeep "${s}" nie występuje w tekście`);
    }
  }

  return { seed: SEED, cases };
}

// Uruchomienie bezpośrednie: wypisz statystyki zbioru (szybka kontrola wzrokowa).
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  const { cases } = buildDataset();
  const perCat = new Map();
  for (const c of cases) perCat.set(c.category, (perCat.get(c.category) ?? 0) + 1);
  console.log(`Zbiór ewaluacyjny: ${cases.length} przypadków (seed ${SEED})`);
  for (const [cat, n] of perCat) console.log(`  ${cat}: ${n}`);
  const masks = cases.reduce((a, c) => a + c.mustMask.length, 0);
  const keeps = cases.reduce((a, c) => a + c.mustKeep.length, 0);
  console.log(`  mustMask łącznie: ${masks}, mustKeep łącznie: ${keeps}`);
}
