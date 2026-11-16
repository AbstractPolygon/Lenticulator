/** Image import helpers. */

/**
 * Split an MPO (multi-picture object, used by 3D cameras such as the
 * Fujifilm W1/W3 and Nintendo 3DS) into its individual JPEGs.
 * Returns [blob] unchanged for ordinary images.
 */
export async function splitMultiPicture(file: Blob): Promise<Blob[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return [file];
  const starts: number[] = [0];
  for (let i = 2; i < buf.length - 4; i++) {
    // a new JPEG begins right after an EOI marker
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i + 2] === 0xff && buf[i - 2] === 0xff && buf[i - 1] === 0xd9) {
      starts.push(i);
    }
  }
  if (starts.length < 2) return [file];
  const parts: Blob[] = [];
  for (let k = 0; k < starts.length; k++) {
    const part = buf.subarray(starts[k], k + 1 < starts.length ? starts[k + 1] : buf.length);
    // skip embedded thumbnails / tiny previews
    if (part.length > 20_000) parts.push(new Blob([part], { type: 'image/jpeg' }));
  }
  return parts.length ? parts : [file];
}

export async function decode(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    // Fallback for formats createImageBitmap can't decode directly
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export function thumbnail(bmp: ImageBitmap, max = 160): string {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * s));
  c.height = Math.max(1, Math.round(bmp.height * s));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}

/** Full-resolution RGBA pixels (capped so huge photos don't exhaust memory). */
export function pixels(bmp: ImageBitmap, maxDim = 8192): ImageData {
  const s = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
