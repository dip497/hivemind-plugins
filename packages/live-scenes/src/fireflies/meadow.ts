/**
 * Fireflies' meadow at night: fireflies flying over the grass, flashing. The bigger ones, a few of
 * every kind and more on a bigger window, each choose for themselves what they do, in turn: fly
 * about flashing their kind's code quickly, drift flashing it slowly, or settle in the grass a while,
 * glowing faintly. Small ones wander over the meadow, each blinking slowly on its own.
 *
 * The fireflies are curious about the pointer: those near it drift to it and circle it. A click is a
 * burst of light spreading out from it a little way: the fireflies it reaches flash and scatter, and
 * one settled in the grass takes off.
 */
import type { Sim } from "../scene";
import { angleDiff, clamp, rand, TAU } from "../math";
import { goalAhead, spread, stockOf } from "../steer";
import { FIREFLY_KINDS, FLASHES, type FireflyKind } from "./kinds";

/** What a firefly is doing, which it chooses for itself, one after another. */
export type Habit = "fly" | "drift" | "perch";

/** Per habit: how fast it flies, how often it picks somewhere new to go (seconds), the odds of its
 *  being what a firefly does next, and for how long (seconds). */
const HABITS: Record<Habit, { speed: number; every: [number, number]; odds: number; secs: [number, number] }> = {
  fly: { speed: 60, every: [4, 7], odds: 0.3, secs: [8, 16] },
  drift: { speed: 26, every: [8, 14], odds: 0.5, secs: [12, 24] },
  perch: { speed: 30, every: [0, 0], odds: 0.2, secs: [10, 25] },
};

/** A firefly to each 140,000 px² of window (nine on a laptop's, one of each kind at least), at most
 *  fourteen. */
const STOCK = { area: 140_000, max: 14 };
/** Where in the window the fireflies fly (shares of the height), and where they settle: in the
 *  grass along the bottom. */
const AIR: [number, number] = [0.15, 0.74];
const GRASS: [number, number] = [0.87, 0.94];
/** How near the pointer a firefly is curious about it (px), how far round it it circles, and how
 *  many of the bigger ones come at once. */
const CURIOUS = 220;
const ORBIT = 60;
const COME = 3;

export interface Firefly {
  id: number;
  kind: FireflyKind;
  /** Relative to the biggest. */
  size: number;
  habit: Habit;
  /** When it chooses what to do next. */
  habitUntil: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which way it faces: 1 right, -1 left. */
  facing: 1 | -1;
  /** Where in its code it starts, so two of a kind do not flash as one. */
  offset: number;
  /** 0 to 1: a bright flash, fading. */
  glow: number;
  /** Settled in the grass. */
  perched: boolean;
  /** Until when it flies from a burst of light: it is curious about nothing meanwhile. */
  startled: number;
  goal: { x: number; y: number } | null;
  goalAt: number;
}

/** One of the meadow's small fireflies. */
export interface Mote {
  x: number;
  y: number;
  /** Its heading and speed. */
  heading: number;
  speed: number;
  /** Its own slow blink: how often, and where in it. */
  period: number;
  offset: number;
  /** 0 to 1: a flash, fading. */
  answer: number;
  /** Which way it circles the pointer. */
  turn: 1 | -1;
}

/** A click's burst of light spreading out from it: the fireflies it reaches flash. */
export interface Wave {
  x: number;
  y: number;
  age: number;
  /** The fireflies, big and small, it has reached: each once, however it flies. */
  reached: Set<object>;
}

/** How fast a burst spreads, in px/s, and how far. */
export const WAVE_SPEED = 320;
export const WAVE_REACH = 260;

export class Meadow implements Sim {
  width = 0;
  height = 0;
  time = 0;
  flies: Firefly[] = [];
  motes: Mote[] = [];
  waves: Wave[] = [];
  pointer = { x: 0, y: 0, active: false };
  private nextId = 1;
  /** The bigger fireflies circling the pointer now, chosen again each second. */
  private curious = new Set<Firefly>();
  private curiousAt = 0;

