/**
 * Eksperymentalna warstwa LLM przez lokalną Ollamę (np. Bielik) w trybie wskazywania fragmentów.
 *
 * LLM tylko wskazuje kandydatów, a maskuje kod po twardej walidacji; tekstu od modelu nie bierzemy.
 * Halucynację odcina wymóg dosłownego wystąpienia w tekście, a prompt-injection może co najwyżej
 * nadmaskować. Fail-safe: każda awaria daje `null` i wynik wcześniejszych warstw.
 */

import type { PiiFinding, RedactionResult } from './index.js';
import { mergeFindings, redactPIIFull, type NerConfig } from './ner-client.js';
import { createBreaker } from './breaker.js';
import { fetchWithTimeout, okJson, positiveOr } from './http.js';
import { escapeRe } from './charset.js';
import { MASK, PERSON_MASK } from './types.js';

export interface LlmConfig {
  /** Bazowy URL Ollamy. Domyślnie `http://127.0.0.1:11434`. */
  url?: string;
  /** Nazwa modelu w Ollamie, np. `'SpeakLeash/bielik-11b-v2.3-instruct:Q4_K_M'`. Wymagane. */
  model: string;
  /** Twarda granica oczekiwania na LLM (lokalne modele bywają wolne). Domyślnie 60 000 ms. */
  timeoutMs?: number;
  /** Limit znaków wysyłanych do LLM; ogon dłuższego tekstu zostaje przy wcześniejszych warstwach. Domyślnie 6000. */
  maxChars?: number;
}

const DEFAULT_URL = 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_CHARS = 6000;

const MAX_CANDIDATES = 100;
const MIN_CANDIDATE_LEN = 2;
const MAX_CANDIDATE_LEN = 80;

const PLACEHOLDER_ONLY = /^\[[^\[\]]*\]$/;

// Kandydat będący fragmentem maski („PESEL", „VIN") rozbiłby ją przy zamianie. Lista idzie wprost
// z `MASK`, więc nowy typ PII nie wymaga pamiętania o tym miejscu.
const KNOWN_MASKS = [...new Set(Object.values(MASK))];

// Fragment etykiety pseudonimu [OSOBA-X]: kawałek „[OSOBA-", dowolny ogon prefiksu z myślnikiem
// i literami („SOBA-AB", „-A]") albo litery z zamykającym nawiasem („AB]").
const OSOBA_FRAGMENT = /^(?:\[?OSOBA-|SOBA-|OBA-|BA-|A-|-)[A-Z]*\]?$|^[A-Z]+\]$/;
const isMaskFragment = (c: string): boolean =>
  KNOWN_MASKS.some((m) => m.includes(c)) || '[OSOBA-'.includes(c) || OSOBA_FRAGMENT.test(c);

// Wystąpienie kandydata, które zaczyna się albo kończy w środku znacznika, rozbiłoby go („AB”
// w [OSOBA-AB]). Wystąpienie obejmujące cały znacznik („Jan [IMIĘ I NAZWISKO]”) jest zamieniane.
const PLACEHOLDER_RE = new RegExp(String.raw`\[OSOBA-[A-Z]+\]|${KNOWN_MASKS.map(escapeRe).join('|')}`, 'g');

function replaceCandidate(text: string, c: string): { text: string; count: number } {
  const spans = [...text.matchAll(PLACEHOLDER_RE)].map((m) => [m.index, m.index + m[0].length]);
  const cuts = (pos: number) => spans.some(([a, b]) => pos > a && pos < b);
  let out = '';
  let count = 0;
  let last = 0;
  for (let at = text.indexOf(c); at !== -1; at = text.indexOf(c, at + 1)) {
    if (at < last || cuts(at) || cuts(at + c.length)) continue;
    out += text.slice(last, at) + PERSON_MASK;
    last = at + c.length;
    count++;
  }
  return { text: out + text.slice(last), count };
}

