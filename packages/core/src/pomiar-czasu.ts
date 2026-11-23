// Pomiar czasu dla testów złożoności (rdzeń i aplikacja web). Tylko dla testów: żaden moduł
// rdzenia go nie importuje, a tsconfig.build.json ma jawną listę wejść, więc plik nie trafia do
// dist ani do paczki npm.
//
// Testy czasu liniowego porównują krótkie wejście z kilka razy dłuższym (przy 4 razy dłuższym
// kod liniowy daje stosunek ok. 4, kwadratowy ok. 16, próg 6). Pojedynczy pomiar, a nawet minimum
// z 3 prób, dawał na runnerze GitHuba (Node 20, 4 rdzenie, pliki testów równolegle) 6,1–6,6 przy
// niezmienionym kodzie: długi przebieg częściej trafia na wywłaszczenie procesu albo GC.
// Szum tylko dodaje czasu, więc minimum z wielu prób zbiega z góry do prawdziwego czasu każdego
// rozmiaru, a stosunek minimów do prawdziwego stosunku: ok. 4 dla kodu liniowego, ok. 16 dla
// kwadratowego. Więcej prób nie przesuwa wyniku w stronę progu, tylko usuwa szum. Stąd:
// - pomiary na przemian krótki i długi, żeby dryf maszyny rozkładał się na oba rozmiary;
// - RUNDY_BAZOWE rund zawsze, a kolejne tylko wtedy, gdy wynik jeszcze nie mieści się w progu
//   (dopomiarowanie), do MAKS_RUND albo do BUDZET_MS. Regresja kwadratowa ma prawdziwy stosunek
//   ok. 16, więc kolejne rundy tylko go dokładniej potwierdzają i test pada najpóźniej po budżecie.
// Asercje zostają w testach bez zmian (ten sam próg): zmienia się tylko estymator.

/** Rundy zawsze wykonywane (każda: krótkie, potem długie wejście). Test z szerokim zapasem
 *  (próg dwa razy nad stosunkiem kodu liniowego) może zacząć od jednej rundy, jak dawniej
 *  pojedynczy pomiar, i dostać kolejne tylko wtedy, gdy ta nie mieści się w progu. */
export const RUNDY_BAZOWE = 3;
/** Górna granica rund z dopomiarowaniem. */
export const MAKS_RUND = 20;
/** Czas na dopomiarowanie (ms), liczony od początku pomiaru. */
export const BUDZET_MS = 4000;
/**
 * Limit czasu testu, który woła bestTimes: domyślne 5 s vitesta nie mieści dopomiarowania pod
 * obciążeniem CI. Ten limit chroni tylko przed zawieszeniem; złożoność sprawdza asercja progu.
 */
export const LIMIT_TESTU_CZASU = 30_000;

/** Próg: liczba to największy dopuszczalny stosunek długi/krótki, funkcja to dowolny warunek. */
export type Prog = number | ((krotki: number, dlugi: number) => boolean);

/**
 * Minimalne czasy krótkiego i długiego wejścia, mierzone na przemian, z dopomiarowaniem, dopóki
 * wynik nie spełnia progu (patrz komentarz na górze pliku). `time` zwraca czas jednego przebiegu
 * w ms. Test sprawdza zwrócone czasy tym samym progiem.
 */
export function bestTimes<T>(
  time: (input: T) => number,
  small: T,
  big: T,
  prog: Prog = 6,
  rundy = RUNDY_BAZOWE,
): [number, number] {
  const ok = typeof prog === 'number' ? (a: number, b: number) => b < prog * a : prog;
  const start = performance.now();
  let a = Infinity;
  let b = Infinity;
  for (let i = 1; i <= MAKS_RUND; i++) {
    a = Math.min(a, time(small));
    b = Math.min(b, time(big));
    if (i < rundy) continue;
    if (ok(a, b) || performance.now() - start > BUDZET_MS) break;
  }
  return [a, b];
}

/**
 * Najkrótszy czas (ms) jednego przebiegu `run` do testu z bezwzględnym limitem. Drugi i trzeci
 * pomiar tylko wtedy, gdy poprzedni przekroczył limit, ale nie więcej niż trzykrotnie: chwilowe
 * obciążenie maszyny nie zatrzymuje testu, a regresja (zwykle wielokrotnie ponad limit) pada od
 * razu, bez czekania na kolejne próby.
 */
export function fastestMs(run: () => unknown, limitMs: number, proby = 3): number {
  let best = Infinity;
  for (let i = 0; i < proby; i++) {
    const t0 = performance.now();
    run();
    best = Math.min(best, performance.now() - t0);
    if (best < limitMs || best >= 3 * limitMs) break;
  }
  return best;
}
