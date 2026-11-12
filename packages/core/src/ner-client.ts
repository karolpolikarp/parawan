/**
 * Klient opcjonalnej usługi NER, która podnosi recall imion i nazwisk ponad heurystykę słownikową.
 *
 * Usługa widzi tekst już po redakcji strukturalnej, więc surowy PESEL/NIP nie wychodzi przez sieć.
 * Fail-safe: przy niedostępności, timeoucie albo otwartym breakerze `nerRedact` zwraca `null`,
 * a wołający zostaje przy wyniku in-process. Konfiguracja przez parametr, biblioteka nie czyta env.
 */

import { redactPII, type PiiFinding, type PiiType, type RedactionResult } from './index.js';
import { createBreaker } from './breaker.js';

export interface NerConfig {
  /** Bazowy URL usługi NER, np. `http://127.0.0.1:8090`. */
  url: string;
  /** Opcjonalny sekret, nagłówek `Authorization: Bearer …`. */
  apiKey?: string;
  /** Twarda granica oczekiwania na NER; po niej fallback do in-process. Domyślnie 3000 ms. */
  timeoutMs?: number;
  /** Limit znaków wysyłanych do NER; ogon dłuższego tekstu zostaje przy in-process. Domyślnie 20 000. */
  maxChars?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_CHARS = 20000;

const breaker = createBreaker();

/** Testy i diagnostyka: wyzeruj stan breakerów NER. */
export function resetNerBreakers(): void {
  breaker.reset();
}

interface NerResponse {
  redacted: string;
  found?: PiiFinding[];
}

/** Scal zliczenia znalezisk z dwóch przebiegów. */
export function mergeFindings(a: PiiFinding[], b: PiiFinding[]): PiiFinding[] {
  const map = new Map<PiiType, number>();
  for (const f of [...a, ...b]) map.set(f.type, (map.get(f.type) ?? 0) + f.count);
  return [...map.entries()].map(([type, count]) => ({ type, count }));
}

/** Zredaguj imiona i nazwiska przez usługę NER. Przy jakimkolwiek problemie zwraca `null`. */
export async function nerRedact(
  text: string,
  config: NerConfig,
): Promise<{ redacted: string; found: PiiFinding[] } | null> {
  if (!config?.url || !text) return null;

  if (breaker.isOpen(config.url)) return null;

  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxChars = config.maxChars && config.maxChars > 0 ? config.maxChars : DEFAULT_MAX_CHARS;

  // NER dostaje tylko początek tekstu (latencja); ogon zostaje zamaskowany in-process.
  const head = text.slice(0, maxChars);
  const tail = text.slice(maxChars);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

    const res = await fetch(`${config.url.replace(/\/$/, '')}/redact`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text: head }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as NerResponse;
    if (typeof data.redacted !== 'string') throw new Error('Nieprawidłowa odpowiedź NER');

    breaker.recordSuccess(config.url);
    return { redacted: data.redacted + tail, found: data.found ?? [] };
  } catch {
    breaker.recordFailure(config.url);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Redakcja in-process, a potem NER, gdy skonfigurowany i dostępny. Kolejność chroni surowe
 * identyfikatory przed wysłaniem. Bez `config` wynik jest identyczny z `redactPII`.
 */
export async function redactPIIFull(input: string, config?: NerConfig): Promise<RedactionResult> {
  const base = redactPII(input);
  if (!config?.url || !input) return base;

  const ner = await nerRedact(base.redacted, config);
  if (!ner) return base;

  return { redacted: ner.redacted, found: mergeFindings(base.found, ner.found) };
}

/** Szybki test dostępności usługi NER (`GET /health`). */
export async function nerHealthCheck(config: NerConfig): Promise<boolean> {
  if (!config?.url) return false;
  const controller = new AbortController();
  // timeoutMs <= 0 jak brak wartości, a nie natychmiastowy abort.
  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${config.url.replace(/\/$/, '')}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
