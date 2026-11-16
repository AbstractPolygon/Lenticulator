import './styles.css';
import {
  Affine, FrameTransform, NO_TRANSFORM, alignMap, baseMap, compose, cropToCommon, frameMatrix, invert, outputMap, scale, apply,
} from './core/geometry';
import { COMMON_DPI, COMMON_LPI, lensStats } from './core/interlace';
import { similarityToParams } from './core/align';
import { rgbaToGray } from './core/gray';
import { frameColor, lensRuler, pitchTest, Pattern } from './core/patterns';
import {
  AppState, Frame, MODE_DEFAULTS, SIZE_PRESETS, matchPreset, Settings, framing, hexToRgb, loadSettings, outputPixels, saveSettings,
} from './ui/state';
import { base64ToBlob, blobToBase64, decode, filesFromDrop, isImageFile, splitMultiPicture, thumbnail, uid } from './ui/images';
import { decodeSpecial, sniffBlob } from './ui/decoders';
import { Rect, ViewState } from './ui/view';
import type { WorkerResponse } from './worker';
import { RenderResult, download, inArtifactHost, printResult, toJpeg, toPng, toTiff } from './ui/export';
import { zipStore } from './core/fileformats';
import { scanProfiles, splitScan } from './core/split';
import { frameSequence } from './core/timing';
import { estimateFlow, interpolate } from './core/flow';
import { framesForLens, maxDepthPercent } from './core/depth3d';
import { DrawFn, animSize, encodeGif, recordVideo, sweepPositions, videoFormat } from './ui/animation';
import { canvas2d, encodeBitmap, proxyBitmap, rgbaToBitmap } from './ui/canvas';
import { CompareMode, drawCompare, drawTilt as drawTiltFrames } from './ui/draw';
import { PoolFrame, RenderPool, newRenderWorker } from './ui/renderPool';
import { gpuAvailable, renderGpu } from './ui/gpuRender';
import { composePage } from './core/patterns';
import { bindMenu, bindPref } from './ui/menus';
import { initDepthPanel } from './ui/depthPanel';

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
/** worker for alignment and depth views; also the first worker of the render pool */
const worker = newRenderWorker();
const pool = new RenderPool(undefined, worker);
let depthPanel: ReturnType<typeof initDepthPanel> | null = null;

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
  for (const id of ['btn-render', 'btn-pattern', 'btn-depth-estimate', 'btn-depth-load']) ($(id) as HTMLButtonElement).disabled = b;
  updateAlignButtons();
  ($('btn-depth-generate') as HTMLButtonElement).disabled = b || !depthPanel?.hasSource();
  updateExportButtons();
}

// ---------------------------------------------------------------------------
// Settings form binding
// ---------------------------------------------------------------------------

const unitFactor = () => (S().units === 'mm' ? 25.4 : 1);

