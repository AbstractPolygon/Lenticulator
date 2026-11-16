import './styles.css';
import {
  Affine, FrameTransform, NO_TRANSFORM, alignMap, baseMap, compose, frameMatrix, invert, outputMap, scale, apply,
} from './core/geometry';
import { COMMON_DPI, COMMON_LPI, lensStats } from './core/interlace';
import { similarityToParams } from './core/align';
import { rgbaToGray } from './core/gray';
import { frameColor, lensRuler, pitchTest, Pattern } from './core/patterns';
import {
  AppState, Frame, MODE_DEFAULTS, SIZE_PRESETS, Settings, framing, hexToRgb, loadSettings, outputPixels, saveSettings,
} from './ui/state';
import { base64ToBlob, blobToBase64, decode, filesFromDrop, isImageFile, pixels, splitMultiPicture, thumbnail, uid } from './ui/images';
import { WorkerClient } from './ui/workerClient';
import { RawImage, decodeSpecial, sniffBlob } from './ui/decoders';
import { Rect, ViewState } from './ui/view';
import type { FrameRef, WorkerResponse } from './worker';
import { RenderResult, download, inArtifactHost, printResult, toJpeg, toPng, toTiff } from './ui/export';
import { zipStore } from './core/fileformats';
import { DrawFn, animSize, encodeGif, recordVideo, sweepPositions, videoFormat } from './ui/animation';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const state: AppState = {
  settings: loadSettings(),
  frames: [],
  refId: null,
  selectedId: null,
  keyPoint: null,
};
let result: RenderResult | null = null;
let busy = false;
const worker = new WorkerClient();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const S = () => state.settings;

// ---------------------------------------------------------------------------
// Status / progress
// ---------------------------------------------------------------------------

