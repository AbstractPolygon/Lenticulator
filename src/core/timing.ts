/** Frame order and timing for GIF / frame-video exports. */
export type LoopMode = 'pingpong' | 'forward';

export interface Step {
  /** position across the frames, 0 = first frame, 1 = last */
  pos: number;
  /** how long this step is shown, in milliseconds */
  ms: number;
}

/**
 * One cycle of `n` frames: back and forth (1 2 3 2 → 1 …) or a one-way loop (1 2 3 → 1 …), each shown
 * 1000/fps ms, with the first and last frames held `holdMs` longer.
 */
export function frameSequence(n: number, loop: LoopMode, fps: number, holdMs = 0): Step[] {
  if (n < 1) return [];
  const base = 1000 / Math.max(0.1, fps);
  const pos = (i: number) => (n === 1 ? 0 : i / (n - 1));
  const idx = Array.from({ length: n }, (_, i) => i);
  const order = loop === 'pingpong' && n > 2 ? [...idx, ...idx.slice(1, -1).reverse()] : idx;
  return order.map((i) => ({ pos: pos(i), ms: base + (i === 0 || i === n - 1 ? Math.max(0, holdMs) : 0) }));
}
