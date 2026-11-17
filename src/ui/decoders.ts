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

/** The libheif module with its raw C exports (used for depth and auxiliary images, which the JS API doesn't cover). */
interface HeifRaw {
  heif_context_alloc(): { $$?: { ptr: number } };
  heif_context_read_from_memory(ctx: unknown, buf: Uint8Array): unknown;
  heif_context_free(ctx: unknown): void;
  _malloc(n: number): number;
  _free(p: number): void;
  HEAPU8: Uint8Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
  [fn: `_heif_${string}`]: (...args: number[]) => number;
}

/**
 * The depth map stored in a HEIC photo (iPhone portrait mode), as RGBA grey with white = near, or null.
 * Looks for a depth image first, then an auxiliary image whose type names depth or disparity.
 */
export async function heicDepth(blob: Blob): Promise<RawImage | null> {
  const L = (await loadHeif()) as unknown as HeifRaw;
  if (typeof L._heif_image_handle_has_depth_image !== 'function') return null;
  const ctx = L.heif_context_alloc();
  const ptrs: number[] = [];
  const alloc = (n: number) => { const p = L._malloc(n); ptrs.push(p); return p; };
  const releaseHandles: number[] = [];
  try {
    L.heif_context_read_from_memory(ctx, new Uint8Array(await blob.arrayBuffer()));
    const ctxPtr = ctx.$$?.ptr;
    if (!ctxPtr) return null;
    // C functions that return a struct heif_error take a pointer for it as their first argument
    const err = alloc(16), out = alloc(4);
    const ok = () => L.HEAP32[err >> 2] === 0;
    L._heif_context_get_primary_image_handle(err, ctxPtr, out);
    if (!ok()) return null;
    const main = L.HEAPU32[out >> 2];
    releaseHandles.push(main);
    let depth = 0;
    const nd = L._heif_image_handle_get_number_of_depth_images(main);
    if (nd > 0) {
      const ids = alloc(4 * nd);
      L._heif_image_handle_get_list_of_depth_image_IDs(main, ids, nd);
      L._heif_image_handle_get_depth_image_handle(err, main, L.HEAPU32[ids >> 2], out);
      if (ok()) depth = L.HEAPU32[out >> 2];
    }
    if (!depth) {
      const na = L._heif_image_handle_get_number_of_auxiliary_images(main, 0);
      if (na > 0) {
        const ids = alloc(4 * na), typePtr = alloc(4);
        L._heif_image_handle_get_list_of_auxiliary_image_IDs(main, 0, ids, na);
        for (let i = 0; i < na && !depth; i++) {
          L._heif_image_handle_get_auxiliary_image_handle(err, main, L.HEAPU32[(ids >> 2) + i], out);
          if (!ok()) continue;
          const aux = L.HEAPU32[out >> 2];
          L._heif_image_handle_get_auxiliary_type(err, aux, typePtr);
          let type = '';
          if (ok()) {
            const s = L.HEAPU32[typePtr >> 2];
            let e = s;
            while (L.HEAPU8[e]) e++;
            type = new TextDecoder().decode(L.HEAPU8.subarray(s, e));
            L._heif_image_handle_release_auxiliary_type(aux, typePtr);
          }
          if (/depth|disparity/i.test(type) && !/matte|gainmap/i.test(type)) depth = aux;
          else L._heif_image_handle_release(aux);
        }
      }
    }
    if (!depth) return null;
    releaseHandles.push(depth);
    // decode in the image's own format and read its luma / grey plane
    L._heif_decode_image(err, depth, out, 99, 99, 0);
    if (!ok()) return null;
    const img = L.HEAPU32[out >> 2];
    try {
      const stride = alloc(4);
      const plane = L._heif_image_get_plane_readonly(img, 0, stride);
      const w = L._heif_image_get_width(img, 0), h = L._heif_image_get_height(img, 0), st = L.HEAP32[stride >> 2];
      if (!plane || w <= 0 || h <= 0) return null;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = L.HEAPU8[plane + y * st + x];
        data.set([v, v, v, 255], (y * w + x) * 4);
      }
      return { width: w, height: h, data };
    } finally {
      L._heif_image_release(img);
    }
  } catch {
    return null;
  } finally {
    for (const h of releaseHandles) L._heif_image_handle_release(h);
    for (const p of ptrs) L._free(p);
    L.heif_context_free(ctx);
  }
}
