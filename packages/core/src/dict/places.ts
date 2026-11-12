// Słowniki polskich miejscowości dla passCity: nazwy wielowyrazowe i miasta przed adresem bez kodu.

/**
 * Miejscowości wielowyrazowe: ile słów za kodem pocztowym dołączyć do maski (passCity, miejscowość
 * po kodzie). Jednowyrazowe i z myślnikiem są jednym tokenem, więc nie wymagają wpisu; wariant
 * ze spacją („bielsko biała”) jest, bo bywa pisany rozłącznie. Brak wpisu maskuje sam pierwszy człon.
 */
export const MULTIWORD_CITIES = new Set<string>(
  (
    'nowy sącz|nowy targ|nowy dwór mazowiecki|nowy dwór gdański|nowy wiśnicz|nowy żmigród|' +
    'nowe miasto lubawskie|nowe miasto nad pilicą|nowe miasto nad wartą|nowa sól|nowa ruda|' +
    'nowa dęba|nowa słupia|stary sącz|zielona góra|jelenia góra|kamienna góra|góra kalwaria|' +
    'góra śląska|dąbrowa górnicza|dąbrowa tarnowska|dąbrowa białostocka|ruda śląska|stalowa wola|' +
    'ostrów wielkopolski|ostrów mazowiecka|ostrowiec świętokrzyski|biała podlaska|biała rawska|' +
    'bielsko biała|wysokie mazowieckie|grodzisk mazowiecki|grodzisk wielkopolski|tomaszów mazowiecki|' +
    'tomaszów lubelski|piotrków trybunalski|rawa mazowiecka|sokołów podlaski|wodzisław śląski|' +
    'aleksandrów kujawski|aleksandrów łódzki|konstantynów łódzki|gorzów wielkopolski|górowo iławeckie|' +
    'szklarska poręba|bystrzyca kłodzka|nowogród bobrzański|maków mazowiecki|maków podhalański|' +
    'mińsk mazowiecki|kostrzyn nad odrą|miejska górka|tarnowskie góry|czerwionka leszczyny|' +
    'sępólno krajeńskie|solec kujawski|środa wielkopolska|środa śląska|oborniki śląskie|brzeg dolny|' +
    'skarżysko kamienna|murowana goślina|miasteczko śląskie|ożarów mazowiecki|kędzierzyn koźle|' +
    'duszniki zdrój|kudowa zdrój|polanica zdrój|lądek zdrój|busko zdrój|rabka zdrój|iwonicz zdrój|' +
    'konstancin jeziorna|jastrzębie zdrój|goczałkowice zdrój|połczyn zdrój|świeradów zdrój|' +
    // toponimy „imię + przymiotnik”: bez wpisu para wygląda na osobę
    'kazimierz dolny|kazimierza wielka|' +
    // człon przymiotnikowy o końcówce nazwiskowej („Zebrzydowska”) bez wpisu dostałby maskę osoby
    'kąty wrocławskie|pruszcz gdański|kalisz pomorski|siemianowice śląskie|strzelce opolskie|' +
    'strzelce krajeńskie|zalesie górne|stare babice|żabia wola|wiązowna kościelna|kalwaria zebrzydowska|' +
    'biały dunajec|czarny dunajec|tarnowo podgórne|łomianki dolne|dobre miasto|zduńska wola|' +
    'nowe skalmierzyce|bielsk podlaski|sucha beskidzka|krosno odrzańskie|drawsko pomorskie|' +
    'kamień pomorski|radzyń podlaski|międzyrzec podlaski|opole lubelskie|ząbkowice śląskie|' +
    'stronie śląskie|nowy tomyśl|nowe warpno|stargard szczeciński|czechowice dziedzice|' +
    'jelcz laskowice|krynica zdrój|krynica morska|szczawno zdrój|piwniczna zdrój|trzcińsko zdrój|' +
    'ustrzyki dolne|mszana dolna|bukowina tatrzańska|janów lubelski|janów podlaski|sokołów małopolski|' +
    'rudnik nad sanem|krościenko nad dunajcem'
  ).split('|'),
);
// Miejscowniki nazw wielowyrazowych („zam. w Piotrkowie Trybunalskim”): bez nich przymiotnik
// o końcówce nazwiskowej dostawałby maskę osoby.
const MULTIWORD_CITIES_LOC = (
  'dąbrowie górniczej|dąbrowie tarnowskiej|dąbrowie białostockiej|rudzie śląskiej|stalowej woli|' +
  'piotrkowie trybunalskim|gorzowie wielkopolskim|ostrowie wielkopolskim|ostrowi mazowieckiej|' +
  'ostrowcu świętokrzyskim|tomaszowie mazowieckim|tomaszowie lubelskim|mińsku mazowieckim|' +
  'białej podlaskiej|białej rawskiej|nowym dworze mazowieckim|nowym dworze gdańskim|' +
  'grodzisku mazowieckim|grodzisku wielkopolskim|sokołowie podlaskim|wodzisławiu śląskim|' +
  'aleksandrowie kujawskim|aleksandrowie łódzkim|konstantynowie łódzkim|rawie mazowieckiej|' +
  'tarnowskich górach|środzie wielkopolskiej|środzie śląskiej|makowie mazowieckim|makowie podhalańskim|' +
  'wysokiem mazowieckiem|starym sączu|nowej soli|nowej rudzie|kamiennej górze|górze kalwarii|' +
  'kątach wrocławskich|pruszczu gdańskim|siemianowicach śląskich|strzelcach opolskich|' +
  'strzelcach krajeńskich|starych babicach|zduńskiej woli|tarnowie podgórnym|kalwarii zebrzydowskiej|' +
  'dobrym mieście|nowym mieście lubawskim|bielsku podlaskim|suchej beskidzkiej|krośnie odrzańskim|' +
  'drawsku pomorskim|kamieniu pomorskim|radzyniu podlaskim|międzyrzecu podlaskim|opolu lubelskim|' +
  'ząbkowicach śląskich|solcu kujawskim|skarżysku kamiennej|łomiankach dolnych|zalesiu górnym|' +
  'białym dunajcu|nowym tomyślu|czechowicach dziedzicach|stargardzie szczecińskim|sępólnie krajeńskim|' +
  'ożarowie mazowieckim|obornikach śląskich|brzegu dolnym|bystrzycy kłodzkiej|szklarskiej porębie|' +
  'murowanej goślinie'
).split('|');

