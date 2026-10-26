// What hive pushes besides statuses (design §8.1): its own comments, the PR's remote link and the
// `hivemind` entity property. The push engine (push.ts) owns the queue; this decides what goes on it
// for a change of an issue (`enqueueSide`) and runs each item (`sideExecutors`).
//
// - Comments (`status+comments`, `full`): hive's own activity rows, by kind (settings): a person's
//   comment, the agent's plan or summary, a PR opened / merged / closed row. Never agent progress
//   chatter, field-change summaries, the service's own rows, or rows that came from Jira. A pushed
//   row's Jira comment id is kept (`sync/<slug>/pushed.json`) and the pull leaves that comment out,
//   so it is never imported back next to the row it came from. (Core has no way to put an id on a
//   row after it was written; with one, the row would carry `<!-- id:jira-c-<id> -->` instead.)
// - The PR link (`push` ≠ off): `globalId github-pr:<org>/<repo>#<n>`, resolved once merged or closed.
// - The property (`push` ≠ off): `hivemind = {hiveVersion, branch, pr, by}`, `by` this install, so
//   another install's guard sees the work is underway (check #10). With a transition, in one write.
import { createHash } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Push } from "../commands.js";
import { TransportError } from "../transport.js";
import type { PushContext, PushExecutor, PushOutcome } from "./push-exec.js";
import type { PushItem, PushQueue } from "./push-queue.js";

/** The entity property's name. */
export const PROPERTY = "hivemind";
/** How long a change waits for the next one before it is pushed. */
export const DEBOUNCE_MS = 5_000;

/** The kinds of activity row there are; only the first three are ever sent, each when the person keeps it on. */
export type RowKind = "comment" | "summary" | "pr" | "chatter" | "system" | "jira";
export type CommentKinds = Record<"comment" | "summary" | "pr", boolean>;
export const DEFAULT_KINDS: CommentKinds = { comment: true, summary: true, pr: true };

export interface Row { at: string; who: string; message: string; id?: string }

/** An issue as the drive's `issue.read` answers it, as much as this reads. */
export interface SideIssue {
  id: string;
  title: string;
  branch?: string | null;
  pr?: { repo: string; number: number; url: string; state: string } | null;
  external?: { id: string; key: string; source: string; archived?: unknown } | null;
  sections?: { activity?: Row[] };
}

/** The `hivemind` property, as every install writes it. */
export interface HiveProperty { hiveVersion: string; branch: string | null; pr: { repo: string; number: number } | null; by: string }

