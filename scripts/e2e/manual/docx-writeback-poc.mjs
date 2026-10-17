// PoC: zapis zanonimizowanego DOCX z zachowaniem formatowania (badanie wykonalności dla A15,
// nie kod produkcyjny). Wynik z 17.10.2026: ok. 19 ms, 0 wycieków w 9 częściach, Word otwiera
// plik, pogrubienie zostaje na znaczniku.
// Użycie (po npm run build -w anonimizator): node scripts/e2e/manual/docx-writeback-poc.mjs [katalog]
// Domyślnie .cache/poc-docx w katalogu repo: wejscie.docx (zbudowany tu przykład) i wyjscie.docx.
// Kroki: 1) budujemy realistyczny DOCX (nagłówek, przypis, komentarz, śledzona zmiana, hiperłącze
// mailto, pole HYPERLINK, metadane, nazwisko rozbite na runy), 2) wyciągamy tekst z mapą znak→węzeł,
// 3) redactPII na całym tekście, 4) wyrównanie oryginał↔wynik do zakresów, 5) podmiana w węzłach
// w:t, 6) zapis ZIP (nietknięte wpisy kopiowane bajt w bajt, zmienione deflate), 7) kontrola wycieku.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8, strFromU8, unzipSync, deflateSync } from 'fflate';

const { redactPII } = await import(new URL('../../../packages/core/dist/index.js', import.meta.url).href);
const OUT = process.argv[2] ?? fileURLToPath(new URL('../../../.cache/poc-docx', import.meta.url));
mkdirSync(OUT, { recursive: true });

// ───────────────────────── 1) przykładowy DOCX ─────────────────────────
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const run = (t, bold = false) => `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${t}</w:t></w:r>`;
const p = (...runs) => `<w:p>${runs.join('')}</w:p>`;
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W}><w:body>
${p(run('Znak sprawy: '), run('OR.6220.12.2026', true))}
${p(run('Wnioskodawca: '), run('Jan ', true), run('Kowal', true), run('ski', true), run(', PESEL '), run('440514'), run('01359'), run('.'))}
${p(run('Zamieszkały przy ul. Polnej 12/3, 00-950 Warszawa, tel. 600 700 800.'))}
${p(run('Kontakt: '), `<w:hyperlink r:id="rIdLink">${run('jan.kowalski@example.com')}</w:hyperlink>`, run(' oraz '),
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "mailto:jan.kowalski@example.com" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run('napisz')}<w:r><w:fldChar w:fldCharType="end"/></w:r>`)}
${p(run('Pełnomocnik: '), `<w:del w:id="1" w:author="Anna Nowak" w:date="2026-10-01T10:00:00Z"><w:r><w:delText xml:space="preserve">Piotr Wiśniewski, PESEL 02070803628</w:delText></w:r></w:del>`,
  `<w:ins w:id="2" w:author="Anna Nowak" w:date="2026-10-01T10:00:00Z">${run('adwokat Maria Zielińska')}</w:ins>`)}
${p(run('Decyzja zgodnie z art. 123 456 789 KC.'), `<w:r><w:footnoteReference w:id="1"/></w:r>`)}
${p(`<w:commentRangeStart w:id="0"/>`, run('Uzasadnienie w załączniku.'), `<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>`)}
${p(run('Wnioskodawca:\tJan Kowalski'))}
<w:sectPr><w:headerReference w:type="default" r:id="rIdHdr"/></w:sectPr>
</w:body></w:document>`;
const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W}>${p(run('Sprawa: Jan Kowalski, tel. 600 700 800'))}</w:hdr>`;
const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1">${p(run('Pismo pani Anny Nowak z 1 października, NIP 7621007893.'))}</w:footnote></w:footnotes>`;
const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${W}><w:comment w:id="0" w:author="Anna Nowak" w:initials="AN" w:date="2026-10-01T10:00:00Z">${p(run('Sprawdzić PESEL 44051401359 u Jana Kowalskiego'))}</w:comment></w:comments>`;
const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="mailto:jan.kowalski@example.com" TargetMode="External"/>
<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFn" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rIdCm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`;
const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Decyzja w sprawie Jana Kowalskiego</dc:title><dc:creator>Anna Nowak</dc:creator><cp:lastModifiedBy>Anna Nowak</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-01T10:00:00Z</dcterms:created></cp:coreProperties>`;
const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Company>Urząd Gminy</Company><Manager>Anna Nowak</Manager></Properties>`;

