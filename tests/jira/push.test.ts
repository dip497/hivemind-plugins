// The push (design §8.2, §8.3) on cloud-scrum-company, over both transports: the Rovo MCP transport
// on the fake Rovo server and the REST transport on the fake Jira, each held to what the fake site's
// model ends up with. A status moved in hive (as the board, `hive update` or an agent would) reaches
// the engine as `issue.changed`, waits its 5 s, and becomes Jira transitions: direct, several, through
// a screen the person fills, or refused in Jira's words and put back. Then the conflict rule.
import { afterEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { SERVICE, closeAll, linked, readIssue, toolCalls, updateIssue } from "./harness";
import { RestLimits } from "../../tools/jira/src/service/rest/limits";
import { DEBOUNCE_MS, KEEP_JIRA_AFTER_MS } from "../../tools/jira/src/service/engine/push";
import { PushQueue } from "../../tools/jira/src/service/engine/push-queue";
import { Workspace } from "../../tools/jira/src/service/workspace";
import type { PushExecutor } from "../../tools/jira/src/service/engine/push-exec";

afterEach(closeAll);

type Kind = "mcp" | "rest";
const KINDS: Kind[] = ["mcp", "rest"];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

// cloud-scrum-company's statuses (design §4.2 ids) and its PAY Story workflow.
const TODO = "jira:10001", PROGRESS = "jira:3", BLOCKED = "jira:10002", REVIEW = "jira:10003", READY = "jira:10005", DONE = "jira:10006";
const PR_CREATED = "hive:pr-created";
const STORY = "PAY Story workflow";

async function rig(kind: Kind, o: { before?: (f: Any) => void; push?: string; autoPath?: boolean } = {}) {
  const clock = { t: Date.now() };
  const L = await linked("cloud-scrum-company", {
    kind, scope: { kind: "all" }, clock: () => clock.t,
    ...(o.before ? { before: o.before } : {}), ...(o.push ? { push: o.push } : {}),
    ...(o.autoPath === false ? { options: { autoPath: false } } : {}),
    // REST's own waits (a per-issue Retry-After) on the test's clock, never the wall's.
    ...(kind === "rest" ? { limits: new RestLimits({ now: () => clock.t, sleep: async (ms) => { clock.t += ms; } }) } : {}),
  });
  // What the service writes itself comes back as `issue.changed`, as the host's watch tells it.
  L.host.told = (c) => void L.w.issueChanged(c);
  const link = (await L.w.store.link())!;
  const engine = L.w.pushFor(link);
  const site = L.f.site;
  const model = (key: string) => site.issues.find((i: Any) => i.key === key);
  /** Move an issue in hive, signed by `who`, and tell the service. */
  const move = async (id: string, status: string, who = "kraken") => {
    await updateIssue(L.root, id, { status }, who);
    await L.w.issueChanged({ id, fields: ["status", "state"] });
  };
  /** Let `ms` pass and run what is due. */
  const after = async (ms = DEBOUNCE_MS) => { clock.t += ms; return engine.runDue(); };
  const local = (id: string): Promise<Any> => readIssue(L.root, id);
  const pushed = async (id: string) => (await local(id)).sections.activity.filter((a: Any) => a.who === SERVICE).map((a: Any) => a.message as string);
  /** Jira's status changes of an issue: each transition taken. */
  const moves = (key: string) => model(key).changelog.filter((c: Any) => c.items.some((x: Any) => x.fieldId === "status")).length;
  const asked = (key: string) => kind === "mcp"
    ? toolCalls(L.f, "listJiraIssueTransitions").filter((c) => c.args.issueIdOrKey === key).length
    : L.f.requests.filter((r: Any) => r.method === "GET" && r.path === `/rest/api/3/issue/${key}/transitions`).length;
  const fault = (key: string, status: number, body: unknown, headers: Record<string, string> = {}) =>
    site.faults.push({ name: `${status} on ${key}`, match: { method: "POST", path: `/rest/api/3/issue/${key}/transitions`, nth: 1, times: 1 }, status, headers, body });
  const story = () => site.workflows[STORY];
  const pending = () => engine.queue.all();
  return { ...L, clock, engine, site, model, move, after, local, pushed, moves, asked, fault, story, pending, kind };
}

/** Release (Ready for Release → Done) without its Release-Bot condition, keeping its screen. */
const releasable = (hidden = false) => (f: Any) => {
  const t = f.site.workflows[STORY].transitions.find((x: Any) => x.id === "71");
  t.condition = undefined;
  if (!hidden) t.hiddenRequired = undefined;
};

/** The PAY Story workflow's edges written into workflow.yaml, as earlier pushes would have learned them. */
function learnedAll(root: string, f: Any): void {
  const file = path.join(root, "workflow.yaml");
  const wf = YAML.parse(readFileSync(file, "utf8"));
  wf.issueTypes["jira:10001"].transitions = f.site.workflows[STORY].transitions.map((t: Any) => ({
    id: t.id, name: t.name, from: t.from === "*" ? "*" : t.from.map((x: string) => `jira:${x}`), to: `jira:${t.to}`, screen: !!t.hasScreen,
  }));
  writeFileSync(file, YAML.stringify(wf));
}

for (const kind of KINDS) {
  // ── §8.2 ──────────────────────────────────────────────────────────────────────────────────────

  test(`${kind}: a status moved in hive waits 5 s, then Jira takes the direct transition and the activity says hive→jira`, async () => {
    const r = await rig(kind);
    await r.move("PAY-322", PROGRESS);
    expect(await r.after(DEBOUNCE_MS - 1)).toBe(0); // still settling
    expect(r.model("PAY-322").status).toBe("10001");
    expect(await r.after(1)).toBe(1);
    expect(r.model("PAY-322").status).toBe("3");
    expect(await r.pushed("PAY-322")).toEqual(["hive→jira: moved to In Progress in Jira (Start)"]);
    expect(r.pending()).toEqual([]);
  }, 30_000);

  test(`${kind}: moves within the 5 s merge; the last target wins, and a move back to Jira's status sends nothing`, async () => {
    const r = await rig(kind);
    await r.move("PAY-322", PROGRESS);
    await r.after(2_000);
    await r.move("PAY-322", "jira:10007"); // Won't Do (a screen): replaced before it ran
    await r.move("PAY-322", BLOCKED);
    expect(r.pending().map((i) => i.status)).toEqual([BLOCKED]);
    await r.move("PAY-322", TODO); // back where Jira is
    expect(r.pending()).toEqual([]);
    expect(await r.after(60_000)).toBe(0);
    expect(r.moves("PAY-322")).toBe(0);
  }, 30_000);

  test(`${kind}: no direct transition: the shortest way over the learned graph, each step checked live, the learned edges kept in workflow.yaml`, async () => {
    const r = await rig(kind);
    // An earlier push from In Progress taught hive what Jira offers there (Block, Request review).
    await r.move("PAY-321", BLOCKED);
    await r.after();
    expect(r.model("PAY-321").status).toBe("10002");
    await r.move("PAY-322", REVIEW);
    await r.after();
    expect(r.model("PAY-322").status).toBe("10003");
    expect(await r.pushed("PAY-322")).toEqual(["hive→jira: moved to Code Review in Jira (Start → Request review)"]);
    expect(r.asked("PAY-322")).toBe(2); // once before each step
    const learned = YAML.parse(readFileSync(path.join(r.root, "workflow.yaml"), "utf8")).issueTypes["jira:10001"].transitions;
    expect(learned.map((t: Any) => `${t.id}:${JSON.stringify(t.from)}->${t.to}`)).toEqual(expect.arrayContaining([
      `21:["${TODO}"]->${PROGRESS}`, `41:["${PROGRESS}"]->${REVIEW}`, `31:["${PROGRESS}"]->${BLOCKED}`, `81:"*"->jira:10007`,
    ]));
  }, 30_000);

  test(`${kind}: with auto-path off, a way of several transitions waits for the person's OK`, async () => {
    const r = await rig(kind, { autoPath: false });
    learnedAll(r.root, r.f);
    await r.move("PAY-322", REVIEW);
    await r.after();
    expect(r.moves("PAY-322")).toBe(0);
    const [item] = r.pending();
    expect(item!.waiting?.form?.path?.map((s) => s.name)).toEqual(["Start", "Request review"]);
    const { pushes } = await r.w.handle("pushes", {}) as Any;
    expect(pushes.map((p: Any) => [p.issue, !!p.waiting])).toEqual([["PAY-322", true]]);
    expect(await r.w.handle("answer", { key: item!.key })).toEqual({ outcome: "done" });
    expect(r.model("PAY-322").status).toBe("10003");
  }, 30_000);

  test(`${kind}: a screen with a required resolution waits with its form; the person's answer is sent and pre-fills the next one`, async () => {
    const r = await rig(kind, { before: releasable() });
    await r.move("PAY-330", DONE);
    await r.after();
    expect(r.moves("PAY-330")).toBe(0);
    const [item] = r.pending();
    expect(item!.waiting!.message).toBe("Release asks for Resolution before Jira moves PAY-330 to Done");
    expect(item!.waiting!.form).toEqual({
      transition: { id: "71", name: "Release", to: DONE },
      fields: [{ id: "resolution", name: "Resolution", required: true, kind: "choice", choices: [{ id: "10000", name: "Done" }, { id: "10001", name: "Won't Do" }], value: "Done" }],
    });
    // Waiting isn't retried: time passing changes nothing.
    expect(await r.after(3_600_000)).toBe(0);
    expect(await r.w.handle("answer", { key: item!.key, values: { resolution: "Won't Do" } })).toEqual({ outcome: "done" });
    expect([r.model("PAY-330").status, r.model("PAY-330").resolution]).toEqual(["10006", "Won't Do"]);
    expect(await r.pushed("PAY-330")).toEqual(["hive→jira: moved to Done in Jira (Release)"]);
    // Reopened in Jira and released again from hive: the form starts from the last answer.
    r.model("PAY-330").status = "10005";
    await r.w.handle("sync-now", {});
    await r.move("PAY-330", DONE);
    await r.after();
    expect(r.pending()[0]!.waiting!.form!.fields[0]!.value).toBe("Won't Do");
  }, 30_000);

  test(`${kind}: a field Jira requires off the screen is refused in Jira's words, put back, and refused up front the next time`, async () => {
    const r = await rig(kind, { before: releasable(true) });
    await r.move("PAY-330", DONE);
    await r.after();
    const out = await r.w.handle("answer", { key: r.pending()[0]!.key, values: { resolution: "Done" } }) as Any;
    expect(out.outcome).toBe("refused");
    expect(out.message).toContain("Fix Version/s is required.");
    expect((await r.local("PAY-330")).status).toBe(READY);
    expect((await r.pushed("PAY-330")).at(-1)).toMatch(/^hive→jira refused: Jira refused Release: .*Fix Version\/s is required\.; put back to Ready for Release$/);
    const status = await r.w.handle("status", {}) as Any;
    expect(status.refused).toEqual([expect.objectContaining({ id: "PAY-330", url: expect.stringContaining("/browse/PAY-330") })]);
    // Remembered: the next move through Release is refused before anything is sent.
    const posts = r.model("PAY-330").changelog.length;
    await r.move("PAY-330", DONE);
    await r.after();
    expect(r.pending()).toEqual([]);
    expect((await r.pushed("PAY-330")).at(-1)).toContain("Jira requires what Release's screen doesn't ask");
    expect(r.model("PAY-330").changelog.length).toBe(posts);
    expect((await r.local("PAY-330")).status).toBe(READY);
  }, 30_000);

  test(`${kind}: a condition Jira enforces: no way it offers is refused and put back; a POST it refuses (400) too, in its words`, async () => {
    const r = await rig(kind);
    // Release is the Release Bot's alone: Jira offers no way to Done from Ready for Release.
    await r.move("PAY-330", DONE);
    await r.after();
    expect((await r.local("PAY-330")).status).toBe(READY);
    expect((await r.pushed("PAY-330")).at(-1)).toBe("hive→jira refused: Jira has no way from Ready for Release to Done for PAY-330 within 3 transitions; put back to Ready for Release");
    // Jira says no to the POST itself.
    r.fault("PAY-322", 400, { errorMessages: ["It seems that you have tried to perform a workflow operation (Start) that is not valid for the current state of this issue (PAY-322)."], errors: {} });
    await r.move("PAY-322", PROGRESS);
    await r.after();
    expect(r.model("PAY-322").status).toBe("10001");
    expect((await r.local("PAY-322")).status).toBe(TODO);
    expect((await r.pushed("PAY-322")).at(-1)).toContain("Jira refused Start: It seems that you have tried to perform a workflow operation (Start)");
    expect(r.pending()).toEqual([]);
  }, 30_000);

  test(`${kind}: a 409 is retried after a backoff; a 422 is refused as a misconfigured workflow, not retried`, async () => {
    const r = await rig(kind);
    r.fault("PAY-322", 409, { errorMessages: ["The issue was updated by someone else."], errors: {} });
    await r.move("PAY-322", PROGRESS);
    await r.after();
    expect(r.model("PAY-322").status).toBe("10001");
    expect(r.pending().map((i) => [i.attempts, i.due - r.clock.t])).toEqual([[1, 5_000]]);
    expect(await r.after(4_999)).toBe(0);
    expect(await r.after(1)).toBe(1);
    expect(r.model("PAY-322").status).toBe("3");

    r.fault("PAY-325", 422, { errorMessages: ["The workflow's post function failed."], errors: {} });
    await r.move("PAY-325", BLOCKED);
    await r.after();
    expect(r.pending()).toEqual([]);
    expect((await r.local("PAY-325")).status).toBe(PROGRESS);
    expect((await r.pushed("PAY-325")).at(-1)).toMatch(/^hive→jira refused: Jira's workflow is misconfigured for Block \(422\): .*post function failed.*; put back to In Progress$/);
  }, 30_000);

  test(`${kind}: Jira's per-issue write limit (429) holds the push until its Retry-After`, async () => {
    const r = await rig(kind);
    r.fault("PAY-322", 429, { errorMessages: ["Rate limit exceeded."], errors: {} }, { "Retry-After": "30", "RateLimit-Reason": "jira-per-issue-on-write" });
    await r.move("PAY-322", PROGRESS);
    await r.after();
    const [item] = r.pending();
    expect(item!.due - r.clock.t).toBeGreaterThanOrEqual(30_000);
    expect(r.model("PAY-322").status).toBe("10001");
    await r.after(item!.due - r.clock.t);
    expect(r.model("PAY-322").status).toBe("3");
  }, 30_000);

  test(`${kind}: the queue survives the service stopping: a new service runs what the old one left`, async () => {
    const r = await rig(kind);
    await r.move("PAY-322", PROGRESS);
    r.w.stop();
    const again = new Workspace({ repo: r.repo, account: r.r.account, host: r.host, log: () => {}, poll: false, now: () => r.clock.t });
    const engine = again.pushFor((await again.store.link())!);
    r.clock.t += DEBOUNCE_MS;
    expect(await engine.runDue()).toBe(1);
    expect(r.model("PAY-322").status).toBe("3");
    // And what it did is on disk: a third one finds nothing to do.
    const third = new PushQueue(engine.queue.file);
    await third.load();
    expect(third.all()).toEqual([]);
  }, 30_000);

  test(`${kind}: the pull's own writes don't echo back to Jira`, async () => {
    const r = await rig(kind);
    r.model("PAY-322").status = "3";
    r.model("PAY-322").updated = new Date().toISOString().replace("Z", "+0000");
    const report = await r.w.handle("sync-now", {}) as Any;
    expect(report.updated).toContain("PAY-322");
    // The host's watch tells the pull's write, as it tells any.
    await r.w.issueChanged({ id: "PAY-322", fields: ["status", "state"] });
    expect(r.pending()).toEqual([]);
    expect(await r.after(60_000)).toBe(0);
    expect(r.moves("PAY-322")).toBe(0);
  }, 30_000);

  test(`${kind}: push modes: off queues nothing; status sends statuses only; status+comments runs the other kinds' executors too`, async () => {
    const off = await rig(kind, { push: "off" });
    await off.move("PAY-322", PROGRESS);
    expect(off.pending()).toEqual([]);

    const ran: string[] = [];
    const comments: PushExecutor = { kind: "comment", execute: async (i) => { ran.push(i.key); return { kind: "done" }; } };
    for (const mode of ["status", "status+comments"]) {
      const r = await rig(kind, { push: mode });
      r.engine.register(comments);
      await r.engine.queue.put({ key: "PAY-322/comment/1", kind: "comment", issue: "PAY-322", extId: r.model("PAY-322").id, row: { at: "", who: "kraken", message: "hi" }, due: 0, attempts: 0 });
      await r.move("PAY-322", PROGRESS);
      await r.after();
      expect(r.model("PAY-322").status).toBe("3");
      expect(ran.splice(0)).toEqual(mode === "status" ? [] : ["PAY-322/comment/1"]);
    }
  }, 60_000);

  test(`${kind}: an agent's move takes the steps without a screen and stops before Release's, for the person`, async () => {
    const r = await rig(kind, { before: releasable() });
    learnedAll(r.root, r.f);
    await r.move("PAY-324", DONE, "claude"); // Code Review → QA → Ready for Release → (Release: a screen) Done
    await r.after();
    expect(r.model("PAY-324").status).toBe("10005");
    const [item] = r.pending();
    expect(item!.agent).toBe(true);
    expect(item!.waiting!.message).toBe("claude moved PAY-324 to Done; Release has a screen in Jira (Jira is at Ready for Release): fill it to finish");
    // hive shows where Jira stopped meanwhile, so a pull agrees rather than finding a conflict.
    expect((await r.local("PAY-324")).status).toBe(READY);
    await r.w.handle("sync-now", {});
    expect(await r.w.handle("conflicts", {})).toEqual([]);
    expect(r.pending().map((i) => i.status)).toEqual([DONE]);
    // The person fills it.
    expect(await r.w.handle("answer", { key: item!.key, values: { resolution: "Done" } })).toEqual({ outcome: "done" });
    expect([r.model("PAY-324").status, r.model("PAY-324").resolution]).toEqual(["10006", "Done"]);
    expect((await r.local("PAY-324")).status).toBe(DONE);
  }, 30_000);

  test(`${kind}: a person's way through a screen asks to confirm it first`, async () => {
    const r = await rig(kind, { before: releasable() });
    learnedAll(r.root, r.f);
    await r.move("PAY-324", DONE);
    await r.after();
    expect(r.moves("PAY-324")).toBe(0);
    const [item] = r.pending();
    expect(item!.waiting!.form!.path!.map((s) => s.name)).toEqual(["Send to QA", "Pass QA", "Release"]);
    // OK the way: it goes as far as the screen, which asks next.
    expect(await r.w.handle("answer", { key: item!.key }) as Any).toMatchObject({ outcome: "waiting" });
    expect(r.model("PAY-324").status).toBe("10005");
    expect(await r.w.handle("answer", { key: item!.key, values: { resolution: "Done" } })).toEqual({ outcome: "done" });
    expect(r.model("PAY-324").status).toBe("10006");
  }, 30_000);

  test(`${kind}: a waiting push the person cancels puts hive's status back`, async () => {
    const r = await rig(kind, { before: releasable() });
    await r.move("PAY-330", DONE);
    await r.after();
    expect(await r.w.handle("answer", { key: r.pending()[0]!.key, cancel: true })).toEqual({ outcome: "cancelled" });
    expect((await r.local("PAY-330")).status).toBe(READY);
    expect(r.pending()).toEqual([]);
    expect(((await r.w.handle("status", {})) as Any).refused).toBeUndefined();
  }, 30_000);

  test(`${kind}: a change besides the status reaches the side pushes; the hivemind property rides along with the transition`, async () => {
    const r = await rig(kind);
    await updateIssue(r.root, "PAY-322", { branch: "pay-322-retry-metrics" }, "kraken");
    await r.w.issueChanged({ id: "PAY-322", fields: ["branch"] });
    expect(r.pending().map((i) => i.kind)).toEqual(["property"]);
    await r.move("PAY-322", PROGRESS);
    await r.after();
    expect(r.model("PAY-322").status).toBe("3");
    expect(r.model("PAY-322").properties.hivemind).toMatchObject({ branch: "pay-322-retry-metrics", pr: null });
    expect(r.pending()).toEqual([]);
    // REST sends it in the transition's own write (the per-issue write limit); MCP has no such field.
    const puts = kind === "rest" ? r.f.requests.filter((x: Any) => x.method === "PUT" && x.path.endsWith("/properties/hivemind")).length : undefined;
    if (kind === "rest") expect(puts).toBe(0);

    const off = await rig(kind, { push: "off" });
    await updateIssue(off.root, "PAY-322", { branch: "pay-322" }, "kraken");
    await off.w.issueChanged({ id: "PAY-322", fields: ["branch"] });
    expect(off.pending()).toEqual([]);
  }, 60_000);

  // ── §8.3 ──────────────────────────────────────────────────────────────────────────────────────

  const jiraMoves = (r: Awaited<ReturnType<typeof rig>>, key: string, status: string) => {
    r.model(key).status = status;
    r.model(key).updated = new Date(Date.now() + 60_000).toISOString().replace("Z", "+0000");
  };

  test(`${kind}: §8.3 remote moved, local didn't: hive takes Jira's status and pushes nothing`, async () => {
    const r = await rig(kind);
    jiraMoves(r, "PAY-322", "10002");
    await r.w.handle("sync-now", {});
    expect((await r.local("PAY-322")).status).toBe(BLOCKED);
    await r.w.issueChanged({ id: "PAY-322", fields: ["status"] });
    expect(r.pending()).toEqual([]);
  }, 30_000);

  test(`${kind}: §8.3 both moved to the same status: nothing is sent`, async () => {
    const r = await rig(kind);
    await r.move("PAY-322", PROGRESS);
    jiraMoves(r, "PAY-322", "3");
    await r.after();
    expect(r.pending()).toEqual([]);
    expect(await r.pushed("PAY-322")).toEqual([]);
    expect(r.moves("PAY-322")).toBe(0);
  }, 30_000);

  test(`${kind}: §8.3 both moved apart: nothing is sent, the pull marks a conflict, and Keep hive sends hive's status`, async () => {
    const r = await rig(kind);
    await r.move("PAY-322", PROGRESS);
    jiraMoves(r, "PAY-322", "10002");
    await r.after();
    expect(r.model("PAY-322").status).toBe("10002");
    expect(r.pending()).toEqual([]);
    await r.w.handle("sync-now", {});
    expect(await r.w.handle("conflicts", {})).toEqual([expect.objectContaining({ id: "PAY-322", local: PROGRESS, remote: BLOCKED })]);
    // While in conflict, hive's moves wait for the person's choice.
    await r.w.issueChanged({ id: "PAY-322", fields: ["status"] });
    expect(r.pending()).toEqual([]);
    expect(await r.w.handle("resolve", { id: "PAY-322", keep: "hive" })).toEqual({ ok: true });
    expect(r.model("PAY-322").status).toBe("3");
    expect((await r.pushed("PAY-322")).at(-1)).toBe("hive→jira: moved to In Progress in Jira (Unblock)");
    await r.w.handle("sync-now", {});
    expect(await r.w.handle("conflicts", {})).toEqual([]);
    expect((await r.local("PAY-322")).status).toBe(PROGRESS);
  }, 30_000);

  test(`${kind}: §8.3 local moved only into a hive-only status whose follow is Jira's new status: they agree`, async () => {
    const r = await rig(kind);
    await r.move("PAY-321", PR_CREATED); // follows Code Review
    jiraMoves(r, "PAY-321", "10003");
    await r.after();
    expect(r.moves("PAY-321")).toBe(0);
    await r.w.handle("sync-now", {});
    expect(await r.w.handle("conflicts", {})).toEqual([]);
    expect((await r.local("PAY-321")).status).toBe(PR_CREATED);
  }, 30_000);

  test(`${kind}: §8.3 Jira closed it while work exists here: hive takes Done, says so, and leaves the PR open`, async () => {
    const r = await rig(kind);
    const pr = { repo: "acme/pay", number: 7, url: "https://github.com/acme/pay/pull/7", state: "open" };
    await updateIssue(r.root, "PAY-321", { branch: "pay-321", pr }, "kraken");
    await r.move("PAY-321", BLOCKED);
    jiraMoves(r, "PAY-321", "10006");
    await r.after();
    await r.w.handle("sync-now", {});
    const i = await r.local("PAY-321");
    expect([i.status, i.pr?.state, i.branch]).toEqual([DONE, "open", "pay-321"]);
    expect(i.sections.activity.at(-1).message).toContain("closed in the tracker while work exists here");
    expect(await r.w.handle("conflicts", {})).toEqual([]);
  }, 30_000);

  test(`${kind}: §8.3 a conflict left a day keeps Jira's status`, async () => {
    const r = await rig(kind);
    await r.move("PAY-322", PROGRESS);
    jiraMoves(r, "PAY-322", "10002");
    await r.after();
    await r.w.handle("sync-now", {});
    const [c] = await r.w.handle("conflicts", {}) as Any[];
    r.clock.t = Date.parse(c.since) + KEEP_JIRA_AFTER_MS - 1;
    expect(await r.engine.expireConflicts()).toEqual([]);
    r.clock.t += 1;
    expect(await r.engine.expireConflicts()).toEqual(["PAY-322"]);
    expect((await r.local("PAY-322")).status).toBe(BLOCKED);
    expect(await r.pushed("PAY-322")).toContain("Jira's status kept: the status conflict had no answer for a day");
    expect(r.pending()).toEqual([]);
    await r.w.handle("sync-now", {});
    expect(await r.w.handle("conflicts", {})).toEqual([]);
  }, 30_000);
}
