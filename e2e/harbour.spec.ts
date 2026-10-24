// Harbour, Archipelago's theme, in the real app: the package installed as `hive plugins install`
// does it, the theme applied from Settings ▸ Appearance and from `hive theme use`, and checked by
// what a person sees: the page's colours, text and accent are Harbour's as the app resolves them,
// the interface is drawn in Harbour's Nunito, its wallpaper shows between the tiles, a terminal
// paints Harbour's terminal colours, and the Archipelago view takes all of it. Revert to previous
// look, and `hive theme revert`, put back exactly the look before. HARBOUR_SHOTS names a folder for
// screenshots (1440×900).
import { test, expect, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, session } from "./app";
import { standinAgent } from "./standin";

const PKG = path.join(PLUGINS, "packages", "archipelago");
const THEME = "@dip497/archipelago/harbour";
const theme = JSON.parse(fs.readFileSync(path.join(PKG, "themes", "harbour", "theme.json"), "utf8"));
const SHOTS = process.env.HARBOUR_SHOTS ?? "";
const s = session("harbour");
const { root, hive, hiveLater } = s;
let page: Page;
let shell = "";
let agent = "";

/** Harbour's colours as the app's page resolves them (a canvas fill, as the app does for views). */
let H: { bg: string; fg: string; brand: string; accent: string; terminal: string };
/** The look before Harbour, on the canvas and in the view. */
let before: { canvas: Look; shell: Screen; view: ViewLook };

test.beforeAll(async () => {
  test.setTimeout(180_000);
  // Packages' themes came after v2026.10.5 (CI's release leg): there `hive theme list` has no
  // installed themes to report, only the presets.
  const listed = hive("theme", "list").data;
  test.skip(!Array.isArray(listed?.problems), "the app at HIVEMIND_APP has no theme member: packages' themes came after v2026.10.5");
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  Object.assign(s.env, standinAgent(path.join(root, "config"), root));
  expect(hive("plugins", "install", PKG)).toMatchObject({ status: 0, data: { id: "@dip497/archipelago", members: expect.arrayContaining([expect.objectContaining({ kind: "theme" })]) } });
  page = await s.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  // A still wallpaper, so two screenshots of it differ only by what changed.
  await page.evaluate(() => window.hive.settingsSet("appearance.glass.animate", false));
  expect((await hiveLater("ctl", "plugin", "open", "view:canvas")).status).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("hivemind:shortcut", { detail: "new-terminal" })));
  await expect(page.locator(".react-flow__node-terminal")).toHaveCount(1, { timeout: 20_000 });
  shell = (await page.locator(".react-flow__node-terminal").getAttribute("data-id"))!;
  const spawned = hive("ctl", "spawn", "--agent", "standin", "--name", "standin");
  expect(spawned.status).toBe(0);
  agent = spawned.data.tile;
  await expect(page.locator(`.react-flow__node[data-id="${agent}"]`)).toBeVisible({ timeout: 20_000 });
  await sideBySide();
  // The terminal shows four ANSI background colours; the stand-in asks for the person.
  expect(hive("ctl", "send", shell, "printf '\\033[41m            \\033[42m            \\033[43m            \\033[44m            \\033[0m\\n'").status).toBe(0);
  expect(hive("ctl", "send", agent, "ask").status).toBe(0);
  await expect(page.locator(`[data-layer-tile="${agent}"] [data-layer-status]`)).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await screen(shell)).top.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(5);
  await page.mouse.click(1380, 160); // nothing selected, nothing focused

  H = await page.evaluate((t) => {
    const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const hex = (css: string) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = css; c.fillRect(0, 0, 1, 1); return "#" + [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join(""); };
    return { bg: hex(t.palette.bg), fg: hex(t.palette.fg), brand: hex(t.accent.brand), accent: hex(t.accent.accent), terminal: hex(t.terminal.background) };
  }, theme);
  before = { canvas: await look(), shell: await screen(shell), view: await inView(async (f) => { await expect.poll(async () => (await viewLook(f)).mode[1], { timeout: 30_000 }).not.toBeNull(); return viewLook(f); }) };
  // The look before is not Harbour's, or nothing below would show the theme arrived.
  expect(before.canvas).toMatchObject({ nunito: false, wallpaper: { image: null } });
  expect(before.canvas.ground).not.toBe(H.bg);
  expect(before.shell.ansi).toEqual([0, 0, 0, 0]);
  expect(before.view.ground).not.toBe(H.bg);
  await canvasShot("canvas-before");
});
test.afterAll(async () => {
  await s.close();
  // The terminal daemon outlives the app: stop it and the stand-in, which run from this folder, and
  // the terminal's shell, which runs in it and would write its history there as it goes.
  for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try {
      if (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root) || fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(root)) process.kill(Number(pid), "SIGKILL");
    } catch { /* gone */ }
  }
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
/** The canvas with the terminal selected, so the accent shows on it beside the agent asking. */
const canvasShot = async (name: string) => {
  if (!SHOTS) return;
  const b = (await page.locator(`.react-flow__node[data-id="${shell}"]`).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + 4);
  await page.waitForTimeout(600);
  await shot(name);
  await page.mouse.click(1380, 160);
};

