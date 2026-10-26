// What Island draws, worked out from the workspace and nothing else, so it can be checked without
// a screen: each project an island of hexagon tiles, each agent a home on it with lots around it
// where its finished turns build a village, and the sky by the hour.
import type { ViewAgentStatus, ViewFrame, ViewStatus, ViewTile } from "@hivemind/view-sdk";

export type Mood = "calling" | "working" | "failed" | "done" | "idle" | "gone";

/** What an agent is doing, from its status and what it reports. */
export function moodOf(status: ViewStatus | undefined, agent?: ViewAgentStatus): Mood {
  const s = agent?.state;
  if (status === "blocked" || s === "waiting") return "calling";
  if (s === "failed" || s === "limited") return "failed";
  if (status === "exited" || s === "exited") return "gone";
  if (status === "working" || s === "working") return "working";
  if (s === "done") return "done";
  return "idle";
}

/** Why a calling agent wants the person, in a few words. */
export function callReason(agent?: ViewAgentStatus): string {
  switch (agent?.waitingFor) {
    case "permission": return "needs your permission";
    case "question": return "has a question";
    case "plan": return "has a plan for you";
    case "approval": return "wants your approval";
    default: return "needs you";
  }
}

/** The tone the app paints each mood in (`--hm-status-<tone>`). */
export const TONE: Record<Mood, string> = { calling: "attention", working: "working", failed: "failed", done: "done", idle: "idle", gone: "exited" };

export type Biome = "meadow" | "blossom" | "autumn" | "snow";

const BIOMES: Biome[] = ["meadow", "autumn", "blossom", "snow"];

/** Each project its own season, the same every time; a worktree has the land of the island it came from. */
export function biomeOf(frame: { id: string; parentId?: string }, frames: { id: string; parentId?: string }[]): Biome {
  let f = frame;
  for (let k = 0; k < 8 && f.parentId; k++) {
    const p = frames.find((x) => x.id === f.parentId);
    if (!p) break;
    f = p;
  }
  return BIOMES[hash(f.id) % BIOMES.length]!;
}

/** A number from a string, the same every time. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Random numbers that come out the same for the same seed. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Colour = "blue" | "green" | "red" | "yellow";
const COLOURS: [Colour, number][] = [["blue", 215], ["green", 130], ["red", 5], ["yellow", 48]];
/** The building colour nearest a frame's own colour, so an island wears its project's colour. */
export function colourOf(hex: string): Colour {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "blue";
  const n = parseInt(m[1]!, 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.08) return "blue";
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  let best: Colour = "blue", d = 999;
  for (const [c, at] of COLOURS) { const x = Math.min(Math.abs(h - at), 360 - Math.abs(h - at)); if (x < d) { d = x; best = c; } }
  return best;
}

/** What is written on a fill of this colour: black on a light one, white on a dark one, so words on
 *  the theme's attention or accent colour read at 4.5:1 whatever colour the person gave it. The pins
 *  (pins.ts) draw their marks by the same rule. */
export function inkOn(hex: string): "#000" | "#fff" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1]!, 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  // Black and white read the same, 4.58:1 each, on a colour whose luminance is 0.179.
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.179 ? "#000" : "#fff";
}

/** A theme colour as paint and light in the scene (a calling agent's beam, its ring, a ship's flag and
 *  lantern): its hue and saturation, at least half lit. A light theme's attention is dark, so that words
 *  in it read on a pale page; as paint on a sunlit sea it would read black. */
export function lit(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const rgb = [n >> 16, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const l = (Math.max(...rgb) + Math.min(...rgb)) / 2;
  if (l >= 0.5) return `#${m[1]}`;
  // Below half, scaling the channels moves the lightness and keeps the hue and the saturation.
  return `#${rgb.map((c) => Math.round((l === 0 ? 0.5 : (c * 0.5) / l) * 255).toString(16).padStart(2, "0")).join("")}`;
}

// ── hexagon tiles ───────────────────────────────────────────────────────────
/** Tiles are two wide; rows of them sit √3 apart, every other row half a tile over. */
export const TILE = 2;
export const ROW = Math.sqrt(3);
export const NEXT: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
export const tileX = (q: number, r: number) => TILE * (q + r / 2);
export const tileZ = (r: number) => ROW * r;
/** Tiles apart, along the grid. */
export const tilesApart = (a: { q: number; r: number }, b: { q: number; r: number }) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.q + a.r - b.q - b.r)) / 2;

