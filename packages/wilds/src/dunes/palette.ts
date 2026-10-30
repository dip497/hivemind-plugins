/**
 * Dunes' colours. At night (a dark theme) cool blue-silver dunes under a huge moon low over the
 * horizon, the faces toward us in its shadow and the crests catching its light, stars over it all.
 * By day (a light theme) hot gold dunes under a pale sky, the sun high on the left, a mirage
 * shimmering far off. The sky and the sand, light and shade, stay dark (or light) enough for the
 * frosted panels' text over them (tests/wilds.test.ts).
 */
import type { Oklch } from "../colour";
import type { SkyLook } from "../sky";

export interface DunesPalette extends SkyLook {
  /** The sand's blocks: in shade, and in full light. */
  shade: Oklch;
  lit: Oklch;
  /** The sand's characters: in shade, and in full light. */
  inkShade: Oklch;
  inkLit: Oklch;
  /** Where the light comes from (x right, y up, z toward us), and how much light there is in the
   *  shade. */
  light: [number, number, number];
  ambient: number;
  /** How far toward the sky's colour the farthest sand is hazed. */
  haze: number;
  /** Sand in the air. */
  grain: Oklch;
  /** The caravan, a silhouette. */
  caravan: Oklch;
  /** The moon (null by day): its face, its seas, and its size as a share of the window's shorter
   *  side; stars (0 for none). */
  moon: { face: Oklch; seas: Oklch; size: number } | null;
  stars: number;
  star: Oklch;
  /** A mirage far off (null at night): the sky's colour lying on the sand. */
  mirage: Oklch | null;
}

const dark: DunesPalette = {
  sky: [[0.14, 0.035, 268], [0.18, 0.045, 262], [0.235, 0.05, 252], [0.3, 0.05, 245], [0.3, 0.04, 245]],
  glow: { colour: [0.62, 0.04, 245], alpha: 0.28, x: 0.7, y: 0.4, reach: 0.42 },
  shade: [0.15, 0.03, 258],
  lit: [0.4, 0.045, 240],
  inkShade: [0.3, 0.04, 255],
  inkLit: [0.8, 0.04, 230],
  light: [0.85, 0.38, -0.3],
  ambient: 0.1,
  haze: 0.55,
  grain: [0.93, 0.025, 230],
  caravan: [0.1, 0.02, 265],
  moon: { face: [0.84, 0.025, 95], seas: [0.66, 0.025, 90], size: 0.36 },
  stars: 0.8,
  star: [0.92, 0.02, 230],
  mirage: null,
};

const light: DunesPalette = {
  sky: [[0.85, 0.055, 238], [0.89, 0.045, 228], [0.93, 0.035, 210], [0.95, 0.04, 92], [0.93, 0.05, 85]],
  glow: { colour: [1, 0.03, 95], alpha: 0.6, x: 0.28, y: 0.04, reach: 0.5 },
  shade: [0.79, 0.09, 62],
  lit: [0.93, 0.1, 88],
  inkShade: [0.56, 0.11, 52],
  inkLit: [0.72, 0.12, 75],
  light: [-0.72, 0.5, 0.42],
  ambient: 0.2,
  haze: 0.5,
  grain: [0.6, 0.11, 62],
  caravan: [0.38, 0.06, 50],
  moon: null,
  stars: 0,
  star: [0.9, 0.02, 90],
  mirage: [0.9, 0.045, 225],
};

export const DUNES_PALETTE = { dark, light };
