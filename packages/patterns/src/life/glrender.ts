/**
 * Life drawn as a glowing colony, in WebGL. Each live cell is the glyph of its age in its age's
 * colour (a newborn's bright `@` settling through `& * x` into a dim `#`); a dying cell leaves its
 * light where it was, fading, a trail behind what moves; a click's ring lights the cells it passes.
 * The cells' light, spread close (a glow round each), wider (a halo) and far (pooling where life is
 * thick),
 * falls off smoothly over a dish graded from its middle to its rim; the dish has no characters, the
 * colony carries them (charpass.ts). On paper, a drawing in ink: deep indigo glyphs, settling
 * into a muted teal, and a faint warm wash only where a colony is thick.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { CharPass, type CharLook } from "../charpass";
import { mix, rgbOf, type Oklch, type Rgb } from "../colour";
import { BLUR, bindTex, blur, dropTarget, pass, program, target, texture, upload, type GL, type Program, type Target } from "../gl";
import { FACE } from "../page";
import type { Drawer } from "../scene";
import { hash2 } from "../random";
import type { Life } from "./life";

/** Seconds a newborn takes to brighten, a trace to fade, and a ring's light to pass. */
const FADE_IN = 0.12;
export const TRACE_LIFE = 2.6;
const RING_LIFE = 0.16;
/** A live cell's glyphs by its level (being born, newborn, then by age), two of each for variety. */
const AGES = [["@", "@"], ["@", "@"], ["&", "%"], ["%", "&"], ["*", "+"], ["x", "+"], ["#", "#"], ["#", "#"]] as const;
const RING = "+";
/** Every character Life draws. */
export const LIFE_GL_GLYPHS = [...new Set([...AGES.flat(), RING])].join("");

/** A live cell's level by its age in generations. */
export function levelOf(age: number) {
  return age === 0 ? 1 : age === 1 ? 2 : age === 2 ? 3 : age <= 4 ? 4 : age <= 8 ? 5 : age <= 20 ? 6 : 7;
}

export interface LifeGlPalette {
  /** The dish: its middle, and its rim. Never black. */
  dish: [Oklch, Oklch];
  /** Each level's colour, being born to oldest: its glyph's, and its light's. */
  ages: Oklch[];
  /** How much light each level gives off. */
  light: number[];
  /** A trace's colour, and a ring's. */
  trace: Oklch;
  ring: Oklch;
  /** On paper, the wash a cell's light leaves (as much of it as the cell's level gives off). */
  wash?: Oklch;
  /** How strong the glow close round each cell is, the halo round that, and the light pooling
   *  where life is thick. */
  near: number;
  halo: number;
  pool: number;
  look: Omit<CharLook, "ink">;
}

export const LIFE_GL_PALETTE: { dark: LifeGlPalette; light: LifeGlPalette } = {
  dark: {
    dish: [[0.21, 0.04, 200], [0.135, 0.03, 225]],
    ages: [[0.8, 0.12, 158], [0.97, 0.07, 150], [0.92, 0.15, 148], [0.86, 0.16, 152], [0.8, 0.15, 160], [0.74, 0.13, 172], [0.6, 0.1, 192], [0.55, 0.09, 210]],
    light: [0.6, 1, 0.9, 0.78, 0.66, 0.56, 0.36, 0.3],
    trace: [0.62, 0.11, 175],
    ring: [0.92, 0.12, 165],
    near: 0.5,
    halo: 0.55,
    pool: 0.9,
    look: { bloom: 0.45, bloomFrom: 0.5 },
  },
  light: {
    dish: [[0.965, 0.014, 88], [0.9, 0.024, 80]],
    ages: [[0.4, 0.13, 276], [0.26, 0.15, 276], [0.28, 0.14, 274], [0.31, 0.13, 270], [0.34, 0.11, 264], [0.38, 0.09, 255], [0.5, 0.055, 210], [0.54, 0.05, 210]],
    light: [0.5, 1, 0.9, 0.8, 0.7, 0.6, 0.25, 0.2],
    trace: [0.66, 0.05, 66],
    ring: [0.32, 0.13, 276],
    wash: [0.8, 0.05, 72],
    near: 0,
    halo: 0,
    pool: 1.05,
    look: { bloom: 0, bloomFrom: 1 },
  },
};

