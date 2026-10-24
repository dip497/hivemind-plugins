// Focus in the real app: every agent in the list, whoever asks for the person moving to the top as
// "Needs you", named in the line under the title and opened on its own; picking one docks its live
// terminal, and a closed one stays closed; a task typed for a ready agent goes through the app's own
// confirm and reaches it; the commands an agent can call answer; and the person's theme (Clean,
// Clean Light) restyles the view. FOCUS_SHOTS names a folder for screenshots.
import { test, expect, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, session } from "./app";
import { standinAgent } from "./standin";

const s = session("focus");
const { root, hive, hiveLater } = s;
const SHOTS = process.env.FOCUS_SHOTS ?? "";
let page: Page;
let view: Frame;
const tiles: Record<string, string> = {};

test.beforeAll(async () => {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  Object.assign(s.env, standinAgent(path.join(root, "config"), root));
  expect(hive("plugins", "install", path.join(PLUGINS, "views", "focus", "dist")).status).toBe(0);
  page = await s.launch();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const name of ["alpha", "beta", "gamma"]) {
    const r = hive("ctl", "spawn", "--agent", "standin", "--name", name);
    expect(r.status).toBe(0);
    tiles[name] = r.data.tile;
  }
  expect((await hiveLater("ctl", "plugin", "open", "view:@dip497/focus")).status).toBe(0);
  await expect.poll(() => page.frames().some((f) => f.url().includes("focus")), { timeout: 30_000 }).toBe(true);
  view = page.frames().find((f) => f.url().includes("focus"))!;
});
test.afterAll(async () => {
  await s.close();
  for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try { if (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root)) process.kill(Number(pid), "SIGKILL"); } catch { /* gone */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

const call = async (command: string, args?: unknown) => (await hiveLater("ctl", "plugin", "call", "@dip497/focus", command, ...(args ? [JSON.stringify(args)] : []))).data?.result;
const order = () => view.locator('[role="option"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.agent));
const docked = (name: string) => page.locator(`[data-community-slot="${tiles[name]}"]`);
/** The view's ground as the browser paints it, as hex. */
const ground = () => view.evaluate(() => { const c = document.createElement("canvas").getContext("2d")!; c.fillStyle = getComputedStyle(document.body).backgroundColor; c.fillRect(0, 0, 1, 1); return "#" + [...c.getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join(""); });
const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
/** Wait until the agent is ready (a new stand-in reads as working until its prompt shows), so the
 *  list has stopped moving it before it is clicked. */
const ready = (name: string) => expect.poll(async () => (await call("board"))?.Ready?.map((x: { name: string }) => x.name) ?? [], { timeout: 30_000 }).toContain(name);

test("every agent is listed; one that asks for you moves to the top as Needs you, is named, and opens", async () => {
  await expect.poll(order, { timeout: 30_000 }).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
  expect(hive("ctl", "send", tiles.gamma!, "ask").status).toBe(0);
  await expect.poll(async () => (await order())[0], { timeout: 30_000 }).toBe("gamma");
  await expect(view.locator('[data-group="needs"] h2')).toHaveText("Needs you1");
  await expect(view.locator("[data-finding]")).toHaveText("gamma wants permission");
  // Nobody picked one yet: Focus opens whoever waits on you, its terminal beside the list.
  await expect(docked("gamma").locator(".xterm")).toBeVisible({ timeout: 20_000 });
  const board = await call("board");
  expect(board["Needs you"].map((x: { name: string }) => x.name)).toEqual(["gamma"]);
  expect(board["Needs you"][0].detail).toBe("wants permission");
  await shot("focus-signal");
});

test("picking an agent docks its live terminal beside the list; Close and release let go of it, and it stays closed", async () => {
  await ready("alpha");
  await view.locator('[role="option"][data-agent="alpha"]').click();
  const slot = docked("alpha");
  await expect(slot.locator(".xterm")).toBeVisible({ timeout: 20_000 });
  await expect(docked("gamma")).toHaveCount(0);
  // The terminal sits inside the view's dock, not over the list.
  const [dock, slotBox] = await Promise.all([
    view.locator("[data-dock]").boundingBox(),
    slot.boundingBox(),
  ]);
  expect(Math.abs(slotBox!.x - dock!.x)).toBeLessThan(3);
  expect(Math.abs(slotBox!.width - dock!.width)).toBeLessThan(3);
  await view.getByRole("button", { name: "Close its terminal" }).click();
  await expect(slot).toHaveCount(0);
  // Closed by the person, it does not reopen on its own while nobody new needs them.
  await page.waitForTimeout(1500);
  await expect(page.locator("[data-community-slot]")).toHaveCount(0);
  expect(await call("open", { name: "bet" })).toEqual({ open: "beta" });
  await expect(page.locator(`[data-community-slot="${tiles.beta}"] .xterm`)).toBeVisible({ timeout: 20_000 });
  expect(await call("release")).toEqual({ open: null });
  await expect(page.locator(`[data-community-slot="${tiles.beta}"]`)).toHaveCount(0);
});

test("a task typed for a ready agent goes through the app's confirm and reaches it", async () => {
  await ready("alpha");
  await view.locator('[role="option"][data-agent="alpha"]').click();
  const box = view.getByPlaceholder("Give it its next task…");
  await box.fill("work 5");
  await box.press("Enter");
  const dialog = page.locator("[data-prompt-dialog]");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(dialog).toContainText("work 5");
  await shot("focus-confirm");
  await dialog.getByRole("button", { name: "Send" }).click();
  await expect(dialog).toHaveCount(0);
  // The stand-in works for 5 s on "work 5": it moves to Working, then back to Ready.
  await expect.poll(async () => (await call("board"))?.Working?.map((x: { name: string }) => x.name) ?? [], { timeout: 20_000 }).toContain("alpha");
  // While it works there is no box, only how to steer it; done, the box is back, empty.
  await expect(view.getByText("It is working.", { exact: false })).toBeVisible();
  await ready("alpha");
  await expect(box).toHaveValue("");
});

test("the person's theme restyles the view: Clean, then Clean Light", async () => {
  await page.evaluate(() => window.hive.settingsSet("appearance.glass.animate", false));
  await expect.poll(() => hiveLater("theme", "use", "clean").then((r) => r.status)).toBe(0);
  await expect.poll(ground).toBe("#0d0e10"); // Clean's ground, Signal's graphite
  await view.locator('[role="option"][data-agent="beta"]').click();
  await page.waitForTimeout(1500);
  await shot("focus-clean");
  await expect.poll(() => hiveLater("theme", "use", "clean-light").then((r) => r.status)).toBe(0);
  await expect.poll(ground).toBe("#eef0f3"); // Clean Light's ground
  await page.waitForTimeout(1500);
  await shot("focus-clean-light");
});

test("on an app with line slots, an agent's last line shows under its name, drawn by the app, and never reaches the view", async () => {
  test.skip(!(await view.evaluate(() => document.querySelector("[data-line]") !== null)), "the app at HIVEMIND_APP has no lineSlots (protocol 1.17)");
  expect(hive("ctl", "send", tiles.alpha!, "work 20").status).toBe(0);
  const line = page.locator(`[data-community-lines] [data-community-line="${tiles.alpha}"] [data-line-slot]`);
  await expect(line).toHaveText(/editing src\/module\d+\.ts/, { timeout: 30_000 });
  // Under alpha's name in the list: the name's box in the view, moved by where its frame sits.
  const [frameBox, nameBox, at] = await Promise.all([
    (await view.frameElement()).boundingBox(),
    view.locator('[role="option"][data-agent="alpha"] .text-row').boundingBox(),
    page.locator(`[data-community-line="${tiles.alpha}"]`).boundingBox(),
  ]);
  expect(Math.abs(at!.x - (frameBox!.x + nameBox!.x))).toBeLessThan(3);
  expect(at!.y).toBeGreaterThanOrEqual(frameBox!.y + nameBox!.y + nameBox!.height - 1);
  expect(at!.y - (frameBox!.y + nameBox!.y + nameBox!.height)).toBeLessThan(24);
  expect(at!.height).toBeGreaterThanOrEqual(20);
  await shot("focus-line-slots");
  // The view has the room, not the words.
  expect(await view.evaluate(() => document.body.innerText)).not.toContain("editing src/module");
  await ready("alpha");
});
