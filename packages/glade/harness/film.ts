// A film of the Glade, or single pictures of it: its scene drawn frame by frame at exact thirtieths of
// a second from any moment of its life, so the film runs smooth however slowly the machine draws.
//   bun packages/glade/harness/film.ts <out dir> [look] [seconds] [start] [width] [height]
// writes <out dir>/<look>/<frame>.jpg, for `ffmpeg -framerate 30 -i <dir>/%04d.jpg …`. The looks are
// night (its own colours, dark), morning (its own, light) and theme (the theme's, dark). A click on
// the fire comes 3 s in, and the pointer rests on the meadow from 6 s to 10 s. With seconds 0, one
// picture at the start. PW_CHROMIUM names a Chromium when Playwright's own is not installed.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { artSize, layGlade } from "../src/glade/glade";
import { LOOKS } from "./shoot-data";

const [out = "/tmp/glade-film", lookName = "night", secs = "12", start = "0", W0 = "960", H0 = "600"] = process.argv.slice(2);
const W = +W0, H = +H0, FPS = 30;
const look = { night: { ...LOOKS.dark, colour: true }, morning: { ...LOOKS.light, colour: true }, theme: LOOKS.dark }[lookName];
if (!look) throw new Error(`no look ${lookName}: night, morning or theme`);
const dir = path.join(out, lookName);
mkdirSync(dir, { recursive: true });
const s = artSize(W, H), g = layGlade(s.w, s.h);
const fire: [number, number] = [g.fire.x * s.px, (g.fire.y - 6) * s.px];

const js = (await build({ entryPoints: [path.join(import.meta.dir, "film-page.ts")], bundle: true, format: "iife", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => console.log("page error:", e.message));
  await page.setContent("<!doctype html><body style='margin:0;background:#000'></body>");
  await page.addScriptTag({ content: js });
  await page.evaluate(([w, h, look, start]) => (window as any).init(w, h, look, start), [W, H, look, +start] as const);
  const frames = Math.max(1, Math.round(+secs * FPS));
  for (let f = 0; f < frames; f++) {
    const t = f / FPS;
    const at: [number, number] | null = t >= 6 && t < 10 ? [W * (0.25 + (t - 6) * 0.03), H * 0.78] : null;
    const click = f === 3 * FPS ? fire : null;
    const url = await page.evaluate(([dt, at, click]) => (window as any).frame(dt, at, click) as string, [f === 0 ? 0 : 1 / FPS, at, click] as const);
    writeFileSync(path.join(dir, `${String(f).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1]!, "base64"));
    if (f % 60 === 0) console.log(`${lookName}: frame ${f}`);
  }
} finally {
  await browser.close();
}
