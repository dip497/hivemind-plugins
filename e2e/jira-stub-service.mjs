// A stand-in for the Jira service in e2e, until the real one (src/service/, its own branch) lands:
// it answers the tile's commands (src/service/commands.ts) over the drive socket, as the real
// service does. "Sign in with Atlassian" is real against the fake Rovo MCP server — dynamic client
// registration, PKCE S256, a loopback listener, the code exchanged for a token, and the token used
// on an MCP tool call to learn who signed in. Discovery and pulls answer from the fixture site file,
// mapped as design §4.1 says; records go in through the drive's `issue.ingest`, and `configure`
// writes the person's edited workflow as workflow.yaml (JSON, which YAML reads). It reads
// `stub.json` beside it: `{ mcp, origin, site }`.
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "stub.json"), "utf8"));
const site = JSON.parse(fs.readFileSync(cfg.site, "utf8"));
const host = new URL(site.baseUrl).host;
const log = (...a) => console.log("[jira-stub]", ...a);
process.stdin.on("end", () => process.exit(0)).resume();

// ── the drive socket ─────────────────────────────────────────────
const sock = net.connect(process.env.HIVE_DRIVE_SOCK, () => { log("connected to the drive"); send({ hello: { token: process.env.HIVE_DRIVE_TOKEN } }); });
sock.on("error", (e) => log("drive error:", e.message));
sock.on("close", () => { log("the drive closed"); process.exit(1); });
const send = (m) => sock.write(JSON.stringify(m) + "\n");
let nextId = 0;
const waiting = new Map();
const drive = (method, ...params) => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  send({ id, method, params });
});
let workspace = null;
let buf = "";
sock.on("data", (d) => {
  buf += d;
  for (let i; (i = buf.indexOf("\n")) >= 0;) {
    const m = JSON.parse(buf.slice(0, i));
    if (m.error && !m.id) log("drive refused:", m.error.message);
    buf = buf.slice(i + 1);
    for (const e of Array.isArray(m) ? m : m.event ? [m] : []) if (e.event === "plugin.called") void answer(e.params[0]);
    if (Array.isArray(m) || m.event) continue;
    if (m.hello) {
      workspace = m.hello.as.workspace;
      send({ method: "plugin.serve", params: [Object.keys(COMMANDS).map((name) => ({ name, description: `jira stub: ${name}` }))] });
      log("serving", workspace);
    } else if (waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  }
});
async function answer({ call, command, args }) {
  try {
    send({ method: "plugin.answer", params: [call, { result: await COMMANDS[command](args ?? {}) }] });
  } catch (e) {
    send({ method: "plugin.answer", params: [call, { error: { code: e.code ?? "FAILED", message: e.message } }] });
  }
}

// ── Sign in with Atlassian, against the fake Rovo MCP ───────────
let token = null;
let me = null;
let calls = 0;
const b64url = (b) => b.toString("base64url");
async function signIn() {
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(12));
  const loop = http.createServer();
  await new Promise((r) => loop.listen(0, "127.0.0.1", r));
  const redirect = `http://127.0.0.1:${loop.address().port}/callback`;
  const reg = await fetch(`${cfg.origin}/fake-rovo-issuer/dcr/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Hivemind (jira stub)", redirect_uris: [redirect], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
  }).then((r) => r.json());
  if (!reg.client_id) throw new Error(`registration refused: ${JSON.stringify(reg)}`);
  loop.on("request", async (req, res) => {
    const q = new URL(req.url, redirect).searchParams;
    res.end("Signed in. You can close this page.");
    loop.close();
    if (q.get("state") !== state || !q.get("code")) return log("sign-in refused:", q.get("error"));
    const t = await fetch(`${cfg.origin}/oauth/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code: q.get("code"), redirect_uri: redirect, client_id: reg.client_id, code_verifier: verifier }),
    }).then((r) => r.json());
    if (!t.access_token) return log("token refused:", t.error);
    token = t.access_token;
    const info = JSON.parse((await tool("atlassianUserInfo", {})).content[0].text);
    me = (info.data ?? info).name;
    log("signed in as", me);
  });
  const u = new URL(`${cfg.origin}/authorize`);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: redirect, state, code_challenge: b64url(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256", scope: "read:jira-work read:me offline_access" })) u.searchParams.set(k, v);
  return u.toString();
}
let session = null;
async function rpc(method, params) {
  const r = await fetch(`${cfg.mcp}?tools=all`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++nextId, method, params }),
  });
  if (!session) session = r.headers.get("mcp-session-id");
  const body = await r.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
