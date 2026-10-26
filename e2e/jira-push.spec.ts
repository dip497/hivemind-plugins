// e2e 2 of the Jira sync (design jira-sync §15, §8.2): a status moved on the Issues board reaches
// Jira as a transition through its screen. The person drags a mirrored card (PAY-330, Ready for
// Release) into the board's Done column and picks Done; Jira's Release transition has a screen with
// a required resolution, so the Jira tile's Status tab asks for it ("Needs your input"). The person
// chooses one and sends it: the fake Jira's issue has the new status and that resolution, and the
// issue's activity in hive says hive→jira.
//
// The fixture's Release is the Release Bot's alone (a condition) and asks for a fix version off its
// screen (a hidden validator); the engine tests hold both refusals (tests/jira/push.test.ts). Here
// the site lets the person release, so the screen is what stands between them and Done.
//
// Like e2e 1 (jira.spec.ts): the real service built (`npm run build`), pointed at the fake Rovo MCP
// server by a two-line wrapper; HIVEMIND_APP built with its bundled tools. The sign-in and the link
// go through the service's own commands (`hive ctl plugin call`), as e2e 1 covers the wizard.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PLUGINS, session } from "./app";

const APP = path.resolve(process.env.HIVEMIND_APP ?? path.join(PLUGINS, ".hivemind-app"));
const s = session("jira-push");
const { root, repo, hive } = s;
const shots = process.env.JIRA_SCREENS;
let page: Page;
let fake: ChildProcess;
/** The fake Jira's REST API behind the Rovo server, and a classic token for reading it. */
let rest: { url: string; auth: string };

test.beforeAll(async () => {
  fake = spawn("bun", ["-e", `
    const { createFakeRovoMcp, loadSite } = await import(${JSON.stringify(path.join(APP, "packages/jira-fake/src/index.ts"))});
    const site = loadSite("cloud-scrum-company");
    const release = site.workflows["PAY Story workflow"].transitions.find((t) => t.id === "71");
    delete release.condition;
    delete release.hiddenRequired;
    site.faults = []; // its scripted rate limits are e2e 1's and the engine tests'
    const f = await createFakeRovoMcp(site);
    const c = f.jira.credentials;
    console.log(JSON.stringify({ url: f.url, rest: f.jira.url, auth: "Basic " + Buffer.from(c.email + ":" + c.classicToken).toString("base64") }));
    setInterval(() => {}, 1 << 30);
  `], { stdio: ["ignore", "pipe", "inherit"] });
  const started = await new Promise<{ url: string; rest: string; auth: string }>((resolve, reject) => {
    fake.stdout!.once("data", (d) => { try { resolve(JSON.parse(String(d))); } catch (e) { reject(e); } });
    fake.once("exit", (c) => reject(new Error(`the fake exited ${c}`)));
  });
  rest = { url: started.rest, auth: started.auth };

  execSync("git init -q -b main && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m first", { cwd: repo });
  expect(hive("init", "--prefix", "HM").status).toBe(0);
  const plugin = path.join(root, "jira");
  fs.cpSync(path.join(PLUGINS, "tools/jira"), plugin, { recursive: true, filter: (f) => !f.includes(`${path.sep}src`) });
  fs.renameSync(path.join(plugin, "service.mjs"), path.join(plugin, "jira-service.mjs"));
  fs.writeFileSync(path.join(plugin, "service.mjs"), `process.env.HIVE_JIRA_MCP_URL = ${JSON.stringify(`${started.url}?tools=all`)};\nawait import("./jira-service.mjs");\n`);
  expect(hive("plugins", "install", plugin).status).toBe(0);
  expect(hive("plugins", "enable", "tool:@dip497/jira").status).toBe(0);
  expect(hive("plugins", "workspaces", "@dip497/jira", repo).status).toBe(0);
  page = await s.launch();

  // Signed in with Atlassian (the fake consents and sends the browser to the service's loopback),
  // then PAY's Scrum board linked, pushing status changes.
  const call = (command: string, args: unknown = {}) => hive("ctl", "plugin", "call", "@dip497/jira", command, JSON.stringify(args));
  // The service starts once the app has the workspace open (until then the call finds none).
  const answers = () => { try { return call("status").status; } catch { return -1; } };
  await expect.poll(answers, { timeout: 30_000 }).toBe(0);
  const { authorizeUrl } = call("sign-in").data.result as { authorizeUrl: string };
  await fetch(authorizeUrl);
  await expect.poll(() => call("status").data.result?.connected, { timeout: 20_000 }).toBe(true);
  const linked = call("configure", { project: "PAY", boardId: 12, scope: { kind: "mine" }, push: "status" });
  expect(linked.status).toBe(0);
  expect(linked.data.result.firstSync.created).toContain("PAY-330");
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
const shot = async (el: Locator | Page, name: string) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await el.screenshot({ path: path.join(shots, `${name}.png`) }); } };
const focus = async (el: Locator) => {
  const id = await el.evaluate((n) => n.closest(".react-flow__node")?.getAttribute("data-id"));
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("hivemind:focus-tile", { detail: t })), id);
  await page.waitForTimeout(300);
};
/** The issue as the fake Jira has it now. */
const inJira = async (key: string) => {
  const r = await fetch(`${rest.url}/rest/api/3/issue/${key}?fields=status,resolution`, { headers: { Authorization: rest.auth, Accept: "application/json" } });
  const i = await r.json() as { fields: { status: { id: string; name: string }; resolution: { name: string } | null } };
  return { status: i.fields.status.name, resolution: i.fields.resolution?.name ?? null };
};

