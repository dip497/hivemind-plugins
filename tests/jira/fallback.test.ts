// Signed in with Atlassian and an API token too (design §9.0, "Missing capabilities"): what the
// Rovo MCP server can't do is served by REST, decided in one place (composite.ts), and the tile's
// status says which transport served what. Without a token nothing changes; with a token for
// another site, it isn't used and the status says why.
import { afterEach, expect, test } from "bun:test";
import { account, closeAll, linked, mirrored, rovo, signIn, toolCalls } from "./harness";
import { CompositeTransport } from "../../tools/jira/src/service/composite";

afterEach(closeAll);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Status = { transport: string; served?: Record<string, string>; problems: string[] };
const restPaths = (f: Any) => f.jira.requests.map((r: Any) => `${r.method} ${r.path}`);

test("with a token next to the sign-in, fields, JQL checks, history, entity properties, link upserts and the workflow graph are REST's; the rest stays on MCP, and the status says so", async () => {
  const { f, w } = await linked("cloud-scrum-company", { token: "scoped" });
  const s = await w.handle("status", {}) as Status;
  expect([s.transport, s.served]).toEqual(["mcp", {
    workflowGraph: "none", changelog: "rest", adf: "none", fieldsMeta: "rest", agile: "mcp", entityProps: "rest", jqlParse: "rest", remoteLinkUpsert: "rest", push: "mcp",
  }]);
  // Discovery read every field from REST's /field (MCP sees only the create screens'), and the
  // scope went through Jira's parser; issues and comments still came over MCP.
  expect(restPaths(f)).toContain("GET /rest/api/3/field");
  expect(restPaths(f)).toContain("POST /rest/api/3/jql/parse");
  expect(restPaths(f).filter((p: string) => /search\/jql|\/comment$|bulkfetch/.test(p))).toEqual([]);
  expect(toolCalls(f, "searchJiraIssuesUsingJql").length).toBeGreaterThan(0);
}, 30_000);

test("without a token nothing changes: no REST call, and the status says what MCP alone can't do", async () => {
  const { f, w } = await linked("cloud-scrum-company");
  const s = await w.handle("status", {}) as Status;
  expect([s.served?.fieldsMeta, s.served?.jqlParse, s.served?.agile]).toEqual(["none", "none", "mcp"]);
  expect(f.jira.requests).toEqual([]);
  expect(s.problems).toEqual([]);
}, 30_000);

test("with an admin's token the workflow graph is REST's too", async () => {
  const { w } = await linked("cloud-scrum-company", { token: "scoped", fake: { jira: { admin: true } } });
  expect(((await w.handle("status", {})) as Status).served?.workflowGraph).toBe("rest");
}, 30_000);

test("a scope Jira's parser refuses is refused when it is set, in Jira's words, when a token is there; without one the mirror is still kept by the empty-scope guard", async () => {
  const bad = { kind: "jql", jql: "project = PAY AND nosuchfield = 1" };
  const withToken = await linked("cloud-scrum-company", { token: "scoped" });
  await expect(withToken.w.handle("set-scope", { scope: bad })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^Jira doesn't take this scope's JQL \(.*nosuchfield = 1.*\): .*nosuchfield/) });

  const alone = await linked("cloud-scrum-company");
  const before = (await mirrored(alone.root)).filter((i) => !i.archived).map((i) => i.id);
  await alone.w.handle("set-scope", { scope: bad });
  await alone.w.handle("sync-now", { reconcile: true });
  expect((await mirrored(alone.root)).filter((i) => !i.archived).map((i) => i.id)).toEqual(before);
}, 30_000);

