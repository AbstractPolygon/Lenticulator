/**
 * Decoders for formats browsers (Chromium/Electron) can't open natively:
 * HEIC/HEIF (libheif, WebAssembly), TIFF (UTIF) and Photoshop PSD (ag-psd).
 * Each library is loaded on first use only, so the app stays small.
 */

export type SpecialKind = 'heic' | 'tiff' | 'psd';

export interface RawImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  name?: string;
}

export interface DecodeOptions {
  /** PSD: one frame per pixel layer instead of the flattened image */
  psdLayers: boolean;
  /** TIFF: import every page as a frame (otherwise the first page only) */
  tiffAllPages: boolean;
}

/** Identify a special format from its first bytes (falls back to the extension). */
export function sniff(head: Uint8Array, name = ''): SpecialKind | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...head.subarray(a, b));
  if (ascii(0, 4) === '8BPS') return 'psd';
  if ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) ||
      (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42)) return 'tiff';
  if (ascii(4, 8) === 'ftyp') {
    const brands = [ascii(8, 12)];
    for (let i = 16; i + 4 <= Math.min(head.length, 64); i += 4) brands.push(ascii(i, i + 4));
    // AVIF is decoded natively; only route HEVC-based HEIF here
    if (brands.includes('avif') || brands.includes('avis')) return null;
    if (brands.some((b) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(b))) return 'heic';
  }
  if (/\.(heic|heif)$/i.test(name)) return 'heic';
  if (/\.tiff?$/i.test(name)) return 'tiff';
  if (/\.(psd|psb)$/i.test(name)) return 'psd';
  return null;
}

export async function sniffBlob(blob: Blob, name = ''): Promise<SpecialKind | null> {
  return sniff(new Uint8Array(await blob.slice(0, 64).arrayBuffer()), name);
}

export async function decodeSpecial(blob: Blob, kind: SpecialKind, opts: DecodeOptions): Promise<RawImage[]> {
  const buf = await blob.arrayBuffer();
  if (kind === 'tiff') return decodeTiff(buf, opts.tiffAllPages);
  if (kind === 'psd') return decodePsd(buf, opts.psdLayers);
  return decodeHeic(buf);
}

// ---------------------------------------------------------------------------

async function decodeTiff(buf: ArrayBuffer, allPages: boolean): Promise<RawImage[]> {
  const mod = await import('utif2');
  const UTIF = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const ifds = UTIF.decode(buf);
  // skip thumbnails / reduced-resolution sub-images (NewSubfileType bit 0)
  const pages = ifds.filter((ifd) => {
    const t = (ifd as Record<string, unknown>).t254 as number[] | undefined;
    return !(t && t[0] & 1);
  });
  const out: RawImage[] = [];
  for (const ifd of allPages ? pages : pages.slice(0, 1)) {
    UTIF.decodeImage(buf, ifd);
    const w = ifd.width as number, h = ifd.height as number;
    if (!w || !h) continue;
    const rgba = UTIF.toRGBA8(ifd);
    out.push({ width: w, height: h, data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, w * h * 4) });
  }
  if (!out.length) throw new Error('No readable image in this TIFF');
  return out.map((im, i) => (out.length > 1 ? { ...im, name: `page ${i + 1}` } : im));
}

// ---------------------------------------------------------------------------

interface PsdPixels { width: number; height: number; data: Uint8ClampedArray | Uint8Array | Uint16Array | Float32Array }
interface PsdLayer {
  name?: string;
  hidden?: boolean;
  opacity?: number;
  left?: number;
  top?: number;
  imageData?: PsdPixels;
  children?: PsdLayer[];
}

function to8bit(p: PsdPixels): Uint8ClampedArray {
  if (p.data instanceof Uint8ClampedArray) return p.data;
  if (p.data instanceof Uint8Array) return new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.data.length);
  const out = new Uint8ClampedArray(p.data.length);
  const k = p.data instanceof Uint16Array ? 255 / 65535 : 255;
  for (let i = 0; i < out.length; i++) out[i] = p.data[i] * k;
  return out;
}

