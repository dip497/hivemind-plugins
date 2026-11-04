/**
 * The things of the glade, each painted pixel by pixel into a Painter with its colour, its normal,
 * its height and depth, so the lighting can shape it: trees, the stump cottage, the tent, the fire's
 * ring of stones, the pond, lanterns, glowing mushrooms, grass. The colours are what the things are
 * made of; how dark the night is, and where the fire's light falls, is the lighting's to say.
 */
import { blob, column, depthOf, hash, MAT, mix, noise, normalize, patch, shade, stem, type Painter, type RGB, type Vec3, hex, clamp } from "./px";

const ramp = (...cs: string[]) => cs.map(hex);
export const PAL = {
  grass: ramp("#26401f", "#2f4c24", "#3a5a2a", "#476a31", "#557a39"),
  grassFar: ramp("#25392a", "#2c432f", "#344d34"),
  dirt: ramp("#3c2f24", "#4a3a2b", "#5a4733", "#6a553d"),
  bark: ramp("#2a1f19", "#372820", "#453227", "#553e2f", "#664b38"),
  barkFar: ramp("#1f1c1d", "#272325", "#2f2a2b"),
  leaf: ramp("#16291b", "#1d3421", "#254027", "#2f4d2e", "#3b5b35"),
  leafFar: ramp("#17241f", "#1c2b25", "#22332b"),
  stone: ramp("#3f4045", "#4d4e54", "#5d5e65", "#6e6f77", "#82838b"),
  moss: ramp("#33482a", "#405a31"),
  wood: ramp("#4a3322", "#5b4029", "#6d4e33", "#7e5c3c"),
  canvas: ramp("#6b5f4b", "#7c6f58", "#8d7f66", "#9e9076"),
  roof: ramp("#2e3a2a", "#384632", "#43533a", "#4f6043"),
  water: hex("#0f1a22"),
  pad: ramp("#2e5a32", "#3a6b3c"),
  cap: ramp("#5a3a6e", "#6b4a82"),
  glowCap: hex("#58d6ff"),
  window: hex("#ffb45e"),
  lantern: hex("#ffc46b"),
  sky: ramp("#05070d", "#080b14", "#0c111d", "#111828"),
};

const up: Vec3 = [0, 1, 0];

// ── the sky ──────────────────────────────────────────────────────────────────────────────────────

/** The night sky down to the far forest, its stars and the moon (a crescent), as glow. */
export function sky(p: Painter, bottom: number, moon: { x: number; y: number; r: number }, seed: number) {
  for (let y = 0; y < bottom; y++) {
    for (let x = 0; x < p.w; x++) {
      const t = y / bottom;
      const c = shade(PAL.sky, 1 - t * 0.85 - 0.08, x, y);
      let glow: RGB | undefined;
      const s = hash(x, y, seed);
      if (s > 0.9965) { const b = 120 + 135 * hash(x, y, seed + 1); glow = [b, b, b * 1.05]; }
      else if (s > 0.9935) { const b = 50 + 40 * hash(x, y, seed + 2); glow = [b * 0.9, b * 0.95, b]; }
      // The moon: a disc less a disc, a crescent, lit of itself.
      const dx = x + 0.5 - moon.x, dy = y + 0.5 - moon.y;
      const inMoon = dx * dx + dy * dy < moon.r * moon.r;
      const bite = (dx - moon.r * 0.55) ** 2 + (dy + moon.r * 0.25) ** 2 < (moon.r * 0.92) ** 2;
      if (inMoon && !bite) glow = [212, 206, 186];
      p.put(x, y, c, [0, 0, 1], 999, -1000, MAT.SKY, glow);
    }
  }
}

// ── trees ───────────────────────────────────────────────────────────────────────────────────────

const barkAt = (far: boolean) => (u: number, x: number, y: number): RGB => {
  const grain = noise(x * 0.9, y * 0.12, 7) * 0.7 + noise(x * 2.1, y * 0.4, 8) * 0.3;
  return shade(far ? PAL.barkFar : PAL.bark, grain * 0.85 + (1 - Math.abs(u)) * 0.15, x, y);
};
const leafAt = (far: boolean, seed: number) => (_u: number, v: number, _n: Vec3, x: number, y: number): RGB => {
  const clump = noise(x * 0.22, y * 0.28, seed) * 0.65 + noise(x * 0.7, y * 0.7, seed + 1) * 0.35;
  return shade(far ? PAL.leafFar : PAL.leaf, clump * 0.8 + (-v) * 0.2 + 0.1, x, y);
};

