/**
 * Life: Conway's Game of Life on a board of character cells sized to the window, its edges joined
 * (a glider off the right comes back on the left). A cell with three live neighbours is born; a
 * live one with two or three lives on; every other one is dead next generation.
 *
 * Each cell keeps when it was born, how many generations it has lived and when it last left a
 * trace, for the renderer to draw newborns bright, older cells settling, and dead ones fading. A
 * cell reborn a generation or two after it died is an oscillator's beat, not a newcomer: it keeps
 * its age, so a blinker glows steadily instead of flashing.
 *
 * It never dies out, freezes or thins: the board is split into regions, and one where nothing has
 * moved (nothing differs from two generations back, so still lifes and blinkers do not count) for a
 * while, or where few cells live, is sown again with a seed that grows (a few known patterns, or
 * noise). The pointer sows living
 * cells under and around it; a click drops a glider, a small spaceship or an R-pentomino there.
 */
import type { Sim } from "../scene";
import { clamp, pick, rand, randInt } from "../random";
import { DROPS, SEEDS, orient } from "./patterns";

/** Seconds a generation lasts. */
export const GENERATION = 0.2;
/** A cell born within this many generations of its death is an oscillator's beat: it keeps its age. */
const BEAT = 3;
/** A region where nothing has moved this long is sown again, in seconds. */
export const QUIET = 10;
/** A region with fewer than this share of its cells alive is sown again too, at most this often
 *  (seconds): the board stays thick with life. */
export const SPARSE = 0.07;
const SOW_EVERY = 3;
/** How many cells must differ from two generations back for a region to count as moving. */
const MOVING = 3;
/** How many cells a pointer resting on the board sows each second, within `SOW_REACH` cells. */
export const SOW_RATE = 14;
export const SOW_REACH = 2.2;
/** A click's ring of light: how fast it spreads (px/s), and how far. */
export const RING_SPEED = 140;
export const RING_REACH = 180;
/** The ring leaves each cell it lights a trace already this many seconds old: fainter than a
 *  death's, and gone sooner, a wake fading behind the ring's bright front. */
const RING_WAKE = 0.5;
/** Generations the board is run before its first frame, so it opens alive, not as noise. */
const OPENING = 60;
/** Never: a cell that has not left a trace. */
export const NEVER = -1e9;

/** The cell of a window: from its shorter side, a little taller than wide, as a terminal's. */
export function lifeCell(width: number, height: number) {
  const cw = clamp(Math.round(Math.min(width, height) / 88), 8, 15);
  return { cw, ch: Math.round(cw * 1.3) };
}

export class Life implements Sim {
  width = 0;
  height = 0;
  cw = 10;
  ch = 13;
  cols = 0;
  rows = 0;
  /** This generation: 1 alive, 0 dead. */
  cells = new Uint8Array(0);
  /** Generations each cell has lived (kept through an oscillator's beat). */
  age = new Uint16Array(0);
  /** When each cell was born, in seconds of `time`. */
  bornAt = new Float32Array(0);
  /** When each cell last left a trace: it died, or a click's ring of light passed over it. */
  traceAt = new Float32Array(0);
  /** When a click's ring of light last passed over each cell. */
  litAt = new Float32Array(0);
  /** The generation each cell last died in. */
  private diedIn = new Int32Array(0);
  /** The generation before this one, and the next one being worked out. */
  private before = new Uint8Array(0);
  private next = new Uint8Array(0);
  /** The region each cell is in, and how many cells moved in each last generation. */
  private regionOf = new Uint16Array(0);
  /** Each region's box, in cells, and when it last moved. */
  regions: { c0: number; r0: number; c1: number; r1: number; movedAt: number; sownAt: number }[] = [];
  private moved = new Uint32Array(0);
  private alive = new Uint32Array(0);
  time = 0;
  gen = 0;
  private acc = 0;
  /** Live cells now. */
  population = 0;
  /** Cells that differ from two generations back, in the last generation: what moves, not what beats in place. */
  changes = 0;
  readonly pointer = { x: 0, y: 0, active: false };
  /** Where the pointer last sowed, so a moving one sows all along its way. */
  private trail: { x: number; y: number } | null = null;
  private sowing = 0;
  /** A click's ring of light, spreading from where it landed. */
  rings: { x: number; y: number; at: number }[] = [];

