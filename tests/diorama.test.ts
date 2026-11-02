// Diorama, the package of the Coast live wallpaper: an endless coast seen from above, drawn in
// characters. The world is functions of position, in the shaders and (for the camera) on the page,
// so its page side is tested here alone: it comes round without a seam, and the camera keeps the
// coast framed and never jumps. Its build is loaded in Chromium the way the app serves it, for the
// clock, its colours and the panels' text over it; and the package is read by the app's reader and
// HiveHub's check. Each bar sits clear of what was measured (noted at each).
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chromium, type Browser, type Page } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import * as THREE from "three";
import sharp from "sharp";
import { APP, core, ROOT } from "./app";
import { contrast as ratio, parseColor } from "./colour";
import { PERIOD, shoreZ } from "../packages/diorama/src/coast/world";
import { CAMERA, place } from "../packages/diorama/src/coast/camera";

setDefaultTimeout(120_000);
const PKG = path.join(ROOT, "packages/diorama");

// ── the world, and the camera over it ───────────────────────────────────────

describe("Coast: the world and the camera", () => {
  test("the coast comes round after its period exactly, and its water's edge runs on smoothly, so the drift never jumps", () => {
    let worstWrap = 0, worstStep = 0;
    for (let i = 0; i < 4000; i++) {
      const x = (i / 4000) * PERIOD;
      worstWrap = Math.max(worstWrap, Math.abs(shoreZ(x) - shoreZ(x + PERIOD)));
      worstStep = Math.max(worstStep, Math.abs(shoreZ(x + 0.25) - shoreZ(x)));
    }
    // Measured: 0 at the wrap, at most 0.12 a quarter unit.
    expect({ wrap: worstWrap < 1e-9, smooth: worstStep < 0.4 }).toEqual({ wrap: true, smooth: true });
  });

  test("everywhere along the coast the camera keeps the water's edge below the middle of the view, the sea at the bottom and the land above, and from one frame to the next it moves only a little", () => {
    const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1440 / 900, 1, 400);
    const ys: number[] = [];
    let worstMove = 0;
    let before = place(camera, 0, 0).clone();
    for (let i = 1; i <= 3000; i++) {
      const x = (i / 3000) * PERIOD, t = i * 0.37;
      const target = place(camera, x, t).clone();
      ys.push(-new THREE.Vector3(x, 0, shoreZ(x)).project(camera).y);
      // A thirtieth of a second's drift on from here.
      const next = place(camera.clone(), x + CAMERA.speed / 30, t + 1 / 30);
      worstMove = Math.max(worstMove, next.distanceTo(target));
      before = target;
    }
    ys.sort((a, b) => a - b);
    // As a share of the view from its top: measured 0.56 to 0.81 over the whole period.
    const share = (y: number) => (y + 1) / 2;
    expect({ lowest: share(ys[0]!) > 0.5, highest: share(ys.at(-1)!) < 0.9, step: worstMove < 0.25 }).toEqual({ lowest: true, highest: true, step: true });
    void before;
  });
});

// ── its build, in Chromium, as the app serves it ────────────────────────────

const { serveDiorama } = await import("../packages/diorama/harness/serve");
const { LOOKS } = await import("../packages/diorama/harness/shoot-data");
const { PRESETS } = await core("settings-schema.ts");
type Rgb = [number, number, number];
const css = (s: string): Rgb => parseColor(s)!.rgb.map((v: number) => Math.round(v * 255)) as Rgb;
const contrast = (a: Rgb, b: Rgb) => ratio(a.map((v) => v / 255) as Rgb, b.map((v) => v / 255) as Rgb);

