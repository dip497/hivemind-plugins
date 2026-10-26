// `JiraTransport` over Jira Cloud's REST API with the person's API token (design jira-sync §9.0,
// §9.1): Basic `email:token` against `https://api.atlassian.com/ex/jira/{cloudId}`, where a scoped
// token works (the site URL refuses one). The cloudId comes from the site's `/_edge/tenant_info`,
// or from the person when that can't be read. A classic (unscoped) token is refused by the gateway
// and works on the site URL, so a 401 there is tried once against the site before it counts as
// wrong credentials.
//
// Everything the contract names is here: search with fields and entity properties, bulkfetch with
// `issueErrors`, `jql/parse`, the bulk changelog, `/field`, the remote-link upsert by `globalId`,
// and the admin workflow graph when this person may read it (a 401/403 there means "no", never
// "bad credentials"). Rich text arrives as ADF and leaves here as markdown (richtext.ts); comments
// go up as ADF. Every request goes through the REST limits (rest/limits.ts).
import { remember } from "../log.js";
import type { Logger } from "../log.js";
import { adfToMarkdown, markdownToAdf } from "../richtext.js";
import {
  TransportError, type Capabilities, type ChangeHistory, type Discovered, type JiraTransport, type Page, type RawComment, type RawIssue,
  type RemoteLink, type Transition, type WorkflowGraph,
} from "../transport.js";
import type { RestLimits } from "./limits.js";
import {
  BoardConfigZ, BoardsZ, BulkZ, ChangelogZ, CommentZ, CommentsZ, CountZ, ErrorBodyZ, FeaturesZ, FieldsZ, FilterZ, IssueTypesZ, IssueZ, MyselfZ,
  ParseZ, PermissionsZ, ProjectStatusesZ, PropertyZ, ProjectsZ, ResolutionsZ, SearchZ, ServerInfoZ, SprintsZ, TenantZ, TransitionsZ, WorkflowsZ,
} from "./schemas.js";
import type { z } from "zod";
import { prettifyError } from "zod";

export const DEFAULT_API_BASE = "https://api.atlassian.com";

/** Search pages: Jira answers at most 100 issues with fields. */
const PAGE = 100;
/** Bulkfetch: 100 per call with multi-value fields (labels, components) in `fields`. */
const BULK = 100;
/** The permissions that decide which actions the tile offers (design §6.1). */
const PERMISSIONS = ["BROWSE_PROJECTS", "TRANSITION_ISSUES", "ASSIGN_ISSUES", "ASSIGNABLE_USER", "ADD_COMMENTS", "EDIT_ISSUES", "LINK_ISSUES"];

/** The granular scopes each Agile call needs (P-R, the Software spec): Agile takes no classic scope. */
export const AGILE_SCOPES = {
  boards: ["read:board-scope:jira-software", "read:project:jira"],
  boardConfig: ["read:board-scope.admin:jira-software", "read:project:jira"],
  sprints: ["read:sprint:jira-software"],
} as const;

export interface RestTransportOptions {
  /** The person's site: `acme.atlassian.net` (https assumed) or a URL. */
  site: string;
  email: string;
  token: string;
  /** The person's cloudId, when the site's tenant_info can't be read. */
  cloudId?: string;
  /** Where `/ex/jira/{cloudId}` is: Atlassian's API host unless a test points elsewhere. */
  apiBase?: string;
  limits: RestLimits;
  log: Logger;
  fetch?: typeof fetch;
  /** Told when Jira refuses the credentials themselves (not a scope, not a permission). */
  onRefused?: (why: string) => void;
}

/** Where requests go, and how the token was taken. */
export interface Connection {
  cloudId: string;
  base: string;
  /** `gateway` for a scoped token, `site` for a classic one. */
  via: "gateway" | "site";
}

export const origin = (site: string) => {
  const s = site.trim().replace(/\/+$/, "");
  return s.includes("://") ? s : `https://${s}`;
};
const host = (url: string) => {
  try { return new URL(origin(url)).host.toLowerCase(); } catch { return url.toLowerCase(); }
};
const enc = encodeURIComponent;

