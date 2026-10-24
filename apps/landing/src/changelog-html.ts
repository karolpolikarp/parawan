/**
 * Mały konwerter Markdown → HTML dla podstrony /log/ (dziennik zmian i plan). Obsługuje tylko
 * podzbiór, którego naprawdę używają CHANGELOG.md i ROADMAP.md: nagłówki, akapity, listy
 * punktowane i numerowane (także zagnieżdżone i luźne, z pustą linią między pozycjami),
 * **pogrubienie**, `kod`, [linki](adres) i bloki kodu w ```. Wszystko inne idzie jako zwykły
 * tekst, po ucieczce znaków HTML, więc nic z treści plików nie trafi na stronę jako znacznik.
 *
 * Moduł jest bez DOM i bez Node: używa go wtyczka w vite.config.ts przy buildzie, a sprawdza
 * apps/web/src/landing-log.test.ts. Strona nie ma skryptu, cała treść powstaje tutaj.
 */

/** Repozytorium, do którego prowadzą względne odnośniki z plików (./docs/…, README.md). */
export const REPO_BLOB = 'https://github.com/karolpolikarp/parawan/blob/main/';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Identyfikator kotwicy: małe litery bez polskich znaków, reszta jako łącznik. */
export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Kotwica wersji: „0.46.25” → „v0-46-25”. */
export function kotwicaWersji(wersja: string): string {
  return `v${wersja.replace(/\./g, '-')}`;
}

