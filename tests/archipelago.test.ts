// Archipelago, the view the archipelago package holds: what it works out from the workspace, and
// what you do walking it, run by the view's own code with no app and no GPU.
import { expect, test } from "bun:test";
import * as THREE from "three";
import * as isle from "../packages/archipelago/views/archipelago/src/world";
import { Pins } from "../packages/archipelago/views/archipelago/src/pins";
import { islandInSight, placeNames } from "../packages/archipelago/views/archipelago/src/names";
import { Blocks, TALK, Walker, aside, giveWay, into } from "../packages/archipelago/views/archipelago/src/walker";
import { Eye, povOf } from "../packages/archipelago/views/archipelago/src/eye";
import { Atmosphere } from "../packages/archipelago/views/archipelago/src/atmosphere";

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
  // Through your eyes the camera looks from where it stands, however far back the view from behind was
  // left: no pin over the workers you stand among, and none to click.
  const eye = new Eye();
  eye.toggle();
  eye.step(1, true, false);
  camera.fov = 60;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0.6, 3);
  camera.lookAt(0, 0.5, 0);
  camera.updateMatrixWorld();
  expect(pins.update(workers, camera, eye.away(22), 800, 0, false)).toBe(false);
  expect(pins.mesh.geometry.instanceCount).toBe(0);
  expect(pins.pick(disc("near").x, disc("near").y, camera, 1280, 800)).toBe(null);
});

// The names over the islands, placed as main.ts places them each frame: the middle of each one's foot
// where it stands, in a window 1024 by 704; boxes are 3 px wider on each side and 2 px taller (names.ts).
const ROOM = { w: 1024, h: 704, left: 0 };
const boxOf = (n: { w: number; h: number }, at: { x: number; y: number } | null) => at && { x0: at.x - n.w / 2 - 3, x1: at.x + n.w / 2 + 3, y0: at.y - n.h - 2, y1: at.y + 2 };

test("Archipelago: an island's name that meets an agent's name, an agent calling you from its far edge, stands directly above it, and with that taken too it waits for room", () => {
  const caller = { x: 520, y: 270, w: 116, h: 24 };
  const web = { x: 560, y: 262, w: 258, h: 27, island: true };
  const [c, i] = placeNames([caller, web], [], ROOM);
  expect(c).toEqual({ x: 520, y: 270 });
  // Over the same middle, its foot on the top of the caller's box.
  expect(i).toEqual({ x: 560, y: boxOf(caller, c)!.y0 - 2 });
  // An agent's name gets no second place; nor does an island's where the place above is taken too, or
  // past the top of the window.
  expect(placeNames([caller, { ...web, island: false }], [], ROOM)[1]).toBe(null);
  const picked = { x: 540, y: 228, w: 90, h: 24 };
  expect(placeNames([caller, picked, web], [], ROOM)[2]).toBe(null);
  expect(placeNames([{ ...caller, y: 40 }, { ...web, y: 36 }], [], ROOM)[1]).toBe(null);
  // Nor above a panel it meets, the agent's card, say, which would take it far from its island.
  const card = { x0: 400, y0: 240, x1: 700, y1: 420 };
  expect(placeNames([web], [card], ROOM)[0]).toBe(null);
});

