/// <reference lib="webworker" />
/**
 * Background worker: holds full-resolution frame pixels, renders the
 * interlaced print, and runs auto-alignment so the UI stays responsive.
 */
import { alignFrame, AlignMode, AlignResult, Similarity } from './core/align';
import type { Gray } from './core/gray';
import { InterlaceJob, LensParams, Orientation, RGBAImage, lensWeights, renderRows } from './core/interlace';
import { composePage, PageOptions } from './core/patterns';
import type { Affine } from './core/geometry';

declare const self: DedicatedWorkerGlobalScope;

const frames = new Map<string, RGBAImage>();

export type FrameRef = { id: string } | RGBAImage;

export type WorkerRequest =
  | { type: 'setFrame'; id: string; width: number; height: number; data: ArrayBuffer }
  | { type: 'dropFrame'; id: string }
  | {
      type: 'render';
      reqId: number;
      width: number;
      height: number;
      orientation: Orientation;
      lens: LensParams;
      frames: FrameRef[];
      matrices: Affine[];
      background: [number, number, number];
      page: Omit<PageOptions, 'orientation' | 'lens'>;
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
  | { type: 'rendered'; reqId: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'aligned'; reqId: number; results: { index: number; result: AlignResult }[] }
  | { type: 'error'; reqId: number; message: string };

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'setFrame':
        frames.set(msg.id, { width: msg.width, height: msg.height, data: new Uint8ClampedArray(msg.data) });
        break;
      case 'dropFrame':
        frames.delete(msg.id);
        break;
      case 'render':
        render(msg);
        break;
      case 'align':
        align(msg);
        break;
    }
  } catch (e) {
    post({ type: 'error', reqId: 'reqId' in msg ? msg.reqId : -1, message: e instanceof Error ? e.message : String(e) });
  }
};

function render(msg: Extract<WorkerRequest, { type: 'render' }>) {
  const imgs = msg.frames.map((f) => {
    if ('id' in f) {
      const img = frames.get(f.id);
      if (!img) throw new Error('Frame data missing in worker');
      return img;
    }
    return f;
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
  const out = new Uint8ClampedArray(msg.width * msg.height * 4);
  const weights = lensWeights(msg.orientation === 'vertical' ? msg.width : msg.height, job.lens);
  const band = Math.max(1, Math.floor(2_000_000 / msg.width));
  let last = 0;
  for (let y = 0; y < msg.height; y += band) {
    const y1 = Math.min(msg.height, y + band);
    renderRows(job, y, y1, out.subarray(y * msg.width * 4, y1 * msg.width * 4), weights);
    const now = Date.now();
    if (now - last > 100) {
      post({ type: 'progress', reqId: msg.reqId, done: y1, total: msg.height });
      last = now;
    }
  }
  const page = composePage(
    { width: msg.width, height: msg.height, data: out },
    { ...msg.page, orientation: msg.orientation, lens: msg.lens },
  );
  const buf = page.data.buffer as ArrayBuffer;
  post({ type: 'rendered', reqId: msg.reqId, width: page.width, height: page.height, data: buf }, [buf]);
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
