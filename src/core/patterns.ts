/**
 * Calibration / test pattern generation (pure pixel work; text labels are
 * returned separately so the UI can draw them with a canvas).
 */
import { LensParams, Orientation, RGBAImage, lensWeights } from './interlace';

export interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  /** rotate text 90° (used for horizontal-lens patterns) */
  rotate?: boolean;
  align?: 'left' | 'center';
}

export interface Pattern {
  image: RGBAImage;
  labels: Label[];
}

function blank(w: number, h: number, v = 255): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  data.fill(v);
  return { width: w, height: h, data };
}

function fillRect(img: RGBAImage, x0: number, y0: number, w: number, h: number, rgb: [number, number, number]) {
  const x1 = Math.min(img.width, Math.round(x0 + w)), y1 = Math.min(img.height, Math.round(y0 + h));
  for (let y = Math.max(0, Math.round(y0)); y < y1; y++) {
    for (let x = Math.max(0, Math.round(x0)); x < x1; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
    }
  }
}

/**
 * Paint a two-tone lens pattern (first `dark` fraction of each lens black)
 * into a rectangle. `axisOrigin` is the page coordinate where lens phase 0
 * starts, so different regions stay in phase with each other.
 */
function paintLensBars(
  img: RGBAImage, x0: number, y0: number, w: number, h: number,
  orientation: Orientation, lpi: number, dpi: number, phase: number, axisOrigin = 0, dark = 0.5,
) {
  const vertical = orientation === 'vertical';
  const span = vertical ? w : h;
  const start = vertical ? x0 : y0;
  // Two "frames": black (fraction `dark`) and white. Using N=2 with dark=.5,
  // or approximate other fractions with N=round(1/dark).
  const N = Math.max(2, Math.round(1 / dark));
  const lw = lensWeights(span, {
    lpi, dpi, frames: N, phase: phase + (start - axisOrigin) * (lpi / dpi), reverse: false, sampling: 'blend',
  });
  for (let i = 0; i < span; i++) {
    let black = 0;
    for (let e = 0; e < lw.k; e++) if (lw.idx[i * lw.k + e] === 0) black += lw.weight[i * lw.k + e];
    const v = Math.round(255 * (1 - black));
    if (vertical) fillRect(img, x0 + i, y0, 1, h, [v, v, v]);
    else fillRect(img, x0, y0 + i, w, 1, [v, v, v]);
  }
}

export interface PitchTestOptions {
  dpi: number;
  lpi: number;
  /** ± range around lpi */
  range: number;
  step: number;
  widthPx: number;
  heightPx: number;
  orientation: Orientation;
}

/**
 * Pitch test: a stack of bands, each interlaced black/white at a slightly
 * different LPI. Viewed through the lens, the band whose pitch matches the
 * lens (at your viewing distance) flips evenly between solid black and
 * solid white; wrong pitches show moiré stripes.
 */
export function pitchTest(o: PitchTestOptions): Pattern {
  const W = Math.round(o.widthPx), H = Math.round(o.heightPx);
  const img = blank(W, H);
  const labels: Label[] = [];
  const count = Math.max(1, Math.round((2 * o.range) / o.step) + 1);
  const vertical = o.orientation === 'vertical';
  const across = vertical ? H : W; // bands stack along this axis
  const along = vertical ? W : H;
  const labelPx = Math.round(Math.min(along * 0.18, o.dpi * 1.1));
  const gap = Math.max(2, Math.round(o.dpi / 50));
  const band = (across - gap * (count + 1)) / count;
  const fontPx = Math.max(8, Math.min(band * 0.45, o.dpi * 0.16));
  for (let i = 0; i < count; i++) {
    const lpi = o.lpi - o.range + i * o.step;
    const a0 = gap + i * (band + gap);
    if (vertical) {
      paintLensBars(img, labelPx, a0, W - labelPx, band, o.orientation, lpi, o.dpi, 0, labelPx);
      labels.push({ text: `${lpi.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`, x: gap * 2, y: a0 + band / 2, size: fontPx });
    } else {
      paintLensBars(img, a0, labelPx, band, H - labelPx, o.orientation, lpi, o.dpi, 0, labelPx);
      labels.push({ text: `${lpi.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`, x: a0 + band / 2, y: gap * 2, size: fontPx, rotate: true });
    }
  }
  return { image: img, labels };
}

export interface RulerOptions {
  dpi: number;
  lpi: number;
  widthPx: number;
  heightPx: number;
  orientation: Orientation;
}

/**
 * Lens ruler: one thin line per lens with a long tick every 10 lenses,
 * plus an inch/cm scale. Print it and measure: 10 lenses should span
 * exactly 10/LPI inches. Also handy to check the printer isn't scaling.
 */
