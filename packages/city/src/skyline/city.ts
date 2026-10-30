/**
 * Skyline's city, apart from any canvas: buildings standing along a street across the bottom of the
 * window, two rows deep, each its own height, roof and windows; the people in them switching their
 * lights on and off as they come and go; traffic both ways along the street; now and then a plane
 * across the sky; clouds drifting by day.
 *
 * The pointer resting near the buildings brings people to the windows nearest it, one after
 * another, each switching on a light to look out. A click sends a firework up: it bursts in the sky
 * above the click.
 *
 * Everything is laid out in cells (cells.ts), from the street up. The city is made once, left to
 * right, from a seeded stream: a wider window shows more of it and a narrower one less, and every
 * building keeps its width in cells, its height as a share of the window's, its roof and its lit
 * windows, so a resize keeps the city.
 */
import type { Sim } from "../scene";
import { cellSize } from "../cells";
import { clamp, hashOf, rand, randInt, seeded } from "../util";

export type Roof = "flat" | "box" | "tank" | "mast" | "spire" | "pyramid" | "dome" | "slant";
export type Material = "grey" | "brick" | "glass" | "stone";
/** What a window shows: 0 to 4, each a light of its own at night and a look of its own by day
 *  (render.ts). 0 is the most common: dark at night, the sky's reflection by day; 1 a warm light,
 *  2 an amber one, 3 a cool one, 4 a dim one. */
export type WindowState = 0 | 1 | 2 | 3 | 4;
/** The lit states' odds: glass towers' offices burn cool, homes and the rest warm. */
const LIGHT_ODDS = { glass: [0.34, 0.1, 0.5, 0.06], other: [0.5, 0.28, 0.12, 0.1] };

/** Rows along the bottom that are the street: the pavement, and a lane each way. */
export const STREET_ROWS = 3;
/** The most floors a building's windows are kept for: a 4K window's height in rows. */
const MAX_FLOORS = 128;

export interface Building {
  id: number;
  /** 0 the row behind, 1 the row in front along the street. */
  layer: 0 | 1;
  /** Its left outline's column, and how many columns from outline to outline, both included. */
  c0: number;
  w: number;
  /** How high its main body stands, as a share of the rows above the street. */
  share: number;
  material: Material;
  roof: Roof;
  /** Narrower blocks set back on top of it, each inset this many columns a side from the one below,
   *  its floors a share of the main body's. */
  steps: { inset: number; share: number }[];
  /** Which of its columns have windows: every one, two in three, or every other. */
  pattern: 0 | 1 | 2;
  /** How busy it is: the share of its windows lit, on average (busy floors more, quiet ones less). */
  busy: number;
  /** Its windows' states, by floor from the street (`MAX_FLOORS` of them) and column from its left
   *  outline. */
  states: Uint8Array;
  /** Its own variety: a shopfront, the side its roof's details stand. */
  seed: number;
}

/** One block of a building, as laid out in cells: outline columns `c0` to `c1`, its top outline
 *  along row `top`, standing on the row `bottom` (exclusive). */
export interface Block { c0: number; c1: number; top: number; bottom: number }

/** A building where the window puts it: its blocks bottom to top, and its windows. */
export interface Placed {
  b: Building;
  blocks: Block[];
  /** Its windows: cell column, row and key (floor * w + column) each. */
  winC: Int16Array;
  winR: Int16Array;
  winKey: Int32Array;
}

export interface Car {
  /** 0 the far lane, going right; 1 the near lane, going left. */
  lane: 0 | 1;
  /** Its back end's x, in px (its left end going right, its right end going left). */
  x: number;
  v: number;
  vmax: number;
  /** Cells long. */
  len: number;
  kind: "car" | "taxi" | "van" | "bus";
  /** Which of the palette's car colours. */
  paint: number;
}

export interface Plane { x: number; y: number; v: number; phase: number }

export interface Cloud { x: number; y: number; w: number; h: number; v: number; seed: number }

/** A window someone has come to, to look out: lit, with them in it. */
export interface Looker { place: number; key: number; since: number; until: number }

export interface Firework {
  x: number;
  /** Where it bursts, and where it went up from. */
  y: number;
  from: number;
  age: number;
  /** How long it climbs, and how long its sparks last once it bursts. */
  rise: number;
  life: number;
  kind: "peony" | "ring" | "willow";
  /** The palette's firework colours: half its sparks burn in one, half in the other (the same,
   *  often). */
  colour: number;
  colour2: number;
  /** Its sparks: x, y, vx, vy each, laid out when it bursts. */
  sparks: Float32Array;
}

