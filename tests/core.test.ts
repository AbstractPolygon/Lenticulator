import { describe, expect, it } from 'vitest';
import { fft2d } from '../src/core/fft';
import { Gray, makeGray, sample } from '../src/core/gray';
import { alignFrame, matchPoint, phaseCorrelate, similarityToParams } from '../src/core/align';
import { lensWeights, renderRows, lensStats } from '../src/core/interlace';
import { apply, cropToCommon, frameMatrix, invert, mul, NO_TRANSFORM } from '../src/core/geometry';
import { crc32, encodeTiff, getPngDpi, setJpegDpi, setPngDpi, zipStore } from '../src/core/fileformats';

/** Read the DPI from a JPEG's JFIF header (or null). */
function getJpegDpi(jpg: Uint8Array): number | null {
  if (jpg[2] !== 0xff || jpg[3] !== 0xe0 || jpg[13] !== 1) return null;
  return (jpg[14] << 8) | jpg[15];
}
import { composePage, pitchTest } from '../src/core/patterns';
import { mpoImageRanges } from '../src/core/mpo';

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

describe('mpo', () => {
  /** Build a minimal 2-image MPO: JPEG#1 (SOI, APP2 MPF, EOI) + padding + JPEG#2. */
  function makeMpo(pad: number) {
    const img2 = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 1, 2, 0xff, 0xd9];
    // APP2 payload: "MPF\0" + little-endian TIFF header + IFD(2 entries) + 2 MP entries
    const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0];
    const entriesRel = 8 + 2 + 2 * 12 + 4;
    const le32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    const ifd = [2, 0, 0x01, 0xb0, 4, 0, 1, 0, 0, 0, ...le32(2), 0x02, 0xb0, 7, 0, 32, 0, 0, 0, ...le32(entriesRel), 0, 0, 0, 0];
    const app2Len = 2 + 4 + tiff.length + ifd.length + 32;
    const head = [0xff, 0xd8, 0xff, 0xe2, app2Len >> 8, app2Len & 255, 0x4d, 0x50, 0x46, 0];
    const tiffStart = head.length;
    const img1Len = head.length + tiff.length + ifd.length + 32 + 2;
    const img2Start = img1Len + pad;
    const entries = [...le32(0), ...le32(img1Len), ...le32(0), 0, 0, 0, 0,
      ...le32(0), ...le32(img2.length), ...le32(img2Start - tiffStart), 0, 0, 0, 0];
    return Uint8Array.from([...head, ...tiff, ...ifd, ...entries, 0xff, 0xd9, ...new Array(pad).fill(0), ...img2]);
  }

  it('finds both images via the MP index, even with padding between them', () => {
    const buf = makeMpo(37);
    const r = mpoImageRanges(buf)!;
    expect(r).toHaveLength(2);
    expect(r[0][0]).toBe(0);
    expect(Array.from(buf.subarray(r[1][0], r[1][0] + 2))).toEqual([0xff, 0xd8]);
    expect(r[1][1]).toBe(buf.length);
  });

  it('returns null for a plain JPEG', () => {
    expect(mpoImageRanges(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda]))).toBeNull();
  });
});

describe('jpeg dpi & zip', () => {
  it('sets JFIF density', () => {
    const jfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
    expect(getJpegDpi(setJpegDpi(jfif, 720))).toBe(720);
    const bare = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 2, 0xff, 0xd9]);
    const tagged = setJpegDpi(bare, 300);
    expect(getJpegDpi(tagged)).toBe(300);
    expect(tagged.length).toBe(bare.length + 18);
  });

  it('writes a valid single-file zip', () => {
    const data = new TextEncoder().encode('hello lens');
    const z = zipStore('a.tif', data);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(14, true)).toBe(crc32(data));
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
  });
});

import { framesForLens, modelInputSize, normalizeDepth, synthesizeViews } from '../src/core/depth3d';

describe('depth → views', () => {
  // 40×10 image: background columns coloured by x; a near "box" (disparity 1) in the middle
  const W = 40, H = 10;
  const img = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const depth = makeGray(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const box = x >= 15 && x < 25;
      img.data[i] = box ? 255 : x * 5; img.data[i + 1] = 0; img.data[i + 2] = box ? 0 : 200; img.data[i + 3] = 255;
      depth.data[y * W + x] = box ? 1 : 0;
    }

  it('keeps the focus plane fixed and shifts near content between views', () => {
    const views = synthesizeViews(img, depth, { views: 3, amount: 8, focus: 0 });
    expect(views).toHaveLength(3);
    const redAt = (v: number) => Array.from({ length: W }, (_, x) => views[v].data[(5 * W + x) * 4] === 255 && views[v].data[(5 * W + x) * 4 + 2] === 0)
      .map((b, x) => (b ? x : -1)).filter((x) => x >= 0);
    // middle view: box in place; first/last views: box moved left/right by amount/2
    expect(redAt(1)[0]).toBe(15);
    expect(redAt(0)[0]).toBe(11);
    expect(redAt(2)[0]).toBe(19);
    // background (focus plane) unchanged at the far left
    expect(views[0].data[(5 * W + 2) * 4]).toBe(10);
    // no unfilled (transparent) pixels left behind
    for (const v of views) for (let i = 3; i < v.data.length; i += 4) expect(v.data[i]).toBe(255);
  });

  it('frames follow the lens', () => {
    expect(framesForLens(60, 600)).toBe(10);
    expect(framesForLens(100, 300)).toBe(3);
    expect(framesForLens(10, 2400)).toBe(48);
  });

  it('model input is patch aligned and depth is normalised', () => {
    expect(modelInputSize(4000, 3000)).toEqual({ w: 518, h: 392 });
    const g = normalizeDepth(Float32Array.from([0, 5, 10, 100]), 2, 2);
    expect(Math.max(...g.data)).toBeLessThanOrEqual(1);
    expect(Math.min(...g.data)).toBeGreaterThanOrEqual(0);
  });
});