  resize(width: number, height: number) {
    const { cw, ch } = lifeCell(width, height);
    const cols = Math.ceil(width / cw);
    const rows = Math.ceil(height / ch);
    this.width = width;
    this.height = height;
    this.cw = cw;
    this.ch = ch;
    if (cols === this.cols && rows === this.rows) return;
    const old = this.cols ? { cols: this.cols, rows: this.rows, cells: this.cells, age: this.age, bornAt: this.bornAt, traceAt: this.traceAt, litAt: this.litAt, diedIn: this.diedIn, before: this.before } : null;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.cells = new Uint8Array(n);
    this.age = new Uint16Array(n);
    this.bornAt = new Float32Array(n).fill(NEVER);
    this.traceAt = new Float32Array(n).fill(NEVER);
    this.litAt = new Float32Array(n).fill(NEVER);
    this.diedIn = new Int32Array(n).fill(-1000);
    this.before = new Uint8Array(n);
    this.next = new Uint8Array(n);
    this.layRegions();
    if (!old) {
      this.open();
      return;
    }
    // The board as it was, in the middle of the new one (cut at its edges if smaller); what the
    // new one has beyond it is sown afresh, its cells already some generations old.
    const dc = Math.floor((cols - old.cols) / 2);
    const dr = Math.floor((rows - old.rows) / 2);
    const kept = new Uint8Array(n);
    for (let r = 0; r < old.rows; r++) {
      const nr = r + dr;
      if (nr < 0 || nr >= rows) continue;
      for (let c = 0; c < old.cols; c++) {
        const nc = c + dc;
        if (nc < 0 || nc >= cols) continue;
        const [i, j] = [nr * cols + nc, r * old.cols + c];
        kept[i] = 1;
        this.cells[i] = old.cells[j]!;
        this.age[i] = old.age[j]!;
        this.bornAt[i] = old.bornAt[j]!;
        this.traceAt[i] = old.traceAt[j]!;
        this.litAt[i] = old.litAt[j]!;
        this.diedIn[i] = old.diedIn[j]!;
        this.before[i] = old.before[j]!;
      }
    }
    for (let i = 0; i < n; i++) {
      if (kept[i] || Math.random() > 0.16) continue;
      this.cells[i] = 1;
      this.age[i] = randInt(4, 40);
    }
    this.count();
  }

