/**
 * Glyph Rain drawn as a curtain, in WebGL. Each depth is its own grid of characters in its own size
 * (glyphs drawn from the bundled face into an atlas per depth). Each cell's light is the brightest
 * stream over it, and lingers after a stream has passed, so tails fade smoothly; a head is brightest
 * of all and blooms. The far depth is drawn small, dim and blurred, behind a haze; the middle one
 * over it, behind a thinner haze; the near one sharp over both. The sky behind is a gradient with a
 * soft light low in it. The pointer parts the columns: each character is moved aside whole, so its
 * shape is kept. On paper the same in ink: dark heads, grey tails, a pale haze.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { glyphAtlas, type Atlas } from "../atlas";
import { mix, rgbOf, type Oklch, type Rgb } from "../colour";
import { BLUR, bindTex, blur, dropTarget, pass, program, target, texture, upload, type GL, type Program, type Target } from "../gl";
import { FACE } from "../page";
import type { Drawer } from "../scene";
import { RAIN_PALETTE, type RainPalette } from "./palette";
import { DEPTHS, GLYPHS, PART_PUSH, PART_REACH, type Rain } from "./rain";

/** How fast a cell's light fades once a stream has passed (per second), and the light every cell
 *  keeps, so the curtain is never bare. */
const LINGER = 1.1;
const FLOOR = { dark: 0.08, light: 0.0 };
/** How much the haze in front of the far depth, and in front of the middle one, veils them, at
 *  night and on paper. */
const HAZE = { dark: [0.42, 0.18], light: [0.55, 0.22] };

/** The screen: the sky, the far depth blurred behind its haze, the middle depth behind its own, the
 *  near depth, and the heads' bloom. */
const SCREEN = `
uniform sampler2D uFar;
uniform sampler2D uMid, uMidAtlas, uMidRamp;
uniform sampler2D uNear, uNearAtlas, uNearRamp;
uniform sampler2D uBloom;
uniform vec2 uView;
uniform vec2 uMidCell, uNearCell;
uniform ivec2 uMidGrid, uNearGrid;
uniform vec3 uMidAtlasU, uNearAtlasU;
uniform vec3 uTop, uMidSky, uBottom, uGlow, uHaze;
uniform float uGlowK, uHaze0, uHaze1, uBloomK, uDpr;
uniform vec3 uPart;
uniform float uReach, uPush;
uniform int uInk;
float push(vec2 p) {
  if (uPart.z <= 0.0) return 0.0;
  vec2 d = vec2(p.x - uPart.x, (p.y - uPart.y) * 0.85);
  float r = length(d);
  if (r >= uReach) return 0.0;
  float near = 1.0 - r / uReach;
  return (d.x < 0.0 ? -1.0 : 1.0) * uReach * uPush * near * near * uPart.z;
}
vec4 glyphAt(vec2 px, sampler2D cells, sampler2D atlas, sampler2D ramp, vec2 cellSize, ivec2 grid, vec3 atlasU) {
  float sx = px.x - push(px);
  vec2 cell = floor(vec2(sx, px.y) / cellSize);
  if (cell.x < 0.0 || cell.x >= float(grid.x) || cell.y >= float(grid.y)) return vec4(0.0);
  vec2 centre = (cell + 0.5) * cellSize;
  float left = centre.x + push(centre) - cellSize.x * 0.5;
  vec2 inCell = vec2((px.x - left) / cellSize.x, px.y / cellSize.y - cell.y);
  if (inCell.x < 0.0 || inCell.x >= 1.0) return vec4(0.0);
  vec4 c = texelFetch(cells, ivec2(cell), 0);
  float slot = floor(c.g * 255.0 + 0.5);
  if (slot < 0.5) return vec4(0.0);
  float cov = texture(atlas, vec2((slot - 1.0) * atlasU.x + atlasU.y + inCell.x * atlasU.z, inCell.y)).r;
  return vec4(texture(ramp, vec2(c.r, 0.5)).rgb, cov);
}
void main() {
  vec2 dev = vec2(gl_FragCoord.x, uView.y - gl_FragCoord.y);
  vec2 uv = dev / uView;
  vec2 px = dev / uDpr;
  vec3 sky = uv.y < 0.5 ? mix(uTop, uMidSky, uv.y * 2.0) : mix(uMidSky, uBottom, uv.y * 2.0 - 1.0);
  float g = exp(-pow(length((uv - vec2(0.5, 1.05)) * vec2(1.0, 1.6)) / 0.75, 2.0));
  sky = uInk == 1 ? mix(sky, uGlow, g * uGlowK) : sky + uGlow * g * uGlowK;
  vec4 far = texture(uFar, uv);
  vec4 mid = glyphAt(px, uMid, uMidAtlas, uMidRamp, uMidCell, uMidGrid, uMidAtlasU);
  vec4 near = glyphAt(px, uNear, uNearAtlas, uNearRamp, uNearCell, uNearGrid, uNearAtlasU);
  vec3 bloom = texture(uBloom, uv).rgb;
  vec3 col;
  if (uInk == 1) {
    col = sky * (1.0 - far.a) + far.rgb;
    col = mix(col, uHaze, uHaze0);
    col = mix(col, mid.rgb, mid.a);
    col = mix(col, uHaze, uHaze1);
    col = mix(col, near.rgb, near.a);
    col *= vec3(1.0) - bloom * uBloomK;
  } else {
    col = sky + far.rgb;
    col = mix(col, uHaze, uHaze0);
    col += mid.rgb * mid.a;
    col = mix(col, uHaze, uHaze1);
    col += near.rgb * near.a;
    col += bloom * uBloomK;
  }
  outColor = vec4(col, 1.0);
}`;

