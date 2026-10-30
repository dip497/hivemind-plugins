/**
 * Snowfall's valley: the peaks far behind, forested hills nearer, and a village along the valley
 * floor, houses with steep roofs and pines between them, a row further back and a row in front. It
 * is chosen once (`villageOf`, from a seed of the first window's size: more houses on a wider one)
 * and laid out on the cell grid of any window (`layoutOf`), so a resize keeps the same village and
 * fits it to the new size: each thing at the same share of the width, as many cells big.
 *
 * Laid out, each house and pine owns its cells, back to front; the top of each column of a house's
 * roof or a pine's branches is a ledge snow can lie on, if nothing nearer stands over it.
 */
import { clamp, hash3, lerp, seeded } from "../util";

export interface HouseSpec {
  fx: number;
  /** Its walls' width and height, in cells; which side its chimney is on (0 none). */
  w: number;
  wall: number;
  chimney: -1 | 0 | 1;
  front: boolean;
}
export interface PineSpec {
  fx: number;
  h: number;
  front: boolean;
  /** Rows nearer than its row's line (a pine standing a little in front). */
  near: number;
}
export interface Peak {
  fx: number;
  /** Its top as a share of the window's height, and how many rows it falls per column. */
  top: number;
  slope: number;
}
export interface Village {
  houses: HouseSpec[];
  pines: PineSpec[];
  far: Peak[];
  hills: Peak[];
  seed: number;
}

/** The valley for a window `cols` by `rows` cells: the same for the same window. */
export function villageOf(cols: number, rows: number): Village {
  const seed = 0x5a0 + cols * 31 + rows;
  const rnd = seeded(seed);
  const rint = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const odd = (n: number) => (n % 2 ? n : n + 1);
  const nFar = 3 + Math.round(cols / 60);
  const far = Array.from({ length: nFar }, (_, k): Peak => ({ fx: (k + 0.2 + 0.6 * rnd()) / nFar, top: lerp(0.2, 0.36, rnd()), slope: lerp(0.42, 0.66, rnd()) }));
  const nHills = 4 + Math.round(cols / 45);
  const hills = Array.from({ length: nHills }, (_, k): Peak => ({ fx: (k + rnd()) / nHills, top: lerp(0.5, 0.6, rnd()), slope: lerp(0.18, 0.3, rnd()) }));
  const houses: HouseSpec[] = [];
  const taken: [number, number, boolean][] = [];
  const free = (a: number, b: number, front: boolean) => taken.every(([x, y, f]) => f !== front || b < x || a > y);
  for (const front of [false, true]) {
    const n = Math.max(3, Math.round(cols / (front ? 30 : 22)));
    for (let k = 0; k < n; k++) {
      const w = front ? odd(rint(9, 13)) : odd(rint(5, 7));
      for (let tries = 0; tries < 12; tries++) {
        const fx = (k + 0.15 + 0.7 * rnd()) / n;
        const half = (w + 3) / 2 / cols;
        if (fx - half < 0.02 || fx + half > 0.98 || !free(fx - half, fx + half, front)) continue;
        taken.push([fx - half, fx + half, front]);
        houses.push({ fx, w, wall: front ? rint(2, 3) : 2, chimney: rnd() < 0.85 ? (rnd() < 0.5 ? -1 : 1) : 0, front });
        break;
      }
    }
  }
  const pines: PineSpec[] = [];
  for (const front of [false, true]) {
    const n = Math.round(cols / (front ? 6 : 5));
    for (let k = 0; k < n; k++) {
      const h = front ? rint(7, 14) : rint(4, 7);
      // In clumps: some beside the last.
      const last = pines[pines.length - 1];
      const fx = last && last.front === front && rnd() < 0.45 ? clamp(last.fx + (rnd() - 0.5) * (8 / cols), 0, 1) : rnd();
      const half = (h / 6 + 1) / cols;
      if (!free(fx - half, fx + half, front)) continue;
      pines.push({ fx, h, front, near: front && rnd() < 0.3 ? rint(1, 3) : 0 });
    }
  }
  // Tall pines near the glass at both sides, framing the valley.
  for (const side of [0, 1]) {
    for (let k = rint(2, 3); k > 0; k--) pines.push({ fx: side ? 1 - rnd() * 0.07 : rnd() * 0.07, h: rint(14, 19), front: true, near: rint(3, 5) });
  }
  return { houses, pines, far, hills, seed };
}

/** A part of the scenery a cell belongs to. */
export enum Part { Wall = 1, Roof, RoofEdgeL, RoofEdgeR, Chimney, Window, Door, Crown, CrownL, CrownR, Top, Trunk }

export interface House {
  c0: number;
  w: number;
  /** Its walls' bottom row and top row; the roof's peak row and its middle column. */
  base: number;
  wallTop: number;
  peak: number;
  mid: number;
  /** Where its chimney's smoke comes out (px), or null. */
  smoke: { x: number; y: number } | null;
  /** Its windows' cells. */
  windows: { c: number; r: number }[];
  front: boolean;
}
export interface Pine {
  c: number;
  base: number;
  h: number;
  front: boolean;
}

/** A ledge: the cell snow lies in, on top of the column `c`'s topmost cell of a roof or branches;
 *  how deep it can lie (rows); and a key naming it the same in any layout of the same village. */
export interface Ledge {
  c: number;
  r: number;
  cap: number;
  key: number;
}

export interface Layout {
  cols: number;
  rows: number;
  /** The far peaks' and the hills' top row in each column; and whether the peaks' face in each
   *  column is the one rising to the right, that catches the light. */
  far: Int16Array;
  farLit: Uint8Array;
  hills: Int16Array;
  /** The row the back village stands on, and the front's. */
  back: number;
  front: number;
  houses: House[];
  pines: Pine[];
  /** The houses and pines back to front, and each cell's part (0 none) and owner (an index into
   *  `things`; -1 none). */
  things: (House | Pine)[];
  part: Uint8Array;
  owner: Int16Array;
  ledges: Ledge[];
}

