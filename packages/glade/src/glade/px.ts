/**
 * The painter the glade is made with: a buffer of art pixels, each holding what the lighting needs
 * of it, not only its colour. Its colour (albedo), the way its surface faces (a normal), how high it
 * stands above the ground and how near it is (depth), what it is made of (a material), and the light
 * it gives off of itself (glow). The scene is lit from these every frame, so a pixel art tree is lit
 * on the side that faces the fire, and the ground round the fire is warm.
 *
 * Space: x runs right in art pixels; y is the screen row, down. An upright thing stands on a foot
 * row; a pixel of it `h` rows above its foot is `h` high. Depth Z is twice the foot row (the ground is
 * seen from above at about thirty degrees, so a row on the screen is two units of ground), bigger
 * is nearer. A normal is (x right, y up, z toward the viewer).
 */

export type RGB = [number, number, number];
export type Vec3 = [number, number, number];

export const hex = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A seeded generator: the same glade for the same seed and size, every time. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A hash of a grid point, 0 to 1. */
export function hash(x: number, y: number, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0 to 1. */
export function noise(x: number, y: number, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** The 4x4 ordered-dither threshold at a pixel, 0 to 1: shades step in a pixel artist's pattern. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const bayer = (x: number, y: number) => (BAYER[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

/** Pick one of a few shades by a value 0 to 1, dithered between neighbours. */
export function shade(ramp: readonly RGB[], v: number, x: number, y: number): RGB {
  const f = clamp(v) * (ramp.length - 1);
  const i = Math.floor(f);
  return ramp[Math.min(ramp.length - 1, f - i > bayer(x, y) ? i + 1 : i)]!;
}

/** What a pixel is made of: how the lighting treats it. */
export const MAT = {
  EMPTY: 0,
  /** Lit as a surface. */
  SOLID: 1,
  /** Lit, and its foliage lets some light through from behind. */
  LEAF: 2,
  /** Water: lit, and it shows what stands above it, mirrored. */
  WATER: 3,
  /** The sky: never lit, only its colour and glow. */
  SKY: 4,
} as const;

export const normalize = (n: Vec3): Vec3 => { const l = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / l, n[1] / l, n[2] / l]; };

/** An art-pixel buffer of the four layers the lighting reads, with a depth test: nearer wins. */
export class Painter {
  readonly alb: Uint8Array;
  readonly nrm: Uint8Array;
  /** Height, depth, an extra value (the mirror row, for water) and the sway (how far wind moves it). */
  readonly dat: Float32Array;
  readonly emi: Uint8Array;
  private readonly zb: Float32Array;

  constructor(readonly w: number, readonly h: number) {
    this.alb = new Uint8Array(w * h * 4);
    this.nrm = new Uint8Array(w * h * 4);
    this.dat = new Float32Array(w * h * 4);
    this.emi = new Uint8Array(w * h * 4);
    this.zb = new Float32Array(w * h).fill(-1e9);
  }

  /** Paint one pixel if it is nearer than what is there. */
  put(x: number, y: number, c: RGB, n: Vec3, h: number, z: number, mat: number, glow?: RGB, extra = 0, sway = 0) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    const i = y * this.w + x;
    if (z < this.zb[i]!) return false;
    this.zb[i] = z;
    const o = i * 4;
    this.alb[o] = c[0]; this.alb[o + 1] = c[1]; this.alb[o + 2] = c[2]; this.alb[o + 3] = 255;
    this.nrm[o] = (n[0] * 0.5 + 0.5) * 255; this.nrm[o + 1] = (n[1] * 0.5 + 0.5) * 255; this.nrm[o + 2] = (n[2] * 0.5 + 0.5) * 255; this.nrm[o + 3] = mat;
    this.dat[o] = h; this.dat[o + 1] = z; this.dat[o + 2] = extra; this.dat[o + 3] = sway;
    if (glow) { this.emi[o] = glow[0]; this.emi[o + 1] = glow[1]; this.emi[o + 2] = glow[2]; this.emi[o + 3] = 255; }
    else { this.emi[o] = 0; this.emi[o + 1] = 0; this.emi[o + 2] = 0; this.emi[o + 3] = 0; }
    return true;
  }

  /** What is at a pixel: its material and depth, for a painter that builds on what is there. */
  matAt(x: number, y: number) { return this.nrm[(Math.round(y) * this.w + Math.round(x)) * 4 + 3] ?? 0; }
  zAt(x: number, y: number) { return this.zb[Math.round(y) * this.w + Math.round(x)] ?? -1e9; }
}