import { bandSourceRect, isOpaque } from '../src/core/interlace';
import { compose as composeM, translate as translateM } from '../src/core/geometry';

describe('banded rendering', () => {
  // a frame with structure (and a semi-transparent variant) under a rotated, scaled mapping
  const FW = 120, FH = 90;
  const mk = (alpha: (i: number) => number) => {
    const d = new Uint8ClampedArray(FW * FH * 4);
    for (let i = 0; i < FW * FH; i++) { d[i * 4] = (i * 37) & 255; d[i * 4 + 1] = (i * 11) & 255; d[i * 4 + 2] = (i >> 3) & 255; d[i * 4 + 3] = alpha(i); }
    return d;
  };
  const W = 150, H = 100;
  const lens = { lpi: 60, dpi: 600, frames: 2, phase: 0.2, reverse: false, sampling: 'blend' as const };
  const m = frameMatrix({ w: W, h: H }, { w: FW, h: FH }, { w: FW, h: FH }, { dx: 2.5, dy: -1, rotation: 3, scale: 1.05 }, { fit: 'contain', zoom: 0.9, panX: 0.02, panY: 0 });

  for (const [label, data] of [['opaque', mk(() => 255)], ['transparent', mk((i) => (i * 7) & 255)]] as const) {
    it(`band crops reproduce the full render exactly (${label})`, () => {
      const full = new Uint8ClampedArray(W * H * 4);
      const frames = [{ width: FW, height: FH, data }, { width: FW, height: FH, data }];
      renderRows({ width: W, height: H, orientation: 'vertical', lens, frames, matrices: [m, m], background: [10, 20, 30] }, 0, H, full);
      const banded = new Uint8ClampedArray(W * H * 4);
      for (const [y0, y1] of [[0, 33], [33, 67], [67, 100]]) {
        const r = bandSourceRect(m, W, y0, y1, FW, FH);
        const crop = new Uint8ClampedArray(r.w * r.h * 4);
        for (let y = 0; y < r.h; y++) crop.set(data.subarray(((r.y + y) * FW + r.x) * 4, ((r.y + y) * FW + r.x + r.w) * 4), y * r.w * 4);
        const cm = composeM(translateM(-r.x, -r.y), m);
        const f = { width: r.w, height: r.h, data: crop, opaque: isOpaque(crop) };
        const out = banded.subarray(y0 * W * 4, y1 * W * 4);
        renderRows({ width: W, height: H, orientation: 'vertical', lens, frames: [f, f], matrices: [cm, cm], background: [10, 20, 30] }, y0, y1, out);
      }
      expect(banded).toEqual(full);
    });
  }

  it('detects opaque pixels', () => {
    expect(isOpaque(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(true);
    expect(isOpaque(Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(false);
  });
});

describe('cropToCommon', () => {
  const ref = { w: 1000, h: 800 };
  const out = { w: 6, h: 4 };
  it('leaves identical frames uncropped', () => {
    const f = cropToCommon(out, ref, [{ size: ref, t: NO_TRANSFORM }, { size: ref, t: NO_TRANSFORM }])!;
    expect(f.zoom).toBeCloseTo(1, 6);
    expect(f.panX).toBeCloseTo(0, 6);
  });
  it('crops away the strip a shifted frame leaves empty', () => {
    const shifted = { ...NO_TRANSFORM, dx: 100 };
    const f = cropToCommon(out, ref, [{ size: ref, t: NO_TRANSFORM }, { size: ref, t: shifted }])!;
    expect(f.zoom).toBeGreaterThan(1);
    // every corner of the print lands inside both frames
    for (const t of [NO_TRANSFORM, shifted]) {
      const m = frameMatrix(out, ref, ref, t, f);
      for (const [x, y] of [[0, 0], [out.w, 0], [out.w, out.h], [0, out.h]]) {
        const [fx, fy] = apply(m, x, y);
        expect(fx).toBeGreaterThanOrEqual(-1e-3); expect(fx).toBeLessThanOrEqual(ref.w + 1e-3);
        expect(fy).toBeGreaterThanOrEqual(-1e-3); expect(fy).toBeLessThanOrEqual(ref.h + 1e-3);
      }
    }
  });
  it('handles rotated frames', () => {
    const f = cropToCommon(out, ref, [{ size: ref, t: NO_TRANSFORM }, { size: ref, t: { ...NO_TRANSFORM, rotation: 3 } }])!;
    expect(f.zoom).toBeGreaterThan(1);
    expect(f.zoom).toBeLessThan(1.3);
  });
});
