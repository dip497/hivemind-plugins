/**
 * Fireflies' meadow along the bottom of the window, in layers, from a fixed seed, so a window shows
 * the same meadow each time: a turf of thick grass along the very bottom, its top edge rolling;
 * far back on it, short grass, pale and still; then tufts of blades fanning out from their roots;
 * and in front the tall grass in clumps, darker, arching leaves round stems that stand above them,
 * a leaf or two off each stem and most of them gone to seed, the tallest reaching a fifth to a
 * quarter of the way up the window; and a few seed stalks over it all.
 *
 * Every blade is a curve from its root to its tip, laid out in cells but placed between them: its
 * root anywhere along the ground, its height and lean in fractions of a cell. The near grass and the
 * stalks sway (`swayOf`), a clump nearly in step and its neighbours out of it, and the gusts that
 * run along the meadow bend them the same way as they pass; further back the grass holds still.
 */
import type { Blade } from "../blades";
import { prng, TAU } from "../math";

/** Which layer a blade stands in, back to front: the far grass, the middle tufts, the near grass,
 *  and the seed stalks over it. */
export type GrassLayer = 0 | 1 | 2 | 3;

/** A seed head: an ear of spikelets in a herringbone (`spike`), the same with long bristles off
 *  them (`awned`, a barley's), a foxtail's dense bristly spike, an oat's spikelets hanging from
 *  fine stalks, or a seeding grass's soft feathery plume. */
export type HeadKind = "spike" | "awned" | "foxtail" | "oat" | "plume";

/** A leaf off a stem: how far up it, in cells; to which side it springs; and how long it is. */
export interface GrassLeaf {
  k: number;
  side: 1 | -1;
  len: number;
}

/** A blade of the meadow, in cells: where its root stands (`x` across, `y` down: between cells,
 *  not on them), how high it rises (`height`, to its highest point), how far over its tip leans
 *  (`slant`) and falls back (`droop`, a share of its height: a leaf arching over), how wide it is
 *  at its root and its tip, and how many cells of its top are a seed head, and what kind. */
export interface GrassBlade extends Blade {
  layer: GrassLayer;
  /** Which of its layer's shades it is drawn in (0 to 2), so a clump is not all one green. */
  tone: number;
  x: number;
  y: number;
  width: number;
  tip: number;
  droop: number;
  seed: number;
  head: HeadKind | null;
  leaves: GrassLeaf[];
}

/** A meadow: its blades, back to front, and the depth of its turf, in rows up from the bottom of
 *  the grid, at every half cell along it. */
export interface Meadowland {
  blades: GrassBlade[];
  turf: Float32Array;
}

/** The turf's depth at `x` cells along. */
export const turfAt = (turf: Float32Array, x: number) => turf[Math.max(0, Math.min(turf.length - 1, Math.floor(x * 2)))]!;

