/**
 * Lenticular interlacing.
 *
 * A lens sheet with `lpi` lenses per inch is laid over a print at `dpi`
 * pixels per inch. Under each lens we place one thin strip of every frame.
 * Position along the interlace axis, in lens units, is
 *
 *   u(px) = px · lpi / dpi + phase
 *
 * and frame j owns the sub-interval [j/N, (j+1)/N) of every lens.
 * In "blend" mode each output pixel takes the area-weighted mix of the
 * strips it covers (anti-aliased, exact for fractional pixels-per-lens);
 * "nearest" picks the strip under the pixel centre (crisp, may alias).
 */
import { Affine } from './geometry';

export type Orientation = 'vertical' | 'horizontal';
export type Sampling = 'blend' | 'nearest';

export interface LensParams {
  lpi: number;
  dpi: number;
  frames: number;
  /** 0..1 shift of the strip pattern, in lenses */
  phase: number;
  reverse: boolean;
  sampling: Sampling;
}

export interface LensWeights {
  /** entries per pixel */
  k: number;
  /** frame index per entry (−1 = unused) */
  idx: Int16Array;
  weight: Float32Array;
}

/** Pre-compute which frames contribute to each pixel along the interlace axis. */
export function lensWeights(count: number, p: LensParams): LensWeights {
  const N = Math.max(1, Math.floor(p.frames));
  const r = p.lpi / p.dpi; // lens units per pixel
  const k = p.sampling === 'nearest' ? 1 : Math.min(N, Math.ceil(r * N) + 1);
  const idx = new Int16Array(count * k).fill(-1);
  const weight = new Float32Array(count * k);
  const order = (j: number) => (p.reverse ? N - 1 - j : j);
  const acc = new Float64Array(N); // reused per pixel
  const keptJ = new Int32Array(N), keptW = new Float64Array(N);
  for (let i = 0; i < count; i++) {
    if (p.sampling === 'nearest') {
      const u = (i + 0.5) * r + p.phase;
      const frac = u - Math.floor(u);
      idx[i] = order(Math.min(N - 1, Math.floor(frac * N)));
      weight[i] = 1;
      continue;
    }
    const u0 = i * r + p.phase;
    const u1 = (i + 1) * r + p.phase;
    // walk strip boundaries (in units of 1/N lens) between u0 and u1
    acc.fill(0);
    let s = Math.floor(u0 * N);
    let a = u0;
    while (a < u1 - 1e-12) {
      const b = Math.min(u1, (s + 1) / N);
      const j = ((s % N) + N) % N;
      acc[j] += b - a;
      a = b;
      s++;
    }
    // collect contributions in frame order, then stable-sort by weight (largest first) and keep k;
    // n ≤ N is tiny, so insertion sort on reused buffers beats allocating and sorting arrays
    let n = 0;
    for (let j = 0; j < N; j++) {
      if (!(acc[j] > 0)) continue;
      let p2 = n++;
      while (p2 > 0 && keptW[p2 - 1] < acc[j]) { keptW[p2] = keptW[p2 - 1]; keptJ[p2] = keptJ[p2 - 1]; p2--; }
      keptW[p2] = acc[j];
      keptJ[p2] = j;
    }
    if (n > k) n = k;
    let tot = 0;
    for (let e = 0; e < n; e++) tot += keptW[e];
    tot = tot || 1;
    for (let e = 0; e < n; e++) {
      idx[i * k + e] = order(keptJ[e]);
      weight[i * k + e] = keptW[e] / tot;
    }
  }
  return { k, idx, weight };
}

export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  /** every alpha is 255 → the renderer can skip transparency maths */
  opaque?: boolean;
}

export function isOpaque(data: Uint8ClampedArray | Uint8Array): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return false;
  return true;
}

/**
 * Integer source rectangle (in frame pixels) that rows [y0, y1) of a
 * `width`-wide output can sample through matrix `m`, plus a margin for
 * bilinear neighbours, clipped to the frame. Lets a band be rendered from a
 * crop of each frame instead of the whole frame.
 */
export function bandSourceRect(m: Affine, width: number, y0: number, y1: number, fw: number, fh: number, margin = 2) {
  const xs: number[] = [], ys: number[] = [];
  for (const [x, y] of [[0, y0], [width, y0], [0, y1], [width, y1]]) {
    xs.push(m[0] * x + m[2] * y + m[4]);
    ys.push(m[1] * x + m[3] * y + m[5]);
  }
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - margin);
  const yy0 = Math.max(0, Math.floor(Math.min(...ys)) - margin);
  const x1 = Math.min(fw, Math.ceil(Math.max(...xs)) + margin);
  const yy1 = Math.min(fh, Math.ceil(Math.max(...ys)) + margin);
  return { x: x0, y: yy0, w: Math.max(0, x1 - x0), h: Math.max(0, yy1 - yy0) };
}

