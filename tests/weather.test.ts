// Weather, the package of three live wallpapers (Rain on Glass, Snowfall, Northern Lights): each scene run
// through the SDK's fakeWallpaperHost as the app connects it (runScene), with the randomness seeded
// and no canvas (its drawing is a stand-in that counts frames); its colours measured against the
// app's own presets; the package read by the app's package reader and HiveHub's check; and its build
// loaded in Chromium the way the app serves it. Each bar sits clear of what 20 or more seeds
// measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import { runScene, type Sim } from "../packages/weather/src/scene";
import { cellSize } from "../packages/weather/src/cells";
import { seeded } from "../packages/weather/src/util";
import { mix, rgbOf, type Oklch, type Rgb } from "../packages/weather/src/colour";
import type { SkyLook } from "../packages/weather/src/sky";
import { Glass, REFOG, TAP, WIPE } from "../packages/weather/src/rain/glass";
import { RAIN_PALETTE, LIGHTS } from "../packages/weather/src/rain/palette";
import { DENSITY, GROUND, POWDER, Valley } from "../packages/weather/src/snow/valley";
import { SNOW_PALETTE } from "../packages/weather/src/snow/palette";
import { METEOR, Tundra } from "../packages/weather/src/northern-lights/tundra";
import { starsFor } from "../packages/weather/src/northern-lights/land";
import { NORTHERN_LIGHTS_PALETTE, FILL } from "../packages/weather/src/northern-lights/palette";

const PKG = path.join(ROOT, "packages/weather");
// An hour of each scene, and a minute or two of each on a few seeds, take a few seconds each.
setDefaultTimeout(120_000);
const W = 1440;
const H = 900;
const STEP = 1 / 60;

/** Run `fn` with Math.random seeded: the rain, the wind, the stocking. */
async function withSeed<T>(seed: number, fn: () => Promise<T> | T): Promise<T> {
  const real = Math.random;
  Math.random = seeded(seed);
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}
const run = (sim: Sim, secs: number, each?: () => void) => {
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    sim.step(STEP);
    each?.();
  }
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

const SCENES = { rain: () => new Glass(), snow: () => new Valley(), "northern-lights": () => new Tundra() } as const;
type SceneName = keyof typeof SCENES;
const NAMES = Object.keys(SCENES) as SceneName[];

/** A scene connected to a fake host as the app would connect it, drawn by a stand-in that counts
 *  its frames. */
async function open<S extends Sim>(sim: S, opts: FakeWallpaperOptions) {
  const host = fakeWallpaperHost({ viewport: { w: W, h: H, dpr: 1 }, ...opts });
  const wp = await host.connect();
  const seen = { draws: 0 };
  const stop = runScene(wp, sim, { resize() {}, setLook() {}, draw() { seen.draws++; } });
  await host.settle();
  return { host, sim, seen, done: () => { stop(); host.close(); } };
}
const scene = <N extends SceneName>(name: N, opts: FakeWallpaperOptions = {}) => open(SCENES[name]() as ReturnType<(typeof SCENES)[N]>, { mode: "hold", ...opts });

/** How many of a window's four quadrants hold at least one of `points`. */
const quadrants = (points: { x: number; y: number }[], w: number, h: number) => new Set(points.map((p) => `${p.x < w / 2}${p.y < h / 2}`)).size;

// ── full from the first frame ────────────────────────────────────────────

