/**
 * Northern Lights: a tundra at night (or at dawn), a far ridge and a dark line of spruce along the
 * snow, and over it the aurora: a few curtains of light, each one ribbon with a bright lower edge
 * that folds and ripples, the folds travelling along it, its light rising from it in rays that
 * drift, fading as they rise, the whole curtain breathing brighter and dimmer. Now and then a
 * shooting star.
 *
 * The curtains are functions of where and when (`light`): nothing to step but the clock, the
 * pointer's pull and the shooting stars. The pointer draws the curtain to it: the rays near it lean
 * toward it, its edge dips toward it, and it brightens round it. A click sends a shooting star
 * streaking from there.
 */
import { cellSize } from "../cells";
import type { Sim } from "../scene";
import { clamp, lerp, rand, seeded, smooth } from "../util";

export interface Curtain {
  /** Its lower edge's height, and its rays' length, as shares of the window's height. */
  base: number;
  reach: number;
  /** Where along the window it is brightest, and how far it spreads (shares of the width). */
  fx: number;
  span: number;
  /** Two folds along its edge: height (px on a 900 px window), wavenumber (per px), speed. */
  folds: [number, number, number, number, number, number];
  /** Its rays: three waves, wavenumbers and speeds; and where each starts. */
  rays: [number, number, number, number, number, number];
  phase: number;
  /** It breathes: how fast, and how strongly. */
  breath: number;
  strength: number;
}

export interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
}

/** How long a shooting star lasts, and how many may streak at once. */
export const METEOR = { most: 6, speed: [650, 950] as const, life: [0.55, 0.85] as const };
/** The pointer's pull: how far round it the curtain answers (shares of the width and height). */
export const PULL = { across: 0.16, down: 0.22, rise: 1.2, fall: 0.5 };
/** Where the land meets the sky, as a share of the height (land.ts lays the trees on it). */
export const HORIZON = 0.8;

export class Tundra implements Sim {
  width = 0;
  height = 0;
  cw = 8;
  ch = 12;
  time = 0;
  curtains: Curtain[];
  meteors: Meteor[] = [];
  pointer = { x: 0, y: 0, active: false };
  /** How much the pointer draws the curtains now, 0 to 1 (it eases in and out), and where it is,
   *  followed smoothly. */
  pull = 0;
  at = { x: 0, y: 0 };
  private nextMeteor = 0;

  constructor() {
    // The same sky every time: a long ribbon across the middle, a fainter one higher on the right.
    const rnd = seeded(0xa0a);
    const r = (lo: number, hi: number) => lerp(lo, hi, rnd());
    this.curtains = [
      [0.42, 0.3, 0.38, 0.42, 1],
      [0.27, 0.2, 0.76, 0.24, 0.72],
    ].map(([base, reach, fx, span, strength]) => ({
      base: base!, reach: reach!, fx: fx!, span: span!,
      folds: [r(60, 100), r(0.003, 0.0055), r(0.1, 0.2), r(26, 44), r(0.009, 0.015), r(0.25, 0.45)],
      rays: [r(0.12, 0.18), r(0.3, 0.5), r(0.3, 0.45), r(0.6, 1), r(0.035, 0.05), r(0.1, 0.25)],
      phase: r(0, 6.28),
      breath: r(0.08, 0.16),
      strength: strength!,
    }));
  }

  /** Sizes go with the window: 1 on a 900 px tall one. */
  get scale() {
    return Math.min(this.width, this.height) / 900;
  }

  resize(width: number, height: number) {
    const first = this.width === 0;
    const sx = first ? 1 : width / this.width;
    const sy = first ? 1 : height / this.height;
    this.width = width;
    this.height = height;
    ({ cw: this.cw, ch: this.ch } = cellSize(width, height));
    for (const m of this.meteors) {
      m.x *= sx;
      m.y *= sy;
    }
    this.at.x *= sx;
    this.at.y *= sy;
    if (first) this.nextMeteor = rand(4, 12);
  }

  /** Where curtain `k`'s lower edge is at x (px), at the time it is now, the pointer's pull in it. */
  edge(k: number, x: number) {
    const c = this.curtains[k]!;
    const s = this.scale;
    const t = this.time;
    const [a1, k1, w1, a2, k2, w2] = c.folds;
    let y = this.height * c.base + s * (a1 * Math.sin((x * k1) / s + t * w1 + c.phase) + a2 * Math.sin((x * k2) / s - t * w2 + c.phase * 2));
    // It dips toward the pointer near it.
    if (this.pull > 0) y += (this.at.y + this.height * 0.08 - y) * 0.3 * this.pull * Math.exp(-(((x - this.at.x) / (this.width * PULL.across)) ** 2));
    return y;
  }

  /** How much the rays rising from x lean toward the pointer, per px they rise. */
  lean(x: number) {
    if (this.pull <= 0) return 0;
    const d = (this.at.x - x) / (this.width * PULL.across * 2);
    return clamp(d, -1, 1) * Math.exp(-d * d * 0.5) * 0.55 * this.pull;
  }

