/**
 * Sand: a falling-sand world on a grid of grains, each half of a character cell (a half block: as
 * wide as the cell, half as tall). A few spouts above the window pour grains slowly, wandering from
 * side to side and changing colour as they go, so the dunes they build are banded. A grain falls
 * while the cell below it is empty, else slides down to one side; one that can do neither rests. So
 * the piles stand with sloping sides, one cell across for each cell down.
 *
 * Once the sand covers a sixth of the window it drains slowly through the floor, faster the more
 * there is, so it never fills up: the floor takes a grain from each column in turn, sweeping across
 * the window, and the column above sinks a cell, so the bands sink whole as new ones are laid on
 * top. The pointer resting over the window pours sand from it; moving, it sprinkles a few grains. A
 * click knocks the grains near it up and outward, and they fall back.
 *
 * Only grains that may move are looked at: each update works through the grains in the air or on a
 * slope (bottom row first, so each sees what the ones below did), and a grain that moves wakes the
 * three above where it was. A grain that moves takes the sand stacked on it down with it, so a
 * column over a gap drops whole, rather than the gap climbing it a row at a time.
 */
import type { Sim } from "../scene";
import { clamp, rand, randInt } from "../random";

/** A grain's size in a window: half of a character cell, whose width is from the window's
 *  shorter side. */
export function grainOf(width: number, height: number) {
  const cw = clamp(Math.round(Math.min(width, height) / 110), 7, 13);
  return { gw: cw, gh: Math.round(cw * 1.45) / 2 };
}

/** Grain updates a second: a grain in the air falls one grain's height each. */
export const UPDATES = 45;
/** Shades a grain of one colour may be, so the sand has a grain to it. */
export const SHADES = 4;
/** The palette's colours (palette.ts), and the steps from each to the next round its cycle. */
export const KEYS = 6;
const BETWEEN = 8;
export const HUES = KEYS * BETWEEN;
/** A grain's code: 0 is empty; 1 + hue × SHADES + shade a grain. */
export const CODES = HUES * SHADES;
/** The sand drains once it covers this share of the window, as fast as the spouts pour once it
 *  covers `DRAIN_FULL`, and faster beyond. */
export const DRAIN_FROM = 0.17;
export const DRAIN_FULL = 0.25;
/** Grains a second each spout pours. */
export const POUR = 30;
/** Grains a second the pointer pours while it rests; how long it must rest, and how far it may
 *  wander and still be resting (a hand on a mouse is never quite still). */
export const POINTER_POUR = 36;
const REST = 0.25;
const STILL = 10;
/** A click's reach, in grains across; how fast it throws them (px/s), and how hard they fall
 *  back (px/s²). */
export const BURST_REACH = 9;
const THROW = 300;
const GRAVITY = 900;
/** The most grains in the air at once from clicks. */
export const MOST_FLYING = 1600;

export interface Spout {
  /** Where it pours (px), wandering round `home`. */
  x: number;
  home: number;
  reach: number;
  phase: number;
  speed: number;
  /** Pouring now, and until when it pours or rests. */
  on: boolean;
  until: number;
  /** Its colour, a place round the palette's cycle (0 … HUES), and the colour it is going to. */
  hue: number;
  toward: number;
  holdUntil: number;
  owed: number;
}

/** A grain thrown by a click, in the air until it lands. */
export interface Flying {
  x: number;
  y: number;
  vx: number;
  vy: number;
  code: number;
  /** The last empty cell it passed through: where it comes to rest when it hits the sand. */
  free: number;
}

/** The code of a grain of `hue` (any number: taken round the cycle) and a random shade. */
export const codeOf = (hue: number) => 1 + ((((Math.floor(hue) % HUES) + HUES) % HUES) * SHADES) + randInt(0, SHADES - 1);
/** The place round the cycle of a grain's code. */
export const hueOfCode = (code: number) => Math.floor((code - 1) / SHADES);

