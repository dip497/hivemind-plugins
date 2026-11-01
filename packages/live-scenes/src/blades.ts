/**
 * Plants that sway: a blade of grass, a reed, a strand of seagrass or kelp, rooted in a cell and
 * rising up the grid, swaying from its root, its tip the most, each out of step with the next. The
 * cells near its root never move, so a scene draws them once, into the layer where what holds
 * still is kept (`still`), and only the cells above them each frame.
 */

export interface Blade {
  /** Its root's cell, and how many cells it rises. */
  c: number;
  foot: number;
  height: number;
  /** How far its tip sways, in cells; how fast (rad/s); how far behind its root a cell is, per
   *  cell up, in the wave that runs up it; and where in its sway it starts. */
  reach: number;
  rate: number;
  wave: number;
  phase: number;
  /** How far over its tip leans when still, in cells (a clump of reeds fans out). */
  slant?: number;
}

/** How a sway or a lean grows from the root to the tip. */
const BEND = 1.3;

/** How many cells over from its root the blade's `k`th cell up is at time `t`: its lean, a wave up
 *  it, and a slow lean that comes and goes, both growing toward its tip. */
export function sway(b: Blade, k: number, t: number) {
  const up = Math.pow(k / b.height, BEND);
  return Math.round((b.slant ?? 0) * up) + Math.round(b.reach * up * (0.72 * Math.sin(t * b.rate + b.phase - k * b.wave) + 0.28 * Math.sin(t * b.rate * 0.33 + b.phase * 2)));
}

/** How many of its cells, from the root, never sway: drawn once, with what holds still, where
 *  `sway` has them at any time. */
export function still(b: Blade) {
  if (b.reach < 0.5) return b.height;
  return Math.min(b.height, Math.ceil(b.height * Math.pow(0.5 / b.reach, 1 / BEND)));
}

/** A blade's character where it is `lean` cells over from the cell below it: a slash leaning, the
 *  `upright` character standing up. */
export const leanGlyph = (lean: number, upright = "|") => (lean < 0 ? "\\" : lean > 0 ? "/" : upright);

/** How far over from its root, in cells and fractions of one, the point `k` cells up the blade is
 *  at time `t`: `sway` before it is rounded to the cells, for a blade drawn as a line. */
export function bend(b: Blade, k: number, t: number) {
  const up = Math.pow(k / b.height, BEND);
  return (b.slant ?? 0) * up + b.reach * up * (0.72 * Math.sin(t * b.rate + b.phase - k * b.wave) + 0.28 * Math.sin(t * b.rate * 0.33 + b.phase * 2));
}

/** A blade into `path`, drawn as a line: a ribbon up through each of its cells where the wind or
 *  the current has it at `t` (`bend`), `root` wide at its foot and `tip` at its top, `up` of its
 *  height (a cattail's stalk stops at its head). */
export function ribbon(path: Path2D, w: Blade, t: number, cw: number, ch: number, root: number, tip: number, up = 1) {
  const n = Math.max(1, Math.round(w.height * up));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let k = 0; k <= n; k++) {
    xs.push((w.c + 0.5 + bend(w, k, t)) * cw);
    ys.push((w.foot + 1 - k) * ch);
  }
  const side = (k: number, s: number) => {
    const a = Math.max(0, k - 1);
    const b = Math.min(n, k + 1);
    const dx = xs[b]! - xs[a]!;
    const dy = ys[b]! - ys[a]!;
    const len = Math.hypot(dx, dy) || 1;
    const half = (root + (tip - root) * Math.pow(k / w.height, 0.8)) / 2;
    return [xs[k]! + (-dy / len) * half * s, ys[k]! + (dx / len) * half * s] as const;
  };
  const [x0, y0] = side(0, 1);
  path.moveTo(x0, y0);
  for (let k = 1; k <= n; k++) path.lineTo(...side(k, 1));
  for (let k = n; k >= 0; k--) path.lineTo(...side(k, -1));
  path.closePath();
}
