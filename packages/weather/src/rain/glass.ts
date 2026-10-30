/**
 * Rain on Glass: a window on a rainy night (or a grey afternoon), seen from inside. Rain beads on
 * the glass, one bead to a cell of the grid (behind it, cars' lights pass down the street): each new drop that lands on a bead swells it, and two
 * swollen neighbours run together. A bead grown too heavy runs down in a wandering streak, sticking
 * and slipping, taking up the beads in its way, leaving a trail of small ones and a clear line
 * through the condensation behind it; it stops where it has left too much of itself behind, and
 * beads again. The glass is fogged with condensation, thicker low and at the sides.
 *
 * The pointer is a finger on the glass: resting or moving, it wipes a clear path through the
 * condensation, which fogs over again in a quarter of a minute. A click is a tap on the glass: the
 * drops near it shiver, then shake loose and run.
 */
import { cellSize } from "../cells";
import type { Sim } from "../scene";
import { clamp, hash3, noise2, rand, smooth } from "../util";

/** A drop running down the glass. Sizes and places are in CSS pixels. */
export interface Runner {
  id: number;
  x: number;
  y: number;
  /** Its radius. */
  r: number;
  /** How fast it goes down, and sideways; when it next chooses which way to wander. */
  vy: number;
  vx: number;
  turnAt: number;
  /** Seconds it is held where it is (it sticks, then slips). */
  stuck: number;
  /** Seconds it shivers in place after a tap, before it runs. */
  shiver: number;
  /** The cells it has run down through, its own first: its wet streak. */
  path: Int32Array;
  pathN: number;
}

/** A car down in the street, its lights blurred behind the glass: coming nearer (headlights) or
 *  going away (tail lights), `z` its way along from near the glass (0) to the street's far end (1). */
export interface Car {
  z: number;
  coming: boolean;
  /** Its lane: how far off the street's middle near the glass, as a share of the width. */
  lane: number;
  speed: number;
}

/** A tap on the glass, and how long ago. */
export interface Tap {
  x: number;
  y: number;
  age: number;
}

/** Rain landing, per second per px² of glass. */
const RAIN = 52 / (1440 * 900);
const NEIGHBOURS = [-1, 1, -1, 1];
/** A bead runs once its radius passes this (px, on 8 px cells), give or take a little by its cell;
 *  a runner stops when it has shrunk under `STOP`. */
const RUN = 3.3;
const STOP = 1.5;
/** How much of its radius a runner leaves on the glass, per px it runs. */
const FILM = 0.0016;
/** The share of the cells a runner leaves that get a bead of its water. */
const TRAIL = 0.32;
/** Seconds the condensation takes to fog a clear cell over again (give or take a quarter). */
export const REFOG = 16;
/** How far round the pointer it wipes, across and down (px, on 8 px cells). */
export const WIPE = { x: 26, y: 22 };
/** How far a tap shakes drops loose, how many at most, and how long its ring shows. */
export const TAP = { reach: 120, loose: 36, life: 0.8 };
/** How much of the condensation a runner leaves on its line: it clears a streak, but not as clean
 *  as a finger does. */
const TRAIL_FOG = 0.45;
/** Cells of wet streak a runner keeps behind it. */
export const STREAK = 8;

export class Glass implements Sim {
  width = 0;
  height = 0;
  cw = 8;
  ch = 12;
  cols = 0;
  rows = 0;
  time = 0;
  /** Each cell's condensation, 0 clear to 1 thick, and how thick it fogs back to. */
  fog = new Float32Array(0);
  fogBase = new Float32Array(0);
  /** Each cell's bead of water: its radius in px, 0 for none. */
  bead = new Float32Array(0);
  runners: Runner[] = [];
  taps: Tap[] = [];
  cars: Car[] = [];
  private carAt = 0;
  pointer = { x: 0, y: 0, active: false };
  /** Where the finger wiped last, so a quick stroke wipes all the way along. */
  private wiped: { x: number; y: number } | null = null;
  /** The cells fogging over again: the only cells a step changes the condensation of. */
  private clearing = new Int32Array(0);
  private clearingN = 0;
  private isClearing = new Uint8Array(0);
  private nextId = 1;
  private rainOwed = 0;

