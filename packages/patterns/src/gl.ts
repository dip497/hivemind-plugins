/**
 * What every pattern's WebGL2 drawing shares: a context on the page's canvas, programs, textures,
 * render targets, and the one triangle that covers a target. Each pass is a full-target triangle
 * whose fragment shader works out one texel (a cell, a pixel of the picture, a pixel of the screen).
 *
 * Every texture here keeps the convention a canvas has: row 0 is the top. A pass rendering into a
 * target writes its row 0 at gl_FragCoord.y = 0.5, so the same holds for what it draws; only the
 * screen (the default framebuffer) has its row 0 at the bottom, and the last pass flips for it.
 */

export type GL = WebGL2RenderingContext;

/** A WebGL2 context on `canvas`, or null where there is none (the pattern then draws in 2D). */
export function webgl(canvas: HTMLCanvasElement | OffscreenCanvas): GL | null {
  const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" }) as GL | null;
  return gl;
}

/** The vertex shader of every pass: one triangle over the whole target, `vUv` 0 … 1 across it,
 *  `vUv.y` 0 at row 0 of a target (its top, by the convention above; the screen's bottom). */
const VERTEX = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The precision and output every fragment shader starts with. */
export const FRAGMENT_HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
`;

export interface Program {
  program: WebGLProgram;
  /** Where each uniform is, by name, looked up once. */
  at(name: string): WebGLUniformLocation | null;
}

function shader(gl: GL, type: number, source: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

/** A program from a fragment shader's body (after FRAGMENT_HEAD). */
export function program(gl: GL, fragment: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT_HEAD + fragment));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program: p,
    at(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
      return cache.get(name)!;
    },
  };
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/** An RGBA8 texture, filtered linearly or not, clamped at its edges. */
export function texture(gl: GL, w: number, h: number, linear: boolean, data: ArrayBufferView | null = null, format: "rgba8" | "r8" | "r32f" = "rgba8"): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const f = linear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (format === "r8") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  else if (format === "r32f") gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return tex;
}

/** Replace all of `tex` (made by `texture`, `w` by `h`) with `data`. */
export function upload(gl: GL, tex: WebGLTexture, w: number, h: number, data: ArrayBufferView, format: "rgba8" | "r8" | "r32f" = "rgba8") {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (format === "r8") gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
  else if (format === "r32f") gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RED, gl.FLOAT, data);
  else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
}

/** A texture to render into, `w` by `h`. */
export function target(gl: GL, w: number, h: number, linear = true): Target {
  const tex = texture(gl, w, h, linear);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { tex, fbo, w, h };
}

export function dropTarget(gl: GL, t: Target | null) {
  if (!t) return;
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}

/** Run `p` over all of `to` (a target, or the screen of `w` by `h` device pixels when null),
 *  `bind` setting its uniforms and textures first. */
export function pass(gl: GL, p: Program, to: Target | { w: number; h: number; fbo?: undefined }, bind: (p: Program) => void) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo ?? null);
  gl.viewport(0, 0, to.w, to.h);
  gl.useProgram(p.program);
  bind(p);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** Bind `tex` to texture unit `unit` as the sampler `name` of `p`. */
export function bindTex(gl: GL, p: Program, name: string, tex: WebGLTexture, unit: number) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(p.at(name), unit);
}

/** A separable Gaussian blur of a texture, in two passes (across, then down), each 9 taps reaching
 *  `reach` texels either side. */
export const BLUR = `
uniform sampler2D uSrc;
uniform vec2 uStep;
void main() {
  vec4 sum = texture(uSrc, vUv) * 0.2270270270;
  sum += (texture(uSrc, vUv + uStep * 1.3846153846) + texture(uSrc, vUv - uStep * 1.3846153846)) * 0.3162162162;
  sum += (texture(uSrc, vUv + uStep * 3.2307692308) + texture(uSrc, vUv - uStep * 3.2307692308)) * 0.0702702703;
  outColor = sum;
}`;

/** Blur `src` into `out` (through `tmp`, both its size): `reach` source texels a side. */
export function blur(gl: GL, p: Program, src: WebGLTexture, tmp: Target, out: Target, reach: number) {
  pass(gl, p, tmp, () => {
    bindTex(gl, p, "uSrc", src, 0);
    gl.uniform2f(p.at("uStep"), reach / 3.23 / tmp.w, 0);
  });
  pass(gl, p, out, () => {
    bindTex(gl, p, "uSrc", tmp.tex, 0);
    gl.uniform2f(p.at("uStep"), 0, reach / 3.23 / out.h);
  });
}
