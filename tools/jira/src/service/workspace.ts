// The Jira service for one workspace: its link to a Jira project, its poll, and the commands the
// tile, `hive ctl plugin call @dip497/jira <command>` and the start-work guard ask of it
// (commands.ts). Nothing runs for a workspace until `configure` links it.
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Commands, Scope, ServiceStatus, Sprints, WorkflowProposal } from "./commands.js";
import { TransportError } from "./transport.js";
import type { Account } from "./account.js";
import type { Logger } from "./log.js";
import { nextDelayMs } from "./engine/cadence.js";
import { Store, sourceId, type Link, type Schema } from "./engine/store.js";
import { SyncEngine, fieldsOf, type Host, type SyncReport } from "./engine/sync.js";
import { proposalProblems, toProposal } from "./engine/proposal.js";
import { PushEngine, type PushHost } from "./engine/push.js";
import type { HiveIssue } from "./engine/push-status.js";
import { PushedLedger, bundledProperty, enqueueSide, installId, sideExecutors, type CommentKinds, type SideIssue } from "./engine/push-side.js";
import type { PushExecutor } from "./engine/push-exec.js";
import type { PushQueue } from "./engine/push-queue.js";
import { PROVIDED, assignMe, startChecks } from "./engine/provider.js";

/** A refusal in the drive's words: `plugin.answer`'s `{error: {code, message}}`. */
export class CommandError extends Error {
  constructor(readonly code: "BAD_REQUEST" | "NOT_FOUND" | "FAILED" | "FORBIDDEN" | "TIMEOUT" | "UNAVAILABLE" | "UNSUPPORTED" | "RATE_LIMITED", message: string) {
    super(message);
  }
}

/** The commands the service answers (`plugin.serve`): the app takes lowercase names with dashes. */
export const COMMANDS: { name: keyof Commands; description: string; args?: string }[] = [
  { name: "status", description: "Connection, last and next sync, counts, budget and what's wrong" },
  { name: "sign-in", description: "Start Sign in with Atlassian: answers the page to open; or, with transport rest, connect with an API token", args: "{site?} | {transport: rest, site?, email?, apiToken?, cloudId?, project?}" },
  { name: "test-connection", description: "Check an API-token connection (cloud ID, token, board scopes) without keeping it", args: "{site?, email?, apiToken?, cloudId?, project?}" },
  { name: "sign-out", description: "Forget the Atlassian sign-in and the API token" },
  { name: "projects", description: "The Jira projects the sign-in sees" },
  { name: "discover", description: "Read a project's workflow, boards and fields; propose the statuses (writes nothing)", args: "{project, boardId?}" },
  { name: "configure", description: "Link this workspace to a Jira project and pull it", args: "{project, boardId?, scope, sprints?, excludedTypes?, push, workflow?}" },
  { name: "mapping", description: "The statuses as they map now" },
  { name: "set-mapping", description: "Change categories, hive-only statuses and the cancelled resolutions", args: "{workflow}" },
  { name: "set-scope", description: "Change what is pulled; the next sync uses it", args: "{scope, sprints?, excludedTypes?}" },
  { name: "sync-now", description: "Pull from Jira now", args: "{reconcile?}" },
  { name: "browse", description: "Jira's issues for a scope or JQL, live, without importing", args: "{scope?, jql?, pageToken?, project?, boardId?, sprints?, excludedTypes?}" },
  { name: "track", description: "Import one Jira issue and keep it", args: "{key}" },
  { name: "refresh", description: "Read one issue from Jira now (the start-work guard)", args: "{key} | {id}" },
  { name: "start-checks", description: "The start-work checks only Jira answers: your permissions, another hive install on it", args: "{key} | {id}" },
  { name: "assign-me", description: "Assign an issue to you in Jira (needs Send to Jira on)", args: "{key} | {id}" },
  { name: "conflicts", description: "Issues whose status moved both in Jira and in hive" },
  { name: "resolve", description: "Settle a status conflict", args: "{id, keep: jira|hive}" },
  { name: "pushes", description: "What waits to be sent to Jira, the forms it asks, and Jira's refusals" },
  { name: "answer", description: "Answer a waiting push: a screen's fields, or OK for several transitions; cancel puts hive's status back", args: "{key, values?, cancel?}" },
];