/** A crown: overlapping round clumps, ragged at the edge. */
function crown(p: Painter, cx: number, cy: number, r: number, footY: number, far: boolean, rand: () => number, seed: number) {
  const clumps = Math.max(4, Math.round(r / 4));
  for (let i = 0; i < clumps; i++) {
    const a = rand() * Math.PI * 2, d = rand() * r * 0.55;
    const cr = r * (0.42 + rand() * 0.3);
    blob(p, cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.8, cr, cr * 0.85, footY, {
      colour: leafAt(far, seed + i), mat: MAT.LEAF, ragged: 0.5, seed: seed + i * 13, bulge: cr * 0.8, sway: far ? 0 : 0.25,
    });
  }
  blob(p, cx, cy, r * 0.7, r * 0.6, footY, { colour: leafAt(far, seed), mat: MAT.LEAF, ragged: 0.45, seed: seed + 99, bulge: r * 0.5 });
}

/** A tree of the far forest: a slim trunk to its crown high up, most of it lost in the fog. */
export function farTree(p: Painter, x: number, footY: number, w: number, crownY: number, crownR: number, rand: () => number, seed: number) {
  column(p, x, w / 2, crownY, footY, barkAt(true), { bulge: w / 2 });
  if (crownR > 0) crown(p, x + (rand() - 0.5) * 6, crownY, crownR, footY, true, rand, seed);
}

/** A big tree near the viewer: roots, a broad trunk with its bark, branches and a heavy crown. */
export function bigTree(p: Painter, x: number, footY: number, r: number, crowns: { x: number; y: number; r: number }[], rand: () => number, seed: number) {
  const top = Math.min(...crowns.map((c) => c.y));
  column(p, x, r, top, footY, barkAt(false), { bulge: r });
  // Roots flaring out at the foot.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const rx = r * (0.55 - k * 0.12), cx = x + side * (r * 0.8 + k * r * 0.45);
      blob(p, cx, footY - rx * 0.35, rx, rx * 0.45, footY + 1, { colour: (u, v, n, px, py) => barkAt(false)(u, px, py), bulge: rx * 0.6 });
    }
  }
  for (const c of crowns) crown(p, c.x, c.y, c.r, footY, false, rand, seed + Math.round(c.x));
}

export function bush(p: Painter, x: number, footY: number, r: number, seed: number, rand: () => number) {
  for (let i = 0; i < 4; i++) {
    const cx = x + (rand() - 0.5) * r * 1.2, cr = r * (0.55 + rand() * 0.35);
    blob(p, cx, footY - cr * 0.75, cr, cr * 0.75, footY, { colour: leafAt(false, seed + i), mat: MAT.LEAF, ragged: 0.55, seed: seed + i * 7, sway: 0.15 });
  }
}

export function rock(p: Painter, x: number, footY: number, r: number, seed: number) {
  blob(p, x, footY - r * 0.55, r, r * 0.65, footY + 0.5, {
    colour: (u, v, n, px, py) => {
      const base = shade(PAL.stone, noise(px * 0.5, py * 0.5, seed) * 0.7 + 0.15, px, py);
      return n[1] > 0.55 && noise(px * 0.6, py * 0.9, seed + 3) > 0.45 ? shade(PAL.moss, noise(px, py, seed), px, py) : base;
    },
    ragged: 0.25, seed,
  });
}

// ── the ground ──────────────────────────────────────────────────────────────────────────────────

/** The clearing's floor from the far forest down: grass in clumps, darker under the trees and far off. */
export function ground(p: Painter, top: number, seed: number) {
  for (let y = top; y < p.h; y++) {
    const t = (y - top) / (p.h - top);
    for (let x = 0; x < p.w; x++) {
      const v = noise(x * 0.08, y * 0.16, seed) * 0.55 + noise(x * 0.3, y * 0.6, seed + 1) * 0.3 + hash(x, y, seed) * 0.15;
      const c = t < 0.12 ? shade(PAL.grassFar, v, x, y) : shade(PAL.grass, v * 0.85 + 0.05, x, y);
      p.put(x, y, c, up, 0, depthOf(y), MAT.SOLID);
    }
  }
}

