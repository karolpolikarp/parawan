/* ── Dymki [data-tip] ──
   Wygląd dymka żyje w style.css (::after niesie treść, ::before strzałkę). Tutaj jest to, czego
   sam CSS nie umie:
   - nazwa i opis dla czytnika ekranu (treść z ::after jest dla niego niewidoczna),
   - zamykanie klawiszem Esc (WCAG 1.4.13),
   - dociśnięcie dymka do krawędzi okna albo edytora (na telefonie wychodził poza ekran),
   - ochrona przed kliknięciem w sam dymek: pseudo-element należy do elementu, więc klik
     w dymek nad wierszem „Co maskować” przełączałby ten wiersz. */

/** Margines dymka od krawędzi okna albo edytora (px). */
const EDGE = 8;

/**
 * Przesunięcie poziome (px), po którym dymek o lewej krawędzi `left` i szerokości `width`
 * mieści się w granicach `bounds` z marginesem `margin`. Za szeroki dymek przylega do lewej.
 */
export function tipShift(
  left: number,
  width: number,
  bounds: { left: number; right: number },
  margin = EDGE,
): number {
  const lo = bounds.left + margin;
  const hi = Math.max(lo, bounds.right - margin - width);
  return Math.round(Math.min(Math.max(left, lo), hi) - left);
}

/**
 * Czy dymek otwierany w dół (pod elementem) otworzyć w górę: pod spodem brakuje miejsca,
 * a nad elementem jest go więcej. `height` obejmuje odstęp między elementem a dymkiem.
 */
export function tipFlipUp(
  anchor: { top: number; bottom: number },
  height: number,
  bounds: { top: number; bottom: number },
): boolean {
  const below = bounds.bottom - anchor.bottom;
  const above = anchor.top - bounds.top;
  return below < height && above > below;
}

/** Element, do którego należy dymek pod wskaźnikiem albo fokusem. */
function tipOwner(t: EventTarget | null): HTMLElement | null {
  return t instanceof Element ? t.closest<HTMLElement>('[data-tip]') : null;
}

/* ── Nazwy i opisy ── */

const descIds = new Map<string, string>();

/** Id ukrytego elementu z tekstem `text` (jeden na treść), do wskazania w aria-describedby. */
export function tipDescId(text: string): string {
  const known = descIds.get(text);
  if (known) return known;
  let box = document.getElementById('tip-descs');
  if (!box) {
    box = document.createElement('div');
    box.id = 'tip-descs';
    box.hidden = true;
    document.body.append(box);
  }
  const id = `tip-desc-${descIds.size + 1}`;
  const d = document.createElement('span');
  d.id = id;
  d.textContent = text;
  box.append(d);
  descIds.set(text, id);
  return id;
}

const FOCUSABLE = 'a, button, input, select, textarea, [tabindex]';

/**
 * Treść dymków do drzewa dostępności. Widoczny tekst zostaje nazwą elementu (WCAG 2.5.3:
 * „Przykład” ma się nazywać „Przykład”, a nie treścią dymka), a dymek staje się opisem.
 * Opis dostaje to, co przyjmuje fokus: przy wierszu „Co maskować” przełącznik w środku etykiety.
 * Element bez tekstu (ikona, znak marki) i pomoc „?” dostają dymek jako nazwę.
 */
export function labelTips(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-tip]').forEach((el) => {
    const tip = el.dataset.tip;
    if (!tip || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return;
    const target = el.matches(FOCUSABLE) ? el : (el.querySelector<HTMLElement>(FOCUSABLE) ?? el);
    const isHelp = el.classList.contains('help');
    if (target === el && (isHelp || !el.textContent?.trim())) {
      el.setAttribute('aria-label', tip);
      // aria-label na zwykłym span czytniki pomijają, więc element dostaje rolę
      el.setAttribute('role', isHelp ? 'note' : 'img');
    } else if (!target.hasAttribute('aria-describedby')) {
      target.setAttribute('aria-describedby', tipDescId(tip));
    }
  });
}

/**
 * „?” wewnątrz <summary> ma pokazywać pomoc, a nie zwijać sekcji. Klik w „?” blokujemy wprost,
 * a Enter i Spację tłumimy na samym „?” i dodatkowo w summary: przeglądarka przełącza sekcję
 * kliknięciem wysłanym do summary, a nie do „?”.
 */
export function guardSummaryHelp(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('summary').forEach((summary) => {
    const help = summary.querySelector<HTMLElement>('.help');
    if (!help) return;
    const blockKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
    };
    help.addEventListener('keydown', blockKey);
    help.addEventListener('keyup', blockKey);
    summary.addEventListener('click', (e) => {
      const t = e.target as Element | null;
      if (t?.closest('.help') || document.activeElement === help) e.preventDefault();
    });
  });
}

/* ── Położenie ── */

const px = (v: string): number => Number.parseFloat(v) || 0;