export function lensRuler(o: RulerOptions): Pattern {
  const W = Math.round(o.widthPx), H = Math.round(o.heightPx);
  const img = blank(W, H);
  const labels: Label[] = [];
  const vertical = o.orientation === 'vertical';
  const along = vertical ? W : H;
  const across = vertical ? H : W;
  const px = (v: number) => Math.max(1, Math.round(v));
  const line = (pos: number, from: number, len: number, thick: number) =>
    vertical ? fillRect(img, pos, from, thick, len, [0, 0, 0]) : fillRect(img, from, pos, len, thick, [0, 0, 0]);

  const fontPx = Math.max(10, o.dpi * 0.12);
  // inch scale
  const inchY = across * 0.06;
  for (let i = 0; i * (o.dpi / 8) < along; i++) {
    const pos = i * (o.dpi / 8);
    const len = i % 8 === 0 ? across * 0.08 : i % 4 === 0 ? across * 0.05 : across * 0.03;
    line(pos, inchY, len, px(o.dpi / 300));
    if (i % 8 === 0) labels.push(lab(`${i / 8} in`, pos, inchY + across * 0.1));
  }
  // cm scale
  const cmY = across * 0.28;
  const pxPerMm = o.dpi / 25.4;
  for (let i = 0; i * pxPerMm < along; i++) {
    const pos = i * pxPerMm;
    const len = i % 10 === 0 ? across * 0.08 : i % 5 === 0 ? across * 0.05 : across * 0.03;
    line(pos, cmY, len, px(o.dpi / 300));
    if (i % 10 === 0) labels.push(lab(`${i / 10} cm`, pos, cmY + across * 0.1));
  }
  // lens lines
  const lensY = across * 0.5;
  const ppl = o.dpi / o.lpi;
  for (let i = 0; i * ppl < along; i++) {
    const pos = i * ppl;
    const long = i % 10 === 0;
    line(pos, lensY, long ? across * 0.4 : across * 0.25, px(ppl / 4));
    if (long && i % 50 === 0) labels.push(lab(`${i}`, pos, lensY - fontPx));
  }
  labels.push({
    text: `${o.lpi} LPI @ ${o.dpi} DPI — ${ppl.toFixed(3)} px/lens — 10 lenses = ${(10 / o.lpi).toFixed(4)} in / ${(254 / o.lpi).toFixed(3)} mm`,
    x: vertical ? fontPx : across - fontPx * 1.2,
    y: vertical ? across - fontPx * 1.2 : fontPx,
    size: fontPx,
    rotate: !vertical,
    align: 'left',
  });
  return { image: img, labels };

  function lab(text: string, pos: number, a: number): Label {
    return vertical
      ? { text, x: pos + 4, y: a, size: fontPx, align: 'left' }
      : { text, x: a, y: pos + 4, size: fontPx, rotate: true, align: 'left' };
  }
}

/** Distinct colours for the frame-order test. */
export function frameColor(i: number, n: number): [number, number, number] {
  const h = (i / Math.max(1, n)) * 360;
  return hslToRgb(h, 0.75, 0.5);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---------------------------------------------------------------------------
// Page composition: margins, lens alignment bars, crop marks
// ---------------------------------------------------------------------------

export interface PageOptions {
  /** white margin around the image, px */
  margin: number;
  /** draw lens alignment bars in the margin (needs margin > 0) */
  alignBars: boolean;
  cropMarks: boolean;
  orientation: Orientation;
  lens: Pick<LensParams, 'lpi' | 'dpi' | 'phase'>;
}

export function composePage(img: RGBAImage, o: PageOptions): RGBAImage {
  const m = Math.max(0, Math.round(o.margin));
  if (m === 0) return img;
  const W = img.width + 2 * m, H = img.height + 2 * m;
  const page = blank(W, H);
  for (let y = 0; y < img.height; y++) {
    page.data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + m) * W + m) * 4);
  }
  if (o.alignBars) {
    const bar = Math.round(m * 0.45);
    const off = Math.round(m * 0.2);
    // bars run along the interlace axis, in phase with the image (axis origin = m)
    if (o.orientation === 'vertical') {
      paintLensBars(page, m, m - off - bar, img.width, bar, 'vertical', o.lens.lpi, o.lens.dpi, o.lens.phase, m);
      paintLensBars(page, m, m + img.height + off, img.width, bar, 'vertical', o.lens.lpi, o.lens.dpi, o.lens.phase, m);
    } else {
      paintLensBars(page, m - off - bar, m, bar, img.height, 'horizontal', o.lens.lpi, o.lens.dpi, o.lens.phase, m);
      paintLensBars(page, m + img.width + off, m, bar, img.height, 'horizontal', o.lens.lpi, o.lens.dpi, o.lens.phase, m);
    }
  }
  if (o.cropMarks) {
    const len = Math.round(m * 0.6);
    const t = Math.max(1, Math.round(o.lens.dpi / 300));
    const gap = Math.round(m * 0.1);
    const corners: [number, number][] = [[m, m], [m + img.width, m], [m, m + img.height], [m + img.width, m + img.height]];
    for (const [cx, cy] of corners) {
      const sx = cx === m ? -1 : 1, sy = cy === m ? -1 : 1;
      // horizontal tick
      fillRect(page, sx < 0 ? cx - gap - len : cx + gap, cy - (t >> 1), len, t, [0, 0, 0]);
      // vertical tick
      fillRect(page, cx - (t >> 1), sy < 0 ? cy - gap - len : cy + gap, t, len, [0, 0, 0]);
    }
  }
  return page;
}
