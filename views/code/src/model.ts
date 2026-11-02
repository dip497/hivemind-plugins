// What Code keeps and works out, with no DOM: the workbench's layout (side bar, panel, editor groups
// and their tabs), the explorer's tree of frames and tiles, how a tile's state reads, and the quick
// open's fuzzy match. Every operation returns a new layout and leaves the one it was given alone, so
// React sees each change. tests/code.test.ts checks it.
import type { ViewAgentStatus, ViewFrame, ViewStatus, ViewTile } from "@hivemind/view-sdk";
import { groupOf, type Group as AgentGroup } from "../../focus/src/model";

export type { AgentGroup };
export { groupOf };

export type SideView = "explorer" | "search" | "agents";
export type PanelTab = "problems" | "output" | "terminal";

/** One editor group: its tabs in order, the one shown, the order they were last shown in (closing
 *  one shows the one before it, as VS Code does), and the tab opened as a preview (italic, replaced
 *  by the next preview) if there is one. */
export interface EditorGroup {
  id: string;
  tabs: string[];
  active: string | null;
  mru: string[];
  preview: string | null;
}

export interface Layout {
  v: 1;
  sidebar: { visible: boolean; width: number; view: SideView };
  panel: { visible: boolean; height: number; tab: PanelTab; maximized: boolean };
  /** Side by side, left to right; never empty. */
  groups: EditorGroup[];
  /** Each group's share of the editor area's width, summing to 1. */
  sizes: number[];
  activeGroup: string;
  /** The tiles shown in the panel's terminal, and the one shown. */
  terminals: string[];
  terminal: string | null;
  /** Frames folded shut in the explorer. */
  folded: string[];
  /** The side bar's sections folded shut (open editors, the workspace, timeline; an agents group). */
  shut: string[];
}

/** VS Code's own limits: a side bar of 170px at least, a panel of 77px, an editor of 220px. */
export const SIDEBAR_MIN = 170;
export const PANEL_MIN = 77;
export const GROUP_MIN = 220;
/** At most four groups side by side: a surface each, with the panel's, well under the host's 16. */
export const MAX_GROUPS = 4;

const SIDE_VIEWS: readonly SideView[] = ["explorer", "search", "agents"];
const PANEL_TABS: readonly PanelTab[] = ["problems", "output", "terminal"];

export function emptyGroup(id = "g1"): EditorGroup {
  return { id, tabs: [], active: null, mru: [], preview: null };
}

export function defaultLayout(): Layout {
  return {
    v: 1,
    sidebar: { visible: true, width: 256, view: "explorer" },
    panel: { visible: false, height: 260, tab: "terminal", maximized: false },
    groups: [emptyGroup()],
    sizes: [1],
    activeGroup: "g1",
    terminals: [],
    terminal: null,
    folded: [],
    shut: ["open-editors", "timeline"],
  };
}

const strings = (v: unknown, max = 512): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 256))].slice(0, max) : [];
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

/** A layout as saved before, or the default where it is missing, corrupt or from elsewhere: a blob
 *  that does not parse never stops the view mounting. */
