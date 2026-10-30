/**
 * Metro's map: a transit network made up once, in the way a schematic map is drawn. Its lines run
 * on a lattice of square steps (three cells wide by two tall, about square on screen), each step
 * across, down or at 45°, bending by 45° at a time; they cross at interchanges; a river winds across
 * under them; parks lie in the spaces between; districts are named where there is room.
 *
 * The map is made once (`mapOf`), on the lattice of the window it is first shown in, and kept as
 * shares of the window: `layoutOf` lays it out on any window's lattice, each stretch between bends
 * routed again across and at 45° as it was, so a resize keeps the same map.
 */
import { clamp } from "../util";

/** The eight ways a step can go, round from east: a turn of one is 45°. */
const DIRS: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
/** A lattice step is this many cells across and down. */
export const STEP_COLS = 3;
export const STEP_ROWS = 2;
/** Most lines a map has; a window shows five to eight of them, more on a bigger one. */
export const MAX_LINES = 8;

/** Invented districts, none a real place's name. */
const DISTRICTS = [
  "OLD QUARTER", "RIVERSIDE", "NORTH END", "MILL YARDS", "LANTERN ROW", "KETTLE HILL", "SALT MARSH", "COPPER WORKS",
  "ORCHARD PARK", "THE FOUNDRY", "CLOCKTOWER", "ROPEWALK", "WEAVERS GATE", "HIGH MEADOW", "GLASSWORKS", "CANAL SIDE",
  "FERRY POINT", "STONE BRIDGE", "EAST DOCKS", "MARKET HILL", "BELL FIELDS", "ASH GROVE", "TANNERS END", "LOCKSIDE",
];

type Pt = [number, number];

export interface MapSpec {
  /** Each line's bends, first to last, and its stations, as shares of the window. */
  lines: { vertices: Pt[]; stations: Pt[] }[];
  river: Pt[];
  parks: { x0: number; y0: number; x1: number; y1: number }[];
  districts: { name: string; x: number; y: number }[];
}

/** The plan of each line: which way it runs, and where across the map it starts. */
const PLAN: { main: number; at: number }[] = [
  { main: 0, at: 0.36 }, { main: 2, at: 0.42 }, { main: 1, at: 0.1 }, { main: 0, at: 0.68 },
  { main: 2, at: 0.7 }, { main: 7, at: 0.25 }, { main: 0, at: 0.15 }, { main: 2, at: 0.15 },
];