let statusTimer = 0;
function status(msg: string, kind: 'info' | 'error' = 'info', ms = 3500) {
  const el = $('status');
  el.textContent = msg;
  el.classList.toggle('error', kind === 'error');
  el.classList.add('show');
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

function progress(frac: number | null) {
  const wrap = document.querySelector('.progress') as HTMLElement;
  wrap.hidden = frac === null;
  $('progress-bar').style.width = `${Math.round((frac ?? 0) * 100)}%`;
}

function setBusy(b: boolean) {
  busy = b;
  for (const id of ['btn-render', 'btn-auto-align', 'btn-pattern']) ($(id) as HTMLButtonElement).disabled = b;
  updateExportButtons();
}

// ---------------------------------------------------------------------------
// Settings form binding
// ---------------------------------------------------------------------------

const unitFactor = () => (S().units === 'mm' ? 25.4 : 1);

function fillStaticOptions() {
  const preset = $<HTMLSelectElement>('size-preset');
  preset.innerHTML = '<option value="">Custom</option>' +
    SIZE_PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
  $('dpi-list').innerHTML = COMMON_DPI.map((d) => `<option value="${d}">`).join('');
  $('lpi-list').innerHTML = COMMON_LPI.map((d) => `<option value="${d}">`).join('');
}

function syncForm() {
  const s = S();
  const f = unitFactor();
  const num = (id: string, v: number, digits = 3) => {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) el.value = String(+v.toFixed(digits));
  };
  num('width', s.widthIn * f);
  num('height', s.heightIn * f);
  $<HTMLSelectElement>('units').value = s.units;
  num('dpi', s.dpi, 2);
  num('lpi', s.lpi, 3);
  $<HTMLSelectElement>('orientation').value = s.orientation;
  $<HTMLSelectElement>('sampling').value = s.sampling;
  $<HTMLInputElement>('reverse').checked = s.reverse;
  $<HTMLInputElement>('phase').value = String(s.phase);
  $('phase-val').textContent = `${Math.round(s.phase * 100)}% of a lens`;
  $<HTMLSelectElement>('fit').value = s.fit;
  $<HTMLInputElement>('zoom').value = String(s.zoom);
  $('zoom-val').textContent = `${Math.round(s.zoom * 100)}%`;
  $<HTMLInputElement>('panX').value = String(s.panX);
  $<HTMLInputElement>('panY').value = String(s.panY);
  $<HTMLInputElement>('bg').value = s.background;
  num('margin', s.marginIn * f);
  $<HTMLInputElement>('alignBars').checked = s.alignBars;
  $<HTMLInputElement>('cropMarks').checked = s.cropMarks;
  $<HTMLSelectElement>('align-mode').value = s.alignMode;
  document.querySelectorAll<HTMLButtonElement>('#export-format [data-format]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.format === s.exportFormat)));
  $<HTMLSelectElement>('psd-import').value = s.psdLayers ? 'layers' : 'flat';
  $<HTMLSelectElement>('tiff-import').value = s.tiffAllPages ? 'all' : 'first';
  const pi = SIZE_PRESETS.findIndex(
    (p) => (Math.abs(p.w - s.widthIn) < 1e-3 && Math.abs(p.h - s.heightIn) < 1e-3) ||
      (Math.abs(p.h - s.widthIn) < 1e-3 && Math.abs(p.w - s.heightIn) < 1e-3),
  );
  $<HTMLSelectElement>('size-preset').value = pi >= 0 ? String(pi) : '';
  document.querySelectorAll<HTMLButtonElement>('.segmented [data-mode]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.mode === s.mode)));
  const is3d = s.mode === '3d';
  // anaglyph only makes sense for 3D; the comparison overlays work for both
  const pm = $<HTMLSelectElement>('preview-mode');
  pm.querySelector<HTMLOptionElement>('option[value=anaglyph]')!.hidden = !is3d;
  if (!is3d && pm.value === 'anaglyph') pm.value = 'tilt';
  updateLensInfo();
  updateAlignHint();
}

function bindSettings() {
  const on = (id: string, ev: string, fn: (el: HTMLInputElement) => void) =>
    $<HTMLInputElement>(id).addEventListener(ev, (e) => {
      fn(e.target as HTMLInputElement);
      saveSettings(S());
      syncForm();
      scheduleRedraw();
    });
  const pos = (v: string, fallback: number) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  document.querySelectorAll<HTMLButtonElement>('.segmented [data-mode]').forEach((b) =>
    b.addEventListener('click', () => {
      const mode = b.dataset.mode as Settings['mode'];
      if (mode === S().mode) return;
      Object.assign(S(), { mode }, MODE_DEFAULTS[mode]);
      saveSettings(S());
      syncForm();
      scheduleRedraw();
      status(mode === '3d'
        ? '3D mode: vertical lenses, key-point alignment.'
        : 'Animation mode: horizontal lenses, shift-only alignment.');
    }));
  on('size-preset', 'change', (el) => {
    const p = SIZE_PRESETS[+el.value];
    if (!p) return;
    // keep current orientation (portrait/landscape)
    const portrait = S().heightIn > S().widthIn;
    S().widthIn = portrait ? Math.min(p.w, p.h) : Math.max(p.w, p.h);
    S().heightIn = portrait ? Math.max(p.w, p.h) : Math.min(p.w, p.h);
  });
  on('width', 'change', (el) => (S().widthIn = pos(el.value, S().widthIn * unitFactor()) / unitFactor()));
  on('height', 'change', (el) => (S().heightIn = pos(el.value, S().heightIn * unitFactor()) / unitFactor()));
  on('units', 'change', (el) => (S().units = el.value as Settings['units']));
  on('dpi', 'change', (el) => (S().dpi = Math.min(4800, pos(el.value, S().dpi))));
  on('lpi', 'change', (el) => (S().lpi = pos(el.value, S().lpi)));
  on('orientation', 'change', (el) => (S().orientation = el.value as Settings['orientation']));
  on('sampling', 'change', (el) => (S().sampling = el.value as Settings['sampling']));
  on('reverse', 'change', (el) => (S().reverse = el.checked));
  on('phase', 'input', (el) => (S().phase = +el.value));
  on('fit', 'change', (el) => (S().fit = el.value as Settings['fit']));
  on('zoom', 'input', (el) => (S().zoom = +el.value));
  on('panX', 'input', (el) => (S().panX = +el.value));
  on('panY', 'input', (el) => (S().panY = +el.value));
  on('bg', 'input', (el) => (S().background = el.value));
  on('margin', 'change', (el) => (S().marginIn = Math.max(0, parseFloat(el.value) || 0) / unitFactor()));
  on('alignBars', 'change', (el) => (S().alignBars = el.checked));
  on('cropMarks', 'change', (el) => (S().cropMarks = el.checked));
  on('align-mode', 'change', (el) => (S().alignMode = el.value as Settings['alignMode']));
  $('export-format').addEventListener('click', (e) => {
    const fmt = (e.target as HTMLElement).closest<HTMLElement>('[data-format]')?.dataset.format;
    if (!fmt) return;
    S().exportFormat = fmt as Settings['exportFormat'];
    saveSettings(S());
    syncForm();
    updateExportButtons();
  });
  on('psd-import', 'change', (el) => (S().psdLayers = el.value === 'layers'));
  on('tiff-import', 'change', (el) => (S().tiffAllPages = el.value === 'all'));
}

function activeFrames(): Frame[] {
  return state.frames.filter((f) => f.enabled);
}

const isAnimFormat = (f: Settings['exportFormat']) => f === 'gif' || f === 'video';

/** Stills need a rendered print; GIF / video only need frames. */
function updateExportButtons() {
  const anim = isAnimFormat(S().exportFormat);
  ($('btn-download') as HTMLButtonElement).disabled = busy || (anim ? activeFrames().length < 2 : !result);
}

function updateLensInfo() {
  updateExportButtons();
  const s = S();
  const n = activeFrames().length;
  const st = lensStats(s.lpi, s.dpi, Math.max(1, n));
  const px = outputPixels(s);
  const mpx = (px.w * px.h) / 1e6;
  const lenses = (s.orientation === 'vertical' ? s.widthIn : s.heightIn) * s.lpi;
  const lines = [
    `<b>${st.pixelsPerLens.toFixed(2)}</b> print dots per lens` +
      (n ? ` · <b>${st.pixelsPerFrameStrip.toFixed(2)}</b> per frame strip` : ''),
    `Output <b>${px.w} × ${px.h}</b> px (${mpx.toFixed(1)} MP) · ${Math.round(lenses)} lenses`,
  ];
  if (n > st.maxUsefulFrames)
    lines.push(`<span class="warn">⚠ More frames than dots per lens (${st.maxUsefulFrames})</span>`);
  if (s.mode === 'animation' && s.orientation === 'vertical')
    lines.push('<span class="warn">⚠ Vertical lenses may ghost in animation</span>');
  if (s.mode === '3d' && s.orientation === 'horizontal')
    lines.push('<span class="warn">⚠ 3D needs vertical lenses</span>');
  if (mpx > 250) lines.push('<span class="warn">⚠ Very large output</span>');
  $('lens-info').innerHTML = lines.join('<br>');
  $('frame-count').textContent = String(state.frames.length);
}

function updateAlignHint() {
  $('btn-pick-key').hidden = S().alignMode !== 'keypoint';
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

async function importFiles(files: Iterable<File | Blob>, names?: string[]) {
  const list = [...files];
  if (!list.length) return;
  status(`Importing ${list.length} file(s)…`, 'info', 10000);
  let added = 0;
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const baseName = names?.[i] ?? (file as File).name ?? `Frame ${state.frames.length + 1}`;
    try {
      const kind = await sniffBlob(file, baseName);
      if (kind) {
        // HEIC opens natively in Safari; otherwise (and for TIFF/PSD) use the bundled decoders
        const native = kind === 'heic' ? await decode(file).catch(() => null) : null;
        if (native) {
          await addFrame(file, baseName, NO_TRANSFORM, true, native);
          added++;
          continue;
        }
        status(`Decoding ${baseName}…`, 'info', 20000);
        const raws = await decodeSpecial(file, kind, { psdLayers: S().psdLayers, tiffAllPages: S().tiffAllPages });
        if (raws.length === 1) {
          // keep the original file (smaller project files); it is decoded again on load
          await addFrame(file, baseName, NO_TRANSFORM, true, await rawToBitmap(raws[0]));
          added++;
        } else {
          // pages / layers become separate lossless PNG frames
          for (let p = 0; p < raws.length; p++) {
            const bmp = await rawToBitmap(raws[p]);
            await addFrame(await bitmapToPng(bmp), `${baseName} [${raws[p].name ?? p + 1}]`, NO_TRANSFORM, true, bmp);
            added++;
          }
        }
        continue;
      }
      const parts = await splitMultiPicture(file);
      for (let p = 0; p < parts.length; p++) {
        const blob = parts.length > 1 ? parts[p] : file;
        await addFrame(blob, parts.length > 1 ? `${baseName} [${p + 1}]` : baseName);
        added++;
      }
    } catch (e) {
      const why = e instanceof Error && e.message && !/decode|source image|InvalidStateError/i.test(e.message)
        ? e.message
        : 'this image format isn’t supported here';
      status(`Could not open ${baseName}: ${why}.`, 'error', 7000);
    }
  }
  if (added) status(`Added ${added} frame(s).`);
  renderFrameList();
  updateLensInfo();
  scheduleRedraw();
}

async function rawToBitmap(r: RawImage): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(r.data as Uint8ClampedArray<ArrayBuffer>, r.width, r.height));
}

async function bitmapToPng(bmp: ImageBitmap): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('could not convert the image');
  return blob;
}

/** Decode any supported file (used for project reloads, where frames keep their original bytes). */
async function decodeAny(blob: Blob, name: string): Promise<ImageBitmap> {
  const kind = await sniffBlob(blob, name);
  if (!kind) return decode(blob);
  if (kind === 'heic') {
    const native = await decode(blob).catch(() => null);
    if (native) return native;
  }
  const [first] = await decodeSpecial(blob, kind, { psdLayers: false, tiffAllPages: false });
  return rawToBitmap(first);
}

async function addFrame(
  blob: Blob, name: string, transform: FrameTransform = NO_TRANSFORM, enabled = true, decoded?: ImageBitmap,
): Promise<Frame> {
  const bitmap = decoded ?? (await decodeAny(blob, name));
  const frame: Frame = {
    id: uid(),
    name,
    blob,
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    thumb: thumbnail(bitmap),
    transform: { ...transform },
    enabled,
  };
  const px = pixels(bitmap);
  // the worker samples full-res pixels; scale the transform if we capped the size
  worker.send({ type: 'setFrame', id: frame.id, width: px.width, height: px.height, data: px.data.buffer }, [px.data.buffer]);
  workerSizes.set(frame.id, { w: px.width, h: px.height });
  state.frames.push(frame);
  if (!state.refId) state.refId = frame.id;
  if (!state.selectedId) state.selectedId = frame.id;
  return frame;
}
/** dimensions of the pixel copy held by the worker (may be capped) */
const workerSizes = new Map<string, { w: number; h: number }>();

