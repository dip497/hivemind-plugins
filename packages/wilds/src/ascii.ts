/**
 * A picture rendered through characters. A scene paints its picture at one pixel per cell into
 * `pic` (sky, shapes with real silhouettes, light and shade, haze, glow round its lights); this pass
 * turns it into characters, each cell taking:
 *
 * - its glyph from the picture's brightness there, on a ramp measured from the face's own coverage
 *   (by night the brighter the denser; by day ink on paper, the darker the denser);
 * - on an edge, a line along it (`| / - \`), its direction from the brightness's gradient (Sobel),
 *   so outlines are drawn with lines, not with fill characters;
 * - its colour from the picture's colour there.
 *
 * Under the characters lies the picture itself, dimmed (by night) or a little paler (by day), flat
 * in each cell and snapped to the cells, so there are no seams and no holes between glyphs; by night a soft bloom of it
 * glows round its lights. Only cells whose glyph or colour changed are drawn again, into a layer of
 * characters kept between frames.
 */
import type { Draw2D } from "./cells";
import { cellFont } from "./grid";

/** Characters the ramp is measured from: from a dot to the densest marks, no letters (they read
 *  as text), none of the line glyphs edges use. */
const CANDIDATES = " .`',:;~\"^=+*%&#8@";
/** How many steps the ramp has. */
const STEPS = 11;
/** An sRGB channel (0 to 255) as linear light. */
const LINEAR = Float32Array.from({ length: 256 }, (_, v) => ((v / 255) <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));

export interface AsciiStyle {
  /** By night: brighter is denser, glyphs lit over a dim picture. By day: ink on paper. */
  dark: boolean;
  /** By night, how bright the picture under the characters is (0 to 1); by day, how far toward
   *  white paper it is washed. */
  dim: number;
  wash: number;
  /** How strong the bloom round the lights is (0 for none). */
  bloom: number;
  /** The window of lightness (0 to 1, as the eye sees it) the ramp spans: by night from `lo` (and
   *  darker: no character) to `hi` (the densest); by day the same, of darkness. */
  lo: number;
  hi: number;
}

export class AsciiPass {
  /** The picture, one pixel a cell: the scene paints it each frame. */
  readonly pic = new OffscreenCanvas(1, 1);
  readonly pg: OffscreenCanvasRenderingContext2D;
  private back = new OffscreenCanvas(1, 1);
  private bg: OffscreenCanvasRenderingContext2D;
  /** The picture's lights alone (the moon, a fire, a lantern), one pixel a cell: the scene paints
   *  them each frame, and they bloom. */
  readonly lights = new OffscreenCanvas(1, 1);
  readonly lit: OffscreenCanvasRenderingContext2D;
  private glow = new OffscreenCanvas(1, 1);
  private gl: OffscreenCanvasRenderingContext2D;
  private layer = new OffscreenCanvas(1, 1);
  private lg: OffscreenCanvasRenderingContext2D;
  private drawnKey = new Int32Array(0);
  /** Cells an overlay character takes this frame: the pass leaves them clear. */
  private held = new Uint8Array(0);
  private heldList: number[] = [];
  private lum = new Float32Array(0);
  private ramp: string[] = [" "];
  private styles = new Map<number, string>();
  private cols = 0;
  private rows = 0;
  private cw = 8;
  private ch = 12;
  private dpr = 1;
  private family = "monospace";

  constructor() {
    this.pg = this.pic.getContext("2d", { willReadFrequently: true })!;
    this.bg = this.back.getContext("2d")!;
    this.lit = this.lights.getContext("2d")!;
    this.gl = this.glow.getContext("2d")!;
    this.lg = this.layer.getContext("2d")!;
  }

