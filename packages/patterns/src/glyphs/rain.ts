/**
 * Glyph Rain: columns of characters falling at three depths. Each depth is a grid of its own (far
 * ones smaller, slower and dimmer), each of its cells holding a character that flips now and then.
 * Down some columns a stream falls: a bright head, rerolling its character with every cell it
 * enters, and a tail of the characters it has passed, fading behind it. A stream that has fallen out
 * of the window starts again above it, in another column, at its own speed and length, so the rain
 * never stops and never thickens.
 *
 * The pointer parts the columns: the characters near it are pushed aside, round it, and flicker. A
 * click sends a ring out from where it landed, scrambling and brightening the characters it passes.
 */
import type { Sim } from "../scene";
import { clamp, rand, randInt } from "../random";

/** Letters, digits and symbols, Latin and Greek: all in the face the wallpaper brings (fonts/). */
export const GLYPHS = "0123456789ABEFHKMNRTVXZ+=*<>/\\|#%&$@?!:;^~§¶±×÷¤ΔΘΛΞΠΣΦΨΩαβγδζηθλμξπσφψω";

/** The three depths, far to near: the size of their characters (to the window's), how fast their
 *  streams fall (cells a second), how long their tails are, and how many columns in a hundred run. */
export const DEPTHS = [
  { size: 0.58, speed: [5, 9], length: [8, 18], share: 0.3, light: 0.5 },
  { size: 0.78, speed: [6, 11], length: [9, 20], share: 0.26, light: 0.75 },
  { size: 1, speed: [7, 13], length: [10, 22], share: 0.22, light: 1 },
] as const;

/** How often a character in a column flips on its own, a second. */
const FLIP = 0.12;
/** The pointer's reach (px), how far it pushes the characters aside at most, and how fast it comes
 *  and goes (per second). */
export const PART_REACH = 120;
export const PART_PUSH = 0.3;
const PART_EASE = 4;
/** How often a character near the pointer flips, a second, at its most, and how much it is lit. */
export const FLICKER = 7;
const FLICKER_LIGHT = 0.28;
/** How fast what is lit fades, a second: a ring leaves a short wake. */
const LIT_FADE = 8;
/** A click's ring: how fast it spreads (px/s), how far it goes, and how wide it is (px). */
export const RING_SPEED = 380;
export const RING_REACH = 520;
export const RING_BAND = 16;

export interface Stream {
  col: number;
  /** Its head's row, in cells (may be above the window, or below it). */
  head: number;
  speed: number;
  length: number;
}

export interface Layer {
  /** Its character's size (px), and its cells' width and height. */
  size: number;
  cw: number;
  ch: number;
  cols: number;
  rows: number;
  /** The character in each cell, as an index into GLYPHS. */
  glyphs: Uint8Array;
  streams: Stream[];
  /** Each cell's flicker: how much it has been brightened lately (0 … 1), by the pointer or a ring;
   *  and the cells lit now, in no order. */
  lit: Float32Array;
  litCells: number[];
}

export class Rain implements Sim {
  width = 0;
  height = 0;
  layers: Layer[] = [];
  time = 0;
  readonly pointer = { x: 0, y: 0, active: false };
  /** How far the columns are parted round the pointer now (0 … 1): it eases in and out. */
  part = 0;
  /** Where the parting is centred: where the pointer was when it was last over the window. */
  centre = { x: 0, y: 0 };
  rings: { x: number; y: number; at: number }[] = [];

