// What only the API-token transport does (design §9.1), against the fake Jira: where a scoped token
// goes and where a classic one does, the cloud ID from tenant_info or from the person, the granular
// scopes a board call names, keeping and forgetting the connection, `issueErrors` as retriable, the
// rate limits (each RateLimit-Reason, Retry-After, the retry rule, 4 in flight, the near-limit
// warning), and the token kept out of every log line.
import { afterEach, expect, test } from "bun:test";
import { closeAll, jira, linked, localOnly, memorySecrets, mirrored, restAccount } from "./harness";
import { Account, DEFAULT_OPTIONS } from "../../tools/jira/src/service/account";
import { log } from "../../tools/jira/src/service/log";
import { RestLimits, readLimit } from "../../tools/jira/src/service/rest/limits";
import { RestTransport } from "../../tools/jira/src/service/rest/transport";
import { TransportError } from "../../tools/jira/src/service/transport";
import { nextDelayMs } from "../../tools/jira/src/service/engine/cadence";

afterEach(closeAll);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const paths = (j: Any) => j.requests.map((r: Any) => `${r.method} ${r.path} ${r.via} ${r.status}`);

// ── the connection ──────────────────────────────────────────────────────────────────────────────

test("a scoped token is sent to the gateway alone; a classic one, which the gateway refuses, is taken on the site", async () => {
  const j = await jira("cloud-scrum-company");
  const scoped = await restAccount(j).account.testRest({});
  expect([scoped.via, scoped.cloudId, scoped.me, scoped.siteUrl, scoped.missingScopes]).toEqual(["gateway", j.site.cloudId, "Ujjwal Solanki", "https://acme.atlassian.net", []]);
  // tenant_info is the one call to the site, and carries no token; everything else went through the gateway.
  expect(j.requests.filter((r: Any) => r.via === "site").map((r: Any) => r.path)).toEqual(["/_edge/tenant_info"]);

  const k = await jira("cloud-scrum-company");
  const classic = await restAccount(k, { token: "classic" }).account.testRest({});
  expect(classic.via).toBe("site");
  expect(paths(k).slice(0, 3)).toEqual(["GET /_edge/tenant_info site 200", "GET /rest/api/3/myself gateway 401", "GET /rest/api/3/myself site 200"]);
});

test("a token Atlassian refuses is refused at the check, naming the email, and stops the sync with that reason", async () => {
  const j = await jira("cloud-jwm-noboard");
  const r = restAccount(j);
  r.secrets.values.set("apiToken", "not-the-token");
  await r.account.init();
  const err = await r.account.testRest({}).catch((e: unknown) => e) as TransportError;
  expect([err.kind, err.message]).toEqual(["auth", `Atlassian refused the API token for ${j.credentials.email} on 127.0.0.1:${new URL(j.url).port} (Unauthorized): check the email and the token, or create a new one (tokens expire)`]);
  expect(r.account.problem()).toBeNull();
  await expect(r.account.transport().site()).rejects.toThrow(/refused the API token/);
  expect(r.account.problem()).toMatch(/^Atlassian refused the API token/);
});

test("the cloud ID comes from the site's tenant_info; when that can't be read the person is asked for it, and the one they give is used", async () => {
  const j = await jira("cloud-kanban-team");
  const noTenant = (async (input: string | URL | Request, init?: RequestInit) =>
    String(input).endsWith("/_edge/tenant_info") ? new Response("", { status: 404 }) : localOnly(input, init)) as typeof fetch;
  const asked = await restAccount(j, { fetch: noTenant }).account.testRest({}).catch((e: unknown) => e) as TransportError;
  expect([asked.kind, asked.message]).toEqual(["not-found", `couldn't look up 127.0.0.1:${new URL(j.url).port}'s cloud ID (it answered 404): paste it in the Jira settings (Cloud ID), from https://127.0.0.1:${new URL(j.url).port}/_edge/tenant_info`]);
  const given = await restAccount(j, { fetch: noTenant, options: { cloudId: j.site.cloudId } }).account.testRest({});
  expect(given.cloudId).toBe(j.site.cloudId);
  // A cloud ID Atlassian doesn't know is said as such.
  const wrong = await restAccount(j, { options: { cloudId: "00000000-0000-0000-0000-000000000000" } }).account.testRest({}).catch((e: unknown) => e) as TransportError;
  expect([wrong.kind, wrong.message]).toEqual(["not-found", "Atlassian has no Jira site with cloud ID 00000000-0000-0000-0000-000000000000: check the Cloud ID in the Jira settings"]);
});

