/**
 * Autumn Wood's life, apart from any canvas: leaves letting go of the crowns and tumbling down on a
 * gusting wind, side to side as a leaf falls, and piling up on the forest floor, where the pile
 * slowly settles; now and then a fox trotting or a deer stepping across the bottom of the window;
 * and fireflies low among the trunks (the renderer shows them at dusk).
 *
 * The pointer is a breeze: the falling leaves near it swirl round it, held up in the eddy, and
 * near the ground it lifts leaves off the pile. A click shakes the nearest tree: its crown sways
 * and lets go of a flurry of leaves, and a fox or deer near it bolts.
 *
 * Bounded: so many leaves in the air for the window's size (a flurry adds a few dozen more, up to a
 * cap), a pile no deeper than PILE_ROWS, one animal at a time.
 */
import { gridOf, type Grid } from "../grid";
import { clamp, noise1, noise2, rand, TAU } from "../num";
import type { Sim } from "../scene";
import { LEAF_COLOURS } from "./palette";
import { woodOf, type WoodLayout } from "./wood";

/** How deep the pile can be, in rows, and how much of a row one leaf makes. */
export const PILE_ROWS = 5;
const LEAF_DEPTH = 0.16;
/** The pile settles (the leaves under it pack down and rot) at this share of its depth a second. */
const SETTLE = 0.003;
/** How many leaves are in the air: one to each `AREA` px² of window, between MIN and MAX; and as
 *  many again at most, of the flurries clicks shake loose. */
const AREA = 14_000;
const MIN = 50;
const MAX = 200;
export const FLURRY = 36;
/** How far round the pointer its breeze reaches (px), and how fast the leaves at its heart go round. */
export const BREEZE = 210;
const SWIRL = 210;
/** How long a tree sways after a click (s). */
export const SHAKE = 1.4;

export interface Leaf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which colour (LEAF_COLOURS), and which of the leaf shapes it tumbles through. */
  colour: number;
  shape: number;
  /** Its tumble: where in it, how fast, which way. */
  spin: number;
  spinRate: number;
  /** Its side-to-side swing as it falls: where in it, how fast, how wide (px/s). */
  swing: number;
  swingRate: number;
  swingWidth: number;
  /** How fast it falls in still air. */
  fall: number;
  /** The tree it let go of, or -1 (blown in, or off the pile). */
  tree: number;
  /** Shaken loose by a click: one of the flurry, not of the leaves always in the air. */
  flurry: boolean;
}

export type Beast = "fox" | "deer";
export interface Walker {
  kind: Beast;
  x: number;
  /** 1 walking right, -1 left. */
  dir: 1 | -1;
  /** Its usual pace (px/s), and now (it eases between). */
  pace: number;
  speed: number;
  /** Its legs' step, and until when it stands still (a deer stops to look about). */
  gait: number;
  stopUntil: number;
  bolting: boolean;
}

export interface Firefly {
  x: number;
  y: number;
  heading: number;
  /** Its own blink: how often, and where in it. */
  period: number;
  offset: number;
}

export class Wood implements Sim {
  width = 0;
  height = 0;
  time = 0;
  grid: Grid = gridOf(1, 1);
  layout!: WoodLayout;
  leaves: Leaf[] = [];
  /** How many leaves are in the air but for flurries. */
  calm = 0;
  /** Per column, how deep the pile is (rows), and the colour of each leaf cell in it, bottom up. */
  pile = new Float32Array(0);
  pileColour = new Uint8Array(0);
  /** Changes each time the pile does. */
  pileVersion = 0;
  walker: Walker | null = null;
  nextWalker = 0;
  /** Which beast crossed last: the other comes next. */
  private lastBeast: Beast = "deer";
  fireflies: Firefly[] = [];
  /** Per tree, when it was last shaken. */
  shaken: number[] = [];
  pointer = { x: 0, y: 0, active: false };
  /** The wind along the window now (px/s, rightward), gusting. */
  wind = 0;
  private seed = 0x0a17;