  resize(width: number, height: number) {
    const unit = clamp(Math.min(width, height) / 900, 0.75, 1.6) * 19;
    const old = this.layers.length ? { layers: this.layers, width: this.width, height: this.height } : null;
    this.width = width;
    this.height = height;
    this.layers = DEPTHS.map((d, k) => {
      const size = Math.round(unit * d.size);
      const cw = Math.round(size * 0.92);
      const ch = Math.round(size * 1.12);
      const cols = Math.ceil(width / cw);
      const rows = Math.ceil(height / ch);
      const glyphs = new Uint8Array(cols * rows);
      for (let i = 0; i < glyphs.length; i++) glyphs[i] = randInt(0, GLYPHS.length - 1);
      const layer: Layer = { size, cw, ch, cols, rows, glyphs, streams: [], lit: new Float32Array(cols * rows), litCells: [] };
      const want = Math.max(4, Math.round(cols * d.share));
      const was = old?.layers[k];
      if (was) {
        // Each stream kept, at the same share of the width and of the height.
        for (const s of was.streams) {
          layer.streams.push({ ...s, col: Math.min(cols - 1, Math.floor(((s.col + 0.5) / was.cols) * cols)), head: (s.head / was.rows) * rows });
        }
        // Copied where the old grid reaches, so the characters stay where they were.
        for (let r = 0; r < Math.min(rows, was.rows); r++) for (let c = 0; c < Math.min(cols, was.cols); c++) glyphs[r * cols + c] = was.glyphs[r * was.cols + c]!;
        while (layer.streams.length > want) layer.streams.splice(randInt(0, layer.streams.length - 1), 1);
      }
      // Spread over the window from the first frame: heads anywhere from above it to below it.
      while (layer.streams.length < want) layer.streams.push(this.stream(layer, k, rand(-0.2, 1.3) * rows));
      return layer;
    });
  }

  /** A new stream for `layer` (depth `k`), its head at `head`, in a column no other stream there
   *  holds if one is free. */
  private stream(layer: Layer, k: number, head: number): Stream {
    const d = DEPTHS[k]!;
    let col = randInt(0, layer.cols - 1);
    for (let t = 0; t < 8 && layer.streams.some((s) => s.col === col); t++) col = randInt(0, layer.cols - 1);
    return { col, head, speed: rand(d.speed[0], d.speed[1]), length: randInt(d.length[0], d.length[1]) };
  }

  point(x: number, y: number, active: boolean) {
    Object.assign(this.pointer, { x, y, active });
    if (active) this.centre = { x, y };
  }

  splash(x: number, y: number) {
    this.rings.push({ x, y, at: this.time });
    if (this.rings.length > 3) this.rings.shift();
  }

  /** How far the character at (x, y) is pushed aside by the pointer, in px: away from it, the most
   *  beside it, none beyond `PART_REACH`. */
  push(x: number, y: number) {
    if (this.part <= 0) return 0;
    const dx = x - this.centre.x;
    const dy = (y - this.centre.y) * 0.85;
    const d2 = dx * dx + dy * dy;
    if (d2 >= PART_REACH * PART_REACH) return 0;
    const near = 1 - Math.sqrt(d2) / PART_REACH;
    return (dx < 0 ? -1 : 1) * PART_REACH * PART_PUSH * near * near * this.part;
  }

  step(dt: number) {
    if (!this.layers.length) return;
    this.time += dt;
    this.part = clamp(this.part + (this.pointer.active ? 1 : -1) * PART_EASE * dt, 0, 1);
    this.rings = this.rings.filter((g) => RING_SPEED * (this.time - g.at) < RING_REACH);
    this.layers.forEach((layer, k) => {
      const { glyphs, cols, rows, lit } = layer;
      for (const s of layer.streams) {
        const before = Math.floor(s.head);
        s.head += s.speed * dt;
        // The head rerolls its character in each cell it enters.
        const now = Math.floor(s.head);
        if (now !== before && now >= 0 && now < rows) glyphs[now * cols + s.col] = randInt(0, GLYPHS.length - 1);
      }
      // A stream gone out of the window starts again above it, somewhere else.
      for (let j = 0; j < layer.streams.length; j++) {
        if (layer.streams[j]!.head - layer.streams[j]!.length < rows) continue;
        layer.streams.splice(j, 1);
        layer.streams.push(this.stream(layer, k, rand(-0.35, 0) * rows));
        j--;
      }
      // Characters flip on their own now and then.
      for (let n = poisson(FLIP * cols * rows * dt); n > 0; n--) glyphs[randInt(0, glyphs.length - 1)] = randInt(0, GLYPHS.length - 1);
      // The flicker fades.
      const fade = Math.exp(-dt * LIT_FADE);
      const still: number[] = [];
      for (const i of layer.litCells) {
        lit[i] = lit[i]! * fade;
        if (lit[i]! < 0.02) lit[i] = 0;
        else still.push(i);
      }
      layer.litCells = still;
      if (this.part > 0) this.flicker(layer, dt);
      for (const g of this.rings) this.scramble(layer, g);
    });
  }

