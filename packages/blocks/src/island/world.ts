/**
 * Block Island's life, apart from any canvas: the island (land.ts) fitted to the window, its sheep
 * and hens going about their day (wandering block by block, grazing or pecking, hopping up and down
 * a block), clouds drifting past above and below it, smoke from the cottage's chimney, gusts that
 * rustle the trees and shake a leaf loose now and then.
 *
 * The pointer resting on the island (or the sky beside it) draws the animals nearest it over: they
 * wander to it and stand round it, facing it. A click on the island pops a block out of the ground
 * with a puff of crumbs; a little later the block grows back, or a sapling sprouts there and grows
 * into a tree (while there are fewer trees than the island holds). A click on water splashes; a
 * click on a tree shakes leaves from it; a click in the sky puffs out a small cloud.
 */
import type { Sim } from "../scene";
import { groundAt, screenX, screenY, type Iso } from "../iso";
import { clamp, pickOne, rand, randInt, TAU } from "../rng";
import { at, inFrontOfCottage, islandSize, makeLand, Mat, topAt, TREE_SHAPES, type Land } from "./land";

export type Kind = "sheep" | "hen";
/** What an animal is doing: walking somewhere, grazing (a hen pecking), standing, looking at the
 *  pointer, or getting out of the way of a block that popped under it. */
