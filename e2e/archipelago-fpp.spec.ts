// Archipelago through your own eyes, in the real app over stand-in agents: the walk command lands you
// in first person, V and the switch by the walking line change between your eyes and the view from
// behind, Esc flies you up, and the view you chose is there the next time you walk. What is checked
// is what reaches the screen: looking up through your eyes you see the sky where from behind you see
// the island, and your own worker is drawn from behind but never through your eyes.
// FPP_SHOTS names a folder to also take pictures through your eyes by day and by night, in Signal
// and in Clean Light, and with a terminal docked.
import { test, expect, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, session } from "./app";
import { standinAgent } from "./standin";

const s = session("archipelago-fpp");
const { root, hive, hiveLater } = s;
const SHOTS = process.env.FPP_SHOTS ?? "";
let page: Page;
const tiles: Record<string, string> = {};

/** What the view's walk command answers. */
interface Walking { walking: boolean; who: string; island: string | null; pov: "first" | "third" }
const walk = async (arg: object): Promise<Walking> => {
  const r = await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "walk", JSON.stringify(arg));
  expect(r.status).toBe(0);
  return r.data.result;
};
const census = async () => (await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "census")).data?.result;
/** The view's frame, once the app has loaded it. */
const viewFrame = async (): Promise<Frame> => {
  let frame: Frame | undefined;
  await expect.poll(() => (frame = page.frames().find((f) => f.url().includes("archipelago"))) !== undefined, { timeout: 30_000 }).toBe(true);
  return frame!;
};
/** Opens the view and waits for its islands and agents. */
const open = async (): Promise<Frame> => {
  expect((await hiveLater("ctl", "plugin", "open", "view:@dip497/archipelago")).status).toBe(0);
  const frame = await viewFrame();
  await expect.poll(async () => (await census())?.agents, { timeout: 60_000 }).toBe(3);
  return frame;
};
/** The view's own settings, as the person sets them. */
const options = (o: Record<string, unknown>) => page.evaluate(async (o) => {
  const hive = (window as unknown as { hive: { settingsGet(): Promise<{ plugins: { state: Record<string, { options?: object }> } }>; settingsSet(p: string, v: unknown): Promise<unknown> } }).hive;
  const state = { ...(await hive.settingsGet()).plugins.state }, key = "view:@dip497/archipelago";
  state[key] = { ...state[key], options: { ...state[key]?.options, ...o } };
  await hive.settingsSet("plugins.state", state);
}, o);
/** A drag over the middle of the view, as a person turns or tips their look. */
const drag = async (dx: number, dy: number) => {
  const box = (await page.locator("iframe").first().boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
};
/** The window as it is now, once the view has drawn what it was last told. Software drawing is slow. */
const shot = async () => { await page.waitForTimeout(1500); return (await page.screenshot()).toString("base64"); };

// Read from screenshots by the app's own page. The middle of the picture: clear of the header and the
// calls at the top, the walking line, the toolbar and the app's notices at the foot.
const MIDDLE = { x0: 0.15, x1: 0.85, y0: 0.12, y1: 0.82 };
/** What the middle of a picture is like: its mean colour, and how much detail it holds (the mean step
 *  between pixels side by side, over the channels). The day's sky is blue and smooth; the island seen
 *  from above, with its trees, houses and surf, is anything but smooth. */
const look = (png: string, box = MIDDLE) => page.evaluate(async ({ png, box }) => {
  const img = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
  const g = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
  g.drawImage(img, 0, 0);
  const { data: d, width: w, height: h } = g.getImageData(0, 0, img.width, img.height);
  let step = 0, r = 0, gr = 0, b = 0, n = 0;
  for (let y = Math.floor(h * box.y0); y < h * box.y1; y++) for (let x = Math.floor(w * box.x0); x < w * box.x1 - 1; x++) {
    const p = (y * w + x) * 4;
    step += Math.abs(d[p]! - d[p + 4]!) + Math.abs(d[p + 1]! - d[p + 5]!) + Math.abs(d[p + 2]! - d[p + 6]!);
    r += d[p]!; gr += d[p + 1]!; b += d[p + 2]!;
    n++;
  }
  return { detail: step / n, r: r / n, g: gr / n, b: b / n };
}, { png, box });
/** How many pixels in the middle of two pictures differ by more than a shade. */
const differ = (a: string, b: string, box = MIDDLE) => page.evaluate(async ({ a, b, box }) => {
  const read = async (png: string) => {
    const img = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], { type: "image/png" }));
    const g = new OffscreenCanvas(img.width, img.height).getContext("2d")!;
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, img.width, img.height);
  };
  const [p, q] = [await read(a), await read(b)], w = p.width, h = p.height;
  let n = 0;
  for (let y = Math.floor(h * box.y0); y < h * box.y1; y++) for (let x = Math.floor(w * box.x0); x < w * box.x1; x++) {
    const i = (y * w + x) * 4;
    if (Math.abs(p.data[i]! - q.data[i]!) + Math.abs(p.data[i + 1]! - q.data[i + 1]!) + Math.abs(p.data[i + 2]! - q.data[i + 2]!) > 24) n++;
  }
  return n;
}, { a, b, box });