test("Archipelago: names stop below the top of the window, an island's at the edge of the widget column as at the window's, and an agent's under the column does not show", () => {
  // An island whose top is past the top of the window, its middle in the picture, keeps its name; one
  // whose middle is past it too is out of the picture.
  expect([islandInSight({ x: 600, y: -30, mid: 60 }, ROOM), islandInSight({ x: 600, y: -90, mid: 10 }, ROOM)]).toEqual([true, false]);
  // Past the top, a name stops with its top 12 px below it, island's and agent's alike.
  const high = { x: 600, y: -30, w: 200, h: 27, island: true };
  expect(placeNames([high, { x: 300, y: 5, w: 90, h: 24 }], [], ROOM)).toEqual([{ x: 600, y: 39 }, { x: 300, y: 36 }]);
  // An island under the widget column is out of the picture, as one past the window's edge is.
  expect([islandInSight({ x: 200, y: 300, mid: 340 }, { ...ROOM, left: 268 }), islandInSight({ x: 200, y: 300, mid: 340 }, ROOM), islandInSight({ x: 10, y: 300, mid: 340 }, ROOM)]).toEqual([false, true, false]);
  // The app floats its widget cards 268 px wide down the left edge: an island's name over its edge
  // stops at it, as at the window's edge, and one inside the window at all keeps to the window.
  const column = { ...ROOM, left: 268 };
  const [isl] = placeNames([{ x: 300, y: 300, w: 258, h: 27, island: true }], [], column);
  expect(boxOf({ w: 258, h: 27 }, isl)!.x0).toBeGreaterThanOrEqual(268);
  expect(isl!.y).toBe(300);
  expect(placeNames([{ x: 300, y: 300, w: 258, h: 27, island: true }], [], ROOM)[0]).toEqual({ x: 300, y: 300 });
  // An agent's name over the column is under the cards: it does not show.
  expect(placeNames([{ x: 250, y: 300, w: 100, h: 24 }], [], column)[0]).toBe(null);
  expect(placeNames([{ x: 250, y: 300, w: 100, h: 24 }], [], ROOM)[0]).toEqual({ x: 250, y: 300 });
});

test("Archipelago: a name a panel's edge would cover moves aside along its row, up to half its width; one stopped at the top stands below the panel it meets there; one further under it elsewhere does not show", () => {
  // The header beside one column of widget cards, and an agent calling you so close that its name stops
  // at the top of the window, its left end under the header's right edge.
  const head = { x0: 268, y0: 12, x1: 548, y1: 62 };
  const close = { x: 632, y: -40, w: 178, h: 24 };
  const [at] = placeNames([close], [head], ROOM);
  expect(at!.y).toBe(36);
  expect(boxOf(close, at)!.x0).toBe(548);
  // Further under it than half its width, stopped at the top: it stands just below the header.
  expect(placeNames([{ ...close, x: 520 }], [head], ROOM)[0]).toEqual({ x: 520, y: 62 + 24 + 4 });
  // Not stopped at the top, further under a panel than half its width: it waits for room.
  expect(placeNames([{ ...close, x: 520, y: 40 }], [head], ROOM)[0]).toBe(null);
});

test("Archipelago: the name the keyboard is on shows whatever names it meets, and those placed after it keep clear of it; where a panel or a docked terminal would cover it, it stands at the top of the window", () => {
  const focused = { x: 500, y: 420, w: 150, h: 27, island: true, keep: true };
  // An island placed after it stands directly above it.
  const [f, other] = placeNames([focused, { x: 600, y: 425, w: 150, h: 27, island: true }], [], ROOM);
  expect(f).toEqual({ x: 500, y: 420 });
  expect(other).toEqual({ x: 600, y: boxOf(focused, f)!.y0 - 2 });
  // Over a calling agent's name placed before it, with no room above that, where it stands.
  expect(placeNames([{ x: 480, y: 40, w: 116, h: 24 }, { ...focused, y: 36 }], [], ROOM)[1]).toEqual({ x: 500, y: 39 });
  // The agent's card is drawn over the names: the focused one goes to the top of the window, across
  // where it was, and one without focus does not show.
  const card = { x0: 420, y0: 410, x1: 520, y1: 704 };
  expect(placeNames([focused], [card], ROOM)[0]).toEqual({ x: 500, y: 39 });
  expect(placeNames([{ ...focused, keep: false }], [card], ROOM)[0]).toBe(null);
  // Two columns of widget cards to 520 and a terminal docked from 502 (names stop 16 px short of it):
  // no room between them, so not under the terminal but above where it starts, clear of the cards.
  const dock = { x0: 502, y0: 64, x1: 944, y1: 412 }, between = { w: 960, h: 640, left: 520, right: 486 };
  expect(placeNames([{ ...focused, x: 700, y: 300 }], [dock], between)[0]).toEqual({ x: 700, y: 39 });
  expect(placeNames([{ ...focused, x: 700, y: 300, keep: false }], [], between)[0]).toBe(null);
});

