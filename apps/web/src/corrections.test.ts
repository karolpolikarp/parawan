import { readFileSync } from 'node:fs';
import { redactPII } from 'anonimizator';
import { describe, expect, test } from 'vitest';
import {
  applyCorrections,
  correctionCounts,
  type Decision,
  defaultToken,
  findOccurrences,
  lineRanges,
  personKey,
  shiftDecisions,
  snapSelection,
  spanKey,
} from './corrections';
import { finalText } from './output';
import { alignSpans, applySpans, type Span } from './spans';

const DECYZJA = readFileSync(new URL('./fixtures/urzad/decyzja.txt', import.meta.url), 'utf8');

/** Zakresy automatyczne tekstu, jak w aplikacji (redactPII, potem alignSpans w trybie ścisłym). */
function auto(text: string, opts: Parameters<typeof redactPII>[1] = {}): { redacted: string; spans: Span[] } {
  const { redacted } = redactPII(text, opts);
  const al = alignSpans(text, redacted);
  if (!al) throw new Error(`brak zakresów dla: ${text.slice(0, 60)}`);
  return { redacted, spans: al.spans };
}

const at = (text: string, needle: string, from = 0): { start: number; end: number } => {
  const start = text.indexOf(needle, from);
  if (start === -1) throw new Error(`brak „${needle}”`);
  return { start, end: start + needle.length };
};

/** Decyzja „Zostaw jawne wszędzie” jak w aplikacji: miejsca zakresów o tym samym kluczu z tej chwili. */
const sameAs = (text: string, spans: Span[], span: Span, label: string): Decision => {
  const key = spanKey(text, span);
  const ranges = spans.filter((s) => spanKey(text, s) === key).map((s): [number, number] => [s.start, s.end]);
  return { kind: 'keep', scope: 'same', label, ranges };
};

const final = (text: string, spans: Span[], decisions: Decision[]): string =>
  applySpans(text, applyCorrections(text, spans, decisions).spans);

describe('klucz „ta sama osoba”', () => {
  test('imię po 3 literach i nazwisko po kluczu rdzenia, w każdym przypadku', () => {
    const k = personKey('Jan Nowak');
    expect(personKey('Jana Nowaka')).toBe(k);
    expect(personKey('Janowi Nowakowi')).toBe(k);
    expect(personKey('JAN NOWAK')).toBe(k);
    expect(personKey('Tomasza Wierzbickiego')).toBe(personKey('Tomasz Wierzbicki'));
    expect(personKey('Tomaszowi Wierzbickiemu')).toBe(personKey('TOMASZ WIERZBICKI'));
  });
  test('inne imię, inicjał i samo nazwisko to inne osoby', () => {
    const k = personKey('Jan Nowak');
    expect(personKey('Anna Nowak')).not.toBe(k);
    expect(personKey('J. Nowak')).not.toBe(k);
    expect(personKey('Nowak')).not.toBe(k);
    expect(personKey('Marii Wierzbickiej')).not.toBe(personKey('Tomasz Wierzbicki'));
  });
  test('całe imię, nie 3 litery: Jan, Janina i Janusz to trzy osoby, Marek i Maria dwie', () => {
    const jan = personKey('Jan Nowak');
    for (const n of ['Janina Nowak', 'Janusz Nowak', 'Janiny Nowak']) expect(personKey(n)).not.toBe(jan);
    expect(personKey('Janinie Nowak')).toBe(personKey('Janina Nowak'));
    expect(personKey('Januszowi Nowakowi')).toBe(personKey('Janusz Nowak'));
    expect(personKey('Marka Nowaka')).toBe(personKey('Marek Nowak'));
    expect(personKey('Marii Nowak')).toBe(personKey('Maria Nowak'));
    expect(personKey('Maria Nowak')).not.toBe(personKey('Marek Nowak'));
    expect(personKey('Antoniego Nowaka')).toBe(personKey('Antoni Nowak'));
    expect(personKey('Pawła Nowaka')).toBe(personKey('Paweł Nowak'));
  });
  test('dane numeryczne po samych cyfrach, inne po tekście bez wielkości liter', () => {
    const t = '600 700 800 i 600-700-800, ul. Lipowa 5 i UL. LIPOWA  5';
    const tel = { tokens: ['TELEFON'] };
    expect(spanKey(t, { ...at(t, '600 700 800'), ...tel })).toBe(spanKey(t, { ...at(t, '600-700-800'), ...tel }));
    const adr = { tokens: ['ADRES'] };
    expect(spanKey(t, { ...at(t, 'ul. Lipowa 5'), ...adr })).toBe(spanKey(t, { ...at(t, 'UL. LIPOWA  5'), ...adr }));
  });
});