export function parseLayout(raw: unknown): Layout {
  const d = defaultLayout();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return d;
  const sb = (r.sidebar ?? {}) as Record<string, unknown>;
  const pn = (r.panel ?? {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const groups: EditorGroup[] = [];
  for (const g of Array.isArray(r.groups) ? r.groups.slice(0, MAX_GROUPS) : []) {
    if (!g || typeof g !== "object") continue;
    const o = g as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id && !groups.some((x) => x.id === o.id) ? o.id : `g${groups.length + 1}`;
    // A tile is open in one place only: a tab seen in an earlier group is dropped.
    const tabs = strings(o.tabs).filter((t) => !seen.has(t));
    tabs.forEach((t) => seen.add(t));
    const active = typeof o.active === "string" && tabs.includes(o.active) ? o.active : tabs[0] ?? null;
    const mru = [...strings(o.mru).filter((t) => tabs.includes(t)), ...tabs].filter((t, i, a) => a.indexOf(t) === i);
    const preview = typeof o.preview === "string" && tabs.includes(o.preview) ? o.preview : null;
    groups.push({ id, tabs, active, mru, preview });
  }
  if (!groups.length) groups.push(emptyGroup());
  const sizes = Array.isArray(r.sizes) && r.sizes.length === groups.length && r.sizes.every((s) => typeof s === "number" && s > 0 && Number.isFinite(s))
    ? normalise(r.sizes as number[]) : groups.map(() => 1 / groups.length);
  const terminals = strings(r.terminals, 64).filter((t) => !seen.has(t));
  return {
    v: 1,
    sidebar: {
      visible: typeof sb.visible === "boolean" ? sb.visible : d.sidebar.visible,
      width: num(sb.width, SIDEBAR_MIN, 2000, d.sidebar.width),
      view: SIDE_VIEWS.includes(sb.view as SideView) ? (sb.view as SideView) : d.sidebar.view,
    },
    panel: {
      visible: typeof pn.visible === "boolean" ? pn.visible : d.panel.visible,
      height: num(pn.height, PANEL_MIN, 2000, d.panel.height),
      tab: PANEL_TABS.includes(pn.tab as PanelTab) ? (pn.tab as PanelTab) : d.panel.tab,
      maximized: pn.maximized === true,
    },
    groups,
    sizes,
    activeGroup: typeof r.activeGroup === "string" && groups.some((g) => g.id === r.activeGroup) ? r.activeGroup : groups[0]!.id,
    terminals,
    terminal: typeof r.terminal === "string" && terminals.includes(r.terminal) ? r.terminal : terminals[0] ?? null,
    folded: strings(r.folded),
    shut: Array.isArray(r.shut) ? strings(r.shut, 64) : d.shut,
  };
}

function normalise(sizes: readonly number[]): number[] {
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sum > 0 ? sizes.map((s) => s / sum) : sizes.map(() => 1 / sizes.length);
}

const withGroup = (l: Layout, id: string, f: (g: EditorGroup) => EditorGroup): Layout => ({ ...l, groups: l.groups.map((g) => (g.id === id ? f(g) : g)) });
const touch = (mru: readonly string[], id: string) => [id, ...mru.filter((t) => t !== id)];

/** Where a tile is open: the group holding its tab, or "panel", or null. */
export function whereIs(l: Layout, tileId: string): { group: EditorGroup } | "panel" | null {
  const group = l.groups.find((g) => g.tabs.includes(tileId));
  if (group) return { group };
  return l.terminals.includes(tileId) ? "panel" : null;
}

/** Take a tile out of every group and the panel, as moving it elsewhere does. */
function detach(l: Layout, tileId: string): Layout {
  const groups = l.groups.map((g) => (g.tabs.includes(tileId) ? dropTab(g, tileId) : g));
  const terminals = l.terminals.filter((t) => t !== tileId);
  const terminal = l.terminal === tileId ? terminals[Math.max(0, l.terminals.indexOf(tileId) - 1)] ?? null : l.terminal;
  return { ...l, groups, terminals, terminal };
}

function dropTab(g: EditorGroup, tileId: string): EditorGroup {
  const tabs = g.tabs.filter((t) => t !== tileId);
  const mru = g.mru.filter((t) => t !== tileId);
  // The one shown before it comes back, as VS Code's focusRecentEditorAfterClose does.
  const active = g.active === tileId ? mru[0] ?? null : g.active;
  return { ...g, tabs, mru, active, preview: g.preview === tileId ? null : g.preview };
}

/**
 * Open a tile in a group (the active one unless named), as its tab, and show it. A tile open
 * elsewhere already is shown where it is, unless a group is named: then it moves there, since a
 * terminal can be in one place only. A preview takes the place of the group's last preview, as a
 * single click in VS Code's explorer does; opening it again for good keeps it.
 */
export function openTile(l: Layout, tileId: string, opts: { group?: string; preview?: boolean; index?: number } = {}): Layout {
  const at = whereIs(l, tileId);
  if (at && at !== "panel" && (!opts.group || opts.group === at.group.id)) {
    return withGroup({ ...l, activeGroup: at.group.id }, at.group.id, (g) => ({
      ...g, active: tileId, mru: touch(g.mru, tileId), preview: opts.preview ? g.preview : g.preview === tileId ? null : g.preview,
    }));
  }
  let next = at ? detach(l, tileId) : l;
  const target = opts.group && next.groups.some((g) => g.id === opts.group) ? opts.group : next.activeGroup;
  // The group it left goes if that left it empty, as VS Code closes an empty group.
  if (at && at !== "panel") next = dropEmptyGroups({ ...next, activeGroup: target }, target, target);
  next = withGroup({ ...next, activeGroup: target }, target, (g) => {
    let tabs = g.tabs;
    let mru = g.mru;
    let index = opts.index ?? (g.active ? tabs.indexOf(g.active) + 1 : tabs.length);
    // The last preview gives its place to this one.
    if (opts.preview && g.preview && g.preview !== tileId) {
      const was = tabs.indexOf(g.preview);
      tabs = tabs.filter((t) => t !== g.preview);
      mru = mru.filter((t) => t !== g.preview);
      if (opts.index === undefined) index = was;
      else if (was < index) index--;
    }
    index = Math.max(0, Math.min(tabs.length, index));
    tabs = [...tabs.slice(0, index), tileId, ...tabs.slice(index)];
    return { ...g, tabs, active: tileId, mru: touch(mru, tileId), preview: opts.preview ? tileId : g.preview };
  });
  return next;
}

/** Keep a preview tab open for good (a double click, an edit, a drag). */
export function pin(l: Layout, tileId: string): Layout {
  return { ...l, groups: l.groups.map((g) => (g.preview === tileId ? { ...g, preview: null } : g)) };
}

/** Close a tile's tab, or take it out of the panel. An empty group other than the last goes, as in
 *  VS Code, and its width goes to its neighbours. */
export function closeTab(l: Layout, tileId: string): Layout {
  const at = whereIs(l, tileId);
  if (!at) return l;
  const next = detach(l, tileId);
  if (at === "panel") return next;
  return dropEmptyGroups(next, at.group.id);
}

function dropEmptyGroups(l: Layout, keepActiveNear: string, keep?: string): Layout {
  if (l.groups.length <= 1) return l;
  const gone = l.groups.filter((g) => !g.tabs.length && g.id !== keep).map((g) => g.id);
  if (!gone.length) return l;
  const groups = l.groups.filter((g) => !gone.includes(g.id));
  if (!groups.length) return { ...l, groups: [l.groups.find((g) => g.id === l.activeGroup) ?? l.groups[0]!].map((g) => ({ ...g })), sizes: [1], activeGroup: l.activeGroup };
  const sizes = normalise(l.groups.map((g, i) => (gone.includes(g.id) ? -1 : l.sizes[i] ?? 0)).filter((s) => s >= 0));
  let activeGroup = l.activeGroup;
  if (gone.includes(activeGroup)) {
    const i = l.groups.findIndex((g) => g.id === keepActiveNear);
    activeGroup = (l.groups.slice(0, i).reverse().find((g) => !gone.includes(g.id)) ?? groups[0]!).id;
  }
  return { ...l, groups, sizes, activeGroup };
}

/** Close every tab of a group, or of every group. */
export function closeAll(l: Layout, groupId?: string): Layout {
  let next = l;
  for (const g of l.groups) if (!groupId || g.id === groupId) for (const t of g.tabs) next = closeTab(next, t);
  return next;
}

/** Close the other tabs of the group a tile is in. */
export function closeOthers(l: Layout, tileId: string): Layout {
  const at = whereIs(l, tileId);
  if (!at || at === "panel") return l;
  let next = l;
  for (const t of at.group.tabs) if (t !== tileId) next = closeTab(next, t);
  return next;
}

function freshId(l: Layout): string {
  for (let i = 1; ; i++) if (!l.groups.some((g) => g.id === `g${i}`)) return `g${i}`;
}

/**
 * Split: a new group to the right of `groupId`, holding `tileId` (moved from where it is: a tile is
 * shown in one place only), or empty. At MAX_GROUPS the tile moves to the group on the right instead.
 */
export function split(l: Layout, groupId: string, tileId: string | null): Layout {
  const i = l.groups.findIndex((g) => g.id === groupId);
  if (i < 0) return l;
  if (l.groups.length >= MAX_GROUPS) {
    const right = l.groups[Math.min(i + 1, l.groups.length - 1)]!;
    return tileId ? openTile(l, tileId, { group: right.id }) : { ...l, activeGroup: right.id };
  }
  // A group of one tab split keeps the tab where it is, as VS Code copies the editor; a terminal can
  // only be in one place, so the new group is empty.
  const moving = tileId && (l.groups[i]!.tabs.length > 1 || !l.groups[i]!.tabs.includes(tileId)) ? tileId : null;
  let next = moving ? detach(l, moving) : l;
  const id = freshId(next);
  const share = (next.sizes[i] ?? 1 / next.groups.length) / 2;
  const groups = [...next.groups.slice(0, i + 1), emptyGroup(id), ...next.groups.slice(i + 1)];
  const sizes = [...next.sizes.slice(0, i), share, share, ...next.sizes.slice(i + 1)];
  next = { ...next, groups, sizes: normalise(sizes), activeGroup: id };
  return moving ? openTile(next, moving, { group: id }) : next;
}

/** Every group's tabs into the first, as View: Join All Editor Groups does. */
export function joinAll(l: Layout): Layout {
  const first = l.groups[0]!;
  const tabs = l.groups.flatMap((g) => g.tabs);
  const active = l.groups.find((g) => g.id === l.activeGroup)?.active ?? first.active;
  return { ...l, groups: [{ ...first, tabs, active, mru: active ? touch(tabs, active) : tabs, preview: null }], sizes: [1], activeGroup: first.id };
}

/** Move a tile into the panel's terminal list and show it there. */
export function toPanel(l: Layout, tileId: string): Layout {
  const groupId = (whereIs(l, tileId) as { group: EditorGroup } | null)?.group?.id;
  let next = detach(l, tileId);
  if (groupId) next = dropEmptyGroups(next, groupId);
  return { ...next, terminals: [...next.terminals, tileId], terminal: tileId, panel: { ...next.panel, visible: true, tab: "terminal" } };
}

/** Only what is still there: tabs and terminals of tiles that closed go, and so do empty groups. */
export function prune(l: Layout, present: ReadonlySet<string>): Layout {
  let next = l;
  for (const g of l.groups) for (const t of g.tabs) if (!present.has(t)) next = closeTab(next, t);
  for (const t of l.terminals) if (!present.has(t)) next = closeTab(next, t);
  return next;
}

/** The next (or previous) tab of the active group, round the end, as Ctrl+PageDown does. */
export function cycle(l: Layout, step: 1 | -1): Layout {
  const g = l.groups.find((x) => x.id === l.activeGroup);
  if (!g || !g.active || g.tabs.length < 2) return l;
  const i = g.tabs.indexOf(g.active);
  return openTile(l, g.tabs[(i + step + g.tabs.length) % g.tabs.length]!);
}

/** Share of the width a sash's drag leaves on each side, each group at least `min` of `total`. */
export function resizeGroups(sizes: readonly number[], i: number, dx: number, total: number, min = GROUP_MIN): number[] {
  if (i < 0 || i >= sizes.length - 1 || total <= 0) return [...sizes];
  const a = sizes[i]! * total, b = sizes[i + 1]! * total;
  const lo = Math.min(min, (a + b) / 2);
  const na = Math.min(a + b - lo, Math.max(lo, a + dx));
  const out = [...sizes];
  out[i] = na / total;
  out[i + 1] = (a + b - na) / total;
  return out;
}

// ── the explorer ─────────────────────────────────────────────────────────────

export interface TreeRow {
  kind: "frame" | "tile";
  id: string;
  depth: number;
  /** A frame with anything in it: it has a twistie. */
  parent: boolean;
  open: boolean;
}

/**
 * The explorer's rows, as VS Code draws a folder tree: frames as folders (a worktree under the frame
 * it came from), each frame's tiles as its files after its folders, and tiles in no frame at the end.
 * Folders and files keep the workspace's order, as the canvas does; a folded frame hides what is in it.
 */
export function tree(frames: readonly ViewFrame[], tiles: readonly ViewTile[], folded: ReadonlySet<string>): TreeRow[] {
  const known = new Set(frames.map((f) => f.id));
  const kids = new Map<string | null, ViewFrame[]>();
  for (const f of frames) {
    // A parent that is not there, or a loop back to itself, puts the frame at the top.
    const p = f.parentId && known.has(f.parentId) && f.parentId !== f.id ? f.parentId : null;
    kids.set(p, [...(kids.get(p) ?? []), f]);
  }
  const files = new Map<string | null, ViewTile[]>();
  for (const t of tiles) {
    const k = t.frameId && known.has(t.frameId) ? t.frameId : null;
    files.set(k, [...(files.get(k) ?? []), t]);
  }
  const rows: TreeRow[] = [];
  // Every frame reachable from the top, folded or not: one only reachable through a loop of parents
  // is shown at the top rather than lost.
  const reach = new Set<string>();
  const mark = (parent: string | null) => { for (const f of kids.get(parent) ?? []) if (!reach.has(f.id)) { reach.add(f.id); mark(f.id); } };
  mark(null);
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const f of kids.get(parent) ?? []) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      const has = (kids.get(f.id)?.length ?? 0) + (files.get(f.id)?.length ?? 0) > 0;
      const open = !folded.has(f.id);
      rows.push({ kind: "frame", id: f.id, depth, parent: has, open });
      if (open) walk(f.id, depth + 1);
    }
    if (parent === null || !folded.has(parent)) for (const t of files.get(parent) ?? []) rows.push({ kind: "tile", id: t.id, depth, parent: false, open: false });
  };
  walk(null, 0);
  for (const f of frames) {
    if (reach.has(f.id)) continue;
    kids.set(`loop:${f.id}`, [f]);
    mark(`loop:${f.id}`);
    walk(`loop:${f.id}`, 0);
  }
  return rows;
}