async function tool(name, args) {
  if (!session) await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hivemind-jira-stub", version: "0" } });
  calls++;
  return rpc("tools/call", { name, arguments: args });
}

// ── what the person set up ──────────────────────────────────────
let setup = null; // { project, boardId, scope, sprints, excludedTypes, push, workflow }
let lastSync = null;
const tracked = new Set();

const project = (key) => site.projects.find((p) => p.key === key);
const statusOf = (id) => site.statuses.find((s) => s.id === id);
const userOf = (accountId) => site.users.find((u) => u.accountId === accountId);
const typeOf = (id) => site.projects.flatMap((p) => p.issueTypes).find((t) => t.id === id);
const CANCELLED = /won.?t do|duplicate|cannot reproduce/i;

function discover({ project: key, boardId }) {
  const p = project(key);
  if (!p) throw Object.assign(new Error(`no project ${key} on ${host}`), { code: "NOT_FOUND" });
  const boards = site.boards.filter((b) => b.projectKey === key).map((b) => ({ id: b.id, name: b.name, type: b.type }));
  const board = site.boards.find((b) => b.id === (boardId ?? (boards.length === 1 ? boards[0].id : null)));
  const ids = [...new Set(p.issueTypes.flatMap((t) => site.workflows[t.workflow]?.statuses ?? []))];
  const onBoard = new Set(board?.columns.flatMap((c) => c.statuses) ?? []);
  const statuses = ids.map(statusOf).filter(Boolean).map((s) => {
    const cat = s.statusCategory.key;
    const category = cat === "new" ? (board && !onBoard.has(s.id) ? "backlog" : "todo")
      : cat === "done" ? (CANCELLED.test(s.name) ? "cancelled" : "done")
        : /review|qa|test/i.test(s.name) ? "in_review" : "in_progress";
    return { id: `jira:${s.id}`, name: s.name, category, source: "jira", jiraCategory: cat };
  });
  return {
    boards,
    proposal: {
      statuses,
      board: board ? { id: board.id, name: board.name, type: board.type, columns: board.columns.map((c) => ({ name: c.name, statuses: c.statuses.map((x) => `jira:${x}`) })) } : null,
      cancelledResolutions: site.resolutions.filter((r) => CANCELLED.test(r.name)).map((r) => r.name),
      resolutions: site.resolutions.map((r) => r.name),
      issueTypes: p.issueTypes.map((t) => ({ id: t.id, name: t.name })),
    },
  };
}

/** The issues a scope reaches now, as Jira would answer its JQL (design §7.1). */
function inScope(scope, s = setup) {
  const board = site.boards.find((b) => b.id === s?.boardId);
  const sprintOk = (i) => {
    if (board?.type !== "scrum") return true;
    const states = (i.sprints ?? []).map((id) => site.sprints.find((x) => x.id === id)?.state);
    const want = s?.sprints ?? "open";
    return states.includes("active") || (want !== "open" && states.includes("future")) || (want === "open+future+backlog" && !i.sprints?.length);
  };
  return site.issues.filter((i) => i.project === (s?.project ?? "PAY") && !i.deleted && !i.restricted && sprintOk(i)
    && !(s?.excludedTypes ?? []).includes(typeOf(i.issueType)?.name)
    && (scope.kind === "all" || scope.kind === "jql" || (scope.kind === "mine" ? i.assignee === site.myself : !i.assignee || i.assignee === site.myself)));
}

function record(i) {
  const wf = setup.workflow;
  const st = wf.statuses.find((s) => s.id === `jira:${i.status}`);
  const a = i.assignee ? userOf(i.assignee) : null;
  const sprint = (i.sprints ?? []).map((id) => site.sprints.find((x) => x.id === id)).find((x) => x && x.state !== "closed");
  return {
    external: {
      id: i.id, key: i.key, url: `${site.baseUrl}/browse/${i.key}`,
      type: { id: i.issueType, name: typeOf(i.issueType)?.name ?? i.issueType },
      assignee: a ? { accountId: a.accountId, name: a.displayName, me: a.accountId === site.myself } : null,
      ...(i.priority ? { priority: i.priority } : {}),
      ...(typeof i.estimate === "number" ? { estimate: i.estimate } : {}),
      ...(sprint ? { sprint: { id: sprint.id, name: sprint.name, state: sprint.state } } : {}),
      ...(i.parent ? { parentKey: i.parent } : {}),
      remoteUpdated: i.updated,
    },
    title: i.summary,
    description: typeof i.description === "string" ? i.description : "",
    status: { id: st.id, name: st.name, category: st.category },
    labels: i.labels ?? [],
  };
}