describe("Weather", () => {
  test("each scene is full from its first frame, spread over the window, and more of it on a bigger window", async () => {
    const sizes = [[1024, 640], [1440, 900], [2560, 1440]] as const;
    const counts: Record<SceneName, number[]> = { rain: [], snow: [], "northern-lights": [] };
    for (const [w, h] of sizes) {
      for (const seed of [1, 2, 3]) {
        await withSeed(seed, async () => {
          const where = `${w}×${h} seed ${seed}`;
          // Held: its first frame is drawn without a step.
          const rain = await scene("rain", { viewport: { w, h, dpr: 1 } });
          const g = rain.sim;
          try {
            const beads = [0, 0, 0, 0];
            const cells = [0, 0, 0, 0];
            g.bead.forEach((b, i) => {
              const q = (i % g.cols < g.cols / 2 ? 0 : 1) + (Math.floor(i / g.cols) < g.rows / 2 ? 0 : 2);
              cells[q]!++;
              if (b) beads[q]!++;
            });
            const fogged = g.fog.filter((f) => f >= 0.15).length / g.fog.length;
            const streaks = g.fog.filter((f, i) => f < g.fogBase[i]! * 0.6).length / g.fog.length;
            // Over 20 seeds at each size: 13.6% to 15.1% of each quadrant's cells beaded; drops
            // running in 3 or 4 quadrants; 99.6% or more of the glass fogged; 1.1% to 3.9% of it
            // cleared by streaks.
            expect({ where, draws: rain.seen.draws, beaded: beads.every((b, q) => b / cells[q]! > 0.09), running: quadrants(g.runners, w, h) >= 3, fogged: fogged > 0.95, streaks: streaks > 0.005 && streaks < 0.08 })
              .toEqual({ where, draws: 1, beaded: true, running: true, fogged: true, streaks: true });
            if (seed === 1) counts.rain.push(g.runners.length);
          } finally {
            rain.done();
          }
          const snow = await scene("snow", { viewport: { w, h, dpr: 1 } });
          const v = snow.sim;
          try {
            const layers = [0, 1, 2].map((L) => v.flakes.filter((f) => f.layer === L && f.y >= 0));
            const spread = layers.map((fl) => quadrants(fl, w, h) >= 3 && Math.max(...fl.map((f) => f.x)) - Math.min(...fl.map((f) => f.x)) > w * 0.7 && Math.max(...fl.map((f) => f.y)) - Math.min(...fl.map((f) => f.y)) > h * 0.6);
            const houses = v.layout!.houses.map((house) => (house.mid + 0.5) * v.cw);
            const chimneys = v.layout!.houses.flatMap((house, k) => (house.smoke ? [v.smoke[k]!.length] : []));
            // Over 20 seeds: every depth of flake in all four quadrants, across 79% or more of the
            // width and 76% of the height; houses across 81% to 86% of the width; every chimney smoking.
            expect({ where, draws: snow.seen.draws, spread, houses: houses.length >= 6 && Math.max(...houses) - Math.min(...houses) > w * 0.65, smoke: chimneys.length > 2 && chimneys.every((n) => n > 5), snowy: v.ledgeDepth.every((d) => d > 0) })
              .toEqual({ where, draws: 1, spread: [true, true, true], houses: true, smoke: true, snowy: true });
            if (seed === 1) counts.snow.push(v.flakes.length);
          } finally {
            snow.done();
          }
          const lights = await scene("northern-lights", { viewport: { w, h, dpr: 1 } });
          const t = lights.sim;
          try {
            // The aurora across the sky: of 40 columns across the window, how many it lights (25 at
            // its first moment, the same sky every time; 34 two minutes on).
            let lit = 0;
            for (let k = 0; k < 40; k++) {
              let most = 0;
              for (let y = 0; y < h * 0.8; y += 6) most = Math.max(most, t.light(((k + 0.5) * w) / 40, y));
              if (most > 0.1) lit++;
            }
            const drift = t.drift.map((d) => d.x);
            expect({ where, draws: lights.seen.draws, lit: lit >= 22, drift: Math.max(...drift) - Math.min(...drift) > w * 0.8 })
              .toEqual({ where, draws: 1, lit: true, drift: true });
            if (seed === 1) counts["northern-lights"].push(t.drift.length + starsFor(w, h));
          } finally {
            lights.done();
          }
        });
      }
    }
    for (const name of NAMES) expect({ name, more: counts[name][0]! < counts[name][1]! && counts[name][1]! < counts[name][2]! }).toEqual({ name, more: true });
  });

  test("a resize keeps each world as it was and fits it to the new window", async () => {
    await withSeed(5, async () => {
      // The rain: a wiped patch, the beads and the running drops stay where they were on the glass.
      const g = new Glass();
      g.resize(W, H);
      run(g, 2);
      g.point(W * 0.3, H * 0.4, true);
      run(g, 0.3);
      g.point(0, 0, false);
      const ids = g.runners.map((d) => [d.id, d.x / W, d.y / H] as const);
      const beaded = g.bead.filter((b) => b > 0).length / g.bead.length;
      g.resize(1800, 1125);
      const clear = g.fog[g.cellAt(1800 * 0.3, 1125 * 0.4)]!;
      const after = new Map(g.runners.map((d) => [d.id, [d.x / 1800, d.y / 1125]]));
      expect({
        clear: clear < 0.1,
        kept: ids.every(([id, fx, fy]) => Math.abs(after.get(id)![0]! - fx) < 1e-9 && Math.abs(after.get(id)![1]! - fy) < 1e-9),
        beaded: Math.abs(g.bead.filter((b) => b > 0).length / g.bead.length - beaded) < beaded * 0.35,
      }).toEqual({ clear: true, kept: true, beaded: true });
    });
    await withSeed(6, async () => {
      // The village: the same houses at the same shares of the width, the snow lying as it lay.
      const v = new Valley();
      v.resize(W, H);
      run(v, 30);
      const houses = v.layout!.houses.map((h) => h.mid / v.cols);
      const ledges = new Map(v.layout!.ledges.map((l, k) => [l.key, v.ledgeDepth[k]!]));
      const ground = mean([...v.ground]);
      const flake = v.flakes[0]!;
      const at = [flake.x / W, flake.y / H];
      v.resize(1800, 1125);
      expect({
        houses: v.layout!.houses.map((h) => Math.abs(h.mid / v.cols - houses.shift()!) < 0.01),
        ledges: v.layout!.ledges.every((l, k) => !ledges.has(l.key) || Math.abs(v.ledgeDepth[k]! - ledges.get(l.key)!) < 1e-6),
        ground: Math.abs(mean([...v.ground]) - ground) < 0.05,
        flake: Math.abs(flake.x / 1800 - at[0]!) < 1e-9 && Math.abs(flake.y / 1125 - at[1]!) < 1e-9,
      }).toEqual({ houses: v.layout!.houses.map(() => true), ledges: true, ground: true, flake: true });
    });
    await withSeed(7, async () => {
      // The sky: the same moment of the same curtains, a shooting star where it was.
      const t = new Tundra();
      t.resize(W, H);
      run(t, 5);
      t.splash(W * 0.4, H * 0.3);
      const m = t.meteors[t.meteors.length - 1]!;
      const [time, curtains, fx, fy] = [t.time, t.curtains, m.x / W, m.y / H];
      t.resize(1800, 1125);
      expect({ time: t.time === time, curtains: t.curtains === curtains, meteor: Math.abs(m.x / 1800 - fx) < 1e-9 && Math.abs(m.y / 1125 - fy) < 1e-9 }).toEqual({ time: true, curtains: true, meteor: true });
    });
  });

  // ── what happens on the glass, in the valley, in the sky ────────────────

  test("Rain on Glass: drops bead and swell, run down taking up the beads in their way, and leave a trail of beads and a clear line through the condensation", async () => {
    let started = 0;
    let grew = 0;
    let frames = 0;
    let trails = 0;
    let cleared = 0;
    for (let seed = 11; seed <= 14; seed++) {
      await withSeed(seed, async () => {
        const g = new Glass();
        g.resize(W, H);
        const seen = new Map(g.runners.map((d) => [d.id, d.r]));
        run(g, 30, () => {
          for (const d of g.runners) {
            if (!seen.has(d.id)) {
              started++;
              seen.set(d.id, d.r);
            }
            // Bigger than it set off: it has taken up beads.
            if (d.r > seen.get(d.id)! * 1.3) {
              grew++;
              seen.set(d.id, Infinity);
            }
            if (d.pathN >= 6) {
              frames++;
              const passed = [...d.path.slice(2, 6)];
              trails += passed.some((i) => g.bead[i]! > 0) ? 1 : 0;
              cleared += passed.every((i) => g.fog[i]! < g.fogBase[i]! * 0.8) ? 1 : 0;
            }
          }
        });
      });
    }
    // Over 20 seeds of half a minute: 36 to 61 drops set off each, 30% to 84% of them growing by a
    // third or more on the way; behind a running drop, a bead in its last few cells 72% to 80% of
    // the time, and its line clear of condensation 99% of the time.
    expect({ started: started > 4 * 25, grew: grew > started * 0.15, trails: trails > frames * 0.5, cleared: cleared > frames * 0.9 }).toEqual({ started: true, grew: true, trails: true, cleared: true });
  });

  test("Rain on Glass: the pointer wipes the condensation clear where it rests and all along where it moves, and it fogs over again in a quarter of a minute; a tap shakes the drops near it loose, they shiver, then run", async () => {
    const after5: number[] = [];
    const after30: number[] = [];
    for (let seed = 21; seed <= 30; seed++) {
      await withSeed(seed, async () => {
        const g = new Glass();
        g.resize(W, H);
        run(g, 2);
        const [px, py] = [W * 0.4, H * 0.45];
        const near = [...g.fog.keys()].filter((i) => Math.hypot((((i % g.cols) + 0.5) * g.cw - px) / WIPE.x, ((Math.floor(i / g.cols) + 0.5) * g.ch - py) / WIPE.y) < 0.6);
        const base = mean(near.map((i) => g.fogBase[i]!));
        const fog = () => mean(near.map((i) => g.fog[i]!)) / base;
        g.point(px, py, true);
        run(g, 0.5);
        // Over 20 seeds, under a resting pointer: at most 0.001 left.
        expect({ seed, wiped: Math.max(...near.map((i) => g.fog[i]!)) < 0.02 }).toEqual({ seed, wiped: true });
        g.point(0, 0, false);
        run(g, 5);
        after5.push(fog());
        run(g, 25);
        after30.push(fog());
        // A stroke: every cell along it wiped.
        g.point(W * 0.1, H * 0.2, true);
        g.step(STEP);
        g.point(W * 0.6, H * 0.25, true);
        g.step(STEP);
        const along = Array.from({ length: 40 }, (_, k) => g.fog[g.cellAt(W * (0.1 + (0.5 * k) / 39), H * (0.2 + (0.05 * k) / 39))]!);
        expect({ seed, stroke: Math.max(...along) < 0.02 }).toEqual({ seed, stroke: true });
      });
    }
    // Over 20 seeds, of its condensation back after 5 s: 0.55; after 30 s, 0.73 to all (a drop's
    // line may cross it).
    expect({ soon: Math.max(...after5) < 0.75, later: Math.min(...after30) > 0.6 && mean(after30) > 0.9, refog: REFOG < 30 }).toEqual({ soon: true, later: true, refog: true });

    for (let seed = 31; seed <= 36; seed++) {
      await withSeed(seed, async () => {
        const g = new Glass();
        g.resize(W, H);
        run(g, 3);
        const [x, y] = [W * 0.55, H * 0.4];
        const ids = new Set(g.runners.map((d) => d.id));
        g.splash(x, y);
        const loose = g.runners.filter((d) => !ids.has(d.id));
        const y0 = loose.map((d) => d.y);
        run(g, 0.15);
        const shivering = loose.every((d, k) => d.y === y0[k]);
        run(g, 1.35);
        // Over 20 seeds: 36 drops loose (as many as a tap shakes), all from within its reach; none
        // moved in the first 0.15 s; 30 px to 36 px down on average 1.5 s on.
        expect({
          seed,
          loose: loose.length >= 20 && loose.every((d, k) => Math.hypot(d.x - x, y0[k]! - y) <= TAP.reach * g.scale + g.ch),
          shivering,
          ran: mean(loose.map((d, k) => d.y - y0[k]!)) > 15,
        }).toEqual({ seed, loose: true, shivering: true, ran: true });
      });
    }
  });

  test("Snowfall: snow piles up on the ground, the roofs and the branches, slowly, and stops at its most", async () => {
    await withSeed(41, async () => {
      const v = new Valley();
      v.resize(W, H);
      const ground0 = mean([...v.ground]);
      const roofs0 = mean([...v.ledgeDepth]);
      run(v, 300);
      const ground5 = mean([...v.ground]);
      // Over 20 seeds: the ground rose 0.07 to 0.08 rows in five minutes (in an hour it lies 1.15
      // rows deep, its most 1.8), and 71% to 77% of the roofs and branches hold all they can.
      expect({ rose: ground5 - ground0 > 0.05 && ground5 - ground0 < 0.6, roofs: mean([...v.ledgeDepth]) > roofs0, capped: v.layout!.ledges.every((l, k) => v.ledgeDepth[k]! <= l.cap + 1e-6) && [...v.ground].every((d) => d <= GROUND.cap + 1e-6) })
        .toEqual({ rose: true, roofs: true, capped: true });
    });
  });

  test("Snowfall: a gust from the pointer blows the flakes away from where it rests and sweeps them along as it moves; a click bursts a puff of powder that drifts down and is gone", async () => {
    const near = { resting: 0, without: 0 };
    for (let seed = 51; seed <= 60; seed++) {
      for (const resting of [true, false]) {
        await withSeed(seed, async () => {
          const v = new Valley();
          v.resize(W, H);
          run(v, 3);
          const [px, py] = [W / 2, H * 0.35];
          v.point(px, py, resting);
          run(v, 2);
          near[resting ? "resting" : "without"] += v.flakes.filter((f) => Math.hypot(f.x - px, f.y - py) < 70).length;
        });
      }
    }
    // Over 20 seeds, within 70 px of where the pointer rests 2 s: almost none; without it, a few
    // each time.
    expect({ cleared: near.resting < near.without * 0.25, without: near.without > 20 }).toEqual({ cleared: true, without: true });

    for (let seed = 61; seed <= 66; seed++) {
      await withSeed(seed, async () => {
        const v = new Valley();
        v.resize(W, H);
        run(v, 2);
        let x = W * 0.3;
        v.point(x, H * 0.35, true);
        run(v, 0.2);
        for (let k = 0; k < 30; k++) {
          x += 12;
          v.point(x, H * 0.35, true);
          v.step(STEP);
        }
        // Over 20 seeds, the flakes near a pointer moving right at 720 px/s went 74 to 285 px/s
        // faster rightward than the wind.
        const swept = v.flakes.filter((f) => f.layer > 0 && Math.hypot(f.x - x, f.y - H * 0.35) < 80);
        expect({ seed, swept: mean(swept.map((f) => f.vx - v.wind)) > 30 }).toEqual({ seed, swept: true });
        v.point(0, 0, false);
        run(v, 1);
        const [cx, cy] = [W * 0.6, H * 0.3];
        v.splash(cx, cy);
        const n = v.powder.length;
        run(v, 0.3);
        const burst = Math.max(...v.powder.map((p) => Math.hypot(p.x - cx, p.y - cy)));
        run(v, 1.7);
        const down = mean(v.powder.map((p) => p.y - cy));
        run(v, 3);
        // Over 20 seeds: 44 grains, 42 px to 50 px out after 0.3 s, 23 px to 34 px below it on
        // average after 2 s, all gone after 5 s.
        expect({ seed, n: n === POWDER.n, burst: burst > 25, down: down > 8, gone: v.powder.length === 0 }).toEqual({ seed, n: true, burst: true, down: true, gone: true });
      });
    }
  });

  test("Northern Lights: the curtain leans toward the pointer and brightens round it; a click sends a shooting star streaking from there, away and down", async () => {
    const box = (t: Tundra, x: number, y: number) => {
      let s = 0;
      for (let dx = -60; dx <= 60; dx += 10) for (let dy = -60; dy <= 60; dy += 10) s += t.light(x + dx, y + dy);
      return s;
    };
    for (let seed = 71; seed <= 80; seed++) {
      const sums: number[] = [];
      let lean = [0, 0];
      for (const resting of [true, false]) {
        await withSeed(seed, async () => {
          const t = new Tundra();
          t.resize(W, H);
          run(t, 3);
          const px = W * (0.3 + 0.4 * (((seed * 7) % 10) / 10));
          const py = t.edge(1, px) - H * 0.05;
          t.point(px, py, resting);
          run(t, 2);
          sums.push(box(t, px, py));
          if (resting) lean = [t.lean(px - 150), t.lean(px + 150)];
        });
      }
      // Over 20 seeds, the light round a resting pointer 2 s on: 1.97 to 5.4 times what it is
      // without; the rays either side of it lean toward it.
      expect({ seed, brighter: sums[0]! > sums[1]! * 1.4, lean: lean[0]! > 0.05 && lean[1]! < -0.05 }).toEqual({ seed, brighter: true, lean: true });
    }
    for (let seed = 81; seed <= 86; seed++) {
      await withSeed(seed, async () => {
        const t = new Tundra();
        t.resize(W, H);
        run(t, 2);
        const [x, y] = [W * (0.2 + 0.1 * (seed % 6)), H * 0.3];
        t.splash(x, y);
        const m = t.meteors[t.meteors.length - 1]!;
        const from = [m.x, m.y];
        run(t, 0.3);
        // Over 20 seeds: 200 px to 285 px from where it was clicked 0.3 s on, 62 px to 153 px
        // lower; gone within a second.
        const away = Math.hypot(m.x - from[0]!, m.y - from[1]!);
        run(t, 0.7);
        expect({ seed, from: from[0] === x && from[1] === y, away: away > 120, down: m.y - from[1]! > 30, gone: !t.meteors.includes(m), most: t.meteors.length <= METEOR.most })
          .toEqual({ seed, from: true, away: true, down: true, gone: true, most: true });
      });
    }
  });

  // ── the clock, the pointer, and nothing named ─────────────────────────

  /** Where everything that moves in a scene is, as text. */
  const state = (name: SceneName, sim: Sim) => {
    if (name === "rain") { const g = sim as Glass; return JSON.stringify([g.runners.map((d) => [d.x, d.y, d.r]), [...g.bead].reduce((a, b) => a + b, 0), [...g.fog].reduce((a, b) => a + b, 0)]); }
    if (name === "snow") { const v = sim as Valley; return JSON.stringify([v.flakes.map((f) => [f.x, f.y]), [...v.ground], v.powder.length]); }
    const t = sim as Tundra;
    return JSON.stringify([t.time, t.meteors.map((m) => [m.x, m.y]), t.drift.map((d) => d.x), t.pull]);
  };
  /** Whether the scene answered a click: a tap on the glass, a puff of powder, a shooting star. */
  const answered = (name: SceneName, sim: Sim) =>
    name === "rain" ? (sim as Glass).taps.length > 0 : name === "snow" ? (sim as Valley).powder.length > 0 : (sim as Tundra).meteors.length > 0;
  const noticed = (sim: Sim) => (sim as unknown as { pointer: { active: boolean } }).pointer.active;

  test("held, a scene neither steps nor draws; still, it is one settled picture, drawn again where it is when the theme changes; the pointer and clicks stir it only while it runs; it never names anything, whatever the app tells it of agents and tiles", async () => {
    const agents = { creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "needs-you" as const }], tiles: [{ x0: 100, y0: 100, x1: 500, y1: 400, id: "a1" }] };
    for (const name of NAMES) {
      await withSeed(91, async () => {
        const s = await scene(name, agents);
        try {
          const was = state(name, s.sim);
          await new Promise((r) => setTimeout(r, 300));
          expect({ name, draws: s.seen.draws, still: state(name, s.sim) === was }).toEqual({ name, draws: 1, still: true });
          s.host.point(W / 2, H / 2);
          s.host.click(W / 2, H / 2);
          await s.host.settle();
          expect({ name, noticed: noticed(s.sim), answered: answered(name, s.sim) }).toEqual({ name, noticed: false, answered: false });
        } finally {
          s.done();
        }
      });
      await withSeed(92, async () => {
        const s = await scene(name, { mode: "still" });
        try {
          const settled = state(name, s.sim);
          expect({ name, draws: s.seen.draws }).toEqual({ name, draws: 1 });
          s.host.send({ type: "look", look: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: state(name, s.sim) !== settled }).toEqual({ name, draws: 2, moved: false });
        } finally {
          s.done();
        }
      });
      await withSeed(93, async () => {
        const s = await scene(name, { mode: "run", ...agents });
        try {
          for (const [x, y] of [[300, 250], [W / 2, H / 2], [1100, 600]]) {
            s.host.point(x!, y!);
            await s.host.settle();
            expect({ name, noticed: noticed(s.sim) }).toEqual({ name, noticed: true });
            expect(s.host.click(x!, y!)).toBe(null);
          }
          s.host.send({ type: "done", id: "a1" });
          await s.host.settle();
          expect({ name, answered: answered(name, s.sim) }).toEqual({ name, answered: true });
          await new Promise((r) => setTimeout(r, 100));
          expect({ name, said: [...new Set(s.host.received.map((m) => m.type))], refused: s.host.refused, hovered: s.host.hovered })
            .toEqual({ name, said: ["ready", "drawn"], refused: [], hovered: null });
        } finally {
          s.done();
        }
      });
    }
  });

  test("an hour alone, with the pointer about and a click every half minute, each scene stays bounded and alive", async () => {
    await withSeed(97, async () => {
      for (const name of NAMES) {
        const sim = SCENES[name]();
        sim.resize(W, H);
        let k = 0;
        const checks: string[] = [];
        run(sim, 3600, () => {
          k++;
          if (k % 120 === 0) sim.point(W * (0.5 + 0.4 * Math.sin(k / 900)), H * (0.5 + 0.3 * Math.sin(k / 700)), k % 7200 < 3600);
          if (k % 1800 === 0) sim.splash(W * (0.5 + 0.4 * Math.sin(k)), H * 0.4);
          if (k % 3600) return;
          if (sim instanceof Glass) {
            const share = sim.bead.filter((b) => b > 0).length / sim.bead.length;
            // Over 3 seeds of an hour, each minute: 24% to 31% of the cells beaded, 41 to 61 drops
            // running.
            if (sim.runners.length > sim.runCap + TAP.loose || sim.taps.length > 4 || share < 0.08 || share > 0.5) checks.push(`rain at ${k / 3600} min: ${sim.runners.length} running, ${sim.taps.length} taps, ${share.toFixed(2)} beaded`);
          } else if (sim instanceof Valley) {
            const want = DENSITY.reduce((a, d) => a + Math.round(W * H * d), 0);
            if (sim.flakes.length !== want || sim.powder.length > POWDER.most || sim.smoke.some((p) => p.length > 22) || [...sim.ground].some((d) => d > GROUND.cap + 1e-6)) checks.push(`snow at ${k / 3600} min: ${sim.flakes.length} flakes, ${sim.powder.length} powder`);
          } else if (sim instanceof Tundra) {
            if (sim.meteors.length > METEOR.most || !Number.isFinite(sim.light(W / 2, H * 0.3)) || sim.drift.length !== Math.round((W * H) / 16000)) checks.push(`northern lights at ${k / 3600} min: ${sim.meteors.length} shooting stars`);
          }
        });
        expect({ name, checks }).toEqual({ name, checks: [] });
        if (sim instanceof Valley) expect(mean([...sim.ground])).toBeGreaterThan(GROUND.start * 2);
      }
    });
  });
});

