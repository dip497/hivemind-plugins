/**
 * Sand drawn over a painted desert, in WebGL, with characters only where the sand is. The desert
 * is painted once for a window, to the pixel: a sky graded from its top down to a warm horizon, a
 * low sun and its glow, three ranges of flat-topped mesas, each further one hazier, their faces lit
 * on the sun's side; a plain below them with far dunes rolling across it. It has no characters but
 * the stars, a few, twinkling. Over it, each frame, the sand: its surface a smooth line across the
 * stacks' tops, its body the strata the spouts laid, lit warm on the side facing the sun and cool on
 * the other, darker deep down, the crests on the sun's side catching the light. Grains in the air
 * are smoothed down their stream into a ribbon, bending where its spout wandered. A click's puff of
 * dust is a ring of light. Then characters (charpass.ts): edge glyphs along the sand's outline, a
 * ramp's on its lit crests, a `|` down each falling stream, a spark for each grain a click threw;
 * the picture, sharp, everywhere else.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { CharPass } from "../charpass";
import { mix, rgbOf, type Oklch, type Rgb } from "../colour";
import { bindTex, pass, program, texture, upload, target, dropTarget, type GL, type Program, type Target } from "../gl";
import { FACE } from "../page";
import { hash2 } from "../random";
import type { Drawer } from "../scene";
import { SAND_GL_PALETTE, type SandGlPalette } from "./glpalette";
import { DUST_LIFE, DUST_SPEED, grainColour } from "./render";
import { CODES, type Sand } from "./sand";

/** Ranges of mesas, far to near, and how many buttes each. */
const RANGES = 3;
const BUTTES = 5;
/** Where the sun sets: across the window, and above the horizon (shares of its width and height). */
const SUN_X = 0.7;
const SUN_UP = 0.075;
/** The stars' glyphs, and how high in the sky they come (a share of the horizon's height). */
export const STAR_GLYPHS = ["+", "*"] as const;
const STARS_DOWN_TO = 0.55;
/** A falling stream's glyph, and a thrown grain's. */
export const STREAM = "|";
export const SPARK = "*";
/** How far into the sand its outline has edge glyphs, and its lit crests a ramp's (grains). */
export const OUTLINE = 1.2;
export const CREST = 3.5;

