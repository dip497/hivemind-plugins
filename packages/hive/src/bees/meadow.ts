/**
 * Bees' meadow: a colony living on its own, and the pointer to play with. A colony sized to the
 * window, every species among it, each bee with its own temper and rhythm:
 *
 *   forage   from flower to flower, gathering, a load of pollen growing under it, then home with it
 *   home     to the hive's door, where it unloads
 *   loop     loose loops over the hive, for a while
 *   rest     on the hive, still, now and then
 *
 * The pointer resting over the meadow makes a few bees near it curious: they drift to it and
 * circle it loosely, a while each, then go back to work. A click is a puff of pollen there: the bees
 * near it scatter, and come back to what they were doing. Small bees drift between the flowers and
 * in and out of the hive. All of it is plain state, stepped and read; nothing here draws.
 */
import { gridOf, headOf, layGround, type Flower, type Grid, type Ground } from "./ground";
import { SHAPES, SPECIES, type SpeciesId } from "./species";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

type Box = { x0: number; y0: number; x1: number; y1: number };

/** What a bee is doing: its work, or the pointer's play (curious, scattered). */
export type Doing = "forage" | "home" | "loop" | "rest" | "curious" | "scatter";

export interface Bee {
  /** Its place in the colony: which loop it flies over the hive. */
  n: number;
  species: SpeciesId;
  doing: Doing;
  /** What it goes back to once the pointer's play is over. */
  was: Doing;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Its own offset in every rhythm, so no two bees move as one. */
  phase: number;
  /** Its temper, 0 to 1: how often it rests and how long it lingers. */
  lazy: number;
  /** On a flower, the hive door or its perch, wings folded. */
  landed: boolean;
  /** Seconds left at what it is doing: on a flower, unloading, looping, resting, curious, fleeing. */
  stay: number;
  /** The flower it is going to or on (-1 none), how many it visits before it goes home, and how
   *  much pollen it carries (0 to 1). */
  flower: number;
  visits: number;
  pollen: number;
  /** Its place on the hive while it rests (-1 none). */
  perch: number;
  /** Seconds before it can be curious again. */
  calm: number;
  /** Seconds to the next grain of pollen it lets fall, flying laden. */
  trail: number;
}

/** One of the meadow's small bees. */
export interface Drone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  flower: number;
  /** Seconds left on its flower, or inside the hive. */
  stay: number;
  inside: boolean;
  home: boolean;
  /** Scattered: seconds left fleeing. */
  flee: number;
  landed: boolean;
}

/** A click's puff of pollen light, spreading and fading. */
export interface Puff {
  x: number;
  y: number;
  age: number;
}

/** A grain of pollen: from a puff, or let fall by a laden bee. */
export interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  glyph: string;
}

/** How long a puff of pollen light lasts, in seconds. */
export const PUFF = 0.8;
/** The most puffs and grains of pollen at once: a burst of clicks never fills the meadow. */
export const MOST_PUFFS = 3;
export const MOST_GRAINS = 160;
/** How long the pointer stays about one place before the bees near it notice it, in seconds, and
 *  how far it may wander meanwhile, in px: one sweeping past draws nobody. */
const RESTED = 0.8;
const STILL_ENOUGH = 60;
/** The most bees curious about the pointer at once: a few, never the colony. */
export const MOST_CURIOUS = 3;
/** How near the pointer a bee is to notice it, and how near a click to scatter, in px. */
export const NOTICE = 320;
export const SCATTER = 210;

/** How fast each kind of flight goes, in px/s. */
const SPEED: Record<Doing, number> = { forage: 105, home: 110, loop: 72, rest: 70, curious: 95, scatter: 0 };

/** The colony for a window: a bigger bee for some 110,000 px² of it, at least one of each species. */
export const colonyOf = (width: number, height: number) => clamp(Math.round((width * height) / 110_000), SPECIES.length, 24);
/** The small bees for a window. */
const dronesOf = (width: number, height: number) => clamp(Math.round((width * height) / 60_000), 8, 28);

