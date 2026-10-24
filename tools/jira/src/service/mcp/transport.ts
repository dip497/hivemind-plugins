// `JiraTransport` over the Atlassian Rovo MCP server (design §9.0, §9.2). Reads only, in P2: issues
// through `searchJiraIssuesUsingJql` with explicit fields (never the compact `getJiraIssue`, which
// drops issuetype, labels and parent), discovery through the project, status, issue-type, field
// and board tools. What MCP lacks — bulk changelog, `/field`, `jql/parse`, entity properties in
// search, the remote-link upsert, the workflow graph without `manage_jira` — is off in
// `capabilities`, and the engine degrades as §9.2 says. Rich text arrives as markdown, or HTML for
// bodies markdown can't carry, and leaves here as markdown.
import { toMarkdown } from "../html.js";
import { TransportError, type Capabilities, type Discovered, type JiraTransport, type Page, type RawComment, type RawIssue, type Transition } from "../transport.js";
import type { McpSession } from "./session.js";
import {
  BoardConfigZ, BoardsZ, CommentsZ, FieldMetaZ, IssueTypesZ, MyselfZ, ProjectStatusesZ, ProjectsZ, ResourcesZ, SearchZ,
  SprintDataZ, SprintsZ, TransitionsZ, UserInfoZ,
} from "./schemas.js";
import type { z } from "zod";

/** Search pages: Rovo answers at most 100. */
const PAGE = 100;
/** Ids per `id in (…)` lookup. */
const BULK = 50;

const host = (url: string) => {
  try { return new URL(url.includes("://") ? url : `https://${url}`).host.toLowerCase(); } catch { return url.toLowerCase(); }
};

export interface McpTransportOptions {
  /** The site the person named (`acme.atlassian.net`); the first the sign-in reaches when empty. */
  site?: string;
}

export class McpTransport implements JiraTransport {
  readonly kind = "mcp" as const;
  private cloud?: { cloudId: string; siteUrl: string };

  constructor(private readonly session: McpSession, private readonly o: McpTransportOptions = {}) {}

  get capabilities(): Capabilities {
    const s = this.session;
    return {
      workflowGraph: s.has("workflows"),
      changelog: false,
      adf: false,
      fieldsMeta: false,
      agile: s.has("boardConfig"),
      entityProps: false,
      jqlParse: false,
      remoteLinkUpsert: false,
      // Pushing to Jira is P3.
      push: false,
    };
  }

  /** The site's cloudId and URL, as the sign-in reaches it. */
  async site(): Promise<{ cloudId: string; siteUrl: string }> {
    if (this.cloud) return this.cloud;
    const all = await this.session.call("resources", {}, ResourcesZ);
    const want = this.o.site ? host(this.o.site) : undefined;
    const hit = want ? all.find((r) => host(r.url) === want) : all[0];
    if (!hit) throw new TransportError("forbidden", want ? `this Atlassian sign-in doesn't reach ${want} (it reaches ${all.map((r) => host(r.url)).join(", ") || "no site"})` : "this Atlassian sign-in reaches no Jira site");
    // #283: a stale grant still lists the site, without its scopes.
    if (!hit.scopes) throw new TransportError("consent", `the Atlassian app is not installed for ${host(hit.url)} any more; sign in again`);
    this.cloud = { cloudId: hit.id, siteUrl: hit.url.replace(/\/$/, "") };
    return this.cloud;
  }

  private async call<S extends z.ZodType>(cap: Parameters<McpSession["call"]>[0], args: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
    const { cloudId } = await this.site();
    return this.session.call(cap, { cloudId, ...args }, schema);
  }

