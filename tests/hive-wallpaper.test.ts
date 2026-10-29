// Bees, the Hive package's live wallpaper: its scene run through the SDK's fakeWallpaperHost, as the
// app connects it, with the randomness seeded and no canvas (the drawing gets the meadow and keeps
// it); its colours measured against the app's own presets; the package read by the app's package
// reader and HiveHub's check; and its build loaded in Chromium the way the app serves it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import type { WallpaperCreature, WallpaperTile } from "../types/view-sdk/wallpaper";
import { prng } from "../packages/hive/src/bees/ground";
import type { Bee, Meadow } from "../packages/hive/src/bees/meadow";
import { BEE_PALETTE, MONO } from "../packages/hive/src/bees/palette";
import { mix, rgbOf, type Rgb } from "../packages/hive/src/bees/colour";
import { contrast as ratio, rgbOf as cssRgb } from "./colour";
import { startBees } from "../packages/hive/src/bees/scene";

const PKG = path.join(ROOT, "packages/hive");
const W = 1440;
const H = 900;
const STEP = 1 / 60;

// ── the scene, through the SDK's fake host ──────────────────────────────────

/** Five agents of three programs, in all four states, as the harness shows them. */
const CREATURES: WallpaperCreature[] = [
  { id: "c1", agent: "claude", kind: 0.05, size: 1, state: "needs-you" },
  { id: "c2", agent: "claude", kind: 0.05, size: 0.86, state: "working" },
  { id: "c3", agent: "codex", kind: 0.2, size: 0.92, state: "ready" },
  { id: "c4", agent: "codex", kind: 0.2, size: 0.8, state: "resting" },
  { id: "c5", agent: "pi", kind: 0.55, size: 0.95, state: "working" },
];

/** Run `fn` with Math.random seeded: the flight's wander, the flowers chosen. */
async function seeded<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const real = Math.random;
  Math.random = prng(seed);
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}

/** Bees connected to a fake host as the app would connect it, drawn by nothing: the drawing is
 *  handed the meadow each frame and keeps it, so a test reads where everything is. */
