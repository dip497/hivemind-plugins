// Starting the Hivemind at HIVEMIND_APP with a profile of its own, and its `hive` CLI against it.
import { _electron as electron, expect, type ElectronApplication, type Page } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const APP = path.resolve(process.env.HIVEMIND_APP ?? path.join(import.meta.dirname, "../.hivemind-app"));
const DESKTOP = path.join(APP, "apps/desktop");
const MAIN = path.join(DESKTOP, "out/main/index.js");
if (!fs.existsSync(MAIN)) throw new Error(`No built Hivemind at ${APP}: set HIVEMIND_APP to a checkout and run pnpm exec electron-vite build in its apps/desktop.`);
const ELECTRON = createRequire(path.join(DESKTOP, "package.json"))("electron") as unknown as string;
const CLI = path.join(APP, "apps/cli/src/index.ts");
export const PLUGINS = path.resolve(import.meta.dirname, "..");

export interface Session {
  root: string;
  repo: string;
  env: Record<string, string>;
  hive: (...args: string[]) => { status: number | null; data: any };
  /** The same, without holding the test process while it runs: for a call that waits on the window. */
  hiveLater: (...args: string[]) => Promise<{ status: number | null; data: any }>;
  launch: () => Promise<Page>;
  app: () => ElectronApplication;
  close: () => Promise<void>;
}

/** A fresh profile and repository folder; Claude installed from this repository's manifest. */
export function session(name: string, extraEnv: Record<string, string> = {}): Session {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hm-plugins-${name}-`));
  const xdg = path.join(root, "config");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  fs.cpSync(path.join(PLUGINS, "agents/claude"), path.join(xdg, "hivemind/agents/claude"), { recursive: true });
  const env = { ...process.env, XDG_CONFIG_HOME: xdg, HOME: root, HIVEMIND_SHELL_ENV: "0", ...extraEnv } as Record<string, string>;
  let hcp: Record<string, string> = {};
  let app: ElectronApplication | undefined;
  return {
    root, repo, env,
    hive: (...args) => {
      const r = spawnSync("bun", [CLI, ...args, "--json"], { cwd: repo, env: { ...env, ...hcp }, encoding: "utf8" });
      if (!r.stdout.trim()) throw new Error(r.stderr);
      return { status: r.status, data: JSON.parse(r.stdout) };
    },
    hiveLater: (...args) => new Promise((resolve) => {
      const child = spawn("bun", [CLI, ...args, "--json"], { cwd: repo, env: { ...env, ...hcp } });
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.on("close", (status) => resolve({ status, data: JSON.parse(out || "null") }));
    }),
    launch: async () => {
      app = await electron.launch({ executablePath: ELECTRON, args: [MAIN, "--no-sandbox"], cwd: repo, env });
      const page = await app.firstWindow();
      await page.waitForSelector(".react-flow", { timeout: 30_000 });
      const userData = path.join(xdg, "hivemind-dev");
      await expect.poll(() => fs.existsSync(path.join(userData, "hcp.token"))).toBe(true);
      hcp = { HIVEMIND_APP_DATA: userData };
      return page;
    },
    app: () => app!,
    close: async () => { await app?.close(); },
  };
}
