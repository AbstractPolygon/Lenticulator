/**
 * GPU interlacing (WebGL2). Same maths as core/interlace.ts renderRows:
 * for every output pixel, Σ_frames weight(axis pixel, frame) × bilinear sample of the frame
 * (premultiplied, composited over the background). Each frame is one additive pass into a
 * half-float accumulation buffer; a final pass converts to 8-bit and the tile is read back.
 *
 * The print is processed in tiles; each tile uploads only the region of every frame it samples,
 * so GPU memory stays bounded however large the print or how many frames there are.
 */
import type { Affine } from '../core/geometry';
import { LensParams, Orientation, denseWeights, lensWeights, regionSourceRect } from '../core/interlace';
import type { RGBAImage } from '../core/interlace';

export interface GpuFrame {
  source: ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  /** output pixel → source pixel (continuous coordinates) */
  matrix: Affine;
}

export interface GpuJob {
  width: number;
  height: number;
  orientation: Orientation;
  lens: LensParams;
  frames: GpuFrame[];
  background: [number, number, number];
}

const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FS_FRAME = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D uFrame;
uniform highp sampler2D uWeights;
uniform vec2 uFrameSize;      // size of the uploaded crop
uniform mat3 uM;              // output pixel -> crop pixel
uniform vec2 uTileOrigin;     // output pixel of the tile's first texel
uniform int uVertical;
uniform int uWWidth;          // weights texture width
uniform int uWRow0;           // first weights row of this frame
uniform vec3 uBg;             // background, 0..1
out vec4 o;
void main() {
  vec2 px = uTileOrigin + floor(gl_FragCoord.xy);
  int ax = uVertical == 1 ? int(px.x) : int(px.y);
  float w = texelFetch(uWeights, ivec2(ax % uWWidth, uWRow0 + ax / uWWidth), 0).r;
  if (w <= 0.0) { o = vec4(0.0); return; }
  vec2 f = (uM * vec3(px + 0.5, 1.0)).xy;
  vec3 c;
  if (f.x < 0.0 || f.y < 0.0 || f.x > uFrameSize.x || f.y > uFrameSize.y) c = uBg;
  else { vec4 t = texture(uFrame, f / uFrameSize); c = t.rgb + (1.0 - t.a) * uBg; }
  o = vec4(w * c, 0.0);
}`;

const FS_RESOLVE = `#version 300 es
precision highp float;
uniform sampler2D uAcc;
out vec4 o;
void main() { o = vec4(texelFetch(uAcc, ivec2(gl_FragCoord.xy), 0).rgb, 1.0); }`;

let cached: { gl: WebGL2RenderingContext; ok: boolean } | null = null;

function context(): WebGL2RenderingContext | null {
  if (cached) return cached.ok ? cached.gl : null;
  try {
    const canvas: HTMLCanvasElement | OffscreenCanvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false }) as WebGL2RenderingContext | null;
    const ok = !!gl && !!gl.getExtension('EXT_color_buffer_float');
    cached = { gl: gl as WebGL2RenderingContext, ok };
    return ok ? gl : null;
  } catch {
    cached = { gl: null as unknown as WebGL2RenderingContext, ok: false };
    return null;
  }
}

/** True when this browser can render on the GPU (WebGL2 with float render targets). */
export function gpuAvailable(): boolean {
  return !!context();
}

function program(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

function texture(gl: WebGL2RenderingContext, filter: number): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/** Render the interlaced image (no page margins) on the GPU. Throws if WebGL2 is unavailable or fails. */
export async function renderGpu(job: GpuJob, onProgress?: (f: number) => void): Promise<RGBAImage> {
  const gl = context();
  if (!gl) throw new Error('GPU rendering is not available in this browser');
  const { width: W, height: H } = job;
  const N = job.frames.length;
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const TILE = Math.min(2048, maxTex);

  const frameProg = program(gl, FS_FRAME);
  const resolveProg = program(gl, FS_RESOLVE);
  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // lens weights as an R32F texture: frame f occupies rows [f*rows, (f+1)*rows)
  const count = job.orientation === 'vertical' ? W : H;
  const dense = denseWeights(lensWeights(count, { ...job.lens, frames: N }), count, N);
  const wWidth = Math.min(count, maxTex);
  const rows = Math.ceil(count / wWidth);
  const wData = new Float32Array(wWidth * rows * N);
  for (let f = 0; f < N; f++)
    for (let i = 0; i < count; i++) wData[(f * rows + Math.floor(i / wWidth)) * wWidth + (i % wWidth)] = dense[f * count + i];
  const weightsTex = texture(gl, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, wWidth, rows * N, 0, gl.RED, gl.FLOAT, wData);

  // accumulation (half float) and 8-bit output targets, one tile in size
  const accTex = texture(gl, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, TILE, TILE, 0, gl.RGBA, gl.HALF_FLOAT, null);
  const accFb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
  const outTex = texture(gl, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TILE, TILE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const outFb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, outTex, 0);
  const frameTex = texture(gl, gl.LINEAR);

  // premultiply on upload so bilinear filtering matches the CPU's premultiplied sampling
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  const U = (n: string) => gl.getUniformLocation(frameProg, n);
  const uFrame = U('uFrame'), uWeights = U('uWeights'), uFrameSize = U('uFrameSize'), uM = U('uM');
  const uTileOrigin = U('uTileOrigin'), uVertical = U('uVertical'), uWWidth = U('uWWidth'), uWRow0 = U('uWRow0'), uBg = U('uBg');

  const out = new Uint8ClampedArray(W * H * 4);
  const tileBuf = new Uint8Array(TILE * TILE * 4);
  const tilesX = Math.ceil(W / TILE), tilesY = Math.ceil(H / TILE);
  const bg = job.background.map((v) => v / 255);
  let done = 0;
  try {
    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        const x0 = tx * TILE, y0 = ty * TILE;
        const tw = Math.min(TILE, W - x0), th = Math.min(TILE, H - y0);

        gl.bindFramebuffer(gl.FRAMEBUFFER, accFb);
        gl.viewport(0, 0, tw, th);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(frameProg);
        gl.uniform1i(uFrame, 0);
        gl.uniform1i(uWeights, 1);
        gl.uniform2f(uTileOrigin, x0, y0);
        gl.uniform1i(uVertical, job.orientation === 'vertical' ? 1 : 0);
        gl.uniform1i(uWWidth, wWidth);
        gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, weightsTex);

        for (let f = 0; f < N; f++) {
          const fr = job.frames[f];
          const r = regionSourceRect(fr.matrix, x0, y0, x0 + tw, y0 + th, fr.width, fr.height);
          if (!r.w || !r.h) {
            // frame doesn't reach this tile: its weight contributes background only
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, frameTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
            gl.uniform2f(uFrameSize, 1, 1);
            gl.uniformMatrix3fv(uM, false, [0, 0, 0, 0, 0, 0, -10, -10, 1]); // always outside → background
          } else {
            // crop exactly the pixels this tile samples (exact copy at 1:1), scaled down only beyond the texture limit
            const s = Math.min(1, maxTex / Math.max(r.w, r.h));
            const cw = Math.max(1, Math.round(r.w * s)), ch = Math.max(1, Math.round(r.h * s));
            const crop = await createImageBitmap(fr.source, r.x, r.y, r.w, r.h,
              s < 1 ? { resizeWidth: cw, resizeHeight: ch, resizeQuality: 'high' } : undefined);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, frameTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, crop);
            crop.close();
            // output px → crop px:  scale(s) ∘ translate(-r) ∘ matrix
            const m = fr.matrix;
            const a = m[0] * s, b = m[1] * s, c = m[2] * s, d = m[3] * s, e = (m[4] - r.x) * s, g = (m[5] - r.y) * s;
            gl.uniform2f(uFrameSize, cw, ch);
            gl.uniformMatrix3fv(uM, false, [a, b, 0, c, d, 0, e, g, 1]);
          }
          gl.uniform1i(uWRow0, f * rows);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }

        // resolve to 8-bit and read back; framebuffer row 0 is output row y0
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, outFb);
        gl.viewport(0, 0, tw, th);
        gl.useProgram(resolveProg);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, accTex);
        gl.uniform1i(gl.getUniformLocation(resolveProg, 'uAcc'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.readPixels(0, 0, tw, th, gl.RGBA, gl.UNSIGNED_BYTE, tileBuf);
        for (let y = 0; y < th; y++) out.set(tileBuf.subarray(y * tw * 4, (y + 1) * tw * 4), ((y0 + y) * W + x0) * 4);

        onProgress?.(++done / (tilesX * tilesY));
        await tick();
      }
    }
    if (gl.isContextLost()) throw new Error('the GPU context was lost');
  } finally {
    for (const t of [weightsTex, accTex, outTex, frameTex]) gl.deleteTexture(t);
    gl.deleteFramebuffer(accFb);
    gl.deleteFramebuffer(outFb);
    gl.deleteBuffer(quad);
    gl.deleteProgram(frameProg);
    gl.deleteProgram(resolveProg);
  }
  return { width: W, height: H, data: out };
}
