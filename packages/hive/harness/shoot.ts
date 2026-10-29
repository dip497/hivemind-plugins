// Bees, run in headless Chromium from its build as the app serves it, against the SDK's fake host:
// five agents of three programs in all four states and two tiles, pictured at a few moments in the
// theme's colours and its own, dark and light, at 2×, and as a still frame; then its frame times.
// Chromium here draws in software, so the times are an upper bound for a computer with a GPU.
//
//   npm run build && bun packages/hive/harness/shoot.ts [--out <dir>] [--preview] [--perf]
//
// --preview writes wallpapers/bees/preview.webp: the wallpaper alone, in its own colours at dusk.
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
/** A preset's colours, as the app tells a wallpaper them and draws its panels. */
function theme(id: string, colour: boolean) {
  const { palette: p, mode } = PRESETS[id] as { palette: Record<string, string>; mode: string };
  return {
    look: { page: hex(p.bg!), text: hex(p.fg!), attention: hex(p.warn!), dark: mode !== "light", colour, mono: "'DejaVu Sans Mono', monospace" },
    chrome: { bg2: hex(p.bg2!), fg: hex(p.fg!), fg2: hex(p.fg2!), fg3: hex(p.fg3!), line: hex(p.line!) },
  };
}

// Five agents of three programs: claude's two honeybees (one needs you, one at work), codex's two
// bumblebees (ready, resting), pi's leafcutter at work.
const CREATURES = [
  { id: "c1", agent: "claude", kind: 0.05, size: 1, state: "needs-you" },
  { id: "c2", agent: "claude", kind: 0.05, size: 0.86, state: "working" },
  { id: "c3", agent: "codex", kind: 0.2, size: 0.92, state: "ready" },
  { id: "c4", agent: "codex", kind: 0.2, size: 0.8, state: "resting" },
  { id: "c5", agent: "pi", kind: 0.55, size: 0.95, state: "working" },
] as const;

function scenario(id: string, colour: boolean, w: number, h: number): Scenario {
  const { look, chrome } = theme(id, colour);
  const k = w / 1440;
  const at = (x0: number, y0: number, x1: number, y1: number) => ({ x0: Math.round(x0 * k), y0: Math.round(y0 * (h / 900)), x1: Math.round(x1 * k), y1: Math.round(y1 * (h / 900)) });
  return {
    look, chrome, mode: "run", seeThrough: true,
    creatures: CREATURES.map((c) => ({ ...c })),
    tiles: [
      { ...at(400, 120, 900, 470), id: "c1", name: "claude · api", lines: ["Edit src/server.ts?", "", "  1. Yes", "  2. Yes, and don't ask again", "  3. No, tell Claude what to do"] },
      { ...at(940, 150, 1300, 420), id: "c2", name: "claude · web", lines: ["Reading 14 files…", "Running tests (38 passed)"] },
    ],
    panel: { ...at(1180, 600, 1420, 870), lines: ["Layers", "api · needs you", "web · working", "docs · ready", "infra · resting", "notes · working"] },
  };
}

const server = await serveBees();
const browser = await chromium.launch({ args: ["--disable-lcd-text"] });

async function open(s: Scenario, size: { width: number; height: number }, dpr = 1): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`[${m.type()}] ${m.text()}`); });
  await page.goto(server.url.href);
  await page.evaluate((sc) => window.start(sc), s);
  await page.waitForFunction(() => window.host.drawn);
  return page;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const send = (page: Page, m: object) => page.evaluate((msg) => window.host.send(msg as never), m);
const shots: string[] = [];
const shoot = async (page: Page, name: string) => {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  shots.push(file);
};

const SIZE = { width: 1440, height: 900 };
for (const [id, colour, name] of [["signal", false, "dark-mono"], ["clean-light", false, "light-mono"], ["signal", true, "dark-colour"], ["clean-light", true, "light-colour"]] as const) {
  const page = await open(scenario(id, colour, SIZE.width, SIZE.height), SIZE);
  await wait(2500);
  await shoot(page, `${name}-1`);
  await wait(3500);
  await shoot(page, `${name}-2`);
  // A turn ends well for the leafcutter: a quick loop, and a burst of pollen.
  await send(page, { type: "done", id: "c5" });
  await wait(450);
  await shoot(page, `${name}-loop`);
  await wait(650);
  await shoot(page, `${name}-burst`);
  // A click in the open by the flowers scatters the small bees.
  await page.evaluate(() => window.host.point(700, innerHeight - 60));
  await page.evaluate(() => window.host.click(700, innerHeight - 60));
  await wait(450);
  await shoot(page, `${name}-scatter`);
  await page.close();
}

// On a 2× screen: sharp, each cell twice the pixels.
{
  const page = await open(scenario("signal", true, 1280, 800), { width: 1280, height: 800 }, 2);
  await wait(3000);
  await shoot(page, "dark-colour-2x");
  await page.close();
}

// A still frame: motion off.
{
  const s = scenario("signal", true, SIZE.width, SIZE.height);
  s.mode = "still";
  const page = await open(s, SIZE);
  await wait(300);
  await shoot(page, "still-dark-colour");
  const before = await page.evaluate(() => window.frameTimes.length);
  await wait(1000);
  console.log(`still: ${(await page.evaluate(() => window.frameTimes.length)) - before} frames in a second (want 0)`);
  await page.close();
}

if (args.includes("--preview")) {
  // The wallpaper alone at 2×, its agent that needs you dancing under its (unseen) tile: the hive,
  // the meadow and the bees, cropped to 16:10 and made small for the picker.
  const s = scenario("signal", true, 1280, 800);
  s.bare = true;
  s.tiles = [{ x0: 300, y0: 40, x1: 1260, y1: 380, id: "c1" }];
  const page = await open(s, { width: 1280, height: 800 }, 2);
  await wait(6000);
  await page.screenshot({ path: path.join(OUT, "preview-source.png"), clip: { x: 0, y: 200, width: 960, height: 600 } });
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
    for (const [id, colour] of [["signal", true], ["signal", false]] as const) {
      const page = await open(scenario(id, colour, w, h), { width: w, height: h }, dpr);
      await wait(1500);
      await page.evaluate(() => { window.frameTimes = []; });
      const t0 = Date.now();
      // Some 600 frames.
      await wait(20_000);
      const times = await page.evaluate(() => window.frameTimes) as FrameTime[];
      const seconds = (Date.now() - t0) / 1000;
      console.log(`${w}×${h} at ${dpr}×, ${colour ? "colour" : "mono"}: ${(times.length / seconds).toFixed(1)} frames/s; script ${stats(times.map((t) => t.js))}; painted ${stats(times.map((t) => t.painted))}`);
      // Held: nothing at all.
      await send(page, { type: "mode", mode: "hold" });
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