  /** How bright curtain `k`'s rays are at x, 0 to 1: three waves drifting along it, eased, so the
   *  curtain is one ribbon brighter and dimmer along it, not bars. */
  rays(k: number, x: number) {
    const c = this.curtains[k]!;
    const s = this.scale;
    const t = this.time;
    const [k1, w1, k2, w2, k3, w3] = c.rays;
    const v = 0.5 + 0.25 * Math.sin((x * k1) / s + t * w1 + c.phase) + 0.15 * Math.sin((x * k2) / s - t * w2) + 0.1 * Math.sin((x * k3) / s + t * w3 + c.phase * 3);
    const e = clamp(v, 0, 1);
    return e * e * (3 - 2 * e);
  }

  /** Where curtain `k` folds and is seen edge on, it is brighter: by how steeply its edge climbs or
   *  falls at x. */
  fold(k: number, x: number) {
    const slope = (this.edge(k, x + 3) - this.edge(k, x - 3)) / 6;
    return 1 + 1.3 * Math.min(1, Math.abs(slope) * 1.6);
  }

  /** How strong curtain `k` is at x along the window: brightest at its middle, fading to its ends,
   *  breathing; and brighter round the pointer. */
  along(k: number, x: number) {
    const c = this.curtains[k]!;
    const d = (x / this.width - c.fx) / c.span;
    return c.strength * Math.exp(-d * d * 2) * (0.72 + 0.28 * Math.sin(this.time * c.breath * 6.28 + c.phase));
  }

  /** How much brighter the pointer makes the sky at (x, y). */
  glowAt(x: number, y: number) {
    if (this.pull <= 0) return 1;
    const dx = (x - this.at.x) / (this.width * PULL.across);
    const dy = (y - this.at.y) / (this.height * PULL.down);
    return 1 + 0.9 * this.pull * Math.exp(-(dx * dx + dy * dy));
  }

  /** A curtain's light that does not part into rays, by `u`, how far up its rays a point is (0 its
   *  edge, 1 their reach): its bright lower edge, sharp under it and fading a little way above; and a
   *  faint glow round the edge, the same above it as below, so the sky under the curtain is the same
   *  night sky, a little lit, never darker than the sky round it. */
  static base(u: number) {
    const rim = 0.6 * Math.exp(u < 0 ? u * 30 : -u * 10);
    return rim + 0.05 * Math.exp(-((u / 0.45) ** 2));
  }

  /** Its light that rises in rays, by `u`: from its edge, fading as they rise, gone at their reach.
   *  How bright each ray is comes from `rays`, squared: rays with the plain sky between them, so the
   *  sky above the curtain is the same sky as under it. */
  static rise(u: number) {
    if (u < 0) return 0.6 * Math.exp(u * 30);
    return 0.6 * Math.exp(-u * 2.2) * (1 - smooth(0.6, 1, u));
  }

  /** The aurora's light at (x, y), 0 and up: every curtain's, the pointer's pull in it. */
  light(x: number, y: number) {
    let sum = 0;
    for (let k = 0; k < this.curtains.length; k++) {
      const base = this.edge(k, x);
      const reach = this.height * this.curtains[k]!.reach;
      const u = (base - y) / reach;
      if (u < -0.7 || u > 1.1) continue;
      const r = this.rays(k, x + this.lean(x) * (base - y));
      sum += this.along(k, x) * this.fold(k, x) * (Tundra.base(u) + Tundra.rise(u) * r * r);
    }
    return sum * this.glowAt(x, y);
  }

  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** A click: a shooting star streaks from there, away across the sky and down. */
  splash(x: number, y: number) {
    this.launch(x, y);
  }

  private launch(x: number, y: number) {
    const s = this.scale;
    // Down and off to the side it has more sky on.
    const side = x < this.width / 2 ? 1 : -1;
    const a = rand(0.25, 0.65);
    const v = rand(METEOR.speed[0], METEOR.speed[1]) * s;
    this.meteors.push({ x, y, vx: side * Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: rand(METEOR.life[0], METEOR.life[1]) });
    if (this.meteors.length > METEOR.most) this.meteors.shift();
  }

  step(dt: number) {
    this.time += dt;
    const p = this.pointer;
    this.pull = clamp(this.pull + (p.active ? dt / PULL.rise : -dt / PULL.fall), 0, 1);
    if (p.active) {
      if (this.pull <= dt / PULL.rise) this.at = { x: p.x, y: p.y };
      const k = Math.min(1, dt * 4);
      this.at.x += (p.x - this.at.x) * k;
      this.at.y += (p.y - this.at.y) * k;
    }
    for (const m of this.meteors) {
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
    }
    if (this.meteors.length && this.meteors[0]!.age > this.meteors[0]!.life) this.meteors = this.meteors.filter((m) => m.age <= m.life);
    if (this.time >= this.nextMeteor) {
      this.nextMeteor = this.time + rand(14, 40);
      this.launch(rand(0.1, 0.9) * this.width, rand(0.05, 0.35) * this.height);
    }
  }
}
