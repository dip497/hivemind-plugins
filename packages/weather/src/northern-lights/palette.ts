/**
 * Northern Lights' colours: the picture's, which the character pass draws through (chars.ts). By
 * night (a dark theme): a deep indigo sky going teal at the horizon, the Milky Way faint across it,
 * stars, black spruce, snow lit blue-green by the aurora; the aurora green along its lower edge, teal
 * higher, violet at the top of its rays, a pink fringe under its brightest edge; a cabin's window
 * warm by the trees. By day (a light theme): a pastel polar sky, lavender going peach toward a low
 * sun with its halo and sun dogs, dark spruce on white snow, a faint aurora.
 *
 * The frosted panels sit over the picture as the pass draws it: the picture dimmed behind, the
 * characters over it. tests/weather.test.ts checks their text over the brightest of it.
 */
import type { CharLook } from "../chars";
import type { Oklch } from "../colour";

export interface NorthernLightsPalette {
  chars: CharLook;
  /** The sky, top to the horizon. */
  sky: Oklch[];
  /** The Milky Way's haze (alpha), and the stars (null by day). */
  milky: { colour: Oklch; alpha: number } | null;
  stars: Oklch | null;
  /** The aurora up its rays: under its edge, its edge, a quarter up, half, three quarters, its top;
   *  and how strong it is (1 by night; faint by day). */
  aurora: [Oklch, Oklch, Oklch, Oklch, Oklch, Oklch];
  strength: number;
  /** Its light on the snow (how much of it the snow gives back). */
  reflect: number;
  spruce: Oklch;
  /** The snow by the trees and nearest. */
  snow: [Oklch, Oklch];
  /** The cabin, and its window. */
  cabin: Oklch;
  window: Oklch;
  /** The low sun, its halo (inner, outer) and its sun dogs, by day. */
  sun: { disc: Oklch; halo: [Oklch, Oklch]; dog: Oklch } | null;
  meteor: Oklch;
  /** Snow blowing along the ground, by day (null: none drawn). */
  drift: Oklch | null;
}

const dark: NorthernLightsPalette = {
  chars: { under: 0.7, wash: 0, over: 1.45, bloom: 0.5, floor: 0.17, full: 0.32, dots: 0.32, ink: false, edge: 0.1 },
  sky: [[0.12, 0.045, 278], [0.145, 0.045, 258], [0.2, 0.05, 215], [0.28, 0.06, 185]],
  milky: { colour: [0.36, 0.03, 250], alpha: 0.32 },
  stars: [0.95, 0.02, 240],
  aurora: [[0.62, 0.19, 355], [0.78, 0.21, 150], [0.72, 0.18, 165], [0.62, 0.13, 190], [0.5, 0.15, 270], [0.46, 0.17, 310]],
  strength: 1,
  reflect: 0.22,
  spruce: [0.08, 0.02, 250],
  snow: [[0.26, 0.05, 200], [0.17, 0.04, 245]],
  cabin: [0.1, 0.02, 40],
  window: [0.85, 0.15, 75],
  sun: null,
  meteor: [0.97, 0.04, 95],
  drift: null,
};

const light: NorthernLightsPalette = {
  chars: { under: 1, wash: 0.35, over: 0.55, bloom: 0.1, floor: 0.8, full: 1.3, dots: 0.12, ink: true, edge: 0.2 },
  sky: [[0.84, 0.04, 250], [0.88, 0.035, 285], [0.915, 0.035, 330], [0.94, 0.045, 60]],
  milky: null,
  stars: null,
  aurora: [[0.62, 0.13, 350], [0.6, 0.15, 155], [0.62, 0.13, 172], [0.64, 0.1, 200], [0.62, 0.1, 265], [0.6, 0.12, 310]],
  strength: 0.4,
  reflect: 0.1,
  spruce: [0.32, 0.05, 185],
  snow: [[0.95, 0.015, 240], [0.985, 0.006, 245]],
  cabin: [0.36, 0.06, 40],
  window: [0.8, 0.12, 75],
  sun: { disc: [0.93, 0.13, 85], halo: [[0.8, 0.07, 35], [0.83, 0.06, 235]], dog: [0.97, 0.09, 70] },
  meteor: [0.55, 0.16, 45],
  drift: [0.86, 0.02, 245],
};

export const NORTHERN_LIGHTS_PALETTE = { dark, light };