describe('„Zostaw jawne”', () => {
  test('tutaj: odsłania jeden znacznik, reszta zostaje', () => {
    const text = 'Jan Nowak złożył wniosek. Jana Nowaka poinformowano.';
    const { spans } = auto(text);
    expect(spans.length).toBe(2);
    const r = applyCorrections(text, spans, [{ kind: 'keep', scope: 'here', ...at(text, 'Jan Nowak') }]);
    expect(applySpans(text, r.spans)).toBe('Jan Nowak złożył wniosek. [IMIĘ I NAZWISKO] poinformowano.');
    expect(r.kept).toEqual([spans[0]]);
    expect(r.effects).toEqual([1]);
    expect(correctionCounts(r)).toEqual({ kept: 1, masked: 0 });
  });

  test('wszędzie: łączy „Jan Nowak” i „Jana Nowaka”, nie łączy „Anna Nowak” ani „J. Nowak”', () => {
    const text = 'Jan Nowak, Anna Nowak i J. Nowak. Pismo do Jana Nowaka.';
    const spans: Span[] = ['Jan Nowak', 'Anna Nowak', 'J. Nowak', 'Jana Nowaka'].map((n) => ({
      ...at(text, n, n === 'Jan Nowak' ? 0 : 1),
      tokens: ['IMIĘ I NAZWISKO'],
      gaps: [],
      source: 'auto',
    }));
    const out = final(text, spans, [sameAs(text, spans, spans[0], 'Jan Nowak')]);
    expect(out).toBe('Jan Nowak, [IMIĘ I NAZWISKO] i [IMIĘ I NAZWISKO]. Pismo do Jana Nowaka.');
  });

  test('wszędzie w decyzji: podpis wójta jawny, wnioskodawca zasłonięty we wszystkich formach', () => {
    const { spans } = auto(DECYZJA);
    const sig = spans.find((s) => DECYZJA.slice(s.start, s.end).includes('Kędzierski'));
    expect(sig).toBeDefined();
    const out = final(DECYZJA, spans, [sameAs(DECYZJA, spans, sig as Span, 'Sławomir Kędzierski')]);
    expect(out).toContain('Sławomir Kędzierski');
    expect(out).toContain('[PESEL]');
    expect(out).not.toMatch(/Wierzbick|WIERZBICK/);
  });

  test('wszędzie: tylko formy z chwili decyzji, osoba dopisana później zostaje zasłonięta', () => {
    // Józef i Józefa w dopełniaczu mają ten sam rdzeń, więc klucz ich nie rozróżni; lista form tak
    const before = 'Pismo podpisał Józef Lis.';
    const s1 = auto(before).spans;
    const d = sameAs(before, s1, s1[0], 'Józef Lis');
    const after = `${before} Otrzymuje: Józefa Lis.`;
    const s2 = auto(after).spans;
    expect(s2.length).toBe(2);
    expect(spanKey(after, s2[0])).toBe(spanKey(after, s2[1]));
    expect(final(after, s2, [d])).toBe('Pismo podpisał Józef Lis. Otrzymuje: [IMIĘ I NAZWISKO].');
  });

  test('tutaj: zakres szerszy niż miejsce decyzji (PESEL dopisany za nazwiskiem) zostaje zasłonięty', () => {
    const text = 'Podpisał Jan Kowalski 44051401359 w sprawie.';
    const { spans } = auto(text);
    expect(spans[0].tokens.length).toBe(2);
    const name = at(text, 'Jan Kowalski');
    const r = applyCorrections(text, spans, [{ kind: 'keep', scope: 'here', ...name }]);
    expect(applySpans(text, r.spans)).toBe(applySpans(text, spans));
    expect(r.effects).toEqual([0]);
  });

  test('zakres grupowy schodzi w całości', () => {
    const text = 'Jan Kowalski 44051401359 mieszka tu.';
    const { spans } = auto(text);
    expect(spans[0].tokens.length).toBe(2);
    const r = applyCorrections(text, spans, [{ kind: 'keep', scope: 'here', start: spans[0].start, end: spans[0].end }]);
    expect(applySpans(text, r.spans)).toBe(text);
    expect(correctionCounts(r).kept).toBe(2);
  });
});

