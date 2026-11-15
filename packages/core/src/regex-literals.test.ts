// Filtr napisów gwarancji i przeszukiwanie przy nich: wynik zawsze ten sam co zwykłe replace.
import { expect, test } from 'vitest';
import { LiteralIndex, literalsPresent, NearMatcher, nearSearchable, replaceNear, replaceTracked, requiredLiterals } from './regex-literals';

const LETTER = 'a-ząćęłńóśźżA-ZĄĆĘŁŃÓŚŹŻ';
const WS = String.raw`(?:[ \t]{1,4}|[ \t]{0,4}\r?\n[ \t]{0,8})`;
const PATTERNS: RegExp[] = [
  new RegExp(`(?<![${LETTER}\\d])(?:[zZ]wolnieni(?:e${WS}lekarskie|a${WS}lekarskiego)|e-ZLA|(?<=(?:na|ma|mam)[ \\t]{1,8})L-?4)(?![${LETTER}])`, 'g'),
  new RegExp(`(?<![${LETTER}\\d])(?:[a-ząćęłńóśźż]{2,}ektomi[a-ząćęłńóśźż]{0,3}|(?:kolono|gastro)skopi[a-ząćęłńóśźż]{0,3})`, 'gi'),
  new RegExp(`(?<=(?:jest|był|była)[ \\t]{1,8}(?:[a-ząćęłńóśźż]{2,12}[ \\t]{1,8})?)uzależnion(?:y|a)${WS}od${WS}(?:alkoholu|hazardu)`, 'g'),
  new RegExp(`(?:po|przed|w${WS}trakcie)${WS}(?:operacji|zabiegu)(?:${WS}[a-ząćęłńóśźż]{2,}){0,3}`, 'gi'),
  /(\d{1,2})\.?[ \t]+(?:tydzień|tygodniu)[ \t]+ciąży/g,
  /(?<![A-Za-z])(?:pregnant|(?:had|has)[ \t]{1,4}(?:surgery|chemotherapy))(?![A-Za-z])/gi,
  /astm(?:a|y|ę|ą|ie)(?:[ \t]+oskrzelow[a-ząćęłńóśźż]*)?/gi,
  /[Pp]acjent(?:ka)?[ \t]*:[ \t]*([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)/g,
];
const FRAGMENTS = [
  'zwolnienie lekarskie',
  'Zwolnienia\n  lekarskiego',
  'ma L4',
  'na L-4',
  'appendektomia',
  'Cholecystektomii',
  'kolonoskopii',
  'był uzależniony od alkoholu',
  'była bardzo uzależniona od hazardu',
  'po operacji biodra lewego',
  'W TRAKCIE ZABIEGU',
  '12. tygodniu ciąży',
  'She had surgery',
  'PREGNANT',
  'astmy oskrzelowej',
  'Pacjentka: Nowak',
  'pacjent :  Kowalski',
  'e-ZLA',
  '[DANE O ZDROWIU]',
  'Jan Kowalski',
  ', ',
  '. ',
  '\n',
  '\t',
  '   ',
  'x',
  'ą',
  '-',
];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
function randomText(r: () => number, parts: number): string {
  let t = '';
  for (let i = 0; i < parts; i++) t += FRAGMENTS[Math.floor(r() * FRAGMENTS.length)];
  return t;
}
const record = (out: string[]) => (...args: unknown[]): string => {
  out.push(`${String(args[0])}@${String(args[args.length - 2])}`);
  return String(args[0]).length % 3 === 0 ? '[M]' : String(args[0]);
};

test('regex-literals: napisy gwarancji stoją w każdym trafieniu', () => {
  const r = rng(7);
  for (let k = 0; k < 400; k++) {
    const text = randomText(r, 30);
    for (const re of PATTERNS) {
      const lits = requiredLiterals(re);
      if (!lits) continue;
      for (const m of text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
        expect(lits.some((l) => new RegExp(l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(m[0])), `${re.source} / ${m[0]}`).toBe(true);
      }
      if (re.test(text)) expect(literalsPresent(re, text)).toBe(true);
      re.lastIndex = 0;
    }
  }
});

test('regex-literals: replaceNear i replaceTracked dają to samo co replace, z indeksem i bez', () => {
  const r = rng(11);
  const index = new LiteralIndex(PATTERNS);
  for (let k = 0; k < 300; k++) {
    let text = randomText(r, 40);
    let viaIndex = text;
    for (const re of PATTERNS) {
      const a: string[] = [];
      const b: string[] = [];
      const c: string[] = [];
      const want = text.replace(re, record(a));
      expect(replaceNear(text, re, record(b))).toBe(want);
      const got = nearSearchable(re) ? replaceNear(viaIndex, re, record(c), index) : replaceTracked(viaIndex, re, record(c), index);
      expect(got).toBe(want);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
      text = want;
      viaIndex = got;
    }
  }
});

test('regex-literals: indeks po zmianach zgadza się z indeksem liczonym od nowa', () => {
  const r = rng(5);
  const index = new LiteralIndex(PATTERNS);
  const fresh = new LiteralIndex(PATTERNS);
  for (let k = 0; k < 30; k++) {
    let text = randomText(r, 40);
    index.sync(text);
    for (let step = 0; step < 5; step++) {
      // losowe rozłączne zmiany: wycięcie, wstawienie maski, podmiana na fragment
      const edits: [number, number, number][] = [];
      let out = '';
      let pos = 0;
      while (pos < text.length) {
        const at = pos + Math.floor(r() * 40);
        if (at >= text.length) break;
        const oldLen = Math.floor(r() * 6);
        const ins = r() < 0.5 ? '[M]' : FRAGMENTS[Math.floor(r() * FRAGMENTS.length)];
        out += text.slice(pos, at) + ins;
        edits.push([at, Math.min(oldLen, text.length - at), ins.length]);
        pos = at + Math.min(oldLen, text.length - at);
      }
      out += text.slice(pos);
      index.update(out, edits);
      text = out;
      fresh.sync(text);
      for (const re of PATTERNS) {
        if (!index.covers(re)) continue;
        for (let p = 0; p <= text.length; p += 1 + Math.floor(r() * 11)) expect(index.next(re, p)).toBe(fresh.next(re, p));
      }
    }
  }
});

test('regex-literals: NearMatcher.next(p) to pierwsze trafienie od p, jak exec z lastIndex = p', () => {
  const r = rng(13);
  for (let k = 0; k < 200; k++) {
    const text = randomText(r, 40);
    for (const re of PATTERNS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      const near = new NearMatcher(text, re);
      // rosnące p, jak w pętli exec (stan budżetu przenosi się między wywołaniami)
      for (let p = 0; p <= text.length; p += 1 + Math.floor(r() * 9)) {
        g.lastIndex = p;
        const want = g.exec(text);
        const got = near.next(p);
        expect(got?.index ?? -1).toBe(want?.index ?? -1);
        expect(got?.[0] ?? null).toBe(want?.[0] ?? null);
      }
    }
  }
});
