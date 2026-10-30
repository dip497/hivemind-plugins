/**
 * The renderer every Wilds scene draws with. Each frame the scene paints its picture, one pixel a
 * cell (`paint`), in its own colours: its daytime (or dusk) palette on a light theme, its night one
 * on a dark theme, never the theme's own; the picture is drawn through characters (ascii.ts); and
 * what is small and quick (a falling leaf, a spark, a grain of sand, a star) is drawn over it as a
 * character of its own (`overlay`). Its characters are in the face the wallpaper brings (page.ts),
 * else the terminals' font, else any monospace.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { AsciiPass } from "./ascii";
import { textCells, type Draw2D } from "./cells";
import { cellFont, gridOf } from "./grid";
import { SCENE_FACE } from "./page";
import type { SkyLook } from "./sky";

export abstract class PictureRenderer<P extends SkyLook, S> {
  protected ctx: Draw2D;
  protected ascii = new AsciiPass();
  /** The theme is light: the scene draws its daytime palette. */
  protected light = false;
  protected palette: P;
  protected dpr = 1;
  protected width = 0;
  protected height = 0;
  protected cw = 8;
  protected ch = 12;
  protected cols = 0;
  protected rows = 0;
  protected fontFamily = "monospace";
  /** Counts the looks and windows the scene has been styled for: what it keeps painted, it paints
   *  again when this changes. */
  protected version = 0;
  private styledOnce = false;

  constructor(protected canvas: HTMLCanvasElement | OffscreenCanvas, private palettes: { dark: P; light: P }, private dim = 0.42, private bloom = 0) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Draw2D | null;
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.palette = palettes.dark;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    ({ cw: this.cw, ch: this.ch, cols: this.cols, rows: this.rows } = gridOf(width, height));
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.ascii.resize(this.cols, this.rows, this.cw, this.ch, dpr);
    this.ascii.setFont(this.fontFamily);
    this.version++;
  }

  /** The theme: the scene takes its light or dark palette by it, and its font. A change that leaves
   *  both as they were changes nothing. */
  setLook(look: WallpaperLook) {
    const palette = this.palettes[look.dark ? "dark" : "light"];
    const family = this.familyOf(look.mono);
    if (palette === this.palette && family === this.fontFamily && this.styledOnce) return;
    this.styledOnce = true;
    this.light = !look.dark;
    this.palette = palette;
    if (family !== this.fontFamily) {
      this.fontFamily = family;
      this.ascii.setFont(family);
    }
    this.ascii.invalidate();
    this.version++;
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

  /** The palette changed (`light`, `palette`): the scene works out its styles. */
  protected abstract styled(): void;
  /** The scene's picture now, into `g`, one pixel a cell. */
  protected abstract paint(g: Draw2D, sim: S): void;
  /** What is drawn over the picture as characters of its own, into `g` (its transform at the pixel
   *  ratio, set up for cells' characters); with `g` null, only where (`this.ascii.hold` each cell it
   *  will take), so the picture's characters keep clear of them. */
  protected abstract overlay(g: Draw2D | null, sim: S): void;

  draw(sim: S) {
    if (!this.cols || !this.styledOnce) return;
    const pg = this.ascii.pg;
    pg.setTransform(1, 0, 0, 1, 0, 0);
    pg.globalAlpha = 1;
    pg.globalCompositeOperation = "source-over";
    this.paint(pg, sim);
    this.overlay(null, sim);
    this.ascii.render(this.ctx, { dark: !this.light, dim: this.dim, bloom: this.light ? 0 : this.bloom });
    const g = this.ctx;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    textCells(g, this.ch, this.fontFamily);
    this.overlay(g, sim);
  }

  /** A character in cell (c, r), in the current fill style. */
  protected glyph(g: Draw2D, glyph: string, c: number, r: number) {
    g.fillText(glyph, c * this.cw + this.cw / 2, r * this.ch + this.ch / 2 + 1);
  }

  /** A character at the cell under a point (px). */
  protected glyphAt(g: Draw2D, glyph: string, x: number, y: number) {
    g.fillText(glyph, Math.floor(x / this.cw) * this.cw + this.cw / 2, Math.floor(y / this.ch) * this.ch + this.ch / 2 + 1);
  }
}
