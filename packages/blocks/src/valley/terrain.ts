/**
 * Block Valley's land: a square of block columns, a green valley ringed by separate snowy peaks
 * with foothills between them. A river comes down through the gap between the two tallest peaks,
 * winds across the valley floor into a lake in the middle and out again through a gap in the ring.
 * A village of block houses stands on the lake's far shore, lanterns by their doors; trees grow on
 * the valley floor, pines up the slopes. Laid out once, the same every time.
 */
import { clamp, fractal, hash2, noise2 } from "../rng";

/** What a block is: also the index of its colours in the palette. */
export const Mat = { Grass: 0, Dirt: 1, Stone: 2, Sand: 3, Snow: 4, Water: 5, Wood: 6, Leaves: 7, Pine: 8, Cloud: 9, Bird: 10, Plank: 11, Roof: 12, Window: 13, Soil: 14, Crop: 15 } as const;
export type Mat = (typeof Mat)[keyof typeof Mat];
export const MATS = 16;

/** The land is SIZE by SIZE columns. */
export const SIZE = 96;
/** The lake's and the river's surface. */
export const WATER = 5;
const SNOW = 17;
const C = SIZE / 2;

export interface House { i: number; j: number; w: number; d: number; floor: number }
/** A fenced field of crops in rows, its ground level. */
export interface Field { i: number; j: number; w: number; d: number; floor: number; rowsAlongX: boolean }

export interface Land {
  /** Each column's height: its top block's top. */
  height: Int16Array;
  /** Each column's top block. */
  top: Uint8Array;
  /** The water's surface over a column (its height), or 0 for none. */
  water: Int16Array;
  /** Trees: where, how tall the trunk, and whether a pine. */
  trees: { i: number; j: number; trunk: number; pine: boolean }[];
  houses: House[];
  lanterns: { i: number; j: number; y: number }[];
  fields: Field[];
  /** Low bushes on the camera's side, where a tree would loom. */
  bushes: { i: number; j: number }[];
}

export const idx = (i: number, j: number) => j * SIZE + i;
export const inLand = (i: number, j: number) => i >= 0 && j >= 0 && i < SIZE && j < SIZE;

/** How far a column is inside the lake (above 0 inside it). */
export function lakeDepth(i: number, j: number) {
  const dx = (i + 0.5 - (C + 1)) / 10.5;
  const dz = (j + 0.5 - (C - 1)) / 7.5;
  return 1 - Math.hypot(dx, dz) + (noise2(i / 3, j / 3, 55) - 0.5) * 0.3;
}

/** The river's course: down from the gap between the tallest peaks, winding to the lake, and from
 *  the lake out through the ring. Points of the plane, in order. */
const point = (a: number, r: number) => ({ x: C + Math.cos(a) * r * C, z: C + Math.sin(a) * r * C });
const IN = [point(-0.6, 1.05), point(-0.66, 0.82), point(-0.5, 0.64), point(-0.42, 0.5), point(-0.75, 0.33), point(-0.45, 0.16), { x: C + 1, z: C - 1 }];
const OUT = [{ x: C + 1, z: C - 1 }, point(2.5, 0.3), point(2.2, 0.55), point(2.55, 0.78), point(2.4, 1.05)];
/** Where the river comes into the valley, and the side of the valley the camera keeps to, facing
 *  it across the lake. */
export const SOURCE = point(-0.66, 0.68);
export const VIEW_SIDE = -0.66 + Math.PI;

