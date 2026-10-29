/**
 * Jellyfish's water: jellies that swim by beating their bells, each a push along the way the bell
 * faces, then a drift as it opens again, and that sink slowly between; their tentacles trail behind
 * them and sway. Marine snow falls slowly through it all, and a beat stirs it.
 *
 * The deep stocks itself for the window's size, a jelly of every kind and more on a bigger window,
 * and each jelly chooses for itself what it does, in turn: roams the water, beating often, drifts,
 * or sinks low and barely beats. The pointer pushes the snow aside and nudges the jellies away from
 * it; a click sends a pulse out through the water, and the jellies it reaches start, flash and jet
 * away from it as the snow swirls.
 */
import type { Sim } from "../scene";
import { angleDiff, clamp, current, rand } from "../math";
import { goalAhead, spread, stockOf } from "../steer";
import { JELLY_KINDS, JELLY_SHAPES, type JellyKind, type JellyShape } from "./kinds";

/** What a jelly is doing, which it chooses for itself, one after another. */
export type Habit = "roam" | "drift" | "rest";

/** Per habit: how fast its bell beats against its kind's own pace, how hard, how near it swims (0
 *  far and dim, 1 near and bright), the odds of its being what a jelly does next, for how long
 *  (seconds), and the band of the window it keeps to (shares of the height). */
const HABITS: Record<Habit, { rate: number; thrust: number; depth: number; odds: number; secs: [number, number]; band: [number, number] }> = {
  roam: { rate: 1.5, thrust: 1.1, depth: 0.85, odds: 0.3, secs: [14, 26], band: [0.15, 0.8] },
  drift: { rate: 1, thrust: 0.85, depth: 0.65, odds: 0.5, secs: [18, 36], band: [0.15, 0.82] },
  rest: { rate: 0.35, thrust: 0.45, depth: 0.35, odds: 0.2, secs: [14, 28], band: [0.7, 0.9] },
};

/** A jelly to each 165,000 px² of window (eight, one of each kind, on a laptop's), at most
 *  twelve. */
const STOCK = { area: 165_000, max: 12 };

/** Nodes in a tentacle, and in an oral arm. */
export const TENTACLE_NODES = 14;
export const ARM_NODES = 9;
/** The furthest a jelly leans from upright: it swims up and a little across, and sinks to go down.
 *  Resting it hardly leans; jetting from a pulse it leans as far as it must. */
const MAX_TILT = 0.32;
const RESTING_TILT = 0.15;
const JETTING_TILT = 0.95;
/** How fast a bell's push fades in the water. */
const DRAG = 1.2;
/** How much of the current (math.ts) carries a jelly along. */
const CURRENT = 0.35;
/** How near the pointer nudges a jelly (px past its bell), and how hard. */
const NUDGE = 90;
/** A click's pulse: how fast it spreads (px/s), and how far. */
export const PULSE_SPEED = 260;
export const PULSE_REACH = 300;

export interface Strand {
  /** [x0, y0, x1, y1, …], node 0 on the bell. */
  nodes: Float32Array;
  /** Where on the rim it hangs from, -1 to 1 across; whether it is an oral arm, or the one long
   *  tentacle of a kind that has one. */
  anchor: number;
  arm: boolean;
  trailer: boolean;
  /** The length of each of its segments, in px. */
  seg: number;
  /** Where in its sway it starts, and an arm where in its frills: no two alike. */
  phase: number;
}

export interface Jelly {
  id: number;
  kind: JellyKind;
  shape: JellyShape;
  /** Relative to the biggest. */
  size: number;
  habit: Habit;
  /** When it chooses what to do next. */
  habitUntil: number;
  /** The middle of its bell's rim, in px, and its velocity. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Its lean from upright (radians, + to the right): its bell faces up and over by this much, and
   *  each beat pushes it that way. Its rim stays level, its crown leaning over it. */
  tilt: number;
  /** Its beat: `phase` 0 to 1 through one, `beat` how closed its bell is (0 open, 1 closed). */
  phase: number;
  beat: number;
  /** Its size in px against which the kind's shape is set (`unit` × size × nearness). */
  length: number;
  depth: number;
  /** 0 to 1: a flash of its own light, fading. */
  glow: number;
  /** Startled by a pulse: until when it jets, and which way (a lean). */
  jetUntil: number;
  jetTilt: number;
  goal: { x: number; y: number } | null;
  goalAt: number;
  strands: Strand[];
}

/** A speck of marine snow. `z` is how near it is, 0.3 to 1. */
export interface Mote {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
}