test("Archipelago: a bird never shows wider than 90 px: one flying near the camera is drawn smaller and one behind it not at all, while those further off fly at their size, pale on their backs by day", () => {
  const air = new Atmosphere();
  air.build([{ x: 0, z: 0, r: 8 }], 40);
  const camera = new THREE.PerspectiveCamera(32, 1280 / 800, 0.5, 2000);
  const at = (dist: number) => { camera.position.set(0, dist * 0.73, dist * 0.68); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); };
  const day = isle.skyAt(12);
  // How wide each bird stands on screen, in pixels of a view 800 high: across its two furthest
  // points, with its wings at the top and at the bottom of a beat, as the shader moves them.
  const m = new THREE.Matrix4(), shape = air.birds.geometry.getAttribute("position");
  const widths = () => Array.from({ length: air.birds.count }, (_, i) => {
    air.birds.getMatrixAt(i, m);
    if (m.elements[0] === 0 && m.elements[1] === 0 && m.elements[2] === 0) return 0;
    return Math.max(...[-1, 1].map((flap) => {
      const pts = Array.from({ length: shape.count }, (_, k) => {
        const p = new THREE.Vector3().fromBufferAttribute(shape, k);
        return p.setY(p.y + Math.abs(p.x) * flap * 0.55).applyMatrix4(m);
      });
      if (pts.some((p) => p.clone().applyMatrix4(camera.matrixWorldInverse).z > -camera.near)) return Infinity;
      const px = pts.map((p) => p.project(camera)).map((p) => [p.x * 640, p.y * 400] as const);
      return Math.max(...px.flatMap(([x, y]) => px.map(([u, v]) => Math.hypot(x - u, y - v))));
    }));
  });
  // From the overview every bird is small and flies at its size.
  at(120);
  air.update(1, day, 0.5, false, camera, 800);
  const far = widths();
  expect(far.length).toBeGreaterThan(0);
  expect(Math.max(...far)).toBeLessThan(20);
  // Close over the island some come near the camera: none shows wider than 90 px, and the nearest
  // are drawn close to that, not shrunk to specks.
  let widest = 0;
  for (const dist of [9, 12, 16, 20]) {
    at(dist);
    for (const t of [1, 3, 5, 7, 9, 11]) {
      air.update(t, day, 0.5, false, camera, 800);
      for (const w of widths()) { expect(w).toBeLessThanOrEqual(90); widest = Math.max(widest, w); }
    }
  }
  expect(widest).toBeGreaterThan(70);
  // By day a gull's back is pale, as the clouds are, and its belly a shade seen against the sky.
  const u = air.birds.material.uniforms;
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  expect(lum(u.uBack!.value)).toBeGreaterThan(0.6);
  expect(lum(u.uBack!.value)).toBeGreaterThan(4 * lum(u.uBelly!.value));
  // By night, and with less motion, no birds.
  at(40);
  air.update(1, isle.skyAt(0), 0.5, false, camera, 800);
  expect(air.birds.visible).toBe(false);
  air.update(1, day, 0.5, false, camera, 800);
  expect(air.birds.visible).toBe(true);
  air.update(1, day, 0.5, true, camera, 800);
  expect(air.birds.visible).toBe(false);
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
  // Through your own eyes, the one you face first: one ahead at arm's length before one nearer behind
  // you, though one right beside you still comes before one further ahead. From behind, the nearest.
  const two = [{ tileId: "behind", x: 0.7, z: 0 }, { tileId: "ahead", x: -1.3, z: 0 }];
  me.eyes = true;
  me.face(0);
  expect(me.nearest(two)).toBe("ahead");
  expect(me.nearest([{ tileId: "beside", x: 0, z: 0.6 }, { tileId: "ahead", x: -1.3, z: 0 }])).toBe("beside");
  me.eyes = false;
  expect(me.nearest(two)).toBe("behind");
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
  // Pushing on against it you stand: not walking, so your head does not bob nor your worker walk.
  expect(me.step(1 / 60, 0, ground)).toBe(false);
  expect(me.moving).toBe(false);
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
  me.step(0.15, 0, ground);
  expect(me.x).toBeCloseTo(-0.1 - 2.4 * 0.15, 6);
  // Landing, with nowhere you come from: not in the house, nor with your body against its wall.
  expect([0.3, 0.6 + body - 0.02, 0.6 + body + 0.02].map((x) => blocks.clear(x, 0))).toEqual([false, false, true]);
  me.release();
  // Walked straight into another worker kept 0.95 off, you stop there facing it, rather than going
  // round it as you go round a tree: it stays dead ahead.
  const yaw = 0.3, ahead = { x: -Math.cos(yaw), z: -Math.sin(yaw) }, other = { x: ahead.x * 2, z: ahead.z * 2 };
  const people = { stand: (x: number, z: number, fromX?: number, fromZ?: number) => !into(x, z, other.x, other.z, 0.95, fromX, fromZ), meets: (x: number, z: number) => Math.hypot(x - other.x, z - other.z) < 0.95 };
  me.place(0, 0);
  me.press("w", true);
  for (let f = 0; f < 120; f++) me.step(1 / 60, yaw, people);
  const off = Math.hypot(other.x - me.x, other.z - me.z);
  expect(off).toBeGreaterThanOrEqual(0.95);
  expect(off).toBeLessThan(0.95 + 0.05);
  expect(((other.x - me.x) * ahead.x + (other.z - me.z) * ahead.z) / off).toBeGreaterThan(Math.cos(0.1));
});