  resize(width: number, height: number) {
    const first = this.width === 0;
    // The fireflies stay, moved into the new window as they were in the old.
    if (!first) {
      for (const f of [...this.flies, ...this.motes]) {
        f.x *= width / this.width;
        f.y *= height / this.height;
      }
      for (const f of this.flies) f.goal = null;
    }
    this.width = width;
    this.height = height;
    const n = clamp(Math.round((width * height) / 22000), 24, 90);
    if (first || Math.abs(this.motes.length - n) > n * 0.25) {
      this.motes = Array.from({ length: n }, () => ({
        x: rand(0, width), y: rand(height * 0.3, height * 0.95), heading: rand(0, TAU), speed: rand(8, 20),
        period: rand(2, 5), offset: rand(0, 8), answer: 0, turn: Math.random() < 0.5 ? 1 : -1,
      }));
    }
    this.restock();
  }

  /** The fireflies for the window's size, spread over the air above the meadow: a window that grows
   *  gains some, one that shrinks loses the last come, and one of every kind stays. */
  private restock() {
    const { width: W, height: H } = this;
    const want = stockOf(W, H, STOCK.area, FIREFLY_KINDS.length, STOCK.max);
    if (this.flies.length > want) {
      const keep = new Set([...this.flies].sort((a, b) => a.id - b.id).slice(0, want));
      this.flies = this.flies.filter((f) => keep.has(f));
    }
    for (const p of spread(want - this.flies.length, W, H * (AIR[1] - AIR[0]))) {
      const f = this.firefly(p.x, H * AIR[0] + p.y, FIREFLY_KINDS[this.flies.length % FIREFLY_KINDS.length]!);
      // One that chose to settle is in the grass already.
      if (f.habit === "perch") {
        f.y = rand(H * GRASS[0], H * GRASS[1]);
        f.perched = true;
      }
      this.flies.push(f);
    }
  }

  /** A firefly of `kind` at (x, y), doing whatever it chooses. */
  private firefly(x: number, y: number, kind: FireflyKind): Firefly {
    const f: Firefly = {
      id: this.nextId++, kind, size: rand(0.7, 1), habit: "drift", habitUntil: 0,
      x, y, vx: 0, vy: 0, facing: Math.random() < 0.5 ? 1 : -1, offset: rand(0, 10), glow: 0, perched: false, startled: 0, goal: null, goalAt: 0,
    };
    this.choose(f);
    // Partway through it, so the fireflies do not all choose again at once.
    f.habitUntil = this.time + (f.habitUntil - this.time) * rand(0.15, 1);
    return f;
  }

  /** What a firefly does next, by the habits' odds, and for how long. */
  private choose(f: Firefly) {
    const all = Object.keys(HABITS) as Habit[];
    let r = Math.random() * all.reduce((sum, h) => sum + HABITS[h].odds, 0);
    let habit = all[0]!;
    for (habit of all) if ((r -= HABITS[habit].odds) <= 0) break;
    if (habit !== f.habit) {
      f.goal = null;
      f.perched = false;
    }
    f.habit = habit;
    f.habitUntil = this.time + rand(HABITS[habit].secs[0], HABITS[habit].secs[1]);
  }

  /** How bright a firefly is now, 0 to 1: its kind's code, quick while it flies about and slower
   *  as it drifts, and a faint glow settled in the grass. */
  light(f: Firefly) {
    const t = this.time + f.offset;
    const own = f.habit === "fly" ? FLASHES[f.kind](t * 1.35)
      : f.habit === "drift" ? 0.8 * FLASHES[f.kind](t)
      : 0.14 + 0.1 * Math.sin(t * 0.8);
    return clamp(own + f.glow, 0, 1);
  }