/** The desert, painted once for a window. Rows top first, to the device pixel. */
const BACKDROP = `
uniform vec2 uSize;
uniform float uDpr;
uniform vec3 uSky0, uSky1, uSky2, uSky3, uPlainFar, uPlainNear, uSun, uSunGlow, uMesa, uMesaLit, uDune, uDuneLit;
uniform vec2 uSunAt;
uniform float uSunR, uGlowK, uHorizonY;
uniform vec4 uButtes[${RANGES * BUTTES}];
uniform float uHazes[${RANGES}];
uniform int uInk;
// A butte: a flat top (half-width b.y), a cliff (b.w across) down to its scree, a skirt of scree
// widening below it; b.z tall.
float butte(vec4 b, float x) {
  float dx = abs(x - b.x);
  float cliff = b.w, skirt = b.y * 0.9;
  float h = dx < b.y ? 1.0 : dx < b.y + cliff ? mix(1.0, 0.42, pow((dx - b.y) / cliff, 0.6)) : 0.42 * pow(max(0.0, 1.0 - (dx - b.y - cliff) / skirt), 1.6);
  return b.z * h;
}
float ridge(int range, float x) {
  float top = 0.0;
  for (int i = 0; i < ${BUTTES}; i++) top = max(top, butte(uButtes[range * ${BUTTES} + i], x));
  return uHorizonY - top;
}
// Far dunes rolling across the plain: two rows, each a sum of slow waves.
float dune(int k, float x) {
  float f = float(k);
  float y = uHorizonY + uSize.y * (0.05 + 0.07 * f);
  float a = uSize.y * (0.016 + 0.012 * f);
  return y - a * (sin(x / uSize.x * (5.0 + 3.0 * f) + 1.7 * f) * 0.6 + sin(x / uSize.x * (11.0 + 2.0 * f) + 0.4) * 0.4 + 1.0);
}
vec3 skyAt(float y) {
  float t = clamp(y / uHorizonY, 0.0, 1.0);
  return t < 0.45 ? mix(uSky0, uSky1, smoothstep(0.0, 0.45, t))
       : t < 0.8 ? mix(uSky1, uSky2, smoothstep(0.45, 0.8, t))
       : mix(uSky2, uSky3, smoothstep(0.8, 1.0, t));
}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr;
  float px = 1.0 / uDpr;
  vec3 sky = skyAt(p.y);
  // The sun's glow, wide and close, falling off round it; the sun.
  float d = length(p - uSunAt) / uSize.y;
  float glow = (exp(-pow(d / 0.3, 2.0)) * 0.75 + exp(-pow(d / 0.07, 2.0)) * 0.5) * uGlowK;
  sky = uInk == 1 ? mix(sky, uSunGlow, min(1.0, glow)) : sky + uSunGlow * glow;
  sky = mix(sky, uSun, clamp((uSunR * uSize.y - length(p - uSunAt)) / px + 0.5, 0.0, 1.0));
  vec3 col = sky;
  vec2 light = normalize(vec2(sign(uSunAt.x - p.x) * 0.9, 0.42));
  if (p.y > uHorizonY - px) {
    float t = clamp((p.y - uHorizonY) / (uSize.y - uHorizonY), 0.0, 1.0);
    vec3 plain = mix(uPlainFar, uPlainNear, smoothstep(0.0, 1.0, t));
    col = mix(col, plain, clamp((p.y - uHorizonY) / px + 0.5, 0.0, 1.0));
    for (int k = 0; k < 2; k++) {
      float top = dune(k, p.x);
      float cover = clamp((p.y - top) / px + 0.5, 0.0, 1.0);
      if (cover <= 0.0) continue;
      float slope = (dune(k, p.x + 4.0) - dune(k, p.x - 4.0)) / 8.0;
      float sun = max(0.0, dot(normalize(vec2(slope, 1.0)), light));
      vec3 c = mix(uDune, uDuneLit, smoothstep(0.2, 0.9, sun));
      // Further dunes take more of the plain's haze; each darkens a little below its crest.
      c = mix(c, uPlainFar, 0.45 - 0.25 * float(k));
      c *= 1.0 - 0.08 * smoothstep(0.0, uSize.y * 0.05, p.y - top);
      col = mix(col, c, cover);
    }
  }
  vec3 haze = mix(uSky2, uSky3, 0.6);
  for (int k = 0; k < ${RANGES}; k++) {
    float top = ridge(k, p.x);
    float cover = clamp((p.y - top) / px + 0.5, 0.0, 1.0) * clamp((uHorizonY - p.y) / px + 0.5, 0.0, 1.0);
    if (cover <= 0.0) continue;
    float slope = (ridge(k, p.x + 2.0) - ridge(k, p.x - 2.0)) / 4.0;
    float sun = max(0.0, dot(normalize(vec2(slope, 1.0)), light));
    // The face toward the sun lit, the one away in shadow, a top catching light along its rim;
    // each darker toward its foot.
    float rim = smoothstep(3.0, 0.0, p.y - top) * 0.35;
    vec3 m = mix(uMesa, uMesaLit, clamp(smoothstep(0.25, 0.95, sun) + rim, 0.0, 1.0));
    m *= 1.0 - 0.12 * smoothstep(top, uHorizonY, p.y);
    col = mix(col, mix(m, haze, uHazes[k]), cover);
  }
  // A grain of noise, under a step of the colour, so the long gradients do not band.
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  outColor = vec4(col, 0.0);
}`;

/** The grains in the air, a texel a grain: how many fall near (r), where their stream runs across
 *  this column (g: −1 … 1 of a column, as 0 … 1), and the nearest one's code (b). */
