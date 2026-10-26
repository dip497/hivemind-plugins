// The pull (design §6, §7) on the three Cloud fixture sites, end to end: the service's commands,
// over the fake Rovo MCP server, writing through the app's own ingest into a temp workspace. Each
// test holds one guarantee the person relies on: what is pulled for a scope, what the workflow
// looks like, what changes reach the mirror, and what is never lost.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ME, JANE, closeAll, coreHost, linked, listIssues, mirrored, parseWorkflow, toolCalls } from "./harness";
import { Workspace } from "../../tools/jira/src/service/workspace";
import { nextDelayMs } from "../../tools/jira/src/service/engine/cadence";

afterEach(closeAll);

const live = async (root: string) => (await mirrored(root)).filter((i) => !i.archived).map((i) => i.id);
const issue = (f: { site: { issues: { key: string }[] } }, key: string) => f.site.issues.find((i) => i.key === key) as Record<string, unknown> & { key: string };

// ── scopes ──────────────────────────────────────────────────────────────────────────────────────

type Site = { site: { issues: Record<string, unknown>[] } };
const set = (key: string, change: Record<string, unknown>) => (f: Site) => Object.assign(f.site.issues.find((i) => i.key === key)!, change);
const SCOPES: [string, unknown, string | undefined, string[], ((f: Site) => void)?][] = [
  // Scrum: the open sprints (87, 89), then the future sprint (88), then the backlog.
  ["cloud-scrum-company", { kind: "mine" }, undefined, ["PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]],
  ["cloud-scrum-company", { kind: "mine+unassigned" }, undefined, ["PAY-318", "PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]],
  ["cloud-scrum-company", { kind: "all" }, undefined, ["PAY-318", "PAY-321", "PAY-322", "PAY-323", "PAY-324", "PAY-325", "PAY-328", "PAY-329", "PAY-330"]],
  ["cloud-scrum-company", { kind: "mine" }, "open+future", ["PAY-322", "PAY-323", "PAY-324", "PAY-326", "PAY-328", "PAY-330"]],
  ["cloud-scrum-company", { kind: "mine" }, "open+future+backlog", ["PAY-322", "PAY-323", "PAY-324", "PAY-326", "PAY-327", "PAY-328", "PAY-330"]],
  ["cloud-scrum-company", { kind: "jql", jql: `assignee = ${JANE} ORDER BY key` }, undefined, ["PAY-300", "PAY-321", "PAY-325", "PAY-329"]],
  // Kanban: the board's sub-filter, done work fading out.
  ["cloud-kanban-team", { kind: "mine" }, undefined, ["OPS-1", "OPS-2", "OPS-5", "OPS-7"]],
  ["cloud-kanban-team", { kind: "all" }, undefined, ["OPS-1", "OPS-2", "OPS-3", "OPS-5", "OPS-7"]],
  // Done work fades out after 14 days: OPS-4 (done on the 2nd) is gone, OPS-3 (done today) is there.
  ["cloud-kanban-team", { kind: "all" }, undefined, ["OPS-1", "OPS-2", "OPS-3", "OPS-5", "OPS-7"], (f) => {
    set("OPS-4", { resolution: null })(f);
    set("OPS-3", { status: "10103", updated: new Date().toISOString().replace("Z", "+0000") })(f);
  }],
  // No board: the project's open issues.
  ["cloud-jwm-noboard", { kind: "mine" }, undefined, ["MKT-1"]],
  ["cloud-jwm-noboard", { kind: "mine+unassigned" }, undefined, ["MKT-1", "MKT-2"]],
  ["cloud-jwm-noboard", { kind: "all" }, undefined, ["MKT-1", "MKT-2", "MKT-3"]],
  ["cloud-jwm-noboard", { kind: "all" }, undefined, ["MKT-1", "MKT-2"], set("MKT-3", { status: "10303" })],
];

for (const [site, scope, sprints, keys, before] of SCOPES) {
  test(`${site}: scope ${JSON.stringify(scope)}${sprints ? ` with ${sprints} sprints` : ""}${before ? " after a change in Jira" : ""} pulls ${keys.join(" ")}`, async () => {
    const { root, configured } = await linked(site, { scope, ...(sprints ? { sprints } : {}), ...(before ? { before } : {}) });
    expect(await live(root)).toEqual(keys);
    expect([...(configured.firstSync?.created ?? [])].sort()).toEqual([...keys].sort());
  }, 30_000);
}

test("a Kanban board pulls what its own filter finds; a filter not shared with the person falls back to the project, and the tile says so", async () => {
  // Board 13 on PAY shows bugs only. (Its sub-filter names fixVersion, which the fake's JQL lacks: dropped here.)
  const board13 = (shared: boolean) => (f: { site: { boards: Record<string, unknown>[] } }) => {
    delete f.site.boards[1]!.subQuery;
    (f.site.boards[1]!.filter as { shared: boolean }).shared = shared;
  };
  const shared = await linked("cloud-scrum-company", { boardId: 13, scope: { kind: "all" }, before: board13(true) });
  expect(await live(shared.root)).toEqual(["PAY-318", "PAY-329"]);
  expect(((await shared.w.handle("status", {})) as { problems: string[] }).problems.filter((p) => /filter/.test(p))).toEqual([]);

  const unshared = await linked("cloud-scrum-company", { boardId: 13, scope: { kind: "all" }, before: board13(false) });
  expect(await live(unshared.root)).toEqual(["PAY-300", "PAY-318", "PAY-321", "PAY-322", "PAY-323", "PAY-324", "PAY-325", "PAY-326", "PAY-327", "PAY-328", "PAY-329", "PAY-330"]);
  expect(((await unshared.w.handle("status", {})) as { problems: string[] }).problems).toContain("board 13's filter isn't shared with you (or this site can't list filters): PAY's issues are pulled instead of the board's");
}, 30_000);

test("a JQL scope with nothing in it is refused before anything is written", async () => {
  const { w, root } = await linked("cloud-jwm-noboard");
  const before = readFileSync(path.join(root, "sync/jira.json"), "utf8");
  await expect(w.handle("set-scope", { scope: { kind: "jql", jql: " " } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(readFileSync(path.join(root, "sync/jira.json"), "utf8")).toBe(before);
});

// ── discovery → workflow.yaml ───────────────────────────────────────────────────────────────────

const workflowOf = (root: string) => {
  const { workflow, problems } = parseWorkflow(readFileSync(path.join(root, "workflow.yaml"), "utf8"));
  expect(problems).toEqual([]);
  return workflow as { statuses: { id: string; name: string; category: string; source: string; jira?: unknown; retired?: boolean; color?: string }[]; board?: { columns: { name: string; statuses: string[] }[] }; local: Record<string, string> };
};
const categories = (wf: ReturnType<typeof workflowOf>) => Object.fromEntries(wf.statuses.map((s) => [s.name, s.category]));
const byId = (wf: ReturnType<typeof workflowOf>) => Object.fromEntries(wf.statuses.map((s) => [s.id, s.category]));

test("cloud-scrum-company: workflow.yaml has the board's columns, a category per status, and PR Created following Code Review", async () => {
  const { root } = await linked("cloud-scrum-company");
  const wf = workflowOf(root);
  expect(wf.board!.columns).toEqual([
    { name: "To Do", statuses: ["jira:10001"] },
    { name: "In Progress", statuses: ["jira:3", "jira:10002"] },
    { name: "Review", statuses: ["jira:10003", "jira:10004", "hive:pr-created"] },
    { name: "Ready", statuses: ["jira:10005"] },
    { name: "Done", statuses: ["jira:10006", "jira:10007"] },
  ]);
  expect(byId(wf)).toEqual({
    // Backlog (10000) is a `new` status no board column shows: the backlog.
    "jira:10000": "backlog", "jira:10001": "todo", "jira:3": "in_progress", "jira:10002": "in_progress", "jira:10003": "in_review", "jira:10004": "in_review",
    "jira:10005": "in_progress", "hive:pr-created": "in_review", "jira:10006": "done", "jira:10007": "cancelled",
  });
  expect(wf.statuses.find((s) => s.id === "hive:pr-created")).toMatchObject({ source: "hive", jira: { follow: "jira:10003" } });
  expect(wf.local).toMatchObject({ onPrOpened: "hive:pr-created", onPrMerged: "category:done" });
}, 30_000);

test("cloud-kanban-team: the backlog column's statuses are the backlog, a status without a category is todo with a note, and the empty Backlog placeholder of another board is dropped", async () => {
  const { root, w } = await linked("cloud-kanban-team");
  const wf = workflowOf(root);
  expect(wf.board!.columns.map((c) => c.name)).toEqual(["Backlog", "Selected", "In Progress", "Done"]);
  // Backlog (10100), Selected, Triage (no category), Waiting on vendor, Done; hive's Cancelled.
  expect(byId(wf)).toEqual({ "jira:10100": "backlog", "jira:10101": "todo", "jira:3": "in_progress", "jira:10102": "in_progress", "jira:10103": "done", "jira:10104": "todo", "hive:pr-created": "in_review", cancelled: "cancelled" });
  // No review status here: PR Created stays put in Jira and sits in the last open column.
  expect(wf.statuses.find((s) => s.id === "hive:pr-created")?.jira).toBe("stay");
  expect(wf.board!.columns[2]!.statuses).toContain("hive:pr-created");
  expect(((await w.handle("status", {})) as { problems: string[] }).problems.some((p) => /Triage has no status category/.test(p))).toBe(true);

  const scrum = await linked("cloud-scrum-company", { boardId: 13 });
  expect(workflowOf(scrum.root).board!.columns.map((c) => c.name)).toEqual(["Open", "Fixing", "Closed"]);
}, 30_000);

test("cloud-jwm-noboard: no board, Approval is the review status, and hive's own Backlog and Cancelled fill the categories Jira lacks", async () => {
  const { root } = await linked("cloud-jwm-noboard");
  const wf = workflowOf(root);
  expect(wf.board).toBeUndefined();
  expect(wf.statuses.map((s) => [s.id, s.category])).toEqual([
    ["jira:10300", "todo"], ["jira:10301", "in_progress"], ["jira:10302", "in_review"], ["hive:pr-created", "in_review"], ["jira:10303", "done"], ["backlog", "backlog"], ["cancelled", "cancelled"],
  ]);
}, 30_000);

test("discovering again keeps what the person changed, renames what Jira renamed, and retires a status Jira dropped while an issue still has it", async () => {
  let now = Date.now();
  const { f, w, root } = await linked("cloud-scrum-company", { now: () => now });
  const file = path.join(root, "workflow.yaml");
  const wf = YAML.parse(readFileSync(file, "utf8"));
  wf.statuses.find((s: { id: string }) => s.id === "jira:10002").category = "todo"; // Blocked is todo for this team
  wf.statuses.find((s: { id: string }) => s.id === "jira:3").color = "#ff8800";
  wf.statuses.push({ id: "hive:waiting", name: "Waiting on CI", category: "in_progress", source: "hive" });
  wf.local.onPrMerged = "jira:10005";
  writeFileSync(file, YAML.stringify(wf));
  // In Jira: In Progress is renamed, Ready for Release (PAY-330's status) and Blocked are dropped.
  f.site.statuses.find((s: { id: string }) => s.id === "3").name = "Doing";
  for (const wfl of Object.values(f.site.workflows) as { statuses: string[] }[]) wfl.statuses = wfl.statuses.filter((s) => s !== "10005" && s !== "10002");
  for (const b of f.site.boards) for (const c of b.columns) c.statuses = c.statuses.filter((s: string) => s !== "10005" && s !== "10002");
  now += 7 * 3_600_000; // discovery is 6-hourly
  await w.handle("sync-now", {});
  const after = workflowOf(root);
  const byId = Object.fromEntries(after.statuses.map((s) => [s.id, s]));
  expect(byId["jira:3"]).toMatchObject({ name: "Doing", color: "#ff8800" });
  expect(byId["jira:10005"]).toMatchObject({ name: "Ready for Release", retired: true });
  expect(byId["jira:10002"]).toBeUndefined();
  expect(byId["hive:waiting"]).toMatchObject({ name: "Waiting on CI", category: "in_progress", source: "hive" });
  expect(after.local.onPrMerged).toBe("jira:10005");
  expect(after.board!.columns.map((c) => c.name)).toEqual(["To Do", "In Progress", "Review", "Done"]);
}, 30_000);

test("workflow.yaml is edited, not rewritten: the person's comments, a hive status they placed first and their key order survive a re-discovery", async () => {
  let now = Date.now();
  const { f, w, root } = await linked("cloud-jwm-noboard", { now: () => now });
  const file = path.join(root, "workflow.yaml");
  const mine = [
    "# Marketing's statuses — keep Waiting first, the team reads the board left to right.",
    "version: 1",
    "statuses:",
    "  # Ours: an asset is with the designer.",
    "  - id: hive:waiting # set by Priya",
    "    category: in_progress",
    "    name: Waiting on design",
    "    source: hive",
  ].join("\n");
  // The person's version: their lines first, then the rest of the file as the service wrote it.
  const text = readFileSync(file, "utf8").replace(/^(#.*\n)*version: 1\nstatuses:\n/, `${mine}\n`);
  writeFileSync(file, text.replace("  - id: jira:10302\n", "  - id: jira:10302 # sign-off by legal\n"));
  // In Jira: Approval renamed, To Do dropped (no issue has it).
  f.site.statuses.find((s: { id: string }) => s.id === "10302").name = "Legal approval";
  for (const wfl of Object.values(f.site.workflows) as { statuses: string[] }[]) wfl.statuses = wfl.statuses.filter((s) => s !== "10300");
  now += 7 * 3_600_000;
  await w.handle("sync-now", {});
  const after = readFileSync(file, "utf8");
  expect(after.startsWith(`${mine}\n`)).toBe(true);
  expect(after).toContain("  - id: jira:10302 # sign-off by legal\n    name: Legal approval\n");
  expect(after).not.toContain("- id: jira:10300");
  expect(workflowOf(root).statuses.map((s) => s.id)).toEqual(["hive:waiting", "jira:10301", "jira:10302", "hive:pr-created", "jira:10303", "backlog", "cancelled", "todo"]);
}, 30_000);

test("a board Jira deleted leaves workflow.yaml with it: columns become the statuses", async () => {
  let now = Date.now();
  const { f, w, root } = await linked("cloud-kanban-team", { now: () => now });
  expect(workflowOf(root).board).toBeDefined();
  f.site.boards.splice(0);
  now += 7 * 3_600_000;
  await w.handle("sync-now", {});
  expect(workflowOf(root).board).toBeUndefined();
}, 30_000);

test("a category the person set in the Mapping tab survives the next discovery; a status Jira's own category changed for is followed", async () => {
  let now = Date.now();
  const { f, w, root } = await linked("cloud-scrum-company", { now: () => now });
  const m = await w.handle("mapping", {}) as { statuses: { id: string; category: string; jiraCategory?: string }[]; cancelledResolutions: string[] };
  expect(m.statuses.find((s) => s.id === "jira:10005")).toMatchObject({ category: "in_progress", jiraCategory: "indeterminate" });
  // MCP lists no resolutions: the guess comes from done statuses with a cancelled name.
  expect(m.cancelledResolutions).toEqual(["Won't Do"]);
  m.statuses.find((s) => s.id === "jira:10005")!.category = "in_review";
  await w.handle("set-mapping", { workflow: m });
  expect(categories(workflowOf(root))["Ready for Release"]).toBe("in_review");
  f.site.statuses.find((s: { id: string }) => s.id === "10002").statusCategory = { id: 2, key: "new", colorName: "blue-gray", name: "To Do" };
  now += 7 * 3_600_000;
  await w.handle("sync-now", {});
  expect(categories(workflowOf(root))).toMatchObject({ "Ready for Release": "in_review", Blocked: "todo" });
  // Won't Do no longer counted as cancelled.
  await w.handle("set-mapping", { workflow: { ...m, cancelledResolutions: [] } });
  expect(categories(workflowOf(root))["Won't Do"]).toBe("done");
  await expect(w.handle("set-mapping", { workflow: { statuses: [{ id: "x", name: "X", category: "nope" }] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  // A colour set in the tab, then cleared there: gone from the file too.
  const colour = async (c?: string) => {
    const now = await w.handle("mapping", {}) as typeof m;
    const s = now.statuses.find((x) => x.id === "jira:3") as { color?: string };
    if (c) s.color = c; else delete s.color;
    await w.handle("set-mapping", { workflow: now });
    return workflowOf(root).statuses.find((x) => x.id === "jira:3")!.color;
  };
  expect(await colour("#336699")).toBe("#336699");
  expect(await colour()).toBeUndefined();
}, 30_000);

// ── the poll ────────────────────────────────────────────────────────────────────────────────────

test("the poll asks only for what changed since the newest update it pulled, less 2 minutes, in the person's time zone", async () => {
  const { f, w, root } = await linked("cloud-scrum-company");
  const p = issue(f, "PAY-322");
  p.status = "3";
  p.updated = "2026-10-24T09:00:00.000+0000";
  (p.comments as unknown[]).push({ id: "20001", author: JANE, body: { adf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Picked this up" }] }] } }, created: "2026-10-24T08:59:00.000+0000", updated: "2026-10-24T08:59:00.000+0000" });
  const commentsBefore = toolCalls(f, "listJiraIssueComments").length;
  const report = await w.handle("sync-now", {}) as { created: string[]; updated: string[]; unchanged: number };
  // Comments are read for the issues that changed, and only for them.
  expect(toolCalls(f, "listJiraIssueComments").slice(commentsBefore).map((c) => c.args.issueIdOrKey)).toEqual(["PAY-322"]);
  expect(readFileSync(path.join(root, "mirror", "jira-acme-PAY", "PAY-322.md"), "utf8")).toMatch(/Jane Doe \(jira\) · Picked this up <!-- id:jira-c-20001 -->/);
  // The newest pulled was PAY-322 at 07:30 UTC on the 23rd; Asia/Kolkata is UTC+5:30.
  const polls = toolCalls(f, "searchJiraIssuesUsingJql").map((c) => String(c.args.jql));
  expect(polls.at(-1)).toBe(`((project = "PAY" AND sprint in openSprints()) AND assignee = currentUser()) AND updated >= "2026-10-23 12:58" ORDER BY updated ASC`);
  expect([report.created, report.updated, report.unchanged]).toEqual([[], ["PAY-322"], 0]);
  expect((await mirrored(root)).find((i) => i.id === "PAY-322")).toMatchObject({ status: "jira:3", state: "in_progress" });

  // Again: the overlap brings PAY-322 back, and ingest finds nothing to change.
  const commentsAgain = toolCalls(f, "listJiraIssueComments").length;
  const again = await w.handle("sync-now", {}) as { updated: string[]; unchanged: number };
  expect(toolCalls(f, "listJiraIssueComments").length).toBe(commentsAgain);
  expect(toolCalls(f, "searchJiraIssuesUsingJql").map((c) => String(c.args.jql)).at(-1)).toContain(`updated >= "2026-10-24 14:28"`);
  expect([again.updated, again.unchanged]).toEqual([[], 1]);
}, 30_000);

test("an issue in a status Jira just added: the workflow learns it before the issue is written", async () => {
  const { f, w, root } = await linked("cloud-scrum-company");
  f.site.statuses.push({ id: "10099", name: "Staging", statusCategory: { id: 4, key: "indeterminate", colorName: "yellow", name: "In Progress" } });
  (f.site.workflows["PAY Story workflow"] as { statuses: string[] }).statuses.push("10099");
  Object.assign(issue(f, "PAY-322"), { status: "10099", updated: "2026-10-24T09:00:00.000+0000" });
  await w.handle("sync-now", {});
  expect(workflowOf(root).statuses.find((s) => s.id === "jira:10099")).toMatchObject({ name: "Staging", category: "in_progress", source: "jira" });
  expect((await mirrored(root)).find((i) => i.id === "PAY-322")).toMatchObject({ status: "jira:10099", state: "in_progress" });
}, 30_000);

test("a person with no time zone in Jira gets the site's own zone in the poll", async () => {
  let now = Date.now();
  const { f, w } = await linked("cloud-jwm-noboard", { now: () => now });
  delete f.site.users.find((u: { accountId?: string }) => u.accountId === ME).timeZone;
  now += 7 * 3_600_000; // the next discovery reads who the person is again
  await w.handle("sync-now", {});
  const jql = toolCalls(f, "searchJiraIssuesUsingJql").map((c) => String(c.args.jql)).filter((j) => j.endsWith("ORDER BY updated ASC")).at(-1)!;
  // MKT-1, the newest, at 09:00 UTC on the 23rd, less 2 minutes, in the site's zone.
  const zone = f.site.serverInfo.serverTimeZone as string;
  expect(zone).toBe("Europe/Berlin");
  const local = new Intl.DateTimeFormat("sv-SE", { timeZone: zone, dateStyle: "short", timeStyle: "short" }).format(new Date("2026-10-23T08:58:00Z"));
  expect(jql).toContain(`updated >= "${local}"`);
}, 30_000);

test("comments the hourly budget cut off are read on a later pass, though their issues didn't change", async () => {
  let now = Date.parse("2026-10-24T08:00:00.000Z");
  // Discovery takes 12 calls and the poll 1: 15 leaves two of the five comment reads.
  const comment = { id: "20002", author: JANE, body: { adf: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Release notes ready" }] }] } }, created: "2026-10-22T10:00:00.000+0000", updated: "2026-10-22T10:00:00.000+0000" };
  const { f, w, root } = await linked("cloud-scrum-company", { options: { mcpBudget: 15 }, now: () => now, before: (x) => (x.site.issues.find((i: { key: string }) => i.key === "PAY-330").comments.push(comment)) });
  const fetched = () => toolCalls(f, "listJiraIssueComments").map((c) => String(c.args.issueIdOrKey)).sort();
  const file = path.join(root, "mirror", "jira-acme-PAY", "PAY-330.md");
  // The oldest two first (PAY-323, PAY-328); PAY-330's comment waits.
  expect(fetched()).toEqual(["PAY-323", "PAY-328"]);
  expect(readFileSync(file, "utf8")).not.toContain("Release notes ready");
  now += 3_600_001;
  await w.handle("sync-now", {});
  expect(fetched()).toEqual(["PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]);
  expect(readFileSync(file, "utf8")).toContain("Jane Doe (jira) · Release notes ready <!-- id:jira-c-20002 -->");
}, 30_000);

test("ingest is idempotent: a pass with nothing changed in Jira changes no file", async () => {
  const { w, root } = await linked("cloud-kanban-team", { scope: { kind: "all" } });
  const dir = path.join(root, "mirror", "jira-acme-OPS");
  const read = () => Object.fromEntries(readdirSync(dir).map((n) => [n, readFileSync(path.join(dir, n), "utf8")]));
  const before = read();
  const r = await w.handle("sync-now", { reconcile: true }) as { created: string[]; updated: string[]; archived: string[] };
  expect([r.created, r.updated, r.archived]).toEqual([[], [], []]);
  expect(read()).toEqual(before);
}, 30_000);

// ── reconcile ───────────────────────────────────────────────────────────────────────────────────

test("reconcile: an issue that left the scope, was deleted, became restricted or moved is archived with its reason or followed to its new key; one it could not check is checked again, never archived for it", async () => {
  let failChecks = true;
  // Jira failing the lookup of the issues gone from the scope (a 503), once.
  const flaky = (async (input: string | URL | Request, init?: RequestInit) => {
    if (failChecks && typeof init?.body === "string" && init.body.includes("searchJiraIssuesUsingJql") && init.body.includes("id in (")) {
      failChecks = false;
      return new Response("unavailable", { status: 503 });
    }
    return fetch(input, init);
  }) as typeof fetch;
  const { f, w, root } = await linked("cloud-scrum-company", { fetch: flaky });
  issue(f, "PAY-323").assignee = JANE; // left "mine"
  issue(f, "PAY-328").deleted = true;
  issue(f, "PAY-330").restricted = true;
  // Moved within the project; not the newest issue, so the poll's 2-minute overlap doesn't see it.
  const moved = issue(f, "PAY-324");
  (moved.previousKeys as string[]).push("PAY-324");
  moved.key = "PAY-340";

  await w.handle("sync-now", { reconcile: true });
  // The lookup failed: nothing archived for it, and the tile says so.
  expect((await mirrored(root)).filter((i) => i.archived)).toEqual([]);
  expect(((await w.handle("status", {})) as { problems: string[] }).problems.some((p) => /could not be checked this time/.test(p))).toBe(true);

  await w.handle("sync-now", { reconcile: true });
  const all = Object.fromEntries((await mirrored(root)).map((i) => [i.id, i.archived]));
  expect(all).toEqual({ "PAY-322": null, "PAY-323": "left scope", "PAY-328": "no access", "PAY-330": "no access", "PAY-340": null });
  const file = readFileSync(path.join(root, "mirror", "jira-acme-PAY", "PAY-340.md"), "utf8");
  expect(YAML.parse(file.split("---")[1]!).aliases).toEqual(["PAY-324"]);
  const status = await w.handle("status", {}) as { counts: { mirrored: number; archived: number } };
  expect(status.counts).toMatchObject({ mirrored: 2, archived: 3 });
}, 30_000);

test("the empty-scope guard: a scope that suddenly finds nothing archives nothing, and says so", async () => {
  const { w, root } = await linked("cloud-scrum-company");
  // A clause that turned invalid reads as zero results on Cloud (CHANGE-3131).
  await w.handle("set-scope", { scope: { kind: "jql", jql: "labels = no-such-label" } });
  const r = await w.handle("sync-now", { reconcile: true }) as { archived: string[] };
  expect(r.archived).toEqual([]);
  expect(await live(root)).toEqual(["PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]);
  const status = await w.handle("status", {}) as { problems: string[] };
  expect(status.problems.some((p) => p.startsWith("scope returned nothing"))).toBe(true);
}, 30_000);

test("Track keeps an issue from outside the scope; Refresh reads one now; Browse shows live results with what is tracked", async () => {
  const { f, w, root } = await linked("cloud-scrum-company");
  expect(await w.handle("track", { key: "pay-321" })).toEqual({ id: "PAY-321" });
  await w.handle("sync-now", { reconcile: true });
  expect((await mirrored(root)).find((i) => i.id === "PAY-321")?.archived).toBeNull();

  issue(f, "PAY-322").summary = "Expose retry metrics (renamed)";
  expect(await w.handle("refresh", { key: "PAY-322" })).toEqual({ id: "PAY-322" });
  expect((await listIssues(root)).find((i: { id: string }) => i.id === "PAY-322").title).toBe("Expose retry metrics (renamed)");
  await expect(w.handle("refresh", { key: "PAY-999" })).rejects.toMatchObject({ code: "NOT_FOUND" });

  const page = await w.handle("browse", { scope: { kind: "all" } }) as { issues: { key: string; tracked: boolean }[]; total: number };
  expect(page.total).toBe(9);
  expect(page.issues.filter((i) => i.tracked).map((i) => i.key).sort()).toEqual(["PAY-321", "PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]);
  expect(readdirSync(path.join(root, "mirror", "jira-acme-PAY")).length).toBe(6);
}, 30_000);

// ── conflicts ───────────────────────────────────────────────────────────────────────────────────

test("a status moved both in hive and in Jira is a conflict the tile lists by title; Keep Jira takes Jira's", async () => {
  const { f, w, root, host } = await linked("cloud-scrum-company");
  await host.setStatus("PAY-322", "jira:3");
  const p = issue(f, "PAY-322");
  p.status = "10003";
  p.updated = "2026-10-24T09:00:00.000+0000";
  await w.handle("sync-now", {});
  expect(await w.handle("conflicts", {})).toMatchObject([{ id: "PAY-322", title: "Expose retry metrics", local: "jira:3", remote: "jira:10003" }]);
  // Keep hive sends hive's status to Jira: push.test.ts.
  expect(await w.handle("resolve", { id: "PAY-322", keep: "jira" })).toEqual({ ok: true });
  expect((await mirrored(root)).find((i) => i.id === "PAY-322")?.status).toBe("jira:10003");
}, 30_000);

// ── cadence and the request file ────────────────────────────────────────────────────────────────

test("the poll comes every minute while the tile is in use, every five otherwise, later when Atlassian or the budget says so", () => {
  const at = (o: Partial<Parameters<typeof nextDelayMs>[0]>) => nextDelayMs({ active: false, callsPerPass: 2, budget: 400, ...o });
  expect([at({ active: true }), at({})]).toEqual([60_000, 300_000]);
  // 20 calls a pass with 400 an hour: polling may spend 200, so every 6 minutes.
  expect(at({ active: true, callsPerPass: 20 })).toBe(360_000);
  expect(at({ rateLimitedMs: 900_000 })).toBe(900_000);
  expect(at({ failures: 2 })).toBe(1_200_000);
});

test("touching sync/<source>/request syncs now, with the tile closed", async () => {
  const { f, r, repo, root } = await linked("cloud-jwm-noboard");
  const host = coreHost(root);
  const w = new Workspace({ repo, account: r.account, host, log: () => {} });
  await w.start();
  for (let i = 0; i < 200 && host.calls.ingest < 1; i++) await Bun.sleep(25);
  const searches = toolCalls(f, "searchJiraIssuesUsingJql").length;
  await Bun.sleep(100); // the watcher is set up after the first pass is scheduled
  writeFileSync(path.join(root, "sync", "jira-acme-MKT", "request"), "");
  for (let i = 0; i < 200 && toolCalls(f, "searchJiraIssuesUsingJql").length === searches; i++) await Bun.sleep(25);
  w.stop();
  expect(toolCalls(f, "searchJiraIssuesUsingJql").length).toBeGreaterThan(searches);
  expect(readdirSync(path.join(root, "sync", "jira-acme-MKT"))).not.toContain("request");
}, 30_000);
