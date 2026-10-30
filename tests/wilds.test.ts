// Wilds, the package of three live wallpapers drawn in characters (Autumn Wood, Dunes, Campfire):
// each scene run through the SDK's fakeWallpaperHost as the app connects it (runScene), with the
// randomness seeded and no canvas (its drawing is a stand-in that counts frames); its colours
// measured against the app's own presets; the package read by the app's package reader and
// HiveHub's check; and its build loaded in Chromium the way the app serves it. Each bar sits clear
// of what 24 seeds measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import { runScene, type Sim } from "../packages/wilds/src/scene";
import { seeded } from "../packages/wilds/src/num";
import { mix, rgbOf, type Rgb } from "../packages/wilds/src/colour";
import type { SkyLook } from "../packages/wilds/src/sky";
import { BREEZE, FLURRY, PILE_ROWS, Wood } from "../packages/wilds/src/autumn/forest";
import { AUTUMN_PALETTE } from "../packages/wilds/src/autumn/palette";
import { BURST_MAX, DEVIL_HIGH, Desert } from "../packages/wilds/src/dunes/sands";
import { DUNES_PALETTE } from "../packages/wilds/src/dunes/palette";
import { Camp, SMOKE, SPARKS } from "../packages/wilds/src/campfire/camp";
import { CAMPFIRE_PALETTE } from "../packages/wilds/src/campfire/palette";

const PKG = path.join(ROOT, "packages/wilds");
// A minute or two of each scene on a few seeds, and an hour of each, take a few seconds.
setDefaultTimeout(120_000);
const W = 1440;
const H = 900;
const STEP = 1 / 60;

/** Run `fn` with Math.random seeded: the flutter, the gusts' grains, the sparks. */
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
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const SCENES = { autumn: () => new Wood(), dunes: () => new Desert(), campfire: () => new Camp() } as const;
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

/** Where everything that moves in a scene is, as one string: what a held or still picture must
 *  keep. */
function places(sim: Sim) {
  const f = (n: number) => n.toFixed(2);
  if (sim instanceof Wood) return JSON.stringify([sim.leaves.map((l) => [f(l.x), f(l.y)]), sim.walker && f(sim.walker.x), [...sim.pile].map(f)]);
  if (sim instanceof Desert) return JSON.stringify([sim.stream.map((g) => [f(g.x), f(g.y)]), f(sim.caravan.x), f(sim.devil.x), sim.burst.length]);
  const c = sim as Camp;
  return JSON.stringify([c.sparks.map((s) => [f(s.x), f(s.y)]), c.smoke.map((s) => [f(s.x), f(s.y)]), f(c.heat.reduce((a, b) => a + b, 0)), c.logs.length]);
}

// ── what lives there ────────────────────────────────────────────────────────

