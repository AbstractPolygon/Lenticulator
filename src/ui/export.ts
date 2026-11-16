import { encodePdf, encodeTiff, setJpegDpi, setPngDpi } from '../core/fileformats';
import { encodeCanvas } from './canvas';

export interface RenderResult {
  /** the only copy of the rendered pixels */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  dpi: number;
  title: string;
  fileBase: string;
}

type HostDownloads = { save(r: { filename: string; data: Blob }): Promise<unknown> };
type HostBridge = { use(name: string): Promise<unknown> };

/** True when running inside a claude.ai artifact viewer (sandboxed frame). */
export function inArtifactHost(): boolean {
  return typeof (window as unknown as { claude?: HostBridge }).claude?.use === 'function';
}

/**
 * Save a file. Inside a claude.ai artifact the sandbox blocks plain downloads,
 * so the host's "downloads" capability is used (the viewer confirms the save).
 */
export async function download(blob: Blob, name: string): Promise<void> {
  const host = (window as unknown as { claude?: HostBridge }).claude;
  if (host?.use) {
    const d = (await host.use('downloads')) as HostDownloads | null;
    if (!d) throw new Error('Saving files is not available in this view.');
    try {
      await d.save({ filename: name, data: blob });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') return;
      if (code === 'rejected_extension') throw new Error(`.${name.split('.').pop()} files can't be saved here – use PNG, or the desktop app.`);
      throw new Error((e as { message?: string }).message ?? 'Save failed');
    }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function toPng(r: RenderResult): Promise<Blob> {
  const blob = await encodeCanvas(r.canvas, 'image/png');
  return new Blob([setPngDpi(new Uint8Array(await blob.arrayBuffer()), r.dpi) as BlobPart], { type: 'image/png' });
}

export async function toJpeg(r: RenderResult, quality = 0.95): Promise<Blob> {
  const blob = await encodeCanvas(r.canvas, 'image/jpeg', quality);
  return new Blob([setJpegDpi(new Uint8Array(await blob.arrayBuffer()), r.dpi) as BlobPart], { type: 'image/jpeg' });
}

export function toTiff(r: RenderResult, cmyk = false): Blob {
  // read the pixels back from the canvas only for this export (no second copy kept around)
  const rgba = r.canvas.getContext('2d')!.getImageData(0, 0, r.width, r.height).data;
  return new Blob([encodeTiff(rgba, r.width, r.height, r.dpi, cmyk) as BlobPart], { type: 'image/tiff' });
}

/** One-page PDF at exact print size (the print embedded as a high-quality JPEG). */
export async function toPdf(r: RenderResult): Promise<Blob> {
  const jpg = new Uint8Array(await (await encodeCanvas(r.canvas, 'image/jpeg', 0.97)).arrayBuffer());
  return new Blob([encodePdf(jpg, r.width, r.height, r.dpi) as BlobPart], { type: 'application/pdf' });
}

/**
 * Print at exact physical size via a hidden iframe whose page size and
 * image size are set in inches.
 */
export async function printResult(r: RenderResult): Promise<void> {
  const png = await toPng(r);
  const url = URL.createObjectURL(png);
  const wIn = r.width / r.dpi;
  const hIn = r.height / r.dpi;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html><head><title>${r.fileBase}</title><style>
    @page { size: ${wIn}in ${hIn}in; margin: 0; }
    html, body { margin: 0; padding: 0; }
    img { display: block; width: ${wIn}in; height: ${hIn}in; image-rendering: pixelated; }
  </style></head><body><img id="im"></body></html>`);
  doc.close();
  const img = doc.getElementById('im') as HTMLImageElement;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not load print image'));
    img.src = url;
  });
  iframe.contentWindow!.focus();
  iframe.contentWindow!.print();
  setTimeout(() => {
    iframe.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
}
