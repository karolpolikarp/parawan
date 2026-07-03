import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { redactPII } from './index';
import { mergeFindings, nerRedact, redactPIIFull, resetNerBreakers } from './ner-client';

beforeEach(() => resetNerBreakers());
afterEach(() => vi.unstubAllGlobals());

// Bez konfiguracji NER redactPIIFull MUSI zachowywać się identycznie jak in-process —
// to gwarancja fail-safe: brak/awaria NER nigdy nie obniża ochrony in-process.
test('redactPIIFull bez NER == redactPII (fail-safe)', async () => {
  const samples = [
    'PESEL 44051401359, Jan Kowalski, mail x@y.pl, tel +48 600 700 800',
    'ul. Marszałkowska 10/5, NIP 123-456-32-18',
    'Czy pracodawca może odmówić urlopu zgodnie z art. 167 KP?',
    '',
  ];
  for (const s of samples) {
    const full = await redactPIIFull(s);
    const base = redactPII(s);
    expect(full.redacted).toBe(base.redacted);
    expect(full.found.length).toBe(base.found.length);
  }
});

test('redactPIIFull z NER — scala wynik i znaleziska', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { text } = JSON.parse(String(init?.body));
      // symulacja spaCy: maskuje nazwisko, którego heurystyka in-process nie zna
      const redacted = String(text).replace('Bąkiewicz', '[IMIĘ I NAZWISKO]');
      return new Response(
        JSON.stringify({ redacted, found: [{ type: 'IMIE', count: 1 }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );

  const r = await redactPIIFull('Wczoraj Bąkiewicz podał PESEL 44051401359', {
    url: 'http://127.0.0.1:8090',
  });
  expect(r.redacted).toContain('[IMIĘ I NAZWISKO]');
  expect(r.redacted).toContain('[PESEL]');
  expect(r.redacted.includes('Bąkiewicz')).toBe(false);
  // scalone: PESEL (in-process) + IMIE (NER)
  const types = r.found.map((f) => f.type).sort();
  expect(types).toEqual(['IMIE', 'PESEL']);
});

test('nerRedact — NER dostaje tekst JUŻ po redakcji strukturalnej (nie widzi PESEL)', async () => {
  let seenByNer = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      seenByNer = JSON.parse(String(init?.body)).text;
      return new Response(JSON.stringify({ redacted: seenByNer, found: [] }), { status: 200 });
    }),
  );

  await redactPIIFull('PESEL 44051401359 pana Bąka', { url: 'http://x' });
  expect(seenByNer.includes('44051401359')).toBe(false);
  expect(seenByNer).toContain('[PESEL]');
});

test('nerRedact — awaria HTTP zwraca null (fallback), breaker otwiera się po 3 porażkach', async () => {
  const fetchMock = vi.fn(async () => new Response('boom', { status: 500 }));
  vi.stubGlobal('fetch', fetchMock);

  const cfg = { url: 'http://127.0.0.1:9999' };
  expect(await nerRedact('Pan Iksiński', cfg)).toBeNull();
  expect(await nerRedact('Pan Iksiński', cfg)).toBeNull();
  expect(await nerRedact('Pan Iksiński', cfg)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  // 4. wywołanie: breaker OPEN → w ogóle nie strzela HTTP
  expect(await nerRedact('Pan Iksiński', cfg)).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

test('redactPIIFull — awaria NER nie obniża ochrony (wynik == in-process)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('ECONNREFUSED');
  }));
  const input = 'PESEL 44051401359, Jan Kowalski';
  const full = await redactPIIFull(input, { url: 'http://127.0.0.1:9999' });
  const base = redactPII(input);
  expect(full.redacted).toBe(base.redacted);
});

test('nerRedact — długi tekst przycięty do maxChars, ogon doklejony bez zmian', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const { text } = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ redacted: `<NER>${text}</NER>`, found: [] }), { status: 200 });
    }),
  );
  const r = await nerRedact('A'.repeat(10) + 'OGON', { url: 'http://x', maxChars: 10 });
  expect(r?.redacted).toBe(`<NER>${'A'.repeat(10)}</NER>OGON`);
});

test('mergeFindings — sumuje zliczenia per typ', () => {
  const merged = mergeFindings(
    [{ type: 'IMIE', count: 1 }, { type: 'PESEL', count: 2 }],
    [{ type: 'IMIE', count: 3 }],
  );
  expect(merged.find((f) => f.type === 'IMIE')?.count).toBe(4);
  expect(merged.find((f) => f.type === 'PESEL')?.count).toBe(2);
});
