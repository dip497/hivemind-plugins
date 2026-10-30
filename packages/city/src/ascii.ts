/**
 * A picture turned into characters, the way a good ASCII shader does it. A scene paints a real
 * picture (its sky, its light and shade, its haze, its glowing lights) into a small canvas, a few
 * samples to each character cell; this turns it into characters in two passes on the GPU:
 *
 * 1. For each cell: its colour (the mean of its samples); how much the scene's shapes change across
 *    it and which way (Sobel on each sample of a second picture the scene paints, of its shapes
 *    alone: a skyline's silhouettes without their windows), summed as a structure tensor; and from
 *    those its character: on an edge, a line along it (`|`, `-`, `_`, `/`, `\`), so outlines are drawn with
 *    lines; elsewhere a character from a ramp ordered by how much of the cell each covers in the
 *    face the wallpaper brings, denser where the picture is brighter (darker, by day). A scene may
 *    set a cell's character itself (a name on a map, a spark).
 * 2. For each pixel: its cell's character from a glyph atlas drawn in that face, in the cell's
 *    colour, over the picture itself (smoothed and dimmed at night, as it is by day, crisp), so there
 *    are no holes between characters and no seams between cells; and at night the picture's bright
 *    parts, blurred from its mipmaps, added as a glow round the lights.
 *
 * Without WebGL2 the picture is shown as it is (smoothed, if its style is soft), without characters.
 */

/** Samples a cell, across and down. */
export const SUB_X = 3;
export const SUB_Y = 4;
/** The characters a cell can take: printable ASCII, then the overline. */
const FIRST = 32;
const LAST = 126;
export const GLYPHS = Array.from({ length: LAST - FIRST + 1 }, (_, i) => String.fromCharCode(FIRST + i)).join("") + "¯";
/** A character's index in the atlas. */
export const glyphIndex = (ch: string) => (ch === "¯" ? LAST - FIRST + 1 : ch.charCodeAt(0) - FIRST);
/** The ramp's candidates, ordered at run time by how much of a cell each covers. */
const RAMP = " .:-=+*#%@";

/** How a scene wants its picture turned into characters. */
export interface AsciiStyle {
  dark: boolean;
  /** How much brighter (darker, by day) a character is than the picture under it. */
  ink: number;
  /** The background: the picture dimmed to this share at night, or this far toward `paper` by day;
   *  and how soft (a mipmap level: 1 a little, 3 a lot; 0, crisp, each sample as it is). */
  ground: number;
  soft: number;
  paper: readonly [number, number, number];
  /** How strong the glow round bright parts is, and from what brightness. */
  bloom: number;
  bloomFrom: number;
  /** How sharp a change of the shapes across a cell is drawn as an edge (null: none, the picture's
   *  own edges are the outlines), and how much brighter (darker, by day) its line is than the cell. */
  edge: number | null;
  edgeInk: number;
  /** The least light of a line at night (the most, by day): its rim. */
  rim: readonly [number, number, number];
  /** Density: brightness (darkness, by day) at which the ramp starts and where it is full. */
  from: number;
  to: number;
}

