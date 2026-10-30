// Blocks, the package of three live wallpapers (Block Island, Brick Town, Block Valley): each
// scene run through the SDK's fakeWallpaperHost as the app connects it (runScene), with the
// randomness seeded and no canvas (its drawing is a stand-in that counts frames); its colours
// measured against the app's own presets; the package read by the app's package reader and
// HiveHub's check; and its build loaded in Chromium the way the app serves it. Each bar sits clear
// of what 20 or more seeds measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import { runScene, type Sim } from "../packages/blocks/src/scene";
import { seededRandom } from "../packages/blocks/src/rng";
import { rgbOf, type Oklch, type Rgb } from "../packages/blocks/src/colour";
import { SPECK_DARK, SPECK_LIGHT } from "../packages/blocks/src/textures";
import { CAPS, Island } from "../packages/blocks/src/island/world";
import { at, Mat as IslandMat, topAt, TREE_SHAPES } from "../packages/blocks/src/island/land";
import { ISLAND_PALETTE, type Shades } from "../packages/blocks/src/island/palette";
import { BRICKS, LOOK_REACH, Town } from "../packages/blocks/src/bricktown/town";
import { TOWN_PALETTE } from "../packages/blocks/src/bricktown/palette";
import { DROPS, PUFFS, Valley } from "../packages/blocks/src/valley/valley";
import { idx, SIZE } from "../packages/blocks/src/valley/terrain";
import { VALLEY_PALETTE } from "../packages/blocks/src/valley/palette";

const PKG = path.join(ROOT, "packages/blocks");
setDefaultTimeout(120_000);
const W = 1440;
const H = 900;
const STEP = 1 / 60;