const SYSTEM_PROMPT =
  'Jesteś detektorem danych osobowych w polskim tekście. ' +
  'Zwróć WYŁĄCZNIE JSON w formacie {"pii": ["dokładny fragment", ...]} ' +
  'z fragmentami tekstu będącymi imionami i nazwiskami lub innymi danymi osobowymi. ' +
  'Kopiuj fragmenty ZNAK W ZNAK, dokładnie tak, jak występują w tekście. ' +
  'Jeśli w tekście nie ma danych osobowych, zwróć {"pii": []}. ' +
  'Nie dodawaj wyjaśnień ani żadnego tekstu poza JSON.';

const breaker = createBreaker();

/** Testy i diagnostyka: wyzeruj stan breakerów LLM. */
export function resetLlmBreakers(): void {
  breaker.reset();
}

/** Przepuszcza tylko stringi o dopuszczalnej długości, obecne dosłownie w pełnym tekście, bez masek i duplikatów. */
function validateCandidates(raw: unknown[], text: string): string[] {
  const accepted: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (accepted.length >= MAX_CANDIDATES) break;
    if (typeof c !== 'string') continue;
    if (c.length < MIN_CANDIDATE_LEN || c.length > MAX_CANDIDATE_LEN) continue;
    if (PLACEHOLDER_ONLY.test(c)) continue;
    if (isMaskFragment(c)) continue;
    if (text.indexOf(c) === -1) continue;
    if (seen.has(c)) continue;
    seen.add(c);
    accepted.push(c);
  }
  return accepted;
}

/**
 * Wskaż i zamaskuj dane osobowe przez lokalny LLM. Model widzi najwyżej `maxChars` znaków,
 * ale zamiana obejmuje wszystkie wystąpienia kandydata w całym tekście.
 */
export async function llmRedact(
  text: string,
  config: LlmConfig,
): Promise<{ redacted: string; found: PiiFinding[] } | null> {
  if (!config?.model || !text) return null;

  const url = (config.url && config.url.length > 0 ? config.url : DEFAULT_URL).replace(/\/$/, '');
  if (breaker.isOpen(url)) return null;

  const timeoutMs = positiveOr(config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxChars = positiveOr(config.maxChars, DEFAULT_MAX_CHARS);

  const head = text.slice(0, maxChars);

  try {
    const data = (await fetchWithTimeout(
      `${url}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          stream: false,
          format: 'json',
          options: { temperature: 0 },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: head },
          ],
        }),
      },
      timeoutMs,
      okJson,
    )) as { message?: { content?: unknown } };
    const content = data?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error('Nieprawidłowa odpowiedź Ollamy');
    }

    // Pola inne niż `pii` (np. „redacted" od nadgorliwego modelu) ignorujemy.
    const parsed = JSON.parse(content) as unknown;
    const pii = (parsed as { pii?: unknown })?.pii;
    if (!Array.isArray(pii)) throw new Error('Brak listy "pii" w odpowiedzi LLM');

    breaker.recordSuccess(url);

    const candidates = validateCandidates(pii, text);

    let redacted = text;
    let count = 0;
    for (const c of candidates) {
      // Kandydat mógł zniknąć w poprzedniej zamianie (nakładanie); wtedy count się nie zmienia.
      const r = replaceCandidate(redacted, c);
      count += r.count;
      redacted = r.text;
    }

    if (count === 0) return null;
    return { redacted, found: [{ type: 'IMIE', count }] };
  } catch {
    breaker.recordFailure(url);
    return null;
  }
}

/**
 * Redakcja in-process, potem NER i LLM, każda warstwa opcjonalna i fail-safe. LLM widzi tekst już
 * po wcześniejszych warstwach, więc surowy PESEL/NIP do modelu nie trafia. Bez `opts` jak `redactPII`.
 */
export async function redactPIIUltra(
  input: string,
  opts?: { ner?: NerConfig; llm?: LlmConfig },
): Promise<RedactionResult> {
  const base = await redactPIIFull(input, opts?.ner);
  if (!input || !opts?.llm?.model) return base;

  const llm = await llmRedact(base.redacted, opts.llm);
  if (!llm) return base;
  return { redacted: llm.redacted, found: mergeFindings(base.found, llm.found) };
}
