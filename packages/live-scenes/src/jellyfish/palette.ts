/**
 * Jellyfish in its own colours: the deep sea, blue to near black, light coming down from far
 * above, marine snow, and jellies in their kinds' colours, each glowing faintly. On a light theme a
 * pale sea, the jellies deeper-coloured on it, as ink on paper. The water is kept dark (or light)
 * enough for the frosted panels' text over it (tests/live-scenes.test.ts).
 */
import type { WaterLook } from "../backdrop";
import type { Oklch } from "../colour";
import type { JellyKind } from "./kinds";

export interface JellyColours {
  bell: Oklch;
  /** Its pattern's colours: its marking and its second. */
  mark: Oklch;
  mark2: Oklch;
  tentacle: Oklch;
  arm: Oklch;
}

export interface JellyPalette extends WaterLook {
  kinds: Record<JellyKind, JellyColours>;
  snow: Oklch;
  /** How bright a jelly's own soft glow is, round its bell. */
  shine: number;
}

const dark: JellyPalette = {
  water: [[0.27, 0.07, 255], [0.2, 0.06, 262], [0.14, 0.045, 268]],
  glow: { colour: [0.5, 0.1, 240], alpha: 0.16 },
  grid: { colour: [1, 0, 0], alpha: 0.03 },
  shafts: { colour: [0.85, 0.06, 230], alpha: 0.065, add: true },
  kinds: {
    moon: { bell: [0.88, 0.035, 240], mark: [0.74, 0.14, 330], mark2: [0.74, 0.14, 330], tentacle: [0.84, 0.03, 240], arm: [0.82, 0.05, 260] },
    pelagia: { bell: [0.7, 0.15, 315], mark: [0.86, 0.1, 330], mark2: [0.56, 0.14, 305], tentacle: [0.74, 0.12, 320], arm: [0.66, 0.15, 310] },
    nettle: { bell: [0.82, 0.13, 72], mark: [0.58, 0.13, 42], mark2: [0.9, 0.1, 85], tentacle: [0.68, 0.15, 32], arm: [0.92, 0.06, 88] },
    crystal: { bell: [0.9, 0.025, 205], mark: [0.78, 0.05, 205], mark2: [0.86, 0.17, 160], tentacle: [0.86, 0.025, 205], arm: [0.82, 0.03, 205] },
    lionsmane: { bell: [0.7, 0.16, 38], mark: [0.56, 0.15, 30], mark2: [0.8, 0.13, 55], tentacle: [0.76, 0.12, 48], arm: [0.64, 0.15, 32] },
    friedegg: { bell: [0.93, 0.03, 90], mark: [0.86, 0.15, 82], mark2: [0.74, 0.14, 72], tentacle: [0.88, 0.04, 90], arm: [0.7, 0.14, 310] },
    spotted: { bell: [0.74, 0.08, 112], mark: [0.96, 0.02, 95], mark2: [0.62, 0.08, 110], tentacle: [0.74, 0.06, 110], arm: [0.82, 0.06, 225] },
    atolla: { bell: [0.62, 0.16, 25], mark: [0.46, 0.14, 25], mark2: [0.84, 0.13, 235], tentacle: [0.66, 0.13, 25], arm: [0.62, 0.15, 25] },
  },
  snow: [0.84, 0.03, 240],
  shine: 0.26,
};

const light: JellyPalette = {
  water: [[0.95, 0.025, 235], [0.915, 0.035, 240], [0.875, 0.045, 245]],
  glow: { colour: [1, 0, 0], alpha: 0.4 },
  grid: { colour: [0.35, 0.05, 240], alpha: 0.05 },
  shafts: { colour: [1, 0, 0], alpha: 0.35, add: false },
  kinds: {
    moon: { bell: [0.6, 0.06, 245], mark: [0.55, 0.16, 330], mark2: [0.55, 0.16, 330], tentacle: [0.58, 0.05, 245], arm: [0.56, 0.07, 260] },
    pelagia: { bell: [0.5, 0.15, 315], mark: [0.66, 0.13, 330], mark2: [0.42, 0.13, 305], tentacle: [0.54, 0.13, 320], arm: [0.48, 0.15, 310] },
    nettle: { bell: [0.64, 0.15, 65], mark: [0.46, 0.13, 40], mark2: [0.74, 0.12, 80], tentacle: [0.54, 0.16, 30], arm: [0.7, 0.1, 78] },
    crystal: { bell: [0.58, 0.05, 210], mark: [0.5, 0.06, 210], mark2: [0.58, 0.16, 160], tentacle: [0.58, 0.04, 210], arm: [0.56, 0.05, 210] },
    lionsmane: { bell: [0.54, 0.17, 33], mark: [0.44, 0.16, 28], mark2: [0.62, 0.15, 50], tentacle: [0.56, 0.14, 45], arm: [0.5, 0.16, 30] },
    friedegg: { bell: [0.68, 0.06, 90], mark: [0.72, 0.17, 82], mark2: [0.56, 0.15, 70], tentacle: [0.64, 0.05, 90], arm: [0.5, 0.15, 310] },
    spotted: { bell: [0.54, 0.08, 105], mark: [0.94, 0.02, 95], mark2: [0.46, 0.08, 105], tentacle: [0.54, 0.07, 105], arm: [0.54, 0.07, 228] },
    atolla: { bell: [0.44, 0.15, 25], mark: [0.34, 0.12, 25], mark2: [0.55, 0.15, 240], tentacle: [0.48, 0.13, 25], arm: [0.44, 0.15, 25] },
  },
  snow: [0.6, 0.04, 240],
  shine: 0.16,
};

export const JELLY_PALETTE = { dark, light };
