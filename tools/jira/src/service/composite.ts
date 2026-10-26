// The MCP transport with REST behind it (design jira-sync §9.0, "Missing capabilities"): when the
// person signed in with Atlassian and also gave an API token, what the Rovo MCP server can't do —
// `/field`, `jql/parse`, the bulk changelog, entity properties in search, the remote-link upsert by
// `globalId`, the workflow graph without `manage_jira`, resolutions and permissions — is asked of
// REST. Everything else stays on MCP. This is the one place that decides, and it remembers which
// transport served each capability, for the tile. The token is used only when it reaches the
// site the sign-in syncs (the same cloud ID); otherwise MCP works alone, as without a token.
import { TransportError, type Capabilities, type ChangeHistory, type Discovered, type JiraTransport, type Page, type RawComment, type RawIssue, type RemoteLink, type Transition, type WorkflowGraph } from "./transport.js";
import type { RestTransport } from "./rest/transport.js";

/** The Rovo MCP transport, as this needs it. */
type Mcp = JiraTransport & { site(): Promise<{ cloudId: string; siteUrl: string }>; projects(): Promise<{ key: string; name: string }[]>; count(jql: string): Promise<number>; me(): Promise<{ accountId: string; displayName: string }> };

export type Served = Record<keyof Capabilities, "mcp" | "rest" | "none">;

/** What REST serves behind MCP. Rich text, boards and writes stay MCP's: the sign-in syncs. */
export const FALLBACK: readonly (keyof Capabilities)[] = ["workflowGraph", "changelog", "fieldsMeta", "entityProps", "jqlParse", "remoteLinkUpsert"];

/** Which transport serves each capability: `own`'s (MCP, or REST alone), else REST's behind it. */
export function servedBy(own: Capabilities, rest?: Capabilities, kind: "mcp" | "rest" = "mcp"): Served {
  return Object.fromEntries((Object.keys(own) as (keyof Capabilities)[]).map((k) => [k, own[k] ? kind : rest?.[k] && FALLBACK.includes(k) ? "rest" : "none"])) as Served;
}

export class CompositeTransport implements JiraTransport {
  readonly kind = "mcp" as const;

  /** Why the token isn't used: it is for another site, or couldn't be checked. */
  mismatch?: string;
  private same?: Promise<boolean>;

  constructor(readonly mcp: Mcp, readonly rest: RestTransport) {}

  /** Whether the token reaches the site the sign-in syncs; asked once. */
  usable(): Promise<boolean> {
    this.same ??= Promise.all([this.mcp.site(), this.rest.cloudId()]).then(([m, r]) => {
      this.mismatch = m.cloudId === r ? undefined : `the API token is for another site (cloud ID ${r}) than the sign-in's (${m.cloudId}): it isn't used`;
      return !this.mismatch;
    }, (e: unknown) => {
      // The token can't be checked now (tenant_info down): MCP alone, and asked again next time.
      this.same = undefined;
      this.mismatch = `the API token couldn't be checked: ${e instanceof Error ? e.message : String(e)}`;
      return false;
    });
    return this.same;
  }

  get capabilities(): Capabilities {
    const m = this.mcp.capabilities;
    if (this.mismatch) return m;
    const r = this.rest.capabilities;
    return Object.fromEntries((Object.keys(m) as (keyof Capabilities)[]).map((k) => [k, m[k] || (FALLBACK.includes(k) && r[k])])) as unknown as Capabilities;
  }

  served(): Served {
    return servedBy(this.mcp.capabilities, this.mismatch ? undefined : this.rest.capabilities);
  }

  site(): Promise<{ cloudId: string; siteUrl: string }> {
    return this.mcp.site();
  }

  me(): Promise<{ accountId: string; displayName: string }> {
    return this.mcp.me();
  }

  projects(): Promise<{ key: string; name: string }[]> {
    return this.mcp.projects();
  }

  /** MCP's discovery, with what only REST reads: every field by schema (MCP sees only the create
   *  screens'), the resolutions and this person's permissions, and whether the workflows are readable. */
  async discover(project: string, boardId?: number): Promise<Discovered> {
    const d = await this.mcp.discover(project, boardId);
    if (!(await this.usable())) return d;
    const caps = this.mcp.capabilities;
    if (!caps.fieldsMeta) {
      const all = await this.rest.fields();
      const ids = new Set(all.map((f) => f.id));
      d.fields = [...all, ...d.fields.filter((f) => !ids.has(f.id))];
    }
    if (d.resolutions.length === 0) d.resolutions = await this.rest.resolutions();
    if (d.permissions.length === 0) d.permissions = await this.rest.permissions(d.project.key);
    if (!caps.workflowGraph) await this.rest.workflowGraph(d.project.id, d.issueTypes.filter((t) => !t.subtask).slice(0, 1).map((t) => t.id)).catch(() => null);
    return d;
  }

  /** Entity properties come back only from REST's search. */
  async search(jql: string, fields: string[], pageToken?: string, opts?: { properties?: string[]; reconcileIssues?: string[] }): Promise<Page<RawIssue>> {
    if (opts?.properties?.length && !this.mcp.capabilities.entityProps && await this.usable()) return this.rest.search(jql, fields, pageToken, opts);
    return this.mcp.search(jql, fields, pageToken, opts);
  }

  bulkFetch(idsOrKeys: string[], fields: string[]): Promise<{ issues: RawIssue[]; errors: string[] }> {
    return this.mcp.bulkFetch(idsOrKeys, fields);
  }

  async validateJql(jql: string): Promise<{ ok: true } | { ok: false; message: string }> {
    if (this.mcp.capabilities.jqlParse && this.mcp.validateJql) return this.mcp.validateJql(jql);
    // No parser to ask: the empty-scope guard alone protects the mirror, as over MCP alone.
    return (await this.usable()) ? this.rest.validateJql(jql) : { ok: true };
  }

  count(jql: string): Promise<number> {
    return this.mcp.count(jql);
  }

  async changelog(idsOrKeys: string[], fieldIds: string[]): Promise<ChangeHistory[]> {
    if (!(await this.usable())) throw new TransportError("unavailable", `the bulk changelog needs an API token for this site${this.mismatch ? ` (${this.mismatch})` : ""}`);
    return this.rest.changelog(idsOrKeys, fieldIds);
  }

  async workflowGraph(projectId: string, issueTypeIds: string[]): Promise<WorkflowGraph | null> {
    return (await this.usable()) ? this.rest.workflowGraph(projectId, issueTypeIds) : null;
  }

  comments(key: string): Promise<RawComment[]> {
    return this.mcp.comments(key);
  }

  transitions(key: string): Promise<Transition[]> {
    return this.mcp.transitions(key);
  }

  transition(key: string, transitionId: string, fields?: Record<string, unknown>, properties?: Record<string, unknown>): Promise<void> {
    return this.mcp.transition(key, transitionId, fields, properties);
  }

  assign(key: string, accountId: string | null): Promise<void> {
    return this.mcp.assign(key, accountId);
  }

  comment(key: string, markdown: string): Promise<{ id: string }> {
    return this.mcp.comment(key, markdown);
  }

  /** The idempotent upsert by `globalId` is REST's; over MCP a retry could add a second link (§8.1). */
  async remoteLink(key: string, link: RemoteLink): Promise<void> {
    return !this.mcp.capabilities.remoteLinkUpsert && await this.usable() ? this.rest.remoteLink(key, link) : this.mcp.remoteLink(key, link);
  }

  setProperty(key: string, name: string, value: unknown): Promise<void> {
    return this.mcp.setProperty(key, name, value);
  }
}
