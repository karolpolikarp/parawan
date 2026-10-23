/* ── Dymki [data-tip] ──
   Wygląd dymka żyje w style.css (::after niesie treść, ::before strzałkę). Tutaj jest to, czego
   sam CSS nie umie:
   - nazwa i opis dla czytnika ekranu (treść z ::after jest dla niego niewidoczna),
   - zamykanie klawiszem Esc (WCAG 1.4.13),
   - dociśnięcie dymka do krawędzi okna albo edytora (na telefonie wychodził poza ekran),
   - ochrona przed kliknięciem w sam dymek: pseudo-element należy do elementu, więc klik
     w dymek nad wierszem „Co maskować” przełączałby ten wiersz. Taki klik dostaje element,
     który dymek zasłania. */

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

/**
 * Naturalna lewa krawędź dymka (przed dociśnięciem) w układzie okna. `box` to wnętrze elementu,
 * czyli blok zawierający dymek. Dymek zaczepiony z lewej stoi na `offset` od lewego brzegu
 * (wyśrodkowany: translateX(-50%), więc cofa się o połowę własnej szerokości), zaczepiony z prawej
 * kończy się `offset` przed prawym brzegiem. Przesunięcie liczymy z szerokości, a nie z macierzy
 * transform: po zwężeniu dymka (--tip-max) przeglądarka podawała jeszcze macierz dla starej szerokości.
 */
export function tipNaturalLeft(
  box: { left: number; right: number },
  width: number,
  place: { anchor: 'left' | 'right'; offset: number; centered: boolean },
): number {
  if (place.anchor === 'right') return box.right - place.offset - width;
  return box.left + place.offset - (place.centered ? width / 2 : 0);
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
    if (!tip || el.hasAttribute('aria-label')) return;
    // Nazwa ułożona z kilku elementów (aria-labelledby, np. „Pobierz” + „.docx”) zostaje,
    // ale dymek nadal trafia do opisu: przy .docx to jedyne miejsce ze zdaniem o autorze.
    if (el.hasAttribute('aria-labelledby')) {
      if (el.matches(FOCUSABLE) && !el.hasAttribute('aria-describedby')) {
        el.setAttribute('aria-describedby', tipDescId(tip));
      }
      return;
    }
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
): { a: CSSStyleDeclaration; w: number; h: number; extraW: number; extraH: number } | null {
  const a = getComputedStyle(el, '::after');
  if (a.display === 'none' || a.content === 'none') return null;
  const extraW =
    px(a.paddingLeft) + px(a.paddingRight) + px(a.borderLeftWidth) + px(a.borderRightWidth);
  const extraH =
    px(a.paddingTop) + px(a.paddingBottom) + px(a.borderTopWidth) + px(a.borderBottomWidth);
  return { a, w: px(a.width) + extraW, h: px(a.height) + extraH, extraW, extraH };
}

/** Granice dymka: edytor, który przycina przewijaną treść, a poza nim okno. */
function tipBounds(el: HTMLElement): {
  ed: HTMLElement | null;
  b: { left: number; right: number; top: number; bottom: number };
} {
  const vw = document.documentElement.clientWidth;
  const ed = el.closest<HTMLElement>('.editor');
  const er = ed?.getBoundingClientRect();
  const b = er
    ? { left: Math.max(er.left, 0), right: Math.min(er.right, vw), top: er.top, bottom: er.bottom }
    : { left: 0, right: vw, top: 0, bottom: window.innerHeight };
  return { ed, b };
}

/**
 * Dociśnij dymek do granic okna albo edytora i w edytorze otwórz go w górę, jeśli pod
 * znacznikiem nie ma miejsca. Zwężenie (--tip-max) liczymy z samego miejsca, bez pomiaru:
 * Chromium podaje wymiary pseudo-elementu z ostatniej odmalowanej klatki, więc szerokość
 * zmierzona tuż po zmianie --tip-max była jeszcze stara. Dymek lądował wtedy za prawym brzegiem
 * edytora, a przy ponownym najechaniu nie był zwężany wcale. Przesunięcie liczymy od razu,
 * a po odmalowaniu klatki jeszcze raz, już z aktualnych wymiarów. W spoczynku dymek ma
 * display:none, więc pierwszy pomiar bywa pusty i wtedy liczy się tylko ten drugi.
 */
