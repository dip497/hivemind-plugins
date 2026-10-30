/**
 * Metro's colours. At night the map is dark, its lines glowing in their colours over a deep slate
 * ground, the river a dark blue band, its stations white ticks and rings, its names a muted grey. By
 * day it is a printed paper map: off-white paper, the lines in print colours, a pale blue river,
 * pale green parks, white interchanges ringed in ink and ink-dark names. The ground, the river and
 * the parks are kept dark (or light) enough for the frosted panels' text over them
 * (tests/city.test.ts).
 */
import type { Oklch } from "../colour";

export interface MetroPalette {
  /** The ground, top to bottom, evenly spaced; the cell grid over it. */
  ground: Oklch[];
  grid: { colour: Oklch; alpha: number };
  river: Oklch;
  /** The river's ripples, characters over it. */
  ripple: Oklch;
  park: Oklch;
  /** A park's grass, characters over it. */
  grass: Oklch;
  /** The lines, in the order the map makes them. */
  lines: Oklch[];
  /** Lines glow round them (at this strength; 0 for none), and a bright core runs down them. */
  halo: number;
  core: number;
  /** Station ticks (null: in the line's own colour), interchange rings and their insides. */
  tick: Oklch | null;
  ring: Oklch;
  ringFill: Oklch;
  label: Oklch;
  /** A train: its body (mixed this far from white toward its line's colour) and its outline. */
  train: Oklch;
  trainMix: number;
  trainEdge: Oklch;
  /** Light adds to the dark map, and only tints the paper. */
  add: boolean;
}

const night: MetroPalette = {
  ground: [[0.19, 0.02, 255], [0.17, 0.02, 258], [0.15, 0.02, 262]],
  grid: { colour: [1, 0, 0], alpha: 0.028 },
  river: [0.27, 0.05, 238],
  ripple: [0.42, 0.07, 232],
  park: [0.235, 0.045, 155],
  grass: [0.36, 0.07, 150],
  lines: [[0.66, 0.2, 25], [0.7, 0.15, 250], [0.84, 0.16, 92], [0.72, 0.17, 148], [0.7, 0.18, 310], [0.76, 0.15, 60], [0.74, 0.12, 195], [0.72, 0.16, 350]],
  halo: 0.2,
  core: 0.45,
  tick: [0.92, 0.01, 250],
  ring: [0.95, 0.005, 250],
  ringFill: [0.19, 0.02, 255],
  label: [0.68, 0.025, 250],
  train: [0.98, 0.01, 95],
  trainMix: 0.18,
  trainEdge: [0.15, 0.02, 260],
  add: true,
};

const day: MetroPalette = {
  ground: [[0.97, 0.012, 92], [0.962, 0.014, 88], [0.952, 0.016, 84]],
  grid: { colour: [0.5, 0.04, 240], alpha: 0.05 },
  river: [0.87, 0.05, 228],
  ripple: [0.78, 0.07, 230],
  park: [0.91, 0.055, 140],
  grass: [0.74, 0.09, 142],
  lines: [[0.56, 0.2, 27], [0.48, 0.15, 255], [0.76, 0.16, 85], [0.56, 0.15, 148], [0.48, 0.16, 310], [0.68, 0.16, 55], [0.6, 0.1, 195], [0.6, 0.17, 352]],
  halo: 0,
  core: 0,
  tick: null,
  ring: [0.25, 0.01, 250],
  ringFill: [0.995, 0.003, 90],
  label: [0.32, 0.02, 250],
  train: [0.22, 0.02, 260],
  trainMix: 0.35,
  trainEdge: [0.99, 0.004, 90],
  add: false,
};

export const METRO_PALETTE = { dark: night, light: day };
