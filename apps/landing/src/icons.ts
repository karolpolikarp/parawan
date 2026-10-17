/**
 * Ikony landingu jako inline SVG (linia 1.8, zaokrąglone końce, siatka 24×24). Kolor bierze się
 * z `currentColor`, więc glif przyjmuje kolor tekstu przycisku. Zero rastrów i zewnętrznych
 * assetów: wszystko wjeżdża inline do jednego pliku HTML.
 *
 * Renderowanie: elementy `<i class="gi" data-i="NAZWA">` są „hydratowane" w main.ts
 * (innerHTML = ICONS[name]). Strona używa ikon tylko w trzech przyciskach demo i w znaku marki;
 * test (apps/web/src/landing.test.ts) pilnuje, żeby każda ikona ze strony była tutaj
 * i żeby tu nie zostawały ikony, których strona już nie używa.
 */

const A = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';
const svg = (body: string): string => `<svg ${A} aria-hidden="true">${body}</svg>`;

export const ICONS: Record<string, string> = {
  // przyciski demo
  przyklad: svg('<path d="M9.5 18h5"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.6 1 1.4 1.1 2.4h5.4c.1-1 .5-1.8 1.1-2.4A6 6 0 0 0 12 3z"/>'),
  wyczysc: svg('<path d="m15.5 5 3.5 3.5a2 2 0 0 1 0 2.8L12 18.3H7l-2.5-2.5a2 2 0 0 1 0-2.8L12.7 5a2 2 0 0 1 2.8 0z"/><line x1="9" y1="10" x2="14" y2="15"/><line x1="7" y1="21" x2="20" y2="21"/>'),
  kopiuj: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),

  // Znak marki „Parawan" (dwutonowy, stałe barwy), w pasku i w stopce; patrz parawanMark() niżej.
  'parawan-mark': parawanMark(),
};

/**
 * Znak marki „Parawan" — parawan złożony w harmonijkę, widok Z GÓRY (wariant „accordion").
 * Dwutonowy: panele tylne w kolorze głównym marki, panele przednie rozjaśnione (światło na
 * złożeniach), na wierzchu słupki przy każdym zgięciu. To ZNAK MARKI o stałych barwach —
 * świadomie NIE dziedziczy `currentColor`. Własny viewBox skaluje się do kontenera `.gi`.
 * Współrzędne wyliczone z generatora makiety (nPanels=4, x0=30…x1=290, drop=158, opaque).
 */
export function parawanMark(primary = '#0B3D2E', light = '#859E97'): string {
  const pole = (x: number, y1: number): string =>
    `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y1 + 176}" stroke="${primary}" stroke-width="14" stroke-linecap="round"/>`;
  return (
    '<svg viewBox="14 48 292 235" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ' +
    'aria-hidden="true" style="display:block;overflow:visible">' +
    // panele od lewej: tył (główny) / przód (jasny) / tył / przód
    `<polygon points="30,74 95,112 95,270 30,232" fill="${primary}"/>` +
    `<polygon points="95,112 160,74 160,232 95,270" fill="${light}"/>` +
    `<polygon points="160,74 225,112 225,270 160,232" fill="${primary}"/>` +
    `<polygon points="225,112 290,74 290,232 225,270" fill="${light}"/>` +
    // górny szew — zygzak złożeń
    `<path d="M30 74 L95 112 L160 74 L225 112 L290 74" fill="none" stroke="${primary}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>` +
    // słupki przy każdym złożeniu (na wierzchu)
    pole(30, 56) + pole(95, 94) + pole(160, 56) + pole(225, 94) + pole(290, 56) +
    '</svg>'
  );
}

/**
 * Podmienia wszystkie `<i class="gi" data-i="NAZWA">` w danym korzeniu na inline SVG.
 * Wywoływane raz po załadowaniu (main.ts); dynamiczne fragmenty strony nie zawierają ikon.
 */
export function hydrateIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('i.gi[data-i]').forEach((el) => {
    if (el.dataset.done === '1') return;
    const svgMarkup = ICONS[el.dataset.i ?? ''];
    if (svgMarkup) {
      el.innerHTML = svgMarkup;
      el.dataset.done = '1';
    }
  });
}
