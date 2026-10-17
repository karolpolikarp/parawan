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
  expect(redactPII('Jan\tKowalski\tWarszawa').redacted).toBe('[IMIĘ I NAZWISKO]\tWarszawa');
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
    '[IMIĘ I NAZWISKO]\t[KOD-POCZTOWY]\t[MIEJSCOWOŚĆ]\tMazowieckie\tPolska',
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
    String.raw`{"sciezka": "C:\\Users\\nowak\\Documents\\raport.docx"}`,
    String.raw`{"sciezka": "C:\\nowy\\Tomasz\\plik.txt"}`,
    String.raw`Ścieżka C:\Users\nowak\Documents\raport.docx oraz C:\temp\new\Raport2024.txt`,
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
    ['tel. 0 512 345 678', 'tel. 0 [TELEFON]'],
    ['Zadzwoń 600 700 800, zła wiadomość', 'Zadzwoń [TELEFON], zła wiadomość'],
    ['Kwota 512 345 678\nzł', 'Kwota [TELEFON]\nzł'],
    ['tel. 500 000 000', 'tel. [TELEFON]'],
    ['Abonament 49 zł 600 100 200', 'Abonament 49 zł [TELEFON]'],
    ['601 234 567 Złotów', '[TELEFON] Złotów'],
    ['Numer: 48 512 345 678', 'Numer: 48 [TELEFON]'],
    // etykieta identyfikatora przed grupami cyfr: to nie ogon kwoty (PESEL rozbity spacjami — osobna klasa)
    ['Numer PESEL: 85 110 314 283', 'Numer PESEL: 85 [TELEFON]'],
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
    ['Zestaw: ciągnik WGM1234A/WGM5678B wjechał na plac.', `Zestaw: ciągnik ${R}/WGM5678B wjechał na plac.`],
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
    ['scp plik.txt jan.kowalski@serwer.firma.pl:/home/jan/', 'scp plik.txt [EMAIL]:/home/jan/'],
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
    ['NOWAK JAN 602 345 678 ZŁOŻYŁ WNIOSEK', 'NOWAK JAN [TELEFON] ZŁOŻYŁ WNIOSEK'],
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
