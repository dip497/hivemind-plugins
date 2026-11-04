/**
 * The glade's moving things as frames in one atlas, painted like the still layers (colour, normal,
 * height, depth, glow) so they are lit the same way: the fire's flames, the fox asleep by it, the deer
 * that wanders through, a puff of smoke, and a single dot for sparks, fireflies and raindrops. Each
 * frame's height and depth are its own, from its foot; where it stands is given when it is drawn.
 */
import { blob, clamp, hex, MAT, mix, noise, normalize, Painter, shade, type RGB, type Vec3 } from "./px";

export interface Frame { x: number; y: number; w: number; h: number }
export interface Atlas {
  p: Painter;
  flame: Frame[];
  fox: Frame[];
  deerWalk: Frame[];
  deerGraze: Frame[];
  smoke: Frame[];
  dot: Frame;
  /** A drop of rain: a short streak. */
  drop: Frame;
}

const ATLAS_W = 256, ATLAS_H = 128;

/** A cursor that hands out cells left to right, row by row. */
function cells() {
  let x = 0, y = 0, rowH = 0;
  return (w: number, h: number): Frame => {
    if (x + w > ATLAS_W) { x = 0; y += rowH + 1; rowH = 0; }
    const f = { x, y, w, h };
    x += w + 1; rowH = Math.max(rowH, h);
    if (y + h > ATLAS_H) throw new Error("the sprite atlas is full");
    return f;
  };
}

/** After painting a frame with its foot at its bottom row, make its depth its own: from its foot. */
function ownDepth(p: Painter, f: Frame) {
  const foot = f.y + f.h - 1;
  for (let y = f.y; y < f.y + f.h; y++) {
    for (let x = f.x; x < f.x + f.w; x++) {
      const o = (y * p.w + x) * 4;
      if (p.alb[o + 3]) p.dat[o + 1] = p.dat[o + 1]! - foot * 2;
    }
  }
}

/** A one-pixel dark outline round a frame's figure, as a pixel artist draws it, so it reads small. */
function outline(p: Painter, f: Frame, colour: RGB) {
  const filled = (x: number, y: number) => x >= f.x && y >= f.y && x < f.x + f.w && y < f.y + f.h && p.alb[(y * p.w + x) * 4 + 3]! > 0;
  const add: [number, number, number, number][] = [];
  for (let y = f.y; y < f.y + f.h; y++) {
    for (let x = f.x; x < f.x + f.w; x++) {
      if (filled(x, y)) continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (filled(x + dx!, y + dy!) ? (y + dy!) * p.w + x + dx! : -1)).find((i) => i >= 0);
      if (n === undefined) continue;
      add.push([x, y, p.dat[n * 4]!, p.dat[n * 4 + 1]!]);
    }
  }
  for (const [x, y, h, z] of add) p.put(x, y, colour, [0, 0, 1], h, z - 0.5, MAT.SOLID);
}

const FLAME: RGB[] = ["#6e1c10", "#b8321a", "#ec6420", "#ffa23a", "#ffd76a", "#fff3c4"].map(hex);

