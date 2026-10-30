/**
 * The grid of character cells every City scene draws in, and the renderer they share: the canvas
 * sized to the viewport times its pixel ratio, the cells' size, the scene's own palette for a dark
 * theme or a light one, and its characters' face. A scene's renderer extends it with what it draws.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { clamp } from "./util";
import { SCENE_FACE } from "./page";

/** A 2D context to draw in: the page's canvas, or a layer kept offscreen. */
export type Draw2D = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/** The cell a window of `width` by `height` is drawn in: from the shorter side, so a scene is the
 *  same number of cells tall on any shape of window; taller than wide, as a terminal's cells are. */
export function cellSize(width: number, height: number) {
  const cw = clamp(Math.round(Math.min(width, height) / 110), 7, 13);
  return { cw, ch: Math.round(cw * 1.45) };
}

/** The font every cell's character is drawn in, at the grid's size: semibold, as thin weights
 *  vanish at these sizes. */
export const cellFont = (ch: number, family: string, share = 0.74) => `600 ${Math.round(ch * share)}px ${family}`;

/** Ready `g` to draw characters, each centred on the point it is drawn at. */
export function textCells(g: Draw2D, ch: number, family: string, share = 0.74) {
  g.font = cellFont(ch, family, share);
  g.textAlign = "center";
  g.textBaseline = "middle";
}

/** A faint cell grid, snapped to device pixels; drawn with the transform at 1:1. */
export function paintGrid(g: Draw2D, W: number, H: number, cw: number, ch: number, dpr: number, stroke: string, fromRow = 0, toRow = Math.ceil(H / ch)) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = stroke;
  g.lineWidth = 1;
  g.beginPath();
  const y0 = Math.round(fromRow * ch * dpr);
  const y1 = Math.min(Math.round(toRow * ch * dpr), Math.round(H * dpr));
  for (let c = 0; c <= Math.ceil(W / cw); c++) {
    const x = Math.round(c * cw * dpr) + 0.5;
    g.moveTo(x, y0);
    g.lineTo(x, y1);
  }
  for (let r = fromRow; r <= toRow; r++) {
    const y = Math.round(r * ch * dpr) + 0.5;
    g.moveTo(0, y);
    g.lineTo(W * dpr, y);
  }
  g.stroke();
}

export abstract class SceneRenderer<P> {
  protected ctx: Draw2D;
  protected dpr = 1;
  protected width = 0;
  protected height = 0;
  protected cw = 12;
  protected ch = 18;
  protected cols = 0;
  protected rows = 0;
  /** The theme is light: the scene draws its day. */
  protected light = false;
  /** The palette the scene is drawn in now. */
  protected palette: P;
  protected fontFamily = `"${SCENE_FACE}", monospace`;
  private styledOnce = false;

  /** A scene drawing its own canvas in 2D gets its context (`ctx`); one turning a picture into
   *  characters on the GPU (ascii.ts) takes the canvas itself, and `ctx` is a context of its own
   *  off screen. */
  constructor(protected canvas: HTMLCanvasElement | OffscreenCanvas, private palettes: { dark: P; light: P }, draws2D = true) {
    const ctx = (draws2D ? canvas.getContext("2d", { alpha: false }) : new OffscreenCanvas(1, 1).getContext("2d")) as Draw2D | null;
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.palette = palettes.dark;
  }

  /** The cells a window is drawn in; a scene may draw in cells of its own shape. */
  protected cellsOf(width: number, height: number) {
    return cellSize(width, height);
  }

  /** The palette changed (`light`, `palette`), or the font: the scene works out its styles once, so
   *  a frame builds no colour strings. */
  protected abstract styled(): void;

  /** The size, the look or the font changed: whatever the scene keeps painted is painted again. */
  protected abstract repaint(): void;

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    ({ cw: this.cw, ch: this.ch } = this.cellsOf(width, height));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (!this.styledOnce) this.setStyle(this.palette, this.fontFamily);
    this.repaint();
  }

  /** The theme: the scene takes its day or its night by it, and its font. A change that leaves both
   *  as they were changes nothing. */
  setLook(look: WallpaperLook) {
    const palette = this.palettes[look.dark ? "dark" : "light"];
    const family = this.familyOf(look.mono);
    if (palette === this.palette && family === this.fontFamily && this.styledOnce) return;
    this.light = !look.dark;
    this.setStyle(palette, family);
    if (this.cols) this.repaint();
  }

  private setStyle(palette: P, family: string) {
    this.styledOnce = true;
    this.palette = palette;
    this.fontFamily = family;
    this.styled();
  }

  /** The face the wallpaper brings, then the terminals' font (the person's: it may not be in this
   *  frame, or may not be a font list at all), then any monospace. */
  private familyOf(mono: string) {
    const ours = `"${SCENE_FACE}", monospace`;
    if (!mono.trim()) return ours;
    const family = `"${SCENE_FACE}", ${mono}, monospace`;
    // A list the canvas does not take leaves its font as it was.
    this.ctx.font = "10px serif";
    this.ctx.font = cellFont(12, family);
    return this.ctx.font === "10px serif" ? ours : family;
  }
}

/** A canvas kept offscreen at the window's size in device pixels: a layer painted when it changes
 *  and copied in each frame. */
export function layerOf(canvas: OffscreenCanvas, w: number, h: number): OffscreenCanvasRenderingContext2D | null {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return canvas.getContext("2d");
}
