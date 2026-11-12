// Słownik polskich nazwisk z fleksją, stoplisty przymiotników i rozpoznawacz morfologiczny do maskowania
// nazwiska bez pary z imieniem i bez tytułu („Sprawę Kowalskiego przekazano…").

const wordSet = (s: string): Set<string> => new Set(s.trim().split(/\s+/));

/** Nazwiska jednoznaczne: małe litery, mianownik (forma męska dla -ski/-cki/-dzki). */
const SURNAMES = wordSet(
  'nowak kowalski wiśniewski wójcik kowalczyk kamiński lewandowski zieliński szymański ' +
  'woźniak dąbrowski kozłowski jankowski wojciechowski kwiatkowski krawczyk kaczmarek ' +
  'piotrowski grabowski pawłowski michalski nowakowski wieczorek jabłoński adamczyk ' +
  'majewski nowicki olszewski stępień jaworski malinowski pawlak górski witkowski walczak ' +
  'rutkowski michalak szewczyk ostrowski tomaszewski pietrzak zalewski wróblewski ' +
  'marciniak jasiński zawadzki sadowski chmielewski włodarczyk borkowski sokołowski ' +
  'czarnecki sawicki kucharski maciejewski szczepański kubiak kalinowski wysocki adamski ' +
  'kaźmierczak wasilewski sobczak czerwiński andrzejewski cieślak głowacki zakrzewski ' +
  'kołodziej sikorski krajewski gajewski szymczak szulc baranowski laskowski brzeziński ' +
  'makowski ziółkowski przybylski domański nowacki borowski błaszczyk chojnacki ' +
  'ciesielski kaczmarczyk urbański sobolewski olejniczak tomczak stasiak kołodziejczyk ' +
  'olejnik czajkowski stankiewicz wilczyński orłowski konieczny urbaniak markowski ' +
  'michalczyk lipiński romanowski matuszewski kubicki wierzbicki sowiński więcek ' +
  'wesołowski jastrzębski leszczyński chrzanowski mikołajczyk osiński bednarek bednarczyk ' +
  'bednarski kozak popławski janik żukowski wojtas gawlik bielecki śliwiński śliwa ' +
  'kowalewski jakubowski wawrzyniak lisowski janicki janiszewski klimczak klimek kasprzak ' +
  'świątek szymkowiak sienkiewicz łuczak dobrowolski mazurkiewicz kowalik sołtysiak ' +
  'bukowski konopka korzeniowski kosiński kowalczuk lipka łukasik majchrzak markiewicz ' +
  'masłowski matusiak młynarczyk morawski murawski niedźwiedzki niewiadomski pawelec ' +
  'pawlik piasecki pietrzyk rogowski rudnicki rudziński rybarczyk skowroński smoliński ' +
  'stachowiak stachura stefański stolarczyk strzelecki szafrański szostak szydłowski ' +
  'tarnowski trojanowski twardowski urban winiarski wojtczak wojtkowiak wolski woś ' +
  'żebrowski żurawski cichocki głogowski świderski stec ' +
  'krzemiński krzyżanowski kurowski lewicki mielczarek niemczyk pilarski ' +
  'raczyński radecki rogalski rosiński różycki sieradzki wachowiak ' +
  // ~900 najczęstszych nazwisk z rejestru PESEL (dane.gov.pl 2023, CC0), bez -ski/-cki/-icz/-czyk,
  // bo te łapie looksLikeSurname. Homonimy wyrazów pospolitych („górka", „żurek") pominięte.
  'adach adamczak adamczuk adamek adamiak adamiec adamus ambroziak andrzejak andrzejczak antczak antkowiak antoniak antoniuk antosik augustyniak badura bajorek bakuła balcer balcerek balcerzak banach banasiak banasik banaszak banaszek banaś baraniak barczak barnaś bartczak bartkowiak bartos bartosiak bartosik bartoszek bartyzel basiak batko bator bazan bałdyga bereza bernaś białowąs białoń biedroń bielec bienias bieniek biernat bień bieńko biniek bizoń blicharz bloch bodnar bodziony bogusz boichuk boiko bojko bondar bondarenko bonk borowiak boroń boruta brodziak brożek brożyna bryl bryś brzostek buczak budnik budny bukała błach błachut błasiak błaszak błaszczak błoch cabaj caban cedro ceglarek chmielowiec choma chornyi chowaniec chołuj chrapek chyła cichosz cichoń cierniak cieślar cieślik ciok ciosek cisek ciszek curyło cwalina cwynar cyran czachor czaja czarnik czernik czubak danielak daniluk depta deptuła derda dobek dolata domin dominiak dopierała dorosz dołęga drabik dragan drzymała drężek dudziak dudzic dudzik dulęba dura duraj dutka dybała dyrda dziadosz dębiec fabisiak faron ferenc ficek fila filipczak filipiak firlej fiszer florczak florek fojcik foks foltyn formela formella foryś franczak frontczak frydrych frąckowiak frączek frąszczak frątczak fuchs furmanek furtak fąfara gabor gabrysiak gaca gajos galus gancarz gawin gawor gawryś gałuszka giemza gierczak ginter giza godek golik gondek gonera gontarz gozdek gołda gołdyn gościniak grabiec gralak grela grenda greń grobelny grochal gromek grygiel grzegorek grzelak grzesiak grzesik grzeszczak grzeszczuk grześkowiak gręda gubała gucwa gurgul górak górniak góźdź gądek gębala głodek głuch głuszek havryliuk hawryluk hebda hernik hinc hinz hoffmann hofman hoppe hołda humeniuk hyla idziak idzik ignaczak ignasiak ivanov iwaniec iwaniuk jach jadczak jagieła jagiełło jakubczak jakubek jakubiak jakubiec jakubik jamrozik jamróz janas janczak janeczek janeczko jania janiak janiec jankowiak janota janus jaromin jaros jaroszek jaroń jasek jasiak jasik jaskuła jaszczak jaszczuk jaworek jałocha jańczak jaśkowiak jopek juraszek jurczak jurga juszczak józefiak jóźwiak jóźwik jędrasik jędrzejak jędrzejczak kachel kacprzak kacprzyk kaczmarzyk kaim kalata kalemba kalita karbowiak karbownik kardas kardasz karolak karolczak karpiuk karwat kasperek kasprzyk kazimierczak kałużny kempa kharchenko kielar kiełtyka kijak klich klim klimas kliś kluba kluz klymenko kmieciak kmita knap knapik knop kobiela kobus kobylarz koch kochan kocjan kocot kocoń kolenda kondraciuk kondrat kondratiuk konefał konieczka konior konkel konkol konopko kopera korcz korczak kordek korol korus kosek kosiba kosik kosior kosiorek kosmala kostiuk kotarba kotas kotula koval kovalchuk kovalenko kovalov kowol kozub kozyra kołodziejczak kończak kościelniak kośmider koźlik krasoń kraus krause krauze kravchenko kravchuk kravets krawczak krawczuk kreft kryczka krygier krysa krysiak krystek krysztofiak krzysztofik krzysztoń krzyżaniak królak krężel kubala kubas kubat kubera kubica kubis kubiś kuczek kuczera kujawa kulawik kuleta kuliś kulpa kulyk kumor kupczak kupis kuras kuraś kurdziel kuriata kurzeja kushnir kusiak kustra kusz kuzmenko kułaga kuśmierek kuśmierz kuźma kuźniar kuźnik kwapisz kwaśniak kwaśnik kwiek kwolek kądziela kądziołka kędra kędzia kłusek kłys labuda langer langner lasota latos lehmann leja lenart lesiak levchenko lewczuk leśniak libera ligęza lorek lorenc ludwiczak lysenko machnik machura maciak maciaszek maciejak maciołek maciąg madej madeja magdziak magdziarz magiera majda majer majkut maksymiuk malek malesa marchenko marchuk marcisz marczak marczuk marszał martyniak martyniuk maruszak marut mastalerz masternak matczak mateja matejko matras matusik matuszak matuszczak matuszek matuła matyja matys matysek matysiak matysik mazurczak maćkowiak małek małolepszy małysz meller melnychuk melnyk mentel michalczuk michalec michalik michna michno michoń michta mielcarek mielniczuk mielnik migas mikos mikołajczak mikołajczuk mikrut mikuła milczarek miotk mirga misiura miszczak miszczuk misztal mitura mizera molenda momot morawiec moroz mroczka mrowiec mrozek mrozik mrożek mrzygłód muras musialik musielak musioł nadolny najda nakonieczny nalepa napora narloch nawara nawrat nazaruk nejman neumann nguyen nocoń nogaj nosal nowik nowosad nycz nykiel obara ochman ociepa ogorzałek olczak olech oleksiak oleksiuk oleksy oleszczuk oliinyk olszak orzoł osiak osuch owczarzak ozga ozimek ołdak ożga pabian pacek paduch pajor panasiuk papis parys parzych pasik pastuszak paszek paszko paterek pavlenko pavliuk pawluczuk pawluk pawlus pałys paździor pelc pelczar petrenko petrov pełka piech piecha piechaczek piechnik piechowiak piekut piela pietras pietrasik pietraszek pietraszko pietrucha pietryka pikul pikuła piontek pisarek pisula piszczek piękoś piłat plata plichta podolak podsiadło podsiadły polishchuk polit poloczek polok ponomarenko popek popiel popov potrykus poźniak prokop prokopiuk przybylak przybyłek puchała puzio pyrek pytka pytlak pytlik pyzik pękala rachwał radoń radwan radzik rakoczy rapacz ratajczak rejman richert rojek romanek romaniuk romańczuk rosiak rosiek rosik roszak rozmus rudenko rudnik rusinek rychlik rychter ryczek ryszka rzeszutek rząsa rębisz sajdak salamon samek samsel sasin savchenko savchuk sawa sawczuk sałek schulz sekuła semeniuk sereda shevchenko shevchuk shvets sidor siek sieńko siuda siuta siwiec siwik skoczeń skoczylas skoneczny skonieczny skrzyniarz skrzypczak skupień skuza smolak smolarek smoleń sobala sobiech sobieraj sobik sobkowiak soboń solarz soroka sołtysik spyra stachera stachyra stadnik stanek staniak staniek stanisz staroń starzyk stasik stasiuk staszak stawarz stańczak stańczuk stańko stefaniak stefaniuk stencel stenka stepaniuk steć stolarek struzik stróżyk styś stępniak suder sudoł sulej suliga sulima surmacz suszek sułek sydorenko syrek szafraniec szarek szczepanek szczepaniak szczepanik szcześniak szczypka szczęch szczęśniak szeliga szewczak szewczuk szkudlarek szmidt szmigiel szmit szmyd szmyt sznajder szostek szreder szubert szulik szustak szwarc szydlik szymanek szymaniak szymoniak szymura szyszko talaga tarasiuk targosz tkach tkachenko tkachuk tkocz tomala tomasiak tomasik tomczuk treder trela tworek tyszka urbanek urbanik vasylenko volkov voloshyn wach wadas wajda wajs walas walasek walaszek walczuk waliczek walkowiak wanat wasiak wasiluk waszak waszczuk wawer wawro waśko wcisło wdowiak wegner wencel wenta widera wielgosz wielgus wieliczko wiercioch wilkosz winkler wiszowaty witczak wiącek więch więcław wnęk woch wojas wojcieszak wojda wojdyła wojnar wojtal wojtala wojtasik wojtaszek wojtaś wojtysiak wojtyła wolak wolanin wołoszyn wołowiec woźniczka wrzosek wszołek wypych wójciak włodarczak zadrożny zajdel zapart zaremba zarychta zawadka zawisza zawiślak zdeb zdunek zelek zhuk ziaja ziemba zimoch ziobro zięcina ziętara ziętek zych łabuz łada ławniczak łojek łukasiak łukaszuk łuszcz ślęzak śmigiel świercz świąder święch świętek żygadło',
);

