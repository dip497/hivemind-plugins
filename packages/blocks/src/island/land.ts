/**
 * Block Island's ground: a round island of block columns floating in the sky, laid out once for the
 * window it is made for (a bigger window, a bigger island) and the same every time for that size.
 * Grass over dirt over stone, hanging down in a ragged cone underneath; a few low hills; a pond near
 * the right-hand edge whose water runs out over the edge (the lip) and falls; trees; a cottage with
 * a chimney; lantern posts; flowers in the grass.
 */
import { clamp, fractal, hash2, noise2, seededRandom } from "../rng";

/** What a column's top block is. */
export const Mat = { Grass: 1, Dirt: 2, Stone: 3, Sand: 4, Water: 5 } as const;
export type Mat = (typeof Mat)[keyof typeof Mat];

/** How tall a tree's trunk is before its leaves, and the leaf blocks round its top, by shape. */
export const TREE_SHAPES: { trunk: number; leaves: [number, number, number][] }[] = [0, 1, 2].map((shape) => {
  const leaves: [number, number, number][] = [];
  const trunk = 3 + (shape === 2 ? 1 : 0);
  // Layers of leaves round the trunk's top: wide, then narrower, then a cap.
  const layers = shape === 0 ? [2, 2, 1, 0] : shape === 1 ? [1, 2, 1, 0] : [2, 1, 1, 0];
  layers.forEach((r, z) => {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        // Round, not square: the corners of a wide layer left off.
        if (r >= 2 && Math.abs(dx) === r && Math.abs(dy) === r) continue;
        if (r === 1 && z === 2 && Math.abs(dx) + Math.abs(dy) === 2 && shape === 0) continue;
        leaves.push([dx, dy, trunk - 1 + z]);
      }
    }
  });
  return { trunk, leaves };
});

export interface Tree {
  i: number;
  j: number;
  shape: number;
}

export interface Land {
  /** The grid is n by n columns. */
  n: number;
  /** The height of each column's surface, or -1 where the island is not. */
  top: Int16Array;
  /** Each column's lowest block. */
  bottom: Int16Array;
  /** What each column's top block is. */
  surface: Uint8Array;
  /** Something stands on the column: a tree, the cottage, a lantern. */
  blocked: Uint8Array;
  /** A flower in the grass there (its colour, from 1), or 0. */
  flower: Uint8Array;
  /** The level most of the island's top is at. */
  base: number;
  trees: Tree[];
  cottage: { i: number; j: number; w: number; d: number };
  lanterns: { i: number; j: number }[];
  /** The edge column the pond spills over, out along +x. */
  lip: { i: number; j: number };
}

export const at = (land: Land, i: number, j: number) => (i < 0 || j < 0 || i >= land.n || j >= land.n ? -1 : j * land.n + i);
/** The surface's height at a column, or -1 off the island. */
export const topAt = (land: Land, i: number, j: number) => {
  const k = at(land, i, j);
  return k < 0 ? -1 : land.top[k]!;
};