/** Bare earth: a path or the trodden ground round the fire. */
export function earth(p: Painter, cx: number, cy: number, rx: number, ry: number, seed: number) {
  patch(p, cx, cy, rx, ry, (u, v, x, y) => shade(PAL.dirt, noise(x * 0.3, y * 0.5, seed) * 0.7 + 0.15, x, y), { ragged: 0.6, seed, lift: 0.01 });
}

/** A path of bare earth along a list of points, winding. */
export function path(p: Painter, pts: [number, number][], width: number, seed: number) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i]!, [x1, y1] = pts[i + 1]!;
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const w = width * (0.6 + 0.4 * ((y - pts[0]![1]) / (pts.at(-1)![1] - pts[0]![1] || 1)));
      earth(p, x, y, w, w * 0.45, seed + i);
    }
  }
}

/** Blades of grass and a few flowers over an area, each swaying from its root. */
export function tufts(p: Painter, x0: number, y0: number, x1: number, y1: number, count: number, rand: () => number, avoid: (x: number, y: number) => boolean) {
  for (let i = 0; i < count; i++) {
    const x = x0 + rand() * (x1 - x0), y = y0 + rand() * (y1 - y0);
    if (avoid(x, y)) continue;
    const near = (y - y0) / (y1 - y0 || 1);
    const blades = 2 + Math.floor(rand() * 3), len = 2 + Math.floor(rand() * (2 + near * 3));
    for (let b = 0; b < blades; b++) {
      const lean = (b - blades / 2) * 0.7 + (rand() - 0.5);
      stem(p, x + b - blades / 2, y, len + Math.floor(rand() * 2), lean, (t, px, py) => shade(PAL.grass, 0.45 + t * 0.55 + (rand() - 0.5) * 0.2, px, py), { sway: 1 });
    }
    if (rand() < 0.14) {
      const k = rand(), c = k < 0.35 ? hex("#d8d2e4") : k < 0.6 ? hex("#9a78c4") : k < 0.8 ? hex("#e2c45a") : hex("#7aa6d8");
      p.put(x, y - len - 1, c, normalize([0, 0.5, 1]), len + 1, depthOf(y) + 0.6, MAT.SOLID, undefined, 0, 1);
    }
  }
}

// ── the camp ────────────────────────────────────────────────────────────────────────────────────

/** A log lying from one point to another (x, height, foot row at each end). */
export function log(p: Painter, a: [number, number, number], b: [number, number, number], r: number, seed: number) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 1.5);
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = a[0] + (b[0] - a[0]) * t, h = a[1] + (b[1] - a[1]) * t, foot = a[2] + (b[2] - a[2]) * t;
    blob(p, x, foot - h - r, r, r, foot, {
      colour: (u, v, nn, px, py) => (k === 0 || k === n ? shade(PAL.wood, 0.85 - Math.hypot(u, v) * 0.5, px, py) : shade(PAL.bark, noise(px * 0.8, py * 0.3, seed) * 0.8 + 0.1, px, py)),
      bulge: r,
    });
  }
}

/** The fire's ring of stones round a bed of ash, and the logs laid in it. Returns where the fire burns. */
export function fireRing(p: Painter, cx: number, cy: number, k: number, seed: number, rand: () => number) {
  patch(p, cx, cy, 11 * k, 4.6 * k, (u, v, x, y) => (Math.hypot(u, v) < 0.62 ? shade(ramp("#1c1714", "#2a211b", "#3a2c22"), hash(x, y, seed), x, y) : null), { lift: 0.02 });
  const stones = 13;
  for (let i = 0; i < stones; i++) {
    const a = (i / stones) * Math.PI * 2 + rand() * 0.2;
    const sx = cx + Math.cos(a) * 10 * k, sy = cy + Math.sin(a) * 4.2 * k;
    rock(p, sx, sy + 1, (2 + rand() * 1.4) * k, seed + i);
  }
  log(p, [cx - 6 * k, 0, cy + 1], [cx + k, 4 * k, cy], 1.4 * k, seed + 50);
  log(p, [cx + 6 * k, 0, cy - 1], [cx - k, 4 * k, cy], 1.4 * k, seed + 51);
  log(p, [cx - 2 * k, 0, cy - 3 * k], [cx + k, 3.5 * k, cy + 0.5], 1.2 * k, seed + 52);
  return { x: cx, y: cy };
}

