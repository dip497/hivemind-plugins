/**
 * Campfire's colours. At night (a dark theme) a deep blue night, stars and a crescent moon, the firs
 * black against it but warm where the firelight reaches, the fire from deep red at its tips to a
 * white-yellow heart, its glow warming the clearing. At dusk (a light theme) a lavender sky going
 * peach low down, the firs soft violet-grey, the grass pale, the fire smaller and its glow a tint.
 * The sky and the ground stay dark (or light) enough for the frosted panels' text over them
 * (tests/wilds.test.ts).
 */
import type { Oklch } from "../colour";
import type { SkyLook } from "../sky";

export interface CampfirePalette extends SkyLook {
  /** The fire from its coolest tips to its hottest heart. */
  fire: [Oklch, Oklch, Oklch, Oklch, Oklch];
  /** The firs: far and near, and the firelight's colour on them and on everything it reaches. */
  far: Oklch;
  near: Oklch;
  firelight: Oklch;
  /** How much of the firelight reaches what is near the fire. */
  warmth: number;
  /** The clearing's grass: the ground and its blades. */
  grass: [Oklch, Oklch];
  /** Stones, logs (bark and the cut end), smoke, crickets, stars and the moon. */
  stone: Oklch;
  bark: Oklch;
  end: Oklch;
  smoke: Oklch;
  cricket: Oklch;
  stars: number;
  star: Oklch;
  moon: Oklch;
  /** Light adds to the dark; at dusk it tints. */
  add: boolean;
}

const dark: CampfirePalette = {
  sky: [[0.13, 0.035, 268], [0.19, 0.05, 262], [0.29, 0.06, 255], [0.36, 0.06, 250], [0.2, 0.035, 250]],
  glow: { colour: [0.5, 0.05, 250], alpha: 0.12, x: 0.68, y: 0.15, reach: 0.3 },
  fire: [[0.36, 0.13, 28], [0.55, 0.19, 35], [0.7, 0.18, 55], [0.86, 0.16, 85], [0.97, 0.07, 100]],
  far: [0.2, 0.03, 245],
  near: [0.1, 0.02, 235],
  firelight: [0.68, 0.16, 52],
  warmth: 0.7,
  grass: [[0.2, 0.035, 190], [0.32, 0.05, 160]],
  stone: [0.38, 0.015, 250],
  bark: [0.32, 0.04, 45],
  end: [0.5, 0.06, 70],
  smoke: [0.62, 0.015, 260],
  cricket: [0.85, 0.12, 120],
  stars: 0.8,
  star: [0.92, 0.02, 95],
  moon: [0.92, 0.06, 95],
  add: true,
};

const light: CampfirePalette = {
  sky: [[0.84, 0.055, 295], [0.865, 0.05, 305], [0.89, 0.045, 330], [0.9, 0.045, 40], [0.86, 0.035, 110]],
  glow: { colour: [0.99, 0.03, 80], alpha: 0.45, x: 0.5, y: 0.6, reach: 0.45 },
  fire: [[0.52, 0.17, 32], [0.62, 0.19, 40], [0.74, 0.17, 58], [0.86, 0.15, 85], [0.96, 0.07, 100]],
  far: [0.71, 0.04, 300],
  near: [0.64, 0.045, 295],
  firelight: [0.82, 0.12, 60],
  warmth: 0.45,
  grass: [[0.81, 0.04, 140], [0.66, 0.06, 140]],
  stone: [0.6, 0.02, 280],
  bark: [0.56, 0.06, 50],
  end: [0.74, 0.07, 72],
  smoke: [0.55, 0.02, 290],
  cricket: [0.5, 0.1, 120],
  stars: 0,
  star: [0.9, 0.02, 90],
  moon: [0.97, 0.03, 95],
  add: false,
};

export const CAMPFIRE_PALETTE = { dark, light };
