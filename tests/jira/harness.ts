// What the Jira service's tests stand on: the app's fake Rovo MCP server and fake Jira REST API over
// its Cloud fixture sites (packages/jira-fake), a workspace in a temp folder written by the app's
// own ingest, and an Account signed in through the real loopback sign-in or connected with the
// fake's API token. Every fetch an Account makes is held to this machine: no test reaches Atlassian.
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP, core } from "../app";
import { Account, DEFAULT_OPTIONS, type Options } from "../../tools/jira/src/service/account";
import { RestLimits } from "../../tools/jira/src/service/rest/limits";
import { Workspace } from "../../tools/jira/src/service/workspace";
import type { Host } from "../../tools/jira/src/service/engine/sync";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fakePkg: any = await import(path.join(APP, "packages/jira-fake/src/index.ts"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeRovoMcp = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeJira = any;
export const loadSite = (name: string) => fakePkg.loadSite(name);

/** fetch, refusing any host but this machine's: a site name in a test never reaches the real Atlassian. */
export const localOnly = (async (input: string | URL | Request, init?: RequestInit) => {
  const u = new URL(input instanceof Request ? input.url : String(input));
  if (u.hostname !== "127.0.0.1") throw new Error(`a test reached for ${u.host}`);
  return fetch(input, init);
}) as typeof fetch;

/** A fake Jira REST API over a fresh copy of the site, its scripted faults off unless kept. */
export async function jira(name: string, opts: Record<string, unknown> = {}, keepFaults = false): Promise<FakeJira> {
  const site = fakePkg.loadSite(name);
  const f = await fakePkg.createFakeJira(keepFaults ? site : { ...site, faults: [] }, opts);
  cleanup.push(() => f.close());
  return f;
}

export const CLOUD = ["cloud-scrum-company", "cloud-kanban-team", "cloud-jwm-noboard"] as const;
export const ME = "5b10ac8d82e05b22cc7d4ef5";
export const JANE = "5b10a2844c20165700ede21g";

const { ingestRecords } = await core("ingest.ts");
const { listIssues, writeConfig, updateIssue, WORKSPACE_FORMAT } = await core("storage.ts");
export const { parseWorkflow } = await core("workflow.ts");
export { listIssues };

const cleanup: (() => Promise<void> | void)[] = [];
export async function closeAll(): Promise<void> {
  for (const c of cleanup.splice(0).reverse()) await c();
}

/** A fake Rovo MCP server over a fresh copy of the site, its scripted faults off. */
export async function rovo(name: string, opts: Record<string, unknown> = {}): Promise<FakeRovoMcp> {
  const site = fakePkg.loadSite(name);
  const f = await fakePkg.createFakeRovoMcp({ ...site, faults: [] }, opts);
  cleanup.push(() => f.close());
  return f;
}

/** A workspace folder with `.hivemind/config.yaml` (prefix HM). */
export async function workspaceDir(): Promise<{ repo: string; root: string }> {
  const repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), "jira-svc-")));
  const root = path.join(repo, ".hivemind");
  mkdirSync(path.join(root, "issues"), { recursive: true });
  await writeConfig(root, { prefix: "HM", next_id: 1, agents: {}, format: WORKSPACE_FORMAT });
  cleanup.push(() => rmSync(repo, { recursive: true, force: true }));
  return { repo, root };
}

/** hive, as the service reaches it over the drive, here through core directly. */
export function coreHost(root: string): Host & { calls: { ingest: number } } {
  const calls = { ingest: 0 };
  return {
    calls,
    ingest: (source, records) => { calls.ingest++; return ingestRecords(root, source, records); },
    list: async () => (await listIssues(root)).map((i: { id: string; title: string; status?: string; state: string }) => ({ id: i.id, title: i.title, status: i.status, state: i.state })),
    setStatus: async (id, status) => { await updateIssue(root, id, { status }); },
  };
}

export interface Secrets {
  values: Map<string, string>;
  get(name: string): Promise<string | null>;
  set(name: string, value: string | null): Promise<void>;
}
export function memorySecrets(): Secrets {
  const values = new Map<string, string>();
  return {
    values,
    get: async (n) => values.get(n) ?? null,
    set: async (n, v) => { if (v === null) values.delete(n); else values.set(n, v); },
  };
}

export interface Rig {
  f: FakeRovoMcp;
  account: Account;
  secrets: Secrets;
  logs: string[];
}

/** An Account against `f`, with the lines it logs kept. `token` also gives it the fake's API token
 *  (and the site's cloud ID), which serves what MCP can't. */