describe('„Zasłoń zaznaczenie”', () => {
  test('numer księgi wieczystej jako [DANE] i redactPII wyniku zostawia [DANE]', () => {
    const { spans } = auto(DECYZJA);
    const kw = at(DECYZJA, 'OS1W/00045123/6');
    const out = final(DECYZJA, spans, [{ kind: 'mask', scope: 'here', ...kw, token: 'DANE' }]);
    expect(out).toContain('(księga wieczysta nr [DANE])');
    expect(out).not.toContain('00045123');
    const again = redactPII(out).redacted;
    expect(again.match(/\[DANE\]/g)?.length).toBe(1);
    expect(again).toContain('(księga wieczysta nr [DANE])');
  });

  test('zaznaczenie zahaczające o znacznik rozszerza się na cały zakres', () => {
    const text = 'Wpłynęło od Marka Jana Kowalskiego 12 maja.';
    const spans: Span[] = [{ ...at(text, 'Jana Kowalskiego'), tokens: ['IMIĘ I NAZWISKO'], gaps: [], source: 'auto' }];
    // zaznaczenie od „Marka” do połowy nazwiska
    const sel = snapSelection(text, text.indexOf('Marka'), text.indexOf('Kowal') + 3, spans);
    expect(sel).toEqual({ start: text.indexOf('Marka'), end: spans[0].end });
    const r = applyCorrections(text, spans, [{ kind: 'mask', scope: 'here', ...(sel as { start: number; end: number }), token: 'IMIĘ I NAZWISKO' }]);
    expect(applySpans(text, r.spans)).toBe('Wpłynęło od [IMIĘ I NAZWISKO] 12 maja.');
    expect(r.spans[0].source).toBe('manual');
    // to samo bez snapSelection: suma przedziałów w applyCorrections
    expect(final(text, spans, [{ kind: 'mask', scope: 'here', start: text.indexOf('Marka'), end: text.indexOf('Marka') + 5, token: 'DANE' }])).toBe(
      'Wpłynęło od [DANE] [IMIĘ I NAZWISKO] 12 maja.',
    );
    expect(final(text, spans, [{ kind: 'mask', scope: 'here', start: text.indexOf('Marka'), end: text.indexOf('Jana') + 2, token: 'DANE' }])).toBe(
      'Wpłynęło od [DANE] 12 maja.',
    );
  });

  test('zaznaczenie wewnątrz zasłoniętego zakresu nic nie zmienia', () => {
    const text = 'PESEL 44051401359.';
    const { spans } = auto(text);
    const r = applyCorrections(text, spans, [{ kind: 'mask', scope: 'here', start: spans[0].start + 2, end: spans[0].start + 5, token: 'DANE' }]);
    expect(applySpans(text, r.spans)).toBe('PESEL [PESEL].');
    expect(r.effects).toEqual([0]);
  });

  test('wszystkie wystąpienia na granicach wyrazów z polskimi literami', () => {
    const text = 'Anna, Annasz, ANNA, Hanna i Żanna. Anną zajęła się Anna.';
    expect(findOccurrences(text, 'Anna', 'DANE').map(([a, b]) => text.slice(a, b))).toEqual(['Anna', 'ANNA', 'Anna']);
    expect(findOccurrences('Łódź i Łódźka, ŁÓDŹ.', 'łódź', 'MIEJSCOWOŚĆ').length).toBe(2);
    // jednowyrazowa osoba łapie też formy o tym samym kluczu nazwiska, tylko z wielkiej litery
    const t2 = 'Pan Malec, panu Malcowi, Malca nie ma. Mały malec płacze.';
    const forms = findOccurrences(t2, 'Malec', 'IMIĘ I NAZWISKO').map(([a, b]) => t2.slice(a, b));
    expect(forms).toContain('Malec');
    expect(forms).not.toContain('malec');
  });

  test('„z żoną Anną”: [IMIĘ I NAZWISKO] wszędzie, nie w „Annasz”', () => {
    const text = 'Przyszedł z żoną Anną. Pani Annasz czekała. Anną zajmie się sekretariat.';
    const out = final(text, [], [{ kind: 'mask', scope: 'all', text: 'Anną', token: 'IMIĘ I NAZWISKO' }]);
    expect(out).toBe('Przyszedł z żoną [IMIĘ I NAZWISKO]. Pani Annasz czekała. [IMIĘ I NAZWISKO] zajmie się sekretariat.');
  });

  test('domyślny rodzaj: z wielkiej litery osoba, reszta inne dane', () => {
    expect(defaultToken('Anną')).toBe('IMIĘ I NAZWISKO');
    expect(defaultToken('  Łukasz')).toBe('IMIĘ I NAZWISKO');
    expect(defaultToken('OS1W/00045123/6')).toBe('DANE');
    expect(defaultToken('245/7')).toBe('DANE');
    expect(defaultToken('nr 245/7')).toBe('DANE');
  });

  test('zaznaczenie przycięte do wyrazów, wiersze osobno', () => {
    const text = 'ab Kowalskiego cd\nPiotr Lis';
    expect(snapSelection(text, 4, 8, [])).toEqual(at(text, 'Kowalskiego'));
    expect(snapSelection(text, 2, 3, [])).toBeNull();
    // numer z ukośnikami i łącznikami w całości, kropka na końcu zdania zostaje poza zakresem
    const kw = 'księga nr OS1W/00045123/6. Pani Nowak-Kowalska.';
    expect(snapSelection(kw, kw.indexOf('0004'), kw.indexOf('0004') + 3, [])).toEqual(at(kw, 'OS1W/00045123/6'));
    expect(snapSelection(kw, kw.indexOf('Kowal'), kw.indexOf('Kowal') + 2, [])).toEqual(at(kw, 'Nowak-Kowalska'));
    expect(lineRanges(text, 3, text.length).map(([a, b]) => text.slice(a, b))).toEqual(['Kowalskiego cd', 'Piotr Lis']);
  });
});

