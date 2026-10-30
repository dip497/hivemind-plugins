/**
 * Snowfall's colours: the picture's, which the character pass draws through (chars.ts). At night (a
 * dark theme): a deep blue sky, a moon rising over the peaks and lighting their faces toward it,
 * mist in the valley, dark forested hills, the village's wood and its steep roofs under snow, warm
 * windows spilling light onto the snow, blue-white snow. By day (a light theme): a bright cold sky
 * and sun, white peaks and pale hills in the haze of the falling snow, the village's wood and the
 * pines dark against the white, blue shadows.
 *
 * Everything above the village (the sky, the peaks, the hills) is the ground the panels sit over:
 * tests/weather.test.ts checks their text over the brightest of it as the pass draws it.
 */
import type { CharLook } from "../chars";
import type { Oklch } from "../colour";

export interface SnowPalette {
  chars: CharLook;
  /** The sky, top to the peaks' feet. */
  sky: Oklch[];
  /** The moon (by night) or the sun (by day): its disc, its glow (alpha), where it is (shares of the
   *  window), and which way its light falls on the peaks (1 from the right). */
  light: { disc: Oklch; glow: Oklch; alpha: number; x: number; y: number; from: 1 | -1 };
  /** The peaks' snow lit and shaded, their rock lit and shaded; the mist at their feet. */
  peaks: [Oklch, Oklch, Oklch, Oklch];
  mist: { colour: Oklch; alpha: number };
  /** The forested hills, and their ragged top. */
  hills: [Oklch, Oklch];
  /** The snow: the fields, the ground's top and deep, and the shade under its drifts. */
  snow: [Oklch, Oklch, Oklch];
  shade: { colour: Oklch; alpha: number };
  /** Houses: walls, roofs, the snow on them, the chimneys. */
  wall: Oklch;
  roof: Oklch;
  cap: Oklch;
  chimney: Oklch;
  /** A window lit, its glow (alpha), a window dark. */
  lit: Oklch;
  glow: { colour: Oklch; alpha: number };
  dark: Oklch;
  pine: Oklch;
  smoke: { colour: Oklch; alpha: number };
  /** The flakes: far, among the houses, near. */
  flake: [Oklch, Oklch, Oklch];
}

const dark: SnowPalette = {
  chars: { under: 0.7, wash: 0, over: 1.4, bloom: 0.45, floor: 0.16, full: 0.5, dots: 0.5, ink: false, edge: 0.1 },
  sky: [[0.13, 0.045, 268], [0.16, 0.05, 262], [0.2, 0.055, 255], [0.25, 0.05, 245]],
  light: { disc: [0.95, 0.03, 95], glow: [0.6, 0.05, 250], alpha: 0.5, x: 0.8, y: 0.16, from: 1 },
  peaks: [[0.5, 0.04, 255], [0.3, 0.05, 262], [0.28, 0.035, 270], [0.18, 0.035, 270]],
  mist: { colour: [0.36, 0.04, 250], alpha: 0.45 },
  hills: [[0.14, 0.035, 230], [0.2, 0.04, 220]],
  snow: [[0.36, 0.045, 250], [0.48, 0.04, 250], [0.3, 0.05, 255]],
  shade: { colour: [0.15, 0.05, 260], alpha: 0.35 },
  wall: [0.24, 0.05, 45],
  roof: [0.18, 0.04, 25],
  cap: [0.6, 0.035, 250],
  chimney: [0.22, 0.03, 30],
  lit: [0.88, 0.15, 78],
  glow: { colour: [0.7, 0.15, 65], alpha: 0.55 },
  dark: [0.14, 0.03, 260],
  pine: [0.13, 0.035, 190],
  smoke: { colour: [0.42, 0.02, 260], alpha: 0.5 },
  flake: [[0.5, 0.02, 255], [0.75, 0.02, 250], [0.93, 0.01, 250]],
};

const light: SnowPalette = {
  chars: { under: 1, wash: 0.3, over: 0.55, bloom: 0.1, floor: 0.82, full: 1.1, dots: 1.1, ink: true, edge: 0.18 },
  sky: [[0.8, 0.06, 240], [0.86, 0.045, 237], [0.92, 0.025, 232], [0.95, 0.015, 230]],
  light: { disc: [0.99, 0.03, 90], glow: [1, 0, 0], alpha: 0.7, x: 0.22, y: 0.14, from: -1 },
  peaks: [[0.985, 0.006, 240], [0.92, 0.018, 245], [0.88, 0.025, 250], [0.84, 0.03, 250]],
  mist: { colour: [0.97, 0.01, 240], alpha: 0.7 },
  hills: [[0.8, 0.035, 200], [0.86, 0.03, 205]],
  snow: [[0.95, 0.012, 240], [0.99, 0.004, 240], [0.93, 0.02, 245]],
  shade: { colour: [0.75, 0.06, 245], alpha: 0.4 },
  wall: [0.44, 0.08, 45],
  roof: [0.36, 0.07, 28],
  cap: [0.995, 0.004, 240],
  chimney: [0.42, 0.04, 30],
  lit: [0.8, 0.13, 80],
  glow: { colour: [0.9, 0.1, 75], alpha: 0.2 },
  dark: [0.42, 0.04, 240],
  pine: [0.33, 0.06, 175],
  smoke: { colour: [0.62, 0.015, 250], alpha: 0.55 },
  flake: [[0.78, 0.02, 245], [0.68, 0.025, 245], [0.6, 0.03, 245]],
};

export const SNOW_PALETTE = { dark, light };
