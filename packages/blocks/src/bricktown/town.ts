/**
 * Brick Town's life, apart from any canvas: the plan (plan.ts) seen through the window, cars driving
 * the streets (keeping their distance, taking turns at the crossings, and coming round again from
 * the far edge), the train going round its loop in the park, and people strolling the pavements
 * round the blocks, stopping now and then.
 *
 * The pointer resting over the town makes the people near it stop, turn to it and look up at it.
 * A click drops a brick from above the window: it falls, bounces a little and snaps onto the stack
 * nearest the click (a roof, a garden, a stack of dropped bricks); past the cap, the brick dropped
 * longest ago is lifted away again, the ones over it settling down.
 */
import type { Sim } from "../scene";
import { groundAt, screenX, screenY, type Iso } from "../iso";
import { clamp, rand, randInt } from "../rng";
import { Ground, inPark, lotOf, PARK, PARK_BOX, PERIOD, Plan, roadAt, TRACK_LENGTH, type House } from "./plan";

export interface Car {
  id: number;
  /** Driving along x or along y, in the lane at `line` (the other coordinate's cell). */
  axis: "x" | "y";
  line: number;
  /** Where its middle is along its road. */
  s: number;
  dir: 1 | -1;
  speed: number;
  colour: number;
  /** Stopped behind another car or at a crossing. */
  waiting: boolean;
  /** The crossings it is in or about to enter. */
  holds: number[];
}

export interface Person {
  id: number;
  /** The block whose pavement it walks round, and how far round it is. */
  bx: number;
  by: number;
  p: number;
  dir: 1 | -1;
  speed: number;
  x: number;
  y: number;
  /** Which way it faces: 0 +x, 1 +y, 2 -x, 3 -y. */
  face: number;
  /** Standing a while (a pause, or looking at the pointer) until then. */
  pause: number;
  looking: boolean;
  look: number;
  stepPhase: number;
}

export interface Brick {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Where it comes to rest. */
  rest: number;
  vz: number;
  colour: number;
  state: "falling" | "set" | "leaving";
  age: number;
  bounces: number;
}

/** How many dropped bricks stay; the brick dropped longest ago is lifted away past it. */
export const BRICKS = 16;
export const BRICK_COLOURS = 6;
/** How near the pointer (CSS px) people stop to look at it. */
export const LOOK_REACH = 170;
const GRAVITY = 55;
const TRAIN_SPEED = 2.6;
/** The train: its engine, then its wagons, this far apart along the track. */
export const TRAIN = [0, 2.3, 4.6, 6.9];

export class Town implements Sim {
  width = 0;
  height = 0;
  dpr = 1;
  time = 0;
  iso: Iso = { S: 2, HZ: 2, ox: 0, oy: 0 };
  plan!: Plan;
  /** The world's point at the middle of the window, fixed when the town is first made. */
  centre = { x: 0, y: 0 };
  cars: Car[] = [];
  people: Person[] = [];
  bricks: Brick[] = [];
  train = { d: 0 };
  pointer = { x: 0, y: 0, active: false };
  /** The cars in each crossing or entering it, by crossing. */
  private crossings = new Map<number, Set<number>>();
  /** Each lane's stretch in the window, worked out once per size. */
  private spans = new Map<string, [number, number] | null>();
  private nextId = 1;

  resize(width: number, height: number, dpr = 1) {
    const first = !this.plan;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    const s = clamp(Math.min(width, height) / 30, 10, 34);
    if (first) {
      // The park's middle a little down and right of the window's.
      const park = { x: (PARK_BOX.x0 + PARK_BOX.x1) / 2, y: (PARK_BOX.y0 + PARK_BOX.y1) / 2 };
      const a = (0.2 * width) / s;
      const b = (2 * 0.17 * height) / s;
      this.centre = { x: park.x - (a + b) / 2, y: park.y - (b - a) / 2 };
      this.plan = new Plan(lotOf(Math.round(this.centre.x)), lotOf(Math.round(this.centre.y)));
    }
    const S = Math.max(4, 2 * Math.round((s * dpr) / 2));
    const HZ = Math.round(S * 1.1);
    const W = width * dpr;
    const H = height * dpr;
    this.iso = { S, HZ, ox: Math.round(W / 2 - (this.centre.x - this.centre.y) * S), oy: Math.round(H / 2 - ((this.centre.x + this.centre.y) * S) / 2) };
    this.spans.clear();
    this.restock(first);
  }