describe('kolejność decyzji i cofanie', () => {
  const text = 'Jan Nowak i Jana Nowaka.';
  const spans: Span[] = [
    { ...at(text, 'Jan Nowak'), tokens: ['IMIĘ I NAZWISKO'], gaps: [], source: 'auto' },
    { ...at(text, 'Jana Nowaka'), tokens: ['IMIĘ I NAZWISKO'], gaps: [], source: 'auto' },
  ];
  const keepAll = sameAs(text, spans, spans[0], 'Jan Nowak');
  const remask: Decision = { kind: 'mask', scope: 'here', start: spans[1].start, end: spans[1].end, token: 'IMIĘ I NAZWISKO' };

  test('późniejsza decyzja wygrywa', () => {
    expect(final(text, spans, [keepAll, remask])).toBe('Jan Nowak i [IMIĘ I NAZWISKO].');
    expect(final(text, spans, [remask, keepAll])).toBe('Jan Nowak i Jana Nowaka.');
    // „Zasłoń ponownie” przywraca zakres automatyczny, a nie ręczny
    expect(applyCorrections(text, spans, [keepAll, remask]).spans[0].source).toBe('auto');
  });

  test('cofanie to usunięcie decyzji z listy: wynik wraca do stanu sprzed niej', () => {
    const decisions = [keepAll, remask];
    expect(final(text, spans, decisions.slice(0, -1))).toBe('Jan Nowak i Jana Nowaka.');
    expect(final(text, spans, decisions.filter((d) => d !== keepAll))).toBe(applySpans(text, spans));
    expect(final(text, spans, [])).toBe(applySpans(text, spans));
  });

  test('„Zostaw jawne” na fragmencie zasłoniętym ręcznie zdejmuje go, a wchłonięty znacznik automatu wraca', () => {
    const t = 'Wpłynęło od Marka Jana Kowalskiego.';
    const s: Span[] = [{ ...at(t, 'Jana Kowalskiego'), tokens: ['IMIĘ I NAZWISKO'], gaps: [], source: 'auto' }];
    const mask: Decision = { kind: 'mask', scope: 'here', ...at(t, 'Marka'), token: 'IMIĘ I NAZWISKO' };
    expect(final(t, s, [mask])).toBe('Wpłynęło od [IMIĘ I NAZWISKO] [IMIĘ I NAZWISKO].');
    const merged = { kind: 'mask' as const, scope: 'here' as const, start: t.indexOf('Marka'), end: s[0].end, token: 'IMIĘ I NAZWISKO' };
    const r = applyCorrections(t, s, [merged, { kind: 'keep', scope: 'here', start: merged.start, end: merged.end }]);
    expect(applySpans(t, r.spans)).toBe('Wpłynęło od Marka [IMIĘ I NAZWISKO].');
    expect(r.kept).toEqual([]);
  });
});

