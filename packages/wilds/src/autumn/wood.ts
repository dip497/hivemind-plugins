/**
 * Autumn Wood's layout, in cells: a big tree at each edge of the window, its crown reaching over the
 * top corner; a few smaller trees further back, kept off the middle; a far treeline of round crowns
 * low across the window; and the forest floor along the bottom. Each tree is a trunk with bark,
 * tapering as it rises and flaring into roots at its foot; limbs forking up into its crown, and a
 * bare twig or two out past it; and a crown of leaves: many round clumps on a dome, each lit on the
 * side toward the sun and shaded on the other, the ones behind darker, gaps between them where the
 * limbs and the sky show, in patches of the tree's own autumn colours.
 *
 * Every place and size is a share of the window, from a fixed seed: a window shows the same wood
 * each time, and a resized window the same wood fitted to it. A wider window has more trees.
 */
import type { Grid } from "../grid";
import { clamp, hash, noise1, noise2, seeded } from "../num";
import { LEAF_COLOURS, type LeafColour } from "./palette";

/** One clump of leaves, in cells: its middle, its radii, how far round the dome it sits (z: 1 in
 *  front, -1 behind; x and y: which way it faces out of the crown) and its colour. */
export interface Clump { cx: number; cy: number; rx: number; ry: number; z: number; ox: number; oy: number; colour: number }
/** A limb, from a cell on the trunk to a cell in (or out past) the crown; `thick` cells wide at its
 *  root. */
export interface Limb { c0: number; r0: number; c1: number; r1: number; thick: number }

/** A crown's cells: where each is, which way its leaves face (x right, y down, z toward us: a unit
 *  vector, the clump's dome and its place on the crown's), how far back its clump is (0 in front,
 *  1 behind), its leaf colour (an index of LEAF_COLOURS), and whether it is at the crown's ragged
 *  edge (a leaf alone, with nothing behind it). */
export interface Crown {
  n: number;
  c: Int16Array;
  r: Int16Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  back: Float32Array;
  colour: Uint8Array;
  edge: Uint8Array;
}

export interface TreeShape {
  id: number;
  /** A big tree at an edge, or one further back (smaller, a little hazed). */
  near: boolean;
  /** -1 at the left edge, 1 at the right, 0 further back. */
  side: -1 | 0 | 1;
  /** Its trunk: the middle of its foot (a column), the foot's row, how many cells wide at the foot
   *  and at the top, the row it ends in (inside the crown), and how many cells over it leans per
   *  row up. */
  c: number;
  foot: number;
  base: number;
  width: number;
  top: number;
  lean: number;
  limbs: Limb[];
  clumps: Clump[];
  crown: Crown;
  /** The crown's middle and radii, in cells. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Every cell it draws in: its trunk, limbs and crown. */
  box: { c0: number; r0: number; c1: number; r1: number };
}

export interface WoodLayout {
  grid: Grid;
  /** The first row of the forest floor. */
  floor: number;
  /** Per column, the row the far treeline's crowns reach up to. */
  far: Int16Array;
  /** Back to front. */
  trees: TreeShape[];
  /** Where a lantern hangs (a limb's tip on the right-hand tree), in cells. */
  lantern: { tree: number; c: number; r: number };
}

/** Where the trees further back stand, as shares of the width: the middle stays open. */
const SLOTS = [0.27, 0.73, 0.36, 0.64, 0.18, 0.82];
/** Cells are taller than wide: a row is this many columns of distance. */
const ROW = 1.45;
/** Each tree's colours, by its kind, from its leaves least turned to its most: a maple's greens
 *  going orange to red and crimson, an oak's ambers to browns, a birch's golds, a sweet gum's every
 *  colour at once. */
