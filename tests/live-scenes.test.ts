// Live scenes, the package of four live wallpapers (Shoal, Koi Pond, Jellyfish, Fireflies): each
// scene run through the SDK's fakeWallpaperHost as the app connects it (runScene), with the
// randomness seeded and no canvas (its drawing is a stand-in that counts frames); what it lays out
// along the bottom; its colours measured against the app's own presets; the package read by the
// app's package reader and HiveHub's check; and its build loaded in Chromium the way the app serves
// it. Each bar sits clear of what 20 or more seeds measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import { runScene, type Sim } from "../packages/live-scenes/src/scene";
import { prng } from "../packages/live-scenes/src/math";
import { rgbOf, type Rgb } from "../packages/live-scenes/src/colour";
import type { WaterLook } from "../packages/live-scenes/src/backdrop";
import { shoalWorld } from "../packages/live-scenes/src/shoal/scene";
import { SHARK_KINDS } from "../packages/live-scenes/src/shoal/shapes";
import { Seabed } from "../packages/live-scenes/src/shoal/seabed";
import { SHOAL_PALETTE } from "../packages/live-scenes/src/shoal/palette";
import { koiWorld } from "../packages/live-scenes/src/koi/scene";
import { KOI_KINDS, KOI_SHAPES } from "../packages/live-scenes/src/koi/shapes";
import { bankOf, padCell, PadPart, Pond, type Pad } from "../packages/live-scenes/src/koi/pond";
import { KOI_PALETTE } from "../packages/live-scenes/src/koi/palette";
import { bellOf, Swarm } from "../packages/live-scenes/src/jellyfish/swarm";
import { JELLY_KINDS, JELLY_SHAPES } from "../packages/live-scenes/src/jellyfish/kinds";
import { JELLY_PALETTE } from "../packages/live-scenes/src/jellyfish/palette";
import { Meadow, WAVE_REACH, WAVE_SPEED } from "../packages/live-scenes/src/fireflies/meadow";
import { FIREFLY_KINDS } from "../packages/live-scenes/src/fireflies/kinds";
import { meadowOf } from "../packages/live-scenes/src/fireflies/grass";
import { FIREFLY_PALETTE } from "../packages/live-scenes/src/fireflies/palette";
import type { World } from "../packages/live-scenes/src/world";

const PKG = path.join(ROOT, "packages/live-scenes");
// A minute or two of each scene, on a few seeds, takes a few seconds.
setDefaultTimeout(60_000);
const W = 1440;
const H = 900;
const STEP = 1 / 60;

