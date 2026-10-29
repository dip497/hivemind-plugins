/**
 * Artificial-life sim behind the canvas: tiny fish schools and the sharks that hunt them.
 *
 * Fish: Reynolds boids (separation / alignment / cohesion) in Couzin-style
 * zones, with a blind spot behind each fish. Alarm spreads from fish to fish
 * through the school (a "wave of agitation"), so a whole school bolts even
 * when only its edge can see the shark. Fleeing fish break sideways around the
 * shark's path, which gives the fountain effect seen in real bait balls.
 *
 * Sharks: Reynolds steering (wander + pursuit + separation) on a
 * follow-the-leader spine. They prefer fish in sparse spots, since dense
 * schools confuse predators, so stragglers get picked off. Eaten fish come
 * back later as new schools swimming in from the edges, which keeps the
 * population steady.
 *
 * Ported from stackedlol/ascii-sharks (MIT, see shoal/LICENSE). What changed for Hivemind: the
 * water stocks itself for the window's size, a shark of every kind and more on a bigger window,
 * and each shark chooses for itself what it does, in turn: hunts, cruises, rests near the bottom.
 * Now and then one turns to glide past the pointer, curious; the original kept four sharks and
 * steered them clear of a centred headline. The same water holds Koi Pond's koi, which swim as the
 * sharks do and are tame: they come to a pointer that rests over the water, and race for the food a
 * click drops on it. A swimmer is either.
 */
import { cellSize } from "./cells";
import type { Sim } from "./scene";
import { angleDiff, clamp, current, rand, randInt, TAU } from "./math";
import { pickSpecies, SPECIES, type Species } from "./species";
import { SPINE_NODES } from "./spine";
import { goalAhead, spread, stockOf } from "./steer";

/** What a swimmer is doing, which it chooses for itself, one after another: hunting the fish,
 *  cruising, resting, or up at the surface mouthing at it (a koi). */
export type Habit = "hunt" | "cruise" | "rest" | "surface";

/** A kind of swimmer's habits: the odds of each being what it does next, for how long (seconds),
 *  and the band of the window it keeps to meanwhile (shares of the height; all of it if not set). */
export type Habits = Partial<Record<Habit, { odds: number; secs: readonly [number, number]; band?: readonly [number, number] }>>;

/** What a World is made with. `kinds` are the swimmers, every one of them in the water; `stock` is
 *  how many: one to each `area` px² of window, never fewer than the kinds, at most `max`.
 *  `fishCount` overrides the area-based fish population, one fish to each `fishArea` px² (4400);
 *  `share` is the biggest swimmer's length as a share of the window's shorter side; `species` are
 *  the fish. `tame` swimmers (koi) come to a pointer that rests and race for food a click drops;
 *  the others (sharks) glide past the pointer now and then, curious. */
export interface WorldOptions {
  kinds: readonly string[];
  stock: { area: number; max: number };
  habits: Habits;
  tame?: boolean;
  fishCount?: number;
  fishArea?: number;
  share?: number;
  species?: Species[];
}

/** Per habit: how near the swimmer swims (0 far and dim, 1 near and bright; nearer is bigger, as
 *  seen from above) and its pace against a cruise. */
const HABITS: Record<Habit, { depth: number; pace: number }> = {
  hunt: { depth: 0.85, pace: 1 },
  cruise: { depth: 0.6, pace: 0.8 },
  surface: { depth: 1, pace: 0.55 },
  rest: { depth: 0.3, pace: 0.35 },
};
const ALL: readonly [number, number] = [0.08, 0.92];

/** How long the pointer stays put before koi take it for someone at the pond's edge, and how many
 *  of those near come to it. */
const REST = 0.6;
const GATHER = 4;
/** How far from the pointer a koi notices it rests there (px). */
const REACH = 520;
/** How many of the koi nearest a click race for its food, and most pellets on the water at once. */
const FEEDERS = 3;
const MAX_FOOD = 15;
/** How long a pellet floats before it sinks, uneaten. */
const FOOD_LIFE = 40;

export interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
  /** 0 calm → 1 panicking. Spreads to neighbours. */
  alarm: number;
  alive: boolean;
  respawnAt: number;
  /** Tail-beat phase. */
  phase: number;
  /** Smoothed angular velocity (rad/s); hard turns flash silver. */
  turn: number;
  /** 0.55 far → 1 near. */
  depth: number;
  /** Rotation sense shared by a school when it mills into a bait ball. */
  millDir: 1 | -1;
}

export interface Swimmer {
  id: number;
  kind: string;
  /** Relative to the biggest: some are younger. */
  size: number;
  habit: Habit;
  /** When it chooses what to do next. */
  habitUntil: number;
  length: number;
  /** Spine positions, snout first: [x0, y0, x1, y1, ...]. */
  nodes: Float32Array;
  heading: number;
  speed: number;
  /** Tail-beat phase; drives the body wave in the renderer. */
  phase: number;
  /** Smoothed angular velocity (rad/s); the shark banks its fins into turns. */
  turn: number;
  hunger: number;
  wander: number;
  target: Fish | null;
  retargetAt: number;
  /** 0 far / dim → 1 near / bright. */
  depth: number;
  /** Where it is swimming to, and until when before it picks another. */
  goal: { x: number; y: number } | null;
  goalAt: number;
  /** A koi: whether it has come to the resting pointer, until when it races for food dropped, and
   *  when it next mouths at the surface while it is up there. */
  gathered: boolean;
  feedUntil: number;
  mouthAt: number;
}

