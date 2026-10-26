// The push engine (design §8): what hive changed on a mirrored issue, told to Jira. It follows the
// workspace's `issue.changed` events, queues what Jira doesn't have yet (`sync/<slug>/queue.jsonl`,
// which survives restarts), and runs each item when it is due through the executor for its kind:
// status here (push-status.ts), comments, PR links and the `hivemind` property next to it.
//
// - A status Jira already has is never queued: ingest writes Jira's status as `external.remoteStatus`
//   in the same file write as the status itself, so its own writes don't echo back, and a move back
//   to where Jira is drops the push.
// - A change waits 5 s and merges with later ones of the same issue: the last target wins.
// - A failure is retried with backoff (or when Jira's Retry-After says); a screen or a way to
//   confirm holds the item for the person (`answer`); a refusal puts hive's status back and writes
//   Jira's words in the issue's activity. Every write to Jira gets an activity row `hive→jira`.
// - Push modes: `off` sends nothing, `status` only statuses, the others the side channels too.
// - Conflicts (§8.3) are ingest's to find; Keep hive pushes hive's status, and a conflict left a
//   day keeps Jira's.
import path from "node:path";
import type { Push } from "../commands.js";
import type { JiraTransport } from "../transport.js";
import type { Logger } from "../log.js";
import type { PushContext, PushExecutor, PushForm, PushOutcome } from "./push-exec.js";
import { jiraTargetOf } from "./push-plan.js";
import { PushQueue, type PushItem, type PushKind } from "./push-queue.js";
import { StatusExecutor, type HiveIssue } from "./push-status.js";
import type { Link, Store } from "./store.js";

/** What the engine asks of hive, over the drive. */
export interface PushHost {
  /** `issue.read`: null when there is no such issue. */
  read(id: string): Promise<HiveIssue | null>;
  /** `issue.update`. */
  update(id: string, patch: Record<string, unknown>): Promise<void>;
  /** `issue.comment`: one activity row. */
  note(id: string, message: string): Promise<void>;
  /** The ids agents sign their activity rows with (`agent.startable`'s programs). */
  agents?(): Promise<string[]>;
}

/** What each push mode sends (design §8, §17: `status` by default). */
export const PUSH_KINDS: Record<Push, readonly PushKind[]> = {
  off: [],
  status: ["status"],
  "status+comments": ["status", "comment", "link", "property"],
  full: ["status", "comment", "link", "property"],
};

export const DEBOUNCE_MS = 5_000;
/** A conflict nobody answered for this long keeps Jira's status (design §8.3). */
export const KEEP_JIRA_AFTER_MS = 24 * 3_600_000;
const MAX_BACKOFF_MS = 30 * 60_000;
/** Agents hive starts, for when the host can't list them. */
const KNOWN_AGENTS = ["claude", "codex", "pi", "droid", "gemini", "amp", "opencode", "cursor", "kiro", "copilot", "goose", "aider"];

/** The n-th retry's wait (n from 1): 5 s, doubling, 30 min at most. */
export const backoffMs = (n: number) => Math.min(MAX_BACKOFF_MS, 5_000 * 2 ** Math.max(0, n - 1));

/** A waiting or queued push, as the tile lists it. */
export interface PendingPush {
  key: string;
  kind: PushKind;
  issue: string;
  status?: string;
  due: string;
  attempts: number;
  by?: string;
  error?: string;
  waiting?: { message: string; since: string; form?: PushForm };
}

export interface PushEngineOptions {
  store: Store;
  link: Link;
  transport: JiraTransport;
  host: PushHost;
  log: Logger;
  now?: () => number;
  /** Take several screen-free transitions without asking (a setting, default on). */
  autoPath?: () => boolean;
  /** Run due items on a timer; off in tests, which call `runDue`. */
  timers?: boolean;
  /** Ask the pull to run now (Jira moved too, design §8.3). */
  pull?: () => void;
}

