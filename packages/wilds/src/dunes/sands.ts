/**
 * Dunes' life, apart from any canvas: the wind blowing sand off the crests in streamers, gusting now
 * and then; a caravan of camels and walkers crossing slowly along a ridge some way off, gone behind
 * a nearer dune and out again; and, by the pointer, a small dust devil that follows it, its sand
 * whirling up round it. A click is a gust bursting sand up and out from there, which falls and
 * settles back.
 *
 * Bounded: so many grains in the streamers for the window's size, a dust devil of DEVIL grains, a
 * burst of BURST grains at most at once (a newer click takes the oldest grains), one caravan.
 */
import { gridOf, type Grid } from "../grid";
import { clamp, noise1, rand, TAU } from "../num";
import type { Sim } from "../scene";
import { crestAt, desertOf, landX, type DesertLayout } from "./desert";

/** One grain of sand in the air. */
export interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** How near (big and bright) it is: 0.3 far to 1.5 near. */
  near: number;
}

/** A grain a gust burst up: where it lands, and how long it has lain there. */
export interface Burst extends Grain {
  ground: number;
  landed: number;
}

/** A grain whirling in the dust devil: its angle round it, how high, how fast round and up. */
export interface Whirl {
  angle: number;
  up: number;
  spin: number;
  rise: number;
}

export interface Devil {
  /** Its foot. */
  x: number;
  y: number;
  /** Which way and how fast its foot is going (it leans with it). */
  vx: number;
  /** 0 gone to 1 whirling. */
  strength: number;
  grains: Whirl[];
}

export type Member = "camel" | "walker";
export interface Caravan {
  /** The leader's place along the land (the route's units), the way they walk, and each member
   *  behind it: what it is and how far behind (px, as it shows on the route). */
  x: number;
  dir: 1 | -1;
  members: { kind: Member; behind: number; step: number }[];
  /** When it sets off again, once it has gone past the edge of the window. */
  restart: number;
}

/** One streaming grain to each AREA px² of window, between MIN and MAX. */
const AREA = 4500;
const MIN = 150;
const MAX = 520;
/** The dust devil's grains, how tall it stands (px) and how wide its top is. */
export const DEVIL = 70;
export const DEVIL_HIGH = 120;
const DEVIL_TOP = 46;
/** A click's burst: how many grains, and the most in the air at once. */
const BURST_GRAINS = 120;
export const BURST_MAX = 260;
/** The caravan's pace across the window (px/s). */
export const PACE = 13;

export class Desert implements Sim {
  width = 0;
  height = 0;
  time = 0;
  grid: Grid = gridOf(1, 1);
  layout!: DesertLayout;
  stream: Grain[] = [];
  burst: Burst[] = [];
  devil: Devil = { x: 0, y: 0, vx: 0, strength: 0, grains: [] };
  caravan: Caravan = { x: 0, dir: 1, members: [], restart: 0 };
  pointer = { x: 0, y: 0, active: false };
  /** The wind now (px/s, rightward at the crests near us), gusting. */
  wind = 0;
  /** How many streaming grains the window holds. */
  streamCap = MIN;
  private seed = 0xd00e;

  resize(width: number, height: number) {
    const first = this.width === 0;
    const sx = first ? 1 : width / this.width;
    const sy = first ? 1 : height / this.height;
    this.width = width;
    this.height = height;
    this.grid = gridOf(width, height);
    this.layout = desertOf(this.grid, this.seed);
    this.streamCap = clamp(Math.round((width * height) / AREA), MIN, MAX);
    if (first) {
      this.stock();
      return;
    }
    // What was in the air stays where it was, fitted to the new window; the caravan keeps its place
    // along the land.
    for (const g of [...this.stream, ...this.burst]) {
      g.x *= sx;
      g.y *= sy;
    }
    for (const b of this.burst) b.ground *= sy;
    this.devil.x *= sx;
    this.devil.y *= sy;
    if (this.stream.length > this.streamCap) this.stream.length = this.streamCap;
  }

  /** The desert from its first frame: sand streaming off the crests already, the caravan partway
   *  across. */
  private stock() {
    this.wind = this.windAt(0);
    for (let i = 0; i < this.streamCap * 0.7; i++) {
      const g = this.blow();
      if (!g) break;
      // Partway through its flight.
      const t = rand(0, g.life * 0.8);
      g.age = t;
      g.x += g.vx * t;
      g.y += g.vy * t + 9 * t * t;
      this.stream.push(g);
    }
    const members: Caravan["members"] = [];
    let behind = 0;
    for (const kind of ["walker", "camel", "camel", "walker", "camel", "camel"] as Member[]) {
      members.push({ kind, behind, step: rand(0, 2) });
      behind += kind === "camel" ? rand(54, 66) : rand(30, 38);
    }
    const route = this.layout.ridges[this.layout.route]!;
    this.caravan = { x: landX(this.layout, rand(0.45, 0.7) * this.width, route.z), dir: 1, members, restart: 0 };
    this.devil.grains = Array.from({ length: DEVIL }, () => this.whirl());
  }

  private windAt(t: number) {
    return 70 + 25 * Math.sin(t * 0.09) + 90 * Math.max(0, noise1(t * 0.18, this.seed) - 0.5);
  }

  /** A grain lifted off a crest by the wind, or none (a window with no crest near enough). */
  private blow(): Grain | null {
    const { blowing, depth, grid } = this.layout;
    if (!blowing.length) return null;
    const i = blowing[Math.floor(Math.random() * blowing.length)]!;
    const c = i % grid.cols;
    const r = Math.floor(i / grid.cols);
    const near = clamp(9 / depth[i]!, 0.3, 1.5);
    // Off the crest's high point and a little either side of it.
    return {
      x: (c + rand(-1.5, 2.5)) * grid.cw, y: (r + 0.3 * Math.random()) * grid.ch,
      vx: this.wind * near * rand(0.6, 1.25), vy: -rand(4, 30) * near, age: 0, life: rand(0.9, 2.4) * (0.6 + 0.4 * near), near,
    };
  }

