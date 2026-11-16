/**
 * Shared canvas drawing for the Preview and Align views and for GIF/video export.
 * `toCanvas(f)` always maps frame pixels → canvas pixels.
 */
import type { Affine } from '../core/geometry';

export interface Drawable {
  bitmap: ImageBitmap;
  /** downscaled copy used when the frame is shown smaller than it */
  preview?: ImageBitmap | null;
  width: number;
  height: number;
}

export type ToCanvas<T extends Drawable = Drawable> = (f: T) => Affine;

/** Draw a frame through matrix m, using its downscaled proxy when that is sharp enough. */
export function drawFrame(
  ctx: CanvasRenderingContext2D, f: Drawable, m: Affine, alpha = 1, op: GlobalCompositeOperation = 'source-over',
): void {
  ctx.setTransform(...m);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.imageSmoothingQuality = 'high';
  // canvas pixels per frame pixel (geometric mean of the axes)
  const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const p = f.preview;
  if (p && k * f.width <= p.width) ctx.drawImage(p, 0, 0, f.width, f.height);
  else ctx.drawImage(f.bitmap, 0, 0);
}

export function resetCtx(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Tilt simulation: frame at `pos` (0..n-1), optionally blended with the next one. */
export function drawTilt<T extends Drawable>(
  ctx: CanvasRenderingContext2D, ordered: T[], pos: number, smooth: boolean, toCanvas: ToCanvas<T>,
): void {
  if (!ordered.length) return;
  const i0 = Math.max(0, Math.min(ordered.length - 1, Math.floor(pos)));
  const i1 = Math.min(ordered.length - 1, i0 + 1);
  const t = smooth ? pos - i0 : 0;
  drawFrame(ctx, ordered[i0], toCanvas(ordered[i0]));
  if (t > 0.001) drawFrame(ctx, ordered[i1], toCanvas(ordered[i1]), t);
  resetCtx(ctx);
}

export type CompareMode = 'onion' | 'difference' | 'flicker' | 'frame' | 'anaglyph';

// reused scratch canvases for the two anaglyph eyes (allocated once, resized on demand)
const eyes = [document.createElement('canvas'), document.createElement('canvas')];

function eye(
  i: number, f: Drawable, m: Affine, color: string, w: number, h: number,
  clip?: { x: number; y: number; w: number; h: number }, background?: string,
): HTMLCanvasElement {
  const c = eyes[i];
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  const x = c.getContext('2d')!;
  resetCtx(x);
  x.clearRect(0, 0, w, h);
  if (background && clip) {
    x.fillStyle = background;
    x.fillRect(clip.x, clip.y, clip.w, clip.h);
  }
  drawFrame(x, f, m);
  resetCtx(x);
  x.globalCompositeOperation = 'multiply';
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  resetCtx(x);
  return c;
}

/**
 * Compare frame `b` with reference `a`:
 * onion (b over a at `opacity`), difference, flicker (a or b), frame (b only),
 * anaglyph (a in red, b in cyan).
 */
export function drawCompare<T extends Drawable>(
  ctx: CanvasRenderingContext2D, mode: CompareMode, a: T, b: T, toCanvas: ToCanvas<T>,
  o: { opacity?: number; flickerOn?: boolean; w: number; h: number; clip?: { x: number; y: number; w: number; h: number }; background?: string },
): void {
  if (mode === 'frame') drawFrame(ctx, b, toCanvas(b));
  else if (mode === 'flicker') { const f = o.flickerOn ? b : a; drawFrame(ctx, f, toCanvas(f)); }
  else if (mode === 'difference') { drawFrame(ctx, a, toCanvas(a)); drawFrame(ctx, b, toCanvas(b), 1, 'difference'); }
  else if (mode === 'anaglyph') {
    const left = eye(0, a, toCanvas(a), '#ff0000', o.w, o.h, o.clip, o.background);
    const right = eye(1, b, toCanvas(b), '#00ffff', o.w, o.h, o.clip, o.background);
    resetCtx(ctx);
    ctx.drawImage(left, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(right, 0, 0);
  } else { drawFrame(ctx, a, toCanvas(a)); drawFrame(ctx, b, toCanvas(b), o.opacity ?? 0.5); }
  resetCtx(ctx);
}
