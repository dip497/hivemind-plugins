/**
 * The grid of character cells a Wilds scene lives on, as numbers alone: a scene's world (no canvas)
 * lays its trees, dunes and fire out on it, and its renderer draws on the same cells.
 */
import { clamp } from "./num";

/** The cell a window of `width` by `height` is drawn in: from the shorter side, so a tree or a
 *  camel is the same number of cells on any shape of window, but small (7 to 10 px wide) so the
 *  picture drawn through them keeps its detail; taller than wide, as a terminal's. */
export function cellSize(width: number, height: number) {
  const cw = clamp(Math.round(Math.min(width, height) / 110), 7, 10);
  return { cw, ch: Math.round(cw * 1.45) };
}

/** The grid a window of `width` by `height` holds: its cells' size and how many across and down. */
export function gridOf(width: number, height: number) {
  const { cw, ch } = cellSize(width, height);
  return { cw, ch, cols: Math.max(1, Math.ceil(width / cw)), rows: Math.max(1, Math.ceil(height / ch)) };
}
export type Grid = ReturnType<typeof gridOf>;

/** The font every cell's character is drawn in, at the grid's size: semibold, as thin weights
 *  vanish at these sizes. */
export const cellFont = (ch: number, family: string) => `600 ${Math.round(ch * 0.74)}px ${family}`;
