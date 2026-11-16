import { describe, expect, it } from 'vitest';
import { fft2d } from '../src/core/fft';
import { Gray, makeGray, sample } from '../src/core/gray';
import { alignFrame, matchPoint, phaseCorrelate, similarityToParams } from '../src/core/align';
import { lensWeights, renderRows, lensStats } from '../src/core/interlace';
import { apply, frameMatrix, invert, mul, NO_TRANSFORM } from '../src/core/geometry';
import { crc32, encodeTiff, getPngDpi, setPngDpi } from '../src/core/fileformats';
import { composePage, pitchTest } from '../src/core/patterns';

/** Deterministic textured test image (sum of blobs + sinusoids). */
function texture(w: number, h: number, seed = 1): Gray {
  const g = makeGray(w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 40 }, () => [rnd() * w, rnd() * h, 4 + rnd() * 20, rnd()]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0.3 + 0.1 * Math.sin(x / 7) * Math.cos(y / 11);
      for (const [bx, by, r, a] of blobs) v += a * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * r * r));
      g.data[y * w + x] = v;
    }
  return g;
}

/** mov(A(p)) = ref(p)  ⇔  mov(q) = ref(A⁻¹(q)) */
function warp(ref: Gray, tx: number, ty: number, rotDeg = 0, sc = 1): Gray {
  const out = makeGray(ref.w, ref.h);
  const cx = (ref.w - 1) / 2, cy = (ref.h - 1) / 2;
  const th = (rotDeg * Math.PI) / 180;
  const c = Math.cos(th) * sc, s = Math.sin(th) * sc;
  const det = c * c + s * s;
  for (let y = 0; y < ref.h; y++)
    for (let x = 0; x < ref.w; x++) {
      const qx = x - cx - tx, qy = y - cy - ty;
      // inverse of [[c,-s],[s,c]]
      const px = (c * qx + s * qy) / det, py = (-s * qx + c * qy) / det;
      out.data[y * ref.w + x] = sample(ref, px + cx, py + cy);
    }
  return out;
}

describe('fft', () => {
  it('round-trips', () => {
    const re = new Float64Array(64).map((_, i) => Math.sin(i));
    const im = new Float64Array(64);
    const orig = re.slice();
    fft2d(re, im, 8, 8);
    fft2d(re, im, 8, 8, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(orig[i], 9));
  });
});

describe('alignment', () => {
  const ref = texture(200, 150);

  it('phase correlation finds integer shifts', () => {
    const mov = warp(ref, 12, -7);
    const r = phaseCorrelate(ref, mov);
    expect(r.dx).toBeCloseTo(12, 0);
    expect(r.dy).toBeCloseTo(-7, 0);
  });

  it('refines sub-pixel translation', () => {
    const mov = warp(ref, 5.3, 3.6);
    const r = alignFrame(ref, mov, { mode: 'translation' });
    expect(r.tx).toBeCloseTo(5.3, 1);
    expect(r.ty).toBeCloseTo(3.6, 1);
    expect(r.confidence).toBeGreaterThan(0.8);
  });

  it('recovers rotation and scale', () => {
    const big = texture(400, 300, 7);
    const mov = warp(big, -4, 6, 2.5, 1.03);
    const r = similarityToParams(alignFrame(big, mov, { mode: 'similarity' }));
    expect(r.rotation).toBeCloseTo(2.5, 1);
    expect(r.scale).toBeCloseTo(1.03, 2);
    expect(r.dx).toBeCloseTo(-4, 0);
    expect(r.dy).toBeCloseTo(6, 0);
  });

  it('matches a key point', () => {
    const mov = warp(ref, 9, -4);
    const m = matchPoint(ref, mov, 100, 75, 16, 30);
    expect(m.dx).toBeCloseTo(9, 0);
    expect(m.dy).toBeCloseTo(-4, 0);
  });
});

