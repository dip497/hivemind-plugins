// What a frame of the Glade costs: frames (120, or as many as named) at 1440×900 at 1× and at 2×, at
// night and in the morning, each timed from the first call to its last pixel; prints the median and
// the 90th percentile.
//   bun packages/glade/harness/perf.ts [frames]
// A headless browser draws in software (SwiftShader), with no GPU: the numbers overstate what a real
// screen costs many times over. Compare them only with each other. PW_CHROMIUM names a Chromium when
// Playwright's own is not installed.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { LOOKS } from "./shoot-data";

const frames = +(process.argv[2] ?? 120);
const js = (await build({ entryPoints: [path.join(import.meta.dir, "film-page.ts")], bundle: true, format: "iife", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `median ${s[Math.floor(s.length * 0.5)]!.toFixed(1)} ms, p90 ${s[Math.floor(s.length * 0.9)]!.toFixed(1)} ms`;
};
try {
  for (const dpr of [1, 2]) {
    for (const [name, look, start] of [["night", { ...LOOKS.dark, colour: true }, 30], ["rain", { ...LOOKS.dark, colour: true }, 280], ["morning", { ...LOOKS.light, colour: true }, 30]] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.setContent("<!doctype html><body style='margin:0'></body>");
      await page.addScriptTag({ content: js });
      await page.evaluate(([look, start, dpr]) => (window as any).init(1440, 900, look, start, dpr), [look, start, dpr] as const);
      for (let i = 0; i < 10; i++) await page.evaluate(() => (window as any).time());
      const times: number[] = [];
      for (let i = 0; i < frames; i++) times.push(await page.evaluate(() => (window as any).time() as number));
      console.log(`glade 1440×900 at ${dpr}×, ${name.padEnd(7)}, ${frames} frames: ${stats(times)}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
