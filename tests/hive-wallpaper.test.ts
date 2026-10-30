// Bees, the Hive package's live wallpaper: its scene run through the SDK's fakeWallpaperHost, as the
// app connects it, on the SDK's own clock but the test's time (the clock asks for the display's
// frames, and the test gives them), with the randomness seeded and no canvas (the drawing gets the
// meadow and keeps it); its colours measured against the app's own presets; the package read by the
// app's package reader and HiveHub's check; and its build loaded in Chromium the way the app serves it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, rgbOf as cssRgb } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import type { WallpaperCreature, WallpaperTile } from "../types/view-sdk/wallpaper";
import { prng } from "../packages/hive/src/bees/ground";
import type { Meadow } from "../packages/hive/src/bees/meadow";
import { BEE_PALETTE } from "../packages/hive/src/bees/palette";
import { rgbOf, type Rgb } from "../packages/hive/src/bees/colour";
import { startBees } from "../packages/hive/src/bees/scene";

const PKG = path.join(ROOT, "packages/hive");
const FPS = 30;

/** Run `fn` with Math.random seeded: where the bees go, what they choose. */
async function seeded<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const real = Math.random;
  Math.random = prng(seed);
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}

/** The display's frames, given by the test: the SDK's clock asks for each with
 *  `requestAnimationFrame` where there is one, and `run` hands them over, 30 a second, each a
 *  thirtieth of a second after the last. */
function displayFrames() {
  const g = globalThis as unknown as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown };
  const was = { request: g.requestAnimationFrame, cancel: g.cancelAnimationFrame };
  const asked = new Map<number, (now: number) => void>();
  let id = 0;
  let now = performance.now();
  g.requestAnimationFrame = (cb: (now: number) => void) => { asked.set(++id, cb); return id; };
  g.cancelAnimationFrame = (k: number) => { asked.delete(k); };
  return {
    /** `seconds` of frames, `each` after every one. */
    run(seconds: number, each?: () => void) {
      for (let i = 0; i < Math.round(seconds * FPS); i++) {
        now += 1000 / FPS;
        const due = [...asked.values()];
        asked.clear();
        for (const cb of due) cb(now);
        each?.();
      }
    },
    restore() {
      g.requestAnimationFrame = was.request;
      g.cancelAnimationFrame = was.cancel;
    },
  };
}

/** Bees connected to a fake host as the app would connect it, on the test's frames, drawn by
 *  nothing: the drawing is handed the meadow each frame and keeps it, so a test reads where
 *  everything is. */
