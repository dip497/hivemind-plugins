/**
 * What every weather scene's drawing shares: its palettes (day on a light theme, night on a dark
 * one), the face its characters are drawn in, and three canvases the character pass (chars.ts)
 * draws from:
 *
 * - the ground: the scene's still picture, crisp, at the canvas's own size in device pixels,
 *   painted again only when what it shows changes (a new size or look, or the scene's own key: the
 *   snow lying deeper, a window lit);
 * - the light: what moves over the ground (the aurora, smoke), small and soft, each frame;
 * - the picture: the two together at two texels a cell across and four down, what the characters
 *   are chosen from (and anything the scene paints on it alone, `paintPicture`).
 *
 * The scene paints in CSS px; the transforms do the rest. Without WebGL2 the ground and the light
 * are shown as they are: the scene still looks like itself.
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
  protected ground = new OffscreenCanvas(1, 1);
  private groundSmall = new OffscreenCanvas(1, 1);
  private groundKey = "";
  private groundVersion = 0;
  protected lightLayer = new OffscreenCanvas(1, 1);
  protected pic = new OffscreenCanvas(1, 1);
  protected light = false;
  protected palette: P;
  protected width = 0;
  protected height = 0;
  protected dpr = 1;
  protected cw = 8;
  protected ch = 12;
  protected cols = 0;
  protected rows = 0;
  /** Counts each new size and each new look. */
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
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    for (const c of [this.pic, this.groundSmall, this.lightLayer]) {
      c.width = this.cols * 2;
      c.height = this.rows * 4;
    }
    this.ground.width = Math.round(width * dpr);
    this.ground.height = Math.round(height * dpr);
    if (this.pass) this.pass.size(width, height, dpr, this.cw, this.ch);
    else {
      this.canvas.width = this.ground.width;
      this.canvas.height = this.ground.height;
    }
    if (!this.styledOnce) this.restyle();
    this.version++;
    this.groundKey = "";
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
    this.groundKey = "";
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
    const g = this.pic.getContext("2d")!;
    g.font = "10px serif";
    g.font = cellFont(12, family);
    return g.font === "10px serif" ? ours : family;
  }

  /** The palette changed: work out the scene's styles. */
  protected abstract styled(): void;
  /** The window's size changed: lay out what depends on it. */
  protected laidOut() {}
  /** What the ground shows now, as a key: it is painted again when the key changes (a new size and
   *  look always do). */
  protected groundOf(_sim: S): string {
    return "";
  }
  /** Paint the ground of `sim`, crisp, in CSS px. */
  protected abstract paintGround(sim: S, g: Draw2D): void;
  /** Paint crisp detail onto the ground that the characters are not chosen from (a star a pixel
   *  wide is a point of light, not a character), after the picture's copy of it is taken. */
  protected paintDetail(_sim: S, _g: Draw2D) {}
  /** Paint what moves over the ground, small and soft, in CSS px, onto a clear layer. */
  protected paintLight(_sim: S, _g: Draw2D) {}
  /** Paint onto the picture alone, after the ground and the light: what the characters should
   *  draw more strongly than the light under them shows it (by day, a faint aurora in crisp dots). */
  protected paintPicture(_sim: S, _g: Draw2D) {}
  /** The light is added to the ground (by night) rather than laid over it (by day). */
  protected lightAdds() {
    return !this.light;
  }
  /** The scene's own characters for its small things, which `marks` names (1 the first). */
  protected extras(): string[] {
    return [];
  }
  /** Per cell, row by row, four bytes: the colour and which of the scene's own characters is
   *  there (0 none); or null. */
  protected marks(_sim: S): Uint8Array | null {
    return null;
  }
  /** How many rows of cells, from the top, are drawn in braille dots. */
  protected brailleRows(_sim: S) {
    return 0;
  }
  /** The scene's clock, for what shimmers. */
  protected timeOf(_sim: S) {
    return 0;
  }

  /** A 2D context on `c`, its transform from CSS px, cleared if `clear`. */
  protected context(c: OffscreenCanvas, clear: boolean) {
    const g = c.getContext("2d") as Draw2D;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "source-over";
    g.filter = "none";
    if (clear) g.clearRect(0, 0, c.width, c.height);
    g.setTransform(c.width / this.width, 0, 0, c.height / this.height, 0, 0);
    return g;
  }

  draw(sim: S) {
    if (!this.cols) return;
    const key = `${this.version}|${this.groundOf(sim)}`;
    if (key !== this.groundKey) {
      this.groundKey = key;
      this.paintGround(sim, this.context(this.ground, true));
      const small = this.context(this.groundSmall, true);
      small.setTransform(1, 0, 0, 1, 0, 0);
      small.imageSmoothingEnabled = true;
      small.imageSmoothingQuality = "medium";
      small.drawImage(this.ground, 0, 0, this.groundSmall.width, this.groundSmall.height);
      this.paintDetail(sim, this.context(this.ground, false));
      this.groundVersion++;
    }
    this.paintLight(sim, this.context(this.lightLayer, true));
    const pg = this.context(this.pic, false);
    pg.setTransform(1, 0, 0, 1, 0, 0);
    pg.drawImage(this.groundSmall, 0, 0);
    pg.globalCompositeOperation = this.lightAdds() ? "lighter" : "source-over";
    pg.drawImage(this.lightLayer, 0, 0);
    pg.globalCompositeOperation = "source-over";
    this.paintPicture(sim, this.context(this.pic, false));
    if (this.pass) {
      this.pass.draw(this.pic, this.palette.chars, {
        ground: this.ground, groundVersion: this.groundVersion, light: this.lightLayer, add: this.lightAdds(),
        braille: this.brailleRows(sim), time: this.timeOf(sim), marks: this.marks(sim),
      });
    } else if (this.flat) {
      this.flat.drawImage(this.ground, 0, 0);
      this.flat.globalCompositeOperation = this.lightAdds() ? "lighter" : "source-over";
      this.flat.imageSmoothingEnabled = true;
      this.flat.drawImage(this.lightLayer, 0, 0, this.canvas.width, this.canvas.height);
      this.flat.globalCompositeOperation = "source-over";
    }
  }
}
