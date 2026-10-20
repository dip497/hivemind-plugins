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
import * as THREE from "three";
import { Pins } from "../views/island/src/pins";
import { TALK, Walker } from "../views/island/src/walker";

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

test("Island: pins stand over the agents once the workers are too small to read, and a click on one picks that agent", () => {
  const pins = new Pins();
  const camera = new THREE.PerspectiveCamera(32, 1280 / 800, 0.5, 2000);
  const at = (dist: number) => { camera.position.set(0, dist * 0.73, dist * 0.68); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); };
  const workers = [
    { tileId: "near", pos: new THREE.Vector3(0, 0, 0), mood: "calling" as const },
    { tileId: "far", pos: new THREE.Vector3(12, 0, 0), mood: "working" as const },
  ];
  pins.setViewport(1280, 800);
  // Close up the workers can be read by themselves: no pins, nothing drawn.
  at(30);
  expect(pins.update(workers, camera, 30, 800, 0, false)).toBe(false);
  expect(pins.mesh.geometry.instanceCount).toBe(0);
  // From the overview, every agent has one.
  at(220);
  expect(pins.update(workers, camera, 220, 800, 0, false)).toBe(true);
  expect(pins.fade).toBe(1);
  expect(pins.mesh.geometry.instanceCount).toBe(2);
  // Aimed at the disc above a worker, not at its feet, the click lands on that agent.
  const disc = (id: string) => {
    const w = workers.find((x) => x.tileId === id)!;
    const p = new THREE.Vector3(w.pos.x, 1.1, w.pos.z).project(camera);
    return { x: ((p.x + 1) / 2) * 1280, y: ((1 - p.y) / 2) * 800 - (id === "near" ? 13 * 1.3 : 13) * 1.25 };
  };
  expect(pins.pick(disc("near").x, disc("near").y, camera, 1280, 800)).toBe("near");
  expect(pins.pick(disc("far").x, disc("far").y, camera, 1280, 800)).toBe("far");
  expect(pins.pick(5, 5, camera, 1280, 800)).toBe(null);
});

test("Island: a town stands on the week's turns, so it is not bare each morning, while today's count stays today's", () => {
  // Six days back from the 2nd of March crosses into February.
  expect(isle.daysBefore(new Date(2026, 2, 2))).toEqual(["2026-03-01", "2026-02-28", "2026-02-27", "2026-02-26", "2026-02-25", "2026-02-24"]);
  const earlier = new Map([["a", 5], ["b", 2]]), today = new Map([["a", 1], ["c", 3]]);
  expect(isle.townTurns(earlier, today)).toEqual(new Map([["a", 6], ["b", 2], ["c", 3]]));
  expect(today).toEqual(new Map([["a", 1], ["c", 3]]));
});

test("Island: walking, you go the way the camera faces, slide along the coast instead of into the sea, and talk only to an agent beside you", () => {
  // Land is everything with z at or above 0; the sea lies below it.
  const ground = { stand: (_x: number, z: number) => z >= 0 };
  const me = new Walker();
  me.place(0, 5);
  // With yaw 0 the camera looks along -x: forward is -x, right is -z.
  expect(me.press("w", true)).toBe(true);
  expect(me.step(1, 0, ground)).toBe(true);
  expect(me.x).toBeCloseTo(-2.4, 5);
  expect(me.z).toBeCloseTo(5, 5);
  me.press("w", false);
  expect(me.press("ArrowRight", true)).toBe(true);
  me.step(1, 0, ground);
  expect(me.z).toBeCloseTo(2.6, 5);
  me.release();
  expect(me.step(1, 0, ground)).toBe(false);
  // Turn the camera a quarter round: it looks along -z, so forward is now -z.
  me.place(0, 5);
  me.press("w", true);
  me.step(1, Math.PI / 2, ground);
  expect(me.x).toBeCloseTo(0, 5);
  expect(me.z).toBeCloseTo(2.6, 5);
  me.release();
  // Forward and right at the water's edge: the sea side is refused, the rest of the step is kept.
  me.place(0, 0.05);
  me.press("w", true); me.press("d", true);
  me.step(1, 0, ground);
  expect(me.z).toBe(0.05);
  expect(me.x).toBeLessThan(-1.5);
  // A key that does not walk is left to the view.
  expect(me.press("e", true)).toBe(false);
  me.place(0, 0);
  expect(me.nearest([{ tileId: "far", x: TALK + 0.2, z: 0 }, { tileId: "next", x: 0.9, z: 0 }, { tileId: "close", x: 0, z: 0.6 }])).toBe("close");
  expect(me.nearest([{ tileId: "far", x: TALK + 0.2, z: 0 }])).toBe(null);
});

test("Island: an island rises a step for each ring of tiles in from its shore, highest in the middle", () => {
  // A round island three tiles in radius: its coast is three tiles from the middle.
  const cells: { q: number; r: number }[] = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (isle.tilesApart({ q, r }, { q: 0, r: 0 }) <= 3) cells.push({ q, r });
  const rings = isle.ringsInland(cells, 3);
  for (const c of cells) expect(rings.get(c)).toBe(3 - isle.tilesApart(c, { q: 0, r: 0 }));
  // However big the island, it stops rising after `most` rings.
  const capped = isle.ringsInland(cells, 2);
  expect(capped.get(cells.find((c) => c.q === 0 && c.r === 0)!)).toBe(2);
  expect(Math.max(...capped.values())).toBe(2);
});
