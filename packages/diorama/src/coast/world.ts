/**
 * The coast as functions of where you are, shared by every shader that draws it (the ground, the
 * sea, the grass, the trees and the things along the path) and, for what the camera needs, by the
 * page: x runs along the coast, z across it, the land toward -z (the top of the view) and the sea
 * toward +z (the bottom). Everything repeats along x every PERIOD units, exactly: the camera drifts
 * on for ever, its x taken modulo PERIOD, and the world it sees never jumps.
 *
 * Noise is value noise on a lattice that wraps along x; every frequency is a power of two of the
 * period, so the wrap is seamless.
 */

/** How far along the coast before the world comes round again. */
export const PERIOD = 4096;

export const WORLD_GLSL = /* glsl */ `
#define PERIOD ${PERIOD.toFixed(1)}
float h12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
// Value noise of p, its lattice wrapping along x every per cells.
float vnp(vec2 p, float per) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  float x0 = mod(i.x, per), x1 = mod(i.x + 1., per);
  return mix(mix(h12(vec2(x0, i.y)), h12(vec2(x1, i.y)), u.x), mix(h12(vec2(x0, i.y + 1.)), h12(vec2(x1, i.y + 1.)), u.x), u.y);
}
// Noise of world point p at a scale of s units (a power of two), and its fractal sum.
float wn(vec2 p, float s) { return vnp(p / s, PERIOD / s); }
float wf(vec2 p, float s) { return (wn(p, s) * .5 + wn(p, s * .5) * .25 + wn(p, s * .25) * .125 + wn(p, s * .125) * .0625) / .9375; }
float wn1(float x, float s, float seed) { return wn(vec2(x, seed), s); }

// Where the water's edge is, across the coast, at x; and the coast's other measures along it.
float shoreZ(float x) { return 16. * (wn1(x, 128., 3.) - .5) + 7. * (wn1(x, 32., 7.) - .5) + 2. * (wn1(x, 8., 11.) - .5); }
float beachW(float x) { return max(0., 5. * wn1(x, 64., 17.) - 1.6); }
float cliffH(float x) { return 2.5 + 7. * wn1(x, 256., 23.); }
float pathIn(float x) { return 6. + 4. * (wn1(x, 64., 31.) - .5); }

// Inland distance from the water's edge (negative at sea), and the beach's width there.
float inland(vec2 p) { return shoreZ(p.x) - p.y; }
// The clifftop path: how far p is from its middle.
float pathD(vec2 p) { float d = inland(p); return abs(d - (beachW(p.x) + 2.6 + pathIn(p.x))); }

// The ground's height: a sea bed falling away, rocks along the edge, a beach, a cliff up from it,
// hills inland, the path along the top flattened.
float ground(vec2 p) {
  float d = inland(p), b = beachW(p.x);
  float rock = max(0., wf(p, 4.) - .58) * 7. * (1. - smoothstep(0., 5., abs(d + .5)));
  if (d < 0.) return -.3 + max(d * .35, -6.) + rock;
  float cliff = cliffH(p.x) * smoothstep(b + .1, b + 2.2, d);
  float hills = 5. * wf(p + vec2(0., 400.), 32.) * smoothstep(b + 4., b + 30., d);
  float onPath = 1. - smoothstep(.7, 1.8, pathD(p));
  return .12 + d * .05 + cliff + hills * (1. - .85 * onPath) + rock * (1. - smoothstep(0., 2., d - b)) + .4 * wf(p, 2.) * smoothstep(b, b + 3., d) * (1. - onPath);
}

// What grows where: 1 for open grass, 0 on sand, rock, the path and the sea.
float grassy(vec2 p) {
  float d = inland(p), b = beachW(p.x);
  return smoothstep(b + 2.2, b + 3.4, d) * smoothstep(1.1, 1.9, pathD(p));
}
// Patches of flowers in the grass, 0 to 1.
float flowery(vec2 p) { return smoothstep(.58, .74, wf(p + vec2(40., 0.), 8.)) * grassy(p); }
// Woods inland: how likely a tree is at p.
float woody(vec2 p) { float d = inland(p) - beachW(p.x); return smoothstep(.45, .62, wf(p + vec2(9., 70.), 32.)) * smoothstep(9., 16., d) * smoothstep(3.5, 5., pathD(p)); }
`;

// ── the same, on the page, for what the camera needs ──────────────────────────────────────────

const fract = (x: number) => x - Math.floor(x);
function h12(x: number, y: number) {
  let a = fract(x * 0.1031), b = fract(y * 0.1031), c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fract((a + b) * c);
}
function vnp(px: number, py: number, per: number) {
  const ix = Math.floor(px), iy = Math.floor(py), fx = px - ix, fy = py - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const mod = (v: number) => v - per * Math.floor(v / per);
  const x0 = mod(ix), x1 = mod(ix + 1);
  const a = h12(x0, iy) * (1 - ux) + h12(x1, iy) * ux, b = h12(x0, iy + 1) * (1 - ux) + h12(x1, iy + 1) * ux;
  return a * (1 - uy) + b * uy;
}
const wn1 = (x: number, s: number, seed: number) => vnp(x / s, seed / s, PERIOD / s);

/** Where the water's edge is at x, as the shaders have it. */
export const shoreZ = (x: number) => 16 * (wn1(x, 128, 3) - 0.5) + 7 * (wn1(x, 32, 7) - 0.5) + 2 * (wn1(x, 8, 11) - 0.5);
export const beachW = (x: number) => Math.max(0, 5 * wn1(x, 64, 17) - 1.6);
