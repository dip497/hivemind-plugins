// The pull (design §6, §7): discovery into workflow.yaml, the incremental poll, the 6-hourly
// reconcile, Track and Browse, for one workspace linked to one Jira project. Transport-neutral: it
// reads through `JiraTransport` (MCP now, REST in P2b) and writes only through hive's ingest
// (`issue.ingest` on the drive socket), which holds the sync lock and makes re-running a pass free.
//
// The guards (§7.2, §7.3):
// - The poll asks for issues updated since the newest `updated` it pulled, less 2 minutes, in the
//   person's own time zone; Jira's clock is compared only with Jira's.
// - A reconcile that finds the scope empty while the mirror isn't archives nothing ("scope
//   returned nothing": an invalid clause reads as zero results since CHANGE-3131).
// - An issue Jira no longer returns is archived with a reason, never deleted; one whose lookup
//   failed for a retriable reason is looked up again next time, never archived for it.
import type { Scope, WorkflowProposal } from "../commands.js";
import { TransportError, type Discovered, type JiraTransport, type RawIssue } from "../transport.js";
import type { Logger } from "../log.js";
import { archivedRecord, pullFields, toRecord, type FieldRef, type IngestRecord, type RecordContext } from "./records.js";
import { pollJql, scopeJql } from "./scope.js";
import { buildWorkflow, categorize, defaultCancelled, workflowProblems, type Category, type Workflow } from "./workflow.js";
import { toProposal, withEdits } from "./proposal.js";
import type { Link, Schema, Store, SyncState } from "./store.js";

export interface IngestReport {
  created: string[];
  updated: string[];
  unchanged: string[];
  conflicts: { id: string; local: string; remote: string }[];
  archived: string[];
  notes: string[];
}

/** What the engine asks of hive (the drive socket in the service, core directly in tests). */
export interface Host {
  ingest(source: string, records: IngestRecord[]): Promise<IngestReport>;
  /** The workspace's issues: their titles, and the statuses in use. */
  list(): Promise<{ id: string; title?: string; status?: string; state?: string }[]>;
  /** Move an issue to a status (Keep Jira on a conflict). */
  setStatus(id: string, status: string): Promise<void>;
}

export interface SyncReport {
  created: string[];
  updated: string[];
  unchanged: number;
  conflicts: number;
  archived: string[];
}

const SIX_HOURS = 6 * 3_600_000;
const INGEST_BATCH = 100;
const RECONCILE_FIELDS = ["updated", "status", "assignee"];

const empty = (): SyncReport => ({ created: [], updated: [], unchanged: 0, conflicts: 0, archived: [] });
const add = (r: SyncReport, i: IngestReport) => {
  r.created.push(...i.created);
  r.updated.push(...i.updated);
  r.unchanged += i.unchanged.length;
  r.conflicts += i.conflicts.length;
  r.archived.push(...i.archived);
};
const later = (a?: string, b?: string) => (!a ? b : !b ? a : Date.parse(norm(a)) >= Date.parse(norm(b)) ? a : b);
const norm = (s: string) => s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");

/** The custom fields the pull reads, found by schema (never by name alone, design §6.4). */
export function fieldsOf(d: Discovered): Pick<Schema, "sprintField" | "estimateField" | "flaggedField"> {
  const ref = (f?: Discovered["fields"][number]): FieldRef | undefined => (f ? { id: f.id, name: f.name } : undefined);
  const sprint = d.fields.find((f) => f.schemaCustom === "com.pyxis.greenhopper.jira:gh-sprint");
  const estimate = (d.board?.estimationFieldId ? d.fields.find((f) => f.id === d.board!.estimationFieldId) : undefined)
    ?? d.fields.find((f) => f.schemaCustom === "com.pyxis.greenhopper.jira:jsw-story-points")
    ?? d.fields.find((f) => f.custom && /story\s*points?/i.test(f.name));
  const flagged = d.fields.find((f) => f.custom && /^flagged$/i.test(f.name));
  return { ...(sprint ? { sprintField: ref(sprint) } : {}), ...(estimate ? { estimateField: ref(estimate) } : {}), ...(flagged ? { flaggedField: ref(flagged) } : {}) };
}