const source = zipSync({
  '[Content_Types].xml': strToU8(contentTypes),
  '_rels/.rels': strToU8(rootRels),
  'word/document.xml': strToU8(documentXml),
  'word/_rels/document.xml.rels': strToU8(docRels),
  'word/header1.xml': strToU8(headerXml),
  'word/footnotes.xml': strToU8(footnotesXml),
  'word/comments.xml': strToU8(commentsXml),
  'docProps/core.xml': strToU8(coreXml),
  'docProps/app.xml': strToU8(appXml),
});
writeFileSync(`${OUT}/wejscie.docx`, source);

// ───────────────────────── 2) tekst z mapą do węzłów ─────────────────────────
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Strumienie: „main” (widoczny tekst), „del” (usunięty tekst śledzonych zmian), „instr” (kody pól).
// Każdy strumień redagujemy osobno, żeby usunięty tekst nie sklejał się z widocznym w jeden wyraz.
const TOKEN = /<(w:t|w:delText|w:instrText)(\s[^<>]*)?>([^<]*)<\/\1>|<\/w:p>|<w:tab\b[^<>]*\/>|<w:(?:br|cr)\b[^<>]*\/>|<w:noBreakHyphen\b[^<>]*\/>/g;
function tokenize(xml) {
  const streams = { main: { text: '', map: [] }, del: { text: '', map: [] }, instr: { text: '', map: [] } };
  const nodes = [];
  for (const m of xml.matchAll(TOKEN)) {
    if (m[1]) {
      const stream = m[1] === 'w:t' ? 'main' : m[1] === 'w:delText' ? 'del' : 'instr';
      const innerStart = m.index + m[0].indexOf('>') + 1;
      const node = { stream, tag: m[1], attrs: m[2] ?? '', openStart: m.index, innerStart, innerEnd: innerStart + m[3].length, end: m.index + m[0].length, text: decode(m[3]) };
      nodes.push(node);
      const s = streams[stream];
      for (let i = 0; i < node.text.length; i++) s.map.push({ node: nodes.length - 1, i });
      s.text += node.text;
      if (stream !== 'main') { s.text += '\n'; s.map.push(null); } // każdy węzeł del/instr osobno
    } else {
      const ch = m[0] === '</w:p>' || /^<w:(br|cr)/.test(m[0]) ? '\n' : m[0].startsWith('<w:tab') ? '\t' : '-';
      streams.main.text += ch;
      streams.main.map.push(null); // znak syntetyczny: nie ma go w żadnym w:t
    }
  }
  return { streams, nodes };
}