export class Meadow {
  width = 0;
  height = 0;
  time = 0;
  grid: Grid = { cw: 8, ch: 12, cols: 0, rows: 0 };
  ground: Ground | null = null;
  bees: Bee[] = [];
  drones: Drone[] = [];
  grains: Grain[] = [];
  puffs: Puff[] = [];
  pointer = { x: 0, y: 0, over: false };
  /** Seconds to the next look round for a curious bee, and how long the pointer has stayed about
   *  where it came to rest. */
  private noticeIn = 0;
  private rested = 0;
  private restAt = { x: 0, y: 0 };
  /** The ground the still frame was settled on: settled again only on a new one. */
  private settledFor: Ground | null = null;

  /** A window, and the ground laid for it. The first: the colony sized to it and put where it
   *  lives, so the first frame shows it at work. A new size: the colony kept, moved into the new
   *  space, a few bees more or fewer, each finding its flowers on the new ground. */
  resize(width: number, height: number) {
    if (width === this.width && height === this.height && this.ground) return;
    const was = this.ground ? { w: this.width, h: this.height } : null;
    this.width = width;
    this.height = height;
    this.grid = gridOf(width, height);
    // The hive in the lower right: the app keeps its own panels down the left.
    this.ground = layGround(width, height, "right");
    const n = colonyOf(width, height);
    // Every species among them: the first eight one of each, the rest round again.
    const first = this.bees.length ? SPECIES.indexOf(this.bees[0]!.species) : Math.floor(Math.random() * SPECIES.length);
    const born = this.bees.length;
    this.bees = Array.from({ length: n }, (_, i) => this.bees[i] ?? this.newBee(i, SPECIES[(first + i) % SPECIES.length]!));
    const drones = this.drones.length;
    this.drones = Array.from({ length: dronesOf(width, height) }, (_, i) => this.drones[i] ?? this.newDrone());
    if (!was) {
      this.placeColony();
      return;
    }
    const sx = width / was.w;
    const sy = height / was.h;
    this.bees.forEach((b, i) => {
      if (i >= born) {
        b.x = rand(width * 0.1, width * 0.9);
        b.y = rand(height * 0.55, height * 0.85);
        this.startForage(b);
      } else {
        b.x *= sx;
        b.y *= sy;
        b.landed = false;
        b.flower = -1;
      }
      this.keepOnScreen(b);
    });
    this.drones.forEach((d, i) => {
      if (i >= drones) this.settleDrone(d);
      else {
        d.x *= sx;
        d.y *= sy;
        d.landed = false;
        d.flower = -1;
      }
    });
    this.settledFor = null;
  }

  /** The pointer over empty canvas at (x, y), or gone from it. */
  point(x: number, y: number, over: boolean) {
    if (!over || !this.pointer.over || Math.hypot(x - this.restAt.x, y - this.restAt.y) > STILL_ENOUGH) {
      this.rested = 0;
      this.restAt = { x, y };
    }
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.over = over;
  }