  /** How bright a small firefly is now, 0 to 1: its own slow blink, or a flash. */
  moteLight(m: Mote) {
    const p = ((this.time + m.offset) % m.period) / 0.7;
    const own = p > 0 && p < 1 ? Math.sin(Math.PI * p) ** 2 * 0.8 : 0;
    return Math.max(own, m.answer);
  }

  /** The pointer over the meadow, or gone from it. */
  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** A click in the meadow: a burst of light spreads out from it, and the fireflies near it scatter
   *  as it reaches them. */
  splash(x: number, y: number) {
    this.waves.push({ x, y, age: 0, reached: new Set() });
    if (this.waves.length > 4) this.waves.shift();
  }

  step(dt: number) {
    this.time += dt;
    this.chooseCurious();
    for (const f of this.flies) this.fly(f, dt);
    this.burst(dt);
    this.drift(dt);
  }

  /** The bigger fireflies nearest the pointer, a few, unless settled in the grass. */
  private chooseCurious() {
    const { pointer, time } = this;
    if (!pointer.active) {
      this.curious.clear();
      return;
    }
    if (time < this.curiousAt) return;
    this.curiousAt = time + 1;
    const away = (f: Firefly) => Math.hypot(f.x - pointer.x, f.y - pointer.y);
    this.curious = new Set(this.flies.filter((f) => !f.perched && time >= f.startled && away(f) < CURIOUS * 1.6).sort((a, b) => away(a) - away(b)).slice(0, COME));
  }

  /** Each burst spreads; what it reaches flashes and scatters from it, and a firefly settled in the
   *  grass takes off. */
  private burst(dt: number) {
    const { width: W, height: H } = this;
    for (const w of this.waves) {
      const was = w.age * WAVE_SPEED;
      w.age += dt;
      const front = w.age * WAVE_SPEED;
      if (was > WAVE_REACH) continue;
      for (const f of this.flies) {
        const d = Math.hypot(f.x - w.x, f.y - w.y);
        if (d >= front || d > WAVE_REACH || w.reached.has(f)) continue;
        w.reached.add(f);
        f.glow = Math.max(f.glow, 1 - 0.5 * (d / WAVE_REACH));
        const ux = (f.x - w.x) / (d || 1);
        const uy = (f.y - w.y) / (d || 1);
        const k = (1 - d / WAVE_REACH) * 90 + 30;
        f.vx += ux * k;
        f.vy += uy * k;
        // It flies off away from it, quickly, a while; one settled in the grass takes off.
        f.perched = false;
        f.habit = "fly";
        f.habitUntil = Math.max(f.habitUntil, this.time + rand(4, 8));
        f.startled = this.time + 2.5;
        f.goal = { x: clamp(f.x + ux * 220, W * 0.04, W * 0.96), y: clamp(f.y + uy * 220, H * AIR[0], H * AIR[1]) };
        f.goalAt = this.time + 2.5;
      }
      for (const m of this.motes) {
        const d = Math.hypot(m.x - w.x, m.y - w.y);
        if (d >= front || d > WAVE_REACH || w.reached.has(m)) continue;
        w.reached.add(m);
        m.answer = 1;
        m.heading = Math.atan2(m.y - w.y, m.x - w.x);
        m.speed = 40 + 30 * (1 - d / WAVE_REACH);
      }
    }
    if (this.waves.some((w) => w.age * WAVE_SPEED > WAVE_REACH * 2)) this.waves = this.waves.filter((w) => w.age * WAVE_SPEED <= WAVE_REACH * 2);
  }

