// How the Jira service reads and writes Jira (design jira-sync §9, rev 5 §9.0). Two transports
// implement it: the Atlassian Rovo MCP server after "Sign in with Atlassian" (the default, P2) and
// REST with a scoped API token (P2b). The sync engine — scope, ledger, ingest, push queue,
// conflicts — never knows which one it talks to. Everything is Jira Cloud (v3 shapes).

/** What a transport can do. A missing capability makes the engine use the other transport when it
 *  is configured, else degrade the way design §9.2 says, with the reason shown in the tile. */
export interface Capabilities {
  /** The full workflow graph (admin-gated: MCP `manage_jira`, REST `POST /workflows`). */
  workflowGraph: boolean;
  /** Bulk changelog for status/assignee (REST `changelog/bulkfetch`). */
  changelog: boolean;
  /** Rich text as ADF (REST); MCP gives markdown, or HTML for rich bodies. */
  adf: boolean;
  /** `GET /field` metadata to find custom fields by schema. */
  fieldsMeta: boolean;
  /** Boards, their configuration and sprints. */
  agile: boolean;
  /** Read the `hivemind` entity property in search results. */
  entityProps: boolean;
  /** `jql/parse` validation (else the empty-scope guard alone protects the mirror). */
  jqlParse: boolean;
  /** An idempotent remote-link upsert by `globalId` (REST only; MCP lists and matches by URL). */
  remoteLinkUpsert: boolean;
  /** Writes at all (transitions, assignee, comments, links, properties). */
  push: boolean;
}

/** A failure the engine branches on. `retryAfterMs` comes from `Retry-After` (read by our own
 *  fetch wrapper: the MCP SDK drops it). */
export class TransportError extends Error {
  constructor(
    readonly kind: "auth" | "consent" | "forbidden" | "not-found" | "rate-limited" | "invalid" | "unavailable" | "conflict",
    message: string,
    readonly retryAfterMs?: number,
    /** Jira's `errors{}` for a refused transition (field → message). */
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

/** An issue as REST v3 shapes it (`fields` holds what was asked for). The MCP transport
 *  normalises to this; rich text is markdown here (`descriptionMd`), converted once at the edge. */
export interface RawIssue {
  id: string;
  key: string;
  fields: Record<string, unknown>;
  /** Description and comments already as markdown, whatever the transport received. */
  descriptionMd?: string | null;
  properties?: Record<string, unknown>;
}

export interface Page<T> { items: T[]; nextPageToken?: string; isLast: boolean }

export interface RawComment { id: string; author: { accountId?: string; displayName: string }; bodyMd: string; created: string; updated: string }

export interface Transition {
  id: string;
  name: string;
  to: { id: string; name: string; statusCategory?: { key: string } };
  hasScreen: boolean;
  isAvailable: boolean;
  isConditional: boolean;
  isGlobal: boolean;
  /** Screen fields, by id: `{required, name, allowedValues}`. */
  fields: Record<string, { required: boolean; name: string; allowedValues?: { id?: string; name: string }[] }>;
}

export interface RemoteLink {
  /** `github-pr:<org>/<repo>#<n>`; used for the REST upsert, ignored by MCP (no globalId there). */
  globalId: string;
  url: string;
  title: string;
  resolved: boolean;
}

/** What discovery reads (design §6.1); the engine turns it into schema.json and workflow.yaml. */
export interface Discovered {
  cloudId: string;
  siteUrl: string;
  me: { accountId: string; displayName: string; timeZone: string };
  project: { id: string; key: string; name: string; style: "classic" | "next-gen" };
  issueTypes: { id: string; name: string; subtask: boolean; hierarchyLevel: number; statuses: { id: string; name: string; categoryKey: string }[] }[];
  resolutions: { id: string; name: string }[];
  fields: { id: string; name: string; custom: boolean; schemaCustom?: string }[];
  boards: { id: number; name: string; type: "scrum" | "kanban" | "simple" }[];
  /** The chosen board's configuration, when there is one. */
  board?: { id: number; type: string; columns: { name: string; statuses: string[] }[]; filterJql?: string; subQuery?: string; estimationFieldId?: string; backlogEnabled?: boolean };
  sprints: { id: number; name: string; state: "active" | "future" | "closed"; boardId: number }[];
  permissions: string[];
}

export interface JiraTransport {
  readonly kind: "mcp" | "rest";
  readonly capabilities: Capabilities;
  discover(project: string, boardId?: number): Promise<Discovered>;
  /** Bounded JQL; always pass `fields` (REST defaults to id only). */
  search(jql: string, fields: string[], pageToken?: string, opts?: { properties?: string[]; reconcileIssues?: string[] }): Promise<Page<RawIssue>>;
  /** Ids that are missing or forbidden are left out; `errors` are retriable, never "deleted". */
  bulkFetch(idsOrKeys: string[], fields: string[]): Promise<{ issues: RawIssue[]; errors: string[] }>;
  validateJql?(jql: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** How many issues a JQL finds (Jira's count may be approximate), for Browse and the wizard's preview. */
  count?(jql: string): Promise<number>;
  comments(key: string): Promise<RawComment[]>;
  transitions(key: string): Promise<Transition[]>;
  transition(key: string, transitionId: string, fields?: Record<string, unknown>, properties?: Record<string, unknown>): Promise<void>;
  assign(key: string, accountId: string | null): Promise<void>;
  comment(key: string, markdown: string): Promise<{ id: string }>;
  remoteLink(key: string, link: RemoteLink): Promise<void>;
  setProperty(key: string, name: string, value: unknown): Promise<void>;
}
