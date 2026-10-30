/**
 * The look every weather scene draws in: its own colours, its day palette on a light theme and its
 * night one on a dark theme, and its characters in the face the wallpaper brings (page.ts), else the
 * terminals' font, else any monospace. What every palette gives is its sky (the ground behind the
 * glass, for the rain): a gradient top to bottom, a soft light somewhere in it, and the faint cell
 * grid, painted once per size and look into the backdrop. A scene works out the rest of its styles
 * (`styled`) once per look, so a frame builds no colour strings.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { CellRenderer, cellFont, paintGrid, type Draw2D } from "./cells";
import { css, cssAlpha, rgbOf, type Oklch } from "./colour";
import { SCENE_FACE } from "./page";

/** A scene's sky as its palette sets it, in OKLCH. */
export interface SkyLook {
  /** Top to bottom, evenly spaced. */
  sky: Oklch[];
  /** A soft light in it (a moon behind cloud, the low sun, a town's glow): its middle as shares of
   *  the window, its reach as a share of the window's longer side, its strength at the middle. */
  glow: { colour: Oklch; alpha: number; x: number; y: number; r: number } | null;
  /** The cell grid's lines over it. */
  grid: { colour: Oklch; alpha: number };
}

export function paintSky(g: Draw2D, W: number, H: number, cw: number, ch: number, dpr: number, look: SkyLook) {
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  const grad = g.createLinearGradient(0, 0, 0, H);
  look.sky.forEach((c, i) => grad.addColorStop(i / Math.max(1, look.sky.length - 1), css(rgbOf(c))));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  if (look.glow) {
    const { colour, alpha, x, y, r } = look.glow;
    const R = Math.max(W, H) * r;
    const glow = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, R);
    glow.addColorStop(0, cssAlpha(rgbOf(colour), alpha));
    glow.addColorStop(0.45, cssAlpha(rgbOf(colour), alpha * 0.35));
    glow.addColorStop(1, cssAlpha(rgbOf(colour), 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
  }
  paintGrid(g, W, H, cw, ch, dpr, cssAlpha(rgbOf(look.grid.colour), look.grid.alpha));
}

export abstract class SkyRenderer<P extends SkyLook> extends CellRenderer {
  /** The theme is light: the scene draws its day palette. */
  protected light = false;
  /** The palette the scene is drawn in now. */
  protected palette: P;
  private styledOnce = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, private palettes: { dark: P; light: P }) {
    super(canvas);
    this.palette = palettes.dark;
  }

  /** The theme: the scene takes its day or night palette by it, and its font. A change that leaves
   *  both as they were changes nothing. */
  setLook(look: WallpaperLook) {
    const palette = this.palettes[look.dark ? "dark" : "light"];
    const family = this.familyOf(look.mono);
    if (palette === this.palette && family === this.fontFamily && this.styledOnce) return;
    this.light = !look.dark;
    this.palette = palette;
    this.fontFamily = family;
    this.restyle();
    if (this.cols) this.repaintBackground();
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
    // A list the canvas does not take leaves its font as it was.
    this.ctx.font = "10px serif";
    this.ctx.font = cellFont(12, family);
    return this.ctx.font === "10px serif" ? ours : family;
  }

  /** The palette changed (`light`, `palette`), or the font: the scene works out its styles. */
  protected abstract styled(): void;

  protected paintBackground() {
    // The window's size can come before the theme: the first styles are the night's.
    if (!this.styledOnce) this.restyle();
    const g = this.bg.getContext("2d");
    if (!g) return;
    paintSky(g, this.width, this.height, this.cw, this.ch, this.dpr, this.palette);
    this.paintScenery(g);
  }

  /** What else holds still behind everything, over the sky: drawn once per size and look. */
  protected paintScenery(_g: Draw2D) {}
}
