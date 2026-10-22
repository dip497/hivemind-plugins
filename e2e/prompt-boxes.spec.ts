// The "give it work" box in each view that has one, in the real app: Enter (and Send, where there
// is a button) asks the app to send the text, so the app's prompt dialog opens. A view's frame may
// not submit forms (its sandbox has no allow-forms), so a box that only listens for `submit` never
// reaches the app.
import { test, expect, type Frame, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, session } from "./app";
import { standinAgent } from "./standin";

const s = session("prompt-boxes");
const { root, hive, hiveLater } = s;
let page: Page;

test.beforeAll(async () => {
  Object.assign(s.env, standinAgent(path.join(root, "config"), root));
  expect(hive("plugins", "install", path.join(PLUGINS, "views", "agents-by-state")).status).toBe(0);
  expect(hive("plugins", "install", path.join(PLUGINS, "views", "island", "dist")).status).toBe(0);
  expect(hive("plugins", "install", path.join(PLUGINS, "packages", "archipelago")).status).toBe(0);
  page = await s.launch();
  expect(hive("ctl", "spawn", "--agent", "standin", "--name", "alpha").status).toBe(0);
});
test.afterAll(async () => {
  await s.close();
  // The terminal daemon outlives the app: stop it and the stand-in, which run from this folder.
  for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try { if (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").includes(root)) process.kill(Number(pid), "SIGKILL"); } catch { /* gone */ }
  }
  fs.rmSync(root, { recursive: true, force: true });
});

/** The open view's frame, once the app has loaded it. */
async function viewFrame(id: string): Promise<Frame> {
  let frame: Frame | undefined;
  await expect.poll(() => (frame = page.frames().find((f) => f.url().includes(id))) !== undefined, { timeout: 30_000 }).toBe(true);
  return frame!;
}

const dialog = () => page.locator("[data-prompt-dialog]");
/** Close the app's dialog without sending, and wait for it to go. */
async function cancel() {
  await page.keyboard.press("Escape");
  await expect(dialog()).toHaveCount(0);
}

const VIEWS = [
  { name: "agents-by-state", id: "agents-by-state", placeholder: "Its next task…", reveal: async () => {}, send: false },
  { name: "island", id: "island", placeholder: "Give it work…", reveal: () => hiveLater("ctl", "plugin", "call", "@dip497/island", "show", JSON.stringify({ name: "alpha" })), send: true },
  { name: "archipelago", id: "archipelago", placeholder: "Give it work…", reveal: () => hiveLater("ctl", "plugin", "call", "@dip497/archipelago", "show", JSON.stringify({ name: "alpha" })), send: true },
] as const;

for (const v of VIEWS) {
  test(`${v.name}: Enter in the box asks the app to send the text${v.send ? ", and so does Send" : ""}`, async () => {
    test.setTimeout(120_000);
    expect((await hiveLater("ctl", "plugin", "open", `view:@dip497/${v.id}`)).status).toBe(0);
    const frame = await viewFrame(v.id);
    await v.reveal();
    const box = frame.getByPlaceholder(v.placeholder).first();
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.fill("work 2");
    await box.press("Enter");
    await expect(dialog()).toBeVisible({ timeout: 10_000 });
    await expect(dialog()).toContainText("work 2");
    await cancel();
    if (v.send) {
      await box.fill("work 3");
      await frame.getByRole("button", { name: "Send" }).first().click();
      await expect(dialog()).toBeVisible({ timeout: 10_000 });
      await expect(dialog()).toContainText("work 3");
      await cancel();
    }
  });
}
