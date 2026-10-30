/**
 * Campfire's life, apart from any canvas. The fire is a field of heat over its cells: the logs at
 * its foot feed the bottom row, flickering; each cell above takes the heat of the cells under it,
 * shifted a little left or right as the air moves, and loses some as it rises, so tongues of flame
 * lick up and break off (the classic character fire). Sparks rise off it, drifting and winking out;
 * smoke curls up from it into the sky; crickets chirp in the grass, each in its own rhythm.
 *
 * The pointer draws the fire: its flames lean toward it and its sparks drift to it. A click drops a
 * log in, from the woodpile's side or the click's: it tumbles onto the fire, which flares up taller
 * with a burst of sparks, and burns down over the next while. At dusk (a light theme) it burns lower
 * and calmer.
 *
 * Bounded: the field is the fire's cells, SPARKS sparks and SMOKE puffs at most, two fresh logs.
 */
import { gridOf, type Grid } from "../grid";
import { clamp, noise1, rand } from "../num";
import type { Sim } from "../scene";
import { clearingOf, type ClearingLayout } from "./clearing";

export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Its own wobble, and when it winks. */
  phase: number;
}

export interface Puff {
  x: number;
  y: number;
  vy: number;
  age: number;
  life: number;
  phase: number;
}

/** A log thrown on: from where (px) to where, how far through its fall (0 to 1), and once on the
 *  fire how long it has burned (s). */
export interface Thrown {
  from: { x: number; y: number };
  to: { x: number; y: number };
  fall: number;
  burned: number;
  /** -1 from the left, 1 from the right. */
  side: -1 | 1;
}

export const SPARKS = 150;
export const SMOKE = 70;
/** How long a fresh log takes to burn down (s), and how long a flare lasts. */
export const BURN = 22;
const FLARE = 2.6;
/** How far round the fire the pointer draws it (a share of the window's height). */
const DRAW = 0.95;

export class Camp implements Sim {
  width = 0;
  height = 0;
  time = 0;
  grid: Grid = gridOf(1, 1);
  layout!: ClearingLayout;
  /** The fire's heat, a row of `fw` cells at a time from its top; two rows more under it, the
   *  coals that feed it. */
  heat = new Float32Array(0);
  fw = 0;
  fh = 0;
  sparks: Spark[] = [];
  smoke: Puff[] = [];
  logs: Thrown[] = [];
  pointer = { x: 0, y: 0, active: false };
  /** How far the flames lean (-1 left to 1 right), easing toward where the pointer draws them. */
  lean = 0;
  /** When the last log landed: the fire flares for a while after. */
  flaredAt = -Infinity;
  /** At dusk it burns lower. */
  calm = false;
  private seed = 0xf12e;
  private tick = 0;

  resize(width: number, height: number) {
    const first = this.width === 0;
    const sx = first ? 1 : width / this.width;
    const sy = first ? 1 : height / this.height;
    this.width = width;
    this.height = height;
    this.grid = gridOf(width, height);
    this.layout = clearingOf(this.grid, this.seed);
    const { width: fw, height: fh } = this.layout.fire;
    if (fw !== this.fw || fh !== this.fh) {
      // The fire burns on at its new size, its heat carried over by share of its field.
      const was = { heat: this.heat, fw: this.fw, fh: this.fh };
      this.fw = fw;
      this.fh = fh;
      this.heat = new Float32Array(fw * (fh + 2));
      if (was.fw) {
        for (let r = 0; r < fh + 2; r++) {
          for (let c = 0; c < fw; c++) {
            const from = Math.min(was.fh + 1, Math.floor((r / (fh + 2)) * (was.fh + 2))) * was.fw + Math.min(was.fw - 1, Math.floor((c / fw) * was.fw));
            this.heat[r * fw + c] = was.heat[from]!;
          }
        }
      }
    }
    for (const s of [...this.sparks, ...this.smoke]) {
      s.x *= sx;
      s.y *= sy;
    }
    for (const l of this.logs) {
      for (const p of [l.from, l.to]) {
        p.x *= sx;
        p.y *= sy;
      }
    }
    if (first) this.stock();
  }