test("a scope that went wrong in Jira since it was set stops the sync with the parser's words, and archives nothing", async () => {
  const { f, w, root } = await linked("cloud-scrum-company", { token: "scoped", scope: { kind: "jql", jql: "project = PAY AND sprint = 87" } });
  const before = (await mirrored(root)).filter((i) => !i.archived).length;
  expect(before).toBeGreaterThan(0);
  f.site.sprints = f.site.sprints.filter((s: Any) => s.id !== 87); // the sprint was deleted
  // The next pass parses the scope again before it reads anything (design §7.3).
  await expect(w.handle("sync-now", { reconcile: true })).rejects.toThrow(/^Jira doesn't take this scope's JQL \(.*sprint = 87\)\): Sprint with name or id '87' does not exist/);
  expect((await mirrored(root)).filter((i) => !i.archived).length).toBe(before);
}, 30_000);

test("a token for another site isn't used: MCP works alone, and the status says why", async () => {
  const f = await rovo("cloud-jwm-noboard");
  const r = account(f, { token: "scoped", options: { cloudId: "11111111-2222-3333-4444-555555555555" } });
  await signIn(r);
  const t = r.account.transport();
  expect(t).toBeInstanceOf(CompositeTransport);
  const d = await t.discover("MKT");
  expect(d.resolutions).toEqual([]); // MCP's discovery alone: no REST enrichment
  expect(r.account.served()?.fieldsMeta).toBe("none");
  expect(r.account.fallbackProblem()).toBe(`the API token is for another site (cloud ID 11111111-2222-3333-4444-555555555555) than the sign-in's (${f.site.cloudId}): it isn't used`);
  expect(f.jira.requests.filter((x: Any) => x.path !== "/_edge/tenant_info")).toEqual([]);
});

test("signing in with Atlassian after connecting with a token: the sign-in syncs, and the token stays behind it", async () => {
  const f = await rovo("cloud-jwm-noboard");
  const r = account(f, { options: { site: f.jira.url } });
  await r.account.init();
  await r.account.signInRest({ email: f.jira.credentials.email, apiToken: f.jira.credentials.scopedToken });
  expect(r.account.transportKind).toBe("rest");
  const { authorizeUrl } = await r.account.signIn(new URL(f.site.baseUrl).host);
  await fetch(authorizeUrl);
  await r.account.signInDone();
  expect([r.account.transportKind, JSON.parse(r.secrets.values.get("restAuth")!).primary]).toEqual(["mcp", false]);
  expect(r.account.transport(new URL(f.site.baseUrl).host)).toBeInstanceOf(CompositeTransport);
});

test("the remote-link upsert and the bulk changelog go to REST behind MCP", async () => {
  const f = await rovo("cloud-scrum-company");
  const r = account(f, { token: "scoped" });
  await signIn(r);
  const t = r.account.transport();
  const link = { globalId: "github-pr:o/r#7", url: "https://github.com/o/r/pull/7", title: "PR #7", resolved: false };
  await t.remoteLink("PAY-322", link);
  await t.remoteLink("PAY-322", { ...link, resolved: true });
  expect(f.site.issues.find((i: Any) => i.key === "PAY-322").remoteLinks.filter((l: Any) => l.globalId === link.globalId).length).toBe(1);
  expect((await t.changelog!(["PAY-322"], ["status"])).every((h) => h.issueId === "10222" || h.items.length > 0)).toBe(true);
  expect(restPaths(f)).toEqual(expect.arrayContaining(["POST /rest/api/3/issue/PAY-322/remotelink", "POST /rest/api/3/changelog/bulkfetch"]));
});

test("behind MCP, discovery gets the site's resolutions and this person's permissions from REST (MCP can list neither)", async () => {
  const f = await rovo("cloud-jwm-noboard");
  const r = account(f, { token: "scoped" });
  await signIn(r);
  const d = await r.account.transport().discover("MKT");
  expect(d.resolutions.map((x) => x.name)).toEqual(f.site.resolutions.map((x: Any) => x.name));
  expect(d.permissions.sort()).toEqual([...f.site.permissions.MKT].filter((p: string) => ["BROWSE_PROJECTS", "TRANSITION_ISSUES", "ASSIGN_ISSUES", "ASSIGNABLE_USER", "ADD_COMMENTS", "EDIT_ISSUES", "LINK_ISSUES"].includes(p)).sort());
});
