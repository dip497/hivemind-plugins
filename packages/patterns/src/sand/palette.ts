/**
 * Sand's colours, in OKLCH. At night, warm sands glowing softly on a dark sky that warms toward the
 * dunes: amber, copper, terracotta, clay rose, dusk mauve and pale sand, round a cycle the spouts
 * follow. By day, pastel sands on cream: peach, rose, lavender, sky, sage and butter.
 *
 * The sand covers the bottom of the window, and the app's frosted panels sit over it, so its
 * brightest grains are kept dark enough at night, and its deepest light enough by day, for the
 * panels' text to read over them (tests/patterns.test.ts).
 */
import type { Oklch } from "../colour";

export interface SandPalette {
  /** The sky, top to bottom. */
  ground: Oklch[];
  /** The colours round the spouts' cycle, each a grain at the surface in full light. */
  sands: Oklch[];
  /** How a grain under others is drawn: its lightness moved by this much one, and four or more, grains down. */
  under: [number, number];
  /** How much lighter or darker a grain's shades are, from one end to the other. */
  shade: number;
  /** A click's puff of dust. */
  dust: Oklch;
}

export const SAND_PALETTE: { dark: SandPalette; light: SandPalette } = {
  dark: {
    ground: [[0.135, 0.022, 285], [0.142, 0.026, 320], [0.16, 0.034, 20]],
    sands: [
      [0.43, 0.1, 72],
      [0.42, 0.105, 54],
      [0.41, 0.105, 37],
      [0.4, 0.09, 18],
      [0.39, 0.07, 345],
      [0.425, 0.065, 64],
    ],
    under: [-0.05, -0.095],
    shade: 0.03,
    dust: [0.62, 0.06, 70],
  },
  light: {
    ground: [[0.975, 0.01, 95], [0.968, 0.014, 85], [0.958, 0.02, 70]],
    sands: [
      [0.86, 0.07, 55],
      [0.85, 0.06, 15],
      [0.85, 0.045, 305],
      [0.86, 0.04, 235],
      [0.87, 0.05, 140],
      [0.89, 0.075, 95],
    ],
    under: [-0.02, -0.035],
    shade: 0.025,
    dust: [0.62, 0.045, 60],
  },
};
