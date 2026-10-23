// Archipelago, the view the archipelago package holds: what it works out from the workspace, and
// what you do walking it, run by the view's own code with no app and no GPU.
import { expect, test } from "bun:test";
import * as THREE from "three";
import * as isle from "../packages/archipelago/views/archipelago/src/world";
import { Pins } from "../packages/archipelago/views/archipelago/src/pins";
import { Blocks, TALK, Walker } from "../packages/archipelago/views/archipelago/src/walker";
import { EYES, Eye, LOOK, povOf } from "../packages/archipelago/views/archipelago/src/eye";

test("Archipelago: pins stand over the agents once the workers are too small to read, and a click on one picks that agent", () => {
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

test("Archipelago: a town stands on the week's turns, so it is not bare each morning, while today's count stays today's", () => {
  // Six days back from the 2nd of March crosses into February.
  expect(isle.daysBefore(new Date(2026, 2, 2))).toEqual(["2026-03-01", "2026-02-28", "2026-02-27", "2026-02-26", "2026-02-25", "2026-02-24"]);
  const earlier = new Map([["a", 5], ["b", 2]]), today = new Map([["a", 1], ["c", 3]]);
  expect(isle.townTurns(earlier, today)).toEqual(new Map([["a", 6], ["b", 2], ["c", 3]]));
  expect(today).toEqual(new Map([["a", 1], ["c", 3]]));
});

test("Archipelago: walking, you go the way the camera faces, slide along the coast instead of into the sea, and talk only to an agent beside you", () => {
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

test("Archipelago: walking, your body keeps clear of a tree or a house: you stop short of it or go round it, never into it, and can always step out of one that went up where you stood", () => {
  // Your worker is about 0.45 across: its middle stays 0.22 from anything it walks round.
  const body = 0.22;
  const blocks = new Blocks();
  const ground = { stand: (x: number, z: number, fromX?: number, fromZ?: number) => blocks.clear(x, z, fromX, fromZ) };
  // A tree half a unit across, a unit ahead (yaw 0 looks along -x): you stop with your body against it.
  blocks.set([{ x: -1, z: 0, r: 0.25 }]);
  const me = new Walker();
  me.place(0, 0);
  me.press("w", true);
  for (let f = 0; f < 60; f++) me.step(1 / 60, 0, ground);
  expect(me.x).toBeGreaterThanOrEqual(-1 + 0.25 + body);
  expect(me.x).toBeLessThan(-1 + 0.25 + body + 0.05);
  me.release();
  // Ahead and to the left, the tree in the way: round its side and on past it, never into it.
  me.place(0, -1);
  me.press("w", true); me.press("a", true);
  let closest = Infinity;
  for (let f = 0; f < 90; f++) { me.step(1 / 60, 0, ground); closest = Math.min(closest, Math.hypot(me.x + 1, me.z)); }
  expect(me.x).toBeLessThan(-1.5);
  expect(closest).toBeGreaterThanOrEqual(0.25 + body);
  me.release();
  // A house goes up where you stand: you go no further in, and out as you like.
  blocks.set([{ x: 0, z: 0, r: 0.6 }]);
  me.place(-0.1, 0);
  me.press("d", true);
  me.step(0.05, Math.PI / 2, ground);
  expect(Math.hypot(me.x, me.z)).toBeGreaterThanOrEqual(0.1);
  me.release();
  me.place(-0.1, 0);
  me.press("w", true);
  me.step(0.05, 0, ground);
  expect(me.x).toBeCloseTo(-0.22, 6);
  // Landing, with nowhere you come from: not in the house, nor with your body against its wall.
  expect([0.3, 0.6 + body - 0.02, 0.6 + body + 0.02].map((x) => blocks.clear(x, 0))).toEqual([false, false, true]);
});

test("Archipelago: through your own eyes you stand at your worker's eye height on the ground under you, look the way W walks, and no further up or down than 60 degrees", () => {
  const eye = new Eye(), at = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3();
  const look = (x: number, z: number, ground: number, yaw: number) => { eye.pose(x, z, ground, 0.8, yaw, at, to); return dir.subVectors(to, at).normalize(); };
  // Eyes 92% of the way up a worker 0.8 tall, on whatever ground is under it.
  for (const ground of [0, 0.6]) {
    look(3, -2, ground, 0.7);
    expect([at.x, at.y, at.z]).toEqual([3, ground + 0.8 * EYES, -2]);
    expect(at.y).toBeCloseTo(ground + 0.736, 6);
  }
  // At every yaw, W carries you the way your eyes look.
  const flat = { stand: () => true };
  for (const yaw of [0, 0.7, 2, -2.6]) {
    const d = look(0, 0, 0, yaw);
    const me = new Walker();
    me.place(0, 0);
    me.press("w", true);
    me.step(0.5, yaw, flat);
    const along = (me.x * d.x + me.z * d.z) / (Math.hypot(me.x, me.z) * Math.hypot(d.x, d.z));
    expect(along).toBeCloseTo(1, 6);
  }
  // A drag tips your look up or down, and stops at 60 degrees either way.
  eye.look(0.3);
  expect(eye.pitch).toBeCloseTo(0.2, 6);
  expect(Math.asin(look(0, 0, 0, 0).y)).toBeCloseTo(0.2, 6);
  eye.look(10);
  expect(eye.pitch).toBe(LOOK);
  expect(Math.asin(look(0, 0, 0, 0).y)).toBeCloseTo(Math.PI / 3, 6);
  eye.look(-20);
  expect(Math.asin(look(0, 0, 0, 0).y)).toBeCloseTo(-Math.PI / 3, 6);
});

test("Archipelago: V moves the camera into your eyes and back out over 0.4 s, at once with less motion, widening the lens and drawing near, and the view you chose is kept for next time", () => {
  const eye = new Eye();
  // Nothing saved, or a layout from before there was a choice: from behind.
  expect(eye.pov).toBe("third");
  expect([povOf(undefined), povOf("sideways"), povOf("third"), povOf("first")]).toEqual(["third", "third", "third", "first"]);
  expect(eye.toggle()).toBe("first");
  // A tenth of a second in, it has begun gently; at 0.2 s it is half way, the lens half as wide again,
  // and near enough already for a wall at your shoulder.
  eye.step(0.1, true, false);
  expect(eye.blend).toBeGreaterThan(0);
  expect(eye.blend).toBeLessThan(0.25);
  expect(eye.step(0.1, true, false)).toBe(true);
  expect(eye.blend).toBeCloseTo(0.5, 6);
  expect(eye.fov).toBeCloseTo((70 + 32) / 2, 6);
  expect(eye.near).toBe(0.05);
  expect(eye.inside).toBe(false);
  expect(eye.step(0.2, true, false)).toBe(false);
  expect([eye.blend, eye.fov, eye.near, eye.inside]).toEqual([1, 70, 0.05, true]);
  // Flying up, the camera leaves your eyes, the near plane only once it is all the way out; the choice stays.
  eye.step(0.36, false, false);
  expect([eye.near, eye.inside]).toEqual([0.05, false]);
  eye.step(0.05, false, false);
  expect([eye.blend, eye.fov, eye.near, eye.pov]).toEqual([0, 32, 0.5, "first"]);
  // With less motion, at once.
  expect(eye.step(1 / 60, true, true)).toBe(false);
  expect(eye.blend).toBe(1);
  expect(eye.toggle()).toBe("third");
  eye.step(1 / 60, true, true);
  expect(eye.blend).toBe(0);
});

test("Archipelago: through your eyes the head rises and falls a little as you walk, a little more as you run, settles when you stop, and never moves with less motion", () => {
  const eye = new Eye();
  const most = (moving: boolean, running: boolean, reduced: boolean, frames = 120) => {
    let m = 0;
    for (let f = 0; f < frames; f++) m = Math.max(m, Math.abs(eye.bob(1 / 60, moving, running, reduced)));
    return m;
  };
  // Once in step: about a hundredth of your height walking, half as much again running.
  most(true, false, false);
  const walking = most(true, false, false);
  most(true, true, false);
  const running = most(true, true, false);
  expect(walking).toBeGreaterThan(0.01);
  expect(walking).toBeLessThanOrEqual(0.012);
  expect(running).toBeGreaterThan(0.016);
  expect(running).toBeLessThanOrEqual(0.018);
  most(false, false, false, 60);
  expect(Math.abs(eye.bob(1 / 60, false, false, false))).toBeLessThan(0.0005);
  expect(most(true, true, true)).toBe(0);
});

test("Archipelago: an island rises a step for each ring of tiles in from its shore, highest in the middle", () => {
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

test("Archipelago: inland ground is land and dry between tiles too: no beach and no pit in the middle of an island", async () => {
  const { Terrain, COAST, DRY } = await import("../packages/archipelago/views/archipelago/src/terrain");
  // A round island three tiles in radius, laid out as the view lays tiles (flat sides 1 from the middle).
  const tiles: { x: number; z: number; lift: number }[] = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (isle.tilesApart({ q, r }, { q: 0, r: 0 }) <= 3) tiles.push({ x: 2 * q + r, z: Math.sqrt(3) * r, lift: 0 });
  const ground = new Terrain(new THREE.MeshBasicMaterial());
  ground.build([{ id: "i", x: 0, z: 0, r: 7, seed: 1, grass: 0x6aa847, tiles }]);
  // Halfway between any two neighbouring tiles inside the island: dry land, not beach.
  const inner = tiles.filter((t) => Math.hypot(t.x, t.z) < 4.5);
  for (const a of inner) for (const b of inner) {
    if (Math.hypot(a.x - b.x, a.z - b.z) > 2.1 || a === b) continue;
    const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
    expect(ground.land(x, z)).toBeGreaterThanOrEqual(COAST);
    expect(ground.land(x, z)).toBeGreaterThanOrEqual(DRY);
    expect(ground.height(x, z)).toBeGreaterThan(0);
  }
  // Out past the shore it is sea.
  expect(ground.land(0, 11)).toBeLessThan(COAST);
});

// ── ships ────────────────────────────────────────────────────────────────────
import { Fleet, SWELLS, offShore, seaAt, type Errand, type ShipsWeather } from "../packages/archipelago/views/archipelago/src/ships";

/** Round islands at these places: how far a point of sea is from the nearest shore, 0 on land. */
const isles = (list: { x: number; z: number; r: number }[]) => (x: number, z: number) =>
  Math.max(0, Math.min(...list.map((i) => Math.hypot(x - i.x, z - i.z) - i.r)));
const calm: ShipsWeather = { wind: 0.3, dirX: 1, dirZ: 0, lamps: 0, call: new THREE.Color("#f59e0b") };
/** Where each ship is drawn, read back from what the fleet draws. */
const drawn = (fleet: Fleet) => {
  const hulls = fleet.group.children[0] as THREE.InstancedMesh, m = new THREE.Matrix4(), p = new THREE.Vector3();
  return Array.from({ length: hulls.count }, (_, i) => { hulls.getMatrixAt(i, m); p.setFromMatrixPosition(m); return { x: p.x, z: p.z }; });
};

test("Ships: a ship between two islands finds its way round a third in its way, a bay facing it included, never onto land, and gets there", () => {
  // Between them an island shaped like a C, its bay open toward the ship: heading straight for the
  // other island takes it into the bay, with land on three sides.
  const wall = [-8, -5, -2.5, 0, 2.5, 5, 8].map((z) => ({ x: 0, z, r: 2 })), arms = [-8, 8].flatMap((z) => [{ x: -3, z, r: 2 }, { x: -6, z, r: 2 }]);
  const distance = isles([{ x: -20, z: 0, r: 5 }, { x: 20, z: 0, r: 5 }, ...wall, ...arms]);
  const from = offShore(-20, 0, 1, 0, distance, 1.2), to = offShore(20, 0, -1, 0, distance, 1.2);
  expect(distance(from.x, from.z)).toBeGreaterThanOrEqual(1.2);
  // The first water that clear of the shore, toward the other island: not further out.
  expect(from.x).toBeGreaterThan(-13.85);
  expect(from.x).toBeLessThan(-13.5);
  const fleet = new Fleet();
  fleet.setErrands([{ kind: "ferry", key: "ferry:a>b", from, to, flag: "#3b82f6" }], distance);
  let nearest = Infinity, closest = Infinity;
  for (let f = 0; f < 60 * 150; f++) {
    fleet.update(f / 60, 1 / 60, calm, distance, false, () => {});
    const [s] = drawn(fleet);
    nearest = Math.min(nearest, distance(s!.x, s!.z));
    closest = Math.min(closest, Math.hypot(s!.x - to.x, s!.z - to.z));
  }
  expect(nearest).toBeGreaterThan(0.2);
  expect(closest).toBeLessThan(1);
});

test("Ships: a boat comes out for an agent calling you, lies off its island, and goes once the call is answered", () => {
  const distance = isles([{ x: 0, z: 0, r: 6 }]);
  const fleet = new Fleet();
  const call: Errand = { kind: "moored", key: "call:t1", from: offShore(4, 0, 1, 0, distance, 0.8), at: offShore(4, 0, 1, 0, distance, 1.8), flag: "#f59e0b" };
  fleet.setErrands([call], distance);
  for (let f = 0; f < 60 * 30; f++) fleet.update(f / 60, 1 / 60, calm, distance, false, () => {});
  const [s] = drawn(fleet);
  expect(Math.hypot(s!.x - call.at.x, s!.z - call.at.z)).toBeLessThan(1);
  fleet.setErrands([], distance);
  for (let f = 0; f < 60 * 3; f++) fleet.update(30 + f / 60, 1 / 60, calm, distance, false, () => {});
  expect(fleet.count).toBe(0);
  expect(drawn(fleet)).toEqual([]);
});

test("Ships: a ship tilts to the slope of the sea where it is, the swell the sea draws, and the wind raises it", () => {
  for (const [x, z, t] of [[3.2, -7.5, 1.3], [-12, 4.4, 9.7]] as const) {
    const at = seaAt(x, z, t, 1.4), e = 1e-4;
    expect(at.sx).toBeCloseTo((seaAt(x + e, z, t, 1.4).h - seaAt(x - e, z, t, 1.4).h) / (2 * e), 4);
    expect(at.sz).toBeCloseTo((seaAt(x, z + e, t, 1.4).h - seaAt(x, z - e, t, 1.4).h) / (2 * e), 4);
    expect(Math.abs(seaAt(x, z, t, 2).h)).toBeCloseTo(Math.abs(seaAt(x, z, t, 1).h) * 2, 6);
  }
  expect(SWELLS.length).toBe(5);
});

test("Ships: a ship sent for a place on land, with no way there by water, stops at the shore and never goes aground", () => {
  const distance = isles([{ x: 0, z: 0, r: 6 }]);
  const fleet = new Fleet();
  // A ring smaller than the island: every place on it is ashore.
  fleet.setErrands([{ kind: "fishing", key: "fish:a", cx: 0, cz: 0, r: 3, flag: "#22c55e" }], distance);
  let nearest = Infinity;
  for (let f = 0; f < 60 * 60; f++) {
    fleet.update(f / 60, 1 / 60, { ...calm, wind: 1 }, distance, false, () => {});
    const [s] = drawn(fleet);
    nearest = Math.min(nearest, distance(s!.x, s!.z));
  }
  expect(nearest).toBeGreaterThan(0.3);
});
