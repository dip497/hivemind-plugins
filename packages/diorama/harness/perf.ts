// What a frame of the Coast costs: 600 frames at 1440×900 at 1× and at 2×, in its own colours and the
// theme's, each timed until its last pixel is drawn; prints the median and the 90th percentile.
//   bun packages/diorama/harness/perf.ts
// A headless browser draws in software (SwiftShader), with no GPU: the numbers overstate what a real
// screen costs many times over. Compare them only with each other. PW_CHROMIUM names a Chromium when
// Playwright's own is not installed.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { LOOKS } from "./shoot-data";

const js = (await build({ entryPoints: [path.join(import.meta.dir, "film-page.ts")], bundle: true, format: "iife", write: false, logLevel: "silent" })).outputFiles[0]!.text;
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return `median ${s[Math.floor(s.length * 0.5)]!.toFixed(1)} ms, p90 ${s[Math.floor(s.length * 0.9)]!.toFixed(1)} ms`;
};
try {
  for (const dpr of [1, 2]) {
    for (const [name, look] of [["own", { ...LOOKS.dark, colour: true }], ["theme", LOOKS.dark]] as const) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
      await page.setContent("<!doctype html><body style='margin:0'></body>");
      await page.addScriptTag({ content: js });
      await page.evaluate(([look, dpr]) => (window as any).init(1440, 900, look, dpr), [look, dpr] as const);
      await page.evaluate(() => (window as any).measure(30)); // shaders compiled, buffers made
      const times = await page.evaluate(() => (window as any).measure(600) as number[]);
      console.log(`coast 1440×900 at ${dpr}×, ${name.padEnd(5)}: ${stats(times)}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