/** Run `fn` with Math.random seeded: the animals' habits, the cars and people, the drops. */
async function seeded<T>(seed: number, fn: () => Promise<T> | T): Promise<T> {
  const real = Math.random;
  Math.random = seededRandom(seed);
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}
const run = (sim: Sim, secs: number, each?: () => void) => {
  for (let i = 0; i < secs / STEP; i++) {
    sim.step(STEP);
    each?.();
  }
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** A scene connected to a fake host as the app would connect it, drawn by a stand-in that counts
 *  its frames; the test steps it by hand while the mode is not `run`. */
async function open<S extends Sim>(sim: S, opts: FakeWallpaperOptions = {}) {
  const host = fakeWallpaperHost({ viewport: { w: W, h: H, dpr: 1 }, mode: "hold", ...opts });
  const wp = await host.connect();
  const seen = { draws: 0 };
  const stop = runScene(wp, sim, { resize() {}, setLook() {}, draw() { seen.draws++; } });
  await host.settle();
  return { host, sim, seen, done: () => { stop(); host.close(); } };
}

/** What a glance finds in each scene, where it shows in the window (CSS px): the animals; the cars
 *  and the people; the birds. */
interface Body { kind: string; x: number; y: number }
const SCENES = {
  island: { make: () => new Island(), bodies: (s: Island): Body[] => s.animals.map((a) => ({ kind: a.kind, ...s.screenOf(a.x, a.y, a.z + 0.4) })) },
  bricktown: {
    make: () => new Town(),
    bodies: (s: Town): Body[] => [
      ...s.cars.map((c) => ({ kind: "car", ...s.screenOf(c.axis === "x" ? c.s : c.line + 0.5, c.axis === "x" ? c.line + 0.5 : c.s, 0.4) })),
      ...s.people.map((p) => ({ kind: "person", ...s.screenOf(p.x, p.y, 0.6) })),
    ],
  },
  valley: { make: () => new Valley(), bodies: (s: Valley): Body[] => s.birds.map((b) => { const a = s.birdAt(b); return { kind: "bird", ...(s.project([a.x, a.y, a.z]) ?? { x: -1, y: -1 }) }; }) },
} as const;
type SceneName = keyof typeof SCENES;
const NAMES = Object.keys(SCENES) as SceneName[];
const bodiesOf = (name: SceneName, sim: Sim) => (SCENES[name].bodies as (s: Sim) => Body[])(sim);
const scene = (name: SceneName, opts: FakeWallpaperOptions = {}) => open(SCENES[name].make() as Sim, opts);

describe("Blocks", () => {
  // ── what lives there, from the first frame ───────────────────────────────

  test("each scene is full from its first frame: made for the window's size, more life on a bigger one, spread over all of it", async () => {
    const counts: Record<SceneName, number[]> = { island: [], bricktown: [], valley: [] };
    // Over 24 seeds at each size: the island's animals in the window, across 39% to 58% of its
    // width and 17% to 35% of its height, in all four quarters; 96% to 100% of the town's cars and
    // people in the window, across 86% and more of it, in all four quarters; the valley's birds in
    // sight, across 35% to 97%; its land filling the lower half of the view and sky at the top.
    const bars = {
      island: { inside: 1, quadrants: 3, wide: 0.3, tall: 0.12 },
      bricktown: { inside: 0.9, quadrants: 4, wide: 0.7, tall: 0.5 },
      valley: { inside: 1, quadrants: 1, wide: 0.25, tall: 0 },
    };
    for (const name of NAMES) {
      for (const [w, h] of [[1024, 640], [1440, 900], [2560, 1440]] as const) {
        for (const seed of [1, 2, 3]) {
          await seeded(seed, async () => {
            // Held: its first frame is drawn without a step.
            const s = await scene(name, { viewport: { w, h, dpr: 1 } });
            try {
              const where = `${name} ${w}×${h} seed ${seed}`;
              const all = bodiesOf(name, s.sim);
              const bodies = all.filter((b) => b.x >= 0 && b.x <= w && b.y >= 0 && b.y <= h);
              const xs = bodies.map((b) => b.x);
              const ys = bodies.map((b) => b.y);
              const bar = bars[name];
              expect({ where, draws: s.seen.draws, kinds: new Set(all.map((b) => b.kind)).size, inside: bodies.length / all.length >= bar.inside })
                .toEqual({ where, draws: 1, kinds: name === "valley" ? 1 : 2, inside: true });
              expect({ where, quadrants: new Set(bodies.map((b) => `${b.x < w / 2}${b.y < h / 2}`)).size >= bar.quadrants, wide: Math.max(...xs) - Math.min(...xs) > w * bar.wide, tall: Math.max(...ys) - Math.min(...ys) >= h * bar.tall })
                .toEqual({ where, quadrants: true, wide: true, tall: true });
              if (name === "valley") {
                // The land fills the view below its middle; the sky shows along its top.
                const v = s.sim as Valley;
                const land: boolean[] = [];
                for (let y = 0.5; y <= 0.97; y += 0.05) for (let x = 0.03; x <= 0.97; x += 0.05) land.push(!!v.columnAt(x * w, y * h));
                const sky = [0.03, 0.25, 0.5, 0.75, 0.97].map((x) => v.columnAt(x * w, 0.03 * h));
                expect({ where, land: land.every(Boolean), sky }).toEqual({ where, land: true, sky: [null, null, null, null, null] });
              }
              if (seed === 1) counts[name].push(all.length);
            } finally {
              s.done();
            }
          });
        }
      }
    }
    // More on a bigger window: a laptop's has plenty, a big screen more.
    for (const name of NAMES) expect({ name, more: counts[name][2]! > counts[name][0]!, plenty: counts[name][0]! >= 6 }).toEqual({ name, more: true, plenty: true });
  });

  test("Block Island fills most of the window's width, its island bigger on a bigger window; the clouds are spread across the sky and along the bottom", async () => {
    const sizes: number[] = [];
    for (const [w, h] of [[1024, 640], [1440, 900], [2560, 1440]] as const) {
      await seeded(4, () => {
        const s = new Island();
        s.resize(w, h, 1);
        const { land } = s;
        const xs: number[] = [];
        for (let k = 0; k < land.top.length; k++) {
          if (land.top[k]! < 0) continue;
          const i = k % land.n;
          const j = Math.floor(k / land.n);
          xs.push(s.screenOf(i, j + 1, land.top[k]!).x, s.screenOf(i + 1, j, land.top[k]!).x);
        }
        const span = (Math.max(...xs) - Math.min(...xs)) / w;
        // 66% to 74% of the width at every size measured.
        expect({ w, fills: span > 0.6 && span < 0.9 }).toEqual({ w, fills: true });
        sizes.push(land.n);
        const far = s.clouds.filter((c) => c.far).map((c) => c.x);
        const low = s.clouds.filter((c) => !c.far);
        expect({ w, far: Math.max(...far) - Math.min(...far) > w * 0.6, low: low.length >= 5 && low.every((c) => c.y > h * 0.85) }).toEqual({ w, far: true, low: true });
      });
    }
    expect(sizes[0]! < sizes[1]! && sizes[1]! < sizes[2]!).toBe(true);
  });

  test("a resize keeps each world and fits it to the new window: the same island with its animals where they were, the same town round the same middle, the same valley", async () => {
    await seeded(5, () => {
      const island = new Island();
      island.resize(W, H, 1);
      run(island, 5);
      const land = island.land;
      const cells = island.animals.map((a) => `${a.ci},${a.cj}`);
      const S = island.iso.S;
      island.resize(1024, 640, 1);
      expect({ land: island.land === land, cells: island.animals.map((a) => `${a.ci},${a.cj}`), smaller: island.iso.S < S, inside: island.screenOf(land.n / 2, land.n / 2, land.base).x - 512 }).toEqual({ land: true, cells, smaller: true, inside: 0 });

      const town = new Town();
      town.resize(W, H, 1);
      run(town, 5);
      const plan = town.plan;
      const centre = { ...town.centre };
      const ids = new Set(town.people.map((p) => p.id));
      town.resize(1024, 640, 1);
      const mid = town.screenOf(centre.x, centre.y, 0);
      expect({ plan: town.plan === plan, centre: town.centre, mid: [Math.round(mid.x), Math.round(mid.y)], kept: town.people.filter((p) => ids.has(p.id)).length >= 6 })
        .toEqual({ plan: true, centre, mid: [512, 320], kept: true });

      const valley = new Valley();
      valley.resize(W, H, 1);
      run(valley, 3);
      const terrain = valley.land;
      valley.splash(W / 2, H * 0.8);
      valley.resize(1024, 640, 1);
      expect({ land: valley.land === terrain, drops: valley.drops.length, aspect: valley.camera.aspect }).toEqual({ land: true, drops: 1, aspect: 1.6 });
    });
  });

  // ── the pointer and clicks ────────────────────────────────────────────────

  // What lives there answers the pointer and clicks the sim is handed (runScene hands them over
  // only while the scene runs: the clock's test, below); each test steps the sim by hand.

  test("Block Island: the animals nearest a resting pointer turn and wander to it, and stand round it facing it", async () => {
    const near: number[] = [];
    const without: number[] = [];
    let facing = 0;
    let standing = 0;
    for (let seed = 11; seed <= 20; seed++) {
      for (const resting of [true, false]) {
        await seeded(seed, () => {
          const s = new Island();
          s.resize(W, H, 1);
          run(s, 3);
          // A spot of open grass a little off the island's middle.
          const n = s.land.n;
          const cells = s.walkableCells().filter((c) => Math.abs(c.i - n * 0.55) + Math.abs(c.j - n * 0.45) < 6);
          const spot = cells[seed % cells.length]!;
          const p = s.screenOf(spot.i + 0.5, spot.j + 0.5, topAt(s.land, spot.i, spot.j));
          s.point(p.x, p.y, resting);
          run(s, 9);
          const by = s.animals.filter((a) => Math.max(Math.abs(a.ci - spot.i), Math.abs(a.cj - spot.j)) <= 2);
          (resting ? near : without).push(by.length);
          if (!resting) return;
          for (const a of by) {
            if (a.ci === spot.i && a.cj === spot.j) continue;
            standing++;
            const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][a.dir]!;
            if (dx! * (spot.i - a.ci) + dy! * (spot.j - a.cj) > 0) facing++;
          }
        });
      }
    }
    // Over 30 seeds, within two columns of a pointer resting 9 s: 2 to 5 animals (3.8 on
    // average); without it, 0 to 3 (0.8); of those come, 98% face it.
    expect({ each: Math.min(...near) >= 1, near: mean(near) > 2.6, without: mean(without) < 1.6, facing: facing / standing > 0.8 }).toEqual({ each: true, near: true, without: true, facing: true });
  });

  test("Block Island: a click pops a block out with a puff of crumbs; it grows back, or a sapling sprouts there and grows into a tree, while the island has room for more trees; a click in the sky puffs out a cloud", async () => {
    let grewBack = 0;
    let sprouted = 0;
    for (let seed = 21; seed <= 36; seed++) {
      await seeded(seed, () => {
        const s = new Island();
        s.resize(W, H, 1);
        run(s, 1);
        const { land } = s;
        // A column of grass in the open: away from the edge (the island all round it), its top in
        // plain sight (nothing in front of it, no tree's crown over it on the screen), with no
        // animal near it.
        const crowns = land.trees.map((t) => s.screenOf(t.i + 0.5, t.j + 0.5, land.base + TREE_SHAPES[t.shape]!.trunk + 1.2));
        const open = s.walkableCells().filter((c) => {
          const p = s.screenOf(c.i + 0.5, c.j + 0.5, topAt(land, c.i, c.j));
          const hit = s.columnAt(p.x, p.y);
          const inland = [-2, -1, 0, 1, 2].every((a) => [-2, -1, 0, 1, 2].every((b) => topAt(land, c.i + a, c.j + b) >= 0));
          return inland && land.surface[at(land, c.i, c.j)] === IslandMat.Grass && hit?.i === c.i && hit.j === c.j
            && crowns.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > s.iso.S * 3.5) && !s.animals.some((a) => Math.abs(a.ci - c.i) + Math.abs(a.cj - c.j) < 3);
        });
        // Of those, one of the three furthest from any tree, the cottage and the lanterns: where a
        // tree has room to grow.
        const clearance = (c: { i: number; j: number }) => Math.min(...land.trees.map((t) => Math.hypot(t.i - c.i, t.j - c.j)), Math.hypot(land.cottage.i + 1 - c.i, land.cottage.j + 1 - c.j), ...land.lanterns.map((l) => Math.hypot(l.i - c.i, l.j - c.j)));
        const c = open.sort((a, b) => clearance(b) - clearance(a))[seed % 3]!;
        const z = topAt(land, c.i, c.j);
        const p = s.screenOf(c.i + 0.5, c.j + 0.5, z);
        const trees = land.trees.length;
        s.splash(p.x, p.y);
        expect({ seed, top: topAt(land, c.i, c.j), pops: s.pops.length, crumbs: s.crumbs.length >= 10 }).toEqual({ seed, top: z - 1, pops: 1, crumbs: true });
        run(s, 8);
        // Back to its height within 8 s either way: a block, or a block with a sapling on it.
        expect({ seed, top: topAt(land, c.i, c.j) }).toEqual({ seed, top: z });
        if (s.saplings.some((t) => t.i === c.i && t.j === c.j)) {
          sprouted++;
          run(s, 40);
          expect({ seed, tree: land.trees.length === trees + 1 && land.trees.some((t) => t.i === c.i && t.j === c.j) }).toEqual({ seed, tree: true });
        } else grewBack++;
      });
    }
    // Over 40 seeds, 25 grew back and 15 sprouted.
    expect({ grewBack: grewBack >= 3, sprouted: sprouted >= 3 }).toEqual({ grewBack: true, sprouted: true });
    await seeded(37, () => {
      const s = new Island();
      s.resize(W, H, 1);
      s.splash(W * 0.5, H * 0.05);
      expect(s.puffs.length).toBe(1);
    });
  });

  test("Brick Town: the people near a resting pointer stop, turn to it and look up at it; those further off walk on", async () => {
    let stopped = 0;
    let looking = 0;
    let faced = 0;
    let walkedOn = 0;
    let far = 0;
    for (let seed = 41; seed <= 50; seed++) {
      await seeded(seed, () => {
        const s = new Town();
        s.resize(W, H, 1);
        run(s, 2);
        const someone = s.people.find((p) => { const q = s.screenOf(p.x, p.y, 0.6); return q.x > 200 && q.x < W - 200 && q.y > 200 && q.y < H - 200; })!;
        const at = s.screenOf(someone.x, someone.y, 1.8);
        s.point(at.x, at.y, true);
        run(s, 0.6);
        const where = new Map(s.people.map((p) => [p, `${p.x.toFixed(3)},${p.y.toFixed(3)}`]));
        run(s, 2);
        for (const p of s.people) {
          const q = s.screenOf(p.x, p.y, 0.6);
          const d = Math.hypot(q.x - at.x, q.y - at.y);
          if (d < LOOK_REACH * 0.8) {
            stopped += Number(where.get(p) === `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
            looking += Number(p.look > 0.9);
            // Facing the point of the ground under the pointer, or nearly.
            const [dx, dy] = [[1, 0], [0, 1], [-1, 0], [0, -1]][p.face]!;
            const g = { x: someone.x, y: someone.y };
            faced += Number(dx! * (g.x - p.x) + dy! * (g.y - p.y) >= -0.5);
          } else if (d > LOOK_REACH * 1.5 && s.time >= p.pause) {
            far++;
            walkedOn += Number(where.get(p) !== `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
          }
        }
      });
    }
    // Over 30 seeds every one of the 71 near it stopped and looked up, all facing it; far off,
    // every one of 712 not pausing walked on.
    expect({ some: stopped >= 10, stopped: stopped === looking, faced: faced === looking, walkedOn: walkedOn / far > 0.9 }).toEqual({ some: true, stopped: true, faced: true, walkedOn: true });
  });

  test("Brick Town: a click drops a brick from above the window; it bounces and snaps onto the stack nearest the click, never into a street; past the cap the brick dropped longest ago is lifted away", async () => {
    await seeded(51, () => {
      const s = new Town();
      s.resize(W, H, 1);
      run(s, 1);
      const clicks = [[W * 0.5, H * 0.45], [W * 0.3, H * 0.7], [W * 0.75, H * 0.3], [W * 0.62, H * 0.62]];
      for (const [x, y] of clicks) {
        s.splash(x!, y!);
        const b = s.bricks[s.bricks.length - 1]!;
        // From above the top of the window.
        expect({ above: s.screenOf(b.x + 0.5, b.y + 0.5, b.z).y < 0, stackable: s.stackable(b.x, b.y) }).toEqual({ above: true, stackable: true });
        // The nearest stack: its top within three bricks' width of the click on the screen (from
        // the middle of a street, the nearest garden is past the pavement).
        const top = s.screenOf(b.x + 0.5, b.y + 0.5, b.rest);
        expect(Math.hypot(top.x - x!, top.y - y!)).toBeLessThan((3 * s.iso.S) / s.dpr);
        let lowest = Infinity;
        let rose = false;
        run(s, 2.5, () => {
          if (b.z <= b.rest + 1e-6) lowest = Math.min(lowest, s.time);
          else if (lowest < Infinity) rose = true;
        });
        expect({ state: b.state, z: b.z, bounced: rose }).toEqual({ state: "set", z: b.rest, bounced: true });
      }
      // Twenty more: no more than the cap stay, the first dropped is gone, and every stack is
      // whole (its bricks one on another from the ground or roof up).
      const first = s.bricks[0]!;
      for (let k = 0; k < 20; k++) {
        s.splash(W * 0.5, H * 0.45);
        run(s, 0.5);
      }
      run(s, 3);
      const kept = s.bricks.filter((b) => b.state !== "leaving");
      expect({ kept: kept.length, first: s.bricks.includes(first) }).toEqual({ kept: BRICKS, first: false });
      for (const b of kept) {
        const under = kept.filter((o) => o.x === b.x && o.y === b.y && o.rest < b.rest).length;
        expect({ rest: b.rest, z: b.z }).toEqual({ rest: s.heightAt(b.x, b.y) + under, z: b.rest });
      }
    });
  });

  test("Block Valley: the camera glides to and fro round its side of the valley over the land, always facing the lake and the village; the pointer turns it gently toward itself, and it turns back when the pointer goes", async () => {
    await seeded(61, () => {
      const s = new Valley();
      s.resize(W, H, 1);
      const eyes: number[][] = [];
      run(s, 60, () => {
        const [x, y, z] = s.camera.eye;
        const ground = s.land.height[idx(Math.floor(x), Math.floor(z))]!;
        if (Math.round(s.time * 60) % 60 === 0) eyes.push([x, y, z, ground]);
      });
      // Over a minute it moves on round the valley, always well above the land under it, inside
      // the ring of peaks, and the lake's middle (the village round it) stays in the middle third
      // of the view across.
      const moved = Math.hypot(eyes[eyes.length - 1]![0]! - eyes[0]![0]!, eyes[eyes.length - 1]![2]! - eyes[0]![2]!);
      expect({ moved: moved > 1.5, above: eyes.every((e) => e[1]! > e[3]! + 8), inside: eyes.every((e) => Math.hypot(e[0]! - SIZE / 2, e[2]! - SIZE / 2) < SIZE * 0.42) }).toEqual({ moved: true, above: true, inside: true });
      for (let k = 0; k < 6; k++) {
        run(s, 60);
        const lake = s.project([SIZE / 2 + 1, 5, SIZE / 2 - 1])!;
        expect({ k, middle: lake.x > W / 3 && lake.x < (2 * W) / 3 && lake.y > H / 2 && lake.y < H }).toEqual({ k, middle: true });
      }
    });
    for (const [px, py, sx, sy] of [[W * 0.95, H * 0.5, 1, 0], [W * 0.05, H * 0.5, -1, 0], [W * 0.5, H * 0.05, 0, 1], [W * 0.5, H * 0.95, 0, -1]] as const) {
      await seeded(62, () => {
        const s = new Valley();
        const still = new Valley();
        s.resize(W, H, 1);
        still.resize(W, H, 1);
        s.point(px, py, true);
        run(s, 3);
        run(still, 3);
        // Turned toward the pointer: its line of sight leans the pointer's way against one with
        // no pointer.
        const f = s.camera.forward;
        const g = still.camera.forward;
        const across = (f[0] - g[0]) * g[2] - (f[2] - g[2]) * g[0];
        const turn = { side: Math.sign(Math.round(-across * 1000)) + 0, up: Math.sign(Math.round((f[1] - g[1]) * 1000)) + 0 };
        expect({ px, py, turn, gentle: Math.acos(Math.min(1, f[0] * g[0] + f[1] * g[1] + f[2] * g[2])) < 0.15 }).toEqual({ px, py, turn: { side: sx, up: sy }, gentle: true });
        s.point(px, py, false);
        run(s, 4);
        expect({ px, back: Math.abs(s.tilt.yaw) + Math.abs(s.tilt.pitch) < 0.01 }).toEqual({ px, back: true });
      });
    }
  });

  test("Block Valley: a click on the land drops a block from the sky onto the column there, which bounces once and settles; a click on the sky puffs out a cloud; past the cap the oldest block sinks away", async () => {
    await seeded(63, () => {
      const s = new Valley();
      s.resize(W, H, 1);
      run(s, 2);
      for (const [x, y] of [[W * 0.5, H * 0.8], [W * 0.25, H * 0.7], [W * 0.8, H * 0.9]] as const) {
        const hit = s.columnAt(x, y)!;
        s.splash(x, y);
        const d = s.drops[s.drops.length - 1]!;
        // On the land, or on the water's surface where it is water.
        const ground = Math.max(s.land.height[idx(hit.i, hit.j)]!, s.land.water[idx(hit.i, hit.j)]!);
        expect({ at: [d.i, d.j], from: d.y - d.rest >= 25, rest: d.rest }).toEqual({ at: [hit.i, hit.j], from: true, rest: ground + s.drops.filter((o) => o !== d && o.i === d.i && o.j === d.j).length });
        // Where it settles shows under the click: its top within a block's size on the screen.
        const top = s.project([d.i + 0.5, d.rest + 1, d.j + 0.5])!;
        const side = s.project([d.i + 1.5, d.rest + 1, d.j + 0.5])!;
        expect(Math.hypot(top.x - x, top.y - y)).toBeLessThan(Math.hypot(side.x - top.x, side.y - top.y) * 2 + 6);
        let rose = false;
        let touched = false;
        run(s, 3, () => { if (d.y <= d.rest + 1e-6) touched = true; else if (touched) rose = true; });
        expect({ state: d.state, y: d.y, bounced: rose }).toEqual({ state: "set", y: d.rest, bounced: true });
      }
      const clouds = s.clouds.length;
      s.splash(W * 0.5, H * 0.02);
      expect({ drops: s.drops.length, puff: s.clouds.length === clouds + 1 && s.clouds.some((c) => c.puff >= 0) }).toEqual({ drops: 3, puff: true });
      for (let k = 0; k < 30; k++) {
        s.splash(W * (0.2 + (k % 7) * 0.1), H * 0.85);
        run(s, 0.3);
      }
      run(s, 4);
      expect(s.drops.filter((d) => d.state !== "leaving").length).toBe(DROPS);
    });
  });

  // ── the clock, the pointer, and nothing named ─────────────────────────────

  /** Where what moves in a scene is: its animals; its cars, people and train; its camera. */
  const placesOf = (name: SceneName, sim: Sim) =>
    name === "island" ? JSON.stringify((sim as Island).animals.map((a) => [a.x.toFixed(3), a.y.toFixed(3)]))
    : name === "bricktown" ? JSON.stringify([(sim as Town).cars.map((c) => c.s.toFixed(3)), (sim as Town).people.map((p) => p.p.toFixed(3)), (sim as Town).train.d.toFixed(3)])
    : JSON.stringify([(sim as Valley).camera.eye.map((v) => v.toFixed(3)), (sim as Valley).birds.map((b) => b.a.toFixed(3))]);
  const pointerOf = (sim: Sim) => (sim as unknown as { pointer: { active: boolean } }).pointer;
  /** Whether the scene has answered a click: a block popped or a puff in the sky, a brick
   *  dropped, a block falling. */
  const answered = (sim: Sim) =>
    sim instanceof Island ? sim.pops.length + sim.puffs.length + sim.crumbs.length > 0
    : sim instanceof Town ? sim.bricks.length > 0
    : (sim as Valley).drops.length > 0 || (sim as Valley).clouds.some((c) => c.puff >= 0);

  test("held, a scene neither steps nor draws; still, it is one settled picture, drawn again where it is when the theme changes; the pointer and clicks stir it only while it runs; and nothing is ever named, whatever the app tells it", async () => {
    const agents: FakeWallpaperOptions = { creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "needs-you" }], tiles: [{ x0: 100, y0: 100, x1: 500, y1: 400, id: "a1" }] };
    for (const name of NAMES) {
      await seeded(71, async () => {
        const s = await scene(name, agents);
        try {
          const was = placesOf(name, s.sim);
          await new Promise((r) => setTimeout(r, 300));
          expect({ name, draws: s.seen.draws, still: placesOf(name, s.sim) === was }).toEqual({ name, draws: 1, still: true });
          // Held, the pointer and a click are no one's: what lives there does not notice them.
          s.host.point(W / 2, H * 0.6);
          s.host.click(W / 2, H * 0.6);
          await s.host.settle();
          expect({ name, noticed: pointerOf(s.sim).active, answered: answered(s.sim) }).toEqual({ name, noticed: false, answered: false });
        } finally {
          s.done();
        }
      });
      await seeded(72, async () => {
        const s = await scene(name, { mode: "still" });
        try {
          const settled = placesOf(name, s.sim);
          expect({ name, draws: s.seen.draws }).toEqual({ name, draws: 1 });
          s.host.send({ type: "look", look: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: placesOf(name, s.sim) !== settled }).toEqual({ name, draws: 2, moved: false });
        } finally {
          s.done();
        }
      });
      await seeded(73, async () => {
        const s = await scene(name, { ...agents, mode: "run" });
        try {
          // Over what lives there and on open ground, and a click at each: it notices, and
          // answers; the app is told of nothing under the pointer, though it sent an agent, a
          // tile and a finished turn.
          s.host.send({ type: "done", id: "a1" });
          const spots = [...bodiesOf(name, s.sim).slice(0, 4), { x: W / 2, y: H * 0.6 }];
          for (const b of spots) {
            s.host.point(b.x, b.y);
            await s.host.settle();
            expect({ name, noticed: pointerOf(s.sim).active }).toEqual({ name, noticed: true });
            expect(s.host.click(b.x, b.y)).toBe(null);
          }
          await s.host.settle();
          expect({ name, answered: answered(s.sim) }).toEqual({ name, answered: true });
          await new Promise((r) => setTimeout(r, 100));
          expect({ name, said: [...new Set(s.host.received.map((m) => m.type))], refused: s.host.refused, hovered: s.host.hovered })
            .toEqual({ name, said: ["ready", "drawn"], refused: [], hovered: null });
        } finally {
          s.done();
        }
      });
    }
  });

  test("over an hour alone, the pointer moving and a click every twenty seconds, every scene stays bounded: crumbs, holes, saplings and trees, puffs and smoke; dropped bricks; dropped blocks and puffs; and what lives there stays where it belongs", async () => {
    await seeded(81, () => {
      const s = new Island();
      s.resize(W, H, 1);
      const animals = s.animals.length;
      let most = { crumbs: 0, regrows: 0, saplings: 0, trees: 0, puffs: 0, smoke: 0 };
      let off = 0;
      run(s, 3600, () => {
        const t = Math.round(s.time * 60);
        if (t % 1200 === 0) s.splash(W * (0.25 + ((t / 1200) % 11) * 0.05), H * (0.3 + ((t / 1200) % 7) * 0.08));
        if (t % 600 === 0) s.point(W * (0.3 + ((t / 600) % 5) * 0.1), H * 0.5, (t / 600) % 3 !== 0);
        if (t % 60 === 0) {
          most = { crumbs: Math.max(most.crumbs, s.crumbs.length), regrows: Math.max(most.regrows, s.regrows.length), saplings: Math.max(most.saplings, s.saplings.length), trees: Math.max(most.trees, s.land.trees.length), puffs: Math.max(most.puffs, s.puffs.length), smoke: Math.max(most.smoke, s.smoke.length) };
          for (const a of s.animals) if (topAt(s.land, a.ci, a.cj) < 0 || s.land.surface[at(s.land, a.ci, a.cj)] === IslandMat.Water) off++;
        }
      });
      expect({ ...most, animals: s.animals.length, off }).toEqual({
        crumbs: Math.min(most.crumbs, CAPS.crumbs), regrows: Math.min(most.regrows, CAPS.regrows), saplings: Math.min(most.saplings, CAPS.saplings),
        trees: Math.min(most.trees, s.firstTrees + CAPS.extraTrees), puffs: Math.min(most.puffs, CAPS.puffs), smoke: Math.min(most.smoke, CAPS.smoke), animals, off: 0,
      });
    });
    await seeded(82, () => {
      const s = new Town();
      s.resize(W, H, 1);
      const [cars, people] = [s.cars.length, s.people.length];
      let most = 0;
      let outside = 0;
      run(s, 3600, () => {
        const t = Math.round(s.time * 60);
        if (t % 1200 === 0) s.splash(W * (0.2 + ((t / 1200) % 13) * 0.05), H * (0.2 + ((t / 1200) % 9) * 0.07));
        if (t % 600 === 0) s.point(W * (0.3 + ((t / 600) % 5) * 0.1), H * 0.5, (t / 600) % 3 !== 0);
        if (t % 60 === 0) {
          most = Math.max(most, s.bricks.length);
          for (const c of s.cars) { const span = s.span(c.axis, c.line)!; if (c.s < span[0] - 4 || c.s > span[1] + 4) outside++; }
        }
      });
      // A brick or two lifting away beside the ones kept.
      expect({ most: most <= BRICKS + 2, cars: s.cars.length, people: s.people.length, outside }).toEqual({ most: true, cars, people, outside: 0 });
      // The cars kept moving: none stuck at a crossing for good (each on the move much of the
      // next twenty seconds; over 9 seeds of ten minutes the least was 52%).
      const moving = new Map(s.cars.map((c) => [c, 0]));
      run(s, 20, () => { for (const c of s.cars) if (!c.waiting) moving.set(c, moving.get(c)! + 1); });
      expect([...moving.values()].filter((n) => n < 20 * 60 * 0.3)).toEqual([]);
    });
    await seeded(83, () => {
      const s = new Valley();
      s.resize(W, H, 1);
      const [clouds, birds] = [s.clouds.length, s.birds.length];
      let most = { drops: 0, puffs: 0 };
      run(s, 3600, () => {
        const t = Math.round(s.time * 60);
        if (t % 1200 === 0) s.splash(W * (0.2 + ((t / 1200) % 13) * 0.05), H * (0.05 + ((t / 1200) % 9) * 0.1));
        if (t % 600 === 0) s.point(W * (0.3 + ((t / 600) % 5) * 0.1), H * 0.5, (t / 600) % 3 !== 0);
        if (t % 60 === 0) most = { drops: Math.max(most.drops, s.drops.length), puffs: Math.max(most.puffs, s.clouds.filter((c) => c.puff >= 0).length) };
      });
      expect({ drops: most.drops <= DROPS + 2, puffs: most.puffs <= PUFFS, clouds: s.clouds.filter((c) => c.puff < 0).length, birds: s.birds.length }).toEqual({ drops: true, puffs: true, clouds, birds });
    });
  });
});