/** How far a point is from a course. */
function distance(course: { x: number; z: number }[], x: number, z: number) {
  let best = Infinity;
  for (let k = 0; k < course.length - 1; k++) {
    const a = course[k]!;
    const b = course[k + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** The peaks round the valley: where each stands, how high, and how wide its foot. The tallest
 *  stand either side of the waterfall, where the camera looks; lower ones round the rest. */
const PEAKS = [-0.45, 0.45, -0.95, 0.95, -1.5, 1.5, -2.2, 2.2, Math.PI].map((off, k) => {
  const near = Math.abs(off) < 1;
  return { ...point(-0.66 + off + (hash2(k, 1, 3) - 0.5) * 0.15, 0.82 + hash2(k, 2, 3) * 0.12), h: (near ? 28 : 21) + hash2(k, 3, 3) * 6, r: (near ? 11 : 9) + hash2(k, 4, 3) * 4 };
});

export function makeLand(): Land {
  const N = SIZE * SIZE;
  const height = new Int16Array(N);
  const top = new Uint8Array(N);
  const water = new Int16Array(N);
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const x = i + 0.5;
      const z = j + 0.5;
      const r = Math.hypot(x - C, z - C) / C;
      const river = Math.min(distance(IN, x, z), distance(OUT, x, z));
      // The valley floor: low rolling hills, rising into foothills toward the ring.
      const floor = 5.5 + fractal(i / 14, j / 14, 3, 5) * 5 + clamp((r - 0.55) / 0.4, 0, 1) ** 2 * 9;
      // Each peak a cone with a rough face; near the river they ease down into a V where it runs
      // between them, rather than stopping in a wall.
      let peak = 0;
      for (const p of PEAKS) {
        const d = Math.hypot(x - p.x, z - p.z) / p.r;
        if (d < 1) peak = Math.max(peak, 6 + (p.h - 6) * (1 - d) ** 1.25 + (noise2(i / 4, j / 4, 17) - 0.5) * 3);
      }
      const open = clamp((river - 2.5) / 11, 0, 1);
      let h = floor + Math.max(0, peak - floor) * open * open * (3 - 2 * open);
      const k = idx(i, j);
      const lake = lakeDepth(i, j);
      if (lake > 0 || river < 2.4) {
        height[k] = WATER - 1 - (lake > 0.35 || river < 1.2 ? 1 : 0);
        water[k] = WATER;
      } else {
        // Banks easing down to the water.
        const bank = Math.min(lake > -0.5 ? -lake * 10 : 99, river - 2.4);
        // The banks rise gently all the way up to the hills: no cliff where they meet.
        if (bank < 16) h = Math.min(h, WATER + 0.6 + bank * 0.85);
        height[k] = Math.max(1, Math.round(h));
      }
    }
  }
  // What each column's top is: sand by the water, rock on steep and high ground, snow on peaks.
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const k = idx(i, j);
      const h = height[k]!;
      let steep = 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (inLand(i + a, j + b)) steep = Math.max(steep, Math.abs(height[idx(i + a, j + b)]! - h));
      const nearWater = [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2], [-2, 0], [0, -2]].some(([a, b]) => inLand(i + a!, j + b!) && water[idx(i + a!, j + b!)]! > 0);
      if (water[k]) top[k] = Mat.Sand;
      else if (h >= SNOW + Math.round(noise2(i / 3, j / 3, 13) * 4)) top[k] = Mat.Snow;
      else if (steep >= 3 || h > 17 + hash2(i, j, 3) * 3) top[k] = Mat.Stone;
      else if (nearWater && h <= WATER + 2) top[k] = Mat.Sand;
      else top[k] = Mat.Grass;
    }
  }
  const land: Land = { height, top, water, trees: [], houses: [], lanterns: [], fields: [], bushes: [] };
  village(land);
  farms(land);
  // Trees: broad ones in the valley, pines up the slopes; clumped, kept off the water, the village
  // and the camera's round (nothing big right under the lens).
  for (let j = 2; j < SIZE - 2; j++) {
    for (let i = 2; i < SIZE - 2; i++) {
      const k = idx(i, j);
      if (top[k] !== Mat.Grass) continue;
      const h = height[k]!;
      // Not on the camera's side of the valley, where a tree would loom at the lens.
      const r = Math.hypot(i + 0.5 - C, j + 0.5 - C);
      const side = Math.cos(Math.atan2(j + 0.5 - C, i + 0.5 - C) - VIEW_SIDE);
      if (r > 9 && side > 0.1) {
        const clear = !water[k] && !land.fields.some((o) => i >= o.i - 1 && i <= o.i + o.w && j >= o.j - 1 && j <= o.j + o.d) && !land.bushes.some((b) => Math.abs(b.i - i) + Math.abs(b.j - j) < 3);
        if (r < 27 && clear && hash2(i, j, 47) < 0.05 && lakeDepth(i, j) < -0.35) land.bushes.push({ i, j });
        continue;
      }
      const wood = fractal(i / 9, j / 9, 2, 31);
      if (hash2(i, j, 41) > (wood > 0.6 ? 0.08 : 0.008)) continue;
      if (land.trees.some((t) => Math.abs(t.i - i) < 3 && Math.abs(t.j - j) < 3)) continue;
      if ([...land.houses, ...land.fields].some((o) => i >= o.i - 2 && i < o.i + o.w + 2 && j >= o.j - 2 && j < o.j + o.d + 2)) continue;
      let flat = true;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (Math.abs(height[idx(i + a, j + b)]! - h) > 1 || water[idx(i + a, j + b)]) flat = false;
      if (!flat || lakeDepth(i, j) > -0.35) continue;
      land.trees.push({ i, j, trunk: 3 + Math.floor(hash2(i, j, 43) * 2), pine: h > 10 });
    }
  }
  return land;
}

