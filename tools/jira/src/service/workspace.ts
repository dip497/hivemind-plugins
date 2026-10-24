// The Jira service for one workspace: its link to a Jira project, its poll, and the commands the
// tile, `hive ctl plugin call @dip497/jira <command>` and the start-work guard ask of it
// (commands.ts). Nothing runs for a workspace until `configure` links it.
import { promises as fs, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { Commands, Scope, ServiceStatus } from "./commands.js";
import { TransportError } from "./transport.js";
import type { Account } from "./account.js";
import type { Logger } from "./log.js";
import { nextDelayMs } from "./engine/cadence.js";
import { Store, sourceId, type Link } from "./engine/store.js";
import { SyncEngine, fieldsOf, type Host, type SyncReport } from "./engine/sync.js";

/** A refusal in the drive's words: `plugin.answer`'s `{error: {code, message}}`. */
export class CommandError extends Error {
  constructor(readonly code: "BAD_REQUEST" | "NOT_FOUND" | "FAILED" | "FORBIDDEN" | "TIMEOUT" | "UNAVAILABLE" | "UNSUPPORTED" | "RATE_LIMITED", message: string) {
    super(message);
  }
}

/** The commands as the app names them (lowercase, dashes), each to its `Commands` entry. */
export const COMMANDS: { name: string; command: keyof Commands; description: string; args?: string }[] = [
  { name: "status", command: "status", description: "Connection, last and next sync, counts, budget and what's wrong" },
  { name: "sign-in", command: "signIn", description: "Start Sign in with Atlassian: answers the page to open", args: "{site?}" },
  { name: "sign-out", command: "signOut", description: "Forget the Atlassian sign-in" },
  { name: "discover", command: "discover", description: "Read a project's workflow, boards and fields; propose the statuses (writes nothing)", args: "{project, boardId?}" },
  { name: "configure", command: "configure", description: "Link this workspace to a Jira project and pull it", args: "{project, boardId?, scope, push}" },
  { name: "sync-now", command: "syncNow", description: "Pull from Jira now", args: "{reconcile?}" },
  { name: "browse", command: "browse", description: "Jira's issues for a scope or JQL, live, without importing", args: "{scope?, jql?, pageToken?}" },
  { name: "track", command: "track", description: "Import one Jira issue and keep it", args: "{key}" },
  { name: "refresh", command: "refresh", description: "Read one issue from Jira now (the start-work guard)", args: "{key}" },
  { name: "assign-me", command: "assignMe", description: "Assign an issue to you in Jira (comes with push)", args: "{key}" },
  { name: "conflicts", command: "conflicts", description: "Issues whose status moved both in Jira and in hive" },
  { name: "resolve", command: "resolve", description: "Settle a status conflict", args: "{id, keep: jira|hive}" },
];

/** The drive methods the service uses for one workspace. */
export interface Drive {
  call<T = unknown>(method: string, ...params: unknown[]): Promise<T>;
}

export function hostOver(drive: Drive, root: string): Host {
  return {
    ingest: (source, records) => drive.call("issue.ingest", root, source, records),
    statusesInUse: async () => (await drive.call<{ status?: string; state?: string }[]>("issue.list", root)).flatMap((i) => [i.status, i.state].filter((s): s is string => !!s)),
    setStatus: async (id, status) => { await drive.call("issue.update", root, id, { status }); },
  };
}

const ACTIVE_FOR = 2 * 60_000;

export interface WorkspaceOptions {
  repo: string;
  account: Account;
  host: Host;
  log: Logger;
  now?: () => number;
  /** Polls on a timer (off in tests that drive passes themselves). */
  poll?: boolean;
  /** How long `configure` waits for its first sync before answering. */
  firstSyncWaitMs?: number;
}

export class Workspace {
  readonly root: string;
  readonly store: Store;
  private engine?: SyncEngine;
  private timer?: ReturnType<typeof setTimeout>;
  private watcher?: FSWatcher;
  private lastAsked = 0;
  private failures = 0;
  private nextAt?: number;
  private callsLast = 0;
  private stopped = false;

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

  private use(link: Link): void {
    this.engine = undefined;
    this.watcher?.close();
    this.watcher = undefined;
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
    this.engine = new SyncEngine({ store: this.store, link, transport: this.o.account.transport(link.site), host: this.o.host, log: (m, d) => this.log(m, d), ...(this.o.now ? { now: this.o.now } : {}) });
    return this.engine;
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
    } catch (e) {
      if (e instanceof TransportError && e.kind === "rate-limited") rateLimitedMs = e.retryAfterMs ?? 60_000;
      else this.failures++;
      this.log("sync failed", e);
      if (this.engine && e instanceof Error && !this.engine.problems.includes(e.message)) this.engine.problems = [e.message, ...this.engine.problems];
    } finally {
      this.callsLast = Math.max(0, this.o.account.limiter.usage().used - before);
      if (this.o.account.signedIn) {
        this.schedule(nextDelayMs({ active: this.now() - this.lastAsked < ACTIVE_FOR, callsPerPass: this.callsLast, budget: this.o.account.options.mcpBudget, ...(rateLimitedMs ? { rateLimitedMs } : {}), failures: this.failures }));
      }
    }
    return report;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.watcher?.close();
  }

  // ── commands ────────────────────────────────────────────────────────────────────────────────

  async handle(name: string, args: unknown): Promise<unknown> {
    this.lastAsked = this.now();
    const c = COMMANDS.find((x) => x.name === name || x.command === name);
    if (!c) throw new CommandError("NOT_FOUND", `the Jira service has no command ${name}`);
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    try {
      return await this.run(c.command, a);
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
      case "signIn": return this.o.account.signIn();
      case "signOut": { await this.o.account.signOut(); this.engine = undefined; return { ok: true }; }
      case "discover": return this.discover(text(a.project, "project").toUpperCase(), board(a.boardId));
      case "configure": return this.configure(a);
      case "syncNow": {
        const { engine } = await this.linked();
        const r = await engine.sync({ reconcile: a.reconcile === true });
        this.schedule(nextDelayMs({ active: true, callsPerPass: this.callsLast, budget: this.o.account.options.mcpBudget }));
        return r;
      }
      case "browse": {
        const { engine } = await this.linked();
        return engine.browse({ ...(a.scope ? { scope: scope(a.scope) } : {}), ...(typeof a.jql === "string" ? { jql: a.jql } : {}), ...(typeof a.pageToken === "string" ? { pageToken: a.pageToken } : {}) });
      }
      case "track": return (await this.linked()).engine.pullOne(text(a.key, "key"), true);
      case "refresh": return (await this.linked()).engine.pullOne(text(a.key, "key"), false);
      case "assignMe": throw new CommandError("UNSUPPORTED", "assigning in Jira comes with push, which this version of the Jira service doesn't do yet");
      case "conflicts": {
        const link = await this.store.link();
        return link ? this.store.conflicts(link.source) : [];
      }
      case "resolve": {
        const { link } = await this.linked();
        const id = text(a.id, "id");
        if (a.keep === "hive") throw new CommandError("UNSUPPORTED", "Keep hive sends hive's status to Jira, which comes with push; until then Keep Jira, or leave it");
        if (a.keep !== "jira") throw new CommandError("BAD_REQUEST", "keep is jira or hive");
        const c = (await this.store.conflicts(link.source)).find((x) => x.id === id);
        if (!c) throw new CommandError("NOT_FOUND", `${id} has no status conflict`);
        await this.o.host.setStatus(id, c.remote);
        return { ok: true };
      }
    }
  }

  private async status(): Promise<ServiceStatus> {
    const link = await this.store.link();
    const account = this.o.account;
    const problems: string[] = [];
    const p = account.problem();
    if (p) problems.push(p);
    if (!link) problems.push("not linked to a Jira project: configure it in the Jira tile");
    const out: ServiceStatus = { connected: !p, transport: account.options.transport, problems };
    const usage = account.limiter.usage();
    out.budget = usage;
    const paused = account.limiter.rateLimitedUntil();
    if (paused) out.rateLimitedUntil = new Date(paused).toISOString();
    if (!link) return out;
    out.site = link.site;
    out.project = link.project;
    const schema = await this.store.schema(link.source);
    if (schema) out.me = schema.discovered.me.displayName;
    const state = await this.store.state(link.source);
    if (state.lastSync) out.lastSync = state.lastSync;
    if (this.nextAt && this.nextAt > this.now()) out.nextSync = new Date(this.nextAt).toISOString();
    const mirrored = Object.values(state.mirrored);
    out.counts = { mirrored: mirrored.filter((m) => !m.archived).length, archived: mirrored.filter((m) => !!m.archived).length, conflicts: (await this.store.conflicts(link.source)).length };
    if (this.engine) problems.push(...this.engine.problems.filter((x) => !problems.includes(x)));
    return out;
  }

  private async siteNow(site?: string): Promise<{ site: string; cloudId: string; siteUrl: string }> {
    const want = site || this.o.account.options.site;
    const s = await this.o.account.transport(want).site();
    return { site: new URL(s.siteUrl).host, ...s };
  }

  private async discover(project: string, boardId?: number): Promise<Commands["discover"]["out"]> {
    const link = await this.store.link();
    const s = await this.siteNow(link?.site);
    const temp: Link = { v: 1, source: sourceId(s.site, project), site: s.site, cloudId: s.cloudId, project, ...(boardId !== undefined ? { boardId } : {}), scope: link?.scope ?? { kind: "mine" }, push: link?.push ?? this.o.account.options.push };
    const engine = new SyncEngine({ store: this.store, link: temp, transport: this.o.account.transport(s.site), host: this.o.host, log: (m, d) => this.log(m, d) });
    const d = await this.o.account.transport(s.site).discover(project, boardId);
    const { workflow, notes } = await engine.propose(d);
    return { proposal: { workflow, notes, board: d.board ?? null, fields: fieldsOf(d) }, boards: d.boards.map((b) => ({ id: b.id, name: b.name, type: b.type })) };
  }

  private async configure(a: Record<string, unknown>): Promise<ServiceStatus> {
    const project = text(a.project, "project").toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,254}$/.test(project)) throw new CommandError("BAD_REQUEST", `${project} is not a Jira project key`);
    const prefix = await this.prefix();
    if (prefix && prefix.toUpperCase() === project) throw new CommandError("BAD_REQUEST", `${project} is this workspace's own issue prefix; mirror ${project} into a workspace with another prefix`);
    const push = (["off", "status", "status+comments", "full"] as const).find((p) => p === a.push) ?? this.o.account.options.push;
    const s = await this.siteNow();
    const before = await this.store.link();
    const link: Link = {
      v: 1, source: sourceId(s.site, project), site: s.site, cloudId: s.cloudId, project,
      ...(board(a.boardId) !== undefined ? { boardId: board(a.boardId) } : {}),
      scope: a.scope === undefined ? { kind: this.o.account.options.scope, ...(this.o.account.options.scope === "jql" ? { jql: this.o.account.options.jql } : {}) } as Scope : scope(a.scope),
      push,
      ...(before?.excludedTypes ? { excludedTypes: before.excludedTypes } : {}),
    };
    // The JQL is built now, so a bad scope is refused before anything is written.
    new SyncEngine({ store: this.store, link, transport: this.o.account.transport(s.site), host: this.o.host, log: this.o.log }).scopeJql();
    await this.store.saveLink(link);
    this.engine = undefined;
    const engine = this.engineFor(link);
    await engine.discover();
    const first = engine.sync({ reconcile: true }).catch((e: unknown) => this.log("first sync failed", e));
    await Promise.race([first, new Promise((r) => setTimeout(r, this.o.firstSyncWaitMs ?? 20_000).unref?.())]);
    if (this.o.poll !== false) this.use(link);
    this.engine = engine;
    return this.status();
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

const text = (v: unknown, name: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new CommandError("BAD_REQUEST", `${name} is required`);
  return v.trim();
};
const board = (v: unknown): number | undefined => (v === undefined || v === null || v === "" ? undefined : Number.isInteger(Number(v)) ? Number(v) : (() => { throw new CommandError("BAD_REQUEST", "boardId is a number"); })());
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
    if (["BAD_REQUEST", "NOT_FOUND", "FORBIDDEN", "UNAVAILABLE", "RATE_LIMITED", "TIMEOUT"].includes(code)) return new CommandError(code as CommandError["code"], (e as Error).message);
  }
  return new CommandError("FAILED", (e as Error)?.message ?? String(e));
}
