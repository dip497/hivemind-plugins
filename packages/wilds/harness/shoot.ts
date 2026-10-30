// Wilds, run in headless Chromium from its build as the app serves it, against the SDK's fake host:
// each scene's picture for the picker, quick pictures of each scene at play, and the time each
// scene's draw takes. Chromium here draws in software, so the times are an upper bound for a
// computer with a GPU.
//
//   npm run build && bun packages/wilds/harness/shoot.ts [--scene <name>] [--preview] [--look] [--perf] [--out <dir>]
//
// --frames <n> times n draws instead of 600. --preview writes wallpapers/<scene>/preview.webp: the scene alone, 960×600, dark, drawn at 2× and
// made small. --look draws each scene dark and light at 1440×900: running, the pointer resting, just
// after a click, into --out (the system's temp folder unless given). --perf times 600 draws of each
// scene at 1440×900 at 1× and 1280×800 at 2×, dark and light, and prints the median and the 90th
// percentile; with the pointer resting and a click every two seconds too (`play`).
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCENES, serveScenes, WALLPAPERS } from "./serve";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = path.resolve(opt("--out") ?? path.join(os.tmpdir(), "wilds-shots"));
const ONLY = opt("--scene");
const FRAMES = Number(opt("--frames") ?? 600);
const scenes = SCENES.filter((s) => !ONLY || s === ONLY);
mkdirSync(OUT, { recursive: true });
const LOOK = {
  dark: { page: "#14161a", text: "#e6e8eb", attention: "#e3b341", dark: true, colour: false, mono: "monospace" },
  light: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" },
};

const server = await serveScenes();
const browser = await chromium.launch({ args: ["--disable-lcd-text"] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  async function open(scene: string, theme: "dark" | "light", size: { width: number; height: number }, dpr: number): Promise<Page> {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    page.on("console", (m) => { if (m.type() === "error") console.error("console:", m.text()); });
    await page.goto(server.url.href);
    await page.evaluate((s) => window.start(s as never), { scene, look: LOOK[theme], mode: "run" });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 15_000 });
    return page;
  }

  if (args.includes("--preview")) {
    for (const scene of scenes) {
      const page = await open(scene, "dark", { width: 960, height: 600 }, 2);
      await wait(7000);
      const shot = path.join(OUT, `preview-${scene}.png`);
      await page.screenshot({ path: shot });
      await page.close();
      const out = path.join(WALLPAPERS, scene, "preview.webp");
      execFileSync("convert", [shot, "-resize", "960x600", "-quality", "86", "-define", "webp:method=6", out]);
      console.log(`wrote ${out}`);
    }
  }

  if (args.includes("--look")) {
    for (const scene of scenes) {
      for (const theme of ["dark", "light"] as const) {
        const page = await open(scene, theme, { width: 1440, height: 900 }, 1);
        const shot = async (name: string) => {
          const file = path.join(OUT, `${scene}-${theme}-${name}.png`);
          await page.screenshot({ path: file });
          console.log(file);
        };
        await wait(1500);
        await shot("0first");
        await wait(2500);
        await shot("1run");
        const [px, py] = [720, 640];
        for (let i = 0; i < 30; i++) {
          await page.evaluate(([x, y]) => window.host.point(x!, y!), [px + Math.sin(i / 3) * 6, py]);
          await wait(100);
        }
        await shot("2pointer");
        await page.evaluate(([x, y]) => window.host.click(x!, y!), [px, py]);
        await wait(450);
        await shot("3click");
        await wait(1200);
        await shot("4after");
        await page.close();
      }
    }
  }

  if (args.includes("--perf")) {
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return `median ${s[Math.floor(s.length * 0.5)]!.toFixed(2)} ms, p90 ${s[Math.floor(s.length * 0.9)]!.toFixed(2)} ms`;
    };
    for (const scene of scenes) {
      for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
        for (const theme of ["dark", "light"] as const) {
          for (const play of [false, true]) {
            const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
            await page.goto(new URL("/perf.html", server.url).href);
            const times = await page.evaluate(({ scene, look, play, frames }) => window.measure(scene, look, frames, play), { scene, look: LOOK[theme], play, frames: FRAMES });
            console.log(`${scene.padEnd(9)} ${w}×${h} at ${dpr}×, ${theme.padEnd(5)}${play ? " play" : "     "}: ${stats(times)}`);
            await page.close();
          }
        }
      }
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
