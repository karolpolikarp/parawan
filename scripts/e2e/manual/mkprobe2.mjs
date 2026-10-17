// Robi kopie Parawan.html z sondą: stara przeglądarka (Chromium 90–125, Firefox ESR) nie da się
// sterować z Playwright, więc wynik zapisujemy w samej stronie, w żółtym bloku #__probe, który
// czyta edge-probe.mjs, ffprobe.mjs, stary-chromium.mjs albo oko na zrzucie.
//   Parawan-probe.html            start: wersja, wynik, licznik, błędy JS (otwórz z ?demo albo ?pdftest)
//   Parawan-pliki.html            upuszcza po kolei pismo.pdf, .docx, .odt, .rtf z fixtures/urzad
//   Parawan-pliki-polyfill.html   to samo z łatką ReadableStream[Symbol.asyncIterator]; różnica
//                                 między wariantami pokazuje, czy błąd PDF to brak tej metody
//                                 (Chrome i Edge przed 124)
// Kopia z sondą to już inny plik niż wydanie (dodatkowy skrypt w linii), więc służy tylko do
// diagnozy, nigdy do publikacji.
// Użycie: node scripts/e2e/manual/mkprobe2.mjs [Parawan.html] [katalog-wyjściowy]
// Domyślnie apps/web/dist/index.html i .cache/sonda w katalogu repo.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const FIX = path.join(ROOT, 'apps/web/src/fixtures/urzad');
const [src = path.join(ROOT, 'apps/web/dist/index.html'), out = path.join(ROOT, '.cache/sonda')] =
  process.argv.slice(2);
mkdirSync(out, { recursive: true });
const html = readFileSync(src, 'utf8');

const files = [
  ['pismo.pdf', 'application/pdf'],
  ['pismo.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['pismo.odt', 'application/vnd.oasis.opendocument.text'],
  ['pismo.rtf', 'application/rtf'],
].map(([n, t]) => ({ name: n, type: t, b64: readFileSync(path.join(FIX, n)).toString('base64') }));

const polyfill = `
if (typeof ReadableStream !== 'undefined' && !(Symbol.asyncIterator in ReadableStream.prototype)) {
  ReadableStream.prototype[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try { for (;;) { const r = await reader.read(); if (r.done) return; yield r.value; } }
    finally { reader.releaseLock(); }
  };
}`;

// Sonda startu: kod w ES5, żeby zadziałał także tam, gdzie skrypt aplikacji się nie uruchomi.
const startProbe = String.raw`(function(){
  var errs=[];
  window.addEventListener('error', function(e){ errs.push('error: '+(e.message||e.type)+' @'+(e.filename||'')+':'+(e.lineno||'')+':'+(e.colno||'')); }, true);
  window.addEventListener('unhandledrejection', function(e){ errs.push('rejection: '+(e.reason && (e.reason.stack||e.reason.message) || e.reason)); });
  window.addEventListener('load', function(){
    setTimeout(function(){
      var v=document.getElementById('app-version-top');
      var out=document.getElementById('output');
      var inp=document.getElementById('input');
      var chips=document.getElementById('findings-chips');
      var b=document.createElement('pre'); b.id='__probe';
      b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff0;color:#000;font:14px monospace;padding:8px;margin:0;white-space:pre-wrap;max-height:60vh;overflow:auto';
      b.textContent='PROBE\nUA: '+navigator.userAgent+'\nwersja: '+(v&&v.textContent)+'\nchips: '+(chips&&chips.textContent.replace(/\s+/g,' ').slice(0,200))+'\nzrodlo: '+(inp&&inp.value.slice(0,120))+'\nwynik: '+(out&&out.textContent.replace(/\s+/g,' ').slice(0,400))+'\nbledy: '+(errs.join(' | ')||'brak')+'\nPROBE-END';
      document.body.appendChild(b);
    }, 4000);
  });
})();`;

const filesProbe = (withPolyfill) =>
  `(function(){
  var NL = String.fromCharCode(10);
  var errs=[];
  window.addEventListener('error', function(e){ errs.push('error: '+(e.message||e.type)); }, true);
  window.addEventListener('unhandledrejection', function(e){ errs.push('rejection: '+(e.reason && e.reason.message || e.reason)); });
  var FILES=` +
  JSON.stringify(files) +
  String.raw`;
  function b2u(b){var s=atob(b),u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
  function drop(f){var dt=new DataTransfer();dt.items.add(new File([b2u(f.b64)],f.name,{type:f.type}));document.body.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));}
  var res=[];
  function txt(el){return el?el.textContent.replace(/\s+/g,' ').trim():'';}
  function step(i){
    if(i>=FILES.length){report();return;}
    try{drop(FILES[i]);}catch(e){res.push(FILES[i].name+' => drop nieudany: '+e.message);setTimeout(function(){step(i+1);},100);return;}
    setTimeout(function(){
      var er=document.getElementById('app-error');
      res.push(FILES[i].name+' => wynik: '+txt(document.getElementById('output')).slice(0,330)+' || komunikat: '+(er&&!er.hidden?txt(er):'(brak)'));
      setTimeout(function(){step(i+1);},300);
    },4000);
  }
  function report(){var b=document.createElement('pre');b.id='__probe';b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:99999;background:#ff0;color:#000;font:13px monospace;padding:8px;margin:0;white-space:pre-wrap;max-height:90vh;overflow:auto';b.textContent=['PROBE','UA: '+navigator.userAgent,'polyfill: ` +
  (withPolyfill ? 'tak' : 'nie') +
  `'].concat(res).concat(['bledy: '+(errs.join(' | ')||'brak'),'PROBE-END']).join(NL);document.body.appendChild(b);}
  window.addEventListener('load',function(){setTimeout(function(){step(0);},800);});
})();` +
  (withPolyfill ? polyfill : '');

// Sondę wstawiamy przed <meta name="viewport">, czyli przed skryptem aplikacji: słuchacze błędów
// muszą działać, zanim aplikacja ruszy.
function inject(code) {
  const i = html.indexOf('<meta name="viewport"');
  if (i < 0) throw new Error('w pliku brak <meta name="viewport">, nie ma gdzie wstawić sondy');
  return `${html.slice(0, i)}<script>${code}</script>\n    ${html.slice(i)}`;
}

writeFileSync(path.join(out, 'Parawan-probe.html'), inject(startProbe));
writeFileSync(path.join(out, 'Parawan-pliki.html'), inject(filesProbe(false)));
writeFileSync(path.join(out, 'Parawan-pliki-polyfill.html'), inject(filesProbe(true)));
console.log(`ok: ${out}`);
