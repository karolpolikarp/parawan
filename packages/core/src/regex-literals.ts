// Napisy, z których co najmniej jeden musi wystąpić w każdym trafieniu wyrażenia (filtr wstępny),
// i wyszukiwanie trafień tylko w pobliżu tych napisów.

import { escapeRe } from './util.js';

/** Największy zbiór wariantów trzymany dla jednego fragmentu wyrażenia. */
const MAX_SET = 48;

/**
 * Zbiór napisów z gwarancją położenia: w każdym trafieniu węzła stoi jeden z napisów `set`, a jego
 * początek leży najwyżej `n` znaków od początku trafienia i wszystkie znaki przed nim należą do
 * alfabetu `cls` (null: dowolne znaki).
 */
type Cand = { set: Set<string>; n: number; cls: Alpha; score: number };
/**
 * Alfabet: zbiór źródeł klas znaków jako bity (źródło k ma bit k w ATOMS), null: dowolne znaki.
 * Bity zamiast zbiorów napisów, bo alfabety łączą się na każdym kroku ciągu.
 */
type Alpha = bigint | null;
const ATOMS: string[] = [];
const atomBit = new Map<string, bigint>();
function atomOf(src: string): bigint {
  let b = atomBit.get(src);
  if (b === undefined) {
    b = BigInt(1) << BigInt(ATOMS.length);
    ATOMS.push(src);
    atomBit.set(src, b);
  }
  return b;
}
const NONE = BigInt(0);
const ONE = BigInt(1);
const orA = (a: Alpha, b: Alpha): Alpha => (a === null || b === null ? null : a | b);
function atomSources(a: bigint): string[] {
  const out: string[] = [];
  for (let k = 0; a > NONE; k++, a >>= ONE) if (a & ONE) out.push(ATOMS[k]);
  return out;
}
/**
 * Węzeł wzorca. E: pełny skończony zbiór napisów, które węzeł dopasowuje (null: nieznany albo za
 * duży). L: gwarancja napisów (null: brak). max: najdłuższe trafienie. alpha: alfabet trafień, czyli
 * zbiór źródeł klas znaków, z których składa się każde trafienie (null: dowolne znaki).
 * Litery w E i L są sprowadzone do małych.
 */
type Node = { E: Set<string> | null; L: Cand | null; max: number; alpha: Alpha };

const INF = Number.POSITIVE_INFINITY;
/** Znaki o znaczeniu specjalnym poza klasą: w alfabecie stoją po ukośniku. */
const SPECIAL = /[.*+?^${}()|[\]\\/-]/;
const zero = (): Node => ({ E: new Set(['']), L: null, max: 0, alpha: NONE });
const anyChar = (alpha: Alpha): Node => ({ E: null, L: null, max: 1, alpha });

/** Najdłuższy napis w zbiorze: dłuższy nie zawęża filtra, a jego składanie kosztuje. */
const MAX_LEN = 32;
function cross(a: Set<string>, b: Set<string>): Set<string> | null {
  const out = new Set<string>();
  for (const x of a) {
    for (const y of b) {
      if (x.length + y.length > MAX_LEN) return null;
      out.add(x + y);
      if (out.size > MAX_SET) return null;
    }
  }
  return out;
}

function union(a: Set<string> | null, b: Set<string> | null): Set<string> | null {
  return a && b ? new Set([...a, ...b]) : null;
}
const cand = (set: Set<string>, n: number, cls: Alpha): Cand => ({ set, n, cls, score: score(set) });

/** Ocena napisów jako filtra: najkrótszy napis decyduje, mniej wariantów lepiej; pusty napis nic nie daje. */
function score(set: Set<string> | null): number {
  if (!set || set.size === 0) return -1;
  let min = INF;
  for (const s of set) min = Math.min(min, s.length);
  return min === 0 ? -1 : min * 100 - set.size;
}
/** Lepszy kandydat: wyższa ocena napisów, przy równej bliżej początku trafienia. */
function better(a: Cand | null, b: Cand | null): boolean {
  const sa = a ? a.score : -1;
  const sb = b ? b.score : -1;
  if (sa !== sb) return sa > sb;
  return !!a && !!b && a.n < b.n;
}

