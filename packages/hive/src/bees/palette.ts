/**
 * Bees in its own colours (the person's Colour switch): a summer meadow by day on a light theme
 * and at dusk on a dark one. The sky is kept light (or dark) enough, and the ground's colours close
 * enough to it, that the frosted panels' text over them reads (tests/hive-wallpaper.test.ts); the
 * bees and the flowers carry the colour.
 */
import type { Oklch } from "./colour";
import type { FlowerKind } from "./ground";
import type { Part, SpeciesId } from "./species";

export interface BeePalette {
  /** Top to bottom, evenly spaced. */
  sky: Oklch[];
  /** A soft light low over the meadow, the sun going down or come up: its colour and strength. */
  glow: { colour: Oklch; alpha: number };
  grid: { colour: Oklch; alpha: number };
  /** The hills on the horizon, far and near. */
  hillFar: Oklch;
  hillNear: Oklch;
  /** The far grass, the near grass, and the flowers' stems and leaves. */
  far: Oklch;
  near: Oklch;
  stem: Oklch;
  /** Each kind of flower in a few colours: its petals and its heart. */
  flowers: Record<FlowerKind, [petal: Oklch, heart: Oklch][]>;
  /** The skep: its straw lit, every other coil, in shade, its rim, its door and the board it stands on. */
  straw: Oklch;
  coil: Oklch;
  shade: Oklch;
  rim: Oklch;
  door: Oklch;
  board: Oklch;
  /** Wings, the small bees, a load of pollen and a leafcutter's leaf. */
  wing: Oklch;
  drone: Oklch;
  pollen: Oklch;
  leaf: Oklch;
  /** Each species' parts. */
  bees: Record<SpeciesId, Record<Part, Oklch>>;
  /** How far a part's block is toward its colour from the sky behind it. */
  block: number;
  /** Lights add to the dark; on a light sky they tint it. */
  add: boolean;
}

