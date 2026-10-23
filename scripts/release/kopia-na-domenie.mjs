// Sprawdza, czy kopia Parawan.html na stronie produktu to bajt w bajt plik z wydania.
// Uruchamia ją deploy-landing.yml po actions/deploy-pages. Domena idzie przez Cloudflare, którego
// funkcje strefy (np. Email Address Obfuscation, Rocket Loader, minifikacja) potrafią przepisać
// HTML w locie. Wtedy plik na domenie przestaje być plikiem z wydania: ma inną sumę niż
// SHA256SUMS.txt i atestacja go nie obejmuje. Różnica kończy job błędem, a decyzja (wyłączenie
// funkcji strefy albo rezygnacja z kopii) należy do właściciela.
//
//   node scripts/release/kopia-na-domenie.mjs <adres> --sha256 <hex> [--proby 11] [--odstep 60]
//   node scripts/release/kopia-na-domenie.mjs <adres> --sumy SHA256SUMS.txt [--nazwa Parawan.html]
//
// Pierwsza próba zaraz po deployu, kolejne co --odstep sekund (domyślnie co minutę), bo GitHub
// Pages i Cloudflare przez kilka minut mogą podawać poprzednią wersję z pamięci podręcznej.
// --zla-suma odwraca oczekiwaną sumę: ręczna próba, że krok naprawdę wywraca job.
// Bez zależności (fetch z Node 20).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Suma pliku `name` z treści SHA256SUMS.txt (format sha256sum: „<hex>  <nazwa>”). */
export function sumFromSums(text, name) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/i);
    if (m && m[2].trim() === name) return m[1].toLowerCase();
  }
  throw new Error(`w SHA256SUMS.txt nie ma sumy pliku ${name}`);
}

/** Ta sama suma z ostatnią cyfrą zmienioną: do próby, że niezgodność wywraca krok. */
export const wrongSum = (hex) => hex.slice(0, -1) + (hex.endsWith('0') ? '1' : '0');

/**
 * Jedna próba: pobiera adres z pominięciem pamięci podręcznej przeglądarki i porównuje sumę.
 * @returns {Promise<{ ok: boolean, status: number, sha: string, bytes: number }>}
 */
export async function checkOnce(url, expected, fetchImpl = fetch) {
  const res = await fetchImpl(url, { cache: 'no-store', headers: { 'cache-control': 'no-cache' } });
  const buf = Buffer.from(await res.arrayBuffer());
  const sha = sha256(buf);
  return { ok: res.status === 200 && sha === expected, status: res.status, sha, bytes: buf.length };
}

/**
 * Próby co `delayMs`, aż suma się zgodzi albo skończą się próby.
 * @returns {Promise<{ ok: boolean, attempts: Array<{ status: number, sha: string, bytes: number }> }>}
 */
export async function checkCopy(
  url,
  expected,
  { tries = 11, delayMs = 60_000, fetchImpl, log = () => {} } = {},
) {
  const attempts = [];
  for (let i = 1; i <= tries; i++) {
    let r;
    try {
      r = await checkOnce(url, expected, fetchImpl);
    } catch (e) {
      r = { ok: false, status: 0, sha: `błąd pobrania: ${e?.message ?? e}`, bytes: 0 };
    }
    attempts.push(r);
    log(`próba ${i}/${tries}: HTTP ${r.status}, ${r.bytes} B, SHA-256 ${r.sha}`);
    if (r.ok) return { ok: true, attempts };
    if (i < tries) await new Promise((res) => setTimeout(res, delayMs));
  }
  return { ok: false, attempts };
}

function parseArgs(argv) {
  const opts = {
    url: '',
    sha256: '',
    sumy: '',
    nazwa: 'Parawan.html',
    proby: 11,
    odstep: 60,
    zlaSuma: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sha256') opts.sha256 = argv[++i];
    else if (a === '--sumy') opts.sumy = argv[++i];
    else if (a === '--nazwa') opts.nazwa = argv[++i];
    else if (a === '--proby') opts.proby = Number(argv[++i]);
    else if (a === '--odstep') opts.odstep = Number(argv[++i]);
    else if (a === '--zla-suma') opts.zlaSuma = true;
    else if (!opts.url) opts.url = a;
    else throw new Error(`nieznany argument: ${a}`);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let expected =
    opts.sha256 || (opts.sumy ? sumFromSums(readFileSync(opts.sumy, 'utf8'), opts.nazwa) : '');
  expected = expected.trim().toLowerCase();
  if (!opts.url || !/^[0-9a-f]{64}$/.test(expected)) {
    console.error(
      'użycie: kopia-na-domenie.mjs <adres> (--sha256 <hex> | --sumy SHA256SUMS.txt) [--proby N] [--odstep s]',
    );
    process.exitCode = 2;
    return;
  }
  if (opts.zlaSuma) {
    expected = wrongSum(expected);
    console.log(`PRÓBA: celowo zła oczekiwana suma ${expected}, krok ma się wywrócić`);
  }
  console.log(`oczekiwana SHA-256: ${expected}`);
  const { ok, attempts } = await checkCopy(opts.url, expected, {
    tries: opts.proby,
    delayMs: opts.odstep * 1000,
    log: (s) => console.log(s),
  });
  if (ok) {
    console.log(`${opts.url}: plik zgodny z wydaniem`);
    return;
  }
  const last = attempts[attempts.length - 1];
  console.log(
    `::error::${opts.url} nie jest plikiem z wydania (HTTP ${last.status}, SHA-256 ${last.sha}, oczekiwano ${expected}). ` +
      'Jeśli suma się różni przy HTTP 200, sprawdź funkcje strefy Cloudflare przepisujące HTML ' +
      '(Email Address Obfuscation, Rocket Loader, Auto Minify) albo zrezygnuj z kopii na domenie.',
  );
  // exitCode zamiast process.exit(): wyjście przy otwartym połączeniu fetch kończy się na
  // Windows awarią procesu zamiast kodu 1
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.log(`::error::${e?.message ?? e}`);
    process.exitCode = 1;
  });
}
