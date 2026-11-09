import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cropBox } from './crop.ts';

const image = { width: 100, height: 80 };

describe('cropBox', () => {
  it('pads by 12 CSS pixels and rounds outwards', () => {
    assert.deepEqual(cropBox({ x: 30.25, y: 25.75, width: 20.5, height: 10.5 }, image, 1), {
      x: 18, y: 13, width: 45, height: 36,
    });
  });

  it('supports an explicit padding', () => {
    assert.deepEqual(cropBox({ x: 30, y: 25, width: 20, height: 10 }, image, 1, 3), {
      x: 27, y: 22, width: 26, height: 16,
    });
  });

  for (const { edge, rect, expected } of [
    { edge: 'left', rect: { x: -5, y: 25, width: 20, height: 10 }, expected: { x: 0, y: 13, width: 27, height: 34 } },
    { edge: 'top', rect: { x: 30, y: -5, width: 20, height: 10 }, expected: { x: 18, y: 0, width: 44, height: 17 } },
    { edge: 'right', rect: { x: 90, y: 25, width: 20, height: 10 }, expected: { x: 78, y: 13, width: 22, height: 34 } },
    { edge: 'bottom', rect: { x: 30, y: 75, width: 20, height: 10 }, expected: { x: 18, y: 63, width: 44, height: 17 } },
  ]) {
    it(`clamps at the ${edge} edge`, () => {
      assert.deepEqual(cropBox(rect, image, 1), expected);
    });
  }

  it('scales coordinates and padding by 2 before rounding and clamping', () => {
    assert.deepEqual(cropBox({ x: 20.25, y: 25.75, width: 10.5, height: 10.5 }, image, 2), {
      x: 16, y: 27, width: 70, height: 53,
    });
  });

  it('accepts exactly 2 by 2 image pixels', () => {
    assert.deepEqual(cropBox({ x: 20, y: 25, width: 1, height: 1 }, image, 2, 0), {
      x: 40, y: 50, width: 2, height: 2,
    });
  });

  it('rejects crops narrower or shorter than 2 image pixels', () => {
    assert.equal(cropBox({ x: 20, y: 25, width: 1, height: 2 }, image, 1, 0), null);
    assert.equal(cropBox({ x: 20, y: 25, width: 2, height: 1 }, image, 1, 0), null);
  });

  it('checks the minimum after clamping, including fully off-image rectangles', () => {
    assert.equal(cropBox({ x: 99, y: 25, width: 10, height: 10 }, image, 1, 0), null);
    assert.equal(cropBox({ x: 20, y: 79, width: 10, height: 10 }, image, 1, 0), null);
    assert.equal(cropBox({ x: -30, y: 25, width: 1, height: 10 }, image, 1), null);
    assert.equal(cropBox({ x: 120, y: 25, width: 1, height: 10 }, image, 1), null);
  });
});