function best(n: Node): Cand | null {
  const exact: Cand | null = n.E ? cand(n.E, 0, NONE) : null;
  const b = better(exact, n.L) ? exact : n.L;
  return b && b.score > 0 ? b : null;
}

/**
 * Litera bezpieczna dla porównania bez względu na wielkość: znak alfabetu łacińskiego (do U+024F),
 * którego mała i wielka forma to pojedyncze znaki o spójnej odmianie. Wyrażenie z flagą i dopasowuje
 * takiej literze tylko znaki o tej samej małej formie, a wzorzec /napis/i dopasowuje je wszystkie.
 * Inne znaki (greckie warianty jak „µ” i „μ”, ligatury) nie trafiają do napisów filtra.
 */
const foldMemo = new Map<string, boolean>();
function foldable(c: string): boolean {
  let r = foldMemo.get(c);
  if (r === undefined) {
    r = foldableNow(c);
    foldMemo.set(c, r);
  }
  return r;
}
function foldableNow(c: string): boolean {
  if (c.length !== 1 || c.charCodeAt(0) > 0x24f) return false;
  const lo = c.toLowerCase();
  const up = c.toUpperCase();
  return lo.length === 1 && up.length === 1 && up.toLowerCase() === lo && lo.toUpperCase() === up;
}

class Unsupported extends Error {}

