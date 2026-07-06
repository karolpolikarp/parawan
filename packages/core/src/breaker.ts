/**
 * Minimalny circuit breaker (per URL). Wrażliwy: 3 porażki → otwarcie na 30 s.
 * NER/LLM to WZBOGACENIE, nie ścieżka krytyczna — gdy usługa pada, szybko przestajemy
 * ją odpytywać i jedziemy na redakcji in-process. Fabryka daje OSOBNĄ mapę stanu per
 * moduł, więc reset breakerów NER i LLM działa niezależnie (istotne w testach).
 * Stan jest w pełni zamknięty w domknięciu — klient nie dotyka pól bezpośrednio.
 */
const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 30000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export interface Breaker {
  /** Czy obwód jest otwarty (usługę pomijamy)? Obsługuje przejście half-open. */
  isOpen(url: string): boolean;
  /** Udana odpowiedź — zeruje licznik porażek. */
  recordSuccess(url: string): void;
  /** Porażka — po FAILURE_THRESHOLD z rzędu otwiera obwód na RESET_TIMEOUT_MS. */
  recordFailure(url: string): void;
  /** Testy/diagnostyka: wyzeruj cały stan. */
  reset(): void;
}

export function createBreaker(): Breaker {
  const breakers = new Map<string, BreakerState>();
  const stateFor = (url: string): BreakerState => {
    let b = breakers.get(url);
    if (!b) {
      b = { failures: 0, openedAt: null };
      breakers.set(url, b);
    }
    return b;
  };
  return {
    isOpen(url) {
      const b = stateFor(url);
      if (b.openedAt === null) return false;
      if (Date.now() - b.openedAt >= RESET_TIMEOUT_MS) {
        b.openedAt = null; // half-open: przepuść jedną próbę
        b.failures = FAILURE_THRESHOLD - 1;
        return false;
      }
      return true;
    },
    recordSuccess(url) {
      const b = stateFor(url);
      b.failures = 0;
      b.openedAt = null;
    },
    recordFailure(url) {
      const b = stateFor(url);
      b.failures += 1;
      if (b.failures >= FAILURE_THRESHOLD) b.openedAt = Date.now();
    },
    reset() {
      breakers.clear();
    },
  };
}
