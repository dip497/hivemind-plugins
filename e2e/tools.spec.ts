// TODO finder, Git history, CI runs and Worktrees, installed as a person installs them and loaded into
// the real app. CI runs drives a `gh` on PATH that answers from files, so its list, a failed job's
// log and its rerun are checked without the network. Worktrees reads a repository with three
// worktrees and removes the one that loses nothing.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PLUGINS, session } from "./app";

const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hm-plugins-bin-"));
const s = session("tools", { PATH: `${bin}${path.delimiter}${process.env.PATH}` });
const { root, repo, hive } = s;
// A worktree outside the main one's folder keeps its whole path.
const far = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hm-far-")), "far");
const git = (cmd: string, cwd = repo) => execSync(`git -c user.email=t@t -c user.name=t ${cmd}`, { cwd, encoding: "utf8" });
let page: Page;

test.beforeAll(async () => {
  execSync("git init -q -b main", { cwd: repo });
  fs.mkdirSync(path.join(repo, "src"));
  fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1; // TODO: make it fast\n");
  fs.writeFileSync(path.join(repo, "a.ts"), "export const a = 1;\n");
  git("add -A");
  git("commit -q -m 'first change'");
  fs.appendFileSync(path.join(repo, "src", "a.ts"), "export const b = 2; // FIXME: it leaks\n");
  git("commit -q -am 'second change'");
  git(`worktree add -q -b done ${path.join(root, "wt-merged")}`);
  git(`worktree add -q -b feat ${path.join(root, "wt-work")}`);
  git(`worktree add -q -b far ${far}`);
  fs.writeFileSync(path.join(far, "new.txt"), "not committed\n");
  const work = path.join(root, "wt-work");
  fs.appendFileSync(path.join(work, "a.ts"), "export const committed = 2;\n");
  git("commit -q -am 'feat: committed'", work);
  fs.appendFileSync(path.join(work, "a.ts"), "export const uncommitted = 3;\n");

  fs.writeFileSync(path.join(bin, "runs.json"), JSON.stringify([
    { databaseId: 101, displayTitle: "fix: the build", headBranch: "main", status: "completed", conclusion: "failure", workflowName: "CI", createdAt: new Date().toISOString(), event: "push", url: "https://example.test/runs/101" },
    { databaseId: 100, displayTitle: "docs: a typo", headBranch: "main", status: "completed", conclusion: "success", workflowName: "CI", createdAt: new Date().toISOString(), event: "push", url: "https://example.test/runs/100" },
  ]));
  fs.writeFileSync(path.join(bin, "jobs.json"), JSON.stringify({ jobs: [
    { databaseId: 7, name: "lint", status: "completed", conclusion: "success", steps: [{ number: 1, name: "Lint", status: "completed", conclusion: "success" }] },
    { databaseId: 8, name: "typecheck", status: "completed", conclusion: "failure", steps: [{ number: 1, name: "Typecheck", status: "completed", conclusion: "failure" }] },
  ] }));
  const setup = Array.from({ length: 300 }, (_, i) => `typecheck\tUNKNOWN STEP\t2026-10-07T10:00:00.0000000Z setting up ${i}`);
  const cleanup = Array.from({ length: 300 }, (_, i) => `typecheck\tUNKNOWN STEP\t2026-10-07T10:00:02.0000000Z cleaning up ${i}`);
  fs.writeFileSync(path.join(bin, "log.txt"), [
    ...setup,
    "typecheck\tTypecheck\t2026-10-07T10:00:01.0000000Z src/a.ts(1,1): error TS2345: boom",
    "typecheck\tTypecheck\t2026-10-07T10:00:01.0000000Z ##[error]Process completed with exit code 2.",
    ...cleanup, "",
  ].join("\n"));
  fs.writeFileSync(path.join(bin, "gh"), [
    "#!/bin/sh",
    `d='${bin}'`,
    'case "$1 $2" in',
    '  "run list") cat "$d/runs.json" ;;',
    '  "run view") if [ "$3" = "--job" ]; then sleep 1; cat "$d/log.txt"; else cat "$d/jobs.json"; fi ;;',
    '  "run rerun"|"run cancel") echo "$@" >> "$d/calls" ;;',
    '  *) echo "unexpected: $*" >&2; exit 1 ;;',
    "esac",
  ].join("\n"), { mode: 0o755 });

  for (const name of ["todo-finder", "git-history", "ci-runs", "worktrees"]) {
    expect(hive("plugins", "install", path.join(PLUGINS, "tools", name)).status).toBe(0);
    expect(hive("plugins", "enable", `tool:@dip497/${name}`).status).toBe(0);
  }
  page = await s.launch();
});
test.afterAll(async () => {
  await s.close();
  for (const d of [root, bin, path.dirname(far)]) fs.rmSync(d, { recursive: true, force: true });
});

