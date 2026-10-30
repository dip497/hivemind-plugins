/**
 * Life drawn as a glowing colony, in WebGL. Each live cell is a glyph of its age (a newborn's `@`
 * settling into an `o`) in its age's colour, and gives off light in that colour; a dying cell's
 * trace and a click's ring give off a little too. That light, blurred near (a halo round each cell)
 * and far (pooling where life is thick), lies over a ground that is never bare, and the whole field
 * is turned into characters (charpass.ts): faint glyphs where the light is, the live cells' own
 * glyphs over them, the picture showing between them, the brightest blooming. On paper the same in
 * inks: each cell an ink of its age, its halo a wash of that ink.
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
const AGES = [["@", "@"], ["@", "@"], ["#", "#"], ["%", "&"], ["*", "*"], ["x", "+"], ["o", "o"], ["o", "o"]] as const;
const TRACES = ["·", ":"] as const;
const RING = "+";
/** Every character Life draws itself (the field's own come from the tone ramp, charpass.ts). */
export const LIFE_GL_GLYPHS = [...new Set([...AGES.flat(), ...TRACES, RING])].join("");

/** A live cell's level by its age in generations. */
export function levelOf(age: number) {
  return age === 0 ? 1 : age === 1 ? 2 : age === 2 ? 3 : age <= 4 ? 4 : age <= 8 ? 5 : age <= 20 ? 6 : 7;
}

export interface LifeGlPalette {
  /** The board, top to bottom: never black. */
  ground: Oklch[];
  /** Each level's colour, being born to oldest: its glyph's, and its light's. */
  ages: Oklch[];
  /** How much light each level gives off. */
  light: number[];
  /** A trace's colour, and a ring's. */
  trace: Oklch;
  ring: Oklch;
  /** On paper, each level's wash: a pastel the paper is tinted toward round it. */
  washes?: Oklch[];
  /** How strong the halo round each cell is, and the light pooling where life is thick. */
  halo: number;
  pool: number;
  look: Omit<CharLook, "base" | "ink">;
}

export const LIFE_GL_PALETTE: { dark: LifeGlPalette; light: LifeGlPalette } = {
  dark: {
    ground: [[0.2, 0.032, 205], [0.19, 0.036, 185], [0.18, 0.04, 165]],
    ages: [[0.8, 0.12, 158], [0.96, 0.08, 155], [0.9, 0.15, 150], [0.84, 0.16, 154], [0.78, 0.15, 160], [0.72, 0.13, 170], [0.67, 0.115, 180], [0.62, 0.1, 188]],
    light: [0.6, 1, 0.9, 0.78, 0.66, 0.56, 0.48, 0.42],
    trace: [0.62, 0.11, 172],
    ring: [0.92, 0.12, 165],
    halo: 0.55,
    pool: 1.1,
    look: { ground: 0.9, gain: 1.25, full: 0.5, edge: 0, bloom: 0.55, bloomFrom: 0.35 },
  },
  light: {
    ground: [[0.97, 0.012, 90], [0.962, 0.015, 85], [0.952, 0.018, 80]],
    ages: [[0.55, 0.09, 278], [0.3, 0.13, 276], [0.34, 0.12, 272], [0.38, 0.1, 266], [0.43, 0.08, 250], [0.48, 0.065, 70], [0.53, 0.06, 64], [0.57, 0.055, 62]],
    light: [0.5, 1, 0.9, 0.78, 0.66, 0.56, 0.48, 0.42],
    trace: [0.66, 0.05, 66],
    ring: [0.35, 0.12, 276],
    washes: [[0.8, 0.09, 278], [0.74, 0.12, 278], [0.76, 0.11, 272], [0.78, 0.1, 262], [0.8, 0.08, 245], [0.82, 0.07, 75], [0.84, 0.06, 70], [0.85, 0.055, 68]],
    halo: 0.5,
    pool: 0.75,
    look: { ground: 1, gain: 0.25, full: 1.6, edge: 0, bloom: 0.2, bloomFrom: 0.5 },
  },
};