/** A click's pulse spreading through the water, and the jellies it has reached. */
export interface Pulse {
  x: number;
  y: number;
  age: number;
  reached: Set<Jelly>;
}

/** How closed a bell is through a beat: shut quickly, open slowly. */
export function beatAt(phase: number) {
  return phase < 0.3 ? Math.sin((phase / 0.3) * (Math.PI / 2)) : Math.cos(((phase - 0.3) / 0.7) * (Math.PI / 2)) ** 2;
}

/** The bell's half-width and height for a jelly as it is now: narrower and taller as it shuts. */
export function bellOf(j: Pick<Jelly, "shape" | "length" | "beat">) {
  return { w: j.shape.w * j.length * (1 - 0.22 * j.beat), h: j.shape.h * j.length * (1 + 0.2 * j.beat) };
}

export class Swarm implements Sim {
  width = 0;
  height = 0;
  time = 0;
  jellies: Jelly[] = [];
  snow: Mote[] = [];
  pulses: Pulse[] = [];
  pointer = { x: 0, y: 0, active: false };
  private nextId = 1;
  private flow = { x: 0, y: 0 };

  resize(width: number, height: number) {
    const first = this.width === 0;
    // The jellies and the snow stay, moved into the new window as they were in the old.
    if (!first) this.scale(width / this.width, height / this.height);
    this.width = width;
    this.height = height;
    const n = clamp(Math.round((width * height) / 2600), 120, 900);
    if (first || Math.abs(this.snow.length - n) > n * 0.2) {
      this.snow = Array.from({ length: n }, () => ({ x: rand(0, width), y: rand(0, height), z: rand(0.3, 1), vx: 0, vy: 0 }));
    }
    this.restock();
  }

  /** Every jelly and speck moved `kx` and `ky` times as far from the window's top left: a jelly
   *  whole, its strands with it. */
  private scale(kx: number, ky: number) {
    for (const m of this.snow) {
      m.x *= kx;
      m.y *= ky;
    }
    for (const j of this.jellies) {
      const dx = j.x * (kx - 1);
      const dy = j.y * (ky - 1);
      j.x += dx;
      j.y += dy;
      j.goal = null;
      for (const s of j.strands) {
        for (let k = 0; k < s.nodes.length; k += 2) {
          s.nodes[k] = s.nodes[k]! + dx;
          s.nodes[k + 1] = s.nodes[k + 1]! + dy;
        }
      }
    }
  }

  /** The biggest jelly's length: a share of the window's shorter side. */
  private unit() {
    return clamp(Math.min(this.width, this.height) * 0.15, 85, 190);
  }

  /** The jellies for the window's size, spread over all of it: a window that grows gains some, one
   *  that shrinks loses the last come, and one of every kind stays. */
  private restock() {
    const want = stockOf(this.width, this.height, STOCK.area, JELLY_KINDS.length, STOCK.max);
    if (this.jellies.length > want) {
      const keep = new Set([...this.jellies].sort((a, b) => a.id - b.id).slice(0, want));
      this.jellies = this.jellies.filter((j) => keep.has(j));
    }
    // Rims spread over the window, high enough that the tentacles hang in it.
    for (const p of spread(want - this.jellies.length, this.width, this.height * 0.85)) {
      this.jellies.push(this.jelly(p.x, p.y + this.height * 0.05, JELLY_KINDS[this.jellies.length % JELLY_KINDS.length]!));
    }
    this.jellies.sort((a, b) => a.depth - b.depth);
  }

  /** A jelly of `kind` with its rim at (x, y), its tentacles hanging below it, doing whatever it
   *  chooses, already as near as that has it. */
  private jelly(x: number, y: number, kind: JellyKind): Jelly {
    const j: Jelly = {
      id: this.nextId++, kind, shape: JELLY_SHAPES[kind], size: rand(0.72, 1), habit: "drift", habitUntil: 0,
      x, y, vx: 0, vy: 0, tilt: rand(-0.2, 0.2), phase: Math.random(), beat: 0,
      length: 0, depth: 0, glow: 0, jetUntil: 0, jetTilt: 0, goal: null, goalAt: 0, strands: [],
    };
    this.choose(j);
    // Partway through it, so the jellies do not all choose again at once.
    j.habitUntil = this.time + (j.habitUntil - this.time) * rand(0.15, 1);
    j.depth = HABITS[j.habit].depth;
    j.length = this.unit() * j.size * (0.8 + 0.3 * j.depth);
    j.strands = this.strandsOf(j);
    return j;
  }

