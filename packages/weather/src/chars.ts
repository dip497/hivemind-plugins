/**
 * The character pass every weather scene draws through: a scene paints a real picture (sky, shapes
 * with their silhouettes, light and shade, haze, glows) into a small canvas, and this turns it into
 * characters on the page's canvas, with WebGL, in two passes.
 *
 * - Per cell (a small framebuffer, one texel a cell): the picture's colour there, its brightness,
 *   and the brightness of the cells round it. Where the brightness turns sharply (Sobel), the cell
 *   is an edge, drawn with the line along it (`|`, `/`, `-`, `\`); elsewhere its character comes from
 *   its brightness on a ramp of the bundled face's own characters, ordered by how much of a cell each
 *   one covers (measured from the face as the atlas is made). In the rows drawn in braille, the cell
 *   is instead two columns of four dots, each lit by the picture's brightness at that dot against a
 *   fixed order that shimmers in time.
 * - Per pixel: the picture itself, smooth and dimmed, behind everything (so there is no grid and no
 *   hole between characters), the cell's character from an atlas of the face in the picture's colour
 *   there, brighter (by night) or darker (by day, ink on paper), and a soft bloom of the picture's
 *   lights over it.
 *
 * The picture is two texels a cell across and four down, the braille dots' own grid: the scene's
 * painting stays small and the GPU does the rest.
 */
import type { Draw2D } from "./cells";

/** How the characters are made of a scene's picture, by theme (each palette carries one). */
export interface CharLook {
  /** How bright the picture shows behind the characters (1 as it is). */
  under: number;
  /** A character's colour: the picture's there, times this (over 1 brighter, under 1 darker). */
  over: number;
  /** How strongly the picture's lights bloom over everything. */
  bloom: number;
  /** Brightness to ramp step: nothing at or under `floor` (the picture's own ground: a clear sky
   *  draws no characters), the densest character `full` above it. A light theme counts ink
   *  instead (`ink`): nothing at or over `floor`, the densest `full` darker. */
  floor: number;
  full: number;
  /** The same for braille dots: what brightness (or ink) lights all of a cell's dots. */
  dots: number;
  ink: boolean;
  /** How far the picture behind is washed toward white (by day: the characters, ink, carry the
   *  shapes). */
  wash: number;
  /** How sharp a turn of brightness (Sobel, 0 to 1) is drawn as an edge. */
  edge: number;
}

/** The characters a ramp may be chosen from, and those that draw edges, in this order: | / - \ */
const CANDIDATES = [" ", ".", "'", ",", ":", ";", "-", "~", "=", "+", "*", "x", "o", "%", "#", "&", "@"];
export const EDGES = ["|", "/", "-", "\\"];
/** How many steps the ramp has. */
const STEPS = 10;

/** A braille dot's radius in device px, for a cell `cw` CSS px wide at `dpr`. */
export const dotRadius = (cw: number, dpr: number) => Math.max(0.7, cw * dpr * 0.13);

const CELL_VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

