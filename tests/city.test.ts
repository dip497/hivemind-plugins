// City, the package of two live wallpapers (Skyline and Sunset Drive): each scene run through
// the SDK's fakeWallpaperHost as the app connects it (runScene), with the randomness seeded and no
// canvas (its drawing a stand-in that counts frames); its colours measured against the app's own
// presets; the package read by the app's package reader and HiveHub's check; and its build loaded in
// Chromium the way the app serves it. Each bar sits clear of what 24 seeds measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import { runScene, type Sim } from "../packages/city/src/scene";
import { seeded as prng } from "../packages/city/src/util";
import { rgbOf, type Oklch, type Rgb } from "../packages/city/src/colour";
import { City, LOOK_REACH, MAX_FIREWORKS, MAX_LOOKERS } from "../packages/city/src/skyline/city";
import { SKYLINE_PALETTE } from "../packages/city/src/skyline/palette";
import { Drive, HORIZON, LEAN_X, MAX_PULSES, PULSE_LIFE } from "../packages/city/src/sunset/drive";
import { SUNSET_PALETTE } from "../packages/city/src/sunset/palette";

const PKG = path.join(ROOT, "packages/city");
// An hour of each scene takes a few seconds.
setDefaultTimeout(60_000);
const W = 1440;
const H = 900;
const STEP = 1 / 60;
const SIZES = [[1024, 640], [1440, 900], [2560, 1440]] as const;

/** Run `fn` with Math.random seeded: the city and the drive made, and what each does. */
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

const SCENES = { skyline: () => new City(), sunset: () => new Drive() } as const;
type SceneName = keyof typeof SCENES;
const NAMES = Object.keys(SCENES) as SceneName[];

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
const scene = <N extends SceneName>(name: N, opts: FakeWallpaperOptions = {}) =>
  open(SCENES[name]() as ReturnType<(typeof SCENES)[N]>, { mode: "hold", ...opts });
const resize = async (s: { host: ReturnType<typeof fakeWallpaperHost> }, w: number, h: number) => {
  s.host.send({ type: "viewport", viewport: { w, h, dpr: 1 } });
  await s.host.settle();
};

/** The windows of the city in view (a window of the back row behind a front building is not), and
 *  whether each is lit. */
const windowsOf = (c: City) => c.placed.flatMap((p, place) => Array.from(p.winC, (col, i) => ({
  place, key: p.winKey[i]!, x: (col + 0.5) * c.cw, y: (p.winR[i]! + 0.5) * c.ch, lit: p.b.states[p.winKey[i]!]! > 0,
})).filter((w, i) => p.b.layer === 1 || !c.hidden(p.winC[i]!, p.winR[i]!)));

// ── what is there from the first frame ──────────────────────────────────────