/** Nazwiska będące też rzeczownikami, dniami lub miesiącami (Wilk, Baran, Piątek): maskowane tylko
 *  z kotwicą (imię, „Pan/Pani"), nigdy samodzielnie, żeby nie ruszać zdań typu „Wilk biegał po lesie". */
export const HOMOGRAPH_SURNAMES = wordSet(
  'mazur mazurek zając baran wilk lis kot kruk sowa mucha wrona sroka czajka gołąb dudek ' +
  'wróbel sikora kania szczygieł skowronek orzeł kaczor piątek sobota niedziela środa ' +
  'kwiecień maj marzec styczeń grudzień lipiec sierpień król kowal rybak krawiec cieśla ' +
  'sołtys turek czech niemiec prus cygan góral polak socha skiba krupa paluch noga żyła ' +
  'duda bąk mróz rak ptak drozd okoń szpak pająk motyl żuk chmiel kalina jagoda gruszka ' +
  'żak kurek sitek gajda jarosz marek bober przybysz dziedzic mroczek starosta',
);

// Odmiana przymiotnikowa -ski/-cki/-dzki: przypadki zależne i żeńskie oraz liczba mnoga -scy/-ccy/-dzcy.
const RE_ADJ_OBLIQUE = /(sk|ck|dzk)(?:iego|iemu|imi|ich|im|iej|ą|a)$/;
const RE_ADJ_PLURAL = /(c|dz|s)cy$/;