const KINDS: LeafColour[][] = [
  ["green", "orange", "red", "red", "crimson"],
  ["green", "amber", "amber", "orange", "brown"],
  ["green", "gold", "gold", "gold", "amber"],
  ["green", "gold", "orange", "red", "crimson"],
];
export function woodOf(grid: Grid, seed: number): WoodLayout {
  const { cols, rows, cw, ch } = grid;
  const floor = rows - Math.max(3, Math.round(rows * 0.045));
  // The far treeline: round crowns side by side, rising and falling along it.
  const far = new Int16Array(cols).fill(floor - 1);
  const fr = seeded(seed ^ 0xfa5);
  const farHigh = Math.max(4, Math.round(rows * 0.1));
  for (let x = -0.02; x < 1.02; ) {
    const r = (0.018 + 0.022 * fr()) * cols;
    const mid = x * cols + r;
    const lift = farHigh * (0.25 + 0.4 * fr()) * (0.5 + 0.5 * noise1(x * 5, seed));
    for (let c = Math.max(0, Math.floor(mid - r)); c <= Math.min(cols - 1, Math.ceil(mid + r)); c++) {
      const u = (c + 0.5 - mid) / r;
      if (u * u >= 1) continue;
      const top = Math.round(floor - 1 - lift - (1.5 * r * Math.sqrt(1 - u * u)) / ROW);
      far[c] = Math.min(far[c]!, top);
    }
    x += (r * (1.1 + 0.5 * fr())) / cols;
  }

  const trees: TreeShape[] = [];
  const unit = Math.min(cols * cw, rows * ch);
  // Further back: smaller trees, in the slots a window this wide has room for.
  const back = clamp(Math.round((cols * cw) / 520), 2, SLOTS.length);
  for (let i = 0; i < back; i++) {
    const r = seeded(seed + 101 * (i + 1));
    const R = unit * (0.11 + 0.035 * r());
    trees.push(treeOf(trees.length, false, 0, SLOTS[i]! * cols + (r() - 0.5) * 3, floor, R, floor - (R / ch) * (1.55 + 0.3 * r()), grid, r, seed + i * 7));
  }
  // The big trees at the edges, in front.
  for (const side of [-1, 1] as const) {
    const r = seeded(seed + 9001 + side);
    const R = unit * (0.25 + 0.03 * r());
    const at = side < 0 ? 0.055 + 0.02 * r() : 0.945 - 0.02 * r();
    trees.push(treeOf(trees.length, true, side, at * cols, floor + 1, R, rows * (0.23 + 0.04 * r()), grid, r, seed + 50 + side));
  }
  // The lantern hangs from the right-hand tree's low limb into the wood.
  const right = trees[trees.length - 1]!;
  const limb = right.limbs[right.limbs.length - 1]!;
  return { grid, floor, far, trees, lantern: { tree: right.id, c: Math.round(limb.c1), r: Math.round(limb.r1) + 1 } };
}

/** A tree whose trunk rises from (`c`, `foot`), its crown about `R` px across its middle at row
 *  `crownY`, facing into the wood from `side`. */
