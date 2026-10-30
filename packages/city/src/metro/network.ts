/**
 * Metro's network at work, apart from any canvas: trains running each line end to end and back,
 * easing into each station, standing there a moment and easing out again.
 *
 * The pointer resting near a line lights that line up, and its trains hurry a little (faster
 * between stations, a shorter stand at each) for as long as it rests there. A click sends a new
 * train onto the line nearest it, from the nearest point of the line; a line holds so many trains at
 * once, and when a new one comes, its oldest leaves.
 *
 * The map is made once (map.ts) and laid out again on each window, with five to eight of its lines
 * by the window's size; a train keeps its line and how far along it is, so a resize keeps the
 * network and its traffic.
 */
import type { Sim } from "../scene";
import { cellSize } from "../cells";
import { clamp, rand, seeded } from "../util";
import { latticeOf, layoutOf, mapOf, MAX_LINES, nearestOn, type Layout, type MapSpec } from "./map";

export interface Train {
  id: number;
  line: number;
  /** How far along its line, in px, and which way it goes. */
  s: number;
  dir: 1 | -1;
  v: number;
  /** Seconds left standing at a station. */
  dwell: number;
  born: number;
  /** When it began to leave the map (a newer train came), or null. */
  leaving: number | null;
}

/** A click's mark where a new train comes onto the map. */
export interface Arrival { x: number; y: number; line: number; s: number; age: number }

/** A line holds at most this many trains: one more, and its oldest leaves. */
export const MAX_PER_LINE = 5;
/** How fast a train runs between stations (px/s), how quickly it speeds up and slows (px/s²), how
 *  long it stands at a station (s). */
const SPEED = 72;
const ACCEL = 46;
const DWELL: [number, number] = [1.2, 2.2];
/** A focused line's trains: this much faster, quicker to speed up and slow, and standing this much
 *  as long. */
export const HURRY = 1.5;
const HURRY_ACCEL = 1.7;
const HURRY_DWELL = 0.45;
/** How near the pointer a line has to be for it to light up (px). */
export const FOCUS_REACH = 140;
/** How long a train takes to leave, fading. */
export const LEAVE = 0.9;

/** How many lines a window shows: five on a small one, eight on a big one. */
export const linesFor = (width: number, height: number) => clamp(Math.round(3 + (width * height) / 450_000), 5, MAX_LINES);

export class Network implements Sim {
  width = 0;
  height = 0;
  time = 0;
  spec: MapSpec | null = null;
  layout!: Layout;
  /** How many lines are shown, and the cells they are laid out in. */
  lines = 0;
  cw = 8;
  ch = 12;
  trains: Train[] = [];
  arrivals: Arrival[] = [];
  /** The line the pointer rests by, or -1; and how lit up each line is, 0 to 1. */
  focus = -1;
  glow = new Float32Array(MAX_LINES);
  pointer = { x: 0, y: 0, active: false };
  /** Bumped each layout, for the drawing to repaint the map. */
  laidOut = 0;
  private stocked = new Uint8Array(MAX_LINES);
  private nextId = 1;

  resize(width: number, height: number) {
    const was = this.layout?.routes.map((r) => r.length);
    this.width = width;
    this.height = height;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    const cols = Math.ceil(width / this.cw);
    const rows = Math.ceil(height / this.ch);
    if (!this.spec) {
      const { lx, ly } = latticeOf(cols, rows);
      this.spec = mapOf(lx, ly, seeded(Math.floor(Math.random() * 2 ** 31)));
    }
    this.lines = linesFor(width, height);
    this.layout = layoutOf(this.spec, this.lines, cols, rows, this.cw, this.ch);
    this.laidOut++;
    // Each train as far along its line as it was, as a share of it; one at a station, at it.
    for (const t of this.trains) {
      const route = this.layout.routes[t.line];
      if (!route || !was?.[t.line]) continue;
      t.s = (t.s / was[t.line]!) * route.length;
      if (t.dwell > 0) {
        const stop = route.stops.reduce((a, b) => (Math.abs(b.s - t.s) < Math.abs(a.s - t.s) ? b : a));
        t.s = stop.s;
      }
    }
    for (let line = 0; line < this.lines; line++) if (!this.stocked[line]) this.stock(line);
    if (this.focus >= this.lines) this.focus = -1;
  }