async function bees(opts: FakeWallpaperOptions) {
  const host = fakeWallpaperHost({ viewport: { w: W, h: H, dpr: 1 }, ...opts });
  const wp = await host.connect();
  const seen = { draws: 0, meadow: null as Meadow | null };
  const stop = startBees(wp, { resize() {}, setLook() {}, setTiles() {}, draw(m) { seen.draws++; seen.meadow = m; } });
  await host.settle();
  for (let i = 0; i < 20 && !seen.meadow; i++) await new Promise((r) => setTimeout(r, 25));
  const meadow = seen.meadow!;
  return { host, seen, meadow, bee: (id: string) => meadow.bees.find((b) => b.id === id)!, done: () => { stop(); host.close(); } };
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const meets = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
/** How far apart two boxes are, 0 when they meet. */
const apart = (a: Box, b: Box) => Math.hypot(Math.max(0, a.x0 - b.x1, b.x0 - a.x1), Math.max(0, a.y0 - b.y1, b.y0 - a.y1));
/** Which side of `tile` the box is on, wholly, or null. */
function sideOf(box: Box, tile: Box): string | null {
  if (box.x1 <= tile.x0) return "left";
  if (box.x0 >= tile.x1) return "right";
  if (box.y1 <= tile.y0) return "above";
  if (box.y0 >= tile.y1) return "below";
  return null;
}

/** Its agent's tile, and another, so that one side is clearly the open one. */
const LAYOUTS: { open: string; tiles: WallpaperTile[] }[] = [
  // Another tile along the bottom: the open side is the left.
  { open: "left", tiles: [{ x0: 900, y0: 100, x1: 1400, y1: 600, id: "c1" }, { x0: 200, y0: 620, x1: 1300, y1: 860, id: "c2" }] },
  // Another tile hard against its left: the right.
  { open: "right", tiles: [{ x0: 500, y0: 200, x1: 900, y1: 700, id: "c1" }, { x0: 60, y0: 150, x1: 480, y1: 750, id: "c2" }] },
  // Wide, and another down its right: below.
  { open: "below", tiles: [{ x0: 100, y0: 80, x1: 1340, y1: 420, id: "c1" }, { x0: 1360, y0: 80, x1: 1430, y1: 880, id: "c2" }] },
  // Low and wide: above.
  { open: "above", tiles: [{ x0: 300, y0: 500, x1: 1200, y1: 880, id: "c1" }] },
];

describe("Bees", () => {
  test("a still frame puts each bee where its state has it: the one that needs you on the open side of its own tile, clear of every tile; the resting one on the hive; the working ones on flowers; the ready one hovering over the hive", async () => {
    for (const seed of [1, 2, 3]) {
      for (const { open, tiles } of LAYOUTS) {
        await seeded(seed, async () => {
          const s = await bees({ mode: "still", creatures: CREATURES, tiles });
          try {
            const { meadow } = s;
            const { cw } = meadow.grid;
            const where = `seed ${seed}, open ${open}`;
            const calling = meadow.boxOf(s.bee("c1"));
            expect({ where, side: sideOf(calling, tiles[0]!), under: tiles.filter((t) => meets(calling, t)).length }).toEqual({ where, side: open, under: 0 });
            // Beside it: within a few cells, so it reads as that tile's.
            expect({ where, near: apart(calling, tiles[0]!) < cw * 12 }).toEqual({ where, near: true });
            const hive = meadow.ground!.where.box;
            const resting = s.bee("c4");
            expect({ where, landed: resting.landed, inHive: resting.x > hive.x0 && resting.x < hive.x1 && resting.y > hive.y0 && resting.y < hive.y1 }).toEqual({ where, landed: true, inHive: true });
            // Each working bee sits on top of a flower's head: above its stem, a cell or two over its top.
            for (const id of ["c2", "c5"]) {
              const b = s.bee(id);
              const on = meadow.ground!.flowers.find((f) => Math.abs(b.x - (f.c + 0.5) * cw) <= cw * 2.5 && b.y < (f.foot - f.height + 1) * meadow.grid.ch && b.y > (f.foot - f.height - 3) * meadow.grid.ch);
              expect({ where, id, landed: b.landed, onFlower: !!on }).toEqual({ where, id, landed: true, onFlower: true });
            }
            const ready = s.bee("c3");
            expect({ where, overHive: ready.y < hive.y0 && Math.abs(ready.x - (hive.x0 + hive.x1) / 2) < (hive.x1 - hive.x0) * 2 }).toEqual({ where, overHive: true });
          } finally {
            s.done();
          }
        });
      }
    }
  });

  test("the bee that needs you flies there from the hive within 5 s and holds on its tile's open side, clear of every tile, all of the next 10 s; moved with its tile, it is beside it again within 4 s", async () => {
    for (const seed of [11, 12, 13, 14]) {
      await seeded(seed, async () => {
        const { tiles } = LAYOUTS[0]!;
        // Held: nothing steps but the test, 1/60 s at a time.
        const s = await bees({ mode: "hold", creatures: CREATURES.map((c) => (c.id === "c1" ? { ...c, state: "ready" } : c)), tiles });
        try {
          const { host, meadow } = s;
          const beside = (tile: Box, open: string) => {
            const box = meadow.boxOf(s.bee("c1"));
            return sideOf(box, tile) === open && apart(box, tile) < meadow.grid.cw * 12 && !tiles.some((t) => t !== tiles[0] && meets(box, t)) && !meets(box, tile);
          };
          host.send({ type: "creatures", creatures: CREATURES });
          await host.settle();
          let arrived = -1;
          for (let i = 0; i < 5 / STEP && arrived < 0; i++) {
            meadow.step(STEP);
            if (beside(tiles[0]!, "left")) arrived = i * STEP;
          }
          expect({ seed, arrived: arrived >= 0 }).toEqual({ seed, arrived: true });
          let held = 0;
          for (let i = 0; i < 10 / STEP; i++) {
            meadow.step(STEP);
            if (beside(tiles[0]!, "left")) held++;
          }
          expect({ seed, held: held / (10 / STEP) }).toEqual({ seed, held: 1 });
          // Its tile moved to the middle, with room all round: beside it again soon.
          const moved = { x0: 500, y0: 250, x1: 900, y1: 550, id: "c1" };
          host.send({ type: "tiles", tiles: [moved], seeThrough: true });
          await host.settle();
          let again = -1;
          for (let i = 0; i < 4 / STEP && again < 0; i++) {
            meadow.step(STEP);
            const box = meadow.boxOf(s.bee("c1"));
            if (sideOf(box, moved) && apart(box, moved) < meadow.grid.cw * 12) again = i * STEP;
          }
          expect({ seed, again: again >= 0 }).toEqual({ seed, again: true });
        } finally {
          s.done();
        }
      });
    }
  });

  test("bees keep out from under the tiles: with one tile between the flowers and the hive and another over it, four at work, one ready and one calling are under a tile less than 0.2% of 40 s (it measures at most 0.03%, and 0.4% to 0.7% with no way round a tile)", async () => {
    const tiles: WallpaperTile[] = [{ x0: 400, y0: 120, x1: 900, y1: 470, id: "c1" }, { x0: 560, y0: 560, x1: 860, y1: 900, id: "c2" }, { x0: 40, y0: 380, x1: 420, y1: 640 }];
    const roster: WallpaperCreature[] = [
      ...CREATURES.filter((c) => c.state !== "resting"),
      { id: "c6", agent: "amp", kind: 0.9, size: 0.9, state: "working" },
      { id: "c7", agent: "pi", kind: 0.55, size: 0.85, state: "working" },
    ];
    for (const seed of [21, 22, 23, 24, 25]) {
      await seeded(seed, async () => {
        const s = await bees({ mode: "hold", creatures: roster, tiles });
        try {
          let under = 0;
          let seen = 0;
          for (let i = 0; i < 40 / STEP; i++) {
            s.meadow.step(STEP);
            for (const b of s.meadow.bees) {
              seen++;
              if (tiles.some((t) => b.x > t.x0 && b.x < t.x1 && b.y > t.y0 && b.y < t.y1)) under++;
            }
          }
          expect({ seed, under: under / seen < 0.002 }).toEqual({ seed, under: true });
        } finally {
          s.done();
        }
      });
    }
  });

  test("the pointer over a bee names its agent, a cell off its body too, and over the open air nothing; a click in the open scatters the small bees near it and not those far off", async () => {
    await seeded(31, async () => {
      const s = await bees({ mode: "still", creatures: CREATURES, tiles: LAYOUTS[0]!.tiles });
      try {
        const { host, meadow } = s;
        const { cw } = meadow.grid;
        const at = async (x: number, y: number) => {
          host.point(x, y);
          await host.settle();
          return host.hovered;
        };
        for (const b of meadow.bees) expect({ id: b.id, at: await at(b.x, b.y) }).toEqual({ id: b.id, at: b.id });
        const calling = meadow.boxOf(s.bee("c1"));
        expect(await at(calling.x0 - cw * 0.9, (calling.y0 + calling.y1) / 2)).toBe("c1");
        expect(await at(calling.x0 - cw * 4, (calling.y0 + calling.y1) / 2)).toBe(null);
        expect(host.refused).toEqual([]);
      } finally {
        s.done();
      }
    });
    await seeded(32, async () => {
      // Running, for the scatter: a click in the meadow, away from every bee.
      const s = await bees({ mode: "run", creatures: [], tiles: [] });
      try {
        const { host, meadow } = s;
        const x = W / 2;
        const y = H - 80;
        const before = meadow.drones.map((d) => ({ near: !d.inside && Math.hypot(d.x - x, d.y - y) < 150, far: !d.inside && Math.hypot(d.x - x, d.y - y) > 260 }));
        expect(host.click(x, y)).toBe(null);
        await host.settle();
        const fled = meadow.drones.map((d, i) => ({ ...before[i]!, flees: d.flee > 0, away: (d.x - x) * d.vx + (d.y - y) * d.vy > 0 }));
        expect(fled.filter((d) => d.near).length).toBeGreaterThan(0);
        expect(fled.filter((d) => d.near && !(d.flees && d.away))).toEqual([]);
        expect(fled.filter((d) => d.far && d.flees)).toEqual([]);
      } finally {
        s.done();
      }
    });
  });

  test("held, it neither steps nor draws; still, one settled frame, and when one agent changes state only its bee moves", async () => {
    await seeded(41, async () => {
      const s = await bees({ mode: "run", creatures: CREATURES, tiles: LAYOUTS[0]!.tiles });
      try {
        const { host, seen, meadow } = s;
        host.send({ type: "mode", mode: "hold" });
        await host.settle();
        const was = { draws: seen.draws, time: meadow.time };
        await new Promise((r) => setTimeout(r, 300));
        expect({ draws: seen.draws, time: meadow.time }).toEqual(was);
      } finally {
        s.done();
      }
    });
    await seeded(42, async () => {
      const s = await bees({ mode: "still", creatures: CREATURES, tiles: LAYOUTS[0]!.tiles });
      try {
        const { host, seen, meadow } = s;
        expect(seen.draws).toBe(1);
        const places = () => Object.fromEntries([...meadow.bees.map((b: Bee) => [b.id, `${b.x.toFixed(1)},${b.y.toFixed(1)}`]), ...meadow.drones.map((d, i) => [`drone ${i}`, `${d.x.toFixed(1)},${d.y.toFixed(1)}`])]);
        const before = places();
        host.send({ type: "creatures", creatures: CREATURES.map((c) => (c.id === "c3" ? { ...c, state: "working" } : c)) });
        await host.settle();
        expect(seen.draws).toBe(2);
        const after = places();
        expect(Object.keys(before).filter((k) => before[k] !== after[k])).toEqual(["c3"]);
        // A turn done in a still frame is not shown: a loop frozen mid-air would be a smudge.
        host.send({ type: "done", id: "c5" });
        await host.settle();
        expect(s.bee("c5").loop).toBe(0);
      } finally {
        s.done();
      }
    });
  });

  test("a bee whose agent closes flies home into the hive and is gone within 15 s; a new agent's bee comes out of the hive door", async () => {
    await seeded(51, async () => {
      const s = await bees({ mode: "hold", creatures: CREATURES, tiles: LAYOUTS[0]!.tiles });
      try {
        const { host, meadow } = s;
        host.send({ type: "creatures", creatures: [...CREATURES.filter((c) => c.id !== "c2"), { id: "c6", agent: "amp", kind: 0.9, size: 0.9, state: "working" }] });
        await host.settle();
        const door = meadow.ground!.where.door;
        const born = s.bee("c6");
        expect(Math.hypot(born.x - door.x, born.y - door.y)).toBeLessThan(2);
        let gone = -1;
        for (let i = 0; i < 15 / STEP && gone < 0; i++) {
          meadow.step(STEP);
          if (!meadow.bees.some((b) => b.id === "c2")) gone = i * STEP;
        }
        expect(gone).toBeGreaterThan(0);
        // On its way it was never one the pointer could name: its agent is gone.
        expect(meadow.bees.map((b) => b.id).sort()).toEqual(["c1", "c3", "c4", "c5", "c6"]);
      } finally {
        s.done();
      }
    });
  });
});

// ── its colours, against the app's presets ──────────────────────────────────

const { PRESETS } = await core("settings-schema.ts");
const LIGHT = (PRESETS["clean-light"] as { mode?: string } | undefined)?.mode === "light";
/** A preset's colour (CSS), as the scene's colours are: sRGB 0 to 255. */
const oklch = (s: string): Rgb => cssRgb(s).map((v) => Math.round(v * 255)) as unknown as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as [number, number, number], b.map((v) => v / 255) as [number, number, number]);
/** `top` at `alpha` over `under`, as the page composites it. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
/** The Layers panel over a live wallpaper with See-through: its colour at a sixth (the app's
 *  SEE_THROUGH opacity, 0.5, at a third). */
