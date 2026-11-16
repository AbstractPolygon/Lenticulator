/**
 * Parallel interlacing: the print is split into horizontal bands, one per
 * worker. Each band receives only the part of every frame it samples
 * (cropped from the frame bitmaps here), so no worker keeps whole frames in
 * memory and bands render concurrently on all cores.
 */
import { Affine, compose, translate } from '../core/geometry';
import { LensParams, Orientation, bandSourceRect } from '../core/interlace';
import { PageOptions, composePage } from '../core/patterns';
import type { WorkerRequest, WorkerResponse } from '../worker';
import { WorkerClient } from './workerClient';
import { imagePixels } from './canvas';

export type RenderClient = WorkerClient<WorkerRequest, WorkerResponse>;

export const newRenderWorker = (): RenderClient =>
  new WorkerClient<WorkerRequest, WorkerResponse>(() => new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' }));

export interface PoolFrame {
  /** source image (ImageBitmap, canvas, …) */
  source: CanvasImageSource;
  width: number;
  height: number;
  /** output pixel → source pixel */
  matrix: Affine;
}

export interface PoolJob {
  width: number;
  height: number;
  orientation: Orientation;
  lens: LensParams;
  frames: PoolFrame[];
  background: [number, number, number];
  page: Omit<PageOptions, 'orientation' | 'lens'>;
}

export class RenderPool {
  private clients: RenderClient[] = [];

  constructor(readonly size = Math.max(1, Math.min(8, navigator.hardwareConcurrency || 4)), first?: RenderClient) {
    if (first) this.clients.push(first);
  }

  private client(i: number): RenderClient {
    while (this.clients.length <= i) this.clients.push(newRenderWorker());
    return this.clients[i];
  }

  /** Render the full page; resolves with RGBA pixels including margins. */
  async render(job: PoolJob, onProgress?: (fraction: number) => void) {
    const { width: W, height: H } = job;
    const bands = Math.max(1, Math.min(this.size, Math.ceil(H / 64)));
    const rowsDone = new Array<number>(bands).fill(0);
    const report = () => onProgress?.(rowsDone.reduce((a, b) => a + b, 0) / H);
    const out = new Uint8ClampedArray(W * H * 4);
    await Promise.all(
      Array.from({ length: bands }, async (_, b) => {
        const y0 = Math.floor((b * H) / bands), y1 = Math.floor(((b + 1) * H) / bands);
        const frames: { width: number; height: number; data: ArrayBuffer }[] = [];
        const matrices: Affine[] = [];
        for (const f of job.frames) {
          const r = bandSourceRect(f.matrix, W, y0, y1, f.width, f.height);
          const data = r.w && r.h ? imagePixels(f.source, r.w, r.h, r).data.buffer as ArrayBuffer : new ArrayBuffer(0);
          frames.push({ width: r.w, height: r.h, data });
          matrices.push(compose(translate(-r.x, -r.y), f.matrix));
        }
        const res = await this.client(b).request<Extract<WorkerResponse, { type: 'rendered' }>>(
          (reqId) => ({
            type: 'render', reqId, width: W, height: H, y0, y1,
            orientation: job.orientation, lens: job.lens, frames, matrices, background: job.background,
          }),
          frames.map((f) => f.data),
          (done) => { rowsDone[b] = done; report(); },
        );
        out.set(new Uint8ClampedArray(res.data), res.y0 * W * 4);
        rowsDone[b] = y1 - y0;
        report();
      }),
    );
    return composePage({ width: W, height: H, data: out }, { ...job.page, orientation: job.orientation, lens: job.lens });
  }
}