export interface EngineOptions {
  store: Store;
  link: Link;
  transport: JiraTransport;
  host: Host;
  log: Logger;
  now?: () => number;
}

export class SyncEngine {
  /** Why something is off, for the tile: shown until the next pass that clears it. */
  problems: string[] = [];
  lastReport?: SyncReport;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly o: EngineOptions) {}

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  get link(): Link {
    return this.o.link;
  }
  get source(): string {
    return this.o.link.source;
  }

  /** One pass at a time per workspace: what's asked while one runs waits for it. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => {});
    return run;
  }

  // ── discovery ───────────────────────────────────────────────────────────────────────────────

  /** The workflow discovery proposes from `d` against what's on disk; nothing written. */
  async propose(d: Discovered): Promise<{ workflow: Workflow; proposed: Record<string, Category>; notes: string[] }> {
    const { store } = this.o;
    const existing = await store.workflow();
    const before = await store.schema(this.source);
    const state = await store.state(this.source);
    const built = buildWorkflow({ discovered: d, existing, used: await this.used(state), proposedBefore: before?.proposed, ...(this.o.link.cancelledResolutions ? { cancelled: this.o.link.cancelledResolutions } : {}) });
    const problems = workflowProblems(built.workflow);
    if (problems.length) throw new TransportError("invalid", `the workflow discovered from Jira isn't one hive takes: ${problems.join("; ")}`);
    const notes = [...built.notes];
    if (d.board?.type === "kanban" && !d.board.filterJql) notes.push(`board ${d.board.id}'s filter isn't shared with you (or this site can't list filters): ${d.project.key}'s issues are pulled instead of the board's`);
    if (!d.board && d.boards.length === 0) notes.push(`${d.project.key} has no board: columns are its statuses, and open issues are pulled`);
    return { ...built, notes };
  }

  private async used(state: SyncState): Promise<Set<string>> {
    const issues = await this.o.host.list();
    return new Set([...issues.flatMap((i) => [i.status, i.state].filter((x): x is string => !!x)), ...Object.values(state.mirrored).map((m) => m.status).filter((x): x is string => !!x)]);
  }

  /** The workflow as the tile shows it. */
  async mapping(): Promise<WorkflowProposal> {
    const wf = await this.o.store.workflow();
    if (!wf) throw new TransportError("not-found", "there's no workflow.yaml yet: configure the link first");
    return toProposal(wf, (await this.o.store.schema(this.source))?.discovered, this.o.link.cancelledResolutions);
  }

  /** The person's mapping edits, written to workflow.yaml through the same rules as discovery. */
  applyMapping(p: WorkflowProposal): Promise<WorkflowProposal> {
    return this.serial(async () => {
      const schema = await this.schemaNow();
      const existing = await this.o.store.workflow();
      if (!existing) throw new TransportError("not-found", "there's no workflow.yaml yet: configure the link first");
      const cancelled = p.cancelledResolutions ?? this.o.link.cancelledResolutions;
      const state = await this.o.store.state(this.source);
      const built = buildWorkflow({ discovered: schema.discovered, existing: withEdits(existing, p), used: await this.used(state), proposedBefore: schema.proposed, ...(cancelled ? { cancelled } : {}) });
      const problems = workflowProblems(built.workflow);
      if (problems.length) throw new TransportError("invalid", `that mapping isn't one hive takes: ${problems.join("; ")}`);
      await this.o.store.saveWorkflow(built.workflow);
      await this.o.store.saveSchema(this.source, { ...schema, proposed: built.proposed });
      return toProposal(built.workflow, schema.discovered, cancelled);
    });
  }

  /** Read Jira's workflow, board and fields, and write schema.json and workflow.yaml. */
  discover(): Promise<Schema> {
    return this.serial(() => this.discoverNow());
  }

  private async discoverNow(): Promise<Schema> {
    const d = await this.o.transport.discover(this.o.link.project, this.o.link.boardId);
    const { workflow, proposed, notes } = await this.propose(d);
    const schema: Schema = { v: 1, discoveredAt: new Date(this.now()).toISOString(), discovered: d, ...fieldsOf(d), proposed, notes };
    await this.o.store.saveSchema(this.source, schema);
    await this.o.store.saveWorkflow(workflow);
    this.o.log(`discovered ${d.project.key}: ${workflow.statuses.length} statuses, ${workflow.board ? `${workflow.board.columns.length} columns of board ${d.board?.id}` : "no board"}`);
    return schema;
  }

  private async schemaNow(): Promise<Schema> {
    const s = await this.o.store.schema(this.source);
    if (s && this.now() - Date.parse(s.discoveredAt) < SIX_HOURS) return s;
    return this.discoverNow();
  }

  // ── what the pull reads ─────────────────────────────────────────────────────────────────────

  scopeJql(scope: Scope = this.o.link.scope, schema?: Schema): string {
    const b = schema?.discovered.board;
    return scopeJql(scope, this.o.link.project, b ? { type: b.type, ...(b.subQuery ? { subQuery: b.subQuery } : {}), ...(b.filterJql ? { filterJql: b.filterJql } : {}), ...(this.o.link.sprints ? { sprints: this.o.link.sprints } : {}) } : undefined, this.o.link.excludedTypes ?? []);
  }

  private async context(schema: Schema): Promise<RecordContext> {
    const wf = await this.o.store.workflow();
    const cats = new Map((wf?.statuses ?? []).map((s) => [s.id, s.category]));
    const board = schema.discovered.board;
    return {
      siteUrl: schema.discovered.siteUrl,
      me: schema.discovered.me.accountId,
      categoryOf: (id, s) => cats.get(id) ?? categorize({ id: id.replace(/^jira:/, ""), name: s.name, categoryKey: s.categoryKey ?? "undefined" }, { board, cancelled: this.o.link.cancelledResolutions ?? defaultCancelled(schema.discovered) }).category,
      ...(schema.sprintField ? { sprintField: schema.sprintField } : {}),
      ...(schema.estimateField ? { estimateField: schema.estimateField } : {}),
      ...(schema.flaggedField ? { flaggedField: schema.flaggedField } : {}),
    };
  }

  /** Every issue a JQL finds, page by page; `partial` when a page failed after some arrived. */
  private async all(jql: string, fields: string[]): Promise<{ issues: RawIssue[]; failed?: TransportError }> {
    const issues: RawIssue[] = [];
    let token: string | undefined;
    try {
      do {
        const page = await this.o.transport.search(jql, fields, token);
        issues.push(...page.items);
        token = page.isLast ? undefined : page.nextPageToken;
      } while (token);
    } catch (e) {
      if (!(e instanceof TransportError) || issues.length === 0) throw e;
      return { issues, failed: e };
    }
    return { issues };
  }

  private async ingest(records: IngestRecord[], report: SyncReport): Promise<void> {
    for (let i = 0; i < records.length; i += INGEST_BATCH) add(report, await this.o.host.ingest(this.source, records.slice(i, i + INGEST_BATCH)));
  }

  /** Comments of the issues that changed, 3 at a time; when the budget runs out the rest wait. */
  private async withComments(raws: RawIssue[], state: SyncState, ctx: RecordContext): Promise<{ records: IngestRecord[]; due: string[] }> {
    const changed = (r: RawIssue) => {
      const m = state.mirrored[r.id];
      return !m || m.updated !== r.fields.updated || state.commentsDue.includes(r.id) || !!m.archived;
    };
    const comments = new Map<string, Awaited<ReturnType<JiraTransport["comments"]>>>();
    const due: string[] = [];
    const todo = raws.filter(changed);
    let stopped = false;
    const worker = async () => {
      for (let r = todo.shift(); r; r = todo.shift()) {
        if (stopped) { due.push(r.id); continue; }
        try {
          comments.set(r.id, await this.o.transport.comments(r.key));
        } catch (e) {
          if (!(e instanceof TransportError) || (e.kind !== "rate-limited" && e.kind !== "unavailable")) throw e;
          stopped = true;
          due.push(r.id);
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { records: raws.map((r) => toRecord(r, ctx, comments.get(r.id))), due };
  }

  private remember(state: SyncState, raws: RawIssue[]): void {
    for (const r of raws) {
      const status = (r.fields.status as { id?: string } | undefined)?.id;
      state.mirrored[r.id] = { key: r.key, ...(typeof r.fields.updated === "string" ? { updated: r.fields.updated } : {}), ...(status ? { status: `jira:${status}` } : {}) };
    }
  }

  // ── the pull ────────────────────────────────────────────────────────────────────────────────

  /** One pass: the incremental poll, then a reconcile when one is due (or `reconcile`). */
  sync(opts: { reconcile?: boolean } = {}): Promise<SyncReport> {
    return this.serial(async () => {
      const report = empty();
      const problems: string[] = [];
      let schema = await this.schemaNow();
      const state = await this.o.store.state(this.source);
      try {
        schema = await this.poll(schema, state, report);
        const due = !state.lastReconcile || this.now() - Date.parse(state.lastReconcile) >= SIX_HOURS;
        if (opts.reconcile || due) await this.reconcile(schema, state, report, problems);
      } finally {
        state.lastSync = new Date(this.now()).toISOString();
        await this.o.store.saveState(this.source, state);
        this.problems = [...problems, ...schema.notes];
        this.lastReport = report;
      }
      return report;
    });
  }

  private async poll(schema: Schema, state: SyncState, report: SyncReport): Promise<Schema> {
    const jql = pollJql(this.scopeJql(undefined, schema), state.highWater, schema.discovered.me.timeZone);
    const { issues, failed } = await this.all(jql, pullFields(schema));
    // Issues whose comments the budget cut off last time, though they haven't changed since.
    const due = state.commentsDue.filter((id) => !issues.some((r) => r.id === id));
    if (due.length && !failed) issues.push(...(await this.o.transport.bulkFetch(due, pullFields(schema))).issues);
    // A status the workflow doesn't know: Jira changed; learn it before writing (design §6).
    const known = new Set(Object.keys(schema.proposed));
    if (issues.some((r) => !known.has(`jira:${(r.fields.status as { id?: string } | undefined)?.id}`))) schema = await this.discoverNow();
    const ctx = await this.context(schema);
    const { records, due: still } = await this.withComments(issues, state, ctx);
    await this.ingest(records, report);
    this.remember(state, issues);
    state.commentsDue = [...new Set([...state.commentsDue.filter((id) => !issues.some((r) => r.id === id)), ...still])];
    for (const r of issues) if (typeof r.fields.updated === "string") state.highWater = later(state.highWater, r.fields.updated);
    if (failed) throw failed;
    return schema;
  }

  private async reconcile(schema: Schema, state: SyncState, report: SyncReport, problems: string[]): Promise<void> {
    const scope = this.scopeJql(undefined, schema);
    const inScope = new Map<string, RawIssue>();
    const { issues, failed } = await this.all(`${scope} ORDER BY key ASC`, RECONCILE_FIELDS);
    if (failed) throw failed;
    for (const r of issues) inScope.set(r.id, r);
    const live = Object.entries(state.mirrored).filter(([, m]) => !m.archived);
    if (inScope.size === 0 && live.length > 0) {
      problems.push(`scope returned nothing: Jira found no issue for ${scope}, though ${live.length} are mirrored. Nothing was archived; check the scope (a renamed field or a deleted sprint makes JQL match nothing)`);
      this.o.log(`reconcile: the scope returned nothing while ${live.length} issues are mirrored; archiving nothing`);
      return;
    }
    const ctx = await this.context(schema);
    const fields = pullFields(schema);
    // Moved within scope (same id, new key), or in scope but never pulled: read them in full.
    const reread = [...inScope.values()].filter((r) => !state.mirrored[r.id] || state.mirrored[r.id]!.key !== r.key || state.mirrored[r.id]!.archived).map((r) => r.id);
    // Gone from scope, tracked, or left to retry: is Jira still keeping them for us?
    const check = [...new Set([...live.filter(([id]) => !inScope.has(id)).map(([id]) => id), ...state.tracked.filter((id) => !inScope.has(id)), ...state.retry])];
    const { issues: found, errors } = await this.o.transport.bulkFetch([...new Set([...reread, ...check])], fields);
    const byId = new Map(found.map((r) => [r.id, r]));
    const records: IngestRecord[] = [];
    for (const id of reread) {
      const r = byId.get(id);
      if (r) records.push(toRecord(r, ctx, await this.o.transport.comments(r.key).catch(() => undefined)));
    }
    for (const id of check) {
      if (errors.includes(id)) continue;
      const r = byId.get(id);
      const m = state.mirrored[id];
      if (r && (state.tracked.includes(id) || inScope.has(id))) records.push(toRecord(r, ctx));
      else if (r) records.push(archivedRecord(id, r.key, "left scope"));
      // Not returned: deleted or no longer visible. Jira answers both the same way (a 404 on a known
      // issue means "no access", design §7.3), so it's archived as that.
      else if (m) records.push(archivedRecord(id, m.key, "no access"));
    }
    await this.ingest(records, report);
    this.remember(state, [...reread, ...check].map((id) => byId.get(id)).filter((r): r is RawIssue => !!r));
    for (const rec of records) if (rec.archived && state.mirrored[rec.external.id]) state.mirrored[rec.external.id] = { ...state.mirrored[rec.external.id]!, key: rec.external.key, archived: rec.archived.reason };
    state.tracked = state.tracked.filter((id) => byId.has(id) || errors.includes(id) || inScope.has(id));
    state.retry = errors;
    if (errors.length) problems.push(`${errors.length} issue${errors.length === 1 ? "" : "s"} could not be checked this time; checked again next time, nothing archived for it`);
    state.lastReconcile = new Date(this.now()).toISOString();
  }

  // ── one issue ───────────────────────────────────────────────────────────────────────────────

  /** Import (or refresh) one issue now, as Jira has it; `track` keeps it while outside the scope. */
  pullOne(key: string, track: boolean): Promise<{ id: string }> {
    return this.serial(async () => {
      const schema = await this.schemaNow();
      const { issues } = await this.o.transport.bulkFetch([key.trim().toUpperCase()], pullFields(schema));
      const r = issues[0];
      if (!r) throw new TransportError("not-found", `${key} is not an issue you can see in Jira`);
      const ctx = await this.context(schema);
      const report = empty();
      await this.ingest([toRecord(r, ctx, await this.o.transport.comments(r.key))], report);
      const state = await this.o.store.state(this.source);
      this.remember(state, [r]);
      if (track && !state.tracked.includes(r.id)) state.tracked.push(r.id);
      await this.o.store.saveState(this.source, state);
      return { id: r.key };
    });
  }

  /** A page of live results for a scope or a JQL, without importing anything. */
  /** `draft`: a schema read for a link not made yet (the wizard's preview), used as it is. */
  async browse(o: { scope?: Scope; jql?: string; pageToken?: string }, draft?: Schema): Promise<{ issues: { key: string; summary: string; status: string; assignee: string | null; tracked: boolean }[]; total?: number; nextPageToken?: string }> {
    const schema = draft ?? (await this.o.store.schema(this.source)) ?? (await this.discover());
    const jql = o.jql?.trim() ? this.scopeJql({ kind: "jql", jql: o.jql }, schema) : this.scopeJql(o.scope ?? this.o.link.scope, schema);
    const page = await this.o.transport.search(`${jql} ORDER BY updated DESC`, ["summary", "status", "assignee"], o.pageToken);
    const state = await this.o.store.state(this.source);
    // The count once, with the first page: one more call, so not for every page.
    const total = !o.pageToken && this.o.transport.count ? await this.o.transport.count(jql).catch(() => undefined) : undefined;
    return {
      ...(total !== undefined ? { total } : {}),
      issues: page.items.map((r) => ({
        key: r.key,
        summary: String(r.fields.summary ?? ""),
        status: String((r.fields.status as { name?: string } | undefined)?.name ?? ""),
        assignee: (r.fields.assignee as { displayName?: string } | null | undefined)?.displayName ?? null,
        tracked: !!state.mirrored[r.id] && !state.mirrored[r.id]!.archived,
      })),
      ...(page.isLast || !page.nextPageToken ? {} : { nextPageToken: page.nextPageToken }),
    };
  }
}