export type Habit = "walk" | "graze" | "idle" | "look";
/** Which way it faces: +x, +y, -x, -y (the screen's lower right, lower left, upper left, upper right). */
export type Dir = 0 | 1 | 2 | 3;
const DIRS: readonly [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export interface Animal {
  id: number;
  kind: Kind;
  /** The column it is on, and the one it is stepping to (the same when it stands). */
  ci: number;
  cj: number;
  ni: number;
  nj: number;
  /** How far through the step, 0 to 1. */
  t: number;
  x: number;
  y: number;
  z: number;
  dir: Dir;
  habit: Habit;
  until: number;
  goal: { i: number; j: number } | null;
  /** Columns a second. */
  speed: number;
  /** Going to the pointer. */
  curious: boolean;
}

/** A small cube flying out of a popped block, a drop of a splash, or a leaf. */
export interface Crumb {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** What it is a crumb of: a Mat, or LEAF. */
  mat: number;
  bounces: number;
  /** Seconds since it came to rest (-1 while it moves). */
  rest: number;
  /** A leaf flutters down slowly. */
  leaf: boolean;
}
export const LEAF = 9;

/** A block popped out of the ground, rising and fading. */
export interface Pop { i: number; j: number; z: number; mat: number; age: number }
/** A hole where a block popped, and when it grows back (or a sapling sprouts in it). */
export interface Regrow { i: number; j: number; mat: number; at: number; rising: number; sapling: boolean }
/** A sapling growing into a tree, a stage at a time. */
export interface Sapling { i: number; j: number; stage: number; next: number; shape: number }
/** A cloud: where it is (CSS px), its shape, how fast it drifts, and whether it is far behind the
 *  island or low in front of it. */
export interface Cloud { x: number; y: number; shape: number; speed: number; far: boolean }
/** A puff of cloud a click made in the sky. */
export interface Puff { x: number; y: number; age: number }
/** A wisp of the chimney's smoke. */
export interface Smoke { x: number; y: number; z: number; age: number }

/** How many of each a window keeps. */
export const CAPS = { crumbs: 160, regrows: 10, saplings: 3, extraTrees: 4, puffs: 4, smoke: 8 };
/** A pop's puff: crumbs out of a block. */
const BURST = 12;
/** How long a hole waits before its block grows back. */
const REGROW: [number, number] = [3, 6];
/** Seconds between a sapling's stages. */
const STAGE = 5;
/** How long a puff in the sky lasts. */
export const PUFF_LIFE = 7;
export const SMOKE_LIFE = 4.5;
const GRAVITY = 22;

export class Island implements Sim {
  width = 0;
  height = 0;
  dpr = 1;
  time = 0;
  land!: Land;
  /** Bumped whenever the ground changes; `dirty` lists the columns that did since it was read. */
  version = 0;
  dirty: { i: number; j: number }[] = [];
  /** Where the world lands on the screen, in device pixels. */
  iso: Iso = { S: 2, HZ: 2, ox: 0, oy: 0 };
  /** The island's slow rise and fall, in device pixels. */
  bob = 0;
  animals: Animal[] = [];
  crumbs: Crumb[] = [];
  pops: Pop[] = [];
  regrows: Regrow[] = [];
  saplings: Sapling[] = [];
  clouds: Cloud[] = [];
  puffs: Puff[] = [];
  smoke: Smoke[] = [];
  /** How many trees the island started with. */
  firstTrees = 0;
  pointer = { x: 0, y: 0, active: false };
  /** Where the pointer is on the island, worked out twice a second while it rests there. */
  private focus: { i: number; j: number } | null = null;
  private focusAt = -Infinity;
  private nextId = 1;
  private smokeAt = 0;
  /** A gust crossing the island: where it is across the screen (CSS px) and when the next one comes. */
  gust = { x: -1e9, speed: 0, next: 4 };

  resize(width: number, height: number, dpr = 1) {
    const first = !this.land;
    const was = { w: this.width, h: this.height };
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    if (first) {
      this.land = makeLand(islandSize(width, height));
      this.firstTrees = this.land.trees.length;
    }
    this.fit();
    if (first) this.stockAnimals();
    else for (const c of [...this.clouds, ...this.puffs]) {
      c.x *= width / Math.max(1, was.w);
      c.y *= height / Math.max(1, was.h);
    }
    this.stockClouds(first);
    this.version++;
  }

  /** Fit the island to the window: most of its width, its top's middle about halfway down, room
   *  above for its trees and below for the rock hanging under it. */
  private fit() {
    const { n, base } = this.land;
    const s = Math.max(3, Math.min((0.74 * this.width) / (1.66 * n), (0.78 * this.height) / (0.8 * n + 7)));
    const S = Math.max(4, 2 * Math.round((s * this.dpr) / 2));
    this.iso = {
      S,
      HZ: S,
      ox: Math.round((this.width * this.dpr) / 2),
      oy: Math.round(0.52 * this.height * this.dpr - (n * S) / 2 + base * S),
    };
  }

  /** The animals, for the island's size, spread over it. */
  private stockAnimals() {
    const cells = this.walkableCells();
    const sheep = clamp(Math.round(cells.length / 45), 4, 10);
    const hens = clamp(Math.round(cells.length / 60), 3, 8);
    // Spread: the island's columns in bands from its left to its right on the screen, one animal
    // in each band, the sheep and hens shuffled among the bands.
    const kinds: Kind[] = [...Array<Kind>(sheep).fill("sheep"), ...Array<Kind>(hens).fill("hen")];
    for (let k = kinds.length - 1; k > 0; k--) {
      const r = Math.floor(Math.random() * (k + 1));
      [kinds[k], kinds[r]] = [kinds[r]!, kinds[k]!];
    }
    const order = [...cells].sort((a, b) => a.i - a.j - (b.i - b.j) || a.i - b.i);
    kinds.forEach((kind, k) => {
      // Within its band, toward the back, the middle or the front of the island in turn.
      const band = order.slice(Math.floor((k * order.length) / kinds.length), Math.floor(((k + 1) * order.length) / kinds.length)).sort((a, b) => a.i + a.j - (b.i + b.j));
      const third = band.slice(Math.floor(((k % 3) * band.length) / 3), Math.floor((((k % 3) + 1) * band.length) / 3));
      const free = (third.length ? third : band).filter((c) => !this.animals.some((a) => a.ci === c.i && a.cj === c.j));
      const c = pickOne(free.length ? free : band);
      this.animals.push(this.animal(kind, c.i, c.j));
    });
  }

  private animal(kind: Kind, i: number, j: number): Animal {
    const a: Animal = {
      id: this.nextId++, kind, ci: i, cj: j, ni: i, nj: j, t: 0, x: i + 0.5, y: j + 0.5, z: topAt(this.land, i, j),
      dir: randInt(0, 3) as Dir, habit: "idle", until: rand(0, 2), goal: null, speed: kind === "hen" ? rand(1.6, 2.1) : rand(0.8, 1.1), curious: false,
    };
    // Some start already grazing or on their way somewhere, so the first frame is not all standing.
    if (Math.random() < 0.5) this.chooseHabit(a);
    return a;
  }

  /** The columns an animal may stand on. */
  walkableCells() {
    const out: { i: number; j: number }[] = [];
    const { n } = this.land;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (this.standable(i, j)) out.push({ i, j });
    return out;
  }

  private standable(i: number, j: number) {
    const k = at(this.land, i, j);
    return k >= 0 && this.land.top[k]! >= 0 && this.land.surface[k] !== Mat.Water && !this.land.blocked[k];
  }

  /** Whether an animal on (i, j) may step to (a, b): one block up or down at most, onto ground no
   *  other animal is on or stepping to, and not into a hole waiting for its block. */
  private canStep(me: Animal, a: number, b: number) {
    if (!this.standable(a, b) || this.regrows.some((r) => r.i === a && r.j === b)) return false;
    if (Math.abs(topAt(this.land, a, b) - topAt(this.land, me.ci, me.cj)) > 1) return false;
    for (const o of this.animals) if (o !== me && ((o.ci === a && o.cj === b) || (o.ni === a && o.nj === b))) return false;
    return true;
  }

  private stockClouds(first: boolean) {
    const { width: W, height: H } = this;
    const far = clamp(Math.round((W * H) / 190_000), 4, 12);
    const low = clamp(Math.round(W / 170), 5, 16);
    const have = (f: boolean) => this.clouds.filter((c) => c.far === f);
    const add = (f: boolean, n: number) => {
      for (let k = 0; k < n; k++) {
        // Spread across: each in its own stretch of the width.
        const x = ((k + rand(0.1, 0.9)) / n) * (W + 240) - 120;
        this.clouds.push(f
          ? { x, y: H * rand(0.05, 0.42), shape: randInt(0, 3), speed: rand(4, 9), far: true }
          : { x, y: H * rand(0.93, 1.02), shape: randInt(0, 3), speed: rand(3, 6), far: false });
      }
    };
    if (first) {
      add(true, far);
      add(false, low);
      return;
    }
    for (const [f, want] of [[true, far], [false, low]] as const) {
      const list = have(f);
      if (list.length > want) for (const c of list.slice(want)) this.clouds.splice(this.clouds.indexOf(c), 1);
      else if (list.length < want) add(f, want - list.length);
    }
  }

  // ── the pointer and clicks ──────────────────────────────────────────────

  point(x: number, y: number, active: boolean) {
    const moved = Math.hypot(x - this.pointer.x, y - this.pointer.y) > 2;
    this.pointer = { x, y, active };
    if (moved || !active) this.focusAt = -Infinity;
    if (!active) for (const a of this.animals) if (a.curious) this.release(a);
  }

  /** The column under a point of the window (CSS px), its top or a side of it, or null for sky. */
  columnAt(x: number, y: number): { i: number; j: number } | null {
    const { land, iso } = this;
    const X = x * this.dpr;
    const Y = y * this.dpr - this.bob;
    let hi = 0;
    let lo = 1e9;
    for (let k = 0; k < land.top.length; k++) {
      if (land.top[k]! < 0) continue;
      hi = Math.max(hi, land.top[k]!);
      lo = Math.min(lo, land.bottom[k]!);
    }
    // Down the line of sight from above the highest column: the first block it meets.
    for (let z = hi; z >= lo; z -= 0.25) {
      const g = groundAt(iso, X, Y, z);
      const i = Math.floor(g.x);
      const j = Math.floor(g.y);
      const k = at(land, i, j);
      if (k < 0 || land.top[k]! < 0) continue;
      if (land.top[k]! >= z && land.bottom[k]! < z) return { i, j };
    }
    return null;
  }

  /** The island's column whose top is nearest a point of the window (CSS px). */
  nearestColumn(x: number, y: number) {
    const { land } = this;
    let best = { i: 0, j: 0 };
    let bd = Infinity;
    for (const c of this.walkableCells()) {
      const p = this.screenOf(c.i + 0.5, c.j + 0.5, land.top[at(land, c.i, c.j)]!);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /** Where a point of the world is in the window, in CSS px. */
  screenOf(x: number, y: number, z: number) {
    return { x: screenX(this.iso, x, y) / this.dpr, y: (screenY(this.iso, x, y, z) + this.bob) / this.dpr };
  }

  splash(x: number, y: number) {
    const tree = this.treeAt(x, y);
    if (tree) {
      this.shakeTree(tree.i, tree.j, TREE_SHAPES[tree.shape]!.trunk, 9);
      return;
    }
    const col = this.columnAt(x, y);
    if (!col) {
      this.puffs.push({ x, y, age: 0 });
      if (this.puffs.length > CAPS.puffs) this.puffs.shift();
      return;
    }
    const { land } = this;
    const k = at(land, col.i, col.j);
    const z = land.top[k]!;
    if (land.surface[k] === Mat.Water) {
      for (let n = 0; n < 10; n++) this.crumb(col.i + 0.5, col.j + 0.5, z - 0.1, Mat.Water, 2.2);
      return;
    }
    // Not through the island, not under what stands there, not a hole already.
    if (land.blocked[k] || z - land.bottom[k]! < 2 || this.regrows.some((r) => r.i === col.i && r.j === col.j)) {
      for (let n = 0; n < 5; n++) this.crumb(col.i + 0.5, col.j + 0.5, z, land.surface[k]!, 1.6);
      return;
    }
    if (this.regrows.length >= CAPS.regrows) this.grow(this.regrows[0]!, true);
    const mat = land.surface[k]!;
    land.top[k] = z - 1;
    land.surface[k] = mat === Mat.Stone ? Mat.Stone : Mat.Dirt;
    land.flower[k] = 0;
    this.changed(col.i, col.j);
    this.pops.push({ i: col.i, j: col.j, z: z - 1, mat, age: 0 });
    for (let n = 0; n < BURST; n++) this.crumb(col.i + 0.5, col.j + 0.5, z - 0.5, n % 3 === 0 ? Mat.Dirt : mat, 3);
    const sapling = mat === Mat.Grass && this.saplings.length < CAPS.saplings && this.land.trees.length + this.saplings.length < this.firstTrees + CAPS.extraTrees && this.roomForTree(col.i, col.j) && Math.random() < 0.6;
    this.regrows.push({ i: col.i, j: col.j, mat, at: this.time + rand(...REGROW), rising: 0, sapling });
    // An animal standing there hops down into the hole and out again.
    for (const a of this.animals) if (a.ci === col.i && a.cj === col.j && a.t === 0) this.chooseHabit(a);
  }

  /** The tree whose leaves are under a point (CSS px), roughly: within its crown's round. */
  private treeAt(x: number, y: number) {
    for (const t of this.land.trees) {
      const shape = TREE_SHAPES[t.shape]!;
      const c = this.screenOf(t.i + 0.5, t.j + 0.5, this.land.base + shape.trunk + 1.2);
      const r = (2.2 * this.iso.S) / this.dpr;
      if (Math.hypot((x - c.x) / 1.15, y - c.y) < r) return t;
    }
    return null;
  }

  /** Whether a tree could grow at (i, j): on the island, the ground round it no more than a block
   *  up or down, apart from other trees and what stands, not hiding the cottage. */
  private roomForTree(i: number, j: number) {
    const { land } = this;
    // Its own column is a hole now: the block that grows back brings it to the level round it.
    const level = topAt(land, i, j) + 1;
    for (let b = -1; b <= 1; b++) {
      for (let a = -1; a <= 1; a++) {
        const k = at(land, i + a, j + b);
        if (k < 0 || land.top[k]! < 0 || land.surface[k] === Mat.Water || (land.blocked[k] && (a || b))) return false;
        if (Math.abs(land.top[k]! - level) > 1 && (a || b)) return false;
      }
    }
    if (inFrontOfCottage(land, i, j)) return false;
    return !land.trees.some((t) => Math.hypot(t.i - i, t.j - j) < 3.6) && !this.saplings.some((s) => Math.hypot(s.i - i, s.j - j) < 3.6);
  }

  private shakeTree(i: number, j: number, trunk: number, n: number) {
    for (let k = 0; k < n; k++) {
      this.crumbs.push({ x: i + 0.5 + rand(-1.8, 1.8), y: j + 0.5 + rand(-1.8, 1.8), z: this.land.base + trunk + rand(0, 2), vx: rand(-0.4, 0.4), vy: rand(-0.4, 0.4), vz: rand(0, 0.6), mat: LEAF, bounces: 0, rest: -1, leaf: true });
    }
    this.capCrumbs();
  }

  private crumb(x: number, y: number, z: number, mat: number, power: number) {
    const a = rand(0, TAU);
    const v = rand(0.4, 1) * power * 0.6;
    this.crumbs.push({ x, y, z, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vz: rand(0.6, 1.2) * power * 1.6, mat, bounces: 0, rest: -1, leaf: false });
    this.capCrumbs();
  }

  private capCrumbs() {
    if (this.crumbs.length > CAPS.crumbs) this.crumbs.splice(0, this.crumbs.length - CAPS.crumbs);
  }

  private changed(i: number, j: number) {
    this.version++;
    this.dirty.push({ i, j });
  }

  /** A hole's block back (rising first unless `now`), and a sapling in it if one is due. */
  private grow(r: Regrow, now: boolean) {
    if (!now && r.rising < 1) return;
    const { land } = this;
    const k = at(land, r.i, r.j);
    land.top[k] = land.top[k]! + 1;
    land.surface[k] = r.mat;
    this.changed(r.i, r.j);
    this.regrows.splice(this.regrows.indexOf(r), 1);
    if (r.sapling && !now && !this.animals.some((a) => (a.ci === r.i && a.cj === r.j) || (a.ni === r.i && a.nj === r.j))) {
      land.blocked[k] = 1;
      this.saplings.push({ i: r.i, j: r.j, stage: 0, next: this.time + STAGE, shape: randInt(0, TREE_SHAPES.length - 1) });
    }
  }

  // ── a step ───────────────────────────────────────────────────────────────

  step(dt: number) {
    this.time += dt;
    const t = this.time;
    this.bob = Math.round(Math.sin((t * TAU) / 11) * 2.5 * this.dpr);
    this.stepPointer();
    for (const a of this.animals) this.stepAnimal(a, dt);
    this.stepCrumbs(dt);
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < 0.7);
    for (const r of [...this.regrows]) {
      if (t < r.at) continue;
      // Nothing grows back under an animal: one in the hole climbs out first.
      const inHole = this.animals.find((a) => a.ci === r.i && a.cj === r.j && a.ni === r.i && a.nj === r.j);
      if (r.rising === 0 && inHole) {
        r.at = t + 0.5;
        const out = DIRS.find(([dx, dy]) => this.canStep(inHole, r.i + dx, r.j + dy));
        if (out && !inHole.curious) {
          inHole.habit = "walk";
          inHole.goal = { i: r.i + out[0], j: r.j + out[1] };
        }
        continue;
      }
      r.rising = Math.min(1, r.rising + dt / 0.6);
      this.grow(r, false);
    }
    for (const s of [...this.saplings]) {
      if (t < s.next) continue;
      s.stage++;
      s.next = t + STAGE * rand(0.8, 1.3);
      if (s.stage >= 4) {
        this.saplings.splice(this.saplings.indexOf(s), 1);
        this.land.trees.push({ i: s.i, j: s.j, shape: s.shape });
        this.changed(s.i, s.j);
      }
    }
    for (const c of this.clouds) {
      c.x += c.speed * dt;
      if (c.x > this.width + 260) c.x = -260 - rand(0, 80);
    }
    for (const p of this.puffs) { p.age += dt; p.x += 6 * dt; }
    this.puffs = this.puffs.filter((p) => p.age < PUFF_LIFE);
    // The chimney's smoke.
    if (t > this.smokeAt) {
      this.smokeAt = t + rand(0.5, 0.9);
      const c = this.land.cottage;
      this.smoke.push({ x: c.i + 2.5, y: c.j + 0.5, z: this.land.base + 5, age: 0 });
      if (this.smoke.length > CAPS.smoke) this.smoke.shift();
    }
    for (const s of this.smoke) {
      s.age += dt;
      s.z += 0.45 * dt;
      s.x += 0.25 * dt;
      s.y -= 0.12 * dt;
    }
    this.smoke = this.smoke.filter((s) => s.age < SMOKE_LIFE);
    // Gusts cross the island from left to right now and then, rustling each tree as they pass.
    const g = this.gust;
    g.x += g.speed * dt;
    if (t > g.next) {
      g.x = -this.width * 0.1;
      g.speed = rand(200, 320);
      g.next = t + rand(7, 13);
    }
    if (Math.random() < dt * 0.25) {
      const tree = this.land.trees.find((tr) => Math.abs(this.screenOf(tr.i + 0.5, tr.j + 0.5, this.land.base).x - g.x) < 60);
      if (tree) this.shakeTree(tree.i, tree.j, TREE_SHAPES[tree.shape]!.trunk, 1);
    }
  }

  /** How much a gust is rustling the tree at (i, j) now, 0 to 1. */
  rustle(i: number, j: number) {
    const x = this.screenOf(i + 0.5, j + 0.5, this.land.base).x;
    const d = (x - this.gust.x) / (this.width * 0.08 + 40);
    return Math.exp(-d * d);
  }

  private stepPointer() {
    const p = this.pointer;
    if (!p.active) {
      this.focus = null;
      return;
    }
    if (this.time - this.focusAt < 0.5) return;
    this.focusAt = this.time;
    this.focus = this.columnAt(p.x, p.y) ?? this.nearestColumn(p.x, p.y);
    const f = this.focus;
    // The nearest few come over; the rest go about their business.
    const want = Math.min(4, Math.max(2, Math.ceil(this.animals.length / 3)));
    const near = [...this.animals].sort((a, b) => Math.hypot(a.x - f.i - 0.5, a.y - f.j - 0.5) - Math.hypot(b.x - f.i - 0.5, b.y - f.j - 0.5)).slice(0, want);
    for (const a of this.animals) {
      const chosen = near.includes(a);
      if (chosen && !a.curious) {
        a.curious = true;
        a.goal = null;
        a.until = 0;
      } else if (!chosen && a.curious) this.release(a);
    }
    // A place round the pointer for each of them, nearest first.
    const spots: { i: number; j: number }[] = [];
    for (let r = 1; r <= 3 && spots.length < want * 2; r++) {
      for (let b = -r; b <= r; b++) for (let a = -r; a <= r; a++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        if (this.standable(f.i + a, f.j + b)) spots.push({ i: f.i + a, j: f.j + b });
      }
    }
    for (const a of near) {
      spots.sort((s, q) => Math.hypot(s.i - a.ci, s.j - a.cj) - Math.hypot(q.i - a.ci, q.j - a.cj));
      const spot = spots.shift();
      if (!spot) continue;
      a.goal = spot;
      if (a.habit !== "walk" && (a.ci !== spot.i || a.cj !== spot.j)) a.habit = "walk";
    }
  }

  private release(a: Animal) {
    a.curious = false;
    a.goal = null;
    a.until = 0;
  }

  private chooseHabit(a: Animal) {
    const r = Math.random();
    const hen = a.kind === "hen";
    if (r < (hen ? 0.5 : 0.45)) {
      a.habit = "walk";
      const cells = this.walkableCells();
      const reach = hen ? 4 : 5;
      const near = cells.filter((c) => Math.abs(c.i - a.ci) + Math.abs(c.j - a.cj) <= reach && (c.i !== a.ci || c.j !== a.cj));
      a.goal = near.length ? pickOne(near) : null;
      a.until = this.time + 20;
    } else if (r < 0.85) {
      a.habit = "graze";
      a.until = this.time + (hen ? rand(1, 3) : rand(4, 9));
    } else {
      a.habit = "idle";
      a.until = this.time + rand(1.5, 4);
    }
  }

  private stepAnimal(a: Animal, dt: number) {
    const { land } = this;
    const moving = a.ni !== a.ci || a.nj !== a.cj;
    if (moving) {
      a.t += a.speed * dt;
      if (a.t >= 1) {
        a.ci = a.ni;
        a.cj = a.nj;
        a.t = 0;
      }
    }
    if (a.ni === a.ci && a.nj === a.cj) {
      // Standing on a column: what next.
      if (a.curious && a.goal && a.ci === a.goal.i && a.cj === a.goal.j) {
        a.habit = "look";
        const f = this.focus;
        if (f) a.dir = facing(f.i - a.ci, f.j - a.cj, a.dir);
      } else if (a.habit === "walk" && a.goal) {
        if (a.ci === a.goal.i && a.cj === a.goal.j) {
          a.goal = null;
          if (!a.curious) this.chooseHabit(a);
        } else this.stepToward(a);
      } else if (this.time >= a.until || (a.habit === "walk" && !a.goal)) {
        if (a.curious) {
          a.habit = a.goal ? "walk" : "look";
          if (a.goal) this.stepToward(a);
        } else this.chooseHabit(a);
      }
    }
    // Where it is: between the two columns, hopping when they differ.
    const z0 = topAt(land, a.ci, a.cj);
    const z1 = topAt(land, a.ni, a.nj);
    a.x = a.ci + 0.5 + (a.ni - a.ci) * a.t;
    a.y = a.cj + 0.5 + (a.nj - a.cj) * a.t;
    a.z = z0 + (z1 - z0) * clamp((a.t - 0.2) / 0.6, 0, 1) + (z0 !== z1 ? Math.sin(Math.PI * a.t) * 0.55 : 0);
  }

  /** One column on toward its goal: along whichever way is further to go, else the other. */
  private stepToward(a: Animal) {
    const g = a.goal!;
    const dx = Math.sign(g.i - a.ci);
    const dy = Math.sign(g.j - a.cj);
    const tries: [number, number][] = Math.abs(g.i - a.ci) >= Math.abs(g.j - a.cj) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
    for (const [sx, sy] of tries) {
      if (!sx && !sy) continue;
      if (this.canStep(a, a.ci + sx, a.cj + sy)) {
        a.ni = a.ci + sx;
        a.nj = a.cj + sy;
        a.t = 0;
        a.dir = facing(sx, sy, a.dir);
        return;
      }
    }
    // Blocked both ways: stand a moment, then somewhere else.
    a.goal = a.curious ? a.goal : null;
    a.habit = "idle";
    a.until = this.time + rand(0.5, 1.5);
    if (a.curious) a.goal = null;
  }

  private stepCrumbs(dt: number) {
    const { land } = this;
    for (const c of this.crumbs) {
      if (c.rest >= 0) {
        c.rest += dt;
        continue;
      }
      if (c.leaf) {
        c.vz = -0.7;
        c.vx = Math.sin(this.time * 3 + c.y * 5) * 0.5;
      } else c.vz -= GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.z += c.vz * dt;
      const ground = topAt(land, Math.floor(c.x), Math.floor(c.y));
      const floor = ground < 0 || land.surface[at(land, Math.floor(c.x), Math.floor(c.y))] === Mat.Water ? -Infinity : ground;
      if (c.z <= floor && c.vz < 0) {
        c.z = floor;
        if (c.leaf || c.bounces >= 1 || c.mat === Mat.Water) {
          c.rest = 0;
          if (c.mat === Mat.Water) c.rest = 1.1;
        } else {
          c.bounces++;
          c.vz = -c.vz * 0.35;
          c.vx *= 0.5;
          c.vy *= 0.5;
        }
      }
    }
    // Gone once rested a while, or fallen far below the island.
    this.crumbs = this.crumbs.filter((c) => c.rest < 1.6 && c.z > land.base - land.n * 0.6 - 6);
  }
}

/** The way to face for a step of (dx, dy); `was` if there is none. */
function facing(dx: number, dy: number, was: Dir): Dir {
  if (Math.abs(dx) >= Math.abs(dy) && dx) return dx > 0 ? 0 : 2;
  if (dy) return dy > 0 ? 1 : 3;
  return was;
}

export { DIRS };
