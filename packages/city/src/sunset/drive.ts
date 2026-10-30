/**
 * Sunset Drive, apart from any canvas: a drive across a grid toward a striped sun going down behind
 * the mountains, palms and cacti passing at the sides, the stars coming out as the sun sinks.
 *
 * Everything is held as shares of the window (x across, y down, 0 to 1), so a resize keeps the
 * drive as it was. The floor is seen in perspective: a point `X` half-widths to the side and `Z`
 * ahead (1 at the bottom of the window, more toward the horizon) is drawn at
 * x = 0.5 + lean · (1 - 1/Z) + X / Z / 2 and y = horizon + (1 - horizon) / Z, so the lean moves
 * what is far the most and the bottom of the window not at all.
 *
 * The pointer leans the view: the horizon and the sun drift a little toward it, the near hills more
 * than the far ones. A click sends a pulse of light along the grid from the click toward the
 * horizon: along the floor's nearest line on the ground, or down the sky to the horizon above it.
 */
import type { Sim } from "../scene";
import { clamp, rand, seeded } from "../util";

/** Where the horizon is, as a share of the height, with the view not leaned. */
export const HORIZON = 0.6;
/** How far the view leans toward the pointer: the vanishing point across, the horizon down. */
export const LEAN_X = 0.08;
export const LEAN_Y = 0.03;
/** How fast the drive goes: depth per second; the floor's lines lie this far apart in depth, and
 *  its lines along the way this many half-widths apart. */
export const SPEED = 0.9;
export const GRID_Z = 0.5;
export const GRID_X = 0.17;
/** The sun's radius, as a share of the window's shorter side. */
export const SUN = 0.19;
/** How long the sun takes to sink and come up again (s). */
const SINK_PERIOD = 300;
/** How far a pulse runs before it is spent (s). */
export const PULSE_LIFE = 1.8;
export const MAX_PULSES = 6;
/** Where roadside things come from, and where they are gone. */
const FAR = 9;
const NEAR = 0.9;

export interface Roadside { side: -1 | 1; lat: number; z: number; kind: "palm" | "cactus"; seed: number; size: number }
export interface Star { u: number; v: number; at: number; rate: number; phase: number; big: boolean }
/** A click's pulse: on the floor, along its line `X` from depth `z0`; in the sky, down from `y0`
 *  at `x0` to the horizon. */
export interface Pulse { kind: "floor" | "sky"; x0: number; y0: number; X: number; z0: number; age: number }

export class Drive implements Sim {
  width = 0;
  height = 0;
  time = 0;
  /** How far the grid has scrolled, in its own spacing (0 to 1). */
  scroll = 0;
  /** The lean now and where it is going, -1 to 1 each way. */
  lean = { x: 0, y: 0 };
  private leanTo = { x: 0, y: 0 };
  /** Where in its slow sinking the sun is (0 to 1). */
  sink = 0;
  roadside: Roadside[] = [];
  stars: Star[] = [];
  pulses: Pulse[] = [];
  pointer = { x: 0, y: 0, active: false };
  /** The seed the mountains are made from: the renderer lays them out by it. */
  seed = 0;