function placeTip(el: HTMLElement): void {
  el.style.removeProperty('--tip-dx');
  delete el.dataset.tipFlip;
  const a = getComputedStyle(el, '::after');
  if (a.content === 'none') return;
  const { b } = tipBounds(el);
  const extraW =
    px(a.paddingLeft) + px(a.paddingRight) + px(a.borderLeftWidth) + px(a.borderRightWidth);
  // Mniej miejsca niż domyślne 250 px: dymek dostaje węższy max-width i zawija treść.
  const cap = Math.floor(b.right - b.left - 2 * EDGE - extraW);
  if (cap < 250 && cap > 40) el.style.setProperty('--tip-max', `${cap}px`);
  else el.style.removeProperty('--tip-max');
  shiftTip(el);
  requestAnimationFrame(() => setTimeout(() => shiftTip(el), 0));
}

/** Przesunięcie i kierunek dymka z bieżących wymiarów; nic, gdy dymek nie jest wyświetlany. */
function shiftTip(el: HTMLElement): void {
  let m = measure(el);
  if (!m) return;
  // Wymiary bywają sprzed zwężenia z placeTip. Szerokość przycinamy wtedy do max-width (treść
  // była szersza, więc zwężony dymek ma dokładnie tyle), a wysokość szacujemy z liczby linii:
  // liczy się tylko do wyboru kierunku.
  const cap = px(el.style.getPropertyValue('--tip-max'));
  const contentW = m.w - m.extraW;
  if (cap && contentW > cap + 0.5) {
    const lh = px(m.a.lineHeight) || 17;
    const lines = Math.max(1, Math.round((m.h - m.extraH) / lh));
    m = { ...m, w: cap + m.extraW, h: Math.ceil((lines * contentW) / cap) * lh + m.extraH };
  }
  const { ed, b } = tipBounds(el);
  // Naturalna lewa krawędź: blok zawierający to wnętrze elementu (bez ramek), do tego left albo
  // right z CSS. Wariant data-tip-pos="left" rośnie w lewo od prawego brzegu (right: -6px).
  // Ramki są symetryczne, a clientWidth elementu w linii (znacznik w wyniku) wynosi 0, więc
  // prawy brzeg wnętrza liczymy od prostokąta.
  const r = el.getBoundingClientRect();
  const box = { left: r.left + el.clientLeft, right: r.right - el.clientLeft };
  const left = tipNaturalLeft(
    box,
    m.w,
    el.dataset.tipPos === 'left'
      ? { anchor: 'right', offset: px(m.a.right), centered: false }
      : { anchor: 'left', offset: px(m.a.left), centered: m.a.transform !== 'none' },
  );
  const dx = tipShift(left, m.w, b);
  if (dx) el.style.setProperty('--tip-dx', `${dx}px`);
  else el.style.removeProperty('--tip-dx');
  if (ed && tipFlipUp(r, m.h, b)) el.dataset.tipFlip = 'up';
  else delete el.dataset.tipFlip;
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
  /** Właściciel dymka, w który trafiło zdarzenie; null, gdy trafiło w sam element albo obok. */
  const tipHit = (e: MouseEvent): HTMLElement | null => {
    const owner = tipOwner(e.target);
    if (!owner) return null;
    const r = owner.getBoundingClientRect();
    const outside =
      e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    return outside ? owner : null;
  };
  // Klik w dymek trafia w to, co dymek zasłania: wiersz „Co maskować” nad najechanym albo znacznik
  // w następnej linii wyniku. Wcześniej ginął, a kolejne też, bo dymek dalej wisiał pod kursorem.
  // Dymek najpierw znika (jak po Esc), inaczej elementFromPoint znalazłby znowu jego właściciela.
  // Przodka właściciela pomijamy: klik w dymek „?” nie może zwinąć sekcji, w której stoi „?”.
  const forwardClick = (e: MouseEvent, owner: HTMLElement): void => {
    dismissed = owner;
    root.classList.add('tips-off');
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under instanceof HTMLElement && !owner.contains(under) && !under.contains(owner)) {
      under.click(); // detail 0, więc ten nasłuch go przepuści
    }
  };
  for (const type of ['click', 'dblclick', 'pointerdown'] as const) {
    document.addEventListener(
      type,
      (e) => {
        // klik z klawiatury albo click() z kodu nie ma położenia (detail 0)
        if (type !== 'pointerdown' && e.detail === 0) return;
        const owner = tipHit(e);
        if (!owner) return;
        if (type !== 'pointerdown') e.preventDefault();
        e.stopPropagation();
        if (type === 'click') forwardClick(e, owner);
      },
      true,
    );
  }
}
