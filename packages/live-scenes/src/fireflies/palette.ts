/**
 * Fireflies' colours: a meadow at night, blue-green sky over grass going to seed, stars, and each
 * firefly's light in its kind's colour. On a light theme a meadow at dusk, pale over green grass,
 * the lights deeper on it. Far grass is near the sky's own colour, as far things are; near grass
 * stands out from it: lighter than the night, darker than the dusk. The sky is kept dark (or light)
 * enough for the frosted panels' text over it (tests/live-scenes.test.ts).
 */
import type { WaterLook } from "../backdrop";
import type { Oklch } from "../colour";
import type { FireflyKind } from "./kinds";

export interface FireflyPalette extends WaterLook {
  /** Each kind's light. */
  kinds: Record<FireflyKind, Oklch>;
  /** The small fireflies' light. */
  mote: Oklch;
  /** A firefly's head and wings, by its light. */
  body: Oklch;
  /** The grass, back to front (grass.ts's layers): far, middle, near, the seed stalks; and its seed
   *  heads. */
  grass: [Oklch, Oklch, Oklch, Oklch];
  seed: Oklch;
  /** The turf along the very bottom: its blocks, and the characters on them. */
  turf: [Oklch, Oklch];
  /** Stars, and how bright at most (0 for none). */
  star: Oklch;
  stars: number;
  /** Lights add to the dark; on a light sky they tint it. */
  add: boolean;
}

const dark: FireflyPalette = {
  water: [[0.21, 0.04, 220], [0.17, 0.035, 190], [0.14, 0.03, 160]],
  glow: { colour: [0.45, 0.05, 210], alpha: 0.12 },
  grid: { colour: [1, 0, 0], alpha: 0.028 },
  shafts: null,
  kinds: {
    pyralis: [0.92, 0.17, 115],
    carolinus: [0.88, 0.18, 138],
    ghost: [0.86, 0.09, 222],
    photuris: [0.86, 0.15, 78],
    lime: [0.94, 0.19, 125],
    ember: [0.8, 0.16, 55],
    teal: [0.86, 0.12, 182],
    pale: [0.95, 0.04, 100],
  },
  mote: [0.9, 0.16, 112],
  body: [0.42, 0.03, 70],
  grass: [[0.28, 0.05, 168], [0.38, 0.08, 155], [0.54, 0.12, 142], [0.56, 0.09, 125]],
  seed: [0.64, 0.08, 95],
  turf: [[0.22, 0.045, 165], [0.32, 0.07, 155]],
  star: [0.9, 0.02, 90],
  stars: 0.7,
  add: true,
};

const light: FireflyPalette = {
  water: [[0.95, 0.03, 95], [0.925, 0.035, 115], [0.89, 0.045, 135]],
  glow: { colour: [1, 0, 0], alpha: 0.35 },
  grid: { colour: [0.35, 0.05, 140], alpha: 0.05 },
  shafts: null,
  kinds: {
    pyralis: [0.72, 0.17, 112],
    carolinus: [0.66, 0.17, 140],
    ghost: [0.6, 0.12, 230],
    photuris: [0.7, 0.16, 70],
    lime: [0.74, 0.19, 125],
    ember: [0.64, 0.17, 50],
    teal: [0.62, 0.12, 185],
    pale: [0.72, 0.06, 95],
  },
  mote: [0.62, 0.16, 100],
  body: [0.36, 0.03, 70],
  grass: [[0.72, 0.07, 135], [0.56, 0.11, 140], [0.4, 0.13, 142], [0.38, 0.1, 125]],
  seed: [0.48, 0.11, 75],
  turf: [[0.66, 0.09, 138], [0.52, 0.1, 140]],
  star: [0.6, 0.02, 90],
  stars: 0,
  add: false,
};

export const FIREFLY_PALETTE = { dark, light };
