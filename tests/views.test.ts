// The views here: each manifest is one the app loads, and what each view draws is worked out right
// from the workspace it is given.
import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT as REPO, viewSdk } from "./app";

const { validateViewManifest } = await viewSdk("manifest.ts");
// @ts-expect-error plain JavaScript modules, loaded as the view loads them
import * as sky from "../views/constellation/lib.js";
// @ts-expect-error
import * as day from "../views/timeline/lib.js";
// @ts-expect-error
import * as board from "../views/agents-by-state/lib.js";
// @ts-expect-error
import * as map from "../views/workspace-map/lib.js";
import * as isle from "../views/island/src/world";
import * as focus from "../views/focus/src/model";

const ROOT = path.join(REPO, "views");

test("every view here is one the app loads, under its folder's name, from the folder HiveHub lists, a package's views too", () => {
  const PACKAGES = path.join(REPO, "packages");
  const views = [
    ...readdirSync(ROOT).map((name) => ({ name, root: ROOT })),
    ...readdirSync(PACKAGES).flatMap((p) => existsSync(path.join(PACKAGES, p, "views")) ? readdirSync(path.join(PACKAGES, p, "views")).map((name) => ({ name, root: path.join(PACKAGES, p, "views") })) : []),
  ];
  for (const { name, root } of views) {
    // A view written in TypeScript is listed from its build; a plain one from its own folder.
    const dir = existsSync(path.join(root, name, "src")) ? path.join(root, name, "dist") : path.join(root, name);
    const m = validateViewManifest(JSON.parse(readFileSync(path.join(dir, "hivemind-view.json"), "utf8")));
    expect([name, m.ok && m.manifest.id, m.ok && existsSync(path.join(dir, m.manifest.entry))]).toEqual([name, `@dip497/${name}`, true]);
  }
});

test("Constellation: an agent's light follows what it reports, and a worktree sits by the frame it came from", () => {
  expect(sky.lightOf("working", { state: "working" })).toBe("working");
  expect(sky.lightOf("idle", { state: "waiting", waitingFor: "permission" })).toBe("waiting");
  expect(sky.lightOf("blocked", undefined)).toBe("waiting");
  expect(sky.lightOf("idle", { state: "limited" })).toBe("failed");
  const frames = [{ id: "a" }, { id: "b" }, { id: "w", parentId: "a" }];
  const tiles = [{ id: "1", frameId: "a", agent: "claude" }, { id: "2", frameId: "w", agent: "codex" }, { id: "3", frameId: "a", kind: "term" }];
  const { frames: at, orbits } = sky.layout(frames, tiles);
  const dist = (p: { x: number; z: number }, q: { x: number; z: number }) => Math.hypot(p.x - q.x, p.z - q.z);
  expect(dist(at.get("w"), at.get("a"))).toBeLessThan(Math.min(8, dist(at.get("w"), at.get("b"))));
  expect([...orbits.keys()].sort()).toEqual(["1", "2", "3"]);
  expect(orbits.get("1").radius).toBeGreaterThan(orbits.get("3").radius);
  expect(sky.census(["working", "waiting", "working", "idle"])).toEqual({ working: 2, waiting: 1, idle: 1, failed: 0, exited: 0 });
});

test("Timeline: a live status change ends the stretch before it and starts one that runs to now", () => {
  let it: [number, number, string][] = [[0, 100, "idle"]];
  it = day.extend(it, "working", 150, 200);
  it = day.extend(it, "working", 150, 260);
  it = day.extend(it, "blocked", 300, 330);
  expect(it).toEqual([[0, 150, "idle"], [150, 300, "working"], [300, 330, "blocked"]]);
  expect(day.minutesIn([[0, 600_000, "working"], [600_000, 900_000, "blocked"]], 300_000)).toEqual({ working: 5, blocked: 5, idle: 0, exited: 0, unknown: 0 });
  const s = day.span([{ intervals: [[1_000_000, 2_000_000, "working"]] }], 5_000_000);
  expect(s.from).toBeLessThan(1_000_000);
  expect(s.to).toBeGreaterThanOrEqual(5_000_000);
});