const TINT = 0.5 / 3;
const looks = [["dark", "signal"], ...(LIGHT ? [["light", "clean-light"]] : [])] as const;

test("its own colours keep the frosted panels' text readable: over every stop of its sky and its sun's glow, names at 7:1, details at 4.5:1 and hints at 3:1; over every colour its ground is drawn in, names at 4.5:1", () => {
  for (const [mode, preset] of looks) {
    const p = BEE_PALETTE[mode];
    const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
    const panel = (under: Rgb) => over(oklch(bg2!), TINT, under);
    const stops = p.sky.map(rgbOf);
    for (const [i, sky] of [...stops, over(rgbOf(p.glow.colour), p.glow.alpha, stops[stops.length - 1]!)].entries()) {
      const where = `${mode}, ${i < stops.length ? `sky stop ${i}` : "the glow"}`;
      expect({ where, names: contrast(oklch(fg!), panel(sky)) >= 7, details: contrast(oklch(fg2!), panel(sky)) >= 4.5, hints: contrast(oklch(fg3!), panel(sky)) >= 3 })
        .toEqual({ where, names: true, details: true, hints: true });
    }
    for (const k of ["hillFar", "hillNear", "far", "near", "stem", "straw", "coil", "shade", "rim", "board", "door"] as const) {
      expect({ where: `${mode}, ${k}`, names: contrast(oklch(fg!), panel(rgbOf(p[k]))) >= 4.5 }).toEqual({ where: `${mode}, ${k}`, names: true });
    }
  }
});

