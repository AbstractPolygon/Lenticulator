import { describe, expect, it } from 'vitest';
import { estimateFlow, interpolate } from '../src/core/flow';
import { rgbaToGray } from '../src/core/gray';

/** A textured RGBA test image, shifted right by `shift` pixels. */
function textured(w: number, h: number, shift: number) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x - shift;
    const v = 128 + 60 * Math.sin(X / 5) * Math.cos(y / 7) + 40 * Math.sin((X + 2 * y) / 13);
    d.set([v, v * 0.8, 255 - v, 255], (y * w + x) * 4);
  }
  return d;
}
const mae = (a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number, m = 16) => {
  let s = 0, n = 0;
  for (let y = m; y < h - m; y++) for (let x = m; x < w - m; x++) for (let c = 0; c < 3; c++) { s += Math.abs(a[(y * w + x) * 4 + c] - b[(y * w + x) * 4 + c]); n++; }
  return s / n;
};

describe('flow', () => {
  const w = 160, h = 120;
  const A = textured(w, h, 0), B = textured(w, h, 8);
  it('measures a horizontal shift', () => {
    const f = estimateFlow(rgbaToGray(A, w, h), rgbaToGray(B, w, h));
    const inner = Array.from(f.dx).slice(f.bw * 2, -f.bw * 2);
    const med = inner.sort((p, q) => p - q)[inner.length >> 1];
    expect(med).toBeCloseTo(8, 0);
    expect(Math.abs(Array.from(f.dy).sort((p, q) => p - q)[f.dy.length >> 1])).toBeLessThanOrEqual(0.5);
  });
  it('interpolates the halfway frame much better than a crossfade', () => {
    const f = estimateFlow(rgbaToGray(A, w, h), rgbaToGray(B, w, h));
    const mid = interpolate(A, B, w, h, f, 1, 0.5);
    const truth = textured(w, h, 4);
    const fade = new Uint8ClampedArray(A.length);
    for (let i = 0; i < A.length; i++) fade[i] = (A[i] + B[i]) / 2;
    expect(mae(mid, truth, w, h)).toBeLessThan(mae(fade, truth, w, h) / 3);
  });
});
