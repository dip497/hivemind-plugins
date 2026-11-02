// A film of the Den running, as the app would drive it: agents changing state, a click that drops
// a ball, a turn done well, the pointer rubbing a pup. The page's clock is faked and stepped a
// thirtieth of a second at a time, a frame taken at each step, so the film runs smooth however slow
// the machine draws. `bun packages/den/harness/film.ts <out dir>` writes <look>/<frame>.png, one
// folder a look, for ffmpeg (PW_CHROMIUM names a Chromium when Playwright's own is not installed).
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { serveDen } from "./serve";
import { CREATURES, LOOKS, TILES } from "./shoot-data";

const out = process.argv[2] ?? "/tmp/den-film";
mkdirSync(out, { recursive: true });
const server = await serveDen();
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  for (const [name, look, secs] of [["dark-own", { ...LOOKS.dark, colour: true }, 22], ["dark", LOOKS.dark, 12]] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.clock.install();
    await page.goto(server.url.href);
    await page.evaluate(({ look, creatures, tiles }) => { void window.start({ scene: "den", mode: "run", look, creatures: creatures as never, tiles }); }, { look, creatures: CREATURES, tiles: TILES });
    for (let i = 0; i < 400 && !(await page.evaluate(() => window.host?.drawn)); i++) await page.clock.runFor(50);
    // The tiles over it, as the app lays them.
    await page.evaluate(({ tiles, look }) => {
      for (const t of tiles) {
        const d = document.createElement("div");
        const side = !("id" in t);
        Object.assign(d.style, { position: "fixed", left: `${t.x0}px`, top: `${t.y0}px`, width: `${t.x1 - t.x0}px`, height: `${t.y1 - t.y0}px`,
          background: look.dark ? (side ? "#15171a" : "#202327") : (side ? "#ecebe6" : "#ffffff"), borderRadius: side ? "0" : "10px",
          border: `1px solid ${look.dark ? "#2e3238" : "#dcdad3"}`, boxSizing: "border-box", zIndex: "10", font: `12px ${look.mono}`, color: look.text, padding: "8px 10px" });
        d.textContent = side ? "" : t.id === "c" ? "claude · needs you" : "codex · ready";
        document.body.append(d);
      }
    }, { tiles: TILES, look });
    let now = CREATURES.map((c) => ({ ...c })) as { id: string; state: string }[];
    const set = (patch: Record<string, string>) => {
      now = now.map((c) => (patch[c.id] ? { ...c, state: patch[c.id]! } : c));
      return page.evaluate((creatures) => window.host.send({ type: "creatures", creatures } as never), now);
    };
    // Straight from the compositor: Playwright's own screenshot waits for an animation frame,
    // which a faked clock only gives when it is stepped.
    const cdp = await context.newCDPSession(page);
    const dir = `${out}/${name}`;
    mkdirSync(dir, { recursive: true });
    const FPS = 30;
    for (let f = 0; f < secs * FPS; f++) {
      const t = f / FPS;
      if (f === 4 * FPS) await set({ b: "needs-you" });
      if (secs > 15) {
        if (f === 9 * FPS) await page.evaluate(() => window.host.click(640, 640));
        if (f === 13 * FPS) await page.evaluate(() => window.host.send({ type: "done", id: "a" } as never));
        // Rub across the middle of the yard, back and forth, for two seconds.
        if (t >= 14 && t < 16) await page.evaluate((x) => window.host.point(x, 580, true), 600 + 70 * Math.sin(t * 9));
        if (f === 16 * FPS) await page.evaluate(() => window.host.point(600, 580, false));
        if (f === 17 * FPS) await set({ b: "ready", e: "resting" });
      }
      await page.clock.runFor(1000 / FPS);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${dir}/${String(f).padStart(4, "0")}.png`, Buffer.from(data, "base64"));
    }
    await context.close();
    console.log("filmed", name, secs * 30, "frames");
  }
} finally {
  await browser.close();
  server.stop(true);
}
