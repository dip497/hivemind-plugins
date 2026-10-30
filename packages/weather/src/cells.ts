/**
 * The grid of character cells every weather scene draws in: the cells' size, the font their
 * characters are drawn in, the faint grid over the ground, and a renderer that keeps a backdrop
 * painted once per size and look. A scene's renderer extends it with what moves.
 */
import { clamp } from "./util";

/** A 2D context to draw in: the page's canvas, or a layer kept offscreen. */
export type Draw2D = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/** The cell a window of `width` by `height` is drawn in: from the shorter side, so a house or a
 *  drop is the same number of cells on any shape of window. Taller than wide, as a terminal's
 *  cells are. The simulations size what they hold by it too. */
export function cellSize(width: number, height: number) {
  const cw = clamp(Math.round(Math.min(width, height) / 110), 7, 13);
  return { cw, ch: Math.round(cw * 1.45) };
}

/** A faint cell grid, snapped to device pixels. */
export function paintGrid(g: Draw2D, W: number, H: number, cw: number, ch: number, dpr: number, stroke: string) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.beginPath();
  for (let c = 0; c <= Math.ceil(W / cw); c++) {
    const x = Math.round(c * cw * dpr) + 0.5;
    g.moveTo(x, 0);
    g.lineTo(x, H * dpr);
  }
  for (let r = 0; r <= Math.ceil(H / ch); r++) {
    const y = Math.round(r * ch * dpr) + 0.5;
    g.moveTo(0, y);
    g.lineTo(W * dpr, y);
  }
  g.stroke();
}

/** The font every cell's character is drawn in, at the grid's size: semibold, as thin weights
 *  vanish at these sizes. */
export const cellFont = (ch: number, family: string) => `600 ${Math.round(ch * 0.74)}px ${family}`;

/** Ready `g` to draw cells' characters, each centred in its cell. */
export function textCells(g: Draw2D, ch: number, family: string) {
  g.font = cellFont(ch, family);
  g.textAlign = "center";
  g.textBaseline = "middle";
}

export abstract class CellRenderer {
  protected ctx: Draw2D;
  /** The backdrop (`paintBackground`), painted once per size and look; `bgVersion` counts its
   *  paintings, so a layer made from it knows when to be made again. */
  protected bg = new OffscreenCanvas(1, 1);
  protected bgVersion = 0;
  protected dpr = 1;
  protected width = 0;
  protected height = 0;
  protected cw = 12;
  protected ch = 18;
  protected cols = 0;
  protected rows = 0;
  protected fontFamily = "monospace";

  constructor(protected canvas: HTMLCanvasElement | OffscreenCanvas) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Draw2D | null;
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  /** Paint the backdrop into `bg`, at its size. */
  protected abstract paintBackground(): void;

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    this.repaintBackground();
  }

  /** Paint the backdrop again, counting it. */
  protected repaintBackground() {
    this.bgVersion++;
    this.paintBackground();
  }

  /** A cell's rectangle in device pixels, snapped so neighbours share their edges. */
  protected cellRect(c: number, r: number) {
    const { cw, ch, dpr } = this;
    const x0 = Math.round(c * cw * dpr);
    const y0 = Math.round(r * ch * dpr);
    return { x: x0, y: y0, w: Math.round((c + 1) * cw * dpr) - x0, h: Math.round((r + 1) * ch * dpr) - y0 };
  }
}

/** One block cell at (c, r) of a grid of `cw` by `ch` cells: its seam (the whole cell), a block
 *  inset by the seam's 1px, and a character on it. */
export function blockCell(g: Draw2D, c: number, r: number, cw: number, ch: number, seam: string, block: string, ink?: string, glyph?: string) {
  g.fillStyle = seam;
  g.fillRect(c * cw, r * ch, cw, ch);
  g.fillStyle = block;
  g.fillRect(c * cw + 1, r * ch + 1, cw - 1, ch - 1);
  if (ink && glyph) {
    g.fillStyle = ink;
    g.fillText(glyph, (c + 0.5) * cw, (r + 0.5) * ch + 1);
  }
}
