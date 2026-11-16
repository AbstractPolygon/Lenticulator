/**
 * Promise wrapper around a worker that answers requests by `reqId`.
 * Messages of type 'progress' report progress; 'error' rejects; anything else resolves.
 */
type Res = { type: string; reqId: number; done?: number; total?: number; message?: string };

type Pending<R> = {
  resolve: (r: R) => void;
  reject: (e: Error) => void;
  onProgress?: (done: number, total: number, msg: R) => void;
};

export class WorkerClient<Req, R extends Res> {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending<R>>();

  /** Pass a factory so Vite can see the `new Worker(new URL(...))` call at the call site. */
  constructor(create: () => Worker) {
    this.worker = create();
    this.worker.onmessage = (ev: MessageEvent<R>) => {
      const msg = ev.data;
      const p = this.pending.get(msg.reqId);
      if (!p) return;
      if (msg.type === 'progress') p.onProgress?.(msg.done ?? 0, msg.total ?? 1, msg);
      else {
        this.pending.delete(msg.reqId);
        if (msg.type === 'error') p.reject(new Error(msg.message || 'worker error'));
        else p.resolve(msg);
      }
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Worker crashed'));
      this.pending.clear();
    };
  }

  request<T extends R>(
    build: (reqId: number) => Req,
    transfer: Transferable[] = [],
    onProgress?: (done: number, total: number, msg: R) => void,
  ): Promise<T> {
    const reqId = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (r: R) => void, reject, onProgress });
      this.worker.postMessage(build(reqId), transfer);
    });
  }
}