const FIELD_CHANGE = /^(status|state|parent|labels|assignee|github|branch|pr|aliases): /;
const SYSTEM = /^(started\b|key changed: |link \S+ → |unlink → |copied to |PR \S+ merged: remove its worktree)/;
const PR_ROW = /^(opened PR \S+#\d+|PR \S+#\d+ (merged|was closed without merging)$)/;
const SUMMARY = /^\s*(#{1,6}\s*)?\**(plan|summary|done|completed|finished)\b\**\s*[:—–-]?/i;

/**
 * What kind of row this is. Person rows are the person's at this machine (`ui`); anyone else's
 * free text is an agent's, sent only when it opens as a plan or a summary. When unsure, it isn't
 * sent: chatter in a team's Jira is worse than a comment left in hive.
 */
export function rowKind(row: Row): RowKind {
  if (row.id || / \(jira\)$/.test(row.who)) return "jira";
  if (PR_ROW.test(row.message)) return "pr";
  if (row.who === "hive" || row.who.includes("(service)") || FIELD_CHANGE.test(row.message) || SYSTEM.test(row.message)) return "system";
  if (row.who === "ui") return "comment";
  return SUMMARY.test(row.message) ? "summary" : "chatter";
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
/** A row's identity: when, who and what. */
export const rowKey = (r: Row) => sha(`${r.at}\n${r.who}\n${r.message}`).slice(0, 20);
export const globalIdOf = (pr: { repo: string; number: number }) => `github-pr:${pr.repo}#${pr.number}`;
const resolvedOf = (state: string) => state === "merged" || state === "closed";

/** The comment as Jira shows it: the row, and who wrote it in hive when it wasn't the person. */
export function commentBody(row: Row): string {
  const kind = rowKind(row);
  if (kind === "comment") return row.message;
  return `${row.message}\n\n_— ${row.who}${kind === "summary" ? " (agent)" : ""}, in hivemind_`;
}

/** Text as both transports give it back (markdown over MCP, ADF to markdown over REST), compared
 *  without the marks a round trip may change. */
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** This install, for the property's `by`: the same every run on this machine for this person. */
export function installId(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HIVE_INSTALL_ID?.trim()) return env.HIVE_INSTALL_ID.trim();
  let machine = "";
  for (const f of ["/etc/machine-id", "/var/lib/dbus/machine-id"]) {
    try { machine = readFileSync(f, "utf8").trim(); break; } catch { /* not on this system */ }
  }
  let user = "";
  try { user = os.userInfo().username; } catch { /* no user name here */ }
  return `hive-${sha(`${machine}\0${os.hostname()}\0${user}\0${os.homedir()}`).slice(0, 16)}`;
}

// ── what was pushed ─────────────────────────────────────────────────────────────────────────────

interface PushedFile {
  v: 1;
  /** Rows older than this were there before comments were sent: never pushed. */
  commentsSince?: string;
  /** Row key → Jira's comment id. */
  comments: Record<string, string>;
  /** `<issue id>|<globalId>` → the link as last sent. */
  links: Record<string, { resolved: boolean }>;
  /** Jira issue id → the property's branch and PR as last written. */
  properties: Record<string, string>;
}

/** `sync/<slug>/pushed.json`: what the side pushes already did, so none is done twice. */
export class PushedLedger {
  private data?: PushedFile;
  private writing: Promise<unknown> = Promise.resolve();

  constructor(readonly file: string) {}

  private async load(): Promise<PushedFile> {
    if (this.data) return this.data;
    let d: Partial<PushedFile> | undefined;
    try { d = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<PushedFile>; } catch { /* none yet */ }
    this.data ??= { v: 1, comments: d?.comments ?? {}, links: d?.links ?? {}, properties: d?.properties ?? {}, ...(d?.commentsSince ? { commentsSince: d.commentsSince } : {}) };
    return this.data;
  }

  private save(): Promise<void> {
    const run = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(this.data) + "\n", "utf8");
      await fs.rename(tmp, this.file);
    });
    this.writing = run.catch(() => {});
    return run;
  }

  /** Comments are sent from `at` on (`undefined`: not sent); unchanged when already so. */
  async sendCommentsFrom(at: string | undefined): Promise<string | undefined> {
    const d = await this.load();
    if (at === undefined ? d.commentsSince === undefined : d.commentsSince !== undefined) return d.commentsSince;
    if (at === undefined) delete d.commentsSince;
    else d.commentsSince = at;
    await this.save();
    return d.commentsSince;
  }
  async comment(key: string): Promise<string | undefined> {
    return (await this.load()).comments[key];
  }
  async setComment(key: string, id: string): Promise<void> {
    (await this.load()).comments[key] = id;
    await this.save();
  }
  /** Jira's ids of every comment hive sent: the pull leaves them out. */
  async commentIds(): Promise<Set<string>> {
    return new Set(Object.values((await this.load()).comments));
  }
  async link(issue: string, globalId: string): Promise<{ resolved: boolean } | undefined> {
    return (await this.load()).links[`${issue}|${globalId}`];
  }
  async setLink(issue: string, globalId: string, resolved: boolean): Promise<void> {
    (await this.load()).links[`${issue}|${globalId}`] = { resolved };
    await this.save();
  }
  async property(issue: string): Promise<string | undefined> {
    return (await this.load()).properties[issue];
  }
  async setProperty(issue: string, value: string): Promise<void> {
    (await this.load()).properties[issue] = value;
    await this.save();
  }
}

// ── what goes on the queue ──────────────────────────────────────────────────────────────────────

export interface SideOptions {
  /** The link's ingest source: only its mirrored issues are pushed. */
  source: string;
  push: Push;
  kinds?: CommentKinds;
  ledger: PushedLedger;
  now(): number;
}

const commentsOn = (p: Push) => p === "status+comments" || p === "full";
const propertyKey = (p: HiveProperty["pr"], branch: string | null) => JSON.stringify([branch, p ? `${p.repo}#${p.number}` : null]);

