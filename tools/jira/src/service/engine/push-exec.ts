// The push engine's seam (design §8): the engine (push.ts) owns the queue, its timing and retries, and
// hands each due item to the executor for its kind. Status pushes (transitions) are the engine's own
// executor; comments, PR links and the `hivemind` entity property are executors of their own
// (push-side.ts). Each says what became of the item; the engine does the rest (done, retry with
// backoff, or hold it for the person).
import type { JiraTransport } from "../transport.js";
import type { PushItem, PushKind } from "./push-queue.js";

export type PushOutcome =
  /** Jira has it: the item is taken off the queue. `activity` is written on the issue (`hive→jira`). */
  | { kind: "done"; activity?: string }
  /** Try again later (rate limits, a 409, Jira unavailable): with backoff, `retryAfterMs` when known. */
  | { kind: "retry"; reason: string; retryAfterMs?: number }
  /** Stopped for the person (a screen to fill, a path to confirm): held until the item changes or
   *  the person answers. `form` is what the tile asks. */
  | { kind: "waiting"; message: string; form?: PushForm }
  /** Jira refused for good (a condition, a misconfigured workflow, a per-issue cap): the engine
   *  undoes what it can locally and writes `message` in the issue's activity. `revertTo`: the status
   *  hive puts back (a status push that got part of the way: where Jira is now). */
  | { kind: "refused"; message: string; revertTo?: string };

/** What a waiting status push asks the person: one field per required screen field, or (no
 *  fields) only an OK for `path`, a way of several transitions. */
export interface PushForm {
  transition: { id: string; name: string; to: string };
  fields: { id: string; name: string; required: boolean; kind: "choice" | "text"; choices?: { id?: string; name: string }[]; value?: string }[];
  /** The transitions the push takes, in order, when there are more than one. */
  path?: { id: string; name: string; to: string }[];
}

export interface PushContext {
  transport: JiraTransport;
  /** The workspace's issue as hive has it now (frontmatter + sections), by hive id. */
  issue(id: string): Promise<unknown>;
  /** Write on the issue through the drive (`issue.update` / `issue.comment`), signed `hive→jira`. */
  writeIssue(id: string, patch: Record<string, unknown>, note?: string): Promise<void>;
  /** The person's answer to a form, when they gave one (field id → value). */
  answer?: Record<string, string>;
  now(): number;
  log(message: string, detail?: unknown): void;
}

export interface PushExecutor {
  readonly kind: PushKind;
  execute(item: PushItem, ctx: PushContext): Promise<PushOutcome>;
}