/** Mianownik męski odmienionego przymiotnika na -ski/-cki/-dzki albo null. */
const adjBase = (w: string): string | null =>
  RE_ADJ_OBLIQUE.test(w)
    ? w.replace(RE_ADJ_OBLIQUE, '$1i')
    : RE_ADJ_PLURAL.test(w)
      ? w.replace(RE_ADJ_PLURAL, '$1ki')
      : null;

// Fleksja: przymiotnikowa (Kowalskiego, Wiśniewskiej, Kowalscy → -ski) i rzeczownikowa przez odcięcie
// końcówki z ruchomym „e" (Nowaka → nowak, Wieczorka → wieczorek).
// Końcówki od najdłuższej, bo wygrywa pierwsza pasująca: Nowakowie, Nowakowi, Nowakiem, Nowaka.
const NOUN_ENDINGS = ['owie', 'ował', 'owi', 'iem', 'ami', 'ach', 'em', 'om', 'ów', 'u', 'a', 'ą', 'ę', 'y', 'o', 'e'];

const NO_E = /([^aeiouąęóy])([^aeiouąęóy])$/; // ruchome „e": kurk → kurek, wróbl → wróbel
const RE_O_OO = /o([^aeiouąęóy]+)$/; // o → ó w temacie: mroz → mróz

