/**
 * Sand drawn in half blocks: each grain a rect of its colour, half a character cell, the shape a
 * terminal draws with `▀` and `▄`, drawn as a rect rather than trusted to a font. A grain with sky
 * above it is in full light, so the dunes' surfaces and the falling streams glow; the sand under it
 * darkens a step, and again four grains down. A click's puff of dust spreads from it as a ring of
 * specks in the characters' own cells.
 *
 * The canvas keeps what was drawn: each frame works out what every grain cell shows and paints again
 * only those that changed (the streams, the slopes, what a click threw), grouped by colour.
 */
import { PatternCanvas, edges, rowGround, steps } from "../canvas";
import { css, rgbOf, type Oklch, type Rgb } from "../colour";
import { hash2 } from "../random";
import { SAND_PALETTE, type SandPalette } from "./palette";
import { CODES, HUES, KEYS, SHADES, hueOfCode, type Sand } from "./sand";

/** A grain in full light, one under another, and one four or more down. */
export const TIERS = 3;
/** What a cell shows: 0 the sky; 1 + tier × CODES + (code − 1) a grain. */
const SHOWS = 1 + TIERS * CODES;
const REDRAW = 0xffff;
/** A click's puff: how fast it spreads (px/s), how long it lasts (s), its steps of fading, its specks. */
export const DUST_SPEED = 260;
export const DUST_LIFE = 0.6;
const DUST_LEVELS = 4;
export const DUST = [".", "·", ":", "'", "`", ","] as const;

/** `t` of the way from `a` to `b` in OKLCH, the short way round the hue. */
function between(a: Oklch, b: Oklch, t: number): Oklch {
  let dh = b[2] - a[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] + dh * t + 360) % 360];
}

/** How a grain of `code` is drawn at `tier` (0 in full light, 1 under one, 2 four or more down):
 *  its place round the palette's cycle, its shade, and the step darker the sand under it is. */
export function grainColour(p: SandPalette, code: number, tier: number): Rgb {
  const hue = hueOfCode(code);
  const k = Math.floor(hue / (HUES / KEYS));
  const base = between(p.sands[k]!, p.sands[(k + 1) % KEYS]!, (hue % (HUES / KEYS)) / (HUES / KEYS));
  const shade = (((code - 1) % SHADES) / (SHADES - 1) - 0.5) * p.shade;
  return rgbOf([base[0] + shade + (tier === 0 ? 0 : p.under[tier - 1]!), base[1], base[2]]);
}

