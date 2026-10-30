/**
 * Snowfall: snow falling on a mountain village at dusk (or on a bright cold day). Flakes fall in
 * three depths, far ones small and slow, near ones big and quick, each swaying its own way, all
 * carried by a wind that blows steadily and comes in gusts. Where they land the snow piles up: on
 * the ground along the bottom (a height map, a little lumpy, that slowly rises to its most and no
 * further) and on every roof and branch that shows the sky (each to its most). Smoke curls from the
 * chimneys, carried off by the wind; windows light and go dark now and then.
 *
 * The pointer is a gust of its own: the flakes and the smoke near it are blown away from it, and
 * swept along as it moves. A click is a puff of powder: it bursts out from there, hangs a moment
 * and drifts down with the wind; the flakes near it are blown aside.
 */
import { cellSize } from "../cells";
import type { Sim } from "../scene";
import { clamp, noise2, rand } from "../util";
import { layoutOf, villageOf, type Layout, type Village } from "./village";

export interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 far, 1 among the houses, 2 near. */
  layer: 0 | 1 | 2;
  /** 0 to 1: how big, of its depth. */
  size: number;
  phase: number;
}

/** A puff of smoke, or a grain of a click's powder. */
export interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
}

/** Per depth: how fast a flake falls and sways (px/s on 8 px cells), how much of the wind it takes,
 *  and how many to each px² of window. */
const FALL = [18, 40, 78];
const SWAY = [5, 12, 22];
const DRIFT = [0.45, 0.8, 1.25];
export const DENSITY = [1 / 2600, 1 / 8500, 1 / 38000];
/** How much a flake landing raises the ground (rows), and the most the ground rises; how much one
 *  landing on a ledge adds. */
export const GROUND = { land: 0.025, start: 0.3, cap: 1.8 };
const LEDGE_LAND = 0.06;
/** The pointer's gust: how far it reaches (px on 8 px cells) and how hard it blows (px/s²). */
export const GUST = { reach: 170, push: 900 };
/** A click's puff: how many grains, the most there may be at once, and how long one lasts. */
export const POWDER = { n: 44, most: 160, life: [2.2, 4.2] as const };
/** Smoke: a puff every so often from each chimney, the most from one, how long each lasts. */
const SMOKE = { every: 0.38, most: 22, life: [5, 8] as const };

export class Valley implements Sim {
  width = 0;
  height = 0;
  cw = 8;
  ch = 12;
  cols = 0;
  rows = 0;
  time = 0;
  village: Village | null = null;
  layout: Layout | null = null;
  /** The snow on the ground in each column: rows above where it lay at first (`groundTop`). */
  ground = new Float32Array(0);
  groundTop = new Float32Array(0);
  /** The snow on each ledge (layout.ledges), in rows, and which ledge each cell is (-1 none). */
  ledgeDepth = new Float32Array(0);
  ledgeAt = new Int32Array(0);
  flakes: Flake[] = [];
  /** Each chimney's smoke, by house (empty for a house without one). */
  smoke: Puff[][] = [];
  powder: Puff[] = [];
  /** Each window lit or not, house by house; when each next changes; a count of the changes. */
  lit: Uint8Array[] = [];
  litAt: Float32Array[] = [];
  litVersion = 0;
  wind = 0;
  pointer = { x: 0, y: 0, active: false };
  /** How the pointer is moving (px/s), smoothed. */
  pointerVel = { x: 0, y: 0 };
  private lastPointer: { x: number; y: number } | null = null;
  private gust = { at: 4, dur: 4, peak: 50 };
  private smokeAt: number[] = [];
  private settleAt = 0;

  get scale() {
    return this.cw / 8;
  }

  /** The top of the snow on the ground in column `c`, in px. */
  surface(c: number) {
    const k = clamp(c, 0, this.cols - 1);
    return (this.groundTop[k]! - this.ground[k]!) * this.ch;
  }