const QUAD_VS = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const CELL_FS = `#version 300 es
precision highp float; precision highp int;
#define SX ${SUB_X}
#define SY ${SUB_Y}
uniform sampler2D u_pic;
uniform sampler2D u_shape;
uniform sampler2D u_force;
uniform ivec2 u_picSize;
uniform float u_dark, u_edge, u_from, u_to, u_edgeInk;
uniform vec3 u_rim;
uniform int u_ramp[10];
uniform int u_glyph[6];
out vec4 o;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec4 f = texelFetch(u_force, cell, 0);
  ivec2 base = cell * ivec2(SX, SY);
  float L[(SX + 2) * (SY + 2)];
  vec3 sum = vec3(0.0);
  // The cell's most telling sample: its brightest at night, its darkest by day (a line's own colour).
  vec3 ext = vec3(1.0 - u_dark);
  float extL = 1.0 - u_dark;
  for (int j = -1; j <= SY; j++) for (int i = -1; i <= SX; i++) {
    ivec2 at = clamp(base + ivec2(i, j), ivec2(0), u_picSize - 1);
    L[(j + 1) * (SX + 2) + i + 1] = texelFetch(u_shape, at, 0).r;
    if (i >= 0 && j >= 0 && i < SX && j < SY) {
      vec3 c = texelFetch(u_pic, at, 0).rgb;
      sum += c;
      float l = lum(c);
      if (u_dark > 0.5 ? l > extL : l < extL) { ext = c; extL = l; }
    }
  }
  vec3 mean = sum / float(SX * SY);
  float jxx = 0.0, jyy = 0.0, jxy = 0.0, mag = 0.0, my = 0.0;
  for (int j = 1; j <= SY; j++) for (int i = 1; i <= SX; i++) {
    #define A(x, y) L[(j + (y)) * (SX + 2) + i + (x)]
    float gx = (A(1, -1) + 2.0 * A(1, 0) + A(1, 1)) - (A(-1, -1) + 2.0 * A(-1, 0) + A(-1, 1));
    float gy = (A(-1, 1) + 2.0 * A(0, 1) + A(1, 1)) - (A(-1, -1) + 2.0 * A(0, -1) + A(1, -1));
    jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
    float m = sqrt(gx * gx + gy * gy);
    mag += m; my += m * (float(j) - 0.5) / float(SY);
  }
  float strength = mag / float(SX * SY);
  float lm = lum(mean);
  float t = clamp((mix(1.0 - lm, lm, u_dark) - u_from) / max(1e-3, u_to - u_from), 0.0, 1.0);
  int g;
  bool edge = false;
  if (f.a > 0.0) { g = int(f.a * 255.0 + 0.5) - 1 + 128; mean = f.rgb; }
  else if (strength > u_edge) {
    edge = true;
    // The way the brightness changes; the edge runs across it.
    float th = 0.5 * atan(2.0 * jxy, jxx - jyy);
    float a = abs(th);
    float at = my / max(1e-4, mag);
    if (a < 0.3927) g = u_glyph[0];
    else if (a > 1.1781) g = at > 0.64 ? u_glyph[2] : at < 0.36 ? u_glyph[3] : u_glyph[1];
    else g = th > 0.0 ? u_glyph[4] : u_glyph[5];
  } else g = u_ramp[int(t * 9.0 + 0.5)];
  // An edge is drawn brighter (darker, by day) than the mean of its cell: a line.
  if (edge) mean = u_dark > 0.5 ? max(min(vec3(1.0), mix(mean, ext, 0.6) * u_edgeInk), u_rim) : min(mix(mean, ext, 0.8) * u_edgeInk, u_rim);
  o = vec4(mean, float(g + 1) / 255.0);
}`;

const SCREEN_FS = `#version 300 es
precision highp float; precision highp int;
uniform sampler2D u_cells, u_atlas, u_pic;
uniform vec2 u_cell, u_size, u_grid, u_glyphPx;
uniform float u_dark, u_ink, u_ground, u_bloom, u_bloomFrom, u_soft;
uniform vec3 u_paper;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 cf = p / u_cell;
  ivec2 cell = ivec2(cf);
  vec2 inside = fract(cf);
  vec4 c = texelFetch(u_cells, cell, 0);
  int g = int(c.a * 255.0 + 0.5) - 1;
  // A character the scene set itself is shown in the colour it gave.
  bool exact = g >= 128;
  if (exact) g -= 128;
  float cov = g < 0 ? 0.0 : texelFetch(u_atlas, ivec2(g * int(u_glyphPx.x) + int(inside.x * u_glyphPx.x), int(inside.y * u_glyphPx.y)), 0).a;
  vec2 uv = p / (u_cell * u_grid);
  vec3 soft = u_soft > 0.0 ? textureLod(u_pic, uv, u_soft).rgb : texelFetch(u_pic, ivec2(uv * vec2(textureSize(u_pic, 0))), 0).rgb;
  vec3 col;
  if (u_dark > 0.5) {
    vec3 ink = exact ? c.rgb : min(vec3(1.0), c.rgb * u_ink + vec3(0.04));
    col = mix(soft * u_ground, ink, cov);
    vec3 glow = textureLod(u_pic, uv, 3.0).rgb * 0.55 + textureLod(u_pic, uv, 4.6).rgb * 0.45;
    col += max(glow - vec3(u_bloomFrom), vec3(0.0)) * u_bloom;
  } else {
    vec3 ink = exact ? c.rgb : c.rgb * u_ink;
    col = mix(mix(soft, u_paper, u_ground), ink, cov);
    vec3 glow = textureLod(u_pic, uv, 3.5).rgb;
    col = mix(col, glow, u_bloom * 0.25);
  }
  o = vec4(col, 1.0);
}`;