/** The frames from the top down to this one, for the breadcrumbs. */
export function framePath(frames: readonly ViewFrame[], frameId: string | null): ViewFrame[] {
  const out: ViewFrame[] = [];
  const by = new Map(frames.map((f) => [f.id, f]));
  for (let f = frameId ? by.get(frameId) : undefined; f && !out.includes(f); f = f.parentId ? by.get(f.parentId) : undefined) out.unshift(f);
  return out;
}

// ── state ────────────────────────────────────────────────────────────────────

export interface Seen { status?: ViewStatus; since?: number; agent?: ViewAgentStatus }

/** How a tile reads wherever Code shows its state: the app's tone, its word, and for one that waits
 *  on the person, why. Only agents and shells have a state; any other tile has none. */
export function stateOf(tile: ViewTile, seen: Seen | undefined): { tone: "attention" | "working" | "idle" | "exited" | "failed"; group: AgentGroup; why: string } | null {
  if (!tile.agent && seen?.status === undefined) return null;
  if (tile.asleep) return { tone: "exited", group: "stopped", why: "asleep" };
  const group = groupOf(seen?.status, seen?.agent);
  const s = seen?.agent?.state;
  if (group === "needs") {
    const why = ({ permission: "wants permission", question: "asked a question", plan: "has a plan for you", approval: "wants approval" } as Record<string, string>)[seen?.agent?.waitingFor ?? ""] ?? "needs you";
    return { tone: "attention", group, why };
  }
  if (group === "stopped") {
    const failed = s === "failed" || s === "limited";
    return { tone: failed ? "failed" : "exited", group, why: s === "limited" ? "hit a usage limit" : s === "failed" ? "stopped on an error" : s === "interrupted" ? "was interrupted" : "exited" };
  }
  if (group === "working") return { tone: "working", group, why: seen?.agent?.subagents ? `working, ${seen.agent.subagents} helper${seen.agent.subagents === 1 ? "" : "s"}` : "working" };
  return { tone: "idle", group, why: "ready" };
}

