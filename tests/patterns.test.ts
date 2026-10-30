// Patterns, the package of three live wallpapers drawn in characters (Life, Sand, Glyph Rain):
// each pattern run through the SDK's fakeWallpaperHost as the app connects it (runScene), with the
// randomness seeded and no canvas (its drawing a stand-in that counts frames); each pattern's own
// rules, its pointer play and its clicks, an hour of it alone; the colours it paints measured
// against the app's own presets; the characters it draws against the faces it brings; the package
// read by the app's package reader and HiveHub's check; and its build loaded in Chromium the way
// the app serves it. Each bar sits clear of what 20 or more seeds measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Frame, type Page } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { fakeWallpaperHost, type FakeWallpaperOptions } from "../types/view-sdk/testing";
import { runScene, type Sim } from "../packages/patterns/src/scene";
import { rgbOf, type Rgb } from "../packages/patterns/src/colour";
import { Life, RING_SPEED as LIFE_RING_SPEED, SOW_REACH } from "../packages/patterns/src/life/life";
import { DROPS, GLIDER, orient } from "../packages/patterns/src/life/patterns";
import { LIFE_PALETTE } from "../packages/patterns/src/life/palette";
import { blockColours, LIFE_GLYPHS } from "../packages/patterns/src/life/render";
import { CODES, HUES, KEYS, Sand } from "../packages/patterns/src/sand/sand";
import { SAND_PALETTE } from "../packages/patterns/src/sand/palette";
import { DUST, grainColour, TIERS } from "../packages/patterns/src/sand/render";
import { DEPTHS, GLYPHS, PART_REACH, Rain, RING_REACH, RING_SPEED } from "../packages/patterns/src/glyphs/rain";
import { RAIN_PALETTE } from "../packages/patterns/src/glyphs/palette";

const PKG = path.join(ROOT, "packages/patterns");
// An hour of each pattern, on two seeds, takes a few seconds.
setDefaultTimeout(120_000);
const W = 1440;
const H = 900;
const STEP = 1 / 60;

/** Numbers in [0, 1) from a seed: a counter stepped by the golden ratio, its bits scrambled. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
  };
}
/** Run `fn` with Math.random seeded: the board's soup, the spouts, the streams, every roll. */
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
  for (let i = 0; i < Math.round(secs / STEP); i++) {
    sim.step(STEP);
    each?.();
  }
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const SCENES = { life: () => new Life(), sand: () => new Sand(), glyphs: () => new Rain() } as const;
type SceneName = keyof typeof SCENES;
const NAMES = Object.keys(SCENES) as SceneName[];

/** A pattern connected to a fake host as the app would connect it, drawn by a stand-in that counts
 *  its frames; the test steps it by hand while the mode is not `run`. */
async function open<S extends Sim>(sim: S, opts: FakeWallpaperOptions) {
  const host = fakeWallpaperHost({ viewport: { w: W, h: H, dpr: 1 }, ...opts });
  const wp = await host.connect();
  const seen = { draws: 0 };
  const stop = runScene(wp, sim, { resize() {}, setLook() {}, draw() { seen.draws++; } });
  await host.settle();
  return { host, sim, seen, done: () => { stop(); host.close(); } };
}
const scene = <N extends SceneName>(name: N, opts: FakeWallpaperOptions = {}) => open(SCENES[name]() as ReturnType<(typeof SCENES)[N]>, { mode: "hold", ...opts });

/** The cells of a Life board that are alive, as "column,row". */
const alive = (l: Life) => {
  const out: string[] = [];
  for (let i = 0; i < l.cells.length; i++) if (l.cells[i]) out.push(`${i % l.cols},${Math.floor(i / l.cols)}`);
  return out.sort();
};
/** A Life board with only `cells` alive. */
const board = (l: Life, cells: readonly (readonly [number, number])[]) => {
  l.cells.fill(0);
  for (const [c, r] of cells) l.cells[r * l.cols + c] = 1;
};
/** A stream's characters on screen, as [column's middle, row's middle] in px. */
const streamCells = (r: Rain) => r.layers.flatMap((L) => L.streams.flatMap((s) => Array.from({ length: s.length }, (_, d) => Math.floor(s.head) - d).filter((row) => row >= 0 && row < L.rows).map((row) => [(s.col + 0.5) * L.cw, (row + 0.5) * L.ch] as const)));

// ── what fills the window ────────────────────────────────────────────────────