function treeOf(id: number, near: boolean, side: -1 | 0 | 1, c: number, foot: number, R: number, crownY: number, grid: Grid, rnd: () => number, seed: number): TreeShape {
  const { cols, rows, cw, ch } = grid;
  const base = near ? Math.max(4, Math.round((cols * cw) / 240)) : Math.max(3, Math.round((cols * cw) / 480));
  const width = Math.max(2, Math.round(base * 0.6));
  const inward = side === 0 ? (rnd() < 0.5 ? -1 : 1) : -side;
  const rx = R / cw;
  const ry = R / ch;
  // The crown leans into the wood from an edge tree, over its trunk elsewhere.
  const cx = c + inward * rx * (near ? 0.32 : 0.08);
  const cy = crownY;
  const top = Math.round(cy + ry * 0.2);
  const lean = inward * (near ? 0.05 : 0.025) * (0.4 + 0.6 * rnd());
  const trunkAt = (r: number) => c + (foot - r) * lean;

  // Clumps over a dome: front ones over back ones, more round the top than under it.
  const clumps: Clump[] = [];
  const n = Math.round((near ? 34 : 16) * (0.9 + 0.2 * rnd()));
  const kinds = KINDS[Math.floor(rnd() * KINDS.length)]!;
  for (let k = 0; k < n * 4 && clumps.length < n; k++) {
    const a = rnd() * Math.PI * 2;
    const rho = Math.sqrt(rnd()) * 0.86;
    const ox = Math.cos(a) * rho;
    const oy = Math.sin(a) * rho;
    // A crown is flatter underneath.
    if (oy > 0.55 && rnd() < 0.7) continue;
    const z = (rnd() < 0.5 ? -1 : 1) * Math.sqrt(Math.max(0, 1 - rho * rho)) * rnd();
    const s = (near ? 0.2 : 0.3) * (0.75 + 0.5 * rnd());
    // Turned furthest on the outside and the top of the crown, least deep inside it and low.
    const turned = clamp(0.3 + 0.45 * rho - 0.25 * oy + (noise2(ox * 1.3 + id, oy * 1.3, seed + 5) - 0.5) * 0.7, 0, 0.999);
    clumps.push({ cx: cx + ox * rx, cy: cy + oy * ry, rx: rx * s, ry: (rx * s) / ROW, z, ox, oy, colour: LEAF_COLOURS.indexOf(kinds[Math.floor(turned * kinds.length)]!) });
  }
  // Deep in the crown, behind the rest, a few big clumps in shade, so no hole goes right through it.
  for (let k = 0; k < (near ? 5 : 2); k++) {
    const a = (k / (near ? 5 : 2)) * Math.PI * 2 + rnd();
    const ox = Math.cos(a) * 0.32;
    const oy = Math.sin(a) * 0.3 - 0.05;
    clumps.push({ cx: cx + ox * rx, cy: cy + oy * ry, rx: rx * 0.36, ry: (rx * 0.36) / ROW, z: -0.85, ox, oy, colour: LEAF_COLOURS.indexOf(kinds[1]!) });
  }
  clumps.sort((a, b) => a.z - b.z);

  // Limbs: the trunk forks into two or three thick limbs up into the crown; smaller ones reach out
  // to clumps near its edge; a bare twig or two pokes out past it.
  const limbs: Limb[] = [];
  const forks = near ? 3 : 2;
  for (let k = 0; k < forks; k++) {
    const a = -Math.PI / 2 + ((k + 0.5) / forks - 0.5) * 1.9 + (rnd() - 0.5) * 0.3;
    const len = 0.55 + 0.25 * rnd();
    limbs.push({ c0: trunkAt(top), r0: top, c1: cx + Math.cos(a) * rx * len, r1: cy + Math.sin(a) * ry * len * 0.9, thick: near ? 2 : 1 });
  }
  for (let k = 0; k < (near ? 5 : 2); k++) {
    const r0 = Math.round(top + (foot - top) * (0.02 + 0.05 * k));
    const out = k % 2 ? 1 : -1;
    const a = (out > 0 ? -0.55 : Math.PI + 0.55) + (rnd() - 0.5) * 0.6;
    const len = 0.55 + 0.3 * rnd();
    limbs.push({ c0: trunkAt(r0), r0, c1: trunkAt(r0) + Math.cos(a) * rx * len, r1: r0 + Math.sin(a) * ry * len, thick: 1 });
  }
  for (let k = 0; k < (near ? 2 : 1); k++) {
    const a = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
    limbs.push({ c0: cx + Math.cos(a) * rx * 0.4, r0: cy + Math.sin(a) * ry * 0.4, c1: cx + Math.cos(a) * rx * 1.12, r1: cy + Math.sin(a) * ry * 1.12, thick: 1 });
  }
  // A long low limb into the wood, under the crown (the lantern hangs from the right-hand tree's).
  if (near) {
    const r0 = Math.round(cy + ry * 0.7);
    limbs.push({ c0: trunkAt(r0), r0, c1: trunkAt(r0) + inward * rx * 0.62, r1: r0 + ry * 0.05, thick: 2 });
  }
  const crown = crownOf(clumps, grid, seed);
  const xs = [c - base - 2, c + base + 2 + (foot - top) * Math.abs(lean), ...clumps.flatMap((b) => [b.cx - b.rx - 1, b.cx + b.rx + 1]), ...limbs.flatMap((l) => [l.c0 - 2, l.c1 - 2, l.c0 + 2, l.c1 + 2])];
  const ys = [...clumps.map((b) => b.cy - b.ry - 1), ...limbs.flatMap((l) => [l.r0 - 1, l.r1 - 1])];
  const box = {
    c0: clamp(Math.floor(Math.min(...xs)), 0, cols - 1),
    c1: clamp(Math.ceil(Math.max(...xs)), 0, cols - 1),
    r0: clamp(Math.floor(Math.min(...ys)), 0, rows - 1),
    r1: clamp(foot + 1, 0, rows - 1),
  };
  return { id, near, side, c, foot, base, width, top, lean, limbs, clumps, crown, cx, cy, rx, ry, box };
}