export class SandRenderer extends PatternCanvas<Sand, SandPalette> {
  private shown = new Uint16Array(0);
  private drawn = new Uint16Array(0);
  private dust = new Uint8Array(0);
  private dustDrawn = new Uint8Array(0);
  private touched = new Uint8Array(0);
  private changed = new Int32Array(0);
  private order = new Int32Array(0);
  private counts = new Int32Array(SHOWS + 1);
  private xs = new Int32Array(1);
  private ys = new Int32Array(1);
  private cols = 0;
  private rows = 0;
  private gw = 0;
  private gh = 0;
  private ground: string[] = [];
  private styles: string[] = [];
  private dustStyles: string[] = [];

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, SAND_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.styles = new Array<string>(SHOWS).fill("");
    for (let code = 1; code <= CODES; code++) {
      for (let tier = 0; tier < TIERS; tier++) this.styles[1 + tier * CODES + code - 1] = css(grainColour(p, code, tier));
    }
    this.dustStyles = steps(p.ground[2]!, p.dust, DUST_LEVELS);
    this.ground = [];
  }

  private layout(sand: Sand) {
    if (sand.cols === this.cols && sand.rows === this.rows && sand.gw === this.gw && sand.gh === this.gh && !this.stale) return;
    this.cols = sand.cols;
    this.rows = sand.rows;
    this.gw = sand.gw;
    this.gh = sand.gh;
    const n = this.cols * this.rows;
    if (this.shown.length !== n) {
      this.shown = new Uint16Array(n);
      this.drawn = new Uint16Array(n);
      this.changed = new Int32Array(n);
      this.order = new Int32Array(n);
      const chars = this.cols * Math.ceil(this.rows / 2);
      this.dust = new Uint8Array(chars);
      this.dustDrawn = new Uint8Array(chars);
      this.touched = new Uint8Array(chars);
    }
    this.xs = edges(this.cols, this.gw, this.dpr);
    this.ys = edges(this.rows, this.gh, this.dpr);
    this.ground = [];
    this.stale = true;
  }

  /** What every cell shows now: its grain, by how deep under others it lies; the thrown grains where
   *  they fly; and the puffs of dust, in the character cells (two grains tall). */
  private see(sand: Sand) {
    const { cols, rows, shown } = this;
    const grain = sand.grain;
    for (let c = 0; c < cols; c++) {
      let over = 0;
      for (let i = c; i < grain.length; i += cols) {
        const g = grain[i]!;
        if (!g) {
          shown[i] = 0;
          over = 0;
          continue;
        }
        shown[i] = 1 + (over === 0 ? 0 : over < 4 ? 1 : 2) * CODES + g - 1;
        over++;
      }
    }
    for (const f of sand.flying) {
      const i = sand.cellAt(f.x, f.y);
      if (i >= 0) shown[i] = f.code;
    }
    this.dust.fill(0);
    const ch = this.gh * 2;
    const charRows = Math.ceil(rows / 2);
    for (const b of sand.bursts) {
      const age = sand.time - b.at;
      if (age < 0 || age >= DUST_LIFE) continue;
      const rad = DUST_SPEED * age;
      const band = this.gw * 0.8;
      const level = Math.ceil((1 - age / DUST_LIFE) * DUST_LEVELS);
      const c0 = Math.max(0, Math.floor((b.x - rad - band) / this.gw));
      const c1 = Math.min(cols - 1, Math.floor((b.x + rad + band) / this.gw));
      const r0 = Math.max(0, Math.floor((b.y - rad - band) / ch));
      const r1 = Math.min(charRows - 1, Math.floor((b.y + rad + band) / ch));
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const d = Math.hypot((c + 0.5) * this.gw - b.x, (r + 0.5) * ch - b.y);
          // A ring of specks, every other cell or so.
          if (Math.abs(d - rad) < band && hash2(c, r) < 0.6) this.dust[r * cols + c] = Math.max(this.dust[r * cols + c]!, level);
        }
      }
    }
  }

  draw(sand: Sand) {
    if (!sand.cols || !this.width) return;
    this.layout(sand);
    const g = this.ctx;
    const { xs, ys, cols, rows, shown, drawn } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.ground.length !== rows) this.ground = rowGround(this.palette.ground.map(rgbOf), rows, this.gh, this.height);
    this.see(sand);
    if (this.stale) {
      drawn.fill(REDRAW);
      this.dustDrawn.fill(0);
      this.stale = false;
    }
    // A cell whose dust came or went is painted again, grains and all.
    this.touched.fill(0);
    for (let k = 0; k < this.dust.length; k++) {
      if (this.dust[k] === this.dustDrawn[k]) continue;
      this.dustDrawn[k] = this.dust[k]!;
      this.touched[k] = 1;
      const r = Math.floor(k / cols) * 2;
      const c = k % cols;
      drawn[r * cols + c] = REDRAW;
      if (r + 1 < rows) drawn[(r + 1) * cols + c] = REDRAW;
    }
    let n = 0;
    for (let i = 0; i < shown.length; i++) {
      if (shown[i] === drawn[i]) continue;
      drawn[i] = shown[i]!;
      this.changed[n++] = i;
    }
    // By what they show (a counting sort), so each colour is set once; the sky by its rows.
    const counts = this.counts.fill(0);
    for (let j = 0; j < n; j++) counts[shown[this.changed[j]!]! + 1]!++;
    for (let k = 1; k <= SHOWS; k++) counts[k] = counts[k]! + counts[k - 1]!;
    for (let j = 0; j < n; j++) {
      const i = this.changed[j]!;
      const k = shown[i]!;
      this.order[counts[k]!] = i;
      counts[k] = counts[k]! + 1;
    }
    let style = "";
    for (let j = 0; j < n; j++) {
      const i = this.order[j]!;
      const k = shown[i]!;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      const fill = k ? this.styles[k]! : this.ground[r]!;
      if (fill !== style) g.fillStyle = style = fill;
      g.fillRect(xs[c]!, ys[r]!, xs[c + 1]! - xs[c]!, ys[r + 1]! - ys[r]!);
      if (this.dust[(r >> 1) * cols + c]) this.touched[(r >> 1) * cols + c] = 1;
    }
    // The dust over them.
    g.font = `600 ${Math.round(this.gh * 2 * 0.74 * this.dpr)}px ${this.family}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (let k = 0; k < this.dust.length; k++) {
      const level = this.dust[k]!;
      if (!level || !this.touched[k]) continue;
      const r = Math.floor(k / cols) * 2;
      const c = k % cols;
      const fill = this.dustStyles[level]!;
      if (fill !== style) g.fillStyle = style = fill;
      const bottom = ys[Math.min(rows, r + 2)]!;
      g.fillText(DUST[Math.floor(hash2(c, r + 7) * DUST.length)]!, (xs[c]! + xs[c + 1]!) / 2, (ys[r]! + bottom) / 2);
    }
  }
}