/** One frame of the fire: tongues of flame from a white heart to red tips, licking upward. */
function flameFrame(p: Painter, f: Frame, k: number, n: number) {
  const cx = f.x + f.w / 2, foot = f.y + f.h - 1;
  const a = (k / n) * Math.PI * 2;
  for (let y = f.y; y < f.y + f.h; y++) {
    const t = (foot - y) / f.h;
    for (let x = f.x; x < f.x + f.w; x++) {
      const lx = x + 0.5 - cx;
      // Noise rising through the flame, looping: two layers scrolled a full turn apart, crossfaded.
      const rise = (k / n) * 10;
      const n1 = noise(lx * 0.42 + Math.cos(a) * 0.6, (y - f.y) * 0.3 + rise, 11), n2 = noise(lx * 0.42 + Math.cos(a) * 0.6, (y - f.y) * 0.3 + rise - 10, 11);
      const turb = n1 * (1 - k / n) + n2 * (k / n);
      const sway = Math.sin(t * 5 - a) * t * 1.6;
      const width = (f.w * 0.5 - 0.5) * Math.pow(1 - t, 0.75) * (0.85 + 0.15 * Math.sin(a + t * 3));
      const v = 1 - Math.abs(lx - sway) / Math.max(0.6, width) - t * 0.55 + (turb - 0.5) * 0.9;
      if (v < 0.04) continue;
      const c = FLAME[Math.min(FLAME.length - 1, Math.floor(clamp(v * 1.25 + (1 - t) * 0.35) * FLAME.length))]!;
      const glow = mix(c, [255, 255, 255], 0.1) as RGB;
      p.put(x, y, c, [0, 0, 1], foot - y, foot * 2 + 4, MAT.SOLID, glow);
    }
  }
}

/** The fox asleep, curled nose to tail; frame 1 has drawn breath, frame 2 an ear flicked. */
function foxFrame(p: Painter, f: Frame, k: number) {
  const foot = f.y + f.h - 1, cx = f.x + f.w / 2;
  const breath = k === 1 ? 0.5 : 0;
  const fur = ["#7a3a1a", "#9a4a20", "#b85e2a", "#cf7a3c"].map(hex), cream = hex("#e8d6bc");
  // The body, a rounded curl.
  blob(p, cx + 1, foot - 3.2 - breath * 0.6, 6.5, 3.4 + breath * 0.4, foot, {
    colour: (u, v, n, x, y) => (v > 0.45 && u > -0.4 ? cream : shade(fur, 0.35 - v * 0.45 + noise(x * 0.8, y * 0.8, 3) * 0.3, x, y)),
  });
  // The head tucked at the left, its ears up.
  blob(p, cx - 4.5, foot - 2.6, 2.8, 2.3, foot, { colour: (u, v, n, x, y) => (u < -0.55 && v > -0.1 ? hex("#2a1a12") : shade(fur, 0.55 - v * 0.3, x, y)), bulge: 4 });
  const earUp = k === 2 ? 1 : 0;
  for (const ex of [-5.5, -3.8]) {
    for (let e = 0; e < 2 + (ex === -3.8 ? earUp : 0); e++) p.put(cx + ex, foot - 5 - e, e === 0 ? hex("#9a4a20") : hex("#3a2014"), [0, 0.3, 1], 5 + e, foot * 2 + 4, MAT.SOLID);
  }
  // The tail round the front, its tip white.
  blob(p, cx + 1.5, foot - 1.3, 5.5, 1.5, foot, { colour: (u, v, n, x, y) => (u < -0.55 ? cream : shade(fur, 0.6 + noise(x, y, 5) * 0.3, x, y)), bulge: 5 });
}