function parse(src: string): Node {
  let i = 0;
  const fail = (what: string): never => {
    throw new Unsupported(what);
  };

  function charSet(chars: string[], alphaSrc: string): Node {
    const alpha = atomOf(alphaSrc);
    const s = new Set<string>();
    for (const c of chars) {
      if (!foldable(c)) return anyChar(alpha);
      s.add(c.toLowerCase());
    }
    return s.size > 6 ? anyChar(alpha) : { E: s, L: null, max: 1, alpha };
  }

  // Jeden znak po ukośniku albo klasa (\d, \w, \s): [znak, źródło do alfabetu]; znak null dla klasy.
  function escChar(): [string | null, string | null] {
    const d = src[i + 1];
    if (d === undefined) fail('ukośnik na końcu');
    if ('dws'.includes(d)) {
      i += 2;
      return [null, `\\${d}`];
    }
    if ('DWS'.includes(d)) {
      i += 2;
      return [null, null];
    }
    if (d === 'p' || d === 'P') fail('\\p');
    if (d === 'u' || d === 'x') {
      const len = d === 'u' ? 4 : 2;
      const h = src.slice(i + 2, i + 2 + len);
      if (!new RegExp(`^[0-9a-fA-F]{${len}}$`).test(h)) fail('\\u');
      const raw = src.slice(i, i + 2 + len);
      i += 2 + len;
      return [String.fromCharCode(Number.parseInt(h, 16)), raw];
    }
    const simple: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v' };
    if (d in simple) {
      i += 2;
      return [simple[d], `\\${d}`];
    }
    if (/[a-zA-Z0-9]/.test(d)) fail(`\\${d}`);
    i += 2;
    return [d, `\\${d}`];
  }

  function parseClass(): Node {
    const start = i;
    i++;
    const neg = src[i] === '^';
    if (neg) i++;
    const chars: string[] = [];
    let unknown = false;
    let anyInside = false;
    const one = (): string | null => {
      if (src[i] !== '\\') return src[i++];
      const [c, a] = escChar();
      if (a === null) anyInside = true;
      return c;
    };
    while (src[i] !== ']') {
      if (i >= src.length) fail('niedomknięta klasa');
      const a = one();
      if (src[i] === '-' && src[i + 1] !== ']') {
        i++;
        const b = one();
        if (a === null || b === null) fail('przedział z klasą');
        const n = (b as string).charCodeAt(0) - (a as string).charCodeAt(0);
        if (n > 8) {
          unknown = true;
          continue;
        }
        for (let k = 0; k <= n; k++) chars.push(String.fromCharCode((a as string).charCodeAt(0) + k));
      } else if (a === null) unknown = true;
      else chars.push(a);
    }
    i++;
    const alphaSrc = neg || anyInside ? null : src.slice(start, i);
    if (alphaSrc === null) return anyChar(null);
    return unknown ? anyChar(atomOf(alphaSrc)) : charSet(chars, alphaSrc);
  }

  function parseAtom(): Node {
    const c = src[i];
    if (c === '(') {
      i++;
      let look = false;
      if (src[i] === '?') {
        if (src[i + 1] === ':') i += 2;
        else if (src[i + 1] === '=' || src[i + 1] === '!') {
          i += 2;
          look = true;
        } else if (src[i + 1] === '<' && (src[i + 2] === '=' || src[i + 2] === '!')) {
          i += 3;
          look = true;
        } else fail('grupa');
      }
      const inner = parseAlt();
      if (src[i] !== ')') fail('niedomknięta grupa');
      i++;
      // asercja nie zużywa znaków: w ciągu jest pustym napisem
      return look ? zero() : inner;
    }
    if (c === '[') return parseClass();
    if (c === '\\') {
      const d = src[i + 1];
      if (d === 'b' || d === 'B') {
        i += 2;
        return zero();
      }
      const [ch, a] = escChar();
      if (ch === null) return anyChar(a === null ? null : atomOf(a));
      return charSet([ch], a as string);
    }
    if (c === '^' || c === '$') {
      i++;
      return zero();
    }
    if (c === '.') {
      i++;
      return anyChar(null);
    }
    if ('*+?{}]'.includes(c)) fail(`znak ${c}`);
    i++;
    return charSet([c], SPECIAL.test(c) ? `\\${c}` : c);
  }

  function parseQuant(): Node {
    const atom = parseAtom();
    let min: number;
    let max: number;
    const c = src[i];
    if (c === '*') [min, max] = [0, INF];
    else if (c === '+') [min, max] = [1, INF];
    else if (c === '?') [min, max] = [0, 1];
    else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (!m) return fail('{');
      min = Number(m[1]);
      max = m[2] ? (m[3] ? Number(m[3]) : INF) : min;
      i += m[0].length - 1;
    } else return atom;
    i++;
    if (src[i] === '?') i++; // leniwy kwantyfikator dopasowuje te same napisy
    const len = atom.max === 0 ? 0 : max * atom.max;
    // krótkie powtórzenie znanych napisów („-?”, „(?:u|em)?”): suma napisów dla każdej liczby powtórzeń
    if (atom.E && max <= 3) {
      let E: Set<string> | null = new Set();
      let rep: Set<string> | null = new Set(['']);
      for (let k = 0; k <= max && E && rep; k++) {
        if (k >= min) E = union(E, rep);
        if (k < max) rep = cross(rep, atom.E);
      }
      if (E && rep && E.size <= MAX_SET) return { E, L: null, max: len, alpha: atom.alpha };
    }
    if (min === 0) return { E: null, L: null, max: len, alpha: atom.alpha };
    if (atom.E && min === max) {
      let E: Set<string> | null = new Set(['']);
      for (let k = 0; k < min && E; k++) E = cross(E, atom.E);
      if (E) return { E, L: null, max: len, alpha: atom.alpha };
    }
    // co najmniej jedno powtórzenie: gwarancja atomu leży w pierwszym z nich
    return { E: null, L: best(atom), max: len, alpha: atom.alpha };
  }

  function parseSeq(): Node {
    const items: Node[] = [];
    while (i < src.length && src[i] !== '|' && src[i] !== ')') items.push(parseQuant());
    // Kandydaci: gwarancja każdego elementu i każdy ciąg sąsiednich elementów o znanych napisach
    // (ich złożenie jest spójnym fragmentem trafienia). Przed kandydatem stoją trafienia elementów
    // poprzedzających: ich długości się sumują, a alfabety łączą.
    let L: Cand | null = null;
    const offer = (c: Cand | null): void => {
      if (c && better(c, L)) L = c;
    };
    let run = new Set(['']);
    let runN = 0;
    let runCls: Alpha = NONE;
    let n = 0;
    let cls: Alpha = NONE;
    let whole: Set<string> | null = new Set(['']);
    let alpha: Alpha = NONE;
    let max = 0;
    for (const it of items) {
      const b = best(it);
      if (b) offer(cand(b.set, n + b.n, orA(cls, b.cls)));
      if (it.E) {
        const next = cross(run, it.E);
        if (next) run = next;
        else {
          offer(cand(run, runN, runCls));
          run = new Set(it.E);
          runN = n;
          runCls = cls;
        }
        if (whole) whole = cross(whole, it.E);
      } else {
        offer(cand(run, runN, runCls));
        whole = null;
      }
      n += it.max;
      cls = orA(cls, it.alpha);
      alpha = orA(alpha, it.alpha);
      max += it.max;
      if (!it.E) {
        run = new Set(['']);
        runN = n;
        runCls = cls;
      }
    }
    offer(cand(run, runN, runCls));
    return { E: whole, L, max, alpha };
  }

  function parseAlt(): Node {
    const alts = [parseSeq()];
    while (src[i] === '|') {
      i++;
      alts.push(parseSeq());
    }
    if (alts.length === 1) return alts[0];
    let E: Set<string> | null = new Set<string>();
    for (const a of alts) {
      if (!a.E) {
        E = null;
        break;
      }
      for (const s of a.E) E.add(s);
    }
    if (E && E.size > MAX_SET) E = null;
    // trafienie alternatywy to trafienie jednej z gałęzi: suma gwarancji, o ile każda gałąź ją ma
    let L: Cand | null = null;
    const lset = new Set<string>();
    let ln = 0;
    let lcls: Alpha = NONE;
    let every = true;
    for (const a of alts) {
      const b = best(a);
      if (!b) {
        every = false;
        break;
      }
      for (const s of b.set) lset.add(s);
      ln = Math.max(ln, b.n);
      lcls = orA(lcls, b.cls);
    }
    if (every) L = cand(lset, ln, lcls);
    let alpha: Alpha = NONE;
    for (const a of alts) alpha = orA(alpha, a.alpha);
    return { E, L, max: Math.max(...alts.map((a) => a.max)), alpha };
  }

  const root = parseAlt();
  if (i !== src.length) fail('nadmiarowy znak');
  return root;
}

