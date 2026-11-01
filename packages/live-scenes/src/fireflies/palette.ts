/**
 * Fireflies' colours: a meadow at night, a deep blue sky lightening to a glow along the horizon,
 * steady stars, and each firefly's light in its kind's colour. On a light theme a meadow at dusk,
 * pale blue overhead going to rose and gold at the horizon, the lights deeper on it.
 *
 * The grass stands in depth, as a meadow does at both hours: the far grass nearest the sky's own
 * colour by the horizon (paler and bluer at night, hazy at dusk), each layer nearer it darker and
 * crisper, the near grass a dark silhouette against the glow. The sky's every stop, its horizon's
 * glow among them, is kept dark (or light) enough for the frosted panels' text over it
 * (tests/live-scenes.test.ts).
 */
import type { WaterLook } from "../backdrop";
import type { Oklch } from "../colour";
import type { FireflyKind } from "./kinds";

export interface FireflyPalette extends WaterLook {
  /** Where each of the sky's stops (`water`) is, from the top of the window (0) down (1): the
   *  sky stays dark (or light) over most of the window and gathers its glow low. */
  skyAt: number[];
  /** Each kind's light. */
  kinds: Record<FireflyKind, Oklch>;
  /** The small fireflies' light. */
  mote: Oklch;
  /** A firefly's body, its pronotum's pale shield, and its lantern while it is dark. */
  body: Oklch;
  shield: Oklch;
  lantern: Oklch;
  /** How white a light's bright core is, toward white from its colour: on a dusk sky white would
   *  not show. */
  hot: number;
  /** The lightness a light's glow is drawn in, its kind's hue and chroma (0: its own colour). On a
   *  dusk sky a glow as deep as the light itself reads as a smudge, not as light. */
  glowL: number;
  /** The grass, back to front (grass.ts's layers): far, middle, near, the seed stalks; and each
   *  layer's seed heads. */
  grass: [Oklch, Oklch, Oklch, Oklch];
  seed: [Oklch, Oklch, Oklch, Oklch];
  /** The turf along the very bottom: at its far top edge, and at the bottom of the window. */
  turf: [Oklch, Oklch];
  /** Stars, and how bright at most (0 for none). */
  star: Oklch;
  stars: number;
  /** Lights add to the dark; on a light sky they tint it. */
  add: boolean;
}

const dark: FireflyPalette = {
  water: [[0.15, 0.032, 264], [0.157, 0.035, 254], [0.168, 0.038, 240], [0.195, 0.042, 222], [0.235, 0.045, 204]],
  skyAt: [0, 0.32, 0.56, 0.78, 0.97],
  glow: null,
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
  body: [0.2, 0.02, 60],
  shield: [0.42, 0.04, 50],
  lantern: [0.42, 0.05, 100],
  hot: 0.55,
  glowL: 0,
  grass: [[0.27, 0.034, 214], [0.18, 0.037, 194], [0.115, 0.03, 175], [0.13, 0.03, 160]],
  seed: [[0.31, 0.03, 200], [0.26, 0.04, 130], [0.33, 0.048, 98], [0.37, 0.05, 92]],
  turf: [[0.215, 0.034, 205], [0.085, 0.024, 178]],
  star: [0.93, 0.025, 95],
  stars: 0.85,
  add: true,
};

const light: FireflyPalette = {
  water: [[0.96, 0.014, 250], [0.955, 0.018, 285], [0.945, 0.026, 345], [0.93, 0.042, 40], [0.915, 0.058, 62]],
  skyAt: [0, 0.32, 0.58, 0.8, 0.97],
  glow: null,
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
  mote: [0.66, 0.16, 105],
  body: [0.3, 0.025, 60],
  shield: [0.56, 0.06, 50],
  lantern: [0.7, 0.06, 100],
  hot: 0.2,
  glowL: 0.86,
  grass: [[0.79, 0.035, 116], [0.66, 0.05, 130], [0.43, 0.065, 142], [0.4, 0.055, 132]],
  seed: [[0.77, 0.045, 95], [0.66, 0.075, 88], [0.55, 0.09, 80], [0.52, 0.09, 76]],
  turf: [[0.8, 0.04, 112], [0.42, 0.06, 140]],
  star: [0.6, 0.02, 90],
  stars: 0,
  add: false,
};

export const FIREFLY_PALETTE = { dark, light };
