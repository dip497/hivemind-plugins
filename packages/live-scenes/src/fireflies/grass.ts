/**
 * Fireflies' meadow along the bottom of the window, in layers, from a fixed seed, so a window shows
 * the same meadow each time: a turf of thick grass along the very bottom; far back over it, short
 * grass, pale and nearly still; then tufts of blades fanning out from their roots; and in front the
 * tall grass, darker, blades of all heights and leans, some with a leaf or two off the stem and
 * many gone to seed, the tallest reaching a fifth to a quarter of the way up the window; and a few
 * seed stalks over it all. Each blade sways on its own (blades.ts), a clump nearly in step, its
 * neighbours out of it, and parts a little where a firefly settles in it.
 */
import type { Blade } from "../blades";
import { prng } from "../math";

/** Which layer a blade stands in, back to front: the far grass, the middle tufts, the near grass,
 *  and the seed stalks over it. */
export type GrassLayer = 0 | 1 | 2 | 3;

/** A blade of the meadow: its layer; the character it stands up in, and its tip's; how many cells
 *  of its top are a seed head, and the characters they are drawn in; and its leaves, each how far
 *  up it and to which side it springs. */
export interface GrassBlade extends Blade {
  layer: GrassLayer;
  /** Which of its layer's shades it is drawn in (0 to 2), so a clump is not all one green. */
  tone: number;
  stem: string;
  top: string;
  seed: number;
  head: string;
  leaves: { k: number; side: 1 | -1 }[];
}

const FAR_STEMS = ":|;";
const FAR_TOPS = "',`.\"";
const NEAR_TOPS = "',`^";
/** Seed heads, from the top down: a foxtail's bristles, an oat's spikelets, a seeding grass's
 *  plume. */
const HEADS = ["%:", ";:", ":'", "*:", "%'"];
/** The turf's texture on its blocks, a character on some of them. */
const TURF = "\"',;:.    ";

/** A meadow: its blades, back to front, and its turf, the thick grass along the very bottom, as
 *  many rows deep as `turf` says in each column, with the character on each of its cells. */
export interface Meadowland {
  blades: GrassBlade[];
  turf: Uint8Array;
  texture: string[];
}

/** The meadow for a grid of `cols` by `rows`. */
export function meadowOf(cols: number, rows: number): Meadowland {
  const rnd = prng(0xf1e1d + cols * 31 + rows);
  const pick = (s: string) => s[Math.floor(rnd() * s.length)]!;
  const bottom = rows - 1;
  const blades: GrassBlade[] = [];
  const a = rnd() * 9;
  const b = rnd() * 9;
  // How tall the meadow stands along it: it swells and dips, slowly.
  const swell = (c: number) => 0.5 + 0.3 * Math.sin(c * 0.045 + b) + 0.2 * Math.sin(c * 0.13 + a);
  // The tallest near grass: a fifth of the window, a quarter where the meadow swells.
  const tallest = Math.max(7, Math.round(rows * 0.22));
  // The turf: two to four rows of thick grass, deeper where the meadow swells.
  const turf = Uint8Array.from({ length: cols }, (_, c) => Math.max(1, Math.round(1.5 + 2.2 * swell(c) + rnd() * 0.6)));
  const texture = Array.from({ length: cols * 4 }, () => pick(TURF));
  const blade = (c: number, foot: number, height: number, layer: GrassLayer, o: Partial<GrassBlade>) =>
    blades.push({ c, foot, height, reach: 0.5, rate: 0.5, wave: 0.2, phase: 0, layer, tone: Math.floor(rnd() * 3), stem: "|", top: "'", seed: 0, head: "", leaves: [], ...o });

  // Far back, over the turf: short blades in nearly every column, rising and falling slowly along
  // the meadow, swaying hardly at all, a long slow wave along it.
  for (let c = 0; c < cols; c++) {
    if (rnd() < 0.35) continue;
    const height = Math.max(1, Math.round(1 + Math.sin(c * 0.06 + a) + 1.6 * swell(c) + rnd()));
    blade(c, bottom - turf[c]!, height, 0, { reach: 0.4, rate: 0.4 + rnd() * 0.1, phase: c * 0.11 + rnd() * 0.4, stem: pick(FAR_STEMS), top: pick(FAR_TOPS) });
  }
  // The middle: tufts of three blades fanning out from one root, up to half the near grass's
  // height, the clumps swaying out of step with each other.
  for (let c = 1; c < cols - 1; c += 2 + Math.floor(rnd() * 3)) {
    if (rnd() > 0.35 + 0.4 * swell(c)) continue;
    const height = Math.max(3, Math.round(tallest * 0.55 * (0.5 + 0.5 * swell(c)) * (0.6 + 0.4 * rnd())));
    const phase = rnd() * Math.PI * 2;
    const rate = 0.5 + rnd() * 0.15;
    for (const side of [-1, 0, 1]) {
      const h = Math.max(2, Math.round(height * (side ? 0.6 + 0.25 * rnd() : 1)));
      blade(c, bottom - Math.max(0, turf[c]! - 1), h, 1, { reach: 0.6 + h * 0.05, rate, wave: 0.2, phase: phase + side * 0.3, slant: side * h * 0.45 + (rnd() - 0.5), top: side ? "'" : pick(FAR_TOPS), seed: !side && rnd() < 0.25 ? 1 : 0, head: ";" });
    }
  }
  // In front: the tall grass in clumps, taller where the meadow swells, blades of all heights and
  // leans, each clump swaying nearly in step; a leaf or two off the taller stems, and many gone to
  // seed.
  for (let c = 0; c < cols; c++) {
    if (rnd() > 0.3 + 0.45 * swell(c)) continue;
    const height = Math.max(4, Math.round(tallest * (0.35 + 0.65 * swell(c)) * (0.45 + 0.55 * rnd())));
    const clump = Math.floor(c / 5);
    const seed = rnd() < 0.42 ? 2 : 0;
    const leaves: GrassBlade["leaves"] = [];
    if (height >= 6) leaves.push({ k: Math.round(height * (0.25 + 0.15 * rnd())), side: rnd() < 0.5 ? 1 : -1 });
    if (height >= 10 && rnd() < 0.6) leaves.push({ k: Math.round(height * (0.5 + 0.15 * rnd())), side: leaves[0]!.side === 1 ? -1 : 1 });
    blade(c, bottom, height, 2, {
      reach: 0.8 + height * 0.06, rate: 0.55 + (clump % 3) * 0.08, wave: 0.18, phase: clump * 1.3 + rnd() * 0.5,
      slant: (rnd() - 0.5) * height * 0.3, top: pick(NEAR_TOPS), seed, head: HEADS[Math.floor(rnd() * HEADS.length)]!, leaves,
    });
  }
  // Seed stalks over it all, a few, as tall as the tallest grass, a long head at the top of each.
  for (let n = Math.max(3, Math.round(cols / 20)); n > 0; n--) {
    const height = Math.round(tallest * (0.9 + 0.2 * rnd()));
    blade(Math.floor(rnd() * cols), bottom, height, 3, {
      reach: 1.8, rate: 0.45 + rnd() * 0.2, wave: 0.12, phase: rnd() * Math.PI * 2, slant: (rnd() < 0.5 ? -1 : 1) * height * (0.15 + 0.2 * rnd()), seed: 3,
      head: "*%:", leaves: [{ k: Math.round(height * 0.3), side: rnd() < 0.5 ? 1 : -1 }],
    });
  }
  return { blades, turf, texture };
}