/** Two tiles of 680×440 side by side, as a person would drag them, then the camera fits both. */
async function sideBySide() {
  const zoom = () => page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".react-flow__viewport")!).transform).a);
  const box = async (id: string) => (await page.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
  const onScreen = (b: { x: number; y: number; width: number; height: number }) => b.x >= 0 && b.y >= 0 && b.x + b.width <= 1440 && b.y + b.height <= 900;
  /** Fit both in the window, and wait for the camera to stop moving. Again if a fit did not take. */
  const fit = () => expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("hivemind:shortcut", { detail: "fit-all" })));
    let last = -1;
    await expect.poll(async () => { const z = await zoom(); const still = z === last; last = z; return still; }, { intervals: [250] }).toBe(true);
    expect([onScreen(await box(shell)), onScreen(await box(agent))]).toEqual([true, true]);
  }).toPass({ timeout: 20_000 });
  /** A tile's size on the canvas, unscaled. */
  const size = (id: string) => page.locator(`.react-flow__node[data-id="${id}"]`).evaluate((n) => [(n as HTMLElement).offsetWidth, (n as HTMLElement).offsetHeight]);
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(400);
  };
  /** Wait for a tile to stop moving: its frame re-fits around a tile that changed. */
  const still = async (id: string) => {
    let last = "";
    await expect.poll(async () => { const b = JSON.stringify(await box(id)); const same = b === last; last = b; return same; }, { intervals: [250] }).toBe(true);
  };
  await fit();
  for (const id of [shell, agent]) {
    const corner = page.locator(`.react-flow__node[data-id="${id}"] .react-flow__resize-control.handle.bottom.right`);
    // Its header pressed, it is selected and its handles show; its corner dragged to the size. Again
    // if the canvas was still settling.
    await expect(async () => {
      await still(id);
      const b = await box(id);
      await page.mouse.click(b.x + b.width / 2, b.y + 4);
      await expect(corner).toBeVisible({ timeout: 1000 });
      const [[w, h], handle, z] = [await size(id), (await corner.boundingBox())!, await zoom()];
      if (!onScreen(handle)) { await fit(); throw new Error(`${id}'s corner is off the window`); }
      const at = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
      await drag(at, { x: at.x + (680 - w!) * z, y: at.y + (440 - h!) * z });
      const [w2, h2] = await size(id);
      expect([Math.abs(w2! - 680) < 24, Math.abs(h2! - 440) < 24], `${id} resized to 680×440, not ${w2}×${h2}`).toEqual([true, true]);
    }).toPass({ timeout: 30_000 });
  }
  await still(agent);
  const [a, b, z] = [await box(shell), await box(agent), await zoom()];
  await drag({ x: b.x + b.width / 2, y: b.y + 4 }, { x: a.x + a.width + 24 * z + b.width / 2, y: a.y + 4 });
  await fit();
}

