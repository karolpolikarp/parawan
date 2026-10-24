// Skrót skryptu w Content-Security-Policy gotowego pliku (aplikacja i landing). Źródłowa tablica
// CSP w vite.config.ts ma „script-src 'unsafe-inline'”, bo w chwili wstawiania meta skrypt nie
// jest jeszcze wklejony do pliku. Wtyczka cspSkrot działa na końcu, po vite-plugin-singlefile:
// liczy SHA-256 każdego skryptu w linii i podmienia 'unsafe-inline' w script-src na jego skrót.
// Przeglądarka wykona wtedy tylko ten jeden skrypt; wstrzyknięty kod w linii, np. procedura
// onerror na obrazku wstawionym z treści pisma, zostanie odrzucony jako naruszenie CSP.
// style-src 'unsafe-inline' zostaje (style w linii nie wykonują kodu).
//
// Moduł nie trafia do aplikacji: używają go tylko vite.config.ts obu stron i testy. Skrót liczy
// Web Crypto (globalne crypto.subtle jest w Node od wersji 20, a w typach DOM bez @types/node).
// Niezależnie od niego zgodność skrótu z treścią sprawdza strażnik scripts/e2e/csp.mjs.

/** Typy <script>, które przeglądarka wykonuje (pozostałe, np. application/ld+json, to dane). */
const WYKONYWALNE = /^(?:module|importmap|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;

/** Treści skryptów wykonywalnych w HTML, dokładnie między znacznikami. */
export function skryptyWLinii(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const [, attrs, body] = m;
    if (/\bsrc\s*=/i.test(attrs)) throw new Error('parawan-csp-skrot: skrypt z atrybutem src, plik ma mieć skrypt w linii');
    const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i)?.[1];
    if (type && !WYKONYWALNE.test(type)) continue;
    // „<!--” i „<script” w treści przełączają parser HTML w inny stan i koniec skryptu wypadłby
    // gdzie indziej niż tu (vite-plugin-singlefile zamienia je na \x3C). Wtedy skrót byłby zły.
    if (/<!--|<script/i.test(body)) throw new Error('parawan-csp-skrot: w treści skryptu jest „<!--” albo „<script”');
    out.push(body);
  }
  return out;
}

/**
 * Skrót w formacie źródła CSP. Parser HTML zamienia CRLF i samotne CR na LF, zanim skrypt
 * trafi do przeglądarki, więc liczymy z tą samą zamianą, z bajtów UTF-8 jak w pliku.
 */
export async function skrotCsp(body: string): Promise<string> {
  const bajty = new TextEncoder().encode(body.replace(/\r\n?/g, '\n'));
  const skrot = new Uint8Array(await crypto.subtle.digest('SHA-256', bajty));
  let bin = '';
  for (const b of skrot) bin += String.fromCharCode(b);
  return `'sha256-${btoa(bin)}'`;
}

/**
 * HTML z polityką, w której script-src 'unsafe-inline' zastąpiły skróty skryptów w linii.
 * Rzuca błąd, gdy nie ma skryptu, meta CSP albo dyrektywy do podmiany: plik bez działającej
 * polityki nie może wyjść z builda.
 */
export async function wstawSkrotySkryptow(html: string): Promise<string> {
  const skroty = [...new Set(await Promise.all(skryptyWLinii(html).map(skrotCsp)))];
  if (!skroty.length) throw new Error('parawan-csp-skrot: w pliku nie ma skryptu w linii');
  const meta = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/gi;
  const ile = [...html.matchAll(meta)].length;
  if (ile !== 1) throw new Error(`parawan-csp-skrot: tagów meta CSP jest ${ile}, ma być jeden`);
  return html.replace(meta, (_m, przed: string, polityka: string, po: string) => {
    const dyrektywy = polityka.split(/;\s*/);
    const i = dyrektywy.findIndex((d) => d.trim() === "script-src 'unsafe-inline'");
    if (i === -1) throw new Error(`parawan-csp-skrot: w CSP brak „script-src 'unsafe-inline'” do podmiany (${polityka})`);
    dyrektywy[i] = `script-src ${skroty.join(' ')}`;
    return `${przed}${dyrektywy.join('; ')}${po}`;
  });
}

/** Tyle z typów paczki Rollupa, ile wtyczka potrzebuje (bez importu typów Vite do kodu w src). */
type Plik = { type: 'asset'; fileName: string; source: string | Uint8Array } | { type: 'chunk'; fileName: string };

/**
 * Wtyczka Vite: ostatnia (enforce i order 'post', w tablicy po viteSingleFile), na gotowym
 * index.html w paczce, zanim trafi na dysk. Po niej nic już nie zmienia treści skryptu.
 */
export function cspSkrot() {
  return {
    name: 'parawan-csp-skrot',
    apply: 'build' as const,
    enforce: 'post' as const,
    generateBundle: {
      order: 'post' as const,
      async handler(_opts: unknown, bundle: Record<string, Plik>) {
        const html = Object.values(bundle).filter((f) => f.fileName.endsWith('.html'));
        if (!html.length) throw new Error('parawan-csp-skrot: w paczce nie ma pliku .html');
        for (const f of html) {
          if (f.type !== 'asset') throw new Error(`parawan-csp-skrot: ${f.fileName} nie jest zasobem`);
          const src = typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source);
          f.source = await wstawSkrotySkryptow(src);
        }
      },
    },
  };
}