describe('„Cofnij zasłonięcie” (unmask)', () => {
  const text = 'Wnioskodawca, PESEL 44051401359, złożonego 3 maja, mieszka w Lublinie.';
  const unmaskAt = (t: string, spans: Span[], d: Decision[]): Decision => {
    const r = applyCorrections(t, spans, d);
    const m = r.spans.find((s) => s.source === 'manual');
    if (!m) throw new Error('brak zakresu ręcznego');
    return { kind: 'unmask', scope: 'here', start: m.start, end: m.end };
  };

  test('zasłonięcie „wszędzie” wchłaniające PESEL: cofnięcie wraca do [PESEL], nie odsłania automatu', () => {
    const { spans, redacted } = auto(text);
    expect(redacted).toContain('[PESEL]');
    const mask: Decision = { kind: 'mask', scope: 'all', text: '44051401359, złożonego', token: 'DANE' };
    expect(final(text, spans, [mask])).toContain('[DANE] 3 maja');
    const d = [mask, unmaskAt(text, spans, [mask])];
    const r = applyCorrections(text, spans, d);
    expect(applySpans(text, r.spans)).toBe(redacted);
    expect(r.kept).toEqual([]);
    expect(r.effects).toEqual([1, 1]);
    expect(correctionCounts(r)).toEqual({ kept: 0, masked: 0 });
  });

  test('zakres ręczny, który urósł po włączeniu typu: cofnięcie zostawia adres zasłonięty', () => {
    const t = 'Strona zam. ul. Lipowa 17, Lublin.';
    const adres: Span = { ...at(t, 'ul. Lipowa 17'), tokens: ['ADRES'], gaps: [], source: 'auto' };
    const mask: Decision = { kind: 'mask', scope: 'here', ...at(t, 'zam. ul. Lipowa'), token: 'ADRES' };
    // przy wyłączonym „Adres” zakres ręczny to samo zaznaczenie, po włączeniu wchłania adres automatu
    expect(final(t, [], [mask])).toBe('Strona [ADRES] 17, Lublin.');
    const grown = unmaskAt(t, [adres], [mask]);
    expect(grown).toMatchObject(at(t, 'zam. ul. Lipowa 17'));
    expect(final(t, [adres], [mask, grown])).toBe('Strona zam. [ADRES], Lublin.');
  });

  test('cofnięcie wraca do stanu sprzed zasłonięcia: odsłonięty wcześniej znacznik znów jawny, starsze zasłonięcie wraca', () => {
    const { spans } = auto(text);
    const keep: Decision = { kind: 'keep', scope: 'here', start: spans[0].start, end: spans[0].end };
    const mask: Decision = { kind: 'mask', scope: 'here', ...at(text, 'PESEL 44051401359'), token: 'DANE' };
    const d = [keep, mask];
    expect(final(text, spans, d)).toContain('[DANE]');
    const r = applyCorrections(text, spans, [...d, unmaskAt(text, spans, d)]);
    expect(applySpans(text, r.spans)).toBe(final(text, spans, [keep]));
    expect(r.kept).toEqual([spans[0]]);
    // zasłonięcie nachodzące na starsze ręczne: cofnięcie młodszego przywraca starsze
    const a: Decision = { kind: 'mask', scope: 'here', ...at(text, 'złożonego'), token: 'DANE' };
    const b: Decision = { kind: 'mask', scope: 'here', ...at(text, 'złożonego 3 maja'), token: 'DANE' };
    expect(final(text, spans, [a, b, unmaskAt(text, spans, [a, b])])).toBe(final(text, spans, [a]));
  });

  test('„Cofnij zasłonięcie wszędzie” na zakresach, które wchłonęły PESEL: wraca [PESEL] w każdym miejscu', () => {
    const t = 'Wniosek, PESEL 85071412358, złożony dnia 3 maja.\nPonownie: PESEL 85071412358, złożony dnia 3 maja.';
    const { spans, redacted } = auto(t);
    expect(redacted.match(/\[PESEL\]/g)).toHaveLength(2);
    const mask: Decision = { kind: 'mask', scope: 'all', text: '85071412358, złożony', token: 'DANE' };
    const manual = applyCorrections(t, spans, [mask]).spans.filter((s) => s.source === 'manual');
    expect(manual).toHaveLength(2);
    const ranges = manual.map((s): [number, number] => [s.start, s.end]);
    const unmaskAll: Decision = { kind: 'unmask', scope: 'same', label: '', ranges };
    const r = applyCorrections(t, spans, [mask, unmaskAll]);
    expect(applySpans(t, r.spans)).toBe(redacted);
    expect(r.kept).toEqual([]);
    expect(r.effects).toEqual([2, 2]);
    // zakresu automatu o tym samym kluczu nie odsłania: działa tylko na zasłonięcia ręczne
    const pesel = spans.find((s) => s.tokens[0] === 'PESEL') as Span;
    const onAuto: Decision = { kind: 'unmask', scope: 'same', label: '', ranges: [[pesel.start, pesel.end]] };
    expect(applyCorrections(t, spans, [onAuto]).effects).toEqual([0]);
  });

  test('numer decyzji zasłonięcia przy każdym zakresie ręcznym (by), -1 przy automacie', () => {
    const { spans } = auto(text);
    const r = applyCorrections(text, spans, [{ kind: 'mask', scope: 'all', text: 'maja', token: 'DANE' }]);
    expect(r.by).toEqual(r.spans.map((s) => (s.source === 'manual' ? 0 : -1)));
    expect(r.by).toContain(0);
  });
});