  async discover(project: string, boardId?: number): Promise<Discovered> {
    const { cloudId, siteUrl } = await this.site();
    const me = await this.call("myself", {}, MyselfZ);
    let timeZone = me.timeZone ?? undefined;
    if (!timeZone && this.session.has("userInfo")) timeZone = (await this.session.call("userInfo", {}, UserInfoZ)).zoneinfo ?? undefined;
    const projects = await this.call("projects", { query: project, maxResults: 50 }, ProjectsZ);
    const p = projects.values.find((x) => x.key.toUpperCase() === project.toUpperCase() || x.id === project);
    if (!p) throw new TransportError("not-found", `no Jira project ${project} that you can see on ${host(siteUrl)}`);
    const perType = await this.call("projectStatuses", { mode: "project", projectKey: p.key }, ProjectStatusesZ);
    const types = await this.call("issueTypes", { projectIdOrKey: p.key, maxResults: 100 }, IssueTypesZ);

    // Fields come from each issue type's create metadata (there's no /field over MCP), by schema.
    const fields = new Map<string, Discovered["fields"][number]>();
    if (this.session.has("fieldMeta")) {
      for (const t of types.issueTypes.filter((x) => !x.subtask)) {
        for (let startAt = 0; ;) {
          const page = await this.call("fieldMeta", { projectIdOrKey: p.key, issueTypeId: t.id, startAt, maxResults: 100 }, FieldMetaZ);
          for (const f of page.fields) if (!fields.has(f.fieldId)) fields.set(f.fieldId, { id: f.fieldId, name: f.name, custom: f.fieldId.startsWith("customfield_"), ...(f.schema?.custom ? { schemaCustom: f.schema.custom } : {}) });
          startAt += page.fields.length;
          if (page.fields.length === 0 || startAt >= page.total) break;
        }
      }
    }

    const boards = await this.boards(p.key);
    const chosen = boardId !== undefined ? boards.find((b) => b.id === boardId) : boards.find((b) => b.type === "scrum") ?? boards[0];
    if (boardId !== undefined && !chosen) throw new TransportError("not-found", `board ${boardId} is not one of ${p.key}'s`);
    let board: Discovered["board"];
    let sprints: Discovered["sprints"] = [];
    if (chosen && this.session.has("boardConfig")) {
      const c = await this.call("boardConfig", { boardId: chosen.id }, BoardConfigZ);
      board = {
        id: c.id,
        type: c.type ?? chosen.type,
        columns: c.columnConfig.columns.map((col) => ({ name: col.name, statuses: col.statuses.map((s) => s.id) })),
        ...(c.subQuery?.query ? { subQuery: c.subQuery.query } : {}),
        ...(c.estimation?.field?.fieldId ? { estimationFieldId: c.estimation.field.fieldId } : {}),
      };
      // An estimate field the board names but no create screen showed: keep its name for search.
      const est = c.estimation?.field;
      if (est?.fieldId && !fields.has(est.fieldId)) fields.set(est.fieldId, { id: est.fieldId, name: est.displayName ?? est.fieldId, custom: true });
      if (board.type === "scrum") sprints = await this.sprints(chosen.id);
    }

    const issueTypes = types.issueTypes.map((t) => {
      const st = perType.find((x) => x.id === t.id) ?? perType.find((x) => x.name === t.name);
      return {
        id: t.id, name: t.name, subtask: t.subtask, hierarchyLevel: t.hierarchyLevel,
        statuses: (st?.statuses ?? []).map((s) => ({ id: s.id, name: s.name, categoryKey: s.statusCategory?.key ?? "undefined" })),
      };
    });
    return {
      cloudId,
      siteUrl,
      me: { accountId: me.accountId, displayName: me.displayName, timeZone: timeZone ?? "UTC" },
      project: { id: p.id, key: p.key, name: p.name, style: p.style === "next-gen" || p.simplified ? "next-gen" : "classic" },
      issueTypes,
      // Not readable over MCP: no resolution search, no mypermissions.
      resolutions: [],
      fields: [...fields.values()],
      boards,
      ...(board ? { board } : {}),
      sprints,
      permissions: [],
    };
  }

  /** The project's boards: `listJiraBoards`, or (#282, where a site lacks it) the board of its active sprint. */
  private async boards(project: string): Promise<Discovered["boards"]> {
    const kind = (t: string): Discovered["boards"][number]["type"] => (t === "scrum" || t === "kanban" ? t : "simple");
    if (this.session.has("boards")) {
      const out: Discovered["boards"] = [];
      for (let startAt = 0; ;) {
        const page = await this.call("boards", { projectKeyOrId: project, startAt, maxResults: 50 }, BoardsZ);
        out.push(...page.values.map((b) => ({ id: b.id, name: b.name, type: kind(b.type) })));
        startAt += page.values.length;
        if (page.isLast !== false || page.values.length === 0) break;
      }
      return out;
    }
    if (!this.session.has("sprintData")) return [];
    try {
      const d = await this.call("sprintData", { projectKeyOrId: project }, SprintDataZ);
      return [{ id: d.board.id, name: d.board.name, type: kind(d.board.type) }];
    } catch (e) {
      if (e instanceof TransportError && (e.kind === "not-found" || e.kind === "invalid")) return [];
      throw e;
    }
  }

