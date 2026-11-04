// Pictures of the Glade as the app would show it: the build in its sandboxed frame, still, with tiles
// over it as panels, dark and light, in its own colours and the theme's; and the picker's previews.
// `bun packages/glade/harness/shoot.ts <out dir> [--run <seconds>]` (PW_CHROMIUM names a Chromium when
// Playwright's own is not installed). With --run, each picture is taken running, that long in.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { serveGlade } from "./serve";
import { LOOKS, TILES } from "./shoot-data";

const out = process.argv[2] ?? "/tmp/glade-shots";
const runAt = process.argv.includes("--run") ? +process.argv[process.argv.indexOf("--run") + 1]! : 0;
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1]!.split(",") : null;
mkdirSync(out, { recursive: true });
const server = await serveGlade();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  const shots = [["dark-own", { ...LOOKS.dark, colour: true }, true], ["light-own", { ...LOOKS.light, colour: true }, true], ["dark", LOOKS.dark, true], ["light", LOOKS.light, true], ["preview-dark", { ...LOOKS.dark, colour: true }, false], ["preview-light", { ...LOOKS.light, colour: true }, false]] as const;
  for (const [name, look, tiles] of shots) {
    if (only && !only.includes(name)) continue;
    const preview = name.startsWith("preview");
    const page = await browser.newPage(preview ? { viewport: { width: 800, height: 500 }, deviceScaleFactor: 1.2 } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    page.on("console", (m) => console.log("page:", m.text()));
    page.on("pageerror", (e) => console.log("page error:", e.message));
    await page.goto(server.url.href);
    await page.evaluate(({ look, mode }) => window.start({ scene: "glade", mode, look, creatures: [], tiles: [] }), { look, mode: runAt ? "run" as const : "still" as const });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 90_000 });
    await page.waitForTimeout(runAt ? runAt * 1000 : 500);
    if (tiles && !preview) {
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
    }
    await page.screenshot({ path: `${out}/glade-${name}.png` });
    console.log("shot", name, await page.evaluate(() => window.host.refused));
    await page.close();
  }
} finally {
  await browser.close();
  server.stop(true);
}