describe("Coast, built", () => {
  let browser: Browser;
  let server: Awaited<ReturnType<typeof serveDiorama>>;
  beforeAll(async () => {
    server = await serveDiorama();
    browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  }, 60_000);
  afterAll(async () => { await browser?.close(); server?.stop(true); });

  async function open(look: object, mode: "run" | "hold" | "still", size = { width: 480, height: 300 }, dpr = 1) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: dpr });
    await page.goto(server.url.href);
    await page.evaluate(({ look, mode }) => window.start({ scene: "coast", mode, look: look as never, creatures: [], tiles: [] }), { look, mode });
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
      // Drawn in software here, a frame can take a second: wait for one to differ.
      const a = await shot(page);
      let moved = false;
      for (let i = 0; i < 40 && !moved; i++) { await page.waitForTimeout(500); moved = (await shot(page)) !== a; }
      expect(moved).toBe(true);
      await page.evaluate(() => window.host.send({ type: "mode", mode: "hold" }));
      await page.waitForTimeout(2500);
      const held = await shot(page);
      await page.waitForTimeout(3000);
      expect(await shot(page)).toBe(held);
    } finally {
      await page.close();
    }
  });

  test("still, it draws one picture and keeps it; a new look draws it again", async () => {
    const page = await open({ ...LOOKS.dark, colour: true }, "still");
    try {
      await page.waitForTimeout(2000);
      const a = await shot(page);
      await page.waitForTimeout(3000);
      expect(await shot(page)).toBe(a);
      await page.evaluate((look) => window.host.send({ type: "look", look } as never), { ...LOOKS.light, colour: true });
      let changed = false;
      for (let i = 0; i < 30 && !changed; i++) { await page.waitForTimeout(500); changed = (await shot(page)) !== a; }
      expect(changed).toBe(true);
    } finally {
      await page.close();
    }
  });

  test("in the theme's colours, every pixel is a step from the page toward the text, dark and light", async () => {
    for (const look of [LOOKS.dark, LOOKS.light]) {
      const page = await open(look, "still");
      try {
        await page.waitForTimeout(1500);
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
        // Measured: 3 at most (rounding and the blur's mixing); a colour of its own would be 40 or more.
        expect({ dark: look.dark, worst: worst < 12 }).toEqual({ dark: look.dark, worst: true });
      } finally {
        await page.close();
      }
    }
  });

  test("in its own colours, dark and light, the frosted panels' text stays readable over it: names at 7:1 and details at 4.5:1 everywhere, hints at 3:1 over all but its brightest spots", async () => {
    for (const [look, preset] of [[{ ...LOOKS.dark, colour: true }, "signal"], [{ ...LOOKS.light, colour: true }, "clean-light"]] as const) {
      const page = await open(look, "still", { width: 960, height: 600 });
      try {
        await page.waitForTimeout(1500);
        const { bg2, fg, fg2, fg3 } = (PRESETS[preset] as { palette: Record<string, string> }).palette;
        // The panel blurs what is under it: the scene averaged over patches of 48 pixels.
        const { data, info } = await sharp(await page.screenshot()).removeAlpha().resize(20, 12, { kernel: "cubic" }).raw().toBuffer({ resolveWithObject: true });
        const hints: number[] = [];
        let names = 99, details = 99;
        for (let i = 0; i < info.width * info.height; i++) {
          const under: Rgb = [data[i * 3]!, data[i * 3 + 1]!, data[i * 3 + 2]!];
          // The Layers panel over a live wallpaper with See-through: its colour at a sixth.
          const panel = css(bg2!).map((v, k) => v / 6 + under[k]! * (5 / 6)) as Rgb;
          names = Math.min(names, contrast(css(fg!), panel));
          details = Math.min(details, contrast(css(fg2!), panel));
          hints.push(contrast(css(fg3!), panel));
        }
        hints.sort((a, b) => a - b);
        // Measured: names 8.9 and 9.4, details 5.8 and 4.9, hints under 3:1 in 2 patches of 240.
        expect({ preset, names: names >= 7, details: details >= 4.5, hints: hints[Math.floor(hints.length * 0.04)]! >= 3 })
          .toEqual({ preset, names: true, details: true, hints: true });
      } finally {
        await page.close();
      }
    }
  });
});

// ── the package, as the app and HiveHub read it ─────────────────────────────

test("the app's package reader takes Diorama as @dip497/diorama, holding the Coast live wallpaper, and offers it on install; it asks for the Colour switch", async () => {
  const { readPackage } = await core("packages.ts");
  const pkg = await readPackage(PKG, { folder: "diorama" });
  expect({ id: pkg.id, members: pkg.members.map((m: { kind: string; id: string; name: string }) => [m.kind, m.id, m.name]), startup: pkg.manifest.startup?.wallpaper })
    .toEqual({ id: "@dip497/diorama", members: [["wallpaper", "@dip497/diorama/coast", "Coast"]], startup: "@dip497/diorama/coast" });
  expect(JSON.parse(readFileSync(path.join(PKG, "wallpapers/coast/hivemind-wallpaper.json"), "utf8")).colour).toBe(true);
});

test("HiveHub lists Diorama, its wallpaper sandboxed and asking for nothing, and installs the build, its preview and the licences, without the sources or the harness; no file over 2 MB", async () => {
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
    .toEqual([["wallpaper", "@dip497/diorama/coast", "sandboxed", []]]);
  const { manifest } = checkPackageManifest(JSON.parse(readFileSync(path.join(PKG, "hivemind-package.json"), "utf8")));
  const installs = packageFiles(manifest, files).map((f: { path: string }) => f.path).sort();
  expect(installs.filter((f: string) => /\.ts$|harness|\/src\//.test(f))).toEqual([]);
  for (const f of ["wallpapers/coast/dist/main.js", "wallpapers/coast/hivemind-wallpaper.json", "wallpapers/coast/preview.webp", "wallpapers/coast/LICENSE"]) expect(installs).toContain(f);
  for (const f of installs) expect({ f, small: statSync(path.join(PKG, f)).size <= 2 << 20 }).toEqual({ f, small: true });
});
