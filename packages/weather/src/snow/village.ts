/**
 * Snowfall's valley: the peaks far behind, forested hills nearer, and below them a snowy slope with
 * a village on it in three depths: small houses up the slope, a row further down with the church
 * among them, and the largest houses in front, a lodge among them. Each house is seen a little from
 * the side, its gable toward us and one long wall and its roof's slope beside it. A path winds up from
 * the bottom of the window to the church's door, lanterns along it. Pines stand in clumps among the
 * houses, and tall ones frame the valley at either side.
 *
 * It is chosen once (`villageOf`, from a seed of the first window's size: more houses on a wider
 * one) and laid out on the cell grid of any window (`layoutOf`), so a resize keeps the same village
 * and fits it to the new size: each thing at the same share of the width, as many cells big.
 *
 * Laid out, each house and pine owns its cells, back to front; the top of each column of a house's
 * roof or a pine's branches is a ledge snow can lie on, if nothing nearer stands over it.
 */
import { clamp, hash3, lerp, seeded } from "../util";

/** A house's kind: a house, the church (stone, a tower and spire at its gable), or the lodge (two
 *  floors). */
export enum Kind { House, Church, Lodge }

export interface HouseSpec {
  fx: number;
  /** Its gable wall's width and its walls' height, in cells; how deep its long wall is (cells: to
   *  the right if positive, the left if negative); which side of its ridge its chimney stands (0
   *  none). */
  w: number;
  wall: number;
  side: number;
  chimney: boolean;
  /** 0 up the slope, 1 the middle row, 2 the front; and how many rows up the slope from its row's
   *  line it stands. */
  row: 0 | 1 | 2;
  lift: number;
  kind: Kind;
}
export interface PineSpec {
  fx: number;
  h: number;
  row: 0 | 1 | 2;
  /** Rows nearer than its row's line (a pine standing a little in front). */
  near: number;
}
export interface Peak {
  fx: number;
  /** Its top as a share of the window's height, and how many rows it falls per column. */
  top: number;
  slope: number;
  /** Where its ridge, dividing the face toward the light from the face away from it, meets its foot:
   *  a share of its flank away from the light. */
  ridge: number;
}
export interface Village {
  houses: HouseSpec[];
  pines: PineSpec[];
  far: Peak[];
  hills: Peak[];
  /** Where the path leaves the bottom of the window, and where it passes the front row (shares of
   *  the width). */
  path: [number, number];
  seed: number;
}

/** How each row's houses come: their gable's width (odd), their walls, their long wall's depth, and
 *  the gaps between them (cells): small and far apart up the slope, large in front. */
const ROWS = [
  { w: [3, 5], wall: [1, 2], side: [1, 2], gap: [2, 34], lift: 3 },
  { w: [5, 9], wall: [2, 3], side: [2, 4], gap: [2, 22], lift: 1 },
  { w: [7, 11], wall: [2, 3], side: [3, 5], gap: [3, 18], lift: 0 },
] as const;