/** The dish and the colony's light on it: no characters (alpha 0), only the live cells' own. */
const PICTURE = `
uniform sampler2D uNear;
uniform sampler2D uHalo;
uniform sampler2D uPool;
uniform vec3 uCentre, uRim;
uniform vec2 uAspect;
uniform float uNearK, uHaloK, uPoolK;
uniform int uInk;
void main() {
  // The dish, graded from its middle out to its rim, round whatever the window's shape.
  float r = length((vUv - 0.5) * uAspect) / length(0.5 * uAspect);
  vec3 ground = mix(uCentre, uRim, smoothstep(0.1, 1.0, r));
  vec3 light = texture(uNear, vUv).rgb * uNearK + texture(uHalo, vUv).rgb * uHaloK + texture(uPool, vUv).rgb * uPoolK;
  // On dark, light adds; on paper, each ink's wash takes its share of the light away.
  vec3 c = uInk == 1 ? ground * (vec3(1.0) - min(vec3(0.92), light)) : ground + light;
  outColor = vec4(c, 0.0);
}`;

export class LifeGl implements Drawer<Life> {
  private chars: CharPass;
  private blurP: Program;
  private picture: Program;
  private palette: LifeGlPalette = LIFE_GL_PALETTE.dark;
  private ink = false;
  private family = `"${FACE}", monospace`;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private cols = 0;
  private rows = 0;
  private cw = 0;
  private ch = 0;
  private laidOut = "";
  private own: WebGLTexture | null = null;
  private force: WebGLTexture | null = null;
  private ownBuf = new Uint8Array(0);
  private forceBuf = new Uint8Array(0);
  private tmp: Target | null = null;
  private near: Target | null = null;
  private halo: Target | null = null;
  private pool: Target | null = null;
  private pic: Target | null = null;
  /** Each level's glyph colour and light, and a trace's and a ring's, as bytes. */
  private glyphRgb: Rgb[] = [];
  private lightRgb: Rgb[] = [];
  private traceRgb: Rgb = [0, 0, 0];
  private ringRgb: Rgb = [0, 0, 0];
  /** On paper: a ring's ink. */
  private ringInk: Rgb = [0, 0, 0];

  constructor(private canvas: HTMLCanvasElement | OffscreenCanvas, private gl: GL) {
    this.chars = new CharPass(gl, [...LIFE_GL_GLYPHS]);
    this.blurP = program(gl, BLUR);
    this.picture = program(gl, PICTURE);
    this.styled();
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
    this.palette = look.dark ? LIFE_GL_PALETTE.dark : LIFE_GL_PALETTE.light;
    this.family = look.mono.trim() ? `"${FACE}", ${look.mono}, monospace` : `"${FACE}", monospace`;
    this.styled();
    this.laidOut = "";
  }

  private styled() {
    const p = this.palette;
    this.glyphRgb = p.ages.map(rgbOf);
    const black: Rgb = [0, 0, 0];
    // The light a cell gives off: on dark its colour, dimmed by its level. On paper the wash: how
    // much of each channel the wash's tint takes from the paper, as much as the cell's level gives.
    const paper = rgbOf(p.dish[0]);
    const wash = (c: Oklch, k: number): Rgb => {
      const tint = rgbOf(c);
      return paper.map((v, i) => Math.min(255, Math.max(0, ((v - tint[i]!) / Math.max(1, v)) * 255 * k))) as unknown as Rgb;
    };
    this.lightRgb = p.ages.map((c, k) => (this.ink ? wash(p.wash ?? c, p.light[k]!) : mix(black, rgbOf(c), p.light[k]!)));
    this.traceRgb = this.ink ? wash(p.wash ?? p.trace, 0.3) : rgbOf(p.trace);
    this.ringRgb = this.ink ? wash(p.wash ?? p.ring, 1) : mix(black, rgbOf(p.ring), 0.9);
    this.ringInk = rgbOf(p.ring);
  }

  private layout(life: Life) {
    const key = `${life.cols}x${life.rows}:${life.cw}x${life.ch}@${this.dpr}:${this.family}:${this.ink}`;
    if (key === this.laidOut) return;
    this.laidOut = key;
    const gl = this.gl;
    const sized = life.cols !== this.cols || life.rows !== this.rows;
    this.cols = life.cols;
    this.rows = life.rows;
    this.cw = life.cw;
    this.ch = life.ch;
    const fontPx = Math.round(Math.min(this.ch * 0.92, this.cw * 1.2) * this.dpr);
    this.chars.layout(this.cols, this.rows, this.cw * this.dpr, this.ch * this.dpr, `600 ${fontPx}px ${this.family}`);
    if (!sized && this.own) return;
    for (const t of [this.own, this.force]) if (t) gl.deleteTexture(t);
    for (const t of [this.tmp, this.near, this.halo, this.pool, this.pic]) dropTarget(gl, t);
    const n = this.cols * this.rows;
    this.ownBuf = new Uint8Array(n * 4);
    this.forceBuf = new Uint8Array(n * 4);
    this.own = texture(gl, this.cols, this.rows, true, null);
    this.force = texture(gl, this.cols, this.rows, false, null);
    this.tmp = target(gl, this.cols, this.rows);
    this.near = target(gl, this.cols, this.rows);
    this.halo = target(gl, this.cols, this.rows);
    this.pool = target(gl, this.cols, this.rows);
    this.pic = target(gl, this.cols, this.rows);
  }