function removeFrame(id: string) {
  const i = state.frames.findIndex((f) => f.id === id);
  if (i < 0) return;
  state.frames[i].bitmap.close();
  state.frames.splice(i, 1);
  worker.send({ type: 'dropFrame', id });
  workerSizes.delete(id);
  if (state.refId === id) state.refId = state.frames[0]?.id ?? null;
  if (state.selectedId === id) state.selectedId = state.frames[Math.min(i, state.frames.length - 1)]?.id ?? null;
}

function refFrame(): Frame | undefined {
  return state.frames.find((f) => f.id === state.refId) ?? state.frames[0];
}
function selFrame(): Frame | undefined {
  return state.frames.find((f) => f.id === state.selectedId);
}

let dragId: string | null = null;
function renderFrameList() {
  const ol = $('frame-list');
  ol.innerHTML = '';
  state.frames.forEach((f, i) => {
    const li = document.createElement('li');
    li.draggable = true;
    li.className = [f.id === state.selectedId ? 'selected' : '', f.enabled ? '' : 'disabled'].join(' ');
    const conf = f.confidence != null ? ` · match ${Math.round(f.confidence * 100)}%` : '';
    li.innerHTML = `
      <span class="num">${i + 1}</span>
      <img alt="" src="${f.thumb}">
      <div><div class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
      <div class="meta">${f.width}×${f.height}${conf}</div></div>
      <div class="tools">
        <button class="icon-btn ${f.id === state.refId ? 'on' : ''}" data-act="ref" title="Use as alignment reference">★</button>
        <button class="icon-btn" data-act="toggle" title="${f.enabled ? 'Exclude from print' : 'Include in print'}">${f.enabled ? '◉' : '○'}</button>
        <button class="icon-btn" data-act="remove" title="Remove">✕</button>
      </div>`;
    li.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('button')?.dataset.act;
      if (act === 'ref') state.refId = f.id;
      else if (act === 'toggle') f.enabled = !f.enabled;
      else if (act === 'remove') removeFrame(f.id);
      else state.selectedId = f.id;
      renderFrameList();
      updateLensInfo();
      scheduleRedraw();
    });
    li.addEventListener('dragstart', (e) => {
      dragId = f.id;
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/x-frame', f.id);
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      li.classList.add('drag-over');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.stopPropagation();
      const from = state.frames.findIndex((x) => x.id === dragId);
      const [moved] = state.frames.splice(from, 1);
      const to = state.frames.findIndex((x) => x.id === f.id);
      state.frames.splice(to, 0, moved);
      dragId = null;
      renderFrameList();
      scheduleRedraw();
    });
    li.addEventListener('dragend', () => (dragId = null));
    ol.appendChild(li);
  });
  syncManual();
}

function syncManual() {
  const f = selFrame();
  const fs = $<HTMLFieldSetElement>('manual-align');
  fs.disabled = !f;
  $('sel-name').textContent = f ? `#${state.frames.indexOf(f) + 1}` : '';
  const t = f?.transform ?? NO_TRANSFORM;
  const set = (id: string, v: number, d: number) => {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) el.value = String(+v.toFixed(d));
  };
  set('t-dx', t.dx, 2);
  set('t-dy', t.dy, 2);
  set('t-rot', t.rotation, 3);
  set('t-scale', t.scale, 4);
}

function bindManual() {
  const bind = (id: string, key: keyof FrameTransform) =>
    $<HTMLInputElement>(id).addEventListener('change', (e) => {
      const f = selFrame();
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (!f || !Number.isFinite(v)) return;
      f.transform = { ...f.transform, [key]: key === 'scale' ? Math.max(0.05, v) : v };
      f.confidence = undefined;
      renderFrameList();
      scheduleRedraw();
    });
  bind('t-dx', 'dx');
  bind('t-dy', 'dy');
  bind('t-rot', 'rotation');
  bind('t-scale', 'scale');
}

function nudge(dx: number, dy: number) {
  const f = selFrame();
  if (!f) return;
  f.transform = { ...f.transform, dx: f.transform.dx + dx, dy: f.transform.dy + dy };
  syncManual();
  scheduleRedraw();
}

// ---------------------------------------------------------------------------
// Drawing: preview + align views
// ---------------------------------------------------------------------------

let redrawQueued = false;
function scheduleRedraw() {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    // only visible views are drawn (hidden ones would lay out against a 0-size box)
    if (!$('tab-preview').hidden) drawPreview();
    if (!$('tab-align').hidden) drawAlign();
  });
}

type ViewName = 'preview' | 'align' | 'output';
const views: Record<ViewName, ViewState> = {
  preview: new ViewState(1600),
  align: new ViewState(1600),
  output: new ViewState(3200),
};
const dprNow = () => window.devicePixelRatio || 1;