describe('zaznaczenie wewnątrz znacznika', () => {
  test('„Jan” w zakresie „Jan Kowalski” rozszerza się do całego zakresu, a nie do każdego „Jan”', () => {
    const t = 'Jan Kowalski i Jan Nowak.';
    const spans = [{ ...at(t, 'Jan Kowalski') }];
    expect(snapSelection(t, 0, 3, spans)).toEqual(at(t, 'Jan Kowalski'));
    // z prawej strony zakresu też
    expect(snapSelection(t, t.indexOf('Kowal'), t.indexOf('Kowal') + 3, spans)).toEqual(at(t, 'Jan Kowalski'));
  });
});

describe('edycja tekstu źródłowego', () => {
  test('przesunięcie przez wspólny początek i koniec, odrzucenie w zmienionym fragmencie', () => {
    const before = 'AAA Jan Nowak BBB Piotr Lis CCC';
    const after = 'AAA Jan Nowak BBB, dopisek, Piotr Lis CCC';
    const d: Decision[] = [
      { kind: 'keep', scope: 'here', ...at(before, 'Jan Nowak') },
      { kind: 'mask', scope: 'here', ...at(before, 'Piotr Lis'), token: 'DANE' },
      { kind: 'mask', scope: 'here', ...at(before, 'BBB'), token: 'DANE' },
      { kind: 'mask', scope: 'all', text: 'CCC', token: 'DANE' },
    ];
    const r = shiftDecisions(before, after, d);
    expect(r.dropped).toBe(0);
    expect(r.decisions[0]).toEqual(d[0]);
    expect(r.decisions[1]).toMatchObject(at(after, 'Piotr Lis'));
    expect(r.decisions[2]).toMatchObject(at(after, 'BBB'));
    expect(r.decisions[3]).toBe(d[3]);
    // zmiana w środku zakresu: „Zostaw jawne” odpada, zasłonięcie obejmuje cały nowy wyraz
    const changed = 'AAA Jan Nowak BBB Piotr Lisowski CCC';
    const r2 = shiftDecisions(before, changed, d);
    expect(r2.dropped).toBe(0);
    expect(r2.decisions[1]).toMatchObject(at(changed, 'Piotr Lisowski'));
    const r3 = shiftDecisions(before, 'AAA Jan Nowakowski BBB Piotr Lis CCC', d);
    expect(r3.dropped).toBe(1);
    expect(r3.decisions.length).toBe(3);
    expect(shiftDecisions(before, before, d)).toEqual({ decisions: d, dropped: 0, reveals: 0 });
  });

  test('decyzje nakładane na nowe zakresy po zmianie „Rozróżniaj osoby”', () => {
    const text = 'Jan Nowak i Jana Nowaka oraz Ewa Lis.';
    const plain = auto(text);
    const decisions = [sameAs(text, plain.spans, plain.spans[0], 'Jan Nowak')];
    const pseudo = auto(text, { pseudonyms: true });
    expect(pseudo.redacted).toMatch(/\[OSOBA-[A-Z]\]/);
    const out = final(text, pseudo.spans, decisions);
    expect(out).toContain('Jan Nowak i Jana Nowaka');
    expect(out).not.toContain('Ewa Lis');
  });
});

test('finalText bierze wynik z poprawkami, a bez zakresów sam wynik rdzenia', () => {
  const text = 'Jan Nowak, PESEL 44051401359.';
  const { redacted, spans } = auto(text);
  const decisions: Decision[] = [{ kind: 'keep', scope: 'here', start: 0, end: 9 }];
  expect(finalText({ redacted, original: text, spans, decisions })).toBe('Jan Nowak, PESEL [PESEL].');
  expect(finalText({ redacted, original: text, spans: null, decisions })).toBe(redacted);
  expect(finalText({ redacted, original: text, spans, decisions: [] })).toBe(redacted);
});