function shader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}
function program(gl: WebGL2RenderingContext, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, QUAD_VS));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "a");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link");
  return p;
}

/** The picture a scene paints into, its shapes alone (in greys: a different grey each side of an
 *  outline), and the characters it may set itself, cell by cell. */
export class Picture {
  readonly canvas = new OffscreenCanvas(1, 1);
  readonly g: OffscreenCanvasRenderingContext2D;
  readonly shape = new OffscreenCanvas(1, 1);
  readonly s: OffscreenCanvasRenderingContext2D;
  /** The shapes changed since they were last turned into characters. */
  shapeDirty = true;
  /** Per cell: a character set by the scene (its index + 1, 0 for none) and its colour. */
  force = new Uint8Array(0);
  cols = 0;
  rows = 0;
  forced = false;
  constructor() {
    this.g = this.canvas.getContext("2d")!;
    this.s = this.shape.getContext("2d")!;
  }
  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.canvas.width = this.shape.width = cols * SUB_X;
    this.canvas.height = this.shape.height = rows * SUB_Y;
    this.shapeDirty = true;
    this.force = new Uint8Array(cols * rows * 4);
  }
  /** Ready to paint in css px: the cell grid's `cw` by `ch` cells map onto the samples. */
  begin(cw: number, ch: number) {
    this.g.setTransform(SUB_X / cw, 0, 0, SUB_Y / ch, 0, 0);
    this.s.setTransform(SUB_X / cw, 0, 0, SUB_Y / ch, 0, 0);
    this.g.globalAlpha = 1;
    this.g.globalCompositeOperation = "source-over";
    if (this.forced) {
      this.force.fill(0);
      this.forced = false;
    }
  }
  /** Set the cell (c, r) to `ch` in colour (r, g, b 0–255), shown as it is given. */
  set(c: number, r: number, ch: string, [cr, cg, cb]: readonly [number, number, number]) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    const i = (r * this.cols + c) * 4;
    this.force[i] = cr;
    this.force[i + 1] = cg;
    this.force[i + 2] = cb;
    this.force[i + 3] = glyphIndex(ch) + 1;
    this.forced = true;
  }
}