describe("City", () => {
  test("Skyline is a whole city from its first frame: buildings along the street the window's width, each its own height, lit windows across it, traffic both ways, more on a bigger window, the upper sky left clear", async () => {
    const counts: { placed: number; cars: number }[] = [];
    for (const [w, h] of SIZES) {
      for (const seed of [1, 2, 3]) {
        await seeded(seed, async () => {
          // Held: its first frame is drawn without a step.
          const s = await scene("skyline", { viewport: { w, h, dpr: 1 } });
          try {
            const c = s.sim;
            const where = `${w}×${h} seed ${seed}`;
            const covered = (front: boolean) => {
              const on = new Uint8Array(c.cols);
              for (const p of c.placed) if (!front || p.b.layer === 1) for (const bl of p.blocks) for (let x = Math.max(0, bl.c0); x <= Math.min(c.cols - 1, bl.c1); x++) on[x] = 1;
              return on.reduce((a, b) => a + b, 0) / c.cols;
            };
            const lit = windowsOf(c).filter((x) => x.lit);
            const fifths = [0, 1, 2, 3, 4].map((k) => lit.filter((x) => Math.floor((x.x / w) * 5) === k).length);
            const tops = c.placed.filter((p) => p.b.layer === 1).map((p) => p.blocks[p.blocks.length - 1]!.top);
            const highest = Math.min(...c.placed.flatMap((p) => p.blocks.map((b) => b.top))) * c.ch;
            const lanes = [0, 1].flatMap((lane) => [0, 1].map((half) => c.cars.some((k) => k.lane === lane && Math.floor(k.x / (w / 2)) === half)));
            // Over 24 seeds: the street 97% built and more (90% by the front row); 16 lit windows in
            // its emptiest fifth at least; 7 heights or more along the front; its highest roof 37% of
            // the way down at least; a car each way in each half of the street.
            expect({ where, draws: s.seen.draws, built: covered(false) > 0.95, front: covered(true) > 0.85, litEverywhere: Math.min(...fifths) >= 8, heights: new Set(tops).size >= 5, clearSky: highest > h * 0.3, traffic: lanes.every(Boolean) })
              .toEqual({ where, draws: 1, built: true, front: true, litEverywhere: true, heights: true, clearSky: true, traffic: true });
            if (seed === 1) counts.push({ placed: c.placed.length, cars: c.cars.length });
          } finally {
            s.done();
          }
        });
      }
    }
    expect({ buildings: counts[2]!.placed > counts[0]!.placed, cars: counts[2]!.cars > counts[0]!.cars }).toEqual({ buildings: true, cars: true });
  });

  test("Sunset Drive is a whole drive from its first frame: palms and cacti along both sides, near and far, stars across the sky; more by the road on a wider window", async () => {
    const counts: number[] = [];
    const kinds = new Set<string>();
    for (const [w, h] of SIZES) {
      for (const seed of [1, 2, 3]) {
        await seeded(seed, async () => {
          const s = await scene("sunset", { viewport: { w, h, dpr: 1 } });
          try {
            const d = s.sim;
            const at = { x: 0, y: 0 };
            const inView = (side: number) => d.roadside.filter((t) => t.side === side && (d.project(t.side * t.lat, t.z, at), at.x > 0 && at.x < 1)).length;
            const zs = d.roadside.map((t) => t.z);
            const us = d.stars.map((st) => st.u);
            for (const t of d.roadside) kinds.add(t.kind);
            // Over 24 seeds: two a side at least in view, 5.1 or more apart in depth; the stars
            // across 98% of the sky.
            expect({ where: `${w}×${h} seed ${seed}`, draws: s.seen.draws, left: inView(-1) >= 2, right: inView(1) >= 2, deep: Math.max(...zs) - Math.min(...zs) > 4, stars: Math.max(...us) - Math.min(...us) > 0.9 })
              .toEqual({ where: `${w}×${h} seed ${seed}`, draws: 1, left: true, right: true, deep: true, stars: true });
            if (seed === 1) counts.push(d.roadside.length);
          } finally {
            s.done();
          }
        });
      }
    }
    expect({ more: counts[2]! > counts[0]!, kinds: [...kinds].sort() }).toEqual({ more: true, kinds: ["cactus", "palm"] });
  });

  test("a resize keeps each world as it was and fits it to the new window: the same buildings, lit windows and traffic, the same drive", async () => {
    await seeded(4, async () => {
      const s = await scene("skyline");
      try {
        const c = s.sim;
        const ids = (layer: number) => c.placed.filter((p) => p.b.layer === layer).map((p) => p.b.id);
        const before = { buildings: [...c.buildings], states: c.buildings.map((b) => b.states.slice()), front: ids(1), back: ids(0), cars: c.cars.map((k) => k.x / W) };
        await resize(s, 1920, 1080);
        const wider = ids(1);
        expect({ kept: c.buildings.slice(0, before.buildings.length).every((b, i) => b === before.buildings[i]), more: wider.length > before.front.length, first: wider.slice(0, before.front.length), cars: c.cars.length > before.cars.length })
          .toEqual({ kept: true, more: true, first: before.front, cars: true });
        // Back: the same traffic, where it was along the street.
        await resize(s, W, H);
        expect(c.cars.map((k) => +(k.x / W).toFixed(6))).toEqual(before.cars.map((x) => +x.toFixed(6)));
        // Narrower and back: the same buildings, each window lit as it was.
        await resize(s, 1024, 640);
        await resize(s, W, H);
        expect({ front: ids(1), back: ids(0), lit: c.buildings.slice(0, before.states.length).every((b, i) => b.states.every((v, k) => v === before.states[i]![k])) })
          .toEqual({ front: before.front, back: before.back, lit: true });
      } finally {
        s.done();
      }
    });
    await seeded(6, async () => {
      const s = await scene("sunset");
      try {
        const d = s.sim;
        const keep = { seed: d.seed, stars: JSON.stringify(d.stars), sink: d.sink, scroll: d.scroll, road: JSON.stringify(d.roadside.slice(0, 5)) };
        await resize(s, 1920, 1080);
        await resize(s, W, H);
        expect({ seed: d.seed, stars: JSON.stringify(d.stars), sink: d.sink, scroll: d.scroll, road: JSON.stringify(d.roadside.slice(0, 5)) }).toEqual(keep);
      } finally {
        s.done();
      }
    });
  });

  // ── the pointer and clicks ────────────────────────────────────────────────

  // What lives there answers the pointer and clicks the sim is handed (runScene hands them over
  // only while the scene runs: the clock's test, below); each test steps the sim by hand.

  test("Skyline: the pointer resting by the buildings brings people to the windows nearest it, one after another, each lighting a window; moved off, they go in again; a click sends up a firework that bursts in the sky above it", async () => {
    for (let seed = 11; seed <= 20; seed++) {
      for (const resting of [true, false]) {
        await seeded(seed, async () => {
          const s = await scene("skyline");
          const c = s.sim;
          try {
            run(c, 2);
            const b = c.placed.find((p) => p.b.layer === 1 && p.b.c0 * c.cw > W * 0.3)!;
            const [px, py] = [(b.b.c0 + b.b.w / 2) * c.cw, (c.base - 8) * c.ch];
            c.point(px, py, resting);
            run(c, 4);
            if (!resting) {
              expect({ seed, lookers: c.lookers.length }).toEqual({ seed, lookers: 0 });
              return;
            }
            const since = c.lookers.map((l) => l.since).sort((a, b) => a - b);
            const far = c.lookers.map((l) => { const p = c.placed[l.place]!; const i = p.winKey.indexOf(l.key); return Math.hypot((p.winC[i]! + 0.5) * c.cw - px, (p.winR[i]! + 0.5) * c.ch - py); });
            // Over 24 seeds: 11 in 4 s, 0.37 s apart, all within 58 px; gone within 5 s of the
            // pointer leaving.
            expect({ seed, come: c.lookers.length >= 6, near: Math.max(...far) <= LOOK_REACH, oneByOne: since.slice(1).every((t, i) => t - since[i]! > 0.25) })
              .toEqual({ seed, come: true, near: true, oneByOne: true });
            c.point(W * 0.5, H * 0.05, false);
            run(c, 7);
            expect({ seed, left: c.lookers.length }).toEqual({ seed, left: 0 });
          } finally {
            s.done();
          }
        });
      }
    }

    // Resting high in the sky, beyond the reach of any window, it brings nobody.
    for (const seed of [11, 12, 13]) {
      await seeded(seed, async () => {
        const s = await scene("skyline");
        const c = s.sim;
        try {
          const [px, py] = [W / 2, H * 0.08];
          const nearest = Math.min(...windowsOf(c).map((w) => Math.hypot(w.x - px, w.y - py)));
          c.point(px, py, true);
          run(c, 4);
          expect({ seed, beyond: nearest > LOOK_REACH, lookers: c.lookers.length }).toEqual({ seed, beyond: true, lookers: 0 });
        } finally {
          s.done();
        }
      });
    }

    for (let seed = 21; seed <= 30; seed++) {
      await seeded(seed, async () => {
        const s = await scene("skyline");
        const c = s.sim;
        try {
          run(c, 60);
          expect({ seed, unasked: c.fireworks.length }).toEqual({ seed, unasked: 0 });
          const [x, y] = [W * (0.2 + 0.06 * (seed - 21)), H * 0.85];
          c.splash(x, y);
          const f = c.fireworks[0]!;
          run(c, f.rise + 0.8);
          let mx = 0;
          let spread = 0;
          for (let i = 0; i < f.sparks.length; i += 4) {
            mx += f.sparks[i]! / (f.sparks.length / 4);
            spread = Math.max(spread, Math.hypot(f.sparks[i]! - f.x, f.sparks[i + 1]! - f.y));
          }
          // Over 24 seeds: bursting 40 px over the roofs at least (and below 190), its sparks 68 px
          // out and more 0.8 s on, about the click's x within 4 px.
          expect({ seed, above: f.y < y && f.y < c.roofAt(x) - 30, spread: spread > 50, over: Math.abs(mx - x) < 15 }).toEqual({ seed, above: true, spread: true, over: true });
          for (let i = 0; i < 20; i++) c.splash(x, y);
          expect(c.fireworks.length).toBeLessThanOrEqual(MAX_FIREWORKS);
        } finally {
          s.done();
        }
      });
    }
  });

  test("Sunset Drive: the pointer leans the view, the sun and the horizon drifting toward it, and back when it goes; a click sends a pulse of light from it to the horizon, along the floor or down the sky", async () => {
    await seeded(61, async () => {
      const s = await scene("sunset");
      const d = s.sim;
      try {
        for (const [px, py, sx, sy] of [[W * 0.92, H * 0.85, 1, 1], [W * 0.05, H * 0.1, -1, -1]] as const) {
          const sun = d.sun();
          d.point(px, py, true);
          run(d, 3);
          // The vanishing point 0.84 of its lean that way within 3 s; the horizon toward the
          // pointer; back within 1.3 s of the pointer going.
          expect({ sun: (d.sun().x - sun.x) * sx > LEAN_X * W * 0.5, vanish: (d.vanish() - 0.5) * sx > LEAN_X * 0.6, horizon: (d.horizon() - HORIZON) * sy > 0.01 })
            .toEqual({ sun: true, vanish: true, horizon: true });
          d.point(px, py, false);
          run(d, 3);
          expect({ x: Math.abs(d.vanish() - 0.5) < LEAN_X * 0.1, y: Math.abs(d.horizon() - HORIZON) < 0.003 }).toEqual({ x: true, y: true });
        }
      } finally {
        s.done();
      }
    });
    for (const [x, y, kind] of [[W * 0.35, H * 0.85, "floor"], [W * 0.8, H * 0.7, "floor"], [W * 0.7, H * 0.2, "sky"]] as const) {
      await seeded(62, async () => {
        const s = await scene("sunset");
        const d = s.sim;
        try {
          d.splash(x, y);
          const p = d.pulses[0]!;
          const at = { x: 0, y: 0 };
          const ys: number[] = [];
          run(d, PULSE_LIFE, () => ys.push(d.pulseAt(p, at).y));
          const toward = ys.every((v, i) => i === 0 || (kind === "floor" ? v <= ys[i - 1]! + 1e-9 : v >= ys[i - 1]! - 1e-9));
          expect({ kind: p.kind, from: Math.abs(ys[0]! - y / H) < 0.02, toward, reaches: Math.abs(ys[ys.length - 1]! - d.horizon()) < 0.02 }).toEqual({ kind, from: true, toward: true, reaches: true });
          for (let i = 0; i < 10; i++) d.splash(x, y);
          expect(d.pulses.length).toBeLessThanOrEqual(MAX_PULSES);
        } finally {
          s.done();
        }
      });
    }
  });

  // ── the frame: the clock, the pointer, and nothing named ─────────────────

  /** Where what moves is: cars, planes and clouds, what is by the road and the floor's scroll. */
  const places = (sim: Sim) => JSON.stringify(
    sim instanceof City ? [sim.cars.map((c) => c.x.toFixed(2)), sim.planes.map((p) => p.x.toFixed(2)), sim.clouds.map((c) => c.x.toFixed(2))]
    : [(sim as Drive).roadside.map((t) => t.z.toFixed(4)), (sim as Drive).scroll.toFixed(4)],
  );
  const pointerOf = (sim: Sim) => (sim as unknown as { pointer: { active: boolean } }).pointer;
  /** Whether the scene has answered a click: a firework, a pulse. */
  const answered = (sim: Sim) => (sim instanceof City ? sim.fireworks.length > 0 : (sim as Drive).pulses.length > 0);

  test("held, a scene neither steps nor draws; still, it is one settled picture, drawn again where it is when the theme changes; the pointer and clicks stir it only while it runs; and whatever the app tells it of agents, tiles and turns done, it only ever says ready and drawn", async () => {
    const agents = { creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "needs-you" as const }], tiles: [{ x0: 100, y0: 100, x1: 500, y1: 400, id: "a1" }] };
    for (const name of NAMES) {
      await seeded(91, async () => {
        const s = await scene(name, agents);
        try {
          const was = places(s.sim);
          await new Promise((r) => setTimeout(r, 300));
          expect({ name, draws: s.seen.draws, still: places(s.sim) === was }).toEqual({ name, draws: 1, still: true });
          // Held, the pointer and a click are no one's: nothing there notices them.
          s.host.point(W / 2, H * 0.7);
          s.host.click(W / 2, H * 0.7);
          await s.host.settle();
          expect({ name, noticed: pointerOf(s.sim).active, answered: answered(s.sim) }).toEqual({ name, noticed: false, answered: false });
        } finally {
          s.done();
        }
      });
      await seeded(92, async () => {
        const s = await scene(name, { mode: "still" });
        try {
          const settled = places(s.sim);
          expect({ name, draws: s.seen.draws }).toEqual({ name, draws: 1 });
          s.host.send({ type: "look", look: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: places(s.sim) !== settled }).toEqual({ name, draws: 2, moved: false });
        } finally {
          s.done();
        }
      });
      await seeded(93, async () => {
        const s = await scene(name, { mode: "run", ...agents });
        try {
          s.host.send({ type: "done", id: "a1" });
          s.host.send({ type: "tiles", tiles: [{ x0: 0, y0: 0, x1: 700, y1: 500, id: "a1" }], seeThrough: true });
          for (const [x, y] of [[W * 0.3, H * 0.4], [W * 0.6, H * 0.8], [W * 0.5, H * 0.2]] as const) {
            s.host.point(x, y);
            await s.host.settle();
            expect({ name, noticed: pointerOf(s.sim).active }).toEqual({ name, noticed: true });
            expect(s.host.click(x, y)).toBe(null);
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

  test("an hour alone, clicked every few seconds and the pointer moving, each scene stays bounded: fireworks, people at windows, pulses and everything else capped, nothing piling up", async () => {
    for (const name of NAMES) {
      await seeded(97, async () => {
        const s = await scene(name);
        const sim = s.sim;
        try {
          const counts = () => sim instanceof City
            ? { fireworks: sim.fireworks.length <= MAX_FIREWORKS, sparks: sim.fireworks.every((f) => f.sparks.length <= 64 * 4), lookers: sim.lookers.length <= MAX_LOOKERS, cars: sim.cars.length, planes: sim.planes.length <= 2, clouds: sim.clouds.length, buildings: sim.buildings.length }
            : { pulses: (sim as Drive).pulses.length <= MAX_PULSES, roadside: (sim as Drive).roadside.length, stars: (sim as Drive).stars.length };
          const first = counts();
          let k = 0;
          let worst = first;
          run(sim, 3600, () => {
            k++;
            if (k % 120 === 0) sim.point(W * Math.random(), H * Math.random(), Math.random() < 0.8);
            if (k % 300 === 0) sim.splash(W * Math.random(), H * Math.random());
            if (k % 600 === 0) {
              const now = counts();
              if (JSON.stringify(now) !== JSON.stringify(first)) worst = now;
            }
          });
          expect({ name, at: worst }).toEqual({ name, at: first });
          expect(Object.values(first).every((v) => v !== false)).toBe(true);
        } finally {
          s.done();
        }
      });
    }
  }, 240_000);
});

// ── its colours, against the app's presets ──────────────────────────────────

const { PRESETS } = await core("settings-schema.ts");
/** A preset's colour (CSS), as the scenes' colours are: sRGB 0 to 255. */
const css = (s: string): Rgb => parseColor(s)!.rgb.map((v) => Math.round(v * 255)) as unknown as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as [number, number, number], b.map((v) => v / 255) as [number, number, number]);
/** `top` at `alpha` over `under`, as the page composites it. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
/** The Layers panel over a live wallpaper with See-through: its colour at a sixth (the app's
 *  SEE_THROUGH opacity, 0.5, at a third). */
const TINT = 0.5 / 3;
/** How a scene turned into characters (ascii.ts) shows its picture under them: at night dimmed to
 *  its style's `ground`, by day that far toward its paper. Sunset Drive shows its picture as it is. */
const shown = (style: { dark: boolean; ground: number; paper: Oklch } | null) => (c: Rgb): Rgb =>
  !style ? c : style.dark ? (c.map((v) => v * style.ground) as unknown as Rgb) : over(rgbOf(style.paper), style.ground, c);
/** Each scene's ground in its own colours, dark and light, as it is shown: its sky (each stop, and
 *  the glow over the last at its strongest), and the rest of what lies over wide stretches of the
 *  window. */
const GROUNDS: Record<SceneName, (look: "dark" | "light") => { sky: Rgb[]; rest: [string, Rgb][] }> = {
  skyline: (look) => {
    const p = SKYLINE_PALETTE[look];
    const show = shown(p.style);
    const sky = p.sky.map(rgbOf);
    return {
      sky: [...sky, over(rgbOf(p.glow.colour), p.glow.alpha, sky[sky.length - 1]!)].map(show),
      rest: [...Object.entries(p.face), ["back row", p.back], ["pavement", p.pavement], ["road", p.road]].map(([k, c]) => [k as string, show(rgbOf(c as Oklch))]),
    };
  },
  sunset: (look) => {
    const p = SUNSET_PALETTE[look];
    const sky = p.sky.map(rgbOf);
    return {
      sky: [...sky, over(rgbOf(p.glow.colour), p.glow.alpha, sky[sky.length - 1]!)],
      rest: [...p.ranges.map((c, i) => [`range ${i}`, rgbOf(c)] as [string, Rgb]), ["floor far", rgbOf(p.floor[0])], ["floor near", rgbOf(p.floor[1])]],
    };
  },
};

test("each scene's ground, in its own colours, keeps the frosted panels' text readable over it, dark and light: names at 7:1, details at 4.5:1, over the sky hints at 3:1 too, under its glow, the buildings, the street, the ranges and the floor", () => {
  for (const name of NAMES) {
    for (const [look, preset] of [["dark", "signal"], ["light", "clean-light"]] as const) {
      const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
      const { sky, rest } = GROUNDS[name](look);
      for (const [where, ground, hints] of [...sky.map((c, i) => [`sky ${i}`, c, true] as const), ...rest.map(([k, c]) => [k, c, false] as const)]) {
        const panel = over(css(bg2!), TINT, ground);
        expect({ name, look, where, names: contrast(css(fg!), panel) >= 7, details: contrast(css(fg2!), panel) >= 4.5, hints: !hints || contrast(css(fg3!), panel) >= 3 })
          .toEqual({ name, look, where, names: true, details: true, hints: true });
      }
    }
  }
});

test("Sunset Drive keeps its bright sun in the middle of the window and below its top fifth, however the view leans and wherever it is in its sinking, on a wide window and a tall one: the panels and toolbars stay over the dark sky", async () => {
  for (const [w, h] of [[1440, 900], [2560, 1080], [900, 1400]] as const) {
    await seeded(63, async () => {
      const s = await scene("sunset", { viewport: { w, h, dpr: 1 } });
      const d = s.sim;
      try {
        let left = 1;
        let right = 0;
        let top = 1;
        for (const [px, py] of [[0, 0], [w, 0], [0, h], [w, h]] as const) {
          d.point(px, py, true);
          for (let i = 0; i < 40; i++) {
            run(d, 7.5);
            const sun = d.sun();
            left = Math.min(left, (sun.x - sun.r) / w);
            right = Math.max(right, (sun.x + sun.r) / w);
            top = Math.min(top, (sun.y - sun.r) / h);
          }
        }
        // Measured: 0.23 to 0.77 across at most (a tall window), its top 0.28 down at least.
        expect({ w, h, left: left > 0.2, right: right < 0.8, top: top > 0.2 }).toEqual({ w, h, left: true, right: true, top: true });
      } finally {
        s.done();
      }
    });
  }
}, 120_000);

// ── the package, as the app and HiveHub read it ─────────────────────────────

const WALLPAPERS = ["skyline", "sunset"];
const NAMED: Record<string, string> = { skyline: "Skyline", sunset: "Sunset Drive" };

test("the app's package reader takes City as @dip497/city, holding its two live wallpapers by their names, and offers Skyline on install; none asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "city" });
  expect({ id: pkg.id, name: pkg.manifest.name, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/city", name: "City", members: WALLPAPERS.map((w) => ["wallpaper", `@dip497/city/${w}`, NAMED[w]]), startup: "@dip497/city/skyline" });
  for (const w of WALLPAPERS) expect({ w, colour: JSON.parse(readFileSync(path.join(PKG, "wallpapers", w, "hivemind-wallpaper.json"), "utf8")).colour }).toEqual({ w, colour: undefined });
});

test("HiveHub lists City as needing Hivemind 2026.10.8, each wallpaper sandboxed and asking for nothing, and installs each wallpaper's folder (its build, its picture, its face and licence) without the sources or the harness, within its limits", async () => {
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
    .toEqual(WALLPAPERS.map((w) => ["wallpaper", `@dip497/city/${w}`, "sandboxed", []]));
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const w of WALLPAPERS) {
    for (const f of ["dist/main.js", "hivemind-wallpaper.json", "preview.webp", "fonts/jetbrains-mono-latin-600-normal.woff2", "fonts/OFL.txt"]) expect(installs).toContain(`wallpapers/${w}/${f}`);
    const folder = files.filter((f) => f.path.startsWith(`wallpapers/${w}/`));
    const preview = folder.find((f) => f.path.endsWith("preview.webp"))!;
    // The picker's picture: 960×600 (a WebP's VP8 frame says its size), under 512 KB.
    const dv = new DataView(preview.bytes.buffer, preview.bytes.byteOffset);
    const vp8 = new TextDecoder().decode(preview.bytes.slice(12, 16));
    const size = vp8 === "VP8 " ? [dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff] : vp8 === "VP8L" ? [1 + (dv.getUint32(21, true) & 0x3fff), 1 + ((dv.getUint32(21, true) >> 14) & 0x3fff)] : [0, 0];
    expect({ w, size, small: preview.bytes.length < 512 * 1024, files: folder.every((f) => f.bytes.length <= 2 << 20), folder: folder.reduce((n, f) => n + f.bytes.length, 0) <= 8 << 20 })
      .toEqual({ w, size: [960, 600], small: true, files: true, folder: true });
  }
  expect(files.length).toBeLessThanOrEqual(200);
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

describe("City, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveScenes } = await import("../packages/city/harness/serve");
    server = await serveScenes();
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  const DARK = { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "'Not A Font Here', monospace" };
  async function open(scene: string, mode: "run" | "hold", dpr: number): Promise<{ page: Page; frame: Frame }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ scene, mode, look }) => window.start({ scene, mode, look }), { scene, mode, look: DARK });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 10_000 });
    return { page, frame: page.frames().find((f) => f.url().includes("/wp/"))! };
  }
  /** What the scene's canvas shows, as a number: copied to a canvas of the test's own, whether the
   *  scene draws it in 2D or WebGL. */
  const picture = (frame: Frame) => frame.evaluate(() => {
    const c = document.querySelector("canvas")!;
    const copy = new OffscreenCanvas(c.width, c.height).getContext("2d")!;
    copy.drawImage(c, 0, 0);
    const d = copy.getImageData(0, 0, c.width, c.height).data;
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
        expect(await frame.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "City Mono").map((f) => f.status))).toEqual(["loaded"]);
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

  test("every character a scene draws, at night and by day, at play and repainted, is in the face it brings; the check itself tells a character the face lacks (a box-drawing line, a half block)", async () => {
    const drawn = new Set<string>();
    for (const scene of WALLPAPERS) {
      const { page, frame } = await open(scene, "run", 1);
      try {
        // Every character it draws from here on, on the page's canvas or a layer it keeps.
        await frame.evaluate(() => {
          const seen = ((globalThis as unknown as { seen: Set<string> }).seen = new Set<string>());
          for (const proto of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
            const fill = proto.fillText;
            proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, max?: number) {
              for (const ch of text) seen.add(ch);
              return max === undefined ? fill.call(this, text, x, y) : fill.call(this, text, x, y, max);
            } as typeof proto.fillText;
          }
        });
        // Repainted at night (a resize), at play (the pointer, clicks), then by day, at play again.
        for (const look of [DARK, { ...DARK, page: "#f6f6f4", text: "#1d1f22", dark: false }]) {
          await page.evaluate((look) => window.host.send({ type: "look", look }), look);
          await page.evaluate(() => window.host.send({ type: "viewport", viewport: { w: 1200, h: 760, dpr: 1 } }));
          for (const [x, y] of [[400, 500], [700, 300], [900, 650]]) {
            await page.evaluate(([x, y]) => { window.host.point(x!, y!); window.host.click(x!, y!); }, [x, y]);
            await new Promise((r) => setTimeout(r, 500));
          }
          await new Promise((r) => setTimeout(r, 1500));
        }
        for (const ch of await frame.evaluate(() => [...(globalThis as unknown as { seen: Set<string> }).seen])) drawn.add(ch);
      } finally {
        await page.close();
      }
    }
    // A character is in the face when it draws differently in it than in the fallback alone.
    const page = await browser.newPage();
    try {
      await page.goto(server.url.href);
      const missing = await page.evaluate(async ({ url, chars }) => {
        const face = new FontFace("Probe", `url(${url})`, { weight: "600" });
        document.fonts.add(await face.load());
        const g = new OffscreenCanvas(64, 64).getContext("2d")!;
        const shape = (font: string, ch: string) => {
          g.clearRect(0, 0, 64, 64);
          g.font = font;
          g.fillText(ch, 8, 48);
          return g.getImageData(0, 0, 64, 64).data.join();
        };
        return chars.filter((ch) => ch.trim() && shape("600 40px Probe, monospace", ch) === shape("600 40px monospace", ch));
      }, { url: new URL("/wp/skyline/fonts/jetbrains-mono-latin-600-normal.woff2", server.url).href, chars: [...drawn, "─", "▀", "⣿"] });
      // Over the two scenes: every character Skyline's picture turns into, its fireworks and its street.
      expect({ drew: drawn.size > 20, missing }).toEqual({ drew: true, missing: ["─", "▀", "⣿"] });
    } finally {
      await page.close();
    }
  }, 120_000);
});
