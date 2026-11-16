import { describe, expect, it } from 'vitest';
import { ditherToPalette, Dither } from '../src/core/dither';

const BW = [[0, 0, 0], [255, 255, 255]];
function flat(w: number, h: number, v: number) {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) a.set([v, v, v, 255], i * 4);
  return a;
}
const whiteShare = (idx: Uint8Array) => idx.reduce((s, v) => s + v, 0) / idx.length;

describe('ditherToPalette', () => {
  it('without dithering maps every pixel to the nearest colour', () => {
    expect(whiteShare(ditherToPalette(flat(16, 16, 100), 16, 16, BW, 'none'))).toBe(0);
    expect(whiteShare(ditherToPalette(flat(16, 16, 200), 16, 16, BW, 'none'))).toBe(1);
  });
  for (const mode of ['floyd', 'bayer'] as Dither[]) {
    it(`${mode} reproduces mid grey as a mix of black and white`, () => {
      const share = whiteShare(ditherToPalette(flat(64, 64, 128), 64, 64, BW, mode));
      expect(share).toBeGreaterThan(0.4);
      expect(share).toBeLessThan(0.6);
    });
  }
  it('atkinson keeps exact palette colours unchanged', () => {
    const idx = ditherToPalette(flat(8, 8, 255), 8, 8, BW, 'atkinson');
    expect(whiteShare(idx)).toBe(1);
  });
});