const AIR = `
uniform sampler2D uGrain;
uniform sampler2D uTop;
uniform vec2 uGrid;
float T(float c) { return texelFetch(uTop, ivec2(clamp(c, 0.0, uGrid.x - 1.0), 0), 0).r; }
float airAt(vec2 g) {
  if (g.x < 0.0 || g.y < 0.0 || g.x >= uGrid.x || g.y >= uGrid.y || g.y >= T(g.x)) return 0.0;
  return texelFetch(uGrain, ivec2(g), 0).r * 255.0;
}
void main() {
  vec2 g = floor(gl_FragCoord.xy);
  float dens = 0.0, across = 0.0, code = 0.0, near = 99.0;
  for (int k = -3; k <= 3; k++) {
    for (int i = -1; i <= 1; i++) {
      float c = airAt(g + vec2(float(i), float(k)));
      if (c < 0.5) continue;
      float w = (1.0 - abs(float(k)) / 4.0) * (i == 0 ? 1.0 : 0.8);
      dens += w;
      across += w * float(i);
      float d = abs(float(k)) + abs(float(i)) * 0.5;
      if (d < near) { near = d; code = c; }
    }
  }
  outColor = vec4(min(1.0, dens / 2.5), dens > 0.0 ? across / dens * 0.5 + 0.5 : 0.5, code / 255.0, 1.0);
}`;

/** The sand over the desert, each frame. Alpha says where characters go: along the sand's outline
 *  (0.5, edge glyphs only), on its lit crests (1); nowhere else (0). */
const SAND = `
uniform sampler2D uBack;
uniform sampler2D uGrain;
uniform sampler2D uTop;
uniform sampler2D uPal;
uniform sampler2D uAir;
uniform vec2 uGrid;
uniform vec2 uGrainPx;
uniform float uDpr;
uniform vec2 uSunAt;
uniform vec3 uShadow, uLit, uDust;
uniform float uDeep, uOutline, uCrest;
uniform vec4 uBursts[4];
uniform int uInk;
float grainAt(vec2 g) {
  if (g.x < 0.0 || g.y < 0.0 || g.x >= uGrid.x || g.y >= uGrid.y) return 0.0;
  return texelFetch(uGrain, ivec2(g), 0).r * 255.0;
}
float T(float c) { return texelFetch(uTop, ivec2(clamp(c, 0.0, uGrid.x - 1.0), 0), 0).r; }
// The surface, a line through each stack's top, eased with its neighbours': smooth, not stepped.
float eased(float c) { return (T(c - 1.0) + 2.0 * T(c) + T(c + 1.0)) * 0.25; }
float surface(float x) {
  float xc = x - 0.5;
  float i = floor(xc);
  return mix(eased(i), eased(i + 1.0), xc - i);
}
vec3 palette(float code) { return texelFetch(uPal, ivec2(int(code) - 1, 0), 0).rgb; }
// The strata here: the stacked grains round this point, blended by how near each is, so one band
// runs into the next over a grain rather than in steps.
vec3 strata(vec2 g) {
  vec2 b = g - 0.5;
  vec2 i = floor(b);
  vec2 f = b - i;
  vec3 sum = vec3(0.0);
  float w = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec2 at = i + o;
    float c = grainAt(at);
    if (c < 0.5 || at.y < T(at.x)) continue;
    float wk = mix(1.0 - f.x, f.x, o.x) * mix(1.0 - f.y, f.y, o.y) + 1e-4;
    sum += palette(c) * wk;
    w += wk;
  }
  if (w > 0.0) return sum / w;
  float c = grainAt(vec2(floor(g.x), T(floor(g.x))));
  return palette(max(1.0, c));
}
void main() {
  vec2 p = gl_FragCoord.xy / uDpr;
  vec2 g = p / uGrainPx;
  vec3 col = texelFetch(uBack, ivec2(gl_FragCoord.xy), 0).rgb;
  float mask = 0.0;
  float depth = g.y - surface(g.x);
  float aa = 1.0 / (uGrainPx.y * uDpr);
  if (depth > -aa) {
    // The surface's slope here, its normal, and the low sun's light on it.
    float dydx = (surface(g.x + 1.5) - surface(g.x - 1.5)) / 3.0 * uGrainPx.y / uGrainPx.x;
    vec2 n = normalize(vec2(dydx, 1.0));
    vec2 l = normalize(vec2(sign(uSunAt.x - p.x) * 0.9, 0.42));
    float sun = max(0.0, dot(n, l));
    vec3 face = mix(uShadow, uLit, smoothstep(0.15, 0.85, sun));
    vec3 band = strata(g);
    // Lit at its face, the strata's own colour, darker, deep down; the crest on the sun's side
    // catching the light.
    float crest = smoothstep(0.35, 0.8, sun) * smoothstep(uCrest, 0.0, depth);
    vec3 s = band * mix(face, vec3(uDeep), smoothstep(1.5, 16.0, depth));
    s += band * uLit * 0.3 * crest;
    col = mix(col, s, clamp(depth / aa + 0.5, 0.0, 1.0));
    if (depth > 0.0 && depth < uOutline) mask = 0.5;
    if (crest > 0.3) mask = 1.0;
  } else {
    // In the air: the falling grains' ribbon, from this column's and its neighbours' streams, each
    // where its stream runs across, between this row and the next.
    vec2 a = g - vec2(0.0, 0.5);
    float c0 = floor(g.x), r0 = floor(a.y), fy = a.y - r0;
    float best = 0.0;
    vec3 rib = vec3(0.0);
    for (int i = -1; i <= 1; i++) {
      float cx = c0 + float(i);
      vec4 u = texelFetch(uAir, ivec2(clamp(vec2(cx, r0), vec2(0.0), uGrid - 1.0)), 0);
      vec4 v = texelFetch(uAir, ivec2(clamp(vec2(cx, r0 + 1.0), vec2(0.0), uGrid - 1.0)), 0);
      float dens = mix(u.r, v.r, fy);
      if (dens <= 0.0) continue;
      float centre = cx + 0.5 + (mix(u.g, v.g, fy) * 2.0 - 1.0);
      float k = smoothstep(0.1, 0.5, dens) * clamp(uGrainPx.x * 0.3 - abs(g.x - centre) * uGrainPx.x + 0.5, 0.0, 1.0);
      if (k > best) {
        best = k;
        float code = (fy < 0.5 ? u.b : v.b) * 255.0;
        rib = palette(max(1.0, code > 0.5 ? code : (u.b + v.b) * 255.0));
      }
    }
    if (best > 0.0) col = mix(col, rib * mix(uShadow, uLit, 0.75), best);
  }
  // A click's puff of dust: a ring of light, spreading and fading.
  for (int b = 0; b < 4; b++) {
    vec4 u = uBursts[b];
    if (u.w <= 0.0) continue;
    float k = smoothstep(12.0, 0.0, abs(length(p - u.xy) - u.z)) * u.w * 0.6;
    col = uInk == 1 ? mix(col, uDust, k) : col + uDust * k;
  }
  outColor = vec4(col, mask);
}`;