describe('lens weights', () => {
  it('sums to 1 for every pixel and covers frames evenly', () => {
    const N = 6;
    const lw = lensWeights(6000, { lpi: 60, dpi: 720, frames: N, phase: 0.13, reverse: false, sampling: 'blend' });
    const per = new Float64Array(N);
    for (let i = 0; i < 6000; i++) {
      let s = 0;
      for (let e = 0; e < lw.k; e++) {
        const j = lw.idx[i * lw.k + e];
        if (j < 0) continue;
        s += lw.weight[i * lw.k + e];
        per[j] += lw.weight[i * lw.k + e];
      }
      expect(s).toBeCloseTo(1, 5);
    }
    per.forEach((v) => expect(v / 6000).toBeCloseTo(1 / N, 2));
  });

  it('assigns whole pixels when dpi/lpi is an integer multiple of frames', () => {
    // 12 px per lens, 4 frames → 3 px per strip
    const lw = lensWeights(24, { lpi: 50, dpi: 600, frames: 4, phase: 0, reverse: false, sampling: 'blend' });
    const seq = Array.from({ length: 24 }, (_, i) => lw.idx[i * lw.k]);
    expect(seq).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    const rev = lensWeights(6, { lpi: 50, dpi: 600, frames: 4, phase: 0, reverse: true, sampling: 'nearest' });
    expect(Array.from(rev.idx)).toEqual([3, 3, 3, 2, 2, 2]);
  });

  it('stats', () => {
    expect(lensStats(60, 720, 6)).toMatchObject({ pixelsPerLens: 12, pixelsPerFrameStrip: 2, maxUsefulFrames: 12 });
  });
});

describe('interlace render', () => {
  it('interleaves solid frames', () => {
    const solid = (v: number) => ({ width: 4, height: 4, data: new Uint8ClampedArray(64).map((_, i) => (i % 4 === 3 ? 255 : v)) });
    const W = 8, H = 2;
    const job = {
      width: W, height: H, orientation: 'vertical' as const,
      lens: { lpi: 100, dpi: 400, frames: 2, phase: 0, reverse: false, sampling: 'nearest' as const },
      frames: [solid(0), solid(255)],
      matrices: [0, 1].map(() => frameMatrix({ w: W, h: H }, { w: 4, h: 4 }, { w: 4, h: 4 }, NO_TRANSFORM, { fit: 'cover', zoom: 1, panX: 0, panY: 0 })),
      background: [255, 255, 255] as [number, number, number],
    };
    const out = new Uint8ClampedArray(W * H * 4);
    renderRows(job, 0, H, out);
    const row = Array.from({ length: W }, (_, x) => out[x * 4]);
    expect(row).toEqual([0, 0, 255, 255, 0, 0, 255, 255]);
  });
});

describe('geometry', () => {
  it('inverts', () => {
    const m = frameMatrix({ w: 300, h: 200 }, { w: 120, h: 90 }, { w: 240, h: 180 }, { dx: 3, dy: -2, rotation: 5, scale: 1.1 }, { fit: 'cover', zoom: 1.2, panX: 0.1, panY: 0 });
    const id = mul(m, invert(m));
    const [x, y] = apply(id, 17, 42);
    expect(x).toBeCloseTo(17, 9);
    expect(y).toBeCloseTo(42, 9);
  });
});

describe('file formats', () => {
  it('crc32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('tags PNG DPI', () => {
    // minimal 1x1 PNG
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const png = Uint8Array.from(Buffer.from(b64, 'base64'));
    const tagged = setPngDpi(png, 720);
    expect(getPngDpi(tagged)).toBeCloseTo(720, 0);
    expect(getPngDpi(setPngDpi(tagged, 300))).toBeCloseTo(300, 0);
  });

  it('writes a TIFF header', () => {
    const t = encodeTiff(new Uint8ClampedArray(16).fill(200), 2, 2, 600);
    expect(t[0]).toBe(0x49);
    expect(new DataView(t.buffer).getUint16(2, true)).toBe(42);
    expect(t.length).toBeGreaterThan(12);
  });
});

describe('patterns', () => {
  it('pitch test produces labelled bands', () => {
    const p = pitchTest({ dpi: 300, lpi: 60, range: 1, step: 0.5, widthPx: 600, heightPx: 400, orientation: 'vertical' });
    expect(p.labels.map((l) => l.text)).toEqual(['59', '59.5', '60', '60.5', '61']);
    expect(p.image.width).toBe(600);
  });

  it('page adds margins', () => {
    const img = { width: 10, height: 10, data: new Uint8ClampedArray(400) };
    const page = composePage(img, { margin: 20, alignBars: true, cropMarks: true, orientation: 'vertical', lens: { lpi: 60, dpi: 300, phase: 0 } });
    expect(page.width).toBe(50);
    expect(page.height).toBe(50);
  });
});