/** Run `fn` with Math.random seeded: the wander, the habits chosen, the stocking. */
async function seeded<T>(seed: number, fn: () => Promise<T> | T): Promise<T> {
  const real = Math.random;
  Math.random = prng(seed);
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

/** A body of a scene, where a glance finds it: a swimmer's snout, a jelly's bell, a firefly. */
interface Body { kind: string; x: number; y: number }
const SCENES = {
  shoal: { make: shoalWorld, kinds: SHARK_KINDS as readonly string[], bodies: (s: World): Body[] => s.swimmers.map((b) => ({ kind: b.kind, x: b.nodes[0]!, y: b.nodes[1]! })) },
  koi: { make: koiWorld, kinds: KOI_KINDS as readonly string[], bodies: (s: World): Body[] => s.swimmers.map((b) => ({ kind: b.kind, x: b.nodes[0]!, y: b.nodes[1]! })) },
  jellyfish: { make: () => new Swarm(), kinds: JELLY_KINDS as readonly string[], bodies: (s: Swarm): Body[] => s.jellies.map((j) => ({ kind: j.kind, x: j.x, y: j.y - j.shape.h * j.length * 0.5 })) },
  fireflies: { make: () => new Meadow(), kinds: FIREFLY_KINDS as readonly string[], bodies: (s: Meadow): Body[] => s.flies.map((f) => ({ kind: f.kind, x: f.x, y: f.y })) },
} as const;
type SceneName = keyof typeof SCENES;
const NAMES = Object.keys(SCENES) as SceneName[];
const bodiesOf = (name: SceneName, sim: Sim) => (SCENES[name].bodies as (s: Sim) => Body[])(sim);

/** A scene connected to a fake host as the app would connect it, drawn by a stand-in that counts
 *  its frames; the test steps it by hand while the mode is not `run`. */
async function open<S extends Sim>(sim: S, opts: FakeWallpaperOptions) {
  const host = fakeWallpaperHost({ viewport: { w: W, h: H, dpr: 1 }, ...opts });
  const wp = await host.connect();
  const seen = { draws: 0 };
  const stop = runScene(wp, sim, { resize() {}, setLook() {}, draw() { seen.draws++; } });
  await host.settle();
  return { host, sim, seen, done: () => { stop(); host.close(); } };
}
const scene = (name: SceneName, opts: FakeWallpaperOptions = {}) => open(SCENES[name].make() as Sim, { mode: "hold", ...opts });

// ── what lives there ────────────────────────────────────────────────────────

describe("Live scenes", () => {
  test("each scene is full of life from its first frame: stocked for the window's size, more on a bigger one, every kind there, spread over all of it", async () => {
    for (const name of NAMES) {
      const counts: number[] = [];
      for (const [w, h] of [[1024, 640], [1440, 900], [2560, 1440]] as const) {
        for (const seed of [1, 2, 3]) {
          await seeded(seed, async () => {
            // Held: its first frame is drawn without a step.
            const s = await scene(name, { viewport: { w, h, dpr: 1 } });
            try {
              const bodies = bodiesOf(name, s.sim);
              const where = `${name} ${w}×${h} seed ${seed}`;
              const xs = bodies.map((b) => b.x);
              const ys = bodies.map((b) => b.y);
              const quadrants = new Set(bodies.map((b) => `${b.x < w / 2}${b.y < h / 2}`)).size;
              // Over 20 seeds: every kind, every time; three or four quadrants; across 70% to 95% of
              // the width and 45% to 85% of the height.
              expect({ where, draws: s.seen.draws, kinds: SCENES[name].kinds.every((k) => bodies.some((b) => b.kind === k)), inside: bodies.every((b) => b.x >= 0 && b.x <= w && b.y >= 0 && b.y <= h) })
                .toEqual({ where, draws: 1, kinds: true, inside: true });
              expect({ where, quadrants: quadrants >= 3, wide: Math.max(...xs) - Math.min(...xs) > w * 0.6, tall: Math.max(...ys) - Math.min(...ys) > h * 0.35 })
                .toEqual({ where, quadrants: true, wide: true, tall: true });
              if (seed === 1) counts.push(bodies.length);
            } finally {
              s.done();
            }
          });
        }
      }
      // Eight at least (a laptop's), more on a big screen.
      expect({ name, fewest: Math.min(...counts) >= SCENES[name].kinds.length, more: counts[2]! > counts[0]! }).toEqual({ name, fewest: true, more: true });
    }
  });

  test("the small life is there from the first frame too: every species of fish and fry, marine snow from top to bottom, small fireflies over the meadow", async () => {
    await seeded(4, async () => {
      for (const name of ["shoal", "koi"] as const) {
        const s = await scene(name);
        try {
          const species = new Set((s.sim as World).fish.filter((f) => f.alive).map((f) => f.species));
          expect({ name, species: species.size }).toEqual({ name, species: name === "shoal" ? 5 : 2 });
        } finally {
          s.done();
        }
      }
      const jelly = await scene("jellyfish");
      const snow = (jelly.sim as Swarm).snow;
      expect([0, 1, 2].map((third) => snow.filter((m) => Math.floor((m.y / H) * 3) === third).length > snow.length * 0.2)).toEqual([true, true, true]);
      jelly.done();
      const meadow = await scene("fireflies");
      const motes = (meadow.sim as Meadow).motes;
      expect({ many: motes.length >= 24, wide: Math.max(...motes.map((m) => m.x)) - Math.min(...motes.map((m) => m.x)) > W * 0.8 }).toEqual({ many: true, wide: true });
      meadow.done();
    });
  });

  test("over a minute the creatures keep to the window: a shark's snout dips out now and then, the rest hardly ever", async () => {
    // Over 20 seeds: Shoal's snouts 93% to 100% in the window, Koi Pond's 99%, the jellies' and fireflies' 100%.
    const bars: Record<SceneName, number> = { shoal: 0.9, koi: 0.97, jellyfish: 0.99, fireflies: 0.99 };
    for (const name of NAMES) {
      for (const seed of [5, 6]) {
        await seeded(seed, async () => {
          const s = await scene(name);
          try {
            let inside = 0;
            let all = 0;
            let i = 0;
            run(s.sim, 60, () => {
              if (i++ % 30) return;
              for (const b of bodiesOf(name, s.sim)) {
                all++;
                if (b.x >= 0 && b.x <= W && b.y >= 0 && b.y <= H) inside++;
              }
            });
            expect({ name, seed, inside: inside / all > bars[name] }).toEqual({ name, seed, inside: true });
          } finally {
            s.done();
          }
        });
      }
    }
  });

  test("swimmers turn in curves their bodies can follow: never folded back into a U, after a fish or not", async () => {
    /** How far a body turns from snout to tail, in radians: π is folded back on itself. */
    const bend = (nd: Float32Array) => {
      let net = 0;
      let prev = Math.atan2(nd[1]! - nd[3]!, nd[0]! - nd[2]!);
      for (let j = 1; j < nd.length / 2 - 1; j++) {
        const a = Math.atan2(nd[j * 2 + 1]! - nd[j * 2 + 3]!, nd[j * 2]! - nd[j * 2 + 2]!);
        net += Math.atan2(Math.sin(a - prev), Math.cos(a - prev));
        prev = a;
      }
      return Math.abs(net);
    };
    for (const name of ["shoal", "koi"] as const) {
      for (const seed of [7, 8, 9]) {
        await seeded(seed, async () => {
          const s = await scene(name);
          try {
            let most = 0;
            let i = 0;
            run(s.sim, 40, () => {
              if (i++ % 15 === 0) for (const b of (s.sim as World).swimmers) most = Math.max(most, bend(b.nodes));
            });
            // Over 12 seeds of a minute the most was 2.33 radians; with a tight turn after a fish,
            // 2.88 (a U), 14% of the time it chased.
            expect({ name, seed, most: Number(most.toFixed(2)), folded: most > 2.6 }).toEqual({ name, seed, most: Number(most.toFixed(2)), folded: false });
          } finally {
            s.done();
          }
        });
      }
    }
  });

  // ── the pointer and clicks ────────────────────────────────────────────────

  // What lives there answers the pointer and clicks the sim is handed (runScene hands them over
  // only while the scene runs: the frame's test, below); each test steps the sim by hand.

  test("Shoal: fish scatter from a pointer resting among them, a curious shark comes up beside it, and a click rings the water and bursts the fish near it", async () => {
    let came = 0;
    let comeAnyway = 0;
    const stayed: number[] = [];
    for (let seed = 11; seed <= 20; seed++) {
      for (const resting of [true, false]) {
        await seeded(seed, async () => {
          const s = await scene("shoal");
          const world = s.sim as World;
          try {
            run(world, 3);
            // The densest school's middle.
            let at = { x: W / 2, y: H / 2, n: -1 };
            for (const f of world.fish) {
              if (!f.alive) continue;
              const n = world.fish.filter((o) => o.alive && Math.hypot(o.x - f.x, o.y - f.y) < 80).length;
              if (n > at.n) at = { x: f.x, y: f.y, n };
            }
            const near = () => world.fish.filter((f) => f.alive && Math.hypot(f.x - at.x, f.y - at.y) < 80).length;
            const before = near();
            world.point(at.x, at.y, resting);
            run(world, 1.5);
            if (resting) stayed.push(near() / before);
            // A shark come up beside it, to look: only a curious one comes up that near.
            world.point(W / 2, H * 0.4, resting);
            let up = false;
            run(world, 12, () => { up ||= world.swimmers.some((b) => b.depth > 0.95 && Math.hypot(b.nodes[0]! - W / 2, b.nodes[1]! - H * 0.4) < b.length); });
            if (resting) came += Number(up);
            else comeAnyway += Number(up);
          } finally {
            s.done();
          }
        });
      }
    }
    // Over 30 seeds, of the fish within 80 px of a pointer resting among them, 0% to 44% stayed
    // 1.5 s later, 8% on average; without it most of a school stays.
    expect({ each: Math.max(...stayed) < 0.6, mean: stayed.reduce((a, b) => a + b, 0) / stayed.length < 0.18 }).toEqual({ each: true, mean: true });
    // Over 40 seeds a shark came up beside it within 12 s 31 times, and never without it.
    expect({ came: came >= 5, comeAnyway }).toEqual({ came: true, comeAnyway: 0 });

    await seeded(21, async () => {
      const s = await scene("shoal");
      const world = s.sim as World;
      try {
        run(world, 2);
        // A click by a school.
        const school = world.fish.find((f) => f.alive && f.x > W * 0.2 && f.x < W * 0.8 && f.y > H * 0.2 && f.y < H * 0.8)!;
        const [x, y] = [school.x + 20, school.y + 10];
        const near = world.fish.filter((f) => f.alive && Math.hypot(f.x - x, f.y - y) < 150 && Math.hypot(f.x - x, f.y - y) > 5);
        world.events.length = 0;
        world.splash(x, y);
        expect(world.events.some((e) => e.kind === "splash" && e.x === x && e.y === y)).toBe(true);
        expect(near.length).toBeGreaterThan(0);
        expect(near.filter((f) => !(f.alarm === 1 && (f.x - x) * f.vx + (f.y - y) * f.vy > 0))).toEqual([]);
      } finally {
        s.done();
      }
    });
  });

  test("Koi Pond: koi drift over to a pointer resting on the pond, and a click drops pellets the nearest koi race to eat", async () => {
    const near: number[] = [];
    const without: number[] = [];
    for (let seed = 31; seed <= 42; seed++) {
      for (const resting of [true, false]) {
        await seeded(seed, async () => {
          const s = await scene("koi");
          const world = s.sim as World;
          try {
            run(world, 3);
            world.point(W * 0.45, H * 0.45, resting);
            run(world, 8);
            (resting ? near : without).push(world.swimmers.filter((k) => Math.hypot(k.nodes[0]! - W * 0.45, k.nodes[1]! - H * 0.45) < k.length * 1.5).length);
          } finally {
            s.done();
          }
        });
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Over 20 seeds, within a length and a half of a pointer resting 8 s: 1 to 4 koi (3.05 on
    // average); without one, 0 to 2 (0.7).
    expect({ each: Math.min(...near) >= 1, near: mean(near) > 2, more: mean(near) - mean(without) > 1.2 }).toEqual({ each: true, near: true, more: true });

    let cameAnyway = 0;
    for (let seed = 43; seed <= 50; seed++) {
      for (const fed of [true, false]) {
        await seeded(seed, async () => {
          const s = await scene("koi");
          const world = s.sim as World;
          try {
            run(world, 2);
            if (fed) world.splash(W / 2, H / 2);
            const pellets = world.food.length;
            // The first koi to the spot: over 40 seeds, 1.5 s to 6.9 s after the pellets landed;
            // with none dropped, no koi there within 10 s in most.
            let came = -1;
            for (let i = 0; i < 9 / STEP && came < 0; i++) {
              world.step(STEP);
              if (world.swimmers.some((k) => Math.hypot(k.nodes[0]! - W / 2, k.nodes[1]! - H / 2) < 60)) came = i * STEP;
            }
            if (!fed) {
              cameAnyway += Number(came >= 0);
              return;
            }
            let secs = 9;
            while (world.food.length && secs < 30) {
              run(world, 0.5);
              secs += 0.5;
            }
            // Over 50 seeds, all eaten within 1.5 s to 15.5 s.
            expect({ seed, pellets: pellets >= 3 && pellets <= 5, came: came >= 0, eaten: secs < 25 }).toEqual({ seed, pellets: true, came: true, eaten: true });
          } finally {
            s.done();
          }
        });
      }
    }
    expect(cameAnyway).toBeLessThan(4);
  });

  test("Jellyfish: the pointer pushes the marine snow aside, and a click sends a pulse out that the jellies near it flash at and jet away from", async () => {
    // The snow within 50 px of the pointer, before and 2 s after, over every seed: a few specks
    // each time.
    const kept = { resting: [0, 0], without: [0, 0] };
    for (let seed = 51; seed <= 60; seed++) {
      for (const resting of [true, false]) {
        await seeded(seed, async () => {
          const s = await scene("jellyfish");
          const swarm = s.sim as Swarm;
          try {
            run(swarm, 2);
            const [px, py] = [W * 0.3, H * 0.6];
            const near = () => swarm.snow.filter((m) => Math.hypot(m.x - px, m.y - py) < 50).length;
            const count = kept[resting ? "resting" : "without"];
            count[0] += near();
            swarm.point(px, py, resting);
            run(swarm, 2);
            count[1] += near();
          } finally {
            s.done();
          }
        });
      }
    }
    // Over 40 seeds, a sixth to a fifth of the snow stayed by the pointer; all of it without.
    expect({ resting: kept.resting[1]! / kept.resting[0]! < 0.4, without: kept.without[1]! / kept.without[0]! > 0.7 }).toEqual({ resting: true, without: true });
    const gains: number[] = [];
    for (let seed = 57; seed <= 66; seed++) {
      await seeded(seed, async () => {
        const s = await scene("jellyfish");
        const swarm = s.sim as Swarm;
        try {
          run(swarm, 3);
          const bell = (j: (typeof swarm.jellies)[number]) => ({ x: j.x, y: j.y - j.shape.h * j.length * 0.5 });
          const first = swarm.jellies.reduce((a, b) => (Math.hypot(bell(a).x - W / 2, bell(a).y - H / 2) < Math.hypot(bell(b).x - W / 2, bell(b).y - H / 2) ? a : b));
          const [x, y] = [bell(first).x + 90, bell(first).y + 60];
          // By jelly: the list is kept in order of nearness, which changes as they swim.
          const before = new Map(swarm.jellies.map((j) => [j, Math.hypot(bell(j).x - x, bell(j).y - y)]));
          swarm.splash(x, y);
          const flashed = new Map(swarm.jellies.map((j) => [j, 0]));
          run(swarm, 2.5, () => { for (const j of swarm.jellies) flashed.set(j, Math.max(flashed.get(j)!, j.glow)); });
          for (const [j, d] of before) {
            if (d < 200) {
              gains.push(Math.hypot(bell(j).x - x, bell(j).y - y) - d);
              expect({ seed, flashed: flashed.get(j)! > 0.3 }).toEqual({ seed, flashed: true });
            }
            if (d > 420) expect({ seed, far: flashed.get(j) }).toEqual({ seed, far: 0 });
          }
        } finally {
          s.done();
        }
      });
    }
    // Over 30 seeds, each jelly within 200 px of a click was 24 px to 634 px further from it 2.5 s
    // later, three in four more than 100 px.
    expect({ all: gains.every((g) => g > 10), most: gains.filter((g) => g > 80).length / gains.length > 0.6 }).toEqual({ all: true, most: true });
  });

  test("Fireflies: they drift to a pointer resting in the night and circle it, and a click is a burst of light the fireflies near it flash at and scatter from, the small ones answering as it reaches them", async () => {
    const near: number[] = [];
    const without: number[] = [];
    for (let seed = 71; seed <= 80; seed++) {
      for (const resting of [true, false]) {
        await seeded(seed, async () => {
          const s = await scene("fireflies");
          const meadow = s.sim as Meadow;
          try {
            run(meadow, 3);
            const [px, py] = [W / 2, H * 0.45];
            meadow.point(px, py, resting);
            run(meadow, 6);
            const by = meadow.flies.filter((f) => Math.hypot(f.x - px, f.y - py) < 100);
            (resting ? near : without).push(by.length);
            if (!resting || !by.length) return;
            // Round it: the way from the pointer to one of them turns as it circles.
            const f = by[0]!;
            let a0 = Math.atan2(f.y - py, f.x - px);
            let turned = 0;
            run(meadow, 4, () => {
              const a = Math.atan2(f.y - py, f.x - px);
              turned += Math.atan2(Math.sin(a - a0), Math.cos(a - a0));
              a0 = a;
            });
            // Over 20 seeds, 0.86 to 1.64 radians round it in 4 s.
            expect({ seed, circles: Math.abs(turned) > 0.5 }).toEqual({ seed, circles: true });
          } finally {
            s.done();
          }
        });
      }
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Over 40 seeds, within 100 px of a pointer resting 6 s: 1 to 4 (2.6 on average); without
    // one, 0 to 2 (0.65).
    expect({ most: near.filter((n) => n >= 1).length >= 8, near: mean(near) > 1.8, without: mean(without) < 1.2 }).toEqual({ most: true, near: true, without: true });

    await seeded(81, async () => {
      const s = await scene("fireflies");
      const meadow = s.sim as Meadow;
      try {
        run(meadow, 3);
        const [x, y] = [W / 2, H * 0.45];
        const before = meadow.flies.map((f) => Math.hypot(f.x - x, f.y - y));
        const motes = new Map(meadow.motes.map((m) => [m, Math.hypot(m.x - x, m.y - y)]));
        const start = meadow.time;
        meadow.splash(x, y);
        const flashed = meadow.flies.map(() => 0);
        const answered = new Map<(typeof meadow.motes)[number], number>();
        run(meadow, 2, () => {
          meadow.flies.forEach((f, k) => { flashed[k] = Math.max(flashed[k]!, f.glow); });
          for (const m of meadow.motes) if (m.answer > 0.95 && !answered.has(m)) answered.set(m, meadow.time - start);
        });
        meadow.flies.forEach((f, k) => {
          const d = before[k]!;
          if (d < WAVE_REACH * 0.8) expect({ d, flashed: flashed[k]! > 0.4, away: Math.hypot(f.x - x, f.y - y) > d }).toEqual({ d, flashed: true, away: true });
          if (d > WAVE_REACH * 1.3) expect({ d, flashed: flashed[k] }).toEqual({ d, flashed: 0 });
        });
        expect(before.some((d) => d < WAVE_REACH * 0.8)).toBe(true);
        // Each small one within reach answers as the burst reaches it, nearer ones first.
        for (const [m, d] of motes) {
          if (d > WAVE_REACH - 10) continue;
          expect({ d: Math.round(d), late: Math.abs((answered.get(m) ?? 99) - d / WAVE_SPEED) < 0.1 }).toEqual({ d: Math.round(d), late: true });
        }
      } finally {
        s.done();
      }
    });
  });

  // ── the frame: the clock, the pointer, and nothing named ─────────────────

  const pointerOf = (sim: Sim) => (sim as unknown as { pointer: { active: boolean } }).pointer;
  /** Whether the scene has answered a click: rings in Shoal's water, food on the pond, a pulse in
   *  the deep, a burst of light in the meadow. */
  const answered = (sim: Sim) =>
    sim instanceof Swarm ? sim.pulses.length > 0
    : sim instanceof Meadow ? sim.waves.length > 0
    : (sim as World).events.some((e) => e.kind === "splash") || (sim as World).food.length > 0;

  test("held, a scene neither steps nor draws; still, it is one settled picture, drawn again where it is when the theme changes; the pointer and clicks stir it only while it runs; and nothing under the pointer is ever named", async () => {
    for (const name of NAMES) {
      await seeded(91, async () => {
        const s = await scene(name, { creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "needs-you" }], tiles: [{ x0: 100, y0: 100, x1: 500, y1: 400, id: "a1" }] });
        try {
          const places = () => JSON.stringify(bodiesOf(name, s.sim).map((b) => [b.x.toFixed(2), b.y.toFixed(2)]));
          const was = places();
          await new Promise((r) => setTimeout(r, 300));
          expect({ name, draws: s.seen.draws, still: places() === was }).toEqual({ name, draws: 1, still: true });
          // Held, the pointer and a click are no one's: what lives there does not notice them.
          s.host.point(W / 2, H / 2);
          s.host.click(W / 2, H / 2);
          await s.host.settle();
          expect({ name, noticed: pointerOf(s.sim).active, answered: answered(s.sim) }).toEqual({ name, noticed: false, answered: false });
        } finally {
          s.done();
        }
      });
      await seeded(92, async () => {
        const s = await scene(name, { mode: "still" });
        try {
          const places = () => JSON.stringify(bodiesOf(name, s.sim).map((b) => [b.x.toFixed(2), b.y.toFixed(2)]));
          const settled = places();
          expect({ name, draws: s.seen.draws }).toEqual({ name, draws: 1 });
          s.host.send({ type: "look", look: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: places() !== settled }).toEqual({ name, draws: 2, moved: false });
        } finally {
          s.done();
        }
      });
      await seeded(93, async () => {
        const s = await scene(name, { mode: "run", creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "working" }] });
        try {
          // Over each creature, and a click there: it notices, and answers; and the app is told of
          // nothing under the pointer.
          for (const b of bodiesOf(name, s.sim)) {
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

  // ── what it lays out ──────────────────────────────────────────────────────

  test("Jellyfish: every kind's bell is a dome wider than it is tall, open or shut, with a scalloped rim, and those with long tentacles trail them well past their bells", () => {
    for (const kind of JELLY_KINDS) {
      const shape = JELLY_SHAPES[kind];
      for (const beat of [0, 1]) {
        const { w, h } = bellOf({ shape, length: 100, beat });
        expect({ kind, beat, wider: 2 * w > h * 1.25 }).toEqual({ kind, beat, wider: true });
      }
      expect({ kind, lobes: shape.lobes >= 8, dome: shape.dome > 0.5 && shape.dome < 1 }).toEqual({ kind, lobes: true, dome: true });
      if (!shape.fringe && shape.tentacles) expect({ kind, trailing: shape.reach > shape.h * 3 }).toEqual({ kind, trailing: true });
    }
  });

  test("Koi Pond: each variety is known by its pattern, which rides its skin, the same wherever it swims", () => {
    const L = 200;
    const pattern = (kind: (typeof KOI_KINDS)[number], id: number) => {
      const shape = KOI_SHAPES[kind];
      const seen = new Map<number, number[]>();
      for (let s = 0.01; s < 0.8; s += 0.01) {
        for (let across = -0.95; across <= 0.95; across += 0.1) {
          const m = shape.mark?.(s, across * shape.halfWidth(s) * L, L, Math.abs(across), id, false) ?? 0;
          seen.set(m, [...(seen.get(m) ?? []), s]);
        }
      }
      return { marks: [...seen.keys()].sort(), along: seen, fins: new Set([0.2, 0.5, 0.9].map((s) => shape.mark?.(s, 30, L, 0, id, true) ?? 0)) };
    };
    for (const id of [3, 17, 42]) {
      expect(pattern("kohaku", id).marks).toEqual([0, 1]);
      expect([...pattern("kohaku", id).fins]).toEqual([0]);
      expect(pattern("sanke", id).marks).toEqual([0, 1, 2]);
      expect(pattern("showa", id).marks).toEqual([0, 1, 2]);
      expect(pattern("tancho", id).along.get(1)!.every((s) => s < 0.15)).toBe(true);
      expect(pattern("ogon", id).marks).toEqual([0]);
      expect(pattern("platinum", id).marks).toEqual([0]);
      expect(pattern("asagi", id).fins.has(1)).toBe(true);
      expect(pattern("chagoi", id).marks).toEqual([0, 1]);
    }
    // Two kohaku differ, and one is the same each time.
    const a = pattern("kohaku", 3).along.get(1)!.join();
    expect(pattern("kohaku", 4).along.get(1)!.join()).not.toBe(a);
    expect(pattern("kohaku", 3).along.get(1)!.join()).toBe(a);
  });

  test("Koi Pond: a lily pad has its notch, rim, veins and flower; the pads lie apart and drift back in from the other side", () => {
    const pad = (over: Partial<Pad> = {}): Pad => ({ x: 0, y: 0, r: 60, turn: 0, notch: 0.3, spin: 0, vx: 0, vy: 0, flower: null, seed: 1, ...over });
    const cw = 8;
    for (let d = cw * 1.5; d < 60; d += 4) expect(padCell(pad(), d, 0, cw)).toBe(PadPart.None);
    expect(padCell(pad({ turn: Math.PI }), 40, 0, cw)).not.toBe(PadPart.None);
    expect(padCell(pad(), -57, 0, cw)).toBe(PadPart.Rim);
    expect(padCell(pad(), -61, 0, cw)).toBe(PadPart.None);
    const ring = [];
    for (let a = 0.6; a < 5.6; a += 0.05) ring.push(padCell(pad(), Math.cos(a) * 30, Math.sin(a) * 30, cw));
    expect(ring.includes(PadPart.Vein) && ring.includes(PadPart.Leaf)).toBe(true);
    expect(padCell(pad({ flower: Math.PI / 2 }), 0, 60 * 0.45, cw)).toBe(PadPart.Heart);
    const pond = new Pond();
    pond.build(W, H);
    expect(pond.pads.length).toBeGreaterThanOrEqual(6);
    for (const [i, a] of pond.pads.entries()) for (const b of pond.pads.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r).toBe(true);
    const p = pond.pads[0]!;
    Object.assign(p, { vx: 50, vy: 0, x: W + p.r - 1 });
    pond.step(1);
    expect(p.x).toBeLessThan(0);
  });

  test("the plants along the bottom: Shoal's reef on the bed with seagrass and kelp rising from it, Koi Pond's reeds, rushes and cattails in the corners, the meadow's layers; each reaching as high as it should, and the same for the same window", () => {
    for (const [cols, rows] of [[180, 75], [110, 62], [320, 70], [90, 110]] as const) {
      const where = `${cols}×${rows}`;
      const bed = new Seabed();
      bed.build(cols, rows);
      const reefTop = Math.min(...bed.cells.map((c) => c.r));
      const grass = bed.weeds.filter((w) => !w.kelp);
      const kelp = bed.weeds.filter((w) => w.kelp);
      expect({
        where,
        reef: reefTop >= rows - Math.max(8, Math.round(rows * 0.2)),
        floor: new Set(bed.cells.filter((c) => c.r === rows - 1).map((c) => c.c)).size === cols,
        seagrass: grass.length > 10 && grass.every((w) => w.foot - w.height + 1 >= rows - Math.max(10, Math.round(rows * 0.26))),
        // Kelp in stands, the tallest a fifth of the window and more.
        kelp: kelp.length >= 6 && Math.max(...kelp.map((w) => w.height)) >= rows * 0.2,
      }).toEqual({ where, reef: true, floor: true, seagrass: true, kelp: true });

      const { reeds, mud } = bankOf(cols, rows);
      const corner = (c: number) => Math.min(c, cols - 1 - c) < cols * 0.12;
      expect({
        where,
        kinds: ["reed", "rush", "cattail"].every((k) => reeds.some((r) => r.kind === k)),
        tallest: Math.max(...reeds.map((r) => r.height)) >= rows * 0.25,
        corners: reeds.filter((r) => corner(r.c)).length > reeds.length * 0.6,
        leaves: reeds.some((r) => r.kind === "reed" && r.leaves.length > 0),
        mud: mud[0]! > 0 && mud[cols - 1]! > 0 && mud[Math.floor(cols / 2)] === 0,
      }).toEqual({ where, kinds: true, tallest: true, corners: true, leaves: true, mud: true });

      const { blades } = meadowOf(cols, rows);
      const mean = (layer: number) => { const hs = blades.filter((b) => b.layer === layer).map((b) => b.height); return hs.reduce((a, b) => a + b, 0) / hs.length; };
      const near = blades.filter((b) => b.layer === 2);
      expect({
        where,
        // Far short, the middle taller, the near grass tallest, reaching a fifth to a quarter of
        // the way up the window and no higher.
        layered: mean(0) < mean(1) && mean(1) < mean(2),
        reach: Math.max(...near.map((b) => b.height)) >= rows * 0.18 && Math.max(...blades.map((b) => b.height)) <= rows * 0.3,
        seeds: near.filter((b) => b.seed > 0).length > near.length * 0.2,
        leaves: near.some((b) => b.leaves.length > 0),
        // Swaying out of step: the clumps start their sway in many places.
        outOfStep: new Set(near.map((b) => Math.round(b.phase % (Math.PI * 2)))).size >= 5,
      }).toEqual({ where, layered: true, reach: true, seeds: true, leaves: true, outOfStep: true });
    }
    const [a, b] = [new Seabed(), new Seabed()];
    a.build(180, 75);
    b.build(180, 75);
    expect(b.cells).toEqual(a.cells);
    expect(b.weeds).toEqual(a.weeds);
    expect(bankOf(180, 75)).toEqual(bankOf(180, 75));
    expect(meadowOf(180, 75)).toEqual(meadowOf(180, 75));
  });

  test("Jellyfish: the marine snow keeps falling, and as much of it stays in the water", async () => {
    await seeded(95, async () => {
      const s = await scene("jellyfish");
      const swarm = s.sim as Swarm;
      try {
        const n = swarm.snow.length;
        const depth = () => swarm.snow.reduce((sum, m) => sum + m.y, 0) / n;
        const before = depth();
        run(swarm, 2);
        expect(depth()).not.toBe(before);
        run(swarm, 120);
        expect({ n: swarm.snow.length, inWater: swarm.snow.every((m) => m.y > -10 && m.y < H + 10), aloft: swarm.snow.filter((m) => m.y < H / 3).length > n * 0.2 })
          .toEqual({ n, inWater: true, aloft: true });
      } finally {
        s.done();
      }
    });
  });
});

// ── its colours, against the app's presets ──────────────────────────────────

const { PRESETS } = await core("settings-schema.ts");
/** A preset's colour (CSS), as the scenes' colours are: sRGB 0 to 255. */
const css = (s: string): Rgb => parseColor(s)!.rgb.map((v) => Math.round(v * 255)) as unknown as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as [number, number, number], b.map((v) => v / 255) as [number, number, number]);
/** `top` at `alpha` over `under`, as the page composites it; and added to it, as light. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
const add = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => Math.min(255, under[i]! + v * alpha)) as unknown as Rgb;
/** The Layers panel over a live wallpaper with See-through: its colour at a sixth (the app's
 *  SEE_THROUGH opacity, 0.5, at a third). */
const TINT = 0.5 / 3;
const WATERS: Record<SceneName, { dark: WaterLook; light: WaterLook }> = { shoal: SHOAL_PALETTE, koi: KOI_PALETTE, jellyfish: JELLY_PALETTE, fireflies: FIREFLY_PALETTE };

test("each scene's water, in its own colours, keeps the frosted panels' text readable over it, dark and light: names at 7:1, details at 4.5:1, hints at 3:1, under the glow and a light shaft too", () => {
  for (const name of NAMES) {
    for (const [mode, preset] of [["dark", "signal"], ["light", "clean-light"]] as const) {
      const look = WATERS[name][mode];
      const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
      const stops = look.water.map(rgbOf);
      const glowed = look.glow ? over(rgbOf(look.glow.colour), look.glow.alpha, stops[0]!) : stops[0]!;
      const shaft = look.shafts && (look.shafts.add ? add : over)(rgbOf(look.shafts.colour), look.shafts.alpha, glowed);
      for (const [i, water] of [...stops, glowed, ...(shaft ? [shaft] : [])].entries()) {
        const where = `${name} ${mode}, ${i < stops.length ? `stop ${i}` : i === stops.length ? "the glow" : "a shaft"}`;
        const panel = over(css(bg2!), TINT, water);
        expect({ where, names: contrast(css(fg!), panel) >= 7, details: contrast(css(fg2!), panel) >= 4.5, hints: i > stops.length || contrast(css(fg3!), panel) >= 3 })
          .toEqual({ where, names: true, details: true, hints: true });
      }
    }
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

const WALLPAPERS = ["shoal", "koi", "jellyfish", "fireflies"];
const NAMED: Record<string, string> = { shoal: "Shoal", koi: "Koi Pond", jellyfish: "Jellyfish", fireflies: "Fireflies" };

test("the app's package reader takes Live scenes as @dip497/live-scenes, holding the four live wallpapers by their names, and offers Shoal on install; none asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "live-scenes" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/live-scenes", members: WALLPAPERS.map((w) => ["wallpaper", `@dip497/live-scenes/${w}`, NAMED[w]]), startup: "@dip497/live-scenes/shoal" });
  for (const w of WALLPAPERS) expect({ w, colour: JSON.parse(readFileSync(path.join(PKG, "wallpapers", w, "hivemind-wallpaper.json"), "utf8")).colour }).toEqual({ w, colour: undefined });
});

test("HiveHub lists Live scenes as needing Hivemind 2026.10.8, each wallpaper sandboxed and asking for nothing, and installs each wallpaper's folder (its build, its face and licences) without the sources or the harness", async () => {
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
    .toEqual(WALLPAPERS.map((w) => ["wallpaper", `@dip497/live-scenes/${w}`, "sandboxed", []]));
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const w of WALLPAPERS) {
    for (const f of ["dist/main.js", "hivemind-wallpaper.json", "preview.webp", "fonts/jetbrains-mono-latin-600-normal.woff2", "fonts/OFL.txt"]) expect(installs).toContain(`wallpapers/${w}/${f}`);
  }
  // Shoal grew from stackedlol/ascii-sharks: its licence goes with it.
  expect(installs).toContain("wallpapers/shoal/LICENSE");
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

describe("Live scenes, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveScenes } = await import("../packages/live-scenes/harness/serve");
    server = await serveScenes();
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function open(scene: string, mode: "run" | "hold", dpr: number): Promise<{ page: Page; frame: Frame }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ scene, mode }) => window.start({ scene, mode, look: { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "'Not A Font Here', monospace" } }), { scene, mode });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 10_000 });
    return { page, frame: page.frames().find((f) => f.url().includes("/wp/"))! };
  }
  /** What the scene's canvas shows, as a number. */
  const picture = (frame: Frame) => frame.evaluate(() => {
    const c = document.querySelector("canvas")!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) | 0;
    return h;
  });

  for (const scene of WALLPAPERS) {
    test(`${NAMED[scene]}: in its sandboxed frame it says it speaks protocol 1 and that its first frame is up, and nothing else; draws a canvas the viewport's size times its pixel ratio, in the face it brings; moves while it runs and not while held`, async () => {
      const { page, frame } = await open(scene, "run", 2);
      try {
        await new Promise((r) => setTimeout(r, 600));
        const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused }));
        expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
        const canvas = await frame.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
        expect(canvas).toEqual([2560, 1600, 1280, 800]);
        // Its own face, from its own folder: the person's font is not in the frame.
        expect(await frame.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Live Scenes Mono").map((f) => f.status))).toEqual(["loaded"]);
        const a = await picture(frame);
        await new Promise((r) => setTimeout(r, 400));
        expect(await picture(frame)).not.toBe(a);
        await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
        await new Promise((r) => setTimeout(r, 200));
        const held = await picture(frame);
        await new Promise((r) => setTimeout(r, 800));
        expect(await picture(frame)).toBe(held);
      } finally {
        await page.close();
      }
    }, 60_000);
  }
});