function analyze(re: RegExp): Cand | null {
  if (re.unicode || re.flags.includes('v')) return null;
  try {
    return best(parse(re.source));
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}

/**
 * Napisy (małymi literami), z których co najmniej jeden występuje w tekście (bez względu na wielkość
 * liter), ilekroć wyrażenie ma w nim trafienie; null, gdy takiej gwarancji nie ma albo składnia wykracza
 * poza obsługiwaną (wtedy filtr przepuszcza każdy tekst).
 */
export function requiredLiterals(re: RegExp): string[] | null {
  const c = analyze(re);
  return c ? [...c.set] : null;
}

type Finder = {
  /** Napisy gwarancji, szukane bez względu na wielkość liter. */
  lit: RegExp;
  /** Najdalszy początek napisu od początku trafienia. */
  n: number;
  /** Jeden znak z alfabetu przed napisem (null: dowolny znak). */
  cls: RegExp | null;
  /** Wyrażenie przyklejone (flaga y) do próby trafienia od wskazanej pozycji. */
  sticky: RegExp;
  /** Wyrażenie globalne do zwykłego przeszukiwania od pozycji. */
  global: RegExp;
  /** Najkrótszy napis gwarancji: krótki bywa w tekście co kilka znaków i nie zawęża przeszukiwania. */
  shortest: number;
};
const finders = new Map<RegExp, Finder | null>();
function finderOf(re: RegExp): Finder | null {
  let f = finders.get(re);
  if (f !== undefined) return f;
  const c = analyze(re);
  const base = re.flags.replace(/[gy]/g, '');
  f = c
    ? {
        lit: new RegExp([...c.set].map(escapeRe).join('|'), 'gi'),
        n: c.n,
        cls: c.cls === null ? null : new RegExp(`^(?:${atomSources(c.cls).join('|') || '(?!)'})$`, re.ignoreCase ? 'i' : ''),
        sticky: new RegExp(re.source, `${base}y`),
        global: new RegExp(re.source, `${base}g`),
        shortest: Math.min(...[...c.set].map((x) => x.length)),
      }
    : null;
  finders.set(re, f);
  return f;
}

/** Najkrótszy napis gwarancji, przy którym przeszukiwanie przy napisach się opłaca. */
const NEAR_MIN_LITERAL = 3;
/** Czy replaceNear przeszukuje to wyrażenie przy napisach gwarancji (inaczej woła zwykłe replace). */
export function nearSearchable(re: RegExp): boolean {
  const f = finderOf(re);
  return re.global && !re.unicode && f !== null && f.shortest >= NEAR_MIN_LITERAL;
}

/** Czy wyrażenie może mieć trafienie w tekście: brak wszystkich napisów gwarancji znaczy, że nie. */
export function literalsPresent(re: RegExp, text: string): boolean {
  const f = finderOf(re);
  if (!f) return true;
  f.lit.lastIndex = 0;
  return f.lit.test(text);
}

/** Zmiana tekstu: na pozycji `at` (w starym tekście) `oldLen` znaków zastąpiono napisem długości `newLen`. */
export type Edit = [at: number, oldLen: number, newLen: number];

/**
 * Wspólny indeks napisów gwarancji wielu wyrażeń dla jednego tekstu: jedno przeszukiwanie zamiast
 * jednego na wyrażenie. Na każdej pozycji, od której zaczyna się jakiś napis, zapisany jest najdłuższy
 * z nich (alternatywa od najdłuższych). Napisy, które zaczynają się na tej samej pozycji, są
 * przedrostkami tekstu od niej, więc i przedrostkami najdłuższego: zbiór wyrażeń, których napis tam
 * stoi, wynika z samego najdłuższego napisu. Po podmianie indeks przelicza tylko okolice zmian:
 * wpisy, których napis mógł sięgać zmienionego miejsca (do maxLit − 1 znaków przed nim), i nowy tekst.
 */
export class LiteralIndex {
  private readonly ids = new Map<RegExp, number>();
  private readonly words: number;
  private readonly bits: Int32Array;
  private readonly litId = new Map<string, number>();
  private readonly comb: RegExp;
  private readonly maxLit: number;
  private text: string | null = null;
  private pos: number[] = [];
  private lid: number[] = [];

  constructor(regexes: readonly RegExp[]) {
    const sets: string[][] = [];
    for (const re of regexes) {
      if (this.ids.has(re) || !nearSearchable(re)) continue;
      this.ids.set(re, sets.length);
      sets.push([...(analyze(re) as Cand).set]);
    }
    const all = [...new Set(sets.flat())].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
    for (const [k, l] of all.entries()) this.litId.set(l, k);
    this.words = Math.max(1, Math.ceil(sets.length / 32));
    this.bits = new Int32Array(all.length * this.words);
    const owners = new Map<string, number[]>();
    sets.forEach((set, id) => {
      for (const l of set) owners.set(l, [...(owners.get(l) ?? []), id]);
    });
    // wyrażenia najdłuższego napisu: właściciele każdego jego przedrostka, który też jest napisem
    all.forEach((l, k) => {
      for (let n = 1; n <= l.length; n++) {
        for (const id of owners.get(l.slice(0, n)) ?? []) this.bits[k * this.words + (id >> 5)] |= 1 << (id & 31);
      }
    });
    this.maxLit = all.length ? all[0].length : 1;
    this.comb = all.length ? new RegExp(`(?=(${all.map(escapeRe).join('|')}))`, 'gi') : /(?!)/g;
  }

  /** Czy wyrażenie jest w indeksie. */
  covers(re: RegExp): boolean {
    return this.ids.has(re);
  }

  /** Zapomina tekst (po redakcji indeks nie trzyma pisma). */
  clear(): void {
    this.text = null;
    this.pos = [];
    this.lid = [];
  }

  /** Indeks dla tekstu: ten sam tekst zostaje, inny jest przeszukiwany od nowa. */
  sync(text: string): void {
    if (text === this.text) {
      // ta sama treść w innym obiekcie: kolejne porównanie rozstrzygnie tożsamość
      this.text = text;
      return;
    }
    this.pos = [];
    this.lid = [];
    this.scan(text, 0, text.length, this.pos, this.lid);
    this.text = text;
  }

  // Napisy zaczynające się w [from, to). Napis od pozycji zależy tylko od maxLit znaków od niej, więc
  // wystarczy wycinek do to + maxLit − 1: bez niego szukanie następnego napisu biegłoby za `to`
  // aż do końca tekstu.
  private scan(text: string, from: number, to: number, pos: number[], lid: number[]): void {
    const re = this.comb;
    const part = from === 0 && to >= text.length ? text : text.slice(from, Math.min(text.length, to + this.maxLit - 1));
    const end = to - from;
    re.lastIndex = 0;
    for (let m = re.exec(part); m && m.index < end; m = re.exec(part)) {
      const k = this.litId.get(m[1].toLowerCase());
      // litera spoza porównania małymi literami nie trafia do napisów (foldable), więc to nie zachodzi
      if (k === undefined) throw new Error('LiteralIndex: nieznany napis');
      pos.push(from + m.index);
      lid.push(k);
      re.lastIndex = m.index + 1;
    }
  }

  /** Pierwsza pozycja ≥ p (w tekście z ostatniego sync), od której stoi napis wyrażenia; −1, gdy brak. */
  next(re: RegExp, p: number): number {
    const id = this.ids.get(re) as number;
    const w = id >> 5;
    const bit = 1 << (id & 31);
    const pos = this.pos;
    let lo = 0;
    let hi = pos.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pos[mid] < p) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < pos.length; i++) if (this.bits[this.lid[i] * this.words + w] & bit) return pos[i];
    return -1;
  }

  /**
   * Indeks po podmianie w tekście z ostatniego sync: `edits` rosnąco i rozłącznie, w położeniach
   * starego tekstu. Wpisy z dala od zmian przesuwają się o różnicę długości, okolice zmian są
   * przeszukiwane w nowym tekście.
   */
  update(newText: string, edits: readonly Edit[]): void {
    if (!edits.length) {
      this.text = newText;
      return;
    }
    const back = this.maxLit - 1;
    const pos: number[] = [];
    const lid: number[] = [];
    let e = 0;
    let delta = 0;
    // zakres nowego tekstu do przeszukania przy bieżącej zmianie, scalany z kolejnymi
    let dirtyFrom = -1;
    let dirtyTo = -1;
    const flush = (): void => {
      if (dirtyFrom >= 0) this.scan(newText, dirtyFrom, dirtyTo, pos, lid);
      dirtyFrom = -1;
    };
    let i = 0;
    const oldPos = this.pos;
    const oldLid = this.lid;
    while (e < edits.length || i < oldPos.length) {
      const [at, oldLen, newLen] = e < edits.length ? edits[e] : [Number.POSITIVE_INFINITY, 0, 0];
      // wpisy przed strefą zmiany: przesunięte, chyba że wpadają w zakres do przeszukania
      while (i < oldPos.length && oldPos[i] < at - back) {
        const np = oldPos[i] + delta;
        if (dirtyFrom >= 0 && np < dirtyTo) {
          i++;
          continue;
        }
        flush();
        pos.push(np);
        lid.push(oldLid[i]);
        i++;
      }
      if (e >= edits.length) break;
      // wpisy w strefie zmiany (napis mógł sięgać zmienionego miejsca albo w nim leżeć) odpadają
      while (i < oldPos.length && oldPos[i] < at + oldLen) i++;
      const from = Math.max(0, at + delta - back);
      const to = at + delta + newLen;
      if (dirtyFrom >= 0 && from <= dirtyTo) dirtyTo = Math.max(dirtyTo, to);
      else {
        flush();
        dirtyFrom = from;
        dirtyTo = to;
      }
      delta += newLen - oldLen;
      e++;
    }
    flush();
    this.pos = pos;
    this.lid = lid;
    this.text = newText;
  }

  /** Czy indeks opisuje ten tekst (bez przeszukiwania). */
  isFor(text: string): boolean {
    if (text !== this.text) return false;
    this.text = text;
    return true;
  }
}