test("Agents by state: each agent lands in its column, the one waiting longest first", () => {
  expect(board.columnOf("blocked", {})).toBe("waiting");
  expect(board.columnOf("working", { state: "working" })).toBe("working");
  expect(board.columnOf("idle", { state: "failed" })).toBe("stopped");
  expect(board.columnOf("exited", undefined)).toBe("stopped");
  expect(board.columnOf("idle", { state: "idle" })).toBe("idle");
  const by = board.group([
    { id: "late", column: "waiting", since: 300 }, { id: "early", column: "waiting", since: 100 }, { id: "w", column: "working", since: 50 },
  ]);
  expect(by.waiting.map((c: { id: string }) => c.id)).toEqual(["early", "late"]);
  expect(board.detailOf({ column: "waiting", waitingFor: "plan" })).toBe("has a plan for you");
});

test("Focus: whoever waits on you comes first, then working, ready and stopped, each longest there first", () => {
  expect(focus.groupOf("blocked", undefined)).toBe("needs");
  expect(focus.groupOf("idle", { state: "waiting", subagents: 0, background: 0, compacting: false })).toBe("needs");
  expect(focus.groupOf("working", undefined)).toBe("working");
  expect(focus.groupOf("idle", { state: "limited", subagents: 0, background: 0, compacting: false })).toBe("stopped");
  expect(focus.groupOf("exited", undefined)).toBe("stopped");
  expect(focus.groupOf("idle", undefined)).toBe("ready");
  const tiles = [
    { id: "a", frameId: "f", kind: "agent", name: "alpha", agent: "claude" },
    { id: "b", frameId: null, kind: "agent", name: "beta", agent: "codex" },
    { id: "c", frameId: "f", kind: "agent", name: "gamma", agent: "claude" },
    { id: "d", frameId: null, kind: "agent", name: "delta", agent: "claude", asleep: {} },
    { id: "e", frameId: null, kind: "agent", name: "eps", agent: "claude" },
    { id: "s", frameId: null, kind: "shell", name: "shell" },
  ];
  const agent = (state: string, extra: object = {}) => ({ state, subagents: 0, background: 0, compacting: false, ...extra }) as never;
  const seen = new Map<string, { status?: never; since?: number; agent?: never }>([
    ["a", { status: "working" as never, since: 50, agent: agent("working", { subagents: 2 }) }],
    ["b", { status: "blocked" as never, since: 90, agent: agent("waiting", { waitingFor: "permission" }) }],
    ["c", { status: "blocked" as never, since: 20, agent: agent("waiting", { waitingFor: "plan" }) }],
    ["d", { status: "idle" as never, since: 10, agent: agent("idle") }],
    ["e", { status: "idle" as never, since: 30, agent: agent("failed") }],
  ]);
  const rows = focus.rows(tiles, [{ id: "f", title: "web", color: "#336699" }], seen, new Map([["a", "alpha (renamed)"]]), 100);
  expect(rows.map((r) => [r.name, r.group, r.detail])).toEqual([
    ["gamma", "needs", "has a plan for you"],
    ["beta", "needs", "wants permission"],
    ["alpha (renamed)", "working", "2 helpers running"],
    ["delta", "stopped", "is asleep"],
    ["eps", "stopped", "stopped on an error"],
  ]);
  // Failed is told apart from a clean stop (it draws a cross, not a square); asleep is clean.
  expect(rows.filter((r) => r.failed).map((r) => r.name)).toEqual(["eps"]);
  expect(rows[0]!.frame).toEqual({ title: "web", color: "#336699" });
  expect(focus.filtered(rows, "needs", "").map((r) => r.name)).toEqual(["gamma", "beta"]);
  expect(focus.filtered(rows, "all", "CODEX").map((r) => r.name)).toEqual(["beta"]);
  // ↓ from the last wraps to the first; ↑ with nothing picked picks the last.
  expect(focus.step(rows, "e", 1)).toBe("c");
  expect(focus.step(rows, null, -1)).toBe("e");
  expect(focus.step([], null, 1)).toBeNull();
  expect([focus.ago(0, 45_000), focus.ago(0, 12 * 60_000), focus.ago(0, 185 * 60_000)]).toEqual(["45s", "12m", "3h 5m"]);
});