  private fly(f: Firefly, dt: number) {
    const { width: W, height: H, time, pointer } = this;
    if (time >= f.habitUntil) this.choose(f);
    f.glow = Math.max(0, f.glow - dt * 0.8);
    const habit = HABITS[f.habit];
    let speed = habit.speed;
    const curious = this.curious.has(f) && time >= f.startled;
    if (curious) {
      // Round the pointer, a little ahead of where it is on the circle, each its own way.
      const a = Math.atan2(f.y - pointer.y, f.x - pointer.x) + (f.id % 2 ? 0.6 : -0.6);
      f.goal = { x: pointer.x + Math.cos(a) * ORBIT, y: pointer.y + Math.sin(a) * ORBIT * 0.7 };
      speed = 34;
    } else if (f.habit === "perch") {
      // Down into the grass, somewhere along it, and settled there.
      if (!f.goal || f.goal.y < H * GRASS[0]) f.goal = { x: clamp(f.x + rand(-200, 200), W * 0.04, W * 0.96), y: rand(H * GRASS[0], H * GRASS[1]) };
    } else if (!f.goal || (time >= f.startled && (time > f.goalAt || Math.hypot(f.goal.x - f.x, f.goal.y - f.y) < 20))) {
      f.goal = goalAhead(W, H, AIR[0], AIR[1], { x: f.x, y: f.y });
      f.goalAt = time + rand(habit.every[0], habit.every[1]);
    }
    const gx = f.goal.x - f.x;
    const gy = f.goal.y - f.y;
    const far = Math.hypot(gx, gy) || 1;
    // Settled in the grass, it stays, till it chooses otherwise or a burst lifts it.
    if (f.habit === "perch" && !curious && (f.perched || far < 6)) {
      f.perched = true;
      f.vx -= f.vx * Math.min(1, dt * 4);
      f.vy -= f.vy * Math.min(1, dt * 4);
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      return;
    }
    // Close to where it is going it slows; it never flies quite straight.
    const slow = clamp(far / 60, 0.15, 1);
    const wobble = Math.sin(time * 3.1 + f.id * 1.7) * 0.5;
    const a = Math.atan2(gy, gx) + wobble;
    let ax = (Math.cos(a) * speed * slow - f.vx) * 2.2;
    let ay = (Math.sin(a) * speed * slow - f.vy) * 2.2;
    if (f.x < 10) ax += 200;
    if (f.x > W - 10) ax -= 200;
    if (f.y < 10) ay += 200;
    if (f.y > H - 10) ay -= 200;
    f.vx += ax * dt;
    f.vy += ay * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    if (f.vx > 4) f.facing = 1;
    else if (f.vx < -4) f.facing = -1;
  }

  private drift(dt: number) {
    const { width: W, height: H, time, pointer } = this;
    for (const m of this.motes) {
      m.answer = Math.max(0, m.answer - dt * 1.4);
      m.heading += Math.sin(time * 0.7 + m.offset * 3) * dt * 1.2;
      // Over the meadow, mostly: back from the top and the sides.
      if (m.y < H * 0.3) m.heading += angleDiff(m.heading, Math.PI / 2) * dt * 0.8;
      if (m.y > H * 0.95) m.heading += angleDiff(m.heading, -Math.PI / 2) * dt * 0.8;
      let pace = rand(8, 20);
      const dx = m.x - pointer.x;
      const dy = m.y - pointer.y;
      const d = Math.hypot(dx, dy);
      if (pointer.active && d < CURIOUS) {
        // Curious: it turns, at its own easy rate, toward a point a little round the circle about
        // the pointer, its own way, and slows as it nears it.
        const a = Math.atan2(dy, dx) + m.turn * 0.7;
        const r = ORBIT * (0.6 + (m.offset % 1) * 0.8);
        const to = Math.atan2(pointer.y + Math.sin(a) * r - m.y, pointer.x + Math.cos(a) * r - m.x);
        m.heading += clamp(angleDiff(m.heading, to), -2.2 * dt, 2.2 * dt);
        pace = 10 + 8 * (d / CURIOUS);
      }
      m.speed += (pace - m.speed) * dt * 0.5;
      m.x += Math.cos(m.heading) * m.speed * dt;
      m.y += Math.sin(m.heading) * m.speed * dt;
      if (m.x < -8) m.x += W + 16;
      else if (m.x > W + 8) m.x -= W + 16;
      m.y = clamp(m.y, 4, H - 4);
    }
  }
}
