/**
 * Northern Lights' colours: the picture's, which the character pass draws through (chars.ts). By
 * night (a dark theme): a deep indigo sky, a little lighter and bluer low down, stars, a far ridge in blue
 * shade, black spruce, snow lit blue-green by the aurora; the aurora green along its lower edge,
 * teal higher, violet at the top of its rays, a pink fringe under its brightest edge; a cabin's
 * window warm by the trees. By day (a light theme): dawn, the sky periwinkle overhead going lavender
 * and rose to a peach glow where the sun will rise, a faint aurora still in it as soft pale
 * teal-green light, the far ridge lavender, the spruce and the cabin dark against it, the snow rose
 * near the trees and blue in front.
 *
 * The frosted panels sit over the picture as the pass draws it: the picture dimmed behind, the
 * characters over it. tests/weather.test.ts checks their text over the brightest of it.
 */
import type { CharLook } from "../chars";
import type { Oklch } from "../colour";

export interface NorthernLightsPalette {
  chars: CharLook;
  /** The sky, top to the horizon; and the glow low over the horizon where the sun will rise (alpha;
   *  null by night). */
  sky: Oklch[];
  dawn: { colour: Oklch; alpha: number } | null;
  /** The stars (null by day). */
  stars: Oklch | null;
  /** The aurora up its rays: under its edge, its edge, a quarter up, half, three quarters, its top;
   *  and how strong it is (1 by night; faint by day). */
  aurora: [Oklch, Oklch, Oklch, Oklch, Oklch, Oklch];
  strength: number;
  /** How much of its light is added to the sky (by day a faint glow). */
  veil: number;
  /** Its light on the snow (how much of it the snow gives back). */
  reflect: number;
  /** The far ridge, and the light along its top. */
  ridge: [Oklch, Oklch];
  spruce: Oklch;
  /** The snow by the trees and nearest; the shade in its hollows and the light on its crests. */
  snow: [Oklch, Oklch];
  hollow: { colour: Oklch; alpha: number };
  crest: Oklch;
  /** The cabin, the snow on its roof, and its window. */
  cabin: Oklch;
  roof: Oklch;
  window: Oklch;
  meteor: Oklch;
  /** Snow blowing along the ground (null: none drawn). */
  drift: Oklch | null;
}

const dark: NorthernLightsPalette = {
  chars: { under: 0.72, wash: 0, over: 1.45, bloom: 0.5, floor: 0.17, full: 0.32, dots: 0.32, ink: false, edge: 0.1 },
  sky: [[0.12, 0.045, 275], [0.14, 0.045, 268], [0.165, 0.045, 260], [0.21, 0.045, 248]],
  dawn: null,
  stars: [0.95, 0.02, 240],
  aurora: [[0.62, 0.19, 355], [0.8, 0.21, 150], [0.72, 0.18, 165], [0.62, 0.13, 190], [0.5, 0.15, 270], [0.46, 0.17, 310]],
  strength: 1,
  veil: 1,
  reflect: 0.22,
  ridge: [[0.17, 0.035, 240], [0.3, 0.05, 195]],
  spruce: [0.08, 0.02, 250],
  snow: [[0.27, 0.05, 200], [0.17, 0.04, 245]],
  hollow: { colour: [0.1, 0.035, 255], alpha: 0.4 },
  crest: [0.33, 0.05, 195],
  cabin: [0.1, 0.02, 40],
  roof: [0.42, 0.04, 210],
  window: [0.85, 0.15, 75],
  meteor: [0.97, 0.04, 95],
  drift: null,
};

const light: NorthernLightsPalette = {
  chars: { under: 1, wash: 0, over: 0.62, bloom: 0.06, floor: 0.62, full: 0.55, dots: 0.06, ink: true, edge: 0.14 },
  sky: [[0.71, 0.07, 272], [0.76, 0.062, 300], [0.82, 0.058, 345], [0.87, 0.07, 45]],
  dawn: { colour: [0.93, 0.08, 65], alpha: 0.75 },
  stars: null,
  aurora: [[0.66, 0.1, 350], [0.68, 0.13, 168], [0.68, 0.12, 178], [0.68, 0.1, 192], [0.68, 0.08, 230], [0.68, 0.08, 300]],
  strength: 0.42,
  veil: 0.6,
  reflect: 0,
  ridge: [[0.69, 0.06, 290], [0.8, 0.06, 335]],
  spruce: [0.27, 0.05, 235],
  snow: [[0.9, 0.04, 340], [0.8, 0.05, 268]],
  hollow: { colour: [0.7, 0.07, 270], alpha: 0.55 },
  crest: [0.95, 0.035, 50],
  cabin: [0.3, 0.06, 35],
  roof: [0.93, 0.03, 330],
  window: [0.82, 0.14, 72],
  meteor: [0.9, 0.08, 70],
  drift: null,
};

export const NORTHERN_LIGHTS_PALETTE = { dark, light };
