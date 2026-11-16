/**
 * Motion between two frames (block matching, coarse to fine) and motion-compensated in-between frames,
 * for smoother wigglegrams and animations.
 */
import { Gray, downsample2 } from './gray';

/** Motion of each block from frame A to frame B, in pixels of the images it was measured on. */
export interface Flow {
  /** blocks across / down */
  bw: number;
  bh: number;
  /** block size in pixels */
  block: number;
  dx: Float32Array;
  dy: Float32Array;
}

function sad(a: Gray, b: Gray, x0: number, y0: number, size: number, u: number, v: number): number {
  let s = 0;
  const xe = Math.min(a.w, x0 + size), ye = Math.min(a.h, y0 + size);
  for (let y = y0; y < ye; y++) {
    const yb = Math.min(b.h - 1, Math.max(0, y + v));
    for (let x = x0; x < xe; x++) {
      const xb = Math.min(b.w - 1, Math.max(0, x + u));
      s += Math.abs(a.data[y * a.w + x] - b.data[yb * b.w + xb]);
    }
  }
  return s;
}

function median3(f: Float32Array, bw: number, bh: number): Float32Array {
  const out = new Float32Array(f.length), win: number[] = [];
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    win.length = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const xx = x + i, yy = y + j;
      if (xx >= 0 && yy >= 0 && xx < bw && yy < bh) win.push(f[yy * bw + xx]);
    }
    win.sort((p, q) => p - q);
    out[y * bw + x] = win[win.length >> 1];
  }
  return out;
}

/** Block-matching flow from A to B (same size), refined over an image pyramid. */
export function estimateFlow(a: Gray, b: Gray, block = 8, radius = 3): Flow {
  const pa: Gray[] = [a], pb: Gray[] = [b];
  while (Math.min(pa[pa.length - 1].w, pa[pa.length - 1].h) > block * 6 && pa.length < 6) {
    pa.push(downsample2(pa[pa.length - 1])); pb.push(downsample2(pb[pb.length - 1]));
  }
  let flow: Flow | null = null;
  for (let l = pa.length - 1; l >= 0; l--) {
    const A = pa[l], B = pb[l];
    const bw = Math.ceil(A.w / block), bh = Math.ceil(A.h / block);
    const dx = new Float32Array(bw * bh), dy = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      // start from the coarser level's estimate (doubled)
      let u0 = 0, v0 = 0;
      if (flow) {
        const cx = Math.min(flow.bw - 1, bx >> 1), cy = Math.min(flow.bh - 1, by >> 1);
        u0 = Math.round(flow.dx[cy * flow.bw + cx] * 2); v0 = Math.round(flow.dy[cy * flow.bw + cx] * 2);
      }
      let best = Infinity, bu = u0, bv = v0;
      for (let v = v0 - radius; v <= v0 + radius; v++) for (let u = u0 - radius; u <= u0 + radius; u++) {
        // tiny bias towards small motion keeps flat areas still
        const s = sad(A, B, bx * block, by * block, block, u, v) * (1 + 0.002 * (Math.abs(u - u0) + Math.abs(v - v0)));
        if (s < best) { best = s; bu = u; bv = v; }
      }
      dx[by * bw + bx] = bu; dy[by * bw + bx] = bv;
    }
    flow = { bw, bh, block, dx: median3(dx, bw, bh), dy: median3(dy, bw, bh) };
  }
  return flow!;
}

/** Flow at a pixel (bilinear between block centres), scaled from the measured size to `scale`× pixels. */
function flowAt(f: Flow, x: number, y: number, scale: number): [number, number] {
  const gx = Math.min(f.bw - 1, Math.max(0, x / scale / f.block - 0.5));
  const gy = Math.min(f.bh - 1, Math.max(0, y / scale / f.block - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(f.bw - 1, x0 + 1), y1 = Math.min(f.bh - 1, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const lerp = (arr: Float32Array) => {
    const a = arr[y0 * f.bw + x0], b = arr[y0 * f.bw + x1], c = arr[y1 * f.bw + x0], d = arr[y1 * f.bw + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
  return [lerp(f.dx) * scale, lerp(f.dy) * scale];
}

/**
 * The frame at time t (0 = A, 1 = B): each pixel is taken from A moved back by t of the motion and from B moved
 * forward by the rest, then blended. `scale` = full-resolution pixels per flow pixel.
 */
export function interpolate(
  A: Uint8ClampedArray, B: Uint8ClampedArray, w: number, h: number, f: Flow, scale: number, t: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const px = (img: Uint8ClampedArray, x: number, y: number, c: number) => {
    x = Math.min(w - 1, Math.max(0, x)); y = Math.min(h - 1, Math.max(0, y));
    const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = x - x0, ty = y - y0;
    const a = img[(y0 * w + x0) * 4 + c], b = img[(y0 * w + x1) * 4 + c];
    const cc = img[(y1 * w + x0) * 4 + c], d = img[(y1 * w + x1) * 4 + c];
    return (a + (b - a) * tx) * (1 - ty) + (cc + (d - cc) * tx) * ty;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [u, v] = flowAt(f, x, y, scale);
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      out[o + c] = (1 - t) * px(A, x - t * u, y - t * v, c) + t * px(B, x + (1 - t) * u, y + (1 - t) * v, c);
    }
    out[o + 3] = 255;
  }
  return out;
}
