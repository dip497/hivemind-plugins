/**
 * Life drawn in characters: tone from a ramp of glyphs and colours. A live cell is a faint block of
 * its colour with its glyph on it: being born it brightens into an `@`, and as it lives on it
 * settles through denser and quieter glyphs and darker colours into an `o`. A dead cell leaves a
 * trace that fades from `:` to `·`; a click's ring of light lights the cells it passes, a bright
 * `+`. Each empty cell holds a faint dot, so the empty board reads as
 * a board.
 *
 * The canvas keeps what was drawn: each frame works out what every cell shows (its key) and paints
 * again only the cells whose key changed, a few hundred of some ten thousand, grouped by colour.
 */
import { PatternCanvas, edges, rowGround, steps } from "../canvas";
import { css, mix, rgbOf, type Rgb } from "../colour";
import { hash2 } from "../random";
import type { Life } from "./life";
import { LIFE_PALETTE, type LifePalette } from "./palette";

/** Seconds a newborn takes to brighten. */
const FADE_IN = 0.12;
/** Seconds a trace takes to fade. */
export const TRACE_LIFE = 2.6;
const TRACE_LEVELS = 6;
/** A live cell's glyphs by its level (being born, newborn, then by age), two of each for variety. */
const AGES = [["@", "@"], ["@", "@"], ["#", "#"], ["%", "&"], ["*", "*"], ["x", "x"], ["o", "o"], ["o", "o"]] as const;
/** How far toward its colour a live cell's block is, by its level: a newborn's is the brightest. */
const BLOCK = [0.12, 0.26, 0.22, 0.2, 0.18, 0.16, 0.15, 0.14];
/** A trace's glyph by its level, faintest first. */
const TRACES = ["·", "·", "·", "·", ":", ":"] as const;
/** Seconds a cell a click's ring passed over shines, and its glyph as it fades, faintest first. */
const RING_LIFE = 0.16;
const RINGS = ["+", "+", "+"] as const;
/** Keys: 0 the empty board; then each live level's two glyphs; then each trace level; then each
 *  level of a ring's light. */
const LIVE = 1;
const TRACE = LIVE + AGES.length * 2;
const RING = TRACE + TRACE_LEVELS;
const KEYS = RING + RINGS.length;

/** A live cell's level by its age in generations. */
function levelOf(age: number) {
  return age === 0 ? 1 : age === 1 ? 2 : age === 2 ? 3 : age <= 4 ? 4 : age <= 8 ? 5 : age <= 20 ? 6 : 7;
}

/** The block under a live cell at each level: `BLOCK` of the way from the board to its colour. */
export function blockColours(p: LifePalette): Rgb[] {
  const board = rgbOf(p.ground[1]!);
  return BLOCK.map((share, level) => mix(board, rgbOf(p.ages[level]!), share));
}