/** Size the canvas backing store to fill its container (device pixels). */
function fillCanvas(canvas: HTMLCanvasElement) {
  const wrap = canvas.parentElement!;
  const dpr = dprNow();
  const w = Math.max(50, Math.round(wrap.clientWidth * dpr));
  const h = Math.max(50, Math.round(wrap.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { w, h };
}

/** Light drop shadow behind the content rectangle. */
function contentFrame(ctx: CanvasRenderingContext2D, r: Rect, fill: string) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.shadowColor = 'rgba(0,0,0,.45)';
  ctx.shadowBlur = 18 * dprNow();
  ctx.fillStyle = fill;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}

/** The shared zoom controls (tab row) show the zoom of whichever view is open. */
function updateZoomLabels() {
  const name = currentView();
  const el = document.querySelector<HTMLElement>('#zoom-controls .zoom-label');
  if (el && name) el.textContent = `${Math.round(views[name].percent(dprNow()))}%`;
}

function previewMatrix(f: Frame, out: { w: number; h: number }): Affine {
  const ref = refFrame()!;
  return frameMatrix(out, { w: ref.width, h: ref.height }, { w: f.width, h: f.height }, f.transform, framing(S()));
}

let viewT = 0.5;
function drawPreview() {
  const canvas = $<HTMLCanvasElement>('preview-canvas');
  const s = S();
  const { w, h } = fillCanvas(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const out = outputPixels(s);
  const r = views.preview.layout(out.w, out.h, w, h);
  contentFrame(ctx, r, s.background);
  updateZoomLabels();
  const frames = activeFrames();
  if (!frames.length) {
    ctx.fillStyle = '#888';
    ctx.font = `${Math.round(Math.min(r.h, r.w / 1.5) / 18)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText('Drop images here', r.x + r.w / 2, r.y + r.h / 2);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const ordered = s.reverse ? [...frames].reverse() : frames;
  const pos = viewT * (ordered.length - 1);
  const i0 = Math.floor(pos), i1 = Math.min(ordered.length - 1, i0 + 1);
  const t = $<HTMLInputElement>('preview-blend').checked ? pos - i0 : 0;
  const draw = (f: Frame, alpha: number, op: GlobalCompositeOperation = 'source-over') => {
    const m = previewMatrix(f, out);
    // canvas px ← print px ← frame px
    ctx.setTransform(...compose([1, 0, 0, 1, r.x, r.y], scale(r.s), invert(m)));
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.bitmap, 0, 0);
  };
  const pmode = $<HTMLSelectElement>('preview-mode').value;
  // comparison overlays: frame at the current view angle vs the reference frame (★)
  const cur = ordered[Math.round(pos)];
  const ref = refFrame() ?? ordered[0];
  if (pmode === 'onion' || pmode === 'difference' || pmode === 'flicker') {
    if (pmode === 'flicker') draw(flickerOn ? cur : ref, 1);
    else {
      draw(ref, 1);
      draw(cur, pmode === 'onion' ? 0.5 : 1, pmode === 'difference' ? 'difference' : 'source-over');
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  } else if (s.mode === '3d' && pmode === 'anaglyph' && ordered.length > 1) {
    // left eye sees an earlier frame than the right eye; spacing ≈ a quarter of the sequence
    const sep = Math.max(1, Math.round((ordered.length - 1) / 4));
    const li = Math.min(Math.max(0, Math.round(pos - sep / 2)), ordered.length - 1 - sep);
    const eye = (f: Frame, color: string) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d')!;
      x.fillStyle = s.background;
      x.fillRect(r.x, r.y, r.w, r.h);
      x.setTransform(...compose([1, 0, 0, 1, r.x, r.y], scale(r.s), invert(previewMatrix(f, out))));
      x.imageSmoothingQuality = 'high';
      x.drawImage(f.bitmap, 0, 0);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = color;
      x.fillRect(0, 0, w, h);
      return c;
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(eye(ordered[li], '#ff0000'), 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(eye(ordered[li + sep], '#00ffff'), 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    draw(ordered[i0], 1);
    if (t > 0.001) draw(ordered[i1], t);
  }
  ctx.restore();
}

let flickerOn = false;
let pickingKey = false;
function alignViewMatrix(f: Frame, r: Rect): Affine {
  // canvas ← ref ← frame  :  canvas = T(r) · s · A⁻¹ · B⁻¹
  const ref = refFrame()!;
  const R = { w: ref.width, h: ref.height };
  return compose([1, 0, 0, 1, r.x, r.y], scale(r.s), invert(alignMap(R, f.transform)), invert(baseMap(R, { w: f.width, h: f.height })));
}

function drawAlign() {
  const canvas = $<HTMLCanvasElement>('align-canvas');
  const ref = refFrame();
  const ctx = canvas.getContext('2d')!;
  const { w, h } = fillCanvas(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, w, h);
  if (!ref) {
    updateZoomLabels();
    return;
  }
  const r = views.align.layout(ref.width, ref.height, w, h);
  updateZoomLabels();
  contentFrame(ctx, r, '#000');
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  const sel = selFrame() ?? ref;
  const mode = $<HTMLSelectElement>('overlay-mode').value;
  const opacity = +$<HTMLInputElement>('overlay-opacity').value;
  const draw = (f: Frame, alpha = 1, op: GlobalCompositeOperation = 'source-over') => {
    ctx.setTransform(...alignViewMatrix(f, r));
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.drawImage(f.bitmap, 0, 0);
  };
  if (mode === 'frame') draw(sel);
  else if (mode === 'flicker') draw(flickerOn ? sel : ref);
  else if (mode === 'difference') { draw(ref); draw(sel, 1, 'difference'); }
  else if (mode === 'anaglyph') {
    // red from reference, cyan from selected
    const tmp = (f: Frame, color: string) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const x = c.getContext('2d')!;
      x.setTransform(...alignViewMatrix(f, r));
      x.drawImage(f.bitmap, 0, 0);
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'multiply';
      x.fillStyle = color;
      x.fillRect(0, 0, w, h);
      return c;
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(tmp(ref, '#ff0000'), 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(tmp(sel, '#00ffff'), 0, 0);
  } else { draw(ref); draw(sel, opacity); }
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const X = (x: number) => r.x + x * r.s, Y = (y: number) => r.y + y * r.s;

  const dpr = window.devicePixelRatio || 1;
  if ($<HTMLInputElement>('show-crop').checked) {
    // print area in reference coords
    const s = S();
    const out = { w: s.widthIn, h: s.heightIn };
    const m = outputMap(out, { w: ref.width, h: ref.height }, framing(s));
    const pts = [[0, 0], [out.w, 0], [out.w, out.h], [0, out.h]].map(([x, y]) => apply(m, x, y));
    ctx.strokeStyle = '#ffd84a';
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (state.keyPoint && S().alignMode === 'keypoint') {
    const x = X(state.keyPoint.x), y = Y(state.keyPoint.y), rad = 14 * dpr;
    ctx.strokeStyle = '#4af2ff';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.moveTo(x - rad * 1.6, y); ctx.lineTo(x + rad * 1.6, y);
    ctx.moveTo(x, y - rad * 1.6); ctx.lineTo(x, y + rad * 1.6);
    ctx.stroke();
  }
}

function bindViews() {
  const pc = $<HTMLCanvasElement>('preview-canvas');
  pc.addEventListener('pointermove', (e) => {
    if (playing || panning) return;
    const r = pc.getBoundingClientRect();
    viewT = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    $<HTMLInputElement>('view').value = String(viewT);
    scheduleRedraw();
  });
  $('view').addEventListener('input', (e) => {
    viewT = +(e.target as HTMLInputElement).value;
    scheduleRedraw();
  });
  $('preview-blend').addEventListener('change', scheduleRedraw);
  $('preview-mode').addEventListener('change', scheduleRedraw);
  $('btn-play').addEventListener('click', togglePlay);

  for (const id of ['overlay-mode', 'overlay-opacity', 'show-crop']) $(id).addEventListener('input', scheduleRedraw);

  setInterval(() => {
    const alignFlicker = $<HTMLSelectElement>('overlay-mode').value === 'flicker' && !$('tab-align').hidden;
    const previewFlicker = $<HTMLSelectElement>('preview-mode').value === 'flicker' && !$('tab-preview').hidden;
    if (alignFlicker || previewFlicker) {
      flickerOn = !flickerOn;
      if (alignFlicker) drawAlign();
      else drawPreview();
    }
  }, 350);

  const ac = $<HTMLCanvasElement>('align-canvas');
  let drag: { x: number; y: number; t: FrameTransform } | null = null;
  const toRef = (e: PointerEvent) => {
    const b = ac.getBoundingClientRect();
    return views.align.toContent((e.clientX - b.left) * dprNow(), (e.clientY - b.top) * dprNow()) ?? { x: 0, y: 0 };
  };
  ac.addEventListener('pointerdown', (e) => {
    const ref = refFrame();
    if (!ref || isPanGesture(e, 'align')) return;
    if (pickingKey) {
      state.keyPoint = toRef(e);
      setPicking(false);
      status('Key point set. Click Auto-align to line every frame up on it.');
      scheduleRedraw();
      return;
    }
    const f = selFrame();
    if (!f) return;
    ac.setPointerCapture(e.pointerId);
    ac.classList.add('dragging');
    const p = toRef(e);
    drag = { x: p.x, y: p.y, t: { ...f.transform } };
  });
  ac.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const f = selFrame();
    if (!f) return;
    const p = toRef(e);
    // moving the picture right means sampling further left: dx decreases
    f.transform = { ...drag.t, dx: drag.t.dx - (p.x - drag.x), dy: drag.t.dy - (p.y - drag.y) };
    f.confidence = undefined;
    syncManual();
    scheduleRedraw();
  });
  const end = () => {
    if (drag) renderFrameList();
    drag = null;
    ac.classList.remove('dragging');
  };
  ac.addEventListener('pointerup', end);
  ac.addEventListener('pointercancel', end);

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if ($('tab-align').hidden) return;
    const k = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [k, 0], ArrowRight: [-k, 0], ArrowUp: [0, k], ArrowDown: [0, -k],
    };
    if (map[e.key]) {
      e.preventDefault();
      nudge(...map[e.key]);
    } else if (e.key === '[' || e.key === ']') {
      const i = state.frames.findIndex((f) => f.id === state.selectedId);
      const n = state.frames[i + (e.key === ']' ? 1 : -1)];
      if (n) { state.selectedId = n.id; renderFrameList(); scheduleRedraw(); }
    }
  });
  window.addEventListener('resize', () => { scheduleRedraw(); if (!$('tab-output').hidden) drawOutput(); });
}

// ---------------------------------------------------------------------------
// Zoom & pan (buttons, mouse wheel / trackpad pinch, keyboard, drag)
// ---------------------------------------------------------------------------

let panning = false;
let spaceDown = false;
const canvasOf: Record<ViewName, string> = { preview: 'preview-canvas', align: 'align-canvas', output: 'output-canvas' };

function currentView(): ViewName | null {
  for (const n of ['preview', 'align', 'output'] as ViewName[]) if (!$(`tab-${n}`).hidden) return n;
  return null;
}

function redrawView(name: ViewName) {
  if (name === 'output') drawOutput();
  else scheduleRedraw();
}

/** Middle button, Space+drag, or (outside Align, when zoomed in) a left-drag pans the view. */
function isPanGesture(e: PointerEvent, name: ViewName) {
  return e.button === 1 || spaceDown || (name !== 'align' && e.button === 0 && views[name].zoom > 1.001);
}

const drawNow: Record<ViewName, () => void> = { preview: () => drawPreview(), align: () => drawAlign(), output: () => drawOutput() };

function zoomCommand(name: ViewName, cmd: string) {
  const v = views[name];
  drawNow[name](); // refresh layout so zoom math uses the current viewport
  if (cmd === 'in') v.zoomCentered(1.25, dprNow());
  else if (cmd === 'out') v.zoomCentered(1 / 1.25, dprNow());
  else if (cmd === 'fit') v.fit();
  else if (cmd === 'actual') v.actual(dprNow());
  redrawView(name);
}

function bindZoom() {
  $('zoom-controls').addEventListener('click', (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLElement>('[data-z]')?.dataset.z;
    const name = currentView();
    if (cmd && name) zoomCommand(name, cmd);
  });

  for (const name of Object.keys(canvasOf) as ViewName[]) {
    const canvas = $<HTMLCanvasElement>(canvasOf[name]);
    // wheel / trackpad: zoom around the cursor
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const b = canvas.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const k = e.ctrlKey ? 0.01 : 0.0015; // pinch gestures arrive as ctrl+wheel with small deltas
      const factor = Math.exp(-e.deltaY * unit * k);
      views[name].zoomAt(factor, (e.clientX - b.left) * dprNow(), (e.clientY - b.top) * dprNow(), dprNow());
      redrawView(name);
    }, { passive: false });
    canvas.addEventListener('dblclick', () => {
      if (name !== 'align' || spaceDown) zoomCommand(name, views[name].zoom === 1 ? 'actual' : 'fit');
    });
    // drag to pan
    let last: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!isPanGesture(e, name) || (name === 'align' && pickingKey)) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
      panning = true;
      canvas.classList.add('panning');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!last) return;
      views[name].panX += (e.clientX - last.x) * dprNow();
      views[name].panY += (e.clientY - last.y) * dprNow();
      last = { x: e.clientX, y: e.clientY };
      redrawView(name);
    });
    const end = () => {
      last = null;
      panning = false;
      canvas.classList.remove('panning');
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('auxclick', (e) => e.preventDefault());
  }

  const typing = (e: KeyboardEvent) => ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName);
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (e.code === 'Space') {
      if (!spaceDown) document.body.classList.add('space-pan');
      spaceDown = true;
      e.preventDefault();
      return;
    }
    const name = currentView();
    if (!name || e.metaKey || e.ctrlKey || e.altKey) return;
    const cmd = { '+': 'in', '=': 'in', '-': 'out', '_': 'out', '0': 'fit', '1': 'actual' }[e.key];
    if (cmd) { e.preventDefault(); zoomCommand(name, cmd); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { spaceDown = false; document.body.classList.remove('space-pan'); }
  });
  window.addEventListener('blur', () => { spaceDown = false; document.body.classList.remove('space-pan'); });
}

let playing = false;
let playRaf = 0;
function togglePlay() {
  playing = !playing;
  $('btn-play').textContent = playing ? '❚❚ Pause' : '▶ Play';
  const t0 = performance.now();
  const start = viewT;
  const step = (now: number) => {
    if (!playing) return;
    // ping-pong, ~2.4 s per sweep
    const ph = ((now - t0) / 2400 + Math.asin(2 * start - 1) / Math.PI + 0.5) % 2;
    viewT = 0.5 - 0.5 * Math.cos(ph * Math.PI);
    $<HTMLInputElement>('view').value = String(viewT);
    drawPreview();
    playRaf = requestAnimationFrame(step);
  };
  cancelAnimationFrame(playRaf);
  if (playing) playRaf = requestAnimationFrame(step);
}

function setPicking(on: boolean) {
  pickingKey = on;
  $('btn-pick-key').setAttribute('aria-pressed', String(on));
  $('align-canvas').classList.toggle('picking', on);
  if (on) {
    showTab('align');
    status('Click the key subject in the reference frame.');
  }
}

// ---------------------------------------------------------------------------
// Auto-align
// ---------------------------------------------------------------------------

const ANALYSIS_MAX = 768;

function analysisGray(f: Frame, ref: Frame, aw: number, ah: number) {
  const c = document.createElement('canvas');
  c.width = aw;
  c.height = ah;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const sa = aw / ref.width;
  // analysis ← ref ← frame (base mapping only, no alignment)
  ctx.setTransform(...compose(scale(sa), invert(baseMap({ w: ref.width, h: ref.height }, { w: f.width, h: f.height }))));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f.bitmap, 0, 0);
  const id = ctx.getImageData(0, 0, aw, ah);
  return rgbaToGray(id.data, aw, ah);
}

async function autoAlign() {
  const ref = refFrame();
  if (!ref || state.frames.length < 2) return status('Import at least two images first.', 'error');
  const mode = S().alignMode;
  if (mode === 'keypoint' && !state.keyPoint) {
    setPicking(true);
    return;
  }
  setBusy(true);
  progress(0);
  status('Aligning frames…', 'info', 30000);
  try {
    const sa = Math.min(1, ANALYSIS_MAX / Math.max(ref.width, ref.height));
    const aw = Math.max(16, Math.round(ref.width * sa));
    const ah = Math.max(16, Math.round(ref.height * sa));
    const fa = aw / ref.width;
    const refGray = analysisGray(ref, ref, aw, ah);
    // align outward from the reference so each frame starts from its neighbour's result
    const ri = state.frames.indexOf(ref);
    const order: { index: number; initFrom: number | null }[] = [];
    for (let i = ri + 1; i < state.frames.length; i++) order.push({ index: i, initFrom: i - 1 === ri ? null : i - 1 });
    for (let i = ri - 1; i >= 0; i--) order.push({ index: i, initFrom: i + 1 === ri ? null : i + 1 });
    const items = order.map((o) => ({ ...o, gray: analysisGray(state.frames[o.index], ref, aw, ah) }));
    const key = state.keyPoint ? { x: state.keyPoint.x * fa - 0.5, y: state.keyPoint.y * fa - 0.5 } : undefined;
    const res = await worker.request<Extract<WorkerResponse, { type: 'aligned' }>>(
      (reqId) => ({ type: 'align', reqId, ref: refGray, items, mode, key }),
      [],
      (d, t) => progress(d / t),
    );
    ref.transform = { ...NO_TRANSFORM };
    ref.confidence = 1;
    let low = 0;
    for (const { index, result: r } of res.results) {
      const p = similarityToParams(r);
      const f = state.frames[index];
      f.transform = { dx: p.dx / fa, dy: p.dy / fa, rotation: p.rotation, scale: p.scale };
      f.confidence = r.confidence;
      if (r.confidence < 0.35) low++;
    }
    status(
      low
        ? `Aligned, but ${low} frame(s) matched poorly – check them in the Align tab.`
        : `Aligned ${res.results.length} frame(s) to #${ri + 1}.`,
      low ? 'error' : 'info',
      6000,
    );
  } catch (e) {
    status(`Alignment failed: ${(e as Error).message}`, 'error', 8000);
  } finally {
    setBusy(false);
    progress(null);
    renderFrameList();
    scheduleRedraw();
  }
}

// ---------------------------------------------------------------------------
// Render / patterns / export
// ---------------------------------------------------------------------------

async function runRender(
  frames: FrameRef[],
  matrices: Affine[],
  title: string,
  fileBase: string,
  overrides: Partial<Settings> = {},
) {
  const s = { ...S(), ...overrides };
  const { w, h } = outputPixels(s);
  if (w * h > 400e6) throw new Error(`Output of ${w}×${h} px is too large. Lower the DPI or size.`);
  setBusy(true);
  progress(0);
  status(`Rendering ${w}×${h}…`, 'info', 60000);
  const t0 = performance.now();
  try {
    const res = await worker.request<Extract<WorkerResponse, { type: 'rendered' }>>(
      (reqId) => ({
        type: 'render', reqId, width: w, height: h, orientation: s.orientation,
        lens: { lpi: s.lpi, dpi: s.dpi, frames: frames.length, phase: s.phase, reverse: s.reverse, sampling: s.sampling },
        frames, matrices, background: hexToRgb(s.background),
        page: { margin: s.marginIn * s.dpi, alignBars: s.alignBars, cropMarks: s.cropMarks },
      }),
      [],
      (d, t) => progress(d / t),
    );
    const rgba = new Uint8ClampedArray(res.data);
    const canvas = document.createElement('canvas');
    canvas.width = res.width;
    canvas.height = res.height;
    canvas.getContext('2d')!.putImageData(new ImageData(rgba, res.width, res.height), 0, 0);
    setResult({ canvas, rgba, width: res.width, height: res.height, dpi: s.dpi, title, fileBase });
    status(`Rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
  } finally {
    setBusy(false);
    progress(null);
  }
}

async function renderPrint() {
  const frames = activeFrames();
  if (frames.length < 2) return status('Need at least two enabled frames.', 'error');
  const ref = refFrame()!;
  const out = outputPixels(S());
  const matrices = frames.map((f) => {
    // map into the worker's (possibly downscaled) pixel copy
    const ws = workerSizes.get(f.id)!;
    const m = frameMatrix(out, { w: ref.width, h: ref.height }, { w: f.width, h: f.height }, f.transform, framing(S()));
    return compose(scale(ws.w / f.width, ws.h / f.height), m);
  });
  const s = S();
  try {
    await runRender(
      frames.map((f) => ({ id: f.id })), matrices,
      `Interlaced · ${frames.length} frames · ${s.lpi} LPI · ${s.dpi} DPI`,
      `lenticular_${s.lpi}lpi_${s.dpi}dpi`,
    );
    showTab('output');
  } catch (e) {
    status(`Render failed: ${(e as Error).message}`, 'error', 8000);
  }
}

function patternToCanvas(p: Pattern): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.image.width;
  c.height = p.image.height;
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(p.image.data as Uint8ClampedArray<ArrayBuffer>, p.image.width, p.image.height), 0, 0);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';
  for (const l of p.labels) {
    ctx.save();
    ctx.font = `600 ${Math.round(l.size)}px system-ui, sans-serif`;
    ctx.textAlign = l.align === 'center' ? 'center' : 'left';
    ctx.translate(l.x, l.y);
    if (l.rotate) ctx.rotate(Math.PI / 2);
    ctx.fillText(l.text, 0, 0);
    ctx.restore();
  }
  return c;
}

async function generatePattern() {
  const s = S();
  const type = $<HTMLSelectElement>('pattern-type').value;
  const { w, h } = outputPixels(s);
  try {
    if (type === 'pitch' || type === 'ruler') {
      if (w * h > 200e6) throw new Error('Pattern too large; lower DPI or size.');
      const range = Math.max(0.01, parseFloat($<HTMLInputElement>('pt-range').value) || 1);
      const step = Math.max(0.005, parseFloat($<HTMLInputElement>('pt-step').value) || 0.1);
      if ((2 * range) / step > 200) throw new Error('Too many bands: increase the step or reduce the range.');
      setBusy(true);
      status('Generating…');
      await new Promise((r) => setTimeout(r, 30));
      const p = type === 'pitch'
        ? pitchTest({ dpi: s.dpi, lpi: s.lpi, range, step, widthPx: w, heightPx: h, orientation: s.orientation })
        : lensRuler({ dpi: s.dpi, lpi: s.lpi, widthPx: w, heightPx: h, orientation: s.orientation });
      const canvas = patternToCanvas(p);
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
      setResult({
        canvas, rgba, width: w, height: h, dpi: s.dpi,
        title: type === 'pitch' ? `Pitch test ${s.lpi - range}–${s.lpi + range} LPI (step ${step})` : `Lens ruler ${s.lpi} LPI`,
        fileBase: type === 'pitch' ? `pitch_test_${s.lpi}lpi_${s.dpi}dpi` : `lens_ruler_${s.lpi}lpi_${s.dpi}dpi`,
      });
      setBusy(false);
    } else {
      const n = Math.max(2, Math.min(64, parseInt($<HTMLInputElement>('ft-count').value) || 6));
      // small synthetic frames: coloured field, big number, and an arrow that points to the frame's position
      const fw = 600, fh = Math.round((600 * h) / w) || 400;
      const frames: FrameRef[] = [];
      for (let i = 0; i < n; i++) {
        const c = document.createElement('canvas');
        c.width = fw; c.height = fh;
        const x = c.getContext('2d')!;
        const [r, g, b] = frameColor(i, n);
        x.fillStyle = `rgb(${r},${g},${b})`;
        x.fillRect(0, 0, fw, fh);
        x.fillStyle = '#fff';
        x.font = `700 ${Math.round(fh * 0.5)}px system-ui, sans-serif`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(String(i + 1), fw / 2, fh * 0.45);
        x.font = `600 ${Math.round(fh * 0.08)}px system-ui, sans-serif`;
        x.fillText(`frame ${i + 1} of ${n}`, fw / 2, fh * 0.85);
        // position marker bar
        x.fillRect((i / n) * fw, fh * 0.94, fw / n, fh * 0.06);
        const id = x.getImageData(0, 0, fw, fh);
        frames.push({ width: fw, height: fh, data: id.data });
      }
      const out = outputPixels(s);
      const m = frameMatrix(out, { w: fw, h: fh }, { w: fw, h: fh }, NO_TRANSFORM, { fit: 'cover', zoom: 1, panX: 0, panY: 0 });
      await runRender(frames, frames.map(() => m), `Frame order test · ${n} frames · ${s.lpi} LPI`, `frame_test_${n}f_${s.lpi}lpi`);
    }
    showTab('output');
  } catch (e) {
    setBusy(false);
    status((e as Error).message, 'error', 6000);
  }
}

function setResult(r: RenderResult) {
  result = r;
  ($('btn-print') as HTMLButtonElement).disabled = false;
  updateExportButtons();
  $('output-title').textContent =
    `${r.title} — ${r.width}×${r.height} px = ${(r.width / r.dpi).toFixed(3)}×${(r.height / r.dpi).toFixed(3)} in`;
  drawOutput();
}

function drawOutput() {
  const c = $<HTMLCanvasElement>('output-canvas');
  const { w, h } = fillCanvas(c);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!result) {
    updateZoomLabels();
    return;
  }
  const r = views.output.layout(result.width, result.height, w, h);
  updateZoomLabels();
  contentFrame(ctx, r, '#fff');
  // show individual print dots crisply once they are bigger than a screen pixel
  ctx.imageSmoothingEnabled = r.s < 1;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(result.canvas, r.x, r.y, r.w, r.h);
}

/** Tilt preview at an arbitrary size (for GIF / video export). */
const drawTilt: DrawFn = (ctx, W, H, t) => {
  const s = S();
  const ordered = s.reverse ? [...activeFrames()].reverse() : activeFrames();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.background;
  ctx.fillRect(0, 0, W, H);
  if (!ordered.length) return;
  const out = outputPixels(s);
  const pos = t * (ordered.length - 1);
  const i0 = Math.floor(pos), i1 = Math.min(ordered.length - 1, i0 + 1);
  const frac = $<HTMLInputElement>('preview-blend').checked ? pos - i0 : 0;
  const draw = (f: Frame, alpha: number) => {
    ctx.setTransform(...compose(scale(W / out.w, H / out.h), invert(previewMatrix(f, out))));
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.bitmap, 0, 0);
  };
  draw(ordered[i0], 1);
  if (frac > 0.001) draw(ordered[i1], frac);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
};

async function exportAnimation(kind: 'gif' | 'video') {
  const frames = activeFrames();
  if (frames.length < 2) return status('Need at least two frames.', 'error');
  const s = S();
  // GIFs get smaller and use fewer in-between steps to keep files reasonable
  const { w, h } = animSize(s.widthIn / s.heightIn, kind === 'gif' ? 600 : 1280);
  const positions = sweepPositions(frames.length, kind === 'gif' ? 3 : 4);
  const fps = 25;
  const base = `lenticular_preview_${frames.length}f`;
  setBusy(true);
  progress(0);
  status(kind === 'gif' ? 'Encoding GIF…' : 'Recording video…', 'info', 120000);
  try {
    if (kind === 'gif') {
      const blob = await encodeGif(drawTilt, w, h, positions, fps, progress);
      await download(blob, `${base}.gif`);
      status(`Saved ${(blob.size / 1e6).toFixed(1)} MB GIF (${w}×${h}).`);
    } else {
      const { blob, ext } = await recordVideo(drawTilt, w, h, positions, fps, 2, progress);
      await download(blob, `${base}.${ext}`);
      status(`Saved ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()} (${w}×${h}).`);
    }
  } finally {
    setBusy(false);
    progress(null);
    updateExportButtons();
  }
}

async function exportResult() {
  const fmt0 = S().exportFormat;
  if (fmt0 === 'gif' || fmt0 === 'video') {
    try { await exportAnimation(fmt0); } catch (e) { status(`Export failed: ${(e as Error).message}`, 'error', 8000); }
    return;
  }
  if (!result) return;
  try {
    status('Encoding…', 'info', 30000);
    const fmt = S().exportFormat;
    const ext = fmt === 'tiff' ? 'tif' : fmt;
    let blob = fmt === 'tiff' ? toTiff(result) : fmt === 'jpg' ? await toJpeg(result) : await toPng(result);
    let name = `${result.fileBase}.${ext}`;
    if (fmt === 'tiff' && inArtifactHost()) {
      // the artifact viewer can't save .tif files directly, so deliver it inside a zip
      blob = new Blob([zipStore(name, new Uint8Array(await blob.arrayBuffer())) as BlobPart], { type: 'application/zip' });
      name += '.zip';
    }
    await download(blob, name);
    status(`Saved ${(blob.size / 1e6).toFixed(1)} MB ${ext.toUpperCase()} at ${result.dpi} DPI.`);
  } catch (e) {
    status(`Export failed: ${(e as Error).message}`, 'error', 8000);
  }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

interface ProjectFile {
  app: 'lenticulator';
  version: 1;
  settings: Settings;
  refIndex: number;
  keyPoint: AppState['keyPoint'];
  frames: { name: string; type: string; data: string; transform: FrameTransform; enabled: boolean }[];
}

async function saveProject() {
  if (!state.frames.length) return status('Nothing to save yet.', 'error');
  status('Saving project…', 'info', 30000);
  const proj: ProjectFile = {
    app: 'lenticulator',
    version: 1,
    settings: S(),
    refIndex: Math.max(0, state.frames.findIndex((f) => f.id === state.refId)),
    keyPoint: state.keyPoint,
    frames: await Promise.all(
      state.frames.map(async (f) => ({
        name: f.name, type: f.blob.type || 'image/jpeg', data: await blobToBase64(f.blob),
        transform: f.transform, enabled: f.enabled,
      })),
    ),
  };
  try {
    await download(new Blob([JSON.stringify(proj)], { type: 'application/json' }), 'project.lenti.json');
    status('Project saved.');
  } catch (e) {
    status(`Could not save project: ${(e as Error).message}`, 'error', 6000);
  }
}

async function openProject(file: File) {
  try {
    const proj = JSON.parse(await file.text()) as ProjectFile;
    if (proj.app !== 'lenticulator') throw new Error('Not a Lenticulator project');
    for (const f of [...state.frames]) removeFrame(f.id);
    state.settings = { ...loadSettings(), ...proj.settings };
    saveSettings(S());
    for (const f of proj.frames) await addFrame(base64ToBlob(f.data, f.type), f.name, f.transform, f.enabled);
    state.refId = state.frames[proj.refIndex]?.id ?? state.frames[0]?.id ?? null;
    state.selectedId = state.refId;
    state.keyPoint = proj.keyPoint;
    syncForm();
    renderFrameList();
    scheduleRedraw();
    status(`Opened project with ${proj.frames.length} frames.`);
  } catch (e) {
    status(`Could not open project: ${(e as Error).message}`, 'error', 6000);
  }
}

// ---------------------------------------------------------------------------
// Tabs, drag & drop, buttons
// ---------------------------------------------------------------------------

function showTab(name: string) {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
    b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  for (const t of ['preview', 'align', 'output']) $(`tab-${t}`).hidden = t !== name;
  if (name === 'output') drawOutput();
  else scheduleRedraw();
}

function bindChrome() {
  document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
    b.addEventListener('click', () => showTab(b.dataset.tab!)));
  $<HTMLInputElement>('file-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const files = [...(input.files ?? [])].filter(isImageFile).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    importFiles(files).finally(() => (input.value = ''));
  });
  $<HTMLInputElement>('project-input').addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) openProject(input.files[0]).finally(() => (input.value = ''));
  });
  $('btn-save-project').addEventListener('click', saveProject);
  $('btn-import').addEventListener('click', () => $<HTMLInputElement>('file-input').click());
  $('btn-open-project').addEventListener('click', () => $<HTMLInputElement>('project-input').click());
  $('btn-reverse-order').addEventListener('click', () => {
    state.frames.reverse();
    renderFrameList();
    scheduleRedraw();
  });
  // two-step confirm inside the page (dialogs are unavailable in some hosts)
  let clearArmed = 0;
  $('btn-clear').addEventListener('click', () => {
    const btn = $('btn-clear');
    if (!state.frames.length) return;
    if (!clearArmed) {
      btn.textContent = 'Click again to remove all';
      clearArmed = window.setTimeout(() => { clearArmed = 0; btn.textContent = 'Remove all'; }, 3000);
      return;
    }
    clearTimeout(clearArmed);
    clearArmed = 0;
    btn.textContent = 'Remove all';
    for (const f of [...state.frames]) removeFrame(f.id);
    state.keyPoint = null;
    renderFrameList();
    updateLensInfo();
    scheduleRedraw();
  });
  $('btn-auto-align').addEventListener('click', () => !busy && autoAlign());
  $('btn-pick-key').addEventListener('click', () => setPicking(!pickingKey));
  $('btn-reset-align').addEventListener('click', () => {
    for (const f of state.frames) { f.transform = { ...NO_TRANSFORM }; f.confidence = undefined; }
    renderFrameList();
    scheduleRedraw();
  });
  $('btn-render').addEventListener('click', () => !busy && renderPrint());
  $('btn-pattern').addEventListener('click', () => !busy && generatePattern());
  $('btn-download').addEventListener('click', exportResult);
  $('btn-print').addEventListener('click', () => result && printResult(result).catch((e) => status(e.message, 'error')));
  const pt = $<HTMLSelectElement>('pattern-type');
  const syncPattern = () => {
    $('pitch-opts').hidden = pt.value !== 'pitch';
    $('frames-opts').hidden = pt.value !== 'frames';
  };
  pt.addEventListener('change', syncPattern);
  syncPattern();

  // drag & drop files anywhere
  let depth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragleave', () => {
    if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); }
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    depth = 0;
    document.body.classList.remove('dragging');
    const dt = e.dataTransfer;
    if (!dt || !dt.types.includes('Files')) return;
    e.preventDefault();
    filesFromDrop(dt)
      .then((files) => {
        if (!files.length) return status('No images found in what was dropped.', 'error');
        return importFiles(files);
      })
      .catch((err) => status(`Could not read the dropped items: ${(err as Error).message}`, 'error', 6000));
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// ---------------------------------------------------------------------------

// Theme: "system" follows the OS (prefers-color-scheme); others override it.
const THEME_KEY = 'lenticulator.theme';
function applyTheme(t: string) {
  document.documentElement.dataset.theme = t;
  $<HTMLSelectElement>('theme').value = t;
}
// default to a theme the host page already set (e.g. an embedding viewer), else follow the OS
let savedTheme = document.documentElement.dataset.theme || 'system';
try { savedTheme = localStorage.getItem(THEME_KEY) || savedTheme; } catch { /* storage unavailable */ }
applyTheme(savedTheme);
$('theme').addEventListener('change', (e) => {
  const t = (e.target as HTMLSelectElement).value;
  applyTheme(t);
  try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
});

if (!videoFormat()) {
  $<HTMLElement>('export-format').querySelector<HTMLElement>('[data-format=video]')!.hidden = true;
  if (S().exportFormat === 'video') S().exportFormat = 'png';
}

if (inArtifactHost()) {
  // the sandboxed viewer can't open print dialogs
  $('btn-print').hidden = true;
}

// Top-bar popup menus
function bindMenu(btnId: string, panelId: string) {
  const btn = $(btnId);
  const panel = $(panelId);
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLElement>('select, input, button')?.focus();
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden !== false); });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && !btn.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); }
  });
  return setOpen;
}
bindMenu('btn-settings', 'settings-panel');
const setSamplesOpen = bindMenu('btn-samples', 'samples-panel');

// Bundled sample sets (public/samples), listed from their manifest
interface Sample { id: string; name: string; mode: Settings['mode']; files: string[] }
let samples: Sample[] = [];
fetch('samples/index.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((m: { samples: Sample[] }) => {
    samples = m.samples;
    const list = $('samples-list');
    const groups: [Settings['mode'], string][] = [['3d', '3D'], ['animation', 'Animation']];
    list.innerHTML = groups.map(([mode, label]) => `
      <section class="menu-section">
        <div class="menu-heading">${label}</div>
        ${samples.filter((x) => x.mode === mode).map((x) =>
          `<button class="menu-item" role="menuitem" data-sample="${x.id}">${escapeHtml(x.name)}<small>${x.files.length}</small></button>`).join('')}
      </section>`).join('');
  })
  .catch((e) => {
    $('samples-list').innerHTML = '<div class="menu-heading">⚠ Samples unavailable</div>';
    status(`Could not load the sample list: ${(e as Error).message}`, 'error', 6000);
  });

$('samples-list').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-sample]')?.dataset.sample;
  const sample = samples.find((x) => x.id === id);
  if (!sample || busy) return;
  setSamplesOpen(false);
  loadSample(sample);
});

async function loadSample(sample: Sample) {
  try {
    status(`Loading ${sample.name}…`, 'info', 20000);
    const blobs = await Promise.all(sample.files.map(async (f) => {
      const r = await fetch(`samples/${sample.id}/${f}`);
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      return r.blob();
    }));
    for (const f of [...state.frames]) removeFrame(f.id);
    state.keyPoint = null;
    if (S().mode !== sample.mode) {
      Object.assign(S(), { mode: sample.mode }, MODE_DEFAULTS[sample.mode]);
      saveSettings(S());
      syncForm();
    }
    await importFiles(blobs, sample.files.map((f) => `${sample.name} ${f.replace(/\.\w+$/, '')}`));
    showTab('preview');
  } catch (e) {
    status(`Could not load ${sample.name}: ${(e as Error).message}`, 'error', 6000);
  }
}

$('app-version').textContent = `v${__APP_VERSION__}`;
document.title = `Lenticulator ${__APP_VERSION__}`;

fillStaticOptions();
bindSettings();
bindManual();
bindViews();
bindZoom();
bindChrome();
syncForm();
renderFrameList();
scheduleRedraw();

// expose for automated tests / debugging
(window as unknown as { lenticulator: unknown }).lenticulator = { state, importFiles, autoAlign, renderPrint, generatePattern };
