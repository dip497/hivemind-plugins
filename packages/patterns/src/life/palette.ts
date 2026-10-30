/**
 * Life's colours, in OKLCH. At night, soft greens and teals on a near-black board: a newborn a
 * pale mint, older cells settling through green into a deep teal. On paper, inks: a newborn deep
 * indigo, older cells settling into sepia.
 */
import type { Oklch } from "../colour";

export interface LifePalette {
  /** The board, top to bottom. */
  ground: Oklch[];
  /** The faint dot in each empty cell. */
  dot: Oklch;
  /** A newborn brightening, a newborn, then each age as it settles, oldest last. */
  ages: Oklch[];
  /** A trace just left by a cell that died, fading into the board. */
  trace: Oklch;
}

export const LIFE_PALETTE: { dark: LifePalette; light: LifePalette } = {
  dark: {
    ground: [[0.168, 0.011, 200], [0.158, 0.012, 185], [0.15, 0.014, 170]],
    dot: [0.235, 0.02, 180],
    ages: [
      [0.62, 0.1, 160],
      [0.9, 0.1, 158],
      [0.83, 0.14, 153],
      [0.76, 0.14, 157],
      [0.69, 0.125, 165],
      [0.62, 0.105, 174],
      [0.56, 0.088, 183],
      [0.5, 0.072, 192],
    ],
    trace: [0.47, 0.085, 168],
  },
  light: {
    ground: [[0.968, 0.012, 88], [0.958, 0.014, 84], [0.948, 0.016, 80]],
    dot: [0.885, 0.018, 80],
    ages: [
      [0.62, 0.08, 278],
      [0.3, 0.13, 276],
      [0.34, 0.12, 272],
      [0.38, 0.1, 266],
      [0.43, 0.075, 250],
      [0.48, 0.06, 70],
      [0.53, 0.06, 64],
      [0.58, 0.055, 62],
    ],
    trace: [0.74, 0.045, 64],
  },
};