/** The cells of a crown made of `clumps` (back to front). */
function crownOf(clumps: Clump[], grid: Grid, seed: number): Crown {
  const { cols, rows } = grid;
  const at = new Map<number, number[]>();
  for (const b of clumps) {
    const c0 = Math.max(0, Math.floor(b.cx - b.rx - 1));
    const c1 = Math.min(cols - 1, Math.ceil(b.cx + b.rx + 1));
    const r0 = Math.max(0, Math.floor(b.cy - b.ry - 1));
    const r1 = Math.min(rows - 1, Math.ceil(b.cy + b.ry + 1));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const u = (c + 0.5 - b.cx) / b.rx;
        const v = (r + 0.5 - b.cy) / b.ry;
        // A ragged clump: its edge in and out.
        const f = 1 - u * u - v * v + (noise2(c * 0.5, r * 0.7, seed) - 0.5) * 0.7;
        if (f <= 0) continue;
        const key = r * cols + c;
        const was = at.get(key);
        // Its leaves face out of its own dome, turned the way it faces out of the crown's.
        const d = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u + v * v)));
        let nx = u * 0.75 + b.ox * 0.65;
        let ny = v * 0.75 + b.oy * 0.65;
        let nz = d * 0.7 + b.z * 0.5 + 0.2;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len;
        ny /= len;
        nz /= len;
        // Here and there a leaf of the next colour along.
        const colour = hash(c, r, seed + 2) < 0.12 ? (b.colour + (hash(r, c, seed + 3) < 0.5 ? 1 : LEAF_COLOURS.length - 1)) % LEAF_COLOURS.length : b.colour;
        // A clump's own rim, where no clump lies behind it, is the crown's ragged edge.
        const edge = f < 0.22 && (!was || was[6] === 1) ? 1 : 0;
        at.set(key, [c, r, nx, ny, nz, (1 - b.z) / 2, edge, colour]);
      }
    }
  }
  const cells = [...at.values()].filter((v) => !(v[6] === 1 && hash(v[0]!, v[1]!, seed) < 0.35));
  const n = cells.length;
  const crown: Crown = { n, c: new Int16Array(n), r: new Int16Array(n), nx: new Float32Array(n), ny: new Float32Array(n), nz: new Float32Array(n), back: new Float32Array(n), colour: new Uint8Array(n), edge: new Uint8Array(n) };
  cells.forEach(([c, r, nx, ny, nz, back, edge, colour], i) => {
    crown.c[i] = c!;
    crown.r[i] = r!;
    crown.nx[i] = nx!;
    crown.ny[i] = ny!;
    crown.nz[i] = nz!;
    crown.back[i] = back!;
    crown.edge[i] = edge!;
    crown.colour[i] = colour!;
  });
  return crown;
}
