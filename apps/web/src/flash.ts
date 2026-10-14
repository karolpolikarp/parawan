/**
 * Chwilowa etykieta przycisku (np. „Skopiowano ✓”), która po czasie wraca do stałego tekstu.
 *
 * Stały tekst jest podany z góry, a nie odczytywany z etykiety: dawniej drugie kliknięcie
 * w ciągu 1,5 s zapamiętywało jako „poprzednią” etykietę już „Skopiowano ✓” i ta zostawała
 * na stałe. Kolejne `show` przedłuża komunikat, `reset` przywraca stały tekst od razu
 * (np. gdy wynik się zmienił i skopiowana wersja jest już nieaktualna).
 */
export interface Flash {
  show(text: string, ms?: number): void;
  reset(): void;
}

export function makeFlash(apply: (text: string) => void, idle: string, defaultMs = 1500): Flash {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(text, ms = defaultMs) {
      apply(text);
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        apply(idle);
      }, ms);
    },
    reset() {
      clearTimeout(timer);
      timer = undefined;
      apply(idle);
    },
  };
}