const PICTURE = `
uniform sampler2D uHalo;
uniform sampler2D uPool;
uniform sampler2D uOwn;
uniform vec3 uTop, uMid, uBottom;
uniform float uHaloK, uPoolK;
uniform int uInk;
void main() {
  float y = vUv.y;
  vec3 ground = y < 0.5 ? mix(uTop, uMid, y * 2.0) : mix(uMid, uBottom, y * 2.0 - 1.0);
  vec3 light = texture(uHalo, vUv).rgb * uHaloK + texture(uPool, vUv).rgb * uPoolK + texture(uOwn, vUv).rgb * 0.15;
  // On dark, light adds; on paper, each ink's wash takes its share of the light away.
  vec3 c = uInk == 1 ? ground * (vec3(1.0) - min(vec3(0.9), light)) : ground + light;
  outColor = vec4(c, 1.0);
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
  private halo: Target | null = null;
  private pool: Target | null = null;
  private pic: Target | null = null;
  /** Each level's glyph colour and light, and a trace's and a ring's, as bytes. */
  private glyphRgb: Rgb[] = [];
  private lightRgb: Rgb[] = [];
  private traceRgb: Rgb = [0, 0, 0];
  private ringRgb: Rgb = [0, 0, 0];
  /** On paper: the paper, and the inks of a trace and a ring. */
  private paperRgb: Rgb = [255, 255, 255];
  private traceInk: Rgb = [0, 0, 0];
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
    // The light a cell gives off: on dark its colour, dimmed by its level. On paper its wash: how
    // much of each channel a pale tint of its ink takes from the paper, so a halo is a watercolour of
    // the ink, not a grey smudge.
    const paper = rgbOf(p.ground[1]!);
    const wash = (c: Oklch, k: number): Rgb => {
      const tint = rgbOf(c);
      return paper.map((v, i) => Math.min(255, Math.max(0, ((v - tint[i]!) / Math.max(1, v)) * 255 * k))) as unknown as Rgb;
    };
    this.lightRgb = p.ages.map((c, k) => (this.ink ? wash(p.washes?.[k] ?? c, p.light[k]!) : mix(black, rgbOf(c), p.light[k]!)));
    this.traceRgb = this.ink ? wash(p.washes?.[7] ?? p.trace, 0.6) : rgbOf(p.trace);
    this.ringRgb = this.ink ? wash(p.washes?.[1] ?? p.ring, 1) : mix(black, rgbOf(p.ring), 0.9);
    this.paperRgb = paper;
    this.traceInk = rgbOf(p.trace);
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
    for (const t of [this.tmp, this.halo, this.pool, this.pic]) dropTarget(gl, t);
    const n = this.cols * this.rows;
    this.ownBuf = new Uint8Array(n * 4);
    this.forceBuf = new Uint8Array(n * 4);
    this.own = texture(gl, this.cols, this.rows, true, null);
    this.force = texture(gl, this.cols, this.rows, false, null);
    this.tmp = target(gl, this.cols, this.rows);
    this.halo = target(gl, this.cols, this.rows);
    this.pool = target(gl, this.cols, this.rows);
    this.pic = target(gl, this.cols, this.rows);
  }

  /** Each cell's light and its own glyph, from the board as it is. */
  private fill(life: Life) {
    const own = this.ownBuf;
    const force = this.forceBuf;
    const { cols } = this;
    const traceSlot = [this.chars.slot(TRACES[0]), this.chars.slot(TRACES[1])];
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
          const k = Math.pow(1 - since / TRACE_LIFE, 1.6);
          [lr, lg, lb] = this.traceRgb.map((v) => v * k * 0.5) as unknown as Rgb;
          [fr, fg, fb] = this.ink ? mix(this.paperRgb, this.traceInk, 0.35 + 0.65 * k) : (this.traceRgb.map((v) => v * (0.35 + 0.65 * k)) as unknown as Rgb);
          slot = traceSlot[k > 0.55 ? 1 : 0]!;
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
    blur(gl, this.blurP, this.own!, this.tmp!, this.halo!, 2.4);
    blur(gl, this.blurP, this.halo!.tex, this.tmp!, this.pool!, 7);
    const p = this.palette;
    const [top, mid, bottom] = p.ground.map((c) => rgbOf(c).map((v) => v / 255) as unknown as [number, number, number]);
    pass(gl, this.picture, this.pic!, (q) => {
      bindTex(gl, q, "uHalo", this.halo!.tex, 0);
      bindTex(gl, q, "uPool", this.pool!.tex, 1);
      bindTex(gl, q, "uOwn", this.own!, 2);
      gl.uniform3fv(q.at("uTop"), top!);
      gl.uniform3fv(q.at("uMid"), mid!);
      gl.uniform3fv(q.at("uBottom"), bottom!);
      gl.uniform1f(q.at("uHaloK"), p.halo);
      gl.uniform1f(q.at("uPoolK"), p.pool);
      gl.uniform1i(q.at("uInk"), this.ink ? 1 : 0);
    });
    const base = this.ink ? top! : ([0, 0, 0] as [number, number, number]);
    this.chars.draw(this.pic!.tex, this.force!, { ...p.look, ink: this.ink, base }, this.canvas.width, this.canvas.height, this.cw * this.dpr, this.ch * this.dpr);
  }
}
