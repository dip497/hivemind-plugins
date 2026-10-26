// The status executor (design §8.2): a hive status pushed to Jira as legal transitions. Jira can't
// set a status, so each push reads where the issue is now and what Jira offers it from there:
//
// - a hive-only status shows in Jira as the one it follows (`jira.follow`), or leaves Jira alone;
// - a transition straight to the target is taken; else the shortest way over the learned graph, 3
//   transitions at most, each one checked against what Jira offers live before it is taken;
// - several transitions are taken on their own only when none has a screen and the person allows it
//   (`autoPath`); else the person confirms the way first;
// - a screen with required fields waits for the person's form, pre-filled from their last answer
//   for that transition (or a resolution named like the target). An agent's move never waits on a
//   form: it stops at the last step without one, for the person to finish;
// - a field Jira requires that isn't on the screen (a hidden validator) is remembered, and the next
//   push through that transition is refused up front with Jira's words;
// - Jira moved too since the last sync: nothing is written; the pull applies the conflict rule
//   (§8.3), unless the person chose Keep hive.
import { TransportError, type Transition } from "../transport.js";
import type { PushContext, PushExecutor, PushForm, PushOutcome } from "./push-exec.js";
import type { PushItem } from "./push-queue.js";
import { fieldValues, findPath, jiraTargetOf, learnTransitions, missing, screenFields, type FormField, type Step } from "./push-plan.js";
import type { Link, PushMemo, Store } from "./store.js";
import type { Workflow } from "./workflow.js";

/** An issue as the drive's `issue.read` answers it: what the push reads of it. */
export interface HiveIssue {
  id: string;
  title: string;
  status?: string;
  state: string;
  assignee?: { type: "agent" | "member"; id: string } | null;
  branch?: string | null;
  pr?: { repo: string; number: number; url: string; state: string } | null;
  external?: { source: string; id: string; key: string; url?: string; type?: { id: string; name: string } | null; remoteStatus?: string; archived?: unknown } | null;
  sections?: { activity?: { at: string; who: string; message: string }[] };
}

export interface StatusExecutorOptions {
  store: Store;
  link: Link;
  /** Take several screen-free transitions without asking. */
  autoPath(): boolean;
  /** Jira moved too: ask for a pull, which applies the conflict rule. */
  pull(): void;
  /** The `hivemind` property waiting for the issue, to send with its transition in one write
   *  (design §8.1, the per-issue write limit); `settle()` once the transition went through. */
  bundled?(issueId: string): Promise<{ properties: Record<string, unknown>; settle(): Promise<void> } | undefined>;
}

const jid = (id: string) => `jira:${id}`;

export class StatusExecutor implements PushExecutor {
  readonly kind = "status" as const;
  /** Issue types whose full graph was already asked for this run (admin-gated, design §6.3). */
  private graphAsked = new Set<string>();

  constructor(private readonly o: StatusExecutorOptions) {}