/** What the app paints with, each colour resolved as the page paints it. */
type Look = Awaited<ReturnType<typeof look>>;
const look = () => page.evaluate(({ shell }) => {
  const c = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const hex = (css: string) => { c.clearRect(0, 0, 1, 1); c.fillStyle = "#000"; c.fillStyle = css; c.fillRect(0, 0, 1, 1); return "#" + [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join(""); };
  const root = getComputedStyle(document.documentElement);
  const token = (k: string) => hex(root.getPropertyValue(k).trim());
  const img = document.querySelector(".hm-wallpaper .hm-wp-image") as HTMLImageElement | null;
  const row = document.querySelector(`[data-layer-tile="${shell}"]`)!;
  return {
    ground: token("--color-bg"),
    text: hex(getComputedStyle(document.body).color),
    rowText: hex(getComputedStyle(row).color),
    accent: token("--color-accent"),
    brand: token("--color-brand"),
    // A theme's accent fills the main button; a preset's main button is the text colour.
    primary: token("--primary"),
    font: getComputedStyle(document.body).fontFamily,
    rowFont: getComputedStyle(row).fontFamily,
    // Drawn from the theme's woff2: a face of that family loaded, not a fallback standing in.
    nunito: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Nunito" && f.status === "loaded") && document.fonts.check('14px "Nunito"'),
    wallpaper: {
      scene: document.querySelector(".hm-wallpaper")?.getAttribute("data-scene") ?? null,
      image: img && img.complete && img.naturalWidth > 0 ? decodeURIComponent(img.src) : null,
    },
    canvas: getComputedStyle(document.querySelector(".react-flow")!).backgroundColor,
  };
}, { shell });

/** A screenshot's pixels, counted in the page: the most common colours, and how many of each wanted. */
const pixels = (png: Buffer, want: string[] = []) => page.evaluate(async ({ b64, want }) => {
  const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: "image/png" }));
  const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const counts = new Map<string, number>();
  for (let i = 0; i < d.length; i += 4) {
    const h = "#" + [d[i]!, d[i + 1]!, d[i + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("");
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return { top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h]) => h), want: want.map((h) => counts.get(h) ?? 0) };
}, { b64: png.toString("base64"), want });

/** A terminal tile's screen as drawn: its ground (the commonest colour), its five commonest, and
 *  how many pixels are Harbour's red, green, yellow and blue (ANSI 1–4, written as hex in theme.json). */
type Screen = Awaited<ReturnType<typeof screen>>;
const ANSI = (theme.terminal.ansi as string[]).slice(1, 5).map((h) => h.toLowerCase());
const screen = async (tile: string) => {
  const p = await pixels(await page.locator(`.react-flow__node[data-id="${tile}"] .xterm-screen`).screenshot(), ANSI);
  return { ground: p.top[0]!, top: [...p.top].sort(), ansi: p.want };
};

/** Whether the wallpaper is what shows on an empty stretch of canvas: hidden for a moment, most of
 *  the stretch changes; under an opaque canvas, nothing would. */
const wallpaperShows = async () => {
  const at = await page.evaluate(() => {
    const flow = document.querySelector(".react-flow")!.getBoundingClientRect();
    const empty = (x: number, y: number) => [[0, 0], [200, 0], [0, 120], [200, 120], [100, 60]].every(([dx, dy]) => document.elementFromPoint(x + dx!, y + dy!)?.classList.contains("react-flow__pane"));
    for (let y = flow.bottom - 200; y > flow.top + 60; y -= 20) for (let x = flow.right - 240; x > flow.left + 40; x -= 20) if (empty(x, y)) return { x, y, width: 200, height: 120 };
    return null;
  });
  expect(at, "an empty stretch of canvas").not.toBeNull();
  const shown = await page.screenshot({ clip: at! });
  await page.evaluate(() => { (document.querySelector(".hm-wallpaper") as HTMLElement).style.visibility = "hidden"; });
  const hidden = await page.screenshot({ clip: at! });
  await page.evaluate(() => { (document.querySelector(".hm-wallpaper") as HTMLElement).style.visibility = ""; });
  return page.evaluate(async ([a, b]) => {
    const read = async (b64: string) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: "image/png" }));
      const ctx = new OffscreenCanvas(bmp.width, bmp.height).getContext("2d")!;
      ctx.drawImage(bmp, 0, 0);
      return ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const [x, y] = [await read(a!), await read(b!)];
    let changed = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2]) changed++;
    return changed / (x.length / 4);
  }, [shown.toString("base64"), hidden.toString("base64")]);
};