// ── its colours, against the app's presets ──────────────────────────────

const { PRESETS } = await core("settings-schema.ts");
/** A preset's colour (CSS), as the scenes' colours are: sRGB 0 to 255. */
const css = (s: string): Rgb => parseColor(s)!.rgb.map((v) => Math.round(v * 255)) as unknown as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as [number, number, number], b.map((v) => v / 255) as [number, number, number]);
/** `top` at `alpha` over `under`, as the page composites it. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
/** The Layers panel over a live wallpaper with See-through: its colour at a sixth (the app's
 *  SEE_THROUGH opacity, 0.5, at a third). */
const TINT = 0.5 / 3;

/** Every ground a panel can sit over in each scene, by theme: the sky and its soft light, and what
 *  lies over it large (not the small things, a drop, a flake, a star, and not the village and the
 *  trees along the bottom). */
function grounds(name: SceneName, mode: "dark" | "light"): [string, Rgb][] {
  const sky = (p: SkyLook): [string, Rgb][] => {
    const stops = p.sky.map((c, i): [string, Rgb] => [`stop ${i}`, rgbOf(c)]);
    return [...stops, ...(p.glow ? stops.map(([k, c]): [string, Rgb] => [`the glow over ${k}`, over(rgbOf(p.glow!.colour), p.glow!.alpha, c)]) : [])];
  };
  if (name === "rain") {
    const p = RAIN_PALETTE[mode];
    // Each light is drawn with plain alpha: the most it can be is its own colour; the condensation's
    // haze lies over all of it.
    const under: [string, Rgb][] = [...sky(p), ["the buildings", rgbOf(p.building)], ...LIGHTS.map((k): [string, Rgb] => [`a light, ${k}`, rgbOf(p.lights[k])])];
    return [...under, ...under.map(([k, c]): [string, Rgb] => [`${k} through condensation`, over(rgbOf(p.veil.colour), p.veil.alpha, c)])];
  }
  if (name === "snow") {
    const p = SNOW_PALETTE[mode];
    return [...sky(p), ...[...p.peakSnow, ...p.peakRock].map((c, i): [string, Rgb] => [`the peaks ${i}`, rgbOf(c)]), ["the forest", rgbOf(p.hills[0])], ["a clearing", rgbOf(p.hills[2])], ...p.snow.map((c, i): [string, Rgb] => [`the snow ${i}`, rgbOf(c)])];
  }
  // The aurora at its brightest: a cell with as many dots lit as it ever lights, at the brightest
  // level of its colour, over the faint block of that colour, over the sky with its glow. The
  // frosted panel sees a cell blurred: as much of the dots' light as they cover of the cell.
  const p = NORTHERN_LIGHTS_PALETTE[mode];
  let cover = 0;
  for (let cw = 7; cw <= 13; cw++) {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      const size = Math.max(1, Math.round(cw * p.dot * dpr));
      cover = Math.max(cover, (FILL * size * size) / (cw * dpr * Math.round(cw * 1.45) * dpr));
    }
  }
  const skies = sky(p);
  const bright = skies.flatMap(([k, ground]) => p.aurora.map((band, b): [string, Rgb] => {
    const dot = mix(rgbOf(p.sky[1]!), rgbOf(band as Oklch), p.levels[2]);
    return [`band ${b} at its brightest over ${k}`, over(dot, cover, over(rgbOf(band as Oklch), p.tint, ground))];
  }));
  return [...skies, ...bright, ...p.snow.map((c, i): [string, Rgb] => [`the snow ${i}`, rgbOf(c)])];
}

