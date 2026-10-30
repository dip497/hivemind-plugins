/**
 * Dunes' land, as numbers: ranges of dunes one behind another from the horizon to the bottom of
 * the window, the far ones low and many, the near ones big and few. Each dune is a peak with a long
 * windward face rising to it from the left and a short, steep slip face falling away to the right;
 * the ridge running down from its peak divides the face the light falls on from the face in
 * shadow (renderer: by day the sun is on the left, at night the moon on the right). Each cell knows
 * which range it shows (the nearest one there), so a nearer dune hides what walks behind it.
 *
 * Every place and size is a share of the window, from a fixed seed: a window shows the same dunes
 * each time, and a resized one the same dunes fitted to it.
 */
import type { Grid } from "../grid";
import { clamp, seeded } from "../num";

/** How far down the window the horizon is. */
export const HORIZON = 0.5;

/** A dune's peak: where (a share of the width), how high over its range's foot (a share of the
 *  height), and how far its windward face runs to the left and its slip face to the right (shares
 *  of the width). */
export interface Peak { x: number; h: number; left: number; right: number }
/** A range of dunes: where its foot is (a share of the height), its peaks, and how far off it is
 *  (1 the furthest, 0 the nearest). */
export interface Range { foot: number; peaks: Peak[]; far: number }

export interface DesertLayout {
  grid: Grid;
  /** The horizon's row. */
  horizon: number;
  /** Back to front. */
  ranges: Range[];
  /** Per range, per column: the row its crest is in (fractional). */
  crests: Float32Array[];
  /** Per cell, the nearest range that shows there; -1 for sky. */
  owner: Int8Array;
  /** Per column, the first row of sand. */
  skyline: Int16Array;
  /** The crest cells the wind lifts sand off: the peaks of the nearer ranges, as cell indices. */
  blowing: Int32Array;
  /** Which range the caravan walks along. */
  route: number;
}

/** The ranges' feet, how high their dunes stand and how wide, far to near (shares). */
const RANGES = [
  { foot: 0.55, h: [0.015, 0.06], w: [0.06, 0.16] },
  { foot: 0.62, h: [0.03, 0.1], w: [0.1, 0.24] },
  { foot: 0.72, h: [0.05, 0.15], w: [0.14, 0.32] },
  { foot: 0.86, h: [0.08, 0.22], w: [0.2, 0.42] },
  { foot: 1.08, h: [0.16, 0.34], w: [0.3, 0.6] },
];

/** How high a dune stands over its range's foot at `x` (shares). */
function bump(p: Peak, x: number) {
  if (x <= p.x) {
    const u = (p.x - x) / p.left;
    return u < 1 ? p.h * (1 - u * u) : 0;
  }
  const u = (x - p.x) / p.right;
  return u < 1 ? p.h * (1 - u ** 1.35) : 0;
}

/** The dune of `range` standing highest at `x`, and how high the sand is there (shares): the dunes
 *  run into each other in rounded saddles, not notches. */
export function duneAt(range: Range, x: number) {
  let best = range.peaks[0]!;
  let top = 0;
  let sum = 0;
  for (const p of range.peaks) {
    const b = bump(p, x);
    if (b > top) {
      top = b;
      best = p;
    }
    sum += Math.exp(b * 60);
  }
  return { peak: best, h: Math.max(top, Math.log(sum / 1.6) / 60) };
}

export function desertOf(grid: Grid, seed: number): DesertLayout {
  const { cols, rows } = grid;
  const rnd = seeded(seed);
  const ranges: Range[] = RANGES.map((spec, k) => {
    const peaks: Peak[] = [];
    for (let x = -0.15 + rnd() * 0.1; x < 1.2; ) {
      const [w0, w1] = spec.w as [number, number];
      const [h0, h1] = spec.h as [number, number];
      const w = w0 + (w1 - w0) * rnd();
      const p = { x: x + w * 0.7, h: h0 + (h1 - h0) * rnd(), left: w * 0.72, right: w * (0.3 + 0.12 * rnd()) };
      peaks.push(p);
      x = p.x + p.right * (0.5 + 0.4 * rnd());
    }
    return { foot: spec.foot, peaks, far: 1 - k / (RANGES.length - 1) };
  });
  const crests = ranges.map((range) => {
    const out = new Float32Array(cols);
    for (let c = 0; c < cols; c++) out[c] = (range.foot - duneAt(range, (c + 0.5) / cols).h - 0.012) * rows;
    return out;
  });
  const owner = new Int8Array(cols * rows).fill(-1);
  const skyline = new Int16Array(cols).fill(rows);
  for (let k = 0; k < ranges.length; k++) {
    for (let c = 0; c < cols; c++) {
      const top = Math.max(0, Math.round(crests[k]![c]!));
      for (let r = top; r < rows; r++) owner[r * cols + c] = k;
      skyline[c] = Math.min(skyline[c]!, top);
    }
  }
  // The sand blows off the peaks of the nearer ranges, where they show.
  const blowing: number[] = [];
  for (let k = 1; k < ranges.length; k++) {
    for (const p of ranges[k]!.peaks) {
      for (let dx = -2; dx <= 3; dx++) {
        const c = Math.round(p.x * cols) + dx;
        if (c < 0 || c >= cols) continue;
        const r = clamp(Math.round(crests[k]![c]!), 0, rows - 1);
        if (owner[r * cols + c] === k) blowing.push(r * cols + c);
      }
    }
  }
  return { grid, horizon: Math.round(HORIZON * rows), ranges, crests, owner, skyline, blowing: Int32Array.from(blowing), route: 2 };
}

/** Where range `k`'s crest is `x` px across the window: on screen (px), and which range it is. */
export function crestAt(layout: Pick<DesertLayout, "crests" | "grid">, k: number, x: number) {
  const { cols, cw, ch } = layout.grid;
  const c = clamp(Math.floor(x / cw), 0, cols - 1);
  return { x, y: layout.crests[k]![c]! * ch, z: k };
}
