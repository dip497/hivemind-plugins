/**
 * The grid of character cells every scene draws in, and what it shares: the cells' size and the
 * backdrop painted once per size and look. A scene's renderer extends it with its creatures.
 */
import { clamp } from "./math";

/** A 2D context to draw in: the page's canvas, or a layer kept offscreen. */
export type Draw2D = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/** The cell a window of `width` by `height` is drawn in. From the shorter side, as the creatures
 *  are: a shark is the same number of cells long on any shape of window (from the width alone, a
 *  wide one drew it coarser). Taller than wide, as a terminal's cells are. */
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
  /** The backdrop (`paintBackground`), painted once per size and look and copied in each frame;
   *  `bgVersion` counts its paintings. */
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

  /** The grid has a new number of cells, `n`: the scene's per-cell buffers are made again. */
  protected abstract allocate(n: number): void;

  resize(width: number, height: number, dpr: number) {
    const prevCols = this.cols;
    const prevRows = this.rows;
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

    if (this.cols !== prevCols || this.rows !== prevRows) this.allocate(this.cols * this.rows);
    this.repaintBackground();
  }

  /** Paint the backdrop again, counting it. */
  protected repaintBackground() {
    this.bgVersion++;
    this.paintBackground();
  }

  protected cellIndex(x: number, y: number) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }
}