export class AsciiPass {
  private gl: WebGL2RenderingContext | null = null;
  private fallback: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  private cellProg!: WebGLProgram;
  private screenProg!: WebGLProgram;
  private tex: Record<"pic" | "shape" | "force" | "cells" | "atlas", WebGLTexture> = {} as never;
  private fbo!: WebGLFramebuffer;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private v: Record<string, WebGLUniformLocation | null> = {};
  private grid = { cols: 0, rows: 0, cw: 8, ch: 12, dpr: 1 };
  private glyphPx = { w: 1, h: 1 };
  private ramp: number[] = [];
  private family = "";
  /** How much of a cell each character of the ramp covers, 0 to 1: measured from the face. */
  coverage: { ch: string; covers: number }[] = [];

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, preserveDrawingBuffer: true, powerPreference: "low-power" }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.fallback = canvas.getContext("2d") as CanvasRenderingContext2D | null;
      return;
    }
    this.gl = gl;
    this.cellProg = program(gl, CELL_FS);
    this.screenProg = program(gl, SCREEN_FS);
    for (const n of ["u_pic", "u_shape", "u_force", "u_picSize", "u_dark", "u_edge", "u_edgeInk", "u_rim", "u_from", "u_to", "u_ramp", "u_glyph"]) this.u[n] = gl.getUniformLocation(this.cellProg, n);
    for (const n of ["u_cells", "u_atlas", "u_pic", "u_cell", "u_size", "u_grid", "u_glyphPx", "u_dark", "u_ink", "u_ground", "u_soft", "u_bloom", "u_bloomFrom", "u_paper"]) this.v[n] = gl.getUniformLocation(this.screenProg, n);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const k of ["pic", "shape", "force", "cells", "atlas"] as const) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, k === "pic" ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, k === "pic" ? gl.LINEAR : gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tex[k] = t;
    }
    this.fbo = gl.createFramebuffer()!;
  }

  /** The grid, and the face its characters are drawn in: the atlas is drawn again when either
   *  changes. */
  resize(cols: number, rows: number, cw: number, ch: number, dpr: number, family: string) {
    const g = this.grid;
    const same = g.cols === cols && g.rows === rows && g.cw === cw && g.ch === ch && g.dpr === dpr && this.family === family;
    Object.assign(this.grid, { cols, rows, cw, ch, dpr });
    if (same) return;
    this.family = family;
    const gl = this.gl;
    if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, this.tex.cells);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex.cells, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.drawAtlas(cw, ch, dpr, family);
  }

  /** Every character, white on clear, one to a cell's size in device px; and the ramp ordered by
   *  how much of its cell each covers. */
  private drawAtlas(cw: number, ch: number, dpr: number, family: string) {
    const gl = this.gl!;
    const w = Math.max(1, Math.round(cw * dpr));
    const h = Math.max(1, Math.round(ch * dpr));
    this.glyphPx = { w, h };
    const atlas = new OffscreenCanvas(w * GLYPHS.length, h);
    const g = atlas.getContext("2d")!;
    g.font = `600 ${Math.round(ch * 0.74 * dpr)}px ${family}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i]!, i * w + w / 2, h / 2 + dpr);
    const data = g.getImageData(0, 0, atlas.width, h).data;
    this.coverage = [...RAMP].map((c) => {
      const i = glyphIndex(c);
      let s = 0;
      for (let y = 0; y < h; y++) for (let x = i * w; x < (i + 1) * w; x++) s += data[(y * atlas.width + x) * 4 + 3]!;
      return { ch: c, covers: s / (255 * w * h) };
    }).sort((a, b) => a.covers - b.covers);
    this.ramp = this.coverage.map((c) => glyphIndex(c.ch));
    gl.bindTexture(gl.TEXTURE_2D, this.tex.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  }

  /** Turn `pic` into characters on the canvas, in `style`. */
  draw(pic: Picture, style: AsciiStyle) {
    const { cols, rows, cw, ch, dpr } = this.grid;
    const gl = this.gl;
    if (!gl) {
      const f = this.fallback;
      if (!f) return;
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.imageSmoothingEnabled = style.soft > 0;
      f.drawImage(pic.canvas, 0, 0, Math.round(cols * cw * dpr), Math.round(rows * ch * dpr));
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex.pic);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, pic.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (pic.shapeDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.tex.shape);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, pic.shape);
      pic.shapeDirty = false;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex.force);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, pic.force);

    // The cells' characters.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(this.cellProg);
    this.bind(0, this.tex.pic, this.u.u_pic!);
    this.bind(1, this.tex.force, this.u.u_force!);
    this.bind(2, this.tex.shape, this.u.u_shape!);
    gl.uniform2i(this.u.u_picSize!, pic.canvas.width, pic.canvas.height);
    gl.uniform1f(this.u.u_dark!, style.dark ? 1 : 0);
    // No edges: a strength no change across a cell reaches.
    gl.uniform1f(this.u.u_edge!, style.edge ?? 1e9);
    gl.uniform1f(this.u.u_edgeInk!, style.edgeInk);
    gl.uniform3f(this.u.u_rim!, style.rim[0] / 255, style.rim[1] / 255, style.rim[2] / 255);
    gl.uniform1f(this.u.u_from!, style.from);
    gl.uniform1f(this.u.u_to!, style.to);
    gl.uniform1iv(this.u.u_ramp!, this.ramp);
    gl.uniform1iv(this.u.u_glyph!, ["|", "-", "_", "¯", "/", "\\"].map(glyphIndex));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // The window.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.screenProg);
    this.bind(0, this.tex.cells, this.v.u_cells!);
    this.bind(1, this.tex.atlas, this.v.u_atlas!);
    this.bind(2, this.tex.pic, this.v.u_pic!);
    gl.uniform2f(this.v.u_cell!, cw * dpr, ch * dpr);
    gl.uniform2f(this.v.u_size!, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.v.u_grid!, cols, rows);
    gl.uniform2f(this.v.u_glyphPx!, this.glyphPx.w, this.glyphPx.h);
    gl.uniform1f(this.v.u_dark!, style.dark ? 1 : 0);
    gl.uniform1f(this.v.u_ink!, style.ink);
    gl.uniform1f(this.v.u_ground!, style.ground);
    gl.uniform1f(this.v.u_soft!, style.soft);
    gl.uniform1f(this.v.u_bloom!, style.bloom);
    gl.uniform1f(this.v.u_bloomFrom!, style.bloomFrom);
    gl.uniform3f(this.v.u_paper!, style.paper[0] / 255, style.paper[1] / 255, style.paper[2] / 255);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private bind(unit: number, t: WebGLTexture, at: WebGLUniformLocation) {
    const gl = this.gl!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(at, unit);
  }
}
