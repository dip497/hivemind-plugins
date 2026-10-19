// Island and Current in the real app: an agent that starts asking the person shows up as calling
// them, `next` opens its live terminal beside the view, and an answer typed there ends the call.
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, session } from "./app";
import { standinAgent } from "./standin";

const s = session("views");
const { root, hive, hiveLater } = s;
let page: Page;
const tiles: Record<string, string> = {};

test.beforeAll(async () => {
  Object.assign(s.env, standinAgent(path.join(root, "config"), root));
  for (const name of ["island", "current"]) expect(hive("views", "install", path.join(PLUGINS, "views", name, "dist")).status).toBe(0);
  page = await s.launch();
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

// A call into the view waits on the window, so it must not hold this process while it runs.
const call = async (view: string, command: string) => (await hiveLater("ctl", "plugin", "call", `@dip497/${view}`, command)).data?.result;
const census = (view: string) => call(view, "census");
const calling = async (view: string) => {
  const c = (await census(view))?.callingYou ?? [];
  return c.map((x: string | { name: string }) => (typeof x === "string" ? x : x.name));
};

// Each view gets an agent of its own to ask, so one test's answer cannot reach the other's.
for (const [view, asker] of [["island", "beta"], ["current", "gamma"]] as const) {
  test(`${view}: an agent asking shows as calling you, next opens its terminal, and an answer typed there ends the call`, async () => {
    test.setTimeout(120_000);
    expect((await hiveLater("ctl", "plugin", "open", `view:@dip497/${view}`)).status).toBe(0);
    await expect.poll(async () => (await census(view))?.agents, { timeout: 30_000 }).toBe(3);
    expect(await calling(view)).toEqual([]);
    expect(hive("ctl", "send", tiles[asker]!, "ask").status).toBe(0);
    await expect.poll(() => calling(view), { timeout: 30_000 }).toEqual([asker]);
    expect(await call(view, "next")).toEqual({ docked: asker });
    const slot = page.locator(`[data-community-slot="${tiles[asker]}"]`);
    // The terminal draws its text on a canvas; the agent's own state says what it shows.
    await expect(slot.locator(".xterm")).toBeVisible({ timeout: 20_000 });
    await slot.locator(".xterm").click();
    await page.keyboard.press("1");
    await expect.poll(() => calling(view), { timeout: 30_000 }).toEqual([]);
    expect(await call(view, "release")).toEqual({ docked: null });
    await expect(slot).toHaveCount(0);
  });
}
