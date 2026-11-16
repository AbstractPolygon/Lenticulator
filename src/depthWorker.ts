/// <reference lib="webworker" />
/**
 * Monocular depth estimation (Depth Anything V2 Small, ONNX, WebAssembly).
 * Runs entirely on the device; the model is loaded once from the app's own files.
 */
import * as ort from 'onnxruntime-web/wasm';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { modelInputSize, normalizeDepth, toTensor } from './core/depth3d';

declare const self: DedicatedWorkerGlobalScope;

export type DepthRequest = {
  type: 'estimate';
  reqId: number;
  /** absolute URL of the model folder (with trailing slash) */
  modelBase: string;
  width: number;
  height: number;
  /** RGBA pixels already resized to the model input size */
  data: ArrayBuffer;
};

export type DepthResponse =
  | { type: 'progress'; reqId: number; stage: 'download' | 'infer'; done: number; total: number }
  | { type: 'depth'; reqId: number; width: number; height: number; data: ArrayBuffer }
  | { type: 'error'; reqId: number; message: string };

interface Manifest { parts: string[]; size: number; input: string; output: string; mean: number[]; std: number[] }

let session: Promise<{ s: ort.InferenceSession; m: Manifest }> | null = null;

function post(msg: DepthResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function load(base: string, reqId: number) {
  const m: Manifest = await (await fetch(base + 'manifest.json')).json();
  const buf = new Uint8Array(m.size);
  let off = 0;
  for (const part of m.parts) {
    const r = await fetch(base + part);
    if (!r.ok) throw new Error(`model download failed (${r.status})`);
    const b = new Uint8Array(await r.arrayBuffer());
    buf.set(b, off);
    off += b.length;
    post({ type: 'progress', reqId, stage: 'download', done: off, total: m.size });
  }
  ort.env.wasm.wasmPaths = { wasm: new URL(wasmUrl, self.location.href).href };
  // threads need cross-origin isolation, which most hosts (and the artifact viewer) don't provide
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const s = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  return { s, m };
}

self.onmessage = async (ev: MessageEvent<DepthRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'estimate') return;
  try {
    if (!session) {
      session = load(msg.modelBase, msg.reqId);
      session.catch(() => (session = null));
    }
    const { s, m } = await session;
    post({ type: 'progress', reqId: msg.reqId, stage: 'infer', done: 0, total: 1 });
    const size = modelInputSize(msg.width, msg.height);
    if (size.w !== msg.width || size.h !== msg.height) throw new Error('input must be resized to the model size');
    const input = new ort.Tensor('float32', toTensor(new Uint8ClampedArray(msg.data), msg.width, msg.height, m.mean, m.std), [1, 3, msg.height, msg.width]);
    const out = await s.run({ [m.input]: input });
    const t = out[m.output] ?? Object.values(out)[0];
    const [oh, ow] = t.dims.slice(-2) as number[];
    const depth = normalizeDepth(t.data as Float32Array, ow, oh);
    const data = depth.data.buffer as ArrayBuffer;
    post({ type: 'depth', reqId: msg.reqId, width: ow, height: oh, data }, [data]);
  } catch (e) {
    post({ type: 'error', reqId: msg.reqId, message: e instanceof Error ? e.message : String(e) });
  }
};
