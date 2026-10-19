// Not a test: screenshots, a recording, frame rates and a time-lapse of Island over stand-in agents.
// ISLAND_OUT is where they go; ISLAND_AGENTS how many agents (default 20); ISLAND_LIGHT=1 for the
// light appearance; ISLAND_SKY the hour it shows (clock, morning, day, dusk, night); ISLAND_LAPSE
// how many seconds the time-lapse runs (default 240, 0 for none) and ISLAND_LAPSE_ON on which island; ISLAND_ELECTRON_ARGS more switches
// for Electron, such as which GPU path it draws with.
import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { standinAgent } from "./standin";

const APP = path.resolve(process.env.HIVEMIND_APP ?? path.join(import.meta.dirname, "../.hivemind-app"));
const DESKTOP = path.join(APP, "apps/desktop");
const ELECTRON = createRequire(path.join(DESKTOP, "package.json"))("electron") as unknown as string;
const CLI = path.join(APP, "apps/cli/src/index.ts");
const OUT = process.env.ISLAND_OUT ?? "";
const N = Number(process.env.ISLAND_AGENTS ?? 20);
const LIGHT = process.env.ISLAND_LIGHT === "1";
const PLUGINS = path.resolve(import.meta.dirname, "..");
const VIEW = "island";
const STATS = "islandStats";
const SKY = process.env.ISLAND_SKY ?? "clock";
const LAPSE = Number(process.env.ISLAND_LAPSE ?? 240);

/** Its terminal daemon outlives the app: stop it, and the stand-ins with it. */
const stopAll = (root: string) => {
  for (const d of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
    try { if (fs.readFileSync(`/proc/${d}/cmdline`, "utf8").includes(root)) process.kill(Number(d), "SIGKILL"); } catch { /* gone */ }
  }
};
test.skip(!process.env.ISLAND_OUT, "makes media only when ISLAND_OUT names where they go");
let made = "";
test.afterAll(() => { if (made) { stopAll(made); fs.rmSync(made, { recursive: true, force: true }); } });

