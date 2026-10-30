/**
 * Brick Town's colours, in OKLCH: toy bricks on a sunny morning on a light theme (the primaries
 * light and clean, as plastic looks in the sun), the same town at night on a dark one (the bricks
 * deep, the windows and street lamps lit).
 *
 * Everything large (the baseplate, the streets and pavements, every wall and roof, the trees'
 * crowns) keeps to the band of lightness the app's frosted panels read over (tests/blocks.test.ts).
 * Small things leave it: the cars, the train, the people, a dropped brick, the flowers, the lights.
 */
import type { Oklch } from "../colour";
import type { Shades } from "../island/palette";

export interface TownPalette {
  plate: Shades;
  road: Shades;
  dash: Oklch;
  walk: Shades;
  paving: Shades;
  path: Shades;
  water: Shades;
  gravel: Shades;
  sleeper: Oklch;
  rail: Oklch;
  walls: Shades[];
  roofs: Shades[];
  /** A window's glass; by night most are lit (`lit`), the rest dark. */
  pane: Oklch;
  lit: Oklch | null;
  frame: Oklch;
  door: Oklch;
  leaves: Shades;
  trunk: Shades;
  post: Shades;
  /** A street lamp's head, and by night the light it throws on the ground round it. */
  lamp: Oklch;
  pool: { colour: Oklch; alpha: number } | null;
  /** Dropped bricks and cars, in the toy's primaries. */
  bricks: Shades[];
  tyre: Oklch;
  glass: Oklch;
  headlight: Oklch | null;
  skin: Oklch[];
  shirts: Oklch[];
  trousers: Oklch[];
  hair: Oklch[];
  flowers: Oklch[];
  engine: Shades;
  wagons: Shades[];
}

const faces = (l: number, c: number, h: number, step: number): Shades => ({
  top: [l, c, h],
  left: [l - step, c * 0.96, h],
  right: [l - step * 2, c * 0.92, h + 6],
});