/**
 * Forma bazowa homografu, także odmienionego („Wróbla" → wróbel, „Sikorą" → sikora, „Mroza" → mróz),
 * albo null. O tym, czy to osoba, decyduje kotwica wywołującego.
 */
export function homographBase(word: string): string | null {
  const w = word.toLowerCase();
  if (HOMOGRAPH_SURNAMES.has(w)) return w;
  for (const end of NOUN_ENDINGS) {
    if (w.length - end.length < 2 || !w.endsWith(end)) continue;
    const stem = w.slice(0, -end.length);
    for (const c of [stem, stem.replace(NO_E, '$1e$2'), `${stem}a`, stem.replace(RE_O_OO, 'ó$1')]) {
      if (HOMOGRAPH_SURNAMES.has(c)) return c;
    }
  }
  return null;
}

/**
 * Klucz tożsamości do pseudonimizacji: ten sam dla wszystkich form jednej osoby, niekoniecznie
 * poprawny językowo. Alternacje tematu (Stępień/Stępnia) dają różne klucze.
 */
export function normalizeSurnameKey(word: string): string {
  const w = word.toLowerCase();
  const base = surnameBase(w) ?? adjBase(w);
  if (base) return base;
  for (const end of NOUN_ENDINGS) {
    if (w.length - end.length >= 4 && w.endsWith(end)) return w.slice(0, -end.length);
  }
  return w;
}

/** Forma bazowa nazwiska ze słownika (małe litery) albo null. `word` to jeden token. */
export function surnameBase(word: string): string | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null;
  if (SURNAMES.has(w)) return w;
  const adj = adjBase(w);
  if (adj !== null && SURNAMES.has(adj)) return adj;
  for (const end of NOUN_ENDINGS) {
    if (w.length - end.length >= 3 && w.endsWith(end)) {
      const stem = w.slice(0, -end.length);
      for (const c of [stem, stem.replace(NO_E, '$1e$2')]) if (SURNAMES.has(c)) return c;
    }
  }
  return null;
}