test("in the theme's two colours, every tone its ground is drawn in keeps the frosted panels' names at 4.5:1, on a dark preset and a light one", () => {
  const tones = [MONO.hillFar, MONO.hillNear, MONO.far, MONO.near, [MONO.stem], MONO.petal, MONO.heart, MONO.straw, MONO.coil, MONO.shade, MONO.rim, MONO.board].flat();
  for (const [mode, preset] of looks) {
    const { bg, bg2, fg } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
    for (const t of tones) {
      const ground = mix(oklch(bg!), oklch(fg!), t);
      expect({ mode, t, names: contrast(oklch(fg!), over(oklch(bg2!), TINT, ground)) >= 4.5 }).toEqual({ mode, t, names: true });
    }
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

const WALLPAPERS = existsSync(path.join(APP, "packages/hive-core/src/wallpaper-folder.ts"));
const NO_WALLPAPERS = "skipped: the app at HIVEMIND_APP has no live wallpaper member (packages/hive-core/src/wallpaper-folder.ts)";
const withWallpapers = (name: string) => (WALLPAPERS ? name : `${name} (${NO_WALLPAPERS})`);
if (!WALLPAPERS) console.log(`hive-wallpaper: ${NO_WALLPAPERS}, so the rows read by the app do not run.`);

test.skipIf(!WALLPAPERS)(withWallpapers("the app's package reader takes Hive as @dip497/hive, holding the live wallpaper @dip497/hive/bees named Bees, which it offers on install"), async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "hive" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/hive", members: [["wallpaper", "@dip497/hive/bees", "Bees"]], startup: "@dip497/hive/bees" });
});

test.skipIf(!WALLPAPERS || !existsSync(path.join(APP, "packages/hive-hub/src/since.ts")))(withWallpapers("HiveHub lists Hive as needing Hivemind 2026.10.8, its wallpaper sandboxed and asking for nothing, and leaves its sources and harness out of what installs"), async () => {
  const { checkPluginFolder } = await import(path.join(APP, "packages/hive-hub/src/plugin-checks.ts"));
  const { packageFiles, checkPackageManifest } = await import(path.join(APP, "packages/hive-hub/src/package-format.ts"));
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (e.name !== "shots") walk(at); } else files.push({ path: at, bytes: new Uint8Array(readFileSync(path.join(PKG, at))) });
    }
  };
  walk("");
  const c = await checkPluginFolder(files);
  expect("problem" in c ? c.problem : null).toBe(null);
  expect(c.plugin.minAppVersion).toBe("2026.10.8");
  expect(c.plugin.members.map((m: { kind: string; id: string; runs: string; permissions: string[] }) => [m.kind, m.id, m.runs, m.permissions])).toEqual([["wallpaper", "@dip497/hive/bees", "sandboxed", []]]);
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => !f.startsWith("wallpapers/bees/") && f !== "hivemind-package.json" && f !== "README.md")).toEqual([]);
  expect(installs).toContain("wallpapers/bees/dist/main.js");
  expect(installs.filter((f: string) => /\.ts$|harness|scripts/.test(f))).toEqual([]);
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