  /** The characters near the pointer flip fast and brighten, the more the nearer. */
  private flicker(layer: Layer, dt: number) {
    const { x, y } = this.centre;
    const { cw, ch, cols, rows } = layer;
    const c0 = Math.max(0, Math.floor((x - PART_REACH) / cw));
    const c1 = Math.min(cols - 1, Math.floor((x + PART_REACH) / cw));
    const r0 = Math.max(0, Math.floor((y - PART_REACH) / ch));
    const r1 = Math.min(rows - 1, Math.floor((y + PART_REACH) / ch));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = Math.hypot((c + 0.5) * cw - x, (r + 0.5) * ch - y);
        if (d >= PART_REACH) continue;
        const near = (1 - d / PART_REACH) * this.part;
        const i = r * cols + c;
        if (Math.random() < FLICKER * near * dt) {
          layer.glyphs[i] = randInt(0, GLYPHS.length - 1);
          light(layer, i, FLICKER_LIGHT * near);
        }
      }
    }
  }

  /** A ring scrambles and lights the characters it is passing over. */
  private scramble(layer: Layer, g: Rain["rings"][number]) {
    const rad = RING_SPEED * (this.time - g.at);
    const strength = 1 - rad / RING_REACH;
    const { cw, ch, cols, rows } = layer;
    const r0 = Math.max(0, Math.floor((g.y - rad - RING_BAND) / ch));
    const r1 = Math.min(rows - 1, Math.floor((g.y + rad + RING_BAND) / ch));
    for (let r = r0; r <= r1; r++) {
      const dy = (r + 0.5) * ch - g.y;
      // Where this row crosses the ring: from its outer edge in to its inner one, on each side.
      const outer = Math.sqrt(Math.max(0, (rad + RING_BAND) ** 2 - dy * dy));
      const inner = Math.sqrt(Math.max(0, (rad - RING_BAND) ** 2 - dy * dy));
      for (const side of [-1, 1]) {
        const a = g.x + side * inner;
        const b = g.x + side * outer;
        const c0 = Math.max(0, Math.floor(Math.min(a, b) / cw));
        const c1 = Math.min(cols - 1, Math.floor(Math.max(a, b) / cw));
        for (let c = c0; c <= c1; c++) {
          const i = r * cols + c;
          const d = Math.hypot((c + 0.5) * cw - g.x, dy);
          const on = 1 - Math.abs(d - rad) / RING_BAND;
          if (on <= 0) continue;
          if (Math.random() < 0.35) layer.glyphs[i] = randInt(0, GLYPHS.length - 1);
          light(layer, i, 0.8 * on * strength);
        }
      }
    }
  }
}

/** Brighten cell `i` of `layer` to `to`, if it is not brighter already. */
function light(layer: Layer, i: number, to: number) {
  if (to <= layer.lit[i]!) return;
  if (!layer.lit[i]) layer.litCells.push(i);
  layer.lit[i] = to;
}

/** How many of something that comes `mean` times on average come this time. */
function poisson(mean: number) {
  if (mean > 30) return Math.round(mean + Math.sqrt(mean) * (Math.random() + Math.random() + Math.random() - 1.5) * 2);
  let n = 0;
  for (let p = Math.exp(-mean), s = p, u = Math.random(); u > s; n++) {
    p *= mean / (n + 1);
    s += p;
  }
  return n;
}