test('edycja przyklejona do zakresu odrzuca „Zostaw jawne”, a zasłonięcie rozszerza do całego wyrazu', () => {
  const before = 'Pismo do Piotr Lis w sprawie.';
  const keep: Decision[] = [{ kind: 'keep', scope: 'here', ...at(before, 'Lis') }];
  expect(shiftDecisions(before, 'Pismo do Piotr Lisowski w sprawie.', keep).dropped).toBe(1);
  expect(shiftDecisions(before, 'Pismo do Piotr Lis, w sprawie.', keep).dropped).toBe(0);
  expect(shiftDecisions(before, 'Pismo do Piotr XLis w sprawie.', keep).dropped).toBe(1);
  expect(shiftDecisions(before, 'Pismo do Piotr X Lis w sprawie.', keep).decisions[0]).toMatchObject({ start: before.indexOf('Lis') + 2 });
  // zasłonięcie: lepiej zasłonić więcej niż zostawić „owski” jawne
  const mask: Decision[] = [{ kind: 'mask', scope: 'here', ...at(before, 'Lis'), token: 'DANE' }];
  const longer = 'Pismo do Piotr Lisowski w sprawie.';
  expect(shiftDecisions(before, longer, mask).decisions[0]).toMatchObject(at(longer, 'Lisowski'));
  const front = 'Pismo do Piotr XLis w sprawie.';
  expect(shiftDecisions(before, front, mask).decisions[0]).toMatchObject(at(front, 'XLis'));
  // zmiana w środku zasłoniętego tekstu: zasłonięcie obejmuje poprawiony wyraz
  const typo = 'Pismo do Piotr Lks w sprawie.';
  expect(shiftDecisions(before, typo, mask)).toMatchObject({ dropped: 0, decisions: [at(typo, 'Lks')] });
  // usunięcie całego zasłoniętego tekstu: nie ma czego zasłaniać, decyzja odpada
  expect(shiftDecisions(before, 'Pismo do Piotr  w sprawie.', mask).dropped).toBe(1);
});

describe('zasłonięcie po pewnej edycji w nim albo przy nim (runda 2)', () => {
  const T = 'Kod dostępu do skrzynki: Trzmielowa-Zagroda-77QX, proszę nie udostępniać. Zagroda stoi.';
  const typo = T.replace('Trzmielowa-Zagroda', 'Trzmielowa-Zagxoda');

  test('literówka poprawiona wewnątrz zasłonięcia „tutaj” zostaje zasłonięta', () => {
    const d: Decision[] = [{ kind: 'mask', scope: 'here', ...at(T, 'Zagroda'), token: 'DANE' }];
    expect(shiftDecisions(T, typo, d)).toMatchObject({ dropped: 0, decisions: [at(typo, 'Zagxoda')] });
  });

  test('„wszędzie”: zmienione miejsce dostaje zasłonięcie „tutaj”, pozostałe wystąpienia zostają', () => {
    const d: Decision[] = [{ kind: 'mask', scope: 'all', text: 'Zagroda', token: 'DANE' }];
    const r = shiftDecisions(T, typo, d);
    expect(r.dropped).toBe(0);
    expect(r.decisions).toEqual([d[0], { kind: 'mask', scope: 'here', ...at(typo, 'Zagxoda'), token: 'DANE' }]);
    const out = final(typo, auto(typo).spans, r.decisions);
    expect(out).not.toContain('Zag');
  });

  test('„wszędzie”: litera doklejona do jedynego wystąpienia numeru nie odsłania go', () => {
    const t = 'Działka, księga wieczysta nr KR1P/00012345/9.\nUzasadnienie sprawy.';
    const glued = t.replace('/9.', '/9a.');
    const d: Decision[] = [{ kind: 'mask', scope: 'all', text: 'KR1P/00012345/9', token: 'DANE' }];
    const r = shiftDecisions(t, glued, d);
    expect(r).toMatchObject({ dropped: 0, decisions: [{ kind: 'mask', scope: 'here', ...at(glued, 'KR1P/00012345/9a') }] });
    expect(final(glued, auto(glued).spans, r.decisions)).not.toContain('00012345');
    // usunięta spacja i kropka między wyrazami: „sprawy.\nSkarżący” → „sprawykarżący”
    const w = 'Opis sprawy.\nSkarżący wnosi.';
    const joined = 'Opis sprawykarżący wnosi.';
    const r2 = shiftDecisions(w, joined, [{ kind: 'mask', scope: 'all', text: 'sprawy', token: 'DANE' }]);
    expect(r2.dropped).toBe(0);
    expect(final(joined, auto(joined).spans, r2.decisions)).toBe('Opis [DANE] wnosi.');
  });

  test('„wszędzie” bez żadnego wystąpienia po zmianie odpada z komunikatem', () => {
    const t = 'Opis: Zagroda.';
    const r = shiftDecisions(t, 'Opis: .', [{ kind: 'mask', scope: 'all', text: 'Zagroda', token: 'DANE' }]);
    expect(r).toEqual({ decisions: [], dropped: 1, reveals: 0 });
  });
});