/** Sparks in a burst, by kind. */
const SPARKS = { peony: 64, ring: 40, willow: 48 } as const;
/** At most this many fireworks up at once: one more, and the oldest is gone. */
export const MAX_FIREWORKS = 6;
/** At most this many people at windows at once. */
export const MAX_LOOKERS = 12;
/** How near the pointer a window has to be for someone to come to it (px), how long the pointer
 *  rests before they come, and how soon one comes after another. */
export const LOOK_REACH = 170;
const REST = 0.3;
const LOOK_EVERY = 0.35;
/** How often, on average, each window's light is switched (seconds). */
const SWITCH_EVERY = 140;
/** The windows changed lately, for the drawing to repaint: a ring this long. */
export const CHANGE_RING = 512;

/** The cells of a window, and where the street is. */
export function gridOf(width: number, height: number) {
  const { cw, ch } = cellSize(width, height);
  const rows = Math.max(STREET_ROWS + 8, Math.floor(height / ch));
  return { cw, ch, cols: Math.ceil(width / cw), rows, base: rows - STREET_ROWS };
}

export class City implements Sim {
  width = 0;
  height = 0;
  cw = 8;
  ch = 12;
  cols = 0;
  rows = 0;
  /** The pavement's row: the buildings stand on it. */
  base = 0;
  time = 0;
  /** Every building made so far, back row and front row, left to right in each. */
  buildings: Building[] = [];
  /** Those the window shows now, back row first, laid out in its cells. */
  placed: Placed[] = [];
  cars: Car[] = [];
  planes: Plane[] = [];
  clouds: Cloud[] = [];
  lookers: Looker[] = [];
  fireworks: Firework[] = [];
  /** Windows switched lately: (place << 16) | key, the last `CHANGE_RING`; `changes` counts them
   *  all, so the drawing knows which it has not painted. A resize lays the city out again, and
   *  `layout` counts those. */
  changed = new Int32Array(CHANGE_RING);
  changes = 0;
  layout = 0;
  pointer = { x: 0, y: 0, active: false, restX: 0, restY: 0, movedAt: 0 };
  /** The seed the city was made from, and its streams of buildings, one a row. */
  seed = 0;
  private streams: [() => number, () => number] = [Math.random, Math.random];
  private nextId = 0;
  private windowCount = 0;
  /** Each placed building's windows, summed: to pick one at random, evenly. */
  private windowsBefore = new Int32Array(0);
  private switchDue = 0;
  private lookDue = 0;
  private planeDue = 0;

  resize(width: number, height: number) {
    const first = this.width === 0;
    const was = { w: this.width, h: this.height };
    this.width = width;
    this.height = height;
    ({ cw: this.cw, ch: this.ch, cols: this.cols, rows: this.rows, base: this.base } = gridOf(width, height));
    if (first) {
      this.seed = Math.floor(Math.random() * 2 ** 31);
      this.streams = [seeded(this.seed), seeded(this.seed + 1)];
    }
    this.extend();
    this.place();
    if (first) {
      this.stock();
      return;
    }
    // What moves stays where it was in the window, as a share of it.
    const sx = width / was.w;
    const sy = height / was.h;
    for (const c of this.cars) c.x *= sx;
    for (const p of this.planes) { p.x *= sx; p.y *= sy; }
    for (const c of this.clouds) { c.x *= sx; c.y *= sy; }
    for (const f of this.fireworks) { f.x *= sx; f.y *= sy; f.from *= sy; for (let i = 0; i < f.sparks.length; i += 4) { f.sparks[i]! *= sx; f.sparks[i + 1]! *= sy; } }
    this.fitTraffic();
  }

  /** Make buildings on to the right until each row reaches past the window's edge. */
  private extend() {
    for (const layer of [0, 1] as const) {
      const row = this.buildings.filter((b) => b.layer === layer);
      let right = row.length ? row[row.length - 1]!.c0 + row[row.length - 1]!.w - 1 : layer ? -randInt(1, 4) : -randInt(2, 6);
      while (right < this.cols + 2) {
        const r = this.streams[layer];
        // Front: touching, sharing a wall, or a narrow gap; back: anywhere.
        const gap = layer ? [-1, 0, 0, 1, 2][Math.floor(r() * 5)]! : Math.floor(r() * 4) - 1;
        const c0 = right + 1 + gap;
        const b = this.building(layer, c0, r);
        this.buildings.push(b);
        right = c0 + b.w - 1;
      }
    }
  }

