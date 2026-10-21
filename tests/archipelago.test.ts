// Archipelago, the view the archipelago package holds: what it works out from the workspace, and
// what you do walking it, run by the view's own code with no app and no GPU.
import { expect, test } from "bun:test";
import * as THREE from "three";
import * as isle from "../packages/archipelago/views/archipelago/src/world";
import { Pins } from "../packages/archipelago/views/archipelago/src/pins";
import { TALK, Walker } from "../packages/archipelago/views/archipelago/src/walker";

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
