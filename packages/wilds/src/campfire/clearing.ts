/**
 * Campfire's clearing, in cells: a treeline of firs round the back of it, taller at the edges and
 * low behind the fire so its smoke and sparks rise into open sky; the grass of the clearing; the
 * fire in the lower middle in a ring of stones, its logs leaned together over it; a woodpile beside
 * it; and where the crickets are in the grass. Every place and size is a share of the window, from
 * a fixed seed: a resized window shows the same clearing fitted to it.
 */
import type { Grid } from "../grid";
import { clamp, seeded } from "../num";

/** A fir: its tip, how many rows tall, how many cells its lowest boughs reach each way, how many
 *  tiers of boughs, and how near (0 the far treeline, 1 the big ones at the edges). */
export interface Fir { c: number; r: number; height: number; reach: number; tiers: number; near: number }
/** A stone of the ring: its leftmost cell, its row, how many cells wide, and whether it stands in
 *  front of the fire or behind it. */
export interface Stone { c: number; r: number; width: number; front: boolean }
/** A log: from one cell to another. */
export interface Log { c0: number; r0: number; c1: number; r1: number }

export interface ClearingLayout {
  grid: Grid;
  /** The first row of the clearing's grass. */
  ground: number;
  firs: Fir[];
  /** The fire: its middle column, the row its base is on, and its field's size in cells. */
  fire: { c: number; base: number; width: number; height: number };
  stones: Stone[];
  logs: Log[];
  /** The woodpile beside the ring: its logs' ends, each a cell. */
  pile: { c: number; r: number }[];
  /** Where the crickets sit, in cells. */
  crickets: { c: number; r: number }[];
  /** The crescent moon: its middle and radius in px. */
  moon: { x: number; y: number; r: number };
}

export function clearingOf(grid: Grid, seed: number): ClearingLayout {
  const { cols, rows, cw, ch } = grid;
  const rnd = seeded(seed);
  const ground = Math.round(rows * 0.65);
  // The fire: its size from the window's, its base in the lower middle.
  const fire = { c: Math.round(cols / 2), base: Math.round(rows * 0.85), width: Math.max(16, Math.round((cols * cw) / 54)), height: Math.max(10, Math.round(rows * 0.24)) };
  // The far treeline: firs side by side all along, lower behind the fire; big ones at each edge.
  const firs: Fir[] = [];
  for (let x = -0.01; x < 1.01; ) {
    const behind = Math.abs(x - 0.5) < 0.16 ? 0.55 : 1;
    const height = Math.round(rows * (0.12 + 0.12 * rnd()) * behind);
    firs.push({ c: Math.round(x * cols), r: ground + 1 - height, height, reach: height * (0.32 + 0.1 * rnd()), tiers: 3 + Math.floor(rnd() * 3), near: 0 });
    x += (0.012 + 0.02 * rnd()) * (cols * cw > 1600 ? 0.8 : 1);
  }
  for (const side of [0, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = side ? 1 - (0.02 + 0.07 * k + 0.02 * rnd()) : 0.02 + 0.07 * k + 0.02 * rnd();
      const height = Math.round(rows * (0.62 - 0.12 * k + 0.08 * rnd()));
      firs.push({ c: Math.round(x * cols), r: ground + 3 + k - height, height, reach: height * (0.3 + 0.06 * rnd()), tiers: 5 + Math.floor(rnd() * 3), near: 1 - k * 0.3 });
    }
  }
  // Furthest first, so the near ones are drawn over them.
  firs.sort((a, b) => a.near - b.near || a.r - b.r);

  // The ring of stones round the fire's base, wider than the fire.
  const stones: Stone[] = [];
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.13;
    const width = 2 + Math.floor(rnd() * 2);
    stones.push({ c: Math.round(fire.c + Math.cos(a) * fire.width * 0.58 - width / 2), r: Math.round(fire.base + Math.sin(a) * 1.6), width, front: Math.sin(a) > -0.1 });
  }
  // The logs leaned together over the fire, and two across its foot.
  const w = fire.width;
  const apex = fire.base - Math.round(fire.height * 0.32);
  const logs: Log[] = [
    { c0: fire.c - w * 0.36, r0: fire.base, c1: fire.c - 1, r1: apex },
    { c0: fire.c + w * 0.36, r0: fire.base, c1: fire.c + 1, r1: apex },
    { c0: fire.c - w * 0.2, r0: fire.base, c1: fire.c + 1, r1: apex + 1 },
    { c0: fire.c + w * 0.2, r0: fire.base, c1: fire.c - 1, r1: apex + 1 },
  ];
  // The woodpile: logs stacked end on, to the left of the ring.
  const pile: { c: number; r: number }[] = [];
  const pc = Math.round(fire.c - w * 0.58 - 9);
  for (const [dc, dr] of [[0, 0], [2, 0], [4, 0], [1, -1], [3, -1], [2, -2]]) pile.push({ c: pc + dc!, r: fire.base + 1 + dr! });
  // The crickets, in the grass, none near the fire.
  const crickets: { c: number; r: number }[] = [];
  const count = clamp(Math.round((cols * (rows - ground)) / 140), 14, 50);
  for (let k = 0; k < count * 4 && crickets.length < count; k++) {
    const c = Math.floor(rnd() * cols);
    const r = ground + 2 + Math.floor(rnd() * (rows - ground - 3));
    if (Math.abs(c - fire.c) < w * 1.1 && r > fire.base - 4) continue;
    crickets.push({ c, r });
  }
  const unit = Math.min(cols * cw, rows * ch);
  return { grid, ground, firs, fire, stones, logs, pile, crickets, moon: { x: cols * cw * 0.68, y: rows * ch * 0.15, r: unit * 0.065 } };
}

/** Fir `f`'s boughs at row `r`: how far either side of its middle they reach (cells, -1 for
 *  none), and how far down its tier of boughs the row is (0 its top, 1 the bough tips). */
export function firAt(f: Fir, r: number) {
  const t = (r - f.r) / f.height;
  if (t < 0 || t > 1) return { reach: -1, within: 0 };
  // Tiers of boughs, each widening down to its tips, the next starting narrower.
  const k = t * f.tiers;
  const tier = Math.floor(k);
  const within = k - tier;
  return { reach: f.reach * ((tier + 0.4 + 0.6 * within) / f.tiers) * (0.35 + 0.65 * t), within };
}