/** Per cell: its colour (rgb) and its character (a): a ramp step, an edge (64 +), or braille dots. */
const CELL_FS = `#version 300 es
precision highp float;
uniform sampler2D pic, marks;
uniform vec2 cells;
uniform float steps, floor0, full, dots, edge, braille, time;
uniform bool ink;
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float L(vec2 cell) { return lum(texture(pic, (cell + 0.5) / cells).rgb); }
float hash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec3 c = texture(pic, (cell + 0.5) / cells).rgb;
  if (cell.y < braille) {
    // Two dots across, four down: each texel of the picture is one dot.
    ivec2 at = ivec2(cell) * ivec2(2, 4);
    float bits = 0.0;
    vec3 lit = vec3(0.0);
    float n = 0.0;
    const float order[8] = float[8](0.0, 5.0, 2.0, 7.0, 4.0, 1.0, 6.0, 3.0);
    for (int k = 0; k < 8; k++) {
      vec3 d = texelFetch(pic, at + ivec2(k & 1, k >> 1), 0).rgb;
      float v = (ink ? floor0 - lum(d) : lum(d) - floor0) / dots;
      float turn = floor(time * 2.5 + hash(vec3(cell, float(k))) * 4.0);
      float t = (order[k] + 0.5) / 8.0 * 0.75 + 0.25 * hash(vec3(cell * 2.0 + float(k), turn));
      if (v > t) { bits += exp2(float(k)); lit += d; n += 1.0; }
    }
    o = vec4(n > 0.0 ? lit / n : c, bits / 255.0);
    return;
  }
  // The cell's eight texels: their mean, and the brightest (or darkest, for ink), so a star or a
  // flake one texel wide still makes a character.
  ivec2 at = ivec2(cell) * ivec2(2, 4);
  vec3 sum = vec3(0.0);
  vec3 peak = c;
  float pl = ink ? 1.0 : 0.0;
  for (int k = 0; k < 8; k++) {
    vec3 d = texelFetch(pic, at + ivec2(k & 1, k >> 1), 0).rgb;
    sum += d;
    float dl = lum(d);
    if (ink ? dl < pl : dl > pl) { pl = dl; peak = d; }
  }
  c = sum / 8.0;
  float l = lum(c);
  if (ink ? pl < l - 0.25 : pl > l + 0.25) { l = mix(l, pl, 0.35); c = peak; }
  float tl = L(cell + vec2(-1, -1)), t = L(cell + vec2(0, -1)), tr = L(cell + vec2(1, -1));
  float ml = L(cell + vec2(-1, 0)), mr = L(cell + vec2(1, 0));
  float bl = L(cell + vec2(-1, 1)), b = L(cell + vec2(0, 1)), br = L(cell + vec2(1, 1));
  // y is down the window: the framebuffer's rows are the picture's rows.
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = ((bl + 2.0 * b + br) - (tl + 2.0 * t + tr)) * 0.69;
  float mag = length(vec2(gx, gy));
  float v = (ink ? floor0 - l : l - floor0) / full;
  float g;
  vec4 mk = texelFetch(marks, ivec2(cell), 0);
  float mark = floor(mk.a * 255.0 + 0.5);
  if (mark > 0.0) {
    // The scene's own character for a small thing here, in the colour it gives.
    g = 127.0 + mark;
    c = mk.rgb;
  } else if (mag > edge && v > 0.12) {
    float a = abs(gx) > 2.2 * abs(gy) ? 0.0 : abs(gy) > 2.2 * abs(gx) ? 2.0 : (gx * gy > 0.0 ? 1.0 : 3.0);
    g = 64.0 + a;
  } else {
    g = clamp(floor(max(v, 0.0) * steps), 0.0, steps - 1.0);
  }
  o = vec4(c, g / 255.0);
}`;

const SCREEN_FS = `#version 300 es
precision highp float;
uniform sampler2D pic, cellTex, atlas, glow;
uniform vec2 screen, cellPx;
uniform float under, wash, over, bloom, glyphs, steps, braille, dotR;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, screen.y - gl_FragCoord.y);
  vec2 cell = floor(p / cellPx);
  vec2 uv = (p - cell * cellPx) / cellPx;
  vec4 cd = texelFetch(cellTex, ivec2(cell), 0);
  float g = floor(cd.a * 255.0 + 0.5);
  vec3 col = mix(texture(pic, p / screen).rgb * under, vec3(1.0), wash);
  float m = 0.0;
  if (cell.y < braille) {
    vec2 q = uv * vec2(2.0, 4.0);
    vec2 sub = floor(q);
    float bit = sub.y * 2.0 + sub.x;
    if (mod(floor(g / exp2(bit)), 2.0) > 0.5) {
      vec2 d = (fract(q) - 0.5) * cellPx / vec2(2.0, 4.0);
      m = 1.0 - smoothstep(dotR - 0.6, dotR + 0.6, length(d));
    }
  } else {
    float k = g >= 128.0 ? steps + 4.0 + g - 128.0 : g >= 64.0 ? steps + g - 64.0 : g;
    m = texture(atlas, vec2((k + uv.x) / glyphs, uv.y)).a;
  }
  col = mix(col, min(cd.rgb * over, vec3(1.0)), m);
  vec3 gl = texture(glow, p / screen).rgb;
  col += gl * gl * bloom;
  o = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const prog = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
    gl.attachShader(prog, s);
  }
  gl.bindAttribLocation(prog, 0, "p");
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(prog)}`);
  return prog;
}

