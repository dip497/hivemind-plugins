// Den, the package of the Den live wallpaper and the Den pup widget. The yard (what the pups do)
// runs alone with its randomness seeded, over a layout with a side panel and two agents' tiles; the
// whole wallpaper runs through the SDK's fakeWallpaperHost as the app connects it, drawn by a
// stand-in that counts; the package is read by the app's package reader and HiveHub's check; and
// its build is loaded in Chromium the way the app serves it. Each bar sits clear of what 20 seeds
// measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { fakeWallpaperHost } from "../types/view-sdk/testing";
import type { WallpaperCreature, WallpaperTile } from "../types/view-sdk";
import { SLANT, Yard, type Pup } from "../packages/den/src/den/yard";
import { runDen, type Drawer } from "../packages/den/src/den/scene";

setDefaultTimeout(60_000);
const PKG = path.join(ROOT, "packages/den");
const W = 1440;
const H = 900;
const STEP = 1 / 60;
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);

const prng = (a: number) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// A side panel down the left, the tile of the agent that needs you, and a ready agent's tile.
const TILES: WallpaperTile[] = [
  { x0: 0, y0: 0, x1: 260, y1: 900 },
  { x0: 500, y0: 140, x1: 950, y1: 480, id: "c" },
  { x0: 1000, y0: 520, x1: 1380, y1: 820, id: "b" },
];
const agent = (id: string, state: WallpaperCreature["state"], kind = 0.2): WallpaperCreature => ({ id, agent: "claude", kind, size: 1, state });
const FIRST = [agent("a", "working"), agent("b", "ready", 0.4), agent("e", "working", 0.8)];
const ALL = [...FIRST, agent("c", "needs-you"), agent("d", "resting", 0.6)];

/** A yard of three agents, joined a second later by one that needs you and one at rest. */
function yard(seed: number) {
  const y = new Yard(prng(seed));
  y.resize(W, H);
  y.setTiles(TILES);
  y.meet(FIRST);
  run(y, 1);
  y.meet(ALL);
  return y;
}
const run = (y: Yard, secs: number, each?: (t: number) => void) => {
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    y.step(STEP);
    each?.(i * STEP);
  }
};
/** The point of a pup a glance finds: its head, above its feet, toward where it faces. */
const head = (y: Yard, p: Pup) => ({ x: p.x + Math.cos(p.heading) * 0.35 * y.unit * p.size, y: p.y - 0.55 * y.unit * p.size });
const underTile = (pt: { x: number; y: number }) => TILES.some((b) => pt.x > b.x0 && pt.x < b.x1 && pt.y > b.y0 && pt.y < b.y1);