test(`${VIEW} media`, async () => {
  test.setTimeout(1_200_000);
  fs.mkdirSync(OUT, { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hm-view-media-"));
  made = root;
  const xdg = path.join(root, "config");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, XDG_CONFIG_HOME: xdg, HOME: home, HIVEMIND_SHELL_ENV: "0", STANDIN_AUTO: "1" } as Record<string, string>;
  Object.assign(env, standinAgent(xdg, root));
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd });
  const projects = ["payments-api", "web-app", "docs", "infra", "mobile", "search"].slice(0, N >= 60 ? 6 : 5);
  for (const p of projects) {
    const dir = path.join(root, p);
    fs.mkdirSync(dir);
    git(dir, "init", "-q", "-b", "main");
    fs.writeFileSync(path.join(dir, "README.md"), p);
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "init");
  }
  git(path.join(root, "payments-api"), "worktree", "add", "-q", "-b", "fix-refunds", path.join(root, "payments-api-fix-refunds"));
  git(path.join(root, "web-app"), "worktree", "add", "-q", "-b", "new-checkout", path.join(root, "web-app-new-checkout"));
  let hcp: Record<string, string> = {};
  const hive = (...args: string[]) => {
    const r = spawnSync("bun", [CLI, ...args, "--json"], { cwd: path.join(root, projects[0]!), env: { ...env, ...hcp }, encoding: "utf8" });
    try { return { status: r.status, data: JSON.parse(r.stdout) }; } catch { return { status: r.status, data: r.stderr || r.stdout }; }
  };
  expect(hive("views", "install", path.join(PLUGINS, `views/${VIEW}/dist`)).status).toBe(0);
  const app = await electron.launch({
    executablePath: ELECTRON, args: [path.join(DESKTOP, "out/main/index.js"), "--no-sandbox", ...(process.env.ISLAND_ELECTRON_ARGS ?? "").split(" ").filter(Boolean)], cwd: path.join(root, projects[0]!), env,
    recordVideo: { dir: path.join(root, "video"), size: { width: 1600, height: 1000 } },
  });
  const page = await app.firstWindow();
  const consoleFile = path.join(OUT, `console-${N}.log`);
  fs.writeFileSync(consoleFile, "");
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") fs.appendFileSync(consoleFile, `${m.type()}: ${m.text()}\n`); });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForSelector(".react-flow", { timeout: 60_000 });
  const userData = path.join(xdg, "hivemind-dev");
  await expect.poll(() => fs.existsSync(path.join(userData, "hcp.token")), { timeout: 30_000 }).toBe(true);
  hcp = { HIVEMIND_APP_DATA: userData };
  await page.evaluate(() => window.hive.settingsSet("appearance.glass.animate", false));
  if (LIGHT) await page.evaluate(() => window.hive.settingsSet("appearance.mode", "light"));
  await page.evaluate((sky) => window.hive.settingsSet("plugins.state", { "view:@dip497/island": { options: { sky } } }), SKY);
  for (const p of projects.slice(1)) hive("ctl", "frame", "add", "--folder", path.join(root, p));
  for (const w of ["payments-api-fix-refunds", "web-app-new-checkout"]) hive("ctl", "frame", "add", "--folder", path.join(root, w));
  const frames = hive("ctl", "frames").data as { id: string; name: string }[];
  const NAMES = ["refunds", "ledger", "auth", "checkout", "search", "docs", "deploy", "billing", "tests", "lint", "router", "cache", "queue", "emails", "charts", "i18n", "perf", "a11y", "migrate", "api"];
  const tiles: string[] = [];
  for (let i = 0; i < N; i++) {
    const f = frames[i % frames.length]!;
    const name = `${NAMES[i % NAMES.length]}${i >= NAMES.length ? `-${Math.floor(i / NAMES.length) + 1}` : ""}`;
    let r = hive("ctl", "spawn", "--agent", "standin", "--frame", f.id, "--name", name);
    // The app limits how fast agents start; wait and ask again.
    for (let k = 0; k < 90 && JSON.stringify(r.data).includes("RATE_LIMITED"); k++) {
      await page.waitForTimeout(1000);
      r = hive("ctl", "spawn", "--agent", "standin", "--frame", f.id, "--name", name);
    }
    const tile = (r.data as { tile?: string })?.tile;
    if (tile) tiles.push(tile);
    else fs.appendFileSync(path.join(OUT, `spawn-failures-${VIEW}-${N}.log`), `${f.name}: ${JSON.stringify(r.data)}\n`);
  }
  for (const [a, b] of [[0, 5], [1, 6], [2, 3]]) if (tiles[a] && tiles[b]) hive("ctl", "connect", tiles[a]!, tiles[b]!);
  // On a busy machine the first ask can time out; ask again.
  let opened = hive("ctl", "plugin", "open", `view:@dip497/${VIEW}`);
  for (let k = 0; k < 5 && opened.status !== 0; k++) { await page.waitForTimeout(3000); opened = hive("ctl", "plugin", "open", `view:@dip497/${VIEW}`); }
  expect(opened.status).toBe(0);
  const view = async () => {
    for (let k = 0; k < 60; k++) {
      const f = page.frames().find((x) => x.url().includes("dip497") && x.url().includes(VIEW));
      if (f) return f;
      await page.waitForTimeout(500);
    }
    throw new Error(`no view frame among ${page.frames().map((f) => f.url()).join(", ")}`);
  };
  const v = await view();
  await v.evaluate(() => { const g = globalThis as unknown as { viewErrors: string[] }; g.viewErrors = []; addEventListener("error", (e) => g.viewErrors.push(String(e.error?.stack ?? e.message))); addEventListener("unhandledrejection", (e) => g.viewErrors.push(String(e.reason?.stack ?? e.reason))); });
  await v.waitForFunction((k) => ((globalThis as unknown as Record<string, { agents: number } | undefined>)[k]?.agents ?? 0) > 0, STATS, { timeout: 60_000 });
  const tag = `${VIEW}-${N}${LIGHT ? "-light" : ""}-${SKY}`;

  await page.waitForTimeout(25_000);
  await page.screenshot({ timeout: 120_000, path: path.join(OUT, `${tag}-overview.png`) });
  fs.writeFileSync(path.join(OUT, `${tag}-labels.json`), JSON.stringify(await v.evaluate(() => [...document.querySelectorAll<HTMLElement>(".label")].map((e) => [e.textContent, e.style.display, e.style.transform]))));
  const rates: unknown[] = [];
  for (let k = 0; k < 6; k++) { await page.waitForTimeout(2000); rates.push(await v.evaluate((key) => ({ ...(globalThis as unknown as Record<string, object>)[key] }), STATS)); }
  fs.writeFileSync(path.join(OUT, `${tag}-fps.json`), JSON.stringify(rates, null, 1));
  // Go to the agent calling longest, its terminal open beside the view.
  const next = hive("ctl", "plugin", "call", `@dip497/${VIEW}`, "next");
  fs.writeFileSync(path.join(OUT, `${tag}-next.json`), JSON.stringify(next.data));
  await page.waitForTimeout(3500);
  await page.screenshot({ timeout: 120_000, path: path.join(OUT, `${tag}-calling-docked.png`) });
  hive("ctl", "plugin", "call", `@dip497/${VIEW}`, "release");
  await page.waitForTimeout(1500);
  const census = hive("ctl", "plugin", "call", `@dip497/${VIEW}`, "census");
  fs.writeFileSync(path.join(OUT, `${tag}-census.json`), JSON.stringify(census.data));
  if (VIEW === "island") {
    // Close up: a click in the middle of the view picks what is there and flies to it.
    const box = await page.locator("iframe").first().boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
      await page.waitForTimeout(3000);
      await page.screenshot({ timeout: 120_000, path: path.join(OUT, `${tag}-close.png`) });
    }
    await v.evaluate(() => document.querySelector<HTMLButtonElement>(".overview")?.click());
    await page.waitForTimeout(4000);
  }
  // A time-lapse of one island's town going up as its agents finish turns.
  if (LAPSE > 0) {
    const dir = path.join(OUT, `${tag}-timelapse`);
    fs.mkdirSync(dir, { recursive: true });
    const lapse: unknown[] = [];
    lapse.push(hive("ctl", "plugin", "call", `@dip497/${VIEW}`, "island", JSON.stringify({ name: process.env.ISLAND_LAPSE_ON ?? "docs" })).data);
    await page.waitForTimeout(4000);
    const shots = Math.max(2, Math.round(LAPSE / 10));
    for (let k = 0; k < shots; k++) {
      await page.screenshot({ timeout: 120_000, path: path.join(dir, `${String(k).padStart(3, "0")}.png`) });
      lapse.push(await v.evaluate((key) => { const s = (globalThis as unknown as Record<string, { lots: number[]; turns: number }>)[key]!; return { lots: s.lots, turns: s.turns }; }, STATS));
      await page.waitForTimeout(10_000);
    }
    fs.writeFileSync(path.join(OUT, `${tag}-timelapse.json`), JSON.stringify(lapse, null, 1));
  }
  for (const e of await v.evaluate(() => (globalThis as unknown as { viewErrors: string[] }).viewErrors).catch(() => [] as string[])) fs.appendFileSync(consoleFile, `view error: ${e}\n`);
  await page.close();
  const video = page.video();
  await app.close();
  if (video) fs.copyFileSync(await video.path(), path.join(OUT, `${tag}.webm`));
});
