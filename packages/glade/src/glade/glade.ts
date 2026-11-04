/**
 * The glade laid out for a screen: a clearing in a deep forest at night. The far forest stands all
 * round, thinner and greyer the further off it is, the moon in a gap of sky above. In the clearing a
 * campfire burns in its ring of stones, a tent behind it; an old stump has been made a cottage, its
 * round windows lit; lanterns stand along the path; a pond lies to the right, mirroring the lanterns
 * beyond it; glowing mushrooms grow at the trees' feet. Big trees close in at the sides.
 *
 * Everything that does not move is painted once for the screen's size into the still layers; what
 * moves (the fire, the smoke, the animals, the fireflies, the rain) is the life's to draw each frame.
 * The same size and seed give the same glade.
 */
import { bigTree, bush, candleStump, earth, farTree, fireRing, ground, lanternPost, log, mushroom, path, pond, rock, signpost, sky, stumpHouse, tent, toadstool, tufts, woodpile } from "./art";
import { depthOf, hex, MAT, Painter, rng, type RGB } from "./px";

/** A light the glade's still things give off: where it is (x, height, depth), its colour, its reach. */
export interface Light {
  x: number; h: number; z: number;
  colour: RGB;
  /** How far it reaches, in art pixels. */
  reach: number;
  /** How strong it is. */
  power: number;
  /** How it flickers: 0 steady, 1 a candle, 2 a lamp behind glass. */
  flicker: number;
  /** Which of the day's lights it is: lamps go out by day. */
  lamp?: boolean;
}

export interface Glade {
  w: number; h: number;
  still: Painter;
  lights: Light[];
  /** The far edge of the clearing: the forest's floor row. */
  edge: number;
  fire: { x: number; y: number };
  chimney: { x: number; y: number; h: number; z: number };
  pond: { cx: number; cy: number; rx: number; ry: number };
  /** Where the fox sleeps by the fire. */
  fox: { x: number; y: number };
  moon: { x: number; y: number; r: number };
  /** Spots in the dark of the forest where eyes may shine. */
  eyes: { x: number; y: number; z: number }[];
  /** The tent's door, the cottage's door: where a walker goes in and out. */
  doors: { x: number; y: number }[];
}

/** The size of the art for a screen: about 240 rows, each art pixel a whole number of CSS pixels. */
export function artSize(w: number, h: number) {
  const px = Math.max(2, Math.round(h / 240));
  return { px, w: Math.ceil(w / px), h: Math.ceil(h / px) };
}

