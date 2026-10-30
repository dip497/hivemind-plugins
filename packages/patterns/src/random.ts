/**
 * Numbers the patterns share: a hash of whole numbers, for what belongs to a cell and must not
 * change from frame to frame; and the moment-to-moment draws, from `Math.random` (which a test
 * replaces with a seeded generator).
 */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** A number in [lo, hi), from `Math.random`. */
export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A whole number in [lo, hi], from `Math.random`. */
export const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** One of `xs`, from `Math.random`. */
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** Scramble 32 bits: every input bit moves every output bit (two xor-shift-multiply rounds). */
function scramble(x: number) {
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** A stable number in [0, 1) from two whole numbers: the same cell, the same number. */
export function hash2(a: number, b: number) {
  return scramble(Math.imul(a | 0, 0x27d4eb2d) ^ scramble(b | 0)) / 4294967296;
}