export const TOWN_PALETTE: { light: TownPalette; dark: TownPalette } = {
  light: {
    plate: faces(0.89, 0.1, 140, 0.03),
    road: faces(0.87, 0.008, 260, 0.03),
    dash: [0.985, 0.01, 95],
    walk: faces(0.95, 0.006, 90, 0.03),
    paving: faces(0.92, 0.02, 70, 0.03),
    path: faces(0.92, 0.045, 80, 0.03),
    water: faces(0.87, 0.07, 225, 0.03),
    gravel: faces(0.87, 0.012, 60, 0.03),
    sleeper: [0.72, 0.05, 55],
    rail: [0.66, 0.012, 260],
    walls: [faces(0.97, 0.008, 90, 0.04), faces(0.94, 0.12, 97, 0.035), faces(0.88, 0.1, 25, 0.03), faces(0.89, 0.065, 240, 0.03), faces(0.91, 0.05, 70, 0.035), faces(0.9, 0.09, 150, 0.035)],
    roofs: [faces(0.88, 0.11, 30, 0.03), faces(0.88, 0.025, 250, 0.03), faces(0.88, 0.085, 165, 0.03), faces(0.88, 0.055, 55, 0.03)],
    pane: [0.9, 0.05, 230],
    lit: null,
    frame: [0.985, 0.005, 90],
    door: [0.62, 0.08, 40],
    leaves: faces(0.88, 0.12, 140, 0.035),
    trunk: faces(0.78, 0.06, 55, 0.04),
    post: faces(0.78, 0.01, 260, 0.04),
    lamp: [0.96, 0.03, 90],
    pool: null,
    bricks: [faces(0.68, 0.19, 27, 0.05), faces(0.64, 0.15, 255, 0.05), faces(0.89, 0.16, 97, 0.05), faces(0.72, 0.15, 150, 0.05), faces(0.98, 0.005, 90, 0.05), faces(0.77, 0.16, 55, 0.05)],
    tyre: [0.3, 0.01, 260],
    glass: [0.86, 0.04, 230],
    headlight: null,
    skin: [[0.87, 0.05, 60], [0.76, 0.07, 55], [0.62, 0.08, 50], [0.47, 0.06, 45]],
    shirts: [[0.62, 0.2, 27], [0.58, 0.15, 255], [0.86, 0.16, 97], [0.66, 0.15, 150], [0.97, 0.005, 90], [0.6, 0.14, 320]],
    trousers: [[0.45, 0.08, 255], [0.36, 0.02, 260], [0.56, 0.06, 60]],
    hair: [[0.35, 0.04, 50], [0.75, 0.1, 85], [0.25, 0.01, 260]],
    flowers: [[0.68, 0.19, 25], [0.88, 0.16, 95], [0.66, 0.16, 320]],
    engine: faces(0.6, 0.2, 27, 0.05),
    wagons: [faces(0.62, 0.15, 255, 0.05), faces(0.86, 0.16, 97, 0.05)],
  },
  dark: {
    plate: faces(0.35, 0.06, 150, 0.03),
    road: faces(0.28, 0.008, 265, 0.03),
    dash: [0.56, 0.01, 90],
    walk: faces(0.38, 0.008, 265, 0.03),
    paving: faces(0.38, 0.015, 70, 0.03),
    path: faces(0.38, 0.035, 75, 0.03),
    water: faces(0.31, 0.06, 250, 0.03),
    gravel: faces(0.31, 0.01, 60, 0.03),
    sleeper: [0.25, 0.03, 55],
    rail: [0.52, 0.01, 260],
    walls: [faces(0.4, 0.012, 265, 0.03), faces(0.4, 0.075, 92, 0.03), faces(0.38, 0.1, 25, 0.03), faces(0.37, 0.07, 255, 0.03), faces(0.39, 0.035, 65, 0.03), faces(0.38, 0.065, 150, 0.03)],
    roofs: [faces(0.37, 0.1, 30, 0.03), faces(0.34, 0.02, 265, 0.03), faces(0.36, 0.06, 165, 0.03), faces(0.34, 0.045, 55, 0.03)],
    pane: [0.28, 0.025, 260],
    lit: [0.87, 0.13, 82],
    frame: [0.52, 0.01, 265],
    door: [0.24, 0.04, 40],
    leaves: faces(0.37, 0.07, 150, 0.035),
    trunk: faces(0.3, 0.04, 55, 0.04),
    post: faces(0.42, 0.01, 265, 0.04),
    lamp: [0.94, 0.12, 85],
    pool: { colour: [0.8, 0.12, 80], alpha: 0.09 },
    bricks: [faces(0.5, 0.15, 27, 0.05), faces(0.46, 0.12, 255, 0.05), faces(0.66, 0.12, 92, 0.05), faces(0.52, 0.11, 150, 0.05), faces(0.72, 0.01, 265, 0.05), faces(0.56, 0.12, 55, 0.05)],
    tyre: [0.18, 0.01, 260],
    glass: [0.35, 0.03, 250],
    headlight: [0.96, 0.08, 95],
    skin: [[0.68, 0.04, 60], [0.6, 0.06, 55], [0.5, 0.06, 50], [0.4, 0.05, 45]],
    shirts: [[0.5, 0.15, 27], [0.47, 0.12, 255], [0.66, 0.12, 95], [0.52, 0.11, 150], [0.72, 0.01, 265], [0.5, 0.11, 320]],
    trousers: [[0.32, 0.06, 255], [0.26, 0.015, 260], [0.4, 0.04, 60]],
    hair: [[0.26, 0.03, 50], [0.55, 0.07, 85], [0.2, 0.01, 260]],
    flowers: [[0.52, 0.15, 25], [0.68, 0.12, 95], [0.5, 0.12, 320]],
    engine: faces(0.46, 0.15, 27, 0.05),
    wagons: [faces(0.45, 0.12, 255, 0.05), faces(0.64, 0.12, 95, 0.05)],
  },
};