describe("Wilds", () => {
  test("each scene is full from its first frame, spread over the window, and holds more life in a bigger one", async () => {
    const counts: Record<string, number[]> = {};
    const count = (what: string, n: number) => (counts[what] ??= []).push(n);
    for (const [w, h] of [[1024, 640], [1440, 900], [2560, 1440]] as const) {
      for (const seed of [1, 2, 3]) {
        await withSeed(seed, async () => {
          const where = `${w}×${h} seed ${seed}`;
          // Held: its first frame is drawn without a step.
          const a = await scene("autumn", { viewport: { w, h, dpr: 1 } });
          const d = await scene("dunes", { viewport: { w, h, dpr: 1 } });
          const c = await scene("campfire", { viewport: { w, h, dpr: 1 } });
          try {
            expect({ where, draws: [a, d, c].map((s) => s.seen.draws) }).toEqual({ where, draws: [1, 1, 1] });
            // Autumn Wood: leaves all through the air (over 24 seeds across 90% to 99% of the width
            // and 85% to 96% of the height, in all four quarters), a pile along the whole floor (its
            // shallowest 1.1 rows), a beast partway across, a big tree at each edge.
            const wood = a.sim;
            const xs = wood.leaves.map((l) => l.x);
            const ys = wood.leaves.map((l) => l.y);
            const near = wood.layout.trees.filter((t) => t.near).map((t) => t.c / wood.grid.cols);
            expect({
              where,
              wide: Math.max(...xs) - Math.min(...xs) > w * 0.8,
              tall: Math.max(...ys) - Math.min(...ys) > h * 0.7,
              quarters: new Set(wood.leaves.map((l) => `${l.x < w / 2}${l.y < h / 2}`)).size,
              pile: Math.min(...wood.pile) > 0.5,
              beast: !!wood.walker && wood.walker.x > 0 && wood.walker.x < w,
              edges: near.some((x) => x < 0.12) && near.some((x) => x > 0.88),
            }).toEqual({ where, wide: true, tall: true, quarters: 4, pile: true, beast: true, edges: true });
            // Dunes: sand streaming off crests from one side of the window to the other (over 24
            // seeds 70% of the window's grains, across 97% of it and more), the caravan on its
            // ridge, the dunes filling the window under the horizon.
            const desert = d.sim;
            const sx = desert.stream.map((g) => g.x);
            expect({
              where,
              streaming: desert.stream.length >= desert.streamCap * 0.5,
              across: Math.max(...sx) - Math.min(...sx) > w * 0.85,
              caravan: desert.caravanAt().filter((m) => m.x > 0 && m.x < w).length >= 4,
              sand: Math.max(...desert.layout.skyline) < desert.grid.rows * 0.55,
            }).toEqual({ where, streaming: true, across: true, caravan: true, sand: true });
            // Campfire: the fire caught (over 24 seeds, 95 to 436 cells burning hot by the window's
            // size), sparks and smoke rising off it, crickets across the clearing.
            const camp = c.sim;
            const f = camp.fireAt();
            const kx = camp.layout.crickets.map((k) => k.c * camp.grid.cw);
            expect({
              where,
              burning: [...camp.heat.slice(0, camp.fw * camp.fh)].filter((v) => v > 0.3).length > camp.fw * camp.fh * 0.15,
              sparks: camp.sparks.length >= 20,
              smoke: camp.smoke.length >= 10,
              crickets: Math.max(...kx) - Math.min(...kx) > w * 0.8,
              lowMiddle: f.x > w * 0.4 && f.x < w * 0.6 && f.base > h * 0.75 && f.base < h * 0.92,
            }).toEqual({ where, burning: true, sparks: true, smoke: true, crickets: true, lowMiddle: true });
            if (seed === 1) {
              count("autumn leaves", wood.leaves.length);
              count("autumn trees", wood.layout.trees.length);
              count("dunes grains", desert.stream.length);
              count("campfire crickets", camp.layout.crickets.length);
              count("campfire fire", camp.fw * camp.fh);
            }
          } finally {
            for (const s of [a, d, c]) s.done();
          }
        });
      }
    }
    // A bigger window: more leaves and trees, more sand in the air, more crickets and a bigger fire.
    for (const [what, n] of Object.entries(counts)) expect({ what, more: n[0]! < n[1]! && n[1]! < n[2]! }).toEqual({ what, more: true });
  });

  test("a resize keeps each world where it was, fitted to the new window", async () => {
    await withSeed(4, async () => {
      for (const name of NAMES) {
        const s = await scene(name);
        try {
          run(s.sim, 3);
          // Shares of the window, before and after.
          const share = () => {
            // A smaller window holds fewer leaves (the last come go first) and fewer trees further
            // back (the outermost slots go first): what stays is compared.
            if (s.sim instanceof Wood) {
              const trees = s.sim.layout.trees;
              return { things: s.sim.leaves.map((l) => [l.x / s.sim.width, l.y / s.sim.height]), trees: [...trees.slice(0, 2), ...trees.filter((t) => t.near)].map((t) => t.c / s.sim.grid.cols), more: s.sim.walker ? [s.sim.walker.x / s.sim.width] : [] };
            }
            if (s.sim instanceof Desert) return { things: s.sim.stream.map((g) => [g.x / s.sim.width, g.y / s.sim.height]), trees: [], more: [s.sim.caravan.x] };
            const c = s.sim as Camp;
            return { things: c.sparks.map((p) => [p.x / c.width, p.y / c.height]), trees: [c.fireAt().x / c.width], more: [c.heat.reduce((a, b) => a + b, 0) / c.heat.length] };
          };
          const before = share();
          s.host.send({ type: "viewport", viewport: { w: 1024, h: 700, dpr: 1 } });
          await s.host.settle();
          const after = share();
          const close = (a: number[], b: number[], tol: number) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]!) < tol);
          expect({
            name,
            things: after.things.length > 0 && after.things.length <= before.things.length && after.things.every((p, i) => close(p, before.things[i]!, 1e-9)),
            // Trees and the fire stand where they stood, to a cell or so; the caravan keeps its
            // place along the land; the fire its heat (a fifth either way).
            trees: close(before.trees, after.trees, 0.02),
            more: name === "campfire" ? Math.abs(after.more[0]! / before.more[0]! - 1) < 0.2 : close(before.more, after.more, 1e-9),
          }).toEqual({ name, things: true, trees: true, more: true });
        } finally {
          s.done();
        }
      }
    });
  });

  // ── the pointer and clicks ────────────────────────────────────────────────

  // What lives there answers the pointer and clicks the sim is handed (runScene hands them over
  // only while the scene runs: the clock's test, below); each test steps the sim by hand.

  test("Autumn Wood: the pointer's breeze swirls the falling leaves round it, and a click shakes the nearest tree loose of a flurry of leaves", async () => {
    const swirl: number[] = [];
    const still: number[] = [];
    for (let seed = 11; seed <= 20; seed++) {
      for (const on of [true, false]) {
        await withSeed(seed, async () => {
          const s = await scene("autumn");
          const wood = s.sim;
          try {
            run(wood, 2);
            const [px, py] = [W * 0.5, H * 0.45];
            wood.point(px, py, on);
            run(wood, 1);
            // How fast the leaves near it go round it, one way: leaves just falling past turn as
            // much one way as the other.
            let turned = 0;
            let n = 0;
            const was = new Map<object, number>();
            run(wood, 3, () => {
              for (const l of wood.leaves) {
                if (Math.hypot(l.x - px, l.y - py) > BREEZE) {
                  was.delete(l);
                  continue;
                }
                const a = Math.atan2(l.y - py, l.x - px);
                const p = was.get(l);
                if (p !== undefined) {
                  turned += Math.atan2(Math.sin(a - p), Math.cos(a - p));
                  n++;
                }
                was.set(l, a);
              }
            });
            (on ? swirl : still).push((turned / Math.max(1, n)) / STEP);
          } finally {
            s.done();
          }
        });
      }
    }
    // Over 24 seeds, 0.47 to 0.68 rad/s round a resting pointer; -0.2 to 0.18 without one.
    expect({ each: Math.min(...swirl) > 0.33, without: Math.max(...still.map(Math.abs)) < 0.3 }).toEqual({ each: true, without: true });

    for (const seed of [21, 22, 23]) {
      await withSeed(seed, async () => {
        const s = await scene("autumn");
        const wood = s.sim;
        try {
          run(wood, 2);
          const { cw, ch } = wood.grid;
          for (const t of wood.layout.trees) {
            // A click just inside the edge of each crown.
            const [x, y] = [(t.cx + (t.side ? -t.side : 1) * t.rx * 0.8) * cw, t.cy * ch];
            wood.splash(x, y);
            run(wood, 0.1);
            const flurry = wood.leaves.filter((l) => l.flurry && l.tree === t.id);
            const y0 = flurry.map((l) => l.y);
            // Over 24 seeds the tree clicked by, and no other, swayed hard (0.8) a tenth of a second
            // on, and all of its 36 leaves were lower or landed 1.5 s on.
            expect({ seed, tree: t.id, hard: wood.shake(t.id).hard > 0.5, others: wood.layout.trees.filter((o) => o !== t).every((o) => wood.shake(o.id).hard === 0), flurry: flurry.length })
              .toEqual({ seed, tree: t.id, hard: true, others: true, flurry: FLURRY });
            run(wood, 1.5);
            expect({ seed, tree: t.id, fell: flurry.filter((l, k) => !wood.leaves.includes(l) || l.y > y0[k]! + 20).length / flurry.length > 0.9 }).toEqual({ seed, tree: t.id, fell: true });
            run(wood, 1.5);
          }
        } finally {
          s.done();
        }
      });
    }
  });

  test("Dunes: a dust devil follows the pointer, whirling sand up round it, and dies away when it goes; a click's gust bursts sand up and out, and it settles back", async () => {
    for (let seed = 31; seed <= 36; seed++) {
      await withSeed(seed, async () => {
        const s = await scene("dunes");
        const desert = s.sim;
        try {
          run(desert, 1);
          expect(desert.devil.strength).toBe(0);
          desert.point(W * 0.3, H * 0.7, true);
          run(desert, 2);
          desert.point(W * 0.6, H * 0.65, true);
          run(desert, 3);
          const lifted = desert.devil.grains.filter((g) => desert.whirlAt(g).y < desert.devil.y - DEVIL_HIGH * 0.5).length / desert.devil.grains.length;
          // Over 24 seeds: 1.3 px from the pointer 3 s after it moved, whirling at full strength,
          // a third to a half of its grains over half its height.
          expect({ seed, by: Math.hypot(desert.devil.x - W * 0.6, desert.devil.y - H * 0.65) < 20, strength: desert.devil.strength, lifted: lifted > 0.25 })
            .toEqual({ seed, by: true, strength: 1, lifted: true });
          desert.point(0, 0, false);
          run(desert, 2);
          expect({ seed, gone: desert.devil.strength }).toEqual({ seed, gone: 0 });

          const [x, y] = [W * 0.5, H * 0.72];
          desert.splash(x, y);
          run(desert, 0.3);
          const out = mean(desert.burst.map((b) => Math.hypot(b.x - x, b.y - y)));
          const up = desert.burst.filter((b) => b.y < y).length / desert.burst.length;
          let secs = 0.3;
          while (desert.burst.length && secs < 10) {
            run(desert, 0.1);
            secs += 0.1;
          }
          // Over 24 seeds: 26 to 31 px out on average after 0.3 s, 62% to 78% of it above the
          // click; all of it settled and gone 2.1 s to 2.3 s after.
          expect({ seed, out: out > 18, up: up > 0.5, settled: secs < 4 }).toEqual({ seed, out: true, up: true, settled: true });
        } finally {
          s.done();
        }
      });
    }
  });

  test("Campfire: the flames lean toward the pointer and the sparks drift to it; a click drops a log in, and the fire flares with a burst of sparks", async () => {
    const lean = { on: [] as number[], off: [] as number[] };
    const drift = { on: [] as number[], off: [] as number[] };
    for (let seed = 41; seed <= 48; seed++) {
      for (const on of [true, false]) {
        await withSeed(seed, async () => {
          const s = await scene("campfire");
          const camp = s.sim;
          try {
            run(camp, 2);
            const f = camp.fireAt();
            camp.point(f.x + W * 0.2, f.top, on);
            // Where the flames' heat is across the fire (cells right of its middle), and where the
            // sparks are (px right of it), over three seconds.
            let across = 0;
            let n = 0;
            let dx = 0;
            let sparks = 0;
            run(camp, 3, () => {
              let sum = 0;
              let at = 0;
              for (let r = 0; r < camp.fh / 2; r++) {
                for (let c = 0; c < camp.fw; c++) {
                  sum += camp.heatAt(c, r);
                  at += camp.heatAt(c, r) * c;
                }
              }
              if (sum > 0) {
                across += at / sum - (camp.fw - 1) / 2;
                n++;
              }
              for (const p of camp.sparks) {
                dx += p.x - f.x;
                sparks++;
              }
            });
            lean[on ? "on" : "off"].push(across / n);
            drift[on ? "on" : "off"].push(dx / Math.max(1, sparks));
          } finally {
            s.done();
          }
        });
      }
    }
    // Over 24 seeds: the flames' top half 4.1 to 4.6 cells toward a pointer to the right, -0.25 to
    // 0.13 without; the sparks 27 px to 64 px toward it on average, -19 to 14 px without.
    expect({ lean: Math.min(...lean.on) > 2.5, still: Math.max(...lean.off.map(Math.abs)) < 1, drift: Math.min(...drift.on) > 15, without: Math.max(...drift.off.map(Math.abs)) < 25 })
      .toEqual({ lean: true, still: true, drift: true, without: true });

    for (let seed = 49; seed <= 54; seed++) {
      await withSeed(seed, async () => {
        const s = await scene("campfire");
        const camp = s.sim;
        try {
          run(camp, 2);
          const total = () => camp.heat.slice(0, camp.fw * camp.fh).reduce((a, b) => a + b, 0);
          let before = 0;
          run(camp, 1, () => { before += total(); });
          const sparks = camp.sparks.length;
          const f = camp.fireAt();
          camp.splash(f.x - 200, f.top);
          // A log in the air, falling in from the click's side.
          expect({ seed, thrown: camp.logs.length, side: camp.logs[0]!.side, falling: camp.logs[0]!.fall < 1 }).toEqual({ seed, thrown: 1, side: -1, falling: true });
          run(camp, 0.6);
          const added = camp.sparks.length - sparks;
          let after = 0;
          run(camp, 1, () => { after += total(); });
          // Over 24 seeds: landed 0.47 s on; 48 to 61 sparks more; the fire's heat 1.5 to 1.65
          // times what it was over the next second.
          expect({ seed, landed: camp.logs[0]!.fall, sparks: added > 30, flare: after / before > 1.35 }).toEqual({ seed, landed: 1, sparks: true, flare: true });
        } finally {
          s.done();
        }
      });
    }
  });

  // ── the clock, the pointer, and nothing named ─────────────────────────────

  const pointerOf = (sim: Sim) => (sim as unknown as { pointer: { active: boolean } }).pointer;
  /** Whether the scene has answered a click: a tree shaken, a gust of sand, a log thrown on. */
  const answered = (sim: Sim) =>
    sim instanceof Wood ? sim.shaken.some((t) => t > -Infinity) : sim instanceof Desert ? sim.burst.length > 0 : (sim as Camp).logs.length > 0;

  test("held, a scene neither steps nor draws; still, it is one settled picture, drawn again where it is when the theme or the window changes; the pointer and clicks stir it only while it runs; and nothing it draws is ever named", async () => {
    const agents: FakeWallpaperOptions = {
      creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "needs-you" }],
      tiles: [{ x0: 100, y0: 100, x1: 500, y1: 400, id: "a1" }],
    };
    for (const name of NAMES) {
      await withSeed(91, async () => {
        const s = await scene(name, agents);
        try {
          const was = places(s.sim);
          await new Promise((r) => setTimeout(r, 300));
          expect({ name, draws: s.seen.draws, still: places(s.sim) === was }).toEqual({ name, draws: 1, still: true });
          // Held, the pointer and a click are no one's: nothing notices them.
          s.host.point(W / 2, H / 2);
          s.host.click(W / 2, H / 2);
          await s.host.settle();
          expect({ name, noticed: pointerOf(s.sim).active, answered: answered(s.sim) }).toEqual({ name, noticed: false, answered: false });
        } finally {
          s.done();
        }
      });
      await withSeed(92, async () => {
        const s = await scene(name, { mode: "still" });
        try {
          const settled = places(s.sim);
          expect({ name, draws: s.seen.draws }).toEqual({ name, draws: 1 });
          s.host.send({ type: "look", look: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: places(s.sim) !== settled }).toEqual({ name, draws: 2, moved: false });
          s.host.send({ type: "viewport", viewport: { w: W, h: H, dpr: 2 } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: places(s.sim) !== settled }).toEqual({ name, draws: 3, moved: false });
        } finally {
          s.done();
        }
      });
      await withSeed(93, async () => {
        const s = await scene(name, { mode: "run", ...agents });
        try {
          s.host.point(W * 0.4, H * 0.5);
          await s.host.settle();
          expect({ name, noticed: pointerOf(s.sim).active }).toEqual({ name, noticed: true });
          s.host.send({ type: "done", id: "a1" });
          expect(s.host.click(W * 0.4, H * 0.5)).toBe(null);
          s.host.click(120, 150);
          await s.host.settle();
          expect({ name, answered: answered(s.sim) }).toEqual({ name, answered: true });
          await new Promise((r) => setTimeout(r, 100));
          // It speaks protocol 1 and says its first frame is up, in that order; and nothing else:
          // no creature under the pointer, ever.
          expect({ name, said: [...new Set(s.host.received.map((m) => m.type))], refused: s.host.refused, hovered: s.host.hovered })
            .toEqual({ name, said: ["ready", "drawn"], refused: [], hovered: null });
        } finally {
          s.done();
        }
      });
    }
  });

  test("an hour alone, with the pointer coming and going and a click every ten seconds, each scene stays within its bounds and still lives", async () => {
    await withSeed(95, async () => {
      for (const name of NAMES) {
        const s = await scene(name);
        const sim = s.sim;
        try {
          const most: Record<string, number> = {};
          const note = (k: string, v: number) => { most[k] = Math.max(most[k] ?? -Infinity, v); };
          for (let sec = 0; sec < 3600; sec++) {
            sim.point(W * (0.5 + 0.4 * Math.sin(sec * 0.01)), H * (0.5 + 0.3 * Math.cos(sec * 0.013)), sec % 600 < 300);
            if (sec % 10 === 0) sim.splash(W * Math.random(), H * (0.3 + 0.6 * Math.random()));
            run(sim, 1);
            if (sim instanceof Wood) {
              note("leaves", sim.leaves.length);
              note("pile", Math.max(...sim.pile));
            } else if (sim instanceof Desert) {
              note("stream", sim.stream.length);
              note("burst", sim.burst.length);
            } else {
              const c = sim as Camp;
              note("sparks", c.sparks.length);
              note("smoke", c.smoke.length);
              note("logs", c.logs.length);
              note("heat", Math.max(...c.heat));
            }
          }
          // Over two seeds of an hour: Autumn Wood at most twice its calm leaves (186 of 93) and a
          // pile no deeper than its cap; Dunes at its cap of streaming grains and 111 burst ones;
          // Campfire 98 sparks, 46 puffs, 2 fresh logs, heat 1.4 at the coals.
          if (sim instanceof Wood) {
            expect({ name, leaves: most.leaves! <= sim.calm * 2, pile: most.pile! <= PILE_ROWS, alive: sim.leaves.filter((l) => !l.flurry).length === sim.calm && mean([...sim.pile]) > 1 })
              .toEqual({ name, leaves: true, pile: true, alive: true });
          } else if (sim instanceof Desert) {
            expect({ name, stream: most.stream! <= sim.streamCap, burst: most.burst! <= BURST_MAX, alive: sim.stream.length > sim.streamCap * 0.2 && sim.caravanAt().length === 6 })
              .toEqual({ name, stream: true, burst: true, alive: true });
          } else {
            const c = sim as Camp;
            expect({ name, sparks: most.sparks! <= SPARKS, smoke: most.smoke! <= SMOKE, logs: most.logs! <= 2, heat: Number.isFinite(most.heat) && most.heat! <= 1.5, alive: [...c.heat.slice(0, c.fw * c.fh)].filter((v) => v > 0.3).length > 50 })
              .toEqual({ name, sparks: true, smoke: true, logs: true, heat: true, alive: true });
          }
        } finally {
          s.done();
        }
      }
    });
  });
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
/** The sky's colour a share `y` down the window, as its gradient has it. */
function skyAt(look: SkyLook, y: number): Rgb {
  const s = look.sky.map(rgbOf);
  const t = Math.min(1, Math.max(0, y)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(t));
  return over(s[i + 1]!, t - i, s[i]!);
}
/** Each scene's ground, light theme and dark: what lies under the panels over most of the window. */
function grounds(name: SceneName, mode: "dark" | "light"): [string, Rgb, boolean][] {
  const look = { autumn: AUTUMN_PALETTE, dunes: DUNES_PALETTE, campfire: CAMPFIRE_PALETTE }[name][mode];
  const out: [string, Rgb, boolean][] = look.sky.map((c, i) => [`sky ${i}`, rgbOf(c), true]);
  // The glow (a low sun, the moon, the last of the day) at its brightest.
  if (look.glow) out.push(["the glow", over(rgbOf(look.glow.colour), look.glow.alpha, skyAt(look, look.glow.y)), false]);
  if (name === "autumn") {
    const p = AUTUMN_PALETTE[mode];
    // The mist's body at its thickest, over the sky low down; the forest floor.
    out.push(["the mist", over(rgbOf(p.mist), p.mistAlpha * 0.4, skyAt(p, 0.86)), false], ["the floor", rgbOf(p.floor[0]), true]);
  } else if (name === "dunes") {
    const p = DUNES_PALETTE[mode];
    // The sand's blocks from its deepest shade to its brightest, as the renderer draws them.
    const [lo, hi] = mode === "dark" ? [0, 0.75] : [0.15, 1];
    out.push(["sand in shade", mix(rgbOf(p.shade), rgbOf(p.lit), lo), true], ["sand in the light", mix(rgbOf(p.shade), rgbOf(p.lit), hi), true]);
  } else {
    const p = CAMPFIRE_PALETTE[mode];
    // The clearing's grass, and as warm as the firelight bakes it at its brightest (the flames and
    // their glow are the fire, in the lower middle, not ground).
    out.push(["the grass", rgbOf(p.grass[0]), true], ["the grass by the fire", mix(rgbOf(p.grass[0]), rgbOf(p.firelight), p.warmth * 0.3), false]);
  }
  return out;
}

