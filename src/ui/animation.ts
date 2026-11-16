/**
 * Animated previews of the print being tilted: GIF (gifenc, lazy-loaded) and
 * video (MediaRecorder: MP4 where the browser supports it, otherwise WebM).
 */

import { Dither, ditherToPalette } from '../core/dither';
import type { Step } from '../core/timing';

export type DrawFn = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;

/** View positions 0→1→0 for one back-and-forth sweep (no duplicated end points). */
export function sweepPositions(frames: number, stepsPerFrame = 4): number[] {
  const steps = Math.max(8, (frames - 1) * stepsPerFrame);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push(0.5 - 0.5 * Math.cos((i / steps) * Math.PI)); // ease in/out
  for (let i = steps - 1; i > 0; i--) out.push(out[i]);
  return out;
}

/** Output size that keeps the print's aspect ratio, long side = `long`, even dimensions (video codecs need them). */
export function animSize(aspect: number, long: number) {
  const w = aspect >= 1 ? long : Math.round(long * aspect);
  const h = aspect >= 1 ? Math.round(long / aspect) : long;
  return { w: w + (w % 2), h: h + (h % 2) };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext('2d', { willReadFrequently: true })! };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

interface GifEncoderApi {
  GIFEncoder: () => {
    writeFrame(index: Uint8Array, w: number, h: number, o: { palette: number[][]; delay: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  quantize(rgba: Uint8ClampedArray, max: number): number[][];
}

export async function encodeGif(
  draw: DrawFn, w: number, h: number, steps: Step[],
  onProgress?: (f: number) => void, dither: Dither = 'none',
): Promise<Blob> {
  const { GIFEncoder, quantize } = (await import('gifenc')) as unknown as GifEncoderApi;
  const gif = GIFEncoder();
  const { ctx } = canvas(w, h);
  for (let i = 0; i < steps.length; i++) {
    draw(ctx, w, h, steps[i].pos);
    const { data } = ctx.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    gif.writeFrame(ditherToPalette(data, w, h, palette, dither), w, h, { palette, delay: Math.round(steps[i].ms) });
    onProgress?.((i + 1) / steps.length);
    if (i % 3 === 0) await tick(); // keep the UI responsive
  }
  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

export function videoFormat(): { mime: string; ext: 'mp4' | 'webm' } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  const options: { mime: string; ext: 'mp4' | 'webm' }[] = [
    { mime: 'video/mp4;codecs=avc1.42E01F', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  return options.find((o) => MediaRecorder.isTypeSupported(o.mime)) ?? null;
}

/** Records in real time: `loops` sweeps at `fps`. */
export async function recordVideo(
  draw: DrawFn, w: number, h: number, positions: number[], fps: number, loops = 2,
  onProgress?: (f: number) => void,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const fmt = videoFormat();
  if (!fmt) throw new Error('video recording is not supported in this browser');
  const { c, ctx } = canvas(w, h);
  draw(ctx, w, h, positions[0]);
  const stream = c.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: fmt.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((resolve, reject) => {
    rec.onstop = () => resolve();
    rec.onerror = () => reject(new Error('recording failed'));
  });
  rec.start();
  const total = positions.length * loops;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    draw(ctx, w, h, positions[i % positions.length]);
    track.requestFrame?.();
    onProgress?.((i + 1) / total);
    // pace frames in real time so the video plays at the right speed
    const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
    await new Promise((r) => setTimeout(r, Math.max(0, wait)));
  }
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return { blob: new Blob(chunks, { type: fmt.mime.split(';')[0] }), ext: fmt.ext };
}