// ───────────────────────── 4) wyrównanie → zakresy ─────────────────────────
const TOK = /\[(?:[A-ZĄĆĘŁŃÓŚŹŻ-]+(?: I NAZWISKO)?|OSOBA-[A-Z]+)\]/g;
/** Zakresy [start,end) oryginału zastąpione znacznikami; null, gdy któregoś odcinka wyniku nie ma w oryginale. */
function alignSpans(orig, red) {
  const spans = [];
  let pos = 0; let last = 0; let pending = [];
  const re = new RegExp(TOK.source, 'g');
  const pieces = []; // na zmianę: tekst, znacznik
  for (const m of red.matchAll(re)) { pieces.push({ text: red.slice(last, m.index) }, { mask: m[0] }); last = m.index + m[0].length; }
  pieces.push({ text: red.slice(last) });
  for (let k = 0; k < pieces.length; k++) {
    const pc = pieces[k];
    if (pc.mask) { if (!pending.length && orig.startsWith(pc.mask, pos)) { pos += pc.mask.length; continue; } pending.push(pc.mask); continue; }
    if (!pc.text) continue;
    const isLast = k === pieces.length - 1;
    // odstęp między dwoma znacznikami nie jest kotwicą (patrz compare.ts GAP_ONLY)
    if (pending.length && !isLast && /^[^\S\r\n]+$/.test(pc.text)) { pending.push(pc.text); continue; }
    const idx = isLast && orig.endsWith(pc.text) && orig.length - pc.text.length >= pos ? orig.length - pc.text.length : orig.indexOf(pc.text, pos);
    if (idx < 0) return null; // tryb ścisły: lepiej odmówić zapisu niż zgadywać
    if (pending.length) { spans.push({ start: pos, end: idx, mask: pending.join('') }); pending = []; }
    else if (idx !== pos) return null;
    pos = idx + pc.text.length;
  }
  if (pending.length) spans.push({ start: pos, end: orig.length, mask: pending.join('') });
  else if (pos !== orig.length) return null;
  return spans;
}

// ───────────────────────── 5) podmiana w węzłach ─────────────────────────
const stats = { spans: 0, nodesChanged: 0, refused: [] };
function redactPart(name, xml) {
  const { streams, nodes } = tokenize(xml);
  const newText = nodes.map((n) => n.text);
  const touched = new Set();
  const keep = nodes.map((n) => [...n.text].map(() => true));
  const insertAt = new Map();
  for (const [sname, s] of Object.entries(streams)) {
    if (!s.text.trim()) continue;
    const { redacted } = redactPII(s.text);
    if (redacted === s.text) continue;
    const spans = alignSpans(s.text, redacted);
    if (!spans) { stats.refused.push(`${name}:${sname}`); return null; }
    // przebudowa tekstu węzłów: znaki w zakresie znikają, znacznik trafia w pierwszy prawdziwy znak zakresu
    for (const sp of spans) {
      stats.spans++;
      let placed = false;
      for (let c = sp.start; c < sp.end; c++) {
        const at = s.map[c];
        if (!at) continue; // znak syntetyczny (koniec akapitu, tabulator) zostaje w XML
        keep[at.node][at.i] = false;
        touched.add(at.node);
        if (!placed) { insertAt.set(`${at.node}:${at.i}`, sp.mask); placed = true; }
      }
    }
  }
  for (const ni of touched) {
    const chars = [...nodes[ni].text];
    newText[ni] = chars.map((ch, i) => (insertAt.get(`${ni}:${i}`) ?? '') + (keep[ni][i] ? ch : '')).join('');
  }
  if (!touched.size) return xml;
  let out = ''; let last = 0;
  nodes.forEach((n, i) => {
    if (!touched.has(i)) return;
    stats.nodesChanged++;
    const t = newText[i];
    const needsPreserve = /^\s|\s$/.test(t) && !/xml:space=/.test(n.attrs);
    out += xml.slice(last, n.openStart) + `<${n.tag}${n.attrs}${needsPreserve ? ' xml:space="preserve"' : ''}>${escapeXml(t)}</${n.tag}>`;
    last = n.end;
  });
  return out + xml.slice(last);
}

// Autorzy zmian/komentarzy i metadane: osobne, proste reguły (nie tekst dokumentu).
const anonAuthors = (xml) => xml.replace(/\b(w:author|w:initials)="[^"]*"/g, (_m, a) => `${a}="${a === 'w:initials' ? 'A' : 'Autor'}"`);
function redactCore(xml) {
  return xml
    .replace(/<(dc:creator|cp:lastModifiedBy)>[^<]*<\/\1>/g, '<$1></$1>')
    .replace(/<(dc:title|dc:subject|dc:description|cp:keywords)>([^<]*)<\/\1>/g, (_m, t, v) => `<${t}>${escapeXml(redactPII(decode(v)).redacted)}</${t}>`);
}
const redactApp = (xml) => xml.replace(/<(Company|Manager)>[^<]*<\/\1>/g, '<$1></$1>');
const redactRels = (xml) => xml.replace(/Target="([^"]*)"(\s+TargetMode="External")/g, (m, target, mode) => {
  const r = redactPII(decode(target)).redacted;
  return r === decode(target) ? m : `Target="${escapeXml(encodeURI(r))}"${mode}`;
});

