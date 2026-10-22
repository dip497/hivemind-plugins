// Focus in the real app: every agent in the list, whoever asks for the person moving to the top as
// "Needs you"; picking one docks its live terminal; a task typed for a ready agent goes through the
// app's own confirm and reaches it; the commands an agent can call answer; and the person's theme
// (Clean, Clean Light) restyles the view. FOCUS_SHOTS names a folder for screenshots.
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
const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); };
/** Wait until the agent is ready (a new stand-in reads as working until its prompt shows), so the
 *  list has stopped moving it before it is clicked. */
const ready = (name: string) => expect.poll(async () => (await call("board"))?.Ready?.map((x: { name: string }) => x.name) ?? [], { timeout: 30_000 }).toContain(name);

test("every agent is listed, and one that asks for you moves to the top as Needs you", async () => {
  await expect.poll(order, { timeout: 30_000 }).toEqual(expect.arrayContaining(["alpha", "beta", "gamma"]));
  expect(hive("ctl", "send", tiles.gamma!, "ask").status).toBe(0);
  await expect.poll(async () => (await order())[0], { timeout: 30_000 }).toBe("gamma");
  await expect(view.locator('[role="tab"][data-group="needs"]')).toContainText("1");
  const board = await call("board");
  expect(board["Needs you"].map((x: { name: string }) => x.name)).toEqual(["gamma"]);
  expect(board["Needs you"][0].detail).toBe("wants permission");
  await shot("focus-signal");
});

test("picking an agent docks its live terminal beside the list; Close and release let go of it", async () => {
  await ready("alpha");
  await view.locator('[role="option"][data-agent="alpha"]').click();
  const slot = page.locator(`[data-community-slot="${tiles.alpha}"]`);
  await expect(slot.locator(".xterm")).toBeVisible({ timeout: 20_000 });
  // The terminal sits inside the view's dock, not over the list.
  const [dock, docked] = await Promise.all([
    view.locator("[data-dock]").boundingBox(),
    slot.boundingBox(),
  ]);
  expect(Math.abs(docked!.x - dock!.x)).toBeLessThan(3);
  expect(Math.abs(docked!.width - dock!.width)).toBeLessThan(3);
  await view.getByRole("button", { name: "Close its terminal" }).click();
  await expect(slot).toHaveCount(0);
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
  const card = () => view.locator('[data-slot="card"]').first().evaluate((e) => getComputedStyle(e).backgroundColor);
  await page.evaluate(() => window.hive.settingsSet("appearance.glass.animate", false));
  await expect.poll(() => hiveLater("theme", "use", "clean").then((r) => r.status)).toBe(0);
  await expect.poll(card).toBe("rgb(17, 17, 19)"); // Clean's bg2
  await view.locator('[role="option"][data-agent="beta"]').click();
  await page.waitForTimeout(1500);
  await shot("focus-clean");
  await expect.poll(() => hiveLater("theme", "use", "clean-light").then((r) => r.status)).toBe(0);
  await expect.poll(card).toBe("rgb(255, 255, 255)"); // Clean Light's bg2
  await page.waitForTimeout(1500);
  await shot("focus-clean-light");
});