let asciiSurnames: Set<string> | null = null;
/** Zapis bez polskich znaków, jak w loginach i nazwach katalogów („kamiński" → „kaminski"). */
export const foldAscii = (s: string): string => s.replace(/[ąćęłńóśźż]/g, (c) => 'acelnoszz'['ąćęłńóśźż'.indexOf(c)]);
/**
 * Czy wyraz ASCII to mianownik nazwiska ze słownika (też żeński -ska/-cka/-dzka)? Loginy i ścieżki
 * profili nie mają ogonków ani odmiany. Indeks budowany leniwie, żeby tekst bez loginów go nie płacił.
 */
export function isAsciiSurname(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 4 || /[^a-z]/.test(w)) return false;
  asciiSurnames ??= new Set([...SURNAMES].map(foldAscii));
  if (asciiSurnames.has(w)) return true;
  return /(?:sk|ck|dzk)a$/.test(w) && asciiSurnames.has(`${w.slice(0, -1)}i`);
}

/**
 * Sufiksy nazwiskowe w mianowniku i częstych przypadkach: -ski/-cki/-dzki, -icz (z -wicz/-owicz/-ewicz),
 * -czyk. Wyrazy pospolite prawie ich nie mają, poza przymiotnikami, które odsiewa NON_SURNAME_ADJ.
 */
const SURNAME_SUFFIX =
  /(?:sk|ck|dzk)(?:i|a|iego|iej|iemu|im|imi|ich|ą)$|(?:scy|ccy|dzcy)$|icz(?:a|owi|em|owie|ami|ach)?$|czyk(?:a|owi|iem|ami|ach|owie)?$/;

/**
 * Wyrazy o końcówce nazwiskowej, które nazwiskami nie są, w formie bazowej (odmianę sprowadza adjBase):
 * „Polski", „Mazowiecki", „Warszawski" w nazwach własnych. Nie wpisywać tu nazwisk-przymiotników
 * („Górski"), bo mają być maskowane.
 */