/** Who moved an issue's status last: the signer of its newest status (or state) row. */
export function moverOf(issue: HiveIssue): string | undefined {
  const rows = issue.sections?.activity ?? [];
  for (let i = rows.length - 1; i >= 0; i--) if (/^(status|state): /.test(rows[i]!.message)) return rows[i]!.who;
  return undefined;
}

export class PushEngine {
  readonly queue: PushQueue;
  private readonly executors = new Map<PushKind, PushExecutor>();
  private chain: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private agentIds?: Promise<Set<string>>;
  /** Conflicts already settled by the day's default, until the pull clears them. */
  private expired = new Set<string>();

  constructor(private readonly o: PushEngineOptions) {
    this.queue = new PushQueue(path.join(o.store.syncDir(o.link.source), "queue.jsonl"));
    this.register(new StatusExecutor({ store: o.store, link: o.link, autoPath: () => o.autoPath?.() ?? true, pull: () => o.pull?.() }));
  }

  private now(): number {
    return this.o.now ? this.o.now() : Date.now();
  }
  get link(): Link {
    return this.o.link;
  }
  private get source(): string {
    return this.o.link.source;
  }

  /** The executor for a kind (status is the engine's own; comment, link and property are P3b's). */
  register(e: PushExecutor): void {
    this.executors.set(e.kind, e);
  }

  /** Whether the link's push mode sends items of `kind`. */
  sends(kind: PushKind): boolean {
    return PUSH_KINDS[this.o.link.push].includes(kind);
  }

