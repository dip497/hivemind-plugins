// Blocks, run in headless Chromium from their build as the app serves them, against the SDK's fake
// host: each scene's picture for the picker, a look at each (running, the pointer resting, just
// after a click), and the time each scene's draw takes. Chromium here draws in software (WebGL on
// SwiftShader), so the times are an upper bound for a computer with a GPU.
//
//   npm run build && bun packages/blocks/harness/shoot.ts [--preview] [--look] [--perf] [--only <scene>] [--out <dir>]
//
// --preview writes wallpapers/<scene>/preview.webp: the scene alone, 960×600, dark, drawn at 2× and
// made small. --look writes pictures of each scene, dark and light, 1440×900, to --out. --perf times
// 600 draws of each scene at 1440×900 at 1× and 1280×800 at 2×, dark and light, and prints the median
// and the 90th percentile of the draw, of the frame (its steps and its draw), and of the draw made to
// paint. That last is SwiftShader's software rasterizer at work, plus the read back itself (here, an
// unchanged canvas the window's size takes 14 ms to read back in 2D and 31 ms in WebGL2 at 1440×900
// at 1×): a measure of nothing a GPU does, kept to compare one build with the next.
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCENES, serveScenes, WALLPAPERS } from "./serve";

const args = process.argv.slice(2);
const arg = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const OUT = path.resolve(arg("--out") ?? path.join(import.meta.dir, "shots"));
const ONLY = arg("--only")?.split(",");
const scenes = SCENES.filter((s) => !ONLY || ONLY.includes(s));
mkdirSync(OUT, { recursive: true });
const LOOK = {
  dark: { page: "#14161a", text: "#e6e8eb", attention: "#e3b341", dark: true, colour: false, mono: "monospace" },
  light: { page: "#f6f6f4", text: "#1d1f22", attention: "#b8860b", dark: false, colour: false, mono: "monospace" },
};

const server = await serveScenes();
// WebGL in a headless browser draws on SwiftShader, in software.
const browser = await chromium.launch({ args: ["--disable-lcd-text", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(scene: string, theme: "dark" | "light", size: { width: number; height: number }, dpr: number): Promise<Page> {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.error(`[${m.type()}]`, m.text()); });
  await page.goto(server.url.href);
  await page.evaluate((s) => window.start(s as never), { scene, look: LOOK[theme], mode: "run" });
  await page.waitForFunction(() => window.host.drawn);
  return page;
}

try {
  if (args.includes("--preview")) {
    for (const scene of scenes) {
      const page = await open(scene, "dark", { width: 960, height: 600 }, 2);
      await wait(6000);
      const shot = path.join(OUT, `preview-${scene}.png`);
      await page.screenshot({ path: shot });
      await page.close();
      const out = path.join(WALLPAPERS, scene, "preview.webp");
      execFileSync("convert", [shot, "-resize", "960x600", "-quality", "86", "-define", "webp:method=6", out]);
      console.log(`wrote ${out}`);
    }
  }

  if (args.includes("--look")) {
    const [px, py] = (arg("--at") ?? "560,600").split(",").map(Number) as [number, number];
    for (const scene of scenes) {
      for (const theme of ["dark", "light"] as const) {
        const page = await open(scene, theme, { width: 1440, height: 900 }, 1);
        await wait(4000);
        await page.screenshot({ path: path.join(OUT, `${scene}-${theme}-1run.png`) });
        await page.evaluate(([x, y]) => window.host.point(x!, y!), [px, py]);
        await wait(5000);
        await page.screenshot({ path: path.join(OUT, `${scene}-${theme}-2pointer.png`) });
        await page.evaluate(([x, y]) => window.host.click(x!, y!), [px, py]);
        await wait(400);
        await page.screenshot({ path: path.join(OUT, `${scene}-${theme}-3click.png`) });
        await wait(2500);
        await page.screenshot({ path: path.join(OUT, `${scene}-${theme}-4after.png`), clip: { x: Math.max(0, px - 300), y: Math.max(0, py - 200), width: 600, height: 400 } });
        await page.close();
        console.log(`looked at ${scene} ${theme}`);
      }
    }
  }

  if (args.includes("--perf")) {
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      return `${s[Math.floor(s.length * 0.5)]!.toFixed(2)} / ${s[Math.floor(s.length * 0.9)]!.toFixed(2)}`;
    };
    for (const scene of scenes) {
      for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
        for (const theme of ["dark", "light"] as const) {
          const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
          page.on("pageerror", (e) => console.error("page error:", e.message));
          await page.goto(new URL("/perf.html", server.url).href);
          const { draw, frame, painted } = await page.evaluate(({ scene, look }) => window.measure(scene, look, 600), { scene, look: LOOK[theme] });
          console.log(`${scene.padEnd(10)} ${w}×${h} at ${dpr}×, ${theme.padEnd(5)}: median / p90 ms: draw ${stats(draw)}, steps and draw ${stats(frame)}, painted ${stats(painted)}`);
          await page.close();
        }
      }
    }
  }

  // --cpu: the share of one core the browser's processes (the page's, and the one that draws for
  // it) spend on a scene running, from their CPU time over ten seconds: what the app's watchdog
  // weighs. Run it on a quiet machine; other work on the same cores inflates it.
  if (args.includes("--cpu")) {
    const { readFileSync, readdirSync } = await import("node:fs");
    const tree = (root: number) => {
      const kids = new Map<number, number[]>();
      for (const d of readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
        try {
          const stat = readFileSync(`/proc/${d}/stat`, "utf8");
          const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
          kids.set(ppid, [...(kids.get(ppid) ?? []), Number(d)]);
        } catch { /* gone */ }
      }
      const out: number[] = [];
      const walk = (p: number) => { out.push(p); for (const k of kids.get(p) ?? []) walk(k); };
      walk(root);
      return out;
    };
    const ticks = (pids: number[]) => pids.reduce((sum, p) => {
      try {
        const f = readFileSync(`/proc/${p}/stat`, "utf8").slice(readFileSync(`/proc/${p}/stat`, "utf8").lastIndexOf(")") + 2).split(" ");
        return sum + Number(f[11]) + Number(f[12]);
      } catch { return sum; }
    }, 0);
    const root = Number(readFileSync("/proc/self/stat", "utf8").split(" ")[0]);
    for (const scene of scenes) {
      for (const [w, h, dpr] of [[1440, 900, 1], [1280, 800, 2]] as const) {
        const page = await open(scene, "dark", { width: w, height: h }, dpr);
        await wait(3000);
        const pids = tree(root).filter((p) => p !== root);
        const t0 = ticks(pids);
        const c0 = performance.now();
        await wait(10_000);
        const used = (ticks(pids) - t0) / 100;
        const secs = (performance.now() - c0) / 1000;
        console.log(`${scene.padEnd(10)} ${w}×${h} at ${dpr}×: ${(100 * used / secs).toFixed(0)}% of a core (all the browser's processes)`);
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  server.stop(true);
}
