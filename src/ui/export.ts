import { encodeTiff, setPngDpi } from '../core/fileformats';

export interface RenderResult {
  canvas: HTMLCanvasElement;
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  dpi: number;
  title: string;
  fileBase: string;
}

export function download(blob: Blob, name: string): void {
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
  const blob = await new Promise<Blob | null>((res) => r.canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed (image may be too large for this browser)');
  const tagged = setPngDpi(new Uint8Array(await blob.arrayBuffer()), r.dpi);
  return new Blob([tagged as BlobPart], { type: 'image/png' });
}

export function toTiff(r: RenderResult): Blob {
  return new Blob([encodeTiff(r.rgba, r.width, r.height, r.dpi) as BlobPart], { type: 'image/tiff' });
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
