/**
 * What the City scenes compute with: clamps and mixes, a seeded generator for what is laid out once
 * (a skyline, a map, a range of mountains) so a world can be kept across a resize, and a stable hash
 * for what must look the same every frame (a star's twinkle, a building's windows).
 */
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** A number between `lo` and `hi`, from Math.random: what a test seeds. */
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
/** A whole number from `lo` to `hi`, both included. */
export const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));
/** Ease in and out over [0, 1]. */
export const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * A seeded generator, [0, 1): the same seed gives the same numbers. A Weyl sequence (adding the
 * golden ratio's 32-bit fraction each call) run through a 32-bit finalising mix, so seeds next to
 * each other give unrelated runs.
 */
export function seeded(seed: number): () => number {
  let state = (seed ^ 0x5bd1e995) >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

/** A stable number in [0, 1) from up to three integers: the same input, the same number, every frame. */
export function hashOf(a: number, b = 0, c = 0): number {
  let h = Math.imul((a | 0) ^ 0x27d4eb2f, 0x165667b1);
  h = Math.imul(h ^ (b | 0) ^ (h >>> 15), 0x9e3779b1);
  h = Math.imul(h ^ (c | 0) ^ (h >>> 13), 0x85ebca77);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** One of `items`, by a number in [0, 1). */
export const pick = <T>(items: readonly T[], u: number): T => items[Math.min(items.length - 1, Math.floor(u * items.length))]!;