test("Archipelago: walking, the other workers keep out of your room: one walking your way goes round you, one going where you stand waits at its edge, and a helper circling past steps aside", () => {
  const room = 0.95, by = 1.1 / 60, at = { x: 0, z: 0 };
  // From 3 west of you to 3 east, straight through where you stand: round you, never nearer your
  // middle than your room, and on to where it was going.
  let x = -3, z = 0, closest = Infinity, f = 0;
  for (; f < 600 && (x !== 3 || z !== 0); f++) {
    giveWay(x, z, 3, 0, by, 0, 0, room, at);
    x = at.x; z = at.z;
    closest = Math.min(closest, Math.hypot(x, z));
  }
  expect([x, z]).toEqual([3, 0]);
  expect(closest).toBeGreaterThan(room - 1e-9);
  // Going to a spot inside your room: it stops at the edge, on its own side, and waits there.
  x = -3; z = 0;
  for (f = 0; f < 300; f++) { giveWay(x, z, 0.5, 0, by, 0, 0, room, at); x = at.x; z = at.z; }
  expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(room);
  expect(Math.hypot(x, z)).toBeLessThan(room + by);
  expect(x).toBeLessThan(0);
  giveWay(x, z, 0.5, 0, by, 0, 0, room, at);
  expect([at.x, at.z]).toEqual([x, z]);
  // Already inside your room as you came (from behind it is smaller): no nearer, nor round you through
  // your eyes; away from you, as it likes.
  giveWay(0.5, 0, -3, 0, by, 0, 0, room, at);
  expect([at.x, at.z]).toEqual([0.5, 0]);
  giveWay(0.5, 0, 3, 0, 0.1, 0, 0, room, at);
  expect([at.x, at.z]).toEqual([0.6, 0]);
  // A helper circling a site where you stand: moved out to the edge of your room, straight away from
  // you; anywhere else, where it is.
  aside(0.3, 0.4, 0, 0, room, at);
  expect(Math.hypot(at.x, at.z)).toBeCloseTo(room, 9);
  expect(at.x / at.z).toBeCloseTo(0.75, 9);
  aside(2, 0, 0, 0, room, at);
  expect([at.x, at.z]).toEqual([2, 0]);
});