/** Make a map on a `gx` by `gy` lattice, from `r`. */
export function mapOf(gx: number, gy: number, r: () => number): MapSpec {
  const used = new Set<string>();
  const edge = (a: Pt, b: Pt) => (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? `${a}|${b}` : `${b}|${a}`);
  const norm = (p: Pt): Pt => [p[0] / Math.max(1, gx - 1), p[1] / Math.max(1, gy - 1)];
  const inside = (p: Pt, m: number) => p[0] >= m && p[0] <= gx - 1 - m && p[1] >= m && p[1] <= gy - 1 - m;

  /** A walk from `start` the `main` way, bending 45° either side of it now and then, until it
   *  reaches the far side; each stretch chosen to share as few steps with what is drawn as it can. */
  function walk(start: Pt, main: number, band: number | null, avoid: boolean, long: [number, number]) {
    const pts: Pt[] = [start];
    const vertices: Pt[] = [start];
    let at = start;
    let dir = main;
    const far = (p: Pt) => {
      const [dx, dy] = DIRS[main]!;
      // Done once it is a step from the edge it is heading for.
      return (dx > 0 && p[0] >= gx - 2) || (dx < 0 && p[0] <= 1) || (dy > 0 && p[1] >= gy - 2) || (dy < 0 && p[1] <= 1);
    };
    for (let guard = 0; guard < 80 && !far(at); guard++) {
      // Back to the main way after a bend, mostly; else a bend, toward its band if it has drifted.
      const turns = dir === main ? [main, (main + 1) % 8, (main + 7) % 8] : [main, dir];
      let best: { d: number; n: number; cost: number } | null = null;
      for (let k = 0; k < 9; k++) {
        const d = k < turns.length ? turns[k]! : turns[Math.floor(r() * turns.length)]!;
        const n = d === main ? long[0] + Math.floor(r() * (long[1] - long[0] + 1)) : 2 + Math.floor(r() * 3);
        let p = at;
        let shared = 0;
        let out = 0;
        for (let i = 0; i < n; i++) {
          const q: Pt = [p[0] + DIRS[d]![0], p[1] + DIRS[d]![1]];
          if (!inside(q, 1)) out++;
          if (avoid && used.has(edge(p, q))) shared++;
          p = q;
        }
        let drift = 0;
        if (band !== null) {
          const across = main === 0 ? p[1] / (gy - 1) : p[0] / (gx - 1);
          drift = Math.abs(across - band) * 12;
        }
        const cost = out * 10 + shared * 4 + drift + (d === dir && d !== main ? 3 : 0) + r() * 1.5;
        if (!best || cost < best.cost) best = { d, n, cost };
      }
      const { d, n } = best!;
      if (d !== dir) vertices.push(at);
      for (let i = 0; i < n && !far(at); i++) {
        const q: Pt = [clamp(at[0] + DIRS[d]![0], 0, gx - 1), clamp(at[1] + DIRS[d]![1], 0, gy - 1)];
        if (q[0] === at[0] && q[1] === at[1]) break;
        used.add(edge(at, q));
        pts.push(q);
        at = q;
      }
      dir = d;
    }
    vertices.push(at);
    // Bends only: drop a vertex where the way does not change.
    const bends = vertices.filter((v, i) => i === 0 || i === vertices.length - 1 || !(v[0] === vertices[i - 1]![0] && v[1] === vertices[i - 1]![1]));
    return { pts, vertices: bends };
  }

  // The river first, wide and slow, from the left side to the right.
  const river = walk([0, Math.round((0.48 + r() * 0.24) * (gy - 1))], 0, 0.6, false, [4, 10]).vertices;

  const lines = PLAN.map((plan) => {
    const across = plan.at + (r() - 0.5) * 0.08;
    const start: Pt = plan.main === 0 ? [1, Math.round(across * (gy - 1))]
      : plan.main === 2 ? [Math.round(across * (gx - 1)), 1]
      : plan.main === 1 ? [Math.round(across * (gx - 1)), 1]
      : [Math.round(across * (gx - 1)), gy - 2];
    const band = plan.main === 0 || plan.main === 2 ? across : null;
    const { pts, vertices } = walk(start, plan.main, band, true, [3, 8]);
    // A station every three to five steps along it, the ends too.
    const stations: Pt[] = [pts[0]!];
    let next = 3 + Math.floor(r() * 3);
    for (let i = 1; i < pts.length - 1; i++) {
      if (--next > 0) continue;
      stations.push(pts[i]!);
      next = 3 + Math.floor(r() * 3);
    }
    stations.push(pts[pts.length - 1]!);
    return { vertices: vertices.map(norm), stations: stations.map(norm), pts };
  });

  // What is drawn where, to keep parks and names clear of it.
  const taken = new Set<string>();
  for (const l of lines) for (const p of l.pts) taken.add(`${p}`);
  const riverPts = routeAll(river);
  for (const p of riverPts) taken.add(`${p}`);
  const near = (x: number, y: number, rx: number, ry: number) => {
    for (let i = Math.floor(x - rx); i <= Math.ceil(x + rx); i++) for (let j = Math.floor(y - ry); j <= Math.ceil(y + ry); j++) if (taken.has(`${i},${j}`)) return true;
    return false;
  };

  const parks: MapSpec["parks"] = [];
  for (let k = 0; k < 40 && parks.length < 2; k++) {
    const w = 3 + Math.floor(r() * 3);
    const h = 2 + Math.floor(r() * 2);
    const x0 = 2 + Math.floor(r() * (gx - w - 4));
    const y0 = 2 + Math.floor(r() * (gy - h - 4));
    if (near(x0 + w / 2, y0 + h / 2, w / 2 + 0.5, h / 2 + 0.5)) continue;
    parks.push({ x0: x0 / (gx - 1), y0: y0 / (gy - 1), x1: (x0 + w) / (gx - 1), y1: (y0 + h) / (gy - 1) });
    for (let i = x0; i <= x0 + w; i++) for (let j = y0; j <= y0 + h; j++) taken.add(`${i},${j}`);
  }

  // Names where there is room for them, spread apart. A name is about a step wide for every four
  // of its letters.
  const names = [...DISTRICTS].sort(() => r() - 0.5);
  const districts: MapSpec["districts"] = [];
  const placed: Pt[] = [];
  for (const name of names) {
    if (districts.length >= 8) break;
    const half = name.length / 8 + 0.6;
    let best: { p: Pt; score: number } | null = null;
    for (let k = 0; k < 30; k++) {
      const p: Pt = [2 + r() * (gx - 5), 1.5 + r() * (gy - 4)];
      if (near(p[0], p[1], half, 0.6)) continue;
      const apart = Math.min(99, ...placed.map((q) => Math.hypot(q[0] - p[0], (q[1] - p[1]) * 1.6)));
      if (apart < 7) continue;
      if (!best || apart > best.score) best = { p, score: apart };
    }
    if (!best) continue;
    placed.push(best.p);
    districts.push({ name, x: best.p[0] / (gx - 1), y: best.p[1] / (gy - 1) });
  }

  return { lines: lines.map(({ vertices, stations }) => ({ vertices, stations })), river: river.map(norm), parks, districts };
}