test("each scene's ground, in its own colours, keeps the frosted panels' text readable over it, night and day: names at 7:1, details at 4.5:1, hints at 3:1 over the sky and the ground", () => {
  for (const name of NAMES) {
    for (const [mode, preset] of [["dark", "signal"], ["light", "clean-light"]] as const) {
      const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
      for (const [what, ground, hints] of grounds(name, mode)) {
        const where = `${name} ${mode}, ${what}`;
        const panel = over(css(bg2!), TINT, ground);
        expect({ where, names: contrast(css(fg!), panel) >= 7, details: contrast(css(fg2!), panel) >= 4.5, hints: !hints || contrast(css(fg3!), panel) >= 3 })
          .toEqual({ where, names: true, details: true, hints: true });
      }
    }
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

const WALLPAPERS = ["autumn", "dunes", "campfire"];
const NAMED: Record<string, string> = { autumn: "Autumn Wood", dunes: "Dunes", campfire: "Campfire" };
const FACE = "fonts/jetbrains-mono-latin-600-normal.woff2";

test("the app's package reader takes Wilds as @dip497/wilds, holding the three live wallpapers by their names, and offers Autumn Wood on install; none asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "wilds" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/wilds", members: WALLPAPERS.map((w) => ["wallpaper", `@dip497/wilds/${w}`, NAMED[w]]), startup: "@dip497/wilds/autumn" });
  for (const w of WALLPAPERS) expect({ w, colour: JSON.parse(readFileSync(path.join(PKG, "wallpapers", w, "hivemind-wallpaper.json"), "utf8")).colour }).toEqual({ w, colour: undefined });
});

