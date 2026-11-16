/**
 * Automatic frame alignment.
 *
 * All transforms map *reference* coordinates to *moving-frame* coordinates:
 *
 *   A(p) = c + [[1+a, -b], [b, 1+a]] · (p − c) + t
 *
 * so that mov(A(p)) ≈ ref(p). `c` is the image centre. This is a 4-DOF
 * similarity transform (translation, rotation, uniform scale).
 */
import { fft2d, nextPow2 } from './fft';
import { Gray, boxBlur, downsample2, makeGray, normalize, sample } from './gray';

export interface Similarity {
  tx: number;
  ty: number;
  a: number;
  b: number;
}

export type AlignMode = 'translation' | 'similarity' | 'keypoint';

export interface AlignResult extends Similarity {
  /** 0..1, rough measure of how well the frames matched after alignment. */
  confidence: number;
}

export function similarityToParams(s: Similarity): { dx: number; dy: number; rotation: number; scale: number } {
  return {
    dx: s.tx,
    dy: s.ty,
    rotation: (Math.atan2(s.b, 1 + s.a) * 180) / Math.PI,
    scale: Math.hypot(1 + s.a, s.b),
  };
}

// ---------------------------------------------------------------------------
// Phase correlation (translation)
// ---------------------------------------------------------------------------

/**
 * Estimate the translation d such that b(p) ≈ a(p − d).
 * Images must be the same size; they are windowed and zero-padded internally.
 */
export function phaseCorrelate(a: Gray, b: Gray): { dx: number; dy: number; peak: number } {
  if (a.w !== b.w || a.h !== b.h) throw new Error('phaseCorrelate: size mismatch');
  const W = nextPow2(a.w);
  const H = nextPow2(a.h);
  const ar = new Float64Array(W * H), ai = new Float64Array(W * H);
  const br = new Float64Array(W * H), bi = new Float64Array(W * H);
  const ma = mean(a), mb = mean(b);
  for (let y = 0; y < a.h; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / a.h);
    for (let x = 0; x < a.w; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / a.w);
      const win = wx * wy;
      ar[y * W + x] = (a.data[y * a.w + x] - ma) * win;
      br[y * W + x] = (b.data[y * b.w + x] - mb) * win;
    }
  }
  fft2d(ar, ai, W, H);
  fft2d(br, bi, W, H);
  // R = Fb · conj(Fa) / |…|  → peak at +d
  const rr = new Float64Array(W * H), ri = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const re = br[i] * ar[i] + bi[i] * ai[i];
    const im = bi[i] * ar[i] - br[i] * ai[i];
    const mag = Math.hypot(re, im) + 1e-12;
    rr[i] = re / mag;
    ri[i] = im / mag;
  }
  fft2d(rr, ri, W, H, true);
  let best = -Infinity, bx = 0, by = 0;
  for (let i = 0; i < W * H; i++) {
    if (rr[i] > best) {
      best = rr[i];
      bx = i % W;
      by = (i / W) | 0;
    }
  }
  const at = (x: number, y: number) => rr[((y + H) % H) * W + ((x + W) % W)];
  const sub = (m: number, c: number, p: number) => {
    const den = m - 2 * c + p;
    return Math.abs(den) < 1e-12 ? 0 : clamp((0.5 * (m - p)) / den, -0.5, 0.5);
  };
  let dx = bx + sub(at(bx - 1, by), best, at(bx + 1, by));
  let dy = by + sub(at(bx, by - 1), best, at(bx, by + 1));
  if (dx > W / 2) dx -= W;
  if (dy > H / 2) dy -= H;
  return { dx, dy, peak: best };
}

// ---------------------------------------------------------------------------
// Gauss–Newton refinement on an image pyramid
// ---------------------------------------------------------------------------

export interface RefineOptions {
  mode: 'translation' | 'similarity';
  levels?: number;
  iterations?: number;
}

