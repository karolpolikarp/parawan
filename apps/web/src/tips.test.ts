import { describe, expect, test } from 'vitest';
import { tipFlipUp, tipShift } from './tips';

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
