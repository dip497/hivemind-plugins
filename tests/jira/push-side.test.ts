// The side pushes (design §8.1) and the start-work provider (§10), over both transports on the fake
// sites: hive's comments sent once and never pulled back, the PR's remote link added once and
// resolved on merge, the `hivemind` property written and read back by another install's guard,
// and "Assign to me" through the guard. The queue is driven here as the push engine drives it.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { core } from "../app";
import { ME, JANE, closeAll, linked, toolCalls } from "./harness";
import { Workspace } from "../../tools/jira/src/service/workspace";
import { PushQueue } from "../../tools/jira/src/service/engine/push-queue";
import { PushedLedger, rowKind, sideExecutors, sideItems, type Row, type SideIssue } from "../../tools/jira/src/service/engine/push-side";
import type { PushContext, PushExecutor, PushOutcome } from "../../tools/jira/src/service/engine/push-exec";
import type { Link } from "../../tools/jira/src/service/engine/store";

afterEach(closeAll);

const { readIssue, commentOnIssue, updateIssue } = await core("storage.ts");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Model = any;
const KINDS = ["mcp", "rest"] as const;
const tmp = () => realpathSync(mkdtempSync(path.join(os.tmpdir(), "jira-side-")));

/** As the engine runs the queue: each item to its executor until nothing is left (or 5 passes). */
async function drain(queue: PushQueue, executors: PushExecutor[], ctx: PushContext): Promise<[string, PushOutcome][]> {
  const seen: [string, PushOutcome][] = [];
  for (let pass = 0; pass < 5 && queue.all().length; pass++) {
    for (const item of queue.all()) {
      const o = await executors.find((e) => e.kind === item.kind)!.execute(item, ctx);
      seen.push([item.kind, o]);
      if (o.kind === "retry") await queue.put({ ...item, attempts: item.attempts + 1 });
      else await queue.done(item.key);
    }
  }
  return seen;
}

async function rig(kind: (typeof KINDS)[number], o: { push?: string; installId?: string; before?: (f: Model) => void; scope?: unknown } = {}) {
  const l = await linked("cloud-scrum-company", { kind, push: o.push ?? "status+comments", workspace: { installId: o.installId ?? "install-A", hiveVersion: "drive test" }, ...(o.before ? { before: o.before } : {}), ...(o.scope ? { scope: o.scope } : {}) });
  const link = (await l.w.store.link())!;
  const side = l.w.side(link);
  const queue = new PushQueue(path.join(l.w.store.syncDir(link.source), "queue.jsonl"));
  const transport = l.r.account.transport();
  const ctx: PushContext = { transport, issue: (id) => readIssue(l.root, id), writeIssue: async () => {}, now: () => Date.now(), log: () => {} };
  const jiraIssue = (key: string) => l.f.site.issues.find((i: Model) => i.key === key);
  const enqueue = async (id: string) => side.enqueue(queue, await readIssue(l.root, id)) as Promise<{ kind: string }[]>;
  return { ...l, link, side, queue, transport, ctx, jiraIssue, enqueue };
}