  resize(width: number, height: number) {
    const was = { width: this.width, height: this.height, cols: this.cols, layout: this.layout, ground: this.ground, ledgeDepth: this.ledgeDepth };
    this.width = width;
    this.height = height;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    const first = !this.village;
    this.village ??= villageOf(this.cols, this.rows);
    const layout = (this.layout = layoutOf(this.village, this.cols, this.rows));
    // The snow lies in long drifts and small ones, by the share of the width: the same at any size.
    this.groundTop = Float32Array.from({ length: this.cols }, (_, c) => {
      const x = c / this.cols;
      return layout.front + 0.7 + 1.1 * (noise2(x * 9, 0.5, 41) - 0.5) + 0.5 * (noise2(x * 31, 1.5, 42) - 0.5);
    });
    this.ground = new Float32Array(this.cols);
    this.ledgeDepth = new Float32Array(layout.ledges.length);
    this.ledgeAt = new Int32Array(this.cols * this.rows).fill(-1);
    layout.ledges.forEach((l, k) => { if (l.r >= 0) this.ledgeAt[l.r * this.cols + l.c] = k; });
    if (first) {
      this.stock();
      return;
    }
    // The same valley in the new window: the snow where it lay, each flake and puff at its place.
    for (let c = 0; c < this.cols; c++) this.ground[c] = was.ground[clamp(Math.floor(((c + 0.5) / this.cols) * was.cols), 0, was.cols - 1)]!;
    const depth = new Map(was.layout!.ledges.map((l, k) => [l.key, was.ledgeDepth[k]!]));
    layout.ledges.forEach((l, k) => { this.ledgeDepth[k] = Math.min(l.cap, depth.get(l.key) ?? l.cap * 0.7); });
    const sx = width / was.width;
    const sy = height / was.height;
    for (const p of [...this.flakes, ...this.powder, ...this.smoke.flat()]) {
      p.x *= sx;
      p.y *= sy;
    }
    this.fillFlakes();
  }

  /** As many flakes of each depth as the window holds: more on a bigger one, spread over all of it. */
  private fillFlakes(spreadOut = false) {
    const { width: W, height: H } = this;
    for (const layer of [0, 1, 2] as const) {
      const want = Math.round(W * H * DENSITY[layer]!);
      const have = this.flakes.filter((f) => f.layer === layer);
      if (have.length > want) {
        const drop = new Set(have.slice(want));
        this.flakes = this.flakes.filter((f) => !drop.has(f));
      }
      for (let k = have.length; k < want; k++) {
        const f: Flake = { x: rand(0, W), y: spreadOut || Math.random() < 0.5 ? rand(0, this.floorOf(layer)) : rand(-H * 0.3, 0), vx: 0, vy: 0, layer, size: Math.random(), phase: rand(0, 6.28) };
        f.vx = this.wind * DRIFT[layer]!;
        f.vy = FALL[layer]! * this.scale;
        this.flakes.push(f);
      }
    }
  }

  /** Where a flake of `layer` lands or passes out of sight, about: the far ones behind the village,
   *  the others on the ground. */
  private floorOf(layer: number) {
    const l = this.layout!;
    return layer === 0 ? (l.back + 1) * this.ch : layer === 1 ? (l.front + 0.5) * this.ch : this.height;
  }