  /** The cells of the ground the window shows, and a margin round it: tall buildings below its
   *  bottom edge reach up into it. */
  view(margin = 2) {
    const { iso } = this;
    const W = this.width * this.dpr;
    const H = this.height * this.dpr;
    const reach = (8 * iso.HZ) / (iso.S / 2);
    const corners = [groundAt(iso, 0, 0, 0), groundAt(iso, W, 0, 0), groundAt(iso, 0, H, 0), groundAt(iso, W, H, 0)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return {
      x0: Math.floor(Math.min(...xs)) - margin, x1: Math.ceil(Math.max(...xs) + reach / 2) + margin,
      y0: Math.floor(Math.min(...ys)) - margin, y1: Math.ceil(Math.max(...ys) + reach / 2) + margin,
    };
  }

  /** Whether a point of the ground shows in the window (CSS px of room round it). */
  onScreen(x: number, y: number, room = 40) {
    const p = this.screenOf(x, y, 0);
    return p.x > -room && p.x < this.width + room && p.y > -room && p.y < this.height + room;
  }

  /** Where a point of the world is in the window, in CSS px. */
  screenOf(x: number, y: number, z: number) {
    return { x: screenX(this.iso, x, y) / this.dpr, y: screenY(this.iso, x, y, z) / this.dpr };
  }

  /** The lanes that cross the window: roads along y at each x, along x at each y. The two roads
   *  through the park carry no cars. */
  private lanes() {
    const v = this.view(0);
    const out: { axis: "x" | "y"; line: number; dir: 1 | -1 }[] = [];
    const through = (c: number) => c >= PARK * PERIOD + PERIOD && c < PARK * PERIOD + PERIOD + 2;
    for (let x = v.x0; x <= v.x1; x++) if (roadAt(x) && !through(x)) out.push({ axis: "y", line: x, dir: ((x % PERIOD) + PERIOD) % PERIOD === 0 ? -1 : 1 });
    for (let y = v.y0; y <= v.y1; y++) if (roadAt(y) && !through(y)) out.push({ axis: "x", line: y, dir: ((y % PERIOD) + PERIOD) % PERIOD === 0 ? 1 : -1 });
    // A lane that only clips a corner of the window would show a car for a moment at a time.
    return out.filter((l) => { const s = this.span(l.axis, l.line); return s && s[1] - s[0] > 14; });
  }

  /** The stretch of a lane that shows in the window, with a little more at each end. */
  span(axis: "x" | "y", line: number): [number, number] | null {
    const key = `${axis}${line}`;
    const have = this.spans.get(key);
    if (have !== undefined) return have;
    const found = this.findSpan(axis, line);
    this.spans.set(key, found);
    return found;
  }

  private findSpan(axis: "x" | "y", line: number): [number, number] | null {
    let lo = Infinity;
    let hi = -Infinity;
    const v = this.view(0);
    const [a, b] = axis === "y" ? [v.y0 - 4, v.y1 + 4] : [v.x0 - 4, v.x1 + 4];
    for (let s = a; s <= b; s += 0.5) {
      const [x, y] = axis === "y" ? [line + 0.5, s] : [s, line + 0.5];
      if (this.onScreen(x, y, 60)) {
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
    }
    return hi > lo ? [lo - 2, hi + 2] : null;
  }

  /** Cars, people and the train for the window: more for a bigger window, spread over it. */
  private restock(first: boolean) {
    const area = this.width * this.height;
    const lanes = this.lanes();
    const wantCars = clamp(Math.round(area / 52_000), 8, 34);
    // Cars whose lane no longer shows are let go; a window that grew gains some.
    this.cars = this.cars.filter((c) => lanes.some((l) => l.axis === c.axis && l.line === c.line));
    for (let k = this.cars.length; k < wantCars && lanes.length; k++) {
      const lane = lanes[(k * 7 + randInt(0, 2)) % lanes.length]!;
      const [lo, hi] = this.span(lane.axis, lane.line)!;
      // Somewhere along it in the window, apart from the cars already there.
      const at = (s: number) => (lane.axis === "y" ? [lane.line + 0.5, s] : [s, lane.line + 0.5]) as [number, number];
      let s = rand(lo, hi);
      for (let tries = 0; tries < 16 && (!this.onScreen(...at(s), -20) || this.cars.some((c) => c.axis === lane.axis && c.line === lane.line && Math.abs(c.s - s) < 3)); tries++) s = rand(lo, hi);
      this.cars.push({ id: this.nextId++, axis: lane.axis, line: lane.line, s, dir: lane.dir, speed: rand(1.8, 2.7), colour: randInt(0, 5), waiting: false, holds: [] });
    }
    this.cars.length = Math.min(this.cars.length, wantCars);
    // People on the pavements round the blocks that show, one block after another.
    const v = this.view(0);
    const blocks: { bx: number; by: number }[] = [];
    for (let by = lotOf(v.y0); by <= lotOf(v.y1); by++) {
      for (let bx = lotOf(v.x0); bx <= lotOf(v.x1); bx++) {
        const park = bx >= PARK && bx <= PARK + 1 && by >= PARK && by <= PARK + 1;
        if (park && (bx !== PARK || by !== PARK)) continue;
        if (this.onScreen(bx * PERIOD + 6, by * PERIOD + 6, 0)) blocks.push({ bx, by });
      }
    }
    const wantPeople = clamp(Math.round(area / 40_000), 10, 40);
    this.people = this.people.filter((p) => blocks.some((b) => b.bx === p.bx && b.by === p.by));
    if (first || this.people.length < wantPeople) {
      const order = [...blocks].sort(() => Math.random() - 0.5);
      for (let k = this.people.length; k < wantPeople && order.length; k++) {
        const b = order[k % order.length]!;
        // Somewhere round its block's pavement that shows.
        let along = rand(0, ringLength(b.bx, b.by));
        for (let tries = 0; tries < 16 && !this.onScreen(alongRing(b.bx, b.by, along).x, alongRing(b.bx, b.by, along).y, -20); tries++) along = rand(0, ringLength(b.bx, b.by));
        const p: Person = { id: this.nextId++, bx: b.bx, by: b.by, p: along, dir: Math.random() < 0.5 ? 1 : -1, speed: rand(0.45, 0.75), x: 0, y: 0, face: 0, pause: Math.random() < 0.25 ? rand(0, 3) : 0, looking: false, look: 0, stepPhase: rand(0, 1) };
        this.placePerson(p);
        this.people.push(p);
      }
    }
    this.people.length = Math.min(this.people.length, wantPeople);
  }

  // ── the pointer and clicks ──────────────────────────────────────────────

  point(x: number, y: number, active: boolean) {
    this.pointer = { x, y, active };
  }

  /** How high a column stands: the building on it, or the plate; dropped bricks not counted. */
  heightAt(x: number, y: number) {
    const house = this.houseAt(x, y);
    if (!house) return 0;
    return house.floors + roofOver(house, x, y);
  }

  private houseAt(x: number, y: number): House | null {
    const lot = this.plan.lot(inPark(x, y) ? PARK : lotOf(x), inPark(x, y) ? PARK : lotOf(y));
    return lot.houses.find((h) => x >= h.x0 && x < h.x0 + h.w && y >= h.y0 && y < h.y0 + h.d) ?? null;
  }

  /** Whether a dropped brick may land at a column: on a building, a garden or a stack, not in the
   *  street, on a path or the track, or into a tree or a lamp. */
  stackable(x: number, y: number) {
    const g = this.plan.ground(x, y);
    if (g !== Ground.Plate && !this.houseAt(x, y)) return false;
    const lot = this.plan.lot(inPark(x, y) ? PARK : lotOf(x), inPark(x, y) ? PARK : lotOf(y));
    if (lot.trees.some((t) => t.x === x && t.y === y) || lot.lamps.some((l) => l.x === x && l.y === y) || lot.beds.some((b) => b.x === x && b.y === y)) return false;
    if (lot.fountain && Math.abs(lot.fountain.x - x - 0.5) < 1.5 && Math.abs(lot.fountain.y - y - 0.5) < 1.5) return false;
    return true;
  }

  /** The top of a column, dropped bricks (falling to it or set) counted. */
  stackTop(x: number, y: number) {
    let n = 0;
    for (const b of this.bricks) if (b.x === x && b.y === y && b.state !== "leaving") n++;
    return this.heightAt(x, y) + n;
  }

  /** The column a point of the window (CSS px) shows, its top or a side, building or ground. */
  columnAt(px: number, py: number) {
    const X = px * this.dpr;
    const Y = py * this.dpr;
    for (let z = 10; z >= 0; z -= 0.25) {
      const g = groundAt(this.iso, X, Y, z);
      const x = Math.floor(g.x);
      const y = Math.floor(g.y);
      if (z === 0 || this.stackTop(x, y) >= z) return { x, y };
    }
    const g = groundAt(this.iso, X, Y, 0);
    return { x: Math.floor(g.x), y: Math.floor(g.y) };
  }

  /** The stack nearest a point of the window: the column under it if a brick may land there, else
   *  the nearest one that may, by how far its top is from the point on the screen. */
  stackNear(px: number, py: number) {
    const c = this.columnAt(px, py);
    if (this.stackable(c.x, c.y)) return c;
    let best = c;
    let bd = Infinity;
    for (let b = -6; b <= 6; b++) {
      for (let a = -6; a <= 6; a++) {
        const x = c.x + a;
        const y = c.y + b;
        if (!this.stackable(x, y)) continue;
        const p = this.screenOf(x + 0.5, y + 0.5, this.stackTop(x, y));
        const d = Math.hypot(p.x - px, p.y - py);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    return best;
  }

  splash(px: number, py: number) {
    const { x, y } = this.stackNear(px, py);
    const rest = this.stackTop(x, y);
    // From above the top of the window.
    const above = (screenY(this.iso, x + 0.5, y + 0.5, rest) + 2 * this.iso.HZ) / this.iso.HZ;
    this.bricks.push({ id: this.nextId++, x, y, z: rest + Math.max(4, above), rest, vz: 0, colour: randInt(0, BRICK_COLOURS - 1), state: "falling", age: 0, bounces: 0 });
    const kept = this.bricks.filter((b) => b.state !== "leaving");
    if (kept.length > BRICKS) this.lift(kept[0]!);
  }

  /** Lift a brick away; those stacked over it settle down a brick. */
  private lift(b: Brick) {
    b.state = "leaving";
    b.age = 0;
    for (const o of this.bricks) {
      if (o === b || o.state === "leaving" || o.x !== b.x || o.y !== b.y || o.rest < b.rest) continue;
      o.rest -= 1;
      if (o.state === "set") { o.state = "falling"; o.vz = 0; o.bounces = 1; }
    }
  }

  // ── a step ───────────────────────────────────────────────────────────────

  step(dt: number) {
    this.time += dt;
    this.stepCars(dt);
    this.train.d = (this.train.d + TRAIN_SPEED * dt) % TRACK_LENGTH;
    this.stepPeople(dt);
    for (const b of this.bricks) {
      b.age += dt;
      if (b.state === "falling") {
        b.vz -= GRAVITY * dt;
        b.z += b.vz * dt;
        if (b.z <= b.rest) {
          b.z = b.rest;
          if (b.bounces < 2 && b.vz < -3) {
            b.vz = -b.vz * (b.bounces ? 0.18 : 0.3);
            b.bounces++;
          } else {
            b.state = "set";
            b.vz = 0;
          }
        }
      } else if (b.state === "leaving") b.z += dt * 3;
    }
    this.bricks = this.bricks.filter((b) => b.state !== "leaving" || b.age < 0.8);
  }

  private stepCars(dt: number) {
    for (const c of this.cars) {
      const span = this.span(c.axis, c.line);
      if (!span) continue;
      // Behind another car in the lane: keep a gap.
      let blocked = this.cars.some((o) => o !== c && o.axis === c.axis && o.line === c.line && (o.s - c.s) * c.dir > 0 && Math.abs(o.s - c.s) < 2.6);
      // The crossings its body is in, which it always drives on out of, and the one its front is
      // about to enter, which it enters only when no other car is in it or entering it.
      const body = [c.s - 0.8, c.s + 0.8];
      const ahead = c.dir > 0 ? [c.s + 0.8, c.s + 1.7] : [c.s - 1.7, c.s - 0.8];
      const crossed = (lo: number, hi: number) => {
        const out: number[] = [];
        for (let m = Math.floor(lo / PERIOD); m <= Math.floor(hi / PERIOD); m++) if (m * PERIOD < hi && m * PERIOD + 2 > lo) out.push(crossingKey(c, m));
        return out;
      };
      const inside = crossed(body[0]!, body[1]!);
      const entering = crossed(ahead[0]!, ahead[1]!).filter((k) => !inside.includes(k));
      for (const k of entering) {
        const there = this.crossings.get(k);
        if (there && [...there].some((id) => id !== c.id)) blocked = true;
      }
      const need = blocked ? inside : [...inside, ...entering];
      for (const k of c.holds) if (!need.includes(k)) this.crossings.get(k)?.delete(c.id);
      for (const k of need) {
        const there = this.crossings.get(k) ?? new Set<number>();
        there.add(c.id);
        this.crossings.set(k, there);
      }
      c.holds = need;
      c.waiting = blocked;
      if (!blocked) c.s += c.dir * c.speed * dt;
      // Past the far end of the window: round again from the near end.
      if ((c.dir > 0 && c.s > span[1]) || (c.dir < 0 && c.s < span[0])) {
        for (const k of c.holds) this.crossings.get(k)?.delete(c.id);
        c.holds = [];
        c.s = c.dir > 0 ? span[0] : span[1];
        while (this.cars.some((o) => o !== c && o.axis === c.axis && o.line === c.line && Math.abs(o.s - c.s) < 2.8)) c.s -= c.dir * 3;
      }
    }
  }

  private placePerson(p: Person) {
    const at = alongRing(p.bx, p.by, p.p);
    p.x = at.x;
    p.y = at.y;
    p.face = p.dir > 0 ? at.dir : (at.dir + 2) % 4;
  }

  private stepPeople(dt: number) {
    const ptr = this.pointer;
    for (const p of this.people) {
      const sp = this.screenOf(p.x, p.y, 0.6);
      const near = ptr.active && Math.hypot(sp.x - ptr.x, sp.y - ptr.y) < LOOK_REACH;
      if (near) {
        // Stop, turn to the pointer, and look up at it.
        p.looking = true;
        p.look = Math.min(1, p.look + dt * 4);
        const g = groundAt(this.iso, ptr.x * this.dpr, ptr.y * this.dpr, 3);
        const dx = g.x - p.x;
        const dy = g.y - p.y;
        p.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 0 : 2) : dy > 0 ? 1 : 3;
        continue;
      }
      if (p.looking) {
        p.looking = false;
        p.pause = this.time + rand(0.2, 0.8);
      }
      p.look = Math.max(0, p.look - dt * 3);
      if (this.time < p.pause) continue;
      p.p += p.dir * p.speed * dt;
      p.stepPhase += p.speed * dt * 2.2;
      const len = ringLength(p.bx, p.by);
      p.p = ((p.p % len) + len) % len;
      this.placePerson(p);
      // Now and then a pause, or a turn back.
      if (Math.random() < dt * 0.05) p.pause = this.time + rand(1, 3.5);
      else if (Math.random() < dt * 0.02) p.dir = p.dir > 0 ? -1 : 1;
    }
  }
}

/** The key of the crossing a car's road meets at the `m`th period along it. */
function crossingKey(c: Car, m: number) {
  const across = Math.floor(c.line / PERIOD);
  return c.axis === "y" ? across * 4099 + m : m * 4099 + across;
}

/** How many roof bricks lie over a house's cell: a stepped roof rises toward its ridge along the
 *  house's longer side; a flat one has none. */
export function roofOver(h: House, x: number, y: number) {
  if (h.flat) return 0;
  const across = h.w <= h.d ? x - h.x0 : y - h.y0;
  const width = Math.min(h.w, h.d);
  let n = 0;
  for (let k = 0; k * 2 < width; k++) if (across >= k && across < width - k) n++;
  return n;
}

/** The pavement round block (bx, by): its corners through cell middles. The park's four blocks
 *  share one, round all of it. */
function ring(bx: number, by: number) {
  if (bx === PARK && by === PARK) return { x0: PARK_BOX.x0 + 0.5, y0: PARK_BOX.y0 + 0.5, side: PARK_BOX.x1 - PARK_BOX.x0 - 1 };
  return { x0: bx * PERIOD + 2.5, y0: by * PERIOD + 2.5, side: 7 };
}
export const ringLength = (bx: number, by: number) => ring(bx, by).side * 4;

/** Where `p` along the pavement round a block is, and the way it runs there. */
export function alongRing(bx: number, by: number, p: number) {
  const r = ring(bx, by);
  const len = r.side * 4;
  const s = ((p % len) + len) % len;
  const k = Math.min(3, Math.floor(s / r.side));
  const t = s - k * r.side;
  const corners = [[r.x0, r.y0], [r.x0 + r.side, r.y0], [r.x0 + r.side, r.y0 + r.side], [r.x0, r.y0 + r.side]] as const;
  const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][k]!;
  return { x: corners[k]![0] + dx! * t, y: corners[k]![1] + dy! * t, dir: k };
}