export class Sand implements Sim {
  width = 0;
  height = 0;
  gw = 8;
  gh = 6;
  cols = 0;
  rows = 0;
  /** Each cell's grain: 0 empty, else its code. */
  grain = new Uint8Array(0);
  /** Grains in the grid now. */
  count = 0;
  spouts: Spout[] = [];
  flying: Flying[] = [];
  /** Each click: where, and when, for its puff of dust. */
  bursts: { x: number; y: number; at: number }[] = [];
  readonly pointer = { x: 0, y: 0, active: false };
  /** Where the pointer came to rest, how long it has rested, its colour, and what it owes of a pour or a sprinkle. */
  private restAt = { x: 0, y: 0 };
  private rested = 0;
  private pointerHue = rand(0, HUES);
  private poured = 0;
  private sprinkled = 0;
  /** Grains drained through the floor so far, and the column the floor takes from next. */
  drained = 0;
  private drainAt = 0;
  time = 0;
  private acc = 0;
  /** The grains that may move, in no order; and whether each cell is among them. */
  private active = new Int32Array(0);
  private activeCount = 0;
  private spare = new Int32Array(0);
  private isActive = new Uint8Array(0);
  /** Updates so far, and the update a grain last arrived in each cell: it moves once an update. */
  private updates = 0;
  private arrived = new Uint32Array(0);

  resize(width: number, height: number) {
    const { gw, gh } = grainOf(width, height);
    const cols = Math.ceil(width / gw);
    const rows = Math.ceil(height / gh);
    const first = !this.cols;
    const old = { cols: this.cols, rows: this.rows, grain: this.grain, width: this.width };
    this.width = width;
    this.height = height;
    this.gw = gw;
    this.gh = gh;
    if (cols === this.cols && rows === this.rows) {
      this.laySpouts(old.width);
      return;
    }
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.grain = new Uint8Array(n);
    this.active = new Int32Array(n);
    this.spare = new Int32Array(n);
    this.isActive = new Uint8Array(n);
    this.arrived = new Uint32Array(n);
    this.activeCount = 0;
    this.laySpouts(first ? 0 : old.width);
    if (first) {
      this.lay();
      return;
    }
    // The picture as it was, fitted to the new window: each cell takes the grain of the old cell at
    // the same share of the width, and as far up from the floor as a share of the height.
    for (let r = 0; r < rows; r++) {
      const or = old.rows - 1 - Math.floor(((rows - 1 - r) * old.rows) / rows);
      for (let c = 0; c < cols; c++) {
        const oc = Math.floor((c * old.cols) / cols);
        this.grain[r * cols + c] = old.grain[or * old.cols + oc]!;
      }
    }
    this.flying = [];
    this.count = 0;
    for (let i = 0; i < n; i++) {
      if (!this.grain[i]) continue;
      this.count++;
      this.wake(i);
    }
  }

  /** The spouts, spread along the top, one for each 480 px or so; kept where they were (at the same
   *  share of the width) when the window changes. */
  private laySpouts(oldWidth: number) {
    const n = clamp(Math.round(this.width / 480), 2, 5);
    if (oldWidth && this.spouts.length === n) {
      for (const s of this.spouts) {
        const k = this.width / oldWidth;
        Object.assign(s, { x: s.x * k, home: s.home * k, reach: s.reach * k });
      }
      return;
    }
    this.spouts = Array.from({ length: n }, (_, k) => {
      const hue = randInt(0, KEYS - 1) * BETWEEN;
      const home = this.width * ((k + 0.5) / n + rand(-0.08, 0.08) / n);
      return {
        x: home, home, reach: (this.width / n) * rand(0.45, 0.75), phase: rand(0, Math.PI * 2), speed: rand(0.035, 0.07),
        on: k < 2 || Math.random() < 0.6, until: rand(10, 50), hue, toward: hue, holdUntil: rand(4, 14), owed: 0,
      };
    });
    for (const s of this.spouts) s.x = this.spoutX(s);
  }

  private spoutX(s: Spout) {
    const t = this.time * s.speed + s.phase;
    return clamp(s.home + s.reach * (0.75 * Math.sin(t) + 0.25 * Math.sin(t * 2.7 + 1.3)), this.gw, this.width - this.gw);
  }