/** What a tile holds. */
export type Use = "keep" | "home" | "lot" | "field" | "forest" | "hill" | "grass" | "tent";
export interface Cell {
  q: number; r: number;
  /** its middle, in the world */
  x: number; z: number;
  use: Use;
  /** the tile whose home or lot it is, or that pitches its tent here */
  owner?: string;
  /** a whole turn of the tile, in sixths, so no two forests look alike */
  turn: number;
}

export interface Island {
  id: string;
  title: string;
  color: string;
  colour: Colour;
  biome: Biome;
  x: number;
  z: number;
  /** How far its shore reaches from the middle. */
  r: number;
  seed: number;
  /** The island it was made from, for a worktree. */
  parentId?: string;
  subtitle: string;
  cells: Cell[];
}

/** Where an agent (or another tile) lives: its home tile, and the lots it builds on, nearest first. */
export interface Spot { tileId: string; islandId: string; x: number; z: number; agent: boolean; /** which way its door faces */ facing: number; lots: Cell[] }

/** Tiles in no frame live on an island of their own. */
export const LOOSE = "loose";

/** How many lots each agent builds on. */
export const LOTS = 4;
/** Turns a lot takes: the ground laid, the frame up, the house finished. */
export const STEPS = 3;

/** How many tiles an island needs for what lives on it. */
export function tilesFor(agents: number, others: number): number {
  return Math.ceil(agents * (1 + LOTS) * 1.4) + others + 7;
}

/** An island of `n` tiles grown out from its middle, its shore made ragged by its seed. */
function grow(n: number, seed: number): { q: number; r: number }[] {
  const rand = random(seed ^ 0x6a09e667);
  const key = (q: number, r: number) => `${q},${r}`;
  const taken = new Map<string, { q: number; r: number }>([[key(0, 0), { q: 0, r: 0 }]]);
  const edge = new Map<string, { q: number; r: number; w: number }>();
  const reach = (q: number, r: number) => {
    for (const [dq, dr] of NEXT) {
      const k = key(q + dq, r + dr);
      if (taken.has(k) || edge.has(k)) continue;
      const c = { q: q + dq, r: r + dr };
      edge.set(k, { ...c, w: tilesApart(c, { q: 0, r: 0 }) + rand() * 1.6 });
    }
  };
  reach(0, 0);
  while (taken.size < n) {
    let best: [string, { q: number; r: number; w: number }] | null = null;
    for (const e of edge) if (!best || e[1].w < best[1].w) best = e;
    const [k, c] = best!;
    edge.delete(k);
    taken.set(k, { q: c.q, r: c.r });
    reach(c.q, c.r);
  }
  return [...taken.values()];
}

/**
 * Where every island sits and what each tile holds: projects on a spiral out from the middle, a
 * worktree just off the shore of the island it was made from, all pushed apart until no two shores
 * touch; on each, the keep in the middle, a home for every agent spread across it, and the lots it
 * builds on around its home.
 */