/** Depth of something standing on a foot row. */
export const depthOf = (footY: number) => footY * 2;

export interface BlobOpts {
  /** The colour of a pixel of it, from where it is on the blob (u, v from -1 to 1) and its normal. */
  colour: (u: number, v: number, n: Vec3, x: number, y: number) => RGB | null;
  mat?: number;
  glow?: (u: number, v: number, x: number, y: number) => RGB | undefined;
  /** How far it bulges toward the viewer, in depth units (its front is nearer than its foot). */
  bulge?: number;
  /** How flat its normal is: 1 a sphere, 0 a flat face toward the viewer. */
  round?: number;
  sway?: number;
  /** A ragged edge: how much the outline is eaten by noise (0 none). */
  ragged?: number;
  seed?: number;
}

/** An ellipsoid standing with its bottom `lift` rows above the foot row: a crown, a bush, a stone. */
export function blob(p: Painter, cx: number, cy: number, rx: number, ry: number, footY: number, o: BlobOpts) {
  const round = o.round ?? 1, bulge = o.bulge ?? Math.min(rx, ry), ragged = o.ragged ?? 0, seed = o.seed ?? 0;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      let d = u * u + v * v;
      if (ragged) d += (noise(x * 0.45, y * 0.45, seed) - 0.5) * ragged;
      if (d > 1) continue;
      const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, u * u + v * v)));
      const n = normalize([u * round, -v * round, nz * round + (1 - round)]);
      const c = o.colour(u, v, n, x, y);
      if (!c) continue;
      p.put(x, y, c, n, footY - y, depthOf(footY) + nz * bulge, o.mat ?? MAT.SOLID, o.glow?.(u, v, x, y), 0, o.sway ?? 0);
    }
  }
}

/** An upright cylinder from top row to its foot: a trunk, a post, a stump. */
export function column(p: Painter, cx: number, r: number, top: number, footY: number, colour: (u: number, x: number, y: number) => RGB | null, o: { mat?: number; glow?: (u: number, x: number, y: number) => RGB | undefined; bulge?: number; lean?: number } = {}) {
  const bulge = o.bulge ?? r;
  for (let y = Math.floor(top); y <= Math.ceil(footY); y++) {
    const off = (o.lean ?? 0) * (footY - y);
    for (let x = Math.floor(cx + off - r); x <= Math.ceil(cx + off + r); x++) {
      const u = (x + 0.5 - cx - off) / r;
      if (u < -1 || u > 1) continue;
      const nz = Math.sqrt(1 - u * u);
      const c = colour(u, x, y);
      if (!c) continue;
      p.put(x, y, c, [u, 0, nz], footY - y, depthOf(footY) + nz * bulge, o.mat ?? MAT.SOLID, o.glow?.(u, x, y));
    }
  }
}

/** A patch of flat ground: an ellipse on the ground plane round (cx, cy). */
export function patch(p: Painter, cx: number, cy: number, rx: number, ry: number, colour: (u: number, v: number, x: number, y: number) => RGB | null, o: { mat?: number; ragged?: number; seed?: number; extra?: number; lift?: number } = {}) {
  const ragged = o.ragged ?? 0, seed = o.seed ?? 0, lift = o.lift ?? 0;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      let d = u * u + v * v;
      if (ragged) d += (noise(x * 0.3, y * 0.6, seed) - 0.5) * ragged;
      if (d > 1) continue;
      const c = colour(u, v, x, y);
      if (!c) continue;
      p.put(x, y, c, [0, 1, 0], 0, depthOf(y) + lift, o.mat ?? MAT.SOLID, undefined, o.extra ?? 0);
    }
  }
}

/** A straight line of pixels standing up from a foot (a blade, a reed, a stem), leaning as it goes. */
export function stem(p: Painter, x: number, footY: number, len: number, lean: number, colour: (t: number, x: number, y: number) => RGB, o: { sway?: number; zBias?: number; mat?: number } = {}) {
  for (let k = 0; k < len; k++) {
    const t = k / Math.max(1, len - 1);
    const px = x + lean * t * t * len * 0.5, py = footY - k;
    p.put(px, py, colour(t, Math.round(px), py), normalize([lean * 0.3, 0.3, 1]), k, depthOf(footY) + (o.zBias ?? 0.5), o.mat ?? MAT.LEAF, undefined, 0, (o.sway ?? 1) * t);
  }
}
