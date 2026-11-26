/**
 * Scena „Parawany stają tylko przy danych” (#plaza): parawany rozstawiają się przy danych
 * w rytmie przewijania. Pismo w stanie końcowym (każda maska jako `.d.lab`) jest już w HTML,
 * policzone przy buildzie (src/scena.ts). Ten skrypt tylko je animuje: zdejmuje `.lab`, ustawia
 * postęp q = 0 i prowadzi każdą maskę przez trzy fazy, gdy pismo przesuwa się przez ekran.
 *
 * Mechanika jak w próbce E:\parawan-landing-proby\r6-k2 (DESIGN.md: nie zmieniać):
 *  - c = gładko(q / .4): płótno rośnie od dołu nad oryginałem;
 *  - e = gładko((q − .45) / .4): miejsce zwęża się od szerokości oryginału do szerokości znacznika;
 *  - t = (q − .8) / .2: znacznik wysuwa się na płótno od lewej;
 *  - od q ≥ .4 oryginał jest ukryty w całości (visibility), więc żadna klatka nie pokazuje części
 *    danej; od q ≥ 1 maska wraca do zwykłego znacznika `.lab`.
 * Powyżej 960 px scena stoi przypięta (sticky) na torze 150% wysokości okna, niżej każda maska
 * zasłania się sama, gdy dojdzie do 78% wysokości okna.
 *
 * Przy prefers-reduced-motion zostaje stan końcowy i przycisk „Pokaż pismo przed zasłonięciem”.
 */
import { plural } from './wynik';

const F_PAR = ['parawan', 'parawany', 'parawanów'] as const;
const F_FR = ['fragment', 'fragmenty', 'fragmentów'] as const;

const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const gladko = (x: number): number => x * x * (3 - 2 * x);

interface Fragment {
  e: HTMLElement;
  maska: boolean;
  s: HTMLElement | null;
  o: HTMLElement | null;
  l: HTMLElement | null;
  pan: number;
  q: number;
  r: number;
  wo: number;
  wl: number;
}

