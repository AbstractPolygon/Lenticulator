/**
 * Splitting a film scan with frames side by side (Nimslo, Nishika, Reto3D …) into separate frames.
 * Works on per-column and per-row statistics of the scan's brightness: film gaps and borders are flat
 * (almost no variation along their length), photo content is not.
 */
export interface Rect { x: number; y: number; w: number; h: number }
/** Brightness mean and standard deviation of each column (or row). */
export interface Profile { mean: Float32Array; std: Float32Array }

/** A column/row that belongs to a gap or border: nearly uniform. */
const GAP_STD = 14;

/** Index range [start, end) left once flat borders at both ends are trimmed (at most 20 % per side). */
export function trimBorders(p: Profile): [number, number] {
  const n = p.std.length;
  let a = 0, b = n;
  while (a < n * 0.2 && p.std[a] < GAP_STD) a++;
  while (b > n * 0.8 && p.std[b - 1] < GAP_STD) b--;
  return [a, b];
}

/**
 * Column ranges of `count` frames: in each slot between evenly spaced positions, the flat run (gap) nearest the
 * expected position is the gutter; without one, the cut goes at the expected position. Every frame then gets the
 * same width, centred in its slot.
 */
export function splitColumns(p: Profile, count: number): [number, number][] {
  const [a, b] = trimBorders(p);
  const width = b - a;
  if (count < 2 || width < count * 8) return [[a, b]];
  const flat = (x: number) => p.std[x] < GAP_STD;
  const cuts: [number, number][] = [];
  for (let i = 1; i < count; i++) {
    const c = a + (i * width) / count;
    const win = width / count / 3;
    let best: [number, number] | null = null, bestDist = Infinity;
    for (let x = Math.max(a, Math.round(c - win)); x <= Math.min(b - 1, Math.round(c + win)); x++) {
      if (!flat(x) || (x > a && flat(x - 1))) continue; // start of a flat run
      let e = x;
      while (e < b && flat(e)) e++;
      const d = Math.abs((x + e) / 2 - c);
      if (d < bestDist) { bestDist = d; best = [x, e]; }
    }
    cuts.push(best ?? [Math.round(c), Math.round(c)]);
  }
  const slots: [number, number][] = [];
  let prev = a;
  for (const [s, e] of cuts) { slots.push([prev, s]); prev = e; }
  slots.push([prev, b]);
  const w = Math.min(...slots.map(([s, e]) => e - s));
  return slots.map(([s, e]) => {
    const x = Math.round(s + (e - s - w) / 2);
    return [x, x + w];
  });
}

/** Frame rectangles for a scan, given its column and row profiles. */
export function splitScan(columns: Profile, rows: Profile, count: number): Rect[] {
  const [y0, y1] = trimBorders(rows);
  return splitColumns(columns, count).map(([x0, x1]) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }));
}

/** Column and row profiles of an RGBA image. */
export function scanProfiles(data: Uint8ClampedArray, w: number, h: number): { columns: Profile; rows: Profile } {
  const cs = new Float64Array(w), cq = new Float64Array(w), rs = new Float64Array(h), rq = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      cs[x] += l; cq[x] += l * l; rs[y] += l; rq[y] += l * l;
    }
  }
  const prof = (s: Float64Array, q: Float64Array, n: number): Profile => {
    const mean = new Float32Array(s.length), std = new Float32Array(s.length);
    for (let i = 0; i < s.length; i++) { mean[i] = s[i] / n; std[i] = Math.sqrt(Math.max(0, q[i] / n - mean[i] ** 2)); }
    return { mean, std };
  };
  return { columns: prof(cs, cq, h), rows: prof(rs, rq, w) };
}