// ── quick open ───────────────────────────────────────────────────────────────

/**
 * VS Code's quick open match: every character of the query in order, case aside. A match scores more
 * where it is contiguous, starts a word or the label, and in a shorter label. Gives the matched
 * positions for highlighting, or null when it does not match.
 */
export function fuzzy(query: string, label: string): { score: number; at: number[] } | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return { score: 0, at: [] };
  const s = label.toLowerCase();
  // Contiguous first: the best a match can be.
  const sub = s.indexOf(q);
  if (sub >= 0) {
    const start = sub === 0 ? 40 : /[\s\-_./]/.test(label[sub - 1]!) ? 25 : 10;
    return { score: 100 + start + q.length * 4 - label.length * 0.1, at: Array.from(q, (_, i) => sub + i) };
  }
  const at: number[] = [];
  let score = 0, from = 0;
  for (const ch of q) {
    const i = s.indexOf(ch, from);
    if (i < 0) return null;
    score += at.length && i === at[at.length - 1]! + 1 ? 5 : i === 0 || /[\s\-_./]/.test(label[i - 1]!) || (label[i] !== s[i] && label[i - 1] === s[i - 1]) ? 3 : 1;
    at.push(i);
    from = i + 1;
  }
  return { score: score - label.length * 0.1, at };
}

/** Split a label at the matched positions, for drawing the matched letters in bold. */
export function highlight(label: string, at: readonly number[]): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  const hits = new Set(at);
  for (let i = 0; i < label.length; i++) {
    const hit = hits.has(i);
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += label[i];
    else out.push({ text: label[i]!, hit });
  }
  return out;
}
