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
  alignMode: AlignMode;
  /** png/jpg/tiff export the rendered print; gif/video export an animated tilt preview */
  exportFormat: 'png' | 'jpg' | 'tiff' | 'gif' | 'video';
  /** import each Photoshop layer as a frame */
  psdLayers: boolean;
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
  alignMode: 'keypoint',
  exportFormat: 'png',
  psdLayers: false,
  tiffAllPages: true,
};

export interface Frame {
  id: string;
  name: string;
  /** original encoded bytes (kept for project save) */
  blob: Blob;
  bitmap: ImageBitmap;
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

export const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
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
];

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
  '3d': { orientation: 'vertical', alignMode: 'keypoint' },
  animation: { orientation: 'horizontal', alignMode: 'translation' },
};