/** The deer, side on, facing right: walking (four steps) or with its head down to graze (two). */
function deerFrame(p: Painter, f: Frame, k: number, graze: boolean) {
  const foot = f.y + f.h - 1, cx = f.x + f.w / 2 - 1;
  const coat = ["#4a3324", "#5e422e", "#735239", "#866246"].map(hex), belly = hex("#b39a7e");
  const leg = (x0: number, phase: number) => {
    const swing = graze ? 0 : Math.sin(phase) * 1.6;
    for (let t = 0; t < 7; t++) {
      const x = x0 + swing * (t / 6) * (t / 6);
      p.put(x, foot - 6 + t, t > 5 ? hex("#221812") : shade(coat, 0.3, Math.round(x), foot - 6 + t), [0, 0, 1], 6 - t, foot * 2 + 3, MAT.SOLID);
    }
  };
  const ph = (k / 4) * Math.PI * 2;
  leg(cx - 4, ph + Math.PI); leg(cx + 3, ph);
  blob(p, cx, foot - 8, 5.6, 2.6, foot, { colour: (u, v, n, x, y) => (v > 0.4 ? belly : shade(coat, 0.45 - v * 0.4 + noise(x, y, 9) * 0.25, x, y)) });
  leg(cx - 3, ph); leg(cx + 4, ph + Math.PI);
  // Neck and head: up and forward, or down to the grass.
  const hx = graze ? cx + 7 : cx + 6.5, hy = graze ? foot - 3 + (k === 1 ? 0.5 : 0) : foot - 13 + (Math.sin(ph * 2) > 0.5 ? 0.5 : 0);
  const steps = 6;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps, nx = cx + 4 + (hx - cx - 4) * t, ny = foot - 9 + (hy - foot + 9) * t;
    blob(p, nx, ny, 1.4, 1.4, foot, { colour: (u, v, n, x, y) => shade(coat, 0.5 + noise(x, y, 10) * 0.3, x, y), bulge: 3 });
  }
  blob(p, hx + 1, hy, 2.2, 1.5, foot, { colour: (u, v, n, x, y) => (u > 0.7 ? hex("#1a120e") : shade(coat, 0.55 - v * 0.3, x, y)), bulge: 3.5 });
  // Ears; an eye that shines back at the light.
  p.put(hx - 0.5, hy - 2, coat[2]!, [0, 0.3, 1], foot - hy + 2, foot * 2 + 4, MAT.SOLID);
  p.put(hx + 0.5, hy - 2.5, coat[1]!, [0, 0.3, 1], foot - hy + 2.5, foot * 2 + 4, MAT.SOLID);
  p.put(hx + 1, hy - 0.5, hex("#202a20"), [0, 0, 1], foot - hy + 0.5, foot * 2 + 5, MAT.SOLID, [70, 110, 80]);
  // The white of its tail.
  p.put(cx - 6, foot - 9, hex("#e8e0d0"), [0, 0, 1], 9, foot * 2 + 3.5, MAT.SOLID);
}

/** A puff of smoke, a soft grey blob (it is drawn thinner as it rises: dithered away). */
function smokeFrame(p: Painter, f: Frame) {
  const r = f.w / 2;
  blob(p, f.x + r, f.y + r, r - 0.3, r - 0.3, f.y + f.h - 1, { colour: (u, v, n, x, y) => mix(hex("#4c4a4c"), hex("#6a6668"), clamp(-v * 0.5 + 0.5)), ragged: 0.5, seed: f.x });
}

export function makeAtlas(): Atlas {
  const p = new Painter(ATLAS_W, ATLAS_H);
  const cell = cells();
  const flame = Array.from({ length: 16 }, (_, k) => { const f = cell(15, 26); flameFrame(p, f, k, 16); ownDepth(p, f); return f; });
  const fox = Array.from({ length: 3 }, (_, k) => { const f = cell(20, 10); foxFrame(p, f, k); outline(p, f, hex("#1a0e08")); ownDepth(p, f); return f; });
  const deerWalk = Array.from({ length: 4 }, (_, k) => { const f = cell(24, 18); deerFrame(p, f, k, false); outline(p, f, hex("#120c08")); ownDepth(p, f); return f; });
  const deerGraze = Array.from({ length: 2 }, (_, k) => { const f = cell(24, 18); deerFrame(p, f, k, true); outline(p, f, hex("#120c08")); ownDepth(p, f); return f; });
  const smoke = [5, 7, 9].map((s) => { const f = cell(s, s); smokeFrame(p, f); ownDepth(p, f); return f; });
  const dot = cell(1, 1);
  p.put(dot.x, dot.y, [255, 255, 255], [0, 0, 1], 0, 0, MAT.SOLID, [255, 255, 255]);
  const drop = cell(1, 3);
  for (let k = 0; k < 3; k++) p.put(drop.x, drop.y + k, [150, 165, 185], normalize([0, 0.2, 1]) as Vec3, 2 - k, 0, MAT.SOLID);
  return { p, flame, fox, deerWalk, deerGraze, smoke, dot, drop };
}
