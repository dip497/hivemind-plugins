// The commands the Jira service answers (registered with `plugin.serve`), for its tile (`host.call`),
// for `hive ctl plugin call @dip497/jira <command>`, for the start-work guard's provider and for the
// `jira` skill. Each takes one JSON object and answers one.
//
// Names are lowercase words joined by dashes: the host refuses any other name in `plugin.serve`
// (`COMMAND_NAME_RE` in the app's view SDK), so `sign-in`, not `signIn`.

export type Scope = { kind: "mine" } | { kind: "mine+unassigned" } | { kind: "all" } | { kind: "jql"; jql: string };
export type Push = "off" | "status" | "status+comments" | "full";
/** Which sprints a Scrum board's scope reaches (design §7.1): the open ones (default), the future
 *  ones too, or the backlog as well. */
export type Sprints = "open" | "open+future" | "open+future+backlog";
/** hive's six categories (design §4.1). */
export type Category = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";

/** One status of a proposed or current workflow (design §4.2). */
export interface MappedStatus {
  /** `jira:<id>` for Jira's, `hive:<slug>` for a hive-only status. */
  id: string;
  name: string;
  category: Category;
  color?: string;
  source: "jira" | "hive";
  /** Jira's own status category (`new` | `indeterminate` | `done`), for the person deciding. */
  jiraCategory?: string;
  /** A hive-only status: the Jira status an issue shows while it sits here, or "stay". */
  follow?: string;
  retired?: boolean;
}

/** The workflow `discover` proposes, `mapping` reads back and the person edits: the service writes
 *  it as `.hivemind/workflow.yaml` (its `jira:*` statuses and board), keeping what the person owns. */
export interface WorkflowProposal {
  statuses: MappedStatus[];
  board?: { id: number; name?: string; type: string; columns: { name: string; statuses: string[] }[] } | null;
  /** Resolutions that make a done status `cancelled` (Won't Do, Duplicate, …). */
  cancelledResolutions: string[];
  /** Every resolution the site has, to pick from. */
  resolutions?: string[];
  /** The project's issue types, for the excluded types. */
  issueTypes?: { id: string; name: string }[];
}

export interface ServiceStatus {
  connected: boolean;
  transport: "mcp" | "rest" | null;
  site?: string;
  me?: string;
  /** Set once `configure` ran: the tile shows its tabs, not the wizard. `site` and `me` come as
   *  soon as the sign-in is read, before that. */
  project?: string;
  boardId?: number;
  scope?: Scope;
  sprints?: Sprints;
  excludedTypes?: string[];
  push?: Push;
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
  "sign-in": { in: { site?: string }; out: { authorizeUrl: string } };
  "sign-out": { in: Record<string, never>; out: { ok: true } };
  /** The projects the signed-in account sees on its site (`getVisibleJiraProjects`), for the wizard. */
  projects: { in: Record<string, never>; out: { projects: { key: string; name: string }[] } };
  /** Read the project's workflow, boards and fields; propose workflow.yaml (not written). */
  discover: { in: { project: string; boardId?: number }; out: { proposal: WorkflowProposal; boards: { id: number; name: string; type: string }[] } };
  /** Write the confirmed setup (workflow.yaml from `workflow` when given, else the proposal; scope,
   *  push mode) and run the first sync. */
  configure: { in: { project: string; boardId?: number; scope: Scope; sprints?: Sprints; excludedTypes?: string[]; push: Push; workflow?: WorkflowProposal }; out: ServiceStatus & { firstSync?: Commands["sync-now"]["out"] } };
  /** The workflow as it is now (the tile's Mapping tab). */
  mapping: { in: Record<string, never>; out: WorkflowProposal };
  /** The person's mapping edits: categories, hive-only statuses and their follow, cancelled resolutions. */
  "set-mapping": { in: { workflow: WorkflowProposal }; out: WorkflowProposal };
  /** The scope edits of the Scope tab; the next sync uses them (the empty-scope guard still applies). */
  "set-scope": { in: { scope: Scope; sprints?: Sprints; excludedTypes?: string[] }; out: ServiceStatus };
  "sync-now": { in: Record<string, never>; out: { created: string[]; updated: string[]; unchanged: number; conflicts: number; archived: string[] } };
  /** Live results without importing (the tile's Browse tab, the wizard's preview count). */
  /** Before the workspace is linked (the wizard), `project` and the board and sprint choices say what to count. */
  browse: { in: { scope?: Scope; jql?: string; pageToken?: string; project?: string; boardId?: number; sprints?: Sprints; excludedTypes?: string[] }; out: { issues: { key: string; summary: string; status: string; assignee: string | null; tracked: boolean }[]; total?: number; nextPageToken?: string } };
  /** Import one issue now. */
  track: { in: { key: string }; out: { id: string } };
  /** Start-work guard provider (design §10): the issue as Jira has it now, written through ingest. */
  refresh: { in: { key: string }; out: { id: string } };
  "assign-me": { in: { key: string }; out: { ok: true } };
  conflicts: { in: Record<string, never>; out: { id: string; title?: string; local: string; remote: string; since: string }[] };
  resolve: { in: { id: string; keep: "jira" | "hive" }; out: { ok: true } };
}
