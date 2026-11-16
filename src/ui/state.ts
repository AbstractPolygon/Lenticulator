import type { FrameTransform, Framing } from '../core/geometry';
import type { Orientation, Sampling } from '../core/interlace';
import type { AlignMode } from '../core/align';

export type EffectMode = '3d' | 'animation';

export interface Settings {
  /** what the print should do: show depth, or flip/animate */
  mode: EffectMode;
  /** inches */
  widthIn: number;
  heightIn: number;
  units: 'in' | 'mm';
  dpi: number;
  lpi: number;
  orientation: Orientation;
  sampling: Sampling;
  reverse: boolean;
  phase: number;
  fit: Framing['fit'];
  zoom: number;
  panX: number;
  panY: number;
  background: string;
  /** inches */
  marginIn: number;
  alignBars: boolean;
  cropMarks: boolean;
  /** after auto-align, crop to the region every frame covers */
  autoCrop: boolean;
  alignMode: AlignMode;
  /** png/jpg/tiff export the rendered print; gif/video export an animated tilt preview */
  exportFormat: 'png' | 'jpg' | 'tiff' | 'pdf' | 'gif' | 'video';
  /** TIFF export in CMYK (for print shops) instead of RGB */
  tiffCmyk: boolean;
  /** GIF playback speed, frames per second */
  gifFps: number;
  /** GIF colour dithering */
  gifDither: 'none' | 'floyd' | 'atkinson' | 'bayer';
  /** GIF / frame video: back and forth, or a one-way loop */
  gifLoop: 'pingpong' | 'forward';
  /** extra time on the first and last frames, ms */
  gifHold: number;
  /** GIF / frame video: motion-interpolated frames between each pair of frames (0–4) */
  inBetween: number;
  /** video: how many back-and-forth sweeps to record */
  videoLoops: number;
  /** video: the frames (like the GIF) or the tilt preview */
  videoSource: 'frames' | 'tilt';
  /** import each Photoshop layer as a frame */
  psdLayers: boolean;
  /** depth → 3D views */
  depthFrames: number;
  /** derive the number of generated views from DPI / LPI */
  depthAuto: boolean;
  /** total parallax, % of image width */
  depthAmount: number;
  /** disparity kept at the print plane, 0..1 */
  depthFocus: number;
  depthInvert: boolean;
  /** import every page of a multi-page TIFF */
  tiffAllPages: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: '3d',
  widthIn: 6,
  heightIn: 4,
  units: 'in',
  dpi: 600,
  lpi: 60,
  orientation: 'vertical',
  sampling: 'blend',
  reverse: false,
  phase: 0,
  fit: 'cover',
  zoom: 1,
  panX: 0,
  panY: 0,
  background: '#ffffff',
  marginIn: 0,
  alignBars: true,
  cropMarks: true,
  autoCrop: true,
  alignMode: 'keypoint',
  exportFormat: 'png',
  tiffCmyk: false,
  gifFps: 10,
  gifDither: 'atkinson',
  gifLoop: 'pingpong',
  gifHold: 0,
  inBetween: 0,
  videoLoops: 2,
  videoSource: 'frames',
  psdLayers: false,
  depthFrames: 10,
  depthAuto: true,
  depthAmount: 2.5,
  depthFocus: 0.5,
  depthInvert: false,
  tiffAllPages: true,
};

export interface Frame {
  id: string;
  name: string;
  /** original encoded bytes (kept for project save) */
  blob: Blob;
  bitmap: ImageBitmap;
  /** downscaled copy for on-screen drawing (null when the image is already small) */
  preview?: ImageBitmap | null;
  width: number;
  height: number;
  thumb: string;
  transform: FrameTransform;
  enabled: boolean;
  confidence?: number;
}

export interface AppState {
  settings: Settings;
  frames: Frame[];
  refId: string | null;
  selectedId: string | null;
  /** key point in reference-frame pixel coordinates */
  keyPoint: { x: number; y: number } | null;
}

/** Print sizes in inches; social (screen) sizes in pixels, with a fixed orientation. */
export interface SizePreset { label: string; w: number; h: number; px?: boolean }
export const SIZE_PRESETS: SizePreset[] = [
  { label: '4 × 6 in', w: 6, h: 4 },
  { label: '5 × 7 in', w: 7, h: 5 },
  { label: '8 × 10 in', w: 10, h: 8 },
  { label: '8.5 × 11 in (Letter)', w: 11, h: 8.5 },
  { label: '11 × 17 in (Tabloid)', w: 17, h: 11 },
  { label: '12 × 18 in', w: 18, h: 12 },
  { label: 'A6 (105 × 148 mm)', w: 148 / 25.4, h: 105 / 25.4 },
  { label: 'A5 (148 × 210 mm)', w: 210 / 25.4, h: 148 / 25.4 },
  { label: 'A4 (210 × 297 mm)', w: 297 / 25.4, h: 210 / 25.4 },
  { label: 'A3 (297 × 420 mm)', w: 420 / 25.4, h: 297 / 25.4 },
  { label: 'Business card (3.5 × 2 in)', w: 3.5, h: 2 },
  { label: 'Postcard (6 × 4.25 in)', w: 6, h: 4.25 },
  { label: 'Instagram post 1080 × 1080', w: 1080, h: 1080, px: true },
  { label: 'Instagram portrait 1080 × 1350', w: 1080, h: 1350, px: true },
  { label: 'Story / Reel / TikTok 1080 × 1920', w: 1080, h: 1920, px: true },
  { label: 'YouTube 1920 × 1080', w: 1920, h: 1080, px: true },
  { label: 'X post 1600 × 900', w: 1600, h: 900, px: true },
  { label: 'Facebook / LinkedIn 1200 × 628', w: 1200, h: 628, px: true },
  { label: 'Pinterest 1000 × 1500', w: 1000, h: 1500, px: true },
];

/** The preset matching the current size (either orientation for print sizes), or -1. */
export function matchPreset(s: { widthIn: number; heightIn: number; dpi: number }): number {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  return SIZE_PRESETS.findIndex((p) => {
    if (p.px) return eq(p.w / s.dpi, s.widthIn) && eq(p.h / s.dpi, s.heightIn);
    return (eq(p.w, s.widthIn) && eq(p.h, s.heightIn)) || (eq(p.h, s.widthIn) && eq(p.w, s.heightIn));
  });
}

const KEY = 'lenticulator.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

export function framing(s: Settings): Framing {
  return { fit: s.fit, zoom: s.zoom, panX: s.panX, panY: s.panY };
}

export function outputPixels(s: Settings) {
  return { w: Math.max(1, Math.round(s.widthIn * s.dpi)), h: Math.max(1, Math.round(s.heightIn * s.dpi)) };
}

/**
 * Sensible defaults when switching effect type.
 * 3D: vertical lenses so each eye sees a different frame (stereo), aligned on a key subject.
 * Animation/flip: horizontal lenses so both eyes see the same frame (no ghosting), tilt up/down.
 */
export const MODE_DEFAULTS: Record<EffectMode, Partial<Settings>> = {
  '3d': { orientation: 'vertical', alignMode: 'keypoint', gifLoop: 'pingpong' },
  animation: { orientation: 'horizontal', alignMode: 'translation', gifLoop: 'forward' },
};
