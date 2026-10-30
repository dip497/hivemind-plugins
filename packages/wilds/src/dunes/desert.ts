/**
 * Dunes' land, as numbers: a field of dune ridges, each snaking across the view, its crest rising
 * and falling, a long gentle face toward us rippled by the wind and a steep slip face behind; seen
 * from a little above, in perspective, to the horizon. Each column of cells is marched from the
 * bottom of the window out to the horizon; every cell gets the ground it shows, which way that
 * ground faces (for the light, which the renderer brings: the moon low on the right, or the sun
 * high on the left), how far off it is (for the haze, and so a nearer dune hides what walks behind
 * it), and whether it is a crest against what lies beyond (the sand blows off those).
 *
 * The land is laid in its own units, from a fixed seed: a window shows the same dunes each time,
 * and a wider one more of them to each side.
 */
import type { Grid } from "../grid";
import { clamp, noise1, seeded } from "../num";

/** How high the eye is over the sand, and how near and far the land runs (the land's units). */
const EYE = 1;
const NEAR = 2;
export const FAR = 70;
/** How far down the window the horizon is. */
export const HORIZON = 0.47;

/** One ridge: how far off (z), how it snakes (its crest's z along x), how high it stands. */
interface Ridge {
  z: number;
  bend: number;
  bendRate: number;
  phase: number;
  phase2: number;
  height: number;
  heightRate: number;
  /** How long its gentle face toward us is, and its steep slip face behind. */
  face: number;
  slip: number;
  seed: number;
}

export interface DesertLayout {
  grid: Grid;
  /** The horizon's row, and the screen's projection: px from the window's middle per unit of land
   *  at distance 1, and the horizon's y in px. */
  horizon: number;
  focal: number;
  horizonY: number;
  /** Per cell: how far off the ground it shows is (Infinity for sky), which way that ground faces
   *  (a unit vector: x right, y up, z toward us), how far up a ripple it is (-1 to 1), and whether
   *  it is a crest against what lies beyond; and how high up its dune it is (0 in the trough, 1 at
   *  the crest). */
  depth: Float32Array;
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  ripple: Float32Array;
  crest: Uint8Array;
  rise: Float32Array;
  /** Per column, the first row of sand. */
  skyline: Int16Array;
  /** The crest cells near enough for the sand off them to show, as cell indices. */
  blowing: Int32Array;
  ridges: Ridge[];
  /** Which ridge the caravan walks. */
  route: number;
}

/** The ridges, near to far, from a fixed seed: each a little further than the last, its face toward
 *  us reaching back nearly to the one before, standing higher the further it is, so the far ones
 *  still show over the near. */
function ridgesOf(seed: number): Ridge[] {
  const r = seeded(seed);
  const out: Ridge[] = [];
  for (let z = NEAR * 1.5; z < FAR * 0.95; ) {
    const gap = z * (0.42 + 0.22 * r());
    const face = gap * (0.85 + 0.25 * r());
    out.push({
      z, bend: face * (0.5 + 0.35 * r()), bendRate: (1.1 + 0.8 * r()) / face, phase: r() * 6.28, phase2: r() * 6.28,
      height: (0.25 + 0.035 * z) * (0.7 + 0.6 * r()), heightRate: (0.5 + 0.4 * r()) / face, face, slip: 0.3 + 0.12 * r(), seed: Math.floor(r() * 1e6),
    });
    z += gap;
  }
  return out;
}

/** How high the sand is at (x, z), and how far along a ripple (for the faces toward us). */
function heightAt(ridges: Ridge[], x: number, z: number) {
  let h = 0.02 * Math.sin(x * 0.7 + z * 0.9);
  let ripple = 0;
  let rise = 0;
  for (const d of ridges) {
    const crestZ = d.z + d.bend * (Math.sin(x * d.bendRate + d.phase) + 0.45 * Math.sin(x * d.bendRate * 2.3 + d.phase2));
    const u = z - crestZ;
    if (u < -d.face || u > d.slip * d.face) continue;
    const H = d.height * (0.45 + 0.55 * noise1(x * d.heightRate + 3.1, d.seed));
    // Toward us, a long smooth face; behind the crest, the slip face falls away steeply.
    const v = u <= 0 ? H * (1 - (u / d.face) ** 2) : H * (1 - u / (d.slip * d.face)) ** 1.25;
    if (v > h) {
      h = v;
      rise = v / H;
      ripple = u <= 0 ? Math.sin((u / d.face) * 30 + Math.sin((x / d.face) * 2.1 + d.phase) * 1.8) * clamp((-u / d.face) * 4, 0, 1) * clamp((1 + u / d.face) * 2, 0, 1) : 0;
    }
  }
  return { h, ripple, rise };
}

