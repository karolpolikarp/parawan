// Słowniki imion (polskie, obce, formy odmienione i zapisy bez ogonków) oraz testy „czy to imię”.
import { foldAscii, NO_E } from '../surnames.js';

/**
 * Imiona cudzoziemców częste w polskich urzędach (ZUS, CEIDG, żłobek, szkoła, karta pobytu): ukraińskie,
 * białoruskie i rosyjskie w zapisie polskim („Ołeksandr”, „Switłana”) i paszportowym („Oleksandr”,
 * „Svitlana”), arabskie i indyjskie. Działają jak imiona polskie: z nazwiskiem, po wyzwalaczu, po polu,
 * w odmianie („Oksany”, „Ołeksandrowi”, „Dmytra”). Bez imion będących zwykłym słowem albo jego formą:
 * taras, omar, inna, wira („wiry”), pasza, nur, dalia, rana, rania („ranie”), amina („aminy”), said, lilia. Bez form
 * żeńskich równych dopełniaczowi imienia męskiego (bohdana, oleksandra, jarosława). Nazwiska i drugie
 * imiona wietnamskie mają osobną regułę układu (passPersonForeign).
 */
const OFFICE_FOREIGN_FIRST_NAMES =
  // ukraińskie, białoruskie i rosyjskie, zapis polski
  'ołeksandr ołeksij mychajło mykoła wołodymyr dmytro andrij serhij jurij wasyl ihor bohdan iwan petro ' +
  'pawło witalij anatolij wiaczesław jewhen wadym oleh stepan ostap nazar artem denys kyryło illia mykyta ' +
  'wałentyn hennadij ołena oksana switłana hałyna iryna tetiana kateryna julija wiktorija anastasija ' +
  'marija natalija ludmyła nadija łarysa ołha daryna sofija sołomija uliana chrystyna alisa polina ołesia ' +
  'lesia alaksandr siarhiej uładzimir alaksiej zmicier wolha taciana aksana siergiej sergiej władimir ' +
  'dmitrij aleksiej nikołaj michaił jewgienij wasilij giennadij oleg swietłana tatiana jelena irina galina ' +
  'jekaterina ' +
  // ukraińskie, białoruskie i rosyjskie, zapis paszportowy (łaciński)
  'oleksandr oleksii mykhailo mykola volodymyr andrii andriy serhii serhiy yurii yuriy vasyl vitalii ' +
  'anatolii yevhen vadym pavlo kyrylo ivan viktor yaroslav olena svitlana halyna yuliia viktoriia ' +
  'anastasiia mariia nataliia liudmyla nadiia larysa valentyna olha sofiia solomiia khrystyna aliaksandr ' +
  'siarhei uladzimir aliaksei yauheni dzmitry volha alena tatsiana sergei sergey vladimir dmitry dmitrii ' +
  'aleksei alexey nikolai mikhail yevgeny evgeny vasily gennady yuri svetlana tatyana elena yelena ' +
  'lyudmila ekaterina yekaterina anastasia yulia ' +
  // arabskie
  'ahmed ahmad mohammed mohammad muhammad mohamed mahmoud mahmud mustafa hassan hasan hussein husajn ' +
  'khaled khalid chalid youssef yusuf jusuf ibrahim abdullah karim tarik tareq samir amir bilal hamza ' +
  'rashid nabil walid yasser fatima fatma aisha aisza mariam maryam leila lejla lajla layla zainab ' +
  'zajnab yasmin salma huda samira hiba ' +
  // indyjskie (informatyka, outsourcing)
  'priya rahul amit sanjay deepak anil sunil vijay ravi arjun rohan neha pooja anjali kavya divya ' +
  'shreya aditi ananya rajesh suresh ramesh';

