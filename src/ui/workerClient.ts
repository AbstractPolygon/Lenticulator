import type { WorkerRequest, WorkerResponse } from '../worker';

type Pending = {
  resolve: (r: WorkerResponse) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number) => void;
};

/** Promise wrapper around the render/align worker. */
export class WorkerClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      if (msg.type === 'progress') p.onProgress?.(msg.done, msg.total);
      else {
        this.pending.delete(msg.reqId);
        if (msg.type === 'error') p.reject(new Error(msg.message));
        else p.resolve(msg);
      }
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker crashed'));
      this.pending.clear();
    };
  }

  send(msg: WorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(msg, transfer);
  }

  request<T extends WorkerResponse>(
    build: (reqId: number) => WorkerRequest,
    transfer: Transferable[] = [],
    onProgress?: (done: number, total: number) => void,
  ): Promise<T> {
    const reqId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (r: WorkerResponse) => void, reject, onProgress });
      this.worker.postMessage(build(reqId), transfer);
    });
  }
}