/** The far depth alone, into a target the size of the screen over `uScale`, to be blurred: its
 *  colour premultiplied by each glyph's coverage, the coverage in alpha. */
const FAR = `
uniform sampler2D uCells, uAtlas, uRamp;
uniform vec2 uView;
uniform vec2 uCell;
uniform ivec2 uGrid;
uniform vec3 uAtlasU;
uniform float uDpr, uScale;
uniform vec3 uPart;
uniform float uReach, uPush;
float push(vec2 p) {
  if (uPart.z <= 0.0) return 0.0;
  vec2 d = vec2(p.x - uPart.x, (p.y - uPart.y) * 0.85);
  float r = length(d);
  if (r >= uReach) return 0.0;
  float near = 1.0 - r / uReach;
  return (d.x < 0.0 ? -1.0 : 1.0) * uReach * uPush * near * near * uPart.z;
}
void main() {
  vec2 px = gl_FragCoord.xy * uScale / uDpr;
  float sx = px.x - push(px);
  vec2 cell = floor(vec2(sx, px.y) / uCell);
  vec4 o = vec4(0.0);
  if (cell.x >= 0.0 && cell.x < float(uGrid.x) && cell.y < float(uGrid.y)) {
    vec2 centre = (cell + 0.5) * uCell;
    float left = centre.x + push(centre) - uCell.x * 0.5;
    vec2 inCell = vec2((px.x - left) / uCell.x, px.y / uCell.y - cell.y);
    vec4 c = texelFetch(uCells, ivec2(cell), 0);
    float slot = floor(c.g * 255.0 + 0.5);
    if (slot > 0.5 && inCell.x >= 0.0 && inCell.x < 1.0) {
      float cov = texture(uAtlas, vec2((slot - 1.0) * uAtlasU.x + uAtlasU.y + inCell.x * uAtlasU.z, inCell.y)).r;
      o = vec4(texture(uRamp, vec2(c.r, 0.5)).rgb, 1.0) * cov;
    }
  }
  outColor = o;
}`;