function fillStaticOptions() {
  const preset = $<HTMLSelectElement>('size-preset');
  const opts = (px: boolean) => SIZE_PRESETS.map((p, i) => (!!p.px === px ? `<option value="${i}">${p.label}</option>` : '')).join('');
  preset.innerHTML = `<option value="">Custom</option><optgroup label="Print">${opts(false)}</optgroup><optgroup label="Social">${opts(true)}</optgroup>`;
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
  $<HTMLInputElement>('autoCrop').checked = s.autoCrop;
  $<HTMLSelectElement>('align-mode').value = s.alignMode;
  document.querySelectorAll<HTMLButtonElement>('#export-format [data-format]').forEach((b) =>
    b.setAttribute('aria-checked', String(b.dataset.format === s.exportFormat)));
  num('gif-fps', s.gifFps, 1);
  $<HTMLSelectElement>('gif-dither').value = s.gifDither;
  $<HTMLSelectElement>('gif-loop').value = s.gifLoop;
  num('gif-hold', s.gifHold, 0);
  // fps, loop and hold apply to GIFs and to frame videos; dithering only to GIFs
  const frameAnim = s.exportFormat === 'gif' || (s.exportFormat === 'video' && s.videoSource === 'frames');
  $('gif-timing').hidden = !frameAnim;
  $('inbetween-row').hidden = !frameAnim;
  num('inbetween', s.inBetween, 0);
  $<HTMLSelectElement>('video-source').value = s.videoSource;
  $('gif-speed').hidden = !(s.exportFormat === 'gif' || (s.exportFormat === 'video' && s.videoSource === 'frames'));
  $('gif-dither').hidden = s.exportFormat !== 'gif';
  num('video-loops', s.videoLoops, 0);
  $('video-loops-row').hidden = s.exportFormat !== 'video';
  $<HTMLSelectElement>('psd-import').value = s.psdLayers ? 'layers' : 'flat';
  if (s.depthAuto) s.depthFrames = framesForLens(s.lpi, s.dpi);
  num('d-frames', s.depthFrames, 0);
  $<HTMLInputElement>('d-frames').disabled = s.depthAuto;
  $<HTMLInputElement>('d-auto').checked = s.depthAuto;
  $<HTMLInputElement>('d-amount').value = String(s.depthAmount);
  $('d-amount-val').textContent = `${s.depthAmount.toFixed(1)}%`;
  // depth budget: more parallax than the lens can show blurs and doubles the 3D print
  const depthMax = maxDepthPercent(s.depthFrames, s.lpi, s.orientation === 'vertical' ? s.widthIn : s.heightIn);
  const warn = $('d-amount-warn');
  warn.hidden = !(s.depthAmount > depthMax + 1e-9);
  warn.textContent = `⚠ max ${depthMax.toFixed(1)}%`;
  warn.title = `More depth than a ${s.lpi} LPI lens shows cleanly with ${s.depthFrames} frames at this print size (about one lens pitch per frame). The 3D print will look blurred or doubled. Lower Depth, or use more frames.`;
  $<HTMLInputElement>('d-focus').value = String(s.depthFocus);
  $<HTMLInputElement>('d-invert').checked = s.depthInvert;
  $('depth-panel').hidden = s.mode !== '3d';
  $<HTMLSelectElement>('tiff-import').value = s.tiffAllPages ? 'all' : 'first';
  const pi = matchPreset(s);
  $<HTMLSelectElement>('size-preset').value = pi >= 0 ? String(pi) : '';
  document.querySelectorAll<HTMLButtonElement>('#effect-mode [data-mode]').forEach((b) =>
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
  document.querySelectorAll<HTMLButtonElement>('#effect-mode [data-mode]').forEach((b) =>
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
    // social sizes: exactly that many pixels at the current DPI
    if (p.px) {
      S().widthIn = p.w / S().dpi;
      S().heightIn = p.h / S().dpi;
      return;
    }
    // keep current orientation (portrait/landscape)
    const portrait = S().heightIn > S().widthIn;
    S().widthIn = portrait ? Math.min(p.w, p.h) : Math.max(p.w, p.h);
    S().heightIn = portrait ? Math.max(p.w, p.h) : Math.min(p.w, p.h);
  });
  on('width', 'change', (el) => (S().widthIn = pos(el.value, S().widthIn * unitFactor()) / unitFactor()));
  on('height', 'change', (el) => (S().heightIn = pos(el.value, S().heightIn * unitFactor()) / unitFactor()));
  on('units', 'change', (el) => (S().units = el.value as Settings['units']));
  on('dpi', 'change', (el) => {
    const social = SIZE_PRESETS[matchPreset(S())];
    S().dpi = Math.min(4800, pos(el.value, S().dpi));
    if (social?.px) Object.assign(S(), { widthIn: social.w / S().dpi, heightIn: social.h / S().dpi }); // keep its pixels
  });
  on('lpi', 'change', (el) => (S().lpi = pos(el.value, S().lpi)));
  on('orientation', 'change', (el) => (S().orientation = el.value as Settings['orientation']));
  on('sampling', 'change', (el) => (S().sampling = el.value as Settings['sampling']));
  on('reverse', 'change', (el) => (S().reverse = el.checked));
  on('phase', 'input', (el) => (S().phase = +el.value));
  on('fit', 'change', (el) => (S().fit = el.value as Settings['fit']));
  on('autoCrop', 'change', (el) => (S().autoCrop = el.checked));
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
    showAnim(!$('tab-output').hidden);
  });
  on('video-loops', 'change', (el) => (S().videoLoops = Math.max(1, Math.min(20, Math.round(+el.value) || 2))));
  on('video-source', 'change', (el) => (S().videoSource = el.value as Settings['videoSource']));
  on('inbetween', 'change', (el) => (S().inBetween = Math.max(0, Math.min(4, Math.round(+el.value) || 0))));
  on('gif-loop', 'change', (el) => (S().gifLoop = el.value as Settings['gifLoop']));
  on('gif-hold', 'change', (el) => (S().gifHold = Math.max(0, Math.min(2000, Math.round(+el.value) || 0))));
  on('gif-dither', 'change', (el) => (S().gifDither = el.value as Settings['gifDither']));
  on('gif-fps', 'change', (el) => (S().gifFps = Math.max(1, Math.min(50, Math.round(+el.value) || 10))));
  on('psd-import', 'change', (el) => (S().psdLayers = el.value === 'layers'));
  on('d-frames', 'change', (el) => (S().depthFrames = Math.max(2, Math.min(48, Math.round(+el.value) || 2))));
  on('d-auto', 'change', (el) => (S().depthAuto = el.checked));
  on('d-amount', 'input', (el) => (S().depthAmount = +el.value));
  on('d-focus', 'input', (el) => { S().depthFocus = +el.value; depthPanel?.drawThumb(); });
  on('d-invert', 'change', (el) => { S().depthInvert = el.checked; depthPanel?.drawThumb(); });
  on('tiff-import', 'change', (el) => (S().tiffAllPages = el.value === 'all'));
}