describe("Den: the yard", () => {
  test("a pup whose agent needs you runs to the open side of its tile and holds there, play-bowing: beside it from 6 s on, all the time, on every seed", () => {
    for (const seed of SEEDS) {
      const y = yard(seed);
      let near = 0, n = 0, bowing = 0;
      const c = () => y.pups.get("c")!;
      run(y, 20, (t) => {
        if (t < 6) return;
        const spot = y.visitSpot(TILES[1]!, c());
        n++;
        if (Math.hypot(c().x - spot.x, c().y - spot.y) < 0.5 * y.unit) near++;
        if (c().act === "bow") bowing++;
      });
      // Measured: 100% on all 20 seeds.
      expect({ seed, near: near / n > 0.95, bowing: bowing / n > 0.9 }).toEqual({ seed, near: true, bowing: true });
      // And it is beside the tile, not on it: the open side here is the left (more room there).
      const spot = y.visitSpot(TILES[1]!, c());
      expect({ seed, left: spot.x < TILES[1]!.x0, onIt: underTile(head(y, c())) }).toEqual({ seed, left: true, onIt: false });
    }
  });

  test("pups keep their heads out from under the tiles and the panel: under one less than 0.5% of the time over half a minute", () => {
    for (const seed of SEEDS) {
      const y = yard(seed);
      let under = 0, all = 0;
      run(y, 30, () => {
        for (const p of y.pups.values()) {
          if (p.leaving) continue;
          all++;
          if (underTile(head(y, p))) under++;
        }
      });
      // Measured: 0 on all 20 seeds.
      expect({ seed, ok: under / all < 0.005 }).toEqual({ seed, ok: true });
    }
  });

  test("the first picture gives each pup a place of its own: the one that needs you by its tile, those at rest along the bottom, the others round them, no two within 1.2 units of ground", () => {
    const more = [...ALL, agent("f", "working", 0.1), agent("g", "ready", 0.9)];
    for (const seed of SEEDS) {
      const y = new Yard(prng(seed));
      y.resize(W, H);
      y.setTiles(TILES);
      y.meet(more);
      const ps = [...y.pups.values()];
      let gap = Infinity;
      for (const p of ps) for (const o of ps) if (o !== p) gap = Math.min(gap, Math.hypot(p.x - o.x, (p.y - o.y) / SLANT) / y.unit);
      // Measured: 1.44 at the closest over 20 seeds; placed as they came, 0.12.
      expect({ seed, ok: gap > 1.2 }).toEqual({ seed, ok: true });
    }
  });

  test("a pup whose agent rests goes down to the bottom fifth of the window and curls up asleep there, going round tiles that are in its way", () => {
    for (const seed of SEEDS) {
      const y = yard(seed);
      let asleepAt = -1;
      run(y, 45, (t) => {
        const d = y.pups.get("d")!;
        if (asleepAt < 0 && d.act === "sleep" && d.y > H * 0.8) asleepAt = t;
      });
      // Measured: asleep at the bottom by 30 s on every seed (most by 8 s; the slowest walks all
      // round a tile because the gap between two is too narrow for it).
      expect({ seed, asleep: asleepAt >= 0 }).toEqual({ seed, asleep: true });
    }
  });

  test("a pup whose agent is gone walks out of the window and is dropped, within 8 s", () => {
    for (const seed of SEEDS) {
      const y = yard(seed);
      run(y, 10);
      y.meet(ALL.filter((c) => c.id !== "e"));
      let t = 0;
      while (y.pups.has("e") && t < 12) { y.step(STEP); t += STEP; }
      // Measured: 1.5 to 5.1 s.
      expect({ seed, gone: !y.pups.has("e"), quick: t < 8 }).toEqual({ seed, gone: true, quick: true });
    }
  });

  test("rubbing the pointer back and forth over a pup pets it: it sits for it, and bounces up when the rubbing stops", () => {
    for (const seed of SEEDS) {
      const y = yard(seed);
      run(y, 8);
      const b = y.pups.get("b")!;
      let petted = 0;
      for (let i = 0; i < 120; i++) {
        y.point(b.x + (i % 2 ? 6 : -6), b.y - 0.35 * y.unit, true);
        y.step(STEP);
        if (b.act === "pet") petted++;
      }
      y.point(0, 0, false);
      let bounced = false;
      for (let i = 0; i < 120; i++) { y.step(STEP); if (b.hop > 0.02) bounced = true; }
      // Measured: petted 88% of the two seconds on every seed.
      expect({ seed, petted: petted / 120 > 0.6, bounced, after: b.act !== "pet" }).toEqual({ seed, petted: true, bounced: true, after: true });
    }
  });

  test("a click on open ground drops a ball, and the free pup with the shortest way there runs and pounces on it within 10 s", () => {
    for (const seed of SEEDS) {
      const y = yard(seed);
      run(y, 10);
      y.click(W * 0.55, H * 0.75, null);
      expect(y.ball).not.toBe(null);
      let t = 0;
      while (y.ball && t < 14) { y.step(STEP); t += STEP; }
      // Measured: 0.2 to 7.2 s (the slowest runs all round a tile).
      expect({ seed, caught: y.ball === null && t < 10 }).toEqual({ seed, caught: true });
    }
  });

  test("hover finds the pup under the pointer, by its body: on a pup its id, on open ground none", () => {
    const y = yard(3);
    run(y, 10);
    for (const p of y.pups.values()) expect(y.hit(p.x, p.y - 0.35 * y.unit * p.size)).toBe(p.id);
    expect(y.hit(W - 20, 30)).toBe(null);
  });
});

// ── the wallpaper as the app runs it ────────────────────────────────────────

/** The Den on a fake host, drawn by a stand-in that counts its frames. */
async function den(opts: Parameters<typeof fakeWallpaperHost>[0]) {
  const host = fakeWallpaperHost({ viewport: { w: W, h: H, dpr: 1 }, ...opts });
  const wp = await host.connect();
  const y = new Yard(prng(5));
  const seen = { draws: 0, steps: 0, settles: 0 };
  const drawer: Drawer = { resize() {}, setLook() {}, step() { seen.steps++; }, settle() { seen.settles++; }, draw() { seen.draws++; } };
  const stop = runDen(wp, y, drawer);
  await host.settle();
  return { host, y, seen, done: () => { stop(); host.close(); } };
}