export function account(f: FakeRovoMcp, o: { options?: Partial<Options>; secrets?: Secrets; fetch?: typeof fetch; now?: () => number; token?: "scoped" | "classic"; limits?: RestLimits } = {}): Rig {
  const logs: string[] = [];
  const secrets = o.secrets ?? memorySecrets();
  if (o.token) secrets.values.set("apiToken", o.token === "scoped" ? f.jira.credentials.scopedToken : f.jira.credentials.classicToken);
  const a = new Account({
    secrets,
    options: { ...DEFAULT_OPTIONS, site: new URL(f.site.baseUrl).host, ...(o.token ? { email: f.jira.credentials.email, cloudId: f.site.cloudId } : {}), ...o.options },
    log: (m, d) => logs.push(`${m}${d === undefined ? "" : ` ${d instanceof Error ? d.message : JSON.stringify(d)}`}`),
    mcpUrl: `${f.url}?tools=all`,
    restApiBase: f.jira.url,
    fetch: o.fetch ?? localOnly,
    ...(o.now ? { now: o.now } : {}),
    ...(o.limits ? { restLimits: o.limits } : {}),
  });
  cleanup.push(() => a.close());
  return { f, account: a, secrets, logs };
}

/** An Account connecting to the fake Jira `j` with its API token (Connect with: API token). The
 *  site is the fake's URL, where tenant_info is; the gateway is the fake too. */
export function restAccount(j: FakeJira, o: { options?: Partial<Options>; secrets?: Secrets; fetch?: typeof fetch; token?: "scoped" | "classic"; limits?: RestLimits } = {}): Rig {
  const logs: string[] = [];
  const secrets = o.secrets ?? memorySecrets();
  secrets.values.set("apiToken", o.token === "classic" ? j.credentials.classicToken : j.credentials.scopedToken);
  const a = new Account({
    secrets,
    options: { ...DEFAULT_OPTIONS, transport: "rest", site: j.url, email: j.credentials.email, ...o.options },
    log: (m, d) => logs.push(`${m}${d === undefined ? "" : ` ${d instanceof Error ? d.message : JSON.stringify(d)}`}`),
    restApiBase: j.url,
    fetch: o.fetch ?? localOnly,
    ...(o.limits ? { restLimits: o.limits } : {}),
  });
  cleanup.push(() => a.close());
  return { f: j, account: a, secrets, logs };
}

/** Sign in as the person would: open the page (the fake consents), the browser lands on the loopback. */
export async function signIn(r: Rig): Promise<URL> {
  await r.account.init();
  const { authorizeUrl } = await r.account.signIn();
  await fetch(authorizeUrl);
  await r.account.signInDone();
  return new URL(authorizeUrl);
}

/** A signed-in account on `site`, and a workspace linked to its project through `configure`. */
export async function linked(site: string, o: { kind?: "mcp" | "rest"; token?: "scoped" | "classic"; scope?: unknown; boardId?: number; fake?: Record<string, unknown>; options?: Partial<Options>; sprints?: string; now?: () => number; fetch?: typeof fetch; limits?: RestLimits; before?: (f: FakeRovoMcp) => void } = {}) {
  // Over REST, `f` is the fake Jira itself; over MCP, the Rovo fake (its Jira is `f.jira`).
  const f = o.kind === "rest" ? await jira(site, o.fake) : await rovo(site, o.fake);
  o.before?.(f);
  const extra = { ...(o.fetch ? { fetch: o.fetch } : {}), ...(o.limits ? { limits: o.limits } : {}) };
  const r = o.kind === "rest"
    ? restAccount(f, { options: o.options, ...extra, ...(o.token ? { token: o.token } : {}) })
    : account(f, { options: o.options, ...extra, ...(o.now ? { now: o.now } : {}), ...(o.token ? { token: o.token } : {}) });
  if (o.kind === "rest") await r.account.init();
  else await signIn(r);
  const { repo, root } = await workspaceDir();
  const host = coreHost(root);
  const w = new Workspace({ repo, account: r.account, host, log: (m) => r.logs.push(m), poll: false, firstSyncWaitMs: 60_000, ...(o.now ? { now: o.now } : {}) });
  const project = f.site.projects[0].key as string;
  const configured = await w.handle("configure", { project, scope: o.scope ?? { kind: "mine" }, push: "status", ...(o.boardId !== undefined ? { boardId: o.boardId } : {}), ...(o.sprints ? { sprints: o.sprints } : {}) }) as { firstSync?: { created: string[] } };
  return { f, r, w, repo, root, host, project, configured };
}

/** The tool calls the fake saw, by name. */
export const toolCalls = (f: FakeRovoMcp, name?: string): { tool: string; args: Record<string, unknown>; isError: boolean; credits: number }[] =>
  f.requests.filter((x: { kind: string; tool?: string }) => x.kind === "tool" && (!name || x.tool === name));

/** The keys mirrored in the workspace, archived or not. */
export async function mirrored(root: string): Promise<{ id: string; archived: string | null; status?: string; state: string }[]> {
  return (await listIssues(root, { archived: true })).map((i: { id: string; status?: string; state: string; external?: { archived?: { reason: string } | null } }) => ({ id: i.id, archived: i.external?.archived?.reason ?? null, status: i.status, state: i.state })).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, "en", { numeric: true }));
}