/** The drive methods the service uses for one workspace. */
export interface Drive {
  call<T = unknown>(method: string, ...params: unknown[]): Promise<T>;
}

export function hostOver(drive: Drive, root: string): Host & PushHost {
  return {
    ingest: (source, records) => drive.call("issue.ingest", root, source, records),
    list: () => drive.call("issue.list", root),
    setStatus: async (id, status) => { await drive.call("issue.update", root, id, { status }); },
    read: (id) => drive.call<HiveIssue>("issue.read", root, id).catch((e: { code?: string }) => { if (e?.code === "NOT_FOUND") return null; throw e; }),
    update: async (id, patch) => { await drive.call("issue.update", root, id, patch); },
    note: async (id, message) => { await drive.call("issue.comment", root, id, message); },
    agents: async () => (await drive.call<{ programs?: { id: string }[] }>("agent.startable", path.dirname(root))).programs?.map((p) => p.id) ?? [],
  };
}

const ACTIVE_FOR = 2 * 60_000;

export interface WorkspaceOptions {
  repo: string;
  account: Account;
  host: Host & PushHost;
  log: Logger;
  now?: () => number;
  /** Polls on a timer (off in tests that drive passes themselves). */
  poll?: boolean;
  /** How long `configure` waits for its first sync before answering. */
  firstSyncWaitMs?: number;
  /** `issue.provideStart` on this workspace's drive connection: the start-work guard asks the
   *  service for its issues (design §10). */
  provide?: (root: string, source: string, commands: typeof PROVIDED) => void;
  /** This install, for the `hivemind` property's `by` (default: from the machine and the person). */
  installId?: string;
  /** What the property says hive is (the drive's API version). */
  hiveVersion?: string;
}

export class Workspace {
  readonly root: string;
  readonly store: Store;
  private engine?: SyncEngine;
  private pusher?: PushEngine;
  private timer?: ReturnType<typeof setTimeout>;
  private watcher?: FSWatcher;
  private lastAsked = 0;
  private failures = 0;
  private nextAt?: number;
  /** The site and person the sign-in reaches, read once while nothing is linked: the wizard says
   *  "connected as" before there is a schema to read it from. Forgotten at sign-out. */
  private identity?: { site: string; me: string } | Promise<unknown>;
  /** The wizard's project as Jira has it, for its preview counts. */
  private drafted?: { key: string; schema: Schema };
  private callsLast = 0;
  private stopped = false;
  /** The sources the start-work guard was told this service provides for. */
  private provided = new Set<string>();
  private ledgers = new Map<string, PushedLedger>();

  constructor(private readonly o: WorkspaceOptions) {
    this.root = path.join(o.repo, ".hivemind");
    this.store = new Store(this.root);
  }