/** Adres linku z pliku: względny prowadzi do pliku w repozytorium, reszta bez zmian. */
export function adresLinku(url: string): string {
  const u = url.trim();
  if (/^(?:https?:|mailto:|#)/i.test(u)) return u;
  return REPO_BLOB + u.replace(/^\.\//, '').replace(/^\/+/, '');
}

function link(tekst: string, url: string): string {
  const href = adresLinku(url);
  const zew = /^https?:/i.test(href);
  return `<a href="${escapeHtml(href)}"${zew ? ' target="_blank" rel="noopener noreferrer"' : ''}>${tekst}</a>`;
}

/** Pozycja zamykającego `znak` od `od`, z pominięciem fragmentów `kodu` (dla ** i ]). */
function zamkniecie(s: string, znak: string, od: number): number {
  for (let i = od; i < s.length; i++) {
    if (s[i] === '`') {
      const k = s.indexOf('`', i + 1);
      if (k === -1) return -1;
      i = k;
      continue;
    }
    if (s.startsWith(znak, i)) return i;
  }
  return -1;
}

/** Formatowanie w linii: `kod`, **pogrubienie**, [tekst](adres). Reszta po ucieczce. */
export function inline(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '`') {
      const k = s.indexOf('`', i + 1);
      if (k > i + 1) {
        out += `<code>${escapeHtml(s.slice(i + 1, k))}</code>`;
        i = k + 1;
        continue;
      }
    } else if (c === '*' && s[i + 1] === '*') {
      const k = zamkniecie(s, '**', i + 2);
      if (k > i + 2) {
        out += `<strong>${inline(s.slice(i + 2, k))}</strong>`;
        i = k + 2;
        continue;
      }
    } else if (c === '[') {
      const k = zamkniecie(s, ']', i + 1);
      if (k > i + 1 && s[k + 1] === '(') {
        const z = s.indexOf(')', k + 2);
        if (z > k + 2) {
          out += link(inline(s.slice(i + 1, k)), s.slice(k + 2, z));
          i = z + 1;
          continue;
        }
      }
    }
    out += escapeHtml(c);
    i++;
  }
  return out;
}

const NAGLOWEK = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const POZYCJA = /^( *)([-*+]|\d{1,3}[.)])( +)(.*)$/;
const PLOT = /^ *```/;
/** Definicja odnośnika „[v0.46.25]: https://…” (spis porównań na końcu CHANGELOG.md): na stronie jej nie ma, jak w Markdownie. */
const DEFINICJA = /^ {0,3}\[[^\]]+\]:\s+\S+\s*$/;
/** Linia z wersją docelową i rozmiarem pozycji planu: „v0.47.0 · L”, „rdzeń 0.29.14 · S”. */
const META_PLANU = /\s·\s[SML]\b/;

const wcięcie = (l: string): number => l.length - l.trimStart().length;
const pusta = (l: string): boolean => l.trim() === '';

export interface OpcjeMd {
  /** O ile przesunąć poziom nagłówków („##” z przesunięciem 1 to <h3>). */
  przesuniecie?: number;
  /** Nagłówki z id (tylko poziom „##” pliku); zbiór pilnuje, żeby id się nie powtarzały. */
  idNaglowkow?: Set<string>;
}

function unikalne(id: string, zajete: Set<string>): string {
  let wynik = id || 'sekcja';
  for (let n = 2; zajete.has(wynik); n++) wynik = `${id}-${n}`;
  zajete.add(wynik);
  return wynik;
}

/** Akapit; w całości pogrubiony dostaje klasę „wiodacy”, „Pilność: …” klasę „pilnosc”. */
function akapit(linie: string[]): string {
  const tekst = linie.map((l) => l.trim()).join(' ');
  const pil = tekst.match(/^Pilność:\s*(.+)$/);
  if (pil) return `<p class="pilnosc"><span>Pilność</span> ${inline(pil[1])}</p>`;
  if (/^\*\*[^*]+\*\*$/.test(tekst) && zamkniecie(tekst, '**', 2) === tekst.length - 2) {
    return `<p class="wiodacy">${inline(tekst)}</p>`;
  }
  return `<p>${inline(tekst)}</p>`;
}

/**
 * Pierwszy akapit pozycji listy, który zaczyna się pogrubionym tytułem kończącym linię
 * (pozycje planu): tytuł, linia z wersją i rozmiarem, opis, każde w osobnym bloku.
 */
function akapitPozycji(linie: string[]): string {
  if (!linie[0]?.startsWith('**')) return akapit(linie);
  const tekst = linie.map((l) => l.trim());
  let koniec = -1;
  let zlaczone = '';
  for (let i = 0; i < tekst.length; i++) {
    zlaczone += (i ? ' ' : '') + tekst[i];
    if (zlaczone.endsWith('**') && zamkniecie(zlaczone, '**', 2) === zlaczone.length - 2) {
      koniec = i;
      break;
    }
  }
  if (koniec === -1 || koniec === tekst.length - 1) return akapit(linie);
  let html = `<p class="poz-tytul">${inline(zlaczone)}</p>`;
  let reszta = tekst.slice(koniec + 1);
  if (META_PLANU.test(reszta[0])) {
    html += `<p class="poz-meta">${inline(reszta[0])}</p>`;
    reszta = reszta.slice(1);
  }
  if (reszta.length) html += akapit(reszta);
  return html;
}

/** Blok listy od linii `start`; zwraca HTML i indeks pierwszej linii po liście. */
function lista(linie: string[], start: number, opcje: OpcjeMd): [string, number] {
  const pierwsza = linie[start].match(POZYCJA) as RegExpMatchArray;
  const baza = pierwsza[1].length;
  const numerowana = /\d/.test(pierwsza[2]);
  const pozycje: string[][] = [];
  let luzna = false;
  let i = start;
  while (i < linie.length) {
    const l = linie[i];
    const m = l.match(POZYCJA);
    if (m && m[1].length === baza && /\d/.test(m[2]) === numerowana) {
      // treść pozycji zaczyna się w kolumnie po znaczniku; kolejne linie zdejmują tyle wcięcia
      const kolumna = m[1].length + m[2].length + m[3].length;
      pozycje.push([' '.repeat(kolumna) + m[4]]);
      i++;
      continue;
    }
    if (pusta(l)) {
      // pusta linia należy do listy, gdy dalej jest wcięta treść albo następna pozycja
      let j = i + 1;
      while (j < linie.length && pusta(linie[j])) j++;
      if (j >= linie.length) break;
      const n = linie[j].match(POZYCJA);
      const dalej = wcięcie(linie[j]) > baza || (n && n[1].length === baza && /\d/.test(n[2]) === numerowana);
      if (!dalej) break;
      luzna = true;
      for (; i < j; i++) pozycje[pozycje.length - 1].push('');
      continue;
    }
    if (wcięcie(l) > baza) {
      pozycje[pozycje.length - 1].push(l);
      i++;
      continue;
    }
    break;
  }
  const tag = numerowana ? 'ol' : 'ul';
  const startAttr = numerowana && Number.parseInt(pierwsza[2], 10) !== 1 ? ` start="${Number.parseInt(pierwsza[2], 10)}"` : '';
  const elementy = pozycje.map((p) => {
    const kolumna = wcięcie(p[0]);
    const tresc = p.map((l) => l.slice(Math.min(kolumna, wcięcie(l))));
    let html = bloki(tresc, opcje, true);
    // lista ciasna: jedyny akapit pozycji bez <p>, jak w zwykłym Markdownie
    if (!luzna) html = html.replace(/^<p>((?:(?!<\/p>)[\s\S])*)<\/p>(?=<ul|<ol|$)/, '$1');
    return `<li>${html}</li>`;
  });
  return [`<${tag}${startAttr}>${elementy.join('')}</${tag}>`, i];
}

/** Ciąg bloków Markdowna jako HTML. */
export function bloki(linie: string[], opcje: OpcjeMd = {}, wPozycji = false): string {
  let html = '';
  let i = 0;
  let pierwszyAkapit = true;
  while (i < linie.length) {
    const l = linie[i];
    if (pusta(l) || DEFINICJA.test(l)) {
      i++;
      continue;
    }
    if (PLOT.test(l)) {
      const kod: string[] = [];
      i++;
      while (i < linie.length && !PLOT.test(linie[i])) kod.push(linie[i++]);
      i++;
      html += `<pre><code>${escapeHtml(kod.join('\n'))}</code></pre>`;
      continue;
    }
    const n = l.match(NAGLOWEK);
    if (n && wcięcie(l) === 0) {
      const poziom = Math.min(6, n[1].length + (opcje.przesuniecie ?? 0));
      const id =
        opcje.idNaglowkow && n[1].length === 2 ? ` id="${unikalne(slug(n[2]), opcje.idNaglowkow)}"` : '';
      html += `<h${poziom}${id}>${inline(n[2])}</h${poziom}>`;
      i++;
      continue;
    }
    if (POZYCJA.test(l)) {
      const [h, dalej] = lista(linie, i, opcje);
      html += h;
      i = dalej;
      continue;
    }
    const akap: string[] = [];
    while (
      i < linie.length &&
      !pusta(linie[i]) &&
      !DEFINICJA.test(linie[i]) &&
      !PLOT.test(linie[i]) &&
      !(NAGLOWEK.test(linie[i]) && wcięcie(linie[i]) === 0) &&
      !POZYCJA.test(linie[i])
    ) {
      akap.push(linie[i++]);
    }
    html += wPozycji && pierwszyAkapit ? akapitPozycji(akap) : akapit(akap);
    pierwszyAkapit = false;
  }
  return html;
}

/**
 * Twarda spacja po jednoliterowych spójnikach i przyimkach („w pliku”, „i IT”), jak na stronie
 * głównej, żeby nie zostawały na końcu wiersza. Tylko w tekście: znaczniki, `kod` i bloki <pre>
 * zostają bez zmian.
 */
export function twardeSpacje(html: string): string {
  return html
    .split(/(<pre\b[\s\S]*?<\/pre>|<code\b[\s\S]*?<\/code>|<[^>]+>)/)
    .map((czesc, i) => {
      if (i % 2) return czesc;
      let t = czesc;
      // dwa przebiegi: „i w domu” ma dwa spójniki z rzędu, a pierwszy zjada spację drugiego
      for (let n = 0; n < 2; n++) t = t.replace(/(^|[\s\u00a0(„])([aiouwzAIOUWZ]) (?=\S|$)/g, '$1$2\u00a0');
      return t;
    })
    .join('');
}

/** Markdown jako HTML (wejście z dowolnymi końcami linii). */
export function mdNaHtml(md: string, opcje: OpcjeMd = {}): string {
  return bloki(md.replace(/\r\n?/g, '\n').split('\n'), opcje);
}

/* ── CHANGELOG: podział na wersje ── */

export interface Wersja {
  /** „0.46.25”, albo null dla [Unreleased]. */
  wersja: string | null;
  /** Data „RRRR-MM-DD” z nagłówka albo null. */
  data: string | null;
  /** Tytuł do wyświetlenia: „v0.46.25” albo „W przygotowaniu”. */
  tytul: string;
  /** Kotwica: „v0-46-25”, „w-przygotowaniu”. */
  id: string;
  /** Treść wpisu w Markdownie (bez nagłówka). */
  md: string;
}

/** Wpisy CHANGELOG.md w kolejności z pliku (od najnowszego). Wstęp przed pierwszym „##” pomija. */
export function wersjeZChangelogu(md: string): Wersja[] {
  const linie = md.replace(/\r\n?/g, '\n').split('\n');
  const out: Wersja[] = [];
  const zajete = new Set<string>();
  let biezaca: { naglowek: string; linie: string[] } | null = null;
  const zamknij = () => {
    if (!biezaca) return;
    const h = biezaca.naglowek;
    const tresc = biezaca.linie.join('\n').trim();
    const v = h.match(/^v?(\d+\.\d+\.\d+)\s*(?:[—–-]\s*(\d{4}-\d{2}-\d{2}))?/);
    if (/^\[?unreleased\]?$/i.test(h)) {
      out.push({ wersja: null, data: null, tytul: 'W przygotowaniu', id: unikalne('w-przygotowaniu', zajete), md: tresc });
    } else if (v) {
      out.push({ wersja: v[1], data: v[2] ?? null, tytul: `v${v[1]}`, id: unikalne(kotwicaWersji(v[1]), zajete), md: tresc });
    } else {
      out.push({ wersja: null, data: null, tytul: h, id: unikalne(slug(h), zajete), md: tresc });
    }
  };
  for (const l of linie) {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m) {
      zamknij();
      biezaca = { naglowek: m[1], linie: [] };
    } else if (biezaca) {
      biezaca.linie.push(l);
    }
  }
  zamknij();
  return out;
}

/** Porównanie wersji „a.b.c”: ujemne, gdy `a` starsza. */
export function porownajWersje(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const MIESIACE = [
  'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
  'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia',
];

/** „2026-10-24” → „24 października 2026”. */
export function dataPoPolsku(data: string): string {
  const [r, m, d] = data.split('-').map(Number);
  // twarda spacja: dzień nie zostaje sam na końcu wiersza
  return `${d}\u00a0${MIESIACE[m - 1]} ${r}`;
}

/* ── ROADMAP: wstęp osobno, reszta z nagłówkami przesuniętymi o poziom ── */

export interface Plan {
  /** Wstęp przed pierwszym „##” (bez tytułu „#”). */
  wstep: string;
  /** Sekcje „##” jako HTML, z id. */
  tresc: string;
  /** Spis sekcji „##”: [id, tytuł]. */
  spis: [string, string][];
}

export function planZRoadmapy(md: string): Plan {
  const tekst = md.replace(/\r\n?/g, '\n');
  const i = tekst.search(/^## /m);
  const wstepMd = (i === -1 ? tekst : tekst.slice(0, i)).replace(/^# .*\n?/m, '');
  const resztaMd = i === -1 ? '' : tekst.slice(i);
  const idNaglowkow = new Set<string>();
  const tresc = mdNaHtml(resztaMd, { przesuniecie: 1, idNaglowkow });
  const spis = [...tresc.matchAll(/<h3 id="([^"]+)">([\s\S]*?)<\/h3>/g)].map((m) => [m[1], m[2]] as [string, string]);
  return { wstep: mdNaHtml(wstepMd), tresc, spis };
}
