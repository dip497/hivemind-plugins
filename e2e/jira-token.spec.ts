// The Jira tool connected with a scoped API token instead of Sign in with Atlassian (design §9.0,
// §9.1): the wizard checks the token against the fake Jira's REST API (through Atlassian's gateway
// path, /ex/jira/{cloudId}, with the cloud ID read from the site's tenant_info), keeps it as the
// plugin's secret with the day it expires, and the first sync over REST fills the board.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { PLUGINS, session } from "./app";

const APP = path.resolve(process.env.HIVEMIND_APP ?? path.join(PLUGINS, ".hivemind-app"));
const FIXTURE = path.join(APP, "packages/jira-fake/fixtures/cloud-scrum-company.site.json");
const site = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
const s = session("jira");
const { root, repo, hive } = s;
const shots = process.env.JIRA_SCREENS;
let page: Page;
let fake: ChildProcess;
let jiraSite: { url: string; email: string; token: string };

test.beforeAll(async () => {
  // The fake Jira REST server, in a process of its own (bun runs the fake's TypeScript as it is).
  fake = spawn("bun", ["-e", `
    const { createFakeJira, loadSite } = await import(${JSON.stringify(path.join(APP, "packages/jira-fake/src/index.ts"))});
    const f = await createFakeJira(loadSite("cloud-scrum-company"));
    console.log(JSON.stringify({ url: f.url, email: f.credentials.email, token: f.credentials.scopedToken }));
    setInterval(() => {}, 1 << 30);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  jiraSite = await new Promise((resolve, reject) => {
    fake.stdout!.once("data", (d) => { try { resolve(JSON.parse(String(d))); } catch (e) { reject(e); } });
    fake.once("exit", (c) => reject(new Error(`the fake exited ${c}`)));
  });

  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m first", { cwd: repo });
  expect(hive("init", "--prefix", "HM").status).toBe(0);
  // The plugin as published; its service sends Atlassian's gateway calls to the fake instead.
  const plugin = path.join(root, "jira");
  fs.cpSync(path.join(PLUGINS, "tools/jira"), plugin, { recursive: true, filter: (f) => !f.includes(`${path.sep}src`) });
  fs.renameSync(path.join(plugin, "service.mjs"), path.join(plugin, "jira-service.mjs"));
  fs.writeFileSync(path.join(plugin, "service.mjs"), `process.env.HIVE_JIRA_REST_URL = ${JSON.stringify(jiraSite.url)};\nawait import("./jira-service.mjs");\n`);
  expect(hive("plugins", "install", plugin).status).toBe(0);
  expect(hive("plugins", "enable", "tool:@dip497/jira").status).toBe(0);
  expect(hive("plugins", "workspaces", "@dip497/jira", repo).status).toBe(0);
  page = await s.launch();
});
test.afterAll(async () => {
  await s.close();
  fake?.kill();
  const logs = path.join(root, "config/hivemind-dev/services");
  if (test.info().errors.length || process.env.JIRA_E2E_KEEP) for (const f of fs.existsSync(logs) ? fs.readdirSync(logs) : []) console.log(`── ${f}\n${fs.readFileSync(path.join(logs, f), "utf8").slice(-4000)}`);
  if (!process.env.JIRA_E2E_KEEP) fs.rmSync(root, { recursive: true, force: true });
});

const jira = () => page.locator('[data-tool-plugin="@dip497/jira"]');
const issues = () => page.locator('[data-tool-plugin="@hivemind/issues"]');
const step = () => jira().locator("[data-jira-step]");
const shot = async (el: Locator, name: string) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await el.screenshot({ path: path.join(shots, `${name}.png`) }); } };
/** Bring a tile into view, as clicking it in Layers does. */
const focus = async (el: Locator) => {
  const id = await el.evaluate((n) => n.closest(".react-flow__node")?.getAttribute("data-id"));
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("hivemind:focus-tile", { detail: t })), id);
  await page.waitForTimeout(300);
};

test("a scoped API token: checked, kept with its expiry day, and the first sync over REST fills the board", async () => {
  test.setTimeout(180_000);
  expect(hive("ctl", "open-tool", "@dip497/jira/jira").status).toBe(0);
  await expect(step()).toHaveAttribute("data-jira-step", "connect", { timeout: 30_000 });
  await focus(jira());
  await jira().locator('[data-transport="rest"]').click();
  await jira().locator("[data-rest-site]").fill(jiraSite.url);
  await jira().locator("[data-rest-email]").fill(jiraSite.email);
  await jira().locator("[data-rest-token]").fill(jiraSite.token);
  const expires = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  await jira().locator("[data-rest-expires]").fill(expires);
  await shot(jira(), "t1-connect-token");
  await jira().locator("[data-rest-connect]").click();
  // Checked against Jira, kept: the wizard moves on, connected as the token's person.
  await expect(step()).toHaveAttribute("data-jira-step", "site", { timeout: 20_000 });
  await expect(jira().locator("[data-connected-as]")).toHaveText("Connected as Ujjwal Solanki");
  await jira().locator("[data-next]").click();
  await jira().locator("[data-project-pick]").selectOption("PAY");
  await jira().locator("[data-board-pick]").selectOption("12");
  await expect(jira().locator("[data-discovered]")).toHaveText("9 statuses on PAY board, 5 columns.", { timeout: 15_000 });
  for (const next of ["workflow", "scope", "push"]) {
    await jira().locator("[data-next]").click();
    await expect(step()).toHaveAttribute("data-jira-step", next);
  }
  await jira().locator("[data-finish]").click();
  await expect(jira().locator("[data-first-sync]")).toContainText("First sync: 5 new", { timeout: 20_000 });
  await expect(jira().locator('[data-fact="transport"]')).toContainText("Scoped API token (REST)");
  await shot(jira(), "t2-status-token");
  // The token is the plugin's secret: kept only where secrets are (secrets.json when there is no
  // keyring, as under xvfb), never in settings, a log or any other file of the profile.
  const holding = (fs.readdirSync(path.join(root, "config"), { recursive: true }) as string[])
    .map((f) => path.join(root, "config", f))
    .filter((f) => { try { return fs.lstatSync(f).isFile() && fs.readFileSync(f, "utf8").includes(jiraSite.token); } catch { return false; } })
    .map((f) => path.basename(f));
  expect(holding.filter((f) => f !== "secrets.json")).toEqual([]);

  expect(hive("ctl", "open-tool", "@hivemind/issues/issues").status).toBe(0);
  const inColumn = (name: string) => issues().locator(`[data-column="${name}"]`).getByRole("button", { name: /^Open issue / });
  await expect(inColumn("To Do")).toHaveCount(2, { timeout: 15_000 });
  await expect(inColumn("Done")).toHaveCount(1);
});