export function layGlade(W: number, H: number, seed = 7): Glade {
  const p = new Painter(W, H);
  const rand = rng(seed * 7919 + W * 31 + H);
  const edge = Math.round(H * 0.47);
  const moon = { x: Math.round(W * 0.6), y: Math.round(H * 0.095), r: Math.max(5, Math.round(H * 0.028)) };
  const lights: Light[] = [];

  sky(p, edge + 2, moon, seed);
  ground(p, edge, seed);

  // The far forest, in rows from the farthest: slim trunks into the fog, crowns high up, a gap of sky
  // round the moon.
  const nearMoon = (x: number) => Math.abs(x - moon.x) < W * 0.14;
  for (let x = -8; x < W + 8; x += 6 + rand() * 7) {
    const gap = nearMoon(x);
    farTree(p, x, edge - 1 + rand() * 3, 2 + Math.round(rand()), gap ? H * (0.27 + rand() * 0.05) : rand() * H * 0.17, gap ? 7 + rand() * 4 : 12 + rand() * 11, rand, seed + Math.round(x));
  }
  for (let x = -12; x < W + 12; x += 15 + rand() * 14) {
    const gap = nearMoon(x);
    farTree(p, x, edge + 3 + rand() * 5, 3 + Math.round(rand() * 2), gap ? H * (0.24 + rand() * 0.04) : rand() * H * 0.15, gap ? 9 + rand() * 4 : 16 + rand() * 12, rand, seed + 500 + Math.round(x));
  }
  // Bushes along the forest's edge.
  for (let x = rand() * 20; x < W; x += 18 + rand() * 30) bush(p, x, edge + 2 + rand() * 6, 5 + rand() * 4, seed + 900 + Math.round(x), rand);
  // Nearer trees at the sides, standing in the clearing's edge.
  for (const side of [0, 1]) {
    for (let k = 0; k < 3; k++) {
      const x = side ? W * (0.84 + k * 0.055 + rand() * 0.02) : W * (0.03 + k * 0.06 + rand() * 0.02);
      const foot = edge + 12 + rand() * 26;
      farTree(p, x, foot, 5 + Math.round(rand() * 3), rand() * H * 0.12, 18 + rand() * 10, rand, seed + 1300 + k * 17 + side * 101);
    }
  }

  // The clearing: paths, the cottage, the tent and the fire.
  const fire = { x: Math.round(W * 0.5), y: Math.round(edge + (H - edge) * 0.44) };
  const house = { x: Math.round(W * 0.235), y: Math.round(edge + (H - edge) * 0.24) };
  path(p, [[W * 0.43, H + 6], [W * 0.4, H * 0.86], [W * 0.31, H * 0.76], [house.x - 2, house.y + 3]], 6, seed + 11);
  path(p, [[W * 0.36, H * 0.79], [fire.x - 14, fire.y + 4]], 4, seed + 12);
  earth(p, fire.x, fire.y + 1, 26, 9, seed + 13);

  const hr = Math.max(16, Math.round(H * 0.085));
  const home = stumpHouse(p, house.x, house.y, hr, seed + 20, rand);
  for (const w of home.windows) lights.push({ x: w.x, h: w.h, z: w.z, colour: hex("#ffa850"), reach: 34, power: 0.9, flicker: 2, lamp: true });

  const tx = Math.round(fire.x + W * 0.1), ty = fire.y - Math.round(H * 0.05);
  tent(p, tx, ty, Math.max(11, Math.round(H * 0.05)), Math.max(14, Math.round(H * 0.068)), seed + 30);
  fireRing(p, fire.x, fire.y, Math.max(1, H / 220), seed + 40, rand);
  woodpile(p, tx + Math.round(H * 0.075), ty + 2, 4, seed + 31);
  log(p, [fire.x - 27, 0, fire.y + 2], [fire.x - 15, 0, fire.y + 6], 2, seed + 41);
  log(p, [fire.x + 9, 0, fire.y - 8], [fire.x + 19, 0, fire.y - 6], 1.6, seed + 42);

  // Lanterns along the path and beyond the pond.
  const lamps: [number, number, 1 | -1][] = [[W * 0.335, H * 0.9, 1], [W * 0.3, H * 0.7, -1], [W * 0.805, H * 0.72, -1], [house.x + hr * 1.25, house.y + 3, -1]];
  for (const [x, y, side] of lamps) {
    const l = lanternPost(p, Math.round(x), Math.round(y), Math.max(14, Math.round(H * 0.06)), side);
    lights.push({ x: l.x, h: l.h, z: l.z, colour: hex("#ffb85c"), reach: 40, power: 1, flicker: 1, lamp: true });
  }

  // Candles on an old stump, a signpost where the paths part, toadstools by the trees.
  for (const c of candleStump(p, Math.round(W * 0.89), Math.round(H * 0.7), Math.max(5, Math.round(H * 0.024)), seed + 60)) {
    lights.push({ x: c.x, h: c.h, z: c.z, colour: hex("#ffb35c"), reach: 26, power: 0.55, flicker: 1, lamp: true });
  }
  signpost(p, Math.round(W * 0.37), Math.round(H * 0.8), Math.max(12, Math.round(H * 0.06)));
  for (const [x, y, n] of [[W * 0.15, edge + 30, 3], [W * 0.06, H * 0.98, 2], [W * 0.58, H * 0.66, 2], [W * 0.95, H * 0.97, 3], [W * 0.41, edge + 10, 2]] as const) {
    for (let i = 0; i < n; i++) toadstool(p, x + (rand() - 0.5) * 12, y + (rand() - 0.5) * 3, 1.6 + rand() * 1.6, seed + 70 + i);
  }

  // The pond, lower right.
  const pd = pond(p, Math.round(W * 0.72), Math.round(H * 0.85), Math.max(30, Math.round(W * 0.1)), Math.max(10, Math.round(H * 0.055)), seed + 50, rand);

  // Big trees closing in at the sides, their crowns over the top corners.
  const big = (x: number, foot: number, r: number, dir: number) => bigTree(p, x, foot, r, [
    { x: x + dir * r * 1.6, y: H * 0.05, r: H * 0.15 },
    { x: x - dir * r * 0.8, y: H * 0.18, r: H * 0.11 },
    { x: x + dir * r * 3.4, y: H * 0.12, r: H * 0.1 },
    { x: x + dir * r * 0.5, y: H * 0.3, r: H * 0.08 },
  ], rand, seed + Math.round(x));
  big(Math.round(W * 0.035), Math.round(H * 0.965), Math.max(7, Math.round(H * 0.032)), 1);
  big(Math.round(W * 0.965), Math.round(H * 0.95), Math.max(8, Math.round(H * 0.036)), -1);

  // Glowing mushrooms at the trees' feet, and by the pond.
  const glowing: [number, number][] = [[W * 0.07, H * 0.95], [W * 0.92, H * 0.93], [W * 0.84, H * 0.78], [W * 0.11, edge + 26]];
  for (const [gx, gy] of glowing) {
    for (let i = 0; i < 4 + Math.floor(rand() * 3); i++) mushroom(p, gx + (rand() - 0.5) * 10, gy + (rand() - 0.5) * 3, 1.4 + rand() * 1.4, true, seed + i);
    lights.push({ x: gx, h: 3, z: depthOf(gy) + 2, colour: hex("#4ccaff"), reach: 18, power: 0.55, flicker: 0 });
  }

  // Rocks, bushes near the viewer, grass everywhere it can grow.
  for (let i = 0; i < 7; i++) {
    const x = rand() * W, y = edge + 8 + rand() * (H - edge - 8);
    if (p.matAt(x, y) === MAT.WATER || Math.hypot(x - fire.x, (y - fire.y) * 2.5) < 34 || Math.hypot(x - house.x, (y - house.y) * 2) < hr * 2) continue;
    rock(p, x, y, 2 + rand() * 3, seed + 70 + i);
  }
  for (const [x, y, r] of [[W * 0.16, H * 1.0, 13], [W * 0.27, H * 1.02, 9], [W * 0.6, H * 1.03, 11], [W * 0.86, H * 1.02, 14]] as const) bush(p, x, y, r, seed + 80 + Math.round(x), rand);
  const avoid = (x: number, y: number) => p.matAt(x, y) === MAT.WATER || Math.hypot(x - fire.x, (y - fire.y) * 2.5) < 30 || Math.abs(x - house.x) < hr * 1.1 && y < house.y + 2 && y > house.y - hr * 2;
  tufts(p, 0, edge + 3, W, H + 2, Math.round(W * (H - edge) * 0.03), rand, avoid);

  const eyes = Array.from({ length: 6 }, (_, i) => ({ x: Math.round(W * (0.08 + 0.84 * ((i * 0.618 + rand() * 0.2) % 1))), y: Math.round(edge - 6 - rand() * H * 0.12), z: depthOf(edge) - 4 }));
  return {
    w: W, h: H, still: p, lights, edge, fire, chimney: home.chimney, pond: pd, moon, eyes,
    fox: { x: fire.x + 17, y: fire.y - 3 },
    doors: [{ x: house.x - Math.round(hr * 0.25), y: house.y + 1 }, { x: tx, y: ty + 1 }],
  };
}
