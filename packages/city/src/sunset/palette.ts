/**
 * Sunset Drive's colours. Dark: a deep indigo sky through violet to magenta over the mountains, a
 * sun striped yellow to orange to magenta, violet ranges lit pink along their ridges, a dark floor
 * under a hot pink grid, black palms. Light: a pastel dawn, lilac high up through pink and peach to
 * pale gold over the hills, a pale gold sun going coral, lilac ranges, a pale floor under a rose
 * grid, plum palms. The sky, its glow and the ranges are kept dark (or light) enough for the
 * frosted panels' text over them (tests/city.test.ts).
 */
import type { Oklch } from "../colour";

export interface SunsetPalette {
  /** The sky from the top to the horizon, evenly spaced; the sun's glow round it. */
  sky: Oklch[];
  glow: { colour: Oklch; alpha: number };
  /** The sun, top to bottom. */
  sun: Oklch[];
  /** The ranges, far to near, and their ridges where the sun catches them. */
  ranges: [Oklch, Oklch, Oklch];
  ridges: [Oklch, Oklch, Oklch];
  /** The floor at the horizon and at the bottom; its grid; the horizon's line. */
  floor: [Oklch, Oklch];
  grid: Oklch;
  line: Oklch;
  /** Palms and cacti, near and far (into the haze). */
  shade: Oklch;
  haze: Oklch;
  /** Stars, and how bright at most (0 for none). */
  star: Oklch;
  stars: number;
  /** A click's pulse of light. */
  pulse: Oklch;
  /** The seams between the cells: their colour and strength. */
  seam: { colour: Oklch; alpha: number };
}

const night: SunsetPalette = {
  sky: [[0.13, 0.055, 278], [0.16, 0.08, 288], [0.2, 0.11, 302], [0.25, 0.13, 322], [0.3, 0.14, 345]],
  glow: { colour: [0.5, 0.17, 25], alpha: 0.28 },
  sun: [[0.93, 0.16, 98], [0.84, 0.18, 70], [0.74, 0.2, 40], [0.66, 0.24, 10], [0.6, 0.25, 350]],
  ranges: [[0.29, 0.11, 305], [0.22, 0.095, 295], [0.155, 0.07, 288]],
  ridges: [[0.52, 0.19, 335], [0.47, 0.18, 325], [0.42, 0.16, 315]],
  floor: [[0.2, 0.09, 305], [0.11, 0.05, 285]],
  grid: [0.7, 0.25, 345],
  line: [0.86, 0.17, 45],
  shade: [0.085, 0.035, 285],
  haze: [0.26, 0.12, 315],
  star: [0.95, 0.03, 300],
  stars: 1,
  pulse: [0.94, 0.12, 205],
  seam: { colour: [0, 0, 0], alpha: 0.2 },
};

const dawn: SunsetPalette = {
  sky: [[0.84, 0.06, 290], [0.865, 0.065, 315], [0.89, 0.06, 345], [0.92, 0.06, 35], [0.945, 0.07, 75]],
  glow: { colour: [0.99, 0.05, 95], alpha: 0.55 },
  sun: [[0.985, 0.06, 100], [0.95, 0.1, 85], [0.9, 0.11, 60], [0.85, 0.12, 35], [0.8, 0.13, 15]],
  ranges: [[0.855, 0.05, 300], [0.81, 0.058, 308], [0.78, 0.062, 318]],
  ridges: [[0.93, 0.05, 50], [0.9, 0.055, 40], [0.87, 0.06, 30]],
  floor: [[0.9, 0.045, 330], [0.84, 0.05, 312]],
  grid: [0.66, 0.15, 345],
  line: [0.75, 0.13, 30],
  shade: [0.52, 0.075, 318],
  haze: [0.8, 0.05, 320],
  star: [0.99, 0.02, 90],
  stars: 0,
  pulse: [0.58, 0.2, 300],
  seam: { colour: [1, 0, 0], alpha: 0.22 },
};

export const SUNSET_PALETTE = { dark: night, light: dawn };