  /** A new building of row `layer` at column `c0`, from the row's stream. Its height leans higher
   *  toward the sides of the window it was made for, so the tall towers stand to the left and the
   *  right and the middle stays lower and calmer. */
  private building(layer: 0 | 1, c0: number, r: () => number): Building {
    const u = clamp((c0 + 4) / Math.max(1, this.cols), 0, 1);
    const bump = (c: number, s: number) => Math.exp(-(((u - c) / s) ** 2));
    const lean = 0.5 + 0.5 * Math.max(bump(0.16, 0.14), bump(0.84, 0.14));
    const [lo, hi] = layer ? [0.08, 0.4] : [0.2, 0.48];
    const share = lo + (hi - lo) * lean * (0.45 + 0.55 * r());
    const tall = share > lo + (hi - lo) * 0.62;
    const material = (["grey", "brick", "glass", "stone"] as const)[Math.floor(r() * (tall ? 3 : 4))]!;
    const w = layer ? 6 + Math.floor(r() * (tall ? 7 : 10)) : 6 + Math.floor(r() * 8);
    // Old brick wears a water tank; towers a mast or a spire; the rest each their own.
    const roofs: Roof[] = material === "brick" ? ["tank", "tank", "flat", "box", "slant"]
      : tall ? ["mast", "spire", "spire", "box", "dome", "pyramid"]
      : ["flat", "box", "box", "pyramid", "dome", "slant", "tank"];
    const roof = roofs[Math.floor(r() * roofs.length)]!;
    const steps: Building["steps"] = [];
    if ((roof === "spire" || (tall && r() < 0.5)) && w >= 8) {
      steps.push({ inset: 1 + Math.floor(r() * 2), share: 0.1 + r() * 0.1 });
      if (w >= 11 && r() < 0.6) steps.push({ inset: 1 + Math.floor(r() * 2), share: 0.06 + r() * 0.08 });
    }
    const pattern = (material === "glass" || material === "grey" ? 0 : material === "brick" ? 1 : 2) as Building["pattern"];
    const b: Building = { id: this.nextId++, layer, c0, w, share, material, roof, steps, pattern, busy: 0.06 + 0.4 * r() ** 1.4, states: new Uint8Array(MAX_FLOORS * w), seed: Math.floor(r() * 2 ** 31) };
    for (let i = 0; i < b.states.length; i++) b.states[i] = this.roll(b, Math.floor(i / w));
    return b;
  }

  /** A window's state when someone comes or goes: lit as often as its building and its floor are
   *  busy (a floor of offices working late, a quiet one), in a light of its building's kind. */
  private roll(b: Building, floor: number): WindowState {
    const lit = clamp(b.busy * (hashOf(b.seed, floor, 3) < 0.35 ? 2.1 : 0.45), 0.01, 0.9);
    if (Math.random() >= lit) return 0;
    const odds = LIGHT_ODDS[b.material === "glass" ? "glass" : "other"];
    let u = Math.random();
    for (let s = 0; s < odds.length; s++) if ((u -= odds[s]!) < 0) return (s + 1) as WindowState;
    return 1;
  }