  resize(width: number, height: number) {
    const first = this.width === 0;
    const was = { w: this.width, h: this.height, cols: this.grid.cols, pile: this.pile, colour: this.pileColour };
    this.width = width;
    this.height = height;
    this.grid = gridOf(width, height);
    this.layout = woodOf(this.grid, this.seed);
    this.shaken = this.layout.trees.map((_, i) => this.shaken[i] ?? -Infinity);
    const { cols } = this.grid;
    this.pile = new Float32Array(cols);
    this.pileColour = new Uint8Array(cols * PILE_ROWS);
    this.pileVersion++;
    if (first) {
      this.stock();
      return;
    }
    // What was there stays where it was, fitted to the new window: the leaves, the beast, the
    // fireflies by their share of it, the pile column by column.
    const sx = width / was.w;
    const sy = height / was.h;
    for (const l of this.leaves) {
      l.x *= sx;
      l.y *= sy;
    }
    for (const f of this.fireflies) {
      f.x *= sx;
      f.y *= sy;
    }
    if (this.walker) this.walker.x *= sx;
    for (let c = 0; c < cols; c++) {
      const from = Math.min(was.cols - 1, Math.floor(((c + 0.5) / cols) * was.cols));
      this.pile[c] = was.pile[from]!;
      for (let k = 0; k < PILE_ROWS; k++) this.pileColour[c * PILE_ROWS + k] = was.colour[from * PILE_ROWS + k]!;
    }
    this.restock();
  }

  /** The wood full from its first frame: leaves all through the air, a pile on the floor as deep as
   *  it settles to, a beast partway across, fireflies about. */
  private stock() {
    const { cols } = this.grid;
    this.restock();
    for (let c = 0; c < cols; c++) {
      // Deeper under the trees and in hollows of the floor.
      const under = this.layout.trees.reduce((u, t) => Math.max(u, (t.near ? 1.2 : 0.6) * Math.max(0, 1 - Math.abs(c - t.c) / (t.base * 3))), 0);
      this.pile[c] = clamp(1.2 + 2.4 * noise1(c * 0.06, this.seed) + under + rand(-0.15, 0.15), 0.6, PILE_ROWS - 0.3);
      for (let k = 0; k < PILE_ROWS; k++) this.pileColour[c * PILE_ROWS + k] = this.fallColour();
    }
    this.walker = this.newWalker(true);
    this.nextWalker = rand(20, 40);
    this.fireflies = Array.from({ length: Math.round(clamp((this.width * this.height) / 150_000, 6, 14)) }, () => ({
      x: rand(0, this.width), y: rand(this.height * 0.55, this.height * 0.85), heading: rand(0, TAU), period: rand(3, 6), offset: rand(0, 6),
    }));
  }

  /** As many leaves in the air as the window holds: a new one wherever it might be, spread over the
   *  window; a smaller window lets the last ones go. */
  private restock() {
    const want = clamp(Math.round((this.width * this.height) / AREA), MIN, MAX);
    const calm = this.leaves.filter((l) => !l.flurry);
    if (calm.length > want) {
      const drop = new Set(calm.slice(want));
      this.leaves = this.leaves.filter((l) => !drop.has(l));
    }
    for (let i = calm.length; i < want; i++) {
      const l = this.newLeaf(-1, rand(0, this.width), rand(0, this.layout.floor * this.grid.ch), false);
      // Spread over its swing and tumble, and falling already.
      l.vy = l.fall;
      this.leaves.push(l);
    }
    this.calm = want;
  }

  private fallColour() {
    // Mostly the fallen reds and browns; a gold, a green here and there.
    const r = Math.random();
    return LEAF_COLOURS.indexOf(r < 0.22 ? "brown" : r < 0.42 ? "red" : r < 0.6 ? "orange" : r < 0.75 ? "amber" : r < 0.87 ? "crimson" : r < 0.96 ? "gold" : "green");
  }

