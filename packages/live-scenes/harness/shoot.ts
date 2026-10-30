// Live scenes, run in headless Chromium from their build as the app serves them, against the SDK's
// fake host: each scene's picture for the picker, and the time each scene's draw takes. Chromium
// here draws in software, so the times are an upper bound for a computer with a GPU.
//
//   npm run build && bun packages/live-scenes/harness/shoot.ts [--preview] [--perf] [--out <dir>]
//
// --preview writes wallpapers/<scene>/preview.webp: the scene alone, 960×600, dark, drawn at 2× and
// made small. --perf times 600 draws of each scene at 1440×900 at 1× and 1280×800 at 2×, dark and
// light, and prints the median and the 90th percentile.
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCENES, serveScenes, WALLPAPERS } from "./serve";

const args = process.argv.slice(2);
const OUT = path.resolve(args.includes("--out") ? args[args.indexOf("--out") + 1]! : path.join(import.meta.dir, "shots"));
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

if (args.includes("--preview")) {
  for (const scene of SCENES) {
    const page = await open(scene, "dark", { width: 960, height: 600 }, 2);
    await wait(7000);
    const shot = path.join(OUT, `preview-${scene}.png`);
    await page.screenshot({ path: shot });
    await page.close();
    const out = path.join(WALLPAPERS, scene, "preview.webp");
    execFileSync("convert", [shot, "-resize", "960x600", "-quality", "88", "-define", "webp:method=6", out]);
    console.log(`wrote ${out}`);
  }
}

if (args.includes("--perf")) {
  const stats = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return `median ${s[Math.floor(s.length * 0.5)]!.toFixed(2)} ms, p90 ${s[Math.floor(s.length * 0.9)]!.toFixed(2)} ms`;
  };
  for (const scene of SCENES) {
    for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
      for (const theme of ["dark", "light"] as const) {
        const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
        await page.goto(new URL("/perf.html", server.url).href);
        const times = await page.evaluate(({ scene, look }) => window.measure(scene, look, 600), { scene, look: LOOK[theme] });
        console.log(`${scene.padEnd(10)} ${w}×${h} at ${dpr}×, ${theme.padEnd(5)}: ${stats(times)}`);
        await page.close();
      }
    }
  }
}

await browser.close();
server.stop(true);
