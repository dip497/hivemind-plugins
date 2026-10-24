// e2e 1 of the Jira sync (design jira-sync §15, §13): the Jira tile in the real app, its service
// switched on for the workspace. The setup wizard signs in with Atlassian against the fake Rovo MCP
// server (cloud-scrum-company) — the authorize page opens in the "system browser", which here is a
// fetch that follows its redirect to the service's loopback listener — then picks the project and
// its Scrum board, reviews the proposed workflow (PR Created following Code Review), keeps the
// default scope (mine) with its preview count, and finishes: the first sync fills the Issues board,
// whose columns are the fixture board's. Then the tabs, Browse's Track, and the board's assignee
// filter and card facts for an issue that is not mine.
//
// The service is the real one, built (`npm run build`: tools/jira/service.mjs), pointed at the fake
// by HIVE_JIRA_MCP_URL, which a two-line wrapper sets: the host hands a service none of its own
// environment. Needs HIVEMIND_APP built with its bundled tools (`pnpm build` in apps/desktop: the
// Issues tool comes from scripts/build-views.mjs, not electron-vite), and bun on PATH for the fake. Screenshots of each step and
// tab go to JIRA_SCREENS when it is set.
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
/** Every page the tile asked the system browser to open. */
let opened: () => Promise<string[]>;