/** A canvas tent: its front a triangle with the flap open, its roof running back to the right. */
export function tent(p: Painter, cx: number, footY: number, half: number, tall: number, seed: number) {
  const back = Math.round(half * 0.9), rise = Math.round(half * 0.45);
  // The right slope: the parallelogram from the ridge and the right eave, carried back by (back, -rise).
  const A = [cx, footY - tall], B = [cx + half, footY];
  const ex = B[0]! - A[0]!, ey = B[1]! - A[1]!, det = ex * -rise - back * ey;
  for (let y = footY - tall - rise; y <= footY; y++) {
    for (let x = cx; x <= cx + half + back; x++) {
      const qx = x + 0.5 - A[0]!, qy = y + 0.5 - A[1]!;
      const a = (qx * -rise - back * qy) / det, b = (ex * qy - ey * qx) / det;
      if (a < 0 || a > 1 || b < 0 || b > 1) continue;
      const c = shade(PAL.canvas, 0.25 + noise(x * 0.5, y * 0.2, seed) * 0.35 + (1 - a) * 0.15, x, y);
      p.put(x, y, c, normalize([0.7, 0.55, 0.2]), tall * (1 - a), depthOf(footY - b * rise) + 0.1, MAT.SOLID);
    }
  }
  // The front: a triangle facing the viewer, the open flap a dark doorway.
  for (let y = footY - tall; y <= footY; y++) {
    const k = (footY - y) / tall, w = half * (1 - k);
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
      const door = Math.abs(x - cx) < w * 0.45 && k < 0.72;
      const c = door ? hex("#120e0b") : shade(PAL.canvas, 0.55 + noise(x * 0.4, y * 0.3, seed + 1) * 0.3, x, y);
      p.put(x, y, c, normalize([0, 0.3, 1]), footY - y, depthOf(footY) + 0.5, MAT.SOLID);
    }
  }
  // The front pole showing above the ridge.
  for (let k = 1; k < 4; k++) p.put(cx, footY - tall - k, hex("#5b4029"), [0, 0, 1], tall + k, depthOf(footY) + 0.6, MAT.SOLID);
}

/**
 * The stump cottage: a hollow old stump with a door, round windows lit from inside, a mossy roof
 * and a crooked chimney. Returns its windows (for their light) and the chimney's top (for its smoke).
 */