  resize(width: number, height: number) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    if (first) {
      this.seed = Math.floor(Math.random() * 2 ** 31);
      this.sink = rand(0.05, 0.35);
      this.scroll = Math.random();
      const r = seeded(this.seed + 7);
      this.stars = Array.from({ length: 150 }, () => ({ u: r(), v: r() ** 1.5 * 0.8, at: r(), rate: 0.6 + r() * 2.4, phase: r() * 6.3, big: r() < 0.06 }));
    }
    // A wider window has more by the road; a narrower one keeps its nearest.
    const want = clamp(Math.round(width / 170), 4, 14);
    if (this.roadside.length > want) this.roadside = this.roadside.sort((a, b) => a.z - b.z).slice(0, want);
    for (let i = this.roadside.length; i < want; i++) {
      // Spread from near to far, each side by turns: the first frame is a road already lined.
      const thing = this.thing(i % 2 ? 1 : -1);
      thing.z = NEAR + 0.4 + ((i + rand(0.1, 0.9)) / want) * (FAR - NEAR - 0.4);
      this.roadside.push(thing);
    }
  }

  private thing(side: -1 | 1): Roadside {
    return { side, lat: rand(1.45, 2.9), z: FAR, kind: Math.random() < 0.65 ? "palm" : "cactus", seed: Math.floor(Math.random() * 2 ** 30), size: rand(0.8, 1.2) };
  }

  /** The horizon's height and the vanishing point, as shares of the window, leaned as the view is
   *  now. */
  horizon() {
    return HORIZON + this.lean.y * LEAN_Y;
  }
  vanish() {
    return 0.5 + this.lean.x * LEAN_X;
  }

  /** How far the sun has sunk: 0 high, 1 low. Down for most of the time, up again more quickly. */
  sunk() {
    return 0.5 - 0.5 * Math.cos(this.sink * Math.PI * 2);
  }

  /** The sun, in css px: its middle (over the vanishing point, above or a little below the
   *  horizon as it sinks) and its radius. */
  sun() {
    const r = SUN * Math.min(this.width, this.height);
    return { x: this.across(Infinity) * this.width, y: this.horizon() * this.height - (0.55 - 0.85 * this.sunk()) * r, r };
  }

  /** How dark the sky is, 0 to 1: stars come out as the sun goes down. */
  dusk() {
    return clamp(0.25 + this.sunk() * 0.85, 0, 1);
  }

  /** Where a point on the floor is drawn, as shares of the window. */
  project(X: number, Z: number, out: { x: number; y: number }) {
    const h = this.horizon();
    out.x = this.across(Z) + X / Z / 2;
    out.y = h + (1 - h) / Z;
    return out;
  }

  /** Where the middle of the way is drawn across, `Z` ahead: leaned the more, the farther. */
  across(Z: number) {
    return 0.5 + this.lean.x * LEAN_X * (1 - 1 / Z);
  }

  /** The pointer leans the view toward it while it is over the window. */
  point(x: number, y: number, active: boolean) {
    this.pointer = { x, y, active };
    this.leanTo = active && this.width ? { x: clamp((x / this.width - 0.5) * 2, -1, 1), y: clamp((y / this.height - HORIZON) * 2.5, -1, 1) } : { x: 0, y: 0 };
  }

  /** A click: a pulse along the grid from the click toward the horizon. */
  splash(x: number, y: number) {
    const u = x / this.width;
    const v = y / this.height;
    const h = this.horizon();
    if (v > h + 0.01) {
      const Z = (1 - h) / (v - h);
      const X = (u - this.across(Z)) * 2 * Z;
      this.pulses.push({ kind: "floor", x0: u, y0: v, X: Math.round(X / GRID_X) * GRID_X, z0: Z, age: 0 });
    } else this.pulses.push({ kind: "sky", x0: u, y0: v, X: 0, z0: 0, age: 0 });
    if (this.pulses.length > MAX_PULSES) this.pulses.shift();
  }

  /** Where a pulse's head is now, as shares of the window; and whether it has reached the horizon. */
  pulseAt(p: Pulse, out: { x: number; y: number }) {
    const k = clamp(p.age / PULSE_LIFE, 0, 1);
    if (p.kind === "floor") {
      // Away along the floor, faster and faster in depth, slower and slower on screen.
      this.project(p.X, p.z0 * Math.exp(k * 3.4), out);
    } else {
      const h = this.horizon();
      out.x = p.x0;
      out.y = p.y0 + (h - p.y0) * Math.min(1, (k / 0.55) ** 1.6);
    }
    return out;
  }

  step(dt: number) {
    this.time += dt;
    this.scroll = (this.scroll + (SPEED / GRID_Z) * dt) % 1;
    this.sink = (this.sink + dt / SINK_PERIOD) % 1;
    const ease = Math.min(1, dt * 1.6);
    this.lean.x += (this.leanTo.x - this.lean.x) * ease;
    this.lean.y += (this.leanTo.y - this.lean.y) * ease;
    for (const t of this.roadside) {
      t.z -= SPEED * dt;
      // Gone past the side of the window: back far ahead, on a side of its own.
      if (t.z < Math.max(NEAR, t.lat * 0.82)) Object.assign(t, this.thing(Math.random() < 0.5 ? -1 : 1));
    }
    for (const p of this.pulses) p.age += dt;
    if (this.pulses.some((p) => p.age > PULSE_LIFE + 0.6)) this.pulses = this.pulses.filter((p) => p.age <= PULSE_LIFE + 0.6);
  }
}
