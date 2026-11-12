// Strażniki kontekstu wokół numeru przy nazwie ulicy: data, ilość albo lokal za liczbą i odsyłacz
// do pisma przed patronem. Wspólne dla przebiegu adresów i par imię z nazwiskiem.
import { MONTHS_GEN } from '../charset.js';

// Miesiąc w dopełniaczu tuż za numerem („11 listopada") oznacza, że numer to dzień daty. „Maja"
// z wielkiej litery bywa imieniem („ul. Polna 5 Maja Wróbel"), więc jest miesiącem tylko wtedy,
// gdy nie stoi za nim wyraz z wielkiej litery („3 Maja o godz. 12"), stąd osobny RE_MAY_AHEAD.
const RE_MONTH_GEN_AHEAD = new RegExp(
  String.raw`^[ \t]+(?:${MONTHS_GEN.split('|').filter((m) => m !== 'maja').join('|')})(?!\p{L})`,
  'iu',
);
const RE_MAY_AHEAD = /^[ \t]+(?:maja(?!\p{L})|(?:Maja|MAJA)(?!\p{L})(?![ \t]+\p{Lu}))/u;
export const monthAhead = (rest: string): boolean => RE_MONTH_GEN_AHEAD.test(rest) || RE_MAY_AHEAD.test(rest);
// Liczebnik z rzeczownikiem za nazwą ulicy to ilość, nie numer domu („przy ul. Długiej 5 osób
// rannych"). Tylko małą literą, bo „Osoby zameldowane:" to etykieta następnego pola, i nie przed
// liczbą („lat 45" to wiek). Rzeczowniki spoza miar tylko w liczbie mnogiej, a miary tylko w formach
// stojących po liczebniku: „ul. Długa 5 sklep spożywczy" i „ul. Polnej 5 samochodem" to adresy.
// „miejsc." z kropką to skrót „miejscowość" („ul. Polna 5 miejsc. Warszawa").
export const RE_QUANTITY_AFTER = new RegExp(
  '^[ \\t]+(?:tys\\.|tysiąc[ea]?|tysięcy|mln|osób|osoby|ludzi|uczestni(?:ków|cy|czek|czki)|demonstran(?:tów|ci|tek|tki)|' +
    'samochod(?:y|ów)|pojazd(?:y|ów)|razy|minut[y]?|godzin[y]?|sekund[y]?|dni|lat|lata|miesi(?:ące|ęcy)|tygodni(?:e)?|' +
    'doby|dób|wiek(?:i|ów)|metr(?:y|ów)|kilometr(?:y|ów)|km|szt\\.|sztuk|rodzin|dzieci|uczni(?:ów|owie)|' +
    'pracowni(?:ków|cy)|mieszkańc(?:ów|y)|artyst(?:ów|ki|ek)|biegacz(?:y|e)|kierowc(?:ów|y)|pasażer(?:ów|owie)|' +
    'rannych|ofiar|gości|widzów|kibiców|sklep(?:y|ów)|dom(?:y|ów)|budynków|bloków|kamienic|mieszkań|' +
    'pokoje|pokoi|pomnik(?:i|ów)|autobus(?:y|ów)|tramwaj(?:e|ów)|ambasad(?:y)?|pas(?:y|ów)|drzew(?:a)?|' +
    'klon(?:y|ów)|latar(?:ni|nie)|kawiar(?:ni|nie)|miejsc(?!\\.)|punkt(?:y|ów))(?!\\p{L})(?![ \\t]*\\d)',
  'u',
);
// Ciąg za liczbą po „Miejscowość Rynek N": data, okres, ilość albo lokal („5 maja", „12 m. 4").
// Liczba nie jest wtedy gołym numerem urzędu na rynku, a para może być osobą.
export function rynekNoNotHouse(rest: string): boolean {
  return (
    monthAhead(rest) ||
    RE_QUANTITY_AFTER.test(rest) ||
    /^[ \t]*(?:\/|[,.]?[ \t]*(?:m|lok|mieszk)\.?[ \t]*\d|lat(?!\p{L})|lata(?!\p{L})|r\.|rok)/u.test(rest)
  );
}
// Odsyłacz do pism, wydarzeń i nazw z patronem („Encyklika …", „rozdz. …", „Sala …"): taki patron
// z liczbą zostaje jawny. Inny wyraz przed nim nie rozstrzyga i para dostaje maskę osoby.
export const RE_PATRON_ROMAN_REF_BEFORE =
  /(?<!\p{L})(?:(?:encyklik|adhortacj|homili|przemówie|katechez|nauczani|pism|dzieł|pielgrzymk|pontyfikat|rozdz|tren|pieśn|wizyt|rocznic|kazani|cytat|myśl|tryptyk|kanonizacj|wypowied|biografi|poezj|życi|śmier|teologi|ciał|puchar|memoriał|medal|częś|odcin|przystan|pokoj|pokój|tekst|zebran|ranking|edycj|wybor|pamię|modlitw|książ|księg)\p{L}*|list(?:y|u|em|ów|ach)?|tom(?:u|ie|y|ów)?|sal[aieęą]?|krok(?:u|i|ów)?|t|s|str|poz|art|pkt|nr|cyt|zob|por)\.?[ \t]+$/iu;
