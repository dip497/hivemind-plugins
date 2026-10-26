// Archipelago through your own eyes, in the real app over stand-in agents: the walk command lands you
// in first person, V and the switch by the walking line change between your eyes and the view from
// behind, Esc flies you up, and the view you chose is there the next time you walk. What is checked
// is what reaches the screen: looking up through your eyes you see the sky where from behind you see
// the island, your own worker is drawn from behind but never through your eyes, and how far back the
// view from behind was left changes nothing through them. With an agent calling you, you land facing
// it, an arrow points at it out of sight, and picked first you land in front of it at talking distance
// with its name in sight, stop there walking into it, and E turns you to it; walked up closer from
// behind, its name stays in the picture through your eyes.
// FPP_SHOTS names a folder to also take pictures through your eyes by day and by night, in Signal
// and in Clean Light, at talking distance, and with a terminal docked.
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
/** A key held down for `ms`. */
const hold = async (key: string, ms: number) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
/** What the walking line says how to walk with, through your eyes. */
const HOW_FIRST = "WASD to walk · drag or ←→ to look round · Shift to run";
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
  // Just landed, the walking line says how to walk; once you look round, what you can do where you stand.
  await expect(view.locator(".walk-hint")).toHaveText(HOW_FIRST);
  // A view it does not know is refused, not walked.
  const bad = await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "walk", JSON.stringify({ pov: "sideways" }));
  expect(bad.status).not.toBe(0);
  expect(JSON.stringify(bad.data)).toContain("pov is one of first, third");

  // Drag up to look up as far as you can.
  await drag(0, -500);
  await expect(view.locator(".walk-hint")).toHaveText(/^E · /);
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

  // The switch by the walking line, for a pointer: back through your eyes, and how to walk with them.
  await pov.click();
  await expect(pov).toHaveAttribute("aria-checked", "true");
  await expect(view.locator(".walk-hint")).toHaveText(HOW_FIRST);

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

  // How far back the view from behind is left changes nothing through your eyes: − there does nothing,
  // and from behind it stops at 22, as the wheel does; no pin meant for the far view is drawn over the
  // workers you see. (A short drag first: the keys go to the view.)
  await drag(6, 0);
  await page.keyboard.press("v");
  const behind12 = await shot();
  await page.keyboard.press("v");
  const eyes12 = await shot();
  for (let k = 0; k < 8; k++) await page.keyboard.press("-");
  await page.keyboard.press("v");
  expect(await differ(behind12, await shot())).toBeLessThan(50);
  for (let k = 0; k < 8; k++) await page.keyboard.press("-");
  const behind22 = await shot();
  expect(await differ(behind12, behind22)).toBeGreaterThan(400);
  for (let k = 0; k < 4; k++) await page.keyboard.press("-");
  expect(await differ(behind22, await shot())).toBeLessThan(50);
  await page.keyboard.press("v");
  expect(await differ(eyes12, await shot())).toBeLessThan(50);

  // V held past the key's repeat delay changes the view once, not with every repeat; C held changes
  // who you are once.
  await page.keyboard.down("v");
  await page.keyboard.down("v");
  await page.keyboard.up("v");
  await expect(view.locator(".pov")).toHaveAttribute("aria-checked", "false");
  const WHO = ["rogue", "knight", "mage", "barbarian"], was = (await walk({ on: true })).who;
  await page.keyboard.down("c");
  await page.keyboard.down("c");
  await page.keyboard.up("c");
  expect((await walk({ on: true })).who).toBe(WHO[(WHO.indexOf(was) + 1) % WHO.length]);
  expect(await walk({ on: false })).toMatchObject({ walking: false, pov: "third" });
});