function buildPyramid(g: Gray, levels: number): Gray[] {
  const pyr = [normalize(boxBlur(g, 1))];
  for (let i = 1; i < levels; i++) {
    const prev = pyr[i - 1];
    if (prev.w < 32 || prev.h < 32) break;
    pyr.push(downsample2(prev));
  }
  return pyr;
}

function gradients(g: Gray): { gx: Gray; gy: Gray } {
  const gx = makeGray(g.w, g.h), gy = makeGray(g.w, g.h);
  const { w, h, data } = g;
  for (let y = 0; y < h; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < w - 1 ? x + 1 : x;
      gx.data[y * w + x] = (data[y * w + xr] - data[y * w + xl]) / (xr - xl || 1);
      gy.data[y * w + x] = (data[yd * w + x] - data[yu * w + x]) / (yd - yu || 1);
    }
  }
  return { gx, gy };
}

/** Mean absolute residual of mov(A(p)) − ref(p) over the overlap. */
export function residual(ref: Gray, mov: Gray, s: Similarity, step = 2): number {
  const cx = (ref.w - 1) / 2, cy = (ref.h - 1) / 2;
  let acc = 0, n = 0;
  for (let y = 0; y < ref.h; y += step) {
    for (let x = 0; x < ref.w; x += step) {
      const px = x - cx, py = y - cy;
      const qx = cx + (1 + s.a) * px - s.b * py + s.tx;
      const qy = cy + s.b * px + (1 + s.a) * py + s.ty;
      if (qx < 0 || qy < 0 || qx > mov.w - 1 || qy > mov.h - 1) continue;
      acc += Math.abs(sample(mov, qx, qy) - ref.data[y * ref.w + x]);
      n++;
    }
  }
  return n > ref.w * ref.h * 0.05 / (step * step) ? acc / n : Infinity;
}

export function refine(ref: Gray, mov: Gray, init: Similarity, opts: RefineOptions): Similarity {
  const levels = opts.levels ?? 4;
  const iters = opts.iterations ?? 30;
  const rp = buildPyramid(ref, levels);
  const mp = buildPyramid(mov, levels);
  const L = Math.min(rp.length, mp.length);
  const sim = opts.mode === 'similarity';
  const np = sim ? 4 : 2;
  let s: Similarity = { ...init };

  for (let lvl = L - 1; lvl >= 0; lvl--) {
    const f = Math.pow(2, lvl);
    const R = rp[lvl], M = mp[lvl];
    const { gx, gy } = gradients(M);
    const cx = (R.w - 1) / 2, cy = (R.h - 1) / 2;
    // translation is expressed in level-0 pixels; convert to this level
    let p = sim ? [s.a, s.b, s.tx / f, s.ty / f] : [s.tx / f, s.ty / f];
    const margin = 2;
    const stride = Math.max(1, Math.floor(Math.sqrt((R.w * R.h) / 40000)));
    let lambda = 1e-3;
    for (let it = 0; it < iters; it++) {
      const a = sim ? p[0] : s.a, b = sim ? p[1] : s.b;
      const tx = sim ? p[2] : p[0], ty = sim ? p[3] : p[1];
      const Hm = new Float64Array(np * np);
      const g = new Float64Array(np);
      let count = 0, sse = 0;
      for (let y = margin; y < R.h - margin; y += stride) {
        for (let x = margin; x < R.w - margin; x += stride) {
          const px = x - cx, py = y - cy;
          const qx = cx + (1 + a) * px - b * py + tx;
          const qy = cy + b * px + (1 + a) * py + ty;
          if (qx < margin || qy < margin || qx > M.w - 1 - margin || qy > M.h - 1 - margin) continue;
          const r = sample(M, qx, qy) - R.data[y * R.w + x];
          const ix = sample(gx, qx, qy), iy = sample(gy, qx, qy);
          // Cauchy weight for robustness against parallax / occlusion
          const wgt = 1 / (1 + (r * r) / 0.25);
          const J = sim ? [ix * px + iy * py, -ix * py + iy * px, ix, iy] : [ix, iy];
          for (let i = 0; i < np; i++) {
            g[i] += wgt * J[i] * r;
            for (let j = 0; j < np; j++) Hm[i * np + j] += wgt * J[i] * J[j];
          }
          sse += wgt * r * r;
          count++;
        }
      }
      if (count < 50) break;
      for (let i = 0; i < np; i++) Hm[i * np + i] *= 1 + lambda;
      const delta = solve(Hm, g.map((v) => -v), np);
      if (!delta) break;
      p = p.map((v, i) => v + delta[i]);
      const stepT = sim ? Math.hypot(delta[2], delta[3]) : Math.hypot(delta[0], delta[1]);
      const stepR = sim ? Math.hypot(delta[0], delta[1]) * Math.max(R.w, R.h) : 0;
      void sse;
      if (stepT < 1e-3 && stepR < 1e-3) break;
    }
    if (sim) s = { a: p[0], b: p[1], tx: p[2] * f, ty: p[3] * f };
    else s = { ...s, tx: p[0] * f, ty: p[1] * f };
  }
  return s;
}