/** The valley for a window `cols` by `rows` cells: the same for the same window. */
export function villageOf(cols: number, rows: number): Village {
  const seed = 0x5a0 + cols * 31 + rows;
  const rnd = seeded(seed);
  const rint = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const odd = (n: number) => (n % 2 ? n : n + 1);
  const nFar = 3 + Math.round(cols / 70);
  const far = Array.from({ length: nFar }, (_, k): Peak => ({
    fx: (k + 0.15 + 0.7 * rnd()) / nFar, top: lerp(0.15, 0.33, rnd()), slope: lerp(0.5, 0.78, rnd()), ridge: lerp(0.2, 0.55, rnd()),
  }));
  const nHills = 4 + Math.round(cols / 45);
  const hills = Array.from({ length: nHills }, (_, k): Peak => ({ fx: (k + rnd()) / nHills, top: lerp(0.5, 0.58, rnd()), slope: lerp(0.15, 0.28, rnd()), ridge: 0 }));
  const houses: HouseSpec[] = [];
  const taken: [number, number, number][] = [];
  const free = (a: number, b: number, row: number) => a > 0.01 && b < 0.99 && taken.every(([x, y, r]) => r !== row || b < x || a > y);
  /** A house's extent, in shares of the width: its long wall, its roof's overhang. */
  const extent = (h: HouseSpec): [number, number] => [h.fx - (h.w / 2 + 2 + Math.max(0, -h.side)) / cols, h.fx + (h.w / 2 + 2 + Math.max(0, h.side)) / cols];
  const place = (h: HouseSpec) => {
    const [a, b] = extent(h);
    if (!free(a, b, h.row)) return false;
    taken.push([a, b, h.row]);
    houses.push(h);
    return true;
  };
  // The church, the village's heart: in the middle row, left of the middle, its long wall toward the
  // moon. The path passes the front row a little to one side of it, and climbs to its door.
  const church: HouseSpec = { fx: lerp(0.33, 0.42, rnd()), w: 9, wall: 4, side: 7, chimney: false, row: 1, lift: 0, kind: Kind.Church };
  place(church);
  const pass = church.fx + lerp(0.07, 0.12, rnd());
  const path: [number, number] = [pass + lerp(0.03, 0.09, rnd()), pass];
  taken.push([pass - 4 / cols, pass + 4 / cols, 2]);
  // The lodge, in front on the other side of the path.
  place({ fx: lerp(0.66, 0.8, rnd()), w: 13, wall: 4, side: 5, chimney: true, row: 2, lift: 0, kind: Kind.Lodge });
  for (const row of [0, 1, 2] as const) {
    const R = ROWS[row];
    let c = rint(1, 9);
    while (c < cols - 4) {
      const w = odd(rint(R.w[0], R.w[1]));
      const depth = rint(R.side[0], R.side[1]);
      const h: HouseSpec = {
        fx: 0, w, wall: rint(R.wall[0], R.wall[1]), side: rnd() < 0.5 ? -depth : depth, chimney: rnd() < 0.8, row, lift: rint(0, R.lift), kind: Kind.House,
      };
      h.fx = (c + w / 2 + 2 + Math.max(0, -h.side)) / cols;
      // Up the slope, only here and there.
      if (row > 0 || rnd() < 0.55) place(h);
      c += w + depth + 4 + Math.round(lerp(R.gap[0], R.gap[1], rnd() ** 1.7));
    }
  }
  const pines: PineSpec[] = [];
  const PINES = [
    { per: 4, h: [3, 5] },
    { per: 7, h: [4, 8] },
    { per: 9, h: [7, 13] },
  ] as const;
  for (const row of [0, 1, 2] as const) {
    const n = Math.round(cols / PINES[row].per);
    for (let k = 0; k < n; k++) {
      const h = rint(PINES[row].h[0], PINES[row].h[1]);
      // In clumps: most beside the last.
      const last = pines[pines.length - 1];
      const fx = last && last.row === row && rnd() < 0.6 ? clamp(last.fx + (rnd() - 0.5) * (9 / cols), 0, 1) : rnd();
      const half = (h / 5 + 1.5) / cols;
      if (!free(fx - half, fx + half, row)) continue;
      pines.push({ fx, h, row, near: row === 2 && rnd() < 0.3 ? rint(1, 3) : 0 });
    }
  }
  // Tall pines near the glass at both sides, framing the valley.
  for (const side of [0, 1]) {
    for (let k = rint(2, 3); k > 0; k--) pines.push({ fx: side ? 1 - rnd() * 0.06 : rnd() * 0.06, h: rint(15, 21), row: 2, near: rint(3, 6) });
  }
  return { houses, pines, far, hills, path, seed };
}

/** A part of the scenery a cell belongs to. */
export enum Part { Wall = 1, Gable, Side, Roof, RoofEdgeL, RoofEdgeR, Chimney, Window, Door, Tower, Spire, Crown, CrownL, CrownR, Top, Trunk }

export interface House {
  kind: Kind;
  c0: number;
  w: number;
  side: number;
  /** Its walls' bottom row and top row; its gable's peak row and middle column; how many rows its
   *  roof falls from the peak to the eaves. */
  base: number;
  wallTop: number;
  peak: number;
  mid: number;
  fall: number;
  /** The church's tower: its columns, its top row, and its spire's tip. */
  tower: { c0: number; c1: number; top: number; tip: number } | null;
  /** Where its chimney's smoke comes out (cells), or null. */
  smoke: { x: number; y: number } | null;
  /** Its windows' cells. */
  windows: { c: number; r: number }[];
  row: 0 | 1 | 2;
  front: boolean;
}
export interface Pine {
  c: number;
  base: number;
  h: number;
  row: 0 | 1 | 2;
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
  /** The far peaks' and the hills' top row in each column. */
  far: Int16Array;
  hills: Int16Array;
  /** The row the snowy slope begins at, the middle row's line and the front's. */
  field: number;
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
  /** The path, bottom to top, as points in cells (its middle) with its width there (cells); and
   *  the lanterns along it, each the cell its lamp is in. */
  path: { x: number; y: number; w: number }[];
  lanterns: { x: number; y: number }[];
}

