/**
 * Metro's colours: the map's picture, before it is turned into characters (ascii.ts), and how it is
 * turned. At night the map is dark, its lines lit in their colours and glowing over a deep slate
 * ground, the river a dark blue band, the parks deep green, the stations and rings white, the names a
 * soft grey. By day it is a printed paper map: off-white paper, the lines in print colours, a pale
 * blue river, pale green parks, rings and names in ink. The ground, the river and the parks are kept
 * dark (or light) enough for the frosted panels' text over them (tests/city.test.ts).
 */
import type { AsciiStyle } from "../ascii";
import type { Oklch } from "../colour";

export interface MetroPalette {
  /** The ground, top to bottom, evenly spaced; a faint light in its middle. */
  ground: Oklch[];
  light: { colour: Oklch; alpha: number };
  river: Oklch;
  /** The river's ripples, characters on it. */
  ripple: Oklch;
  park: Oklch;
  /** A park's grass, characters on it. */
  grass: Oklch;
  /** The lines, in the order the map makes them. */
  lines: Oklch[];
  /** Lines glow round them, at this strength (0 for none). */
  halo: number;
  /** A station's mark (null: in its line's own colour), an interchange's ring, a train. */
  tick: Oklch | null;
  ring: Oklch;
  train: Oklch;
  label: Oklch;
  /** Light adds to the dark map, and only tints the paper. */
  add: boolean;
  style: Omit<AsciiStyle, "paper" | "rim"> & { paper: Oklch; rim: Oklch };
}

const night: MetroPalette = {
  ground: [[0.19, 0.022, 255], [0.165, 0.022, 258], [0.14, 0.022, 262]],
  light: { colour: [0.32, 0.04, 255], alpha: 0.35 },
  river: [0.3, 0.06, 238],
  ripple: [0.62, 0.08, 228],
  park: [0.25, 0.05, 152],
  grass: [0.55, 0.11, 148],
  lines: [[0.68, 0.2, 25], [0.7, 0.15, 250], [0.86, 0.16, 92], [0.74, 0.17, 148], [0.7, 0.18, 310], [0.78, 0.15, 60], [0.76, 0.12, 195], [0.74, 0.16, 350]],
  halo: 0.32,
  tick: [0.95, 0.01, 250],
  ring: [0.97, 0.005, 250],
  train: [1, 0.02, 95],
  label: [0.74, 0.025, 250],
  add: true,
  style: { dark: true, ink: 1.4, ground: 0.6, soft: 2, paper: [0, 0, 0], bloom: 1.1, bloomFrom: 0.22, edge: 0.4, edgeInk: 1.25, rim: [0.3, 0.02, 255], from: 0.3, to: 0.9 },
};

const day: MetroPalette = {
  ground: [[0.975, 0.012, 92], [0.965, 0.014, 88], [0.955, 0.016, 84]],
  light: { colour: [1, 0, 0], alpha: 0.3 },
  river: [0.86, 0.05, 228],
  ripple: [0.62, 0.09, 232],
  park: [0.91, 0.06, 140],
  grass: [0.6, 0.12, 142],
  lines: [[0.56, 0.2, 27], [0.48, 0.15, 255], [0.72, 0.16, 82], [0.56, 0.15, 148], [0.48, 0.16, 310], [0.66, 0.16, 55], [0.6, 0.1, 195], [0.6, 0.17, 352]],
  halo: 0,
  tick: null,
  ring: [0.25, 0.01, 250],
  train: [0.22, 0.02, 260],
  label: [0.32, 0.02, 250],
  add: false,
  style: { dark: false, ink: 0.55, ground: 0.2, soft: 2.2, paper: [0.975, 0.012, 92], bloom: 0, bloomFrom: 0, edge: 0.4, edgeInk: 0.9, rim: [1, 0, 0], from: 0.3, to: 0.9 },
};

export const METRO_PALETTE = { dark: night, light: day };
