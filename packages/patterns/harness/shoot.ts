// Patterns, run in headless Chromium from their build as the app serves them, against the SDK's
// fake host: each pattern's picture for the picker, pictures of it at play, and the time each
// pattern's draw takes. Chromium here draws in software (WebGL on SwiftShader), so the times are an
// upper bound for a computer with a GPU.
//
//   npm run build && bun packages/patterns/harness/shoot.ts [--preview] [--shots] [--perf] [--only <pattern>] [--out <dir>]
//
// --preview writes wallpapers/<pattern>/preview.webp: the pattern alone, 960×600, dark, drawn at 2×
// and made small. --shots pictures each pattern dark and light at 1440×900: running, with the
// pointer resting, just after a click, and a close-up. --perf times 600 draws of each pattern at
// 1440×900 at 1× and 1280×800 at 2×, dark and light, and prints the median and the 90th percentile
// of the script's time and of the time with the canvas painted.
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SCENES, serveScenes, WALLPAPERS } from "./serve";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = path.resolve(arg("--out") ?? path.join(os.tmpdir(), "patterns-shots"));
const ONLY = arg("--only");
const PATTERNS = SCENES.filter((s) => !ONLY || s === ONLY);
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
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`[${m.type()}] ${m.text()}`); });
  await page.goto(server.url.href);
  await page.evaluate((s) => window.start(s as never), { scene, look: LOOK[theme], mode: "run" });
  await page.waitForFunction(() => window.host.drawn);
  return page;
}

try {
  if (args.includes("--preview")) {
    for (const scene of PATTERNS) {
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

  if (args.includes("--shots")) {
    for (const scene of PATTERNS) {
      for (const theme of ["dark", "light"] as const) {
        const page = await open(scene, theme, { width: 1440, height: 900 }, 1);
        const shot = (name: string, clip?: { x: number; y: number; width: number; height: number }) => page.screenshot({ path: path.join(OUT, `${scene}-${theme}-${name}.png`), ...(clip ? { clip } : {}) });
        await wait(5000);
        await shot("1run");
        const [px, py] = [560, 420];
        for (let i = 0; i < 20; i++) {
          await page.evaluate(([x, y]) => window.host.point(x!, y!), [px + Math.sin(i) * 2, py]);
          await wait(150);
        }
        await shot("2pointer");
        await page.evaluate(([x, y]) => window.host.click(x!, y!), [px + 300, py + 120]);
        await wait(450);
        await shot("3click");
        await wait(1500);
        await shot("4after");
        await shot("5close", { x: px + 60, y: py - 30, width: 480, height: 300 });
        await page.close();
        console.log(`pictured ${scene} ${theme}`);
      }
    }
  }

  if (args.includes("--perf")) {
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return `median ${s[Math.floor(s.length * 0.5)]!.toFixed(2)} ms, p90 ${s[Math.floor(s.length * 0.9)]!.toFixed(2)} ms`;
    };
    for (const scene of PATTERNS) {
      for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
        for (const theme of ["dark", "light"] as const) {
          const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
          await page.goto(new URL("/perf.html", server.url).href);
          const { js, painted } = await page.evaluate(({ scene, look }) => window.measure(scene, look, 600), { scene, look: LOOK[theme] });
          console.log(`${scene.padEnd(7)} ${w}×${h} at ${dpr}×, ${theme.padEnd(5)}: script ${stats(js)}; painted ${stats(painted)}`);
          await page.close();
        }
      }
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
console.log(`pictures in ${OUT}`);