export class LifeRenderer extends PatternCanvas<Life, LifePalette> {
  private keys = new Uint8Array(0);
  private variant = new Uint8Array(0);
  private xs = new Int32Array(1);
  private ys = new Int32Array(1);
  private cols = 0;
  private rows = 0;
  private cw = 0;
  private ch = 0;
  private ground: string[] = [];
  private dot = "";
  private styles: string[] = [];
  private blocks: string[] = [];
  private glyphs: string[] = [];
  private changed = new Int32Array(0);
  private counts = new Int32Array(KEYS + 1);
  private order = new Int32Array(0);

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    super(canvas, LIFE_PALETTE);
  }

  protected styled() {
    const p = this.palette;
    this.dot = css(rgbOf(p.dot));
    this.styles = new Array<string>(KEYS).fill("");
    this.blocks = new Array<string>(KEYS).fill("");
    this.glyphs = new Array<string>(KEYS).fill("");
    const blocks = blockColours(p);
    AGES.forEach((pair, level) => pair.forEach((g, v) => {
      this.styles[LIVE + level * 2 + v] = css(rgbOf(p.ages[level]!));
      this.blocks[LIVE + level * 2 + v] = css(blocks[level]!);
      this.glyphs[LIVE + level * 2 + v] = g;
    }));
    // A trace's levels, from just above the board to its full colour.
    const trace = steps(p.ground[1]!, p.trace, TRACE_LEVELS);
    for (let k = 0; k < TRACE_LEVELS; k++) {
      this.styles[TRACE + k] = trace[k + 1]!;
      this.glyphs[TRACE + k] = TRACES[k]!;
    }
    // A ring's light, from a bright trace up to a newborn's colour.
    const ring = steps(p.trace, p.ages[1]!, RINGS.length);
    for (let k = 0; k < RINGS.length; k++) {
      this.styles[RING + k] = ring[k + 1]!;
      this.glyphs[RING + k] = RINGS[k]!;
    }
    this.ground = [];
  }

  /** The board's cells as `life` has them now, at this size. */
  private layout(life: Life) {
    if (life.cols === this.cols && life.rows === this.rows && life.cw === this.cw && life.ch === this.ch && this.xs.length === life.cols + 1 && !this.stale) return;
    this.cols = life.cols;
    this.rows = life.rows;
    this.cw = life.cw;
    this.ch = life.ch;
    const n = this.cols * this.rows;
    if (this.keys.length !== n) {
      this.keys = new Uint8Array(n);
      this.changed = new Int32Array(n);
      this.order = new Int32Array(n);
      this.variant = new Uint8Array(n);
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.variant[r * this.cols + c] = hash2(c, r) < 0.5 ? 0 : 1;
    }
    this.xs = edges(this.cols, this.cw, this.dpr);
    this.ys = edges(this.rows, this.ch, this.dpr);
    this.stale = true;
  }

  /** What cell `i` shows at `life`'s time: its key. */
  private keyOf(life: Life, i: number) {
    if (life.cells[i]) {
      const age = life.age[i]!;
      const level = age === 0 && life.time - life.bornAt[i]! < FADE_IN ? 0 : levelOf(age);
      return LIVE + level * 2 + this.variant[i]!;
    }
    const lit = life.time - life.litAt[i]!;
    if (lit < RING_LIFE) return RING + Math.min(RINGS.length - 1, Math.floor((1 - lit / RING_LIFE) * RINGS.length));
    const since = life.time - life.traceAt[i]!;
    if (since >= TRACE_LIFE) return 0;
    const left = Math.pow(1 - since / TRACE_LIFE, 1.6);
    return TRACE + Math.min(TRACE_LEVELS - 1, Math.floor(left * TRACE_LEVELS));
  }

  draw(life: Life) {
    if (!life.cols || !this.width) return;
    this.layout(life);
    const g = this.ctx;
    const { xs, ys, cols, rows, keys } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (this.ground.length !== rows) this.ground = rowGround(this.palette.ground.map(rgbOf), rows, this.ch, this.height);
    let n = 0;
    if (this.stale) {
      // All of it: the board, and every cell drawn again.
      for (let r = 0; r < rows; r++) {
        g.fillStyle = this.ground[r]!;
        g.fillRect(0, ys[r]!, xs[cols]!, ys[r + 1]! - ys[r]!);
      }
      for (let i = 0; i < keys.length; i++) {
        keys[i] = this.keyOf(life, i);
        this.changed[n++] = i;
      }
      this.stale = false;
    } else {
      for (let i = 0; i < keys.length; i++) {
        const k = this.keyOf(life, i);
        if (k === keys[i]) continue;
        keys[i] = k;
        this.changed[n++] = i;
      }
    }
    if (!n) return;
    // The changed cells by key (a counting sort), so each colour is set once.
    const counts = this.counts.fill(0);
    for (let j = 0; j < n; j++) counts[keys[this.changed[j]!]! + 1]!++;
    for (let k = 1; k <= KEYS; k++) counts[k] = counts[k]! + counts[k - 1]!;
    for (let j = 0; j < n; j++) {
      const i = this.changed[j]!;
      const k = keys[i]!;
      this.order[counts[k]!] = i;
      counts[k] = counts[k]! + 1;
    }
    // Each cell's ground: a live cell's block, the board's row colour under the rest.
    let style = "";
    for (let j = 0; j < n; j++) {
      const i = this.order[j]!;
      const k = keys[i]!;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      const fill = k >= LIVE && k < TRACE ? this.blocks[k]! : this.ground[r]!;
      if (fill !== style) g.fillStyle = style = fill;
      g.fillRect(xs[c]!, ys[r]!, xs[c + 1]! - xs[c]!, ys[r + 1]! - ys[r]!);
    }
    // Then what is on it: a dot on the empty board, a glyph on the rest.
    const dot = Math.max(1, Math.round(this.dpr * 1.2));
    const fontPx = Math.round(Math.min(this.ch * 0.92, this.cw * 1.2) * this.dpr);
    g.font = `600 ${fontPx}px ${this.family}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    style = "";
    for (let j = 0; j < n; j++) {
      const i = this.order[j]!;
      const k = keys[i]!;
      const r = (i / cols) | 0;
      const c = i - r * cols;
      const cx = (xs[c]! + xs[c + 1]!) / 2;
      const cy = (ys[r]! + ys[r + 1]!) / 2;
      if (k === 0) {
        if (style !== this.dot) g.fillStyle = style = this.dot;
        g.fillRect(Math.round(cx - dot / 2), Math.round(cy - dot / 2), dot, dot);
        continue;
      }
      if (style !== this.styles[k]) g.fillStyle = style = this.styles[k]!;
      g.fillText(this.glyphs[k]!, cx, cy);
    }
  }
}

/** Every character Life draws. */
export const LIFE_GLYPHS = [...new Set([...AGES.flat(), ...TRACES, ...RINGS])].join("");
