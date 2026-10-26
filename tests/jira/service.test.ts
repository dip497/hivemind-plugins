// The built service (tools/jira/service.mjs, one file) as the host runs it: a node child holding a
// tool plugin's drive grant, on the app's own drive socket, workspace API and plugin services, with
// the fake Rovo MCP server as Atlassian. It is what the person's tile and `hive ctl plugin call`
// reach, so this is the one place the service's wiring is checked: its commands registered, the
// sign-in kept through `secret.set`, and issues written through `issue.ingest`.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP, ROOT, core } from "../app";
import { rovo, type FakeRovoMcp } from "./harness";
import { COMMANDS } from "../../tools/jira/src/service/workspace";

const mod = (p: string) => import(path.join(APP, p));
const { serveDrive } = await mod("packages/host/src/drive.ts");
const { Grants } = await mod("packages/host/src/grants.ts");
const { PluginServices } = await mod("packages/host/src/plugin-services.ts");
const { Secrets } = await mod("packages/host/src/secrets.ts");
const { workspaceDomains } = await mod("packages/host/src/domains.ts");
const { WorkspaceServer } = await mod("packages/workspace-api/src/server.ts");
const { Intents } = await mod("packages/workspace-host/src/intents.ts");
const { AuditLog } = await mod("packages/workspace-host/src/audit-log.ts");
const { writeConfig, readIssue, WORKSPACE_FORMAT } = await core("storage.ts");

const PLUGIN = "@dip497/jira";
const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "jira-service-")));
const repo = path.join(tmp, "ws");
const root = path.join(repo, ".hivemind");
const sock = path.join(tmp, "drive.sock");
const audit = path.join(tmp, "audit.jsonl");
let f: FakeRovoMcp;
let child: ChildProcess;
let out = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let plugins: any, secrets: any, drive: any, grantId: string;

beforeAll(async () => {
  // What ships: build it as HiveHub would list it.
  const built = spawnSync("node", ["build.mjs"], { cwd: ROOT, encoding: "utf8" });
  if (built.status !== 0) throw new Error(`build failed: ${built.stderr}`);
  mkdirSync(path.join(root, "issues"), { recursive: true });
  await writeConfig(root, { prefix: "HM", next_id: 1, agents: {}, format: WORKSPACE_FORMAT });
  f = await rovo("cloud-scrum-company");
  const grants = new Grants(path.join(tmp, "grants.json"));
  secrets = new Secrets(path.join(tmp, "secrets.json"));
  const manifest = JSON.parse(readFileSync(path.join(ROOT, "tools/jira/hivemind-tool.json"), "utf8")) as { settings: { id: string; type: string; default?: unknown }[] };
  plugins = new PluginServices({
    pluginOfGrant: (id: string) => grants.list().find((g: { id: string }) => g.id === id)?.plugin,
    options: async (p: string) => ({ values: { ...Object.fromEntries(manifest.settings.filter((s) => s.type !== "secret").map((s) => [s.id, s.default])), site: "acme.atlassian.net" }, secrets: secrets.names(`tool:${p}`) }),
    secret: (p: string, n: string) => secrets.get(`tool:${p}`, n),
    setSecret: (k: string, n: string, v: string | null) => secrets.set(k, n, v),
    secretFields: async (p: string) => (p === PLUGIN ? manifest.settings.filter((s) => s.type === "secret").map((s) => s.id) : []),
  });
  const server = new WorkspaceServer([...workspaceDomains(), plugins.domain()], new Intents(new AuditLog({ file: audit })));
  drive = serveDrive(sock, { server, installToken: () => "install-token", grants, repos: () => [repo], workspaceOf: () => null, nameOf: (t: string) => t });
  await drive.serving;
  const g = grants.create({ name: `${PLUGIN} (service)`, repos: [repo], role: "edit" }, PLUGIN);
  grantId = g.grant.id;
  child = spawn("node", [path.join(ROOT, "tools/jira/service.mjs")], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, HIVE_DRIVE_SOCK: sock, HIVE_DRIVE_TOKEN: g.token, HIVE_WORKSPACES: repo, HIVE_JIRA_MCP_URL: `${f.url}?tools=all`, HIVE_JIRA_REST_URL: f.jira.url },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  for (let i = 0; i < 400 && !plugins.serves(PLUGIN, "status"); i++) await Bun.sleep(25);
  if (!plugins.serves(PLUGIN, "status")) throw new Error(`the service never served its commands:\n${out}`);
}, 60_000);

afterAll(async () => {
  child?.stdin?.end();
  await new Promise((r) => (child?.exitCode !== null ? r(null) : child.once("exit", r)));
  drive?.close();
  await f?.close();
  rmSync(tmp, { recursive: true, force: true });
});

const call = (command: string, args: unknown = {}) => plugins.call(PLUGIN, command, args, 60_000);

test("the built service registers every command of the contract, by the names the host takes", () => {
  const served = plugins.commands().find((p: { plugin: string }) => p.plugin === PLUGIN).commands.map((c: { name: string }) => c.name);
  expect(served).toEqual(COMMANDS.map((c) => c.name));
  expect(served).toEqual(expect.arrayContaining(["status", "sign-in", "sign-out", "projects", "discover", "configure", "mapping", "set-mapping", "set-scope", "sync-now", "browse", "track", "refresh", "assign-me", "conflicts", "resolve"]));
});

