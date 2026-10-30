/**
 * Block Valley's colours, in OKLCH: a clear summer morning on a light theme, a moonlit night on a
 * dark one (the same night as Block Island's: deep blue sky, stars, a square moon, the village's
 * windows and lanterns lit).
 *
 * Each block's colour is given for its three faces: its top, the sides toward the sun or moon and
 * the sides away, a clear step apart so every block reads. Every block keeps to the band of
 * lightness the app's frosted panels read over (tests/blocks.test.ts), and so does the haze it is
 * tinted toward with distance. Only the birds, the lit windows, the sun or moon and the glitter
 * on the water leave it.
 */
import type { Oklch } from "../colour";
import type { Shades } from "../island/palette";
import { MATS, Mat } from "./terrain";

export interface ValleyPalette {
  /** Each material's faces, by `Mat`. */
  mats: Shades[];
  /** The sky straight up and at the horizon, and the haze the land is tinted toward. */
  zenith: Oklch;
  horizon: Oklch;
  fog: Oklch;
  /** How far (blocks) the haze takes half the colour. */
  fogDistance: number;
  /** The sun by day, the moon by night: where it is, its disc and its glow. */
  sun: { dir: [number, number, number]; disc: Oklch; glow: Oklch; alpha: number };
  stars: boolean;
  /** The light glittering on the water and streaking falling water. */
  glint: Oklch;
  /** By night, the glow round a lit window or lantern; none by day. */
  lights: Oklch | null;
}

/** By night: the top caught by the moon, cooler and a little brighter; the sides falling into
 *  shadow in clear steps. */
const moonlit = (top: Oklch, side: Oklch, shade: Oklch): Shades => ({ top, left: side, right: shade });

const faces = (l: number, c: number, h: number, step: number): Shades => ({
  top: [l, c, h],
  left: [l - step, c, h],
  right: [l - step * 2, c * 0.92, h + 8],
});

function mats(list: Record<keyof typeof Mat, Shades>): Shades[] {
  const out: Shades[] = [];
  for (const [name, k] of Object.entries(Mat)) out[k] = list[name as keyof typeof Mat];
  if (out.length !== MATS || out.some((s) => !s)) throw new Error("every material needs its colours");
  return out;
}

export const VALLEY_PALETTE: { light: ValleyPalette; dark: ValleyPalette } = {
  light: {
    mats: mats({
      Grass: faces(0.9, 0.12, 132, 0.045),
      Dirt: faces(0.88, 0.05, 68, 0.035),
      Stone: faces(0.88, 0.012, 255, 0.035),
      Sand: faces(0.93, 0.05, 92, 0.035),
      Snow: faces(0.985, 0.008, 250, 0.035),
      Water: faces(0.86, 0.07, 222, 0.025),
      Wood: faces(0.88, 0.045, 62, 0.035),
      Leaves: faces(0.89, 0.12, 145, 0.04),
      Pine: faces(0.87, 0.09, 170, 0.03),
      Cloud: faces(0.99, 0.004, 240, 0.02),
      Bird: faces(0.64, 0.025, 245, 0.02),
      Plank: faces(0.92, 0.05, 75, 0.035),
      Roof: faces(0.88, 0.09, 30, 0.035),
      Window: faces(0.9, 0.04, 230, 0.02),
      Soil: faces(0.87, 0.05, 60, 0.03),
      Crop: faces(0.93, 0.11, 92, 0.035),
    }),
    zenith: [0.78, 0.09, 240],
    horizon: [0.93, 0.035, 225],
    fog: [0.93, 0.035, 225],
    fogDistance: 120,
    sun: { dir: [0.62, 0.24, -0.72], disc: [0.99, 0.05, 95], glow: [0.995, 0.025, 95], alpha: 0.55 },
    stars: false,
    glint: [0.99, 0.02, 95],
    lights: null,
  },
  dark: {
    mats: mats({
      Grass: moonlit([0.42, 0.06, 170], [0.34, 0.065, 155], [0.28, 0.055, 160]),
      Dirt: moonlit([0.37, 0.035, 60], [0.31, 0.035, 55], [0.25, 0.03, 50]),
      Stone: moonlit([0.35, 0.012, 255], [0.29, 0.012, 265], [0.24, 0.012, 270]),
      Sand: moonlit([0.41, 0.03, 95], [0.35, 0.035, 85], [0.29, 0.03, 80]),
      Snow: moonlit([0.43, 0.025, 245], [0.38, 0.025, 250], [0.32, 0.025, 260]),
      Water: faces(0.33, 0.065, 250, 0.035),
      Wood: faces(0.36, 0.04, 55, 0.045),
      Leaves: moonlit([0.4, 0.06, 172], [0.32, 0.065, 158], [0.26, 0.055, 165]),
      Pine: moonlit([0.38, 0.05, 185], [0.31, 0.055, 175], [0.25, 0.045, 180]),
      Cloud: faces(0.38, 0.03, 275, 0.03),
      Bird: faces(0.38, 0.02, 270, 0.02),
      Plank: faces(0.38, 0.04, 70, 0.045),
      Roof: faces(0.36, 0.07, 28, 0.045),
      Window: faces(0.86, 0.13, 80, 0.02),
      Soil: moonlit([0.34, 0.03, 55], [0.28, 0.03, 50], [0.23, 0.025, 45]),
      Crop: moonlit([0.42, 0.05, 100], [0.35, 0.05, 95], [0.29, 0.045, 90]),
    }),
    zenith: [0.15, 0.045, 268],
    horizon: [0.29, 0.06, 288],
    fog: [0.29, 0.06, 288],
    fogDistance: 105,
    sun: { dir: [0.42, 0.2, -0.86], disc: [0.93, 0.035, 95], glow: [0.55, 0.06, 270], alpha: 0.35 },
    stars: true,
    glint: [0.88, 0.03, 250],
    lights: [0.8, 0.12, 70],
  },
};