// ---------------------------------------------------------------------------
// Key-point (template) matching
// ---------------------------------------------------------------------------

/**
 * Find t such that mov(p + t) ≈ ref(p) for p in a patch around (kx, ky).
 * Uses normalised cross-correlation, coarse-to-fine.
 */
export function matchPoint(
  ref: Gray,
  mov: Gray,
  kx: number,
  ky: number,
  patchR = 24,
  searchR = 96,
  init = { dx: 0, dy: 0 },
): { dx: number; dy: number; score: number } {
  const r0 = boxBlur(ref, 1), m0 = boxBlur(mov, 1);
  const r1 = downsample2(r0), m1 = downsample2(m0);
  const coarse = nccSearch(
    r1, m1, kx / 2, ky / 2, Math.max(6, patchR / 2), searchR / 2, init.dx / 2, init.dy / 2, 1,
  );
  const fine = nccSearch(r0, m0, kx, ky, patchR, 3, coarse.dx * 2, coarse.dy * 2, 1, true);
  return fine;
}

function nccSearch(
  ref: Gray, mov: Gray, kx: number, ky: number, pr: number, sr: number,
  cdx: number, cdy: number, step: number, subpixel = false,
): { dx: number; dy: number; score: number } {
  pr = Math.round(pr);
  const R = Math.ceil(sr);
  const cx = Math.round(kx), cy = Math.round(ky);
  // template stats
  const tpl: number[] = [];
  for (let y = -pr; y <= pr; y++) for (let x = -pr; x <= pr; x++) tpl.push(sample(ref, cx + x, cy + y));
  const tm = tpl.reduce((s, v) => s + v, 0) / tpl.length;
  let tv = 0;
  for (let i = 0; i < tpl.length; i++) { tpl[i] -= tm; tv += tpl[i] * tpl[i]; }
  tv = Math.sqrt(tv) || 1;
  const size = 2 * R + 1;
  const scores = new Float64Array(size * size).fill(-1);
  let best = -Infinity, bdx = 0, bdy = 0;
  const bx = Math.round(cdx), by = Math.round(cdy);
  for (let oy = -R; oy <= R; oy += step) {
    for (let ox = -R; ox <= R; ox += step) {
      const dx = bx + ox, dy = by + oy;
      let sm = 0, k = 0;
      const vals = new Float64Array(tpl.length);
      for (let y = -pr; y <= pr; y++) {
        for (let x = -pr; x <= pr; x++) {
          const v = sample(mov, cx + x + dx, cy + y + dy);
          vals[k++] = v;
          sm += v;
        }
      }
      sm /= vals.length;
      let num = 0, mv = 0;
      for (let i = 0; i < vals.length; i++) {
        const d = vals[i] - sm;
        num += d * tpl[i];
        mv += d * d;
      }
      const sc = num / (tv * (Math.sqrt(mv) || 1));
      scores[(oy + R) * size + (ox + R)] = sc;
      if (sc > best) { best = sc; bdx = dx; bdy = dy; }
    }
  }
  let fx = bdx, fy = bdy;
  if (subpixel) {
    const ix = bdx - bx + R, iy = bdy - by + R;
    const at = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < size && y < size ? scores[y * size + x] : NaN;
    const para = (m: number, c: number, p: number) => {
      const den = m - 2 * c + p;
      return !isFinite(den) || Math.abs(den) < 1e-12 ? 0 : clamp((0.5 * (m - p)) / den, -0.5, 0.5);
    };
    fx += para(at(ix - 1, iy), best, at(ix + 1, iy));
    fy += para(at(ix, iy - 1), best, at(ix, iy + 1));
  }
  return { dx: fx, dy: fy, score: best };
}