  /** A Scrum board's active and future sprints: `listJiraBoardSprints`, or its active sprint alone. */
  private async sprints(boardId: number): Promise<Discovered["sprints"]> {
    if (this.session.has("boardSprints")) {
      const out: Discovered["sprints"] = [];
      for (let startAt = 0; ;) {
        const page = await this.call("boardSprints", { boardId, state: "active,future", startAt, maxResults: 50 }, SprintsZ);
        out.push(...page.values.map((s) => ({ id: s.id, name: s.name, state: s.state, boardId: s.originBoardId ?? boardId })));
        startAt += page.values.length;
        if (page.isLast !== false || page.values.length === 0) break;
      }
      return out;
    }
    if (!this.session.has("sprintData")) return [];
    try {
      const d = await this.call("sprintData", { boardId: String(boardId) }, SprintDataZ);
      return [{ id: d.sprint.id, name: d.sprint.name, state: d.sprint.state, boardId }];
    } catch (e) {
      if (e instanceof TransportError && e.kind === "not-found") return [];
      throw e;
    }
  }

  private raw(i: z.infer<typeof SearchZ>["issues"][number]): RawIssue {
    const { description, ...fields } = i.fields;
    return {
      id: i.id,
      key: i.key,
      fields,
      ...(description !== undefined ? { descriptionMd: description === null ? null : toMarkdown(description, i.appliedContentFormat) } : {}),
    };
  }

  async search(jql: string, fields: string[], pageToken?: string): Promise<Page<RawIssue>> {
    const page = await this.call("search", { jql, fields, maxResults: PAGE, responseContentFormat: "markdown", ...(pageToken ? { nextPageToken: pageToken } : {}) }, SearchZ);
    return { items: page.issues.map((i) => this.raw(i)), isLast: page.isLast || !page.nextPageToken, ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
  }

  /** By id or key, 50 to a lookup. Ids not returned are missing or forbidden (Jira can't tell them
   *  apart); a lookup that failed for a reason worth retrying puts its ids in `errors`. */
  async bulkFetch(idsOrKeys: string[], fields: string[]): Promise<{ issues: RawIssue[]; errors: string[] }> {
    const issues: RawIssue[] = [];
    const errors: string[] = [];
    for (let i = 0; i < idsOrKeys.length; i += BULK) {
      const chunk = idsOrKeys.slice(i, i + BULK);
      const ids = chunk.filter((x) => /^\d+$/.test(x));
      const keys = chunk.filter((x) => !/^\d+$/.test(x));
      const jql = [ids.length ? `id in (${ids.join(", ")})` : "", keys.length ? `key in (${keys.map((k) => `"${k}"`).join(", ")})` : ""].filter(Boolean).join(" OR ");
      try {
        let token: string | undefined;
        do {
          const page = await this.search(jql, fields, token);
          issues.push(...page.items);
          token = page.isLast ? undefined : page.nextPageToken;
        } while (token);
      } catch (e) {
        if (e instanceof TransportError && (e.kind === "rate-limited" || e.kind === "unavailable")) errors.push(...chunk);
        else throw e;
      }
    }
    return { issues, errors };
  }

  async comments(key: string): Promise<RawComment[]> {
    const out: RawComment[] = [];
    for (let startAt = 0; ;) {
      const page = await this.call("comments", { issueIdOrKey: key, startAt, maxResults: 100, orderBy: "created", responseContentFormat: "markdown" }, CommentsZ);
      out.push(...page.comments.map((c) => ({
        id: c.id,
        author: { ...(c.author?.accountId ? { accountId: c.author.accountId } : {}), displayName: c.author?.displayName ?? "Someone" },
        bodyMd: toMarkdown(c.body, c.appliedContentFormat),
        created: c.created,
        updated: c.updated ?? c.created,
      })));
      startAt += page.comments.length;
      if (page.comments.length === 0 || page.total === undefined || startAt >= page.total) break;
    }
    return out;
  }

  async transitions(key: string): Promise<Transition[]> {
    const r = await this.call("transitions", { issueIdOrKey: key, expand: "transitions.fields", includeUnavailableTransitions: true }, TransitionsZ);
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

  // Writes come with push (P3).
  private push(what: string): never {
    throw new TransportError("unavailable", `${what}: sending changes to Jira comes with push, which this version of the Jira service doesn't do yet`);
  }
  async transition(): Promise<void> { this.push("transition"); }
  async assign(): Promise<void> { this.push("assign"); }
  async comment(): Promise<{ id: string }> { this.push("comment"); }
  async remoteLink(): Promise<void> { this.push("remote link"); }
  async setProperty(): Promise<void> { this.push("entity property"); }
}