  /** The fire caught and burning from its first frame, sparks and smoke rising off it. */
  private stock() {
    for (let i = 0; i < 90; i++) this.burn();
    for (let i = 0; i < 40; i++) {
      const s = this.newSpark(1);
      const t = rand(0, s.life * 0.9);
      s.age = t;
      s.x += s.vx * t;
      s.y += s.vy * t;
      this.sparks.push(s);
    }
    for (let i = 0; i < 26; i++) {
      const p = this.newPuff();
      const t = rand(0, p.life * 0.95);
      p.age = t;
      p.y += p.vy * t;
      p.x += Math.sin(t * 0.7 + p.phase) * 14;
      this.smoke.push(p);
    }
  }

  daylight(light: boolean) {
    this.calm = light;
  }

  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** Where the fire is, in px: the middle of its base, and its top. */
  fireAt() {
    const { cw, ch } = this.grid;
    const f = this.layout.fire;
    return { x: (f.c + 0.5) * cw, base: f.base * ch, top: (f.base - f.height) * ch };
  }

  /** A click: a log is thrown on, from the woodpile's side or the click's. */
  splash(x: number, y: number) {
    void y;
    const { cw, ch } = this.grid;
    const f = this.fireAt();
    const side: -1 | 1 = x < f.x ? -1 : 1;
    // A third log on is too many: the oldest is gone.
    if (this.logs.length >= 2) this.logs.shift();
    this.logs.push({
      from: { x: f.x + side * this.fw * cw * 0.9, y: f.base - this.fh * ch * 0.55 },
      to: { x: f.x + side * cw, y: f.base - ch * 0.5 },
      fall: 0, burned: 0, side,
    });
  }

  /** How strongly the fire burns now: 1 as usual, more after a log lands. */
  strength() {
    const since = this.time - this.flaredAt;
    const flare = since >= 0 && since < FLARE ? 0.55 * Math.exp(-since * 1.1) * Math.min(1, since * 8) : 0;
    return (this.calm ? 0.85 : 1) + flare;
  }

  step(dt: number) {
    this.time += dt;
    const { pointer: p, width: W, height: H } = this;
    // The flames lean toward the pointer, more the nearer it is.
    const f = this.fireAt();
    let want = 0;
    if (p.active) {
      const d = Math.hypot(p.x - f.x, p.y - (f.base + f.top) / 2);
      want = clamp((p.x - f.x) / (W * 0.18), -1, 1) * clamp(1.15 - d / (H * DRAW), 0.3, 1);
    }
    this.lean += (want - this.lean) * Math.min(1, dt * 2.5);
    // The field burns thirty times a second, as a character fire flickers best.
    if (++this.tick % 2 === 0) this.burn();
    this.throw(dt);
    this.rise(dt);
    this.curl(dt);
  }

  /** One turn of the fire: the coals flicker; each cell takes the heat of those under it, shifted
   *  as the air moves, and loses some as it rises. */
  private burn() {
    const { heat, fw, fh } = this;
    const strong = this.strength();
    const t = this.time;
    // The coals: hottest under the middle of the logs, flickering, a fresh log hotter.
    for (let c = 0; c < fw; c++) {
      const u = Math.abs((c + 0.5) / fw - 0.5) * 2;
      const bed = clamp(1.25 - u * u * 1.35, 0, 1);
      const flick = 0.55 + 0.45 * noise1(t * 7 + c * 0.9, this.seed) + (Math.random() - 0.5) * 0.35;
      for (const r of [fh, fh + 1]) heat[r * fw + c] = clamp(bed * flick * strong, 0, 1.4);
    }
    // Rising: top row first, so each row reads the rows under it as they were. Each cell takes the
    // heat of one cell under it, a little to one side (more toward the lean), and loses a little at
    // random: tongues of flame lick up and break off.
    const cool = ((this.calm ? 0.062 : 0.052) / Math.max(0.6, strong ** 0.7)) * (16 / fh);
    const lean = this.lean;
    for (let r = 0; r < fh; r++) {
      for (let c = 0; c < fw; c++) {
        let dx = Math.floor(Math.random() * 3) - 1;
        if (Math.random() < Math.abs(lean) * 0.75) dx -= Math.sign(lean);
        const cc = clamp(c + dx, 0, fw - 1);
        const v = heat[(r + 1) * fw + cc]! * 0.78 + heat[(r + 2) * fw + cc]! * 0.22;
        // Cooler toward the sides too, so the flames draw in to a point.
        const side = Math.abs((c + 0.5) / fw - 0.5) * 2;
        heat[r * fw + c] = Math.max(0, v - cool * Math.random() * 2 - side ** 3 * 0.05);
      }
    }
  }