/**
 * To samo co text.replace(re, fn) dla wyrażenia z flagą g (bez flagi u i grup nazwanych), ale trafień
 * szuka tylko przy napisach gwarancji. Dowód równości: trafienie zaczynające się w s ≥ p zawiera napis
 * gwarancji od pozycji o ≥ s, nie dalej niż n znaków od s, a znaki [s, o) należą do alfabetu. Niech q
 * będzie pierwszym napisem od p. Jeśli s ≤ q, to o ≥ q, więc znaki [s, q) też należą do alfabetu i
 * q − s ≤ n. Wystarczy więc spróbować trafienia (flaga y) od każdego s z [max(p, q − bound), q], gdzie
 * bound to n przycięte do ciągu znaków alfabetu tuż przed q; pierwsza udana próba to najbliższe
 * trafienie, a bez niej następne trafienie zaczyna się za q. Próba od s daje to samo trafienie co
 * przeszukiwanie, które doszło do s. Gdy prób jest za dużo (napis częsty), dalsza część idzie zwykłym
 * przeszukiwaniem od bieżącej pozycji, co daje te same trafienia.
 */
/**
 * Funkcja podmiany jak w String.prototype.replace: trafienie, grupy, pozycja i cały tekst. Parametry
 * po trafieniu typu never, żeby pasowała każda funkcja z własnymi typami grup.
 */