  /** Lay out the buildings the window shows, in its cells, and their windows. */
  private place() {
    const { base, cols } = this;
    this.placed = [];
    for (const b of this.buildings) {
      if (b.c0 > cols || b.c0 + b.w < 0) continue;
      const floors = Math.max(5, Math.round(b.share * base));
      const blocks: Block[] = [{ c0: b.c0, c1: b.c0 + b.w - 1, top: base - floors, bottom: base }];
      for (const s of b.steps) {
        const under = blocks[blocks.length - 1]!;
        const c0 = under.c0 + s.inset;
        const c1 = under.c1 - s.inset;
        if (c1 - c0 < 3) break;
        const n = Math.max(2, Math.round(s.share * floors));
        blocks.push({ c0, c1, top: under.top - n, bottom: under.top });
      }
      const c: number[] = [];
      const r: number[] = [];
      const k: number[] = [];
      for (const [i, bl] of blocks.entries()) {
        // A block's windows: the rows between its top outline and the block below's (the ground
        // floor is shops and doors), the columns between its outlines that its pattern opens.
        for (let row = bl.top + 1; row < (i ? bl.bottom : bl.bottom - 1); row++) {
          if (row < 0) continue;
          const floor = base - 1 - row;
          if (floor >= MAX_FLOORS) continue;
          for (let col = bl.c0 + 1; col < bl.c1; col++) {
            const off = col - b.c0;
            if (b.pattern === 1 && off % 3 === 0) continue;
            if (b.pattern === 2 && off % 2 === 0) continue;
            c.push(col);
            r.push(row);
            k.push(floor * b.w + off);
          }
        }
      }
      this.placed.push({ b, blocks, winC: Int16Array.from(c), winR: Int16Array.from(r), winKey: Int32Array.from(k) });
    }
    this.windowsBefore = new Int32Array(this.placed.length + 1);
    for (let i = 0; i < this.placed.length; i++) this.windowsBefore[i + 1] = this.windowsBefore[i]! + this.placed[i]!.winC.length;
    this.windowCount = this.windowsBefore[this.placed.length]!;
    // The people at windows stay at theirs, where the window still shows it.
    const byBuilding = new Map(this.placed.map((p, i) => [p.b, i]));
    this.lookers = this.lookers.flatMap((l) => {
      const was = this.prevPlaced[l.place];
      const at = was ? byBuilding.get(was.b) : undefined;
      if (at === undefined || !this.placed[at]!.winKey.includes(l.key)) return [];
      return [{ ...l, place: at }];
    });
    this.prevPlaced = this.placed;
    this.layout++;
  }
  private prevPlaced: Placed[] = [];

  /** How high the city stands at x: the top of the highest block there, in px. */
  roofAt(x: number): number {
    const c = Math.floor(x / this.cw);
    let top = this.base;
    for (const p of this.placed) for (const bl of p.blocks) if (c >= bl.c0 && c <= bl.c1) top = Math.min(top, bl.top);
    return (top + 0.5) * this.ch;
  }

  /** The street's traffic, its clouds and maybe a plane, spread over the window: the first frame
   *  is a city under way. */
  private stock() {
    this.fitTraffic();
    const n = clamp(Math.round((this.width * this.height) / 280_000), 3, 10);
    this.clouds = Array.from({ length: n }, (_, i) => {
      const w = randInt(9, 20);
      return { x: ((i + rand(0.1, 0.9)) / n) * this.width - w * this.cw * 0.5, y: rand(0.05, 0.25) * this.height, w, h: randInt(3, 5), v: rand(3, 8), seed: randInt(0, 2 ** 30) };
    });
    if (Math.random() < 0.7) this.planes.push(this.plane(rand(0.15, 0.85) * this.width));
    this.planeDue = this.time + rand(12, 40);
  }

  /** As many cars as the street's length takes, half each way, spread along it. */
  private fitTraffic() {
    const want = clamp(Math.round(this.width / 140), 4, 22);
    for (const lane of [0, 1] as const) {
      const mine = this.cars.filter((c) => c.lane === lane);
      const n = Math.ceil(want / 2) - (lane && want % 2 ? 1 : 0);
      if (mine.length > n) {
        const drop = new Set(mine.slice(n));
        this.cars = this.cars.filter((c) => !drop.has(c));
      }
      for (let i = mine.length; i < n; i++) this.cars.push(this.car(lane, ((i + rand(0.15, 0.85)) / n) * this.width));
    }
  }

  private car(lane: 0 | 1, x: number): Car {
    const u = Math.random();
    const kind = u < 0.62 ? "car" : u < 0.78 ? "taxi" : u < 0.92 ? "van" : "bus";
    const vmax = rand(55, 105) * (kind === "bus" ? 0.75 : 1);
    return { lane, x, v: vmax, vmax, len: kind === "bus" ? 6 : kind === "van" ? 4 : 3, kind, paint: randInt(0, 5) };
  }

  private plane(x: number): Plane {
    return { x, y: rand(0.08, 0.28) * this.height, v: (Math.random() < 0.5 ? -1 : 1) * rand(38, 60), phase: rand(0, 2) };
  }

  /** The pointer over the city, or gone from it. Moved more than a little, it is not resting. */
  point(x: number, y: number, active: boolean) {
    const p = this.pointer;
    if (!p.active || Math.hypot(x - p.restX, y - p.restY) > 12) {
      p.restX = x;
      p.restY = y;
      p.movedAt = this.time;
    }
    p.x = x;
    p.y = y;
    p.active = active;
  }