// ── its colours, against the app's presets ──────────────────────────────────

const { PRESETS } = await core("settings-schema.ts");
/** A preset's colour (CSS), as the scenes' colours are: sRGB 0 to 255. */
const cssRgb = (s: string): Rgb => parseColor(s)!.rgb.map((v) => Math.round(v * 255)) as unknown as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as [number, number, number], b.map((v) => v / 255) as [number, number, number]);
/** `top` at `alpha` over `under`, as the page composites it; and added to it, as light. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
const add = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => Math.min(255, under[i]! + v * alpha)) as unknown as Rgb;
/** The Layers panel over a live wallpaper with See-through: its colour at a sixth (the app's
 *  SEE_THROUGH opacity, 0.5, at a third). */
const TINT = 0.5 / 3;
/** Every face of a block, and its texels at their darkest and lightest. */
const faces = (s: Shades): Rgb[] => [s.top, s.left, s.right].flatMap((c) => {
  const rgb = rgbOf(c);
  return [rgb, over([0, 0, 0], SPECK_DARK, rgb), over([255, 255, 255], SPECK_LIGHT, rgb)];
});

/** What lies large under a panel in each scene, by its palette: the sky (each stop, the sun's or
 *  the moon's glow at its strongest), every face of the ground and of what stands on it, and the
 *  clouds; the town's streets and walls and the lamps' light on them; the valley's blocks and the
 *  haze they fade into. Small things (the animals, the cars and people, a lit window, a lantern,
 *  the flowers, the stars, a bird) are left out. */
