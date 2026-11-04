/**
 * What goes on in the glade, stepped a sixtieth of a second at a time: the fire burning and
 * flickering, sparks rising from it, smoke from the cottage's chimney, fireflies wandering and
 * blinking, the fox asleep by the fire, now and then a deer come to graze at the forest's edge, eyes
 * shining in the dark of the trees, and the weather: clear nights, mist rising, rain that comes and
 * goes. The pointer draws the fireflies; a click stirs the fire, ripples the pond, or scatters the
 * fireflies.
 *
 * It keeps everything in fixed pools, so a step allocates nothing; `collect` writes the frame's
 * sprites and lights into the renderer's buffers.
 */
import type { Atlas, Frame } from "./sprites";
import type { Glade } from "./glade";
import { hash, noise, rng } from "./px";
import { MAX_LIGHTS } from "./shaders";
import { SPRITE_FLOATS } from "./render";

const SPARKS = 48, PUFFS = 20, FLIES = 26, MAX_SPRITES = 220;

/** How the weather goes over its cycle: rain and mist, each 0 to 1, at a time in seconds. */
export const WEATHER_CYCLE = 420;
export function weather(t: number) {
  const c = ((t % WEATHER_CYCLE) + WEATHER_CYCLE) % WEATHER_CYCLE;
  const ramp = (a: number, b: number, v: number) => Math.max(0, Math.min(1, (v - a) / (b - a)));
  const rain = ramp(230, 260, c) * (1 - ramp(330, 360, c));
  const mist = Math.max(ramp(190, 230, c) * (1 - ramp(350, 400, c)), 0.15);
  // The ground stays wet a while after the rain.
  const wet = ramp(240, 280, c) * (1 - ramp(370, 420, c));
  return { rain, mist, wet };
}

export interface Pointer { x: number; y: number; over: boolean }

export class Life {
  t = 0;
  private flare = 0;
  private readonly sparks = new Float32Array(SPARKS * 6); // x, row, h, vx, vh, life left
  private readonly puffs = new Float32Array(PUFFS * 6);   // x, h, age, life, kind (0 chimney, 1 fire), drift
  private readonly flies = new Float32Array(FLIES * 8);   // x, row, h, vx, vrow, vh, phase, home kind
  private readonly ripples = new Float32Array(16).fill(-1);
  private ripple = 0;
  private deer = { on: false, x: 0, row: 0, dir: 1, state: 0, until: 0, next: 50, goal: 0, step: 0 };
  private eyes = { at: -1, from: 0, until: 0, next: 12 };
  private sparkAcc = 0;
  private puffAcc = 0;
  private nextJump = 18;
  private readonly rand = rng(97);
  readonly sprites = new Float32Array(MAX_SPRITES * SPRITE_FLOATS);
  readonly lights = new Float32Array(MAX_LIGHTS * 8);
  spriteCount = 0;
  lightCount = 0;
  /** Lamps lit (night) or not (day); fireflies and eyes only at night. */
  night = true;

  constructor(private g: Glade, private atlas: Atlas) {
    this.placeFlies();
  }

  /** A new glade (the screen changed size): carry on in it. */
  setGlade(g: Glade) {
    const sx = g.w / this.g.w, sy = g.h / this.g.h;
    this.g = g;
    for (let i = 0; i < FLIES; i++) { this.flies[i * 8] = this.flies[i * 8]! * sx; this.flies[i * 8 + 1] = this.flies[i * 8 + 1]! * sy; }
    this.sparks.fill(0);
    this.puffs.fill(0);
    this.deer.on = false;
  }

  private placeFlies() {
    const g = this.g, r = rng(5);
    for (let i = 0; i < FLIES; i++) {
      const o = i * 8, home = i % 3;
      this.flies[o] = r() * g.w;
      this.flies[o + 1] = home === 0 ? g.edge + 2 + r() * 20 : g.edge + 20 + r() * (g.h - g.edge - 20);
      this.flies[o + 2] = 3 + r() * 16;
      this.flies[o + 6] = r() * 100;
      this.flies[o + 7] = home;
    }
  }

  /** The fire's strength now: a flicker, and a flare after a click. */
  fireStrength() {
    const t = this.t;
    return 1 + 0.1 * Math.sin(t * 9.3) + 0.07 * Math.sin(t * 14.1 + 1.3) + 0.14 * (noise(t * 3.1, 0.5, 3) - 0.5) + this.flare * 0.8;
  }

