/**
 * Klient opcjonalnej usługi NER (spaCy PL, `services/ner/`) — PODNOSI recall imion/nazwisk
 * ponad heurystykę słownikową z `index.ts` (rzadkie/odmienione nazwiska bez wyzwalacza).
 *
 * Usługa NER widzi tekst JUŻ po redakcji strukturalnej (PESEL/NIP/IBAN zamaskowane
 * in-process), więc wykrywa wyłącznie dodatkowe encje osobowe i zwraca tekst z maską
 * `[IMIĘ I NAZWISKO]`.
 *
 * FAIL-SAFE (nie fail-open): gdy usługa jest niedostępna, przekroczy timeout albo circuit
 * breaker jest otwarty — `nerRedact` zwraca `null`, a wołający ZOSTAJE przy wyniku
 * in-process. Ochrona nigdy nie spada poniżej warstwy regex+sumy kontrolne.
 *
 * Zero zależności: `fetch`/`AbortController` są standardem w Node 18+, Deno, Bun
 * i przeglądarce. Konfiguracja jest JAWNA (parametr), nie z env — biblioteka nie czyta
 * środowiska.
 */

import { redactPII, type PiiFinding, type PiiType, type RedactionResult } from './index.js';
import { createBreaker } from './breaker.js';

export interface NerConfig {
  /** Bazowy URL usługi NER, np. `http://127.0.0.1:8090`. */
  url: string;
  /** Opcjonalny sekret — nagłówek `Authorization: Bearer …`. */
  apiKey?: string;
  /** Twarda granica oczekiwania na NER; po niej fallback do in-process. Domyślnie 3000 ms. */
  timeoutMs?: number;
  /** Limit znaków wysyłanych do NER — ogon dłuższego tekstu zostaje przy in-process. Domyślnie 20 000. */
  maxChars?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;
const DEFAULT_MAX_CHARS = 20000;

// Circuit breaker (per URL) — wspólna implementacja, osobna mapa dla NER (patrz breaker.ts).
const breaker = createBreaker();

/** Testy/diagnostyka: wyzeruj stan breakerów NER. */
export function resetNerBreakers(): void {
  breaker.reset();
}

interface NerResponse {
  redacted: string;
  found?: PiiFinding[];
}

/** Scal zliczenia znalezisk z dwóch przebiegów (in-process + NER). */
export function mergeFindings(a: PiiFinding[], b: PiiFinding[]): PiiFinding[] {
  const map = new Map<PiiType, number>();
  for (const f of [...a, ...b]) map.set(f.type, (map.get(f.type) ?? 0) + f.count);
  return [...map.entries()].map(([type, count]) => ({ type, count }));
}

/**
 * Zredaguj imiona/nazwiska przez usługę NER. Zwraca `null` przy JAKIMKOLWIEK problemie
 * (niedostępna/timeout/zła odpowiedź/otwarty breaker) — wołający zostaje przy in-process.
 */
export async function nerRedact(
  text: string,
  config: NerConfig,
): Promise<{ redacted: string; found: PiiFinding[] } | null> {
  if (!config?.url || !text || text.length === 0) return null;

  if (breaker.isOpen(config.url)) return null;

  const timeoutMs = config.timeoutMs && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
  const maxChars = config.maxChars && config.maxChars > 0 ? config.maxChars : DEFAULT_MAX_CHARS;

  // Ogranicz latencję: NER tylko pierwsze N znaków; ogon dłuższego dokumentu zostaje
  // przy redakcji in-process (i tak już strukturalnie/heurystycznie zamaskowany).
  const head = text.length > maxChars ? text.slice(0, maxChars) : text;
  const tail = text.length > maxChars ? text.slice(maxChars) : '';

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
 * Pełna redakcja: in-process (ZAWSZE) + NER (gdy skonfigurowany i dostępny).
 * Kolejność jest istotna: NER nigdy nie widzi surowego PESEL/NIP — te są maskowane
 * in-process, zanim cokolwiek wyjdzie przez sieć (nawet na localhost).
 * Bez `config` zachowuje się IDENTYCZNIE jak `redactPII` (gwarancja fail-safe).
 */
export async function redactPIIFull(input: string, config?: NerConfig): Promise<RedactionResult> {
  const base = redactPII(input);
  if (!config?.url || !input || input.length === 0) return base;

  const ner = await nerRedact(base.redacted, config);
  if (!ner) return base; // NER niedostępny — zostajemy przy in-process

  return { redacted: ner.redacted, found: mergeFindings(base.found, ner.found) };
}

/** Szybki test dostępności usługi NER (`GET /health`). */
export async function nerHealthCheck(config: NerConfig): Promise<boolean> {
  if (!config?.url) return false;
  const controller = new AbortController();
  // spójnie z nerRedact: timeoutMs <= 0 traktujemy jak brak → DEFAULT (nie 0 ms = natychmiastowy abort)
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