function texture(gl: WebGL2RenderingContext, filter: number) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** Turns a picture into characters on a canvas: `size` it, give it the face (`face`), then `draw`
 *  each frame with the picture as painted. */
export class CharPass {
  private gl: WebGL2RenderingContext;
  private cellProg: WebGLProgram;
  private screenProg: WebGLProgram;
  private picTex: WebGLTexture;
  private glowTex: WebGLTexture;
  private atlasTex: WebGLTexture;
  private cellTex: WebGLTexture;
  private marksTex: WebGLTexture;
  private fb: WebGLFramebuffer;
  /** The scene's own characters, which `draw`'s marks name (1 the first). */
  private extras: string[] = [];
  private cols = 0;
  private rows = 0;
  private cw = 8;
  private ch = 12;
  private dpr = 1;
  private family = "monospace";
  private atlasFor = "";
  /** The ramp the face gives, darkest first, and the glyph count of the atlas. */
  ramp: string[] = [];
  private glyphs = 0;
  /** The picture made small and soft, for the bloom. */
  private glow = new OffscreenCanvas(1, 1);
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private noMarks = new Uint8Array(0);

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.cellProg = compile(gl, CELL_VS, CELL_FS);
    this.screenProg = compile(gl, CELL_VS, SCREEN_FS);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.picTex = texture(gl, gl.LINEAR);
    this.glowTex = texture(gl, gl.LINEAR);
    this.atlasTex = texture(gl, gl.LINEAR);
    this.cellTex = texture(gl, gl.NEAREST);
    this.marksTex = texture(gl, gl.NEAREST);
    this.fb = gl.createFramebuffer()!;
  }

  private u(prog: WebGLProgram, name: string) {
    const key = `${prog === this.cellProg ? "c" : "s"}${name}`;
    if (!this.uniforms.has(key)) this.uniforms.set(key, this.gl.getUniformLocation(prog, name));
    return this.uniforms.get(key)!;
  }

  /** The window: `cols` by `rows` cells of `cw` by `ch` CSS px, at `dpr`. */
  size(width: number, height: number, dpr: number, cw: number, ch: number) {
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    this.cols = Math.ceil(width / cw);
    this.rows = Math.ceil(height / ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cellTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.atlasFor = "";
  }

  /** The face the characters are drawn in, and the scene's own characters for its small things. */
  face(family: string, extras: string[] = this.extras) {
    this.family = family;
    this.extras = extras;
    this.atlasFor = "";
  }

  /** The atlas: the ramp's characters, then the edges', each a cell of device pixels, white; the
   *  ramp chosen by how much of a cell each candidate covers in this face. */
  private makeAtlas() {
    const key = `${this.family}|${this.cw}|${this.ch}|${this.dpr}`;
    if (key === this.atlasFor) return;
    this.atlasFor = key;
    const w = Math.max(1, Math.round(this.cw * this.dpr));
    const h = Math.max(1, Math.round(this.ch * this.dpr));
    const one = new OffscreenCanvas(w, h);
    const g = one.getContext("2d", { willReadFrequently: true }) as Draw2D | null;
    if (!g) return;
    const font = `600 ${Math.round(this.ch * 0.74 * this.dpr)}px ${this.family}`;
    const cover = (ch: string) => {
      g.clearRect(0, 0, w, h);
      g.font = font;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = "#fff";
      g.fillText(ch, w / 2, h / 2 + this.dpr);
      const d = g.getImageData(0, 0, w, h).data;
      let s = 0;
      for (let i = 3; i < d.length; i += 4) s += d[i]!;
      return s / (255 * w * h);
    };
    const measured = CANDIDATES.map((ch) => ({ ch, c: cover(ch) })).sort((a, b) => a.c - b.c);
    const most = measured[measured.length - 1]!.c;
    // Ten steps, each the candidate nearest an even share of the densest one's cover.
    this.ramp = Array.from({ length: STEPS }, (_, k) => {
      const want = (most * k) / (STEPS - 1);
      return measured.reduce((best, m) => (Math.abs(m.c - want) < Math.abs(best.c - want) ? m : best)).ch;
    });
    const all = [...this.ramp, ...EDGES, ...this.extras];
    this.glyphs = all.length;
    const atlas = new OffscreenCanvas(w * all.length, h);
    const a = atlas.getContext("2d");
    if (!a) return;
    a.font = font;
    a.textAlign = "center";
    a.textBaseline = "middle";
    a.fillStyle = "#fff";
    all.forEach((ch, k) => a.fillText(ch, k * w + w / 2, h / 2 + this.dpr));
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  }

  /** Draw `picture` (two texels a cell across, four down) as characters, by `look`; the top
   *  `braille` rows of cells as braille dots, at `time` (s) for their shimmer; and each cell `marks`
   *  names (four bytes a cell, row by row: its colour, then 0 for none or k for the kth of the
   *  scene's own characters) as that character in that colour. */
  draw(picture: OffscreenCanvas, look: CharLook, braille = 0, time = 0, marks: Uint8Array | null = null) {
    const gl = this.gl;
    this.makeAtlas();
    gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
    const n = this.cols * this.rows * 4;
    const given = marks && marks.length === n ? marks : this.noMarks.length === n ? this.noMarks : (this.noMarks = new Uint8Array(n));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, given);
    gl.bindTexture(gl.TEXTURE_2D, this.picTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, picture);
    // The bloom: the picture a quarter its size, smoothed.
    const gw = Math.max(1, picture.width >> 2);
    const gh = Math.max(1, picture.height >> 2);
    if (this.glow.width !== gw || this.glow.height !== gh) {
      this.glow.width = gw;
      this.glow.height = gh;
    }
    const gctx = this.glow.getContext("2d");
    if (gctx) {
      gctx.imageSmoothingEnabled = true;
      gctx.drawImage(picture, 0, 0, gw, gh);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.glowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.glow);

    // Per cell.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);
    gl.viewport(0, 0, this.cols, this.rows);
    gl.useProgram(this.cellProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.picTex);
    gl.uniform1i(this.u(this.cellProg, "pic"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.marksTex);
    gl.uniform1i(this.u(this.cellProg, "marks"), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(this.u(this.cellProg, "cells"), this.cols, this.rows);
    gl.uniform1f(this.u(this.cellProg, "steps"), STEPS);
    gl.uniform1f(this.u(this.cellProg, "floor0"), look.floor);
    gl.uniform1f(this.u(this.cellProg, "full"), look.full);
    gl.uniform1f(this.u(this.cellProg, "dots"), look.dots);
    gl.uniform1f(this.u(this.cellProg, "edge"), look.edge);
    gl.uniform1f(this.u(this.cellProg, "braille"), braille);
    gl.uniform1f(this.u(this.cellProg, "time"), time);
    gl.uniform1i(this.u(this.cellProg, "ink"), look.ink ? 1 : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Per pixel.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.screenProg);
    const bind = (unit: number, tex: WebGLTexture, name: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(this.u(this.screenProg, name), unit);
    };
    bind(0, this.picTex, "pic");
    bind(1, this.cellTex, "cellTex");
    bind(2, this.atlasTex, "atlas");
    bind(3, this.glowTex, "glow");
    gl.uniform2f(this.u(this.screenProg, "screen"), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u(this.screenProg, "cellPx"), this.cw * this.dpr, this.ch * this.dpr);
    gl.uniform1f(this.u(this.screenProg, "under"), look.under);
    gl.uniform1f(this.u(this.screenProg, "wash"), look.wash);
    gl.uniform1f(this.u(this.screenProg, "over"), look.over);
    gl.uniform1f(this.u(this.screenProg, "bloom"), look.bloom);
    gl.uniform1f(this.u(this.screenProg, "glyphs"), this.glyphs);
    gl.uniform1f(this.u(this.screenProg, "steps"), STEPS);
    gl.uniform1f(this.u(this.screenProg, "braille"), braille);
    gl.uniform1f(this.u(this.screenProg, "dotR"), dotRadius(this.cw, this.dpr));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }
}