/** What a change of `issue` asks to push besides its status: new rows to send as comments, its PR
 *  link when it got a PR or the PR's state changed, and the property when its branch or PR changed.
 *  Nothing for an issue that isn't this source's, or is archived, or when push is off. */
export async function sideItems(issue: SideIssue, o: SideOptions): Promise<PushItem[]> {
  const ext = issue.external;
  // Comments started before this and stopped while off, so a later switch back on doesn't send what was written meanwhile.
  const since = await o.ledger.sendCommentsFrom(commentsOn(o.push) ? new Date(o.now() - 60_000).toISOString() : undefined);
  if (!ext || ext.source !== o.source || ext.archived || o.push === "off") return [];
  const due = o.now() + DEBOUNCE_MS;
  const base = { issue: issue.id, extId: ext.id, due, attempts: 0 };
  const out: PushItem[] = [];
  if (since !== undefined) {
    const kinds = o.kinds ?? DEFAULT_KINDS;
    for (const r of issue.sections?.activity ?? []) {
      if (r.at < since) continue;
      const kind = rowKind(r);
      if (kind !== "comment" && kind !== "summary" && kind !== "pr") continue;
      if (!kinds[kind]) continue;
      const k = rowKey(r);
      if (await o.ledger.comment(k)) continue;
      out.push({ ...base, key: `${issue.id}/comment/${k}`, kind: "comment", row: { at: r.at, who: r.who, message: r.message } });
    }
  }
  const pr = issue.pr ?? null;
  if (pr) {
    const g = globalIdOf(pr);
    const sent = await o.ledger.link(ext.id, g);
    if (!sent || sent.resolved !== resolvedOf(pr.state)) out.push({ ...base, key: `${issue.id}/link/${pr.repo}#${pr.number}`, kind: "link", pr: { repo: pr.repo, number: pr.number, url: pr.url, state: pr.state } });
  }
  const property = { branch: issue.branch ?? null, pr: pr ? { repo: pr.repo, number: pr.number } : null };
  const was = await o.ledger.property(ext.id);
  // Never written and nothing to say: no property at all, rather than an empty one.
  if ((was ?? propertyKey(null, null)) !== propertyKey(property.pr, property.branch)) out.push({ ...base, key: `${issue.id}/property`, kind: "property", property });
  return out;
}

/**
 * The push engine calls this for every `issue.changed` of an issue it read (after its own echo
 * check, whatever the push mode): the side items `sideItems` finds go on `queue`. An item already
 * queued as it is keeps its place and its retries; a changed one (a property, a link's state)
 * replaces it, due again in 5 s.
 */
export async function enqueueSide(queue: PushQueue, issue: SideIssue, o: SideOptions): Promise<PushItem[]> {
  await queue.load();
  const put: PushItem[] = [];
  for (const item of await sideItems(issue, o)) {
    const queued = queue.get(item.key);
    if (queued && JSON.stringify([queued.row, queued.pr, queued.property]) === JSON.stringify([item.row, item.pr, item.property])) continue;
    await queue.put(item);
    put.push(item);
  }
  return put;
}

// ── running them ────────────────────────────────────────────────────────────────────────────────

export interface ExecutorOptions {
  ledger: PushedLedger;
  installId: string;
  hiveVersion: string;
}

/** What a failed write becomes: a retry when Jira may take it later, refused when it never will. */
export function outcomeOf(e: unknown, what: string): PushOutcome {
  if (e instanceof TransportError) {
    switch (e.kind) {
      case "rate-limited": case "unavailable": case "conflict":
        return { kind: "retry", reason: `${what}: ${e.message}`, ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}) };
      case "auth": case "consent":
        return { kind: "retry", reason: `${what}: ${e.message}` };
      default:
        return { kind: "refused", message: `Jira refused ${what}: ${e.message}` };
    }
  }
  return { kind: "retry", reason: `${what}: ${e instanceof Error ? e.message : String(e)}` };
}

/** The property's value for a branch and a PR. */
export const propertyValue = (p: NonNullable<PushItem["property"]>, o: Pick<ExecutorOptions, "installId" | "hiveVersion">): HiveProperty =>
  ({ hiveVersion: o.hiveVersion, branch: p.branch, pr: p.pr ? { repo: p.pr.repo, number: p.pr.number } : null, by: o.installId });

