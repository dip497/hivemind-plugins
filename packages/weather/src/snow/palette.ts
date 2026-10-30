/**
 * Snowfall's colours. At dusk (a dark theme): a deep blue sky with the last of the light rose-violet
 * behind the peaks, the snow on them pale blue in the twilight, dark forested hills, the village's
 * walls and roofs dark wood, its windows warm, and the snow blue-white. By day (a light theme): a
 * bright cold sky, the peaks white and the hills pale in the falling snow, the village's wood and
 * pines dark against the white, the windows cold glass.
 *
 * Everything above the village (the sky, the peaks, the hills, the fields) is the ground the panels
 * sit over: it is kept dark enough at dusk, light enough by day, for their text (tests/weather.test.ts).
 */
import type { Oklch } from "../colour";
import type { SkyLook } from "../sky";

export interface SnowPalette extends SkyLook {
  /** The far peaks: snow on the sunward side and the shaded side, rock likewise, and the
   *  characters on them (their ridge, their texture). */
  peakSnow: [Oklch, Oklch];
  peakRock: [Oklch, Oklch];
  peakInk: Oklch;
  /** The forested hills: the forest, its trees' characters, snow in clearings. */
  hills: [Oklch, Oklch, Oklch];
  /** The snow on the fields and the ground, top to deep, and its sparkle. */
  snow: [Oklch, Oklch, Oklch];
  sparkle: Oklch;
  /** Snow lying on the roofs and the branches, in the village low on the screen. */
  ledge: Oklch;
  /** Houses: walls and their grain, roofs and their edges, the chimneys, the doors. */
  wall: [Oklch, Oklch];
  roof: [Oklch, Oklch];
  chimney: Oklch;
  door: Oklch;
  /** A window lit and its glow on the snow (alpha), and a window dark; each with its cross. */
  lit: [Oklch, Oklch];
  litGlow: { colour: Oklch; alpha: number } | null;
  dark: [Oklch, Oklch];
  /** Pines: the crown, its characters, the trunk. */
  pine: [Oklch, Oklch, Oklch];
  smoke: { colour: Oklch; alpha: number };
  /** The flakes far, among the houses and near; and a near flake's edge, for a light sky. */
  flake: [Oklch, Oklch, Oklch];
  flakeEdge: Oklch | null;
  /** Light adds to the dark; on a light ground it tints. */
  add: boolean;
}

const dark: SnowPalette = {
  sky: [[0.16, 0.05, 262], [0.2, 0.055, 272], [0.27, 0.06, 300], [0.31, 0.06, 335]],
  glow: { colour: [0.42, 0.09, 335], alpha: 0.28, x: 0.68, y: 0.48, r: 0.5 },
  grid: { colour: [1, 0, 0], alpha: 0.025 },
  peakSnow: [[0.42, 0.035, 270], [0.33, 0.04, 265]],
  peakRock: [[0.27, 0.035, 280], [0.21, 0.035, 270]],
  peakInk: [0.52, 0.04, 270],
  hills: [[0.19, 0.035, 230], [0.27, 0.045, 195], [0.33, 0.03, 250]],
  snow: [[0.44, 0.035, 255], [0.39, 0.04, 258], [0.34, 0.045, 262]],
  sparkle: [0.78, 0.03, 250],
  ledge: [0.66, 0.03, 255],
  wall: [[0.3, 0.045, 45], [0.37, 0.05, 50]],
  roof: [[0.24, 0.04, 25], [0.33, 0.045, 30]],
  chimney: [0.32, 0.03, 30],
  door: [0.22, 0.04, 40],
  lit: [[0.82, 0.14, 75], [0.55, 0.12, 55]],
  litGlow: { colour: [0.62, 0.13, 70], alpha: 0.5 },
  dark: [[0.2, 0.03, 260], [0.32, 0.03, 260]],
  pine: [[0.24, 0.045, 175], [0.34, 0.06, 165], [0.26, 0.04, 40]],
  smoke: { colour: [0.6, 0.02, 270], alpha: 0.8 },
  flake: [[0.5, 0.025, 260], [0.8, 0.02, 250], [0.94, 0.012, 250]],
  flakeEdge: null,
  add: true,
};

const light: SnowPalette = {
  sky: [[0.84, 0.045, 240], [0.88, 0.035, 236], [0.92, 0.022, 232], [0.95, 0.012, 230]],
  glow: { colour: [1, 0, 0], alpha: 0.45, x: 0.28, y: 0.12, r: 0.5 },
  grid: { colour: [0.35, 0.04, 245], alpha: 0.035 },
  peakSnow: [[0.98, 0.006, 240], [0.9, 0.02, 245]],
  peakRock: [[0.82, 0.025, 250], [0.79, 0.03, 250]],
  peakInk: [0.68, 0.035, 250],
  hills: [[0.79, 0.03, 205], [0.68, 0.045, 190], [0.92, 0.012, 240]],
  snow: [[0.985, 0.005, 240], [0.95, 0.012, 242], [0.91, 0.02, 245]],
  sparkle: [0.75, 0.04, 245],
  ledge: [0.995, 0.004, 240],
  wall: [[0.46, 0.07, 45], [0.56, 0.07, 55]],
  roof: [[0.38, 0.06, 25], [0.48, 0.06, 30]],
  chimney: [0.45, 0.04, 30],
  door: [0.32, 0.05, 40],
  lit: [[0.82, 0.12, 80], [0.6, 0.1, 60]],
  litGlow: null,
  dark: [[0.5, 0.035, 240], [0.82, 0.02, 240]],
  pine: [[0.37, 0.06, 170], [0.48, 0.07, 160], [0.38, 0.05, 40]],
  smoke: { colour: [0.6, 0.012, 250], alpha: 0.6 },
  flake: [[0.8, 0.025, 245], [0.66, 0.03, 245], [0.995, 0.003, 240]],
  flakeEdge: [0.6, 0.035, 245],
  add: false,
};

export const SNOW_PALETTE = { dark, light };