test("signed out it says so; signing in through the loopback keeps the sign-in in its own secret, set by the service itself; then it links, pulls and writes issues through ingest", async () => {
  expect(await call("status")).toMatchObject({ connected: false, transport: "mcp", problems: ["not signed in: Sign in with Atlassian", expect.stringMatching(/^not linked/)] });
  const { authorizeUrl } = await call("sign-in") as { authorizeUrl: string };
  await fetch(authorizeUrl);
  for (let i = 0; i < 200 && !secrets.names(`tool:${PLUGIN}`).includes("mcpAuth"); i++) await Bun.sleep(25);
  const kept = JSON.parse(secrets.get(`tool:${PLUGIN}`, "mcpAuth"));
  const sets = readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verb === "secret.set");
  expect(sets.map((r) => [r.actor.person, r.target, r.outcome])).toEqual([[`client:${grantId}`, `tool:${PLUGIN}.mcpAuth`, "ok"]]);
  expect(readFileSync(audit, "utf8")).not.toContain(kept.tokens.access_token);

  // Before anything is linked, for the wizard: who signed in where, and what a scope would pull,
  // with nothing written.
  let st: { site?: string; me?: string } = {};
  for (let i = 0; i < 200 && !st.me; i++) { st = await call("status") as typeof st; if (!st.me) await Bun.sleep(25); }
  expect([st.site, st.me]).toEqual(["acme.atlassian.net", "Ujjwal Solanki"]);
  const preview = await call("browse", { project: "PAY", scope: { kind: "mine" } }) as { total?: number; issues: { key: string }[] };
  expect([preview.total, preview.issues.map((i) => i.key).sort()]).toEqual([5, ["PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]]);
  expect(readdirSync(root)).not.toContain("workflow.yaml");
  await expect(call("browse", { scope: { kind: "mine" } })).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect((await call("projects")) as unknown).toEqual({ projects: [{ key: "PAY", name: "Payments" }] });
  const configured = await call("configure", { project: "PAY", scope: { kind: "mine" }, push: "status" }) as { connected: boolean; project: string; firstSync: { created: string[] } };
  expect([configured.connected, configured.project, [...configured.firstSync.created].sort()]).toEqual([true, "PAY", ["PAY-322", "PAY-323", "PAY-324", "PAY-328", "PAY-330"]]);
  expect(readdirSync(path.join(root, "mirror", "jira-acme-PAY")).sort()).toEqual(["PAY-322.md", "PAY-323.md", "PAY-324.md", "PAY-328.md", "PAY-330.md"]);
  const issue = await readIssue(root, "PAY-324");
  expect([issue.status, issue.state, issue.external.source]).toEqual(["jira:10003", "in_review", "jira:acme/PAY"]);
  // A command's refusal comes back in the host's words.
  await expect(call("refresh", { key: "PAY-999" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(call("assign-me", { key: "PAY-322" })).rejects.toMatchObject({ code: "UNSUPPORTED" });
}, 60_000);

test("its log, which the host keeps as raw stdout, holds no credential", () => {
  const kept = JSON.parse(secrets.get(`tool:${PLUGIN}`, "mcpAuth"));
  expect(out).toContain("[jira] signed in to Atlassian");
  for (const s of [kept.tokens.access_token, kept.tokens.refresh_token]) expect(out).not.toContain(s);
});

test("connecting with an API token: test-connection keeps nothing; sign-in keeps the token and the connection as the service's own secrets, audited without their values, and the token syncs from then on", async () => {
  const token = f.jira.credentials.scopedToken;
  const ask = { site: f.jira.url, email: f.jira.credentials.email, apiToken: token, project: "PAY" };
  expect(await call("test-connection", ask)).toMatchObject({ via: "gateway", cloudId: f.site.cloudId, missingScopes: [] });
  expect(secrets.names(`tool:${PLUGIN}`)).toEqual(["mcpAuth"]);
  expect(await call("sign-in", { transport: "rest", ...ask })).toMatchObject({ via: "gateway", cloudId: f.site.cloudId });
  expect(secrets.names(`tool:${PLUGIN}`).sort()).toEqual(["apiToken", "mcpAuth", "restAuth"]);
  expect(secrets.get(`tool:${PLUGIN}`, "apiToken")).toBe(token);
  const sets = readFileSync(audit, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verb === "secret.set").map((r) => r.target);
  expect(sets).toEqual([`tool:${PLUGIN}.mcpAuth`, `tool:${PLUGIN}.apiToken`, `tool:${PLUGIN}.restAuth`]);
  const before = f.jira.requests.length;
  expect(await call("status")).toMatchObject({ connected: true, transport: "rest", served: { jqlParse: "rest", adf: "rest" } });
  await call("sync-now");
  expect(f.jira.requests.slice(before).some((r: { path: string }) => r.path === "/rest/api/3/search/jql")).toBe(true);
  const basic = Buffer.from(`${f.jira.credentials.email}:${token}`).toString("base64");
  for (const s of [token, basic]) { expect(out).not.toContain(s); expect(readFileSync(audit, "utf8")).not.toContain(s); }
}, 60_000);
