/** Depth panel: estimate or load a depth map for one photo and generate 3D views from it. */
import { NO_TRANSFORM, FrameTransform } from '../core/geometry';
import { framesForLens, modelInputSize } from '../core/depth3d';
import { Gray, rgbaToGray } from '../core/gray';
import type { DepthRequest, DepthResponse } from '../depthWorker';
import type { Frame, Settings } from './state';
import type { RenderClient } from './renderPool';
import type { WorkerResponse } from '../worker';
import { WorkerClient } from './workerClient';
import { encodeBitmap, imagePixels, rgbaToBitmap } from './canvas';

export interface DepthPanelApi {
  $: <T extends HTMLElement = HTMLElement>(id: string) => T;
  S: () => Settings;
  frames: () => Frame[];
  selFrame: () => Frame | undefined;
  isBusy: () => boolean;
  setBusy: (b: boolean) => void;
  status: (msg: string, kind?: 'info' | 'error', ms?: number) => void;
  progress: (f: number | null) => void;
  decodeAny: (blob: Blob, name: string) => Promise<ImageBitmap>;
  replaceFrames: (
    items: { blob: Blob; name: string; bitmap: ImageBitmap; transform?: FrameTransform }[],
    refIndex: number,
  ) => Promise<void>;
  worker: RenderClient;
}

/** Source photo and its depth (disparity, 1 = near) used to generate views. */
type DepthSource = { name: string; bitmap: ImageBitmap; depth: Gray };

export function initDepthPanel(api: DepthPanelApi) {
  const { $, S } = api;
  let source: DepthSource | null = null;
  let client: WorkerClient<DepthRequest, DepthResponse> | null = null;

  const depthClient = () =>
    (client ??= new WorkerClient<DepthRequest, DepthResponse>(
      () => new Worker(new URL('../depthWorker.ts', import.meta.url), { type: 'module' }),
    ));

  function setSource(s: DepthSource | null) {
    source?.bitmap.close();
    source = s;
    drawThumb();
  }

  function drawThumb() {
    const c = $<HTMLCanvasElement>('depth-thumb');
    c.hidden = !source;
    ($('btn-depth-generate') as HTMLButtonElement).disabled = api.isBusy() || !source;
    if (!source) return;
    const { depth } = source;
    c.width = depth.w;
    c.height = depth.h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(depth.w, depth.h);
    const inv = S().depthInvert, focus = S().depthFocus;
    for (let i = 0; i < depth.data.length; i++) {
      const v = inv ? 1 - depth.data[i] : depth.data[i];
      const g = Math.round(v * 255);
      // tint the focus plane so it's visible where the print surface will be
      const near = Math.abs(v - focus) < 0.015;
      img.data[i * 4] = near ? 255 : g;
      img.data[i * 4 + 1] = near ? 200 : g;
      img.data[i * 4 + 2] = near ? 0 : g;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  async function estimate() {
    const f = api.selFrame() ?? api.frames()[0];
    if (!f) return api.status('Select a photo first.', 'error');
    if (f.depthMap) {
      // the photo carries its own depth map (iPhone portrait mode): more accurate than estimating, and instant
      await loadMap(f.depthMap, 'depth map');
      if (source) api.status('Using the depth map stored in the photo.');
      return;
    }
    api.setBusy(true);
    api.progress(0);
    try {
      api.status('Loading depth model…', 'info', 120000);
      const size = modelInputSize(f.width, f.height);
      const px = imagePixels(f.bitmap, size.w, size.h);
      const res = await depthClient().request<Extract<DepthResponse, { type: 'depth' }>>(
        (reqId) => ({
          type: 'estimate', reqId,
          modelBase: new URL('models/depth-anything-v2-small/', location.href).href,
          width: px.width, height: px.height, data: px.data.buffer as ArrayBuffer,
        }),
        [px.data.buffer],
        (done, total, m) => {
          if (m.type === 'progress' && m.stage === 'download') api.progress(done / total);
          else { api.progress(null); api.status('Estimating depth…', 'info', 120000); }
        },
      );
      setSource({ name: f.name, bitmap: await createImageBitmap(f.bitmap), depth: { w: res.width, h: res.height, data: new Float32Array(res.data) } });
      api.status('Depth ready.');
    } catch (e) {
      client = null; // a crashed worker is recreated on the next try
      api.status(`Depth estimation failed: ${(e as Error).message}`, 'error', 8000);
    } finally {
      api.setBusy(false);
      api.progress(null);
      drawThumb();
    }
  }

  async function loadMap(file: Blob, name = (file as File).name ?? 'depth map') {
    const f = api.selFrame() ?? api.frames()[0];
    if (!f) return api.status('Select a photo first.', 'error');
    try {
      const bmp = await api.decodeAny(file, name);
      const k = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
      const px = imagePixels(bmp, w, h);
      bmp.close();
      setSource({ name: f.name, bitmap: await createImageBitmap(f.bitmap), depth: rgbaToGray(px.data, w, h) });
    } catch (e) {
      api.status(`Could not open ${name}: ${(e as Error).message}`, 'error', 6000);
    }
  }

  async function generate() {
    if (!source || api.isBusy()) return;
    const s = S();
    const n = s.depthAuto ? framesForLens(s.lpi, s.dpi) : s.depthFrames;
    const src = source;
    const k = Math.min(1, 2048 / Math.max(src.bitmap.width, src.bitmap.height));
    const w = Math.round(src.bitmap.width * k), h = Math.round(src.bitmap.height * k);
    api.setBusy(true);
    api.status(`Generating ${n} frames…`, 'info', 120000);
    try {
      const px = imagePixels(src.bitmap, w, h);
      const res = await api.worker.request<Extract<WorkerResponse, { type: 'views' }>>(
        (reqId) => ({
          type: 'synth', reqId,
          image: { width: w, height: h, data: px.data.buffer as ArrayBuffer },
          depth: { w: src.depth.w, h: src.depth.h, data: src.depth.data.slice().buffer as ArrayBuffer },
          params: { views: n, amount: (s.depthAmount / 100) * w, focus: s.depthFocus, invert: s.depthInvert },
        }),
        [px.data.buffer],
      );
      const items = [];
      for (let i = 0; i < res.views.length; i++) {
        const bitmap = await rgbaToBitmap(new Uint8ClampedArray(res.views[i]), res.width, res.height);
        items.push({ blob: await encodeBitmap(bitmap, 'image/jpeg', 0.92), name: `${src.name} [${i + 1}/${n}]`, bitmap, transform: NO_TRANSFORM });
      }
      // the middle view is the natural reference
      await api.replaceFrames(items, Math.floor(items.length / 2));
      api.status(`Generated ${n} frames.`);
    } catch (e) {
      api.status(`Generating frames failed: ${(e as Error).message}`, 'error', 8000);
    } finally {
      api.setBusy(false);
      drawThumb();
    }
  }

  $('btn-depth-estimate').addEventListener('click', () => !api.isBusy() && estimate());
  $('btn-depth-load').addEventListener('click', () => $<HTMLInputElement>('depth-input').click());
  $<HTMLInputElement>('depth-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) loadMap(input.files[0]).finally(() => (input.value = ''));
  });
  $('btn-depth-generate').addEventListener('click', () => generate());

  return {
    drawThumb,
    /** forget the depth source (e.g. when another project is opened) */
    reset: () => setSource(null),
    hasSource: () => !!source,
  };
}