export function layout(frames: ViewFrame[], tiles: ViewTile[]): { islands: Map<string, Island>; spots: Map<string, Spot> } {
  const byFrame = new Map<string, ViewTile[]>();
  for (const t of tiles) {
    const k = t.frameId && frames.some((f) => f.id === t.frameId) ? t.frameId : LOOSE;
    byFrame.set(k, [...(byFrame.get(k) ?? []), t]);
  }
  const make = (id: string, title: string, color: string, biome: Biome, parentId: string | undefined, subtitle: string): Island => {
    const on = byFrame.get(id) ?? [];
    const agents = on.filter((t) => t.agent).length;
    const seed = hash(id);
    const cells = grow(tilesFor(agents, on.length - agents) * (parentId ? 0.85 : 1), seed).map(({ q, r }) => ({ q, r, x: tileX(q, r), z: tileZ(r), use: "grass" as Use, turn: 0 }));
    const r = Math.max(...cells.map((c) => Math.hypot(c.x, c.z))) + TILE * 0.6;
    return { id, title, color, colour: colourOf(color), biome, x: 0, z: 0, r, seed, ...(parentId ? { parentId } : {}), subtitle, cells };
  };
  const list: Island[] = frames.map((f) => make(f.id, f.title, f.color, biomeOf(f, frames), f.parentId && frames.some((p) => p.id === f.parentId) ? f.parentId : undefined, [f.branch, f.machine?.name].filter(Boolean).join(" · ")));
  if (byFrame.get(LOOSE)?.length) list.push(make(LOOSE, "Not in a frame", "#8a94a6", "meadow", undefined, ""));
  const at = new Map(list.map((i) => [i.id, i]));
  const top = list.filter((i) => !i.parentId);
  const golden = Math.PI * (3 - Math.sqrt(5));
  top.forEach((isl, k) => {
    const d = k === 0 ? 0 : 6.5 * Math.sqrt(k + 0.4);
    isl.x = Math.cos(k * golden) * d;
    isl.z = Math.sin(k * golden) * d;
  });
  const BRIDGE = 2.5, GAP = 3;
  const kids = new Map<string, number>();
  for (const isl of list) {
    if (!isl.parentId) continue;
    const p = at.get(isl.parentId)!;
    const k = kids.get(p.id) ?? 0;
    kids.set(p.id, k + 1);
    const out = (Math.hypot(p.x, p.z) < 0.01 ? 0.6 : Math.atan2(p.z, p.x)) + (k % 2 ? 1 : -1) * (0.55 + Math.floor(k / 2) * 0.7);
    const d = p.r + isl.r + BRIDGE;
    isl.x = p.x + Math.cos(out) * d;
    isl.z = p.z + Math.sin(out) * d;
  }
  // Push shores apart, wider than any bridge, so a worktree is plainly nearest the island it came from.
  for (let pass = 0; pass < 160; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!, b = list[j]!;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz) || 0.001;
        const need = a.r + b.r + (a.parentId === b.id || b.parentId === a.id ? BRIDGE : GAP);
        if (d >= need) continue;
        moved = true;
        const push = (need - d) / 2, ux = dx / d, uz = dz / d;
        a.x -= ux * push; a.z -= uz * push;
        b.x += ux * push; b.z += uz * push;
      }
    }
    for (const isl of list) {
      if (!isl.parentId) continue;
      const p = at.get(isl.parentId)!;
      const dx = isl.x - p.x, dz = isl.z - p.z, d = Math.hypot(dx, dz) || 0.001, want = p.r + isl.r + BRIDGE;
      if (d > want) { isl.x = p.x + (dx / d) * want; isl.z = p.z + (dz / d) * want; }
    }
    if (!moved) break;
  }
  const spots = new Map<string, Spot>();
  for (const isl of list) {
    for (const c of isl.cells) { c.x += isl.x; c.z += isl.z; }
    settle(isl, byFrame.get(isl.id) ?? [], spots);
  }
  return { islands: at, spots };
}

/** What each tile of an island holds. */
function settle(isl: Island, on: ViewTile[], spots: Map<string, Spot>): void {
  const rand = random(isl.seed ^ 0x3c6ef372);
  const cells = isl.cells;
  const middle = cells[0]!;
  middle.use = "keep";
  for (const c of cells) c.turn = Math.floor(rand() * 6);
  const agents = on.filter((t) => t.agent), rest = on.filter((t) => !t.agent);
  // Homes spread out: each the free tile farthest from the keep and every home so far, a ring in.
  const shore = new Set(cells.filter((c) => NEXT.filter(([dq, dr]) => cells.some((o) => o.q === c.q + dq && o.r === c.r + dr)).length < 6));
  const homes: Cell[] = [];
  for (const t of agents) {
    let best: Cell | null = null, bd = -1;
    for (const c of cells) {
      if (c.use !== "grass") continue;
      const near = Math.min(tilesApart(c, middle) * 0.9, ...homes.map((h) => tilesApart(c, h)));
      const score = near - (shore.has(c) ? 0.6 : 0) + rand() * 0.2;
      if (tilesApart(c, middle) >= 1 && score > bd) { bd = score; best = c; }
    }
    if (!best) break;
    best.use = "home";
    best.owner = t.id;
    homes.push(best);
  }
  // Lots: every home in turn takes the nearest free tile, until each has its lots.
  const lots = new Map<string, Cell[]>(homes.map((h) => [h.owner!, []]));
  for (let round = 0; round < LOTS; round++) {
    for (const h of homes) {
      let best: Cell | null = null, bd = Infinity;
      for (const c of cells) {
        if (c.use !== "grass") continue;
        const d = tilesApart(c, h) + (shore.has(c) ? 0.3 : 0) + rand() * 0.1;
        if (d < bd) { bd = d; best = c; }
      }
      if (!best || tilesApart(best, h) > 3) continue;
      best.use = "lot";
      best.owner = h.owner!;
      lots.get(h.owner!)!.push(best);
    }
  }
  // Tents for the other tiles, near the keep.
  for (const t of rest) {
    let best: Cell | null = null, bd = Infinity;
    for (const c of cells) if (c.use === "grass" && tilesApart(c, middle) < bd) { bd = tilesApart(c, middle); best = c; }
    if (!best) break;
    best.use = "tent";
    best.owner = t.id;
    spots.set(t.id, { tileId: t.id, islandId: isl.id, x: best.x, z: best.z, agent: false, facing: Math.atan2(middle.z - best.z, middle.x - best.x), lots: [] });
  }
  // The rest: fields beside homes, forest and hills out by the shore, meadow between.
  for (const c of cells) {
    if (c.use !== "grass") continue;
    const nearHome = homes.some((h) => tilesApart(c, h) <= 1);
    const roll = rand();
    if (nearHome) c.use = roll < 0.45 ? "field" : "grass";
    else if (shore.has(c)) c.use = roll < 0.35 ? "forest" : roll < 0.45 ? "hill" : "grass";
    else c.use = roll < 0.25 ? "forest" : roll < 0.33 ? "hill" : "grass";
  }
  for (const h of homes) {
    spots.set(h.owner!, { tileId: h.owner!, islandId: isl.id, x: h.x, z: h.z, agent: true, facing: Math.atan2(middle.z - h.z, middle.x - h.x), lots: lots.get(h.owner!)! });
  }
}