export type Replacer = (match: string, ...rest: never[]) => string;
type AnyReplacer = (...args: unknown[]) => string;

/** Powiadomienie o podmianie: stary tekst, nowy i zmiany (rosnąco, w położeniach starego tekstu). */
export type EditListener = (oldText: string, newText: string, edits: readonly Edit[]) => void;

/**
 * Kolejne trafienia wyrażenia z flagą g w jednym tekście: next(p) daje to samo co exec z lastIndex = p
 * (pierwsze trafienie od p), szukając go tylko przy napisach gwarancji (dowód przy replaceNear).
 * Wyrażenie bez napisów albo z krótkimi napisami idzie zwykłym exec.
 */
export class NearMatcher {
  private readonly f: Finder | null;
  private readonly idx: LiteralIndex | undefined;
  // Praca w trybie przy napisach najwyżej ułamek zwykłego przeszukiwania: próba od pozycji (flaga y)
  // kosztuje tyle co przejście wzorca po kilkudziesięciu znakach, krok wstecz po alfabecie mniej.
  private budget: number;
  private steps: number;
  private windowed: boolean;
  private readonly global: RegExp;

  constructor(
    private readonly text: string,
    private readonly re: RegExp,
    index?: LiteralIndex,
  ) {
    const f = finderOf(re);
    this.f = f && re.global && !re.unicode && f.shortest >= NEAR_MIN_LITERAL ? f : null;
    this.windowed = this.f !== null;
    this.global = this.f ? this.f.global : new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    this.idx = this.f && index?.covers(re) ? index : undefined;
    this.idx?.sync(text);
    this.budget = (text.length >> 6) + 64;
    this.steps = (text.length >> 2) + 256;
  }