test("Archipelago: through your own eyes you walk at a calm pace and ← → turn you, while from behind the arrows step you aside; either way you come up to pace and to a stop over a moment", () => {
  const flat = { stand: () => true };
  const me = new Walker();
  /** How far you go holding `keys` for `seconds` at 60 frames a second, from where you are. */
  const go = (seconds: number, yaw = 0) => {
    const x = me.x, z = me.z;
    for (let f = 0; f < seconds * 60; f++) me.step(1 / 60, yaw, flat);
    return Math.hypot(me.x - x, me.z - z);
  };
  // From behind: 2.4 a second walking once up to pace, 4.6 running.
  me.press("w", true);
  go(0.5);
  expect(go(1)).toBeCloseTo(2.4, 6);
  me.press("w", true, true);
  go(0.5);
  expect(go(1)).toBeCloseTo(4.6, 6);
  me.release();
  // Through your eyes: 0.6 of those, a calm walk and a run.
  me.eyes = true;
  me.press("w", true);
  go(0.5);
  expect(go(1)).toBeCloseTo(1.44, 6);
  me.press("w", true, true);
  go(0.5);
  expect(go(1)).toBeCloseTo(2.76, 6);
  me.release();
  // Starting, the first tenth of a second covers less than full pace would, but you are moving;
  // letting go, you slow to a stop within 0.15 s, a few hundredths of a unit on.
  me.press("w", true);
  const first = go(0.1);
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThan(1.44 * 0.1 * 0.75);
  go(1);
  me.press("w", false);
  expect(me.active).toBe(true);
  const after = go(0.2);
  expect(after).toBeGreaterThan(0.05);
  expect(after).toBeLessThan(1.44 * 0.15);
  expect(me.moving).toBe(false);
  expect(me.active).toBe(false);
  // → held through your eyes turns you right, up to 2 radians a second, and moves you nowhere. It comes
  // up to speed over a moment: the first frame turns you less than half what a frame at full speed does.
  me.press("ArrowRight", true);
  let turned = me.turn(1 / 60);
  expect(turned).toBeGreaterThan(0);
  expect(turned).toBeLessThan(2 / 60 / 2);
  for (let f = 1; f < 60; f++) turned += me.turn(1 / 60);
  expect(go(0.5)).toBe(0);
  for (let f = 0; f < 60; f++) turned += me.turn(1 / 60);
  expect(turned).toBeGreaterThan(2 * 2 - 0.2);
  expect(turned).toBeLessThanOrEqual(2 * 2);
  me.press("ArrowRight", false);
  me.press("ArrowLeft", true);
  let back = 0;
  for (let f = 0; f < 60; f++) back += me.turn(1 / 60);
  expect(back).toBeLessThan(-1.5);
  me.release();
  // A and D still step you aside, without turning you.
  me.place(0, 0);
  me.press("d", true);
  go(0.5);
  expect(me.z).toBeLessThan(-0.5);
  expect(me.turn(1 / 60)).toBe(0);
  me.release();
  // From behind, → steps you aside and does not turn you.
  me.eyes = false;
  me.place(0, 0);
  me.press("ArrowRight", true);
  go(0.5);
  expect(me.z).toBeLessThan(-0.5);
  expect(me.turn(1 / 60)).toBe(0);
});

