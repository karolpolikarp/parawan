/** Wspólne wywołania HTTP klientów NER i LLM. */

/** Wartość dodatnia albo domyślna; zero i liczba ujemna znaczą to samo co brak wartości. */
export function positiveOr(value: number | undefined, fallback: number): number {
  return value && value > 0 ? value : fallback;
}

/**
 * `fetch` z twardym limitem czasu. Limit obejmuje też `read`, bo odczyt ciała odpowiedzi
 * od wolnej usługi może trwać dłużej niż same nagłówki.
 */
export async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  read: (res: Response) => T | Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await read(await fetch(url, { ...init, signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

/** Ciało JSON odpowiedzi 2xx; inny status to porażka dla breakera. */
export function okJson(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