/** The sea is at height 0; every tile's top a little above it. */
export const LAND = 0.25;

/** The agents calling the person, the one calling longest first. */
export function callers(list: { tileId: string; mood: Mood; since: number }[]): { tileId: string; since: number }[] {
  return list.filter((c) => c.mood === "calling").sort((a, b) => a.since - b.since).map(({ tileId, since }) => ({ tileId, since }));
}

/** How many agents are in each mood. */
export function census(moods: Mood[]): Record<Mood, number> {
  const out: Record<Mood, number> = { calling: 0, working: 0, failed: 0, done: 0, idle: 0, gone: 0 };
  for (const m of moods) out[m]++;
  return out;
}

/** "3 min", "1 h 4 min": how long, in words. */
export function howLong(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}



// ── the village each agent builds ───────────────────────────────────────────
/** Where each lot stands after `turns` finished turns: each turn takes the next lot one step, from
 *  laid ground to a frame to a finished house. A later count only adds to an earlier village. */
export function townOf(lots: number, turns: number): number[] {
  const steps: number[] = [];
  let left = Math.max(0, Math.floor(turns));
  for (let i = 0; i < lots && left > 0; i++) {
    const s = Math.min(STEPS, left);
    steps.push(s);
    left -= s;
  }
  return steps;
}
/** The most turns a village shows. */
export const MOST_TURNS = LOTS * STEPS;
/** How many rings of tiles in from the shore each tile is, up to `most`: 0 for a tile with sea
 *  beside it. An island rises a step with each ring, so its middle stands highest. */
export function ringsInland<C extends { q: number; r: number }>(cells: readonly C[], most: number): Map<C, number> {
  const near = (c: C) => cells.filter((o) => o !== c && tilesApart(o, c) === 1);
  const ring = new Map<C, number>();
  let edge = cells.filter((c) => near(c).length < 6);
  for (const c of edge) ring.set(c, 0);
  for (let d = 1; edge.length && d <= most; d++) {
    const next: C[] = [];
    for (const c of edge) for (const o of near(c)) if (!ring.has(o)) { ring.set(o, d); next.push(o); }
    edge = next;
  }
  for (const c of cells) if (!ring.has(c)) ring.set(c, most);
  return ring;
}
/** How many days of turns a town stands on: today's and the six before, so it is not bare each morning. */
export const TOWN_DAYS = 7;
/** A day as the host names it, `YYYY-MM-DD` in local time. */
export const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** The days before `d` a town also stands on, nearest first. */
export function daysBefore(d: Date, n = TOWN_DAYS - 1): string[] {
  return Array.from({ length: n }, (_, i) => dayOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i - 1)));
}
/** Turns a town stands on, by tile: the earlier days' added to today's. */
export function townTurns(earlier: ReadonlyMap<string, number>, today: ReadonlyMap<string, number>): Map<string, number> {
  const out = new Map(earlier);
  for (const [id, n] of today) out.set(id, (out.get(id) ?? 0) + n);
  return out;
}
/** What a finished house on lot `i` is: homes first, then the village's bigger buildings. */
export const HOUSES = ["home_A", "home_B", "tavern", "market"] as const;
export const houseOf = (i: number) => HOUSES[i % HOUSES.length]!;
/** What stands in the middle of an island after all its agents' turns today. */
export function keepOf(turns: number): string {
  return turns >= 24 ? "castle" : turns >= 12 ? "church" : turns >= 4 ? "windmill" : "well";
}

