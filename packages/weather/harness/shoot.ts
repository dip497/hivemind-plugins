// Weather's scenes, run in headless Chromium from their build as the app serves them, against the
// SDK's fake host: each scene's picture for the picker, a look at each, and the time each scene's
// draw takes. Chromium here draws in software, so the times are an upper bound for a computer with
// a GPU.
//
//   npm run build && bun packages/weather/harness/shoot.ts [--preview] [--look] [--perf] [--only <scene>] [--out <dir>]
//
// --preview writes wallpapers/<scene>/preview.webp: the scene alone, 960×600, dark, drawn at 2× and
// made small. --look writes, for each scene dark and light at 1440×900, the scene running, with the
// pointer resting and moving, just after a click, and a close-up of each. --perf times 600 draws of
// each scene at 1440×900 at 1× and 1280×800 at 2×, dark and light, the pointer moving and clicking,
// and prints the median and the 90th percentile.
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCENES, serveScenes, WALLPAPERS } from "./serve";

const args = process.argv.slice(2);
const OUT = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : path.join(import.meta.dir, "shots"));
const ONLY = args.includes("--only") ? args[args.indexOf("--only") + 1]!.split(",") : [...SCENES];
mkdirSync(OUT, { recursive: true });
const LOOK = {
  dark: { page: "#14161a", text: "#e6e8eb", attention: "#e3b341", dark: true, colour: false, mono: "monospace" },
  light: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" },
};

const server = await serveScenes();
const browser = await chromium.launch({ args: ["--disable-lcd-text"] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(scene: string, theme: "dark" | "light", size: { width: number; height: number }, dpr: number): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(server.url.href);
  await page.evaluate((s) => window.start(s as never), { scene, look: LOOK[theme], mode: "run" });
  await page.waitForFunction(() => window.host.drawn);
  return page;
}

try {
  if (args.includes("--preview")) {
    for (const scene of ONLY) {
      const page = await open(scene, "dark", { width: 960, height: 600 }, 2);
      await wait(6000);
      const shot = path.join(OUT, `preview-${scene}.png`);
      await page.screenshot({ path: shot });
      await page.close();
      const out = path.join(WALLPAPERS, scene, "preview.webp");
      execFileSync("convert", [shot, "-resize", "960x600", "-quality", "88", "-define", "webp:method=6", out]);
      console.log(`wrote ${out}`);
    }
  }

  if (args.includes("--look")) {
    for (const scene of ONLY) {
      for (const theme of ["dark", "light"] as const) {
        const page = await open(scene, theme, { width: 1440, height: 900 }, 1);
        const shot = async (name: string, clip?: { x: number; y: number; width: number; height: number }) => {
          const file = path.join(OUT, `${scene}-${theme}-${name}.png`);
          await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
          console.log(file);
        };
        await wait(4000);
        await shot("1run");
        const [px, py] = [520, 420];
        await page.evaluate(([x, y]) => window.host.point(x!, y!), [px, py]);
        for (let i = 0; i < 30; i++) {
          await wait(60);
          await page.evaluate(([x, y]) => window.host.point(x!, y!), [px + i * 9, py + Math.sin(i / 4) * 40]);
        }
        await wait(1500);
        await shot("2pointer");
        await page.evaluate(([x, y]) => window.host.click(x!, y!), [900, 520]);
        await wait(300);
        await shot("3click");
        await wait(1200);
        await shot("4after");
        await shot("5close", { x: 660, y: 380, width: 480, height: 300 });
        await shot("6bottom", { x: 0, y: 560, width: 720, height: 340 });
        await page.close();
      }
    }
  }

  if (args.includes("--perf")) {
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return `median ${s[Math.floor(s.length * 0.5)]!.toFixed(2)} ms, p90 ${s[Math.floor(s.length * 0.9)]!.toFixed(2)} ms`;
    };
    for (const scene of ONLY) {
      for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
        for (const theme of ["dark", "light"] as const) {
          for (const flush of [false, true]) {
            const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
            await page.goto(new URL("/perf.html", server.url).href);
            const times = await page.evaluate(({ scene, look, flush }) => window.measure(scene, look, 600, flush), { scene, look: LOOK[theme], flush });
            console.log(`${scene.padEnd(16)} ${w}×${h} at ${dpr}×, ${theme.padEnd(5)}${flush ? ", painted" : "         "}: ${stats(times)}`);
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
