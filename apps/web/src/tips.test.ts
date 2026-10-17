import { describe, expect, test } from 'vitest';
import { tipFlipUp, tipNaturalLeft, tipShift } from './tips';

describe('tipNaturalLeft: położenie dymka liczone z jego bieżącej szerokości', () => {
  test('dymek wyśrodkowany cofa się o połowę szerokości', () => {
    expect(tipNaturalLeft({ left: 100, right: 150 }, 200, { anchor: 'left', offset: 25, centered: true })).toBe(25);
  });

  test('dymek zaczepiony z prawej (data-tip-pos="left") kończy się 6 px za prawym brzegiem', () => {
    expect(tipNaturalLeft({ left: 270, right: 300 }, 250, { anchor: 'right', offset: -6, centered: false })).toBe(56);
  });

  test('zwężony dymek znacznika przy 320 px mieści się w edytorze', () => {
    // znacznik 100–150 w edytorze 41–279: dymek 270 px nie mieści się, zwężony ma 222 px
    const editor = { left: 41, right: 279 };
    const width = 222;
    const left = tipNaturalLeft({ left: 100, right: 150 }, width, { anchor: 'left', offset: 25, centered: true });
    const dx = tipShift(left, width, editor);
    expect(left + dx).toBeGreaterThanOrEqual(editor.left + 8);
    expect(left + dx + width).toBeLessThanOrEqual(editor.right - 8);
    // przesunięcie liczone z przestarzałej szerokości (270 px) wypychało dymek za prawy brzeg
    const staleLeft = 125 - 270 / 2;
    expect(left + tipShift(staleLeft, 270, editor) + width).toBeGreaterThan(editor.right);
  });
});

describe('tipShift: dymek dociśnięty do granic okna albo edytora', () => {
  const win = { left: 0, right: 320 };

  test('mieszczący się dymek zostaje na miejscu', () => {
    expect(tipShift(40, 200, win)).toBe(0);
  });

  test('dymek wychodzący z lewej przesuwa się w prawo do marginesu', () => {
    // „?” przy lewej krawędzi telefonu: dymek zaczynał się na x = -181
    expect(tipShift(-181, 250, win)).toBe(189);
  });

  test('dymek wychodzący z prawej przesuwa się w lewo do marginesu', () => {
    expect(tipShift(200, 250, win)).toBe(-138); // prawa krawędź na 320 - 8
  });

  test('dymek szerszy niż miejsce przylega do lewego marginesu', () => {
    expect(tipShift(-50, 400, win)).toBe(58);
  });

  test('granice edytora zamiast okna', () => {
    expect(tipShift(500, 250, { left: 300, right: 700 })).toBe(-58);
  });
});

describe('tipFlipUp: znacznik w ostatnich wierszach edytora', () => {
  const ed = { top: 100, bottom: 400 };

  test('pod znacznikiem jest miejsce: dymek zostaje pod spodem', () => {
    expect(tipFlipUp({ top: 120, bottom: 140 }, 60, ed)).toBe(false);
  });

  test('pod spodem brak miejsca, nad znacznikiem jest: dymek idzie w górę', () => {
    expect(tipFlipUp({ top: 370, bottom: 390 }, 60, ed)).toBe(true);
  });

  test('brak miejsca z obu stron: wybiera stronę, gdzie jest go więcej', () => {
    expect(tipFlipUp({ top: 140, bottom: 160 }, 400, ed)).toBe(false);
    expect(tipFlipUp({ top: 330, bottom: 350 }, 400, ed)).toBe(true);
  });
});