/**
 * For the status executor: the property waiting for `issueId`, to send with its transition in one
 * write (`transition(key, id, fields, properties)`). Once the transition went through, `settle()`
 * records it and takes the item off the queue; when it didn't, the item stays and goes by itself.
 */
export async function bundledProperty(queue: PushQueue, issueId: string, o: ExecutorOptions): Promise<{ properties: Record<string, unknown>; settle(): Promise<void> } | undefined> {
  await queue.load();
  const item = queue.get(`${issueId}/property`);
  if (!item?.property) return undefined;
  const p = item.property;
  return {
    properties: { [PROPERTY]: propertyValue(p, o) },
    settle: async () => {
      await o.ledger.setProperty(item.extId, propertyKey(p.pr, p.branch));
      // Only the item that was sent: a newer one put meanwhile still goes.
      if (queue.get(item.key) === item) await queue.done(item.key);
    },
  };
}

const target = (item: PushItem) => item.extId || item.issue;

class CommentExecutor implements PushExecutor {
  readonly kind = "comment" as const;
  constructor(private readonly o: ExecutorOptions) {}

  async execute(item: PushItem, ctx: PushContext): Promise<PushOutcome> {
    if (!item.row) return { kind: "refused", message: "a comment item without its row" };
    const k = rowKey(item.row);
    if (await this.o.ledger.comment(k)) return { kind: "done" };
    const body = commentBody(item.row);
    try {
      // A try that failed after Jira took it (a kill, a lost answer) left it there: found, not sent twice.
      const found = item.attempts > 0 ? (await ctx.transport.comments(target(item))).find((c) => plain(c.bodyMd) === plain(body)) : undefined;
      const id = found?.id ?? (await ctx.transport.comment(target(item), body)).id;
      await this.o.ledger.setComment(k, id);
      return { kind: "done", activity: `comment sent to Jira (jira-c-${id})` };
    } catch (e) {
      return outcomeOf(e, "the comment");
    }
  }
}

class LinkExecutor implements PushExecutor {
  readonly kind = "link" as const;
  constructor(private readonly o: ExecutorOptions) {}

  async execute(item: PushItem, ctx: PushContext): Promise<PushOutcome> {
    if (!item.pr) return { kind: "refused", message: "a link item without its PR" };
    const pr = item.pr;
    const issue = (await ctx.issue(item.issue)) as SideIssue | null;
    const key = issue?.external?.key ?? item.issue;
    const globalId = globalIdOf(pr);
    const resolved = resolvedOf(pr.state);
    try {
      // Over MCP alone there is no upsert: the transport adds the link only when none has its URL,
      // so a kill between its list and its add can still leave two (design §9.2), and the link's
      // resolved state can't be set there.
      await ctx.transport.remoteLink(target(item), { globalId, url: pr.url, title: `${key}: ${issue?.title ?? pr.url}`, resolved });
      await this.o.ledger.setLink(item.extId, globalId, resolved);
      const upsert = ctx.transport.capabilities.remoteLinkUpsert;
      return { kind: "done", activity: `PR ${pr.repo}#${pr.number} linked in Jira${resolved ? (upsert ? " (resolved)" : " (Jira still shows it open: an API token can mark it resolved)") : ""}` };
    } catch (e) {
      if (e instanceof TransportError && e.status === 413) return { kind: "refused", message: `Jira refused the PR link: ${key} has as many remote links as Jira allows` };
      return outcomeOf(e, "the PR link");
    }
  }
}

class PropertyExecutor implements PushExecutor {
  readonly kind = "property" as const;
  constructor(private readonly o: ExecutorOptions) {}

  async execute(item: PushItem, ctx: PushContext): Promise<PushOutcome> {
    if (!item.property) return { kind: "refused", message: "a property item without its value" };
    const p = item.property;
    try {
      await ctx.transport.setProperty(target(item), PROPERTY, propertyValue(p, this.o));
      await this.o.ledger.setProperty(item.extId, propertyKey(p.pr, p.branch));
      // The property is how other installs see the work; it isn't news on the issue itself.
      return { kind: "done" };
    } catch (e) {
      return outcomeOf(e, "the hivemind property");
    }
  }
}

/** The executors of the side pushes, for the engine's executor table. */
export function sideExecutors(o: ExecutorOptions): PushExecutor[] {
  return [new CommentExecutor(o), new LinkExecutor(o), new PropertyExecutor(o)];
}
