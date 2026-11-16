/**
 * Maps RGBA pixels to a palette of up to 256 colours, optionally dithered (for GIF export).
 * none: nearest colour; floyd / atkinson: error diffusion; bayer: 8×8 ordered dither.
 * Alpha is ignored (GIF frames are drawn opaque).
 */
export type Dither = 'none' | 'floyd' | 'atkinson' | 'bayer';

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

/** Nearest palette index with a cache keyed on 5-bit-per-channel colour (fast enough for every pixel of every frame). */
function nearestFinder(palette: number[][]) {
  const cache = new Int16Array(32768).fill(-1);
  return (r: number, g: number, b: number): number => {
    r = r < 0 ? 0 : r > 255 ? 255 : r;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    b = b < 0 ? 0 : b > 255 ? 255 : b;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const hit = cache[key];
    if (hit >= 0) return hit;
    // search with the cell's centre so every colour in the cell gets the same answer
    const cr = (r & ~7) + 4, cg = (g & ~7) + 4, cb = (b & ~7) + 4;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const d = (p[0] - cr) ** 2 + (p[1] - cg) ** 2 + (p[2] - cb) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache[key] = best;
    return best;
  };
}

export function ditherToPalette(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, palette: number[][], mode: Dither): Uint8Array {
  const out = new Uint8Array(w * h);
  const nearest = nearestFinder(palette);
  if (mode === 'none' || mode === 'bayer') {
    // ordered dither: threshold offsets in about ±1/2 of a typical palette step
    const spread = 32;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) {
        const o = mode === 'bayer' ? ((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64 - 0.5) * spread : 0;
        out[i] = nearest(rgba[i * 4] + o, rgba[i * 4 + 1] + o, rgba[i * 4 + 2] + o);
      }
    }
    return out;
  }
  // error diffusion over a float copy of the image
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = rgba[i * 4]; buf[i * 3 + 1] = rgba[i * 4 + 1]; buf[i * 3 + 2] = rgba[i * 4 + 2];
  }
  // [dx, dy, weight]
  const kernel: [number, number, number][] = mode === 'floyd'
    ? [[1, 0, 7 / 16], [-1, 1, 3 / 16], [0, 1, 5 / 16], [1, 1, 1 / 16]]
    : [[1, 0, 1 / 8], [2, 0, 1 / 8], [-1, 1, 1 / 8], [0, 1, 1 / 8], [1, 1, 1 / 8], [0, 2, 1 / 8]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, j = i * 3;
      const r = buf[j], g = buf[j + 1], b = buf[j + 2];
      const k = nearest(Math.round(r), Math.round(g), Math.round(b));
      out[i] = k;
      const p = palette[k];
      const er = r - p[0], eg = g - p[1], eb = b - p[2];
      for (const [dx, dy, wt] of kernel) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny >= h) continue;
        const n = (ny * w + nx) * 3;
        buf[n] += er * wt; buf[n + 1] += eg * wt; buf[n + 2] += eb * wt;
      }
    }
  }
  return out;
}