/** A falling stream's colour, from its grains': brighter on dark, deeper on paper. */
const STREAM_LIGHT = { dark: 1.2, light: 0.55 };

interface Star {
  cell: number;
  slot: number;
  bright: number;
  phase: number;
  speed: number;
}

export class SandGl implements Drawer<Sand> {
  private chars: CharPass;
  private backdrop: Program;
  private sand: Program;
  private air: Program;
  private palette: SandGlPalette = SAND_GL_PALETTE.dark;
  private ink = false;
  private family = `"${FACE}", monospace`;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private laidOut = "";
  private gcols = 0;
  private grows = 0;
  private grainTex: WebGLTexture | null = null;
  private topTex: WebGLTexture | null = null;
  private palTex: WebGLTexture | null = null;
  private forceTex: WebGLTexture | null = null;
  private back: Target | null = null;
  private pic: Target | null = null;
  private airT: Target | null = null;
  /** Each grain code's colour as a falling stream's glyph shows it. */
  private streamRgb: Rgb[] = [];
  private streamSlot = 0;
  private sparkSlot = 0;
  private grainBuf = new Uint8Array(0);
  private topBuf = new Float32Array(0);
  private forceBuf = new Uint8Array(0);
  private buttes = new Float32Array(RANGES * BUTTES * 4);
  private stars: Star[] = [];
  private starRgb: Rgb = [255, 255, 255];
  /** The character grid: a cell is a grain wide and two tall. */
  private cols = 0;
  private rows = 0;

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, private gl: GL) {
    this.chars = new CharPass(gl);
    this.backdrop = program(gl, BACKDROP);
    this.sand = program(gl, SAND);
    this.air = program(gl, AIR);
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
  }

  setLook(look: WallpaperLook) {
    this.ink = !look.dark;
    this.palette = look.dark ? SAND_GL_PALETTE.dark : SAND_GL_PALETTE.light;
    this.family = look.mono.trim() ? `"${FACE}", ${look.mono}, monospace` : `"${FACE}", monospace`;
    this.laidOut = "";
  }

  /** The mesas of a window: the same window, the same skyline. Far ranges lower and wider spread,
   *  the near one taller and fewer; all hugging the horizon. */
  private skyline() {
    const W = this.width;
    const H = this.height;
    for (let k = 0; k < RANGES; k++) {
      for (let i = 0; i < BUTTES; i++) {
        const h = (n: number) => hash2(k * 31 + i * 7 + n, Math.round(W / 50) * 13 + Math.round(H / 50));
        const o = (k * BUTTES + i) * 4;
        let x = W * ((i + 0.1 + 0.8 * h(1)) / BUTTES) + (k - 1) * W * 0.06;
        // The near ranges leave the low sun a gap to set in.
        if (k > 0 && Math.abs(x - W * SUN_X) < W * 0.1) x += (x < W * SUN_X ? -1 : 1) * W * 0.1;
        this.buttes[o] = x;
        this.buttes[o + 1] = W * (0.025 + 0.045 * h(2)) * (1 + k * 0.2);
        this.buttes[o + 2] = H * (0.04 + 0.035 * h(3)) * (1 + k * 0.45) * (h(4) < 0.3 ? 0.55 : 1);
        this.buttes[o + 3] = W * (0.008 + 0.008 * h(5));
      }
    }
  }

  /** The stars of a window: the same cells each time, high in the sky and clear of the sun. */
  private starField(sand: Sand) {
    const p = this.palette;
    this.stars = [];
    if (p.stars <= 0) return;
    const ch = sand.gh * 2;
    const sunX = this.width * SUN_X;
    const sunY = this.height * (p.horizon - SUN_UP);
    const slots = STAR_GLYPHS.map((g) => this.chars.slot(g));
    for (let r = 0; r < this.rows; r++) {
      const y = (r + 0.5) * ch;
      if (y > this.height * p.horizon * STARS_DOWN_TO) break;
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * sand.gw;
        if (hash2(c * 3 + 1, r * 5 + 2) >= p.stars || Math.hypot(x - sunX, y - sunY) < this.height * 0.22) continue;
        // Never two side by side.
        if (this.stars.at(-1)?.cell === r * this.cols + c - 1) continue;
        const k = hash2(c, r + 99);
        this.stars.push({ cell: r * this.cols + c, slot: slots[k < 0.3 ? 0 : 1]!, bright: 0.45 + 0.55 * hash2(c + 5, r), phase: k * 40, speed: 0.6 + 1.6 * hash2(r, c + 11) });
      }
    }
  }

  private layout(sand: Sand) {
    const key = `${sand.cols}x${sand.rows}:${sand.gw}x${sand.gh}@${this.dpr}:${this.family}:${this.ink}:${this.width}x${this.height}`;
    if (key === this.laidOut) return;
    this.laidOut = key;
    const gl = this.gl;
    this.cols = sand.cols;
    this.rows = Math.ceil(sand.rows / 2);
    const cw = sand.gw * this.dpr;
    const ch = sand.gh * 2 * this.dpr;
    this.chars.layout(this.cols, this.rows, cw, ch, `600 ${Math.round(ch * 0.74)}px ${this.family}`);
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (sand.cols !== this.gcols || sand.rows !== this.grows || !this.grainTex) {
      for (const t of [this.grainTex, this.topTex, this.forceTex]) if (t) gl.deleteTexture(t);
      this.gcols = sand.cols;
      this.grows = sand.rows;
      this.grainBuf = new Uint8Array(sand.cols * sand.rows);
      this.topBuf = new Float32Array(sand.cols);
      this.forceBuf = new Uint8Array(this.cols * this.rows * 4);
      this.grainTex = texture(gl, sand.cols, sand.rows, false, null, "r8");
      dropTarget(gl, this.airT);
      this.airT = target(gl, sand.cols, sand.rows, false);
      this.topTex = texture(gl, sand.cols, 1, false, null, "r32f");
      this.forceTex = texture(gl, this.cols, this.rows, false, null);
    }
    if (!this.pic || this.pic.w !== W || this.pic.h !== H) {
      dropTarget(gl, this.pic);
      dropTarget(gl, this.back);
      // The picture is to the device pixel; the desert behind the sand, painted once, too.
      this.pic = target(gl, W, H);
      this.back = target(gl, W, H, false);
    }
    // Each grain code's colour in full light (its light comes from the slope, in the shader).
    if (this.palTex) gl.deleteTexture(this.palTex);
    const pal = new Uint8Array(CODES * 4);
    const lit = rgbOf(this.palette.lit);
    const k = this.ink ? STREAM_LIGHT.light : STREAM_LIGHT.dark;
    this.streamRgb = [[0, 0, 0]];
    for (let code = 1; code <= CODES; code++) {
      const c = grainColour(this.palette.sands, code, 0);
      pal.set([...c, 255], (code - 1) * 4);
      this.streamRgb.push(c.map((v, i) => Math.min(255, Math.round((v * lit[i]! * k) / 255))) as unknown as Rgb);
    }
    this.palTex = texture(gl, CODES, 1, false, pal);
    this.streamSlot = this.chars.slot(STREAM);
    this.sparkSlot = this.chars.slot(SPARK);
    this.skyline();
    this.paintBackdrop();
    this.starField(sand);
    this.starRgb = rgbOf(this.palette.star);
  }

  private paintBackdrop() {
    const gl = this.gl;
    const p = this.palette;
    const v3 = (c: Oklch) => rgbOf(c).map((x) => x / 255) as [number, number, number];
    pass(gl, this.backdrop, this.back!, (q) => {
      gl.uniform2f(q.at("uSize"), this.width, this.height);
      gl.uniform1f(q.at("uDpr"), this.dpr);
      p.sky.forEach((c, k) => gl.uniform3fv(q.at(`uSky${k}`), v3(c)));
      gl.uniform3fv(q.at("uPlainFar"), v3(p.plain[0]));
      gl.uniform3fv(q.at("uPlainNear"), v3(p.plain[1]));
      gl.uniform3fv(q.at("uSun"), v3(p.sun));
      gl.uniform3fv(q.at("uSunGlow"), v3(p.sunGlow));
      gl.uniform3fv(q.at("uMesa"), v3(p.mesa));
      gl.uniform3fv(q.at("uMesaLit"), v3(p.mesaLit));
      gl.uniform3fv(q.at("uDune"), v3(p.dune));
      gl.uniform3fv(q.at("uDuneLit"), v3(p.duneLit));
      gl.uniform2f(q.at("uSunAt"), this.width * SUN_X, this.height * (p.horizon - SUN_UP));
      gl.uniform1f(q.at("uSunR"), 0.04);
      gl.uniform1f(q.at("uGlowK"), p.glow);
      gl.uniform1f(q.at("uHorizonY"), this.height * p.horizon);
      gl.uniform4fv(q.at("uButtes"), this.buttes);
      gl.uniform1fv(q.at("uHazes"), p.hazes);
      gl.uniform1i(q.at("uInk"), this.ink ? 1 : 0);
    });
  }

  /** The characters set here, not by the picture: the stars, twinkling; a `|` in each cell a stream
   *  falls through; a spark where each thrown grain is. */
  private force(sand: Sand) {
    const f = this.forceBuf;
    f.fill(0);
    const set = (cell: number, [r, g, b]: Rgb, slot: number) => {
      const o = cell * 4;
      f[o] = r;
      f[o + 1] = g;
      f[o + 2] = b;
      f[o + 3] = slot;
    };
    const black: Rgb = [0, 0, 0];
    for (const s of this.stars) set(s.cell, mix(black, this.starRgb, s.bright * (0.6 + 0.4 * Math.sin(sand.time * s.speed + s.phase))), s.slot);
    const { cols } = sand;
    for (let c = 0; c < cols; c++) {
      const top = this.topBuf[c]!;
      for (let r = 0; r < top; r++) {
        const code = sand.grain[r * cols + c]!;
        if (code) set((r >> 1) * cols + c, this.streamRgb[code]!, this.streamSlot);
      }
    }
    for (const g of sand.flying) {
      const i = sand.cellAt(g.x, g.y);
      if (i < 0) continue;
      const r = (i / cols) | 0;
      set((r >> 1) * cols + (i - r * cols), this.streamRgb[g.code]!, this.sparkSlot);
    }
  }

  draw(sand: Sand) {
    if (!sand.cols || !this.width || this.gl.isContextLost()) return;
    this.layout(sand);
    const gl = this.gl;
    const { cols, rows } = sand;
    this.grainBuf.set(sand.grain);
    // The thrown grains, where they are now.
    for (const f of sand.flying) {
      const i = sand.cellAt(f.x, f.y);
      if (i >= 0) this.grainBuf[i] = f.code;
    }
    // Each column's surface: the top of the sand stacked on its floor.
    for (let c = 0; c < cols; c++) {
      let r = rows - 1;
      while (r >= 0 && sand.grain[r * cols + c]) r--;
      this.topBuf[c] = r + 1;
    }
    upload(gl, this.grainTex!, cols, rows, this.grainBuf, "r8");
    upload(gl, this.topTex!, cols, 1, this.topBuf, "r32f");
    this.force(sand);
    upload(gl, this.forceTex!, this.cols, this.rows, this.forceBuf);
    pass(gl, this.air, this.airT!, (q) => {
      bindTex(gl, q, "uGrain", this.grainTex!, 0);
      bindTex(gl, q, "uTop", this.topTex!, 1);
      gl.uniform2f(q.at("uGrid"), cols, rows);
    });
    const p = this.palette;
    const v3 = (c: Oklch) => rgbOf(c).map((x) => x / 255) as [number, number, number];
    const bursts = new Float32Array(16);
    sand.bursts.slice(-4).forEach((b, k) => {
      const age = sand.time - b.at;
      if (age < 0 || age >= DUST_LIFE) return;
      bursts.set([b.x, b.y, DUST_SPEED * age, 1 - age / DUST_LIFE], k * 4);
    });
    pass(gl, this.sand, this.pic!, (q) => {
      bindTex(gl, q, "uBack", this.back!.tex, 0);
      bindTex(gl, q, "uGrain", this.grainTex!, 1);
      bindTex(gl, q, "uTop", this.topTex!, 2);
      bindTex(gl, q, "uPal", this.palTex!, 3);
      bindTex(gl, q, "uAir", this.airT!.tex, 4);
      gl.uniform2f(q.at("uGrid"), cols, rows);
      gl.uniform2f(q.at("uGrainPx"), sand.gw, sand.gh);
      gl.uniform1f(q.at("uDpr"), this.dpr);
      gl.uniform2f(q.at("uSunAt"), this.width * SUN_X, this.height * (p.horizon - SUN_UP));
      gl.uniform3fv(q.at("uShadow"), v3(p.shadow));
      gl.uniform3fv(q.at("uLit"), v3(p.lit));
      gl.uniform3fv(q.at("uDust"), v3(p.dust));
      gl.uniform1f(q.at("uDeep"), p.deep);
      gl.uniform1f(q.at("uOutline"), OUTLINE);
      gl.uniform1f(q.at("uCrest"), CREST);
      gl.uniform4fv(q.at("uBursts"), bursts);
      gl.uniform1i(q.at("uInk"), this.ink ? 1 : 0);
    });
    const base = this.ink ? v3(p.sky[3]) : ([0, 0, 0] as [number, number, number]);
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.chars.draw(this.pic!.tex, this.forceTex!, { ...p.look, ink: this.ink, base }, W, H, sand.gw * this.dpr, sand.gh * 2 * this.dpr, { w: W, h: H });
  }
}