  private newLeaf(tree: number, x: number, y: number, flurry: boolean, colour = this.fallColour()): Leaf {
    return {
      x, y, vx: 0, vy: 0, colour, shape: Math.floor(Math.random() * 4),
      spin: rand(0, TAU), spinRate: rand(2.5, 7) * (Math.random() < 0.5 ? -1 : 1),
      swing: rand(0, TAU), swingRate: rand(1.3, 2.6), swingWidth: rand(18, 42), fall: rand(30, 52), tree, flurry,
    };
  }

  /** A leaf letting go: from a tree's crown (one of its own colour), or, one time in three, blown
   *  in from the side the wind comes from. */
  private letGo(l: Leaf) {
    const trees = this.layout.trees;
    if (Math.random() < 0.34) {
      Object.assign(l, this.newLeaf(-1, this.wind >= 0 ? -6 : this.width + 6, rand(0, this.layout.floor * this.grid.ch * 0.7), false));
      return;
    }
    // A bigger crown lets go of more.
    let pick = Math.random() * trees.reduce((s, t) => s + t.crown.n, 0);
    let tree = trees[0]!;
    for (tree of trees) if ((pick -= tree.crown.n) <= 0) break;
    const k = Math.floor(Math.random() * tree.crown.n);
    const { cw, ch } = this.grid;
    Object.assign(l, this.newLeaf(tree.id, (tree.crown.c[k]! + Math.random()) * cw, (tree.crown.r[k]! + Math.random()) * ch, false, tree.crown.colour[k]!));
  }

  point(x: number, y: number, active: boolean) {
    this.pointer.x = x;
    this.pointer.y = y;
    this.pointer.active = active;
  }

  /** The tree whose crown is nearest (`x`, `y`). */
  nearestTree(x: number, y: number) {
    const { cw, ch } = this.grid;
    let best = this.layout.trees[0]!;
    let bestD = Infinity;
    for (const t of this.layout.trees) {
      for (let k = 0; k < t.crown.n; k += 3) {
        const d = Math.hypot((t.crown.c[k]! + 0.5) * cw - x, (t.crown.r[k]! + 0.5) * ch - y);
        if (d < bestD) {
          bestD = d;
          best = t;
        }
      }
    }
    return best;
  }

  /** A click: the nearest tree shakes and lets go of a flurry of leaves; a beast near it bolts. */
  splash(x: number, y: number) {
    const tree = this.nearestTree(x, y);
    this.shaken[tree.id] = this.time;
    const { cw, ch } = this.grid;
    const flurry = this.leaves.filter((l) => l.flurry).length;
    // A flurry at most of the window's calm leaves, all told: the oldest of it gone first.
    const room = this.calm - flurry;
    if (room < FLURRY) {
      let drop = FLURRY - Math.max(0, room);
      this.leaves = this.leaves.filter((l) => !(l.flurry && drop-- > 0));
    }
    for (let i = 0; i < FLURRY; i++) {
      const k = Math.floor(Math.random() * tree.crown.n);
      const l = this.newLeaf(tree.id, (tree.crown.c[k]! + Math.random()) * cw, (tree.crown.r[k]! + Math.random()) * ch, true, tree.crown.colour[k]!);
      // Out from the crown, and down.
      const a = Math.atan2(l.y - tree.cy * ch, l.x - tree.cx * cw);
      const v = rand(40, 110);
      l.vx = Math.cos(a) * v;
      l.vy = Math.sin(a) * v * 0.5 + rand(10, 50);
      this.leaves.push(l);
    }
    const w = this.walker;
    if (w && Math.abs(w.x - x) < 260) {
      w.bolting = true;
      w.stopUntil = 0;
      // Away from the click.
      w.dir = w.x >= x ? 1 : -1;
    }
  }

  step(dt: number) {
    this.time += dt;
    const t = this.time;
    // The wind, rightward, gusting now and then.
    this.wind = 16 + 10 * Math.sin(t * 0.11) + 46 * Math.max(0, noise1(t * 0.22, this.seed) - 0.45);
    this.fly(dt);
    this.settle(dt);
    this.lift(dt);
    this.walk(dt);
    this.glow(dt);
  }