const BOARDS = ["read:board-scope:jira-software", "read:project:jira"];
const ADMIN = "read:board-scope.admin:jira-software";
const SPRINT = "read:sprint:jira-software";
const scopeRows: [string, string[], string[]][] = [
  ["classic scopes alone: every Agile scope", ["read:jira-work", "read:jira-user"], [...BOARDS, ADMIN, SPRINT]],
  ["the board list's alone: the configuration's and the sprints'", BOARDS, [ADMIN, SPRINT]],
  ["no sprint scope: that one", [...BOARDS, ADMIN], [SPRINT]],
  ["all of them: nothing", [...BOARDS, ADMIN, SPRINT], []],
];
for (const [label, scopes, missing] of scopeRows) {
  test(`a board call at sign-in names the granular scopes the token lacks — ${label}`, async () => {
    const j = await jira("cloud-scrum-company", { credentials: { scopes } });
    expect((await restAccount(j).account.testRest({ project: "PAY" })).missingScopes).toEqual(missing);
  });
}

test("a missing board scope fails discovery naming it, instead of reading as a project without boards", async () => {
  const j = await jira("cloud-scrum-company", { credentials: { scopes: [...BOARDS, SPRINT] } });
  const r = restAccount(j);
  await r.account.init();
  const t = r.account.transport();
  const err = await t.discover("PAY").catch((e: unknown) => e) as TransportError;
  expect([err.kind, err.message]).toEqual(["forbidden", `the API token lacks a scope GET /rest/agile/1.0/board/{id}/configuration needs: add ${ADMIN}, read:project:jira to it (Unauthorized; scope does not match)`]);
});

test("connecting with an API token checks it, then keeps it with its email, site and cloud ID: it syncs after a restart; signing out forgets all of it", async () => {
  const j = await jira("cloud-jwm-noboard");
  const secrets = memorySecrets();
  const make = () => new Account({ secrets, options: { ...DEFAULT_OPTIONS }, log: () => {}, restApiBase: j.url, fetch: localOnly });
  const a = make();
  await a.init();
  expect(a.problem()).toBe("not signed in: Sign in with Atlassian");
  // A wrong token is refused and nothing is kept.
  await expect(a.signInRest({ site: j.url, email: j.credentials.email, apiToken: "wrong" })).rejects.toThrow(/refused the API token/);
  expect([...secrets.values.keys()]).toEqual([]);
  const ok = await a.signInRest({ site: j.url, email: j.credentials.email, apiToken: j.credentials.scopedToken, project: "MKT" });
  expect([ok.via, ok.missingScopes]).toEqual(["gateway", []]);
  expect(secrets.values.get("apiToken")).toBe(j.credentials.scopedToken);
  expect(JSON.parse(secrets.values.get("restAuth")!)).toEqual({ email: j.credentials.email, site: j.url, cloudId: j.site.cloudId, primary: true });
  expect([a.transportKind, a.problem()]).toEqual(["rest", null]);

  const restarted = make();
  await restarted.init();
  const before = j.requests.length;
  expect((await restarted.transport().site()).cloudId).toBe(j.site.cloudId);
  // The kept cloud ID: no tenant_info lookup on restart.
  expect(j.requests.slice(before).some((r: Any) => r.path === "/_edge/tenant_info")).toBe(false);

  await restarted.signOut();
  expect([...secrets.values.keys()]).toEqual([]);
  // Back to Sign in with Atlassian, signed out (as signing out of it says).
  expect([restarted.transportKind, restarted.problem()]).toEqual(["mcp", "sign in again: signed out"]);
});