test("Workspace map: a worktree hangs under its frame, every tile under its own, and a parent sits between its children", () => {
  const frames = [{ id: "a", title: "api" }, { id: "w", title: "fix", parentId: "a" }];
  const tiles = [{ id: "1", frameId: "a" }, { id: "2", frameId: "w" }, { id: "3", frameId: "w" }, { id: "4", frameId: null }];
  const { nodes, rows } = map.tree(frames, tiles);
  const by = new Map(nodes.map((n: { id: string }) => [n.id, n]));
  expect(["w", "1", "2", "3", "4"].map((id) => (by.get(id) as { parent: string }).parent)).toEqual(["a", "a", "w", "w", "workspace"]);
  expect(rows).toBe(4);
  const w = by.get("w") as { row: number };
  expect(w.row).toBe(((by.get("2") as { row: number }).row + (by.get("3") as { row: number }).row) / 2);
  expect(map.issueCounts([{ state: "done" }, { state: "done" }, { state: "todo" }])).toEqual({ done: 2, todo: 1 });
});

test("Island: an agent put to sleep is asleep whatever it last did, until it is closed, and is counted apart", () => {
  const waiting = { state: "waiting" as const, waitingFor: "plan" as const, subagents: 0, background: 0, compacting: false };
  expect(isle.moodOf("blocked", waiting, true)).toBe("asleep");
  expect(isle.moodOf("working", undefined, true)).toBe("asleep");
  expect(isle.moodOf("exited", undefined, true)).toBe("gone");
  expect(isle.moodOf("blocked", waiting, false)).toBe("calling");
  expect(isle.census(["asleep", "working", "asleep"])).toMatchObject({ asleep: 2, working: 1, idle: 0 });
});

test("Island: an agent waiting on the person is calling, longest first, and every island and home sits on its own tiles", () => {
  expect(isle.moodOf("idle", { state: "waiting", waitingFor: "plan", subagents: 0, background: 0, compacting: false })).toBe("calling");
  expect(isle.moodOf("blocked", undefined)).toBe("calling");
  expect(isle.moodOf("working", { state: "limited", subagents: 0, background: 0, compacting: false })).toBe("failed");
  expect(isle.moodOf("exited", undefined)).toBe("gone");
  expect(isle.callers([{ tileId: "late", mood: "calling", since: 300 }, { tileId: "w", mood: "working", since: 1 }, { tileId: "early", mood: "calling", since: 100 }]).map((c: { tileId: string }) => c.tileId)).toEqual(["early", "late"]);
  const frames = [{ id: "a", title: "api", color: "#22c55e" }, { id: "b", title: "web", color: "#3b82f6" }, { id: "c", title: "docs", color: "#f97316" }, { id: "w", title: "fix", color: "#22c55e", parentId: "a" }];
  const tiles = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, frameId: "a", kind: "terminal", name: `a${i}`, agent: "claude" })),
    ...Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, frameId: "b", kind: "terminal", name: `b${i}`, agent: "codex" })),
    { id: "w1", frameId: "w", kind: "terminal", name: "w1", agent: "claude" }, { id: "x", frameId: null, kind: "browser", name: "x" },
  ];
  const { islands, spots } = isle.layout(frames, tiles);
  const list = [...islands.values()];
  expect(list.map((i: { id: string }) => i.id).sort()).toEqual(["a", "b", "c", "loose", "w"]);
  for (const p of list) for (const q of list) if (p !== q) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThanOrEqual(p.r + q.r);
  const a = islands.get("a"), w = islands.get("w");
  const shoreGap = (p: { x: number; z: number; r: number }, q: { x: number; z: number; r: number }) => Math.hypot(p.x - q.x, p.z - q.z) - p.r - q.r;
  for (const other of list.filter((i: { id: string }) => i.id !== "a" && i.id !== "w")) expect(shoreGap(w, a)).toBeLessThan(shoreGap(w, other));
  expect(w.biome).toBe(a.biome);
  expect(new Set(Array.from({ length: 12 }, (_, i) => isle.biomeOf({ id: `frame-${i}` }, [])))).toEqual(new Set(["meadow", "autumn", "blossom", "snow"]));
  // Each project wears the building colour nearest its own.
  expect([isle.colourOf("#22c55e"), isle.colourOf("#3b82f6"), isle.colourOf("#ef4444"), isle.colourOf("#eab308")]).toEqual(["green", "blue", "red", "yellow"]);
  expect([...spots.keys()].sort()).toEqual(tiles.map((t) => t.id).sort());
  for (const s of spots.values()) {
    const isl = islands.get(s.islandId);
    // Every tile has a tile of its own on its island, held for it alone.
    const home = isl.cells.find((c: { x: number; z: number }) => Math.hypot(c.x - s.x, c.z - s.z) < 0.01);
    expect(home.owner).toBe(s.tileId);
    expect(home.use).toBe(s.agent ? "home" : "tent");
  }
});