  /** One thing at a time: what hive tells while a push runs waits for it, so a newer move is never
   *  lost under an older push's outcome. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Read the queue (what a stopped service left) and run what's due. */
  async start(): Promise<void> {
    await this.queue.load();
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private schedule(): void {
    if (this.stopped || this.o.timers === false) return;
    clearTimeout(this.timer);
    const due = this.queue.all().filter((i) => !i.waiting && this.sends(i.kind) && this.executors.has(i.kind)).reduce<number | undefined>((a, i) => (a === undefined || i.due < a ? i.due : a), undefined);
    if (due === undefined) return;
    this.timer = setTimeout(() => void this.runDue().catch((e: unknown) => this.o.log("a push failed", e)), Math.max(0, due - this.now()));
    this.timer.unref?.();
  }

  // ── what hive changed ──────────────────────────────────────────────────────────────────────

  /** hive told a change (`issue.changed`): a status Jira doesn't have is queued. */
  changed(change: { id: string; change?: string; fields?: string[] }): Promise<void> {
    if (this.o.link.push === "off" || change.change === "deleted") return Promise.resolve();
    if (change.fields && !change.fields.some((f) => f === "status" || f === "state")) return Promise.resolve();
    return this.serial(async () => {
      await this.queue.load();
      const issue = await this.o.host.read(change.id).catch(() => null);
      if (issue) await this.consider(issue);
      this.schedule();
    });
  }

  private async consider(issue: HiveIssue): Promise<void> {
    const ext = issue.external;
    if (!ext || ext.source !== this.source || (ext as { archived?: unknown }).archived) return;
    const key = `${issue.id}/status`;
    const queued = this.queue.get(key);
    const status = issue.status ?? issue.state;
    // The push itself put hive where Jira stopped part of the way: the rest still waits.
    if (queued?.reached === status) return;
    const wf = await this.o.store.workflow();
    const target = wf ? jiraTargetOf(wf, status) : status;
    // Jira has it (ingest's own write, or a move back), or it is a status Jira doesn't show.
    if (target === null || target === ext.remoteStatus) {
      if (queued && !queued.keep) await this.queue.done(key);
      return;
    }
    // Both sides moved apart: the Conflicts tab has it until the person (or the day) decides.
    if ((await this.o.store.ledgerEntry(this.source, ext.id))?.conflict) return;
    if (queued?.status === status) return; // the same move told again: its timing stands
    const by = moverOf(issue);
    await this.queue.put({
      key, kind: "status", issue: issue.id, extId: ext.id, status,
      due: this.now() + DEBOUNCE_MS, attempts: 0,
      ...(by ? { by } : {}), ...((await this.isAgent(by, issue)) ? { agent: true } : {}),
    });
  }

  private async isAgent(who: string | undefined, issue: HiveIssue): Promise<boolean> {
    if (!who) return false;
    if (issue.assignee?.type === "agent" && issue.assignee.id === who) return true;
    this.agentIds ??= (this.o.host.agents?.() ?? Promise.resolve([])).then((ids) => new Set([...KNOWN_AGENTS, ...ids]), () => new Set(KNOWN_AGENTS));
    return (await this.agentIds).has(who.toLowerCase());
  }

  // ── running ────────────────────────────────────────────────────────────────────────────────

  /** Run every item that is due (not waiting, sent by the push mode, with its executor). */
  runDue(): Promise<number> {
    return this.serial(async () => {
      await this.queue.load();
      let n = 0;
      const due = this.queue.all().filter((i) => !i.waiting && i.due <= this.now() && this.sends(i.kind) && this.executors.has(i.kind)).sort((a, b) => a.due - b.due);
      for (const item of due) {
        if (this.stopped) break;
        await this.run(item);
        n++;
      }
      this.schedule();
      return n;
    });
  }

  private ctx(answer?: Record<string, string>): PushContext {
    return {
      transport: this.o.transport,
      issue: (id) => this.o.host.read(id),
      writeIssue: async (id, patch, note) => {
        if (Object.keys(patch).length) await this.o.host.update(id, patch);
        if (note) await this.o.host.note(id, note);
      },
      ...(answer ? { answer } : {}),
      now: () => this.now(),
      log: (m, d) => this.o.log(m, d),
    };
  }

  private async run(item: PushItem, answer?: Record<string, string>): Promise<PushOutcome | undefined> {
    const ex = this.executors.get(item.kind);
    if (!ex) return undefined;
    let out: PushOutcome;
    try {
      out = await ex.execute(item, this.ctx(answer));
    } catch (e) {
      out = { kind: "retry", reason: e instanceof Error ? e.message : String(e) };
    }
    switch (out.kind) {
      case "done":
        await this.queue.done(item.key);
        if (out.activity) await this.note(item.issue, `hive→jira: ${out.activity}`);
        await this.settled(item.issue);
        break;
      case "retry": {
        const attempts = item.attempts + 1;
        const { waiting: _w, ...rest } = item;
        await this.queue.put({ ...rest, attempts, error: out.reason, due: this.now() + Math.max(out.retryAfterMs ?? 0, backoffMs(attempts)) });
        this.o.log(`${item.key}: retried in ${Math.round(Math.max(out.retryAfterMs ?? 0, backoffMs(attempts)) / 1000)} s: ${out.reason}`);
        break;
      }
      case "waiting":
        await this.queue.put({ ...item, waiting: { message: out.message, since: item.waiting?.since ?? new Date(this.now()).toISOString(), ...(out.form ? { form: out.form } : {}) } });
        break;
      case "refused":
        await this.queue.done(item.key);
        await this.refused(item, out.message, out.revertTo);
        break;
    }
    return out;
  }

  /** Jira said no: hive's status goes back, and Jira's words go in the activity and the tile. */
  /** `cancelled`: the person dropped it; said so, and not kept as a refusal. */
  private async refused(item: PushItem, message: string, revertTo?: string, cancelled = false): Promise<void> {
    const issue = await this.o.host.read(item.issue).catch(() => null);
    let back: string | undefined;
    if (item.kind === "status" && issue?.external) {
      const entry = await this.o.store.ledgerEntry(this.source, item.extId);
      back = revertTo ?? entry?.localStatus ?? issue.external.remoteStatus;
      if (back && back === (issue.status ?? issue.state)) back = undefined;
      if (back) await this.o.host.update(item.issue, { status: back });
    }
    const wf = back ? await this.o.store.workflow() : undefined;
    const name = back ? wf?.statuses.find((s) => s.id === back)?.name ?? back : undefined;
    await this.note(item.issue, `${cancelled ? "hive→jira not sent" : "hive→jira refused"}: ${message}${name ? `; put back to ${name}` : ""}`);
    if (cancelled) return;
    const memo = await this.o.store.pushMemo(this.source);
    memo.refused[item.issue] = { message, at: new Date(this.now()).toISOString(), ...(issue?.external?.url ? { url: issue.external.url } : {}) };
    await this.o.store.savePushMemo(this.source, memo);
  }

  private async settled(issue: string): Promise<void> {
    const memo = await this.o.store.pushMemo(this.source);
    if (!memo.refused[issue]) return;
    delete memo.refused[issue];
    await this.o.store.savePushMemo(this.source, memo);
  }

  private async note(id: string, message: string): Promise<void> {
    await this.o.host.note(id, message).catch((e: unknown) => this.o.log(`${id}: could not write the activity row`, e));
  }

  // ── the person ─────────────────────────────────────────────────────────────────────────────

  /** The person's answer to a waiting push (a screen's fields, or OK for a way of several
   *  transitions): it runs now. `cancel` drops it and puts hive's status back. */
  answer(key: string, values: Record<string, string> = {}, cancel = false): Promise<PushOutcome | { kind: "cancelled" }> {
    return this.serial(async () => {
      await this.queue.load();
      const item = this.queue.get(key);
      if (!item) throw Object.assign(new Error(`nothing waits to be sent as ${key}`), { code: "NOT_FOUND" });
      if (!item.waiting) throw Object.assign(new Error(`${key} isn't waiting for an answer`), { code: "BAD_REQUEST" });
      if (cancel) {
        await this.queue.done(key);
        await this.refused(item, item.waiting.message, undefined, true);
        this.schedule();
        return { kind: "cancelled" as const };
      }
      const out = (await this.run(item, values))!;
      this.schedule();
      return out;
    });
  }

  /** Keep hive on a status conflict: hive's status is sent though Jira moved too. */
  keepHive(id: string): Promise<PushOutcome | undefined> {
    return this.serial(async () => {
      const issue = await this.o.host.read(id);
      if (!issue?.external) throw Object.assign(new Error(`${id} isn't a mirrored issue`), { code: "NOT_FOUND" });
      const item: PushItem = { key: `${id}/status`, kind: "status", issue: id, extId: issue.external.id, status: issue.status ?? issue.state, due: this.now(), attempts: 0, keep: true };
      await this.queue.put(item);
      const out = await this.run(item);
      this.schedule();
      return out;
    });
  }

  /** Conflicts nobody answered for a day keep Jira's status (design §8.3). */
  expireConflicts(): Promise<string[]> {
    return this.serial(async () => {
      const kept: string[] = [];
      for (const c of await this.o.store.conflicts(this.source)) {
        const mark = `${c.id}@${c.since}`;
        if (this.expired.has(mark) || this.now() - Date.parse(c.since) < KEEP_JIRA_AFTER_MS) continue;
        this.expired.add(mark);
        await this.o.host.update(c.id, { status: c.remote });
        await this.note(c.id, "Jira's status kept: the status conflict had no answer for a day");
        kept.push(c.id);
      }
      return kept;
    });
  }

  /** Every queued push, the waiting ones with what they ask, and the refusals still unsettled. */
  async pending(): Promise<{ pushes: PendingPush[]; refused: { id: string; message: string; at: string; url?: string }[] }> {
    await this.queue.load();
    const memo = await this.o.store.pushMemo(this.source);
    return {
      pushes: this.queue.all().map((i) => ({
        key: i.key, kind: i.kind, issue: i.issue, due: new Date(i.due).toISOString(), attempts: i.attempts,
        ...(i.status ? { status: i.status } : {}), ...(i.by ? { by: i.by } : {}), ...(i.error ? { error: i.error } : {}), ...(i.waiting ? { waiting: i.waiting } : {}),
      })),
      refused: Object.entries(memo.refused).map(([id, r]) => ({ id, ...r })),
    };
  }
}