// ───────────────────────── 6) ZIP: kopiowanie bajt w bajt + CRC32 ─────────────────────────
const CRC_TABLE = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function readCentral(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22; while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = v.getUint16(eocd + 10, true); let off = v.getUint32(eocd + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(off + 28, true); const extraLen = v.getUint16(off + 30, true); const comLen = v.getUint16(off + 32, true);
    const local = v.getUint32(off + 42, true);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const size = v.getUint32(off + 20, true);
    entries.push({ name: strFromU8(buf.subarray(off + 46, off + 46 + nameLen)), method: v.getUint16(off + 10, true), crc: v.getUint32(off + 16, true), size, usize: v.getUint32(off + 24, true), raw: buf.subarray(start, start + size), time: v.getUint32(off + 12, true) });
    off += 46 + nameLen + extraLen + comLen;
  }
  return entries;
}

function writeZip(entries) {
  const chunks = []; const central = []; let offset = 0;
  for (const e of entries) {
    const name = strToU8(e.name);
    const lh = new Uint8Array(30 + name.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, e.method, true);
    lv.setUint32(10, e.time, true); lv.setUint32(14, e.crc, true); lv.setUint32(18, e.raw.length, true); lv.setUint32(22, e.usize, true);
    lv.setUint16(26, name.length, true); lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, e.method, true);
    cv.setUint32(12, e.time, true); cv.setUint32(16, e.crc, true); cv.setUint32(20, e.raw.length, true); cv.setUint32(24, e.usize, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
    chunks.push(lh, e.raw); central.push(ch); offset += lh.length + e.raw.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end]; const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0)); let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

// ───────────────────────── przebieg ─────────────────────────
const t0 = performance.now();
const entries = readCentral(source);
const unz = unzipSync(source); // w PoC wygodnie; w produkcji: inflateCapped tylko dla części tekstowych
const TEXT_PART = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const out = entries.map((e) => {
  let xml = null;
  const src = strFromU8(unz[e.name]);
  if (TEXT_PART.test(e.name)) { const r = redactPart(e.name, src); if (r === null) throw new Error(`odmowa: ${e.name}`); xml = anonAuthors(r); }
  else if (e.name === 'docProps/core.xml') xml = redactCore(src);
  else if (e.name === 'docProps/app.xml') xml = redactApp(src);
  else if (/_rels\/.*\.rels$/.test(e.name)) xml = redactRels(src);
  if (xml === null || xml === src) return e; // nietknięty wpis: surowe bajty bez rozpakowania
  const data = strToU8(xml);
  return { ...e, method: 8, raw: deflateSync(data, { level: 6 }), crc: crc32(data), usize: data.length };
});
const result = writeZip(out);
const ms = performance.now() - t0;
writeFileSync(`${OUT}/wyjscie.docx`, result);

// ───────────────────────── 7) kontrola wycieku ─────────────────────────
const check = unzipSync(result);
const NEEDLES = ['Kowalsk', '44051401359', '440514', '01359', '600 700 800', 'jan.kowalski', 'Nowak', 'Wiśniewski', '02070803628', 'Zielińska', '7621007893', 'Polnej', '00-950', 'Urząd Gminy'];
const leaks = [];
for (const [name, bytes] of Object.entries(check)) {
  const s = decode(strFromU8(bytes));
  for (const n of NEEDLES) if (s.includes(n)) leaks.push(`${name}: „${n}”`);
}
const visible = tokenize(strFromU8(check['word/document.xml'])).streams.main.text;
console.log(JSON.stringify({ czasMs: Math.round(ms), ...stats, rozmiarWe: source.length, rozmiarWy: result.length, wycieki: leaks, tekstWidocznyPo: visible }, null, 2));