  async execute(item: PushItem, ctx: PushContext): Promise<PushOutcome> {
    const issue = (await ctx.issue(item.issue)) as HiveIssue | null;
    if (!issue?.external || issue.external.source !== this.o.link.source) return { kind: "done" };
    let wf = await this.o.store.workflow();
    if (!wf) return { kind: "retry", reason: "there's no workflow.yaml yet" };
    const target = jiraTargetOf(wf, item.status!);
    if (!target) return { kind: "done" }; // a hive-only status that leaves Jira as it is
    const key = issue.external.key ?? issue.id;
    const entry = await this.o.store.ledgerEntry(this.o.link.source, item.extId);
    const name = (id: string) => wf!.statuses.find((s) => s.id === id)?.name ?? id;

    const raw = (await ctx.transport.bulkFetch([key], ["status", "issuetype"])).issues[0];
    // Gone, or out of reach: hive's move can't be told, so it's put back.
    if (!raw) return { kind: "refused", message: `${key} isn't an issue you can see in Jira any more` };
    let at = jid(String((raw.fields.status as { id?: string } | undefined)?.id));
    const typeKey = jid(String((raw.fields.issuetype as { id?: string } | undefined)?.id ?? issue.external.type?.id));
    const status = issue.status ?? issue.state;
    if (at === target) return this.finished(item, ctx, status); // Jira is there already: an echo, or both moved alike
    const synced = entry?.remoteStatus ?? issue.external.remoteStatus;
    const base = item.reached ?? synced;
    // Both sides moved since the last sync: the pull decides (agree, take Jira's, or a conflict).
    if (!item.keep && base && at !== base) {
      ctx.log(`${key}: Jira moved it to ${name(at)} too; the pull settles it`);
      this.o.pull();
      return { kind: "done" };
    }
    /** Where hive goes back to when Jira refuses: its own status before the move, or where Jira
     *  got to when part of the way was taken. */
    const back = () => (at === synced ? entry?.localStatus ?? at : at);
    const memo = await this.o.store.pushMemo(this.o.link.source);

    let live = await ctx.transport.transitions(key);
    wf = await this.learn(wf, typeKey, at, live);
    let plan = await this.plan(wf, typeKey, live, at, target, ctx);
    if (!plan) return { kind: "refused", message: `Jira has no way from ${name(at)} to ${name(target)} for ${key} within 3 transitions`, revertTo: back() };

    const answered = ctx.answer !== undefined ? item.waiting?.form : undefined;
    // The person answering a form finishes the move, whoever started it.
    const agent = !!item.agent && !answered;
    if (plan.length > 1 && !(answered && answered.path)) {
      const screens = plan.some((s) => s.screen);
      // An agent takes what it can without a screen (below); anyone else confirms a way with one.
      if (!this.o.autoPath() || (screens && !agent)) {
        return { kind: "waiting", message: `Jira has no direct transition to ${name(target)}: confirm the way (${plan.map((s) => s.name).join(" → ")})`, form: pathForm(plan) };
      }
    }

    const taken: string[] = [];
    for (let i = 0; i < plan.length; i++) {
      const step = plan[i]!;
      if (i > 0) {
        live = await ctx.transport.transitions(key);
        wf = await this.learn(wf, typeKey, at, live);
      }
      const t = live.find((x) => x.id === step.id && jid(x.to.id) === step.to && x.isAvailable);
      if (!t) {
        // Jira stopped offering this step (a condition, a change of workflow): another way, once.
        const again = await this.plan(wf, typeKey, live, at, target, ctx);
        if (!again || again.length > 3 - taken.length || again[0]!.id === step.id) {
          return { kind: "refused", message: `Jira doesn't offer ${step.name} from ${name(at)} on ${key} any more`, revertTo: back() };
        }
        plan = [...plan.slice(0, i), ...again];
        i--;
        continue;
      }
      const memoKey = `${typeKey}/${t.id}`;
      const hidden = memo.hidden[memoKey];
      if (hidden && Object.keys(hidden).length) {
        return { kind: "refused", message: `Jira requires what ${t.name}'s screen doesn't ask, so hive can't move ${key} there: ${Object.entries(hidden).map(([f, m]) => `${f}: ${m}`).join("; ")}. Move it in Jira`, revertTo: back() };
      }
      const fields = screenFields(t, t.to.name, memo.defaults[memoKey]);
      let values: Record<string, string> = {};
      if (fields.some((f) => f.required)) {
        const form = screenForm(t, fields, plan.length > 1 ? plan : undefined);
        if (agent) {
          await this.stopAt(item, ctx, at, taken);
          return { kind: "waiting", message: `${item.by ?? "An agent"} moved ${key} to ${name(target)}; ${t.name} has a screen in Jira${taken.length ? ` (Jira is at ${name(at)})` : ""}: fill it to finish`, form };
        }
        if (answered?.transition.id !== t.id || !answered.fields.length) {
          await this.stopAt(item, ctx, at, taken);
          return { kind: "waiting", message: `${t.name} asks for ${fields.filter((f) => f.required).map((f) => f.name).join(", ")} before Jira moves ${key} to ${t.to.name}`, form };
        }
        values = ctx.answer ?? {};
        const lack = missing(fields, values);
        if (lack.length) return (await this.stopAt(item, ctx, at, taken), { kind: "waiting", message: `${t.name} still needs ${lack.map((f) => f.name).join(", ")}`, form });
        await this.remember(memo, (m) => { m.defaults[memoKey] = picked(fields, values); });
      }
      const along = await this.o.bundled?.(item.issue);
      try {
        await ctx.transport.transition(key, t.id, fieldValues(fields, values), along?.properties);
        await along?.settle();
      } catch (e) {
        const out = await this.failed(e, t, memo, memoKey, back);
        if (out.kind === "retry") await this.stopAt(item, ctx, at, taken);
        return out;
      }
      taken.push(t.name);
      at = jid(t.to.id);
    }
    return this.finished(item, ctx, status, `moved to ${name(target)} in Jira (${taken.join(" → ")})`);
  }

  /** Part of the way taken, the rest waits: hive shows where Jira is meanwhile (so a pull agrees
   *  instead of finding both sides moved apart), and the item remembers it was hive that moved it. */
  private async stopAt(item: PushItem, ctx: PushContext, at: string, taken: string[]): Promise<void> {
    if (!taken.length) return;
    item.reached = at;
    await ctx.writeIssue(item.issue, { status: at });
  }

  /** Jira has the target: hive's status is the one pushed again, if a stop part of the way changed it. */
  private async finished(item: PushItem, ctx: PushContext, status: string, activity?: string): Promise<PushOutcome> {
    if (item.reached && status !== item.status) await ctx.writeIssue(item.issue, { status: item.status });
    return { kind: "done", ...(activity ? { activity } : {}) };
  }

