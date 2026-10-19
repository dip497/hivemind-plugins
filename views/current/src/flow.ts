// What Current draws, worked out from the workspace and nothing else, so it can be checked without a
// screen: a spring for each agent, the stream that carries its work down to you, and how far the
// water of an agent calling you has backed up.
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

export function callReason(agent?: ViewAgentStatus): string {
  switch (agent?.waitingFor) {
    case "permission": return "needs your permission";
    case "question": return "has a question";
    case "plan": return "has a plan for you";
    case "approval": return "wants your approval";
    default: return "needs you";
  }
}

export const TONE: Record<Mood, string> = { calling: "attention", working: "working", failed: "failed", done: "done", idle: "idle", gone: "exited" };

export interface Pt { x: number; y: number }
export interface Spring { tileId: string; frameId: string; at: Pt; /** the way down to you, as points */ path: Pt[]; length: number }
export interface Basin { frameId: string; title: string; color: string; x: number; w: number; /** where its streams meet */ meet: Pt; parentId?: string; subtitle: string }
export interface Canal { a: string; b: string; kind: "spawn" | "pipe"; path: Pt[]; length: number }

export const LOOSE = "loose";

/** Points along a cubic curve. */
function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y });
  }
  return out;
}
export function lengthOf(path: Pt[]): number {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return l;
}
/** The point `t` (0 to 1) of the way along a path. */
export function along(path: Pt[], length: number, t: number): Pt {
  let want = Math.max(0, Math.min(1, t)) * length;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, d = Math.hypot(b.x - a.x, b.y - a.y);
    if (want <= d || i === path.length - 1) { const k = d ? Math.min(1, want / d) : 0; return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }
    want -= d;
  }
  return path[path.length - 1] ?? { x: 0, y: 0 };
}

/**
 * The landscape for a view `w` by `h`: each frame a basin across the top, as wide as its agents
 * need, a worktree beside the frame it came from; its agents springs in the basin; every stream
 * meeting the others of its frame, then running down to you, the lake at the bottom.
 */
export function landscape(frames: ViewFrame[], tiles: ViewTile[], links: { a: string; b: string; kind: "spawn" | "pipe" }[], w: number, h: number, top = 96) {
  const agents = tiles.filter((t) => t.agent);
  const known = new Set(frames.map((f) => f.id));
  const frameOf = (t: ViewTile) => (t.frameId && known.has(t.frameId) ? t.frameId : LOOSE);
  // Parents first, each followed by its worktrees.
  const order: (ViewFrame | { id: string; title: string; color: string; parentId?: string })[] = [];
  for (const f of frames.filter((f) => !f.parentId || !known.has(f.parentId))) {
    order.push(f);
    for (const c of frames.filter((c) => c.parentId === f.id)) order.push(c);
  }
  if (agents.some((t) => frameOf(t) === LOOSE)) order.push({ id: LOOSE, title: "Not in a frame", color: "#8a94a6" });
  const used = order.filter((f) => agents.some((t) => frameOf(t) === f.id) || f.id !== LOOSE);
  const lake: Pt = { x: w / 2, y: h - 70 };
  const margin = 40, room = w - margin * 2;
  const weight = used.map((f) => Math.max(1, Math.sqrt(agents.filter((t) => frameOf(t) === f.id).length)));
  const total = weight.reduce((a, b) => a + b, 0) || 1;
  const basins = new Map<string, Basin>();
  let x = margin;
  used.forEach((f, i) => {
    const bw = (weight[i]! / total) * room;
    const meetY = top + (h - top) * 0.56;
    basins.set(f.id, {
      frameId: f.id, title: f.title, color: f.color, x, w: bw, meet: { x: x + bw / 2, y: meetY },
      ...("parentId" in f && f.parentId ? { parentId: f.parentId } : {}),
      subtitle: "branch" in f ? [f.branch, f.machine?.name].filter(Boolean).join(" · ") : "",
    });
    x += bw;
  });
  const springs = new Map<string, Spring>();
  for (const b of basins.values()) {
    const mine = agents.filter((t) => frameOf(t) === b.frameId);
    const cols = Math.max(1, Math.min(mine.length, Math.floor(b.w / 64)));
    const rows = Math.ceil(mine.length / cols);
    const bandTop = top + 70, bandBottom = top + (h - top) * 0.38;
    const rowGap = rows > 1 ? Math.min(78, (bandBottom - bandTop) / (rows - 1)) : 0;
    mine.forEach((t, k) => {
      const r = Math.floor(k / cols), c = k % cols;
      const inRow = Math.min(cols, mine.length - r * cols);
      const at = { x: b.x + (b.w * (c + 0.5 + (cols - inRow) / 2)) / cols + (r % 2 ? 10 : -10) * (cols > 1 ? 1 : 0), y: bandTop + r * rowGap };
      const down = cubic(at, { x: at.x, y: at.y + (b.meet.y - at.y) * 0.55 }, { x: b.meet.x, y: b.meet.y - (b.meet.y - at.y) * 0.45 }, b.meet, 16);
      const out = { x: lake.x + (b.meet.x - lake.x) * 0.35, y: lake.y - 10 };
      const rest = cubic(b.meet, { x: b.meet.x, y: b.meet.y + (lake.y - b.meet.y) * 0.5 }, { x: out.x, y: lake.y - (lake.y - b.meet.y) * 0.4 }, out, 16);
      const path = [...down, ...rest.slice(1)];
      springs.set(t.id, { tileId: t.id, frameId: b.frameId, at, path, length: lengthOf(path) });
    });
  }
  const canals: Canal[] = [];
  for (const l of links) {
    const a = springs.get(l.a), b = springs.get(l.b);
    if (!a || !b) continue;
    const lift = Math.min(Math.max(40, Math.abs(a.at.x - b.at.x) * 0.25), Math.min(a.at.y, b.at.y) - top + 20);
    const path = cubic(a.at, { x: a.at.x, y: a.at.y - lift }, { x: b.at.x, y: b.at.y - lift }, b.at, 24);
    canals.push({ ...l, path, length: lengthOf(path) });
  }
  return { basins, springs, canals, lake };
}

/** How far the water of an agent calling you has backed up after `ms`: a pool that keeps growing,
 *  quickly at first, so a long wait is plainly bigger than a short one. */
export function poolRadius(ms: number): number {
  return 12 + Math.min(46, Math.sqrt(Math.max(0, ms) / 1000) * 2.6);
}

/** The agents calling the person, the one calling longest first. */
export function callers(list: { tileId: string; mood: Mood; since: number }[]): { tileId: string; since: number }[] {
  return list.filter((c) => c.mood === "calling").sort((a, b) => a.since - b.since).map(({ tileId, since }) => ({ tileId, since }));
}

export function census(moods: Mood[]): Record<Mood, number> {
  const out: Record<Mood, number> = { calling: 0, working: 0, failed: 0, done: 0, idle: 0, gone: 0 };
  for (const m of moods) out[m]++;
  return out;
}

export function howLong(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