test("HiveHub lists Wilds as needing Hivemind 2026.10.8, each wallpaper sandboxed and asking for nothing, and installs each wallpaper's folder (its build, picture, face and licence) without the sources or the harness", async () => {
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
    .toEqual(WALLPAPERS.map((w) => ["wallpaper", `@dip497/wilds/${w}`, "sandboxed", []]));
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const w of WALLPAPERS) {
    for (const f of ["dist/main.js", "hivemind-wallpaper.json", "preview.webp", FACE, "fonts/OFL.txt"]) expect(installs).toContain(`wallpapers/${w}/${f}`);
  }
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

/** The characters a woff2 face has a glyph for: its cmap, read from the font's one compressed
 *  stream of tables (WOFF2 keeps cmap as it is). */
function faceCovers(file: string): Set<string> {
  const buf = readFileSync(file);
  const tags = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB"];
  let p = 48;
  const varint = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const b = buf[p++]!;
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v >>> 0;
  };
  let at = 0;
  let cmap = -1;
  for (let i = 0, n = buf.readUInt16BE(12); i < n; i++) {
    const flags = buf[p++]!;
    let tag = tags[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      tag = buf.toString("latin1", p, p + 4);
      p += 4;
    }
    const orig = varint();
    const transformed = tag === "glyf" || tag === "loca" ? (flags >> 6) === 0 : (flags >> 6) !== 0;
    const length = transformed ? varint() : orig;
    if (tag === "cmap") cmap = at;
    at += length;
  }
  const data = brotliDecompressSync(buf.subarray(p));
  const covers = new Set<string>();
  for (let i = 0, n = data.readUInt16BE(cmap + 2); i < n; i++) {
    const sub = cmap + data.readUInt32BE(cmap + 8 + i * 8);
    if (data.readUInt16BE(sub) !== 4) continue;
    const seg = data.readUInt16BE(sub + 6) / 2;
    const ends = sub + 14;
    const starts = ends + seg * 2 + 2;
    const deltas = starts + seg * 2;
    const ranges = deltas + seg * 2;
    for (let k = 0; k < seg; k++) {
      const [start, end, delta, range] = [data.readUInt16BE(starts + k * 2), data.readUInt16BE(ends + k * 2), data.readInt16BE(deltas + k * 2), data.readUInt16BE(ranges + k * 2)];
      for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
        const glyph = range ? data.readUInt16BE(ranges + k * 2 + range + (cp - start) * 2) : (cp + delta) & 0xffff;
        if (glyph) covers.add(String.fromCodePoint(cp));
      }
    }
  }
  return covers;
}

