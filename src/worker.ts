/// <reference lib="webworker" />
/**
 * Background worker: renders one band of the interlaced print (several of
 * these run in parallel, see ui/renderPool.ts), runs auto-alignment and
 * generates depth views, so the UI stays responsive.
 */
import { alignFrame, AlignMode, AlignResult, Similarity } from './core/align';
import type { Gray } from './core/gray';
import { InterlaceJob, LensParams, Orientation, isOpaque, lensWeights, renderRows } from './core/interlace';
import type { Affine } from './core/geometry';
import { synthesizeViews, ViewParams } from './core/depth3d';

declare const self: DedicatedWorkerGlobalScope;

export type WorkerRequest =
  | {
      /** render rows [y0, y1) of a width × height print */
      type: 'render';
      reqId: number;
      width: number;
      height: number;
      y0: number;
      y1: number;
      orientation: Orientation;
      lens: LensParams;
      /** the part of each frame this band samples (pixels transferred) */
      frames: { width: number; height: number; data: ArrayBuffer }[];
      /** output pixel → cropped-frame pixel */
      matrices: Affine[];
      background: [number, number, number];
    }
  | {
      type: 'synth';
      reqId: number;
      image: { width: number; height: number; data: ArrayBuffer };
      depth: { w: number; h: number; data: ArrayBuffer };
      params: ViewParams;
    }
  | {
      type: 'align';
      reqId: number;
      ref: Gray;
      items: { index: number; gray: Gray; initFrom: number | null }[];
      mode: AlignMode;
      key?: { x: number; y: number };
    };

export type WorkerResponse =
  | { type: 'progress'; reqId: number; done: number; total: number }
  | { type: 'rendered'; reqId: number; y0: number; y1: number; data: ArrayBuffer }
  | { type: 'aligned'; reqId: number; results: { index: number; result: AlignResult }[] }
  | { type: 'views'; reqId: number; width: number; height: number; views: ArrayBuffer[] }
  | { type: 'error'; reqId: number; message: string };

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'render':
        render(msg);
        break;
      case 'align':
        align(msg);
        break;
      case 'synth': {
        const views = synthesizeViews(
          { width: msg.image.width, height: msg.image.height, data: new Uint8ClampedArray(msg.image.data) },
          { w: msg.depth.w, h: msg.depth.h, data: new Float32Array(msg.depth.data) },
          msg.params,
        ).map((v) => v.data.buffer as ArrayBuffer);
        post({ type: 'views', reqId: msg.reqId, width: msg.image.width, height: msg.image.height, views }, views);
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', reqId: 'reqId' in msg ? msg.reqId : -1, message: e instanceof Error ? e.message : String(e) });
  }
};

function render(msg: Extract<WorkerRequest, { type: 'render' }>) {
  const imgs = msg.frames.map((f) => {
    const data = new Uint8ClampedArray(f.data);
    return { width: f.width, height: f.height, data, opaque: isOpaque(data) };
  });
  const job: InterlaceJob = {
    width: msg.width,
    height: msg.height,
    orientation: msg.orientation,
    lens: { ...msg.lens, frames: imgs.length },
    frames: imgs,
    matrices: msg.matrices,
    background: msg.background,
  };
  const rows = msg.y1 - msg.y0;
  const out = new Uint8ClampedArray(msg.width * rows * 4);
  const weights = lensWeights(msg.orientation === 'vertical' ? msg.width : msg.height, job.lens);
  const chunk = Math.max(1, Math.floor(1_000_000 / msg.width));
  let last = 0;
  for (let y = msg.y0; y < msg.y1; y += chunk) {
    const y1 = Math.min(msg.y1, y + chunk);
    renderRows(job, y, y1, out.subarray((y - msg.y0) * msg.width * 4, (y1 - msg.y0) * msg.width * 4), weights);
    const now = Date.now();
    if (now - last > 100) {
      post({ type: 'progress', reqId: msg.reqId, done: y1 - msg.y0, total: rows });
      last = now;
    }
  }
  const buf = out.buffer as ArrayBuffer;
  post({ type: 'rendered', reqId: msg.reqId, y0: msg.y0, y1: msg.y1, data: buf }, [buf]);
}

function align(msg: Extract<WorkerRequest, { type: 'align' }>) {
  const results = new Map<number, AlignResult>();
  let done = 0;
  for (const item of msg.items) {
    const init: Similarity | undefined = item.initFrom != null ? results.get(item.initFrom) : undefined;
    const r = alignFrame(msg.ref, item.gray, { mode: msg.mode, key: msg.key, init });
    results.set(item.index, r);
    post({ type: 'progress', reqId: msg.reqId, done: ++done, total: msg.items.length });
  }
  post({ type: 'aligned', reqId: msg.reqId, results: [...results].map(([index, result]) => ({ index, result })) });
}