  step(dt: number, pointer: Pointer, run: boolean) {
    this.t = (this.t + dt) % 14400;
    const t = this.t, g = this.g;
    this.flare = Math.max(0, this.flare - dt * 0.6);
    const w = weather(t);

    // Sparks from the fire.
    this.sparkAcc += dt * (5 + this.flare * 30) * (1 - w.rain * 0.6);
    while (this.sparkAcc > 1) { this.sparkAcc -= 1; this.spark(); }
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 6;
      if (this.sparks[o + 5]! <= 0) continue;
      this.sparks[o + 5] = this.sparks[o + 5]! - dt;
      this.sparks[o] = this.sparks[o]! + (this.sparks[o + 3]! + Math.sin(t * 3 + i) * 4) * dt;
      this.sparks[o + 2] = this.sparks[o + 2]! + this.sparks[o + 4]! * dt;
      this.sparks[o + 4] = this.sparks[o + 4]! * 1 - dt * 0.6;
    }
    // Smoke from the chimney, and a little from the fire.
    this.puffAcc += dt * 1.6;
    while (this.puffAcc > 1) { this.puffAcc -= 1; this.puff(this.rand() < 0.7 ? 0 : 1); }
    for (let i = 0; i < PUFFS; i++) {
      const o = i * 6;
      if (this.puffs[o + 3]! <= 0) continue;
      this.puffs[o + 2] = this.puffs[o + 2]! + dt;
      if (this.puffs[o + 2]! > this.puffs[o + 3]!) { this.puffs[o + 3] = 0; continue; }
      this.puffs[o + 1] = this.puffs[o + 1]! + dt * (5 + this.puffs[o + 2]! * 0.8);
      this.puffs[o] = this.puffs[o]! + dt * (2.5 + this.puffs[o + 5]! + Math.sin(t * 0.7 + i) * 1.5);
    }
    // Fireflies: wandering, drawn to the pointer when it rests in the glade.
    const draw = run && pointer.over;
    for (let i = 0; i < FLIES; i++) {
      const o = i * 8, f = this.flies;
      const ph = f[o + 6]!;
      let ax = (noise(t * 0.25, ph, 1) - 0.5) * 30, ar = (noise(t * 0.25, ph, 2) - 0.5) * 12, ah = (noise(t * 0.3, ph, 3) - 0.5) * 16;
      // Keep to their part of the glade, above the grass and below the crowns.
      const home = f[o + 7]!, lo = home === 0 ? g.edge - 4 : g.edge + 16, hi = home === 0 ? g.edge + 26 : g.h - 2;
      if (f[o + 1]! < lo) ar += 12; if (f[o + 1]! > hi) ar -= 12;
      if (f[o + 2]! < 3) ah += 14; if (f[o + 2]! > 26) ah -= 14;
      if (f[o]! < 4) ax += 20; if (f[o]! > g.w - 4) ax -= 20;
      // Away from the fire's heat.
      const fx = f[o]! - g.fire.x, fr = (f[o + 1]! - g.fire.y) * 2.5;
      if (Math.hypot(fx, fr) < 30) { ax += Math.sign(fx || 1) * 25; ar += Math.sign(fr || 1) * 8; }
      if (draw) {
        const dx = pointer.x - f[o]!, dr = pointer.y + f[o + 2]! * 0 - (f[o + 1]! - f[o + 2]!);
        const d = Math.hypot(dx, dr);
        if (d < 90 && d > 3) { ax += (dx / d) * 40; ar += (dr / d) * 20; }
      }
      f[o + 3] = (f[o + 3]! + ax * dt) * (1 - dt * 1.2);
      f[o + 4] = (f[o + 4]! + ar * dt) * (1 - dt * 1.2);
      f[o + 5] = (f[o + 5]! + ah * dt) * (1 - dt * 1.2);
      f[o] = f[o]! + f[o + 3]! * dt; f[o + 1] = f[o + 1]! + f[o + 4]! * dt; f[o + 2] = f[o + 2]! + f[o + 5]! * dt;
    }
    // The deer: comes now and then to graze, keeping its distance from the fire.
    const d = this.deer;
    if (!d.on && t > d.next && this.night !== undefined) {
      d.on = true; d.dir = this.rand() < 0.5 ? 1 : -1;
      d.x = d.dir > 0 ? -14 : g.w + 14;
      d.row = g.edge + 8 + this.rand() * 16;
      d.goal = d.dir > 0 ? g.w * (0.12 + this.rand() * 0.25) : g.w * (0.62 + this.rand() * 0.26);
      d.state = 0; d.step = 0;
    }
    if (d.on) {
      if (d.state === 0 || d.state === 2) {
        const v = 8 * d.dir * dt;
        d.x += v; d.step += Math.abs(v);
        if (d.state === 0 && (d.x - d.goal) * d.dir > 0) { d.state = 1; d.until = t + 7 + this.rand() * 8; }
        if (d.state === 2 && (d.x < -20 || d.x > g.w + 20)) { d.on = false; d.next = t + 80 + this.rand() * 90; }
      } else if (t > d.until) d.state = 2;
    }
    // Eyes in the dark of the trees, opening a while and blinking.
    const e = this.eyes;
    if (e.at < 0 && t > e.next) { e.at = Math.floor(this.rand() * g.eyes.length); e.from = t; e.until = t + 3 + this.rand() * 4; }
    if (e.at >= 0 && t > e.until) { e.at = -1; e.next = t + 9 + this.rand() * 14; }
    // Now and then a fish rises in the pond.
    if (t > this.nextJump) {
      this.nextJump = t + 12 + this.rand() * 20;
      const p = g.pond, a = this.rand() * Math.PI * 2;
      this.addRipple(p.cx + Math.cos(a) * p.rx * 0.5, p.cy + Math.sin(a) * p.ry * 0.4, 0.6);
    }
  }

  private spark() {
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 6;
      if (this.sparks[o + 5]! > 0) continue;
      this.sparks[o] = this.g.fire.x + (this.rand() - 0.5) * 6;
      this.sparks[o + 1] = this.g.fire.y;
      this.sparks[o + 2] = 8 + this.rand() * 6;
      this.sparks[o + 3] = (this.rand() - 0.5) * 8;
      this.sparks[o + 4] = 18 + this.rand() * 22 + this.flare * 20;
      this.sparks[o + 5] = 0.7 + this.rand() * 1.1;
      return;
    }
  }

  private puff(kind: number) {
    for (let i = 0; i < PUFFS; i++) {
      const o = i * 6;
      if (this.puffs[o + 3]! > 0) continue;
      this.puffs[o] = kind ? this.g.fire.x + (this.rand() - 0.5) * 3 : this.g.chimney.x;
      this.puffs[o + 1] = kind ? 18 : 0;
      this.puffs[o + 2] = 0;
      this.puffs[o + 3] = kind ? 2.2 : 5 + this.rand() * 2;
      this.puffs[o + 4] = kind;
      this.puffs[o + 5] = this.rand() * 2;
      return;
    }
  }

  addRipple(x: number, row: number, strength: number) {
    const o = (this.ripple++ % 4) * 4;
    this.ripples[o] = x; this.ripples[o + 1] = row; this.ripples[o + 2] = this.t; this.ripples[o + 3] = strength;
  }
  get rippleData() { return this.ripples; }

  /** A click at an art pixel: the fire stirred, the pond rippled, or the fireflies scattered. */
  click(x: number, y: number) {
    const g = this.g;
    if (Math.hypot(x - g.fire.x, (y - g.fire.y) * 1.5) < 26) { this.flare = 1; for (let k = 0; k < 24; k++) this.spark(); return; }
    const p = g.pond;
    if (((x - p.cx) / p.rx) ** 2 + ((y - p.cy) / p.ry) ** 2 < 1) { this.addRipple(x, y, 1); return; }
    for (let i = 0; i < FLIES; i++) {
      const o = i * 8, dx = this.flies[o]! - x, dr = this.flies[o + 1]! - this.flies[o + 2]! - y, dd = Math.hypot(dx, dr);
      if (dd < 60) { this.flies[o + 3] = this.flies[o + 3]! + (dx / (dd || 1)) * 60; this.flies[o + 4] = this.flies[o + 4]! + (dr / (dd || 1)) * 25; this.flies[o + 5] = this.flies[o + 5]! + 10; }
    }
  }

  /** The whole picture at rest, for a still frame: a clear night, the fire steady, no visitor. */
  settle() {
    this.t = 48;
    this.flare = 0;
    this.sparks.fill(0);
    this.puffs.fill(0);
    this.deer.on = false;
    this.eyes.at = -1;
    this.placeFlies();
    const g = this.g;
    // A few sparks and puffs where they would be, so the still picture is not empty of them.
    for (let k = 0; k < 6; k++) { const o = k * 6; this.sparks[o] = g.fire.x + (hash(k, 1) - 0.5) * 8; this.sparks[o + 1] = g.fire.y; this.sparks[o + 2] = 12 + k * 6; this.sparks[o + 5] = 0.5; }
    for (let k = 0; k < 5; k++) { const o = k * 6; this.puffs[o] = g.chimney.x + k * 3; this.puffs[o + 1] = k * 5; this.puffs[o + 2] = k; this.puffs[o + 3] = 6; this.puffs[o + 4] = 0; }
  }

  // ── what is drawn ──────────────────────────────────────────────────────────────────────────────

  private sprite(f: Frame, cx: number, foot: number, lift: number, o: { flip?: boolean; glow?: number; alpha?: number; z?: number; tint?: [number, number, number]; tintMix?: number } = {}) {
    if (this.spriteCount >= MAX_SPRITES) return;
    const s = this.sprites, i = this.spriteCount++ * SPRITE_FLOATS;
    s[i] = Math.round(cx - f.w / 2); s[i + 1] = Math.round(foot - lift - f.h + 1); s[i + 2] = f.w; s[i + 3] = f.h;
    s[i + 4] = f.x; s[i + 5] = f.y; s[i + 6] = foot; s[i + 7] = o.z ?? 0;
    s[i + 8] = o.flip ? 1 : 0; s[i + 9] = o.glow ?? 1; s[i + 10] = o.alpha ?? 1; s[i + 11] = lift;
    const tint = o.tint ?? [1, 1, 1];
    s[i + 12] = tint[0]; s[i + 13] = tint[1]; s[i + 14] = tint[2]; s[i + 15] = o.tintMix ?? 0;
  }

  private light(x: number, h: number, z: number, reach: number, r: number, gg: number, b: number) {
    if (this.lightCount >= MAX_LIGHTS) return;
    const l = this.lights, i = this.lightCount++ * 8;
    l[i] = x; l[i + 1] = h; l[i + 2] = z; l[i + 3] = reach; l[i + 4] = r; l[i + 5] = gg; l[i + 6] = b; l[i + 7] = 0;
  }

  /** The frame's sprites and lights, for the renderer. `firePower` and `lampPower` come from the look. */
  collect(firePower: number, lampPower: number) {
    this.spriteCount = 0;
    this.lightCount = 0;
    const g = this.g, a = this.atlas, t = this.t, w = weather(t);
    const fire = this.fireStrength() * (1 - w.rain * 0.25);
    // The fire: its flames, lit of themselves, and its light.
    const fi = Math.floor(t * 14) % a.flame.length;
    // Three tongues of flame, out of step: the big one in the middle, a smaller one either side.
    const n = a.flame.length;
    this.sprite(a.flame[(fi + 5) % n]!, g.fire.x - 4, g.fire.y + 1, 0, { glow: 0.85 * fire, z: 0.4, flip: true });
    this.sprite(a.flame[(fi + 11) % n]!, g.fire.x + 4, g.fire.y + 1, -1, { glow: 0.8 * fire, z: 0.3 });
    this.sprite(a.flame[fi]!, g.fire.x, g.fire.y + 2, 2, { glow: 1.1 * fire, z: 1 });
    // Embers glowing in the ash at its foot, each breathing in its own time.
    for (let k = 0; k < 9; k++) {
      const ang = k * 2.4, er = 3 + (k % 3) * 2;
      const pulse = 0.5 + 0.5 * Math.sin(t * (1.3 + (k % 4) * 0.4) + k * 1.7);
      this.sprite(a.dot, g.fire.x + Math.cos(ang) * er, g.fire.y + Math.sin(ang) * er * 0.4, 0.5, { glow: 0.35 + pulse * 0.5, tint: [1, 0.3 + pulse * 0.25, 0.08], tintMix: 1, z: 0.2 });
    }
    this.light(g.fire.x, 9, g.fire.y * 2 + 2, 125 * Math.sqrt(fire), 1.0 * firePower * fire, 0.42 * firePower * fire, 0.13 * firePower * fire);
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 6, life = this.sparks[o + 5]!;
      if (life <= 0) continue;
      const k = Math.min(1, life * 1.5);
      this.sprite(a.dot, this.sparks[o]!, this.sparks[o + 1]!, this.sparks[o + 2]!, { glow: 1.2 * k, tint: [1, 0.55 + 0.3 * k, 0.2 * k], tintMix: 1, z: 2 });
    }
    // Smoke: thinning as it rises.
    for (let i = 0; i < PUFFS; i++) {
      const o = i * 6, life = this.puffs[o + 3]!;
      if (life <= 0) continue;
      const age = this.puffs[o + 2]! / life, kind = this.puffs[o + 4]!;
      const f = a.smoke[Math.min(a.smoke.length - 1, Math.floor(age * a.smoke.length))]!;
      const base = kind ? { x: g.fire.x, foot: g.fire.y } : { x: g.chimney.x, foot: g.chimney.y + g.chimney.h };
      const lift = kind ? this.puffs[o + 1]! : g.chimney.h + this.puffs[o + 1]!;
      this.sprite(f, this.puffs[o]!, base.foot, lift, { alpha: (1 - age) * (kind ? 0.35 : 0.6) * (age < 0.1 ? age * 10 : 1), z: kind ? -2 : 40 });
    }
    // The fox asleep by the fire: breathing, an ear flicking now and then.
    const breath = Math.sin((t / 3.4) * Math.PI * 2) > 0.2 ? 1 : 0, flick = (t % 11) < 0.35 ? 2 : breath;
    this.sprite(a.fox[flick]!, g.fox.x, g.fox.y, 0, {});
    // The deer.
    const d = this.deer;
    if (d.on) {
      const graze = d.state === 1;
      const f = graze ? a.deerGraze[Math.floor(t * 0.8) % 2]! : a.deerWalk[Math.floor(d.step / 2.5) % 4]!;
      this.sprite(f, d.x, d.row, 0, { flip: d.dir < 0, glow: this.night ? 1 : 0 });
    }
    // The still lamps: windows and lanterns, flickering; glowing mushrooms steady.
    for (const l of g.lights) {
      const fl = l.flicker === 1 ? 1 + 0.08 * Math.sin(t * 11 + l.x) + 0.06 * (noise(t * 4, l.x, 1) - 0.5) : l.flicker === 2 ? 1 + 0.04 * Math.sin(t * 3 + l.x) : 1;
      const p = l.power * fl * (l.lamp ? lampPower : this.night ? 1 : 0.2);
      if (p <= 0.01) continue;
      const c = l.colour.map((v) => Math.pow(v / 255, 2.2) * p);
      this.light(l.x, l.h, l.z, l.reach, c[0]!, c[1]!, c[2]!);
    }
    if (!this.night) return;
    // Fireflies: dots that blink; the brightest light what is near them.
    const bright: number[] = [];
    for (let i = 0; i < FLIES; i++) {
      const o = i * 8, ph = this.flies[o + 6]!;
      const pulse = Math.max(0, Math.sin(t * (0.9 + (ph % 1) * 0.6) + ph)) ** 3 * (1 - w.rain * 0.8);
      if (pulse < 0.05) continue;
      const x = this.flies[o]!, row = this.flies[o + 1]!, h = this.flies[o + 2]!;
      this.sprite(a.dot, x, row, h, { glow: 0.4 + pulse * 1.1, tint: [0.75, 1, 0.35], tintMix: 1, z: 3 });
      if (pulse > 0.6 && bright.length < 8) { bright.push(i); this.light(x, h, row * 2, 16, 0.12 * pulse, 0.2 * pulse, 0.04 * pulse); }
    }
    // Eyes in the dark of the trees.
    const e = this.eyes;
    if (e.at >= 0) {
      const spot = g.eyes[e.at]!, open = Math.min(1, (t - e.from) * 2, (e.until - t) * 2);
      const blink = (t - e.from) % 2.3 < 0.12 ? 0 : 1;
      if (open > 0 && blink) for (const dx of [0, 3]) this.sprite(a.dot, spot.x + dx, spot.z / 2, (spot.z / 2) - spot.y, { glow: 0.55 * open, tint: [0.8, 0.9, 0.45], tintMix: 1, z: 1 });
    }
  }
}