test("Archipelago: the coast's distance out to sea, where the foam is drawn, is right to a fraction of the grid it is kept on, so the foam's edge does not step along the grid", async () => {
  const { Terrain, COAST } = await import("../packages/archipelago/views/archipelago/src/terrain");
  const tiles: { x: number; z: number; lift: number }[] = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (isle.tilesApart({ q, r }, { q: 0, r: 0 }) <= 3) tiles.push({ x: 2 * q + r, z: Math.sqrt(3) * r, lift: 0 });
  const ground = new Terrain(new THREE.MeshBasicMaterial());
  ground.build([{ id: "i", x: 0, z: 0, r: 7, seed: 1, grass: 0x6aa847, tiles }]);
  // The grid the scene keeps it on for a world this size: 512 cells, about 0.15 across.
  const n = 512, half = 39, step = (half * 2) / n;
  const d = ground.shoreDistances(n, -half, -half, step);
  /** The distance read between cells, as the sea's texture is. */
  const read = (x: number, z: number) => {
    const u = (x + half) / step - 0.5, v = (z + half) / step - 0.5, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    return (d[j * n + i]! * (1 - fu) + d[j * n + i + 1]! * fu) * (1 - fv) + (d[(j + 1) * n + i]! * (1 - fu) + d[(j + 1) * n + i + 1]! * fu) * fv;
  };
  /** How far the nearest land is, looked for round the point. */
  const truth = (x: number, z: number) => {
    let best = Infinity;
    for (let k = 0; k < 360; k++) {
      const c = Math.cos((k / 180) * Math.PI), s = Math.sin((k / 180) * Math.PI);
      for (let r = 0; r < Math.min(best, 1); r += 0.004) if (ground.land(x + c * r, z + s * r) >= COAST) { best = r; break; }
    }
    return best;
  };
  // Just off the coast all round, across the foam: on average within a tenth of a cell.
  let sum = 0, n2 = 0;
  for (let k = 0; k < 48; k++) {
    const c = Math.cos((k / 48) * Math.PI * 2), s = Math.sin((k / 48) * Math.PI * 2);
    let r = 3;
    while (ground.land(c * r, s * r) >= COAST) r += 0.01;
    for (const off of [0.05, 0.2, 0.4]) { sum += Math.abs(read(c * (r + off), s * (r + off)) - truth(c * (r + off), s * (r + off))); n2++; }
  }
  expect(sum / n2).toBeLessThan(step * 0.15);
  // Land is 0, and the open sea far off is far.
  expect(read(0, 0)).toBe(0);
  expect(read(0, 20)).toBeGreaterThan(9);
});

