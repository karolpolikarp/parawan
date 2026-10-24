/**
 * Wiek pliku. Parawan.html się nie aktualizuje, a urzędnik zwykle nie wie, że otwiera wersję
 * sprzed roku (KRI § 19 ust. 2 pkt 12 lit. a: aktualność oprogramowania). Data builda to data
 * ostatniego commita (vite.config.ts, __BUILD_DATE__), więc dwa buildy z tego samego commita są
 * identyczne bajt w bajt. Wiek liczy wyłącznie zegar komputera: bez sieci i bez zapisu.
 */

/** Po ilu dniach odsyłacz do wydań zmienia się w ostrzeżenie. */
export const STALE_AFTER_DAYS = 180;

export const STALE_NOTE = 'Ten plik ma ponad pół roku. Sprawdź, czy jest nowsza wersja';

const DAY_MS = 24 * 60 * 60 * 1000;

/** „RRRR-MM-DD” jako północ UTC albo null, gdy to nie jest data (np. 'dev'). */
function parseBuildDate(buildDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(buildDate);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  // 2026-02-31 przechodzi przez Date.UTC jako 3 marca: taka data nie pochodzi z gita
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
  return t;
}

/** Data builda po polsku („17.10.2026”) albo pusty napis dla 'dev' i niepoprawnej daty. */
export function formatBuildDate(buildDate: string): string {
  if (parseBuildDate(buildDate) === null) return '';
  const [y, mo, d] = buildDate.split('-');
  return `${d}.${mo}.${y}`;
}

/**
 * Notka o wieku pliku albo null. Ponad STALE_AFTER_DAYS pełnych dni od daty builda daje
 * STALE_NOTE. Data z przyszłości (źle ustawiony zegar komputera) i 'dev' dają null: wtedy stoi
 * zwykły odsyłacz „sprawdź nowszą wersję”, bez straszenia.
 */
export function fileAgeNote(buildDate: string, now: Date): string | null {
  const built = parseBuildDate(buildDate);
  const at = now.getTime();
  if (built === null || Number.isNaN(at) || at < built) return null;
  return (at - built) / DAY_MS > STALE_AFTER_DAYS ? STALE_NOTE : null;
}
