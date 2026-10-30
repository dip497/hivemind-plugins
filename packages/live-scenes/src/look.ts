/**
 * The look every scene draws in: its own colours, its light palette on a light theme and its dark
 * one on a dark theme, and its characters in the face the wallpaper brings (page.ts), else the
 * terminals' font, else any monospace. What the palette gives every scene is its water
 * (backdrop.ts); the scene works out whatever else it takes from it (`styled`), once per look, so a
 * frame builds no colour strings.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { paintWater, Shafts, waterOf, type Water, type WaterLook } from "./backdrop";
import { CellRenderer, cellFont } from "./cells";
import { RAMP } from "./colour";
import { clamp } from "./math";
import { SCENE_FACE } from "./page";

export abstract class LookRenderer<P extends WaterLook> extends CellRenderer {
  /** The theme is light: the scene draws its light palette. */
  protected light = false;
  /** The palette the scene is drawn in now. */
  protected palette: P;
  private water: Water;
  private shafts = new Shafts();
  private styledOnce = false;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, private palettes: { dark: P; light: P }) {
    super(canvas);
    this.palette = palettes.dark;
    this.water = waterOf(this.palette);
    this.shafts.setLook(this.water.shafts);
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
    this.fontFamily = family;
    this.water = waterOf(palette);
    this.shafts.setLook(this.water.shafts);
    this.styled();
    if (this.cols) this.repaintBackground();
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

  /** The palette changed (`light`, `palette`), or the font: the scene works out its styles, and
   *  paints again what it keeps painted. */
  protected abstract styled(): void;

  /** The step `t` (0 … 1) of a ramp. */
  protected tone(t: number, ramp: readonly string[]) {
    return ramp[clamp(Math.round(t * RAMP), 0, RAMP)]!;
  }

  resize(width: number, height: number, dpr: number) {
    super.resize(width, height, dpr);
    this.shafts.resize(width, height);
  }

  protected paintBackground() {
    const g = this.bg.getContext("2d");
    if (!g) return;
    paintWater(g, this.width, this.height, this.cw, this.ch, this.dpr, this.water);
  }

  /** What a frame starts from at time `t`: the backdrop, with the light shafts over it. */
  protected backdrop(t: number): OffscreenCanvas {
    return this.shafts.backdrop(this.bg, this.bgVersion, t, this.dpr);
  }
}