const tile = (id: string) => page.locator(`[data-tool-plugin="@${id}"]`);
/** Bring a tile into view, as clicking it in Layers does. */
const focus = async (el: Locator) => {
  const id = await el.evaluate((n) => n.closest(".react-flow__node")?.getAttribute("data-id"));
  await page.evaluate((t) => window.dispatchEvent(new CustomEvent("hivemind:focus-tile", { detail: t })), id);
  await page.waitForTimeout(400);
};
// The app's diff view draws inside shadow roots: read the text through them, spaces left out, as a
// highlighted line is split into tokens.
const deepText = (el: Locator) => () => el.evaluate((n) => {
  const walk = (x: Element | ShadowRoot): string => [...x.children].map((c) => (c.shadowRoot ? walk(c.shadowRoot) : "") + (c.children.length ? walk(c) : c.textContent ?? "")).join("");
  return walk(n).replace(/\s+/g, "");
});

test("TODO finder lists every note by marker, offers to hand one to an agent, and its markers setting narrows the list live", async () => {
  expect(hive("ctl", "open-tool", "@dip497/todo-finder/todos").status).toBe(0);
  const todos = tile("dip497/todo-finder");
  await expect(todos).toContainText("make it fast", { timeout: 20_000 });
  await expect(todos).toContainText("it leaks");
  await expect(todos.locator('[data-marker="FIXME"]')).toHaveText("FIXME 1");
  await expect(todos.getByRole("button", { name: "Hand to an agent" }).first()).toBeVisible({ timeout: 15_000 });
  expect(hive("plugins", "set", "tool:@dip497/todo-finder", "pattern", "FIXME").status).toBe(0);
  await expect(todos).not.toContainText("make it fast");
  await expect(todos).toContainText("it leaks");
});

test("Git history lists the commits and shows a commit's diff, with a button to ask an agent about it", async () => {
  expect(hive("ctl", "open-tool", "@dip497/git-history/history").status).toBe(0);
  const history = tile("dip497/git-history");
  await expect(history).toContainText("second change", { timeout: 20_000 });
  await history.locator("[data-commit]").first().click();
  await expect(history).toContainText("Ask an agent to explain");
  await expect.poll(deepText(history), { timeout: 15_000 }).toContain("itleaks");
});

test("CI runs lists the runs, shows a failed job's lines, and reruns the failed jobs", async () => {
  expect(hive("ctl", "open-tool", "@dip497/ci-runs/runs").status).toBe(0);
  const ci = tile("dip497/ci-runs");
  await focus(ci);
  await expect(ci).toContainText("fix: the build", { timeout: 20_000 });
  await expect(ci).toContainText("docs: a typo");
  await ci.locator('[data-run="101"]').click();
  // While its log is on its way, a spinner says so in the middle of where it will be.
  const waiting = ci.locator("[data-log-box] [data-loading]");
  await expect(waiting).toHaveText("Loading the log");
  const [spin, box] = await Promise.all([waiting.locator("svg").boundingBox(), ci.locator("[data-log-box]").boundingBox()]);
  expect(Math.abs(spin!.x + spin!.width / 2 - (box!.x + box!.width / 2))).toBeLessThan(2);
  expect(Math.abs(spin!.y + spin!.height / 2 - (box!.y + box!.height / 2))).toBeLessThan(box!.height / 4);
  // The failed job is the one chosen, and its failed lines are shown under its step.
  await expect(ci.locator("[data-log]")).toContainText("error TS2345: boom");
  await expect(ci.locator("[data-log]")).toContainText("── Typecheck");
  // A long log opens at its first error line, marked, not at its top or its cleanup.
  await expect(ci.locator("[data-error]")).toHaveText("Process completed with exit code 2.");
  await expect(ci.locator("[data-error]")).toBeInViewport();
  await expect(ci.locator("[data-log]").getByText("setting up 0", { exact: true })).not.toBeInViewport();
  await expect(ci.locator("[data-log]").getByText("cleaning up 299", { exact: true })).not.toBeInViewport();
  await expect(ci).toContainText("Failed at: Typecheck");
  await expect(ci.getByRole("button", { name: "Ask an agent to fix" })).toBeVisible({ timeout: 15_000 });
  await ci.getByRole("button", { name: "Rerun failed" }).click();
  await expect.poll(() => fs.readFileSync(path.join(bin, "calls"), "utf8").trim()).toBe("run rerun 101 --failed");
  // A job that passed shows its steps, and offers no fix.
  await ci.locator('[data-job="lint"]').click();
  await expect(ci).toContainText("passed · 1 steps");
  await expect(ci.getByRole("button", { name: "Ask an agent to fix" })).toHaveCount(0);
});

