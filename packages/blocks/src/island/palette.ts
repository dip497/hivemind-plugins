/**
 * Block Island's colours, in OKLCH: a pale morning on a light theme, a deep night on a dark one.
 *
 * Everything large (the sky, every face of the island's blocks, the clouds) keeps to a band of
 * lightness the app's frosted panels read over: by day light enough for their dark text, by night
 * dark enough for their light text (tests/blocks.test.ts measures it). Only small things leave the
 * band: the animals' faces, the flowers, a lit window, a lantern, the stars.
 */
import type { Oklch } from "../colour";

/** A block's three faces: its top, the side toward the screen's left, the side toward its right. */
export interface Shades {
  top: Oklch;
  left: Oklch;
  right: Oklch;
}

export interface IslandPalette {
  /** The sky, top to bottom. */
  sky: Oklch[];
  /** The sun by day, the moon by night: its disc, and the glow round it at its strongest. */
  orb: { disc: Oklch; glow: Oklch; alpha: number };
  /** Stars, by night. */
  stars: Oklch | null;
  grass: Shades;
  grassSpeck: Oklch;
  dirt: Shades;
  dirtSpeck: Oklch;
  stone: Shades;
  stoneSpeck: Oklch;
  sand: Shades;
  water: Shades;
  waterGlint: Oklch;
  wood: Shades;
  leaves: Shades;
  leavesSpeck: Oklch;
  plank: Shades;
  roof: Shades;
  /** A window's pane, and its light by night (null by day). */
  glass: Oklch;
  light: Oklch | null;
  door: Oklch;
  cloud: Shades;
  /** What the far islands fade into. */
  haze: Oklch;
  wool: Shades;
  face: Oklch;
  hen: Shades;
  comb: Oklch;
  beak: Oklch;
  flowers: Oklch[];
  /** The falling water's streaks and its foam. */
  fall: Oklch;
  foam: Oklch;
}

/** The three faces of a colour: the top lit, the left a little darker, the right in shade and a
 *  touch cooler, as the sky lights what the sun does not. */
const faces = (l: number, c: number, h: number, step: number): Shades => ({
  top: [l, c, h],
  left: [l - step, c * 0.95, h],
  right: [l - step * 2, c * 0.9, h + 8],
});

export const ISLAND_PALETTE: { light: IslandPalette; dark: IslandPalette } = {
  light: {
    sky: [[0.82, 0.075, 238], [0.88, 0.055, 232], [0.93, 0.035, 222]],
    orb: { disc: [0.985, 0.07, 98], glow: [0.995, 0.025, 95], alpha: 0.6 },
    stars: null,
    grass: faces(0.91, 0.12, 132, 0.05),
    grassSpeck: [0.85, 0.13, 138],
    dirt: faces(0.88, 0.05, 68, 0.035),
    dirtSpeck: [0.8, 0.055, 60],
    stone: faces(0.88, 0.012, 255, 0.035),
    stoneSpeck: [0.8, 0.012, 255],
    sand: faces(0.93, 0.05, 92, 0.03),
    water: faces(0.87, 0.07, 222, 0.03),
    waterGlint: [0.99, 0.02, 220],
    wood: faces(0.88, 0.045, 62, 0.03),
    leaves: faces(0.91, 0.11, 145, 0.05),
    leavesSpeck: [0.8, 0.11, 150],
    plank: faces(0.9, 0.05, 75, 0.03),
    roof: faces(0.88, 0.08, 30, 0.035),
    glass: [0.88, 0.04, 230],
    light: null,
    door: [0.66, 0.06, 55],
    cloud: faces(0.985, 0.006, 240, 0.02),
    haze: [0.9, 0.04, 228],
    wool: faces(0.98, 0.008, 90, 0.035),
    face: [0.42, 0.02, 60],
    hen: faces(0.97, 0.012, 85, 0.035),
    comb: [0.6, 0.2, 28],
    beak: [0.8, 0.15, 75],
    flowers: [[0.72, 0.17, 25], [0.88, 0.16, 95], [0.7, 0.13, 300], [0.97, 0.02, 90]],
    fall: [0.93, 0.05, 222],
    foam: [0.99, 0.01, 220],
  },
  dark: {
    sky: [[0.15, 0.045, 272], [0.2, 0.055, 280], [0.27, 0.06, 292]],
    orb: { disc: [0.93, 0.035, 95], glow: [0.55, 0.06, 270], alpha: 0.35 },
    stars: [0.92, 0.02, 95],
    grass: faces(0.39, 0.075, 150, 0.035),
    grassSpeck: [0.37, 0.075, 155],
    dirt: faces(0.37, 0.04, 55, 0.035),
    dirtSpeck: [0.32, 0.04, 50],
    stone: faces(0.38, 0.012, 265, 0.035),
    stoneSpeck: [0.33, 0.012, 265],
    sand: faces(0.39, 0.04, 85, 0.035),
    water: faces(0.38, 0.065, 245, 0.03),
    waterGlint: [0.82, 0.05, 240],
    wood: faces(0.36, 0.04, 55, 0.035),
    leaves: faces(0.38, 0.075, 155, 0.045),
    leavesSpeck: [0.33, 0.075, 160],
    plank: faces(0.38, 0.04, 70, 0.035),
    roof: faces(0.36, 0.07, 28, 0.035),
    glass: [0.82, 0.13, 80],
    light: [0.86, 0.14, 78],
    door: [0.28, 0.04, 50],
    cloud: faces(0.38, 0.03, 275, 0.03),
    haze: [0.24, 0.055, 285],
    wool: faces(0.78, 0.02, 270, 0.06),
    face: [0.25, 0.02, 270],
    hen: faces(0.74, 0.025, 80, 0.06),
    comb: [0.5, 0.16, 28],
    beak: [0.66, 0.12, 75],
    flowers: [[0.55, 0.14, 25], [0.7, 0.12, 95], [0.55, 0.11, 300], [0.8, 0.02, 270]],
    fall: [0.5, 0.06, 240],
    foam: [0.7, 0.04, 240],
  },
};