  /** The first picture: dunes along the floor in banded colours, laid as if poured for a while, and
   *  each pouring spout's stream already falling onto them. */
  private lay() {
    const { cols, rows } = this;
    const heights = new Float32Array(cols).fill(rows * rand(0.07, 0.1));
    const hills = [
      ...this.spouts.filter((s) => s.on).map((s) => ({ c: s.x / this.gw, h: rows * rand(0.1, 0.16), w: cols * rand(0.06, 0.1) })),
      ...Array.from({ length: randInt(2, 4) }, () => ({ c: rand(0, cols), h: rows * rand(0.05, 0.12), w: cols * rand(0.08, 0.18) })),
    ];
    for (let c = 0; c < cols; c++) for (const h of hills) heights[c] = heights[c]! + h.h * Math.exp(-(((c - h.c) / h.w) ** 2));
    // No side steeper than a grain can stand at: one cell up for each across.
    for (let c = 1; c < cols; c++) heights[c] = Math.min(heights[c]!, heights[c - 1]! + 1);
    for (let c = cols - 2; c >= 0; c--) heights[c] = Math.min(heights[c]!, heights[c + 1]! + 1);
    let mean = 0;
    for (let c = 0; c < cols; c++) mean += heights[c]! / cols;
    // Bands laid down over time: older below, each following the dunes' shape part of the way.
    const band = rows * rand(0.035, 0.05);
    const start = rand(0, KEYS);
    for (let c = 0; c < cols; c++) {
      const h = Math.min(rows * 0.42, Math.round(heights[c]!));
      const wave = Math.sin(c * 0.11 + start) * 0.8;
      for (let k = 0; k < h; k++) {
        const laid = (k - (heights[c]! - mean) * 0.55 + wave) / band;
        const b = Math.floor(laid);
        const blend = clamp((laid - b - 0.72) / 0.28, 0, 1);
        // Each band the palette's next colour round its cycle, older bands further back.
        const hue = (Math.floor(start) + b) * BETWEEN + BETWEEN * blend;
        this.grain[(rows - 1 - k) * cols + c] = codeOf(hue);
        this.count++;
      }
    }
    // The streams in the air.
    for (const s of this.spouts) {
      if (!s.on) continue;
      const c0 = clamp(Math.round(s.x / this.gw), 0, cols - 1);
      for (let r = 0; r < rows; r += Math.max(1, Math.round(UPDATES / POUR))) {
        const c = clamp(c0 + randInt(-1, 1), 0, cols - 1);
        const i = r * cols + c;
        if (this.grain[i] || this.grain[i + cols]) break;
        this.grain[i] = codeOf(s.hue);
        this.count++;
        this.wake(i);
      }
    }
  }