/** Fields on the camera's side of the valley, between it and the lake: low, so nothing looms at
 *  the lens, and the foreground is not bare. */
function farms(land: Land) {
  const { height, top, water } = land;
  for (const [da, r] of [[-0.5, 15], [0.5, 15], [-0.42, 21], [0.42, 21], [-0.75, 18], [0.75, 18]] as const) {
    const a = VIEW_SIDE + da;
    const w = 6;
    const d = 5;
    const i0 = Math.round(C + Math.cos(a) * r - w / 2);
    const j0 = Math.round(C + Math.sin(a) * r - d / 2);
    let ok = true;
    let floor = 0;
    let low = 99;
    for (let b = -1; b <= d; b++) for (let c = -1; c <= w; c++) {
      const i = i0 + c;
      const j = j0 + b;
      if (!inLand(i, j) || water[idx(i, j)] || lakeDepth(i, j) > -0.4) ok = false;
      else { floor = Math.max(floor, height[idx(i, j)]!); low = Math.min(low, height[idx(i, j)]!); }
    }
    if (!ok || floor - low > 3 || land.fields.some((f) => Math.abs(f.i - i0) < w + 2 && Math.abs(f.j - j0) < d + 2)) continue;
    for (let b = -1; b <= d; b++) for (let c = -1; c <= w; c++) {
      const q = idx(i0 + c, j0 + b);
      height[q] = floor;
      top[q] = c < 0 || b < 0 || c >= w || b >= d ? Mat.Grass : Mat.Soil;
    }
    land.fields.push({ i: i0, j: j0, w, d, floor, rowsAlongX: Math.abs(Math.cos(a)) > 0.7 });
  }
}

/** The village: houses on the lake's shore, lanterns by them toward the water. */
function village(land: Land) {
  const { height, top, water } = land;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    // Out from the lake's middle to just past its shore.
    let spot: { i: number; j: number } | null = null;
    for (let r = 6; r < 20 && !spot; r += 0.5) {
      const i = Math.round(C + 1 + Math.cos(a) * r * 1.35);
      const j = Math.round(C - 1 + Math.sin(a) * r);
      if (lakeDepth(i, j) < -0.8) spot = { i, j };
    }
    // None on the camera's side of the lake, where it would loom at the bottom of the view.
    if (!spot || Math.cos(a - VIEW_SIDE) > 0.2) continue;
    const w = 3;
    const d = 3;
    const i0 = spot.i - 1;
    const j0 = spot.j - 1;
    let ok = true;
    let floor = 0;
    for (let b = -1; b <= d; b++) for (let c = -1; c <= w; c++) {
      const i = i0 + c;
      const j = j0 + b;
      if (!inLand(i, j) || water[idx(i, j)] || lakeDepth(i, j) > -0.25) ok = false;
      else floor = Math.max(floor, height[idx(i, j)]!);
    }
    if (!ok || floor > WATER + 6 || land.houses.some((o) => Math.abs(o.i - i0) < 6 && Math.abs(o.j - j0) < 6)) continue;
    // Its ground made level, a yard of grass round it.
    for (let b = -1; b <= d; b++) for (let c = -1; c <= w; c++) {
      const q = idx(i0 + c, j0 + b);
      height[q] = floor;
      top[q] = Mat.Grass;
    }
    land.houses.push({ i: i0, j: j0, w, d, floor });
    // A lantern beside it, toward the water.
    const li = Math.round(i0 + 1 - Math.cos(a) * 2.6);
    const lj = Math.round(j0 + 1 - Math.sin(a) * 2.6);
    if (inLand(li, lj) && !water[idx(li, lj)] && !land.houses.some((o) => li >= o.i && li < o.i + o.w && lj >= o.j && lj < o.j + o.d)) land.lanterns.push({ i: li, j: lj, y: height[idx(li, lj)]! });
  }
}
