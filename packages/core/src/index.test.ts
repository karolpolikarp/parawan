import { expect, test } from 'vitest';
import {
  redactPII,
  hasPII,
  isValidPesel,
  isValidNip,
  isValidRegon9,
  isValidRegon14,
  isValidIban,
  isValidDowod,
  isValidCard,
  isValidKw,
} from './index';

// Buduje POPRAWNY IBAN z kodu kraju + BBAN (liczymy cyfry kontrolne mod 97),
// żeby test nie zależał od zapamiętanego wektora.
function makeIban(country: string, bban: string): string {
  const rearranged = bban + country + '00';
  let remainder = 0;
  for (const ch of rearranged.toUpperCase()) {
    const code = /[A-Z]/.test(ch) ? (ch.charCodeAt(0) - 55).toString() : ch;
    for (const c of code) remainder = (remainder * 10 + parseInt(c, 10)) % 97;
  }
  const check = (98 - remainder).toString().padStart(2, '0');
  return country + check + bban;
}

// ── Sumy kontrolne: pozytywne wektory ──
test('PESEL — poprawny wektor', () => {
  expect(isValidPesel('44051401359')).toBe(true);
});
test('PESEL — zła cyfra kontrolna odrzucona', () => {
  expect(isValidPesel('44051401358')).toBe(false);
});
test('NIP — poprawny wektor (z separatorami i bez)', () => {
  expect(isValidNip('1234563218')).toBe(true);
  expect(isValidNip('123-456-32-18')).toBe(true);
});
test('NIP — zła suma odrzucona', () => {
  expect(isValidNip('1234563210')).toBe(false);
});
test('REGON9 — poprawny wektor', () => {
  expect(isValidRegon9('123456785')).toBe(true);
});
test('REGON14 — poprawny wektor', () => {
  expect(isValidRegon14('12345678500010')).toBe(true);
});
test('IBAN — kanoniczny DE i wygenerowany PL', () => {
  expect(isValidIban('DE89370400440532013000')).toBe(true);
  const pl = makeIban('PL', '10901014000007121981287'.padEnd(24, '0').slice(0, 24));
  expect(isValidIban(pl)).toBe(true);
});
test('IBAN — zła suma odrzucona', () => {
  expect(isValidIban('DE89370400440532013001')).toBe(false);
});
test('DOWOD — poprawny wektor ABA300000', () => {
  expect(isValidDowod('ABA300000')).toBe(true);
});
test('DOWOD — zła suma odrzucona', () => {
  expect(isValidDowod('ABA300001')).toBe(false);
});
test('KARTA — poprawne numery testowe (z separatorami)', () => {
  expect(isValidCard('4111 1111 1111 1111')).toBe(true); // Visa 16
  expect(isValidCard('4111-1111-1111-1111')).toBe(true); // Visa z myślnikami
  expect(isValidCard('5555555555554444')).toBe(true); // Mastercard
  expect(isValidCard('378282246310005')).toBe(true); // American Express (15)
});
test('KARTA — zły Luhn / brak prefiksu sieci / zła długość odrzucone', () => {
  expect(isValidCard('4111111111111112')).toBe(false); // prefiks Visa, zły Luhn
  expect(isValidCard('1111222233334444')).toBe(false); // brak prefiksu znanej sieci
  expect(isValidCard('411111111111')).toBe(false); // 12 cyfr — za krótkie
  expect(isValidCard('44051401359')).toBe(false); // PESEL (11 cyfr) to nie karta
});
test('KARTA — redakcja: karta Z KONTEKSTEM maskowana', () => {
  expect(redactPII('Karta: 4111 1111 1111 1111.').redacted).toBe('Karta: [NR-KARTY].');
  expect(redactPII('Zapłata kartą 5555-5555-5555-4444 OK').redacted).toBe('Zapłata kartą [NR-KARTY] OK');
  expect(redactPII('nr karty 378282246310005 na fakturze').redacted).toBe('nr karty [NR-KARTY] na fakturze');
});
test('KARTA — BEZ kontekstu karty nie maskuje (precyzja > nadmaskowanie)', () => {
  // IMEI (15 cyfr, ma sumę Luhna, prefiks 35 = zakres JCB) BEZ kontekstu karty — zostaje
  expect(redactPII('IMEI telefonu: 353281112345672').redacted).toBe('IMEI telefonu: 353281112345672');
  // EAN-13 z prefiksem 54 (Mastercard) — kod kreskowy, nie karta
  expect(redactPII('Kod kreskowy EAN 5449000000996').redacted).toBe('Kod kreskowy EAN 5449000000996');
  // 16 cyfr bez prefiksu znanej sieci — nie karta
  expect(redactPII('Zamówienie 1111222233334444 gotowe').redacted).toBe('Zamówienie 1111222233334444 gotowe');
  // po odwołaniu prawnym, bez kontekstu karty — zostaje
  expect(redactPII('zgodnie z art. 4111 1111 1111 1111').redacted).toBe('zgodnie z art. 4111 1111 1111 1111');
});
test('KARTA — nie koliduje z PESEL/NIP/REGON/IBAN', () => {
  expect(redactPII('PESEL 44051401359').redacted).toBe('PESEL [PESEL]');
  expect(redactPII('REGON 123456785').redacted).toBe('REGON [REGON]');
  expect(redactPII('NIP 1234563218').redacted).toBe('NIP [NIP]');
});

// ── KSeF (numer faktury w Krajowym Systemie e-Faktur) ──
test('KSEF — numer z kotwicą „KSeF" maskowany W CAŁOŚCI (NIP nie wycieka osobno)', () => {
  expect(redactPII('Numer KSeF: 5265877635-20250826-0100001AF629-AF').redacted).toBe(
    'Numer KSeF: [NR-KSEF]',
  );
  // stary, 36-znakowy format z KSeF 1.0 (część techniczna rozbita na 6+6)
  expect(redactPII('Faktura o numerze KSeF 7781464139-20230721-80B510-9675F7-B5 wpłynęła.').redacted).toBe(
    'Faktura o numerze KSeF [NR-KSEF] wpłynęła.',
  );
  // pierwszy człon inny niż NIP — schemat FA(3) dopuszcza „M" + 9 cyfr
  expect(redactPII('W KSeF numer M123456789-20260213-01008C4F21B7-3D.').redacted).toBe(
    'W KSeF numer [NR-KSEF].',
  );
});
test('KSEF — złamanie wiersza PO myślniku (kolumna tabeli, zawijanie w e-mailu)', () => {
  expect(redactPII('Numer KSeF: 5265877635-20250826-\n0100001AF629-AF').redacted).toBe(
    'Numer KSeF: [NR-KSEF]',
  );
  // wcięcie kontynuacji twardymi spacjami (kopia z PDF) też jest tolerowane
  expect(redactPII('Numer KSeF: 5265877635-20250826-\n  0100001AF629-AF').redacted).toBe(
    'Numer KSeF: [NR-KSEF]',
  );
});
test('KSEF — pierwszy człon musi być poprawnym NIP-em, data prawdziwa', () => {
  // kotwica dokumentowa jest słabsza niż etykieta przy numerze, więc suma kontrolna NIP-u
  // odsiewa numery zamówień/inwentarzowe o tym samym kształcie (audyt adwersarialny, runda 2)
  expect(
    redactPII('Faktury wystawiamy przez KSeF.\nNr zamówienia 4500123456-20260115-000000012345-01.').redacted,
  ).toContain('4500123456-20260115-000000012345-01');
  expect(
    redactPII('Rozliczenie w KSeF.\nNr seryjny: ZEB1234567-20251220-000000098765-11').redacted,
  ).toContain('ZEB1234567-20251220-000000098765-11');
  // nieistniejąca data (miesiąc 13) — nie jest numerem KSeF
  expect(redactPII('Rejestr KSeF: 5265877635-20251345-0100001AF629-AF').redacted).not.toContain('[NR-KSEF]');
});
test('KSEF — kotwicą bywa sam adres portalu (link) albo skrzynka w stopce', () => {
  expect(
    redactPII(
      'Faktura wystawiona (portal https://ksef.mf.gov.pl/web/login).\nNumer dokumentu: 5265877635-20250826-0100001AF629-AF',
    ).redacted,
  ).toBe('Faktura wystawiona (portal https://ksef.mf.gov.pl/web/login).\nNumer dokumentu: [NR-KSEF]');
  // e-mail znika w FAZIE 1, więc kotwicę liczymy na ORYGINALNYM wejściu
  expect(redactPII('Kontakt: ksef@mf.gov.pl\nNumer dokumentu: 5265877635-20250826-0100001AF629-AF').redacted).toBe(
    'Kontakt: [EMAIL]\nNumer dokumentu: [NR-KSEF]',
  );
});
test('KSEF — część techniczna musi mieć hex; sama suma NIP to sito 1:11', () => {
  expect(redactPII('W KSeF numer M123456789-20260213-01008C4F21B7-3D.').redacted).toBe(
    'W KSeF numer [NR-KSEF].',
  );
  expect(redactPII('Nr KSeF: m123456789-20250826-0100001AF629-AF').redacted).toBe('Nr KSeF: [NR-KSEF]');
  // ten sam kształt bez ani jednej litery A–F: numer modelu, numer zamówienia SAP (głowa
  // z przypadkiem poprawną sumą NIP) i sklejone kolumny kwot — wszystkie zostają
  expect(
    redactPII('Faktury przez KSeF.\nNr modelu: M000000001-20240101-000000000000-00').redacted,
  ).toContain('M000000001-20240101-000000000000-00');
  expect(
    redactPII('Faktury odbieramy przez KSeF.\nZamówienie: 4500100008-20250826-000000012345-01').redacted,
  ).not.toContain('[NR-KSEF]');
  expect(
    redactPII('Uzgodnienie przed KSeF:\n5265877635-20250826-145000-118700-23').redacted,
  ).not.toContain('[NR-KSEF]');
  // zero wiodące — żaden NIP nie zaczyna się od zera, choć sumę kontrolną przechodzi
  expect(redactPII('KSeF. Rekord 0034100016-20260115-A1B2C3D4E5F6-0F').redacted).not.toContain('[NR-KSEF]');
});
test('KSEF — biegnie przed znakiem sprawy (numer nie dostaje maski [ZNAK-SPRAWY])', () => {
  expect(redactPII('Znak: 5265877635-20250826-0100001AF629-AF\nSystem KSeF.').redacted).toBe(
    'Znak: [NR-KSEF]\nSystem KSeF.',
  );
  // zwykły znak sprawy dalej trafia do swojego typu
  expect(redactPII('Znak sprawy: WOA-II.1431.55.2024\nSystem KSeF.').redacted).toBe(
    'Znak sprawy: [ZNAK-SPRAWY]\nSystem KSeF.',
  );
});
test('KSEF — kotwica jest DOKUMENTOWA: etykieta po numerze, w nagłówku kolumny, w znacznikach', () => {
  expect(redactPII('5265877635-20250826-0100001AF629-AF — to numer KSeF faktury.').redacted).toBe(
    '[NR-KSEF] — to numer KSeF faktury.',
  );
  expect(redactPII('**Nr KSeF:** 5265877635-20250826-0100001AF629-AF').redacted).toBe(
    '**Nr KSeF:** [NR-KSEF]',
  );
  // etykieta w nagłówku kolumny — wartości stoją wiersz niżej
  expect(redactPII('Nr KSeF;Kwota\n5265877635-20250826-0100001AF629-AF;1200,00').redacted).toBe(
    'Nr KSeF;Kwota\n[NR-KSEF];1200,00',
  );
  // rozwinięta nazwa systemu też jest kotwicą
  expect(
    redactPII('Fakturę w Krajowym Systemie e-Faktur: 5265877635-20250826-0100001AF629-AF').redacted,
  ).toBe('Fakturę w Krajowym Systemie e-Faktur: [NR-KSEF]');
});
test('KSEF — wyliczenie pod jedną etykietą maskowane w całości', () => {
  const r = redactPII(
    'Numery KSeF: 5265877635-20250826-0100001AF629-AF, 5265877635-20250901-0100002BC731-1D.',
  );
  expect(r.redacted).toBe('Numery KSeF: [NR-KSEF], [NR-KSEF].');
  expect(r.found).toEqual([{ type: 'KSEF', count: 2 }]);
});
test('KSEF — tag <NrKSeF> i klucz „ksefNumber" niosą kotwicę w samej nazwie', () => {
  expect(redactPII('<NrKSeF>5265877635-20250826-0100001AF629-AF</NrKSeF>').redacted).toBe(
    '<NrKSeF>[NR-KSEF]</NrKSeF>',
  );
  expect(redactPII('"ksefNumber": "5265877635-20250826-0100001AF629-AF"').redacted).toBe(
    '"ksefNumber": "[NR-KSEF]"',
  );
});
test('KSEF — BEZ kotwicy i bez kształtu numeru nie maskuje (precyzja > nadmaskowanie)', () => {
  expect(redactPII('System KSeF działa od 2026 roku.').redacted).toBe('System KSeF działa od 2026 roku.');
  expect(redactPII('KSeF 2.0 zastąpił wersję 1.0.').redacted).toBe('KSeF 2.0 zastąpił wersję 1.0.');
  // numer referencyjny sesji zaczyna się od DATY, nie od NIP-u — nie jest numerem KSeF
  expect(redactPII('Numer referencyjny sesji w KSeF: 20250626-SO-2F14610000-242991F8C9-B4').redacted).toBe(
    'Numer referencyjny sesji w KSeF: 20250626-SO-2F14610000-242991F8C9-B4',
  );
});
test('KSEF — numer doklejony myślnikiem oraz w ścieżce URL-a', () => {
  // myślnik po etykiecie i w nazwie pliku — granica dopasowania nie może się o niego opierać
  expect(redactPII('Nr KSeF-5265877635-20250826-0100001AF629-AF').redacted).toBe('Nr KSeF-[NR-KSEF]');
  expect(redactPII('Pobrano z KSeF: faktura-5265877635-20250826-0100001AF629-AF.xml').redacted).toBe(
    'Pobrano z KSeF: faktura-[NR-KSEF].xml',
  );
  // URL jest sentinelowany PRZED fazą identyfikatorów — numer zdejmujemy już w passProtectUrls
  expect(redactPII('Link: https://ksef.mf.gov.pl/faktura/5265877635-20250826-0100001AF629-AF/upo').redacted).toBe(
    'Link: https://ksef.mf.gov.pl/faktura/[NR-KSEF]/upo',
  );
});
test('KSEF — separatorem jest TYLKO myślnik (kolumny liczb i listy nie są scalane)', () => {
  // audyt adwersarialny: spacja jako separator zjadała cztery sąsiednie kolumny raportu
  expect(redactPII('KSeF 5265877635 20250826 000000012345 23').redacted).not.toContain('[NR-KSEF]');
  // lista punktowana pod nagłówkiem „KSeF" — złamanie wiersza PRZED myślnikiem nie scala członów
  expect(redactPII('Wysyłka: KSeF\n- 5265877635\n- 20250826\n- 000000012345\n- 23').redacted).not.toContain(
    '[NR-KSEF]',
  );
  // kolumny zestawienia rozdzielone „ - " — spacja wokół myślnika nie jest separatorem numeru
  expect(
    redactPII('Rejestr sprzedaży KSeF.\n5265877635 - 20250826 - 145000 - 118700 - 23').redacted,
  ).not.toContain('[NR-KSEF]');
});
test('KSEF — placeholder jest idempotentny', () => {
  const once = redactPII('Numer KSeF: 5265877635-20250826-0100001AF629-AF').redacted;
  expect(redactPII(once).redacted).toBe(once);
});

// ── Numer księgi wieczystej (K63). Numery zmyślone, z policzoną cyfrą kontrolną. ──
test('isValidKw — wagi 1,3,7 i litery od X=10, A=11 (bez Q i V)', () => {
  expect(isValidKw('KR1P/00234567/6')).toBe(true);
  expect(isValidKw('WA2M/00512345/3')).toBe(true);
  expect(isValidKw('SZ1S / 00076543 / 3')).toBe(true);
  expect(isValidKw('LU1I/00045612/8')).toBe(true);
  expect(isValidKw('KR1P/00234567/7')).toBe(false);
  expect(isValidKw('KR1P/0023456/6')).toBe(false);
  expect(isValidKw('KQ1P/00234567/6')).toBe(false);
});
test('KW — numer po kotwicy maskowany w całości, także przy złej cyfrze kontrolnej', () => {
  expect(redactPII('Dłużniczka jest właścicielką nieruchomości objętej księgą wieczystą KW nr KR1P/00234567/6.').redacted).toBe(
    'Dłużniczka jest właścicielką nieruchomości objętej księgą wieczystą KW nr [NR-KW].',
  );
  expect(redactPII('KW: GD1G/00098765/4').redacted).toBe('KW: [NR-KW]');
  expect(redactPII('Kw nr LU1I/00045612/1').redacted).toBe('Kw nr [NR-KW]');
  expect(redactPII('Sąd prowadzi księgę wieczystą WA2M/00512345/1 dla lokalu.').redacted).toBe(
    'Sąd prowadzi księgę wieczystą [NR-KW] dla lokalu.',
  );
  expect(redactPII('KSIĘGA WIECZYSTA NR KR1P/00234567/1').redacted).toBe('KSIĘGA WIECZYSTA NR [NR-KW]');
  expect(redactPII('Numer księgi wieczystej: KR1P/00234567/1').redacted).toBe('Numer księgi wieczystej: [NR-KW]');
  // spacje wokół ukośników i złamanie wiersza po ukośniku
  expect(redactPII('księga wieczysta nr WA2M / 00512345 / 3').redacted).toBe('księga wieczysta nr [NR-KW]');
  expect(redactPII('dla której prowadzona jest księga wieczysta nr WA2M/\n00512345/3').redacted).toBe(
    'dla której prowadzona jest księga wieczysta nr [NR-KW]',
  );
  // po kotwicy separatorem bywa sama spacja albo myślnik; bez kotwicy taki zapis zostaje
  expect(redactPII('numer księgi wieczystej WA2M 00512345 3').redacted).toBe('numer księgi wieczystej [NR-KW]');
  expect(redactPII('KW nr KR1P-00234567-6').redacted).toBe('KW nr [NR-KW]');
  expect(redactPII('Partia WA2M 00512345 3 w magazynie').redacted).toBe('Partia WA2M 00512345 3 w magazynie');
  // numer po „Sygn." nie dostaje maski znaku sprawy, a obok PESEL-u maska każdego typu osobno
  expect(redactPII('Sygn. KR1P/00234567/6').redacted).toBe('Sygn. [NR-KW]');
  expect(redactPII('Jan Kowalski, PESEL 44051401359, właściciel działki z KW KR1P/00234567/6.').redacted).toBe(
    '[IMIĘ I NAZWISKO], PESEL [PESEL], właściciel działki z KW [NR-KW].',
  );
});
test('KW — kotwica w kluczu XML/JSON, w nagłówku kolumny i w parametrze linku', () => {
  expect(redactPII('<NumerKW>KR1P/00234567/1</NumerKW>').redacted).toBe('<NumerKW>[NR-KW]</NumerKW>');
  expect(redactPII('"numerKsiegiWieczystej": "KR1P/00234567/1"').redacted).toBe('"numerKsiegiWieczystej": "[NR-KW]"');
  expect(redactPII('{"nr_kw": "KR1P/00234567/1"}').redacted).toBe('{"nr_kw": "[NR-KW]"}');
  expect(redactPII('Nr KW\tPowierzchnia\nKR1P/00234567/1\t120 m2').redacted).toBe('Nr KW\tPowierzchnia\n[NR-KW]\t120 m2');
  expect(redactPII('Odpis: https://przegladarka-ekw.ms.gov.pl/eukw_prz/wyszukiwanieKW?kw=KR1P/00234567/6 pobrano.').redacted).toBe(
    'Odpis: https://przegladarka-ekw.ms.gov.pl/eukw_prz/wyszukiwanieKW?kw=[NR-KW] pobrano.',
  );
  // parametr „kw" bywa słowem kluczowym wyszukiwarki: bez kształtu numeru nic nie znika
  expect(redactPII('https://example.com/?kw=buty+zimowe').redacted).toBe('https://example.com/?kw=buty+zimowe');
  expect(redactPII('https://sklep.example.com/produkt/AB1C/12345678/7').redacted).toBe('https://sklep.example.com/produkt/AB1C/12345678/7');
});
test('KW — wyliczenie po jednej kotwicy zasłania wszystkie numery', () => {
  expect(
    redactPII('Nieruchomości objęte KW nr KR1P/00234567/6, KR1P/00234567/1, WA2M/00512345/0 oraz WA2M/00512345/9.').redacted,
  ).toBe('Nieruchomości objęte KW nr [NR-KW], [NR-KW], [NR-KW] oraz [NR-KW].');
  expect(redactPII('KW nr KR1P/00234567/6,\nKR1P/00234567/1').redacted).toBe('KW nr [NR-KW],\n[NR-KW]');
});
test('KW — bez kotwicy tylko poprawna suma, wielkie litery i znany kod sądu', () => {
  expect(redactPII('nieruchomość KR1P/00234567/6 położona w Krakowie').redacted).toBe('nieruchomość [NR-KW] położona w Krakowie');
  expect(redactPII('nieruchomość KR1P/00234567/1 położona w Krakowie').redacted).toBe('nieruchomość KR1P/00234567/1 położona w Krakowie');
  // kod produktu o kształcie numeru KW z poprawną sumą, ale nieznaną parą liter
  expect(redactPII('Kod produktu AB1C/12345678/7 w magazynie').redacted).toBe('Kod produktu AB1C/12345678/7 w magazynie');
  expect(redactPII('kr1p/00234567/6 w notatce').redacted).toBe('kr1p/00234567/6 w notatce');
});
test('KW — pułapki: kwartał, wzór numeru, sygnatury, działki, lokale, umowy, kotwica z innego zdania', () => {
  const keep = [
    'kw. 2026 r. wpłynął wniosek',
    'Wpis do księgi wieczystej nastąpi po uprawomocnieniu.',
    'Zamówienie nr AB1C/12345678/0',
    'Wzór numeru księgi wieczystej: XXXX/XXXXXXXX/X',
    'działka nr 245/7, lokal 12/3, umowa 12/2026/ZP',
    'Dokonano wpisu w księdze wieczystej. Zamówienie nr AB1C/12345678/0',
    'Wniosek z kw. 2026 dotyczy ZA1C/12345678/0',
  ];
  for (const t of keep) expect(redactPII(t).redacted).toBe(t);
  expect(redactPII('Sygn. akt I C 123/24').redacted).toBe('Sygn. akt [ZNAK-SPRAWY]');
});
test('KW — regresje: „KW" jako kilowaty, komenda, towar i koniec zdania nie kotwiczą', () => {
  const keep = [
    'Zestaw KW-2, kod AB1C/12345678/0, szt. 2.',
    'Pismo przekazano do KW. Faktura FV1A 20260315 1 opłacona.',
    'Wniosek złożył KW. Pozycja ZP2A/12345678/9 w planie.',
    'KW Policji, sprawa AB2C 20261015 1.',
    'Agregat prądotwórczy 20 KW, nr fabr. PA4K 20210101 7.',
    'Moc przyłączeniowa: 40 KW. HG2X 20190315 1 to nr licznika.',
    'Pompa ciepła 12 KW, nr seryjny HP2X/20230512/1',
  ];
  for (const t of keep) expect(redactPII(t).redacted).toBe(t);
  // „KW. Nr …" to nadal etykieta tego samego numeru
  expect(redactPII('Nieruchomość ma założoną KW. Nr WA1M/00512345/1 prowadzi SR.').redacted).toBe(
    'Nieruchomość ma założoną KW. Nr [NR-KW] prowadzi SR.',
  );
  expect(redactPII('działka 12/3, KW WA1M/00512345/6.').redacted).toBe('działka 12/3, KW [NR-KW].');
});
test('KW — regresje: mieszany separator nie wciąga liczby z prozy, łącznik zostawia cały znak sprawy', () => {
  expect(redactPII('księga wieczysta LU1I/00045678 2 działki').redacted).toBe('księga wieczysta LU1I/00045678 2 działki');
  expect(redactPII('KW nr KR1P/00012345 3 lokale mieszkalne').redacted).toBe('KW nr KR1P/00012345 3 lokale mieszkalne');
  expect(redactPII('KW nr KR1P/00012345/3 oraz WA1M 00512345 1').redacted).toBe('KW nr [NR-KW] oraz [NR-KW]');
  expect(redactPII('Znak: WA1M/00512345/6-12').redacted).toBe('Znak: [ZNAK-SPRAWY]');
  expect(redactPII('Sygn. akt: WA1M/00512345/6-KW').redacted).toBe('Sygn. akt: [ZNAK-SPRAWY]');
});
test('KW — regresje: w adresie kotwiczy tylko wartość parametru numeru księgi', () => {
  const keep = [
    'Szczegóły: https://bip.gmina.pl/download?ksiega=1&plik=ZP1A-20260315-1.pdf',
    'https://sklep.example.pl/szukaj?kw=buty&id=AB1C-12345678-7',
    'https://bip.gmina.pl/a?ksiegowosc=1&dok=FN1A-20260101-3',
    'https://sklep.pl/szukaj?kw=buty&sku=ab1c-12345678-5',
  ];
  for (const t of keep) expect(redactPII(t).redacted).toBe(t);
  expect(redactPII('https://ekw.ms.gov.pl/x?nr_kw=KR1P-00234567-1&a=1').redacted).toBe(
    'https://ekw.ms.gov.pl/x?nr_kw=[NR-KW]&a=1',
  );
});
test('KW — regresje: „KW" jako pojęcie w zdaniu, wierszu wyżej albo w innej kolumnie nie kotwiczy kodu dokumentu', () => {
  const keep = [
    'Odpis KW w pliku ZP1A-20260315-1.pdf',
    'brak KW, wniosek EZD WN1A/20260315/2',
    'KW: brak; skan SC1N 20260315 1',
    'Kontrolowany przedstawił wypis KW oraz certyfikat CE1A/12345678/4',
    'dla której prowadzona jest KW, zgodnie z umową nr UM2B-12345678-0',
    'księga wieczysta – w załączeniu skan ZP1A-20260315-1',
    'Złożono odpis z księgi wieczystej.\nFaktura FV1A/20240101/1 opłacona.',
    'Odczytano odpis KW.\nNr dok. AB1C 12345678 9 złożono.',
    'KW\nFaktura FV1A/20240101/1',
    'Wpis w KW dokonano. 3) Protokół PR1A/20260101/2 z odbioru.',
    'Załączniki: 1) odpis księgi wieczystej, 2) faktura FV1A/20240101/1.',
    'Zał. 1 – odpis KW; zał. 2 – zamówienie ZP1A-20260315-1.',
    'Kancelaria: nr KW w aktach; umowa UM2B/20260101/3 z dnia 2.01.2026.',
    '1;odpis KW;\n2;faktura;FV1A/20261012/3',
    '| 1 | odpis KW |\n| 2 | ZP1A/20260315/2 |',
    'modul=KW start\nbatch PL1B/20261012/3 ok',
    'Temat: zapytanie o KW\nZamówienie ZP1A-20260315-2 wysłano.',
    '[{"typ":"KW"},{"nr":"FV2A/20261012/5"}]',
    'Nr KW\tStatus\nbrak\tWA2B 12345678 1 szt.',
    'nr kw: brak, kod przesyłki PO1A 12345678 9',
  ];
  for (const t of keep) expect(redactPII(t).redacted).toBe(t);
  expect(redactPII('Odpis KW nr WA1M/00512345/1, faktura FV1A/20240101/1.').redacted).toBe(
    'Odpis KW nr [NR-KW], faktura FV1A/20240101/1.',
  );
  expect(redactPII('KW nr WA1M/00512345/1 i zamówienie ZP1A-20260315-1.').redacted).toBe(
    'KW nr [NR-KW] i zamówienie ZP1A-20260315-1.',
  );
  // następna kolumna wiersza TSV to nie wyliczenie
  expect(redactPII('Nr KW\tStatus\nKR1P/00234567/1\tFV1A/20240101/1').redacted).toBe('Nr KW\tStatus\n[NR-KW]\tFV1A/20240101/1');
});
test('KW — regresje: etykieta przy numerze nadal kotwiczy (o numerze, nr, kolumna, kilka wierszy)', () => {
  expect(redactPII('objętej księgą wieczystą o nr KR1P/00123456/5').redacted).toBe('objętej księgą wieczystą o nr [NR-KW]');
  expect(redactPII('KW o numerach KR1P/00123456/5, GD1G/00012345/2').redacted).toBe('KW o numerach [NR-KW], [NR-KW]');
  expect(redactPII('księgi wieczystej nr KR1P/00123456/5 oraz nr GD1G/00012345/2').redacted).toBe(
    'księgi wieczystej nr [NR-KW] oraz nr [NR-KW]',
  );
  expect(redactPII('KW (nr KR1P/00123456/5)').redacted).toBe('KW (nr [NR-KW])');
  expect(redactPII('Nr KW\tPowierzchnia\nKR1P/00234567/1\t120 m2\nGD1G/00012345/2\t80 m2').redacted).toBe(
    'Nr KW\tPowierzchnia\n[NR-KW]\t120 m2\n[NR-KW]\t80 m2',
  );
  expect(redactPII('Lp\tNr KW\r\n1\tKR1P/00234567/1\r\n2\tKR1P/00234567/2\r\n').redacted).toBe('Lp\tNr KW\r\n1\t[NR-KW]\r\n2\t[NR-KW]\r\n');
  expect(redactPII('| Lp | Nr KW |\n|---|---|\n| 1 | KR1P/00234567/1 |').redacted).toBe('| Lp | Nr KW |\n|---|---|\n| 1 | [NR-KW] |');
  // pewny numer (znany sąd, poprawna suma) maskujemy także bez etykiety, jak dotąd
  expect(redactPII('Opłata OP1A/20260302/4.').redacted).toBe('Opłata [NR-KW].');
});
test('KW — regresje: numer wklejony w znak sprawy zostaje dla passZnakSprawy, liczebnik po numerze bez cyfry kontrolnej zostaje', () => {
  expect(redactPII('Znak sprawy: GN.KR1P/00123456/4').redacted).toBe('Znak sprawy: [ZNAK-SPRAWY]');
  expect(redactPII('Nasz znak: GKN-KR1P/00123456/4').redacted).toBe('Nasz znak: [ZNAK-SPRAWY]');
  expect(redactPII('Znak: KW.KR1P/00123456/4').redacted).toBe('Znak: [ZNAK-SPRAWY]');
  expect(redactPII('Znak: WA1M/00512345/6.GN').redacted).toBe('Znak: [ZNAK-SPRAWY]');
  expect(redactPII('Znak: GN.6840.WA1M/00512345/6').redacted).toBe('Znak: [ZNAK-SPRAWY]');
  // bez etykiety znaku numer KW po kotwicy dalej dostaje maskę
  expect(redactPII('KW WA1M/00512345/6.').redacted).toBe('KW [NR-KW].');
  expect(redactPII('prowadzi księgę wieczystą KR1P 00123456 2 lokale').redacted).toBe('prowadzi księgę wieczystą [NR-KW] 2 lokale');
  expect(redactPII('KW GD1G 00012345 3 działki').redacted).toBe('KW [NR-KW] 3 działki');
  expect(redactPII('KW WA1M 00512345 1').redacted).toBe('KW [NR-KW]');
});
test('KW — placeholder jest idempotentny, a typ można wyłączyć', () => {
  const once = redactPII('KW nr KR1P/00234567/6').redacted;
  expect(redactPII(once).redacted).toBe(once);
  expect(redactPII('KW nr KR1P/00234567/6', { types: ['PESEL'] }).redacted).toBe('KW nr KR1P/00234567/6');
  expect(redactPII('KW nr KR1P/00234567/6').found).toEqual([{ type: 'KW', count: 1 }]);
});

// ── Redakcja: maskuje realne PII ──
test('redactPII — PESEL maskowany', () => {
  const r = redactPII('Mój PESEL to 44051401359, proszę o pomoc');
  expect(r.redacted.includes('44051401359')).toBe(false);
  expect(r.redacted).toContain('[PESEL]');
});
test('redactPII — NIP z separatorami maskowany', () => {
  const r = redactPII('Firma NIP 123-456-32-18 zalega');
  expect(r.redacted).toContain('[NIP]');
  expect(/123-456-32-18/.test(r.redacted)).toBe(false);
});
test('redactPII — NIP ze SPACJAMI maskowany (526 27 35 917)', () => {
  const r = redactPII('NIP: 526 27 35 917');
  expect(r.redacted).toContain('[NIP]');
  expect(r.redacted.includes('526 27 35 917')).toBe(false);
  // ten sam numer w grupowaniu 3-3-2-2 spacjami
  expect(redactPII('NIP 526 273 59 17').redacted).toContain('[NIP]');
});
test('redactPII — e-mail i telefon maskowane', () => {
  const r = redactPII('Pisz na jan.kowalski@example.com lub dzwoń +48 600 700 800');
  expect(r.redacted).toContain('[EMAIL]');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('600 700 800')).toBe(false);
});
test('redactPII — IBAN maskowany', () => {
  const iban = makeIban('PL', '109010140000071219812870'.slice(0, 24));
  const r = redactPII(`Przelej na konto ${iban}`);
  expect(r.redacted).toContain('[NR-KONTA]');
});
test('redactPII — adres maskowany', () => {
  const r = redactPII('Mieszkam przy ul. Marszałkowska 10/5 w Warszawie');
  expect(r.redacted).toContain('[ADRES]');
  expect(/Marszałkowska 10/.test(r.redacted)).toBe(false);
});
test('redactPII — imię i nazwisko (słownikowe) maskowane', () => {
  const r = redactPII('Sprawę prowadzi Jan Kowalski od marca');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('redactPII — imię+nazwisko po wyrazie z wielkiej litery (Pracownik Tomasz Lewandowski)', () => {
  // Regresja: detektor par zżerał „Pracownik Tomasz" i gubił „Tomasz Lewandowski".
  const r = redactPII('Pracownik Tomasz Lewandowski, PESEL 90010112349');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Tomasz Lewandowski')).toBe(false);
  expect(r.redacted).toContain('Pracownik');
  expect(r.redacted).toContain('[PESEL]');
});
test('redactPII — nazwisko po wyzwalaczu kontekstu maskowane', () => {
  const r = redactPII('Nazywam się Brzęczyszczykiewicz Grzegorz');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('redactPII — wyzwalacz NIE pożera kolejnego małego słowa (zachowuje sens zdania)', () => {
  // Regresja: pod flagą /i klasa [PL_UP] łapała małe litery, więc „Pan Wiśniewski nie" maskowało
  // też „nie" → „zapłacił" zamiast „nie zapłacił". „nie" MUSI zostać.
  const r = redactPII('Pan Wiśniewski nie zapłacił czynszu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Wiśniewski')).toBe(false);
  expect(r.redacted).toContain('nie zapłacił');
});

// ── Wielkość liter w imionach/nazwiskach (v0.29.6): łapiemy nietypowy zapis w KONTEKŚCIE ──
test('casing — self-ID łapie imię/nazwisko niezależnie od wielkości liter', () => {
  for (const s of [
    'nazywam się pAMELA nOWAK',   // mieszana
    'Nazywam się PAMELA NOWAK',   // WERSALIKI
    'nazywam się pamela nowak',   // małe litery
    'mam na imię PAMELA',         // pojedyncze imię WERSALIKAMI
    'mam na imię pAMELA',         // pojedyncze imię mieszaną
  ]) {
    expect(redactPII(s).redacted, s).toContain('[IMIĘ I NAZWISKO]');
  }
});
test('casing — pole formularza / klucz JSON łapie wartość małą literą', () => {
  expect(redactPII('Imię: pamela').redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(redactPII('Nazwisko: nowak').redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(redactPII('{"firstName":"pamela","lastName":"nowak"}').redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('casing — para imię+nazwisko WERSALIKAMI i małymi literami maskowana', () => {
  expect(redactPII('PAMELA NOWAK złożyła wniosek').redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(redactPII('pisała do nas pamela nowak w tej sprawie').redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('casing — precyzja: „Pan/Pani" + czasownik NIE jest maskowane', () => {
  for (const s of ['Pan był wczoraj w urzędzie', 'Pani ma rację', 'Pana prawa są chronione']) {
    expect(redactPII(s).redacted, s).toBe(s);
  }
});
test('casing — precyzja: „nazywam się" bez nazwy własnej ani słownika zostaje', () => {
  const s = 'nazywam się tak, jak trzeba';
  expect(redactPII(s).redacted).toBe(s);
});
test('casing — precyzja: nagłówki WERSALIKAMI i homonimy małą literą zostają', () => {
  expect(redactPII('USTAWA O OCHRONIE DANYCH').redacted).toBe('USTAWA O OCHRONIE DANYCH');
  expect(redactPII('SĄD OKRĘGOWY W WARSZAWIE').redacted).toBe('SĄD OKRĘGOWY W WARSZAWIE');
  expect(redactPII('to jest jagoda i kalina').redacted).toBe('to jest jagoda i kalina');
});

// ── Tytuł/rola + imię/nazwisko WERSALIKAMI (v0.29.7): „SSO JAN KOWALSKI", „PANEM …", „PAN KOWALSKI" ──
test('all-caps: tytuł/rola WERSALIKAMI + nazwisko maskowane (tytuł zostaje)', () => {
  for (const s of [
    'SSO JAN KOWALSKI',
    'z PANEM MARKIEM WIŚNIEWSKIM',
    'PAN KOWALSKI',
    'POZWANY JAN KOWALSKI',
    'ŚWIADEK ANNA NOWAK',
    'SĘDZIA TRZEBIATOWSKI',
  ]) {
    expect(redactPII(s).redacted, s).toContain('[IMIĘ I NAZWISKO]');
  }
  // tytuł/rola nie znika (sens wiersza zachowany)
  expect(redactPII('SSO JAN KOWALSKI').redacted).toContain('SSO');
  expect(redactPII('PAN KOWALSKI').redacted).toContain('PAN');
});
test('all-caps: precyzja — nagłówki instytucji WERSALIKAMI NIE są maskowane', () => {
  for (const s of [
    'SĄD OKRĘGOWY W WARSZAWIE',
    'NACZELNY SĄD ADMINISTRACYJNY',
    'MINISTERSTWO SPRAWIEDLIWOŚCI',
    'UNIWERSYTET WARSZAWSKI',
    'WOJEWODA MAZOWIECKI',
    'SĘDZIA SĄDU REJONOWEGO',
    'PREZES ZARZĄDU SPÓŁKI',
    'NARODOWY BANK POLSKI',
  ]) {
    expect(redactPII(s).redacted, s).toBe(s);
  }
});
test('redactPII — kod pocztowy i dowód maskowane', () => {
  const r = redactPII('Adres 00-950, dowód ABA300000');
  expect(r.redacted).toContain('[KOD-POCZTOWY]');
  expect(r.redacted).toContain('[NR-DOWODU]');
});

// ── Brak fałszywych trafień na treści prawnej/urzędowej ──
test('redactPII — numer artykułu NIE jest telefonem', () => {
  const r = redactPII('Zgodnie z art. 123 456 789 kodeksu — to numer przepisu');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
});
test('redactPII — encja prawna NIE jest nazwiskiem', () => {
  const r = redactPII('Sąd Najwyższy oraz Kodeks Cywilny i Prawo Pracy');
  expect(r.redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
});
test('redactPII — losowe 10 cyfr bez poprawnej sumy NIP zostaje', () => {
  // 1234567890 ma sumę kontrolną NIP == 10 (nieważny) → NIE maskujemy.
  const r = redactPII('Sygnatura 1234567890 w aktach');
  expect(r.redacted.includes('[NIP]')).toBe(false);
});
test('redactPII — zwykłe pytanie bez PII nietknięte', () => {
  const q = 'Czy pracodawca może odmówić urlopu na żądanie zgodnie z art. 167 KP?';
  const r = redactPII(q);
  expect(r.redacted).toBe(q);
  expect(r.found.length).toBe(0);
});

// ── Idempotencja ──
test('redactPII — idempotentny (drugi przebieg nic nie zmienia)', () => {
  const once = redactPII('PESEL 44051401359, mail x@y.pl, Jan Kowalski').redacted;
  const twice = redactPII(once).redacted;
  expect(twice).toBe(once);
});

test('hasPII — wykrywa i nie myli się na czystym tekście', () => {
  expect(hasPII('mój nip 1234563218')).toBe(true);
  expect(hasPII('jakie są zasady rozwodu?')).toBe(false);
});

// ── Telefon: numery stacjonarne z prefiksem +48 (bug z pism urzędowych) ──
test('telefon stacjonarny +48 22 245 59 22 (podział 2-3-2-2) maskowany', () => {
  const r = redactPII('telefon: +48 22 245 59 22');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('245 59 22')).toBe(false);
});
test('telefon stacjonarny +48 bez dwukropka maskowany', () => {
  const r = redactPII('telefon +48 22 245 59 22 w godzinach pracy');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('22 245 59 22')).toBe(false);
});
test('telefon ze słowem kontekstowym bez +48 (tel. 22 245 59 22)', () => {
  const r = redactPII('tel. 22 245 59 22');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted).toContain('tel.');
  expect(r.redacted.includes('245 59 22')).toBe(false);
});
test('telefon komórkowy +48 600 700 800 nadal maskowany (regresja)', () => {
  const r = redactPII('dzwoń +48 600 700 800');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('600 700 800')).toBe(false);
});
test('numer artykułu z +48 w pobliżu NIE psuje strażnika przepisów', () => {
  const r = redactPII('zgodnie z art. 123 456 789 kodeksu');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
});

// ── Nr dowodu osobistego: wykrywanie kontekstowe ──
test('dowód osobisty z kontekstem maskowany nawet bez sumy kontrolnej', () => {
  const r = redactPII('Dowód osobisty ABC 123456 wydany w 2020');
  expect(r.redacted).toContain('[NR-DOWODU]');
  expect(r.redacted.includes('ABC 123456')).toBe(false);
  expect(r.redacted).toContain('Dowód osobisty');
});
test('seria i numer dowodu maskowane', () => {
  const r = redactPII('seria i numer: AGH987654');
  expect(r.redacted).toContain('[NR-DOWODU]');
});
test('dowód zakupu (nie ID) NIE jest maskowany jako dowód osobisty', () => {
  const r = redactPII('dowód zakupu nr 445566 w załączniku');
  expect(r.redacted.includes('[NR-DOWODU]')).toBe(false);
});
test('numer dowodu STANDALONE z POPRAWNĄ sumą maskowany bez kontekstu', () => {
  expect(redactPII('ABA300000').redacted).toBe('[NR-DOWODU]');
  expect(redactPII('ABA 300000').redacted).toBe('[NR-DOWODU]');
});
test('dowód-format bez kontekstu ze ZŁĄ sumą NIE jest maskowany (sygnatury/kody urzędowe)', () => {
  // „ABC 123456" ma złą sumę kontrolną → jak sygnatura/kod zostaje (precyzja)
  expect(redactPII('ABC 123456').redacted.includes('[NR-DOWODU]')).toBe(false);
  expect(redactPII('Sygn. RPO 401234 w aktach').redacted.includes('[NR-DOWODU]')).toBe(false);
});
test('dowód osobisty z wtrąconym „nr" maskowany', () => {
  const r = redactPII('dowód osobisty nr ABC123456');
  expect(r.redacted).toContain('[NR-DOWODU]');
  expect(r.redacted.includes('ABC123456')).toBe(false);
});
test('numer paszportu z kontekstem maskowany (2 litery + 7 cyfr)', () => {
  const r = redactPII('Paszport nr ZS 1234567 wydano w 2020 r.');
  expect(r.redacted).toContain('[NR-PASZPORTU]');
  expect(r.redacted.includes('ZS 1234567')).toBe(false);
});
test('2 litery + 7 cyfr BEZ kontekstu paszportu NIE są maskowane', () => {
  expect(redactPII('Kod AB1234567 systemu').redacted.includes('[NR-PASZPORTU]')).toBe(false);
});
test('numer KRS maskowany (kontekst „KRS" + 10 cyfr, zera wiodące)', () => {
  const r = redactPII('Spółka wpisana pod nr KRS 0000173413 w rejestrze.');
  expect(r.redacted).toContain('[KRS]');
  expect(r.redacted.includes('0000173413')).toBe(false);
  expect(redactPII('KRS: 0000173413').redacted).toContain('[KRS]');
});
test('znak sprawy/pisma (JRWA) maskowany strukturalnie — różne warianty symbolu', () => {
  for (const znak of ['DPR-II.054.3.2026', 'DNW-1.054.1.2024', 'ZP.271.12.2026', 'DC.WAC.5555.30.2026', 'ABC-def.123.77.2016']) {
    const r = redactPII(`Znak pisma: ${znak}`);
    expect(r.redacted).toContain('[ZNAK-SPRAWY]');
    expect(r.redacted.includes(znak)).toBe(false);
  }
  // w środku zdania, bez etykiety
  expect(redactPII('W nawiązaniu do DPR-II.054.3.2026 informujemy...').redacted).toContain('[ZNAK-SPRAWY]');
});
test('sygnatura akt sądowych maskowana z kontekstem', () => {
  const r = redactPII('Sygn. akt II CSK 234/19 w sprawie...');
  expect(r.redacted).toContain('[ZNAK-SPRAWY]');
  expect(r.redacted.includes('234/19')).toBe(false);
});
test('znak sprawy NIE nadmaskowuje dat, odwołań prawnych ani prozy', () => {
  expect(redactPII('Spotkanie odbyło się 12.05.2024 o poranku.').redacted).toBe('Spotkanie odbyło się 12.05.2024 o poranku.');
  expect(redactPII('Zgodnie z art. 5 ust. 1 pkt 3 ustawy.').redacted).toBe('Zgodnie z art. 5 ust. 1 pkt 3 ustawy.');
  expect(redactPII('Rozdział 5.2 opisuje procedurę.').redacted).toBe('Rozdział 5.2 opisuje procedurę.');
  expect(redactPII('Zamieszczono znak drogowy B-2 przy wjeździe.').redacted).toBe('Zamieszczono znak drogowy B-2 przy wjeździe.');
});
test('data urodzenia słowna („ur. 5 maja 1985") maskowana; bez kontekstu nie', () => {
  expect(redactPII('ur. 5 maja 1985 r.').redacted).toContain('[DATA-URODZENIA]');
  expect(redactPII('urodzony 12 grudnia 1970').redacted).toContain('[DATA-URODZENIA]');
  expect(redactPII('W maju 1985 odbyło się spotkanie.').redacted).toBe('W maju 1985 odbyło się spotkanie.');
});

test('pola formularza (etykieta → wartość w następnej linii, WERSALIKI) są maskowane', () => {
  const form =
    '11. Nazwisko\nWILCZYŃSKI\n12. Pierwsze imię\nKAROL\n' +
    '13. Data urodzenia (dzień – miesiąc – rok)\n1994-07-08\n' +
    '18. Ulica\nBŁĘKITNA\n19. Nr domu\n53.0\n21. Miejscowość\nWARSZAWA';
  const out = redactPII(form).redacted;
  expect(out.includes('WILCZYŃSKI')).toBe(false);
  expect(out.includes('KAROL')).toBe(false);
  expect(out.includes('1994-07-08')).toBe(false);
  expect(out.includes('BŁĘKITNA')).toBe(false);
  expect(out.includes('53.0')).toBe(false);
  expect(out).toContain('[IMIĘ I NAZWISKO]');
  expect(out).toContain('[DATA-URODZENIA]');
  expect(out).toContain('[ADRES]');
});

test('pola formularza: administracyjne (kraj/województwo/powiat/gmina) NIE są maskowane', () => {
  const out = redactPII('14. Kraj\nPOLSKA\n15. Województwo\nMAZOWIECKIE\n16. Powiat\nWARSZAWA').redacted;
  expect(out).toContain('POLSKA');
  expect(out).toContain('MAZOWIECKIE');
});

test('pola formularza: same-line z dwukropkiem i puste pole', () => {
  expect(redactPII('Nazwisko: Kowalski').redacted).toContain('[IMIĘ I NAZWISKO]');
  // pole puste („Nr lokalu") — następna linia to kolejna etykieta, nie maskujemy jej
  const out = redactPII('20. Nr lokalu\n21. Miejscowość\nWARSZAWA').redacted;
  expect(out).toContain('21. Miejscowość');
  expect(out.includes('WARSZAWA')).toBe(false);
});

test('precyzja pól formularza: proza z „Ulica"/„Nazwisko" NIE jest nadmaskowana', () => {
  expect(redactPII('Ulica była zamknięta z powodu remontu.').redacted).toBe(
    'Ulica była zamknięta z powodu remontu.',
  );
  // adnotacja przy dacie zachowana
  expect(redactPII('Data urodzenia: 1990-01-01 (wg aktu).').redacted).toBe(
    'Data urodzenia: [DATA-URODZENIA] (wg aktu).',
  );
});

// ── Precyzja po audycie wieloagentowym (nadmaskowanie prozy/układu) ──
test('nagłówek pola nad prozą NIE zjada zdania', () => {
  expect(redactPII('Ulica\nDroga publiczna wraz z chodnikami.').redacted).toBe(
    'Ulica\nDroga publiczna wraz z chodnikami.',
  );
  expect(redactPII('Imię i nazwisko wnioskodawcy wpisujemy w polu 1.\nDane niżej.').redacted).toBe(
    'Imię i nazwisko wnioskodawcy wpisujemy w polu 1.\nDane niżej.',
  );
});

test('puste pole formularza NIE przejmuje następnej etykiety/nagłówka', () => {
  expect(redactPII('Nazwisko:\nRozpoznanie\nastma').redacted).toBe('Nazwisko:\nRozpoznanie\nastma');
  expect(redactPII('Miejsce urodzenia:\nOddział Kardiologiczny').redacted).toBe(
    'Miejsce urodzenia:\nOddział Kardiologiczny',
  );
});

test('nazwisko na końcu wiersza NIE skleja się z następną linią', () => {
  expect(redactPII('dr Anna Nowak\nOddział: kardiologia').redacted).toBe(
    'dr [IMIĘ I NAZWISKO]\nOddział: kardiologia',
  );
});

test('para „rzeczownik/rola + nazwisko" zostawia rzeczownik, maskuje nazwisko', () => {
  expect(redactPII('Pracownik Kowalski otrzymał premię.').redacted).toBe(
    'Pracownik [IMIĘ I NAZWISKO] otrzymał premię.',
  );
  expect(redactPII('Zakład Usługowy Kowalski').redacted).toBe('Zakład Usługowy [IMIĘ I NAZWISKO]');
  // rzadkie imię + nazwisko nadal maskowane w całości (recall zachowany)
  expect(redactPII('Świętomira Gzowska').redacted).toBe('[IMIĘ I NAZWISKO]');
});

test('eponimy medyczne i nazwy ulic (sufiks -ski) NIE są maskowane jako osoby', () => {
  expect(redactPII('Zdiagnozowano chorobę Leśniowskiego-Crohna.').redacted).toBe(
    'Zdiagnozowano chorobę Leśniowskiego-Crohna.',
  );
  expect(redactPII('Dodatni objaw Babińskiego.').redacted).toBe('Dodatni objaw Babińskiego.');
  expect(redactPII('Mieszka przy ulica Puławska.').redacted).toBe('Mieszka przy ulica Puławska.');
  // kontrola: prawdziwe nazwisko w odmianie nadal łapane
  expect(redactPII('sprawę Gzowskiego przekazano').redacted).toContain('[IMIĘ I NAZWISKO]');
});

test('instytucjonalne przymiotniki (-ski) NIE są maskowane', () => {
  expect(redactPII('Zleceniodawca: Ogólnopolski Związek Pracodawców').redacted).toContain(
    'Ogólnopolski Związek',
  );
  expect(redactPII('ukończył Uniwersytet Jagielloński').redacted).toBe('ukończył Uniwersytet Jagielloński');
});
test('kod waluty + kwota NIE jest mylony z dowodem', () => {
  expect(redactPII('PLN 123456').redacted.includes('[NR-DOWODU]')).toBe(false);
  expect(redactPII('EUR 250000').redacted.includes('[NR-DOWODU]')).toBe(false);
});
test('małe litery + 6 cyfr bez sumy kontrolnej NIE są maskowane', () => {
  // „abc123456" (małe) bez poprawnej sumy → zostaje (mniej fałszywych trafień).
  expect(redactPII('kod abc123456 systemu').redacted.includes('[NR-DOWODU]')).toBe(false);
});

// ── Imiona w ODMIANIE (nie tylko mianownik) ──
test('imię w narzędniku + nazwisko (Anną Kowalską) maskowane w całości', () => {
  const r = redactPII('Anną Kowalską, zwaną dalej');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Anną')).toBe(false);
});
test('imię męskie w narzędniku (Janem Kowalskim) maskowane', () => {
  expect(redactPII('podpisano z Janem Nowakiem').redacted.includes('Janem')).toBe(false);
});
test('imię w bierniku (Annę Wiśniewską) maskowane', () => {
  const r = redactPII('reprezentowaną przez Annę Wiśniewską');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Annę')).toBe(false);
});
test('encje prawne z dwóch słów NIE są maskowane jako imię w odmianie', () => {
  for (const t of ['Sąd Najwyższy', 'Kodeks Cywilny', 'Ministerstwo Cyfryzacji', 'Nowy Rok']) {
    expect(redactPII(t).redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
  }
});
test('miasto po przyimku NIE jest maskowane (zamieszkała w Warszawie)', () => {
  expect(redactPII('zamieszkałą w Warszawie przy ulicy').redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
});

// ── Adres bez prefiksu „ul.", rozpoznany po sąsiedztwie kodu pocztowego ──
test('ulica bez „ul." przed kodem pocztowym maskowana (Królewska 27)', () => {
  const r = redactPII('Królewska 27, 00-060 Warszawa');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted).toContain('[KOD-POCZTOWY]');
  expect(r.redacted.includes('Królewska 27')).toBe(false);
});
test('wielowyrazowa ulica bez prefiksu (Aleje Jerozolimskie 100)', () => {
  const r = redactPII('Aleje Jerozolimskie 100, 00-807 Warszawa');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Jerozolimskie')).toBe(false);
});
test('„Rozdział 5"/„Załącznik 2" NIE są adresem (brak kodu pocztowego obok)', () => {
  expect(redactPII('Rozdział 5, zgodnie z ustawą').redacted.includes('[ADRES]')).toBe(false);
  expect(redactPII('Załącznik 2 do pisma').redacted.includes('[ADRES]')).toBe(false);
});

// ── Ulica zaczynająca się od liczby lub skrótu rangi/tytułu ──
test('ulica z liczbą w nazwie („ul. 3 Maja 1")', () => {
  const r = redactPII('mieszka przy ul. 3 Maja 1');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('3 Maja')).toBe(false);
});
test('ulica z liczbą dwucyfrową („ul. 11 Listopada 5/3")', () => {
  const r = redactPII('ul. 11 Listopada 5/3');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Listopada')).toBe(false);
});
test('aleja z liczbą („al. 3 Maja 12")', () => {
  const r = redactPII('al. 3 Maja 12');
  expect(r.redacted).toContain('[ADRES]');
});
test('ulica ze skrótem rangi („ul. gen. Andersa 5")', () => {
  const r = redactPII('ul. gen. Andersa 5');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Andersa')).toBe(false);
});
test('ulica ze skrótem „ks." („ul. ks. Popiełuszki 3")', () => {
  const r = redactPII('ul. ks. Popiełuszki 3');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Popiełuszki')).toBe(false);
});
test('zwykła ulica nadal działa (regresja)', () => {
  const r = redactPII('ul. Marszałkowska 10/5');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('Marszałkowska')).toBe(false);
});

// ── MIEJSCOWOŚĆ — miasto po kodzie pocztowym (kotwica = kod), nie w tekście ──
test('miasto po kodzie pocztowym maskowane (Warszawa)', () => {
  const r = redactPII('Królewska 27, 00-060 Warszawa');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Warszawa')).toBe(false);
  // pełny adres schodzi do trzech kotwic, nic nie wycieka
  expect(r.redacted).toBe('[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]');
});
test('miasto po kodzie z prefiksem „ul." (Kraków)', () => {
  const r = redactPII('ul. Floriańska 3, 31-000 Kraków');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Kraków')).toBe(false);
});
test('miasto WIELOWYRAZOWE po kodzie (Nowy Sącz) — oba człony', () => {
  const r = redactPII('Zamieszkały: 33-300 Nowy Sącz, ul. Długa 5');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Nowy')).toBe(false);
  expect(r.redacted.includes('Sącz')).toBe(false);
});
test('miasto z myślnikiem po kodzie (Bielsko-Biała) — jeden token', () => {
  const r = redactPII('adres: 43-300 Bielsko-Biała');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Bielsko')).toBe(false);
});
test('zdanie po miejscowości NIE jest pożerane (kropka granicą)', () => {
  const r = redactPII('Nadano w 00-950 Warszawa. Sprawę rozpatrzył sąd.');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted).toContain('Sprawę rozpatrzył sąd');
});
test('drugi wyraz spoza słownika NIE jest doklejany (Warszawa Zarząd)', () => {
  const r = redactPII('00-950 Warszawa Zarząd Dróg Miejskich');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted).toContain('Zarząd Dróg Miejskich');
});
test('miasto: marker zamieszkania maskuje, zwykły czasownik/proza nie', () => {
  // „mieszka w" to marker zamieszkania → miasto maskowane; „pracuje w" to nie marker → zostaje
  expect(redactPII('Powód mieszka w Warszawie i pracuje w Krakowie').redacted).toBe(
    'Powód mieszka w [MIEJSCOWOŚĆ] i pracuje w Krakowie',
  );
  // czysta proza / instytucja → NIE maskujemy (precyzja)
  expect(redactPII('Spotkanie odbędzie się w Łodzi.').redacted).toBe('Spotkanie odbędzie się w Łodzi.');
  expect(redactPII('Sąd Okręgowy w Katowicach').redacted).toBe('Sąd Okręgowy w Katowicach');
});
test('miasto w kontekście adresu/zamieszkania jest maskowane', () => {
  // po zamaskowanym adresie bez kodu: „[ADRES], Warszawa"
  expect(redactPII('ul. Kwiatowa 5, Warszawa').redacted).toBe('[ADRES], [MIEJSCOWOŚĆ]');
  // markery zamieszkania
  expect(redactPII('zamieszkały w Krakowie przy ul. Długiej').redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(redactPII('mieszka w Sopocie od 2010 roku').redacted).toBe('mieszka w [MIEJSCOWOŚĆ] od 2010 roku');
  expect(redactPII('zam. w Rzeszowie').redacted).toBe('zam. w [MIEJSCOWOŚĆ]');
  expect(redactPII('miejsce zamieszkania: Białystok').redacted).toBe('miejsce zamieszkania: [MIEJSCOWOŚĆ]');
  // kraj/region i lokal NIE są miastem po markerze
  expect(redactPII('zamieszkały w Polsce').redacted).toBe('zamieszkały w Polsce');
});
test('marker zamieszkania NIE maskuje instytucji ani ulicy (bramka słownikowa)', () => {
  // słowo po markerze, które NIE jest znanym miastem → zostaje (instytucja/placówka/ulica)
  expect(redactPII('Interesant mieszka w Sądzie Rejonowym').redacted).toBe('Interesant mieszka w Sądzie Rejonowym');
  expect(redactPII('zamieszkały w Areszcie Śledczym').redacted).toBe('zamieszkały w Areszcie Śledczym');
  expect(redactPII('zamieszkały w Zakładzie Karnym').redacted).toBe('zamieszkały w Zakładzie Karnym');
  // ulica po markerze — nie miasto; adres zdejmie krok ADRES, tu bez korupcji „[MIEJSCOWOŚĆ]c"
  expect(redactPII('Zameldowany: Plac Wolności 2').redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  // miasto wielowyrazowe po markerze
  expect(redactPII('zamieszkały w Zielonej Górze').redacted).toContain('[MIEJSCOWOŚĆ]');
});
test('nazwa sądu z miastem NIE jest ruszana (Warszawy-Śródmieścia)', () => {
  const t = 'Sąd Rejonowy dla Warszawy-Śródmieścia rozpatrzył sprawę';
  expect(redactPII(t).redacted).toBe(t);
});
test('MIEJSCOWOŚĆ ma osobny przełącznik (wyłączona ⇒ miasto zostaje)', () => {
  const r = redactPII('00-060 Warszawa', { types: ['KOD-POCZTOWY'] });
  expect(r.redacted).toContain('[KOD-POCZTOWY]');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toContain('Warszawa');
});
test('miejscowość — idempotencja (drugi przebieg nic nie psuje)', () => {
  const once = redactPII('Królewska 27, 00-060 Warszawa').redacted;
  expect(redactPII(once).redacted).toBe(once);
});

// ── MIEJSCOWOŚĆ przed adresem BEZ kodu (słownik miast, tylko w pozycji „…, ul.") ──
test('miasto przed adresem bez kodu (Warszawa, ul. …)', () => {
  const r = redactPII('Warszawa, ul. Królewska 27');
  expect(r.redacted).toBe('[MIEJSCOWOŚĆ], [ADRES]');
});
test('miasto WIELOWYRAZOWE przed adresem bez kodu (Zielona Góra, ul. …)', () => {
  const r = redactPII('Zielona Góra, ul. Długa 5');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Zielona')).toBe(false);
  expect(r.redacted.includes('Góra')).toBe(false);
});
test('forma zależna miasta przed adresem (w Poznaniu, ul. …)', () => {
  const r = redactPII('Sąd Okręgowy w Poznaniu, ul. Hejmowskiego 2');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Poznaniu')).toBe(false);
  // nazwa sądu (przed „w") zostaje nietknięta
  expect(r.redacted).toContain('Sąd Okręgowy w');
});
test('miasto z myślnikiem przed adresem (Kędzierzyn-Koźle, ul. …)', () => {
  const r = redactPII('Kędzierzyn-Koźle, ul. Rynek 2');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Kędzierzyn')).toBe(false);
});
test('ogon nazwy instytucji przed adresem NIE jest miastem (Zarząd Dróg Miejskich, ul. …)', () => {
  const r = redactPII('Zarząd Dróg Miejskich, ul. Chmielna 5');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toContain('Zarząd Dróg Miejskich');
});
test('słownik miast NIE działa w wolnym tekście (bez „, ul./[ADRES]")', () => {
  const r = redactPII('Sprawa dotyczy Warszawy oraz Krakowa i Poznania');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
});
test('miasto przed adresem — idempotencja', () => {
  const once = redactPII('Warszawa, ul. Królewska 27').redacted;
  expect(redactPII(once).redacted).toBe(once);
});
test('miasto przed adresem respektuje przełącznik MIEJSCOWOŚĆ', () => {
  const r = redactPII('Warszawa, ul. Długa 5', { types: ['ADRES'] });
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('[MIEJSCOWOŚĆ]')).toBe(false);
  expect(r.redacted).toContain('Warszawa');
});

// ── Odwrócona kolejność „Nazwisko Imię" (nagłówki e-maili Outlook) ──
test('„Nazwisko Imię" (Kowalska Ewa) maskowane w całości', () => {
  const r = redactPII('Kowalska Ewa');
  expect(r.redacted).toBe('[IMIĘ I NAZWISKO]');
});
test('nieznane nazwisko + znane imię (Ejkszto Anna) maskowane', () => {
  const r = redactPII('From: Ejkszto Anna');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Ejkszto')).toBe(false);
  expect(r.redacted.includes('Anna')).toBe(false);
});
test('encje prawne w kolejności odwróconej NIE są maskowane', () => {
  for (const t of ['Sąd Najwyższy', 'Kodeks Cywilny', 'Ministerstwo Cyfryzacji', 'Umowa najmu']) {
    expect(redactPII(t).redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
  }
});
test('„Pani Anna" zachowuje tytuł, maskuje imię', () => {
  const r = redactPII('Pani Anna');
  expect(r.redacted).toContain('Pani');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});

// ── DWA imiona + nazwisko (nazwisko nie może zostać jawne) ──
test('dwa imiona w odmianie + nazwisko (Moniką Ewą Nojszewską) — jedna maska', () => {
  const r = redactPII('Moniką Ewą Nojszewską, zwaną dalej');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Nojszewską')).toBe(false);
  expect(r.redacted.includes('Ewą')).toBe(false);
  expect((r.redacted.match(/\[IMIĘ I NAZWISKO\]/g) ?? []).length).toBe(1);
});
test('dwa imiona (mianownik) + nazwisko — nazwisko zamaskowane', () => {
  expect(redactPII('Jan Maria Rokita').redacted.includes('Rokita')).toBe(false);
  expect(redactPII('Monika Ewa Nojszewska').redacted.includes('Nojszewska')).toBe(false);
});
test('wyraz przed imieniem zostaje, para imię+nazwisko maskowana', () => {
  expect(redactPII('Wczoraj Jan Kowalski przyszedł').redacted).toBe('Wczoraj [IMIĘ I NAZWISKO] przyszedł');
});

// ── Anty-nadmaskowanie: realny tekst urzędowy/nazwy własne NIE mogą być ruszane ──
// (blokada regresji dla agresywnych reguł imion/dowodów — nadmaskowanie niszczy sens pisma)
test('instytucje, programy i nazwy własne pozostają nietknięte', () => {
  const clean = [
    'Zgodnie z art. 123 ust. 2 ustawy o finansach publicznych.',
    'Ministerstwo Cyfryzacji oraz Biuro Budżetowo-Finansowe.',
    'Program Operacyjny Polska Cyfrowa',
    'Prezydent Rzeczypospolitej Polskiej',
    'Bank Gospodarstwa Krajowego',
    'Główny Urząd Statystyczny',
    'Krajowy Plan Odbudowy',
    'Sąd Rejonowy dla Warszawy-Śródmieścia',
    'Narodowy Bank Polski',
    'Nowy Rok obchodzony jest pierwszego stycznia.',
    'Faktura VAT numer 445566 z tytułu usług.',
    'Kwota 250000 PLN zostanie przekazana.',
    'Polski Ład',
    'Adam poszedł do sklepu',
  ];
  for (const t of clean) expect(redactPII(t).redacted).toBe(t);
});

// ── Samodzielne nazwiska ze słownika (krok 13c) ──
test('nazwisko solo w odmianie — dopełniacz maskowany', () => {
  const r = redactPII('Sprawę Kowalskiego przekazano do sądu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Kowalskiego')).toBe(false);
});
test('nazwisko solo — forma żeńska -ska maskowana', () => {
  const r = redactPII('Zeznanie złożyła Wiśniewska w czwartek');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('nazwisko solo — celownik rzeczownikowy (Nowakowi)', () => {
  const r = redactPII('Nowakowi doręczono wezwanie');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Nowakowi')).toBe(false);
});
test('nazwisko solo — liczba mnoga (Kowalscy)', () => {
  const r = redactPII('Kowalscy odwołali się od decyzji');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
});
test('homonim solo NIE jest maskowany (Wilk, Mazurek)', () => {
  const r = redactPII('Wilk biegał po lesie, a Mazurek wielkanocny był pyszny');
  expect(r.redacted.includes('[IMIĘ I NAZWISKO]')).toBe(false);
});
test('homonim Z imieniem nadal maskowany (Jan Wilk)', () => {
  const r = redactPII('Jan Wilk mieszka w Poznaniu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Wilk')).toBe(false);
});
test('małe litery NIE są nazwiskiem (kowalski jako przymiotnik)', () => {
  const q = 'zawód kowalski wymaga siły';
  expect(redactPII(q).redacted).toBe(q);
});
// ── IMIĘ + NAZWISKO małymi literami (krok 13a4) — imię ze słownika + nazwisko morfologiczne ──
test('para małymi literami: imię ze słownika + nazwisko (jan kowalski)', () => {
  const r = redactPII('jan kowalski');
  expect(r.redacted).toBe('[IMIĘ I NAZWISKO]');
});
test('para małymi literami: nazwisko dwuczłonowe (anna kowalska-nowak)', () => {
  const r = redactPII('anna kowalska-nowak');
  expect(r.redacted).toBe('[IMIĘ I NAZWISKO]');
});
test('para małymi literami po przyimku (od jan kowalski dostałem list)', () => {
  const r = redactPII('od jan kowalski dostałem list');
  expect(r.redacted).toBe('od [IMIĘ I NAZWISKO] dostałem list');
});
test('dwie osoby małymi literami w jednym ciągu', () => {
  const r = redactPII('do anna nowak i piotr wiśniewski');
  expect(r.redacted).toBe('do [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO]');
});
test('proza małymi literami NIE jest nadmaskowana', () => {
  for (const p of [
    'mam ochotę na kawę ale ala woli herbatę',
    'polski rynek pracy zmienia się szybko',
    'to był ciężki tydzień pełen spotkań',
    'zielona góra świeci jasno nad miastem',
    'jan polski dokument leżał na biurku',
  ]) {
    expect(redactPII(p).redacted).toBe(p);
  }
});
// ── E-mail z polską diakrytyką w części lokalnej — maskuj W CAŁOŚCI (bez wycieku fragmentu) ──
test('e-mail z „ś" w części lokalnej maskowany w całości', () => {
  const r = redactPII('e-mail: piotr.wiśniewski-nowak@poczta.pl');
  expect(r.redacted).toBe('e-mail: [EMAIL]');
});
// ── Kod pocztowy BEZ myślnika przy kotwicy adresowej (krok 10b) ──
test('kod pocztowy bez myślnika po adresie (65048 Zielona Góra)', () => {
  const r = redactPII('ul. Krótka 5, 65048 Zielona Góra');
  expect(r.redacted).toBe('[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]');
});
test('kod pocztowy bez myślnika w nowej linii adresu', () => {
  const r = redactPII('ul. Krótka 5\n65048 Zielona Góra');
  expect(r.redacted).toBe('[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]');
});
test('5 cyfr BEZ kotwicy adresowej NIE są kodem pocztowym', () => {
  for (const q of ['Kwota 50000 Euro do zapłaty', 'Faktura 12345 Netto']) {
    expect(redactPII(q).redacted).toBe(q);
  }
});
test('krok 13c nie psuje idempotencji', () => {
  const once = redactPII('Sprawę Kowalskiego i Wiśniewskiej umorzono').redacted;
  expect(redactPII(once).redacted).toBe(once);
});

// ── Nazwiska rozpoznane MORFOLOGICZNIE (spoza słownika: -ski/-cki/-icz/-czyk) ──
test('rzadkie nazwisko solo w mianowniku (Fiołkowska)', () => {
  const r = redactPII('Fiołkowska wygrała przetarg na dostawę mebli.');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Fiołkowska')).toBe(false);
});
test('rzadkie nazwisko solo w dopełniaczu (Gzowskiego)', () => {
  const r = redactPII('list od Gzowskiego leżał na biurku tydzień');
  expect(r.redacted.includes('Gzowskiego')).toBe(false);
});
test('rzadkie nazwisko -icz w odmianie (Bąkiewiczowi)', () => {
  const r = redactPII('Bąkiewiczowi zależało na szybkiej wypłacie.');
  expect(r.redacted.includes('Bąkiewiczowi')).toBe(false);
});
test('rzadkie nazwisko -czyk w odmianie (Zdrojewczyka)', () => {
  const r = redactPII('sprawę Zdrojewczyka przekazano do prokuratury');
  expect(r.redacted.includes('Zdrojewczyka')).toBe(false);
});
test('para rzadkie imię + rzadkie nazwisko (Świętomira Gzowska) — oba maskowane', () => {
  const r = redactPII('Świętomira Gzowska przyszła na przesłuchanie.');
  expect(r.redacted.includes('Świętomira')).toBe(false);
  expect(r.redacted.includes('Gzowska')).toBe(false);
});
test('nazwisko dwuczłonowe morfologiczne (Rzepeckiej-Gil)', () => {
  const r = redactPII('opinia Rzepeckiej-Gil była druzgocąca');
  expect(r.redacted.includes('Rzepeckiej')).toBe(false);
});
test('małżonkowie o wspólnym nazwisku (Anna i Jan Kowalscy) — nic nie wycieka', () => {
  const r = redactPII('Anna i Jan Kowalscy kupili mieszkanie na osiedlu.');
  expect(r.redacted.includes('Anna')).toBe(false);
  expect(r.redacted.includes('Jan')).toBe(false);
  expect(r.redacted.includes('Kowalscy')).toBe(false);
});

// ── ANTY-NADMASKOWANIE morfologiczne: przymiotnik w nazwie instytucji/geo NIE jest nazwiskiem ──
test('nazwy instytucji z przymiotnikiem -ski/-cki pozostają nietknięte', () => {
  const clean = [
    'Uniwersytet Warszawski ogłosił konkurs.',
    'Izba Lekarska wydała opinię.',
    'Bank Śląski przygotował ofertę.',
    'Sąd Okręgowy w Krakowie wydał wyrok.',
    'Narodowy Bank Polski obniżył stopy.',
    'Politechnika Śląska otworzyła nabór.',
  ];
  for (const t of clean) expect(redactPII(t).redacted).toBe(t);
});
test('rzeczownik przed nazwiskiem w dopełniaczu ZOSTAJE (Zaległości Trzebiatowskiego)', () => {
  const r = redactPII('Zaległości Trzebiatowskiego rosły z miesiąca na miesiąc.');
  expect(r.redacted).toContain('Zaległości'); // rzeczownik pospolity — nie nazwisko
  expect(r.redacted.includes('Trzebiatowskiego')).toBe(false); // nazwisko zamaskowane
});

// ── Poprawki precyzji z audytu optymalizacyjnego (v0.30) ──
test('(a3) zwykły wyraz + imię NIE jest maskowany (Wczoraj Anna, Umowa Marii)', () => {
  expect(redactPII('Wczoraj Anna wróciła z urlopu.').redacted).toBe('Wczoraj Anna wróciła z urlopu.');
  expect(redactPII('Umowa Marii została podpisana.').redacted).toBe('Umowa Marii została podpisana.');
});
test('(a3) „Nazwisko Imię" w nagłówku e-maila nadal maskowane (From: Ejkszto Anna)', () => {
  const r = redactPII('From: Ejkszto Anna');
  expect(r.redacted.includes('Ejkszto')).toBe(false);
});
test('„Komitet Obywatelski" / „Hufiec Harcerski" NIE są osobą', () => {
  expect(redactPII('Komitet Obywatelski poparł uchwałę.').redacted).toBe('Komitet Obywatelski poparł uchwałę.');
});
test('regionalne i pospolite przymiotniki -ski/-cki nietknięte', () => {
  expect(redactPII('Bieszczadzki Park Narodowy wprowadził zakaz.').redacted).toContain('Bieszczadzki Park Narodowy');
  expect(redactPII('Niski poziom wody w rzece.').redacted).toBe('Niski poziom wody w rzece.');
});
test('miesiąc „Maja" nie jest imieniem (Pierwszego Maja)', () => {
  expect(redactPII('Zebranie odbyło się Pierwszego Maja.').redacted).toBe('Zebranie odbyło się Pierwszego Maja.');
});
test('„Pani Minister"/„Pan Wojewoda Mazowiecki" — sama rola/tytuł zostaje', () => {
  expect(redactPII('Pani Minister podpisała rozporządzenie.').redacted).toBe('Pani Minister podpisała rozporządzenie.');
  expect(redactPII('Pan Wojewoda Mazowiecki wydał decyzję.').redacted).toBe('Pan Wojewoda Mazowiecki wydał decyzję.');
});
test('„Pan Dyrektor Kowalski" — rola zostaje, nazwisko maskowane', () => {
  const r = redactPII('Pan Dyrektor Kowalski podpisał pismo.');
  expect(r.redacted).toContain('Pan Dyrektor');
  expect(r.redacted.includes('Kowalski')).toBe(false);
});
test('nazwisko słownikowe z myślnikiem (Nowak-Schmidt) maskowane', () => {
  const r = redactPII('Pozew wniosła Nowak-Schmidt.');
  expect(r.redacted.includes('Nowak-Schmidt')).toBe(false);
});

// ── Regresje z benchmarku (docs/BENCHMARK.md, 2026-07-04) ──
test('REGON ze złą sumą przy etykiecie „REGON" → [REGON] mimo złej sumy (nie telefon)', () => {
  // v0.44: silna etykieta „REGON" maskuje mimo złej sumy kontrolnej (i nie ląduje w telefonie).
  const r = redactPII('Firma o REGON 123456784 w rejestrze');
  expect(r.redacted.includes('[TELEFON]')).toBe(false);
  expect(r.redacted).toContain('[REGON]');
  expect(r.redacted).not.toContain('123456784');
});

// ── v0.44: telefon w nawiasach + maskowanie ID przy silnej etykiecie mimo złej sumy ──
test('telefon w nawiasach z prefiksem +48 maskowany', () => {
  expect(redactPII('tel. +48 (501) 234-567').redacted).toBe('tel. [TELEFON]');
});
test('telefon w nawiasach z kontekstem (bez +48)', () => {
  const r = redactPII('tel. (22) 621-02-03 zadzwoń');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted).not.toContain('621');
});
test('PESEL/NIP/konto ze złą sumą przy silnej etykiecie (też z kwalifikatorem) maskowane', () => {
  expect(redactPII('PESEL 90010112344').redacted).toBe('PESEL [PESEL]');
  expect(redactPII('PESEL wnioskodawcy: 90010112344').redacted).toContain('[PESEL]');
  expect(redactPII('NIP 9452176998').redacted).toBe('NIP [NIP]');
  expect(redactPII('NIP działalności:\n9452176998').redacted).not.toContain('9452176998');
  const konto = redactPII('Konto:\nPL12 1020 5558 1111 2222 3333 4444');
  expect(konto.redacted).toContain('[NR-KONTA]');
  expect(konto.redacted).not.toContain('PL12');
});
test('PESEL bez etykiety i ze złą sumą NIE jest maskowany (precyzja)', () => {
  expect(redactPII('Wartość 90010112344 w logu importu').redacted).toContain('90010112344');
});

// ── v0.44: nowe typy PII ──
test('TOKEN (JWT) maskowany', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc-DEF_123';
  const r = redactPII('Authorization: ' + jwt);
  expect(r.redacted).toContain('[TOKEN]');
  expect(r.redacted).not.toContain('eyJ');
});
test('MAC maskowany (nie mylony z IPv6)', () => {
  expect(redactPII('MAC: 00:1A:2B:3C:4D:5E').redacted).toBe('MAC: [MAC]');
});
test('IPv4 maskowany, ale numer wersji NIE (precyzja)', () => {
  expect(redactPII('IP: 192.168.1.20').redacted).toBe('IP: [IP]');
  expect(redactPII('wersja 1.2.3.4 aplikacji').redacted).toContain('1.2.3.4');
});
test('IPv6 maskowany', () => {
  const r = redactPII('IPv6: 2001:db8::8a2e:370:7334');
  expect(r.redacted).toContain('[IP]');
  expect(r.redacted).not.toContain('8a2e');
});
test('VIN maskowany (kontekst i strukturalnie)', () => {
  expect(redactPII('VIN: WAUZZZ8V4JA123456').redacted).toContain('[VIN]');
  expect(redactPII('Nadwozie WAUZZZ8V4JA123456 sprawne').redacted).toContain('[VIN]');
});
test('prawo jazdy maskowane z kontekstem; „kategorii B" bez cyfry NIE', () => {
  expect(redactPII('Prawo jazdy:\nKR1234567').redacted).toContain('[PRAWO-JAZDY]');
  expect(redactPII('Prawo jazdy kategorii B').redacted).toContain('kategorii');
});
test('prawo jazdy ze slashami maskowane W CAŁOŚCI (bez wycieku fragmentu)', () => {
  const r = redactPII('Prawo jazdy: 12345/67/8901');
  expect(r.redacted).toContain('[PRAWO-JAZDY]');
  expect(r.redacted).not.toMatch(/\d/); // żaden fragment numeru nie zostaje
  // wartość po numerze nie jest pożerana
  const r2 = redactPII('Prawo jazdy nr KR1234567 wydane w 2020 roku.');
  expect(r2.redacted).toContain('[PRAWO-JAZDY]');
  expect(r2.redacted).toContain('wydane');
});
test('nr rejestracyjny maskowany z kontekstem', () => {
  const r = redactPII('Nr rejestracyjny:\nWI1234K');
  expect(r.redacted).toContain('[NR-REJESTRACYJNY]');
  expect(r.redacted).not.toContain('WI1234K');
});
test('nowe typy respektują options.types (wyłączanie)', () => {
  expect(redactPII('IP: 192.168.1.20', { types: [] }).redacted).toBe('IP: 192.168.1.20');
  expect(redactPII('VIN: WAUZZZ8V4JA123456', { types: ['MAC'] }).redacted).toContain('WAUZZZ8V4JA123456');
});
test('„ur. DD.MM.RRRR" maskowane (trailing \\b po kropce nie działał)', () => {
  const r = redactPII('Powód, ur. 12.05.1985, wnosi o zapłatę');
  expect(r.redacted).toContain('[DATA-URODZENIA]');
  expect(r.redacted.includes('12.05.1985')).toBe(false);
});
test('adres w formie zależnej „na ulicy …" maskowany', () => {
  const r = redactPII('Mieszka na ulicy Krakowskie Przedmieście 26/28');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted.includes('26/28')).toBe(false);
});
test('nazwisko dwuczłonowe po wyzwalaczu maskowane W CAŁOŚCI', () => {
  const r = redactPII('Pan Habdank-Wojewódzki nie odebrał pisma');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('Wojewódzki')).toBe(false);
  expect(r.redacted).toContain('nie odebrał');
});

// ── Pseudonimizacja: spójne etykiety [OSOBA-X] ──
test('pseudonimy — ta sama osoba w odmianie dostaje tę samą etykietę', () => {
  const r = redactPII('Kowalski złożył pozew, a sąd wezwał Kowalskiego ponownie', {
    pseudonyms: true,
  });
  expect(r.redacted.match(/\[OSOBA-A\]/g)?.length).toBe(2);
  expect(r.redacted.includes('[OSOBA-B]')).toBe(false);
});
test('pseudonimy — różne osoby dostają różne etykiety', () => {
  const r = redactPII('Nowak pozwał Wiśniewskiego o zapłatę', { pseudonyms: true });
  expect(r.redacted).toContain('[OSOBA-A]');
  expect(r.redacted).toContain('[OSOBA-B]');
});
test('pseudonimy — para „Imię Nazwisko” i solo-odmiana spójne', () => {
  const r = redactPII('Jan Kowalski wynajął lokal. Kowalskiemu doręczono wypowiedzenie.', {
    pseudonyms: true,
  });
  expect(r.redacted.match(/\[OSOBA-A\]/g)?.length).toBe(2);
  expect(r.redacted.includes('OSOBA-B')).toBe(false);
});
test('pseudonimy — wyzwalacz „Pan” zachowuje sens zdania', () => {
  const r = redactPII('Pan Wiśniewski nie zapłacił czynszu', { pseudonyms: true });
  expect(r.redacted).toContain('[OSOBA-A]');
  expect(r.redacted).toContain('nie zapłacił');
});
test('pseudonimy — wyłączone domyślnie (stara maska)', () => {
  const r = redactPII('Jan Kowalski mieszka tu');
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted.includes('OSOBA')).toBe(false);
});
test('pseudonimy — idempotencja (drugi przebieg nic nie zmienia)', () => {
  const once = redactPII('Nowak i Wiśniewski oraz PESEL 44051401359', { pseudonyms: true }).redacted;
  expect(redactPII(once, { pseudonyms: true }).redacted).toBe(once);
});

// ── Opcje: wybór typów i własne placeholdery ──
test('options.types — maskuje TYLKO wskazane typy', () => {
  const r = redactPII('PESEL 44051401359, mail x@y.pl, Jan Kowalski', { types: ['PESEL'] });
  expect(r.redacted).toContain('[PESEL]');
  expect(r.redacted).toContain('x@y.pl');
  expect(r.redacted).toContain('Jan Kowalski');
  expect(r.found.map((f) => f.type)).toEqual(['PESEL']);
});

test('options.types — pusta lista nic nie maskuje', () => {
  const input = 'PESEL 44051401359, mail x@y.pl';
  const r = redactPII(input, { types: [] });
  expect(r.redacted).toBe(input);
  expect(r.found.length).toBe(0);
});

test('options.masks — własny placeholder, reszta domyślna', () => {
  const r = redactPII('PESEL 44051401359, mail x@y.pl', { masks: { PESEL: '[UKRYTO]' } });
  expect(r.redacted).toContain('[UKRYTO]');
  expect(r.redacted).toContain('[EMAIL]');
});

test('options — brak opcji identyczny z domyślnym wywołaniem', () => {
  const input = 'PESEL 44051401359, NIP 123-456-32-18, Jan Kowalski, ul. Polna 12/3, x@y.pl';
  expect(redactPII(input, {}).redacted).toBe(redactPII(input).redacted);
});

// ============================================================================
// Poprawki po raporcie testów partii 1–3 (v0.44.2)
// ============================================================================

test('sygnatura sądowa z dwuczłonowym wydziałem („II SA/Wa 1234/23") maskowana przy kotwicy', () => {
  const r = redactPII('Sygn. akt: II SA/Wa 1234/23 w toku postępowania.');
  expect(r.redacted).toContain('[ZNAK-SPRAWY]');
  expect(r.redacted.includes('1234/23')).toBe(false);
});
test('sygnatura sądowa BEZ kotwicy (cytowane orzecznictwo) NIE jest maskowana', () => {
  const t = 'Orzeczenie w sprawie III CZP 45/22 oraz wyrok I OSK 1122/21.';
  expect(redactPII(t).redacted).toBe(t);
});

test('KRS z wypełniaczem „pod numerem" maskowany', () => {
  const r = redactPII('spółkę wpisaną do KRS pod numerem 0000123456.');
  expect(r.redacted).toContain('[KRS]');
  expect(r.redacted.includes('0000123456')).toBe(false);
});

test('prawo jazdy w odmianie („prawem jazdy nr") maskowane w całości', () => {
  const r = redactPII('posługujący się prawem jazdy nr 05678/13/1234.');
  expect(r.redacted).toContain('[PRAWO-JAZDY]');
  expect(r.redacted.includes('05678')).toBe(false);
  expect(r.redacted.includes('1234')).toBe(false);
});

test('sekrety prefiksowe (sk_live_/sk_test_/ghp_/github_pat_) maskowane jako TOKEN', () => {
  const r = redactPII('Klucz sk_live_a1b2c3d4e5f6g7h8i9j0 oraz ghp_AbCdEfGh1234567890IjKlMnOpQrStUv.');
  expect(r.redacted.match(/\[TOKEN\]/g)?.length).toBe(2);
  expect(r.redacted.includes('sk_live')).toBe(false);
  expect(r.redacted.includes('ghp_')).toBe(false);
});

test('telefon: wtrącenie po słowie kontekstowym i kierunkowy w nawiasie', () => {
  const r = redactPII('telefon kontaktowy (22) 501-23-45 czynny w godzinach pracy.');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted.includes('501-23-45')).toBe(false);
});
test('telefon: format z kropkami wymaga kotwicy; kierunkowy w nawiasie działa bez niej', () => {
  expect(redactPII('Telefon 512.345.678 w aktach.').redacted).toContain('[TELEFON]');
  expect(redactPII('Numery: 512.345.678 w aktach.').redacted.includes('[TELEFON]')).toBe(false);
  expect(redactPII('Dzwonić: (22) 501-23-45 rano.').redacted).toContain('[TELEFON]');
});
test('telefon: goły prefiks „48" maskowany razem z numerem', () => {
  const r = redactPII('kom. 48 512 345 678 dostępny wieczorem.');
  expect(r.redacted).toContain('[TELEFON]');
  expect(/48\s*\[TELEFON\]/.test(r.redacted)).toBe(false);
});
test('telefon: 9 cyfr od zera i numer porządkowy w rejestrze NIE są telefonem', () => {
  const t = 'Numer porządkowy pozycji w rejestrze 000012345 nie jest telefonem. Lp. 123456789.';
  expect(redactPII(t).redacted).toBe(t);
});
test('telefon: kropkowy 3-3-3 nie zjada członów numeru wersji', () => {
  const t = 'Oprogramowanie w wersji 10.0.19045.3803 oraz build 1.234.567.890 działa.';
  expect(redactPII(t).redacted).toBe(t);
});

test('MAC w notacji Cisco (aabb.ccdd.eeff) maskowany; wersja czysto cyfrowa nie', () => {
  const r = redactPII('Interfejs aabb.ccdd.eeff w notacji Cisco.');
  expect(r.redacted).toContain('[MAC]');
  expect(redactPII('Pozycja 1234.5678.9012 w tabeli.').redacted.includes('[MAC]')).toBe(false);
});

test('skompresowany IPv6 przed kropką końca zdania maskowany', () => {
  const r = redactPII('host IPv6 fe80::1ff:fe23:4567:890a. Dalej tekst.');
  expect(r.redacted).toContain('[IP]');
  expect(r.redacted.includes('fe80')).toBe(false);
});

test('data urodzenia z „dnia" i miesiącem rzymskim („ur. dnia 31 XII 2010")', () => {
  const r = redactPII('Zgłaszający, ur. dnia 31 XII 2010, stawił się.');
  expect(r.redacted).toContain('[DATA-URODZENIA]');
  expect(r.redacted.includes('31 XII 2010')).toBe(false);
});

test('NIP z prefiksem kraju „PL" maskowany w całości', () => {
  const r = redactPII('Firma o numerze NIP PL5262735917 wystawiła fakturę.');
  expect(r.redacted).toContain('[NIP]');
  expect(/PL\s*\[NIP\]/.test(r.redacted)).toBe(false);
});

test('miejscowość po markerze urodzenia z datą pomiędzy („ur. … w Krakowie")', () => {
  const r = redactPII('Pani Anna, ur. 08.05.1992 w Krakowie, stawiła się osobiście.');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]');
  expect(r.redacted.includes('Krakowie')).toBe(false);
  // goła proza bez markera zostaje
  expect(redactPII('Spotkanie odbyło się w Krakowie.').redacted).toBe('Spotkanie odbyło się w Krakowie.');
});

test('adres z numerem lokalu po „lok."/„m." maskowany w całości', () => {
  const r1 = redactPII('zamieszkały przy ul. Polnej 12 lok. 5 od lat.');
  expect(r1.redacted).toContain('[ADRES]');
  expect(r1.redacted.includes('lok. 5')).toBe(false);
  const r2 = redactPII('adres: ul. Długa 3 m. 7 w centrum.');
  expect(r2.redacted).toContain('[ADRES]');
  expect(r2.redacted.includes('m. 7')).toBe(false);
});

test('inicjał imienia przed zamaskowaną osobą wciągany do maski', () => {
  const r = redactPII('Pełnomocnikiem był mec. J. Kowalski z kancelarii.');
  expect(/\bJ\.\s/.test(r.redacted)).toBe(false);
  // punkt wyliczenia na początku linii zostaje
  const r2 = redactPII('A. Jan Kowalski zeznał, że...');
  expect(r2.redacted.startsWith('A.')).toBe(true);
});

// Poprawki po audycie adwersarialnym v0.44.2
test('kwoty z separatorem tysięcy (kropki/spacje) NIE są telefonem', () => {
  for (const t of [
    'Wartość zamówienia: 123.456.789 zł brutto.',
    'Kwota 512.345.678,00 zł na rachunku.',
    'Kapitał 123 456 789 zł wniesiono.',
  ]) {
    expect(redactPII(t).redacted.includes('[TELEFON]')).toBe(false);
  }
});
test('kropkowy telefon TYLKO z kotwicą; numer seryjny/wersja bez maskowania', () => {
  expect(redactPII('tel. 512.345.678 czynny.').redacted).toContain('[TELEFON]');
  expect(redactPII('Telefony: 512.345.678 w aktach.').redacted).toContain('[TELEFON]');
  const t = 'Numer seryjny urządzenia: 745.812.903. Wersja oprogramowania 512.345.678 wydana.';
  expect(redactPII(t).redacted).toBe(t);
});
test('MAC Cisco czysto cyfrowy maskowany przy etykiecie „MAC", bez etykiety nie', () => {
  expect(redactPII('Adres MAC: 0011.2233.4455 urządzenia.').redacted).toContain('[MAC]');
  expect(redactPII('Pozycja 0011.2233.4455 w tabeli.').redacted.includes('[MAC]')).toBe(false);
});
test('znak sprawy z inicjałami referenta maskowany w całości', () => {
  const r = redactPII('znak sprawy: WKU.5589.12.2026.AB w aktach.');
  expect(r.redacted).toContain('[ZNAK-SPRAWY]');
  expect(r.redacted.includes('.AB')).toBe(false);
});
test('prawo jazdy z wtrąceniem kategorii („kat. B o numerze") maskowane', () => {
  for (const t of [
    'okazał prawo jazdy kat. B o numerze 12345/67/8901',
    'informacje o prawie jazdy kategorii B nr 12345/67/8901',
  ]) {
    const r = redactPII(t);
    expect(r.redacted).toContain('[PRAWO-JAZDY]');
    expect(r.redacted.includes('12345')).toBe(false);
  }
});
test('miasto z myślnikiem i mianownik po „zam." maskowane', () => {
  expect(redactPII('Oskarżony ur. 1.01.1970 w Bielsku-Białej.').redacted).toContain('[MIEJSCOWOŚĆ]');
  const r = redactPII('ur. 3 maja 1980 r. w Poznaniu, zam. Kraków');
  expect(r.redacted.includes('Poznaniu')).toBe(false);
  expect(r.redacted.includes('Kraków')).toBe(false);
});

// ============================================================================
// Tura 2 — raport finalny (N1/N2/N3/B3/B9/B10 + kolejność etykiet)
// ============================================================================

test('tablice rejestracyjne w wyliczeniu z kotwicą pojazdową (N1)', () => {
  const r = redactPII('Pojazd o nr rejestracyjnym WA 12345, drugi pojazd WW 1234A, motocykl ZS 4567, trzeci pojazd WE 123AB.');
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(4);
  const neg = 'Pojazd MERCEDES i auto BMW 320D czekały.';
  expect(redactPII(neg).redacted).toBe(neg);
});

test('NRB bez prefiksu PL z poprawną sumą maskowany; ze złą nie (N3)', () => {
  expect(redactPII('Przelew na 66 1097 1200 0012 3456 7890 1234 wykonano.').redacted).toContain('[NR-KONTA]');
  const bad = 'Ciąg 10 2010 9712 0000 1234 5678 9013 ma złą sumę.';
  expect(redactPII(bad).redacted).toBe(bad);
});

test('wyliczenie telefonów po jednej kotwicy — wszystkie człony maskowane (B3)', () => {
  const r = redactPII('Telefony: 512.345.678, 601 234 567 czynne.');
  expect(r.redacted.match(/\[TELEFON\]/g)?.length).toBe(2);
  expect(r.redacted.includes('512')).toBe(false);
});

test('inicjał + nazwisko, w tym homonim („A. Baran"); patron i wyliczenia zostają (N2)', () => {
  const r = redactPII('Zeznania złożył A. Baran oraz J. Kowalski.', { pseudonyms: true });
  expect(r.redacted.includes('Baran')).toBe(false);
  expect(r.redacted.includes('Kowalski')).toBe(false);
  const neg = 'Szkoła im. A. Mickiewicza. A. Wnioski stron. B. Uzasadnienie.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
});

test('rzeczowniki pospolite lm. na -ski nie są nazwiskami', () => {
  const t = 'Wnioski dowodowe oddalono. Zapiski z narady. Maski ochronne wydano.';
  expect(redactPII(t).redacted).toBe(t);
});

test('obce nazwiska wieloczłonowe: Jean-Pierre Dubois i Nguyen Van Anh (B9/B10)', () => {
  const r = redactPII('Stawił się Jean-Pierre Dubois oraz Nguyen Van Anh.', { pseudonyms: true });
  expect(r.redacted.includes('Dubois')).toBe(false);
  expect(r.redacted.includes('Jean-Pierre')).toBe(false);
  expect(r.redacted.includes('Van Anh')).toBe(false);
  const neg = 'Dojazd do Bielsko-Biała Centrum oraz stacji Kędzierzyn-Koźle Zachód.';
  expect(redactPII(neg).redacted).toBe(neg);
});

test('etykiety osób idą w kolejności wystąpienia w tekście', () => {
  const r = redactPII('Świadkiem była pani Zaremba. Sprawę Kowalskiego umorzono. Znów Zaremba.', { pseudonyms: true });
  const order = [...r.redacted.matchAll(/\[OSOBA-([A-Z]+)\]/g)].map((m) => m[1]);
  expect(order[0]).toBe('A');
  expect([...new Set(order)]).toEqual([...new Set(order)].sort());
});

// Poprawki po audycie adwersarialnym tury 2 (v0.44.4)
test('kotwica pojazdowa: wtrącenia (siodłowy, o nr), a modele aut zostają', () => {
  const r = redactPII('ciągnik siodłowy GD 890KL oraz pojazd o nr GD 891KL.');
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(2);
  const neg = 'pojazd marki KIA CEED2 oraz auto VW GOLF5.';
  expect(redactPII(neg).redacted).toBe(neg);
});
test('patron ulicy nie jest osobą; „Al." z inicjałem wchodzi w ADRES', () => {
  expect(redactPII('Mieszka przy ul. Rakowieckiej.', { pseudonyms: true }).redacted).toBe('Mieszka przy ul. Rakowieckiej.');
  expect(redactPII('Biuro przy Al. W. Andersa 15 czynne.').redacted).toContain('[ADRES]');
});
test('inicjał + nazwisko po dwukropku (rozdzielnik) maskowane', () => {
  const r = redactPII('Do wiadomości: K. Baran.', { pseudonyms: true });
  expect(r.redacted.includes('Baran')).toBe(false);
});
test('miasta z myślnikiem spoza słownika i firmy nie są obcymi imionami', () => {
  for (const t of [
    'Golub-Dobrzyń Zaprasza turystów. Trasa Golub-Dobrzyń Toruń.',
    'Ruciane-Nida Zaprasza latem.',
    'Napój Coca-Cola Company oraz Rolls-Royce Motor Cars.',
  ]) {
    expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
  }
});
test('cząstka nazwiska w regule imion z myślnikiem („Jean-Claude Van Damme") w całości', () => {
  const r = redactPII('Wystąpił Jean-Claude Van Damme na gali.', { pseudonyms: true });
  expect(r.redacted.includes('Damme')).toBe(false);
  expect(r.redacted.includes('Van')).toBe(false);
});
test('rozszerzona stoplista -ski/-cki (przyciski, klocki, kluski…)', () => {
  const t = 'Przyciski zamontowano. Klocki hamulcowe. Kluski śląskie. Odpryski lakieru. Uzyski energii.';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
});

// ============================================================================
// v0.45.0 — XML/JSON, URL, LOGIN, OCR, telefon z kropkami, tablice w wyliczeniu
// ============================================================================

// ── Struktura XML ──
test('XML: tagi Name/Surname/Street/City to kotwice strukturalne; tagi zostają', () => {
  const t = '<Customer>\n<Name>Jan</Name>\n<Surname>Kowalski</Surname>\n<Phone>+48 501 234 567</Phone>\n<Email>jan@example.com</Email>\n<Street>Leśna 15</Street>\n<City>Warszawa</City>\n</Customer>';
  const r = redactPII(t, { pseudonyms: true });
  expect(r.redacted).toContain('<Name>[IMIĘ I NAZWISKO]</Name>');
  expect(r.redacted).toContain('<Surname>[OSOBA-A]</Surname>');
  expect(r.redacted).toContain('<Phone>[TELEFON]</Phone>');
  expect(r.redacted).toContain('<Email>[EMAIL]</Email>');
  expect(r.redacted).toContain('<Street>[ADRES]</Street>');
  expect(r.redacted).toContain('<City>[MIEJSCOWOŚĆ]</City>');
  // idempotencja: drugi przebieg niczego nie psuje
  expect(redactPII(r.redacted, { pseudonyms: true }).redacted).toBe(r.redacted);
});
test('XML: generyczny <Name> z nazwą produktu/firmy NIE jest osobą', () => {
  const t = '<Name>Produkt X200</Name> oraz <Name>Acme</Name> w katalogu.';
  expect(redactPII(t).redacted).toBe(t);
});

// ── Struktura JSON ──
test('JSON: klucze firstName/lastName/city/street maskują wartość; wynik dalej się parsuje', () => {
  const t = '{\n  "customer": {\n    "firstName": "Jan",\n    "lastName": "Kowalski",\n    "email": "jan@example.com",\n    "phone": "+48 501 234 567",\n    "city": "Warszawa",\n    "street": "Lipowa 12"\n  }\n}';
  const r = redactPII(t, { pseudonyms: true });
  const parsed = JSON.parse(r.redacted); // cudzysłowy i przecinki nietknięte
  expect(parsed.customer.firstName).toBe('[IMIĘ I NAZWISKO]');
  expect(parsed.customer.lastName).toBe('[OSOBA-A]');
  expect(parsed.customer.city).toBe('[MIEJSCOWOŚĆ]');
  expect(parsed.customer.street).toBe('[ADRES]');
  expect(r.redacted.includes('Lipowa')).toBe(false);
  expect(redactPII(r.redacted, { pseudonyms: true }).redacted).toBe(r.redacted);
});
test('JSON: klucze nieosobowe i wartości nie-PII zostają', () => {
  const t = '{ "status": "Aktywny", "name": "Acme Corp", "city": "b/d" }';
  expect(redactPII(t).redacted).toBe(t);
});

// ── URL: ochrona + maskowanie wewnątrz ──
test('URL: parametry osobowe maskowane wewnątrz, struktura adresu zostaje', () => {
  const t = 'Zgłoszenie: https://portal.example.com/ticket?id=123456789&user=tomasz.kaminski&email=jan%40example.com dostępne.';
  const r = redactPII(t);
  expect(r.redacted).toContain('https://portal.example.com/ticket?id=123456789');
  expect(r.redacted).toContain('user=[LOGIN]');
  expect(r.redacted).toContain('email=[EMAIL]');
  expect(r.redacted.includes('tomasz.kaminski')).toBe(false);
  expect(r.redacted.includes('jan%40example.com')).toBe(false);
  expect(redactPII(r.redacted).redacted).toBe(r.redacted);
});
test('URL bez danych osobowych zostaje nietknięty (też z kapitalizowaną ścieżką)', () => {
  const t = 'Repozytorium https://github.com/apache/kafka oraz cennik www.example.com/Cennik-Uslugi.';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
});
test('URL: detektory nazwisk/telefonów nie rozbijają adresu (ochrona sentinelami)', () => {
  const t = 'Profil https://intranet.firma.pl/osoby/Jan-Kowalski?tab=dane w systemie.';
  const r = redactPII(t, { pseudonyms: true });
  // adres pozostaje JEDNYM spójnym URL-em — bez rozerwania maską w środku ścieżki
  expect(r.redacted).toContain('https://intranet.firma.pl/osoby/Jan-Kowalski?tab=dane');
});

// ── LOGIN ──
test('login po kotwicy (też w następnej linii) + powtórzenia w dokumencie', () => {
  const t = 'Login użytkownika:\ntkaminski\n\nNastąpiło poprawne wylogowanie użytkownika "tkaminski" o 16:02.';
  const r = redactPII(t);
  expect(r.redacted.match(/\[LOGIN\]/g)?.length).toBe(2);
  expect(r.redacted.includes('tkaminski')).toBe(false);
  expect(r.redacted).toContain('o 16:02');
});
test('login: identyfikatory systemowe i puste pola zostają', () => {
  const t = 'Identyfikator w systemie:\nUSR-005182\n\nLogin:\nStatus: aktywny';
  const r = redactPII(t).redacted;
  expect(r).toContain('USR-005182');
  expect(r).toContain('Status: aktywny'); // etykieta po pustym „Login:" nie jest wartością
});
test('login respektuje options.types', () => {
  const t = 'Login: tkaminski';
  expect(redactPII(t, { types: [] }).redacted).toBe(t);
  expect(redactPII(t, { types: ['LOGIN'] }).redacted).toContain('[LOGIN]');
});

// ── Telefon z kropkami (mikrotest A) ──
test('telefon: kotwica „Kontakt" + wyliczenie z „oraz", wypełniaczem i prefiksem „+48."', () => {
  const t = 'Kontakt: 512.345.678, +48.512.345.678 oraz stacjonarny 22.501.23.45.';
  const r = redactPII(t);
  expect(r.redacted.match(/\[TELEFON\]/g)?.length).toBe(3);
  expect(r.redacted).not.toMatch(/\d{3}/);
});
test('telefon: człon po „oraz" w wyliczeniu z kotwicą „tel." maskowany', () => {
  const r = redactPII('tel. 512 345 678, 601-234-567 oraz 512.345.678.');
  expect(r.redacted.match(/\[TELEFON\]/g)?.length).toBe(3);
});
test('telefon: pułapki kropkowe (data, wersja, kwota) zostają', () => {
  const t = 'Data 12.05.1990 i wersja 10.2.3 nie są telefonem. Kwota 1.234.567 zł też nie.';
  expect(redactPII(t).redacted).toBe(t);
});

// ── Tablice rejestracyjne w wyliczeniu (mikrotest B) ──
test('tablice: wyliczenie po jednej kotwicy pojazdowej — wszystkie człony', () => {
  const t = 'Zabezpieczono pojazdy: WW 1234A, ZS 4567, WE 123AB, PO 5AB67, KR 8XY90, DW 12345, WGM 1234.';
  const r = redactPII(t);
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(7);
  expect(r.redacted).not.toMatch(/WW|ZS|WE|PO|KR|DW|WGM/);
});
test('tablice: kotwica „parking" z przerwą i kontynuacją „oraz"', () => {
  const r = redactPII('Na parkingu stały też GD 707GG oraz PZE 5U678.');
  expect(r.redacted.match(/\[NR-REJESTRACYJNY\]/g)?.length).toBe(2);
});
test('tablice: pułapki prawne — rozporządzenie (WE) i dyrektywa zostają', () => {
  const t = 'Rozporządzenie (WE) nr 1234/2009 oraz dyrektywa WE 123 to akty prawne, nie tablice.';
  expect(redactPII(t).redacted).toBe(t);
});
test('tablice: idempotencja drugiego przebiegu (kotwica nie zjada „…cyjnym")', () => {
  const r1 = redactPII('Kontrola: pojazd o nr rejestracyjnym WA 12345.').redacted;
  expect(redactPII(r1).redacted).toBe(r1);
});

// ── Miasto po adresie z przyimkiem / nową linią ──
test('miasto po [ADRES] z przyimkiem „w" maskowane; proza bez adresu zostaje', () => {
  const r = redactPII('Biuro przy ul. Morskiej 12 w Gdańsku czynne.');
  expect(r.redacted).toContain('[ADRES] w [MIEJSCOWOŚĆ]');
  const neg = 'Spotkanie projektowe odbyło się w Gdańsku.';
  expect(redactPII(neg).redacted).toBe(neg);
});

// ── Błędy OCR ──
test('OCR: para WERSALIKAMI z homoglifami („J0AN K0WALSKI") maskowana słownikowo', () => {
  const r = redactPII('Zgłoszenie od J0AN K0WALSKI przyjęto.', { pseudonyms: true });
  expect(r.redacted.includes('K0WALSKI')).toBe(false);
  expect(r.redacted.includes('J0AN')).toBe(false);
});
test('OCR: kotwice z homoglifem — „teI:" (telefon) i „uI." (ulica z „Lip0wa")', () => {
  const r = redactPII('teI:\n501234567\n\nuI. Lip0wa 15\n\nWarszawa');
  expect(r.redacted).toContain('[TELEFON]');
  expect(r.redacted).toContain('[ADRES]');
  expect(r.redacted).toContain('[MIEJSCOWOŚĆ]'); // miasto w bloku adresowym pod [ADRES]
  expect(r.redacted.includes('Lip0wa')).toBe(false);
});
test('WERSALIKI: para słownikowa maskowana, nagłówki i identyfikatory zostają', () => {
  const r = redactPII('Poszkodowany JAN KOWALSKI złożył zeznania.', { pseudonyms: true });
  expect(r.redacted.includes('KOWALSKI')).toBe(false);
  const neg = 'SĄD OKRĘGOWY oddalił. CZĘŚĆ IV. WERSJA KOŃCOWA. BALTIC SOLUTIONS Sp. z o.o. Numer seryjny SN-44A8-9912-XXA oraz LT-8844-PL i USR-005182.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
});

// Poprawki po audycie adwersarialnym v0.45.0 (obszar URL/LOGIN)
test('URL: JWT i parametry we FRAGMENCIE (#access_token=…) maskowane', () => {
  const t = 'Przekierowanie https://app.firma.pl/callback#access_token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJqa293YWxza2kifQ.SfKxwRJSMeKKFQT zapisano w logu.';
  const r = redactPII(t);
  expect(r.redacted).toContain('#access_token=[TOKEN]');
  expect(r.redacted.includes('eyJ')).toBe(false);
  expect(r.redacted).toContain('https://app.firma.pl/callback');
});
test('login w cudzysłowie po dwukropku i w guillemetach maskowany', () => {
  const r1 = redactPII('Login: „jkowalski”, hasło osobno.');
  expect(r1.redacted).toContain('„[LOGIN]”');
  expect(r1.redacted).toContain('hasło osobno');
  const r2 = redactPII('Wylogowanie użytkownika «tkaminski» o 14:32.');
  expect(r2.redacted).toContain('«[LOGIN]»');
});
test('kotwica „Login administratora/serwisowy" łapie wartość', () => {
  expect(redactPII('Login administratora: adm_piotrn').redacted).toContain('[LOGIN]');
  expect(redactPII('Login serwisowy: srv_backup').redacted).toContain('[LOGIN]');
});
test('puste „Login:" przed etykietą dwuwyrazową nie maskuje i nie propaguje', () => {
  const t = 'Login:\nSystem operacyjny: Windows 11 Pro\nUwagi: System uruchamia się poprawnie.';
  expect(redactPII(t).redacted).toBe(t);
});
test('nazwa konta w cudzysłowie („konto „Firmowe”") nie jest loginem', () => {
  const t = 'Środki zaksięgowano na konto „Firmowe”.';
  expect(redactPII(t).redacted).toBe(t);
});

// Poprawki po II raporcie testera (v0.45.1)
test('pola administracyjne: „Powiat: Pruszkowski" / „Województwo" nie są osobą', () => {
  const t = 'Powiat:\nPruszkowski\nWojewództwo:\nMazowieckie';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
  const t2 = 'Powiat: Pruszkowski, województwo mazowieckie.';
  expect(redactPII(t2, { pseudonyms: true }).redacted).toBe(t2);
});
test('imię przed maską w nazwie pliku wciągane do maski (maskuj całość)', () => {
  const r = redactPII('Załącznik: Umowa_Kredytowa_Adam_Kowalski.pdf oraz skan_Jan_Nowak.jpg', { pseudonyms: true });
  expect(r.redacted.includes('Adam')).toBe(false);
  expect(r.redacted.includes('Jan_')).toBe(false);
  expect(r.redacted).toContain('Umowa_Kredytowa_[OSOBA-');
  expect(r.redacted).toContain('.pdf');
});
test('OCR: wielkie I w środku nazwiska („KowaIski") — całe słowo w masce, bez ucięcia', () => {
  const r = redactPII('Zgłosił się Jan KowaIski z dokumentami. Pani Anna NowaIska też.', { pseudonyms: true });
  expect(r.redacted.includes('Iski')).toBe(false);
  expect(r.redacted.includes('Iska')).toBe(false);
  expect(r.redacted.includes('Kowa')).toBe(false);
  // token mieszany nienazwiskowy zostaje (bramka słownikowa)
  const neg = 'Urządzenie McIntosh IIe działa poprawnie.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
});

// ── Petycja do Urzędu Marszałkowskiego — nad/niedomaskowania z realnego pisma (v0.46.17) ──
// „Urząd/Urzędu Marszałkowski/ego" to nazwa instytucji, NIE osoba — „marszałkowski" trafił do
// NON_SURNAME_ADJ. Osoba nazwiskiem „Marszałkowski" NADAL łapana w parze z imieniem.
test('przymiotnik urzędowy „Marszałkowskiego" nie jest osobą; instytucja zostaje', () => {
  const t = 'platformach społecznościowych Urzędu Marszałkowskiego Województwa Śląskiego w Katowicach';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
  expect(redactPII('Zarząd Marszałkowski przyjął uchwałę', { pseudonyms: true }).redacted).toBe(
    'Zarząd Marszałkowski przyjął uchwałę',
  );
});
test('osoba o nazwisku „Marszałkowski" w parze z imieniem NADAL maskowana', () => {
  const r = redactPII('Petycję podpisał Jan Marszałkowski, przewodniczący.', { pseudonyms: true });
  expect(r.redacted.includes('Marszałkowski,')).toBe(false);
  expect(r.redacted).toContain('[OSOBA-A]');
  // forma żeńska też (Anna Marszałkowska)
  expect(redactPII('Wniosek złożyła Anna Marszałkowska.', { pseudonyms: true }).redacted.includes('Marszałkowska.')).toBe(
    false,
  );
});
test('adres WERSALIKAMI (skan/OCR) maskowany jak zapis małą literą', () => {
  for (const t of ['UL. JULIUSZA LIGONIA 46', 'AL. JANA PAWŁA II 12', 'OS. TYSIĄCLECIA 3', 'PL. DEFILAD 1']) {
    const r = redactPII(t, { pseudonyms: true });
    expect(r.redacted).toBe('[ADRES]');
  }
  // adres OSOBY WERSALIKAMI (dawniej wyciekał) — zamaskowany w całości
  const os = redactPII('Zamieszkały UL. KWIATOWA 5', { pseudonyms: true });
  expect(os.redacted.includes('KWIATOWA')).toBe(false);
  // „UL" bez kropki i numeru to nie adres (brak FP)
  expect(redactPII('UL to skrót od ulica', { pseudonyms: true }).redacted).toBe('UL to skrót od ulica');
});
test('miejscowość z anotacją jednostki TERYT „(miasto)/(gmina …)" maskowana', () => {
  expect(redactPII('Gliwice (miasto)', { pseudonyms: true }).redacted).toBe('[MIEJSCOWOŚĆ] (miasto)');
  expect(redactPII('Nowa Sól (miasto)', { pseudonyms: true }).redacted).toBe('[MIEJSCOWOŚĆ] (miasto)');
  expect(redactPII('Zabłudów (gmina miejsko-wiejska)', { pseudonyms: true }).redacted).toBe(
    '[MIEJSCOWOŚĆ] (gmina miejsko-wiejska)',
  );
  // kotwica „(miasto)" nie maskuje nazwy instytucji ani przymiotnika
  expect(redactPII('Sąd Rejonowy (miasto)', { pseudonyms: true }).redacted).toBe('Sąd Rejonowy (miasto)');
  expect(redactPII('Śląski (miasto)', { pseudonyms: true }).redacted).toBe('Śląski (miasto)');
  // inny rodzaj nawiasu (nie jednostka TERYT) nie wyzwala maski miejscowości
  expect(redactPII('Wisła (rzeka)', { pseudonyms: true }).redacted).toBe('Wisła (rzeka)');
});

// ── Eponimy uliczne (patroni) BEZPOŚREDNIO po kotwicy NIE są osobą (v0.46.18) ──
// „ulica/rondo/plac X" (też z rangą „ul. gen. X") — to nazwa ulicy, nie człowiek. Strażnik jest
// ZACHOWAWCZY: chroni patrona tuż po kotwicy w jednej linii, bez mostkowania spójników (to
// wchłaniało realne osoby — patrz test regresji niżej). Drugi człon wyliczenia „X oraz Y" bywa
// nadmaskowany — to zamaskowana nazwa ulicy, nie wyciek PII (dopuszczalne).
test('patron ulicy bezpośrednio po kotwicy nie jest osobą', () => {
  for (const s of [
    'Mieszkam przy ulicy Stefana Batorego.',
    'Rondo Romana Dmowskiego było zamknięte.',
    'Plac Marszałka Piłsudskiego odnowiono.',
    // kotwica z końcówką diakrytyczną (JS \b jest ASCII-only — wcześniej martwa)
    'Jadąc aleją Tadeusza Kościuszki minął sygnalizację.',
    // ranga między kotwicą a nazwą („ul. gen. …", „ul. ks. …")
    'Parafia przy ul. ks. Jerzego Popiełuszki.',
    'Mieszka przy ul. gen. Władysława Andersa w tym mieście.',
    // krótka forma solo („Ronda Dmowskiego"), obok pełnej i mostu
    'Na odcinku od Ronda Dmowskiego do mostu Piłsudskiego objazd.',
  ]) {
    expect(redactPII(s, { pseudonyms: true }).redacted).toBe(s);
  }
  // wyliczenie: PIERWSZY patron (tuż po kotwicy) zawsze chroniony
  const enl = 'Do kolizji doszło u zbiegu ulic Jana Kilińskiego oraz Stefana Batorego.';
  expect(redactPII(enl, { pseudonyms: true }).redacted).toContain('Jana Kilińskiego');
});
// REGRESJA (audyt v0.46.18): osoba w NASTĘPNEJ klauzuli/wierszu po eponimie MUSI być maskowana —
// strażnik uliczny działa tylko w obrębie jednej linii i nie wchłania osoby przez „,"/„\n"/kropkę.
test('osoba po eponimie ulicznym (nowa linia/przecinek/kropka) NADAL maskowana', () => {
  const a = redactPII('Miejsce: skwer Wojciecha Korfantego\nRoman Dmowski zeznał, że tam był.', { pseudonyms: true }).redacted;
  expect(a.includes('Roman Dmowski')).toBe(false);
  const b = redactPII('Na rogu ulicy Tadeusza Kościuszki, Krzysztof Anders oddalił się z miejsca.', { pseudonyms: true }).redacted;
  expect(b.includes('Krzysztof Anders')).toBe(false);
  const c = redactPII('Parafia przy al. Jana Pawła II\nProboszcz ks. Tadeusz Zieliński potwierdził zdarzenie.', { pseudonyms: true }).redacted;
  expect(c.includes('Tadeusz Zieliński')).toBe(false);
  // kropka kończąca zdanie nie może przedłużać kotwicy ulicznej na kolejne zdanie
  const d = redactPII('Mieszka przy ulicy Tadeusza Kościuszki. Krzysztof Anders był świadkiem.', { pseudonyms: true }).redacted;
  expect(d.includes('Krzysztof Anders')).toBe(false);
});
test('REGRESJA: realna osoba w sąsiedztwie słowa „ulica" NADAL maskowana', () => {
  // kotwica uliczna zwęża się do „ulica <Nazwa>"; „na ulicy <czasownik> <Osoba>" to człowiek
  const a = redactPII('Na ulicy spotkałem Jana Kowalskiego.', { pseudonyms: true }).redacted;
  expect(a.includes('Jana Kowalskiego')).toBe(false);
  const b = redactPII('Zdiagnozowano chorobę Jana Kowalskiego w szpitalu.', { pseudonyms: true }).redacted;
  expect(b.includes('Jana Kowalskiego')).toBe(false);
  const c = redactPII('Obecni byli Jan Kowalski oraz Anna Nowak.', { pseudonyms: true }).redacted;
  expect(c.includes('Jan Kowalski')).toBe(false);
  expect(c.includes('Anna Nowak')).toBe(false);
  // ranga/tytuł BEZ kotwicy ulicznej NIE chroni osoby (gen./ks. to człowiek, nie patron ulicy)
  expect(redactPII('Rozkaz wydał gen. Jan Kowalski osobiście.', { pseudonyms: true }).redacted.includes('Jan Kowalski')).toBe(false);
  expect(redactPII('Mszę odprawił ks. Jan Kowalski.', { pseudonyms: true }).redacted.includes('Jan Kowalski')).toBe(false);
  // ulica Z NUMEREM (adres) + nowa linia + osoba — osoba nadal maskowana (adres to [ADRES], nie kotwica)
  expect(redactPII('Biuro: ul. Zielona 5\nJan Kowalski złożył wniosek.', { pseudonyms: true }).redacted.includes('Jan Kowalski')).toBe(false);
});

// ── Domknięcia z audytu v0.46.19: łącznik przy etykiecie, typy ulic, przymiotnik powiatowy, zdrobnienia ──
test('PESEL/NIP/REGON po słabym łączniku („to/o numerze/nr") maskowane mimo złej sumy', () => {
  expect(redactPII('jego PESEL to 71030512399', { pseudonyms: true }).redacted).toContain('[PESEL]');
  expect(redactPII('PESEL o numerze 89010112345', { pseudonyms: true }).redacted).toContain('[PESEL]');
  expect(redactPII('NIP to 1234563218', { pseudonyms: true }).redacted).toContain('[NIP]');
  expect(redactPII('REGON nr 123456785', { pseudonyms: true }).redacted).toContain('[REGON]');
});
test('adres z typem ulicy bez skrótu (Rondo/most/skwer/bulwar) maskowany; „Park …" to nie adres', () => {
  expect(redactPII('zam. Rondo Romana Dmowskiego 3/7 w Warszawie', { pseudonyms: true }).redacted).toContain('[ADRES]');
  expect(redactPII('biuro: skwer Kościuszki 12', { pseudonyms: true }).redacted).toContain('[ADRES]');
  expect(redactPII('mieszka przy most Piłsudskiego 5', { pseudonyms: true }).redacted).toContain('[ADRES]');
  // „park" WYKLUCZONE — częsta nazwa instytucji („Park Narodowy … 2024") dawała FP
  const neg = 'Park Narodowy Gór Stołowych 2024 obchodzi jubileusz.';
  expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
  // ROK (4 cyfry 1900–2099) po nowym typie obiektu to NIE numer domu (regresja z audytu v0.46.19)
  for (const y of ['Bulwar Filadelfijski 1998 objęty rewitalizacją.', 'Most Grunwaldzki 1910 wybudowano.', 'Skwer Powstańców 1944 odsłonięto.']) {
    expect(redactPII(y, { pseudonyms: true }).redacted).toBe(y);
  }
  // …ale realny numer domu (mała liczba/mieszkanie) NADAL adresem
  expect(redactPII('Bulwar Nadmorski 10', { pseudonyms: true }).redacted).toBe('[ADRES]');
});
test('kotwica IBAN nie zjada liter następnego słowa (diakrytyk po IBAN)', () => {
  const r = redactPII('na rachunek wspólnoty PL61 1090 1014 0000 0712 1981 3152 wpłynęły zaliczki.', { pseudonyms: true }).redacted;
  expect(r).toContain('[NR-KONTA]');
  expect(r).toContain('wpłynęły'); // słowo nietknięte (dawniej „[NR-KONTA]łynęły")
  expect(r.includes('[NR-KONTA]łynęły')).toBe(false); // brak zjedzenia „wp"
});

// ── Domknięcia z audytu v0.46.20: imię osierocone (newline / panieńskie „z"), REGON wielowyrazowy ──
test('imię na końcu wiersza przed potwierdzonym nazwiskiem w następnej linii — maskowane w całości', () => {
  for (const t of ['Jan\nWiśniewski złożył wniosek.', 'Starosta Jan\nWiśniewski przeprowadził kontrolę.']) {
    const r = redactPII(t, { pseudonyms: true }).redacted;
    expect(/\bJan\b/.test(r)).toBe(false);
    expect(r.includes('Wiśniewski')).toBe(false);
  }
  // proza na końcu wiersza (nie imię) NIE jest wciągana do maski
  expect(redactPII('protokół\nKowalski podpisał.', { pseudonyms: true }).redacted).toContain('protokół');
});
test('nazwisko panieńskie „Imię z Nazwiskoskich"/„z domu" — jedna osoba; narzędnik „z Kowalskim" — dwie', () => {
  for (const t of ['Gosia z Lewandowskich głosowała przeciw.', 'Anna z Kowalskich była obecna.', 'Barbara\nz Nowaków była obecna.']) {
    const r = redactPII(t, { pseudonyms: true }).redacted;
    expect(/\b(Gosia|Anna|Barbara)\b/.test(r)).toBe(false); // imię NIE osierocone (też po łamaniu wiersza)
    expect(/Lewandowskich|Kowalskich|Nowaków/.test(r)).toBe(false);
  }
  expect(redactPII('Maria Nowak z domu Zielińska przyszła.', { pseudonyms: true }).redacted.includes('Zielińska')).toBe(false);
  // REGRESJA: narzędnik „z Kowalskim" = „z kimś" (DWIE osoby) — imię MUSI zostać
  const instr = redactPII('Anna rozmawiała z Kowalskim wczoraj.', { pseudonyms: true }).redacted;
  expect(instr).toContain('Anna');
  // miejsce po „z" nie jest osobą
  expect(redactPII('Jan wrócił z Krakowa wieczorem.', { pseudonyms: true }).redacted).toContain('z Krakowa');
});
test('REGON/PESEL po ETYKIECIE z wieloma wyrazami wtrącenia maskowane', () => {
  expect(redactPII('REGON zakładu opiekuńczego wynosi 012345675', { pseudonyms: true }).redacted).toContain('[REGON]');
  // bez etykiety liczba nie jest maskowana jako REGON
  expect(redactPII('Rozliczenie za rok 2023 i pozycja 012345675 gotowe.', { pseudonyms: true }).redacted).toContain('012345675');
});
test('przymiotnik ODMIEJSCOWY powiatowy po roli to nie nazwisko; realne nazwisko po roli — tak', () => {
  expect(redactPII('Z upoważnienia Starosty Wołomińskiego', { pseudonyms: true }).redacted).toBe('Z upoważnienia Starosty Wołomińskiego');
  expect(redactPII('Decyzja Wojewody Mazowieckiego', { pseudonyms: true }).redacted).toBe('Decyzja Wojewody Mazowieckiego');
  // po roli realne nazwisko NADAL maskowane
  expect(redactPII('Prezes Kowalski podpisał uchwałę.', { pseudonyms: true }).redacted.includes('Kowalski')).toBe(false);
});
test('zdrobnienia imion w parze z nazwiskiem maskowane; samo zdrobnienie/wyraz pospolity — nie', () => {
  for (const t of ['Zgłosił się Janek Kowalski.', 'Rozmawiałem z Kasią Nowak.', 'Tomek Wiśniewski zeznał.', 'Zosia Dąbrowska przyszła.']) {
    const r = redactPII(t, { pseudonyms: true }).redacted;
    expect(/Kowalski|Nowak|Wiśniewski|Dąbrowska/.test(r)).toBe(false);
    expect(r).toContain('[OSOBA-A]');
  }
  // samo zdrobnienie / zdrobnienie + wyraz pospolity (mała litera) — NIE maskowane (brak nazwiska)
  for (const neg of ['Janek poszedł do sklepu.', 'To była wielka anka zamówień.', 'Elka wisiała na ścianie.']) {
    expect(redactPII(neg, { pseudonyms: true }).redacted).toBe(neg);
  }
});

// ── Telefon: most „pod numerem" po kotwicy; bez kotwicy 2-3-2-2 świadomie NIE maskowany (v0.46.18) ──
test('telefon 2-3-2-2 po kotwicy „kontakt … pod numerem" (też przez nową linię)', () => {
  const t = 'Prosimy o kontakt telefoniczny pod numerem\n32 774 91 55 lub adresem.';
  const r = redactPII(t, { pseudonyms: true }).redacted;
  expect(r.includes('32 774 91 55')).toBe(false);
  expect(r).toContain('[TELEFON]');
});
test('REGRESJA: liczba 2-3-2-2 bez kontekstu telefonicznego NIE jest telefonem', () => {
  // „nadmaskowanie gorsze niż drobny wyciek" — numer pozycji/inwentarza zostaje jawny
  const t = 'Pozycja 32 774 91 55 w wykazie inwentarza magazynowego.';
  expect(redactPII(t, { pseudonyms: true }).redacted).toBe(t);
});

// ── Wydajność: żadne wejście nie może zamrozić karty (wzorce kwadratowe, audyt UI 2026-10) ──
test('czas liniowy na patologicznych wejściach (każde < 500 ms przy ~100 tys. znaków)', () => {
  const inputs: Record<string, string> = {
    'litery bez @': 'a'.repeat(100_000),
    hex: 'abcdef0123'.repeat(10_000),
    'spacje w wierszu': `x${' '.repeat(100_000)}x`,
    nawiasy: '('.repeat(50_000),
    'polskie wersaliki': 'Ż'.repeat(100_000),
    'cyfry i kropki': '1.1.'.repeat(25_000),
    'kotwica tablicy': 'rejestracyjny '.repeat(7_000),
    'łańcuch z myślnikami': 'Abc-'.repeat(25_000),
    'litera i kropka': 'a.'.repeat(50_000),
    'znak sprawy': 'AB.'.repeat(30_000),
  };
  for (const [name, text] of Object.entries(inputs)) {
    const t0 = performance.now();
    redactPII(text);
    expect(performance.now() - t0, name).toBeLessThan(500);
  }
});
test('e-maile sklejone i w łańcuchu maskowane jak dotąd (szybka ścieżka e-mail)', () => {
  // myślnik należy do klasy części lokalnej, więc drugi adres pochłania go — tak było zawsze
  expect(redactPII('jan@x.pl-anna@y.pl').redacted).toBe('[EMAIL][EMAIL]');
  expect(redactPII('a@b.pl.c@d.pl').redacted).toBe('[EMAIL][EMAIL]');
  expect(redactPII('Pisz: piotr.wiśniewski@firma.pl, kopia do biuro@firma.pl.').redacted).toBe('Pisz: [EMAIL], kopia do [EMAIL].');
  expect(redactPII('https://portal.example.com/?email=jan%40example.com&id=7').redacted).toBe('https://portal.example.com/?email=[EMAIL]&id=7');
});
test('CRLF: pole formularza w tej samej linii zachowuje windowsowy koniec wiersza', () => {
  const r = redactPII('Nazwisko: Kowalski\r\nImię: Jan\r\nUwagi: brak\r\n').redacted;
  expect(r).toBe('Nazwisko: [IMIĘ I NAZWISKO]\r\nImię: [IMIĘ I NAZWISKO]\r\nUwagi: brak\r\n');
});
test('miejscowość z etykietą TERYT po myślniku-wypunktowaniu nadal maskowana', () => {
  expect(redactPII('-Gliwice (miasto)').redacted).toBe('-[MIEJSCOWOŚĆ] (miasto)');
});
test('DOWOD — wzór MSWiA ABS123456 i numery z poprawną sumą bez kontekstu', () => {
  expect(isValidDowod('ABS123456')).toBe(true);
  expect(isValidDowod('ABS123457')).toBe(false);
  // numery liczone wagami 7,3,1,9,7,3,1,7,3 — dawniej odrzucane (przesunięte wagi części cyfrowej)
  for (const nr of ['PHO996589', 'BZF219030', 'FXB481077', 'WVV570316', 'JHU038524']) {
    expect(isValidDowod(nr), nr).toBe(true);
    expect(redactPII(`Okazał dokument ${nr} przy odbiorze.`).redacted).toBe('Okazał dokument [NR-DOWODU] przy odbiorze.');
  }
});

// ── Audyt, partia b1: czyste wyjście (tekst poza maską bez zmian) ──
const keep = (texts: string[], opts?: Parameters<typeof redactPII>[1]): void => {
  for (const t of texts) expect(redactPII(t, opts).redacted, t).toBe(t);
};
test('K02: odstępy wokół maski osoby zostają co do znaku (tabulatory, wyrównanie spacjami)', () => {
  expect(redactPII('Lekarz SOR: lek. Natalia Wróbel   Pielęgniarka: Ewa Kruk').redacted).toBe(
    'Lekarz SOR: lek. [IMIĘ I NAZWISKO]   Pielęgniarka: [IMIĘ I NAZWISKO]',
  );
  expect(redactPII('2024-03-01\tJan Kowalski\tWarszawa\t1250,00').redacted).toBe('2024-03-01\t[IMIĘ I NAZWISKO]\tWarszawa\t1250,00');
  expect(redactPII('Wystawił: Marek Dąbrowski     Odebrał: Ewa Kamińska').redacted).toBe(
    'Wystawił: [IMIĘ I NAZWISKO]     Odebrał: [IMIĘ I NAZWISKO]',
  );
  expect(redactPII('Dyrektor\tJan Kowalski\tWarszawa').redacted).toBe('Dyrektor\t[IMIĘ I NAZWISKO]\tWarszawa');
  // K03: tabulator w osobie to granica komórki — każda komórka ma maskę, liczba kolumn zostaje
  expect(redactPII('Jan\tKowalski\tWarszawa').redacted).toBe('[IMIĘ I NAZWISKO]\t[IMIĘ I NAZWISKO]\tWarszawa');
  expect(redactPII('Pan   Jan Kowalski   Nr 5').redacted).toBe('Pan   [IMIĘ I NAZWISKO]   Nr 5');
  // małżonkowie: spójnik i odstępy z oryginału („oraz" nie zamienia się w „i")
  expect(redactPII('Anna oraz Jan Kowalscy').redacted).toBe('[IMIĘ I NAZWISKO] oraz [IMIĘ I NAZWISKO]');
  expect(redactPII('Anna   i   Jan Kowalscy', { pseudonyms: true }).redacted).toBe('[OSOBA-A]   i   [OSOBA-A]');
  // rola/tytuł przed maską z oryginalnym odstępem (para morfologiczna, wyzwalacz, WERSALIKI, OCR)
  expect(redactPII('Prezes\tGzowski\tKraków').redacted).toBe('Prezes\t[IMIĘ I NAZWISKO]\tKraków');
  expect(redactPII('Kierownik\tKowalski\t5000').redacted).toBe('Kierownik\t[IMIĘ I NAZWISKO]\t5000');
  expect(redactPII('Pan Dyrektor\tKowalski').redacted).toBe('Pan Dyrektor\t[IMIĘ I NAZWISKO]');
  expect(redactPII('SSO\tJAN KOWALSKI').redacted).toBe('SSO\t[IMIĘ I NAZWISKO]');
  expect(redactPII('PREZES   JAN   KOWALSKI').redacted).toBe('PREZES   [IMIĘ I NAZWISKO]');
  expect(redactPII('Firma\tKowaIski').redacted).toBe('Firma\t[IMIĘ I NAZWISKO]');
  expect(redactPII('Jan Nowak\tAnna Kowalska', { pseudonyms: true }).redacted).toBe('[OSOBA-A]\t[OSOBA-B]');
});
test('K02: niedoklejona reszta po masce miejscowości wraca z oryginalnym separatorem', () => {
  expect(redactPII('kod\tmiasto\tkraj\n00-001\tWarszawa\tPolska').redacted).toBe('kod\tmiasto\tkraj\n[KOD-POCZTOWY]\t[MIEJSCOWOŚĆ]\tPolska');
  expect(redactPII('00-950   Warszawa   Mazowieckie').redacted).toBe('[KOD-POCZTOWY]   [MIEJSCOWOŚĆ]   Mazowieckie');
  expect(redactPII('Jan\tKowalski\t00-001\tWarszawa\tMazowieckie\tPolska').redacted).toBe(
    '[IMIĘ I NAZWISKO]\t[IMIĘ I NAZWISKO]\t[KOD-POCZTOWY]\t[MIEJSCOWOŚĆ]\tMazowieckie\tPolska',
  );
  expect(redactPII('zamieszkały w Krakowie\tPolska').redacted).toBe('zamieszkały w [MIEJSCOWOŚĆ]\tPolska');
  expect(redactPII('ul. Długa 5, Warszawa\tPolska').redacted).toBe('[ADRES], [MIEJSCOWOŚĆ]\tPolska');
  expect(redactPII('Jan Kowalski, ur. 12.03.1980 r. w Krakowie\tPolska').redacted).toBe(
    '[IMIĘ I NAZWISKO], ur. [DATA-URODZENIA] r. w [MIEJSCOWOŚĆ]\tPolska',
  );
  expect(redactPII('Polska\tWarszawa, ul. Długa 5').redacted).toBe('Polska\t[MIEJSCOWOŚĆ], [ADRES]');
  expect(redactPII('Polska\tGliwice (miasto)').redacted).toBe('Polska\t[MIEJSCOWOŚĆ] (miasto)');
  expect(redactPII('00-001 Warszawa    Tel. 22 123 45 67').redacted).toBe('[KOD-POCZTOWY] [MIEJSCOWOŚĆ]    Tel. [TELEFON]');
});
test('K02 pułapki: nazwy własne i nagłówki z wyrównaniem nadal bez zmian', () => {
  keep([
    'Rondo Romana Dmowskiego   Wjazd od strony parku',
    'Sąd Rejonowy   Wydział Cywilny   Sekcja Druga',
    'Nowa Ruda   Gmina Miejska',
    'Imię\tNazwisko\tStanowisko\tDział',
    'Prezes   Zarządu   Spółki',
    'Plac Jana Pawła   Parking',
    'Aleja Jana   Pawła II   Gdańsk',
    'Klinika Kardiologii   Oddział Intensywnej Terapii',
    'Mieszkam przy ulicy Jana Pawła w Krakowie.',
    'Dz. U. poz. 12-345\tWarszawa\tPolska',
    'Spotkanie w Gdańsku\tPolska\tjutro',
    'Sąd Okręgowy w Warszawie\tWydział I Cywilny',
    'Wojewoda Mazowiecki\tWarszawa\tPolska',
    'Na rynku w Krakowie    Sukiennice',
    'Starosty Wołomińskiego\tWołomin',
    'Elektro-Instal Sp. z o.o.\tNowa Ruda',
  ]);
});

test('K18: etykieta „krs" zostaje w oryginalnym zapisie', () => {
  expect(redactPII('krs: 0000123456').redacted).toBe('krs: [KRS]');
  expect(redactPII('krs=0000123456').redacted).toBe('krs=[KRS]');
  expect(redactPII('Krs: 0000123456, regon: 012345678').redacted).toBe('Krs: [KRS], regon: [REGON]');
  // pułapki: wielkie litery i kotwice z wypełniaczem jak dotąd; wzmianka bez numeru bez zmian
  expect(redactPII('nr KRS 0000123456').redacted).toBe('nr KRS [KRS]');
  expect(redactPII('Spółka wpisana do KRS pod numerem 0000123456.').redacted).toBe('Spółka wpisana do KRS pod numerem [KRS].');
  keep(['Wpis do KRS z dnia 12.03.2020 dokonany przez Sąd Rejonowy.', 'ustawa o KRS z 1997 r., art. 36 ust. 1']);
});

test('K19: wyliczenie telefonów po „lub/albo/bądź", „/" i „;" — maskowane wszystkie numery', () => {
  expect(redactPII('tel. 601-222-333 lub 22 501 23 45').redacted).toBe('tel. [TELEFON] lub [TELEFON]');
  expect(redactPII('tel. 12 634 55 22 / 12 634 55 23').redacted).toBe('tel. [TELEFON] / [TELEFON]');
  expect(redactPII('Kontakt: 512 345 678 / 22 501 23 45').redacted).toBe('Kontakt: [TELEFON] / [TELEFON]');
  expect(redactPII('tel. 601 222 333 albo 22 501 23 46').redacted).toBe('tel. [TELEFON] albo [TELEFON]');
  expect(redactPII('tel. 601 222 333; 22 501 23 46').redacted).toBe('tel. [TELEFON]; [TELEFON]');
  expect(redactPII('tel. 601 222 333 bądź 22 501 23 46').redacted).toBe('tel. [TELEFON] bądź [TELEFON]');
  expect(redactPII('Tel. kontaktowy: 601 222 333 albo stacjonarny 22 501 23 45').redacted).toBe(
    'Tel. kontaktowy: [TELEFON] albo stacjonarny [TELEFON]',
  );
  // prefiks „0048" po „lub" przejmuje tryb (a) w całości — bez ogona „33 48"
  expect(redactPII('tel. +48 61 852 33 47 lub 0048 61 852 33 48').redacted).toBe('tel. [TELEFON] lub [TELEFON]');
});
test('K19: kropka skrótu przed kolejnym numerem zostaje („kom. [TELEFON]", nie „kom[TELEFON]")', () => {
  expect(redactPII('tel. 22 501 23 45, kom. 601 222 333').redacted).toBe('tel. [TELEFON], kom. [TELEFON]');
  expect(redactPII('tel. 22 501 23 45 oraz tel. 22 501 23 46').redacted).toBe('tel. [TELEFON] oraz tel. [TELEFON]');
  expect(redactPII('Telefon 512 345 678, tel. 601 234 567').redacted).toBe('Telefon [TELEFON], tel. [TELEFON]');
});
test('K19 pułapki: kwota, data, przepis, numer wewnętrzny i niepełny numer po separatorze zostają', () => {
  keep(['Pozycja 32 774 91 55 w wykazie lub 32 774 91 56', 'Wpłata 120 000 000 zł lub 130 000 000 zł']);
  const cases: [string, string][] = [
    ['tel. 601 222 333 lub 120 000 000 zł', 'tel. [TELEFON] lub 120 000 000 zł'],
    ['tel. 601 222 333, 120 000 000 zł', 'tel. [TELEFON], 120 000 000 zł'],
    ['tel. 601 222 333 / 12/03/2020', 'tel. [TELEFON] / 12/03/2020'],
    ['tel. 601 222 333; pozycja 32 774 91 55 w wykazie', 'tel. [TELEFON]; pozycja 32 774 91 55 w wykazie'],
    ['tel. 22 501 23 45 / Dz.U. 2020 poz. 1234', 'tel. [TELEFON] / Dz.U. 2020 poz. 1234'],
    ['Kontakt: 512 345 678 / art. 22 ust. 1 pkt 2', 'Kontakt: [TELEFON] / art. 22 ust. 1 pkt 2'],
    ['tel. 22 501 23 45 / 46', 'tel. [TELEFON] / 46'],
    ['tel. 601 222 333 lub 601 222 33', 'tel. [TELEFON] lub 601 222 33'],
    ['tel. 601 222 333 lub 0000123456', 'tel. [TELEFON] lub 0000123456'],
    ['tel. 601 222 333; 2024-03-12 10:00', 'tel. [TELEFON]; 2024-03-12 10:00'],
    ['tel. 512 345 678, 601-234-567 oraz 512.345.678.', 'tel. [TELEFON], [TELEFON] oraz [TELEFON].'],
    ['Kontakt telefoniczny: +48 600 700 800 lub 601-202-303.', 'Kontakt telefoniczny: [TELEFON] lub [TELEFON].'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});

test('K05: człony kropkowych skrótów (P.S., S.A., O.O., Sp. J.) nie są inicjałem imienia', () => {
  keep(['P.S. Mróz ma być w nocy.', 'P.S. Lis znowu był w kurniku.', 'P.S. Kowal przyjdzie w środę', 'Dz.U. Lis', 'P.S. Wilk i Zając poszli.']);
  const cases: [string, string][] = [
    ['P.S. Nowak dzwonił, oddzwoń.', 'P.S. [IMIĘ I NAZWISKO] dzwonił, oddzwoń.'],
    ['P.S. Kasia Nowak też przyjdzie.', 'P.S. [IMIĘ I NAZWISKO] też przyjdzie.'],
    ['PKO B.P. Nowak', 'PKO B.P. [IMIĘ I NAZWISKO]'],
    ['P.P.S. Kowalski', 'P.P.S. [IMIĘ I NAZWISKO]'],
    ['ORLEN S.A. Jan Kowalski\nBUDMAX SP. Z O.O. Jan Kowalski', 'ORLEN S.A. [IMIĘ I NAZWISKO]\nBUDMAX SP. Z O.O. [IMIĘ I NAZWISKO]'],
    ['Budmax Sp. z O.O. Jan Kowalski', 'Budmax Sp. z O.O. [IMIĘ I NAZWISKO]'],
    ['P.P.H.U. Jan Kowalski', 'P.P.H.U. [IMIĘ I NAZWISKO]'],
    ['F.H.U. Anna Nowak', 'F.H.U. [IMIĘ I NAZWISKO]'],
    ['BUDMAX SP.J. Jan Kowalski', 'BUDMAX SP.J. [IMIĘ I NAZWISKO]'],
    ['BUDMAX SP. J. Jan Kowalski', 'BUDMAX SP. J. [IMIĘ I NAZWISKO]'],
    ['Budmax Sp. K. Jan Kowalski', 'Budmax Sp. K. [IMIĘ I NAZWISKO]'],
    ['POLSKA GRUPA ENERGETYCZNA S.A.      PAWEŁ GÓRSKI', 'POLSKA GRUPA ENERGETYCZNA S.A.      [IMIĘ I NAZWISKO]'],
    // dwa inicjały bez spacji to łańcuch inicjałów osoby — w masce w całości (bez sklejonego „J.[…]")
    ['J.K. Kowalski podpisał.', '[IMIĘ I NAZWISKO] podpisał.'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});
test('K05: inicjał z polską literą („Ł.", „Ś.") jest inicjałem — nie wycieka', () => {
  expect(redactPII('Pełnomocnik: mec. Ł. Baran').redacted).toBe('Pełnomocnik: mec. [IMIĘ I NAZWISKO]');
  expect(redactPII('Nadawca: Ł. Mróz').redacted).toBe('Nadawca: [IMIĘ I NAZWISKO]');
  expect(redactPII('Świadek Ł. Kowalski').redacted).toBe('Świadek [IMIĘ I NAZWISKO]');
  expect(redactPII('Wnioskodawca Ś. Wiśniewski').redacted).toBe('Wnioskodawca [IMIĘ I NAZWISKO]');
});
test('K05: „P." w nagłówku listu (Sz. P., Szanowny P., W.P.) to „Pan" — zostaje przed maską', () => {
  const cases: [string, string][] = [
    ['Sz. P. Andrzej Górski', 'Sz. P. [IMIĘ I NAZWISKO]'],
    ['Sz.P. Andrzej Górski', 'Sz.P. [IMIĘ I NAZWISKO]'],
    ['W.P. Jan Kowalski', 'W.P. [IMIĘ I NAZWISKO]'],
    ['Szanowny P. Jan Kowalski', 'Szanowny P. [IMIĘ I NAZWISKO]'],
    ['Szanowna P. Anna Nowak', 'Szanowna P. [IMIĘ I NAZWISKO]'],
    ['Wielmożny P. Jan Kowalski', 'Wielmożny P. [IMIĘ I NAZWISKO]'],
    ['Sz. P. Kowalskiemu', 'Sz. P. [IMIĘ I NAZWISKO]'],
    ['Szanowny P. Mróz', 'Szanowny P. [IMIĘ I NAZWISKO]'],
    ['Do: Sz. P. Andrzej Górski, ul. Lipowa 5', 'Do: Sz. P. [IMIĘ I NAZWISKO], [ADRES]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
  expect(redactPII('Sz. P. Andrzej Górski', { pseudonyms: true }).redacted).toBe('Sz. P. [OSOBA-A]');
});
test('K05 pułapki: prawdziwe inicjały nadal w masce; patroni i skróty bez osób bez zmian', () => {
  const cases: [string, string][] = [
    ['mec. J. Kowalski', 'mec. [IMIĘ I NAZWISKO]'],
    ['r.pr. J. Kowalski', 'r.pr. [IMIĘ I NAZWISKO]'],
    ['Sprawę prowadzi st. sierż. J. Kowalski.', 'Sprawę prowadzi st. sierż. [IMIĘ I NAZWISKO].'],
    ['A. Jan Kowalski zeznał', 'A. [IMIĘ I NAZWISKO] zeznał'], // punkt wyliczenia na początku wiersza zostaje
    ['Pan A. Nowak', 'Pan [IMIĘ I NAZWISKO]'],
    ['Zawiadomienie otrzymał P. Kowalski.', 'Zawiadomienie otrzymał [IMIĘ I NAZWISKO].'],
    ['Kierownik działu: A. Wiśniewska, zastępca: P. Zieliński.', 'Kierownik działu: [IMIĘ I NAZWISKO], zastępca: [IMIĘ I NAZWISKO].'],
    ['Opinię wydał biegły dr A. Lis.', 'Opinię wydał biegły dr [IMIĘ I NAZWISKO].'],
    ['Obecni: dr A. Nowak, prof. B. Wiśniewski.', 'Obecni: dr [IMIĘ I NAZWISKO], prof. [IMIĘ I NAZWISKO].'],
    ['Sz. Pan Andrzej Górski', 'Sz. Pan [IMIĘ I NAZWISKO]'],
    ['Sprzedawca: ORLEN S.A. Pan Jan Kowalski', 'Sprzedawca: ORLEN S.A. Pan [IMIĘ I NAZWISKO]'],
    ['Budmax sp. z o.o. Jan Kowalski', 'Budmax sp. z o.o. [IMIĘ I NAZWISKO]'],
    ['Biuro przy Al. W. Andersa 15 czynne.', 'Biuro przy [ADRES] czynne.'],
    // „W. P." ze spacją to dwa inicjały, nie „W.P." — drugi wchodzi do maski jak dotąd
    ['W. P. Kowalski', 'W. [IMIĘ I NAZWISKO]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
  keep([
    'Szkoła im. A. Mickiewicza',
    'J.P. Morgan zainwestował w spółkę.',
    'U.S. Steel ogłosił wyniki.',
    'Dz.U. z 2020 r. poz. 1740',
    'Dz. U. Nr 16, poz. 93',
    'św. J. Pawła II',
    'Szkoła im. A. Mickiewicza. A. Wnioski stron. B. Uzasadnienie.',
    'P.S. Pozdrowienia dla Mamy.',
  ]);
});

test('K05: łańcuch inicjałów („J.M.") kotwiczy nazwisko-homograf — skład sądu nie zostaje jawny', () => {
  const t =
    'Przewodniczący: SSO J.M. Wilk\nSędziowie: SO A.K. Sowa, SO T.J. Mazur (spr.)\nr.pr. P.A. Zając\n' +
    'Świadek A.B. Kowal zeznał.\nz powództwa E.M. Baran\nW sprawie z wniosku T.K. Wilka';
  expect(redactPII(t).redacted).toBe(
    'Przewodniczący: SSO [IMIĘ I NAZWISKO]\nSędziowie: SO [IMIĘ I NAZWISKO], SO [IMIĘ I NAZWISKO] (spr.)\nr.pr. [IMIĘ I NAZWISKO]\n' +
      'Świadek [IMIĘ I NAZWISKO] zeznał.\nz powództwa [IMIĘ I NAZWISKO]\nW sprawie z wniosku [IMIĘ I NAZWISKO]',
  );
  const cases: [string, string][] = [
    ['Sędziowie:\nJ.M. Wilk', 'Sędziowie:\n[IMIĘ I NAZWISKO]'],
    ['Zeznał. J.M. Wilk podpisał.', 'Zeznał. [IMIĘ I NAZWISKO] podpisał.'],
    ['prof. A.B. Nowaka', 'prof. [IMIĘ I NAZWISKO]'],
  ];
  for (const [x, want] of cases) expect(redactPII(x).redacted, x).toBe(want);
  expect(redactPII('SSO J.M. Wilk i SSR J.M. Wilk', { pseudonyms: true }).redacted).toBe('SSO [OSOBA-A] i SSR [OSOBA-A]');
});
test('K05: po skrócie formy działalności i „W.P./Ś.P./Sz.P." nazwisko w masce, skrót zostaje', () => {
  const cases: [string, string][] = [
    ['3. P.H.U. Wilk Tomasz Wilk', '3. P.H.U. [IMIĘ I NAZWISKO] [IMIĘ I NAZWISKO]'],
    ['4. F.H. Sowa — Ewa Sowa', '4. F.H. [IMIĘ I NAZWISKO] — [IMIĘ I NAZWISKO]'],
    ['Prokurent: P.P.H.U. Baran — Adam Baran', 'Prokurent: P.P.H.U. [IMIĘ I NAZWISKO] — [IMIĘ I NAZWISKO]'],
    ['Faktura od P.H.U. Wilk', 'Faktura od P.H.U. [IMIĘ I NAZWISKO]'],
    ['Sz.P. Wilk', 'Sz.P. [IMIĘ I NAZWISKO]'],
    ['Sz. P. Wilk', 'Sz. P. [IMIĘ I NAZWISKO]'],
    ['W.P. Wilk', 'W.P. [IMIĘ I NAZWISKO]'],
    ['Ś.P. Wilk', 'Ś.P. [IMIĘ I NAZWISKO]'],
    ['Ś.P. Jan Kowalski', 'Ś.P. [IMIĘ I NAZWISKO]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});
test('K05: tytuł sklejony z inicjałem („Dr.J.") — inicjał w masce, tytuł zostaje', () => {
  const cases: [string, string][] = [
    ['Dr.J. Kowalski zeznał.', 'Dr.[IMIĘ I NAZWISKO] zeznał.'],
    ['Dr.J. Wilk zeznał.', 'Dr.[IMIĘ I NAZWISKO] zeznał.'],
    ['dr.A. Nowak', 'dr.[IMIĘ I NAZWISKO]'],
    ['mgr.A. Nowak podpisała.', 'mgr.[IMIĘ I NAZWISKO] podpisała.'],
    ['prof.J. Nowak', 'prof.[IMIĘ I NAZWISKO]'],
    ['mec.Ł. Baran', 'mec.[IMIĘ I NAZWISKO]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});
test('K05 pułapki łańcucha: skróty z kropkami bez osoby zostają bez zmian', () => {
  keep([
    'P.S. Mróz ma być w nocy.',
    'P.P.S. Mróz ma być w nocy.',
    'PKO B.P. Wilk',
    'ORLEN S.A. Wilk',
    'Dz.U. Lis',
    'S.C. Mazur',
    'A.D. Wilk',
    'BUDMAX SP.J. Wilk',
    'J.P. Morgan zainwestował w spółkę.',
    'J.R.R. Tolkien',
    'm.in. Wilk i Lis',
    'O.K. Wilk przyjdzie jutro.',
  ]);
  expect(redactPII('O.K. Nowak przyszedł.').redacted).toBe('O.K. [IMIĘ I NAZWISKO] przyszedł.');
  expect(redactPII('Kowalski i Nowak S.C. Jan Kowalski').redacted).toBe(
    '[IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO] S.C. [IMIĘ I NAZWISKO]',
  );
  expect(redactPII('P.P.S. Kowalski').redacted).toBe('P.P.S. [IMIĘ I NAZWISKO]');
});
test('K04: punkt wyliczenia po dosłownym „\\n" w JSON-ie zostaje jak po prawdziwej nowej linii', () => {
  const t = String.raw`{"t":"Postanawia:\nA. Kowalski Jan — świadek\nB. Nowak Anna — świadek"}`;
  const r = redactPII(t).redacted;
  expect(r).toBe(String.raw`{"t":"Postanawia:\nA. [IMIĘ I NAZWISKO] — świadek\nB. [IMIĘ I NAZWISKO] — świadek"}`);
  expect(() => JSON.parse(r)).not.toThrow();
  // inicjał w środku wiersza (po „\t") nadal wchodzi do maski
  expect(redactPII(String.raw`{"t":"Świadek:\tA. Kowalski Jan"}`).redacted).toBe(String.raw`{"t":"Świadek:\t[IMIĘ I NAZWISKO]"}`);
});
test('K19: człon wyliczenia z prefiksem „48" bez plusa — maskowany cały numer, bez ogona cyfr', () => {
  const cases: [string, string][] = [
    ['tel. 601 222 333 lub 48 602 333 444', 'tel. [TELEFON] lub [TELEFON]'],
    ['tel. 601 222 333 / 48-602-333-444', 'tel. [TELEFON] / [TELEFON]'],
    ['tel. 601 222 333 / 48 602333444', 'tel. [TELEFON] / [TELEFON]'],
    ['tel. 601 222 333; 48 22 123 45 67', 'tel. [TELEFON]; [TELEFON]'],
    ['tel. 512345678, 48 601 234 567', 'tel. [TELEFON], [TELEFON]'],
    ['tel. 512 345 678 i 48-601-234-567', 'tel. [TELEFON] i [TELEFON]'],
    // odstępy wokół separatora zostają takie jak w tekście
    ['tel.  601 222 333  lub   602 333 444', 'tel.  [TELEFON]  lub   [TELEFON]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});
test('K06: imię kończące wpis listy „Nazwisko Imię" nie skleja go z osobą z następnego wiersza', () => {
  // wpis nad maską to osobna osoba — w masce w całości, wiersze się nie sklejają
  expect(redactPII('Sowa Przemysław\nPawlak Wiesław').redacted).toBe('[IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO]');
  // komórki CSV/TSV: osobne maski tej samej osoby, liczba kolumn bez zmian
  expect(redactPII('Sowa;Przemysław\nPawlak;Wiesław').redacted).toBe('[IMIĘ I NAZWISKO];[IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO];Wiesław');
  expect(redactPII('Wróbel\tAnna\nNowak Jan').redacted).toBe('[IMIĘ I NAZWISKO]\t[IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO]');
  expect(redactPII('Obecni: Lis Marek\nNowak Piotr').redacted).toBe('Obecni: [IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO]');
  expect(redactPII('Kowal Jan\nNowak Anna').redacted).toBe('[IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO]');
  expect(redactPII('Sowa Przemysław\nPawlak Wiesław', { pseudonyms: true }).redacted).toBe('[OSOBA-A]\n[OSOBA-B]');
  expect(redactPII('Sowa;Przemysław\nPawlak;Wiesław', { pseudonyms: true }).redacted).toBe('[OSOBA-A];[OSOBA-A]\n[OSOBA-B];Wiesław');
  // lista 10 osób zostaje listą 10 wierszy; homografy nad potwierdzoną osobą nie zostają jawne
  const lista =
    'Wróbel Katarzyna\nZając Paweł\nSowa Przemysław\nPawlak Wiesław\nKubiak Renata\nMazur Grzegorz\nSikora Anna\nWilk Bartosz\nNowak Barbara\nLis Jakub';
  const r = redactPII(lista).redacted;
  expect(r.split('\n')).toHaveLength(10);
  for (const w of ['Wróbel', 'Katarzyna', 'Zając', 'Sowa', 'Przemysław', 'Wilk', 'Bartosz']) expect(r, w).not.toContain(w);
  expect(redactPII(r).redacted).toBe(r); // idempotencja
});
test('K06: nagłówek wpisu listy musi być nazwiskiem — czasownik, przyimek czy funkcja nie odsłaniają imienia', () => {
  const cases: [string, string][] = [
    ['Sporządził Jan\nKowalski', 'Sporządził [IMIĘ I NAZWISKO]'],
    ['Od Jana\nKowalskiego', 'Od [IMIĘ I NAZWISKO]'],
    ['Dla Anny\nNowak', 'Dla [IMIĘ I NAZWISKO]'],
    ['Przez Jana\nKowalskiego', 'Przez [IMIĘ I NAZWISKO]'],
    ['Lekarz Anna\nNowak', 'Lekarz [IMIĘ I NAZWISKO]'],
    ['Wnioskodawczyni Anna\nNowak', 'Wnioskodawczyni [IMIĘ I NAZWISKO]'],
    ['Pozdrawiam Anna\nKowalska', 'Pozdrawiam [IMIĘ I NAZWISKO]'],
    ['Kontakt, Jan\nKowalski', 'Kontakt, [IMIĘ I NAZWISKO]'],
    ['Faktura\tJan\nKowalski', 'Faktura\t[IMIĘ I NAZWISKO]'],
    ['Odbiorca Anna\nKowalska, ul. Długa 5', 'Odbiorca [IMIĘ I NAZWISKO], [ADRES]'],
    ['Protokolant: Stażysta Paweł\nNowicki', 'Protokolant: Stażysta [IMIĘ I NAZWISKO]'],
    ['Sporządził: Technik Jan\nWiśniewski', 'Sporządził: Technik [IMIĘ I NAZWISKO]'],
    ['Żona Anna\nKowalska, w 1/2 części,', 'Żona [IMIĘ I NAZWISKO], w 1/2 części,'],
    ['5. Zarządca Piotr\nWiśniewski (spoza wspólnoty)', '5. Zarządca [IMIĘ I NAZWISKO] (spoza wspólnoty)'],
    ['Powódka Maria\nKowalska, zam. w Krakowie', 'Powódka [IMIĘ I NAZWISKO], zam. w [MIEJSCOWOŚĆ]'],
    ['Protokolant Anna\nNowak', 'Protokolant [IMIĘ I NAZWISKO]'],
    // dzień tygodnia z listy homografów to grafik, nie nazwisko
    ['Środa Anna\nKowalska', 'Środa [IMIĘ I NAZWISKO]'],
    ['Sołtys Jan\nKowalski', 'Sołtys [IMIĘ I NAZWISKO]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});
test('K06 pułapki: łamanie wiersza w prozie i podpisie nadal domyka osobę', () => {
  const cases: [string, string][] = [
    ['Jan\nWiśniewski złożył wniosek.', '[IMIĘ I NAZWISKO] złożył wniosek.'],
    ['Starosta Jan\nWiśniewski przeprowadził kontrolę.', 'Starosta [IMIĘ I NAZWISKO] przeprowadził kontrolę.'],
    ['protokół\nKowalski podpisał.', 'protokół\n[IMIĘ I NAZWISKO] podpisał.'],
    ['Z poważaniem\nJan\nKowalski', 'Z poważaniem\n[IMIĘ I NAZWISKO]'],
    ['Wnioskodawca Anna\nNowak', 'Wnioskodawca [IMIĘ I NAZWISKO]'],
    ['Anna Maria\nKowalska podpisała.', '[IMIĘ I NAZWISKO] podpisała.'],
    ['Dyrektor Anna Maria\nKowalska podpisała.', 'Dyrektor [IMIĘ I NAZWISKO] podpisała.'],
    ['Wczoraj Jan\nKowalski złożył wniosek.', 'Wczoraj [IMIĘ I NAZWISKO] złożył wniosek.'],
    ['Wczoraj Jan\nKowalski.', 'Wczoraj [IMIĘ I NAZWISKO].'],
    ['Wójt Gminy: Jan\nKowalski\n', 'Wójt Gminy: [IMIĘ I NAZWISKO]\n'],
    ['Świadek, Jan\nKowalski, zeznał.', 'Świadek, [IMIĘ I NAZWISKO], zeznał.'],
    ['Pracownik: Anna\nNowak\n', 'Pracownik: [IMIĘ I NAZWISKO]\n'],
    ['Barbara\nz Nowaków była obecna.', '[IMIĘ I NAZWISKO] była obecna.'],
    ['Przemysław Sowa\nWiesław Pawlak\n', '[IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO]\n'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
});

test('K04: dosłowne ucieczki „\\n"/„\\t" w JSON-ie nie sklejają się z daną; wynik się parsuje', () => {
  const cases: [string, string][] = [
    [String.raw`{"opis": "Dane:\n85031412347"}`, String.raw`{"opis": "Dane:\n[PESEL]"}`],
    [String.raw`{"opis": "PESEL:\n85031412347"}`, String.raw`{"opis": "PESEL:\n[PESEL]"}`],
    [String.raw`{"opis": "\t85031412347"}`, String.raw`{"opis": "\t[PESEL]"}`],
    [String.raw`{"opis": "Zgłosił:\nKowalski Jan"}`, String.raw`{"opis": "Zgłosił:\n[IMIĘ I NAZWISKO]"}`],
    [String.raw`{"opis": "\nAnna Nowak"}`, String.raw`{"opis": "\n[IMIĘ I NAZWISKO]"}`],
    [String.raw`{"opis": "Jan\tKowalski\tWarszawa"}`, String.raw`{"opis": "[IMIĘ I NAZWISKO]\tWarszawa"}`],
    [String.raw`{"opis": "Adres:\nul. Lipowa 4"}`, String.raw`{"opis": "Adres:\n[ADRES]"}`],
    [String.raw`{"opis": "Ulica:\nul. Jana Pawła II 12"}`, String.raw`{"opis": "Ulica:\n[ADRES]"}`],
    [String.raw`{"opis": "Dowód:\nABA300000"}`, String.raw`{"opis": "Dowód:\n[NR-DOWODU]"}`],
    // maska e-maila nie zjada litery ucieczki (dawniej „\[EMAIL]" — JSON.parse: Bad escaped character)
    [String.raw`{"opis": "E-mail:\njan.kowalski@example.com"}`, String.raw`{"opis": "E-mail:\n[EMAIL]"}`],
    // ucieczka kończy adres URL — nazwisko za nią nie chowa się w linku
    [String.raw`{"opis": "Link: https://example.com/x\nKowalski Jan"}`, String.raw`{"opis": "Link: https://example.com/x\n[IMIĘ I NAZWISKO]"}`],
  ];
  for (const [t, want] of cases) {
    const r = redactPII(t).redacted;
    expect(r, t).toBe(want);
    expect(() => JSON.parse(r), t).not.toThrow();
    expect(redactPII(r).redacted, t).toBe(r);
  }
  expect(redactPII(String.raw`log: msg=Zgłosił:\nKowalski Jan`).redacted).toBe(String.raw`log: msg=Zgłosił:\n[IMIĘ I NAZWISKO]`);
});
test('K04 pułapki: ścieżki Windows, kod źródłowy i ucieczki bez danych zostają bez zmian', () => {
  keep([
    String.raw`{"sciezka": "C:\\Users\\Public\\nowe\\raport.docx"}`,
    String.raw`{"sciezka": "C:\\nowy\\Tomasz\\plik.txt"}`,
    String.raw`Ścieżka C:\Users\Public\nowe\raport.docx oraz C:\temp\new\Raport2024.txt`,
    String.raw`console.log("Suma:\n" + total); printf("Wynik:\t%d\n", x);`,
    String.raw`\textbf{Ważne}: \noindent Umowa zawarta w Warszawie.`,
    String.raw`{"wzorzec": "\\u0142"}`,
    String.raw`{"msg": "Uwaga:\nTermin rozprawy 15.03.2024\nSala 12"}`,
    String.raw`{"opis": "Faktura nr 123/2024\nRazem: 1500 zł\tVAT 23%"}`,
    String.raw`{"opis": "Patron szkoły:\nJan Paweł II"}`,
    String.raw`{"opis": "Dziękujemy!\nZespół Parawan"}`,
    String.raw`{"opis": "Lista:\n- Mleko\n- Chleb\n- Masło"}`,
    String.raw`{"opis": "Miesiące:\tStyczeń\tLuty\tMarzec"}`,
    String.raw`{"opis": "Pogoda:\nZima była mroźna\nWiosna przyszła późno"}`,
    String.raw`{"opis": "Wyrok SN z 12.03.2020\nIII CZP 1/20"}`,
    // kontekst złożenia/eponimu i etykieta administracyjna widzą ucieczkę jak nową linię
    String.raw`{"opis": "Uniwersytet Adama\nMickiewicza"}`,
    String.raw`{"opis": "choroba\nLeśniowskiego-Crohna"}`,
    String.raw`{"opis": "Powiat:\nPruszkowski"}`,
    String.raw`regex: /\d{11}/ oraz "\n\n" i '\t' w kodzie`,
  ]);
  // login w ścieżce UNC/Windows to nie ucieczka („\h", „\U" nie są ucieczkami JSON) — nadal maskowany
  expect(redactPII(String.raw`Udział: \\FS01\home$\tkaminski i login: tkaminski`).redacted).toBe(
    String.raw`Udział: \\FS01\home$\[LOGIN] i login: [LOGIN]`,
  );
  expect(redactPII(String.raw`Plik: C:\Users\tkaminski\Desktop, Login: tkaminski`).redacted).toBe(
    String.raw`Plik: C:\Users\[LOGIN]\Desktop, Login: [LOGIN]`,
  );
});
test('K04: JSON zagnieżdżony w łańcuchu („\\"klucz\\"") — klucze osobowe wewnątrz maskowane', () => {
  const t = String.raw`{"payload":"{\"imie\":\"Jadwiga\",\"nazwisko\":\"Gżegżółka\",\"miasto\":\"Słupsk\"}"}`;
  const r = redactPII(t).redacted;
  expect(r).toBe(String.raw`{"payload":"{\"imie\":\"[IMIĘ I NAZWISKO]\",\"nazwisko\":\"[IMIĘ I NAZWISKO]\",\"miasto\":\"[MIEJSCOWOŚĆ]\"}"}`);
  expect(JSON.parse(JSON.parse(r).payload)).toEqual({ imie: '[IMIĘ I NAZWISKO]', nazwisko: '[IMIĘ I NAZWISKO]', miasto: '[MIEJSCOWOŚĆ]' });
  // podwójna ucieczka (JSON w łańcuchu w łańcuchu)
  expect(redactPII(String.raw`{"a":"{\\\"nazwisko\\\":\\\"Kowalski\\\"}"}`).redacted).toBe(
    String.raw`{"a":"{\\\"nazwisko\\\":\\\"[IMIĘ I NAZWISKO]\\\"}"}`,
  );
  expect(redactPII(String.raw`msg="{\"lastName\":\"Kowalski\",\"firstName\":\"Jan\"}"`).redacted).toBe(
    String.raw`msg="{\"lastName\":\"[IMIĘ I NAZWISKO]\",\"firstName\":\"[IMIĘ I NAZWISKO]\"}"`,
  );
});
test('K04 pułapki: zagnieżdżony JSON bez danych osobowych i polecenia z „\\"" bez zmian', () => {
  keep([
    String.raw`{"payload":"{\"name\":\"Parawan Pro\",\"miasto\":\"brak\",\"status\":\"ok\"}"}`,
    String.raw`{"payload":"{\"name\":\"Urząd Skarbowy w Słupsku\",\"opis\":\"Spotkanie w Gdańsku\"}"}`,
    String.raw`{"payload":"{\"imie\":\"\",\"nazwisko\":null,\"miasto\":\"-\"}"}`,
    String.raw`sed 's/\"nazwisko\":\"[^\"]*\"/X/' plik.json`,
    String.raw`{"query":"SELECT * FROM t WHERE \"name\" = 'x'"}`,
    String.raw`{"payload":"{\"name\":\"Ustawa o ochronie danych\",\"opis\":\"Spółka Kowalczyk-Trans Sp. z o.o.\"}"}`,
    '{"name":"Parawan Pro","miasto":"brak","opis":"Spotkanie w Gdańsku"}',
  ]);
});

test('K17: maska w miejscu liczby JSON dostaje cudzysłowy — wynik dalej się parsuje', () => {
  const cases: [string, string][] = [
    ['{"telefon": 512345678}', '{"telefon": "[TELEFON]"}'],
    ['{"pesel": 44051401359}', '{"pesel": "[PESEL]"}'],
    ['{"nip": 5260250274}', '{"nip": "[NIP]"}'],
    ['{"id": 85031412347}', '{"id": "[PESEL]"}'],
    ['{"telefon": [512345678, 601234567]}', '{"telefon": ["[TELEFON]", "[TELEFON]"]}'],
    ['[601234567, 512345678]', '["[TELEFON]", "[TELEFON]"]'],
    ['{"klient_id": 7, "pesel": 85031412347, "telefon": 601234567}', '{"klient_id": 7, "pesel": "[PESEL]", "telefon": "[TELEFON]"}'],
    [
      '{\n  "klient": {\n    "pesel": 85031412347,\n    "telefon": 601234567\n  }\n}',
      '{\n  "klient": {\n    "pesel": "[PESEL]",\n    "telefon": "[TELEFON]"\n  }\n}',
    ],
    ['{\r\n  "telefon": 512345678\r\n}', '{\r\n  "telefon": "[TELEFON]"\r\n}'],
    // NDJSON: każdy wiersz to osobny obiekt
    ['{"telefon": 512345678}\n{"telefon": 601234567}', '{"telefon": "[TELEFON]"}\n{"telefon": "[TELEFON]"}'],
    // maska wewnątrz łańcucha i zwykła wartość tekstowa — bez dodatkowych cudzysłowów
    [
      '{"kwota": 1250.50, "telefon": 601234567, "uwagi": "tel. 601 222 333"}',
      '{"kwota": 1250.50, "telefon": "[TELEFON]", "uwagi": "tel. [TELEFON]"}',
    ],
    ['{"lista": ["Jan Kowalski", 85031412347, "x"]}', '{"lista": ["[IMIĘ I NAZWISKO]", "[PESEL]", "x"]}'],
  ];
  for (const [t, want] of cases) {
    const r = redactPII(t).redacted;
    expect(r, t).toBe(want);
    for (const line of r.trim().split(/\r?\n(?=[[{])/)) expect(() => JSON.parse(line), t).not.toThrow();
    expect(redactPII(r).redacted, t).toBe(r);
  }
  // własna maska z cudzysłowem — poprawnie ucieczona
  expect(redactPII('{"telefon": 512345678}', { masks: { TELEFON: '<"tel">' } }).redacted).toBe('{"telefon": "<\\"tel\\">"}');
});
test('K17 pułapki: proza, nie-JSON i wartości w cudzysłowach bez dokładania cudzysłowów', () => {
  const cases: [string, string][] = [
    ['{"pesel": "85031412347"}', '{"pesel": "[PESEL]"}'],
    ["{'telefon': 512345678}", "{'telefon': [TELEFON]}"], // to nie JSON
    ['Pole "Telefon": 512 345 678', 'Pole "Telefon": [TELEFON]'],
    ['Lista: [601234567]', 'Lista: [[TELEFON]]'],
    ['Kontakt: {"telefon": 512345678}', 'Kontakt: {"telefon": [TELEFON]}'], // JSON osadzony w prozie — poza zakresem
    ['{"opis": "tel. 512345678, dzwonić rano"}', '{"opis": "tel. [TELEFON], dzwonić rano"}'],
    [String.raw`{"opis": "tel. \"601234567\" w notatce", "id": 7}`, String.raw`{"opis": "tel. \"[TELEFON]\" w notatce", "id": 7}`],
    ['<Phone>512345678</Phone>', '<Phone>[TELEFON]</Phone>'],
    ['telefon: 512345678', 'telefon: [TELEFON]'],
  ];
  for (const [t, want] of cases) expect(redactPII(t).redacted, t).toBe(want);
  keep(['{"telefon": "[TELEFON]"}', '[1, 2, 3]', '{"klient_id": 7, "kwota": 1250.50, "rok": 2024, "aktywny": true, "uwagi": null}']);
});

// ── Audyt, partia b2: nadmaskowanie numerów (telefon, tablica, IBAN, login, IP, MAC, e-mail, znak) ──
const masked = (cases: [string, string][], opts?: Parameters<typeof redactPII>[1]): void => {
  for (const [t, want] of cases) expect(redactPII(t, opts).redacted, t).toBe(want);
};
test('K01: kolumna liczb, komórki TSV i wnętrze identyfikatora nie są telefonem', () => {
  keep([
    'Ilość\n120\n340\n560\nRazem 1020',
    '120\t340\t560',
    'Sale:\n101\n102\n103',
    'Numer przesyłki: RR123456789PL',
    'Faktura FV/2026/123456789',
    'SKU 123456789A',
    'EE123456789PL',
    'ZAM-123456789',
    'ZAM_123456789',
    'LOT123456789',
    'sklep/order/123456789/item',
    'VAT-UE nabywcy: DE811569869',
    'NL812345678B01',
    'Kwota 120 340 560 zł',
  ]);
});
test('K01 pułapki: lista numerów, numer po małej literze i kotwica dalej dają [TELEFON]', () => {
  masked([
    ['Numery 500600700/501601701', 'Numery [TELEFON]/[TELEFON]'],
    ['Telefony:\n-500600700\n-501601701', 'Telefony:\n-[TELEFON]\n-[TELEFON]'],
    ['tel./fax 500600700/501601701', 'tel./fax [TELEFON]/[TELEFON]'],
    ['dzwoń512345678', 'dzwoń[TELEFON]'],
    ['Tel500600700', 'Tel[TELEFON]'],
    ['Proszę dzwonić 512 345 678 po 16.', 'Proszę dzwonić [TELEFON] po 16.'],
    ['Biuro (22) 123 45 67 czynne.', 'Biuro [TELEFON] czynne.'],
    ['Kontakt:\n512 345 678\n601 234 567', 'Kontakt:\n[TELEFON]\n[TELEFON]'],
  ]);
});
test('K08: data z godziną po kotwicy telefonu nie jest numerem', () => {
  keep([
    'Kontakt telefoniczny 03.10.2026 9:45 – brak odpowiedzi.',
    'Data i godzina kontaktu: 3.10.2026 10:15',
    'Ostatni kontakt: 2026-10-14 9:05',
    'Telefon 3.10.2026 10:15',
    'Tel. 2026.10.14 9:05',
    'tel. 12.10.2026 9',
  ]);
  masked([
    ['tel. 512.345.678', 'tel. [TELEFON]'],
    ['tel. 12.345.67.89', 'tel. [TELEFON]'],
    ['kom. 512-345-678 oraz 601.234.567', 'kom. [TELEFON] oraz [TELEFON]'],
    ['Telefon: +48 512 345 678', 'Telefon: [TELEFON]'],
    ['Kontakt telefoniczny 12.10.2026 9:45 pod numerem 512 345 678', 'Kontakt telefoniczny 12.10.2026 9:45 pod numerem [TELEFON]'],
  ]);
});
test('K26: kwota bez kotwicy — waluta (też twarda spacja), grosze, mnożnik, ogon miliarda', () => {
  keep([
    'Kwota: 150\u00A0000\u00A0000\u00A0zł',
    'Kwota: 150\u00A0000\u00A0000,00\u00A0zł',
    'Kwota: 150\u202F000\u202F000\u202FPLN',
    'Dochody bieżące: 534 210 987,55',
    'Wartość: 1 234 567 890',
    'Opłata: 123 456 789 pln',
    'liczba transakcji: 300 000 000 rocznie',
    'Wartość: 125 450 300 CHF',
    'Wartość: 125 450 300 euro',
    'Wartość: 125 450 300 €',
    'PLN 125 450 300',
    '€125 450 300',
    '125 450 300 tys. zł',
    '125 450 300 mln',
    'Kwota 125 450 300,5',
    'Wartość 125 450 300 Kč',
    '| 600 Transport | 412 345 678,00 | 398 765 432,10 | 96,7 |',
  ]);
  // granica waluty: „EUROPA" to nie „EUR" — numer dawniej wyciekał
  masked([['601 234 567 EUROPA', '[TELEFON] EUROPA']]);
});
test('K26 pułapki: CSV, lista po przecinku, godzina, „Złotów" i numer po innej kwocie dalej maskowane', () => {
  masked([
    ['Numery 512 345 678,601 234 567', 'Numery [TELEFON],[TELEFON]'],
    ['Kowalski,Jan,512345678,34', '[IMIĘ I NAZWISKO],Jan,[TELEFON],34'],
    ['Jan,Kowalski,512 345 678,25,Warszawa', 'Jan,[IMIĘ I NAZWISKO],[TELEFON],25,Warszawa'],
    ['Numer 512 345 678, 12 osób czeka.', 'Numer [TELEFON], 12 osób czeka.'],
    ['2024-03-12 14:22 512 345 678', '2024-03-12 14:22 [TELEFON]'],
    // zero międzymiastowe po kotwicy należy do numeru (K13), dawniej zostawało jawne przed maską
    ['tel. 0 512 345 678', 'tel. [TELEFON]'],
    ['Zadzwoń 600 700 800, zła wiadomość', 'Zadzwoń [TELEFON], zła wiadomość'],
    ['Kwota 512 345 678\nzł', 'Kwota [TELEFON]\nzł'],
    ['tel. 500 000 000', 'tel. [TELEFON]'],
    ['Abonament 49 zł 600 100 200', 'Abonament 49 zł [TELEFON]'],
    ['601 234 567 Złotów', '[TELEFON] Złotów'],
    ['Numer: 48 512 345 678', 'Numer: 48 [TELEFON]'],
    // etykieta identyfikatora przed grupami cyfr: to nie ogon kwoty; PESEL rozbity spacjami bierze
    // w całości przebieg PESEL-u (K30)
    ['Numer PESEL: 85 110 314 283', 'Numer PESEL: [PESEL]'],
  ]);
});
test('K27: etykieta numeru seryjnego, zamówienia, zlecenia, faktury i infolinia 800/801 — bez [TELEFON]', () => {
  keep([
    'Nr seryjny urządzenia: 512345678\nNumer zamówienia: 302114587',
    'Numer seryjny urządzenia 512345678',
    'Zamówienie #302114587',
    'Nr ogłoszenia 512 778 330.',
    'S/N: 601 222 333',
    '(build 512345678)',
    'Nr zlecenia: 240611123\nKod próbki: 512345678',
    'Nr faktury: 123456789',
    'Kod kreskowy: 512345678',
    'Nr zlecenia 240-611-123',
    'Numer referencyjny: 512345678',
    'Infolinia sklepu: 801 300 400',
    'infolinia 801 234 567, bezpłatna 800 100 200',
    'Infolinia 801300400 czynna 8-16.',
  ]);
});
test('K27 pułapki: telefon przy słowach „zamówień", „klienta", „pacjenta" i po kotwicy zostaje maską', () => {
  masked([
    ['Telefon do działu zamówień: 512 345 678', 'Telefon do działu zamówień: [TELEFON]'],
    ['Numer: 512345678', 'Numer: [TELEFON]'],
    ['Nr kontaktowy: 512345678', 'Nr kontaktowy: [TELEFON]'],
    ['Nr telefonu zleceniodawcy: 512345678', 'Nr telefonu zleceniodawcy: [TELEFON]'],
    ['ID pacjenta: 512345678', 'ID pacjenta: [TELEFON]'],
    ['Nr klienta: 512345678', 'Nr klienta: [TELEFON]'],
    ['Kod próbki: ABC, kontakt 512345678', 'Kod próbki: ABC, kontakt [TELEFON]'],
    ['Wyrok SN 512 345 678', 'Wyrok SN [TELEFON]'],
    ['Numer zamówienia: 302114587, tel. 512 345 678', 'Numer zamówienia: 302114587, tel. [TELEFON]'],
    ['Mój numer: 501 300 400', 'Mój numer: [TELEFON]'],
    ['REGON: 801300400', 'REGON: [REGON]'],
    ['Dzwoń 508 001 234.', 'Dzwoń [TELEFON].'],
    ['Nr zamówień telefonicznych: 512 345 678', 'Nr zamówień telefonicznych: [TELEFON]'],
  ]);
});
test('K12: tablica — doklejone „Auto", skróty techniczne, jednostki, normy i słowa prozy po „rejestracyjny"', () => {
  keep([
    'Rysunki wykonano w programie AutoCAD 2024.',
    'Autodesk AutoCAD LT 2024 – licencja roczna.',
    'Samochód ciężarowy o DMC 3500 kg.',
    'Pojazd o DMC3500 kg',
    'Na tablicy UN 1203 widniał numer materiału.',
    'Pojazd przewożący materiały UN 1203 musi być oznakowany.',
    'Samochód w kolorze białym RAL 9003.',
    'Samochód o mocy wg DIN 70020 wynosi 160 KM.',
    'Opony samochodu: DOT 3719.',
    'Pojazd zgodny z normą EN 12195-1 w zakresie mocowania ładunku.',
    'Pojazd podlega rozporządzeniu WE 1071/2009.',
    'Przyczepa homologowana wg dyrektywy WE 2007/46.',
    'Motocykl KTM 1290 Super Duke R.',
    'Samochód marki Dodge RAM 1500, rok 2020.',
    'Samochód FSO 1500 sprzedano.',
    'Opłata za tablice rejestracyjne od 2025 r. wynosi 135,50 zł.',
    'Wymiana tablic rejestracyjnych do 2027 roku jest bezpłatna.',
    'Opłata rejestracyjna to 1500 zł.',
    'Tablice rejestracyjne dla 2000 pojazdów.',
    'Formularz rejestracyjny NR 2024 dla uczestnika.',
    'Tablica nr 12345 wisi przy wejściu.',
  ]);
  masked([
    ['Ciągnik: nr rej. WGM 12345, DMC 18000 kg, ładowność 24 t.', 'Ciągnik: nr rej. [NR-REJESTRACYJNY], DMC 18000 kg, ładowność 24 t.'],
    ['Cysterna nr rej. KR 12345 oraz UN 1203 na tablicy ostrzegawczej.', 'Cysterna nr rej. [NR-REJESTRACYJNY] oraz UN 1203 na tablicy ostrzegawczej.'],
  ]);
});
test('K12 pułapki: prawdziwe tablice po kotwicach i w wyliczeniach maskowane jak dotąd', () => {
  const R = '[NR-REJESTRACYJNY]';
  masked([
    ['Pojazd o nr rej. DMC 3500 zatrzymano.', `Pojazd o nr rej. ${R} zatrzymano.`],
    ['Zabezpieczono pojazdy: WW 1234A, ZS 4567, WE 123AB, PO 5AB67, KR 8XY90, DW 12345, WGM 1234.', `Zabezpieczono pojazdy: ${R}, ${R}, ${R}, ${R}, ${R}, ${R}, ${R}.`],
    ['Motocykl ZS 4567 skradziono.', `Motocykl ${R} skradziono.`],
    ['Samochód marki Toyota WE 12345', `Samochód marki Toyota ${R}`],
    ['Na parkingu stały też GD 707GG oraz PZE 5U678.', `Na parkingu stały też ${R} oraz ${R}.`],
    // K43: ukośnik to separator wyliczenia — druga tablica zestawu nie zostaje jawna
    ['Zestaw: ciągnik WGM1234A/WGM5678B wjechał na plac.', `Zestaw: ciągnik ${R}/${R} wjechał na plac.`],
    ['Samochód: WX 1234A-ZŁY', `Samochód: ${R}-ZŁY`],
    ['Auto WE 12345 stało przed domem.', `Auto ${R} stało przed domem.`],
    ['Auto-WE12345 odholowano.', `Auto-${R} odholowano.`],
    ['Samochód o nr rej. WA 12345 o DMC 3500 kg.', `Samochód o nr rej. ${R} o DMC 3500 kg.`],
    ['Samochód nr rej. WA 12345, WGM 1234 i ZS 4567.', `Samochód nr rej. ${R}, ${R} i ${R}.`],
    ['Nr rejestracyjny:\nWI1234K', `Nr rejestracyjny:\n${R}`],
    ['NR REJ. WA12345', `NR REJ. ${R}`],
    ['NUMER REJESTRACYJNY: KRA 1234', `NUMER REJESTRACYJNY: ${R}`],
    ['nr rej. wa12345', `nr rej. ${R}`],
    ['Pojazd UB 12345 jednostki wojskowej.', `Pojazd ${R} jednostki wojskowej.`],
    ['Samochód ER 12345 i EL 1234A.', `Samochód ${R} i ${R}.`],
    ['Pojazd DW 12345, DMC 3500 kg.', `Pojazd ${R}, DMC 3500 kg.`],
  ]);
});
test('K14: IBAN nie połyka wyrazów WERSALIKAMI po numerze; „PL" ze spacją pod maską', () => {
  const K = '[NR-KONTA]';
  masked([
    ['Przelew na DE89 3704 0044 0532 0130 00 Z OPCJĄ SHA', `Przelew na ${K} Z OPCJĄ SHA`],
    ['PRZELEW NA GB29NWBK60161331926819 Z TYTUŁEM', `PRZELEW NA ${K} Z TYTUŁEM`],
    ['Przelew na DE89 3704 0044 0532 0130 00 W EUR', `Przelew na ${K} W EUR`],
    ['PRZELEW NA FR14 2004 1010 0505 0001 3M02 606 Z TYTUŁEM', `PRZELEW NA ${K} Z TYTUŁEM`],
    ['Przelew na PL61 1090 1014 0000 0712 1981 2874 Z OPCJĄ SHA', `Przelew na ${K} Z OPCJĄ SHA`],
    ['IBAN: DE89 3704 0044 0532 0130 00 Z OPCJĄ SHA', `IBAN: ${K} Z OPCJĄ SHA`],
    ['Konto odbiorcy: DE89 3704 0044 0532 0130 00 Z TYTUŁEM ZWROTU', `Konto odbiorcy: ${K} Z TYTUŁEM ZWROTU`],
    ['Na rachunek GB29 NWBK 6016 1331 9268 19 W GBP.', `Na rachunek ${K} W GBP.`],
    ['IBAN: PL57 1140 2004 0000 3002 0123 4567 PKO BP', `IBAN: ${K} PKO BP`],
    ['RACHUNEK PL57 1140 2004 0000 3002 0123 4567 A KWOTA 100 EUR', `RACHUNEK ${K} A KWOTA 100 EUR`],
    ['IBAN PL57 1140 2004 0000 3002 0123 4567 SWIFT BPKOPLPW', `IBAN ${K} SWIFT BPKOPLPW`],
    ['IBAN: GB29 NWBK 6016 1331 9268 19 BIC NWBKGB2L', `IBAN: ${K} BIC NWBKGB2L`],
    ['Konto: PL57 1140 2004 0000 3002 0123 4567 PLN', `Konto: ${K} PLN`],
    ['Przelew na PL57 1140 2004 0000 3002 0123 4567 PKO BP', `Przelew na ${K} PKO BP`],
    ['na rachunek nr PL 92 1050 0099 0000 1234 5678 9012', `na rachunek nr ${K}`],
    ['na rachunek nr PL 92105000990000123456789012', `na rachunek nr ${K}`],
    // zła suma przy silnej etykiecie: dawniej wyciek całości
    ['IBAN: PL 92 1050 0099 0000 1234 5678 9013', `IBAN: ${K}`],
    ['Nr konta: PL 92 1050 0099 0000 1234 5678 9013', `Nr konta: ${K}`],
    ['Wpłata PL92105000990000123456789012 PLN', `Wpłata ${K} PLN`],
    ['Konto: PL 92 1050 0099 0000 1234 5678 9012, BIC: INGBPLPW', `Konto: ${K}, BIC: INGBPLPW`],
    ['{"iban": "PL 92 1050 0099 0000 1234 5678 9012"}', `{"iban": "${K}"}`],
    // IBAN Seszeli kończy się kodem waluty — to część numeru
    ['SC18 SSCB 1101 0000 0000 0000 1497 USD', K],
  ]);
});
test('K14 pułapki: nazwa banku, NIP UE, kody i normy WERSALIKAMI bez zmian', () => {
  masked([
    ['Rachunek bankowy PKO BP 92 1050 0099 0000 1234 5678 9012', 'Rachunek bankowy PKO BP [NR-KONTA]'],
    ['Konto w banku Pekao SA 92 1050 0099 0000 1234 5678 9012', 'Konto w banku Pekao SA [NR-KONTA]'],
    ['NIP UE: PL 5260250274, VAT-UE PL5260250274', 'NIP UE: [NIP], VAT-UE [NIP]'],
  ]);
  keep([
    'Model AB12 CDEF GHIJ KLMN XYZ',
    'SWIFT BREXPLPWXXX, przelew SEPA W EUR',
    'Norma PN EN ISO 9001 2015 Z ZAKRESU JAKOŚCI',
    'PL 2024 roku nie było zmian',
    'Numer AB12 3456 7890 1234 5 X do zamówienia',
    'Kod produktu XY12 ABCD EFGH IJKL MNOP Z OKŁADKĄ',
    'Faktura FV12 3456 7890 1234 W PLN do zapłaty',
    'Zamówienie ZA20 2400 1234 5678 9 A B C',
  ]);
});
test('K15: login „DOMENA\\użytkownik" maskowany w całości; domena w prozie zostaje', () => {
  masked([
    ['Nazwa użytkownika: POLMEX\\mlewandowska\nKonto założono w domenie POLMEX dla działu kadr.', 'Nazwa użytkownika: [LOGIN]\nKonto założono w domenie POLMEX dla działu kadr.'],
    ['Login: FIRMA\\jkowalski', 'Login: [LOGIN]'],
    ['Login: CORP\\jkowalski\nFirma CORP zatrudnia 50 osób.', 'Login: [LOGIN]\nFirma CORP zatrudnia 50 osób.'],
    ['Login: ad.firma.local\\jnowak', 'Login: [LOGIN]'],
    ['Username: firma\\pwisniewski', 'Username: [LOGIN]'],
    ['Użytkownik "CORP\\jkowalski" zgłosił problem.', 'Użytkownik "[LOGIN]" zgłosił problem.'],
    ['{"userName": "FIRMA\\\\akowalski"}', '{"userName": "[LOGIN]"}'],
    ['<UserName>FIRMA\\mlewandowska</UserName>', '<UserName>[LOGIN]</UserName>'],
    // propagacja: pełny token i sama nazwa użytkownika — nigdy sama domena
    ['Login: FIRMA\\jkowalski\nZdarzenie 4624: konto FIRMA\\jkowalski, profil C:\\Users\\jkowalski\\Desktop', 'Login: [LOGIN]\nZdarzenie 4624: konto [LOGIN], profil C:\\Users\\[LOGIN]\\Desktop'],
  ]);
  expect(() => JSON.parse(redactPII('{"userName": "FIRMA\\\\akowalski"}').redacted)).not.toThrow();
});
test('K15 pułapki: ścieżki, udziały, konta wbudowane Windows i etykiety bez wartości bez zmian', () => {
  keep([
    'Na serwerze POLMEX\\SQL01 działa baza kadrowa.',
    'Ścieżka: C:\\Users\\Public\\Documents',
    'Udział sieciowy: \\\\POLMEX\\kadry\\raporty',
    'Domena: POLMEX\nKonto założono w domenie POLMEX dla działu kadr.',
    'Login: brak',
    'Login:\nHasło:',
    'Użytkownik loguje się w formacie DOMENA\\login.',
    'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'User: NT AUTHORITY\\SYSTEM',
    '<UserName>NT AUTHORITY\\SYSTEM</UserName>',
    'User: BUILTIN\\Administrators',
    '<UserName>BUILTIN\\Administrators</UserName>',
    'Wzorzec kodu: \\d{2}-\\d{3}',
  ]);
});
test('K24: konta generyczne nie rozlewają się na prozę; login przed kropką końca zdania maskowany', () => {
  masked([
    ['Login: admin\nPo zalogowaniu do panelu admin zmień domyślne hasło.', 'Login: [LOGIN]\nPo zalogowaniu do panelu admin zmień domyślne hasło.'],
    ['user=root\ncmd=/root/backup.sh', 'user=[LOGIN]\ncmd=/root/backup.sh'],
    ['Login: test\nŚrodowisko test zostało wyłączone.', 'Login: [LOGIN]\nŚrodowisko test zostało wyłączone.'],
    ['User: system\nZaktualizuj system przed instalacją.', 'User: [LOGIN]\nZaktualizuj system przed instalacją.'],
    ['Obraz Dockera: postgres:16-alpine\nuser: postgres', 'Obraz Dockera: postgres:16-alpine\nuser: [LOGIN]'],
    ['Użytkownik "admin" ma dostęp. Panel admin jest w sieci.', 'Użytkownik "[LOGIN]" ma dostęp. Panel admin jest w sieci.'],
    ['Login: Admin\nPanel Admin oraz panel admin.', 'Login: [LOGIN]\nPanel Admin oraz panel admin.'],
    ['Login: tkaminski\nZablokowano konto tkaminski.', 'Login: [LOGIN]\nZablokowano konto [LOGIN].'],
    ['Login: tkaminski\nProszę poinformować tkaminski. Konto tkaminski odblokowano.', 'Login: [LOGIN]\nProszę poinformować [LOGIN]. Konto [LOGIN] odblokowano.'],
    [String.raw`Login: tkaminski` + '\n' + String.raw`Zmapowano H: na \\FS01\home$\tkaminski.`, String.raw`Login: [LOGIN]` + '\n' + String.raw`Zmapowano H: na \\FS01\home$\[LOGIN].`],
    ['Użytkownik "tkaminski" zgłosił problem. Odblokowano tkaminski.', 'Użytkownik "[LOGIN]" zgłosił problem. Odblokowano [LOGIN].'],
  ]);
});
test('K24 pułapki: propagacja osobowych loginów działa; kropka z ciągiem dalej i odmiana blokują', () => {
  masked([
    ['Login: jkowalski\nuser=jkowalski\ncmd=/home/jkowalski/backup.sh', 'Login: [LOGIN]\nuser=[LOGIN]\ncmd=/home/[LOGIN]/backup.sh'],
    ['Login: anna.nowak\nHasło dla anna.nowak wygasło.', 'Login: [LOGIN]\nHasło dla [LOGIN] wygasło.'],
    ['Login: Jan.Kowalski\nJan.Kowalski zgłosił błąd.', 'Login: [LOGIN]\n[LOGIN] zgłosił błąd.'],
    ['Login: jkowalski\nNa serwerze jkowalski:x:1000:1000 w /etc/passwd.', 'Login: [LOGIN]\nNa serwerze [LOGIN]:x:1000:1000 w /etc/passwd.'],
    ['Login: jan.nowak\nKonto jan.nowak.adm też zablokowano.', 'Login: [LOGIN]\nKonto jan.nowak.adm też zablokowano.'],
    ['Login: tkaminski\nSerwer tkaminski.example.com i plik tkaminski.cfg.', 'Login: [LOGIN]\nSerwer tkaminski.example.com i plik tkaminski.cfg.'],
    ['Login: test1\nWersja test1.5 gotowa.', 'Login: [LOGIN]\nWersja test1.5 gotowa.'],
    ['Login: tkaminski\nKontakt z tkaminskim.', 'Login: [LOGIN]\nKontakt z tkaminskim.'],
    ['Login serwisowy: srv_backup\nZadanie srv_backup uruchomione.', 'Login serwisowy: [LOGIN]\nZadanie [LOGIN] uruchomione.'],
  ]);
  keep(['Login:\nSystem operacyjny: Windows 11 Pro\nUwagi: System uruchamia się poprawnie.', 'Zaktualizuj system przed instalacją. Panel admin, tryb demo, użytkownik root.']);
});
test('K16: IPv4 przed kropką końca zdania maskowany przy kontekście sieciowym', () => {
  masked([
    ['Adres IP klienta: 83.24.115.6.\nLogowanie z adresu 185.23.44.10. Konto zablokowano.', 'Adres IP klienta: [IP].\nLogowanie z adresu [IP]. Konto zablokowano.'],
    ['Logowanie nastąpiło z adresu IP 83.12.45.67.', 'Logowanie nastąpiło z adresu IP [IP].'],
    ['Brama domyślna to 10.0.0.1.', 'Brama domyślna to [IP].'],
    ['Adres serwera: 192.168.1.10.', 'Adres serwera: [IP].'],
    ['Połączenie z 83.12.45.67.', 'Połączenie z [IP].'],
    ['Adres IP 83.12.45.67; drugi 83.12.45.68.', 'Adres IP [IP]; drugi [IP].'],
    ['(źródłowy IP 10.0.0.1.)', '(źródłowy IP [IP].)'],
    ['Adres IP: 10.0.0.1...', 'Adres IP: [IP]...'],
    ['IP: 192.168.1.20', 'IP: [IP]'],
    ['Interfejs 192.168.1.20/24 skonfigurowany.', 'Interfejs [IP]/24 skonfigurowany.'],
    ['Bramka 10.0.0.1 i host 10.0.0.15', 'Bramka [IP] i host [IP]'],
    // 9 cyfr z kropkami przy kotwicy telefonu to telefon, nie adres
    ['Kontakt tel. 22.123.45.67.', 'Kontakt tel. [TELEFON].'],
  ]);
});
test('K16: adresy specjalne (0.0.0.0, pętla, maska, adres sieci, publiczny DNS) i numery wersji bez maski', () => {
  keep([
    'Serwer nasłuchuje na 0.0.0.0.',
    'Maska podsieci: 255.255.255.0, adres nasłuchu 0.0.0.0, localhost 127.0.0.1 (port 3000)',
    'Zakres 10.0.0.0/24, DNS 8.8.8.8 i 1.1.1.1',
    '{"host": "0.0.0.0"}',
    'Nasłuch na 0.0.0.0:8080, maska 255.255.0.0',
    'Rozgłoszenie 255.255.255.255',
    'Zainstalowano wersję 2.4.1.0 na serwerze.',
    'Wdrożono wersję systemu 2.0.1.3.',
    'Wersja oprogramowania 1.2.3.4 została wdrożona',
  ]);
});
test('K16 pułapki: numeracja konspektu, odwołania, OID, kwoty i daty przed kropką bez zmian', () => {
  keep([
    '1.2.3.4. Zakres prac',
    '  2.1.1.1.\tOpis przedmiotu zamówienia',
    'Wymagania opisano w rozdziale 2.1.1.1.',
    'Szczegóły w punkcie 5.3.2.1. Dalsze wymagania poniżej.',
    'Adres dostawy opisano w punkcie 2.1.1.1.',
    'Zgodnie z pkt 3.1.2.4. specyfikacji.',
    'Zob. § 1.2.3.4. regulaminu.',
    'Załącznik nr 1.2.3.4.',
    'Aktualizacja do v10.2.0.15.',
    'Firmware 10.2.0.15.',
    'Kwota wyniosła 1.100.200.100.',
    'Identyfikator OID 1.3.6.1.4.1.',
    'Host: 10.0.0.1.nip.io',
    'PKD 62.01.Z.',
    'Data 12.03.2020. była ważna.',
    'Kod CPV 72.21.10.00. jest wymagany.',
    'Plik archiwum.1.2.3.4.tar zapisano.',
  ]);
});
test('K25: łańcuch par hex inny niż 6 par (numer seryjny, odcisk klucza, WWN) nie jest MAC ani IP', () => {
  keep([
    'Serial Number: 4a:3f:22:91:0c:7e:1d:55',
    'Odcisk klucza hosta: MD5:16:27:ac:a5:76:28:2d:36:63:1b:56:4d:eb:df:a6:48',
    'SHA1 Fingerprint=AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01',
    'Numer seryjny 4a-3f-22-91-0c-7e-1d-55 w rejestrze.',
    'HMAC: ab:cd:ef:01:23:45:67:89',
    'hostname=mac-01 serial 11:22:33:44:55:66:77:88',
  ]);
  masked([
    // pole „MAC=" z logu iptables: dwa adresy i typ ramki — cały łańcuch pod jedną maską
    ['IN=eth0 OUT= MAC=00:1a:2b:3c:4d:5e:00:11:22:33:44:55:08:00 SRC=83.12.45.67', 'IN=eth0 OUT= MAC=[MAC] SRC=[IP]'],
    ['MAC: 00:11:22:33:44:55:66', 'MAC: [MAC]'],
    // identyfikator klienta DHCP: typ sprzętu 01 + MAC; EUI-64 to adres sprzętowy jak MAC
    ['client-id 01:00:11:22:33:44:55', 'client-id [MAC]'],
    ['EUI-64: 00:12:4b:00:1c:a1:b2:c3', 'EUI-64: [MAC]'],
  ]);
});
test('K25 pułapki: zwykły MAC, zakres, mieszane separatory, Cisco i IPv6 jak dotąd', () => {
  masked([
    ['MAC: 00:1A:2B:3C:4D:5E', 'MAC: [MAC]'],
    ['Adres MAC 00-1A-2B-3C-4D-5E karty sieciowej.', 'Adres MAC [MAC] karty sieciowej.'],
    ['host-00-11-22-33-44-55.lan', 'host-[MAC].lan'],
    ['Zakres 00:11:22:33:44:55-00:11:22:33:44:66', 'Zakres [MAC]-[MAC]'],
    ['mieszane 00:11-22:33-44:55', 'mieszane [MAC]'],
    ['Router aabb.ccdd.eeff oraz MAC 0011.2233.4455', 'Router [MAC] oraz MAC [MAC]'],
    ['IPv6 2001:db8::1 oraz 2001:0db8:85a3:0000:0000:8a2e:0370:7334', 'IPv6 [IP] oraz [IP]'],
  ]);
});
test('K28: adres zdalnego repozytorium „git@host:ścieżka" nie jest e-mailem; „%40" maskowane też poza URL-em', () => {
  keep([
    'git remote add origin git@gitlab.firma.pl:zespol-erp/modul-kadry.git',
    'git clone git@github.com:jkowalski/portal.git',
    'git clone ssh://git@gitlab.firma.pl/zespol-erp/modul-kadry.git',
  ]);
  masked([
    ['GET /api/v1/clients?email=jan.kowalski%40example.pl&status=1 200', 'GET /api/v1/clients?email=[EMAIL]&status=1 200'],
    [String.raw`{"callback":"https:\/\/crm.example.pl\/klient?email=jan.kowalski%40example.pl"}`, String.raw`{"callback":"https:\/\/crm.example.pl\/klient?email=[EMAIL]"}`],
    ['Email: jan.kowalski%40example.pl', 'Email: [EMAIL]'],
  ]);
});
test('K28 pułapki: loginy osób w formie scp, skrzynki funkcyjne i „%" w prozie jak dotąd', () => {
  masked([
    ['scp plik.txt jan.kowalski@serwer.firma.pl:/home/jan/', 'scp plik.txt [EMAIL]:/home/[LOGIN]/'],
    ['jkowalski@github.com:jkowalski/portal.git', '[EMAIL]:jkowalski/portal.git'],
    ['anna.git@gmail.com:prywatne', '[EMAIL]:prywatne'],
    ['Zgłoszenia na git@firma.pl: dział IT.', 'Zgłoszenia na [EMAIL]: dział IT.'],
    ['Kontakt: biuro@firma.pl, noreply@firma.pl.', 'Kontakt: [EMAIL], [EMAIL].'],
    ['git clone https://jkowalski@bitbucket.org/zespol/repo.git', 'git clone https://[EMAIL]/zespol/repo.git'],
  ]);
  keep([
    'Stawka VAT wynosi 23%, a marża 40%.',
    'Kod rabatowy SALE%40OFF obowiązuje do końca miesiąca.',
    'Wzrost sprzedaży o 12%40 sklepów odnotowało spadek.',
    'Wynik 95%40.5 punktu.',
    'raport%402024.pdf',
    'GET /api/v1/clients?email=&status=1 200',
  ]);
});
test('K29: znak sprawy z numerem po roku maskowany w całości (bez ogona „.1")', () => {
  masked([
    ['Sygn. akt: CAN-PST-SWW.7421.1234567.2026.1', 'Sygn. akt: [ZNAK-SPRAWY]'],
    ['wezwanie CAN-PST-SWW.7421.1234567.2026.1', 'wezwanie [ZNAK-SPRAWY]'],
    ['GKM.6220.1.2021.2', '[ZNAK-SPRAWY]'],
    ['Znak sprawy: ZP.271.1.2026.1.PL', 'Znak sprawy: [ZNAK-SPRAWY]'],
    // pułapki: kropka końca zdania zostaje; data z cyfrą bez symbolu to nie znak; sygnatura sądu jak dotąd
    ['Znak: ZP.271.1.2026.1. Zamawiający', 'Znak: [ZNAK-SPRAWY]. Zamawiający'],
    ['Znak: ZP.271.1.2026 z dnia 12.03.2026', 'Znak: [ZNAK-SPRAWY] z dnia 12.03.2026'],
    ['sygn. akt I C 123/23', 'sygn. akt [ZNAK-SPRAWY]'],
  ]);
  keep(['Data: 12.03.2026.1 egzemplarz']);
});
test('b2: poprawki są idempotentne i działają z pseudonimizacją', () => {
  const texts = [
    'Przelew na DE89 3704 0044 0532 0130 00 Z OPCJĄ SHA',
    'Login: FIRMA\\jkowalski\nKonto jkowalski.',
    'IP 83.12.45.67. Serial 4a:3f:22:91:0c:7e:1d:55',
    'Ciągnik: nr rej. WGM 12345, DMC 18000 kg',
    'Kwota: 150 000 000 zł, tel. 512 345 678',
  ];
  for (const t of texts) {
    const once = redactPII(t).redacted;
    expect(redactPII(once).redacted, t).toBe(once);
    expect(redactPII(t, { pseudonyms: true }).redacted, t).toBe(once);
  }
});

// ── Audyt, partia b2 — regresje wykryte w weryfikacji (wycieki i nadmaskowanie po poprawkach b2) ──
test('b2-fix K12: po „nr rej." tablica małymi literami z odstępem dalej maskowana; „KM Policji" i „t.j." to nie jednostki', () => {
  const R = '[NR-REJESTRACYJNY]';
  masked([
    ['nr rej. wa 12345', `nr rej. ${R}`],
    ['Nr rej.: kr 1234a', `Nr rej.: ${R}`],
    ['nr rejestracyjny: dw 12345', `nr rejestracyjny: ${R}`],
    ['NR REJ.: wa 12345', `NR REJ.: ${R}`],
    ['Numer rejestracyjny pojazdu: wx 1234a', `Numer rejestracyjny pojazdu: ${R}`],
    ['Zatrzymano pojazd nr rej. wa 12345.', `Zatrzymano pojazd nr rej. ${R}.`],
    ['Pojazd WE 12345 KM Policji przekazano na parking.', `Pojazd ${R} KM Policji przekazano na parking.`],
    ['Pojazd WE 12345 KM PSP.', `Pojazd ${R} KM PSP.`],
    ['Pojazd PZ 4567B t.j. Opel Astra.', `Pojazd ${R} t.j. Opel Astra.`],
  ]);
  // pułapki: słabe kotwice i „nr" bez zmian, „numer rejestru" to nie tablica, jednostki jak dotąd
  keep([
    'Formularz rejestracyjny nr 2024',
    'Tablice rejestracyjne dla 2000 pojazdów.',
    'Opłata rejestracyjna to 1500 zł.',
    'Numer rejestru od 2020 prowadzi starosta.',
    'Ciągnik o mocy 150 KM.',
    'ładowność 24 t.',
  ]);
});
test('b2-fix K16: strażnik wersji bez przyimka i bez „konwersji"; wersja, firmware i skróty odwołań przed kropką bez [IP]', () => {
  masked([
    ['Wdrożono nową wersję na 10.20.30.40 wieczorem', 'Wdrożono nową wersję na [IP] wieczorem'],
    ['Pobrano wersję z 10.20.30.41 w nocy.', 'Pobrano wersję z [IP] w nocy.'],
    ['Nowa wersja od 10.1.2.3 w sieci', 'Nowa wersja od [IP] w sieci'],
    ['Konwersja adresów 192.168.1.15 nie działa', 'Konwersja adresów [IP] nie działa'],
    ['Router dokonał konwersji adresu 192.168.10.23 na adres publiczny 83.12.45.67.', 'Router dokonał konwersji adresu [IP] na adres publiczny [IP].'],
    // linia o aktualizacji, ale adres nazwany wprost — to dalej adres
    ['Po aktualizacji logowanie z adresu 83.24.115.6.', 'Po aktualizacji logowanie z adresu [IP].'],
    ['Adres IP serwera po aktualizacji: 83.24.115.6.', 'Adres IP serwera po aktualizacji: [IP].'],
  ]);
  keep([
    'Na serwerze wgrano firmware 4.1.2.10.',
    'Aktualizacja serwera do 7.0.3.12.',
    'Serwer działa na Debianie 12.0.1.2.',
    'Adres serwera to srv01, build 1.0.0.12.',
    'Wersja klienta: 2.1.0.15.',
    'Konfiguracja serwera – tab. 2.1.1.4.',
    'Konfiguracja adresów IP: rozdz. 5.2.1.3.',
    'Opis interfejsu serwera: rys. 3.2.1.1.',
    'Parametry hosta: zał. 1.2.3.4.',
    'Zaktualizowano firmware routera do 1.2.3.4.',
    'Kernel serwera 5.15.0.91.',
    'Wersja: 2.1.0.15 (stabilna)',
  ]);
});
test('b2-fix K01: telefon po imieniu, nazwisku lub „SMS/Tel" łączonym „/" lub „-" i po linii „____" dalej maskowany', () => {
  masked([
    ['Koordynator: Anna Nowak/601 234 567', 'Koordynator: [IMIĘ I NAZWISKO]/[TELEFON]'],
    ['Jan Kowalski-601234567', '[IMIĘ I NAZWISKO]-[TELEFON]'],
    ['córka Anna/603 456 789', 'córka Anna/[TELEFON]'],
    ['SMS/601 234 567', 'SMS/[TELEFON]'],
    ['Kontakt/601 234 567', 'Kontakt/[TELEFON]'],
    ['(koordynator), Tel/607 890 123', '(koordynator), Tel/[TELEFON]'],
    ['GSM-601 234 567', 'GSM-[TELEFON]'],
    ['Telefon: ____601 234 567', 'Telefon: ____[TELEFON]'],
    ['Telefon kontaktowy:______________601234567', 'Telefon kontaktowy:______________[TELEFON]'],
    ['512345678w godz. 8-16', '[TELEFON]w godz. 8-16'],
  ]);
  // pułapki: identyfikatory z łącznikiem, podkreślnikiem i literą po cyfrach bez zmian
  keep(['WZ/123456789', 'ID-123456789', 'A-123456789', 'produkt-123456789', 'x_123456789', '123456789a', 'abc123456789w']);
});
test('b2-fix K26: „ZŁ…" wersalikami i „Gr." po numerze to nie waluta; kwoty w złotych i groszach bez zmian', () => {
  masked([
    ['602 345 678 ZŁOTÓW', '[TELEFON] ZŁOTÓW'],
    // K47: szyk odwrócony WERSALIKAMI z nazwiskiem ze słownika to osoba
    ['NOWAK JAN 602 345 678 ZŁOŻYŁ WNIOSEK', `${N} [TELEFON] ZŁOŻYŁ WNIOSEK`],
    ['601 234 567 złożył wniosek', '[TELEFON] złożył wniosek'],
    ['602 345 678 Gr. A', '[TELEFON] Gr. A'],
  ]);
  keep(['125 450 300 ZŁOTYCH', '125 450 300 ZŁ', '125 450 300 złotych', '125 450 300 gr', 'Kwota: 150 000 000 złotówek', 'Saldo 125 450 300 ZŁOTE']);
});
test('b2-fix K24/K15: konta funkcyjne działów („kadry", „magazyn") nie rozlewają się na prozę', () => {
  masked([
    ['Login: kadry\nWyślij do kadry.', 'Login: [LOGIN]\nWyślij do kadry.'],
    ['Login: marketing\nZespół marketing.', 'Login: [LOGIN]\nZespół marketing.'],
    ['Login: URZAD\\kadry\nPismo przekazano do działu kadry.', 'Login: [LOGIN]\nPismo przekazano do działu kadry.'],
    ['Użytkownik "FIRMA\\magazyn" ma dostęp. Towar przyjęto na magazyn.', 'Użytkownik "[LOGIN]" ma dostęp. Towar przyjęto na magazyn.'],
    ['User: PRACA\\ewidencja\nWpisy do ewidencja zostały zaktualizowane.', 'User: [LOGIN]\nWpisy do ewidencja zostały zaktualizowane.'],
    ['Login: URZAD\\kadry\nRepozytorium: git@gitlab.urzad.local:kadry/ewidencja.git', 'Login: [LOGIN]\nRepozytorium: git@gitlab.urzad.local:kadry/ewidencja.git'],
    // pułapka: login osoby dalej się propaguje, także przed kropką
    ['Login: FIRMA\\akowalska\nKonto akowalska.', 'Login: [LOGIN]\nKonto [LOGIN].'],
  ]);
});
test('b2-fix K14: nadmiarowe cyfry po IBAN-ie (literówka) pod maską; kwota za numerem zostaje', () => {
  const K = '[NR-KONTA]';
  masked([
    ['IBAN: DE89 3704 0044 0532 0130 00 12', `IBAN: ${K}`],
    ['Przelew na DE89 3704 0044 0532 0130 00 12', `Przelew na ${K}`],
    ['Konto PL61 1090 1014 0000 0712 1981 2874 5', `Konto ${K}`],
    ['Konto PL61 1090 1014 0000 0712 1981 2875 5', `Konto ${K}`],
    ['Przelew PL61 1090 1014 0000 0712 1981 2874 1500 zł', `Przelew ${K} 1500 zł`],
    ['Konto: PL61 1090 1014 0000 0712 1981 2875 15 PLN', `Konto: ${K} 15 PLN`],
    ['IBAN: DE89 3704 0044 0532 0130 00 12,50 EUR', `IBAN: ${K} 12,50 EUR`],
  ]);
});
test('b2-fix K25: DUID i EUI-64 z adresem karty maskowane w całości; inne łańcuchy bez zmian', () => {
  masked([
    ['DUID 00:01:00:01:2a:3b:4c:5d:00:1a:2b:3c:4d:5e', 'DUID [MAC]'],
    ['DHCPv6 Client DUID. . . . . . . . : 00-01-00-01-2A-3B-4C-5D-00-1A-2B-3C-4D-5E', 'DHCPv6 Client DUID. . . . . . . . : [MAC]'],
    ['IAID 1234, DUID: 00:01:00:01:2a:3b:4c:5d:00:1a:2b:3c:4d:5e', 'IAID 1234, DUID: [MAC]'],
    ['Identyfikator 00:03:00:01:00:1a:2b:3c:4d:5e', 'Identyfikator [MAC]'],
    ['EUI-64 interfejsu: 02:1a:2b:ff:fe:3c:4d:5e', 'EUI-64 interfejsu: [MAC]'],
    ['Interfejs 02:1a:2b:ff:fe:3c:4d:5e', 'Interfejs [MAC]'],
  ]);
  keep(['Łańcuch 00:01:00:02:2a:3b:4c:5d:00:1a:2b:3c:4d:5e', 'HMAC klucza: ab:cd:ef:01:23:45:67:89']);
});
test('b2-fix: czas liniowy w długiej linii bez „\\n" (IP przed kropką, ogon miliarda)', () => {
  const inputs: [string, string][] = [
    ['IP przed kropką', 'IP 10.1.2.3. '.repeat(32_000)],
    ['ogon miliarda', '| 1 234 567 890 '.repeat(26_000)],
  ];
  for (const [name, text] of inputs) {
    const t0 = performance.now();
    redactPII(text);
    expect(performance.now() - t0, name).toBeLessThan(500);
  }
});

// ── Audyt, partia b3: nadmaskowanie osób i miejsc (eponimy, nazwy własne, marker zamieszkania) ──
const N = '[IMIĘ I NAZWISKO]';
const C = '[MIEJSCOWOŚĆ]';
const A = '[ADRES]';
const KOD = '[KOD-POCZTOWY]';
test('K07: adres bez „ul." przy kodzie nie przechodzi przez nową linię (wiersz podpisu zostaje osobno)', () => {
  masked([
    ['Pozdrawiam\nMonika Sadowska\nSzosa Chełmińska 77/9\n87-100 Toruń', `Pozdrawiam\n${N}\n${A}\n${KOD} ${C}`],
    ['Firma Budex Sp. z o.o.\nPolna 8\n60-101 Poznań', `Firma Budex Sp. z o.o.\n${A}\n${KOD} ${C}`],
    ['zam. Gdańsk\nHoża 41, 00-681 Warszawa', `zam. ${C}\n${A}, ${KOD} ${C}`],
    // miasto w osobnym wierszu nad adresem — wiersz zostaje, nazwa w masce
    ['Warszawa\nHoża 41, 00-681 Warszawa', `${C}\n${A}, ${KOD} ${C}`],
  ]);
});
test('K07 pułapki: adres bez „ul." przy kodzie nadal w masce (numer w następnym wierszu, CRLF, tabulator)', () => {
  masked([
    ['Szosa Chełmińska 77/9\n87-100 Toruń', `${A}\n${KOD} ${C}`],
    ['Szosa Chełmińska\n77/9\n87-100 Toruń', `${A}\n${KOD} ${C}`],
    ['Szosa Chełmińska 77/9, 87-100 Toruń', `${A}, ${KOD} ${C}`],
    ['Kwiatowa 12 m. 4\n31-123 Kraków', `${A}\n${KOD} ${C}`],
    ['Szosa Chełmińska 77/9\r\n87-100 Toruń\r\n', `${A}\r\n${KOD} ${C}\r\n`],
    ['Stara Wieś 15\t\n87-100 Toruń', `${A}\t\n${KOD} ${C}`],
    ['Jan Kowalski, Szosa Chełmińska 77 m. 9, 87-100 Toruń', `${N}, ${A}, ${KOD} ${C}`],
  ]);
  // nazwa i wiersz, które tylko sąsiadują z adresem, zostają
  masked([
    ['Wydział Kontroli\nul. Długa 5', `Wydział Kontroli\n${A}`],
    ['Jan Turek\nul. Długa 5', `${N}\n${A}`],
  ]);
});
test('K07: numer „domu" będący dniem daty albo rokiem — to data, nie adres', () => {
  keep([
    'Marsz wyruszy z placu Piłsudskiego 11 listopada o godz. 12:00.',
    'Walki przy ul. Okopowej 1944 r. 5 sierpnia trwały długo.',
    'Spotkanie przy ul. Bitwy Warszawskiej 1920 r. w Warszawie.',
    'Wydarzenie odbędzie się na Placu Zamkowym 1 maja.',
    'Remont ul. Puławskiej 2021-2023 trwał długo.',
    'Remont ul. Długiej 2024 r. przesunięto na wiosnę.',
    'ul. Kwiatowa 12 maja wybuchł pożar.',
    'Rondo Dmowskiego 1990 wybudowane.',
    'Most Grunwaldzki 1910 r. 5 osób przeszło.',
  ]);
});
test('K07 pułapki: ulice z liczebnikiem, silna etykieta i ulica z datą w nazwie dalej w masce', () => {
  masked([
    ['Jan Kowalski, zam. ul. 3 Maja 15, 00-001 Warszawa.', `${N}, zam. ${A}, ${KOD} ${C}.`],
    ['Adres: ul. 11 Listopada 7/2, Kraków.', `Adres: ${A}, ${C}.`],
    ['Adres: al. 29 Listopada 20, Kraków.', `Adres: ${A}, ${C}.`],
    ['Spotkanie przy ul. 3 Maja 15.', `Spotkanie przy ${A}.`],
    ['Adres: ul. Długa 2020.', `Adres: ${A}.`],
    // po silnej etykiecie dzień przed miesiącem to nadal numer domu
    ['Adres: ul. Mariacka 20 maja 2023 r. przeprowadzka.', `Adres: ${A} maja 2023 r. przeprowadzka.`],
    // ulica z datą w nazwie: numer domu stoi po „r." — cały adres w masce
    ['Badania: ul. Bitwy Warszawskiej 1920 r. 18, 02-366 Warszawa', `Badania: ${A}, ${KOD} ${C}`],
    ['Adres: ul. Bitwy Warszawskiej 1920 roku 18/4', `Adres: ${A}`],
    ['ul. Ofiar Grudnia 1970 r. 5, 81-001 Gdynia', `${A}, ${KOD} ${C}`],
    ['Adres: Al. Bitwy Warszawskiej 1920 r. 7 m. 3', `Adres: ${A}`],
  ]);
});
test('b3 wady poboczne: blok na osiedlu, „et al." w cytowaniu, kod pocztowy przed walutą i jednostką', () => {
  masked([
    ['os. Tysiąclecia bl. 4 m. 3', A],
    ['Adres: os. Kalinowe bl. 12 m. 40, 31-001 Kraków', `Adres: ${A}, ${KOD} ${C}`],
    ['nr rej. WE 12345, UE 2016/679', 'nr rej. [NR-REJESTRACYJNY], UE 2016/679'],
  ]);
  keep([
    'Smith et al. Nature 2019',
    'Smith et al. 2019 Nature 12',
    'Koszt naprawy wyniesie 10-200 PLN brutto.',
    'Dystans 20-150 km dziennie.',
    'W wydarzeniu wzięło 30-500 osób.',
    'Szacunek: 15-250 EUR za sztukę.',
  ]);
  // pułapki: prawdziwy kod pocztowy (też przed „m. st.") i wyliczenie tablic zostają maskami
  masked([
    ['00-950 Warszawa', `${KOD} ${C}`],
    ['Kod 00-950 m. st. Warszawa', `Kod ${KOD} m. st. Warszawa`],
    ['nr rej. WE 12345, WA 6789A', 'nr rej. [NR-REJESTRACYJNY], [NR-REJESTRACYJNY]'],
    ['Mieszkam na al. Jana Pawła II 12.', `Mieszkam na ${A}.`],
  ]);
});
test('K09: nazwa własna obiektu w mianowniku („Kościół Mariacki") nie jest parą osobową', () => {
  keep([
    'Kościół Mariacki w Krakowie pochodzi z XIV wieku.',
    'Hejnał Mariacki rozbrzmiewa co godzinę.',
    'Pomnik Grunwaldzki stoi w Krakowie.',
    'W sierpniu startuje Jarmark Dominikański w Gdańsku.',
    'Noc Świętojańska to najkrótsza noc roku.',
    'Ocean Atlantycki jest ogromny.',
    'Sobór Watykański II zmienił liturgię.',
    'Puszcza Białowieska jest stara.',
    'Brama Floriańska jest zabytkiem.',
    'Traktat Wersalski podpisano w 1919 r.',
    'Kanał Sueski otwarto.',
    'Odwiedziliśmy Biebrzański Park Narodowy.',
  ]);
});
test('K09: przysłówek, spójnik albo rzeczownik przed nazwiskiem zostaje — maska obejmuje samo nazwisko', () => {
  masked([
    ['Wczoraj Kowalski przyszedł do biura.', `Wczoraj ${N} przyszedł do biura.`],
    ['Następnie Kowalski podpisał umowę.', `Następnie ${N} podpisał umowę.`],
    ['Jednak Lewandowski odmówił.', `Jednak ${N} odmówił.`],
    ['Ale Kowalski nie wiedział.', `Ale ${N} nie wiedział.`],
    ['Wczoraj Kowalska przyszła.', `Wczoraj ${N} przyszła.`],
    ['Ponadto Mickiewicz napisał.', `Ponadto ${N} napisał.`],
    ['Raport Kowalski zawiera błędy.', `Raport ${N} zawiera błędy.`],
    ['Sąsiad Kowalski zeznał.', `Sąsiad ${N} zeznał.`],
    ['Aspirant Kowalski przyjął zgłoszenie.', `Aspirant ${N} przyjął zgłoszenie.`],
    ['wczoraj Raport Kowalski zginął.', `wczoraj Raport ${N} zginął.`],
  ]);
});
test('K09 pułapki: rzadkie imię spoza słownika dalej znika razem z nazwiskiem; role jak dotąd', () => {
  masked([
    ['Świętomira Gzowska przyszła na przesłuchanie.', `${N} przyszła na przesłuchanie.`],
    ['Bożydar Kowalski złożył wniosek.', `${N} złożył wniosek.`],
    ['Zygmunt Kowalski przyszedł.', `${N} przyszedł.`],
    ['Kuba Gzowski przyszedł.', `${N} przyszedł.`],
    ['Nel Gzowska przyszła.', `${N} przyszła.`],
    ['Prezes Gzowski podpisał uchwałę.', `Prezes ${N} podpisał uchwałę.`],
    ['Pracownik Kowalski otrzymał premię.', `Pracownik ${N} otrzymał premię.`],
    ['Zakład Usługowy Kowalski', `Zakład Usługowy ${N}`],
    ['Bożydar Gzowski Kancelaria Adwokacka', `${N} Kancelaria Adwokacka`],
    ['Wczoraj Jan Kowalski przyszedł do biura.', `Wczoraj ${N} przyszedł do biura.`],
  ]);
  keep(['Wczoraj Anna wróciła z urlopu.', 'Wczoraj Sąd Okręgowy wydał wyrok.', 'Wczoraj Starosta Wołomiński podpisał decyzję.']);
});
test('K10: przymiotniki na -nicza i czasowniki „zalicza/oblicza" nie są nazwiskiem', () => {
  keep([
    'Kancelaria Komornicza w Zamościu',
    'Opinię wydała Izba Rolnicza w Lublinie.',
    'Zalicza się do tego również koszty.',
    'Oblicza się różnicę.',
    'Ochotnicza Straż Pożarna w Lipnie',
    'Zasadnicza Szkoła Zawodowa nr 2',
    'Kancelaria Prawnicza Lex Sp. z o.o.',
    'Akademia Górniczo-Hutnicza i Izba Rolnicza w Opolu',
    'Dąbrowa Górnicza leży na Śląsku.',
  ]);
});
test('K10 pułapki: dopełniacz nazwiska -icz (z samogłoską, -owicz/-ewicz) i kotwice dalej maskują', () => {
  masked([
    ['Sprawę Kowalewicza przekazano do sądu.', `Sprawę ${N} przekazano do sądu.`],
    ['Kancelaria Kowalewicza mieści się przy ul. Długiej.', `Kancelaria ${N} mieści się przy ul. Długiej.`],
    ['Pełnomocnik Iwanicza złożył zażalenie.', `Pełnomocnik ${N} złożył zażalenie.`],
    ['Pismo Romanicza wpłynęło.', `Pismo ${N} wpłynęło.`],
    ['Wniosek Jana Wojnicza wpłynął.', `Wniosek ${N} wpłynął.`],
    ['Wierzyciel Adam Hutnicz', `Wierzyciel ${N}`],
    ['Pani Hutnicza złożyła wniosek.', `Pani ${N} złożyła wniosek.`],
  ]);
});
test('K10: przymiotniki relacyjne, zawodowe i parki narodowe na -ski nie są nazwiskiem', () => {
  keep([
    'Poselski projekt ustawy trafił do Sejmu.',
    'Byliśmy w Białowieskim Parku Narodowym.',
    'Odwiedziliśmy Białowieski Park Narodowy w maju.',
    'Opieka Pielęgniarska w domu chorego.',
    'Objęto go Opieką Pielęgniarską.',
    'Regionalna Dyrekcja Ochrony Środowiska w Gdańsku wydała decyzję.',
    'Wojewódzki Fundusz Ochrony Środowiska i Gospodarki Wodnej',
    'Władza Rodzicielska została ograniczona.',
    // homografy nazwisk przed nazwą parku — chroni prawy kontekst, nie stoplista
    'Słowiński Park Narodowy jest nad morzem.',
    'Dyrekcja Wolińskiego Parku Narodowego',
  ]);
  masked([
    ['Praktyka Pielęgniarska Anny Kowalskiej.', `Praktyka Pielęgniarska ${N}.`],
    // pułapki: homograf parku bez „Parku" i para z imieniem dalej maskowane
    ['Słowiński złożył wniosek.', `${N} złożył wniosek.`],
    ['Pan Słowiński złożył wniosek.', `Pan ${N} złożył wniosek.`],
    ['Jan Poselski złożył wniosek.', `${N} złożył wniosek.`],
    ['Fiołkowska wygrała przetarg na dostawę mebli.', `${N} wygrała przetarg na dostawę mebli.`],
  ]);
});
test('K10: złożony przymiotnik z łącznikiem („Kujawsko-Pomorski") nie jest nazwiskiem dwuczłonowym', () => {
  keep([
    'Kujawsko-Pomorski Oddział Wojewódzki NFZ',
    'odwołanie do Warmińsko-Mazurskiego Oddziału NFZ',
    'Pan Wojewoda Kujawsko-Pomorski podpisał.',
    'Izba Polsko-Niemiecka',
  ]);
  masked([
    ['Maria Skłodowska-Curie', N],
    ['Jan Bosko-Kowalski', N],
    ['Bosko-Kowalski złożył wniosek.', `${N} złożył wniosek.`],
    ['Pan Habdank-Wojewódzki', `Pan ${N}`],
    ['Zofia Wiśniewska-Mazurska', N],
    ['Pani Pasko-Nowicka', `Pani ${N}`],
  ]);
});
test('K10: rzeczowniki pospolite wyglądające jak nazwisko („Kaski", „Dziecka", „Kluczyk")', () => {
  keep([
    'Kaski ochronne są obowiązkowe na terenie budowy.',
    'Dyski SSD są szybkie.',
    'Placki ziemniaczane z cukrem.',
    'Freski z XV wieku.',
    '["Kaski","Dyski","Placki"]',
    'Skierowano do Instytutu Matki i Dziecka w Warszawie.',
    'Dane Dziecka: brak.',
    'Konwencja o Prawach Dziecka',
    'Słowniczyk pojęć znajduje się na końcu.',
    'Kluczyk do skrzynki zginął.',
    'Chińczyk i Japończyk rozmawiali.',
  ]);
  masked([
    ['Matka Dziecka: Anna Kowalska', `Matka Dziecka: ${N}`],
    ['Imię i nazwisko Dziecka: Zofia Nowak', `Imię i nazwisko Dziecka: ${N}`],
    // pułapki: te same wyrazy jako nazwisko przy kotwicy dalej maskowane
    ['Pan Kluczyk przyszedł do biura.', `Pan ${N} przyszedł do biura.`],
    ['Umowę podpisał J. Kluczyk.', `Umowę podpisał ${N}.`],
    ['J. Kluczyk podpisał umowę.', `J. ${N} podpisał umowę.`],
    ['Jan Kluczyk przyszedł.', `${N} przyszedł.`],
    ['Anna Kaska złożyła wniosek.', `${N} złożyła wniosek.`],
    ['Pani Bielecka przyszła.', `Pani ${N} przyszła.`],
  ]);
});
test('K10: wiersz „Przymiotnik Imię" nie skleja się z osobą z następnego wiersza', () => {
  masked([['Olimpijska Nadzieja\nRzymska Diana\nWielka Nadzieja', `Olimpijska Nadzieja\n${N}\nWielka Nadzieja`]]);
  // pułapka: łamanie imienia i nazwiska w prozie dalej domyka osobę
  masked([['Starosta Jan\nWiśniewski przeprowadził kontrolę.', `Starosta ${N} przeprowadził kontrolę.`]]);
});
test('K11: „Pan/Pani" + rola + dopełniacz urzędu albo imię sakralne — bez maski', () => {
  keep([
    'Pani Minister Zdrowia podpisała rozporządzenie.',
    'Pan Dyrektor Departamentu Podatków odpowiedział.',
    'Pan Prezydent Miasta Krakowa przemówił.',
    'Pan Komendant Policji przyjął skargę.',
    'Pan Komendant Główny Policji przyjął.',
    'Modlimy się do Pana Boga.',
    'Szanowna Pani Dyrektor Szkoły,',
    'Pan Marszałek Województwa Mazowieckiego podpisał.',
    'Pani Kurator Oświaty wydała decyzję.',
    'Panu Ministrowi Zdrowia przekazano pismo.',
    'Pan Sołtys Wsi zwołał zebranie.',
  ]);
});
test('K11 pułapki: osoba po roli i homonimy nazwisk dalej maskowane; nowa rola zostaje przed maską', () => {
  masked([
    ['Pan Dyrektor Gzik odpowiedział.', `Pan Dyrektor ${N} odpowiedział.`],
    ['Pani Dyrektor Rodzina odpowiedziała.', `Pani Dyrektor ${N} odpowiedziała.`],
    ['Pan Minister Ziobro odpowiedział.', `Pan Minister ${N} odpowiedział.`],
    ['Pani Minister Anna Nowak przemówiła.', `Pani Minister ${N} przemówiła.`],
    ['Panu Janowi Kowalskiemu przekazano.', `Panu ${N} przekazano.`],
    ['Pani Anna Nowa złożyła wniosek.', `Pani ${N} złożyła wniosek.`],
    ['Pan Adam Nowy przyszedł.', `Pan ${N} przyszedł.`],
    ['Pan Poseł Kowalski złożył interpelację.', `Pan Poseł ${N} złożył interpelację.`],
  ]);
});
test('K20: eponim po rzeczowniku z wielkiej litery i „na moście" — nie osoba', () => {
  keep([
    'Odruch Babińskiego dodatni.',
    'Prątek Kocha w posiewie.',
    'Założono uprząż Pawlika.',
    'Objaw Babińskiego ujemny.\nObjaw Brudzińskiego ujemny.',
    'Odczyn Biernackiego 12 mm/h',
    'Pałeczki Kocha nieobecne.',
    'Stwierdzono dystrofię Fuchsa.',
    'Cięcie wzdłuż linii Langera.',
    'Korek na moście Łazienkowskim od rana.',
    'Spotkanie przy Moście Grunwaldzkim.',
    'Na moście Poniatowskiego korek.',
  ]);
});
test('K20 pułapki: osoby obok eponimu, nagłówek w osobnym wierszu i mianownik po „moście" maskowane', () => {
  masked([
    ['Pacjent Kowalski zgłosił się na badanie kontrolne.', `Pacjent ${N} zgłosił się na badanie kontrolne.`],
    ['Zespół\nKowalski\nNowak', `Zespół\n${N}\n${N}`],
    ['Test\nKowalski', `Test\n${N}`],
    ['Skala Wiśniewski', N],
    ['Objaw Kowalska', N],
    ['Prątki wykryto u Pawlika.', `Prątki wykryto u ${N}.`],
    ['Dystrofia mięśniowa u Mariusza Kocha.', `Dystrofia mięśniowa u ${N}.`],
    ['Pacjent Jan Kowalski, odruch Babińskiego dodatni.', `Pacjent ${N}, odruch Babińskiego dodatni.`],
    ['Na moście Jan Kowalski zatrzymał auto.', `Na moście ${N} zatrzymał auto.`],
    ['Na moście Kowalski potrącił pieszego.', `Na moście ${N} potrącił pieszego.`],
    ['Kierowca Kowalski utknął na moście Siekierkowskim.', `Kierowca ${N} utknął na moście Siekierkowskim.`],
  ]);
});
test('K20: patron z tytułem naukowym („im. dra", „im. dr. med."), święty i błogosławiony — nie osoba', () => {
  keep([
    'Konsultacja w Szpitalu Specjalistycznym im. dra Alfreda Sokołowskiego w Wałbrzychu.',
    'Skierowano do Szpitala im. dr. med. Rafała Masztaka.',
    'Szpital im. prof. dr. hab. Jana Kowalskiego',
    'Szkoła im. A. Mickiewicza w Gdańsku.',
    'Kościół św. Piotra Apostoła',
    'Parafia bł. Jerzego Popiełuszki',
    'PRZY ALEI WŁADYSŁAWA SIKORSKIEGO',
    'RONDO ROMANA DMOWSKIEGO',
  ]);
});
test('K20: święty z kontekstem sakralnym („Kościół/parafia/pw./im. św.") to patron, nie osoba', () => {
  keep([
    'kościół pw. św. Michała Archanioła',
    'parafia św. Józefa Oblubieńca w Krakowie',
    'Kościół św. Antoniego Padewskiego w Poznaniu.',
    'Parafia św. Jacka w Krakowie',
    'Szkoła im. św. Jadwigi Królowej',
    'Szpital im. bł. Alfreda Sokołowskiego.',
  ]);
  masked([['Parafia pw. św. Stanisława Kalisz, ul. Polna 3', `Parafia pw. św. Stanisława ${C}, ${A}`]]);
});
test('K20 pułapki: „św." bez kontekstu sakralnego to skrót „świadek" — osoba w masce', () => {
  masked([
    ['św. Kowalski zeznał.', `św. ${N} zeznał.`],
    ['Sąd przesłuchał św. Annę Gzowską.', `Sąd przesłuchał św. ${N}.`],
    ['Zeznania św. Anny Gzowskiej są spójne.', `Zeznania św. ${N} są spójne.`],
    ['Zeznania św. A. Nowak.', `Zeznania św. ${N}.`],
    ['Św. Jan Kowalski zeznał.', `Św. ${N} zeznał.`],
    ['św. Jan Turek, ul. Długa 5', `św. ${N}, ${A}`],
    ['W dniu przesłuchania św. Gzowska nie stawiła się.', `W dniu przesłuchania św. ${N} nie stawiła się.`],
  ]);
});
test('K20 pułapki: zaimek „im" to nie patron; osoba po tytule i po zdaniu z patronem maskowana', () => {
  masked([
    ['Pomógł im Jan Kowalski w przeprowadzce.', `Pomógł im ${N} w przeprowadzce.`],
    ['Przedstawiono im dra Jana Kowalskiego jako nowego ordynatora.', `Przedstawiono im dra ${N} jako nowego ordynatora.`],
    ['Opowiedział im lek. med. Jan Kowalski o zabiegu.', `Opowiedział im lek. med. ${N} o zabiegu.`],
    ['Konsultacja u dra Jana Kowalskiego w poradni.', `Konsultacja u dra ${N} w poradni.`],
    ['Leczący: dr n. med. Jan Kowalski.', `Leczący: dr n. med. ${N}.`],
    ['Szpital im. dra Alfreda Sokołowskiego. Jan Kowalski został wypisany.', `Szpital im. dra Alfreda Sokołowskiego. ${N} został wypisany.`],
    ['Szpital im. dra Alfreda Sokołowskiego oraz Jan Kowalski.', `Szpital im. dra Alfreda Sokołowskiego oraz ${N}.`],
    ['WNIOSKODAWCA JAN KOWALSKI ZAM. PRZY ALEI JANA PAWŁA II', `WNIOSKODAWCA ${N} ZAM. PRZY ALEI JANA PAWŁA II`],
  ]);
  // wersaliki bez kotwicy ulicznej przed parą — tytuł zostaje, osoba w masce
  expect(redactPII('PAN JAN KOWALSKI').redacted).toBe(`PAN ${N}`);
});
test('K20: toponim „Kazimierz Dolny" to miejscowość, chyba że stoi przy nim rola lub tytuł', () => {
  masked([
    ['Kazimierz Dolny leży nad Wisłą.', 'Kazimierz Dolny leży nad Wisłą.'],
    ['24-120 Kazimierz Dolny', `${KOD} ${C}`],
    ['Mieszka w Kazimierzu Dolnym od lat.', `Mieszka w ${C} od lat.`],
    ['Piotrków Trybunalski to miasto.', 'Piotrków Trybunalski to miasto.'],
    ['Pan Kazimierz Dolny złożył wniosek.', `Pan ${N} złożył wniosek.`],
    ['Wnioskodawca: Kazimierz Dolny', `Wnioskodawca: ${N}`],
    ['Świadek Kazimierz Dolny zeznał.', `Świadek ${N} zeznał.`],
    ['Zeznania złożył dr Kazimierz Dolny.', `Zeznania złożył dr ${N}.`],
    ['Kazimierz Nowak złożył wniosek.', `${N} złożył wniosek.`],
  ]);
});
test('K21: marker zamieszkania — formy z ogonkami, „zamieszkuje", koniec wiersza i CRLF', () => {
  masked([
    ['Jan Nowak, zam. w Krakowie\nPESEL 85031412347', `${N}, zam. w ${C}\nPESEL [PESEL]`],
    ['Jan Nowak, zam. w Krakowie\r\nPESEL 85031412347', `${N}, zam. w ${C}\r\nPESEL [PESEL]`],
    ['Jan Kowalski, zamieszkały w Krakowie\nPESEL 85031212343', `${N}, zamieszkały w ${C}\nPESEL [PESEL]`],
    ['zam. w Zielonej Górze\nPESEL 85031412347', `zam. w ${C}\nPESEL [PESEL]`],
    ['z Anną Nowak, zamieszkałą w Krakowie, zwaną dalej Najemcą.', `z ${N}, zamieszkałą w ${C}, zwaną dalej Najemcą.`],
    ['Pozwana zamieszkuje w Gdańsku od 2015 r.', `Pozwana zamieszkuje w ${C} od 2015 r.`],
    ['Świadek mieszkający w Poznaniu, przesłuchany.', `Świadek mieszkający w ${C}, przesłuchany.`],
    ['Powód zamieszkuje w Poznaniu przy ul. Grunwaldzkiej 104/6.', `Powód zamieszkuje w ${C} przy ${A}.`],
    ['Pozwany zamieszkiwał w Krakowie do 2019 r.', `Pozwany zamieszkiwał w ${C} do 2019 r.`],
    ['Powód zamieszkuje Poznań.', `Powód zamieszkuje ${C}.`],
    ['Wnioskodawca, z miejscem zamieszkania w Krakowie, wnosi o zwrot.', `Wnioskodawca, z miejscem zamieszkania w ${C}, wnosi o zwrot.`],
    ['Pod adresem zameldowania w Krakowie nikt nie odbiera.', `Pod adresem zameldowania w ${C} nikt nie odbiera.`],
    ['Brak stałego miejsca zamieszkania w Poznaniu uniemożliwia doręczenie.', `Brak stałego miejsca zamieszkania w ${C} uniemożliwia doręczenie.`],
    // 12g: łamanie wiersza po dacie urodzenia przed małym „w"
    ['ur. 03.11.1985 r.\nw Sosnowcu\nur. 03.11.1985 r. w Sosnowcu\n', `ur. [DATA-URODZENIA] r.\nw ${C}\nur. [DATA-URODZENIA] r. w ${C}\n`],
    ['Pani Anna Nowak, urodzona 12.03.1980 r. w Krakowie', `Pani ${N}, urodzona [DATA-URODZENIA] r. w ${C}`],
  ]);
});
test('K21: rzeczowniki i przymiotniki od „mieszkać" nie są markerem zamieszkania', () => {
  keep([
    'Zarząd Spółdzielni Mieszkaniowej w Krakowie ogłasza przetarg.',
    'Mieszkania w Krakowie drożeją najszybciej w kraju.',
    'Rynek mieszkaniowy w Krakowie zwalnia.',
    'Zameldowanie w Krakowie jest bezpłatne.',
    'Budynek mieszkalny w Krakowie wymaga remontu.',
    'Wydział Spraw Mieszkaniowych w Gdyni wydał decyzję.',
    'Biuro Mieszkalnictwa w Krakowie przyjmuje wnioski.',
    'Kupiłem mieszkanie w Krakowie.',
    'Lokal mieszkalny we Wrocławiu został sprzedany.',
    'Zamieszkanie w Krakowie było jego marzeniem.',
    'Spółdzielnia Mieszkaniowa w Krakowie\nzaprasza na zebranie.',
    'Ceny mieszkań w Krakowie wzrosły o 10%.',
    'Mieszkańcy w Poznaniu protestowali.',
    'Zamieszki w Poznaniu w 1956 r. upamiętniono.',
    'Sąd Okręgowy w Krakowie\nI Wydział Cywilny',
    'zamieszkały w Areszcie Śledczym\nw Katowicach',
  ]);
});
test('K21 pułapki: czasowniki, imiesłowy, „mieszkaniec" i nowe zdanie po dacie', () => {
  masked([
    ['Powód mieszka w Warszawie i pracuje w Krakowie.', `Powód mieszka w ${C} i pracuje w Krakowie.`],
    ['Mieszkam w Poznaniu od 2010 roku.', `Mieszkam w ${C} od 2010 roku.`],
    ['Świadkowie mieszkali w Lublinie przez dekadę.', `Świadkowie mieszkali w ${C} przez dekadę.`],
    ['Uczestnicy zameldowani w Krakowie otrzymają zwrot.', `Uczestnicy zameldowani w ${C} otrzymają zwrot.`],
    ['Jan Kowalski, mieszkaniec Krakowa, złożył skargę.', `${N}, mieszkaniec ${C}, złożył skargę.`],
    ['Anna Nowak, mieszkanka Gdańska, złożyła skargę.', `${N}, mieszkanka ${C}, złożyła skargę.`],
    ['Miejsce zamieszkania: Kraków', `Miejsce zamieszkania: ${C}`],
    ['zamieszkały w Polsce\nPESEL 85031412347', 'zamieszkały w Polsce\nPESEL [PESEL]'],
    ['Kowalski ur. 03.11.1985 r.\nW Sosnowcu odbyła się rozprawa.', `${N} ur. [DATA-URODZENIA] r.\nW Sosnowcu odbyła się rozprawa.`],
  ]);
});
test('K22: nazwisko-homonim miasta po imieniu albo „Pan/Pani" przed adresem to osoba, nie miasto', () => {
  masked([
    ['1. Jan Turek, ul. Długa 5, 00-001 Warszawa', `1. ${N}, ${A}, ${KOD} ${C}`],
    ['Wnioskodawca: Jan Turek, ul. Długa 5', `Wnioskodawca: ${N}, ${A}`],
    ['Jan Maria Turek, ul. Długa 5', `${N}, ${A}`],
    ['Pan Turek, ul. Długa 5', `Pan ${N}, ${A}`],
    ['Pani Anna Kalisz, ul. Długa 5', `Pani ${N}, ${A}`],
    ['Piotr Mielec, ul. Polna 3', `${N}, ${A}`],
  ]);
});
test('K22 pułapki: samo miasto, nazwa instytucji i patron przed adresem dalej dają [MIEJSCOWOŚĆ]', () => {
  masked([
    ['Turek, ul. Długa 5', `${C}, ${A}`],
    ['Warszawa, ul. Marszałkowska 10', `${C}, ${A}`],
    ['Nowa Sól, ul. Długa 5', `${C}, ${A}`],
    ['Bielsko-Biała, ul. Długa 5', `${C}, ${A}`],
    ['Starostwo Powiatowe Turek, ul. Kaliska 59', `Starostwo Powiatowe ${C}, ${A}`],
    ['Parafia pw. św. Stanisława Kalisz, ul. Polna 3', `Parafia pw. św. Stanisława ${C}, ${A}`],
    ['Pensjonat Maria Zakopane, ul. Kościeliska 5', `Pensjonat Maria ${C}, ${A}`],
    ['Pan Jan Kowalski w Gdańsku, ul. Długa 5', `Pan ${N} w ${C}, ${A}`],
  ]);
});
test('K23: generyczny klucz „name"/„osoba" — nazwa produktu i kategoria to nie osoba', () => {
  keep([
    '{"sku": "A-107", "name": "Róża pustyni", "price": "45.00"}',
    '<name>Róża pustyni</name>',
    '{"sku": "B-2", "name": "Lilia biała", "price": "9.00"}',
    '<osoba>prawna</osoba>',
    '{"name":"kalina"}',
  ]);
  masked([
    [
      '{"order": 77, "customer": {"name": "Anna Nowak"}, "items": [{"name": "Róża pnąca", "qty": 2}]}',
      `{"order": 77, "customer": {"name": "${N}"}, "items": [{"name": "Róża pnąca", "qty": 2}]}`,
    ],
  ]);
});
test('K23 pułapki: mocne klucze małymi literami, osoba pod „name" i nazwa konta dalej maskowane', () => {
  masked([
    ['{"firstName":"pamela","lastName":"nowak"}', `{"firstName":"${N}","lastName":"${N}"}`],
    ['{"first_name": "róża", "last_name": "pustyni"}', `{"first_name": "${N}", "last_name": "${N}"}`],
    ['{"fullName": "jan kowalski"}', `{"fullName": "${N}"}`],
    ['{"id": 2, "name": "jan kowalski"}', `{"id": 2, "name": "${N}"}`],
    ['{"id": 6, "name": "JAN KOWALSKI"}', `{"id": 6, "name": "${N}"}`],
    ['{"id": 5, "name": "Anna"}', `{"id": 5, "name": "${N}"}`],
    ['{"name":"a.kaminska","message":"a.kaminska"}', `{"name":"${N}","message":"a.kaminska"}`],
    ['<osoba>Jan Kowalski</osoba>', `<osoba>${N}</osoba>`],
    ['{"person": "Kowalski"}', `{"person": "${N}"}`],
  ]);
  expect(redactPII('<osoba>Jan Kowalski</osoba>', { pseudonyms: true }).redacted).toBe('<osoba>[OSOBA-A]</osoba>');
});
test('K23: puste oznaczenia („b.d.", „n.d.", „null", „none") w polach i loginie zostają', () => {
  keep([
    '{"imie": "b.d.", "nazwisko": "b.d."}\nImię: b.d.',
    'Imię: b.d',
    'Imię: B.D.',
    'Nazwisko: b. d.',
    'Nazwisko: n.d.',
    'Imię: null',
    '<Nazwisko>b.d.</Nazwisko>',
    '{"user":"null"}',
    '<Login>none</Login>',
    'Login: none',
    'Login: b.d.',
    'Rodzaj szkody: b.d. (wg zgłoszenia), kwota: b.d.',
  ]);
  masked([
    ['Imię: Jan', `Imię: ${N}`],
    ['Imię: J.', `Imię: ${N}`],
    ['Imię i nazwisko: J. Kowalski', `Imię i nazwisko: ${N}`],
    ['{"user":"jkowalski"}', '{"user":"[LOGIN]"}'],
    ['Login: j.nowak', 'Login: [LOGIN]'],
  ]);
});
// ── Audyt, partia b3: regresje po weryfikacji (runda 1) ──
test('b3-fix1 K20a: po rzeczowniku z wielkiej litery tylko głowa eponimu z dopełniaczem — osoba w masce', () => {
  masked([
    ['Kierownik Zespołu Kowalski zatwierdził urlop.', `Kierownik Zespołu ${N} zatwierdził urlop.`],
    ['Członkowie Zespołu Kowalski i Nowak podpisali protokół.', `Członkowie Zespołu ${N} i ${N} podpisali protokół.`],
    ['Dziekan Wydziału Prawa Kowalski otworzył konferencję.', `Dziekan Wydziału Prawa ${N} otworzył konferencję.`],
    ['Objaw Nowak zgłosiła się.', `Objaw ${N} zgłosiła się.`],
    ['Reakcja Kowalskiego na wezwanie do zapłaty była natychmiastowa.', `Reakcja ${N} na wezwanie do zapłaty była natychmiastowa.`],
    ['Prawo Wiśniewskiego do udziału w zysku nie budziło wątpliwości.', `Prawo ${N} do udziału w zysku nie budziło wątpliwości.`],
    ['Zespół Nowaka przygotował ofertę.', `Zespół ${N} przygotował ofertę.`],
    ['Choroba Nowaka uniemożliwiła mu stawiennictwo.', `Choroba ${N} uniemożliwiła mu stawiennictwo.`],
    ['IT\tTest\tNowak', `IT\tTest\t${N}`],
    ['Konflikt na linii Kowalski – Nowak trwał od lat.', `Konflikt na linii ${N} – ${N} trwał od lat.`],
    ['Kierownik linii Nowak polecił wyłączenie zasilania.', `Kierownik linii ${N} polecił wyłączenie zasilania.`],
    ['pracownik linii Gzowska, zeznała', `pracownik linii ${N}, zeznała`],
  ]);
  keep(['Odczyn Biernackiego przyspieszony.', 'Trójkąt Kocha', 'Na Moście Łazienkowskim korek.', 'Objaw Chełmońskiego ujemny.']);
});
test('b3-fix1 M11: tytuł patrona w adresie, a tytuł po nazwie miejsca zaczyna osobę', () => {
  masked([
    ['Adres: ul. dra Jana Kowalskiego 12/3, Kraków', `Adres: ${A}, ${C}`],
    ['Ulica dra Alfreda Sokołowskiego 4', A],
    ['ul. prof. dr. hab. Jana Nowaka 3', A],
    ['ul. bł. Karoliny Kózkówny 3', A],
    ['os. dra Jana Kowalskiego 4 m. 2', A],
    ['Na ul. Długiej lek. Anna Nowak udzieliła pierwszej pomocy.', `Na ul. Długiej lek. ${N} udzieliła pierwszej pomocy.`],
    ['W parku lek. Jan Kowalski reanimował poszkodowanego.', `W parku lek. ${N} reanimował poszkodowanego.`],
    [
      'Biegły ze Szpitala im. Mikołaja Kopernika lek. med. Jan Nowak zbadał powoda.',
      `Biegły ze Szpitala im. Mikołaja Kopernika lek. med. ${N} zbadał powoda.`,
    ],
    ['Kierownik placówki lek. med. Jan Kowalski', `Kierownik placówki lek. med. ${N}`],
    ['W przychodni osiedlowej lek. Anna Nowak przyjmuje', `W przychodni osiedlowej lek. ${N} przyjmuje`],
    ['Na parkingu lek. Jan Kowalski udzielił pomocy', `Na parkingu lek. ${N} udzielił pomocy`],
    ['Na placu Zamkowym dra Kowalskiego zaczepił nieznajomy.', `Na placu Zamkowym dra ${N} zaczepił nieznajomy.`],
  ]);
  keep([
    'Szpital im. lek. Jana Nowaka',
    'ulica gen. Władysława Andersa',
    'rondo Jana Pawła II',
    'Kwiaciarnia na placu Grzybowskim',
  ]);
});
test('b3-fix1: WERSALIKI po kotwicy ulicy — osoba w mianowniku i wyraz pochodny („PLACÓWKI") w masce', () => {
  masked([
    ['NA ULICY JAN KOWALSKI ZOSTAŁ POTRĄCONY.', `NA ULICY ${N} ZOSTAŁ POTRĄCONY.`],
    ['W PARKU DR JAN KOWALSKI UDZIELIŁ POMOCY.', `W PARKU DR ${N} UDZIELIŁ POMOCY.`],
    ['KIEROWNIK PLACÓWKI JOLANTA PYREK', `KIEROWNIK PLACÓWKI ${N}`],
    ['NADAWCA: SKLEP OSIEDLOWY JAN KOWALSKI', `NADAWCA: SKLEP OSIEDLOWY ${N}`],
    ['Odbiorca: FHU MOSTEK JAN NOWICKI', `Odbiorca: FHU MOSTEK ${N}`],
  ]);
  keep(['PRZY ALEI WŁADYSŁAWA SIKORSKIEGO', 'RONDO ROMANA DMOWSKIEGO']);
});
test('b3-fix1: „św." z mianownikiem to świadek także obok kościoła; wezwanie sądu to nie tytuł kościoła', () => {
  masked([
    ['Pożar kościoła widział św. Kowalski.', `Pożar kościoła widział św. ${N}.`],
    ['Mimo wezwania św. Tomasz Gzik nie stawił się.', `Mimo wezwania św. ${N} nie stawił się.`],
    ['Na wezwanie św. Kowalski stawił się na rozprawę.', `Na wezwanie św. ${N} stawił się na rozprawę.`],
    ['Na zgromadzeniu wspólników św. Wiśniewski oświadczył, że się zgadza.', `Na zgromadzeniu wspólników św. ${N} oświadczył, że się zgadza.`],
    ['Przy kaplicy św. Kowalska czekała na autobus.', `Przy kaplicy św. ${N} czekała na autobus.`],
  ]);
  keep([
    'Kościół pod wezwaniem św. Jana Chrzciciela',
    'Zgromadzenie Sióstr Miłosierdzia św. Wincentego a Paulo',
    'kościół św. Marka',
    'Parafia św. Jacka w Krakowie',
  ]);
});
test('b3-fix1 K23: „osoba"/„person" od wielkiej litery jak pełne imię i nazwisko; małe litery, gdy to osoba', () => {
  masked([
    ['{"osoba": "KOWALSKI JAN"}', `{"osoba": "${N}"}`],
    ['<osoba>Wróbel Anna</osoba>', `<osoba>${N}</osoba>`],
    ['<osoba>T. Gzik</osoba>', `<osoba>${N}</osoba>`],
    ['{"person": "van Dijk Jan"}', `{"person": "${N}"}`],
    ['{"osoba": "Kowalski J."}', `{"osoba": "${N}"}`],
    ['{"id": 7, "name": "anna"}', `{"id": 7, "name": "${N}"}`],
    ['{"name": "anna gzik"}', `{"name": "${N}"}`],
    ['{"name": "marek sowa"}', `{"name": "${N}"}`],
    ['{"osoba": "anna gzik"}', `{"osoba": "${N}"}`],
    ['{"name": "Jan van Dijk"}', `{"name": "${N}"}`],
  ]);
  keep([
    '{"name": "Kalina koralowa"}',
    '{"name": "Weronika kłosowa"}',
    '{"name": "róża pustyni"}',
    '{"person": "fizyczna"}',
    '<osoba>Prawna</osoba>',
  ]);
});
test('b3-fix1 K10: zdrobnienie-nazwisko (Kluczyk, Mieczyk) w środku zdania i po rozpoznaniu osoby w masce', () => {
  masked([
    ['Na rozprawie świadek Krzaczyk potwierdził, że Kluczyk był obecny.', `Na rozprawie świadek ${N} potwierdził, że ${N} był obecny.`],
    ['Wystawił: Tomasz Kluczyk\nOdebrał: Kluczyk', `Wystawił: ${N}\nOdebrał: ${N}`],
    ['Pozwany: Andrzej Mieczyk\nMieczyk zajmuje lokal bez tytułu prawnego.', `Pozwany: ${N}\n${N} zajmuje lokal bez tytułu prawnego.`],
    ['Kluczyk złożył wniosek o urlop.', `${N} złożył wniosek o urlop.`],
  ]);
  keep(['Kluczyk do skrzynki leży w szufladzie.', 'Chińczyk i Japończyk rozmawiali.', 'Słowniczyk pojęć znajduje się na końcu.']);
});
test('b3-fix1 K10: dopełniacz nazwisk na -ek („Placka", „Kąska") i nazwiska dwuczłonowe na -sko to osoba', () => {
  masked([
    ['Pełnomocnik Placka wniósł o oddalenie powództwa.', `Pełnomocnik ${N} wniósł o oddalenie powództwa.`],
    ['Sąd przesłuchał w charakterze strony powoda Kąska.', `Sąd przesłuchał w charakterze strony powoda ${N}.`],
    ['Wniosek złożyła Pasko-Gzowska.', `Wniosek złożyła ${N}.`],
    ['Zgodę wydała Pani Dyrektor Pasko-Gzowska.', `Zgodę wydała Pani Dyrektor ${N}.`],
  ]);
  keep(['Kłoski zboża leżały na polu.', 'Kiełbaska z grilla.', 'Kościół Ewangelicko-Augsburski', 'Parafia Rzymsko-Katolicka']);
});
test('b3-fix1 K07: numer domu przed datą — adres w masce, dzień i rok zostają; „Maja" z wielkiej litery to imię', () => {
  masked([
    ['Zdarzenie miało miejsce przy ul. Długiej 15 12 lipca 2023 r.', `Zdarzenie miało miejsce przy ${A} 12 lipca 2023 r.`],
    ['ul. Długa 5\t2024-05-12', `${A}\t2024-05-12`],
    ['ul. Polna 15 1998 r.', `${A} 1998 r.`],
    ['Zatrudniony w oddziale przy ul. Fabrycznej 3 2015–2019, następnie w centrali.', `Zatrudniony w oddziale przy ${A} 2015–2019, następnie w centrali.`],
    ['ul. Lipowa 12\tMaja Kowalska', `${A}\t${N}`],
    ['Odbiorca: Jan Kowalski, ul. Kwiatowa 7 kwietnia 2024', `Odbiorca: ${N}, ${A} kwietnia 2024`],
    ['Kowalski zamieszkały przy ul. Długiej 15 maja 2020 r. wezwany.', `${N} zamieszkały przy ${A} maja 2020 r. wezwany.`],
  ]);
  keep(['Marsz wyruszy z placu Piłsudskiego 11 listopada o godz. 12:00.', 'Walki przy ul. Okopowej 1944 r. 5 sierpnia trwały długo.']);
});
test('b3-fix1 K21: etykiety „Zamieszkanie:" i „miejscowość zamieszkania:" kotwiczą miasto, zdania ogólne bez maski', () => {
  masked([
    ['Zamieszkanie: Kraków', `Zamieszkanie: ${C}`],
    ['Zameldowanie: Wieliczka', `Zameldowanie: ${C}`],
    [
      'Wnioskodawca: Jan Kowalski, miejscowość zamieszkania: Tarnów, PESEL 85031412347.',
      `Wnioskodawca: ${N}, miejscowość zamieszkania: ${C}, PESEL [PESEL].`,
    ],
    ['Miasto zameldowania: Kraków', `Miasto zameldowania: ${C}`],
    ['gmina zameldowania: Kraków', `gmina zameldowania: ${C}`],
    ['Pod wskazanym adresem zamieszkuje Jarosław Wilk z konkubiną.', `Pod wskazanym adresem zamieszkuje ${N} z konkubiną.`],
    ['Lokal zamieszkują Jarosław i Anna Kowalscy.', `Lokal zamieszkują ${N} i ${N}.`],
    ['z Janem Kowalskim zamieszkującym w Gdańsku', `z ${N} zamieszkującym w ${C}`],
    ['Świadek mieszkający w Poznaniu, przesłuchany.', `Świadek mieszkający w ${C}, przesłuchany.`],
  ]);
  keep([
    'Program skierowany jest do osób zamieszkujących w Gdańsku.',
    'Osoby mieszkające w Krakowie mogą złożyć wniosek.',
    'Zamieszkującym w Gdańsku przysługuje ulga.',
    'Uczniowie mieszkający w Gdyni dojeżdżają autobusem.',
    'Zameldowanie w Krakowie trwa trzy dni.',
  ]);
});
test('b3-fix1 K20d: „Kazimierz Dolny" przy roli w dopełniaczu, drugim imieniu albo PESEL-u to osoba', () => {
  masked([
    ['Kazimierz Dolny (PESEL 85031412347) wnosi o', `${N} (PESEL [PESEL]) wnosi o`],
    ['Sąd zasądził od uczestnika Kazimierza Dolnego koszty.', `Sąd zasądził od uczestnika ${N} koszty.`],
    ['Pracodawca: Jan Kazimierz Dolny', `Pracodawca: ${N}`],
    ['Pan Jan Kazimierz Dolny, ul. Wesoła 1, 25-001 Kielce', `Pan ${N}, ${A}, [KOD-POCZTOWY] ${C}`],
  ]);
  keep(['Kazimierz Dolny leży nad Wisłą.', 'Wycieczka do Kazimierza Dolnego.']);
});
test('b3-fix1 K20: „im" bez kropki po nazwie szkoły czy szpitala to patron, zaimek dalej nie', () => {
  keep([
    'Szkoła Podstawowa nr 3 im Marii Konopnickiej w Lublinie',
    'Szkoła im Jana Pawła II',
    'Skierowanie do Szpitala im Mikołaja Kopernika w Łodzi',
  ]);
  masked([
    ['Pomógł im Jan Kowalski w przeprowadzce.', `Pomógł im ${N} w przeprowadzce.`],
    ['Dałem im Jana Kowalskiego za przykład.', `Dałem im ${N} za przykład.`],
  ]);
});
test('b3-fix1: pensjonat, „Stare Babice", wpis „Mazowiecka Anna", rola przed instytucją, „Pani Dyrektor Szkoły …"', () => {
  masked([
    ['nocleg w pensjonacie Maria Zakopane, ul. Kościeliska 5', `nocleg w pensjonacie Maria ${C}, ${A}`],
    ['ul. Rynek 21, 05-082 Stare Babice', `${A}, [KOD-POCZTOWY] ${C}`],
    ['Lista świadków:\nMazowiecka Anna\nNowak Jan', `Lista świadków:\n${N}\n${N}`],
    ['Lekarz Lisiecki Oddział Neurologii', `Lekarz ${N} Oddział Neurologii`],
    ['Kierowca Wąsowicz Zakład Transportu Miejskiego', `Kierowca ${N} Zakład Transportu Miejskiego`],
    ['Szanowna Pani Dyrektor Szkoły Gzowska,', `Szanowna Pani Dyrektor Szkoły ${N},`],
    ['Szanowny Pan Komendant Policji Lisiecki', `Szanowny Pan Komendant Policji ${N}`],
  ]);
  keep(['Odwiedziliśmy Biebrzański Park Narodowy.', 'Pani Minister Zdrowia']);
});
test('b3-fix1 pułapki: poprawki nie odsłaniają ani nie nadmaskowują sąsiednich przypadków', () => {
  masked([
    ['Pani Minister Zdrowia Kowalska', `Pani Minister Zdrowia ${N}`],
    ['Pani Kierownik Działu Kadr Gzowska', `Pani Kierownik Działu Kadr ${N}`],
    ['W parku dr Kowalski udzielił pomocy.', `W parku dr ${N} udzielił pomocy.`],
    ['T12. Mieszkając w Krakowie, często bywał w teatrze.', `T12. Mieszkając w ${C}, często bywał w teatrze.`],
    // „zamieszkał-/zameldowan-" po rzeczowniku zbiorowym jak przed partią b3
    ['Dzieci zameldowane w Poznaniu.', `Dzieci zameldowane w ${C}.`],
    ['Osoba zamieszkująca w Gdańsku złożyła wniosek.', `Osoba zamieszkująca w ${C} złożyła wniosek.`],
    ['86-170 Nowe Tel. 52 333 44 55', '[KOD-POCZTOWY] [MIEJSCOWOŚĆ] Tel. [TELEFON]'],
    ['48-210 Biała Polska', '[KOD-POCZTOWY] [MIEJSCOWOŚĆ] Polska'],
    ['86-170 Nowe\t\tWarszawa', '[KOD-POCZTOWY] [MIEJSCOWOŚĆ]\t\tWarszawa'],
    ['{"name": "nowak anna"}', `{"name": "${N}"}`],
  ]);
  keep([
    'Pani Kierownik Działu Kadr',
    'Chłopczyk bawił się w piaskownicy.',
    'Kaska ochronna jest obowiązkowa.',
    '<Name>pasta Barbara</Name>',
    '{"person": "Osoba Fizyczna"}',
    'Parafia św. Stanisława Kostki',
    'PLAC MARII KONOPNICKIEJ',
    'ALEJA STANISŁAWA KONARSKIEGO',
  ]);
});
test('b3-fix1: imię w dopełniaczu to patron, imię w mianowniku za nazwą ulicy to osoba', () => {
  keep([
    'Szpital im. dr Anny Nowak w Lublinie',
    'Szkoła im. prof. Haliny Nowak',
    'Szpital im. dra Aleksandra Kowalskiego',
    'Szpital im. dra Franciszka Raszei',
    'przy ulicy Emilii Plater',
    'ul. Marszałka Józefa Piłsudskiego',
    'ul. Królowej Jadwigi',
    'przy alei Jana Pawła II',
    'przy uliczce Jana Kowalskiego',
    'Kwiaciarnia na placu Grzybowskim',
  ]);
  masked([
    ['W parku lek. Aleksandra Nowak udzieliła pomocy.', `W parku lek. ${N} udzieliła pomocy.`],
    ['NA ULICY ALEKSANDRA NOWAK ZOSTAŁA POTRĄCONA.', `NA ULICY ${N} ZOSTAŁA POTRĄCONA.`],
    ['Na ulicy Jan Kowalski zasłabł.', `Na ulicy ${N} zasłabł.`],
    ['W parku Anna Nowak spacerowała z psem.', `W parku ${N} spacerowała z psem.`],
    ['Na skwerze Jan Kowalski karmił gołębie.', `Na skwerze ${N} karmił gołębie.`],
    ['Na ul. Długiej Jan Kowalski zasłabł.', `Na ul. Długiej ${N} zasłabł.`],
    ['W uliczce Jan Kowalski zaparkował.', `W uliczce ${N} zaparkował.`],
    ['Pomogłem im. Dr Jan Kowalski przyszedł później.', `Pomogłem im. Dr ${N} przyszedł później.`],
    ['na moście Kowalski potrącił pieszego', `na moście ${N} potrącił pieszego`],
  ]);
});
test('b3-fix1: dzień przed miesiącem — etykieta osoby, „Maja" i wielka litera miesiąca', () => {
  keep([
    'Miejsce: Warszawa, plac Piłsudskiego 11 listopada 2024 r.',
    'Termin: Poniedziałek, ul. Polna 3 maja',
    'Obchody na placu Piłsudskiego 11 Listopada.',
    'Uroczystość przy ul. Mickiewicza 3 Maja o godz. 12.',
  ]);
  masked([
    ['Odbiorca: Kowalski Jan, ul. Kwiatowa 7 kwietnia 2024', `Odbiorca: ${N}, ${A} kwietnia 2024`],
    ['ul. Lipowa 12 MAJA KOWALSKA', `${A} ${N}`],
  ]);
});
test('b3-fix1: pole „osoba" z jednym wyrazem, pensjonat, złożenia „Polsko-…", marker w liczbie pojedynczej', () => {
  keep([
    '<osoba>Pracownik</osoba>',
    '{"osoba": "Klient"}',
    '{"person": "Admin"}',
    '<osoba>Wnioskodawca</osoba>',
    'Polsko-Szwedzka Izba Gospodarcza',
    'Polsko-Kanadyjska Rada',
    'Mieszkańcom mieszkającym w Gdyni przysługuje ulga.',
  ]);
  masked([
    ['<osoba>Kowalski</osoba>', `<osoba>${N}</osoba>`],
    ['<osoba>Wróbel</osoba>', `<osoba>${N}</osoba>`],
    ['Pracownik w hotelu Jan Kalisz, ul. Długa 5', `Pracownik w hotelu ${N}, ${A}`],
    ['w willi Zofia Zakopane, ul. Kościeliska 7', `w willi Zofia ${C}, ${A}`],
    ['Wniosek złożyła Dacko-Brzęczyk.', `Wniosek złożyła ${N}.`],
    ['Mieszkająca w Krakowie powódka wniosła pozew.', `Mieszkająca w ${C} powódka wniosła pozew.`],
    ['Na rzecz osoby zamieszkującej w Gdańsku przyznano zasiłek.', `Na rzecz osoby zamieszkującej w ${C} przyznano zasiłek.`],
  ]);
});
test('b3-fix2: człon nazwy po „Nowe/Biała" tylko na końcu pola — imię, nazwisko, instytucja i etykieta zostają poza maską miasta', () => {
  masked([
    ['ul. Polna 3, 86-170 Nowe Anna Gzik', `${A}, [KOD-POCZTOWY] ${C} ${N}`],
    ['48-210 Biała Anna Gzik', `[KOD-POCZTOWY] ${C} ${N}`],
    ['86-170 Nowe Damian Fic', `[KOD-POCZTOWY] ${C} ${N}`],
    ['86-170 Nowe Kowalska Anna', `[KOD-POCZTOWY] ${C} ${N}`],
    ['86-170 Nowe Sąd Rejonowy', `[KOD-POCZTOWY] ${C} Sąd Rejonowy`],
    ['86-170 Nowe Kontakt: 600 100 200', `[KOD-POCZTOWY] ${C} Kontakt: [TELEFON]`],
    ['86-170 Nowe Godziny otwarcia: 8-16', `[KOD-POCZTOWY] ${C} Godziny otwarcia: 8-16`],
    ['48-210 Biała Faktura VAT nr 12/2026', `[KOD-POCZTOWY] ${C} Faktura VAT nr 12/2026`],
    ['77-330 Czarne Konto: PKO BP', `[KOD-POCZTOWY] ${C} Konto: PKO BP`],
    // pułapki: człon nazwy dalej w masce, także w polu JSON/XML, przed adnotacją TERYT i przed osobą
    ['ul. Rynek 21, 05-082 Stare Babice', `${A}, [KOD-POCZTOWY] ${C}`],
    ['05-500 Nowa Iwiczna, ul. Polna 3', `[KOD-POCZTOWY] ${C}, ${A}`],
    ['05-082 Stare Babice woj. mazowieckie', `[KOD-POCZTOWY] ${C} woj. mazowieckie`],
    ['{"adres":"ul. Lipowa 3, 05-082 Stare Babice","kod":"05-082"}', `{"adres":"${A}, [KOD-POCZTOWY] ${C}","kod":"[KOD-POCZTOWY]"}`],
    ['<AdresL2>05-082 Stare Babice</AdresL2>', `<AdresL2>[KOD-POCZTOWY] ${C}</AdresL2>`],
    ['ul. Rynek 21, 05-082 Stare Babice (gmina wiejska)', `${A}, [KOD-POCZTOWY] ${C} (gmina wiejska)`],
    ['62-080 Nowa Wieś Tarnowska', `[KOD-POCZTOWY] ${C}`],
    ['05-082 Stare Babice Kowalski Jan', `[KOD-POCZTOWY] ${C} ${N}`],
    ['86-170 Nowe Tel. 52 333 44 55', `[KOD-POCZTOWY] ${C} Tel. [TELEFON]`],
    ['48-210 Biała Polska', `[KOD-POCZTOWY] ${C} Polska`],
  ]);
});
test('b3-fix2: marker zamieszkania w zdaniu ogólnym (ogłoszenie, uchwała, poradnik, statystyka) — miasto jawne', () => {
  keep([
    'Osoba mieszkająca w Krakowie może złożyć wniosek.',
    'Każdy mieszkający w Poznaniu może skorzystać z programu.',
    'Rodzina mieszkająca w Lublinie otrzyma bon.',
    'Zamieszkuje w Krakowie ok. 800 tys. osób.',
    'Mieszkając w Krakowie, można korzystać z karty miejskiej.',
    'Mieszkając w Gdańsku, warto mieć kartę mieszkańca.',
    'Pracownikom zamieszkującym w Gdańsku przysługuje dodatek.',
    'Pacjentom mieszkającym w Gdańsku przysługuje transport.',
    'Najemcom zamieszkującym w Gdańsku przysługuje zniżka.',
    'Ukraińcy mieszkający w Lublinie zorganizowali zbiórkę.',
    'Pracownicy mieszkający w Gdyni mogą dojeżdżać pociągiem.',
    'Turyści mieszkający w Zakopanem skarżą się na ceny.',
    'Ci, którzy mieszkają w Krakowie, mogą odebrać kartę.',
    'Mieszkańcom mieszkającym w Gdyni przysługuje ulga.',
  ]);
  // pułapki: konkretna osoba (czas przeszły, strona postępowania, nazwisko) dalej w masce
  masked([
    ['Osoba zamieszkująca w Gdańsku złożyła wniosek.', `Osoba zamieszkująca w ${C} złożyła wniosek.`],
    ['Rodzina mieszkająca w Lublinie zgłosiła się do MOPS.', `Rodzina mieszkająca w ${C} zgłosiła się do MOPS.`],
    ['T12. Mieszkając w Krakowie, często bywał w teatrze.', `T12. Mieszkając w ${C}, często bywał w teatrze.`],
    ['Pozwany, mieszkając w Krakowie, nie mógł stawić się.', `Pozwany, mieszkając w ${C}, nie mógł stawić się.`],
    ['Pozwani mieszkający w Krakowie wnieśli sprzeciw.', `Pozwani mieszkający w ${C} wnieśli sprzeciw.`],
    ['Powodowie zamieszkujący w Gdańsku wnieśli pozew.', `Powodowie zamieszkujący w ${C} wnieśli pozew.`],
    ['Zamieszkuje w Krakowie od 2015 r.', `Zamieszkuje w ${C} od 2015 r.`],
    ['Wnioskodawca mieszkający w Krakowie może odebrać decyzję.', `Wnioskodawca mieszkający w ${C} może odebrać decyzję.`],
  ]);
});
test('b3-fix2: etykieta „Miejsce/Miejscowość/Gmina zamieszkania" bez dwukropka podaje miasto, także imię-toponim', () => {
  masked([
    ['Miejsce zamieszkania\tJarosław', `Miejsce zamieszkania\t${C}`],
    ['Miejsce urodzenia Jarosław', `Miejsce urodzenia ${C}`],
    ['Miejsce pobytu\tJarosław', `Miejsce pobytu\t${C}`],
    ['Miejscowość zamieszkania\tKazimierz Dolny', `Miejscowość zamieszkania\t${C}`],
    ['Gmina zamieszkania Kazimierz Dolny', `Gmina zamieszkania ${C}`],
    // pułapka: po czasowniku imię dalej zaczyna podmiot
    ['Pod wskazanym adresem zamieszkuje Jarosław Wilk z konkubiną.', `Pod wskazanym adresem zamieszkuje ${N} z konkubiną.`],
  ]);
});
test('b3-fix2: jeden wyraz pod „osoba"/„person" to osoba, chyba że rola lub kategoria; tytuł i inicjał nie wyłączają maski', () => {
  masked([
    ['{"osoba": "Gzik"}', `{"osoba": "${N}"}`],
    ['<person>Gzik</person>', `<person>${N}</person>`],
    ['{"person": "Smith"}', `{"person": "${N}"}`],
    ['{"person": "dr Gzik"}', `{"person": "${N}"}`],
    ['<osoba>lek. Gzik</osoba>', `<osoba>${N}</osoba>`],
    ['{"osoba": "GZIK"}', `{"osoba": "${N}"}`],
    ['{"person": "Fic-Gzik"}', `{"person": "${N}"}`],
    ['{"osoba": "gzik"}', `{"osoba": "${N}"}`],
    ['{"klient": {"osoba": "Bednarz", "telefon": "601 234 567"}}', `{"klient": {"osoba": "${N}", "telefon": "[TELEFON]"}}`],
    ['{"name": "j. kowalski"}', `{"name": "${N}"}`],
    ['{"name": "dr kowalski"}', `{"name": "${N}"}`],
    ['<name>a. nowak</name>', `<name>${N}</name>`],
    ['{"name": "maja gzik"}', `{"name": "${N}"}`],
    ['{"name": "wiktoria kos"}', `{"name": "${N}"}`],
    ['{"name": "kasia z księgowości"}', `{"name": "${N}"}`],
  ]);
  expect(redactPII('{"osoba": "Gzik"}', { pseudonyms: true }).redacted).toBe('{"osoba": "[OSOBA-A]"}');
  keep([
    '<osoba>Pracownik</osoba>',
    '{"osoba": "Klient"}',
    '{"person": "Admin"}',
    '<osoba>Wnioskodawca</osoba>',
    '<osoba>Prawna</osoba>',
    '{"person": "fizyczna"}',
    '{"person": "Osoba Fizyczna"}',
    '{"osoba": "Tak"}',
    '{"osoba": "Matka"}',
    '{"name": "róża pustyni"}',
    '{"name": "kalina koralowa"}',
    '{"name": "pola lawendy"}',
    '{"name":"kalina"}',
    '<Name>pasta Barbara</Name>',
  ]);
});
test('b3-fix2: po „św." biernik imienia, inicjał i osoba za patronem w mianowniku to osoba', () => {
  masked([
    ['W kościele przesłuchano św. Annę Gzik.', `W kościele przesłuchano św. ${N}.`],
    ['W kościele przesłuchano św. J. Kowalskiego.', `W kościele przesłuchano św. ${N}.`],
    ['W sprawie kradzieży z kościoła przesłuchano św. Annę Gzowską.', `W sprawie kradzieży z kościoła przesłuchano św. ${N}.`],
    ['W kościele św. Anny Jan Bednarz zagra koncert kolęd.', `W kościele św. Anny ${N} zagra koncert kolęd.`],
    ['Organista parafii św. Józefa Marek Sikora zaprasza chętnych do chóru.', `Organista parafii św. Józefa ${N} zaprasza chętnych do chóru.`],
    ['W kaplicy św. Rocha Teresa Wróbel prowadzi Koło Różańcowe.', `W kaplicy św. Rocha ${N} prowadzi Koło Różańcowe.`],
    ['W parafii bł. Karoliny Anna Gzik prowadzi chór.', `W parafii bł. Karoliny ${N} prowadzi chór.`],
    ['W parafii pw. św. Jakuba Anna Gzik prowadzi scholę.', `W parafii pw. św. Jakuba ${N} prowadzi scholę.`],
    ['Szkoła im. Marii Konopnickiej Anna Nowak dyrektor', `Szkoła im. Marii Konopnickiej ${N} dyrektor`],
  ]);
  expect(redactPII('W kościele św. Barbary Anna Gzik i Marek Gzik wezmą ślub.', { pseudonyms: true }).redacted).toBe(
    'W kościele św. Barbary [OSOBA-A] i [OSOBA-A] wezmą ślub.',
  );
  // pułapki: patron w dopełniaczu zostaje
  keep([
    'Kościół św. Piotra Apostoła',
    'Parafia św. Stanisława Kostki',
    'Parafia pw. św. Jana Pawła II',
    'Parafia św. Maksymiliana Kolbego w Krakowie',
    'W kościele św. Anny odbył się koncert.',
    'Kościół pod wezwaniem św. Jana Chrzciciela',
    'ul. Marszałka Józefa Piłsudskiego',
  ]);
});
test('b3-fix2: zdrobnienie-nazwisko (Kluczyk, Mieczyk) jest rzeczownikiem tylko przed przyimkiem albo przymiotnikiem', () => {
  masked([
    ['Mieczyk nie stawił się na rozprawę.', `${N} nie stawił się na rozprawę.`],
    ['Kluczyk oświadcza, że zapłaci.', `${N} oświadcza, że zapłaci.`],
    ['Mieczyk wnosi o oddalenie powództwa.', `${N} wnosi o oddalenie powództwa.`],
    ['Kluczyk także złożył wniosek.', `${N} także złożył wniosek.`],
    ['Krzaczyk, wezwany prawidłowo, nie stawił się.', `${N}, wezwany prawidłowo, nie stawił się.`],
    ['Kluczyk prosi o dostęp.', `${N} prosi o dostęp.`],
    ['Krzaczyk\nKierownik działu IT', `${N}\nKierownik działu IT`],
    ['Badanie wykonał lek. Kluczyk.', `Badanie wykonał lek. ${N}.`],
    ['Konsultacja: dr n. med. Krzaczyk', `Konsultacja: dr n. med. ${N}`],
    ['Zlecenie wystawił inż. Kluczyk.', `Zlecenie wystawił inż. ${N}.`],
    ['Kluczyk (magazynier) odebrał towar.', `${N} (magazynier) odebrał towar.`],
    ['Z poważaniem\nKluczyk', `Z poważaniem\n${N}`],
    ['Krzaczyk, ur. 12.03.1980 r., zatrudniony od 2010 r.', `${N}, ur. [DATA-URODZENIA] r., zatrudniony od 2010 r.`],
    ['Kluczyk – magazynier, Nowak – kierowca', `${N} – magazynier, ${N} – kierowca`],
  ]);
  keep([
    'Kluczyk do skrzynki leży w szufladzie.',
    'Kluczyk zapasowy jest w sejfie.',
    'Mieczyk ogrodowy kwitnie latem.',
    'Kluczyk od szafki zginął.',
    'Chińczyk i Japończyk rozmawiali.',
    'Słowniczyk pojęć znajduje się na końcu.',
  ]);
});
test('b3-fix2: przymiotnik ze stoplisty z mocną kotwicą osoby to nazwisko w szyku „Nazwisko Imię"', () => {
  masked([
    ['Strażacki Jan, ur. 12.03.1980 r.', `${N}, ur. [DATA-URODZENIA] r.`],
    ['Wnioskodawca: Białowieski Jan', `Wnioskodawca: ${N}`],
    ['Wnioskodawca: Mazowiecki Jan', `Wnioskodawca: ${N}`],
    ['1. Poleski Jan\n2. Nowak Anna', `1. ${N}\n2. ${N}`],
    ['Pan Poselski złożył wniosek.', `Pan ${N} złożył wniosek.`],
    ['Pan Pielęgniarski przyszedł.', `Pan ${N} przyszedł.`],
    ['Mazowiecka Maja\nJan Kowalski', `${N}\n${N}`],
    ['Poznańska Wiktoria\nJan Kowalski', `${N}\n${N}`],
    ['Gdańska Pola\nAnna Nowak', `${N}\n${N}`],
  ]);
  // pułapki: nazwa z imieniem-rzeczownikiem, urząd po roli, przymiotnik w nazwie i „Pani Dziecka"
  masked([['Olimpijska Nadzieja\nRzymska Diana\nWielka Nadzieja', `Olimpijska Nadzieja\n${N}\nWielka Nadzieja`]]);
  keep([
    'Pan Wojewoda Mazowiecki wydał decyzję.',
    'Pan Wojewoda Kujawsko-Pomorski podpisał.',
    'Czy u Pani Dziecka występują objawy?',
    'Poselski projekt ustawy trafił do Sejmu.',
    'Opieka Pielęgniarska w domu chorego.',
    'Polski Związek Wędkarski',
  ]);
});
test('b3-fix2: tabulator to granica komórki — przysłówek, pora czy głowa nazwy w sąsiedniej kolumnie nie odsłania nazwiska', () => {
  masked([
    ['Tak\tKaczyński\tUrząd Miasta', `Tak\t${N}\tUrząd Miasta`],
    ['Od\tLisiecki\tUrząd Skarbowy', `Od\t${N}\tUrząd Skarbowy`],
    ['Rano\tKaczyński\tOddział Chirurgii', `Rano\t${N}\tOddział Chirurgii`],
    ['2024-05-12\tNoc\tLisiecki\tSOR', `2024-05-12\tNoc\t${N}\tSOR`],
    ['Pokój\tSiedlecki', `Pokój\t${N}`],
    ['Brama\tWąsowicz', `Brama\t${N}`],
    ['Dzień Sosnowski', `Dzień ${N}`],
    ['Tydzień Gzowski – urlop', `Tydzień ${N} – urlop`],
    // przymiotnik nieuzgodniony z rodzajem głowy nazwy nie jest jej członem
    ['Noc Brzozowski spędził w policyjnej celi.', `Noc ${N} spędził w policyjnej celi.`],
  ]);
  keep([
    'Kościół Mariacki w Krakowie pochodzi z XIV wieku.',
    'Noc Świętojańska to najkrótsza noc roku.',
    'Brama Floriańska',
    'Kanał Sueski',
    'Cmentarz Rakowicki',
    'Odwiedziliśmy Biebrzański Park Narodowy.',
    'Dzień Papieski',
  ]);
});
test('b3-fix2: „im" bez kropki po placówce na początku komórki, wartości JSON i wiersza wykazu to patron', () => {
  keep([
    'Wykaz:\nSzpital im Mikołaja Kopernika',
    'Lp.;Nazwa szkoły\n1;Szkoła Podstawowa im Marii Konopnickiej',
    '{"nazwa": "Szkoła Podstawowa im Marii Konopnickiej"}',
    '"Gimnazjum im Jana Pawła II";"Lublin"',
    'Placówki:\nLiceum im Jana Zamoyskiego',
    'Hospicjum im Jana Pawła II w Katowicach',
    'Przychodnia im Józefa Strusia',
    'Dom Pomocy Społecznej im Jana Pawła II',
    'Klinika im Mikołaja Kopernika',
    'Sanatorium im Józefa Piłsudskiego',
  ]);
  masked([
    ['Pomógł im Jan Kowalski w przeprowadzce.', `Pomógł im ${N} w przeprowadzce.`],
    ['Powiedziałem im:\nJan Kowalski przyjdzie jutro.', `Powiedziałem im:\n${N} przyjdzie jutro.`],
  ]);
});
test('b3-fix2: po głowie eponimu wyłącza nazwisko tylko znany eponim — pacjent i pracownik w dopełniaczu w masce', () => {
  masked([
    ['Poszkodowany wykonywał pracę na polecenie mistrza linii Kowalskiego.', `Poszkodowany wykonywał pracę na polecenie mistrza linii ${N}.`],
    ['Wypadek zgłosił brygadziście linii Nowakowi.', `Wypadek zgłosił brygadziście linii ${N}.`],
    ['Operatorzy Linii Nowaka zgłosili awarię.', `Operatorzy Linii ${N} zgłosili awarię.`],
    ['Objawy Kowalskiej ustąpiły po leczeniu.', `Objawy ${N} ustąpiły po leczeniu.`],
    ['Objawy Nowaka nasiliły się w nocy.', `Objawy ${N} nasiliły się w nocy.`],
    ['Odruch Kowalskiej prawidłowy.', `Odruch ${N} prawidłowy.`],
    ['Prątki Wąsowicza okazały się wrażliwe na leki.', `Prątki ${N} okazały się wrażliwe na leki.`],
    ['Szybki odruch Kowalskiego uratował życie dziecka.', `Szybki odruch ${N} uratował życie dziecka.`],
    ['Stwierdzono, że uprząż Nowaka była zużyta.', `Stwierdzono, że uprząż ${N} była zużyta.`],
  ]);
  expect(
    redactPII('Pacjent Tadeusz Nowacki trafił na SOR. Objawy Nowackiego nasiliły się w nocy.', { pseudonyms: true }).redacted,
  ).toBe('Pacjent [OSOBA-A] trafił na SOR. Objawy [OSOBA-A] nasiliły się w nocy.');
  keep([
    'Odruch Babińskiego dodatni.',
    'Prątek Kocha w posiewie.',
    'Założono uprząż Pawlika.',
    'Objaw Babińskiego ujemny.\nObjaw Brudzińskiego ujemny.',
    'Odczyn Biernackiego przyspieszony.',
    'Cięcie wzdłuż linii Langera.',
    'Stwierdzono dystrofię Fuchsa.',
    'Objaw Chełmońskiego ujemny.',
    'Korek na moście Łazienkowskim od rana.',
  ]);
});
test('b3-fix2: „Pan/Pani + rola + urząd" — nazwa placówki w dopełniaczu i miasto po „Miasta" nie są nazwiskiem', () => {
  keep([
    'Szanowna Pani Dyrektor Szpitala Grochowskiego,',
    'Szanowny Pan Dyrektor Szpitala Bielańskiego',
    'Szanowna Pani Dyrektor Szpitala Narutowicza,',
    'Pan Burmistrz Miasta Turek przekazał pismo.',
  ]);
  masked([
    ['Szanowna Pani Dyrektor Szkoły Gzowska,', `Szanowna Pani Dyrektor Szkoły ${N},`],
    ['Pismo do Pani Dyrektor Szkoły Kowalskiej', `Pismo do Pani Dyrektor Szkoły ${N}`],
    ['Pismo Pana Dyrektora Szpitala Kowalskiego', `Pismo Pana Dyrektora Szpitala ${N}`],
    ['Pani Minister Zdrowia Kowalska', `Pani Minister Zdrowia ${N}`],
  ]);
});

// ── Audyt, partia b4: wyciek fragmentu (prefiks telefonu, PESEL z odstępami, domknięcia osób, miasta, konto) ──
const T = '[TELEFON]';
test('K13: prefiks kraju 0048, (48), (+48), 48 bez separatora i zero międzymiastowe — numer w całości', () => {
  masked([
    ['tel.: 0048 12 634 55 21\ntel. (48) 61 852 33 49', `tel.: ${T}\ntel. ${T}`],
    ['tel. 22 501 23 45, 0048 22 501 23 46', `tel. ${T}, ${T}`],
    ['Kontakt: 0048 22 501 23 45', `Kontakt: ${T}`],
    ['tel. 0048 (61) 852 33 49', `tel. ${T}`],
    ['tel./fax (0048) 61 852 33 49', `tel./fax ${T}`],
    ['nr tel. 0048 61-852-33-49.', `nr tel. ${T}.`],
    ['kontakt 00 48 12 634 55 21', `kontakt ${T}`],
    ['tel. 48512345678', `tel. ${T}`],
    ['tel. 512345678, 48601234567', `tel. ${T}, ${T}`],
    ['tel. 4822 123 45 67', `tel. ${T}`],
    ['T: +48 (0)22 395 41 00', `T: ${T}`],
    ['Tel.: +48 (0) 22 395 41 00', `Tel.: ${T}`],
    ['T: 0048 (0)22 395 41 00', `T: ${T}`],
    ['Tel. +48 (0)22 395 41 00, +48 (0)22 395 41 01', `Tel. ${T}, ${T}`],
    ['+48 (0)512 345 678', T],
    ['tel. (0-61) 852 33 44\ntel./fax (061) 852 33 45', `tel. ${T}\ntel./fax ${T}`],
    ['tel. 600 100 200, (0-22) 501 23 45', `tel. ${T}, ${T}`],
  ]);
});
test('K13: nawias przed prefiksem należy do numeru, a „nr" przed „+48" nie wyłącza maski', () => {
  masked([
    ['(+48) 512 345 678 to mój nowy', `${T} to mój nowy`],
    ['tel. (+48) 512 345 678', `tel. ${T}`],
    ['(0048) 512 345 678 x', `${T} x`],
    ['(+48 22) 654 32 10', T],
    ['( +48 ) 512 345 678', T],
    ['(+48) 512 345 678, (+48) 600 100 200', `${T}, ${T}`],
    ['na nr (+48) 512 345 678.', `na nr ${T}.`],
    ['Proszę dzwonić pod nr +48 22 501 23 45.', `Proszę dzwonić pod nr ${T}.`],
    ['pod nr +48501234567.', `pod nr ${T}.`],
    ['tel. nr +48 22 501 23 45', `tel. nr ${T}`],
    // numer domknięty w nawiasie — nawias zostaje
    ['Proszę dzwonić (+48 512 345 678).', `Proszę dzwonić (${T}).`],
  ]);
});
test('K13 pułapki: kierunkowy Radomia, zła długość, „00" po „nr", obce prefiksy i kwoty bez zmian', () => {
  masked([
    ['tel. (48) 362 12 34', `tel. ${T}`],
    ['tel. 48 362 12 34', `tel. ${T}`],
  ]);
  keep([
    'Zamówienie nr 0048512345678 zostało wysłane.',
    'pod nr 0048 22 501 23 45.',
    'Faktura nr 48512345678',
    'kontakt z 48 osobami',
    'tel. 4851234567',
    'tel. 485123456789',
    'tel. 0048 512 345',
    'faks 0048',
    'Biuro w Berlinie: +49 (0)30 1234 5678',
    'London office: +44 (0)20 7946 0958',
    'Wynik kwartalny: +48 (0) mln zł wobec 2023 r.',
    'Kwota (48) 512 345 678 zł',
    'Kod ewidencyjny +48 (0)22 395 41 001 w rejestrze.',
    'Kontakt: 48 osób, koszt 600 100 200 zł.',
    'Kontakt: (48) 12 34 56',
    'Kierunkowy Polski to (+48).',
    'Zapłacono 512 345 678 zł (+48 zł prowizji).',
    'Przelew BLIK 48600123456',
    'Kontakt telefoniczny 12.10.2026 9',
    'Kontakt 01.10.2026 10:30',
    '(061) 852 33 45',
  ]);
});
test('K30: PESEL, NIP i REGON z etykietą i odstępami między cyframi — numer w całości', () => {
  masked([
    ['PESEL: 851 103 142 83', 'PESEL: [PESEL]'],
    ['Numer PESEL: 85 110 314 283', 'Numer PESEL: [PESEL]'],
    ['PESEL: 851-103-142-83', 'PESEL: [PESEL]'],
    ['PESEL: 851103 14283', 'PESEL: [PESEL]'],
    ['PESEL 8511 0314 283', 'PESEL [PESEL]'],
    ['PESEL: 8 5 1 1 0 3 1 4 2 8 3', 'PESEL: [PESEL]'],
    ['PESEL: |8|5|1|1|0|3|1|4|2|8|3|', 'PESEL: |[PESEL]|'],
    ['Jan Kowalski, PESEL 851103 14283', `${N}, PESEL [PESEL]`],
    // grupy z literówką w sumie — silna etykieta wygrywa jak przy zapisie ciągiem
    ['PESEL: 851 103 142 84', 'PESEL: [PESEL]'],
    ['NIP: 5 2 6 0 2 5 0 2 7 4', 'NIP: [NIP]'],
    ['NIP: 5260 2502 74', 'NIP: [NIP]'],
    ['REGON: 0 1 2 3 4 5 6 7 5', 'REGON: [REGON]'],
    ['REGON 012-345-675', 'REGON [REGON]'],
  ]);
});
test('K30 pułapki: bez etykiety, wzór z instrukcji, zła długość i liczba po etykiecie bez zmian', () => {
  masked([
    ['Jan Kowalski 501 120 345 43', `${N} ${T} 43`],
    ['PESEL: 85110314283 12 szt.', 'PESEL: [PESEL] 12 szt.'],
    ['PESEL lub NIP 123 456 32 18', 'PESEL lub NIP [NIP]'],
  ]);
  keep([
    'Faktura nr 851 103 142 83',
    'Rejestr PESEL obejmuje 38 411 148 osób (stan na 2023 r.).',
    'Tabela 3: 8 5 1 1 0 3 1 4 2 8 3',
    'Kod partii 851103 14283 z dnia 03.11.2025.',
    'Numer PESEL zmieniono 2 razy, w 2019 i 2021 r.',
    'Pole PESEL: 1 2 3 4 5 6 7 8 9 0 1 (wzór z instrukcji)',
    'Wnioskodawca nie posiada numeru PESEL, nr sprawy 123 456 78 90 1.',
    'Nr PESEL 851103 1428 (brakuje cyfry)',
    'REGON 9 cyfr: 1 2 3 4 5 6 7 8 9',
  ]);
});
test('K33: „Nazwisko, Imię" jako komórka rekordu i drugie imię za maską — osoba w całości', () => {
  masked([
    ['"Kowalski, Jan","85031412347"\nNazwisko i imię: Kowalski, Jan', `"${N}","[PESEL]"\nNazwisko i imię: ${N}`],
    ['1. Nowak, Anna\n2. Wiśniewski, Piotr', `1. ${N}\n2. ${N}`],
    ['Kowalski,Jan;85031412347', `${N};[PESEL]`],
    ['<osoba>Kowalski, Jan</osoba>', `<osoba>${N}</osoba>`],
    ['{"name": "Kowalski, Jan"}', `{"name": "${N}"}`],
    ['Kowalski, Jan Maria', N],
    ['To: Grabowski, Rafał <rafal.grabowski@bud-pol.com.pl>\nZgłaszający: Kowalski, Jan', `To: ${N} <[EMAIL]>\nZgłaszający: ${N}`],
    ['Lista obecności:\nKowalski, Jan\nWiśniewska, Ewa\nNowak, Anna', `Lista obecności:\n${N}\n${N}\n${N}`],
    ['From: "Lis, Jakub" <j.lis@firma.pl>', `From: "${N}" <[EMAIL]>`],
    ['Do: Wiśniewska, Ewa; Lis, Jakub; Zając, Piotr', `Do: ${N}; ${N}; ${N}`],
    ['Kowalska Anna Maria, PESEL 78041212346', `${N}, PESEL [PESEL]`],
    ['Nowak Jan Piotr', N],
    ['Pozwany Kowalski Jan Paweł wniósł apelację.', `Pozwany ${N} wniósł apelację.`],
    ['Lista obecności:\nKowalska Anna Maria\nNowak Jan Piotr\nWiśniewski Tomasz', `Lista obecności:\n${N}\n${N}\n${N}`],
    ['pozew Kowalskiej Anny Marii', `pozew ${N}`],
  ]);
  // pseudonimy: imię po przecinku należy do tej samej osoby, nie dostaje osobnej litery
  masked([['Do: Wiśniewska, Ewa; Lis, Jakub', 'Do: [OSOBA-A]; [OSOBA-B]']], { pseudonyms: true });
});
test('K33 pułapki: proza z przecinkiem, nazwy placówek, miesiące, adresaci-działy i kolumny CSV bez zmian', () => {
  masked([
    ['Rozmawiałem z Kowalskim, Marek też był.', `Rozmawiałem z ${N}, Marek też był.`],
    ['Spotkałem Kowalskiego, Jan był chory.', `Spotkałem ${N}, Jan był chory.`],
    ['Byli tam Kowalski, Jan i Anna.', `Byli tam ${N}, Jan i Anna.`],
    ['z Kowalskim, Janem i Anną', `z ${N}, Janem i Anną`],
    ['Jan Kowalski, Maria i Zofia przyszły później.', `${N}, Maria i Zofia przyszły później.`],
    ['Jan Kowalski Lech Poznań', `${N} Lech Poznań`],
    // b7: ulica z patronem i numerem tuż za osobą to jej adres — osobna maska, osoba nie wchłania ulicy
    ['Anna Kowalska Jana Pawła II 5', `${N} [ADRES]`],
    ['Kowalski Jan Maja 2024', `${N} Maja 2024`],
    ['1, Kowalski, Jan, 85031412347', `1, ${N}, Jan, [PESEL]`],
    ['Kowalski,Jan,512345678,34', `${N},Jan,[TELEFON],34`],
  ]);
  keep([
    'Warszawa, Marki, Ząbki',
    'Kraków, Maja 3',
    'Kraków, Maj 2024',
    'Nowy Sącz, Jan Paweł II',
    'Wojewoda Mazowiecki, Adam przyjął delegację.',
    'Do: Anna, Marek',
    'To: Marketing, Ewa',
    'Do: Sekretariat, Ewa',
    'Od: Dział Kadr, Ewa',
    'Do: Urząd Skarbowy, Krystyna',
    'Szpital Bielański, Marta',
    'Teatr Słowackiego, Juliusz',
    'Hotel: Bristol, Wiktoria',
    'Nazwa: Bank Śląski, Marek',
    'Kwiaty: Kalina, Róża',
    'Wysłano: Środa, Maja 2025',
    'Papież Jan Paweł II odwiedził Polskę.',
    'Szkoła im. Marii Konopnickiej w Warszawie',
  ]);
});
test('K34: zdrobnienie spoza słownika imion przed potwierdzonym nazwiskiem — osoba w całości', () => {
  masked([
    ['Kuba Nowak, Ola Nowak', `${N}, ${N}`],
    ['Iza Nowak, Ela Kowalska, Ula Wiśniewska, Ala Nowak', `${N}, ${N}, ${N}, ${N}`],
    ['[12:10] Kuba Nowak: siema', `[12:10] ${N}: siema`],
    ['Napisał Kuba Kowalski.', `Napisał ${N}.`],
    ['Kuba Nowak-Lis odpisał.', `${N} odpisał.`],
    ['Jasiek Wójcik, Mati Kaczmarek, Maks Zieliński', `${N}, ${N}, ${N}`],
    ['Aga Woźniak i Kaja Jankowska', `${N} i ${N}`],
  ]);
  masked([['Kuba Nowak napisał, a potem Nowak zadzwonił.', '[OSOBA-A] napisał, a potem [OSOBA-A] zadzwonił.']], { pseudonyms: true });
});
test('K34 pułapki: kraj, drink, skrót „Maks.", homograf bez kotwicy i przymiotnik odmiejscowy bez zmian', () => {
  masked([
    ['Na Kubie Nowak spędził urlop.', `Na Kubie ${N} spędził urlop.`],
    ['Handel z Kubą Nowak prowadził od lat.', `Handel z Kubą ${N} prowadził od lat.`],
    ['Ambasador RP na Kubie Jan Kowalski', `Ambasador RP na Kubie ${N}`],
    ['Maks. 5 osób, Nowak pilnuje listy.', `Maks. 5 osób, ${N} pilnuje listy.`],
    ['Kraj: Kuba\nNowak, kierownik', `Kraj: Kuba\n${N}, kierownik`],
    ['Kuba, Polska, Nowak', `Kuba, Polska, ${N}`],
    ['Ola! Nowak przyszedł.', `Ola! ${N} przyszedł.`],
    // imię za nazwiskiem: szyk „Nazwisko Imię", zdrobnienie stoi przed osobą, nie w niej
    ['Kierunek: Kuba Nowak Jan, przewodnik', `Kierunek: Kuba ${N}, przewodnik`],
  ]);
  keep([
    'Kuba Libre to drink z rumem.',
    'Kuba to wyspa na Karaibach.',
    'Rewolucja na Kubie wybuchła w 1959 r.',
    '[12:10] Kuba: siema',
    'Ada to język programowania.',
    'Jasiek leżał na łóżku.',
    'Maks Prędkość 50 km/h',
    'Republika Kuba Socjalistyczna',
    'Kuba Mazowiecki',
    'Ola Polska',
    'Kuba Król Hiszpanii?',
    'Kuba Lis, Ola Lis',
    'Ada Zając',
    'Hawana, Kuba',
  ]);
});
test('K35: imię sklejone z nazwiskiem kropką albo podkreśleniem (konta, katalogi) — osoba w całości', () => {
  masked([
    ['Konto Jan.Kowalski zostało zablokowane.\nPrzeniesiono folder Kowalski_Jan do archiwum.', `Konto ${N} zostało zablokowane.\nPrzeniesiono folder ${N} do archiwum.`],
    ['C:\\Users\\Jan.Kowalski\\AppData', `C:\\Users\\${N}\\AppData`],
    ['/home/Jan.Kowalski/docs', `/home/${N}/docs`],
    ['Anna.Nowak', N],
    ['Nowak_Anna', N],
    ['Kowalski.Jan', N],
    ['Plik Kowalski_Jan_umowa.pdf wysłano.', `Plik ${N}_umowa.pdf wysłano.`],
  ]);
  masked([['Konto Jan.Kowalski, folder Kowalski_Jan', 'Konto [OSOBA-A], folder [OSOBA-A]']], { pseudonyms: true });
});
test('K35 pułapki: nazwy plików, wersji i serwerów oraz kropka końca zdania ze spacją bez zmian', () => {
  masked([
    ['Rozmawiałem z Janem. Kowalski przyszedł później.', `Rozmawiałem z Janem. ${N} przyszedł później.`],
    ['Dzwonił Kowalski. Maja odebrała.', `${N}. Maja odebrała.`],
  ]);
  keep([
    'Plik Raport_Final.docx przeniesiono do archiwum.',
    'Ścieżka C:\\Users\\Admin\\AppData\\Local zawiera logi.',
    'Przeniesiono folder Dokumenty_Firma do archiwum.',
    'Katalog Projekt.Alfa zarchiwizowano.',
    'Spotkanie przy ul. Jana Pawła II w sprawie remontu.',
    'Wersja aplikacji Parawan.Web została wydana.',
    'Plik Umowa_Najmu_2024.pdf podpisano.',
    'Serwer App.Server.Prod restartowano.',
    'Grupa AD Kadry_Płace ma dostęp.',
  ]);
});
test('K36: imię z homoglifem OCR przed maską i nazwisko dwuczłonowe WERSALIKAMI — osoba w całości', () => {
  masked([
    ['Od: J0anna Kowalczyk\nKrzyszt0f Wiśniewski', `Od: ${N}\n${N}`],
    ['KaroI Nowak', N],
    ['DanieI Kowalski', N],
    ['Kami1 Nowak', N],
    ['P1otr Nowak', N],
    ['Mar1a Kowalska', N],
    ['J0ANNA Kowalczyk', N],
    ['Pani J0anna Kowalczyk', `Pani ${N}`],
    ['Pani ANNA NOWAK-KOWALSKA\nPani Anna Nowak-Kowalska', `Pani ${N}\nPani ${N}`],
    ['Wnioskodawczyni: ANNA NOWAK-KOWALSKA', `Wnioskodawczyni: ${N}`],
    ['mgr ANNA KOWALSKA-NOWAK', `mgr ${N}`],
    ['Pan JAN KOWALSKI-WIŚNIEWSKI', `Pan ${N}`],
    ['STANISŁAW KOWALSKI-WOLSKI', N],
    ['J0ANNA N0WAK-KOWALSKA', N],
  ]);
  // ten sam klucz osoby w zapisie WERSALIKAMI i Titlecase
  masked([['Pani ANNA NOWAK-KOWALSKA\nPani Anna Nowak-Kowalska', 'Pani [OSOBA-A]\nPani [OSOBA-A]']], { pseudonyms: true });
});
test('K36 pułapki: kody z cyframi, nazwy instytucji i miejscowości z łącznikiem bez zmian', () => {
  masked([
    ['pozycja A1a Kowalski', `pozycja A1a ${N}`],
    ['Sala A10 Kowalski', `Sala A10 ${N}`],
    ['Firma KOW01 Nowak', `Firma KOW01 ${N}`],
    ['Formularz PIT11 Nowak', `Formularz PIT11 ${N}`],
    ['Zbi0r Kowalski', `Zbi0r ${N}`],
    ['profil LinkedIn Nowak', `profil LinkedIn ${N}`],
    ['Załącznik A10\nKowalski', `Załącznik A10\n${N}`],
  ]);
  keep([
    'UNIWERSYTET MARII CURIE-SKŁODOWSKIEJ W LUBLINIE',
    'CENTRUM ONKOLOGII MARII SKŁODOWSKIEJ-CURIE',
    'SZPITAL IM. MARII SKŁODOWSKIEJ-CURIE',
    'SĄD REJONOWY W BIELSKU-BIAŁEJ',
    'WSPÓŁPRACA POLSKO-NIEMIECKA',
    'ROMAN POLSKO-AMERYKAŃSKI',
    'ADAM MIŃSKI-MAZOWIECKI',
    'ANNA BIELSKO-BIAŁA',
    'GMINA KĘDZIERZYN-KOŹLE',
    'FUNDACJA JANA PAWŁA II',
    'ROK SZKOLNY 2023-2024',
    'Roztwór HCl NaOH',
  ]);
});
const M = '[MIEJSCOWOŚĆ]';
const K = '[KOD-POCZTOWY]';
test('K37: miejscowość wielowyrazowa po kodzie i w miejscowniku — nazwa w całości', () => {
  masked([
    ['ul. Kasztanowa 8, 55-080 Kąty Wrocławskie', `[ADRES], ${K} ${M}`],
    ['83-000 Pruszcz Gdański', `${K} ${M}`],
    ['41-100 Siemianowice Śląskie', `${K} ${M}`],
    ['<AdresL2>05-540 Zalesie Górne</AdresL2>', `<AdresL2>${K} ${M}</AdresL2>`],
    ['96-321 Żabia Wola', `${K} ${M}`],
    ['34-130 Kalwaria Zebrzydowska', `${K} ${M}`],
    ['62-080 Tarnowo Podgórne', `${K} ${M}`],
    ['zam. 55-080 Kąty Wrocławskie, ul. Fryderyka Chopina 9', `zam. ${K} ${M}, [ADRES]`],
    ['11-040 Dobre Miasto', `${K} ${M}`],
    ['66-470 Kostrzyn nad Odrą', `${K} ${M}`],
    ['26-420 Nowe Miasto nad Pilicą', `${K} ${M}`],
    ['Stare Babice (gmina wiejska)', `${M} (gmina wiejska)`],
    ['Jan Nowak, zam. w Dąbrowie Górniczej, wnosi o...', `${N}, zam. w ${M}, wnosi o...`],
    ['zam. w Piotrkowie Trybunalskim', `zam. w ${M}`],
    ['zam. w Nowym Dworze Mazowieckim', `zam. w ${M}`],
    ['zam. w Tomaszowie Mazowieckim', `zam. w ${M}`],
    ['zam. w Stalowej Woli', `zam. w ${M}`],
    ['zam. w Białej Podlaskiej', `zam. w ${M}`],
    ['zamieszkała w Dąbrowie Górniczej.', `zamieszkała w ${M}.`],
  ]);
});
test('K37 pułapki: kraj, region, urząd i osoba po kodzie oraz proza bez kotwicy bez zmian', () => {
  masked([
    ['00-950 Warszawa Zarząd Dróg Miejskich', `${K} ${M} Zarząd Dróg Miejskich`],
    ['00-950 Warszawa Polska', `${K} ${M} Polska`],
    ['61-001 Poznań Wielkopolska', `${K} ${M} Wielkopolska`],
    ['80-001 Gdańsk Pomorski Urząd Wojewódzki', `${K} ${M} Pomorski Urząd Wojewódzki`],
    ['62-800 Kalisz Jan Kowalski', `${K} ${M} ${N}`],
    ['48-210 Biała Polska', `${K} ${M} Polska`],
    ['00-950 Warszawa nad Wisłą', `${K} ${M} nad Wisłą`],
    // przymiotnik z końcówką nazwiskową w nazwie miasta to nie osoba
    ['Konferencja w Piotrkowie Trybunalskim była udana.', 'Konferencja w Piotrkowie Trybunalskim była udana.'],
  ]);
  keep([
    'Spotkanie odbyło się w Dąbrowie Górniczej w sali.',
    'Huta Stalowa Wola S.A.',
    'Z własnej woli zrezygnował',
  ]);
});
test('K32: adres z zakresem numerów, lokalem po przecinku, słowem „lokal", łącznikiem w nazwie i „Aleje"', () => {
  masked([
    ['zam. ul. Długa 5, m. 3, 80-827 Gdańsk', `zam. [ADRES], ${K} ${M}`],
    ['zam. ul. Hoża 41-43 m. 12, 00-681 Warszawa', `zam. [ADRES], ${K} ${M}`],
    ['ul. Długa 5, lok. 3', '[ADRES]'],
    ['ul. Długa 5 lokal 3', '[ADRES]'],
    ['ul. Długa 5 mieszk. 3', '[ADRES]'],
    ['ul. Hoża 41/43 m. 12', '[ADRES]'],
    ['ul. Hoża 41–43', '[ADRES]'],
    ['al. Jerozolimskie 123-125 lok. 7', '[ADRES]'],
    ['{"adres": "ul. Hoża 41-43 m. 12"}', '{"adres": "[ADRES]"}'],
    ['Hoża 41-43, 00-681 Warszawa', `[ADRES], ${K} ${M}`],
    ['Marszałkowska 84/92 lok. 105, 00-514 Warszawa', `[ADRES], ${K} ${M}`],
    ['ul. Marszałkowska 84/92/105', '[ADRES]'],
    ['przy ul. Długiej 5/7 m. 3 o pow. 50 m2', 'przy [ADRES] o pow. 50 m2'],
    ['zamieszkały przy ul. Żwirki i Wigury 16 m. 3 w Warszawie.', `zamieszkały przy [ADRES] w ${M}.`],
    ['zam. ul. Żwirki i Wigury 16/3, 02-092 Warszawa', `zam. [ADRES], ${K} ${M}`],
    ['ul. Jana z Kolna 5 w Gdańsku', `[ADRES] w ${M}`],
    ['ul. Bitwy pod Płowcami 12 w Gdańsku', `[ADRES] w ${M}`],
    ['ul. Księcia Bolesława z Mazowsza 8 w Płocku', `[ADRES] w ${M}`],
    ['zam. Aleje Jerozolimskie 44 m. 12 w Warszawie', `zam. [ADRES] w ${M}`],
    ['zam. w Alejach Jerozolimskich 44', 'zam. w [ADRES]'],
    ['Ulica: ul. Dolna\nNumer budynku: 21\nNumer lokalu: 7', 'Ulica: [ADRES]\nNumer budynku: [ADRES]\nNumer lokalu: [ADRES]'],
    ['{"ulica":"ul. Dolna"}', '{"ulica":"[ADRES]"}'],
    ['<Ulica>ul. Dolna</Ulica>', '<Ulica>[ADRES]</Ulica>'],
  ]);
});
test('K32 pułapki: „m.in.", mieszkanie N-pokojowe, metraż, lata, daty, liczebnik z rzeczownikiem i narzędnik po „z"', () => {
  masked([
    ['Spotkanie przy ul. Długiej 5, m.in. 3 sklepy były otwarte.', 'Spotkanie przy [ADRES], m.in. 3 sklepy były otwarte.'],
    ['Sprzedam mieszkanie przy ul. Długiej 5, mieszkanie 3-pokojowe.', 'Sprzedam mieszkanie przy [ADRES], mieszkanie 3-pokojowe.'],
    ['Biuro przy ul. Długiej 5 lokal 120 m2', 'Biuro przy [ADRES] lokal 120 m2'],
    ['Dojazd: ul. Długa 5 - 10 minut pieszo.', 'Dojazd: [ADRES] - 10 minut pieszo.'],
    ['Szkoła Podstawowa nr 5, 80-827 Gdańsk', `Szkoła Podstawowa nr 5, ${K} ${M}`],
    ['Spółka Kowalski i Syn 5, 00-001 Warszawa', `Spółka ${N} i [ADRES], ${K} ${M}`],
    ['Na ul. Długiej z Kowalskim 5 razy rozmawiałem.', `Na ul. Długiej z ${N} 5 razy rozmawiałem.`],
  ]);
  keep([
    'Most Grunwaldzki 1908-1910',
    'Lotnisko im. Żwirki i Wigury 2 terminale.',
    'Spotkanie przy ul. Długiej w Gdańsku 12 maja',
    'Bitwa pod Płowcami 1331 r.',
    'Uchwała nr XII/123/2020',
    'Aleje Ujazdowskie 2024 to tytuł wystawy.',
    'Na Alejach Jerozolimskich 15 tysięcy ludzi.',
    'Wypadek przy ul. Długiej i Krótkiej 5 osób rannych.',
    'Rozmawiał przy ul. Długiej 5 minut.',
    'Ulica była zamknięta przez 3 dni.',
    'Numer budynku: do ustalenia',
    'przy ul. Długiej 1-3 maja odbędzie się festyn',
    'przy ul. Okopowej 1944-1956 działało więzienie',
  ]);
});
test('K38: numer konta i NIP z twardą spacją albo łącznikami oraz etykieta z kwalifikatorem', () => {
  const nb = (s: string): string => s.replace(/ /g, '\u00A0');
  masked([
    [`Numer rachunku: ${nb('57 1140 2004 0000 3002 0123 4567')}`, 'Numer rachunku: [NR-KONTA]'],
    ['Konto: 57-1140-2004-0000-3002-0123-4567', 'Konto: [NR-KONTA]'],
    [`IBAN: ${nb('PL57 1140 2004 0000 3002 0123 4567')}`, 'IBAN: [NR-KONTA]'],
    [`Numer rachunku: ${'57 1140 2004 0000 3002 0123 4567'.replace(/ /g, '\u202F')}`, 'Numer rachunku: [NR-KONTA]'],
    ['Konto: PL57-1140-2004-0000-3002-0123-4567', 'Konto: [NR-KONTA]'],
    [`Przelew na ${nb('57 1140 2004 0000 3002 0123 4567')} dziś.`, 'Przelew na [NR-KONTA] dziś.'],
    ['Przelew na 57-1140-2004-0000-3002-0123-4567 dziś.', 'Przelew na [NR-KONTA] dziś.'],
    ['Przelew na PL57-1140-2004-0000-3002-0123-4567 dziś.', 'Przelew na [NR-KONTA] dziś.'],
    [`NIP: ${nb('526 000 12 46')}`, 'NIP: [NIP]'],
    [`Kontrahent ${nb('526 000 12 46')}`, 'Kontrahent [NIP]'],
    [`{"konto":"${nb('57 1140 2004 0000 3002 0123 4567')}"}`, '{"konto":"[NR-KONTA]"}'],
    // zła suma (literówka) przy etykiecie z kwalifikatorem — etykieta wygrywa jak bez kwalifikatora
    ['wpłata na mikrorachunek podatkowy 52 1010 0071 2221 7743 1005 2400', 'wpłata na mikrorachunek podatkowy [NR-KONTA]'],
    ['nr rachunku bankowego: 52 1010 0071 2221 7743 1005 2400', 'nr rachunku bankowego: [NR-KONTA]'],
    ['rachunek VAT 52 1010 0071 2221 7743 1005 2400', 'rachunek VAT [NR-KONTA]'],
    ['subkonto 52 1010 0071 2221 7743 1005 2400', 'subkonto [NR-KONTA]'],
    ['Mikrorachunek: PL52 1010 0071 2221 7743 1005 2400', 'Mikrorachunek: [NR-KONTA]'],
  ]);
});
test('K38 pułapki: kwoty z twardą spacją, plan kont, numery zamówień i przesyłek, zła suma bez etykiety', () => {
  keep([
    'Kwota przelewu: 1\u00A0234\u00A0567,89 zł z rachunku firmowego.',
    'Saldo rachunku: 12\u00A0345\u00A0678,90 zł',
    'Konto księgowe 201-01-001-0002-0003-0004-0005-01 (plan kont).',
    'Zamówienie 1234-5678-9012-3456-7890-1234-56 zostało wysłane.',
    'Nr ref. 2024-10-14-0001-0002-0003-0004 w systemie.',
    'ISBN 978-83-01-12345-6, zamówienie nr 57-1140-2004.',
    'Seria: 57-1140-2004-0000-3002-0123-4568 (zła suma, bez etykiety).',
    'Nr przesyłki 00 1234 5678 9012 3456 7890 1234 56 w drodze.',
    '{"kwota":"1\u00A0200,00"}',
    'Rachunek podatkowy prowadzi Urząd Skarbowy w Krakowie od 2020 r.',
    'Mikrorachunek podatkowy wygenerujesz w serwisie podatki.gov.pl.',
    'Rachunek referencyjny 1234567890123456789012345 (25 cyfr) zostaje.',
    'Rachunek zysków i strat za lata 2019 2020 2021 2022 2023 2024 porównano.',
  ]);
});
test('K39: imię i nazwisko w polu loginu to osoba, nie login', () => {
  masked([
    ['User: Kowalski Jan', `User: ${N}`],
    ['Username: Nowak Anna', `Username: ${N}`],
    ['User: Adam Kowalski', `User: ${N}`],
    ['Login: Kowalski Jan', `Login: ${N}`],
    ['User = Kowalski Jan', `User = ${N}`],
    ['User: Kowalski Jan\nJan Kowalski zgłosił awarię.', `User: ${N}\n${N} zgłosił awarię.`],
  ]);
});
test('K39 pułapki: prawdziwe loginy, kolejna etykieta i nazwy kont technicznych bez zmian', () => {
  masked([
    ['User: jkowalski', 'User: [LOGIN]'],
    ['Username: j.kowalski', 'Username: [LOGIN]'],
    ['User: JKowalski Domain: CORP', 'User: [LOGIN] Domain: CORP'],
    ['User: Kowalski', 'User: [LOGIN]'],
    ['User: Adam Status: active', 'User: [LOGIN] Status: active'],
    ['User: jkowalski (Jan Kowalski)', `User: [LOGIN] (${N})`],
    ['User: Kowalski Jan.Nowak', `User: [LOGIN] ${N}`],
  ]);
});
test('Obce litery w nazwiskach: osoba w całości, bez jawnej końcówki', () => {
  masked([
    ['Anna Schröder', N],
    ['Jan Müller', N],
    ['Pan Müller', `Pan ${N}`],
    ['Pani Schröder złożyła wniosek.', `Pani ${N} złożyła wniosek.`],
    ['Jan Dvořák, Anna Čapková', `${N}, ${N}`],
    ['Maria Peña', N],
    ['Piotr Žižek', N],
    ['Jan Kowalski-Müller', N],
    ['A. Kowalski-Müller', `A. ${N}`],
    ['Lewandowski-Müller złożył wniosek.', `${N} złożył wniosek.`],
    ['Anna z domu Müller', N],
    ['Panią Gärtner wezwano.', `Panią ${N} wezwano.`],
    ['To: Müller Jan', `To: ${N}`],
    ['Anna i Jan Müller', `${N} i ${N}`],
  ]);
  masked([['Pan Müller i Jan Müller', 'Pan [OSOBA-A] i [OSOBA-A]']], { pseudonyms: true });
});
test('Obce litery — pułapki: obcy wyraz bez imienia i kotwicy, miasta, tytuł przed nazwiskiem', () => {
  masked([
    ['Señor Kowalski', `Señor ${N}`],
  ]);
  keep([
    'Café Müller to spektakl Piny Bausch.',
    'Müller',
    'Spotkanie w Zürichu',
    'Złożono wniosek w München.',
    'Wysłano do Malmö 5 paczek.',
    'Champs-Élysées',
    'Crème brûlée',
  ]);
});
test('K33/K10: nazwa zakładu „Salon Fryzjerski" to nie osoba, imię z nazwy salonu nie domyka maski', () => {
  keep(['Salon Fryzjerski Ewa zaprasza.', '{"name": "Salon Fryzjerski Ewa"}', 'Gabinet Fryzjerski przyjmuje.']);
  masked([['Pan Fryzjerski złożył wniosek.', `Pan ${N} złożył wniosek.`]]);
});
test('Regresje b4 · adres: lokal, etykieta adresu i etykieta pola wielką literą nie robią z numeru liczebnika', () => {
  masked([
    ['zam. ul. Długa 5 m. 3 lat 45', 'zam. [ADRES] lat 45'],
    ['Pacjent Jan Kowalski, zam. ul. Długa 5 m. 3 lat 45, przywieziony przez ZRM.', `Pacjent ${N}, zam. [ADRES] lat 45, przywieziony przez ZRM.`],
    ['zam. ul. Kwiatowa 12 m. 4 osoby w gospodarstwie domowym: 3.', 'zam. [ADRES] osoby w gospodarstwie domowym: 3.'],
    ['Jan Kowalski, zam. ul. Lipowa 7 m. 12 razy wzywał policję.', `${N}, zam. [ADRES] razy wzywał policję.`],
    ['W mieszkaniu przy ul. Długiej 5 m. 3 osoby zatruły się czadem.', 'W mieszkaniu przy [ADRES] osoby zatruły się czadem.'],
    ['Interwencja: ul. Polna 4 lok. 2 osoby nietrzeźwe.', 'Interwencja: [ADRES] osoby nietrzeźwe.'],
    ['os. Tysiąclecia bl. 4 m. 3 osoby', '[ADRES] osoby'],
    ['zam. al. Niepodległości 5 m. 2 dni temu', 'zam. [ADRES] dni temu'],
    ['zam. ul. Długa 5 lat 45', 'zam. [ADRES] lat 45'],
    ['Adres zamieszkania: ul. Polna 12 km od Krakowa', 'Adres zamieszkania: [ADRES] km od Krakowa'],
    ['Adres: ul. Kwiatowa 5 Dni pobytu: 30', 'Adres: [ADRES] Dni pobytu: 30'],
    ['Zameldowanie: ul. Polna 5 Osoby zameldowane: 3', 'Zameldowanie: [ADRES] Osoby zameldowane: 3'],
    ['Adres lokalu: ul. Polna 5 m. 3 Metraż: 54 m2', 'Adres lokalu: [ADRES] Metraż: 54 m2'],
    ['Właściciel: Jan Kowalski, ul. Polna 5 Pojazd: Opel Astra', `Właściciel: ${N}, [ADRES] Pojazd: Opel Astra`],
    ['zam. ul. Żwirki i Wigury 2023', 'zam. [ADRES]'],
    // człon numeru lokalu w całości
    ['ul. Długa 5/7 m. 3/4', '[ADRES]'],
    ['ul. Długa 5/7 lok. 3/4', '[ADRES]'],
    ['Siedziba: ul. Długa 5, lok. 2 i 3', 'Siedziba: [ADRES]'],
    ['ul. Długa 5 m. 3 i 2 dzieci', '[ADRES] i 2 dzieci'],
  ]);
});
test('Regresje b4 · adres: zakres i liczebnik w prozie, wyliczenie ulic, rok za łącznikiem bez zmian', () => {
  keep([
    'Na ul. Długiej 2-3 osoby czekały.',
    'Na ul. Marszałkowskiej 10-15 tysięcy ludzi protestowało.',
    'Pod ul. Długą 5-10 metrów kabla.',
    'Remont ul. Długiej 5–7 dni.',
    'Na ul. Długiej 100-200 osób.',
    'Ulica Żwirki i Wigury 2023 remont.',
    'ul. Żwirki i Wigury 2023 – remont nawierzchni zakończony.',
    'Remont ul. Długiej i Krótkiej 2026 — harmonogram',
    'Ul. Mickiewicza i Słowackiego 3 sklepy zamknięto.',
    'Plac Bohaterów Getta i Żydów 3 pomniki.',
    'Przy ul. Kopernika i Galileusza 7 domów spłonęło.',
    'Na skrzyżowaniu ul. Polnej i Leśnej 2 autobusy zderzyły się.',
    'przy ul. Polnej i Leśnej 3 pokoje z kuchnią.',
    'W Alejach Ujazdowskich 3 ambasady mają siedziby.',
    'Mieszkał w Alejach Ujazdowskich 3 miesiące.',
    'W Alejach Jerozolimskich 2 pasy ruchu będą zamknięte.',
    'W Alejach Najświętszej Maryi Panny 14 kawiarni wystawi ogródki.',
    'W Alejach Ujazdowskich 15 artystów pokaże prace',
    'W Alejach Racławickich 12 klonów zostanie wyciętych',
    'na Alejach Jerozolimskich 2 tramwaje wykoleiły się',
    'Mieszkańcy ul. Lipowej i Polnej 40 rodzin podpisało petycję.',
    'Na ul. Długiej i Krótkiej 15 latarni nie świeci.',
    'Przy ul. Długiej i Krótkiej 3 miesiące potrwa wymiana',
  ]);
  // forma pojedyncza za adresem to jego opis, nie liczebnik
  masked([
    ['przy ul. Długiej 5 sklep spożywczy', 'przy [ADRES] sklep spożywczy'],
    ['zamieszkały przy ul. Żwirki i Wigury 16 m. 3 w Warszawie.', 'zamieszkały przy [ADRES] w [MIEJSCOWOŚĆ].'],
  ]);
});
test('Regresje b4 · telefon: człon wyliczenia z prefiksem po „tel."/„kom." w całości, nawias przed „+48" zostaje', () => {
  masked([
    ['Tel. 22 501 23 45, tel. 0048 601 222 333.', `Tel. ${T}, tel. ${T}.`],
    ['tel. 601 222 333, kom. 0048 602 333 444', `tel. ${T}, kom. ${T}`],
    ['tel. 0048 601 222 333, kom. 48 601 222 333', `tel. ${T}, kom. ${T}`],
    ['Pracownik socjalny: Iza Nowicka, tel. 22 501 23 46, kom. 0048 602 333 444.', `Pracownik socjalny: ${N}, tel. ${T}, kom. ${T}.`],
    ['tel. 601 222 333, kom. 0 602 333 444', `tel. ${T}, kom. ${T}`],
    ['tel. 601 222 333, tel. (48) 602 333 444', `tel. ${T}, tel. ${T}`],
    ['Telefon kontaktowy: 0 22 501 23 45, kom. 0 601 222 333.', `Telefon kontaktowy: ${T}, kom. ${T}.`],
    ['tel. 601 222 333, tel. (0-22) 501 23 45', `tel. ${T}, tel. ${T}`],
    ['Kontakt: tel. 22 654 32 10 lub tel. 0048 600 100 201.', `Kontakt: tel. ${T} lub tel. ${T}.`],
    ['tel. 600 100 200, kom. 0048600100201', `tel. ${T}, kom. ${T}`],
    ['tel. 22 654 32 10; tel. 0 22 654 32 11', `tel. ${T}; tel. ${T}`],
    ['kom. 48 600 100 200, kom. 48600100201', `kom. ${T}, kom. ${T}`],
    ['tel. (+48 512 345 678)', `tel. (${T})`],
    ['Proszę o kontakt (+48 512 345 678).', `Proszę o kontakt (${T}).`],
    ['Kontakt (+48 22 654 32 14 lub +48 600 100 202).', `Kontakt (${T} lub ${T}).`],
    ['tel. (+48) 512 345 678', `tel. ${T}`],
  ]);
  masked([['tel. 601 222 333, kom. 0048 602 333 444', `tel. ${T}, kom. ${T}`]], { pseudonyms: true });
});
test('Regresje b4 · PESEL/NIP/REGON z odstępami: etykieta nie przejmuje wartości następnego pola', () => {
  masked([
    ['PESEL\nTel. 48 601 222 333', `PESEL\nTel. ${T}`],
    ['REGON\nTel. 601 222 333', `REGON\nTel. ${T}`],
    ['Dane płatnika: NIP 526 000 12 46 REGON brak telefon 601 222 333', `Dane płatnika: NIP [NIP] REGON brak telefon ${T}`],
    ['PESEL: 851 103 142 83\nTel. 601 222 333', `PESEL: [PESEL]\nTel. ${T}`],
    // słowa opisujące sam numer dalej działają
    ['PESEL pacjenta: 851 103 142 83', 'PESEL pacjenta: [PESEL]'],
    ['NIP kontrahenta: 5260 0012 46', 'NIP kontrahenta: [NIP]'],
    ['REGON spółki: 012 345 675', 'REGON spółki: [REGON]'],
  ]);
  keep(['PESEL\nNr karty 1234 5678 901', 'NIP\nKRS 0000 123 456']);
});
test('Regresje b4 · osoba: imię za maską pary „Imię Nazwisko" albo nazwiska w formie zależnej to inna osoba', () => {
  masked([
    ['Rodzice: Jan Kowalski, Anna', `Rodzice: ${N}, Anna`],
    ['Świadkowie: Jan Kowalski, Marek (sąsiad)', `Świadkowie: ${N}, Marek (sąsiad)`],
    ['Do: Jan Kowalski, Anna; Piotr Nowak', `Do: ${N}, Anna; ${N}`],
    ['DW: Marek Zieliński, Ewa (sekretariat)', `DW: ${N}, Ewa (sekretariat)`],
    ['Nadawca: Jan Kowalski, Jarosław', `Nadawca: ${N}, Jarosław`],
    ['Imiona i nazwiska dzieci: Zofia Nowak, Antoni', `Imiona i nazwiska dzieci: ${N}, Antoni`],
    ['Dzieci: Zofia Nowak Antoni', `Dzieci: ${N} Antoni`],
    ['Sprawę prowadzi Anna Nowak Ewa przejmie ją w maju.', `Sprawę prowadzi ${N} Ewa przejmie ją w maju.`],
    ['Pacjent Jan Kowalski Nadzieja na poprawę jest niewielka.', `Pacjent ${N} Nadzieja na poprawę jest niewielka.`],
    ['Lek. Jan Kowalski Bożena (pielęgniarka)', `Lek. ${N} Bożena (pielęgniarka)`],
    ['Jan Maria Kowalski Anna przyszła.', `${N} Anna przyszła.`],
    ['Według Nowaka Ewa nie przyszła na zebranie.', `Według ${N} Ewa nie przyszła na zebranie.`],
    ['Zamiast Wiśniewskiego Marek pojechał do Gdańska.', `Zamiast ${N} Marek pojechał do Gdańska.`],
    ['Dzięki Kowalskiemu Adam dostał dostęp.', `Dzięki ${N} Adam dostał dostęp.`],
    ['Obok Kowalskiej Anna usiadła.', `Obok ${N} Anna usiadła.`],
    // imię za maską w swoim wierszu nie przechodzi do osoby z następnego
    ['Dzieci: Zofia Nowak Antoni\nKowalski Antoni Jan, PESEL 78041212346', `Dzieci: ${N} Antoni\n${N}, PESEL [PESEL]`],
  ]);
  masked(
    [['Wyrażam zgodę na informowanie: Jan Kowalski, Maria (żona), Ewa Lis.', 'Wyrażam zgodę na informowanie: [OSOBA-A], Maria (żona), [OSOBA-B].']],
    { pseudonyms: true },
  );
});
test('Regresje b4 · osoba: szyk rekordu „Nazwisko Imię Imię" i „Nazwisko, Imię" dalej w całości', () => {
  masked([
    ['Świadkowie: Kowalski Jan Nowak Piotr', `Świadkowie: ${N} ${N}`],
    ['Nowak Jan Piotr\nDzieci: Zofia Nowak Piotr', `${N}\nDzieci: ${N} Piotr`],
    ['Wniosek Kowalskiego Stanisława Jana wpłynął.', `Wniosek ${N} wpłynął.`],
    ['Wniosek Kowalskiego Aleksandra wpłynął.', `Wniosek ${N} wpłynął.`],
    ['Odbiorca: Kowalski, Jan Maria', `Odbiorca: ${N}, ${N}`],
    ['Nazwisko;Imię\nKowalski,Jan;850', `Nazwisko;Imię\n${N};850`],
    ['"Kowalski,Jan","85031412347"', `"${N}","[PESEL]"`],
  ]);
});
test('Regresje b4 · osoba: CSV „Kowalski,Jan" bez innego separatora to dwie kolumny', () => {
  masked([
    // K61: pod nagłówkiem „Nazwisko,Imię" kolumna imienia też jest kotwicą (każda komórka osobno)
    ['Nazwisko,Imię\r\nKowalski,Jan\r\nNowak,Ewa\r\n', `Nazwisko,Imię\r\n${N},${N}\r\n${N},${N}\r\n`],
    ['nazwisko,imie\nWiśniewska,Anna', `nazwisko,imie\n${N},${N}`],
    ['Lista: Kowalski,Jan', `Lista: ${N},Jan`],
  ]);
});
test('Regresje b4 · osoba: kropka bez odstępu między zdaniami nie skleja dwóch osób', () => {
  masked([
    ['Rozmawiał z Janem.Kowalski odpisał.', `Rozmawiał z Janem.${N} odpisał.`],
    ['Spotkanie z Anną.Nowak przyszła.', `Spotkanie z Anną.${N} przyszła.`],
    ['Rozmawiałem z Ewą.Kowalski odmówił podpisu.', `Rozmawiałem z Ewą.${N} odmówił podpisu.`],
    ['Rozmawiałem z Kowalskim.Marek potwierdził termin.', `Rozmawiałem z ${N}.Marek potwierdził termin.`],
    ['Zespół Kowalskiego.Roman przyszedł.', `Zespół ${N}.Roman przyszedł.`],
    // login i katalog profilu bez zmian
    ['Konto Jan.Kowalski zostało zablokowane.', `Konto ${N} zostało zablokowane.`],
    ['C:\\Users\\Kowalski.Jan\\AppData', `C:\\Users\\${N}\\AppData`],
    ['Konto AD: Kowalska.Anna została odblokowana.', `Konto AD: ${N} została odblokowana.`],
  ]);
});
test('Regresje b4 · login: login zapisany jak nazwisko nie rozbija pary osobowej', () => {
  masked([
    ['Login: Kowalski\nUser: Jan Kowalski', `Login: [LOGIN]\nUser: ${N}`],
    ['Login: Kowalski\nJan Kowalski zgłosił awarię.', `Login: [LOGIN]\n${N} zgłosił awarię.`],
    ['Login: Marek\nMarek Nowak zatwierdził zmianę.', `Login: [LOGIN]\n${N} zatwierdził zmianę.`],
    ['Login: Adam\nStatus: active\nAdam zalogował się.', 'Login: [LOGIN]\nStatus: active\n[LOGIN] zalogował się.'],
  ]);
});
test('Regresje b4 r2 · adres: skrzyżowanie, „Aleje" i łącznik z liczebnikiem w prozie to nie adres', () => {
  keep([
    'Na skrzyżowaniu ul. Długiej i Polnej 1 osoba zginęła.',
    'Na ul. Mickiewicza i Słowackiego 3 zamknięto sklepy.',
    'Na ul. Długiej i Polnej 3 zatrzymano sprawcę.',
    'Na skrzyżowaniu al. Róż i Bzów 2 radiowozy stały.',
    'Na pl. Wolności i Bankowym 2 radiowozy stały.',
    'Na rogu ul. Mickiewicza i Słowackiego 2 auta osobowe zderzyły się.',
    'Na rogu ul. Marszałkowskiej i Świętokrzyskiej 2 bankomaty.',
    'Przy ul. Polnej i Leśnej 20 nowych latarni.',
    'przy ul. Długiej i Krótkiej 3 nietrzeźwych kierowców',
    'przy ul. Szkolnej i Kościelnej 2 nowe przystanki',
    'Spotkajmy się przy ul. Nowy Świat i Chmielnej 15 po południu?',
    'W rejonie ul. Polnej i Leśnej 3 radiowozy prowadziły poszukiwania.',
    'W rejonie ul. Polnej i Leśnej 6 interwencji w miesiącu.',
    'Skrzyżowanie ul. Polnej i Leśnej 3 kolizje',
    'Na skrzyżowaniu ul. Polnej i Leśnej 2 karetki udzielały pomocy.',
    'Przy ul. Ozimskiej i Reymonta 4 zastępy straży gasiły pożar.',
    'Teren przy ul. Leśnej pod Warszawą 12 ha.',
    'W Alejach Jerozolimskich 3 wypadki tylko w tym tygodniu.',
    'Na Alejach Jerozolimskich 15 mandatów wystawiono rowerzystom.',
    'W Alejach Najświętszej Maryi Panny 2 nowe ławki stanęły.',
    'Na scenie w Alejach Jerozolimskich 2 sceny plenerowe',
    'Przy Alejach Racławickich 22 wezwania',
    'W Alejach NMP 12 lokali czeka na najemców',
    'W Alejach Jerozolimskich 3 wypadki: dwa na przejściu.',
    'W alejach Zasłużonych 15 grobów odnowiono.',
    'W alejach Parku Śląskiego 3 rzeźby stanęły.',
    // godzina za nazwą to nie numer domu
    'Zbiórka przy ul. Polnej i Leśnej 18:00.',
    'Zbiórka: Aleje Ujazdowskie 18:00, start marszu.',
    'Zbiórka przy ul. Polnej 18:00.',
    // liczebnik przed rzeczownikiem ilości dalej jest liczebnikiem
    'Wypadek przy ul. Długiej i Krótkiej 5 osób rannych',
    'Na Alejach Jerozolimskich 15 tysięcy ludzi',
    'Przy ul. Długiej 5 samochodów zaparkowało.',
    'przy ul. Długiej 2 metry od krawężnika',
  ]);
  // adres osoby z łącznikiem albo w Alejach dalej w całości: po osobie, po etykiecie, z lokalem, przed kontaktem
  masked([
    ['Jan Kowalski, ul. Żwirki i Wigury 15 tel. 600 100 200', `${N}, [ADRES] tel. ${T}`],
    ['Wnioskodawca Jan Kowalski ul. Żwirki i Wigury 15 prosi o zwrot.', `Wnioskodawca ${N} [ADRES] prosi o zwrot.`],
    ['Jan Wiśniewski, ul. Żwirki i Wigury 15 lok. 3 prosi', `${N}, [ADRES] prosi`],
    ['Jan Nowak, Aleje Jerozolimskie 44 tel. 600100200', `${N}, [ADRES] tel. ${T}`],
    ['Jan Nowak mieszka w Alejach Jerozolimskich 44 od lat.', `${N} mieszka w [ADRES] od lat.`],
    ['Jan Kowalski zam. Aleje Jerozolimskie 44 od lat', `${N} zam. [ADRES] od lat`],
    ['Nadawca: Jan Nowak Aleje Jerozolimskie 44 kod 00-001', `Nadawca: ${N} [ADRES] kod [KOD-POCZTOWY]`],
    ['Zamieszkała w alejach Jerozolimskich 44 m. 5', 'Zamieszkała w [ADRES]'],
    ['Adres: aleje Jerozolimskie 44', 'Adres: [ADRES]'],
    ['ul. Bitwy pod Płowcami 12 m. 4', '[ADRES]'],
    ['Ul. Żwirki i Wigury 15, 00-906 Warszawa', '[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]'],
    ['Biuro przy ul. Żwirki i Wigury 15 w Warszawie', 'Biuro przy [ADRES] w [MIEJSCOWOŚĆ]'],
    ['Spotkanie: ul. Polna 5 18:00', 'Spotkanie: [ADRES] 18:00'],
  ]);
});
test('Regresje b4 r2 · adres: „lokal" po spacji przed liczebnikiem to podmiot zdania', () => {
  masked([
    ['Przy ul. Długiej 5 lokal 12 lat stał pusty.', 'Przy [ADRES] lokal 12 lat stał pusty.'],
    ['W kamienicy przy ul. Długiej 5 lokal 2 razy zalała woda.', 'W kamienicy przy [ADRES] lokal 2 razy zalała woda.'],
    ['Przy ul. Długiej 5 lokal 3 miesiące czekał na najemcę.', 'Przy [ADRES] lokal 3 miesiące czekał na najemcę.'],
    // lokal jako człon adresu dalej w masce
    ['ul. Długa 5 lokal 3', '[ADRES]'],
    ['Jan Kowalski, ul. Długa 5 lokal 3, tel. 600100200', `${N}, [ADRES], tel. ${T}`],
    ['zam. ul. Długa 5 lokal 3 lat 45', 'zam. [ADRES] lat 45'],
  ]);
});
test('Regresje b4 r2 · adres: forma zależna i etykieta następnego pola nie robią z numeru liczebnika', () => {
  masked([
    ['Sprawca odjechał spod posesji przy ul. Polnej 5 samochodem marki Opel.', 'Sprawca odjechał spod posesji przy [ADRES] samochodem marki Opel.'],
    ['Na miejscu ustalono, że przy ul. Polnej 5 pojazdem kierował Kamil Nowak.', `Na miejscu ustalono, że przy [ADRES] pojazdem kierował ${N}.`],
    ['Adres lokalu: ul. Ogrodowa 4 metraż: 48 m2', 'Adres lokalu: [ADRES] metraż: 48 m2'],
    ['Adres lokalu: ul. Ogrodowa 4 pokoje: 3', 'Adres lokalu: [ADRES] pokoje: 3'],
    ['Adres nieruchomości: ul. Kwiatowa 7 osób zamieszkujących: 4', 'Adres nieruchomości: [ADRES] osób zamieszkujących: 4'],
    ['Adres do korespondencji: ul. Kwiatowa 7 osób zamieszkujących: 4', 'Adres do korespondencji: [ADRES] osób zamieszkujących: 4'],
    ['ul. Polna 5 dzieci: 2', '[ADRES] dzieci: 2'],
    ['1. Kowalczyk Joanna ul. Polna 5 dzieci: 2', `1. ${N} [ADRES] dzieci: 2`],
    ['Wnioskodawca: Jan Kowalski ul. Polna 5 dzieci: 2', `Wnioskodawca: ${N} [ADRES] dzieci: 2`],
    ['Lokal przy ul. Ogrodowej 4 pokoje: 3, metraż: 48 m2', 'Lokal przy [ADRES] pokoje: 3, metraż: 48 m2'],
  ]);
});
test('Regresje b4 r2 · osoba: imię z homoglifem OCR zostaje przy osobie ze swojego wiersza', () => {
  masked([
    ['Nowak KaroI\nJan Kowalski', `${N}\n${N}`],
    ['Nowak KaroI\nWiśniewski Jan', `${N}\n${N}`],
    ['Lewandowski KaroI\nNowak Jan', `${N}\n${N}`],
    ['Świadkowie: Zieliński Kami1\nNowak Ewa', `Świadkowie: ${N}\n${N}`],
    ['Dzieci: Nowak J0anna\nNowak Piotr', `Dzieci: ${N}\n${N}`],
    ['Kowalczyk KaroI', N],
    // komórka CSV: wiersze się nie sklejają (kolumna imienia jak w „Kowalski,Jan")
    ['Nowak;KaroI\nWiśniewski;Jan;850314', `${N};KaroI\n${N};Jan;850314`],
    ['Kowalski;Jan\nNowak;Ewa', `${N};Jan\n${N};Ewa`],
    // OCR przed maską w tym samym wierszu i imię w wierszu nad nazwiskiem dalej w masce
    ['J0anna Kowalska złożyła wniosek.', `${N} złożyła wniosek.`],
    ['KaroI\nKowalski', N],
  ]);
  masked([['Nowak KaroI\nJan Kowalski', '[OSOBA-A]\n[OSOBA-B]']], { pseudonyms: true });
});
test('Regresje b4 r2 · osoba: imię w formie zależnej za nazwiskiem na -ski/-ska to inna osoba', () => {
  masked([
    ['Pozwany Zieliński Annie groził.', `Pozwany ${N} Annie groził.`],
    ['Świadek Kowalski Annę zna od dziecka.', `Świadek ${N} Annę zna od dziecka.`],
    ['Kierownik Kamiński Piotrowi przydzielił zadanie.', `Kierownik ${N} Piotrowi przydzielił zadanie.`],
    ['Biegły Wiśniewski Tomaszem zajmował się sprawą.', `Biegły ${N} Tomaszem zajmował się sprawą.`],
    // nazwisko bez odmiany w żeńskim, odmienione nazwisko i rekord w mianowniku dalej w jednej masce
    ['Wezwać Nowak Annę na przesłuchanie.', `Wezwać ${N} na przesłuchanie.`],
    ['Wniosek Nowak Anny został rozpatrzony.', `Wniosek ${N} został rozpatrzony.`],
    ['Wniosek Kowalskiego Stanisława', `Wniosek ${N}`],
    ['Kowalski Jan Paweł, PESEL 85031412347', `${N}, PESEL [PESEL]`],
  ]);
});
test('Regresje b4 r2 · obce litery: rdzeń ze słownika z obcym ogonem, marka po „pan", litery rumuńskie i wietnamskie', () => {
  masked([
    ['Kovalčuk Anna, PESEL 85031412347', `${N}, PESEL [PESEL]`],
    ['Świadek Bondarčuk zeznał.', `Świadek ${N} zeznał.`],
    ['Matka: Anna Kowalska z domu Bondarčuk', `Matka: ${N} z domu ${N}`],
    ['Pani Ioana Mureșan złożyła wniosek.', `Pani ${N} złożyła wniosek.`],
    ['Pani Mureșan przyszła.', `Pani ${N} przyszła.`],
    ['Pan Kowalski Škodą przyjechał na rozmowę, Pani Nowak Citroënem.', `Pan ${N} Škodą przyjechał na rozmowę, Pani ${N} Citroënem.`],
    ['Pan Škoda przyszedł.', `Pan ${N} przyszedł.`],
  ]);
  keep(['Czy jeździ pan Škodą czy Fiatem?', 'Pan Dyrektor Škodą przyjechał.']);
  // bez ogona liter za maską: wyraz albo w całości w masce, albo w całości jawny
  for (const s of ['Pani Lê Thị Hoa złożyła wniosek.', 'Pan Võ Văn Kiệt', 'Pan Nguyễn Văn Hùng — godz. 10:00', 'Pani Đặng Thị Lan']) {
    expect(redactPII(s).redacted).not.toMatch(/\]\p{L}/u);
  }
});
test('Regresje b4 r2 · osoba: długi wiersz „Do:" (ponad 1000 znaków) dalej jest nagłówkiem', () => {
  const s = `Do: ${'Kowalski Jan; '.repeat(72)}Sowa Halina`;
  expect(s.length).toBeGreaterThan(1000);
  const r = redactPII(s).redacted;
  expect(r).not.toContain('Halina');
  expect(r).not.toContain('Jan;');
});

// ── Audyt, partia b5: wycieki przy kotwicy ─────────────────────────────────────
const DW = '[NR-DOWODU]';
const PZ = '[NR-PASZPORTU]';
const RJ = '[NR-REJESTRACYJNY]';
const DU = '[DATA-URODZENIA]';
test('K41: dowód i paszport — „serii", „o numerze", seria i numer rozdzielone „nr" albo przecinkiem', () => {
  masked([
    ['legitymującym się dowodem osobistym serii ABA 123456', `legitymującym się dowodem osobistym serii ${DW}`],
    ['dowód osobisty seria ABA nr 300000', `dowód osobisty seria ${DW}`],
    ['legitymująca się dowodem osobistym serii ABA nr 300000, ważnym do dnia 1 marca 2030 roku', `legitymująca się dowodem osobistym serii ${DW}, ważnym do dnia 1 marca 2030 roku`],
    ['dowodem osobistym serii ABA numer 300000', `dowodem osobistym serii ${DW}`],
    ['DOWÓD OSOBISTY SERIA ABA NR 300000', `DOWÓD OSOBISTY SERIA ${DW}`],
    ['dowód osobisty seria ABA nr. 300000', `dowód osobisty seria ${DW}`],
    ['dowód osobisty seria ABA, numer 300000', `dowód osobisty seria ${DW}`],
    ['legitymacja służbowa seria ABA nr 300000', `legitymacja służbowa seria ${DW}`],
    ['dowodem osobistym o numerze ABA 123456', `dowodem osobistym o numerze ${DW}`],
    ['paszport seria AB nr 1234567', `paszport seria ${PZ}`],
    ['paszportem serii EA 1234567', `paszportem serii ${PZ}`],
  ]);
  keep([
    'Spółka wyemitowała obligacje serii ABA 123456 o wartości nominalnej 100 zł.',
    'akcje imienne serii ABA nr 300000 do 400000',
    'Dowód wpłaty serii ABC 123456 dołączono do akt.',
    'dowód rejestracyjny seria DRB nr 123456',
    'Dowód kasowy KPW nr 123456 z dnia 12.03.2024',
    'dowód osobisty wydany pod nr 123456',
    'legitymacja PZW nr 123456',
    'dowód osobisty seria abc nr 123456',
    'dowód osobisty seria ABA nr 3000001',
    'Paszport ważny do 12.03.2030 r.',
    'Liczba wydanych paszportów: 154321',
  ]);
});
test('K42: telefon po „nr", po etykiecie z dopełnieniem, „komórkę", „dzwonić pod numer" i stopce', () => {
  masked([
    ['Proszę o kontakt pod nr 512 345 678.\nDrugi numer: telefon nr 724 555 019.', `Proszę o kontakt pod nr ${T}.\nDrugi numer: telefon nr ${T}.`],
    ['Tel. kom. nr 600-100-200', `Tel. kom. nr ${T}`],
    ['Fax nr 22 123 45 67', `Fax nr ${T}`],
    ['telefon nr 600 700 800 oraz nr 601 702 803', `telefon nr ${T} oraz nr ${T}`],
    ['Kontakt: nr 600 700 800', `Kontakt: nr ${T}`],
    ['Telefon pacjenta: 41 344 56 78\ntel. stacj. 22 843 21 09', `Telefon pacjenta: ${T}\ntel. stacj. ${T}`],
    ['Nr tel. opiekuna: 22 501 23 45', `Nr tel. opiekuna: ${T}`],
    ['Telefon komórkowy pacjenta: 22 501 23 45', `Telefon komórkowy pacjenta: ${T}`],
    ['Można też dzwonić pod numer 32 256 77 41.\nna komórkę: 663.112.908', `Można też dzwonić pod numer ${T}.\nna komórkę: ${T}`],
    ['zadzwoń pod nr 785111222', `zadzwoń pod nr ${T}`],
    ['Phone: 22 395 41 07\nmob. 501.234.567', `Phone: ${T}\nmob. ${T}`],
    ['Mobile: 501.234.567 | GSM: 22 395 41 07', `Mobile: ${T} | GSM: ${T}`],
  ]);
  keep([
    'Decyzja nr 123 456 789',
    'Faktura nr 512 345 678 za usługi telefoniczne.',
    'Spółka wpisana do rejestru pod nr 123 456 789.',
    'Reklamacja zarejestrowana pod nr 512345678.',
    'Dotyczy kontaktu nr 123456789 w CRM.',
    'Telefon komórkowy nr seryjny 123 456 789.',
    'Kom. Wyborcza: 32 774 91 55 głosów',
    'Telefonów było: 32 774 91 55 wg zestawienia',
    'Telefon\nnr 123 456 789',
    'Telefon\nLp. 32 774 91 55',
    'Komórka organizacyjna nr 12 wydała 3 decyzje.',
    'Dzwonnica nr 123 456 789.',
    'Dzwonił w sprawie faktury pod numerem 2024/123/456.',
    'Kupiłem iPhone 15 Pro za 5 999 zł.',
    'Pasmo GSM 900 MHz, LTE 1800 MHz.',
    'Moduł GSM SIM800L, nr seryjny 22 395 41 07.',
    'Mobile: nie dotyczy',
    'Zgłoszono mobbing 2 razy w 2024 r.',
    'Telefony: na kwotę 123 456 789 zł.',
    'tel. godz. 10.30 12.03.2024 r.',
  ]);
});
test('K43: tablica po „nr. rej.", rzeczowniku pojazdu, łączniku, modelu, w komórce tabeli i w wyliczeniu „;"/„/"', () => {
  masked([
    ['Ciągnik nr rej. WGM 12345, nr rej. naczepy WGM 6789P', `Ciągnik nr rej. ${RJ}, nr rej. naczepy ${RJ}`],
    ['numer rejestracyjny auta: WE 12345', `numer rejestracyjny auta: ${RJ}`],
    ['nr rej. poj. WE 12345', `nr rej. poj. ${RJ}`],
    ['Sprawca kierował pojazdem marki Kia Sportage o nr. rej. SK 77701.', `Sprawca kierował pojazdem marki Kia Sportage o nr. rej. ${RJ}.`],
    ['Nr rej.poj. SK 77701', `Nr rej.poj. ${RJ}`],
    ['NR. REJ. SK 77701', `NR. REJ. ${RJ}`],
    ['Tablice rejestracyjne o numerze PO 5AB67 pozostają przy pojeździe.', `Tablice rejestracyjne o numerze ${RJ} pozostają przy pojeździe.`],
    ['numer tablicy sprawcy: WE 123AB', `numer tablicy sprawcy: ${RJ}`],
    ['o numerach rej. WE 12345 i WE 54321', `o numerach rej. ${RJ} i ${RJ}`],
    ['pojazdy o nr rej. WE 12345 / WE 54321; WE 99999', `pojazdy o nr rej. ${RJ} / ${RJ}; ${RJ}`],
    ['samochodem marki Toyota Yaris WE 12345 kierowała', `samochodem marki Toyota Yaris ${RJ} kierowała`],
    ['pojazdem marki Volkswagen Golf GD 4567K', `pojazdem marki Volkswagen Golf ${RJ}`],
    ['naczepa WGM 6789P', `naczepa ${RJ}`],
    ['nr rej. WPI KC27', `nr rej. ${RJ}`],
    ['| Nr rejestracyjny | WE 12345 |', `| Nr rejestracyjny | ${RJ} |`],
  ]);
  keep([
    'nr rej. naczepy nie został ustalony.',
    'nr rejestru BDO 000123456',
    'nr. rejestru ABC 1234/2020',
    'Komisariat nr. rejonu II, dzielnicowy sierż. sztab.',
    'Tablica o numerze INW 12345 jest w magazynie.',
    'Tablica pod tytułem ABC 2020 wisi w holu.',
    'Tablica rozdzielcza typu TR 2000',
    'Tablica nad WC12 wisi krzywo.',
    'pojazdy typu Euro VI PN 2020',
    'samochodem marki Lexus RX 450h kierowała',
    'pojazdem marki Toyota Yaris ISO 9001 certyfikat',
    'samochodem marki Opel Astra GTC 2015 rocznik',
    '| Kod | Tablica |\n|---|---|\n| AB1234 | informacyjna |',
    '| Nr rejestracyjny | brak |',
  ]);
  masked([
    ['nr rej. WE 12345 / ISO 9001', `nr rej. ${RJ} / ISO 9001`],
    ['nr rej. WE 12345; UE 2016/679', `nr rej. ${RJ}; UE 2016/679`],
    ['Pojazd nr rej. WE 12345;\nSN 2020 r. orzekł', `Pojazd nr rej. ${RJ};\nSN 2020 r. orzekł`],
  ]);
});
test('K44: tag XML z prefiksem przestrzeni nazw i klucze z ogonkami lub spacją', () => {
  masked([
    ['<ns2:Imie>Agnieszka</ns2:Imie>\n<etd:Nazwisko>Gżegżółka</etd:Nazwisko>\n<etd:DataUrodzenia>1985-03-14</etd:DataUrodzenia>', `<ns2:Imie>${N}</ns2:Imie>\n<etd:Nazwisko>${N}</etd:Nazwisko>\n<etd:DataUrodzenia>${DU}</etd:DataUrodzenia>`],
    ['<etd:Ulica>OGRODOWA</etd:Ulica><etd:NrDomu>12</etd:NrDomu><etd:Miejscowosc>TORUŃ</etd:Miejscowosc>', `<etd:Ulica>${A}</etd:Ulica><etd:NrDomu>${A}</etd:NrDomu><etd:Miejscowosc>${C}</etd:Miejscowosc>`],
    ['{"Imię": "Jolanta", "Miejscowość": "Ustka", "Data urodzenia": "1985-03-14"}', `{"Imię": "${N}", "Miejscowość": "${C}", "Data urodzenia": "${DU}"}`],
    ['<Miejscowość>Słupsk</Miejscowość>', `<Miejscowość>${C}</Miejscowość>`],
  ]);
  keep([
    '<cac:PartyName><cbc:Name>ACME Sp. z o.o.</cbc:Name></cac:PartyName>',
    '<cbc:Name>Wiktoria jabłka 1 kg</cbc:Name>',
    '<xs:element name="Nazwisko" type="xs:string"/>',
    '<etd:Nazwisko>brak</etd:Nazwisko>',
    '<a:Nazwisko>KUBIAK</b:Nazwisko>',
    '<soap:Body><ns2:Status>OK</ns2:Status></soap:Body>',
    '{"Imię": "brak"}',
    '{"Data wystawienia": "2024-01-01"}',
  ]);
});
test('K45: etykieta pola z dopełnieniem, bez ogonków i w szyku ZUS', () => {
  masked([
    ['Imię i nazwisko dziecka: Zając Oliwia\nNazwisko i imię pacjenta: WILK JADWIGA', `Imię i nazwisko dziecka: ${N}\nNazwisko i imię pacjenta: ${N}`],
    ['Imię i nazwisko opiekuna prawnego: Hans Gruber', `Imię i nazwisko opiekuna prawnego: ${N}`],
    ['Imię i nazwisko pacjenta\nWILK JADWIGA', `Imię i nazwisko pacjenta\n${N}`],
    ['imie: Michał\nnazwisko: Szymański\nmiejscowosc: Wrocław', `imie: ${N}\nnazwisko: ${N}\nmiejscowosc: ${C}`],
    ['Nazwisko panienskie: Brzęk', `Nazwisko panienskie: ${N}`],
    ['05. Imię pierwsze: ZOFIA\n06. Imię drugie\nANNA', `05. Imię pierwsze: ${N}\n06. Imię drugie\n${N}`],
  ]);
  keep([
    'Imię i nazwisko pacjenta należy wpisać drukowanymi literami.',
    'Imię i nazwisko pacjenta: nie dotyczy',
    'Imię i nazwisko świadczeniodawcy: Przychodnia Zdrowie Sp. z o.o.',
    'Imię i nazwisko pacjenta lub opiekuna prawnego',
    'Nazwisko i imię ubezpieczonego\nRozpoznanie',
    'Imię pierwsze lub drugie należy wpisać wielkimi literami.',
    'Imię pierwsze:\nImię drugie:\nNazwisko:',
    'Imie: brak\nMiejscowosc: nie dotyczy',
    'Miejscowosc i data: Wrocław, 12.03.2024',
  ]);
  // w trybie pseudonimów pole z nazwiskiem dostaje etykietę osoby, jak dawniej z przebiegów osób
  masked(
    [['Imię i nazwisko pracownika: Jan Kowalski\nPan Kowalski złożył wniosek.', 'Imię i nazwisko pracownika: [OSOBA-A]\nPan [OSOBA-A] złożył wniosek.']],
    { pseudonyms: true },
  );
});
test('K49: nazwisko panieńskie po masce osoby („z domu", „z d.", WERSALIKI, homograf)', () => {
  masked([
    ['EWELINA KRAWCZYK z domu MAJEWSKA', `${N} z domu ${N}`],
    ['ANNA NOWAK Z DOMU KOWALSKA', `${N} Z DOMU ${N}`],
    ['EWELINA KRAWCZYK Z D. MAJEWSKA', `${N} Z D. ${N}`],
    ['Anna Nowak z domu Bąk', `${N} z domu ${N}`],
    ['Anna Kowalska z domu Sikora\nMagdalena Kaczmarek (z d. Sikora)', `${N} z domu ${N}\n${N} (z d. ${N})`],
    ['Anna Kowalska, z domu Sikora, ur. 12.03.1980', `${N}, z domu ${N}, ur. ${DU}`],
    ['Anna z d. Sikora', N],
  ]);
  keep(['Uczestnicy wyszli z domu KULTURY', 'Pracuje w Domu Pomocy Społecznej w Krakowie.', 'Pismo z d. 12.03.2024 r. w sprawie lokalu', 'Anna z domu Pomocy Społecznej']);
  masked([
    ['JAN KOWALSKI Z DOMU DZIECKA NR 3', `${N} Z DOMU DZIECKA NR 3`],
    ['JAN KOWALSKI Z DOMU WYSZEDŁ RANO', `${N} Z DOMU WYSZEDŁ RANO`],
    ['Anna Nowak z Domu Pomocy Społecznej w Krakowie', `${N} z Domu Pomocy Społecznej w Krakowie`],
    ['Jan Kowalski z domu Kultury odebrał nagrodę.', `${N} z domu Kultury odebrał nagrodę.`],
    ['Anna Kowalska z Tychów przyjechała.', `${N} z Tychów przyjechała.`],
  ]);
});
test('K50: imię na końcu porcji RE_NAME_SEQ nie odcina nazwiska w długim ciągu wyrazów z wielkiej litery', () => {
  masked([
    ['Kierownik Działu Kadr Grzegorz Mazur', `Kierownik Działu Kadr ${N}`],
    ['Społeczny Inspektor Pracy Mirosław Bąk', `Społeczny Inspektor Pracy ${N}`],
    ['Starszy Specjalista Działu Kadr Płac Ochrony Danych Ewa Sowa', `Starszy Specjalista Działu Kadr Płac Ochrony Danych ${N}`],
    ['Przewodniczący: Sędzia Sądu Okręgowego Jan Gzowski', `Przewodniczący: Sędzia Sądu Okręgowego ${N}`],
    ['Sędzia Sądu Rejonowego Piotr Gwizdała', `Sędzia Sądu Rejonowego ${N}`],
    ['Kierownik Działu Kadr Anna Maria Kowalska', `Kierownik Działu Kadr ${N}`],
  ]);
  keep([
    'Akademia Wychowania Fizycznego Józefa Piłsudskiego',
    'Rektor Uniwersytetu Kardynała Stefana Wyszyńskiego',
    'Dyrektor Szkoły Podstawowej Marii Konopnickiej',
    'Port Lotniczy Gdańsk Lecha Wałęsy',
    'Kierownik Działu Kadr Grzegorz',
    'Kierownik Działu Kadr Grzegorz\nMazur',
    'Kierownik Działu Kadr Maja Obchody',
    'Święto Konstytucji Trzeciego Maja Obchody',
    'Sędzia Sądu Okręgowego Jan Paweł',
    'Hotel Grand Park Róża Wiatrów',
  ]);
});
test('K52: klucze struktur — dokumenty, tablica, rachunek, złożone klucze telefonu i numerowane pola', () => {
  masked([
    ['{"paszport": "EA1234567", "prawo_jazdy": "01234/12/1234"}\n<KRS>0000123456</KRS>', '{"paszport": "[NR-PASZPORTU]", "prawo_jazdy": "[PRAWO-JAZDY]"}\n<KRS>[KRS]</KRS>'],
    ['{"dowód osobisty":"ABC123450"}', `{"dowód osobisty":"${DW}"}`],
    ['{"nrRejestracyjny": "WE12345", "marka": "Opel"}', `{"nrRejestracyjny": "${RJ}", "marka": "Opel"}`],
    ['{"rachunek": "61 1090 1014 0000 0712 1981 2875"}\n<NrRachunku>61109010140000071219812875</NrRachunku>', '{"rachunek": "[NR-KONTA]"}\n<NrRachunku>[NR-KONTA]</NrRachunku>'],
    ['{"nrTelefonu": "22 501 23 45", "telefonDomowy": "22 501 23 46", "phone2": "512.345.678"}', `{"nrTelefonu": "${T}", "telefonDomowy": "${T}", "phone2": "${T}"}`],
    ['{"addressLine1": "Kościuszki 12/3", "addressLine2": "43-300 Bielsko-Biała"}', `{"addressLine1": "${A}", "addressLine2": "${KOD} ${C}"}`],
    ['<ImiePierwsze>Krzysztof</ImiePierwsze>\n<ImieOjca>Henryk</ImieOjca>\n<NazwiskoRodowe>Gżegżółka</NazwiskoRodowe>\n<MiejsceUrodzenia>Sieradz</MiejsceUrodzenia>', `<ImiePierwsze>${N}</ImiePierwsze>\n<ImieOjca>${N}</ImieOjca>\n<NazwiskoRodowe>${N}</NazwiskoRodowe>\n<MiejsceUrodzenia>${C}</MiejsceUrodzenia>`],
  ]);
  keep([
    '{"orderId": "EA1234567", "version": "AB1234567"}',
    '{"paszport": "brak", "krs": "nie dotyczy", "prawoJazdy": "kat. B"}',
    '{"plate": "Margherita", "tablica": "PN-EN 1176"}',
    '{"registrationNumber": "HRB 12345"}',
    '{"nrRej": "000012345"}',
    '{"rachunek": "R/2026/001", "konto": "201-01"}',
    '{"accountNumber": "00000000000000000000000000"}',
    '<KontoWn>201-2-1-123</KontoWn>',
    '{"phoneVerifiedAt": "2024-05-12T10:00:00", "telemetryId": "22 501 23 45"}',
    '{"phoneCountryCode": "48", "phonesTotal": "1 234 567"}',
    '<TelefonId>2250123</TelefonId>',
    '{"user1": "active", "name1": "Produkt Premium"}',
    '{"tel1": "wew. 123", "street1": "brak"}',
  ]);
});
test('K53: data urodzenia po etykiecie z dopełnieniem, z nawiasem formatu, w formie zależnej i przy etykiecie łączonej', () => {
  masked([
    ['Data urodzenia pacjenta: 14.03.1958\nData urodzenia dziecka: 02.07.2019\nPacjentka urodzona w dniu 14.03.1958 r.\nData urodz.: 02.07.2019', `Data urodzenia pacjenta: ${DU}\nData urodzenia dziecka: ${DU}\nPacjentka urodzona w dniu ${DU} r.\nData urodz.: ${DU}`],
    ['8. Data urodzenia (dzień – miesiąc – rok): 15-07-2001', `8. Data urodzenia (dzień – miesiąc – rok): ${DU}`],
    ['Data urodzenia (DD.MM.RRRR) 15.07.2001', `Data urodzenia (DD.MM.RRRR) ${DU}`],
    ['Data urodzenia pierwszego dziecka: 03.11.1990', `Data urodzenia pierwszego dziecka: ${DU}`],
    ['Pani Hanny Michalak, urodzonej 12.03.1980 r. w Krakowie', `Pani ${N}, urodzonej ${DU} r. w ${C}`],
    ['urodzona w dniu 12.03.1980 r. w Krakowie', `urodzona w dniu ${DU} r. w ${C}`],
    ['Data i miejsce urodzenia: 12.04.1985, Kielce', `Data i miejsce urodzenia: ${DU}, ${C}`],
    ['Miejsce i data urodzenia: Kielce, 12.04.1985', `Miejsce i data urodzenia: ${C}, ${DU}`],
    ['ur 14.02.1993', `ur ${DU}`],
  ]);
  keep([
    'Data przyjęcia pacjenta: 14.03.2024',
    'Data urodzenia pacjenta w systemie uzupełniono 14.03.2024.',
    'Data urodzenia (zob. pkt 3) nie jest wymagana do 15.07.2024.',
    'Data urodzenia w formacie: 01.01.1970',
    'Data urodzenia pracownika a data zatrudnienia: 01.02.2020',
    'dotyczy osoby urodzonej po 31.12.1999 r.',
    'dla dzieci urodzonych 1 stycznia 2016 r. przysługuje dodatek',
    'Dziecko urodzi się około 12.05.2026.',
    'Senat UR 14.02.1993 podjął uchwałę.',
    'Data i miejsce zawarcia umowy: 12.04.2020, Kielce',
    'Data i miejsce urodzenia Kandydata podaje się w CV.',
    'Zapraszam na urodziny w sobotę 12.05.2024 o 18:00.',
  ]);
});
test('K54: miasto w formie zależnej spoza słownika, WERSALIKAMI po kodzie i adresie, w wierszu CSV', () => {
  masked([
    ['Jan Nowak, zam. w Białymstoku, wnosi o...', `${N}, zam. w ${C}, wnosi o...`],
    ['zam. w Siedlcach', `zam. w ${C}`],
    ['UL. LIPOWA 14, 26-900 KOZIENICE', `${A}, ${KOD} ${C}`],
    ['JAN KOWALSKI / UL. LIPOWA 14 / 26-900 KOZIENICE', `${N} / ${A} / ${KOD} ${C}`],
    ['UL. LIPOWA 7, KRAKÓW', `${A}, ${C}`],
    ['33-300 NOWY SĄCZ', `${KOD} ${C}`],
    ['00-950 WARSZAWA 1', `${KOD} ${C} 1`],
    ['Nowak;Jan;ul. Długa 5;00-001;Warszawa', `${N};Jan;${A};${KOD};${C}`],
    ['Adres: ul. Długa 5, 00-001, Warszawa.', `Adres: ${A}, ${KOD}, ${C}.`],
    ['Nowak;Jan;ul. Długa 5;Warszawa', `${N};Jan;${A};${C}`],
  ]);
  keep([
    'Spotkanie w Białymstoku odbyło się wczoraj.',
    'Sąd Apelacyjny w Białymstoku oddalił apelację.',
    'Huta Stalowa Wola S.A. ogłosiła przetarg.',
    'SĄD REJONOWY W KOZIENICACH',
    'KOZIENICE, DNIA 12.03.2024 R.',
    'Koszt naprawy wyniesie 10-200 PLN brutto.',
    'Spotkanie w Gdańsku, potem Warszawa, Kraków; Poznań.',
  ]);
  masked([
    ['Faktura 12-345 VAT', `Faktura ${KOD} VAT`],
    ['Partia 11-222 ZUS RCA przekazana.', `Partia ${KOD} ZUS RCA przekazana.`],
    ['KOD POCZTOWY: 00-001 POCZTA: WARSZAWA', `KOD POCZTOWY: ${KOD} POCZTA: WARSZAWA`],
    ['00-238 POCZTA WARSZAWA', `${KOD} POCZTA WARSZAWA`],
    ['kod;kraj\n00-001;Polska', `kod;kraj\n${KOD};Polska`],
    ['Kody 00-001, 00-002 i 00-003, Warszawa zgłosiła awarię.', `Kody ${KOD}, ${KOD} i ${KOD}, Warszawa zgłosiła awarię.`],
    ['00-001,Polska Grupa Energetyczna', `${KOD},Polska Grupa Energetyczna`],
  ]);
});
test('K55: „ul." sklejone z nazwą ulicy', () => {
  masked([
    ['zam. UL.LIPOWA 14/3', `zam. ${A}`],
    ['zam. ul.Długa 5/3, 00-950 Warszawa', `zam. ${A}, ${KOD} ${C}`],
    ['przy ul.Lipowej 14 w Krakowie', `przy ${A} w ${C}`],
    ['{"adres":"ul.Lipowa 14/3"}', `{"adres":"${A}"}`],
    ['ul.Jana Kowalskiego 5', A],
    ['zam. UI.LIP0WA 14', `zam. ${A}`],
  ]);
  keep([
    'Remont ul.Lipowej potrwa do maja.',
    'ul.Lipowa jest zamknięta od 2020 r.',
    'Smith et al.Nature 12, 345.',
    'Pokój dla 2 os.Cena 350 zł za noc.',
    'Kupiłem to na allegro.pl.W 2020 roku zwróciłem towar.',
    'os.Exit(1)',
    'plik: skan_ul.Długa 5.pdf',
    'Paul.Smith 5',
    'Mam ul Dadanta 10 ramkowy w pasiece.',
    'Patronem ul.Jana Kilińskiego jest szewc.',
  ]);
});
test('K57: karta płatnicza po „number", „o numerze" i w kluczu zrośniętym', () => {
  const NK = '[NR-KARTY]';
  masked([
    ['Card number: 4532 0151 1283 0366\n"card_number": "4532015112830366"\nzapłacono kartą o numerze 4532 0151 1283 0366', `Card number: ${NK}\n"card_number": "${NK}"\nzapłacono kartą o numerze ${NK}`],
    ['karta o nr 4532 0151 1283 0366', `karta o nr ${NK}`],
    ['{"cardNumber": "4532015112830366"}', `{"cardNumber": "${NK}"}`],
    ['card_no: 4532015112830366', `card_no: ${NK}`],
  ]);
  keep([
    'IMEI: 356938035643809',
    'Numer zamówienia: 4532015112830366',
    'umowa o numerze 4532015112830366',
    'card number: 4532 0151 1283 0367',
    'Discard number 4532015112830366',
    'scorecard number 4532015112830366',
    'kartą o numerze kończącym się na 0366',
    'Karta Dużej Rodziny nr 123456',
    'cardNumberMasked: ************0366',
  ]);
});

// ── Partia b5, poprawki po weryfikacji (runda 1) ───────────────────────────────
test('b5 r1, K43: kod silnika za modelem, temat ogłoszenia na tablicy, skrót z rokiem w wyliczeniu, „numerze rejsu"', () => {
  keep([
    'samochodem marki Volkswagen Golf GTI 1800 kierował',
    'samochód marki Renault Master DCI 2300',
    'Motocykl marki Suzuki V-Strom DL 1000, rok produkcji 2006.',
    'motocykl marki Honda Fireblade CBR 1100 XX',
    'Ogłoszenie na tablicy o PIT 2024 zostało zdjęte.',
    'Obwieszczenie wywieszono na tablicy pod RPO 2021.',
    'Informację na tablicy o RPO 2021-2027 zaktualizowano.',
    'Reklamacja lotu o numerze rejsu LO 3925.',
    'Lot z numerem rejsu FR 1234 był opóźniony.',
    'Instytucja wpisana do rejestru pod numerem rejestrowym RIK 12345.',
    'wpisany do rejestru zabytków pod numerem rejestru KL 12345',
  ]);
  masked([
    ['samochód marki Skoda Octavia TSI 1400 o nr rej. WE 12345', `samochód marki Skoda Octavia TSI 1400 o nr rej. ${RJ}`],
    ['samochodem marki Toyota Yaris WE 12345 kierowała', `samochodem marki Toyota Yaris ${RJ} kierowała`],
    ['pojazdem marki Volkswagen Golf GD 4567K', `pojazdem marki Volkswagen Golf ${RJ}`],
    ['pojazd marki Ford Transit WPI 1234', `pojazd marki Ford Transit ${RJ}`],
    ['Tablica o numerze WE 12345 wisi na bramie.', `Tablica o numerze ${RJ} wisi na bramie.`],
    ['Pojazd nr rej. WE 12345; OC 2024 ważne', `Pojazd nr rej. ${RJ}; OC 2024 ważne`],
    ['nr rej. WE 12345 / PZU 2024', `nr rej. ${RJ} / PZU 2024`],
    ['nr rej. WE 12345; SN 2020 r. orzekł', `nr rej. ${RJ}; SN 2020 r. orzekł`],
    ['nr rej. WE 12345 / WGM 1234A', `nr rej. ${RJ} / ${RJ}`],
    ['pojazd o numerze rejestracyjnym WE 12345', `pojazd o numerze rejestracyjnym ${RJ}`],
    ['pojazdem o numerze rej. WE 12345', `pojazdem o numerze rej. ${RJ}`],
    ['pojazd o numerze rejestracji WE 12345', `pojazd o numerze rejestracji ${RJ}`],
  ]);
});
test('b5 r1, K42: „nr" po przymiotniku i liczbie mnogiej to numer sprawy, a odrzucona kotwica „kontakt nr" nie zjada telefonu za nią', () => {
  keep([
    'Przyjęto zgłoszenie telefoniczne nr 512345678 dotyczące awarii.',
    'Zgłoszenie telefoniczne nr 202410001 zarejestrowano w systemie.',
    'Umowa telefoniczna nr 512345678 z dnia 12.03.2024',
    'Zakup telefonów nr 512 345 678',
    'Faktura za telefony nr 512 345 678',
    'Abonament telefoniczny nr 512 345 678',
    'Zgłoszenie przyjęto telefonicznie pod nr 512345678.',
    'Dotyczy kontaktu nr 123456789 w CRM.',
  ]);
  masked([
    ['Kontaktowy nr: 600 700 800, tel. 22 843 21 09', `Kontaktowy nr: ${T}, tel. ${T}`],
    ['Kontakt nr 512 345 678, tel. 22 843 21 09', `Kontakt nr 512 345 678, tel. ${T}`],
    ['Podaję kontaktowy nr 600 700 800 oraz tel. 22 843 21 09.', `Podaję kontaktowy nr 600 700 800 oraz tel. ${T}.`],
    ['Dotyczy kontaktu nr 123456789, tel. 22 843 21 09', `Dotyczy kontaktu nr 123456789, tel. ${T}`],
    ['Kontakt nr 512 345 678, kontakt nr 22 843 21 09, tel. 22 843 21 08', `Kontakt nr 512 345 678, kontakt nr 22 843 21 09, tel. ${T}`],
    ['Kontakt nr: 22 843 21 09', `Kontakt nr: ${T}`],
    ['Telefony: nr 22 843 21 09', `Telefony: nr ${T}`],
    ['Telefonem nr 600 700 800', `Telefonem nr ${T}`],
    ['telefonicznie: 22 843 21 09', `telefonicznie: ${T}`],
    // „Telefony" na początku wiersza to nagłówek listy, a nie towar
    ['Telefony nr 600 700 800 i 601 702 803', `Telefony nr ${T} i ${T}`],
  ]);
  masked([['Kontakt nr 512 345 678, tel. 22 843 21 09', `Kontakt nr 512 345 678, tel. ${T}`]], { pseudonyms: true });
});
test('b5 r1, K50: za nazwą organizacji bez roli imię i nazwisko w mianowniku to patron', () => {
  keep(['Stowarzyszenie Przyjaciół Szkoły Adam Mickiewicz', 'Towarzystwo Miłośników Ziemi Jan Kochanowski']);
  masked([
    ['Główny Księgowy Spółki Katarzyna Lis', `Główny Księgowy Spółki ${N}`],
    ['Prezes Fundacji Rozwoju Adam Nowak', `Prezes Fundacji Rozwoju ${N}`],
    ['Kierownik Działu Kadr Grzegorz Mazur', `Kierownik Działu Kadr ${N}`],
  ]);
});
test('b5 r1, K49: po „z domu" i „z d." tylko mianownik — przymiotnik, rzeczownik rodzinny i narzędnik to nie nazwisko panieńskie', () => {
  masked([
    ['Anna Kowalska z domu Polskiego', `${N} z domu Polskiego`],
    ['Anna Nowak z domu Pogodnej Jesieni', `${N} z domu Pogodnej Jesieni`],
    ['Kasia Kowal z domu Babci przyniosła ciasto.', `${N} z domu Babci przyniosła ciasto.`],
    ['Małoletni Kacper Lis z domu Państwa Wróblów został przeniesiony.', `Małoletni ${N} z domu Państwa Wróblów został przeniesiony.`],
    ['Pan Józef Mróz z domu Ludowego w Kępicach przywiózł rzeczy.', `Pan ${N} z domu Ludowego w Kępicach przywiózł rzeczy.`],
    ['Salę udostępniła Halina Grzyb z domu Strażaka w Pęcicach.', `Salę udostępniła ${N} z domu Strażaka w Pęcicach.`],
    ['Anna Nowak z domu Polonii w Pułtusku.', `${N} z domu Polonii w Pułtusku.`],
    ['Anna Nowak z domu Matki Bożej', `${N} z domu Matki Bożej`],
    ['Jan Kowalski z d. Pismem z dnia', `${N} z d. Pismem z dnia`],
    // inicjał drugiej osoby po „z" nie zostaje jawny obok maski
    ['Spotkanie Jana Kowalskiego z D. Nowakiem.', `Spotkanie ${N} z ${N}.`],
    ['Rozmowa z Janem Kowalskim z D. Nowak.', `Rozmowa z ${N} z ${N}.`],
    ['Anna Kowalska z domu Sikora', `${N} z domu ${N}`],
    ['Anna Kowalska z domu Gżegżółka', `${N} z domu ${N}`],
    ['EWELINA KRAWCZYK Z D. MAJEWSKA', `${N} Z D. ${N}`],
  ]);
  masked(
    [
      ['Spotkanie Jana Kowalskiego z D. Nowakiem.', 'Spotkanie [OSOBA-A] z [OSOBA-B].'],
      ['Magdalena Kaczmarek (z d. Sikora)', '[OSOBA-A] (z d. [OSOBA-B])'],
      ['EWELINA KRAWCZYK Z D. MAJEWSKA', '[OSOBA-A] Z D. [OSOBA-B]'],
    ],
    { pseudonyms: true },
  );
});
test('b5 r1, K45: nowe etykiety pól — wartość, która nie jest osobą, nagłówek tabeli w następnej linii, interpunkcja i klucz pseudonimu', () => {
  keep([
    'Imię i nazwisko ucznia\nKlasa',
    'Imię i nazwisko opiekuna prawnego\nCzytelny podpis',
    'Nazwisko i imię pracownika\nWynagrodzenie',
    'Imiona dziecka\nWiek',
    'Nazwisko ucznia\nŚrednia',
    'Imię i nazwisko opiekuna prawnego\nDom Dziecka w Teresinie',
    'Nazwisko osoby kontaktowej: Prezes Zarządu',
    'Imię i nazwisko osoby upoważnionej: Sekretarz Gminy',
    'Imię i nazwisko wnioskodawcy: Gmina Michałowice',
    'Imię i nazwisko osoby kontaktowej: Dział Kadr',
    'Imię i nazwisko pełnomocnika: Kancelaria Radcy Prawnego',
    'Imię i nazwisko wnioskodawcy: wpisać drukowanymi literami',
    'Imię i nazwisko ojca: nieustalone',
    'Nazwisko i imię pacjenta: NN',
    'Imię i nazwisko pacjenta: N.N.',
    'Imię i nazwisko matki: jak wyżej',
  ]);
  masked([
    ['Imię i nazwisko pacjenta: Jan Kowalski.\nPacjent Jan Kowalski zgłosił się.', `Imię i nazwisko pacjenta: ${N}.\nPacjent ${N} zgłosił się.`],
    ['Imię i nazwisko pacjenta\nJan Kowalski.', `Imię i nazwisko pacjenta\n${N}.`],
    ['Imię i nazwisko pełnomocnika: adw. Piotr Zając', `Imię i nazwisko pełnomocnika: adw. ${N}`],
    ['Lp.\nImię i nazwisko ucznia\nKlasa\nŚrednia\n1.\nJan Kowalski', `Lp.\nImię i nazwisko ucznia\nKlasa\nŚrednia\n1.\n${N}`],
    // runda 2: wartość z następnej linii musi mieć imię albo nazwisko ze słownika („Hans Gruber"
    // w następnym wierszu zostaje jawny jak przed partią — patrz test „b5 r2, K45")
    ['Imię i nazwisko opiekuna prawnego\nAnna Gruber', `Imię i nazwisko opiekuna prawnego\n${N}`],
    ['Nazwisko i imię pacjenta: Marszałek Anna', `Nazwisko i imię pacjenta: ${N}`],
    ['Imię i nazwisko pacjenta: jan kowalski', `Imię i nazwisko pacjenta: ${N}`],
  ]);
  masked(
    [
      ['Imię i nazwisko pacjenta: Jan Kowalski.\nPacjent Jan Kowalski zgłosił się.', 'Imię i nazwisko pacjenta: [OSOBA-A].\nPacjent [OSOBA-A] zgłosił się.'],
      ['Nazwisko i imię ucznia: Kuba Kowal\nNazwisko i imię dziecka: Kuba Lis', 'Nazwisko i imię ucznia: [OSOBA-A]\nNazwisko i imię dziecka: [OSOBA-B]'],
      ['Nazwisko i imię pacjenta: Hans Schmidt\nNazwisko i imię opiekuna: Hans Becker', 'Nazwisko i imię pacjenta: [OSOBA-A]\nNazwisko i imię opiekuna: [OSOBA-B]'],
      ['Imię i nazwisko pacjenta: Bondarenko Olena\nImię i nazwisko opiekuna: Kowal Olena', 'Imię i nazwisko pacjenta: [OSOBA-A]\nImię i nazwisko opiekuna: [OSOBA-B]'],
      ['Imię i nazwisko pacjenta: Nguyen Van Minh\nImię i nazwisko opiekuna: Tran Van Minh', 'Imię i nazwisko pacjenta: [OSOBA-A]\nImię i nazwisko opiekuna: [OSOBA-B]'],
      ['Imię i nazwisko pacjenta: Nguyen Thi Hoa\nPani Nguyen zgłosiła się.', 'Imię i nazwisko pacjenta: [OSOBA-A]\nPani [OSOBA-A] zgłosiła się.'],
      ['Nazwisko i imię pacjenta: Hans Gruber\nPan Gruber przyszedł.', 'Nazwisko i imię pacjenta: [OSOBA-A]\nPan [OSOBA-A] przyszedł.'],
      ['Imię i nazwisko wnioskodawcy: Mał-\ngorzata Kamińska\nImie i nazwisko: Małgorzata Kamińska', 'Imię i nazwisko wnioskodawcy: [IMIĘ I NAZWISKO]\ngorzata [OSOBA-A]\nImie i nazwisko: [OSOBA-A]'],
      ['Imię i nazwisko ucznia\nKlasa\nJan Kowalski', 'Imię i nazwisko ucznia\nKlasa\n[OSOBA-A]'],
    ],
    { pseudonyms: true },
  );
});
test('b5 r1, K53: data progowa w przepisie („… lub później") i „osobom urodzonym" to nie data osoby', () => {
  keep([
    'Kobiecie urodzonej 1 stycznia 1953 r. lub później przysługuje emerytura.',
    'Art. 15. 1. Świadczenie przysługuje matce lub ojcu dziecka urodzonego 1 stycznia 2016 r. lub później.',
    'Świadczenie przysługuje rodzicowi dziecka urodzonego w dniu 1 stycznia 2027 r. lub później.',
    'Zwolnienie przysługuje osobom urodzonym 31 grudnia 1950 r. lub wcześniej.',
    'Karta Seniora przysługuje osobie urodzonej 31 grudnia 1961 r. lub wcześniej.',
    'Bon przysługuje dziecku urodzonemu 1 stycznia 2027 r. lub później.',
    'Dzieciom urodzonym 12.03.2020 przysługuje dodatek.',
  ]);
  masked([
    ['z Janem Kowalskim urodzonym 12.03.1980 r.', `z ${N} urodzonym ${DU} r.`],
    ['ojcostwa dziecka urodzonego dnia 12 marca 2020 r. w Krakowie', `ojcostwa dziecka urodzonego dnia ${DU} r. w ${C}`],
    ['urodzona w dniu 12.03.1980 r. w Krakowie', `urodzona w dniu ${DU} r. w ${C}`],
    // „i później" to dalszy ciąg życiorysu, nie próg
    ['urodzona 12.03.1953 r. i później zamieszkała w Krakowie', `urodzona ${DU} r. i później zamieszkała w ${C}`],
  ]);
});
test('b5 r1, K54: etykieta pola po kodzie to nie miejscowość, a wieś wielowyrazowa WERSALIKAMI w bloku adresowym dostaje maskę w całości', () => {
  masked([
    ['ul. Lipowa 14, 26-900 TELEFON 600700800', `${A}, ${KOD} TELEFON ${T}`],
    ['ul. Długa 5, 00-001 DATA 12.03.2024', `${A}, ${KOD} DATA 12.03.2024`],
    ['UL. POLNA 2, 00-950 SKRYTKA POCZTOWA 12', `${A}, ${KOD} SKRYTKA POCZTOWA 12`],
    ['UL. LIPOWA 14\n26-900 ODBIÓR OSOBISTY', `${A}\n${KOD} ODBIÓR OSOBISTY`],
    ['UL. LIPOWA 14, 26-900 PACZKOMAT KOZ01M', `${A}, ${KOD} PACZKOMAT KOZ01M`],
    ['UL. LIPOWA 14, 05-300 STARA WIEŚ', `${A}, ${KOD} ${C}`],
    ['UL. LIPOWA 14, 05-300 NOWA WIEŚ WIELKA', `${A}, ${KOD} ${C}`],
    ['UL. LIPOWA 2, 62-530 KAZIMIERZ BISKUPI', `${A}, ${KOD} ${C}`],
    ['ul. Lipowa 2, 97-320 WOLA KRZYSZTOPORSKA', `${A}, ${KOD} ${C}`],
    ['UL. LIPOWA 14, 26-900 GŁOWACZÓW TEL. 600 700 800', `${A}, ${KOD} ${C} TEL. ${T}`],
    ['UL. LIPOWA 14 26-900 GŁOWACZÓW JAN KOWALSKI', `${A} ${KOD} ${C} ${N}`],
    ['UL. LIPOWA 14, 05-300 STARA WIEŚ JAN KOWALSKI', `${A}, ${KOD} ${C} ${N}`],
    ['UL. LIPOWA 14, 26-900 GŁOWACZÓW POW. KOZIENICKI', `${A}, ${KOD} ${C} POW. KOZIENICKI`],
    ['UL. LIPOWA 14, 26-900 KOZIENICE', `${A}, ${KOD} ${C}`],
  ]);
});
test('b5 r1, K55: sklejone „UI." bez etykiety adresu i „os."/„pl." bez spacji to nie skrót ulicy ani patrona', () => {
  keep(['Zmiana w UI.Panel 2.0', 'UI.Dashboard 10 widgetów', 'Moduł UI.Lista 3 elementy', 'mod.UI.Grid 12']);
  masked([
    ['zam. UI.LIP0WA 14', `zam. ${A}`],
    ['Obecnych 12 os.Halina Grzyb przewodniczyła.', `Obecnych 12 os.${N} przewodniczyła.`],
    ['Obecnych 12 os. Halina Grzyb przewodniczyła.', `Obecnych 12 os. ${N} przewodniczyła.`],
    ['Spis na stronie gmina.pl.Halina Grzyb, sekretarz', `Spis na stronie gmina.pl.${N}, sekretarz`],
    ['ul.Jana Kowalskiego 5', A],
  ]);
  masked([['Obecnych 12 os.Halina Grzyb przewodniczyła. Pani Grzyb podziękowała.', 'Obecnych 12 os.[OSOBA-A] przewodniczyła. Pani [OSOBA-A] podziękowała.']], { pseudonyms: true });
});
test('b5 r1, K52: „komórka" z kodem jednostki, kraj w drugiej linii adresu i rok przy prawie jazdy', () => {
  keep([
    '{"komorka": "120400"}',
    '<Komorka>120400</Komorka>',
    '{"nrKomorki": "120400"}',
    '{"komorka":"01-02-03"}',
    '{"addressLine2": "Polska", "prawoJazdy": "2010"}',
    '{"prawoJazdy": "2010-05-12"}',
  ]);
  masked([
    ['{"komorka": "600 700 800"}', `{"komorka": "${T}"}`],
    ['{"prawoJazdy": "01234/12/1234"}', '{"prawoJazdy": "[PRAWO-JAZDY]"}'],
    ['{"addressLine1": "Kościuszki 12/3", "addressLine2": "lok. 5"}', `{"addressLine1": "${A}", "addressLine2": "lok. 5"}`],
  ]);
});
test('Resztki b5 · osoba po roli: nazwa klubu z miastem, firma z imieniem, forma prawna i patron instytucji z przymiotnikiem zostają jawne', () => {
  keep([
    'Prezes Klubu Sportowego Lech Poznań zwołał zebranie.',
    'Prezes Klubu Sportowego Lech Poznań przesłał pismo.',
    'Pełnomocnik Zarządu Spółki Marek Trans Sp. z o.o.',
    'Pełnomocnik Zarządu Spółki Agata Meble S.A.',
    'Prezes Zarządu Firmy Adam Sp. z o.o.',
    'Dyrektor Handlowy Firmy Marek Sp. z o.o.',
    'Gminny Ośrodek Kultury Stefan Żeromski organizuje konkurs.',
    'Miejski Dom Kultury Adam Mickiewicz zaprasza.',
  ]);
  masked([
    ['Prezes Zarządu Spółki Lech Poznań S.A. Piotr Rutkowski podpisał umowę.', `Prezes Zarządu Spółki Lech Poznań S.A. ${N} podpisał umowę.`],
    ['Prezes Zarządu Spółki Marek Nowak podpisał.', `Prezes Zarządu Spółki ${N} podpisał.`],
    ['Dyrektor Gminnego Ośrodka Kultury Jan Kowalski zaprasza.', `Dyrektor Gminnego Ośrodka Kultury ${N} zaprasza.`],
  ]);
});
test('Resztki b5 · etykieta pola z dopełnieniem: instytucja, rola, forma prawna i nagłówek kolumny w następnej linii to nie osoba', () => {
  keep([
    'Imię i nazwisko opiekuna prawnego: Powiatowe Centrum Pomocy Rodzinie',
    'Imię i nazwisko opiekuna prawnego: Gminny Ośrodek Pomocy Społecznej',
    'Imię i nazwisko opiekuna prawnego: Rodzina Zastępcza',
    'Imię i nazwisko opiekuna prawnego: Matka',
    'Imię i nazwisko osoby kontaktowej: Recepcja',
    'Imię i nazwisko opiekuna prawnego: Miejski Ośrodek Pomocy Społecznej',
    'Imię i nazwisko wnioskodawcy: PGE Dystrybucja S.A.',
    'Imię i nazwisko ubezpieczonego: ZUS Oddział Siedlce',
    'Imię i nazwisko wnioskodawcy: Wspólnota Mieszkaniowa',
    'Imię i nazwisko wnioskodawcy: Gazeta Wyborcza',
    'Imię i nazwisko wnioskodawcy: Ochotnicza Straż Pożarna',
    'Imię i nazwisko pracownika: Kierowca',
    'LP.\nIMIĘ I NAZWISKO UCZNIA\nPODPIS RODZICA',
    'Imię i nazwisko ucznia\nGRUPA WIEKOWA',
    'Imię i nazwisko ucznia\nWychowawca Klasy',
    'Imię i nazwisko pacjenta\nLekarz Prowadzący\nRozpoznanie',
    'Imię i nazwisko dziecka\nGrupa Przedszkolna',
  ]);
  masked([
    ['Imię i nazwisko opiekuna prawnego: Anna Kowalska', `Imię i nazwisko opiekuna prawnego: ${N}`],
    ['Imię i nazwisko opiekuna prawnego: Ziółkowska Brygida', `Imię i nazwisko opiekuna prawnego: ${N}`],
    ['Imię i nazwisko ucznia\nJan Kowalski', `Imię i nazwisko ucznia\n${N}`],
    ['Imię i nazwisko ucznia\nAnna Zając', `Imię i nazwisko ucznia\n${N}`],
    ['Imię i nazwisko pełnomocnika: Kancelaria Piotr Zając', `Imię i nazwisko pełnomocnika: Kancelaria ${N}`],
  ]);
});
test('Resztki b5 · „z domu" przed nazwą placówki i przyimkiem, „z d." nie blokuje inicjału innej osoby', () => {
  masked([
    ['Jan Nowak z domu Ronalda McDonalda', `${N} z domu Ronalda McDonalda`],
    ['Jan Nowak z domu Wczasów Dziecięcych', `${N} z domu Wczasów Dziecięcych`],
    ['Spotkanie prowadziła Halina Grzyb z domu Pod Lipami w Wiśle.', `Spotkanie prowadziła ${N} z domu Pod Lipami w Wiśle.`],
    ['Jan Kowalski z domu Caritas w Radomiu.', `${N} z domu Caritas w Radomiu.`],
    ['Anna Nowak z domu Kowalska', `${N} z domu ${N}`],
    ['Anna Nowak z d. Kos. Rozmowa Jana Kowalskiego z D. Nowakiem.', `${N} z d. ${N}. Rozmowa ${N} z ${N}.`],
    ['EWELINA KRAWCZYK Z D. MAJEWSKA', `${N} Z D. ${N}`],
  ]);
});
test('Resztki b5 · miejscowość WERSALIKAMI po kodzie: ogon tylko z członów nazwy, bez przejścia przez tabulator', () => {
  masked([
    ['UL. DĘBOWA 7, 26-900 GŁOWACZÓW KOWAL-ZAJĄC ANNA', `${A}, ${KOD} ${C} KOWAL-ZAJĄC ANNA`],
    ['UL. POLNA 5, 26-910 MAGNUSZEW ZAMELDOWANY OD 2010 R.', `${A}, ${KOD} ${C} ZAMELDOWANY OD 2010 R.`],
    ['JAN KOWALSKI\tUL. POLNA 3\t08-110 GROCHÓWKA\tOBRĘB 0007\tDZ. 45/6', `${N}\t${A}\t${KOD} ${C}\tOBRĘB 0007\tDZ. 45/6`],
    ['UL. POLNA 3, 05-300 STARA WIEŚ', `${A}, ${KOD} ${C}`],
    ['UL. POLNA 3, 26-900 GŁOWACZÓW KOWALSKI JAN', `${A}, ${KOD} ${C} ${N}`],
  ]);
});
test('Resztki b5 · tablica: kod silnika z pojemnością, rejestracja pisma, powiat z rokiem w wyliczeniu i rejestr umów pod „nrRej"', () => {
  keep([
    'Samochód osobowy marki Volkswagen Golf TDI 1896 cm3, rok produkcji 2003.',
    'samochód marki Renault Clio DCI 1461',
    'Wniosek zarejestrowano pod numerem rejestracji RPW 12345/2026.',
    '{"nr_rej": "UM 1234", "nrRej": "ZP 2026"}',
  ]);
  masked([
    ['samochód marki Peugeot Boxer HDI 2198, nr rej. WLI 23C4', `samochód marki Peugeot Boxer HDI 2198, nr rej. ${RJ}`],
    ['samochód marki Opel Astra WPI 12345', `samochód marki Opel Astra ${RJ}`],
    ['pojazd o numerze rejestracyjnym WPI 12345', `pojazd o numerze rejestracyjnym ${RJ}`],
    ['nr rej. WPI 12345, WPI 2019', `nr rej. ${RJ}, ${RJ}`],
    ['nr rej. WPI 12345, OC 2024', `nr rej. ${RJ}, OC 2024`],
    ['{"nr_rej": "WPI 12345"}', `{"nr_rej": "${RJ}"}`],
    ['{"nrRejestracyjny": "WPI 12345"}', `{"nrRejestracyjny": "${RJ}"}`],
  ]);
});
test('Resztki b5 · telefon: numer inwentarzowy po „nr inw.", kwota w komórce arkusza i w zestawieniu kosztów', () => {
  keep([
    'Telefon nr inw. 012345678 – zużyty',
    'Fax nr fabr. 12 345 67 89',
    'W komórce 123 456 789 zł',
    'Usługi telefoniczne: 123 456 789 zł',
  ]);
  masked([
    ['Telefon nr 600 700 800', `Telefon nr ${T}`],
    ['Telefon nr inw. 600 700 800', `Telefon nr inw. ${T}`],
    ['Proszę dzwonić na komórkę 600 700 800.', `Proszę dzwonić na komórkę ${T}.`],
    ['Usługi telefoniczne: 600 700 800', `Usługi telefoniczne: ${T}`],
  ]);
});
test('Resztki b5 · próg „i później" w przepisie, celownik „ubezpieczonym" i patron po sklejonym „im."', () => {
  keep([
    'Emerytura przysługuje ubezpieczonym urodzonym 1 stycznia 1949 r.',
    'Matce urodzonej 1 stycznia 2004 r. i później przysługuje dodatek.',
    'kobiecie urodzonej 1 stycznia 1953 r. i później.',
    'Szkoła Podstawowa im.Henryka Sienkiewicza w Siedlcach.',
  ]);
  masked([
    ['Anna Nowak urodzona 12.03.1953 r. i później zamieszkała w Radomiu.', `${N} urodzona ${DU} r. i później zamieszkała w ${C}.`],
    ['Anna Nowak, urodzonej 1 stycznia 1953 r. w Radomiu', `${N}, urodzonej ${DU} r. w ${C}`],
  ]);
});
test('Resztki b5 · wiersz tabeli z brakami „NA" po etykiecie telefonu liczy się liniowo', () => {
  for (const kw of ['Telefon', 'Kontakt', 'tel.', 'Fax']) {
    const text = kw + '      NA'.repeat(16);
    const t0 = performance.now();
    expect(redactPII(text).redacted).toBe(text);
    expect(performance.now() - t0).toBeLessThan(500);
  }
});
test('Resztki b4 · adres: niezgodny liczebnik, osoba przed adresem, „miejsc.", łącznik po numerze i metraż lokalu', () => {
  keep([
    'Na ul. Polnej 5 osób zostało rannych.',
    'Remont ul. Polnej 3 lata trwał.',
    'Parking ul. Polna 5 miejsc postojowych',
    'Przebudowa ul. Polnej i Leśnej 250 000,00 zł.',
    'Remont chodnika przy ul. Szkolnej i Kościelnej 15 000 zł.',
    'Odcinek ul. Jana z Kolna 1 500 000 zł',
    'Modernizacja w Alejach Lipowych 3 500,00 zł',
    'Rejon I: ul. Polna i Leśna 12.01.2026, 09.02.2026',
    'Rejon III: Aleje Lipowe 14.01.2026',
    'ul. Żwirki i Wigury 12.05.2026 r. zamknięcie',
    'Droga gminna ul. Polna i Leśna 1,25 km.',
    '1\t123456P\tul. Polna i Leśna\t1,25\tgminna',
    'Aleje Lipowe 0,8 km',
    'Remont ul. Polnej i Leśnej 15%',
    'Mieszkał w Alejach Ujazdowskich 3 miesiące.',
  ]);
  masked([
    ['Przy ul. Polnej 15 mieszkańcy skarżą się na hałas.', `Przy ${A} mieszkańcy skarżą się na hałas.`],
    ['W mieszkaniu przy ul. Leśnej 8 pokoje są zawilgocone.', `W mieszkaniu przy ${A} pokoje są zawilgocone.`],
    ['Przy ul. Polnej 5 osoby bezdomne nocują na klatce.', `Przy ${A} osoby bezdomne nocują na klatce.`],
    ['Przy ul. Polnej 5 pracownicy MOPS stwierdzili zaniedbania.', `Przy ${A} pracownicy MOPS stwierdzili zaniedbania.`],
    ['Wnioskodawczyni mieszka przy ul. Lipowej 12 dzieci uczęszczają do szkoły nr 5.', `Wnioskodawczyni mieszka przy ${A} dzieci uczęszczają do szkoły nr 5.`],
    ['Lokale przy ul. Polnej 5 i Leśnej 7 są własnością Jana Kowalskiego.', `Lokale przy ${A} i ${A} są własnością ${N}.`],
    ['Mieszkam przy ul. Polnej i Leśnej 12.', `Mieszkam przy ${A}.`],
    ['Mieszkam przy ul. 3 Maja 5.', `Mieszkam przy ${A}.`],
    ['Jan Kowalski, ul. Polna 5 miejsc. Warszawa', `${N}, ${A} miejsc. Warszawa`],
    ['Najem lokalu przy ul. Rynek 5 lokal 38,5 m2.', `Najem lokalu przy ${A} lokal 38,5 m2.`],
    ['ul. Rynek 7, lokal 32,4 m2, parter', `${A}, lokal 32,4 m2, parter`],
    ['ul. Rynek 7, lok. 32,4 m2', `${A}, lok. 32,4 m2`],
    ['ul. Rynek 7, lokal 3', `${A}`],
    ['ul. Długa 5 m. 3, 80-827 Gdańsk', `${A}, ${KOD} ${C}`],
    ['Jan Kowalski, ul. Leśna 3 osoby.', `${N}, ${A} osoby.`],
    ['Anna Nowak ul. Polna 5 osób', `${N} ${A} osób`],
    ['Dłużnik Jan Kowalski, ul. Leśna 12 miesięcy zalega z czynszem', `Dłużnik ${N}, ${A} miesięcy zalega z czynszem`],
  ]);
});
test('Resztki b4 · adres ze słabym prefiksem: kwota, data, ułamek i procent za nazwą ulic to nie numer domu', () => {
  keep([
    'Przebudowa ul. Polnej i Leśnej 250 000,00 zł.',
    'Remont chodnika przy ul. Szkolnej i Kościelnej 15 000 zł.',
    'Odcinek ul. Jana z Kolna 1 500 000 zł',
    'Modernizacja w Alejach Lipowych 3 500,00 zł',
    'Rejon I: ul. Polna i Leśna 12.01.2026, 09.02.2026',
    'Rejon III: Aleje Lipowe 14.01.2026',
    'ul. Żwirki i Wigury 12.05.2026 r. zamknięcie',
    'Droga gminna ul. Polna i Leśna 1,25 km.',
    '1\t123456P\tul. Polna i Leśna\t1,25\tgminna',
    'Aleje Lipowe 0,8 km',
    'Remont ul. Polnej i Leśnej 15%',
  ]);
});
test('Resztki b4 · formularz spłaszczony do wiersza: każde pole adresowe osobno, etykiety następnych pól zostają', () => {
  keep([
    '17. Ulica:  18. Nr domu:  19.',
  ]);
  masked([
    ['Numer budynku: 7 PESEL: 85031412347', `Numer budynku: ${A} PESEL: [PESEL]`],
    ['Numer budynku: 12 Data: 2026-10-15', `Numer budynku: ${A} Data: 2026-10-15`],
    ['Numer budynku: 7 Telefon: 601222333', `Numer budynku: ${A} Telefon: ${T}`],
    ['Numer budynku: 7', `Numer budynku: ${A}`],
    ['04. Ulica: Warszawska  05. Nr domu: 31  06. Nr lokalu: 4', `04. Ulica: ${A}  05. Nr domu: ${A}  06. Nr lokalu: ${A}`],
  ]);
});
test('Resztki b4 · nazwisko dwuczłonowe z obcym drugim członem w całości pod maską', () => {
  keep([
    'Województwo Kujawsko-Pomorskie ogłosiło konkurs.',
    'Choroba Leśniowskiego-Crohna w wywiadzie.',
  ]);
  masked([
    ['Świadek Kowalczyk-Müller zeznała.', `Świadek ${N} zeznała.`],
    ['Pozwany Kowalczyk-Müller nie stawił się.', `Pozwany ${N} nie stawił się.`],
    ['Wezwano Zielińską-Šimek na rozprawę.', `Wezwano ${N} na rozprawę.`],
  ]);
});
test('Resztki b4 · imię z końca wiersza po przecinku za całą osobą należy do nazwiska z następnego wiersza', () => {
  masked([
    ['Świadkowie: Anna Nowak, Jan\nKowalski', `Świadkowie: ${N}, ${N}`],
    ['Członkowie rodziny: Maria Kowalska, Zofia\nKowalska, Piotr Kowalski.', `Członkowie rodziny: ${N}, ${N}, ${N}.`],
    ['W imieniu pozwanego: Anna Nowak; Piotr\nWiśniewski', `W imieniu pozwanego: ${N}; ${N}`],
    ['Świadkowie: Nowak Anna, Jan\nKowalski', `Świadkowie: ${N}, ${N}`],
    ['Kowalski;Jan\nNowak', `${N};Jan\n${N}`],
    ['Dzieci: Zofia Nowak Antoni\nPawlak', `Dzieci: ${N} Antoni\n${N}`],
  ]);
});
test('Resztki b4 · pseudonim po „Pan/Pani" z nazwiska, nie z imienia, członu środkowego ani marki', () => {
  masked([
    ['Pan Lis Citroëna nie oddał', `Pan ${N} Citroëna nie oddał`],
    ['Pan Nguyen Van W Warszawie był', `Pan ${N} W Warszawie był`],
  ]);
  masked(
    [
      ['Pani Schröder Anna i Pani Müller Anna złożyły wnioski.', 'Pani [OSOBA-A] i Pani [OSOBA-B] złożyły wnioski.'],
      ['Pani Schröder Anna zeznała. Pani Schröder podpisała.', 'Pani [OSOBA-A] zeznała. Pani [OSOBA-A] podpisała.'],
      ['Pani Kowalska Anna i Pani Nowak Anna złożyły wnioski.', 'Pani [OSOBA-A] i Pani [OSOBA-B] złożyły wnioski.'],
      ['Pan Jan Kowalski zeznał. Pan Kowalski podpisał.', 'Pan [OSOBA-A] zeznał. Pan [OSOBA-A] podpisał.'],
      ['Pan Nguyễn Văn Hùng i Pan Trần Văn Nam podpisali umowę.', 'Pan [OSOBA-A] i Pan [OSOBA-B] podpisali umowę.'],
      ['Pan Nguyễn Văn Hùng zeznał. Pan Nguyễn odmówił podpisu.', 'Pan [OSOBA-A] zeznał. Pan [OSOBA-A] odmówił podpisu.'],
      ['Pan Nagy László zeznał. Pan Nagy podpisał protokół.', 'Pan [OSOBA-A] zeznał. Pan [OSOBA-A] podpisał protokół.'],
      ['Pani Kovács Éva i Pani Szabó Éva złożyły wnioski.', 'Pani [OSOBA-A] i Pani [OSOBA-B] złożyły wnioski.'],
      ['Pan Nowak Škoda\nPan Lis Škoda', 'Pan [OSOBA-A] Škoda\nPan [OSOBA-B] Škoda'],
      ['Czy Pan Nowak Škodę sprzedał? Pan Nowak odmówił odpowiedzi.', 'Czy Pan [OSOBA-A] Škodę sprzedał? Pan [OSOBA-A] odmówił odpowiedzi.'],
      ['Pani Mróz Müllerowi przekazała dokumenty. Pani Mróz podpisała.', 'Pani [OSOBA-A] Müllerowi przekazała dokumenty. Pani [OSOBA-A] podpisała.'],
    ],
    { pseudonyms: true },
  );
});
test('Resztki b3 · zamieszkanie: zdanie ogólne z przydawką albo okolicznikiem przed markerem, mała liczba osób to skład gospodarstwa', () => {
  keep([
    'Obywatele Ukrainy mieszkający w Lublinie mogą złożyć wniosek.',
    'Pracownicy sezonowi mieszkający w Poznaniu otrzymają dodatek.',
    'Seniorzy samotnie mieszkający w Łodzi otrzymają pomoc.',
    'Polacy coraz częściej mieszkają w Warszawie.',
    'Osoba niepełnosprawna mieszkająca w Krakowie może złożyć wniosek.',
    'Rodzina wielodzietna mieszkająca w Lublinie otrzyma bon.',
    'Ludzie mieszkają w Warszawie coraz dłużej.',
    'Ludzie mieszkający w Warszawie płacą więcej.',
    'Młodzi ludzie coraz częściej mieszkają w Warszawie.',
    'Ludzie mieszkający w Kutnie narzekają na smog.',
    'Zamieszkuje w Krakowie ok. 800 tys. osób.',
  ]);
  masked([
    ['Pozwani mieszkają w Lublinie.', `Pozwani mieszkają w ${C}.`],
    ['Wnioskodawcy mieszkają w Lublinie.', `Wnioskodawcy mieszkają w ${C}.`],
    ['Jego rodzice mieszkają w Lublinie.', `Jego rodzice mieszkają w ${C}.`],
    ['Dzieci wnioskodawczyni mieszkają w Lublinie.', `Dzieci wnioskodawczyni mieszkają w ${C}.`],
    ['Wnioskodawczyni zamieszkała w Gdańsku 3 osoby na utrzymaniu.', `Wnioskodawczyni zamieszkała w ${C} 3 osoby na utrzymaniu.`],
    ['zam. Gdańsk 3 osoby', `zam. ${C} 3 osoby`],
    ['Miejsce zamieszkania: Gdańsk 4 osoby', `Miejsce zamieszkania: ${C} 4 osoby`],
    ['zam. w Lublinie 2 osoby w domu', `zam. w ${C} 2 osoby w domu`],
    ['Mieszka w Sopocie 3 dzieci', `Mieszka w ${C} 3 dzieci`],
    ['Z wnioskodawczynią mieszka w Lublinie 3 dzieci.', `Z wnioskodawczynią mieszka w ${C} 3 dzieci.`],
  ]);
});
test('Resztki b3 · głowa nazwy i przymiotnik-nazwisko: czasownik osobowy, osoba znana z pisma, grafik dyżurów i kolumny wyrównane spacjami', () => {
  keep([
    'Noc Świętojańska odbędzie się w sobotę.',
    'Pokój Westfalski podpisano w 1648 r.',
    'Las Kabacki zamknięto dla ruchu.',
    'Puszcza Białowieska jest piękna.',
  ]);
  masked([
    ['Noc Brzozowska spędziła w celi.', `Noc ${N} spędziła w celi.`],
    ['Noc Brzozowska spędziła na oddziale.', `Noc ${N} spędziła na oddziale.`],
    ['Rano  Sosnowska  Oddział Wewnętrzny', `Rano  ${N}  Oddział Wewnętrzny`],
    ['Tak  Gzowski  Urząd Miasta', `Tak  ${N}  Urząd Miasta`],
    ['Dzień   Lisiecki   Oddział Pediatrii', `Dzień   ${N}   Oddział Pediatrii`],
    ['Noc      Brzozowska', `Noc      ${N}`],
    ['12.06  Noc  Wąsowska  OIOM', `12.06  Noc  ${N}  OIOM`],
    ['Pacjentka Anna Lisiecka przyjęta. Noc Lisiecka przespała spokojnie.', `Pacjentka ${N} przyjęta. Noc ${N} przespała spokojnie.`],
    ['Grafik: Dzień Lisiecka, Noc Brzozowska', `Grafik: Dzień ${N}, Noc ${N}`],
    ['12.05.2024 Noc Gzowska SOR', `12.05.2024 Noc ${N} SOR`],
    ['Noc Gzowska spędziła w szpitalu.', `Noc ${N} spędziła w szpitalu.`],
    ['Pokój Lisiecki opuścił o 10:00.', `Pokój ${N} opuścił o 10:00.`],
    ['Zamek Brzozowski wymienił sam.', `Zamek ${N} wymienił sam.`],
    ['Las Gzowski sprzedał w 2019 r.', `Las ${N} sprzedał w 2019 r.`],
    ['Kościół Mariacki odwiedził Zygmunt Kowalski.', `Kościół Mariacki odwiedził ${N}.`],
  ]);
  masked(
    [
      ['Pacjentka Anna Lisiecka przyjęta. Noc Lisiecka przespała spokojnie.', 'Pacjentka [OSOBA-A] przyjęta. Noc [OSOBA-A] przespała spokojnie.'],
    ],
    { pseudonyms: true },
  );
});
test('Resztki b3 · nazwisko właściciela przed formą firmy, nazwisko dwuczłonowe po roli z urzędem, nazwa szpitala po „Pana"', () => {
  keep([
    'Do Pana Dyrektora Szpitala Bielańskiego',
    'Odwiedziliśmy Biebrzański Park Narodowy.',
  ]);
  masked([
    ['Również Brzozowski Spółka Jawna złożyła ofertę.', `Również ${N} Spółka Jawna złożyła ofertę.`],
    ['Potem Lisiecki Kancelaria Adwokacka odpisała.', `Potem ${N} Kancelaria Adwokacka odpisała.`],
    ['Dziś Gzowski Zakład Usługowy otworzył punkt.', `Dziś ${N} Zakład Usługowy otworzył punkt.`],
    ['Szanowna Pani Dyrektor Szkoły Kowalska-Nowak', `Szanowna Pani Dyrektor Szkoły ${N}`],
    ['Pan Komendant Policji Kowalski-Nowak', `Pan Komendant Policji ${N}`],
    ['Do Pani Dyrektor Przedszkola Lewandowska-Wójcik', `Do Pani Dyrektor Przedszkola ${N}`],
  ]);
});
test('Resztki b3 · zdrobnienie-nazwisko w notatce kadrowej i pielęgniarskiej, rzeczownik przy przedmiocie', () => {
  keep([
    'Kluczyk do skrzynki leży na biurku.',
    'Mieczyk ogrodowy kwitnie w lipcu.',
    'Kluczyk w zamku się zaciął.',
  ]);
  masked([
    ['Mieczyk zatrudniony od 01.02.2010 r. na stanowisku magazyniera.', `${N} zatrudniony od 01.02.2010 r. na stanowisku magazyniera.`],
    ['Kluczyk z działu kadr potwierdził nieobecność.', `${N} z działu kadr potwierdził nieobecność.`],
    ['Mieczyk przytomny, w kontakcie logicznym.', `${N} przytomny, w kontakcie logicznym.`],
    ['Kluczyk na zwolnieniu lekarskim do piątku.', `${N} na zwolnieniu lekarskim do piątku.`],
    ['Krzaczyk od 2015 r. pracuje w firmie.', `${N} od 2015 r. pracuje w firmie.`],
  ]);
});
test('Resztki b3 · wartość pod „name"/„osoba": imię i nazwisko małymi literami, rola będąca nazwiskiem', () => {
  keep([
    '{"name": "kalina koralowa"}',
    '{"name": "róża pustyni"}',
    '{"osoba": "Sędzia"}',
  ]);
  masked([
    ['{"name": "ewa pietka"}', `{"name": "${N}"}`],
    ['<osoba>jan wolny</osoba>', `<osoba>${N}</osoba>`],
    ['<name>joanna kępka</name>', `<name>${N}</name>`],
    ['{"name": "marek siwko"}', `{"name": "${N}"}`],
    ['{"osoba": "ewa pietka"}', `{"osoba": "${N}"}`],
    ['{"osoba": "ewa dudka"}', `{"osoba": "${N}"}`],
    ['<osoba>jan sitko</osoba>', `<osoba>${N}</osoba>`],
    ['{"name": "jan sitko"}', `{"name": "${N}"}`],
    ['{"name": "anna rybka"}', `{"name": "${N}"}`],
    ['{"osoba": "Marszałek"}', `{"osoba": "${N}"}`],
    ['<osoba>Marszałek</osoba>', `<osoba>${N}</osoba>`],
    ['{"osoba": "Dziadek"}', `{"osoba": "${N}"}`],
    ['{"osoba": "Wójt"}', `{"osoba": "${N}"}`],
  ]);
});
test('Resztki b3 · strona postępowania i komórka CSV wygrywają ze stoplistą przymiotników i nazw mieszkańców', () => {
  keep([
    'Poleski Park Narodowy jest otwarty.',
    'Senacki projekt ustawy trafił do Sejmu.',
    'Strażacki sprzęt kupiono w maju.',
    'Kazimierz Dolny leży nad Wisłą.',
  ]);
  masked([
    ['Świadek Poleski zeznał, że nic nie widział.', `Świadek ${N} zeznał, że nic nie widział.`],
    ['Pozwany Poleski nie stawił się.', `Pozwany ${N} nie stawił się.`],
    ['1;Poleski Marek;ul. Leśna 7;Włodawa', `1;${N};${A};Włodawa`],
    ['Wnioskodawca: Kazimierz Dolny, ul. Polna 3', `Wnioskodawca: ${N}, ${A}`],
    ['Postępowanie wobec dłużnika Bartnicza.', `Postępowanie wobec dłużnika ${N}.`],
    ['1\tAnna\tWarszawa\tul. Długa 5', `1\tAnna\t${C}\t${A}`],
    ['2;Poleski;Adam;Kraków', `2;${N};Adam;Kraków`],
    ['4;Duńczyk;Piotr;Kraków', `4;${N};Piotr;Kraków`],
    ['Świadek Strażacki zeznał', `Świadek ${N} zeznał`],
  ]);
});
test('Resztki b3 · „św." jako świadek: samo nazwisko, czynność procesowa, osoba za patronem; patron w całości', () => {
  keep([
    'Parafia pw. św. Rafała Kalinowskiego w Krakowie',
    'W kaplicy św. Rocha odprawiono mszę.',
    'Kościół św. Jana Chrzciciela',
    'Przy figurze Pana Jezusa Frasobliwego stał krzyż.',
    'Kościół św. Antoniego Padewskiego w Poznaniu.',
  ]);
  masked([
    ['W kaplicy przesłuchano św. Jana Kowalskiego.', `W kaplicy przesłuchano św. ${N}.`],
    ['Zdarzenie w kaplicy szpitalnej. Przesłuchano św. Jana Kowalskiego.', `Zdarzenie w kaplicy szpitalnej. Przesłuchano św. ${N}.`],
    ['W kaplicy św. Rocha Bednarz poświęcił bramę.', `W kaplicy św. Rocha ${N} poświęcił bramę.`],
    ['Do kościoła wraz ze św. Kowalskim wszedł sprawca.', `Do kościoła wraz ze św. ${N} wszedł sprawca.`],
    ['W kościele zeznania św. Nowaka.', `W kościele zeznania św. ${N}.`],
    ['Kradzież w kaplicy potwierdził podpis św. Kowalskiego.', `Kradzież w kaplicy potwierdził podpis św. ${N}.`],
    ['Parafia wezwała św. Wiśniewskiego.', `Parafia wezwała św. ${N}.`],
    ['Przy kościele Pana Jezusa Gzik rozdawał opłatki.', `Przy kościele Pana Jezusa ${N} rozdawał opłatki.`],
    ['W kaplicy św. Rocha Teresa Wróbel prowadzi Koło Różańcowe.', `W kaplicy św. Rocha ${N} prowadzi Koło Różańcowe.`],
  ]);
});
test('Resztki b3 · eponim tylko z właściwą głową, nazwisko osoby z pisma wygrywa z patronem mostu', () => {
  keep([
    'Objaw Babińskiego dodatni.',
    'Prątki Kocha wykryto w plwocinie.',
    'Most Gzowskiego otwarto.',
    'Korek na moście Łazienkowskim od rana.',
  ]);
  masked([
    ['Zgłoszenie od kierownika linii Pawlika.', `Zgłoszenie od kierownika linii ${N}.`],
    ['Zgłoszenie od kierownika linii Leśniowskiego.', `Zgłoszenie od kierownika linii ${N}.`],
    ['Wniosek operatora linii Babińskiego.', `Wniosek operatora linii ${N}.`],
    ['Pismo mistrza linii Kocha.', `Pismo mistrza linii ${N}.`],
    ['Pacjent Jan Pawlik przyjęty na oddział. Objawy Pawlika ustąpiły po leczeniu.', `Pacjent ${N} przyjęty na oddział. Objawy ${N} ustąpiły po leczeniu.`],
    ['Jan Gzowski uciekał przed policją. Na moście Gzowskiego zatrzymał patrol.', `${N} uciekał przed policją. Na moście ${N} zatrzymał patrol.`],
    ['Pacjent Babiński odwołał wizytę. Odruch Babińskiego dodatni.', `Pacjent ${N} odwołał wizytę. Odruch Babińskiego dodatni.`],
  ]);
});
test('Resztki b3 · patron po gołym „im" przy obiekcie i skrócie placówki, etykieta faktury za miejscowością', () => {
  keep([
    'Kierownik Oddziału im Józefa Babińskiego potwierdził przyjęcie.',
    'ZSO im Jana Kochanowskiego',
    'III LO im Adama Mickiewicza',
    'MOPS im Haliny Nowak',
    'Park im Marii Konopnickiej',
    'Rondo im Romana Dmowskiego',
    'Kopalnia Soli im Jana Pawła II',
  ]);
  masked([
    ['48-210 Biała   Razem do zapłaty: 120,00 zł', `${KOD} ${C}   Razem do zapłaty: 120,00 zł`],
    ['86-170 Nowe   Sposób płatności: przelew', `${KOD} ${C}   Sposób płatności: przelew`],
    ['86-170 Nowe Termin płatności: 14 dni', `${KOD} ${C} Termin płatności: 14 dni`],
    ['89-320 Wysoka Wartość netto: 340,00', `${KOD} ${C} Wartość netto: 340,00`],
    ['Pomógł im Jan Kowalski.', `Pomógł im ${N}.`],
  ]);
});
test('Resztki, poprawki po weryfikacji · osoba po roli i instytucji, data urodzenia po przyimku, tablica „numerem rejestracji"', () => {
  masked([
    ['Prezes Zarządu Spółki Anna Wrona', `Prezes Zarządu Spółki ${N}`],
    ['Dyrektor Oddziału Banku Marek Sikora', `Dyrektor Oddziału Banku ${N}`],
    ['Pełnomocnik Zarządu Spółki Marek Sroka podpisał umowę.', `Pełnomocnik Zarządu Spółki ${N} podpisał umowę.`],
    ['Za Zarząd: Prezes Zarządu Spółki Anna Wrona, Członek Zarządu Jan Kos', `Za Zarząd: Prezes Zarządu Spółki ${N}, Członek Zarządu ${N}`],
    ['Sąd ustanowił opiekuna nad ubezwłasnowolnionym urodzonym 12.03.1950 r. w Kielcach.', `Sąd ustanowił opiekuna nad ubezwłasnowolnionym urodzonym ${DU} r. w ${M}.`],
    ['Orzeczenie wydano o ubezpieczonym urodzonym 3.03.1960 r.', `Orzeczenie wydano o ubezpieczonym urodzonym ${DU} r.`],
    ['Sprawa toczy się przed skazanym urodzonym 3.03.1980 r.', `Sprawa toczy się przed skazanym urodzonym ${DU} r.`],
    ['o numerze rejestracji WX 12345', `o numerze rejestracji ${RJ}`],
    ['W numerach rejestracji WX 12345 i WY 54321 błąd.', `W numerach rejestracji ${RJ} i ${RJ} błąd.`],
    ['Auto (numerem rejestracji GD 1234A) zaparkowano', `Auto (numerem rejestracji ${RJ}) zaparkowano`],
    ['{"nrRejestracyjny": "RPO 2024"}', `{"nrRejestracyjny": "${RJ}"}`],
    ['{"nr_rej": "PIT 2024"}', `{"nr_rej": "${RJ}"}`],
  ]);
  keep([
    'Pełnomocnik Zarządu Spółki Marek Trans Sp. z o.o.',
    'Prezes Zarządu Spółki Adam Bud',
    'Emerytura przysługuje ubezpieczonym urodzonym 1 stycznia 1949 r.',
    'Pismo pod numerem rejestracji RPW 12345/2026 wpłynęło.',
    '{"tablica": "ZP 2026"}',
    'Na tablicy pod RPO 2021 widniał wpis.',
  ]);
});
test('Resztki, poprawki po weryfikacji · nazwisko na „-owa" pod etykietą, nazwisko panieńskie przed polem, formularz w wierszu', () => {
  masked([
    ['Imię i nazwisko pacjenta: Oksana Petrowa', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko świadka: Dilnoza Karimowa', `Imię i nazwisko świadka: ${N}`],
    ['Joanna Kos z domu Wrona Zam. Sosnowiec', `${N} z domu ${N} Zam. ${M}`],
    ['Anna Kowalska z domu Sikora Imię ojca: Jan', `${N} z domu ${N} Imię ojca: Jan`],
    ['Stawiła się Anna Kowalska z domu Gzik Legitymująca się dowodem', `Stawiła się ${N} z domu ${N} Legitymująca się dowodem`],
    ['Ulica: Krótka 7. Piętro: 2', `Ulica: ${A} Piętro: 2`],
    ['Ulica: Długa 5 Kraków Tel: 600123456', `Ulica: ${A} Tel: ${T}`],
    ['Ulica: Krótka Nr domu: 7 Miejscowość: Mysiadło', `Ulica: ${A} Nr domu: ${A} Miejscowość: ${M}`],
    ['04. Ulica: Warszawska  05. Nr domu: 31  06. Nr lokalu: 4', `04. Ulica: ${A}  05. Nr domu: ${A}  06. Nr lokalu: ${A}`],
  ]);
  keep([
    'Imię i nazwisko wnioskodawcy: Grupa Inicjatywna',
    'Imię i nazwisko opiekuna prawnego: Powiatowe Centrum Pomocy Rodzinie',
  ]);
  expect(redactPII('Jan Kowalski z domu Dziecka Nr 3 wyszedł').redacted).toBe(`${N} z domu Dziecka Nr 3 wyszedł`);
  expect(redactPII('Anna Kowalska z domu Ronalda McDonalda.').redacted).toBe(`${N} z domu Ronalda McDonalda.`);
});
test('Resztki, poprawki po weryfikacji · drugi adres w wyliczeniu, miasto przy adresie, telefon przed kwotą, wiersze CSV', () => {
  masked([
    ['Lokale przy ul. Polnej 5 i Leśnej 7.', `Lokale przy ${A} i ${A}.`],
    ['Zam. ul. Długa 5 i Krótka 7', `Zam. ${A} i ${A}`],
    ['Dłużnik Jan Kowalski, zam. ul. Polnej 5 i Leśnej 7, nie stawił się.', `Dłużnik ${N}, zam. ${A} i ${A}, nie stawił się.`],
    ['Ludzie mieszkający w Krakowie przy ul. Długiej 5 skarżą się.', `Ludzie mieszkający w ${M} przy ${A} skarżą się.`],
    ['komórka: 603 456 789 zł 30,00', `komórka: ${T} zł 30,00`],
    ['Kowalski;Jan\nNowak;Anna\nObecni: Ewa Lis, Jan\nWójcik', `${N};Jan\n${N};Anna\nObecni: ${N}, ${N}`],
  ]);
  masked([['Kowalski;Jan\nNowak;Anna\nObecni: Ewa Lis, Jan\nWójcik', '[OSOBA-A];Jan\n[OSOBA-B];Anna\nObecni: [OSOBA-C], [OSOBA-D]']], { pseudonyms: true });
  keep([
    'Przy ul. Polnej i Leśnej 7 dzieci bawi się na podwórku.',
    'Ludzie mieszkający w Krakowie skarżą się na smog.',
    'W komórce 123 456 789 zł',
  ]);
  for (const [t, kept] of [
    ['Przy ul. Polnej 5 i Leśnej 7 dzieci bawi się na podwórku.', 'i Leśnej 7 dzieci'],
    ['Remont ul. Polnej 5 i Leśnej 15 000 zł.', 'i Leśnej 15 000 zł'],
    ['Spotkanie przy ul. Polnej 5 i Leśnej 18:00.', 'i Leśnej 18:00'],
  ] as const)
    expect(redactPII(t).redacted).toContain(kept);
});
test('Resztki, poprawki po weryfikacji · nazwa obiektu w szyku odwróconym, święto, tabela wyrównana spacjami, eponim', () => {
  keep([
    'Cmentarz Rakowicki odwiedził oskarżony w dniu 1 listopada.',
    'Kościół Mariacki odwiedził prezydent.',
    'Kościół Mariacki opuściła para młoda.',
    'Kościół Mariacki kupił nowe wyposażenie.',
    'Jarmark Dominikański odwiedził milion turystów.',
    '21.06 Noc Świętojańska',
    'Noc Świętojańska SOR',
    'Kościół   Mariacki',
    'Kościół       Mariacki     Kraków',
    'Wycieczka:  Kościół  Mariacki,  Sukiennice.',
    'Cystoskopia: trójkąt Pawlika bez zmian.',
  ]);
  masked([
    ['Noc Brzozowska spędziła w celi.', `Noc ${N} spędziła w celi.`],
    ['Zamek Brzozowski kupił wczoraj.', `Zamek ${N} kupił wczoraj.`],
    ['Kościół Mariacki odwiedził Zygmunt Kowalski.', `Kościół Mariacki odwiedził ${N}.`],
    ['Noc      Brzozowska', `Noc      ${N}`],
    ['12.05.2024 Noc Gzowska SOR', `12.05.2024 Noc ${N} SOR`],
  ]);
});
test('Resztki, poprawki po weryfikacji (runda 2) · obce imię i nazwisko z następnej linii, homograf instytucji jako nazwisko', () => {
  masked([
    ['Imię i nazwisko pacjenta:\nYuki Tanaka', `Imię i nazwisko pacjenta:\n${N}`],
    ['Imię i nazwisko wnioskodawcy\nAliaksandr Lukashuk', `Imię i nazwisko wnioskodawcy\n${N}`],
    ['Imię i nazwisko ucznia\nThanh Hoa Tran', `Imię i nazwisko ucznia\n${N}`],
    ['Imię i nazwisko dziecka\nAmir Rahimov', `Imię i nazwisko dziecka\n${N}`],
    ['Imię i nazwisko pacjenta: Min-jun Park', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko pacjenta: SEO-YEON PARK', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko wnioskodawcy: Anna Koło', `Imię i nazwisko wnioskodawcy: ${N}`],
    ['Imię i nazwisko ucznia: Jan Nowy', `Imię i nazwisko ucznia: ${N}`],
    ['Imię i nazwisko pełnomocnika: Adam Bank', `Imię i nazwisko pełnomocnika: ${N}`],
  ]);
  keep([
    'LP.\nIMIĘ I NAZWISKO UCZNIA\nPODPIS RODZICA',
    'Imię i nazwisko ucznia\nWychowawca Klasy',
    'Imię i nazwisko ucznia\nRok Urodzenia',
    'Imię i nazwisko pacjenta\nLekarz Prowadzący\nRozpoznanie',
    'Imię i nazwisko dziecka\nGrupa Przedszkolna',
    'Imię i nazwisko ucznia\nGRUPA WIEKOWA',
    'Imię i nazwisko pacjenta\nGodzina Przyjęcia',
    'Imię i nazwisko ucznia\nKlasa',
    'Imię i nazwisko wnioskodawcy: Bank Pekao',
    'Imię i nazwisko wnioskodawcy: Koło Gospodyń Wiejskich',
    'Imię i nazwisko wnioskodawcy: Park Wodny',
    'Imię i nazwisko wnioskodawcy: Anna Bank Spółdzielczy',
  ]);
});
test('Resztki, poprawki po weryfikacji (runda 2) · data urodzenia w narzędniku bez przyimka, nazwisko panieńskie przed imiesłowem', () => {
  masked([
    ['Opiekuje się bratem niepełnosprawnym urodzonym 12.03.1990 r.', 'Opiekuje się bratem niepełnosprawnym urodzonym [DATA-URODZENIA] r.'],
    ['Umowa z Janem Nowakiem, ubezpieczonym urodzonym 3.05.1980 r.', `Umowa z ${N}, ubezpieczonym urodzonym [DATA-URODZENIA] r.`],
    ['Kurator dla małoletniego, będącego ubezwłasnowolnionym urodzonym 5.06.2001 r.', 'Kurator dla małoletniego, będącego ubezwłasnowolnionym urodzonym [DATA-URODZENIA] r.'],
    ['zajmowała się poszkodowanym urodzonym 1.02.1950 r.', 'zajmowała się poszkodowanym urodzonym [DATA-URODZENIA] r.'],
    ['Maria Nowak z domu Wrona Wypisana 12.10.', `${N} z domu ${N} Wypisana 12.10.`],
    ['Pani Anna Nowak z domu Wrona Zatrudniona jest od 2010 r.', `Pani ${N} z domu ${N} Zatrudniona jest od 2010 r.`],
    ['Matka: Ewa Nowak z domu Zielona Zmarła 2015.', `Matka: ${N} z domu ${N} Zmarła 2015.`],
  ]);
  keep([
    'Emerytura przysługuje ubezpieczonym urodzonym 1 stycznia 1949 r.',
    'Prawo mają uprawnionym urodzonym 1.01.1950 r.',
    'Świadczenie przysługuje osobom urodzonym 1.01.1950 r.',
  ]);
  expect(redactPII('Anna Kowalska z domu Sue Ryder').redacted).toBe(`${N} z domu Sue Ryder`);
});
test('Resztki, poprawki po weryfikacji (runda 2) · drugi adres tylko w kształcie ulicy, nazwa obiektu przy czasowniku, statystyka, etykiety Title Case', () => {
  masked([
    ['Mieszka przy ul. Polnej 5 m. 2 i Sadowej 9.', `Mieszka przy ${A} i ${A}.`],
    ['ul. Polna 5 i Mickiewicza 7', `${A} i ${A}`],
    ['ul. Polna 5 oraz Armii Krajowej 12', `${A} oraz ${A}`],
    ['Ulica: Długa 5 Telefon Komórkowy: 501 222 333', `Ulica: ${A} Telefon Komórkowy: ${T}`],
    ['Ulica: Lipowa 3 Wymiar Etatu: 1/1', `Ulica: ${A} Wymiar Etatu: 1/1`],
    ['Ulica: Długa 5 Osoba Do Kontaktu: Anna Lis', `Ulica: ${A} Osoba Do Kontaktu: ${N}`],
    ['Ulica: Długa 5 Obywatelstwo Polskie: tak', `Ulica: ${A} Obywatelstwo Polskie: tak`],
    ['Pozwany Jan Kaliski. Dworzec Kaliski zamknięto.', `Pozwany ${N}. Dworzec Kaliski zamknięto.`],
    ['Pacjentka Anna Lisiecka przyjęta. Noc Lisiecka przespała spokojnie.', `Pacjentka ${N} przyjęta. Noc ${N} przespała spokojnie.`],
    ['Pokój Lisiecki opuścił o 10:00.', `Pokój ${N} opuścił o 10:00.`],
    ['Z wnioskodawczynią mieszka w Lublinie 3 dzieci.', `Z wnioskodawczynią mieszka w ${M} 3 dzieci.`],
  ]);
  for (const [t, kept] of [
    ['Lokalizacje: ul. Leśna 7 oraz Hala 3.', 'oraz Hala 3.'],
    ['serwer przy ul. Polnej 5 oraz Windows 10', 'oraz Windows 10'],
    ['Gabinet przy ul. Szpitalnej 5 m. 3 i Sali 12 jest czynny.', 'i Sali 12 jest'],
    ['ul. Kwiatowej 7 i Rozdział 3 umowy', 'i Rozdział 3 umowy'],
    ['Pociągi odjeżdżają z dworca przy ul. Dworcowej 3 i Peronu 2.', 'i Peronu 2.'],
    ['Biuro przy ul. Polnej 5 i Wisła 1 liga.', 'i Wisła 1 liga'],
    ['ul. Polnej 5 i Grudnia 2020', 'i Grudnia 2020'],
  ] as const)
    expect(redactPII(t).redacted).toContain(kept);
  keep([
    'Kościół Mariacki kupił w 2020 r. nowy dzwon.',
    'Cmentarz Powązkowski odwiedził wczoraj prezydent.',
    'Kościół Mariacki odwiedził w niedzielę.',
    'Ogród Saski odwiedził.',
    'Klasztor Benedyktyński opuścił w lipcu o. Szymon.',
    'Mieszka w Sopocie 500 cudzoziemców.',
    'W bloku zamieszkuje w Pruszkowie 120 rodzin.',
  ]);
  masked([['Świadek Jan Kabacki zeznał. Las Kabacki zamknięto.', 'Świadek [OSOBA-A] zeznał. Las Kabacki zamknięto.']], { pseudonyms: true });
});

// ── Etap b6: loginy w środowisku firmowym (ścieżki, udziały, AD, logi, profile w URL-ach) ──
const LG = '[LOGIN]';
test('b6 §8 p.1, K59: znany login maskowany w całym segmencie zapamiętanego URL-a i w treści', () => {
  masked([
    [
      'Login: tkaminski\nRepo: https://github.com/tkaminski oraz https://gitlab.firma.pl/tkaminski/projekt-x i https://wiki.firma.pl/display/~tkaminski',
      `Login: ${LG}\nRepo: https://github.com/${LG} oraz https://gitlab.firma.pl/${LG}/projekt-x i https://wiki.firma.pl/display/~${LG}`,
    ],
    ['Login: dmichalska\nProfil: https://bank.pl/user/dmichalska?x=1', `Login: ${LG}\nProfil: https://bank.pl/user/${LG}?x=1`],
    // parametr URL-a i klucz JSON/XML to kotwice — wartość wraca w treści
    ['https://portal.pl/login?user=a.kaminska\nKonto a.kaminska zablokowane', `https://portal.pl/login?user=${LG}\nKonto ${LG} zablokowane`],
    ['{"user":"a.kaminska","message":"Konto a.kaminska zablokowane"}', `{"user":"${LG}","message":"Konto ${LG} zablokowane"}`],
    ['<user>jkowalski2</user><message>Konto jkowalski2 zablokowane</message>', `<user>${LG}</user><message>Konto ${LG} zablokowane</message>`],
    ['{"username": "jwozniak", "homeDir": "/home/jwozniak"}', `{"username": "${LG}", "homeDir": "/home/${LG}"}`],
  ]);
  // pułapki: część segmentu, host, konta generyczne i wartości bez kształtu uchwytu zostają
  keep([
    'Dokumentacja: https://docs.firma.pl/api/v2/user/endpoints oraz https://firma.pl/dmichalskaneous/x',
    'Repozytorium https://github.com/microsoft/vscode oraz https://github.com/apache/kafka.',
  ]);
  masked([
    ['Login: dmichalska\nhttps://firma.pl/dmichalskaneous/x', `Login: ${LG}\nhttps://firma.pl/dmichalskaneous/x`],
    ['Login: admin\nPanel: https://serwer.firma.pl/admin/panel', `Login: ${LG}\nPanel: https://serwer.firma.pl/admin/panel`],
    ['{"user":"system","message":"system restart"}', `{"user":"${LG}","message":"system restart"}`],
    ['{"user":"v2.1","message":"wersja v2.1"}', `{"user":"${LG}","message":"wersja v2.1"}`],
    ['{"user":"Marek","comment":"Marek Nowak zgłosił awarię"}', `{"user":"${LG}","comment":"[IMIĘ I NAZWISKO] zgłosił awarię"}`],
    ['{"user":"projekty","note":"Katalog projekty jest pełny"}', `{"user":"${LG}","note":"Katalog projekty jest pełny"}`],
  ]);
});
test('b6 §8 p.2: profile LinkedIn, osobisty OneDrive i numeryczny profil Facebooka', () => {
  masked([
    ['LinkedIn: https://www.linkedin.com/in/joanna-pietrzak-hr/', `LinkedIn: https://www.linkedin.com/in/${LG}/`],
    ['https://www.linkedin.com/pub/joanna-pietrzak/12/345/678', `https://www.linkedin.com/pub/${LG}`],
    // bez schematu (stopka CV)
    ['Profil: pl.linkedin.com/in/joannapietrzak?trk=public_profile', `Profil: pl.linkedin.com/in/${LG}?trk=public_profile`],
    ['linkedin.com/in/beata-kruk-12345', `linkedin.com/in/${LG}`],
    [
      'OneDrive: https://firma-my.sharepoint.com/personal/krzysztof_jablonski_firma_pl/Documents/raport.docx',
      `OneDrive: https://firma-my.sharepoint.com/personal/${LG}/Documents/raport.docx`,
    ],
    ['mój fb: https://www.facebook.com/profile.php?id=100012345678901&ref=x', `mój fb: https://www.facebook.com/profile.php?id=${LG}&ref=x`],
  ]);
  keep([
    'Strona firmy https://www.linkedin.com/company/baltic-solutions-sp-z-o-o oraz https://www.linkedin.com/jobs/view/123',
    'Uczelnia: https://www.linkedin.com/school/uniwersytet-warszawski/',
    'Dokumenty: https://firma.sharepoint.com/sites/Logistyka/Shared%20Documents',
    'Witryna działu https://firma.sharepoint.com/sites/Logistyka/SitePages/Home.aspx',
    'Zespół https://github.com/orgs/firma/teams/backend i ustawienia https://github.com/settings/profile',
    'Ustawienia https://bank.pl/user/settings oraz https://app.pl/users/sign_in',
    'Strona: linkedin.com/company/firma',
  ]);
});
test('b6 §8 p.3: ścieżka profilu użytkownika (Windows, Linux, macOS) — segment jako [LOGIN]', () => {
  masked([
    [String.raw`Plik: C:\Users\tkaminski\Desktop\a.txt`, String.raw`Plik: C:\Users\[LOGIN]\Desktop\a.txt`],
    [String.raw`Ścieżka C:\Users\nowak\Documents\raport.docx`, String.raw`Ścieżka C:\Users\[LOGIN]\Documents\raport.docx`],
    [String.raw`{"sciezka": "C:\\Users\\mzajac\\Documents\\raport.docx"}`, String.raw`{"sciezka": "C:\\Users\\[LOGIN]\\Documents\\raport.docx"}`],
    ['Katalog: /home/jkowalski/projekty', `Katalog: /home/${LG}/projekty`],
    ['Ścieżka: /home/jkowalski/.ssh/id_rsa i /Users/anowak/Library', `Ścieżka: /home/${LG}/.ssh/id_rsa i /Users/${LG}/Library`],
    ['<home>/home/jwozniak</home>', `<home>/home/${LG}</home>`],
    // wartość ze ścieżki rozlewa się na treść, gdy ma kształt uchwytu
    ['Katalog /home/jkowalski/x. Właściciel: jkowalski.', `Katalog /home/${LG}/x. Właściciel: ${LG}.`],
  ]);
  keep([
    String.raw`Ścieżka: /home/ubuntu/app oraz /root/.bashrc oraz C:\Users\Public\Desktop oraz C:\Users\Administrator`,
    String.raw`Plik: C:\Users\All Users\x oraz C:\Users\Default User\y oraz C:\Users\WDAGUtilityAccount\z`,
    'Profil: /Users/Shared/Dokumenty, kopia w /home/backup/2024 oraz /home/www/strona',
    'Wejdź na firma.pl/home/aktualnosci albo /home/index.html',
    String.raw`Binarka w /usr/bin/ssh oraz C:\Program Files\Git\bin`,
    'Katalog /home/projekty/raport. Projekty zamknięto.',
  ]);
  // imię i nazwisko w nazwie katalogu maskuje FAZA 4 w całości
  masked([
    [String.raw`Plik: C:\Users\Tomasz Kamiński\Documents\raport.docx`, String.raw`Plik: C:\Users\[IMIĘ I NAZWISKO]\Documents\raport.docx`],
    [String.raw`C:\Users\Jan.Kowalski\AppData`, String.raw`C:\Users\[IMIĘ I NAZWISKO]\AppData`],
  ]);
});
test('b6 §8 p.4: udział z katalogami domowymi (home$, users$, profiles$, redirect$)', () => {
  masked([
    [String.raw`Udział: \\FS01\home$\tkaminski`, String.raw`Udział: \\FS01\home$\[LOGIN]`],
    [String.raw`\\FS01\users$\anowak\Dokumenty i \\srv\profiles$\jkowalski.V6`, String.raw`\\FS01\users$\[LOGIN]\Dokumenty i \\srv\profiles$\[LOGIN]`],
    [String.raw`Przekierowanie: \\srv\redirect$\mzajac\Pulpit`, String.raw`Przekierowanie: \\srv\redirect$\[LOGIN]\Pulpit`],
  ]);
  keep([String.raw`Drukarka: \\PRINT01\AdamK`, String.raw`Udział: \\FS01\home$\Public`, String.raw`Udział: \\FS01\Dzial\Kadry`]);
});
test('b6 §8 p.6: etykieta „Alias" — wartość wypełnia wiersz, bez domen i stanów', () => {
  masked([
    ['Alias: adam1986', `Alias: ${LG}`],
    ['Alias:\nadam1986', `Alias:\n${LG}`],
  ]);
  keep(["alias ll='ls -la'", 'Alias: brak', 'Alias: www.firma.pl', 'Alias: mail.urzad.gov.pl', 'Alias: adam1986 i inne nazwy']);
});
test('b6 §8 p.7: etykiety kont AD/LDAP i klucze dziennika zdarzeń', () => {
  masked([
    ['sAMAccountName: jkowalski', `sAMAccountName: ${LG}`],
    ['Konto AD: jkowalski\nKonto domenowe: anowak\nKonto LDAP: pzielinski', `Konto AD: ${LG}\nKonto domenowe: ${LG}\nKonto LDAP: ${LG}`],
    ['User name: pzielinski', `User name: ${LG}`],
    ['<Data Name="TargetUserName">tnowicki</Data>', `<Data Name="TargetUserName">${LG}</Data>`],
    ['"sAMAccountName": "kwisniewski", "targetUserName": "anowak"', `"sAMAccountName": "${LG}", "targetUserName": "${LG}"`],
    ['<sAMAccountName>kwisniewski</sAMAccountName>', `<sAMAccountName>${LG}</sAMAccountName>`],
    // znany login z atrybutu AD rozlewa się na resztę zgłoszenia
    ['sAMAccountName: jkowalski\nUżytkownik jkowalski zgłosił awarię.', `sAMAccountName: ${LG}\nUżytkownik ${LG} zgłosił awarię.`],
  ]);
  keep([
    'Konto AD: zablokowane',
    'Konto AD: aktywne do 2026-12-31',
    'Konto domenowe: tak',
    'Konto domenowe zostało zablokowane.',
    '<Data Name="SubjectUserName">SYSTEM</Data><Data Name="SubjectUserName">DWM-1</Data>',
    '<Data Name="IpPort">51322</Data><Data Name="LogonType">3</Data>',
  ]);
  masked([['User name: Jan Kowalski', 'User name: [IMIĘ I NAZWISKO]']]);
});
test('b6 §8 p.8: logi sshd, PAM i sudo — użytkownik jako [LOGIN], konta systemowe zostają', () => {
  masked([
    ['Accepted publickey for jkowalski from 10.20.1.45 port 51322 ssh2', `Accepted publickey for ${LG} from [IP] port 51322 ssh2`],
    ['Failed password for invalid user anowak from bastion.local port 22 ssh2', `Failed password for invalid user ${LG} from bastion.local port 22 ssh2`],
    ['Invalid user anowak from bastion.local port 22', `Invalid user ${LG} from bastion.local port 22`],
    ['pam_unix(sshd:session): session opened for user jkowalski(uid=1001) by (uid=0)', `pam_unix(sshd:session): session opened for user ${LG}(uid=1001) by (uid=0)`],
    ['sudo:  jkowalski : TTY=pts/0 ; PWD=/home/jkowalski ; USER=root ; COMMAND=/usr/bin/apt update', `sudo:  ${LG} : TTY=pts/0 ; PWD=/home/${LG} ; USER=root ; COMMAND=/usr/bin/apt update`],
  ]);
  keep([
    'Accepted password for root from bastion.local port 22 ssh2',
    'Accepted publickey for git from bastion.local port 22 ssh2\nAccepted publickey for deploy from bastion.local port 22 ssh2',
    'Invalid user admin from bastion.local port 22\nFailed password for invalid user ubuntu from bastion.local port 22 ssh2',
    'session opened for user www-data(uid=33) by (uid=0)',
    'sudo:  root : TTY=pts/0 ; PWD=/root ; USER=root ; COMMAND=/usr/bin/apt update',
    'sudo: unable to resolve host',
    'Czekaliśmy na odpowiedź for weeks from the vendor. Accepted offers for children from parents.',
  ]);
});

// ── Etap b6: poprawki po weryfikacji (runda 1) ──
test('b6 fix1: słaba etykieta „Alias"/„Konto AD" bierze tylko uchwyt osoby i nie rozlewa zwykłych wyrazów', () => {
  keep([
    'Konto AD: nadane\nUprawnienia zostały nadane.',
    'Konto domenowe: zmienione\nHasło zostało zmienione.',
    'Konto w domenie: posiada\nPracownik posiada uprawnienia.',
    'Konto AD: jest\nLaptop jest wydany.',
    'Konto LDAP: utworzono\nKonto w domenie: oczekuje\nWniosek utworzono, akceptacja oczekuje.',
    'Alias: rada\nSesję zwołuje rada gminy.',
    'Alias: zamowienia\nWszystkie zamowienia publiczne.',
    'Alias: intranet\nSerwer intranet obsługuje wnioski.',
    'Alias: Matrix\nFilm Matrix powraca.',
    'Alias: Wakacje\nCel: Wakacje 2027 w Grecji',
    'Alias: DNS-01',
    'Alias: sekretariat\nSekretariat przyjmuje wnioski.',
    '    alias: pamiec\n# pamiec podręczna',
    'alias: wnioski_2026\nIndeks wnioski_2026 zawiera dane.',
  ]);
  // nazwisko pod słabą etykietą maskuje FAZA 4 jako osobę, bez rozbijania par
  masked([
    ['Alias: Nowak\nPani Nowak złożyła reklamację.', 'Alias: [IMIĘ I NAZWISKO]\nPani [IMIĘ I NAZWISKO] złożyła reklamację.'],
    ['Ustalono, że Marek Kowal ma\nAlias: Kowal\nSprawę prowadzi Jan Kowal.', 'Ustalono, że [IMIĘ I NAZWISKO] ma\nAlias: Kowal\nSprawę prowadzi [IMIĘ I NAZWISKO].'],
    ['Konto AD: Kowalska\nPani Kowalska zgłosiła problem.', 'Konto AD: [IMIĘ I NAZWISKO]\nPani [IMIĘ I NAZWISKO] zgłosiła problem.'],
  ]);
  masked([['Alias: Kowalski\nPan Jan Kowalski został przeniesiony. Kowalski zacznie 1.11.', 'Alias: [OSOBA-A]\nPan [OSOBA-A] został przeniesiony. [OSOBA-A] zacznie 1.11.']], { pseudonyms: true });
  // uchwyt osoby dalej maskowany i rozlewany
  masked([
    ['Konto AD: a.nowak\nUżytkownik a.nowak zgłosił.', `Konto AD: ${LG}\nUżytkownik ${LG} zgłosił.`],
    ['Alias: jkowalski\nKonto jkowalski aktywne.', `Alias: ${LG}\nKonto ${LG} aktywne.`],
    [String.raw`Konto AD: FIRMA\jkowalski`, `Konto AD: ${LG}`],
  ]);
});
test('b6 fix1: konta wbudowane i zastępniki pod „User name", „sAMAccountName" i w dzienniku zdarzeń zostają', () => {
  keep([
    'User name: Administrator',
    'User name: unknown\nBłąd: unknown device.',
    'sAMAccountName: krbtgt\nsAMAccountName: Guest',
    '<Data Name="TargetUserName">Administrator</Data><Data Name="TargetUserName">krbtgt</Data>',
    '<Data Name="TargetUserName">recepcja2</Data>\nStanowisko recepcja2 w przychodni.',
    '{"samaccountname":"faktury01","opis":"Konto faktury01 obsługuje wysyłkę faktur."}',
  ]);
  masked([
    ['User name: anowak\nanowak zalogował się.', `User name: ${LG}\n${LG} zalogował się.`],
    // osoba WIELKIMI literami w polu loginu — cała para jako osoba, bez jawnego imienia (fix2)
    ['User name: ZIELINSKA KATARZYNA', 'User name: [IMIĘ I NAZWISKO]'],
    ['Login: ZIELINSKA KATARZYNA', 'Login: [IMIĘ I NAZWISKO]'],
  ]);
  // nazwisko w atrybucie i w polu „Name" dostaje etykietę osoby spójną z resztą dokumentu
  masked(
    [
      ['<Data Name="TargetUserName">Lewandowski</Data> Lewandowski', '<Data Name="TargetUserName">[OSOBA-A]</Data> [OSOBA-A]'],
      ['<Data Name="Name">Kowalski</Data> Kowalski', '<Data Name="Name">[OSOBA-A]</Data> [OSOBA-A]'],
    ],
    { pseudonyms: true },
  );
});
test('b6 fix1: propagacja i URL-e tylko dla uchwytu osoby (konta usług i działów zostają w prozie)', () => {
  masked([
    ['{"user": "batch01"}\nZadanie batch01 wykonuje import.', `{"user": "${LG}"}\nZadanie batch01 wykonuje import.`],
    ['{"user": "web_app"}\nAplikacja web_app łączy się z bazą.', `{"user": "${LG}"}\nAplikacja web_app łączy się z bazą.`],
    ['{"userid": "eod2024"}\nW systemie eod2024 zapisano.', `{"userid": "${LG}"}\nW systemie eod2024 zapisano.`],
    ['Login: projekty\nhttps://intranet.urzad.pl/projekty/plan.pdf', `Login: ${LG}\nhttps://intranet.urzad.pl/projekty/plan.pdf`],
    ['Login: wroclaw\nPanel: https://portal.firma.pl/oddzialy/wroclaw/raporty', `Login: ${LG}\nPanel: https://portal.firma.pl/oddzialy/wroclaw/raporty`],
    // uchwyt osoby rozlewa się dalej
    ['{"user":"jan_nowak"}\njan_nowak zalogował się', `{"user":"${LG}"}\n${LG} zalogował się`],
    ['{"user":"adam1986"}\nadam1986 pisze', `{"user":"${LG}"}\n${LG} pisze`],
  ]);
});
test('b6 fix1: trasy serwisu, katalogi działu i nazwy z ataku pod „/home", „/Users", udziałem i „Invalid user" zostają', () => {
  keep([
    '"GET /Users/Edit/15 HTTP/1.1" 200',
    'GET /home/dashboard',
    '| GET | /Users/me | profil |',
    'Trasa /home/regulamin. Strona /home/aktualnosci nie działa.',
    '/Users/Profile oraz /Users/import oraz /Users/active',
    '/home/vscode/.cache i /home/linuxbrew/.linuxbrew i /home/minecraft/server i /home/steam/logs',
    '/Users/Szablony/x i /home/twojlogin/ i /Users/twojanazwa/',
    // fix2: katalog działu pod „/home/" z dalszym członem to nie konto osoby
    'Kopie z /home/kadry_archiwum/ idą na NAS.\nFolder kadry_archiwum zawiera akta.',
    String.raw`Profil C:\Users\Biblioteka\Desktop jest wspólny, C:\Users\MSSQLSERVER\x`,
    String.raw`Udziały \\FS01\home$\Wspolny\ i \\fs01\profiles$\Meldunki\ oraz \\fs01\home\Wnioski800 i \\FS01\users\Skany`,
    'sshd[1]: Invalid user test1 from bastion.local port 4013',
    'Failed password for invalid user admin123 from bastion.local port 22 ssh2',
  ]);
  masked([
    ['Katalog /home/mzajac/projekty', `Katalog /home/${LG}/projekty`],
    [String.raw`\\srv\home$\mzajac\Pulpit`, String.raw`\\srv\home$\[LOGIN]\Pulpit`],
    [String.raw`C:\Users\Tomasz\Desktop i C:\Users\u12345\Desktop`, String.raw`C:\Users\[LOGIN]\Desktop i C:\Users\[LOGIN]\Desktop`],
    ['Accepted password for kpw from bastion.local port 22 ssh2', `Accepted password for ${LG} from bastion.local port 22 ssh2`],
    // imię i nazwisko małymi literami w nazwie katalogu — w całości jako osoba, bez fragmentu
    [String.raw`Plik: C:\Users\ewa nowak\Desktop\a.pdf`, String.raw`Plik: C:\Users\[IMIĘ I NAZWISKO]\Desktop\a.pdf`],
  ]);
  masked(
    [[String.raw`Załącznik: C:\Users\Kowalska\Pictures\a.jpg; Pani Kowalska`, String.raw`Załącznik: C:\Users\[OSOBA-A]\Pictures\a.jpg; Pani [OSOBA-A]`]],
    { pseudonyms: true },
  );
});
test('b6 fix1: adres profilu bez schematu kończy się na profilu — sklejone numery dalej maskowane', () => {
  masked([
    ['linkedin.com/in/anowak/;501-234-567', `linkedin.com/in/${LG}/;[TELEFON]`],
    ['pl.linkedin.com/in/anna-nowak/,tel:501234567', `pl.linkedin.com/in/${LG}/,tel:[TELEFON]`],
    ['pl.linkedin.com/in/joannapietrzak?trk=public_profile|tel:600123456', `pl.linkedin.com/in/${LG}?trk=public_profile|tel:[TELEFON]`],
    [
      'Skan: firma-my.sharepoint.com/personal/anna_nowak_firma_pl/Documents/PESEL_85010112345.pdf',
      `Skan: firma-my.sharepoint.com/personal/${LG}/Documents/PESEL_[PESEL].pdf`,
    ],
    ['facebook.com/profile.php?id=100012345678,PESEL:85010112345,tel:600123456', `facebook.com/profile.php?id=${LG},PESEL:[PESEL],tel:[TELEFON]`],
  ]);
});
test('b6 fix2: adres profilu bez schematu nie wciąga doklejonych danych w parametrach', () => {
  masked([
    ['facebook.com/profile.php?id=100004567890123.Anna Nowak dzwoniła.', `facebook.com/profile.php?id=${LG}.[IMIĘ I NAZWISKO] dzwoniła.`],
    ['FB: facebook.com/profile.php?id=100004567890123.Tel.501234567', `FB: facebook.com/profile.php?id=${LG}.Tel.[TELEFON]`],
    ['linkedin.com/in/anowak?locale=pl.Tel.501234567', `linkedin.com/in/${LG}?locale=pl.Tel.[TELEFON]`],
    ['linkedin.com/in/anowak?trk=public&Anna=Nowak', `linkedin.com/in/${LG}?trk=public&Anna=[IMIĘ I NAZWISKO]`],
    ['linkedin.com/in/jan.kowalski?iban=PL61109010140000071219812874', `linkedin.com/in/${LG}?iban=[NR-KONTA]`],
    // znane parametry serwisu zostają częścią adresu
    ['pl.linkedin.com/in/jan-kowalski-12345?trk=public_profile&originalSubdomain=pl', `pl.linkedin.com/in/${LG}?trk=public_profile&originalSubdomain=pl`],
  ]);
});
test('b6 fix2: „Imię.Nazwisko" i nazwisko pod etykietą konta zostają osobą z pseudonimem', () => {
  masked(
    [
      [
        '{"user":"Jan.Kowalski","akcja":"wydruk"}\nWydruk zlecił Jan.Kowalski, a zatwierdził Jan Kowalski.',
        '{"user":"[LOGIN]","akcja":"wydruk"}\nWydruk zlecił [OSOBA-A], a zatwierdził [OSOBA-A].',
      ],
      ['Pracownik: Jan Kowalski\nAlias: Jan.Kowalski', 'Pracownik: [OSOBA-A]\nAlias: [OSOBA-A]'],
      ['User name: Jan.Kowalski\nJan Kowalski', 'User name: [OSOBA-A]\n[OSOBA-A]'],
      ['User name: Nowak\nPani Nowak zgłosiła awarię.', 'User name: [OSOBA-A]\nPani [OSOBA-A] zgłosiła awarię.'],
      ['sAMAccountName: Nowak\nPan Nowak zgłosił awarię.', 'sAMAccountName: [OSOBA-A]\nPan [OSOBA-A] zgłosił awarię.'],
      // osoba WIELKIMI literami w polu loginu dostaje tę samą etykietę co w treści
      ['Pracownik: Adam Nowak\nUser name: ADAM NOWAK\n', 'Pracownik: [OSOBA-A]\nUser name: [OSOBA-A]\n'],
      ['User name: SYLWIA KRAWCZYK\nSylwia Krawczyk zgłosiła awarię.', 'User name: [OSOBA-A]\n[OSOBA-A] zgłosiła awarię.'],
    ],
    { pseudonyms: true },
  );
});
test('b6 fix2: para WIELKIMI literami z pola loginu maskowana też w odwrotnym szyku', () => {
  masked([
    ['Login: JANKOWSKI\nUser: TOMASZ JANKOWSKI\nJANKOWSKI TOMASZ', 'Login: [LOGIN]\nUser: [IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO]'],
    // samo imię z pola loginu nie jest rozlewane (świadomy koszt: „PARAFIA: ŚW. JAN", „MAJ 2025"
    // i inne wersaliki-homonimy niszczyły daty i nagłówki), samo nazwisko tak
    ['User: TOMASZ JANKOWSKI\nTOMASZ zgłosił się osobiście.', 'User: [IMIĘ I NAZWISKO]\nTOMASZ zgłosił się osobiście.'],
    ['User: TOMASZ JANKOWSKI\nJANKOWSKI zgłosił się osobiście.', 'User: [IMIĘ I NAZWISKO]\n[IMIĘ I NAZWISKO] zgłosił się osobiście.'],
    ['Login: ANNA NOWAK\nWnioskodawca: NOWAK ANNA', 'Login: [IMIĘ I NAZWISKO]\nWnioskodawca: [IMIĘ I NAZWISKO]'],
  ]);
  // pułapka: pojedynczy wyraz w ciągu wielkich liter obok innego to może być inna osoba,
  // a placeholdery z nawiasem nie są danymi
  keep(['ZAŁĄCZNIK NR 2']);
  // K48: imię i nazwisko-homograf WERSALIKAMI to osoba; login obok zostaje osobną maską
  masked([['Kontakt: TOMASZ WRÓBEL [LOGIN]', `Kontakt: ${N} [LOGIN]`]]);
});
test('b6 fix2: „User name" i „sAMAccountName" nie rozbijają osób i nie rozlewają zwykłych wyrazów', () => {
  masked([
    ['User name: Tomasz\nZgłasza: Tomasz Wróbel, Referat Inwestycji.', `User name: ${LG}\nZgłasza: [IMIĘ I NAZWISKO], Referat Inwestycji.`],
    ['User name: Katarzyna\nKatarzyna Lis prosi o kontakt.', `User name: ${LG}\n[IMIĘ I NAZWISKO] prosi o kontakt.`],
    ['sAMAccountName: Tomasz\nZgłasza: Tomasz Wróbel.', `sAMAccountName: ${LG}\nZgłasza: [IMIĘ I NAZWISKO].`],
    ['Zgłoszenie\nUser name: Nowa\nNowa drukarka nie działa. Nowa skrzynka.', `Zgłoszenie\nUser name: ${LG}\nNowa drukarka nie działa. Nowa skrzynka.`],
    ['User name: Lato\nLato w tym roku było upalne.', `User name: ${LG}\nLato w tym roku było upalne.`],
    ['sAMAccountName: kowal\nkowal pracował', `sAMAccountName: ${LG}\nkowal pracował`],
    // imię z nazwiskiem w polu — w całości osoba, bez jawnego nazwiska
    ['User name: Anna Zając', 'User name: [IMIĘ I NAZWISKO]'],
    ['User name: Jan Kowal', 'User name: [IMIĘ I NAZWISKO]'],
    ['User name: Tomasz Zima, tel. 501 234 567', 'User name: [IMIĘ I NAZWISKO], tel. [TELEFON]'],
    ['sAMAccountName: Dawid Kowal', 'sAMAccountName: [IMIĘ I NAZWISKO]'],
    // uchwyt osoby dalej się rozlewa
    ['User name: jkowalski\nKonto jkowalski zablokowane.', `User name: ${LG}\nKonto ${LG} zablokowane.`],
    ['sAMAccountName: a.kaminska\nPani a.kaminska', `sAMAccountName: ${LG}\nPani ${LG}`],
  ]);
  // etykieta w instrukcji, po której stoi zdanie, a nie wartość
  keep([
    'Pole sAMAccountName: jest obowiązkowe. Wniosek jest rozpatrywany w 7 dni.',
    'W polu User name: wpisz swój login. W polu Password wpisz hasło. Pamiętaj: wpisz je.',
  ]);
});
test('b6 fix2: katalogi działów, sekcje serwisu, zastępniki i konta usług w ścieżkach i logach zostają', () => {
  keep([
    'Plik zapisano w /home/dokumenty/2025/raport.pdf',
    String.raw`Ścieżka: C:\Users\pielegniarki\Desktop\raport.docx`,
    String.raw`\\fs01\home$\pacjenci\x.doc C:\Users\skany\a C:\Users\lekarz\a C:\Users\rtg\a C:\Users\gabinet3\a`,
    'Wnioski trafiają do katalogu /home/wnioski/przychodzace.',
    'Strona /home/aktualnosci/2024 i [Biblioteka](/home/biblioteka/zbiory) oraz /Users/promocja/Festyn2024/plakaty',
    'Ekran /home/start/panel, /home/sezon/zima/raport i /home/wiosna2024/foto',
    String.raw`1. Zapisz plik w C:\Users\nazwa_uzytkownika\Documents\EZD.`,
    '2. Na komputerach Mac użyj /Users/twoja_nazwa/Documents, a na serwerze /home/twoj_login/.',
    'session opened for user cron by (uid=0)',
    'Accepted publickey for splunk from bastion.local port 22 ssh2',
  ]);
  masked([
    // inicjał z nazwiskiem-homonimem to kształt loginu
    ['Katalog /home/mzajac/projekty i /home/tkowal/x', `Katalog /home/${LG}/projekty i /home/${LG}/x`],
    // imię sklejone z nazwiskiem bez separatora
    ['Plik: /Users/annanowak/Documents/umowa.pdf', `Plik: /Users/${LG}/Documents/umowa.pdf`],
    [String.raw`C:\Users\tkaminski\Desktop /home/jkowalski/x /home/adam/projekty`, String.raw`C:\Users\[LOGIN]\Desktop /home/[LOGIN]/x /home/[LOGIN]/projekty`],
  ]);
});

// ── Partia b7 (FIX_CAREFULLY): tabele, WERSALIKI, homografy, odmiana imion, adres po etykiecie ──
const NR = '[NR-REJESTRACYJNY]';
const PS = '[PESEL]';
test('b7 K61: nagłówek CSV/TSV/Markdown z kolumną osoby to kotwica dla komórek pod nim', () => {
  masked([
    ['imie;nazwisko;pesel;data_urodzenia;miejscowosc\nJan;Kos;90053024683;1990-05-30;Biała Podlaska', `imie;nazwisko;pesel;data_urodzenia;miejscowosc\n${N};${N};${PS};${DU};${C}`],
    ['login,first_name,last_name,email\nmzajac,Magdalena,Zając,m.zajac@firma.pl', `login,first_name,last_name,email\n${LG},${N},${N},[EMAIL]`],
    ['login\tfirst_name\tlast_name\nmzajac\tMagdalena\tZając', `login\tfirst_name\tlast_name\n${LG}\t${N}\t${N}`],
    ['| Imię | Nazwisko | Miasto |\n|---|---|---|\n| Jan | Kos | Kraków |', `| Imię | Nazwisko | Miasto |\n|---|---|---|\n| ${N} | ${N} | ${C} |`],
    ['Lp.;Nr rejestracyjny;Marka\n1;WI 4821F;Skoda', `Lp.;Nr rejestracyjny;Marka\n1;${NR};Skoda`],
    // adres z kodem w jednej komórce zostaje przebiegom adresu, kodu i miasta
    ['"nazwisko","adres"\n"Kowalski","ul. Lipowa 5, 00-001 Warszawa"', `"nazwisko","adres"\n"${N}","${A}, ${KOD} ${C}"`],
  ]);
  keep([
    'city,population\nKraków,800000',
    'id,name,category\n1,Zając,zabawka',
    'imie,nazwisko\nDzień dobry, przesyłam listę.',
    'Lp.;Data rejestracji;Kod produktu;Marka\n1;2024-01-01;AB 12345;Skoda',
    'timestamp,user,action\n2024-01-01,jkowalski,login',
    'Wymagane pola: login, hasło.',
    // wiersz opisu pod nagłówkiem osoby i nazwa pola w wierszu to nie osoba
    'Nazwisko\tImię\tOddział\nOddział\tKardiologia\tChirurgia',
  ]);
});
test('b7 K03: tabulator w osobie to granica komórki — maska w każdej, kolumny zostają', () => {
  masked([
    ['Adam\tKowalczyk\tMagazynier', `${N}\t${N}\tMagazynier`],
    ['Nowak\tAnna\tKardiologia\nWilk\tJan\tChirurgia', `${N}\t${N}\tKardiologia\n${N}\t${N}\tChirurgia`],
    ['Mazur\tGrzegorz\tKierownik\tKadry', `${N}\t${N}\tKierownik\tKadry`],
    ['Kowalski\tJan\t65093035795', `${N}\t${N}\t${PS}`],
    ['Nazwisko:\tGzowski\tKadry', `Nazwisko:\t${N}\tKadry`],
    ['Nazwisko\tKowalski', `Nazwisko\t${N}`],
    ['Telefon\tKowalski', `Telefon\t${N}`],
  ]);
  keep([
    'Imię i nazwisko\tLokal\tTelefon',
    'Imie i nazwisko\tAdres\tE-mail',
    'Imię\tNazwisko\tStanowisko',
    'Ulica\tAdama\tMickiewicza',
    'Miasto\tWojewództwo\nRadom\tMazowieckie',
    'Sąd Rejonowy\tWydział Cywilny\tSekcja Egzekucyjna',
    'Kod\tNazwa\tCena\nA1\tKawa Mielona\t15',
    'Maj\tAnna',
    'Sobota\tMarek',
    'Polak\tJan',
    'Jan\tOperator',
  ]);
});
test('b7 K47: WERSALIKI w szyku odwróconym, odrzucona para nie zjada imienia, zapis mieszany', () => {
  masked([
    ['Wnioskodawca: KOWALSKI JAN\n1. KOWALSKA ANNA – kierownik', `Wnioskodawca: ${N}\n1. ${N} – kierownik`],
    ['Lista obecności: NOWAK PIOTR, WÓJCIK MARIA', `Lista obecności: ${N}, ${N}`],
    ['POZWANY NOWAK PIOTR', `POZWANY ${N}`],
    ['TYTUŁ: KOWALSKI JAN CZYNSZ 11/2024', `TYTUŁ: ${N} CZYNSZ 11/2024`],
    ['CZYNSZ JAN KOWALSKI\nZWROT ZA BILETY JAN KOWALSKI', `CZYNSZ ${N}\nZWROT ZA BILETY ${N}`],
    ['OBECNI BYLI JAN KOWALSKI ORAZ ANNA NOWAK', `OBECNI BYLI ${N} ORAZ ${N}`],
    ['1. KOWALSKA ANNA MARIA, córka JANA', `1. ${N}, córka ${N}`],
    ['Pani ANNA MARIA NOWAK', `Pani ${N}`],
    ['Pacjent: KOWALSKA Anna\nZlecił: dr Piotr NOWICKI', `Pacjent: ${N}\nZlecił: dr ${N}`],
    ['Pani Anna KOWALSKA przyszła.', `Pani ${N} przyszła.`],
    ['Pan KOWALSKI\nPanu KOWALSKIEMU\nSzanowny Panie KOWALSKI', `Pan ${N}\nPanu ${N}\nSzanowny Panie ${N}`],
    ['Pani SĘDZIA NOWAK', `Pani SĘDZIA ${N}`],
    ['NA ULICY ALEKSANDRA NOWAK ZOSTAŁA POTRĄCONA.', `NA ULICY ${N} ZOSTAŁA POTRĄCONA.`],
  ]);
  keep([
    'ULICA KOŚCIUSZKI TADEUSZA',
    'ADRES: MICKIEWICZA ADAMA 5',
    'KRÓL JAN III SOBIESKI',
    'SOBOTA ADAM',
    'DYŻUR: SOBOTA ADAM, NIEDZIELA EWA',
    'OLIMPIJSKA NADZIEJA',
    'RONDO ROMANA DMOWSKIEGO',
    'UNIWERSYTET ADAMA MICKIEWICZA W POZNANIU',
    'AKADEMIA WYCHOWANIA FIZYCZNEGO JÓZEFA PIŁSUDSKIEGO',
    'NOVA IM. IGNACEGO JANA PADEREWSKIEGO',
    'JAGIEŁŁO WŁADYSŁAW\nMATEJKO JAN',
    'BIAŁY ADAM',
    'Wojewoda MAZOWIECKI',
    'Szpital BIELAŃSKI im. ks. Jerzego Popiełuszki',
    'Instytut im. Marii SKŁODOWSKIEJ-CURIE',
    'Pomnik Adama MICKIEWICZA stoi w rynku.',
    'Pan TADEUSZ czyli ostatni zajazd',
    'Pan BÓG',
    'Pani ZUS',
    'Fiat PANDA',
  ]);
});
test('b7 K48: nazwisko-homograf przy imieniu WERSALIKAMI, przy etykiecie osoby i po tytule lub roli', () => {
  masked([
    ['Wnioskodawca: PIOTR WILK\nPOWÓD: MAREK DUDA\nSSO MAREK DUDA', `Wnioskodawca: ${N}\nPOWÓD: ${N}\nSSO ${N}`],
    ['z powództwa MARCINA WRÓBLA przeciwko ANNIE MAZUR', `z powództwa ${N} przeciwko ${N}`],
    ['Rozmawiałem z PANEM PIOTREM WILKIEM w tej sprawie.', `Rozmawiałem z PANEM ${N} w tej sprawie.`],
    ['PRZELEW OD: KATARZYNY SIKORY', `PRZELEW OD: ${N}`],
    ['Pacjent: Wilk Jadwiga', `Pacjent: ${N}`],
    ['Prokurator nie oponuje. Pacjent: Wilk Jadwiga', `Prokurator nie oponuje. Pacjent: ${N}`],
    ['1. Mazur Grzegorz – Kierownik', `1. ${N} – Kierownik`],
    ['Konsultował dr Mróz.\nCzy mogę przyjść do dr. Sikory?', `Konsultował dr ${N}.\nCzy mogę przyjść do dr. ${N}?`],
    ['adw. Wilk wnosi o oddalenie. Prokurator Baran nie oponuje.', `adw. ${N} wnosi o oddalenie. Prokurator ${N} nie oponuje.`],
    ['świadka Wróbla, biegłą Sowę, prokuratorowi Baranowi', `świadka ${N}, biegłą ${N}, prokuratorowi ${N}`],
    ['Współpracuje z zespołem p. Wróbla.', `Współpracuje z zespołem p. ${N}.`],
    ['Spotkanie z A. Sikorą, list od A. Mroza', `Spotkanie z ${N}, list od ${N}`],
  ]);
  keep([
    'PIĄTEK 3 MAJA SOBOTA 4 MAJA',
    'KRÓL LEW',
    'JAN MAREK',
    'EWA KALINA',
    'ANNA STAROSTA',
    'POLE KOT',
    'TO NIE PIES, ALE WILK',
    'Kot Anny spał na kanapie.',
    'Król Zygmunt August',
    'Polak Jan wygrał zawody.',
    'Świadek Jehowy odmówił.',
    'Pacjent przyjął lek. Następnego dnia',
    'Leki kupiłem w aptece Dr Max',
    'Biuro na II p. Pokój 304.',
    'Szczegóły p. Załącznik nr 2.',
    'Sędzia Sobota',
    '1. Sobota Marek',
  ]);
  // pseudonim liczony od formy bazowej homografu: ta sama osoba w odmianie i w mianowniku
  expect(redactPII('MARCINA WRÓBLA wezwano. Jan Wróbel stawił się.', { pseudonyms: true }).redacted).toBe(
    '[OSOBA-A] wezwano. [OSOBA-A] stawił się.',
  );
});
test('b7 K31: imiona w odmianie (ruchome e, -iem, przymiotnikowa, zdrobnienia, oboczności żeńskie)', () => {
  masked([
    ['z powództwa Pawła Kowalskiego przeciwko Agacie Nowak', `z powództwa ${N} przeciwko ${N}`],
    ['Pismo Jerzego Nowaka wpłynęło wczoraj.', `Pismo ${N} wpłynęło wczoraj.`],
    ['Jerzemu Nowakowi, Ignacemu Nowakowi, z Antonim Nowakiem', `${N}, ${N}, z ${N}`],
    ['Pismo Jerzego Brzęczyszczykiewicza wpłynęło.', `Pismo ${N} wpłynęło.`],
    ['z Jackiem Kowalskim, z Henrykiem Lisem, z Maćkiem Nowakiem', `z ${N}, z ${N}, z ${N}`],
    ['byłem u Tomka Kowalskiego, od Krzyśka Nowaka, dla Stasia Lisa', `byłem u ${N}, od ${N}, dla ${N}`],
    ['od Jadzi Nowak, dla Gosi Mróz, zadzwoń do Wojtka Lisa', `od ${N}, dla ${N}, zadzwoń do ${N}`],
    ['Monice Mazur, Marcie Kowalskiej, Jadwidze Kowalczyk, Barbarze Wiśniewskiej', `${N}, ${N}, ${N}, ${N}`],
    // formy-słowa tylko tuż przed nazwiskiem (maską)
    ['prezent od Ani Kowalskiej, od Marka Kowalskiego', `prezent od ${N}, od ${N}`],
  ]);
  keep([
    'Kościół św. Jerzego Męczennika',
    'Katedra Świętego Jerzego Męczennika.',
    'Sobór św. Jerzego Zwycięzcy.',
    'Fundacja Jerzego Owsiaka.',
    'Pomnik Jerzego Waszyngtona stoi w parku.',
    // „Jerzego Waszyngtona 12" bez kontekstu adresu — patrz test.skip „fix3: ulica z patronem bez kontekstu…"
    'Szkoła im. Jerzego Kukuczki',
    'Ewangelia według św. Marka',
    'Marka Toyota zdobyła nagrodę.',
    'Marka Własna Biedronki',
    'Ani Policja, ani Straż Miejska nie przyjechały.',
    'kurs franka szwajcarskiego',
    'Walka z korupcją trwa.',
    'Arka Noego',
    'Antonim słowa wysoki',
    'Drogi Pawle, dziękuję',
    'parafia św. Antoniego Padewskiego',
  ]);
  // „św." jako świadek przed imieniem w bierniku dalej maskuje osobę
  masked([['Sąd przesłuchał św. Annę Kowalską.', `Sąd przesłuchał św. ${N}.`]]);
});
test('b7 K51: imiona zapisane bez ogonków', () => {
  masked([
    ['Rozmawialem z Lukaszem Wisniewskim', `Rozmawialem z ${N}`],
    ['Michal Nowak napisal', `${N} napisal`],
    ['[12:02] Michal Nowak: ok', `[12:02] ${N}: ok`],
    ['Odbiorca: MALGORZATA SZYMANSKA', `Odbiorca: ${N}`],
    ['Odbiorca: Lukasz Nowak', `Odbiorca: ${N}`],
    ['Wnioskodawca: LUKASZ PAWŁOWSKI', `Wnioskodawca: ${N}`],
  ]);
  keep([
    'Hej Michal, dzieki za info',
    'Ewangelia wg sw. Lukasza',
    'parafia sw. Jozefa Oblubienca w Krakowie',
    'kosciol pw. sw. Michala Archaniola',
    'archiwum Stasi',
    'samoloty Rafale',
    'Zaklina Rzeczywistosc',
    'Roza Wiatrow',
    'Rondo Jozefa Bema',
    'szpital im. Jana Pawla II',
    'KASKI OCHRONNE',
    'SAD REJONOWY W JAROSLAWIU',
  ]);
});
test('b7 K67: imiona rodziców za zamaskowaną osobą', () => {
  masked([
    ['Krzysztof Wróbel, syn Józefa i Marii, PESEL 62093011114', `${N}, syn ${N} i ${N}, PESEL ${PS}`],
    ['1. KOWALSKI PIOTR, syn STANISŁAWA, HALINY, PESEL 65093035795', `1. ${N}, syn ${N}, ${N}, PESEL ${PS}`],
    ['Jan Kowalski s. Stanisława i Haliny', `${N} s. ${N} i ${N}`],
    // skrót „s." bez dwóch imion i przymiotnik po „syn" nie są imionami rodziców
    ['Jan Kowalski, s. 15 protokołu.', `${N}, s. 15 protokołu.`],
    ['Jan Kowalski, syn marnotrawny, wrócił.', `${N}, syn marnotrawny, wrócił.`],
  ]);
  keep(['Jezus, syn Józefa i Maryi, nauczał.', 'Mój syn Józef ma pięć lat.', 'Parafia Świętego Józefa']);
});
test('b7 K53: data urodzenia po formie osobowej „urodził(a) się"', () => {
  masked([
    ['urodziłam się 12.05.1990 w Łodzi', `urodziłam się ${DU} w ${C}`],
    ['Urodziłem się 1 stycznia 1980 r.', `Urodziłem się ${DU} r.`],
    ['urodziłam się dnia 12.05.1990 r.', `urodziłam się dnia ${DU} r.`],
    ['urodziliśmy się 02.07.2019', `urodziliśmy się ${DU}`],
  ]);
  keep([
    'Dziecko urodzi się około 12.05.2026.',
    'dzieci, które urodziły się po 1 stycznia 2016 r.',
    'urodziła się 12.03.1953 r. lub później',
    'Zapraszam na urodziny w sobotę 12.05.2024',
  ]);
});
test('b7 K56: ulica z numerem bez „ul." po etykiecie zamieszkania', () => {
  masked([
    ['Adres zamieszkania: Lipowa 14/3, Gdańsk', `Adres zamieszkania: ${A}, ${C}`],
    ['Adres zamieszkania: Gdańsk, Lipowa 14/3', `Adres zamieszkania: ${C}, ${A}`],
    ['Adres zamieszkania: Mickiewicza 5/2, Kraków', `Adres zamieszkania: ${A}, ${C}`],
    ['Adres zamieszkania: Jana Pawła II 14/3, Gdańsk', `Adres zamieszkania: ${A}, ${C}`],
    ['Zamieszkały: Zalesie 45', `Zamieszkały: ${A}`],
    ['Anna Nowak, zam. Rynek 15 m. 3 w Krakowie.', `${N}, zam. ${A} w ${C}.`],
    ['zamieszkała Wybrzeże Kościuszkowskie 31/33 w Warszawie', `zamieszkała ${A} w ${C}`],
    ['Adres: Lipowa 14/3, Gdańsk', `Adres: ${A}, ${C}`],
  ]);
  keep([
    'Nr zam. 45/2024 z dnia 12.03.2024',
    'Zam. Laptop 2 szt. do działu IT.',
    'zam. Kawa 3 opakowania',
    'Zam. Dostawa 15 zł netto.',
    'Adres: Sala 5',
    'Adres: Windows 10',
    'Adres: Gdańsk 2024',
    'Adres siedziby: Sąd Rejonowy 5',
    'Rynek 15 to miejsce spotkań',
    'zamieszkały w Polsce od 15 lat',
    'Adres zamieszkania: Pokój 12',
    'zam. Nowa Wieś 7a',
  ]);
});
test('b7 K58: kwalifikator systemu w etykiecie loginu', () => {
  masked([
    ['Login AD: wkozlowski\nLogin (AD): wkozlowski', `Login AD: ${LG}\nLogin (AD): ${LG}`],
    ['Login SAP: wkozlowski', `Login SAP: ${LG}`],
    ['Login do VPN: wkozlowski', `Login do VPN: ${LG}`],
    ['Login [AD]: wkozlowski', `Login [AD]: ${LG}`],
    ['Login – AD: wkozlowski', `Login – AD: ${LG}`],
    ['User AD: wkozlowski', `User AD: ${LG}`],
    ['Nazwa użytkownika AD: wkozlowski', `Nazwa użytkownika AD: ${LG}`],
    ['Login domenowy (AD): wkozlowski', `Login domenowy (AD): ${LG}`],
    ['Login AD:\nwkozlowski', `Login AD:\n${LG}`],
    ['Login AD: wkozlowski (konto zablokowane)', `Login AD: ${LG} (konto zablokowane)`],
  ]);
  keep([
    'Login FAILED: Invalid password',
    'Login SSO: Okta',
    'Login MFA: SMS',
    'Login URL: portal.firma.pl',
    'User SAP: Administrator',
    'Login AD: root',
    'Login VPN: tak',
    'Login AD: wymagany',
    'User-Agent: Mozilla/5.0',
  ]);
});
test('b7 K60: vCard z parametrami „TEL;TYPE=" i atrybuty XML z danymi osoby', () => {
  masked([
    ['TEL;TYPE=WORK:22 123 45 67', 'TEL;TYPE=WORK:[TELEFON]'],
    ['TEL;WORK;VOICE:22 123 45 67', 'TEL;WORK;VOICE:[TELEFON]'],
    [
      '<Pelnomocnik imie="Piotr" nazwisko="Lewandowski" dataUrodzenia="1978-01-09"/>\n<Adres ulica="Ogrodowa 8" kod="62-800" miasto="Kalisz"/>',
      `<Pelnomocnik imie="${N}" nazwisko="${N}" dataUrodzenia="${DU}"/>\n<Adres ulica="${A}" kod="${KOD}" miasto="${C}"/>`,
    ],
    [`<osoba imie='Anna' nazwisko='Gzik' pesel='85031412347'/>`, `<osoba imie='${N}' nazwisko='${N}' pesel='${PS}'/>`],
  ]);
  keep([
    '<xs:element name="Nazwisko" type="xs:string"/>',
    '<input name="imie" type="text">',
    '<Podmiot osoba="prawna"/>',
    'Hotel; pokój 22 123 45 67',
  ]);
});
test('b7 K64: przeniesienie wyrazu za maską i tekst rozstrzelony w wartości pola', () => {
  masked([
    ['z powództwa Barbary Wojciechow-\nskiej przeciwko', `z powództwa ${N} przeciwko`],
    ['Barbara Woj-\nciechowska', N],
    ['02-511 Warsza-\nwa', `${KOD} ${C}`],
    ['Imię i nazwisko: K R Z Y S Z T O F   M A Z U R', `Imię i nazwisko: ${N}`],
  ]);
  keep(['Imię\n\nN I P', 'Nazwisko\n\nP E S E L', 'przedsię-\nbiorstwa', 'Sąd Rejonowy dla Warszawy-\nŚródmieścia', 'W N I O S E K   O   W Y D A N I E']);
});
test('b7 b5-pominięte: kotwica pojazdowa w odmianie i miejscownik miejscowości po „zam. w"', () => {
  masked([
    ['Wykaz pojazdów: WE 12345, GD 2345A', `Wykaz pojazdów: ${NR}, ${NR}`],
    ['Kierujący autem WE 12345 zbiegł.', `Kierujący autem ${NR} zbiegł.`],
    ['Kierowca przyczepą WE 6789P wjechał.', `Kierowca przyczepą ${NR} wjechał.`],
    ['Jan Kowalski, zam. w Kraśniku, ul. Lipowa 5', `${N}, zam. w ${C}, ${A}`],
    ['zameldowany w Piasecznie.', `zameldowany w ${C}.`],
  ]);
  keep([
    'Rysunki wykonano w programie AutoCAD 2024.',
    'dla pojazdów PN 2020',
    'Liczba pojazdów według GUS 2023 wzrosła.',
    'Liczba samochodów w KRS 1234 była wysoka.',
    'Dla samochodów z silnikiem TDI 2000 nie.',
    'zamieszkały w Polsce od 15 lat',
    'zamieszkała w Domu Pomocy Społecznej',
    'zamieszkały na Śląsku',
    'Urząd Miasta w Kraśniku',
    'osób zamieszkałych w Świdniku',
  ]);
});
test('b7 K56: ulica z patronem w dopełniaczu i numerem bez „ul." przy miejscowości albo za osobą', () => {
  masked([
    ['Jana Pawła II 14/3, Gdańsk', `${A}, ${C}`],
    ['Anna Kowalska, Jana Pawła II 5', `${N}, ${A}`],
    ['Ignacego Łukasiewicza 5, 35-001 Rzeszów', `${A}, ${KOD} ${C}`],
  ]);
  keep(['rondo Jana Pawła II w Krakowie', 'Wyrok z dnia 12 maja, Kraków']);
  // patron z numerem domu bez pewnej kotwicy adresu nie zostaje jawny: maska osoby jak w v0.46.23
  masked([['Na Jana Pawła II 5 mieszka Jan.', `Na ${N} II 5 mieszka Jan.`]]);
  masked([['Pismo Jerzego Nowaka 12 maja wpłynęło.', `Pismo ${N} 12 maja wpłynęło.`]]);
});
test('b7 regresje: przeniesienie wyrazu tylko, gdy początek z ogonem tworzy nazwisko albo miasto', () => {
  masked([
    ['z powództwa Barbary Wojciechow-\nskiej przeciwko', `z powództwa ${N} przeciwko`],
    ['Wniosek złożył Jan Wojciechow-\nski z Radomia.', `Wniosek złożył ${N} z Radomia.`],
    ['02-511 Warsza-\nwa', `${KOD} ${C}`],
    ['Jan Kowalski-\nkierownik.', `${N}-\nkierownik.`],
    ['Wniosek złożył Adam Mazur-\nnastępnie go wycofał.', `Wniosek złożył ${N}-\nnastępnie go wycofał.`],
    ['Rozmawiałem z Anną Nowak-\nktóra potwierdziła.', `Rozmawiałem z ${N}-\nktóra potwierdziła.`],
    ['Uczestnicy: Jan Nowak-\nprezes, Anna Lis-\nsekretarz.', `Uczestnicy: ${N}-\nprezes, ${N}-\nsekretarz.`],
    ['Kierownik: Jan Kowal-\nkierownik działu odpowiada za BHP.', `Kierownik: ${N}-\nkierownik działu odpowiada za BHP.`],
  ]);
});
test('b7 regresje: tabela z nagłówkiem — wiersze instytucji, kolejny nagłówek, podsumowanie, data pod telefonem', () => {
  masked([
    ['Nazwisko i imię,Miasto\nKowalski Jan,Kraków\nUrząd Miasta,Łódź', `Nazwisko i imię,Miasto\n${N},${C}\nUrząd Miasta,Łódź`],
    ['Lp;Imię i nazwisko;Miejscowość\n1;Jan Kowalski;Radom\n2;Gminny Ośrodek Kultury;Kozienice', `Lp;Imię i nazwisko;Miejscowość\n1;${N};${C}\n2;Gminny Ośrodek Kultury;Kozienice`],
    ['Nazwisko,Imię,Pokój\nNowak,Jan,12\nProdukt,Cena,Ilość\nZając pluszowy,29.99,5', `Nazwisko,Imię,Pokój\n${N},${N},12\nProdukt,Cena,Ilość\nZając pluszowy,29.99,5`],
    ['Imię;Nazwisko;Telefon\nJan;Nowak;501 234 567\nStan na;;01.10.2026', `Imię;Nazwisko;Telefon\n${N};${N};[TELEFON]\nStan na;;01.10.2026`],
    ['Imię\tNazwisko\tTelefon\nJan\tNowak\t501 234 567\nWydruk z dnia\t\t2026-10-01', `Imię\tNazwisko\tTelefon\n${N}\t${N}\t[TELEFON]\nWydruk z dnia\t\t2026-10-01`],
    ['Nazwisko\tImię\nRazem działów\tWszyscy', 'Nazwisko\tImię\nRazem działów\t[IMIĘ I NAZWISKO]'],
    ['Imię;Telefon\nJan;501 234 567', `Imię;Telefon\n${N};[TELEFON]`],
  ]);
  keep([
    'Imię i nazwisko,Miejscowość,Kwota\nOchotnicza Straż Pożarna,Zalesie,10000',
    'Imię i nazwisko;Adres\nOchotnicza Straż Pożarna;Zalesie 12',
    'Imię;Data imienin\nAnna;26 lipca',
    'Imię,Liczba nadań\nZofia,1234',
    '| Imię | Liczba nadań w 2023 |\n|------|------|\n| Zofia | 4512 |',
    'Imię,Płeć,Pochodzenie\nJan,M,hebrajskie',
  ]);
});
test('b7 regresje: miejscownik po „zam. w" — kraje, góry i placówki to nie miejscowość', () => {
  masked([
    ['Jan Kowalski, zam. w Kraśniku, ul. Lipowa 5', `${N}, zam. w ${C}, ${A}`],
    ['Jan Kowalski, zam. w Kozienicach.', `${N}, zam. w ${C}.`],
  ]);
  keep([
    'Zam. w Tatrach.',
    'Zamieszkały w Iranie.',
    'Zam. w Klasztorze.',
    'zam. w Libanie',
    'zamieszkały w Ekwadorze.',
    'Gmina Kobylnica, zam. w Budynku nr 5',
  ]);
  masked([['Jan Kowalski, zam. w Kazachstanie.', `${N}, zam. w Kazachstanie.`]]);
});
test('b7 regresje: kotwica pojazdowa w odmianie — kwota z kodem waluty i marka z rocznikiem to nie tablica', () => {
  masked([
    ['Kierujący autem WE 12345 zbiegł.', `Kierujący autem ${NR} zbiegł.`],
    ['Wykaz pojazdów: WE 12345, GD 2345A', `Wykaz pojazdów: ${NR}, ${NR}`],
    ['Właściciel samochodu WPI 2019 zgłosił kradzież.', `Właściciel samochodu ${NR} zgłosił kradzież.`],
  ]);
  keep([
    'Wartość samochodów wynosi PLN 45000.',
    'Leasing pojazdów: CHF 12000 miesięcznie.',
    'Liczba pojazdów: SZT 1200.',
    'Wartość samochodów to EUR 12000.',
    'Przetarg na dostawę samochodów KIA 2019.',
    'Liczba pojazdów: DAF 2018 - 3 szt.',
    'Dzierżawa przyczepą SAM 2012.',
    'Pojazdów marki MAN TGL 2012',
  ]);
});
test('b7 regresje: ulica z patronem — „im." i rok to nie adres, kod pocztowy i „zam." kotwiczą', () => {
  masked([
    ['Anna Nowak, zam. Jana Pawła II 14, 28-500 Busko', `${N}, zam. ${A}, ${KOD} ${C}`],
    ['Anna Nowak, zam. Jana Pawła II 14, Busko', `${N}, zam. ${A}, Busko`],
    ['Anna Nowak, zam. Jana Pawła II 14, Gdańsk', `${N}, zam. ${A}, ${C}`],
    ['Wypłata dla Jana Kowalskiego 2023, Warszawa', `Wypłata dla ${N} 2023, Warszawa`],
  ]);
  keep([
    'Nagroda im. Jana Kochanowskiego 2023, Kraków',
    'Głosowanie w lokalu Szkoły Podstawowej im. Jana Pawła II 3, Kraków.',
    'Ośrodek Sportu im. Kazimierza Górskiego 3, Słupsk',
  ]);
});
test('b7 regresje: „urodził(a) się" tylko o osobie', () => {
  masked([
    ['Jan Nowak urodził się 12 maja 1980 r. w Krakowie.', `${N} urodził się ${DU} r. w ${C}.`],
    ['Urodził się w Krakowie, a później przeprowadził się do Łodzi.', `Urodził się w ${C}, a później przeprowadził się do Łodzi.`],
    ['Wnioskodawczyni urodziła się w Radomiu.', `Wnioskodawczyni urodziła się w ${C}.`],
    ['Urodziłem się 12 maja 1980 r. w Krakowie.', `Urodziłem się ${DU} r. w ${C}.`],
  ]);
  keep([
    'W 2023 r. najwięcej dzieci urodziło się w Krakowie.',
    'Pomysł urodził się 12 maja 2020 r. podczas spotkania.',
    'Projekt urodził się w Krakowie.',
    'Idea urodziła się w Gdańsku.',
    'Festiwal urodził się w Opolu w 1963 r.',
    'Cielę urodziło się 3.04.2025.',
    'Patron szkoły Jan Paweł II urodził się 18 maja 1920 r. w Wadowicach.',
  ]);
  masked([['Mikołaj Kopernik urodził się 19 lutego 1473 r. w Toruniu.', `${N} urodził się 19 lutego 1473 r. w Toruniu.`]]);
});
test('b7 regresje: postacie literackie z odmianą zdrobnień i bez ogonków to nie osoba', () => {
  keep([
    'Przygody Tomka Sawyera to klasyka.',
    'Przygody Kubusia Puchatka to klasyka.',
    'Kubus Puchatek i przyjaciele',
    'Kubuś Puchatek i przyjaciele',
    'W pustyni i w puszczy: Staś Tarkowski i Nel.',
    'Pan Wołodyjowski to lektura.',
    'PAN WOŁODYJOWSKI',
  ]);
  masked([
    ['Przygody Tomka Nowaka to sprawa sądowa.', `Przygody ${N} to sprawa sądowa.`],
    ['Świadek Stanisław Tarkowski zeznał.', `Świadek ${N} zeznał.`],
    ['Pozwany Michał Anioł nie stawił się.', `Pozwany ${N} nie stawił się.`],
    ['Wnioskodawca: Staś Tarkowski', `Wnioskodawca: ${N}`],
    ['Tomek Sawyer, PESEL 80010112345', `${N}, PESEL [PESEL]`],
    ['Pozwany Tomek Sawyer nie stawił się.', `Pozwany ${N} nie stawił się.`],
  ]);
});
test('b7 regresje: wiersz z obcym imieniem spoza słownika dalej maskuje adres i dokument', () => {
  masked([
    ['Imię i nazwisko;Adres;Telefon\nLiu Wei;Lipowa 5;501 234 567', 'Imię i nazwisko;Adres;Telefon\nLiu Wei;[ADRES];[TELEFON]'],
    ['Nazwisko;Imię;Nr dowodu\nSmith;John;ABC123456', 'Nazwisko;Imię;Nr dowodu\nSmith;John;[NR-DOWODU]'],
  ]);
  keep(['Imię i nazwisko,Miasto\nZielona Góra Sp. z o.o.,Zielona Góra']);
});
test('b7 regresje: strażniki tablicy i „urodził się" nie odsłaniają prawdziwych danych', () => {
  masked([
    ['Kierujący autem WPI 2019 zbiegł.', `Kierujący autem ${NR} zbiegł.`],
    ['Holowanie przyczepą WPI 2019.', `Holowanie przyczepą ${NR}.`],
    ['Wykaz pojazdów: WPI 2019, WE 12345', `Wykaz pojazdów: ${NR}, ${NR}`],
    ['Kowalski urodził się 12 maja 1980 r. w Radomiu.', `${N} urodził się ${DU} r. w ${C}.`],
    ['Dziecko urodziło się 12.03.2020 r. w Radomiu.', `Dziecko urodziło się ${DU} r. w ${C}.`],
    ['Wnuczka urodziła się 12.03.2010 w Radomiu.', `Wnuczka urodziła się ${DU} w ${C}.`],
    ['Bliźnięta urodziły się 12.03.2020 r.', `Bliźnięta urodziły się ${DU} r.`],
    ['Królikowski urodził się 12.03.1980 w Radomiu.', `${N} urodził się ${DU} w ${C}.`],
  ]);
});
test('b7 regresje r2: „urodził się" w pouczeniu, przykładzie, biogramie władcy i przy organizacji to nie dane osoby', () => {
  keep([
    'Jan Paweł II urodził się 18 maja 1920 r. w Wadowicach.',
    'Jeżeli dziecko urodziło się 1 czerwca 2026 r., wniosek należy złożyć w ciągu 3 miesięcy.',
    'Przykład: dziecko urodziło się 10 marca 2026 r.',
    'Przykład: ubezpieczony urodził się 1 lipca 1958 r.',
    'Solidarność urodziła się 31 sierpnia 1980 r. w Gdańsku.',
    'NSZZ Solidarność urodził się 31 sierpnia 1980 r. w Gdańsku',
    'Znany aktor urodził się w Radomiu w 1950 r.',
  ]);
  masked([
    ['Osoba, która urodziła się w Kielcach, a mieszka w Radomiu, składa wniosek.', `Osoba, która urodziła się w Kielcach, a mieszka w ${C}, składa wniosek.`],
    ['Kardynał Stefan Wyszyński urodził się 3 sierpnia 1901 r.', `Kardynał ${N} urodził się 3 sierpnia 1901 r.`],
    // pułapki: osoba z imienia i nazwiska oraz podmiot rolowy bez przykładu dalej dostają maskę daty
    ['Jan Kowalski urodził się 5 maja 1980 r. w Radomiu.', `${N} urodził się ${DU} r. w ${C}.`],
    ['Wnioskodawca urodził się 5 maja 1980 r. w Radomiu.', `Wnioskodawca urodził się ${DU} r. w ${C}.`],
    ['Dziecko urodziło się 12.03.2020 r. w Radomiu.', `Dziecko urodziło się ${DU} r. w ${C}.`],
  ]);
});
test('b7 regresje r2: tablica z rocznikiem po kotwicy pojazdowej — skrót, kod silnika, typ pojazdu, „r."', () => {
  keep([
    'Autem PKP 2024 nie pojedziesz.',
    'Autem TDI 2008.',
    'Autem LPG 2010 dojechano.',
    'Wyjechał autem CNG 2018.',
    'Autem TIR 2015.',
    'Autem OSP 2012 wyjeżdża straż.',
    'Autem SUV 2020 jeździ wójt.',
    'Przyczepą TPV 2019.',
    'Wykaz pojazdów: GBA 2010.',
    'Zakup pojazdów: GBA 2023 r.',
    'Autem PKS 2019 r. dojedzie 30 osób.',
  ]);
  masked([
    ['Kierujący autem WPI 2019 zbiegł.', `Kierujący autem ${NR} zbiegł.`],
    ['Wykaz pojazdów: WPI 2019, WE 12345', `Wykaz pojazdów: ${NR}, ${NR}`],
    ['Autem WE 6789P odjechał.', `Autem ${NR} odjechał.`],
  ]);
});
test('b7 regresje r2: homograf po roli procesowej przed formą prawną to firma', () => {
  keep([
    'Powód Kruk S.A. z siedzibą we Wrocławiu wniósł pozew.',
    'Pełnomocnik powoda Kruka S.A.',
    'Pozwana Sowa Ubezpieczenia S.A.',
    'Pozwany Wilk Sp. z o.o.',
    'Pozwana Wrona i Wspólnicy Sp. k.',
    'Powód Lis Logistics Sp. z o.o.',
    'Powód Zając Transport sp. j.',
    'Pełnomocnik powoda Kruk Towarzystwo Funduszy Inwestycyjnych S.A.',
  ]);
  masked([
    ['Powód Kruk wniósł pozew.', `Powód ${N} wniósł pozew.`],
    ['Pozwany Wilk nie stawił się.', `Pozwany ${N} nie stawił się.`],
  ]);
});
test('b7 regresje r2: miejscownik po „zam. w" — państwo, kraina i koszary to nie miejscowość', () => {
  keep(['Cudzoziemiec zam. w Sudanie.', 'Wcześniej zamieszkały w Palestynie.', 'zamieszkała w Donbasie', 'Cudzoziemka zam. w Jemenie, ubiega się o ochronę.']);
  masked([
    ['Jan Kowalski, zam. w Kurpiach.', `${N}, zam. w Kurpiach.`],
    ['Jan Kowalski, zam. w Ponidziu.', `${N}, zam. w Ponidziu.`],
    ['Jan Kowalski, zam. w Koszarach.', `${N}, zam. w Koszarach.`],
    ['Jan Kowalski, zam. w Zalesiu.', `${N}, zam. w ${C}.`],
    ['Jan Kowalski, zam. w Świdniku, zeznaje.', `${N}, zam. w ${C}, zeznaje.`],
  ]);
});
test('b7 regresje r2: imię i nazwisko WERSALIKAMI postaci historycznej w zapisie mieszanym', () => {
  keep(['Józef PIŁSUDSKI.', 'Lektura: Henryk SIENKIEWICZ, Adam MICKIEWICZ, Stefan ŻEROMSKI, Maria KONOPNICKA', 'Jan MATEJKO', 'Kompozytorzy: Karol SZYMANOWSKI, Henryk WIENIAWSKI']);
  masked([
    ['Anna KOWALSKA', N],
    ['Pacjent: KOWALSKA Anna', `Pacjent: ${N}`],
  ]);
});
test('b7 regresje r2: atrybut XML z kluczem osobowym — ustawienie, etykieta i wypełniacz to nie osoba', () => {
  keep([
    '<Ustawienia imie="tak" nazwisko="tak"/>',
    '<Pola imie="wymagane" nazwisko="opcjonalne"/> <Sort nazwisko="rosnąco"/>',
    '<a nazwisko="true" imie="false"/> <a imie="string"/>',
    '<adresat imie="Imię" nazwisko="Nazwisko"/>',
    '<urzednik imie="Kierownik" nazwisko="Referatu"/> <adresat imie="Wójt" nazwisko="Gminy"/>',
    '<pracownik nazwisko="Wakat"/> <osoba imie="Brak" nazwisko="Danych"/> <osoba nazwisko="Anonim"/> <osoba nazwisko="Zastrzeżone"/>',
  ]);
  masked([
    ['<osoba imie="Jan" nazwisko="Kowalski"/>', `<osoba imie="${N}" nazwisko="${N}"/>`],
    ['<osoba nazwisko="Marszałek"/>', `<osoba nazwisko="${N}"/>`],
    ['<Osoba imie="Anna" nazwisko="Gzik" miasto="Kalisz"/>', `<Osoba imie="${N}" nazwisko="${N}" miasto="${C}"/>`],
  ]);
});
test('b7 regresje r2: wypełniacz w polu imienia, także rozstrzelony', () => {
  keep(['Imię i nazwisko: W A K A T', 'Nazwisko: D O   U Z U P E Ł N I E N I A', 'Imię i nazwisko: WAKAT', 'Nazwisko: Zastrzeżone']);
  masked([
    ['Imię i nazwisko: J A N   N O W A K', `Imię i nazwisko: ${N}`],
    ['Nazwisko: Wakatowski', `Nazwisko: ${N}`],
  ]);
});
test('b7 regresje r2: tabela — wiersz instytucji kościelnej i wiersz bez osoby', () => {
  keep(['Lp;Imię i nazwisko;Kwota\n1;Parafia św. Józefa;100\n2;Kościół św. Anny;50', 'Imię;Nazwisko;Miasto\nWakat;-;Warszawa\nSala;konferencyjna;Gdańsk']);
  masked([
    ['Lp;Imię i nazwisko;Kwota\n1;Parafia św. Józefa;100\n3;Jan Kowalski;20', `Lp;Imię i nazwisko;Kwota\n1;Parafia św. Józefa;100\n3;${N};20`],
    ['Imię;Nazwisko;Miasto\nJan;Kowalski;Kraków', `Imię;Nazwisko;Miasto\n${N};${N};${C}`],
    ['Lp.,Imię i nazwisko,Adres,Kwota\n3,Parafia Rzymskokatolicka pw. Św. Jana,Kościelna 1 Zalesie,0', `Lp.,Imię i nazwisko,Adres,Kwota\n3,${N} pw. Św. Jana,Kościelna 1 Zalesie,0`],
    ['Imię i nazwisko;Adres;Telefon\nLiu Wei;Lipowa 5;501 234 567', 'Imię i nazwisko;Adres;Telefon\nLiu Wei;[ADRES];[TELEFON]'],
  ]);
});
test('b7 regresje r2: odsyłacz formularza po etykiecie zamieszkania to nie adres', () => {
  keep(['Adres zamieszkania: Rubryka 7.', 'Adres zamieszkania: Strona 2.', 'Zamieszkała: Lat 5.', 'Adres zamieszkania: Tabela 3.', 'Adres zamieszkania: Wariant 2.']);
  masked([['Adres zamieszkania: Lipowa 7.', `Adres zamieszkania: ${A}.`]]);
});
test('b7 regresje r2: ulica z patronem i numerem po etykiecie, „przy" i osobie — bez kaplicy i urzędu', () => {
  masked([
    ['Adres: Jana Pawła II 5', `Adres: ${A}`],
    ['Jan Nowak zamieszkały przy Jana Pawła II 5.', `${N} zamieszkały przy ${A}.`],
    ['Strony: Anna Kowalska – Jana Pawła II 5.', `Strony: ${N} – ${A}.`],
    ['Strony: Anna Kowalska; Jana Pawła II 5; Zalesie.', `Strony: ${N}; ${A}; Zalesie.`],
    ['Właściciel: Jan Nowak (Jana Pawła II 5).', `Właściciel: ${N} (${A}).`],
    ['Adres: Kazimierza Wielkiego 5', `Adres: ${A}`],
    ['Adres: Władysława Jagiełły 5', `Adres: ${A}`],
    ['Jan Nowak zam. przy Kazimierza Wielkiego 5 w Zalesiu', `${N} zam. przy ${A} w Zalesiu`],
    ['Anna Kowalska – Kazimierza Wielkiego 12', `${N} – ${A}`],
    ['Jan Nowak, Jana Pawła II 5', `${N}, ${A}`],
  ]);
  keep([
    'Kaplica św. Jana Pawła II 2, Wadowice.',
    'Dokumenty należy składać w Urzędzie Gminy, Jana Pawła II 5, Kraków, pok. 12.',
    'Szkoła Podstawowa im. Jana Pawła II 3, Kraków',
  ]);
});
test('audyt końcowy r1: „dzwonić pod" bez „numer" to kotwica telefonu także przez łamanie wiersza', () => {
  masked([
    ['proszę dzwonić pod 512 345\n678 wieczorem', 'proszę dzwonić pod [TELEFON] wieczorem'],
    ['proszę dzwonić pod 512\n345 678', 'proszę dzwonić pod [TELEFON]'],
    ['zadzwoń na 22 123 45 67', 'zadzwoń na [TELEFON]'],
  ]);
  keep(['Dzwonił w sprawie faktury 512 345\n678.', 'Dzwonnica pod 512\n345 678']);
});
test('audyt końcowy r1: login będący zwykłym wyrazem nie rozlewa się na prozę', () => {
  masked([
    ['Login: mazur\nPodczas uroczystości orkiestra zagrała mazur.', 'Login: [LOGIN]\nPodczas uroczystości orkiestra zagrała mazur.'],
    [
      'Imię i nazwisko: Adam Wilk\nLogin AD: wilk\nUwaga: kamera nagrała, jak wilk przechodzi przez ogrodzenie.',
      `Imię i nazwisko: ${N}\nLogin AD: [LOGIN]\nUwaga: kamera nagrała, jak wilk przechodzi przez ogrodzenie.`,
    ],
    ['Login AD: zima\nW tym roku zima przyszła wcześnie.', 'Login AD: [LOGIN]\nW tym roku zima przyszła wcześnie.'],
    // uchwyt osoby i token z domeną nadal rozlewamy
    ['Login: jkowalski\nKonto jkowalski zablokowano.', 'Login: [LOGIN]\nKonto [LOGIN] zablokowano.'],
    ['Login: FIRMA\wilk\nKonto FIRMA\wilk i wilk w lesie.', 'Login: [LOGIN]\nKonto [LOGIN] i wilk w lesie.'],
    ['Login: kasia_n\nkasia_n zgłosiła awarię.', 'Login: [LOGIN]\n[LOGIN] zgłosiła awarię.'],
  ]);
});
test('audyt końcowy r1: patron z tytułem po „im." i „ul." to nie osoba z pisma', () => {
  keep([
    'Szpital Specjalistyczny im. dr. Wilka w Krakowie.',
    'Leczony w Szpitalu im. prof. Mazura w Bydgoszczy.',
    'Poradnia im. dr Sowy',
    'Centrum Onkologii im. prof. Lisa.',
    'Ośrodek im. prof. dr hab. Wilka.',
  ]);
  masked([['Pacjenta zbadał dr Wilk.', `Pacjenta zbadał dr ${N}.`]]);
  // patron nie dostaje pseudonimu pracownika o tym samym nazwisku
  const r = redactPII('Szpital im. dr. Wilka w Pucku. Ratownik Marek Wilk otrzymał premię.', { pseudonyms: true });
  expect(r.redacted).toBe('Szpital im. dr. Wilka w Pucku. Ratownik [OSOBA-A] otrzymał premię.');
});
test('audyt końcowy r1: patron z „Ks." wielką literą i z tytułem duchownym po głowie nazwy', () => {
  keep([
    'Budynek przy ul. Ks. Jerzego Popiełuszki.',
    'Szkoła im. Ks. Jerzego Popiełuszki w Mszczonowie.',
    'Rondo Ks. Jerzego Popiełuszki',
    'Budynek przy ul. Ks. Józefa Tischnera.',
    'ul. Gen. Józefa Bema',
    'Parafia pw. ks. Jerzego Popiełuszki.',
    'Radni dyskutowali o placu przy kościele pw. bł. ks. Jerzego Popiełuszki.',
    'Nazwanie skweru imieniem ks. Jerzego Popiełuszki.',
    'Muzeum ks. Jerzego Popiełuszki',
    'Sanktuarium bł. ks. Jerzego Popiełuszki',
    'Kult ks. Jerzego Popiełuszki rośnie.',
  ]);
  masked([
    ['Byłem u ks. Jerzego Kuźmy.', `Byłem u ks. ${N}.`],
    ['Na ul. Długiej Dr Jan Kowalski zasłabł.', `Na ul. Długiej Dr ${N} zasłabł.`],
    [
      'Proboszcz parafii pw. ks. Jerzego Popiełuszki ks. Jan Kowalski odprawił mszę.',
      `Proboszcz parafii pw. ks. Jerzego Popiełuszki ks. ${N} odprawił mszę.`,
    ],
  ]);
});
test('audyt końcowy r1: patron po „bł." w całości jawny, bez maski samego nazwiska', () => {
  keep([
    'Parafia pw. bł. Józefa Kowalskiego w Krakowie.',
    'Kościół bł. Jana Nowaka',
    'Relikwie bł. Józefa Kowalskiego przeniesiono.',
    'W kościele bł. Anny Kowalskiej odbyła się msza.',
  ]);
  masked([['Wczoraj bł. Jan Kowalski', `Wczoraj bł. ${N}`]]);
});
test('audyt końcowy r1: pole formularza w wierszu zachowuje przecinek przed następną etykietą', () => {
  masked([
    ['Ulica: Lipowa, Nr domu: 3, Nr lokalu: brak, Miejscowość: Lublin', `Ulica: ${A}, Nr domu: ${A}, Nr lokalu: brak, Miejscowość: ${C}`],
    ['Ulica: Lipowa; Nr domu: 3', `Ulica: ${A}; Nr domu: ${A}`],
    ['Ulica: Krótka Nr domu: 7 Miejscowość: Mysiadło', `Ulica: ${A} Nr domu: ${A} Miejscowość: ${C}`],
  ]);
});
test('audyt końcowy r1: odpowiedź w pustym polu miejscowości WERSALIKAMI to nie miasto', () => {
  masked([
    ['ADRES ZAMIESZKANIA: UL. POLNA 3, 31-616 BRAK', 'ADRES ZAMIESZKANIA: [ADRES], [KOD-POCZTOWY] BRAK'],
    ['ADRES ZAMIESZKANIA: UL. POLNA 3, 31-616 JAK WYŻEJ', 'ADRES ZAMIESZKANIA: [ADRES], [KOD-POCZTOWY] JAK WYŻEJ'],
    ['ADRES ZAMIESZKANIA: UL. POLNA 3, 31-616 ODDZIAŁ ZUS', 'ADRES ZAMIESZKANIA: [ADRES], [KOD-POCZTOWY] ODDZIAŁ ZUS'],
    ['ADRES ZAMIESZKANIA: UL. POLNA 3, 31-616 ZAMELDOWANY OD 2010', 'ADRES ZAMIESZKANIA: [ADRES], [KOD-POCZTOWY] ZAMELDOWANY OD 2010'],
    ['ADRES ZAMIESZKANIA: UL. POLNA 3, 31-616 KRAKÓW', `ADRES ZAMIESZKANIA: [ADRES], [KOD-POCZTOWY] ${C}`],
  ]);
});
test('audyt końcowy r1: etykieta jednostki po przeniesieniu nie sklei się z miastem', () => {
  masked([
    ['Adres: ul. Polna 3, 05-074 Halinów-\npowiat miński', `Adres: ${A}, [KOD-POCZTOWY] ${C}-\npowiat miński`],
    ['Kaczyn 12, 26-050 Zagnańsk-\ngmina Zagnańsk', `${A}, [KOD-POCZTOWY] ${C}-\ngmina Zagnańsk`],
    ['02-511 Warsza-\nwa', `[KOD-POCZTOWY] ${C}`],
  ]);
});
test('audyt końcowy r1: imię matki w dopełniaczu spoza słownika maskowane razem z imieniem ojca', () => {
  masked([
    ['Anna Nowak, córka Henryka i Marianny, PESEL 62093011114.', `${N}, córka [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO], PESEL [PESEL].`],
    ['Jan Kowalski, syn Władysława i Marianny, PESEL 62093011114.', `${N}, syn [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO], PESEL [PESEL].`],
  ]);
  keep(['Jezus, syn Józefa i Maryi, nauczał.']);
});
test('audyt końcowy r2: adres kończy się na kropce za numerem domu, liczba z następnego zdania go nie odsłania', () => {
  masked([
    ['Pani Kos mieszka przy ul. Polnej 3. Od 2 lat choruje.', `Pani ${N} mieszka przy ${A}. Od 2 lat choruje.`],
    ['Mieszka przy ul. Polnej 13. Ma 47 lat.', `Mieszka przy ${A}. Ma 47 lat.`],
    ['Zgłaszająca mieszka przy ul. Grochowskiej 17. Od 3 lat skarży się na hałas.', `Zgłaszająca mieszka przy ${A}. Od 3 lat skarży się na hałas.`],
    ['Zebranie odbyło się w świetlicy przy ul. Witosa 3. Obecnych 47 mieszkańców.', `Zebranie odbyło się w świetlicy przy ${A}. Obecnych 47 mieszkańców.`],
    ['Spotkanie odbyło się przy ul. Polnej 3. Trwało 2 godziny.', `Spotkanie odbyło się przy ${A}. Trwało 2 godziny.`],
    ['Adres: ul. Polna 3a. Ma 47 lat.', `Adres: ${A}. Ma 47 lat.`],
  ]);
  masked([['Mieszka przy ul. Polnej 3. Od 2 tygodni choruje.', 'Mieszka przy [ADRES]. Od 2 tygodni choruje.']], { pseudonyms: true });
  // liczebnik w tym samym zdaniu dalej nie jest numerem domu
  keep(['Wypadek przy ul. Długiej 5 osób rannych.']);
});
test('audyt końcowy r2: patron instytucji w wierszu nagłówka to nie adresat „Nazwisko Imię"', () => {
  keep([
    'Odbiorca: Szkoła Podstawowa nr 12 im. Jana Pawła II',
    'Do: Szkoła Podstawowa im. Jana Pawła II w Ostrołęce',
    'Odbiorca: Szkoła im. Jana Pawła Drugiego',
    'Nadawca: Szkoła im. Anny Marii II',
  ]);
  keep(['Odbiorca: Szkoła Podstawowa nr 12 im. Jana Pawła II'], { pseudonyms: true });
  masked([
    ['Do: Kowalski Jan', `Do: ${N}`],
    ['Do: Nowak Anna; Lis Jakub', `Do: ${N}; ${N}`],
    ['To: Szkoła im. Adama Mickiewicza; Kowalski Jan', `To: Szkoła im. Adama Mickiewicza; ${N}`],
  ]);
});
test('audyt końcowy r2: drugie imię rodzica w tej samej masce', () => {
  masked([
    ['Anna Lis, córka Piotra Pawła i Anny Marii, PESEL 78031412349', `${N}, córka ${N} i ${N}, PESEL [PESEL]`],
    ['Jan Nowak, syn Jana Pawła i Marii.', `${N}, syn ${N} i ${N}.`],
    ['Anna Lis, córka Piotra Pawła i Anny', `${N}, córka ${N} i ${N}`],
  ]);
  masked(
    [
      ['Anna Lis, córka Piotra Pawła i Anny Marii, PESEL 78031412349', '[OSOBA-A], córka [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO], PESEL [PESEL]'],
      ['Jan Nowak, syn Jana Pawła i Marii.', '[OSOBA-A], syn [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO].'],
    ],
    { pseudonyms: true },
  );
  // małżonkowie ze wspólnym nazwiskiem i para imion bez osoby przed nimi bez zmian
  masked([
    ['Anna i Jan Kowalscy', `${N} i ${N}`],
    ['Jan i Anna Maria', `${N} i ${N}`],
  ]);
});

// ── Regresje przed wydaniem (runda 1): wynik nie gorszy niż v0.46.22 ──
const P = { pseudonyms: true } as const;
const KW = '[NR-KW]';
test('fix1: para WERSALIKAMI po przyimku albo roli w dopełniaczu to osoba, nazwa z patronem zostaje', () => {
  const cases: [string, string, string][] = [
    ['01.10.2026 | PRZELEW WYCHODZĄCY TYTUŁ: ALIMENTY DLA ZUZANNY WOLSKIEJ | -800,00', `01.10.2026 | PRZELEW WYCHODZĄCY TYTUŁ: ALIMENTY DLA ${N} | -800,00`, '01.10.2026 | PRZELEW WYCHODZĄCY TYTUŁ: ALIMENTY DLA [OSOBA-A] | -800,00'],
    ['PRZELEW TYTUŁ: CZYNSZ ZA LOKAL OD ANNY KOWALSKIEJ', `PRZELEW TYTUŁ: CZYNSZ ZA LOKAL OD ${N}`, 'PRZELEW TYTUŁ: CZYNSZ ZA LOKAL OD [OSOBA-A]'],
    ['WYCIĄG DLA KRZYSZTOFA WOLSKIEGO', `WYCIĄG DLA ${N}`, 'WYCIĄG DLA [OSOBA-A]'],
    ['Tytuł: WYPŁATA DLA ANNY KOWALSKIEJ', `Tytuł: WYPŁATA DLA ${N}`, 'Tytuł: WYPŁATA DLA [OSOBA-A]'],
    ['KARTA PACJENTA ANNY KOWALSKIEJ', `KARTA PACJENTA ${N}`, 'KARTA PACJENTA [OSOBA-A]'],
    ['ŚWIADECTWO PRACY ADAMA NOWAKA', `ŚWIADECTWO PRACY ${N}`, 'ŚWIADECTWO PRACY [OSOBA-A]'],
    ['HISTORIA CHOROBY ANNY KOWALSKIEJ', `HISTORIA CHOROBY ${N}`, 'HISTORIA CHOROBY [OSOBA-A]'],
    ['PROTOKÓŁ PRZESŁUCHANIA JANA KOWALSKIEGO', `PROTOKÓŁ PRZESŁUCHANIA ${N}`, 'PROTOKÓŁ PRZESŁUCHANIA [OSOBA-A]'],
  ];
  masked(cases.map(([t, w]) => [t, w]));
  masked(cases.map(([t, , w]) => [t, w]), P);
  // pułapki: nazwa obiektu z patronem
  keep(['UNIWERSYTET ADAMA MICKIEWICZA', 'STADION KAZIMIERZA GÓRSKIEGO', 'KOPIEC JÓZEFA PIŁSUDSKIEGO', 'FUNDACJA JOLANTY KWAŚNIEWSKIEJ', 'ZESPÓŁ SZKÓŁ JANA KOWALSKIEGO']);
});
test('fix1: kilka pól „Etykieta: wartość" w wierszu rozdzielonym TAB-em — każde osobno', () => {
  masked([
    ['Imię: Jan\tNazwisko: Kowalski', `Imię: ${N}\tNazwisko: ${N}`],
    ['Imię ojca: Józef\tImię matki: Maria', `Imię ojca: ${N}\tImię matki: ${N}`],
    ['Imię: Jan\tUwagi: brak', `Imię: ${N}\tUwagi: brak`],
    [
      'Imię: Wiesław\tNazwisko: Grzelak\tPESEL: 71010198768\nImię ojca: Kazimierz\tImię matki: Danuta\tNazwisko rodowe matki: Lipa',
      `Imię: ${N}\tNazwisko: ${N}\tPESEL: [PESEL]\nImię ojca: ${N}\tImię matki: ${N}\tNazwisko rodowe matki: ${N}`,
    ],
  ]);
  masked([['Imię: Jan\tUwagi: brak', `Imię: ${N}\tUwagi: brak`]], P);
  // pole z nazwiskiem w trybie pseudonimów zostaje spójne z prozą
  masked([['Imię i nazwisko: Jan Kowalski\tLokal: 12\nPan Jan Kowalski wnosi.', 'Imię i nazwisko: [OSOBA-A]\tLokal: 12\nPan [OSOBA-A] wnosi.']], P);
  // pułapka: wiersz TSV z jedną etykietą to dane tabeli
  masked([['Nazwisko:\tGzowski\tKadry', `Nazwisko:\t${N}\tKadry`]]);
});
test('fix1: klucz pseudonimu z pola „Nazwisko i imię" to nazwisko, nie imię', () => {
  masked(
    [
      ['Nazwisko i imię;Uwagi\nDomański Witold;-\nLipińska Aleksandra;zastępuje ją Witold Domański', 'Nazwisko i imię;Uwagi\n[OSOBA-A];-\n[OSOBA-B];zastępuje ją [OSOBA-A]'],
      ['"Nazwisko i imię","Przełożony"\n"Domański Witold","-"\n"Lipińska Aleksandra","Domański Witold"', '"Nazwisko i imię","Przełożony"\n"[OSOBA-A]","-"\n"[OSOBA-B]","[OSOBA-A]"'],
      ['Nazwisko i imię;Okręg\nKowalski Jan;1\nNowak Jan;2', 'Nazwisko i imię;Okręg\n[OSOBA-A];1\n[OSOBA-B];2'],
      ['Nazwisko i imię;Okręg\nKowalski Jan;1\nradny Jan Kowalski', 'Nazwisko i imię;Okręg\n[OSOBA-A];1\nradny [OSOBA-A]'],
      ['Imię i nazwisko;Uwagi\nWitold Domański;-\nAleksandra Lipińska;zastępuje ją Witold Domański', 'Imię i nazwisko;Uwagi\n[OSOBA-A];-\n[OSOBA-B];zastępuje ją [OSOBA-A]'],
      ['Nazwisko i imię;Uwagi\nKowalska Anna Maria;-\nAnna Kowalska przyszła.', 'Nazwisko i imię;Uwagi\n[OSOBA-A];-\n[OSOBA-A] przyszła.'],
    ],
    P,
  );
});
test('fix1: tablica rejestracyjna — małe litery po „rejestracyjne", litera w numerze, kotwica pojedyncza z rokiem', () => {
  masked([
    ['tablice rejestracyjne wa 12345', 'tablice rejestracyjne [NR-REJESTRACYJNY]'],
    ['Pojazd o numerze rejestracji KR 5A123/2022', 'Pojazd o numerze rejestracji [NR-REJESTRACYJNY]/2022'],
    ['Sprawca uciekł samochodem WA 2015.', 'Sprawca uciekł samochodem [NR-REJESTRACYJNY].'],
    ['Sprawca uciekł motocyklem KR 1999.', 'Sprawca uciekł motocyklem [NR-REJESTRACYJNY].'],
  ]);
  keep([
    'tablice rejestracyjne to 12345 sztuk',
    'tablice rejestracyjne do 2025',
    'zarejestrowano pod numerem rejestracji RPW 12345/2026',
    'dla pojazdów PN 2020',
    'dyrektywa dotycząca pojazdu WE 2007 ustanawia ramy.',
  ]);
});
test('fix1: data urodzenia w życiorysie z „i później" zostaje maską, próg w przepisie jawny', () => {
  const D = '[DATA-URODZENIA]';
  masked([
    ['Jan Kowalski urodzony 14.03.1958 r. i później podlegał ubezpieczeniu.', `${N} urodzony ${D} r. i później podlegał ubezpieczeniu.`],
    ['Anna Nowak, urodzona 12.03.1960 r. i wcześniej ma ustalone prawo do renty', `${N}, urodzona ${D} r. i wcześniej ma ustalone prawo do renty`],
    ['Kowalski Jan, ur. 01.02.1950 i później należał do OFE', `${N}, ur. ${D} i później należał do OFE`],
    ['Anna Nowak, urodzona 12.03.1960 r. i później otrzymuje zasiłek', `${N}, urodzona ${D} r. i później otrzymuje zasiłek`],
  ]);
  keep([
    'Kobiecie urodzonej 1 stycznia 1953 r. lub później przysługuje',
    'Matce urodzonej 1 stycznia 1953 r. i później przysługuje dodatek',
    'Osoba urodzona 1.01.1960 r. lub później',
  ]);
});
test('fix1: kolejne pola spłaszczonego adresu — lokal i miasto, piętro jawne', () => {
  masked([
    ['Ulica: Długa 5 M.: 3', 'Ulica: [ADRES] M.: [ADRES]'],
    ['Ulica: Długa 5 Lokal: 5', 'Ulica: [ADRES] Lokal: [ADRES]'],
    ['Ulica: Długa 5 Mieszkanie: 4', 'Ulica: [ADRES] Mieszkanie: [ADRES]'],
    ['Ulica: Krótka 7. Piętro: 2', 'Ulica: [ADRES] Piętro: 2'],
    ['Ulica: Długa 5 Miasto: Warszawa', 'Ulica: [ADRES] Miasto: [MIEJSCOWOŚĆ]'],
    ['Ulica: Długa 5 Poczta: Opole', 'Ulica: [ADRES] Poczta: [MIEJSCOWOŚĆ]'],
  ]);
  masked([['Ulica: Kwiatowa 5 Imię i nazwisko: Jan Kowalski\nPan Jan Kowalski wnosi o zasiłek.', 'Ulica: [ADRES] Imię i nazwisko: [OSOBA-A]\nPan [OSOBA-A] wnosi o zasiłek.']], P);
  // pułapka: samodzielne etykiety to nie kotwica
  keep(['Miasto: Warszawa', 'Lokal: 5']);
});
test('fix1: obce imię za nazwiskiem po tytule należy do maski, marka zostaje', () => {
  masked([
    ['Pan Nowak Bjørn zgłosił się.', `Pan ${N} zgłosił się.`],
    ['Pani Nowak Ayşe przyjęta na oddział.', `Pani ${N} przyjęta na oddział.`],
    ['Pan Kaczmarek Thắng przyjęty.', `Pan ${N} przyjęty.`],
    ['Kierowca Pan Jan Kowalski Škoda zgłosił się', `Kierowca Pan ${N} Škoda zgłosił się`],
  ]);
  masked([['Pan Nowak Bjørn zgłosił się. Pan Nowak wrócił.', 'Pan [OSOBA-A] zgłosił się. Pan [OSOBA-A] wrócił.']], P);
});
test('fix1: drugi adres w wyliczeniu — pomieszczenie jawne, biernik ulicy po „na ul." maskowany', () => {
  masked([
    ['Najemca użytkuje lokal przy ul. Długiej 5 oraz Kościuszki 3.', 'Najemca użytkuje lokal przy [ADRES] oraz [ADRES].'],
    ['Ekipa przejdzie na ul. Słoneczną 2 i Kwiatową 14.', 'Ekipa przejdzie na [ADRES] i [ADRES].'],
    ['Ekipa przejdzie na ul. Długą 5 i Krótką 3.', 'Ekipa przejdzie na [ADRES] i [ADRES].'],
  ]);
  for (const r of ['Piwnicy 3', 'Szkoły 3', 'Przychodni 2', 'Apteki 4', 'Kamienicy 2', 'Hurtowni 1'])
    masked([[`Najemca użytkuje lokal przy ul. Długiej 5 oraz ${r}.`, `Najemca użytkuje lokal przy [ADRES] oraz ${r}.`]]);
  masked([['Spotkanie z ul. Długą 5 i Salą 3.', 'Spotkanie z [ADRES] i Salą 3.']]);
});
test('fix1: wartość pola osoby — otczestwo, samo nazwisko, szyk paszportowy, homograf za obcym imieniem', () => {
  for (const t of [
    'Imię i nazwisko pacjenta: Nodira Karimovna Yusupova',
    'Imię i nazwisko pacjentki: Gulnara Iwanowna Sadykowa',
    'Nazwisko pacjenta: Iwanowa',
    'Nazwisko ucznia: Wieczna',
    'Nazwisko i imię pracownika: WANG Xiaoming',
    'Imię i nazwisko pracownika: Thi Lan HO',
    'Nazwisko i imię pracownika: DOAN Van Hung',
    'Imię i nazwisko pracownika: Jisoo Park',
    'Imię i nazwisko pacjenta: Minho Park',
    'Imię i nazwisko pacjenta: Bożydar Rada',
  ])
    masked([[t, `${t.slice(0, t.indexOf(':') + 1)} ${N}`]]);
  keep([
    'Nazwisko i imię pracownika: PGE Dystrybucja S.A.',
    'Imię i nazwisko pacjenta: ZUS Oddział Siedlce',
    'Nazwisko i imię pracownika: BGK Nieruchomości',
    'Imię i nazwisko pacjenta: Wodny Park',
    'Imię i nazwisko pacjenta: Miejska Rada',
    'Nazwisko pacjenta: Wspólnota Mieszkaniowa',
    'Imię i nazwisko ucznia:\nGrupa Wiekowa',
  ]);
});
test('fix1: nazwisko panieńskie-homograf albo przed wyrazem pospolitym maskowane, ciąg nazwy domu jawny', () => {
  masked([
    ['Anna Nowak z domu Mazur Wdowa po Janie.', `${N} z domu ${N} Wdowa po Janie.`],
    ['Anna Kos z domu Wrona Telefon 601 234 567', `${N} z domu ${N} Telefon [TELEFON]`],
    ['Anna Nowak z domu Sowa Zamężna', `${N} z domu ${N} Zamężna`],
    ['Anna Nowak z domu Kot Nauczycielka', `${N} z domu ${N} Nauczycielka`],
    ['Pacjentka Anna Kowalska z domu Pstrąg Emerytka, lat 72.', `Pacjentka ${N} z domu ${N} Emerytka, lat 72.`],
    ['Anna Kowalska z d. Bździuch Szpital Wojewódzki w Radomiu', `${N} z d. ${N} Szpital Wojewódzki w Radomiu`],
    ['Anna Kowalska z d. Ćwiertnia Lekarz rodzinny', `${N} z d. ${N} Lekarz rodzinny`],
  ]);
  masked([
    ['Jan Nowak z domu Ronalda McDonalda', `${N} z domu Ronalda McDonalda`],
    ['Jan Nowak z domu Wczasów Dziecięcych', `${N} z domu Wczasów Dziecięcych`],
    ['Anna Kowalska z domu Sue Ryder', `${N} z domu Sue Ryder`],
    ['Anna Kowalska z domu Aniołów Stróżów', `${N} z domu Aniołów Stróżów`],
  ]);
});
test('fix1: wielowyrazowa miejscowość WERSALIKAMI po kodzie w całości', () => {
  for (const c of ['STARY TARG', 'STAROGARD GDAŃSKI', 'LIDZBARK WARMIŃSKI', 'STARA KAMIENICA', 'WÓLKA KOSOWSKA'])
    masked([[`UL. POLNA 5, 34-400 ${c}`, '[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]']]);
  masked([
    ['UL. POLNA 5, 26-900 GŁOWACZÓW KOWALSKI JAN', `[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ] ${N}`],
    ['UL. POLNA 5, 26-900 OPATÓW POWIAT OPATOWSKI', '[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ] POWIAT OPATOWSKI'],
    ['UL. POLNA 5, 26-900 STARA WIEŚ\tOBRĘB 0007', '[ADRES], [KOD-POCZTOWY] [MIEJSCOWOŚĆ]\tOBRĘB 0007'],
  ]);
});
test('fix1: „urodzonym" po przyimku i rzeczowniku w liczbie pojedynczej to osoba', () => {
  masked([
    ['Opinia o pracowniku zatrudnionym urodzonym 05.06.1975 r. w Radomiu.', 'Opinia o pracowniku zatrudnionym urodzonym [DATA-URODZENIA] r. w [MIEJSCOWOŚĆ].'],
    ['Informacja o pacjencie hospitalizowanym urodzonym 05.06.1948 r.', 'Informacja o pacjencie hospitalizowanym urodzonym [DATA-URODZENIA] r.'],
    ['Opieka nad synem Kubą przysposobionym urodzonym 12.02.2015 r.', 'Opieka nad synem Kubą przysposobionym urodzonym [DATA-URODZENIA] r.'],
  ]);
  keep(['Emerytura przysługuje ubezpieczonym urodzonym 1 stycznia 1949 r.']);
});
test('fix1: obiekt z przymiotnikiem i podmiotem w szyku odwróconym to nazwa, nie osoba', () => {
  keep(['Las Bielański odwiedził w sobotę wojewoda.', 'Zamek Grodziecki kupił w 2020 r. inwestor.', 'Las Kabacki odwiedził wojewoda.']);
  masked([['Pokój Lisiecki opuścił o 10:00.', `Pokój ${N} opuścił o 10:00.`]]);
});
test('fix1: osoba z pola loginu WERSALIKAMI — rozlewane samo nazwisko, nie imię ani homonim', () => {
  masked([
    ['Login: ANNA PIĄTEK\nZEBRANIE W PIĄTEK O 17:00', `Login: ${N}\nZEBRANIE W PIĄTEK O 17:00`],
    ['User name: ADAM LIPIEC\nTermin: LIPIEC 2025', `User name: ${N}\nTermin: LIPIEC 2025`],
    ['User: KAROL MAJ\nDATA: 12 MAJ 2026', `User: ${N}\nDATA: 12 MAJ 2026`],
    ['User: ROBERT KOWAL\nZawód: KOWAL', `User: ${N}\nZawód: KOWAL`],
    ['Login: MAREK ZIMA\nOKRES: ZIMA 2026', `Login: ${N}\nOKRES: ZIMA 2026`],
    ['Login: JAN KOWALSKI\nPARAFIA: ŚW. JAN\nKOWALSKI', `Login: ${N}\nPARAFIA: ŚW. JAN\n${N}`],
    ['Login: KOWALCZYK MAREK\nWNIOSKODAWCA KOWALCZYK ZGŁOSIŁ AWARIĘ', `Login: ${N}\nWNIOSKODAWCA ${N} ZGŁOSIŁ AWARIĘ`],
    ['Wydruk z systemu EWOPIS\nLogin: MAJ ANNA\nHARMONOGRAM ODBIORU ODPADÓW\nMAJ 2025\nCZERWIEC 2025', `Wydruk z systemu EWOPIS\nLogin: ${N}\nHARMONOGRAM ODBIORU ODPADÓW\nMAJ 2025\nCZERWIEC 2025`],
    ['User name: ZIELINSKA KATARZYNA\nZIELINSKA', `User name: ${N}\n${N}`],
  ]);
  masked([['Login: KOWALCZYK MAREK\nWNIOSKODAWCA KOWALCZYK ZGŁOSIŁ AWARIĘ', 'Login: [OSOBA-A]\nWNIOSKODAWCA [OSOBA-A] ZGŁOSIŁ AWARIĘ']], P);
  keep(['Login: GMINA LUBIEŃ\n§ 1. LUBIEŃ']);
});
test('fix1: konta działów i ról w ścieżce profilu zostają jawne', () => {
  keep([
    'Zapisz w C:\\Users\\geodezja\\Pulpit   |   Skany z C:\\Users\\swietlica i C:\\Users\\uczniowie   |   Folder \\\\fs01\\home$\\mops\\skany',
    'Pliki działu: C:\\Users\\geodezja\\Desktop\nPliki: C:\\Users\\nauczyciele\\Desktop i C:\\Users\\sekretarka\\Pulpit',
    'Skany zapisuj w C:\\Users\\gops\\Desktop\\wnioski oraz \\\\srv\\users$\\podatki\\2025',
  ]);
  masked([['C:\\Users\\jkowalski\\Desktop', 'C:\\Users\\[LOGIN]\\Desktop']]);
});
test('fix1: imię z końca wiersza nie skleja się z prefiksem mówcy w następnym', () => {
  masked([
    ['Malgorzata Wozniak: czesc, tu Gosia\nPawel Krol: siema', `${N}: czesc, tu Gosia\n${N}: siema`],
    ['Ewa Nowak: hej, tu Gosia\nAnna Lis: siema', `${N}: hej, tu Gosia\n${N}: siema`],
    ['Pozdrawiam\nAnna\nJan Kowalski: ok', `Pozdrawiam\nAnna\n${N}: ok`],
    ['Jan\nWiśniewski', N],
  ]);
});
test('fix1: tabela z nagłówkiem — proza pod tabelą, wiersz biura, podmiot państwowy i papież jawne', () => {
  masked([
    ['Imię;Nazwisko\nAnna;Kowal\nWyjazd w maju; szczegóły wkrótce', `Imię;Nazwisko\n${N};${N}\nWyjazd w maju; szczegóły wkrótce`],
    ['Imię;Nazwisko\nAnna;Kowal\nSilny mróz; zajęcia odwołane', `Imię;Nazwisko\n${N};${N}\nSilny mróz; zajęcia odwołane`],
    ['Imię\tNazwisko\nAnna\tKowal\nSpotkanie w maju\tobecność obowiązkowa', `Imię\tNazwisko\n${N}\t${N}\nSpotkanie w maju\tobecność obowiązkowa`],
    ['imie;nazwisko\nanna;kowalska', `imie;nazwisko\n${N};${N}`],
    ['Imię i nazwisko;Stanowisko;Telefon\nJan Kowalski;-;601 234 567', `Imię i nazwisko;Stanowisko;Telefon\n${N};-;[TELEFON]`],
    ['Nazwisko i imię;Uwagi\nNowak z d. Kowalska Anna;-', `Nazwisko i imię;Uwagi\n${N} z d. ${N};-`],
  ]);
  keep([
    'Imię i nazwisko;Stanowisko;Telefon\nSekretariat Wójta;-;41 378 00 10\nCentrala;-;41 378 00 00',
    'Imię i nazwisko;Miejscowość;Telefon\nDyżur radnych w Urzędzie;Zalesie;41 378 00 10',
    'Imię i nazwisko,Funkcja\nJan Paweł II,Patron',
    '<strona nazwisko="Skarb Państwa"/>',
    '<strona fullName="Lasy Państwowe" typ="X"/>',
  ]);
});
test('fix1: atrybuty XML tagu instytucji jawne, adres pod osobą maskowany', () => {
  keep([
    '<Urzad nazwa="Urząd Skarbowy" ulica="Postępu 16" miasto="Warszawa" telefon="22 278 90 00"/>',
    '<szkola patron="Jan Paweł II" miasto="Kraków"/>',
    '<Sad nazwa="Sąd Rejonowy w Kaliszu" miasto="Kalisz"/>',
  ]);
  masked([['<Osoba imie="Jan" nazwisko="Kowalski"><Adres ulica="Długa 5" miasto="Kraków"/></Osoba>', `<Osoba imie="${N}" nazwisko="${N}"><Adres ulica="[ADRES]" miasto="[MIEJSCOWOŚĆ]"/></Osoba>`]]);
});
test('fix1: ulica z patronem — tytuł, trzy człony, łącznik, „przy" po etykiecie zamieszkania', () => {
  masked([
    ['Adres: Marii Skłodowskiej-Curie 5', 'Adres: [ADRES]'],
    ['Jan Kowalski zamieszkały przy Kardynała Stefana Wyszyńskiego 12', `${N} zamieszkały przy [ADRES]`],
    ['Jan Kowalski – Stanisława Ignacego Witkiewicza 5', `${N} – [ADRES]`],
    ['Jan Kowalski, Stanisława Ignacego Witkiewicza 5, Busko-Zdrój', `${N}, [ADRES], [MIEJSCOWOŚĆ]`],
    ['Adres: Marszałka Józefa Piłsudskiego 5', 'Adres: [ADRES]'],
    ['Lokal położony przy Kazimierza Wielkiego 12 w Krakowie.', 'Lokal położony przy [ADRES] w [MIEJSCOWOŚĆ].'],
    ['Panią Stefanią Nowak, zamieszkałą przy Jana Pawła II 12 w Krakowie.', `Panią ${N}, zamieszkałą przy [ADRES] w [MIEJSCOWOŚĆ].`],
    ['Pozwana zamieszkuje przy Tadeusza Kościuszki 5 w Kielcach.', 'Pozwana zamieszkuje przy [ADRES] w [MIEJSCOWOŚĆ].'],
    ['Anna Kowalska Jana Pawła II 5', `${N} [ADRES]`],
  ]);
  keep(['Urząd Gminy przy Jana Pawła II 5 w Kielcach']);
});
test('fix1: urodzenie w regule, pouczeniu i biogramie patrona jawne, strona decyzji nie', () => {
  keep([
    'Uczeń, który urodził się 1 września 2019 r., zostaje przyjęty.',
    'Senior, który urodził się 1 stycznia 1946 r., otrzyma Złotą Kartę.',
    'Pouczenie: kto urodził się w Opolu, składa wniosek do USC w Opolu.',
  ]);
  masked([
    ['Patronka szkoły. Irena Sendlerowa urodziła się 15 lutego 1910 r. w Warszawie.', `Patronka szkoły. ${N} urodziła się 15 lutego 1910 r. w Warszawie.`],
    ['Maria Skłodowska-Curie urodziła się w Warszawie w 1867 r.', `${N} urodziła się w Warszawie w 1867 r.`],
    ['Wnioskodawca, który urodził się 1 stycznia 1946 r. w Kielcach, wnosi o', 'Wnioskodawca, który urodził się [DATA-URODZENIA] r. w [MIEJSCOWOŚĆ], wnosi o'],
    ['Patron: Jan Kowalski\nJan Kowalski urodził się 3 maja 1971 r. w Kielcach.', `Patron: ${N}\n${N} urodził się [DATA-URODZENIA] r. w [MIEJSCOWOŚĆ].`],
  ]);
});
test('fix1: para z liczbą i rzeczownikiem albo udziałem to osoba, nie ulica', () => {
  masked([
    ['Głosowało na Tomasza Mazura 12 radnych.', `Głosowało na ${N} 12 radnych.`],
    ['Głosowało na Adama Barana 12 radnych.', `Głosowało na ${N} 12 radnych.`],
    ['Udział Marii Lis 1/4 w nieruchomości.', `Udział ${N} 1/4 w nieruchomości.`],
    ['Udział Ewy Sowy 2/3.', `Udział ${N} 2/3.`],
    ['Przyznano Piotrowi Kosowi 18 punktów.', `Przyznano ${N} 18 punktów.`],
    ['Przyznano Marii Lis 2 tygodnie urlopu.', `Przyznano ${N} 2 tygodnie urlopu.`],
    ['Ignacego Łukasiewicza 5, Kraków', '[ADRES], [MIEJSCOWOŚĆ]'],
  ]);
});
test('fix1: homograf-nazwisko z formą prawną albo „z siedzibą" to firma; święty bez ogonków; odsyłacz po etykiecie adresu', () => {
  keep([
    'Powód Kruk SA z siedzibą we Wrocławiu wniósł pozew o zapłatę.',
    'Pozwany Wilk Trans wniósł sprzeciw.',
    'Powód Kruk z siedzibą we Wrocławiu',
    'Kosciol Swietego Michala Archaniola w Krakowie.',
    'Sw. Lukasz Ewangelista.',
    'Swiety Michal Archaniol.',
    'Adres zamieszkania: Paragraf 2.',
    'Adres zamieszkania: Karta 15.',
    'Adres zamieszkania: Tom 2.',
  ]);
  masked([
    ['Powód Kowalski z siedzibą we Wrocławiu', `Powód ${N} z siedzibą we Wrocławiu`],
    ['Adres zamieszkania: Kartuska 5.', 'Adres zamieszkania: [ADRES].'],
  ]);
});
test('fix1: numer KW — kotwica przez łamanie wiersza tylko jako etykieta, wyliczenie tylko z kotwicy i na znany sąd', () => {
  keep([
    'Załączniki do KW\nZP1A/12345678/0 – kod produktu',
    'agregat;20;KW\nZZ9Z/20261024/1;sprawny',
    'Pismo przekazano do KW.\nZZ9Z/20261024/1 - nr przesyłki.',
    '| Rejestr | KW |\n| Id | ZZ9Z/20261024/1 |',
    'Pompa ciepła, nr seryjny PO1A/20261015/0.',
    'Faktura nr PL1A/12345678/0 z 12.10.2026.',
    'FV PO1A/20261015/0',
    'Nr umowy: KA1F/00001234/3',
  ]);
  masked([
    ['KW nr KR1P/00234567/6, FV1A/12345678/9', `KW nr ${KW}, FV1A/12345678/9`],
    ['KR1P/00234567/6;ZZ9Z/20261024/1;OK', `${KW};ZZ9Z/20261024/1;OK`],
    ['Nr KW: KR1P/00234567/6\nZZ9Z/20261024/1 – nr zlecenia', `Nr KW: ${KW}\nZZ9Z/20261024/1 – nr zlecenia`],
    ['WA1M/00512345/6 i AB1C/12345678/5 szt.', `${KW} i AB1C/12345678/5 szt.`],
    ['Nr KW\nKR1P/00234567/6', `Nr KW\n${KW}`],
    ['umowa sprzedaży nieruchomości KR1P/00234567/6', `umowa sprzedaży nieruchomości ${KW}`],
    ['Przedmiot umowy: KR1P/00234567/6', `Przedmiot umowy: ${KW}`],
  ]);
});
test('fix2: udział i głos na końcu wiersza, celownik, ulica z patronem — tytuł, lokal, dalszy ciąg zdania', () => {
  masked([
    ['Udział Marii Lis 1/4', `Udział ${N} 1/4`],
    ['Spadek przypada Marii Lis 1/2', `Spadek przypada ${N} 1/2`],
    ['Udział Marii Lis 1/4\nUdział Jana Lisa 3/4', `Udział ${N} 1/4\nUdział ${N} 3/4`],
    ['Udział Marii Lis 1/4; Jana Lisa 3/4', `Udział ${N} 1/4; ${N} 3/4`],
    ['Udział Tomasza Mazura 1/3', `Udział ${N} 1/3`],
    ['Piotrowi Kosowi 18', `${N} 18`],
    ['Głosowało na Tomasza Mazura 12', `Głosowało na ${N} 12`],
    ['Na Tomasza Mazura 12\nNa Annę Nowak 3', `Na ${N} 12\nNa ${N} 3`],
    // fix3: sam ukośnik bez miejscowości wygląda jak udział czy ocena — osoba, nie adres
    ['Tomasza Mazura 12/3', `${N} 12/3`],
    ['Tomasza Mazura 12 m. 3', '[ADRES]'],
    ['Jerzego Waszyngtona 12/4', `${N} 12/4`],
    ['Wnioskodawca zamieszkały przy Jana Pawła II 14 zwrócił się o zezwolenie.', 'Wnioskodawca zamieszkały przy [ADRES] zwrócił się o zezwolenie.'],
    ['Wnioskodawczyni mieszka przy Jana Pawła II 14 od 2010 roku.', 'Wnioskodawczyni mieszka przy [ADRES] od 2010 roku.'],
    ['Mieszkańcy Jana Pawła II 5 zgłosili awarię.', 'Mieszkańcy [ADRES] zgłosili awarię.'],
    ['Do Pani Anny Lis, Marszałka Józefa Piłsudskiego 5 m. 3 w Kielcach.', `Do Pani ${N}, [ADRES] w [MIEJSCOWOŚĆ].`],
    ['Do Pana Jana Lisa, Generała Władysława Andersa 3 w Kielcach.', `Do Pana ${N}, [ADRES] w [MIEJSCOWOŚĆ].`],
    ['Pod adresem Marszałka Józefa Piłsudskiego 5 w Kielcach mieszka Jan Lis.', `Pod adresem [ADRES] w [MIEJSCOWOŚĆ] mieszka ${N}.`],
    // tytuł bez numeru domu to dalej osoba, nie adres
    ['Odznaczenie Generała Władysława Andersa.', `Odznaczenie Generała ${N}.`],
  ]);
  keep(['Urząd Gminy przy Jana Pawła II 5 informuje.', 'Szkoła Podstawowa przy Jana Pawła II 12 ogłasza nabór.']);
});
test('fix2: formularz z TAB-em — etykieta i wartość w osobnych komórkach, pseudonim samego nazwiska, wiersz danych pod nagłówkiem', () => {
  masked([
    ['Imię:\tAdam\tNazwisko:\tNowak', `Imię:\t${N}\tNazwisko:\t${N}`],
    ['Imię ucznia:\tAdam\tNazwisko ucznia:\tNowak', `Imię ucznia:\t${N}\tNazwisko ucznia:\t${N}`],
    ['Imię ojca:\tPiotr\tImię matki:\tEwa', `Imię ojca:\t${N}\tImię matki:\t${N}`],
    ['Imię:\tAnna\tNazwisko:\tNowak\tPESEL:\t71010198768', `Imię:\t${N}\tNazwisko:\t${N}\tPESEL:\t[PESEL]`],
    ['Nazwisko:\tMiejscowość:\nKowalski\tRadom', `Nazwisko:\tMiejscowość:\n${N}\tRadom`],
    // wiersz TSV z danymi i jedną etykietą zostaje bez podziału
    ['Nazwisko:\tGzowski\tKadry', `Nazwisko:\t${N}\tKadry`],
  ]);
  masked(
    [
      ['Imię: Jan\tNazwisko: Kowalski\nPan Jan Kowalski wnosi.', `Imię: ${N}\tNazwisko: [OSOBA-A]\nPan [OSOBA-A] wnosi.`],
      ['Nazwisko: Kowalski\tUwagi: brak\nPan Kowalski przyszedł.', 'Nazwisko: [OSOBA-A]\tUwagi: brak\nPan [OSOBA-A] przyszedł.'],
      ['Imię: Jan;\tNazwisko: Kowalski', 'Imię: Jan;\tNazwisko: [OSOBA-A]'],
      ['Imię:\tAdam\tNazwisko:\tNowak', `Imię:\t${N}\tNazwisko:\t[OSOBA-A]`],
    ],
    { pseudonyms: true },
  );
});
test('fix2: tabela z nagłówkiem — proza małymi literami i WERSALIKAMI, kalendarz, urząd w kolumnie osoby, klucz pseudonimu', () => {
  for (const p of [
    'wyjazd w maju; szczegóły wkrótce',
    'zebranie w piątek; obecność obowiązkowa',
    'silny mróz; zajęcia odwołane',
    'WYJAZD W MAJU; SZCZEGÓŁY WKRÓTCE',
    'Uwaga; wyjazd w maju',
    'Dzień Matki; maj',
  ])
    expect(redactPII(`Imię;Nazwisko\nAnna;Kowal\n${p}`).redacted, p).toBe(`Imię;Nazwisko\n${N};${N}\n${p}`);
  expect(redactPII('Imię\tNazwisko\nAnna\tKowal\nspotkanie w maju\tobecność obowiązkowa').redacted).toBe(
    `Imię\tNazwisko\n${N}\t${N}\nspotkanie w maju\tobecność obowiązkowa`,
  );
  keep(['Lp.;Imię i nazwisko;Adres;Podpis\n3;Sołtys;Lubień 1;', 'Lp.;Imię i nazwisko;Adres;Podpis\n8;Ławnik;Lubień 2;']);
  masked([
    ['Imię i nazwisko;Telefon\nSołtys;600100200', 'Imię i nazwisko;Telefon\nSołtys;[TELEFON]'],
    ['Imię i nazwisko;Telefon\nJan Sołtys;600100200', `Imię i nazwisko;Telefon\n${N};[TELEFON]`],
    ['Imię;Nazwisko\nanna;kowal', `Imię;Nazwisko\n${N};${N}`],
  ]);
  // klucz pseudonimu przy kolumnie „imię naprzód": nazwisko-homograf imienia, nie obce imię
  masked(
    [
      ['{"imieNazwisko": "Iryna Roman"}\n{"imieNazwisko": "Iryna Marek"}', '{"imieNazwisko": "[OSOBA-A]"}\n{"imieNazwisko": "[OSOBA-B]"}'],
      ['{"imieNazwisko": "Iryna Roman"}\nPani Roman podpisała.', '{"imieNazwisko": "[OSOBA-A]"}\nPani [OSOBA-A] podpisała.'],
      ['Imię i nazwisko;PESEL\nNodira Adam;71010198768\nNodira Marek;71010198768', 'Imię i nazwisko;PESEL\n[OSOBA-A];[PESEL]\n[OSOBA-B];[PESEL]'],
      ['{"imieNazwisko": "Kowalski Jan"}\nPan Kowalski', '{"imieNazwisko": "[OSOBA-A]"}\nPan [OSOBA-A]'],
    ],
    { pseudonyms: true },
  );
});
test('fix2: login WERSALIKAMI nie rozlewa się na ulicę ani nazwę klubu; konto-homograf nazwiska w ścieżce profilu', () => {
  masked([
    ['Login: ANNA ZIELIŃSKA\nUL. ZIELIŃSKA 5', `Login: ${N}\n[ADRES]`],
    ['Login: ANNA GÓRSKA\nUL. GÓRSKA 5', `Login: ${N}\n[ADRES]`],
    ['User: JAN GÓRSKI\nKLUB GÓRSKI', `User: ${N}\nKLUB GÓRSKI`],
    ['User: JAN KOWALCZYK\nWNIOSKODAWCA KOWALCZYK', `User: ${N}\nWNIOSKODAWCA ${N}`],
    ['Login: soltys\nC:\\Users\\soltys\\Desktop', 'Login: [LOGIN]\nC:\\Users\\[LOGIN]\\Desktop'],
    ['Login: wozny\nPliki w C:\\Users\\wozny\\Dokumenty', 'Login: [LOGIN]\nPliki w C:\\Users\\[LOGIN]\\Dokumenty'],
    ['Login: kasjer\nC:\\Users\\kasjer\\Desktop', 'Login: [LOGIN]\nC:\\Users\\[LOGIN]\\Desktop'],
    ['Login: opiekun\nC:\\Users\\opiekun\\Desktop', 'Login: [LOGIN]\nC:\\Users\\[LOGIN]\\Desktop'],
  ]);
});
test('fix2: imię i samo nazwisko złamane przez wiersz przed dwukropkiem to jedna osoba; mówca z pełną parą — nie', () => {
  masked([
    ['Świadek: Jan\nKowalski: nie stawił się', `Świadek: ${N}: nie stawił się`],
    ['Sporządziła: Anna\nNowak: główna księgowa', `Sporządziła: ${N}: główna księgowa`],
    ['Z poważaniem Marek\nZieliński: kierownik referatu', `Z poważaniem ${N}: kierownik referatu`],
    ['Barbara\nKowalska: hej', `${N}: hej`],
    // pełna para mówcy w następnym wierszu: imię z końca poprzedniego to inna osoba
    ['Pozdrawiam\nAnna\nJan Kowalski: ok', `Pozdrawiam\nAnna\n${N}: ok`],
    ['tu Gosia\nJan Kowalski: ok', `tu Gosia\n${N}: ok`],
  ]);
});
test('fix2: pole osoby — firma, bank i obiekt jawne; imię koreańskie, słowiańskie i szyk paszportowy maskowane', () => {
  keep([
    'Imię i nazwisko pracownika: Aqua Park',
    'Imię i nazwisko pracownika: Energy Park',
    'Imię i nazwisko pracownika: Business Park',
    'Imię i nazwisko pracownika: Millennium Bank',
    'Imię i nazwisko pracownika: Gospodyń Koło',
    'Imię i nazwisko pełnomocnika: Alior Bank',
    'Imię i nazwisko pełnomocnika: Santander Bank',
    'Imię i nazwisko wnioskodawcy: Hotel ABC',
    'Imię i nazwisko wnioskodawcy: BNP Paribas',
    'Imię i nazwisko wnioskodawcy: ERGO Hestia',
    'Imię i nazwisko wnioskodawcy: DHL Parcel',
    'Imię i nazwisko wnioskodawcy: AXA Ubezpieczenia',
    'Nazwisko dziecka: Wspólne',
    'Nazwisko małżonka: Dotychczasowe',
    'Nazwisko pacjenta: Utajnione',
    'Nazwisko dziecka: Ojcowskie',
    'Nazwisko dziecka: Matczyne',
  ]);
  masked([
    ['Imię i nazwisko pracownika: Jisoo Park', `Imię i nazwisko pracownika: ${N}`],
    ['Imię i nazwisko pacjenta: Seo-yeon Park', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko pacjenta: Bożydar Rada', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko pacjenta: WANG Xiaoming', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko pacjenta: Thi Lan HO', `Imię i nazwisko pacjenta: ${N}`],
    ['Imię i nazwisko pacjenta: DOAN Van Hung', `Imię i nazwisko pacjenta: ${N}`],
    ['Nazwisko pacjenta: Iwanowa', `Nazwisko pacjenta: ${N}`],
    ['Nazwisko ucznia: Wieczna', `Nazwisko ucznia: ${N}`],
  ]);
});
test('fix2: tablica przy pojeździe, wyróżnik od wielkiej litery i PT, przymiotnik typu pojazdu', () => {
  const R = '[NR-REJESTRACYJNY]';
  masked([
    ['Pojazd o numerze rejestracji KR 12345/2022', `Pojazd o numerze rejestracji ${R}/2022`],
    ['tablice rejestracyjne Wa 12345', `tablice rejestracyjne ${R}`],
    ['tablice rejestracyjne pt 12345', `tablice rejestracyjne ${R}`],
    ['Skradziono samochód osobowy WPI 2019 z parkingu.', `Skradziono samochód osobowy ${R} z parkingu.`],
    ['Sprawca odjechał samochodem ciężarowym KRA 2015.', `Sprawca odjechał samochodem ciężarowym ${R}.`],
    ['Pojazd dostawczy SBE 2020 zatrzymano.', `Pojazd dostawczy ${R} zatrzymano.`],
    ['Samochód osobowy SK 2018 skradziony.', `Samochód osobowy ${R} skradziony.`],
  ]);
  keep([
    'zarejestrowano pod numerem rejestracji RPW 12345/2026',
    'tablice rejestracyjne Do 2025',
    'tablice rejestracyjne to 12345 sztuk',
    'Samochody osobowe KIA 2019 zakupiono.',
    'dla pojazdów PN 2020',
  ]);
});
test('fix2: data urodzenia w życiorysie z „lub później", wersaliki przy przyimku i w aktach osoby, świadek „Sw."', () => {
  masked([
    ['Jan Kowalski urodzony 14.03.1958 r. lub później podlegał', `${N} urodzony [DATA-URODZENIA] r. lub później podlegał`],
    ['AKTA OSOBOWE ANNY KOWALSKIEJ', `AKTA OSOBOWE ${N}`],
    ['DOKUMENTACJA MEDYCZNA ANNY KOWALSKIEJ', `DOKUMENTACJA MEDYCZNA ${N}`],
    ['DANE OSOBOWE PIOTRA ZIELIŃSKIEGO', `DANE OSOBOWE ${N}`],
    ['TECZKA OSOBOWA EWY ZIELIŃSKIEJ', `TECZKA OSOBOWA ${N}`],
    ['WNIOSEK URLOPOWY JANA NOWAKA', `WNIOSEK URLOPOWY ${N}`],
    ['KARTA INFORMACYJNA PIOTRA NOWAKA', `KARTA INFORMACYJNA ${N}`],
    ['CZYNSZ OD ANNY KOWALSKIEJ', `CZYNSZ OD ${N}`],
    ['PRZELEW OD ANNY KOWALSKIEJ DO JANA NOWAKA', `PRZELEW OD ${N} DO ${N}`],
    ['Sw. Jan Apostol zeznal, ze widzial sprawce.', `Sw. ${N} zeznal, ze widzial sprawce.`],
    ['Sw. Adam Pustelnik zeznal.', `Sw. ${N} zeznal.`],
    ['Sw. Piotr Wyznawca zeznal.', `Sw. ${N} zeznal.`],
    ['Sw. Maria Meczennik.', `Sw. ${N}.`],
  ]);
  // ulica z patronem i numerem na kopercie to adres, nie jawny tekst (inwariant patrona z numerem)
  masked([['DO ADAMA MICKIEWICZA 5', 'DO [ADRES]']]);
  keep([
    'Kobieta urodzona 1 stycznia 1953 r. lub później nabywa prawo.',
    'PRZEBUDOWA SKRZYŻOWANIA PRZY ADAMA MICKIEWICZA',
    'REMONT DROGI OD ADAMA MICKIEWICZA DO TADEUSZA KOŚCIUSZKI',
    'TRASA ROWEROWA OD ADAMA MICKIEWICZA DO JANA PAWŁA II',
    'SZKOŁA PODSTAWOWA JANA KOCHANOWSKIEGO',
    'HISTORIA SZKOŁY JANA KOCHANOWSKIEGO',
    'Sw. Lukasz Ewangelista.',
    'Kościół Sw. Jana Apostoła',
  ]);
});
test('fix3: para z liczbą bez kontekstu adresu to osoba — dział II KW, wynik, narzędnik, ukośnik, tytuł', () => {
  masked([
    ['Dział II\nJana Lisa 3/4\nMarii Lis 1/4', `Dział II\n${N} 3/4\n${N} 1/4`],
    ['Marii Lis 1/4\nJana Lisa 3/4', `${N} 1/4\n${N} 3/4`],
    ['Współwłaściciele: Jana Lisa 3/4, Marii Lis 1/4', `Współwłaściciele: ${N} 3/4, ${N} 1/4`],
    ['Marii Lis 12', `${N} 12`],
    ['Dla Marii Lis 1/2', `Dla ${N} 1/2`],
    ['Marii Lis 1/2 w Kielcach', `${N} 1/2 w Kielcach`],
    ['Tomasza Mazura 12', `${N} 12`],
    ['Tomasza Mazura 12\nAnny Nowak 3', `${N} 12\n${N} 3`],
    ['Wynik: Tomasza Mazura 12', `Wynik: ${N} 12`],
    ['Głosowało za Tomasza Mazura 12', `Głosowało za ${N} 12`],
    ['Za Tomaszem Mazurem 12', `Za ${N} 12`],
    ['Jana Lisa 3/4', `${N} 3/4`],
    ['Właściciel: Jana Lisa 3/4', `Właściciel: ${N} 3/4`],
    ['Piotra Kosa 1/2', `${N} 1/2`],
    ['Właściciel: Tomasza Mazura 12/3', `Właściciel: ${N} 12/3`],
    ['Zeszyty Henryka Sienkiewicza 5/1', `Zeszyty ${N} 5/1`],
    ['Ocena Tomasza Mazura 3/5.', `Ocena ${N} 3/5.`],
    ['Praca Tomasza Mazura 18/20.', `Praca ${N} 18/20.`],
    ['Liczba godzin: Prof. Jana Nowaka 30, Dr. Anny Lis 15.', `Liczba godzin: Prof. ${N} 30, Dr. ${N} 15.`],
    ['Pismo Generała Władysława Andersa 1.', `Pismo Generała ${N} 1.`],
    // z miejscowością albo lokalem dalej adres
    ['Tomasza Mazura 12/3 w Kielcach', '[ADRES] w [MIEJSCOWOŚĆ]'],
    ['Tomasza Mazura 12 m. 3', '[ADRES]'],
  ]);
  masked(
    [
      ['Dział II\nJana Lisa 3/4\nMarii Lis 1/4', 'Dział II\n[OSOBA-A] 3/4\n[OSOBA-B] 1/4'],
      ['Ocena Tomasza Mazura 3/5. Tomasz Mazur odwołał się.', 'Ocena [OSOBA-A] 3/5. [OSOBA-A] odwołał się.'],
    ],
    { pseudonyms: true },
  );
});
// Zysk b7 K31 cofnięty w fix3: bez kontekstu adresu (lokal, miejscowość, kod, „przy", „ul.")
// para w dopełniaczu z samym numerem na końcu wiersza wygląda tak samo jak osoba z wynikiem czy
// udziałem („Tomasza Mazura 12", „Dział II⏎Jana Lisa 3/4"). Rozróżnienie ulicy „Jerzego
// Waszyngtona" od osoby wymagałoby słownika patronów; maska osoby na nazwie ulicy niczego nie
// ujawnia, a jawna osoba tak — wybieramy maskę (jak v0.46.23).
test.skip('fix3: ulica z patronem bez kontekstu adresu zostaje jawna (pominięte — patrz komentarz)', () => {
  keep(['Jerzego Waszyngtona 12']);
});
test('fix3: ulica z patronem po etykiecie adresu w dowolnym otoczeniu, wyliczenie, „to adres"', () => {
  masked([
    ['Adres zamieszkania: Jana Pawła II 14 Kielce', 'Adres zamieszkania: [ADRES] Kielce'],
    ['Adres: Jana Pawła II 14 Kielce', 'Adres: [ADRES] Kielce'],
    ['zam. Jana Pawła II 14 Kielce', 'zam. [ADRES] Kielce'],
    ['Adres zamieszkania: Jana Pawła II 14 25-001 Kielce', 'Adres zamieszkania: [ADRES] [KOD-POCZTOWY] [MIEJSCOWOŚĆ]'],
    ['zamieszkały przy Jana Pawła II nr 14', 'zamieszkały przy [ADRES]'],
    ['zamieszkały przy Jana Pawła II pod nr 14', 'zamieszkały przy [ADRES]'],
    ['Wnioskodawca zamieszkały przy Jana Pawła II 14 - wnosi', 'Wnioskodawca zamieszkały przy [ADRES] - wnosi'],
    ['zamieszkały przy Jana Pawła II 14 Jan Lis wnosi', `zamieszkały przy [ADRES] ${N} wnosi`],
    ['Mieszkańcy Adama Mickiewicza 5 i Jana Pawła II 7 zgłosili', 'Mieszkańcy [ADRES] i [ADRES] zgłosili'],
    ['Prezydenta Lecha Wałęsy 15/2 to adres korespondencyjny.', '[ADRES] to adres korespondencyjny.'],
    ['Udziały w lokalu przy Jana Pawła II 12/4 należą do Marii Lis.', `Udziały w lokalu przy [ADRES] należą do ${N}.`],
    // kod pocztowy w następnym wierszu bloku adresowego
    ['Anna Kowalska\nJana Pawła II 5\n25-001 Kielce', `${N}\n[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]`],
  ]);
  keep(['Urząd Gminy przy Jana Pawła II 5 informuje.', 'Kaplica św. Jana Pawła II 2', 'Jaroslaw Rynek 5 to adres urzedu']);
});
test('fix3: WERSALIKI — dokument przed dopełniaczem, przymiotnik prywatności, przelew z kwotą', () => {
  masked([
    ['AKTA SPRAWY ANNY KOWALSKIEJ', `AKTA SPRAWY ${N}`],
    ['DOKUMENTACJA PRACOWNICZA ANNY KOWALSKIEJ', `DOKUMENTACJA PRACOWNICZA ${N}`],
    ['AKTA PRACOWNICZE ANNY KOWALSKIEJ', `AKTA PRACOWNICZE ${N}`],
    ['KARTA INFORMACYJNA LECZENIA SZPITALNEGO JANA NOWAKA', `KARTA INFORMACYJNA LECZENIA SZPITALNEGO ${N}`],
    ['AKT NOTARIALNY JANA NOWAKA', `AKT NOTARIALNY ${N}`],
    ['ARCHIWUM PRYWATNE JANA NOWAKA', `ARCHIWUM PRYWATNE ${N}`],
    ['FUNDACJA RODZINNA JANA NOWAKA', `FUNDACJA RODZINNA ${N}`],
    ['STYPENDIUM NAUKOWE JANA NOWAKA', `STYPENDIUM NAUKOWE ${N}`],
    ['NAGRODA SPECJALNA JANA NOWAKA', `NAGRODA SPECJALNA ${N}`],
    ['DOKUMENTACJA SPRAWY ANNY KOWALSKIEJ', `DOKUMENTACJA SPRAWY ${N}`],
    ['TECZKA SPRAWY ANNY KOWALSKIEJ', `TECZKA SPRAWY ${N}`],
    ['UMOWA NAJMU JANA KOWALSKIEGO', `UMOWA NAJMU ${N}`],
    ['UMOWA DZIERŻAWY JANA KOWALSKIEGO', `UMOWA DZIERŻAWY ${N}`],
    ['UMOWA SPRZEDAŻY JANA KOWALSKIEGO', `UMOWA SPRZEDAŻY ${N}`],
    ['2026-03-01\tPRZELEW OD JANA NOWAKA\t150,00', `2026-03-01\tPRZELEW OD ${N}\t150,00`],
    ['PRZELEW DO JANA NOWAKA 5', `PRZELEW DO ${N} 5`],
    ['PRZELEW OD JANA NOWAKA 150,00 PLN', `PRZELEW OD ${N} 150,00 PLN`],
    ['PRZELEW OD JANA NOWAKA 2026-03-01', `PRZELEW OD ${N} 2026-03-01`],
    ['WPŁATA OD ANNY KOWALSKIEJ 12 RATA', `WPŁATA OD ${N} 12 RATA`],
    ['PISMO OD ANNY KOWALSKIEJ 12 MARCA 2026', `PISMO OD ${N} 12 MARCA 2026`],
    ['PRZELEW OD ANNY KOWALSKIEJ 500 ZŁ', `PRZELEW OD ${N} 500 ZŁ`],
    ['ZWROT DO PIOTRA ZIELIŃSKIEGO 45,50 ZŁ', `ZWROT DO ${N} 45,50 ZŁ`],
    ['WPŁATA OD MARII WIŚNIEWSKIEJ 300', `WPŁATA OD ${N} 300`],
    ['PISMO DO ANNY KOWALSKIEJ 2 EGZ.', `PISMO DO ${N} 2 EGZ.`],
    ['ZAPROSZENIE DO JANA NOWAKA 12 MARCA', `ZAPROSZENIE DO ${N} 12 MARCA`],
    ['DECYZJA DO MARII WIŚNIEWSKIEJ 3', `DECYZJA DO ${N} 3`],
    ['12.03 PRZELEW OD ANNY KOWALSKIEJ 500,00', `12.03 PRZELEW OD ${N} 500,00`],
  ]);
  masked([['PRZELEW OD ANNY KOWALSKIEJ 500 ZŁ', 'PRZELEW OD [OSOBA-A] 500 ZŁ']], { pseudonyms: true });
  // ulica z patronem na kopercie to [ADRES]; pułapki: szkoła z patronem za dokumentem, nazwy obiektów
  masked([['DO ADAMA MICKIEWICZA 5\nKRAKÓW', 'DO [ADRES]\n[MIEJSCOWOŚĆ]']]);
  keep([
    'HISTORIA SZKOŁY JANA KOCHANOWSKIEGO',
    'UNIWERSYTET ADAMA MICKIEWICZA',
    'FUNDACJA JOLANTY KWAŚNIEWSKIEJ',
    'SZKOŁA PODSTAWOWA JANA KOCHANOWSKIEGO',
  ]);
});
test('fix3: klucz pseudonimu pod „fullName"/„osoba" — obce imię nie jest kluczem', () => {
  masked(
    [
      ['{"fullName": "Iryna Roman"}\n{"fullName": "Iryna Marek"}', '{"fullName": "[OSOBA-A]"}\n{"fullName": "[OSOBA-B]"}'],
      ['{"full_name": "Iryna Roman"}\n{"full_name": "Iryna Marek"}', '{"full_name": "[OSOBA-A]"}\n{"full_name": "[OSOBA-B]"}'],
      ['{"osoba": "Iryna Roman"}\n{"osoba": "Iryna Marek"}', '{"osoba": "[OSOBA-A]"}\n{"osoba": "[OSOBA-B]"}'],
      ['<fullName>Iryna Roman</fullName>\n<fullName>Iryna Marek</fullName>', '<fullName>[OSOBA-A]</fullName>\n<fullName>[OSOBA-B]</fullName>'],
      ['{"fullName": "Halyna Szymon"}\n{"fullName": "Halyna Adam"}', '{"fullName": "[OSOBA-A]"}\n{"fullName": "[OSOBA-B]"}'],
      ['{"fullName": "Iryna Roman"}\nPani Roman podpisała.', '{"fullName": "[OSOBA-A]"}\nPani [OSOBA-A] podpisała.'],
      ['{"fullName": "Kowalski Jan"}\nPan Kowalski', '{"fullName": "[OSOBA-A]"}\nPan [OSOBA-A]'],
    ],
    { pseudonyms: true },
  );
});
test('fix3: komórki z TAB-em — etykieta z kropką, rola osoby, lista imion rodziców', () => {
  const D = '[DATA-URODZENIA]';
  masked([
    ['Nazwisko:\tWypych\tImię:\tMarek\tData ur.:\t03.04.1980', `Nazwisko:\t${N}\tImię:\t${N}\tData ur.:\t${D}`],
    ['Imię:\tJan\tData ur.:\t03.04.1980', `Imię:\t${N}\tData ur.:\t${D}`],
    ['Imię:\tJan\tMiejsce ur.:\tRadom', `Imię:\t${N}\tMiejsce ur.:\tRadom`],
    ['Imię ojca:\tJan\tNr tel.:\t600100200', `Imię ojca:\t${N}\tNr tel.:\t[TELEFON]`],
    ['Imię ojca:\tJan\tImię matki:\tAnna\tData ur.:\t03.04.1980', `Imię ojca:\t${N}\tImię matki:\t${N}\tData ur.:\t${D}`],
    ['Świadek:\tJan\tNazwisko:\tKowalski', `Świadek:\t${N}\tNazwisko:\t${N}`],
    ['Ojciec:\tJan\tMatka:\tEwa', `Ojciec:\t${N}\tMatka:\t${N}`],
    ['Kierownik:\tMarek\tDział:\tKadry', `Kierownik:\t${N}\tDział:\tKadry`],
    ['Imiona rodziców:\tJan, Anna\tData urodzenia:\t03.04.1980', `Imiona rodziców:\t${N}, ${N}\tData urodzenia:\t${D}`],
    ['Imiona rodziców:\tJan, Anna\tNazwisko:\tGzowski', `Imiona rodziców:\t${N}, ${N}\tNazwisko:\t${N}`],
    ['Imiona rodziców: Jan i Anna', `Imiona rodziców: ${N} i ${N}`],
    ['Imiona rodziców: Stanisław', `Imiona rodziców: ${N}`],
  ]);
  // pułapki: rola z nie-imieniem, wyraz-imię pospolite i dopisek pod etykietą imion zostają
  keep([
    'Kierownik:\tKadry\tDział:\tKsięgowość',
    'Świadek:\tbrak\tData:\t12.03.2026',
    'Matka:\tRóża\tOjciec:\tbrak',
    'Imiona rodziców: zgodnie z aktem urodzenia',
    'Imiona rodziców: Urząd Stanu Cywilnego',
  ]);
});
test('fix3: tablica „Po", login pod kolejną etykietą konta, święty w dopełniaczu, klub za przymiotnikiem', () => {
  masked([
    ['tablice rejestracyjne Po 12345', 'tablice rejestracyjne [NR-REJESTRACYJNY]'],
    ['Login: soltys\nKonto: soltys', 'Login: [LOGIN]\nKonto: [LOGIN]'],
    ['Login: kasjer\nUżytkownik: kasjer', 'Login: [LOGIN]\nUżytkownik: [LOGIN]'],
    ['Login: JAN GÓRSKI\nKLUB SPORTOWY GÓRSKI', `Login: ${N}\nKLUB SPORTOWY GÓRSKI`],
    ['Sw. Jan Apostol zeznal, ze widzial sprawce.', `Sw. ${N} zeznal, ze widzial sprawce.`],
    ['Sw. Jana Apostola zeznal.', `Sw. ${N} zeznal.`],
    ['Login: soltys\nKonto: soltys (zablokowane)', 'Login: [LOGIN]\nKonto: [LOGIN] (zablokowane)'],
    // wyraz-login w prozie zostaje
    ['Login: soltys\nSołtys wsi zwołał zebranie.', 'Login: [LOGIN]\nSołtys wsi zwołał zebranie.'],
  ]);
  keep([
    'tablice rejestracyjne Do 2025',
    'Figura św. Pawła Apostoła podana do renowacji.',
    'Figura Sw. Pawla Apostola podana do renowacji.',
  ]);
});
test('dom2-fix1: rola procesowa WERSALIKAMI w dopełniaczu, ulica „Jana Pawła II" z lokalem, wieś na Ł/Ś nad kodem', () => {
  masked([
    // osoba WERSALIKAMI po roli w dopełniaczu i celowniku
    ['WEZWANIE ŚWIADKA ANNY KOWALSKIEJ\nWzywa się Panią na rozprawę.', `WEZWANIE ŚWIADKA ${N}\nWzywa się Panią na rozprawę.`],
    [
      'W OBECNOŚCI DŁUŻNIKA JANA NOWAKA ORAZ ŚWIADKA ADAMA RÓŻAŃSKIEGO DOKONAŁ ZAJĘCIA.',
      `W OBECNOŚCI DŁUŻNIKA ${N} ORAZ ŚWIADKA ${N} DOKONAŁ ZAJĘCIA.`,
    ],
    ['ZAWIADOMIENIE POKRZYWDZONEJ MARII WIŚNIEWSKIEJ', `ZAWIADOMIENIE POKRZYWDZONEJ ${N}`],
    ['APELACJA OSKARŻONEGO PIOTRA ZIELIŃSKIEGO', `APELACJA OSKARŻONEGO ${N}`],
    ['SPRZECIW POZWANEJ EWY LEWANDOWSKIEJ', `SPRZECIW POZWANEJ ${N}`],
    ['ZGODA OJCA JANA NOWAKA', `ZGODA OJCA ${N}`],
    // homograf z listy wyjątków po roli i imieniu w dopełniaczu
    ['W OBECNOŚCI DŁUŻNIKA JERZEGO PIĄTKA DOKONAŁ ZAJĘCIA.', `W OBECNOŚCI DŁUŻNIKA ${N} DOKONAŁ ZAJĘCIA.`],
    ['PODPISY: DŁUŻNIK JERZY PIĄTEK, ŚWIADEK EWA MAJ', `PODPISY: DŁUŻNIK ${N}, ŚWIADEK ${N}`],
    // ulica z patronem i lokalem w kontekście adresu
    ['Pan Nowak mieszka na Jana Pawła II 30/2.', `Pan ${N} mieszka na [ADRES].`],
    ['Zamieszkała na Kazimierza Wielkiego 12/4.', 'Zamieszkała na [ADRES].'],
    ['"partyAddress":"Lubień, Jana Pawła II 30/2"', '"partyAddress":"Lubień, [ADRES]"'],
    ['city=Lubień street="Jana Pawła II 5/2"', 'city=Lubień street="[ADRES]"'],
    ['adres=Jana Pawła II 5/2', 'adres=[ADRES]'],
    ['"Halyna Roman","hroman","","Jana Pawła II 5/2","Lubień"', '"Halyna Roman","hroman","","[ADRES]","Lubień"'],
    ['Iryna\tRoman\tiroman\tLubień\tJana Pawła II 5/2\tuwagi', 'Iryna\tRoman\tiroman\tLubień\t[ADRES]\tuwagi'],
    // wieś z numerem domu nad kodem pocztowym, także na literę diakrytyczną
    ['Pan\nJan Kowalski\nŁagów 12\n26-140 Bodzentyn', `Pan\n${N}\n[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]`],
    ['Jan Kowalski\nŚwiniary 12\n28-100 Busko-Zdrój', `${N}\n[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]`],
    ['Pan\nJan Kowalski\nŁęki Szlacheckie 12\n26-140 Bodzentyn', `Pan\n${N}\n[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]`],
    ['Adres: Łagów 12\n26-140 Bodzentyn', 'Adres: [ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]'],
  ]);
  // pułapki: patron w nazwie obiektu, papież w prozie, adresat, adres IP, urząd, odsyłacz nad kodem
  keep([
    'UNIWERSYTET ADAMA MICKIEWICZA',
    'STADION KAZIMIERZA GÓRSKIEGO',
    'AKADEMIA WF JÓZEFA PIŁSUDSKIEGO',
    'ZESPÓŁ SZKÓŁ JANA KOWALSKIEGO',
    'SCHRONISKO BRATA ALBERTA CHMIELOWSKIEGO',
    'SZKOŁA PODSTAWOWA IM. OJCA MAKSYMILIANA KOLBEGO',
    'Papież Jan Paweł II odwiedził Polskę.',
    'Pomnik Jana Pawła II stoi w parku.',
    'Przy Jana Pawła II jest korek.',
    'ipAddress="Jana Pawła II 5/2"',
    'Urząd Gminy, Jana Pawła II 5/2, Lubień',
    'mieszka na Mazurach 12 lat',
    'PIĄTEK 3 MAJA',
    'GRAFIK: JANA PIĄTKA',
    'SĘDZIA ANNA KALINA',
    'DYREKTOR ZARZĄDU DRÓG',
  ]);
  for (const t of ['Sala 12\n00-001 Warszawa', 'Rozdział 12\n00-001 Warszawa', 'Art. 12\n00-001 Warszawa']) {
    expect(redactPII(t).redacted).not.toContain('[ADRES]');
  }
  expect(redactPII('Przepisał mieszkanie na Jana Kowalskiego 1/2 udziału.').redacted).not.toContain('[ADRES]');
  expect(redactPII('adresat="Jana Kowalskiego 5/2"').redacted).not.toContain('[ADRES]');
});

test('dom2-fix2: ulica „Jana Pawła II" pod etykietą WERSALIKAMI, w kluczu z numerem, w gołym CSV i kopercie; udział w tabeli; wieś-homonim w kopercie', () => {
  masked([
    // goły CSV z przecinkami bez nagłówka i komórka z kodem pocztowym między ulicą a miejscowością
    ['Halyna Roman,hroman,,Jana Pawła II 5/2,Lubień', 'Halyna Roman,hroman,,[ADRES],Lubień'],
    ['Jan,Kowalski,Jana Pawła II 30/2,Lubień', `Jan,${N},[ADRES],Lubień`],
    ['"Halyna Roman","hroman","","Jana Pawła II 5/2","34-500","Lubień"', '"Halyna Roman","hroman","","[ADRES]","[KOD-POCZTOWY]","Lubień"'],
    ['Halyna Roman;hroman;;Jana Pawła II 5/2;34-500;Lubień', 'Halyna Roman;hroman;;[ADRES];[KOD-POCZTOWY];Lubień'],
    // etykiety WERSALIKAMI, „Korespondencja:", miejscowość przed przecinkiem, koperta bez kodu
    ['ZAM. Jana Pawła II 5/2', 'ZAM. [ADRES]'],
    ['ŚWIADEK ZOFIA KOWAL, ZAM. Jana Pawła II 5/2, Lubień', `ŚWIADEK ${N}, ZAM. [ADRES], Lubień`],
    ['ZAMIESZKAŁY: Jana Pawła II 5/2', 'ZAMIESZKAŁY: [ADRES]'],
    ['ADRES DO DORĘCZEŃ: Jana Pawła II 5/2', 'ADRES DO DORĘCZEŃ: [ADRES]'],
    ['ADRES DO KORESPONDENCJI: Jana Pawła II 5', 'ADRES DO KORESPONDENCJI: [ADRES]'],
    ['Korespondencja: Jana Pawła II 5/2', 'Korespondencja: [ADRES]'],
    ['zamieszkały w Lubniu, Jana Pawła II 30/2', 'zamieszkały w [MIEJSCOWOŚĆ], [ADRES]'],
    ['Lubień, Jana Pawła II 30/2', 'Lubień, [ADRES]'],
    ['Jan Nowak\nJana Pawła II 5/2\nLubień', `${N}\n[ADRES]\nLubień`],
    // klucz pola z numerem
    ['addressLine1: Jana Pawła II 5/2', 'addressLine1: [ADRES]'],
    ['address_line_1="Jana Pawła II 5/2"', 'address_line_1="[ADRES]"'],
    ['adres2: Jana Pawła II 5', 'adres2: [ADRES]'],
    ['Adres 2: Jana Pawła II 5', 'Adres 2: [ADRES]'],
    // osoba z udziałem w tabeli zostaje osobą, ułamek zostaje
    ['"Udział";"Adama Nowaka 1/2";"Kraków"', `"Udział";"${N} 1/2";"Kraków"`],
    ['Współwłaściciel\tAdama Nowaka 1/2\tKraków', `Współwłaściciel\t${N} 1/2\tKraków`],
    ['"Nagroda";"Jana Kowalskiego 1/2";"Warszawa"', `"Nagroda";"${N} 1/2";"Warszawa"`],
    ['"Oceny";"Jana Kowalskiego 3/5";"Kraków"', `"Oceny";"${N} 3/5";"Kraków"`],
    // wieś o nazwie z listy odsyłaczy w bloku koperty
    ['Pan\nJan Kowalski\nPokój 12\n46-034 Pokój', `Pan\n${N}\n[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]`],
    ['Pani\nAnna Nowak\nGrupa 12\n86-134 Dragacz', `Pani\n${N}\n[ADRES]\n[KOD-POCZTOWY] [MIEJSCOWOŚĆ]`],
  ]);
  for (const t of ['Pan\nJan Kowalski\nPokój 12\n46-034 Pokój', 'Jan Nowak\nJana Pawła II 5/2\nLubień', 'ADRES DO DORĘCZEŃ: Jana Pawła II 5/2']) {
    expect(redactPII(t, { pseudonyms: true }).redacted).toContain('[ADRES]');
  }
  // pułapki: proza z ułamkami, dalszy ciąg zdania za „Miasto, …", pokój pod urzędem i pod ulicą
  for (const t of [
    'Oceny: Jana Kowalskiego 3/5, Anny Nowak 4/5',
    'Wyniki,Jana Kowalskiego 3/5,Anny Nowak 4/5',
    'Spadkobierca;Jana Kowalskiego 1/2;Kraków',
    'Kraków, Jana Kowalskiego 3 lata temu',
    'mieszkanie w Krakowie, Jana Kowalskiego 1/2 udziału',
    'Lista\nJan Nowak\nJana Kowalskiego 12\nPiotr Lis',
    'Pan\nJan Kowalski\nul. Wiejska 4\nPokój 12\n00-001 Warszawa',
    'Wydział Kadr\nPokój 12\n00-001 Warszawa',
    'Grupa 12\n86-134 Dragacz',
    'Korespondencja z dnia 12.03.2024',
  ]) {
    const r = redactPII(t).redacted;
    expect(r.split('[ADRES]').length - 1, t).toBe(t.includes('ul. Wiejska') ? 1 : 0);
  }
});

test('dom2-fix3: ulica „Jana Pawła II" z numerem w wierszu z rolą, bez lokalu, po etykiecie WERSALIKAMI i z myślnikiem; osoba z ułamkiem właściwym w wykazie', () => {
  const M = '[MIEJSCOWOŚĆ]';
  masked([
    // rola w innej komórce wiersza nie wyłącza adresu
    ['Współwłaściciel;Adam Nowak;Jana Pawła II 5/2;Kraków', `Współwłaściciel;${N};[ADRES];${M}`],
    ['Spadkobierca\tAdam Nowak\tJana Pawła II 5/2\tLubień', `Spadkobierca\t${N}\t[ADRES]\tLubień`],
    ['"Nagroda";"Adam Nowak";"Jana Pawła II 5/2";"Kraków"', `"Nagroda";"${N}";"[ADRES]";"Kraków"`],
    // numer bez lokalu w CSV
    ['Halyna Roman,hroman,,Jana Pawła II 5,Lubień', 'Halyna Roman,hroman,,[ADRES],Lubień'],
    ['"Halyna Roman";"hroman";"";"Jana Pawła II 5";"Lubień"', '"Halyna Roman";"hroman";"";"[ADRES]";"Lubień"'],
    ['Halyna Roman,hroman,,Jana Pawła II 5a,Lubień', 'Halyna Roman,hroman,,[ADRES],Lubień'],
    ['Halyna Roman, hroman, , Jana Pawła II 5/2, Lubień', 'Halyna Roman, hroman, , [ADRES], Lubień'],
    // miejscowość przed ulicą: bez lokalu, dwuwyrazowa, WERSALIKAMI, po osobie, z kodem w nawiasie
    ['Lubień, Jana Pawła II 30', 'Lubień, [ADRES]'],
    ['Nowy Targ, Jana Pawła II 30/2', `${M}, [ADRES]`],
    ['KRAKÓW, Jana Pawła II 30/2', 'KRAKÓW, [ADRES]'],
    ['Anna Nowak, Lubień, Jana Pawła II 5/2', `${N}, Lubień, [ADRES]`],
    ['zamieszkała w Lubniu (34-500), Jana Pawła II 30/2', 'zamieszkała w Lubniu ([KOD-POCZTOWY]), [ADRES]'],
    ['Kraków, Jana Pawła II 30/2 - lokal powódki.', `${M}, [ADRES] - lokal powódki.`],
    ['Halina Rój, Kraków, Jana Pawła II 14/3 (parter)', `${N}, ${M}, [ADRES] (parter)`],
    // koperta i stopka: bez miejscowości pod ulicą, adresat WERSALIKAMI
    ['Jan Nowak\nJana Pawła II 5/2', `${N}\n[ADRES]`],
    ['Anna Nowak\nJana Pawła II 5/2\ntel. 601 234 567', `${N}\n[ADRES]\ntel. [TELEFON]`],
    ['JAN KOWALSKI\nJana Pawła II 5/2\nLubień', `${N}\n[ADRES]\nLubień`],
    // etykiety bez kropki, z myślnikiem, WERSALIKAMI i z imiesłowem
    ['ZAM: Jana Pawła II 5/2', 'ZAM: [ADRES]'],
    ['Zamieszkały - Jana Pawła II 5/2', 'Zamieszkały - [ADRES]'],
    ['Adres do doręczeń - Jana Pawła II 5/2', 'Adres do doręczeń - [ADRES]'],
    ['Doręczyć: Jana Pawła II 5/2', 'Doręczyć: [ADRES]'],
    ['LOKAL POŁOŻONY PRZY Jana Pawła II 5/2', 'LOKAL POŁOŻONY PRZY [ADRES]'],
    ['ZNAJDUJĄCEJ SIĘ PRZY Jana Pawła II 5/2', 'ZNAJDUJĄCEJ SIĘ PRZY [ADRES]'],
    ['PRZY Jana Pawła II 5/2', 'PRZY [ADRES]'],
    ['POD ADRESEM Jana Pawła II 5/2', 'POD ADRESEM [ADRES]'],
    ['mieszkająca w Lubniu, Jana Pawła II 30/2', 'mieszkająca w Lubniu, [ADRES]'],
    // osoba z ułamkiem właściwym (udział, ocena, wynik) zostaje osobą, liczba i miejscowość zostają
    ['Spadkobiercy:\nKraków, Adama Nowaka 1/2\nLublin, Ewy Nowak 1/2', `Spadkobiercy:\nKraków, ${N} 1/2\nLublin, ${N} 1/2`],
    ['PROTOKÓŁ GŁOSOWANIA\nKraków, Jana Kowalskiego 12\nRadom, Anny Nowak 7', `PROTOKÓŁ GŁOSOWANIA\nKraków, ${N} 12\nRadom, ${N} 7`],
    ['Wyniki egzaminu\nRadom, Jana Kochanowskiego 3/5', `Wyniki egzaminu\nRadom, ${N} 3/5`],
    ['Udział;Miasto\nJana Kowalskiego 1/2;Kraków', `Udział;Miasto\n${N} 1/2;Kraków`],
    ['Lp,Uczeń,Ocena,Miejscowość\n1,Jana Nowaka 4/5,Kraków', `Lp,Uczeń,Ocena,Miejscowość\n1,${N} 4/5,Kraków`],
    ['okręg,kandydat,wynik,miasto\n3,Tomasza Mazura 12/40,Kraków', `okręg,kandydat,wynik,miasto\n3,${N} 12/40,Kraków`],
    ['"Anny Kowalskiej 1/2","Kraków"', `"${N} 1/2","Kraków"`],
  ]);
  for (const t of ['Współwłaściciel;Adam Nowak;Jana Pawła II 5/2;Kraków', 'Anna Nowak\nJana Pawła II 5/2\ntel. 601 234 567', 'LOKAL POŁOŻONY PRZY Jana Pawła II 5/2']) {
    expect(redactPII(t, { pseudonyms: true }).redacted).toContain('[ADRES]');
  }
  // pułapki: papież i jego pisma, rok, zakres, instytucja, dalszy ciąg zdania
  keep([
    'Encyklika Jana Pawła II 3.',
    'rozdz. Jana Pawła II 4, s. 12',
    'Zob. przemówienia Jana Pawła II 5-7.',
    'w latach Jana Pawła II 1978-2005',
    'Homilia Jana Pawła II 2 czerwca 1979 r.',
    'Nagroda Jana Pawła II 2023.',
    'Fundacja Jana Pawła II 5, Rzym',
    'Kościół Jana Pawła II 2',
    'ipAddress="Jana Pawła II 5/2"',
    'Urząd Gminy, Jana Pawła II 5/2, Lubień',
  ]);
});
test('dom3: inwariant ulicy z patronem — para z numerem domu to [ADRES] albo osoba, nigdy jawna', () => {
  // I1: z lokalem „m./lok./lokal" adres powstaje w każdym otoczeniu, także w prozie bez etykiety
  masked([
    ['Lokator Adama Mickiewicza 30 m. 2 zalega z czynszem.', `Lokator ${A} zalega z czynszem.`],
    ['Najemca lokalu Stefana Batorego 12 lok. 4 zalega z czynszem.', `Najemca lokalu ${A} zalega z czynszem.`],
    ['Zamienię mieszkanie komunalne Tadeusza Kościuszki 5 m. 3 na mniejsze.', `Zamienię mieszkanie komunalne ${A} na mniejsze.`],
    ['Budynek Marii Konopnickiej 30 m. 2 – zalanie', `Budynek ${A} – zalanie`],
    ['Konstantego Ildefonsa Gałczyńskiego 4 lokal 2', A],
    [
      'Świadek zamieszkuje pod adresem Tadeusza Kościuszki 5 m. 3 w Krakowie od 2019 r.\nLokator Tadeusza Kościuszki 5 m. 3 (powód Jan Nowak) twierdzi.',
      `Świadek zamieszkuje pod adresem ${A} w [MIEJSCOWOŚĆ] od 2019 r.\nLokator ${A} (powód ${N}) twierdzi.`,
    ],
    ['Jan Nowak\nTadeusza Kościuszki 5 m. 3 Kraków', `${N}\n${A} Kraków`],
    ['PRZELEW DO: JAN NOWAK Tadeusza Kościuszki 5 m. 3 KRAKÓW', `PRZELEW DO: ${N} ${A} KRAKÓW`],
    ['Kraków, Jana Pawła II 12-14', `[MIEJSCOWOŚĆ], ${A}`],
    ['Anna Kowalska Jana Pawła II 5', `${N} ${A}`],
    // bez pewnej kotwicy adresu para zostaje osobą, numer jak dawniej (fallback z v0.46.23)
    ['Tadeusza Kościuszki 30 w Krakowie.', `${N} 30 w Krakowie.`],
    ['Lokator Kazimierza Wielkiego 14 w Krakowie zgłosił hałas.', `Lokator ${N} 14 w Krakowie zgłosił hałas.`],
    ['Treny Jana Kochanowskiego II 3.', `Treny ${N} II 3.`],
    ['Ranking: Kazimierza Wielkiego III 2;', `Ranking: ${N} III 2;`],
    ['mieszkająca w Lubniu, Adama Mickiewicza 5 razy odwiedzała', `mieszkająca w Lubniu, ${N} 5 razy odwiedzała`],
    // WERSALIKI: „PRZY" z numerem domu to adres, bez numeru ulica zostaje jawna
    ['DOM PRZY STANISŁAWA WYSPIAŃSKIEGO 5.', `DOM PRZY ${A}.`],
    ['PROTOKÓŁ SPORZĄDZONO W LOKALU PRZY JANA KOWALSKIEGO 5/2.', `PROTOKÓŁ SPORZĄDZONO W LOKALU PRZY ${A}.`],
    ['MIESZKANIE PRZY ADAMA MICKIEWICZA 5 M. 2', `MIESZKANIE PRZY ${A}`],
    ['W LOKALU PRZY JANA PAWŁA II 30/2 W GORLICACH', `W LOKALU PRZY ${A} W GORLICACH`],
    ['NAJEMCA LOKALU ADAMA MICKIEWICZA 30/2.', `NAJEMCA LOKALU ${N} 30/2.`],
    // I2: numer z sąsiedniej komórki nie jest numerem domu; nagłówek „Ulica" albo etykieta adresu
    // w poprzedniej komórce czynią z samej komórki ulicy adres, a numer zostaje w swojej kolumnie
    ['Ulica\tNr\nJana Pawła II\t12', `Ulica\tNr\n${A}\t12`],
    ['Ulica;Nr\nJana Pawła II;12\nTadeusza Kościuszki;5', `Ulica;Nr\n${A};12\n${A};5`],
    ['Adres:\tJana Pawła II\t12', `Adres:\t${A}\t12`],
    ['Lp\tLaureat\tNagroda\tPunkty\n1\tAnna Nowak\tJana Pawła II\t98', `Lp\tLaureat\tNagroda\tPunkty\n1\t${N}\tJana Pawła II\t98`],
    // I3: rola, etykieta albo tytuł przed parą wygrywa z hipotezą ulicy i „dwóch imion"
    ['CZYNNOŚCI DOKONANO PRZY UDZIALE JANA NOWAKA.', `CZYNNOŚCI DOKONANO PRZY UDZIALE ${N}.`],
    ['PRZY UDZIALE ANNY KOWALSKIEJ.', `PRZY UDZIALE ${N}.`],
    ['PRZY POMOCY JANA NOWAKA.', `PRZY POMOCY ${N}.`],
    ['PRZY ASYŚCIE JANA NOWAKA.', `PRZY ASYŚCIE ${N}.`],
    ['PRZY OBECNOŚCI JANA NOWAKA', `PRZY OBECNOŚCI ${N}`],
    ['OGLĘDZIN DOKONANO PRZY UDZIALE JANA NOWAKA I ANNY LIS.', `OGLĘDZIN DOKONANO PRZY UDZIALE ${N} I ${N}.`],
    ['PRZY UDZIALE WŁAŚCICIELA JANA NOWAKA', `PRZY UDZIALE WŁAŚCICIELA ${N}`],
    ['Świadek: Marek Pawła, zam. Lubień 12', `Świadek: ${N}, zam. Lubień 12`],
    ['Pracownik: Ewa Pawła, PESEL 90010112345', `Pracownik: ${N}, PESEL [PESEL]`],
    ['p. Robert Pawła przygotuje akademię.', `p. ${N} przygotuje akademię.`],
    ['Dyrektor szkoły: mgr Andrzej Pawła', `Dyrektor szkoły: mgr ${N}`],
    ['Dyrektor szkoły: mgr Andrzej Jana Pawła', `Dyrektor szkoły: mgr ${N}`],
  ]);
  masked([['Lokator Adama Mickiewicza 30 m. 2 zalega z czynszem.', 'Lokator [ADRES] zalega z czynszem.']], { pseudonyms: true });
  // I4 i pułapki: odsyłacz, wizyta, rocznica, obiekt z patronem, krotność, egzemplarze, komórki TSV
  keep([
    'Wizyty Jana Pawła II 8.',
    'Rocznica Śmierci Jana Pawła II 2.',
    'Pomnik Jana Pawła II 3, Kraków',
    'Kaplica Jana Pawła II 3, Kraków',
    'Doręczyć: Jana Pawła II 5 egz.',
    'Encyklika Jana Pawła II 3.',
    'SP nr 1\tJana Pawła II\t12',
    'Szkoła\tPatron\tKlasy\nSP nr 1\tJana Pawła II\t12',
    'Jana Pawła II\t12',
    'SP nr 1;Jana Pawła II;12',
    'Kierownik: Jan Pawła II',
    'Dom Kultury przy Jana Pawła II 5 zaprasza.',
    'MIESZKANIE PRZY ADAMA MICKIEWICZA',
    'Jaroslaw Rynek 5 to adres urzedu',
    'Jarosław Rynek 5 to adres urzędu',
  ]);
  // I1 na siatce: patron z numerem domu nigdy nie zostaje jawny w całości
  for (const p of ['Adama Mickiewicza', 'Tadeusza Kościuszki', 'Stefana Batorego', 'Marii Konopnickiej', 'Jana Kowalskiego']) {
    for (const pre of ['', 'Lokator ', 'Budynek ', 'Kraków, ', 'Jan Nowak\n', 'Mieszkańcy ', 'Spotkanie przy ']) {
      for (const end of [' 30 m. 2 zalega z czynszem.', ' 30 lok. 2', ' 30 w Krakowie.', ' 30/2.', ' 30 m. 3 (powód Jan Nowak)', ' 14, Kraków']) {
        const t = pre + p + end;
        expect(redactPII(t).redacted, t).not.toContain(p);
        // WERSALIKAMI bez kotwicy tylko z lokalem (para WERSALIKAMI spoza słownika nazwisk nie jest osobą)
        if (/ (?:m|lok)\. /.test(end)) expect(redactPII(t.toUpperCase()).redacted, t.toUpperCase()).not.toContain(p.toUpperCase());
      }
    }
  }
});
test('dom3: patron z liczbą rzymską bez kotwicy — maska osoby jak w v0.46.23, odsyłacze i jednostki jawne', () => {
  masked([
    // I1: adres bez pewnej kotwicy — para dostaje maskę osoby, liczba rzymska i numer zostają.
    // Miejscowość ze słownika tuż za numerem (dom3-fix2) jest kotwicą: cały adres to [ADRES].
    ['Jana Pawła II 5/2 Kraków', `${A} Kraków`],
    ['Jana Pawła II 12 Lubień', `${N} II 12 Lubień`],
    ['Anna Nowak, Jana Pawła II 5/2 Kraków', `${N}, ${A} Kraków`],
    ['Doręczono w dniu 3 listopada Jana Pawła II 5/2', `Doręczono w dniu 3 listopada ${N} II 5/2`],
    ['Lista mieszkańców bloku Jana Pawła II 14:', `Lista mieszkańców bloku ${N} II 14:`],
    ['Jana Pawła 12/4', `${N} 12/4`],
    // kotwica: tabela z kreską, „nr", „m 2" bez kropki, ukośnik ze spacjami, skrót ulicy przed „nr"
    ['Adam Nowak|Jana Pawła II 5|Kraków', `${N}|${A}|Kraków`],
    ['| Adam Nowak | Jana Pawła II 5/2 | Kraków |', `| ${N} | ${A} | Kraków |`],
    ['Lubień, Jana Pawła II nr 5', `Lubień, ${A}`],
    ['Jana Pawła II, nr 5, Kraków', `${A}, [MIEJSCOWOŚĆ]`],
    ['Lokator Adama Mickiewicza 30 m 2 zalega.', `Lokator ${A} zalega.`],
    ['al. Jana Pawła II nr 5', A],
    ['mieszka przy al. Jana Pawła II nr 5', `mieszka przy ${A}`],
    ['Mieszka Na Jana Pawła II 30/2', `Mieszka Na ${A}`],
    ['Pod Adresem Jana Pawła II 5/2', `Pod Adresem ${A}`],
    ['Przy Jana Pawła II 14 w Kielcach mieszka wnioskodawca.', `Przy ${A} w [MIEJSCOWOŚĆ] mieszka wnioskodawca.`],
    ['Adres:\tJana Pawła II 14\tMiejsc.:\tKielce', `Adres:\t${A}\tMiejsc.:\tKielce`],
    ['Miejsce szkolenia: Kraków, Jana Pawła II 41 (budynek B), sala 12', `Miejsce szkolenia: [MIEJSCOWOŚĆ], ${A} (budynek B), sala 12`],
    // tabulator to granica komórki — głowa nazwy albo wyraz uliczny z sąsiedniej kolumny nie robi z osoby patrona
    ['Logistyka\tPlac\tKowalczyk Anna', `Logistyka\tPlac\t${N}`],
    ['Nagroda\tJana Lisa\tKraków', `Nagroda\t${N}\tKraków`],
    // pisma kadrowe WERSALIKAMI przed osobą
    ['WYPOWIEDZENIE UMOWY JANA KOWALSKIEGO', `WYPOWIEDZENIE UMOWY ${N}`],
    ['LISTA PŁAC JANA NOWAKA', `LISTA PŁAC ${N}`],
    ['LIST MOTYWACYJNY JANA NOWAKA', `LIST MOTYWACYJNY ${N}`],
    // ulica z „im." (także sklejonym) to adres, nie patron instytucji
    ['ul. im. Henryka Sienkiewicza 5', A],
    ['Szkoła im. Marii Konopnickiej, ul. im.Henryka Sienkiewicza 5.', `Szkoła im. Marii Konopnickiej, ${A}.`],
    // rzecznik z dopełniaczem urzędu przed nazwiskiem; osoba za patronem świętym
    ['Pani Rzecznik Praw Dziecka Gzowska wystąpiła.', `Pani Rzecznik Praw Dziecka ${N} wystąpiła.`],
    ['Proboszcz parafii św. Wojciecha Brzęczek zaprasza na odpust.', `Proboszcz parafii św. Wojciecha ${N} zaprasza na odpust.`],
    ['Po mszy w kaplicy św. Rocha Bednarz, miejscowy kowal, poświęcił bramę.', `Po mszy w kaplicy św. Rocha ${N}, miejscowy kowal, poświęcił bramę.`],
  ]);
  keep(['Szkoła im. Henryka Sienkiewicza 5, Kraków', 'Parafia św. Rocha Kraków zaprasza.', 'Pan Rzecznik Praw Obywatelskich odpowiedział.']);
  // odsyłacze, obiekty, jednostki i nazwy ulic bez numeru domu zostają jawne
  keep([
    'Kazanie Jana Pawła II 5.',
    'Przystanek Jana Pawła II 3',
    'Rondo Jana Pawła II 2 km od centrum',
    'Na Alei Jana Pawła II 5 minut piechotą.',
    'Pomnik Jana Pawła II 3 m wysokości.',
    'Pomnik Tadeusza Kościuszki 1, Kraków.',
    'Urząd Gminy przy Jana Pawła II 5 informuje.',
    'UNIWERSYTET ADAMA MICKIEWICZA',
    'Pontyfikat Jana Pawła II 26 lat',
  ]);
});
test('dom3-fix2: PESEL przez łamanie wiersza, adres przed datą z godziną, telefon w nazwie pliku, osoba w parametrze URL', () => {
  masked([
    ['PESEL 851 103\n142 83', 'PESEL [PESEL]'],
    ['PESEL: 851 103\n142 83', 'PESEL: [PESEL]'],
    // literówka w sumie: tylko grupy, które w nowej linii domykają wiersz
    ['PESEL: 851 103\n142 84', 'PESEL: [PESEL]'],
    ['Mieszka przy ul. Krótkiej 8 2024-05-12 10:20', 'Mieszka przy [ADRES] 2024-05-12 10:20'],
    ['lokalizacja ul. Krótka 8 2024-05-12 10:20', 'lokalizacja [ADRES] 2024-05-12 10:20'],
    ['zgłoszenie: ul. Krótka 8 12.05.2024 10:20', 'zgłoszenie: [ADRES] 12.05.2024 10:20'],
    ['Skan: firma-my.sharepoint.com/.../Wniosek_PESEL_85010112345_tel_600111222.pdf', 'Skan: firma-my.sharepoint.com/.../Wniosek_PESEL_[PESEL]_tel_[TELEFON].pdf'],
    ['kontakt_tel_600111222', 'kontakt_tel_[TELEFON]'],
    ['dok_600111222.pdf', 'dok_[TELEFON].pdf'],
    ['Profil: facebook.com/profile.php?id=1000045678&ref=Anna_Nowak', 'Profil: facebook.com/profile.php?id=[LOGIN]&ref=[IMIĘ I NAZWISKO]'],
    ['Profil: facebook.com/profile.php?ref=Anna_Nowak', 'Profil: facebook.com/profile.php?ref=[IMIĘ I NAZWISKO]'],
    ['https://example.com/a?from=Jan.Kowalski&x=1', 'https://example.com/a?from=[IMIĘ I NAZWISKO]&x=1'],
  ]);
  masked([['Profil: facebook.com/profile.php?ref=Anna_Nowak. Anna Nowak pisze.', 'Profil: facebook.com/profile.php?ref=[OSOBA-A]. [OSOBA-A] pisze.']], { pseudonyms: true });
  // pułapki: inne pole w nowej linii, kod wersalikami, identyfikator bez prefiksu komórkowego, wartość bez imienia
  keep([
    'PESEL: 851 103\nTel. 142 83',
    'ZAM_600111222',
    'x_123456789',
    'https://example.com/?utm_source=Facebook_Ads',
    'https://example.com/a?page=Strona_Glowna',
  ]);
});
test('dom3-fix2: adres z numerem domu przed podmiotem w liczbie mnogiej i z numerem z literą', () => {
  masked([
    ['W lokalu przy ul. Kwiatowej 7 dzieci nie mają własnego pokoju.', `W lokalu przy ${A} dzieci nie mają własnego pokoju.`],
    ['Lokal przy ul. Polnej 5a i Pawilonie 4 wynajęto.', `Lokal przy ${A} i Pawilonie 4 wynajęto.`],
  ]);
  // pułapki: liczebnik z orzeczeniem w liczbie pojedynczej, miara czasu, 2–4 z liczbą mnogą
  for (const t of ['Przy ul. Polnej 7 lat mieszkali.', 'Przy ul. Polnej 3 osoby mieszkają.', 'Przy ul. Polnej 7 dzieci nie ma pokoju.']) {
    expect(redactPII(t).redacted, t).toContain('ul. Polnej');
  }
});
test('dom3-fix2: „Imię Rynek N" — tylko miejscowość bez kotwicy to adres urzędu, osoba zostaje osobą', () => {
  masked([
    ['Świadek Anna Rynek 5', `Świadek ${N} 5`],
    ['Wnioskodawca: Anna Rynek 5', `Wnioskodawca: ${N} 5`],
    ['Wnioskodawca Jarosław Rynek 5', `Wnioskodawca ${N} 5`],
    ['Anna Rynek 5 maja', `${N} 5 maja`],
    ['Anna Rynek 5 lat temu', `${N} 5 lat temu`],
    ['Jarosław Rynek 5 lat temu kupił dom', `${N} 5 lat temu kupił dom`],
    ['Anna Rynek 12 m. 4', `${N} 12 m. 4`],
    ['Jarosław Rynek 5 m. 4', `${N} 5 m. 4`],
    ['Anna Rynek\t5', `${N}\t5`],
    ['Jarosław Rynek\t5', `${N}\t5`],
  ]);
  keep(['Jarosław Rynek 5 to adres urzędu', 'Jaroslaw Rynek 5 to adres urzedu']);
});
test('dom3-fix2: metraż za parą z patronem to nie lokal', () => {
  masked([
    ['Mieszkanie Jana Nowaka 48 m2 wycenione na 300 tys. zł.', `Mieszkanie ${N} 48 m2 wycenione na 300 tys. zł.`],
    ['Działka Anny Kowalskiej 1200 m2 położona w Lubniu.', `Działka ${N} 1200 m2 położona w Lubniu.`],
    ['Lokal Tomasza Mazura 62 m2, 3 pokoje.', `Lokal ${N} 62 m2, 3 pokoje.`],
    ['Nieruchomość Piotra Zająca 850 m2 – działka budowlana.', `Nieruchomość ${N} 850 m2 – działka budowlana.`],
    // „m" bez kropki ze spacją przed numerem to dalej lokal
    ['Lokator Adama Mickiewicza 30 m 2 zalega z czynszem.', `Lokator ${A} zalega z czynszem.`],
    ['Lokator Adama Mickiewicza 30 m.2 zalega z czynszem.', `Lokator ${A} zalega z czynszem.`],
  ]);
  masked([['Mieszkanie Jana Nowaka 48 m2 wycenione.', 'Mieszkanie [OSOBA-A] 48 m2 wycenione.']], { pseudonyms: true });
});
test('dom3-fix2: nazwisko-homograf „Pawła" — imię w mianowniku albo w niezgodnym przypadku to osoba', () => {
  masked([
    ['Oględzin dokonano w obecności świadka Krzysztofa Pawła.', `Oględzin dokonano w obecności świadka ${N}.`],
    ['Z wniosku wierzyciela Jana Pawła przeciwko dłużnikowi.', `Z wniosku wierzyciela ${N} przeciwko dłużnikowi.`],
    ['W sprawie z powództwa Piotra Pawła o zapłatę.', `W sprawie z powództwa ${N} o zapłatę.`],
    ['Na rzecz powoda Jana Pawła kwoty 5 000 zł.', `Na rzecz powoda ${N} kwoty 5 000 zł.`],
    ['Sąd przesłuchał świadka Zofię Pawła.', `Sąd przesłuchał świadka ${N}.`],
    ['Spadek po Janie Pawła, zmarłym dnia 5 stycznia 2024 r.', `Spadek po ${N}, zmarłym dnia 5 stycznia 2024 r.`],
    ['Spotkanie z Janem Pawła.', `Spotkanie z ${N}.`],
    ['Ja, Krzysztof Pawła, oświadczam.', `Ja, ${N}, oświadczam.`],
    ['Ja, niżej podpisany Jan Pawła, oświadczam.', `Ja, niżej podpisany ${N}, oświadczam.`],
    ['Sąsiad Piotr Pawła zakłóca ciszę.', `Sąsiad ${N} zakłóca ciszę.`],
    ['Ustalono, że Piotr Pawła spożywał alkohol.', `Ustalono, że ${N} spożywał alkohol.`],
    ['- syn Piotr Pawła, ur. 2010', `- syn ${N}, ur. 2010`],
    ['- córka Anna Pawła, ur. 2013', `- córka ${N}, ur. 2013`],
    ['Nabyli: żona Maria Pawła oraz syn Piotr Pawła po 1/2 części.', `Nabyli: żona ${N} oraz syn ${N} po 1/2 części.`],
    ['Jan Pawła mieszka w Krakowie.', `${N} mieszka w ${C}.`],
    ['Jan Pawła', N],
    ['Pan\nPiotr Pawła\nTadeusza Kościuszki 30 m. 2\n35-002 Rzeszów', `Pan\n${N}\n${A}\n[KOD-POCZTOWY] ${C}`],
    ['1\tJan Pawła\tJana Pawła II 30 m. 1', `1\t${N}\t${A}`],
    ['2\tAnna Piotra\tJana Pawła II 30 m. 2', `2\t${N}\t${A}`],
    ['| 1 | Jan Pawła | Jana Pawła II 30/2 | 1 200,00 zł |', `| 1 | ${N} | ${A} | 1 200,00 zł |`],
  ]);
  masked([['Świadek Jan Pawła. Jan Pawła zeznał.', 'Świadek [OSOBA-A]. [OSOBA-A] zeznał.']], { pseudonyms: true });
  // pułapki: papież z liczbą rzymską, imieniny, patron szkoły
  keep([
    'Z wniosku wierzyciela Jana Pawła II przeciwko dłużnikowi.',
    'Encyklika Jana Pawła II o pracy.',
    'Pielgrzymka Jana Pawła II do Polski.',
    'Imieniny Jana i Pawła.',
    'Szkoła im. Jana Pawła w Lubniu.',
    'Papież Jan Paweł II odwiedził Kraków.',
    'Kierownik: Jan Pawła II',
  ]);
});
test('dom3-fix2: WERSALIKI — rok i liczebnik za tytułem utworu, obiekt publiczny przy ulicy z patronem', () => {
  keep([
    'KONKURS RECYTATORSKI WIERSZY ADAMA MICKIEWICZA 2025',
    'TRENY JANA KOCHANOWSKIEGO 1580',
    'LEKTURA: BALLADY ADAMA MICKIEWICZA 1822',
    'FRASZKI JANA KOCHANOWSKIEGO 3 KSIĘGI',
    'SONETY ADAMA MICKIEWICZA 1826',
    'ROK ADAMA MICKIEWICZA 2022',
    'PIEŚNI JANA KOCHANOWSKIEGO 2 KSIĘGA',
    'APTEKA PRZY TADEUSZA KOŚCIUSZKI 12 W TARNOWIE',
    'HALA SPORTOWA PRZY STEFANA BATOREGO 12 W TARNOWIE',
    'PRZYCHODNIA PRZY JANA PAWŁA II 30 W KRAKOWIE',
    'SALA GIMNASTYCZNA PRZY ADAMA MICKIEWICZA 5',
    'PARKING PRZY JANA PAWŁA II 30',
    'OŚRODEK ZDROWIA PRZY ADAMA MICKIEWICZA 5 W LUBNIU',
  ]);
  // pułapki: numer domu z lokalem albo za „DOM/MIESZKANIE PRZY" dalej daje adres
  masked([
    ['DOM PRZY STANISŁAWA WYSPIAŃSKIEGO 5.', `DOM PRZY ${A}.`],
    ['MIESZKANIE PRZY ADAMA MICKIEWICZA 5 W LUBNIU', `MIESZKANIE PRZY ${A} W LUBNIU`],
    ['W LOKALU PRZY JANA PAWŁA II 30/2 W GORLICACH', `W LOKALU PRZY ${A} W GORLICACH`],
  ]);
});
test('dom3-fix2 pułapki detektora: liczebnik po „PRZY" i dopisek z obiektem w poprzednim wierszu', () => {
  masked([
    ['DZIAŁAJĄC PRZY ADAMA NOWAKA 5 RAZY', `DZIAŁAJĄC PRZY ${N} 5 RAZY`],
    [
      'Zebranie rodziców klasy 3a – Jana Pawła II 5 (sala gimnastyczna)\nMiejsce szkolenia: Kraków, Jana Pawła II 41 (budynek B), sala 12',
      `Zebranie rodziców klasy 3a – ${A} (sala gimnastyczna)\nMiejsce szkolenia: ${C}, ${A} (budynek B), sala 12`,
    ],
  ]);
});
test('dom3-fix2: wyciąg CSV — osoba i adres z patronem przed miejscowością w tej samej komórce', () => {
  masked([
    ['2025-01-05;Jan Pawła;Jana Pawła II 30/2 Kraków;150,00', `2025-01-05;${N};${A} Kraków;150,00`],
    ['2025-01-05;Jan Nowak;Jana Pawła II 30 Kraków;150,00', `2025-01-05;${N};${A} Kraków;150,00`],
  ]);
  // pułapka: wyraz spoza słownika miejscowości za numerem nie robi z pary adresu
  keep(['Laureat;Jana Pawła II 3 Miejsce;x']);
});
test('dom3-fix3: formularz z TAB-em — etykieta bez dwukropka tworzy parę z wartością', () => {
  masked([
    ['Imię\tAdam\tNazwisko\tNowak', `Imię\t${N}\tNazwisko\t${N}`],
    ['Imię\tAnna\tNazwisko\tNowak\tTelefon\t600100200', `Imię\t${N}\tNazwisko\t${N}\tTelefon\t[TELEFON]`],
    ['Imię:\tAdam\tNazwisko\tNowak', `Imię:\t${N}\tNazwisko\t${N}`],
    ['Imię:\tJan\tData ur.\t03.04.1980', `Imię:\t${N}\tData ur.\t[DATA-URODZENIA]`],
    ['Imię: Jan\tData ur. 03.04.1980', `Imię: ${N}\tData ur. [DATA-URODZENIA]`],
    ['Imię\tJan\tData ur.\t03.04.1980', `Imię\t${N}\tData ur.\t[DATA-URODZENIA]`],
    ['Imię:\tJan\tData ur.\t03.04.1980\tPESEL:\t44051401359', `Imię:\t${N}\tData ur.\t[DATA-URODZENIA]\tPESEL:\t[PESEL]`],
    ['Nazwisko\tNowak\tImię\tAdam', `Nazwisko\t${N}\tImię\t${N}`],
  ]);
  masked([['Imię\tAdam\tNazwisko\tNowak', 'Imię\t[IMIĘ I NAZWISKO]\tNazwisko\t[OSOBA-A]']], { pseudonyms: true });
  // pułapki: nagłówek tabeli (nazwy kolumn, wiersz danych pod spodem) to nie pary etykieta⇥wartość
  keep(['Imię i nazwisko\tLokal\tTelefon', 'Nazwisko\tImię\tStanowisko', 'Imię\tWiek\tNazwisko\tMiasto', 'Imię\tNazwisko\nLp\tUwagi']);
  masked([['Imię\tNazwisko\tDział\nJan\tKowalski\tKadry', `Imię\tNazwisko\tDział\n${N}\t${N}\tKadry`]]);
});
test('dom3-fix3: obiekt publiczny przed „PRZY" także poza pierwszym wierszem pisma', () => {
  keep([
    'Godziny otwarcia:\nAPTEKA PRZY TADEUSZA KOŚCIUSZKI 12 W TARNOWIE',
    'Ogłoszenie.\nKINO PRZY JANA PAWŁA II 3',
    'Ogłoszenie.\nPrzychodnia przy Jana Pawła II 30 w Krakowie.',
  ]);
  masked([
    ['Godziny otwarcia:\nApteka przy Tadeusza Kościuszki 12 w Tarnowie jest czynna.', `Godziny otwarcia:\nApteka przy ${N} 12 w Tarnowie jest czynna.`],
    // pułapki: obiekt w poprzednim wierszu nie zdejmuje adresu osoby
    ['Apteka\nJan Nowak zam. przy Tadeusza Kościuszki 12 w Tarnowie.', `Apteka\n${N} zam. przy ${A} w ${C}.`],
    ['Pismo.\nMieszkanie przy Tadeusza Kościuszki 12 w Tarnowie.', `Pismo.\nMieszkanie przy ${A} w ${C}.`],
  ]);
  keep(['Godziny otwarcia:\nApteka przy Tadeusza Kościuszki 12 w Tarnowie jest czynna.'].map((t) => t.replace('Apteka przy Tadeusza Kościuszki 12', 'APTEKA PRZY TADEUSZA KOŚCIUSZKI 12')));
});
test('dom3-fix3: WERSALIKI — tytuł utworu z numerem nie jest adresem ani osobą', () => {
  keep([
    'TRENY JANA KOCHANOWSKIEGO 19',
    'TREN JANA KOCHANOWSKIEGO 7',
    'DZIADY ADAMA MICKIEWICZA 3 W REŻYSERII',
    'BALLADY ADAMA MICKIEWICZA 5 I 6',
    'FRASZKI JANA KOCHANOWSKIEGO 12 W OPRACOWANIU',
    'TRENY JANA KOCHANOWSKIEGO 19 W WYDANIU Z 1580',
  ]);
  // pułapki: dokument osoby i lokal dalej maskują
  masked([
    ['NAJEMCA LOKALU ADAMA MICKIEWICZA 30/2.', `NAJEMCA LOKALU ${N} 30/2.`],
    ['MIESZKANIE PRZY ADAMA MICKIEWICZA 5 W LUBNIU', `MIESZKANIE PRZY ${A} W LUBNIU`],
  ]);
});
test('dom3-fix3: „Jana Pawła" i „Piotra Pawła" w dopełniaczu bez roli to osoba, poza patronem i papieżem', () => {
  masked([
    ['Żona Jana Pawła zeznała.', `Żona ${N} zeznała.`],
    ['Brat Jana Pawła mieszka w Lublinie.', `Brat ${N} mieszka w ${C}.`],
    ['Syn Jana Pawła ma 5 lat.', `Syn ${N} ma 5 lat.`],
    ['Mieszkanie Jana Pawła zostało zajęte.', `Mieszkanie ${N} zostało zajęte.`],
    ['Samochód Jana Pawła marki Opel.', `Samochód ${N} marki Opel.`],
    ['Konto Jana Pawła zablokowano.', `Konto ${N} zablokowano.`],
    ['Oględzin dokonano w obecności Piotra Pawła.', `Oględzin dokonano w obecności ${N}.`],
    ['Oględzin dokonano przy udziale Piotra Pawła.', `Oględzin dokonano przy udziale ${N}.`],
    ['Pouczono Piotra Pawła o prawach.', `Pouczono ${N} o prawach.`],
    ['Wezwano Michała Pawła do stawiennictwa.', `Wezwano ${N} do stawiennictwa.`],
    ['Zgłoszenie od Piotra Pawła, tel. 600 111 222.', `Zgłoszenie od ${N}, tel. [TELEFON].`],
    ['Wizyta Piotra Pawła w urzędzie.', `Wizyta ${N} w urzędzie.`],
    ['Ujawniono Jana Pawła (ur. 12.03.1985)', `Ujawniono ${N} (ur. [DATA-URODZENIA])`],
    ['Zatrzymano Jana Pawła, PESEL 85010312345.', `Zatrzymano ${N}, PESEL [PESEL].`],
    ['Legitymowano Piotra Pawła, zam. ul. Polna 5.', `Legitymowano ${N}, zam. ${A}.`],
    ['Zatrzymano Jana Pawła, ur. 12.03.1985 r.', `Zatrzymano ${N}, ur. [DATA-URODZENIA] r.`],
    ['Zatrzymano Jana Kazimierza, ur. 12.03.1985 r.', `Zatrzymano ${N}, ur. [DATA-URODZENIA] r.`],
  ]);
  masked([['Żona Jana Pawła zeznała. Jan Pawła odmówił.', 'Żona [OSOBA-A] zeznała. [OSOBA-A] odmówił.']], { pseudonyms: true });
  // pułapki: patron, papież, władca i wyliczenie imion zostają
  keep([
    'Szkoła im. Jana Pawła w Krakowie.',
    'Encyklika Jana Pawła o pracy.',
    'Pielgrzymka Jana Pawła do Polski.',
    'Ulica Jana Pawła została wyremontowana.',
    'Plac Jana Pawła zamknięto.',
    'Kościół św. Piotra Pawła w Krakowie.',
    'Za panowania Zygmunta Augusta powstała unia.',
    'Czasy Jana Kazimierza były trudne.',
    'Imieniny Jana i Pawła.',
    'Wizyta Jana Pawła II w Polsce.',
  ]);
});
test('dom3-fix3: telefon komórkowy w nazwie pliku z datą, wersją albo przedrostkiem zdjęcia', () => {
  masked([
    ['Plik: wniosek_2024-05-12_600111222.pdf', 'Plik: wniosek_2024-05-12_[TELEFON].pdf'],
    ['Plik: skan_dowodu_2024_600111222.pdf', 'Plik: skan_dowodu_2024_[TELEFON].pdf'],
    ['Załącznik: zdjecie_20240512_600111222.jpg', 'Załącznik: zdjecie_20240512_[TELEFON].jpg'],
    ['Plik: WhatsApp_600111222.jpg', 'Plik: WhatsApp_[TELEFON].jpg'],
    ['Plik: umowa_v2_600111222.pdf', 'Plik: umowa_v2_[TELEFON].pdf'],
    ['Plik: IMG_600111222.jpg', 'Plik: IMG_[TELEFON].jpg'],
  ]);
  // pułapki: kod wersalikami, numer bez prefiksu komórkowego, człon z kodem
  keep(['Plik: ZAM_600111222.pdf', 'Plik: FV_2024_600111222.pdf', 'Plik: faktura_2024_123456789.pdf', 'Klucz: abc_X1_600111222', 'Nr zamówienia ZAM_2024_600111222']);
});