const GROUNDS: Record<SceneName, (dark: boolean) => { where: string; colour: Rgb }[]> = {
  island: (dark) => {
    const p = ISLAND_PALETTE[dark ? "dark" : "light"];
    const sky = p.sky.map(rgbOf);
    return [
      ...sky.map((c, i) => ({ where: `sky ${i}`, colour: c })),
      { where: "the orb's glow", colour: over(rgbOf(p.orb.glow), p.orb.alpha, sky[0]!) },
      ...([["grass", p.grass], ["dirt", p.dirt], ["stone", p.stone], ["sand", p.sand], ["water", p.water], ["wood", p.wood], ["leaves", p.leaves], ["plank", p.plank], ["roof", p.roof], ["cloud", p.cloud]] as const)
        .flatMap(([where, s]) => faces(s).map((colour) => ({ where, colour }))),
    ];
  },
  bricktown: (dark) => {
    const p = TOWN_PALETTE[dark ? "dark" : "light"];
    const plate = rgbOf(p.plate.top);
    return [
      ...([["plate", p.plate], ["road", p.road], ["walk", p.walk], ["paving", p.paving], ["path", p.path], ["water", p.water], ["gravel", p.gravel], ["leaves", p.leaves]] as const).flatMap(([where, s]) => faces(s).map((colour) => ({ where, colour }))),
      ...p.walls.flatMap((s, k) => faces(s).map((colour) => ({ where: `wall ${k}`, colour }))),
      ...p.roofs.flatMap((s, k) => faces(s).map((colour) => ({ where: `roof ${k}`, colour }))),
      // A lamp's pool of light at its brightest, on the plate and on the pavement.
      ...(p.pool ? [plate, rgbOf(p.walk.top)].map((c) => ({ where: "a lamp's pool", colour: add(rgbOf(p.pool!.colour), p.pool!.alpha * 0.9, c) })) : []),
    ];
  },
  valley: (dark) => {
    const p = VALLEY_PALETTE[dark ? "dark" : "light"];
    const sky = [p.zenith, p.horizon, p.fog].map((c: Oklch) => rgbOf(c));
    return [
      ...sky.map((c, i) => ({ where: ["zenith", "horizon", "haze"][i]!, colour: c })),
      { where: "the sun's glow", colour: over(rgbOf(p.sun.glow), p.sun.alpha, sky[1]!) },
      ...p.mats.slice(0, 10).flatMap((s, k) => faces(s).map((colour) => ({ where: `block ${k}`, colour }))),
    ];
  },
};

