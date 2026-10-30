/**
 * The canvas every pattern draws on: sized to the viewport times its pixel ratio, in its own
 * palette (light or dark by the theme), its characters in the face the wallpaper brings, else the
 * terminals' font, else any monospace. A renderer extends it with what it draws.
 *
 * Life and Sand keep what they drew and paint again only the cells that changed; a new size, a new
 * look, or a context the browser lost and gave back leaves the canvas `stale`, and the next draw
 * paints all of it.
 */
import type { WallpaperLook } from "@hivemind/view-sdk";
import { css, mix, rgbOf, type Oklch, type Rgb } from "./colour";
import { FACE } from "./page";
import type { Drawer } from "./scene";

/** A 2D context to draw in: the page's canvas, or one kept offscreen. */
export type Draw2D = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/** Where `n` cells of `size` CSS pixels start, in device pixels, and where the last one ends:
 *  cell k spans [at[k], at[k + 1]). Rounded once, so cells meet with no seam and no overlap at any
 *  pixel ratio. */
export function edges(n: number, size: number, dpr: number): Int32Array<ArrayBuffer> {
  const at = new Int32Array(n + 1);
  for (let k = 0; k <= n; k++) at[k] = Math.round(k * size * dpr);
  return at;
}

/** The ground's colour on each of `rows` rows of `size` px, a window `height` px tall: the stops
 *  evenly spaced from top to bottom, mixed in OKLab. */
export function rowGround(stops: readonly Rgb[], rows: number, size: number, height: number): string[] {
  return Array.from({ length: rows }, (_, r) => {
    const t = Math.min(1, ((r + 0.5) * size) / Math.max(1, height)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    return css(mix(stops[k]!, stops[k + 1]!, t - k));
  });
}

/** `n` + 1 fill styles from `from` to `to`. */
export function steps(from: Oklch, to: Oklch, n: number): string[] {
  const [a, b] = [rgbOf(from), rgbOf(to)];
  return Array.from({ length: n + 1 }, (_, i) => css(mix(a, b, i / n)));
}

export abstract class PatternCanvas<S, P> implements Drawer<S> {
  protected ctx: Draw2D;
  protected width = 0;
  protected height = 0;
  protected dpr = 1;
  /** The theme is light: the pattern draws its light palette. */
  protected light = false;
  /** The palette it is drawn in now. */
  protected palette: P;
  protected family = `"${FACE}", monospace`;
  /** What is on the canvas is not what was last drawn: the next draw paints all of it. */
  protected stale = true;
  private looked = false;

  constructor(protected canvas: HTMLCanvasElement | OffscreenCanvas, private palettes: { dark: P; light: P }) {
    const ctx = canvas.getContext("2d", { alpha: false }) as Draw2D | null;
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.palette = palettes.dark;
    // A context the browser lost (a GPU reset) comes back blank.
    (canvas as EventTarget).addEventListener("contextrestored", () => { this.stale = true; });
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    // Clears it, and its transform.
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.stale = true;
    this.sized();
  }

  /** The theme: the pattern takes its light or dark palette by it, and its font. A change that
   *  leaves both as they were changes nothing. */
  setLook(look: WallpaperLook) {
    const palette = this.palettes[look.dark ? "dark" : "light"];
    const family = this.familyOf(look.mono);
    if (this.looked && palette === this.palette && family === this.family) return;
    this.looked = true;
    this.light = !look.dark;
    this.palette = palette;
    this.family = family;
    this.styled();
    this.stale = true;
  }

  /** The face the wallpaper brings, then the terminals' font (the person's: it may not be in this
   *  frame, or may not be a font list at all), then any monospace. */
  private familyOf(mono: string) {
    const ours = `"${FACE}", monospace`;
    if (!mono.trim()) return ours;
    const family = `"${FACE}", ${mono}, monospace`;
    // A list the canvas does not take leaves its font as it was.
    this.ctx.font = "10px serif";
    this.ctx.font = `600 12px ${family}`;
    return this.ctx.font === "10px serif" ? ours : family;
  }

  /** The palette or the font changed: work out the styles a frame picks from. */
  protected abstract styled(): void;
  /** The canvas has a new size. */
  protected sized(): void {}
  abstract draw(sim: S): void;
}