describe("Den: on the app's clock", () => {
  test("held, it neither steps nor draws after its first frame; still, it is one settled picture in which only a pup whose state changed moves", async () => {
    const held = await den({ mode: "hold", creatures: ALL, tiles: TILES });
    try {
      await new Promise((r) => setTimeout(r, 400));
      expect({ draws: held.seen.draws, steps: held.seen.steps }).toEqual({ draws: 1, steps: 0 });
    } finally {
      held.done();
    }
    const still = await den({ mode: "still", creatures: ALL, tiles: TILES });
    try {
      const at = () => new Map([...still.y.pups.values()].map((p) => [p.id, `${p.x.toFixed(1)},${p.y.toFixed(1)}`]));
      const before = at();
      expect(still.seen.draws).toBe(1);
      // The resting agent gets to work: its pup moves; the others stay where they were.
      still.host.send({ type: "creatures", creatures: ALL.map((c) => (c.id === "d" ? { ...c, state: "working" } : c)) });
      await still.host.settle();
      const after = at();
      const moved = [...after].filter(([id, xy]) => before.get(id) !== xy).map(([id]) => id);
      expect({ moved, draws: still.seen.draws }).toEqual({ moved: ["d"], draws: 2 });
      // Settled: the pup that needs you is by its tile, bowing; the resting... is at work now.
      const c = still.y.pups.get("c")!;
      expect(c.act).toBe("bow");
    } finally {
      still.done();
    }
  });

  test("it says only that it is ready and drawn, and hover names the pup under the pointer, so a click there opens that agent's tile", async () => {
    const s = await den({ mode: "run", creatures: ALL, tiles: TILES });
    try {
      await new Promise((r) => setTimeout(r, 200));
      const c = s.y.pups.get("c")!;
      s.host.point(c.x, c.y - 0.35 * s.y.unit * c.size);
      await s.host.settle();
      expect(s.host.hovered).toBe("c");
      expect(s.host.click(c.x, c.y - 0.35 * s.y.unit * c.size)).toBe("c");
      await s.host.settle();
      expect({ said: [...new Set(s.host.received.map((m) => m.type))].sort(), refused: s.host.refused }).toEqual({ said: ["drawn", "hover", "ready"], refused: [] });
    } finally {
      s.done();
    }
  });
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

test("the app's package reader takes Den as @dip497/den, holding the Den wallpaper and the Den pup widget, and offers the wallpaper on install; the wallpaper asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "den" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]).sort(), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/den", members: [["wallpaper", "@dip497/den/den", "Den"], ["widget", "@dip497/den-pup", "Den pup"]], startup: "@dip497/den/den" });
  expect(JSON.parse(readFileSync(path.join(PKG, "wallpapers/den/hivemind-wallpaper.json"), "utf8")).colour).toBe(true);
});

test("HiveHub lists Den, both members sandboxed and asking for nothing, and installs the wallpaper's build with three.js's licence and the widget, without the sources, the shared pup model, the game or the harness; no file over 2 MB", async () => {
  const { checkPluginFolder } = await import(path.join(APP, "packages/hive-hub/src/plugin-checks.ts"));
  const { packageFiles, checkPackageManifest } = await import(path.join(APP, "packages/hive-hub/src/package-format.ts"));
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === "out" || e.name === "node_modules" || e.name === "three.module.js") continue;
      if (e.isDirectory()) walk(at);
      else files.push({ path: at, bytes: new Uint8Array(readFileSync(path.join(PKG, at))) });
    }
  };
  walk("");
  const c = await checkPluginFolder(files);
  expect("problem" in c ? c.problem : null).toBe(null);
  expect(c.plugin.members.map((m: { kind: string; id: string; runs: string; permissions: string[] }) => [m.kind, m.id, m.runs, m.permissions]).sort())
    .toEqual([["wallpaper", "@dip497/den/den", "sandboxed", []], ["widget", "@dip497/den-pup", "sandboxed", []]]);
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\/|^pup\/|^game\//.test(f))).toEqual([]);
  for (const f of ["wallpapers/den/dist/main.js", "wallpapers/den/hivemind-wallpaper.json", "wallpapers/den/preview.webp", "wallpapers/den/LICENSE", "widgets/den-pup/widget.json", "widgets/den-pup/widget.js", "widgets/den-pup/pup.webp"]) expect(installs).toContain(f);
  for (const f of installs) expect({ f, small: statSync(path.join(PKG, f)).size <= 2 << 20 }).toEqual({ f, small: true });
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

describe("Den, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveDen } = await import("../packages/den/harness/serve");
    server = await serveDen();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  test("in its sandboxed frame it says it speaks protocol 1 and that its first frame is up, and nothing it was not asked; draws a canvas the viewport's size times its pixel ratio; moves while it runs and not while held", async () => {
    const page = await browser.newPage({ viewport: { width: 960, height: 600 }, deviceScaleFactor: 2 });
    try {
      await page.goto(server.url.href);
      const look = { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "monospace" };
      await page.evaluate(({ look, creatures, tiles }) => window.start({ scene: "den", mode: "run", look, creatures, tiles }), {
        look, creatures: ALL, tiles: [{ x0: 0, y0: 0, x1: 160, y1: 600 }, { x0: 330, y0: 100, x1: 640, y1: 320, id: "c" }],
      });
      await page.waitForFunction(() => window.host.drawn, null, { timeout: 60_000 });
      const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused }));
      expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
      const frame = page.frames().find((f) => f.url().includes("/wp/"))!;
      expect(await frame.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; })).toEqual([1920, 1200, 960, 600]);
      const shot = async () => Bun.hash(await page.screenshot()).toString();
      const a = await shot();
      await page.waitForTimeout(1500);
      expect(await shot()).not.toBe(a);
      await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
      await page.waitForTimeout(400);
      const held = await shot();
      await page.waitForTimeout(1200);
      expect(await shot()).toBe(held);
    } finally {
      await page.close();
    }
  }, 120_000);
});