  /** The board split into regions some 40 cells wide and 24 tall, each sown again when it is quiet. */
  private layRegions() {
    const nx = Math.max(2, Math.round(this.cols / 40));
    const ny = Math.max(2, Math.round(this.rows / 24));
    this.regions = [];
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        this.regions.push({ c0: Math.floor((x * this.cols) / nx), r0: Math.floor((y * this.rows) / ny), c1: Math.floor(((x + 1) * this.cols) / nx), r1: Math.floor(((y + 1) * this.rows) / ny), movedAt: this.time, sownAt: this.time });
      }
    }
    this.regionOf = new Uint16Array(this.cols * this.rows);
    this.regions.forEach((g, k) => {
      for (let r = g.r0; r < g.r1; r++) for (let c = g.c0; c < g.c1; c++) this.regionOf[r * this.cols + c] = k;
    });
    this.moved = new Uint32Array(this.regions.length);
    this.alive = new Uint32Array(this.regions.length);
  }

  /** The board's first life: soup in patches over all of it, a few known seeds among them, run some
   *  generations, so the first frame is a board alive everywhere, of cells of every age. */
  private open() {
    const { cols, rows } = this;
    // Patches spread over an even grid, each somewhere in its own square, none left bare.
    const n = Math.max(6, Math.round((cols * rows) / 150));
    const across = Math.max(1, Math.round(Math.sqrt((n * cols) / rows)));
    const down = Math.ceil(n / across);
    const blobs = Array.from({ length: across * down }, (_, k) => ({ c: ((k % across) + rand(0.15, 0.85)) * (cols / across), r: (Math.floor(k / across) + rand(0.15, 0.85)) * (rows / down), rad: rand(6, 11) }));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let p = 0.1;
        for (const b of blobs) {
          const d = Math.hypot(c - b.c, (r - b.r) * 1.3);
          if (d < b.rad) p = Math.max(p, 0.4);
        }
        if (Math.random() < p) this.birth(r * cols + c);
      }
    }
    for (const g of this.regions) this.sow(g);
    for (let k = 0; k < OPENING; k++) {
      this.time += GENERATION;
      this.tick();
    }
    for (const g of this.regions) g.movedAt = this.time;
  }

  /** `i` is born now, a newcomer. */
  private birth(i: number) {
    if (this.cells[i]) return;
    this.cells[i] = 1;
    this.age[i] = 0;
    this.bornAt[i] = this.time;
    this.population++;
  }

  private count() {
    let n = 0;
    for (let i = 0; i < this.cells.length; i++) n += this.cells[i]!;
    this.population = n;
  }

  /** The cell at a point, as `[column, row]`. */
  cellAt(x: number, y: number): [number, number] {
    return [clamp(Math.floor(x / this.cw), 0, this.cols - 1), clamp(Math.floor(y / this.ch), 0, this.rows - 1)];
  }

  /** Set `cells` alive, centred on column `c`, row `r`, wrapping at the edges. */
  stamp(cells: readonly (readonly [number, number])[], c: number, r: number) {
    for (const [dc, dr] of cells) {
      const cc = (((c + dc) % this.cols) + this.cols) % this.cols;
      const rr = (((r + dr) % this.rows) + this.rows) % this.rows;
      this.birth(rr * this.cols + cc);
    }
  }

  /** Sow a quiet region again: a known seed that grows, or a patch of noise, somewhere inside it. */
  private sow(g: Life["regions"][number]) {
    let total = 0;
    for (const s of SEEDS) total += s.weight;
    let roll = Math.random() * total;
    const seed = SEEDS.find((s) => (roll -= s.weight) < 0) ?? SEEDS[0]!;
    const c = randInt(g.c0 + 3, Math.max(g.c0 + 3, g.c1 - 4));
    const r = randInt(g.r0 + 3, Math.max(g.r0 + 3, g.r1 - 4));
    if (seed.shape) {
      this.stamp(orient(seed.shape, randInt(0, 3), Math.random() < 0.5), c, r);
      return;
    }
    const noise: [number, number][] = [];
    for (let dr = -4; dr <= 4; dr++) for (let dc = -6; dc <= 6; dc++) if (Math.random() < 0.42) noise.push([dc, dr]);
    this.stamp(noise, c, r);
  }

  /** One generation: born on three neighbours, alive on two or three, dead otherwise. */
  tick() {
    const { cols, rows, cells, next, before } = this;
    for (let r = 0; r < rows; r++) {
      const up = ((r + rows - 1) % rows) * cols;
      const at = r * cols;
      const down = ((r + 1) % rows) * cols;
      for (let c = 0; c < cols; c++) {
        const w = c === 0 ? cols - 1 : c - 1;
        const e = c === cols - 1 ? 0 : c + 1;
        const n = cells[up + w]! + cells[up + c]! + cells[up + e]! + cells[at + w]! + cells[at + e]! + cells[down + w]! + cells[down + c]! + cells[down + e]!;
        next[at + c] = n === 3 || (n === 2 && cells[at + c]) ? 1 : 0;
      }
    }
    this.gen++;
    this.moved.fill(0);
    this.alive.fill(0);
    let changes = 0;
    let population = 0;
    for (let i = 0; i < next.length; i++) {
      const now = next[i]!;
      population += now;
      if (now) {
        const k = this.regionOf[i]!;
        this.alive[k] = this.alive[k]! + 1;
      }
      if (now !== before[i]) {
        changes++;
        const k = this.regionOf[i]!;
        this.moved[k] = this.moved[k]! + 1;
      }
      if (now && !cells[i]) {
        if (this.gen - this.diedIn[i]! <= BEAT) this.age[i] = Math.min(65535, this.age[i]! + 1);
        else {
          this.age[i] = 0;
          this.bornAt[i] = this.time;
        }
      } else if (now) this.age[i] = Math.min(65535, this.age[i]! + 1);
      else if (cells[i]) {
        this.traceAt[i] = this.time;
        this.diedIn[i] = this.gen;
      }
    }
    // This generation becomes the one before, the next one this.
    this.before = cells;
    this.cells = next;
    this.next = before;
    this.changes = changes;
    this.population = population;
    this.regions.forEach((g, k) => {
      if (this.moved[k]! >= MOVING) g.movedAt = this.time;
      const thin = this.alive[k]! < SPARSE * (g.c1 - g.c0) * (g.r1 - g.r0);
      if (this.time - g.movedAt > QUIET || (thin && this.time - g.sownAt > SOW_EVERY)) {
        this.sow(g);
        g.movedAt = g.sownAt = this.time;
      }
    });
  }

  point(x: number, y: number, active: boolean) {
    if (!active) this.trail = null;
    else if (!this.pointer.active) this.trail = { x, y };
    Object.assign(this.pointer, { x, y, active });
  }

  /** A click: a glider, a small spaceship or an R-pentomino dropped there, turned any way, and a
   *  ring of light spreading from it. */
  splash(x: number, y: number) {
    if (!this.cols) return;
    const [c, r] = this.cellAt(x, y);
    this.stamp(orient(pick(Object.values(DROPS)), randInt(0, 3), Math.random() < 0.5), c, r);
    this.rings.push({ x, y, at: this.time });
    if (this.rings.length > 4) this.rings.shift();
  }

  step(dt: number) {
    if (!this.cols) return;
    this.time += dt;
    if (this.pointer.active) this.sowAtPointer(dt);
    this.light();
    this.acc += dt;
    while (this.acc >= GENERATION) {
      this.acc -= GENERATION;
      this.tick();
    }
  }

  /** The pointer sows: resting, a few cells a second near it; moving, all along its way too. */
  private sowAtPointer(dt: number) {
    const { x, y } = this.pointer;
    const reach = SOW_REACH * this.cw;
    this.sowing += SOW_RATE * dt;
    for (; this.sowing >= 1; this.sowing--) {
      const a = rand(0, Math.PI * 2);
      const d = reach * Math.sqrt(Math.random());
      const [c, r] = this.cellAt(x + Math.cos(a) * d, y + Math.sin(a) * d);
      this.birth(r * this.cols + c);
    }
    const from = this.trail ?? { x, y };
    const way = Math.hypot(x - from.x, y - from.y);
    const each = this.cw * 0.9;
    if (way < each) return;
    for (let k = 1; k * each <= way; k++) {
      const t = (k * each) / way;
      const [c, r] = this.cellAt(from.x + (x - from.x) * t + rand(-1, 1) * this.cw, from.y + (y - from.y) * t + rand(-1, 1) * this.ch);
      this.birth(r * this.cols + c);
    }
    this.trail = { x, y };
  }

  /** Each click's ring lights the dead cells it passes over, and leaves them a fading trace. */
  private light() {
    this.rings = this.rings.filter((g) => RING_SPEED * (this.time - g.at) < RING_REACH);
    for (const g of this.rings) {
      const rad = RING_SPEED * (this.time - g.at);
      const band = this.cw * 0.7;
      const [c0, r0] = this.cellAt(g.x - rad - band, g.y - rad - band);
      const [c1, r1] = this.cellAt(g.x + rad + band, g.y + rad + band);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const d = Math.hypot((c + 0.5) * this.cw - g.x, (r + 0.5) * this.ch - g.y);
          const i = r * this.cols + c;
          if (Math.abs(d - rad) >= band || this.cells[i]) continue;
          this.litAt[i] = this.time;
          this.traceAt[i] = Math.max(this.traceAt[i]!, this.time - RING_WAKE);
        }
      }
    }
  }
}