/** The Archipelago view's frame, opened. */
const archipelago = async (): Promise<Frame> => {
  expect((await hiveLater("ctl", "plugin", "open", "view:@dip497/archipelago")).status).toBe(0);
  await expect.poll(() => page.frames().some((f) => f.url().includes("archipelago")), { timeout: 30_000 }).toBe(true);
  const f = page.frames().find((x) => x.url().includes("archipelago"))!;
  await f.locator(".head h1").waitFor({ timeout: 30_000 });
  return f;
};
/** What the view was told and paints with: the theme's tokens on its root, its words' colour and font. */
type ViewLook = Awaited<ReturnType<typeof viewLook>>;
const viewLook = (f: Frame) => f.evaluate(() => {
  const root = getComputedStyle(document.documentElement);
  const v = (k: string) => root.getPropertyValue(k).trim();
  const h1 = getComputedStyle(document.querySelector(".head h1")!);
  const rgb = h1.color.match(/\d+/g)!.slice(0, 3).map(Number);
  return {
    // The mode it was told (`--hm-mode`), and the one its own CSS switches on (`data-mode`).
    mode: [v("--hm-mode"), document.documentElement.dataset.mode ?? null],
    ground: v("--hm-color-bg"),
    text: v("--hm-color-fg"),
    accent: v("--hm-accent"),
    title: "#" + rgb.map((n) => n.toString(16).padStart(2, "0")).join(""),
    font: h1.fontFamily,
    nunito: [...document.fonts].some((x) => x.family.replace(/"/g, "") === "Nunito" && x.status === "loaded") && document.fonts.check('13px "Nunito"'),
  };
});
/** Open the view, read it, and go back to the canvas. */
const inView = async <T>(read: (f: Frame) => Promise<T>, then?: () => Promise<void>): Promise<T> => {
  const f = await archipelago();
  const out = await read(f);
  await then?.();
  expect((await hiveLater("ctl", "plugin", "open", "view:canvas")).status).toBe(0);
  await expect(page.locator(`.react-flow__node[data-id="${shell}"] .xterm`)).toBeVisible({ timeout: 20_000 });
  return out;
};

const openAppearance = async () => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-dialog").getByRole("button", { name: "Appearance" }).click();
  await expect(page.locator("[data-themes]")).toBeVisible();
};
const closeSettings = async () => {
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".settings-dialog")).toHaveCount(0);
  await page.mouse.click(1380, 160);
};

/** The canvas in Harbour: what each check says a person sees. */
async function harbourOnCanvas() {
  await expect.poll(async () => (await look()).ground, { timeout: 15_000 }).toBe(H.bg);
  expect(await look()).toMatchObject({
    ground: H.bg, text: H.fg, rowText: H.fg, accent: H.accent, brand: H.brand, primary: H.brand,
    font: expect.stringMatching(/^"?Nunito"?, /), rowFont: expect.stringMatching(/^"?Nunito"?, /),
    canvas: "rgba(0, 0, 0, 0)",
  });
  await expect.poll(async () => (await look()).nunito, { timeout: 10_000 }).toBe(true);
  await expect.poll(async () => (await look()).wallpaper, { timeout: 10_000 }).toEqual({ scene: "image", image: expect.stringMatching(/^hivemedia:\/\/media\/theme-[0-9a-f]{8}-wallpaper\.webp$/) });
  expect(await wallpaperShows()).toBeGreaterThan(0.9);
  // The terminal's ground and ANSI colours are Harbour's terminal palette, pixel for pixel; the
  // agent's terminal has the same ground.
  await expect.poll(async () => (await screen(shell)).ground, { timeout: 10_000 }).toBe(H.terminal);
  const sh = await screen(shell);
  for (const n of sh.ansi) expect(n).toBeGreaterThan(300);
  expect((await screen(agent)).ground).toBe(H.terminal);
}