describe("Wilds, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveScenes } = await import("../packages/wilds/harness/serve");
    server = await serveScenes();
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => {
    await browser?.close();
    server?.stop(true);
  });

  const DARK = { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "'Not A Font Here', monospace" };
  async function openBuilt(scene: string, mode: "run" | "hold", dpr: number): Promise<{ page: Page; frame: Frame }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    // Every character the scene draws, in its own frame too.
    await page.addInitScript(() => {
      const seen = new Set<string>();
      (globalThis as unknown as { drawnGlyphs: Set<string> }).drawnGlyphs = seen;
      for (const C of [globalThis.CanvasRenderingContext2D, globalThis.OffscreenCanvasRenderingContext2D]) {
        const real = C.prototype.fillText;
        C.prototype.fillText = function (text: string, x: number, y: number, max?: number) {
          for (const ch of String(text)) seen.add(ch);
          return max === undefined ? real.call(this, text, x, y) : real.call(this, text, x, y, max);
        };
      }
    });
    await page.goto(server.url.href);
    await page.evaluate(({ scene, mode, look }) => window.start({ scene, mode, look }), { scene, mode, look: DARK });
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
    test(`${NAMED[scene]}: in its sandboxed frame it says it speaks protocol 1 and then that its first frame is up, and nothing else; draws a canvas the viewport's size times its pixel ratio, in the face it brings, every character it draws in that face; moves while it runs and not while held`, async () => {
      const { page, frame } = await openBuilt(scene, "run", 2);
      try {
        // Night, then day, with the pointer about and a click: what each draws.
        for (const dark of [true, false]) {
          if (!dark) await page.evaluate((look) => window.host.send({ type: "look", look }), { ...DARK, dark: false, page: "#f6f6f4", text: "#1d1f22" });
          for (let i = 0; i < 8; i++) {
            await page.evaluate((i) => window.host.point(400 + i * 60, 520 - i * 20), i);
            await new Promise((r) => setTimeout(r, 90));
          }
          await page.evaluate(() => window.host.click(640, 560));
          await new Promise((r) => setTimeout(r, 700));
        }
        const said = await page.evaluate(() => ({ received: window.host.received.map((m) => m.type), refused: window.host.refused }));
        expect({ order: [...new Set(said.received)], refused: said.refused }).toEqual({ order: ["ready", "drawn"], refused: [] });
        const canvas = await frame.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
        expect(canvas).toEqual([2560, 1600, 1280, 800]);
        // Its own face, from its own folder: the person's font is not in the frame.
        expect(await frame.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Wilds Mono").map((f) => f.status))).toEqual(["loaded"]);
        const drawn = await frame.evaluate(() => [...(globalThis as unknown as { drawnGlyphs: Set<string> }).drawnGlyphs].join(""));
        const covers = faceCovers(path.join(PKG, "wallpapers", scene, FACE));
        expect({ some: drawn.length > 10, missing: [...drawn].filter((ch) => !covers.has(ch)).join("") }).toEqual({ some: true, missing: "" });
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
