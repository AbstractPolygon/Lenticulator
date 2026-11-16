/**
 * Minimal radix-2 complex FFT (in place) and 2D helpers.
 * Sizes must be powers of two.
 */

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function tables(n: number) {
  let t = twiddleCache.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  twiddleCache.set(n, t);
  return t;
}

/** In-place 1D FFT over `n` elements read with a stride, starting at `offset`. */
export function fft1d(
  re: Float64Array,
  im: Float64Array,
  n: number,
  inverse = false,
  offset = 0,
  stride = 1,
): void {
  if (!isPow2(n)) throw new Error(`FFT size ${n} is not a power of two`);
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const a = offset + i * stride;
      const b = offset + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = offset + (start + k) * stride;
        const b = offset + (start + k + half) * stride;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      const a = offset + i * stride;
      re[a] /= n;
      im[a] /= n;
    }
  }
}

/** In-place 2D FFT of a w×h row-major complex array. */
export function fft2d(re: Float64Array, im: Float64Array, w: number, h: number, inverse = false): void {
  for (let y = 0; y < h; y++) fft1d(re, im, w, inverse, y * w, 1);
  for (let x = 0; x < w; x++) fft1d(re, im, h, inverse, x, w);
}
