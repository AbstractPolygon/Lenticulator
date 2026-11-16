import { mpoImageRanges } from '../core/mpo';

/** Image import helpers. */

/**
 * Split an MPO (multi-picture object, used by 3D cameras such as the
 * Fujifilm W1/W3 and Nintendo 3DS) into its individual JPEGs.
 * Returns [blob] unchanged for ordinary images.
 */
export async function splitMultiPicture(file: Blob): Promise<Blob[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return [file];
  // proper MPO: use the MP Index (handles padding between images, skips nothing it lists)
  const ranges = mpoImageRanges(buf);
  if (ranges) {
    const parts = ranges
      .map(([a, b]) => buf.subarray(a, b))
      .filter((part) => part.length > 20_000 && part[0] === 0xff && part[1] === 0xd8)
      .map((part) => new Blob([part as BlobPart], { type: 'image/jpeg' }));
    if (parts.length > 1) return parts;
  }
  // fallback: JPEGs concatenated directly (EOI immediately followed by SOI)
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

/** File extensions offered for import (decoding depends on the browser engine). */
export const IMAGE_EXT = /\.(jpe?g|jfif|png|webp|gif|bmp|avif|ico|svg|mpo|jps|heic|heif|tiff?|psd|psb)$/i;

export function isImageFile(f: File): boolean {
  if (f.name.startsWith('.')) return false; // macOS "._" resource forks, hidden files
  return f.type.startsWith('image/') || IMAGE_EXT.test(f.name);
}

/**
 * Collect image files from a drop, descending into dropped folders.
 * Must be called synchronously inside the drop handler (items expire after it).
 * Returned files are sorted by path, numerically ("frame2" before "frame10").
 */
export function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  type Entry = FileSystemEntry & { fullPath: string };
  const entries: Entry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.() as Entry | null;
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) loose.push(f);
    }
  }
  if (!entries.length && !loose.length) loose.push(...Array.from(dt.files));

  const out: { path: string; file: File }[] = loose.map((f) => ({ path: f.name, file: f }));
  const readFile = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));
  const readAll = async (dir: FileSystemDirectoryEntry) => {
    const reader = dir.createReader();
    const all: FileSystemEntry[] = [];
    // readEntries returns results in batches (≈100) until an empty batch
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      all.push(...batch);
    }
    return all;
  };
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.name.startsWith('.')) return;
    if (e.isFile) {
      const f = await readFile(e as FileSystemFileEntry);
      out.push({ path: e.fullPath || f.name, file: f });
    } else if (e.isDirectory) {
      for (const c of await readAll(e as FileSystemDirectoryEntry)) await walk(c);
    }
  };
  return Promise.all(entries.map(walk)).then(() =>
    out
      .filter((o) => isImageFile(o.file))
      .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
      .map((o) => o.file),
  );
}