export const NON_SURNAME_ADJ = wordSet(
  // narodowe / etniczne
  'polski niemiecki francuski rosyjski angielski brytyjski amerykański włoski hiszpański ' +
  'portugalski czeski słowacki ukraiński białoruski litewski łotewski estoński fiński ' +
  'węgierski rumuński bułgarski serbski chorwacki grecki turecki chiński japoński koreański ' +
  'indyjski arabski izraelski żydowski romski cygański europejski azjatycki afrykański ' +
  'skandynawski bałtycki słowiański unijny radziecki sowiecki ' +
  // regiony / województwa
  'mazowiecki małopolski wielkopolski śląski dolnośląski górnośląski pomorski zachodniopomorski ' +
  'kujawski podlaski lubelski lubuski łódzki opolski podkarpacki świętokrzyski warmiński ' +
  'mazurski kaszubski beskidzki tatrzański ' +
  // miejskie
  'warszawski krakowski gdański poznański wrocławski szczeciński bydgoski katowicki radomski ' +
  'toruński kielecki rzeszowski olsztyński gliwicki tarnowski płocki częstochowski gdyński ' +
  // ogólne i instytucjonalne; „marszałkowski" to Urząd Marszałkowski, osoba o tym nazwisku
  // jest maskowana w parze z imieniem
  'miejski wiejski wojewódzki marszałkowski morski nadmorski królewski cesarski papieski biskupi diecezjalny ' +
  'boski niebiański ziemski świecki damski męski żeński ludzki dziecięcy ojcowski macierzyński ' +
  'lekarski adwokacki nauczycielski rybacki rycerski sąsiedzki ' +
  // zawodowe w nazwach usług i urzędów: „Opieka Pielęgniarska", „Poselski projekt"
  'pielęgniarski aptekarski felczerski poselski prezydencki senacki prokuratorski strażacki ' +
  'olimpijski piłkarski literacki rodzicielski diabelski ' +
  'fryzjerski ' +
  // „Ochrony Środowiska": dopełniacz rzeczownika ma końcówkę -ska, którą adjBase sprowadza do „środowiski"
  'środowiski ' +
  // komitety, związki, fundusze: „Komitet Obywatelski", „Hufiec Harcerski"
  'obywatelski harcerski sołecki chłopski pański szlachecki żołnierski marynarski kupiecki ' +
  'związkowski ' +
  // ogólnokrajowe i uczelniane: „Ogólnopolski Związek", „Uniwersytet Jagielloński"
  'ogólnopolski wszechpolski ogólnokrajowy jagielloński akademicki uniwersytecki ' +
  'studencki pracowniczy związkowy ' +
  // regiony, pasma, parki: „Bieszczadzki Park", „Sądecki"
  'podhalański bieszczadzki karkonoski sądecki gorczański elbląski nadwiślański nadbużański ' +
  // parki narodowe bez homografów nazwisk (słowiński, woliński, magurski): te chroni prawy kontekst
  // „… Park Narodowy", a samodzielne „Słowiński" ma być maskowane
  'białowieski biebrzański pieniński kampinoski babiogórski wigierski drawieński poleski narwiański ' +
  'kołobrzeski koszaliński słupski legnicki wałbrzyski jeleniogórski nowosądecki ' +
  // powiaty („Starosta Wołomiński", „powiat grójecki") bez form, które są częstym nazwiskiem
  // (bielski, sokołowski, dąbrowski); osobę w parze z imieniem i tak maskuje detektor par
  'aleksandrowski andrychowski augustowski barliński bartoszycki bełchatowski bialski ' +
  'bialskopodlaski białobrzeski białogardzki bieruński biskupiecki biłgorajski ' +
  'bogatyński bolesławiecki braniewski buski bystrzycki bytomski bytowski będziński ' +
  'chodzieski chojnicki chorzowski choszczeński ciechociński czarnkowski czechowicki człuchowski ' +
  'dobromiejski drawski drezdenecki działdowski dzierżoniowski dębliński ełcki garwoliński ' +
  'giżycki gnieźnieński goleniowski golubski gorlicki gorzowski gostyniński gołdapski ' +
  'gośliński grodziski grudziądzki gryficki gryfiński grójecki gubiński górowski głubczycki ' +
  'hajnowski helski hrubieszowski inowrocławski iławski jarociński jasielski jaworznicki jelczański ' +
  'jędrzejowski kamiennogórski kartuski kazimierski kleczewski ' +
  'kluczborski kolbuszowski kolneński konecki koniński konstantynowski koronowski kostrzyński ' +
  'kowarski kozielski kozienicki kościański kościerski krajeński krapkowicki ' +
  'krasnostawski kraśnicki krotoszyński krośnieński kutnowski kwidzyński kórnicki kędzierzyński kętrzyński ' +
  'kłobucki kłodzki legionowski leski leżajski lidzbarski limanowski lipnowski lubaczowski lubartowski ' +
  'lubawski lubliniecki luboński lwówecki lęborski lędziński malborski miechowski ' +
  'mikołowski milicki międzychodzki międzyrzecki miński mogileński moniecki morąski mosiński mrągowski ' +
  'mysłowicki myślenicki myśliborski mławski nadnotecki nakielski nidzicki niżański nowogardzki nowomiejski ' +
  'noworudzki nowosolski nowotarski nowotomyski nyski obornicki olecki oleski oleśnicki olkuski ' +
  'opalenicki opatowski opoczyński ostrowiecki ostrołęcki ostrzeszowski ostródzki otwocki ozorkowski ' +
  'oławski oświęcimski ożarowski pabianicki pajęczański parczewski pałucki piaseczyński piastowski pilski piski ' +
  'pińczowski pleszewski pniewski podbeskidzki poddębicki policki polkowicki ' +
  'proszowicki prudnicki pruszczański pruszkowski przasnyski przemyski przeworski przysuski pszczyński pucki ' +
  'puszczykowski puławski pułtuski pyrzycki płoński radomszczański radziejowski radzyński rawicki redzki ' +
  'ropczycki roztoczański rumski rybnicki rycki rypiński sandomierski sejneński siemianowicki ' +
  'siemiatycki sierpecki skarżyski skierniewicki sochaczewski sokólski sopocki sosnowiecki stalowowolski ' +
  'starachowicki stargardzki starogardzki staszowski strzegomski strzeliński strzyżowski stęszewski ' +
  'sulechowski sulejówecki sulęciński suwalski swarzędzki szamotulski szczecinecki szczycieński ' +
  'sztumski szydłowiecki sędziszowski sępoleński sławieński słubicki słupecki tarnobrzeski tarnogórski ' +
  'tczewski tomaszowski trzcianecki trzebnicki tyski ustecki ustrzycki wadowicki ' +
  'wałecki wejherowski wieluński wieruszowski wodzisławski wolsztyński wołomiński ' +
  'wronecki wrzesiński wschowski wysokomazowiecki wąbrzeski wągrowiecki węgorzewski węgrowski ' +
  'władysławowski włocławski włodawski włoszczowski zabrzański zagłębiowski zakopiański ' +
  'zambrowski zawierciański zbąszyński zduńskowolski zgorzelecki zielonogórski zwoleński ząbkowicki złotoryjski ' +
  'złotowski łaski łańcucki łobeski łomżyński łosicki łęczycki średzki śremski świdnicki świdwiński ' +
  'świebodzicki świebodziński świnoujski świętochłowicki żagański żarski żniński żorski ' +
  'żuromiński żyrardowski żywiecki ' +
  // pospolite przymiotniki na -ski/-cki: „Niski poziom", „wąski", „bliski"
  'niski wąski płaski bliski śliski grząski ' +
  // rzeczowniki w liczbie mnogiej na -ski, wielką literą na początku zdania: „Wnioski stron oddalono"
  'wnioski zapiski odpiski przypiski wypiski dopiski naciski zaciski dociski przyciski ' +
  'pociski odciski wyciski uciski uściski ściski zyski uzyski wrzaski trzaski potrzaski ' +
  'błyski przebłyski rozbłyski blaski odblaski odgłoski kioski maski paski laski obcaski ' +
  'deski miski piaski wioski troski kreski łuski pyski odpryski wypryski obeliski ' +
  'spiski półmiski meniski kluski pieski noski klocki ' +
  'kaski dyski placki kiełbaski freski kąski kęski kłoski woski pluski brzaski kołyski ' +
  // wyznaniowe ze złożeń: „Kościół Ewangelicko-Augsburski"
  'katolicki ewangelicki augsburski ' +
  // „Dziecka" (Rzecznik Praw Dziecka): dopełniacz na -cka, który adjBase bierze za żeńskie nazwisko
  'dziecka ' +
  // „Znicz Pruszków": końcówka -icz
  'znicz',
);

