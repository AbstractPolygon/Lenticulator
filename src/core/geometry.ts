/**
 * 2D affine matrices in canvas order [a, b, c, d, e, f]:
 *   x' = a·x + c·y + e
 *   y' = b·x + d·y + f
 */
export type Affine = [number, number, number, number, number, number];

export const I: Affine = [1, 0, 0, 1, 0, 0];

export function mul(m: Affine, n: Affine): Affine {
  // (m ∘ n)(p) = m(n(p))
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function compose(...ms: Affine[]): Affine {
  // compose(A, B, C)(p) = A(B(C(p)))
  return ms.reduce((acc, m) => mul(acc, m), I);
}

export function invert(m: Affine): Affine {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-15) throw new Error('Singular matrix');
  const ia = m[3] / det, ib = -m[1] / det, ic = -m[2] / det, id = m[0] / det;
  return [ia, ib, ic, id, -(ia * m[4] + ic * m[5]), -(ib * m[4] + id * m[5])];
}

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export const translate = (x: number, y: number): Affine => [1, 0, 0, 1, x, y];
export const scale = (sx: number, sy = sx): Affine => [sx, 0, 0, sy, 0, 0];
export const linear = (a: number, b: number, c: number, d: number): Affine => [a, b, c, d, 0, 0];

/** Per-frame alignment, in reference-image pixels. */
export interface FrameTransform {
  dx: number;
  dy: number;
  /** degrees */
  rotation: number;
  scale: number;
}

export const NO_TRANSFORM: FrameTransform = { dx: 0, dy: 0, rotation: 0, scale: 1 };

export interface Size {
  w: number;
  h: number;
}

/**
 * Reference → frame base mapping: frames of a different size are centred and
 * scaled to cover the reference frame's extent.
 */
export function baseMap(ref: Size, frame: Size): Affine {
  const s = Math.max(ref.w / frame.w, ref.h / frame.h);
  return compose(translate(frame.w / 2, frame.h / 2), scale(1 / s), translate(-ref.w / 2, -ref.h / 2));
}

/** Alignment transform A: reference coords → aligned reference coords. */
export function alignMap(ref: Size, t: FrameTransform): Affine {
  const th = (t.rotation * Math.PI) / 180;
  const ca = t.scale * Math.cos(th), sa = t.scale * Math.sin(th);
  return compose(translate(ref.w / 2 + t.dx, ref.h / 2 + t.dy), linear(ca, sa, -sa, ca), translate(-ref.w / 2, -ref.h / 2));
}

export interface Framing {
  fit: 'cover' | 'contain';
  /** ≥ 0.1, 1 = fitted */
  zoom: number;
  /** pan in fractions of the reference width / height */
  panX: number;
  panY: number;
}

/** Output pixel → reference pixel. */
export function outputMap(out: Size, ref: Size, f: Framing): Affine {
  const sx = out.w / ref.w, sy = out.h / ref.h;
  const fit = f.fit === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const k = 1 / (fit * Math.max(0.05, f.zoom));
  return compose(
    translate(ref.w / 2 + f.panX * ref.w, ref.h / 2 + f.panY * ref.h),
    scale(k),
    translate(-out.w / 2, -out.h / 2),
  );
}

/** Full output-pixel → frame-pixel mapping for one frame. */
export function frameMatrix(out: Size, ref: Size, frame: Size, t: FrameTransform, f: Framing): Affine {
  return compose(baseMap(ref, frame), alignMap(ref, t), outputMap(out, ref, f));
}

type Pt = [number, number];

/** Signed area (positive = counter-clockwise in y-up, clockwise on screen). */
function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Sutherland–Hodgman: the part of convex polygon `subject` inside convex polygon `clip`. */
function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  const sign = Math.sign(signedArea(clip)) || 1;
  const inside = (p: Pt, a: Pt, b: Pt) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-9;
  const cross = (p: Pt, q: Pt, a: Pt, b: Pt): Pt => {
    const r: Pt = [q[0] - p[0], q[1] - p[1]], s: Pt = [b[0] - a[0], b[1] - a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    const t = den === 0 ? 0 : ((a[0] - p[0]) * s[1] - (a[1] - p[1]) * s[0]) / den;
    return [p[0] + t * r[0], p[1] + t * r[1]];
  };
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const pin = inside(p, a, b), qin = inside(q, a, b);
      if (pin) out.push(p);
      if (pin !== qin) out.push(cross(p, q, a, b));
    }
  }
  return out;
}

/** The region of the reference frame that every frame covers (a convex polygon in reference pixels). */
export function commonArea(ref: Size, frames: { size: Size; t: FrameTransform }[]): Pt[] {
  let poly: Pt[] = [[0, 0], [ref.w, 0], [ref.w, ref.h], [0, ref.h]];
  for (const f of frames) {
    // frame pixel → reference pixel
    const m = invert(compose(baseMap(ref, f.size), alignMap(ref, f.t)));
    const rect = ([[0, 0], [f.size.w, 0], [f.size.w, f.size.h], [0, f.size.h]] as Pt[]).map(([x, y]) => apply(m, x, y));
    poly = clipConvex(poly, rect);
    if (poly.length < 3) return [];
  }
  return poly;
}

function insideConvex(p: Pt, poly: Pt[]): boolean {
  const sign = Math.sign(signedArea(poly)) || 1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < -1e-6) return false;
  }
  return true;
}

/**
 * Framing that fills the print area with only the region every frame covers: centred on that region and zoomed
 * in just enough (never zoomed out past 1). Null when the frames don't overlap.
 */
export function cropToCommon(out: Size, ref: Size, frames: { size: Size; t: FrameTransform }[]): Framing | null {
  const poly = commonArea(ref, frames);
  if (poly.length < 3) return null;
  // centroid of the polygon
  let cx = 0, cy = 0, a6 = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const c = x1 * y2 - x2 * y1;
    a6 += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c;
  }
  if (Math.abs(a6) < 1e-9) return null;
  cx /= 3 * a6; cy /= 3 * a6;
  const base: Framing = { fit: 'cover', zoom: 1, panX: cx / ref.w - 0.5, panY: cy / ref.h - 0.5 };
  const fits = (zoom: number) => {
    const m = outputMap(out, ref, { ...base, zoom });
    return ([[0, 0], [out.w, 0], [out.w, out.h], [0, out.h]] as Pt[]).every(([x, y]) => insideConvex(apply(m, x, y), poly));
  };
  if (fits(1)) return base;
  let lo = 1, hi = 1;
  while (!fits(hi)) { hi *= 2; if (hi > 1e4) return null; }
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return { ...base, zoom: hi };
}