  get repo(): string {
    return this.o.repo;
  }

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }

  private log(m: string, d?: unknown): void {
    this.o.log(`${path.basename(this.o.repo)}: ${m}`, d);
  }

  /** Load the link and start polling, if this workspace has one. */
  async start(): Promise<void> {
    const link = await this.store.link();
    if (link) this.use(link);
  }

  /** Tell the host this service is the start-work guard's provider for the link's issues. */
  private provide(link: Link): void {
    if (!this.o.provide || this.provided.has(link.source)) return;
    this.provided.add(link.source);
    this.o.provide(this.root, link.source, PROVIDED);
  }

  /** What hive already pushed for a link besides statuses (`sync/<slug>/pushed.json`). */
  ledger(link: Link): PushedLedger {
    const file = path.join(this.store.syncDir(link.source), "pushed.json");
    let l = this.ledgers.get(file);
    if (!l) this.ledgers.set(file, (l = new PushedLedger(file)));
    return l;
  }

  private kinds(): CommentKinds {
    const o = this.o.account.options;
    return { comment: o.pushPersonComments, summary: o.pushAgentSummaries, pr: o.pushPrRows };
  }

  /**
   * The side pushes for the push engine (design §8.1): `enqueue` for each `issue.changed` it
   * follows, the executors of the `comment`, `link` and `property` items, and the property to send
   * with a transition in the same write.
   */
  side(link: Link): {
    enqueue(queue: PushQueue, issue: SideIssue): Promise<unknown>;
    executors: PushExecutor[];
    bundled(queue: PushQueue, issueId: string): ReturnType<typeof bundledProperty>;
  } {
    const ledger = this.ledger(link);
    const exec = { ledger, installId: this.o.installId ?? installId(), hiveVersion: this.o.hiveVersion ?? "unknown" };
    return {
      enqueue: (queue, issue) => enqueueSide(queue, issue, { source: link.source, push: link.push, kinds: this.kinds(), ledger, now: () => this.now() }),
      executors: sideExecutors(exec),
      bundled: (queue, issueId) => bundledProperty(queue, issueId, exec),
    };
  }

  /** hive, with the comments hive sent to Jira left out of what the pull hands it: they are rows
   *  there already. */
  private hostFor(link: Link): Host {
    const host = this.o.host;
    const ledger = this.ledger(link);
    return {
      ...host,
      ingest: async (source, records) => {
        const sent = await ledger.commentIds();
        return host.ingest(source, sent.size ? records.map((r) => (r.comments?.some((c) => sent.has(c.id)) ? { ...r, comments: r.comments.filter((c) => !sent.has(c.id)) } : r)) : records);
      },
    };
  }

  private use(link: Link): void {
    this.provide(link);
    this.engine = undefined;
    this.watcher?.close();
    this.watcher = undefined;
    this.pushFor(link);
    if (this.o.poll === false) return;
    void fs.mkdir(this.store.syncDir(link.source), { recursive: true }).then(() => {
      if (this.stopped) return;
      try {
        // Touching sync/<slug>/request asks for a sync, tile open or not (design §7.2).
        this.watcher = watch(this.store.syncDir(link.source), (_e, f) => { if (f === "request") this.schedule(0); });
        this.watcher.on("error", () => {});
      } catch { /* no watch here: the next poll reads the request */ }
    });
    this.schedule(0);
  }

  private engineFor(link: Link): SyncEngine {
    if (this.engine && this.engine.link === link) return this.engine;
    this.engine = new SyncEngine({ store: this.store, link, transport: this.o.account.transport(link.site), host: this.hostFor(link), log: (m, d) => this.log(m, d), ...(this.o.now ? { now: this.o.now } : {}) });
    return this.engine;
  }

  /** The push engine of `link` (design §8): a new one when the link changed (its push mode). */
  pushFor(link: Link): PushEngine {
    // The link is read from disk each time: the same link is the same push engine (its queue, timer).
    if (this.pusher && JSON.stringify(this.pusher.link) === JSON.stringify(link)) return this.pusher;
    this.pusher?.stop();
    this.pusher = new PushEngine({
      store: this.store, link, transport: this.o.account.transport(link.site), host: this.o.host, log: (m, d) => this.log(m, d),
      autoPath: () => this.o.account.options.autoPath, timers: this.o.poll !== false, pull: () => this.schedule(0), side: this.side(link),
      ...(this.o.now ? { now: this.o.now } : {}),
    });
    void this.pusher.start().catch((e: unknown) => this.log("could not read the push queue", e));
    return this.pusher;
  }

  /** hive told a change to one of the workspace's issues (`issue.changed`): what Jira lacks is queued. */
  async issueChanged(change: { id: string; change?: string; fields?: string[] }): Promise<void> {
    const link = await this.store.link();
    if (!link || !this.o.account.signedIn) return;
    await this.pushFor(link).changed(change).catch((e: unknown) => this.log(`could not read ${change.id}'s change`, e));
  }

  /** Signed in again: a linked workspace syncs now. */
  wake(): void {
    if (this.engine || !this.stopped) void this.store.link().then((l) => { if (l) this.use(l); });
  }

  private schedule(ms: number): void {
    if (this.stopped || this.o.poll === false) return;
    clearTimeout(this.timer);
    this.nextAt = this.now() + ms;
    this.timer = setTimeout(() => void this.tick(), ms);
    this.timer.unref?.();
  }

  /** One timed pass: a sync, then the next one scheduled by the cadence. */
  async tick(): Promise<SyncReport | undefined> {
    const link = await this.store.link();
    if (!link) return undefined;
    await this.store.takeRequest(link.source);
    let rateLimitedMs: number | undefined;
    let report: SyncReport | undefined;
    const before = this.o.account.limiter.usage().used;
    try {
      if (!this.o.account.signedIn) return undefined; // nothing to do until the person signs in; wake() restarts
      report = await this.engineFor(link).sync();
      this.failures = 0;
      await this.pushFor(link).expireConflicts();
    } catch (e) {
      if (e instanceof TransportError && e.kind === "rate-limited") rateLimitedMs = e.retryAfterMs ?? 60_000;
      else this.failures++;
      this.log("sync failed", e);
      if (this.engine && e instanceof Error && !this.engine.problems.includes(e.message)) this.engine.problems = [e.message, ...this.engine.problems];
    } finally {
      this.callsLast = Math.max(0, this.o.account.limiter.usage().used - before);
      if (this.o.account.signedIn) {
        this.schedule(nextDelayMs({ active: this.now() - this.lastAsked < ACTIVE_FOR, callsPerPass: this.callsLast, budget: this.o.account.options.mcpBudget, ...(rateLimitedMs ? { rateLimitedMs } : {}), failures: this.failures, nearLimit: this.o.account.restLimits.nearLimit() }));
      }
    }
    return report;
  }

  stop(): void {
    this.stopped = true;
    this.pusher?.stop();
    clearTimeout(this.timer);
    this.watcher?.close();
  }

  // ── commands ────────────────────────────────────────────────────────────────────────────────

  async handle(name: string, args: unknown): Promise<unknown> {
    this.lastAsked = this.now();
    const c = COMMANDS.find((x) => x.name === name);
    if (!c) throw new CommandError("NOT_FOUND", `the Jira service has no command ${name}`);
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    try {
      return await this.run(c.name, a);
    } catch (e) {
      throw asCommandError(e);
    }
  }

  private async linked(): Promise<{ link: Link; engine: SyncEngine }> {
    const link = await this.store.link();
    if (!link) throw new CommandError("UNAVAILABLE", "this workspace isn't linked to a Jira project yet: configure it in the Jira tile");
    return { link, engine: this.engineFor(link) };
  }

  private async run(command: keyof Commands, a: Record<string, unknown>): Promise<unknown> {
    switch (command) {
      case "status": return this.status();
      case "sign-in":
        if (a.transport === "rest") { const r = await this.o.account.signInRest(restArgs(a)); this.engine = undefined; this.identity = undefined; return r; }
        if (a.transport !== undefined && a.transport !== "mcp") throw new CommandError("BAD_REQUEST", "transport is mcp or rest");
        return this.o.account.signIn(typeof a.site === "string" ? a.site : undefined);
      case "test-connection": return this.o.account.testRest(restArgs(a));
      case "sign-out": { await this.o.account.signOut(); this.engine = undefined; this.identity = undefined; return { ok: true }; }
      case "projects": {
        const link = await this.store.link();
        return { projects: await this.o.account.transport(link?.site).projects() };
      }
      case "discover": return this.discover(text(a.project, "project").toUpperCase(), board(a.boardId));
      case "configure": return this.configure(a);
      case "mapping": return (await this.linked()).engine.mapping();
      case "set-mapping": {
        const { link, engine } = await this.linked();
        const p = proposal(a.workflow);
        const out = await engine.applyMapping(p);
        if (p.cancelledResolutions) await this.relink({ ...link, cancelledResolutions: p.cancelledResolutions });
        return out;
      }
      case "set-scope": {
        const { link } = await this.linked();
        const next: Link = { ...link, scope: scope(a.scope), ...scopeExtras(a, link) };
        // Refused before it is kept when the JQL can't be built, or Jira's parser says it is wrong.
        await checked(this.engineFor(next));
        await this.relink(next);
        // A wider scope has issues older than the high-water mark, a narrower one leaves some out:
        // the reconcile sees both.
        void this.engineFor(next).sync({ reconcile: true }).catch((e: unknown) => this.log("sync after the scope changed failed", e));
        return this.status();
      }
      case "sync-now": {
        const { engine } = await this.linked();
        const r = await engine.sync({ reconcile: a.reconcile === true });
        this.schedule(nextDelayMs({ active: true, callsPerPass: this.callsLast, budget: this.o.account.options.mcpBudget }));
        return r;
      }
      case "browse": {
        // The wizard's preview, before anything is linked: the scope of the project it names.
        const draft = !(await this.store.link()) && typeof a.project === "string" ? await this.draftEngine(a) : undefined;
        const engine = draft?.engine ?? (await this.linked()).engine;
        return engine.browse({ ...(a.scope ? { scope: scope(a.scope) } : {}), ...(typeof a.jql === "string" ? { jql: a.jql } : {}), ...(typeof a.pageToken === "string" ? { pageToken: a.pageToken } : {}) }, draft?.schema);
      }
      case "track": return (await this.linked()).engine.pullOne(text(a.key, "key"), true);
      case "refresh": return (await this.linked()).engine.pullOne(issueKey(a), false);
      case "start-checks": {
        const { link } = await this.linked();
        return startChecks(issueKey(a), await this.providerContext(link));
      }
      case "assign-me": {
        const { link, engine } = await this.linked();
        const key = issueKey(a);
        await assignMe(key, await this.providerContext(link));
        // The mirror shows the new assignee now, not at the next poll.
        await engine.pullOne(key, false).catch((e: unknown) => this.log(`reading ${key} after assigning it failed`, e));
        return { ok: true };
      }
      case "conflicts": {
        const link = await this.store.link();
        if (!link) return [];
        const titles = new Map((await this.o.host.list()).map((i) => [i.id, i.title]));
        return (await this.store.conflicts(link.source)).map((c) => ({ ...c, ...(titles.get(c.id) ? { title: titles.get(c.id) } : {}) }));
      }
      case "resolve": {
        const { link } = await this.linked();
        const id = text(a.id, "id");
        if (a.keep !== "jira" && a.keep !== "hive") throw new CommandError("BAD_REQUEST", "keep is jira or hive");
        const c = (await this.store.conflicts(link.source)).find((x) => x.id === id);
        if (!c) throw new CommandError("NOT_FOUND", `${id} has no status conflict`);
        if (a.keep === "jira") {
          await this.o.host.setStatus(id, c.remote);
          return { ok: true };
        }
        if (link.push === "off") throw new CommandError("BAD_REQUEST", "Keep hive sends hive's status to Jira, and this workspace sends nothing (Send to Jira is off)");
        const out = await this.pushFor(link).keepHive(id);
        if (out?.kind === "refused") throw new CommandError("FAILED", out.message);
        if (out?.kind === "waiting") throw new CommandError("FAILED", `${out.message}: answer it in the Status tab`);
        // A retry stays queued: the conflict clears once Jira has it.
        return { ok: true };
      }
      case "pushes": {
        const link = await this.store.link();
        return link ? this.pushFor(link).pending() : { pushes: [], refused: [] };
      }
      case "answer": {
        const { link } = await this.linked();
        const values = a.values === undefined ? {} : a.values;
        if (!values || typeof values !== "object" || Array.isArray(values) || !Object.values(values).every((v) => typeof v === "string")) throw new CommandError("BAD_REQUEST", "values is an object of field id → text");
        const out = await this.pushFor(link).answer(text(a.key, "key"), values as Record<string, string>, a.cancel === true);
        return { outcome: out.kind, ...("message" in out ? { message: out.message } : "reason" in out ? { message: out.reason } : {}) };
      }
    }
  }

  private async providerContext(link: Link): Promise<Parameters<typeof startChecks>[1]> {
    const schema = await this.store.schema(link.source);
    return { transport: this.o.account.transport(link.site), ...(schema ? { schema } : {}), push: link.push, installId: this.o.installId ?? installId() };
  }

  /** Keep a changed link and sync by it from now on. */
  private async relink(link: Link): Promise<void> {
    await this.store.saveLink(link);
    this.engine = undefined;
    this.engineFor(link);
  }

  private async status(): Promise<ServiceStatus> {
    const link = await this.store.link();
    const account = this.o.account;
    const problems: string[] = [];
    const p = account.problem();
    if (p) problems.push(p);
    if (!link) problems.push("not linked to a Jira project: configure it in the Jira tile");
    const out: ServiceStatus = { connected: !p, transport: account.transportKind, problems };
    const usage = account.limiter.usage();
    out.budget = usage;
    const paused = account.rateLimitedUntil();
    if (paused) out.rateLimitedUntil = new Date(paused).toISOString();
    const served = account.served();
    if (served) out.served = served;
    const fallback = account.fallbackProblem();
    if (fallback) problems.push(fallback);
    const expiry = account.tokenExpiryProblem();
    if (expiry) problems.push(expiry);
    if (account.restLimits.nearLimit()) out.nearLimit = true;
    if (!link) {
      if (!p) {
        if (this.identity && !(this.identity instanceof Promise)) Object.assign(out, this.identity);
        else this.identity ??= this.identify();
      }
      return out;
    }
    out.site = link.site;
    out.project = link.project;
    out.scope = link.scope;
    out.push = link.push;
    if (link.boardId !== undefined) out.boardId = link.boardId;
    if (link.sprints) out.sprints = link.sprints;
    if (link.excludedTypes) out.excludedTypes = link.excludedTypes;
    const schema = await this.store.schema(link.source);
    if (schema) out.me = schema.discovered.me.displayName;
    const state = await this.store.state(link.source);
    if (state.lastSync) out.lastSync = state.lastSync;
    if (this.nextAt && this.nextAt > this.now()) out.nextSync = new Date(this.nextAt).toISOString();
    const mirrored = Object.values(state.mirrored);
    out.counts = { mirrored: mirrored.filter((m) => !m.archived).length, archived: mirrored.filter((m) => !!m.archived).length, conflicts: (await this.store.conflicts(link.source)).length };
    if (this.engine) problems.push(...this.engine.problems.filter((x) => !problems.includes(x)));
    const { pushes, refused } = await this.pushFor(link).pending();
    out.pushes = { queued: pushes.length, waiting: pushes.filter((p) => p.waiting).length };
    if (refused.length) out.refused = refused;
    return out;
  }

  private async siteNow(site?: string): Promise<{ site: string; cloudId: string; siteUrl: string }> {
    const want = site || this.o.account.site;
    const s = await this.o.account.transport(want).site();
    return { site: new URL(s.siteUrl).host, ...s };
  }

  private identify(): Promise<unknown> {
    return (async () => {
      const s = await this.siteNow();
      const me = await this.o.account.transport(s.site).me();
      this.identity = { site: s.site, me: me.displayName };
    })().catch((e: unknown) => { this.identity = undefined; this.log("could not read who signed in", e); });
  }

  /** An engine for the wizard's choices, kept nowhere, and what Jira says of its project, read
   *  once per project and board while the wizard counts: what `configure` would link. */
  private async draftEngine(a: Record<string, unknown>): Promise<{ engine: SyncEngine; schema: Schema }> {
    const project = text(a.project, "project").toUpperCase();
    const s = await this.siteNow();
    const link: Link = {
      v: 1, source: sourceId(s.site, project), site: s.site, cloudId: s.cloudId, project,
      ...(board(a.boardId) !== undefined ? { boardId: board(a.boardId) } : {}),
      scope: a.scope === undefined ? { kind: "mine" } : scope(a.scope), push: "off", ...scopeExtras(a),
    };
    const transport = this.o.account.transport(s.site);
    const key = `${link.source}#${link.boardId ?? ""}`;
    let drafted = this.drafted?.key === key ? this.drafted : undefined;
    if (!drafted) {
      const d = await transport.discover(project, link.boardId);
      this.drafted = drafted = { key, schema: { v: 1, discoveredAt: new Date(this.now()).toISOString(), discovered: d, ...fieldsOf(d), proposed: {}, notes: [] } };
    }
    return { engine: new SyncEngine({ store: this.store, link, transport, host: this.o.host, log: (m, d) => this.log(m, d) }), schema: drafted.schema };
  }

  private async discover(project: string, boardId?: number): Promise<Commands["discover"]["out"]> {
    const link = await this.store.link();
    const s = await this.siteNow(link?.site);
    const same = link?.project === project ? link : undefined;
    const temp: Link = { v: 1, source: sourceId(s.site, project), site: s.site, cloudId: s.cloudId, project, ...(boardId !== undefined ? { boardId } : {}), scope: link?.scope ?? { kind: "mine" }, push: link?.push ?? this.o.account.options.push, ...(same?.cancelledResolutions ? { cancelledResolutions: same.cancelledResolutions } : {}) };
    const transport = this.o.account.transport(s.site);
    const engine = new SyncEngine({ store: this.store, link: temp, transport, host: this.o.host, log: (m, d) => this.log(m, d) });
    const d = await transport.discover(project, boardId);
    const { workflow } = await engine.propose(d);
    return { proposal: toProposal(workflow, d, temp.cancelledResolutions), boards: d.boards.map((b) => ({ id: b.id, name: b.name, type: b.type })) };
  }

  private async configure(a: Record<string, unknown>): Promise<Commands["configure"]["out"]> {
    const project = text(a.project, "project").toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,254}$/.test(project)) throw new CommandError("BAD_REQUEST", `${project} is not a Jira project key`);
    const prefix = await this.prefix();
    if (prefix && prefix.toUpperCase() === project) throw new CommandError("BAD_REQUEST", `${project} is this workspace's own issue prefix; mirror ${project} into a workspace with another prefix`);
    const edits = a.workflow === undefined ? undefined : proposal(a.workflow);
    const push = (["off", "status", "status+comments", "full"] as const).find((p) => p === a.push) ?? this.o.account.options.push;
    const s = await this.siteNow();
    const before = await this.store.link();
    const kept = before?.project === project ? before : undefined;
    const link: Link = {
      v: 1, source: sourceId(s.site, project), site: s.site, cloudId: s.cloudId, project,
      ...(board(a.boardId) !== undefined ? { boardId: board(a.boardId) } : {}),
      scope: a.scope === undefined ? { kind: this.o.account.options.scope, ...(this.o.account.options.scope === "jql" ? { jql: this.o.account.options.jql } : {}) } as Scope : scope(a.scope),
      push,
      ...scopeExtras(a, kept),
      ...(edits?.cancelledResolutions ? { cancelledResolutions: edits.cancelledResolutions } : kept?.cancelledResolutions ? { cancelledResolutions: kept.cancelledResolutions } : {}),
    };
    // The JQL is built (and parsed by Jira, when the transport can) now, so a bad scope is refused before anything is written.
    await checked(new SyncEngine({ store: this.store, link, transport: this.o.account.transport(s.site), host: this.o.host, log: this.o.log }));
    await this.store.saveLink(link);
    this.engine = undefined;
    const engine = this.engineFor(link);
    await engine.discover();
    if (edits) await engine.applyMapping(edits);
    let firstSync: SyncReport | undefined;
    const first = engine.sync({ reconcile: true }).then((r) => (firstSync = r), (e: unknown) => this.log("first sync failed", e));
    await Promise.race([first, new Promise((r) => setTimeout(r, this.o.firstSyncWaitMs ?? 20_000).unref?.())]);
    if (this.o.poll !== false) this.use(link);
    this.engine = engine;
    return { ...(await this.status()), ...(firstSync ? { firstSync } : {}) };
  }

  private async prefix(): Promise<string | undefined> {
    try {
      const cfg = YAML.parse(await fs.readFile(path.join(this.root, "config.yaml"), "utf8")) as { prefix?: string } | null;
      return cfg?.prefix;
    } catch {
      return undefined;
    }
  }
}

