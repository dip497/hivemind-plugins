/**
 * Snowfall's colours: the picture's, which the character pass draws through (chars.ts). At night (a
 * dark theme): a deep blue sky, a moon over the peaks lighting their faces toward it, mist in the
 * valley, dark forest, the village's dark wood and its white church, roofs under blue-white snow,
 * warm windows and lanterns. By day (a light theme): a clear blue sky and a low sun, white peaks with
 * blue shade, green-black forest, white snow with blue shadows, dark wood houses under white roofs,
 * sharp dark pines.
 *
 * Everything above the village (the sky, the peaks, the hills) is the ground the panels sit over:
 * tests/weather.test.ts checks their text over the brightest of it as the pass draws it.
 */
import type { CharLook } from "../chars";
import type { Oklch } from "../colour";

/** Something lit on its face toward the light, and in shade on the other. */
type Faces = { lit: Oklch; shade: Oklch };

export interface SnowPalette {
  chars: CharLook;
  /** The sky, top to the peaks' feet. */
  sky: Oklch[];
  /** The moon (by night) or the sun (by day): its disc, its glow (alpha), where it is (shares of the
   *  window). Its light falls from the right. */
  light: { disc: Oklch; glow: Oklch; alpha: number; x: number; y: number };
  /** The peaks: their snow and their rock, and the haze the farthest are lost in. */
  snowcap: Faces;
  rock: Faces;
  haze: Oklch;
  mist: { colour: Oklch; alpha: number };
  /** The forest on the hills: the far line and the near. */
  forest: [Oklch, Oklch];
  /** The snow: the slope at its top and at the bottom of the window, the drifts' crests, the
   *  shadows on it, the path trodden in it. */
  snow: [Oklch, Oklch];
  crest: Oklch;
  shade: { colour: Oklch; alpha: number };
  path: Oklch;
  /** A lantern's flame, and its light on the snow round it (alpha). */
  lantern: Oklch;
  pool: { colour: Oklch; alpha: number };
  /** Houses: their wood (the gable toward us, the long wall), the church's stone, the roofs' trim
   *  and their snow, the chimneys. */
  wood: [Oklch, Faces];
  stone: [Oklch, Faces];
  trim: Oklch;
  roof: Faces;
  chimney: Oklch;
  /** A window lit, its glow (alpha), a window dark. */
  lit: Oklch;
  glow: { colour: Oklch; alpha: number };
  dark: Oklch;
  /** Pines: their branches toward the light and away, and the snow on them. */
  pine: Faces;
  pineSnow: Oklch;
  smoke: { colour: Oklch; alpha: number };
  /** The flakes: far, among the houses, near. */
  flake: [Oklch, Oklch, Oklch];
}

const dark: SnowPalette = {
  chars: { under: 0.72, wash: 0, over: 1.35, bloom: 0.45, floor: 0.17, full: 0.5, dots: 0.5, ink: false, edge: 0.1 },
  sky: [[0.13, 0.045, 268], [0.16, 0.05, 262], [0.2, 0.055, 255], [0.26, 0.05, 245]],
  light: { disc: [0.95, 0.03, 95], glow: [0.6, 0.05, 250], alpha: 0.32, x: 0.8, y: 0.15 },
  snowcap: { lit: [0.62, 0.04, 250], shade: [0.34, 0.05, 262] },
  rock: { lit: [0.3, 0.035, 262], shade: [0.2, 0.035, 270] },
  haze: [0.27, 0.05, 250],
  mist: { colour: [0.34, 0.045, 250], alpha: 0.5 },
  forest: [[0.17, 0.035, 235], [0.12, 0.03, 220]],
  snow: [[0.42, 0.045, 250], [0.3, 0.05, 256]],
  crest: [0.52, 0.04, 248],
  shade: { colour: [0.16, 0.06, 262], alpha: 0.45 },
  path: [0.3, 0.05, 258],
  lantern: [0.92, 0.13, 82],
  pool: { colour: [0.68, 0.15, 65], alpha: 0.42 },
  wood: [[0.27, 0.05, 45], { lit: [0.33, 0.055, 50], shade: [0.2, 0.04, 40] }],
  stone: [[0.5, 0.02, 250], { lit: [0.6, 0.025, 250], shade: [0.36, 0.035, 260] }],
  trim: [0.14, 0.03, 30],
  roof: { lit: [0.66, 0.035, 250], shade: [0.46, 0.045, 255] },
  chimney: [0.24, 0.03, 30],
  lit: [0.88, 0.15, 78],
  glow: { colour: [0.7, 0.15, 65], alpha: 0.55 },
  dark: [0.13, 0.03, 260],
  pine: { lit: [0.2, 0.04, 190], shade: [0.13, 0.035, 200] },
  pineSnow: [0.6, 0.035, 250],
  smoke: { colour: [0.42, 0.02, 260], alpha: 0.5 },
  flake: [[0.5, 0.02, 255], [0.75, 0.02, 250], [0.93, 0.01, 250]],
};

const light: SnowPalette = {
  chars: { under: 1, wash: 0, over: 0.62, bloom: 0.05, floor: 0.5, full: 0.45, dots: 1, ink: true, edge: 0.12 },
  sky: [[0.64, 0.1, 250], [0.72, 0.085, 245], [0.81, 0.06, 238], [0.89, 0.035, 230]],
  light: { disc: [0.995, 0.02, 95], glow: [0.98, 0.04, 90], alpha: 0.55, x: 0.78, y: 0.13 },
  snowcap: { lit: [0.985, 0.006, 240], shade: [0.8, 0.045, 255] },
  rock: { lit: [0.6, 0.035, 255], shade: [0.47, 0.045, 262] },
  haze: [0.86, 0.035, 235],
  mist: { colour: [0.93, 0.02, 235], alpha: 0.5 },
  forest: [[0.52, 0.05, 210], [0.38, 0.05, 195]],
  snow: [[0.97, 0.008, 240], [0.92, 0.02, 245]],
  crest: [0.995, 0.004, 240],
  shade: { colour: [0.74, 0.07, 255], alpha: 0.55 },
  path: [0.86, 0.035, 250],
  lantern: [0.85, 0.12, 80],
  pool: { colour: [0.9, 0.08, 80], alpha: 0 },
  wood: [[0.38, 0.07, 45], { lit: [0.45, 0.08, 50], shade: [0.3, 0.06, 40] }],
  stone: [[0.93, 0.012, 80], { lit: [0.97, 0.01, 85], shade: [0.78, 0.03, 250] }],
  trim: [0.25, 0.04, 30],
  roof: { lit: [0.99, 0.004, 240], shade: [0.84, 0.035, 250] },
  chimney: [0.42, 0.04, 30],
  lit: [0.78, 0.13, 75],
  glow: { colour: [0.9, 0.1, 75], alpha: 0.15 },
  dark: [0.3, 0.04, 250],
  pine: { lit: [0.4, 0.06, 170], shade: [0.3, 0.06, 180] },
  pineSnow: [0.97, 0.006, 240],
  smoke: { colour: [0.8, 0.01, 250], alpha: 0.45 },
  flake: [[0.9, 0.01, 245], [0.95, 0.01, 245], [0.99, 0.005, 245]],
};

export const SNOW_PALETTE = { dark, light };