test("Archipelago: through your own eyes you stand at your worker's eye height on the ground under you, look the way W walks, and no further up or down than 60 degrees", () => {
  const eye = new Eye(), at = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3();
  const look = (x: number, z: number, ground: number, yaw: number) => { eye.pose(x, z, ground, 0.8, yaw, at, to); return dir.subVectors(to, at).normalize(); };
  // Eyes three quarters of the way up a worker 0.8 tall, where its face is, on whatever ground is under it.
  for (const ground of [0, 0.6]) {
    look(3, -2, ground, 0.7);
    expect([at.x, at.z]).toEqual([3, -2]);
    expect(at.y).toBeCloseTo(ground + 0.6, 6);
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
  expect(Math.asin(look(0, 0, 0, 0).y)).toBeCloseTo(Math.PI / 3, 6);
  eye.look(-20);
  expect(Math.asin(look(0, 0, 0, 0).y)).toBeCloseTo(-Math.PI / 3, 6);
  // Walking on with no drag, your look comes back to where it starts, a little below level, a radian a
  // second, and stays there.
  eye.look(10);
  eye.settle(0.5);
  expect(eye.pitch).toBeCloseTo(Math.PI / 3 - 0.5, 6);
  for (let f = 0; f < 120; f++) eye.settle(1 / 60);
  expect(eye.pitch).toBeCloseTo(-0.1, 6);
});

test("Archipelago: switching view moves the camera into your eyes and back out over 0.4 s, at once with less motion, widening the lens and drawing near", () => {
  // A window 1280 by 800.
  const wide = 1.6;
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
  expect(eye.fov(wide)).toBeCloseTo((60 + 32) / 2, 6);
  expect(eye.near).toBe(0.1);
  expect(eye.inside).toBe(false);
  expect(eye.step(0.2, true, false)).toBe(false);
  expect([eye.blend, eye.fov(wide), eye.near, eye.inside]).toEqual([1, 60, 0.1, true]);
  // Flying up, the camera leaves your eyes, the near plane only once it is all the way out; the choice stays.
  eye.step(0.36, false, false);
  expect([eye.near, eye.inside]).toEqual([0.1, false]);
  eye.step(0.05, false, false);
  expect([eye.blend, eye.fov(wide), eye.near, eye.pov]).toEqual([0, 32, 0.5, "first"]);
  // With less motion, at once.
  expect(eye.step(1 / 60, true, true)).toBe(false);
  expect(eye.blend).toBe(1);
  expect(eye.toggle()).toBe("third");
  eye.step(1 / 60, true, true);
  expect(eye.blend).toBe(0);
});

test("Archipelago: through your eyes you see 60 degrees up and down, and never more than 100 across however wide the window, so the edges are not stretched", () => {
  const eye = new Eye();
  eye.toggle();
  eye.step(1, true, false);
  /** How wide it sees across, in degrees, in a window `aspect` times as wide as tall. */
  const across = (aspect: number) => (2 * Math.atan(Math.tan((eye.fov(aspect) * Math.PI) / 360) * aspect) * 180) / Math.PI;
  // 1280 by 800, 16 by 9 and a narrow window: 60 up and down, about 85 and 92 across at the first two.
  expect([eye.fov(1280 / 800), eye.fov(16 / 9), eye.fov(760 / 900)]).toEqual([60, 60, 60]);
  expect(across(1280 / 800)).toBeCloseTo(85.5, 1);
  expect(across(16 / 9)).toBeCloseTo(91.5, 1);
  // A window three times as wide as tall: narrower up and down, so it is still 100 across.
  expect(eye.fov(1900 / 640)).toBeLessThan(45);
  expect(across(1900 / 640)).toBeCloseTo(100, 6);
});

test("Archipelago: landing through your eyes from high above takes 0.8 s, and the view turns to where you face by the time your eyes arrive, not after", () => {
  // From the overview, 44 units up, your eyes arrive in 0.8 s, half way there at 0.4 s.
  const eye = new Eye();
  eye.toggle();
  eye.land(44);
  for (let f = 0; f < 24; f++) eye.step(1 / 60, true, false);
  expect(eye.blend).toBeCloseTo(0.5, 6);
  // Turning 1.5 radians the way the camera eases (2.6 a second) while the eyes come in: done when they arrive.
  const turned = (eye: Eye, frames: number) => {
    let yaw = 0;
    for (let f = 0; f < frames; f++) { eye.step(1 / 60, true, false); yaw += (1.5 - yaw) * Math.max(1 - Math.exp(-2.6 / 60), eye.share); }
    return yaw;
  };
  expect(turned(eye, 24)).toBeCloseTo(1.5, 6);
  expect(eye.blend).toBe(1);
  // Once there, the next change is the usual 0.4 s: half way back out at 0.2 s.
  eye.step(0.2, false, false);
  expect(eye.blend).toBeCloseTo(0.5, 6);
  // From close above, as when you switch with V, 0.4 s, the turn done with it; once there, no hurry.
  const near = new Eye();
  near.toggle();
  near.land(7);
  expect(turned(near, 24)).toBeCloseTo(1.5, 6);
  for (let f = 0; f < 3; f++) near.step(1 / 60, true, false);
  expect(near.share).toBe(0);
});

test("Archipelago: through your eyes you ride over the ground smoothly: a step in its height comes as a slope over a few frames, not a jolt", () => {
  const eye = new Eye();
  eye.toggle();
  // Where your eyes first open, the ground itself.
  expect(eye.ride(0.3, 1 / 60)).toBe(0.3);
  // Walking up steps a tenth of a unit high: no frame rises more than a fifth of one, and the eyes
  // reach the top.
  let was = 0.3, most = 0, at = 0.3;
  for (let f = 0; f < 120; f++) {
    at = eye.ride(0.3 + Math.min(3, Math.floor(f / 20)) * 0.1, 1 / 60);
    most = Math.max(most, Math.abs(at - was));
    was = at;
  }
  expect(most).toBeLessThanOrEqual(0.02);
  expect(at).toBeCloseTo(0.6, 3);
  // Back behind you, the eyes let go of it: the next time they open, on the ground where you are.
  eye.step(1, true, false);
  eye.toggle();
  eye.step(1, true, false);
  expect(eye.ride(1.1, 1 / 60)).toBe(1.1);
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