/** The row of a ridge of `peaks` at column `c`: its highest peak there, a little ragged. */
function ridge(peaks: Peak[], c: number, cols: number, rows: number, seed: number) {
  let top = rows;
  for (const p of peaks) top = Math.min(top, p.top * rows + Math.abs(c - p.fx * cols) * p.slope);
  return Math.round(top + (hash3(c >> 1, seed, 3) - 0.5) * 1.2);
}

/** The line each row's houses stand on. */
const lineOf = (l: { field: number; back: number; front: number }, row: number) => (row === 0 ? l.field + 4 : row === 1 ? l.back : l.front);

export function layoutOf(v: Village, cols: number, rows: number): Layout {
  const field = Math.round(rows * 0.66);
  const back = Math.round(rows * 0.78);
  const front = Math.round(rows * 0.89);
  const lines = { field, back, front };
  const hills = Int16Array.from({ length: cols }, (_, c) => clamp(ridge(v.hills, c, cols, rows, v.seed + 1), Math.round(rows * 0.45), field - 2));
  const far = Int16Array.from({ length: cols }, (_, c) => clamp(ridge(v.far, c, cols, rows, v.seed), Math.round(rows * 0.12), hills[c]!));
  const part = new Uint8Array(cols * rows);
  const owner = new Int16Array(cols * rows).fill(-1);
  const set = (c: number, r: number, p: Part, k: number) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    part[r * cols + c] = p;
    owner[r * cols + c] = k;
  };
  const houses: House[] = [];
  const pines: Pine[] = [];
  // Back to front, by the row each stands on.
  const things = [
    ...v.houses.map((h) => ({ h, z: lineOf(lines, h.row) - h.lift })),
    ...v.pines.map((p) => ({ p, z: lineOf(lines, p.row) + p.near + 0.5 })),
  ].sort((a, b) => a.z - b.z);
  const order: (House | Pine)[] = [];
  for (const t of things) {
    const k = order.length;
    if ("h" in t && t.h) {
      const s = t.h;
      const mid = Math.round(s.fx * cols);
      const c0 = mid - (s.w - 1) / 2;
      const base = lineOf(lines, s.row) - s.lift;
      const wallTop = base - s.wall + 1;
      const fall = (s.w + 1) / 2;
      const peak = wallTop - fall;
      const house: House = { kind: s.kind, c0, w: s.w, side: s.side, base, wallTop, peak, mid, fall, tower: null, smoke: null, windows: [], row: s.row, front: s.row === 2 };
      const dir = Math.sign(s.side);
      const depth = Math.abs(s.side);
      // Its long wall, and over it its roof's slope: from the gable's edge on that side, as deep.
      const sideC0 = dir > 0 ? c0 + s.w : c0 - depth;
      for (let r = wallTop; r <= base; r++) for (let c = sideC0; c < sideC0 + depth; c++) set(c, r, Part.Side, k);
      for (let j = 0; j <= fall; j++) {
        const edge = mid + dir * j;
        for (let d = 1; d <= depth; d++) set(edge + dir * d, peak + j, Part.Roof, k);
      }
      // Its gable: the wall, the triangle over it, the roof's edges along it.
      for (let r = wallTop; r <= base; r++) for (let c = c0; c < c0 + s.w; c++) set(c, r, Part.Wall, k);
      for (let j = 0; j < fall; j++) {
        for (let c = mid - j; c <= mid + j; c++) set(c, peak + j, c === mid - j ? Part.RoofEdgeL : c === mid + j ? Part.RoofEdgeR : Part.Gable, k);
      }
      if (s.chimney) {
        // On the roof's slope, near the ridge, part way along.
        const c = mid + dir * Math.min(depth, Math.max(1, Math.round(depth * 0.6)));
        set(c, peak, Part.Chimney, k);
        set(c, peak - 1, Part.Chimney, k);
        house.smoke = { x: c + 0.5, y: peak - 1 };
      }
      if (s.kind === Kind.Church) {
        const top = peak - 3;
        const tip = top - 6;
        house.tower = { c0: mid - 1, c1: mid + 1, top, tip };
        for (let r = top; r <= base; r++) for (let c = mid - 1; c <= mid + 1; c++) set(c, r, Part.Tower, k);
        for (let r = tip; r < top; r++) set(mid, r, Part.Spire, k);
        // Tall windows along its long wall, the bell's window in the tower.
        for (let d = 1; d < depth; d += 2) house.windows.push({ c: sideC0 + (dir > 0 ? d : depth - 1 - d), r: wallTop + 1 });
        house.windows.push({ c: mid, r: top + 1 });
      } else {
        // Windows along the long wall and either side of the gable's middle; a second floor's
        // windows on the lodge; a door in the middle of a house in front.
        for (let d = 1; d < depth; d += 2) house.windows.push({ c: sideC0 + (dir > 0 ? d : depth - 1 - d), r: wallTop });
        for (let c = c0 + 1; c < c0 + s.w - 1; c += s.w >= 7 ? 2 : 3) if (c !== mid || !house.front) house.windows.push({ c, r: base - (s.wall > 2 ? 1 : 0) });
        if (s.kind === Kind.Lodge) for (let c = c0 + 1; c < c0 + s.w - 1; c += 2) house.windows.push({ c, r: wallTop });
        if (s.w >= 5 && s.row > 0) house.windows.push({ c: mid, r: peak + Math.floor(fall * 0.6) });
      }
      for (const w of house.windows) set(w.c, w.r, Part.Window, k);
      if (house.front || s.kind === Kind.Church) set(mid, base, Part.Door, k);
      houses.push(house);
      order.push(house);
    } else if ("p" in t && t.p) {
      const s = t.p;
      const c = Math.round(s.fx * cols);
      const base = lineOf(lines, s.row) + s.near;
      for (let j = 0; j < s.h - 1; j++) {
        const hw = Math.floor(j / 3) + (j % 3 > 1 ? 1 : 0);
        const r = base - s.h + 1 + j;
        for (let x = c - hw; x <= c + hw; x++) set(x, r, j === 0 ? Part.Top : x === c - hw ? Part.CrownL : x === c + hw ? Part.CrownR : Part.Crown, k);
      }
      set(c, base, Part.Trunk, k);
      const pine: Pine = { c, base, h: s.h, row: s.row };
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
    const c0 = isHouse ? Math.min(t.c0, t.c0 + t.side) - 1 : t.c - Math.ceil(t.h / 3) - 2;
    const c1 = isHouse ? Math.max(t.c0 + t.w, t.c0 + t.w + t.side) + 1 : t.c + Math.ceil(t.h / 3) + 2;
    for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
      for (let r = 1; r < rows; r++) {
        const i = r * cols + c;
        if (owner[i] !== k) continue;
        const above = owner[i - cols]!;
        if ((above < 0 || above < k) && part[i] !== Part.Trunk) ledges.push({ c, r: r - 1, cap: isHouse ? (part[i] === Part.Chimney || part[i] === Part.Spire ? 0.35 : 0.62) : 0.42, key: k * 128 + (c - c0) });
        break;
      }
    }
  }
  // The path: from below the window's bottom, through the gap in the front row, up to the church's
  // door; narrower as it goes away. Lanterns along it, either side by turns.
  const church = houses.find((h) => h.kind === Kind.Church);
  const p0 = { x: v.path[0] * cols, y: rows + 2 };
  const p1 = { x: v.path[1] * cols, y: front + 1 };
  const p2 = church ? { x: church.mid + 0.5, y: church.base + 1 } : { x: p1.x, y: back + 1 };
  const path: Layout["path"] = [];
  for (let k = 0; k <= 40; k++) {
    const t = k / 40;
    // Through p1, smoothly: a quadratic from p0 to p2 whose middle passes p1.
    const cx = 2 * p1.x - (p0.x + p2.x) / 2;
    const cy = 2 * p1.y - (p0.y + p2.y) / 2;
    const x = (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * cx + t * t * p2.x;
    const y = (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * cy + t * t * p2.y;
    path.push({ x, y, w: lerp(4.5, 1.2, t) });
  }
  const lanterns = [0.3, 0.5, 0.68, 0.84].map((t, k) => {
    const p = path[Math.round(t * 40)]!;
    return { x: p.x + (k % 2 ? 1 : -1) * (p.w * 0.5 + 1), y: p.y - 1 };
  });
  return { cols, rows, far, hills, field, back, front, houses, pines, things: order, part, owner, ledges, path, lanterns };
}