// ── the sky by the hour ─────────────────────────────────────────────────────
export interface Sky {
  /** the sun's light, its strength, and how high it stands (0 down, 1 overhead) */
  key: number; keyI: number; height: number;
  /** light from the sky above and the ground below */
  above: number; below: number; ambientI: number;
  top: number; horizon: number; deep: number; shallow: number;
  /** how bright lit windows and lamps are, 0 by day to 1 at night */
  lamps: number;
}
const KEYS: [number, Sky][] = [
  [0, { key: 0xa6bcf0, keyI: 1.05, height: 0.75, above: 0x41579a, below: 0x1e2640, ambientI: 1.2, top: 0x081130, horizon: 0x1e2d5e, deep: 0x0e2547, shallow: 0x22557e, lamps: 1 }],
  [5, { key: 0xa6bcf0, keyI: 0.95, height: 0.6, above: 0x41579a, below: 0x1e2640, ambientI: 1.15, top: 0x0d1a40, horizon: 0x2e3566, deep: 0x10284a, shallow: 0x265a80, lamps: 1 }],
  [6.5, { key: 0xffa978, keyI: 1.6, height: 0.12, above: 0xa9b4e0, below: 0x6a5060, ambientI: 1.0, top: 0x4a6aa8, horizon: 0xffb38a, deep: 0x2b5a80, shallow: 0x6fb6c4, lamps: 0.5 }],
  [8.5, { key: 0xfff0d8, keyI: 2.4, height: 0.45, above: 0xcfe6ff, below: 0x7f8a62, ambientI: 1.35, top: 0x6fb2e6, horizon: 0xd8eef4, deep: 0x1d6f9c, shallow: 0x6fdcd2, lamps: 0 }],
  [12.5, { key: 0xfff6e8, keyI: 2.6, height: 0.9, above: 0xd8ecff, below: 0x86906a, ambientI: 1.45, top: 0x5aa6e0, horizon: 0xd6f0f6, deep: 0x1a73a3, shallow: 0x74e2d6, lamps: 0 }],
  [16.5, { key: 0xffe2b8, keyI: 2.3, height: 0.4, above: 0xd6e2f6, below: 0x8a8060, ambientI: 1.3, top: 0x6aa6d8, horizon: 0xf2e2c8, deep: 0x1d6894, shallow: 0x70d4c8, lamps: 0.05 }],
  [18.5, { key: 0xff9a66, keyI: 1.5, height: 0.1, above: 0xb0a2d0, below: 0x5a4458, ambientI: 1.0, top: 0x3d4f8c, horizon: 0xff9e7a, deep: 0x2a4f78, shallow: 0x6a9cb4, lamps: 0.6 }],
  [20, { key: 0xb0c0ec, keyI: 1.1, height: 0.5, above: 0x4a5a94, below: 0x222840, ambientI: 1.2, top: 0x111c44, horizon: 0x3c4074, deep: 0x102a4c, shallow: 0x285c82, lamps: 1 }],
  [24, { key: 0xa6bcf0, keyI: 1.05, height: 0.75, above: 0x41579a, below: 0x1e2640, ambientI: 1.2, top: 0x081130, horizon: 0x1e2d5e, deep: 0x0e2547, shallow: 0x22557e, lamps: 1 }],
];
const mixHex = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + ((((b >> s) & 255) - ((a >> s) & 255)) * t));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};
/** The sky at `hour` (0 to 24, fractions allowed), eased between the hours that set it. */
export function skyAt(hour: number): Sky {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]![0] <= h) i++;
  const [h0, a] = KEYS[i]!, [h1, b] = KEYS[i + 1]!;
  const raw = (h - h0) / (h1 - h0);
  const t = raw * raw * (3 - 2 * raw);
  const out = {} as Sky;
  for (const k of Object.keys(a) as (keyof Sky)[]) {
    out[k] = k === "keyI" || k === "height" || k === "ambientI" || k === "lamps" ? a[k] + (b[k] - a[k]) * t : mixHex(a[k], b[k], t);
  }
  return out;
}