/** Every lattice point along a path through `vertices`, each stretch between two routed across
 *  or down, then at 45° (or 45° first, if `diagonalFirst`). */
export function routeAll(vertices: Pt[], diagonalFirst = false): Pt[] {
  const out: Pt[] = [vertices[0]!];
  for (let i = 1; i < vertices.length; i++) {
    const [ax, ay] = out[out.length - 1]!;
    const [bx, by] = vertices[i]!;
    const dx = bx - ax;
    const dy = by - ay;
    const diag = Math.min(Math.abs(dx), Math.abs(dy));
    const straight = Math.max(Math.abs(dx), Math.abs(dy)) - diag;
    const sx = Math.sign(dx);
    const sy = Math.sign(dy);
    const [ux, uy] = Math.abs(dx) > Math.abs(dy) ? [sx, 0] : [0, sy];
    const legs: [number, number, number][] = diagonalFirst ? [[sx, sy, diag], [ux, uy, straight]] : [[ux, uy, straight], [sx, sy, diag]];
    for (const [lx, ly, n] of legs) for (let k = 0; k < n; k++) {
      const [px, py] = out[out.length - 1]!;
      out.push([px + lx, py + ly]);
    }
  }
  return out;
}

/** A window's lattice: how many steps across and down, and where the first one's middle is. */
export function latticeOf(cols: number, rows: number) {
  const lx = Math.max(8, Math.floor(cols / STEP_COLS));
  const ly = Math.max(6, Math.floor(rows / STEP_ROWS));
  return { lx, ly, oc: Math.floor((cols - lx * STEP_COLS) / 2), or: Math.floor((rows - ly * STEP_ROWS) / 2) };
}

/** A line laid out on a window: its points along it in px, how far along each is, its stations
 *  (how far along, and which are interchanges), and its bends for drawing. */
export interface Route {
  /** x, y of each lattice point along it. */
  pts: Float32Array;
  /** Distance along it at each point. */
  along: Float32Array;
  length: number;
  /** Its stations, in order along it: how far along, which point, and whether lines meet there. */
  stops: { s: number; i: number; x: number; y: number; interchange: boolean; end: boolean }[];
  /** Its bends, x, y: what is drawn. */
  bends: Float32Array;
}

export interface Layout {
  routes: Route[];
  river: Float32Array;
  parks: { x0: number; y0: number; x1: number; y1: number }[];
  districts: { name: string; x: number; y: number }[];
  /** Where lines meet: x, y, and which lines. */
  interchanges: { x: number; y: number; lines: number[] }[];
  /** One step of the lattice, in px across and down. */
  ux: number;
  uy: number;
}