export function uruchomScene(): void {
  const el = {
    scena: document.getElementById('plaza'),
    tor: document.getElementById('tor'),
    tresc: document.getElementById('tresc'),
    wsch: document.getElementById('wsch'),
  };
  const k0 = el.scena?.querySelector<HTMLElement>('.kartka');
  const p0 = el.scena?.querySelector<HTMLElement>('.przyp');
  if (!el.scena || !el.tor || !el.tresc || !el.wsch || !k0 || !p0) return;
  // stałe bez null: funkcje niżej są deklaracjami, więc zawężenie z warunku do nich nie sięga
  const scena: HTMLElement = el.scena;
  const tor: HTMLElement = el.tor;
  const tresc: HTMLElement = el.tresc;
  const wsch: HTMLElement = el.wsch;
  const kartka: HTMLElement = k0;
  const przyp: HTMLElement = p0;
  const ruch = !matchMedia('(prefers-reduced-motion: reduce)').matches;

  const it: Fragment[] = [...tresc.querySelectorAll<HTMLElement>('.d, .k')].map((e) => ({
    e,
    maska: e.classList.contains('d'),
    s: e.querySelector<HTMLElement>('.s'),
    o: e.querySelector<HTMLElement>('.o'),
    l: e.querySelector<HTMLElement>('.l'),
    pan: 0,
    q: -1,
    r: 0,
    wo: 0,
    wl: 0,
  }));
  if (!it.length) return;
  const nM = it.filter((x) => x.maska).length;
  const nK = it.length - nM;
  const kItems = it.filter((x) => !x.maska);
  const lis = [...document.querySelectorAll<HTMLElement>('#slonce li')];
  const wp = [...scena.querySelectorAll<SVGElement>('.wp')];
  const podsum = document.getElementById('podsum');
  const $ = (id: string): HTMLElement | null => document.getElementById(id);
  const [lA, lB, mA, mB, lAt, lBt] = ['l-a', 'l-b', 'm-a', 'm-b', 'l-a-t', 'l-b-t'].map($);

  if (!ruch) {
    // stan końcowy z buildu zostaje; przycisk pokazuje oryginał w miejscu znaczników
    const btn = $('przelacz');
    if (!btn) return;
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const orig = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(orig));
      tresc.classList.toggle('pokaz-orig', orig);
      for (const o of tresc.querySelectorAll('.d .o')) {
        if (orig) o.removeAttribute('aria-hidden');
        else o.setAttribute('aria-hidden', 'true');
      }
      btn.textContent = orig ? 'Pokaż pismo po zasłonięciu' : 'Pokaż pismo przed zasłonięciem';
    });
    return;
  }

  function ustaw(x: Fragment, q: number): void {
    if (q === x.q) return;
    x.q = q;
    x.e.style.setProperty('--q', q.toFixed(3));
    if (!x.maska || !x.o) return;
    const lab = q >= 1;
    if (lab !== x.e.classList.contains('lab')) x.e.classList.toggle('lab', lab);
    // oryginał chowa się, gdy płótno zaczyna rosnąć: najpierw płótno, potem znika tekst pod nim
    const zak = !lab && q >= 0.4;
    if (zak !== x.e.classList.contains('zakryte')) x.e.classList.toggle('zakryte', zak);
    // czytnik ekranu nie dostaje oryginału, który oko widzi już za parawanem
    const ukryj = lab || zak;
    if (ukryj !== (x.o.getAttribute('aria-hidden') === 'true')) {
      if (ukryj) x.o.setAttribute('aria-hidden', 'true');
      else x.o.removeAttribute('aria-hidden');
    }
    if (!lab && x.wo) {
      const c = gladko(clamp(q / 0.4));
      const e = gladko(clamp((q - 0.45) / 0.4));
      const t = clamp((q - 0.8) / 0.2);
      x.e.style.setProperty('--c', c.toFixed(3));
      x.e.style.setProperty('--t', t.toFixed(3));
      x.e.style.setProperty('--w', `${(x.wo + (x.wl - x.wo) * e).toFixed(1)}px`);
    }
  }

  // Szerokość oryginału i znacznika oraz liczba paneli płótna (zależy od szerokości fragmentu).
  function skrzydla(): void {
    for (const x of it) {
      if (!x.maska || !x.s || !x.o || !x.l) continue;
      const lab = x.e.classList.contains('lab');
      if (lab) x.e.classList.remove('lab');
      x.e.style.removeProperty('--w');
      x.wo = x.o.getBoundingClientRect().width;
      x.wl = x.l.getBoundingClientRect().width + 8;
      if (lab) x.e.classList.add('lab');
      const n = Math.max(2, Math.min(7, Math.round(x.wo / 22)));
      if (x.pan !== n) {
        x.s.innerHTML = '<i></i>'.repeat(n);
        x.pan = n;
      }
      const q = x.q;
      x.q = -1;
      if (q >= 0) ustaw(x, q);
    }
  }

  function liczniki(): void {
    let m = 0;
    let k = 0;
    for (const x of it) {
      if (x.q < 1) continue;
      if (x.maska) m++;
      else k++;
    }
    if (lA && lA.textContent !== String(m)) {
      lA.textContent = String(m);
      if (mA) mA.textContent = String(m);
      if (lAt) lAt.textContent = `${plural(m, ...F_PAR)} przy danych`;
    }
    if (lB && lB.textContent !== String(k)) {
      lB.textContent = String(k);
      if (mB) mB.textContent = String(k);
      if (lBt) lBt.textContent = `${plural(k, ...F_FR)} na słońcu`;
    }
    kItems.forEach((x, i) => lis[i]?.classList.toggle('on', x.q >= 1));
    for (const r of wp) r.classList.toggle('on', Number(r.getAttribute('data-i')) < m);
    // winieta jest symbolem (<use>): stan zapisany na symbolu odświeża obie kopie
    const sv = nK ? (k / nK).toFixed(3) : '1';
    scena.style.setProperty('--s', sv);
    wsch.style.setProperty('--s', sv);
    podsum?.classList.toggle('gotowe', m === nM && k === nK);
  }

  // Kolejność rozstawiania: od góry do dołu kartki, w wierszu od lewej.
  function pozycje(): void {
    const kr = kartka.getBoundingClientRect();
    for (const x of it) {
      const r = x.e.getClientRects()[0];
      if (!r) continue;
      x.r = (r.top - kr.top + ((r.left - kr.left) / kr.width) * 18) / kr.height;
    }
    const lo = Math.min(...it.map((x) => x.r));
    const hi = Math.max(...it.map((x) => x.r));
    for (const x of it) x.r = hi > lo ? (x.r - lo) / (hi - lo) : 0;
  }

  document.documentElement.classList.add('ruch');
  wsch.classList.add('ruch');
  for (const x of it) ustaw(x, 0);
  liczniki();

  let tryb: 'pin' | 'flow' = 'flow';
  let D = 1000;
  let s0 = 0;
  let ramka = 0;
  const W = 0.12;

  function przelicz(): void {
    const vh = innerHeight;
    // wysokość samej treści + odstępy trybu przypiętego (2 × 28 px), bez wymuszonego 100vh
    scena.classList.remove('pin');
    tor.style.height = '';
    const pi = przyp.querySelector<HTMLElement>('.plaza-in');
    if (!pi) return;
    const cs = getComputedStyle(pi);
    const H = pi.offsetHeight - Number.parseFloat(cs.paddingTop) - Number.parseFloat(cs.paddingBottom) + 56;
    const pin = innerWidth > 960 && H <= vh;
    tryb = pin ? 'pin' : 'flow';
    scena.classList.toggle('pin', pin);
    if (pin) {
      D = Math.round(vh * 1.5);
      tor.style.height = `${vh + D}px`;
    }
    s0 = tor.getBoundingClientRect().top + scrollY;
  }

  function klatka(): void {
    ramka = 0;
    const vh = innerHeight;
    if (tryb === 'pin') {
      const p = clamp((scrollY - s0) / D);
      const Pp = clamp(p / 0.92) * (1 + W);
      for (const x of it) ustaw(x, clamp((Pp - x.r) / W));
    } else {
      for (const x of it) {
        const r = x.e.getBoundingClientRect();
        ustaw(x, clamp((vh * 0.78 - r.top) / (vh * 0.2)));
      }
    }
    liczniki();
  }

  const naScroll = (): void => {
    if (!ramka) ramka = requestAnimationFrame(klatka);
  };
  const odswiez = (): void => {
    skrzydla();
    pozycje();
    przelicz();
    naScroll();
  };
  addEventListener('scroll', naScroll, { passive: true });
  let rt: ReturnType<typeof setTimeout> | undefined;
  addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(odswiez, 120);
  });
  skrzydla();
  pozycje();
  przelicz();
  klatka();
  // pasek licznika na telefonie: widoczny tylko wtedy, gdy pismo jest na ekranie
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((w) => scena.classList.toggle('widac', w[0].isIntersecting), {
      rootMargin: '-60px 0px -30% 0px',
    }).observe(kartka);
  }
  // fonty zmieniają szerokości fragmentów: po ich wczytaniu pomiar od nowa
  document.fonts?.ready.then(odswiez);
}

/**
 * Rzędy parawanów w „Skuteczności” rozkładają się od lewego kija, gdy wejdą w kadr. Bez ruchu
 * (reduced-motion, brak IntersectionObserver) stoją rozłożone od początku.
 */
export function uruchomRzedy(): void {
  const rz = [...document.querySelectorAll<HTMLElement>('.rz')];
  if (!rz.length || !document.documentElement.classList.contains('ruch')) return;
  if (!('IntersectionObserver' in window)) {
    for (const f of rz) f.classList.add('widac');
    return;
  }
  const io = new IntersectionObserver(
    (wpisy) => {
      for (const w of wpisy) {
        if (!w.isIntersecting) continue;
        w.target.classList.add('widac');
        io.unobserve(w.target);
      }
    },
    { rootMargin: '0px 0px -15% 0px' },
  );
  for (const f of rz) io.observe(f);
}