export function desertOf(grid: Grid, seed: number): DesertLayout {
  const { cols, rows, cw, ch } = grid;
  const W = cols * cw;
  const H = rows * ch;
  const horizonY = H * HORIZON;
  const focal = ((H - horizonY) * NEAR) / EYE;
  const ridges = ridgesOf(seed);
  const n = cols * rows;
  const depth = new Float32Array(n).fill(Infinity);
  const nx = new Float32Array(n);
  const ny = new Float32Array(n);
  const nz = new Float32Array(n);
  const ripple = new Float32Array(n);
  const crest = new Uint8Array(n);
  const rise = new Float32Array(n);
  const skyline = new Int16Array(cols).fill(rows);
  // Each column, from the bottom of the window out to the horizon: the nearest ground over each row.
  const at = new Float32Array(n * 2);
  for (let c = 0; c < cols; c++) {
    const sx = (c + 0.5) * cw - W / 2;
    let bottom = rows;
    for (let z = NEAR * 0.3; z < FAR; z *= 1.006) {
      const x = (sx * z) / focal;
      const { h } = heightAt(ridges, x, z);
      const y = horizonY + ((EYE - h) * focal) / z;
      const row = Math.max(0, Math.floor(y / ch + 0.5));
      if (row >= bottom) continue;
      for (let r = row; r < bottom; r++) {
        const i = r * cols + c;
        depth[i] = z;
        at[i * 2] = x;
        at[i * 2 + 1] = z;
      }
      bottom = row;
    }
    skyline[c] = bottom;
  }
  // Which way each cell's ground faces, its ripples, and its crests.
  for (let i = 0; i < n; i++) {
    if (depth[i] === Infinity) continue;
    const x = at[i * 2]!;
    const z = at[i * 2 + 1]!;
    const e = 0.004 * z;
    const here = heightAt(ridges, x, z);
    const dx = (heightAt(ridges, x + e, z).h - heightAt(ridges, x - e, z).h) / (2 * e);
    const dz = (heightAt(ridges, x, z + e).h - heightAt(ridges, x, z - e).h) / (2 * e);
    // The normal of the ground: up, leaning against its slope (z away from us; nz toward us).
    const len = Math.hypot(dx, 1, dz);
    nx[i] = -dx / len;
    ny[i] = 1 / len;
    nz[i] = dz / len;
    ripple[i] = here.ripple;
    rise[i] = here.rise;
    // A crest: the ground just above it on screen lies well beyond it, further than the next row of
    // a smooth slope would (which is far, near the horizon).
    const above = i - cols;
    if (above < 0 || depth[above]! - z > Math.max(0.3 * z, (3 * z * z * ch) / focal)) crest[i] = 1;
  }
  // The sand blows off the crests' high points, near enough to show: each the highest of its crest
  // for a few columns either way.
  const blowing: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!crest[i] || depth[i]! > FAR * 0.4 || Math.floor(i / cols) >= rows - 2) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    let peak = true;
    for (let k = -7; k <= 7 && peak; k++) {
      if (!k || c + k < 0 || c + k >= cols) continue;
      for (let up = 1; up <= 3; up++) if (r - up >= 0 && crest[(r - up) * cols + c + k] && Math.abs(depth[(r - up) * cols + c + k]! - depth[i]!) < depth[i]! * 0.25) peak = false;
    }
    if (peak) blowing.push(i);
  }
  // The caravan walks a ridge some way off, whose crest shows over most of the window.
  let route = 0;
  let best = -1;
  for (let k = 0; k < ridges.length; k++) {
    const d = ridges[k]!;
    if (d.z < FAR * 0.12 || d.z > FAR * 0.4) continue;
    let shown = 0;
    for (let c = 0; c < cols; c += 3) {
      const p = crestAt({ ridges, focal, horizonY, grid }, k, (((c + 0.5) * cw - W / 2) * d.z) / focal);
      const pc = Math.floor(p.x / cw);
      const i = Math.floor(p.y / ch) * cols + pc;
      if (pc >= 0 && pc < cols && i >= 0 && i < n && depth[i]! >= p.z * 0.97) shown++;
    }
    if (shown > best) {
      best = shown;
      route = k;
    }
  }
  return { grid, horizon: Math.floor(horizonY / ch), focal, horizonY, depth, nx, ny, nz, ripple, crest, rise, skyline, blowing: Int32Array.from(blowing), ridges, route };
}

/** Where ridge `k`'s crest is at `x` along the land: how far off, and where that shows on screen
 *  (x, y in px). */
export function crestAt(layout: Pick<DesertLayout, "ridges" | "focal" | "horizonY" | "grid">, k: number, x: number) {
  const d = layout.ridges[k]!;
  const z = d.z + d.bend * (Math.sin(x * d.bendRate + d.phase) + 0.45 * Math.sin(x * d.bendRate * 2.3 + d.phase2));
  const h = d.height * (0.45 + 0.55 * noise1(x * d.heightRate + 3.1, d.seed));
  const W = layout.grid.cols * layout.grid.cw;
  return { x: W / 2 + (x * layout.focal) / z, y: layout.horizonY + ((EYE - h) * layout.focal) / z, z };
}

/** How far along the land a point `sx` px across the window is, at distance `z`. */
export const landX = (layout: Pick<DesertLayout, "focal" | "grid">, sx: number, z: number) => ((sx - (layout.grid.cols * layout.grid.cw) / 2) * z) / layout.focal;