/** Lay `spec`'s first `n` lines out on a window of `cols` by `rows` cells `cw` by `ch` px. */
export function layoutOf(spec: MapSpec, n: number, cols: number, rows: number, cw: number, ch: number): Layout {
  const { lx, ly, oc, or } = latticeOf(cols, rows);
  const toLattice = ([u, v]: Pt): Pt => [Math.round(u * (lx - 1)), Math.round(v * (ly - 1))];
  const px = ([i, j]: Pt): Pt => [(oc + i * STEP_COLS + 1.5) * cw, (or + j * STEP_ROWS + 0.5) * ch];
  const lines = spec.lines.slice(0, n).map((l) => routeAll(l.vertices.map(toLattice)));
  const meet = new Map<string, Set<number>>();
  lines.forEach((pts, k) => { for (const p of pts) { const key = `${p}`; (meet.get(key) ?? meet.set(key, new Set()).get(key)!).add(k); } });
  const routes = lines.map((pts, k): Route => {
    const xy = new Float32Array(pts.length * 2);
    const along = new Float32Array(pts.length);
    pts.forEach((p, i) => {
      const [x, y] = px(p);
      xy[i * 2] = x;
      xy[i * 2 + 1] = y;
      if (i) along[i] = along[i - 1]! + Math.hypot(x - xy[i * 2 - 2]!, y - xy[i * 2 - 1]!);
    });
    // Its stations: those made with it, each where it now passes nearest; every point where it meets
    // another line; and its ends. A station a step from an interchange gives way to it.
    const at = new Set<number>([0, pts.length - 1]);
    for (const st of spec.lines[k]!.stations) {
      const [i0, j0] = toLattice(st);
      let best = 0;
      let bd = Infinity;
      pts.forEach(([i, j], idx) => { const d = Math.abs(i - i0) + Math.abs(j - j0); if (d < bd) { bd = d; best = idx; } });
      at.add(best);
    }
    const inter = new Set<number>();
    pts.forEach((p, i) => { if ((meet.get(`${p}`)?.size ?? 0) > 1) { at.add(i); inter.add(i); } });
    const key = (i: number) => inter.has(i) || i === 0 || i === pts.length - 1;
    const kept: number[] = [];
    for (const i of [...at].sort((a, b) => a - b)) {
      if (!key(i) && [...inter].some((j) => Math.abs(j - i) <= 1)) continue;
      const prev = kept[kept.length - 1];
      // Two a step apart: the interchange or the end stays.
      if (prev !== undefined && i - prev <= 1 && !(key(i) && key(prev))) {
        if (key(i)) kept[kept.length - 1] = i;
        continue;
      }
      kept.push(i);
    }
    const stops = kept.map((i) => ({ s: along[i]!, i, x: xy[i * 2]!, y: xy[i * 2 + 1]!, interchange: inter.has(i), end: i === 0 || i === pts.length - 1 }));
    // Its bends: where the way it goes changes.
    const bends: number[] = [xy[0]!, xy[1]!];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!, b = pts[i]!, c = pts[i + 1]!;
      if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) bends.push(xy[i * 2]!, xy[i * 2 + 1]!);
    }
    bends.push(xy[xy.length - 2]!, xy[xy.length - 1]!);
    return { pts: xy, along, length: along[pts.length - 1]!, stops, bends: Float32Array.from(bends) };
  });
  const riverPts = routeAll(spec.river.map(toLattice), true);
  const river: number[] = [];
  riverPts.forEach((p, i) => {
    const a = riverPts[i - 1], c = riverPts[i + 1];
    if (!a || !c || p[0] - a[0] !== c[0] - p[0] || p[1] - a[1] !== c[1] - p[1]) river.push(...px(p));
  });
  // The river runs off both sides of the window.
  if (river.length >= 4) {
    river[0] = -STEP_COLS * cw;
    river[river.length - 2] = (cols + STEP_COLS) * cw;
  }
  const interchanges = [...meet.entries()].filter(([, s]) => s.size > 1).map(([key, s]) => {
    const [i, j] = key.split(",").map(Number) as Pt;
    const [x, y] = px([i, j]);
    return { x, y, lines: [...s] };
  });
  const box = (u: number, v: number): Pt => px(toLattice([u, v]));
  return {
    routes,
    river: Float32Array.from(river),
    parks: spec.parks.map((p) => { const [x0, y0] = box(p.x0, p.y0); const [x1, y1] = box(p.x1, p.y1); return { x0, y0, x1, y1 }; }),
    districts: spec.districts.map((d) => ({ name: d.name, x: (oc + d.x * (lx - 1) * STEP_COLS + 1.5) * cw, y: (or + d.y * (ly - 1) * STEP_ROWS + 0.5) * ch })),
    interchanges,
    ux: STEP_COLS * cw,
    uy: STEP_ROWS * ch,
  };
}

/** Where along `route` is nearest (x, y): the distance along it, and how far away. */
export function nearestOn(route: Route, x: number, y: number) {
  const p = route.pts;
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]!, ay = p[i + 1]!, bx = p[i + 2]!, by = p[i + 3]!;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
    const d = Math.hypot(ax + dx * t - x, ay + dy * t - y);
    if (d < best.d) best = { s: route.along[i >> 1]! + t * Math.sqrt(len2), d };
  }
  return best;
}

/** The point `s` along `route`, and the way it runs there. */
export function pointOn(route: Route, s: number, out: { x: number; y: number; dx: number; dy: number }) {
  const { along, pts } = route;
  const n = along.length;
  s = clamp(s, 0, route.length);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (along[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const seg = along[hi]! - along[lo]! || 1;
  const t = (s - along[lo]!) / seg;
  const ax = pts[lo * 2]!, ay = pts[lo * 2 + 1]!, bx = pts[hi * 2]!, by = pts[hi * 2 + 1]!;
  out.x = ax + (bx - ax) * t;
  out.y = ay + (by - ay) * t;
  out.dx = (bx - ax) / seg;
  out.dy = (by - ay) / seg;
  return out;
}