  /** Logs thrown on fall into the fire; one landing flares it up with a burst of sparks. */
  private throw(dt: number) {
    for (let i = this.logs.length - 1; i >= 0; i--) {
      const l = this.logs[i]!;
      if (l.fall < 1) {
        l.fall = Math.min(1, l.fall + dt / 0.45);
        if (l.fall === 1) {
          this.flaredAt = this.time;
          const f = this.fireAt();
          for (let k = 0; k < 55; k++) this.addSpark(this.newSpark(2.2, f.x + rand(-1, 1) * this.fw * this.grid.cw * 0.3));
        }
        continue;
      }
      l.burned += dt;
      if (l.burned > BURN) this.logs.splice(i, 1);
    }
  }

  private newSpark(power: number, x?: number): Spark {
    const f = this.fireAt();
    const { cw } = this.grid;
    return {
      x: x ?? f.x + rand(-0.3, 0.3) * this.fw * cw,
      y: f.base - rand(0.3, 0.85) * this.fh * this.grid.ch,
      vx: rand(-18, 18) * power + this.lean * 30, vy: -rand(45, 110) * Math.sqrt(power),
      age: 0, life: rand(1.2, 3.2), phase: rand(0, 6.28),
    };
  }

  private addSpark(s: Spark) {
    if (this.sparks.length >= SPARKS) this.sparks.shift();
    this.sparks.push(s);
  }

  private newPuff(): Puff {
    const f = this.fireAt();
    return { x: f.x + rand(-0.2, 0.2) * this.fw * this.grid.cw, y: f.top + rand(0, 0.3) * this.fh * this.grid.ch, vy: -rand(20, 34), age: 0, life: rand(6, 9), phase: rand(0, 6.28) };
  }

  /** Sparks rise, wobbling, drifting to the pointer, slowing, and wink out. */
  private rise(dt: number) {
    const { pointer: p } = this;
    const rate = (this.calm ? 6 : 11) * this.strength();
    if (Math.random() < rate * dt) this.addSpark(this.newSpark(1));
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.age += dt;
      if (s.age > s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      let ax = Math.sin(this.time * 3 + s.phase) * 40;
      let ay = 18;
      if (p.active) {
        const dx = p.x - s.x;
        const dy = p.y - s.y;
        const d = Math.hypot(dx, dy) || 1;
        // Drawn toward the pointer, the nearer the more.
        const pull = 140 * clamp(1.2 - d / (this.height * 0.7), 0, 1);
        ax += (dx / d) * pull;
        ay += (dy / d) * pull;
      }
      s.vx += ax * dt;
      s.vy += ay * dt;
      s.vx -= s.vx * Math.min(1, dt * 0.6);
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  /** Smoke rises off the flames' tips, curling and spreading as it goes. */
  private curl(dt: number) {
    if (this.smoke.length < SMOKE && Math.random() < dt * (this.calm ? 2.6 : 3.6)) this.smoke.push(this.newPuff());
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i]!;
      s.age += dt;
      if (s.age > s.life || s.y < -20) {
        this.smoke.splice(i, 1);
        continue;
      }
      s.y += s.vy * dt * (1 - 0.3 * (s.age / s.life));
      // Curling, wider as it rises, leaning away with the lean of the flames.
      s.x += (Math.sin(s.age * 0.9 + s.phase) * (8 + s.age * 3) + this.lean * 10) * dt;
    }
  }

  /** How hot the fire's cell (c, r) is (r from its top). */
  heatAt(c: number, r: number) {
    return this.heat[r * this.fw + c]!;
  }

  /** Whether cricket `k` is lit now: bursts of quick chirps, each its own rhythm. */
  chirping(k: number) {
    const period = 1.6 + (k % 7) * 0.31;
    const at = (this.time + k * 0.77) % period;
    return at < 0.42 && Math.floor(at / 0.07) % 2 === 0;
  }
}
