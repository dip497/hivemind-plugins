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
import * as water from "../views/current/src/flow";

const ROOT = path.join(REPO, "views");

test("every view here is one the app loads, under its folder's name, from the folder HiveHub lists", () => {
  for (const name of readdirSync(ROOT)) {
    // A view written in TypeScript is listed from its build; a plain one from its own folder.
    const dir = existsSync(path.join(ROOT, name, "src")) ? path.join(ROOT, name, "dist") : path.join(ROOT, name);
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

test("Island: an agent waiting on the person is calling, longest first, and every island and workshop sits on its own dry land", () => {
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
  expect([...spots.keys()].sort()).toEqual(tiles.map((t) => t.id).sort());
  const all = [...spots.values()];
  for (const s of all.filter((s: { agent: boolean }) => s.agent)) {
    const isl = islands.get(s.islandId);
    expect(isle.groundAt(isl, all, s.x, s.z)).toBeGreaterThan(0.2);
    for (const o of all) if (o !== s && o.agent && o.islandId === s.islandId) expect(Math.hypot(o.x - s.x, o.z - s.z)).toBeGreaterThan(2.4);
  }
});

test("Current: every agent's stream runs from its spring, through its frame's meeting point, down to you; a longer wait is a bigger pool", () => {
  const frames = [{ id: "a", title: "api", color: "#22c55e" }, { id: "w", title: "fix", color: "#22c55e", parentId: "a" }, { id: "b", title: "web", color: "#3b82f6" }];
  const tiles = [
    ...Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, frameId: "a", kind: "terminal", name: `a${i}`, agent: "claude" })),
    { id: "w1", frameId: "w", kind: "terminal", name: "w1", agent: "codex" }, { id: "b1", frameId: "b", kind: "terminal", name: "b1", agent: "codex" },
    { id: "loose", frameId: null, kind: "terminal", name: "loose", agent: "pi" }, { id: "t", frameId: "a", kind: "browser", name: "t" },
  ];
  const { basins, springs, canals, lake } = water.landscape(frames, tiles, [{ a: "a0", b: "b1", kind: "pipe" }, { a: "a0", b: "gone", kind: "spawn" }], 1600, 1000);
  // A worktree's basin sits right after its parent's.
  expect([...basins.keys()]).toEqual(["a", "w", "b", "loose"]);
  expect([...springs.keys()].sort()).toEqual(["a0", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "b1", "loose", "w1"]);
  for (const s of springs.values()) {
    const b = basins.get(s.frameId);
    expect(s.at.x).toBeGreaterThanOrEqual(b.x);
    expect(s.at.x).toBeLessThanOrEqual(b.x + b.w);
    expect(s.path.some((p: { x: number; y: number }) => Math.hypot(p.x - b.meet.x, p.y - b.meet.y) < 0.5)).toBe(true);
    const end = s.path[s.path.length - 1];
    expect(Math.hypot(end.x - lake.x, end.y - lake.y)).toBeLessThan(400);
    expect(water.along(s.path, s.length, 0)).toEqual(s.at);
  }
  for (const a of springs.values()) for (const b of springs.values()) if (a !== b) expect(Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y)).toBeGreaterThan(20);
  expect(canals.map((c: { a: string; b: string }) => `${c.a}>${c.b}`)).toEqual(["a0>b1"]);
  expect(water.poolRadius(10 * 60_000)).toBeGreaterThan(water.poolRadius(60_000));
  expect(water.poolRadius(60_000)).toBeGreaterThan(water.poolRadius(5_000));
});
