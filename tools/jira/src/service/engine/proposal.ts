// The workflow as the tile shows and edits it (`WorkflowProposal`, commands.ts), to and from
// `.hivemind/workflow.yaml`. An edit is applied by handing the person's version to `buildWorkflow`
// as the existing workflow, so the one set of rules places hive's statuses, keeps a category the
// person changed and rebuilds the board.
import type { MappedStatus, WorkflowProposal } from "../commands.js";
import type { Discovered } from "../transport.js";
import { CATEGORIES, defaultCancelled, type Category, type WfStatus, type Workflow } from "./workflow.js";

export function toProposal(wf: Workflow, d: Discovered | undefined, cancelled?: string[]): WorkflowProposal {
  const jiraCategory = new Map<string, string>((d?.issueTypes ?? []).flatMap((t) => t.statuses.map((s): [string, string] => [`jira:${s.id}`, s.categoryKey])));
  const statuses: MappedStatus[] = wf.statuses.map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    source: s.source === "jira" ? "jira" : "hive",
    ...(s.color ? { color: s.color } : {}),
    ...(jiraCategory.has(s.id) ? { jiraCategory: jiraCategory.get(s.id)! } : {}),
    ...(s.jira ? { follow: s.jira === "stay" ? "stay" : s.jira.follow } : {}),
    ...(s.retired ? { retired: true } : {}),
  }));
  const b = wf.board;
  return {
    statuses,
    board: b ? { id: Number(b.id), ...(d?.boards.find((x) => x.id === Number(b.id)) ? { name: d.boards.find((x) => x.id === Number(b.id))!.name } : {}), type: String(b.type ?? ""), columns: b.columns.map((c) => ({ name: c.name, statuses: [...c.statuses] })) } : null,
    cancelledResolutions: cancelled ?? (d ? defaultCancelled(d) : []),
    resolutions: [...new Set([...(d?.resolutions ?? []).map((r) => r.name), ...(d ? defaultCancelled(d) : [])])],
    issueTypes: (d?.issueTypes ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

/** A proposal the person sent that isn't one: what's wrong with it. */
export function proposalProblems(p: unknown): string[] {
  const x = p as WorkflowProposal | null;
  if (!x || !Array.isArray(x.statuses)) return ["workflow.statuses is a list"];
  const out: string[] = [];
  for (const s of x.statuses) {
    if (!s || typeof s.id !== "string" || typeof s.name !== "string" || !s.name.trim()) out.push("each status has an id and a name");
    else if (!CATEGORIES.includes(s.category)) out.push(`${s.id}: category is one of ${CATEGORIES.join(", ")}`);
    else if (s.source === "hive" && s.id.startsWith("jira:")) out.push(`${s.id}: a jira: id is Jira's, not a hive-only status`);
  }
  if (x.cancelledResolutions !== undefined && !(Array.isArray(x.cancelledResolutions) && x.cancelledResolutions.every((r) => typeof r === "string"))) out.push("cancelledResolutions is a list of names");
  return out;
}

/** The person's edits laid over the workflow on disk: categories and colours of Jira's statuses,
 *  and hive's own statuses as they listed them. Jira's names, ids and board stay Jira's. */
export function withEdits(wf: Workflow, p: WorkflowProposal): Workflow {
  const sent = new Map(p.statuses.map((s) => [s.id, s]));
  const jira = wf.statuses.filter((s) => s.source === "jira").map((s): WfStatus => {
    const e = sent.get(s.id);
    if (!e) return s;
    const { color: _c, ...rest } = s;
    return { ...rest, category: e.category as Category, ...(e.color ? { color: e.color } : {}) };
  });
  const hive = p.statuses.filter((s) => s.source === "hive").map((s): WfStatus => {
    const old = wf.statuses.find((x) => x.id === s.id && x.source !== "jira");
    const { jira: _j, color: _c, retired: _r, ...kept } = old ?? ({} as Partial<WfStatus>);
    return {
      ...kept,
      id: s.id,
      name: s.name.trim(),
      category: s.category,
      source: "hive",
      ...(s.color ? { color: s.color } : {}),
      ...(s.follow ? { jira: s.follow === "stay" ? "stay" : { follow: s.follow } } : {}),
    };
  });
  return { ...wf, statuses: [...jira, ...hive] };
}