async function writeWorkflow() {
  const wf = setup.workflow;
  const yaml = {
    version: 1,
    statuses: wf.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category, source: s.source, ...(s.retired ? { retired: true } : {}), ...(s.source === "hive" ? { jira: !s.follow || s.follow === "stay" ? "stay" : { follow: s.follow } } : {}) })),
    ...(wf.board ? { board: { id: wf.board.id, type: wf.board.type, columns: wf.board.columns } } : {}),
  };
  fs.writeFileSync(path.join(workspace, ".hivemind", "workflow.yaml"), JSON.stringify(yaml, null, 2) + "\n");
}

const source = () => `jira:${host.split(".")[0]}/${setup.project}`;
async function pull(issues) {
  const r = await drive("issue.ingest", path.join(workspace, ".hivemind"), source(), issues.map(record));
  lastSync = new Date().toISOString();
  for (const id of [...r.created, ...r.updated, ...r.unchanged]) tracked.add(id);
  return { created: r.created, updated: r.updated, unchanged: r.unchanged.length, conflicts: r.conflicts.length, archived: r.archived };
}
const needSetup = () => { if (!setup) throw Object.assign(new Error("not set up yet"), { code: "BAD_REQUEST" }); };

function status() {
  return {
    connected: !!token, transport: token ? "mcp" : null, site: token ? host : undefined, me: me ?? undefined,
    ...(setup ? { project: setup.project, boardId: setup.boardId, scope: setup.scope, sprints: setup.sprints, excludedTypes: setup.excludedTypes, push: setup.push } : {}),
    lastSync: lastSync ?? undefined,
    nextSync: lastSync ? new Date(Date.parse(lastSync) + 120_000).toISOString() : undefined,
    counts: setup ? { mirrored: tracked.size, conflicts: 0, archived: 0 } : undefined,
    budget: { used: calls, limit: 400 },
    problems: setup && !token ? ["sign in again"] : [],
  };
}

const COMMANDS = {
  status,
  "sign-in": async () => ({ authorizeUrl: await signIn() }),
  "sign-out": () => { token = null; me = null; session = null; return { ok: true }; },
  projects: () => ({ projects: site.projects.map((p) => ({ key: p.key, name: p.name })) }),
  discover,
  configure: async (a) => {
    setup = { project: a.project, boardId: a.boardId, scope: a.scope, sprints: a.sprints ?? "open", excludedTypes: a.excludedTypes ?? [], push: a.push, workflow: a.workflow ?? discover(a).proposal };
    await writeWorkflow();
    const firstSync = await pull(inScope(setup.scope));
    return { ...status(), firstSync };
  },
  mapping: () => { needSetup(); return setup.workflow; },
  "set-mapping": async ({ workflow }) => { needSetup(); setup.workflow = workflow; await writeWorkflow(); return workflow; },
  "set-scope": (a) => { needSetup(); Object.assign(setup, { scope: a.scope, sprints: a.sprints ?? setup.sprints, excludedTypes: a.excludedTypes ?? setup.excludedTypes }); return status(); },
  "sync-now": () => { needSetup(); return pull([...inScope(setup.scope), ...site.issues.filter((i) => tracked.has(i.key))].filter((i, n, all) => all.indexOf(i) === n)); },
  browse: (a) => {
    const list = inScope(a.scope ?? { kind: "all" }, { ...(setup ?? {}), project: setup?.project ?? "PAY", boardId: setup?.boardId });
    return { issues: list.map((i) => ({ key: i.key, summary: i.summary, status: statusOf(i.status)?.name ?? i.status, assignee: i.assignee ? userOf(i.assignee)?.displayName ?? null : null, tracked: tracked.has(i.key) })), total: list.length };
  },
  track: async ({ key }) => { needSetup(); const i = site.issues.find((x) => x.key === key); await pull([i]); return { id: key }; },
  refresh: async ({ key }) => COMMANDS.track({ key }),
  "assign-me": () => { throw Object.assign(new Error("assign-me arrives with push (P3)"), { code: "UNSUPPORTED" }); },
  conflicts: () => [],
  resolve: () => ({ ok: true }),
};
