/**
 * What every weather scene's drawing shares: its palettes (day on a light theme, night on a dark
 * one), the face its characters are drawn in, a picture it paints each frame into a small canvas
 * (two texels a cell across, four down; the scene paints in CSS px and the transform does the rest),
 * and the character pass (chars.ts) that turns the picture into characters on the page's canvas.
 * Without WebGL2 the picture itself is shown, smoothed: the scene still looks like itself.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { cellFont, cellSize, type Draw2D } from "./cells";
import { CharPass, type CharLook } from "./chars";
import { SCENE_FACE } from "./page";

export interface PictureLook {
  chars: CharLook;
}

export abstract class PictureRenderer<P extends PictureLook, S> {
  protected pass: CharPass | null = null;
  private flat: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;
  /** The picture: `pic`, and its context, in CSS px through its transform. */
  protected pic = new OffscreenCanvas(1, 1);
  protected pg: Draw2D;
  protected light = false;
  protected palette: P;
  protected width = 0;
  protected height = 0;
  protected dpr = 1;
  protected cw = 8;
  protected ch = 12;
  protected cols = 0;
  protected rows = 0;
  /** Counts each new size and each new look: what a scene keeps painted, it paints again. */
  protected version = 0;
  private family = "";
  private styledOnce = false;

  constructor(protected canvas: HTMLCanvasElement | OffscreenCanvas, private palettes: { dark: P; light: P }) {
    this.palette = palettes.dark;
    try {
      this.pass = new CharPass(canvas);
    } catch {
      this.flat = canvas.getContext("2d") as CanvasRenderingContext2D | null;
    }
    this.pg = this.pic.getContext("2d") as Draw2D;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.pic.width = this.cols * 2;
    this.pic.height = this.rows * 4;
    this.pg = this.pic.getContext("2d") as Draw2D;
    if (this.pass) this.pass.size(width, height, dpr, this.cw, this.ch);
    else {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    if (!this.styledOnce) this.restyle();
    this.version++;
    this.laidOut();
  }

  /** The theme: the scene takes its day or night palette by it, and its face. A change that leaves
   *  both as they were changes nothing. */
  setLook(look: WallpaperLook) {
    const palette = this.palettes[look.dark ? "dark" : "light"];
    const family = this.familyOf(look.mono);
    if (palette === this.palette && family === this.family && this.styledOnce) return;
    this.light = !look.dark;
    this.palette = palette;
    this.family = family;
    this.pass?.face(family, this.extras());
    this.restyle();
    this.version++;
  }

  private restyle() {
    this.styledOnce = true;
    this.styled();
  }

  /** The face the wallpaper brings, then the terminals' font (the person's: it may not be in this
   *  frame, or may not be a font list at all), then any monospace. */
  private familyOf(mono: string) {
    const ours = `"${SCENE_FACE}", monospace`;
    if (!mono.trim()) return ours;
    const family = `"${SCENE_FACE}", ${mono}, monospace`;
    const g = this.pg;
    g.font = "10px serif";
    g.font = cellFont(12, family);
    return g.font === "10px serif" ? ours : family;
  }

  /** The palette changed: work out the scene's styles. */
  protected abstract styled(): void;
  /** The window's size changed: lay out what depends on it. */
  protected laidOut() {}
  /** Paint the picture of `sim` as it is now, in CSS px. */
  protected abstract paint(sim: S, g: Draw2D): void;
  /** How many rows of cells, from the top, are drawn in braille dots. */
  protected brailleRows(_sim: S) {
    return 0;
  }
  /** The scene's own characters for its small things, which `marks` names (1 the first). */
  protected extras(): string[] {
    return [];
  }
  /** Per cell, row by row, which of the scene's own characters is there (0 none), or null. */
  protected marks(_sim: S): Uint8Array | null {
    return null;
  }
  /** The scene's clock, for what shimmers. */
  protected timeOf(_sim: S) {
    return 0;
  }

  draw(sim: S) {
    if (!this.cols) return;
    const g = this.pg;
    g.setTransform(this.pic.width / this.width, 0, 0, this.pic.height / this.height, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    this.paint(sim, g);
    if (this.pass) this.pass.draw(this.pic, this.palette.chars, this.brailleRows(sim), this.timeOf(sim), this.marks(sim));
    else if (this.flat) {
      this.flat.imageSmoothingEnabled = true;
      this.flat.drawImage(this.pic, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  /** A canvas the picture's size, kept: made again at a new size. */
  protected layer(c: OffscreenCanvas) {
    if (c.width !== this.pic.width || c.height !== this.pic.height) {
      c.width = this.pic.width;
      c.height = this.pic.height;
    }
    const g = c.getContext("2d") as Draw2D;
    g.setTransform(this.pic.width / this.width, 0, 0, this.pic.height / this.height, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    return g;
  }
}
