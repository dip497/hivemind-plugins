/**
 * Bees' meadow: the bees and where they fly. Each of the person's agents is a bee of its program's
 * species, bigger than the meadow's own small bees:
 *
 *   working    flies flower to flower gathering, and takes a full load home to the hive;
 *   ready      hovers in loose loops near the hive;
 *   needs-you  flies to the open side of its own tile and dances the waggle there;
 *   resting    sits on the hive, still.
 *
 * A turn that ends well is a quick loop and a burst of pollen. The small bees drift between the
 * flowers and in and out of the hive, and scatter from a click in the open. The agents' bees keep
 * out from under the tiles: they pick only flowers and places in the open, fly round a tile in
 * their way by its corner, and are pushed out from under one put down over them. All of it is plain
 * state, stepped and read; nothing here draws.
 */
import type { AgentState, WallpaperCreature, WallpaperTile } from "@hivemind/view-sdk";
import { gridOf, headOf, layGround, type Flower, type Grid, type Ground } from "./ground";
import { SHAPES, speciesOf, type SpeciesId } from "./species";

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Where a bee that needs you dances: a straight run toward its tile, from `from` to `to`, then a
 *  loop back round, one side and then the other. Its `side` is the tile's side it is on, or "hive"
 *  when its tile is not in sight and it dances by the hive instead. */
export interface Dance {
  from: { x: number; y: number };
  to: { x: number; y: number };
  side: "left" | "right" | "top" | "bottom" | "hive";
  /** The ground the whole dance covers, bee and all. */
  box: Box;
}

export interface Bee {
  id: string;
  species: SpeciesId;
  size: number;
  state: AgentState;
  /** Its agent went: it flies home and goes in. */
  leaving: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  /** Its own offset in every rhythm, so two bees never move as one. */
  phase: number;
  /** On a flower, the hive door or its perch, wings folded. */
  landed: boolean;
  /** Seconds left where it landed, gathering or unloading. */
  stay: number;
  /** The flower it is going to or on (-1 none), how much pollen it carries (0 to 1), and whether
   *  it is taking a load home. */
  flower: number;
  pollen: number;
  home: boolean;
  /** Its place on the hive while it rests. */
  perch: number;
  /** Its dance while it needs you, and how far into it (seconds; < 0 still flying there). */
  dance: Dance | null;
  danceAt: number;
  /** Across its run, how far it is shaken: the waggle, in cells, drawn and not flown. */
  shake: { x: number; y: number };
  /** A turn ended well: seconds left of its loop, and the loop's middle. */
  loop: number;
  loopAt: { x: number; y: number };
  /** 0 to 1: its "needs you" light, fading in and out with the state. */
  call: number;
  /** Seconds to the next grain of pollen it lets fall, flying home laden. */
  trail: number;
  /** Put where its state has it since it came or its state last changed: a still frame leaves it. */
  placed: boolean;
}

/** One of the meadow's own small bees. */
export interface Drone {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  flower: number;
  /** Seconds left on its flower, or inside the hive; scattered: seconds left fleeing. */
  stay: number;
  inside: boolean;
  home: boolean;
  flee: number;
  landed: boolean;
}

/** A turn's puff of pollen light, spreading and fading. */
export interface Puff {
  x: number;
  y: number;
  age: number;
}

/** How long a puff of pollen light lasts, in seconds. */
export const PUFF = 0.8;

/** A grain of a turn's pollen burst. */
export interface Grain {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  glyph: string;
}

/** How fast each state flies, in px/s. */
const SPEED: Record<AgentState, number> = { working: 105, ready: 75, "needs-you": 280, resting: 70 };
/** A dance: its run toward the tile takes this share of each round. */
const RUN = 0.42;
/** A dance round, in seconds. */
const ROUND = 2.4;
/** A turn's loop, in seconds. */
const LOOP = 0.85;

export class Meadow {
  width = 0;
  height = 0;
  time = 0;
  grid: Grid = { cw: 8, ch: 12, cols: 0, rows: 0 };
  ground: Ground | null = null;
  bees: Bee[] = [];
  drones: Drone[] = [];
  grains: Grain[] = [];
  puffs: Puff[] = [];
  pointer = { x: 0, y: 0, over: false };
  /** The tiles to keep out from under (all but those filling half the window, which nothing
   *  could keep out of), and each agent's tile by its id. */
  private tiles: readonly WallpaperTile[] = [];
  private boxes: WallpaperTile[] = [];
  private tileOf = new Map<string, WallpaperTile>();
  /** Bumped when the tiles move, so each dance is worked out again once. */
  private tilesVersion = 0;
  private danceVersion = new Map<string, number>();
  /** Each ready bee's loop, as last worked out. */
  private loops = new Map<string, { version: number; k: number; ground: Ground | null; at: { x: number; y: number; rx: number; ry: number } }>();