test("archipelago: through your eyes you land facing the agent calling you, an arrow low on the edge points at it out of sight, and picked first you land in front of it, stop at talking distance walking into it, its name in sight, E turns you back to it, and walked up closer from behind its name stays in the picture", async () => {
  test.setTimeout(240_000);
  await options({ sky: "day", motion: "less", effects: false });
  // Beta asks for permission: it stands under its light, calling you.
  expect(hive("ctl", "send", tiles.beta!, "ask").status).toBe(0);
  const view = await open();
  await expect.poll(async () => (await census())?.callingYou, { timeout: 30_000 }).toEqual(["beta"]);
  const name = view.locator(".label.agent.calling"), arrows = view.locator(".edges .edge"), line = view.locator(".walk-hint");

  // Landing, you face it: its name is in the picture, and no arrow points anywhere.
  expect(await walk({ on: true, pov: "first" })).toMatchObject({ walking: true, pov: "first" });
  await expect(name).toBeVisible();
  await expect(name).toContainText("beta");
  await expect(arrows).toHaveCount(0);
  const row = (await view.locator(".walking").boundingBox())!, vp = page.viewportSize()!;

  // Looking up at the sky, it is below the picture: the arrow at the foot points down, clear of the
  // walking line and the toolbar under it.
  await drag(0, -400);
  await expect(arrows).toHaveCount(1);
  let arrow = (await arrows.boundingBox())!;
  expect(arrow.y).toBeGreaterThan(vp.height / 2);
  expect(arrow.y + arrow.height).toBeLessThanOrEqual(row.y - 12);
  await drag(0, (Math.PI / 3 + 0.1) / 0.004);
  await expect(arrows).toHaveCount(0);

  // Turned right round with →, it is behind you: an arrow on the left or right edge, low down.
  await hold("ArrowRight", 1500);
  await expect(name).toBeHidden();
  await expect(arrows).toHaveCount(1);
  arrow = (await arrows.boundingBox())!;
  expect(arrow.x < 100 || arrow.x + arrow.width > vp.width - 100).toBe(true);
  expect(arrow.y).toBeGreaterThan(vp.height / 2);
  expect(arrow.y + arrow.height).toBeLessThanOrEqual(row.y - 12);

  // Flown up, beta picked (its terminal shown and put away again) and walked again: you land in front
  // of it, facing it, near enough to talk, its name over its head in the picture (not pinned to the top
  // edge, as when you stand so close its head fills the view).
  await page.keyboard.press("Escape");
  await expect(view.locator(".walking")).toBeHidden();
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "show", JSON.stringify({ name: "beta" }))).status).toBe(0);
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "release")).status).toBe(0);
  expect(await walk({ on: true, pov: "first" })).toMatchObject({ walking: true, pov: "first" });
  await drag(6, 0);
  await expect(line).toHaveText("E · talk to beta, needs your permission");
  await expect(name).toBeVisible();
  expect((await name.boundingBox())!.y).toBeGreaterThan(20);
  await expect(arrows).toHaveCount(0);
  // Walked into, it stops you at talking distance, still facing it.
  await hold("w", 1000);
  await expect(line).toHaveText("E · talk to beta, needs your permission");
  await expect(name).toBeVisible();
  expect((await name.boundingBox())!.y).toBeGreaterThan(20);

  // Turned away with → it is out of sight, beside you: no arrow for it. E turns you back to face it,
  // with its terminal docked beside you.
  await hold("ArrowRight", 900);
  await expect(name).toBeHidden();
  await expect(arrows).toHaveCount(0);
  await page.keyboard.press("e");
  await expect(view.locator(".dock")).toHaveAttribute("data-open", "");
  await expect(name).toBeVisible();
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "release")).status).toBe(0);
  // From behind you walk up closer, body to body. Back in your eyes there, looking down a little at it,
  // its head fills the top of the view and the point over it is above the picture: its name stays in
  // the picture, at the top.
  await drag(6, 0);
  await page.keyboard.press("v");
  await hold("w", 1500);
  await page.keyboard.press("v");
  await drag(0, 90);
  await page.waitForTimeout(1500);
  await expect(name).toBeVisible();
  expect((await name.boundingBox())!.y).toBeGreaterThanOrEqual(10);
  expect(await walk({ on: false })).toMatchObject({ walking: false });
  // Answered: beta is ready for work again.
  expect(hive("ctl", "send", tiles.beta!, "1").status).toBe(0);
  await expect.poll(async () => (await census())?.callingYou, { timeout: 30_000 }).toEqual([]);
});

test("archipelago: pictures through your eyes by day and night, in Signal and Clean Light, at talking distance, and with a terminal docked", async () => {
  test.skip(!SHOTS, "takes pictures only when FPP_SHOTS names where they go");
  test.setTimeout(600_000);
  fs.mkdirSync(SHOTS, { recursive: true });
  // Beta asks for permission: it stands under its light, calling you.
  expect(hive("ctl", "send", tiles.beta!, "ask").status).toBe(0);
  await options({ motion: "full", effects: true });
  const view = await open();
  await expect.poll(async () => (await census())?.callingYou?.length, { timeout: 30_000 }).toBe(1);
  expect(await walk({ on: true, pov: "first" })).toMatchObject({ pov: "first" });
  const both = async (name: string) => {
    for (const preset of ["signal", "clean-light"]) {
      expect(hive("theme", "use", preset).status).toBe(0);
      for (const sky of ["day", "night"]) {
        await options({ sky });
        await page.waitForTimeout(4000);
        await page.screenshot({ path: path.join(SHOTS, `${name}-${preset}-${sky}.png`) });
      }
    }
    expect(hive("theme", "use", "signal").status).toBe(0);
    await options({ sky: "day" });
  };
  // Where you land, facing beta; then turned away from it, its arrow at the edge.
  await both("fpp-landed");
  await drag(6, 0);
  await hold("ArrowRight", 1500);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, "fpp-caller-behind.png") });
  // At talking distance: picked, then walked again, in front of it.
  await hold("ArrowLeft", 1500);
  expect(await walk({ on: false })).toMatchObject({ walking: false });
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "show", JSON.stringify({ name: "beta" }))).status).toBe(0);
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "release")).status).toBe(0);
  expect(await walk({ on: true, pov: "first" })).toMatchObject({ pov: "first" });
  await drag(6, 0);
  await both("fpp-talking");
  // A wide window and a narrow one: the lens stays a person's.
  for (const [width, height] of [[1900, 640], [760, 900]] as const) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(SHOTS, `fpp-window-${width}x${height}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await options({ sky: "night" });
  expect(hive("theme", "use", "clean-light").status).toBe(0);
  // Answering beta in its terminal, docked on the right: your eyes look into the open space left of it.
  expect((await hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "next")).status).toBe(0);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, "fpp-clean-light-night-docked.png") });
  await view.locator(".pov").click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(SHOTS, "third-clean-light-night-docked.png") });
  expect(hive("theme", "use", "signal").status).toBe(0);
});