const dark: BeePalette = {
  sky: [[0.2, 0.045, 272], [0.19, 0.04, 245], [0.185, 0.035, 205]],
  glow: { colour: [0.56, 0.12, 48], alpha: 0.16 },
  grid: { colour: [1, 0, 0], alpha: 0.026 },
  hillFar: [0.165, 0.03, 215],
  hillNear: [0.2, 0.04, 172],
  far: [0.3, 0.05, 160],
  near: [0.39, 0.07, 148],
  stem: [0.43, 0.075, 145],
  flowers: {
    daisy: [[[0.86, 0.02, 95], [0.78, 0.15, 85]], [[0.8, 0.05, 330], [0.76, 0.14, 80]], [[0.84, 0.03, 250], [0.74, 0.13, 85]]],
    sun: [[[0.8, 0.15, 88], [0.45, 0.07, 55]], [[0.72, 0.15, 60], [0.42, 0.07, 45]], [[0.76, 0.14, 95], [0.44, 0.06, 60]]],
    tulip: [[[0.62, 0.17, 25], [0.7, 0.14, 45]], [[0.7, 0.13, 350], [0.75, 0.1, 10]], [[0.8, 0.14, 90], [0.7, 0.14, 70]]],
    lavender: [[[0.62, 0.12, 300], [0.62, 0.12, 300]], [[0.58, 0.13, 285], [0.58, 0.13, 285]], [[0.66, 0.1, 315], [0.66, 0.1, 315]]],
    clover: [[[0.66, 0.12, 345], [0.72, 0.13, 350]], [[0.84, 0.03, 100], [0.86, 0.04, 110]], [[0.6, 0.12, 330], [0.68, 0.12, 340]]],
    poppy: [[[0.6, 0.18, 30], [0.3, 0.04, 30]], [[0.66, 0.16, 45], [0.32, 0.04, 40]], [[0.58, 0.17, 20], [0.3, 0.04, 20]]],
    buttercup: [[[0.84, 0.15, 95], [0.84, 0.15, 95]], [[0.8, 0.15, 85], [0.8, 0.15, 85]], [[0.88, 0.12, 100], [0.88, 0.12, 100]]],
  },
  straw: [0.55, 0.085, 78],
  coil: [0.51, 0.08, 74],
  shade: [0.45, 0.07, 68],
  rim: [0.56, 0.09, 80],
  door: [0.14, 0.02, 60],
  board: [0.46, 0.06, 55],
  wing: [0.86, 0.03, 230],
  drone: [0.76, 0.14, 75],
  pollen: [0.88, 0.16, 92],
  leaf: [0.62, 0.13, 140],
  bees: {
    honey: { a: [0.78, 0.15, 72], b: [0.32, 0.04, 55], t: [0.58, 0.08, 60], h: [0.3, 0.03, 50], s: [0.5, 0.04, 55], x: [0.7, 0.1, 70] },
    bumble: { a: [0.86, 0.15, 95], b: [0.26, 0.02, 60], t: [0.82, 0.14, 90], h: [0.26, 0.02, 60], s: [0.45, 0.02, 60], x: [0.92, 0.02, 90] },
    carpenter: { a: [0.85, 0.15, 95], b: [0.27, 0.03, 270], t: [0.82, 0.15, 92], h: [0.25, 0.02, 270], s: [0.5, 0.03, 270], x: [0.7, 0.05, 260] },
    mason: { a: [0.5, 0.1, 255], b: [0.36, 0.09, 260], t: [0.48, 0.07, 250], h: [0.32, 0.06, 255], s: [0.52, 0.07, 255], x: [0.6, 0.1, 250] },
    leafcutter: { a: [0.84, 0.02, 90], b: [0.36, 0.02, 60], t: [0.6, 0.04, 70], h: [0.32, 0.02, 60], s: [0.5, 0.02, 60], x: [0.62, 0.13, 140] },
    sweat: { a: [0.84, 0.15, 98], b: [0.3, 0.03, 70], t: [0.6, 0.13, 155], h: [0.55, 0.13, 160], s: [0.5, 0.05, 150], x: [0.62, 0.14, 155] },
    mining: { a: [0.7, 0.15, 50], b: [0.5, 0.11, 40], t: [0.66, 0.13, 50], h: [0.3, 0.03, 40], s: [0.5, 0.06, 40], x: [0.72, 0.14, 55] },
    redtail: { a: [0.62, 0.18, 32], b: [0.25, 0.02, 30], t: [0.27, 0.02, 30], h: [0.24, 0.02, 30], s: [0.45, 0.02, 30], x: [0.62, 0.18, 32] },
  },
  block: 0.55,
  add: true,
};

