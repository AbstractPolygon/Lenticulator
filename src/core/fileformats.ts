/** PNG DPI tagging and a baseline TIFF writer, so prints come out at the right physical size. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Insert (or replace) the pHYs chunk of a PNG so it carries the given DPI.
 */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  for (let i = 0; i < 8; i++) if (png[i] !== PNG_SIG[i]) throw new Error('Not a PNG');
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk, 4, 17));

  // walk chunks; drop an existing pHYs, insert ours right after IHDR
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p < png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const end = p + 12 + len;
    if (type !== 'pHYs') parts.push(png.subarray(p, end));
    if (type === 'IHDR') parts.push(chunk);
    p = end;
  }
  const total = parts.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
}

/** Read DPI back from a PNG's pHYs chunk (or null). */
export function getPngDpi(png: Uint8Array): number | null {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (type === 'pHYs' && png[p + 16] === 1) return view.getUint32(p + 8) * 0.0254;
    p += 12 + len;
  }
  return null;
}

/**
 * Encode RGBA pixels as an uncompressed 8-bit RGB baseline TIFF with
 * resolution tags (inches).
 */
export function encodeTiff(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, dpi: number): Uint8Array {
  const pixelBytes = width * height * 3;
  const entries: [number, number, number, number][] = []; // tag, type, count, value/offset
  const SHORT = 3, LONG = 4, RATIONAL = 5;
  const headerSize = 8;
  const nTags = 12;
  const ifdSize = 2 + nTags * 12 + 4;
  const extraStart = headerSize + ifdSize;
  // extra data: BitsPerSample (3 shorts = 6 bytes), XRes (8), YRes (8)
  const bpsOff = extraStart;
  const xresOff = bpsOff + 6 + 2; // keep word aligned
  const yresOff = xresOff + 8;
  const dataOff = yresOff + 8;
  entries.push([256, LONG, 1, width]); // ImageWidth
  entries.push([257, LONG, 1, height]); // ImageLength
  entries.push([258, SHORT, 3, bpsOff]); // BitsPerSample
  entries.push([259, SHORT, 1, 1]); // Compression: none
  entries.push([262, SHORT, 1, 2]); // Photometric: RGB
  entries.push([273, LONG, 1, dataOff]); // StripOffsets
  entries.push([277, SHORT, 1, 3]); // SamplesPerPixel
  entries.push([278, LONG, 1, height]); // RowsPerStrip
  entries.push([279, LONG, 1, pixelBytes]); // StripByteCounts
  entries.push([282, RATIONAL, 1, xresOff]); // XResolution
  entries.push([283, RATIONAL, 1, yresOff]); // YResolution
  entries.push([296, SHORT, 1, 2]); // ResolutionUnit: inch
  const out = new Uint8Array(dataOff + pixelBytes);
  const dv = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; // "II" little endian
  dv.setUint16(2, 42, true);
  dv.setUint32(4, headerSize, true);
  dv.setUint16(headerSize, nTags, true);
  entries.forEach(([tag, type, count, value], i) => {
    const o = headerSize + 2 + i * 12;
    dv.setUint16(o, tag, true);
    dv.setUint16(o + 2, type, true);
    dv.setUint32(o + 4, count, true);
    if (type === SHORT && count === 1) dv.setUint16(o + 8, value, true);
    else dv.setUint32(o + 8, value, true);
  });
  dv.setUint32(headerSize + 2 + nTags * 12, 0, true); // next IFD
  dv.setUint16(bpsOff, 8, true); dv.setUint16(bpsOff + 2, 8, true); dv.setUint16(bpsOff + 4, 8, true);
  // DPI as a rational with denominator 1000 for fractional DPI
  dv.setUint32(xresOff, Math.round(dpi * 1000), true); dv.setUint32(xresOff + 4, 1000, true);
  dv.setUint32(yresOff, Math.round(dpi * 1000), true); dv.setUint32(yresOff + 4, 1000, true);
  let o = dataOff;
  for (let i = 0; i < width * height * 4; i += 4) {
    out[o++] = rgba[i]; out[o++] = rgba[i + 1]; out[o++] = rgba[i + 2];
  }
  return out;
}