/** The row of a ridge of `peaks` at column `c` (its highest peak there, a little ragged), and
 *  whether `c` is on that peak's left, rising face. */
function ridge(peaks: Peak[], c: number, cols: number, rows: number, seed: number) {
  let top = rows;
  let left = true;
  for (const p of peaks) {
    const at = p.top * rows + Math.abs(c - p.fx * cols) * p.slope;
    if (at < top) {
      top = at;
      left = c < p.fx * cols;
    }
  }
  return { row: Math.round(top + (hash3(c >> 1, seed, 3) - 0.5) * 1.2), left };
}

export function layoutOf(v: Village, cols: number, rows: number): Layout {
  const front = Math.round(rows * 0.89);
  const back = Math.round(rows * 0.78);
  const hills = Int16Array.from({ length: cols }, (_, c) => clamp(ridge(v.hills, c, cols, rows, v.seed + 1).row, Math.round(rows * 0.45), back));
  const far = Int16Array.from({ length: cols }, (_, c) => clamp(ridge(v.far, c, cols, rows, v.seed).row, Math.round(rows * 0.15), hills[c]!));
  const farLit = Uint8Array.from({ length: cols }, (_, c) => (ridge(v.far, c, cols, rows, v.seed).left ? 1 : 0));
  const part = new Uint8Array(cols * rows);
  const owner = new Int16Array(cols * rows).fill(-1);
  const set = (c: number, r: number, p: Part, k: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    part[r * cols + c] = p;
    owner[r * cols + c] = k;
  };
  const houses: House[] = [];
  const pines: Pine[] = [];
  // Back to front: the back row's houses and pines, then the front's, the nearest pines last.
  const things = [
    ...v.houses.filter((h) => !h.front).map((h) => ({ h, z: 0 })),
    ...v.pines.filter((p) => !p.front).map((p) => ({ p, z: 1 })),
    ...v.houses.filter((h) => h.front).map((h) => ({ h, z: 2 })),
    ...v.pines.filter((p) => p.front).map((p) => ({ p, z: 3 + p.near })),
  ].sort((a, b) => a.z - b.z);
  const order: (House | Pine)[] = [];
  for (const t of things) {
    const k = order.length;
    if ("h" in t && t.h) {
      const s = t.h;
      const mid = Math.round(s.fx * cols);
      const c0 = mid - (s.w - 1) / 2;
      const base = s.front ? front : back;
      const wallTop = base - s.wall + 1;
      const R = (s.w + 3) / 2;
      const peak = wallTop - R;
      const house: House = { c0, w: s.w, base, wallTop, peak, mid, smoke: null, windows: [], front: s.front };
      for (let r = wallTop; r <= base; r++) for (let c = c0; c < c0 + s.w; c++) set(c, r, Part.Wall, k);
      for (let j = 0; j < R; j++) {
        for (let c = mid - j; c <= mid + j; c++) set(c, peak + j, c === mid - j ? Part.RoofEdgeL : c === mid + j ? Part.RoofEdgeR : Part.Roof, k);
      }
      if (s.chimney) {
        const c = mid + s.chimney * Math.max(1, Math.floor(R / 2));
        const edge = peak + Math.abs(c - mid);
        set(c, edge - 1, Part.Chimney, k);
        set(c, edge - 2, Part.Chimney, k);
        house.smoke = { x: c + 0.5, y: edge - 2 };
      }
      // Windows along the upper wall, and a door in the middle of the bottom.
      for (let c = c0 + 1; c < c0 + s.w - 1; c += 3) {
        set(c, wallTop, Part.Window, k);
        house.windows.push({ c, r: wallTop });
      }
      if (s.front) set(mid, base, Part.Door, k);
      houses.push(house);
      order.push(house);
    } else if ("p" in t && t.p) {
      const s = t.p;
      const c = Math.round(s.fx * cols);
      const base = (s.front ? front : back) + s.near;
      for (let j = 0; j < s.h - 1; j++) {
        const hw = Math.floor(j / 3) + (j % 3);
        const r = base - s.h + 1 + j;
        for (let x = c - hw; x <= c + hw; x++) set(x, r, j === 0 ? Part.Top : x === c - hw ? Part.CrownL : x === c + hw ? Part.CrownR : Part.Crown, k);
      }
      set(c, base, Part.Trunk, k);
      const pine: Pine = { c, base, h: s.h, front: s.front };
      pines.push(pine);
      order.push(pine);
    }
  }
  // Ledges: in each column of each thing, on top of its topmost cell, if that cell is its own and
  // the one above shows the sky or something further back.
  const ledges: Ledge[] = [];
  for (let k = 0; k < order.length; k++) {
    const t = order[k]!;
    const isHouse = "w" in t;
    const c0 = isHouse ? t.mid - (t.w + 1) / 2 : t.c - Math.ceil(t.h / 3) - 2;
    const c1 = isHouse ? t.mid + (t.w + 1) / 2 : t.c + Math.ceil(t.h / 3) + 2;
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
      for (let r = 1; r < rows; r++) {
        const i = r * cols + c;
        if (owner[i] !== k) continue;
        const above = owner[i - cols]!;
        if ((above < 0 || above < k) && part[i] !== Part.Trunk) ledges.push({ c, r: r - 1, cap: isHouse ? (part[i] === Part.Chimney ? 0.35 : 0.62) : 0.42, key: k * 128 + (c - c0) });
        break;
      }
    }
  }
  return { cols, rows, far, farLit, hills, back, front, houses, pines, things: order, part, owner, ledges };
}
