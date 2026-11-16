import { describe, expect, it } from 'vitest';
import { scanProfiles, splitColumns, splitScan } from '../src/core/split';

/** A synthetic RGBA scan: flat border, `n` textured frames (with dark areas at their edges), flat gutters. */
function scan(n: number, frameW: number, frameH: number, gutter: number, border: number, gutterValue = 12) {
  const w = border * 2 + n * frameW + (n - 1) * gutter, h = frameH + border * 2;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 8;
    const fx = x - border, fy = y - border;
    if (fy >= 0 && fy < frameH && fx >= 0 && fx < n * frameW + (n - 1) * gutter) {
      const slot = Math.floor(fx / (frameW + gutter)), ix = fx - slot * (frameW + gutter);
      if (ix >= frameW) v = gutterValue;
      else v = ix < 15 ? 20 + ((fy * 13) % 70) : 110 + 60 * Math.sin((ix + fy) / 6); // dark but textured near frame edges
    }
    d.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { d, w, h };
}

describe('splitScan', () => {
  it('splits four frames between dark gutters, trims borders, keeps dark photo edges', () => {
    const { d, w, h } = scan(4, 200, 150, 20, 30);
    const { columns, rows } = scanProfiles(d, w, h);
    const r = splitScan(columns, rows, 4);
    expect(r).toHaveLength(4);
    [30, 250, 470, 690].forEach((x, i) => expect(Math.abs(r[i].x - x)).toBeLessThanOrEqual(1));
    r.forEach((f) => { expect(f.w).toBeGreaterThanOrEqual(199); expect(Math.abs(f.y - 30)).toBeLessThanOrEqual(1); expect(f.h).toBeGreaterThanOrEqual(149); });
  });
  it('handles light gutters and three frames', () => {
    const { d, w, h } = scan(3, 160, 100, 14, 0, 245);
    const r = splitColumns(scanProfiles(d, w, h).columns, 3);
    expect(r.map(([s]) => s)).toEqual([0, 174, 348]);
  });
  it('cuts evenly when there is no visible gap', () => {
    const { d, w, h } = scan(2, 200, 80, 0, 0);
    const r = splitColumns(scanProfiles(d, w, h).columns, 2);
    expect(r).toEqual([[0, 200], [200, 400]]);
  });
});
