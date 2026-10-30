/**
 * Sand's desert, in OKLCH. At dusk: an indigo sky warming through plum and rose to an amber
 * horizon, a low sun and its glow, dark mesas with their sun side lit, a plain going dark toward
 * the window's foot, and strata of ochre, amber, terracotta, rust and mauve sand lit warm on the
 * side facing the sun and cool in shadow. By day: a deep blue sky paling to a warm horizon, a white
 * sun, terracotta mesas going blue with distance, a sandy plain, and strata of terracotta, ochre,
 * cream, rust and rose.
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
    sky: [[0.17, 0.05, 285], [0.26, 0.085, 318], [0.42, 0.12, 22], [0.64, 0.14, 55]],
    plain: [[0.33, 0.07, 38], [0.17, 0.04, 30]],
    horizon: 0.62,
    sun: [0.95, 0.09, 88],
    sunGlow: [0.58, 0.16, 48],
    glow: 0.7,
    mesa: [0.2, 0.05, 25],
    mesaLit: [0.5, 0.13, 42],
    hazes: [0.6, 0.38, 0.12],
    dune: [0.22, 0.05, 30],
    duneLit: [0.44, 0.11, 50],
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
    sky: [[0.6, 0.11, 250], [0.73, 0.085, 242], [0.85, 0.05, 228], [0.93, 0.035, 80]],
    plain: [[0.85, 0.06, 74], [0.76, 0.075, 62]],
    horizon: 0.62,
    sun: [0.995, 0.025, 95],
    sunGlow: [0.98, 0.06, 90],
    glow: 0.65,
    mesa: [0.5, 0.09, 32],
    mesaLit: [0.7, 0.12, 50],
    hazes: [0.62, 0.4, 0.14],
    dune: [0.74, 0.07, 60],
    duneLit: [0.88, 0.06, 80],
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