  /** The cell at a point, or -1 off the grid. */
  cellAt(x: number, y: number) {
    const c = Math.floor(x / this.gw);
    const r = Math.floor(y / this.gh);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  /** `i` may move: look at it next update. */
  private wake(i: number) {
    if (i < 0 || i >= this.grain.length || !this.grain[i] || this.isActive[i]) return;
    this.isActive[i] = 1;
    this.active[this.activeCount++] = i;
  }

  /** The grains above `i` may move now that it is empty. */
  private wakeAbove(i: number) {
    if (i < this.cols) return;
    const c = i % this.cols;
    this.wake(i - this.cols);
    if (c > 0) this.wake(i - this.cols - 1);
    if (c < this.cols - 1) this.wake(i - this.cols + 1);
  }

  /** Put a grain of `code` at `i` if it is empty; true if it was. */
  place(i: number, code: number) {
    if (i < 0 || this.grain[i]) return false;
    this.grain[i] = code;
    this.count++;
    this.wake(i);
    return true;
  }

  /** Take the grain from `i`; its code, or 0. */
  private take(i: number) {
    const code = this.grain[i]!;
    if (!code) return 0;
    this.grain[i] = 0;
    this.count--;
    this.wakeAbove(i);
    return code;
  }

  /** One update: every grain that may move, bottom row first, falls, or slides down to a side, or rests. */
  update() {
    const { cols, rows, grain, arrived } = this;
    const tick = ++this.updates;
    const list = this.active.subarray(0, this.activeCount).sort();
    // The next update's list is built in the spare buffer; this one's is read from a copy of its end.
    const now = this.spare;
    const n = list.length;
    now.set(list);
    this.activeCount = 0;
    for (let j = 0; j < n; j++) this.isActive[now[j]!] = 0;
    for (let j = n - 1; j >= 0; j--) {
      const i = now[j]!;
      const code = grain[i]!;
      if (!code || arrived[i] === tick) continue;
      if (i >= (rows - 1) * cols) continue;
      const below = i + cols;
      let to = -1;
      if (!grain[below]) to = below;
      else {
        const c = i - Math.floor(i / cols) * cols;
        const side = Math.random() < 0.5 ? -1 : 1;
        if (c + side >= 0 && c + side < cols && !grain[below + side]) to = below + side;
        else if (c - side >= 0 && c - side < cols && !grain[below - side]) to = below - side;
      }
      if (to < 0) continue;
      grain[to] = code;
      grain[i] = 0;
      arrived[to] = tick;
      this.wake(to);
      // The sand stacked on it drops into the cell it left.
      let top = i;
      for (; top >= cols && grain[top - cols] && arrived[top - cols] !== tick; top -= cols) {
        grain[top] = grain[top - cols]!;
        grain[top - cols] = 0;
        arrived[top] = tick;
        this.wake(top);
      }
      this.wakeAbove(top);
    }
  }

  point(x: number, y: number, active: boolean) {
    const p = this.pointer;
    const moved = Math.hypot(x - p.x, y - p.y);
    if (!active || !p.active || Math.hypot(x - this.restAt.x, y - this.restAt.y) > STILL) {
      this.rested = 0;
      this.restAt = { x, y };
    }
    if (active && p.active && this.rested <= REST) this.sprinkled += moved / (this.gw * 1.6);
    Object.assign(p, { x, y, active });
  }

  /** A click: the grains near it are thrown up and outward, and fall back; where there are few, a
   *  puff of new ones. */
  splash(x: number, y: number) {
    if (!this.cols) return;
    const reach = BURST_REACH * this.gw;
    const c0 = Math.max(0, Math.floor((x - reach) / this.gw));
    const c1 = Math.min(this.cols - 1, Math.floor((x + reach) / this.gw));
    const r0 = Math.max(0, Math.floor((y - reach) / this.gh));
    const r1 = Math.min(this.rows - 1, Math.floor((y + reach) / this.gh));
    let thrown = 0;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * this.cols + c;
        if (!this.grain[i] || this.flying.length >= MOST_FLYING) continue;
        const [gx, gy] = [(c + 0.5) * this.gw, (r + 0.5) * this.gh];
        const d = Math.hypot(gx - x, gy - y);
        if (d > reach) continue;
        this.throw(gx, gy, (gx - x) / (d || 1), d ? (gy - y) / d : -1, 1 - d / reach, this.take(i));
        thrown++;
      }
    }
    for (let k = thrown; k < 30 && this.flying.length < MOST_FLYING; k++) {
      const a = rand(0, Math.PI * 2);
      this.throw(x, y, Math.cos(a), Math.sin(a), rand(0.3, 0.9), codeOf(this.pointerHue));
    }
    this.bursts.push({ x, y, at: this.time });
    if (this.bursts.length > 4) this.bursts.shift();
  }

  /** Throw a grain from (x, y) along (dx, dy), harder the nearer it was to the click (`near`, 0 … 1):
   *  up and outward, as the sand under it resists being driven down. */
  private throw(x: number, y: number, dx: number, dy: number, near: number, code: number) {
    const speed = THROW * (0.25 + 0.75 * Math.sqrt(near)) * rand(0.75, 1.15);
    this.flying.push({ x, y, vx: dx * speed, vy: (dy > 0 ? dy * 0.3 : dy) * speed - THROW * 0.7 * near - rand(30, 90), code, free: -1 });
  }

  step(dt: number) {
    if (!this.cols) return;
    this.time += dt;
    this.pour(dt);
    this.fly(dt);
    this.drain(dt);
    this.acc += dt;
    while (this.acc >= 1 / UPDATES) {
      this.acc -= 1 / UPDATES;
      this.update();
    }
  }

  /** The spouts pour, wander and change colour; the pointer pours where it rests. */
  private pour(dt: number) {
    for (const s of this.spouts) {
      s.x = this.spoutX(s);
      if (this.time > s.until) {
        s.on = !s.on;
        s.until = this.time + (s.on ? rand(25, 70) : rand(6, 18));
      }
      // Its colour holds a while, then moves on round the cycle to the palette's next, now and then
      // the one after.
      if (s.hue === s.toward && this.time > s.holdUntil) s.toward = s.hue + (Math.random() < 0.75 ? 1 : 2) * BETWEEN;
      else if (s.hue !== s.toward) {
        s.hue = Math.min(s.toward, s.hue + dt * BETWEEN * 0.35);
        if (s.hue === s.toward) {
          s.hue %= HUES;
          s.toward = s.hue;
          s.holdUntil = this.time + rand(8, 20);
        }
      }
      if (!s.on) continue;
      s.owed += POUR * dt;
      for (; s.owed >= 1; s.owed--) this.place(this.cellAt(s.x + randInt(-1, 1) * this.gw, 0), codeOf(s.hue));
    }
    const p = this.pointer;
    this.pointerHue = (this.pointerHue + dt * 0.6) % HUES;
    if (!p.active) {
      this.poured = this.sprinkled = 0;
      return;
    }
    this.rested += dt;
    if (this.rested > REST) this.poured += POINTER_POUR * dt;
    const drops = Math.floor(this.poured) + Math.floor(this.sprinkled);
    this.poured -= Math.floor(this.poured);
    this.sprinkled -= Math.floor(this.sprinkled);
    for (let k = 0; k < drops; k++) {
      // Into the nearest empty cell at the pointer or a little above it.
      let i = this.cellAt(p.x + randInt(-1, 1) * this.gw, p.y);
      for (let up = 0; up < 6 && i >= 0 && this.grain[i]; up++) i = i >= this.cols ? i - this.cols : -1;
      this.place(i, codeOf(this.pointerHue));
    }
  }

  /** The thrown grains fly: up out of the sand, through it, then down; each comes to rest where it
   *  falls onto the sand or the floor, in the last empty cell it passed through. */
  private fly(dt: number) {
    const keep: Flying[] = [];
    for (const f of this.flying) {
      f.vy += GRAVITY * dt;
      f.vx *= 1 - 0.5 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < 0) [f.x, f.vx] = [0, -f.vx * 0.4];
      if (f.x > this.width - 1) [f.x, f.vx] = [this.width - 1, -f.vx * 0.4];
      if (f.y < 0) {
        keep.push(f);
        continue;
      }
      const i = this.cellAt(f.x, Math.min(f.y, this.height - 1));
      const floor = f.y >= (this.rows - 1) * this.gh;
      const empty = i >= 0 && !this.grain[i];
      if (empty) f.free = i;
      if ((f.vy < 0 || empty) && !floor) {
        keep.push(f);
        continue;
      }
      // Landed: in the last empty cell it passed through, else the first empty one above it; and
      // down onto the sand under that, not hanging over a column still sinking into the crater.
      let at = f.free >= 0 && !this.grain[f.free] ? f.free : i;
      while (at >= 0 && this.grain[at]) at = at >= this.cols ? at - this.cols : -1;
      while (at >= 0 && at + this.cols < this.grain.length && !this.grain[at + this.cols]) at += this.cols;
      this.place(at, f.code);
    }
    this.flying = keep;
  }

  /** Once the sand covers more than `DRAIN_FROM` of the window, the floor takes a grain from each
   *  column in turn, sweeping across, the faster the more sand there is; each column sinks a cell. */
  private drain(dt: number) {
    const fill = this.count / (this.cols * this.rows);
    const rate = POUR * this.spouts.length * 1.6 * Math.max(0, (fill - DRAIN_FROM) / (DRAIN_FULL - DRAIN_FROM));
    const from = Math.floor(this.drainAt);
    this.drainAt += rate * dt;
    for (let c = from + 1; c <= Math.floor(this.drainAt); c++) this.sink(c % this.cols);
    this.drainAt %= this.cols;
  }

  /** Column `c` loses its bottom grain to the floor, and the sand stacked on it sinks a cell. */
  sink(c: number) {
    const { cols, grain } = this;
    let i = (this.rows - 1) * cols + c;
    if (!grain[i]) return;
    this.count--;
    this.drained++;
    for (; i >= cols && grain[i - cols]; i -= cols) {
      grain[i] = grain[i - cols]!;
      if (this.isActive[i - cols]) this.wake(i);
    }
    grain[i] = 0;
    this.wakeAbove(i);
    this.wake(i + cols);
  }
}