/**
 * Rzeczowniki lm. ze stoplisty chronione tylko w tej dokładnej formie („Placki ziemniaczane"),
 * bo adjBase sprowadza do nich dopełniacz nazwisk na -ek („Pełnomocnik Placka wniósł").
 */
const NOUN_PLURAL_ONLY = wordSet('kąski kęski kłoski woski placki');
const blocksAsAdjective = (base: string): boolean => NON_SURNAME_ADJ.has(base) && !NOUN_PLURAL_ONLY.has(base);

// Człony na -sko/-cko/-dzko i ostatni człon („Kujawsko-Pomorski", „Polsko-Niemiecka"). Każdy człon
// kończy się łącznikiem, więc powtórzenie nie cofa się kwadratowo.
const RE_COMPOUND_ADJ = /^(?:[a-ząćęłńóśźż]+(?:sk|ck|dzk)o-)+[a-ząćęłńóśźż]+$/;

// Lista zamknięta, bo „pasko", „dacko", „lisko" to człony nazwisk dwuczłonowych.
const COMPOUND_ADJ_HEADS = wordSet(
  'polsko kujawsko warmińsko śląsko dolnośląsko łódzko wrocławsko mazowiecko pomorsko ' +
    'zachodniopomorsko wielkopolsko małopolsko lubusko lubelsko podlasko podkarpacko opolsko ' +
    'świętokrzysko rzymsko grecko ewangelicko słowacko czesko niemiecko rosyjsko ukraińsko litewsko ' +
    'angielsko francusko włosko hiszpańsko europejsko amerykańsko',
);