test("each scene, in its own colours, keeps the frosted panels' text readable over all that lies large in it, dark and light: names at 7:1, details at 4.5:1", () => {
  for (const name of NAMES) {
    for (const [mode, preset] of [["dark", "signal"], ["light", "clean-light"]] as const) {
      const { bg2, fg, fg2 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
      for (const { where, colour } of GROUNDS[name](mode === "dark")) {
        const panel = over(cssRgb(bg2!), TINT, colour);
        const at = `${name} ${mode}, ${where}`;
        expect({ at, names: contrast(cssRgb(fg!), panel) >= 7, details: contrast(cssRgb(fg2!), panel) >= 4.5 }).toEqual({ at, names: true, details: true });
      }
    }
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

const WALLPAPERS = ["island", "bricktown", "valley"];
const NAMED: Record<string, string> = { island: "Block Island", bricktown: "Brick Town", valley: "Block Valley" };

test("the app's package reader takes Blocks as @dip497/blocks, holding the three live wallpapers by their names, and offers Block Island on install; none asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "blocks" });
  expect({ id: pkg.id, name: pkg.manifest.name, version: pkg.manifest.version, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/blocks", name: "Blocks", version: "1.0.0", members: WALLPAPERS.map((w) => ["wallpaper", `@dip497/blocks/${w}`, NAMED[w]]), startup: "@dip497/blocks/island" });
  for (const w of WALLPAPERS) {
    const m = JSON.parse(readFileSync(path.join(PKG, "wallpapers", w, "hivemind-wallpaper.json"), "utf8"));
    expect({ w, colour: m.colour, protocol: m.protocol, entry: m.entry, preview: m.preview }).toEqual({ w, colour: undefined, protocol: 1, entry: "dist/main.js", preview: "preview.webp" });
  }
});

test("HiveHub lists Blocks as needing Hivemind 2026.10.8, each wallpaper sandboxed and asking for nothing, within its limits, and installs each wallpaper's folder (its build and its picture) without the sources or the harness", async () => {
  const { checkPluginFolder } = await import(path.join(APP, "packages/hive-hub/src/plugin-checks.ts"));
  const { packageFiles, checkPackageManifest } = await import(path.join(APP, "packages/hive-hub/src/package-format.ts"));
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(at);
      else files.push({ path: at, bytes: new Uint8Array(readFileSync(path.join(PKG, at))) });
    }
  };
  walk("");
  const c = await checkPluginFolder(files);
  expect("problem" in c ? c.problem : null).toBe(null);
  expect(c.plugin.minAppVersion).toBe("2026.10.8");
  expect(c.plugin.members.map((m: { kind: string; id: string; runs: string; permissions: string[] }) => [m.kind, m.id, m.runs, m.permissions]))
    .toEqual(WALLPAPERS.map((w) => ["wallpaper", `@dip497/blocks/${w}`, "sandboxed", []]));
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const w of WALLPAPERS) {
    for (const f of ["dist/main.js", "hivemind-wallpaper.json", "preview.webp"]) expect(installs).toContain(`wallpapers/${w}/${f}`);
    // The picker's picture: 960 by 600 (a WebP's size is in its header), under 512 KB.
    const webp = readFileSync(path.join(PKG, "wallpapers", w, "preview.webp"));
    const vp8x = webp.toString("ascii", 12, 16) === "VP8X";
    const size = vp8x ? [1 + webp.readUIntLE(24, 3), 1 + webp.readUIntLE(27, 3)] : [webp.readUInt16LE(26) & 0x3fff, webp.readUInt16LE(28) & 0x3fff];
    expect({ w, size, small: statSync(path.join(PKG, "wallpapers", w, "preview.webp")).size < 512 * 1024 }).toEqual({ w, size: [960, 600], small: true });
  }
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

describe("Blocks, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveScenes } = await import("../packages/blocks/harness/serve");
    server = await serveScenes();
    // WebGL in a headless browser draws on SwiftShader, in software.
    browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function openFrame(scene: string, mode: "run" | "hold", dpr: number): Promise<{ page: Page; frame: Frame }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ scene, mode }) => window.start({
      scene, mode, look: { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "monospace" },
      creatures: [{ id: "a1", agent: "claude", kind: 0.3, size: 1, state: "needs-you" }], tiles: [{ x0: 200, y0: 150, x1: 700, y1: 500, id: "a1" }],
    }), { scene, mode });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 15_000 });
    return { page, frame: page.frames().find((f) => f.url().includes("/wp/"))! };
  }
  /** What the page shows, as a number: a picture of it, as the person would see it. */
  const shown = async (page: Page) => Bun.hash(await page.screenshot());
  /** How many colours the scene's canvas holds, read in the frame's next animation frame (right
   *  after the scene draws, before a WebGL canvas is shown and cleared), through a 2D copy. */
  const colours = (frame: Frame) => frame.evaluate(() => new Promise<number>((done) => requestAnimationFrame(() => {
    const c = document.querySelector("canvas")!;
    const copy = document.createElement("canvas");
    copy.width = c.width;
    copy.height = c.height;
    const g = copy.getContext("2d")!;
    g.drawImage(c, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4 * 31) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    done(seen.size);
  })));

  for (const scene of WALLPAPERS) {
    test(`${NAMED[scene]}: in its sandboxed frame it says it speaks protocol 1 and that its first frame is up, and nothing else, though the app names an agent and a tile; draws a canvas the viewport's size times its pixel ratio; moves while it runs and not while held`, async () => {
      const { page, frame } = await openFrame(scene, "run", 2);
      try {
        await new Promise((r) => setTimeout(r, 800));
        await page.evaluate(() => { window.host.point(640, 520); window.host.click(640, 520); });
        await new Promise((r) => setTimeout(r, 300));
        const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused, hovered: window.host.hovered }));
        expect(said).toEqual({ received: ["ready", "drawn"], refused: [], hovered: null });
        const canvas = await frame.evaluate(() => [...document.querySelectorAll("canvas")].map((c) => [c.width, c.height, c.clientWidth, c.clientHeight]));
        expect(canvas).toEqual([[2560, 1600, 1280, 800]]);
        // A picture of many colours (a blank canvas has one), changing while it runs.
        expect(await colours(frame)).toBeGreaterThan(50);
        const a = await shown(page);
        await new Promise((r) => setTimeout(r, 700));
        expect(await shown(page)).not.toBe(a);
        await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
        await new Promise((r) => setTimeout(r, 300));
        const held = await shown(page);
        await new Promise((r) => setTimeout(r, 1000));
        expect(await shown(page)).toBe(held);
      } finally {
        await page.close();
      }
    }, 90_000);
  }

  test("Block Valley draws with WebGL2 while it has it, and when its context is lost draws the valley as a still picture on a canvas of its own, at the pixel ratio, still saying nothing else", async () => {
    const { page, frame } = await openFrame("valley", "run", 1);
    try {
      await new Promise((r) => setTimeout(r, 500));
      expect(await frame.evaluate(() => !!document.querySelector("canvas")!.getContext("webgl2"))).toBe(true);
      await frame.evaluate(() => document.querySelector("canvas")!.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext());
      await new Promise((r) => setTimeout(r, 500));
      const after = await frame.evaluate(() => {
        const cs = [...document.querySelectorAll("canvas")];
        const c = cs[0]!;
        const g = c.getContext("2d");
        if (!g) return { canvases: cs.length, twoD: false, colours: 0, size: [c.width, c.height] };
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const seen = new Set<number>();
        for (let i = 0; i < d.length; i += 4 * 53) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
        return { canvases: cs.length, twoD: true, colours: seen.size, size: [c.width, c.height] };
      });
      // One canvas, a 2D one, holding a picture of many colours (a blank one has one).
      expect({ ...after, colours: after.colours > 50 }).toEqual({ canvases: 1, twoD: true, colours: true, size: [1280, 800] });
      const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused }));
      expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
    } finally {
      await page.close();
    }
  }, 90_000);
});
