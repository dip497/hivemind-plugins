/**
 * Koi Pond's surface and its banks: lily pads that drift and turn slowly on the water, some with a
 * flower, rings where something touches it, and reeds and rushes along the bank at the bottom of
 * the window, thickest in its corners, swaying in the breeze. The pads are laid out once per window
 * from a fixed seed; what a cell of a pad is (`padCell`) is worked out from the pad's own shape, so
 * a pad looks the same wherever it has drifted to.
 */
import type { Blade } from "../blades";
import { angleDiff, prng, rand, TAU } from "../math";

export interface Pad {
  x: number;
  y: number;
  /** Radius, in px. */
  r: number;
  /** Which way its notch points, and how wide the notch is either side. */
  turn: number;
  notch: number;
  /** How fast it turns (rad/s) and drifts (px/s). */
  spin: number;
  vx: number;
  vy: number;
  /** Where its flower sits (an angle from the middle), or null for none. */
  flower: number | null;
  seed: number;
}

export interface Ripple {
  x: number;
  y: number;
  /** Seconds since it started. */
  age: number;
  /** 0 to 1: how far it spreads and how bright it starts. */
  strength: number;
}

/** A plant on the bank: a reed, its long leaves springing off its stem; a rush, a bare stem; or a
 *  cattail, its head dark, a little below its tip. */
export interface Reed extends Blade {
  kind: "reed" | "rush" | "cattail";
  /** Further back on the bank: paler. */
  far: boolean;
  /** Its leaves: each how far up it springs, to which side, and how many cells long. */
  leaves: { k: number; side: 1 | -1; length: number }[];
}

/** What a cell of a pad is. */
export const PadPart = { None: 0, Leaf: 1, Rim: 2, Vein: 3, Petal: 4, Heart: 5 } as const;
export type PadPart = (typeof PadPart)[keyof typeof PadPart];

/** How long a ring lasts, and how fast it spreads. */
export const RIPPLE_LIFE = 2.4;
export const RIPPLE_SPEED = 64;
/** At most this many rings at once: the oldest goes first. */
const MAX_RIPPLES = 14;

/** The veins: this many, evenly round the pad from its notch. */
const VEINS = 6;

/** What the point (dx, dy) from a pad's middle is on it: a cell `cw` wide judges how near a vein
 *  or the rim it is. */
export function padCell(p: Pad, dx: number, dy: number, cw: number): PadPart {
  const d = Math.hypot(dx, dy);
  if (d > p.r) return PadPart.None;
  const a = Math.atan2(dy, dx);
  // The notch: a wedge cut from the rim to near the middle.
  if (d > cw * 1.2 && Math.abs(angleDiff(p.turn, a)) < p.notch) return PadPart.None;
  if (p.flower !== null) {
    const fx = Math.cos(p.flower) * p.r * 0.45;
    const fy = Math.sin(p.flower) * p.r * 0.45;
    const f = Math.hypot(dx - fx, (dy - fy) * 1.45);
    if (f < cw * 0.8) return PadPart.Heart;
    if (f < cw * 2.1) return PadPart.Petal;
  }
  if (d > p.r - cw * 0.85) return PadPart.Rim;
  // A vein: within half a cell of a line out from the middle.
  const step = TAU / VEINS;
  const off = Math.abs((((a - p.turn - step / 2) % step) + step) % step - step / 2);
  if (d > cw * 0.9 && off * d < cw * 0.5) return PadPart.Vein;
  return PadPart.Leaf;
}

/** The bank for a grid of `cols` by `rows`, from a fixed seed, so a window shows the same bank each
 *  time: its mud in each bottom corner, how many rows deep in each column, and the plants on it. A
 *  bed of reeds, rushes and cattails in each corner, tallest by the corner and fanning out from it,
 *  some a third of the way up the window; a few clumps along the bank between, and a few paler ones
 *  further back in each. Each sways out of step with the next, the tallest the most. */
