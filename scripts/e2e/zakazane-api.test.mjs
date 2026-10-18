// Strażnik zakazanych API (zakazane-api.mjs) na gotowych plikach i test samego strażnika.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { API_TARGETS, FORBIDDEN_APIS, PDFJS_WORKER, forbiddenApiProblems } from './zakazane-api.mjs';

for (const [name, target] of Object.entries(API_TARGETS)) {
  test(`${name}: w gotowym pliku nie ma WebRTC, sendBeacon, EventSource, WebTransport ani workerów`, () => {
    const html = readFileSync(target.file, 'utf8');
    assert.ok(html.length > 100_000, `${target.file} ma ${html.length} znaków; brak buildu?`);
    const problems = forbiddenApiProblems(html, target.allow);
    assert.deepEqual(problems, [], `${target.file}:\n${problems.join('\n')}`);
  });
}

// Fragment pdf.js po minifikacji (PDFWorker, gałąź z prawdziwym workerem), tak jak stoi w pliku.
const PDFJS =
  'try{e._isSameOrigin(window.location,t)||(t=e._createCDNWrapper(new URL(t,window.location).href));' +
  'let n=new Worker(t,{type:`module`}),r=new ho(`main`,`worker`,n),i=()=>{a.abort(),r.destroy(),' +
  'n.terminate(),this.destroyed?this.#e.reject(Error(`Worker was destroyed`)):this.#u()}';

test('zakazane-api.mjs: każde zakazane API w kodzie wywraca strażnika', () => {
  const samples = {
    RTCPeerConnection: 'const pc=new RTCPeerConnection({iceServers:[]});',
    'webkitRTCPeerConnection jako RTCPeerConnection': 'new window.webkitRTCPeerConnection()',
    RTCDataChannel: 'x instanceof RTCDataChannel',
    sendBeacon: 'const n=navigator;n.sendBeacon(`https://x.example`,t)',
    EventSource: 'new EventSource(u)',
    WebTransport: 'new WebTransport(u)',
    'new Worker(': 'new Worker(URL.createObjectURL(b))',
    'new self.Worker(': 'new self.Worker(u)',
    SharedWorker: 'new SharedWorker(u)',
    serviceWorker: 'navigator.serviceWorker.register(`sw.js`)',
  };
  for (const [name, code] of Object.entries(samples)) {
    const html = `<script type="module">${PDFJS}${code}</script>`;
    assert.notDeepEqual(forbiddenApiProblems(html, [PDFJS_WORKER]), [], `przepuszczone: ${name}`);
  }
  assert.equal(FORBIDDEN_APIS.length, 8);
});

test('zakazane-api.mjs: wyjątek pdf.js tylko w swoim miejscu i dokładnie raz', () => {
  // pdf.js w pliku aplikacji przechodzi
  assert.deepEqual(forbiddenApiProblems(`<script>${PDFJS}</script>`, [PDFJS_WORKER]), []);
  // ten sam fragment bez wyjątku (strona produktu) nie przechodzi
  assert.notDeepEqual(forbiddenApiProblems(`<script>${PDFJS}</script>`, []), []);
  // drugie wystąpienie albo brak wystąpienia to wyjątek do przejrzenia
  assert.notDeepEqual(forbiddenApiProblems(`<script>${PDFJS}${PDFJS}</script>`, [PDFJS_WORKER]), []);
  assert.notDeepEqual(forbiddenApiProblems('<script>1</script>', [PDFJS_WORKER]), []);
  // new Worker( daleko od napisów pdf.js nie korzysta z wyjątku
  const far = `<script>${PDFJS}${' '.repeat(1000)}new Worker(u)</script>`;
  assert.notDeepEqual(forbiddenApiProblems(far, [PDFJS_WORKER]), []);
});