test("Island: each finished turn takes an agent's next lot a step further, and its village only grows", () => {
  const frames = [{ id: "a", title: "api", color: "#22c55e" }, { id: "b", title: "web", color: "#3b82f6" }];
  const tiles = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, frameId: i % 4 ? "a" : "b", kind: "terminal", name: `t${i}`, agent: "claude" }));
  const { islands, spots } = isle.layout(frames, tiles);
  const used = new Set<object>();
  for (const s of spots.values()) {
    expect(s.lots.length).toBe(isle.LOTS);
    for (const l of s.lots) {
      // Its own, near its home, and no one else's.
      expect(l.owner).toBe(s.tileId);
      expect(l.use).toBe("lot");
      expect(isle.tilesApart(l, islands.get(s.islandId).cells.find((c: { owner?: string; use: string }) => c.owner === s.tileId && c.use === "home"))).toBeLessThanOrEqual(3);
      expect(used.has(l)).toBe(false);
      used.add(l);
    }
  }
  expect(isle.townOf(4, 0)).toEqual([]);
  expect(isle.townOf(4, 1)).toEqual([1]);
  expect(isle.townOf(4, 4)).toEqual([3, 1]);
  for (let n = 0; n < 20; n++) {
    const now = isle.townOf(4, n), next = isle.townOf(4, n + 1);
    now.forEach((f: number, i: number) => expect(next[i]).toBeGreaterThanOrEqual(f));
    expect(next.reduce((x: number, y: number) => x + y, 0)).toBe(Math.min(n + 1, isle.MOST_TURNS));
  }
  // The middle of an island grows with every turn its agents finish.
  const keeps = [0, 4, 12, 24].map(isle.keepOf);
  expect(new Set(keeps).size).toBe(4);
});

test("Island: lamps are lit at night and out at noon, and the sky turns smoothly through midnight", () => {
  expect(isle.skyAt(23).lamps).toBe(1);
  expect(isle.skyAt(12.5).lamps).toBe(0);
  expect(isle.skyAt(19).lamps).toBeGreaterThan(isle.skyAt(17).lamps);
  expect(isle.skyAt(13).keyI).toBeGreaterThan(isle.skyAt(1).keyI);
  expect(isle.skyAt(0)).toEqual(isle.skyAt(24));
  expect(isle.skyAt(-1)).toEqual(isle.skyAt(23));
});