test("a card dragged into Done goes to Jira through Release's screen: the tile asks for the resolution, and Jira gets the status and the one chosen", async () => {
  test.setTimeout(120_000);
  expect(await inJira("PAY-330")).toEqual({ status: "Ready for Release", resolution: null });

  // The board: PAY-330 sits in Ready. Done holds only Done while cancelled issues are hidden.
  expect(hive("ctl", "open-tool", "@hivemind/issues/issues").status).toBe(0);
  const column = (name: string) => issues().locator(`[data-column="${name}"]`);
  const card = issues().getByRole("button", { name: "Open issue PAY-330" });
  await expect(column("Ready").getByRole("button", { name: "Open issue PAY-330" })).toBeVisible({ timeout: 20_000 });
  await focus(issues());
  // Cards drag only while the tile is focused; the drag is the browser's HTML5 events, as the app's
  // own board e2e sends them (a mouse drag through the canvas under xvfb doesn't deliver them).
  await column("Ready").click({ position: { x: 100, y: 10 } });
  await expect(card).toHaveAttribute("draggable", "true");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent("dragstart", { dataTransfer });
  await column("Done").dispatchEvent("dragover", { dataTransfer });
  await column("Done").dispatchEvent("drop", { dataTransfer });
  await card.dispatchEvent("dragend", { dataTransfer });
  await expect(column("Done").getByRole("button", { name: "Open issue PAY-330" })).toBeVisible({ timeout: 10_000 });
  await shot(issues(), "push-1-dropped");

  // 5 s later the service tries Release; its screen needs a resolution: the Jira tile asks.
  expect(hive("ctl", "open-tool", "@dip497/jira/jira").status).toBe(0);
  await focus(jira());
  await jira().locator('[data-jira-tab="status"]').click();
  const waiting = jira().locator('[data-push-waiting="PAY-330"]');
  await expect(waiting).toBeVisible({ timeout: 30_000 });
  await expect(waiting).toContainText("Release asks for Resolution before Jira moves PAY-330 to Done");
  const resolution = waiting.locator('[data-push-field="resolution"]');
  await expect(resolution).toHaveValue("Done"); // named like the status it goes to
  expect(await inJira("PAY-330")).toEqual({ status: "Ready for Release", resolution: null });
  await resolution.selectOption("Won't Do");
  await shot(jira(), "push-2-needs-input");
  await waiting.locator('[data-push-answer="PAY-330"]').click();

  // Jira has it, with the resolution the person chose; hive's activity says what it sent.
  await expect.poll(() => inJira("PAY-330"), { timeout: 15_000 }).toEqual({ status: "Done", resolution: "Won't Do" });
  await expect(waiting).toHaveCount(0, { timeout: 15_000 });
  const shown = hive("show", "PAY-330").data as { status: string; sections: { activity: { who: string; message: string }[] } };
  expect(shown.status).toBe("jira:10006");
  expect(shown.sections.activity.map((a) => a.message)).toContain("hive→jira: moved to Done in Jira (Release)");
  await shot(jira(), "push-3-sent");
});