/** Everything as it was before Harbour. */
async function asBefore() {
  await expect.poll(() => look(), { timeout: 15_000 }).toEqual(before.canvas);
  await expect.poll(() => screen(shell), { timeout: 10_000 }).toEqual(before.shell);
}

test("Settings ▸ Appearance lists Harbour; Apply paints the canvas in it: ground, text, accent, Nunito, wallpaper, terminal colours", async () => {
  test.setTimeout(120_000);
  await openAppearance();
  const row = page.locator(`[data-theme-option="${THEME}"]`);
  await expect(row).toContainText("Harbour");
  await expect(row).toContainText("Archipelago");
  await row.getByRole("button", { name: "Apply Harbour" }).click();
  await expect(page.locator(`[data-theme-applied="${THEME}"]`)).toContainText("Using Harbour");
  await expect(row.getByRole("button", { name: "Apply Harbour" })).toHaveText("In use");
  await page.waitForTimeout(800);
  await shot("settings-appearance-harbour");
  await closeSettings();
  await harbourOnCanvas();
  await canvasShot("canvas-harbour");
});

test("the Archipelago view opens in Harbour: its ground, words, accent and Nunito", async () => {
  test.setTimeout(120_000);
  const night = async () => {
    if (!SHOTS) return;
    await page.waitForTimeout(4000);
    await shot("archipelago-harbour");
    // The same at night, the hour the wallpaper shows; then the view's light as it was.
    const was = (await page.evaluate(() => window.hive.settingsGet())).plugins?.state ?? {};
    await page.evaluate((v) => window.hive.settingsSet("plugins.state", { ...v, "view:@dip497/archipelago": { ...v["view:@dip497/archipelago"], options: { ...v["view:@dip497/archipelago"]?.options, sky: "night" } } }), was);
    await page.waitForTimeout(5000);
    await shot("archipelago-harbour-night");
    await page.evaluate((v) => window.hive.settingsSet("plugins.state", v), was);
  };
  const harbour = { mode: ["dark", "dark"], ground: H.bg, text: H.fg, accent: H.brand, title: H.fg, font: expect.stringMatching(/^"?Nunito"?, /), nunito: true };
  await inView(async (f) => { await expect.poll(() => viewLook(f), { timeout: 30_000 }).toEqual(harbour); }, night);
});

test("Revert to previous look puts the canvas and the view back as they were", async () => {
  test.setTimeout(120_000);
  await openAppearance();
  await page.locator("[data-theme-revert]").click();
  await expect(page.locator("[data-theme-applied]")).toHaveCount(0);
  await expect(page.locator(`[data-theme-option="${THEME}"]`).getByRole("button", { name: "Apply Harbour" })).toHaveText("Apply");
  await closeSettings();
  await asBefore();
  await canvasShot("canvas-reverted");
  await inView(async (f) => { await expect.poll(() => viewLook(f), { timeout: 30_000 }).toEqual(before.view); });
});

test("`hive theme use` paints the same Harbour into the running app, and `hive theme revert` takes it away", async () => {
  test.setTimeout(120_000);
  expect(hive("theme", "use", THEME)).toMatchObject({ status: 0, data: { theme: THEME, name: "Harbour", mode: "dark", rescanned: true } });
  await harbourOnCanvas();
  expect(hive("theme", "list").data.applied).toMatchObject({ id: THEME, name: "Harbour" });
  expect(hive("theme", "revert")).toMatchObject({ status: 0, data: { reverted: THEME, rescanned: true } });
  await asBefore();
});
