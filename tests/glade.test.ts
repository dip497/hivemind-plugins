// Glade, the package of the Glade live wallpaper: a forest clearing in pixel art, lit as a scene.
// Its layout and its life are plain code, tested here alone: the same screen lays out the same glade,
// every size keeps its parts on screen and apart, the weather comes and goes, and the pointer and
// clicks do what they say. Its build is loaded in Chromium the way the app serves it, for the clock,
// its colours and the panels' text over it; and the package is read by the app's reader and HiveHub's
// check. Each bar sits clear of what was measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { artSize, layGlade } from "../packages/glade/src/glade/glade";
import { Life, weather, WEATHER_CYCLE } from "../packages/glade/src/glade/life";
import { makeAtlas } from "../packages/glade/src/glade/sprites";
import { MAT } from "../packages/glade/src/glade/px";

setDefaultTimeout(120_000);
const PKG = path.join(ROOT, "packages/glade");

// ── the layout and the life ─────────────────────────────────────────────────

describe("Glade: its layout and its life", () => {
  test("the same screen lays out the same glade, to the pixel", () => {
    const a = layGlade(300, 190), b = layGlade(300, 190);
    expect(Bun.hash(a.still.alb) === Bun.hash(b.still.alb) && Bun.hash(a.still.dat) === Bun.hash(b.still.dat)).toBe(true);
  });

  test("at every screen from a small window to an ultrawide one, the fire, the cottage, the pond and every lamp are on screen, the pond is water and the fire is not in it", () => {
    const bad: string[] = [];
    for (const [w, h] of [[640, 400], [1280, 800], [1440, 900], [1920, 1080], [2560, 1080], [3440, 1440], [900, 1200]] as const) {
      const s = artSize(w, h), g = layGlade(s.w, s.h);
      const on = (x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h;
      if (!on(g.fire.x, g.fire.y)) bad.push(`${w}x${h} fire`);
      if (!on(g.doors[0]!.x, g.doors[0]!.y)) bad.push(`${w}x${h} cottage`);
      if (g.still.matAt(g.pond.cx, g.pond.cy) !== MAT.WATER) bad.push(`${w}x${h} pond`);
      if (((g.fire.x - g.pond.cx) / g.pond.rx) ** 2 + ((g.fire.y - g.pond.cy) / g.pond.ry) ** 2 < 2) bad.push(`${w}x${h} fire by the pond`);
      for (const l of g.lights) if (!on(l.x, l.z / 2 - l.h)) bad.push(`${w}x${h} light at ${l.x},${l.z / 2 - l.h}`);
    }
    expect(bad).toEqual([]);
  });

  test("the weather turns: a clear night, then mist, then rain that stops, and the ground stays wet a while after", () => {
    const seen = { clear: 0, rain: 0, mist: 0, wetAfter: false };
    let rained = false;
    for (let t = 0; t < WEATHER_CYCLE; t += 1) {
      const w = weather(t);
      if (w.rain === 0 && w.mist < 0.2) seen.clear++;
      if (w.rain > 0.9) { seen.rain++; rained = true; }
      if (w.mist > 0.8) seen.mist++;
      if (rained && w.rain === 0 && w.wet > 0.5) seen.wetAfter = true;
    }
    // Of 420 seconds: about 190 clear, 70 raining hard, 120 misty.
    expect({ clear: seen.clear > 120, rain: seen.rain > 40, mist: seen.mist > 60, wetAfter: seen.wetAfter }).toEqual({ clear: true, rain: true, mist: true, wetAfter: true });
    expect(weather(0).rain + weather(WEATHER_CYCLE * 3 + 10).rain).toBe(0);
  });

  test("a click on the fire stirs it: it flares and throws a burst of sparks; a click on the pond rings it", () => {
    const g = layGlade(380, 240), life = new Life(g, makeAtlas());
    const still = { x: 0, y: 0, over: false };
    for (let i = 0; i < 120; i++) life.step(1 / 60, still, true);
    life.collect(2.7, 1);
    const before = { sprites: life.spriteCount, fire: life.fireStrength() };
    life.click(g.fire.x, g.fire.y);
    life.step(1 / 60, still, true);
    life.collect(2.7, 1);
    // Measured: 20 more sprites (sparks) and the fire half again as strong.
    expect({ sparks: life.spriteCount - before.sprites >= 15, flare: life.fireStrength() > before.fire + 0.4 }).toEqual({ sparks: true, flare: true });
    life.click(g.pond.cx, g.pond.cy);
    const r = life.rippleData;
    expect([0, 4, 8, 12].some((o) => r[o] === g.pond.cx && r[o + 1] === g.pond.cy && Math.abs(r[o + 2]! - life.t) < 1e-6)).toBe(true);
  });

  test("the pointer resting in the glade draws the fireflies near it over to it; with the pointer away, they keep to themselves", () => {
    const g = layGlade(380, 240), at = { x: 90, y: 170 };
    const near = (over: boolean) => {
      const life = new Life(g, makeAtlas());
      let most = 0;
      for (let i = 0; i < 60 * 10; i++) {
        life.step(1 / 60, { ...at, over }, true);
        const f = (life as unknown as { flies: Float32Array }).flies;
        let n = 0;
        // Fireflies within 20 art pixels of the pointer, on the screen (a firefly shows h above its row).
        for (let k = 0; k < f.length / 8; k++) if (Math.hypot(f[k * 8]! - at.x, f[k * 8 + 1]! - f[k * 8 + 2]! - at.y) < 20) n++;
        most = Math.max(most, n);
      }
      return most;
    };
    const drawn = near(true), away = near(false);
    // Measured: 14 near it at most while it rests there, 1 with it away.
    expect({ drawn: drawn >= 4 && drawn >= away * 2 }).toEqual({ drawn: true });
  });
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

const { serveGlade } = await import("../packages/glade/harness/serve");
const { LOOKS } = await import("../packages/glade/harness/shoot-data");
const { PRESETS } = await core("settings-schema.ts");
type Rgb = [number, number, number];
const css = (s: string): Rgb => parseColor(s)!.rgb.map((v: number) => Math.round(v * 255)) as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as Rgb, b.map((v) => v / 255) as Rgb);

describe("Glade, built", () => {
  let browser: Browser;
  let server: Awaited<ReturnType<typeof serveGlade>>;
  beforeAll(async () => {
    server = await serveGlade();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function open(look: object, mode: "run" | "hold" | "still", size = { width: 480, height: 300 }, dpr = 1) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ look, mode }) => window.start({ scene: "glade", mode, look: look as never, creatures: [], tiles: [] }), { look, mode });
    await page.waitForFunction(() => window.host.drawn, null, { timeout: 90_000 });
    return page;
  }
  const shot = async (page: Page) => Bun.hash(await page.screenshot()).toString();

  test("in its sandboxed frame it says it speaks protocol 1 and that its first frame is up, and nothing else; draws a canvas the viewport's size times its pixel ratio; it moves while it runs and not while held", async () => {
    const page = await open({ ...LOOKS.dark, colour: true }, "run", { width: 480, height: 300 }, 2);
    try {
      const said = await page.evaluate(() => ({ received: [...new Set(window.host.received.map((m) => m.type))], refused: window.host.refused }));
      expect(said).toEqual({ received: ["ready", "drawn"], refused: [] });
      const frame = page.frames().find((f) => f.url().includes("/wp/"))!;
      expect(await frame.evaluate(() => { const c = document.querySelector("canvas")!; return [c.width, c.height, c.clientWidth, c.clientHeight]; })).toEqual([960, 600, 480, 300]);
      const a = await shot(page);
      let moved = false;
      for (let i = 0; i < 40 && !moved; i++) { await page.waitForTimeout(300); moved = (await shot(page)) !== a; }
      expect(moved).toBe(true);
      await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
      await page.waitForTimeout(1500);
      const held = await shot(page);
      await page.waitForTimeout(2500);
      expect(await shot(page)).toBe(held);
    } finally {
      await page.close();
    }
  });

  test("still, it draws one picture and keeps it; a new look draws it again", async () => {
    const page = await open({ ...LOOKS.dark, colour: true }, "still");
    try {
      await page.waitForTimeout(1500);
      const a = await shot(page);
      await page.waitForTimeout(2500);
      expect(await shot(page)).toBe(a);
      await page.evaluate((look) => window.host.send({ type: "look", look } as never), { ...LOOKS.light, colour: true });
      let changed = false;
      for (let i = 0; i < 30 && !changed; i++) { await page.waitForTimeout(300); changed = (await shot(page)) !== a; }
      expect(changed).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("in the theme's colours, every pixel is a step from the page toward the text, dark and light", async () => {
    for (const look of [LOOKS.dark, LOOKS.light]) {
      const page = await open(look, "still");
      try {
        await page.waitForTimeout(1000);
        const { data, info } = await sharp(await page.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const P = css(look.page), T = css(look.text);
        // How far a pixel is from the line between the page and the text, in 0..255 steps.
        const off = (c: Rgb) => {
          const d = T.map((v, i) => v - P[i]!), q = c.map((v, i) => v - P[i]!);
          const k = Math.max(0, Math.min(1, (q[0]! * d[0]! + q[1]! * d[1]! + q[2]! * d[2]!) / (d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2)));
          return Math.hypot(...q.map((v, i) => v - k * d[i]!));
        };
        let worst = 0;
        for (let i = 0; i < info.width * info.height; i += 7) worst = Math.max(worst, off([data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!]));
        // Measured: 4 at most (the colour steps' rounding); a colour of its own would be 40 or more.
        expect({ dark: look.dark, worst: worst < 12 }).toEqual({ dark: look.dark, worst: true });
      } finally {
        await page.close();
      }
    }
  });

  test("in its own colours, dark and light, the frosted panels' text stays readable over it: names at 7:1 and details at 4.5:1 everywhere but over the fire itself, hints at 3:1 over all but its brightest spots", async () => {
    for (const [look, preset] of [[{ ...LOOKS.dark, colour: true }, "signal"], [{ ...LOOKS.light, colour: true }, "clean-light"]] as const) {
      const page = await open(look, "still", { width: 960, height: 600 });
      try {
        await page.waitForTimeout(1000);
        const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
        // The fire, in CSS pixels: its flames and their glow are the fire, in the lower middle, not
        // ground (as with Campfire's).
        const s = artSize(960, 600), g = layGlade(s.w, s.h);
        // The flames stand up to 30 art pixels over the fire's foot and 12 either side; a patch is the
        // fire's if its middle is within half a patch of them.
        const fire = { x0: (g.fire.x - 12) * s.px - 24, x1: (g.fire.x + 12) * s.px + 24, y0: (g.fire.y - 30) * s.px - 24, y1: (g.fire.y + 4) * s.px + 24 };
        // The panel blurs what is under it: the scene averaged over patches of 48 pixels.
        const { data, info } = await sharp(await page.screenshot()).removeAlpha().resize(20, 12, { kernel: "cubic" }).raw().toBuffer({ resolveWithObject: true });
        const hints: number[] = [];
        let names = 99, details = 99;
        for (let i = 0; i < info.width * info.height; i++) {
          const cx = (i % info.width + 0.5) * 48, cy = (Math.floor(i / info.width) + 0.5) * 48;
          if (cx > fire.x0 && cx < fire.x1 && cy > fire.y0 && cy < fire.y1) continue;
          const under: Rgb = [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!];
          // The Layers panel over a live wallpaper with See-through: its colour at a sixth.
          const panel = css(bg2!).map((v, k) => v / 6 + under[k]! * (5 / 6)) as Rgb;
          names = Math.min(names, contrast(css(fg!), panel));
          details = Math.min(details, contrast(css(fg2!), panel));
          hints.push(contrast(css(fg3!), panel));
        }
        hints.sort((a, b) => a - b);
        // Measured: names 7.3 and 10.4, details 4.8 and 5.4, hints 3.7 and 3.7 (the moon's glow is the
        // darkest patch's backdrop on a dark theme, the near grass on a light one).
        expect({ preset, names: names >= 7, details: details >= 4.5, hints: hints[Math.floor(hints.length * 0.04)]! >= 3 })
          .toEqual({ preset, names: true, details: true, hints: true });
      } finally {
        await page.close();
      }
    }
  });
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

test("the app's package reader takes Glade as @dip497/glade, holding the Glade live wallpaper, and offers it on install; it asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "glade" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/glade", members: [["wallpaper", "@dip497/glade/glade", "Glade"]], startup: "@dip497/glade/glade" });
  expect(JSON.parse(readFileSync(path.join(PKG, "wallpapers/glade/hivemind-wallpaper.json"), "utf8")).colour).toBe(true);
});

test("HiveHub lists Glade, its wallpaper sandboxed and asking for nothing, and installs the build and its preview, without the sources or the harness; no file over 2 MB", async () => {
  const { checkPluginFolder } = await import(path.join(APP, "packages/hive-hub/src/plugin-checks.ts"));
  const { packageFiles, checkPackageManifest } = await import(path.join(APP, "packages/hive-hub/src/package-format.ts"));
  const files: { path: string; bytes: Uint8Array }[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(PKG, rel), { withFileTypes: true })) {
      const at = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(at);
      else files.push({ path: at, bytes: new Uint8Array(readFileSync(path.join(PKG, at))) });
    }
  };
  walk("");
  const c = await checkPluginFolder(files);
  expect("problem" in c ? c.problem : null).toBe(null);
  expect(c.plugin.members.map((m: { kind: string; id: string; runs: string; permissions: string[] }) => [m.kind, m.id, m.runs, m.permissions]))
    .toEqual([["wallpaper", "@dip497/glade/glade", "sandboxed", []]]);
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const f of ["wallpapers/glade/dist/main.js", "wallpapers/glade/hivemind-wallpaper.json", "wallpapers/glade/preview.webp"]) expect(installs).toContain(f);
  for (const f of installs) expect({ f, small: statSync(path.join(PKG, f)).size <= 2 << 20 }).toEqual({ f, small: true });
});