/** The island for a grid of n by n columns. */
export function makeLand(n: number): Land {
  const rnd = seededRandom(9001 + n);
  const N = n * n;
  const base = 8;
  const top = new Int16Array(N).fill(-1);
  const bottom = new Int16Array(N).fill(0);
  const surface = new Uint8Array(N);
  const blocked = new Uint8Array(N);
  const flower = new Uint8Array(N);
  const land: Land = { n, top, bottom, surface, blocked, flower, base, trees: [], cottage: { i: 0, j: 0, w: 3, d: 3 }, lanterns: [], lip: { i: 0, j: 0 } };
  // An ellipse wider across the screen than deep into it (u runs along the screen, v into it), so
  // the island fills the window's width without filling its height.
  const Rv = n * 0.36;
  const Ru = Rv * 1.55;
  const R = Rv;
  /** How far in from the island's edge a column is, in columns (negative outside). */
  const inset = new Float32Array(N);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const dx = i + 0.5 - n / 2;
      const dy = j + 0.5 - n / 2;
      const u = (dx - dy) / Math.SQRT2 / Ru;
      const v = (dx + dy) / Math.SQRT2 / Rv;
      const a = Math.atan2(v, u);
      // The edge wanders in and out round the island, closing on itself.
      const edge = 0.82 + 0.18 * noise2(Math.cos(a) * 1.7 + 4, Math.sin(a) * 1.7 + 4, 3);
      inset[j * n + i] = (edge - Math.hypot(u, v)) * Rv;
    }
  }
  for (let k = 0; k < N; k++) {
    const d = inset[k]!;
    if (d <= 0) continue;
    const i = k % n;
    const j = Math.floor(k / n);
    top[k] = base;
    surface[k] = Mat.Grass;
    // Deeper toward the middle, ragged: rock hanging down in points.
    // Now and then a point of rock hangs lower than those round it.
    const tip = hash2(i, j, 12) < 0.12 ? 2 + Math.floor(hash2(i, j, 13) * 3) : 0;
    const depth = 1 + tip + Math.round(Math.pow(clamp(d / R, 0, 1), 0.75) * n * 0.28 * (0.65 + 0.7 * hash2(i, j, 11)));
    bottom[k] = base - 1 - depth;
  }
  // Low hills, away from the edge.
  for (let k = 0; k < N; k++) {
    if (top[k]! < 0 || inset[k]! < 3) continue;
    const h = fractal((k % n) / 5.5, Math.floor(k / n) / 5.5, 2, 21);
    if (h > 0.66) top[k] = base + 1;
    if (h > 0.76) top[k] = base + 2;
  }
  // Rock shows on the tops of the higher hills now and then.
  for (let k = 0; k < N; k++) if (top[k]! === base + 2 && hash2(k % n, Math.floor(k / n), 31) < 0.35) surface[k] = Mat.Stone;

  // The pond, by the right-hand edge, and the run of water out to the lip.
  const j0 = Math.floor(n * 0.56);
  let iEdge = 0;
  for (let i = 0; i < n; i++) if (top[j0 * n + i]! >= 0) iEdge = i;
  land.lip = { i: iEdge, j: j0 };
  const pc = { x: iEdge - 3.2, y: j0 + 0.5 };
  const pondR = clamp(n * 0.1, 2, 3.2);
  const flat = (k: number) => { top[k] = base; };
  for (let k = 0; k < N; k++) {
    if (top[k]! < 0) continue;
    const i = k % n;
    const j = Math.floor(k / n);
    const d = Math.hypot(i + 0.5 - pc.x, (j + 0.5 - pc.y) * 1.15) - 0.6 * noise2(i * 0.7, j * 0.7, 41);
    const inRun = j === j0 && i >= pc.x && i <= iEdge;
    if (d < pondR || inRun) {
      surface[k] = Mat.Water;
      flat(k);
    } else if (d < pondR + 1.6) flat(k);
  }
  // Sand along the water.
  for (let k = 0; k < N; k++) {
    if (top[k]! < 0 || surface[k] === Mat.Water) continue;
    const i = k % n;
    const j = Math.floor(k / n);
    const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => surface[at(land, i + a!, j + b!)] === Mat.Water);
    if (wet && hash2(i, j, 51) < 0.7) surface[k] = Mat.Sand;
  }

  /** Whether a footprint is flat grass (the ground round it within `slack` of level), in from the
   *  edge and clear of the water and what stands. */
  const clear = (i: number, j: number, w: number, d: number, margin: number, slack = 0) => {
    for (let b = -1; b <= d; b++) {
      for (let a = -1; a <= w; a++) {
        const k = at(land, i + a, j + b);
        const under = a >= 0 && a < w && b >= 0 && b < d;
        if (k < 0 || Math.abs(top[k]! - base) > (under ? 0 : slack) || top[k]! < 0 || surface[k] === Mat.Water || blocked[k] || inset[k]! < margin) return false;
        if (Math.hypot(i + a + 0.5 - pc.x, j + b + 0.5 - pc.y) < pondR + 2) return false;
      }
    }
    return true;
  };

  // The cottage, toward the back, where its walls face the viewer.
  const spots: [number, number][] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) spots.push([i, j]);
  spots.sort((p, q) => Math.hypot(p[0] - n * 0.32, p[1] - n * 0.3) - Math.hypot(q[0] - n * 0.32, q[1] - n * 0.3));
  const home = spots.find(([i, j]) => clear(i, j, 3, 3, 2.5)) ?? [Math.floor(n * 0.3), Math.floor(n * 0.3)];
  land.cottage = { i: home[0], j: home[1], w: 3, d: 3 };
  for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) {
    const k = at(land, home[0] + a, home[1] + b);
    if (k >= 0) { blocked[k] = 1; top[k] = base; surface[k] = Mat.Grass; }
  }

  // Lantern posts: by the cottage's door, and by the pond.
  const lanternAt = (i: number, j: number) => {
    const k = at(land, i, j);
    if (k < 0 || top[k]! < 0 || surface[k] === Mat.Water || blocked[k]) return;
    blocked[k] = 1;
    land.lanterns.push({ i, j });
  };
  lanternAt(home[0] - 1, home[1] + 3);
  lanternAt(Math.round(pc.x - pondR - 1), Math.round(pc.y - pondR));
  lanternAt(Math.round(pc.x + 1), Math.round(pc.y + pondR + 1));

  // Trees, apart from each other, the cottage and the water.
  let area = 0;
  for (let k = 0; k < N; k++) if (top[k]! >= 0) area++;
  const want = clamp(Math.round(area / 48), 4, 12);
  const order = spots.map((s) => ({ s, r: rnd() })).sort((a, b) => a.r - b.r).map((o) => o.s);
  for (const [i, j] of order) {
    if (land.trees.length >= want) break;
    if (!clear(i, j, 1, 1, 2.5, 1)) continue;
    if (land.trees.some((t) => Math.hypot(t.i - i, t.j - j) < 4)) continue;
    // Not beside the cottage, nor in front of it, where it would hide its walls.
    if (inFrontOfCottage(land, i, j)) continue;
    land.trees.push({ i, j, shape: Math.floor(rnd() * TREE_SHAPES.length) });
    blocked[at(land, i, j)] = 1;
  }

  // Flowers here and there in the grass.
  for (let k = 0; k < N; k++) {
    if (surface[k] !== Mat.Grass || blocked[k]) continue;
    const r = hash2(k % n, Math.floor(k / n), 61);
    if (r < 0.09) flower[k] = 1 + Math.floor(hash2(k % n, Math.floor(k / n), 62) * 4);
  }
  return land;
}

/** Whether a column is by the cottage or in front of it on the screen, where a tree would hide it. */
export function inFrontOfCottage(land: Land, i: number, j: number) {
  const c = land.cottage;
  return i >= c.i - 1 && i <= c.i + 5 && j >= c.j - 1 && j <= c.j + 5;
}

/** The grid size for a window: bigger for a bigger one. */
export const islandSize = (w: number, h: number) => clamp(Math.round(Math.sqrt(w * h) / 40), 16, 40);