describe('zmiana źródła, której nie da się zmapować przesunięciem', () => {
  const A = 'Skarżący Jan Kowalski, zam. ul. Lipowa 5, księga OS1W/00045123/6. Uzasadnienie jest krótkie.';
  const B = 'Sprawę prowadzi inspektor Jan Kowalski. Księga OS1W/00045123/6. Uzasadnienie jest krótkie.';

  test('decyzje odsłaniające odpadają wszystkie, także „wszędzie” i „Cofnij zasłonięcie”', () => {
    const d: Decision[] = [
      { kind: 'keep', scope: 'here', ...at(B, 'Jan Kowalski') },
      { kind: 'keep', scope: 'same', label: 'Jan Kowalski', ranges: [[at(B, 'Jan Kowalski').start, at(B, 'Jan Kowalski').end]] },
      { kind: 'unmask', scope: 'here', ...at(B, 'Uzasadnienie') },
    ];
    const r = shiftDecisions(B, A, d, false);
    expect(r).toEqual({ decisions: [], dropped: 3, reveals: 3 });
    // ta sama zmiana jako pewna przesuwa decyzje spoza zmienionego fragmentu
    expect(shiftDecisions(B, `${B} Koniec.`, d).decisions).toEqual(d);
  });

  test('zasłonięcie „tutaj” zostaje tylko tam, gdzie jego tekst dalej stoi, „wszędzie” tylko gdy tekst występuje', () => {
    const tail = at(B, 'Uzasadnienie');
    const d: Decision[] = [
      { kind: 'mask', scope: 'here', ...tail, token: 'DANE' },
      { kind: 'mask', scope: 'here', ...at(B, 'inspektor'), token: 'DANE' },
      { kind: 'mask', scope: 'all', text: 'OS1W/00045123/6', token: 'DANE' },
      { kind: 'mask', scope: 'all', text: 'inspektor', token: 'DANE' },
    ];
    const r = shiftDecisions(B, A, d, false);
    expect(r.dropped).toBe(2);
    expect(r.reveals).toBe(0);
    expect(r.decisions).toEqual([
      { ...d[0], ...at(A, 'Uzasadnienie') },
      d[2],
    ]);
  });

  test('„Zostaw jawne wszędzie” obejmuje tylko miejsca z chwili decyzji: wklejona później osoba zostaje zasłonięta', () => {
    const t = 'Sprawę prowadzi inspektor Jan Kowalski. Zatwierdził Jan Kowalski.';
    const { spans } = auto(t);
    const keep = sameAs(t, spans, spans[0], 'Jan Kowalski');
    const added = `${t} Wnioskodawca Jan Kowalski, PESEL 44051401359.`;
    const moved = shiftDecisions(t, added, [keep]);
    expect(moved.dropped).toBe(0);
    const out = final(added, auto(added).spans, moved.decisions);
    expect(out).toContain('Zatwierdził Jan Kowalski.');
    expect(out).toContain('Wnioskodawca [IMIĘ I NAZWISKO]');
  });

  test('„Zostaw jawne” na fragmencie zasłoniętym ręcznie nie odsłania wchłoniętego PESEL-u', () => {
    const t = 'Wniosek, PESEL 85071412358, złożony dnia 3 maja.\nPonownie: PESEL 85071412358, złożony dnia 3 maja.';
    const { spans, redacted } = auto(t);
    const mask: Decision = { kind: 'mask', scope: 'all', text: '85071412358, złożony', token: 'DANE' };
    const manual = applyCorrections(t, spans, [mask]).spans.filter((s) => s.source === 'manual');
    const keep: Decision = { kind: 'keep', scope: 'same', label: '', ranges: manual.map((s): [number, number] => [s.start, s.end]) };
    const r = applyCorrections(t, spans, [mask, keep]);
    expect(applySpans(t, r.spans)).toBe(redacted);
    expect(r.kept).toEqual([]);
  });
});
