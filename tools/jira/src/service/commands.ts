// The commands the Jira service answers (registered with `plugin.serve`), for its tile, for
// `hive ctl plugin call @dip497/jira <command>`, for the start-work guard's provider and for the
// `jira` skill. Each takes one JSON object and answers one.

export type Scope = { kind: "mine" } | { kind: "mine+unassigned" } | { kind: "all" } | { kind: "jql"; jql: string };

export interface ServiceStatus {
  connected: boolean;
  transport: "mcp" | "rest" | null;
  site?: string;
  me?: string;
  project?: string;
  lastSync?: string;
  nextSync?: string;
  counts?: { mirrored: number; conflicts: number; archived: number };
  /** MCP calls used this hour and the budget. */
  budget?: { used: number; limit: number };
  rateLimitedUntil?: string;
  /** Why something is off: "sign in again", "a capability missing", "scope returned nothing". */
  problems: string[];
}

export interface Commands {
  status: { in: Record<string, never>; out: ServiceStatus };
  /** Start "Sign in with Atlassian": answers the authorize URL to open; the loopback listener waits. */
  signIn: { in: { site?: string }; out: { authorizeUrl: string } };
  signOut: { in: Record<string, never>; out: { ok: true } };
  /** Read the project's workflow, boards and fields; propose workflow.yaml (not written). */
  discover: { in: { project: string; boardId?: number }; out: { proposal: unknown; boards: { id: number; name: string; type: string }[] } };
  /** Write the confirmed setup (workflow.yaml, scope, push mode) and run the first sync. */
  configure: { in: { project: string; boardId?: number; scope: Scope; push: "off" | "status" | "status+comments" | "full" }; out: ServiceStatus };
  syncNow: { in: Record<string, never>; out: { created: string[]; updated: string[]; unchanged: number; conflicts: number; archived: string[] } };
  /** Live results without importing (the tile's Browse tab). */
  browse: { in: { scope?: Scope; jql?: string; pageToken?: string }; out: { issues: { key: string; summary: string; status: string; assignee: string | null; tracked: boolean }[]; nextPageToken?: string } };
  /** Import one issue now. */
  track: { in: { key: string }; out: { id: string } };
  /** Start-work guard provider (design §10): the issue as Jira has it now, written through ingest. */
  refresh: { in: { key: string }; out: { id: string } };
  assignMe: { in: { key: string }; out: { ok: true } };
  conflicts: { in: Record<string, never>; out: { id: string; local: string; remote: string; since: string }[] };
  resolve: { in: { id: string; keep: "jira" | "hive" }; out: { ok: true } };
}