test.beforeAll(async () => {
  Object.assign(s.env, standinAgent(path.join(root, "config"), root));
  expect(hive("plugins", "install", path.join(PLUGINS, "packages", "archipelago")).status).toBe(0);
  page = await s.launch();
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const name of ["alpha", "beta", "gamma"]) {
    const r = hive("ctl", "spawn", "--agent", "standin", "--name", name);
    expect(r.status).toBe(0);
    tiles[name] = r.data.tile;
  }
});
test.afterAll(async () => {
  await s.close();
  // The terminal daemon outlives the app: stop it and the stand-ins, which all run from this folder.
  for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try { if (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root)) process.kill(Number(pid), "SIGKILL"); } catch { /* gone */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test("archipelago: through your eyes you see the sky above and not your own worker, V and the switch change to the view from behind and back, Esc flies up, and the next walk is through your eyes again", async () => {
  test.setTimeout(240_000);
  // By day and holding still, so two pictures differ only by what changed between them; no camera
  // effects, so a graphics card draws what a software one does.
  await options({ sky: "day", motion: "less", effects: false });
  let view = await open();
  const pov = view.locator(".pov"), walking = view.locator(".walking"), walkButton = view.locator(".bar .walk");

  expect(await walk({ on: true, pov: "first" })).toMatchObject({ walking: true, pov: "first" });
  await expect(walking).toBeVisible();
  await expect(pov).toHaveAttribute("aria-checked", "true");
  await expect(view.locator(".walk-hint")).toContainText(/V for third person|E · /);

  // Drag up to look up as far as you can.
  await drag(0, -500);
  const up = await shot();
  // Drag down to look down at your feet: your worker is not drawn there, so becoming another one
  // changes nothing.
  await drag(0, 1000);
  const feet = await shot();
  await page.keyboard.press("c");
  const feetAsAnother = await shot();
  expect(await differ(feet, feetAsAnother)).toBeLessThan(50);

  // V: from behind, your worker is drawn: becoming another one changes it.
  await page.keyboard.press("v");
  await expect(pov).toHaveAttribute("aria-checked", "false");
  const behind = await shot();
  await page.keyboard.press("c");
  const behindAsAnother = await shot();
  expect(await differ(behind, behindAsAnother)).toBeGreaterThan(400);
  // Through your eyes, the sky above you, bluer than the ground at your feet (grass, sand or snow);
  // from behind, the island where your eyes saw sky.
  const [sky, ground, island] = [await look(up), await look(feet), await look(behind)];
  expect({ skyIsBlue: sky.b > sky.g && sky.b > sky.r, skyIsSmooth: sky.detail < 3, groundIsLessBlue: sky.b - sky.g > ground.b - ground.g + 10, islandIsDetailed: island.detail > 2 * sky.detail })
    .toEqual({ skyIsBlue: true, skyIsSmooth: true, groundIsLessBlue: true, islandIsDetailed: true });
  expect(await walk({ on: true })).toMatchObject({ walking: true, pov: "third" });

  // The switch by the walking line, for a pointer: back through your eyes.
  await pov.click();
  await expect(pov).toHaveAttribute("aria-checked", "true");
  await expect(view.locator(".walk-hint")).toContainText(/V for third person|E · /);

  // Esc flies you up from your eyes.
  await page.keyboard.press("Escape");
  await expect(walkButton).toHaveAttribute("aria-pressed", "false");
  await expect(walking).toBeHidden();

  // Closed and opened again, the view walks you through your eyes, as you last chose.
  await page.waitForTimeout(1000);
  expect((await hiveLater("ctl", "plugin", "close", "view:@dip497/archipelago")).status).toBe(0);
  view = await open();
  await expect(view.locator(".pov")).toHaveAttribute("aria-checked", "true");
  expect(await walk({ on: true })).toMatchObject({ walking: true, pov: "first" });
  expect(await walk({ on: false })).toMatchObject({ walking: false, pov: "first" });
});

test("archipelago: pictures through your eyes by day and night, in Signal and Clean Light, and with a terminal docked", async () => {
  test.skip(!SHOTS, "takes pictures only when FPP_SHOTS names where they go");
  test.setTimeout(600_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  // Beta asks for permission: it stands under its light, calling you.
  expect(hive("ctl", "send", tiles.beta!, "ask").status).toBe(0);
  await options({ motion: "full", effects: true });
  const view = await open();
  await expect.poll(async () => (await census())?.callingYou?.length, { timeout: 30_000 }).toBe(1);
  expect(await walk({ on: true, pov: "first" })).toMatchObject({ pov: "first" });
  for (const preset of ["signal", "clean-light"]) {
    expect(hive("theme", "use", preset).status).toBe(0);
    for (const sky of ["day", "night"]) {
      await options({ sky });
      await page.waitForTimeout(4000);
      await page.screenshot({ path: path.join(SHOTS, `fpp-${preset}-${sky}.png`) });
    }
  }
  // Answering beta in its terminal, docked on the right: your eyes look into the open space left of it.
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "next")).status).toBe(0);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, "fpp-clean-light-night-docked.png") });
  await view.locator(".pov").click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, "third-clean-light-night-docked.png") });
  expect(hive("theme", "use", "signal").status).toBe(0);
});
