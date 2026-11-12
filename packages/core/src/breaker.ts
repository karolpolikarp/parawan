/**
 * Circuit breaker per URL dla usług NER/LLM: 3 porażki z rzędu otwierają obwód na 30 s.
 * Usługi nie są ścieżką krytyczną, więc przy awarii od razu zostaje redakcja in-process.
 * Każde wywołanie fabryki ma osobny stan, żeby breakery NER i LLM resetowały się niezależnie.
 */
const FAILURE_THRESHOLD = 3;
const RESET_TIMEOUT_MS = 30000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
}

export interface Breaker {
  /** Czy obwód jest otwarty (usługę pomijamy)? Po czasie przepuszcza jedną próbę (half-open). */
  isOpen(url: string): boolean;
  recordSuccess(url: string): void;
  /** Po FAILURE_THRESHOLD porażkach z rzędu otwiera obwód na RESET_TIMEOUT_MS. */
  recordFailure(url: string): void;
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
        // half-open: jedna kolejna porażka od razu otwiera obwód ponownie
        b.openedAt = null;
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
