/**
 * Zoom / pan state for a canvas viewport. `zoom` is relative to "fit"
 * (1 = whole content visible); pan is in device pixels from centred.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** device pixels per content pixel */
  s: number;
}

export class ViewState {
  zoom = 1;
  panX = 0;
  panY = 0;
  /** last layout, used for cursor-anchored zoom and hit testing */
  last: { rect: Rect; fit: number; vw: number; vh: number; cw: number; ch: number } | null = null;

  constructor(public maxPercent = 1600, private margin = 0.96) {}

  /** Lay content (cw×ch content px) into a viewport of vw×vh device px. */
  layout(cw: number, ch: number, vw: number, vh: number): Rect {
    const fit = Math.min(vw / cw, vh / ch) * this.margin;
    const s = fit * this.zoom;
    const w = cw * s, h = ch * s;
    // keep at least part of the content on screen
    const limX = Math.max(0, (w + vw) / 2 - 40), limY = Math.max(0, (h + vh) / 2 - 40);
    this.panX = Math.max(-limX, Math.min(limX, this.panX));
    this.panY = Math.max(-limY, Math.min(limY, this.panY));
    const rect = { x: (vw - w) / 2 + this.panX, y: (vh - h) / 2 + this.panY, w, h, s };
    this.last = { rect, fit, vw, vh, cw, ch };
    return rect;
  }

  private clampZoom(z: number, fit: number, dpr: number): number {
    const maxZ = (this.maxPercent / 100) * dpr / fit;
    return Math.max(0.25, Math.min(Math.max(1, maxZ), z));
  }

  /** Zoom by `factor`, keeping the content point under (mx, my) (device px) fixed. */
  zoomAt(factor: number, mx: number, my: number, dpr: number): void {
    const L = this.last;
    if (!L) { this.zoom *= factor; return; }
    const cx = (mx - L.rect.x) / L.rect.s, cy = (my - L.rect.y) / L.rect.s;
    this.zoom = this.clampZoom(this.zoom * factor, L.fit, dpr);
    const s = L.fit * this.zoom;
    // solve for pan so that rect.x + cx*s = mx
    this.panX = mx - cx * s - (L.vw - L.cw * s) / 2;
    this.panY = my - cy * s - (L.vh - L.ch * s) / 2;
  }

  zoomCentered(factor: number, dpr: number): void {
    const L = this.last;
    this.zoomAt(factor, L ? L.vw / 2 : 0, L ? L.vh / 2 : 0, dpr);
  }

  fit(): void {
    this.zoom = 1;
    this.panX = this.panY = 0;
  }

  /** 1 content pixel per CSS pixel. */
  actual(dpr: number): void {
    const L = this.last;
    if (!L) return;
    const target = dpr / L.fit;
    this.zoomAt(target / this.zoom, L.vw / 2, L.vh / 2, dpr);
  }

  /** Zoom as a percentage of actual pixels (content px per CSS px). */
  percent(dpr: number): number {
    return this.last ? (this.last.rect.s / dpr) * 100 : 100;
  }

  /** Device-pixel point → content coordinates. */
  toContent(dx: number, dy: number): { x: number; y: number } | null {
    const L = this.last;
    if (!L) return null;
    return { x: (dx - L.rect.x) / L.rect.s, y: (dy - L.rect.y) / L.rect.s };
  }
}
