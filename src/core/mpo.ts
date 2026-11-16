/**
 * MPO (CIPA DC-007 "Multi-Picture Format") parsing: 3D cameras store the
 * left/right JPEGs back to back, indexed by an MP Index IFD in an APP2
 * "MPF" segment of the first image.
 */

/** Byte ranges [start, end) of the individual images, or null if this isn't an MPO. */
export function mpoImageRanges(buf: Uint8Array): [number, number][] | null {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 2;
  while (p + 4 <= buf.length && buf[p] === 0xff) {
    const marker = buf[p + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = dv.getUint16(p + 2);
    if (marker === 0xe2 && buf[p + 4] === 0x4d && buf[p + 5] === 0x50 && buf[p + 6] === 0x46 && buf[p + 7] === 0) {
      return parseMpIndex(buf, dv, p + 8, p + 2 + len);
    }
    p += 2 + len;
  }
  return null;
}

function parseMpIndex(buf: Uint8Array, dv: DataView, tiff: number, end: number): [number, number][] | null {
  const le = buf[tiff] === 0x49; // "II"
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (tiff + 8 > end) return null;
  const ifd = tiff + u32(tiff + 4);
  const n = u16(ifd);
  let count = 0, entriesOff = -1;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    const tag = u16(e);
    if (tag === 0xb001) count = u32(e + 8); // NumberOfImages
    if (tag === 0xb002) entriesOff = tiff + u32(e + 8); // MPEntry (16 bytes per image)
  }
  if (count < 2 || entriesOff < 0 || entriesOff + count * 16 > buf.length) return null;
  const ranges: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const e = entriesOff + i * 16;
    const size = u32(e + 4);
    // first image's offset is 0 (file start); others are relative to the MPF TIFF header
    const start = i === 0 ? 0 : tiff + u32(e + 8);
    if (!size || start + size > buf.length) return null;
    ranges.push([start, start + size]);
  }
  return ranges;
}
