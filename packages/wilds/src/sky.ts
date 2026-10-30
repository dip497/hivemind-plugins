/**
 * The sky every Wilds scene stands under, as its palette sets it: a gradient from the top of the
 * window to the bottom and a soft glow where the light is (a low sun, the moon, the last of the
 * day), painted into a scene's picture.
 */
import type { Draw2D } from "./cells";
import { css, cssAlpha, rgbOf, type Oklch } from "./colour";

/** A scene's sky, in OKLCH. */
export interface SkyLook {
  /** Top to bottom of the window, evenly spaced. */
  sky: Oklch[];
  /** Where the light is: its colour and strength at its middle, where (shares of the width and
   *  height) and how far it reaches (a share of the longer side); null for none. */
  glow: { colour: Oklch; alpha: number; x: number; y: number; reach: number } | null;
}

/** The sky into `g`, a picture `cols` by `rows` cells (its transform makes one unit a cell). */
export function paintSky(g: Draw2D, cols: number, rows: number, look: SkyLook, aspect: number) {
  g.globalAlpha = 1;
  g.globalCompositeOperation = "source-over";
  const grad = g.createLinearGradient(0, 0, 0, rows);
  look.sky.forEach((c, i) => grad.addColorStop(i / Math.max(1, look.sky.length - 1), css(rgbOf(c))));
  g.fillStyle = grad;
  g.fillRect(0, 0, cols, rows);
  if (look.glow) {
    const { colour, alpha, x, y, reach } = look.glow;
    const rgb = rgbOf(colour);
    // Round on the screen, though a cell is taller than wide.
    g.save();
    g.translate(cols * x, rows * y);
    g.scale(1, 1 / aspect);
    const r = Math.max(cols, rows * aspect) * reach;
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, r);
    glow.addColorStop(0, cssAlpha(rgb, alpha));
    glow.addColorStop(0.35, cssAlpha(rgb, alpha * 0.45));
    glow.addColorStop(1, cssAlpha(rgb, 0));
    g.fillStyle = glow;
    g.fillRect(-r, -r, r * 2, r * 2);
    g.restore();
  }
}
