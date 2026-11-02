// Pictures of the Den as the app would show it: the build in its sandboxed frame, with a few
// agents and tiles, dark and light, theme colours and its own; and a short run with the pointer
// rubbing a pup. `bun packages/den/harness/shoot.ts <out dir>` (PW_CHROMIUM names a Chromium when
// Playwright's own is not installed).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { serveDen } from "./serve";
import { CREATURES, LOOKS, TILES } from "./shoot-data";

const out = process.argv[2] ?? "/tmp/den-shots";
mkdirSync(out, { recursive: true });
const server = await serveDen();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [name, look] of [["dark", LOOKS.dark], ["light", LOOKS.light], ["dark-own", { ...LOOKS.dark, colour: true }], ["light-own", { ...LOOKS.light, colour: true }]] as const) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await page.goto(server.url.href);
    await page.evaluate(({ look, creatures, tiles }) => window.start({ scene: "den", mode: "still", look, creatures: creatures as never, tiles }), { look, creatures: CREATURES, tiles: TILES });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    // The tiles over it, as panels the way the app lays them: the wallpaper only sees their boxes.
    await page.evaluate(({ tiles, look }) => {
      for (const t of tiles) {
        const d = document.createElement("div");
        const side = !("id" in t);
        Object.assign(d.style, {
          position: "fixed", left: `${t.x0}px`, top: `${t.y0}px`, width: `${t.x1 - t.x0}px`, height: `${t.y1 - t.y0}px`,
          background: look.dark ? (side ? "#15171a" : "#202327") : (side ? "#ecebe6" : "#ffffff"), borderRadius: side ? "0" : "10px",
          border: `1px solid ${look.dark ? "#2e3238" : "#dcdad3"}`, boxSizing: "border-box", zIndex: "10",
          font: `12px ${look.mono}`, color: look.text, padding: "8px 10px", opacity: "0.97",
        });
        d.textContent = side ? "" : t.id === "c" ? "claude · needs you" : "codex · ready";
        document.body.append(d);
      }
    }, { tiles: TILES, look });
    await page.screenshot({ path: `${out}/den-${name}.png` });
    console.log("shot", name, await page.evaluate(() => window.host.refused));
    await page.close();
  }
  // The picker's preview: the yard alone, in its own colours, at 960 x 600.
  for (const [name, look] of [["preview-dark", { ...LOOKS.dark, colour: true }], ["preview-light", { ...LOOKS.light, colour: true }]] as const) {
    const page = await browser.newPage({ viewport: { width: 800, height: 500 }, deviceScaleFactor: 1.2 });
    await page.goto(server.url.href);
    await page.evaluate(({ look, creatures }) => window.start({ scene: "den", mode: "still", look, creatures: creatures as never, tiles: [] }), { look, creatures: CREATURES });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/den-${name}.png` });
    console.log("shot", name);
    await page.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