function activeFrames(): Frame[] {
  return state.frames.filter((f) => f.enabled);
}

/** The last rendered GIF / video, shown in the Output tab; `key` says which frames and settings made it. */
let anim: { kind: 'gif' | 'video'; blob: Blob; name: string; url: string; key: string; w: number; h: number } | null = null;

const isAnimFormat = (f: Settings['exportFormat']) => f === 'gif' || f === 'video';

/** Stills need a rendered print; GIF / video only need frames. */
function updateExportButtons() {
  const fmt = S().exportFormat;
  const animFmt = isAnimFormat(fmt);
  const dl = $('btn-download') as HTMLButtonElement;
  dl.hidden = animFmt ? !(anim && anim.kind === fmt) : !result;
  dl.disabled = busy;
  const pr = $('btn-print') as HTMLButtonElement;
  pr.hidden = animFmt || !result || inArtifactHost();
  pr.disabled = busy;
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
  updateAlignButtons();
}

/** Auto-align is greyed out while busy, and in key-point mode until a key point is picked. */
function updateAlignButtons() {
  const btn = $('btn-auto-align') as HTMLButtonElement;
  const needsKey = S().alignMode === 'keypoint' && !state.keyPoint;
  btn.disabled = busy || needsKey;
  btn.title = needsKey ? 'Pick a key point first' : 'Align all frames to the reference frame (★)';
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
          await addFrame(file, baseName, NO_TRANSFORM, true, await rgbaToBitmap(raws[0].data, raws[0].width, raws[0].height));
          added++;
        } else {
          // pages / layers become separate lossless PNG frames
          for (let p = 0; p < raws.length; p++) {
            const bmp = await rgbaToBitmap(raws[p].data, raws[p].width, raws[p].height);
            await addFrame(await encodeBitmap(bmp, 'image/png'), `${baseName} [${raws[p].name ?? p + 1}]`, NO_TRANSFORM, true, bmp);
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

/** Decode any supported file (used for project reloads, where frames keep their original bytes). */
async function decodeAny(blob: Blob, name: string): Promise<ImageBitmap> {
  const kind = await sniffBlob(blob, name);
  if (!kind) return decode(blob);
  if (kind === 'heic') {
    const native = await decode(blob).catch(() => null);
    if (native) return native;
  }
  const [first] = await decodeSpecial(blob, kind, { psdLayers: false, tiffAllPages: false });
  return rgbaToBitmap(first.data, first.width, first.height);
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
    // small copy for fast on-screen drawing; the render reads the full-resolution bitmap
    preview: await proxyBitmap(bitmap),
    thumb: thumbnail(bitmap),
    transform: { ...transform },
    enabled,
  };
  state.frames.push(frame);
  if (!state.refId) state.refId = frame.id;
  if (!state.selectedId) state.selectedId = frame.id;
  return frame;
}

function removeFrame(id: string) {
  const i = state.frames.findIndex((f) => f.id === id);
  if (i < 0) return;
  state.frames[i].bitmap.close();
  state.frames[i].preview?.close();
  state.frames.splice(i, 1);
  if (state.refId === id) state.refId = state.frames[0]?.id ?? null;
  if (state.selectedId === id) state.selectedId = state.frames[Math.min(i, state.frames.length - 1)]?.id ?? null;
}

/** Replace all frames (used by generated depth views). */
async function replaceFrames(items: { blob: Blob; name: string; bitmap: ImageBitmap; transform?: FrameTransform }[], refIndex: number) {
  for (const f of [...state.frames]) removeFrame(f.id);
  state.keyPoint = null;
  for (const it of items) await addFrame(it.blob, it.name, it.transform ?? NO_TRANSFORM, true, it.bitmap);
  state.refId = state.frames[refIndex]?.id ?? state.frames[0]?.id ?? null;
  state.selectedId = state.refId;
  renderFrameList();
  updateLensInfo();
  scheduleRedraw();
  showTab('preview');
}

/** Split one frame (a film scan with frames side by side) into `count` frames, in its place. */
async function splitFrame(frame: Frame, count: number) {
  // brightness profiles on a reduced copy (fast), mapped back to full resolution
  const k = Math.min(1, 1600 / Math.max(frame.width, frame.height));
  const { c, ctx } = canvas2d(frame.width * k, frame.height * k, true);
  ctx.drawImage(frame.bitmap, 0, 0, c.width, c.height);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const { columns, rows } = scanProfiles(data, c.width, c.height);
  const rects = splitScan(columns, rows, count);
  const at = state.frames.indexOf(frame);
  const wasRef = state.refId === frame.id;
  const made: Frame[] = [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const bmp = await createImageBitmap(frame.bitmap, Math.round(r.x / k), Math.round(r.y / k), Math.round(r.w / k), Math.round(r.h / k));
    const blob = await encodeBitmap(bmp, 'image/png');
    made.push(await addFrame(blob, `${frame.name.replace(/\.\w+$/, '')} ${i + 1}`, NO_TRANSFORM, true, bmp));
  }
  // addFrame appends: move the new frames into the scan's place, then drop the scan
  state.frames.splice(state.frames.length - made.length, made.length);
  state.frames.splice(at + 1, 0, ...made);
  removeFrame(frame.id);
  if (wasRef || !state.frames.some((f) => f.id === state.refId)) state.refId = made[0].id;
  state.selectedId = made[0].id;
  state.keyPoint = null;
  renderFrameList();
  updateLensInfo();
  scheduleRedraw();
  status(`Split into ${made.length} frames (${made[0].width}×${made[0].height}).`);
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
  updateAlignButtons(); // the key point may have been picked or cleared
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
  if (el && name === 'output' && animVisible()) {
    const a = $('anim-view').firstElementChild as HTMLElement;
    const nw = anim?.w;
    if (nw) el.textContent = `${Math.round((a.getBoundingClientRect().width / nw) * 100)}%`;
    return;
  }
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
  // canvas px ← print px ← frame px
  const toCanvas = (f: Frame) => compose([1, 0, 0, 1, r.x, r.y], scale(r.s), invert(previewMatrix(f, out)));
  const pmode = $<HTMLSelectElement>('preview-mode').value;
  if (pmode === 'onion' || pmode === 'difference' || pmode === 'flicker') {
    // frame at the current view angle vs the reference frame (★)
    const ref = refFrame() ?? ordered[0];
    drawCompare(ctx, pmode, ref, ordered[Math.round(pos)], toCanvas, { flickerOn, opacity: 0.5, w, h });
  } else if (s.mode === '3d' && pmode === 'anaglyph' && ordered.length > 1) {
    // left eye sees an earlier frame than the right eye; spacing ≈ a quarter of the sequence
    const sep = Math.max(1, Math.round((ordered.length - 1) / 4));
    const li = Math.min(Math.max(0, Math.round(pos - sep / 2)), ordered.length - 1 - sep);
    drawCompare(ctx, 'anaglyph', ordered[li], ordered[li + sep], toCanvas, { w, h, clip: r, background: s.background });
  } else {
    drawTiltFrames(ctx, ordered, pos, $<HTMLInputElement>('preview-blend').checked, toCanvas);
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
  const mode = $<HTMLSelectElement>('overlay-mode').value as CompareMode;
  const opacity = +$<HTMLInputElement>('overlay-opacity').value;
  drawCompare(ctx, mode, ref, sel, (f: Frame) => alignViewMatrix(f, r), { opacity, flickerOn, w, h });
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
    // dim everything outside the print area (even-odd: the whole view minus the print area)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
    ctx.fill('evenodd');
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
  // tilt only while the primary button is held (click or drag across the preview), not on plain hover
  const tiltTo = (e: PointerEvent) => {
    if (playing || panning) return;
    const r = pc.getBoundingClientRect();
    viewT = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    $<HTMLInputElement>('view').value = String(viewT);
    scheduleRedraw();
  };
  // after the other pointerdown listeners, so a pan that starts with this press wins
  pc.addEventListener('pointerdown', (e) => { if (e.button === 0) queueMicrotask(() => tiltTo(e)); });
  pc.addEventListener('pointermove', (e) => { if (e.buttons & 1) tiltTo(e); });
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
  window.addEventListener('resize', () => { scheduleRedraw(); if (!$('tab-output').hidden) { drawOutput(); layoutAnim(); } });
  // mouse wheel / trackpad pinch zooms the rendered GIF / video too
  $('anim-view').addEventListener('wheel', (e) => { e.preventDefault(); zoomAnim(e.deltaY < 0 ? 'in' : 'out'); }, { passive: false });
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
    if (cmd && name === 'output' && animVisible()) zoomAnim(cmd);
    else if (cmd && name) zoomCommand(name, cmd);
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
    if (cmd) { e.preventDefault(); if (name === 'output' && animVisible()) zoomAnim(cmd); else zoomCommand(name, cmd); }
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
  const { ctx } = canvas2d(aw, ah, true);
  const sa = aw / ref.width;
  // analysis ← ref ← frame (base mapping only, no alignment)
  ctx.setTransform(...compose(scale(sa), invert(baseMap({ w: ref.width, h: ref.height }, { w: f.width, h: f.height }))));
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(f.bitmap, 0, 0);
  const id = ctx.getImageData(0, 0, aw, ah);
  return rgbaToGray(id.data, aw, ah);
}

/** Frame the print on the area every enabled frame covers (no blank edges). */
function cropToOverlap(quiet = false) {
  const ref = refFrame();
  const frames = activeFrames();
  if (!ref || frames.length < 2) { if (!quiet) status('Import at least two images first.', 'error'); return; }
  const s = S();
  const f = cropToCommon({ w: s.widthIn, h: s.heightIn }, { w: ref.width, h: ref.height },
    frames.map((fr) => ({ size: { w: fr.width, h: fr.height }, t: fr.transform })));
  if (!f) { status('The frames don\'t overlap enough to crop.', 'error'); return; }
  Object.assign(s, f);
  saveSettings(s);
  syncForm();
  scheduleRedraw();
  if (!quiet) status(`Cropped to the overlap (${Math.round(f.zoom * 100)}%).`);
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
    if (S().autoCrop) cropToOverlap(true);
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

async function runRender(frames: Omit<PoolFrame, 'matrix'>[], matrices: Affine[], title: string, fileBase: string) {
  const s = S();
  const { w, h } = outputPixels(s);
  if (w * h > 400e6) throw new Error(`Output of ${w}×${h} px is too large. Lower the DPI or size.`);
  setBusy(true);
  progress(0);
  status(`Rendering ${w}×${h}…`, 'info', 60000);
  const t0 = performance.now();
  try {
    const job = {
      width: w, height: h, orientation: s.orientation,
      lens: { lpi: s.lpi, dpi: s.dpi, frames: frames.length, phase: s.phase, reverse: s.reverse, sampling: s.sampling },
      frames: frames.map((f, i) => ({ ...f, matrix: matrices[i] })),
      background: hexToRgb(s.background),
      page: { margin: s.marginIn * s.dpi, alignBars: s.alignBars, cropMarks: s.cropMarks },
    };
    // GPU when chosen (or available in Auto); any GPU failure falls back to the CPU workers
    let page: Awaited<ReturnType<typeof pool.render>> | null = null;
    let engine = 'CPU', gpuNote = '';
    if (renderer !== 'cpu' && gpuAvailable()) {
      try {
        const img = await renderGpu(job as Parameters<typeof renderGpu>[0], progress);
        page = composePage(img, { ...job.page, orientation: job.orientation, lens: job.lens });
        engine = 'GPU';
      } catch (e) {
        gpuNote = ` (GPU unavailable: ${(e as Error).message})`;
      }
    } else if (renderer === 'gpu') {
      gpuNote = ' (GPU unavailable in this browser)';
    }
    page ??= await pool.render(job, progress);
    const { c: canvas, ctx } = canvas2d(page.width, page.height);
    ctx.putImageData(new ImageData(page.data as Uint8ClampedArray<ArrayBuffer>, page.width, page.height), 0, 0);
    // the pixels now live only in the canvas (TIFF export reads them back when needed)
    setResult({ canvas, width: page.width, height: page.height, dpi: s.dpi, title, fileBase });
    status(`Rendered in ${((performance.now() - t0) / 1000).toFixed(1)} s on the ${engine}.${gpuNote}`, gpuNote ? 'error' : 'info', gpuNote ? 7000 : 3500);
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
  const s = S();
  try {
    await runRender(
      frames.map((f) => ({ source: f.bitmap, width: f.width, height: f.height })),
      frames.map((f) => frameMatrix(out, { w: ref.width, h: ref.height }, { w: f.width, h: f.height }, f.transform, framing(s))),
      `Interlaced · ${frames.length} frames · ${s.lpi} LPI · ${s.dpi} DPI`,
      `lenticular_${s.lpi}lpi_${s.dpi}dpi`,
    );
    showTab('output');
  } catch (e) {
    status(`Render failed: ${(e as Error).message}`, 'error', 8000);
  }
}

function patternToCanvas(p: Pattern): HTMLCanvasElement {
  const { c, ctx } = canvas2d(p.image.width, p.image.height);
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
      setResult({
        canvas, width: w, height: h, dpi: s.dpi,
        title: type === 'pitch' ? `Pitch test ${s.lpi - range}–${s.lpi + range} LPI (step ${step})` : `Lens ruler ${s.lpi} LPI`,
        fileBase: type === 'pitch' ? `pitch_test_${s.lpi}lpi_${s.dpi}dpi` : `lens_ruler_${s.lpi}lpi_${s.dpi}dpi`,
      });
      setBusy(false);
    } else {
      const n = Math.max(2, Math.min(64, parseInt($<HTMLInputElement>('ft-count').value) || 6));
      // small synthetic frames: coloured field, big number, and an arrow that points to the frame's position
      const fw = 600, fh = Math.round((600 * h) / w) || 400;
      const frames: Omit<PoolFrame, 'matrix'>[] = [];
      for (let i = 0; i < n; i++) {
        const { c, ctx: x } = canvas2d(fw, fh);
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
        frames.push({ source: c, width: fw, height: fh });
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

/** reduced copy of the current render for drawing it zoomed out (long side ≤ 3072 px) */
let resultThumb: { canvas: HTMLCanvasElement; scale: number } | null = null;

function setResult(r: RenderResult | null) {
  result = r;
  resultThumb = null;
  if (!r) {
    $('output-title').textContent = '';
    updateExportButtons();
    drawOutput();
    return;
  }
  const k = Math.min(1, 3072 / Math.max(r.width, r.height));
  if (k < 1) {
    const { c, ctx } = canvas2d(r.width * k, r.height * k);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(r.canvas, 0, 0, c.width, c.height);
    resultThumb = { canvas: c, scale: c.width / r.width };
  }
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
  // zoomed out: the reduced copy is sharp enough and far cheaper to scale on every pan/zoom
  const src = resultThumb && r.s <= resultThumb.scale ? resultThumb.canvas : result.canvas;
  ctx.drawImage(src, r.x, r.y, r.w, r.h);
}

/** Aligned frames at an arbitrary size: t = 0…1 across the frames, blended in between when `blend` (video export),
 *  or exactly one frame per step (GIF export). */
const frameDraw = (blend: () => boolean): DrawFn => (ctx, W, H, t) => {
  const s = S();
  const ordered = s.reverse ? [...activeFrames()].reverse() : activeFrames();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = s.background;
  ctx.fillRect(0, 0, W, H);
  const out = outputPixels(s);
  drawTiltFrames(ctx, ordered, t * (ordered.length - 1), blend(),
    (f: Frame) => compose(scale(W / out.w, H / out.h), invert(previewMatrix(f, out))));
};
const drawTilt = frameDraw(() => $<HTMLInputElement>('preview-blend').checked);
const drawPlain = frameDraw(() => false);

/** GIF steps, one per frame: animations loop forward, 3D views rock back and forth. */

const animKey = (kind: 'gif' | 'video') => JSON.stringify([kind, S(), activeFrames().map((f) => [f.id, f.transform])]);

/** Zoom of the rendered GIF / video in the Output tab: null = fit, otherwise a scale (1 = actual pixels). */
let animZoom: number | null = null;
const animVisible = () => !$('anim-view').hidden && !!$('anim-view').firstElementChild;

function layoutAnim() {
  const view = $('anim-view');
  const el = view.firstElementChild as HTMLImageElement | HTMLVideoElement | null;
  if (!el) return;
  if (!anim) return;
  const nw = anim.w, nh = anim.h;
  const fit = Math.min((view.clientWidth - 32) / nw, (view.clientHeight - 32) / nh);
  const z = animZoom ?? fit;
  el.style.width = `${Math.round(nw * z)}px`;
  el.style.height = `${Math.round(nh * z)}px`;
  updateZoomLabels();
}

function zoomAnim(cmd: string) {
  const el = $('anim-view').firstElementChild as HTMLElement | null;
  const nw = anim?.w;
  const cur = el && nw ? el.getBoundingClientRect().width / nw : 1;
  animZoom = cmd === 'fit' ? null : cmd === 'actual' ? 1
    : Math.min(32, Math.max(0.05, cur * (cmd === 'in' ? 1.25 : 1 / 1.25)));
  layoutAnim();
}

function showAnim(on: boolean) {
  const view = $('anim-view');
  const visible = on && !!anim && anim.kind === S().exportFormat;
  view.hidden = !visible;
  if (!visible) { view.replaceChildren(); return; }
  if (view.dataset.url === anim!.url) return;
  view.dataset.url = anim!.url;
  const el = anim!.kind === 'gif' ? Object.assign(document.createElement('img'), { alt: 'Rendered GIF' })
    : Object.assign(document.createElement('video'), { autoplay: true, loop: true, muted: true, controls: true, playsInline: true });
  el.addEventListener(el instanceof HTMLVideoElement ? 'loadedmetadata' : 'load', layoutAnim);
  el.src = anim!.url;
  animZoom = null;
  view.replaceChildren(el);
  layoutAnim();
  $('output-title').textContent = anim!.name;
}

/**
 * Draw function over the frames plus `k` motion-interpolated frames between each pair (rendered at w×h).
 * Positions 0…1 index the expanded sequence of n + (n-1)·k frames.
 */
async function inbetweenDraw(n: number, k: number, w: number, h: number): Promise<{ draw: DrawFn; count: number }> {
  const { c, ctx } = canvas2d(w, h, true);
  const sc = Math.min(1, 400 / Math.max(w, h));
  const small = canvas2d(w * sc, h * sc, true);
  const real: Uint8ClampedArray[] = [], grays = [];
  for (let i = 0; i < n; i++) {
    drawPlain(ctx, w, h, n === 1 ? 0 : i / (n - 1));
    real.push(ctx.getImageData(0, 0, w, h).data);
    small.ctx.drawImage(c, 0, 0, small.c.width, small.c.height);
    grays.push(rgbaToGray(small.ctx.getImageData(0, 0, small.c.width, small.c.height).data, small.c.width, small.c.height));
  }
  const flows: ReturnType<typeof estimateFlow>[] = [];
  for (let i = 0; i + 1 < n; i++) {
    status(`Finding motion… ${i + 1}/${n - 1}`, 'info', 60000);
    flows.push(estimateFlow(grays[i], grays[i + 1]));
    await new Promise((r) => setTimeout(r, 0));
  }
  const count = n + (n - 1) * k;
  const draw: DrawFn = (cx, W, H, pos) => {
    const j = Math.round(pos * (count - 1));
    const seg = Math.min(n - 1, Math.floor(j / (k + 1))), r = j - seg * (k + 1);
    const data = r === 0 ? real[seg] : interpolate(real[seg], real[seg + 1], w, h, flows[seg], 1 / sc, r / (k + 1));
    cx.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  };
  return { draw, count };
}

async function renderAnimation(kind: 'gif' | 'video'): Promise<boolean> {
  const frames = activeFrames();
  if (frames.length < 2) { status('Need at least two frames.', 'error'); return false; }
  const s = S();
  // GIF: the aligned frames themselves, one GIF frame each; video: the tilt preview
  const social = SIZE_PRESETS[matchPreset(s)];
  const { w, h } = social?.px ? animSize(social.w / social.h, Math.max(social.w, social.h))
    : animSize(s.widthIn / s.heightIn, kind === 'gif' ? 800 : 1280);
  // GIF and frame videos: the frames with their timing; tilt videos: a smooth sweep at 25 fps
  const tilt = kind === 'video' && s.videoSource === 'tilt';
  let steps = tilt ? sweepPositions(frames.length, 4).map((pos) => ({ pos, ms: 40 }))
    : frameSequence(frames.length, s.gifLoop, s.gifFps, s.gifHold);
  const base = tilt ? `lenticular_preview_${frames.length}f` : `animation_${frames.length}f`;
  setBusy(true);
  progress(0);
  status(kind === 'gif' ? 'Encoding GIF…' : 'Recording video…', 'info', 120000);
  try {
    const key = animKey(kind);
    let draw = tilt ? drawTilt : drawPlain;
    if (!tilt && s.inBetween > 0 && frames.length > 1) {
      // more frames at a proportionally higher rate: same speed, smoother motion
      const ib = await inbetweenDraw(frames.length, s.inBetween, w, h);
      draw = ib.draw;
      steps = frameSequence(ib.count, s.gifLoop, s.gifFps * (s.inBetween + 1), s.gifHold);
      status(kind === 'gif' ? 'Encoding GIF…' : 'Recording video…', 'info', 120000);
    }
    const out = kind === 'gif'
      ? { blob: await encodeGif(draw, w, h, steps, progress, s.gifDither), ext: 'gif' }
      : await recordVideo(draw, w, h, steps, s.videoLoops, progress);
    if (anim) URL.revokeObjectURL(anim.url);
    anim = { kind, blob: out.blob, name: `${base}.${out.ext}`, url: URL.createObjectURL(out.blob), key, w, h };
    showTab('output');
    status(`Rendered ${(out.blob.size / 1e6).toFixed(1)} MB ${out.ext.toUpperCase()} (${w}×${h}).`);
    return true;
  } finally {
    setBusy(false);
    progress(null);
    updateExportButtons();
  }
}

async function exportResult() {
  const fmt0 = S().exportFormat;
  if (fmt0 === 'gif' || fmt0 === 'video') {
    try {
      // render first if nothing matching the current frames and settings has been rendered yet
      if (!anim || anim.key !== animKey(fmt0)) { if (!(await renderAnimation(fmt0))) return; }
      await download(anim!.blob, anim!.name);
      status(`Saved ${(anim!.blob.size / 1e6).toFixed(1)} MB ${anim!.name.split('.').pop()!.toUpperCase()}.`);
    } catch (e) { status(`Export failed: ${(e as Error).message}`, 'error', 8000); }
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
    // nothing from the previous project may leak into this one
    depthPanel?.reset();
    setResult(null);
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
  // draw right away so the view's layout (used for clicks, e.g. picking the key point) is current
  if (name === 'output') { drawOutput(); showAnim(true); }
  else if (name === 'align') drawAlign();
  else drawPreview();
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
  $('split-scan').addEventListener('change', async (e) => {
    const sel = e.target as HTMLSelectElement;
    const count = +sel.value;
    sel.value = '';
    const f = selFrame();
    if (!f || busy || !count) return;
    try { await splitFrame(f, count); } catch (err) { status(`Could not split: ${(err as Error).message}`, 'error', 6000); }
  });
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
  $('btn-crop-common').addEventListener('click', () => !busy && cropToOverlap());
  $('btn-pick-key').addEventListener('click', () => setPicking(!pickingKey));
  $('btn-reset-align').addEventListener('click', () => {
    for (const f of state.frames) { f.transform = { ...NO_TRANSFORM }; f.confidence = undefined; }
    renderFrameList();
    scheduleRedraw();
  });
  $('btn-render').addEventListener('click', () => {
    if (busy) return;
    const fmt = S().exportFormat;
    if (fmt === 'gif' || fmt === 'video') renderAnimation(fmt).catch((e) => status(`Render failed: ${(e as Error).message}`, 'error', 8000));
    else renderPrint();
  });
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
// Default to a theme the host page already set (e.g. an embedding viewer).
bindPref($<HTMLSelectElement>('theme'), 'theme', document.documentElement.dataset.theme || 'system',
  (t) => (document.documentElement.dataset.theme = t));

if (!videoFormat()) {
  $<HTMLElement>('export-format').querySelector<HTMLElement>('[data-format=video]')!.hidden = true;
  if (S().exportFormat === 'video') S().exportFormat = 'png';
}

// the sandboxed artifact viewer can't open print dialogs: updateExportButtons keeps Print hidden there

// Render engine (per-device preference)
let renderer = 'auto';
bindPref($<HTMLSelectElement>('renderer'), 'renderer', 'auto', (v) => (renderer = v));

// Control panel side (per-device preference, like the theme)
bindPref($<HTMLSelectElement>('panel-side'), 'panelSide', 'left', (side) => {
  document.querySelector('.layout')!.classList.toggle('panel-right', side === 'right');
  scheduleRedraw();
});

bindMenu($('btn-settings'), $('settings-panel'));
bindMenu($('btn-about'), $('about-panel'));
$('about-version').textContent = `v${__APP_VERSION__} (beta)`;
const setSamplesOpen = bindMenu($('btn-samples'), $('samples-panel'));

// Sample sets (public/samples), listed from their manifest. The desktop app doesn't package them:
// they're an optional download (Settings → Samples), and the Samples button shows once they're installed.
interface Sample { id: string; name: string; mode: Settings['mode']; files: string[] }
let samples: Sample[] = [];
function loadSampleList() {
  return fetch('samples/index.json')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((m: { samples: Sample[] }) => {
      samples = m.samples;
      const groups: [Settings['mode'], string][] = [['3d', '3D'], ['animation', 'Animation']];
      $('samples-list').innerHTML = groups.map(([mode, label]) => `
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
}

// Desktop: check GitHub for a newer release on launch and offer the installer for this OS
const UPDATE_SKIP_KEY = 'lenticulator.skipVersion';
window.lenticulatorHost?.checkForUpdate().then((u) => {
  if (!u) return;
  try { if (localStorage.getItem(UPDATE_SKIP_KEY) === u.version) return; } catch { /* storage unavailable */ }
  const dlg = $('update-dialog') as HTMLDialogElement;
  $('update-version').textContent = `v${u.version} (beta)`;
  ($('update-notes') as HTMLAnchorElement).href = u.notes;
  const dl = $('update-download') as HTMLAnchorElement;
  dl.href = u.url;
  dl.addEventListener('click', () => dlg.close('download'));
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'skip') try { localStorage.setItem(UPDATE_SKIP_KEY, u.version); } catch { /* ignore */ }
  }, { once: true });
  dlg.showModal();
}, () => { /* offline or rate-limited: try again next launch */ });

const desktopSamples = window.lenticulatorHost?.samples;
if (!desktopSamples) loadSampleList();
else {
  const box = $('samples-download') as HTMLInputElement;
  const showSamples = (on: boolean) => {
    box.checked = on;
    $('btn-samples').hidden = !on;
    if (on) loadSampleList();
    else setSamplesOpen(false);
  };
  $('samples-settings').hidden = false;
  $('btn-samples').hidden = true;
  desktopSamples.installed().then(showSamples, () => showSamples(false));
  box.addEventListener('change', async () => {
    box.disabled = true;
    try {
      if (box.checked) {
        status('Downloading samples…', 'info', 600000);
        await desktopSamples.download((done, total) => status(`Downloading samples… ${done}/${total}`, 'info', 600000));
        showSamples(true);
        status('Samples downloaded.', 'info', 3000);
      } else {
        await desktopSamples.remove();
        showSamples(false);
        status('Samples removed.', 'info', 3000);
      }
    } catch (e) {
      showSamples(!box.checked);
      status(`Samples: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, 'error', 8000);
    } finally {
      box.disabled = false;
    }
  });
}

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

$('app-version').textContent = `v${__APP_VERSION__} (beta)`;
document.title = `Lenticulator ${__APP_VERSION__} (beta)`;

// Depth from a single photo → generated 3D views (see ui/depthPanel.ts)
depthPanel = initDepthPanel({
  $, S,
  frames: () => state.frames,
  selFrame,
  isBusy: () => busy,
  setBusy,
  status,
  progress,
  decodeAny,
  replaceFrames,
  worker,
});

// labels show their control's tooltip too, so hovering the label text works
document.querySelectorAll<HTMLLabelElement>('label').forEach((l) => {
  const c = l.querySelector<HTMLElement>('[title]');
  if (c && !l.title) l.title = c.title;
});

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
(window as unknown as { lenticulator: unknown }).lenticulator = { state, importFiles, autoAlign, renderPrint, generatePattern, getResult: () => result };