test("each scene's ground keeps the frosted panels' text readable over it, by night and by day: names at 7:1, details at 4.5:1, and hints at 3:1 over the sky", () => {
  // The bars are the cell size the scenes are drawn at, from 7 px to 13 px.
  expect([cellSize(700, 700).cw, cellSize(3000, 3000).cw]).toEqual([7, 13]);
  for (const name of NAMES) {
    for (const [mode, preset] of [["dark", "signal"], ["light", "clean-light"]] as const) {
      const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
      for (const [k, ground] of grounds(name, mode)) {
        const where = `${name} ${mode}, ${k}`;
        const panel = over(css(bg2!), TINT, ground);
        expect({ where, names: contrast(css(fg!), panel) >= 7, details: contrast(css(fg2!), panel) >= 4.5, hints: !k.startsWith("stop") || contrast(css(fg3!), panel) >= 3 })
          .toEqual({ where, names: true, details: true, hints: true });
      }
    }
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────

const WALLPAPERS = ["rain", "snow", "northern-lights"];
const NAMED: Record<string, string> = { rain: "Rain on Glass", snow: "Snowfall", "northern-lights": "Northern Lights" };

test("the app's package reader takes Weather as @dip497/weather, holding its three live wallpapers by their names, and offers Rain on Glass on install; none asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "weather" });
  expect({ id: pkg.id, name: pkg.manifest.name, version: pkg.manifest.version, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/weather", name: "Weather", version: "1.0.0", members: WALLPAPERS.map((w) => ["wallpaper", `@dip497/weather/${w}`, NAMED[w]]), startup: "@dip497/weather/rain" });
  for (const w of WALLPAPERS) {
    const m = JSON.parse(readFileSync(path.join(PKG, "wallpapers", w, "hivemind-wallpaper.json"), "utf8"));
    expect({ w, colour: m.colour, protocol: m.protocol, sentence: m.description.length <= 200 && /^[^.]+\.$/.test(m.description) }).toEqual({ w, colour: undefined, protocol: 1, sentence: true });
  }
});

test("HiveHub lists Weather as needing Hivemind 2026.10.8, each wallpaper sandboxed and asking for nothing, and installs each wallpaper's folder (its build, its picture, its face and licence) without the sources or the harness", async () => {
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
    .toEqual(WALLPAPERS.map((w) => ["wallpaper", `@dip497/weather/${w}`, "sandboxed", []]));
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const w of WALLPAPERS) {
    for (const f of ["dist/main.js", "hivemind-wallpaper.json", "preview.webp", "fonts/jetbrains-mono-latin-600-normal.woff2", "fonts/OFL.txt"]) expect(installs).toContain(`wallpapers/${w}/${f}`);
    // The picker's picture: 960×600 (a WebP's VP8 frame says its size), and small.
    const webp = readFileSync(path.join(PKG, "wallpapers", w, "preview.webp"));
    const at = webp.indexOf("VP8 ") + 8 + 6;
    expect({ w, size: [webp.readUInt16LE(at) & 0x3fff, webp.readUInt16LE(at + 2) & 0x3fff], small: webp.length < 512 * 1024 }).toEqual({ w, size: [960, 600], small: true });
  }
});

// ── its build, in Chromium, as the app serves it ────────────────────────

/** The characters a font holds: its cmap, read from a WOFF2 file (its tables Brotli-compressed
 *  together; cmap is never transformed). */
function charsOf(woff2: Buffer): Set<number> {
  let at = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = woff2[at++]!;
      v = v * 128 + (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  };
  const tables: { tag: number; length: number }[] = [];
  for (let n = woff2.readUInt16BE(12), i = 0; i < n; i++) {
    const flags = woff2[at++]!;
    const tag = flags & 0x3f;
    if (tag === 63) at += 4;
    const orig = base128();
    const version = flags >> 6;
    // glyf (10) and loca (11) are transformed unless their version is 3; others only if not 0.
    const transformed = tag === 10 || tag === 11 ? version !== 3 : version !== 0;
    tables.push({ tag, length: transformed ? base128() : orig });
  }
  const data = brotliDecompressSync(woff2.subarray(at, at + woff2.readUInt32BE(20)));
  let offset = 0;
  for (const t of tables) {
    if (t.tag !== 0) {
      offset += t.length;
      continue;
    }
    const cmap = data.subarray(offset, offset + t.length);
    const chars = new Set<number>();
    for (let k = 0; k < cmap.readUInt16BE(2); k++) {
      const sub = cmap.subarray(cmap.readUInt32BE(4 + k * 8 + 4));
      const format = sub.readUInt16BE(0);
      if (format === 4) {
        const segs = sub.readUInt16BE(6) / 2;
        for (let s = 0; s < segs; s++) {
          const end = sub.readUInt16BE(14 + s * 2);
          const start = sub.readUInt16BE(16 + segs * 2 + s * 2);
          const delta = sub.readInt16BE(16 + segs * 4 + s * 2);
          const rangeAt = 16 + segs * 6 + s * 2;
          const range = sub.readUInt16BE(rangeAt);
          for (let ch = start; ch <= end && ch !== 0xffff; ch++) {
            const glyph = range ? sub.readUInt16BE(rangeAt + range + (ch - start) * 2) : (ch + delta) & 0xffff;
            if (glyph) chars.add(ch);
          }
        }
      } else if (format === 12) {
        for (let g = 0; g < sub.readUInt32BE(12); g++) for (let ch = sub.readUInt32BE(16 + g * 12); ch <= sub.readUInt32BE(20 + g * 12); ch++) chars.add(ch);
      }
    }
    return chars;
  }
  return new Set();
}

describe("Weather, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveScenes } = await import("../packages/weather/harness/serve");
    server = await serveScenes();
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function open(scene: string, dark: boolean): Promise<{ page: Page; frame: Frame }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    // In every frame, before its script: note each character drawn on any canvas.
    await page.addInitScript(() => {
      const drawn = ((globalThis as unknown as { drawnChars: Set<string> }).drawnChars = new Set<string>());
      for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
        const fill = proto.fillText;
        proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, max?: number) {
          for (const ch of String(text)) drawn.add(ch);
          return max === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, max);
        } as typeof proto.fillText;
      }
    });
    await page.goto(server.url.href);
    const look = dark
      ? { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "'Not A Font Here', monospace" }
      : { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" };
    await page.evaluate(({ scene, look }) => window.start({ scene, mode: "run", look }), { scene, look });
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
    test(`${NAMED[scene]}: in its sandboxed frame it says it speaks protocol 1 and that its first frame is up, and nothing else; draws a canvas the viewport's size times its pixel ratio, in the face it brings, every character of which that face holds; moves while it runs and not while held`, async () => {
      const face = charsOf(readFileSync(path.join(PKG, "wallpapers", scene, "fonts/jetbrains-mono-latin-600-normal.woff2")));
      const missing = new Set<string>();
      for (const dark of [true, false]) {
        const { page, frame } = await open(scene, dark);
        try {
          await new Promise((r) => setTimeout(r, 600));
          // The pointer about and a click, so all it draws is drawn.
          for (const [x, y] of [[300, 300], [640, 420], [900, 260]]) {
            await page.evaluate(([x, y]) => window.host.point(x!, y!), [x, y]);
            await new Promise((r) => setTimeout(r, 150));
          }
          await page.evaluate(() => window.host.click(640, 300));
          await new Promise((r) => setTimeout(r, 900));
          const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused }));
          expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
          const canvas = await frame.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
          expect(canvas).toEqual([2560, 1600, 1280, 800]);
          // Its own face, from its own folder: the person's font is not in the frame.
          expect(await frame.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Weather Mono").map((f) => f.status))).toEqual(["loaded"]);
          for (const ch of await frame.evaluate(() => [...(globalThis as unknown as { drawnChars: Set<string> }).drawnChars])) if (!face.has(ch.codePointAt(0)!)) missing.add(ch);
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
      }
      expect({ scene, faceHolds: face.size > 150, missing: [...missing] }).toEqual({ scene, faceHolds: true, missing: [] });
    }, 90_000);
  }
});