/**
 * Czy wyraz to złożony przymiotnik z łącznikiem (Urząd Warmińsko-Mazurski), a nie nazwisko
 * dwuczłonowe? Tak, gdy ostatni człon jest w stopliście („Pasko-Gzowska" odpada) albo wszystkie
 * pierwsze człony są w COMPOUND_ADJ_HEADS, a ostatni nie jest nazwiskiem („Polsko-Szwedzka").
 * Znana luka: „Śląsko-Dąbrowska" wygląda na osobę, bo dąbrowski to częste nazwisko.
 */
export function isCompoundAdjective(word: string): boolean {
  const w = word.toLowerCase();
  if (!RE_COMPOUND_ADJ.test(w)) return false;
  const parts = w.split('-');
  const last = parts.pop() as string;
  if (blocksAsAdjective(last)) return true;
  const adj = adjBase(last);
  if (adj !== null && blocksAsAdjective(adj)) return true;
  return parts.every((p) => COMPOUND_ADJ_HEADS.has(p)) && !surnameBase(last);
}

/**
 * Rzeczowniki na -czyk (zdrobnienia, nazwy mieszkańców) pisane wielką literą na początku zdania.
 * Nie w NON_SURNAME_ADJ, bo stoplista wyłącza też kotwice („Pan Kluczyk" to nazwisko).
 */
export const COMMON_NOUN_LOOKALIKES = wordSet(
  'słowniczyk krzaczyk kluczyk chłopczyk mieczyk ' +
    'chińczyk japończyk koreańczyk wietnamczyk tajwańczyk europejczyk kanadyjczyk australijczyk ' +
    'brazylijczyk argentyńczyk chilijczyk kubańczyk irlandczyk islandczyk duńczyk nowozelandczyk ' +
    'izraelczyk libańczyk syryjczyk irańczyk afgańczyk pakistańczyk nepalczyk',
);
/** Wyrazy z COMMON_NOUN_LOOKALIKES, które są też nazwiskami; rozstrzyga pozycja w zdaniu (person-triggers.ts). */
export const DIMINUTIVE_LOOKALIKES = wordSet('krzaczyk kluczyk mieczyk');

// Żeńskie przymiotniki na -nicza (Komornicza, Rolnicza) i czasowniki „zalicza/oblicza". Spółgłoska
// przed -nicza odróżnia je od dopełniacza nazwiska (Iwanicza, Romanicza, -owicza). Koszt: „Pozew
// Bartnicza" bez kotwicy zostaje jawny.
const RE_NICZA_ADJ = /[^aeiouyąęó]nicza$/;
const RE_LICZA_VERB = /^(?:za|ob|na|wy|prze|od|roz|z|do|w|u)licza$/;

/** Czy wyraz wygląda na nazwisko po samej morfologii? O kontekście decydują przebiegi. */
export function looksLikeSurname(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 5 || !SURNAME_SUFFIX.test(w)) return false;
  if (RE_NICZA_ADJ.test(w) || RE_LICZA_VERB.test(w)) return false;
  return !isGeoAdjective(w);
}

/**
 * Czy wyraz (też odmieniony albo złożony z łącznikiem) to przymiotnik ze stoplisty, a nie nazwisko?
 * Nazwiska-przymiotniki („Górski") dają false.
 */
export function isGeoAdjective(word: string): boolean {
  const w = word.toLowerCase();
  if (NON_SURNAME_ADJ.has(w)) return true;
  if (isCompoundAdjective(w)) return true;
  const adj = adjBase(w);
  return adj !== null && blocksAsAdjective(adj);
}

/** Nazwisko ze słownika albo z samej morfologii. */
export const surnameShaped = (w: string): boolean => !!surnameBase(w) || looksLikeSurname(w);
/** Jak surnameShaped, ale także homograf nazwiska („Piątek", „Mazur"). */
export const isConfirmedSurname = (w: string): boolean => surnameShaped(w) || HOMOGRAPH_SURNAMES.has(normalizeSurnameKey(w));
