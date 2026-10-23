/**
 * Suma SHA-256 i wersja wydanego Parawan.html na stronie (moduł bez DOM, używa go
 * vite.config.ts przy buildzie, a sprawdza apps/web/src/landing.test.ts).
 *
 * Deploy strony (.github/workflows/deploy-landing.yml) pobiera najnowsze wydanie, sprawdza
 * SHA256SUMS.txt i przekazuje sumę oraz wersję w zmiennych PARAWAN_SHA256 i PARAWAN_VERSION.
 * Build wstawia je w miejsce znaczników w index.html. Lokalnie zmiennych nie ma: strona mówi
 * wtedy, że suma jest na stronie wydania, i build nie pada. Suma nie może pochodzić z pliku
 * zbudowanego obok, bo pliki z wydania i z bieżącego drzewa mogą się różnić.
 */

/** Znaczniki w apps/landing/index.html, każdy dokładnie raz. */
export const MARKERS = {
  /** pełna suma Parawan.html w metryczce #pobierz */
  suma: '<!--PARAWAN:SUMA-->',
  /** ta sama suma w sekcji #dla-iod, żeby była też na wydruku tej sekcji */
  sumaIod: '<!--PARAWAN:SUMA-IOD-->',
  /** tag wydania w poleceniu git checkout (punkt 5 „Jak sprawdzić”) */
  tag: '<!--PARAWAN:TAG-->',
} as const;

export const RELEASES_URL = 'https://github.com/karolpolikarp/parawan/releases/latest';

/** Tekst zamiast sumy, gdy build nie zna wydania (lokalnie i w testach). */
export const SUMA_BRAK = `Suma jest podana na <a href="${RELEASES_URL}" target="_blank" rel="noopener noreferrer">stronie wydania</a>.`;

export interface Wydanie {
  sha256: string;
  version: string;
}

/**
 * Wydanie ze zmiennych środowiska albo null, gdy żadnej nie ma. Jedna zmienna bez drugiej albo
 * wartość w złym formacie zatrzymuje build: strona z obciętą sumą byłaby gorsza niż bez niej.
 */
export function wydanieZEnv(env: Record<string, string | undefined>): Wydanie | null {
  const sha = env.PARAWAN_SHA256?.trim().toLowerCase() ?? '';
  const ver = (env.PARAWAN_VERSION?.trim() ?? '').replace(/^v/, '');
  if (!sha && !ver) return null;
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    throw new Error(`parawan-wydanie: PARAWAN_SHA256 to nie 64 znaki szesnastkowe („${sha}”)`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(ver)) {
    throw new Error(`parawan-wydanie: PARAWAN_VERSION to nie numer wersji X.Y.Z („${ver}”)`);
  }
  return { sha256: sha, version: ver };
}

/** Wstawia sumę i tag w miejsce znaczników. Brak znacznika albo dwa naraz zatrzymują build. */
export function wstawWydanie(html: string, wydanie: Wydanie | null): string {
  for (const [name, marker] of Object.entries(MARKERS)) {
    const n = html.split(marker).length - 1;
    if (n !== 1) {
      throw new Error(`parawan-wydanie: znacznik ${marker} (${name}) występuje ${n} razy zamiast raz`);
    }
  }
  const suma = wydanie
    ? `<code class="suma" translate="no">${wydanie.sha256}</code><span class="suma-wer">Parawan.html w wersji ${wydanie.version}.</span>`
    : SUMA_BRAK;
  const tag = wydanie ? `v${wydanie.version}` : '&lt;tag wydania&gt;';
  return html
    .replace(MARKERS.suma, suma)
    .replace(MARKERS.sumaIod, suma)
    .replace(MARKERS.tag, tag);
}