export interface InterlaceJob {
  width: number;
  height: number;
  orientation: Orientation;
  lens: LensParams;
  frames: RGBAImage[];
  /** output pixel → frame pixel, one per frame */
  matrices: Affine[];
  /** RGB fill for samples outside a frame */
  background: [number, number, number];
}

/**
 * Render rows [y0, y1) of the interlaced image into `out` (full-width RGBA
 * rows, i.e. out.length ≥ (y1-y0)·width·4).
 */
export function renderRows(job: InterlaceJob, y0: number, y1: number, out: Uint8ClampedArray, weights?: LensWeights): void {
  const { width, orientation, frames, matrices, background } = job;
  const lw = weights ?? lensWeights(orientation === 'vertical' ? width : job.height, job.lens);
  const { k, idx, weight } = lw;
  const [br, bg, bb] = background;
  for (let y = y0; y < y1; y++) {
    let o = (y - y0) * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      const ax = orientation === 'vertical' ? x : y;
      let r = 0, g = 0, b = 0;
      for (let e = 0; e < k; e++) {
        const fi = idx[ax * k + e];
        if (fi < 0) break;
        const w = weight[ax * k + e];
        const m = matrices[fi];
        const fr = frames[fi];
        const fx = m[0] * (x + 0.5) + m[2] * (y + 0.5) + m[4] - 0.5;
        const fy = m[1] * (x + 0.5) + m[3] * (y + 0.5) + m[5] - 0.5;
        if (fx < -0.5 || fy < -0.5 || fx > fr.width - 0.5 || fy > fr.height - 0.5) {
          r += w * br; g += w * bg; b += w * bb;
          continue;
        }
        const W = fr.width, H = fr.height, d = fr.data;
        const cx = fx < 0 ? 0 : fx > W - 1 ? W - 1 : fx;
        const cy = fy < 0 ? 0 : fy > H - 1 ? H - 1 : fy;
        const x0 = cx | 0, y0i = cy | 0;
        const x1 = x0 + 1 < W ? x0 + 1 : x0;
        const y1i = y0i + 1 < H ? y0i + 1 : y0i;
        const tx = cx - x0, ty = cy - y0i;
        const i00 = (y0i * W + x0) * 4, i10 = (y0i * W + x1) * 4;
        const i01 = (y1i * W + x0) * 4, i11 = (y1i * W + x1) * 4;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        if (fr.opaque) {
          // fast path for opaque frames (most photos): plain bilinear RGB
          r += w * (w00 * d[i00] + w10 * d[i10] + w01 * d[i01] + w11 * d[i11]);
          g += w * (w00 * d[i00 + 1] + w10 * d[i10 + 1] + w01 * d[i01 + 1] + w11 * d[i11 + 1]);
          b += w * (w00 * d[i00 + 2] + w10 * d[i10 + 2] + w01 * d[i01 + 2] + w11 * d[i11 + 2]);
          continue;
        }
        // composite frame alpha over the background
        const a00 = d[i00 + 3] / 255, a10 = d[i10 + 3] / 255, a01 = d[i01 + 3] / 255, a11 = d[i11 + 3] / 255;
        const alpha = w00 * a00 + w10 * a10 + w01 * a01 + w11 * a11;
        const sr = w00 * a00 * d[i00] + w10 * a10 * d[i10] + w01 * a01 * d[i01] + w11 * a11 * d[i11];
        const sg = w00 * a00 * d[i00 + 1] + w10 * a10 * d[i10 + 1] + w01 * a01 * d[i01 + 1] + w11 * a11 * d[i11 + 1];
        const sb = w00 * a00 * d[i00 + 2] + w10 * a10 * d[i10 + 2] + w01 * a01 * d[i01 + 2] + w11 * a11 * d[i11 + 2];
        r += w * (sr + (1 - alpha) * br);
        g += w * (sg + (1 - alpha) * bg);
        b += w * (sb + (1 - alpha) * bb);
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
}

/** Useful numbers for the UI. */
export function lensStats(lpi: number, dpi: number, frames: number) {
  const ppl = dpi / lpi;
  return {
    pixelsPerLens: ppl,
    pixelsPerFrameStrip: ppl / Math.max(1, frames),
    /** frames beyond this get less than one printed pixel per lens */
    maxUsefulFrames: Math.floor(ppl),
    integerPixels: Math.abs(ppl - Math.round(ppl)) < 1e-6,
  };
}

export const COMMON_LPI = [10, 15, 20, 25, 30, 40, 50, 60, 62, 75, 100, 120, 150, 161];
export const COMMON_DPI = [300, 360, 600, 720, 1200, 1440, 2400, 2880];