/** Each cell's bloom, from its light: only the brightest (the heads, what a ring has lit). */
const BRIGHT = `
uniform sampler2D uCells, uRamp;
uniform float uFrom;
void main() {
  vec4 c = texelFetch(uCells, ivec2(gl_FragCoord.xy), 0);
  float k = smoothstep(uFrom, 1.0, c.r);
  vec3 col = texture(uRamp, vec2(c.r, 0.5)).rgb;
  outColor = vec4(col * k, 1.0);
}`;

/** A ramp texture: `n` steps of a depth's colour from no light to a head's. */
function rampTexture(gl: GL, colours: Rgb[]): WebGLTexture {
  const data = new Uint8Array(colours.length * 4);
  colours.forEach((c, i) => data.set([c[0], c[1], c[2], 255], i * 4));
  return texture(gl, colours.length, 1, true, data);
}

interface Depth {
  atlas: Atlas | null;
  cells: WebGLTexture | null;
  buf: Uint8Array;
  light: Float32Array;
  ramp: WebGLTexture | null;
  cols: number;
  rows: number;
  /** Each character's slot in this depth's atlas, by its index in GLYPHS. */
  slots: Uint8Array;
}

export class RainGl implements Drawer<Rain> {
  private screen: Program;
  private far: Program;
  private bright: Program;
  private blurP: Program;
  private depths: Depth[] = DEPTHS.map(() => ({ atlas: null, cells: null, buf: new Uint8Array(0), light: new Float32Array(0), ramp: null, cols: 0, rows: 0, slots: new Uint8Array(GLYPHS.length) }));
  private palette: RainPalette = RAIN_PALETTE.dark;
  private ink = false;
  private family = `"${FACE}", monospace`;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private laidOut = "";
  private farT: Target | null = null;
  private farTmp: Target | null = null;
  private farBlur: Target | null = null;
  private brightT: Target | null = null;
  private brightTmp: Target | null = null;
  private bloomT: Target | null = null;
  private last = -1;

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, private gl: GL) {
    this.screen = program(gl, SCREEN);
    this.far = program(gl, FAR);
    this.bright = program(gl, BRIGHT);
    this.blurP = program(gl, BLUR);
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
    this.palette = look.dark ? RAIN_PALETTE.dark : RAIN_PALETTE.light;
    this.family = look.mono.trim() ? `"${FACE}", ${look.mono}, monospace` : `"${FACE}", monospace`;
    this.laidOut = "";
  }

  /** Each depth's ramp of colours, from no light to a head's: on dark, the tail's colours fading
   *  into the sky; on paper, grey tails into the paper; far depths dimmer. */
  private ramps() {
    const p = this.palette;
    const sky = rgbOf(p.ground[1]!);
    const tail = p.tail.map(rgbOf);
    const head = rgbOf(p.head);
    const N = 64;
    return DEPTHS.map((d) => {
      const out: Rgb[] = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        let c: Rgb;
        if (t > 0.97) c = head;
        else if (t > 0.5) c = mix(tail[1]!, tail[0]!, (t - 0.5) / 0.47);
        else c = mix(tail[2]!, tail[1]!, t / 0.5);
        // The faintest fade into the sky; a far depth is nearer the sky all along.
        // On paper a far depth is a ghost of ink, the paper showing through it.
        const reach = Math.min(1, 0.15 + t * 1.6) * (this.ink ? d.light ** 3 : d.light);
        out.push(mix(this.ink ? sky : ([0, 0, 0] as Rgb), c, reach));
      }
      return out;
    });
  }

  private layout(rain: Rain) {
    const key = `${rain.layers.map((L) => `${L.cols}x${L.rows}:${L.size}`).join()}@${this.dpr}:${this.family}:${this.ink}:${this.width}x${this.height}`;
    if (key === this.laidOut) return;
    this.laidOut = key;
    const gl = this.gl;
    const ramps = this.ramps();
    rain.layers.forEach((L, k) => {
      const d = this.depths[k]!;
      const font = `600 ${Math.round(L.size * this.dpr)}px ${this.family}`;
      d.atlas = glyphAtlas(gl, [...GLYPHS], Math.round(L.cw * this.dpr), Math.round(L.ch * this.dpr), font, d.atlas ?? undefined);
      [...GLYPHS].forEach((g, i) => { d.slots[i] = d.atlas!.slot.get(g)!; });
      if (d.ramp) gl.deleteTexture(d.ramp);
      d.ramp = rampTexture(gl, ramps[k]!);
      if (d.cols !== L.cols || d.rows !== L.rows || !d.cells) {
        if (d.cells) gl.deleteTexture(d.cells);
        d.cols = L.cols;
        d.rows = L.rows;
        d.buf = new Uint8Array(L.cols * L.rows * 4);
        d.light = new Float32Array(L.cols * L.rows);
        d.cells = texture(gl, L.cols, L.rows, false, null);
      }
    });
    for (const t of [this.farT, this.farTmp, this.farBlur, this.brightT, this.brightTmp, this.bloomT]) dropTarget(gl, t);
    const fw = Math.max(1, Math.round(this.canvas.width / 2));
    const fh = Math.max(1, Math.round(this.canvas.height / 2));
    this.farT = target(gl, fw, fh);
    this.farTmp = target(gl, fw, fh);
    this.farBlur = target(gl, fw, fh);
    const near = this.depths[2]!;
    this.brightT = target(gl, near.cols, near.rows);
    this.brightTmp = target(gl, near.cols, near.rows);
    this.bloomT = target(gl, near.cols, near.rows);
  }

  /** Each cell's light: the brightest stream over it now, or what lingers of one that passed, or
   *  what a ring or the pointer lit; and its character. */
  private fill(rain: Rain, dt: number) {
    const fade = Math.exp(-dt * LINGER);
    const floor = this.ink ? FLOOR.light : FLOOR.dark;
    rain.layers.forEach((L, k) => {
      const d = this.depths[k]!;
      const { light, buf } = d;
      for (let i = 0; i < light.length; i++) light[i] = Math.max(floor, light[i]! * fade);
      for (const s of L.streams) {
        const top = Math.floor(s.head);
        for (let j = 0; j < s.length; j++) {
          const r = top - j;
          if (r < 0) break;
          if (r >= L.rows) continue;
          const i = r * L.cols + s.col;
          const v = j === 0 ? 1 : 0.9 * Math.pow(1 - j / s.length, 1.3);
          if (v > light[i]!) light[i] = v;
        }
      }
      for (let i = 0; i < light.length; i++) {
        const v = Math.min(1, Math.max(light[i]!, L.lit[i]! * 0.95));
        buf[i * 4] = Math.round(v * 255);
        buf[i * 4 + 1] = d.slots[L.glyphs[i]!]!;
        buf[i * 4 + 2] = 0;
        buf[i * 4 + 3] = 255;
      }
    });
  }

  draw(rain: Rain) {
    if (!rain.layers.length || !this.width || this.gl.isContextLost()) return;
    this.layout(rain);
    const gl = this.gl;
    // A frame's time, for what lingers: the rain's own clock (a held or still frame lingers not at all).
    const dt = this.last < 0 ? 10 : Math.max(0, Math.min(0.25, rain.time - this.last));
    this.last = rain.time;
    this.fill(rain, dt);
    this.depths.forEach((d) => upload(gl, d.cells!, d.cols, d.rows, d.buf));
    const part: [number, number, number] = [rain.centre.x, rain.centre.y, rain.part];
    const [far, mid, near] = this.depths as [Depth, Depth, Depth];
    const [farL, midL, nearL] = rain.layers as [Rain["layers"][number], Rain["layers"][number], Rain["layers"][number]];
    const atlasU = (a: Atlas) => [a.slotU, a.padU, a.cellU] as const;
    pass(gl, this.far, this.farT!, (p) => {
      bindTex(gl, p, "uCells", far.cells!, 0);
      bindTex(gl, p, "uAtlas", far.atlas!.tex, 1);
      bindTex(gl, p, "uRamp", far.ramp!, 2);
      gl.uniform2f(p.at("uCell"), farL.cw, farL.ch);
      gl.uniform2i(p.at("uGrid"), far.cols, far.rows);
      gl.uniform3fv(p.at("uAtlasU"), atlasU(far.atlas!));
      gl.uniform1f(p.at("uDpr"), this.dpr);
      gl.uniform1f(p.at("uScale"), this.canvas.width / this.farT!.w);
      gl.uniform3fv(p.at("uPart"), part);
      gl.uniform1f(p.at("uReach"), PART_REACH);
      gl.uniform1f(p.at("uPush"), PART_PUSH);
    });
    // At night the far depth is softened; on paper, blurred to a ghost behind the ink.
    blur(gl, this.blurP, this.farT!.tex, this.farTmp!, this.farBlur!, this.ink ? 5 : 2.2);
    pass(gl, this.bright, this.brightT!, (p) => {
      bindTex(gl, p, "uCells", near.cells!, 0);
      bindTex(gl, p, "uRamp", near.ramp!, 1);
      gl.uniform1f(p.at("uFrom"), 0.75);
    });
    blur(gl, this.blurP, this.brightT!.tex, this.brightTmp!, this.bloomT!, 1.6);
    const pal = this.palette;
    const v3 = (c: Oklch) => rgbOf(c).map((x) => x / 255) as [number, number, number];
    pass(gl, this.screen, { w: this.canvas.width, h: this.canvas.height }, (p) => {
      bindTex(gl, p, "uFar", this.farBlur!.tex, 0);
      bindTex(gl, p, "uMid", mid.cells!, 1);
      bindTex(gl, p, "uMidAtlas", mid.atlas!.tex, 2);
      bindTex(gl, p, "uMidRamp", mid.ramp!, 3);
      bindTex(gl, p, "uNear", near.cells!, 4);
      bindTex(gl, p, "uNearAtlas", near.atlas!.tex, 5);
      bindTex(gl, p, "uNearRamp", near.ramp!, 6);
      bindTex(gl, p, "uBloom", this.bloomT!.tex, 7);
      gl.uniform2f(p.at("uView"), this.canvas.width, this.canvas.height);
      gl.uniform2f(p.at("uMidCell"), midL.cw, midL.ch);
      gl.uniform2f(p.at("uNearCell"), nearL.cw, nearL.ch);
      gl.uniform2i(p.at("uMidGrid"), mid.cols, mid.rows);
      gl.uniform2i(p.at("uNearGrid"), near.cols, near.rows);
      gl.uniform3fv(p.at("uMidAtlasU"), atlasU(mid.atlas!));
      gl.uniform3fv(p.at("uNearAtlasU"), atlasU(near.atlas!));
      gl.uniform3fv(p.at("uTop"), v3(pal.ground[0]!));
      gl.uniform3fv(p.at("uMidSky"), v3(pal.ground[1]!));
      gl.uniform3fv(p.at("uBottom"), v3(pal.ground[2]!));
      gl.uniform3fv(p.at("uGlow"), v3(pal.glow.colour));
      gl.uniform1f(p.at("uGlowK"), pal.glow.alpha);
      gl.uniform3fv(p.at("uHaze"), v3(pal.haze));
      const haze = this.ink ? HAZE.light : HAZE.dark;
      gl.uniform1f(p.at("uHaze0"), haze[0]!);
      gl.uniform1f(p.at("uHaze1"), haze[1]!);
      gl.uniform1f(p.at("uBloomK"), this.ink ? 0.25 : 0.9);
      gl.uniform1f(p.at("uDpr"), this.dpr);
      gl.uniform3fv(p.at("uPart"), part);
      gl.uniform1f(p.at("uReach"), PART_REACH);
      gl.uniform1f(p.at("uPush"), PART_PUSH);
      gl.uniform1i(p.at("uInk"), this.ink ? 1 : 0);
    });
  }
}
