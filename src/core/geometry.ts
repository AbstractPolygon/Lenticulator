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