  /** Each cell's light and its own glyph, from the board as it is. */
  private fill(life: Life) {
    const own = this.ownBuf;
    const force = this.forceBuf;
    const { cols } = this;
    const ringSlot = this.chars.slot(RING);
    const ageSlots = AGES.map((pair) => pair.map((g) => this.chars.slot(g)));
    for (let i = 0; i < life.cells.length; i++) {
      const o = i * 4;
      let lr = 0, lg = 0, lb = 0, slot = 0, fr = 0, fg = 0, fb = 0;
      if (life.cells[i]) {
        const age = life.age[i]!;
        const level = age === 0 && life.time - life.bornAt[i]! < FADE_IN ? 0 : levelOf(age);
        const l = this.lightRgb[level]!;
        const g = this.glyphRgb[level]!;
        [lr, lg, lb] = l;
        [fr, fg, fb] = g;
        const r = (i / cols) | 0;
        slot = ageSlots[level]![hash2(i - r * cols, r) < 0.5 ? 0 : 1]!;
      } else {
        const lit = life.time - life.litAt[i]!;
        const since = life.time - life.traceAt[i]!;
        if (lit < RING_LIFE) {
          const k = 1 - lit / RING_LIFE;
          [lr, lg, lb] = this.ringRgb.map((v) => v * k) as unknown as Rgb;
          [fr, fg, fb] = this.ink ? this.ringInk : this.ringRgb;
          slot = ringSlot;
        } else if (since < TRACE_LIFE) {
          // A trail: the cell's light fading where it was, no glyph.
          const k = Math.pow(1 - since / TRACE_LIFE, 1.6);
          [lr, lg, lb] = this.traceRgb.map((v) => v * k * 0.55) as unknown as Rgb;
        }
      }
      own[o] = lr;
      own[o + 1] = lg;
      own[o + 2] = lb;
      own[o + 3] = 255;
      force[o] = fr;
      force[o + 1] = fg;
      force[o + 2] = fb;
      force[o + 3] = slot;
    }
  }

  draw(life: Life) {
    if (!life.cols || !this.width || this.gl.isContextLost()) return;
    this.layout(life);
    const gl = this.gl;
    this.fill(life);
    upload(gl, this.own!, this.cols, this.rows, this.ownBuf);
    upload(gl, this.force!, this.cols, this.rows, this.forceBuf);
    blur(gl, this.blurP, this.own!, this.tmp!, this.near!, 1.1);
    blur(gl, this.blurP, this.near!.tex, this.tmp!, this.halo!, 2.6);
    blur(gl, this.blurP, this.halo!.tex, this.tmp!, this.pool!, 7);
    const p = this.palette;
    const [centre, rim] = p.dish.map((c) => rgbOf(c).map((v) => v / 255) as unknown as [number, number, number]);
    pass(gl, this.picture, this.pic!, (q) => {
      bindTex(gl, q, "uNear", this.near!.tex, 0);
      bindTex(gl, q, "uHalo", this.halo!.tex, 1);
      bindTex(gl, q, "uPool", this.pool!.tex, 2);
      gl.uniform3fv(q.at("uCentre"), centre!);
      gl.uniform3fv(q.at("uRim"), rim!);
      gl.uniform2f(q.at("uAspect"), this.cols * this.cw, this.rows * this.ch);
      gl.uniform1f(q.at("uNearK"), p.near);
      gl.uniform1f(q.at("uHaloK"), p.halo);
      gl.uniform1f(q.at("uPoolK"), p.pool);
      gl.uniform1i(q.at("uInk"), this.ink ? 1 : 0);
    });
    this.chars.draw(this.pic!.tex, this.force!, { ...p.look, ink: this.ink }, this.canvas.width, this.canvas.height, this.cw * this.dpr, this.ch * this.dpr);
  }
}
