/**
 * The land and sky under the Northern Lights, laid out from a fixed seed in shares of the window, so
 * a resize keeps them and fits them to the new size: a far ridge of low hills along the horizon, the
 * spruce in front of it (narrow spires, in clumps, taller here and there), the snow below them, and
 * the stars (a fixed list; a window shows as many of them as its size holds, so a bigger one shows
 * more of the same sky).
 */
import { HORIZON } from "./tundra";
import { clamp, lerp, noise2, seeded } from "../util";

export interface Spruce {
  fx: number;
  /** How many rows tall, and how far below the horizon it stands (rows). */
  h: number;
  drop: number;
}

export interface Star {
  fx: number;
  fy: number;
  /** 0 to 1: how bright. */
  mag: number;
  /** It twinkles, at this rate (0 for a steady one). */
  rate: number;
}

const rnd = seeded(0x5b2);
/** Spruce, left to right; in clumps, the clumps taller. */
export const SPRUCE: Spruce[] = (() => {
  const out: Spruce[] = [];
  for (let fx = 0; fx < 1; fx += lerp(0.003, 0.012, rnd())) {
    const clump = noise2(fx * 14, 0.5, 51);
    if (clump < 0.3 && rnd() < 0.6) continue;
    out.push({ fx, h: Math.round(lerp(3, 6, rnd()) + clump * lerp(2, 6, rnd())), drop: rnd() < 0.25 ? 1 : 0 });
  }
  return out;
})();

/** Every star there could be: most faint, a few bright. */
export const STARS: Star[] = Array.from({ length: 2600 }, () => {
  const mag = rnd() ** 4;
  return { fx: rnd(), fy: rnd() ** 1.25 * (HORIZON - 0.08), mag, rate: mag > 0.5 && rnd() < 0.5 ? lerp(0.8, 3, rnd()) : 0 };
});

/** How many stars a window `width` by `height` shows. */
export const starsFor = (width: number, height: number) => clamp(Math.round((width * height) / 1700), 150, STARS.length);

/** The far ridge's top at `fx` across the window, as a share of its height: low rolling hills with
 *  a few rounded summits. */
export const ridgeAt = (fx: number) => HORIZON - 0.035 - 0.15 * (0.65 * noise2(fx * 2.6, 0.5, 61) + 0.35 * noise2(fx * 7.3, 1.5, 62)) ** 1.5;