export function stumpHouse(p: Painter, cx: number, footY: number, r: number, seed: number, rand: () => number) {
  const body = Math.round(r * 1.5), roofH = Math.round(r * 0.95);
  const top = footY - body;
  column(p, cx, r, top, footY, (u, x, y) => {
    const grain = noise(x * 0.7, y * 0.09, seed) * 0.75 + noise(x * 2, y * 0.3, seed + 1) * 0.25;
    return shade(PAL.bark, grain * 0.9 + 0.05, x, y);
  });
  // Roots.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const rr = r * (0.38 - k * 0.08), x = cx + side * (r * 0.75 + k * r * 0.32);
      blob(p, x, footY - rr * 0.4, rr, rr * 0.5, footY + 1, { colour: (u, v, n, px, py) => shade(PAL.bark, noise(px * 0.6, py * 0.3, seed) * 0.8, px, py), bulge: rr * 0.6 });
    }
  }
  // The roof: a low cone of moss and shingles, overhanging the stump.
  const rr = r * 1.22;
  for (let y = top - roofH; y <= top + 3; y++) {
    const k = clamp((top + 3 - y) / (roofH + 3)), w = rr * (1 - k * k * 0.15) * (1 - k * 0.92);
    for (let x = Math.floor(cx - w); x <= Math.ceil(cx + w); x++) {
      const u = (x + 0.5 - cx) / Math.max(1, w);
      if (Math.abs(u) > 1) continue;
      const nz = Math.sqrt(1 - u * u);
      const n = normalize([u * 0.8, 0.75, nz * 0.6]);
      const shingle = ((y - top) & 3) === 0 ? 0.0 : 0.3;
      const c = shade(PAL.roof, shingle + noise(x * 0.5, y * 0.8, seed + 4) * 0.55 + 0.1, x, y);
      p.put(x, y, c, n, footY - y, depthOf(footY) + nz * rr + 1, MAT.SOLID, undefined, 0, 0);
    }
  }
  // The door: an arch of planks, a dark doorstep.
  const dx = cx - Math.round(r * 0.25), dw = Math.max(3, Math.round(r * 0.28)), dh = Math.round(body * 0.5);
  for (let y = footY - dh; y <= footY; y++) {
    for (let x = dx - dw; x <= dx + dw; x++) {
      const u = (x - dx) / dw, archTop = footY - dh + Math.round(dw * (1 - Math.sqrt(Math.max(0, 1 - u * u))));
      if (y < archTop) continue;
      const edge = Math.abs(x - dx) === dw || y === archTop;
      const c = edge ? hex("#2a1d14") : shade(PAL.wood, ((x - dx + dw) % 3 === 0 ? 0.1 : 0.6) + hash(x, y, seed) * 0.2, x, y);
      const u2 = (x + 0.5 - cx) / r;
      p.put(x, y, c, [u2, 0, Math.sqrt(Math.max(0, 1 - u2 * u2))], footY - y, depthOf(footY) + r + 0.5, MAT.SOLID);
    }
  }
  const knob: [number, number] = [dx + dw - 2, footY - Math.round(dh * 0.45)];
  p.put(knob[0], knob[1], hex("#c9a04a"), [0, 0, 1], footY - knob[1], depthOf(footY) + r + 0.6, MAT.SOLID);
  // Round windows, lit from inside.
  const windows: { x: number; y: number; h: number; z: number }[] = [];
  for (const [ox, oy, wr] of [[r * 0.45, body * 0.55, r * 0.17], [-r * 0.62, body * 0.72, r * 0.13]] as const) {
    const wx = cx + ox, wy = footY - oy, R = Math.max(1.6, wr);
    for (let y = Math.floor(wy - R - 1); y <= Math.ceil(wy + R + 1); y++) {
      for (let x = Math.floor(wx - R - 1); x <= Math.ceil(wx + R + 1); x++) {
        const d = Math.hypot(x + 0.5 - wx, y + 0.5 - wy);
        if (d > R + 1) continue;
        const u2 = (x + 0.5 - cx) / r, n: Vec3 = [u2, 0, Math.sqrt(Math.max(0, 1 - u2 * u2))];
        const frame = d > R;
        const cross = !frame && (Math.abs(x + 0.5 - wx) < 0.6 || Math.abs(y + 0.5 - wy) < 0.6);
        const glow = frame || cross ? undefined : (mix(PAL.window, hex("#ffe3a8"), clamp(1 - d / R)) as RGB);
        p.put(x, y, frame || cross ? hex("#3a281b") : hex("#6b4a2a"), n, footY - y, depthOf(footY) + r + 0.7, MAT.SOLID, glow);
      }
    }
    windows.push({ x: wx, y: wy, h: footY - wy, z: depthOf(footY) + r + 3 });
  }
  // A crooked chimney of stones on the roof.
  const chx = cx + Math.round(rr * 0.45), chBase = top - Math.round(roofH * 0.35);
  for (let k = 0; k < 9; k++) {
    const x = chx + (k > 5 ? 1 : 0);
    for (let w = -1; w <= 1; w++) p.put(x + w, chBase - k, shade(PAL.stone, 0.3 + hash(x + w, k, seed) * 0.5, x + w, chBase - k), normalize([w * 0.6, 0.2, 1]), footY - chBase + k, depthOf(footY) + rr + 2, MAT.SOLID);
  }
  // Moss and a few mushrooms about its foot.
  for (let i = 0; i < 5; i++) {
    const mx = cx + (rand() - 0.5) * r * 2.2;
    mushroom(p, mx, footY + 1 + rand() * 2, 1.6 + rand(), false, seed + i);
  }
  return { windows, chimney: { x: chx + 1, y: chBase - 9, h: footY - chBase + 9, z: depthOf(footY) + rr + 2 } };
}

/** A mushroom: a cap on a pale stem. A glowing one gives off a cold blue light. */
export function mushroom(p: Painter, x: number, footY: number, r: number, glows: boolean, seed: number) {
  const stemH = Math.max(1, Math.round(r * 1.1));
  for (let k = 0; k < stemH; k++) p.put(x, footY - k, hex("#b8b0a0"), [0, 0, 1], k, depthOf(footY) + 0.8, MAT.SOLID);
  blob(p, x, footY - stemH - r * 0.35, r, r * 0.6, footY, {
    colour: (u, v, n, px, py) => (glows ? mix(hex("#2f6b86"), hex("#7fdcff"), clamp(-v * 0.5 + 0.4)) : hash(px, py, seed) > 0.8 && v < 0.2 ? hex("#e8dcc8") : shade(PAL.cap, -v * 0.6 + 0.3, px, py)),
    glow: glows ? (u, v) => [40 + 60 * (1 - Math.abs(u)), 140 + 60 * (1 - Math.abs(u)), 190 + 50 * (1 - Math.abs(u))] : undefined,
    bulge: r, round: 0.9,
  });
}