/** A pellet of food on the water (Koi Pond). */
export interface Food {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}

export interface WorldEvent {
  /** `eat`: a fish or a pellet eaten; `splash`: a click on the water; `drop`: a pellet landing on
   *  it; `mouth`: a koi mouthing at the surface. */
  kind: "eat" | "splash" | "drop" | "mouth";
  x: number;
  y: number;
}

const FISH_SEPARATION_K = 420;
const FISH_ALIGN_K = 1.4;
const FISH_COHESION_K = 1;
const FISH_FLEE_K = 1100;
const BLIND_COS = -0.6; // ~127° either side of the heading is visible

export class World implements Sim {
  width = 0;
  height = 0;
  time = 0;
  fish: Fish[] = [];
  /** Shoal's sharks, Koi Pond's koi. */
  swimmers: Swimmer[] = [];
  food: Food[] = [];
  events: WorldEvent[] = [];
  pointer = { x: 0, y: 0, active: false };

  /** Fish neighbourhood radius; the spatial hash bucket size matches it. */
  private perception = 60;
  /** Per-species personal space in px (x, y). */
  private sepX: number[] = [];
  private sepY: number[] = [];
  private foreignSep = 40;
  private bucketCols = 0;
  private bucketRows = 0;
  private bucketHead = new Int32Array(0);
  private bucketCount = new Uint16Array(0);
  private bucketNext = new Int32Array(0);
  private lastSpawn = 0;
  private tmp = { x: 0, y: 0 };
  private nextId = 1;
  /** When the pointer last moved, came or went. */
  private pointerMovedAt = 0;
  /** The shark gliding past the pointer to look at it, until when, whether it has come near it
   *  yet, and when another may. */
  private looker: Swimmer | null = null;
  private lookUntil = 0;
  private lookNear = false;
  private lookAt = 0;
  /** When the koi that come to the resting pointer are chosen again. */
  private gatherAt = 0;

  private kinds: readonly string[];
  private stock: WorldOptions["stock"];
  private habits: Habits;
  private tame: boolean;
  private fishCount: number | undefined;
  private fishArea: number;
  private share: number;
  private species: Species[];

  constructor(options: WorldOptions) {
    this.kinds = options.kinds;
    this.stock = options.stock;
    this.habits = options.habits;
    this.tame = options.tame ?? false;
    this.fishCount = options.fishCount;
    this.fishArea = options.fishArea ?? 4400;
    this.share = options.share ?? 0.44;
    this.species = options.species ?? SPECIES;
  }

  resize(width: number, height: number) {
    const first = this.width === 0;
    const { cw: cellW, ch: cellH } = cellSize(width, height);
    // What is in the water stays, moved into the new window as it was in the old.
    if (!first) this.scale(width / this.width, height / this.height);
    this.width = width;
    this.height = height;
    // Spacing is set in grid cells so every fish lands in its own cell.
    this.sepX = this.species.map((sp) => sp.spacing[0] * cellW);
    this.sepY = this.species.map((sp) => sp.spacing[1] * cellH);
    this.perception = Math.max(cellH * 3, cellW * 5.5);
    this.foreignSep = cellW * 3;

    this.restock();
    if (first || this.fish.length === 0) this.seedFish();
  }

  /** Every fish and swimmer moved `kx` and `ky` times as far from the window's top left: a swimmer
   *  whole, by where its snout goes. */
  private scale(kx: number, ky: number) {
    for (const f of this.fish) {
      f.x *= kx;
      f.y *= ky;
    }
    for (const sw of this.swimmers) {
      const dx = sw.nodes[0]! * (kx - 1);
      const dy = sw.nodes[1]! * (ky - 1);
      for (let n = 0; n < SPINE_NODES; n++) {
        sw.nodes[n * 2] = sw.nodes[n * 2]! + dx;
        sw.nodes[n * 2 + 1] = sw.nodes[n * 2 + 1]! + dy;
      }
      sw.goal = null;
    }
  }

  /** The biggest swimmer's length: the original's share of the window, within Shoal's limits (170
   *  and 430 px at its share) scaled to the world's own share. */
  private unit() {
    const k = this.share / 0.44;
    return clamp(Math.min(this.width, this.height) * this.share, 170 * k, 430 * k);
  }

  /** The swimmers for the window's size, spread over all of it: a window that grows gains some,
   *  one that shrinks loses the last come, and one of every kind stays. */
  private restock() {
    const want = stockOf(this.width, this.height, this.stock.area, this.kinds.length, this.stock.max);
    if (this.swimmers.length > want) {
      const keep = new Set([...this.swimmers].sort((a, b) => a.id - b.id).slice(0, want));
      this.swimmers = this.swimmers.filter((s) => keep.has(s));
      if (this.looker && !keep.has(this.looker)) this.looker = null;
    }
    for (const p of spread(want - this.swimmers.length, this.width, this.height)) {
      this.swimmers.push(this.swimmer(p.x, p.y, this.kinds[this.swimmers.length % this.kinds.length]!));
    }
    this.swimmers.sort((a, b) => a.depth - b.depth);
  }