  resize(cols: number, rows: number, cw: number, ch: number, dpr: number) {
    this.cols = cols;
    this.rows = rows;
    this.cw = cw;
    this.ch = ch;
    this.dpr = dpr;
    for (const c of [this.pic, this.back, this.lights]) {
      c.width = cols;
      c.height = rows;
    }
    this.glow.width = Math.max(1, Math.ceil(cols / 4));
    this.glow.height = Math.max(1, Math.ceil(rows / 4));
    this.layer.width = Math.round(cols * cw * dpr);
    this.layer.height = Math.round(rows * ch * dpr);
    this.drawnKey = new Int32Array(cols * rows).fill(-1);
    this.held = new Uint8Array(cols * rows);
    this.heldList = [];
    this.lum = new Float32Array(cols * rows);
    this.measure();
  }

  setFont(family: string) {
    this.family = family;
    this.measure();
  }

  /** Keep the cell under a point (px) clear this frame: an overlay character goes there. */
  hold(x: number, y: number) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    const i = r * this.cols + c;
    if (this.held[i]) return;
    this.held[i] = 1;
    this.heldList.push(i);
  }

  /** Every cell drawn again at the next render (a new look). */
  invalidate() {
    this.drawnKey.fill(-1);
  }

  /** The ramp: the candidates' ink measured in the face at the cell's size, sorted, and STEPS of them
   *  picked evenly from no ink to the most. */
  private measure() {
    if (!this.cols) return;
    const size = 32;
    const probe = new OffscreenCanvas(size, size);
    const g = probe.getContext("2d", { willReadFrequently: true })!;
    g.font = cellFont(size * 1.45, this.family);
    g.textAlign = "center";
    g.textBaseline = "middle";
    const ink = [...CANDIDATES].map((c) => {
      g.clearRect(0, 0, size, size);
      g.fillStyle = "#fff";
      g.fillText(c, size / 2, size / 2);
      const d = g.getImageData(0, 0, size, size).data;
      let sum = 0;
      for (let i = 3; i < d.length; i += 4) sum += d[i]!;
      return { c, ink: sum };
    }).sort((a, b) => a.ink - b.ink);
    const most = ink[ink.length - 1]!.ink || 1;
    this.ramp = Array.from({ length: STEPS }, (_, k) => {
      const want = (k / (STEPS - 1)) * most;
      return ink.reduce((best, x) => (Math.abs(x.ink - want) < Math.abs(best.ink - want) ? x : best)).c;
    });
    this.ramp[0] = " ";
    this.invalidate();
  }

  /** The style for a colour packed in 5 bits a channel. */
  private styleOf(key: number) {
    let s = this.styles.get(key);
    if (!s) {
      const r = ((key >> 10) & 31) * 8.226;
      const g = ((key >> 5) & 31) * 8.226;
      const b = (key & 31) * 8.226;
      s = `rgb(${r | 0},${g | 0},${b | 0})`;
      this.styles.set(key, s);
    }
    return s;
  }

  /** Turn the picture into characters and draw it all on `ctx`, at its full size. */
  render(ctx: Draw2D, style: AsciiStyle) {
    const { cols, rows, cw, ch, dpr } = this;
    if (!cols) return;
    const W = this.layer.width;
    const H = this.layer.height;
    // Under the characters: the picture, dimmed by night, scaled up smoothly.
    const b = this.bg;
    b.globalCompositeOperation = "copy";
    b.globalAlpha = 1;
    b.drawImage(this.pic, 0, 0);
    b.globalCompositeOperation = "source-over";
    b.fillStyle = style.dark ? `rgba(0,0,0,${1 - style.dim})` : `rgba(255,255,255,${style.wash})`;
    b.fillRect(0, 0, cols, rows);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // Flat in each cell, not smoothed: a blurred ground makes sharp glyphs look out of focus.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.back, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    // The bloom round the lights: what the scene painted as its lights, softened, added.
    if (style.dark && style.bloom > 0) {
      const g = this.gl;
      g.globalCompositeOperation = "copy";
      g.drawImage(this.lights, 0, 0, this.glow.width, this.glow.height);
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = style.bloom;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(this.glow, 0, 0, W, H);
      ctx.imageSmoothingQuality = "low";
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
    // The characters, from the picture: each cell's brightness, and its gradient for an edge.
    const d = this.pg.getImageData(0, 0, cols, rows).data;
    const lum = this.lum;
    // Lightness as the eye sees it: the cube root of the light.
    for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = Math.cbrt(0.2126 * LINEAR[d[p]!]! + 0.7152 * LINEAR[d[p + 1]!]! + 0.0722 * LINEAR[d[p + 2]!]!);
    const lg = this.lg;
    let set = false;
    const ramp = this.ramp;
    const last = STEPS - 1;
    for (let r = 0; r < rows; r++) {
      const up = Math.max(0, r - 1) * cols;
      const mid = r * cols;
      const dn = Math.min(rows - 1, r + 1) * cols;
      for (let c = 0; c < cols; c++) {
        const l = Math.max(0, c - 1);
        const rr = Math.min(cols - 1, c + 1);
        const i = mid + c;
        const v = lum[i]!;
        const gx = lum[up + rr]! + 2 * lum[mid + rr]! + lum[dn + rr]! - lum[up + l]! - 2 * lum[mid + l]! - lum[dn + l]!;
        const gy = lum[dn + l]! + 2 * lum[dn + c]! + lum[dn + rr]! - lum[up + l]! - 2 * lum[up + c]! - lum[up + rr]!;
        const ink = ((style.dark ? v : 1 - v) - style.lo) / (style.hi - style.lo);
        let glyph = 0;
        // An edge: drawn on its lighter side by night, its darker side by day, as a line along it.
        const around = (lum[up + c]! + lum[dn + c]! + lum[mid + l]! + lum[mid + rr]!) / 4;
        if (gx * gx + gy * gy > 0.09 && ink > 0.05 && (style.dark ? v >= around : v <= around)) {
          const ax = Math.abs(gx);
          const ay = Math.abs(gy) * 1.4;
          glyph = ay > ax * 2.2 ? -1 : ax > ay * 2.2 ? -2 : gx * gy > 0 ? -3 : -4;
        } else glyph = ink <= 0 ? 0 : Math.min(last, 1 + Math.floor(ink * (STEPS - 1)));
        // Its colour, from the picture's there: lit by night, inked by day.
        const p = i * 4;
        const k = style.dark ? 1.3 : 0.52;
        const add = style.dark ? 22 : 0;
        const q = ((Math.min(255, d[p]! * k + add) >> 3) << 10) | ((Math.min(255, d[p + 1]! * k + add) >> 3) << 5) | (Math.min(255, d[p + 2]! * k + add) >> 3);
        const key = this.held[i] ? 1 : glyph === 0 ? 0 : ((glyph + 8) << 15) | q;
        if (key === this.drawnKey[i]) continue;
        this.drawnKey[i] = key;
        if (!set) {
          lg.setTransform(dpr, 0, 0, dpr, 0, 0);
          lg.font = cellFont(ch, this.family);
          lg.textAlign = "center";
          lg.textBaseline = "middle";
          set = true;
        }
        lg.clearRect(c * cw, r * ch, cw, ch);
        if (key <= 1) continue;
        lg.fillStyle = this.styleOf(q);
        lg.fillText(glyph === -1 ? "-" : glyph === -2 ? "|" : glyph === -3 ? "/" : glyph === -4 ? "\\" : ramp[glyph]!, c * cw + cw / 2, r * ch + ch / 2 + 1);
      }
    }
    this.lit.setTransform(1, 0, 0, 1, 0, 0);
    this.lit.clearRect(0, 0, cols, rows);
    for (const i of this.heldList) this.held[i] = 0;
    this.heldList.length = 0;
    ctx.drawImage(this.layer, 0, 0);
  }
}