/** A lantern on a post, with its arm. Returns where its flame is. */
export function lanternPost(p: Painter, x: number, footY: number, tall: number, side: 1 | -1) {
  column(p, x, 1, footY - tall, footY, (u, px, py) => shade(PAL.wood, 0.4 + (u + 1) * 0.25, px, py));
  const armY = footY - tall + 1;
  for (let k = 1; k <= 4; k++) p.put(x + side * k, armY, shade(PAL.wood, 0.5, x + side * k, armY), up, tall - 1, depthOf(footY) + 1.2, MAT.SOLID);
  const lx = x + side * 4, ly = armY + 2;
  for (let dy = 0; dy < 5; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const frame = dy === 0 || dy === 4 || Math.abs(dx) === 1 && (dy === 1 || dy === 3);
      p.put(lx + dx, ly + dy, frame ? hex("#2b2420") : hex("#c08a40"), [dx * 0.5, 0, 1], footY - ly - dy, depthOf(footY) + 1.4, MAT.SOLID, frame ? undefined : (dy === 2 ? [255, 220, 140] : [230, 160, 80]));
    }
  }
  return { x: lx, y: ly + 2, h: footY - ly - 2, z: depthOf(footY) + 3 };
}

/**
 * The pond: dark water that mirrors what stands beyond it, a muddy bank, reeds and lily pads.
 * Each water pixel holds the row it mirrors about: the far bank above it.
 */
export function pond(p: Painter, cx: number, cy: number, rx: number, ry: number, seed: number, rand: () => number) {
  const edge = (x: number) => { const u = (x + 0.5 - cx) / rx; return cy - ry * Math.sqrt(Math.max(0, 1 - u * u)); };
  patch(p, cx, cy, rx + 3, ry + 1.6, (u, v, x, y) => shade(ramp("#2a2a22", "#36352a", "#433f30"), noise(x * 0.4, y * 0.6, seed) * 0.8, x, y), { ragged: 0.25, seed, lift: 0.01 });
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const u = (x + 0.5 - cx) / rx, v = (y + 0.5 - cy) / ry;
      if (u * u + v * v + (noise(x * 0.25, y * 0.5, seed + 1) - 0.5) * 0.15 > 1) continue;
      p.put(x, y, PAL.water, up, 0, depthOf(y) + 0.02, MAT.WATER, undefined, Math.floor(edge(x)) - 1);
    }
  }
  // Lily pads, a few in flower.
  for (let i = 0; i < Math.round(rx / 5); i++) {
    const a = rand() * Math.PI * 2, d = 0.3 + rand() * 0.55;
    const px = cx + Math.cos(a) * rx * d, py = cy + Math.sin(a) * ry * d, pr = 1.8 + rand() * 1.6;
    patch(p, px, py, pr, pr * 0.5, (u, v, x, y) => (u > 0.2 && Math.abs(v) < 0.25 ? null : shade(PAL.pad, 0.3 + hash(x, y, seed + i) * 0.6, x, y)), { lift: 0.05 });
    if (rand() < 0.35) p.put(px, py - 1, hex("#e9c6d6"), [0, 0.6, 0.8], 1, depthOf(py) + 0.1, MAT.SOLID);
  }
  // Reeds and rushes at the bank, a few cattails.
  for (let i = 0; i < Math.round(rx * 0.9); i++) {
    const a = Math.PI + rand() * Math.PI * (rand() < 0.5 ? 0.5 : 1);
    const bx = cx + Math.cos(a) * (rx + 1), by = cy + Math.sin(a) * (ry + 0.5);
    const len = 4 + Math.floor(rand() * 7), lean = (rand() - 0.5) * 1.2;
    stem(p, bx, by, len, lean, (t, x, y) => shade(PAL.grass, 0.3 + t * 0.6, x, y), { sway: 1.2 });
    if (rand() < 0.3) {
      const tx = bx + lean * len * 0.5, ty = by - len;
      for (let k = 0; k < 3; k++) p.put(tx, ty - k, hex("#4a3020"), [0, 0, 1], len + k, depthOf(by) + 0.6, MAT.SOLID, undefined, 0, 1.2);
    }
  }
  return { cx, cy, rx, ry };
}

