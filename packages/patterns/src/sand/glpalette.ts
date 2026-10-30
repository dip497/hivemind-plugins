/**
 * Sand's desert, in OKLCH. At dusk: an indigo sky warming through plum and rose to a deep amber
 * horizon, a low sun and its glow, dark mesas with their sun side lit, a plain going dark toward
 * the window's foot, and strata of ochre, amber, terracotta, rust and mauve sand lit warm on the
 * side facing the sun and cool in shadow. By day, high-key: a blue sky paling to a warm horizon, a
 * white sun, pale terracotta mesas going blue with distance, a sandy plain; and strata of
 * terracotta, ochre, cream, rust and rose, the deepest colours in the picture.
 *
 * The app's frosted panels sit over the desert, so its sky, glow, mesas, plain and dunes stay dark
 * enough at dusk, and light enough by day, for the panels' text to read over them
 * (tests/patterns.test.ts); the sand, like a scene's creatures, and the sun's own disc are free.
 */
import type { CharLook } from "../charpass";
import type { Oklch } from "../colour";
import type { SandPalette } from "./palette";

export interface SandGlPalette {
  /** The sky: its top, two steps down it, and the horizon. */
  sky: [Oklch, Oklch, Oklch, Oklch];
  /** The plain under the mesas: at the horizon, and at the window's foot. */
  plain: [Oklch, Oklch];
  /** Where the horizon is, as a share of the window's height. */
  horizon: number;
  sun: Oklch;
  /** The sun's glow in the sky, and how strong. */
  sunGlow: Oklch;
  glow: number;
  /** The mesas: in shadow, and where the sun falls on them; how much of the sky's haze each range
   *  takes, far to near. */
  mesa: Oklch;
  mesaLit: Oklch;
  hazes: [number, number, number];
  /** The far dunes on the plain: in shadow, and facing the sun. */
  dune: Oklch;
  duneLit: Oklch;
  /** The stars: their colour, and how many (a share of the sky's cells; none by day). */
  star: Oklch;
  stars: number;
  /** A click's puff of dust. */
  dust: Oklch;
  /** The light on the sand: what its shadow side takes from its colour, and what its sun side. */
  shadow: Oklch;
  lit: Oklch;
  /** How dark the sand deep under its surface is (a share of its colour). */
  deep: number;
  /** The grains' colours round the spouts' cycle. */
  sands: SandPalette;
  look: Omit<CharLook, "base" | "ink">;
}

export const SAND_GL_PALETTE: { dark: SandGlPalette; light: SandGlPalette } = {
  dark: {
    sky: [[0.16, 0.05, 285], [0.23, 0.08, 315], [0.33, 0.105, 18], [0.42, 0.12, 42]],
    plain: [[0.3, 0.065, 38], [0.16, 0.04, 30]],
    horizon: 0.62,
    sun: [0.93, 0.1, 85],
    sunGlow: [0.45, 0.14, 52],
    glow: 0.85,
    mesa: [0.18, 0.045, 25],
    mesaLit: [0.4, 0.11, 42],
    hazes: [0.6, 0.38, 0.12],
    dune: [0.2, 0.05, 30],
    duneLit: [0.4, 0.1, 50],
    star: [0.93, 0.03, 90],
    stars: 0.006,
    dust: [0.75, 0.09, 72],
    shadow: [0.62, 0.07, 295],
    lit: [0.99, 0.05, 78],
    deep: 0.62,
    sands: {
      ground: [[0.1, 0, 0]],
      sands: [[0.7, 0.13, 75], [0.64, 0.14, 52], [0.57, 0.14, 35], [0.52, 0.12, 18], [0.48, 0.09, 350], [0.76, 0.09, 80]],
      under: [0, 0],
      shade: 0,
      dust: [0.75, 0.09, 72],
    },
    look: { ground: 1, gain: 1.3, full: 0.85, edge: 0.22, bloom: 0.4, bloomFrom: 0.62 },
  },
  light: {
    sky: [[0.8, 0.075, 245], [0.86, 0.058, 238], [0.91, 0.042, 225], [0.945, 0.03, 82]],
    plain: [[0.91, 0.045, 78], [0.83, 0.06, 66]],
    horizon: 0.62,
    sun: [0.995, 0.025, 95],
    sunGlow: [0.985, 0.05, 92],
    glow: 0.7,
    mesa: [0.79, 0.065, 38],
    mesaLit: [0.88, 0.07, 55],
    hazes: [0.55, 0.35, 0.1],
    dune: [0.81, 0.06, 64],
    duneLit: [0.91, 0.05, 82],
    star: [0.99, 0, 0],
    stars: 0,
    dust: [0.6, 0.06, 55],
    shadow: [0.74, 0.05, 285],
    lit: [1, 0.02, 90],
    deep: 0.82,
    sands: {
      ground: [[0.97, 0, 0]],
      sands: [[0.62, 0.13, 38], [0.76, 0.13, 76], [0.9, 0.05, 88], [0.53, 0.12, 30], [0.7, 0.09, 15], [0.5, 0.07, 52]],
      under: [0, 0],
      shade: 0,
      dust: [0.6, 0.06, 55],
    },
    look: { ground: 1, gain: 0.5, full: 0.6, edge: 0.14, bloom: 0, bloomFrom: 1 },
  },
};