describe("Bees, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveBees } = await import("../packages/hive/harness/serve");
    server = await serveBees();
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function open(mode: "run" | "hold" | "still", dpr: number): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ creatures, mode }) => window.start({
      look: { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "monospace" },
      mode, creatures: creatures as never, tiles: [{ x0: 300, y0: 100, x1: 800, y1: 450, id: "c1" }], seeThrough: true,
      chrome: { bg2: "#202226", fg: "#eeeeee", fg2: "#cccccc", fg3: "#999999", line: "#333333" },
    }), { creatures: CREATURES, mode });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 10_000 });
    return page;
  }

  test("it says it speaks protocol 1 and that its first frame is up, names nothing it was not sent, and draws a canvas the viewport's size times its pixel ratio", async () => {
    const page = await open("run", 2);
    try {
      await new Promise((r) => setTimeout(r, 600));
      const said = await page.evaluate(() => ({ received: window.host.received.map((m) => m.type).filter((t, i, a) => a.indexOf(t) === i), refused: window.host.refused }));
      expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
      const canvas = await page.frames()[1]!.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
      expect(canvas).toEqual([2560, 1600, 1280, 800]);
    } finally {
      await page.close();
    }
  }, 60_000);

  test("running it draws about 30 frames a second; held, none at all", async () => {
    const page = await open("run", 1);
    try {
      await new Promise((r) => setTimeout(r, 300));
      const count = () => page.evaluate(() => window.frameTimes.length);
      const a = await count();
      await new Promise((r) => setTimeout(r, 1000));
      const running = (await count()) - a;
      expect(running).toBeGreaterThan(15);
      expect(running).toBeLessThan(40);
      await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
      await new Promise((r) => setTimeout(r, 200));
      const b = await count();
      await new Promise((r) => setTimeout(r, 1000));
      expect((await count()) - b).toBe(0);
    } finally {
      await page.close();
    }
  }, 60_000);
});