const light: BeePalette = {
  sky: [[0.975, 0.02, 92], [0.962, 0.026, 105], [0.935, 0.038, 128]],
  glow: { colour: [1, 0.02, 95], alpha: 0.5 },
  grid: { colour: [0.4, 0.05, 120], alpha: 0.045 },
  hillFar: [0.915, 0.035, 135],
  hillNear: [0.89, 0.045, 138],
  far: [0.8, 0.065, 135],
  near: [0.7, 0.09, 140],
  stem: [0.64, 0.1, 140],
  flowers: {
    daisy: [[[0.66, 0.02, 90], [0.74, 0.16, 85]], [[0.68, 0.08, 340], [0.72, 0.15, 80]], [[0.66, 0.05, 250], [0.72, 0.15, 85]]],
    sun: [[[0.76, 0.16, 85], [0.5, 0.08, 55]], [[0.7, 0.16, 55], [0.48, 0.08, 45]], [[0.78, 0.15, 95], [0.5, 0.07, 60]]],
    tulip: [[[0.62, 0.18, 25], [0.72, 0.15, 50]], [[0.66, 0.15, 350], [0.74, 0.1, 10]], [[0.76, 0.15, 88], [0.68, 0.15, 65]]],
    lavender: [[[0.6, 0.13, 300], [0.6, 0.13, 300]], [[0.56, 0.14, 285], [0.56, 0.14, 285]], [[0.64, 0.11, 315], [0.64, 0.11, 315]]],
    clover: [[[0.64, 0.14, 345], [0.7, 0.14, 350]], [[0.7, 0.04, 100], [0.74, 0.05, 110]], [[0.6, 0.14, 330], [0.66, 0.13, 340]]],
    poppy: [[[0.62, 0.19, 30], [0.32, 0.04, 30]], [[0.68, 0.17, 45], [0.34, 0.04, 40]], [[0.58, 0.18, 20], [0.32, 0.04, 20]]],
    buttercup: [[[0.78, 0.16, 95], [0.78, 0.16, 95]], [[0.74, 0.16, 85], [0.74, 0.16, 85]], [[0.82, 0.14, 100], [0.82, 0.14, 100]]],
  },
  straw: [0.74, 0.1, 80],
  coil: [0.7, 0.1, 76],
  shade: [0.65, 0.09, 70],
  rim: [0.6, 0.1, 70],
  door: [0.55, 0.05, 60],
  board: [0.6, 0.06, 55],
  wing: [0.62, 0.04, 230],
  drone: [0.66, 0.15, 72],
  pollen: [0.78, 0.17, 88],
  leaf: [0.6, 0.14, 140],
  bees: {
    honey: { a: [0.74, 0.16, 72], b: [0.34, 0.05, 55], t: [0.56, 0.09, 60], h: [0.3, 0.03, 50], s: [0.42, 0.04, 55], x: [0.66, 0.1, 70] },
    bumble: { a: [0.84, 0.16, 95], b: [0.28, 0.02, 60], t: [0.8, 0.15, 90], h: [0.28, 0.02, 60], s: [0.4, 0.02, 60], x: [0.96, 0.01, 90] },
    carpenter: { a: [0.82, 0.16, 95], b: [0.28, 0.03, 270], t: [0.8, 0.16, 92], h: [0.26, 0.02, 270], s: [0.42, 0.03, 270], x: [0.66, 0.05, 260] },
    mason: { a: [0.5, 0.11, 255], b: [0.36, 0.09, 260], t: [0.48, 0.07, 250], h: [0.32, 0.06, 255], s: [0.46, 0.07, 255], x: [0.58, 0.11, 250] },
    leafcutter: { a: [0.88, 0.02, 90], b: [0.38, 0.02, 60], t: [0.58, 0.04, 70], h: [0.32, 0.02, 60], s: [0.44, 0.02, 60], x: [0.6, 0.14, 140] },
    sweat: { a: [0.82, 0.16, 98], b: [0.32, 0.03, 70], t: [0.58, 0.14, 155], h: [0.52, 0.13, 160], s: [0.44, 0.05, 150], x: [0.6, 0.15, 155] },
    mining: { a: [0.68, 0.16, 50], b: [0.5, 0.12, 40], t: [0.64, 0.14, 50], h: [0.3, 0.03, 40], s: [0.44, 0.06, 40], x: [0.7, 0.15, 55] },
    redtail: { a: [0.6, 0.19, 32], b: [0.27, 0.02, 30], t: [0.29, 0.02, 30], h: [0.26, 0.02, 30], s: [0.4, 0.02, 30], x: [0.6, 0.19, 32] },
  },
  block: 0.6,
  add: false,
};

export const BEE_PALETTE = { dark, light };

/** In the theme's two colours (Colour off): how far from the page to the text each thing is drawn,
 *  as [its block, its character], or a character alone. The ground stays low, so the frosted
 *  panels' text over it reads; the bees stand out. */
export const MONO = {
  hillFar: [0.025, 0.06], hillNear: [0.04, 0.08],
  far: [0, 0.1], near: [0, 0.17], stem: 0.19,
  petal: [0.07, 0.27], heart: [0.12, 0.38],
  straw: [0.09, 0.27], coil: [0.075, 0.24], shade: [0.06, 0.2], rim: [0.09, 0.3], door: [0, 0], board: [0.06, 0.22],
  drone: 0.42, droneWing: 0.3, wing: 0.55, pollen: 0.9, leaf: 0.7,
  /** A bee's parts: its block, and its character alone. The character on a block is cut into it,
   *  darker, on a dark page, and inked darker still on a light one; a dark part is lifted off a
   *  dark page. */
  parts: { a: [0.74, 0.9], b: [0.3, 0.52], t: [0.52, 0.76], h: [0.34, 0.66], s: [0.3, 0.6], x: [0.86, 0.95] } as Record<Part, [number, number]>,
} as const;
