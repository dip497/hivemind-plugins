// What the island draws, worked out from the workspace and nothing else, so it can be checked
// without a screen: where each island sits, what its land looks like, where each agent works and
// what each agent is doing.
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

export interface Island {
  id: string;
  title: string;
  color: string;
  biome: Biome;
  x: number;
  z: number;
  /** How far its shore reaches. */
  r: number;
  seed: number;
  /** The island it was made from, for a worktree. */
  parentId?: string;
  subtitle: string;
}

/** Where an agent (or another tile) stands on its island. */
export interface Spot { tileId: string; islandId: string; x: number; z: number; agent: boolean; /** which way its door faces */ facing: number }

/** Tiles in no frame live on an island of their own. */
export const LOOSE = "loose";

/** How big an island is for what lives on it. */
export function islandRadius(agents: number, others: number): number {
  return 5 + Math.sqrt(agents) * 1.9 + Math.sqrt(others) * 0.7;
}

/**
 * Where every island sits: projects on a spiral out from the middle, a worktree just off the
 * shore of the island it was made from, then pushed apart until no two shores touch.
 */
export function layout(frames: ViewFrame[], tiles: ViewTile[]): { islands: Map<string, Island>; spots: Map<string, Spot> } {
  const byFrame = new Map<string, ViewTile[]>();
  for (const t of tiles) {
    const k = t.frameId && frames.some((f) => f.id === t.frameId) ? t.frameId : LOOSE;
    byFrame.set(k, [...(byFrame.get(k) ?? []), t]);
  }
  const list: Island[] = frames.map((f) => {
    const on = byFrame.get(f.id) ?? [];
    const agents = on.filter((t) => t.agent).length;
    return {
      id: f.id, title: f.title, color: f.color, biome: biomeOf(f, frames), x: 0, z: 0,
      r: islandRadius(agents, on.length - agents) * (f.parentId ? 0.8 : 1), seed: hash(f.id),
      ...(f.parentId && frames.some((p) => p.id === f.parentId) ? { parentId: f.parentId } : {}),
      subtitle: [f.branch, f.machine?.name].filter(Boolean).join(" · "),
    };
  });
  const loose = byFrame.get(LOOSE);
  if (loose?.length) {
    const agents = loose.filter((t) => t.agent).length;
    list.push({ id: LOOSE, title: "Not in a frame", color: "#8a94a6", biome: "meadow", x: 0, z: 0, r: islandRadius(agents, loose.length - agents), seed: hash(LOOSE), subtitle: "" });
  }
  const at = new Map(list.map((i) => [i.id, i]));
  const top = list.filter((i) => !i.parentId);
  const golden = Math.PI * (3 - Math.sqrt(5));
  top.forEach((isl, k) => {
    const d = k === 0 ? 0 : 9 * Math.sqrt(k + 0.4);
    isl.x = Math.cos(k * golden) * d * 1.6;
    isl.z = Math.sin(k * golden) * d * 1.6;
  });
  const BRIDGE = 3, GAP = 5;
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
  for (let pass = 0; pass < 120; pass++) {
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
    const on = byFrame.get(isl.id) ?? [];
    const agents = on.filter((t) => t.agent), rest = on.filter((t) => !t.agent);
    const rand = random(isl.seed ^ 0x9e3779b9);
    const turn = rand() * Math.PI * 2;
    // Agents on rings around the middle, the inner ring first; other tiles near the middle.
    let placed = 0, ring = 0;
    while (placed < agents.length) {
      const rr = isl.r * (0.42 + ring * 0.22);
      const room = Math.max(1, Math.floor((2 * Math.PI * rr) / 3.1));
      const here = Math.min(room, agents.length - placed);
      for (let k = 0; k < here; k++) {
        const a = turn + ring * 0.5 + (k / here) * Math.PI * 2;
        const t = agents[placed + k]!;
        spots.set(t.id, { tileId: t.id, islandId: isl.id, x: isl.x + Math.cos(a) * rr, z: isl.z + Math.sin(a) * rr, agent: true, facing: a });
      }
      placed += here;
      ring++;
    }
    rest.forEach((t, k) => {
      const a = turn + Math.PI / 5 + (k / Math.max(rest.length, 1)) * Math.PI * 2;
      const rr = isl.r * 0.2 + (k % 2) * 0.6;
      spots.set(t.id, { tileId: t.id, islandId: isl.id, x: isl.x + Math.cos(a) * rr, z: isl.z + Math.sin(a) * rr, agent: false, facing: a });
    });
  }
  return { islands: at, spots };
}

/** Smooth noise in [0, 1], the same for the same seed and place. */
function noise(seed: number, x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const v = (i: number, j: number) => {
    let h = Math.imul(seed ^ Math.imul(i, 374761393) ^ Math.imul(j, 668265263), 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = v(xi, zi), b = v(xi + 1, zi), c = v(xi, zi + 1), d = v(xi + 1, zi + 1);
  const u = s(xf), w = s(zf);
  return a + (b - a) * u + (c - a) * w + (a - b - c + d) * u * w;
}

/** The sea is at height 0; land rises from the shore to the hills in the middle. */
export function heightAt(isl: Island, x: number, z: number): number {
  const dx = x - isl.x, dz = z - isl.z;
  const ang = Math.atan2(dz, dx);
  // A wobbly shore, so no island is a circle.
  const shore = isl.r * (0.88 + 0.18 * noise(isl.seed, Math.cos(ang) * 1.6 + 7, Math.sin(ang) * 1.6 + 7));
  const t = Math.hypot(dx, dz) / shore;
  if (t >= 1.12) return -1.2;
  const fall = t < 1 ? 1 - t * t * t : 0;
  const hills = noise(isl.seed + 1, x * 0.16, z * 0.16) * 0.7 + noise(isl.seed + 2, x * 0.45, z * 0.45) * 0.3;
  const centre = Math.max(0, 1 - t / 0.35);
  return -1.2 + fall * (1.75 + hills * 1.6) + centre * centre * isl.r * 0.12 * (0.6 + hills);
}

/** Where the land is flat enough to build: a little terrace at an agent's spot. */
export function groundAt(isl: Island, spots: Spot[], x: number, z: number): number {
  let h = heightAt(isl, x, z);
  for (const s of spots) {
    if (s.islandId !== isl.id) continue;
    const d = Math.hypot(x - s.x, z - s.z);
    if (d < 1.9) {
      const flat = Math.max(0.35, heightAt(isl, s.x, s.z));
      const k = d < 1.1 ? 1 : 1 - (d - 1.1) / 0.8;
      h = h + (flat - h) * k;
    }
  }
  return h;
}

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
