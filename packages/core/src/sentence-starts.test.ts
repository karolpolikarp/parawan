// Początki zdań po podmianach: przeliczenie w okolicy zmian daje to samo co liczenie od nowa.
import { expect, test } from 'vitest';
import type { Edit } from './regex-literals';
import { sentenceStartsOf, updateSentenceStarts } from './sentence-starts';

const PIECES = ['Ala', 'ma', 'kota', 'Ś', 'ż', '[M]', '.', '!', '?', ' ', '  ', '\t', '\n', '\r\n', ', ', 'x', 'Z'];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const pick = (r: () => number): string => PIECES[Math.floor(r() * PIECES.length)];

test('początki zdań: przeliczenie po zmianach zgadza się z liczeniem od nowa', () => {
  const r = rng(3);
  for (let k = 0; k < 3000; k++) {
    let text = '';
    for (let i = 0, n = Math.floor(r() * 40); i < n; i++) text += pick(r);
    let starts = sentenceStartsOf(text);
    for (let step = 0; step < 4; step++) {
      const edits: Edit[] = [];
      let out = '';
      let pos = 0;
      for (;;) {
        const at = pos + Math.floor(r() * 12);
        if (at > text.length || r() < 0.15) break;
        const oldLen = Math.min(Math.floor(r() * 4), text.length - at);
        let ins = '';
        for (let i = 0, n = Math.floor(r() * 3); i < n; i++) ins += pick(r);
        if (oldLen === 0 && ins === '') continue;
        out += text.slice(pos, at) + ins;
        edits.push([at, oldLen, ins.length]);
        pos = at + oldLen;
        if (pos >= text.length) break;
      }
      out += text.slice(pos);
      starts = updateSentenceStarts(starts, out, edits);
      text = out;
      expect(starts, JSON.stringify(text)).toEqual(sentenceStartsOf(text));
    }
  }
});