  resize(width: number, height: number) {
    if (width === this.width && height === this.height && this.ground) return;
    this.width = width;
    this.height = height;
    this.keepOff();
    this.grid = gridOf(width, height);
    this.ground = layGround(width, height, this.hiveSide());
    // The small bees, fewer in a small window, each on a flower of the new ground or about it.
    const n = clamp(Math.round((width * height) / 46000), 8, 30);
    this.drones = Array.from({ length: n }, (_, i) => this.drones[i] ?? this.newDrone());
    for (const d of this.drones) this.settleDrone(d);
    // A new ground: every bee finds its place on it again.
    for (const b of this.bees) {
      b.flower = -1;
      b.dance = null;
      b.landed = false;
      b.placed = false;
      b.x = clamp(b.x, 0, width);
      b.y = clamp(b.y, 0, height);
    }
  }

  /** The lower corner the hive stands in: the one fewer tiles cover. */
  private hiveSide(): "left" | "right" {
    const g = gridOf(this.width, this.height);
    const w = Math.max(13, Math.min(25, Math.round(g.cols * 0.105))) * g.cw + 8 * g.cw;
    const h = Math.round(w * 0.75);
    const under = (x0: number) => this.boxes.reduce((s, b) => s + Math.max(0, Math.min(b.x1, x0 + w) - Math.max(b.x0, x0)) * Math.max(0, Math.min(b.y1, this.height) - Math.max(b.y0, this.height - h)), 0);
    return under(this.width - w) < under(0) ? "right" : "left";
  }

  setTiles(tiles: readonly WallpaperTile[]) {
    this.tiles = tiles;
    this.tileOf = new Map();
    for (const t of tiles) if (t.id) this.tileOf.set(t.id, t);
    this.keepOff();
  }

  /** The tiles to keep out from under, for the window's size. */
  private keepOff() {
    const half = this.width * this.height * 0.5;
    this.boxes = this.tiles.filter((t) => (t.x1 - t.x0) * (t.y1 - t.y0) < half);
    this.tilesVersion++;
  }

  /** The agents' bees. `instant`, for the first picture or a still one: none flies in or home;
   *  each is put where its state has it. */
  setCreatures(creatures: readonly WallpaperCreature[], instant: boolean) {
    const want = new Map(creatures.map((c) => [c.id, c]));
    if (instant) {
      this.bees = this.bees.filter((b) => want.has(b.id));
      this.forget();
    }
    for (const b of this.bees) {
      const c = want.get(b.id);
      if (!c) {
        if (!b.leaving) this.lift(b);
        b.leaving = true;
        continue;
      }
      want.delete(b.id);
      b.species = speciesOf(c.kind);
      b.size = c.size;
      b.leaving = false;
      if (c.state !== b.state) {
        b.state = c.state;
        this.lift(b);
        b.home = false;
        b.placed = false;
        if (instant) this.place(b);
      }
    }
    for (const c of want.values()) {
      const b = this.newBee(c);
      this.bees.push(b);
      if (instant) this.place(b);
    }
    this.assignPerches();
  }

  /** Drop what was kept for bees that are gone; it is worked out again if one comes back. */
  private forget() {
    for (const id of this.danceVersion.keys()) if (!this.bees.some((b) => b.id === id)) this.danceVersion.delete(id);
    for (const id of this.loops.keys()) if (!this.bees.some((b) => b.id === id)) this.loops.delete(id);
  }

  /** Its agent finished a turn well: a quick loop, and a burst of pollen at its end. */
  done(id: string) {
    const b = this.bees.find((x) => x.id === id && !x.leaving);
    if (!b) return;
    this.lift(b);
    b.loop = LOOP;
    b.loopAt = { x: b.x, y: b.y - this.loopRadius() };
  }

  /** A click in the open: the small bees near it scatter. */
  scatter(x: number, y: number) {
    const reach = 190;
    for (const d of this.drones) {
      if (d.inside) continue;
      const dist = Math.hypot(d.x - x, d.y - y);
      if (dist > reach) continue;
      const a = dist > 0.5 ? Math.atan2(d.y - y, d.x - x) : rand(0, TAU);
      const v = 260 * (1 - dist / reach) + 90;
      d.vx = Math.cos(a) * v;
      d.vy = Math.sin(a) * v;
      d.flee = rand(1.1, 1.6);
      d.landed = false;
      d.flower = -1;
    }
  }

