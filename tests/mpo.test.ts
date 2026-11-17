import { describe, expect, it } from 'vitest';
import { isDepthJpeg, jpegSize, mpoImageRanges } from '../src/core/mpo';

/** A minimal JPEG: SOI, optional APP1 XMP, SOF0 with the size, padding, EOI. */
function jpeg(w: number, h: number, xmp = '', pad = 100): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  if (xmp) {
    const body = new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0' + xmp);
    parts.push(0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 255, ...body);
  }
  parts.push(0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0);
  for (let i = 0; i < pad; i++) parts.push(0);
  parts.push(0xff, 0xd9);
  return Uint8Array.from(parts);
}

/** An MPF file: the first JPEG gets an APP2 MP Index listing every image. */
function mpf(images: Uint8Array[]): Uint8Array {
  const n = images.length;
  // APP2 payload: "MPF\0" + TIFF header (II) + IFD (2 entries) + MP entries
  const ifdOff = 8, entries = ifdOff + 2 + 2 * 12 + 4;
  const tiff = new Uint8Array(entries + n * 16);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0]); dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, 2, true);
  dv.setUint16(ifdOff + 2, 0xb001, true); dv.setUint16(ifdOff + 4, 4, true); dv.setUint32(ifdOff + 6, 1, true); dv.setUint32(ifdOff + 10, n, true);
  dv.setUint16(ifdOff + 14, 0xb002, true); dv.setUint16(ifdOff + 16, 7, true); dv.setUint32(ifdOff + 18, n * 16, true); dv.setUint32(ifdOff + 22, entries, true);
  const seg = new Uint8Array(4 + 4 + tiff.length);
  seg.set([0xff, 0xe2, (seg.length - 2) >> 8, (seg.length - 2) & 255]); seg.set([0x4d, 0x50, 0x46, 0], 4); seg.set(tiff, 8);
  const first = new Uint8Array(images[0].length + seg.length);
  first.set(images[0].subarray(0, 2)); first.set(seg, 2); first.set(images[0].subarray(2), 2 + seg.length);
  const tiffStart = 2 + 8; // where the TIFF header sits in the file
  const all = [first, ...images.slice(1)];
  let off = 0;
  all.forEach((img, i) => {
    dv.setUint32(entries + i * 16 + 4, img.length, true);
    dv.setUint32(entries + i * 16 + 8, i === 0 ? 0 : off - tiffStart, true);
    off += img.length;
  });
  // rewrite the TIFF block with the offsets filled in
  first.set(tiff, 2 + 8);
  const out = new Uint8Array(off);
  let at = 0;
  for (const img of all) { out.set(img, at); at += img.length; }
  return out;
}

describe('JPEG / MPF parsing', () => {
  it('reads a JPEG size', () => {
    expect(jpegSize(jpeg(4032, 3024))).toEqual({ w: 4032, h: 3024 });
    expect(jpegSize(jpeg(640, 480, '<x:xmpmeta/>'))).toEqual({ w: 640, h: 480 });
  });
  it('recognises an Apple depth map and not a matte', () => {
    expect(isDepthJpeg(jpeg(768, 576, '<rdf:Description xmlns:apdi="http://ns.apple.com/depthData/1.0/" apdi:NativeFormat="1717856627"/>'))).toBe(true);
    expect(isDepthJpeg(jpeg(2016, 1512, '<rdf:Description xmlns:apdi="http://ns.apple.com/pixeldatainfo/1.0/" apdi:AuxiliaryImageType="urn:com:apple:photo:2018:aux:portraiteffectsmatte"/>'))).toBe(false);
    expect(isDepthJpeg(jpeg(800, 600))).toBe(false);
  });
  it('lists the images of an MPF file with their sizes', () => {
    const file = mpf([jpeg(4032, 3024, '', 3000), jpeg(768, 576, 'xmlns:apdi="http://ns.apple.com/depthData/1.0/"', 500)]);
    const r = mpoImageRanges(file)!;
    expect(r).toHaveLength(2);
    expect(jpegSize(file, r[0][0])).toEqual({ w: 4032, h: 3024 });
    expect(jpegSize(file, r[1][0])).toEqual({ w: 768, h: 576 });
    expect(isDepthJpeg(file.subarray(r[1][0], r[1][1]))).toBe(true);
  });
});
