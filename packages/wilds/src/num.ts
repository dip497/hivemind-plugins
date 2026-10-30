/**
 * The numbers every Wilds scene computes with: clamps and easing, angles, a seeded stream of
 * numbers for what a window lays out (the same window shows the same wood, desert or clearing),
 * a stable hash for what rides a cell (a leaf's glyph, a grain of sand), and smooth value noise.
 * Moment-to-moment chance (a leaf's flutter, a spark's wink) is `Math.random`, which a test seeds.
 */
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** 0 below `a`, 1 above `b`, an S between. */
export function ease(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The signed turn from angle `a` to angle `b`, in (-π, π]. */
export function turnTo(a: number, b: number) {
  const d = (((b - a) % TAU) + TAU) % TAU;
  return d > Math.PI ? d - TAU : d;
}

/** Scramble a 32-bit integer so neighbouring inputs land far apart (the finishing mix of a
 *  well-known 32-bit hash). */
function scramble(h: number) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A seeded stream of numbers in [0, 1): a counter stepping by the golden ratio's share of 2³²,
 *  scrambled. The same seed gives the same stream. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x9e3779b9) >>> 0;
    return scramble(s) / 4294967296;
  };
}

/** A stable number in [0, 1) from up to three integers: the same cell, the same answer. */
export function hash(a: number, b = 0, c = 0) {
  return scramble((Math.imul(a | 0, 0x27d4eb2d) + Math.imul(b | 0, 0x165667b1) + Math.imul(c | 0, 0x61c88647)) | 0) / 4294967296;
}

/** Smooth noise along a line, in [0, 1): a hash at each whole step, eased between. */
export function noise1(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i, seed), hash(i + 1, seed), u);
}

/** Smooth noise over a plane, in [0, 1). */
export function noise2(x: number, y: number, seed: number) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const a = lerp(hash(i, j, seed), hash(i + 1, j, seed), u);
  const b = lerp(hash(i, j + 1, seed), hash(i + 1, j + 1, seed), u);
  return lerp(a, b, v);
}

/** Two octaves of plane noise, in [0, 1). */
export function fbm2(x: number, y: number, seed: number) {
  return (noise2(x, y, seed) * 2 + noise2(x * 2.1, y * 2.1, seed + 17)) / 3;
}