  /** A click in the meadow: a puff of pollen there, and the bees near it scatter. */
  scatter(x: number, y: number) {
    this.puffs.push({ x, y, age: 0 });
    if (this.puffs.length > MOST_PUFFS) this.puffs.splice(0, this.puffs.length - MOST_PUFFS);
    const glyphs = [".", "*", "'", ",", "o", "*"];
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU);
      const v = rand(30, 110);
      this.grain({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 35, age: 0, life: rand(0.9, 1.7), glyph: glyphs[i % glyphs.length]! });
    }
    for (const b of this.bees) {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d > SCATTER) continue;
      const a = d > 0.5 ? Math.atan2(b.y - y, b.x - x) : rand(0, TAU);
      const v = 140 + 180 * (1 - d / SCATTER);
      if (b.doing !== "scatter") b.was = b.doing === "curious" ? b.was : b.doing;
      b.doing = "scatter";
      b.landed = false;
      b.vx = Math.cos(a) * v;
      b.vy = Math.sin(a) * v;
      b.stay = rand(0.9, 1.4);
      b.calm = rand(6, 12);
    }
    for (const d of this.drones) {
      if (d.inside) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist > SCATTER) continue;
      const a = dist > 0.5 ? Math.atan2(d.y - y, d.x - x) : rand(0, TAU);
      const v = 90 + 240 * (1 - dist / SCATTER);
      d.vx = Math.cos(a) * v;
      d.vy = Math.sin(a) * v;
      d.flee = rand(1, 1.5);
      d.landed = false;
      d.flower = -1;
    }
  }

  /** The cells a bee is drawn in, in pixels. */
  boxOf(b: Bee): Box {
    const { cw, ch } = this.grid;
    const s = SHAPES[b.species];
    const ax = b.facing > 0 ? s.anchor.dx : s.w - 1 - s.anchor.dx;
    const c0 = Math.floor(b.x / cw) - ax;
    const r0 = Math.floor(b.y / ch) - s.anchor.dy;
    return { x0: c0 * cw, y0: r0 * ch, x1: (c0 + s.w) * cw, y1: (r0 + s.h) * ch };
  }

  // ── placing: the first frame and a still one ──────────────────────────────

  /** The still frame: the colony where it lives, laid out once for each ground, so a still picture
   *  moves only when the window does. */
  settle() {
    this.grains = [];
    this.puffs = [];
    if (this.settledFor === this.ground) return;
    this.placeColony();
  }

  /** Every bee at its work at once: most on flowers spread along the meadow, some looping over the
   *  hive, a few resting on it; the small bees on flowers and about. */
  private placeColony() {
    const g = this.ground;
    if (!g) return;
    this.settledFor = g;
    this.grains = [];
    this.puffs = [];
    const flowers = this.openFlowers();
    const foragers = this.bees.filter((_, i) => i % 5 !== 3 && i % 7 !== 5);
    const taken = new Set<number>();
    for (const b of this.bees) {
      b.vx = b.vy = 0;
      b.landed = false;
      b.perch = -1;
      b.calm = 0;
      b.was = "forage";
    }
    // The foragers along the whole meadow: the flowers shared out evenly, one bee to a flower.
    foragers.forEach((b, i) => {
      let f = flowers.length ? flowers[Math.min(flowers.length - 1, Math.floor(((i + Math.random() * 0.8) / foragers.length) * flowers.length))]! : -1;
      while (f >= 0 && taken.has(f) && taken.size < flowers.length) f = flowers[(flowers.indexOf(f) + 1) % flowers.length]!;
      taken.add(f);
      this.startForage(b);
      b.flower = f;
      b.visits = 1 + Math.floor(Math.random() * 4);
      b.pollen = rand(0.1, 0.8);
      if (f >= 0) {
        const p = this.landingOn(g.flowers[f]!);
        b.x = p.x;
        b.y = p.y;
        b.landed = true;
        b.stay = rand(0.3, 3);
      }
    });
    for (const b of this.bees) {
      if (foragers.includes(b)) continue;
      const perch = this.freePerch();
      if (b.n % 7 === 5 && perch >= 0) {
        b.doing = "rest";
        b.perch = perch;
        b.stay = rand(3, 14);
        const p = g.where.perches[perch]!;
        b.x = p.x;
        b.y = p.y;
        b.landed = true;
        b.facing = perch % 2 ? -1 : 1;
      } else {
        b.doing = "loop";
        b.stay = rand(3, 12);
        const p = this.loopPoint(b, this.time);
        b.x = p.x;
        b.y = p.y;
      }
    }
    for (const b of this.bees) this.keepOnScreen(b);
    for (const d of this.drones) this.settleDrone(d);
  }

  // ── where things are ──────────────────────────────────────────────────────

  /** The flowers whose heads are in the window. */
  private openFlowers(): number[] {
    const g = this.ground;
    if (!g) return [];
    const out: number[] = [];
    g.flowers.forEach((f, i) => {
      const h = headOf(f, this.grid, this.time);
      if (h.x > 0 && h.x < this.width && h.y > 0) out.push(i);
    });
    return out;
  }

  /** A flower for a bee at (x, y) to go to next: one of the nearer ones, not `not`, and not one
   *  another big bee is on or going to. */
  private nextFlower(x: number, y: number, not: number): number {
    const g = this.ground!;
    const busy = new Set(this.bees.filter((b) => b.doing === "forage" || b.was === "forage").map((b) => b.flower));
    const open = this.openFlowers().filter((i) => i !== not && !busy.has(i));
    if (!open.length) return -1;
    const near = open
      .map((i) => {
        const h = headOf(g.flowers[i]!, this.grid, this.time);
        return { i, d: Math.hypot(h.x - x, h.y - y) };
      })
      .sort((p, q) => p.d - q.d)
      .slice(0, 5);
    return near[Math.floor(Math.random() * near.length)]!.i;
  }

  /** Where a bee lands on a flower: on its head, its feet on the petals. */
  private landingOn(f: Flower) {
    const h = headOf(f, this.grid, this.time);
    return { x: h.x, y: h.y - this.grid.ch };
  }

  /** A place on the hive no other bee rests on, or -1. */
  private freePerch() {
    const n = this.ground?.where.perches.length ?? 0;
    for (let k = 0; k < n; k++) if (!this.bees.some((b) => b.perch === k)) return k;
    return -1;
  }

  /** The middle of a bee's loop over the hive: each its own, by its place in the colony. */
  private loopCentre(b: Bee) {
    const g = this.ground!.where;
    const { cw, ch } = this.grid;
    const reach = Math.max(70, g.w * cw * 0.55);
    const k = b.n % 6;
    return {
      x: clamp(g.cx * cw + g.open * (g.w * cw * 0.3 + (k % 3) * reach * 0.55), reach, this.width - reach),
      y: Math.max(ch * 4, (g.top - 4 - Math.floor(k / 3) * 3) * ch - (b.n % 2) * ch * 1.5),
      rx: reach * (0.6 + 0.3 * ((b.n * 0.37) % 1)),
      ry: ch * (1.6 + (b.n % 3) * 0.5),
    };
  }

  /** Where a looping bee is at time `t`: a lazy figure of eight, its own speed and phase. */
  private loopPoint(b: Bee, t: number) {
    const c = this.loopCentre(b);
    const a = t * (0.45 + 0.2 * b.lazy) + b.phase;
    return { x: c.x + c.rx * Math.sin(a), y: c.y + c.ry * Math.sin(2 * a) + Math.sin(t * 0.21 + b.phase) * this.grid.ch };
  }

  // ── a bee's day ───────────────────────────────────────────────────────────

  private newBee(n: number, species: SpeciesId): Bee {
    return {
      n, species, doing: "forage", was: "forage", x: 0, y: 0, vx: 0, vy: 0, facing: 1, phase: rand(0, 10), lazy: Math.random(),
      landed: false, stay: 0, flower: -1, visits: 0, pollen: 0, perch: -1, calm: 0, trail: 0,
    };
  }

  private startForage(b: Bee) {
    b.doing = "forage";
    b.landed = false;
    b.perch = -1;
    b.visits = 3 + Math.floor(Math.random() * 4);
    b.flower = this.nextFlower(b.x, b.y, b.flower);
  }

  /** What a bee does next once it is done: its temper picks, a lazy one rests more. */
  private next(b: Bee, from: Doing) {
    b.landed = false;
    b.perch = -1;
    const r = Math.random();
    const perch = this.freePerch();
    if (from !== "rest" && perch >= 0 && r < 0.1 + 0.25 * b.lazy) {
      b.doing = "rest";
      b.perch = perch;
      b.stay = rand(5, 12) * (0.6 + b.lazy);
    } else if (from !== "loop" && r < 0.42 + 0.12 * b.lazy) {
      b.doing = "loop";
      b.stay = rand(6, 14);
    } else this.startForage(b);
  }

  /** The pointer's play over, a bee goes back to what it was doing. */
  private resume(b: Bee) {
    b.doing = b.was;
    b.landed = false;
    if (b.doing === "forage" && b.flower < 0) b.flower = this.nextFlower(b.x, b.y, -1);
    if (b.doing === "rest" && b.perch < 0) this.next(b, "rest");
    if (b.doing === "loop" && b.stay <= 0) b.stay = rand(4, 8);
  }

  step(dt: number) {
    if (!this.ground) return;
    this.time += dt;
    this.settledFor = null;
    this.notice(dt);
    for (const b of this.bees) this.fly(b, dt);
    for (const d of this.drones) this.drift(d, dt);
    this.fall(dt);
  }

  /** Bees near the pointer grow curious, one at a time and a few at most; with the pointer gone,
   *  they go back to work. */
  private notice(dt: number) {
    const { pointer } = this;
    if (!pointer.over) {
      for (const b of this.bees) if (b.doing === "curious") this.resume(b);
      return;
    }
    this.rested += dt;
    this.noticeIn -= dt;
    if (this.noticeIn > 0 || this.rested < RESTED) return;
    this.noticeIn = rand(0.5, 1.1);
    let curious = 0;
    for (const b of this.bees) if (b.doing === "curious") curious++;
    if (curious >= MOST_CURIOUS) return;
    let near: Bee | null = null;
    let nearest = NOTICE;
    for (const b of this.bees) {
      if (b.doing === "curious" || b.doing === "scatter" || b.doing === "rest" || b.calm > 0) continue;
      const d = Math.hypot(b.x - pointer.x, b.y - pointer.y);
      if (d < nearest) {
        nearest = d;
        near = b;
      }
    }
    if (!near) return;
    near.was = near.doing;
    near.doing = "curious";
    near.landed = false;
    near.stay = rand(5, 10);
  }

  /** Accelerate toward a goal at `speed`, slowing near it and never flying quite straight. */
  private steer(o: { x: number; y: number; vx: number; vy: number; phase: number }, goal: { x: number; y: number }, speed: number, dt: number, grip = 2.6) {
    const gx = goal.x - o.x;
    const gy = goal.y - o.y;
    const far = Math.hypot(gx, gy) || 1;
    const slow = clamp(far / 70, 0.1, 1);
    const wobble = Math.sin(this.time * 3.3 + o.phase * 1.7) * 0.5 * clamp(far / 120, 0, 1);
    const a = Math.atan2(gy, gx) + wobble;
    o.vx += (Math.cos(a) * speed * slow - o.vx) * grip * dt;
    o.vy += (Math.sin(a) * speed * slow - o.vy) * grip * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    return far;
  }

  private face(b: Bee) {
    if (b.vx > 8) b.facing = 1;
    else if (b.vx < -8) b.facing = -1;
  }

  /** Whole in the window, in whole cells (its last column may run past the edge): a bee pushed back
   *  in by the edge it crossed, turned back from it. */
  private keepOnScreen(b: Bee) {
    const { cw, ch } = this.grid;
    const s = SHAPES[b.species];
    const ax = b.facing > 0 ? s.anchor.dx : s.w - 1 - s.anchor.dx;
    const c = Math.floor(b.x / cw);
    const r = Math.floor(b.y / ch);
    const cHi = Math.floor(this.width / cw) - s.w + ax;
    const rHi = Math.floor(this.height / ch) - s.h + s.anchor.dy;
    if (c < ax) { b.x = ax * cw + cw / 2; b.vx = Math.abs(b.vx); }
    else if (c > cHi) { b.x = cHi * cw + cw / 2; b.vx = -Math.abs(b.vx); }
    if (r < s.anchor.dy) { b.y = s.anchor.dy * ch + ch / 2; b.vy = Math.abs(b.vy); }
    else if (r > rHi) { b.y = rHi * ch + ch / 2; b.vy = -Math.abs(b.vy); }
  }

  private fly(b: Bee, dt: number) {
    b.calm = Math.max(0, b.calm - dt);
    switch (b.doing) {
      case "forage": this.forage(b, dt); break;
      case "home": this.home(b, dt); break;
      case "loop": {
        this.steer(b, this.loopPoint(b, this.time), SPEED.loop, dt, 2);
        b.stay -= dt;
        if (b.stay <= 0) this.next(b, "loop");
        break;
      }
      case "rest": this.rest(b, dt); break;
      case "curious": {
        // Round the pointer, loosely: each its own way round, its own distance.
        const r = 42 + 26 * ((b.n * 0.61) % 1);
        const a = this.time * 1.5 * (b.n % 2 ? 1 : -1) + b.phase;
        this.steer(b, { x: this.pointer.x + Math.cos(a) * r, y: this.pointer.y + Math.sin(a) * r * 0.65 }, SPEED.curious, dt, 2.2);
        b.stay -= dt;
        if (b.stay <= 0) {
          b.calm = rand(8, 16);
          this.resume(b);
        }
        break;
      }
      case "scatter": {
        // Thrown out by the click, slowing; then back to work.
        b.vx *= 1 - 1.8 * dt;
        b.vy *= 1 - 1.8 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.stay -= dt;
        if (b.stay <= 0) this.resume(b);
        break;
      }
    }
    if (!b.landed) this.face(b);
    this.keepOnScreen(b);
  }

  /** From flower to flower, a while on each, the load growing; full, or done its round, home. */
  private forage(b: Bee, dt: number) {
    const g = this.ground!;
    if (b.flower < 0) b.flower = this.nextFlower(b.x, b.y, -1);
    if (b.flower < 0) {
      this.next(b, "forage");
      return;
    }
    const goal = this.landingOn(g.flowers[b.flower]!);
    if (b.landed) {
      b.x = goal.x;
      b.y = goal.y + Math.sin(this.time * 5 + b.phase) * 0.8;
      b.pollen = Math.min(1, b.pollen + dt * 0.08);
      b.stay -= dt;
      if (b.stay > 0) return;
      b.landed = false;
      b.vy = -40;
      b.visits--;
      if (b.visits <= 0 || b.pollen >= 0.95) {
        b.doing = "home";
        b.flower = -1;
      } else b.flower = this.nextFlower(b.x, b.y, b.flower);
      return;
    }
    if (this.steer(b, goal, SPEED.forage, dt, 2.8) < 5) {
      b.landed = true;
      b.vx = b.vy = 0;
      b.x = goal.x;
      b.y = goal.y;
      b.stay = rand(1.2, 3.4) * (0.7 + 0.6 * b.lazy);
    }
    this.laden(b, dt);
  }

  /** Home to the hive's door, and a while there unloading. */
  private home(b: Bee, dt: number) {
    const door = this.ground!.where.door;
    if (b.landed) {
      b.pollen = Math.max(0, b.pollen - dt * 1.2);
      b.stay -= dt;
      if (b.stay <= 0) this.next(b, "home");
      return;
    }
    if (this.steer(b, door, SPEED.home, dt, 2.8) < 5) {
      b.landed = true;
      b.vx = b.vy = 0;
      b.x = door.x;
      b.y = door.y;
      b.stay = rand(0.8, 1.6);
    }
    this.laden(b, dt);
  }

  /** To its place on the hive, and still there a while. */
  private rest(b: Bee, dt: number) {
    const p = this.ground!.where.perches[b.perch];
    if (!p) {
      this.next(b, "rest");
      return;
    }
    if (b.landed) {
      b.stay -= dt;
      if (b.stay <= 0) this.next(b, "rest");
      return;
    }
    if (this.steer(b, p, SPEED.rest, dt, 3.2) < 3) {
      b.landed = true;
      b.vx = b.vy = 0;
      b.x = p.x;
      b.y = p.y;
    }
  }

  /** Laden, it lets a grain of pollen fall now and then. */
  private laden(b: Bee, dt: number) {
    b.trail -= dt;
    if (b.pollen <= 0.35 || b.trail > 0) return;
    b.trail = rand(0.15, 0.35);
    this.grain({ x: b.x - b.facing * this.grid.cw * 2, y: b.y + this.grid.ch, vx: rand(-6, 6), vy: rand(4, 16), age: 0, life: rand(0.5, 0.9), glyph: "." });
  }

  /** A grain of pollen, the oldest dropped past the most there may be. */
  private grain(g: Grain) {
    this.grains.push(g);
    if (this.grains.length > MOST_GRAINS) this.grains.shift();
  }

  private fall(dt: number) {
    if (this.puffs.length) {
      for (const p of this.puffs) p.age += dt;
      this.puffs = this.puffs.filter((p) => p.age < PUFF);
    }
    if (!this.grains.length) return;
    for (const p of this.grains) {
      p.age += dt;
      p.vy += 110 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.grains = this.grains.filter((p) => p.age < p.life);
  }

  // ── the small bees ────────────────────────────────────────────────────────

  private newDrone(): Drone {
    return { x: 0, y: 0, vx: 0, vy: 0, phase: rand(0, 10), flower: -1, stay: 0, inside: false, home: false, flee: 0, landed: false };
  }

  /** A small bee on a flower, or in the air over the meadow. */
  private settleDrone(d: Drone) {
    const open = this.openFlowers();
    d.flee = 0;
    d.inside = false;
    d.home = false;
    d.vx = d.vy = 0;
    if (open.length && Math.random() < 0.55) {
      d.flower = open[Math.floor(Math.random() * open.length)]!;
      const p = this.landingOn(this.ground!.flowers[d.flower]!);
      d.x = p.x;
      d.y = p.y + this.grid.ch * 0.5;
      d.landed = true;
      d.stay = rand(0.5, 4);
    } else {
      d.flower = -1;
      d.landed = false;
      d.x = rand(this.width * 0.05, this.width * 0.95);
      d.y = rand(this.height * 0.55, this.height * 0.9);
    }
  }

  /** A small bee: flower to flower, now and then home for a while; shy of the pointer; scattered,
   *  it flees. */
  private drift(d: Drone, dt: number) {
    const g = this.ground!;
    const { cw, ch } = this.grid;
    if (d.inside) {
      d.stay -= dt;
      if (d.stay > 0) return;
      d.inside = false;
      d.x = g.where.door.x;
      d.y = g.where.door.y;
      d.vy = -50;
      d.vx = g.where.open * 30;
      d.flower = -1;
      return;
    }
    if (d.flee > 0) {
      d.flee -= dt;
      d.vx *= 1 - 1.4 * dt;
      d.vy *= 1 - 1.4 * dt;
      d.x = clamp(d.x + d.vx * dt, cw, this.width - cw);
      d.y = clamp(d.y + d.vy * dt, ch, this.height - ch);
      return;
    }
    if (d.landed) {
      d.stay -= dt;
      if (d.flower >= 0) {
        const p = this.landingOn(g.flowers[d.flower]!);
        d.x = p.x;
        d.y = p.y + ch * 0.5;
      }
      if (d.stay > 0 && !(this.pointer.over && Math.hypot(d.x - this.pointer.x, d.y - this.pointer.y) < 40)) return;
      d.landed = false;
      d.vy = -30;
      d.home = Math.random() < 0.12;
      d.flower = d.home ? -1 : this.nextDroneFlower(d);
      return;
    }
    if (!d.home && d.flower < 0) d.flower = this.nextDroneFlower(d);
    const goal = d.home ? g.where.door : d.flower >= 0 ? this.landingOn(g.flowers[d.flower]!) : { x: this.width / 2, y: this.height * 0.7 };
    if (!d.home && d.flower >= 0) goal.y += ch * 0.5;
    const far = this.steer(d, goal, 55, dt, 2.2);
    if (this.pointer.over) {
      const px = d.x - this.pointer.x;
      const py = d.y - this.pointer.y;
      const dist = Math.hypot(px, py);
      if (dist < 50 && dist > 0.5) {
        d.vx += (px / dist) * 500 * dt;
        d.vy += (py / dist) * 500 * dt;
      }
    }
    d.x = clamp(d.x, cw, this.width - cw);
    d.y = clamp(d.y, ch, this.height - ch);
    if (far < 4) {
      if (d.home) {
        d.inside = true;
        d.home = false;
        d.stay = rand(2, 7);
      } else if (d.flower >= 0) {
        d.landed = true;
        d.vx = d.vy = 0;
        d.stay = rand(1, 4);
      }
    }
  }

  /** A flower near a small bee, any of the nearer ones. */
  private nextDroneFlower(d: Drone) {
    const g = this.ground!;
    const open = this.openFlowers();
    if (!open.length) return -1;
    const near = open
      .map((i) => {
        const h = headOf(g.flowers[i]!, this.grid, this.time);
        return { i, d: Math.hypot(h.x - d.x, h.y - d.y) };
      })
      .sort((p, q) => p.d - q.d)
      .slice(0, 6);
    return near[Math.floor(Math.random() * near.length)]!.i;
  }
}
