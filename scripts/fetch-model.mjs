// Downloads the Depth Anything V2 Small depth-estimation model (Apache-2.0) into
// public/models/, split into <15 MB parts (claude.ai artifacts cap single files at 15 MB).
// Runs automatically before `npm run build`; skips if the model is already present.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = 'onnx-community/depth-anything-v2-small';
const FILE = 'onnx/model_quantized.onnx';
const OUT = 'public/models/depth-anything-v2-small';
const PART = 12 * 1024 * 1024;

if (existsSync(join(OUT, 'manifest.json')) && existsSync(join(OUT, 'model.part0.wasm'))) {
  console.log('depth model already present');
  process.exit(0);
}
const url = `https://huggingface.co/${MODEL}/resolve/main/${FILE}`;
console.log(`downloading ${url}`);
let buf;
try {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  buf = new Uint8Array(await res.arrayBuffer());
} catch (e) {
  // building without the model is allowed; depth estimation then reports it as unavailable
  console.warn(`could not download the depth model (${e.message}); depth estimation will be unavailable`);
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
const parts = [];
for (let i = 0, o = 0; o < buf.length; i++, o += PART) {
  // .wasm extension only so static hosts (incl. claude.ai artifacts) serve the raw bytes; the worker reads them as binary
  const name = `model.part${i}.wasm`;
  writeFileSync(join(OUT, name), buf.subarray(o, o + PART));
  parts.push(name);
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({
  model: MODEL, file: FILE, license: 'Apache-2.0', size: buf.length, parts,
  input: 'pixel_values', output: 'predicted_depth', patch: 14, size_px: 518,
  mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
}, null, 2));
console.log(`saved ${parts.length} parts (${(buf.length / 1e6).toFixed(1)} MB) to ${OUT}`);
