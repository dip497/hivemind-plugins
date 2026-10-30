/**
 * Autumn Wood's colours. At night (a dark theme) the wood at dusk: a deep violet-blue sky, the last
 * of a low sun glowing warm behind the far trees, the leaves deep in the half light and caught warm
 * on the side toward the sun, a lantern and fireflies. By day (a light theme) a crisp blue sky, the
 * leaves bright in the sun from high on the right. Either way the sky and the ground under the trees
 * are kept dark (or light) enough for the frosted panels' text over them (tests/wilds.test.ts).
 */
import type { Oklch } from "../colour";
import type { SkyLook } from "../sky";

/** The leaves' colours, by name, in the order the layout picks them (wood.ts). */
export const LEAF_COLOURS = ["crimson", "red", "orange", "amber", "gold", "green", "brown"] as const;
export type LeafColour = (typeof LEAF_COLOURS)[number];

export interface AutumnPalette extends SkyLook {
  /** Each leaf colour in full light. */
  leaves: Record<LeafColour, Oklch>;
  /** How far toward its shadow a leaf's block is drawn under its character (0 none, 1 all). */
  shadow: Oklch;
  /** Bark: its shadow, its face, and where it catches the light. */
  bark: [Oklch, Oklch, Oklch];
  /** The far trees, before the haze: and how much of the sky's colour the haze lays over them. */
  far: Oklch;
  haze: number;
  /** The forest floor: its earth and the litter on it. */
  floor: [Oklch, Oklch];
  /** Mist low between the trees, and how strong at most. */
  mist: Oklch;
  mistAlpha: number;
  /** The light on the side of each crown toward the sun (the sky's glow), and how strong. */
  rim: Oklch;
  rimAlpha: number;
  /** Stars (0 for none), a lantern, the fireflies; and lights add to the dark (or tint a light sky). */
  stars: number;
  star: Oklch;
  lantern: Oklch | null;
  firefly: Oklch | null;
  add: boolean;
}

const dark: AutumnPalette = {
  sky: [[0.19, 0.055, 283], [0.225, 0.065, 292], [0.27, 0.075, 308], [0.32, 0.08, 335], [0.24, 0.05, 320]],
  glow: { colour: [0.6, 0.15, 52], alpha: 0.4, x: 0.6, y: 0.68, reach: 0.42 },
  leaves: {
    crimson: [0.5, 0.17, 20],
    red: [0.56, 0.18, 33],
    orange: [0.64, 0.16, 50],
    amber: [0.7, 0.15, 68],
    gold: [0.77, 0.14, 88],
    green: [0.56, 0.1, 135],
    brown: [0.47, 0.07, 52],
  },
  shadow: [0.17, 0.04, 300],
  bark: [[0.15, 0.02, 300], [0.29, 0.035, 40], [0.47, 0.05, 55]],
  far: [0.2, 0.05, 330],
  haze: 0.3,
  floor: [[0.17, 0.03, 330], [0.27, 0.045, 40]],
  mist: [0.62, 0.04, 300],
  mistAlpha: 0.26,
  rim: [0.72, 0.14, 60],
  rimAlpha: 0.5,
  stars: 0.75,
  star: [0.9, 0.03, 90],
  lantern: [0.84, 0.15, 75],
  firefly: [0.9, 0.17, 115],
  add: true,
};

const light: AutumnPalette = {
  sky: [[0.77, 0.1, 246], [0.82, 0.085, 241], [0.87, 0.06, 233], [0.915, 0.035, 222], [0.88, 0.04, 85]],
  glow: { colour: [0.99, 0.05, 95], alpha: 0.55, x: 0.82, y: 0.02, reach: 0.55 },
  leaves: {
    crimson: [0.53, 0.2, 24],
    red: [0.61, 0.2, 35],
    orange: [0.7, 0.18, 52],
    amber: [0.77, 0.16, 70],
    gold: [0.85, 0.15, 93],
    green: [0.63, 0.13, 135],
    brown: [0.52, 0.09, 55],
  },
  shadow: [0.36, 0.05, 40],
  bark: [[0.36, 0.03, 45], [0.5, 0.04, 55], [0.66, 0.04, 70]],
  far: [0.62, 0.1, 110],
  haze: 0.5,
  floor: [[0.78, 0.05, 70], [0.6, 0.08, 55]],
  mist: [0.99, 0.01, 230],
  mistAlpha: 0.45,
  rim: [0.97, 0.08, 95],
  rimAlpha: 0.35,
  stars: 0,
  star: [0.9, 0.03, 90],
  lantern: null,
  firefly: null,
  add: false,
};

export const AUTUMN_PALETTE = { dark, light };