/**
 * Miasta przed adresem bez kodu pocztowego („Warszawa, ul. …”; passCity). Kotwicą jest sam
 * wskaźnik adresu, więc bez słownika miasto nie odróżniłoby się od ogona nazwy instytucji
 * („Zarząd Dróg Miejskich, ul. …”). Nie działa w wolnym tekście. Krótkie, wieloznaczne nazwy
 * (Biała, Wola, Góra) są tylko w formie wielowyrazowej.
 */
export const POLISH_CITIES = new Set<string>([
  ...MULTIWORD_CITIES,
  ...MULTIWORD_CITIES_LOC,
  ...(
    // mianownik: miasta wojewódzkie, na prawach powiatu i większe ośrodki
    'warszawa|kraków|łódź|wrocław|poznań|gdańsk|szczecin|bydgoszcz|lublin|białystok|katowice|' +
    'gdynia|częstochowa|radom|sosnowiec|toruń|kielce|rzeszów|gliwice|zabrze|olsztyn|bytom|rybnik|' +
    'opole|tychy|elbląg|płock|wałbrzych|włocławek|tarnów|chorzów|koszalin|kalisz|legnica|grudziądz|' +
    'słupsk|jaworzno|konin|piła|inowrocław|lubin|suwałki|stargard|gniezno|głogów|pabianice|leszno|' +
    'żory|zamość|pruszków|łomża|ełk|chełm|mielec|przemyśl|tczew|bełchatów|świdnica|będzin|zgierz|' +
    'racibórz|legionowo|ostrołęka|świętochłowice|zawiercie|starachowice|wejherowo|skierniewice|' +
    'świnoujście|puławy|tarnobrzeg|kutno|nysa|ciechanów|sopot|sieradz|radomsko|kołobrzeg|szczecinek|' +
    'otwock|świdnik|bochnia|oświęcim|krosno|sanok|cieszyn|dębica|jarosław|luboń|malbork|żyrardów|' +
    'kwidzyn|oleśnica|chrzanów|jasło|brodnica|kraśnik|wągrowiec|giżycko|sochaczew|olkusz|świebodzice|' +
    'augustów|brzeg|andrychów|wyszków|bartoszyce|mława|kętrzyn|nakło|turek|świecie|oława|krotoszyn|' +
    'kościan|gostyń|jarocin|śrem|trzebnica|bolesławiec|zgorzelec|lubań|dzierżoniów|kluczbork|brzesko|' +
    'wieliczka|myślenice|gorlice|limanowa|zakopane|trzebinia|libiąż|wadowice|żywiec|pszczyna|mikołów|' +
    'lubliniec|knurów|pyskowice|nowogard|police|goleniów|gryfino|choszczno|wałcz|złotów|chodzież|' +
    'oborniki|wolsztyn|września|środa|krapkowice|kędzierzyn|namysłów|prudnik|strzelce|ozimek|' +
    // miasta z myślnikiem są jednym tokenem, więc potrzebują formy z myślnikiem
    'bielsko-biała|kędzierzyn-koźle|jastrzębie-zdrój|skarżysko-kamienna|konstancin-jeziorna|' +
    'kudowa-zdrój|polanica-zdrój|duszniki-zdrój|lądek-zdrój|busko-zdrój|rabka-zdrój|iwonicz-zdrój|' +
    'świeradów-zdrój|połczyn-zdrój|goczałkowice-zdrój|' +
    // ich formy zależne („ur. w Bielsku-Białej”)
    'bielsku-białej|bielska-białej|kędzierzynie-koźlu|kędzierzyna-koźla|jastrzębiu-zdroju|' +
    'skarżysku-kamiennej|konstancinie-jeziornie|' +
    // formy zależne dużych miast
    'warszawie|warszawy|krakowie|krakowa|łodzi|wrocławiu|wrocławia|poznaniu|poznania|gdańsku|gdańska|' +
    'szczecinie|bydgoszczy|lublinie|lublina|katowicach|gdyni|częstochowie|radomiu|radomia|sosnowcu|' +
    'toruniu|torunia|kielcach|rzeszowie|olsztynie|opolu|płocku|tarnowie|koszalinie|kaliszu|legnicy|' +
    'słupsku|zamościu|chełmie|elblągu|gliwicach|bytomiu|rybniku|' +
    // miejscownik średnich miast
    'sopocie|gnieźnie|inowrocławiu|koninie|głogowie|lesznie|ełku|mielcu|tczewie|będzinie|zgierzu|' +
    'raciborzu|zawierciu|wejherowie|świnoujściu|puławach|kutnie|nysie|ciechanowie|sieradzu|kołobrzegu|' +
    'otwocku|oświęcimiu|krośnie|sanoku|cieszynie|jarosławiu|zakopanem|żywcu|wieliczce|wadowicach|' +
    'pszczynie|mikołowie|jaworznie|dąbrowie|chorzowie|zabrzu|jastrzębiu|tychach|wałbrzychu|włocławku|' +
    'grudziądzu|jeleniej górze|zielonej górze|nowym sączu|nowym targu|nowym dworze|gorzowie|' +
    'stargardzie|świdnicy|piotrkowie|ostrowie|suwałkach|starachowicach|skierniewicach|tarnobrzegu|' +
    'białymstoku|białegostoku|pruszkowie|pruszkowa|legionowie|legionowa|siedlce|siedlcach|siedlec|' +
    // toponimy „imię + przymiotnik” bez „kazimierza wielkiego” (król, patron ulic)
    'kazimierzu dolnym|kazimierza dolnego|kazimierzem dolnym|kazimierzy wielkiej'
  ).split('|'),
]);