  private whirl(): Whirl {
    return { angle: rand(0, TAU), up: rand(0, DEVIL_HIGH), spin: rand(4.5, 8), rise: rand(28, 60) };
  }

  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
    // A devil that had died away starts again where the pointer is.
    if (active && this.devil.strength < 0.05) {
      this.devil.x = x;
      this.devil.y = y;
    }
  }

  /** A click: a gust bursts sand up and out from there; it falls and settles back. */
  splash(x: number, y: number) {
    const over = this.burst.length + BURST_GRAINS - BURST_MAX;
    if (over > 0) this.burst.splice(0, over);
    for (let i = 0; i < BURST_GRAINS; i++) {
      // Up and out, most of it upward.
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25;
      const v = rand(60, 230);
      this.burst.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 0, near: rand(0.6, 1.3), ground: y + rand(-8, 26), landed: -1 });
    }
  }

  step(dt: number) {
    this.time += dt;
    this.wind = this.windAt(this.time);
    this.streams(dt);
    this.bursts(dt);
    this.whirlDevil(dt);
    this.walk(dt);
  }

  private streams(dt: number) {
    const { width: W, height: H } = this;
    for (let i = this.stream.length - 1; i >= 0; i--) {
      const g = this.stream[i]!;
      g.age += dt;
      g.vx += (this.wind * g.near - g.vx) * Math.min(1, dt * 1.5);
      g.vy += 18 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (g.age > g.life || g.x > W + 10 || g.y > H) this.stream.splice(i, 1);
    }
    // More of it in a gust.
    const rate = this.streamCap * (0.35 + 0.65 * clamp((this.wind - 60) / 90, 0, 1)) * 0.9;
    let n = rate * dt + Math.random();
    while (n >= 1 && this.stream.length < this.streamCap) {
      const g = this.blow();
      if (!g) break;
      this.stream.push(g);
      n--;
    }
  }

  private bursts(dt: number) {
    for (let i = this.burst.length - 1; i >= 0; i--) {
      const b = this.burst[i]!;
      b.age += dt;
      if (b.landed >= 0) {
        b.landed += dt;
        if (b.landed > 0.8) this.burst.splice(i, 1);
        continue;
      }
      const drag = Math.min(1, dt * 0.9);
      b.vx -= b.vx * drag;
      b.vy -= b.vy * drag;
      b.vy += 280 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.vy > 0 && b.y >= b.ground) {
        b.y = b.ground;
        b.landed = 0;
      }
    }
  }

  private whirlDevil(dt: number) {
    const d = this.devil;
    const p = this.pointer;
    d.strength = clamp(d.strength + (p.active ? dt * 1.2 : -dt * 0.9), 0, 1);
    if (p.active) {
      // Its foot follows the pointer, a little behind and never quite still.
      const wob = Math.sin(this.time * 2.3) * 6;
      const vx = (p.x + wob - d.x) * Math.min(1, dt * 2.2);
      d.x += vx;
      d.y += (p.y - d.y) * Math.min(1, dt * 2.2);
      d.vx += (vx / dt - d.vx) * Math.min(1, dt * 3);
    } else d.vx -= d.vx * Math.min(1, dt * 2);
    for (const g of d.grains) {
      g.angle += g.spin * dt;
      g.up += g.rise * dt * (0.3 + 0.7 * d.strength);
      if (g.up > DEVIL_HIGH) Object.assign(g, this.whirl(), { up: 0 });
    }
  }

  /** Where a dust devil's grain is now, and whether in front of its column (toward us). */
  whirlAt(g: Whirl) {
    const d = this.devil;
    const k = g.up / DEVIL_HIGH;
    const r = (4 + (DEVIL_TOP / 2) * k ** 1.3) * (0.6 + 0.4 * d.strength);
    // It leans the way its foot is going, its top trailing.
    const lean = clamp(-d.vx * 0.25, -30, 30) * k;
    return { x: d.x + Math.cos(g.angle) * r + lean, y: d.y - g.up * (0.4 + 0.6 * d.strength), front: Math.sin(g.angle) > 0 };
  }

  private walk(dt: number) {
    const cv = this.caravan;
    const route = this.layout.ridges[this.layout.route]!;
    const toLand = route.z / this.layout.focal;
    if (this.time < cv.restart) return;
    cv.x += cv.dir * PACE * toLand * dt;
    for (const m of cv.members) m.step += dt * (m.kind === "camel" ? 1.6 : 2.4);
    // Once the last of it is past the edge, it comes again from the other side a while later.
    const last = cv.members[cv.members.length - 1]!;
    const lastX = crestAt(this.layout, this.layout.route, cv.x - cv.dir * last.behind * toLand).x;
    if ((cv.dir > 0 && lastX > this.width + 80) || (cv.dir < 0 && lastX < -80)) {
      cv.dir = Math.random() < 0.5 ? 1 : -1;
      cv.x = landX(this.layout, cv.dir > 0 ? -60 : this.width + 60, route.z);
      cv.restart = this.time + rand(8, 20);
    }
  }

  /** Where each of the caravan is now: on screen (its feet, px) and how far off. */
  caravanAt() {
    const cv = this.caravan;
    const route = this.layout.ridges[this.layout.route]!;
    const toLand = route.z / this.layout.focal;
    return cv.members.map((m) => ({ ...m, ...crestAt(this.layout, this.layout.route, cv.x - cv.dir * m.behind * toLand) }));
  }
}