  next(from: number): RegExpExecArray | null {
    const { text, re } = this;
    if (from > text.length) return null;
    let p = from;
    const f = this.f;
    if (f && this.windowed) {
      for (;;) {
        let q: number;
        if (this.idx) q = this.idx.next(re, p);
        else {
          f.lit.lastIndex = p;
          q = f.lit.exec(text)?.index ?? -1;
        }
        if (q < 0) return null;
        let lo = Math.max(p, q - f.n);
        if (f.cls) {
          let k = q;
          while (k > lo && this.steps > 0 && f.cls.test(text[k - 1])) {
            k--;
            this.steps--;
          }
          if (k > lo && this.steps <= 0) {
            this.windowed = false;
            break;
          }
          lo = k;
        }
        if (q - lo + 1 > this.budget) {
          this.windowed = false;
          break;
        }
        this.budget -= q - lo + 1;
        for (let s = lo; s <= q; s++) {
          f.sticky.lastIndex = s;
          const m = f.sticky.exec(text);
          if (m) return m;
        }
        p = q + 1;
        if (p > text.length) return null;
      }
    }
    this.global.lastIndex = p;
    return this.global.exec(text);
  }
}

export function replaceNear(text: string, re: RegExp, fn: Replacer, index?: LiteralIndex, onEdits?: EditListener): string {
  const f = finderOf(re);
  if (!f || !re.global || re.unicode || f.shortest < NEAR_MIN_LITERAL) return replaceTracked(text, re, fn, index, onEdits);
  const matcher = new NearMatcher(text, re, index);
  const idx = index?.covers(re) ? index : undefined;
  let out = '';
  let last = 0;
  let p = 0;
  const edits: Edit[] = [];
  for (let m = matcher.next(p); m; m = matcher.next(p)) {
    const at = m.index;
    const args: unknown[] = [...m, at, text];
    if (m.groups !== undefined) args.push(m.groups);
    const r = String((fn as AnyReplacer)(...args));
    if (r !== m[0]) edits.push([at, m[0].length, r.length]);
    out += text.slice(last, at) + r;
    last = at + m[0].length;
    p = m[0].length ? last : last + 1;
  }
  // bez zmian zostaje ten sam napis: indeks i pamięć podręczna rozpoznają go bez porównywania treści
  if (!edits.length) return text;
  const result = out + text.slice(last);
  idx?.update(result, edits);
  onEdits?.(text, result, edits);
  return result;
}

/**
 * Zwykłe text.replace(re, fn) dla wyrażenia z flagą g, które przy okazji przesuwa indeks napisów
 * (gdy opisywał ten tekst) zamiast przeszukiwać go od nowa przy następnym użyciu.
 */
export function replaceTracked(text: string, re: RegExp, fn: Replacer, index?: LiteralIndex, onEdits?: EditListener): string {
  const idx = index?.isFor(text) ? index : undefined;
  if ((!idx && !onEdits) || !re.global) return text.replace(re, fn as AnyReplacer);
  const edits: Edit[] = [];
  const result = text.replace(re, (...args: unknown[]) => {
    const r = String((fn as AnyReplacer)(...args));
    const at = (typeof args[args.length - 1] === 'object' ? args[args.length - 3] : args[args.length - 2]) as number;
    if (r !== args[0]) edits.push([at, (args[0] as string).length, r.length]);
    return r;
  });
  if (!edits.length) return text;
  idx?.update(result, edits);
  onEdits?.(text, result, edits);
  return result;
}