/** The meadow for a grid of `cols` by `rows`. */
export function meadowOf(cols: number, rows: number): Meadowland {
  const rnd = prng(0xf1e1d + cols * 31 + rows);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const side = (): 1 | -1 => (rnd() < 0.5 ? -1 : 1);
  const blades: GrassBlade[] = [];
  const a = rnd() * 9;
  const b = rnd() * 9;
  // How tall the meadow stands along it: it swells and dips, slowly.
  const swell = (c: number) => 0.5 + 0.3 * Math.sin(c * 0.045 + b) + 0.2 * Math.sin(c * 0.13 + a);
  // The tallest near grass: a fifth of the window, a quarter where the meadow swells.
  const tallest = Math.max(7, Math.round(rows * 0.22));
  // The turf: one and a half to three rows of thick grass, deeper where the meadow swells, its top
  // rolling gently.
  const turf = Float32Array.from({ length: cols * 2 }, (_, i) => {
    const c = i / 2;
    return 1.6 + 1.1 * swell(c) + 0.25 * Math.sin(c * 0.31 + a * 2) + 0.1 * Math.sin(c * 1.3 + b);
  });
  const blade = (o: Partial<GrassBlade> & Pick<GrassBlade, "x" | "y" | "height" | "layer">) => {
    const g: GrassBlade = {
      c: 0, foot: 0, reach: 0, rate: 0.5, wave: 0.15, phase: 0, slant: 0,
      tone: Math.floor(rnd() * 3), width: 0.2, tip: 0, droop: 0, seed: 0, head: null, leaves: [], ...o,
    };
    g.c = Math.floor(g.x);
    g.foot = Math.ceil(g.y) - 1;
    blades.push(g);
  };

  // Far back, on the turf: short fine blades all along it, rising and falling slowly along the
  // meadow, a few gone to seed. They hold still: far off, a breeze barely shows.
  for (let i = 0; i < cols * 2; i++) {
    if (rnd() < 0.2) continue;
    const x = i / 2 + rnd() * 0.5;
    const height = 0.6 + 0.45 * (1 + Math.sin(x * 0.06 + a)) + 1.5 * swell(x) * (0.35 + 0.65 * rnd());
    const seeded = rnd() < 0.1;
    blade({
      layer: 0, x, y: rows - turfAt(turf, x) + 0.35, height: seeded ? height * 1.3 : height,
      width: 0.13 + 0.07 * rnd(), slant: (rnd() - 0.5) * height * 0.6, droop: rnd() < 0.3 ? 0.1 + 0.2 * rnd() : 0,
      seed: seeded ? 0.7 : 0, head: seeded ? pick(["spike", "plume"] as const) : null, tip: seeded ? 0.06 : 0,
    });
  }
  // The middle: tufts of blades fanning out from one root, up to half the near grass's height; now
  // and then a seed stem among them. They hold still, as the far grass does: further off than the
  // near grass, a breeze shows less in them, and they leave the near grass's sway to read.
  for (let c = 1; c < cols - 1; c += 2 + Math.floor(rnd() * 3)) {
    if (rnd() > 0.5 + 0.35 * swell(c)) continue;
    const x = c + rnd();
    const y = rows - turfAt(turf, x) * 0.5 + 0.2;
    const height = Math.max(2.5, tallest * 0.5 * (0.5 + 0.5 * swell(x)) * (0.6 + 0.4 * rnd()));
    const n = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) {
      const out = (j / (n - 1)) * 2 - 1 + (rnd() - 0.5) * 0.3;
      const h = height * (1 - 0.35 * Math.abs(out)) * (0.8 + 0.2 * rnd());
      blade({
        layer: 1, x: x + out * 0.45 + (rnd() - 0.5) * 0.3, y, height: h, slant: out * h * 0.38 + (rnd() - 0.5) * 0.5,
        droop: Math.abs(out) > 0.45 ? 0.12 + 0.25 * rnd() : 0.06 * rnd(), width: 0.17 + 0.08 * rnd(),
      });
    }
    if (rnd() < 0.3) {
      const h = height * (1.1 + 0.2 * rnd());
      blade({
        layer: 1, x, y, height: h, slant: (rnd() - 0.5) * h * 0.25, width: 0.11, tip: 0.06,
        seed: 1, head: pick(["spike", "plume", "oat"] as const),
      });
    }
  }
  // In front: the tall grass in clumps, taller where the meadow swells, each clump swaying nearly
  // in step: arching leaves round a stem or two that stand above them, a leaf or two off the taller
  // stems, most of them gone to seed.
  for (let c = 0; c < cols; c += 2 + Math.floor(rnd() * 2)) {
    if (rnd() > 0.45 + 0.4 * swell(c)) continue;
    const x = c + rnd();
    const y = rows + 0.3;
    const height = Math.max(4, Math.min(tallest * 1.05, tallest * (0.4 + 0.65 * swell(x)) * (0.55 + 0.45 * rnd())));
    const phase = rnd() * TAU;
    const rate = 0.55 + rnd() * 0.2;
    for (let j = 2 + Math.floor(rnd() * 3); j > 0; j--) {
      const spread = rnd();
      const h = height * (0.3 + 0.4 * rnd());
      blade({
        layer: 2, x: x + (rnd() - 0.5) * 0.7, y, height: h, slant: side() * (0.3 + 0.9 * spread) * h * 0.45,
        droop: 0.08 + 0.4 * spread, width: 0.3 + 0.14 * rnd(), reach: 0.2 + h * 0.05, rate, wave: 0.12, phase: phase + rnd() * 0.4,
      });
    }
    for (let j = rnd() < 0.55 ? 2 : 1; j > 0; j--) {
      const h = height * (0.88 + 0.12 * rnd());
      const head = rnd() < 0.9 ? pick(["spike", "awned", "foxtail", "oat", "plume", "spike"] as const) : null;
      const leaves: GrassLeaf[] = [];
      if (h >= 6) leaves.push({ k: h * (0.2 + 0.2 * rnd()), side: side(), len: 1.6 + 1.8 * rnd() });
      if (h >= 10 && rnd() < 0.6) leaves.push({ k: h * (0.45 + 0.15 * rnd()), side: leaves[0]!.side === 1 ? -1 : 1, len: 1.4 + 1.4 * rnd() });
      blade({
        layer: 2, x: x + (rnd() - 0.5) * 0.5, y, height: h, slant: (rnd() - 0.5) * h * 0.28, width: 0.13, tip: 0.07,
        // A foxtail's head nods.
        droop: head === "foxtail" ? 0.04 : 0, seed: head ? 2 + (rnd() < 0.4 ? 1 : 0) : 0, head, leaves,
        reach: 0.5 + h * 0.06, rate, wave: 0.12, phase: phase + rnd() * 0.3,
      });
    }
  }
  // Seed stalks over it all, a few, as tall as the tallest grass, a long head at the top of each.
  for (let n = Math.max(3, Math.round(cols / 20)); n > 0; n--) {
    const height = tallest * (0.9 + 0.2 * rnd());
    blade({
      layer: 3, x: rnd() * cols, y: rows + 0.3, height, slant: side() * height * (0.12 + 0.18 * rnd()), width: 0.12, tip: 0.06,
      reach: 1.6, rate: 0.45 + rnd() * 0.2, wave: 0.1, phase: rnd() * TAU, seed: 3, head: pick(["awned", "plume", "spike"] as const),
      leaves: [{ k: height * 0.3, side: side(), len: 2 + 1.5 * rnd() }],
    });
  }
  return { blades, turf };
}

/** How far over a blade's tip is from where it stands still, in cells, at time `t`: its own sway,
 *  and a gust that runs along the meadow now and then, bending every blade the same way as it
 *  passes. `lag` is how far behind the tip a point lower down is (a wave runs up the blade). */
export function swayOf(b: GrassBlade, t: number, lag = 0) {
  const p = t * b.rate + b.phase - lag;
  const gust = Math.sin(t * 0.21 - b.x * 0.03 - lag * 0.5);
  return b.reach * (0.72 * Math.sin(p) + 0.28 * Math.sin(p * 0.33 + b.phase * 1.67) + 0.55 * (gust > 0 ? gust * gust * gust : 0));
}
