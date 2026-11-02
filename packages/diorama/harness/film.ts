// A film of the Coast: its scene drawn frame by frame at exact thirtieths of a second, with a click
// on the sea at 4 s and at 6.5 s and a breeze drawn across the grass from 10 s to 13 s, so the film
// runs smooth however slowly the machine draws (in software, about two seconds a frame).
//   bun packages/diorama/harness/film.ts <out dir> [look] [seconds]
// writes <out dir>/<look>/<frame>.jpg, for `ffmpeg -framerate 30 -i <dir>/%04d.jpg …`. The looks are
// own (its own colours, dark), theme (the theme's, dark) and light (its own, light). PW_CHROMIUM
// names a Chromium when Playwright's own is not installed.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CAMERA } from "../src/coast/camera";
import { LOOKS } from "./shoot-data";

const [out = "/tmp/coast-film", lookName = "own", secs = "20"] = process.argv.slice(2);
const W = 960, H = 600, FPS = 30;
const look = { own: { ...LOOKS.dark, colour: true }, theme: LOOKS.dark, light: { ...LOOKS.light, colour: true } }[lookName];
if (!look) throw new Error(`no look ${lookName}: own, theme or light`);
const dir = path.join(out, lookName);
mkdirSync(dir, { recursive: true });

const js = (await build({ entryPoints: [path.join(import.meta.dir, "film-page.ts")], bundle: true, format: "iife", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent("<!doctype html><body style='margin:0'></body>");
  await page.addScriptTag({ content: js });
  await page.evaluate(([w, h, look]) => (window as any).init(w, h, look), [W, H, look] as const);
  const ground = (px: number, py: number) => page.evaluate(([px, py, w, h]) => (window as any).ground(px, py, w, h) as [number, number], [px, py, W, H]);
  const ripples: [number, number, number][] = [[0, 0, -1], [0, 0, -1], [0, 0, -1], [0, 0, -1]];
  let gust: [number, number, number] = [0, 0, 0];
  for (let f = 0; f < +secs * FPS; f++) {
    const t = f / FPS, x = CAMERA.start + CAMERA.speed * t;
    if (f === 4 * FPS) ripples[0] = [...(await ground(380, 470)), t];
    if (f === Math.round(6.5 * FPS)) ripples[1] = [...(await ground(620, 500)), t];
    if (t >= 10 && t < 13) gust = [...(await ground(300 + (t - 10) * 140, 250)), 0.6];
    else gust = [gust[0], gust[1], Math.max(0, gust[2] - 0.05)];
    const url = await page.evaluate(([x, t, gust, ripples]) => (window as any).frame(x, t, gust, ripples) as string, [x, t, gust, ripples] as const);
    writeFileSync(path.join(dir, `${String(f).padStart(4, "0")}.jpg`), Buffer.from(url.split(",")[1]!, "base64"));
    if (f % 60 === 0) console.log(`${lookName}: frame ${f}`);
  }
} finally {
  await browser.close();
}