  /** A click: a firework goes up from it and bursts in the sky above it, just clear of the roofs
   *  there (near the click, where the person is looking: tiles may cover the sky higher up). */
  splash(x: number, y: number) {
    const roof = this.roofAt(x);
    const burst = clamp(Math.min(y - 30, roof - rand(40, 90)), this.height * 0.07, this.height * 0.6);
    const from = Math.max(y, burst + 90);
    const kind = (["peony", "peony", "ring", "willow"] as const)[randInt(0, 3)]!;
    const colour = randInt(0, 5);
    this.fireworks.push({
      x, y: burst, from, age: 0, rise: clamp((from - burst) / 520, 0.35, 0.9), life: kind === "willow" ? rand(2.6, 3.2) : rand(2, 2.6),
      kind, colour, colour2: Math.random() < 0.45 ? randInt(0, 5) : colour, sparks: new Float32Array(SPARKS[kind] * 4),
    });
    if (this.fireworks.length > MAX_FIREWORKS) this.fireworks.shift();
  }

  step(dt: number) {
    this.time += dt;
    this.switchLights(dt);
    this.look();
    this.drive(dt);
    this.fly(dt);
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > this.width + 8) c.x = -c.w * this.cw - rand(0, 160);
    }
    this.burn(dt);
  }

  /** People come and go: a window at random switches, so many a second as the city's windows
   *  divided by `SWITCH_EVERY`. */
  private switchLights(dt: number) {
    if (!this.windowCount) return;
    this.switchDue += (this.windowCount / SWITCH_EVERY) * dt;
    while (this.switchDue >= 1) {
      this.switchDue--;
      const n = Math.floor(Math.random() * this.windowCount);
      let lo = 0;
      let hi = this.placed.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.windowsBefore[mid]! <= n) lo = mid;
        else hi = mid - 1;
      }
      const pl = this.placed[lo]!;
      const key = pl.winKey[n - this.windowsBefore[lo]!]!;
      pl.b.states[key] = this.roll(pl.b, Math.floor(key / pl.b.w));
      this.changed[this.changes % CHANGE_RING] = (lo << 16) | key;
      this.changes++;
    }
  }

  /** The pointer resting near the buildings: someone comes to the nearest window not yet looked
   *  out of, then the next, one after another; moved off, or gone, they go back in a while. */
  private look() {
    const { pointer: p, time } = this;
    const resting = p.active && time - p.movedAt > REST;
    for (const l of this.lookers) {
      if (l.until !== Infinity) continue;
      const pl = this.placed[l.place]!;
      const i = pl.winKey.indexOf(l.key);
      const far = i < 0 || Math.hypot((pl.winC[i]! + 0.5) * this.cw - p.x, (pl.winR[i]! + 0.5) * this.ch - p.y) > LOOK_REACH + 40;
      if (!resting || far) l.until = time + rand(1.5, 5);
    }
    if (this.lookers.some((l) => time > l.until)) this.lookers = this.lookers.filter((l) => time <= l.until);
    if (!resting || time < this.lookDue || this.lookers.length >= MAX_LOOKERS) return;
    this.lookDue = time + LOOK_EVERY;
    // Not always the very nearest: of those near, the nearer the likelier, so they come to windows
    // here and there round it, not in a block.
    let best = { score: Infinity, place: -1, key: 0 };
    const c0 = (p.x - LOOK_REACH) / this.cw;
    const c1 = (p.x + LOOK_REACH) / this.cw;
    for (const [place, pl] of this.placed.entries()) {
      if (pl.b.c0 + pl.b.w < c0 || pl.b.c0 > c1) continue;
      for (let i = 0; i < pl.winC.length; i++) {
        const d = Math.hypot((pl.winC[i]! + 0.5) * this.cw - p.x, (pl.winR[i]! + 0.5) * this.ch - p.y);
        if (d >= LOOK_REACH) continue;
        const score = d * (0.4 + Math.random());
        // Behind a building in front, a window cannot be seen to light.
        if (score >= best.score || (pl.b.layer === 0 && this.hidden(pl.winC[i]!, pl.winR[i]!))) continue;
        const key = pl.winKey[i]!;
        if (this.lookers.some((l) => l.place === place && l.key === key)) continue;
        best = { score, place, key };
      }
    }
    if (best.place >= 0) this.lookers.push({ place: best.place, key: best.key, since: time, until: Infinity });
  }

  /** Whether the cell (c, r) is behind a building of the front row. */
  hidden(c: number, r: number) {
    for (const p of this.placed) {
      if (p.b.layer !== 1) continue;
      for (const bl of p.blocks) if (c >= bl.c0 && c <= bl.c1 && r >= bl.top - 1 && r < bl.bottom) return true;
    }
    return false;
  }

  /** The traffic: each car keeps its distance from the one ahead in its lane; one gone off the end
   *  comes back in at the other a while later. */
  private drive(dt: number) {
    const { width: W, cw } = this;
    for (const lane of [0, 1] as const) {
      const dir = lane ? -1 : 1;
      // Front to back along the lane.
      const order = this.cars.filter((c) => c.lane === lane).sort((a, b) => (b.x - a.x) * dir);
      for (const [i, c] of order.entries()) {
        const ahead = order[i - 1];
        let want = c.vmax;
        if (ahead) {
          const gap = (ahead.x - c.x) * dir - c.len * cw;
          const safe = cw * 3 + c.v * 0.7;
          if (gap < safe) want = Math.min(want, ahead.v * clamp(gap / safe, 0, 1));
        }
        c.v += clamp(want - c.v, -160 * dt, 40 * dt);
        c.x += c.v * dir * dt;
        const gone = dir > 0 ? c.x > W + 10 : c.x < -10;
        if (gone) {
          const next = this.car(lane, 0);
          const tail = order[order.length - 1]!;
          const behind = Math.max(rand(20, 420), tail === c ? 0 : (dir > 0 ? -tail.x : tail.x - W) + cw * 6);
          Object.assign(c, next, { x: dir > 0 ? -next.len * cw - behind : W + next.len * cw + behind });
        }
      }
    }
  }

  private fly(dt: number) {
    for (const p of this.planes) p.x += p.v * dt;
    if (this.planes.some((p) => p.x < -60 || p.x > this.width + 60)) this.planes = this.planes.filter((p) => p.x >= -60 && p.x <= this.width + 60);
    if (this.time >= this.planeDue) {
      this.planeDue = this.time + rand(25, 55);
      if (this.planes.length < 2) {
        const p = this.plane(0);
        p.x = p.v > 0 ? -50 : this.width + 50;
        this.planes.push(p);
      }
    }
  }

  /** Each firework climbs, bursts into its sparks, which fly out, slow, fall and fade. */
  private burn(dt: number) {
    for (const f of this.fireworks) {
      const was = f.age;
      f.age += dt;
      if (was < f.rise && f.age >= f.rise) this.burst(f);
      if (f.age < f.rise) continue;
      const drag = Math.exp(-(f.kind === "willow" ? 1.5 : 1.05) * dt);
      const fall = f.kind === "willow" ? 36 : 48;
      const s = f.sparks;
      for (let i = 0; i < s.length; i += 4) {
        s[i + 2]! *= drag;
        s[i + 3] = s[i + 3]! * drag + fall * dt;
        s[i]! += s[i + 2]! * dt;
        s[i + 1]! += s[i + 3]! * dt;
      }
    }
    if (this.fireworks.some((f) => f.age > f.rise + f.life)) this.fireworks = this.fireworks.filter((f) => f.age <= f.rise + f.life);
  }

  private burst(f: Firework) {
    const n = f.sparks.length / 4;
    const s = f.sparks;
    const turn = rand(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = turn + (i / n) * Math.PI * 2 + rand(-0.05, 0.05);
      // A peony fills a sphere, seen flat: its sparks at many speeds. A ring is one speed. A
      // willow is slower, and droops.
      const v = f.kind === "ring" ? 190 : f.kind === "willow" ? rand(80, 150) : 200 * Math.sqrt(rand(0.12, 1));
      s[i * 4] = f.x;
      s[i * 4 + 1] = f.y;
      s[i * 4 + 2] = Math.cos(a) * v;
      s[i * 4 + 3] = Math.sin(a) * v * 0.92;
    }
  }

  /** How far a firework's rocket has climbed: its y now, slowing as it nears the top. */
  rocketY(f: Firework) {
    const t = Math.min(1, f.age / f.rise);
    return f.from + (f.y - f.from) * (1 - (1 - t) ** 2);
  }

  /** A window's state, where the window shows it. */
  stateOf(place: number, key: number): WindowState {
    return this.placed[place]!.b.states[key]! as WindowState;
  }
}

/** A building's own number in [0, 1), for its `k`th choice of detail. */
export const detail = (b: Building, k: number) => hashOf(b.seed, k, 7);