  /** Jira's answer to a transition, as an outcome: refusals in its words (design §8.2 step 6). */
  private async failed(e: unknown, t: Transition, memo: PushMemo, memoKey: string, back: () => string): Promise<PushOutcome> {
    if (!(e instanceof TransportError)) throw e;
    const words = e.message.replace(/^[^:]+: /, ""); // without the endpoint or tool it came from
    switch (e.kind) {
      case "rate-limited": return { kind: "retry", reason: e.message, ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}) };
      case "conflict": return { kind: "retry", reason: `Jira was changing the issue at the same moment (409): ${words}` };
      case "unavailable": case "auth": case "consent": return { kind: "retry", reason: e.message };
      case "invalid": {
        if (e.status === 422) return { kind: "refused", message: `Jira's workflow is misconfigured for ${t.name} (422): ${words}`, revertTo: back() };
        if (e.status === 413) return { kind: "refused", message: `Jira's limit for this issue is reached (413): ${words}`, revertTo: back() };
        // A field the screen doesn't have, demanded by a validator: remembered for next time.
        const hidden = Object.fromEntries(Object.entries(e.fieldErrors ?? {}).filter(([f]) => !(f in t.fields)));
        if (Object.keys(hidden).length) await this.remember(memo, (m) => { m.hidden[memoKey] = hidden; });
        return { kind: "refused", message: `Jira refused ${t.name}: ${words}`, revertTo: back() };
      }
      default: return { kind: "refused", message: `Jira refused ${t.name}: ${words}`, revertTo: back() };
    }
  }

  /** The direct transition, else the shortest way; the type's full graph read once when the learned
   *  one has no way and the transport may read it. */
  private async plan(wf: Workflow, typeKey: string, live: Transition[], at: string, target: string, ctx: PushContext): Promise<Step[] | undefined> {
    const direct = live.find((t) => t.isAvailable && jid(t.to.id) === target);
    if (direct) return [{ id: direct.id, name: direct.name, from: at, to: target, screen: direct.hasScreen }];
    const found = findPath(wf.issueTypes[typeKey]?.transitions ?? [], live, at, target, 3);
    if (found || this.graphAsked.has(typeKey)) return found;
    this.graphAsked.add(typeKey);
    const graph = await this.graph(wf, typeKey, ctx);
    return graph ? findPath(graph.issueTypes[typeKey]?.transitions ?? [], live, at, target, 3) : undefined;
  }

  /** Jira's full workflow for the type, written into workflow.yaml beside what was learned. */
  private async graph(wf: Workflow, typeKey: string, ctx: PushContext): Promise<Workflow | undefined> {
    const t = ctx.transport;
    const type = wf.issueTypes[typeKey];
    if (!type || !t.workflowGraph || !t.capabilities.workflowGraph) return undefined;
    const schema = await this.o.store.schema(this.o.link.source);
    const projectId = schema?.discovered.project.id;
    if (!projectId) return undefined;
    const g = await t.workflowGraph(projectId, [typeKey.slice(5)]).catch(() => null);
    const edges = g?.[typeKey.slice(5)];
    if (!edges?.length) return undefined;
    const transitions = [...type.transitions];
    for (const e of edges) {
      if (transitions.some((x) => x.id === e.id && x.to === jid(e.to))) continue;
      transitions.push({ id: e.id, name: e.name, from: e.from === "*" ? "*" : e.from.map(jid), to: jid(e.to) });
    }
    const next = { ...wf, issueTypes: { ...wf.issueTypes, [typeKey]: { ...type, transitions } } };
    await this.o.store.saveWorkflow(next);
    return next;
  }

  /** What Jira offers from `at`, kept in workflow.yaml's `issueTypes` (the Issues tool's picker shows
   *  the legal moves first). */
  private async learn(wf: Workflow, typeKey: string, at: string, live: Transition[]): Promise<Workflow> {
    const next = learnTransitions(wf, typeKey, at, live);
    if (!next) return wf;
    await this.o.store.saveWorkflow(next);
    return next;
  }

  private async remember(memo: PushMemo, change: (m: PushMemo) => void): Promise<void> {
    const now = await this.o.store.pushMemo(this.o.link.source);
    change(now);
    change(memo);
    await this.o.store.savePushMemo(this.o.link.source, now);
  }
}

const formField = (f: FormField): PushForm["fields"][number] => ({
  id: f.id, name: f.name, required: f.required, kind: f.kind === "select" ? "choice" : "text",
  ...(f.options ? { choices: f.options } : {}), ...(f.value !== undefined ? { value: f.value } : {}),
});
const stepOf = (s: Step) => ({ id: s.id, name: s.name, to: s.to });

function screenForm(t: Transition, fields: FormField[], path?: Step[]): PushForm {
  return { transition: { id: t.id, name: t.name, to: jid(t.to.id) }, fields: fields.map(formField), ...(path ? { path: path.map(stepOf) } : {}) };
}

function pathForm(plan: Step[]): PushForm {
  return { transition: stepOf(plan[0]!), fields: [], path: plan.map(stepOf) };
}

/** The values the person sent for a screen's fields, to pre-fill it next time. */
function picked(fields: FormField[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(fields.flatMap((f) => (values[f.id] ? [[f.id, values[f.id]!]] : [])));
}
