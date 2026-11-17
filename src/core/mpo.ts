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

/** Width and height of the JPEG starting at `start` (from its SOF marker), or null. */
export function jpegSize(buf: Uint8Array, start = 0): { w: number; h: number } | null {
  if (buf[start] !== 0xff || buf[start + 1] !== 0xd8) return null;
  let p = start + 2;
  while (p + 9 < buf.length) {
    if (buf[p] !== 0xff) return null;
    const m = buf[p + 1];
    if (m === 0xff) { p++; continue; } // fill byte
    if (m === 0xd9 || m === 0xda) return null; // end of image / start of scan before any frame header
    const len = (buf[p + 2] << 8) | buf[p + 3];
    // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: (buf[p + 5] << 8) | buf[p + 6], w: (buf[p + 7] << 8) | buf[p + 8] };
    }
    p += 2 + len;
  }
  return null;
}

/**
 * Whether a JPEG is an auxiliary depth / disparity map, judged by its XMP (Apple portrait photos tag theirs with the
 * depthData namespace or an auxiliary type naming depth or disparity). Mattes and HDR gain maps are not depth.
 */
export function isDepthJpeg(part: Uint8Array): boolean {
  // the XMP sits in the header segments: look at the first 64 KB only
  const head = new TextDecoder('latin1').decode(part.subarray(0, Math.min(part.length, 65536)));
  if (/portraiteffectsmatte|hdrgainmap|semanticsegmentation/i.test(head)) return false;
  return /ns\.apple\.com\/depthData|apdi:|aux:depth|aux:disparity|AuxiliaryImageType[^>]{0,80}(depth|disparity)/i.test(head);
}