test("the sign-in command takes transport rest, and test-connection checks without keeping anything", async () => {
  const { w, r, f: j } = await linked("cloud-jwm-noboard", { kind: "rest" });
  const tested = await w.handle("test-connection", { email: j.credentials.email, apiToken: j.credentials.scopedToken }) as { via: string };
  expect(tested.via).toBe("gateway");
  expect(r.secrets.values.has("restAuth")).toBe(false);
  const signed = await w.handle("sign-in", { transport: "rest", site: j.url, email: j.credentials.email }) as { cloudId: string };
  expect(signed.cloudId).toBe(j.site.cloudId);
  expect(r.secrets.values.has("restAuth")).toBe(true);
  await expect(w.handle("sign-in", { transport: "ftp" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  const status = await w.handle("status", {}) as { transport: string; connected: boolean; served: Record<string, string> };
  expect([status.transport, status.connected, status.served.jqlParse, status.served.adf]).toEqual(["rest", true, "rest", "rest"]);
});

test("ids bulkfetch reports in issueErrors are checked again next time, never archived", async () => {
  const { f: j, w, root } = await linked("cloud-scrum-company", { kind: "rest", fake: { issueErrors: { "PAY-330": "Temporarily unavailable" } } });
  j.site.issues.find((i: Any) => i.key === "PAY-330").assignee = null; // it leaves the scope: reconcile checks it
  await w.handle("sync-now", { reconcile: true });
  expect((await mirrored(root)).find((i) => i.id === "PAY-330")?.archived).toBeNull();
  expect(((await w.handle("status", {})) as { problems: string[] }).problems).toContain("1 issue could not be checked this time; checked again next time, nothing archived for it");
});

// ── rate limits ─────────────────────────────────────────────────────────────────────────────────

/** REST limits on a fake clock: waits advance it and are recorded. */
function clockLimits() {
  const c = { now: Date.parse("2026-10-24T08:00:00Z"), sleeps: [] as number[] };
  const limits = new RestLimits({ now: () => c.now, sleep: async (ms) => { c.sleeps.push(ms); c.now += ms; }, random: () => 0.5 });
  return { c, limits };
}
async function restOn(site: string, fault?: Any, opts: Record<string, unknown> = {}) {
  const j = await jira(site, opts);
  if (fault) j.site.faults.push(...[fault].flat());
  const { c, limits } = clockLimits();
  const r = restAccount(j, { limits });
  await r.account.init();
  const t = r.account.transport();
  await t.site();
  return { j, c, limits, t, r };
}
const hits = (j: Any, method: string, path: string) => j.requests.filter((x: Any) => x.method === method && x.path === path).length;
const fault = (method: string, path: string, headers: Record<string, string>, o: { nth?: number; times?: number; status?: number } = {}) =>
  ({ name: "test", match: { method, path, nth: o.nth ?? 1, times: o.times ?? 1 }, status: o.status ?? 429, headers });

test("a burst 429 on a read is retried after Retry-After or the backoff, whichever is longer", async () => {
  const { j, c, t } = await restOn("cloud-scrum-company", fault("POST", "/rest/api/3/search/jql", { "Retry-After": "2", "RateLimit-Reason": "jira-burst-based" }));
  const page = await t.search("project = PAY", ["summary"]);
  expect(page.items.length).toBeGreaterThan(0);
  expect(hits(j, "POST", "/rest/api/3/search/jql")).toBe(2);
  // Backoff 2–5 s at random 0.5 is 3.5 s, ×1.0 jitter: longer than Retry-After's 2 s.
  expect(c.sleeps).toEqual([3_500]);
});

test("a burst slows that endpoint alone; a per-issue write limit delays writes to that issue alone; neither write is retried", async () => {
  const { j, c, t } = await restOn("cloud-scrum-company", [
    fault("POST", "/rest/api/3/issue/PAY-322/comment", { "Retry-After": "10", "RateLimit-Reason": "jira-burst-based" }),
    fault("POST", "/rest/api/3/issue/PAY-323/transitions", { "Retry-After": "3", "RateLimit-Reason": "jira-per-issue-on-write" }),
  ]);
  const burst = await t.comment("PAY-322", "first").catch((e: unknown) => e) as TransportError;
  expect([burst.kind, burst.retryAfterMs, hits(j, "POST", "/rest/api/3/issue/PAY-322/comment")]).toEqual(["rate-limited", 10_000, 1]);
  await t.comments("PAY-322"); // another endpoint: no wait
  expect(c.sleeps).toEqual([]);
  await t.comment("PAY-324", "on the slowed endpoint"); // same endpoint, another issue: waits out the burst
  expect(c.sleeps).toEqual([10_000]);

  const perIssue = await t.transition("PAY-323", "31").catch((e: unknown) => e) as TransportError;
  expect([perIssue.kind, perIssue.retryAfterMs]).toEqual(["rate-limited", 3_000]);
  await t.assign("PAY-324", null); // a write to another issue: no wait
  expect(c.sleeps).toEqual([10_000]);
  await t.assign("PAY-323", null); // to that issue: waits
  expect(c.sleeps).toEqual([10_000, 3_000]);
});

test("a quota 429 pauses every request until its reset, without asking Jira, and the status says until when", async () => {
  const { j, c, t, r } = await restOn("cloud-kanban-team", fault("POST", "/rest/api/3/search/jql", { "Retry-After": "1800", "RateLimit-Reason": "jira-quota-tenant-based" }));
  const err = await t.search("project = OPS", ["summary"]).catch((e: unknown) => e) as TransportError;
  expect([err.kind, err.retryAfterMs, c.sleeps]).toEqual(["rate-limited", 1_800_000, []]);
  const asked = j.requests.length;
  const paused = await t.comments("OPS-1").catch((e: unknown) => e) as TransportError;
  expect([paused.kind, j.requests.length]).toEqual(["rate-limited", asked]);
  expect(r.account.rateLimitedUntil()).toBe(c.now + 1_800_000);
  c.now += 1_800_001;
  expect(Array.isArray(await t.comments("OPS-1"))).toBe(true);
});

test("only an idempotent request whose 429 says Retry-After is retried, 4 times at most, backing off to 30 s", async () => {
  // PUT is idempotent: retried. POST comment isn't: not retried. No Retry-After: not retried.
  const { j, c, t } = await restOn("cloud-scrum-company", [
    fault("PUT", "/rest/api/3/issue/PAY-321/assignee", { "Retry-After": "1", "RateLimit-Reason": "jira-burst-based" }),
    fault("POST", "/rest/api/3/issue/PAY-322/comment", { "Retry-After": "1", "RateLimit-Reason": "jira-burst-based" }),
    fault("GET", "/rest/api/3/issue/PAY-322/comment", {}),
    fault("GET", "/rest/api/3/issue/PAY-323/comment", { "Retry-After": "1" }, { times: 10 }),
  ]);
  await t.assign("PAY-321", null);
  expect(hits(j, "PUT", "/rest/api/3/issue/PAY-321/assignee")).toBe(2);
  await expect(t.comment("PAY-322", "hi")).rejects.toMatchObject({ kind: "rate-limited" });
  expect(hits(j, "POST", "/rest/api/3/issue/PAY-322/comment")).toBe(1);
  await expect(t.comments("PAY-322")).rejects.toMatchObject({ kind: "rate-limited" });
  expect(hits(j, "GET", "/rest/api/3/issue/PAY-322/comment")).toBe(1);
  c.sleeps.length = 0;
  await expect(t.comments("PAY-323")).rejects.toMatchObject({ kind: "rate-limited" });
  expect(hits(j, "GET", "/rest/api/3/issue/PAY-323/comment")).toBe(5);
  expect(c.sleeps).toEqual([3_500, 7_000, 14_000, 28_000]);
});

test("the backoff is 2–5 s, doubling, jittered ×0.7–1.3, never over 30 s", () => {
  const at = (r: number) => new RestLimits({ random: () => r });
  expect([at(0).backoffMs(0), at(0.9999999).backoffMs(0), at(0).backoffMs(1), at(0.9999999).backoffMs(5)]).toEqual([1_400, 6_500, 2_800, 30_000]);
});

test("at most 4 requests are in flight, however many are asked at once", async () => {
  const j = await jira("cloud-scrum-company");
  let now = 0, peak = 0;
  const slow = (async (input: string | URL | Request, init?: RequestInit) => {
    peak = Math.max(peak, ++now);
    try { await Bun.sleep(25); return await localOnly(input, init); } finally { now--; }
  }) as typeof fetch;
  const r = restAccount(j, { fetch: slow });
  await r.account.init();
  const t = r.account.transport();
  await t.site();
  peak = 0;
  const keys = ["PAY-318", "PAY-321", "PAY-322", "PAY-323", "PAY-324", "PAY-325", "PAY-326", "PAY-327", "PAY-328", "PAY-329"];
  expect((await Promise.all(keys.map((k) => t.comments(k)))).length).toBe(10);
  expect([peak, r.account.restLimits.peak]).toEqual([4, 4]);
});

test("Jira's near-limit warning slows the poll: X-RateLimit-NearLimit, or the RateLimit headers under 20% left", async () => {
  const { t, r } = await restOn("cloud-scrum-company", { name: "near", match: { method: "GET", path: "/rest/api/3/issue/PAY-322/comment", nth: 1, times: 1 }, status: 200, headers: { "X-RateLimit-NearLimit": "true" } });
  expect(r.account.restLimits.nearLimit()).toBe(false);
  await t.comments("PAY-322");
  expect(r.account.restLimits.nearLimit()).toBe(true);
  expect(nextDelayMs({ active: true, callsPerPass: 0, budget: 400, nearLimit: true })).toBe(2 * nextDelayMs({ active: true, callsPerPass: 0, budget: 400 }));
  const h = (o: Record<string, string>) => readLimit(new Headers(o)).near;
  expect([
    h({ "Beta-RateLimit": '"burst";r=5;t=1', "Beta-RateLimit-Policy": '"burst";q=100;w=1' }),
    h({ RateLimit: '"burst";r=50;t=1', "RateLimit-Policy": '"burst";q=100;w=1' }),
    h({ "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "19" }),
    h({ "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "20" }),
    h({}),
  ]).toEqual([true, false, true, false, false]);
});

// ── the token stays out of the log ──────────────────────────────────────────────────────────────

test("the API token, raw or in its Basic header, is taken out of every log line", async () => {
  const j = await jira("cloud-jwm-noboard");
  const token = "s3cr3t-token-for-the-log-test";
  const basic = Buffer.from(`${j.credentials.email}:${token}`).toString("base64");
  new RestTransport({ site: j.url, email: j.credentials.email, token, limits: new RestLimits(), log, fetch: localOnly });
  const out: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => { out.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try {
    log(`sent ${basic} with ${token}`, { headers: { Authorization: `Basic ${basic}` } });
    log("failed", new Error(`echoed ${token}`));
  } finally {
    process.stdout.write = write;
  }
  const text = out.join("");
  expect(text).not.toContain(token);
  expect(text).not.toContain(basic);
  expect(text).toBe('[jira] sent [redacted] with [redacted] {"headers":{"Authorization":"Basic [redacted]"}}\n[jira] failed echoed [redacted]\n');
});

test("a refused token's messages name the email, never the token", async () => {
  const j = await jira("cloud-jwm-noboard");
  const r = restAccount(j);
  r.secrets.values.set("apiToken", "a-wrong-but-secret-token");
  await r.account.init();
  const err = await r.account.transport().search("project = MKT", ["summary"]).catch((e: unknown) => e) as Error;
  expect(err.message).toContain(j.credentials.email);
  expect(`${err.message} ${r.account.problem()} ${r.logs.join(" ")}`).not.toMatch(/a-wrong-but-secret-token|YS13cm9uZy1idXQtc2VjcmV0LXRva2Vu/);
});

// ── writes (what P3's push sends through) ───────────────────────────────────────────────────────

test("a transition carries its screen's fields and hive's entity property in one write; a missing required field is refused with Jira's per-field words", async () => {
  const { j, t } = await restOn("cloud-scrum-company");
  const issue = j.site.issues.find((i: Any) => i.key === "PAY-322");
  const refused = await t.transition("PAY-322", "81").catch((e: unknown) => e) as TransportError;
  expect([refused.kind, refused.fieldErrors]).toEqual(["invalid", { resolution: "Resolution is required." }]);
  expect(issue.status).toBe("10001");
  await t.transition("PAY-322", "81", { resolution: { name: "Won't Do" } }, { hivemind: { branch: "pay-322", by: "hive" } });
  expect([issue.status, issue.resolution, issue.properties.hivemind]).toEqual(["10007", "Won't Do", { branch: "pay-322", by: "hive" }]);
});

test("assign sets and clears the assignee; a comment goes up as ADF built from markdown; setProperty writes the entity property", async () => {
  const { j, t } = await restOn("cloud-scrum-company");
  const issue = j.site.issues.find((i: Any) => i.key === "PAY-321");
  await t.assign("PAY-321", "5b10ac8d82e05b22cc7d4ef5");
  expect(issue.assignee).toBe("5b10ac8d82e05b22cc7d4ef5");
  await t.assign("PAY-321", null);
  expect(issue.assignee).toBeNull();
  const { id } = await t.comment("PAY-321", "Opened **#42**: see [the PR](https://github.com/o/r/pull/42)\n\n- [x] tests");
  const body = issue.comments.find((c: Any) => c.id === id).body.adf;
  expect(body.content.map((n: Any) => n.type)).toEqual(["paragraph", "taskList"]);
  expect(body.content[0].content.find((n: Any) => n.marks?.[0]?.type === "link")).toMatchObject({ text: "the PR", marks: [{ type: "link", attrs: { href: "https://github.com/o/r/pull/42" } }] });
  // And back: what hive wrote reads as what it wrote.
  expect((await t.comments("PAY-321")).find((c) => c.id === id)?.bodyMd).toBe("Opened **#42**: see [the PR](https://github.com/o/r/pull/42)\n\n- [x] tests");
  await t.setProperty("PAY-321", "hivemind", { hiveVersion: 1, pr: 42 });
  expect(issue.properties.hivemind).toEqual({ hiveVersion: 1, pr: 42 });
  // Read back through search's `properties` (design §8.1).
  const page = await t.search("key = PAY-321", ["summary"], undefined, { properties: ["hivemind"] });
  expect(page.items[0]!.properties).toEqual({ hivemind: { hiveVersion: 1, pr: 42 } });
});

test("a remote link is an upsert by globalId: sent twice it is one link, its whole object each time", async () => {
  const { j, t } = await restOn("cloud-scrum-company");
  const issue = j.site.issues.find((i: Any) => i.key === "PAY-322");
  const before = issue.remoteLinks.length;
  const link = { globalId: "github-pr:o/r#42", url: "https://github.com/o/r/pull/42", title: "PR #42", resolved: false };
  await t.remoteLink("PAY-322", link);
  await t.remoteLink("PAY-322", { ...link, title: "PR #42 (merged)", resolved: true });
  const mine = issue.remoteLinks.filter((l: Any) => l.globalId === link.globalId);
  expect([issue.remoteLinks.length - before, mine[0].object]).toEqual([1, { url: link.url, title: "PR #42 (merged)", status: { resolved: true } }]);
});

test("the bulk changelog gives status and assignee changes of many issues, oldest first", async () => {
  const { j, t } = await restOn("cloud-kanban-team");
  const withHistory = j.site.issues.filter((i: Any) => i.changelog.some((h: Any) => h.items.some((x: Any) => x.fieldId === "status")));
  const got = await t.changelog!(withHistory.map((i: Any) => i.key), ["status"]);
  const expected = withHistory.flatMap((i: Any) => i.changelog.filter((h: Any) => h.items.some((x: Any) => x.fieldId === "status")).map((h: Any) => `${i.id}:${h.id}`));
  expect(got.map((h) => `${h.issueId}:${h.id}`).sort()).toEqual(expected.sort());
  expect(got.every((h) => h.items.every((x) => x.fieldId === "status"))).toBe(true);
});

test("the workflow graph is read when this person may (admin), and a 401 there means no, not bad credentials", async () => {
  const plain = await restOn("cloud-scrum-company");
  expect(await plain.t.workflowGraph!("10100", ["10001"])).toBeNull();
  expect([plain.t.capabilities.workflowGraph, plain.r.account.problem()]).toEqual([false, null]);
  const admin = await restOn("cloud-scrum-company", undefined, { admin: true });
  const g = await admin.t.workflowGraph!("10100", ["10001", "10004"]);
  expect(Object.keys(g!)).toEqual(["10001", "10004"]);
  expect(g!["10001"]!.find((x) => x.id === "81")).toEqual({ id: "81", name: "Won't do", from: "*", to: "10007" });
  expect(admin.t.capabilities.workflowGraph).toBe(true);
});

// The API can't tell a token's age (design §9.1), so the wizard asks the day it expires, and the
// status warns from 14 days before — and says so plainly once it has passed.
test("the token's expiry day the person gave warns from 14 days before, and after it", async () => {
  const j = await jira("cloud-scrum-company");
  const r = restAccount(j);
  const day = (offset: number) => new Date(Date.UTC(2026, 9, 24 + offset)).toISOString().slice(0, 10);
  const now = new Date(Date.UTC(2026, 9, 24, 12));
  await r.account.signInRest({ expiresOn: day(30) });
  expect(r.account.tokenExpiryProblem(now)).toBeUndefined();
  await r.account.signInRest({ expiresOn: day(10) });
  expect(r.account.tokenExpiryProblem(now)).toContain(`expires on ${day(10)} (in 10 days)`);
  await r.account.signInRest({ expiresOn: day(-1) });
  expect(r.account.tokenExpiryProblem(now)).toContain(`expired on ${day(-1)}`);
  // A day that isn't a date is not kept, and warns of nothing.
  await r.account.signInRest({ expiresOn: "soon" });
  expect(r.account.tokenExpiryProblem(now)).toBeUndefined();
});