async function decodePsd(buf: ArrayBuffer, layers: boolean): Promise<RawImage[]> {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(buf, {
    useImageData: true,
    skipThumbnail: true,
    skipLayerImageData: false, // layer pixels are needed for layer frames, or when there is no composite
    skipLinkedFilesData: true,
  }) as unknown as PsdLayer & { width: number; height: number };
  const W = psd.width, H = psd.height;

  // leaf pixel layers, bottom → top (Photoshop's "frames from layers" order)
  const leaves: { layer: PsdLayer; visible: boolean }[] = [];
  const walk = (list: PsdLayer[] | undefined, parentVisible: boolean) => {
    for (const l of list ?? []) {
      const vis = parentVisible && !l.hidden;
      if (l.children) walk(l.children, vis);
      else if (l.imageData && l.imageData.width && l.imageData.height) leaves.push({ layer: l, visible: vis });
    }
  };
  walk(psd.children, true);

  const place = (targets: PsdLayer[]): RawImage => {
    const data = new Uint8ClampedArray(W * H * 4);
    for (const l of targets) composite(data, W, H, l);
    return { width: W, height: H, data };
  };

  if (layers && leaves.length > 1) {
    return leaves.map(({ layer }, i) => ({ ...place([layer]), name: layer.name || `layer ${i + 1}` }));
  }
  if (psd.imageData) return [{ width: W, height: H, data: to8bit(psd.imageData) }];
  // no stored composite ("Maximize compatibility" off): flatten visible layers ourselves
  const visible = leaves.filter((l) => l.visible).map((l) => l.layer);
  if (!visible.length) throw new Error('This PSD has no flattened image or visible pixel layers');
  return [place(visible)];
}

/** Normal-mode "source over" of one layer onto an RGBA canvas. */
function composite(dst: Uint8ClampedArray, W: number, H: number, l: PsdLayer) {
  const src = l.imageData!;
  const d = to8bit(src);
  const op = l.opacity ?? 1;
  const ox = l.left ?? 0, oy = l.top ?? 0;
  for (let y = 0; y < src.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= H) continue;
    for (let x = 0; x < src.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= W) continue;
      const si = (y * src.width + x) * 4, di = (ty * W + tx) * 4;
      const a = (d[si + 3] / 255) * op;
      if (a <= 0) continue;
      const da = dst[di + 3] / 255;
      const oa = a + da * (1 - a);
      for (let c = 0; c < 3; c++) dst[di + c] = (d[si + c] * a + dst[di + c] * da * (1 - a)) / oa;
      dst[di + 3] = oa * 255;
    }
  }
}

// ---------------------------------------------------------------------------

interface HeifImage {
  get_width(): number;
  get_height(): number;
  display(img: { data: Uint8ClampedArray; width: number; height: number }, cb: (d: unknown) => void): void;
  free?(): void;
}
interface HeifLib { HeifDecoder: new () => { decode(buf: Uint8Array): HeifImage[] }; ready?: Promise<unknown> }

let heifLib: Promise<HeifLib> | null = null;
function loadHeif(): Promise<HeifLib> {
  heifLib ??= (async () => {
    const mod = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')) as { default: () => HeifLib | Promise<HeifLib> };
    const lib = await mod.default();
    if (lib.ready) await lib.ready;
    return lib;
  })();
  return heifLib;
}

async function decodeHeic(buf: ArrayBuffer): Promise<RawImage[]> {
  const lib = await loadHeif();
  const images = new lib.HeifDecoder().decode(new Uint8Array(buf));
  if (!images?.length) throw new Error('No image found in this HEIC file');
  const img = images[0]; // primary image
  const width = img.get_width(), height = img.get_height();
  const data = new Uint8ClampedArray(width * height * 4);
  await new Promise<void>((resolve, reject) =>
    img.display({ data, width, height }, (d) => (d ? resolve() : reject(new Error('HEIC decoding failed')))));
  for (const i of images) i.free?.();
  return [{ width, height, data }];
}