  /** A swimmer of `kind` at (x, y), heading anywhere, doing whatever it chooses, already as near as
   *  that has it. */
  private swimmer(x: number, y: number, kind: string): Swimmer {
    const heading = rand(0, TAU);
    const size = rand(0.75, 1);
    const sw: Swimmer = {
      id: this.nextId++, kind, size, habit: "cruise", habitUntil: 0,
      length: 0, nodes: new Float32Array(SPINE_NODES * 2), heading, speed: 30, phase: rand(0, TAU), turn: 0,
      hunger: rand(0.25, 0.75), wander: 0, target: null, retargetAt: 0,
      depth: 0, goal: null, goalAt: 0, gathered: false, feedUntil: 0, mouthAt: 0,
    };
    this.choose(sw);
    // Partway through it, so the swimmers do not all choose again at once.
    sw.habitUntil = this.time + (sw.habitUntil - this.time) * rand(0.15, 1);
    sw.depth = HABITS[sw.habit].depth;
    const L = (sw.length = this.unit() * size * (0.8 + 0.3 * sw.depth));
    const seg = L / (SPINE_NODES - 1);
    for (let n = 0; n < SPINE_NODES; n++) {
      sw.nodes[n * 2] = x - Math.cos(heading) * seg * n;
      sw.nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
    }
    return sw;
  }

  /** What a swimmer does next, by its kind's odds, and for how long. */
  private choose(sw: Swimmer) {
    const all = Object.keys(this.habits) as Habit[];
    let r = Math.random() * all.reduce((sum, h) => sum + this.habits[h]!.odds, 0);
    let habit = all[0]!;
    for (habit of all) if ((r -= this.habits[habit]!.odds) <= 0) break;
    const { secs } = this.habits[habit]!;
    if (habit !== sw.habit) sw.goal = null;
    sw.habit = habit;
    sw.habitUntil = this.time + rand(secs[0], secs[1]);
  }

  seedFish() {
    const { width: W, height: H } = this;
    const k = 4400 / this.fishArea;
    const total = this.fishCount ?? clamp(Math.round((W * H) / this.fishArea), Math.round(85 * k), Math.round(340 * k));
    this.fish = [];
    // A school of each species first, so every one is in the water, then by their odds.
    for (let school = 0; this.fish.length < total; school++) {
      const species = school < this.species.length ? school : pickSpecies(this.species);
      const sp = this.species[species]!;
      const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
      const millDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const cx = rand(W * 0.06, W * 0.94);
      const cy = rand(H * 0.08, H * 0.92);
      // Mostly level headings: fish cruise sideways far more than up or down.
      const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
      for (let k = 0; k < size; k++) {
        this.fish.push({
          x: cx + rand(-1, 1) * this.sepX[species]! * Math.sqrt(size),
          y: cy + rand(-1, 1) * this.sepY[species]! * Math.sqrt(size) * 0.6,
          vx: Math.cos(dir) * sp.cruise,
          vy: Math.sin(dir) * sp.cruise,
          species,
          alarm: 0,
          alive: true,
          respawnAt: 0,
          phase: rand(0, TAU),
          turn: 0,
          depth: rand(0.55, 1),
          millDir,
        });
      }
    }
    this.bucketNext = new Int32Array(this.fish.length);
  }

  /** The pointer over the water, or gone from it. */
  point(x: number, y: number, active: boolean) {
    const p = this.pointer;
    if (x !== p.x || y !== p.y || active !== p.active) this.pointerMovedAt = this.time;
    p.x = x;
    p.y = y;
    p.active = active;
  }

  /** A click on the water. Sharks' water ripples and the fish near it burst outward; on a koi pond
   *  it drops food, and the fry dart off from where it lands. */
  splash(x: number, y: number) {
    if (this.tame) {
      this.feed(x, y);
      this.scatter(x, y, 150);
      return;
    }
    this.events.push({ kind: "splash", x, y });
    this.scatter(x, y, 240);
  }

  /** A few pellets of food dropped round (x, y), each with its ring, and the koi nearest turn and
   *  race for them. */
  private feed(x: number, y: number) {
    for (let k = randInt(3, 5); k > 0; k--) {
      const p = { x: x + rand(-1, 1) * 26, y: y + rand(-1, 1) * 18, vx: rand(-3, 3), vy: rand(-2, 2), age: 0 };
      this.food.push(p);
      this.events.push({ kind: "drop", x: p.x, y: p.y });
    }
    if (this.food.length > MAX_FOOD) this.food.splice(0, this.food.length - MAX_FOOD);
    const away = (s: Swimmer) => Math.hypot(s.nodes[0]! - x, s.nodes[1]! - y);
    for (const s of [...this.swimmers].sort((a, b) => away(a) - away(b)).slice(0, FEEDERS)) s.feedUntil = this.time + 15;
  }

