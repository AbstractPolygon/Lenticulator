/**
 * Single photo + depth map → N horizontally-shifted views for a 3D lenticular.
 *
 * Disparity convention: 1 = nearest, 0 = farthest. For view s ∈ [-½, ½] a pixel
 * moves by  s · amount · (d − focus)  pixels, so the `focus` depth stays put
 * (it sits at the print surface) while nearer/farther content shifts in
 * opposite directions. Forward-warped with a z-test (near wins); holes left
 * by disocclusion are filled from the farther (background) side.
 */
import { Gray, makeGray, sample } from './gray';

export interface ViewParams {
  views: number;
  /** total parallax between first and last view, in output pixels */
  amount: number;
  /** disparity (0..1) that stays fixed at the print plane */
  focus: number;
  /** treat the map as depth (white = far) instead of disparity (white = near) */
  invert?: boolean;
}

export interface RGBA {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** Recommended number of views for a lens/printer pair: one per print dot under each lens. */
export function framesForLens(lpi: number, dpi: number, min = 2, max = 48): number {
  return Math.max(min, Math.min(max, Math.floor(dpi / lpi)));
}

/**
 * Largest depth (total parallax, % of the image along the lens direction) a lenticular lens shows cleanly:
 * about one lens pitch per frame, i.e. frames ÷ LPI inches in total. More than this blurs and doubles.
 */
export function maxDepthPercent(frames: number, lpi: number, sizeIn: number): number {
  if (!(lpi > 0) || !(sizeIn > 0)) return Infinity;
  return (Math.max(1, frames) / lpi / sizeIn) * 100;
}

/** Normalise raw model output to 0..1 using robust (1st–99th percentile) limits. */
export function normalizeDepth(raw: Float32Array, w: number, h: number): Gray {
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(sorted.length * 0.01)];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const span = hi - lo || 1;
  const g = makeGray(w, h);
  for (let i = 0; i < raw.length; i++) g.data[i] = Math.min(1, Math.max(0, (raw[i] - lo) / span));
  return g;
}

/** RGBA → normalised NCHW float tensor for Depth Anything (ImageNet mean/std). */
export function toTensor(rgba: Uint8ClampedArray, w: number, h: number, mean: number[], std: number[]): Float32Array {
  const plane = w * h;
  const t = new Float32Array(plane * 3);
  for (let i = 0, j = 0; i < plane; i++, j += 4) {
    t[i] = (rgba[j] / 255 - mean[0]) / std[0];
    t[i + plane] = (rgba[j + 1] / 255 - mean[1]) / std[1];
    t[i + 2 * plane] = (rgba[j + 2] / 255 - mean[2]) / std[2];
  }
  return t;
}

/** Model input size: long side ≈ target, both sides multiples of the ViT patch size. */
export function modelInputSize(w: number, h: number, target = 518, patch = 14) {
  const s = target / Math.max(w, h);
  const r = (v: number) => Math.max(patch, Math.round((v * s) / patch) * patch);
  return { w: r(w), h: r(h) };
}

/** Generate the views. `depth` may be any resolution; it is sampled bilinearly. */
export function synthesizeViews(img: RGBA, depthMap: Gray, p: ViewParams): RGBA[] {
  const { width: W, height: H, data: src } = img;
  // depth at image resolution (no extra smoothing: blurring edges makes near objects smear)
  const D = makeGray(W, H);
  const sx = depthMap.w / W, sy = depthMap.h / H;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = sample(depthMap, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5);
      D.data[y * W + x] = p.invert ? 1 - v : v;
    }
  const d = D.data;

  const n = Math.max(1, Math.round(p.views));
  const views: RGBA[] = [];
  const zbuf = new Float32Array(W);
  const fx = new Float32Array(W); // target x per source pixel
  for (let k = 0; k < n; k++) {
    const s = n === 1 ? 0 : k / (n - 1) - 0.5;
    const out = new Uint8ClampedArray(W * H * 4);
    const filled = new Uint8Array(W);
    const outDepth = new Float32Array(W);
    for (let y = 0; y < H; y++) {
      zbuf.fill(-1);
      filled.fill(0);
      const row = y * W;
      for (let x = 0; x < W; x++) fx[x] = x + s * p.amount * (d[row + x] - p.focus);
      // splat each source pixel over the span to its right neighbour when the surface is continuous
      for (let x = 0; x < W; x++) {
        const dz = d[row + x];
        const a = fx[x];
        const cont = x + 1 < W && Math.abs(d[row + x + 1] - dz) < 0.04;
        const b = cont ? fx[x + 1] : a + 1;
        const x0 = Math.max(0, Math.ceil(Math.min(a, b) - 0.5));
        const x1 = Math.min(W - 1, Math.floor(Math.max(a, b) - 0.5 + (cont ? 0 : 0.999)));
        for (let t = x0; t <= x1; t++) {
          if (dz <= zbuf[t]) continue;
          zbuf[t] = dz;
          filled[t] = 1;
          outDepth[t] = dz;
          const si = (row + x) * 4, oi = (row + t) * 4;
          out[oi] = src[si]; out[oi + 1] = src[si + 1]; out[oi + 2] = src[si + 2]; out[oi + 3] = src[si + 3];
        }
      }
      // fill disocclusion holes from the farther neighbour (background)
      for (let t = 0; t < W; t++) {
        if (filled[t]) continue;
        let l = t - 1;
        while (l >= 0 && !filled[l]) l--;
        let r = t + 1;
        while (r < W && !filled[r]) r++;
        const pick = l < 0 ? r : r >= W ? l : outDepth[l] <= outDepth[r] ? l : r;
        if (pick < 0 || pick >= W) continue;
        for (let u = t; u < r && u < W; u++) {
          const oi = (row + u) * 4, pi = (row + pick) * 4;
          out[oi] = out[pi]; out[oi + 1] = out[pi + 1]; out[oi + 2] = out[pi + 2]; out[oi + 3] = out[pi + 3];
          filled[u] = 1;
          outDepth[u] = outDepth[pick];
        }
        t = r - 1;
      }
    }
    views.push({ width: W, height: H, data: out });
  }
  return views;
}