  /** A line's first trains: one to each so many px of it, spread along it, some at a station. */
  private stock(line: number) {
    this.stocked[line] = 1;
    const route = this.layout.routes[line]!;
    const n = clamp(Math.round(route.length / 560), 1, 3);
    for (let k = 0; k < n; k++) {
      const s = ((k + rand(0.2, 0.8)) / n) * route.length;
      const stop = route.stops.find((st) => Math.abs(st.s - s) < 30);
      this.trains.push({ id: this.nextId++, line, s: stop ? stop.s : s, dir: Math.random() < 0.5 ? 1 : -1, v: stop ? 0 : SPEED * 0.8, dwell: stop ? rand(0, DWELL[1]) : 0, born: this.time - 100 + k, leaving: null });
    }
  }

  /** The line nearest (x, y), and how far along it and away it is. */
  nearestLine(x: number, y: number) {
    let best = { line: -1, s: 0, d: Infinity };
    for (let line = 0; line < this.lines; line++) {
      const near = nearestOn(this.layout.routes[line]!, x, y);
      if (near.d < best.d) best = { line, ...near };
    }
    return best;
  }

  /** The pointer over the map, or gone from it: the line it rests by lights up. */
  point(x: number, y: number, active: boolean) {
    this.pointer = { x, y, active };
    if (!active) {
      this.focus = -1;
      return;
    }
    const near = this.nearestLine(x, y);
    this.focus = near.d <= FOCUS_REACH ? near.line : -1;
  }

  /** A click: a new train onto the line nearest it, from the point of the line nearest it, going
   *  the longer way; the line's oldest leaves if it has its fill. */
  splash(x: number, y: number) {
    const near = this.nearestLine(x, y);
    if (near.line < 0) return;
    const route = this.layout.routes[near.line]!;
    const running = this.trains.filter((t) => t.line === near.line && t.leaving === null);
    if (running.length >= MAX_PER_LINE) running.reduce((a, b) => (b.born < a.born ? b : a)).leaving = this.time;
    // Clicked fast, the leaving pile up: two at most are seen going; the rest are gone at once.
    const leaving = this.trains.filter((t) => t.line === near.line && t.leaving !== null).sort((a, b) => b.leaving! - a.leaving!);
    if (leaving.length > 2) {
      const gone = new Set(leaving.slice(2));
      this.trains = this.trains.filter((t) => !gone.has(t));
    }
    this.trains.push({ id: this.nextId++, line: near.line, s: near.s, dir: near.s < route.length / 2 ? 1 : -1, v: 0, dwell: 0.35, born: this.time, leaving: null });
    this.arrivals.push({ x, y, line: near.line, s: near.s, age: 0 });
    if (this.arrivals.length > 6) this.arrivals.shift();
  }

  step(dt: number) {
    this.time += dt;
    for (let line = 0; line < MAX_LINES; line++) this.glow[line] = clamp(this.glow[line]! + (line === this.focus ? dt * 4 : -dt * 2.5), 0, 1);
    for (const t of this.trains) if (t.line < this.lines) this.run(t, dt);
    if (this.trains.some((t) => t.leaving !== null && this.time - t.leaving > LEAVE)) this.trains = this.trains.filter((t) => t.leaving === null || this.time - t.leaving <= LEAVE);
    for (const a of this.arrivals) a.age += dt;
    if (this.arrivals.some((a) => a.age > 1.2)) this.arrivals = this.arrivals.filter((a) => a.age <= 1.2);
  }

  /** A train on: standing at a station, or easing on to the next one its way, and turning back at
   *  the end of the line. */
  private run(t: Train, dt: number) {
    const route = this.layout.routes[t.line]!;
    const hurry = t.line === this.focus;
    if (t.dwell > 0) {
      t.dwell -= dt * (hurry ? 1 / HURRY_DWELL : 1);
      return;
    }
    // The next station its way.
    let next = t.dir > 0 ? route.length : 0;
    for (const st of route.stops) {
      if (t.dir > 0 && st.s > t.s + 0.5) { next = st.s; break; }
      if (t.dir < 0 && st.s < t.s - 0.5) next = st.s;
    }
    const left = Math.abs(next - t.s);
    const top = SPEED * (hurry ? HURRY : 1);
    const accel = ACCEL * (hurry ? HURRY_ACCEL : 1);
    const want = Math.min(top, Math.sqrt(2 * accel * left) + 4);
    t.v = clamp(t.v + clamp(want - t.v, -accel * 2 * dt, accel * dt), 0, top);
    const move = t.v * dt;
    if (move >= left) {
      t.s = next;
      t.v = 0;
      t.dwell = rand(DWELL[0], DWELL[1]);
      if (next <= 0.5 || next >= route.length - 0.5) {
        t.dir = t.dir > 0 ? -1 : 1;
        t.dwell += 1.5;
      }
      return;
    }
    t.s += move * t.dir;
  }
}