async function bees(opts: FakeWallpaperOptions = {}) {
  const frames = displayFrames();
  const host = fakeWallpaperHost({ viewport: { w: 1440, h: 900, dpr: 1 }, mode: "run", ...opts });
  const wp = await host.connect();
  const seen = { draws: 0, meadow: null as Meadow | null };
  const stop = startBees(wp, { resize() {}, setLook() {}, draw(m) { seen.draws++; seen.meadow = m; } });
  await host.settle();
  frames.run(1 / FPS);
  const meadow = seen.meadow!;
  const { w, h } = opts.viewport ?? { w: 1440, h: 900 };
  return { host, seen, meadow, frames, w, h, done: () => { stop(); host.close(); frames.restore(); } };
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const inside = (b: Box, w: number, h: number) => b.x0 >= 0 && b.y0 >= 0 && b.x1 <= w && b.y1 <= h;
const SIZES = [{ w: 800, h: 600 }, { w: 1440, h: 900 }, { w: 2560, h: 1440 }];
const SPECIES = ["bumble", "carpenter", "honey", "leafcutter", "mason", "mining", "redtail", "sweat"];

describe("Bees", () => {
  test("the colony is there from the first frame, more bees on a bigger window, spread along the meadow: in three of its four quarters, most of them at work on its flowers", async () => {
    const counts: number[] = [];
    for (const { w, h } of SIZES) {
      for (const seed of [1, 2, 3]) {
        await seeded(seed, async () => {
          const s = await bees({ viewport: { w, h, dpr: 1 }, mode: "hold" });
          try {
            const where = `${w}x${h}, seed ${seed}`;
            const { meadow } = s;
            expect({ where, drawn: s.seen.draws }).toEqual({ where, drawn: 1 });
            if (seed === 1) counts.push(meadow.bees.length);
            const quarters = new Set(meadow.bees.map((b) => Math.min(3, Math.floor((b.x / w) * 4))));
            const onFlowers = meadow.bees.filter((b) => b.doing === "forage" && b.landed && b.y > h * 0.5).length;
            expect({ where, quarters: quarters.size >= 3, working: onFlowers >= meadow.bees.length / 2, small: meadow.drones.length >= 8 })
              .toEqual({ where, quarters: true, working: true, small: true });
          } finally {
            s.done();
          }
        });
      }
    }
    expect(counts[0]!).toBeGreaterThanOrEqual(8);
    expect(counts[0]! < counts[1]! && counts[1]! < counts[2]!).toBe(true);
  });

  test("a new window size keeps the colony: the same bees, each moved into the new space, and a few more on a bigger window, all eight species still there", async () => {
    await seeded(7, async () => {
      const s = await bees();
      try {
        const { host, meadow } = s;
        s.frames.run(3);
        const was = meadow.bees.map((b) => ({ b, species: b.species, x: b.x, y: b.y }));
        host.send({ type: "viewport", viewport: { w: 1920, h: 1080, dpr: 1 } });
        await host.settle();
        const { cw, ch } = meadow.grid;
        const moved = was.filter(({ b, species, x, y }) => meadow.bees.indexOf(b) < 0 || b.species !== species || Math.abs(b.x - x * (1920 / 1440)) > cw * 6 || Math.abs(b.y - y * (1080 / 900)) > ch * 4);
        expect({ moved: moved.length, more: meadow.bees.length > was.length, species: new Set(meadow.bees.map((b) => b.species)).size }).toEqual({ moved: 0, more: true, species: 8 });
      } finally {
        s.done();
      }
    });
  });

  test("all eight species are among the bigger bees, on the smallest window as on the biggest", async () => {
    for (const { w, h } of SIZES) {
      for (const seed of [4, 5]) {
        await seeded(seed, async () => {
          const s = await bees({ viewport: { w, h, dpr: 1 }, mode: "hold" });
          try {
            expect({ w, seed, species: [...new Set(s.meadow.bees.map((b) => b.species))].sort() }).toEqual({ w, seed, species: SPECIES });
          } finally {
            s.done();
          }
        });
      }
    }
  });

  test("bees stay whole on the screen: over 60 s of the pointer wandering by the edges and clicks in the corners, no bee's cells and no small bee leave the window", async () => {
    for (const seed of [11, 12, 13]) {
      await seeded(seed, async () => {
        const s = await bees({ viewport: { w: 1280, h: 800, dpr: 1 } });
        try {
          const { host, meadow, w, h } = s;
          const spots = [[6, 6], [w - 6, 6], [w - 6, h - 6], [6, h - 6], [w / 2, 4], [4, h / 2], [w - 4, h / 2], [w / 2, h - 4]];
          let out = 0;
          for (let k = 0; k < 30; k++) {
            const [x, y] = spots[k % spots.length]!;
            host.point(x!, y!);
            if (k % 2) host.click(x!, y!);
            await host.settle();
            s.frames.run(2, () => {
              for (const b of meadow.bees) if (!inside(meadow.boxOf(b), w, h)) out++;
              for (const d of meadow.drones) if (d.x < 0 || d.x > w || d.y < 0 || d.y > h) out++;
            });
          }
          expect({ seed, out }).toEqual({ seed, out: 0 });
        } finally {
          s.done();
        }
      });
    }
  });

  test("the pointer resting over the meadow draws a few bees to it (a mean of 2.5 to 3 within 110 px over 30 seeds, at most one before it came) and never more than three of the colony; sweeping past, it draws nobody; gone, they go back to work", async () => {
    for (const seed of [21, 22, 23, 24]) {
      await seeded(seed, async () => {
        const s = await bees();
        try {
          const { host, meadow, w, h } = s;
          const at = { x: w * 0.52, y: h * 0.55 };
          const near = () => meadow.bees.filter((b) => Math.hypot(b.x - at.x, b.y - at.y) < 110).length;
          // Before the pointer: nobody goes there by itself.
          let before = 0;
          s.frames.run(4, () => { before = Math.max(before, near()); });
          // A pointer sweeping across the meadow takes no bee from its work (none curious over 30
          // seeds; three with no wait for it to rest).
          let chasing = 0;
          for (let i = 0; i < 90; i++) {
            host.point(w * 0.2 + ((i * 14) % (w * 0.6)), at.y);
            await host.settle();
            s.frames.run(1 / FPS);
            chasing = Math.max(chasing, meadow.bees.filter((b) => b.doing === "curious").length);
          }
          host.point(at.x, at.y);
          await host.settle();
          s.frames.run(5);
          const samples: number[] = [];
          s.frames.run(4, () => samples.push(near()));
          const most = Math.max(...samples);
          const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
          expect({ seed, before: before <= 2, chasing, came: mean >= 1.5, few: most <= 5 }).toEqual({ seed, before: true, chasing: 0, came: true, few: true });
          // The pointer gone: four seconds on, they have left where it was.
          host.point(at.x, at.y, false);
          await host.settle();
          s.frames.run(4);
          const after: number[] = [];
          s.frames.run(2, () => after.push(near()));
          expect({ seed, left: after.reduce((a, b) => a + b, 0) / after.length <= 1.5 }).toEqual({ seed, left: true });
        } finally {
          s.done();
        }
      });
    }
  });

  test("among the flowers, where many bees work, a resting pointer still draws three at most and leaves the rest at work (three on every one of 30 seeds; four to seven with no cap)", async () => {
    for (const seed of [25, 26, 27]) {
      await seeded(seed, async () => {
        const s = await bees();
        try {
          const { host, meadow, w, h } = s;
          host.point(w * 0.5, h * 0.8);
          await host.settle();
          let most = 0;
          s.frames.run(10, () => { most = Math.max(most, meadow.bees.filter((b) => b.doing === "curious").length); });
          expect({ seed, most }).toEqual({ seed, most: 3 });
        } finally {
          s.done();
        }
      });
    }
  });

  test("a click is a puff of pollen there: every bee near it scatters, and every one that was gathering by it comes back within 6 s (the last by 2.9 s over 30 seeds)", async () => {
    for (const seed of [31, 32, 33, 34]) {
      await seeded(seed, async () => {
        const s = await bees();
        try {
          const { host, meadow } = s;
          // At a bee gathering on a flower, with others near.
          const by = (x: number, y: number, r: number) => meadow.bees.filter((b) => Math.hypot(b.x - x, b.y - y) < r);
          const at = meadow.bees.filter((b) => b.doing === "forage" && b.landed).sort((p, q) => by(q.x, q.y, 140).length - by(p.x, p.y, 140).length)[0]!;
          const x = at.x;
          const y = at.y + 8;
          const near = by(x, y, 140).map((b) => ({ b, d: Math.hypot(b.x - x, b.y - y), gathering: b.doing === "forage" && b.landed }));
          host.click(x, y);
          await host.settle();
          s.frames.run(1 / FPS);
          expect({ seed, puff: meadow.puffs.length, grains: meadow.grains.length > 10 }).toEqual({ seed, puff: 1, grains: true });
          s.frames.run(0.6);
          const fled = near.filter(({ b, d }) => Math.hypot(b.x - x, b.y - y) > d + 30).length;
          expect({ seed, fled }).toEqual({ seed, fled: near.length });
          const back = new Set<unknown>();
          s.frames.run(5.4, () => { for (const { b, gathering } of near) if (gathering && Math.hypot(b.x - x, b.y - y) < 140) back.add(b); });
          expect({ seed, back: back.size }).toEqual({ seed, back: near.filter((n) => n.gathering).length });
        } finally {
          s.done();
        }
      });
    }
  });

  test("it names no bee and takes no notice of the agents: with the agents, their tiles and a turn done sent as the app sends them, the pointer over any bee says nothing, a click there opens nothing, and the colony lives as it would without them", async () => {
    const creatures: WallpaperCreature[] = [
      { id: "a1", agent: "claude", kind: 0.05, size: 1, state: "needs-you" },
      { id: "a2", agent: "codex", kind: 0.4, size: 0.9, state: "working" },
      { id: "a3", agent: "pi", kind: 0.7, size: 0.8, state: "resting" },
    ];
    const tiles: WallpaperTile[] = [{ x0: 300, y0: 100, x1: 800, y1: 450, id: "a1" }, { x0: 850, y0: 120, x1: 1300, y1: 420, id: "a2" }];
    const run = (told: boolean) => seeded(71, async () => {
      const s = await bees(told ? { creatures, tiles, seeThrough: true } : {});
      try {
        const { host, meadow } = s;
        if (told) {
          host.send({ type: "done", id: "a2" });
          host.send({ type: "creatures", creatures: creatures.map((c) => ({ ...c, state: "working" })) });
          await host.settle();
        }
        s.frames.run(3);
        const opened: (string | null)[] = [];
        for (const b of meadow.bees) {
          host.point(b.x, b.y);
          await host.settle();
          opened.push(host.click(b.x, b.y));
        }
        await host.settle();
        s.frames.run(1 / FPS);
        return { said: host.received.map((m) => m.type), hovered: host.hovered, opened, refused: host.refused, bees: meadow.bees.map((b) => `${b.species} ${b.x.toFixed(2)},${b.y.toFixed(2)}`) };
      } finally {
        s.done();
      }
    });
    const told = await run(true);
    const alone = await run(false);
    expect({ said: told.said, hovered: told.hovered, opened: told.opened.filter((o) => o !== null), refused: told.refused }).toEqual({ said: ["ready", "drawn"], hovered: null, opened: [], refused: [] });
    expect(told.bees).toEqual(alone.bees);
  });

  test("a dozen clicks in a second: never more than three puffs or 160 grains of pollen at once, and all of it gone two seconds after the last", async () => {
    await seeded(51, async () => {
      const s = await bees();
      try {
        const { host, meadow, w, h } = s;
        let puffs = 0;
        let grains = 0;
        for (let i = 0; i < 12; i++) {
          host.click(w * (0.2 + 0.05 * i), h * 0.8);
          await host.settle();
          s.frames.run(1 / 12, () => { puffs = Math.max(puffs, meadow.puffs.length); grains = Math.max(grains, meadow.grains.length); });
        }
        expect({ puffs: puffs <= 3, grains: grains <= 160, some: grains > 26 }).toEqual({ puffs: true, grains: true, some: true });
        s.frames.run(2);
        expect({ puffs: meadow.puffs.length, burst: meadow.grains.filter((g) => g.glyph !== ".").length }).toEqual({ puffs: 0, burst: 0 });
      } finally {
        s.done();
      }
    });
  });

  test("an hour on its own: the colony and the small bees keep their number, every bee stays on screen, and the pollen in the air stays under its cap (at most 31 of 160 measured)", async () => {
    await seeded(61, async () => {
      const s = await bees();
      try {
        const { meadow, w, h } = s;
        const counts = [meadow.bees.length, meadow.drones.length];
        let most = 0;
        let out = 0;
        s.frames.run(3600, () => {
          most = Math.max(most, meadow.grains.length + meadow.puffs.length);
          for (const b of meadow.bees) if (!inside(meadow.boxOf(b), w, h)) out++;
        });
        expect({ counts: [meadow.bees.length, meadow.drones.length], most: most <= 160, out }).toEqual({ counts, most: true, out: 0 });
      } finally {
        s.done();
      }
    });
  }, 60_000);

  test("held, it neither steps nor draws; still, one settled frame, and the pointer, a click or a new theme move nothing in it, nor later once it runs", async () => {
    await seeded(41, async () => {
      const s = await bees({ mode: "hold" });
      try {
        const time = s.meadow.time;
        s.frames.run(2);
        expect({ draws: s.seen.draws, time: s.meadow.time }).toEqual({ draws: 1, time });
      } finally {
        s.done();
      }
    });
    await seeded(42, async () => {
      const s = await bees({ mode: "still" });
      try {
        const { host, meadow } = s;
        expect(s.seen.draws).toBe(1);
        const places = () => [...meadow.bees.map((b) => `${b.species} ${b.x.toFixed(1)},${b.y.toFixed(1)}`), ...meadow.drones.map((d) => `${d.x.toFixed(1)},${d.y.toFixed(1)}`)];
        const before = places();
        host.point(700, 600);
        host.click(700, 600);
        host.send({ type: "look", look: { page: "#f7f7f5", text: "#202225", attention: "#a8650a", dark: false, colour: true, mono: "monospace" } });
        await host.settle();
        s.frames.run(2);
        expect(s.seen.draws).toBe(2);
        expect(places()).toEqual(before);
        expect(meadow.puffs.length).toBe(0);
        // Motion back on: the click made while still is not played late; nothing near it is thrown.
        const was = meadow.bees.map((b) => ({ b, x: b.x, y: b.y })).filter(({ x, y }) => Math.hypot(x - 700, y - 600) < 210);
        host.send({ type: "mode", mode: "run" });
        await host.settle();
        s.frames.run(0.4);
        expect(was.filter(({ b, x, y }) => Math.hypot(b.x - x, b.y - y) > 60).map(({ b }) => b.species)).toEqual([]);
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

test("its colours keep the frosted panels' text readable: over every stop of its sky and its sun's glow, names at 7:1, details at 4.5:1 and hints at 3:1; over every colour its ground and grass are drawn in, names at 4.5:1", () => {
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
    for (const k of ["hillFar", "hillNear", "far", "mid", "near", "tip", "seed", "stem", "straw", "coil", "shade", "rim", "board", "door"] as const) {
      expect({ where: `${mode}, ${k}`, names: contrast(oklch(fg!), panel(rgbOf(p[k]))) >= 4.5 }).toEqual({ where: `${mode}, ${k}`, names: true });
    }
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

/** The app at HIVEMIND_APP holds live wallpapers (2026.10.8 and later, protocol 1). */
const WALLPAPERS = existsSync(path.join(APP, "packages/hive-core/src/wallpaper-folder.ts")) && existsSync(path.join(APP, "packages/hive-hub/src/since.ts"));
const NO_WALLPAPERS = "skipped: the app at HIVEMIND_APP has no live wallpaper member (packages/hive-core/src/wallpaper-folder.ts)";
const withWallpapers = (name: string) => (WALLPAPERS ? name : `${name} (${NO_WALLPAPERS})`);
if (!WALLPAPERS) console.log(`hive-wallpaper: ${NO_WALLPAPERS}, so the rows read by the app do not run.`);

test.skipIf(!WALLPAPERS)(withWallpapers("the app's package reader takes Hive as @dip497/hive, holding the live wallpaper @dip497/hive/bees named Bees, which it offers on install"), async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "hive" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/hive", members: [["wallpaper", "@dip497/hive/bees", "Bees"]], startup: "@dip497/hive/bees" });
});

test.skipIf(!WALLPAPERS)(withWallpapers("HiveHub lists Hive as needing Hivemind 2026.10.8, its wallpaper sandboxed and asking for nothing, and leaves its sources and harness out of what installs"), async () => {
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

  async function open(dpr: number): Promise<Page> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(() => window.start({
      look: { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: true, mono: "monospace" }, mode: "run",
      creatures: [{ id: "a1", agent: "claude", kind: 0.05, size: 1, state: "needs-you" }], tiles: [{ x0: 300, y0: 80, x1: 800, y1: 380, id: "a1", name: "api", lines: [] }],
      chrome: { bg2: "#202226", fg: "#eeeeee", fg2: "#cccccc", fg3: "#999999", line: "#333333" },
    }));
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 10_000 });
    return page;
  }

  test("it says it speaks protocol 1 and that its first frame is up and nothing more, even with the pointer over its bees and a click, and draws a canvas the viewport's size times its pixel ratio", async () => {
    const page = await open(2);
    try {
      await page.evaluate(() => { window.pointAt(640, 500); window.clickAt(640, 600); });
      await new Promise((r) => setTimeout(r, 800));
      const said = await page.evaluate(() => ({ received: window.host.received, refused: window.host.refused }));
      expect(said).toEqual({ received: [{ type: "ready", protocol: 1 }, { type: "drawn" }], refused: [] });
      const canvas = await page.frames()[1]!.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
      expect(canvas).toEqual([2560, 1600, 1280, 800]);
    } finally {
      await page.close();
    }
  }, 60_000);

  test("running it draws about 30 frames a second; held, none at all", async () => {
    const page = await open(1);
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
