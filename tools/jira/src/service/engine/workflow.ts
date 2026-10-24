// From what discovery read to hive's `.hivemind/workflow.yaml` (design §4.1, §4.2, §6.2). Pure: the
// caller reads the files and writes the result.
//
// - Jira's statuses become `jira:<id>` statuses, each in a category (`categorize`).
// - The person's part is kept: statuses that aren't Jira's (`hive:*`), `local`, colours, and a
//   category they changed from what discovery proposed last time.
// - A Jira status that's gone is retired, never removed, while an issue still uses it.
// - A hive-only "PR Created" (in review) follows the first review-category Jira status.
// - Every category keeps a status: one Jira lacks gets hive's built-in one.

export type Category = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export const CATEGORIES: readonly Category[] = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled"];

export interface WfStatus {
  id: string;
  name: string;
  category: Category;
  source: string;
  color?: string;
  jira?: { follow: string } | "stay";
  retired?: boolean;
  [k: string]: unknown;
}
export interface WfTransition { id: string; name?: string; from: "*" | string[]; to: string; [k: string]: unknown }
export interface Workflow {
  version: 1;
  statuses: WfStatus[];
  issueTypes: Record<string, { statuses: string[]; initial?: string; transitions: WfTransition[]; [k: string]: unknown }>;
  board?: { id?: number | string; type?: string; columns: { name: string; statuses: string[] }[]; [k: string]: unknown };
  local: { onPrOpened?: string; onPrMerged?: string; onPrClosed?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** What discovery feeds the workflow (a narrowing of `Discovered`). */
export interface StatusSource {
  issueTypes: { id: string; name: string; statuses: { id: string; name: string; categoryKey: string }[] }[];
  resolutions: { id: string; name: string }[];
  board?: { id: number; type: string; columns: { name: string; statuses: string[] }[] };
}

const BUILTIN_NAMES: Record<Category, string> = { backlog: "Backlog", todo: "Todo", in_progress: "In progress", in_review: "In review", done: "Done", cancelled: "Cancelled" };

/** An in-progress status whose name says it's being checked (the person can change it). */
export const REVIEW = /\b(review|qa|test(ing)?|verif\w*|approv\w*|validat\w*)\b/i;
/** A done status that means dropped: the usual "cancelled" resolutions, by name. */
export const CANCELLED = /\b(won'?t\s*(do|fix)|cancel+ed|cancel+ation|rejected|declined|duplicate|cannot\s+reproduce|abandoned|obsolete|invalid)\b/i;

export const PR_CREATED = "hive:pr-created";

const jid = (id: string) => `jira:${id}`;

/**
 * The Kanban backlog column's statuses: the first column, named Backlog. With statuses, those are the
 * backlog (design §6.2); empty, it's the placeholder Jira always puts there, and like any empty
 * column it isn't one of hive's.
 */
export function kanbanBacklog(board: StatusSource["board"]): Set<string> {
  const first = board?.type === "kanban" ? board.columns[0] : undefined;
  return first && /^backlog$/i.test(first.name.trim()) ? new Set(first.statuses) : new Set();
}

/** The category of a Jira status (design §4.1), and a note when the guess deserves a look. */
export function categorize(s: { id: string; name: string; categoryKey: string }, ctx: { board?: StatusSource["board"]; cancelled: string[] }): { category: Category; note?: string } {
  const onBoard = !ctx.board || ctx.board.columns.some((c) => c.statuses.includes(s.id));
  if (kanbanBacklog(ctx.board).has(s.id)) return { category: "backlog" };
  switch (s.categoryKey) {
    case "new":
      return { category: onBoard ? "todo" : "backlog" };
    case "indeterminate":
      return { category: REVIEW.test(s.name) ? "in_review" : "in_progress" };
    case "done":
      // A done status named like a cancelled resolution: the person's list, or `defaultCancelled`.
      return { category: ctx.cancelled.some((r) => r.toLowerCase() === s.name.toLowerCase()) ? "cancelled" : "done" };
    default:
      // Jira's "No Category" (`undefined`), or a key it hasn't used before.
      return { category: "todo", note: `${s.name} has no status category in Jira (${s.categoryKey}); it is put in todo — change it in the Mapping tab if that's wrong` };
  }
}

export interface BuildInput {
  discovered: StatusSource;
  /** The workflow on disk now, if any. */
  existing?: Workflow;
  /** Status ids some issue has now (its `status` or Jira's `remoteStatus`). */
  used: ReadonlySet<string>;
  /** The categories discovery proposed last time, by status id (schema.json): one the person
   *  changed since is theirs and kept. */
  proposedBefore?: Record<string, Category>;
  /** The resolutions the person counts as cancelled; absent = the usual names. */
  cancelled?: string[];
}

export interface BuildResult {
  workflow: Workflow;
  /** What discovery proposes this time, by status id, for the next run to compare against. */
  proposed: Record<string, Category>;
  notes: string[];
}

/** The resolutions counted as cancelled until the person says otherwise: those with the usual
 *  names, and done statuses so named (MCP can't list resolutions). */
export function defaultCancelled(d: StatusSource): string[] {
  const names = [...d.resolutions.map((r) => r.name), ...d.issueTypes.flatMap((t) => t.statuses.filter((s) => s.categoryKey === "done").map((s) => s.name))];
  return [...new Set(names.filter((n) => CANCELLED.test(n)))];
}

export function buildWorkflow({ discovered, existing, used, proposedBefore = {}, cancelled: chosen }: BuildInput): BuildResult {
  const notes: string[] = [];
  const cancelled = chosen ?? defaultCancelled(discovered);
  const board = discovered.board;

  // Every Jira status once, in board-column order, then the rest by category and name.
  const all = new Map<string, { id: string; name: string; categoryKey: string }>();
  for (const t of discovered.issueTypes) for (const s of t.statuses) if (!all.has(s.id)) all.set(s.id, s);
  const boardOrder = (board?.columns ?? []).flatMap((c) => c.statuses);
  const proposed: Record<string, Category> = {};
  const fresh: WfStatus[] = [];
  for (const s of all.values()) {
    const c = categorize(s, { board, cancelled });
    if (c.note) notes.push(c.note);
    proposed[jid(s.id)] = c.category;
    fresh.push({ id: jid(s.id), name: s.name, category: c.category, source: "jira" });
  }
  const rank = (s: WfStatus) => {
    const i = boardOrder.indexOf(s.id.slice(5));
    return i >= 0 ? i : boardOrder.length + CATEGORIES.indexOf(s.category);
  };
  fresh.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  const before = new Map((existing?.statuses ?? []).map((s) => [s.id, s]));
  const jiraStatuses: WfStatus[] = fresh.map((s) => {
    const old = before.get(s.id);
    if (!old || old.source !== "jira") return s;
    // The person's: a category changed from what was proposed, a colour, keys hive doesn't know.
    const theirs = proposedBefore[s.id] !== undefined && old.category !== proposedBefore[s.id];
    const { retired: _r, ...kept } = old;
    return { ...kept, name: s.name, category: theirs ? old.category : s.category, source: "jira" };
  });
  const freshIds = new Set(fresh.map((s) => s.id));
  // Gone from Jira: retired while an issue still has it, else dropped.
  for (const old of existing?.statuses ?? []) {
    if (old.source !== "jira" || freshIds.has(old.id)) continue;
    if (used.has(old.id)) {
      jiraStatuses.push({ ...old, retired: true });
      notes.push(`${old.name} (${old.id}) is no longer in Jira; kept, retired, while an issue still has it`);
    }
  }
  const hiveStatuses = (existing?.statuses ?? []).filter((s) => s.source !== "jira");

  // PR Created follows the team's review status (decided 2026-10-24, design §17.3).
  const reviewStatus = jiraStatuses.find((s) => s.category === "in_review" && !s.retired);
  // Added once; a person who removed it has it removed.
  const removedByPerson = !!existing && proposedBefore[PR_CREATED] !== undefined && !before.has(PR_CREATED);
  if (!before.has(PR_CREATED) && !removedByPerson) {
    hiveStatuses.push({ id: PR_CREATED, name: "PR Created", category: "in_review", source: "hive", jira: reviewStatus ? { follow: reviewStatus.id } : "stay" });
  }
  if (!removedByPerson) proposed[PR_CREATED] = "in_review";

  // Place hive's statuses after the Jira status they follow, or at the end.
  const statuses: WfStatus[] = [...jiraStatuses];
  for (const h of hiveStatuses) {
    const follow = h.jira && h.jira !== "stay" ? h.jira.follow : undefined;
    const at = follow ? statuses.findIndex((s) => s.id === follow) : -1;
    if (at >= 0) statuses.splice(at + 1, 0, h);
    else statuses.push(h);
  }
  // A follow pointing at a status that no longer exists: PR Created moves to the review status, any
  // other stays where it is in Jira.
  const ids = new Set(statuses.map((s) => s.id));
  for (const s of statuses) {
    if (!s.jira || s.jira === "stay" || ids.has(s.jira.follow)) continue;
    if (s.id === PR_CREATED && reviewStatus) s.jira = { follow: reviewStatus.id };
    else {
      notes.push(`${s.name} followed ${s.jira.follow}, which is gone from Jira; it now stays put in Jira`);
      s.jira = "stay";
    }
  }
  for (const c of CATEGORIES) {
    if (statuses.some((s) => s.category === c && !s.retired)) continue;
    if (!ids.has(c)) statuses.push({ id: c, name: BUILTIN_NAMES[c], category: c, source: "hive" });
    else statuses.find((s) => s.id === c)!.retired = undefined;
  }
  for (const s of statuses) if (s.retired === undefined) delete s.retired;

  // Per issue type: its statuses, and hive's that follow one of them. Learned transitions stay.
  const issueTypes: Workflow["issueTypes"] = {};
  for (const [k, v] of Object.entries(existing?.issueTypes ?? {})) if (!k.startsWith("jira:")) issueTypes[k] = v;
  for (const t of discovered.issueTypes) {
    const key = `jira:${t.id}`;
    const own = t.statuses.map((s) => jid(s.id));
    const followers = statuses.filter((s) => s.source !== "jira" && s.jira && s.jira !== "stay" && own.includes(s.jira.follow)).map((s) => s.id);
    if (own.length === 0) continue;
    issueTypes[key] = { ...(existing?.issueTypes[key] ?? {}), statuses: [...own, ...followers], transitions: existing?.issueTypes[key]?.transitions ?? [] };
  }

  // The board's columns, with hive's statuses beside what they follow; none without a board.
  let wfBoard: Workflow["board"];
  if (board) {
    const columns = board.columns
      .map((c) => {
        const st = c.statuses.map(jid);
        for (const s of statuses) if (s.source !== "jira" && s.jira && s.jira !== "stay" && st.includes(s.jira.follow) && !st.includes(s.id)) st.push(s.id);
        return { name: c.name, statuses: st };
      })
      .filter((c) => c.statuses.length > 0);
    // PR Created with no review status to follow sits in the last column before work is done.
    const pr = statuses.find((s) => s.id === PR_CREATED);
    if (pr && !columns.some((c) => c.statuses.includes(PR_CREATED))) {
      const cat = new Map(statuses.map((s) => [s.id, s.category]));
      const open = columns.filter((c) => c.statuses.every((id) => cat.get(id) !== "done" && cat.get(id) !== "cancelled")).at(-1);
      open?.statuses.push(PR_CREATED);
    }
    if (columns.length) wfBoard = { ...(existing?.board ?? {}), id: board.id, type: board.type, columns };
  }

  const hasPr = statuses.some((s) => s.id === PR_CREATED);
  const local = { ...(hasPr ? { onPrOpened: PR_CREATED } : {}), onPrMerged: "category:done", onPrClosed: "category:in_progress", ...(existing?.local ?? {}) };
  const { statuses: _s, issueTypes: _t, board: _b, local: _l, version: _v, ...rest } = existing ?? ({} as Partial<Workflow>);
  const workflow: Workflow = { ...rest, version: 1, statuses, issueTypes, ...(wfBoard ? { board: wfBoard } : {}), local };
  return { workflow, proposed, notes };
}

/** What makes a workflow one the app refuses (design §4.2 "Validation"); empty = fine. */
export function workflowProblems(wf: Workflow): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  for (const s of wf.statuses) {
    if (ids.has(s.id)) out.push(`status id ${s.id} is used twice`);
    ids.add(s.id);
  }
  for (const c of CATEGORIES) if (!wf.statuses.some((s) => s.category === c && !s.retired)) out.push(`category ${c} has no status`);
  for (const s of wf.statuses) if (s.jira && s.jira !== "stay" && !ids.has(s.jira.follow)) out.push(`${s.id} follows unknown ${s.jira.follow}`);
  for (const c of wf.board?.columns ?? []) for (const s of c.statuses) if (!ids.has(s)) out.push(`board column ${c.name} names unknown ${s}`);
  for (const [k, t] of Object.entries(wf.issueTypes)) for (const s of t.statuses) if (!ids.has(s)) out.push(`issue type ${k} names unknown ${s}`);
  return out;
}
