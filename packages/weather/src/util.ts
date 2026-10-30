/**
 * What every weather scene computes with: clamps and easing, randomness from `Math.random` (a test
 * replaces it with a seeded generator), a seeded generator of its own for what must look the same
 * on the same window (the village, the stars, the spruce), and a stable hash for what belongs to a
 * place on the screen and must not flicker from one frame to the next.
 */
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** 0 below `e0`, 1 above `e1`, an S between. */
export function smooth(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** A stable number in [0, 1) from three integers: the same input, the same number, every frame. */
export function hash3(a: number, b: number, c: number) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) + Math.imul(b | 0, 0x165667b1) + Math.imul(c | 0, 0x2f6b9d1d)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise in [0, 1) over the plane, the same at the same point: `hash3` at whole numbers,
 *  eased between them. Patches about one unit across. */
export function noise2(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = lerp(hash3(x0, y0, seed), hash3(x0 + 1, y0, seed), u);
  const b = lerp(hash3(x0, y0 + 1, seed), hash3(x0 + 1, y0 + 1, seed), u);
  return lerp(a, b, v);
}

/** A generator of numbers in [0, 1) from `seed`: a counter stepped by the golden ratio, each value
 *  mixed by the same finaliser as `hash3`. The same seed, the same numbers. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
  };
}