/** Wymiary dymka (::after) razem z wcięciem i ramką; null, gdy dymek nie jest wyświetlany. */
function measure(
  el: HTMLElement,
): { a: CSSStyleDeclaration; w: number; h: number; extraW: number } | null {
  const a = getComputedStyle(el, '::after');
  if (a.display === 'none' || a.content === 'none') return null;
  const extraW =
    px(a.paddingLeft) + px(a.paddingRight) + px(a.borderLeftWidth) + px(a.borderRightWidth);
  const extraH =
    px(a.paddingTop) + px(a.paddingBottom) + px(a.borderTopWidth) + px(a.borderBottomWidth);
  return { a, w: px(a.width) + extraW, h: px(a.height) + extraH, extraW };
}

/**
 * Dociśnij dymek do granic okna (albo edytora, który przycina przewijaną treść) i w edytorze
 * otwórz go w górę, jeśli pod znacznikiem nie ma miejsca. Szerokość dymka znamy dopiero, gdy
 * jest wyświetlany (w spoczynku ma display:none), więc przy pierwszym podejściu bez wymiarów
 * próbujemy jeszcze raz w następnej klatce.
 */
function placeTip(el: HTMLElement, retry = true): void {
  el.style.removeProperty('--tip-dx');
  el.style.removeProperty('--tip-max');
  delete el.dataset.tipFlip;
  let m = measure(el);
  if (!m) {
    if (retry) requestAnimationFrame(() => placeTip(el, false));
    return;
  }
  const vw = document.documentElement.clientWidth;
  const ed = el.closest<HTMLElement>('.editor');
  const er = ed?.getBoundingClientRect();
  const b = er
    ? { left: Math.max(er.left, 0), right: Math.min(er.right, vw), top: er.top, bottom: er.bottom }
    : { left: 0, right: vw, top: 0, bottom: window.innerHeight };
  // Dymek szerszy niż dostępne miejsce: zwęź go (treść się zawinie) i zmierz od nowa.
  const room = b.right - b.left - 2 * EDGE;
  if (m.w > room && room > 60) {
    el.style.setProperty('--tip-max', `${Math.floor(room - m.extraW)}px`);
    m = measure(el) ?? m;
  }
  // Naturalna lewa krawędź: blok zawierający to wnętrze elementu, do tego left i transform z CSS.
  const r = el.getBoundingClientRect();
  const tf =
    m.a.transform && m.a.transform !== 'none' ? new DOMMatrixReadOnly(m.a.transform).m41 : 0;
  const left = r.left + el.clientLeft + px(m.a.left) + tf;
  const dx = tipShift(left, m.w, b);
  if (dx) el.style.setProperty('--tip-dx', `${dx}px`);
  if (ed && tipFlipUp(r, m.h, b)) el.dataset.tipFlip = 'up';
}

/* ── Zamykanie i klik w dymek ── */

/** Wszystko naraz: opisy, pomoc w summary, Esc, dociskanie i ochrona przed kliknięciem w dymek. */
export function initTips(): void {
  labelTips();
  guardSummaryHelp();

  const root = document.documentElement;
  // Dymek spod kursora zamknięty przez Esc. Ruch w obrębie tego samego elementu (np. z ikony
  // na napis przycisku) nie może go przywrócić; wraca dopiero przy innym elemencie albo fokusie.
  let dismissed: HTMLElement | null = null;
  let hoverOwner: HTMLElement | null = null;

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const hovered = document.querySelectorAll<HTMLElement>('[data-tip]:hover');
    dismissed = hovered[hovered.length - 1] ?? null;
    root.classList.add('tips-off');
  });
  document.addEventListener(
    'focusin',
    (e) => {
      dismissed = null;
      root.classList.remove('tips-off');
      const owner = tipOwner(e.target);
      if (owner) placeTip(owner);
    },
    true,
  );
  document.addEventListener(
    'pointerover',
    (e) => {
      const owner = tipOwner(e.target);
      if (root.classList.contains('tips-off') && owner !== dismissed) {
        // Wyjście poza element tylko zapomina zamknięty dymek, nie pokazuje dymka z fokusu.
        if (owner) root.classList.remove('tips-off');
        dismissed = null;
      }
      if (owner !== hoverOwner) {
        hoverOwner = owner;
        if (owner) placeTip(owner);
      }
    },
    true,
  );

  // Dymek przyjmuje wskaźnik (WCAG 1.4.13: można na niego najechać), a jako pseudo-element
  // należy do elementu. Klik, dwuklik i przeciągnięcie poza prostokątem samego elementu trafiły
  // więc w dymek i nie mogą uruchomić przycisku, linku, przełącznika ani uchwytu wysokości.
  const inTip = (e: MouseEvent): boolean => {
    const owner = tipOwner(e.target);
    if (!owner) return false;
    const r = owner.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const type of ['click', 'dblclick', 'pointerdown'] as const) {
    document.addEventListener(
      type,
      (e) => {
        // klik z klawiatury albo click() z kodu nie ma położenia (detail 0)
        if (type !== 'pointerdown' && e.detail === 0) return;
        if (!inTip(e)) return;
        if (type !== 'pointerdown') e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }
}