test.beforeAll(async () => {
  // The fake Rovo MCP server, in a process of its own (bun runs the fake's TypeScript as it is).
  fake = spawn("bun", ["-e", `
    const { createFakeRovoMcp, loadSite } = await import(${JSON.stringify(path.join(APP, "packages/jira-fake/src/index.ts"))});
    const f = await createFakeRovoMcp(loadSite("cloud-scrum-company"));
    console.log(JSON.stringify({ url: f.url, origin: f.origin }));
    setInterval(() => {}, 1 << 30);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  const rovo = await new Promise<{ url: string; origin: string }>((resolve, reject) => {
    fake.stdout!.once("data", (d) => { try { resolve(JSON.parse(String(d))); } catch (e) { reject(e); } });
    fake.once("exit", (c) => reject(new Error(`the fake exited ${c}`)));
  });

  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m first", { cwd: repo });
  expect(hive("init", "--prefix", "HM").status).toBe(0);
  // The plugin as published; its service talks to the fake instead of mcp.atlassian.com.
  const plugin = path.join(root, "jira");
  fs.cpSync(path.join(PLUGINS, "tools/jira"), plugin, { recursive: true, filter: (f) => !f.includes(`${path.sep}src`) });
  fs.renameSync(path.join(plugin, "service.mjs"), path.join(plugin, "jira-service.mjs"));
  fs.writeFileSync(path.join(plugin, "service.mjs"), `process.env.HIVE_JIRA_MCP_URL = ${JSON.stringify(`${rovo.url}?tools=all`)};\nawait import("./jira-service.mjs");\n`);
  expect(hive("plugins", "install", plugin).status).toBe(0);
  expect(hive("plugins", "enable", "tool:@dip497/jira").status).toBe(0);
  expect(hive("plugins", "workspaces", "@dip497/jira", repo).status).toBe(0);
  page = await s.launch();
  // The system browser: it opens the page and follows its redirect, as a person approving it would.
  await s.app().evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[] };
    g.opened = [];
    shell.openExternal = async (url: string) => { g.opened.push(url); await fetch(url); };
  });
  opened = () => s.app().evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
});
test.afterAll(async () => {
  await s.close();
  fake?.kill();
  // The service's log, when something went wrong.
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

test("the wizard signs in with Atlassian, picks PAY's Scrum board, reviews the workflow and scope, and its first sync fills the board in the board's columns", async () => {
  test.setTimeout(180_000);
  expect(hive("ctl", "open-tool", "@dip497/jira/jira").status).toBe(0);
  await expect(step()).toHaveAttribute("data-jira-step", "connect", { timeout: 30_000 });
  await focus(jira());
  // 1. Connect: the token is laid out, not yet offered.
  await expect(jira().locator('[data-transport="rest"] input[type="radio"]')).toBeDisabled();
  await shot(jira(), "1-connect");
  await jira().locator("[data-sign-in]").click();
  // 2. The browser opened Atlassian's page; the service finished the sign-in, and the wizard moved on.
  await expect(step()).toHaveAttribute("data-jira-step", "site", { timeout: 20_000 });
  const [authorize] = await opened();
  expect(new URL(authorize!).searchParams.get("code_challenge_method")).toBe("S256");
  expect(new URL(authorize!).searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  await expect(jira().locator("[data-connected-as]")).toHaveText("Connected as Ujjwal Solanki");
  await expect(jira().locator("[data-site]")).toHaveAttribute("data-site", "acme.atlassian.net");
  await shot(jira(), "2-site");
  await jira().locator("[data-next]").click();
  // 3. The project, then its board: PAY has a Scrum board and a Kanban one.
  await jira().locator("[data-project-pick]").selectOption("PAY");
  await jira().locator("[data-board-pick]").selectOption("12");
  await expect(jira().locator("[data-discovered]")).toHaveText("9 statuses on PAY board, 5 columns.", { timeout: 15_000 });
  await shot(jira(), "3-project");
  await jira().locator("[data-next]").click();
  // 4. The proposed workflow: Jira's categories mapped, QA a review status, PR Created following Code Review.
  await expect(step()).toHaveAttribute("data-jira-step", "workflow");
  await expect(jira().locator('[data-category-of="jira:10004"]')).toHaveValue("in_review");
  await expect(jira().locator('[data-category-of="jira:10007"]')).toHaveValue("cancelled");
  await expect(jira().locator('[data-follow-of="hive:pr-created"]')).toHaveValue("jira:10003");
  await shot(jira(), "4-workflow");
  await jira().locator("[data-next]").click();
  // 5. The scope: mine by default, with what it pulls now (mine, in the open sprints, readable).
  await expect(step()).toHaveAttribute("data-jira-step", "scope");
  await expect(jira().locator('[data-scope="mine"] input')).toBeChecked();
  await expect(jira().locator("[data-preview-count]")).toHaveAttribute("data-preview-count", "5", { timeout: 10_000 });
  await shot(jira(), "5-scope");
  await jira().locator("[data-next]").click();
  // 6. Push: status changes by default. Finish runs the first sync.
  await expect(jira().locator('[data-push="status"] input')).toBeChecked();
  await shot(jira(), "6-push");
  await jira().locator("[data-finish]").click();
  await expect(jira().locator("[data-first-sync]")).toContainText("First sync: 5 new", { timeout: 20_000 });
  await expect(jira().locator('[data-fact="connection"]')).toContainText("Connected as Ujjwal Solanki to acme.atlassian.net");
  await expect(jira().locator('[data-fact="counts"]')).toContainText("5 mirrored");
  await shot(jira(), "7-status");

  // The board: the fixture board's columns, in its order, after Backlog (a status no column holds).
  expect(hive("ctl", "open-tool", "@hivemind/issues/issues").status).toBe(0);
  await expect(issues().locator('[data-column="Ready"]')).toBeVisible({ timeout: 15_000 });
  const columns = await issues().locator("[data-column]").evaluateAll((els) => els.map((e) => e.getAttribute("data-column")));
  expect(columns).toEqual(["Backlog", ...site.boards.find((b: { id: number }) => b.id === 12).columns.map((c: { name: string }) => c.name)]);
  const inColumn = (name: string) => issues().locator(`[data-column="${name}"]`).getByRole("button", { name: /^Open issue / });
  await expect(inColumn("To Do")).toHaveCount(2);
  await expect(inColumn("Review")).toHaveCount(1);
  await expect(inColumn("Ready")).toHaveCount(1);
  await expect(inColumn("Done")).toHaveCount(1);
  // A card says what Jira says: type, priority, estimate, and that it is mine.
  const card = issues().getByRole("button", { name: "Open issue PAY-322" });
  await expect(card.locator("[data-tracker-type]")).toHaveText("Story");
  await expect(card.locator("[data-tracker-priority]")).toHaveText("Medium");
  await expect(card.locator("[data-tracker-estimate]")).toHaveText("2");
  await expect(card.locator("[data-tracker-assignee]")).toHaveAttribute("data-tracker-assignee", "me");
  await expect(issues().locator("[data-tracker-filter]")).toHaveAttribute("data-tracker-filter", "me");
  await focus(issues());
  await shot(issues(), "8-board");
});

test("Browse tracks an issue that is not mine: the board's Me filter hides it, Anyone shows it with its owner; the panel sends edits to Jira", async () => {
  test.setTimeout(90_000);
  await focus(jira());
  await jira().locator('[data-jira-tab="browse"]').click();
  await expect(jira().locator('[data-browse-issue="PAY-321"]')).toBeVisible({ timeout: 10_000 });
  await shot(jira(), "9-browse");
  await jira().locator('[data-track="PAY-321"]').click();
  await expect(jira().locator('[data-browse-issue="PAY-321"]')).toContainText("Tracked as PAY-321");

  // On the board's list now (6), but not shown: the filter is at Me.
  await expect(issues().locator("[data-issue-count]")).toHaveText("6", { timeout: 10_000 });
  await expect(issues().getByRole("button", { name: "Open issue PAY-321" })).toHaveCount(0);
  await focus(issues());
  await issues().locator("[data-tracker-filter]").click();
  await page.locator('[data-tracker-option="anyone"]').click();
  const theirs = issues().getByRole("button", { name: "Open issue PAY-321" });
  await expect(theirs).toBeVisible({ timeout: 10_000 });
  await expect(theirs.locator("[data-tracker-assignee]")).toHaveAttribute("data-tracker-assignee", "Jane Doe");
  await shot(issues(), "10-board-anyone");
  await theirs.click();
  await expect(page.locator('[data-tracker-owned="title"]')).toHaveText("Move webhook queue to the new broker");
  await expect(page.locator("[data-edit-in-tracker]")).toHaveAttribute("data-edit-in-tracker", "https://acme.atlassian.net/browse/PAY-321");
  await expect(page.locator("[data-tracker-row]")).toContainText("Jane Doe");
  if (shots) await page.screenshot({ path: path.join(shots, "11-issue-panel.png") });
  await page.keyboard.press("Escape");
});

test("the Mapping, Scope and Conflicts tabs read and write through the service", async () => {
  await focus(jira());
  await jira().locator('[data-jira-tab="mapping"]').click();
  await expect(jira().locator('[data-hive-status="hive:pr-created"]')).toBeVisible({ timeout: 10_000 });
  await jira().locator('[data-category-of="jira:10005"]').selectOption("in_review");
  await shot(jira(), "12-mapping");
  await jira().locator("[data-save-mapping]").click();
  await expect.poll(() => YAML.parse(fs.readFileSync(path.join(repo, ".hivemind/workflow.yaml"), "utf8")).statuses.find((x: { id: string }) => x.id === "jira:10005").category).toBe("in_review");

  await jira().locator('[data-jira-tab="scope"]').click();
  await expect(jira().locator('[data-scope="mine"] input')).toBeChecked({ timeout: 10_000 });
  await jira().locator('[data-scope="mine+unassigned"]').click();
  await expect(jira().locator("[data-preview-count]")).toHaveAttribute("data-preview-count", "6", { timeout: 10_000 });
  await shot(jira(), "13-scope");
  await jira().locator("[data-save-scope]").click();
  await expect(page.getByText("Saved the scope; the next sync uses it")).toBeVisible({ timeout: 5_000 });

  await jira().locator('[data-jira-tab="conflicts"]').click();
  await expect(jira().locator('[data-jira-tab-body="conflicts"]')).toContainText("No conflicts.");
  await shot(jira(), "14-conflicts");
});