// Imiona pełne i zdrobnienia w mianowniku. Bez zdrobnień kolidujących z rzeczownikami (kuba, maks,
// misiek, ryś), bo imię maskujemy tylko w parze z nazwiskiem albo po wyzwalaczu.
export const POLISH_FIRST_NAMES = new Set<string>(
  (
    `${OFFICE_FOREIGN_FIRST_NAMES} ` +
    'oliwier eryk nataniel fryderyk aleksy juliusz lucjan marian ireneusz longin ' +
    'roksana marlena adrianna liwia jagna marianna leokadia kazimiera aldona honorata julianna daria ' +
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
/** Dopełniacz męskiego imienia („Jacka", „Marka", „Pawła", „Jana"): forma patrona, choć „Jacka" ma
 *  końcówkę żeńskiego nazwiska na -cka. Ruchome „e" jak w słowniku nazwisk (Jacek → Jacka). */
export function isMaleFirstNameGenitive(w: string): boolean {
  if (!w.endsWith('a')) return false;
  const stem = w.slice(0, -1);
  return POLISH_FIRST_NAMES.has(stem) || POLISH_FIRST_NAMES.has(stem.replace(NO_E, '$1e$2'));
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
// Bez pustego sufiksu: mianownik pokrywa POLISH_FIRST_NAMES, a sam rdzeń („maj” z „Maja”) daje
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
  // Męskie imiona wschodnie na „-o” odmieniają się jak „Bruno”: Dmytro → Dmytra, Dmytrem, Dmytrowi.
  // Tylko z listy obcej: polskie „Iwo” dałoby „iwa” (drzewo).
  for (const n of OFFICE_FOREIGN_FIRST_NAMES.split(/\s+/)) {
    if (!/[^aeiouy]o$/.test(n)) continue;
    const s = n.slice(0, -1);
    add(`${s}a`, `${s}em`, `${s}owi`);
  }
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

/**
 * Zdrobnienia imion (mianownik, małe litery): pełne imię → zdrobnienia. Służą tylko do rozlania osoby
 * potwierdzonej w piśmie („Jakub Wrona” → „Kuba”, „Kuby”), nigdy do wykrywania samego imienia, więc
 * mogą zawierać formy kolidujące ze słowami („kuba”, „hala”). Zdrobnienie przypisane kilku imionom
 * („ala”) łączy ich rodziny tylko przy tej osobie, której imię pasuje.
 */
export const FIRST_NAME_DIMINUTIVES: Record<string, string[]> = Object.fromEntries(
  (
    'adam:adaś,adamek agata:agatka agnieszka:aga,agusia,agnisia aleksander:olek,alek,oleś ' +
    'aleksandra:ola,olka,olcia,oleńka alicja:ala,alka,alusia andrzej:andrzejek,jędrek ' +
    'anna:ania,anka,anusia,aneczka hanna:hania,hanka,hanusia antoni:antek,antoś,tosiek antonina:tosia,tonia ' +
    'artur:arturek barbara:basia,baśka,basieńka bartłomiej:bartek,bartuś bartosz:bartek,bartuś ' +
    'beata:beatka bogdan:bogdanek bożena:bożenka,bożka dariusz:darek dorota:dorotka,dorka,dosia ' +
    'elżbieta:ela,elka,elżunia ewa:ewka,ewunia,ewcia ewelina:ewelinka gabriela:gabrysia,gabi gabriel:gabryś ' +
    'grażyna:grażka,grażynka grzegorz:grzesiek,grześ,grzesio halina:hala,halinka,halusia helena:hela,helenka,helcia ' +
    'henryk:heniek,henio irena:irenka,irka iwona:iwonka jadwiga:jadzia,jadźka jakub:kuba,kubuś ' +
    'jan:janek,jaś,jasiek,jasio janina:janka,janinka jarosław:jarek jerzy:jurek joanna:asia,joasia,aśka ' +
    'józef:józek,józio julia:julka,julcia,jula justyna:justynka kamil:kamilek kamila:kamilka karol:karolek ' +
    'karolina:karolinka katarzyna:kasia,kaśka,kasieńka kazimierz:kazik,kazio krystyna:krysia,kryśka,krystynka ' +
    'krzysztof:krzysiek,krzyś,krzysio lucyna:lucynka,lusia łukasz:łukaszek magdalena:magda,madzia,magdusia ' +
    'małgorzata:gosia,małgosia,gośka marek:mareczek maria:marysia,maryśka mariusz:mariuszek ' +
    'marta:martusia,martunia,marteczka mateusz:mateuszek michał:michałek,michaś mikołaj:mikołajek ' +
    'monika:monisia,monia,monka natalia:natalka,nati,natusia,natka paulina:paulinka paweł:pawełek,pawcio ' +
    'piotr:piotrek,piotruś przemysław:przemek rafał:rafałek renata:renia,renatka roman:romek,romcio ' +
    'ryszard:rysiek,rysio sławomir:sławek stanisław:staś,stasiek,staszek,stasio stanisława:stasia,staszka ' +
    'stefan:stefek,stefcio szymon:szymek,szymuś tadeusz:tadek,tadzio teresa:tereska,tesia ' +
    'tomasz:tomek,tomcio,tomuś urszula:ula,ulka,ulcia wiesław:wiesiek,wiesio wiesława:wiesia,wieśka ' +
    'wiktor:wiktorek wiktoria:wika,wiktorka władysław:władek,władzio wojciech:wojtek,wojtuś ' +
    'zbigniew:zbyszek,zbysio,zbyś zdzisław:zdzisiek,zdziś zofia:zosia,zośka,zosieńka zuzanna:zuzia,zuzka,zuzanka ' +
    'weronika:werka,weronka,wera oliwia:oliwka,oliwcia emilia:emilka lena:lenka,lenusia nikola:nikolka ' +
    'patrycja:patka sylwia:sylwka,sylwcia edyta:edytka filip:filipek ignacy:ignaś leon:leoś bronisław:bronek ' +
    'czesław:czesiek,czesio mieczysław:mietek zenon:zenek eugeniusz:gienek,gienio genowefa:gienia ' +
    'mirosław:mirek mirosława:mirka radosław:radek witold:witek kacper:kacperek oskar:oskarek ' +
    'dominika:domi daniel:danielek daniela:danka,danusia danuta:danka,danusia jolanta:jola,jolka ' +
    'leszek:leszeczek magda:madzia sebastian:seba,sebek kinga:kingusia klaudia:klaudka lidia:lidka ' +
    'zdzisława:zdzisia celina:cela,celinka'
  )
    .split(' ')
    .map((e) => {
      const [full, dims] = e.split(':');
      return [full, dims.split(',')];
    }),
);

// ——— Wołacz imion (zwrot do osoby: „Panie Marku”, „Pani Ewo”, „Kasiu,”) ———

const VOC_SOFT: Record<string, string> = { si: 'ś', zi: 'ź', ci: 'ć', ni: 'ń' };
/**
 * Wołacz imienia z mianownika (małe litery), z obocznościami tematu: ruchome „e” (Marek → Marku,
 * Heniek → Heńku), -eł/-ł (Paweł → Pawle, Michał → Michale), t/d/r/st (Robert → Robercie, Dawid →
 * Dawidzie, Piotr → Piotrze, Kacper → Kacprze, Ernest → Erneście), -ś (Staś → Stasiu), tematy miękkie i tylnojęzykowe
 * na -u (Łukasz → Łukaszu, Henryk → Henryku, Andrzej → Andrzeju), pozostałe na -ie (Jan → Janie).
 * Żeńskie (i męskie) na -a: -o (Ewa → Ewo, Maria → Mario, Kuba → Kubo), zdrobnienia miękkie i krótkie
 * na -la na -u (Kasia → Kasiu, Ola → Olu). Imiona na samogłoskę inną niż „a” mają wołacz równy mianownikowi.
 */
export function firstNameVocative(n: string): string {
  if (n.endsWith('a')) {
    const s = n.slice(0, -1);
    // „-nia” po samogłosce w pełnym imieniu to „ni-a” (Stefania → Stefanio), w zdrobnieniu „ń-a” (Sonia → Soniu)
    if (/[aeo]nia$/.test(n) && n.length >= 7) return `${s}o`;
    if (/(?:dzi|si|zi|ci|ni)$/.test(s) || (/l$/.test(s) && n.length <= 4)) return `${s}u`;
    return `${s}o`;
  }
  if (/[iyoeuó]$/.test(n)) return n;
  let s = n;
  if (n.endsWith('ek') && n.length >= 4) s = `${n.slice(0, -2).replace(/(si|zi|ci|ni)$/, (x) => VOC_SOFT[x])}k`;
  else if (n.endsWith('eł')) return `${n.slice(0, -2)}le`;
  else if (n.endsWith('ł')) return `${n.slice(0, -1)}le`;
  else if (n.endsWith('ś')) return `${n.slice(0, -1)}siu`;
  else if (n.endsWith('ń')) return `${n.slice(0, -1)}niu`;
  else if (/[^aeiouyąęó]er$/.test(n)) s = `${n.slice(0, -2)}r`; // Aleksander → Aleksandrze, Kacper → Kacprze
  if (/(?:[kgjlh]|ch|cz|sz|rz|ż|c|dz)$/.test(s)) return `${s}u`;
  if (/st$/.test(s)) return `${s.slice(0, -2)}ście`;
  if (/t$/.test(s)) return `${s.slice(0, -1)}cie`;
  if (/d$/.test(s)) return `${s}zie`;
  if (/r$/.test(s)) return `${s}ze`;
  return `${s}ie`;
}

// Wołacze równe słowu pospolitemu albo powitaniu („Halo” od Hala, „Celu” od Cela, „Polu” od Pola).
const VOCATIVE_STOP = new Set<string>('halo celu polu ago'.split(' '));
// Wołacz polskiego imienia równy mianownikowi częstego imienia obcego albo słowu łacińskiemu: włoskie,
// hiszpańskie i portugalskie imiona na -o („Mario”, „Julio”, „Paulo”, „Sandro”, „Nino”), japońskie
// („Kubo”), łacina („Anno Domini”). Bez kotwicy zwrotu to zwykle postać, marka albo autor.
const FOREIGN_NOMINATIVE_FORMS = new Set<string>(
  (
    'mario julio paulo paolo sandro nino dino gino lino rino tino franco carlo marco fabio sergio claudio ' +
    'emilio antonio roberto alberto ricardo rocco enzo hugo ugo leo pablo pedro diego alfonso mauro tito ' +
    'aldo silvio flavio livio lucio dario gianni kubo anno'
  ).split(' '),
);
let vocativeIndex: Map<string, string> | null = null;
// Wołacze męskie (od imienia spoza -a): równe miejscownikowi („o Pawle”, „o Henryku”, „o Stasiu”).
let masculineVocatives: Set<string> | null = null;
function buildVocativeIndex(): Map<string, string> {
  if (vocativeIndex) return vocativeIndex;
  const idx = new Map<string, string>();
  const masc = new Set<string>();
  const add = (form: string, lemma: string, source: string): void => {
    if (VOCATIVE_STOP.has(form)) return;
    if (!source.endsWith('a')) masc.add(form);
    if (!idx.has(form)) idx.set(form, lemma);
  };
  for (const [full, dims] of Object.entries(FIRST_NAME_DIMINUTIVES)) {
    if (NOUN_LIKE_FIRST_NAMES.has(full)) continue;
    for (const n of [full, ...dims]) {
      const v = firstNameVocative(n);
      if (v !== n) add(v, full, n);
    }
  }
  for (const n of POLISH_FIRST_NAMES) {
    if (NOUN_LIKE_FIRST_NAMES.has(n) || COLLIDING_NAME_FORMS.has(n)) continue;
    const v = firstNameVocative(n);
    if (v !== n) add(v, n, n);
  }
  // forma będąca też mianownikiem innego imienia („Bruno”) nie jest wyłącznie wołaczem
  for (const n of POLISH_FIRST_NAMES) idx.delete(n);
  vocativeIndex = idx;
  masculineVocatives = masc;
  return idx;
}
/**
 * Pełne imię (mianownik, małe litery) dla wołacza różnego od mianownika („marku” → „marek”, „kasiu” →
 * „katarzyna”, „olu” → „aleksandra”), inaczej null. Zdrobnienie prowadzi do pełnego imienia, żeby
 * pseudonim był ten sam co przy „Katarzyna Nowak”. Bez imion będących rzeczownikiem („Różo”, „Polu”).
 * Dla zwrotu z kotwicą („Panie Marku”, „Cześć Mario”, „Pani Anno”).
 */
export function firstNameOfVocative(word: string): string | null {
  return buildVocativeIndex().get(word.toLowerCase()) ?? null;
}
/**
 * Jak firstNameOfVocative, ale dla wołacza bez kotwicy zwrotu (sam przecinek, początek wiersza): bez form
 * równych mianownikowi imienia obcego („Mario”, „Leonie”, „Paulo”) i słowu łacińskiemu („Anno”), bo w
 * wyliczeniu i tabeli to postać, marka albo autor, nie zwrot do osoby.
 */
export function firstNameOfBareVocative(word: string): string | null {
  const l = word.toLowerCase();
  if (FOREIGN_NOMINATIVE_FORMS.has(l) || FOREIGN_GIVEN_NAMES.has(l) || WESTERN_GIVEN_NAMES.has(l)) return null;
  return firstNameOfVocative(l);
}
/** Czy wołacz ma kształt miejscownika (męski: „Pawle”, „Henryku”, „Janie”, „Stasiu”)? */
export function vocativeEqualsLocative(word: string): boolean {
  buildVocativeIndex();
  return masculineVocatives?.has(word.toLowerCase()) ?? false;
}

/**
 * Częste imiona angielskie i niemieckie (małe litery). Tylko dla zwrotu, tytułu i podpisu w tekście
 * obcojęzycznym („Dr Helen Carter”, „Hi Tom,”, „Best regards, Oliver”), gdzie kotwicą jest formuła,
 * a imię ją potwierdza. Bez imion będących zwykłym słowem (will, may, june, grace, rose, hope).
 */
export const WESTERN_GIVEN_NAMES = new Set<string>(
  (
    'john james robert william richard thomas charles christopher daniel matthew anthony mark steven paul ' +
    'andrew joshua kevin brian george timothy edward jason ryan jacob gary nicholas eric jonathan stephen ' +
    'justin scott brandon benjamin samuel gregory raymond alexander patrick jack dennis tyler aaron henry ' +
    'adam douglas nathan peter zachary kyle walter harold jeremy ethan carl keith roger christian sean arthur ' +
    'noah lawrence jesse bryan jordan albert dylan bruce alan logan ralph vincent russell louis philip ' +
    'bradley oliver harry charlie jamie liam lucas simon martin neil graham ian colin nigel stuart ' +
    'mary patricia jennifer linda elizabeth barbara susan jessica sarah karen nancy lisa margaret sandra ' +
    'ashley kimberly emily donna michelle dorothy amanda melissa deborah stephanie rebecca sharon laura ' +
    'cynthia kathleen amy angela helen anna brenda pamela nicole emma samantha katherine christine rachel ' +
    'catherine carolyn janet maria heather diane virginia julie victoria olivia kelly christina lauren joan ' +
    'evelyn judith megan andrea hannah martha jacqueline frances gloria teresa kathryn sara alice abigail ' +
    'julia denise danielle sophia marie diana natalie isabella charlotte lucy chloe sophie claire fiona ' +
    'hans klaus wolfgang jürgen michael andreas stefan uwe matthias markus tobias florian sebastian lukas ' +
    'jonas felix maximilian moritz niklas leon finn elias tim david sabine petra monika ursula renate ' +
    'claudia susanne birgit karin heike gabriele brigitte anja stefanie katrin lena lea leonie mia emilia ' +
    'johanna greta ingrid helga gisela jens dirk sven torsten holger'
  ).split(/\s+/),
);

/**
 * Częste nazwiska angielskie i niemieckie (małe litery). Tylko po obcym tytule („Mrs Smith”, „Frau
 * Schneider”), gdzie sam tytuł nie wystarcza, bo stoi też przed marką i postacią („Mr Proper”, „Mrs
 * Dalloway”). Bez nazwisk będących zwykłym słowem lub marką (green, king, cook, wolf, braun, richter).
 */
export const WESTERN_SURNAMES = new Set<string>(
  (
    'smith johnson williams jones miller davis wilson anderson taylor moore jackson harris clark lewis ' +
    'robinson walker allen wright campbell mitchell roberts carter phillips evans turner parker collins ' +
    'edwards stewart morris murphy rogers morgan cooper peterson bailey richardson watson brooks bennett ' +
    'hughes sanders myers foster powell jenkins sullivan coleman butler henderson barnes fisher hastings ' +
    'thompson johnston robertson macdonald mackenzie fraser ferguson mcdonald o’brien kennedy wallace ' +
    'müller mueller schmidt schneider fischer weber meyer meier mayer maier wagner becker schulz schulze ' +
    'hoffmann hofmann schäfer schaefer bauer schröder schroeder neumann zimmermann krüger krueger hartmann ' +
    'schmitt schmitz werner krause lehmann köhler koehler herrmann huber fuchs scholz möller moeller ' +
    'schubert günther friedrich keller winkler berger lorenz baumann franke albrecht schuster böhm ' +
    'schumacher krämer vogt seidel brandt haas schreiber dietrich ziegler kuhn pohl bergmann voigt ' +
    'pfeiffer wolff engel weiß weiss jäger hahn vogel sommer'
  ).split(/\s+/),
);