interface Ask<S extends z.ZodType> {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  schema?: S;
  /** The endpoint as a template, for the limits and messages. */
  endpoint: string;
  idempotent?: boolean;
  /** The issue a write changes. */
  issue?: string;
  /** Statuses that are answers, not failures (an admin endpoint's 401 means "no"). */
  accept?: number[];
  /** What this call is, in the person's words, for a missing scope. */
  scopes?: readonly string[];
}

export class RestTransport implements JiraTransport {
  readonly kind = "rest" as const;
  private conn?: Promise<Connection>;
  private info?: { cloudId: string; siteUrl: string };
  /** Learned at discovery: whether this person may read the workflows (admin-gated). */
  private graph = false;
  private readonly auth: string;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly o: RestTransportOptions) {
    this.auth = `Basic ${Buffer.from(`${o.email}:${o.token}`).toString("base64")}`;
    remember(o.token);
    remember(this.auth.slice(6));
    this.fetchFn = o.fetch ?? fetch;
  }

  get capabilities(): Capabilities {
    return { workflowGraph: this.graph, changelog: true, adf: true, fieldsMeta: true, agile: true, entityProps: true, jqlParse: true, remoteLinkUpsert: true, push: true };
  }

  // ── the connection ──────────────────────────────────────────────────────────────────────────

  /** The site's cloudId: the person's, else its `/_edge/tenant_info`. */
  async cloudId(): Promise<string> {
    if (this.o.cloudId?.trim()) return this.o.cloudId.trim();
    const url = `${origin(this.o.site)}/_edge/tenant_info`;
    let why: string;
    try {
      const res = await this.fetchFn(url, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const t = TenantZ.safeParse(await res.json().catch(() => undefined));
        if (t.success) return t.data.cloudId;
        why = "it answered no cloudId";
      } else why = `it answered ${res.status}`;
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    throw new TransportError("not-found", `couldn't look up ${host(this.o.site)}'s cloud ID (${why}): paste it in the Jira settings (Cloud ID), from https://${host(this.o.site)}/_edge/tenant_info`);
  }

  /** Where requests go: the gateway for a scoped token; the site for a classic one the gateway refused. */
  connection(): Promise<Connection> {
    this.conn ??= this.connect().catch((e: unknown) => { this.conn = undefined; throw e; });
    return this.conn;
  }

  private async connect(): Promise<Connection> {
    const cloudId = await this.cloudId();
    const gateway: Connection = { cloudId, base: `${(this.o.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "")}/ex/jira/${cloudId}`, via: "gateway" };
    const ask = { endpoint: "GET /rest/api/3/myself" };
    const first = await this.send(gateway, "GET", "/rest/api/3/myself", ask);
    if (first.ok) { await first.body?.cancel().catch(() => {}); return gateway; }
    if (first.status !== 401 && first.status !== 404) throw await this.failure(first, ask);
    const firstWhy = await this.why(first);
    // A classic token: refused by the gateway, taken by the site.
    const site: Connection = { cloudId, base: origin(this.o.site), via: "site" };
    const second = await this.send(site, "GET", "/rest/api/3/myself", ask).catch(() => undefined);
    await second?.body?.cancel().catch(() => {});
    if (second?.ok) return site;
    if (first.status === 404) throw new TransportError("not-found", `Atlassian has no Jira site with cloud ID ${cloudId}: check the Cloud ID in the Jira settings`);
    const why = `Atlassian refused the API token for ${this.o.email} on ${host(this.o.site)} (${firstWhy}): check the email and the token, or create a new one (tokens expire)`;
    this.o.onRefused?.(why);
    throw new TransportError("auth", why);
  }

  /** The site's cloudId and its URL (as Jira names it, for links). */
  async site(): Promise<{ cloudId: string; siteUrl: string }> {
    if (this.info) return this.info;
    const { cloudId } = await this.connection();
    const s = await this.get("/rest/api/2/serverInfo", ServerInfoZ, "GET /rest/api/2/serverInfo");
    // v3 always says Cloud; v2 says what it is (design §6.1).
    if (s.deploymentType && s.deploymentType !== "Cloud") throw new TransportError("invalid", `${host(this.o.site)} is Jira ${s.deploymentType}: the Jira service syncs Jira Cloud only for now`);
    this.info = { cloudId, siteUrl: s.baseUrl.replace(/\/$/, "") };
    return this.info;
  }

  /** Who the token speaks for. */
  async me(): Promise<{ accountId: string; displayName: string }> {
    const m = await this.get("/rest/api/3/myself", MyselfZ, "GET /rest/api/3/myself");
    return { accountId: m.accountId, displayName: m.displayName };
  }

  /** Who the token speaks for (its display name). */
  async discoverMe(): Promise<string> {
    return (await this.get("/rest/api/3/myself", MyselfZ, "GET /rest/api/3/myself")).displayName;
  }

  /** The granular scopes the token lacks for the board calls (named at sign-in, design §9.1): the
   *  board list, a board's configuration, a Scrum board's sprints. Empty when nothing is missing. */
  async missingScopes(project?: string): Promise<string[]> {
    const missing = new Set<string>();
    // A call that worked proves its scopes: they aren't named for another that failed.
    const have = new Set<string>();
    const run = async <T>(call: () => Promise<T>, scopes: readonly string[]): Promise<T | undefined> => {
      try {
        const r = await call();
        for (const s of scopes) have.add(s);
        return r;
      } catch (e) {
        if (!(e instanceof TransportError && e.kind === "forbidden" && /scope/i.test(e.message))) throw e;
        for (const s of scopes) missing.add(s);
        return undefined;
      }
    };
    const page = await run(() => this.get("/rest/agile/1.0/board", BoardsZ, "GET /rest/agile/1.0/board", { query: { maxResults: 1, ...(project ? { projectKeyOrId: project } : {}) }, scopes: AGILE_SCOPES.boards }), AGILE_SCOPES.boards);
    const board = page?.values[0];
    if (board) {
      await run(() => this.get(`/rest/agile/1.0/board/${board.id}/configuration`, BoardConfigZ, "GET /rest/agile/1.0/board/{id}/configuration", { scopes: AGILE_SCOPES.boardConfig }), AGILE_SCOPES.boardConfig);
      if (board.type === "scrum") await run(() => this.get(`/rest/agile/1.0/board/${board.id}/sprint`, SprintsZ, "GET /rest/agile/1.0/board/{id}/sprint", { query: { maxResults: 1 }, scopes: AGILE_SCOPES.sprints }), AGILE_SCOPES.sprints);
    } else if (!page) {
      // No board list, so no board to ask further: a board's configuration and sprints need theirs too.
      for (const s of [...AGILE_SCOPES.boardConfig, ...AGILE_SCOPES.sprints]) missing.add(s);
    }
    return [...missing].filter((s) => !have.has(s));
  }

  // ── requests ────────────────────────────────────────────────────────────────────────────────

  private send(c: Connection, method: string, path: string, a: Omit<Ask<z.ZodType>, "schema">): Promise<Response> {
    const q = Object.entries(a.query ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => `${enc(k)}=${enc(String(v))}`).join("&");
    const url = `${c.base}${path}${q ? `?${q}` : ""}`;
    const headers: Record<string, string> = { Authorization: this.auth, Accept: "application/json" };
    if (a.body !== undefined) headers["Content-Type"] = "application/json";
    return this.o.limits.run(
      { endpoint: a.endpoint, idempotent: a.idempotent ?? method === "GET", ...(a.issue ? { issue: a.issue } : {}) },
      () => this.fetchFn(url, { method, headers, ...(a.body !== undefined ? { body: JSON.stringify(a.body) } : {}) }).catch((e: unknown) => {
        throw new TransportError("unavailable", `${a.endpoint}: Jira didn't answer (${e instanceof Error ? e.message : String(e)})`);
      }),
    );
  }

  /** Jira's own words for a refusal. */
  private async why(res: Response): Promise<string> {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    try { body = JSON.parse(text); } catch { /* text */ }
    const e = ErrorBodyZ.safeParse(body);
    const words = e.success ? [...(e.data.errorMessages ?? []), ...Object.entries(e.data.errors ?? {}).map(([k, v]) => `${k}: ${v}`), ...(e.data.message ? [e.data.message] : [])] : [];
    return (words.join("; ") || (typeof body === "string" ? body : "") || `HTTP ${res.status}`).slice(0, 300);
  }

  private async failure(res: Response, a: Ask<z.ZodType>): Promise<TransportError> {
    const text = await res.text().catch(() => "");
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = text; }
    const e = ErrorBodyZ.safeParse(body);
    const words = e.success ? [...(e.data.errorMessages ?? []), ...(e.data.message ? [e.data.message] : [])].join("; ") : typeof body === "string" ? body.slice(0, 300) : "";
    const fieldErrors = e.success && e.data.errors && Object.keys(e.data.errors).length ? e.data.errors : undefined;
    const at = `${a.endpoint}: ${words || Object.entries(fieldErrors ?? {}).map(([k, v]) => `${k}: ${v}`).join("; ") || `HTTP ${res.status}`}`;
    switch (res.status) {
      case 401:
        // A token without the scope this call needs: Jira says only "scope does not match".
        if (/scope does not match/i.test(words)) return new TransportError("forbidden", `the API token lacks a scope ${a.endpoint} needs${a.scopes ? `: add ${a.scopes.join(", ")} to it` : ""} (${words})`);
        this.o.onRefused?.(`Atlassian refused the API token (${words || "401"}): check the email and the token, or create a new one (tokens expire)`);
        return new TransportError("auth", `${at}: the API token was refused; check the email and the token, or create a new one (tokens expire)`);
      case 403: return new TransportError("forbidden", at);
      case 404: return new TransportError("not-found", at);
      case 409: return new TransportError("conflict", at, undefined, fieldErrors, res.status);
      case 410: return new TransportError("unavailable", `${at} (Atlassian removed this API)`);
      case 400: case 413: case 422: return new TransportError("invalid", at, undefined, fieldErrors, res.status);
      default: return new TransportError("unavailable", at);
    }
  }

  private async request<S extends z.ZodType>(method: string, path: string, a: Ask<S> & { schema: S }): Promise<z.infer<S>>;
  private async request(method: string, path: string, a: Ask<z.ZodType>): Promise<unknown>;
  private async request(method: string, path: string, a: Ask<z.ZodType>): Promise<unknown> {
    const res = await this.send(await this.connection(), method, path, a);
    if (!res.ok) {
      if (a.accept?.includes(res.status)) { await res.body?.cancel().catch(() => {}); return undefined; }
      throw await this.failure(res, a);
    }
    if (res.status === 204 || !a.schema) { await res.body?.cancel().catch(() => {}); return undefined; }
    const body = await res.json().catch(() => undefined);
    const parsed = a.schema.safeParse(body);
    if (!parsed.success) throw new TransportError("invalid", `${a.endpoint} answered in a shape the Jira service doesn't read: ${prettifyError(parsed.error)}`);
    return parsed.data;
  }

  private get<S extends z.ZodType>(path: string, schema: S, endpoint: string, a: Omit<Ask<S>, "schema" | "endpoint"> = {}): Promise<z.infer<S>> {
    return this.request("GET", path, { ...a, schema, endpoint });
  }

  // ── discovery ───────────────────────────────────────────────────────────────────────────────

  /** Every field on the site, by schema (design §6.4). */
  async fields(): Promise<Discovered["fields"]> {
    return (await this.get("/rest/api/3/field", FieldsZ, "GET /rest/api/3/field")).map((f) => ({ id: f.id, name: f.name, custom: f.custom, ...(f.schema?.custom ? { schemaCustom: f.schema.custom } : {}) }));
  }

  async resolutions(): Promise<Discovered["resolutions"]> {
    const out: Discovered["resolutions"] = [];
    for (let startAt = 0; ;) {
      const page = await this.get("/rest/api/3/resolution/search", ResolutionsZ, "GET /rest/api/3/resolution/search", { query: { startAt, maxResults: 50 } });
      out.push(...page.values.map((r) => ({ id: r.id, name: r.name })));
      startAt += page.values.length;
      if (page.isLast !== false || page.values.length === 0) break;
    }
    return out;
  }

  /** The permissions this person has on the project (of those the tile cares about). */
  async permissions(projectKey: string): Promise<string[]> {
    const r = await this.get("/rest/api/3/mypermissions", PermissionsZ, "GET /rest/api/3/mypermissions", { query: { projectKey, permissions: PERMISSIONS.join(",") } });
    return Object.entries(r.permissions).filter(([, p]) => p.havePermission).map(([k]) => k);
  }

  async discover(project: string, boardId?: number): Promise<Discovered> {
    const { cloudId, siteUrl } = await this.site();
    const me = await this.get("/rest/api/3/myself", MyselfZ, "GET /rest/api/3/myself");
    const projects = await this.get("/rest/api/3/project/search", ProjectsZ, "GET /rest/api/3/project/search", { query: { ...(/^\d+$/.test(project) ? { id: project } : { keys: project }), maxResults: 50 } });
    const p = projects.values.find((x) => x.key.toUpperCase() === project.toUpperCase() || x.id === project);
    if (!p) throw new TransportError("not-found", `no Jira project ${project} that you can see on ${host(siteUrl)}`);
    const perType = await this.get(`/rest/api/3/project/${enc(p.key)}/statuses`, ProjectStatusesZ, "GET /rest/api/3/project/{key}/statuses");
    const types = await this.get("/rest/api/3/issuetype/project", IssueTypesZ, "GET /rest/api/3/issuetype/project", { query: { projectId: p.id } });
    const fields = await this.fields();
    const resolutions = await this.resolutions();
    const permissions = await this.permissions(p.key);

    const boards = await this.boards(p.key);
    const chosen = boardId !== undefined ? boards.find((b) => b.id === boardId) : boards.find((b) => b.type === "scrum") ?? boards[0];
    if (boardId !== undefined && !chosen) throw new TransportError("not-found", `board ${boardId} is not one of ${p.key}'s`);
    let board: Discovered["board"];
    let sprints: Discovered["sprints"] = [];
    if (chosen) {
      const c = await this.get(`/rest/agile/1.0/board/${chosen.id}/configuration`, BoardConfigZ, "GET /rest/agile/1.0/board/{id}/configuration", { scopes: AGILE_SCOPES.boardConfig });
      const features = await this.get(`/rest/agile/1.0/board/${chosen.id}/features`, FeaturesZ, "GET /rest/agile/1.0/board/{id}/features", { scopes: AGILE_SCOPES.boardConfig });
      board = {
        id: c.id,
        type: c.type ?? chosen.type,
        columns: c.columnConfig.columns.map((col) => ({ name: col.name, statuses: col.statuses.map((s) => s.id) })),
        ...(c.subQuery?.query ? { subQuery: c.subQuery.query } : {}),
        ...(c.estimation?.field?.fieldId ? { estimationFieldId: c.estimation.field.fieldId } : {}),
        backlogEnabled: features.features.some((f) => f.boardFeature === "BACKLOG" && f.state === "ENABLED"),
      };
      if (board.type === "scrum") sprints = await this.sprints(chosen.id);
      // A Kanban board's own issues are its filter's (design §7.1), when it is shared with this person.
      if (board.type === "kanban" && c.filter?.id) {
        const f = await this.get(`/rest/api/3/filter/${enc(c.filter.id)}`, FilterZ, "GET /rest/api/3/filter/{id}", { accept: [400, 403, 404] });
        if (f?.jql) board.filterJql = f.jql;
      }
    }
    // Whether the full workflow graph is readable (admin-gated): one call per discovery.
    await this.workflowGraph(p.id, types.filter((t) => !t.subtask).slice(0, 1).map((t) => t.id)).catch(() => null);

    const issueTypes = types.map((t) => {
      const st = perType.find((x) => x.id === t.id) ?? perType.find((x) => x.name === t.name);
      return {
        id: t.id, name: t.name, subtask: t.subtask, hierarchyLevel: t.hierarchyLevel ?? (t.subtask ? -1 : 0),
        statuses: (st?.statuses ?? []).map((s) => ({ id: s.id, name: s.name, categoryKey: s.statusCategory?.key ?? "undefined" })),
      };
    });
    return {
      cloudId,
      siteUrl,
      me: { accountId: me.accountId, displayName: me.displayName, timeZone: me.timeZone ?? "UTC" },
      project: { id: p.id, key: p.key, name: p.name, style: p.style === "next-gen" || p.simplified ? "next-gen" : "classic" },
      issueTypes,
      resolutions,
      fields,
      boards,
      ...(board ? { board } : {}),
      sprints,
      permissions,
    };
  }

  private async boards(project: string): Promise<Discovered["boards"]> {
    const kind = (t: string): Discovered["boards"][number]["type"] => (t === "scrum" || t === "kanban" ? t : "simple");
    const out: Discovered["boards"] = [];
    for (let startAt = 0; ;) {
      const page = await this.get("/rest/agile/1.0/board", BoardsZ, "GET /rest/agile/1.0/board", { query: { projectKeyOrId: project, startAt, maxResults: 50 }, scopes: AGILE_SCOPES.boards });
      out.push(...page.values.map((b) => ({ id: b.id, name: b.name, type: kind(b.type) })));
      startAt += page.values.length;
      if (page.isLast !== false || page.values.length === 0) break;
    }
    return out;
  }

  private async sprints(boardId: number): Promise<Discovered["sprints"]> {
    const out: Discovered["sprints"] = [];
    for (let startAt = 0; ;) {
      const page = await this.get(`/rest/agile/1.0/board/${boardId}/sprint`, SprintsZ, "GET /rest/agile/1.0/board/{id}/sprint", { query: { state: "active,future", startAt, maxResults: 50 }, scopes: AGILE_SCOPES.sprints });
      out.push(...page.values.map((s) => ({ id: s.id, name: s.name, state: s.state, boardId: s.originBoardId ?? boardId })));
      startAt += page.values.length;
      if (page.isLast !== false || page.values.length === 0) break;
    }
    return out;
  }

  /** The projects this token sees on the site, for the wizard. */
  async projects(): Promise<{ key: string; name: string }[]> {
    const out: { key: string; name: string }[] = [];
    for (let startAt = 0; ;) {
      const page = await this.get("/rest/api/3/project/search", ProjectsZ, "GET /rest/api/3/project/search", { query: { startAt, maxResults: 50 } });
      out.push(...page.values.map((p) => ({ key: p.key, name: p.name })));
      startAt += page.values.length;
      if (page.isLast !== false || page.values.length === 0) break;
    }
    return out;
  }

  async workflowGraph(projectId: string, issueTypeIds: string[]): Promise<WorkflowGraph | null> {
    const r = await this.request("POST", "/rest/api/3/workflows", {
      endpoint: "POST /rest/api/3/workflows", idempotent: true, schema: WorkflowsZ, accept: [401, 403],
      body: { projectAndIssueTypes: issueTypeIds.map((issueTypeId) => ({ projectId, issueTypeId })) },
    });
    this.graph = !!r;
    if (!r) return null;
    // The response lists workflows, not which type uses which: read each type on its own when asked for several.
    if (issueTypeIds.length > 1) {
      const out: WorkflowGraph = {};
      for (const id of issueTypeIds) Object.assign(out, await this.workflowGraph(projectId, [id]));
      return out;
    }
    const wf = r.workflows[0];
    const edges = (wf?.transitions ?? []).filter((t) => t.type !== "INITIAL").map((t) => ({
      id: t.id, name: t.name, to: t.toStatusReference, from: t.type === "GLOBAL" || !t.links?.length ? "*" as const : t.links.map((l) => l.fromStatusReference),
    }));
    return issueTypeIds[0] ? { [issueTypeIds[0]]: edges } : {};
  }

  // ── reads ───────────────────────────────────────────────────────────────────────────────────

  private raw(i: z.infer<typeof IssueZ>): RawIssue {
    const { description, ...fields } = i.fields ?? {};
    return {
      id: i.id,
      key: i.key,
      fields,
      ...(description !== undefined ? { descriptionMd: description === null ? null : adfToMarkdown(description) } : {}),
      ...(i.properties && Object.keys(i.properties).length ? { properties: i.properties } : {}),
    };
  }

  async search(jql: string, fields: string[], pageToken?: string, opts: { properties?: string[]; reconcileIssues?: string[] } = {}): Promise<Page<RawIssue>> {
    const page = await this.request("POST", "/rest/api/3/search/jql", {
      endpoint: "POST /rest/api/3/search/jql", idempotent: true, schema: SearchZ,
      body: {
        jql, fields, maxResults: PAGE,
        ...(pageToken ? { nextPageToken: pageToken } : {}),
        ...(opts.properties?.length ? { properties: opts.properties } : {}),
        ...(opts.reconcileIssues?.length ? { reconcileIssues: opts.reconcileIssues.slice(0, 50).map(Number).filter(Number.isFinite) } : {}),
      },
    });
    return { items: page.issues.map((i) => this.raw(i)), isLast: page.isLast !== false || !page.nextPageToken, ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
  }

  async count(jql: string): Promise<number> {
    return (await this.request("POST", "/rest/api/3/search/approximate-count", { endpoint: "POST /rest/api/3/search/approximate-count", idempotent: true, schema: CountZ, body: { jql } })).count;
  }

  /** Missing and forbidden ids are left out (Jira can't tell them apart); `issueErrors` and a batch
   *  that failed for a reason worth retrying are `errors`, never "deleted" (design §7.2). */
  async bulkFetch(idsOrKeys: string[], fields: string[]): Promise<{ issues: RawIssue[]; errors: string[] }> {
    const issues: RawIssue[] = [];
    const errors: string[] = [];
    for (let i = 0; i < idsOrKeys.length; i += BULK) {
      const chunk = idsOrKeys.slice(i, i + BULK);
      try {
        const r = await this.request("POST", "/rest/api/3/issue/bulkfetch", { endpoint: "POST /rest/api/3/issue/bulkfetch", idempotent: true, schema: BulkZ, body: { issueIdsOrKeys: chunk, fields } });
        issues.push(...r.issues.map((x) => this.raw(x)));
        for (const e of r.issueErrors ?? []) if (e.id) errors.push(e.id);
      } catch (e) {
        if (e instanceof TransportError && (e.kind === "rate-limited" || e.kind === "unavailable")) errors.push(...chunk);
        else throw e;
      }
    }
    return { issues, errors };
  }

  async validateJql(jql: string): Promise<{ ok: true } | { ok: false; message: string }> {
    const r = await this.request("POST", "/rest/api/3/jql/parse", { endpoint: "POST /rest/api/3/jql/parse", idempotent: true, schema: ParseZ, query: { validation: "strict" }, body: { queries: [jql] } });
    const errs = r.queries[0]?.errors ?? [];
    return errs.length ? { ok: false, message: errs.join("; ") } : { ok: true };
  }

  async changelog(idsOrKeys: string[], fieldIds: string[]): Promise<ChangeHistory[]> {
    const out: ChangeHistory[] = [];
    for (let i = 0; i < idsOrKeys.length; i += 1000) {
      const chunk = idsOrKeys.slice(i, i + 1000);
      let token: string | undefined;
      do {
        const r = await this.request("POST", "/rest/api/3/changelog/bulkfetch", {
          endpoint: "POST /rest/api/3/changelog/bulkfetch", idempotent: true, schema: ChangelogZ,
          body: { issueIdsOrKeys: chunk, fieldIds, maxResults: 1000, ...(token ? { nextPageToken: token } : {}) },
        });
        for (const l of r.issueChangeLogs) {
          for (const h of l.changeHistories) {
            out.push({
              issueId: l.issueId, id: h.id, created: h.created,
              ...(h.author ? { author: { ...(h.author.accountId ? { accountId: h.author.accountId } : {}), displayName: h.author.displayName } } : {}),
              items: h.items.map((it) => ({ fieldId: it.fieldId ?? it.field ?? "", from: it.from ?? null, fromString: it.fromString ?? null, to: it.to ?? null, toString: it.toString ?? null })),
            });
          }
        }
        token = r.nextPageToken;
      } while (token);
    }
    return out;
  }

  async comments(key: string): Promise<RawComment[]> {
    const out: RawComment[] = [];
    for (let startAt = 0; ;) {
      const page = await this.get(`/rest/api/3/issue/${enc(key)}/comment`, CommentsZ, "GET /rest/api/3/issue/{key}/comment", { query: { startAt, maxResults: 100, orderBy: "created" } });
      out.push(...page.comments.map((c) => ({
        id: c.id,
        author: { ...(c.author?.accountId ? { accountId: c.author.accountId } : {}), displayName: c.author?.displayName ?? "Someone" },
        bodyMd: adfToMarkdown(c.body),
        created: c.created,
        updated: c.updated ?? c.created,
      })));
      startAt += page.comments.length;
      if (page.comments.length === 0 || page.total === undefined || startAt >= page.total) break;
    }
    return out;
  }

  async transitions(key: string): Promise<Transition[]> {
    const r = await this.get(`/rest/api/3/issue/${enc(key)}/transitions`, TransitionsZ, "GET /rest/api/3/issue/{key}/transitions", { query: { expand: "transitions.fields", includeUnavailableTransitions: true } });
    return r.transitions.map((t) => ({
      id: t.id,
      name: t.name,
      to: { id: t.to.id, name: t.to.name, ...(t.to.statusCategory ? { statusCategory: { key: t.to.statusCategory.key } } : {}) },
      hasScreen: !!t.hasScreen,
      isAvailable: t.isAvailable !== false,
      isConditional: !!t.isConditional,
      isGlobal: !!t.isGlobal,
      fields: Object.fromEntries(Object.entries(t.fields ?? {}).map(([k, f]) => [k, { required: f.required, name: f.name, ...(f.allowedValues ? { allowedValues: f.allowedValues.map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name ?? v.id ?? "" })) } : {}) }])),
    }));
  }

  // ── writes (pushed by P3; a move and its metadata in one write, design §8.1) ────────────────

  async transition(key: string, transitionId: string, fields?: Record<string, unknown>, properties?: Record<string, unknown>): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${enc(key)}/transitions`, {
      endpoint: "POST /rest/api/3/issue/{key}/transitions", idempotent: false, issue: key,
      body: { transition: { id: transitionId }, ...(fields ? { fields } : {}), ...(properties ? { properties: Object.entries(properties).map(([k, value]) => ({ key: k, value })) } : {}) },
    });
  }

  async assign(key: string, accountId: string | null): Promise<void> {
    await this.request("PUT", `/rest/api/3/issue/${enc(key)}/assignee`, { endpoint: "PUT /rest/api/3/issue/{key}/assignee", idempotent: true, issue: key, body: { accountId } });
  }

  async comment(key: string, markdown: string): Promise<{ id: string }> {
    const r = await this.request("POST", `/rest/api/3/issue/${enc(key)}/comment`, { endpoint: "POST /rest/api/3/issue/{key}/comment", idempotent: false, issue: key, schema: CommentZ, body: { body: markdownToAdf(markdown) } });
    return { id: r.id };
  }

  /** An upsert by `globalId`: an update nulls what it leaves out, so the whole link goes every time. */
  async remoteLink(key: string, link: RemoteLink): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${enc(key)}/remotelink`, {
      endpoint: "POST /rest/api/3/issue/{key}/remotelink", idempotent: true, issue: key,
      body: { globalId: link.globalId, object: { url: link.url, title: link.title, status: { resolved: link.resolved } } },
    });
  }

  async setProperty(key: string, name: string, value: unknown): Promise<void> {
    await this.request("PUT", `/rest/api/3/issue/${enc(key)}/properties/${enc(name)}`, { endpoint: "PUT /rest/api/3/issue/{key}/properties/{name}", idempotent: true, issue: key, body: value });
  }

  /** None yet is a 404: undefined. */
  async getProperty(key: string, name: string): Promise<unknown> {
    const r = await this.request("GET", `/rest/api/3/issue/${enc(key)}/properties/${enc(name)}`, { endpoint: "GET /rest/api/3/issue/{key}/properties/{name}", idempotent: true, schema: PropertyZ, accept: [404] });
    return r?.value;
  }
}
