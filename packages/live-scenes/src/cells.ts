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

/** A cell's six parts, two across by three down: part `k` is column `k % 2`, row `k >> 1`. A body
 *  is sampled at each part's middle, and drawn by the parts it covers, so its outline is two to three
 *  times finer than the cells while staying on their grid. */
export const PART_X = [0.25, 0.75, 0.25, 0.75, 0.25, 0.75] as const;
export const PART_Y = [1 / 6, 1 / 6, 0.5, 0.5, 5 / 6, 5 / 6] as const;
/** Every part of a cell. */
export const WHOLE = 63;

/** Fill the parts of cell (`c`, `r`) that `mask` holds, in CSS pixels under a `dpr` transform, each
 *  edge on a device pixel, so neighbouring cells meet with no seam and no overlap. */
export function fillParts(g: Draw2D, c: number, r: number, cw: number, ch: number, dpr: number, mask: number) {
  const x0 = Math.round(c * cw * dpr) / dpr;
  const x2 = Math.round((c + 1) * cw * dpr) / dpr;
  if (mask === WHOLE) {
    g.fillRect(x0, Math.round(r * ch * dpr) / dpr, x2 - x0, Math.round((r + 1) * ch * dpr) / dpr - Math.round(r * ch * dpr) / dpr);
    return;
  }
  const x1 = Math.round((c + 0.5) * cw * dpr) / dpr;
  for (let row = 0; row < 3; row++) {
    const two = (mask >> (row * 2)) & 3;
    if (!two) continue;
    const y0 = Math.round((r + row / 3) * ch * dpr) / dpr;
    const y1 = Math.round((r + (row + 1) / 3) * ch * dpr) / dpr;
    if (two === 3) g.fillRect(x0, y0, x2 - x0, y1 - y0);
    else if (two === 1) g.fillRect(x0, y0, x1 - x0, y1 - y0);
    else g.fillRect(x1, y0, x2 - x1, y1 - y0);
  }
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