  /** The bee under a point, or null: generously, the cells it is drawn in and a cell round them. */
  beeAt(x: number, y: number): string | null {
    let best: string | null = null;
    let bestD = Infinity;
    for (const b of this.bees) {
      if (b.leaving) continue;
      const box = this.boxOf(b, Math.max(10, this.grid.cw * 1.25));
      if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < bestD) {
        bestD = d;
        best = b.id;
      }
    }
    return best;
  }

  /** The cells a bee is drawn in, in pixels, `pad` more on every side. */
  boxOf(b: Bee, pad = 0): Box {
    const { cw, ch } = this.grid;
    const s = SHAPES[b.species];
    const ax = b.facing > 0 ? s.anchor.dx : s.w - 1 - s.anchor.dx;
    const c0 = Math.floor(b.x / cw) - ax;
    const r0 = Math.floor(b.y / ch) - s.anchor.dy;
    return { x0: c0 * cw - pad, y0: r0 * ch - pad, x1: (c0 + s.w) * cw + pad, y1: (r0 + s.h) * ch + pad };
  }

  /** The middle of a creature's hover loop near the hive, by its place among the ready bees: over
   *  the hive toward the meadow, or the nearest place along and up from there that no tile covers.
   *  Worked out again only when the tiles or the ground change. */
  private loopCentre(b: Bee) {
    let k = 0;
    for (const x of this.bees) {
      if (x === b) break;
      if (x.state === "ready" && !x.leaving) k++;
    }
    const kept = this.loops.get(b.id);
    if (kept && kept.version === this.tilesVersion && kept.k === k && kept.ground === this.ground) return kept.at;
    const g = this.ground!.where;
    const { cw, ch } = this.grid;
    const reach = Math.max(70, g.w * cw * 0.55);
    const rx = reach * 0.75;
    const ry = ch * 2.2;
    const x = g.cx * cw + g.open * (g.w * cw * 0.35 + (k % 3) * reach * 0.5);
    const y = (g.top - 4 - Math.floor(k / 3) * 3) * ch - (k % 2) * ch * 1.5;
    const pad = cw * 4;
    const clear = (cx: number, cy: number) => cx - rx - pad > 0 && cx + rx + pad < this.width && cy - ry - ch * 2 > 0
      && !this.boxes.some((t) => cx - rx - pad < t.x1 && cx + rx + pad > t.x0 && cy - ry - ch * 2 < t.y1 && cy + ry + ch * 2 > t.y0);
    let at = { x, y, rx, ry };
    for (let j = 0; j < 12; j++) {
      const cx = x + g.open * (j % 4) * reach * 0.6;
      const cy = y - Math.floor(j / 4) * ch * 6;
      if (clear(cx, cy)) {
        at = { x: cx, y: cy, rx, ry };
        break;
      }
    }
    this.loops.set(b.id, { version: this.tilesVersion, k, ground: this.ground, at });
    return at;
  }

  private loopRadius() {
    return Math.max(14, this.grid.cw * 2.2);
  }

  /** Where a bee that is ready is on its loop at time `t`: a lazy figure of eight. */
  private loopPoint(b: Bee, t: number) {
    const c = this.loopCentre(b);
    const a = t * 0.55 + b.phase;
    return { x: c.x + c.rx * Math.sin(a), y: c.y + c.ry * Math.sin(2 * a) + Math.sin(t * 0.21 + b.phase) * this.grid.ch };
  }

  /** Where a bee that needs you dances: beside its own tile, on the side with the most room, in a
   *  place no other tile covers; by the hive door when its tile is not in sight. */
  danceOf(b: Bee): Dance {
    const { cw, ch } = this.grid;
    const W = this.width;
    const H = this.height;
    const len = clamp(cw * 6, 40, 78);
    const across = len * 0.5 + ch * 2;
    const s = SHAPES[b.species];
    const half = (s.w / 2 + 1) * cw;
    const tile = this.tileOf.get(b.id);
    if (!tile) {
      const g = this.ground!.where;
      const y = (g.top - 2) * ch;
      const near = g.door.x + g.open * (g.w * cw * 0.5 + half);
      const far = near + g.open * len;
      return { from: { x: far, y }, to: { x: near, y }, side: "hive", box: { x0: Math.min(near, far) - half, y0: y - across, x1: Math.max(near, far) + half, y1: y + across } };
    }
    const others = this.boxes.filter((t) => t.id !== b.id);
    const gap = cw * 1.5 + half;
    // How far each side is open: to the window's edge or the nearest tile across its way.
    const room = {
      right: Math.min(W - tile.x1, ...others.filter((o) => o.x0 >= tile.x1 - 1 && o.y0 < tile.y1 && o.y1 > tile.y0).map((o) => o.x0 - tile.x1)),
      left: Math.min(tile.x0, ...others.filter((o) => o.x1 <= tile.x0 + 1 && o.y0 < tile.y1 && o.y1 > tile.y0).map((o) => tile.x0 - o.x1)),
      bottom: Math.min(H - tile.y1, ...others.filter((o) => o.y0 >= tile.y1 - 1 && o.x0 < tile.x1 && o.x1 > tile.x0).map((o) => o.y0 - tile.y1)),
      top: Math.min(tile.y0, ...others.filter((o) => o.y1 <= tile.y0 + 1 && o.x0 < tile.x1 && o.x1 > tile.x0).map((o) => tile.y0 - o.y1)),
    };
    const sides = (Object.keys(room) as (keyof typeof room)[]).sort((p, q) => room[q] - room[p]);
    let best: Dance | null = null;
    let bestRoom = -Infinity;
    const margin = 6;
    for (const side of sides) {
      const flat = side === "left" || side === "right";
      // Along its side: near its top first, where the eye starts reading a tile, then lower.
      const along = flat ? [0.22, 0.45, 0.7, 0.1, 0.9] : [0.5, 0.3, 0.7, 0.12, 0.88];
      for (const k of along) {
        let from: { x: number; y: number };
        let to: { x: number; y: number };
        if (flat) {
          const y = clamp(tile.y0 + (tile.y1 - tile.y0) * k, across + margin, H - across - margin);
          const near = side === "right" ? tile.x1 + gap : tile.x0 - gap;
          const dir = side === "right" ? 1 : -1;
          to = { x: near, y };
          from = { x: near + dir * len, y };
        } else {
          const x = clamp(tile.x0 + (tile.x1 - tile.x0) * k, across + margin, W - across - margin);
          const near = side === "bottom" ? tile.y1 + gap : tile.y0 - gap;
          const dir = side === "bottom" ? 1 : -1;
          to = { x, y: near };
          from = { x, y: near + dir * len };
        }
        const box = flat
          ? { x0: Math.min(from.x, to.x) - half, y0: from.y - across, x1: Math.max(from.x, to.x) + half, y1: from.y + across }
          : { x0: from.x - across - half * 0.5, y0: Math.min(from.y, to.y) - ch * 2, x1: from.x + across + half * 0.5, y1: Math.max(from.y, to.y) + ch * 2 };
        const inside = box.x0 >= margin && box.y0 >= margin && box.x1 <= W - margin && box.y1 <= H - margin;
        const clear = inside && !this.boxes.some((t) => box.x0 < t.x1 + 4 && box.x1 > t.x0 - 4 && box.y0 < t.y1 + 4 && box.y1 > t.y0 - 4);
        const d: Dance = { from, to, side, box };
        if (clear) return d;
        // None clear: the one least covered.
        const covered = this.boxes.reduce((sum, t) => sum + Math.max(0, Math.min(box.x1, t.x1) - Math.max(box.x0, t.x0)) * Math.max(0, Math.min(box.y1, t.y1) - Math.max(box.y0, t.y0)), 0);
        const score = -covered - (inside ? 0 : 1e6);
        if (score > bestRoom) {
          bestRoom = score;
          best = d;
        }
      }
    }
    return best!;
  }

  /** Where its dance has it `t` seconds in, and the waggle across its run. */
  private dancePoint(b: Bee, d: Dance, t: number) {
    const round = Math.floor(t / ROUND);
    const u = (t % ROUND) / ROUND;
    const dx = d.to.x - d.from.x;
    const dy = d.to.y - d.from.y;
    const len = Math.hypot(dx, dy) || 1;
    const along = { x: dx / len, y: dy / len };
    const across = { x: -along.y, y: along.x };
    if (u < RUN) {
      const k = u / RUN;
      // The waggle: shaken side to side, some thirteen times a second, a cell each way.
      const w = Math.sin((t + b.phase) * TAU * 6.5) >= 0 ? 1 : -1;
      return { x: d.from.x + dx * k, y: d.from.y + dy * k, shake: { x: across.x * w, y: across.y * w }, toward: along };
    }
    // Back round to the start, by one side and then the other.
    const k = (u - RUN) / (1 - RUN);
    const turn = round % 2 ? 1 : -1;
    const a = Math.PI * k;
    const r = len / 2;
    const mid = { x: (d.from.x + d.to.x) / 2, y: (d.from.y + d.to.y) / 2 };
    return {
      x: mid.x + along.x * r * Math.cos(a) + across.x * turn * r * 0.9 * Math.sin(a),
      y: mid.y + along.y * r * Math.cos(a) + across.y * turn * r * 0.9 * Math.sin(a),
      shake: { x: 0, y: 0 },
      toward: null,
    };
  }

  /** The flowers no tile covers. */
  private openFlowers(): number[] {
    const g = this.ground;
    if (!g) return [];
    const out: number[] = [];
    g.flowers.forEach((f, i) => {
      const h = headOf(f, this.grid, this.time);
      if (!this.covered(h.x, h.y, 10)) out.push(i);
    });
    return out;
  }

  private covered(x: number, y: number, pad: number) {
    for (const b of this.boxes) if (x > b.x0 - pad && x < b.x1 + pad && y > b.y0 - pad && y < b.y1 + pad) return true;
    return false;
  }

  /** A flower for a bee at (x, y) to go to next: one of the nearer open ones, not `not`, and not
   *  one another agent's bee is on or going to. */
  private nextFlower(x: number, y: number, not: number, busy: ReadonlySet<number>): number {
    const g = this.ground!;
    const open = this.openFlowers().filter((i) => i !== not && !busy.has(i));
    if (!open.length) return -1;
    const near = open
      .map((i) => {
        const h = headOf(g.flowers[i]!, this.grid, this.time);
        return { i, d: Math.hypot(h.x - x, h.y - y) };
      })
      .sort((p, q) => p.d - q.d)
      .slice(0, 5);
    return near[Math.floor(Math.random() * near.length)]!.i;
  }

  private busyFlowers(except: Bee | null) {
    return new Set(this.bees.filter((b) => b !== except && b.state === "working" && b.flower >= 0).map((b) => b.flower));
  }

  /** Where a bee lands on a flower: on its head, its feet on the petals. */
  private landingOn(f: Flower) {
    const h = headOf(f, this.grid, this.time);
    return { x: h.x, y: h.y - this.grid.ch };
  }

  private newBee(c: WallpaperCreature): Bee {
    const door = this.ground?.where.door ?? { x: this.width / 2, y: this.height };
    return {
      id: c.id, species: speciesOf(c.kind), size: c.size, state: c.state, leaving: false,
      x: door.x, y: door.y, vx: 0, vy: -60, facing: this.ground?.where.open ?? 1, phase: rand(0, 10),
      landed: false, stay: 0, flower: -1, pollen: 0, home: false, perch: 0,
      dance: null, danceAt: -1, shake: { x: 0, y: 0 }, loop: 0, loopAt: { x: 0, y: 0 }, call: c.state === "needs-you" ? 1 : 0,
      trail: 0, placed: false,
    };
  }

  /** Off whatever it was on, to fly again. */
  private lift(b: Bee) {
    b.landed = false;
    b.stay = 0;
    b.dance = null;
    b.danceAt = -1;
    b.shake = { x: 0, y: 0 };
    if (b.state !== "working") b.flower = -1;
  }

  /** Each resting bee its own place on the hive, kept while it rests. */
  private assignPerches() {
    const n = this.ground?.where.perches.length ?? 8;
    const taken = new Set<number>();
    const resting = this.bees.filter((b) => b.state === "resting" && !b.leaving);
    for (const b of resting) if (b.perch < n && !taken.has(b.perch) && b.landed) taken.add(b.perch);
    for (const b of resting) {
      if (b.landed && taken.has(b.perch)) continue;
      let k = 0;
      while (taken.has(k) && k < n - 1) k++;
      b.perch = k;
      taken.add(k);
    }
  }

  /** Put a bee where its state has it, at once: for the first picture and a still one. */
  private place(b: Bee) {
    const g = this.ground;
    if (!g) return;
    b.placed = true;
    b.landed = false;
    b.vx = b.vy = 0;
    b.loop = 0;
    b.shake = { x: 0, y: 0 };
    b.call = b.state === "needs-you" ? 1 : 0;
    switch (b.state) {
      case "working": {
        b.home = false;
        b.flower = this.nextFlower(this.width / 2, this.height, -1, this.busyFlowers(b));
        if (b.flower >= 0) {
          const p = this.landingOn(g.flowers[b.flower]!);
          b.x = p.x;
          b.y = p.y;
          b.landed = true;
          b.stay = rand(0.5, 3);
          b.pollen = rand(0.1, 0.8);
        } else {
          b.x = this.width / 2;
          b.y = this.height * 0.6;
        }
        return;
      }
      case "ready": {
        const p = this.loopPoint(b, this.time);
        b.x = p.x;
        b.y = p.y;
        return;
      }
      case "needs-you": {
        b.dance = this.danceOf(b);
        this.danceVersion.set(b.id, this.tilesVersion);
        b.danceAt = rand(0, ROUND);
        const p = this.dancePoint(b, b.dance, b.danceAt);
        b.x = p.x;
        b.y = p.y;
        b.shake = p.shake;
        b.facing = p.toward ? (p.toward.x < 0 ? -1 : 1) : b.facing;
        return;
      }
      case "resting": {
        this.assignPerches();
        const p = g.where.perches[b.perch] ?? g.where.door;
        b.x = p.x;
        b.y = p.y;
        b.landed = true;
        b.facing = b.perch % 2 ? -1 : 1;
        return;
      }
    }
  }

  /** The still frame: each bee that is not where its state has it is put there, and nothing else
   *  moves, so a picture changes only where something changed. A bee is where it belongs when it
   *  is gathering on a flower in the open, on its loop by the hive, dancing at its tile's current
   *  place, or sitting on its perch. */
  settle() {
    this.bees = this.bees.filter((b) => !b.leaving);
    this.forget();
    this.grains = [];
    this.puffs = [];
    this.assignPerches();
    for (const b of this.bees) if (!this.settled(b)) this.place(b);
    for (const d of this.drones) {
      if (d.inside) continue;
      if (d.flee > 0 || this.covered(d.x, d.y, 4)) this.settleDrone(d);
    }
  }

  private settled(b: Bee): boolean {
    if (!b.placed || b.loop > 0) return false;
    const g = this.ground!;
    switch (b.state) {
      case "working": {
        if (!b.landed || b.home || b.flower < 0) return false;
        const h = headOf(g.flowers[b.flower]!, this.grid, this.time);
        return !this.covered(h.x, h.y, 4);
      }
      case "ready": {
        const p = this.loopPoint(b, this.time);
        return Math.hypot(p.x - b.x, p.y - b.y) < this.grid.cw * 6 && !this.covered(b.x, b.y, 4);
      }
      case "needs-you": {
        if (!b.dance || b.danceAt < 0) return false;
        const d = this.danceOf(b);
        return Math.hypot(d.from.x - b.dance.from.x, d.from.y - b.dance.from.y) <= 4;
      }
      case "resting": {
        const p = g.where.perches[b.perch];
        return b.landed && !!p && p.x === b.x && p.y === b.y;
      }
    }
  }

  private newDrone(): Drone {
    return { x: 0, y: 0, vx: 0, vy: 0, phase: rand(0, 10), flower: -1, stay: 0, inside: false, home: false, flee: 0, landed: false };
  }

  /** A small bee on a flower, or about the meadow. */
  private settleDrone(d: Drone) {
    const open = this.openFlowers();
    d.flee = 0;
    d.inside = false;
    d.home = false;
    d.vx = d.vy = 0;
    if (open.length && Math.random() < 0.55) {
      d.flower = open[Math.floor(Math.random() * open.length)]!;
      const p = this.landingOn(this.ground!.flowers[d.flower]!);
      d.x = p.x;
      d.y = p.y + this.grid.ch * 0.5;
      d.landed = true;
      d.stay = rand(0.5, 4);
    } else {
      d.flower = -1;
      d.landed = false;
      for (let i = 0; i < 8; i++) {
        d.x = rand(this.width * 0.05, this.width * 0.95);
        d.y = rand(this.height * 0.55, this.height * 0.9);
        if (!this.covered(d.x, d.y, 8)) break;
      }
    }
  }

  step(dt: number) {
    if (!this.ground) return;
    this.time += dt;
    for (const b of this.bees) this.fly(b, dt);
    if (this.bees.some((b) => b.leaving && b.landed)) {
      this.bees = this.bees.filter((b) => !(b.leaving && b.landed));
      this.forget();
    }
    for (const d of this.drones) this.drift(d, dt);
    this.fall(dt);
  }

  /** Accelerate (x, y) toward a goal at `speed`, slowing near it, never flying quite straight,
   *  kept out from under the tiles. */
  private steer(o: { x: number; y: number; vx: number; vy: number; phase: number }, goal: { x: number; y: number }, speed: number, dt: number, avoid: boolean, grip = 2.6) {
    const far = Math.hypot(goal.x - o.x, goal.y - o.y) || 1;
    // A tile in the way: over it, by its corner on the goal's side.
    const way = avoid ? this.wayTo(o, goal) : goal;
    const gx = way.x - o.x;
    const gy = way.y - o.y;
    const slow = way === goal ? clamp(far / 70, 0.1, 1) : 1;
    const wobble = Math.sin(this.time * 3.3 + o.phase * 1.7) * 0.5 * clamp(far / 120, 0, 1);
    const a = Math.atan2(gy, gx) + wobble;
    let ax = (Math.cos(a) * speed * slow - o.vx) * grip;
    let ay = (Math.sin(a) * speed * slow - o.vy) * grip;
    if (avoid) {
      for (const b of this.boxes) {
        const dx = o.x < b.x0 ? o.x - b.x0 : o.x > b.x1 ? o.x - b.x1 : 0;
        const dy = o.y < b.y0 ? o.y - b.y0 : o.y > b.y1 ? o.y - b.y1 : 0;
        if (dx === 0 && dy === 0) {
          // Under one: out by its nearest side.
          const near = Math.min(o.x - b.x0, b.x1 - o.x, o.y - b.y0, b.y1 - o.y);
          if (near === o.x - b.x0) ax -= 500;
          else if (near === b.x1 - o.x) ax += 500;
          else if (near === o.y - b.y0) ay -= 500;
          else ay += 500;
          continue;
        }
        const d = Math.hypot(dx, dy);
        if (d < 22) {
          ax += (dx / d) * (1 - d / 22) * 380;
          ay += (dy / d) * (1 - d / 22) * 380;
        }
      }
    }
    const W = this.width;
    const H = this.height;
    if (o.x < 12) ax += 240;
    if (o.x > W - 12) ax -= 240;
    if (o.y < 12) ay += 240;
    if (o.y > H - 6) ay -= 240;
    o.vx += ax * dt;
    o.vy += ay * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    return far;
  }

  /** The first tile the straight way from `a` to `b` passes under, or null. */
  private blockedBy(a: { x: number; y: number }, b: { x: number; y: number }): WallpaperTile | null {
    for (let k = 1; k < 8; k++) {
      const x = a.x + ((b.x - a.x) * k) / 8;
      const y = a.y + ((b.y - a.y) * k) / 8;
      for (const t of this.boxes) if (x > t.x0 - 4 && x < t.x1 + 4 && y > t.y0 - 4 && y < t.y1 + 4) return t;
    }
    return null;
  }

  /** Where to head for `goal` from `o`: the goal, when the way is open; else round the first tile
   *  in the way, by one of its corners: over it on the goal's side, over it on its own, then under
   *  it, the first that no tile covers and that it can reach in the open. */
  private wayTo(o: { x: number; y: number }, goal: { x: number; y: number }) {
    const t = this.blockedBy(o, goal);
    if (!t) return goal;
    const m = this.grid.cw * 3;
    const mid = (t.x0 + t.x1) / 2;
    const theirs = goal.x < mid ? t.x0 - m : t.x1 + m;
    const own = o.x < mid ? t.x0 - m : t.x1 + m;
    const corners = [{ x: theirs, y: t.y0 - m }, { x: own, y: t.y0 - m }, { x: theirs, y: t.y1 + m }, { x: own, y: t.y1 + m }]
      .filter((p) => p.x > 8 && p.x < this.width - 8 && p.y > 8 && p.y < this.height - 8 && !this.covered(p.x, p.y, 4));
    return corners.find((p) => !this.blockedBy(o, p)) ?? corners[0] ?? goal;
  }

  private face(b: Bee) {
    if (b.vx > 8) b.facing = 1;
    else if (b.vx < -8) b.facing = -1;
  }

  private fly(b: Bee, dt: number) {
    const g = this.ground!;
    b.call = clamp(b.call + (b.state === "needs-you" && !b.leaving ? dt : -dt) * 1.5, 0, 1);
    // A turn's loop: once round, quickly, then a burst of pollen.
    if (b.loop > 0) {
      b.loop -= dt;
      const r = this.loopRadius();
      const a = Math.PI / 2 + TAU * (1 - Math.max(0, b.loop) / LOOP) * b.facing;
      const nx = b.loopAt.x + Math.cos(a) * r;
      const ny = b.loopAt.y + Math.sin(a) * r;
      b.vx = (nx - b.x) / dt;
      b.vy = (ny - b.y) / dt;
      b.x = nx;
      b.y = ny;
      if (b.loop <= 0) {
        b.loop = 0;
        this.burst(b.x, b.y);
      }
      return;
    }
    if (b.leaving) {
      if (this.steer(b, g.where.door, 160, dt, false) < 5) b.landed = true;
      this.face(b);
      return;
    }
    switch (b.state) {
      case "working": return this.gather(b, dt);
      case "ready": {
        this.steer(b, this.loopPoint(b, this.time), SPEED.ready * (0.85 + 0.3 * b.size), dt, true, 2);
        this.face(b);
        return;
      }
      case "needs-you": return this.waggle(b, dt);
      case "resting": {
        if (b.landed) return;
        const p = g.where.perches[b.perch] ?? g.where.door;
        if (this.steer(b, p, SPEED.resting, dt, false, 3.2) < 3) {
          b.x = p.x;
          b.y = p.y;
          b.vx = b.vy = 0;
          b.landed = true;
        }
        this.face(b);
        return;
      }
    }
  }

  /** Working: to a flower, a while on it gathering, the next; a full load home to the hive. */
  private gather(b: Bee, dt: number) {
    const g = this.ground!;
    if (b.landed) {
      b.stay -= dt;
      if (b.home) {
        b.pollen = Math.max(0, b.pollen - dt * 1.2);
        b.x = g.where.door.x;
      } else if (b.flower >= 0) {
        const p = this.landingOn(g.flowers[b.flower]!);
        b.x = p.x;
        b.y = p.y + Math.sin(this.time * 5 + b.phase) * 0.8;
        b.pollen = Math.min(1, b.pollen + dt * 0.09);
        // Pushed off a flower a tile now covers.
        if (this.covered(p.x, p.y, 4)) b.stay = 0;
      }
      if (b.stay > 0) return;
      b.landed = false;
      if (b.home) b.home = false;
      else if (b.pollen >= 0.95) b.home = true;
      b.flower = b.home ? -1 : this.nextFlower(b.x, b.y, b.flower, this.busyFlowers(b));
      b.vy = -40;
      return;
    }
    if (!b.home) {
      const h = b.flower >= 0 ? headOf(g.flowers[b.flower]!, this.grid, this.time) : null;
      if (!h || this.covered(h.x, h.y, 4)) b.flower = this.nextFlower(b.x, b.y, b.flower, this.busyFlowers(b));
    }
    const goal = b.home ? g.where.door : b.flower >= 0 ? this.landingOn(g.flowers[b.flower]!) : this.loopPoint(b, this.time);
    const far = this.steer(b, goal, SPEED.working * (0.85 + 0.3 * b.size), dt, true, 2.8);
    this.face(b);
    // Laden, it lets a grain of pollen fall now and then.
    b.trail -= dt;
    if (b.pollen > 0.35 && b.trail <= 0) {
      b.trail = rand(0.12, 0.3);
      this.grains.push({ x: b.x - b.facing * this.grid.cw * 2, y: b.y + this.grid.ch, vx: rand(-6, 6), vy: rand(4, 16), age: 0, life: rand(0.5, 0.9), glyph: "." });
    }
    if ((b.home || b.flower >= 0) && far < 5) {
      b.landed = true;
      b.vx = b.vy = 0;
      b.x = goal.x;
      b.y = goal.y;
      b.stay = b.home ? 1 : rand(1.4, 3.2);
    }
  }

  /** Needs you: to the open side of its tile, and the waggle dance there till it is answered. */
  private waggle(b: Bee, dt: number) {
    if (!b.dance || this.danceVersion.get(b.id) !== this.tilesVersion) {
      const d = this.danceOf(b);
      this.danceVersion.set(b.id, this.tilesVersion);
      // Moved: fly to the new place; the same place, dance on.
      if (!b.dance || Math.hypot(d.from.x - b.dance.from.x, d.from.y - b.dance.from.y) > 4) {
        b.dance = d;
        b.danceAt = -1;
      }
    }
    const d = b.dance!;
    if (b.danceAt < 0) {
      b.shake = { x: 0, y: 0 };
      if (this.steer(b, d.from, SPEED["needs-you"] * (0.85 + 0.3 * b.size), dt, true, 3) < 8) b.danceAt = 0;
      this.face(b);
      return;
    }
    b.danceAt += dt;
    const p = this.dancePoint(b, d, b.danceAt);
    b.vx = (p.x - b.x) / dt;
    b.vy = (p.y - b.y) / dt;
    b.x = p.x;
    b.y = p.y;
    b.shake = p.shake;
    if (p.toward) b.facing = p.toward.x < -0.01 ? -1 : p.toward.x > 0.01 ? 1 : b.facing;
    else this.face(b);
  }

  /** The burst of pollen at the end of a turn's loop. */
  private burst(x: number, y: number) {
    const glyphs = [".", "*", "'", ",", "o", "*"];
    this.puffs.push({ x, y, age: 0 });
    for (let i = 0; i < 30; i++) {
      const a = rand(0, TAU);
      const v = rand(35, 120);
      this.grains.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, age: 0, life: rand(1, 1.8), glyph: glyphs[i % glyphs.length]! });
    }
  }

  private fall(dt: number) {
    if (this.puffs.length) {
      for (const p of this.puffs) p.age += dt;
      this.puffs = this.puffs.filter((p) => p.age < PUFF);
    }
    if (!this.grains.length) return;
    for (const p of this.grains) {
      p.age += dt;
      p.vy += 110 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.2 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.grains = this.grains.filter((p) => p.age < p.life);
  }

  /** A small bee: flower to flower, now and then home for a while; scattered, it flees. */
  private drift(d: Drone, dt: number) {
    const g = this.ground!;
    if (d.inside) {
      d.stay -= dt;
      if (d.stay > 0) return;
      d.inside = false;
      d.x = g.where.door.x;
      d.y = g.where.door.y;
      d.vy = -50;
      d.vx = g.where.open * 30;
      d.flower = -1;
      return;
    }
    if (d.flee > 0) {
      d.flee -= dt;
      d.vx *= 1 - 1.4 * dt;
      d.vy *= 1 - 1.4 * dt;
      d.x = clamp(d.x + d.vx * dt, 2, this.width - 2);
      d.y = clamp(d.y + d.vy * dt, 2, this.height - 2);
      return;
    }
    if (d.landed) {
      d.stay -= dt;
      if (d.flower >= 0) {
        const p = this.landingOn(g.flowers[d.flower]!);
        d.x = p.x;
        d.y = p.y + this.grid.ch * 0.5;
      }
      if (d.stay > 0 && !(this.pointer.over && Math.hypot(d.x - this.pointer.x, d.y - this.pointer.y) < 40)) return;
      d.landed = false;
      d.vy = -30;
      d.home = Math.random() < 0.12;
      d.flower = d.home ? -1 : this.nextFlower(d.x, d.y, d.flower, new Set());
      return;
    }
    if (!d.home && d.flower < 0) d.flower = this.nextFlower(d.x, d.y, -1, new Set());
    const goal = d.home ? g.where.door : d.flower >= 0 ? { x: this.landingOn(g.flowers[d.flower]!).x, y: this.landingOn(g.flowers[d.flower]!).y + this.grid.ch * 0.5 } : { x: this.width / 2, y: this.height * 0.7 };
    const far = this.steer(d, goal, 55, dt, true, 2.2);
    // Away from the pointer.
    if (this.pointer.over) {
      const px = d.x - this.pointer.x;
      const py = d.y - this.pointer.y;
      const dist = Math.hypot(px, py);
      if (dist < 60 && dist > 0.5) {
        d.vx += (px / dist) * 600 * dt;
        d.vy += (py / dist) * 600 * dt;
      }
    }
    if (far < 4) {
      if (d.home) {
        d.inside = true;
        d.home = false;
        d.stay = rand(2, 7);
      } else if (d.flower >= 0) {
        d.landed = true;
        d.vx = d.vy = 0;
        d.stay = rand(1, 4);
      }
    }
  }
}
