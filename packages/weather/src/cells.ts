/**
 * The grid of character cells every weather scene is drawn in: the cells' size, and the font their
 * characters are drawn in. The simulations size what they hold by it too.
 */
import { clamp } from "./util";

/** A 2D context to draw in: the page's canvas, or a layer kept offscreen. */
export type Draw2D = Omit<OffscreenCanvasRenderingContext2D, "canvas">;

/** The cell a window of `width` by `height` is drawn in: from the shorter side, so a house or a
 *  drop is the same number of cells on any shape of window. Taller than wide, as a terminal's
 *  cells are. The simulations size what they hold by it too. */
export function cellSize(width: number, height: number) {
  const cw = clamp(Math.round(Math.min(width, height) / 110), 7, 13);
  return { cw, ch: Math.round(cw * 1.45) };
}

/** The font every cell's character is drawn in, at the grid's size: semibold, as thin weights
 *  vanish at these sizes. */
export const cellFont = (ch: number, family: string) => `600 ${Math.round(ch * 0.74)}px ${family}`;