  /** What a jelly does next, by the habits' odds, and for how long. */
  private choose(j: Jelly) {
    const all = Object.keys(HABITS) as Habit[];
    let r = Math.random() * all.reduce((sum, h) => sum + HABITS[h].odds, 0);
    let habit = all[0]!;
    for (habit of all) if ((r -= HABITS[habit].odds) <= 0) break;
    if (habit !== j.habit) j.goal = null;
    j.habit = habit;
    j.habitUntil = this.time + rand(HABITS[habit].secs[0], HABITS[habit].secs[1]);
  }

  /** The pointer over the water, or gone from it. */
  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** A click on the water: a pulse spreads out from it, and the snow round it swirls. */
  splash(x: number, y: number) {
    this.pulses.push({ x, y, age: 0, reached: new Set() });
    if (this.pulses.length > 4) this.pulses.shift();
    for (const m of this.snow) {
      const dx = m.x - x;
      const dy = m.y - y;
      const d = Math.hypot(dx, dy);
      if (d > 220 || d < 1) continue;
      // Out from it, and round it.
      const k = (1 - d / 220) * 70;
      m.vx += ((dx - dy * 1.2) / d) * k;
      m.vy += ((dy + dx * 1.2) / d) * k;
    }
  }

  private strandsOf(j: Jelly): Strand[] {
    const out: Strand[] = [];
    const { tentacles, reach, arms, armReach, trailer } = j.shape;
    const strand = (anchor: number, arm: boolean, long: boolean, length: number, nodes: number): Strand =>
      ({ nodes: new Float32Array(nodes * 2), anchor, arm, trailer: long, seg: (length * j.length) / (nodes - 1), phase: Math.floor(Math.random() * 4) });
    // The arms from under its middle, the tentacles round its rim, each a little longer or shorter
    // than the next.
    const spread = Math.min(0.32, 0.06 * arms);
    for (let i = 0; i < arms; i++) out.push(strand(arms === 1 ? 0 : -spread + (2 * spread * i) / (arms - 1), true, false, armReach * rand(0.85, 1.1), ARM_NODES));
    for (let i = 0; i < tentacles; i++) out.push(strand(tentacles === 1 ? 0 : -0.92 + (1.84 * i) / (tentacles - 1), false, false, reach * rand(0.75, 1.15), TENTACLE_NODES));
    if (trailer) out.push(strand(0.3, false, true, trailer, TENTACLE_NODES));
    for (const s of out) this.hang(j, s);
    return out;
  }

  /** A strand hanging straight down from its place on the rim. */
  private hang(j: Jelly, s: Strand) {
    const { w } = bellOf(j);
    for (let k = 0; k < s.nodes.length / 2; k++) {
      s.nodes[k * 2] = j.x + s.anchor * w * (s.arm ? 0.55 : 1);
      s.nodes[k * 2 + 1] = j.y + s.seg * k;
    }
  }

  step(dt: number) {
    this.time += dt;
    const unit = this.unit();
    this.spreadPulses(dt);
    for (const j of this.jellies) this.stepJelly(j, dt, unit);
    this.stepSnow(dt);
    // Nearer jellies draw last, over the far ones.
    this.jellies.sort((a, b) => a.depth - b.depth);
  }

  /** Each pulse spreads; a jelly it reaches starts: its bell shuts, it flashes, and it jets away
   *  from where the pulse began. */
  private spreadPulses(dt: number) {
    for (const p of this.pulses) {
      p.age += dt;
      const front = p.age * PULSE_SPEED;
      for (const j of this.jellies) {
        if (p.reached.has(j)) continue;
        const d = Math.hypot(j.x - p.x, j.y - j.shape.h * j.length * 0.5 - p.y);
        if (d > front || d > PULSE_REACH) continue;
        p.reached.add(j);
        j.phase = 0;
        j.glow = Math.max(j.glow, 0.7 * (1 - d / PULSE_REACH) + 0.3);
        j.jetUntil = this.time + 1.4;
        // Away from it, as near upright as that allows: a jelly swims bell first.
        j.jetTilt = clamp(Math.atan2(j.x - p.x, p.y - (j.y - j.shape.h * j.length * 0.5)), -JETTING_TILT, JETTING_TILT);
      }
    }
    if (this.pulses.some((p) => p.age * PULSE_SPEED > PULSE_REACH * 1.5)) this.pulses = this.pulses.filter((p) => p.age * PULSE_SPEED <= PULSE_REACH * 1.5);
  }