/** The scope's JQL built and, where the transport has `jql/parse`, parsed: a refusal is the person's to fix. */
async function checked(engine: SyncEngine): Promise<void> {
  const problem = await engine.checkScope();
  if (problem) throw new CommandError("BAD_REQUEST", problem);
}
const opt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const restArgs = (a: Record<string, unknown>) => {
  const o: { site?: string; email?: string; apiToken?: string; cloudId?: string; project?: string } = {};
  for (const k of ["site", "email", "apiToken", "cloudId", "project"] as const) { const v = opt(a[k]); if (v) o[k] = v; }
  return o;
};
/** The issue a command names: its Jira key, or its hive id (the key it was mirrored under) when the
 *  start-work guard asks. */
const issueKey = (a: Record<string, unknown>): string => text(a.key ?? a.id, "key").toUpperCase();
const text = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new CommandError("BAD_REQUEST", `${name} is required`);
  return v.trim();
};
const board = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number.isInteger(Number(v)) ? Number(v) : (() => { throw new CommandError("BAD_REQUEST", "boardId is a number"); })());
const SPRINTS = ["open", "open+future", "open+future+backlog"] as const;
/** `sprints` and `excludedTypes` as asked, else as they were. */
function scopeExtras(a: Record<string, unknown>, before?: Link): Pick<Link, "sprints" | "excludedTypes"> {
  if (a.sprints !== undefined && !SPRINTS.includes(a.sprints as Sprints)) throw new CommandError("BAD_REQUEST", `sprints is one of ${SPRINTS.join(", ")}`);
  if (a.excludedTypes !== undefined && !(Array.isArray(a.excludedTypes) && a.excludedTypes.every((t) => typeof t === "string" && t.trim()))) throw new CommandError("BAD_REQUEST", "excludedTypes is a list of issue type names");
  const sprints = (a.sprints as Sprints | undefined) ?? before?.sprints;
  const excluded = (a.excludedTypes as string[] | undefined) ?? before?.excludedTypes;
  return { ...(sprints ? { sprints } : {}), ...(excluded?.length ? { excludedTypes: excluded } : {}) };
}
function proposal(v: unknown): WorkflowProposal {
  const problems = proposalProblems(v);
  if (problems.length) throw new CommandError("BAD_REQUEST", `workflow: ${problems.join("; ")}`);
  return v as WorkflowProposal;
}
function scope(v: unknown): Scope {
  const s = (typeof v === "string" ? { kind: v } : v) as { kind?: string; jql?: string } | null;
  switch (s?.kind) {
    case "mine": case "mine+unassigned": case "all": return { kind: s.kind };
    case "jql":
      if (!s.jql?.trim()) throw new CommandError("BAD_REQUEST", "a JQL scope needs its jql");
      return { kind: "jql", jql: s.jql };
    default: throw new CommandError("BAD_REQUEST", "scope is mine, mine+unassigned, all or {kind: jql, jql}");
  }
}

export function asCommandError(e: unknown): CommandError {
  if (e instanceof CommandError) return e;
  if (e instanceof TransportError) {
    switch (e.kind) {
      case "auth": case "consent": case "forbidden": return new CommandError("FORBIDDEN", e.message);
      case "not-found": return new CommandError("NOT_FOUND", e.message);
      case "rate-limited": return new CommandError("RATE_LIMITED", e.message);
      case "unavailable": return new CommandError("UNAVAILABLE", e.message);
      default: return new CommandError("FAILED", e.message);
    }
  }
  if (e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string") {
    const code = (e as { code: string }).code;
    if (["BAD_REQUEST", "NOT_FOUND", "FORBIDDEN", "UNAVAILABLE", "RATE_LIMITED", "TIMEOUT"].includes(code)) return new CommandError(code as CommandError["code"], (e as unknown as Error).message);
  }
  return new CommandError("FAILED", (e as Error)?.message ?? String(e));
}