  private fly(dt: number) {
    const { width: W, height: H, time: t, pointer: p } = this;
    const { cw, ch } = this.grid;
    const floor = this.layout.floor;
    const k = Math.min(1, dt * 2.6);
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const l = this.leaves[i]!;
      l.spin += l.spinRate * dt;
      l.swing += l.swingRate * dt;
      const local = 0.65 + 0.7 * noise2(l.x * 0.0025 - t * 0.12, l.y * 0.004, this.seed);
      const sw = Math.cos(l.swing);
      // Into the wind, side to side as it swings, falling slowest at the ends of its swing.
      let tx = this.wind * local + sw * l.swingWidth;
      let ty = l.fall * (0.55 + 0.75 * Math.abs(Math.sin(l.swing))) + (noise2(l.x * 0.004, t * 0.3, this.seed + 1) - 0.5) * 22;
      if (p.active) {
        const dx = l.x - p.x;
        const dy = l.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < BREEZE) {
          // The eddy: round the pointer, toward a ring about it, held up against falling.
          const near = 1 - d / BREEZE;
          const hold = Math.min(1, near * 1.8);
          const s = SWIRL * Math.sqrt(near);
          const ring = (d - BREEZE * 0.4) / BREEZE;
          tx = tx * (1 - hold) + (-dy / d) * s - (dx / d) * ring * 120 * hold;
          ty = ty * (1 - hold) * 0.6 + (dx / d) * s - (dy / d) * ring * 120 * hold;
        }
      }
      l.vx += (tx - l.vx) * k;
      l.vy += (ty - l.vy) * k;
      l.x += l.vx * dt;
      l.y += l.vy * dt;
      const c = Math.floor(l.x / cw);
      // Off the side, or high off the top: it is gone; another lets go.
      if (l.x < -24 || l.x > W + 24 || l.y < -H * 0.25) {
        this.renew(i);
        continue;
      }
      if (c >= 0 && c < this.grid.cols && l.y >= (floor - this.pile[c]!) * ch && l.vy > 0) {
        this.land(c, l.colour);
        this.renew(i);
      }
    }
  }

  /** A leaf is gone (landed, or off the window): a flurry's leaf is not replaced; another of the
   *  calm ones lets go. */
  private renew(i: number) {
    const l = this.leaves[i]!;
    if (l.flurry) {
      this.leaves.splice(i, 1);
      return;
    }
    this.letGo(l);
  }

  /** A leaf lands on the pile in column `c`; a pile a leaf deeper than its neighbour spills onto it. */
  private land(c: number, colour: number) {
    const { cols } = this.grid;
    let at = c;
    for (const n of [c - 1, c + 1]) if (n >= 0 && n < cols && this.pile[n]! < this.pile[at]! - 1) at = n;
    const depth = this.pile[at]!;
    if (depth >= PILE_ROWS) return;
    this.pileColour[at * PILE_ROWS + Math.floor(depth)] = colour;
    this.pile[at] = Math.min(PILE_ROWS, depth + LEAF_DEPTH);
    this.pileVersion++;
  }

  /** The pile packs down slowly; a column much deeper than the next spills a little onto it. */
  private settle(dt: number) {
    const { cols } = this.grid;
    const pile = this.pile;
    let changed = false;
    for (let c = 0; c < cols; c++) {
      const was = pile[c]!;
      pile[c] = was - was * SETTLE * dt;
      const next = c + 1 < cols ? pile[c + 1]! : pile[c]!;
      const move = 0.4 * dt;
      if (pile[c]! - next > 1.6) {
        pile[c] = pile[c]! - move;
        pile[c + 1] = pile[c + 1]! + move;
      } else if (next - pile[c]! > 1.6) {
        pile[c + 1] = pile[c + 1]! - move;
        pile[c] = pile[c]! + move;
      }
      if (Math.floor(pile[c]! * 2) !== Math.floor(was * 2)) changed = true;
    }
    if (changed) this.pileVersion++;
  }

  /** The pointer's breeze near the ground lifts leaves off the pile into its eddy. */
  private lift(dt: number) {
    const { pointer: p } = this;
    if (!p.active) return;
    const { cw, ch, cols } = this.grid;
    const floor = this.layout.floor;
    const flurry = this.leaves.reduce((n, l) => n + (l.flurry ? 1 : 0), 0);
    if (flurry >= this.calm || Math.random() > dt * 9) return;
    const c = clamp(Math.floor((p.x + rand(-BREEZE, BREEZE) * 0.5) / cw), 0, cols - 1);
    const top = (floor - this.pile[c]!) * ch;
    if (Math.abs(top - p.y) > BREEZE * 0.7 || this.pile[c]! < LEAF_DEPTH * 2) return;
    this.pile[c] = this.pile[c]! - LEAF_DEPTH;
    this.pileVersion++;
    const l = this.newLeaf(-1, (c + 0.5) * cw, top - 2, true, this.pileColour[c * PILE_ROWS + Math.max(0, Math.floor(this.pile[c]!))]!);
    l.vy = -rand(40, 90);
    l.vx = rand(-30, 30);
    this.leaves.push(l);
  }

  /** A beast for the bottom of the window: the other kind from last time, from either side (or,
   *  stocking the wood, partway across already). */
  private newWalker(partway: boolean): Walker {
    const kind: Beast = this.lastBeast === "fox" ? "deer" : "fox";
    this.lastBeast = kind;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const pace = kind === "fox" ? rand(42, 56) : rand(24, 32);
    const x = partway ? rand(this.width * 0.2, this.width * 0.8) : dir > 0 ? -120 : this.width + 120;
    return { kind, x, dir, pace, speed: pace, gait: 0, stopUntil: 0, bolting: false };
  }

  private walk(dt: number) {
    const { time: t, width: W } = this;
    if (!this.walker) {
      if (t >= this.nextWalker) this.walker = this.newWalker(false);
      return;
    }
    const w = this.walker;
    const stopped = t < w.stopUntil;
    // A deer stops now and then to look about; a fox keeps on.
    if (!stopped && !w.bolting && w.kind === "deer" && w.x > W * 0.15 && w.x < W * 0.85 && Math.random() < dt / 9) w.stopUntil = t + rand(2, 4);
    const want = stopped ? 0 : w.bolting ? w.pace * 3.4 : w.pace;
    w.speed += (want - w.speed) * Math.min(1, dt * (w.bolting ? 5 : 2));
    w.x += w.dir * w.speed * dt;
    // Its legs step with the ground it covers.
    w.gait += (w.speed * dt) / (w.kind === "fox" ? 9 : 13);
    if (w.x < -160 || w.x > W + 160) {
      this.walker = null;
      this.nextWalker = t + rand(18, 42);
    }
  }

  private glow(dt: number) {
    const { width: W, height: H, time: t } = this;
    for (const f of this.fireflies) {
      f.heading += (noise1(t * 0.4 + f.offset * 7, this.seed + 3) - 0.5) * dt * 5;
      // Low among the trunks.
      if (f.y < H * 0.52) f.heading += (Math.PI / 2 - f.heading) * dt * 0.6;
      if (f.y > H * 0.86) f.heading += (-Math.PI / 2 - f.heading) * dt * 0.6;
      f.x += Math.cos(f.heading) * 14 * dt;
      f.y += Math.sin(f.heading) * 10 * dt;
      if (f.x < -10) f.x += W + 20;
      if (f.x > W + 10) f.x -= W + 20;
    }
  }

  /** How bright a firefly is now, 0 to 1: a slow blink. */
  fireflyLight(f: Firefly) {
    const p = ((this.time + f.offset) % f.period) / 0.9;
    return p < 1 ? Math.sin(Math.PI * p) ** 2 : 0;
  }

  /** How far over (cells) tree `i`'s crown is swayed now by a shake, and how hard it is shaking
   *  (0 to 1). */
  shake(i: number) {
    const age = this.time - this.shaken[i]!;
    if (!(age >= 0 && age < SHAKE)) return { dx: 0, hard: 0 };
    const hard = Math.exp(-age * 2.2);
    return { dx: Math.round(1.6 * hard * Math.sin(age * 19)), hard };
  }
}

