/** Single-channel float image helpers used by the alignment code. */

export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

export function makeGray(w: number, h: number, fill = 0): Gray {
  const data = new Float32Array(w * h);
  if (fill) data.fill(fill);
  return { w, h, data };
}

/** Convert RGBA bytes to luminance in [0,1]. */
export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const g = makeGray(w, h);
  for (let i = 0, j = 0; i < g.data.length; i++, j += 4) {
    g.data[i] = (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) / 255;
  }
  return g;
}

/** Bilinear sample with edge clamping. */
export function sample(g: Gray, x: number, y: number): number {
  const { w, h, data } = g;
  if (x < 0) x = 0; else if (x > w - 1) x = w - 1;
  if (y < 0) y = 0; else if (y > h - 1) y = h - 1;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1 < w ? x0 + 1 : x0;
  const y1 = y0 + 1 < h ? y0 + 1 : y0;
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Halve resolution with a 2×2 box filter. */
export function downsample2(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1);
  const h = Math.max(1, g.h >> 1);
  const out = makeGray(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.min(g.h - 1, y * 2);
    const y1 = Math.min(g.h - 1, y * 2 + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.min(g.w - 1, x * 2);
      const x1 = Math.min(g.w - 1, x * 2 + 1);
      out.data[y * w + x] =
        (g.data[y0 * g.w + x0] + g.data[y0 * g.w + x1] + g.data[y1 * g.w + x0] + g.data[y1 * g.w + x1]) / 4;
    }
  }
  return out;
}

/** Separable box blur with the given radius. */
export function boxBlur(g: Gray, r: number): Gray {
  if (r <= 0) return { w: g.w, h: g.h, data: g.data.slice() };
  const { w, h } = g;
  const tmp = new Float32Array(w * h);
  const out = makeGray(w, h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += g.data[y * w + clampi(k, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / n;
      acc += g.data[y * w + clampi(x + r + 1, 0, w - 1)] - g.data[y * w + clampi(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clampi(k, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      out.data[y * w + x] = acc / n;
      acc += tmp[clampi(y + r + 1, 0, h - 1) * w + x] - tmp[clampi(y - r, 0, h - 1) * w + x];
    }
  }
  return out;
}

/** Normalise to zero mean / unit variance (robust to exposure differences). */
export function normalize(g: Gray): Gray {
  let mean = 0;
  for (const v of g.data) mean += v;
  mean /= g.data.length;
  let v2 = 0;
  for (const v of g.data) v2 += (v - mean) * (v - mean);
  const sd = Math.sqrt(v2 / g.data.length) || 1;
  const out = makeGray(g.w, g.h);
  for (let i = 0; i < g.data.length; i++) out.data[i] = (g.data[i] - mean) / sd;
  return out;
}

export function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