test("Worktrees shows each worktree's state, its diffs, and removes only one that loses nothing", async () => {
  expect(hive("ctl", "open-tool", "@dip497/worktrees/worktrees").status).toBe(0);
  const wt = tile("dip497/worktrees");
  await focus(wt);
  const row = (name: string) => wt.locator(`[data-worktree="${name}"]`);
  await expect(row("wt-work")).toContainText("1 uncommitted", { timeout: 20_000 });
  await expect(row("wt-work")).toContainText("↑1");
  await expect(row("wt-work")).not.toContainText("merged");
  await expect(row("wt-merged")).toContainText("merged");
  await expect(row("repo")).toContainText("main worktree");
  await expect(row(far)).toContainText("1 uncommitted");

  await row("wt-work").click();
  await expect.poll(deepText(wt), { timeout: 15_000 }).toContain("uncommitted=3");
  await wt.getByRole("button", { name: /^Branch vs main/ }).click();
  await expect.poll(deepText(wt), { timeout: 15_000 }).toContain("committed=2");
  await expect(wt.getByRole("button", { name: "Remove" })).toHaveCount(0);

  await wt.getByRole("button", { name: /^Merged/ }).click();
  await expect(wt.locator("[data-worktree]")).toHaveCount(1);
  await row("wt-merged").click();
  await wt.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect.poll(() => fs.existsSync(path.join(root, "wt-merged"))).toBe(false);
  await expect.poll(() => git("branch --list done").trim()).toBe("");
  await expect(wt.locator("[data-worktree]")).toHaveCount(0);
  expect(fs.existsSync(path.join(root, "wt-work"))).toBe(true);
});

test("CI runs and Worktrees keep what was chosen, their filter and their tab after the app restarts", async () => {
  let wt = tile("dip497/worktrees");
  let ci = tile("dip497/ci-runs");
  await focus(wt);
  await wt.getByRole("button", { name: /^Uncommitted \d/ }).first().click();
  await wt.locator('[data-worktree="wt-work"]').click();
  await wt.getByRole("button", { name: /^Branch vs main/ }).click();
  await focus(ci);
  await ci.locator('[data-run="100"]').click();
  await ci.locator('[data-run="101"]').click();
  await ci.locator('[data-job="lint"]').click();
  await page.waitForTimeout(600); // what a tile saves is written a moment after its last change
  await s.close();
  page = await s.launch();
  wt = tile("dip497/worktrees");
  ci = tile("dip497/ci-runs");
  await expect(wt.locator('[data-worktree="wt-work"]')).toHaveAttribute("aria-current", "true", { timeout: 20_000 });
  await expect(wt.getByRole("button", { name: /^Uncommitted \d/ }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(wt.getByRole("button", { name: /^Branch vs main/ })).toHaveAttribute("aria-pressed", "true");
  await expect(ci.locator('[data-run="101"]')).toHaveAttribute("aria-current", "true");
  await expect(ci.locator('[data-job="lint"]')).toHaveAttribute("aria-pressed", "true");
});