for (const kind of KINDS) {
  test(`${kind}: a comment written in hive goes to Jira once; queued again, retried after a lost answer, or pulled back, it is never there twice`, async () => {
    const t = await rig(kind);
    expect(await t.enqueue("PAY-322")).toEqual([]); // comments are sent from now on, not the history
    await commentOnIssue(t.root, "PAY-322", "Looks good, shipping **today**", "ui");
    expect((await t.enqueue("PAY-322")).map((i) => i.kind)).toEqual(["comment"]);
    const before = t.jiraIssue("PAY-322").comments.length;
    const ran = await drain(t.queue, t.side.executors, t.ctx);
    expect(ran.map(([k, o]) => [k, o.kind])).toEqual([["comment", "done"]]);
    const after = await t.transport.comments("PAY-322");
    expect(after.length).toBe(before + 1);
    const sent = after[after.length - 1]!;
    expect([sent.author.accountId, sent.bodyMd.replace(/\s+/g, " ").trim()]).toEqual([ME, "Looks good, shipping **today**"]);
    expect((ran[0]![1] as { activity: string }).activity).toBe(`comment sent to Jira (jira-c-${sent.id})`);
    // Asked again for the same change: nothing to send.
    expect(await t.enqueue("PAY-322")).toEqual([]);

    // A try whose answer was lost (Jira has the comment, nothing here knows its id): found, not sent again.
    const lost = (await sideItems(await readIssue(t.root, "PAY-322"), { source: t.link.source, push: "status+comments", ledger: new PushedLedger(path.join(tmp(), "pushed.json")), now: () => Date.now() - 1000 }));
    // (a fresh ledger only knows from now on: the row is a second old, so it counts)
    expect(lost.map((i) => i.kind)).toEqual(["comment"]);
    const forgetful = sideExecutors({ ledger: new PushedLedger(path.join(tmp(), "pushed.json")), installId: "install-A", hiveVersion: "drive test" });
    expect((await forgetful[0]!.execute({ ...lost[0]!, attempts: 1 }, t.ctx)).kind).toBe("done");
    expect((await t.transport.comments("PAY-322")).length).toBe(before + 1);

    // The next pull reads the issue's comments again (it changed): the row stays one row.
    await t.w.handle("sync-now", {});
    const rows = (await readIssue(t.root, "PAY-322")).sections.activity.filter((a: Row) => a.message.includes("shipping"));
    expect(rows.map((a: Row) => [a.who, a.id ?? null])).toEqual([["ui", null]]);
  }, 60_000);

  test(`${kind}: the PR's remote link is added once, titled with the issue, and resolved on merge where Jira lets it be`, async () => {
    const t = await rig(kind, { push: "status" });
    const pr = { repo: "acme/pay", number: 7, url: "https://github.com/acme/pay/pull/7", state: "open" };
    await updateIssue(t.root, "PAY-322", { pr });
    expect((await t.enqueue("PAY-322")).map((i) => i.kind).sort()).toEqual(["link", "property"]);
    await drain(t.queue, t.side.executors, t.ctx);
    const links = () => t.jiraIssue("PAY-322").remoteLinks.filter((l: Model) => l.object.url === pr.url);
    expect(links().map((l: Model) => [l.object.title, kind === "rest" ? l.globalId : undefined])).toEqual([[`PAY-322: ${t.jiraIssue("PAY-322").summary}`, kind === "rest" ? "github-pr:acme/pay#7" : undefined]]);
    expect(await t.enqueue("PAY-322")).toEqual([]);

    // Sent again with nothing remembered (a crash before the ledger was written): still one link.
    const linkItem = { key: "PAY-322/link/acme/pay#7", kind: "link" as const, issue: "PAY-322", extId: t.jiraIssue("PAY-322").id, pr, due: 0, attempts: 1 };
    const forgetful = sideExecutors({ ledger: new PushedLedger(path.join(tmp(), "pushed.json")), installId: "install-A", hiveVersion: "drive test" });
    expect((await forgetful[1]!.execute(linkItem, t.ctx)).kind).toBe("done");
    expect(links().length).toBe(1);

    await updateIssue(t.root, "PAY-322", { pr: { ...pr, state: "merged" } });
    expect((await t.enqueue("PAY-322")).map((i) => i.kind)).toEqual(["link"]);
    const [[, done]] = await drain(t.queue, t.side.executors, t.ctx) as [[string, { kind: string; activity: string }]];
    expect(links().length).toBe(1);
    if (kind === "rest") {
      expect([links()[0].object.status?.resolved, done.activity]).toEqual([true, "PR acme/pay#7 linked in Jira (resolved)"]);
    } else {
      // No upsert over MCP alone: the link stays as it was added, and the activity says why.
      expect([links()[0].object.status?.resolved ?? false, done.activity]).toEqual([false, "PR acme/pay#7 linked in Jira (Jira still shows it open: an API token can mark it resolved)"]);
    }
    expect(await t.enqueue("PAY-322")).toEqual([]);
  }, 60_000);

  test(`${kind}: the hivemind property says the branch and PR this install works on; another install's guard sees it, this one's doesn't, and it goes with a transition in one write`, async () => {
    const t = await rig(kind, { push: "status" });
    await updateIssue(t.root, "PAY-322", { branch: "feat/pay-322" });
    expect((await t.enqueue("PAY-322")).map((i) => i.kind)).toEqual(["property"]);
    await drain(t.queue, t.side.executors, t.ctx);
    expect(t.jiraIssue("PAY-322").properties.hivemind).toEqual({ hiveVersion: "drive test", branch: "feat/pay-322", pr: null, by: "install-A" });
    expect(await t.enqueue("PAY-322")).toEqual([]);

    const root = t.root;
    expect(await t.w.handle("start-checks", { root, id: "PAY-322" })).toEqual([]);
    const other = new Workspace({ repo: t.repo, account: t.r.account, host: t.host, log: () => {}, poll: false, installId: "install-B" });
    expect(await other.handle("start-checks", { root, id: "PAY-322" })).toEqual([
      { check: "claimed-elsewhere", severity: "warn", message: "another hive install is already working PAY-322 (on branch feat/pay-322)", actions: ["start", "cancel"] },
    ]);

    // The branch gone: the property says so, sent with the issue's next transition.
    await updateIssue(t.root, "PAY-322", { branch: null });
    expect((await t.enqueue("PAY-322")).map((i) => i.kind)).toEqual(["property"]);
    const b = (await t.side.bundled(t.queue, "PAY-322"))!;
    const move = (await t.transport.transitions("PAY-322")).find((x) => x.isAvailable && !x.hasScreen)!;
    const writes = () => (kind === "rest" ? t.f.requests.filter((r: Model) => r.method !== "GET") : toolCalls(t.f).filter((c) => /^(transition|edit)/.test(c.tool))).length;
    const w0 = writes();
    await t.transport.transition("PAY-322", move.id, undefined, b.properties);
    await b.settle();
    expect(writes() - w0).toBe(kind === "rest" ? 1 : 2); // MCP's transition takes no properties
    expect([t.jiraIssue("PAY-322").status, t.jiraIssue("PAY-322").properties.hivemind]).toEqual([move.to.id, { hiveVersion: "drive test", branch: null, pr: null, by: "install-A" }]);
    expect([t.queue.all(), await t.enqueue("PAY-322")]).toEqual([[], []]);
    expect(await other.handle("start-checks", { root, id: "PAY-322" })).toEqual([]);
  }, 60_000);

  test(`${kind}: Assign to me makes the signed-in person the assignee, never anyone named, and the mirror shows it; refused when push is off, or without Assign Issues`, async () => {
    const t = await rig(kind, { push: "status", before: (f) => { f.site.issues.find((i: Model) => i.key === "PAY-322").assignee = JANE; }, scope: { kind: "all" } });
    expect((await readIssue(t.root, "PAY-322")).external.assignee.me).not.toBe(true);
    expect(await t.w.handle("assign-me", { root: t.root, id: "PAY-322", accountId: JANE })).toEqual({ ok: true });
    expect(t.jiraIssue("PAY-322").assignee).toBe(ME);
    expect((await readIssue(t.root, "PAY-322")).external.assignee.me).toBe(true);

    // Jira refusing it (the permission taken away since discovery read it) comes back as FORBIDDEN.
    // Over MCP the assignee goes through editJiraIssue, which the fake doesn't hold to Assign Issues.
    if (kind === "rest") {
      t.f.site.permissions.PAY = t.f.site.permissions.PAY.filter((p: string) => p !== "ASSIGN_ISSUES");
      t.jiraIssue("PAY-323").assignee = JANE;
      await expect(t.w.handle("assign-me", { key: "PAY-323" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(t.jiraIssue("PAY-323").assignee).toBe(JANE);
    }

    const off = await rig(kind, { push: "off" });
    await expect(off.w.handle("assign-me", { key: "PAY-322" })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Send to Jira is off for this workspace: PAY-322 isn't assigned in Jira" });
  }, 60_000);
}

test("mcp with an API token: the guard reads another install's property too (MCP's own read, REST's when MCP has none)", async () => {
  const l = await linked("cloud-scrum-company", { token: "scoped", workspace: { installId: "install-B" } });
  l.f.site.issues.find((i: Model) => i.key === "PAY-322").properties.hivemind = { hiveVersion: "drive test", branch: null, pr: { repo: "acme/pay", number: 7 }, by: "install-A" };
  expect(await l.w.handle("start-checks", { key: "PAY-322" })).toEqual([
    { check: "claimed-elsewhere", severity: "warn", message: "another hive install is already working PAY-322 (with PR acme/pay#7)", actions: ["start", "cancel"] },
  ]);
}, 60_000);

test("rest: without Transition Issues or Assignable User the guard says work stays in hive; and Assign to me is refused before Jira is asked", async () => {
  const t = await rig("rest", { push: "status", before: (f) => { f.site.permissions.PAY = ["BROWSE_PROJECTS", "ASSIGN_ISSUES", "ADD_COMMENTS", "EDIT_ISSUES", "LINK_ISSUES"]; } });
  expect(await t.w.handle("start-checks", { key: "PAY-322" })).toEqual([
    { check: "no-permission", severity: "info", message: "you may not move PAY-322 in Jira or be assigned PAY-322: work on it stays in hive", actions: ["start-local", "cancel"] },
  ]);
  const asked = t.f.requests.length;
  await expect(t.w.handle("assign-me", { key: "PAY-322" })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Jira doesn't let you be assigned issues (no Assignable User permission): PAY-322 stays as it is" });
  expect(t.f.requests.slice(asked).filter((r: Model) => r.method !== "GET")).toEqual([]);
}, 60_000);

test("mcp: the permissions can't be read over MCP alone, so the guard says nothing of them", async () => {
  const t = await rig("mcp", { push: "status", before: (f) => { f.site.permissions.PAY = ["BROWSE_PROJECTS"]; } });
  expect(await t.w.handle("start-checks", { key: "PAY-322" })).toEqual([]);
}, 60_000);

test("which rows are sent: the person's comments, agents' plans and summaries, PR opened/merged/closed; never chatter, field changes, the service's or Jira's own rows; each kind as the settings say", async () => {
  const at = (n: number) => new Date(Date.UTC(2026, 9, 26, 10, n)).toISOString();
  const rows: Row[] = [
    { at: "2026-10-20T08:00:00.000Z", who: "ui", message: "written before comments were sent" },
    { at: at(1), who: "ui", message: "Can we keep the old endpoint for a week?" },
    { at: at(2), who: "p3b", message: "running the tests now" },
    { at: at(3), who: "p3b", message: "## Plan\nretry with jitter, then dead-letter" },
    { at: at(4), who: "p3b", message: "Summary: retries land, tests pass" },
    { at: at(5), who: "p3b", message: "opened PR acme/pay#7: https://github.com/acme/pay/pull/7" },
    { at: at(6), who: "p3b", message: "pushed to the open PR acme/pay#7: https://github.com/acme/pay/pull/7" },
    { at: at(7), who: "hive", message: "PR acme/pay#7 merged" },
    { at: at(8), who: "hive", message: "PR acme/pay#7 merged: remove its worktree and local branch with `hive pr cleanup PAY-322`" },
    { at: at(9), who: "ui", message: "status: To Do → In Progress (todo → in_progress)" },
    { at: at(10), who: "Jane Doe (jira)", message: "from Jira", id: "jira-c-10050" },
    { at: at(11), who: "@dip497/jira (service)", message: "comment sent to Jira (jira-c-1)" },
    { at: at(12), who: "ui", message: "started on feat/pay-322" },
  ];
  expect(rows.map(rowKind)).toEqual(["comment", "comment", "chatter", "summary", "summary", "pr", "chatter", "pr", "system", "system", "jira", "system", "system"]);

  const issue: SideIssue = { id: "PAY-322", title: "Retry", external: { id: "10322", key: "PAY-322", source: "jira:acme/PAY" }, sections: { activity: rows } };
  const sent = async (o: { push: string; kinds?: { comment: boolean; summary: boolean; pr: boolean }; issue?: SideIssue }) =>
    (await sideItems(o.issue ?? issue, { source: "jira:acme/PAY", push: o.push as Link["push"], ...(o.kinds ? { kinds: o.kinds } : {}), ledger: new PushedLedger(path.join(tmp(), "p.json")), now: () => Date.parse(at(0)) + 60_000 }))
      .filter((i) => i.kind === "comment").map((i) => i.row!.message.slice(0, 12));
  expect(await sent({ push: "status+comments" })).toEqual(["Can we keep ", "## Plan\nretr", "Summary: ret", "opened PR ac", "PR acme/pay#"]);
  expect(await sent({ push: "full", kinds: { comment: true, summary: false, pr: false } })).toEqual(["Can we keep "]);
  expect(await sent({ push: "status" })).toEqual([]);
  expect(await sent({ push: "status+comments", issue: { ...issue, external: { ...issue.external!, source: "jira:other/OPS" } } })).toEqual([]);
  expect(await sent({ push: "status+comments", issue: { ...issue, external: { ...issue.external!, archived: { reason: "left scope" } } } })).toEqual([]);
});
