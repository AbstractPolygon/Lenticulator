/** Small canvas helpers shared by import, rendering, depth and export code. */

export function canvas2d(w: number, h: number, readback = false) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', readback ? { willReadFrequently: true } : undefined)!;
  return { c, ctx };
}

/**
 * Pixels of an image, optionally a source rectangle and/or resized.
 * Integer source rectangles at 1:1 copy pixels exactly.
 */
export function imagePixels(
  src: CanvasImageSource, w: number, h: number,
  rect?: { x: number; y: number; w: number; h: number },
): ImageData {
  const { ctx } = canvas2d(w, h, true);
  ctx.imageSmoothingQuality = 'high';
  if (rect) ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
  else ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

export async function encodeCanvas(c: HTMLCanvasElement, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, quality));
  if (!blob) throw new Error(`${type === 'image/png' ? 'PNG' : 'JPEG'} encoding failed (the image may be too large for this browser)`);
  return blob;
}

export async function encodeBitmap(bmp: ImageBitmap, type: 'image/png' | 'image/jpeg', quality?: number): Promise<Blob> {
  const { c, ctx } = canvas2d(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  return encodeCanvas(c, type, quality);
}

export function rgbaToBitmap(data: Uint8ClampedArray, width: number, height: number): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height));
}

/** Downscaled copy (long side ≤ max) for fast on-screen drawing, or null if the image is already small. */
export async function proxyBitmap(bmp: ImageBitmap, max = 2048): Promise<ImageBitmap | null> {
  const s = max / Math.max(bmp.width, bmp.height);
  if (s >= 1) return null;
  return createImageBitmap(bmp, {
    resizeWidth: Math.max(1, Math.round(bmp.width * s)),
    resizeHeight: Math.max(1, Math.round(bmp.height * s)),
    resizeQuality: 'high',
  });
}