  /** The valley a while into the snow: snow on the ground and on every ledge, flakes everywhere,
   *  smoke curling up from each chimney, lights in some windows. */
  private stock() {
    const layout = this.layout!;
    for (let c = 0; c < this.cols; c++) this.ground[c] = GROUND.start * (0.6 + 0.8 * noise2(c / 5, 2.5, 43));
    layout.ledges.forEach((l, k) => { this.ledgeDepth[k] = l.cap * rand(0.5, 0.85); });
    this.wind = this.windAt(0);
    this.fillFlakes(true);
    this.smoke = layout.houses.map(() => []);
    this.smokeAt = layout.houses.map(() => rand(0, SMOKE.every));
    this.lit = layout.houses.map((h) => Uint8Array.from(h.windows, () => (Math.random() < 0.65 ? 1 : 0)));
    this.litAt = layout.houses.map((h) => Float32Array.from(h.windows, () => rand(15, 120)));
    // Smoke that has been rising a while already: eight seconds of it, run before the start.
    this.smokeAt = this.smokeAt.map((a) => a - 8);
    for (let k = 0; k < 480; k++) this.stepSmoke(1 / 60, k / 60 - 8);
  }

  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
    if (!active) this.lastPointer = null;
  }

  /** A click: a puff of powder bursts out from there, and the flakes near it are blown aside. */
  splash(x: number, y: number) {
    const s = this.scale;
    for (let k = 0; k < POWDER.n; k++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(50, 230) * s;
      this.powder.push({ x: x + rand(-4, 4), y: y + rand(-4, 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8 - 40 * s, age: 0, life: rand(POWDER.life[0], POWDER.life[1]), seed: Math.random() });
    }
    if (this.powder.length > POWDER.most) this.powder.splice(0, this.powder.length - POWDER.most);
    const reach = 140 * s;
    for (const f of this.flakes) {
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy);
      if (d >= reach || d < 1) continue;
      const k = 1 - d / reach;
      f.vx += (dx / d) * 220 * k * s;
      f.vy += (dy / d) * 150 * k * s;
    }
  }

  /** The wind now (px/s on 8 px cells, rightward): a steady breeze that wanders, and gusts. */
  private windAt(t: number) {
    let w = 10 + 9 * Math.sin(t / 19) + 5 * Math.sin(t / 7.1 + 1);
    const g = this.gust;
    if (t > g.at && t < g.at + g.dur) w += g.peak * Math.sin((Math.PI * (t - g.at)) / g.dur) ** 2;
    return w * this.scale;
  }

  step(dt: number) {
    this.time += dt;
    const t = this.time;
    if (t > this.gust.at + this.gust.dur) this.gust = { at: t + rand(5, 15), dur: rand(2.5, 5), peak: rand(35, 85) * (Math.random() < 0.75 ? 1 : -1) };
    this.wind = this.windAt(t);
    this.trackPointer(dt);
    this.fall(dt);
    this.stepSmoke(dt, t);
    this.stepPowder(dt);
    this.windows(t);
    if (t >= this.settleAt) {
      this.settleAt = t + 0.5;
      this.settleGround();
    }
  }

  private trackPointer(dt: number) {
    const p = this.pointer;
    if (!p.active) {
      this.pointerVel.x *= 0.9;
      this.pointerVel.y *= 0.9;
      return;
    }
    if (this.lastPointer) {
      const k = Math.min(1, dt * 10);
      this.pointerVel.x += ((p.x - this.lastPointer.x) / dt - this.pointerVel.x) * k;
      this.pointerVel.y += ((p.y - this.lastPointer.y) / dt - this.pointerVel.y) * k;
    }
    this.lastPointer = { x: p.x, y: p.y };
  }

  /** How the pointer's gust pushes something at (x, y), into `out` (px/s²), times `k`. */
  private gustAt(x: number, y: number, vx: number, vy: number, k: number, out: { x: number; y: number }) {
    out.x = 0;
    out.y = 0;
    const p = this.pointer;
    if (!p.active) return;
    const reach = GUST.reach * this.scale;
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.hypot(dx, dy);
    if (d >= reach) return;
    const f = (1 - d / reach) ** 2 * k;
    const push = GUST.push * this.scale * f;
    const ux = d > 0.5 ? dx / d : 1;
    const uy = d > 0.5 ? dy / d : 0;
    // Away from it and a little round it; and along with it as it moves.
    out.x = ux * push - uy * push * 0.3 + (this.pointerVel.x - vx) * f * 4;
    out.y = uy * push * 0.75 + ux * push * 0.3 + (this.pointerVel.y - vy) * f * 4;
  }

  private fall(dt: number) {
    const { width: W, height: H, time: t, cols, rows, cw, ch, scale: s } = this;
    const push = { x: 0, y: 0 };
    const relax = Math.min(1, dt * 1.8);
    for (const f of this.flakes) {
      const L = f.layer;
      const tx = this.wind * DRIFT[L]! + Math.sin(t * (0.6 + 0.9 * f.size) + f.phase) * SWAY[L]! * s;
      const ty = FALL[L]! * s * (0.75 + 0.5 * f.size) * (1 + 0.15 * Math.sin(t * 1.3 + f.phase));
      this.gustAt(f.x, f.y, f.vx, f.vy, 1, push);
      f.vx += (tx - f.vx) * relax + push.x * dt;
      f.vy += (ty - f.vy) * relax + push.y * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      if (f.x < -30) f.x += W + 60;
      else if (f.x > W + 30) f.x -= W + 60;
      if (f.y < -H * 0.4) f.y = -H * 0.4;
      const c = Math.floor(f.x / cw);
      if (L === 1 && c >= 0 && c < cols) {
        const r = Math.floor(f.y / ch);
        const k = r >= 0 && r < rows ? this.ledgeAt[r * cols + c]! : -1;
        // On a roof or a branch that shows the sky: it may settle there.
        if (k >= 0 && Math.random() < 0.08) {
          const l = this.layout!.ledges[k]!;
          this.ledgeDepth[k] = Math.min(l.cap, this.ledgeDepth[k]! + LEDGE_LAND);
          this.respawn(f);
          continue;
        }
        if (f.y >= this.surface(c)) {
          this.ground[c] = Math.min(GROUND.cap, this.ground[c]! + GROUND.land);
          this.respawn(f);
          continue;
        }
      }
      if (f.y > (L === 0 ? this.floorOf(0) : H + 10)) this.respawn(f);
    }
  }

  private respawn(f: Flake) {
    f.x = rand(-30, this.width + 30);
    f.y = rand(-40, -4);
    f.vx = this.wind * DRIFT[f.layer]!;
    f.vy = FALL[f.layer]! * this.scale;
  }

  /** The ground's snow settles a little each half second: a column higher than its neighbours gives
   *  them some, so it lies in drifts, not spikes. */
  private settleGround() {
    const g = this.ground;
    const n = g.length;
    if (n < 2) return;
    let prev = g[0]!;
    for (let c = 0; c < n; c++) {
      const here = g[c]!;
      // At either end of the window, its one neighbour stands for both.
      const next = c + 1 < n ? g[c + 1]! : prev;
      g[c] = here + 0.12 * ((prev + next) / 2 - here);
      prev = here;
    }
  }

  private stepSmoke(dt: number, t: number) {
    const layout = this.layout!;
    const s = this.scale;
    const push = { x: 0, y: 0 };
    layout.houses.forEach((h, k) => {
      if (!h.smoke) return;
      const puffs = this.smoke[k]!;
      if (t >= this.smokeAt[k]!) {
        this.smokeAt[k] = t + SMOKE.every * rand(0.7, 1.3);
        puffs.push({ x: h.smoke.x * this.cw + rand(-1, 1), y: h.smoke.y * this.ch, vx: 0, vy: -rand(12, 18) * s, age: 0, life: rand(SMOKE.life[0], SMOKE.life[1]), seed: Math.random() });
        if (puffs.length > SMOKE.most) puffs.shift();
      }
      for (const p of puffs) {
        p.age += dt;
        this.gustAt(p.x, p.y, p.vx, p.vy, 0.5, push);
        p.vy += (-14 * s * (1 - p.age / p.life) - p.vy) * dt * 0.6 + push.y * dt;
        p.vx += (this.wind * 0.45 - p.vx) * dt * 0.7 + push.x * dt;
        // It curls as it rises, wider as it goes.
        p.x += p.vx * dt + Math.sin(p.age * 1.5 + p.seed * 6.28) * 10 * s * dt * (0.4 + p.age / p.life);
        p.y += p.vy * dt;
      }
      while (puffs.length && puffs[0]!.age > puffs[0]!.life) puffs.shift();
    });
  }

  private stepPowder(dt: number) {
    if (!this.powder.length) return;
    const s = this.scale;
    const drag = Math.exp(-2.4 * dt);
    for (const p of this.powder) {
      p.age += dt;
      p.vx = p.vx * drag + (this.wind * 0.6 - p.vx) * dt * 0.3;
      p.vy = Math.min(p.vy * drag + 70 * s * dt, FALL[1]! * s);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.powder = this.powder.filter((p) => p.age < p.life && p.y < this.surface(Math.floor(p.x / this.cw)));
  }

  /** Now and then a window lights, or goes dark. */
  private windows(t: number) {
    for (let k = 0; k < this.lit.length; k++) {
      const at = this.litAt[k]!;
      for (let j = 0; j < at.length; j++) {
        if (t < at[j]!) continue;
        this.lit[k]![j] = this.lit[k]![j] ? 0 : 1;
        at[j] = t + rand(30, 160);
        this.litVersion++;
      }
    }
  }
}
