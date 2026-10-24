// Test samego strażnika CSP (csp.mjs), bez przeglądarki. Każda polityka niżej jest tym, co
// weryfikator przepuścił przez dawny test napisów: osłabienie jednej dyrektywy przy nietkniętych
// default-src i connect-src 'none'. Strażnik ma każdą z nich odrzucić.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cspProblems, htmlCspProblems, scriptHashes } from './csp.mjs';

/** Skrót CSP skryptu „1” (SHA-256 w base64), tak jak stoi w script-src gotowego pliku. */
const HASH_1 = "'sha256-a4ayc/80/OGda4BO/1o/V0etpOqiLx1JwB5S3beHW0s='";
const WEB =
  `default-src 'none'; script-src ${HASH_1}; style-src 'unsafe-inline'; img-src data:; ` +
  "font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'";
const SCRIPT_SRC = `script-src ${HASH_1}`;

test('csp.mjs: polityka aplikacji przechodzi, landing tylko z img-src self', () => {
  assert.deepEqual(cspProblems(WEB), []);
  const landing = WEB.replace('img-src data:', "img-src 'self' data:");
  assert.deepEqual(cspProblems(landing, { 'img-src': ["'self'"] }), []);
  assert.notDeepEqual(cspProblems(landing), [], "img-src 'self' poza landingiem");
});

test('csp.mjs: odrzuca host albo luźniejsze źródło w każdej dyrektywie', () => {
  const loosened = {
    'img-src z hostem': WEB.replace('img-src data:', 'img-src data: http://127.0.0.1:47123'),
    'font-src z hostem': WEB.replace('font-src data:', 'font-src data: https://fonts.example'),
    'style-src z hostem': WEB.replace("style-src 'unsafe-inline'", "style-src 'unsafe-inline' https:"),
    'script-src z eval': WEB.replace(SCRIPT_SRC, `${SCRIPT_SRC} 'unsafe-eval'`),
    'script-src unsafe-inline': WEB.replace(SCRIPT_SRC, "script-src 'unsafe-inline'"),
    'script-src skrót i unsafe-inline': WEB.replace(SCRIPT_SRC, `${SCRIPT_SRC} 'unsafe-inline'`),
    'script-src z hostem': WEB.replace(SCRIPT_SRC, `${SCRIPT_SRC} https://cdn.example`),
    'script-src z innym algorytmem': WEB.replace(SCRIPT_SRC, "script-src 'sha1-AAAA'"),
    'bez script-src': WEB.replace(`; ${SCRIPT_SRC}`, ''),
    'connect-src z hostem': WEB.replace("connect-src 'none'", "connect-src 'none' wss://x.example"),
    'nowa dyrektywa z hostem': `${WEB}; frame-src https://x.example`,
    'media-src z gwiazdką': `${WEB}; media-src *`,
    'bez form-action': WEB.replace("; form-action 'none'", ''),
    'bez base-uri': WEB.replace("; base-uri 'none'", ''),
    'default-src self': WEB.replace("default-src 'none'", "default-src 'self'"),
    'powtórzona dyrektywa': `${WEB}; img-src *`,
  };
  for (const [name, policy] of Object.entries(loosened)) {
    assert.notDeepEqual(cspProblems(policy), [], `przepuszczona polityka: ${name}`);
  }
});

test('csp.mjs: w HTML jeden tag meta, przed pierwszym skryptem', () => {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${WEB}" />`;
  assert.deepEqual(htmlCspProblems(`<head><meta charset="utf-8">${meta}<script>1</script>`), []);
  assert.notDeepEqual(htmlCspProblems('<head><script>1</script></head>'), [], 'brak meta');
  assert.notDeepEqual(htmlCspProblems(`<head><script>1</script>${meta}</head>`), [], 'meta po skrypcie');
  assert.notDeepEqual(htmlCspProblems(`<head>${meta}${meta}<script>1</script>`), [], 'dwa tagi meta');
});

test('csp.mjs: w script-src dokładnie skróty skryptów z pliku, dane JSON-LD pominięte', () => {
  assert.deepEqual(scriptHashes('<script>1</script>'), [HASH_1]);
  // CRLF w pliku przeglądarka czyta jako LF, więc skrót ma być ten sam
  assert.deepEqual(scriptHashes('<script>1\r\n</script>'), scriptHashes('<script>1\n</script>'));
  assert.deepEqual(
    scriptHashes('<script type="application/ld+json">{}</script><script type="module" crossorigin>1</script>'),
    [HASH_1],
  );
  const meta = `<meta http-equiv="Content-Security-Policy" content="${WEB}" />`;
  const changed = htmlCspProblems(`<head>${meta}<script>2</script>`);
  assert.ok(changed.some((p) => p.includes('brak skrótu skryptu')), changed.join('\n'));
  assert.ok(changed.some((p) => p.includes('nie pasuje')), changed.join('\n'));
  assert.notDeepEqual(htmlCspProblems(`<head>${meta}<script>1</script><script>2</script>`), [], 'drugi skrypt bez skrótu');
  assert.notDeepEqual(htmlCspProblems(`<head>${meta}</head>`), [], 'brak skryptu');
});
