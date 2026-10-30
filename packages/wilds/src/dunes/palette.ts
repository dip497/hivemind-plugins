/**
 * Dunes' colours. At night (a dark theme) cool blue-silver dunes under a huge moon low over the
 * horizon on the right, the faces toward it lit and the others in deep blue shadow, stars over it
 * all. By day (a light theme) hot gold dunes under a pale sky, the sun high on the left, a mirage
 * shimmering far off. Under the characters the picture is dimmed by night; the sky and the sand
 * stay dark (or light) enough for the frosted panels' text over them (tests/wilds.test.ts).
 */
import type { Oklch } from "../colour";
import type { SkyLook } from "../sky";

export interface DunesPalette extends SkyLook {
  /** The face the light falls on: at the crest, and at the foot; the face in shadow: under the
   *  crest, and low down where light comes back off the sand. */
  lit: Oklch;
  litFoot: Oklch;
  shade: Oklch;
  shadeFoot: Oklch;
  /** Where the light comes from: -1 the left, 1 the right. */
  from: -1 | 1;
  /** How far toward the sky's colour the furthest range is hazed. */
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
  sky: [[0.15, 0.04, 268], [0.2, 0.05, 262], [0.29, 0.055, 252], [0.36, 0.05, 245], [0.3, 0.04, 245]],
  glow: { colour: [0.75, 0.05, 240], alpha: 0.4, x: 0.4, y: 0.42, reach: 0.38 },
  lit: [0.86, 0.06, 225],
  litFoot: [0.6, 0.08, 245],
  shade: [0.3, 0.08, 268],
  shadeFoot: [0.4, 0.08, 260],
  from: -1,
  haze: 0.6,
  grain: [0.93, 0.03, 230],
  caravan: [0.08, 0.02, 265],
  moon: { face: [0.95, 0.03, 95], seas: [0.78, 0.03, 90], size: 0.38 },
  stars: 0.85,
  star: [0.95, 0.02, 230],
  mirage: null,
};

const light: DunesPalette = {
  sky: [[0.83, 0.06, 238], [0.88, 0.05, 228], [0.93, 0.035, 210], [0.95, 0.04, 92], [0.93, 0.05, 85]],
  glow: { colour: [1, 0.04, 95], alpha: 0.7, x: 0.2, y: 0.06, reach: 0.45 },
  lit: [0.93, 0.11, 90],
  litFoot: [0.86, 0.13, 80],
  shade: [0.72, 0.13, 56],
  shadeFoot: [0.77, 0.12, 64],
  from: -1,
  haze: 0.55,
  grain: [0.62, 0.11, 62],
  caravan: [0.3, 0.05, 50],
  moon: null,
  stars: 0,
  star: [0.9, 0.02, 90],
  mirage: [0.9, 0.05, 225],
};

export const DUNES_PALETTE = { dark, light };