describe("Patterns", () => {
  test("each pattern is full from its first frame: filled for the window's size, more of it on a bigger one, and spread over all of it", async () => {
    const sizes = [[1024, 640], [1440, 900], [2560, 1440]] as const;
    const cells: Record<SceneName, number[]> = { life: [], sand: [], glyphs: [] };
    for (const [w, h] of sizes) {
      for (const seed of [1, 2, 3]) {
        await seeded(seed, async () => {
          const where = (name: string) => `${name} ${w}×${h} seed ${seed}`;
          // Held: its first frame is drawn without a step.
          const life = await scene("life", { viewport: { w, h, dpr: 1 } });
          try {
            const l = life.sim;
            // Live cells in every ninth of the window: over 24 seeds the least-filled ninth held 2.3% to
            // 9.5%, the board 5.4% to 12.5%.
            const ninths = Array.from({ length: 9 }, (_, k) => {
              let [n, all] = [0, 0];
              for (let r = Math.floor(((k % 3) * l.rows) / 3); r < Math.floor((((k % 3) + 1) * l.rows) / 3); r++) {
                for (let c = Math.floor((Math.floor(k / 3) * l.cols) / 3); c < Math.floor(((Math.floor(k / 3) + 1) * l.cols) / 3); c++) [n, all] = [n + l.cells[r * l.cols + c]!, all + 1];
              }
              return n / all;
            });
            expect({ at: where("life"), draws: life.seen.draws, fits: l.cols * l.cw >= w && (l.cols - 1) * l.cw < w && l.rows * l.ch >= h && (l.rows - 1) * l.ch < h, alive: l.population / l.cells.length > 0.035, everywhere: Math.min(...ninths) > 0.012 })
              .toEqual({ at: where("life"), draws: 1, fits: true, alive: true, everywhere: true });
            if (seed === 1) cells.life.push(l.cells.length);
          } finally {
            life.done();
          }
          const sand = await scene("sand", { viewport: { w, h, dpr: 1 } });
          try {
            const s = sand.sim;
            let floor = 0;
            for (let c = 0; c < s.cols; c++) floor += s.grain[(s.rows - 1) * s.cols + c] ? 1 : 0;
            let aloft = 0;
            for (let i = 0; i < s.cols * Math.floor(s.rows / 3); i++) aloft += s.grain[i] ? 1 : 0;
            // Over 24 seeds the sand covered 12% to 25% of the window, all of the floor, and 42 to 125
            // grains were falling through the top third.
            expect({ at: where("sand"), draws: sand.seen.draws, fits: s.cols * s.gw >= w && s.rows * s.gh >= h, floor: floor / s.cols, fill: s.count / s.grain.length > 0.08 && s.count / s.grain.length < 0.35, pouring: aloft >= 20 })
              .toEqual({ at: where("sand"), draws: 1, fits: true, floor: 1, fill: true, pouring: true });
            if (seed === 1) cells.sand.push(s.grain.length);
          } finally {
            sand.done();
          }
          const rain = await scene("glyphs", { viewport: { w, h, dpr: 1 } });
          try {
            const r = rain.sim;
            const shown = streamCells(r);
            const quadrants = new Set(shown.map(([x, y]) => `${x < w / 2}${y < h / 2}`)).size;
            // Over 24 seeds: characters in all four quarters every time, 640 to 1,081 of them on screen.
            expect({ at: where("glyphs"), draws: rain.seen.draws, depths: r.layers.map((L) => L.streams.length > 3 && L.cols * L.cw >= w && L.rows * L.ch >= h), quadrants, many: shown.length > 450 })
              .toEqual({ at: where("glyphs"), draws: 1, depths: [true, true, true], quadrants: 4, many: true });
            if (seed === 1) cells.glyphs.push(r.layers.reduce((n, L) => n + L.cols * L.rows, 0));
          } finally {
            rain.done();
          }
        });
      }
    }
    // A bigger window, more of it.
    for (const name of NAMES) expect({ name, more: cells[name][2]! > cells[name][1]! && cells[name][1]! > cells[name][0]! }).toEqual({ name, more: true });
  });

  test("a resize keeps what is there and fits it to the new window: Life's board in the middle, Sand's dunes and bands at the same shares, Glyph Rain's streams at the same heights", async () => {
    await seeded(11, async () => {
      // Life: the old board kept in the middle of the new one, cut at its edges; a bigger one alive
      // beyond it too.
      for (const [w, h] of [[1024, 640], [2560, 1440]] as const) {
        const l = new Life();
        l.resize(W, H);
        run(l, 2);
        const before = { cols: l.cols, rows: l.rows, cells: l.cells.slice() };
        l.resize(w, h);
        const [dc, dr] = [Math.floor((l.cols - before.cols) / 2), Math.floor((l.rows - before.rows) / 2)];
        let [kept, differ, beyond, beyondAlive] = [0, 0, 0, 0];
        for (let r = 0; r < l.rows; r++) {
          for (let c = 0; c < l.cols; c++) {
            const [oc, or] = [c - dc, r - dr];
            const now = l.cells[r * l.cols + c]!;
            if (oc >= 0 && or >= 0 && oc < before.cols && or < before.rows) {
              kept++;
              differ += Number(now !== before.cells[or * before.cols + oc]);
            } else [beyond, beyondAlive] = [beyond + 1, beyondAlive + now];
          }
        }
        expect({ w, kept: kept > 0, differ, beyond: beyond === 0 || beyondAlive / beyond > 0.05 }).toEqual({ w, kept: true, differ: 0, beyond: true });
      }
      // Sand: the same share of the window covered, the floor covered, and each column's bands in the
      // same order as the column at the same share of the old window's width.
      const s = new Sand();
      s.resize(W, H);
      run(s, 3);
      const bands = (sand: Sand, share: number) => {
        const c = Math.min(sand.cols - 1, Math.floor(share * sand.cols));
        const out: number[] = [];
        for (let r = sand.rows - 1; r >= 0 && sand.grain[r * sand.cols + c]; r--) {
          const key = Math.floor(((sand.grain[r * sand.cols + c]! - 1) >> 2) / (HUES / KEYS));
          if (out[out.length - 1] !== key) out.push(key);
        }
        return out;
      };
      const was = { fill: s.count / s.grain.length, bands: [0.2, 0.5, 0.8].map((k) => bands(s, k)) };
      s.resize(1920, 1080);
      let floor = 0;
      for (let c = 0; c < s.cols; c++) floor += s.grain[(s.rows - 1) * s.cols + c] ? 1 : 0;
      expect({ fill: Math.abs(s.count / s.grain.length - was.fill) < 0.02, floor: floor / s.cols, bands: [0.2, 0.5, 0.8].map((k) => bands(s, k)) }).toEqual({ fill: true, floor: 1, bands: was.bands });
      // Glyph Rain: each depth with as many streams as its new width holds, and those kept at the
      // same share of the height.
      const r = new Rain();
      r.resize(W, H);
      run(r, 2);
      const heads = r.layers.map((L) => L.streams.map((st) => st.head / L.rows));
      r.resize(1024, 640);
      r.layers.forEach((L, k) => {
        expect({ k, streams: L.streams.length }).toEqual({ k, streams: Math.max(4, Math.round(L.cols * DEPTHS[k]!.share)) });
        const kept = L.streams.filter((st) => heads[k]!.some((was) => Math.abs(was - st.head / L.rows) < 1e-9)).length;
        expect({ k, kept }).toEqual({ k, kept: Math.min(heads[k]!.length, L.streams.length) });
      });
    });
  });

  // ── Life ──────────────────────────────────────────────────────────────────

  test("Life follows Conway's rules on a board whose edges join: born on three neighbours, alive on two or three, dead on fewer or more", () => {
    const l = new Life();
    l.resize(W, H);
    const tick = (n = 1) => { for (let k = 0; k < n; k++) l.tick(); return alive(l); };
    const at = (cells: [number, number][], c = 40, r = 30) => cells.map(([dc, dr]) => `${c + dc},${r + dr}`).sort();
    // A lone cell and a pair die of loneliness.
    board(l, [[10, 10], [30, 10], [31, 10]]);
    expect(tick()).toEqual([]);
    // Three in an L: the fourth corner is born (three neighbours), the three live on (two each): a block.
    board(l, [[40, 30], [41, 30], [40, 31]]);
    expect(tick()).toEqual(at([[0, 0], [1, 0], [0, 1], [1, 1]]));
    // The block holds still.
    expect(tick(5)).toEqual(at([[0, 0], [1, 0], [0, 1], [1, 1]]));
    // A plus: its middle has four neighbours and dies; each arm, with one, dies; the corners, with
    // three, are born.
    board(l, [[40, 30], [39, 30], [41, 30], [40, 29], [40, 31]]);
    expect(tick()).toEqual(at([[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]));
    // A blinker beats with period two.
    board(l, [[39, 30], [40, 30], [41, 30]]);
    expect([tick(), tick()]).toEqual([at([[0, -1], [0, 0], [0, 1]]), at([[-1, 0], [0, 0], [1, 0]])]);
    // A glider is itself again four generations on, a cell down and a cell right.
    board(l, GLIDER.map(([c, r]) => [40 + c, 30 + r] as [number, number]));
    expect(tick(4)).toEqual(at(GLIDER.map(([c, r]) => [c + 1, r + 1] as [number, number])));
    // Off the bottom right corner, it comes back at the top left, whole.
    const [c0, r0] = [l.cols - 2, l.rows - 2];
    board(l, GLIDER.map(([c, r]) => [c0 + c - 1, r0 + r - 1] as [number, number]));
    const wrapped = GLIDER.map(([c, r]) => `${(c0 + c - 1 + 8) % l.cols},${(r0 + r - 1 + 8) % l.rows}`).sort();
    expect(tick(32)).toEqual(wrapped);
  });

  test("Life: a newborn is new, a cell that lives on ages, and one that dies leaves a trace; an oscillator's beat keeps its age, so a blinker glows steadily instead of flashing new", () => {
    const l = new Life();
    l.resize(W, H);
    board(l, [[20, 20], [21, 20], [20, 21], [21, 21], [50, 30], [51, 30], [52, 30], ...GLIDER.map(([c, r]) => [80 + c, 20 + r] as [number, number])]);
    l.age.fill(0);
    const t0 = l.time;
    const glider: number[] = [];
    for (let g = 0; g < 12; g++) {
      const before = l.cells.slice();
      l.time += 0.2;
      l.tick();
      // The glider's cells are young: it is always moving on into new cells.
      for (let i = 0; i < l.cells.length; i++) {
        if (i % l.cols < 70) continue;
        if (l.cells[i]) glider.push(l.age[i]!);
        if (before[i] && !l.cells[i]) expect(l.traceAt[i]).toBe(Math.fround(l.time));
        if (!before[i] && l.cells[i] && l.age[i] === 0) expect(l.bornAt[i]).toBe(Math.fround(l.time));
      }
    }
    const cells = (c0: number, c1: number) => alive(l).map((k) => k.split(",").map(Number) as [number, number]).filter(([c]) => c >= c0 && c <= c1).map(([c, r]) => r * l.cols + c);
    // The blinker's ends die and are born every generation, and were never taken for newborns: each
    // kept its age through the beat.
    const blinker = cells(49, 53);
    expect({ block: cells(19, 22).map((i) => l.age[i]), blinker: blinker.length === 3 && blinker.every((i) => l.age[i]! >= 5 && l.bornAt[i]! < t0), gliderYoung: Math.max(...glider) <= 4 && glider.includes(0) })
      .toEqual({ block: [12, 12, 12, 12], blinker: true, gliderYoung: true });
  });

  test("Life never dies out or freezes: over an hour every part of the board has something born in it every half minute, and it never fills up", async () => {
    for (const seed of [1, 2]) {
      await seeded(seed, () => {
        const l = new Life();
        l.resize(1024, 640);
        const fresh: number[] = [];
        const filled: number[] = [];
        for (let i = 1; i <= 3600 / STEP; i++) {
          l.step(STEP);
          if (i % (30 / STEP)) continue;
          filled.push(l.population / l.cells.length);
          fresh.push(mean(l.regions.map((g) => {
            for (let r = g.r0; r < g.r1; r++) for (let c = g.c0; c < g.c1; c++) if (l.cells[r * l.cols + c] && l.time - l.bornAt[r * l.cols + c]! < 30) return 1;
            return 0;
          })));
        }
        // Over three seeds of an hour: 3.2% to 9.6% of the board alive; in 89% to 100% of its
        // regions something born within half a minute, at every look.
        expect({ seed, fewest: Math.min(...filled) > 0.015, most: Math.max(...filled) < 0.2, everywhere: Math.min(...fresh) >= 0.75 }).toEqual({ seed, fewest: true, most: true, everywhere: true });
      });
    }
  });

  test("Life: the pointer sows living cells under and around it, resting or moving, and a click drops a glider, a small spaceship or an R-pentomino there, a ring of light spreading from it", async () => {
    const near = { with: [] as number[], without: [] as number[] };
    const along = { with: [] as number[], without: [] as number[] };
    for (let seed = 21; seed <= 30; seed++) {
      for (const on of [true, false]) {
        await seeded(seed, () => {
          const l = new Life();
          l.resize(W, H);
          run(l, 2);
          const [px, py] = [W * 0.4, H * 0.45];
          let t0 = l.time;
          l.point(px, py, on);
          run(l, 2);
          const born = (inside: (x: number, y: number) => boolean) => {
            let n = 0;
            for (let i = 0; i < l.cells.length; i++) if (l.bornAt[i]! > t0 && inside(((i % l.cols) + 0.5) * l.cw, (Math.floor(i / l.cols) + 0.5) * l.ch)) n++;
            return n;
          };
          near[on ? "with" : "without"].push(born((x, y) => Math.hypot(x - px, y - py) < (SOW_REACH + 1) * l.cw));
          // Moving: across the board and off it.
          l.point(0, 0, false);
          run(l, 0.5);
          t0 = l.time;
          for (let k = 0; k <= 60; k++) {
            if (on) l.point(300 + k * 13, 300, true);
            l.step(STEP);
          }
          l.point(0, 0, false);
          along[on ? "with" : "without"].push(born((x, y) => x > 330 && x < 1050 && Math.abs(y - 300) < 2 * l.ch));
        });
      }
    }
    // Over 40 seeds, born within reach of a pointer resting 2 s: 16 to 24, without one 0 to 15 (3.6
    // on average); along the way of one moving a second: 108 to 142, without one 0 to 68 (29).
    expect({ each: Math.min(...near.with) >= 12, more: mean(near.with) - mean(near.without) > 10, along: Math.min(...along.with) >= 80, alongMore: mean(along.with) - mean(along.without) > 50 })
      .toEqual({ each: true, more: true, along: true, alongMore: true });

    const dropped = new Set<string>();
    for (let seed = 31; seed <= 50; seed++) {
      await seeded(seed, () => {
        const l = new Life();
        l.resize(W, H);
        l.cells.fill(0);
        l.traceAt.fill(-1e9);
        const [x, y] = [700, 450];
        const clicked = Math.fround(l.time);
        l.splash(x, y);
        const [c, r] = l.cellAt(x, y);
        const live = alive(l);
        const found = Object.entries(DROPS).find(([, shape]) => [0, 1, 2, 3].some((t) => [false, true].some((f) => {
          const want = orient(shape, t, f).map(([dc, dr]) => `${c + dc},${r + dr}`).sort();
          return want.join(" ") === live.join(" ");
        })));
        expect({ seed, found: !!found }).toEqual({ seed, found: true });
        dropped.add(found![0]);
        // The ring of light: half a second on, the cells it has just lit are where it has spread to,
        // and it has left them a trace.
        run(l, 0.5);
        const lit = [];
        for (let i = 0; i < l.cells.length; i++) {
          const d = Math.hypot(((i % l.cols) + 0.5) * l.cw - x, (Math.floor(i / l.cols) + 0.5) * l.ch - y);
          if (l.litAt[i]! > clicked) lit.push({ d, at: l.litAt[i]!, trace: l.traceAt[i]! > -1e8 });
        }
        const newest = Math.max(...lit.map((p) => p.at));
        const front = lit.filter((p) => p.at === newest).map((p) => p.d);
        expect({ seed, traced: lit.every((p) => p.trace) }).toEqual({ seed, traced: true });
        expect({ seed, front: front.length > 10 && front.every((d) => Math.abs(d - LIFE_RING_SPEED * 0.5) < l.cw * 1.2) }).toEqual({ seed, front: true });
      });
    }
    // Over 30 seeds each of the three was dropped: a glider 13 times, a spaceship 6, an R-pentomino 11.
    expect([...dropped].sort()).toEqual(Object.keys(DROPS).sort());
  });

  // ── Sand ──────────────────────────────────────────────────────────────────

  test("Sand: a grain falls, slides down to one side or the other where it lands on another, and rests on the sand or the floor; a tower collapses into a heap no steeper than one cell across for each cell down; the sand over a crater drops in whole", async () => {
    await seeded(61, () => {
      const s = new Sand();
      s.resize(W, H);
      const clear = () => { s.grain.fill(0); s.count = 0; s.update(); };
      const where = (i: number) => [i % s.cols, Math.floor(i / s.cols)];
      const find = () => { const at: number[] = []; s.grain.forEach((g, i) => { if (g) at.push(i); }); return at; };
      clear();
      // In the air: one cell down each update, until the floor, where it stays.
      s.place(10 * s.cols + 50, 1);
      s.update();
      expect(find().map(where)).toEqual([[50, 11]]);
      for (let k = 0; k < s.rows; k++) s.update();
      expect(find().map(where)).toEqual([[50, s.rows - 1]]);
      // On another grain: down to one side, either side as often.
      const sides = { left: 0, right: 0 };
      for (let k = 0; k < 40; k++) {
        clear();
        s.place((s.rows - 1) * s.cols + 50, 1);
        s.place((s.rows - 2) * s.cols + 50, 1);
        s.update();
        const top = find().map(where).find(([c]) => c !== 50);
        if (top?.[0] === 49 && top[1] === s.rows - 1) sides.left++;
        if (top?.[0] === 51 && top[1] === s.rows - 1) sides.right++;
      }
      expect({ all: sides.left + sides.right, both: sides.left > 8 && sides.right > 8 }).toEqual({ all: 40, both: true });
      // A tower of 40 on the floor collapses into a heap.
      clear();
      for (let k = 0; k < 40; k++) s.place((s.rows - 1 - k) * s.cols + 90, 1);
      for (let k = 0; k < 200; k++) s.update();
      const heights = Array.from({ length: s.cols }, (_, c) => { let h = 0; while (h < s.rows && s.grain[(s.rows - 1 - h) * s.cols + c]) h++; return h; });
      const steepest = Math.max(...heights.slice(1).map((h, c) => Math.abs(h - heights[c]!)));
      expect({ grains: find().length, steepest, lower: Math.max(...heights) < 12 }).toEqual({ grains: 40, steepest: 1, lower: true });
      // A click deep in a settled bed of sand: the sand over its crater drops in whole, a cell an
      // update, rather than the crater climbing up through the bed a row at a time (which shows as
      // bands of sky across the dunes). Gaps under sand, away from the crater and the surface, cell
      // by update, over 24 seeds of half a second: 0 to 35; climbing, 809 to 913.
      clear();
      for (const sp of s.spouts) [sp.on, sp.until] = [false, Infinity];
      const top = s.rows - 40;
      for (let r = top; r < s.rows; r++) for (let c = 0; c < s.cols; c++) s.place(r * s.cols + c, 1);
      for (let k = 0; k < 5; k++) s.update();
      const [x, y] = [W / 2, (top + 25) * s.gh];
      s.splash(x, y);
      let gaps = 0;
      run(s, 0.5, () => {
        for (let r = top + 6; r < s.rows; r++) {
          for (let c = 0; c < s.cols; c++) {
            const i = r * s.cols + c;
            if (!s.grain[i] && s.grain[i - s.cols] && Math.hypot((c + 0.5) * s.gw - x, (r + 0.5) * s.gh - y) > 9 * s.gw + s.gh) gaps++;
          }
        }
      });
      expect({ gaps: gaps < 150 }).toEqual({ gaps: true });
    });
  });

  test("Sand: each spout pours one colour a while, then the next round the palette, so the dunes are laid in bands", async () => {
    for (const seed of [62, 63, 64]) {
      await seeded(seed, () => {
        const s = new Sand();
        s.resize(W, H);
        // The first picture's dunes: banded from the floor up, where they are tallest.
        const height = (c: number) => { let h = 0; while (h < s.rows && s.grain[(s.rows - 1 - h) * s.cols + c]) h++; return h; };
        let c = 0;
        for (let k = 0; k < s.cols; k++) if (height(k) > height(c)) c = k;
        const runs: number[] = [];
        let last = -1;
        for (let r = s.rows - 1; r >= 0 && s.grain[r * s.cols + c]; r--) {
          const key = Math.floor(((s.grain[r * s.cols + c]! - 1) >> 2) / (HUES / KEYS));
          if (key === last) runs[runs.length - 1]!++;
          else runs.push(1);
          last = key;
        }
        expect({ seed, bands: runs.length >= 3, thick: mean(runs) >= 3 }).toEqual({ seed, bands: true, thick: true });
        // The spouts: a colour held for seconds, then the next.
        const held = s.spouts.map(() => [] as number[]);
        const seen = s.spouts.map(() => new Set<number>());
        const since = s.spouts.map(() => 0);
        run(s, 180, () => s.spouts.forEach((sp, k) => {
          if (sp.hue === sp.toward && Number.isInteger(sp.hue / (HUES / KEYS))) {
            since[k]! += STEP;
            seen[k]!.add(sp.hue % HUES);
          } else if (since[k]) {
            held[k]!.push(since[k]!);
            since[k] = 0;
          }
        }));
        // Over 20 seeds of three minutes, each spout held 4 to 7 colours, each 8 s to 20 s after its first.
        expect({ seed, colours: seen.every((x) => x.size >= 3), held: held.flatMap((h) => h.slice(1)).every((t) => t >= 7.9) }).toEqual({ seed, colours: true, held: true });
      });
    }
  });

  test("Sand never fills up or runs dry: over an hour it covers about a fifth of the window, draining through the floor as the spouts pour", async () => {
    for (const seed of [65, 66]) {
      await seeded(seed, () => {
        const s = new Sand();
        s.resize(W, H);
        const fills: number[] = [];
        const tallest: number[] = [];
        const drained: number[] = [];
        let was = 0;
        for (let i = 1; i <= 3600 / STEP; i++) {
          s.step(STEP);
          if (i % (60 / STEP)) continue;
          fills.push(s.count / s.grain.length);
          drained.push(s.drained - was);
          was = s.drained;
          let top = 0;
          for (let c = 0; c < s.cols; c++) {
            let h = 0;
            while (h < s.rows && s.grain[(s.rows - 1 - h) * s.cols + c]) h++;
            top = Math.max(top, h / s.rows);
          }
          tallest.push(top);
        }
        // Over three seeds of an hour, each minute: 19.3% to 21.8% of the window covered, 2,836 to
        // 4,746 grains drained.
        expect({ seed, fewest: Math.min(...fills) > 0.15, most: Math.max(...fills) < 0.26, tallest: Math.max(...tallest) < 0.5, drains: Math.min(...drained.slice(2)) > 1000 })
          .toEqual({ seed, fewest: true, most: true, tallest: true, drains: true });
      });
    }
  });

  test("Sand: sand pours from a resting pointer, and a click throws the grains near it up and outward, and they all fall back", async () => {
    const below = { with: [] as number[], without: [] as number[] };
    for (let seed = 71; seed <= 80; seed++) {
      for (const on of [true, false]) {
        await seeded(seed, () => {
          const s = new Sand();
          s.resize(W, H);
          run(s, 1);
          // A spot in the air, away from every spout.
          let px = 100;
          for (let x = 100; x < W - 100; x += 20) if (s.spouts.every((sp) => Math.abs(sp.x - x) > 160)) { px = x; break; }
          const py = H * 0.25;
          s.point(px, py, on);
          run(s, 1.5);
          let n = 0;
          const c0 = Math.floor(px / s.gw);
          for (let r = Math.floor(py / s.gh); r < s.rows * 0.55; r++) for (let c = c0 - 2; c <= c0 + 2; c++) n += s.grain[r * s.cols + c] ? 1 : 0;
          below[on ? "with" : "without"].push(n);
        });
      }
    }
    // Over 40 seeds, falling below a pointer resting 1.5 s: 36 grains every time; without it, none.
    expect({ each: Math.min(...below.with) >= 20, without: Math.max(...below.without) }).toEqual({ each: true, without: 0 });

    for (let seed = 81; seed <= 90; seed++) {
      await seeded(seed, () => {
        const s = new Sand();
        s.resize(W, H);
        for (const sp of s.spouts) [sp.on, sp.until] = [false, Infinity];
        run(s, 6);
        // On the dunes' surface, in the middle.
        const c = Math.floor(W / 2 / s.gw);
        let r = 0;
        while (r < s.rows && !s.grain[r * s.cols + c]) r++;
        const [x, y] = [(c + 0.5) * s.gw, (r + 2) * s.gh];
        const before = s.count + s.drained;
        s.splash(x, y);
        const thrown = s.flying.map((f) => ({ ...f }));
        let secs = 0;
        while (s.flying.length && secs < 5) {
          run(s, 0.1);
          secs += 0.1;
        }
        // Over 20 seeds: 182 to 245 thrown, all outward, most rising; all down within 1.1 s to 1.4 s,
        // not a grain lost.
        expect({ seed, thrown: thrown.length > 100, outward: thrown.every((f) => (f.x - x) * f.vx >= 0), rising: thrown.filter((f) => f.vy < 0).length / thrown.length > 0.7, down: secs < 3, kept: s.count + s.drained - before })
          .toEqual({ seed, thrown: true, outward: true, rising: true, down: true, kept: 0 });
      });
    }
    // A click in the air, where there is no sand to throw: a puff of new grains.
    await seeded(91, () => {
      const s = new Sand();
      s.resize(W, H);
      s.splash(W * 0.3, 40);
      expect(s.flying.length).toBeGreaterThanOrEqual(20);
    });
  });

  // ── Glyph Rain ────────────────────────────────────────────────────────────

  test("Glyph Rain: far columns are smaller and fall slower; each head rerolls its character in each cell it enters, and the characters flip as they fall", async () => {
    await seeded(101, () => {
      const r = new Rain();
      r.resize(W, H);
      // How far each depth's heads fall in a second, in px.
      const at = r.layers.map((L) => new Map(L.streams.map((s) => [s, s.head * L.ch])));
      const entered = { all: 0, rerolled: 0 };
      const flipped = r.layers.map((L) => L.glyphs.slice());
      for (let k = 0; k < 60; k++) {
        const before = r.layers.map((L) => L.streams.map((s) => ({ s, row: Math.floor(s.head), glyphs: L.glyphs.slice() })));
        r.step(STEP);
        r.layers.forEach((L, d) => {
          for (const { s, row, glyphs } of before[d]!) {
            const now = Math.floor(s.head);
            if (now === row || now < 0 || now >= L.rows || !L.streams.includes(s)) continue;
            entered.all++;
            if (L.glyphs[now * L.cols + s.col] !== glyphs[now * L.cols + s.col]) entered.rerolled++;
          }
        });
      }
      const speeds = r.layers.map((L, d) => mean(L.streams.filter((s) => at[d]!.has(s)).map((s) => s.head * L.ch - at[d]!.get(s)!)));
      const sizes = r.layers.map((L) => L.size);
      // Characters flipped on their own in a second: some, not most.
      const flips = r.layers.map((L, d) => L.glyphs.filter((g, i) => g !== flipped[d]![i]).length / L.glyphs.length);
      expect({ sizes: sizes[0]! < sizes[1]! && sizes[1]! < sizes[2]!, speeds: speeds[0]! < speeds[1]! && speeds[1]! < speeds[2]!, rerolled: entered.rerolled / entered.all > 0.9, flips: flips.every((f) => f > 0.05 && f < 0.3) })
        .toEqual({ sizes: true, speeds: true, rerolled: true, flips: true });
    });
  });

  test("Glyph Rain never stops or thickens: over an hour each depth keeps its streams, every column has its turn, and as many characters are on screen", async () => {
    for (const seed of [102, 103]) {
      await seeded(seed, () => {
        const r = new Rain();
        r.resize(W, H);
        const counts = r.layers.map((L) => L.streams.length);
        const cols = r.layers.map(() => new Set<number>());
        const shown: number[] = [];
        for (let i = 1; i <= 3600 / STEP; i++) {
          r.step(STEP);
          if (i % (1 / STEP) === 0) r.layers.forEach((L, k) => { for (const s of L.streams) cols[k]!.add(s.col); });
          if (i % (60 / STEP) === 0) shown.push(streamCells(r).length);
        }
        // Over three seeds of an hour: every column of every depth used; 713 to 1,026 characters on
        // screen each minute.
        expect({ seed, counts: r.layers.map((L) => L.streams.length), cols: cols.map((c, k) => c.size / r.layers[k]!.cols > 0.95), shown: Math.min(...shown) > 450 && Math.max(...shown) < 1400 })
          .toEqual({ seed, counts, cols: [true, true, true], shown: true });
      });
    }
  });

  test("Glyph Rain: the pointer parts the columns round it and the characters near it flicker; a click's ring spreads, scrambling and lighting the characters as it passes", async () => {
    const near: number[] = [];
    const far: number[] = [];
    for (let seed = 111; seed <= 120; seed++) {
      await seeded(seed, () => {
        const r = new Rain();
        r.resize(W, H);
        run(r, 1);
        const [px, py] = [W * 0.35, H * 0.5];
        expect(r.push(px + 30, py)).toBe(0);
        r.point(px, py, true);
        run(r, 0.5);
        // Pushed aside, away from it on each side; untouched beyond its reach.
        expect({ right: r.push(px + 30, py) > 10, left: r.push(px - 30, py) < -10, beyond: r.push(px + PART_REACH + 1, py) }).toEqual({ right: true, left: true, beyond: 0 });
        const L = r.layers[2]!;
        const before = L.glyphs.slice();
        run(r, 1);
        let [n, cn, f, cf] = [0, 0, 0, 0];
        for (let row = 0; row < L.rows; row++) {
          for (let c = 0; c < L.cols; c++) {
            // Not where a stream's head has passed.
            if (L.streams.some((s) => s.col === c && row <= s.head && row > s.head - s.length - 2)) continue;
            const [x, y] = [(c + 0.5) * L.cw, (row + 0.5) * L.ch];
            const changed = Number(L.glyphs[row * L.cols + c] !== before[row * L.cols + c]);
            if (Math.hypot(x - px, y - py) < PART_REACH * 0.6) [n, cn] = [n + changed, cn + 1];
            if (Math.hypot(x - (W - px), y - py) < PART_REACH * 0.6) [f, cf] = [f + changed, cf + 1];
          }
        }
        near.push(n / cn);
        far.push(f / cf);
        // Gone, the columns close again.
        r.point(px, py, false);
        run(r, 1);
        expect(r.push(px + 30, py)).toBe(0);
      });
    }
    // Over 20 seeds, characters near the pointer that flipped in a second: 88% to 100%; as far the
    // other side, 3% to 24%.
    expect({ near: Math.min(...near) > 0.7, far: mean(far) < 0.3 }).toEqual({ near: true, far: true });

    await seeded(121, () => {
      const r = new Rain();
      r.resize(W, H);
      run(r, 1);
      const [x, y] = [W / 2, H / 2];
      const L = r.layers[1]!;
      const first = new Map<number, number>();
      const before = L.glyphs.slice();
      const t0 = r.time;
      r.splash(x, y);
      run(r, 2, () => { for (const i of L.litCells) if (L.lit[i]! > 0.3 && !first.has(i)) first.set(i, r.time - t0); });
      const dist = (i: number) => Math.hypot(((i % L.cols) + 0.5) * L.cw - x, (Math.floor(i / L.cols) + 0.5) * L.ch - y);
      // Each lit as the ring reached it (it was lit within 35 ms of then); none beyond its reach;
      // most of them scrambled.
      const lags = [...first].map(([i, t]) => Math.abs(t - dist(i) / RING_SPEED));
      const scrambled = [...first.keys()].filter((i) => L.glyphs[i] !== before[i]).length / first.size;
      expect({ lit: first.size > 500, onTime: Math.max(...lags) < 0.08, inReach: [...first.keys()].every((i) => dist(i) < RING_REACH), scrambled: scrambled > 0.6 })
        .toEqual({ lit: true, onTime: true, inReach: true, scrambled: true });
    });
  });

  // ── the frame: the clock, the pointer, and nothing named ─────────────────

  /** What a pattern shows, as a string: what lives on the board, where the grains are, where the heads are. */
  const picture = (sim: Sim) =>
    sim instanceof Life ? alive(sim).join(" ")
    : sim instanceof Sand ? Array.from(sim.grain).join("")
    : (sim as Rain).layers.map((L) => L.streams.map((s) => s.head.toFixed(3)).join()).join("|");
  /** Whether it has answered a click: a ring of light on the board, a burst of sand, a ring in the rain. */
  const answered = (sim: Sim) => (sim instanceof Life ? sim.rings.length : sim instanceof Sand ? sim.bursts.length : (sim as Rain).rings.length) > 0;

  test("held, a pattern neither steps nor draws; still, it is one settled picture, drawn again where it is when the theme changes; the pointer and clicks stir it only while it runs; and nothing under the pointer is ever named", async () => {
    const agents = { creatures: [{ id: "a1", agent: "claude", kind: 0.2, size: 1, state: "needs-you" as const }], tiles: [{ x0: 100, y0: 100, x1: 500, y1: 400, id: "a1" }] };
    for (const name of NAMES) {
      await seeded(131, async () => {
        const s = await scene(name, agents);
        try {
          const was = picture(s.sim);
          await new Promise((r) => setTimeout(r, 300));
          expect({ name, draws: s.seen.draws, still: picture(s.sim) === was }).toEqual({ name, draws: 1, still: true });
          // Held, the pointer and a click are no one's: nothing notices them.
          s.host.point(W / 2, H / 2);
          s.host.click(W / 2, H / 2);
          await s.host.settle();
          expect({ name, noticed: s.sim.pointer.active, answered: answered(s.sim) }).toEqual({ name, noticed: false, answered: false });
        } finally {
          s.done();
        }
      });
      await seeded(132, async () => {
        const s = await scene(name, { mode: "still" });
        try {
          const settled = picture(s.sim);
          expect({ name, draws: s.seen.draws }).toEqual({ name, draws: 1 });
          s.host.send({ type: "look", look: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" } });
          await s.host.settle();
          expect({ name, draws: s.seen.draws, moved: picture(s.sim) !== settled }).toEqual({ name, draws: 2, moved: false });
        } finally {
          s.done();
        }
      });
      await seeded(133, async () => {
        const s = await scene(name, { mode: "run", ...agents });
        try {
          // The pointer over the pattern and a click there: it notices, and answers; the app is told
          // of nothing under the pointer, even over the agent's tile, and an agent's turn done is no
          // business of a pattern's.
          for (const [x, y] of [[W / 2, H / 2], [300, 250], [W - 100, H - 60]]) {
            s.host.point(x!, y!);
            await s.host.settle();
            expect({ name, noticed: s.sim.pointer.active }).toEqual({ name, noticed: true });
            expect(s.host.click(x!, y!)).toBe(null);
          }
          s.host.send({ type: "done", id: "a1" });
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
});

// ── its colours, against the app's presets ──────────────────────────────────

const { PRESETS } = await core("settings-schema.ts");
/** A preset's colour (CSS), as the patterns' colours are: sRGB 0 to 255. */
const css = (s: string): Rgb => parseColor(s)!.rgb.map((v) => Math.round(v * 255)) as unknown as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as [number, number, number], b.map((v) => v / 255) as [number, number, number]);
/** `top` at `alpha` over `under`, as the page composites it. */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((v, i) => v * alpha + under[i]! * (1 - alpha)) as unknown as Rgb;
/** The Layers panel over a live wallpaper with See-through: its colour at a sixth (the app's
 *  SEE_THROUGH opacity, 0.5, at a third). */
const TINT = 0.5 / 3;

test("each pattern keeps the frosted panels' text readable over everything it paints across the window, dark and light: names at 7:1 and details at 4.5:1 over its grounds, Life's cells and every grain of sand, hints at 3:1 over the grounds", () => {
  for (const [mode, preset] of [["dark", "signal"], ["light", "clean-light"]] as const) {
    const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
    const rain = RAIN_PALETTE[mode];
    const rainSky = rain.ground.map(rgbOf);
    const grounds: [string, Rgb[]][] = [
      ["Life's board", LIFE_PALETTE[mode].ground.map(rgbOf)],
      ["Sand's sky", SAND_PALETTE[mode].ground.map(rgbOf)],
      ["Glyph Rain's sky, and its glow at its brightest", [...rainSky, over(rgbOf(rain.glow.colour), rain.glow.alpha, rainSky[rainSky.length - 1]!)]],
    ];
    const grains: Rgb[] = [];
    for (let code = 1; code <= CODES; code++) for (let tier = 0; tier < TIERS; tier++) grains.push(grainColour(SAND_PALETTE[mode], code, tier));
    const filled: [string, Rgb[]][] = [["Life's cells", blockColours(LIFE_PALETTE[mode])], ["Sand's grains", grains]];
    for (const [what, colours] of [...grounds, ...filled]) {
      const ground = grounds.some(([g]) => g === what);
      for (const [i, colour] of colours.entries()) {
        const panel = over(css(bg2!), TINT, colour);
        const where = `${mode}: ${what}, ${i}`;
        expect({ where, names: contrast(css(fg!), panel) >= 7, details: contrast(css(fg2!), panel) >= 4.5, hints: !ground || contrast(css(fg3!), panel) >= 3 })
          .toEqual({ where, names: true, details: true, hints: true });
      }
    }
  }
});

// ── the faces they bring ────────────────────────────────────────────────────

/** The characters a WOFF2 font maps to a glyph: its cmap table (formats 4 and 12), read from the
 *  Brotli stream that holds its tables. */
function charactersOf(file: string): Set<number> {
  const TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"];
  const b = readFileSync(file);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(b.subarray(0, 4).toString("latin1")).toBe("wOF2");
  let p = 48;
  const base128 = () => {
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const x = b[p++]!;
      n = n * 128 + (x & 127);
      if (!(x & 128)) break;
    }
    return n;
  };
  const tables: { tag: string; length: number }[] = [];
  for (let k = 0; k < v.getUint16(12); k++) {
    const flags = b[p++]!;
    let tag = TAGS[flags & 63]!;
    if ((flags & 63) === 63) [tag, p] = [b.subarray(p, p + 4).toString("latin1"), p + 4];
    const length = base128();
    const transformed = tag === "glyf" || tag === "loca" ? flags >> 6 !== 3 : flags >> 6 !== 0;
    tables.push({ tag, length: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(b.subarray(p, p + v.getUint32(20)));
  let at = 0;
  for (const t of tables) {
    if (t.tag === "cmap") break;
    at += t.length;
  }
  const c = new DataView(data.buffer, data.byteOffset + at, tables.find((t) => t.tag === "cmap")!.length);
  const chars = new Set<number>();
  for (let k = 0; k < c.getUint16(2); k++) {
    const o = c.getUint32(4 + k * 8 + 4);
    const format = c.getUint16(o);
    if (format === 4) {
      const segs = c.getUint16(o + 6) / 2;
      const [ends, starts] = [o + 14, o + 16 + segs * 2];
      const [deltas, offsets] = [starts + segs * 2, starts + segs * 4];
      for (let s = 0; s < segs; s++) {
        const [start, end, delta, ro] = [c.getUint16(starts + s * 2), c.getUint16(ends + s * 2), c.getUint16(deltas + s * 2), c.getUint16(offsets + s * 2)];
        for (let ch = start; ch <= end && ch !== 0xffff; ch++) {
          const glyph = ro ? c.getUint16(offsets + s * 2 + ro + (ch - start) * 2) : ch;
          if (ro ? glyph && (glyph + delta) & 0xffff : (ch + delta) & 0xffff) chars.add(ch);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < c.getUint32(o + 12); g++) for (let ch = c.getUint32(o + 16 + g * 12); ch <= c.getUint32(o + 20 + g * 12); ch++) chars.add(ch);
    }
  }
  return chars;
}

const WALLPAPERS = ["life", "sand", "glyphs"];
const NAMED: Record<string, string> = { life: "Life", sand: "Sand", glyphs: "Glyph Rain" };
const DRAWN: Record<string, string> = { life: LIFE_GLYPHS, sand: DUST.join(""), glyphs: GLYPHS };

test("every character each pattern draws is in the face its wallpaper brings, and the face's licence goes with it", () => {
  for (const w of WALLPAPERS) {
    const dir = path.join(PKG, "wallpapers", w, "fonts");
    const files = readdirSync(dir);
    const has = new Set(files.filter((f) => f.endsWith(".woff2")).flatMap((f) => [...charactersOf(path.join(dir, f))]));
    const missing = [...DRAWN[w]!].filter((ch) => !has.has(ch.codePointAt(0)!));
    expect({ w, missing, licence: files.includes("OFL.txt") && readFileSync(path.join(dir, "OFL.txt"), "utf8").includes("SIL Open Font License") }).toEqual({ w, missing: [], licence: true });
  }
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

test("the app's package reader takes Patterns as @dip497/patterns, holding the three live wallpapers by their names, and offers Life on install; none asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "patterns" });
  expect({ id: pkg.id, name: pkg.manifest.name, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/patterns", name: "Patterns", members: WALLPAPERS.map((w) => ["wallpaper", `@dip497/patterns/${w}`, NAMED[w]]), startup: "@dip497/patterns/life" });
  for (const w of WALLPAPERS) expect({ w, colour: JSON.parse(readFileSync(path.join(PKG, "wallpapers", w, "hivemind-wallpaper.json"), "utf8")).colour }).toEqual({ w, colour: undefined });
});

test("HiveHub lists Patterns as needing Hivemind 2026.10.8, each wallpaper sandboxed and asking for nothing, and installs each wallpaper's folder (its build, its picture, its face and licence) without the sources or the harness", async () => {
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
    .toEqual(WALLPAPERS.map((w) => ["wallpaper", `@dip497/patterns/${w}`, "sandboxed", []]));
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const w of WALLPAPERS) {
    for (const f of ["dist/main.js", "hivemind-wallpaper.json", "preview.webp", "fonts/jetbrains-mono-latin-600-normal.woff2", "fonts/OFL.txt"]) expect(installs).toContain(`wallpapers/${w}/${f}`);
  }
  expect(installs).toContain("wallpapers/glyphs/fonts/jetbrains-mono-greek-600-normal.woff2");
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

describe("Patterns, built", () => {
  let browser: Browser;
  let server: { url: URL; stop(force?: boolean): void };
  beforeAll(async () => {
    const { serveScenes } = await import("../packages/patterns/harness/serve");
    server = await serveScenes();
    browser = await chromium.launch();
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function load(name: string, mode: "run" | "hold", dpr: number): Promise<{ page: Page; frame: Frame }> {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ name, mode }) => window.start({ scene: name, mode, look: { page: "#1a1c1f", text: "#e8e9eb", attention: "#e8b04a", dark: true, colour: false, mono: "'Not A Font Here', monospace" } }), { name, mode });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 10_000 });
    return { page, frame: page.frames().find((f) => f.url().includes("/wp/"))! };
  }
  /** What the pattern's canvas shows, as a number. */
  const shown = (frame: Frame) => frame.evaluate(() => {
    const c = document.querySelector("canvas")!;
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]!) | 0;
    return h;
  });

  for (const name of WALLPAPERS) {
    test(`${NAMED[name]}: in its sandboxed frame it says it speaks protocol 1 and that its first frame is up, and nothing else; draws a canvas the viewport's size times its pixel ratio, in the face it brings; moves while it runs and not while held`, async () => {
      const { page, frame } = await load(name, "run", 2);
      try {
        await new Promise((r) => setTimeout(r, 600));
        const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused }));
        expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
        const canvas = await frame.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; });
        expect(canvas).toEqual([2560, 1600, 1280, 800]);
        // Its own face, from its own folder (Glyph Rain's in two parts, Latin and Greek): the person's
        // font is not in the frame.
        expect(await frame.evaluate(() => [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Patterns Mono").map((f) => f.status))).toEqual(name === "glyphs" ? ["loaded", "loaded"] : ["loaded"]);
        const a = await shown(frame);
        await new Promise((r) => setTimeout(r, 500));
        expect(await shown(frame)).not.toBe(a);
        await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
        await new Promise((r) => setTimeout(r, 200));
        const held = await shown(frame);
        await new Promise((r) => setTimeout(r, 800));
        expect(await shown(frame)).toBe(held);
      } finally {
        await page.close();
      }
    }, 60_000);
  }
});
