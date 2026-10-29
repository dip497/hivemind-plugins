// Bees, run in headless Chromium from its build as the app serves it, against the SDK's fake host,
// with tiles and a glass panel over it as the app draws them: pictures dark and light, calm, with
// the pointer playing over the meadow and after a click, at 2× and as a still frame; then its frame
// times. Chromium here draws in software, so the times are an upper bound for a computer with a GPU.
//
//   npm run build && bun packages/hive/harness/shoot.ts [--out <dir>] [--preview] [--perf]
//
// --preview writes wallpapers/bees/preview.webp: the wallpaper alone, at dusk.
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { core } from "../../../tests/app";
import { parseColor } from "../../../tests/colour";
import { BEES, serveBees } from "./serve";
import type { FrameTime, Scenario } from "./page";

const args = process.argv.slice(2);
const OUT = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : path.join(import.meta.dir, "shots"));
mkdirSync(OUT, { recursive: true });

const { PRESETS } = await core("settings-schema.ts");
const hex = (c: string) => `#${parseColor(c)!.rgb.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;

/** A preset's look, as the app tells a wallpaper it, and its panels' colours. */
function scenario(id: string, w: number, h: number): Scenario {
  const { palette: p, mode } = PRESETS[id] as { palette: Record<string, string>; mode: string };
  const k = w / 1440;
  const at = (x0: number, y0: number, x1: number, y1: number) => ({ x0: Math.round(x0 * k), y0: Math.round(y0 * (h / 900)), x1: Math.round(x1 * k), y1: Math.round(y1 * (h / 900)) });
  return {
    look: { page: hex(p.bg!), text: hex(p.fg!), attention: hex(p.warn!), dark: mode !== "light", colour: false, mono: "'DejaVu Sans Mono', monospace" },
    chrome: { bg2: hex(p.bg2!), fg: hex(p.fg!), fg2: hex(p.fg2!), fg3: hex(p.fg3!), line: hex(p.line!) },
    mode: "run",
    // The agents and tiles the app tells a wallpaper; Bees takes no notice of them.
    creatures: [
      { id: "a1", agent: "claude", kind: 0.05, size: 1, state: "needs-you" },
      { id: "a2", agent: "claude", kind: 0.05, size: 0.9, state: "working" },
      { id: "a3", agent: "codex", kind: 0.3, size: 0.85, state: "resting" },
    ],
    tiles: [
      { ...at(400, 90, 900, 430), id: "a1", name: "claude · api", lines: ["Edit src/server.ts?", "", "  1. Yes", "  2. Yes, and don't ask again", "  3. No, tell Claude what to do"] },
      { ...at(940, 120, 1300, 390), id: "a2", name: "claude · web", lines: ["Reading 14 files…", "Running tests (38 passed)"] },
    ],
    panel: { ...at(1180, 560, 1420, 860), lines: ["Layers", "api · needs you", "web · working", "docs · ready", "infra · resting", "notes · working"] },
  };
}

const server = await serveBees();
const browser = await chromium.launch({ args: ["--disable-lcd-text"] });

async function open(s: Scenario, size: { width: number; height: number }, dpr = 1): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error" || (m.type() === "warning" && !/willReadFrequently/.test(m.text()))) console.error(`[${m.type()}] ${m.text()}`); });
  await page.goto(server.url.href);
  await page.evaluate((sc) => window.start(sc), s);
  await page.waitForFunction(() => window.host.drawn);
  return page;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The pointer resting over the meadow, wandering a little round (x, y), for `ms`. */
async function play(page: Page, x: number, y: number, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = (Date.now() - t0) / 1000;
    await page.evaluate(([px, py]) => window.pointAt(px!, py!), [x + Math.sin(t * 0.7) * 30, y + Math.sin(t * 1.1) * 14]);
    await wait(60);
  }
}
const shots: string[] = [];
const shoot = async (page: Page, name: string) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
};

const SIZE = { width: 1440, height: 900 };
for (const [id, name] of [["signal", "dark"], ["clean-light", "light"]] as const) {
  const page = await open(scenario(id, SIZE.width, SIZE.height), SIZE);
  await wait(2500);
  await shoot(page, `${name}-calm`);
  // The pointer over the meadow: a few bees come and circle it.
  await play(page, 760, 560, 5000);
  await shoot(page, `${name}-pointer`);
  await play(page, 760, 560, 2500);
  await shoot(page, `${name}-pointer-later`);
  // A click among the flowers: a puff of pollen, the bees near it scatter, then come back.
  await page.evaluate(() => window.clickAt(560, 770));
  await wait(350);
  await shoot(page, `${name}-click`);
  await wait(900);
  await shoot(page, `${name}-scatter`);
  await page.evaluate(() => window.pointAt(0, 0, false));
  await wait(5000);
  await shoot(page, `${name}-after`);
  await page.close();
}

// On a 2× screen: sharp, each cell twice the pixels.
{
  const page = await open(scenario("signal", 1280, 800), { width: 1280, height: 800 }, 2);
  await wait(3000);
  await shoot(page, "dark-2x");
  await page.close();
}

// A still frame: motion off. A pointer and a click change nothing in it.
for (const [id, name] of [["signal", "dark"], ["clean-light", "light"]] as const) {
  const s = scenario(id, SIZE.width, SIZE.height);
  s.mode = "still";
  const page = await open(s, SIZE);
  await wait(300);
  await page.evaluate(() => { window.pointAt(700, 600); window.clickAt(700, 600); });
  const before = await page.evaluate(() => window.frameTimes.length);
  await wait(1000);
  console.log(`still ${name}: ${(await page.evaluate(() => window.frameTimes.length)) - before} frames in a second (want 0)`);
  await shoot(page, `still-${name}`);
  await page.close();
}

if (args.includes("--preview")) {
  // The wallpaper alone at 2×, the hive, the meadow and the colony, cropped to 16:10 and made small
  // for the picker.
  const s = scenario("signal", 1280, 800);
  s.bare = true;
  const page = await open(s, { width: 1280, height: 800 }, 2);
  await wait(6000);
  await page.screenshot({ path: path.join(OUT, "preview-source.png"), clip: { x: 320, y: 200, width: 960, height: 600 } });
  shots.push(path.join(OUT, "preview-source.png"));
  await page.close();
  const out = path.join(BEES, "preview.webp");
  execFileSync("convert", [path.join(OUT, "preview-source.png"), "-resize", "960x600", "-quality", "86", "-define", "webp:method=6", out]);
  console.log(`wrote ${out}`);
}

if (args.includes("--perf")) {
  const stats = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
    return `median ${q(0.5).toFixed(2)} ms, p90 ${q(0.9).toFixed(2)} ms (${s.length} frames)`;
  };
  for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
    for (const [id, name] of [["signal", "dark"], ["clean-light", "light"]] as const) {
      const page = await open(scenario(id, w, h), { width: w, height: h }, dpr);
      await wait(1500);
      await page.evaluate(() => { window.frameTimes = []; });
      const t0 = Date.now();
      // Some 600 frames, the pointer playing over the meadow for the first half.
      await play(page, w * 0.5, h * 0.62, 10_000);
      await page.evaluate(() => window.pointAt(0, 0, false));
      await wait(10_000);
      const times = await page.evaluate(() => window.frameTimes) as FrameTime[];
      const seconds = (Date.now() - t0) / 1000;
      console.log(`${w}×${h} at ${dpr}×, ${name}: ${(times.length / seconds).toFixed(1)} frames/s; script ${stats(times.map((t) => t.js))}; painted ${stats(times.map((t) => t.painted))}`);
      // Held: nothing at all.
      await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
      await wait(300);
      const held = await page.evaluate(() => window.frameTimes.length);
      await wait(1000);
      console.log(`  held: ${(await page.evaluate(() => window.frameTimes.length)) - held} frames in a second (want 0)`);
      await page.close();
    }
  }
}

console.log(shots.join("\n"));
await browser.close();
server.stop(true);