  /** Drop sizes go with the cells: 1 on 8 px cells. */
  get scale() {
    return this.cw / 8;
  }

  /** How many drops may run at once: more on a bigger window, a few more after a tap. */
  get runCap() {
    return clamp(Math.round((this.width * this.height) / 16000), 30, 150);
  }

  resize(width: number, height: number) {
    const first = this.width === 0;
    const was = { width: this.width, height: this.height, cw: this.cw, ch: this.ch, cols: this.cols, rows: this.rows, fog: this.fog, bead: this.bead, scale: this.scale };
    this.width = width;
    this.height = height;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    const n = this.cols * this.rows;
    this.fog = new Float32Array(n);
    this.fogBase = new Float32Array(n);
    this.bead = new Float32Array(n);
    this.clearing = new Int32Array(n);
    this.isClearing = new Uint8Array(n);
    this.clearingN = 0;
    this.wiped = null;
    for (let i = 0; i < n; i++) this.fogBase[i] = this.baseOf(i % this.cols, Math.floor(i / this.cols));
    if (first) {
      this.stock();
      return;
    }
    // The same glass in the new window: the condensation where it was, each bead and each runner at
    // its place on the glass, as big for the new cells as it was for the old.
    const sx = width / was.width;
    const sy = height / was.height;
    const k = this.scale / was.scale;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const oc = clamp(Math.floor(((c + 0.5) * this.cw) / sx / was.cw), 0, was.cols - 1);
        const or = clamp(Math.floor(((r + 0.5) * this.ch) / sy / was.ch), 0, was.rows - 1);
        const i = r * this.cols + c;
        this.fog[i] = was.fog[or * was.cols + oc]!;
        if (this.fog[i]! < this.fogBase[i]!) this.markClearing(i);
      }
    }
    for (let i = 0; i < was.bead.length; i++) {
      if (!was.bead[i]) continue;
      const j = this.cellAt(((i % was.cols) + 0.5) * was.cw * sx, (Math.floor(i / was.cols) + 0.5) * was.ch * sy);
      if (j >= 0) this.bead[j] = Math.hypot(this.bead[j]!, was.bead[i]! * k);
    }
    for (const d of this.runners) {
      d.x *= sx;
      d.y *= sy;
      d.r *= k;
      d.pathN = 0;
    }
    for (const t of this.taps) {
      t.x *= sx;
      t.y *= sy;
    }
  }

  /** The cars the street holds at once: more on a wider window. */
  get carCap() {
    return clamp(Math.round(this.width / 480), 2, 6);
  }

  private car(z?: number): Car {
    const coming = Math.random() < 0.45;
    return { z: z ?? (coming ? 1 : 0), coming, lane: coming ? rand(0.05, 0.25) : -rand(0.05, 0.3), speed: rand(0.06, 0.11) };
  }

  /** The cars move along the street; now and then another turns into it. */
  private drive(dt: number) {
    for (const c of this.cars) c.z += (c.coming ? -1 : 1) * c.speed * dt * (0.4 + 0.6 * (1 - c.z));
    this.cars = this.cars.filter((c) => c.z >= 0 && c.z <= 1);
    if (this.time >= this.carAt && this.cars.length < this.carCap) {
      this.cars.push(this.car());
      this.carAt = this.time + rand(2.5, 7);
    }
  }

  /** How thick a cell's condensation settles: thicker toward the bottom of the pane and its sides,
   *  in patches. */
  private baseOf(c: number, r: number) {
    const x = (c + 0.5) / this.cols;
    const y = (r + 0.5) / this.rows;
    const side = 1 - smooth(0, 0.14, Math.min(x, 1 - x));
    // Patches a fifth of the window across, some thin, some thick.
    const patch = 0.6 * noise2(x * 5, y * 4, 11) + 0.4 * noise2(x * 11, y * 9, 12);
    return clamp(0.12 + 0.75 * patch + 0.32 * smooth(0.55, 1, y) + 0.2 * side + 0.1 * (hash3(c, r, 11) - 0.5), 0.15, 1);
  }

  /** The glass as it is a while into the rain: fogged, beaded, some drops running and the streaks
   *  of others still clearing. */
  private stock() {
    const { cols, rows, cw, ch, width: W, height: H } = this;
    for (let k = this.carCap; k > 0; k--) this.cars.push(this.car(rand(0.1, 0.9)));
    const n = cols * rows;
    for (let i = 0; i < n; i++) {
      this.fog[i] = this.fogBase[i]!;
      if (Math.random() < 0.15) this.bead[i] = Math.min(this.dropSize(), this.runAt(i) * 0.9);
    }
    // Old streaks, top to bottom, half fogged over.
    for (let k = Math.max(2, Math.round(cols / 40)); k > 0; k--) this.streak(rand(0.05, 0.95) * W, H, H + ch, rand(0.3, 0.75), null);
    // Drops running now, each with its streak above it, fresher nearer it.
    for (let k = Math.max(4, Math.round(this.runCap * 0.2)); k > 0; k--) {
      const d = this.runner(rand(cw, W - cw), rand(0.15, 0.98) * H, rand(RUN, RUN * 1.8) * this.scale);
      d.vy = 60 * this.scale;
      this.streak(d.x, d.y, rand(0.2, 0.7) * d.y, 0, d);
      this.runners.push(d);
    }
  }

  /** A wandering streak up from (x, bottom) for `length` px: its condensation cleared, fogged back
   *  by `fogged` at its far end to all of it at its near end (or the other way, with no runner),
   *  its beads taken and a few small ones left. Its last cells are `d`'s path. */
  private streak(x: number, bottom: number, length: number, fogged: number, d: Runner | null) {
    const { ch, cw } = this;
    const steps = Math.max(1, Math.floor(length / ch));
    let drift = rand(-0.3, 0.3);
    for (let k = 0; k < steps; k++) {
      if (Math.random() < 0.3) drift = rand(-0.4, 0.4);
      x = clamp(x + drift * cw, cw / 2, this.width - cw / 2);
      const i = this.cellAt(x, bottom - k * ch);
      if (i < 0) continue;
      // Fresher nearer the drop: what it cleared longest ago has fogged over most.
      const age = d ? k / steps : 1;
      this.dim(i, this.fogBase[i]! * (d ? TRAIL_FOG + (1 - TRAIL_FOG) * 0.9 * age : fogged));
      this.bead[i] = Math.random() < TRAIL * 0.6 ? rand(0.6, 1.3) * this.scale : 0;
      if (d && k < STREAK) d.path[d.pathN++] = i;
    }
  }

  private runner(x: number, y: number, r: number): Runner {
    return { id: this.nextId++, x, y, r, vy: 0, vx: 0, turnAt: 0, stuck: 0, shiver: 0, path: new Int32Array(STREAK), pathN: 0 };
  }

  /** A raindrop's size as it lands (px): mostly small, now and then a big one. */
  private dropSize() {
    const s = this.scale;
    return Math.random() < 0.07 ? rand(2.4, 3.8) * s : (0.6 + 1.6 * Math.random() ** 2.2) * s;
  }

  /** How big the bead in cell `i` grows before it runs. */
  private runAt(i: number) {
    return (RUN + 1.2 * (hash3(i, 3, 7) - 0.5)) * this.scale;
  }

  cellAt(x: number, y: number) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    return c < 0 || r < 0 || c >= this.cols || r >= this.rows ? -1 : r * this.cols + c;
  }

  /** Clear cell `i`'s condensation down to `to`; it fogs over again from there. */
  private dim(i: number, to: number) {
    if (this.fog[i]! <= to) return;
    this.fog[i] = to;
    this.markClearing(i);
  }

  private markClearing(i: number) {
    if (this.isClearing[i]) return;
    this.isClearing[i] = 1;
    this.clearing[this.clearingN++] = i;
  }

  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** A tap on the glass: the drops near it shiver, then shake loose and run, biggest first; those
   *  running already slip. */
  splash(x: number, y: number) {
    this.taps.push({ x, y, age: 0 });
    if (this.taps.length > 4) this.taps.shift();
    const { cols, cw, ch } = this;
    const reach = TAP.reach * this.scale;
    const near: { i: number; r: number }[] = [];
    const c0 = Math.max(0, Math.floor((x - reach) / cw));
    const c1 = Math.min(cols - 1, Math.floor((x + reach) / cw));
    const r0 = Math.max(0, Math.floor((y - reach) / ch));
    const r1 = Math.min(this.rows - 1, Math.floor((y + reach) / ch));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c;
        const b = this.bead[i]!;
        if (b >= 0.9 * this.scale && Math.hypot((c + 0.5) * cw - x, (r + 0.5) * ch - y) < reach) near.push({ i, r: b });
      }
    }
    near.sort((a, b) => b.r - a.r);
    const room = Math.max(0, this.runCap + TAP.loose - this.runners.length);
    for (const { i, r } of near.slice(0, Math.min(TAP.loose, room))) {
      this.bead[i] = 0;
      const d = this.runner(((i % cols) + 0.5) * cw, (Math.floor(i / cols) + 0.5) * ch, Math.max(r, STOP * 1.4 * this.scale));
      d.shiver = rand(0.22, 0.42);
      this.runners.push(d);
    }
    for (const d of this.runners) {
      if (d.shiver > 0 || Math.hypot(d.x - x, d.y - y) > reach) continue;
      d.stuck = 0;
      d.shiver = 0.12;
    }
  }

  step(dt: number) {
    this.time += dt;
    this.rain(dt);
    this.wipe();
    this.run(dt);
    this.refog(dt);
    this.drive(dt);
    for (const t of this.taps) t.age += dt;
    while (this.taps.length && this.taps[0]!.age > TAP.life) this.taps.shift();
  }

  /** Rain lands: each drop on a bead swells it; two swollen neighbours run together; a bead grown
   *  too heavy starts to run. */
  private rain(dt: number) {
    const { cols, rows } = this;
    this.rainOwed += RAIN * this.width * this.height * dt;
    while (this.rainOwed >= 1) {
      this.rainOwed--;
      let i = Math.floor(Math.random() * cols * rows);
      // A drop landing beside a bead may touch it and join it: a bigger bead gathers more.
      const near = i + NEIGHBOURS[Math.floor(Math.random() * 4)]! * (Math.random() < 0.5 ? 1 : cols);
      if (near >= 0 && near < cols * rows && Math.random() * this.cw * 0.5 < this.bead[near]!) i = near;
      this.bead[i] = Math.hypot(this.bead[i]!, this.dropSize());
      const c = i % cols;
      // The neighbours it now touches (beads sit in their cells' middles).
      for (const [dc, dr, gap] of [[-1, 0, this.cw], [1, 0, this.cw], [0, -1, this.ch], [0, 1, this.ch]] as const) {
        if (c + dc < 0 || c + dc >= cols) continue;
        const j = i + dr * cols + dc;
        if (j < 0 || j >= cols * rows || !this.bead[j] || this.bead[i]! + this.bead[j]! < gap * 0.8) continue;
        this.bead[i] = Math.hypot(this.bead[i]!, this.bead[j]!);
        this.bead[j] = 0;
      }
      if (this.bead[i]! > this.runAt(i) && this.runners.length < this.runCap) {
        const d = this.runner((c + 0.5 + rand(-0.25, 0.25)) * this.cw, (Math.floor(i / cols) + 0.5) * this.ch, this.bead[i]!);
        this.bead[i] = 0;
        this.runners.push(d);
      }
    }
  }

  /** The finger on the glass wipes the condensation along its way from where it wiped last. */
  private wipe() {
    const p = this.pointer;
    if (!p.active) {
      this.wiped = null;
      return;
    }
    const from = this.wiped ?? p;
    const n = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / (this.cw * 0.5)));
    for (let k = 1; k <= n; k++) this.wipeAt(from.x + ((p.x - from.x) * k) / n, from.y + ((p.y - from.y) * k) / n);
    this.wiped = { x: p.x, y: p.y };
  }

  private wipeAt(x: number, y: number) {
    const { cols, rows, cw, ch } = this;
    const rx = WIPE.x * this.scale;
    const ry = WIPE.y * this.scale;
    const c0 = Math.max(0, Math.floor((x - rx) / cw));
    const c1 = Math.min(cols - 1, Math.floor((x + rx) / cw));
    const r0 = Math.max(0, Math.floor((y - ry) / ch));
    const r1 = Math.min(rows - 1, Math.floor((y + ry) / ch));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const d = (((c + 0.5) * cw - x) / rx) ** 2 + (((r + 0.5) * ch - y) / ry) ** 2;
        if (d >= 1) continue;
        const i = r * cols + c;
        // Clean in the middle, smeared at the edge.
        this.dim(i, d < 0.45 ? 0 : ((d - 0.45) / 0.55) * this.fogBase[i]!);
      }
    }
  }

  private run(dt: number) {
    const { cols, cw, ch, scale: s } = this;
    let gone = 0;
    for (const d of this.runners) {
      if (d.shiver > 0) {
        d.shiver -= dt;
        continue;
      }
      // Bigger runs faster; it sticks now and then, a big one less, and slips on.
      let target = (24 + 150 * clamp((d.r - STOP * s) / ((2.2 * RUN - STOP) * s), 0, 1)) * s;
      if (d.stuck > 0) {
        d.stuck -= dt;
        target *= 0.05;
      } else if (Math.random() < dt * clamp((RUN * 1.6 * s) / d.r, 0.4, 2)) d.stuck = rand(0.05, 0.45);
      d.vy += (target - d.vy) * Math.min(1, dt * 9);
      if (this.time >= d.turnAt) {
        d.vx = 0.5 * d.vx + 0.5 * d.vy * rand(-0.4, 0.4);
        d.turnAt = this.time + rand(0.1, 0.35);
      }
      const dy = d.vy * dt;
      d.x = clamp(d.x + d.vx * dt, cw / 2, this.width - cw / 2);
      d.y += dy;
      d.r = Math.max(0, d.r - FILM * dy);
      const c = Math.floor(d.x / cw);
      const r = Math.floor(d.y / ch);
      // It takes up the beads under it and just ahead, and wipes its line through the condensation.
      const wide = d.r > cw * 0.45 ? 1 : 0;
      for (let dc = -wide; dc <= wide; dc++) {
        if (c + dc < 0 || c + dc >= cols) continue;
        for (let dr = 0; dr <= 1; dr++) {
          if (r + dr < 0 || r + dr >= this.rows) continue;
          const i = (r + dr) * cols + c + dc;
          if (this.bead[i]) {
            d.r = Math.hypot(d.r, this.bead[i]!);
            this.bead[i] = 0;
          }
          if (dr === 0) this.dim(i, this.fogBase[i]! * TRAIL_FOG);
        }
      }
      const here = r >= 0 && r < this.rows ? r * cols + c : -1;
      if (here >= 0 && here !== d.path[0]) {
        // Into a new cell: the one it left may keep a bead of its water.
        const left = d.pathN ? d.path[0]! : -1;
        if (left >= 0 && !this.bead[left] && Math.random() < TRAIL) {
          const b = d.r * rand(0.2, 0.34);
          this.bead[left] = b;
          d.r = Math.sqrt(Math.max(0, d.r * d.r - b * b));
        }
        d.path.copyWithin(1, 0, STREAK - 1);
        d.path[0] = here;
        d.pathN = Math.min(STREAK, d.pathN + 1);
      }
      if (d.y - d.r > this.height) {
        d.r = 0;
        gone++;
      } else if (d.r < STOP * s) {
        // Too little left to run: it beads where it is.
        if (here >= 0) this.bead[here] = Math.hypot(this.bead[here]!, d.r);
        d.r = 0;
        gone++;
      }
    }
    if (gone) this.runners = this.runners.filter((d) => d.r > 0);
  }

  /** The cleared cells fog over again, each at its own pace. */
  private refog(dt: number) {
    for (let k = 0; k < this.clearingN; ) {
      const i = this.clearing[k]!;
      const base = this.fogBase[i]!;
      const f = this.fog[i]! + (dt * (0.75 + 0.5 * hash3(i, 5, 1))) / REFOG;
      if (f >= base) {
        this.fog[i] = base;
        this.isClearing[i] = 0;
        this.clearing[k] = this.clearing[--this.clearingN]!;
      } else {
        this.fog[i] = f;
        k++;
      }
    }
  }
}