  private stepJelly(j: Jelly, dt: number, unit: number) {
    const { width: W, height: H, time, pointer } = this;
    if (time >= j.habitUntil) this.choose(j);
    const habit = HABITS[j.habit];
    j.depth += (habit.depth - j.depth) * Math.min(1, dt * 0.6);
    // Seen from the front, a jelly that comes near grows.
    const L = (j.length = unit * j.size * (0.8 + 0.3 * j.depth));
    j.glow = Math.max(0, j.glow - dt * 0.8);
    const jetting = time < j.jetUntil;

    // Where it is going: somewhere well away and on the way it is going, so it crosses the water in
    // long drifts.
    if (!j.goal || time > j.goalAt || Math.hypot(j.goal.x - j.x, j.goal.y - j.y) < L * 0.6) {
      j.goal = goalAhead(W, H, habit.band[0], habit.band[1], { x: j.x, y: j.y, heading: Math.atan2(j.vy, j.vx), reach: L * 3 });
      j.goalAt = time + rand(j.habit === "roam" ? 9 : 14, j.habit === "roam" ? 15 : 22);
    }
    const gx = j.goal.x - j.x;
    const gy = j.goal.y - j.y;

    // Lean toward it, a little: it swims up and across, and to go down it stops beating, but for a
    // soft beat to lean it across, and sinks. Startled, it leans away and jets.
    const below = gy > L * 0.5 && Math.abs(gx) < gy * 0.45;
    const most = j.habit === "rest" ? RESTING_TILT : MAX_TILT;
    const want = jetting ? j.jetTilt : clamp(Math.atan2(gx, -gy), -most, most) * (below ? 0.6 : 1);
    const lean = jetting ? 6 : 0.5;
    j.tilt += clamp(angleDiff(j.tilt, want), -lean * dt, lean * dt);

    // The beat: faster while it jets.
    const rate = j.shape.rate * habit.rate * (jetting ? 2.6 : 1);
    j.phase = (j.phase + rate * dt) % 1;
    const was = j.beat;
    j.beat = beatAt(j.phase);
    const closing = j.beat > was;
    // A beat lifts it, so one above where it is going beats less, and sinks between: it keeps to
    // its goal's height as it goes across.
    const push = jetting ? 2.8 : (below ? 0.15 : gy > 0 ? clamp(1 - gy / L, 0.2, 1) : 1) * habit.thrust;
    if (closing) {
      // A beat is a third of a bell-length of speed, given over the time the bell takes to close.
      const accel = (0.32 * L * push) / (0.3 / rate);
      j.vx += Math.sin(j.tilt) * accel * dt;
      j.vy -= Math.cos(j.tilt) * accel * dt;
    }
    // It sinks a little, more when it is going down, and the water slows it.
    j.vy += (below ? 22 : gy > L * 0.3 ? 16 : 5) * dt;
    j.vx -= j.vx * DRAG * dt;
    j.vy -= j.vy * DRAG * dt;

    // The pointer nudges it away: gently, from a little past its bell.
    const cy = j.y - j.shape.h * L * 0.5;
    if (pointer.active) {
      const dx = j.x - pointer.x;
      const dy = cy - pointer.y;
      const d = Math.hypot(dx, dy);
      const reach = j.shape.w * L + NUDGE;
      if (d < reach && d > 1e-3) {
        const k = (1 - d / reach) * 70 * dt;
        j.vx += (dx / d) * k;
        j.vy += (dy / d) * k;
      }
    }
    // Off another jelly, and back from the window's edges.
    for (const o of this.jellies) {
      if (o === j) continue;
      const dx = j.x - o.x;
      const dy = j.y - o.y;
      const d = Math.hypot(dx, dy);
      const room = (j.shape.w * L + o.shape.w * o.length) * 1.1;
      if (d < room && d > 1e-3) {
        j.vx += (dx / d) * (1 - d / room) * 40 * dt;
        j.vy += (dy / d) * (1 - d / room) * 40 * dt;
      }
    }
    const m = j.shape.w * L;
    if (j.x < m) j.vx += (m - j.x) * 2 * dt;
    if (j.x > W - m) j.vx -= (j.x - (W - m)) * 2 * dt;
    const top = j.shape.h * L * 1.3;
    if (j.y < top) j.vy += (top - j.y) * 2 * dt;
    if (j.y > H - L * 0.2) j.vy -= (j.y - (H - L * 0.2)) * 2 * dt;
    // And the current carries it, slowly: a jelly drifts as much as it swims.
    current(j.x, j.y, time, this.flow);
    j.x += (j.vx + this.flow.x * CURRENT) * dt;
    j.y += (j.vy + this.flow.y * CURRENT * 0.5) * dt;
    this.trail(j, dt);
  }

