/**
 * What every Blocks scene computes with: clamps and easing, the run's randomness (Math.random, which
 * a test replaces with a seeded generator), a seeded generator of its own for what is laid out once
 * (an island's shape, a town's plan, a valley's hills), so the same window shows the same world, an
 * integer hash for textures, and smooth value noise for terrain.
 */
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** 0 at 0, 1 at 1, flat at both ends. */
export const ease = (t: number) => t * t * (3 - 2 * t);

/** A number in [lo, hi) from the run's randomness. */
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
/** A whole number in [lo, hi] from the run's randomness. */
export const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
/** One of `xs`, from the run's randomness. */
export const pickOne = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** Scramble a 32-bit integer so that neighbouring inputs give unrelated outputs (two rounds of
 *  multiply and xor-shift, constants with well-spread bits). */
function scramble(n: number) {
  let z = n | 0;
  z = Math.imul(z ^ (z >>> 16), 0x7feb352d);
  z = Math.imul(z ^ (z >>> 15), 0x846ca68b);
  return (z ^ (z >>> 16)) >>> 0;
}

/** A generator of numbers in [0, 1) from `seed`: a counter stepped by an odd constant and scrambled.
 *  The same seed gives the same numbers, apart from the run's Math.random. */
export function seededRandom(seed: number): () => number {
  let state = scramble(seed ^ 0x5bd1e995);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    return scramble(state) / 4294967296;
  };
}

/** A number in [0, 1) fixed for the integers `x`, `y` and `salt`: a texture's speckle, a tree's place. */
export function hash2(x: number, y: number, salt = 0) {
  return scramble(Math.imul(x | 0, 0x1f1f1f1f) ^ scramble(Math.imul(y | 0, 0x2545f491) ^ Math.imul(salt | 0, 0x9e3779b1))) / 4294967296;
}

/** Smooth value noise in [0, 1) at a point of the plane: the hashed corners of its unit square,
 *  blended with an eased weight, so it changes gently and never jumps. */
export function noise2(x: number, y: number, salt = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = ease(x - ix);
  const fy = ease(y - iy);
  const a = hash2(ix, iy, salt);
  const b = hash2(ix + 1, iy, salt);
  const c = hash2(ix, iy + 1, salt);
  const d = hash2(ix + 1, iy + 1, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** Noise of several octaves, each twice as fine and half as strong, in [0, 1). */
export function fractal(x: number, y: number, octaves: number, salt = 0) {
  let sum = 0;
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(x, y, salt + o * 101) * amp;
    total += amp;
    amp *= 0.5;
    x *= 2;
    y *= 2;
  }
  return sum / total;
}

/** A stable number in [0, 1) for a string. */
export function hashText(s: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return scramble(h) / 4294967296;
}