// ---------------------------------------------------------------------------
// High-level entry point
// ---------------------------------------------------------------------------

export interface AlignOptions {
  mode: AlignMode;
  /** Key point in reference-analysis pixel coordinates (keypoint mode). */
  key?: { x: number; y: number };
  init?: Similarity;
}

export function alignFrame(ref: Gray, mov: Gray, opts: AlignOptions): AlignResult {
  if (opts.mode === 'keypoint') {
    if (!opts.key) throw new Error('Key-point alignment needs a key point');
    const pr = Math.max(12, Math.round(Math.min(ref.w, ref.h) * 0.06));
    const sr = Math.round(Math.max(ref.w, ref.h) * 0.2);
    const m = matchPoint(ref, mov, opts.key.x, opts.key.y, pr, sr, {
      dx: opts.init?.tx ?? 0,
      dy: opts.init?.ty ?? 0,
    });
    return { tx: m.dx, ty: m.dy, a: 0, b: 0, confidence: clamp(m.score, 0, 1) };
  }

  // 1) coarse translation by phase correlation on a ≤256 px version
  let r = ref, m = mov, f = 1;
  while (Math.max(r.w, r.h) > 256) {
    r = downsample2(r);
    m = downsample2(m);
    f *= 2;
  }
  const pc = phaseCorrelate(r, m);
  const coarse: Similarity = { tx: pc.dx * f, ty: pc.dy * f, a: 0, b: 0 };
  const start = opts.init && residual(ref, mov, opts.init) < residual(ref, mov, coarse) ? opts.init : coarse;

  // 2) Gauss-Newton refinement
  const refined = refine(ref, mov, start, { mode: opts.mode });
  const nr = normalize(ref), nm = normalize(mov);
  const eStart = residual(nr, nm, start);
  const eRef = residual(nr, nm, refined);
  const result = eRef <= eStart && isFiniteSim(refined) ? refined : start;
  const e = Math.min(eRef, eStart);
  // residual of ~0 → perfect, ~1.1 (uncorrelated unit-variance) → poor
  const confidence = clamp(1 - e / 1.1, 0, 1);
  return { ...result, confidence };
}

// ---------------------------------------------------------------------------

function isFiniteSim(s: Similarity) {
  return [s.a, s.b, s.tx, s.ty].every(Number.isFinite) && Math.abs(s.a) < 0.5 && Math.abs(s.b) < 0.5;
}

function mean(g: Gray): number {
  let s = 0;
  for (const v of g.data) s += v;
  return s / g.data.length;
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Solve a small dense linear system (Gaussian elimination with pivoting). */
export function solve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = A.slice();
  const x = b.slice();
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]) > Math.abs(M[piv * n + c])) piv = r;
    if (Math.abs(M[piv * n + c]) < 1e-12) return null;
    if (piv !== c) {
      for (let k = 0; k < n; k++) {
        const t = M[c * n + k]; M[c * n + k] = M[piv * n + k]; M[piv * n + k] = t;
      }
      const t = x[c]; x[c] = x[piv]; x[piv] = t;
    }
    for (let r = c + 1; r < n; r++) {
      const fct = M[r * n + c] / M[c * n + c];
      for (let k = c; k < n; k++) M[r * n + k] -= fct * M[c * n + k];
      x[r] -= fct * x[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r];
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k];
    x[r] = s / M[r * n + r];
  }
  return x;
}