  /** The strands follow the rim. Each node keeps its length from the one before and eases toward
   *  where it would hang in still water: down from its root, a tentacle drawing in under the bell
   *  toward its tip, a wave running down it. The further down a node is, the slower it eases, so as
   *  the jelly swims its strands stream out behind it, and catch up as it drifts. */
  private trail(j: Jelly, dt: number) {
    const { w } = bellOf(j);
    const t = this.time;
    for (const [n, s] of j.strands.entries()) {
      const nodes = s.nodes;
      const count = nodes.length / 2;
      // A tentacle hangs from the rim, an arm from under its middle.
      const reach = s.arm ? 0.55 : 1;
      const rootX = j.x + s.anchor * w * reach;
      const rootY = j.y;
      nodes[0] = rootX;
      nodes[1] = rootY;
      // A fringe hangs nearly straight; a long tentacle draws in under the bell and waves wide.
      const fringe = j.shape.fringe && !s.arm && !s.trailer;
      const wave = w * (s.arm ? 0.12 : fringe ? 0.08 : 0.3);
      const gather = s.arm ? 0 : fringe ? 0.1 : 0.5;
      for (let k = 1; k < count; k++) {
        const along = k / (count - 1);
        const restX = rootX - s.anchor * w * reach * gather * along + wave * along * Math.sin(t * (s.arm ? 1.5 : 1.1) + n * 1.7 + s.phase - k * 0.55);
        const restY = rootY + s.seg * k;
        const ease = Math.min(1, dt * 3 * (1 - 0.7 * along));
        const px = nodes[(k - 1) * 2]!;
        const py = nodes[(k - 1) * 2 + 1]!;
        let x = nodes[k * 2]! + (restX - nodes[k * 2]!) * ease;
        let y = nodes[k * 2 + 1]! + (restY - nodes[k * 2 + 1]!) * ease;
        const d = Math.hypot(x - px, y - py) || 1;
        x = px + ((x - px) / d) * s.seg;
        y = py + ((y - py) / d) * s.seg;
        nodes[k * 2] = x;
        nodes[k * 2 + 1] = y;
      }
    }
  }

  private stepSnow(dt: number) {
    const { width: W, height: H, time: t, pointer } = this;
    for (const m of this.snow) {
      // It falls slowly, nearer specks faster, and wavers.
      const fall = 3 + 7 * m.z;
      m.vx -= m.vx * 1.5 * dt;
      m.vy -= m.vy * 1.5 * dt;
      // A beat pushes the water out from under the bell.
      for (const j of this.jellies) {
        if (j.phase >= 0.3) continue;
        const dx = m.x - j.x;
        const dy = m.y - j.y;
        const R = j.shape.w * j.length * 1.8;
        const d = Math.hypot(dx, dy);
        if (d < R && d > 1) {
          m.vx += (dx / d) * (1 - d / R) * 40 * dt;
          m.vy += (dy / d) * (1 - d / R) * 40 * dt;
        }
      }
      // A pulse passing pushes it on, and round.
      for (const p of this.pulses) {
        const dx = m.x - p.x;
        const dy = m.y - p.y;
        const d = Math.hypot(dx, dy);
        const off = Math.abs(d - p.age * PULSE_SPEED);
        if (off > 24 || d > PULSE_REACH || d < 1) continue;
        const k = (1 - off / 24) * (1 - d / PULSE_REACH) * 260 * dt;
        m.vx += ((dx - dy * 0.8) / d) * k;
        m.vy += ((dy + dx * 0.8) / d) * k;
      }
      if (pointer.active) {
        const dx = m.x - pointer.x;
        const dy = m.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < 80 && d > 1) {
          m.vx += (dx / d) * (1 - d / 80) * 60 * dt;
          m.vy += (dy / d) * (1 - d / 80) * 60 * dt;
        }
      }
      m.x += (m.vx + Math.sin(t * 0.4 + m.y * 0.02) * 3 * m.z) * dt;
      m.y += (m.vy + fall) * dt;
      if (m.y > H + 4) {
        m.y = -4;
        m.x = rand(0, W);
      }
      if (m.x < -4) m.x += W + 8;
      else if (m.x > W + 4) m.x -= W + 8;
    }
  }
}

