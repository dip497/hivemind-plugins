// The MCP transport's contract with the Rovo server (design §9.0, §9.2), against the fake: the
// limits it keeps (3 in flight, the hourly budget, Retry-After), tools found by capability, answers
// checked and failing loudly, and rich text arriving as markdown.
import { afterEach, expect, test } from "bun:test";
import { account, closeAll, linked, rovo, signIn, toolCalls } from "./harness";
import { TransportError } from "../../tools/jira/src/service/transport";
import { resolveTools } from "../../tools/jira/src/service/mcp/tools";
import { retryAfterMs } from "../../tools/jira/src/service/mcp/session";

afterEach(closeAll);

test("at most 3 calls are in flight, however many are asked at once", async () => {
  // The fake refuses a 5th request in flight with a 429; each call takes 40 ms so they overlap.
  const f = await rovo("cloud-scrum-company", { maxParallel: 4, latencyMs: 40 });
  const r = account(f);
  await signIn(r);
  const t = r.account.transport();
  await t.site();
  const keys = ["PAY-318", "PAY-321", "PAY-322", "PAY-323", "PAY-324", "PAY-325", "PAY-326", "PAY-327", "PAY-328", "PAY-329"];
  const got = await Promise.all(keys.map((k) => t.comments(k)));
  expect(got.length).toBe(10);
  expect(r.account.limiter.peak).toBe(3);
  expect(f.requests.filter((x: { status: number }) => x.status === 429).length).toBe(0);
}, 30_000);

test("the hourly budget is kept: past it a call is refused without reaching Atlassian, until the oldest call is an hour old", async () => {
  let now = Date.parse("2026-10-24T08:00:00.000Z");
  const f = await rovo("cloud-jwm-noboard");
  const r = account(f, { options: { mcpBudget: 3 }, now: () => now });
  await signIn(r);
  const t = r.account.transport();
  await t.site(); // 1
  await t.comments("MKT-1"); // 2
  await t.comments("MKT-2"); // 3
  const seen = toolCalls(f).length;
  const err = await t.comments("MKT-3").catch((e: unknown) => e) as TransportError;
  expect([err.kind, err.retryAfterMs, /budget of 3/.test(err.message)]).toEqual(["rate-limited", 3_600_000, true]);
  expect(toolCalls(f).length).toBe(seen);
  now += 3_600_001;
  await t.comments("MKT-3");
  expect(toolCalls(f).length).toBe(seen + 1);
  expect(r.account.limiter.usage()).toEqual({ used: 1, limit: 3 });
});

test("a 429 is honoured for as long as its Retry-After says: nothing is called until then", async () => {
  let now = Date.parse("2026-10-24T08:00:00.000Z");
  // Atlassian's org-wide hourly limit, which the person's budget setting doesn't know about.
  const f = await rovo("cloud-scrum-company", { hourlyLimit: 2, now: () => new Date(now) });
  const r = account(f, { now: () => now });
  await signIn(r);
  const t = r.account.transport();
  await t.site();
  await t.comments("PAY-322");
  const err = await t.comments("PAY-323").catch((e: unknown) => e) as TransportError;
  // The fake's Retry-After: until the oldest of the two calls is an hour old.
  expect([err.kind, err.retryAfterMs]).toEqual(["rate-limited", 3_600_000]);
  const httpBefore = f.requests.length;
  const again = await t.comments("PAY-323").catch((e: unknown) => e) as TransportError;
  expect([again.kind, f.requests.length]).toEqual(["rate-limited", httpBefore]);
  expect(r.account.limiter.rateLimitedUntil()).toBe(now + 3_600_000);
  now += 3_600_001;
  expect((await t.comments("PAY-323")).length).toBeGreaterThanOrEqual(0);
  expect(retryAfterMs("Fri, 24 Oct 2026 08:00:30 GMT", Date.parse("2026-10-24T08:00:00Z"))).toBe(30_000);
});

test("an answer that isn't the shape the service reads fails loudly, naming the tool", async () => {
  const f = await rovo("cloud-scrum-company");
  // A server that changed its search answer: `isLast` is no longer a boolean.
  const bent = (async (input: string | URL | Request, init?: RequestInit) => {
    const res = await fetch(input, init);
    if (!(typeof init?.body === "string" && init.body.includes("searchJiraIssuesUsingJql"))) return res;
    const text = (await res.text()).replaceAll('\\"isLast\\":true', '\\"isLast\\":\\"yes\\"');
    return new Response(text, { status: res.status, headers: res.headers });
  }) as typeof fetch;
  const r = account(f, { fetch: bent });
  await signIn(r);
  const err = await r.account.transport().search("project = PAY", ["summary"]).catch((e: unknown) => e) as TransportError;
  expect(err).toBeInstanceOf(TransportError);
  expect(err.kind).toBe("invalid");
  expect(err.message).toMatch(/^searchJiraIssuesUsingJql answered a shape the Jira service doesn't know:[\s\S]*isLast/);
});

test("tools are found by what they do: a renamed tool still answers, and a site without the board list falls back to its sprint data", async () => {
  expect(resolveTools(["findJiraIssueAssignableUsers", "getJiraBoardConfig"])).toEqual({ assignable: "findJiraIssueAssignableUsers", boardConfig: "getJiraBoardConfig" });
  expect(resolveTools(["listJiraIssueAssignableUsers", "findJiraIssueAssignableUsers"]).assignable).toBe("listJiraIssueAssignableUsers");
  // A rename nobody has seen yet, by its pattern.
  expect(resolveTools(["searchJiraIssuesWithJql"]).search).toBe("searchJiraIssuesWithJql");

  const f = await rovo("cloud-scrum-company", { unavailable: ["listJiraBoards", "listJiraBoardSprints"] });
  const r = account(f);
  await signIn(r);
  const d = await r.account.transport().discover("PAY");
  expect(d.boards.map((b) => [b.id, b.type])).toEqual([[12, "scrum"]]);
  expect(d.board?.columns.map((c) => c.name)).toEqual(["To Do", "In Progress", "Review", "Ready", "Done"]);
  expect(d.sprints.map((s) => [s.id, s.state])).toEqual([[87, "active"]]);
});

test("a whole sync never calls Rovo's credit-spending search", async () => {
  const { f, w } = await linked("cloud-scrum-company", { scope: { kind: "all" } });
  await w.handle("browse", { jql: "summary ~ webhook" });
  await w.handle("track", { key: "PAY-321" });
  await w.handle("sync-now", { reconcile: true });
  const calls = toolCalls(f);
  expect(calls.length).toBeGreaterThan(10);
  expect(calls.filter((c) => c.tool === "search" || c.credits > 0)).toEqual([]);
}, 30_000);

test("rich text Rovo sends as HTML (a panel, a mention, a lozenge) arrives as markdown, its acceptance criteria as hive's own list", async () => {
  const { root } = await linked("cloud-scrum-company", { scope: { kind: "mine+unassigned" } });
  const text = await Bun.file(`${root}/mirror/jira-acme-PAY/PAY-318.md`).text();
  expect(text).not.toMatch(/<\/?(p|div|span|ul|li|h3|input)\b/);
  expect(text).toContain("[the runbook](https://wiki.example.com/runbook)");
  expect(text).toContain("> Do not retry 4xx except 429.");
  expect(text).toMatch(/## Acceptance criteria\s+- \[x\] Retries 5 times with jittered backoff\s+- \[ \] Dead-letters after the last retry/);
  expect(text).toContain("```ts\nawait retry(send, { attempts: 5 })\n```");
}, 30_000);