export function bankOf(cols: number, rows: number): { reeds: Reed[]; mud: Uint8Array } {
  const rnd = prng(0x2eed + cols * 17 + rows);
  const bottom = rows - 1;
  const tallest = Math.max(9, Math.round(rows * 0.34));
  const corner = Math.max(9, Math.round(cols * 0.09));
  // The mud: two or three rows deep in a corner, thinning to none along the bank.
  const mud = Uint8Array.from({ length: cols }, (_, c) => {
    const d = Math.min(c, cols - 1 - c) / (corner * 1.4);
    return d >= 1 ? 0 : Math.max(0, Math.round((1 - d) * (2.2 + rnd() * 0.8)));
  });
  const out: Reed[] = [];
  const plant = (c: number, height: number, slant: number, kind: Reed["kind"], far: boolean) => {
    if (c < 0 || c >= cols || height < 2) return;
    const leaves: Reed["leaves"] = [];
    if (kind !== "rush" && height >= 6) {
      // A reed's leaves spring off its stem and arch out; a cattail's stand close by its stalk.
      for (let n = kind === "reed" ? 2 : 1; n > 0; n--) leaves.push({ k: Math.round(height * (0.15 + 0.35 * rnd())), side: rnd() < 0.5 ? 1 : -1, length: kind === "reed" ? 2 + Math.floor(rnd() * 2) : 1 });
    }
    out.push({ c, foot: bottom - Math.max(0, mud[c]! - 1), height, reach: 0.5 + height * 0.06, rate: 0.5 + rnd() * 0.3, wave: 0.12, phase: rnd() * Math.PI * 2, slant, kind, far, leaves });
  };
  /** A bed at column `at`, `span` columns wide, `tall` cells at its tallest, fanning away from
   *  `toward` (-1 left, 1 right, 0 both ways). */
  const bed = (at: number, span: number, tall: number, toward: number) => {
    // A cattail at its root, as tall as the bed grows; the rest about it.
    plant(at, tall, toward * tall * 0.15, "cattail", false);
    for (let n = Math.round(span * 1.3); n > 0; n--) {
      const k = rnd();
      const c = Math.round(at + (toward === 0 ? (k - 0.5) * span : toward * k * span));
      // Tallest at the bed's root, shorter out along it, and no two alike.
      const height = Math.round(tall * (1 - 0.65 * k) * (0.5 + 0.5 * rnd()));
      const slant = (toward === 0 ? (k - 0.5) * 2 : toward * (0.2 + k)) * height * 0.3 + (rnd() - 0.5) * 3;
      const r = rnd();
      plant(c, height, slant, height > tall * 0.5 && r < 0.3 ? "cattail" : r < 0.65 ? "reed" : "rush", false);
      if (rnd() < 0.5) plant(c + (rnd() < 0.5 ? -1 : 1), Math.round(height * (0.5 + 0.3 * rnd())), slant * 0.5, "rush", true);
    }
  };
  bed(0, corner, tallest, 1);
  bed(cols - 1, corner, tallest, -1);
  for (let n = Math.max(1, Math.round(cols / 70)); n > 0; n--) bed(Math.round(cols * (0.22 + 0.56 * rnd())), 5, Math.max(5, Math.round(tallest * 0.4)), 0);
  // The paler ones first: they stand behind.
  return { reeds: out.sort((a, b) => Number(b.far) - Number(a.far)), mud };
}

export class Pond {
  pads: Pad[] = [];
  ripples: Ripple[] = [];
  private width = 0;
  private height = 0;
  /** When something next drops on the water somewhere. */
  private nextDrop = 0;
  private time = 0;

  /** Pads for a window: about one to a 360 px square, apart from each other. */
  build(W: number, H: number) {
    this.width = W;
    this.height = H;
    const rnd = prng(0x1f0 + Math.round(W) * 7 + Math.round(H));
    const n = Math.max(4, Math.min(14, Math.round((W * H) / 130000)));
    const unit = Math.min(W, H) / 900;
    this.pads = [];
    for (let tries = 0; this.pads.length < n && tries < n * 30; tries++) {
      const r = (28 + rnd() * 40) * Math.max(0.7, unit);
      const x = rnd() * W;
      const y = rnd() * H;
      if (this.pads.some((p) => Math.hypot(p.x - x, p.y - y) < (p.r + r) * 1.15)) continue;
      const k = this.pads.length;
      this.pads.push({
        x, y, r,
        turn: rnd() * TAU,
        notch: 0.22 + rnd() * 0.18,
        spin: (rnd() - 0.5) * 0.04,
        vx: (rnd() - 0.5) * 5,
        vy: (rnd() - 0.5) * 3,
        flower: k % 3 === 1 ? rnd() * TAU : null,
        seed: Math.floor(rnd() * 1e9),
      });
    }
    this.ripples = [];
  }

  /** `dt` seconds on: the pads drift and turn, a pad gone off one side comes back on the other,
   *  the rings spread and fade, and now and then something drops on the water somewhere. */
  step(dt: number) {
    const { width: W, height: H } = this;
    this.time += dt;
    for (const p of this.pads) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.turn += p.spin * dt;
      if (p.x < -p.r) p.x += W + 2 * p.r;
      else if (p.x > W + p.r) p.x -= W + 2 * p.r;
      if (p.y < -p.r) p.y += H + 2 * p.r;
      else if (p.y > H + p.r) p.y -= H + 2 * p.r;
    }
    for (const r of this.ripples) r.age += dt;
    if (this.ripples.some((r) => r.age > RIPPLE_LIFE)) this.ripples = this.ripples.filter((r) => r.age <= RIPPLE_LIFE);
    if (this.time >= this.nextDrop) {
      if (this.nextDrop > 0) this.ripple(rand(0, W), rand(0, H), 0.35);
      this.nextDrop = this.time + rand(3, 8);
    }
  }

  ripple(x: number, y: number, strength: number) {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, age: 0, strength });
  }
}