/** A stack of split logs, their cut ends toward the viewer, three rows high. */
export function woodpile(p: Painter, x: number, footY: number, cols: number, seed: number) {
  for (let row = 0; row < 3; row++) {
    const n = cols - row;
    for (let i = 0; i < n; i++) {
      const cx = x + (i - (n - 1) / 2) * 4.2, cy = footY - 2 - row * 3.6;
      blob(p, cx, cy, 2.1, 1.9, footY, {
        colour: (u, v, nn, px, py) => {
          const r = Math.hypot(u, v);
          return r > 0.78 ? shade(PAL.bark, 0.3, px, py) : shade(PAL.wood, 0.9 - r * 0.6 + (hash(px, py, seed) - 0.5) * 0.2, px, py);
        },
        round: 0.35, bulge: 3,
      });
    }
  }
}

/** An old stump with candles burning on it. Returns where each flame is, for its light. */
export function candleStump(p: Painter, x: number, footY: number, r: number, seed: number) {
  const top = footY - Math.round(r * 1.1);
  column(p, x, r, top, footY, (u, px, py) => shade(PAL.bark, noise(px * 0.8, py * 0.2, seed) * 0.8 + 0.1, px, py));
  // Its cut top, seen from above: rings.
  patch(p, x, top, r, r * 0.42, (u, v, px, py) => (Math.hypot(u, v) > 0.85 ? shade(PAL.bark, 0.2, px, py) : shade(PAL.wood, 0.75 - ((Math.hypot(u, v) * 4) % 1 < 0.3 ? 0.35 : 0), px, py)), { lift: 1 });
  const flames: { x: number; y: number; h: number; z: number }[] = [];
  for (const [dx, tall] of [[-r * 0.45, 4], [r * 0.1, 6], [r * 0.5, 3]] as const) {
    const cx = Math.round(x + dx);
    for (let k = 0; k < tall; k++) p.put(cx, top - 1 - k, hex("#e9e2cf"), [0, 0, 1], footY - top + 1 + k, depthOf(footY) + r + 1, MAT.SOLID);
    p.put(cx, top - 1 - tall, hex("#ffd27a"), [0, 0, 1], footY - top + 1 + tall, depthOf(footY) + r + 1.1, MAT.SOLID, [255, 214, 130]);
    p.put(cx, top - 2 - tall, hex("#ff9a3c"), [0, 0, 1], footY - top + 2 + tall, depthOf(footY) + r + 1.1, MAT.SOLID, [255, 150, 60]);
    flames.push({ x: cx, y: top - 1 - tall, h: footY - top + 2 + tall, z: depthOf(footY) + r + 3 });
  }
  return flames;
}

/** A signpost: two boards on a post, pointing two ways. */
export function signpost(p: Painter, x: number, footY: number, tall: number) {
  column(p, x, 1, footY - tall, footY, (u, px, py) => shade(PAL.wood, 0.35 + (u + 1) * 0.2, px, py));
  for (const [y, dir, len] of [[footY - tall + 2, 1, 9], [footY - tall + 6, -1, 8]] as const) {
    for (let k = 0; k < len; k++) {
      for (let r = 0; r < 3; r++) {
        const tip = k === len - 1 && r !== 1;
        if (tip) continue;
        p.put(x + dir * (k + 1), y + r, shade(PAL.wood, r === 0 ? 0.85 : r === 2 ? 0.25 : 0.6, x + k, y + r), [0, 0.2, 1], footY - y - r, depthOf(footY) + 1.5, MAT.SOLID);
      }
    }
  }
}

/** A toadstool: a red cap spotted white on a pale stem. */
export function toadstool(p: Painter, x: number, footY: number, r: number, seed: number) {
  const stemH = Math.max(2, Math.round(r * 1.3));
  for (let k = 0; k < stemH; k++) for (const dx of r > 2.2 ? [-0.5, 0.5] : [0]) p.put(x + dx, footY - k, hex("#d8cfbf"), [dx, 0, 1], k, depthOf(footY) + 0.8, MAT.SOLID);
  blob(p, x, footY - stemH - r * 0.3, r, r * 0.62, footY, {
    colour: (u, v, n, px, py) => (hash(px, py, seed) > 0.78 && v < 0.3 ? hex("#f1e8dc") : shade(ramp("#7a1a16", "#a1261c", "#c23a26"), -v * 0.6 + 0.35, px, py)),
    bulge: r, round: 0.9,
  });
}