  /** Flash expansion: every fish within `r` bolts straight out. */
  private scatter(x: number, y: number, r: number) {
    for (const f of this.fish) {
      if (!f.alive) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy);
      if (d > r || d < 1e-3) continue;
      const k = (1 - d / r) * 260;
      f.vx += (dx / d) * k;
      f.vy += (dy / d) * k;
      f.alarm = 1;
    }
  }

  step(dt: number) {
    this.time += dt;
    this.rebuildHash();
    this.stepFish(dt);
    if (this.tame) this.gather();
    else this.notice();
    this.stepSwimmers(dt);
    this.stepFood(dt);
    this.respawn();
    // Nearer swimmers draw last, so they swim over the far ones.
    this.swimmers.sort((a, b) => a.depth - b.depth);
  }

  private rebuildHash() {
    const size = this.perception;
    const pad = 2;
    this.bucketCols = Math.ceil(this.width / size) + pad * 2;
    this.bucketRows = Math.ceil(this.height / size) + pad * 2;
    const n = this.bucketCols * this.bucketRows;
    if (this.bucketHead.length !== n) {
      this.bucketHead = new Int32Array(n);
      this.bucketCount = new Uint16Array(n);
    }
    this.bucketHead.fill(-1);
    this.bucketCount.fill(0);
    if (this.bucketNext.length !== this.fish.length) {
      this.bucketNext = new Int32Array(this.fish.length);
    }
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]!;
      if (!f.alive) continue;
      const b = this.bucketOf(f.x, f.y);
      this.bucketNext[i] = this.bucketHead[b]!;
      this.bucketHead[b] = i;
      this.bucketCount[b] = this.bucketCount[b]! + 1;
    }
  }

  private bucketOf(x: number, y: number) {
    const size = this.perception;
    const c = clamp(Math.floor(x / size) + 2, 0, this.bucketCols - 1);
    const r = clamp(Math.floor(y / size) + 2, 0, this.bucketRows - 1);
    return r * this.bucketCols + c;
  }

  private stepFish(dt: number) {
    const { fish, swimmers: sharks, pointer, width: W, height: H, time } = this;
    const R = this.perception;
    const R2 = R * R;
    const foreignSep = this.foreignSep;
    const size = this.perception;
    const cols = this.bucketCols;
    const rows = this.bucketRows;
    const head = this.bucketHead;
    const next = this.bucketNext;
    const cur = this.tmp;
    const calmDecay = Math.exp(-dt * 0.7);
    const contagion = Math.min(1, dt * 6);

    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]!;
      if (!f.alive) continue;
      const sp = this.species[f.species]!;
      // Alarmed fish want more room: the school flashes apart around a
      // shark and closes back up once the threat fades.
      const spread = 1 + 1.8 * f.alarm;
      const sepX = this.sepX[f.species]! * spread;
      const sepY = this.sepY[f.species]! * spread;

      const speed = Math.hypot(f.vx, f.vy) || 1;
      const hx = f.vx / speed;
      const hy = f.vy / speed;

      let ax = 0;
      let ay = 0;
      let sx = 0;
      let sy = 0;
      let avx = 0;
      let avy = 0;
      let cx = 0;
      let cy = 0;
      let n = 0;
      let neighbourAlarm = 0;

      const bc = clamp(Math.floor(f.x / size) + 2, 0, cols - 1);
      const br = clamp(Math.floor(f.y / size) + 2, 0, rows - 1);
      for (let r = Math.max(0, br - 1); r <= Math.min(rows - 1, br + 1); r++) {
        for (let c = Math.max(0, bc - 1); c <= Math.min(cols - 1, bc + 1); c++) {
          let j = head[r * cols + c]!;
          while (j !== -1) {
            if (j !== i) {
              const o = fish[j]!;
              const dx = o.x - f.x;
              const dy = o.y - f.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < R2 && d2 > 1e-6) {
                const d = Math.sqrt(d2);
                // Blind zone directly behind the fish.
                if ((dx * hx + dy * hy) / d > BLIND_COS) {
                  // Elliptical personal space: wide along x, tight along y.
                  const qx = dx / sepX;
                  const qy = dy / sepY;
                  const q2 = qx * qx + qy * qy;
                  if (q2 < 1) {
                    const q = Math.sqrt(q2) || 1e-3;
                    const k = (1 - q) / q;
                    sx -= qx * k;
                    sy -= qy * k;
                  }
                  if (o.species === f.species) {
                    avx += o.vx;
                    avy += o.vy;
                    cx += dx;
                    cy += dy;
                    n++;
                  } else if (d < foreignSep) {
                    // Different species keep their own schools.
                    const k = ((1 - d / foreignSep) / d) * 0.6;
                    sx -= dx * k;
                    sy -= dy * k;
                  }
                  if (o.alarm > neighbourAlarm) neighbourAlarm = o.alarm;
                }
              }
            }
            j = next[j]!;
          }
        }
      }

      ax += sx * FISH_SEPARATION_K;
      ay += sy * FISH_SEPARATION_K;
      if (n > 0) {
        const alignK = FISH_ALIGN_K * sp.align;
        const cohesionK = FISH_COHESION_K * sp.cohesion * (1 - 0.8 * f.alarm);
        ax += (avx / n - f.vx) * alignK + (cx / n) * cohesionK;
        ay += (avy / n - f.vy) * alignK + (cy / n) * cohesionK;
        if (sp.mill > 0) {
          // Circle the local centre: the school spins into a bait ball.
          const cl = Math.hypot(cx, cy) || 1;
          ax += (-cy / cl) * f.millDir * sp.mill * (1 - f.alarm);
          ay += (cx / cl) * f.millDir * sp.mill * (1 - f.alarm);
        }
      }

      // Predators. Distance is measured to the nearest point along the front
      // half of the shark, so fish also give the flanks a wide berth.
      let fear = 0;
      for (const sh of sharks) {
        const fearR = sh.length * 0.6 + 60;
        let best = Infinity;
        let bx = 0;
        let by = 0;
        for (let k = 0; k <= 12; k += 3) {
          const nx = sh.nodes[k * 2]!;
          const ny = sh.nodes[k * 2 + 1]!;
          const d2 = (f.x - nx) ** 2 + (f.y - ny) ** 2;
          if (d2 < best) {
            best = d2;
            bx = nx;
            by = ny;
          }
        }
        const d = Math.sqrt(best);
        if (d >= fearR || d < 1e-3) continue;
        let w = 1 - d / fearR;
        w *= w;
        const awayX = (f.x - bx) / d;
        const awayY = (f.y - by) / d;
        // Fountain effect: break to whichever side of the shark's path you're on.
        const shx = Math.cos(sh.heading);
        const shy = Math.sin(sh.heading);
        const side = shx * (f.y - sh.nodes[1]!) - shy * (f.x - sh.nodes[0]!) >= 0 ? 1 : -1;
        ax += (awayX * 0.7 - shy * side * 0.9) * FISH_FLEE_K * w;
        ay += (awayY * 0.7 + shx * side * 0.9) * FISH_FLEE_K * w;
        fear = Math.max(fear, Math.sqrt(w));
      }

      if (pointer.active) {
        const pr = 130;
        const dx = f.x - pointer.x;
        const dy = f.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < pr && d > 1e-3) {
          const w = (1 - d / pr) ** 2;
          ax += (dx / d) * FISH_FLEE_K * w;
          ay += (dy / d) * FISH_FLEE_K * w;
          fear = Math.max(fear, Math.sqrt(w) * 0.8);
        }
      }

      // Alarm: direct threat sets it, neighbours pass it along (slightly
      // weaker each hop), and it fades on its own.
      let alarm = Math.max(f.alarm * calmDecay, fear);
      const relayed = neighbourAlarm * 0.86;
      if (relayed > alarm) alarm += (relayed - alarm) * contagion;
      f.alarm = alarm;

      // Soft walls.
      const m = 36;
      if (f.x < m) ax += (m - f.x) * 7;
      else if (f.x > W - m) ax -= (f.x - (W - m)) * 7;
      if (f.y < m) ay += (m - f.y) * 7;
      else if (f.y > H - m) ay -= (f.y - (H - m)) * 7;

      // Ambient current and a little individual restlessness.
      current(f.x, f.y, time, cur);
      ax += cur.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
      ay += cur.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
      // Swim level, except when bolting from danger.
      ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);

      // Relax toward a preferred speed that rises with panic.
      const preferred = sp.cruise * (1 + 1.3 * f.alarm);
      ax += (preferred - speed) * hx * 1.6;
      ay += (preferred - speed) * hy * 1.6;

      const before = Math.atan2(f.vy, f.vx);
      f.vx += ax * dt;
      f.vy += ay * dt;
      const maxSpeed = sp.maxSpeed * (1 + 1.8 * f.alarm);
      const s = Math.hypot(f.vx, f.vy);
      if (s > maxSpeed) {
        f.vx *= maxSpeed / s;
        f.vy *= maxSpeed / s;
      } else if (s < sp.minSpeed && s > 1e-3) {
        f.vx *= sp.minSpeed / s;
        f.vy *= sp.minSpeed / s;
      }
      f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
      f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);
      f.x = clamp(f.x + f.vx * dt, -60, W + 60);
      f.y = clamp(f.y + f.vy * dt, -60, H + 60);
    }
  }

  /** Now and then the shark nearest the pointer, unless it rests, turns to glide past it, a little
   *  to one side, as a shark looks at something new: a little faster than it cruises, never
   *  chasing it, and one at a time. Once it has come by and the pointer is behind it, or the look
   *  has gone on long enough, it goes back to what it was doing. */
  private notice() {
    const { pointer, time } = this;
    const sh = this.looker;
    if (sh) {
      const hx = sh.nodes[0]!;
      const hy = sh.nodes[1]!;
      const d = Math.hypot(pointer.x - hx, pointer.y - hy);
      if (d < sh.length * 0.6) this.lookNear = true;
      const behind = (pointer.x - hx) * Math.cos(sh.heading) + (pointer.y - hy) * Math.sin(sh.heading) < 0;
      if (!pointer.active || time > this.lookUntil || (this.lookNear && (behind || d > sh.length))) {
        this.looker = null;
        this.lookAt = time + rand(6, 12);
        sh.goal = null;
      }
      return;
    }
    if (!pointer.active || time < this.lookAt) return;
    // A look about once in two seconds the pointer is there.
    this.lookAt = time + 1;
    if (Math.random() < 0.5) return;
    // The nearest, counting the turn it would make: one already headed that way comes.
    let best: Swimmer | null = null;
    let bestCost = Infinity;
    for (const s of this.swimmers) {
      if (s.habit === "rest") continue;
      const d = Math.hypot(s.nodes[0]! - pointer.x, s.nodes[1]! - pointer.y);
      const turn = Math.abs(angleDiff(s.heading, Math.atan2(pointer.y - s.nodes[1]!, pointer.x - s.nodes[0]!)));
      const cost = d / s.length + turn;
      if (d < s.length * 4 && cost < bestCost) {
        best = s;
        bestCost = cost;
      }
    }
    if (!best) return;
    this.looker = best;
    this.lookUntil = time + 15;
    this.lookNear = false;
  }

  /** The koi nearest a pointer that rests over the pond come to it, as koi come to someone at a
   *  pond's edge, and mill about under it; chosen again each second, and none once it moves. */
  private gather() {
    const { pointer, time } = this;
    const resting = pointer.active && time - this.pointerMovedAt > REST;
    if (!resting) {
      for (const s of this.swimmers) s.gathered = false;
      this.gatherAt = 0;
      return;
    }
    if (time < this.gatherAt) return;
    this.gatherAt = time + 1;
    const reach = REACH;
    const away = (s: Swimmer) => Math.hypot(s.nodes[0]! - pointer.x, s.nodes[1]! - pointer.y);
    const near = new Set([...this.swimmers].filter((s) => away(s) < reach).sort((a, b) => away(a) - away(b)).slice(0, GATHER));
    for (const s of this.swimmers) s.gathered = near.has(s);
  }

  private stepSwimmers(dt: number) {
    const { width: W, height: H, time, pointer } = this;
    const cxW = W / 2;
    const cyW = H / 2;
    const unit = this.unit();

    for (const sh of this.swimmers) {
      if (time >= sh.habitUntil) this.choose(sh);
      const habit = HABITS[sh.habit];
      const band = this.habits[sh.habit]?.band ?? ALL;
      const food = sh.feedUntil > time ? this.nearestFood(sh) : null;
      const looking = sh === this.looker;
      // Koi come up for food and to the pointer; a shark comes up to look.
      const near = food || sh.gathered || looking ? 1 : habit.depth;
      sh.depth += (near - sh.depth) * Math.min(1, dt * 0.6);
      // Seen from above, a shark that comes up grows and one that goes down shrinks.
      const L = (sh.length = unit * sh.size * (0.8 + 0.3 * sh.depth));
      const nodes = sh.nodes;
      const hx = nodes[0]!;
      const hy = nodes[1]!;

      // Only a hunting shark gets hungry: the others swim past the fish.
      sh.hunger = sh.habit === "hunt" ? Math.min(1, sh.hunger + dt * 0.12) : Math.min(sh.hunger, 0.2);

      // Momentum.
      let dx = Math.cos(sh.heading);
      let dy = Math.sin(sh.heading);

      // Wander: a slowly drifting offset on a circle ahead of the snout.
      sh.wander = clamp(sh.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
      dx += Math.cos(sh.heading + sh.wander) * 0.45;
      dy += Math.sin(sh.heading + sh.wander) * 0.45;

      // Hunt; but a shark looking at the pointer leaves the fish be meanwhile.
      if (sh.habit !== "hunt" || food || looking) sh.target = null;
      else if (time >= sh.retargetAt) {
        sh.target = this.findPrey(sh);
        sh.retargetAt = time + 0.45;
      }
      const t = sh.target;
      /** After fish or food: fast, turning hard. */
      let hunting = false;
      let closing = 0;
      let pace = habit.pace;
      if (food || (t && t.alive && sh.hunger > 0.3)) {
        // Pursuit: aim at where the fish is about to be; a pellet floats where it is.
        const tx = (food ? food.x : t!.x + t!.vx * 0.35) - hx;
        const ty = (food ? food.y : t!.y + t!.vy * 0.35) - hy;
        const d = Math.hypot(tx, ty) || 1;
        // A pellet close by and off to one side is inside the circle it can turn in: it swims on a
        // little, to come round at it, rather than circling it for good.
        const wide = food && d < L * 0.9 && Math.abs(angleDiff(sh.heading, Math.atan2(ty, tx))) > 1.1;
        const w = wide ? 0 : food ? 3 : 1.4 + 2.6 * sh.hunger;
        dx += (tx / d) * w;
        dy += (ty / d) * w;
        hunting = true;
        closing = clamp(1 - d / (L * 0.9), 0, 1);
      } else if (sh.gathered) {
        // Under the resting pointer, each koi to its own side of it, milling slowly about there.
        const a = sh.id * 2.4;
        const gx = pointer.x + Math.cos(a) * L * 0.35 - hx;
        const gy = pointer.y + Math.sin(a) * L * 0.35 - hy;
        const d = Math.hypot(gx, gy) || 1;
        dx += (gx / d) * 1.6;
        dy += (gy / d) * 1.6;
        // It comes over at its cruising pace, and slows as it nears.
        pace = d > L ? 0.9 : 0.4;
      } else if (looking) {
        // Past the pointer, a third of a length to the side it is on, so it glides by and does not
        // swim over it.
        const nx = -Math.sin(sh.heading);
        const ny = Math.cos(sh.heading);
        const side = (hx - pointer.x) * nx + (hy - pointer.y) * ny >= 0 ? 1 : -1;
        const gx = pointer.x + nx * side * L * 0.3 - hx;
        const gy = pointer.y + ny * side * L * 0.3 - hy;
        const d = Math.hypot(gx, gy) || 1;
        dx += (gx / d) * 1.6;
        dy += (gy / d) * 1.6;
        pace = 1.15;
      } else {
        // Roam: swim somewhere ahead, then pick another; within its habit's band of the window (a
        // resting shark keeps to the bottom).
        const g = sh.goal;
        if (!g || time > sh.goalAt || Math.hypot(g.x - hx, g.y - hy) < L * 0.4) {
          sh.goal = goalAhead(W, H, band[0], band[1], { x: hx, y: hy, heading: sh.heading, reach: L });
          sh.goalAt = time + rand(8, 16);
        }
        const to = sh.goal!;
        const d = Math.hypot(to.x - hx, to.y - hy) || 1;
        const w = sh.habit === "rest" ? 0.8 : 1.1;
        dx += ((to.x - hx) / d) * w;
        dy += ((to.y - hy) / d) * w;
      }

      // Give other swimmers room.
      for (const other of this.swimmers) {
        if (other === sh) continue;
        for (let k = 0; k < SPINE_NODES; k += 4) {
          const ox = hx - other.nodes[k * 2]!;
          const oy = hy - other.nodes[k * 2 + 1]!;
          const d = Math.hypot(ox, oy);
          const range = (L + other.length) * 0.45;
          if (d < range && d > 1e-3) {
            const w = (1 - d / range) * 3;
            dx += (ox / d) * w;
            dy += (oy / d) * w;
          }
        }
      }

      // Soft walls: where the shark is headed, a length on, is pushed in from each edge it nears,
      // so a shark that turns wide turns before the edge, not past it.
      const px = hx + Math.cos(sh.heading) * L;
      const py = hy + Math.sin(sh.heading) * L;
      const m = L * 0.8;
      if (px < m) dx += (1 - Math.max(px, -m) / m) * 4;
      if (px > W - m) dx -= (1 - Math.max(W - px, -m) / m) * 4;
      if (py < m) dy += (1 - Math.max(py, -m) / m) * 4;
      if (py > H - m) dy -= (1 - Math.max(H - py, -m) / m) * 4;

      // Turn back once the snout leaves the frame, so bodies dip off-screen
      // now and then but the sharks never wander away for good.
      const over = Math.max(-hx, hx - W, -hy, hy - H);
      if (over > -L * 0.05) {
        const w = clamp((over + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
        const toX = cxW - hx;
        const toY = cyW - hy;
        const d = Math.hypot(toX, toY) || 1;
        dx += (toX / d) * w;
        dy += (toY / d) * w;
      }

      const desired = Math.atan2(dy, dx);
      // Sharks can't pivot on the spot: the turning circle grows with speed, and is never so tight
      // that the body following the snout bends into a U, even after a fish. One in no hurry turns
      // in a wide, lazy curve.
      const agility = Math.min(hunting ? 1.7 + closing : 0.8, sh.speed / (L * (hunting ? 0.45 : 0.5)));
      const maxTurn = agility * dt;
      const turned = clamp(angleDiff(sh.heading, desired), -maxTurn, maxTurn);
      sh.heading += turned;
      sh.turn += (turned / dt - sh.turn) * Math.min(1, dt * 3);

      const cruise = 30 + L * 0.04;
      // After a fish it puts on speed as it closes; after a pellet it slows as it nears, so it can
      // turn to take it.
      const targetSpeed = food ? cruise * (1.5 - closing) : hunting ? cruise * (1.45 + closing * 1.5) : cruise * pace;
      sh.speed += (targetSpeed - sh.speed) * Math.min(1, dt * 1.1);
      sh.phase += dt * (2 + sh.speed / 24);

      nodes[0] = nodes[0]! + Math.cos(sh.heading) * sh.speed * dt;
      nodes[1] = nodes[1]! + Math.sin(sh.heading) * sh.speed * dt;

      // Follow-the-leader spine, with a stiffness limit per joint so the
      // body bends into a C at most and never folds back on itself.
      const seg = L / (SPINE_NODES - 1);
      const maxBend = 0.16;
      let prevAngle = sh.heading + Math.PI;
      for (let k = 1; k < SPINE_NODES; k++) {
        const px = nodes[(k - 1) * 2]!;
        const py = nodes[(k - 1) * 2 + 1]!;
        let angle = Math.atan2(nodes[k * 2 + 1]! - py, nodes[k * 2]! - px);
        angle = prevAngle + clamp(angleDiff(prevAngle, angle), -maxBend, maxBend);
        nodes[k * 2] = px + Math.cos(angle) * seg;
        nodes[k * 2 + 1] = py + Math.sin(angle) * seg;
        prevAngle = angle;
      }

      const mx = nodes[0]!;
      const my = nodes[1]!;
      // Feed.
      if (hunting && !food && sh.hunger > 0.15) {
        const mouthR = L * 0.05 + 8;
        for (const f of this.fish) {
          if (!f.alive) continue;
          if ((f.x - mx) ** 2 + (f.y - my) ** 2 < mouthR * mouthR) {
            f.alive = false;
            f.respawnAt = time + rand(3, 8);
            sh.hunger = Math.max(0, sh.hunger - 0.16);
            this.events.push({ kind: "eat", x: f.x, y: f.y });
          }
        }
      }
      // A pellet at its mouth is eaten, whoever comes by it, and one a little way ahead of it is
      // sucked in: a koi feeding need not swim right over it.
      const mouthR = L * 0.07 + 8;
      const suck = L * 0.3;
      const fx = Math.cos(sh.heading);
      const fy = Math.sin(sh.heading);
      for (let k = this.food.length - 1; k >= 0; k--) {
        const p = this.food[k]!;
        const d = Math.hypot(p.x - mx, p.y - my);
        if (d >= mouthR && !(d < suck && ((p.x - mx) * fx + (p.y - my) * fy) / d > 0.5)) continue;
        this.food.splice(k, 1);
        this.events.push({ kind: "eat", x: p.x, y: p.y });
      }
      // Up at the surface, or by the pointer, a koi mouths at it: a ring every two seconds or so.
      if ((sh.habit === "surface" || sh.gathered) && time >= sh.mouthAt) {
        this.events.push({ kind: "mouth", x: mx, y: my });
        sh.mouthAt = time + rand(1.6, 2.8);
      }
    }
  }

  /** The pellet nearest a swimmer's mouth, or null when the water has none. */
  private nearestFood(sh: Swimmer): Food | null {
    let best: Food | null = null;
    let bestD = Infinity;
    for (const p of this.food) {
      const d = (p.x - sh.nodes[0]!) ** 2 + (p.y - sh.nodes[1]!) ** 2;
      if (d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** The pellets drift a little on the water, and one floating long enough sinks. While any is
   *  left and no koi is after it, the koi nearest the oldest comes for it. */
  private stepFood(dt: number) {
    if (!this.food.length) return;
    for (const p of this.food) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.age += dt;
    }
    if (this.food.some((p) => p.age > FOOD_LIFE)) this.food = this.food.filter((p) => p.age <= FOOD_LIFE);
    const left = this.food[0];
    if (!left || this.swimmers.some((s) => s.feedUntil > this.time)) return;
    let nearest: Swimmer | null = null;
    for (const s of this.swimmers) if (!nearest || Math.hypot(s.nodes[0]! - left.x, s.nodes[1]! - left.y) < Math.hypot(nearest.nodes[0]! - left.x, nearest.nodes[1]! - left.y)) nearest = s;
    if (nearest) nearest.feedUntil = this.time + 10;
  }

  /**
   * Pick prey in the shark's forward cone, preferring close fish in sparse
   * buckets (stragglers) over fish buried in a dense school.
   */
  private findPrey(sh: Swimmer): Fish | null {
    const range = sh.length * 0.9 + 160;
    const margin = sh.length * 0.3;
    const hx = sh.nodes[0]!;
    const hy = sh.nodes[1]!;
    const fx = Math.cos(sh.heading);
    const fy = Math.sin(sh.heading);
    let best: Fish | null = null;
    let bestScore = Infinity;
    let currentScore = Infinity;

    for (const f of this.fish) {
      if (!f.alive) continue;
      const dx = f.x - hx;
      const dy = f.y - hy;
      const d = Math.hypot(dx, dy);
      if (d > range || d < 1e-3) continue;
      // Not a fish at the window's edge, which it would chase out of sight.
      if (f.x < margin || f.x > this.width - margin || f.y < margin || f.y > this.height - margin) continue;
      const cos = (dx * fx + dy * fy) / d;
      if (cos < 0.2) continue;
      const crowd = this.bucketCount[this.bucketOf(f.x, f.y)]!;
      const score = d * (1 + (1 - cos) * 0.8) * (1 + crowd * 0.07);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
      if (f === sh.target) currentScore = score;
    }
    // Stick with the current target unless something is clearly better.
    if (sh.target && currentScore < bestScore * 1.3) return sh.target;
    return best;
  }

  private respawn() {
    const { time, width: W, height: H } = this;
    const due: Fish[] = [];
    for (const f of this.fish) if (!f.alive && f.respawnAt <= time) due.push(f);
    if (due.length === 0) return;
    if (due.length < 6 && time - this.lastSpawn < 9) return;
    this.lastSpawn = time;

    // A new school swims in from a random edge, of the species fewest in the water for its odds, so
    // every one stays in it however the sharks have fed.
    const side = randInt(0, 3);
    const along = rand(0.15, 0.85);
    const x = side === 0 ? -20 : side === 1 ? W + 20 : along * W;
    const y = side === 2 ? -20 : side === 3 ? H + 20 : along * H;
    const inward = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
    const alive = this.species.map(() => 0);
    for (const f of this.fish) if (f.alive) alive[f.species] = alive[f.species]! + 1;
    let species = 0;
    for (let i = 1; i < alive.length; i++) if (alive[i]! / this.species[i]!.weight < alive[species]! / this.species[species]!.weight) species = i;
    const sp = this.species[species]!;
    const millDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
    for (const f of due.slice(0, sp.schoolSize[1])) {
      f.alive = true;
      f.species = species;
      f.alarm = 0;
      f.turn = 0;
      f.millDir = millDir;
      f.x = x + rand(-1, 1) * this.perception;
      f.y = y + rand(-1, 1) * this.perception;
      f.vx = Math.cos(inward) * sp.cruise * 1.4;
      f.vy = Math.sin(inward) * sp.cruise * 1.4;
    }
  }
}
